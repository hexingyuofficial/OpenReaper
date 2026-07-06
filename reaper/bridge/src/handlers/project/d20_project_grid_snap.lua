-- Extracted D20 handler: project grid writes.

local function d20_project_grid_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d20_project_grid_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d20_project_grid_refs()
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

local function d20_project_grid_summary(request, fields)
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

local function d20_project_grid_division(value)
  if type(value) == "number" and value == value and value > 0 and value <= 64 then
    return value, tostring(value)
  end
  if type(value) ~= "string" then
    return nil, nil
  end
  local numerator, denominator = value:match("^%s*(%d+)%s*/%s*(%d+)%s*$")
  if numerator and denominator then
    local num = tonumber(numerator)
    local den = tonumber(denominator)
    if num and den and num > 0 and den > 0 then
      local division = (num / den) * 4
      if division > 0 and division <= 64 then
        return division, tostring(num) .. "/" .. tostring(den)
      end
    end
  end
  local numeric = tonumber(value)
  if numeric and numeric > 0 and numeric <= 64 then
    return numeric, tostring(numeric)
  end
  return nil, nil
end

local function d20_project_grid_read(project)
  local ok, retval, division, swingmode, swingamt = call_reaper("GetSetProjectGrid", project, false, 0, 0, 0)
  if ok and type(division) == "number" then
    return {
      division = division,
      swingmode = type(swingmode) == "number" and swingmode or 0,
      swing = type(swingamt) == "number" and swingamt or 0,
    }
  end
  return nil
end

local function d20_project_snap_read(project)
  local ok, enabled = call_reaper("GetToggleCommandStateEx", 0, 1157)
  if ok and type(enabled) == "number" then
    return enabled ~= 0
  end
  local ok_info, value = call_reaper("GetSetProjectInfo", project, "PROJECT_GRID_USE", 0, false)
  if ok_info and type(value) == "number" then
    return value ~= 0
  end
  return nil
end

local function d20_project_set_grid(request)
  local project = d20_project_grid_current_project()
  local division, division_label = d20_project_grid_division(request.params.division)
  if not division then
    return d20_project_grid_error("GRID_DIVISION_INVALID", "Project grid division must be a positive numeric value or fraction string.", {
      division = request.params.division,
    })
  end
  local swing = tonumber(request.params.swing) or 0
  if swing < 0 then
    swing = 0
  elseif swing > 1 then
    swing = 1
  end
  local swingmode = swing > 0 and 1 or 0
  local ok = call_reaper("GetSetProjectGrid", project, true, division, swingmode, swing)
  if not ok then
    return d20_project_grid_error("COMMAND_FAILED", "REAPER rejected project grid update.", {
      division = division_label,
      division_qn = division,
      swing = swing,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d20_project_grid_read(project)
  local updated = readback and math.abs(readback.division - division) < 0.000001
  if not updated then
    return d20_project_grid_error("READBACK_MISMATCH", "Project grid division did not read back the requested value.", {
      requested_division = division_label,
      requested_division_qn = division,
      requested_swing = swing,
      readback_division_qn = readback and readback.division or JSON_NULL,
      readback_swingmode = readback and readback.swingmode or JSON_NULL,
      readback_swing = readback and readback.swing or JSON_NULL,
    }, false)
  end
  return d20_project_grid_summary(request, {
    division = division_label,
    division_qn = readback.division,
    swingmode = readback.swingmode,
    swing = readback.swing,
    updated = true,
  }), nil, json_array({}), json_array({}), d20_project_grid_refs()
end

local function d20_project_set_snap(request)
  local project = d20_project_grid_current_project()
  local enabled = request.params.enabled == true
  local ok = call_reaper("GetSetProjectInfo", project, "PROJECT_GRID_USE", enabled and 1 or 0, true)
  if not ok then
    return d20_project_grid_error("COMMAND_FAILED", "REAPER rejected project snap update.", {
      enabled = enabled,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d20_project_snap_read(project)
  if readback == nil then
    return d20_project_grid_error("READBACK_UNAVAILABLE", "Project snap state could not be read back.", {
      enabled = enabled,
    }, false)
  end
  if readback ~= enabled then
    return d20_project_grid_error("READBACK_MISMATCH", "Project snap state did not read back the requested value.", {
      requested_enabled = enabled,
      readback_enabled = readback,
    }, false)
  end
  return d20_project_grid_summary(request, {
    enabled = readback,
    updated = true,
  }), nil, json_array({}), json_array({}), d20_project_grid_refs()
end
