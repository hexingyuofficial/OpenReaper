-- OpenReaper: Repeat Remove Silence with Last Settings
-- Stock APIs used by the shared Action: GetUserInputs, ShowMessageBox,
-- GetExtState, SetExtState. Shared route: template.items.split_item_by_silence.
local ACTION_TITLE = "OpenReaper: Repeat Remove Silence with Last Settings"
local ACTION_CAPABILITY = "template.items.split_item_by_silence"
local ACTION_PLAN_FIELD = "plan_hash"
local ACTION_API = {
  GetUserInputs = reaper.GetUserInputs,
  ShowMessageBox = reaper.ShowMessageBox,
  GetExtState = reaper.GetExtState,
  SetExtState = reaper.SetExtState,
}

local function shared_action_path()
  local resource = reaper.GetResourcePath()
  local separator = resource:find("\\", 1, true) and "\\" or "/"
  return table.concat({ resource, "Scripts", "OpenReaper", "remove-silence-shared.lua" }, separator)
end

local shared = dofile(shared_action_path())
return shared.run({
  title = ACTION_TITLE,
  repeat_last = true,
  capability = ACTION_CAPABILITY,
  plan_hash = ACTION_PLAN_FIELD,
  api = ACTION_API,
})
