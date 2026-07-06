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
  local ok = call_reaper("OnPlayButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnPlayButton.", {}, false)
  end
  return d12_transport_verify_state(request, "playing")
end

local function d12_transport_pause(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local ok = call_reaper("OnPauseButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnPauseButton.", {}, false)
  end
  return d12_transport_verify_state(request, "paused")
end

local function d12_transport_stop_playback(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local ok = call_reaper("OnStopButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnStopButton.", {}, false)
  end
  return d12_transport_verify_state(request, "stopped")
end

local function d12_transport_bounded_number(value)
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
