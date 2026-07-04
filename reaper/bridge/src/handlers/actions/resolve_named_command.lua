-- Extracted read-only handler: template.actions.resolve_named_command.

local READ_B_ACTIONS = {}

READ_B_ACTIONS.SECTION_IDS = {
  main = 0,
  midi_editor = 32060,
  midi_event_list = 32061,
  crossfade_editor = 32062,
  media_explorer = 32063,
}

function READ_B_ACTIONS.section_name(value)
  if READ_B_ACTIONS.SECTION_IDS[value] ~= nil then
    return value
  end
  return "main"
end

function READ_B_ACTIONS.section_id(value)
  return READ_B_ACTIONS.SECTION_IDS[READ_B_ACTIONS.section_name(value)]
end

function READ_B_ACTIONS.integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

function READ_B_ACTIONS.action_source(named_command, command_id)
  if is_string(named_command) and named_command:sub(1, 1) == "_" then
    return "extension"
  end
  if type(command_id) == "number" and command_id > 0 then
    return "native"
  end
  return "unknown"
end

function READ_B_ACTIONS.lookup_named_command(named_command)
  if not is_string(named_command) then
    return 0
  end
  local ok, command_id = call_reaper("NamedCommandLookup", named_command)
  if ok and type(command_id) == "number" and command_id > 0 then
    return math.floor(command_id)
  end
  return 0
end

function READ_B_ACTIONS.reverse_named_command(command_id)
  local ok, named = call_reaper("ReverseNamedCommandLookup", command_id)
  if ok and type(named) == "string" and named ~= "" then
    return named
  end
  return nil
end

function READ_B_ACTIONS.action_display_name(section_id, command_id)
  local ok, name = call_reaper("kbd_getTextFromCmd", command_id, section_id)
  return bounded_string(ok and first_string(name) or "", 160)
end

function READ_B_ACTIONS.bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

function READ_B_ACTIONS.lower_string(value)
  return tostring(value or ""):lower()
end

local function resolve_named_command(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local named_command = bounded_string(request.params.named_command, 160)
  local command_id = READ_B_ACTIONS.lookup_named_command(named_command)
  local resolved = command_id > 0
  return {
    named_command = named_command,
    section = section,
    resolved = resolved,
    command_id = resolved and command_id or nil,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
  }
end
