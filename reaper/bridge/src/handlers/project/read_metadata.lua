-- Extracted Wave 1A handler: template.project.read_metadata.

local PROJECT_READ_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function read_project_metadata_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function read_project_metadata_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function read_project_metadata_requested_fields(fields)
  if not is_json_array(fields) or #fields == 0 then
    return json_array({ "title", "author", "notes" })
  end
  local result = json_array({})
  local seen = {}
  for index = 1, #fields do
    local field = fields[index]
    if PROJECT_READ_METADATA_KEYS[field] and not seen[field] then
      seen[field] = true
      result[#result + 1] = field
    end
  end
  if #result == 0 then
    return json_array({ "title", "author", "notes" })
  end
  return result
end

local function read_project_metadata(request)
  local project = read_project_metadata_current_project()
  local fields = read_project_metadata_requested_fields(request.params.fields)
  local budget = safe_budget(request)
  local summary = {
    project_ref = "project:current",
  }
  for index = 1, #fields do
    local field = fields[index]
    summary[field] = read_project_metadata_info_string(project, PROJECT_READ_METADATA_KEYS[field], math.min(budget.max_inline_value_bytes, 1024))
  end
  return summary
end
