-- Extracted read-only handler: template.actions.parse_marker_action_text.

local function parse_marker_action_text(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local resolve_tokens = request.params.resolve_tokens == true
  local text = bounded_string(request.params.text, safe_budget(request).max_inline_value_bytes)
  local tokens = json_array({})
  local unresolved_count = 0

  for token in tostring(text or ""):gmatch("%S+") do
    local marker_token = token:sub(1, 1) == "!"
    local body = marker_token and token:sub(2) or token
    local command_id = tonumber(body)
    local named_command = nil
    local resolved = false
    if marker_token and command_id and command_id > 0 then
      command_id = math.floor(command_id)
      resolved = true
    elseif marker_token and body:sub(1, 1) == "_" then
      named_command = bounded_string(body, 160)
      if resolve_tokens then
        command_id = READ_B_ACTIONS.lookup_named_command(named_command)
        resolved = command_id > 0
      end
    end
    if marker_token and not resolved then
      unresolved_count = unresolved_count + 1
    end
    tokens[#tokens + 1] = {
      raw = bounded_string(token, 160),
      marker_token = marker_token,
      command_id = resolved and command_id or nil,
      named_command = named_command,
      resolved = resolved,
      section = section,
    }
  end

  return {
    is_marker_action = #tokens > 0 and tokens[1].marker_token == true,
    token_count = #tokens,
    tokens = tokens,
    macro_shaped = #tokens > 1,
    unresolved_count = unresolved_count,
  }
end
