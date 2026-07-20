-- Extracted D15 handler: item autofades, take phase, and source relink.

local function d15_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d15_items_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d15_items_item_guid(item)
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

local function d15_items_item_ref_string(item)
  local guid = d15_items_item_guid(item)
  if guid and READ_B_MEDIA.identity_value_within_mutation_bound(guid) then
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
  return nil
end

local function d15_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d15_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d15_items_resolve_item_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^item:selected:(%d+)$")
  if selected_index then
    local ok, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    return ok and item or nil
  end
  local index = token:match("^index:(%d+)$") or token:match("^item:index:(%d+)$")
  if index then
    local ok, item = call_reaper("GetMediaItem", 0, tonumber(index))
    return ok and item or nil
  end
  local guid = token:match("^guid:(.+)$") or token:match("^item:guid:(.+)$")
  if guid then
    return d15_items_find_item_by_guid(guid)
  end
  return nil
end

local function d15_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d15_items_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d15_items_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d15_items_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d15_items_resolve_item_token(ref.ref)
end

local function d15_items_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d15_items_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d15_items_item_object_ref(item)
  local ref = d15_items_item_ref_string(item)
  if not ref then
    return nil
  end
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d15_items_file_object_ref(path_value)
  return READ_B_MEDIA.file_object_ref(path_value)
end

local function d15_items_active_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function d15_items_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function d15_take_number(take, key)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  return ok and first_number(value) or 0
end

local function d15_items_read_finite_number(api_name, target, key)
  local ok, value = call_reaper(api_name, target, key)
  if not ok then
    return nil
  end
  return d15_items_finite_number(first_number(value))
end

local function d15_items_numbers_match(actual, expected)
  if actual == nil or expected == nil then
    return false
  end
  local scale = math.max(1, math.abs(actual), math.abs(expected))
  return math.abs(actual - expected) <= (scale * 1e-9)
end

local function d15_items_item_for_write(request)
  local item = d15_items_item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D15 items request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function d15_items_take_for_write(request, item)
  local take = d15_items_active_take(item)
  if not take then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D15 take request requires an active take.",
      details = {
        item_ref = d15_items_item_ref_string(item),
      },
    }
  end
  return take
end

local function d15_items_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d15_items_summary(request, item, extra, refs)
  local item_ref = request.__openreaper_d15_item_ref or d15_items_item_ref_string(item)
  if not item_ref then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D15 item identity could not be proven without fabrication.",
      details = { blocker = "item_identity_unavailable" },
    }
  end
  local summary = {
    item_ref = item_ref,
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }
  for key, value in pairs(extra or {}) do
    summary[key] = value
  end
  local default_item_ref = request.__openreaper_d15_item_object_ref or d15_items_item_object_ref(item)
  return summary, nil, json_array({}), json_array({}), refs or d15_items_refs(default_item_ref)
end

local function d15_items_set_no_autofades(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local no_autofades = request.params.no_autofades == true
  local value = no_autofades and -1 or 0
  local ok_in = call_reaper("SetMediaItemInfo_Value", item, "D_FADEINLEN_AUTO", value)
  local ok_out = call_reaper("SetMediaItemInfo_Value", item, "D_FADEOUTLEN_AUTO", value)
  if not ok_in or not ok_out then
    return d15_items_error("COMMAND_FAILED", "REAPER rejected item auto-fade update.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d15_items_number(item, "D_FADEINLEN_AUTO") < 0 and d15_items_number(item, "D_FADEOUTLEN_AUTO") < 0
  if readback ~= no_autofades then
    return d15_items_error("VERIFICATION_FAILED", "Item no-autofades readback did not match the request.", {
      requested = no_autofades,
      actual = readback,
    }, false)
  end
  return d15_items_summary(request, item, {
    no_autofades = readback,
  })
end

local function d15_items_take_phase_inverted(take)
  return d15_take_number(take, "D_VOL") < 0
end

local function d15_items_set_invert_phase(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d15_items_take_for_write(request, item)
  if not take then
    return d15_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local current_volume = d15_take_number(take, "D_VOL")
  local magnitude = math.abs(current_volume)
  if magnitude == 0 and request.params.invert_phase == true then
    return d15_items_error("PARAMS_INVALID", "Cannot invert phase on a zero-volume active take without changing its gain.", {
      item_ref = d15_items_item_ref_string(item),
    })
  end
  local next_volume = request.params.invert_phase == true and -magnitude or magnitude
  local ok = call_reaper("SetMediaItemTakeInfo_Value", take, "D_VOL", next_volume)
  if not ok then
    return d15_items_error("COMMAND_FAILED", "REAPER rejected take phase inversion update.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d15_items_take_phase_inverted(take)
  if readback ~= (request.params.invert_phase == true) then
    return d15_items_error("VERIFICATION_FAILED", "Take phase readback did not match the request.", {
      requested = request.params.invert_phase == true,
      actual = readback,
    }, false)
  end
  return d15_items_summary(request, item, {
    invert_phase = readback,
  })
end

local function d15_items_create_source(path_value)
  if not is_string(path_value) or not file_exists(path_value) then
    return nil, "FILE_NOT_FOUND", "D15 replacement source file does not exist."
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return nil, "FILE_NOT_FOUND", "D15 replacement source could not be decoded by REAPER."
  end
  return source
end

local function d15_items_source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function d15_items_choose_new_source_file(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d15_items_take_for_write(request, item)
  if not take then
    return d15_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local item_object_ref = request.__openreaper_d15_item_object_ref or d15_items_item_object_ref(item)
  if not item_object_ref then
    return d15_items_error("ITEM_NOT_FOUND", "D15 item identity could not be proven without fabrication.", {
      blocker = "item_identity_unavailable",
    })
  end
  request.__openreaper_d15_item_object_ref = item_object_ref
  request.__openreaper_d15_item_ref = item_object_ref.ref
  local path_value = request.__openreaper_d15_source_path
  if not path_value then
    path_value = READ_B_MEDIA.file_path_from_request_refs_strict(request)
  end
  if not path_value then
    return d15_items_error("FILE_NOT_FOUND", "D15 source relink requires a valid file ref.", {})
  end
  local preserve_timing = request.params.preserve_timing == true
  local old_start_offset = nil
  local old_item_length = nil
  if preserve_timing then
    old_start_offset = d15_items_read_finite_number("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS")
    old_item_length = d15_items_read_finite_number("GetMediaItemInfo_Value", item, "D_LENGTH")
    if old_start_offset == nil or old_item_length == nil then
      return d15_items_error("COMMAND_FAILED", "D15 could not read timing before source relink.", {
        blocker = "timing_read_failed_before_mutation",
      })
    end
  end
  local source, code, message = d15_items_create_source(path_value)
  if not source then
    return d15_items_error(code, message, { path = bounded_string(path_value, 240) })
  end
  local ok_old_source, old_source = call_reaper("GetMediaItemTake_Source", take)
  local ok_set_call, source_accepted = call_reaper("SetMediaItemTake_Source", take, source)
  if not ok_set_call or source_accepted ~= true then
    call_reaper("PCM_Source_Destroy", source)
    return d15_items_error("COMMAND_FAILED", "REAPER rejected take source relink.", {
      blocker = "source_relink_rejected",
    }, false)
  end
  if preserve_timing then
    local ok_offset_call, offset_accepted = call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", old_start_offset)
    local ok_length_call, length_accepted = call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", old_item_length)
    if not ok_offset_call or offset_accepted ~= true or not ok_length_call or length_accepted ~= true then
      return d15_items_error("COMMAND_FAILED", "REAPER rejected timing preservation after source relink.", {
        blocker = "timing_restore_failed",
      }, false)
    end
  end
  if ok_old_source and old_source and old_source ~= source then
    call_reaper("PCM_Source_Destroy", old_source)
  end
  local ok_update = call_reaper("UpdateItemInProject", item)
  if not ok_update then
    return d15_items_error("COMMAND_FAILED", "REAPER rejected item update after source relink.", {
      blocker = "item_update_failed",
    }, false)
  end
  local ok_readback_source, readback_source = call_reaper("GetMediaItemTake_Source", take)
  local filename = ok_readback_source and readback_source and d15_items_source_filename(readback_source) or ""
  if filename ~= path_value then
    return d15_items_error("VERIFICATION_FAILED", "Take source readback did not match the requested file ref.", {
      requested_path = bounded_string(path_value, 240),
      actual_path = bounded_string(filename, 240),
    }, false)
  end
  if preserve_timing then
    local actual_start_offset = d15_items_read_finite_number("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS")
    local actual_item_length = d15_items_read_finite_number("GetMediaItemInfo_Value", item, "D_LENGTH")
    if not d15_items_numbers_match(actual_start_offset, old_start_offset)
        or not d15_items_numbers_match(actual_item_length, old_item_length) then
      return d15_items_error("VERIFICATION_FAILED", "Source relink timing readback did not match the preserved values.", {
        blocker = "timing_readback_mismatch",
        requested_start_offset = old_start_offset,
        actual_start_offset = actual_start_offset,
        requested_item_length = old_item_length,
        actual_item_length = actual_item_length,
      }, false)
    end
  end
  local file_ref = d15_items_file_object_ref(filename)
  if not file_ref then
    return d15_items_error("VERIFICATION_FAILED", "Take source readback did not provide a canonical file identity.", {}, false)
  end
  return d15_items_summary(request, item, {
    file_ref = file_ref.ref,
    preserve_timing = preserve_timing,
  }, d15_items_refs(item_object_ref, file_ref))
end
