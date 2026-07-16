-- Extracted Safe-Write-A handler: template.midi.insert_text_sysex_events.

local SAFE_WRITE_A_TEXT_MAX_BYTES = 4096
local SAFE_WRITE_A_SYSEX_MAX_BYTES = 65535

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

local function safe_write_a_ppq_position(take, event, position_unit)
  local value = event.ppq
  if position_unit == "ppq"
    and type(value) == "number"
    and value == value
    and value ~= math.huge
    and value ~= -math.huge
    and value >= 0 then
    return value
  end
  if position_unit == "seconds"
    and type(event.position_seconds) == "number"
    and event.position_seconds == event.position_seconds
    and event.position_seconds ~= math.huge
    and event.position_seconds ~= -math.huge
    and event.position_seconds >= 0 then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event.position_seconds)
    local resolved = ok and first_number(ppq) or nil
    if type(resolved) == "number" and resolved == resolved and resolved ~= math.huge and resolved ~= -math.huge then
      return resolved
    end
  end
  return nil
end

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  elseif kind == "text" then
    return 1
  end
  return nil
end

local function safe_write_a_sysex_bytes_from_array(value)
  if not is_json_array(value) or #value < 2 or #value > SAFE_WRITE_A_SYSEX_MAX_BYTES then
    return nil
  end
  local parts = {}
  for index = 1, #value do
    local byte = value[index]
    if type(byte) ~= "number" or byte ~= math.floor(byte) or byte < 0 or byte > 255 then
      return nil
    end
    parts[index] = string.char(byte)
  end
  return table.concat(parts)
end

local function safe_write_a_sysex_bytes_from_hex(value)
  if not is_string(value) then
    return nil
  end
  local bytes = {}
  for token in value:gmatch("%S+") do
    local normalized = token:gsub("^0[xX]", "")
    if not normalized:match("^[%x][%x]?$") then
      return nil
    end
    local byte = tonumber(normalized, 16)
    if not byte or byte < 0 or byte > 255 then
      return nil
    end
    bytes[#bytes + 1] = byte
    if #bytes > SAFE_WRITE_A_SYSEX_MAX_BYTES then
      return nil
    end
  end
  return safe_write_a_sysex_bytes_from_array(bytes)
end

local function safe_write_a_sysex_payload(value)
  local payload = nil
  if is_json_array(value) then
    payload = safe_write_a_sysex_bytes_from_array(value)
  elseif is_string(value) then
    payload = safe_write_a_sysex_bytes_from_hex(value)
  end
  if not payload or #payload < 3 or payload:byte(1) ~= 0xF0 or payload:byte(#payload) ~= 0xF7 then
    return nil
  end
  for index = 2, #payload - 1 do
    if payload:byte(index) > 0x7F then
      return nil
    end
  end
  -- REAPER's type=-1 API stores the binary SysEx body without bounding F0/F7.
  return payload:sub(2, #payload - 1)
end

local function safe_write_a_prepare_event(take, raw_event, index, position_unit)
  if not is_object(raw_event) then
    return nil, {
      index = index,
      blocker = "event_not_object",
    }
  end
  local kind = raw_event.event_kind or "text"
  local type_value = text_sysex_type_value(kind)
  if not type_value then
    return nil, {
      index = index,
      blocker = "event_kind_invalid",
      event_kind = bounded_string(kind, 40),
    }
  end
  local ppq = safe_write_a_ppq_position(take, raw_event, position_unit)
  if ppq == nil then
    return nil, {
      index = index,
      blocker = "event_position_invalid",
    }
  end
  local payload = nil
  if kind == "sysex" then
    payload = safe_write_a_sysex_payload(raw_event.bytes)
    if not payload then
      return nil, {
        index = index,
        blocker = "sysex_bytes_invalid",
        required = "F0 ... F7 as an integer byte array or whitespace-separated hex string",
      }
    end
  else
    if not is_string(raw_event.text) or #raw_event.text > SAFE_WRITE_A_TEXT_MAX_BYTES then
      return nil, {
        index = index,
        blocker = "text_payload_invalid",
        max_bytes = SAFE_WRITE_A_TEXT_MAX_BYTES,
      }
    end
    payload = raw_event.text
  end
  return {
    kind = kind,
    type_value = type_value,
    selected = raw_event.selected == true,
    muted = raw_event.muted == true,
    ppq = ppq,
    payload = payload,
  }
end

local function safe_write_a_event_signature(event)
  return table.concat({
    tostring(event.type_value),
    event.selected and "1" or "0",
    event.muted and "1" or "0",
    string.format("%.9f", event.ppq),
    tostring(#event.payload) .. ":" .. event.payload,
  }, "\31")
end

local function safe_write_a_text_sysex_snapshot(take)
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local total = ok_count and count_retval ~= false and first_number(text_sysex_count) or nil
  if type(total) ~= "number" or total < 0 or total ~= math.floor(total) then
    return nil
  end
  local signatures = {}
  for index = 0, total - 1 do
    local ok_event, event_retval, selected, muted, ppq, type_value, payload = call_reaper("MIDI_GetTextSysexEvt", take, index)
    if not ok_event or event_retval == false or selected == nil or muted == nil or type(ppq) ~= "number" or type(type_value) ~= "number" or not is_string(payload) then
      return nil
    end
    local signature = safe_write_a_event_signature({
      type_value = type_value,
      selected = selected == true,
      muted = muted == true,
      ppq = ppq,
      payload = payload,
    })
    signatures[signature] = (signatures[signature] or 0) + 1
  end
  return {
    note_count = first_number(note_count) or 0,
    cc_count = first_number(cc_count) or 0,
    text_sysex_count = total,
    signatures = signatures,
  }
end

local function safe_write_a_requested_signatures(events)
  local counts = {}
  for index = 1, #events do
    local signature = safe_write_a_event_signature(events[index])
    counts[signature] = (counts[signature] or 0) + 1
  end
  return counts
end

local function safe_write_a_verify_delta(before, after, requested)
  if after.text_sysex_count - before.text_sysex_count ~= #requested then
    return false, "aggregate_count_delta_mismatch"
  end
  local required = safe_write_a_requested_signatures(requested)
  for signature, count in pairs(required) do
    local before_count = before.signatures[signature] or 0
    local after_count = after.signatures[signature] or 0
    if after_count - before_count < count then
      return false, "requested_event_missing"
    end
  end
  return true
end

local function safe_write_insert_text_sysex_events(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local raw_events = is_json_array(request.params.events) and request.params.events or nil
  if not raw_events or #raw_events == 0 then
    return handler_error("PARAMS_INVALID", "insert_text_sysex_events requires at least one event.", {
      blocker = "events_empty_or_invalid",
    })
  end
  local position_unit = request.params.position_unit
  if position_unit ~= "ppq" and position_unit ~= "seconds" then
    return handler_error("PARAMS_INVALID", "insert_text_sysex_events position_unit must be ppq or seconds.", {
      blocker = "position_unit_invalid",
    })
  end
  local events = {}
  local verified_by_kind = {
    text = 0,
    lyric = 0,
    notation = 0,
    sysex = 0,
  }
  for index = 1, #raw_events do
    local event, event_failure = safe_write_a_prepare_event(take, raw_events[index], index, position_unit)
    if not event then
      return handler_error("PARAMS_INVALID", "MIDI text/SysEx event failed pre-mutation validation.", event_failure)
    end
    events[index] = event
    verified_by_kind[event.kind] = verified_by_kind[event.kind] + 1
  end

  local before = safe_write_a_text_sysex_snapshot(take)
  if not before then
    return handler_error("VERIFY_FAILED", "Could not snapshot MIDI text/SysEx rows before mutation.", {
      blocker = "before_rows_unreadable",
    }, false)
  end
  local dispatched = 0
  for index = 1, #events do
    local event = events[index]
    local ok, success = call_reaper(
      "MIDI_InsertTextSysexEvt",
      take,
      event.selected,
      event.muted,
      event.ppq,
      event.type_value,
      event.payload,
      true
    )
    if not ok or success == false then
      if request.params.sort_events ~= false then
        call_reaper("MIDI_Sort", take)
      end
      return handler_error("COMMAND_FAILED", "REAPER rejected one MIDI text/SysEx event insertion.", {
        blocker = "event_dispatch_failed",
        failed_index = index,
        dispatch_succeeded_count = dispatched,
      }, false)
    end
    dispatched = dispatched + 1
  end
  if request.params.sort_events ~= false then
    local ok_sort, sort_retval = call_reaper("MIDI_Sort", take)
    if not ok_sort or sort_retval == false then
      return handler_error("COMMAND_FAILED", "REAPER rejected MIDI event sorting after insertion.", {
        blocker = "midi_sort_failed",
        dispatch_succeeded_count = dispatched,
      }, false)
    end
  end

  local after = safe_write_a_text_sysex_snapshot(take)
  if not after then
    return handler_error("VERIFY_FAILED", "Could not read MIDI text/SysEx rows after mutation.", {
      blocker = "after_rows_unreadable",
      dispatch_succeeded_count = dispatched,
    }, false)
  end
  local verified, verify_reason = safe_write_a_verify_delta(before, after, events)
  if not verified then
    return handler_error("VERIFY_FAILED", "Dispatched MIDI text/SysEx events did not all persist in exact live readback.", {
      blocker = verify_reason,
      dispatch_succeeded_count = dispatched,
      before_text_sysex_count = before.text_sysex_count,
      after_text_sysex_count = after.text_sysex_count,
      requested_count = #events,
    }, false)
  end

  local take_ref = READ_B_MIDI.take_ref_string(take)
  local summary = {
    take_ref = take_ref,
    note_count = after.note_count,
    cc_count = after.cc_count,
    text_sysex_count = after.text_sysex_count,
    take_hash = take_ref .. ":" .. tostring(after.note_count) .. ":" .. tostring(after.cc_count) .. ":" .. tostring(after.text_sysex_count),
    inserted_count = #events,
    inserted_text_sysex_count = #events,
    verified_text_sysex_count = #events,
    verified_by_kind = verified_by_kind,
    verification_mode = "exact_row_multiset_delta",
  }
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
