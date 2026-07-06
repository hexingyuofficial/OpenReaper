-- Extracted D11 handler: project marker/region rename and removal mutations.

local function d11_project_marker_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d11_project_marker_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d11_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d11_marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return {
    kind = prefix,
    ref = prefix .. ":index:" .. tostring(index_number),
    identity = {
      scheme = "index",
      value = tostring(index_number),
    },
  }
end

local function d11_marker_ref_from_request(request, kind)
  local expected_kind = kind == "region" and "region" or "marker"
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == expected_kind then
        local identity = is_object(ref.identity) and ref.identity or {}
        if identity.scheme == "index" then
          return tonumber(identity.value)
        end
        local from_ref = tostring(ref.ref or ""):match("^" .. expected_kind .. ":index:(%d+)$")
        if from_ref then
          return tonumber(from_ref)
        end
      end
    end
  end
  local params_ref = bounded_string(request.params[expected_kind .. "_ref"], 120)
  local from_param = params_ref:match("^" .. expected_kind .. ":index:(%d+)$")
  if from_param then
    return tonumber(from_param)
  end
  return nil
end

local function d11_find_marker(project, kind, index_number)
  if type(index_number) ~= "number" or index_number < 0 then
    return nil
  end
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = ok_count and ((first_number(marker_count) or 0) + (first_number(region_count) or 0)) or 0
  for enum_index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, candidate_index, color = call_reaper("EnumProjectMarkers3", project, enum_index)
    if ok_enum and retval then
      local candidate_kind = is_region and "region" or "marker"
      if candidate_kind == kind and tonumber(candidate_index) == index_number then
        return {
          enum_index = enum_index,
          kind = kind,
          index = index_number,
          is_region = is_region == true,
          position_seconds = first_number(pos) or 0,
          end_seconds = first_number(region_end) or first_number(pos) or 0,
          name = bounded_string(name or "", 160),
          color = type(color) == "number" and color or 0,
        }
      end
    end
  end
  return nil
end

local function d11_marker_summary(request, marker, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.project_ref = "project:current"
  fields.ref = marker and (marker.kind .. ":index:" .. tostring(marker.index)) or fields.ref
  fields.kind = marker and marker.kind or fields.kind
  fields.index = marker and marker.index or fields.index
  fields.position_seconds = marker and marker.position_seconds or fields.position_seconds
  if marker and marker.kind == "region" then
    fields.end_seconds = marker.end_seconds
  end
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d11_marker_refs(kind, index_number)
  return json_array({
    d11_project_ref(),
    d11_marker_ref(kind, index_number),
  })
end

local function d11_project_rename_marker_region(request, kind)
  local project = d11_project_marker_current_project()
  local index_number = d11_marker_ref_from_request(request, kind)
  if not index_number then
    return d11_project_marker_error("REF_INVALID", "Marker/region rename requires an index ref.", {
      kind = kind,
    })
  end
  local marker = d11_find_marker(project, kind, index_number)
  if not marker then
    local code = kind == "region" and "REGION_NOT_FOUND" or "MARKER_NOT_FOUND"
    return d11_project_marker_error(code, "Marker/region ref could not be resolved.", {
      ref = kind .. ":index:" .. tostring(index_number),
    })
  end
  local name = bounded_string(request.params.name, 160)
  local ok = call_reaper(
    "SetProjectMarkerByIndex2",
    project,
    marker.enum_index,
    marker.is_region,
    marker.position_seconds,
    marker.end_seconds,
    marker.index,
    name,
    marker.color,
    0
  )
  if not ok then
    return d11_project_marker_error("COMMAND_FAILED", "REAPER rejected project marker/region rename.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  local readback = d11_find_marker(project, kind, index_number)
  if not readback or readback.name ~= name then
    return d11_project_marker_error("VERIFY_FAILED", "Project marker/region rename did not read back.", {
      ref = kind .. ":index:" .. tostring(index_number),
      requested_name = name,
      readback_name = readback and readback.name or JSON_NULL,
    }, false)
  end
  return d11_marker_summary(request, readback, {
    name = readback.name,
    updated = true,
  }), nil, json_array({}), json_array({}), d11_marker_refs(kind, index_number)
end

local function d11_project_delete_marker_region(request, kind)
  local project = d11_project_marker_current_project()
  local index_number = d11_marker_ref_from_request(request, kind)
  if not index_number then
    return d11_project_marker_error("REF_INVALID", "Marker/region delete requires an index ref.", {
      kind = kind,
    })
  end
  local marker = d11_find_marker(project, kind, index_number)
  if not marker then
    local code = kind == "region" and "REGION_NOT_FOUND" or "MARKER_NOT_FOUND"
    return d11_project_marker_error(code, "Marker/region ref could not be resolved.", {
      ref = kind .. ":index:" .. tostring(index_number),
    })
  end
  local ok = call_reaper("DeleteProjectMarker", project, index_number, kind == "region")
  if not ok then
    return d11_project_marker_error("COMMAND_FAILED", "REAPER rejected project marker/region delete.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  local readback = d11_find_marker(project, kind, index_number)
  if readback then
    return d11_project_marker_error("VERIFY_FAILED", "Project marker/region delete did not read back as removed.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  return d11_marker_summary(request, marker, {
    deleted = true,
  }), nil, json_array({}), json_array({}), d11_marker_refs(kind, index_number)
end

local function d11_project_rename_marker(request)
  return d11_project_rename_marker_region(request, "marker")
end

local function d11_project_rename_region(request)
  return d11_project_rename_marker_region(request, "region")
end

local function d11_project_delete_marker(request)
  return d11_project_delete_marker_region(request, "marker")
end

local function d11_project_delete_region(request)
  return d11_project_delete_marker_region(request, "region")
end

local function d11_project_remove_marker(request)
  return d11_project_delete_marker_region(request, "marker")
end

local function d11_project_remove_region(request)
  return d11_project_delete_marker_region(request, "region")
end
