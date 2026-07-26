-- Extracted E5-R1 routing read handlers.

local function e5_routing_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e5_routing_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e5_routing_append_refs(target, source)
  if not is_json_array(source) then
    return target
  end
  for index = 1, #source do
    target[#target + 1] = source[index]
  end
  return target
end

local function e5_routing_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function e5_routing_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e5_routing_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e5_routing_track_index(track)
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

local function e5_routing_track_ref_string(track)
  local guid = e5_routing_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e5_routing_track_index(track))
end

local function e5_routing_track_object_ref(track)
  local ref = e5_routing_track_ref_string(track)
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

local function e5_routing_envelope_object_ref(envelope, ref)
  local scheme, value = tostring(ref or ""):match("^envelope:([^:]+):(.+)$")
  return {
    kind = "envelope",
    ref = ref,
    identity = {
      scheme = scheme or "synthetic",
      value = value or tostring(ref or ""),
    },
  }
end

local function e5_routing_fx_object_ref(track, slot_index)
  local ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = {
      scheme = "track_fx",
      value = e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
    },
  }
end

local function e5_routing_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e5_routing_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e5_routing_resolve_track_token(token)
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
    return e5_routing_find_track_by_guid(guid)
  end
  return nil
end

local function e5_routing_fx_from_ref(fx_ref)
  if not is_string(fx_ref) then
    return nil, nil
  end
  local track_ref, slot_text = fx_ref:match("^fx:(track:[^:]+:.+):(%d+)$")
  if not track_ref or not slot_text then
    return nil, nil
  end
  local track = e5_routing_resolve_track_token(track_ref)
  local slot_index = tonumber(slot_text)
  if not track or not slot_index then
    return nil, nil
  end
  return track, math.floor(slot_index)
end

local function e5_routing_fx_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "fx" then
        local track, slot_index = e5_routing_fx_from_ref(ref.ref)
        if track then
          return track, slot_index
        end
      end
    end
  end
  return nil, nil
end

local function e5_routing_fx_owner_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "fx" then
    return nil, nil, nil, nil
  end
  local track_ref, track_slot = ref.ref:match("^fx:(track:[^:]+:.+):(%d+)$")
  if track_ref and track_slot then
    local track = e5_routing_resolve_track_token(track_ref)
    return track and "track" or nil, track, tonumber(track_slot), track_ref
  end
  local take_ref, take_slot = ref.ref:match("^fx:(take:[^:]+:.+):(%d+)$")
  if take_ref and take_slot then
    local take = READ_B_MEDIA.resolve_take_token(take_ref)
    return take and "take" or nil, take, tonumber(take_slot), take_ref
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  local owner_ref, slot_text
  if identity.scheme == "track_fx" then
    owner_ref, slot_text = tostring(identity.value or ""):match("^(track:[^:]+:.+):(%d+)$")
    local track = owner_ref and e5_routing_resolve_track_token(owner_ref) or nil
    return track and "track" or nil, track, tonumber(slot_text), owner_ref
  elseif identity.scheme == "take_fx" then
    owner_ref, slot_text = tostring(identity.value or ""):match("^(take:[^:]+:.+):(%d+)$")
    local take = owner_ref and READ_B_MEDIA.resolve_take_token(owner_ref) or nil
    return take and "take" or nil, take, tonumber(slot_text), owner_ref
  end
  return nil, nil, nil, nil
end

local function e5_routing_fx_owner_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local owner_kind, owner, slot_index, owner_ref = e5_routing_fx_owner_from_ref_object(request.refs[index])
      if owner then
        return owner_kind, owner, math.floor(slot_index), owner_ref, request.refs[index].ref
      end
    end
  end
  return nil, nil, nil, nil, nil
end

local function e5_routing_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e5_routing_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e5_routing_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e5_routing_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e5_routing_resolve_track_token(ref.ref)
end

local function e5_routing_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e5_routing_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e5_routing_send_ref(source_track, send_index)
  return "send:" .. e5_routing_track_ref_string(source_track) .. ":" .. tostring(send_index)
end

local function e5_routing_send_object_ref(source_track, send_index)
  local ref = e5_routing_send_ref(source_track, send_index)
  return {
    kind = "send",
    ref = ref,
    identity = {
      scheme = "track_send",
      value = e5_routing_track_ref_string(source_track) .. ":" .. tostring(send_index),
    },
  }
end

local function e5_routing_hardware_output_ref(track, output_index)
  return "hardware_output:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(output_index)
end

local function e5_routing_send_index_from_ref(send_ref)
  if not is_string(send_ref) then
    return nil
  end
  local track_ref, index_text = send_ref:match("^send:(track:[^:]+:.+):(%d+)$")
  if not track_ref then
    track_ref, index_text = send_ref:match("^send:track:(%d+):(%d+)$")
    if track_ref then
      track_ref = "track:index:" .. track_ref
    end
  end
  if not track_ref or not index_text then
    return nil, nil
  end
  local track = e5_routing_resolve_track_token(track_ref)
  local send_index = tonumber(index_text)
  if not track or not send_index then
    return nil, nil
  end
  return track, math.floor(send_index)
end

local function e5_routing_read_send_value(track, category, send_index, key, fallback)
  local ok, value = call_reaper("GetTrackSendInfo_Value", track, category, send_index, key)
  if ok then
    return first_number(value) or fallback
  end
  return fallback
end

local function e5_routing_read_send_number_exact(track, category, send_index, key)
  local ok, value = call_reaper("GetTrackSendInfo_Value", track, category, send_index, key)
  local number = ok and first_number(value) or nil
  if type(number) ~= "number" or number ~= number or number == math.huge or number == -math.huge then
    return nil
  end
  return number
end

local function e5_routing_send_mode_label(value)
  if value == 1 then
    return "pre_fx"
  elseif value == 3 then
    return "post_fx"
  end
  return "post_fader"
end

local function e5_routing_master_parent_enabled(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "B_MAINSEND")
  return ok and first_number(value) ~= 0 or false
end

local function e5_routing_master_parent_exact(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "B_MAINSEND")
  local number = ok and first_number(value) or nil
  if type(number) ~= "number" or number ~= number or number == math.huge or number == -math.huge then
    return nil
  end
  return number ~= 0
end

local function e5_routing_channel_count(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_NCHAN")
  local channels = ok and first_number(value) or 2
  if channels < 2 then
    return 2
  end
  return math.floor(channels)
end

local function e5_routing_channel_count_exact(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_NCHAN")
  local channels = ok and first_number(value) or nil
  if type(channels) ~= "number"
    or channels ~= channels
    or channels == math.huge
    or channels == -math.huge
    or channels < 2
    or channels > 128
    or channels ~= math.floor(channels)
    or channels % 2 ~= 0 then
    return nil
  end
  return channels
end

local function e5_routing_send_summary(source_track, send_index, category)
  local ok_destination, destination_track = call_reaper("GetTrackSendInfo_Value", source_track, category, send_index, "P_DESTTRACK")
  if not ok_destination or not destination_track then
    return nil
  end
  local volume = e5_routing_read_send_number_exact(source_track, category, send_index, "D_VOL")
  local pan = e5_routing_read_send_number_exact(source_track, category, send_index, "D_PAN")
  local muted = e5_routing_read_send_number_exact(source_track, category, send_index, "B_MUTE")
  local mode = e5_routing_read_send_number_exact(source_track, category, send_index, "I_SENDMODE")
  if volume == nil or pan == nil or muted == nil or mode == nil then
    return nil
  end
  return {
    send_ref = e5_routing_send_ref(source_track, send_index),
    category = category == -1 and "receive" or "send",
    source_track_ref = e5_routing_track_ref_string(source_track),
    destination_track_ref = e5_routing_track_ref_string(destination_track),
    index = send_index,
    volume = volume,
    pan = pan,
    muted = muted ~= 0,
    mode = e5_routing_send_mode_label(mode),
  }
end

local function e5_routing_compact_send_summary(source_track, send_index)
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return nil
  end
  return {
    send_ref = summary.send_ref,
    source_track_ref = summary.source_track_ref,
    destination_track_ref = summary.destination_track_ref,
    index = summary.index,
  }
end

local function e5_routing_send_count(track, category)
  local ok, count = call_reaper("GetTrackNumSends", track, category)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_routing_hardware_output_summary(track, hardware_index)
  local output_index = e5_routing_read_send_value(track, 1, hardware_index, "I_DSTCHAN", 0)
  local source_value = e5_routing_read_send_value(track, 1, hardware_index, "I_SRCCHAN", 0)
  local source_channel_offset = source_value % 1024
  local mix_to_mono = source_value >= 1024
  local ok_name, output_name = call_reaper("GetOutputChannelName", output_index)
  return {
    hardware_output_ref = e5_routing_hardware_output_ref(track, output_index),
    track_ref = e5_routing_track_ref_string(track),
    hardware_index = hardware_index,
    output_index = output_index,
    output_name = bounded_string(ok_name and first_string(output_name) or "", 160),
    source_channel_offset = source_channel_offset,
    source_channel_count = mix_to_mono and 1 or 2,
    mix_to_mono = mix_to_mono,
    muted = e5_routing_read_send_value(track, 1, hardware_index, "B_MUTE", 0) ~= 0,
  }
end

local function e5_routing_hardware_index_for_output(track, output_index)
  local count = e5_routing_send_count(track, 1)
  for hardware_index = 0, count - 1 do
    local current = e5_routing_read_send_value(track, 1, hardware_index, "I_DSTCHAN", -1)
    if current == output_index then
      return hardware_index
    end
  end
  return nil
end

local function e5_routing_hardware_source_value(request)
  local source_offset = math.max(0, math.floor(tonumber(request.params.source_channel_offset) or 0))
  local source_count = math.floor(tonumber(request.params.source_channel_count) or 2)
  if source_count ~= 1 and source_count ~= 2 then
    return nil
  end
  if request.params.mix_to_mono == true or source_count == 1 then
    return source_offset + 1024
  end
  return source_offset
end

local function e5_routing_output_index(request)
  local output_index = tonumber(request.params.output_index)
  if not output_index or output_index ~= output_index or output_index < 0 then
    return nil
  end
  return math.floor(output_index)
end

local function e5_routing_track_refs_from_request(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e5_routing_resolve_track_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function e5_routing_send_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "send" then
        local source_track, send_index = e5_routing_send_index_from_ref(ref.ref)
        if source_track then
          return source_track, send_index
        end
      end
    end
  end
  return nil, nil
end

local function e5_routing_send_index_for_destination(source_track, destination_track)
  local count = e5_routing_send_count(source_track, 0)
  local destination_ref = e5_routing_track_ref_string(destination_track)
  for send_index = 0, count - 1 do
    local summary = e5_routing_send_summary(source_track, send_index, 0)
    if summary and summary.destination_track_ref == destination_ref then
      return send_index
    end
  end
  return nil
end

local function e5_routing_write_summary(request, readback)
  readback = e5_routing_summary(request, readback)
  readback.undo_evidence = "required"
  return readback
end

local function e5_routing_set_media_track_value(track, key, value)
  local ok = call_reaper("SetMediaTrackInfo_Value", track, key, value)
  return ok == true
end

local function e5_routing_set_send_value(source_track, send_index, key, value)
  local ok = call_reaper("SetTrackSendInfo_Value", source_track, 0, send_index, key, value)
  return ok == true
end

local function e5_routing_clamp_number(value, min_value, max_value, fallback)
  local number = tonumber(value)
  if not number or number ~= number or number == math.huge or number == -math.huge then
    number = fallback
  end
  if number < min_value then
    number = min_value
  elseif number > max_value then
    number = max_value
  end
  return number
end

local function e5_routing_send_mode_value(mode)
  if mode == "pre_fx" then
    return 1
  elseif mode == "post_fx" then
    return 3
  end
  return 0
end

local function e5_routing_audio_channel_value(request)
  local source_offset = math.max(0, math.floor(tonumber(request.params.source_channel_offset) or 0))
  local source_count = math.floor(tonumber(request.params.source_channel_count) or 2)
  local destination_offset = math.max(0, math.floor(tonumber(request.params.destination_channel_offset) or 0))
  local source_value = source_offset
  if source_count == 1 or request.params.mix_to_mono == true then
    source_value = source_value + 1024
  end
  return source_value, destination_offset
end

local function e5_routing_midi_channel_number(value, fallback)
  if value == "all" or value == "original" or value == nil or value == JSON_NULL then
    return fallback or 0
  end
  local number = math.floor(tonumber(value) or 0)
  if number < 1 or number > 16 then
    return fallback or 0
  end
  return number
end

local function e5_routing_midi_flags(request)
  local source = e5_routing_midi_channel_number(request.params.source_channel, 0)
  local destination = e5_routing_midi_channel_number(request.params.destination_channel, 0)
  return source + destination * 32
end

local function e5_routing_read_sends(track, category, limit)
  local rows = json_array({})
  local refs = json_array({})
  local incomplete_reasons = json_array({})
  local ok_count, raw_count = call_reaper("GetTrackNumSends", track, category)
  local count = ok_count and first_number(raw_count) or nil
  local complete = true
  if type(count) ~= "number" or count ~= count or count == math.huge or count == -math.huge or count < 0 or count ~= math.floor(count) then
    count = 0
    complete = false
    incomplete_reasons[#incomplete_reasons + 1] = "SEND_COUNT_UNAVAILABLE"
  end
  local truncated = false
  for index = 0, count - 1 do
    if #rows >= limit then
      truncated = true
      break
    end
    local summary = e5_routing_send_summary(track, index, category)
    if summary then
      rows[#rows + 1] = summary
      refs[#refs + 1] = e5_routing_send_object_ref(track, index)
    else
      complete = false
      incomplete_reasons[#incomplete_reasons + 1] = "SEND_SUMMARY_UNAVAILABLE"
    end
  end
  return rows, refs, truncated, complete, incomplete_reasons
end

local function read_track_routing(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5-R1 read_track_routing requires a resolvable track ref.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_routes, 32, 128)
  local sends, send_refs, sends_truncated, sends_complete, send_incomplete_reasons = e5_routing_read_sends(track, 0, limit)
  local receives = json_array({})
  local receive_refs = json_array({})
  local receives_truncated = false
  local receives_complete = true
  local receive_incomplete_reasons = json_array({})
  if request.params.include_receives == true then
    receives, receive_refs, receives_truncated, receives_complete, receive_incomplete_reasons = e5_routing_read_sends(track, -1, limit)
  end
  local track_ref = e5_routing_track_ref_string(track)
  local refs = e5_routing_refs(e5_routing_track_object_ref(track))
  e5_routing_append_refs(refs, send_refs)
  e5_routing_append_refs(refs, receive_refs)
  local internally_complete = sends_complete and receives_complete
  local incomplete_reasons = json_array({})
  e5_routing_append_refs(incomplete_reasons, send_incomplete_reasons)
  e5_routing_append_refs(incomplete_reasons, receive_incomplete_reasons)
  local channel_count = e5_routing_channel_count_exact(track)
  if channel_count == nil then
    internally_complete = false
    incomplete_reasons[#incomplete_reasons + 1] = "TRACK_CHANNEL_COUNT_UNAVAILABLE"
  end
  local master_parent_enabled = JSON_NULL
  if request.params.include_master_parent ~= false then
    master_parent_enabled = e5_routing_master_parent_exact(track)
    if master_parent_enabled == nil then
      internally_complete = false
      master_parent_enabled = JSON_NULL
      incomplete_reasons[#incomplete_reasons + 1] = "MASTER_PARENT_STATE_UNAVAILABLE"
    end
  end
  return e5_routing_summary(request, {
    track_ref = track_ref,
    channel_count = channel_count == nil and JSON_NULL or channel_count,
    master_parent_enabled = master_parent_enabled,
    sends = sends,
    receives = receives,
    truncated = sends_truncated or receives_truncated,
    coverage_status = internally_complete and "complete" or "incomplete",
    coverage = {
      internally_complete = internally_complete,
      incomplete_reasons = incomplete_reasons,
    },
  }), nil, nil, nil, refs
end

local function list_track_hardware_outputs(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing list_track_hardware_outputs requires a resolvable track ref.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_outputs, 16, 64)
  local count = e5_routing_send_count(track, 1)
  local rows = json_array({})
  for hardware_index = 0, math.min(count, limit) - 1 do
    rows[#rows + 1] = e5_routing_hardware_output_summary(track, hardware_index)
  end
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    hardware_output_count = count,
    hardware_outputs = rows,
    truncated = count > limit,
  }), nil, nil, nil, e5_routing_refs(e5_routing_track_object_ref(track))
end

local function create_track_send(request)
  local tracks = e5_routing_track_refs_from_request(request)
  local source_track = tracks[1]
  local destination_track = tracks[2]
  if not source_track or not destination_track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing create_track_send requires source and destination track refs.", {})
  end
  local existing = e5_routing_send_index_for_destination(source_track, destination_track)
  if existing ~= nil and request.params.duplicate_policy == "reject_existing" then
    return e5_routing_error("SEND_NOT_FOUND", "E5 routing create_track_send rejected an existing duplicate send.", {
      send_ref = e5_routing_send_ref(source_track, existing),
    })
  end
  local send_index = nil
  if existing == nil or request.params.duplicate_policy == "allow_duplicate" then
    local ok, created_index = call_reaper("CreateTrackSend", source_track, destination_track)
    send_index = ok and first_number(created_index) or nil
  end
  if send_index == nil or send_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER did not create a track send.", {})
  end
  send_index = math.floor(send_index)
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "Created send could not be read back.", {
      send_index = send_index,
    })
  end
  summary.created = true
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track),
    e5_routing_track_object_ref(destination_track)
  )
end

local function e5_routing_update_send(request, setter)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 routing send update requires a resolvable send ref.", {})
  end
  if not setter(source_track, send_index) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the send update.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "Updated send could not be read back.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track)
  )
end

local function set_send_volume(request)
  local volume = e5_routing_clamp_number(request.params.volume, 0, 4, 1)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "D_VOL", volume)
  end)
end

local function set_send_pan(request)
  local pan = e5_routing_clamp_number(request.params.pan, -1, 1, 0)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "D_PAN", pan)
  end)
end

local function set_send_mute(request)
  local muted = request.params.muted == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_MUTE", muted)
  end)
end

local function set_send_mode(request)
  local mode = e5_routing_send_mode_value(request.params.mode)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_SENDMODE", mode)
  end)
end

local function set_send_audio_channels(request)
  local source_value, destination_value = e5_routing_audio_channel_value(request)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_SRCCHAN", source_value)
      and e5_routing_set_send_value(source_track, send_index, "I_DSTCHAN", destination_value)
  end)
end

local function set_send_phase(request)
  local phase = request.params.phase_inverted == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_PHASE", phase)
  end)
end

local function set_send_mono(request)
  local mono = request.params.mono == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_MONO", mono)
  end)
end

local function set_send_midi_channels(request)
  local flags = e5_routing_midi_flags(request)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_MIDIFLAGS", flags)
  end)
end

local function set_master_parent_send(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_master_parent_send requires a resolvable track ref.", {})
  end
  if not e5_routing_set_media_track_value(track, "B_MAINSEND", request.params.enabled == true and 1 or 0) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the master-parent send update.", {})
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    master_parent_enabled = e5_routing_master_parent_enabled(track),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_channel_count(request)
  local channels = request.params.channel_count
  local requested_detail = channels
  if type(channels) == "number"
    and (channels ~= channels or channels == math.huge or channels == -math.huge) then
    requested_detail = JSON_NULL
  end
  if type(channels) ~= "number"
    or channels ~= channels
    or channels == math.huge
    or channels == -math.huge
    or channels < 2
    or channels > 128
    or channels ~= math.floor(channels)
    or channels % 2 ~= 0 then
    return e5_routing_error("PARAMS_INVALID", "Track channel_count must be an even integer from 2 through 128.", {
      reason_code = "TRACK_CHANNEL_COUNT_INVALID",
      requested_channel_count = requested_detail == nil and JSON_NULL or requested_detail,
    })
  end
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_track_channel_count requires a resolvable track ref.", {})
  end
  local dispatch_ok, accepted = call_reaper("SetMediaTrackInfo_Value", track, "I_NCHAN", channels)
  if not dispatch_ok or accepted ~= true then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the track channel-count update.", {})
  end
  local readback_channels = e5_routing_channel_count_exact(track)
  if readback_channels ~= channels then
    return e5_routing_error("VERIFY_FAILED", "Track channel-count mutation did not read back the exact requested value.", {
      reason_code = "TRACK_CHANNEL_COUNT_READBACK_MISMATCH",
      requested_channel_count = channels,
      actual_channel_count = readback_channels == nil and JSON_NULL or readback_channels,
      mutation_applied = true,
    }, false)
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    channel_count = readback_channels,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function track_mono_or_stereo_button(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing track_mono_or_stereo_button requires a resolvable track ref.", {})
  end
  local mode = request.params.mode
  if mode ~= "mono" and mode ~= "stereo" then
    return e5_routing_error("PARAMS_INVALID", "Track mono/stereo mode must be mono or stereo.", {
      mode = request.params.mode,
    })
  end
  local channels = mode == "mono" and 1 or 2
  if not e5_routing_set_media_track_value(track, "I_NCHAN", channels) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the track mono/stereo update.", {
      mode = mode,
    }, false)
  end
  local readback_channels = e5_routing_channel_count(track)
  local readback_mode = readback_channels <= 1 and "mono" or "stereo"
  if readback_mode ~= mode then
    return e5_routing_error("READBACK_MISMATCH", "Track mono/stereo mode did not read back the requested value.", {
      requested_mode = mode,
      readback_mode = readback_mode,
      readback_channel_count = readback_channels,
    }, false)
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    mode = readback_mode,
    channel_count = readback_channels,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_hardware_output(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_track_hardware_output requires a resolvable track ref.", {})
  end
  local output_index = e5_routing_output_index(request)
  local source_value = e5_routing_hardware_source_value(request)
  if output_index == nil or source_value == nil then
    return e5_routing_error("PARAMS_INVALID", "Hardware output requires output_index >= 0 and source_channel_count of 1 or 2.", {
      output_index = request.params.output_index,
      source_channel_count = request.params.source_channel_count,
    })
  end
  local hardware_index = e5_routing_hardware_index_for_output(track, output_index)
  if hardware_index == nil then
    local ok_create, created_index = call_reaper("CreateTrackSend", track, nil)
    hardware_index = ok_create and first_number(created_index) or nil
  end
  if hardware_index == nil or hardware_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER did not create a hardware output send.", {}, false)
  end
  hardware_index = math.floor(hardware_index)
  local ok_dst = call_reaper("SetTrackSendInfo_Value", track, 1, hardware_index, "I_DSTCHAN", output_index)
  local ok_src = call_reaper("SetTrackSendInfo_Value", track, 1, hardware_index, "I_SRCCHAN", source_value)
  if not ok_dst or not ok_src then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the hardware output update.", {
      output_index = output_index,
    }, false)
  end
  local summary = e5_routing_hardware_output_summary(track, hardware_index)
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function remove_track_hardware_output(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing remove_track_hardware_output requires a resolvable track ref.", {})
  end
  local output_index = e5_routing_output_index(request)
  if output_index == nil then
    return e5_routing_error("PARAMS_INVALID", "Hardware output removal requires output_index >= 0.", {
      output_index = request.params.output_index,
    })
  end
  local hardware_index = e5_routing_hardware_index_for_output(track, output_index)
  if hardware_index == nil then
    if request.params.missing_policy == "error" then
      return e5_routing_error("HARDWARE_OUTPUT_NOT_FOUND", "Requested hardware output assignment was not found.", {
        output_index = output_index,
      })
    end
    return e5_routing_write_summary(request, {
      track_ref = e5_routing_track_ref_string(track),
      output_index = output_index,
      removed = false,
    }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
  end
  local ok_remove = call_reaper("RemoveTrackSend", track, 1, hardware_index)
  if not ok_remove then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the hardware output removal.", {
      output_index = output_index,
    }, false)
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    output_index = output_index,
    removed = e5_routing_hardware_index_for_output(track, output_index) == nil,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function resolve_send_ref(request)
  local source_track, send_index = e5_routing_send_index_from_ref(request.params.send_ref)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5-R1 resolve_send_ref requires send:<track-ref>:<index>.", {
      send_ref = bounded_string(request.params.send_ref, 160),
    })
  end
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "E5-R1 resolve_send_ref could not resolve the requested send.", {
      send_ref = bounded_string(request.params.send_ref, 160),
    })
  end
  return e5_routing_summary(request, summary), nil, nil, nil, e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track)
  )
end

local function list_available_audio_outputs(request)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_outputs, 32, 128)
  local outputs = json_array({})
  local scanned = 0
  for output_index = 0, 127 do
    local ok, name = call_reaper("GetOutputChannelName", output_index)
    scanned = scanned + 1
    local label = ok and first_string(name) or ""
    if label ~= "" or request.params.include_unavailable == true then
      outputs[#outputs + 1] = {
        output_index = output_index,
        name = bounded_string(label, 160),
        available = label ~= "",
      }
      if #outputs >= limit then
        break
      end
    end
  end
  return e5_routing_summary(request, {
    audio_outputs = outputs,
    returned_output_count = #outputs,
    scanned_output_count = scanned,
    truncated = #outputs >= limit and scanned < 128,
  }), nil, nil, nil, e5_routing_refs()
end

local function read_project_routing_graph(request)
  local function requested_track_refs(value)
    local ordered = json_array({})
    local lookup = {}
    if is_json_array(value) then
      for index = 1, #value do
        local ref = value[index]
        if is_string(ref) and not lookup[ref] then
          lookup[ref] = true
          ordered[#ordered + 1] = ref
        end
      end
    end
    return ordered, lookup
  end
  local internally_complete = true
  local incomplete_reasons = json_array({})
  local seen_incomplete_reasons = {}
  local function mark_incomplete(reason)
    internally_complete = false
    if not seen_incomplete_reasons[reason] then
      seen_incomplete_reasons[reason] = true
      incomplete_reasons[#incomplete_reasons + 1] = reason
    end
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or nil
  if type(total) ~= "number" or total ~= total or total == math.huge or total == -math.huge or total < 0 or total ~= math.floor(total) then
    total = 0
    mark_incomplete("TRACK_COUNT_UNAVAILABLE")
  end
  local max_tracks = READ_B_MEDIA.bounded_limit(request, request.params.max_tracks, 8, 128)
  local max_edges = READ_B_MEDIA.bounded_limit(request, request.params.max_edges, 24, 256)
  local edge_cursor = math.max(0, math.floor(tonumber(request.params.edge_cursor) or 0))
  local include_tracks = request.params.include_tracks ~= false
  local resolve_track_refs, resolve_track_lookup = requested_track_refs(request.params.resolve_track_refs)
  local state_track_refs, state_track_lookup = requested_track_refs(request.params.state_track_refs)
  local filter_track_state = #state_track_refs > 0
  local resolved_track_lookup = {}
  local resolved_track_ref_count = 0
  local emitted_track_ref_lookup = {}
  local edge_track_ref_lookup = {}
  local scanned_track_refs = json_array({})
  local track_objects_by_ref = {}
  local tracks = json_array({})
  local edges = json_array({})
  local refs = json_array({})
  local track_truncated = total > max_tracks
  local total_edge_count = 0
  local scanned_track_count = 0
  for index = 0, math.min(total, max_tracks) - 1 do
    scanned_track_count = scanned_track_count + 1
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      local track_ref = e5_routing_track_ref_string(track)
      scanned_track_refs[#scanned_track_refs + 1] = track_ref
      track_objects_by_ref[track_ref] = track
      local include_track_row = include_tracks and (not filter_track_state or state_track_lookup[track_ref] == true)
      if include_track_row then
        local channel_count = e5_routing_channel_count_exact(track)
        if channel_count == nil then
          mark_incomplete("TRACK_CHANNEL_COUNT_UNAVAILABLE")
        end
        local master_parent_enabled = JSON_NULL
        if request.params.include_master_parent ~= false then
          master_parent_enabled = e5_routing_master_parent_exact(track)
          if master_parent_enabled == nil then
            master_parent_enabled = JSON_NULL
            mark_incomplete("MASTER_PARENT_STATE_UNAVAILABLE")
          end
        end
        tracks[#tracks + 1] = {
          track_ref = track_ref,
          index = index,
          channel_count = channel_count == nil and JSON_NULL or channel_count,
          master_parent_enabled = master_parent_enabled,
        }
      end
      if resolve_track_lookup[track_ref] == true or include_track_row then
        refs[#refs + 1] = e5_routing_track_object_ref(track)
        emitted_track_ref_lookup[track_ref] = true
      end
      if resolve_track_lookup[track_ref] == true and not resolved_track_lookup[track_ref] then
        resolved_track_lookup[track_ref] = true
        resolved_track_ref_count = resolved_track_ref_count + 1
      end
      local ok_send_count, send_count = call_reaper("GetTrackNumSends", track, 0)
      send_count = ok_send_count and first_number(send_count) or nil
      if type(send_count) ~= "number" or send_count ~= send_count or send_count == math.huge or send_count == -math.huge or send_count < 0 or send_count ~= math.floor(send_count) then
        send_count = 0
        mark_incomplete("SEND_COUNT_UNAVAILABLE")
      end
      for send_index = 0, send_count - 1 do
        local summary = e5_routing_compact_send_summary(track, send_index)
        if summary then
          if total_edge_count >= edge_cursor and #edges < max_edges then
            edges[#edges + 1] = summary
            refs[#refs + 1] = e5_routing_send_object_ref(track, send_index)
            edge_track_ref_lookup[summary.source_track_ref] = true
            edge_track_ref_lookup[summary.destination_track_ref] = true
          end
          total_edge_count = total_edge_count + 1
        else
          mark_incomplete("SEND_SUMMARY_UNAVAILABLE")
        end
      end
    else
      mark_incomplete("TRACK_READ_FAILED")
    end
  end
  local next_edge_cursor = edge_cursor + #edges
  local edges_truncated = next_edge_cursor < total_edge_count
  local truncated = track_truncated or edges_truncated
  for index = 1, #scanned_track_refs do
    local track_ref = scanned_track_refs[index]
    if edge_track_ref_lookup[track_ref] and not emitted_track_ref_lookup[track_ref] then
      refs[#refs + 1] = e5_routing_track_object_ref(track_objects_by_ref[track_ref])
      emitted_track_ref_lookup[track_ref] = true
    end
  end
  local missing_track_refs = json_array({})
  for index = 1, #resolve_track_refs do
    local ref = resolve_track_refs[index]
    if not resolved_track_lookup[ref] then
      missing_track_refs[#missing_track_refs + 1] = ref
    end
  end
  return e5_routing_summary(request, {
    track_count = total,
    scanned_track_count = scanned_track_count,
    returned_track_count = #tracks,
    requested_track_ref_count = #resolve_track_refs,
    resolved_track_ref_count = resolved_track_ref_count,
    missing_track_refs = missing_track_refs,
    edge_count = #edges,
    total_edge_count = total_edge_count,
    returned_edge_count = #edges,
    edge_cursor = edge_cursor,
    tracks = tracks,
    edges = edges,
    truncated = truncated,
    coverage_status = not internally_complete and "incomplete" or (truncated and "paged" or "complete"),
    coverage = {
      internally_complete = internally_complete,
      incomplete_reasons = incomplete_reasons,
      track_truncated = track_truncated,
      edges_truncated = edges_truncated,
    },
    next_edge_cursor = edges_truncated and tostring(next_edge_cursor) or nil,
  }), nil, nil, nil, refs
end

local function read_fx_pin_mapping(request)
  local track, slot_index = e5_routing_fx_from_request_refs(request)
  if not track then
    return e5_routing_error("FX_REF_NOT_FOUND", "E5 routing read_fx_pin_mapping requires a resolvable track FX ref.", {})
  end
  local ok_count, count = call_reaper("TrackFX_GetCount", track)
  local fx_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  if slot_index < 0 or slot_index >= fx_count then
    return e5_routing_error("FX_SLOT_NOT_FOUND", "E5 routing read_fx_pin_mapping slot index is outside the track FX chain.", {
      slot_index = slot_index,
      fx_count = fx_count,
    })
  end
  local direction = request.params.direction == "output" and "output" or "input"
  local is_output = direction == "output" and 1 or 0
  local pin_index = math.max(0, math.floor(tonumber(request.params.pin_index) or 0))
  local ok, low32, high32 = call_reaper("TrackFX_GetPinMappings", track, slot_index, is_output, pin_index)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected TrackFX_GetPinMappings.", {
      slot_index = slot_index,
      direction = direction,
      pin_index = pin_index,
    })
  end
  low32 = first_number(low32) or 0
  high32 = first_number(high32) or 0
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    fx_ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
    slot_index = slot_index,
    direction = direction,
    pin_index = pin_index,
    low32 = low32,
    high32 = high32,
    truncated = false,
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_track_object_ref(track),
    e5_routing_fx_object_ref(track, slot_index)
  )
end

local function e5_automation_envelope_key(value)
  local raw = is_string(value) and value or "Volume"
  local lowered = raw:lower()
  if lowered == "volume" or lowered == "vol" or lowered == "<volenv" then
    return "volume", "Volume", "<VOLENV", 0
  elseif lowered == "pan" or lowered == "<panenv" then
    return "pan", "Pan", "<PANENV", 1
  elseif lowered == "mute" or lowered == "<muteenv" then
    return "mute", "Mute", "<MUTEENV", 2
  end
  return "volume", "Volume", "<VOLENV", 0
end

local function e5_automation_track_envelope(track, name_or_key)
  local key, display_name, chunk_name = e5_automation_envelope_key(name_or_key)
  local ok_named, envelope = call_reaper("GetTrackEnvelopeByName", track, display_name)
  if ok_named and envelope then
    return envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  local ok_chunk, chunk_envelope = call_reaper("GetTrackEnvelopeByChunkName", track, chunk_name)
  if ok_chunk and chunk_envelope then
    return chunk_envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  local ok_media, media_envelope = call_reaper("GetMediaTrackInfo_Value", track, "P_ENV:" .. chunk_name)
  if ok_media and media_envelope then
    return media_envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  return nil, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
end

local function e5_automation_send_envelope(source_track, send_index, name_or_key)
  local key, display_name, chunk_name, envelope_type = e5_automation_envelope_key(name_or_key)
  local send_ref = e5_routing_send_ref(source_track, send_index)
  local ok_br, br_env = call_reaper("BR_GetMediaTrackSendInfo_Envelope", source_track, 0, send_index, envelope_type)
  if ok_br and br_env then
    return br_env, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
  end
  local ok_send, envelope = call_reaper("GetTrackSendInfo_Value", source_track, 0, send_index, "P_ENV:" .. chunk_name)
  if ok_send and envelope then
    return envelope, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
  end
  return nil, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
end

local function e5_automation_envelope_guid(envelope)
  local ok, _, guid = call_reaper("GetSetEnvelopeInfo_String", envelope, "GUID", "", false)
  guid = ok and first_string(guid) or nil
  if guid and guid ~= "" then
    return guid
  end
  return nil
end

local function e5_automation_canonical_envelope_type(envelope, parent_kind, parent, name, fallback_type)
  if parent_kind == "track" and parent then
    for _, spec in ipairs({
      { key = "volume", chunk_name = "<VOLENV" },
      { key = "pan", chunk_name = "<PANENV" },
      { key = "mute", chunk_name = "<MUTEENV" },
    }) do
      local ok_candidate, candidate = call_reaper("GetTrackEnvelopeByChunkName", parent, spec.chunk_name)
      if ok_candidate and candidate and candidate == envelope then
        return spec.key
      end
    end
  elseif parent_kind == "take" and parent then
    for _, spec in ipairs({
      { key = "volume", display_name = "Volume" },
      { key = "pan", display_name = "Pan" },
      { key = "mute", display_name = "Mute" },
      { key = "pitch", display_name = "Pitch" },
    }) do
      local ok_candidate, candidate = call_reaper("GetTakeEnvelopeByName", parent, spec.display_name)
      if ok_candidate and candidate and candidate == envelope then
        return spec.key
      end
    end
  end

  local normalized = tostring(name or ""):lower()
  normalized = normalized:gsub("^%s+", ""):gsub("%s+$", "")
  normalized = normalized:gsub("^track%s+", ""):gsub("^take%s+", ""):gsub("^send%s+", "")
  if normalized == "volume" or normalized:match("^volume%s*%(") or normalized:match("^trim%s+volume") then
    return "volume"
  elseif normalized == "pan" or normalized:match("^pan%s*%(") then
    return "pan"
  elseif normalized == "mute" or normalized:match("^mute%s*%(") then
    return "mute"
  elseif normalized == "pitch" or normalized:match("^pitch%s*%(") then
    return "pitch"
  elseif parent_kind == "fx" then
    return "fx_parameter"
  end
  return fallback_type or parent_kind or "unknown"
end

local function e5_automation_envelope_fingerprint(envelope, fallback_name, envelope_type, parent_kind, parent)
  local ok_name, _, name = call_reaper("GetEnvelopeName", envelope, "")
  name = bounded_string(ok_name and first_string(name) or fallback_name or "Envelope", 160)
  local canonical_type = e5_automation_canonical_envelope_type(envelope, parent_kind, parent, name, envelope_type)
  local ok_scaling, scaling = call_reaper("GetEnvelopeScalingMode", envelope)
  scaling = ok_scaling and math.floor(first_number(scaling) or 0) or 0
  local source = tostring(canonical_type) .. "\31" .. name .. "\31" .. tostring(scaling)
  local checksum = 0
  for index = 1, #source do
    checksum = (checksum * 131 + source:byte(index)) % 2147483647
  end
  return tostring(checksum), name, scaling, canonical_type
end

local function e5_automation_preferred_ref(envelope, fallback_ref)
  local guid = e5_automation_envelope_guid(envelope)
  if guid then
    return "envelope:guid:" .. guid, true
  end
  return fallback_ref, false
end

local function e5_automation_each_project_envelope(visitor)
  local seen = {}
  local complete = true
  local reasons = {}
  local function mark_incomplete(reason)
    complete = false
    reasons[reason] = true
  end
  local function visit(envelope, info)
    if envelope and not seen[envelope] then
      seen[envelope] = true
      visitor(envelope, info)
    end
  end

  local ok_master, master_track = call_reaper("GetMasterTrack", 0)
  if not ok_master or not master_track then
    mark_incomplete("MASTER_TRACK_READ_FAILED")
  else
    local master_ref = e5_routing_track_ref_string(master_track)
    local ok_master_fx_count, master_fx_count = call_reaper("TrackFX_GetCount", master_track)
    master_fx_count = ok_master_fx_count and math.max(0, math.floor(first_number(master_fx_count) or 0)) or 0
    if not ok_master_fx_count then
      mark_incomplete("MASTER_FX_COUNT_UNAVAILABLE")
    end
    for fx_index = 0, master_fx_count - 1 do
      local ok_param_count, param_count = call_reaper("TrackFX_GetNumParams", master_track, fx_index)
      param_count = ok_param_count and math.max(0, math.floor(first_number(param_count) or 0)) or 0
      if not ok_param_count then
        mark_incomplete("MASTER_FX_PARAMETER_COUNT_UNAVAILABLE")
      end
      for param_index = 0, param_count - 1 do
        local ok_envelope, envelope = call_reaper("GetFXEnvelope", master_track, fx_index, param_index, false)
        if not ok_envelope then
          mark_incomplete("MASTER_FX_ENVELOPE_READ_FAILED")
        elseif envelope then
          local ok_name, _, param_name = call_reaper("TrackFX_GetParamName", master_track, fx_index, param_index, "")
          param_name = bounded_string(ok_name and first_string(param_name) or "Master FX parameter", 160)
          local fingerprint = e5_automation_envelope_fingerprint(envelope, param_name, "fx_parameter", "fx", master_track)
          visit(envelope, {
            parent_kind = "fx",
            owner_kind = "track",
            owner = master_track,
            owner_ref = "fx:" .. master_ref .. ":" .. tostring(fx_index),
            key = "fx_parameter",
            name = param_name,
            fallback_ref = "envelope:fx:" .. master_ref .. ":" .. tostring(fx_index) .. ":param:" .. tostring(param_index) .. ":fingerprint:" .. fingerprint,
          })
        end
      end
    end
    local ok_master_envelope_count, master_envelope_count = call_reaper("CountTrackEnvelopes", master_track)
    master_envelope_count = ok_master_envelope_count and math.max(0, math.floor(first_number(master_envelope_count) or 0)) or 0
    if not ok_master_envelope_count then
      mark_incomplete("MASTER_ENVELOPE_COUNT_UNAVAILABLE")
    end
    for envelope_index = 0, master_envelope_count - 1 do
      local ok_envelope, envelope = call_reaper("GetTrackEnvelope", master_track, envelope_index)
      if not ok_envelope or not envelope then
        mark_incomplete("MASTER_ENVELOPE_READ_FAILED")
      else
        local fingerprint, name, _, key = e5_automation_envelope_fingerprint(envelope, "Master envelope", "track", "track", master_track)
        visit(envelope, {
          parent_kind = "track",
          track = master_track,
          owner_ref = master_ref,
          key = key,
          name = name,
          fallback_ref = "envelope:track:" .. master_ref .. ":index:" .. tostring(envelope_index) .. ":fingerprint:" .. fingerprint,
        })
      end
    end
  end

  local ok_tracks, track_count = call_reaper("CountTracks", 0)
  track_count = ok_tracks and math.max(0, math.floor(first_number(track_count) or 0)) or 0
  if not ok_tracks then
    mark_incomplete("TRACK_COUNT_UNAVAILABLE")
  end
  for track_index = 0, track_count - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, track_index)
    if not ok_track or not track then
      mark_incomplete("TRACK_READ_FAILED")
    else
      local track_ref = e5_routing_track_ref_string(track)

      local ok_fx_count, fx_count = call_reaper("TrackFX_GetCount", track)
      fx_count = ok_fx_count and math.max(0, math.floor(first_number(fx_count) or 0)) or 0
      if not ok_fx_count then
        mark_incomplete("FX_COUNT_UNAVAILABLE")
      end
      for fx_index = 0, fx_count - 1 do
        local ok_param_count, param_count = call_reaper("TrackFX_GetNumParams", track, fx_index)
        param_count = ok_param_count and math.max(0, math.floor(first_number(param_count) or 0)) or 0
        if not ok_param_count then
          mark_incomplete("FX_PARAMETER_COUNT_UNAVAILABLE")
        end
        for param_index = 0, param_count - 1 do
          local ok_envelope, envelope = call_reaper("GetFXEnvelope", track, fx_index, param_index, false)
          if not ok_envelope then
            mark_incomplete("FX_ENVELOPE_READ_FAILED")
          elseif envelope then
            local ok_name, _, param_name = call_reaper("TrackFX_GetParamName", track, fx_index, param_index, "")
            param_name = bounded_string(ok_name and first_string(param_name) or "FX parameter", 160)
            local fingerprint = e5_automation_envelope_fingerprint(envelope, param_name, "fx_parameter", "fx", track)
            visit(envelope, {
              parent_kind = "fx",
              owner_kind = "track",
              owner = track,
              owner_ref = "fx:" .. track_ref .. ":" .. tostring(fx_index),
              key = "fx_parameter",
              name = param_name,
              fallback_ref = "envelope:fx:" .. track_ref .. ":" .. tostring(fx_index) .. ":param:" .. tostring(param_index) .. ":fingerprint:" .. fingerprint,
            })
          end
        end
      end

      local ok_send_count, send_count = call_reaper("GetTrackNumSends", track, 0)
      send_count = ok_send_count and math.max(0, math.floor(first_number(send_count) or 0)) or 0
      if not ok_send_count then
        mark_incomplete("SEND_COUNT_UNAVAILABLE")
      end
      for send_index = 0, send_count - 1 do
        for _, envelope_type in ipairs({ "volume", "pan", "mute" }) do
          local envelope, compatibility_ref, _, key, display_name = e5_automation_send_envelope(track, send_index, envelope_type)
          if envelope then
            local fingerprint = e5_automation_envelope_fingerprint(envelope, display_name, key, "send", track)
            visit(envelope, {
              parent_kind = "send",
              track = track,
              owner_ref = e5_routing_send_ref(track, send_index),
              key = key,
              name = display_name,
              compatibility_ref = compatibility_ref,
              fallback_ref = compatibility_ref .. ":fingerprint:" .. fingerprint,
            })
          end
        end
      end

      local ok_envelope_count, envelope_count = call_reaper("CountTrackEnvelopes", track)
      envelope_count = ok_envelope_count and math.max(0, math.floor(first_number(envelope_count) or 0)) or 0
      if not ok_envelope_count then
        mark_incomplete("TRACK_ENVELOPE_COUNT_UNAVAILABLE")
      end
      for envelope_index = 0, envelope_count - 1 do
        local ok_envelope, envelope = call_reaper("GetTrackEnvelope", track, envelope_index)
        if not ok_envelope or not envelope then
          mark_incomplete("TRACK_ENVELOPE_READ_FAILED")
        else
          local fingerprint, name, _, key = e5_automation_envelope_fingerprint(envelope, "Track envelope", "track", "track", track)
          visit(envelope, {
            parent_kind = "track",
            track = track,
            owner_ref = track_ref,
            key = key,
            name = name,
            fallback_ref = "envelope:track:" .. track_ref .. ":index:" .. tostring(envelope_index) .. ":fingerprint:" .. fingerprint,
          })
        end
      end
    end
  end

  local ok_items, item_count = call_reaper("CountMediaItems", 0)
  item_count = ok_items and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  if not ok_items then
    mark_incomplete("ITEM_COUNT_UNAVAILABLE")
  end
  for item_index = 0, item_count - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if not ok_item or not item then
      mark_incomplete("ITEM_READ_FAILED")
    else
      local ok_takes, take_count = call_reaper("CountTakes", item)
      take_count = ok_takes and math.max(0, math.floor(first_number(take_count) or 0)) or 0
      if not ok_takes then
        mark_incomplete("TAKE_COUNT_UNAVAILABLE")
      end
      for take_index = 0, take_count - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if not ok_take or not take then
          mark_incomplete("TAKE_READ_FAILED")
        else
          local take_ref = READ_B_MEDIA.take_ref_string(take)
          local ok_take_fx_count, take_fx_count = call_reaper("TakeFX_GetCount", take)
          take_fx_count = ok_take_fx_count and math.max(0, math.floor(first_number(take_fx_count) or 0)) or 0
          if not ok_take_fx_count then
            mark_incomplete("TAKE_FX_COUNT_UNAVAILABLE")
          end
          for fx_index = 0, take_fx_count - 1 do
            local ok_param_count, param_count = call_reaper("TakeFX_GetNumParams", take, fx_index)
            param_count = ok_param_count and math.max(0, math.floor(first_number(param_count) or 0)) or 0
            if not ok_param_count then
              mark_incomplete("TAKE_FX_PARAMETER_COUNT_UNAVAILABLE")
            end
            for param_index = 0, param_count - 1 do
              local ok_envelope, envelope = call_reaper("TakeFX_GetEnvelope", take, fx_index, param_index, false)
              if not ok_envelope then
                mark_incomplete("TAKE_FX_ENVELOPE_READ_FAILED")
              elseif envelope then
                local ok_name, _, param_name = call_reaper("TakeFX_GetParamName", take, fx_index, param_index, "")
                param_name = bounded_string(ok_name and first_string(param_name) or "Take FX parameter", 160)
                local fingerprint = e5_automation_envelope_fingerprint(envelope, param_name, "fx_parameter", "fx", take)
                visit(envelope, {
                  parent_kind = "fx",
                  owner_kind = "take",
                  owner = take,
                  take = take,
                  owner_ref = "fx:" .. take_ref .. ":" .. tostring(fx_index),
                  key = "fx_parameter",
                  name = param_name,
                  fallback_ref = "envelope:fx:" .. take_ref .. ":" .. tostring(fx_index) .. ":param:" .. tostring(param_index) .. ":fingerprint:" .. fingerprint,
                })
              end
            end
          end
          local ok_envelope_count, envelope_count = call_reaper("CountTakeEnvelopes", take)
          envelope_count = ok_envelope_count and math.max(0, math.floor(first_number(envelope_count) or 0)) or 0
          if not ok_envelope_count then
            mark_incomplete("TAKE_ENVELOPE_COUNT_UNAVAILABLE")
          end
          for envelope_index = 0, envelope_count - 1 do
            local ok_envelope, envelope = call_reaper("GetTakeEnvelope", take, envelope_index)
            if not ok_envelope or not envelope then
              mark_incomplete("TAKE_ENVELOPE_READ_FAILED")
            else
              local fingerprint, name, _, key = e5_automation_envelope_fingerprint(envelope, "Take envelope", "take", "take", take)
              visit(envelope, {
                parent_kind = "take",
                take = take,
                owner_ref = take_ref,
                key = key,
                name = name,
                fallback_ref = "envelope:take:" .. take_ref .. ":index:" .. tostring(envelope_index) .. ":fingerprint:" .. fingerprint,
              })
            end
          end
        end
      end
    end
  end

  local reason_list = json_array({})
  for reason in pairs(reasons) do
    reason_list[#reason_list + 1] = reason
  end
  table.sort(reason_list)
  return complete, reason_list
end

local function e5_automation_envelope_by_guid(guid)
  local found = nil
  local info = nil
  local matches = 0
  local complete = e5_automation_each_project_envelope(function(envelope, candidate_info)
    if e5_automation_envelope_guid(envelope) == guid then
      found = envelope
      info = candidate_info
      matches = matches + 1
    end
  end)
  if not complete or matches ~= 1 then
    return nil
  end
  return found, info
end

local function e5_automation_snapshot_ref_matches(envelope, expected_fingerprint, fallback_name, envelope_type, parent_kind, parent)
  local actual = e5_automation_envelope_fingerprint(envelope, fallback_name, envelope_type, parent_kind, parent)
  return actual == expected_fingerprint
end

local function e5_automation_envelope_from_ref_string(ref)
  if not is_string(ref) then
    return nil
  end
  local guid = ref:match("^envelope:guid:(.+)$")
  if guid then
    local envelope, info = e5_automation_envelope_by_guid(guid)
    if not envelope then
      return nil
    end
    return envelope, ref, info.parent_kind, info.key, info.name, info
  end
  local key = ref:match("^envelope:track:(%a+)$")
  if key then
    local track = e5_routing_resolve_track_token("track:index:0")
    if not track then
      return nil
    end
    local envelope, envelope_ref, parent_kind, resolved_key, name = e5_automation_track_envelope(track, key)
    return envelope, envelope_ref, parent_kind, resolved_key, name, { track = track, owner_ref = e5_routing_track_ref_string(track) }
  end
  local track_ref, track_key = ref:match("^envelope:track:(track:[^:]+:.+):(%a+)$")
  if track_ref and track_key then
    local track = e5_routing_resolve_track_token(track_ref)
    if not track then
      return nil
    end
    local envelope, envelope_ref, parent_kind, resolved_key, name = e5_automation_track_envelope(track, track_key)
    return envelope, envelope_ref, parent_kind, resolved_key, name, { track = track, owner_ref = e5_routing_track_ref_string(track) }
  end
  local snapshot_track_ref, snapshot_index, snapshot_fingerprint = ref:match("^envelope:track:(track:[^:]+:.+):index:(%d+):fingerprint:(%d+)$")
  if snapshot_track_ref then
    local track = e5_routing_resolve_track_token(snapshot_track_ref)
    local ok_envelope, envelope = false, nil
    if track then
      ok_envelope, envelope = call_reaper("GetTrackEnvelope", track, tonumber(snapshot_index))
    end
    if ok_envelope and envelope and e5_automation_snapshot_ref_matches(envelope, snapshot_fingerprint, "Track envelope", "track", "track", track) then
      local _, name, _, key = e5_automation_envelope_fingerprint(envelope, "Track envelope", "track", "track", track)
      return envelope, ref, "track", key, name, { track = track, owner_ref = snapshot_track_ref }
    end
    return nil
  end
  local take_ref, take_index, take_fingerprint = ref:match("^envelope:take:(take:[^:]+:.+):index:(%d+):fingerprint:(%d+)$")
  if take_ref then
    local take = READ_B_MEDIA.resolve_take_token(take_ref)
    local ok_envelope, envelope = false, nil
    if take then
      ok_envelope, envelope = call_reaper("GetTakeEnvelope", take, tonumber(take_index))
    end
    if ok_envelope and envelope and e5_automation_snapshot_ref_matches(envelope, take_fingerprint, "Take envelope", "take", "take", take) then
      local _, name, _, key = e5_automation_envelope_fingerprint(envelope, "Take envelope", "take", "take", take)
      return envelope, ref, "take", key, name, { take = take, owner_ref = take_ref }
    end
    return nil
  end
  local fx_track_ref, fx_index, param_index, fx_fingerprint = ref:match("^envelope:fx:(track:[^:]+:.+):(%d+):param:(%d+):fingerprint:(%d+)$")
  if fx_track_ref then
    local track = e5_routing_resolve_track_token(fx_track_ref)
    local ok_envelope, envelope = false, nil
    if track then
      ok_envelope, envelope = call_reaper("GetFXEnvelope", track, tonumber(fx_index), tonumber(param_index), false)
    end
    if ok_envelope and envelope and e5_automation_snapshot_ref_matches(envelope, fx_fingerprint, "FX parameter", "fx_parameter", "fx", track) then
      local _, name = e5_automation_envelope_fingerprint(envelope, "FX parameter", "fx_parameter", "fx", track)
      return envelope, ref, "fx", "fx_parameter", name, { owner_kind = "track", owner = track, owner_ref = fx_track_ref, slot_index = tonumber(fx_index), param_index = tonumber(param_index) }
    end
    return nil
  end
  local fx_take_ref, take_fx_index, take_param_index, take_fx_fingerprint = ref:match("^envelope:fx:(take:[^:]+:.+):(%d+):param:(%d+):fingerprint:(%d+)$")
  if fx_take_ref then
    local take = READ_B_MEDIA.resolve_take_token(fx_take_ref)
    local ok_envelope, envelope = false, nil
    if take then
      ok_envelope, envelope = call_reaper("TakeFX_GetEnvelope", take, tonumber(take_fx_index), tonumber(take_param_index), false)
    end
    if ok_envelope and envelope and e5_automation_snapshot_ref_matches(envelope, take_fx_fingerprint, "Take FX parameter", "fx_parameter", "fx", take) then
      local _, name = e5_automation_envelope_fingerprint(envelope, "Take FX parameter", "fx_parameter", "fx", take)
      return envelope, ref, "fx", "fx_parameter", name, { owner_kind = "take", owner = take, take = take, owner_ref = fx_take_ref, slot_index = tonumber(take_fx_index), param_index = tonumber(take_param_index) }
    end
    return nil
  end
  local send_ref, send_key, send_fingerprint = ref:match("^envelope:(send:track:.+:%d+):(%a+):fingerprint:(%d+)$")
  if send_ref and send_key then
    local source_track, send_index = e5_routing_send_index_from_ref(send_ref)
    local envelope, _, parent_kind, key_name, display_name = source_track and e5_automation_send_envelope(source_track, send_index, send_key) or nil
    if envelope and e5_automation_snapshot_ref_matches(envelope, send_fingerprint, display_name, key_name, "send", source_track) then
      return envelope, ref, parent_kind, key_name, display_name, { track = source_track, owner_ref = send_ref, send_index = send_index }
    end
    return nil
  end
  send_ref, send_key = ref:match("^envelope:(send:track:.+:%d+):(%a+)$")
  if send_ref and send_key then
    local source_track, send_index = e5_routing_send_index_from_ref(send_ref)
    if not source_track then
      return nil
    end
    local envelope, envelope_ref, parent_kind, key_name, display_name = e5_automation_send_envelope(source_track, send_index, send_key)
    return envelope, envelope_ref, parent_kind, key_name, display_name, { track = source_track, owner_ref = send_ref, send_index = send_index }
  end
  return nil
end

local function e5_automation_envelope_from_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "envelope" then
        local envelope, envelope_ref, parent_kind, key, name = e5_automation_envelope_from_ref_string(ref.ref)
        if envelope then
          return envelope, envelope_ref, parent_kind, key, name
        end
      end
    end
  end
  local parent_kind = request.params.parent_kind
  if parent_kind == "track" or parent_kind == nil or parent_kind == JSON_NULL then
    local track = e5_routing_track_from_request_refs(request) or e5_routing_resolve_track_token("track:index:0")
    if track then
      local envelope, envelope_ref, resolved_parent_kind, key, name = e5_automation_track_envelope(track, request.params.envelope_name or "Volume")
      return envelope, envelope_ref, resolved_parent_kind, key, name, { track = track, owner_ref = e5_routing_track_ref_string(track) }
    end
  end
  return nil
end

local function e5_automation_envelope_name(envelope, fallback)
  local ok, _, name = call_reaper("GetEnvelopeName", envelope, "")
  if ok then
    return first_string(name) or fallback or "Envelope"
  end
  return fallback or "Envelope"
end

local function e5_automation_envelope_scaling(envelope)
  local ok, mode = call_reaper("GetEnvelopeScalingMode", envelope)
  return ok and math.floor(first_number(mode) or 0) or 0
end

local function e5_automation_envelope_point_count(envelope)
  local ok, count = call_reaper("CountEnvelopePoints", envelope)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_automation_item_count(envelope)
  local ok, count = call_reaper("CountAutomationItems", envelope)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_automation_br_properties(envelope)
  local ok_alloc, br_env = call_reaper("BR_EnvAlloc", envelope, false)
  if not ok_alloc or not br_env then
    return {
      active = true,
      visible = false,
      armed = false,
      show_lane = false,
      lane_height = 0,
      default_shape = 0,
      fader_scaling = false,
      br_available = false,
    }
  end
  local ok_props, active, visible, armed, in_lane, lane_height, default_shape, min_value, max_value, center_value, env_type, fader_scaling, automation_options =
    call_reaper("BR_EnvGetProperties", br_env)
  call_reaper("BR_EnvFree", br_env, false)
  if not ok_props then
    return {
      active = true,
      visible = false,
      armed = false,
      show_lane = false,
      lane_height = 0,
      default_shape = 0,
      fader_scaling = false,
      br_available = false,
    }
  end
  return {
    active = active == true,
    visible = visible == true,
    armed = armed == true,
    show_lane = in_lane == true,
    lane_height = math.floor(first_number(lane_height) or 0),
    default_shape = math.floor(first_number(default_shape) or 0),
    min_value = first_number(min_value) or 0,
    max_value = first_number(max_value) or 1,
    center_value = first_number(center_value) or 0,
    envelope_type = math.floor(first_number(env_type) or 0),
    fader_scaling = fader_scaling == true,
    automation_items_options = math.floor(first_number(automation_options) or -1),
    br_available = true,
  }
end

local function e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, extra)
  local props = e5_automation_br_properties(envelope)
  local summary = {
    envelope_ref = envelope_ref,
    parent_kind = parent_kind or "track",
    envelope_type = key or "volume",
    name = e5_automation_envelope_name(envelope, display_name),
    scaling_mode = e5_automation_envelope_scaling(envelope),
    active = props.active,
    armed = props.armed,
    visible = props.visible,
    show_lane = props.show_lane,
    point_count = e5_automation_envelope_point_count(envelope),
    automation_item_count = e5_automation_item_count(envelope),
    br_available = props.br_available,
    min_value = props.min_value,
    max_value = props.max_value,
    center_value = props.center_value,
  }
  if is_object(extra) then
    for k, v in pairs(extra) do
      summary[k] = v
    end
  end
  return e5_routing_summary(request, summary)
end

local function e5_automation_resolve_or_error(request, message)
  local envelope, envelope_ref, parent_kind, key, display_name, context = e5_automation_envelope_from_request(request)
  if not envelope then
    local _, err = e5_routing_error("ENVELOPE_NOT_FOUND", message or "E5 automation requires a resolvable envelope ref.", {})
    return nil, nil, nil, nil, nil, err, nil
  end
  return envelope, envelope_ref, parent_kind, key, display_name, nil, context
end

local function e5_automation_take_time_context(envelope)
  local ok_parent, take, fx_index, param_index = call_reaper("Envelope_GetParentTake", envelope)
  if not ok_parent or not take then
    return nil
  end
  local ok_item, item = call_reaper("GetMediaItemTake_Item", take)
  local ok_position, item_position = false, nil
  local ok_length, item_length = false, nil
  if ok_item and item then
    ok_position, item_position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
    ok_length, item_length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
  end
  local ok_playrate, playrate = call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE")
  item_position = ok_position and first_number(item_position) or nil
  item_length = ok_length and first_number(item_length) or nil
  playrate = ok_playrate and first_number(playrate) or nil
  if not ok_item or not item or item_position == nil or item_length == nil or item_length < 0 or playrate == nil or playrate <= 0 then
    return false, {
      code = "TAKE_ENVELOPE_TIME_CONTEXT_UNAVAILABLE",
      message = "Take Envelope project-time conversion requires a valid parent Item position/length and positive Take playrate.",
      details = {},
    }
  end
  return {
    take = take,
    item = item,
    item_position = item_position,
    item_length = item_length,
    playrate = playrate,
    fx_index = math.floor(first_number(fx_index) or -1),
    param_index = math.floor(first_number(param_index) or -1),
  }
end

local function e5_automation_project_to_native_time(envelope, project_time)
  local context, context_error = e5_automation_take_time_context(envelope)
  if context == false then
    return nil, context_error
  end
  if not context then
    return project_time, nil
  end
  local end_time = context.item_position + context.item_length
  if project_time < context.item_position - 0.000000001 or project_time > end_time + 0.000000001 then
    return nil, {
      code = "TAKE_ENVELOPE_TIME_OUT_OF_BOUNDS",
      message = "Take Envelope time_seconds must fall inside the parent Item project-time bounds.",
      details = {
        requested_time_seconds = project_time,
        item_start_seconds = context.item_position,
        item_end_seconds = end_time,
        take_playrate = context.playrate,
      },
    }
  end
  return (project_time - context.item_position) * context.playrate, nil
end

local function e5_automation_native_to_project_time(envelope, native_time)
  local context, context_error = e5_automation_take_time_context(envelope)
  if context == false then
    return nil, context_error
  end
  if not context then
    return native_time, nil
  end
  return context.item_position + native_time / context.playrate, nil
end

local function e5_automation_cursor(value)
  if value == nil or value == JSON_NULL or value == "" then
    return 0
  end
  if not is_string(value) or not value:match("^%d+$") then
    return nil
  end
  return tonumber(value)
end

local function e5_automation_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit
  if type(requested) == "number" and requested == math.floor(requested) and requested > 0 then
    limit = requested
  end
  return math.max(1, math.min(limit, hard_limit, budget.max_items))
end

local function e5_automation_requested_parent_kinds(params)
  local kinds = { track = true, take = true, send = true, fx = true }
  if is_json_array(params.parent_kinds) and #params.parent_kinds > 0 then
    kinds = { track = false, take = false, send = false, fx = false }
    for index = 1, #params.parent_kinds do
      local kind = params.parent_kinds[index]
      if kinds[kind] == nil then
        return nil, "PARENT_KIND_INVALID"
      end
      kinds[kind] = true
    end
  end
  for _, kind in ipairs({ "track", "take", "send", "fx" }) do
    local flag = params["include_" .. kind .. "_envelopes"]
    if type(flag) == "boolean" then
      kinds[kind] = flag
    end
  end
  return kinds
end

local function list_project_envelopes(request)
  local kinds, kind_error = e5_automation_requested_parent_kinds(request.params)
  if not kinds then
    return e5_routing_error("PARAMS_INVALID", "Project envelope inventory contains an unsupported parent kind.", {
      reason_code = kind_error,
    })
  end
  local cursor = e5_automation_cursor(request.params.cursor)
  if cursor == nil then
    return e5_routing_error("PARAMS_INVALID", "Project envelope inventory cursor must be a non-negative integer string.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
    })
  end
  local limit = e5_automation_limit(request, request.params.limit, 32, 128)
  local rows = {}
  local refs_by_ref = {}
  local coverage_unknown = false
  local overflow = false
  local matched_count = 0
  local local_reasons = {}
  local function mark_unknown(reason)
    coverage_unknown = true
    local_reasons[reason] = true
  end

  local enumeration_complete, enumeration_reasons = e5_automation_each_project_envelope(function(envelope, info)
    if not kinds[info.parent_kind] then
      return
    end
    local props = e5_automation_br_properties(envelope)
    if request.params.only_visible == true and not props.br_available then
      mark_unknown("VISIBLE_FILTER_UNPROVABLE")
      return
    end
    if request.params.only_armed == true and not props.br_available then
      mark_unknown("ARMED_FILTER_UNPROVABLE")
      return
    end
    if request.params.only_visible == true and props.visible ~= true then
      return
    end
    if request.params.only_armed == true and props.armed ~= true then
      return
    end

    matched_count = matched_count + 1
    if #rows >= 4096 then
      overflow = true
      return
    end
    local envelope_ref, guid_backed = e5_automation_preferred_ref(envelope, info.fallback_ref or info.compatibility_ref)
    local ok_points, point_count = call_reaper("CountEnvelopePoints", envelope)
    local ok_items, automation_item_count = call_reaper("CountAutomationItems", envelope)
    if not ok_points then mark_unknown("POINT_COUNT_UNAVAILABLE") end
    if not ok_items then mark_unknown("AUTOMATION_ITEM_COUNT_UNAVAILABLE") end
    local row = {
      envelope_ref = envelope_ref,
      owner_ref = info.owner_ref,
      parent_kind = info.parent_kind,
      envelope_type = info.key,
      name = e5_automation_envelope_name(envelope, info.name),
      identity_kind = guid_backed and "guid" or "snapshot_locator",
      point_count = ok_points and math.max(0, math.floor(first_number(point_count) or 0)) or JSON_NULL,
      automation_item_count = ok_items and math.max(0, math.floor(first_number(automation_item_count) or 0)) or JSON_NULL,
      br_available = props.br_available,
    }
    if props.br_available then
      row.active = props.active
      row.visible = props.visible
      row.armed = props.armed
      row.show_lane = props.show_lane
    end
    rows[#rows + 1] = row
    refs_by_ref[envelope_ref] = e5_routing_envelope_object_ref(envelope, envelope_ref)
  end)
  if not enumeration_complete then
    coverage_unknown = true
    for index = 1, #enumeration_reasons do
      local_reasons[enumeration_reasons[index]] = true
    end
  end
  table.sort(rows, function(a, b) return a.envelope_ref < b.envelope_ref end)
  if cursor > #rows then
    return e5_routing_error("PARAMS_INVALID", "Project envelope inventory cursor is outside the retained deterministic rows.", {
      reason_code = "CURSOR_OUT_OF_RANGE",
      cursor = cursor,
      retained_count = #rows,
    })
  end

  local page = json_array({})
  local refs = json_array({})
  local last = math.min(#rows, cursor + limit)
  for index = cursor + 1, last do
    page[#page + 1] = rows[index]
    refs[#refs + 1] = refs_by_ref[rows[index].envelope_ref]
  end
  local has_more = last < #rows
  local reasons = json_array({})
  for reason in pairs(local_reasons) do reasons[#reasons + 1] = reason end
  table.sort(reasons)
  local coverage_status = "complete"
  if overflow then
    coverage_status = "truncated"
  elseif coverage_unknown then
    coverage_status = "unknown"
  elseif has_more then
    coverage_status = "paged"
  end
  return e5_routing_summary(request, {
    envelopes = page,
    envelope_refs = json_array((function()
      local values = {}
      for index = 1, #page do values[#values + 1] = page[index].envelope_ref end
      return values
    end)()),
    returned_count = #page,
    total_count = matched_count,
    next_cursor = has_more and tostring(last) or JSON_NULL,
    truncated = has_more or coverage_status == "truncated" or coverage_status == "unknown",
    coverage_status = coverage_status,
    coverage = {
      retained_count = #rows,
      internally_complete = enumeration_complete and not overflow and not coverage_unknown,
      reasons = reasons,
      parent_kinds = kinds,
    },
  }), nil, json_array({}), json_array({}), refs
end

local function resolve_envelope_ref(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request, "E5 automation resolve_envelope_ref requires a resolvable envelope parent/ref.")
  if not envelope then
    return nil, err
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function read_envelope_summary(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function e5_automation_autoitem_index(request, envelope)
  local raw = request.params.autoitem_index
  local index = (raw == nil or raw == JSON_NULL) and -1 or tonumber(raw)
  if type(index) ~= "number" or index ~= math.floor(index) or index < -1 then
    return nil, {
      code = "PARAMS_INVALID",
      message = "autoitem_index must be -1 for the underlying envelope or a non-negative automation item index.",
      details = { reason_code = "AUTOITEM_INDEX_INVALID", autoitem_index = raw },
    }
  end
  if index >= 0 then
    local ok_count, count = call_reaper("CountAutomationItems", envelope)
    if not ok_count then
      return nil, {
        code = "COMMAND_FAILED",
        message = "REAPER did not return the automation item count.",
        details = { reason_code = "AUTOMATION_ITEM_COUNT_UNAVAILABLE" },
      }
    end
    count = math.max(0, math.floor(first_number(count) or 0))
    if index >= count then
      return nil, {
        code = "REF_INVALID",
        message = "autoitem_index is outside the existing automation item count.",
        details = { reason_code = "AUTOITEM_INDEX_OUT_OF_RANGE", autoitem_index = index, automation_item_count = count },
      }
    end
  end
  return index
end

local function e5_automation_point_count_ex(envelope, autoitem_index)
  local ok, count = call_reaper("CountEnvelopePointsEx", envelope, autoitem_index)
  if not ok or type(first_number(count)) ~= "number" then
    return nil
  end
  return math.max(0, math.floor(first_number(count)))
end

local function e5_automation_point_row_ex(envelope, autoitem_index, index)
  local call_ok, retval, time, value, shape, tension, selected = call_reaper("GetEnvelopePointEx", envelope, autoitem_index, index)
  if not call_ok or retval ~= true then
    return nil
  end
  time = first_number(time)
  value = first_number(value)
  shape = first_number(shape)
  tension = first_number(tension)
  if time == nil or value == nil or shape == nil or tension == nil then
    return nil
  end
  return {
    autoitem_index = autoitem_index,
    point_index = index,
    time_seconds = time,
    value = value,
    shape = math.floor(shape),
    tension = tension,
    selected = selected == true,
  }
end

local function e5_automation_numbers_match(actual, expected)
  return type(actual) == "number" and type(expected) == "number" and math.abs(actual - expected) <= 0.000000001
end

local function e5_automation_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function e5_automation_points_match(actual, expected)
  return actual
    and e5_automation_numbers_match(actual.time_seconds, expected.time_seconds)
    and e5_automation_numbers_match(actual.value, expected.value)
    and actual.shape == expected.shape
    and e5_automation_numbers_match(actual.tension, expected.tension)
    and actual.selected == expected.selected
end

local function e5_automation_find_matching_point(envelope, autoitem_index, expected, used)
  local count = e5_automation_point_count_ex(envelope, autoitem_index)
  if count == nil then return nil, nil end
  for index = 0, count - 1 do
    if not used or not used[index] then
      local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
      if not row then return nil, nil end
      if e5_automation_points_match(row, expected) then
        return index, row
      end
    end
  end
  return nil, nil
end

local function e5_automation_read_native_lane(envelope, autoitem_index)
  local count = e5_automation_point_count_ex(envelope, autoitem_index)
  if count == nil then return nil end
  local rows = {}
  for index = 0, count - 1 do
    local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
    if not row then return nil end
    rows[#rows + 1] = {
      time_seconds = row.time_seconds,
      value = row.value,
      shape = row.shape,
      tension = row.tension,
      selected = row.selected,
    }
  end
  return rows
end

local function e5_automation_native_times_match(left, right)
  return e5_automation_numbers_match(left, right)
end

local function e5_automation_overlay_plan(before, requested)
  for index = 1, #requested do
    for prior = 1, index - 1 do
      if e5_automation_native_times_match(requested[index].time_seconds, requested[prior].time_seconds) then
        return nil, {
          duplicate_index = index - 1,
          first_index = prior - 1,
          native_time_seconds = requested[index].time_seconds,
        }
      end
    end
  end

  local expected = {}
  local replaced = 0
  for index = 1, #before do
    local collides = false
    for requested_index = 1, #requested do
      if e5_automation_native_times_match(before[index].time_seconds, requested[requested_index].time_seconds) then
        collides = true
        break
      end
    end
    if collides then
      replaced = replaced + 1
    else
      expected[#expected + 1] = before[index]
    end
  end
  for index = 1, #requested do expected[#expected + 1] = requested[index] end

  local writes = {}
  for index = 1, #requested do
    local collision_count = 0
    local identical = false
    for before_index = 1, #before do
      if e5_automation_native_times_match(before[before_index].time_seconds, requested[index].time_seconds) then
        collision_count = collision_count + 1
        if e5_automation_points_match(before[before_index], requested[index]) then identical = true end
      end
    end
    if collision_count ~= 1 or not identical then
      writes[#writes + 1] = { requested_index = index, point = requested[index] }
    end
  end

  return {
    expected = expected,
    writes = writes,
    requested = #requested,
    replaced = replaced,
    net_new = #expected - #before,
    before = #before,
    after = #expected,
  }, nil
end

local function e5_automation_point_multiset_equals(actual, expected)
  if not actual or #actual ~= #expected then return false end
  local used = {}
  for expected_index = 1, #expected do
    local found = false
    for actual_index = 1, #actual do
      if not used[actual_index] and e5_automation_points_match(actual[actual_index], expected[expected_index]) then
        used[actual_index] = true
        found = true
        break
      end
    end
    if not found then return false end
  end
  return true
end

local function read_envelope_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local raw_total = e5_automation_point_count_ex(envelope, autoitem_index)
  if raw_total == nil then
    return e5_routing_error("COMMAND_FAILED", "REAPER did not return CountEnvelopePointsEx for the requested lane.", {
      reason_code = "POINT_COUNT_UNAVAILABLE",
      autoitem_index = autoitem_index,
    })
  end
  local start_seconds = request.params.start_seconds
  local end_seconds = request.params.end_seconds
  if start_seconds ~= nil then start_seconds = e5_automation_finite_number(start_seconds) end
  if end_seconds ~= nil then end_seconds = e5_automation_finite_number(end_seconds) end
  if (request.params.start_seconds ~= nil and start_seconds == nil) or (request.params.end_seconds ~= nil and end_seconds == nil) then
    return e5_routing_error("PARAMS_INVALID", "Envelope point range bounds must be finite numbers.", { reason_code = "POINT_RANGE_INVALID" })
  end
  if start_seconds ~= nil and end_seconds ~= nil and end_seconds < start_seconds then
    return e5_routing_error("PARAMS_INVALID", "Envelope point end_seconds must be greater than or equal to start_seconds.", {
      reason_code = "POINT_RANGE_INVALID",
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local cursor = e5_automation_cursor(request.params.cursor)
  if cursor == nil then
    return e5_routing_error("PARAMS_INVALID", "Envelope point cursor must be a non-negative integer string.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
    })
  end
  local matching = {}
  for index = 0, raw_total - 1 do
    local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
    if not row then
      return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed before the requested lane was completely read.", {
        reason_code = "POINT_READ_FAILED",
        autoitem_index = autoitem_index,
        point_index = index,
      })
    end
    local project_time, time_error = e5_automation_native_to_project_time(envelope, row.time_seconds)
    if project_time == nil then
      return e5_routing_error(time_error.code, time_error.message, time_error.details)
    end
    row.time_seconds = project_time
    if (start_seconds == nil or row.time_seconds >= start_seconds)
      and (end_seconds == nil or row.time_seconds <= end_seconds) then
      matching[#matching + 1] = row
    end
  end
  if cursor > #matching then
    return e5_routing_error("PARAMS_INVALID", "Envelope point cursor is outside the filtered result count.", {
      reason_code = "CURSOR_OUT_OF_RANGE",
      cursor = cursor,
      total_count = #matching,
    })
  end
  local limit = e5_automation_limit(request, request.params.limit, 16, 64)
  local points = json_array({})
  local last = math.min(#matching, cursor + limit)
  for index = cursor + 1, last do points[#points + 1] = matching[index] end
  local has_more = last < #matching
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    points = points,
    returned_count = #points,
    total_count = #matching,
    next_cursor = has_more and tostring(last) or JSON_NULL,
    truncated = has_more,
    coverage_status = has_more and "paged" or "complete",
    time_basis = "project",
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function evaluate_envelope_at_time(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, 0)
  local native_time, time_error = e5_automation_project_to_native_time(envelope, time_seconds)
  if native_time == nil then
    return e5_routing_error(time_error.code, time_error.message, time_error.details)
  end
  local sample_rate = e5_routing_finite_number(request.params.sample_rate, 48000)
  local samples_requested = math.max(0, math.floor(tonumber(request.params.samples_requested) or 0))
  local ok, valid_samples, value, dvds, ddvds, dddvds = call_reaper("Envelope_Evaluate", envelope, native_time, sample_rate, samples_requested)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected Envelope_Evaluate.", {
      envelope_ref = envelope_ref,
      time_seconds = time_seconds,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    time_seconds = time_seconds,
    time_basis = "project",
    value = first_number(value) or 0,
    valid_samples = math.floor(first_number(valid_samples) or 0),
    dVdS = first_number(dvds) or 0,
    ddVdS = first_number(ddvds) or 0,
    dddVdS = first_number(dddvds) or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_envelope_lane_state(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local props = e5_automation_br_properties(envelope)
  if not props.br_available then
    return e5_routing_error("COMMAND_FAILED", "Envelope lane state requires the audited BR/SWS envelope property API.", {
      reason_code = "BR_ENV_PROPERTIES_UNAVAILABLE",
      envelope_ref = envelope_ref,
    })
  end
  local active = type(request.params.active) == "boolean" and request.params.active
  if active == nil then active = props.active end
  local visible = type(request.params.visible) == "boolean" and request.params.visible
  if visible == nil then visible = props.visible end
  local armed = type(request.params.armed) == "boolean" and request.params.armed
  if armed == nil then armed = props.armed end
  local show_lane = type(request.params.show_lane) == "boolean" and request.params.show_lane
  if show_lane == nil then show_lane = props.show_lane end
  local ok_alloc, br_env = call_reaper("BR_EnvAlloc", envelope, false)
  if not ok_alloc or not br_env then
    return e5_routing_error("COMMAND_FAILED", "BR_EnvAlloc failed before lane-state mutation.", {
      reason_code = "BR_ENV_ALLOC_FAILED",
      envelope_ref = envelope_ref,
    }, false)
  end
  local set_ok = call_reaper("BR_EnvSetProperties", br_env, active, visible, armed, show_lane, props.lane_height or 0, props.default_shape or 0, props.fader_scaling == true, props.automation_items_options or -1)
  local free_ok = call_reaper("BR_EnvFree", br_env, true)
  if not set_ok or not free_ok then
    return e5_routing_error("COMMAND_FAILED", "BR/SWS rejected the envelope lane-state mutation.", {
      reason_code = "BR_ENV_WRITE_FAILED",
      envelope_ref = envelope_ref,
    }, false)
  end
  call_reaper("UpdateArrange")
  local readback = e5_automation_br_properties(envelope)
  if not readback.br_available
    or readback.active ~= active
    or readback.visible ~= visible
    or readback.armed ~= armed
    or readback.show_lane ~= show_lane then
    return e5_routing_error("VERIFY_FAILED", "Envelope lane-state readback did not exactly match the requested values.", {
      reason_code = "LANE_STATE_READBACK_MISMATCH",
      envelope_ref = envelope_ref,
      requested = { active = active, visible = visible, armed = armed, show_lane = show_lane },
      readback = { active = readback.active, visible = readback.visible, armed = readback.armed, show_lane = readback.show_lane },
      mutation_applied = true,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    active = readback.active,
    visible = readback.visible,
    armed = readback.armed,
    show_lane = readback.show_lane,
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function insert_envelope_point(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local time_seconds = e5_automation_finite_number(request.params.time_seconds)
  local value = e5_automation_finite_number(request.params.value)
  local shape = tonumber(request.params.shape)
  local tension = e5_automation_finite_number(request.params.tension)
  if time_seconds == nil or value == nil or type(shape) ~= "number" or shape ~= math.floor(shape) or shape < 0 or tension == nil then
    return e5_routing_error("PARAMS_INVALID", "Envelope point fields must be finite and shape must be a non-negative integer.", {
      reason_code = "POINT_FIELDS_INVALID",
    })
  end
  local native_time, time_error = e5_automation_project_to_native_time(envelope, time_seconds)
  if native_time == nil then
    return e5_routing_error(time_error.code, time_error.message, time_error.details)
  end
  local selected = request.params.selected == true
  local before_rows = e5_automation_read_native_lane(envelope, autoitem_index)
  if not before_rows then
    return e5_routing_error("COMMAND_FAILED", "Complete Envelope point readback failed before point insertion.", {
      reason_code = "POINT_READBACK_UNAVAILABLE",
    })
  end
  local requested_row = {
    time_seconds = native_time,
    value = value,
    shape = shape,
    tension = tension,
    selected = selected,
  }
  local plan = e5_automation_overlay_plan(before_rows, { requested_row })
  if plan.after > 64 then
    return e5_routing_error("PARAMS_INVALID", "Point overlay would exceed the complete 64-point lane boundary.", {
      reason_code = "POINT_FINAL_LANE_LIMIT_EXCEEDED",
      requested = plan.requested,
      replaced = plan.replaced,
      net_new = plan.net_new,
      before = plan.before,
      after = plan.after,
      max_points = 64,
    })
  end
  local mutation_applied = false
  local index_maintenance_applied = false
  if #plan.writes > 0 then
    local call_ok, inserted = call_reaper("InsertEnvelopePointEx", envelope, autoitem_index, native_time, value, shape, tension, selected, true)
    if not call_ok or inserted ~= true then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePointEx.", {
        reason_code = "POINT_INSERT_FAILED",
        envelope_ref = envelope_ref,
        mutation_applied = false,
        index_maintenance_applied = false,
      })
    end
    mutation_applied = true
    local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
    if not sort_ok then
      return e5_routing_error("COMMAND_FAILED", "Envelope_SortPointsEx failed after point insertion.", {
        reason_code = "POINT_SORT_FAILED",
        envelope_ref = envelope_ref,
        mutation_applied = true,
        index_maintenance_applied = false,
      }, false)
    end
    index_maintenance_applied = true
  end
  local after_rows = e5_automation_read_native_lane(envelope, autoitem_index)
  if not e5_automation_point_multiset_equals(after_rows, plan.expected) then
    return e5_routing_error("VERIFY_FAILED", "Point overlay did not exactly match the complete expected lane.", {
      reason_code = "POINT_OVERLAY_READBACK_MISMATCH",
      autoitem_index = autoitem_index,
      requested = plan.requested,
      replaced = plan.replaced,
      net_new = plan.net_new,
      before = plan.before,
      after = after_rows and #after_rows or JSON_NULL,
      mutation_applied = mutation_applied,
      index_maintenance_applied = index_maintenance_applied,
    }, false)
  end
  local point_index, readback = e5_automation_find_matching_point(envelope, autoitem_index, requested_row)
  if point_index == nil then
    return e5_routing_error("VERIFY_FAILED", "Point overlay tuple was not found after complete lane verification.", {
      reason_code = "POINT_READBACK_MISMATCH",
      autoitem_index = autoitem_index,
      mutation_applied = mutation_applied,
      index_maintenance_applied = index_maintenance_applied,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    point_index = point_index,
    time_seconds = time_seconds,
    time_basis = "project",
    value = readback.value,
    shape = readback.shape,
    tension = readback.tension,
    selected = readback.selected,
    requested = plan.requested,
    replaced = plan.replaced,
    net_new = plan.net_new,
    before = plan.before,
    after = plan.after,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_mode_value(mode)
  if mode == "read" then
    return 1
  elseif mode == "touch" then
    return 2
  elseif mode == "write" then
    return 3
  elseif mode == "latch" then
    return 4
  elseif mode == "latch_preview" then
    return 5
  end
  return 0
end

local function e5_automation_send_mode_value(mode)
  if mode == "use_track" then
    return -1
  end
  return e5_automation_mode_value(mode)
end

local function e5_automation_mode_label(value)
  value = math.floor(tonumber(value) or 0)
  if value == -1 then return "use_track" end
  if value == 1 then return "read" end
  if value == 2 then return "touch" end
  if value == 3 then return "write" end
  if value == 4 then return "latch" end
  if value == 5 then return "latch_preview" end
  return "trim_read"
end

local function read_track_automation_mode(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 automation read_track_automation_mode requires a resolvable track ref.", {})
  end
  local ok, mode = call_reaper("GetTrackAutomationMode", track)
  mode = ok and first_number(mode) or 0
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    mode = e5_automation_mode_label(mode),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_automation_mode(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 automation set_track_automation_mode requires a resolvable track ref.", {})
  end
  local mode = e5_automation_mode_value(request.params.mode)
  local ok = call_reaper("SetTrackAutomationMode", track, mode)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected SetTrackAutomationMode.", {})
  end
  local summary, failure, artifacts, jobs, refs = read_track_automation_mode(request)
  local requested_mode = e5_automation_mode_label(mode)
  if failure then return nil, failure end
  if summary.mode ~= requested_mode then
    return e5_routing_error("VERIFY_FAILED", "Track automation mode live readback did not exactly match the request.", {
      reason_code = "TRACK_AUTOMATION_MODE_READBACK_MISMATCH",
      requested_mode = requested_mode,
      readback_mode = summary.mode,
      mutation_applied = true,
    }, false)
  end
  return summary, nil, artifacts, jobs, refs
end

local function read_automation_items(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local total = e5_automation_item_count(envelope)
  local cursor = e5_automation_cursor(request.params.cursor)
  if cursor == nil or cursor > total then
    return e5_routing_error("PARAMS_INVALID", "Automation Item cursor must be a non-negative integer string within the current Item count.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
      total_count = total,
    })
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 16, 64)
  local items = json_array({})
  local last = math.min(total, cursor + limit)
  for index = cursor, last - 1 do
    local position = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POSITION", 0, false))
    local length = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_LENGTH", 0, false))
    local pool_id = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POOL_ID", 0, false))
    local start_offset = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_STARTOFFS", 0, false))
    local playrate = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_PLAYRATE", 0, false))
    local baseline = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_BASELINE", 0, false))
    local amplitude = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_AMPLITUDE", 0, false))
    local loop_source = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_LOOPSRC", 0, false))
    local selected = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_UISEL", 0, false))
    local muted = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_MUTE", 0, false))
    items[#items + 1] = {
      automation_item_index = index,
      position_seconds = first_number(position) or 0,
      length_seconds = first_number(length) or 0,
      pool_id = math.floor(first_number(pool_id) or -1),
      start_offset_seconds = first_number(start_offset) or 0,
      playrate = first_number(playrate) or 1,
      baseline = first_number(baseline) or 0,
      amplitude = first_number(amplitude) or 1,
      loop_source = (first_number(loop_source) or 0) ~= 0,
      selected = (first_number(selected) or 0) ~= 0,
      muted = (first_number(muted) or 0) ~= 0,
    }
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    items = items,
    returned_count = #items,
    total_count = total,
    next_cursor = last < total and tostring(last) or JSON_NULL,
    truncated = last < total,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_envelope_point(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local point_index = tonumber(request.params.point_index)
  if type(point_index) ~= "number" or point_index ~= math.floor(point_index) or point_index < 0 then
    return e5_routing_error("PARAMS_INVALID", "point_index must be a non-negative integer.", {
      reason_code = "POINT_INDEX_INVALID",
      point_index = request.params.point_index,
    })
  end
  local before_count = e5_automation_point_count_ex(envelope, autoitem_index)
  if before_count == nil then
    return e5_routing_error("COMMAND_FAILED", "CountEnvelopePointsEx failed before point update.", {
      reason_code = "POINT_COUNT_UNAVAILABLE",
      autoitem_index = autoitem_index,
    })
  end
  if point_index >= before_count then
    return e5_routing_error("REF_INVALID", "point_index is outside the existing point count; set_envelope_point never inserts.", {
      reason_code = "POINT_INDEX_OUT_OF_RANGE",
      autoitem_index = autoitem_index,
      point_index = point_index,
      point_count = before_count,
    })
  end
  local current = e5_automation_point_row_ex(envelope, autoitem_index, point_index)
  if not current then
    return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed before point update.", {
      reason_code = "POINT_READ_FAILED",
      autoitem_index = autoitem_index,
      point_index = point_index,
    })
  end
  local requested_time = request.params.time_seconds == nil and nil or e5_automation_finite_number(request.params.time_seconds)
  if request.params.time_seconds ~= nil and requested_time == nil then
    return e5_routing_error("PARAMS_INVALID", "Updated Envelope point time_seconds must be finite.", {
      reason_code = "POINT_TIME_INVALID",
    })
  end
  local time_seconds = current.time_seconds
  if requested_time ~= nil then
    local native_time, time_error = e5_automation_project_to_native_time(envelope, requested_time)
    if native_time == nil then
      return e5_routing_error(time_error.code, time_error.message, time_error.details)
    end
    time_seconds = native_time
  end
  local value = request.params.value == nil and current.value or e5_automation_finite_number(request.params.value)
  local shape = request.params.shape == nil and current.shape or tonumber(request.params.shape)
  local tension = request.params.tension == nil and current.tension or e5_automation_finite_number(request.params.tension)
  local selected = type(request.params.selected) == "boolean" and request.params.selected or current.selected
  if time_seconds == nil or value == nil or type(shape) ~= "number" or shape ~= math.floor(shape) or shape < 0 or tension == nil then
    return e5_routing_error("PARAMS_INVALID", "Updated envelope point fields must be finite and shape must be a non-negative integer.", {
      reason_code = "POINT_FIELDS_INVALID",
    })
  end
  local call_ok, updated = call_reaper("SetEnvelopePointEx", envelope, autoitem_index, point_index, time_seconds, value, shape, tension, selected, false)
  local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
  if not call_ok or updated ~= true or not sort_ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected SetEnvelopePointEx or lane sorting.", {
      reason_code = "POINT_UPDATE_FAILED",
      envelope_ref = envelope_ref,
      point_index = point_index,
      mutation_applied = call_ok and updated == true,
      index_maintenance_applied = sort_ok == true,
    })
  end
  local after_count = e5_automation_point_count_ex(envelope, autoitem_index)
  if after_count ~= before_count then
    return e5_routing_error("VERIFY_FAILED", "Point update changed the point count unexpectedly.", {
      reason_code = "POINT_COUNT_READBACK_MISMATCH",
      before_count = before_count,
      after_count = after_count,
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  local readback_index, readback = e5_automation_find_matching_point(envelope, autoitem_index, {
    time_seconds = time_seconds,
    value = value,
    shape = shape,
    tension = tension,
    selected = selected,
  })
  if readback_index == nil then
    return e5_routing_error("VERIFY_FAILED", "Updated point fields were not found in exact live readback.", {
      reason_code = "POINT_READBACK_MISMATCH",
      autoitem_index = autoitem_index,
      original_point_index = point_index,
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  local project_time, time_error = e5_automation_native_to_project_time(envelope, readback.time_seconds)
  if project_time == nil then
    return e5_routing_error(time_error.code, time_error.message, {
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    point_index = readback_index,
    time_seconds = project_time,
    time_basis = "project",
    value = readback.value,
    shape = readback.shape,
    tension = readback.tension,
    selected = readback.selected,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local e5_automation_insert_points

local function insert_envelope_points_batch(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  return e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, request.params.points, 64)
end

e5_automation_insert_points = function(request, envelope, envelope_ref, parent_kind, key, display_name, points, max_points)
  if not is_json_array(points) then
    return e5_routing_error("PARAMS_INVALID", "E5 automation point insertion requires a points array.", {
      reason_code = "POINT_BATCH_INVALID",
    })
  end
  max_points = max_points or 64
  if #points < 1 or #points > max_points then
    return e5_routing_error("PARAMS_INVALID", "Point batch size is outside the accepted bound and will not be silently truncated.", {
      reason_code = "POINT_BATCH_LIMIT_EXCEEDED",
      requested_count = #points,
      max_points = max_points,
    })
  end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local before_rows = e5_automation_read_native_lane(envelope, autoitem_index)
  if not before_rows then
    return e5_routing_error("COMMAND_FAILED", "Complete Envelope point readback failed before batch insertion.", {
      reason_code = "POINT_READBACK_UNAVAILABLE",
      autoitem_index = autoitem_index,
    })
  end
  local normalized = {}
  local first_project_time = nil
  local last_project_time = nil
  local min_value = nil
  local max_value = nil
  for index = 1, #points do
    local point = is_object(points[index]) and points[index] or nil
    local time_seconds = point and e5_automation_finite_number(point.time_seconds) or nil
    local value = point and e5_automation_finite_number(point.value) or nil
    local shape = point and tonumber(point.shape) or nil
    local tension = point and e5_automation_finite_number(point.tension) or nil
    if not point or time_seconds == nil or value == nil or type(shape) ~= "number" or shape ~= math.floor(shape) or shape < 0 or tension == nil then
      return e5_routing_error("PARAMS_INVALID", "Every batch point requires finite time/value/tension and a non-negative integer shape.", {
        reason_code = "POINT_FIELDS_INVALID",
        point_index = index - 1,
      })
    end
    local native_time, time_error = e5_automation_project_to_native_time(envelope, time_seconds)
    if native_time == nil then
      local details = time_error.details or {}
      details.point_index = index - 1
      return e5_routing_error(time_error.code, time_error.message, details)
    end
    local normalized_point = {
      time_seconds = native_time,
      value = value,
      shape = shape,
      tension = tension,
      selected = point.selected == true,
    }
    normalized[#normalized + 1] = normalized_point
    first_project_time = first_project_time and math.min(first_project_time, time_seconds) or time_seconds
    last_project_time = last_project_time and math.max(last_project_time, time_seconds) or time_seconds
    min_value = min_value and math.min(min_value, value) or value
    max_value = max_value and math.max(max_value, value) or value
  end

  local plan, duplicate = e5_automation_overlay_plan(before_rows, normalized)
  if not plan then
    return e5_routing_error("PARAMS_INVALID", "Point batch contains duplicate native Envelope times and no points were inserted.", {
      reason_code = "POINT_BATCH_DUPLICATE_NATIVE_TIME",
      requested_count = #normalized,
      duplicate_index = duplicate.duplicate_index,
      first_index = duplicate.first_index,
      native_time_seconds = duplicate.native_time_seconds,
      mutation_applied = false,
      inserted_before_failure = 0,
    })
  end
  if max_points <= 64 and plan.after > 64 then
    return e5_routing_error("PARAMS_INVALID", "Point overlay would exceed the complete 64-point lane boundary.", {
      reason_code = "POINT_FINAL_LANE_LIMIT_EXCEEDED",
      requested = plan.requested,
      replaced = plan.replaced,
      net_new = plan.net_new,
      before = plan.before,
      after = plan.after,
      max_points = 64,
      mutation_applied = false,
      inserted_before_failure = 0,
    })
  end

  local writes_completed = 0
  for index = 1, #plan.writes do
    local write = plan.writes[index]
    local point = write.point
    local call_ok, inserted = call_reaper("InsertEnvelopePointEx", envelope, autoitem_index, point.time_seconds, point.value, point.shape, point.tension, point.selected, true)
    if not call_ok or inserted ~= true then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePointEx in point batch.", {
        reason_code = "POINT_BATCH_INSERT_FAILED",
        envelope_ref = envelope_ref,
        point_index = write.requested_index - 1,
        inserted_before_failure = writes_completed,
        mutation_applied = writes_completed > 0,
        index_maintenance_applied = false,
      }, false)
    end
    writes_completed = writes_completed + 1
  end
  local index_maintenance_applied = false
  if writes_completed > 0 then
    local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
    if not sort_ok then
      return e5_routing_error("COMMAND_FAILED", "Envelope_SortPointsEx failed after point batch insertion.", {
        reason_code = "POINT_SORT_FAILED",
        processed_count = writes_completed,
        mutation_applied = true,
        index_maintenance_applied = false,
      }, false)
    end
    index_maintenance_applied = true
  end
  local after_rows = e5_automation_read_native_lane(envelope, autoitem_index)
  if not e5_automation_point_multiset_equals(after_rows, plan.expected) then
    return e5_routing_error("VERIFY_FAILED", "Batch overlay did not exactly match the complete expected Envelope lane.", {
      reason_code = "POINT_BATCH_OVERLAY_READBACK_MISMATCH",
      requested = plan.requested,
      replaced = plan.replaced,
      net_new = plan.net_new,
      before = plan.before,
      after = after_rows and #after_rows or JSON_NULL,
      mutation_applied = writes_completed > 0,
      index_maintenance_applied = index_maintenance_applied,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    requested = plan.requested,
    replaced = plan.replaced,
    net_new = plan.net_new,
    before = plan.before,
    after = plan.after,
    inserted_count = plan.requested,
    processed_count = writes_completed,
    first_time_seconds = first_project_time,
    last_time_seconds = last_project_time,
    time_basis = "project",
    min_value = min_value or 0,
    max_value = max_value or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_count_tuple(envelope, autoitem_index, expected)
  local count = e5_automation_point_count_ex(envelope, autoitem_index)
  if count == nil then return nil end
  local matches = 0
  for index = 0, count - 1 do
    local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
    if not row then return nil end
    if e5_automation_points_match(row, expected) then matches = matches + 1 end
  end
  return matches
end

local function delete_envelope_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then return nil, err end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local mode = request.params.mode
  local has_point = request.params.point_index ~= nil
  local has_start = request.params.start_seconds ~= nil
  local has_end = request.params.end_seconds ~= nil
  if mode ~= "point" and mode ~= "range" then
    return e5_routing_error("PARAMS_INVALID", "Deletion mode must be point or range.", {
      reason_code = "DELETE_MODE_INVALID",
    })
  end
  if mode == "point" and (not has_point or has_start or has_end) then
    return e5_routing_error("PARAMS_INVALID", "Point deletion requires only point_index; range bounds are forbidden.", {
      reason_code = "POINT_DELETE_FIELDS_INVALID",
    })
  end
  if mode == "range" and (has_point or not has_start or not has_end) then
    return e5_routing_error("PARAMS_INVALID", "Range deletion requires start_seconds and end_seconds; point_index is forbidden.", {
      reason_code = "RANGE_DELETE_FIELDS_INVALID",
    })
  end
  local before_count = e5_automation_point_count_ex(envelope, autoitem_index)
  if before_count == nil then
    return e5_routing_error("COMMAND_FAILED", "CountEnvelopePointsEx failed before deletion.", {
      reason_code = "POINT_COUNT_UNAVAILABLE",
    })
  end
  local deleted_count = 0
  if mode == "point" then
    local point_index = tonumber(request.params.point_index)
    if type(point_index) ~= "number" or point_index ~= math.floor(point_index) or point_index < 0 then
      return e5_routing_error("PARAMS_INVALID", "point_index must be a non-negative integer.", {
        reason_code = "POINT_INDEX_INVALID",
      })
    end
    if point_index >= before_count then
      return e5_routing_error("REF_INVALID", "Point deletion index is outside the existing point count.", {
        reason_code = "POINT_INDEX_OUT_OF_RANGE",
        point_index = point_index,
        point_count = before_count,
      })
    end
    local target = e5_automation_point_row_ex(envelope, autoitem_index, point_index)
    local before_matches = target and e5_automation_count_tuple(envelope, autoitem_index, target) or nil
    if not target or before_matches == nil then
      return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed before exact point deletion.", {
        reason_code = "POINT_READ_FAILED",
        point_index = point_index,
      })
    end
    local call_ok, deleted = call_reaper("DeleteEnvelopePointEx", envelope, autoitem_index, point_index)
    local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
    if not call_ok or deleted ~= true or not sort_ok then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected DeleteEnvelopePointEx or lane sorting.", {
        reason_code = "POINT_DELETE_FAILED",
        point_index = point_index,
        mutation_applied = call_ok and deleted == true,
        index_maintenance_applied = sort_ok == true,
      }, false)
    end
    local after_count = e5_automation_point_count_ex(envelope, autoitem_index)
    local after_matches = e5_automation_count_tuple(envelope, autoitem_index, target)
    if after_count ~= before_count - 1 or after_matches ~= before_matches - 1 then
      return e5_routing_error("VERIFY_FAILED", "Deleted point count or exact tuple multiplicity did not read back as expected.", {
        reason_code = "POINT_DELETE_READBACK_MISMATCH",
        before_count = before_count,
        after_count = after_count,
        before_matches = before_matches,
        after_matches = after_matches,
        mutation_applied = true,
        index_maintenance_applied = true,
      }, false)
    end
    deleted_count = 1
  else
    local start_seconds = e5_automation_finite_number(request.params.start_seconds)
    local end_seconds = e5_automation_finite_number(request.params.end_seconds)
    if start_seconds == nil or end_seconds == nil or end_seconds <= start_seconds then
      return e5_routing_error("PARAMS_INVALID", "Range deletion requires finite end_seconds greater than start_seconds.", {
        reason_code = "POINT_RANGE_INVALID",
      })
    end
    local native_start, start_error = e5_automation_project_to_native_time(envelope, start_seconds)
    if native_start == nil then
      return e5_routing_error(start_error.code, start_error.message, start_error.details)
    end
    local native_end, end_error = e5_automation_project_to_native_time(envelope, end_seconds)
    if native_end == nil then
      return e5_routing_error(end_error.code, end_error.message, end_error.details)
    end
    local expected_deleted = 0
    for index = 0, before_count - 1 do
      local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
      if not row then
        return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed before range deletion.", {
          reason_code = "POINT_READ_FAILED",
          point_index = index,
        })
      end
      if row.time_seconds >= native_start and row.time_seconds < native_end then
        expected_deleted = expected_deleted + 1
      end
    end
    local call_ok, deleted = call_reaper("DeleteEnvelopePointRangeEx", envelope, autoitem_index, native_start, native_end)
    local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
    if not call_ok or deleted == false or not sort_ok then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected DeleteEnvelopePointRangeEx or lane sorting.", {
        reason_code = "POINT_RANGE_DELETE_FAILED",
        mutation_applied = call_ok and deleted ~= false,
        index_maintenance_applied = sort_ok == true,
      }, false)
    end
    local after_count = e5_automation_point_count_ex(envelope, autoitem_index)
    if after_count ~= before_count - expected_deleted then
      return e5_routing_error("VERIFY_FAILED", "Range deletion count did not match the exact pre-read range membership.", {
        reason_code = "POINT_RANGE_COUNT_MISMATCH",
        before_count = before_count,
        after_count = after_count,
        expected_deleted = expected_deleted,
        mutation_applied = true,
        index_maintenance_applied = true,
      }, false)
    end
    for index = 0, after_count - 1 do
      local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
      if not row then
        return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed during range deletion readback.", {
          reason_code = "POINT_READ_FAILED",
          point_index = index,
          mutation_applied = true,
          index_maintenance_applied = true,
        }, false)
      end
      if row.time_seconds >= native_start and row.time_seconds < native_end then
        return e5_routing_error("VERIFY_FAILED", "A point remained inside the deleted half-open time range.", {
          reason_code = "POINT_RANGE_NOT_ABSENT",
          point_index = index,
          time_seconds = row.time_seconds,
          mutation_applied = true,
          index_maintenance_applied = true,
        }, false)
      end
    end
    deleted_count = expected_deleted
  end
  local after_count = e5_automation_point_count_ex(envelope, autoitem_index)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    mode = mode,
    autoitem_index = autoitem_index,
    deleted_count = deleted_count,
    before_count = before_count,
    after_count = after_count,
    range_absent = true,
    time_basis = "project",
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_fx_ref_object(owner_kind, owner_ref, slot_index, fx_ref)
  return {
    kind = "fx",
    ref = fx_ref,
    identity = {
      scheme = owner_kind .. "_fx",
      value = owner_ref .. ":" .. tostring(slot_index),
    },
  }
end

local function e5_automation_fx_parameter_count(owner_kind, owner, slot_index)
  local api = owner_kind == "take" and "TakeFX_GetNumParams" or "TrackFX_GetNumParams"
  local ok, count = call_reaper(api, owner, slot_index)
  count = ok and first_number(count) or nil
  return count and math.max(0, math.floor(count)) or nil
end

local function e5_automation_fx_parameter_name(owner_kind, owner, slot_index, param_index)
  local api = owner_kind == "take" and "TakeFX_GetParamName" or "TrackFX_GetParamName"
  local ok, _, name = call_reaper(api, owner, slot_index, param_index, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function e5_automation_fx_parameter_ident(owner_kind, owner, slot_index, param_index)
  local api = owner_kind == "take" and "TakeFX_GetParamIdent" or "TrackFX_GetParamIdent"
  local ok, _, ident = call_reaper(api, owner, slot_index, param_index, "")
  ident = ok and first_string(ident) or nil
  return ident and ident ~= "" and bounded_string(ident, 160) or nil
end

local function e5_automation_get_fx_envelope(owner_kind, owner, slot_index, param_index, create)
  if owner_kind == "take" then
    local take = owner
    if create then
      return call_reaper("TakeFX_GetEnvelope", take, slot_index, param_index, true)
    end
    return call_reaper("TakeFX_GetEnvelope", take, slot_index, param_index, false)
  end
  local track = owner
  if create then
    return call_reaper("GetFXEnvelope", track, slot_index, param_index, true)
  end
  return call_reaper("GetFXEnvelope", track, slot_index, param_index, false)
end

local function ensure_fx_parameter_envelope(request)
  local owner_kind, owner, slot_index, owner_ref, fx_ref = e5_routing_fx_owner_from_request_refs(request)
  local param_index = tonumber(request.params and request.params.param_index)
  if not owner or type(param_index) ~= "number" or param_index ~= math.floor(param_index) or param_index < 0 then
    return e5_routing_error("FX_REF_NOT_FOUND", "FX parameter Envelope ensure requires one exact Track-FX or Take-FX ref and a non-negative integer param_index.", {})
  end
  local parameter_count = e5_automation_fx_parameter_count(owner_kind, owner, slot_index)
  if parameter_count == nil or param_index >= parameter_count then
    return e5_routing_error("FX_PARAMETER_NOT_FOUND", "FX parameter index is outside the exact live parameter count.", {
      fx_ref = fx_ref,
      param_index = param_index,
      parameter_count = parameter_count or JSON_NULL,
    })
  end
  local param_ident = e5_automation_fx_parameter_ident(owner_kind, owner, slot_index, param_index)
  if not param_ident then
    return e5_routing_error("FX_PARAMETER_IDENTITY_UNAVAILABLE", "REAPER did not return a stable parameter ident for the exact FX parameter.", {
      fx_ref = fx_ref,
      param_index = param_index,
    })
  end
  if is_string(request.params.param_ident) and request.params.param_ident ~= param_ident then
    return e5_routing_error("FX_PARAMETER_IDENTITY_MISMATCH", "Requested param_ident does not match the exact live FX parameter.", {
      fx_ref = fx_ref,
      param_index = param_index,
      requested_param_ident = bounded_string(request.params.param_ident, 160),
      live_param_ident = param_ident,
    })
  end
  local ok_existing, existing = e5_automation_get_fx_envelope(owner_kind, owner, slot_index, param_index, false)
  if not ok_existing then
    return e5_routing_error("COMMAND_FAILED", "REAPER failed the create=false FX parameter Envelope lookup.", {
      fx_ref = fx_ref,
      param_index = param_index,
    })
  end
  local created = false
  local envelope = existing
  if not envelope then
    local ok_created, created_envelope = e5_automation_get_fx_envelope(owner_kind, owner, slot_index, param_index, true)
    if not ok_created or not created_envelope then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected native FX parameter Envelope creation.", {
        fx_ref = fx_ref,
        param_index = param_index,
        mutation_applied = false,
      })
    end
    envelope = created_envelope
    created = true
  end
  local ok_readback, readback = e5_automation_get_fx_envelope(owner_kind, owner, slot_index, param_index, false)
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  local ok_valid, valid = false, false
  if ok_project and project and readback then
    ok_valid, valid = call_reaper("ValidatePtr2", project, readback, "TrackEnvelope*")
  end
  if not ok_readback or not readback or readback ~= envelope or not ok_project or not project or not ok_valid or valid ~= true then
    return e5_routing_error("VERIFY_FAILED", "FX parameter Envelope did not pass independent create=false pointer readback.", {
      fx_ref = fx_ref,
      param_index = param_index,
      mutation_applied = created,
    }, false)
  end
  local ok_parent, parent, parent_fx_index, parent_param_index
  if owner_kind == "take" then
    ok_parent, parent, parent_fx_index, parent_param_index = call_reaper("Envelope_GetParentTake", readback)
  else
    ok_parent, parent, parent_fx_index, parent_param_index = call_reaper("Envelope_GetParentTrack", readback)
  end
  if not ok_parent or parent ~= owner or math.floor(first_number(parent_fx_index) or -1) ~= slot_index or math.floor(first_number(parent_param_index) or -1) ~= param_index then
    return e5_routing_error("VERIFY_FAILED", "FX parameter Envelope parent identity did not match the requested owner, slot, and parameter.", {
      fx_ref = fx_ref,
      param_index = param_index,
      mutation_applied = created,
    }, false)
  end
  local guid = e5_automation_envelope_guid(readback)
  if not guid then
    return e5_routing_error("VERIFY_FAILED", "FX parameter Envelope did not expose a canonical GUID after ensure.", {
      fx_ref = fx_ref,
      param_index = param_index,
      mutation_applied = created,
    }, false)
  end
  local envelope_ref = "envelope:guid:" .. guid
  local param_name = e5_automation_fx_parameter_name(owner_kind, owner, slot_index, param_index)
  return e5_automation_summary(request, readback, envelope_ref, "fx", "fx_parameter", param_name, {
    fx_ref = fx_ref,
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = param_ident,
    param_name = param_name,
    created = created,
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_automation_fx_ref_object(owner_kind, owner_ref, slot_index, fx_ref),
    e5_routing_envelope_object_ref(readback, envelope_ref)
  )
end

local function e5_automation_fx_parameter_envelope_from_request(request)
  local owner_kind, owner, slot_index, owner_ref, fx_ref = e5_routing_fx_owner_from_request_refs(request)
  local param_index = tonumber(request.params and request.params.param_index)
  if not owner or type(param_index) ~= "number" or param_index ~= math.floor(param_index) or param_index < 0 then
    return nil, nil, nil
  end
  local param_count = e5_automation_fx_parameter_count(owner_kind, owner, slot_index)
  if param_count == nil or param_index >= param_count then
    return nil, nil, {
      code = "FX_PARAMETER_NOT_FOUND",
      message = "FX parameter index is outside the FX parameter count.",
      details = {
        fx_ref = fx_ref or JSON_NULL,
        slot_index = slot_index,
        param_index = param_index,
        parameter_count = param_count or JSON_NULL,
      },
    }
  end
  local ok_env, envelope = e5_automation_get_fx_envelope(owner_kind, owner, slot_index, param_index, false)
  if not ok_env or not envelope then
    return nil, nil, {
      code = "ENVELOPE_NOT_FOUND",
      message = "FX parameter envelope is not available for point insertion.",
      details = {
        fx_ref = fx_ref or JSON_NULL,
        param_index = param_index,
      },
    }
  end
  local guid = e5_automation_envelope_guid(envelope)
  if not guid then
    return nil, nil, {
      code = "VERIFY_FAILED",
      message = "FX parameter envelope did not expose a canonical GUID for point insertion.",
      details = {
        fx_ref = fx_ref or JSON_NULL,
        param_index = param_index,
      },
    }
  end
  local envelope_ref = "envelope:guid:" .. guid
  return envelope, envelope_ref, {
    owner_kind = owner_kind,
    owner = owner,
    owner_ref = owner_ref,
    fx_ref = fx_ref,
    slot_index = slot_index,
    param_index = param_index,
    param_name = e5_automation_fx_parameter_name(owner_kind, owner, slot_index, param_index),
  }
end

local function insert_fx_parameter_envelope_points(request)
  local envelope, envelope_ref, info = e5_automation_fx_parameter_envelope_from_request(request)
  if not envelope then
    return e5_routing_error(info and info.code or "FX_REF_NOT_FOUND", info and info.message or "FX parameter envelope insertion requires a resolvable track FX ref.", info and info.details or {})
  end
  local summary, err, artifacts, jobs, refs = e5_automation_insert_points(request, envelope, envelope_ref, "fx", "fx_parameter", info.param_name, request.params.points)
  if err then
    return nil, err
  end
  summary.fx_ref = info.fx_ref
  summary.owner_kind = info.owner_kind
  summary.owner_ref = info.owner_ref
  summary.param_index = info.param_index
  summary.param_ident = request.params.param_ident or JSON_NULL
  summary.param_name = info.param_name
  return summary, err, artifacts, jobs, refs
end

local function insert_sine_wave_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local start_seconds = e5_routing_finite_number(request.params.start_seconds, 0)
  local end_seconds = e5_routing_finite_number(request.params.end_seconds, start_seconds)
  if end_seconds <= start_seconds then
    return e5_routing_error("REQUEST_INVALID", "Sine wave end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local point_count = math.floor(tonumber(request.params.point_count) or 0)
  if point_count < 2 or point_count > 512 then
    return e5_routing_error("REQUEST_INVALID", "Sine wave point_count must be between 2 and 512.", {
      point_count = request.params.point_count,
    })
  end
  local center_value = e5_routing_finite_number(request.params.center_value, 0.5)
  local amplitude = math.max(0, e5_routing_finite_number(request.params.amplitude, 0))
  local cycles = e5_routing_finite_number(request.params.cycles, 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or 0))
  local tension = e5_routing_finite_number(request.params.tension, 0)
  local points = json_array({})
  for index = 0, point_count - 1 do
    local ratio = point_count == 1 and 0 or index / (point_count - 1)
    local time_seconds = start_seconds + ((end_seconds - start_seconds) * ratio)
    local radians = ratio * cycles * 2 * math.pi
    local value = e5_routing_clamp_number(center_value + (math.sin(radians) * amplitude), 0, 4, center_value)
    points[#points + 1] = {
      time_seconds = time_seconds,
      value = value,
      shape = shape,
      tension = tension,
    }
  end
  local summary, failure, artifacts, jobs, refs = e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, points, 512)
  if failure then
    return nil, failure
  end
  summary.start_seconds = start_seconds
  summary.end_seconds = end_seconds
  summary.center_value = center_value
  summary.amplitude = amplitude
  summary.cycles = cycles
  summary.point_count = point_count
  return summary, failure, artifacts, jobs, refs
end

local function set_send_automation_mode(request)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 automation set_send_automation_mode requires a resolvable send ref.", {})
  end
  local mode = e5_automation_send_mode_value(request.params.mode)
  local call_ok, accepted = call_reaper("SetTrackSendInfo_Value", source_track, 0, send_index, "I_AUTOMODE", mode)
  if not call_ok or accepted ~= true then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected send automation mode update.", {
      reason_code = "SEND_AUTOMATION_MODE_WRITE_FAILED",
    })
  end
  local read_ok, readback = call_reaper("GetTrackSendInfo_Value", source_track, 0, send_index, "I_AUTOMODE")
  readback = read_ok and first_number(readback) or nil
  if readback == nil or math.floor(readback) ~= mode then
    return e5_routing_error("VERIFY_FAILED", "Send automation mode live readback did not exactly match the request.", {
      reason_code = "SEND_AUTOMATION_MODE_READBACK_MISMATCH",
      requested_mode = mode,
      readback_mode = readback,
      mutation_applied = true,
    }, false)
  end
  return e5_routing_write_summary(request, {
    send_ref = e5_routing_send_ref(source_track, send_index),
    mode = e5_automation_mode_label(readback),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_send_object_ref(source_track, send_index))
end

local function e5_automation_item_info(envelope, item_index, key)
  local ok, value = call_reaper("GetSetAutomationItemInfo", envelope, item_index, key, 0, false)
  value = ok and first_number(value) or nil
  return value
end

local function e5_automation_item_count_exact(envelope)
  local ok, count = call_reaper("CountAutomationItems", envelope)
  count = ok and first_number(count) or nil
  if count == nil then return nil end
  return math.max(0, math.floor(count))
end

local function e5_automation_item_readback(envelope, item_index)
  local position = e5_automation_item_info(envelope, item_index, "D_POSITION")
  local length = e5_automation_item_info(envelope, item_index, "D_LENGTH")
  local pool_id = e5_automation_item_info(envelope, item_index, "D_POOL_ID")
  local start_offset = e5_automation_item_info(envelope, item_index, "D_STARTOFFS")
  local playrate = e5_automation_item_info(envelope, item_index, "D_PLAYRATE")
  local baseline = e5_automation_item_info(envelope, item_index, "D_BASELINE")
  local amplitude = e5_automation_item_info(envelope, item_index, "D_AMPLITUDE")
  local loop_source = e5_automation_item_info(envelope, item_index, "D_LOOPSRC")
  local selected = e5_automation_item_info(envelope, item_index, "D_UISEL")
  local muted = e5_automation_item_info(envelope, item_index, "D_MUTE")
  if position == nil or length == nil or pool_id == nil or start_offset == nil or playrate == nil
    or baseline == nil or amplitude == nil or loop_source == nil or selected == nil or muted == nil then
    return nil
  end
  return {
    automation_item_index = item_index,
    pool_id = math.floor(pool_id),
    position_seconds = position,
    length_seconds = length,
    start_offset_seconds = start_offset,
    playrate = playrate,
    baseline = baseline,
    amplitude = amplitude,
    loop_source = loop_source ~= 0,
    selected = selected ~= 0,
    muted = muted ~= 0,
  }
end

local function create_automation_item(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local position = e5_automation_finite_number(request.params.position_seconds)
  local length = e5_automation_finite_number(request.params.length_seconds)
  if position == nil or position < 0 or length == nil or length <= 0 then
    return e5_routing_error("PARAMS_INVALID", "Automation item position must be non-negative and length must be positive.", {
      reason_code = "AUTOMATION_ITEM_BOUNDS_INVALID",
    })
  end
  local pool_id = -1
  if request.params.pool_mode == "reuse_pool" then
    pool_id = tonumber(request.params.pool_id)
    if type(pool_id) ~= "number" or pool_id ~= math.floor(pool_id) or pool_id < 0 then
      return e5_routing_error("PARAMS_INVALID", "reuse_pool requires a non-negative integer pool_id.", {
        reason_code = "AUTOMATION_ITEM_POOL_INVALID",
      })
    end
  elseif request.params.pool_mode ~= "new_empty" then
    return e5_routing_error("PARAMS_INVALID", "pool_mode must be new_empty or reuse_pool.", {
      reason_code = "AUTOMATION_ITEM_POOL_MODE_INVALID",
    })
  end
  local before_count = e5_automation_item_count_exact(envelope)
  if before_count == nil then
    return e5_routing_error("COMMAND_FAILED", "CountAutomationItems failed before automation item creation.", {
      reason_code = "AUTOMATION_ITEM_COUNT_UNAVAILABLE",
    })
  end
  local ok, item_index = call_reaper("InsertAutomationItem", envelope, pool_id, position, length)
  item_index = ok and math.floor(first_number(item_index) or -1) or -1
  if item_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertAutomationItem.", {
      envelope_ref = envelope_ref,
      reason_code = "AUTOMATION_ITEM_CREATE_FAILED",
    })
  end
  local after_count = e5_automation_item_count_exact(envelope)
  local readback = e5_automation_item_readback(envelope, item_index)
  if after_count ~= before_count + 1
    or not readback
    or not e5_automation_numbers_match(readback.position_seconds, position)
    or not e5_automation_numbers_match(readback.length_seconds, length)
    or request.params.pool_mode == "reuse_pool" and readback.pool_id ~= pool_id then
    return e5_routing_error("VERIFY_FAILED", "Created automation item did not read back with exact count, bounds, and pool identity.", {
      reason_code = "AUTOMATION_ITEM_CREATE_READBACK_MISMATCH",
      before_count = before_count,
      after_count = after_count,
      automation_item_index = item_index,
      mutation_applied = true,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, readback), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_automation_item_bounds(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local item_index = tonumber(request.params.automation_item_index)
  if type(item_index) ~= "number" or item_index ~= math.floor(item_index) or item_index < 0 then
    return e5_routing_error("PARAMS_INVALID", "automation_item_index must be a non-negative integer.", {
      reason_code = "AUTOMATION_ITEM_INDEX_INVALID",
    })
  end
  local item_count = e5_automation_item_count_exact(envelope)
  if item_count == nil then
    return e5_routing_error("COMMAND_FAILED", "CountAutomationItems failed before bounds update.", {
      reason_code = "AUTOMATION_ITEM_COUNT_UNAVAILABLE",
    })
  end
  if item_index >= item_count then
    return e5_routing_error("REF_INVALID", "automation_item_index is outside the existing item count; bounds update never creates.", {
      reason_code = "AUTOMATION_ITEM_INDEX_OUT_OF_RANGE",
      automation_item_index = item_index,
      automation_item_count = item_count,
    })
  end
  local requested = {}
  for _, spec in ipairs({
    { param = "position_seconds", key = "D_POSITION", positive = false, non_negative = true },
    { param = "length_seconds", key = "D_LENGTH", positive = true },
    { param = "start_offset_seconds", key = "D_STARTOFFS" },
    { param = "playrate", key = "D_PLAYRATE", positive = true },
  }) do
    if request.params[spec.param] ~= nil then
      local value = e5_automation_finite_number(request.params[spec.param])
      if value == nil or spec.positive and value <= 0 or spec.non_negative and value < 0 then
        return e5_routing_error("PARAMS_INVALID", "Automation item bounds fields are outside their finite valid ranges.", {
          reason_code = "AUTOMATION_ITEM_BOUNDS_INVALID",
          field = spec.param,
        })
      end
      requested[#requested + 1] = { param = spec.param, key = spec.key, value = value }
    end
  end
  for index = 1, #requested do
    local field = requested[index]
    local set_ok = call_reaper("GetSetAutomationItemInfo", envelope, item_index, field.key, field.value, true)
    if not set_ok then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected an automation item bounds field update.", {
        reason_code = "AUTOMATION_ITEM_BOUNDS_WRITE_FAILED",
        field = field.param,
        fields_applied_before_failure = index - 1,
        mutation_applied = index > 1,
        partial_mutation_possible = index > 1,
      }, false)
    end
  end
  local after_count = e5_automation_item_count_exact(envelope)
  local readback = e5_automation_item_readback(envelope, item_index)
  if after_count ~= item_count or not readback then
    return e5_routing_error("VERIFY_FAILED", "Automation item count or readback changed unexpectedly during bounds update.", {
      reason_code = "AUTOMATION_ITEM_BOUNDS_READBACK_MISMATCH",
      before_count = item_count,
      after_count = after_count,
      mutation_applied = #requested > 0,
      partial_mutation_possible = #requested > 0,
    }, false)
  end
  for index = 1, #requested do
    local field = requested[index]
    if not e5_automation_numbers_match(readback[field.param], field.value) then
      return e5_routing_error("VERIFY_FAILED", "Automation item bounds live readback did not match a requested field.", {
        reason_code = "AUTOMATION_ITEM_BOUNDS_READBACK_MISMATCH",
        field = field.param,
        requested = field.value,
        readback = readback[field.param],
        mutation_applied = #requested > 0,
        partial_mutation_possible = #requested > 1,
      }, false)
    end
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, readback), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local ALPHA3_3_B1D_DELETE_AUTOMATION_ITEM_ACTION_ID = 42086

local function e5_automation_item_identity_matches(actual, expected)
  return actual and expected
    and e5_automation_numbers_match(actual.position_seconds, expected.position_seconds)
    and e5_automation_numbers_match(actual.length_seconds, expected.length_seconds)
    and actual.pool_id == expected.pool_id
    and e5_automation_numbers_match(actual.start_offset_seconds, expected.start_offset_seconds)
    and e5_automation_numbers_match(actual.playrate, expected.playrate)
    and e5_automation_numbers_match(actual.baseline, expected.baseline)
    and e5_automation_numbers_match(actual.amplitude, expected.amplitude)
    and actual.loop_source == expected.loop_source
    and actual.muted == expected.muted
end

local function e5_automation_pointer_lists_match(actual, expected)
  if #actual ~= #expected then return false end
  for index = 1, #actual do
    if actual[index] ~= expected[index] then return false end
  end
  return true
end

local function e5_automation_selected_tracks(project)
  local ok_count, count = call_reaper("CountSelectedTracks2", project, true)
  count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or nil
  if count == nil then return nil end
  local tracks = {}
  for index = 0, count - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack2", project, index, true)
    if not ok_track or not track then return nil end
    tracks[#tracks + 1] = track
  end
  return tracks
end

local function e5_automation_selected_items(project)
  local ok_count, count = call_reaper("CountSelectedMediaItems", project)
  count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or nil
  if count == nil then return nil end
  local items = {}
  for index = 0, count - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", project, index)
    if not ok_item or not item then return nil end
    items[#items + 1] = item
  end
  return items
end

local function e5_automation_snapshot_delete_ui_state(project)
  local ok_context, cursor_context = call_reaper("GetCursorContext2", true)
  local ok_envelope, selected_envelope = call_reaper("GetSelectedEnvelope", project)
  local selected_tracks = e5_automation_selected_tracks(project)
  local selected_items = e5_automation_selected_items(project)
  local ok_time, time_start, time_end = call_reaper("GetSet_LoopTimeRange2", project, false, false, 0, 0, false)
  local ok_loop, loop_start, loop_end = call_reaper("GetSet_LoopTimeRange2", project, false, true, 0, 0, false)
  local ok_cursor, edit_cursor = call_reaper("GetCursorPositionEx", project)
  if not ok_context or not ok_envelope or not selected_tracks or not selected_items or not ok_time or not ok_loop or not ok_cursor then
    return nil
  end
  return {
    cursor_context = math.floor(first_number(cursor_context) or 0),
    selected_envelope = selected_envelope,
    selected_tracks = selected_tracks,
    selected_items = selected_items,
    time_start = first_number(time_start) or 0,
    time_end = first_number(time_end) or 0,
    loop_start = first_number(loop_start) or 0,
    loop_end = first_number(loop_end) or 0,
    edit_cursor = first_number(edit_cursor) or 0,
  }
end

local function e5_automation_restore_delete_ui_state(project, snapshot, envelope_snapshots, target_envelope, target_index, target_deleted)
  call_reaper("SetCursorContext", 2, snapshot.selected_envelope)
  if snapshot.cursor_context ~= 2 then
    call_reaper("SetCursorContext", snapshot.cursor_context, nil)
  end

  local ok_master, master = call_reaper("GetMasterTrack", project)
  if ok_master and master then call_reaper("SetTrackSelected", master, false) end
  local ok_tracks, track_count = call_reaper("CountTracks", project)
  track_count = ok_tracks and math.max(0, math.floor(first_number(track_count) or 0)) or 0
  for index = 0, track_count - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    if ok_track and track then call_reaper("SetTrackSelected", track, false) end
  end
  for index = 1, #snapshot.selected_tracks do
    call_reaper("SetTrackSelected", snapshot.selected_tracks[index], true)
  end

  local ok_items, item_count = call_reaper("CountMediaItems", project)
  item_count = ok_items and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  for index = 0, item_count - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, index)
    if ok_item and item then call_reaper("SetMediaItemSelected", item, false) end
  end
  for index = 1, #snapshot.selected_items do
    call_reaper("SetMediaItemSelected", snapshot.selected_items[index], true)
  end

  call_reaper("GetSet_LoopTimeRange2", project, true, false, snapshot.time_start, snapshot.time_end, false)
  call_reaper("GetSet_LoopTimeRange2", project, true, true, snapshot.loop_start, snapshot.loop_end, false)
  call_reaper("SetEditCurPos2", project, snapshot.edit_cursor, false, false)

  local selection_restored = true
  for envelope_index = 1, #envelope_snapshots do
    local envelope_snapshot = envelope_snapshots[envelope_index]
    local current_count = e5_automation_item_count_exact(envelope_snapshot.envelope) or 0
    for current_index = 0, current_count - 1 do
      local original_index = current_index
      if target_deleted and envelope_snapshot.envelope == target_envelope and current_index >= target_index then
        original_index = current_index + 1
      end
      local original = envelope_snapshot.items[original_index + 1]
      local desired = original and original.selected and 1 or 0
      local set_ok = call_reaper("GetSetAutomationItemInfo", envelope_snapshot.envelope, current_index, "D_UISEL", desired, true)
      local readback = e5_automation_item_info(envelope_snapshot.envelope, current_index, "D_UISEL")
      if not set_ok or readback == nil or (readback ~= 0) ~= (desired ~= 0) then
        selection_restored = false
      end
    end
  end

  local ok_context, cursor_context = call_reaper("GetCursorContext2", true)
  local ok_envelope, selected_envelope = call_reaper("GetSelectedEnvelope", project)
  local selected_tracks = e5_automation_selected_tracks(project)
  local selected_items = e5_automation_selected_items(project)
  local ok_time, time_start, time_end = call_reaper("GetSet_LoopTimeRange2", project, false, false, 0, 0, false)
  local ok_loop, loop_start, loop_end = call_reaper("GetSet_LoopTimeRange2", project, false, true, 0, 0, false)
  local ok_cursor, edit_cursor = call_reaper("GetCursorPositionEx", project)
  return selection_restored
    and ok_context and math.floor(first_number(cursor_context) or -1) == snapshot.cursor_context
    and ok_envelope and selected_envelope == snapshot.selected_envelope
    and selected_tracks and e5_automation_pointer_lists_match(selected_tracks, snapshot.selected_tracks)
    and selected_items and e5_automation_pointer_lists_match(selected_items, snapshot.selected_items)
    and ok_time and e5_automation_numbers_match(first_number(time_start), snapshot.time_start)
    and e5_automation_numbers_match(first_number(time_end), snapshot.time_end)
    and ok_loop and e5_automation_numbers_match(first_number(loop_start), snapshot.loop_start)
    and e5_automation_numbers_match(first_number(loop_end), snapshot.loop_end)
    and ok_cursor and e5_automation_numbers_match(first_number(edit_cursor), snapshot.edit_cursor)
end

local function delete_automation_item(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then return nil, err end
  local item_index = tonumber(request.params.automation_item_index)
  if type(item_index) ~= "number" or item_index ~= math.floor(item_index) or item_index < 0 then
    return e5_routing_error("PARAMS_INVALID", "automation_item_index must be a non-negative integer.", {
      reason_code = "AUTOMATION_ITEM_INDEX_INVALID",
    })
  end
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  if not ok_project or not project then
    return e5_routing_error("COMMAND_FAILED", "Current REAPER project identity is unavailable before Automation Item deletion.", {
      reason_code = "PROJECT_IDENTITY_UNAVAILABLE",
    })
  end
  local ui_snapshot = e5_automation_snapshot_delete_ui_state(project)
  if not ui_snapshot then
    return e5_routing_error("COMMAND_FAILED", "Automation Item deletion could not snapshot the complete audited UI state.", {
      reason_code = "AUTOMATION_ITEM_UI_SNAPSHOT_FAILED",
    })
  end
  local envelope_snapshots = {}
  local target_snapshot = nil
  local enumeration_complete, enumeration_reasons = e5_automation_each_project_envelope(function(candidate)
    local count = e5_automation_item_count_exact(candidate)
    local rows = {}
    if count == nil then
      rows = nil
    else
      for index = 0, count - 1 do
        local row = e5_automation_item_readback(candidate, index)
        if not row then rows = nil break end
        rows[#rows + 1] = row
      end
    end
    envelope_snapshots[#envelope_snapshots + 1] = { envelope = candidate, items = rows, count = count }
    if candidate == envelope then target_snapshot = envelope_snapshots[#envelope_snapshots] end
  end)
  if not enumeration_complete or not target_snapshot or not target_snapshot.items then
    return e5_routing_error("COMMAND_FAILED", "Automation Item deletion requires complete Master/Track/Take/FX Envelope coverage and full Item rows.", {
      reason_code = "AUTOMATION_ITEM_SELECTION_COVERAGE_INCOMPLETE",
      coverage_reasons = enumeration_reasons,
    })
  end
  for index = 1, #envelope_snapshots do
    if not envelope_snapshots[index].items then
      return e5_routing_error("COMMAND_FAILED", "Automation Item deletion could not snapshot every Item row before selection changes.", {
        reason_code = "AUTOMATION_ITEM_READBACK_INCOMPLETE",
      })
    end
  end
  if item_index >= target_snapshot.count then
    return e5_routing_error("REF_INVALID", "automation_item_index is outside the exact target Envelope Item count.", {
      reason_code = "AUTOMATION_ITEM_INDEX_OUT_OF_RANGE",
      automation_item_index = item_index,
      automation_item_count = target_snapshot.count,
    })
  end
  local target_item = target_snapshot.items[item_index + 1]
  for envelope_index = 1, #envelope_snapshots do
    local envelope_snapshot = envelope_snapshots[envelope_index]
    for index = 0, envelope_snapshot.count - 1 do
      local clear_ok = call_reaper("GetSetAutomationItemInfo", envelope_snapshot.envelope, index, "D_UISEL", 0, true)
      local cleared = e5_automation_item_info(envelope_snapshot.envelope, index, "D_UISEL")
      if not clear_ok or cleared == nil or cleared ~= 0 then
        e5_automation_restore_delete_ui_state(project, ui_snapshot, envelope_snapshots, envelope, item_index, false)
        return e5_routing_error("COMMAND_FAILED", "Automation Item selection could not be cleared completely before fixed Action 42086.", {
          reason_code = "AUTOMATION_ITEM_SELECTION_CLEAR_FAILED",
        })
      end
    end
  end
  local select_ok = call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_UISEL", 1, true)
  local selected = e5_automation_item_info(envelope, item_index, "D_UISEL")
  if not select_ok or selected == nil or selected == 0 then
    e5_automation_restore_delete_ui_state(project, ui_snapshot, envelope_snapshots, envelope, item_index, false)
    return e5_routing_error("COMMAND_FAILED", "Exact Automation Item selection did not read back before fixed Action 42086.", {
      reason_code = "AUTOMATION_ITEM_TARGET_SELECTION_FAILED",
    })
  end
  local action_ok = call_reaper("Main_OnCommandEx", ALPHA3_3_B1D_DELETE_AUTOMATION_ITEM_ACTION_ID, 0, 0)
  local after_count = e5_automation_item_count_exact(envelope)
  local ordered_absence = action_ok and after_count == target_snapshot.count - 1
  if ordered_absence then
    for index = 0, after_count - 1 do
      local actual = e5_automation_item_readback(envelope, index)
      local expected = target_snapshot.items[(index < item_index and index or index + 1) + 1]
      if not e5_automation_item_identity_matches(actual, expected) then
        ordered_absence = false
        break
      end
    end
  end
  local target_deleted = after_count == target_snapshot.count - 1
  local state_restored = e5_automation_restore_delete_ui_state(project, ui_snapshot, envelope_snapshots, envelope, item_index, target_deleted)
  if not action_ok or not ordered_absence or not state_restored then
    return e5_routing_error("VERIFY_FAILED", "Fixed Action 42086 did not prove exact Item absence with complete UI-state restoration.", {
      reason_code = "AUTOMATION_ITEM_DELETE_READBACK_MISMATCH",
      before_count = target_snapshot.count,
      after_count = after_count or JSON_NULL,
      target_absent = ordered_absence,
      state_restored = state_restored,
      mutation_applied = action_ok,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    automation_item_index = item_index,
    deleted_count = 1,
    before_count = target_snapshot.count,
    after_count = after_count,
    fixed_action_id = ALPHA3_3_B1D_DELETE_AUTOMATION_ITEM_ACTION_ID,
    target_absent = true,
    state_restoration_status = "passed",
    deleted_item = target_item,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function resolve_send_envelope(request)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 automation resolve_send_envelope requires a resolvable send ref.", {})
  end
  local envelope, envelope_ref, parent_kind, key, display_name = e5_automation_send_envelope(source_track, send_index, request.params.envelope_type or "volume")
  if not envelope then
    return e5_routing_error("ENVELOPE_NOT_FOUND", "E5 automation resolve_send_envelope could not resolve the send envelope.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    send_ref = e5_routing_send_ref(source_track, send_index),
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end
