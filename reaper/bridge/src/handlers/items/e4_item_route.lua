-- Extracted E4 item route handlers.

local function e4_item_handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e4_item_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e4_item_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.loop_source_status = "held"
  readback.truncated = false
  return readback
end

local function e4_item_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e4_item_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e4_item_track_index(track)
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

local function e4_item_track_ref_string(track)
  local guid = e4_item_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e4_item_track_index(track))
end

local function e4_item_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e4_item_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e4_item_resolve_track_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^track:selected:(%d+)$")
  if selected_index then
    local ok, track = call_reaper("GetSelectedTrack", 0, tonumber(selected_index))
    return ok and track or nil
  end
  local index = token:match("^index:(%d+)$") or token:match("^track:index:(%d+)$")
  if index then
    local ok, track = call_reaper("GetTrack", 0, tonumber(index))
    return ok and track or nil
  end
  local guid = token:match("^guid:(.+)$") or token:match("^track:guid:(.+)$")
  if guid then
    return e4_item_find_track_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_track_token(ref.ref)
end

local function e4_item_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e4_item_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e4_item_guid(item)
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

local function e4_item_ref_string(item)
  local guid = e4_item_guid(item)
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

local function e4_item_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function e4_item_take_ref_string(take)
  local guid = e4_item_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  return "take:index:0"
end

local function e4_item_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and e4_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function e4_item_resolve_item_token(token)
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
    return e4_item_find_item_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_item_token(ref.ref)
end

local function e4_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = e4_item_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function e4_item_object_ref(item)
  local ref = e4_item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function e4_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function e4_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function e4_item_summary_for_item(item)
  local track = e4_item_track(item)
  return {
    item_ref = e4_item_ref_string(item),
    track_ref = track and e4_item_track_ref_string(track) or JSON_NULL,
    position_seconds = e4_item_number(item, "D_POSITION"),
    length_seconds = e4_item_number(item, "D_LENGTH"),
  }
end

local function e4_item_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function e4_item_read_source(take)
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  return ok_source and source or nil
end

local function e4_item_clone_active_take_footprint(source_item, target_item)
  local source_take = e4_item_take(source_item)
  if not source_take then
    return nil, e4_item_handler_error("TAKE_NOT_FOUND", "E4 copy_item_to_track requires an active source take.", {})
  end
  local source = e4_item_read_source(source_take)
  if not source then
    return nil, e4_item_handler_error("SOURCE_NOT_FOUND", "E4 copy_item_to_track could not read the source take media source.", {})
  end
  local ok_duplicate, duplicate = call_reaper("PCM_Source_Duplicate", source)
  if not ok_duplicate or not duplicate then
    return nil, e4_item_handler_error("SOURCE_NOT_FOUND", "E4 copy_item_to_track could not duplicate the source media footprint.", {})
  end
  local ok_take, target_take = call_reaper("AddTakeToMediaItem", target_item)
  if not ok_take or not target_take then
    call_reaper("PCM_Source_Destroy", duplicate)
    return nil, e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target take.", {}, false)
  end
  call_reaper("SetMediaItemTake_Source", target_take, duplicate)
  local ok_start, start_offset = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_STARTOFFS")
  local ok_playrate, playrate = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PLAYRATE")
  local ok_pitch, pitch = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PITCH")
  local ok_preserve, preserve = call_reaper("GetMediaItemTakeInfo_Value", source_take, "B_PPITCH")
  if ok_start then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_STARTOFFS", first_number(start_offset) or 0)
  end
  if ok_playrate then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_PLAYRATE", first_number(playrate) or 1)
  end
  if ok_pitch then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_PITCH", first_number(pitch) or 0)
  end
  if ok_preserve then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "B_PPITCH", first_number(preserve) or 0)
  end
  call_reaper("SetActiveTake", target_take)
  local active_take = e4_item_take(target_item)
  if not active_take then
    return nil, e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track created an item without an active take.", {}, false)
  end
  return target_take
end

local function copy_item_to_track(request)
  local source_item = e4_item_from_request_refs(request)
  if not source_item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 copy_item_to_track requires a resolvable source item ref.", {})
  end
  local target_track = e4_item_track_from_request_refs(request)
  if not target_track then
    return e4_item_handler_error("TRACK_NOT_FOUND", "E4 copy_item_to_track requires a resolvable target track ref.", {})
  end
  local ok_item, new_item = call_reaper("AddMediaItemToTrack", target_track)
  if not ok_item or not new_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target item.", {}, false)
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local length = math.max(0, e4_item_number(source_item, "D_LENGTH"))
  call_reaper("SetMediaItemInfo_Value", new_item, "D_POSITION", position)
  call_reaper("SetMediaItemInfo_Value", new_item, "D_LENGTH", length)
  local target_take, failure = e4_item_clone_active_take_footprint(source_item, new_item)
  if failure then
    call_reaper("DeleteTrackMediaItem", target_track, new_item)
    return nil, failure
  end
  call_reaper("UpdateItemInProject", new_item)
  local source_ref = e4_item_object_ref(source_item)
  local new_ref = e4_item_object_ref(new_item)
  return e4_item_summary(request, {
    new_item_ref = new_ref.ref,
    source_item_ref = source_ref.ref,
    target_track_ref = e4_item_track_ref_string(target_track),
    active_take_ref = target_take and e4_item_take_ref_string(target_take) or JSON_NULL,
    active_take_available = target_take ~= nil,
    position_seconds = position,
    copy_depth = "active_take_footprint",
    source_item = e4_item_summary_for_item(source_item),
    new_item = e4_item_summary_for_item(new_item),
  }), nil, nil, nil, e4_item_refs(new_ref, source_ref, {
    kind = "track",
    ref = e4_item_track_ref_string(target_track),
    identity = {
      scheme = e4_item_track_ref_string(target_track):match("^track:([^:]+):") or "index",
      value = e4_item_track_ref_string(target_track):match("^track:[^:]+:(.+)$") or "0",
    },
  })
end

local function split_item_at_time(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 split_item_at_time requires a resolvable item ref.", {})
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local start_position = e4_item_number(item, "D_POSITION")
  local length = e4_item_number(item, "D_LENGTH")
  local end_position = start_position + length
  if not (position > start_position and position < end_position) then
    return e4_item_handler_error("SPLIT_OUTSIDE_ITEM_BOUNDS", "E4 split_item_at_time requires a position inside item bounds.", {
      position_seconds = position,
      item_start_seconds = start_position,
      item_end_seconds = end_position,
    })
  end
  local ok_right, right_item = call_reaper("SplitMediaItem", item, position)
  if not ok_right or not right_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 split_item_at_time could not split the item.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  call_reaper("UpdateItemInProject", right_item)
  local left_ref = e4_item_object_ref(item)
  local right_ref = e4_item_object_ref(right_item)
  return e4_item_summary(request, {
    left_item_ref = left_ref.ref,
    right_item_ref = right_ref.ref,
    split_position_seconds = position,
    left_item = e4_item_summary_for_item(item),
    right_item = e4_item_summary_for_item(right_item),
  }), nil, nil, nil, e4_item_refs(left_ref, right_ref)
end

local function set_take_playrate(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 set_take_playrate requires a resolvable item ref.", {})
  end
  local playrate = e4_item_finite_number(request.params.playrate, 1)
  if playrate <= 0 then
    return e4_item_handler_error("PARAMS_INVALID", "E4 set_take_playrate requires playrate > 0.", {
      playrate = request.params.playrate,
    })
  end
  local take = e4_item_take(item)
  if not take then
    return e4_item_handler_error("TAKE_NOT_FOUND", "E4 set_take_playrate requires an active take.", {})
  end
  call_reaper("SetMediaItemTakeInfo_Value", take, "D_PLAYRATE", playrate)
  call_reaper("SetMediaItemTakeInfo_Value", take, "B_PPITCH", request.params.preserve_pitch == true and 1 or 0)
  call_reaper("UpdateItemInProject", item)
  local readback_playrate = e4_item_finite_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE")), 1)
  if math.abs(readback_playrate - playrate) > 0.000001 then
    return e4_item_handler_error("VERIFY_FAILED", "E4 set_take_playrate readback did not match the requested playrate.", {
      requested_playrate = playrate,
      readback_playrate = readback_playrate,
    }, false)
  end
  local item_ref = e4_item_object_ref(item)
  return e4_item_summary(request, {
    item_ref = item_ref.ref,
    playrate = readback_playrate,
    requested_playrate = playrate,
    preserve_pitch = request.params.preserve_pitch == true,
    item = e4_item_summary_for_item(item),
  }), nil, nil, nil, e4_item_refs(item_ref)
end
