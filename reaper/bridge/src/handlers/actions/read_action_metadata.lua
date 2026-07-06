-- Extracted read-only handler: template.actions.read_action_metadata.

local function read_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  return {
    section = section,
    command_id = command_id,
    named_command = named_command,
    display_name = display_name,
    available = command_id ~= nil and command_id > 0,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
  }
end

local function read_custom_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  local resolved = command_id ~= nil and command_id > 0
  return {
    section = section,
    named_command = named_command,
    command_id = resolved and command_id or nil,
    display_name = display_name,
    step_count = 0,
    has_step_details = false,
    steps_truncated = false,
    resolved = resolved,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
    metadata_scope = "bounded_metadata_only",
  }
end

local function read_cycle_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  local ok_sws, sws_version = call_reaper("CF_GetSWSVersion")
  local resolved = command_id ~= nil and command_id > 0
  return {
    section = section,
    named_command = named_command,
    command_id = resolved and command_id or nil,
    display_name = display_name,
    sws_available = ok_sws and type(sws_version) == "string" and sws_version ~= "",
    step_count = 0,
    conditional = false,
    steps_truncated = false,
    resolved = resolved,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
    metadata_scope = "bounded_metadata_only",
  }
end
