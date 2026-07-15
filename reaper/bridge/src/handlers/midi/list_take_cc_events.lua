-- Extracted read-only handler: template.midi.list_take_cc_events.

local function read_b_midi_cc_cursor(value)
  if value == nil or value == JSON_NULL or value == "" then
    return 0
  end
  if not is_string(value) or not value:match("^%d+$") then
    return nil
  end
  local cursor = tonumber(value)
  if cursor == nil or cursor < 0 or cursor ~= math.floor(cursor) then
    return nil
  end
  return cursor
end

local function list_take_cc_events(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, _, cc_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(cc_count) or 0
  local cursor = read_b_midi_cc_cursor(request.params.cursor)
  if cursor == nil then
    return READ_B_MIDI.handler_error("PARAMS_INVALID", "MIDI CC cursor must be a non-negative decimal string.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
    })
  end
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local controller = READ_B_MIDI.integer_value(request.params.controller)
  local events = json_array({})
  local matched = 0
  for index = 0, math.max(total - 1, -1) do
    local ok_cc, cc_retval, selected, muted, ppq, chanmsg, channel, msg2, msg3 = call_reaper("MIDI_GetCC", take, index)
    if ok_cc and cc_retval ~= false and selected ~= nil then
      local event_controller = first_number(msg2) or 0
      if controller == nil or controller == event_controller then
        if matched >= cursor and #events < limit then
          events[#events + 1] = {
            index = index,
            selected = selected == true,
            muted = muted == true,
            ppq = first_number(ppq) or 0,
            channel_message = first_number(chanmsg) or 0,
            channel = first_number(channel) or 0,
            controller = event_controller,
            value = first_number(msg3) or 0,
          }
        end
        matched = matched + 1
      end
    end
  end
  return READ_B_MIDI.fit_paginated_summary(request, events, math.max(matched - cursor, 0), function()
    local has_more = matched > cursor + #events
    return {
      take_ref = READ_B_MIDI.take_ref_string(take),
      cc_events = events,
      returned_count = #events,
      next_cursor = has_more and tostring(cursor + #events) or nil,
      truncated = has_more,
    }
  end, "cc_event")
end
