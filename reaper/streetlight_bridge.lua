-- streetlight_bridge.lua
--
-- Step 1 scope: file-queue round trip for `ping`.
-- Dispatches one command at a time, FIFO by command ID.
-- Re-runs at ~10 Hz via reaper.defer.
--
-- Auto-start: drop a `dofile("/abs/path/to/this/file")` line into
-- ~/Library/Application Support/REAPER/Scripts/__startup.lua (macOS) or
-- the platform equivalent. See docs/INSTALL.md.

-- ─── Bootstrap ──────────────────────────────────────────────────────────────

local SCRIPT_DIR = (function()
  local src = debug.getinfo(1, "S").source
  -- `source` is prefixed with '@' for files; strip it.
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return src:match("(.*/)") or "./"
end)()

local json = dofile(SCRIPT_DIR .. "packs/core/lib/json.lua")

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

log("bridge starting")
log("queue dir = " .. QUEUE_DIR)

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

log("bridge ready")
reaper.defer(tick)
