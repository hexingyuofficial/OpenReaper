-- Extracted read-only handler: template.midi.read_take_event_counts.

local function read_take_event_counts(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local take_ref = READ_B_MIDI.take_ref_string(take)
  return {
    take_ref = take_ref,
    note_count = ok_count and first_number(note_count) or 0,
    cc_count = ok_count and first_number(cc_count) or 0,
    text_sysex_count = ok_count and first_number(text_sysex_count) or 0,
    take_hash = take_ref .. ":" .. tostring(note_count or 0) .. ":" .. tostring(cc_count or 0) .. ":" .. tostring(text_sysex_count or 0),
  }
end
