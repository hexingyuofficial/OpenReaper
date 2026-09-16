-- Bootstraps the Studio dialog loop (single instance).

local function load_sibling(name)
  local entry = debug.getinfo(1, "S").source:match("^@(.+)$")
  local dir = entry:match("^(.*)/")
  return dofile(dir .. "/" .. name .. ".lua")
end

local runtime_config = load_sibling("runtime_config")
local context_chip = load_sibling("context_chip")
local agent_bridge = load_sibling("agent_bridge")
local ui_face = load_sibling("ui_face")

local M = {}

function M.start()
  if not reaper.ImGui_CreateContext then
    return false, "ReaImGui missing"
  end

  if OpenReaperStudioDialog and OpenReaperStudioDialog.running then
    OpenReaperStudioDialog.focus = true
    return true
  end

  local state = {
    running = true,
    focus = false,
    ctx = reaper.ImGui_CreateContext("OpenReaper Studio"),
    open = true,
    input = "",
    chips = {},
    status = "",
    last_reply = "",
    config = runtime_config.read_face_config(),
  }

  OpenReaperStudioDialog = state

  if runtime_config.consume_open_on_load_flag() then
    state.open = true
  end

  local function loop()
    if state.open then
      ui_face.draw(state, state.ctx, context_chip, agent_bridge)
      reaper.defer(loop)
    else
      state.running = false
      OpenReaperStudioDialog = nil
    end
  end

  reaper.defer(loop)
  return true
end

return M
