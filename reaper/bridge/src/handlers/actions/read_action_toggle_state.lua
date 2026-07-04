-- Extracted read-only handler: template.actions.read_action_toggle_state.

local function read_action_toggle_state(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local ok, state = call_reaper("GetToggleCommandStateEx", section_id, command_id or 0)
  local label = "unknown"
  if ok and type(state) == "number" then
    if state == 1 then
      label = "on"
    elseif state == 0 then
      label = "off"
    elseif state == -1 then
      label = "not_applicable"
    end
  end
  return {
    section = section,
    command_id = command_id,
    state = label,
    available = command_id ~= nil and command_id > 0,
  }
end
