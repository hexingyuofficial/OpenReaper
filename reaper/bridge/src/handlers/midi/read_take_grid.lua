-- Extracted read-only handler: template.midi.read_take_grid.

local function read_take_grid(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_grid, grid, swing, note_length = call_reaper("MIDI_GetGrid", take)
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    grid_ppq = ok_grid and first_number(grid) or 0,
    swing = ok_grid and first_number(swing) or 0,
    note_length_ppq = ok_grid and first_number(note_length) or 0,
  }
end
