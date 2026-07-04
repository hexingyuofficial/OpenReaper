-- Extracted Wave 0 handler: template.system.read_runtime_environment.

local function read_runtime_environment(request)
  local ok_version, version = call_reaper("GetAppVersion")
  local ok_os, os_name = call_reaper("GetOS")
  local ok_exe, exe_path = call_reaper("GetExePath")
  return {
    reaper_version = bounded_string(ok_version and first_string(version) or "unknown", 120),
    os = bounded_string(ok_os and first_string(os_name) or "unknown", 120),
    executable_path = request.params.include_bridge_runtime == true and bounded_string(ok_exe and first_string(exe_path) or "", 240) or nil,
    bridge_runtime = request.params.include_bridge_runtime == true and "manual_reaper_defer_file_transport" or nil,
    queue_override_present = non_empty(os.getenv(TRANSPORT_ENV)) ~= nil,
    runtime_flags = request.params.include_runtime_flags == true and {
      spawned_reaper = false,
      writes_project = false,
      process_spawn = false,
    } or {},
  }
end
