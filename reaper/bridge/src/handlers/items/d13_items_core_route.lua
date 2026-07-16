-- Extracted D13 handler: items core read/write controls.

local D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID = 41051

local function d13_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d13_items_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d13_items_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d13_items_bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

local function d13_items_db_to_linear(db)
  return 10 ^ (db / 20)
end

local function d13_items_linear_to_db(value)
  if type(value) ~= "number" or value <= 0 then
    return -150
  end
  return 20 * math.log(value) / math.log(10)
end

local function d13_items_bounded_db(value)
  local db = d13_items_finite_number(value)
  if not db or db < -120 or db > 24 then
    return nil
  end
  return db
end

local function d13_items_bounded_pan(value)
  local pan = d13_items_finite_number(value)
  if not pan or pan < -1 or pan > 1 then
    return nil
  end
  return pan
end

local function d13_items_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d13_items_track_index(track)
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

local function d13_items_track_ref_string(track)
  local guid = d13_items_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d13_items_track_index(track))
end

local function d13_items_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d13_items_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d13_items_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d13_items_find_track_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d13_items_track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function d13_items_resolve_track_token(token)
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
    return d13_items_find_track_by_guid(guid)
  end
  local name = token:match("^track:(.+)$")
  if name then
    return d13_items_find_track_by_name(name)
  end
  return nil
end

local function d13_items_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^track:([^:]+):(.+)$")
  if not scheme or (scheme ~= "selected" and scheme ~= "index" and scheme ~= "guid" and scheme ~= "name") then
    return nil
  end
  if ref.identity.scheme ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  return d13_items_resolve_track_token(ref.ref)
end

local function d13_items_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = d13_items_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "D13 items request requires a resolvable track ref.",
    details = {},
  }
end

local function d13_items_item_guid(item)
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

local function d13_items_item_ref_string(item)
  local guid = d13_items_item_guid(item)
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

local function d13_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d13_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d13_items_resolve_item_token(token)
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
    return d13_items_find_item_by_guid(guid)
  end
  return nil
end

local function d13_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^item:([^:]+):(.+)$")
  if not scheme or (scheme ~= "selected" and scheme ~= "index" and scheme ~= "guid") then
    return nil
  end
  if ref.identity.scheme ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  return d13_items_resolve_item_token(ref.ref)
end

local function d13_items_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d13_items_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d13_items_item_object_ref(item)
  local ref = d13_items_item_ref_string(item)
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

local function d13_items_track_object_ref(track)
  local ref = d13_items_track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d13_items_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function d13_items_item_index(item)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return index
    end
  end
  return 0
end

local function d13_items_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function d13_items_take_number(take, key)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  return ok and first_number(value) or 0
end

local function d13_items_values_match(actual, requested, key)
  local tolerance = 0
  if key == "D_VOL" or key == "D_PAN" or key == "D_STARTOFFS" or key == "F_STRETCHFADESIZE" then
    tolerance = 0.000001
  end
  return math.abs((actual or 0) - (requested or 0)) <= tolerance
end

local function d13_items_channel_mode_label(value)
  local number = math.floor(tonumber(value) or 0)
  if number == 1 then
    return "reverse_stereo"
  elseif number == 3 then
    return "mono_left"
  elseif number == 4 then
    return "mono_right"
  end
  return "normal"
end

local function d13_items_channel_mode_value(value)
  if value == "normal" then
    return 0
  elseif value == "reverse_stereo" then
    return 1
  elseif value == "mono_left" then
    return 3
  elseif value == "mono_right" then
    return 4
  end
  return nil
end

local function d13_items_pitch_mode_label(value)
  local number = math.floor(tonumber(value) or -1)
  if number == -1 then
    return "project_default"
  end
  return tostring(number)
end

local function d13_items_pitch_mode_value(value)
  if value == "project_default" or value == "default" then
    return -1
  end
  if is_string(value) and value:match("^%-?%d+$") then
    return tonumber(value)
  end
  return nil
end

local function d13_items_active_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function d13_items_take_reverse_state(take)
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then return nil end
  local ok_info, available, _, _, reversed = call_reaper("PCM_Source_GetSectionInfo", source)
  if not ok_info or available ~= true then return nil end
  return reversed == true or reversed == 1
end

local function d13_items_take_name(take)
  local ok, _, name = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", "", false)
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d13_items_take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function d13_items_take_ref_string(take)
  local guid = d13_items_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

local function d13_items_item_summary(item, include_take_summary)
  local track = d13_items_item_track(item)
  local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", item, "B_UISEL")
  local summary = {
    item_ref = d13_items_item_ref_string(item),
    item_index = d13_items_item_index(item),
    track_ref = track and d13_items_track_ref_string(track) or JSON_NULL,
    position_seconds = d13_items_item_number(item, "D_POSITION"),
    length_seconds = d13_items_item_number(item, "D_LENGTH"),
    snap_offset_seconds = d13_items_item_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = d13_items_item_number(item, "D_FADEINLEN"),
    fade_out_seconds = d13_items_item_number(item, "D_FADEOUTLEN"),
    selected = ok_selected and first_number(selected) == 1 or false,
    volume_db = d13_items_linear_to_db(d13_items_item_number(item, "D_VOL")),
    muted = d13_items_item_number(item, "B_MUTE") == 1,
    locked = d13_items_item_number(item, "C_LOCK") ~= 0,
    loop_source = d13_items_item_number(item, "B_LOOPSRC") == 1,
    play_all_takes = d13_items_item_number(item, "B_ALLTAKESPLAY") == 1,
  }
  if include_take_summary then
    local ok_take_count, take_count = call_reaper("CountTakes", item)
    local take = d13_items_active_take(item)
    summary.take_count = ok_take_count and first_number(take_count) or 0
    if take then
      summary.active_take_ref = d13_items_take_ref_string(take)
      summary.active_take_name = d13_items_take_name(take)
      summary.take_volume_db = d13_items_linear_to_db(d13_items_take_number(take, "D_VOL"))
      summary.take_pan = d13_items_take_number(take, "D_PAN")
      summary.start_offset_seconds = d13_items_take_number(take, "D_STARTOFFS")
      summary.channel_mode = d13_items_channel_mode_label(d13_items_take_number(take, "I_CHANMODE"))
      summary.reverse = d13_items_take_reverse_state(take)
      summary.pitch_shift_mode = d13_items_pitch_mode_label(d13_items_take_number(take, "I_PITCHMODE"))
      summary.stretch_marker_fade_size_ms = d13_items_take_number(take, "F_STRETCHFADESIZE") * 1000
    else
      summary.active_take_ref = JSON_NULL
      summary.active_take_name = ""
    end
  end
  return summary
end

local function d13_items_list_selected_items(request)
  local ok_count, count = call_reaper("CountSelectedMediaItems", 0)
  local selected_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local limit = d13_items_bounded_limit(request, request.params.limit, 32, 128)
  local include_track_refs = request.params.include_track_refs == true
  local items = json_array({})
  local refs = json_array({})
  for index = 0, math.min(selected_count, limit) - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
    if ok_item and item then
      local summary = d13_items_item_summary(item, false)
      if not include_track_refs then
        summary.track_ref = JSON_NULL
      end
      items[#items + 1] = summary
      refs[#refs + 1] = d13_items_item_object_ref(item)
      if include_track_refs then
        local track = d13_items_item_track(item)
        if track then
          refs[#refs + 1] = d13_items_track_object_ref(track)
        end
      end
    end
  end
  return {
    kind = "selected_items",
    selected_count = selected_count,
    items = items,
    truncated = selected_count > limit,
  }, nil, nil, nil, refs
end

local function d13_items_list_items_on_track(request)
  local track, failure = d13_items_track_from_request_refs(request)
  if not track then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local ok_count, count = call_reaper("CountTrackMediaItems", track)
  local item_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local limit = d13_items_bounded_limit(request, request.params.limit, 32, 128)
  local include_take_summary = request.params.include_take_summary == true
  local items = json_array({})
  local refs = json_array({ d13_items_track_object_ref(track) })
  for index = 0, math.min(item_count, limit) - 1 do
    local ok_item, item = call_reaper("GetTrackMediaItem", track, index)
    if ok_item and item then
      items[#items + 1] = d13_items_item_summary(item, include_take_summary)
      refs[#refs + 1] = d13_items_item_object_ref(item)
    end
  end
  return {
    kind = "track_items",
    track_ref = d13_items_track_ref_string(track),
    item_count = item_count,
    items = items,
    truncated = item_count > limit,
  }, nil, nil, nil, refs
end

local function d13_items_write_summary(request, item)
  local summary = d13_items_item_summary(item, true)
  summary.capability = request.pack.capability
  summary.pack = request.pack.id
  summary.risk = request.pack.risk
  summary.readback_status = "passed"
  summary.undo_evidence = "required"
  summary.artifacts_allowed = false
  summary.truncated = false
  if request.pack.capability == "items.set_take_pan" then
    summary.pan = summary.take_pan
  elseif request.pack.capability == "items.set_reverse" then
    summary.reverse = summary.reverse == true
  elseif request.pack.capability == "items.set_pitch_shift_mode" then
    summary.mode = summary.pitch_shift_mode
  elseif request.pack.capability == "items.set_stretch_marker_fade_size" then
    summary.fade_size_ms = summary.stretch_marker_fade_size_ms
  end
  return summary, nil, json_array({}), json_array({}), d13_items_refs(d13_items_item_object_ref(item))
end

local function d13_items_item_for_write(request)
  local item = d13_items_item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D13 items write request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function d13_items_take_for_write(request, item)
  local take = d13_items_active_take(item)
  if not take then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D13 take write request requires an active take.",
      details = {
        item_ref = d13_items_item_ref_string(item),
      },
    }
  end
  return take
end

local function d13_items_set_item_value(request, key, value)
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local ok = call_reaper("SetMediaItemInfo_Value", item, key, value)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected item property update.", {
      key = key,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d13_items_item_number(item, key)
  if not d13_items_values_match(readback, value, key) then
    return d13_items_error("VERIFY_FAILED", "Item property readback did not match the requested value.", {
      key = key,
      requested = value,
      readback = readback,
      item_ref = d13_items_item_ref_string(item),
    }, false)
  end
  return d13_items_write_summary(request, item)
end

local function d13_items_set_take_value(request, key, value)
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d13_items_take_for_write(request, item)
  if not take then
    return d13_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local ok = call_reaper("SetMediaItemTakeInfo_Value", take, key, value)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected take property update.", {
      key = key,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d13_items_take_number(take, key)
  if not d13_items_values_match(readback, value, key) then
    return d13_items_error("VERIFY_FAILED", "Take property readback did not match the requested value.", {
      key = key,
      requested = value,
      readback = readback,
      item_ref = d13_items_item_ref_string(item),
    }, false)
  end
  return d13_items_write_summary(request, item)
end

local function d13_items_set_item_volume(request)
  local db = d13_items_bounded_db(request.params.volume_db)
  if not db then
    return d13_items_error("PARAMS_INVALID", "Item volume_db must be between -120 and 24.", {
      volume_db = request.params.volume_db,
    })
  end
  return d13_items_set_item_value(request, "D_VOL", d13_items_db_to_linear(db))
end

local function d13_items_set_take_volume(request)
  local db = d13_items_bounded_db(request.params.volume_db)
  if not db then
    return d13_items_error("PARAMS_INVALID", "Take volume_db must be between -120 and 24.", {
      volume_db = request.params.volume_db,
    })
  end
  return d13_items_set_take_value(request, "D_VOL", d13_items_db_to_linear(db))
end

local function d13_items_set_take_pan(request)
  local pan = d13_items_bounded_pan(request.params.pan)
  if pan == nil then
    return d13_items_error("PARAMS_INVALID", "Take pan must be between -1 and 1.", {
      pan = request.params.pan,
    })
  end
  return d13_items_set_take_value(request, "D_PAN", pan)
end

local function d13_items_rename_take(request)
  local name = bounded_string(request.params.name, 160)
  if name == "" then
    return d13_items_error("PARAMS_INVALID", "Take name must be a non-empty string.", {})
  end
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d13_items_take_for_write(request, item)
  if not take then
    return d13_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local ok = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", name, true)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected take rename.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  return d13_items_write_summary(request, item)
end

local function d13_items_set_loop_source(request)
  return d13_items_set_item_value(request, "B_LOOPSRC", request.params.loop_source == true and 1 or 0)
end

local function d13_items_set_mute(request)
  return d13_items_set_item_value(request, "B_MUTE", request.params.muted == true and 1 or 0)
end

local function d13_items_set_lock(request)
  return d13_items_set_item_value(request, "C_LOCK", request.params.locked == true and 1 or 0)
end

local function d13_items_set_play_all_takes(request)
  return d13_items_set_item_value(request, "B_ALLTAKESPLAY", request.params.play_all_takes == true and 1 or 0)
end

local function d13_items_set_take_start_in_source(request)
  local offset = d13_items_finite_number(request.params.start_offset_seconds)
  if not offset or offset < 0 then
    return d13_items_error("PARAMS_INVALID", "Take start_offset_seconds must be non-negative.", {
      start_offset_seconds = request.params.start_offset_seconds,
    })
  end
  return d13_items_set_take_value(request, "D_STARTOFFS", offset)
end

local function d13_items_set_channel_mode(request)
  local mode = d13_items_channel_mode_value(request.params.channel_mode)
  if mode == nil then
    return d13_items_error("PARAMS_INVALID", "Take channel_mode is outside the D13 enum.", {
      channel_mode = request.params.channel_mode,
    })
  end
  return d13_items_set_take_value(request, "I_CHANMODE", mode)
end

local function d13_items_all_items()
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then return nil end
  local rows = {}
  for index = 0, math.max(0, math.floor(first_number(count) or 0)) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if not ok_item or not item then return nil end
    local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", item, "B_UISEL")
    local ok_take, take = call_reaper("GetActiveTake", item)
    if not ok_selected or not ok_take then return nil end
    rows[#rows + 1] = { item = item, selected = first_number(selected) == 1, active_take = take }
  end
  return rows
end

local function d13_items_selected_tracks()
  local ok_count, count = call_reaper("CountSelectedTracks2", 0, true)
  if not ok_count then return nil end
  local rows = {}
  for index = 0, math.max(0, math.floor(first_number(count) or 0)) - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack2", 0, index, true)
    if not ok_track or not track then return nil end
    rows[#rows + 1] = track
  end
  return rows
end

local function d13_items_same_pointers(actual, expected)
  if not actual or #actual ~= #expected then return false end
  for index = 1, #expected do
    if actual[index] ~= expected[index] then return false end
  end
  return true
end

local function d13_items_clear_track_selection()
  local ok_master, master = call_reaper("GetMasterTrack", 0)
  if ok_master and master then
    local ok_set, accepted = call_reaper("SetTrackSelected", master, false)
    if not ok_set or accepted == false then return false end
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  if not ok_count then return false end
  for index = 0, math.max(0, math.floor(first_number(count) or 0)) - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if not ok_track or not track then return false end
    local ok_set, accepted = call_reaper("SetTrackSelected", track, false)
    if not ok_set or accepted == false then return false end
  end
  return true
end

local function d13_items_apply_item_selection(items, target_item)
  for index = 1, #items do
    local selected = items[index].item == target_item
    local ok_set, accepted = call_reaper("SetMediaItemSelected", items[index].item, selected)
    if not ok_set or accepted == false then return false end
  end
  return true
end

local function d13_items_restore_reverse_context(snapshot)
  local selection_ok = d13_items_clear_track_selection()
  for index = 1, #snapshot.selected_tracks do
    local ok_set, accepted = call_reaper("SetTrackSelected", snapshot.selected_tracks[index], true)
    if not ok_set or accepted == false then selection_ok = false end
  end
  for index = 1, #snapshot.items do
    local saved = snapshot.items[index]
    local ok_set, accepted = call_reaper("SetMediaItemSelected", saved.item, saved.selected)
    if not ok_set or accepted == false then selection_ok = false end
  end
  local active_ok = true
  for index = 1, #snapshot.items do
    local saved = snapshot.items[index]
    local ok_current, current = call_reaper("GetActiveTake", saved.item)
    if not ok_current then
      active_ok = false
    elseif current ~= saved.active_take then
      if not saved.active_take then
        active_ok = false
      else
        local ok_set, accepted = call_reaper("SetActiveTake", saved.active_take)
        if not ok_set or accepted == false then active_ok = false end
      end
    end
  end
  local restored_tracks = d13_items_selected_tracks()
  if not d13_items_same_pointers(restored_tracks, snapshot.selected_tracks) then selection_ok = false end
  for index = 1, #snapshot.items do
    local saved = snapshot.items[index]
    local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", saved.item, "B_UISEL")
    if not ok_selected or (first_number(selected) == 1) ~= saved.selected then selection_ok = false end
  end
  return selection_ok, active_ok
end

local function d13_items_set_reverse(request)
  local item, failure = d13_items_item_for_write(request)
  if not item then return d13_items_error(failure.code, failure.message, failure.details) end
  local take, take_failure = d13_items_take_for_write(request, item)
  if not take then return d13_items_error(take_failure.code, take_failure.message, take_failure.details) end
  local requested = request.params.reverse == true
  local before = d13_items_take_reverse_state(take)
  if before == nil then
    return d13_items_error("COMMAND_FAILED", "REAPER did not expose the active Take reverse state.", {
      item_ref = d13_items_item_ref_string(item),
    }, false)
  end
  if before == requested then
    local summary, err, artifacts, jobs, refs = d13_items_write_summary(request, item)
    summary.changed = false
    summary.fixed_action_id = D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID
    summary.selection_restored = true
    summary.active_take_restored = true
    return summary, err, artifacts, jobs, refs
  end

  local items = d13_items_all_items()
  local selected_tracks = d13_items_selected_tracks()
  if not items or not selected_tracks then
    return d13_items_error("COMMAND_FAILED", "Take reverse could not snapshot selection and active Takes.", {}, false)
  end
  local snapshot = { items = items, selected_tracks = selected_tracks }
  local selected = d13_items_apply_item_selection(items, item)
  local ok_active, accepted_active = call_reaper("SetActiveTake", take)
  local ok_readback, active_take = call_reaper("GetActiveTake", item)
  if not selected or not ok_active or accepted_active == false or not ok_readback or active_take ~= take then
    local selection_restored, active_take_restored = d13_items_restore_reverse_context(snapshot)
    return d13_items_error("COMMAND_FAILED", "Take reverse could not target the exact active Take.", {
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end

  local command_ok, command_result = call_reaper("Main_OnCommandEx", D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID, 0, 0)
  if not command_ok or command_result == false then
    local selection_restored, active_take_restored = d13_items_restore_reverse_context(snapshot)
    return d13_items_error("COMMAND_FAILED", "REAPER rejected the fixed native Take reverse action.", {
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  call_reaper("UpdateArrange")
  local readback = d13_items_take_reverse_state(take)
  local selection_restored, active_take_restored = d13_items_restore_reverse_context(snapshot)
  if readback ~= requested then
    return d13_items_error("VERIFY_FAILED", "Native Take reverse readback did not match the requested state.", {
      requested = requested,
      readback = readback == nil and JSON_NULL or readback,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  if not selection_restored or not active_take_restored then
    return d13_items_error("VERIFY_FAILED", "Take reverse could not restore selection and active Takes.", {
      requested = requested,
      readback = readback,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  local summary, err, artifacts, jobs, refs = d13_items_write_summary(request, item)
  summary.changed = true
  summary.fixed_action_id = D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID
  summary.selection_restored = true
  summary.active_take_restored = true
  return summary, err, artifacts, jobs, refs
end

local function d13_items_set_pitch_shift_mode(request)
  local mode = d13_items_pitch_mode_value(request.params.mode)
  if mode == nil then
    return d13_items_error("PARAMS_INVALID", "Take pitch mode must be project_default or an integer I_PITCHMODE value.", {
      mode = request.params.mode,
    })
  end
  return d13_items_set_take_value(request, "I_PITCHMODE", mode)
end

local function d13_items_set_stretch_marker_fade_size(request)
  local fade_size_ms = d13_items_finite_number(request.params.fade_size_ms)
  if not fade_size_ms or fade_size_ms < 0 or fade_size_ms > 10000 then
    return d13_items_error("PARAMS_INVALID", "Stretch marker fade_size_ms must be between 0 and 10000.", {
      fade_size_ms = request.params.fade_size_ms,
    })
  end
  return d13_items_set_take_value(request, "F_STRETCHFADESIZE", fade_size_ms / 1000)
end
