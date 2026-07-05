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

local function e5_routing_send_count(track, category)
  local ok, count = call_reaper("GetTrackNumSends", track, category)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
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

local function read_project_routing_graph(request)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local max_tracks = READ_B_MEDIA.bounded_limit(request, request.params.max_tracks, 64, 256)
  local max_edges = READ_B_MEDIA.bounded_limit(request, request.params.max_edges, 128, 512)
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
        channel_count = e5_routing_channel_count(track),
        master_parent_enabled = request.params.include_master_parent == false and JSON_NULL or e5_routing_master_parent_enabled(track),
      }
      refs[#refs + 1] = e5_routing_track_object_ref(track)
      local send_count = e5_routing_send_count(track, 0)
      for send_index = 0, send_count - 1 do
        if #edges >= max_edges then
          truncated = true
          break
        end
        local summary = e5_routing_send_summary(track, send_index, 0)
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
    track_count = #tracks,
    edge_count = #edges,
    tracks = tracks,
    edges = edges,
    truncated = truncated,
  }), nil, nil, nil, refs
end
