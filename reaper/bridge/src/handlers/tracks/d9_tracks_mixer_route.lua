-- Extracted D9 tracks mixer/basic control handlers.

local function d9_tracks_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d9_tracks_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d9_tracks_append_refs(target, source)
  if not is_json_array(source) then
    return target
  end
  for index = 1, #source do
    target[#target + 1] = source[index]
  end
  return target
end

local function d9_tracks_limit(request, default_limit, hard_limit)
  local value = tonumber(request.params and request.params.limit)
  if not value or value < 1 then
    value = default_limit
  end
  value = math.floor(value)
  if value > hard_limit then
    value = hard_limit
  end
  return value
end

local function d9_tracks_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = request.pack.risk == "write" and "required" or "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function d9_tracks_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d9_tracks_index(track)
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

local function d9_tracks_ref_string(track)
  local guid = d9_tracks_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d9_tracks_index(track))
end

local function d9_tracks_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d9_tracks_object_ref(track)
  local ref = d9_tracks_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or d9_tracks_index(track)),
    },
    display = {
      name = d9_tracks_name(track),
      index = d9_tracks_index(track),
    },
  }
end

local function d9_tracks_find_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d9_tracks_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d9_tracks_resolve_token(token)
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
    return d9_tracks_find_by_guid(guid)
  end
  return nil
end

local function d9_tracks_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d9_tracks_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d9_tracks_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d9_tracks_resolve_token("guid:" .. tostring(identity.value))
  end
  return d9_tracks_resolve_token(ref.ref)
end

local function d9_tracks_from_request_refs(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = d9_tracks_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function d9_tracks_primary_from_request_refs(request)
  local tracks = d9_tracks_from_request_refs(request)
  if tracks[1] then
    return tracks[1]
  end
  return nil
end

local function d9_tracks_solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function d9_tracks_numeric(track, key, fallback)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, key)
  return ok and first_number(value) or fallback
end

local function d9_tracks_mixer_summary(track)
  return {
    track_ref = d9_tracks_ref_string(track),
    index = d9_tracks_index(track),
    name = d9_tracks_name(track),
    selected = d9_tracks_numeric(track, "I_SELECTED", 0) == 1,
    muted = d9_tracks_numeric(track, "B_MUTE", 0) == 1,
    solo_mode = d9_tracks_solo_label(d9_tracks_numeric(track, "I_SOLO", 0)),
    record_armed = d9_tracks_numeric(track, "I_RECARM", 0) == 1,
    volume = d9_tracks_numeric(track, "D_VOL", 1),
    pan = d9_tracks_numeric(track, "D_PAN", 0),
    width = d9_tracks_numeric(track, "D_WIDTH", 1),
    folder_depth = math.floor(d9_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0),
  }
end

local function d9_tracks_all(limit)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local tracks = {}
  local max_index = math.min(total, limit)
  for index = 0, max_index - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = track
    end
  end
  return tracks, total, total > limit
end

local function d9_tracks_selected(limit)
  local ok_count, count = call_reaper("CountSelectedTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local tracks = {}
  local max_index = math.min(total, limit)
  for index = 0, max_index - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = track
    end
  end
  return tracks, total, total > limit
end

local function list_tracks(request)
  local limit = d9_tracks_limit(request, 64, 256)
  local tracks, total, truncated = d9_tracks_all(limit)
  local rows = json_array({})
  local refs = json_array({})
  local selected_count = 0
  for index = 1, #tracks do
    local summary = d9_tracks_mixer_summary(tracks[index])
    rows[#rows + 1] = {
      track_ref = summary.track_ref,
      index = summary.index,
      name = summary.name,
      selected = summary.selected,
      record_armed = summary.record_armed,
      muted = summary.muted,
      solo_mode = summary.solo_mode,
    }
    if summary.selected then
      selected_count = selected_count + 1
    end
    refs[#refs + 1] = d9_tracks_object_ref(tracks[index])
  end
  return d9_tracks_summary(request, {
    tracks = rows,
    track_count = total,
    selected_count = selected_count,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function read_mixer_controls(request)
  local limit = d9_tracks_limit(request, 32, 128)
  local tracks = d9_tracks_from_request_refs(request)
  local total = #tracks
  local truncated = false
  if total == 0 and request.params and request.params.include_selected == true then
    tracks, total, truncated = d9_tracks_selected(limit)
  elseif total == 0 then
    tracks, total, truncated = d9_tracks_all(limit)
  elseif total > limit then
    truncated = true
    local bounded = {}
    for index = 1, limit do
      bounded[index] = tracks[index]
    end
    tracks = bounded
  end
  local rows = json_array({})
  local refs = json_array({})
  for index = 1, #tracks do
    rows[#rows + 1] = d9_tracks_mixer_summary(tracks[index])
    refs[#refs + 1] = d9_tracks_object_ref(tracks[index])
  end
  return d9_tracks_summary(request, {
    tracks = rows,
    track_count = total,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function read_folder_structure(request)
  local limit = d9_tracks_limit(request, 64, 256)
  local tracks, total, truncated = d9_tracks_all(limit)
  local rows = json_array({})
  local folders = json_array({})
  local refs = json_array({})
  local depth = 0
  local parent_stack = {}
  for index = 1, #tracks do
    local track = tracks[index]
    local summary = d9_tracks_mixer_summary(track)
    local parent_ref = depth > 0 and parent_stack[depth] or JSON_NULL
    rows[#rows + 1] = {
      track_ref = summary.track_ref,
      index = summary.index,
      name = summary.name,
      depth = depth,
      folder_depth = summary.folder_depth,
      parent_ref = parent_ref,
    }
    refs[#refs + 1] = d9_tracks_object_ref(track)
    if summary.folder_depth > 0 then
      parent_stack[depth + 1] = summary.track_ref
      folders[#folders + 1] = {
        folder_ref = summary.track_ref,
        index = summary.index,
        name = summary.name,
        opens_depth = summary.folder_depth,
      }
      depth = depth + summary.folder_depth
    elseif summary.folder_depth < 0 then
      depth = math.max(0, depth + summary.folder_depth)
      for stack_index = depth + 1, #parent_stack do
        parent_stack[stack_index] = nil
      end
    end
  end
  return d9_tracks_summary(request, {
    folders = folders,
    tracks = rows,
    track_count = total,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function d9_tracks_write_update(request, updater, readback_key, requested_value, tolerance)
  local track = d9_tracks_primary_from_request_refs(request)
  if not track then
    return d9_tracks_error("TRACK_NOT_FOUND", "D9 tracks mixer write requires a resolvable track ref.")
  end
  local ok, failure = updater(track)
  if not ok then
    return nil, failure
  end
  call_reaper("TrackList_AdjustWindows", false)
  local summary = d9_tracks_mixer_summary(track)
  local actual = summary[readback_key]
  local matched = actual == requested_value
  if type(actual) == "number" and type(requested_value) == "number" then
    matched = math.abs(actual - requested_value) <= (tolerance or 0.000001)
  end
  if not matched then
    return d9_tracks_error("VERIFY_FAILED", "D9 tracks mixer write did not read back the requested value.", {
      field = readback_key,
      requested = requested_value,
      readback = actual,
    }, false)
  end
  summary.requested_value = requested_value
  summary.updated = true
  return d9_tracks_summary(request, summary), nil, json_array({}), json_array({}), d9_tracks_refs(d9_tracks_object_ref(track))
end

local function set_record_arm(request)
  if type(request.params and request.params.armed) ~= "boolean" then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_record_arm requires boolean armed.")
  end
  local armed = request.params.armed == true
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "I_RECARM", armed and 1 or 0)
    return true
  end, "record_armed", armed)
end

local function set_volume(request)
  local volume = tonumber(request.params and request.params.volume)
  if not volume or volume < 0 or volume > 4 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_volume requires volume between 0 and 4.", {
      volume = request.params and request.params.volume,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_VOL", volume)
    return true
  end, "volume", volume, 0.000001)
end

local function set_pan(request)
  local pan = tonumber(request.params and request.params.pan)
  if not pan or pan < -1 or pan > 1 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_pan requires pan between -1 and 1.", {
      pan = request.params and request.params.pan,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_PAN", pan)
    return true
  end, "pan", pan, 0.000001)
end

local function set_width(request)
  local width = tonumber(request.params and request.params.width)
  if not width or width < 0 or width > 2 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_width requires width between 0 and 2.", {
      width = request.params and request.params.width,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_WIDTH", width)
    return true
  end, "width", width, 0.000001)
end
