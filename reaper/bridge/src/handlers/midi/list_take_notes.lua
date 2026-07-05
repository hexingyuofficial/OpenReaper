-- Extracted read-only handler: template.midi.list_take_notes.

local function list_take_notes(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, note_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(note_count) or 0
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local notes = json_array({})
  for index = 0, math.max(total - 1, -1) do
    if #notes >= limit then
      break
    end
    local ok_note, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if ok_note and selected ~= nil then
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
      if request.params.include_project_time == true then
        local ok_start, start_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.start_ppq)
        local ok_end, end_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.end_ppq)
        note.start_seconds = ok_start and first_number(start_time) or nil
        note.end_seconds = ok_end and first_number(end_time) or nil
      end
      notes[#notes + 1] = note
    end
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    notes = notes,
    returned_count = #notes,
    next_cursor = total > #notes and tostring(#notes) or nil,
    truncated = total > #notes,
  }
end
