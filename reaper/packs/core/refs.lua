-- refs.lua — reference resolution for Streetlight templates.
--
-- The TS side (`packages/core/src/refs.ts`) parses references into a tagged
-- union; the bridge actually resolves them against REAPER state.
--
-- Item refs (Step 3 + 4a):
--   selected:N            — Nth item in the selection
--   guid:{...}            — item by GUID (linear scan)
--   last_result:item:N    — Nth entry from LAST_RESULT.items
--   track:Name/item:N     — Nth item on a track named "Name"
--
-- Track refs (Step 4b):
--   track:Name            — track with name "Name" (first match wins)
--   guid:{...}            — track by GUID (linear scan over tracks)
--   last_result:track:N   — Nth entry from LAST_RESULT.tracks
--
-- Region refs (Step 5):
--   region:Name           — region with name "Name" (first match wins).
--                           Returns a `{ index, pos, rgnend, name }` table
--                           (NOT a bare REAPER handle) — regions have no
--                           native MediaItem-style handle. Index is the
--                           CURRENT integer position; do not cache it
--                           across marker deletes.
--   last_result:region:N  — Nth entry from LAST_RESULT.regions. The entries
--                           are name-shaped strings ("region:NAME"), not
--                           GUID-shaped — see templates/region.lua for why.
--   guid:{...}            — parses on the TS side but the resolver rejects
--                           with REF_INVALID + a "regions don't support
--                           GUID refs in v0.1" message. REAPER 7 has no
--                           native region GUID API.
--
-- Return convention: handlers expect either
--   (handle, nil)              — success
--   (nil, error_code, msg)     — typed failure; bubbles to dispatcher
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

local function parse_last_result_track(s)
  -- "last_result:track:N". Wakes up alongside Step 4b's track_create /
  -- track_rename templates.
  local n = s:match("^last_result:track:(%d+)$")
  if not n then return nil end
  return tonumber(n)
end

local function parse_last_result_region(s)
  -- "last_result:region:N". Step 5: region_create populates
  -- LAST_RESULT.regions with name-shaped refs.
  local n = s:match("^last_result:region:(%d+)$")
  if not n then return nil end
  return tonumber(n)
end

local function parse_region_name(s)
  -- "region:Name". Mirrors parse_track_name: greedy on the name. Region
  -- names containing `/` were rejected at region_create time, so we don't
  -- need a parse_track_item-style escape hatch here.
  local name = s:match("^region:(.+)$")
  return name
end

local function parse_track_name(s)
  -- "track:Name" (without `/item:N`). Must NOT match `track:Name/item:N`
  -- — that branch is owned by parse_track_item. A literal "/item:" inside
  -- a track name is the same v0.1 edge case parse_track_item already
  -- documents.
  if s:find("/item:") then return nil end
  local name = s:match("^track:(.+)$")
  return name
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

local function resolve_track_by_name(track_name)
  -- Same scan rules as resolve_track_item: first match wins, no faster
  -- API on REAPER 7. Returns the track handle directly (not an item).
  local track_count = reaper.CountTracks(0)
  for i = 0, track_count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
    if name == track_name then return track, nil end
  end
  return nil, "TRACK_NOT_FOUND", "No track named '" .. track_name .. "'"
end

local function resolve_track_guid(guid)
  -- Track-side counterpart of resolve_guid (which scans items). REAPER 7
  -- exposes track GUIDs the same way items do.
  local count = reaper.CountTracks(0)
  for i = 0, count - 1 do
    local track = reaper.GetTrack(0, i)
    local _, this_guid = reaper.GetSetMediaTrackInfo_String(track, "GUID", "", false)
    if this_guid == guid then return track, nil end
  end
  return nil, "TRACK_NOT_FOUND", "No track with GUID " .. tostring(guid)
end

local function resolve_last_result_track(index, last_result)
  if not last_result or type(last_result.tracks) ~= "table" then
    return nil,
      "REF_INVALID",
      "last_result is unavailable in this bridge session"
  end
  local total = #last_result.tracks
  if total == 0 then
    return nil,
      "REF_INVALID",
      "last_result:track:" .. tostring(index)
        .. " — no mutating call has produced changed tracks yet this session"
  end
  if index < 0 or index >= total then
    return nil,
      "TRACK_NOT_FOUND",
      "last_result:track:" .. tostring(index) .. " out of range "
        .. "(last_result has " .. total
        .. " track" .. (total == 1 and "" or "s") .. ")"
  end
  local entry = last_result.tracks[index + 1]
  if type(entry) ~= "string" then
    return nil,
      "INTERNAL_ERROR",
      "last_result.tracks[" .. tostring(index + 1)
        .. "] is " .. type(entry) .. ", expected string"
  end
  local guid = parse_guid_ref(entry)
  if not guid then
    return nil,
      "INTERNAL_ERROR",
      "last_result track entry is not a guid ref: " .. tostring(entry)
  end
  return resolve_track_guid(guid)
end

local function resolve_region_name(name)
  -- Scan project markers; first REGION (not plain marker) with matching
  -- name wins. Returns a synthetic handle `{ index, pos, rgnend, name }` —
  -- regions have no MediaItem-style native handle in REAPER 7. Callers
  -- (Step 6's render_region) read `pos`/`rgnend` directly; nobody should
  -- cache `index` because indices renumber on any marker delete.
  local i = 0
  while true do
    local retval, isrgn, pos, rgnend, n = reaper.EnumProjectMarkers3(0, i)
    if retval == 0 then break end
    if isrgn and n == name then
      return { index = i, pos = pos, rgnend = rgnend, name = n }, nil
    end
    i = i + 1
  end
  return nil, "REGION_NOT_FOUND", "No region named '" .. name .. "'"
end

local function resolve_last_result_region(index, last_result)
  if not last_result or type(last_result.regions) ~= "table" then
    return nil,
      "REF_INVALID",
      "last_result is unavailable in this bridge session"
  end
  local total = #last_result.regions
  if total == 0 then
    return nil,
      "REF_INVALID",
      "last_result:region:" .. tostring(index)
        .. " — no mutating call has produced changed regions yet this session"
  end
  if index < 0 or index >= total then
    return nil,
      "REGION_NOT_FOUND",
      "last_result:region:" .. tostring(index) .. " out of range "
        .. "(last_result has " .. total
        .. " region" .. (total == 1 and "" or "s") .. ")"
  end
  local entry = last_result.regions[index + 1]
  if type(entry) ~= "string" then
    return nil,
      "INTERNAL_ERROR",
      "last_result.regions[" .. tostring(index + 1)
        .. "] is " .. type(entry) .. ", expected string"
  end
  -- Region changed_ids are name-shaped ("region:NAME"), not guid-shaped.
  -- See templates/region.lua for the rationale (no native GUID API).
  local name = parse_region_name(entry)
  if not name then
    return nil,
      "INTERNAL_ERROR",
      "last_result region entry is not a region:Name ref: " .. tostring(entry)
  end
  return resolve_region_name(name)
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

  -- A bare `track:Name` or `last_result:track:N` is a TRACK reference; it
  -- doesn't resolve to an item. Tell the caller specifically so they don't
  -- have to guess.
  if ref:match("^track:") and not ref:find("/item:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a track reference; expected an item reference"
  end
  if ref:match("^last_result:track:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a track reference; expected an item reference"
  end

  -- Region-shaped refs (Step 5). Closes the third leg of the cross-type
  -- triangle so an agent typing a region ref into an item slot sees what
  -- it actually fed in, not a generic "unrecognized" message.
  if ref:match("^region:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a region reference; expected an item reference"
  end
  if ref:match("^last_result:region:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a region reference; expected an item reference"
  end

  -- Anything else under `last_result:` is an unimplemented entity (no
  -- mutating template ships for it in v0.1).
  if ref:match("^last_result:") then
    return nil,
      "REF_INVALID",
      "last_result entity not implemented in v0.1: " .. ref
  end

  return nil, "REF_INVALID", "Unrecognized item reference: " .. ref
end

-- Resolve a logical track reference to a REAPER MediaTrack handle.
--
-- Mirrors resolve_item: same guid / last_result / name dispatch shape.
-- Returns (track, nil) on success; (nil, code, message) on failure.
function M.resolve_track(ref, last_result)
  if type(ref) ~= "string" or ref == "" then
    return nil, "REF_INVALID", "Track reference must be a non-empty string"
  end

  local guid = parse_guid_ref(ref)
  if guid ~= nil then return resolve_track_guid(guid) end

  local lr_idx = parse_last_result_track(ref)
  if lr_idx ~= nil then return resolve_last_result_track(lr_idx, last_result) end

  local tname = parse_track_name(ref)
  if tname ~= nil then return resolve_track_by_name(tname) end

  -- An item-shaped reference is a useful negative signal for the agent.
  if ref:match("^selected:") or ref:match("^last_result:item:")
     or ref:match("/item:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is an item reference; expected a track reference"
  end

  -- Region-shaped refs (Step 5). Same closure as resolve_item — the cross-
  -- type triangle returns helpful "you meant region" messages now.
  if ref:match("^region:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a region reference; expected a track reference"
  end
  if ref:match("^last_result:region:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a region reference; expected a track reference"
  end

  return nil, "REF_INVALID", "Unrecognized track reference: " .. ref
end

-- Resolve a logical region reference to a `{ index, pos, rgnend, name }`
-- table. Regions have no MediaItem-style native handle in REAPER 7, so
-- the resolver returns the data callers need (Step 6's render_region
-- reads `pos`/`rgnend`) instead of a bare opaque handle.
--
-- Region GUID refs (`guid:{...}`) parse on the TS side but resolve here
-- as REF_INVALID — REAPER 7 has no native region GUID API. The Lua
-- message names that limitation so agents stop searching for GUIDs.
function M.resolve_region(ref, last_result)
  if type(ref) ~= "string" or ref == "" then
    return nil, "REF_INVALID", "Region reference must be a non-empty string"
  end

  local guid = parse_guid_ref(ref)
  if guid ~= nil then
    return nil,
      "REF_INVALID",
      "regions don't support GUID refs in v0.1; use region:Name or last_result:region:N"
  end

  local lr_idx = parse_last_result_region(ref)
  if lr_idx ~= nil then return resolve_last_result_region(lr_idx, last_result) end

  local rname = parse_region_name(ref)
  if rname ~= nil then return resolve_region_name(rname) end

  -- Cross-type: item- and track-shaped refs surface as REF_INVALID with the
  -- entity they LOOK like, so agents fix the slot they typed into.
  if ref:match("^selected:") or ref:match("^last_result:item:")
     or ref:match("/item:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is an item reference; expected a region reference"
  end
  if ref:match("^track:") or ref:match("^last_result:track:") then
    return nil,
      "REF_INVALID",
      "'" .. ref .. "' is a track reference; expected a region reference"
  end

  return nil, "REF_INVALID", "Unrecognized region reference: " .. ref
end

return M
