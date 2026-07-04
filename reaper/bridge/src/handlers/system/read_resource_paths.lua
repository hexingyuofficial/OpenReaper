-- Extracted Wave 0 handler: template.system.read_resource_paths.

local function read_resource_paths_current_script_dir()
  if debug and type(debug.getinfo) == "function" then
    local info = debug.getinfo(1, "S")
    if info and type(info.source) == "string" then
      return dirname(info.source:gsub("^@", ""))
    end
  end
  return ""
end

local function read_resource_paths(request)
  local ok_resource, resource_path = call_reaper("GetResourcePath")
  local ok_exe, exe_path = call_reaper("GetExePath")
  local include_queue_paths = request.params.include_queue_paths == true
  return {
    resource_path = bounded_string(ok_resource and first_string(resource_path) or "", 240),
    executable_path = bounded_string(ok_exe and first_string(exe_path) or "", 240),
    bridge_script_dir = request.params.include_script_path == true and read_resource_paths_current_script_dir() or nil,
    queue_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    transport_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    requests_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    results_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    pending_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    done_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    queue_override_present = TRANSPORT_DIR ~= nil,
  }
end
