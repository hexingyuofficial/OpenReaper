-- Extracted Wave 1A handler: template.items.resolve_item_ref.

local function resolve_item_ref_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function resolve_item_ref_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function resolve_item_ref_track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, candidate = call_reaper("GetTrack", 0, index)
    if ok_track and candidate == track then
      return index
    end
  end
  return 0
end

local function resolve_item_ref_track_ref_string(track)
  local guid = resolve_item_ref_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(resolve_item_ref_track_index(track))
end

local function resolve_item_ref_item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function resolve_item_ref_item_ref_string(item)
  local guid = resolve_item_ref_item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return "item:unknown"
end

local function resolve_item_ref_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and resolve_item_ref_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function resolve_item_ref_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function resolve_item_ref_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^item:selected:(%d+)$")
  if selected_index then
    local ok, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    return ok and item or nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^item:index:(%d+)$")
  if index then
    local ok, item = call_reaper("GetMediaItem", 0, tonumber(index))
    return ok and item or nil
  end

  local guid = token:match("^guid:(.+)$") or token:match("^item:guid:(.+)$")
  if guid then
    return resolve_item_ref_find_item_by_guid(guid)
  end
  return nil
end

local function resolve_item_ref_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function resolve_item_ref_summary(item)
  local track = resolve_item_ref_item_track(item)
  return {
    item_ref = resolve_item_ref_item_ref_string(item),
    track_ref = track and resolve_item_ref_track_ref_string(track) or JSON_NULL,
    position_seconds = resolve_item_ref_number(item, "D_POSITION"),
    length_seconds = resolve_item_ref_number(item, "D_LENGTH"),
    snap_offset_seconds = resolve_item_ref_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = resolve_item_ref_number(item, "D_FADEINLEN"),
    fade_out_seconds = resolve_item_ref_number(item, "D_FADEOUTLEN"),
  }
end

local function resolve_item_ref(request)
  local item = resolve_item_ref_token(request.params.ref)
  if not item then
    return resolve_item_ref_error("ITEM_NOT_FOUND", "Item ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
  end
  return resolve_item_ref_summary(item)
end
