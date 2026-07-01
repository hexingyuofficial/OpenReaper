-- Pack contract fixture manifest.
--
-- Not shipped as a default capability. Enable with:
--   STREETLIGHT_ENABLED_PACKS=core,pack_contract_fixture
-- or, in REAPER before loading the bridge:
--   _G.STREETLIGHT_ENABLED_PACKS = "core,pack_contract_fixture"

local PACK_DIR = (function()
  local src = debug.getinfo(1, "S").source
  if src:sub(1, 1) == "@" then src = src:sub(2) end
  return src:match("(.*/)") or "./"
end)()

local undo = dofile(PACK_DIR .. "../core/undo.lua")
local track_templates = dofile(PACK_DIR .. "templates/track.lua")
local artifact_templates = dofile(PACK_DIR .. "templates/artifact.lua")

return {
  name = "pack_contract_fixture",
  version = "0.1.0",
  templates = {
    fixture_track_rename = {
      handler     = track_templates.fixture_track_rename,
      undoable    = true,
      undo_label  = "Streetlight Fixture: fixture_track_rename",
      undo_flags  = undo.UNDO_STATE_TRACKCFG,
      entity_kind = "track",
    },
    fixture_artifact_probe = {
      handler     = artifact_templates.fixture_artifact_probe,
      undoable    = false,
      entity_kind = "artifact",
      artifact = {
        kind = "json",
        scope = "probe",
        ref_prefix = "artifact:pack_contract_fixture:probe:",
        read_scope = "artifact",
        updates_last_result = false,
        schema = "openreaper.fixture.probe.v1",
      },
    },
  },
}
