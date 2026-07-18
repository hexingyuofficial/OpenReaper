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

local function finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
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

local function note_has_any(note, keys)
  for index = 1, #keys do
    if note[keys[index]] ~= nil then
      return true
    end
  end
  return false
end

local function native_ppq_from_project_qn(take, qn, note_index, field)
  local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjQN", take, qn)
  local value = ok and finite_number(first_number(ppq)) or nil
  if value == nil then
    return nil, {
      code = "COMMAND_FAILED",
      message = "Native project-QN to PPQ conversion failed before MIDI note insertion.",
      details = {
        note_index = note_index,
        field = field,
        project_qn = qn,
        zero_writes = true,
      },
      recoverable = false,
    }
  end
  return value
end

local function prepare_insert_notes(request)
  local position_unit = request.params.position_unit
  if position_unit ~= "ppq" and position_unit ~= "project_qn" then
    return nil, {
      code = "PARAMS_INVALID",
      message = position_unit == "seconds"
        and "Seconds-based MIDI note insertion is temporarily blocked; use position_unit ppq or project_qn."
        or "MIDI note insertion position_unit must be ppq or project_qn.",
      details = {
        blocker_code = position_unit == "seconds" and "MIDI_SECONDS_MODE_MALFORMED" or "MIDI_POSITION_UNIT_INVALID",
        allowed_position_units = json_array({ "ppq", "project_qn" }),
        recovery = "Use position_unit ppq with start_ppq/end_ppq, or position_unit project_qn with start_qn/end_qn.",
      },
    }
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  if #notes < 1 then
    return nil, {
      code = "PARAMS_INVALID",
      message = "MIDI note insertion requires at least one note.",
      details = { field = "notes" },
    }
  end
  local prepared = json_array({})
  local ppq_fields = { "start_ppq", "end_ppq" }
  local qn_fields = { "start_qn", "end_qn" }
  for index = 1, #notes do
    local note = notes[index]
    if not is_object(note) then
      return nil, {
        code = "PARAMS_INVALID",
        message = "Every MIDI note must be an object.",
        details = { note_index = index - 1 },
      }
    end
    local has_ppq = note_has_any(note, ppq_fields)
    local has_qn = note_has_any(note, qn_fields)
    if position_unit == "ppq" then
      if has_qn or not has_ppq then
        return nil, {
          code = "PARAMS_INVALID",
          message = "PPQ note insertion requires start_ppq/end_ppq and forbids project_qn fields.",
          details = {
            note_index = index - 1,
            position_unit = position_unit,
            zero_writes = true,
          },
        }
      end
      local start_ppq = finite_number(note.start_ppq)
      local end_ppq = finite_number(note.end_ppq)
      if start_ppq == nil or end_ppq == nil or end_ppq <= start_ppq then
        return nil, {
          code = "PARAMS_INVALID",
          message = "MIDI note PPQ bounds are invalid.",
          details = { note_index = index - 1, zero_writes = true },
        }
      end
      prepared[#prepared + 1] = {
        start_ppq = start_ppq,
        end_ppq = end_ppq,
        channel = note.channel,
        pitch = note.pitch,
        velocity = note.velocity,
        selected = note.selected,
        muted = note.muted,
      }
    else
      if has_ppq or not has_qn then
        return nil, {
          code = "PARAMS_INVALID",
          message = "Project-QN note insertion requires start_qn/end_qn and forbids PPQ fields.",
          details = {
            note_index = index - 1,
            position_unit = position_unit,
            zero_writes = true,
          },
        }
      end
      local start_qn = finite_number(note.start_qn)
      local end_qn = finite_number(note.end_qn)
      if start_qn == nil or end_qn == nil or end_qn <= start_qn then
        return nil, {
          code = "PARAMS_INVALID",
          message = "MIDI note project-QN bounds are invalid.",
          details = { note_index = index - 1, zero_writes = true },
        }
      end
      prepared[#prepared + 1] = {
        start_qn = start_qn,
        end_qn = end_qn,
        channel = note.channel,
        pitch = note.pitch,
        velocity = note.velocity,
        selected = note.selected,
        muted = note.muted,
      }
    end
    local channel = integer_value(note.channel)
    local pitch = integer_value(note.pitch)
    local velocity = integer_value(note.velocity)
    if channel == nil or channel < 0 or channel > 15 then
      return nil, {
        code = "PARAMS_INVALID",
        message = "MIDI note channel must be an integer from 0 through 15.",
        details = { note_index = index - 1, zero_writes = true },
      }
    end
    if pitch == nil or pitch < 0 or pitch > 127 then
      return nil, {
        code = "PARAMS_INVALID",
        message = "MIDI note pitch must be an integer from 0 through 127.",
        details = { note_index = index - 1, zero_writes = true },
      }
    end
    if velocity == nil or velocity < 1 or velocity > 127 then
      return nil, {
        code = "PARAMS_INVALID",
        message = "MIDI note velocity must be an integer from 1 through 127.",
        details = { note_index = index - 1, zero_writes = true },
      }
    end
    if note.selected ~= nil and type(note.selected) ~= "boolean" then
      return nil, {
        code = "PARAMS_INVALID",
        message = "MIDI note selected must be boolean when supplied.",
        details = { note_index = index - 1, zero_writes = true },
      }
    end
    if note.muted ~= nil and type(note.muted) ~= "boolean" then
      return nil, {
        code = "PARAMS_INVALID",
        message = "MIDI note muted must be boolean when supplied.",
        details = { note_index = index - 1, zero_writes = true },
      }
    end
    prepared[#prepared].channel = channel
    prepared[#prepared].pitch = pitch
    prepared[#prepared].velocity = velocity
  end
  return {
    position_unit = position_unit,
    notes = prepared,
  }
end

local function convert_prepared_notes_to_ppq(take, prepared)
  local converted = json_array({})
  for index = 1, #prepared.notes do
    local note = prepared.notes[index]
    local start_ppq = note.start_ppq
    local end_ppq = note.end_ppq
    if prepared.position_unit == "project_qn" then
      local start_value, start_failure = native_ppq_from_project_qn(take, note.start_qn, index - 1, "start_qn")
      if not start_value then
        return nil, start_failure
      end
      local end_value, end_failure = native_ppq_from_project_qn(take, note.end_qn, index - 1, "end_qn")
      if not end_value then
        return nil, end_failure
      end
      start_ppq = start_value
      end_ppq = end_value
      if end_ppq <= start_ppq then
        return nil, {
          code = "PARAMS_INVALID",
          message = "Native project-QN conversion produced invalid PPQ bounds before insertion.",
          details = {
            note_index = index - 1,
            start_qn = note.start_qn,
            end_qn = note.end_qn,
            start_ppq = start_ppq,
            end_ppq = end_ppq,
            zero_writes = true,
          },
        }
      end
    end
    converted[#converted + 1] = {
      start_ppq = start_ppq,
      end_ppq = end_ppq,
      channel = note.channel,
      pitch = note.pitch,
      velocity = note.velocity,
      selected = note.selected == true,
      muted = note.muted == true,
    }
  end
  return converted
end

local function safe_write_insert_notes_batch(request)
  local prepared, prepare_failure = prepare_insert_notes(request)
  if not prepared then
    return handler_error(prepare_failure.code, prepare_failure.message, prepare_failure.details, prepare_failure.recoverable)
  end
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local notes, convert_failure = convert_prepared_notes_to_ppq(take, prepared)
  if not notes then
    return handler_error(convert_failure.code, convert_failure.message, convert_failure.details, convert_failure.recoverable)
  end
  local inserted = 0
  for index = 1, #notes do
    local note = notes[index]
    local ok, success = call_reaper(
      "MIDI_InsertNote",
      take,
      note.selected,
      note.muted,
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
  summary.position_unit = prepared.position_unit
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
