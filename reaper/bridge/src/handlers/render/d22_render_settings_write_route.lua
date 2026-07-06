-- Extracted D22 handler: render settings writes.

local function d22_render_settings_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d22_render_settings_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d22_render_settings_refs()
  return json_array({
    {
      kind = "project",
      ref = "project:current",
      identity = {
        scheme = "current",
        value = "current",
      },
    },
  })
end

local function d22_render_settings_summary(request, fields)
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

local function d22_render_settings_sample_rate(value)
  local number = tonumber(value)
  if not number or number ~= number or number == math.huge or number == -math.huge then
    return nil
  end
  number = math.floor(number + 0.5)
  if number == 44100 or number == 48000 or number == 88200 or number == 96000 then
    return number
  end
  return nil
end

local function set_render_sample_rate(request)
  local sample_rate = d22_render_settings_sample_rate(request.params.sample_rate_hz)
  if not sample_rate then
    return d22_render_settings_error("SAMPLE_RATE_INVALID", "Render sample rate must be one of 44100, 48000, 88200, or 96000 Hz.", {
      sample_rate_hz = request.params.sample_rate_hz,
    })
  end
  local project = d22_render_settings_project()
  local ok_previous, previous_readback = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", 0, false)
  local previous_rate = ok_previous and math.floor(first_number(previous_readback) or 0) or 0
  local ok = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", sample_rate, true)
  if not ok then
    return d22_render_settings_error("COMMAND_FAILED", "REAPER rejected render sample-rate update.", {
      sample_rate_hz = sample_rate,
    }, false)
  end
  local ok_read, readback = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", 0, false)
  local readback_rate = ok_read and math.floor(first_number(readback) or 0) or 0
  local matches = readback_rate == sample_rate
  if request.params.require_readback_match ~= false and not matches then
    return d22_render_settings_error("READBACK_MISMATCH", "Render sample rate did not read back the requested value.", {
      requested_sample_rate_hz = sample_rate,
      readback_sample_rate_hz = readback_rate,
    }, false)
  end
  return d22_render_settings_summary(request, {
    sample_rate_hz = readback_rate,
    previous_sample_rate_hz = previous_rate,
    changed = previous_rate ~= readback_rate,
    readback_matched = matches,
  }), nil, json_array({}), json_array({}), d22_render_settings_refs()
end
