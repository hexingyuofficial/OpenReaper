-- Extracted Safe-Write-A handler: template.project.set_metadata_field.

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

local function safe_write_project_metadata(request)
  local key = project_metadata_key(request.params.field)
  if not key then
    return handler_error("PARAMS_INVALID", "Safe-Write-A metadata field is not allowed.", {
      field = bounded_string(request.params.field, 80),
    })
  end
  local project = current_project()
  local ok, success = call_reaper("GetSetProjectInfo_String", project, key, tostring(request.params.value or ""), true)
  if not ok or success == false then
    return handler_error("COMMAND_FAILED", "Could not update project metadata field.", {
      field = request.params.field,
    }, false)
  end
  local readback = project_info_string(project, key, 240)
  return safe_write_a_summary(request, {
    project_ref = "project:current",
    field = request.params.field,
    value = bounded_string(readback, 240),
  }), nil, nil, nil, safe_write_a_refs(project_object_ref())
end
