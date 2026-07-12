-- Extracted Safe-Write-A handler: template.midi.insert_notes_batch.

local function handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function safe_write_a_summary(request, readback)
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

local function safe_write_a_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback
end

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function resolve_midi_take_for_request(request)
  return READ_B_MIDI.resolve_midi_take_for_request(request)
end

local function take_object_ref(take)
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

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  end
  return 1
end

local function safe_write_insert_notes_batch(request)
  if request.params.position_unit ~= "ppq" then
    return handler_error("PARAMS_INVALID", "Seconds-based MIDI note insertion is temporarily blocked; use position_unit ppq.", {
      blocker_code = "MIDI_SECONDS_MODE_MALFORMED",
      allowed_position_units = json_array({ "ppq" }),
      recovery = "Convert note positions to PPQ and retry with position_unit ppq.",
    })
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  if #notes < 1 then
    return handler_error("PARAMS_INVALID", "MIDI note insertion requires at least one note.", {
      field = "notes",
    })
  end
  for index = 1, #notes do
    local note = notes[index]
    if not is_object(note) then
      return handler_error("PARAMS_INVALID", "Every MIDI note must be an object.", { note_index = index - 1 })
    end
    local start_ppq = bounded_number(note.start_ppq, nil)
    local end_ppq = bounded_number(note.end_ppq, nil)
    local channel = integer_value(note.channel)
    local pitch = integer_value(note.pitch)
    local velocity = integer_value(note.velocity)
    if start_ppq == nil or end_ppq == nil or end_ppq <= start_ppq then
      return handler_error("PARAMS_INVALID", "MIDI note PPQ bounds are invalid.", { note_index = index - 1 })
    end
    if channel == nil or channel < 0 or channel > 15 then
      return handler_error("PARAMS_INVALID", "MIDI note channel must be an integer from 0 through 15.", { note_index = index - 1 })
    end
    if pitch == nil or pitch < 0 or pitch > 127 then
      return handler_error("PARAMS_INVALID", "MIDI note pitch must be an integer from 0 through 127.", { note_index = index - 1 })
    end
    if velocity == nil or velocity < 1 or velocity > 127 then
      return handler_error("PARAMS_INVALID", "MIDI note velocity must be an integer from 1 through 127.", { note_index = index - 1 })
    end
    if note.selected ~= nil and type(note.selected) ~= "boolean" then
      return handler_error("PARAMS_INVALID", "MIDI note selected must be boolean when supplied.", { note_index = index - 1 })
    end
    if note.muted ~= nil and type(note.muted) ~= "boolean" then
      return handler_error("PARAMS_INVALID", "MIDI note muted must be boolean when supplied.", { note_index = index - 1 })
    end
  end
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local inserted = 0
  for index = 1, #notes do
    local note = notes[index]
    local ok, success = call_reaper(
      "MIDI_InsertNote",
      take,
      note.selected == true,
      note.muted == true,
      note.start_ppq,
      note.end_ppq,
      note.channel,
      note.pitch,
      note.velocity,
      true
    )
    if not ok or success == false then
      call_reaper("MIDI_Sort", take)
      return handler_error("COMMAND_FAILED", "MIDI note insertion failed before the complete batch was written.", {
        failed_note_index = index - 1,
        inserted_note_count = inserted,
        partial_failure = inserted > 0,
      }, false)
    end
    inserted = inserted + 1
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary, readback_failure = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  if not summary then
    return handler_error(
      readback_failure and readback_failure.code or "VERIFY_FAILED",
      "MIDI note insertion readback failed.",
      readback_failure and readback_failure.details or { inserted_note_count = inserted },
      false
    )
  end
  summary.inserted_count = inserted
  summary.inserted_note_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
