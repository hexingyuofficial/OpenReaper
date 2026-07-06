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
  return {
    kind = "envelope",
    ref = ref,
    identity = {
      scheme = "synthetic",
      value = ref,
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
  if not track_ref then
    slot_text = fx_ref:match("^fx:track:(%d+)$")
    if slot_text then
      track_ref = "track:index:0"
    end
  end
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
      local send_count = e5_routing_send_count(track, 0)
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

local function e5_automation_envelope_from_ref_string(ref)
  if not is_string(ref) then
    return nil
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
  local send_ref, send_key = ref:match("^envelope:(send:track:.+:%d+):(%a+)$")
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

local function e5_automation_point_row(envelope, index)
  local ok, time, value, shape, tension, selected = call_reaper("GetEnvelopePoint", envelope, index)
  if not ok then
    return nil
  end
  return {
    point_index = index,
    time_seconds = first_number(time) or 0,
    value = first_number(value) or 0,
    shape = math.floor(first_number(shape) or 0),
    tension = first_number(tension) or 0,
    selected = selected == true,
  }
end

local function read_envelope_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local total = e5_automation_envelope_point_count(envelope)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 16, 64)
  local points = json_array({})
  for index = 0, math.min(total, limit) - 1 do
    local row = e5_automation_point_row(envelope, index)
    if row then
      points[#points + 1] = row
    end
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    points = points,
    returned_count = #points,
    total_count = total,
    next_cursor = total > limit and tostring(limit) or JSON_NULL,
    truncated = total > limit,
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
  local ok_alloc, br_env = call_reaper("BR_EnvAlloc", envelope, false)
  if ok_alloc and br_env then
    local props = e5_automation_br_properties(envelope)
    local active = request.params.active
    if type(active) ~= "boolean" then active = props.active end
    local visible = request.params.visible
    if type(visible) ~= "boolean" then visible = props.visible end
    local armed = request.params.armed
    if type(armed) ~= "boolean" then armed = props.armed end
    local show_lane = request.params.show_lane
    if type(show_lane) ~= "boolean" then show_lane = props.show_lane end
    call_reaper("BR_EnvSetProperties", br_env, active, visible, armed, show_lane, props.lane_height or 0, props.default_shape or 0, props.fader_scaling == true, props.automation_items_options or -1)
    call_reaper("BR_EnvFree", br_env, true)
    call_reaper("UpdateArrange")
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function insert_envelope_point(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, 0)
  local value = e5_routing_clamp_number(request.params.value, 0, 4, 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or 0))
  local tension = e5_routing_finite_number(request.params.tension, 0)
  local selected = request.params.selected == true
  local before = e5_automation_envelope_point_count(envelope)
  local ok = call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, selected, false)
  call_reaper("Envelope_SortPoints", envelope)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePoint.", {
      envelope_ref = envelope_ref,
    })
  end
  local after = e5_automation_envelope_point_count(envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    point_index = math.max(0, after - 1),
    time_seconds = time_seconds,
    value = value,
    inserted_count = math.max(0, after - before),
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
  return "trim_off"
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
  return read_track_automation_mode(request)
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
  local point_index = math.max(0, math.floor(tonumber(request.params.point_index) or 0))
  if point_index >= e5_automation_envelope_point_count(envelope) then
    local inserted = insert_envelope_point(request)
    return inserted
  end
  local current = e5_automation_point_row(envelope, point_index) or {}
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, current.time_seconds or 0)
  local value = e5_routing_clamp_number(request.params.value, 0, 4, current.value or 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or current.shape or 0))
  local tension = e5_routing_finite_number(request.params.tension, current.tension or 0)
  local selected = request.params.selected == true
  local ok = call_reaper("SetEnvelopePoint", envelope, point_index, time_seconds, value, shape, tension, selected, false)
  call_reaper("Envelope_SortPoints", envelope)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected SetEnvelopePoint.", {
      envelope_ref = envelope_ref,
      point_index = point_index,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    point_index = point_index,
    time_seconds = time_seconds,
    value = value,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function insert_envelope_points_batch(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  if not is_json_array(request.params.points) then
    return e5_routing_error("REQUEST_INVALID", "E5 automation insert_envelope_points_batch requires points array.", {})
  end
  local limit = math.min(#request.params.points, 32)
  local first_time = nil
  local last_time = nil
  for index = 1, limit do
    local point = is_object(request.params.points[index]) and request.params.points[index] or {}
    local time_seconds = e5_routing_finite_number(point.time_seconds, index - 1)
    local value = e5_routing_clamp_number(point.value, 0, 4, 1)
    local shape = math.max(0, math.floor(tonumber(point.shape) or 0))
    local tension = e5_routing_finite_number(point.tension, 0)
    call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, point.selected == true, true)
    first_time = first_time or time_seconds
    last_time = time_seconds
  end
  call_reaper("Envelope_SortPoints", envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    inserted_count = limit,
    first_time_seconds = first_time or 0,
    last_time_seconds = last_time or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, points)
  if not is_json_array(points) then
    return e5_routing_error("REQUEST_INVALID", "E5 automation point insertion requires a points array.", {})
  end
  local limit = math.min(#points, 128)
  if limit < 1 then
    return e5_routing_error("REQUEST_INVALID", "E5 automation point insertion requires at least one point.", {})
  end
  local before = e5_automation_envelope_point_count(envelope)
  local first_time = nil
  local last_time = nil
  local min_value = nil
  local max_value = nil
  for index = 1, limit do
    local point = is_object(points[index]) and points[index] or {}
    local time_seconds = e5_routing_finite_number(point.time_seconds, index - 1)
    local value = e5_routing_clamp_number(point.value, 0, 4, 1)
    local shape = math.max(0, math.floor(tonumber(point.shape) or 0))
    local tension = e5_routing_finite_number(point.tension, 0)
    local ok = call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, point.selected == true, true)
    if not ok then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePoint in point batch.", {
        envelope_ref = envelope_ref,
        point_index = index - 1,
      })
    end
    first_time = first_time or time_seconds
    last_time = time_seconds
    min_value = min_value and math.min(min_value, value) or value
    max_value = max_value and math.max(max_value, value) or value
  end
  call_reaper("Envelope_SortPoints", envelope)
  local after = e5_automation_envelope_point_count(envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    requested_count = #points,
    inserted_count = math.max(0, after - before),
    processed_count = limit,
    first_time_seconds = first_time or 0,
    last_time_seconds = last_time or 0,
    min_value = min_value or 0,
    max_value = max_value or 0,
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
      message = "FX parameter envelope is not available; resolve/create the envelope before inserting points.",
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
  local summary, failure, artifacts, jobs, refs = e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, points)
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
  if not e5_routing_set_send_value(source_track, send_index, "I_AUTOMODE", mode) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected send automation mode update.", {})
  end
  local readback = e5_routing_read_send_value(source_track, 0, send_index, "I_AUTOMODE", mode)
  return e5_routing_write_summary(request, {
    send_ref = e5_routing_send_ref(source_track, send_index),
    mode = e5_automation_mode_label(readback),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_send_object_ref(source_track, send_index))
end

local function create_automation_item(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local position = e5_routing_finite_number(request.params.position_seconds, 0)
  local length = math.max(0.001, e5_routing_finite_number(request.params.length_seconds, 1))
  local pool_id = -1
  if request.params.pool_mode == "reuse_pool" then
    pool_id = math.floor(tonumber(request.params.pool_id) or 0)
  end
  local ok, item_index = call_reaper("InsertAutomationItem", envelope, pool_id, position, length)
  item_index = ok and math.floor(first_number(item_index) or -1) or -1
  if item_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertAutomationItem.", {
      envelope_ref = envelope_ref,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    automation_item_index = item_index,
    pool_id = pool_id,
    position_seconds = position,
    length_seconds = length,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_automation_item_bounds(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local item_index = math.max(0, math.floor(tonumber(request.params.automation_item_index) or 0))
  if item_index >= e5_automation_item_count(envelope) then
    local created = create_automation_item({
      params = {
        position_seconds = request.params.position_seconds or 0,
        length_seconds = request.params.length_seconds or 1,
        pool_mode = "new_empty",
      },
      refs = request.refs,
      pack = request.pack,
    })
    if is_object(created) and created.code then
      return created
    end
  end
  if request.params.position_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_POSITION", e5_routing_finite_number(request.params.position_seconds, 0), true)
  end
  if request.params.length_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_LENGTH", math.max(0.001, e5_routing_finite_number(request.params.length_seconds, 1)), true)
  end
  if request.params.start_offset_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_STARTOFFS", e5_routing_finite_number(request.params.start_offset_seconds, 0), true)
  end
  if request.params.playrate ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_PLAYRATE", math.max(0.001, e5_routing_finite_number(request.params.playrate, 1)), true)
  end
  local position = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_POSITION", 0, false))
  local length = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_LENGTH", 0, false))
  local start_offset = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_STARTOFFS", 0, false))
  local playrate = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_PLAYRATE", 0, false))
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    automation_item_index = item_index,
    position_seconds = first_number(position) or 0,
    length_seconds = first_number(length) or 0,
    start_offset_seconds = first_number(start_offset) or 0,
    playrate = first_number(playrate) or 1,
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
