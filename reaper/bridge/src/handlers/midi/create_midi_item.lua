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
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
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
  local ok_item, item = call_reaper("CreateNewMIDIItemInProj", track, start_seconds, end_seconds, false)
  if not ok_item or not item then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A MIDI item.", {}, false)
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return handler_error("TAKE_NOT_FOUND", "Created MIDI item did not expose an active take.", {})
  end
  local summary = midi_take_summary(take)
  summary.item_ref = item_ref_string(item)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(item_object_ref(item), take_object_ref(take))
end
