-- templates/track.lua — track-scoped templates.
--
-- Handler convention matches templates/item.lua:
--   `function(params, ctx) -> { changed_ids = {...} }`
--   `params` already passed the TS Zod schema.
--   `ctx` has `refs`, `last_result`, `json` (sentinel access).
--
-- Errors raise via `error({ code = ..., message = ... })`.
-- Dispatcher translates into typed envelopes.
--
-- changed_ids format: `guid:{TRACK-GUID}` — same shape as item refs, just
-- looked up against tracks instead of items. The manifest entry's
-- `entity_kind = "track"` is what routes these into `LAST_RESULT.tracks`.

local M = {}

local function raise(code, message)
  error({ code = code, message = message })
end

local function get_track_guid_ref(track)
  local _, guid = reaper.GetSetMediaTrackInfo_String(track, "GUID", "", false)
  if not guid or guid == "" then
    raise("INTERNAL_ERROR", "REAPER returned no GUID for the mutated track")
  end
  return "guid:" .. guid
end

local function find_track_by_name(name)
  -- Same scan rules as refs.lua resolve_track_by_name; copied here to keep
  -- the template self-contained (refs.lua is the resolver for user-supplied
  -- refs; reuse-existing is an internal lookup).
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, n = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if n == name then return track end
  end
  return nil
end

-- track_create: insert a new track and name it.
--
-- `params.index` is the desired insert position; when nil, we append.
-- REAPER's `InsertTrackAtIndex(idx, wantDefaults)` inserts BEFORE idx;
-- passing the current track count appends. `wantDefaults=true` so the
-- track inherits the user's defaults (volume, FX chain, etc.).
function M.track_create(params, ctx)
  if params.reuse_existing then
    local existing = find_track_by_name(params.name)
    if existing then
      return { changed_ids = { get_track_guid_ref(existing) } }
    end
  end

  local total = reaper.CountTracks(0)
  local insert_at = total
  if type(params.index) == "number" then
    insert_at = math.max(0, math.min(total, math.floor(params.index)))
  end

  reaper.InsertTrackAtIndex(insert_at, true)
  local track = reaper.GetTrack(0, insert_at)
  if not track then
    raise("INTERNAL_ERROR", "InsertTrackAtIndex did not produce a track at index " .. tostring(insert_at))
  end

  -- Set the name. Returns (bool ok, string out); we trust the input passed
  -- Zod's min(1) check.
  reaper.GetSetMediaTrackInfo_String(track, "P_NAME", params.name, true)

  reaper.TrackList_AdjustWindows(false)
  reaper.UpdateArrange()

  return { changed_ids = { get_track_guid_ref(track) } }
end

-- track_rename: resolve a track and set its P_NAME.
function M.track_rename(params, ctx)
  local track, code, msg = ctx.refs.resolve_track(params.track_id, ctx.last_result)
  if not track then raise(code or "TRACK_NOT_FOUND", msg or "Track not found") end

  reaper.GetSetMediaTrackInfo_String(track, "P_NAME", params.name, true)
  -- Track name shows in TCP/MCP headers — refresh to make it visible
  -- without the user having to click around.
  reaper.TrackList_AdjustWindows(false)

  return { changed_ids = { get_track_guid_ref(track) } }
end

return M
