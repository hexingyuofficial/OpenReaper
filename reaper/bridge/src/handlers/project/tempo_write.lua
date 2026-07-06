-- Extracted D6 handler: project tempo/BPM writes.

local function d6_tempo_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d6_tempo_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d6_tempo_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d6_tempo_bounded_bpm(value)
  if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
    return nil
  end
  if value < 20 or value > 400 then
    return nil
  end
  return value
end

local function d6_tempo_time_sig_num(value)
  local number = math.floor(tonumber(value) or 4)
  if number < 1 then
    return 4
  end
  if number > 32 then
    return 32
  end
  return number
end

local function d6_tempo_time_sig_denom(value)
  local number = math.floor(tonumber(value) or 4)
  if number == 1 or number == 2 or number == 4 or number == 8 or number == 16 or number == 32 then
    return number
  end
  return 4
end

local function d6_tempo_effective_at(project, position_seconds)
  local ok, timesig_num, timesig_denom, bpm = call_reaper("TimeMap_GetTimeSigAtTime", project, position_seconds)
  return {
    bpm = ok and first_number(bpm) or 0,
    time_sig_num = ok and math.floor(first_number(timesig_num) or 0) or 0,
    time_sig_denom = ok and math.floor(first_number(timesig_denom) or 0) or 0,
  }
end

local function d6_tempo_current_bpm(project)
  local ok, bpm = call_reaper("Master_GetTempo")
  if ok and type(bpm) == "number" then
    return bpm
  end
  return d6_tempo_effective_at(project, 0).bpm
end

local function d6_tempo_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.project_ref = "project:current"
  fields.truncated = false
  return fields
end

local function d6_tempo_refs()
  return json_array({ d6_tempo_project_ref() })
end

local function d6_tempo_set_base(request)
  local project = d6_tempo_current_project()
  local bpm = d6_tempo_bounded_bpm(request.params.bpm)
  if not bpm then
    return d6_tempo_error("BPM_INVALID", "Project tempo writes require bpm between 20 and 400.", {
      bpm = request.params.bpm,
    })
  end
  local ok = call_reaper("SetCurrentBPM", project, bpm, false)
  if not ok then
    return d6_tempo_error("COMMAND_FAILED", "REAPER rejected SetCurrentBPM.", {
      bpm = bpm,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback_bpm = d6_tempo_current_bpm(project)
  local updated = math.abs(readback_bpm - bpm) < 0.01
  if not updated then
    return d6_tempo_error("READBACK_MISMATCH", "Project tempo write did not read back the requested BPM.", {
      requested_bpm = bpm,
      readback_bpm = readback_bpm,
    }, false)
  end
  return d6_tempo_summary(request, {
    bpm = readback_bpm,
    requested_bpm = bpm,
    updated = updated,
    preserve_tempo_markers = request.params.preserve_tempo_markers == true,
  }), nil, json_array({}), json_array({}), d6_tempo_refs()
end

local function d6_tempo_marker_index_at(project, position_seconds)
  local ok_count, count = call_reaper("CountTempoTimeSigMarkers", project)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_marker, retval, timepos = call_reaper("GetTempoTimeSigMarker", project, index)
    if ok_marker and retval and math.abs((first_number(timepos) or 0) - position_seconds) < 0.000001 then
      return index
    end
  end
  return -1
end

local function d6_tempo_marker_readback(project, position_seconds)
  local marker_index = d6_tempo_marker_index_at(project, position_seconds)
  if marker_index < 0 then
    return nil
  end
  local ok_marker, retval, timepos, measurepos, beatpos, bpm, timesig_num, timesig_denom, lineartempo =
    call_reaper("GetTempoTimeSigMarker", project, marker_index)
  if not ok_marker or not retval then
    return nil
  end
  return {
    marker_index = marker_index,
    position_seconds = first_number(timepos) or position_seconds,
    bpm = first_number(bpm) or 0,
    time_sig_num = math.floor(first_number(timesig_num) or 0),
    time_sig_denom = math.floor(first_number(timesig_denom) or 0),
    linear_tempo = lineartempo == true,
  }
end

local function d6_tempo_set_marker(request)
  local project = d6_tempo_current_project()
  local bpm = d6_tempo_bounded_bpm(request.params.bpm)
  if not bpm then
    return d6_tempo_error("BPM_INVALID", "Tempo marker writes require bpm between 20 and 400.", {
      bpm = request.params.bpm,
    })
  end
  local position_seconds = tonumber(request.params.position_seconds) or 0
  if position_seconds < 0 then
    return d6_tempo_error("POSITION_INVALID", "Tempo marker position_seconds must be non-negative.", {
      position_seconds = request.params.position_seconds,
    })
  end
  local numerator = d6_tempo_time_sig_num(request.params.time_signature_numerator)
  local denominator = d6_tempo_time_sig_denom(request.params.time_signature_denominator)
  local linear_tempo = request.params.linear_tempo == true
  local marker_index = d6_tempo_marker_index_at(project, position_seconds)
  local ok, retval
  if marker_index < 0 then
    ok, retval = call_reaper(
      "AddTempoTimeSigMarker",
      project,
      position_seconds,
      bpm,
      numerator,
      denominator,
      linear_tempo
    )
  else
    ok, retval = call_reaper(
      "SetTempoTimeSigMarker",
      project,
      marker_index,
      position_seconds,
      -1,
      -1,
      bpm,
      numerator,
      denominator,
      linear_tempo
    )
  end
  if not ok or retval == false then
    return d6_tempo_error("COMMAND_FAILED", "REAPER rejected tempo marker update.", {
      position_seconds = position_seconds,
      bpm = bpm,
      marker_index = marker_index,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d6_tempo_marker_readback(project, position_seconds)
  local updated = readback and math.abs(readback.bpm - bpm) < 0.01
  if not updated then
    return d6_tempo_error("READBACK_MISMATCH", "Tempo marker write did not read back the requested BPM.", {
      position_seconds = position_seconds,
      requested_bpm = bpm,
      readback_bpm = readback and readback.bpm or JSON_NULL,
      time_sig_num = readback and readback.time_sig_num or JSON_NULL,
      time_sig_denom = readback and readback.time_sig_denom or JSON_NULL,
    }, false)
  end
  return d6_tempo_summary(request, {
    position_seconds = position_seconds,
    bpm = readback.bpm,
    requested_bpm = bpm,
    time_sig_num = readback.time_sig_num,
    time_sig_denom = readback.time_sig_denom,
    marker_index = readback.marker_index,
    linear_tempo = readback.linear_tempo,
    updated = updated,
  }), nil, json_array({}), json_array({}), d6_tempo_refs()
end

local function d6_project_set_tempo(request)
  return d6_tempo_set_base(request)
end

local function d6_project_set_bpm(request)
  return d6_tempo_set_base(request)
end

local function d6_project_set_tempo_marker(request)
  return d6_tempo_set_marker(request)
end
