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

local function e5_routing_channel_count(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_NCHAN")
  local channels = ok and first_number(value) or 2
  if channels < 2 then
    return 2
  end
  return math.floor(channels)
end

local function e5_routing_send_summary(source_track, send_index, category)
  local ok_destination, destination_track = call_reaper("GetTrackSendInfo_Value", source_track, category, send_index, "P_DESTTRACK")
  if not ok_destination or not destination_track then
    return nil
  end
  return {
    send_ref = e5_routing_send_ref(source_track, send_index),
    category = category == -1 and "receive" or "send",
    source_track_ref = e5_routing_track_ref_string(source_track),
    destination_track_ref = e5_routing_track_ref_string(destination_track),
    index = send_index,
    volume = e5_routing_read_send_value(source_track, category, send_index, "D_VOL", 1),
    pan = e5_routing_read_send_value(source_track, category, send_index, "D_PAN", 0),
    muted = e5_routing_read_send_value(source_track, category, send_index, "B_MUTE", 0) ~= 0,
    mode = e5_routing_send_mode_label(e5_routing_read_send_value(source_track, category, send_index, "I_SENDMODE", 0)),
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
  local count = e5_routing_send_count(track, category)
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
    end
  end
  return rows, refs, truncated
end

local function read_track_routing(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5-R1 read_track_routing requires a resolvable track ref.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_routes, 32, 128)
  local sends, send_refs, sends_truncated = e5_routing_read_sends(track, 0, limit)
  local receives = json_array({})
  local receive_refs = json_array({})
  local receives_truncated = false
  if request.params.include_receives == true then
    receives, receive_refs, receives_truncated = e5_routing_read_sends(track, -1, limit)
  end
  local track_ref = e5_routing_track_ref_string(track)
  local refs = e5_routing_refs(e5_routing_track_object_ref(track))
  e5_routing_append_refs(refs, send_refs)
  e5_routing_append_refs(refs, receive_refs)
  return e5_routing_summary(request, {
    track_ref = track_ref,
    channel_count = e5_routing_channel_count(track),
    master_parent_enabled = request.params.include_master_parent == false and JSON_NULL or e5_routing_master_parent_enabled(track),
    sends = sends,
    receives = receives,
    truncated = sends_truncated or receives_truncated,
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
  local send_index = existing
  if send_index == nil then
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
  summary.created = existing == nil
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
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_track_channel_count requires a resolvable track ref.", {})
  end
  local channels = math.floor(tonumber(request.params.channel_count) or 2)
  if channels < 2 then
    channels = 2
  end
  if channels % 2 == 1 then
    channels = channels + 1
  end
  if channels > 64 then
    channels = 64
  end
  if not e5_routing_set_media_track_value(track, "I_NCHAN", channels) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the track channel-count update.", {})
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    channel_count = e5_routing_channel_count(track),
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
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local max_tracks = READ_B_MEDIA.bounded_limit(request, request.params.max_tracks, 8, 8)
  local max_edges = READ_B_MEDIA.bounded_limit(request, request.params.max_edges, 24, 24)
  local tracks = json_array({})
  local edges = json_array({})
  local refs = json_array({})
  local truncated = total > max_tracks
  for index = 0, math.min(total, max_tracks) - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      local track_ref = e5_routing_track_ref_string(track)
      tracks[#tracks + 1] = {
        track_ref = track_ref,
        index = index,
        channels = e5_routing_channel_count(track),
        master = request.params.include_master_parent == false and JSON_NULL or e5_routing_master_parent_enabled(track),
      }
      refs[#refs + 1] = e5_routing_track_object_ref(track)
      local ok_send_count, send_count = call_reaper("GetTrackNumSends", track, 0)
      send_count = ok_send_count and math.max(0, math.floor(first_number(send_count) or 0)) or 0
      if not ok_send_count then
        mark_incomplete("SEND_COUNT_UNAVAILABLE")
      end
      for send_index = 0, send_count - 1 do
        if #edges >= max_edges then
          truncated = true
          break
        end
        local summary = e5_routing_compact_send_summary(track, send_index)
        if summary then
          edges[#edges + 1] = summary
          refs[#refs + 1] = e5_routing_send_object_ref(track, send_index)
        end
      end
    end
    if #edges >= max_edges then
      break
    end
  end
  return e5_routing_summary(request, {
    track_count = total,
    returned_track_count = #tracks,
    edge_count = #edges,
    tracks = tracks,
    edges = edges,
    truncated = truncated,
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
    return envelope, ref, info.parent_kind, info.key, info.name
  end
  local key = ref:match("^envelope:track:(%a+)$")
  if key then
    local track = e5_routing_resolve_track_token("track:index:0")
    if not track then
      return nil
    end
    return e5_automation_track_envelope(track, key)
  end
  local track_ref, track_key = ref:match("^envelope:track:(track:[^:]+:.+):(%a+)$")
  if track_ref and track_key then
    local track = e5_routing_resolve_track_token(track_ref)
    if not track then
      return nil
    end
    return e5_automation_track_envelope(track, track_key)
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
      return envelope, ref, "track", key, name
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
      return envelope, ref, "take", key, name
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
      return envelope, ref, "fx", "fx_parameter", name
    end
    return nil
  end
  local send_ref, send_key, send_fingerprint = ref:match("^envelope:(send:track:.+:%d+):(%a+):fingerprint:(%d+)$")
  if send_ref and send_key then
    local source_track, send_index = e5_routing_send_index_from_ref(send_ref)
    local envelope, _, parent_kind, key_name, display_name = source_track and e5_automation_send_envelope(source_track, send_index, send_key) or nil
    if envelope and e5_automation_snapshot_ref_matches(envelope, send_fingerprint, display_name, key_name, "send", source_track) then
      return envelope, ref, parent_kind, key_name, display_name
    end
    return nil
  end
  send_ref, send_key = ref:match("^envelope:(send:track:.+:%d+):(%a+)$")
  if send_ref and send_key then
    local source_track, send_index = e5_routing_send_index_from_ref(send_ref)
    if not source_track then
      return nil
    end
    return e5_automation_send_envelope(source_track, send_index, send_key)
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
      return e5_automation_track_envelope(track, request.params.envelope_name or "Volume")
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
  }
  if is_object(extra) then
    for k, v in pairs(extra) do
      summary[k] = v
    end
  end
  return e5_routing_summary(request, summary)
end

local function e5_automation_resolve_or_error(request, message)
  local envelope, envelope_ref, parent_kind, key, display_name = e5_automation_envelope_from_request(request)
  if not envelope then
    local _, err = e5_routing_error("ENVELOPE_NOT_FOUND", message or "E5 automation requires a resolvable envelope ref.", {})
    return nil, nil, nil, nil, nil, err
  end
  return envelope, envelope_ref, parent_kind, key, display_name
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
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function evaluate_envelope_at_time(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, 0)
  local sample_rate = e5_routing_finite_number(request.params.sample_rate, 48000)
  local samples_requested = math.max(0, math.floor(tonumber(request.params.samples_requested) or 0))
  local ok, valid_samples, value, dvds, ddvds, dddvds = call_reaper("Envelope_Evaluate", envelope, time_seconds, sample_rate, samples_requested)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected Envelope_Evaluate.", {
      envelope_ref = envelope_ref,
      time_seconds = time_seconds,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    time_seconds = time_seconds,
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
  local selected = request.params.selected == true
  local before = e5_automation_point_count_ex(envelope, autoitem_index)
  if before == nil then
    return e5_routing_error("COMMAND_FAILED", "CountEnvelopePointsEx failed before point insertion.", {
      reason_code = "POINT_COUNT_UNAVAILABLE",
    })
  end
  local call_ok, inserted = call_reaper("InsertEnvelopePointEx", envelope, autoitem_index, time_seconds, value, shape, tension, selected, false)
  local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
  if not call_ok or inserted ~= true or not sort_ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePointEx or lane sorting.", {
      reason_code = "POINT_INSERT_FAILED",
      envelope_ref = envelope_ref,
      mutation_applied = call_ok and inserted == true,
      index_maintenance_applied = sort_ok == true,
    })
  end
  local after = e5_automation_point_count_ex(envelope, autoitem_index)
  if after ~= before + 1 then
    return e5_routing_error("VERIFY_FAILED", "Point count did not increase by exactly one after insertion.", {
      reason_code = "POINT_COUNT_READBACK_MISMATCH",
      before_count = before,
      after_count = after,
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  local point_index, readback = e5_automation_find_matching_point(envelope, autoitem_index, {
    time_seconds = time_seconds,
    value = value,
    shape = shape,
    tension = tension,
    selected = selected,
  })
  if point_index == nil then
    return e5_routing_error("VERIFY_FAILED", "Inserted point fields were not found in exact live readback.", {
      reason_code = "POINT_READBACK_MISMATCH",
      autoitem_index = autoitem_index,
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    point_index = point_index,
    time_seconds = readback.time_seconds,
    value = readback.value,
    shape = readback.shape,
    tension = readback.tension,
    selected = readback.selected,
    inserted_count = 1,
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
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 16, 64)
  local items = json_array({})
  for index = 0, math.min(total, limit) - 1 do
    local position = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POSITION", 0, false))
    local length = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_LENGTH", 0, false))
    local pool_id = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POOL_ID", 0, false))
    items[#items + 1] = {
      automation_item_index = index,
      position_seconds = first_number(position) or 0,
      length_seconds = first_number(length) or 0,
      pool_id = math.floor(first_number(pool_id) or -1),
    }
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    items = items,
    returned_count = #items,
    total_count = total,
    next_cursor = total > limit and tostring(limit) or JSON_NULL,
    truncated = total > limit,
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
  local time_seconds = request.params.time_seconds == nil and current.time_seconds or e5_automation_finite_number(request.params.time_seconds)
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
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    point_index = readback_index,
    time_seconds = readback.time_seconds,
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
  return e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, request.params.points, 32)
end

e5_automation_insert_points = function(request, envelope, envelope_ref, parent_kind, key, display_name, points, max_points)
  if not is_json_array(points) then
    return e5_routing_error("PARAMS_INVALID", "E5 automation point insertion requires a points array.", {
      reason_code = "POINT_BATCH_INVALID",
    })
  end
  max_points = max_points or 128
  if #points < 1 or #points > max_points then
    return e5_routing_error("PARAMS_INVALID", "Point batch size is outside the accepted bound and will not be silently truncated.", {
      reason_code = "POINT_BATCH_LIMIT_EXCEEDED",
      requested_count = #points,
      max_points = max_points,
    })
  end
  local autoitem_index, autoitem_error = e5_automation_autoitem_index(request, envelope)
  if autoitem_index == nil then return nil, autoitem_error end
  local before = e5_automation_point_count_ex(envelope, autoitem_index)
  if before == nil then
    return e5_routing_error("COMMAND_FAILED", "CountEnvelopePointsEx failed before batch insertion.", {
      reason_code = "POINT_COUNT_UNAVAILABLE",
      autoitem_index = autoitem_index,
    })
  end
  local normalized = {}
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
    local normalized_point = {
      time_seconds = time_seconds,
      value = value,
      shape = shape,
      tension = tension,
      selected = point.selected == true,
    }
    normalized[#normalized + 1] = normalized_point
    local call_ok, inserted = call_reaper("InsertEnvelopePointEx", envelope, autoitem_index, time_seconds, value, shape, tension, normalized_point.selected, true)
    if not call_ok or inserted ~= true then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePointEx in point batch.", {
        reason_code = "POINT_BATCH_INSERT_FAILED",
        envelope_ref = envelope_ref,
        point_index = index - 1,
        inserted_before_failure = index - 1,
        mutation_applied = index > 1,
        index_maintenance_applied = false,
      }, false)
    end
    min_value = min_value and math.min(min_value, value) or value
    max_value = max_value and math.max(max_value, value) or value
  end
  local sort_ok = call_reaper("Envelope_SortPointsEx", envelope, autoitem_index)
  if not sort_ok then
    return e5_routing_error("COMMAND_FAILED", "Envelope_SortPointsEx failed after point batch insertion.", {
      reason_code = "POINT_SORT_FAILED",
      inserted_count = #normalized,
      mutation_applied = true,
      index_maintenance_applied = false,
    }, false)
  end
  local after = e5_automation_point_count_ex(envelope, autoitem_index)
  if after ~= before + #normalized then
    return e5_routing_error("VERIFY_FAILED", "Batch insertion point count did not increase by the exact requested count.", {
      reason_code = "POINT_COUNT_READBACK_MISMATCH",
      before_count = before,
      after_count = after,
      requested_count = #normalized,
      mutation_applied = true,
      index_maintenance_applied = true,
    }, false)
  end
  local used = {}
  local readback = {}
  for index = 1, #normalized do
    local point_index, row = e5_automation_find_matching_point(envelope, autoitem_index, normalized[index], used)
    if point_index == nil then
      return e5_routing_error("VERIFY_FAILED", "Batch insertion could not find every requested point in exact live readback.", {
        reason_code = "POINT_BATCH_READBACK_MISMATCH",
        requested_index = index - 1,
        mutation_applied = true,
        index_maintenance_applied = true,
      }, false)
    end
    used[point_index] = true
    readback[#readback + 1] = row
  end
  table.sort(readback, function(a, b)
    if a.time_seconds == b.time_seconds then return a.point_index < b.point_index end
    return a.time_seconds < b.time_seconds
  end)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    autoitem_index = autoitem_index,
    requested_count = #points,
    inserted_count = #normalized,
    processed_count = #normalized,
    first_time_seconds = readback[1].time_seconds,
    last_time_seconds = readback[#readback].time_seconds,
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
    local expected_deleted = 0
    for index = 0, before_count - 1 do
      local row = e5_automation_point_row_ex(envelope, autoitem_index, index)
      if not row then
        return e5_routing_error("COMMAND_FAILED", "GetEnvelopePointEx failed before range deletion.", {
          reason_code = "POINT_READ_FAILED",
          point_index = index,
        })
      end
      if row.time_seconds >= start_seconds and row.time_seconds < end_seconds then
        expected_deleted = expected_deleted + 1
      end
    end
    local call_ok, deleted = call_reaper("DeleteEnvelopePointRangeEx", envelope, autoitem_index, start_seconds, end_seconds)
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
      if row.time_seconds >= start_seconds and row.time_seconds < end_seconds then
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
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_fx_parameter_envelope_from_request(request)
  local track, slot_index = e5_routing_fx_from_request_refs(request)
  local param_index = math.floor(tonumber(request.params and request.params.param_index) or -1)
  if not track or param_index < 0 then
    return nil, nil, nil
  end
  local ok_count, param_count = call_reaper("TrackFX_GetNumParams", track, slot_index)
  param_count = ok_count and math.floor(first_number(param_count) or 0) or 0
  if param_index >= param_count then
    return nil, nil, {
      code = "FX_PARAMETER_NOT_FOUND",
      message = "FX parameter index is outside the FX parameter count.",
      details = {
        slot_index = slot_index,
        param_index = param_index,
        parameter_count = param_count,
      },
    }
  end
  local ok_env, envelope = call_reaper("GetFXEnvelope", track, slot_index, param_index, false)
  if not ok_env or not envelope then
    return nil, nil, {
      code = "ENVELOPE_NOT_FOUND",
      message = "FX parameter envelope is not available for point insertion.",
      details = {
        fx_ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
        param_index = param_index,
      },
    }
  end
  local ok_name, _, name = call_reaper("TrackFX_GetParamName", track, slot_index, param_index, "")
  local envelope_ref = "envelope:fx:track:" .. tostring(slot_index) .. ":param:" .. tostring(param_index)
  return envelope, envelope_ref, {
    track = track,
    slot_index = slot_index,
    param_index = param_index,
    param_name = bounded_string(ok_name and first_string(name) or "", 160),
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
  summary.fx_ref = "fx:" .. e5_routing_track_ref_string(info.track) .. ":" .. tostring(info.slot_index)
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
  if position == nil or length == nil or pool_id == nil or start_offset == nil or playrate == nil then
    return nil
  end
  return {
    automation_item_index = item_index,
    pool_id = math.floor(pool_id),
    position_seconds = position,
    length_seconds = length,
    start_offset_seconds = start_offset,
    playrate = playrate,
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
