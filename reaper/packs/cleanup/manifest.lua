-- Cleanup pack manifest.
--
-- Enable explicitly:
--   STREETLIGHT_ENABLED_PACKS=core,cleanup
-- or, in REAPER before loading the bridge:
--   _G.STREETLIGHT_ENABLED_PACKS = "core,cleanup"

local PACK_DIR = (function()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return src:match("(.*/)") or "./"
end)()

local cleanup_templates = dofile(PACK_DIR .. "templates/cleanup.lua")

return {
  name = "cleanup",
  version = "0.1.0",
  templates = {
    cleanup_plan = {
      handler     = cleanup_templates.cleanup_plan,
      undoable    = false,
      entity_kind = "artifact",
      artifact = {
        kind = "json",
        scope = "plan",
        ref_prefix = "artifact:cleanup:plan:",
        read_scope = "artifact",
        updates_last_result = false,
        schema = "openreaper.cleanup_plan.v1",
      },
    },
  },
}
