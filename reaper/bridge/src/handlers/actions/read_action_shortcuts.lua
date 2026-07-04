-- Extracted read-only handler: template.actions.read_action_shortcuts.

local function read_action_shortcuts(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or 0
  local limit = READ_B_ACTIONS.bounded_limit(request, request.params.max_shortcuts, 8, 16)
  local ok_count, count = call_reaper("CountActionShortcuts", section_id, command_id)
  local shortcut_count = ok_count and first_number(count) or 0
  local shortcuts = json_array({})
  for index = 0, math.max(shortcut_count - 1, -1) do
    if #shortcuts >= limit then
      break
    end
    local ok_desc, desc = call_reaper("GetActionShortcutDesc", section_id, command_id, index, "")
    shortcuts[#shortcuts + 1] = {
      index = index,
      description = bounded_string(ok_desc and first_string(desc) or "", 160),
    }
  end
  return {
    section = section,
    command_id = command_id,
    shortcut_count = shortcut_count,
    shortcuts = shortcuts,
    truncated = shortcut_count > #shortcuts,
  }
end
