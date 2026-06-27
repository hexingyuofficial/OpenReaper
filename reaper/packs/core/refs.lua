-- refs.lua — reference resolution for Streetlight templates.
--
-- The TS side (`packages/core/src/refs.ts`) parses references into a tagged
-- union; the bridge actually resolves them against REAPER state. Step 4
-- lights up `last_result:item:N` and `track:Name/item:N` in addition to the
-- Step 3 `selected:N` and `guid:{...}` resolvers.
--
-- Return convention: handlers expect either
--   (item, nil)               — success
--   (nil, error_code, msg)    — typed failure; bubbles to dispatcher
--
-- Error codes match packages/core/src/errors.ts. Strings only — no objects.

local M = {}

local function parse_selected_index(s)
  -- "selected:N" where N is a non-negative integer.
  local n = s:match("^selected:(%d+)$")
  if not n then return nil end
  return tonumber(n)
end

local function parse_guid_ref(s)
  -- "guid:{...}" — keep the braces, they're part of REAPER's GUID format.
  local g = s:match("^guid:(%b{})$")
  if not g then return nil end
  return g
end

local function parse_last_result_item(s)
  -- "last_result:item:N". Only the `item` entity in v0.1 — `region` and
  -- `track` will join in Step 5 once those mutating templates ship.
  local n = s:match("^last_result:item:(%d+)$")
  if not n then return nil end
  return tonumber(n)
end

local function parse_track_item(s)
  -- "track:Name/item:N". Greedy on the name so embedded `/` survives, but
  -- a literal "/item:0" inside the track name will mis-parse — document as
  -- a v0.1 edge case in ARCHITECTURE.md if it bites.
  local name, n = s:match("^track:(.+)/item:(%d+)$")
  if not name or not n then return nil end
  return name, tonumber(n)
end

local function resolve_selected(index)
  local total = reaper.CountSelectedMediaItems(0)
  if index < 0 or index >= total then
    return nil,
      "ITEM_NOT_FOUND",
      "selected:" .. tostring(index) .. " out of range (selection has "
        .. total .. " item" .. (total == 1 and "" or "s") .. ")"
  end
  local item = reaper.GetSelectedMediaItem(0, index)
  if not item then
    return nil,
      "ITEM_NOT_FOUND",
      "REAPER returned nil for selected:" .. tostring(index)
  end
  return item, nil
end

local function resolve_guid(guid)
  -- Linear scan: O(items in project). REAPER 7 exposes no faster API for
  -- GUID lookup. Profiling has not flagged this yet; revisit if it does.
  local count = reaper.CountMediaItems(0)
  for i = 0, count - 1 do
    local item = reaper.GetMediaItem(0, i)
    local _, this_guid = reaper.GetSetMediaItemInfo_String(item, "GUID", "", false)
    if this_guid == guid then
      return item, nil
    end
  end
  return nil, "ITEM_NOT_FOUND", "No item with GUID " .. tostring(guid)
end

local function resolve_last_result_item(index, last_result)
  -- The dispatcher resets LAST_RESULT.items to the most recent successful
  -- mutating call's `changed_ids`. Reads after a non-mutating call (ping,
  -- get_state) still see the previous mutation's output — that's intended
  -- per the Step 4 pitfalls note "last_result not handling out-of-order
  -- tools" in IMPLEMENTATION_PLAN.md.
  if not last_result or type(last_result.items) ~= "table" then
    return nil,
      "REF_INVALID",
      "last_result is unavailable in this bridge session"
  end
  local total = #last_result.items
  if total == 0 then
    return nil,
      "REF_INVALID",
      "last_result:item:" .. tostring(index)
        .. " — no mutating call has produced changed_ids yet this session"
  end
  if index < 0 or index >= total then
    return nil,
      "ITEM_NOT_FOUND",
      "last_result:item:" .. tostring(index) .. " out of range "
        .. "(last_result has " .. total
        .. " item" .. (total == 1 and "" or "s") .. ")"
  end
  local entry = last_result.items[index + 1] -- Lua 1-indexed
  -- entry is the "guid:{...}" string the dispatcher captured from the
  -- previous handler's changed_ids. Re-parse and resolve so that an item
  -- deleted between calls surfaces ITEM_NOT_FOUND from resolve_guid,
  -- rather than handing back a stale handle.
  if type(entry) ~= "string" then
    return nil,
      "INTERNAL_ERROR",
      "last_result.items[" .. tostring(index + 1)
        .. "] is " .. type(entry) .. ", expected string"
  end
  local guid = parse_guid_ref(entry)
  if not guid then
    return nil,
      "INTERNAL_ERROR",
      "last_result entry is not a guid ref: " .. tostring(entry)
  end
  return resolve_guid(guid)
end

local function resolve_track_item(track_name, index)
  -- Linear scan over tracks — REAPER 7 has no `GetTrackByName`. If two
  -- tracks share the same name, the first match wins. Duplicate track
  -- names are valid in REAPER; agents that care should use `guid:` refs
  -- once they have a track GUID, or rename the track to be unique.
  local track_count = reaper.CountTracks(0)
  for i = 0, track_count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if name == track_name then
      local item_count = reaper.CountTrackMediaItems(track)
      if index < 0 or index >= item_count then
        return nil,
          "ITEM_NOT_FOUND",
          "track:" .. track_name .. "/item:" .. tostring(index)
            .. " out of range (track has " .. item_count
            .. " item" .. (item_count == 1 and "" or "s") .. ")"
      end
      local item = reaper.GetTrackMediaItem(track, index)
      if not item then
        return nil,
          "ITEM_NOT_FOUND",
          "REAPER returned nil for track:" .. track_name
            .. "/item:" .. tostring(index)
      end
      return item, nil
    end
  end
  return nil, "TRACK_NOT_FOUND", "No track named '" .. track_name .. "'"
end

-- Resolve a logical item reference to a REAPER MediaItem handle.
--
-- The `last_result` arg is the dispatcher's per-session memory of the most
-- recent mutating command's outputs. Step 4 reads it for the
-- `last_result:item:N` ref kind; older callers passing `nil` still work
-- (the resolver returns REF_INVALID with a useful message).
function M.resolve_item(ref, last_result)
  if type(ref) ~= "string" or ref == "" then
    return nil, "REF_INVALID", "Item reference must be a non-empty string"
  end

  local sel_idx = parse_selected_index(ref)
  if sel_idx ~= nil then return resolve_selected(sel_idx) end

  local guid = parse_guid_ref(ref)
  if guid ~= nil then return resolve_guid(guid) end

  local lr_idx = parse_last_result_item(ref)
  if lr_idx ~= nil then return resolve_last_result_item(lr_idx, last_result) end

  local tname, tidx = parse_track_item(ref)
  if tname ~= nil then return resolve_track_item(tname, tidx) end

  -- `last_result:region:N` and `last_result:track:N` parse on the TS side
  -- but only `item` is wired here in v0.1. Step 5 / 6 light them up.
  if ref:match("^last_result:") then
    return nil,
      "REF_INVALID",
      "last_result entity not implemented in v0.1: " .. ref
  end

  return nil, "REF_INVALID", "Unrecognized item reference: " .. ref
end

return M
