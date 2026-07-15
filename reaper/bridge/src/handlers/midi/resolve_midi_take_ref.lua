-- Extracted read-only handler: template.midi.resolve_midi_take_ref.

local READ_B_MIDI = {}

function READ_B_MIDI.handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

function READ_B_MIDI.bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

function READ_B_MIDI.fit_paginated_summary(request, rows, remaining_count, summary_factory, row_kind)
  local summary = summary_factory()
  local encoded = json.encode(summary)
  local summary_budget = READ_B_MIDI.paginated_summary_byte_budget(request)
  while #encoded > summary_budget and #rows > 0 do
    table.remove(rows)
    summary = summary_factory()
    encoded = json.encode(summary)
  end
  if #encoded > summary_budget then
    return READ_B_MIDI.handler_error("RESPONSE_TOO_LARGE", "MIDI read page cannot fit within the request response budget.", {
      reason_code = remaining_count > 0 and "SINGLE_ROW_EXCEEDS_RESPONSE_BUDGET" or "EMPTY_PAGE_EXCEEDS_RESPONSE_BUDGET",
      row_kind = row_kind,
      max_response_bytes = safe_budget(request).max_response_bytes,
    })
  end
  if remaining_count > 0 and #rows == 0 then
    return READ_B_MIDI.handler_error("RESPONSE_TOO_LARGE", "One MIDI read row cannot fit within the request response budget.", {
      reason_code = "SINGLE_ROW_EXCEEDS_RESPONSE_BUDGET",
      row_kind = row_kind,
      max_response_bytes = safe_budget(request).max_response_bytes,
    })
  end
  return summary
end

function READ_B_MIDI.paginated_summary_byte_budget(request)
  local response_budget = safe_budget(request).max_response_bytes
  -- Reserve the public call_template envelope, not just the inner bridge envelope.
  local fixed_envelope_reserve = 1580
  return math.max(response_budget - fixed_envelope_reserve, 0)
end

function READ_B_MIDI.integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

function READ_B_MIDI.item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

function READ_B_MIDI.item_ref_string(item)
  local guid = READ_B_MIDI.item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return "item:unknown"
end

function READ_B_MIDI.find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and READ_B_MIDI.item_guid(item) == guid then
      return item
    end
  end
  return nil
end

function READ_B_MIDI.item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

function READ_B_MIDI.take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

function READ_B_MIDI.take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

function READ_B_MIDI.take_ref_string(take)
  local guid = READ_B_MIDI.take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

function READ_B_MIDI.find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

function READ_B_MIDI.find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and READ_B_MIDI.take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

function READ_B_MIDI.resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return READ_B_MIDI.find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return READ_B_MIDI.find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = READ_B_MIDI.find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

function READ_B_MIDI.canonical_take_ref_token(ref)
  if not is_object(ref) or ref.kind ~= "take" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^take:([^:]+):(.+)$")
  if not scheme or (scheme ~= "selected" and scheme ~= "index" and scheme ~= "guid") then
    return nil
  end
  if ref.identity.scheme ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  return ref.ref
end

function READ_B_MIDI.resolve_take_from_ref_object(ref)
  local token = READ_B_MIDI.canonical_take_ref_token(ref)
  if not token then
    return nil
  end
  return READ_B_MIDI.resolve_take_token(token)
end

function READ_B_MIDI.take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

function READ_B_MIDI.resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = READ_B_MIDI.resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return READ_B_MIDI.resolve_take_token(request.params.ref)
end

function READ_B_MIDI.resolve_midi_take_for_request(request)
  local take = READ_B_MIDI.resolve_take_for_request(request)
  if not take or not READ_B_MIDI.take_is_midi(take) then
    local _, failure = READ_B_MIDI.handler_error("TAKE_NOT_FOUND", "MIDI take ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
    return nil, failure
  end
  return take
end

function READ_B_MIDI.midi_take_summary(take)
  local item = READ_B_MIDI.take_item(take)
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local count_ok = ok_count and count_retval ~= false
  local start_ppq = 0
  local end_ppq = 0
  if item then
    local start_seconds = READ_B_MIDI.item_number(item, "D_POSITION")
    local end_seconds = start_seconds + READ_B_MIDI.item_number(item, "D_LENGTH")
    local ok_start, ppq_start = call_reaper("MIDI_GetPPQPosFromProjTime", take, start_seconds)
    local ok_end, ppq_end = call_reaper("MIDI_GetPPQPosFromProjTime", take, end_seconds)
    start_ppq = ok_start and first_number(ppq_start) or 0
    end_ppq = ok_end and first_number(ppq_end) or 0
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    item_ref = item and READ_B_MIDI.item_ref_string(item) or JSON_NULL,
    event_count = count_ok and ((first_number(note_count) or 0) + (first_number(cc_count) or 0) + (first_number(text_sysex_count) or 0)) or 0,
    ppq_start = start_ppq,
    ppq_end = end_ppq,
  }
end

local function resolve_midi_take_ref(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  return READ_B_MIDI.midi_take_summary(take)
end
