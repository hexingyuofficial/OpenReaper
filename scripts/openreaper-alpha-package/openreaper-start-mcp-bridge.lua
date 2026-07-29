-- OpenReaper: Start MCP bridge
-- Loaded from the installed package by openreaper-start and copied into the
-- REAPER Actions directory for manual recovery.
local expected_launcher = os.getenv("OPENREAPER_EXPECTED_LAUNCHER_PATH")
if expected_launcher and expected_launcher ~= "" then
  if not reaper or type(reaper.get_action_context) ~= "function" then
    return
  end
  local _, current_launcher = reaper.get_action_context()
  if current_launcher ~= expected_launcher then
    return
  end
end

local bridge = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
local transport = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")

if not transport or transport == "" then
  return
end

local function write_startup_status(stage)
  local status_path = transport .. "/openreaper-startup-status-v1.json"
  local temp_path = status_path .. ".tmp"
  local file = io.open(temp_path, "w")
  if not file then return end
  file:write("{\"contract\":\"openreaper.startup_status.v1\",\"stage\":\"" .. stage .. "\"}\n")
  file:close()
  os.remove(status_path)
  os.rename(temp_path, status_path)
end

write_startup_status("hook_seen")
if not bridge or bridge == "" then
  write_startup_status("environment_missing")
  return
end

local ok, err = pcall(dofile, bridge)
if ok then
  write_startup_status("bridge_dofile_succeeded")
else
  write_startup_status("bridge_dofile_failed")
  if reaper and reaper.MB then
    reaper.MB("OpenReaper MCP bridge failed: " .. tostring(err), "OpenReaper", 0)
  end
end
