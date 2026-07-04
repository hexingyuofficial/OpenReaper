-- Extracted Wave 0 handler: template.core.read_openreaper_status.

local function read_openreaper_status(request)
  local include_contracts = request.params.include_contracts == true
  local include_pack_status = request.params.include_pack_status == true
  local include_catalog_status = request.params.include_catalog_status == true
  return {
    status = "ok",
    bridge = {
      owner = ACTIVE_OWNER,
      generation = ACTIVE_GENERATION,
      transport = "file_transport",
      script = SCRIPT_NAME,
      wave = "wave0-plus-wave1a-read-handlers",
      spawned_reaper = false,
    },
    contracts = include_contracts and {
      bridge = CONTRACT,
      executor = "live_bridge.executor.v1",
    } or nil,
    enabled_packs = include_pack_status and json_array({ "project", "transport", "core", "system" }) or json_array({}),
    catalog = include_catalog_status and {
      accepted_official_catalog = true,
      wave0_canary_count = 5,
      wave1a_read_handler_count = 9,
    } or nil,
    warnings = json_array({}),
    truncated = false,
  }
end
