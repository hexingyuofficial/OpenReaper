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

local function safe_write_create_region(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "Safe-Write-A region end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
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
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("region", index_number, request.params.name))
end
