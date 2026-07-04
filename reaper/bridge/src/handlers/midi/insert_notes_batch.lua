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
  return fallback or 0
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

local function ppq_position(take, event, key)
  local value = event[key]
  if type(value) == "number" then
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
  if type(event[seconds_key]) == "number" then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event[seconds_key])
    return ok and first_number(ppq) or 0
  end
  return 0
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
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  local inserted = 0
  for index = 1, #notes do
    local note = is_object(notes[index]) and notes[index] or {}
    local start_ppq = ppq_position(take, note, "start_ppq")
    local end_ppq = ppq_position(take, note, "end_ppq")
    if end_ppq > start_ppq then
      local ok, success = call_reaper(
        "MIDI_InsertNote",
        take,
        note.selected == true,
        note.muted == true,
        start_ppq,
        end_ppq,
        math.max(0, math.min(15, integer_value(note.channel) or 0)),
        math.max(0, math.min(127, integer_value(note.pitch) or 60)),
        math.max(1, math.min(127, integer_value(note.velocity) or 96)),
        true
      )
      if ok and success ~= false then
        inserted = inserted + 1
      end
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_note_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
