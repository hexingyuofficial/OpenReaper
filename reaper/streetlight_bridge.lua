-- streetlight_bridge.lua
--
-- Step 3 scope: ping + get_state (Steps 1-2) + call_template (Step 3).
-- Dispatches one command at a time, FIFO by command ID.
-- Re-runs at ~10 Hz via reaper.defer.
--
-- Auto-start: drop a `dofile("/abs/path/to/this/file")` line into
-- ~/Library/Application Support/REAPER/Scripts/__startup.lua (macOS) or
-- the platform equivalent. See docs/INSTALL.md.
--
-- After updating any pack file (refs.lua, undo.lua, templates/*.lua, or
-- manifest.lua), re-run THIS script in REAPER to pick the changes up —
-- the bridge dofile's the manifest exactly once at startup.

-- ─── Bootstrap ──────────────────────────────────────────────────────────────

local SCRIPT_DIR = (function()
  local src = debug.getinfo(1, "S").source
  -- `source` is prefixed with '@' for files; strip it.
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return src:match("(.*/)") or "./"
end)()

local json     = dofile(SCRIPT_DIR .. "packs/core/lib/json.lua")
local refs     = dofile(SCRIPT_DIR .. "packs/core/refs.lua")
local undo     = dofile(SCRIPT_DIR .. "packs/core/undo.lua")
local MANIFEST = dofile(SCRIPT_DIR .. "packs/core/manifest.lua")

-- ─── Paths ──────────────────────────────────────────────────────────────────

local function get_queue_dir()
  local env = os.getenv("STREETLIGHT_QUEUE_DIR")
  if env and env ~= "" then return env end

  local home = os.getenv("HOME") or ""
  -- Windows path resolution would go here, but REAPER on Windows still
  -- exposes a HOME if cygwin is around. For v0.1 we ship macOS-first; users
  -- on other platforms set STREETLIGHT_QUEUE_DIR explicitly.
  local appdata = os.getenv("APPDATA")
  if appdata and appdata ~= "" then
    return appdata .. "/Streetlight/queue"
  end
  return home .. "/Library/Application Support/Streetlight/queue"
end

local QUEUE_DIR = get_queue_dir()
local PENDING   = QUEUE_DIR .. "/pending"
local RUNNING   = QUEUE_DIR .. "/running"
local DONE      = QUEUE_DIR .. "/done"

reaper.RecursiveCreateDirectory(QUEUE_DIR, 0)
reaper.RecursiveCreateDirectory(PENDING, 0)
reaper.RecursiveCreateDirectory(RUNNING, 0)
reaper.RecursiveCreateDirectory(DONE, 0)

-- ─── Logging ────────────────────────────────────────────────────────────────

local function log(msg)
  reaper.ShowConsoleMsg("[streetlight] " .. tostring(msg) .. "\n")
end

-- ─── Generation guard ───────────────────────────────────────────────────────
--
-- Every `dofile(...)` of this script creates a brand-new chunk: a brand-new
-- closure for `tick`, with its own captured upvalues for LAST_RESULT /
-- DEFERRED / DISPATCH / process_one / oldest_pending. The PRIOR chunk's
-- `tick` was already enrolled in `reaper.defer` and keeps running — REAPER
-- has no API to cancel an in-flight defer chain. Without a guard, repeated
-- dofile reloads accumulate ghost loops, each scanning PENDING/ and each
-- holding its own LAST_RESULT. Symptom seen in Step 6 live smoke 2026-06-29:
-- a `region_create` envelope returns ok, but the immediately-following
-- `render_region last_result:region:0` reports "no mutating call has
-- produced changed regions" — the two commands were claimed by different
-- chunks, and the chunk handling the render couldn't see the chunk-of-
-- region_create's LAST_RESULT.regions.
--
-- Fix: a process-global generation counter on `_G`. Each chunk reads-then-
-- increments it and stashes its own value locally. The deferred `tick`
-- compares each cycle and self-exits (drops out of reaper.defer) if a newer
-- chunk has taken ownership. This is per-process; killing REAPER resets it.
-- The FIRST time this guard ships, older chunks predate it and will not
-- self-exit — Step 6 mid-smoke fix #2 in PROGRESS.md requires a one-time
-- REAPER restart so the new chunk is the sole owner. After that, plain
-- dofile reloads stay single-owner.
_G.STREETLIGHT_BRIDGE_GENERATION = (_G.STREETLIGHT_BRIDGE_GENERATION or 0) + 1
local MY_GENERATION = _G.STREETLIGHT_BRIDGE_GENERATION

log("bridge starting (generation " .. MY_GENERATION .. ")")
log("queue dir = " .. QUEUE_DIR)
log("loaded pack '" .. MANIFEST.name .. "' v" .. MANIFEST.version)

-- ─── Per-session state ──────────────────────────────────────────────────────

-- `last_result` is bridge-internal memory of the most recent successful
-- mutating command's outputs. Resets when the bridge reloads, never
-- persisted. Read-only commands (ping, get_state) MUST NOT touch this —
-- its semantics are "what did the last mutation change".
--
-- Entity buckets are routed by each template's manifest entry
-- `entity_kind` ("item" | "track" | "region"). Step 4b added the routing
-- because before it, `track_create`'s GUIDs would have silently landed
-- in `LAST_RESULT.items`. See refs.lua for the resolver side.
local LAST_RESULT = { items = {}, regions = {}, tracks = {}, renders = {} }

-- Manifest's `entity_kind` strings map onto LAST_RESULT bucket names. Kept
-- as a small table (not just `kind .. "s"`) so a typo in a manifest entry
-- surfaces as an explicit lookup miss, not a silently-created `LAST_RESULT.foos`.
--
-- `render` is the Step 6 addition. Unlike items/tracks/regions, the
-- `renders` bucket holds absolute file paths (artifact outputs of
-- `render_region`), not project-entity refs. v0.1 has no
-- `last_result:render:N` resolver — it's reserved for v0.2 when a future
-- `media_import { path: "last_result:render:0" }` might want to chain a
-- rendered file back into the project. Until then the bucket exists so the
-- dispatcher's cross-bucket clear stays exhaustive.
local ENTITY_BUCKET = {
  item   = "items",
  track  = "tracks",
  region = "regions",
  render = "renders",
}

-- ─── Helpers ────────────────────────────────────────────────────────────────

local function iso_now()
  -- UTC ISO 8601, second precision. Milliseconds intentionally always .000;
  -- pure Lua does not expose sub-second time portably. Step 1 does not need
  -- more precision than that.
  return os.date("!%Y-%m-%dT%H:%M:%S.000Z")
end

local function read_file(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local data = f:read("*a")
  f:close()
  return data
end

local function write_file_atomic(path, content)
  local tmp = path .. ".tmp"
  local f = io.open(tmp, "w")
  if not f then return false, "open failed: " .. path end
  f:write(content)
  f:close()
  local ok, e = os.rename(tmp, path)
  if not ok then
    os.remove(tmp)
    return false, "rename failed: " .. tostring(e)
  end
  return true
end

-- ─── Dispatcher ─────────────────────────────────────────────────────────────

local DISPATCH = {}

function DISPATCH.ping(cmd)
  return {
    ok = true,
    result = {
      bridge         = "connected",
      reaper_version = reaper.GetAppVersion(),
    },
  }
end

-- Scopes recognized by get_state. Only `selection` is implemented in v0.1;
-- the others are reserved names that return SCOPE_NOT_IMPLEMENTED so agents
-- know they're valid spellings of a not-yet-built feature.
local KNOWN_SCOPES = {
  project    = true,
  tracks     = true,
  selection  = true,
  regions    = true,
  render     = true,
}

-- Response-budget backstop. See docs/RESPONSE_BUDGET.md for the full design.
-- These constants are intentionally NOT exposed as params in v0.1 — making
-- them client-tunable invites foot-guns (e.g. an LLM asking for 1 MB). v0.2
-- can expose them once the pagination story is real.
local MAX_RESPONSE_BYTES = 65536
local DEFAULT_LIMIT      = 50
local MIN_LIMIT          = 1
local MAX_LIMIT          = 200

local function clamp_limit(raw)
  if type(raw) ~= "number" then return DEFAULT_LIMIT end
  local n = math.floor(raw)
  if n < MIN_LIMIT then return MIN_LIMIT end
  if n > MAX_LIMIT then return MAX_LIMIT end
  return n
end

local function get_track_name(track)
  if not track then return "" end
  local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
  return name or ""
end

local function get_take_name(item)
  local take = reaper.GetActiveTake(item)
  if not take then return "" end
  -- GetTakeName returns the take name directly (no boolean return).
  return reaper.GetTakeName(take) or ""
end

local function get_item_guid(item)
  -- REAPER 7+ native GUID accessor. The first return is a boolean (kept by
  -- API convention); the GUID string comes second.
  local _, guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
  return guid or ""
end

local function build_item_descriptor(item)
  return {
    id         = "guid:" .. get_item_guid(item),
    name       = get_take_name(item),
    track_name = get_track_name(reaper.GetMediaItemTrack(item)),
    position   = reaper.GetMediaItemInfo_Value(item, "D_POSITION"),
    length     = reaper.GetMediaItemInfo_Value(item, "D_LENGTH"),
  }
end

-- Build the selection payload with item-boundary byte tracking.
-- Returns either:
--   { ok = true,  items, total, returned, truncated, response_bytes }
--   { ok = false, code = "RESPONSE_TOO_LARGE", message = ... }
--
-- Why item-boundary, not byte-level: chopping the encoded JSON string mid-
-- token produces malformed responses. We instead encode each descriptor
-- standalone, accumulate its size, and stop at the previous item if the
-- next one would push us past the cap. See docs/RESPONSE_BUDGET.md.
local function read_selection(limit_raw)
  local limit = clamp_limit(limit_raw)

  -- Snapshot the selection once at the top so any concurrent UI activity
  -- can't shift our indices mid-loop.
  local total      = reaper.CountSelectedMediaItems(0)
  local effective  = math.min(total, limit)
  local items      = {}
  local bytes      = 0
  local truncated  = false

  for i = 0, effective - 1 do
    local item = reaper.GetSelectedMediaItem(0, i)
    if item then
      local desc       = build_item_descriptor(item)
      local encoded    = json.encode(desc)
      local item_bytes = #encoded
      -- One byte for the comma separator that will sit between this item
      -- and the previous one in the final array.
      local sep_bytes  = (#items > 0) and 1 or 0

      if bytes + item_bytes + sep_bytes > MAX_RESPONSE_BYTES then
        if #items == 0 then
          return {
            ok      = false,
            code    = "RESPONSE_TOO_LARGE",
            message = "Single selected item exceeds the "
              .. MAX_RESPONSE_BYTES .. " byte response cap",
          }
        end
        truncated = true
        break
      end

      items[#items + 1] = desc
      bytes = bytes + item_bytes + sep_bytes
    end
  end

  -- Limit-driven truncation: we read `effective` items but `total > effective`.
  if total > #items then truncated = true end

  return {
    ok             = true,
    items          = items,
    total          = total,
    returned       = #items,
    truncated      = truncated,
    response_bytes = bytes,
  }
end

function DISPATCH.get_state(cmd)
  local params = cmd.params or {}
  local scope = params.scope
  if scope == nil or scope == "" then scope = "selection" end

  if not KNOWN_SCOPES[scope] then
    return {
      ok = false,
      error = {
        code        = "PARAMS_INVALID",
        message     = "Unknown get_state scope: " .. tostring(scope),
        recoverable = true,
      },
    }
  end

  if scope ~= "selection" then
    return {
      ok = false,
      error = {
        code        = "SCOPE_NOT_IMPLEMENTED",
        message     = "get_state scope '" .. scope .. "' is not implemented in v0.1",
        recoverable = true,
      },
    }
  end

  local sel = read_selection(params.limit)

  if not sel.ok then
    return {
      ok = false,
      error = {
        code        = sel.code,
        message     = sel.message,
        recoverable = true,
      },
    }
  end

  -- Wrap items with json.array so an empty selection encodes as [], not {}.
  return {
    ok = true,
    result = {
      selection = {
        items          = json.array(sel.items),
        total          = sel.total,
        returned       = sel.returned,
        truncated      = sel.truncated,
        response_bytes = sel.response_bytes,
      },
    },
  }
end

-- ─── Template dispatch + locked-shape enforcement ──────────────────────────
--
-- This is THE place where the `call_template` shape is enforced. Per the
-- contract in docs/RESPONSE_BUDGET.md § call_template, every successful
-- `call_template` envelope MUST look like:
--
--   { template, changed_count, changed_ids[≤50], truncated }
--
-- Even if a template handler returns extra fields (descriptors, before/after
-- snapshots, debug payload), we read ONLY `changed_ids` from it. Anything
-- else is dropped at this boundary, by design.

local CHANGED_IDS_CAP = 50

local function normalize_changed_ids(raw)
  -- Accept either a Lua array of strings, or nil (meaning "nothing changed,
  -- but the operation succeeded" — e.g. a future no-op template). Anything
  -- else is a template-author bug; we coerce to empty and let the handler
  -- learn about it via the (eventual) test suite, rather than blowing up
  -- the bridge.
  if raw == nil then return {}, 0 end
  if type(raw) ~= "table" then return {}, 0 end

  local total = 0
  local capped = {}
  for i = 1, #raw do
    if type(raw[i]) == "string" then
      total = total + 1
      if #capped < CHANGED_IDS_CAP then
        capped[#capped + 1] = raw[i]
      end
    end
  end
  return capped, total
end

local function build_template_envelope(template_name, raw_changed)
  local capped, total = normalize_changed_ids(raw_changed)
  return {
    ok = true,
    result = {
      template      = template_name,
      changed_count = total,
      changed_ids   = json.array(capped),
      truncated     = total > CHANGED_IDS_CAP,
    },
  }
end

local function template_error_envelope(err_obj)
  -- Handlers raise via `error({ code, message })`. Anything else (string
  -- error, unexpected throw) collapses to INTERNAL_ERROR with the raw text.
  if type(err_obj) == "table" and err_obj.code then
    return {
      ok = false,
      error = {
        code        = tostring(err_obj.code),
        message     = tostring(err_obj.message or err_obj.code),
        recoverable = err_obj.recoverable ~= false,
      },
    }
  end
  return {
    ok = false,
    error = {
      code        = "INTERNAL_ERROR",
      message     = "Handler crashed: " .. tostring(err_obj),
      recoverable = false,
    },
  }
end

-- Finalize a synchronous OR deferred template result into the locked
-- `call_template` envelope AND update LAST_RESULT atomically. Extracted in
-- Step 6 so the sync dispatch path and the deferred-completion tick share
-- one place to enforce both contracts. Do NOT call this from inside the
-- deferred sentinel path itself — call it from the terminal resolution
-- (success only). Error terminations skip LAST_RESULT updates by going
-- through template_error_envelope instead.
local function finalize_template(template_name, entity_kind, raw_changed)
  local envelope = build_template_envelope(template_name, raw_changed)

  -- last_result tracks the most recent successful mutating command's
  -- outputs in the bucket matching this template's entity kind. Read-only
  -- paths (ping, get_state) DO NOT touch LAST_RESULT.
  --
  -- A missing/typo'd entity_kind falls through to "item" with a console
  -- warning — keeps the bridge usable while making the bug loud.
  --
  -- Cross-bucket clear: every successful mutation wipes the other buckets
  -- before writing its own. Spec semantics for `last_result:<kind>:N` are
  -- "the MOST RECENT mutation, in this kind" — not "the most recent per
  -- kind". See docs/PROGRESS.md § Step 4b smoke 4b-9.
  local bucket = entity_kind and ENTITY_BUCKET[entity_kind]
  if not bucket then
    log("WARNING: template '" .. template_name .. "' has missing/unknown entity_kind '"
      .. tostring(entity_kind) .. "'; defaulting to 'item' bucket")
    bucket = "items"
  end
  for k in pairs(LAST_RESULT) do LAST_RESULT[k] = {} end
  LAST_RESULT[bucket] = envelope.result.changed_ids

  return envelope
end

-- ─── Deferred-completion slot ───────────────────────────────────────────────
--
-- Single-slot continuation queue. v0.1's only consumer is `render_region`,
-- which kicks `Main_OnCommand(42230, 0)` and yields so the bridge can stay
-- responsive while REAPER writes the file. While DEFERRED is set,
-- `process_one` skips claiming new pending commands — the running file for
-- the deferred command stays in place, and `tick_deferred` re-runs the
-- handler-supplied recheck closure on each defer tick.
--
-- Slot shape, populated by `DISPATCH.template` when a handler returns
-- `{ deferred = true, recheck, on_timeout, on_terminal, deadline }`:
--   id            — command id (so the eventual done file lands at the right path)
--   template_name — manifest name, for finalize_template
--   entity_kind   — manifest entity_kind, for finalize_template
--   running_path  — path to the running/<id>.json that's still on disk
--   done_path     — path the final envelope writes to
--   recheck       — fn() -> nil (still pending), or { changed_ids = {...} } success
--   on_timeout    — fn() -> raises an error{code,message} typed terminal failure
--   on_terminal   — fn() -> idempotent teardown (e.g. restore render settings).
--                   Called in EVERY exit path (success, error, timeout). Must
--                   be safe to call >1 time; the handler's own guard flag is
--                   what enforces exactly-once.
--   deadline      — absolute reaper.time_precise() seconds; past this we
--                   transition through on_timeout.
--
-- v0.1 deliberate constraints (see Step 6 regression notes in PROGRESS.md):
--   * Single slot only — second pending command waits its turn. No queue.
--   * Continuation is bridge-internal — the agent's Result is ONLY built
--     when DEFERRED resolves; they never see a "rendering" status.
local DEFERRED = nil

local function shape_outer_envelope(id, inner)
  -- inner is { ok, result|error }; outer adds id + completed_at.
  local env = { id = id, ok = inner.ok, completed_at = iso_now() }
  if inner.result ~= nil then env.result = inner.result end
  if inner.error  ~= nil then env.error  = inner.error  end
  return env
end

local function write_done_envelope(running_path, done_path, envelope)
  local encoded = json.encode(envelope)
  local ok_write, w_err = write_file_atomic(done_path, encoded)
  if not ok_write then
    log("write done failed for " .. tostring(envelope.id) .. ": " .. tostring(w_err))
  end
  os.remove(running_path)
end

local function tick_deferred()
  if not DEFERRED then return end
  local d   = DEFERRED
  local now = reaper.time_precise()

  -- Resolve into `inner` ({ ok, result|error }); close_with handles teardown,
  -- envelope shaping, and the write/remove dance. close_with also clears the
  -- DEFERRED slot so a crashing on_terminal doesn't lock the bridge.
  local function close_with(inner)
    DEFERRED = nil
    pcall(d.on_terminal)
    write_done_envelope(d.running_path, d.done_path,
      shape_outer_envelope(d.id, inner))
  end

  if now >= d.deadline then
    -- Deadline hit. on_timeout MUST raise a typed error (RENDER_TIMEOUT /
    -- RENDER_FILE_EMPTY for render_region) — silent return is a handler
    -- bug. If it does return a value, we treat it as a last-second success
    -- (legal; e.g. file appeared right at the boundary) and run it through
    -- finalize_template so LAST_RESULT.renders still gets the artifact.
    local ok_to, err_or_result = pcall(d.on_timeout)
    if ok_to then
      local changed = type(err_or_result) == "table" and err_or_result.changed_ids or nil
      close_with(finalize_template(d.template_name, d.entity_kind, changed))
    else
      close_with(template_error_envelope(err_or_result))
    end
    return
  end

  local ok_rc, rc_result = pcall(d.recheck)
  if not ok_rc then
    close_with(template_error_envelope(rc_result))
    return
  end
  if rc_result == nil then return end           -- still pending — try again next tick

  if type(rc_result) == "table" and rc_result.error then
    close_with({ ok = false, error = rc_result.error })
  else
    local changed = type(rc_result) == "table" and rc_result.changed_ids or nil
    close_with(finalize_template(d.template_name, d.entity_kind, changed))
  end
end


function DISPATCH.template(cmd)
  local name = cmd.name
  if type(name) ~= "string" or name == "" then
    return {
      ok = false,
      error = {
        code        = "TEMPLATE_NOT_FOUND",
        message     = "call_template requires a non-empty `name`",
        recoverable = true,
      },
    }
  end

  local entry = MANIFEST.templates[name]
  if not entry or type(entry.handler) ~= "function" then
    return {
      ok = false,
      error = {
        code        = "TEMPLATE_NOT_FOUND",
        message     = "No template named '" .. name .. "' in pack '" .. MANIFEST.name .. "'",
        recoverable = true,
      },
    }
  end

  local ctx = {
    refs        = refs,
    last_result = LAST_RESULT,
    -- Exposed so handlers with nullable params can compare with
    -- `params.x == ctx.json.null`. See docs/TEMPLATE_SPEC.md
    -- § Nullable Params.
    json        = json,
  }
  local params = cmd.params or {}

  local ok_run, result_or_err
  if entry.undoable then
    -- with_undo guarantees Undo_EndBlock2 runs even on error path.
    ok_run, result_or_err = undo.with_undo(
      entry.undo_label or ("Streetlight: " .. name),
      entry.undo_flags or undo.UNDO_STATE_ITEMS,
      function() return entry.handler(params, ctx) end
    )
  else
    ok_run, result_or_err = pcall(entry.handler, params, ctx)
  end

  if not ok_run then
    return template_error_envelope(result_or_err)
  end

  -- Deferred-completion sentinel (Step 6). A handler that needs to yield
  -- between defer ticks returns:
  --   { deferred = true, recheck = fn, on_timeout = fn, on_terminal = fn,
  --     deadline = abs_time_precise_seconds }
  -- The bridge stashes the metadata, leaves the running file in place, and
  -- skips claiming new pending commands until the slot resolves. See
  -- process_one + tick_deferred for the per-tick handling.
  --
  -- DO NOT finalize LAST_RESULT or write done here — the agent's
  -- Result<CallTemplateResult> is built only when the deferred slot
  -- terminates (success / typed error / timeout). The dispatcher returns
  -- the sentinel as-is so process_one can distinguish it from a normal
  -- envelope.
  if type(result_or_err) == "table" and result_or_err.deferred then
    result_or_err.template_name = name
    result_or_err.entity_kind   = entry.entity_kind
    return result_or_err
  end

  -- Synchronous path: handler returned a regular result table (or nil).
  local raw_changed = nil
  if type(result_or_err) == "table" then
    raw_changed = result_or_err.changed_ids
  end
  return finalize_template(name, entry.entity_kind, raw_changed)
end

local function dispatch(cmd)
  local kind = cmd.kind
  local handler = DISPATCH[kind]
  if not handler then
    return {
      ok = false,
      error = {
        code        = "TEMPLATE_NOT_FOUND",
        message     = "Unknown command kind: " .. tostring(kind),
        recoverable = true,
      },
    }
  end

  local ok, result_or_err = pcall(handler, cmd)
  if not ok then
    return {
      ok = false,
      error = {
        code        = "INTERNAL_ERROR",
        message     = "Handler error: " .. tostring(result_or_err),
        recoverable = false,
      },
    }
  end
  return result_or_err
end

-- ─── Queue scan ─────────────────────────────────────────────────────────────

local function oldest_pending()
  -- EnumerateFiles returns the names in an unspecified order; we sort to
  -- guarantee FIFO by command ID (IDs are lexicographically time-ordered).
  local names = {}
  local i = 0
  while true do
    local name = reaper.EnumerateFiles(PENDING, i)
    if not name then break end
    if name:sub(-5) == ".json" then
      names[#names + 1] = name
    end
    i = i + 1
  end
  if #names == 0 then return nil end
  table.sort(names)
  return names[1]
end

local function process_one()
  -- A live deferred slot owns the next tick. We do NOT claim new pending
  -- commands while a long-running template is still resolving — the
  -- single-slot constraint keeps the v0.1 semantics simple (render is
  -- the demo's terminal step; nothing else competes).
  if DEFERRED then
    tick_deferred()
    return
  end

  local name = oldest_pending()
  if not name then return end

  local pending_path = PENDING .. "/" .. name
  local running_path = RUNNING .. "/" .. name
  local id = name:gsub("%.json$", "")

  -- Claim it.
  local ok_mv, mv_err = os.rename(pending_path, running_path)
  if not ok_mv then
    log("claim failed for " .. name .. ": " .. tostring(mv_err))
    return
  end

  local raw = read_file(running_path)
  local envelope
  if not raw then
    envelope = {
      id           = id,
      ok           = false,
      error        = {
        code        = "INTERNAL_ERROR",
        message     = "Could not read claimed command file",
        recoverable = false,
      },
      completed_at = iso_now(),
    }
  else
    local ok_decode, cmd_or_err = pcall(json.decode, raw)
    if not ok_decode then
      envelope = {
        id           = id,
        ok           = false,
        error        = {
          code        = "INTERNAL_ERROR",
          message     = "Bad command JSON: " .. tostring(cmd_or_err),
          recoverable = false,
        },
        completed_at = iso_now(),
      }
    else
      local cmd = cmd_or_err
      local result = dispatch(cmd)

      -- Deferred sentinel: handler wants more ticks. Stash the slot
      -- metadata so subsequent ticks call recheck. The running file
      -- stays in place until tick_deferred resolves the slot — that's
      -- our durability story if REAPER is killed mid-render (next
      -- session sees the orphan in running/ and ignores it; the
      -- agent's MCP-side timeout already fired BRIDGE_NOT_RUNNING).
      if type(result) == "table" and result.deferred then
        local cmd_id = cmd.id or id
        DEFERRED = {
          id            = cmd_id,
          template_name = result.template_name,
          entity_kind   = result.entity_kind,
          running_path  = running_path,
          done_path     = DONE .. "/" .. cmd_id .. ".json",
          recheck       = result.recheck,
          on_timeout    = result.on_timeout,
          on_terminal   = result.on_terminal or function() end,
          deadline      = result.deadline,
        }
        return
      end

      envelope = {
        id           = cmd.id or id,
        ok           = result.ok,
        completed_at = iso_now(),
      }
      if result.ok then envelope.result = result.result end
      if result.error then envelope.error = result.error end
    end
  end

  local encoded = json.encode(envelope)
  local done_path = DONE .. "/" .. envelope.id .. ".json"
  local ok_write, w_err = write_file_atomic(done_path, encoded)
  if not ok_write then
    log("write done failed for " .. envelope.id .. ": " .. tostring(w_err))
  end

  os.remove(running_path)
end

-- ─── Defer loop ─────────────────────────────────────────────────────────────

local POLL_INTERVAL_S = 0.1   -- 10 Hz
local last_tick = 0

local function tick()
  -- Generation guard: a newer chunk has loaded and taken ownership.
  -- Stop ticking — do not call process_one, do not re-enroll in defer.
  -- The newer chunk owns LAST_RESULT, DEFERRED, the queue dirs, etc.
  if MY_GENERATION ~= _G.STREETLIGHT_BRIDGE_GENERATION then
    -- If we were mid-render, give the snapshotted render settings their
    -- best-effort restore so the user's render dialog isn't left in our
    -- temp state. We deliberately do NOT write the done envelope: the
    -- new chunk has its own LAST_RESULT and we'd be poisoning the new
    -- session's state. The pending command's running/<id>.json is left
    -- on disk; the new chunk's startup `reap_stale_running` (Step 7 B4)
    -- writes a typed INTERNAL_ERROR done envelope for it so the agent
    -- gets a definitive answer instead of waiting for the MCP-side
    -- BRIDGE_NOT_RUNNING timeout.
    if DEFERRED and DEFERRED.on_terminal then
      pcall(DEFERRED.on_terminal)
    end
    DEFERRED = nil
    log("bridge generation " .. MY_GENERATION
      .. " self-exiting (current is "
      .. tostring(_G.STREETLIGHT_BRIDGE_GENERATION) .. ")")
    return
  end

  local now = reaper.time_precise()
  if now - last_tick >= POLL_INTERVAL_S then
    last_tick = now
    -- Process at most one command per tick to keep REAPER's main thread
    -- responsive. Burst load drains across multiple ticks.
    local ok, err_ = pcall(process_one)
    if not ok then
      log("process_one crashed: " .. tostring(err_))
    end
  end
  reaper.defer(tick)
end

-- ─── Startup: reap stale RUNNING/ envelopes (Step 7 B4) ────────────────────
--
-- Orphan sources we clean up:
--   1. Older chunks that self-exited mid-DEFERRED (generation guard fires
--      while a render is in flight). The self-exit runs on_terminal to
--      restore render settings but deliberately does NOT write a done
--      envelope (would poison the new chunk's session).
--   2. REAPER force-quit mid-render — the prior session left a running/
--      <id>.json on disk with no corresponding done/<id>.json.
--
-- For each running/*.json we write a typed done envelope and remove the
-- running file. Agent-side, the MCP poll loop sees INTERNAL_ERROR with a
-- definitive message instead of timing out into BRIDGE_NOT_RUNNING — same
-- contract surface as every other terminal error, less ambiguity.
--
-- Race note: when this runs on chunk N+1's startup, chunk N hasn't yet
-- self-exited (its next tick is ~100ms away). But the generation guard
-- runs at the TOP of chunk N's next tick — BEFORE process_one / tick_deferred
-- — so chunk N never writes its own done envelope after the reload. Chunk
-- N+1's cleanup wins the race uncontested. If chunk N's render had already
-- completed before the reload, write_done_envelope removed running/<id>.json
-- as part of the success path, so cleanup finds nothing to do.
--
-- Not silently deleted, per Step 7 decision B4: agents that were waiting
-- on a render need a typed terminal envelope, not a 60s wire-timeout.
local function reap_stale_running()
  local i = 0
  local names = {}
  while true do
    local n = reaper.EnumerateFiles(RUNNING, i)
    if not n then break end
    if n:sub(-5) == ".json" then names[#names + 1] = n end
    i = i + 1
  end
  if #names == 0 then return end
  local reaped = 0
  for _, name in ipairs(names) do
    local running_path = RUNNING .. "/" .. name
    local id = name:sub(1, -6) -- strip ".json"
    local envelope = {
      id = id,
      ok = false,
      completed_at = iso_now(),
      error = {
        code        = "INTERNAL_ERROR",
        message     = "Bridge restarted while this command was running",
        recoverable = true,
      },
    }
    local done_path = DONE .. "/" .. name
    local ok_write, w_err = write_file_atomic(done_path, json.encode(envelope))
    if not ok_write then
      log("startup-cleanup: write done failed for " .. id
        .. ": " .. tostring(w_err))
    end
    os.remove(running_path)
    reaped = reaped + 1
  end
  log("startup-cleanup: reaped " .. reaped .. " stale running/ envelope"
    .. (reaped == 1 and "" or "s")
    .. " (INTERNAL_ERROR: bridge restarted)")
end

reap_stale_running()

log("bridge ready (generation " .. MY_GENERATION
  .. ") — templates: " .. (function()
  local names = {}
  for n in pairs(MANIFEST.templates) do names[#names + 1] = n end
  table.sort(names)
  return table.concat(names, ", ")
end)())
reaper.defer(tick)
