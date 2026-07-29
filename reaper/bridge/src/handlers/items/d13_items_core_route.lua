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
  if not ok_info then return nil end
  if available ~= true then return false end
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
  local limit = d13_items_bounded_limit(request, request.params.limit, 32, 513)
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

local D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_MAX_ROWS = 64
local D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_CHUNK_SIZE = 8
local D13_ITEMS_BATCH_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"

local function d13_items_batch_now()
  local ok, value = call_reaper("time_precise")
  if ok and d13_items_finite_number(value) then return value end
  return os.clock()
end

local function d13_items_batch_continue(phase, state, mutations_may_have_happened, next_phase_may_mutate)
  state.batch_timings.continuation_yield_count = state.batch_timings.continuation_yield_count + 1
  return {
    contract = D13_ITEMS_BATCH_CONTINUATION_CONTRACT,
    phase = phase,
    state = state,
    mutations_may_have_happened = mutations_may_have_happened == true,
    next_phase_may_mutate = next_phase_may_mutate == true,
  }
end

local function d13_items_batch_error(code, message, row_index, details, recoverable)
  local failure_details = details or {}
  if row_index then failure_details.row_index = row_index end
  return d13_items_error(code, message, failure_details, recoverable)
end

local function d13_items_batch_exact_ref(value, kind)
  if not is_string(value) then return nil end
  local prefix = kind .. ":guid:"
  if value:sub(1, #prefix) ~= prefix then return nil end
  local identity = value:sub(#prefix + 1)
  if identity == "" or identity:find("%s") then return nil end
  return identity
end

local function d13_items_batch_ref_map(request)
  local refs = {}
  if not is_json_array(request.refs) then return refs end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and (ref.kind == "item" or ref.kind == "take") then
      local identity = d13_items_batch_exact_ref(ref.ref, ref.kind)
      if not identity or not is_object(ref.identity)
          or ref.identity.scheme ~= "guid"
          or tostring(ref.identity.value) ~= identity then
        return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch contains a contradictory exact ref.", nil, {
          ref_index = index,
          zero_write = true,
        })
      end
      if refs[ref.ref] then
        return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch contains a duplicate exact ref.", nil, {
          ref = ref.ref,
          zero_write = true,
        })
      end
      refs[ref.ref] = ref
    end
  end
  return refs
end

local function d13_items_batch_take_object_ref(take)
  local ref = d13_items_take_ref_string(take)
  local scheme, value = ref and ref:match("^take:([^:]+):(.+)$")
  if not ref or not scheme or not value then return nil end
  return {
    kind = "take",
    ref = ref,
    identity = { scheme = scheme, value = value },
  }
end

local function d13_items_batch_number(value, minimum, maximum)
  if not d13_items_finite_number(value) then return nil end
  if minimum and value < minimum then return nil end
  if maximum and value > maximum then return nil end
  return value
end

local function d13_items_batch_validate_fields(row, row_index)
  local allowed_row_fields = { id = true, item_ref = true, take_ref = true, item = true, take = true }
  for key in pairs(row) do
    if not allowed_row_fields[key] then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch row contains an unsupported field.", row_index, {
        field = key,
        zero_write = true,
      })
    end
  end
  if not is_string(row.id) or #row.id < 1 or #row.id > 12 or row.id:find("[^A-Za-z0-9_-]") then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch row id must match ^[A-Za-z0-9_-]{1,12}$.", row_index, { zero_write = true })
  end
  local item_identity = d13_items_batch_exact_ref(row.item_ref, "item")
  if not item_identity then
    return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch requires an exact item:guid ref.", row_index, { zero_write = true })
  end
  local item = row.item
  if item == JSON_NULL then item = nil end
  if item ~= nil and not is_object(item) then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch item fields must be an object.", row_index, { zero_write = true })
  end
  local take = row.take
  if take == JSON_NULL then take = nil end
  if take ~= nil and not is_object(take) then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch take fields must be an object.", row_index, { zero_write = true })
  end
  local item_fields = item or {}
  local take_fields = take or {}
  local allowed_item_fields = {
    volume_db = true,
    length_seconds = true,
    fade_in_seconds = true,
    fade_out_seconds = true,
    snap_offset_seconds = true,
  }
  local allowed_take_fields = {
    volume_db = true,
    pan = true,
    pitch_semitones = true,
    playrate = true,
    preserve_pitch = true,
  }
  local item_values = {}
  for key, value in pairs(item_fields) do
    if not allowed_item_fields[key] then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch item fields contain an unsupported field.", row_index, {
        field = key,
        zero_write = true,
      })
    end
    if key == "volume_db" then
      item_values[key] = d13_items_bounded_db(value)
    elseif key == "length_seconds" then
      item_values[key] = d13_items_batch_number(value, 0.000001)
    else
      item_values[key] = d13_items_batch_number(value, 0)
    end
    if item_values[key] == nil then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch item value is outside its accepted numeric range.", row_index, {
        field = key,
        zero_write = true,
      })
    end
  end
  local take_values = {}
  for key, value in pairs(take_fields) do
    if not allowed_take_fields[key] then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch take fields contain an unsupported field.", row_index, {
        field = key,
        zero_write = true,
      })
    end
    if key == "volume_db" then
      take_values[key] = d13_items_bounded_db(value)
    elseif key == "pan" then
      take_values[key] = d13_items_batch_number(value, -1, 1)
    elseif key == "playrate" then
      take_values[key] = d13_items_batch_number(value, 0.000001, 16)
    elseif key == "preserve_pitch" then
      take_values[key] = type(value) == "boolean" and value or nil
    else
      take_values[key] = d13_items_batch_number(value)
    end
    if take_values[key] == nil then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch take value is outside its accepted range.", row_index, {
        field = key,
        zero_write = true,
      })
    end
  end
  local has_item = next(item_values) ~= nil
  local has_take = next(take_values) ~= nil
  if not has_item and not has_take then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch row requires at least one Item or Take field.", row_index, { zero_write = true })
  end
  local take_identity = d13_items_batch_exact_ref(row.take_ref, "take")
  if has_take and not take_identity then
    return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch requires an exact take:guid ref for Take fields.", row_index, { zero_write = true })
  end
  if not has_take and row.take_ref ~= nil then
    return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch take_ref is only valid when Take fields are requested.", row_index, { zero_write = true })
  end
  return {
    id = row.id,
    item_ref = row.item_ref,
    item_identity = item_identity,
    take_ref = has_take and row.take_ref or nil,
    take_identity = has_take and take_identity or nil,
    item = item_values,
    take = take_values,
  }
end

local function d13_items_batch_set_value(owner_kind, owner, key, value)
  local function accepted(ok, result)
    return ok and (result == nil or result == true)
  end
  if owner_kind == "item" then
    local ok, result = call_reaper("SetMediaItemInfo_Value", owner, key, value)
    return accepted(ok, result)
  end
  local ok, result = call_reaper("SetMediaItemTakeInfo_Value", owner, key, value)
  return accepted(ok, result)
end

local function d13_items_batch_read_value(owner_kind, owner, key)
  if owner_kind == "item" then
    local ok, value = call_reaper("GetMediaItemInfo_Value", owner, key)
    return ok and first_number(value) or nil
  end
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", owner, key)
  return ok and first_number(value) or nil
end

local function d13_items_batch_values_match(actual, expected)
  return d13_items_finite_number(actual) and math.abs(actual - expected) <= 0.000001
end

local function d13_items_batch_live_item_map(required_refs)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then
    return d13_items_batch_error("COMMAND_FAILED", "D13 Item/Take batch could not scan the live project once for exact Item identities.", nil, {
      zero_write = true,
      project_scan_count = 0,
    }, false)
  end
  local total = math.max(0, math.floor(first_number(count) or 0))
  local found = {}
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if not ok_item or not item then
      return d13_items_batch_error("COMMAND_FAILED", "D13 Item/Take batch live Item scan failed before mutation.", nil, {
        zero_write = true,
        project_scan_count = 1,
        project_scan_item_count = index,
      }, false)
    end
    local guid = d13_items_item_guid(item)
    local ref = guid and ("item:guid:" .. guid) or nil
    if ref and required_refs[ref] then
      if found[ref] and found[ref] ~= item then
        return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch live Item identity is not unique.", nil, {
          item_ref = ref,
          zero_write = true,
          project_scan_count = 1,
          project_scan_item_count = index + 1,
        }, false)
      end
      found[ref] = item
    end
  end
  return found, nil, total
end

local function d13_items_batch_summary(request, prepared, result_rows, dry_run, mutation_attempted, batch_timings)
  return {
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    mode = "set_item_take_controls_batch",
    rows = result_rows,
    row_count = #prepared,
    dry_run = dry_run == true,
    mutation_attempted = mutation_attempted == true,
    readback_status = dry_run and "preflight_passed" or "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
    batch_timings = batch_timings,
    native_counters = {
      native_mutation_count = batch_timings.native_mutation_count,
      native_property_mutation_count = batch_timings.native_property_mutation_count,
      native_readback_count = batch_timings.native_readback_count,
    },
  }
end

local function d13_items_batch_state_valid(state)
  return is_object(state)
    and is_json_array(state.prepared)
    and is_json_array(state.result_rows)
    and is_object(state.batch_timings)
    and is_non_negative_integer(state.next_index)
    and state.next_index >= 1
    and d13_items_finite_number(state.started_at) ~= nil
end

local function d13_items_batch_mutate_chunk(state)
  if not d13_items_batch_state_valid(state) then
    return d13_items_batch_error("INTERNAL_ERROR", "D13 Item/Take batch continuation state is malformed.", nil, {
      blocker = "malformed_internal_continuation",
    }, false)
  end
  local prepared = state.prepared
  local batch_timings = state.batch_timings
  local chunk_start = state.next_index
  if chunk_start > #prepared then
    return d13_items_batch_error("INTERNAL_ERROR", "D13 Item/Take batch mutation continuation exceeded the frozen plan.", nil, {
      blocker = "malformed_internal_continuation",
    }, false)
  end
  local chunk_end = math.min(#prepared, chunk_start + D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_CHUNK_SIZE - 1)
  local mutation_started = d13_items_batch_now()
  for index = chunk_start, chunk_end do
    local row = prepared[index]
    local function set_item(key, value)
      if value == nil then return true end
      if not d13_items_batch_set_value("item", row.item, key, value) then return false end
      batch_timings.native_property_mutation_count = batch_timings.native_property_mutation_count + 1
      return true
    end
    local function set_take(key, value)
      if value == nil then return true end
      if not d13_items_batch_set_value("take", row.take, key, value) then return false end
      batch_timings.native_property_mutation_count = batch_timings.native_property_mutation_count + 1
      return true
    end
    local item_values = row.item_values
    local take_values = row.take_values
    local preserve_pitch_value = nil
    if take_values.preserve_pitch ~= nil then
      preserve_pitch_value = take_values.preserve_pitch and 1 or 0
    end
    local ok = set_item("D_VOL", item_values.volume_db and d13_items_db_to_linear(item_values.volume_db) or nil)
      and set_item("D_LENGTH", item_values.length_seconds)
      and set_item("D_FADEINLEN", item_values.fade_in_seconds)
      and set_item("D_FADEOUTLEN", item_values.fade_out_seconds)
      and set_item("D_SNAPOFFSET", item_values.snap_offset_seconds)
    if ok and row.take then
      ok = set_take("D_VOL", take_values.volume_db and d13_items_db_to_linear(take_values.volume_db) or nil)
        and set_take("D_PAN", take_values.pan)
        and set_take("D_PITCH", take_values.pitch_semitones)
        and set_take("D_PLAYRATE", take_values.playrate)
        and set_take("B_PPITCH", preserve_pitch_value)
    end
    if not ok or not call_reaper("UpdateItemInProject", row.item) then
      batch_timings.mutation_ms = batch_timings.mutation_ms + ((d13_items_batch_now() - mutation_started) * 1000)
      local _, failure = d13_items_batch_error("COMMAND_FAILED", "REAPER rejected an Item/Take batch native mutation.", index, {
        item_ref = row.item_ref,
        take_ref = row.take_ref or JSON_NULL,
        mutation_attempted = batch_timings.native_property_mutation_count > 0,
        zero_write = batch_timings.native_property_mutation_count == 0,
        batch_timings = batch_timings,
        completed_rows = batch_timings.native_mutation_count,
      }, false)
      return nil, failure
    end
    batch_timings.native_mutation_count = batch_timings.native_mutation_count + 1
  end
  batch_timings.mutation_ms = batch_timings.mutation_ms + ((d13_items_batch_now() - mutation_started) * 1000)
  batch_timings.completed_chunks = batch_timings.completed_chunks + 1
  state.next_index = chunk_end + 1
  if state.next_index <= #prepared then
    return d13_items_batch_continue("set_item_take_controls_batch.mutate_chunk", state, true, true)
  end
  return d13_items_batch_continue("set_item_take_controls_batch.aggregate_readback", state, true, false)
end

local function d13_items_batch_aggregate_readback(request, state)
  if not d13_items_batch_state_valid(state) or state.next_index ~= #state.prepared + 1 then
    return d13_items_batch_error("INTERNAL_ERROR", "D13 Item/Take batch readback continuation state is malformed.", nil, {
      blocker = "malformed_internal_continuation",
    }, false)
  end
  local prepared = state.prepared
  local result_rows = state.result_rows
  local batch_timings = state.batch_timings
  local readback_started = d13_items_batch_now()
  local readback_failure = nil
  for index = 1, #prepared do
    local row = prepared[index]
    local result = result_rows[index]
    local item_guid = d13_items_item_guid(row.item)
    local item_identity = item_guid and ("item:guid:" .. item_guid) or nil
    local take_identity = row.take and d13_items_take_ref_string(row.take) or nil
    local matches = item_identity == row.item_ref and (not row.take_ref or take_identity == row.take_ref)
    local expected = row.item_values
    local actual_item_native = {
      volume = d13_items_batch_read_value("item", row.item, "D_VOL"),
      length_seconds = d13_items_batch_read_value("item", row.item, "D_LENGTH"),
      fade_in_seconds = d13_items_batch_read_value("item", row.item, "D_FADEINLEN"),
      fade_out_seconds = d13_items_batch_read_value("item", row.item, "D_FADEOUTLEN"),
      snap_offset_seconds = d13_items_batch_read_value("item", row.item, "D_SNAPOFFSET"),
    }
    local actual_take_native = row.take and {
      volume = d13_items_batch_read_value("take", row.take, "D_VOL"),
      pan = d13_items_batch_read_value("take", row.take, "D_PAN"),
      pitch_semitones = d13_items_batch_read_value("take", row.take, "D_PITCH"),
      playrate = d13_items_batch_read_value("take", row.take, "D_PLAYRATE"),
      preserve_pitch = d13_items_batch_read_value("take", row.take, "B_PPITCH"),
    } or nil
    local actual_item = {
      volume_db = d13_items_linear_to_db(actual_item_native.volume),
      length_seconds = actual_item_native.length_seconds,
      fade_in_seconds = actual_item_native.fade_in_seconds,
      fade_out_seconds = actual_item_native.fade_out_seconds,
      snap_offset_seconds = actual_item_native.snap_offset_seconds,
    }
    local actual_take = actual_take_native and {
      volume_db = d13_items_linear_to_db(actual_take_native.volume),
      pan = actual_take_native.pan,
      pitch_semitones = actual_take_native.pitch_semitones,
      playrate = actual_take_native.playrate,
      preserve_pitch = actual_take_native.preserve_pitch == nil and nil or actual_take_native.preserve_pitch == 1,
    } or nil
    local checks = {
      { expected = expected.volume_db and d13_items_db_to_linear(expected.volume_db), actual = actual_item_native.volume },
      { expected = expected.length_seconds, actual = actual_item_native.length_seconds },
      { expected = expected.fade_in_seconds, actual = actual_item_native.fade_in_seconds },
      { expected = expected.fade_out_seconds, actual = actual_item_native.fade_out_seconds },
      { expected = expected.snap_offset_seconds, actual = actual_item_native.snap_offset_seconds },
    }
    for check_index = 1, #checks do
      if checks[check_index].expected ~= nil and not d13_items_batch_values_match(checks[check_index].actual, checks[check_index].expected) then matches = false end
    end
    if actual_take_native then
      if row.take_values.volume_db ~= nil and not d13_items_batch_values_match(actual_take_native.volume, d13_items_db_to_linear(row.take_values.volume_db)) then matches = false end
      if row.take_values.pan ~= nil and not d13_items_batch_values_match(actual_take_native.pan, row.take_values.pan) then matches = false end
      if row.take_values.pitch_semitones ~= nil and not d13_items_batch_values_match(actual_take_native.pitch_semitones, row.take_values.pitch_semitones) then matches = false end
      if row.take_values.playrate ~= nil and not d13_items_batch_values_match(actual_take_native.playrate, row.take_values.playrate) then matches = false end
      if row.take_values.preserve_pitch ~= nil and actual_take_native.preserve_pitch ~= (row.take_values.preserve_pitch and 1 or 0) then matches = false end
    end
    batch_timings.native_readback_count = batch_timings.native_readback_count + 1
    if matches then
      result.status = "applied"
      result.readback_status = "aggregate_passed"
      result.mutation = { status = "completed" }
      result.live_readback = { status = "passed", source = "d13_aggregate_native_readback" }
      result.item_identity = item_identity
      result.take_identity = take_identity or JSON_NULL
      result.fields = { item = actual_item, take = actual_take or JSON_NULL }
    elseif not readback_failure then
      local _, failure = d13_items_batch_error("VERIFY_FAILED", "D13 Item/Take batch aggregate readback did not match native identity or requested values.", index, {
        item_ref = row.item_ref,
        take_ref = row.take_ref or JSON_NULL,
        mutation_attempted = true,
        zero_write = false,
      }, false)
      readback_failure = failure
    end
  end
  batch_timings.readback_ms = (d13_items_batch_now() - readback_started) * 1000
  batch_timings.aggregate_readback_count = 1
  local evidence_started = d13_items_batch_now()
  batch_timings.completed_rows = batch_timings.native_readback_count
  batch_timings.evidence_ms = (d13_items_batch_now() - evidence_started) * 1000
  batch_timings.total_ms = (d13_items_batch_now() - state.started_at) * 1000
  if readback_failure then
    local failure = readback_failure[2] or readback_failure
    failure.details.batch_timings = batch_timings
    failure.details.completed_rows = batch_timings.native_readback_count
    return nil, failure
  end
  -- rows[] already carries every exact Item/Take identity and requested-field
  -- readback. Repeating those identities in refs[] exceeds the Bridge response
  -- budget at the supported 64-row ceiling after successful mutation.
  return d13_items_batch_summary(request, prepared, result_rows, false, true, batch_timings), nil, json_array({}), json_array({}), json_array({})
end

local function d13_items_set_item_take_controls_batch(request, resume_continuation)
  if resume_continuation then
    if resume_continuation.phase == "set_item_take_controls_batch.mutate_chunk" then
      return d13_items_batch_mutate_chunk(resume_continuation.state)
    end
    if resume_continuation.phase == "set_item_take_controls_batch.aggregate_readback" then
      return d13_items_batch_aggregate_readback(request, resume_continuation.state)
    end
    return d13_items_batch_error("INTERNAL_ERROR", "D13 Item/Take batch received an unknown continuation phase.", nil, {
      blocker = "malformed_internal_continuation",
      phase = resume_continuation.phase,
    }, false)
  end
  local params = is_object(request.params) and request.params or {}
  local batch = params.changes or params.batch
  if params.changes ~= nil and params.batch ~= nil then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch accepts one changes or batch array, not both.", nil, {
      zero_write = true,
    })
  end
  if not is_json_array(batch) or #batch < 1 or #batch > D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_MAX_ROWS then
    return d13_items_batch_error("BATCH_LIMIT_EXCEEDED", "D13 Item/Take batch accepts 1-64 rows.", nil, {
      row_count = is_json_array(batch) and #batch or 0,
      max_rows = D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_MAX_ROWS,
      zero_write = true,
    })
  end
  if params.dry_run ~= nil and params.dry_run ~= true and params.dry_run ~= false then
    return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch dry_run must be boolean.", nil, { zero_write = true })
  end
  local ref_map, ref_failure = d13_items_batch_ref_map(request)
  if not ref_map then return nil, ref_failure end
  local seen_ids = {}
  local seen_items = {}
  local normalized_rows = json_array({})
  local required_item_refs = {}
  local preflight_started = d13_items_batch_now()
  for index = 1, #batch do
    local row = batch[index]
    if not is_object(row) then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch rows must be objects.", index, { zero_write = true })
    end
    local normalized, validation_failure = d13_items_batch_validate_fields(row, index)
    if not normalized then return nil, validation_failure end
    if seen_ids[normalized.id] then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch row ids must be unique.", index, { zero_write = true })
    end
    if seen_items[normalized.item_ref] then
      return d13_items_batch_error("PARAMS_INVALID", "D13 Item/Take batch item refs must be unique.", index, { zero_write = true })
    end
    seen_ids[normalized.id] = true
    seen_items[normalized.item_ref] = true
    required_item_refs[normalized.item_ref] = true
    normalized_rows[#normalized_rows + 1] = normalized
  end
  local live_items, scan_failure, project_scan_item_count = d13_items_batch_live_item_map(required_item_refs)
  if not live_items then return nil, scan_failure end
  local prepared = json_array({})
  for index = 1, #normalized_rows do
    local normalized = normalized_rows[index]
    local item = live_items[normalized.item_ref]
    if not item then
      return d13_items_batch_error("ITEM_NOT_FOUND", "D13 Item/Take batch could not prove the exact Item identity.", index, {
        item_ref = normalized.item_ref,
        zero_write = true,
      })
    end
    local take = nil
    local take_ref_object = nil
    if normalized.take_ref then
      local supplied_take_ref = ref_map[normalized.take_ref]
      take_ref_object = supplied_take_ref or {
        kind = "take",
        ref = normalized.take_ref,
        identity = { scheme = "guid", value = normalized.take_identity },
      }
      take = d13_items_active_take(item)
      if not take then
        return d13_items_batch_error("TAKE_NOT_FOUND", "D13 Item/Take batch requires an active Take for Take fields.", index, {
          item_ref = normalized.item_ref,
          take_ref = normalized.take_ref,
          zero_write = true,
        })
      end
      if not d13_items_take_ref_string(take) or d13_items_take_ref_string(take) ~= normalized.take_ref then
        return d13_items_batch_error("REF_INVALID", "D13 Item/Take batch Take ref does not match the exact active Take.", index, {
          item_ref = normalized.item_ref,
          take_ref = normalized.take_ref,
          zero_write = true,
        })
      end
    end
    prepared[#prepared + 1] = {
      id = normalized.id,
      item_ref = normalized.item_ref,
      item = item,
      item_ref_object = {
        kind = "item",
        ref = normalized.item_ref,
        identity = { scheme = "guid", value = normalized.item_identity },
      },
      take = take,
      take_ref = normalized.take_ref,
      take_ref_object = take_ref_object,
      item_values = normalized.item,
      take_values = normalized.take,
    }
  end
  local preflight_ms = (d13_items_batch_now() - preflight_started) * 1000
  local dry_run = params.dry_run == true
  local result_rows = json_array({})
  local batch_timings = {
    preflight_ms = preflight_ms,
    mutation_ms = 0,
    readback_ms = 0,
    evidence_ms = 0,
    transport_ms = JSON_NULL,
    total_ms = 0,
    native_mutation_count = 0,
    native_property_mutation_count = 0,
    native_readback_count = 0,
    rows = #prepared,
    completed_rows = 0,
    completed_chunks = 0,
    continuation_yield_count = 0,
    aggregate_readback_count = 0,
    project_scan_count = 1,
    project_scan_item_count = project_scan_item_count,
    chunk_size = D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_CHUNK_SIZE,
    chunks = math.ceil(#prepared / D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_CHUNK_SIZE),
    job_count = 1,
    runner = "d13_generic_item_take_controls_continuation_job",
    execution_mode = "native_chunked_continuation",
  }
  for index = 1, #prepared do
    local row = prepared[index]
    result_rows[#result_rows + 1] = {
      id = row.id,
      batch_index = index,
      item_ref = row.item_ref,
      take_ref = row.take_ref or JSON_NULL,
      identity = { item_ref = row.item_ref, take_ref = row.take_ref or JSON_NULL },
      status = dry_run and "preflight_passed" or "pending",
      readback_status = dry_run and "preflight_passed" or "pending",
      mutation = { status = dry_run and "not_run" or "pending" },
      live_readback = { status = dry_run and "not_run" or "pending" },
    }
  end
  if dry_run then
    batch_timings.job_count = 0
    batch_timings.total_ms = (d13_items_batch_now() - preflight_started) * 1000
    return d13_items_batch_summary(request, prepared, result_rows, true, false, batch_timings), nil, json_array({}), json_array({}), json_array({})
  end
  return d13_items_batch_continue("set_item_take_controls_batch.mutate_chunk", {
    prepared = prepared,
    result_rows = result_rows,
    batch_timings = batch_timings,
    started_at = preflight_started,
    next_index = 1,
  }, false, true)
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
