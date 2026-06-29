-- templates/media.lua — filesystem-touching templates.
--
-- v0.1 only has `media_import` in this module. The split from `item.lua`
-- exists because media_import is risk=filesystem and reads a path off
-- disk; keeping it in its own file documents that this is the boundary
-- where a Lua handler talks to the OS.
--
-- Handler shape matches templates/item.lua:
--   function(params, ctx) -> { changed_ids = {...} }
-- Errors raise via `error({ code, message })`.

local M = {}

local function raise(code, message)
  error({ code = code, message = message })
end

local function file_is_readable(path)
  local f = io.open(path, "rb")
  if not f then return false end
  f:close()
  return true
end

local function item_guid(item)
  local _, guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
  if not guid or guid == "" then
    raise("INTERNAL_ERROR", "REAPER returned no GUID for a media item")
  end
  return guid
end

-- Snapshot the current track selection. InsertMedia inserts onto the
-- currently selected tracks, so we have to temporarily pin selection to
-- the target track and put the user's selection back afterwards.
local function snapshot_selected_tracks()
  local snap = {}
  local count = reaper.CountSelectedTracks(0)
  for i = 0, count - 1 do
    snap[#snap + 1] = reaper.GetSelectedTrack(0, i)
  end
  return snap
end

local function restore_selected_tracks(snap)
  -- SetTrackSelected is additive — clear everything first, then re-select.
  local total = reaper.CountTracks(0)
  for i = 0, total - 1 do
    reaper.SetTrackSelected(reaper.GetTrack(0, i), false)
  end
  for _, track in ipairs(snap) do
    -- Track may have been deleted between snapshot and restore — REAPER
    -- tolerates the call but does nothing in that case.
    reaper.SetTrackSelected(track, true)
  end
end

-- Snapshot the current media-item selection. InsertMedia auto-selects the
-- newly inserted item (deselecting whatever the user had selected), so we
-- restore the prior item selection symmetrically with the track selection.
-- Newly imported items are NOT added to the restored selection — the
-- contract is "restore what was selected before the call"; agents that need
-- the new item can grab it from `last_result:item:N`.
local function snapshot_selected_items()
  local snap = {}
  local count = reaper.CountSelectedMediaItems(0)
  for i = 0, count - 1 do
    snap[#snap + 1] = reaper.GetSelectedMediaItem(0, i)
  end
  return snap
end

local function restore_selected_items(snap)
  -- SelectAllMediaItems(0, false) deselects every item project-wide in
  -- one call; faster than iterating tracks. Then re-select the snapshot.
  reaper.SelectAllMediaItems(0, false)
  for _, item in ipairs(snap) do
    -- Item may have been deleted between snapshot and restore — guard with
    -- ValidatePtr2 since SetMediaItemSelected on a freed pointer crashes.
    if reaper.ValidatePtr2(0, item, "MediaItem*") then
      reaper.SetMediaItemSelected(item, true)
    end
  end
end

-- Capture every item GUID on `track` into a set keyed by GUID string.
-- Used to diff the track's items before/after InsertMedia so we can
-- identify the inserted item(s) by GUID rather than relying on
-- `GetTrackMediaItem(track, after_count - 1)`. The "last index = newest"
-- assumption is false: `GetTrackMediaItem` returns items in timeline
-- (position) order, so a track with a pre-existing item past the edit
-- cursor would make us mis-identify the insertion.
local function snapshot_track_item_guids(track)
  local set = {}
  local count = reaper.CountTrackMediaItems(track)
  for i = 0, count - 1 do
    local it = reaper.GetTrackMediaItem(track, i)
    set[item_guid(it)] = true
  end
  return set
end

local function find_new_items(track, before_guids)
  local new_items = {}
  local count = reaper.CountTrackMediaItems(track)
  for i = 0, count - 1 do
    local it = reaper.GetTrackMediaItem(track, i)
    local g = item_guid(it)
    if not before_guids[g] then
      new_items[#new_items + 1] = { item = it, guid = g }
    end
  end
  return new_items
end

-- media_import: load a file from disk into a new item on the target track.
--
-- Flow:
--   1. Probe the path with io.open — surface MEDIA_NOT_FOUND BEFORE we
--      touch REAPER's selection. Bad agent inputs do not mutate state.
--   2. Snapshot the user's track selection AND item selection.
--   3. Snapshot the target track's existing item GUIDs.
--   4. SetOnlyTrackSelected(target). InsertMedia mode=0 = "Add to current
--      track" so it inserts onto exactly the track we just selected.
--   5. ALWAYS restore selection (tracks + items) before inspecting the
--      result — bridge errors should not leak the temporary selection
--      mutation back to the user.
--   6. Diff target track's item GUIDs to identify the inserted item(s).
--      Multiple new GUIDs (e.g. multi-channel split) are all returned;
--      zero new GUIDs is INTERNAL_ERROR (InsertMedia lied about success).
--   7. SetMediaItemInfo_Value(item, "D_POSITION", position) on each new
--      item. v0.1 smoke uses a plain .wav and expects exactly one.
--
-- InsertMedia returns the number of items added; 0 means it refused (often
-- because of file format issues REAPER didn't surface explicitly). We
-- translate that to MEDIA_NOT_FOUND too — from the agent's perspective the
-- file may exist on disk but REAPER couldn't decode it.
function M.media_import(params, ctx)
  if not file_is_readable(params.path) then
    raise("MEDIA_NOT_FOUND", "Cannot read media file at path: " .. tostring(params.path))
  end

  local target_track, tcode, tmsg = ctx.refs.resolve_track(
    params.track_id, ctx.last_result
  )
  if not target_track then
    raise(tcode or "TRACK_NOT_FOUND", tmsg or "Target track not found")
  end

  local prior_tracks = snapshot_selected_tracks()
  local prior_items  = snapshot_selected_items()
  local before_guids = snapshot_track_item_guids(target_track)

  reaper.SetOnlyTrackSelected(target_track)
  local inserted = reaper.InsertMedia(params.path, 0)

  -- Restore selection BEFORE inspecting the InsertMedia result. If anything
  -- below raises (InsertMedia == 0, GUID diff empty, etc.), the user's
  -- selection must already be back where it was.
  restore_selected_tracks(prior_tracks)
  restore_selected_items(prior_items)

  if inserted == 0 then
    raise(
      "MEDIA_NOT_FOUND",
      "REAPER refused to insert media at path: " .. tostring(params.path)
        .. " (unsupported format or unreadable)"
    )
  end

  local new_items = find_new_items(target_track, before_guids)
  if #new_items == 0 then
    raise(
      "INTERNAL_ERROR",
      "InsertMedia returned " .. tostring(inserted)
        .. " but no new item GUID found on target track"
    )
  end

  -- Set D_POSITION on every newly inserted item. v0.1 expects 1 for a
  -- plain .wav; multi-channel files that REAPER splits into N items get N
  -- entries all stamped to the same position. If that's wrong for some
  -- agent workflow, surfacing all N changed_ids is still strictly more
  -- honest than silently picking one.
  local changed_ids = {}
  for _, entry in ipairs(new_items) do
    reaper.SetMediaItemInfo_Value(entry.item, "D_POSITION", params.position)
    changed_ids[#changed_ids + 1] = "guid:" .. entry.guid
  end
  reaper.UpdateArrange()

  return { changed_ids = changed_ids }
end

return M
