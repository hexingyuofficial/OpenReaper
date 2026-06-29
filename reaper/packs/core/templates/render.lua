-- templates/render.lua — render templates (Step 6).
--
-- v0.1 ships exactly one handler: `M.render_region`. It is the first (and
-- only) consumer of the bridge's single-slot deferred-completion protocol
-- (see streetlight_bridge.lua § "Deferred-completion slot"). The handler
-- kicks `Main_OnCommand(42230, 0)` and then YIELDS, returning a sentinel
-- table the bridge interprets:
--
--   {
--     deferred    = true,
--     recheck     = fn,  -- called each defer tick; nil = still pending,
--                        --   { changed_ids = ... } = success
--     on_timeout  = fn,  -- called once at deadline; raises typed terminal
--                        --   error (RENDER_TIMEOUT or RENDER_FILE_EMPTY)
--     on_terminal = fn,  -- idempotent teardown; called in EVERY exit path
--                        --   to restore the snapshotted render settings
--     deadline    = abs_time_precise_seconds,
--   }
--
-- The bridge's `tick_deferred` drives this. The agent never sees the
-- "rendering" intermediate state — the file-queue's poll loop just waits
-- for the eventual `done/<id>.json` to land.
--
-- ── Locked v0.1 output policy (intentionally not exposed as params) ──
--   format       = WAV, 24-bit PCM   (RENDER_FORMAT blob below)
--   channels     = 2 (stereo)        (RENDER_CHANNELS = 2)
--   sample rate  = project rate      (RENDER_SRATE = 0)
--   tail         = none              (RENDER_TAILFLAG = 0)
--   addtoproj    = no                (RENDER_ADDTOPROJ = 0)
--   bounds       = custom time       (RENDER_BOUNDSFLAG = 0 + STARTPOS/ENDPOS
--                                     from the resolved region)
--   pattern      = literal region name (NOT "$region"; see header note below)
--
-- ── Notes worth keeping near the code ──
--
-- (1) Snapshot/restore covers TEN project-info keys (not the eight
--     listed in docs/RENDER_NOTES.md's table). STARTPOS and ENDPOS
--     join because we're using BOUNDSFLAG=0 (custom time) — without
--     snapshotting them we'd leak our region bounds back into the
--     user's render dialog.
--
--     This used to be 10 + 2 reaper.ini config vars
--     (`autosaveonrender`, `autosaveonrender2`) on the theory that
--     those two governed the `<wav>.RPP` project-copy sidecar REAPER
--     writes next to renders when the Render-dialog "save copy of
--     project to outfile" checkbox is on. Step 7 mid-smoke proved
--     them wrong: the live-smoke active probe revealed that on stock
--     REAPER 7.71/macOS-arm64, `reaper.set_config_var_string` is nil
--     (the setter doesn't exist on this build at all), so the
--     suppression path was never going to work — it only avoided
--     hard-crashing because `get_config_var_string("autosaveonrender*")`
--     ALSO returned `retval=false` on the same build, leaving the
--     snapshot nil and the setter unreached. Any build where the
--     getter succeeded but the setter remained nil would have
--     hard-failed mid-render.
--
--     v0.1 therefore handles the sidecar via the artifact contract
--     rather than via REAPER state:
--       * `check_no_collision` (preflight) refuses to start if a
--         `<wav>.RPP` or `<wav>.RPP-bak` already exists at the
--         render target — so cleanup-on-success can NEVER touch a
--         file we didn't create.
--       * `recheck` (deferred-completion success branch) deletes
--         the auto-generated `<wav>.RPP` / `<wav>.RPP-bak` after
--         the WAV stabilizes; a failed delete raises INTERNAL_ERROR
--         (bridge's `tick_deferred` pcalls `recheck`, so the typed
--         raise lands as a clean error envelope).
--     The WAV-only `changed_ids` contract is unchanged — the agent
--     either sees the artifact path or sees a typed error code.
--
-- (2) RENDER_PATTERN is the literal region name, NOT `"$region"`. With
--     BOUNDSFLAG=0 (custom time, not project regions) `$region` has no
--     guaranteed expansion. We already have the resolved name in hand;
--     using it literally makes the output filename deterministic
--     (`<output_dir>/<region_name>.wav`) regardless of REAPER's token
--     expansion. This is a deliberate deviation from RENDER_NOTES — see
--     Step 6 regression note in docs/PROGRESS.md.
--
-- (3) `changed_ids = { absolute_path }` on success. `render_region` is the
--     ONE template whose `changed_ids` carries artifact paths, not project
--     entity refs. Every other template stays with `guid:{...}` /
--     `region:NAME` / `track:Name`. Do NOT generalize. See
--     docs/RESPONSE_BUDGET.md § call_template.
--
-- (4) Pre-flight (region resolution, output_dir validation, collision
--     check) happens BEFORE the snapshot. Typed errors here mean we never
--     touched render settings — the user's render dialog is untouched on
--     OUTPUT_DIR_MISSING / OUTPUT_DIR_NOT_WRITABLE / OUTPUT_FILE_EXISTS /
--     REGION_NOT_FOUND / REF_INVALID.

local M = {}

local PACK_DIR = (function()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  -- We're at packs/core/templates/render.lua; lib/ is one level up.
  local templates_dir = src:match("(.*/)") or "./"
  return templates_dir:gsub("templates/$", "")
end)()

local names = dofile(PACK_DIR .. "lib/names.lua")

local function raise(code, message)
  error({ code = code, message = message })
end

-- ─── RENDER_FORMAT WAV-24 blob ─────────────────────────────────────────────
--
-- REAPER's RENDER_FORMAT is an opaque binary blob; there's no human-readable
-- form. We capture it by manually configuring REAPER's render dialog to
-- "WAV / 24-bit PCM" and dumping the value via:
--
--   local _, fmt = reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT", "", false)
--   for i = 1, #fmt do io.write(string.format("%02X ", string.byte(fmt, i))) end
--
-- Paste the hex output below. Whitespace is stripped at decode time, so
-- "0011 22 33..." or "00112233..." both work. We decode hex→bytes lazily
-- (first render_region call) so the bridge boots fine while this constant
-- is still the empty placeholder.
--
-- ⚠️ TBD: fill in from a REAPER dump (see docs/RENDER_NOTES.md "C1 dump
-- procedure" or HANDOFF.md). Until then, `render_region` raises
-- INTERNAL_ERROR with a directive message.
local RENDER_FORMAT_WAV24_HEX = "5A 58 5A 68 64 78 67 41 41 41 3D 3D"

local cached_render_format = nil

local function hex_to_bytes(hex_str)
  local clean = hex_str:gsub("%s", "")
  if #clean == 0 then
    raise("INTERNAL_ERROR",
      "RENDER_FORMAT_WAV24_HEX is empty — fill the constant in "
        .. "reaper/packs/core/templates/render.lua from a REAPER "
        .. "RENDER_FORMAT dump. See docs/RENDER_NOTES.md.")
  end
  if #clean % 2 ~= 0 then
    raise("INTERNAL_ERROR",
      "RENDER_FORMAT_WAV24_HEX has odd hex length " .. #clean
        .. " — must be pairs of hex digits.")
  end
  local out = {}
  for i = 1, #clean, 2 do
    local byte_str = clean:sub(i, i + 1)
    local byte_val = tonumber(byte_str, 16)
    if not byte_val then
      raise("INTERNAL_ERROR",
        "RENDER_FORMAT_WAV24_HEX has non-hex chars at offset " .. i
          .. ": '" .. byte_str .. "'")
    end
    out[#out + 1] = string.char(byte_val)
  end
  return table.concat(out)
end

local function get_render_format_blob()
  if cached_render_format then return cached_render_format end
  cached_render_format = hex_to_bytes(RENDER_FORMAT_WAV24_HEX)
  return cached_render_format
end

-- ─── Settings snapshot/restore (10 project-info keys) ─────────────────────
--
-- Step 7 first/second mid-smoke fixes tried to suppress REAPER's
-- ".wav.RPP" project-copy sidecar by snapshot-and-zero of
-- `autosaveonrender` / `autosaveonrender2` reaper.ini config vars via
-- `set_config_var_string`. The active probe (Step 7 third mid-smoke)
-- revealed that on stock REAPER 7.71/macOS-arm64,
-- `reaper.set_config_var_string` is nil — the setter doesn't exist on
-- this build at all. The previous nil-skip path "worked" only because
-- `get_config_var_string("autosaveonrender*")` ALSO returned
-- retval=false on this build, so the snapshot stored nil and the
-- setter was never called; on a build where the getter succeeded but
-- the setter was still nil, render.lua would have hard-crashed
-- (`attempt to call a nil value`) mid-render — exactly what the active
-- probe demonstrated when it tried to mask `renderclosewhendone`.
--
-- v0.1 therefore does NOT try to suppress the sidecar at the config-var
-- level. The artifact contract is enforced two other ways:
--   1. `check_no_collision` is extended to reject pre-existing
--      `<wav>.RPP` / `<wav>.RPP-bak` with OUTPUT_FILE_EXISTS, so we
--      can never delete a user file we didn't create.
--   2. The deferred-completion `recheck` success branch deletes both
--      sidecar paths after the WAV stabilizes but BEFORE the exactly-
--      once restore runs; a delete failure raises INTERNAL_ERROR so
--      the agent sees a typed terminal error rather than a "success"
--      that breaks the contract.

local function snapshot_render_settings()
  return {
    bounds   = reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0, false),
    startpos = reaper.GetSetProjectInfo(0, "RENDER_STARTPOS",   0, false),
    endpos   = reaper.GetSetProjectInfo(0, "RENDER_ENDPOS",     0, false),
    srate    = reaper.GetSetProjectInfo(0, "RENDER_SRATE",      0, false),
    chans    = reaper.GetSetProjectInfo(0, "RENDER_CHANNELS",   0, false),
    tail     = reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG",   0, false),
    addproj  = reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ",  0, false),
    file     = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_FILE",    "", false)),
    pattern  = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", "", false)),
    format   = select(2, reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT",  "", false)),
  }
end

local function restore_render_settings(s)
  reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", s.bounds,   true)
  reaper.GetSetProjectInfo(0, "RENDER_STARTPOS",   s.startpos, true)
  reaper.GetSetProjectInfo(0, "RENDER_ENDPOS",     s.endpos,   true)
  reaper.GetSetProjectInfo(0, "RENDER_SRATE",      s.srate,    true)
  reaper.GetSetProjectInfo(0, "RENDER_CHANNELS",   s.chans,    true)
  reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG",   s.tail,     true)
  reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ",  s.addproj,  true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FILE",    s.file,    true)
  reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", s.pattern, true)
  reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT",  s.format,  true)
end

-- ─── Path helpers ──────────────────────────────────────────────────────────

local function path_join(dir, leaf)
  local last = dir:sub(-1)
  if last == "/" or last == "\\" then
    return dir .. leaf
  end
  return dir .. "/" .. leaf
end

-- True if `path` enumerates as a directory (has files OR subdirectories
-- OR appears in REAPER's directory enumeration). Used only as a last-resort
-- distinguisher between "doesn't exist" and "exists but not writable" when
-- the probe write fails. Empty existing directories may still be reported
-- as "doesn't appear to exist" by REAPER's enumeration; in that case we
-- err on the side of OUTPUT_DIR_MISSING, which is the more actionable
-- error from the agent's POV.
local function dir_appears_to_exist(path)
  return reaper.EnumerateFiles(path, 0) ~= nil
      or reaper.EnumerateSubdirectories(path, 0) ~= nil
end

-- Validate output_dir per the locked policy:
--   * doesn't exist            → OUTPUT_DIR_MISSING
--   * exists but is a file     → OUTPUT_DIR_NOT_WRITABLE
--   * exists but probe write fails → OUTPUT_DIR_NOT_WRITABLE
--
-- All of these surface BEFORE any render settings are touched.
--
-- Note: we CANNOT use `reaper.file_exists(output_dir)` to short-circuit on
-- "it's a regular file" — live REAPER returns true for directories too, so
-- a perfectly good writable directory would be misclassified as a file.
-- Instead we probe-write a uniquely-named file *inside* the candidate path.
-- A successful create+delete proves "exists AND is a directory AND we can
-- write into it" in one shot (you can't io.open("w") inside a regular-file
-- path, and you can't open inside a missing dir). file_exists is still
-- useful at the end as a "does this path resolve to anything?" test for
-- distinguishing MISSING from NOT_WRITABLE if the probe fails.
local function validate_output_dir(output_dir)
  -- Probe-write first. Use unique-per-attempt names so we never truncate
  -- or delete a user file that happens to be sitting at our probe path.
  -- Retry on candidate-name collision; only give up once 5 distinct
  -- candidates were either already present or refused the open.
  local MAX_PROBE_ATTEMPTS = 5
  for attempt = 1, MAX_PROBE_ATTEMPTS do
    local probe = path_join(
      output_dir,
      ".streetlight_probe_" .. tostring(reaper.time_precise())
        .. "_" .. tostring(attempt))
    -- Belt-and-braces: never io.open("w") a path that already exists,
    -- since "w" truncates. The time_precise+attempt combo collides
    -- vanishingly rarely, but if it does we just try the next candidate
    -- instead of misclassifying a writable dir as not-writable.
    if not reaper.file_exists(probe) then
      local f = io.open(probe, "w")
      if f then
        f:close()
        os.remove(probe)
        return
      end
      -- f == nil here means the open itself failed (permissions, missing
      -- parent dir, etc.) — that's a real "can't write here" signal, not
      -- a name collision. Stop retrying and classify below.
      break
    end
    -- file_exists(probe) was true → candidate name collided with an
    -- existing user file. Try the next candidate; do NOT classify yet.
  end

  -- All probe attempts exhausted (or one open() failed). Distinguish
  -- MISSING from NOT_WRITABLE using whatever signal we still have.
  if reaper.file_exists(output_dir) or dir_appears_to_exist(output_dir) then
    raise("OUTPUT_DIR_NOT_WRITABLE",
      "Could not write probe file into output_dir (regular file, "
        .. "permissions, or other): " .. output_dir)
  end
  raise("OUTPUT_DIR_MISSING",
    "output_dir does not exist: " .. output_dir)
end

-- Collision check covers three paths v0.1 refuses to overwrite:
--   * `<region>.wav`       — the artifact we'd render
--   * `<region>.wav.RPP`   — REAPER's project-copy sidecar (autosaved
--                            next to renders on builds where the
--                            Render-dialog "save copy of project to
--                            outfile" checkbox is on)
--   * `<region>.wav.RPP-bak` — REAPER's prior-sidecar backup
--
-- The two `.RPP*` checks exist so the post-render cleanup in `recheck`
-- (which deletes auto-generated sidecars to honor v0.1's WAV-only
-- artifact contract) can NEVER delete a user file we didn't create.
-- All three surface as the same OUTPUT_FILE_EXISTS code; the message
-- names the colliding path so the agent / user can clean up the right
-- file. Returns the expected WAV path on success.
local function check_no_collision(output_dir, region_name)
  local expected = path_join(output_dir, region_name .. ".wav")
  if reaper.file_exists(expected) then
    raise("OUTPUT_FILE_EXISTS",
      "Output file already exists (v0.1 refuses to overwrite): " .. expected)
  end
  local rpp = expected .. ".RPP"
  if reaper.file_exists(rpp) then
    raise("OUTPUT_FILE_EXISTS",
      "REAPER project-copy sidecar already exists at the render target "
        .. "(v0.1 refuses to overwrite; cleanup-on-success only deletes "
        .. "sidecars THIS render produced): " .. rpp)
  end
  local rppbak = expected .. ".RPP-bak"
  if reaper.file_exists(rppbak) then
    raise("OUTPUT_FILE_EXISTS",
      "REAPER project-copy sidecar backup already exists at the render "
        .. "target (v0.1 refuses to overwrite; cleanup-on-success only "
        .. "deletes sidecars THIS render produced): " .. rppbak)
  end
  return expected
end

-- ─── Constants ─────────────────────────────────────────────────────────────

-- Bridge-internal deadline for the deferred-completion poll, in seconds.
-- The MCP-side timeout (`RENDER_REGION_TIMEOUT_MS` in render-region.ts) is
-- 60_000 ms; we deadline at 55s so RENDER_TIMEOUT lands as the typed code
-- before the MCP-side budget trips BRIDGE_NOT_RUNNING. The 5s buffer
-- covers the poll interval + done-file write time.
local RENDER_INTERNAL_DEADLINE_S = 55

-- ─── render_region handler ────────────────────────────────────────────────

function M.render_region(params, ctx)
  -- (1) Resolve region. Typed errors here mean nothing on disk was
  --     touched yet — settings are untouched, no probe file written.
  local region, code, msg = ctx.refs.resolve_region(
    params.region_id, ctx.last_result)
  if not region then
    raise(code or "REGION_NOT_FOUND", msg or "Region not found")
  end

  -- (1a) Re-validate the resolved region's name. region_create rejects
  --      /, \, NUL, $ at create time, but a user can hand-build a region
  --      in REAPER's UI with a bad name and feed it directly to
  --      render_region. The render path is the one that turns the name
  --      into <output_dir>/<region_name>.wav, so it owns its own defense
  --      against name-shaped exploits (path escape, libc NUL truncation,
  --      RENDER_PATTERN $token expansion). Step 7 B1.
  local name_ok, name_msg = names.validate_region_name(region.name)
  if not name_ok then
    raise("REGION_NAME_INVALID", name_msg)
  end

  -- (2) Validate output_dir BEFORE any render settings touch.
  validate_output_dir(params.output_dir)

  -- (3) Confirm no filename collision.
  local expected_path = check_no_collision(params.output_dir, region.name)

  -- (4) Lazily cache the WAV-24 format blob. If the constant is still the
  --     TBD placeholder, this raises INTERNAL_ERROR with a directive
  --     message — and we haven't touched render settings yet.
  local format_blob = get_render_format_blob()

  -- (5) Snapshot the 10 render settings.
  local snap = snapshot_render_settings()

  -- (6) Apply our settings under pcall so a half-applied state cannot
  --     leak. If the apply itself errors, restore and surface
  --     INTERNAL_ERROR; the snapshot/restore pair is symmetric.
  local set_ok, set_err = pcall(function()
    reaper.GetSetProjectInfo(0, "RENDER_BOUNDSFLAG", 0,             true) -- custom time
    reaper.GetSetProjectInfo(0, "RENDER_STARTPOS",   region.pos,    true)
    reaper.GetSetProjectInfo(0, "RENDER_ENDPOS",     region.rgnend, true)
    reaper.GetSetProjectInfo(0, "RENDER_SRATE",      0,             true) -- project rate
    reaper.GetSetProjectInfo(0, "RENDER_CHANNELS",   2,             true) -- stereo
    reaper.GetSetProjectInfo(0, "RENDER_TAILFLAG",   0,             true)
    reaper.GetSetProjectInfo(0, "RENDER_ADDTOPROJ",  0,             true)
    reaper.GetSetProjectInfo_String(0, "RENDER_FILE",    params.output_dir, true)
    reaper.GetSetProjectInfo_String(0, "RENDER_PATTERN", region.name,       true)
    reaper.GetSetProjectInfo_String(0, "RENDER_FORMAT",  format_blob,       true)
  end)
  if not set_ok then
    pcall(restore_render_settings, snap)
    raise("INTERNAL_ERROR",
      "Failed to apply render settings: " .. tostring(set_err))
  end

  -- (7) Trigger the render. "File: Render project, using the most recent
  --     render settings" — synchronous when REAPER pref "Render in
  --     background" is OFF (blocks main thread until done); asynchronous
  --     when ON (returns immediately, file appears later). Either way we
  --     return the deferred sentinel and let the bridge's tick_deferred
  --     poll for the file.
  reaper.Main_OnCommand(42230, 0)

  -- (8) Build the continuation closures. `restore_once` is the
  --     exactly-once-restore guard the user constraint mandates — both
  --     recheck's success branch and on_timeout fall through to it, and
  --     the bridge's `tick_deferred` invokes `on_terminal` (== restore_once)
  --     unconditionally as a safety net.
  local restored = false
  local restore_once = function()
    if restored then return end
    restored = true
    pcall(restore_render_settings, snap)
  end

  local last_seen_size = nil
  local stable_ticks = 0
  -- Step 7 B3: lifted from 2 → 3 consecutive same-size observations
  -- (~200ms wall-clock window @ 10 Hz vs. the old ~100ms). The extra
  -- tick guards against a slow disk briefly pausing mid-write on a
  -- multi-minute render and being misread as "done". For demo-scale
  -- (sub-1 MB WAVs on fast disks) the added latency is one tick.
  local REQUIRED_STABLE_TICKS = 3
  local recheck = function()
    -- Three consecutive ticks with the same positive size = render done.
    -- At 10 Hz that's a 200ms stability window. "Render in background = OFF"
    -- usually resolves on tick 3 (file already on disk, full size from tick
    -- 1, ticks 2 and 3 confirm stability). "ON" walks through "absent" →
    -- "growing" → "stable" naturally; growing-phase ticks reset the counter.
    local f = io.open(expected_path, "rb")
    if not f then
      last_seen_size = nil
      stable_ticks = 0
      return nil
    end
    local size = f:seek("end")
    f:close()
    if size == 0 then
      last_seen_size = nil
      stable_ticks = 0
      return nil
    end
    if size == last_seen_size then
      stable_ticks = stable_ticks + 1
      if stable_ticks >= REQUIRED_STABLE_TICKS then
        -- Honor the WAV-only artifact contract: if REAPER autosaved a
        -- project-copy sidecar next to the render (because the user
        -- has the Render-dialog "save copy of project to outfile"
        -- checkbox on, which v0.1 cannot suppress via config-var on
        -- stock REAPER 7.71/macOS-arm64 — see header note (1)),
        -- delete it now. `check_no_collision` already proved the
        -- sidecar paths were absent at preflight, so anything sitting
        -- at these paths was authored by THIS render and is safe to
        -- remove. A failed delete is a contract violation we surface
        -- as INTERNAL_ERROR rather than returning success — the
        -- bridge's tick_deferred pcalls `recheck`, so this raise is
        -- translated into a typed terminal envelope by
        -- `template_error_envelope` (see streetlight_bridge.lua).
        -- Cleanup runs BEFORE `restore_once` because the sidecar is
        -- already on disk by render-init time and has no dependency
        -- on the snapshotted RENDER_* settings.
        local rpp = expected_path .. ".RPP"
        if reaper.file_exists(rpp) then
          local ok_rm, rm_err = os.remove(rpp)
          if not ok_rm then
            restore_once()
            raise("INTERNAL_ERROR",
              "Render succeeded but failed to remove REAPER project-copy "
                .. "sidecar at " .. rpp .. ": " .. tostring(rm_err))
          end
        end
        local rppbak = expected_path .. ".RPP-bak"
        if reaper.file_exists(rppbak) then
          local ok_rm, rm_err = os.remove(rppbak)
          if not ok_rm then
            restore_once()
            raise("INTERNAL_ERROR",
              "Render succeeded but failed to remove REAPER project-copy "
                .. "sidecar backup at " .. rppbak .. ": " .. tostring(rm_err))
          end
        end

        restore_once()
        -- changed_ids carries the absolute artifact path. This is the
        -- documented carve-out for render_region; do not copy this shape
        -- into other templates.
        return { changed_ids = { expected_path } }
      end
    else
      last_seen_size = size
      stable_ticks = 1
    end
    return nil
  end

  local on_timeout = function()
    restore_once()
    local f = io.open(expected_path, "rb")
    if not f then
      raise("RENDER_TIMEOUT",
        "Render produced no output at " .. expected_path
          .. " within deadline (" .. RENDER_INTERNAL_DEADLINE_S .. "s)")
    end
    local size = f:seek("end")
    f:close()
    if size == 0 then
      raise("RENDER_FILE_EMPTY",
        "Render output at " .. expected_path .. " is empty at deadline")
    end
    raise("RENDER_TIMEOUT",
      "Render output at " .. expected_path .. " (size " .. size
        .. " B) did not stabilize within deadline ("
        .. RENDER_INTERNAL_DEADLINE_S .. "s)")
  end

  return {
    deferred    = true,
    recheck     = recheck,
    on_timeout  = on_timeout,
    on_terminal = restore_once,
    deadline    = reaper.time_precise() + RENDER_INTERNAL_DEADLINE_S,
  }
end

return M
