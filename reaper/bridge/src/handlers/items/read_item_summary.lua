-- Extracted Wave 1A handler: template.items.read_item_summary.

local function read_item_summary_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable == true,
    details = details or {},
  }
end

local function read_item_summary_command_failed(message, details)
  return read_item_summary_error("COMMAND_FAILED", message, details, false)
end

local function read_item_summary_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function read_item_summary_linear_to_db(value)
  local linear = read_item_summary_finite_number(value)
  if linear == nil then
    return nil
  end
  if linear <= 0 then
    return -150
  end
  return 20 * math.log(linear) / math.log(10)
end

local function read_item_summary_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function read_item_summary_track_index(track)
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
  return nil
end

local function read_item_summary_track_ref_string(track)
  local guid = read_item_summary_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  local index = read_item_summary_track_index(track)
  return index ~= nil and "track:index:" .. tostring(index) or nil
end

local function read_item_summary_item_guid(item)
  local ok_native, native_retval, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and native_retval == true and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function read_item_summary_item_ref_string(item)
  local guid = read_item_summary_item_guid(item)
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
  return nil
end

local function read_item_summary_take_guid(take)
  local ok_native, native_retval, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and native_retval == true and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function read_item_summary_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and read_item_summary_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function read_item_summary_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function read_item_summary_resolve_token(token)
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
    return read_item_summary_find_item_by_guid(guid)
  end
  return nil
end

local function read_item_summary_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return read_item_summary_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return read_item_summary_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return read_item_summary_resolve_token("guid:" .. tostring(identity.value))
  end
  return read_item_summary_resolve_token(ref.ref)
end

local function read_item_summary_require_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  local number = ok and read_item_summary_finite_number(first_number(value)) or nil
  if number == nil then
    return nil, select(2, read_item_summary_command_failed(
      "REAPER did not return a finite Item property for item summary.",
      { api = "GetMediaItemInfo_Value", key = key }
    ))
  end
  return number
end

local function read_item_summary_require_take_number(take, key)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  local number = ok and read_item_summary_finite_number(first_number(value)) or nil
  if number == nil then
    return nil, select(2, read_item_summary_command_failed(
      "REAPER did not return a finite Active Take property for item summary.",
      { api = "GetMediaItemTakeInfo_Value", key = key }
    ))
  end
  return number
end

local function read_item_summary_value(item, include_take_summary)
  local item_ref = read_item_summary_item_ref_string(item)
  if not item_ref then
    return read_item_summary_command_failed(
      "REAPER did not return an authoritative Item identity for item summary.",
      { api = "GetSetMediaItemInfo_String", key = "GUID", fallback_api = "BR_GetMediaItemGUID/CountMediaItems/GetMediaItem" }
    )
  end
  local track = read_item_summary_item_track(item)
  if not track then
    return read_item_summary_command_failed(
      "REAPER did not return the owning Track for item summary.",
      { api = "GetMediaItemTrack", fallback_api = "GetMediaItem_Track" }
    )
  end
  local track_ref = read_item_summary_track_ref_string(track)
  if not track_ref then
    return read_item_summary_command_failed(
      "REAPER did not return an authoritative Track identity for item summary.",
      { api = "GetTrackGUID", fallback_api = "GetMediaTrackInfo_Value/CountTracks/GetTrack" }
    )
  end

  local position_seconds, position_failure = read_item_summary_require_item_number(item, "D_POSITION")
  if position_failure then
    return nil, position_failure
  end
  local length_seconds, length_failure = read_item_summary_require_item_number(item, "D_LENGTH")
  if length_failure then
    return nil, length_failure
  end
  local snap_offset_seconds, snap_failure = read_item_summary_require_item_number(item, "D_SNAPOFFSET")
  if snap_failure then
    return nil, snap_failure
  end
  local fade_in_seconds, fade_in_failure = read_item_summary_require_item_number(item, "D_FADEINLEN")
  if fade_in_failure then
    return nil, fade_in_failure
  end
  local fade_out_seconds, fade_out_failure = read_item_summary_require_item_number(item, "D_FADEOUTLEN")
  if fade_out_failure then
    return nil, fade_out_failure
  end
  local item_volume_linear, item_volume_failure = read_item_summary_require_item_number(item, "D_VOL")
  if item_volume_failure then
    return nil, item_volume_failure
  end
  local volume_db = read_item_summary_linear_to_db(item_volume_linear)
  if volume_db == nil then
    return read_item_summary_command_failed(
      "REAPER returned a non-finite Item D_VOL value for item summary.",
      { api = "GetMediaItemInfo_Value", key = "D_VOL" }
    )
  end

  local summary = {
    item_ref = item_ref,
    track_ref = track_ref,
    position_seconds = position_seconds,
    length_seconds = length_seconds,
    snap_offset_seconds = snap_offset_seconds,
    fade_in_seconds = fade_in_seconds,
    fade_out_seconds = fade_out_seconds,
    volume_db = volume_db,
  }

  if not include_take_summary then
    return summary
  end

  local ok_take_count, take_count_raw = call_reaper("CountTakes", item)
  local take_count = ok_take_count and read_item_summary_finite_number(first_number(take_count_raw)) or nil
  if take_count == nil or take_count < 0 or take_count ~= math.floor(take_count) then
    return read_item_summary_command_failed(
      "REAPER did not return a finite non-negative CountTakes value for item summary.",
      { api = "CountTakes" }
    )
  end
  take_count = math.floor(take_count)
  summary.take_count = take_count

  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take then
    return read_item_summary_command_failed(
      "REAPER rejected GetActiveTake during item summary.",
      { api = "GetActiveTake" }
    )
  end

  if not take then
    if take_count > 0 then
      return read_item_summary_command_failed(
        "REAPER reported Takes but did not return the Active Take for item summary.",
        { api = "GetActiveTake", take_count = take_count }
      )
    end
    summary.active_take_ref = JSON_NULL
    summary.active_take_name = ""
    return summary
  end

  if take_count < 1 then
    return read_item_summary_command_failed(
      "REAPER reported an Active Take while CountTakes was zero.",
      { api = "GetActiveTake", take_count = take_count }
    )
  end

  local take_guid = read_item_summary_take_guid(take)
  if not take_guid then
    return read_item_summary_command_failed(
      "Active Take exists but no authoritative Take GUID was available for item summary.",
      {
        api = "GetSetMediaItemTakeInfo_String",
        key = "GUID",
        fallback_api = "BR_GetMediaItemTakeGUID",
      }
    )
  end

  local ok_name, take_name = call_reaper("GetTakeName", take)
  take_name = ok_name and first_string(take_name) or nil
  if take_name == nil then
    return read_item_summary_command_failed(
      "REAPER did not return the Active Take name for item summary.",
      { api = "GetTakeName" }
    )
  end
  summary.active_take_ref = "take:guid:" .. take_guid
  summary.active_take_name = bounded_string(take_name, 160)

  local take_volume_linear, take_volume_failure = read_item_summary_require_take_number(take, "D_VOL")
  if take_volume_failure then
    return nil, take_volume_failure
  end
  local take_volume_db = read_item_summary_linear_to_db(take_volume_linear)
  if take_volume_db == nil then
    return read_item_summary_command_failed(
      "REAPER returned a non-finite Active Take D_VOL value for item summary.",
      { api = "GetMediaItemTakeInfo_Value", key = "D_VOL" }
    )
  end

  local take_pan, take_pan_failure = read_item_summary_require_take_number(take, "D_PAN")
  if take_pan_failure then
    return nil, take_pan_failure
  end
  local take_pitch_semitones, take_pitch_failure = read_item_summary_require_take_number(take, "D_PITCH")
  if take_pitch_failure then
    return nil, take_pitch_failure
  end
  local playrate, playrate_failure = read_item_summary_require_take_number(take, "D_PLAYRATE")
  if playrate_failure then
    return nil, playrate_failure
  end

  local ok_ppitch, ppitch_raw = call_reaper("GetMediaItemTakeInfo_Value", take, "B_PPITCH")
  local ppitch = ok_ppitch and read_item_summary_finite_number(first_number(ppitch_raw)) or nil
  if ppitch ~= 0 and ppitch ~= 1 then
    return read_item_summary_command_failed(
      "REAPER did not return a native 0/1 B_PPITCH value for item summary.",
      { api = "GetMediaItemTakeInfo_Value", key = "B_PPITCH" }
    )
  end

  summary.take_volume_db = take_volume_db
  summary.take_pan = take_pan
  summary.take_pitch_semitones = take_pitch_semitones
  summary.playrate = playrate
  summary.preserve_pitch = ppitch == 1
  return summary
end

local function read_item_summary(request)
  local item = nil
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      item = read_item_summary_from_ref_object(request.refs[index])
      if item then
        break
      end
    end
  end
  if not item then
    return read_item_summary_error("ITEM_NOT_FOUND", "Item summary requires a resolvable item ref.", {}, true)
  end
  return read_item_summary_value(item, request.params.include_take_summary == true)
end
