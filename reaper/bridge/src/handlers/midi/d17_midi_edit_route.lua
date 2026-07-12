-- Extracted D17 MIDI edit handlers.

local function d17_midi_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d17_midi_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d17_midi_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.truncated = false
  return readback
end

local function d17_midi_take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d17_midi_integer(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function d17_midi_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d17_midi_clamp(value, min_value, max_value)
  if value < min_value then
    return min_value
  elseif value > max_value then
    return max_value
  end
  return value
end

local function d17_midi_counts(request, take)
  return read_take_event_counts({
    refs = json_array({ d17_midi_take_object_ref(take) }),
    params = {},
    budget = request.budget,
  })
end

local function d17_midi_resolve_guarded_take(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local counts = d17_midi_counts(request, take)
  if is_string(request.params.expected_take_hash) and request.params.expected_take_hash ~= counts.take_hash then
    local _, stale = d17_midi_error("STALE_TAKE_HASH", "D17 MIDI edit rejected stale expected_take_hash.", {
      expected_take_hash = request.params.expected_take_hash,
      actual_take_hash = counts.take_hash,
    })
    return nil, stale
  end
  return take, nil, counts
end

local function d17_midi_ppq_from_event(take, event, key, fallback)
  local value = d17_midi_number(event[key])
  if value then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  local seconds = d17_midi_number(event[seconds_key])
  if seconds then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, seconds)
    return ok and first_number(ppq) or fallback
  end
  return fallback
end

local function d17_midi_grid_ppq(request, take)
  if request.params.grid_unit == "ppq" then
    local grid = d17_midi_number(request.params.grid_ppq)
    if not grid or grid <= 0 then
      return nil, "grid_ppq must be positive when grid_unit is ppq."
    end
    return grid, nil
  end
  local ok_grid, grid = call_reaper("MIDI_GetGrid", take)
  local value = ok_grid and first_number(grid) or nil
  if not value or value <= 0 then
    return nil, "MIDI take grid could not be read as a positive PPQ value."
  end
  return value, nil
end

local function d17_midi_note_count(take)
  local ok_count, count_retval, note_count = call_reaper("MIDI_CountEvts", take)
  if ok_count and count_retval ~= false then
    return math.max(0, math.floor(first_number(note_count) or 0))
  end
  return 0
end

local function d17_midi_cc_count(take)
  local ok_count, count_retval, _, cc_count = call_reaper("MIDI_CountEvts", take)
  if ok_count and count_retval ~= false then
    return math.max(0, math.floor(first_number(cc_count) or 0))
  end
  return 0
end

local function d17_midi_set_notes_batch(request)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  local updated = 0
  for row_index = 1, #notes do
    local note = is_object(notes[row_index]) and notes[row_index] or {}
    local index = d17_midi_integer(note.index)
    if index == nil or index < 0 or index >= d17_midi_note_count(take) then
      return d17_midi_error("NOTE_NOT_FOUND", "D17 MIDI set_notes_batch requires a valid note index.", {
        index = note.index,
      })
    end
    local ok_note, note_retval, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if not ok_note or note_retval == false or selected == nil then
      return d17_midi_error("NOTE_NOT_FOUND", "D17 MIDI note row could not be read.", { index = index })
    end
    local new_start = d17_midi_ppq_from_event(take, note, "start_ppq", first_number(start_ppq) or 0)
    local new_end = d17_midi_ppq_from_event(take, note, "end_ppq", first_number(end_ppq) or 0)
    if new_end <= new_start then
      return d17_midi_error("PARAMS_INVALID", "D17 MIDI note end must be greater than start.", { index = index })
    end
    local ok_set, success = call_reaper(
      "MIDI_SetNote",
      take,
      index,
      note.selected == nil and selected == true or note.selected == true,
      note.muted == nil and muted == true or note.muted == true,
      new_start,
      new_end,
      d17_midi_clamp(d17_midi_integer(note.channel) or first_number(channel) or 0, 0, 15),
      d17_midi_clamp(d17_midi_integer(note.pitch) or first_number(pitch) or 60, 0, 127),
      d17_midi_clamp(d17_midi_integer(note.velocity) or first_number(velocity) or 96, 1, 127),
      true
    )
    if not ok_set or success == false then
      return d17_midi_error("COMMAND_FAILED", "D17 MIDI_SetNote failed.", { index = index }, false)
    end
    updated = updated + 1
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end

local function d17_midi_quantize_notes_impl(request, selected_only)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local grid_ppq, grid_error = d17_midi_grid_ppq(request, take)
  if not grid_ppq then
    return d17_midi_error("PARAMS_INVALID", grid_error, {
      grid_unit = request.params.grid_unit,
      grid_ppq = request.params.grid_ppq,
    })
  end
  local strength = d17_midi_clamp(d17_midi_number(request.params.strength) or 1, 0, 1)
  local total = d17_midi_note_count(take)
  local selected_count = 0
  local updated = 0
  for index = 0, total - 1 do
    local ok_note, note_retval, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if ok_note and note_retval ~= false and selected ~= nil and ((not selected_only) or selected == true) then
      if selected == true then
        selected_count = selected_count + 1
      end
      local start_value = first_number(start_ppq) or 0
      local end_value = first_number(end_ppq) or start_value
      local target = math.floor((start_value / grid_ppq) + 0.5) * grid_ppq
      local new_start = start_value + ((target - start_value) * strength)
      local new_end = end_value
      if request.params.preserve_duration == true then
        new_end = new_start + math.max(0, end_value - start_value)
      end
      local ok_set, success = call_reaper(
        "MIDI_SetNote",
        take,
        index,
        selected == true,
        muted == true,
        new_start,
        new_end,
        first_number(channel) or 0,
        first_number(pitch) or 60,
        first_number(velocity) or 96,
        true
      )
      if not ok_set or success == false then
        return d17_midi_error("COMMAND_FAILED", "D17 MIDI quantize failed.", { index = index }, false)
      end
      updated = updated + 1
    end
  end
  if selected_only and request.params.require_selected_notes == true and selected_count == 0 then
    return d17_midi_error("NOTE_NOT_FOUND", "D17 selected-note quantize requires at least one selected note.", {})
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  counts.selected_count = selected_count
  counts.grid_ppq = grid_ppq
  counts.strength = strength
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end

local function d17_midi_quantize_notes(request)
  return d17_midi_quantize_notes_impl(request, false)
end

local function d17_midi_quantize_selected_notes(request)
  return d17_midi_quantize_notes_impl(request, true)
end

local function d17_midi_set_cc_events_batch(request)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local updated = 0
  for row_index = 1, #events do
    local event = is_object(events[row_index]) and events[row_index] or {}
    local index = d17_midi_integer(event.index)
    if index == nil or index < 0 or index >= d17_midi_cc_count(take) then
      return d17_midi_error("CC_NOT_FOUND", "D17 MIDI set_cc_events_batch requires a valid CC index.", {
        index = event.index,
      })
    end
    local ok_cc, cc_retval, selected, muted, ppq, chanmsg, channel, msg2, msg3 = call_reaper("MIDI_GetCC", take, index)
    if not ok_cc or cc_retval == false or selected == nil then
      return d17_midi_error("CC_NOT_FOUND", "D17 MIDI CC row could not be read.", { index = index })
    end
    local ok_set, success = call_reaper(
      "MIDI_SetCC",
      take,
      index,
      event.selected == nil and selected == true or event.selected == true,
      event.muted == nil and muted == true or event.muted == true,
      d17_midi_ppq_from_event(take, event, "ppq", first_number(ppq) or 0),
      d17_midi_clamp(d17_midi_integer(event.chanmsg) or first_number(chanmsg) or 176, 0, 255),
      d17_midi_clamp(d17_midi_integer(event.channel) or first_number(channel) or 0, 0, 15),
      d17_midi_clamp(d17_midi_integer(event.controller) or d17_midi_integer(event.msg2) or first_number(msg2) or 1, 0, 127),
      d17_midi_clamp(d17_midi_integer(event.value) or d17_midi_integer(event.msg3) or first_number(msg3) or 0, 0, 127),
      true
    )
    if not ok_set or success == false then
      return d17_midi_error("COMMAND_FAILED", "D17 MIDI_SetCC failed.", { index = index }, false)
    end
    updated = updated + 1
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end
