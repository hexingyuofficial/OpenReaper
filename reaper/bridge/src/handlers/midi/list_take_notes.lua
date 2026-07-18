-- Extracted read-only handler: template.midi.list_take_notes.

local function read_b_midi_notes_cursor(value)
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

local function finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function list_take_notes(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, note_count = call_reaper("MIDI_CountEvts", take)
  local total = ok_count and count_retval ~= false and finite_number(first_number(note_count)) or nil
  if total == nil or total < 0 or total ~= math.floor(total) then
    return READ_B_MIDI.handler_error("COMMAND_FAILED", "Could not read the complete MIDI note count.", {
      stage = "count_notes",
    }, false)
  end
  local cursor = read_b_midi_notes_cursor(request.params.cursor)
  if cursor == nil then
    return READ_B_MIDI.handler_error("PARAMS_INVALID", "MIDI note cursor must be a non-negative decimal string.", {
      reason_code = "CURSOR_INVALID",
      cursor = bounded_string(request.params.cursor, 80),
    })
  end
  local include_project_time = request.params.include_project_time == true
  local include_project_qn = request.params.include_project_qn == true
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local notes = json_array({})
  for index = cursor, math.max(total - 1, cursor - 1) do
    if #notes >= limit then
      break
    end
    local ok_note, note_retval, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if not ok_note or note_retval == false or selected == nil then
      return READ_B_MIDI.handler_error("COMMAND_FAILED", "Could not read a complete MIDI note row.", {
        stage = "read_note",
        note_index = index,
        cursor = cursor,
      }, false)
    end
    local note = {
      index = index,
      selected = selected == true,
      muted = muted == true,
      start_ppq = first_number(start_ppq) or 0,
      end_ppq = first_number(end_ppq) or 0,
      channel = first_number(channel) or 0,
      pitch = first_number(pitch) or 0,
      velocity = first_number(velocity) or 0,
    }
    if include_project_time then
        local ok_start, start_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.start_ppq)
        local ok_end, end_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.end_ppq)
        local start_seconds = ok_start and finite_number(first_number(start_time)) or nil
        local end_seconds = ok_end and finite_number(first_number(end_time)) or nil
        if start_seconds == nil or end_seconds == nil then
          return READ_B_MIDI.handler_error("COMMAND_FAILED", "Native PPQ to project-time conversion failed while listing MIDI notes.", {
            note_index = index,
            include_project_time = true,
            start_ppq = note.start_ppq,
            end_ppq = note.end_ppq,
          }, false)
        end
        note.start_seconds = start_seconds
        note.end_seconds = end_seconds
    end
    if include_project_qn then
        local ok_start, start_qn_value = call_reaper("MIDI_GetProjQNFromPPQPos", take, note.start_ppq)
        local ok_end, end_qn_value = call_reaper("MIDI_GetProjQNFromPPQPos", take, note.end_ppq)
        local start_qn = ok_start and finite_number(first_number(start_qn_value)) or nil
        local end_qn = ok_end and finite_number(first_number(end_qn_value)) or nil
        if start_qn == nil or end_qn == nil then
          return READ_B_MIDI.handler_error("COMMAND_FAILED", "Native PPQ to project-QN conversion failed while listing MIDI notes.", {
            note_index = index,
            include_project_qn = true,
            start_ppq = note.start_ppq,
            end_ppq = note.end_ppq,
          }, false)
        end
        note.start_qn = start_qn
        note.end_qn = end_qn
    end
    notes[#notes + 1] = note
  end
  return READ_B_MIDI.fit_paginated_summary(request, notes, math.max(total - cursor, 0), function()
    local has_more = total > cursor + #notes
    return {
      take_ref = READ_B_MIDI.take_ref_string(take),
      notes = notes,
      returned_count = #notes,
      next_cursor = has_more and tostring(cursor + #notes) or nil,
      truncated = has_more,
    }
  end, "note")
end
