-- Extracted D12 handler: transport safe controls.

local function d12_transport_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d12_transport_refs()
  return json_array({})
end

local function d12_transport_current_project()
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  if ok_project then
    return project or 0
  end
  return 0
end

local function d12_transport_has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function d12_transport_play_state_value()
  local ok_play_state, play_state = call_reaper("GetPlayState")
  return ok_play_state and first_number(play_state) or 0
end

local function d12_transport_is_recording()
  return d12_transport_has_flag(d12_transport_play_state_value(), 4)
end

local D12_TRANSPORT_RECORD_MODE_VALUES = {
  normal = 0,
  time_selection_auto_punch = 1,
  selected_items_auto_punch = 2,
}

local D12_TRANSPORT_RECORD_MODE_NAMES = {
  [0] = "normal",
  [1] = "time_selection_auto_punch",
  [2] = "selected_items_auto_punch",
}

local d12_transport_bounded_number

local function d12_transport_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d12_transport_state_summary(request)
  return d12_transport_summary(request, OPENREAPER_HANDLER_EXPORTS.read_transport_state({}))
end

local function d12_transport_playback_rate()
  local ok_rate, rate = call_reaper("Master_GetPlayRateAtTime", 0, 0)
  local number = ok_rate and first_number(rate) or nil
  if number and number > 0 then
    return number
  end
  return 1
end

local function d12_transport_record_mode_value()
  local ok, value = call_reaper("GetSetProjectInfo", 0, "RECMODE", 0, false)
  local number = ok and first_number(value) or 0
  return math.max(0, math.floor(number or 0))
end

local function d12_transport_record_mode_name()
  return D12_TRANSPORT_RECORD_MODE_NAMES[d12_transport_record_mode_value()] or "normal"
end

local function d12_transport_set_record_mode_value(mode)
  local value = D12_TRANSPORT_RECORD_MODE_VALUES[mode]
  if value == nil then
    return nil, d12_transport_error("PARAMS_INVALID", "Record mode must be normal, time_selection_auto_punch, or selected_items_auto_punch.", {
      mode = mode,
    })
  end
  local ok = call_reaper("GetSetProjectInfo", 0, "RECMODE", value, true)
  if not ok then
    return nil, d12_transport_error("COMMAND_FAILED", "REAPER rejected record mode update.", {
      mode = mode,
    }, false)
  end
  local readback = d12_transport_record_mode_name()
  if readback ~= mode then
    return nil, d12_transport_error("READBACK_MISMATCH", "Record mode did not read back the requested value.", {
      expected_mode = mode,
      actual_mode = readback,
    }, false)
  end
  return true, nil
end

local function d12_transport_armed_track_count()
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local armed = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      local ok_arm, value = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
      if ok_arm and first_number(value) == 1 then
        armed = armed + 1
      end
    end
  end
  return armed
end

local function d12_transport_recording_guard(request)
  if d12_transport_is_recording() then
    return d12_transport_error("RECORDING_ACTIVE", "Transport playback controls do not stop or modify active recording.", {
      capability = request.pack.capability,
    })
  end
  return nil
end

local function d12_transport_verify_state(request, expected_state)
  local state = d12_transport_state_summary(request)
  if state.play_state ~= expected_state then
    return d12_transport_error("READBACK_MISMATCH", "Transport state did not read back the expected value.", {
      expected_play_state = expected_state,
      actual_play_state = state.play_state,
    }, false)
  end
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_play(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local project = d12_transport_current_project()
  local ok = call_reaper("OnPlayButtonEx", project)
  if not ok then
    ok = call_reaper("CSurf_OnPlay")
  end
  if not ok then
    ok = call_reaper("OnPlayButton")
  end
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected play command.", {}, false)
  end
  return d12_transport_verify_state(request, "playing")
end

local function d12_transport_pause(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local project = d12_transport_current_project()
  local ok = call_reaper("OnPauseButtonEx", project)
  if not ok then
    ok = call_reaper("CSurf_OnPause")
  end
  if not ok then
    ok = call_reaper("OnPauseButton")
  end
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected pause command.", {}, false)
  end
  return d12_transport_verify_state(request, "paused")
end

local function d12_transport_stop_playback(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local project = d12_transport_current_project()
  local ok = call_reaper("OnStopButtonEx", project)
  if not ok then
    ok = call_reaper("OnStopButton")
  end
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnStopButton.", {}, false)
  end
  return d12_transport_verify_state(request, "stopped")
end

local function d12_transport_set_playback_rate(request)
  local rate = d12_transport_bounded_number(request.params.playback_rate)
  if not rate or rate < 0.25 or rate > 4 then
    return d12_transport_error("PARAMS_INVALID", "Playback rate must be between 0.25 and 4.", {
      playback_rate = request.params.playback_rate,
    })
  end
  local preserve_pitch = request.params.preserve_pitch == true
  local ok_set = call_reaper("SetPlayRate", rate, preserve_pitch)
  if not ok_set then
    ok_set = call_reaper("CSurf_OnPlayRateChange", rate)
  end
  if not ok_set then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected playback rate update.", {
      playback_rate = rate,
    }, false)
  end
  local readback = d12_transport_playback_rate()
  if math.abs(readback - rate) > 0.0001 then
    return d12_transport_error("READBACK_MISMATCH", "Playback rate did not read back the requested value.", {
      requested_playback_rate = rate,
      actual_playback_rate = readback,
    }, false)
  end
  return d12_transport_summary(request, {
    playback_rate = readback,
    preserve_pitch = preserve_pitch,
  }), nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_start_recording(request)
  if request.params.require_armed_track == true and d12_transport_armed_track_count() < 1 then
    return d12_transport_error("ARMED_TRACK_REQUIRED", "Starting recording requires at least one armed track.", {})
  end
  if request.params.respect_punch_range == true then
    local range = d12_transport_state_summary(request).time_selection or {}
    if range.active ~= true then
      return d12_transport_error("PUNCH_RANGE_REQUIRED", "Starting guarded punch recording requires an active time selection.", {})
    end
  end
  local ok = call_reaper("CSurf_OnRecord")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected CSurf_OnRecord.", {}, false)
  end
  local state = d12_transport_state_summary(request)
  if state.play_state ~= "recording" then
    return d12_transport_error("READBACK_MISMATCH", "Transport did not enter recording.", {
      actual_play_state = state.play_state,
    }, false)
  end
  state.record_state = "recording"
  state.armed_track_count = d12_transport_armed_track_count()
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_stop_recording(request)
  local policy = request.params.recorded_media_policy or "keep"
  if policy ~= "keep" then
    return d12_transport_error("POLICY_UNSUPPORTED", "Stopping recording only supports recorded_media_policy keep in this bridge window.", {
      recorded_media_policy = policy,
    })
  end
  local ok = call_reaper("CSurf_OnStop")
  if not ok then
    ok = call_reaper("OnStopButton")
  end
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected stop recording.", {}, false)
  end
  local state = d12_transport_state_summary(request)
  if state.play_state == "recording" then
    return d12_transport_error("READBACK_MISMATCH", "Transport is still recording after stop.", {
      actual_play_state = state.play_state,
    }, false)
  end
  state.record_state = "stopped"
  state.recorded_media_policy = policy
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_set_record_mode(request)
  local ok, err = d12_transport_set_record_mode_value(request.params.mode)
  if not ok then
    return nil, err
  end
  return d12_transport_summary(request, {
    mode = d12_transport_record_mode_name(),
  }), nil, json_array({}), json_array({}), d12_transport_refs()
end

d12_transport_bounded_number = function(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d12_transport_set_punch_record_range(request)
  local start_seconds = d12_transport_bounded_number(request.params.start_seconds)
  local end_seconds = d12_transport_bounded_number(request.params.end_seconds)
  if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds < start_seconds then
    return d12_transport_error("PARAMS_INVALID", "Punch range requires non-negative start_seconds and end_seconds >= start_seconds.", {
      start_seconds = request.params.start_seconds,
      end_seconds = request.params.end_seconds,
    })
  end
  local ok = call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected punch range update.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    }, false)
  end
  local state = d12_transport_state_summary(request)
  local range = state.time_selection or {}
  local matches = type(range.start_seconds) == "number"
    and type(range.end_seconds) == "number"
    and math.abs(range.start_seconds - start_seconds) < 0.000001
    and math.abs(range.end_seconds - end_seconds) < 0.000001
  if not matches then
    return d12_transport_error("READBACK_MISMATCH", "Punch range did not read back the requested bounds.", {
      requested_start_seconds = start_seconds,
      requested_end_seconds = end_seconds,
      readback = range,
    }, false)
  end
  state.punch_range = {
    start_seconds = range.start_seconds,
    end_seconds = range.end_seconds,
    active = range.active == true,
  }
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_schedule_recording(request)
  local start_seconds = d12_transport_bounded_number(request.params.start_seconds)
  local end_seconds = d12_transport_bounded_number(request.params.end_seconds)
  if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds <= start_seconds then
    return d12_transport_error("PARAMS_INVALID", "Scheduled recording requires non-negative start_seconds and end_seconds > start_seconds.", {
      start_seconds = request.params.start_seconds,
      end_seconds = request.params.end_seconds,
    })
  end
  if request.params.require_armed_track == true and d12_transport_armed_track_count() < 1 then
    return d12_transport_error("ARMED_TRACK_REQUIRED", "Scheduled recording requires at least one armed track.", {})
  end
  local ok_mode, mode_error = d12_transport_set_record_mode_value(request.params.mode)
  if not ok_mode then
    return nil, mode_error
  end
  local ok_range = call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  if not ok_range then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected scheduled recording time range.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    }, false)
  end
  local state = d12_transport_state_summary(request)
  state.scheduled_recording = {
    start_seconds = start_seconds,
    end_seconds = end_seconds,
    mode = d12_transport_record_mode_name(),
    require_armed_track = request.params.require_armed_track == true,
    armed_track_count = d12_transport_armed_track_count(),
    prepared = true,
    started = false,
  }
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end
