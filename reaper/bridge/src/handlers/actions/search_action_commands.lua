-- Extracted read-only handler: template.actions.search_action_commands.

local ACTION_SEARCH_DEFAULT_LIMIT = 6
local ACTION_SEARCH_MAX_LIMIT = 6
local ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS = 96
local ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS = 80

local function search_action_commands(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local query = READ_B_ACTIONS.lower_string(request.params.query)
  local limit = READ_B_ACTIONS.bounded_limit(request, request.params.limit, ACTION_SEARCH_DEFAULT_LIMIT, ACTION_SEARCH_MAX_LIMIT)
  local cursor = READ_B_ACTIONS.integer_value(tonumber(request.params.cursor)) or 0
  local items = json_array({})
  local scanned = 0
  local index = cursor
  local truncated = false

  while scanned < 10000 do
    local ok_enum, command_id = call_reaper("kbd_enumerateActions", section_id, index)
    if not ok_enum or type(command_id) ~= "number" or command_id <= 0 then
      break
    end
    scanned = scanned + 1
    local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
    local named_command = READ_B_ACTIONS.reverse_named_command(command_id)
    local haystack = READ_B_ACTIONS.lower_string(display_name .. " " .. tostring(named_command or "") .. " " .. tostring(command_id))
    if query == "" or haystack:find(query, 1, true) then
      if #items >= limit then
        truncated = true
        break
      end
      items[#items + 1] = {
        section = section,
        command_id = math.floor(command_id),
        display_name = bounded_string(display_name, ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS),
        named_command = bounded_string(named_command, ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS),
        source = READ_B_ACTIONS.action_source(named_command, command_id),
      }
    end
    index = index + 1
  end

  return {
    section = section,
    items = items,
    next_cursor = truncated and tostring(index) or nil,
    truncated = truncated,
  }
end
