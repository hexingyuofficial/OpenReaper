-- Alpha3.2-C3A read-only current project file-state handlers.

local READ_FILE_STATE_NAME_MAX_BYTES = 256
local READ_FILE_STATE_PATH_HARD_MAX_BYTES = 4096
local READ_FILE_STATE_RESPONSE_OVERHEAD_BYTES = 512

local function read_file_state_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function read_file_state_api_available(name)
  return reaper and type(reaper[name]) == "function"
end

local function read_file_state_bounded_text(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  local limit = math.max(4, math.floor(tonumber(max_bytes) or 4))
  if #text <= limit then
    return text, false
  end
  local cut = limit - 3
  while cut > 0 do
    local next_byte = string.byte(text, cut + 1)
    if next_byte == nil or next_byte < 128 or next_byte >= 192 then
      break
    end
    cut = cut - 1
  end
  return text:sub(1, cut) .. "...", true
end

local function read_file_state_current_project()
  if not read_file_state_api_available("EnumProjects") then
    return read_file_state_error("INTERNAL_ERROR", "REAPER EnumProjects API is required for current project file-state reads.", {
      api = "EnumProjects",
      reason = "api_unavailable",
    })
  end
  local ok, project, project_path = pcall(reaper.EnumProjects, -1, "")
  if not ok then
    return read_file_state_error("INTERNAL_ERROR", "REAPER EnumProjects failed while reading the current project.", {
      api = "EnumProjects",
      reason = "pcall_failed",
    })
  end
  if type(project_path) ~= "string" then
    return read_file_state_error("INTERNAL_ERROR", "REAPER EnumProjects returned an invalid project path.", {
      api = "EnumProjects",
      reason = "invalid_result",
      expected = "string_path",
      actual_type = type(project_path),
    })
  end
  return project or 0, project_path
end

local function read_file_state_project_name(project, project_path)
  local name = nil
  if read_file_state_api_available("GetProjectName") then
    local ok, first, second = pcall(reaper.GetProjectName, project, "")
    if ok then
      name = first_string(first, second)
    end
  end
  if type(name) ~= "string" or name == "" then
    name = project_path:match("([^/\\]+)$") or "current"
  end
  local bounded = read_file_state_bounded_text(name, READ_FILE_STATE_NAME_MAX_BYTES)
  return bounded
end

local function read_current_project_path(request)
  local project, project_path_or_error = read_file_state_current_project()
  if project == nil then
    return nil, project_path_or_error
  end
  local project_path = project_path_or_error
  local budget = safe_budget(request)
  local path_limit = math.min(READ_FILE_STATE_PATH_HARD_MAX_BYTES, math.max(256, budget.max_inline_value_bytes - READ_FILE_STATE_RESPONSE_OVERHEAD_BYTES))
  local bounded_path, path_truncated = read_file_state_bounded_text(project_path, path_limit)
  local has_project_path = project_path ~= ""
  return {
    project_ref = "project:current",
    name = read_file_state_project_name(project, project_path),
    path = bounded_path,
    has_project_path = has_project_path,
    path_state = has_project_path and "saved_project" or "unsaved_project",
    path_truncated = path_truncated,
  }
end

local function read_dirty_state(_request)
  local project, project_path_or_error = read_file_state_current_project()
  if project == nil then
    return nil, project_path_or_error
  end
  if not read_file_state_api_available("IsProjectDirty") then
    return read_file_state_error("INTERNAL_ERROR", "REAPER IsProjectDirty API is required for project dirty-state reads.", {
      api = "IsProjectDirty",
      reason = "api_unavailable",
    })
  end
  local ok, raw_dirty_state = pcall(reaper.IsProjectDirty, project)
  if not ok then
    return read_file_state_error("INTERNAL_ERROR", "REAPER IsProjectDirty failed while reading project dirty state.", {
      api = "IsProjectDirty",
      reason = "pcall_failed",
    })
  end
  if
    type(raw_dirty_state) ~= "number" or
    raw_dirty_state ~= raw_dirty_state or
    raw_dirty_state == math.huge or
    raw_dirty_state == -math.huge or
    raw_dirty_state < 0 or
    raw_dirty_state ~= math.floor(raw_dirty_state)
  then
    return read_file_state_error("INTERNAL_ERROR", "REAPER IsProjectDirty returned an invalid dirty-state value.", {
      api = "IsProjectDirty",
      reason = "invalid_result",
      expected = "non_negative_integer",
      actual_type = type(raw_dirty_state),
      actual_value = bounded_string(raw_dirty_state, 80),
    })
  end
  local dirty = raw_dirty_state > 0
  return {
    project_ref = "project:current",
    dirty = dirty,
    dirty_state = dirty and "dirty" or "clean",
    raw_dirty_state = raw_dirty_state,
  }
end
