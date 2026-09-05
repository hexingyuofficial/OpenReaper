-- Extracted Safe-Write-A handler: template.project.create_region.

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

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function project_object_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function marker_object_ref(kind, index_number, name)
  local ref_kind = kind == "region" and "region" or "marker"
  return {
    kind = ref_kind,
    ref = ref_kind .. ":index:" .. tostring(index_number or 0),
    identity = {
      scheme = "index",
      value = tostring(index_number or 0),
    },
    display = {
      name = bounded_string(name or "", 160),
    },
  }
end

local function project_metadata_key(field)
  return PROJECT_METADATA_KEYS[field]
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

local function create_region_has_value(value)
  return value ~= nil and value ~= JSON_NULL
end

local function create_region_target_binding(request)
  local params = is_object(request.params) and request.params or {}
  local binding = params.target_binding
  if binding == nil or binding == JSON_NULL then
    return nil, nil
  end
  if not is_object(binding) then
    return nil, {
      code = "TARGET_BINDING_INVALID",
      message = "create_region target_binding must be an object.",
      details = { zero_write = true },
    }
  end
  local allowed = { bind_at = true, domain = true, selector = true, aggregation = true, cardinality = true }
  for key in pairs(binding) do
    if not allowed[key] then
      return nil, {
        code = "TARGET_BINDING_INVALID",
        message = "create_region target_binding contains an unsupported field.",
        details = { field = bounded_string(key, 80), zero_write = true },
      }
    end
  end
  local cardinality = binding.cardinality
  if binding.bind_at ~= "execution" or binding.domain ~= "time_range"
      or binding.selector ~= "time_selection" or binding.aggregation ~= "single"
      or not is_object(cardinality) or cardinality.minimum ~= 1 or cardinality.maximum ~= 1 then
    return nil, {
      code = "TARGET_BINDING_INVALID",
      message = "create_region accepts only execution-time Time Selection binding with single cardinality.",
      details = { zero_write = true },
    }
  end
  for key in pairs(cardinality) do
    if key ~= "minimum" and key ~= "maximum" then
      return nil, {
        code = "TARGET_BINDING_INVALID",
        message = "create_region target_binding cardinality contains an unsupported field.",
        details = { field = bounded_string(key, 80), zero_write = true },
      }
    end
  end
  return binding, nil
end

local function create_region_resolve_bounds(request)
  local params = is_object(request.params) and request.params or {}
  local has_start = create_region_has_value(params.start_seconds)
  local has_end = create_region_has_value(params.end_seconds)
  local binding, binding_failure = create_region_target_binding(request)
  if binding_failure then return nil, nil, nil, binding_failure end
  if has_start ~= has_end then
    return nil, nil, nil, {
      code = "PARAMS_INVALID",
      message = "create_region explicit bounds require both start_seconds and end_seconds.",
      details = { zero_write = true },
    }
  end
  if binding and has_start then
    return nil, nil, nil, {
      code = "TARGET_BINDING_INVALID",
      message = "create_region cannot combine explicit bounds with target_binding.",
      details = { zero_write = true },
    }
  end
  if not binding and not has_start then
    return nil, nil, nil, {
      code = "PARAMS_INVALID",
      message = "create_region requires explicit bounds or target_binding.",
      details = { zero_write = true },
    }
  end
  if binding then
    local ok, start_seconds, end_seconds = call_reaper("GetSet_LoopTimeRange", false, false, 0, 0, false)
    if not ok or type(start_seconds) ~= "number" or type(end_seconds) ~= "number" then
      return nil, nil, nil, {
        code = "TARGET_BINDING_RESOLUTION_FAILED",
        message = "create_region could not read the current Time Selection.",
        details = { zero_write = true },
        recoverable = false,
      }
    end
    if end_seconds <= start_seconds then
      return nil, nil, nil, {
        code = "TARGET_BINDING_TIME_RANGE_UNAVAILABLE",
        message = "create_region requires a non-empty current Time Selection.",
        details = { resolved_count = 0, minimum = 1, maximum = 1, zero_write = true },
      }
    end
    return start_seconds, end_seconds, "time_selection", nil
  end
  local start_seconds = bounded_number(params.start_seconds, 0)
  local end_seconds = bounded_number(params.end_seconds, start_seconds)
  if end_seconds <= start_seconds then
    return nil, nil, nil, {
      code = "PARAMS_INVALID",
      message = "Safe-Write-A region end_seconds must be greater than start_seconds.",
      details = { start_seconds = start_seconds, end_seconds = end_seconds, zero_write = true },
    }
  end
  return start_seconds, end_seconds, "explicit", nil
end

local function safe_write_create_region(request)
  local start_seconds, end_seconds, target_mode, bounds_failure = create_region_resolve_bounds(request)
  if bounds_failure then
    return handler_error(bounds_failure.code, bounds_failure.message, bounds_failure.details, bounds_failure.recoverable)
  end
  local project = current_project()
  local color = native_color_from_hex(request.params.color)
  local ok, index_number = call_reaper(
    "AddProjectMarker2",
    project,
    true,
    start_seconds,
    end_seconds,
    tostring(request.params.name or "OR_SAFE_WRITE_A_REGION"),
    -1,
    color
  )
  if not ok or type(index_number) ~= "number" or index_number < 0 then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A region.", {}, false)
  end
  return safe_write_a_summary(request, {
    region_ref = "region:index:" .. tostring(index_number),
    name = bounded_string(request.params.name, 160),
    start_seconds = start_seconds,
    end_seconds = end_seconds,
    length_seconds = end_seconds - start_seconds,
    target_mode = target_mode,
    target_fingerprint = string.format("time-range-v1|%.9f|%.9f", start_seconds, end_seconds),
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("region", index_number, request.params.name))
end
