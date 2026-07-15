-- Extracted read-only handler: template.midi.list_take_text_sysex_events.

local function read_b_midi_text_sysex_kind(type_value)
  if type_value == -1 then
    return "sysex"
  elseif type_value == 1 then
    return "text"
  elseif type_value == 5 then
    return "lyric"
  elseif type_value == 15 then
    return "notation"
  end
  return "text"
end

local function read_b_midi_text_sysex_cursor(value)
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

local function list_take_text_sysex_events(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, _, _, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(text_sysex_count) or 0
  local cursor = read_b_midi_text_sysex_cursor(request.params.cursor)
  if cursor == nil then
    return READ_B_MIDI.handler_error("PARAMS_INVALID", "MIDI text/sysex cursor must be a non-negative decimal string.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
    })
  end
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local requested_kind = is_string(request.params.event_kind) and request.params.event_kind or "any"
  local events = json_array({})
  local matched = 0
  for index = 0, math.max(total - 1, -1) do
    local ok_event, event_retval, selected, muted, ppq, type_value, message = call_reaper("MIDI_GetTextSysexEvt", take, index)
    if ok_event and event_retval ~= false and selected ~= nil then
      local kind = read_b_midi_text_sysex_kind(first_number(type_value) or 1)
      if requested_kind == "any" or requested_kind == kind then
        if matched >= cursor and #events < limit then
          events[#events + 1] = {
            index = index,
            selected = selected == true,
            muted = muted == true,
            ppq = first_number(ppq) or 0,
            event_kind = kind,
            text = bounded_string(message, 160),
          }
        end
        matched = matched + 1
      end
    end
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    events = events,
    returned_count = #events,
    next_cursor = matched > cursor + #events and tostring(cursor + #events) or nil,
    truncated = matched > cursor + #events,
  }
end
