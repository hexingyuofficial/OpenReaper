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
  local ok, division = call_reaper("GetSetProjectGrid", project, false, 0)
  if ok and type(division) == "number" then
    return division
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
  local ok = call_reaper("GetSetProjectGrid", project, true, division)
  if not ok then
    return d20_project_grid_error("COMMAND_FAILED", "REAPER rejected project grid update.", {
      division = division_label,
      division_qn = division,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d20_project_grid_read(project)
  local updated = type(readback) == "number" and math.abs(readback - division) < 0.000001
  if not updated then
    return d20_project_grid_error("READBACK_MISMATCH", "Project grid division did not read back the requested value.", {
      requested_division = division_label,
      requested_division_qn = division,
      readback_division_qn = readback,
    }, false)
  end
  return d20_project_grid_summary(request, {
    division = division_label,
    division_qn = readback,
    swing = request.params.swing,
    updated = true,
  }), nil, json_array({}), json_array({}), d20_project_grid_refs()
end
