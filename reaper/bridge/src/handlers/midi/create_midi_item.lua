-- Extracted Safe-Write-A handler: template.midi.create_midi_item.

local function handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function safe_write_a_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.truncated = false
  return readback
end

local function safe_write_a_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function track_index(track)
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

local function find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function find_track_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function resolve_track_token(token)
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
    return find_track_by_guid(guid)
  end

  local name = token:match("^track:(.+)$")
  if name then
    return find_track_by_name(name)
  end
  return nil
end

local function resolve_track_from_ref_object(ref)
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
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
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
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function item_ref_string(item)
  return READ_B_MIDI.item_ref_string(item)
end

local function midi_take_summary(take)
  return READ_B_MIDI.midi_take_summary(take)
end

local function item_object_ref(item)
  local ref = READ_B_MIDI.item_ref_string(item)
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

local function take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function created_midi_take(item)
  local ok_active, active_take = call_reaper("GetActiveTake", item)
  if ok_active and active_take then
    local ok_midi, is_midi = call_reaper("TakeIsMIDI", active_take)
    if ok_midi and is_midi == true then
      return active_take
    end
  end
  local ok_count, take_count = call_reaper("CountTakes", item)
  local total = ok_count and first_number(take_count) or 0
  for index = 0, total - 1 do
    local ok_take, take = call_reaper("GetTake", item, index)
    if ok_take and take then
      local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
      if ok_midi and is_midi == true then
        return take
      end
    end
  end
  return nil
end

local function item_time_value(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and bounded_number(first_number(value), nil) or nil
end

local function time_matches(actual, expected)
  return type(actual) == "number" and math.abs(actual - expected) <= 0.000001
end

local function project_time_to_qn(seconds)
  local ok, value = call_reaper("TimeMap2_timeToQN", 0, seconds)
  local qn = ok and first_number(value) or nil
  return type(qn) == "number" and qn == qn and qn ~= math.huge and qn ~= -math.huge and qn or nil
end

local function discard_created_item(track, item)
  local ok, removed = call_reaper("DeleteTrackMediaItem", track, item)
  return ok and removed ~= false
end

local function safe_write_create_midi_item(request)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "MIDI item end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local start_qn = project_time_to_qn(start_seconds)
  local end_qn = project_time_to_qn(end_seconds)
  if start_qn == nil or end_qn == nil or end_qn <= start_qn then
    return handler_error("COMMAND_FAILED", "Could not convert MIDI item time bounds to project quarter notes.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    }, false)
  end
  local ok_item, item = call_reaper("CreateNewMIDIItemInProj", track, start_qn, end_qn, true)
  if not ok_item or not item then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A MIDI item.", {}, false)
  end
  local ok_extents, extents_set = call_reaper("MIDI_SetItemExtents", item, start_qn, end_qn)
  if not ok_extents or extents_set == false then
    return handler_error("COMMAND_FAILED", "Could not set created MIDI item extents.", {
      cleanup_succeeded = discard_created_item(track, item),
      start_qn = start_qn,
      end_qn = end_qn,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  local take = created_midi_take(item)
  if not take then
    return handler_error("TAKE_NOT_FOUND", "Created MIDI item did not expose an active take.", {
      cleanup_succeeded = discard_created_item(track, item),
    })
  end
  local readback_start = item_time_value(item, "D_POSITION")
  local readback_length = item_time_value(item, "D_LENGTH")
  local readback_end = readback_start and readback_length and readback_start + readback_length or nil
  if not time_matches(readback_start, start_seconds) or not time_matches(readback_end, end_seconds) then
    local cleanup_succeeded = discard_created_item(track, item)
    return handler_error("VERIFY_FAILED", "Created MIDI item time readback did not match the request.", {
      requested_start_seconds = start_seconds,
      requested_end_seconds = end_seconds,
      readback_start_seconds = readback_start,
      readback_end_seconds = readback_end,
      cleanup_succeeded = cleanup_succeeded,
    }, false)
  end
  local summary = midi_take_summary(take)
  summary.item_ref = item_ref_string(item)
  summary.start_seconds = readback_start
  summary.end_seconds = readback_end
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(item_object_ref(item), take_object_ref(take))
end
