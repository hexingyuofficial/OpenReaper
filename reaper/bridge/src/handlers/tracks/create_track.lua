-- Extracted Safe-Write-A handler: template.tracks.create_track.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function track_ref_string(track)
  local guid = track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(track_index(track))
end

local function solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function track_summary(track)
  local index = track_index(track)
  local ok_selected, selected = call_reaper("GetMediaTrackInfo_Value", track, "I_SELECTED")
  local ok_mute, muted = call_reaper("GetMediaTrackInfo_Value", track, "B_MUTE")
  local ok_solo, solo = call_reaper("GetMediaTrackInfo_Value", track, "I_SOLO")
  local ok_arm, armed = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
  local ok_color, color = call_reaper("GetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR")
  return {
    track_ref = track_ref_string(track),
    index = index,
    name = track_name(track),
    selected = ok_selected and first_number(selected) == 1 or false,
    muted = ok_mute and first_number(muted) == 1 or false,
    solo_mode = solo_label(ok_solo and first_number(solo) or 0),
    record_armed = ok_arm and first_number(armed) == 1 or false,
    color = ok_color and type(color) == "number" and color > 0 and tostring(math.floor(color)) or JSON_NULL,
  }
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

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_create_track(request)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local index = is_non_negative_integer(request.params.index) and request.params.index or total
  index = math.max(0, math.min(index, total))
  local ok_insert = call_reaper("InsertTrackAtIndex", index, true)
  if not ok_insert then
    return handler_error("COMMAND_FAILED", "Could not insert Safe-Write-A track.", {
      index = index,
    }, false)
  end
  local ok_track, track = call_reaper("GetTrack", 0, index)
  if not ok_track or not track then
    return handler_error("TRACK_NOT_FOUND", "Inserted Safe-Write-A track could not be resolved.", {
      index = index,
    })
  end
  call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name or "OR_SAFE_WRITE_A_TARGET"), true)
  call_reaper("TrackList_AdjustWindows", false)
  local summary = track_summary(track)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end
