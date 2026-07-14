-- Alpha3.3 exact native FX deletion: template.fx.delete_fx.

local function alpha33_delete_fx_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_delete_fx_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function alpha33_delete_fx_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  return ok and first_string(guid) or nil
end

local function alpha33_delete_fx_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and alpha33_delete_fx_track_guid(track) == guid then
      found = track
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_delete_fx_find_take_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local found = nil
  local matches = 0
  for item_index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      local total_takes = ok_takes and math.max(0, math.floor(first_number(take_count) or 0)) or 0
      for take_index = 0, total_takes - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take and alpha33_delete_fx_take_guid(take) == guid then
          found = take
          matches = matches + 1
        end
      end
    end
  end
  return found, matches
end

local function alpha33_delete_fx_exact_ref(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, {
      code = "REF_INVALID",
      message = "delete_fx requires exactly one exact FX ref.",
      details = { ref_count = is_json_array(request.refs) and #request.refs or 0 },
    }
  end
  local ref = request.refs[1]
  if not is_object(ref) or ref.kind ~= "fx" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil, {
      code = "REF_INVALID",
      message = "delete_fx requires one canonical FX ref object.",
      details = {},
    }
  end
  local owner_kind, owner_guid, slot_text = ref.ref:match("^fx:(track):guid:([^:]+):(%d+)$")
  if not owner_kind then
    owner_kind, owner_guid, slot_text = ref.ref:match("^fx:(take):guid:([^:]+):(%d+)$")
  end
  if not owner_kind then
    return nil, {
      code = "REF_INVALID",
      message = "delete_fx accepts only exact Track-FX or Take-FX refs whose owner uses a GUID identity.",
      details = { fx_ref = bounded_string(ref.ref, 160) },
    }
  end
  local slot_index = tonumber(slot_text)
  local expected_scheme = owner_kind .. "_fx"
  local expected_value = owner_kind .. ":guid:" .. owner_guid .. ":" .. slot_text
  if ref.identity.scheme ~= expected_scheme or tostring(ref.identity.value) ~= expected_value then
    return nil, {
      code = "REF_INVALID",
      message = "delete_fx FX ref identity does not match its owner and slot.",
      details = { fx_ref = bounded_string(ref.ref, 160) },
    }
  end
  return {
    object_ref = ref,
    ref = ref.ref,
    owner_kind = owner_kind,
    owner_guid = owner_guid,
    owner_ref = owner_kind .. ":guid:" .. owner_guid,
    slot_index = math.floor(slot_index),
  }, nil
end

local function alpha33_delete_fx_count(owner_kind, owner)
  local ok, count
  if owner_kind == "take" then
    ok, count = call_reaper("TakeFX_GetCount", owner)
  else
    ok, count = call_reaper("TrackFX_GetCount", owner)
  end
  return ok and math.max(0, math.floor(first_number(count) or 0)) or nil
end

local function alpha33_delete_fx_guid(owner_kind, owner, slot_index)
  local ok, guid
  if owner_kind == "take" then
    ok, guid = call_reaper("TakeFX_GetFXGUID", owner, slot_index)
  else
    ok, guid = call_reaper("TrackFX_GetFXGUID", owner, slot_index)
  end
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_delete_fx_name(owner_kind, owner, slot_index)
  local call_ok, api_ok, value
  if owner_kind == "take" then
    call_ok, api_ok, value = call_reaper("TakeFX_GetFXName", owner, slot_index, "")
  else
    call_ok, api_ok, value = call_reaper("TrackFX_GetFXName", owner, slot_index, "")
  end
  value = call_ok and api_ok ~= false and first_string(value) or nil
  return value and bounded_string(value, 160) or nil
end

local function alpha33_delete_fx_ident(owner_kind, owner, slot_index)
  local ok, value_a, value_b
  if owner_kind == "take" then
    ok, value_a, value_b = call_reaper("TakeFX_GetNamedConfigParm", owner, slot_index, "fx_ident")
  else
    ok, value_a, value_b = call_reaper("TrackFX_GetNamedConfigParm", owner, slot_index, "fx_ident")
  end
  return bounded_string(ok and first_string(value_a, value_b) or "", 160)
end

local function alpha33_delete_fx_guid_occurrences(owner_kind, owner, fx_guid, count)
  local matches = 0
  for slot_index = 0, count - 1 do
    local current_guid = alpha33_delete_fx_guid(owner_kind, owner, slot_index)
    if not current_guid then
      return matches, false
    end
    if current_guid == fx_guid then
      matches = matches + 1
    end
  end
  return matches, true
end

local function alpha33_delete_fx(request)
  local exact, ref_failure = alpha33_delete_fx_exact_ref(request)
  if not exact then
    return alpha33_delete_fx_error(ref_failure.code, ref_failure.message, ref_failure.details)
  end

  local owner, owner_matches
  if exact.owner_kind == "take" then
    owner, owner_matches = alpha33_delete_fx_find_take_by_guid(exact.owner_guid)
  else
    owner, owner_matches = alpha33_delete_fx_find_track_by_guid(exact.owner_guid)
  end
  if owner_matches == 0 or not owner then
    return alpha33_delete_fx_error("FX_OWNER_NOT_FOUND", "delete_fx exact owner GUID did not resolve.", {
      owner_kind = exact.owner_kind,
      owner_ref = exact.owner_ref,
    })
  end
  if owner_matches ~= 1 then
    return alpha33_delete_fx_error("REF_INVALID", "delete_fx exact owner GUID resolved more than once.", {
      owner_kind = exact.owner_kind,
      owner_ref = exact.owner_ref,
      duplicate_count = owner_matches,
    }, false)
  end

  local count_before = alpha33_delete_fx_count(exact.owner_kind, owner)
  if count_before == nil then
    return alpha33_delete_fx_error("COMMAND_FAILED", "delete_fx could not read the complete owner FX chain before mutation.", {
      owner_ref = exact.owner_ref,
    }, false)
  end
  if exact.slot_index < 0 or exact.slot_index >= count_before then
    return alpha33_delete_fx_error("FX_SLOT_NOT_FOUND", "delete_fx exact slot is outside the complete owner FX chain.", {
      fx_ref = exact.ref,
      fx_count = count_before,
      slot_index = exact.slot_index,
    })
  end

  local fx_guid = alpha33_delete_fx_guid(exact.owner_kind, owner, exact.slot_index)
  if not fx_guid or fx_guid == "" then
    return alpha33_delete_fx_error("FX_REF_NOT_FOUND", "delete_fx could not read a native FX GUID for the exact slot.", {
      fx_ref = exact.ref,
    }, false)
  end
  local guid_matches, chain_complete = alpha33_delete_fx_guid_occurrences(exact.owner_kind, owner, fx_guid, count_before)
  if not chain_complete then
    return alpha33_delete_fx_error("COMMAND_FAILED", "delete_fx could not read every native FX GUID in the complete owner chain before mutation.", {
      fx_ref = exact.ref,
      fx_guid = fx_guid,
    }, false)
  end
  if guid_matches ~= 1 then
    return alpha33_delete_fx_error("REF_INVALID", "delete_fx native FX GUID is missing or duplicated in the complete owner chain.", {
      fx_ref = exact.ref,
      fx_guid = fx_guid,
      duplicate_count = guid_matches,
    }, false)
  end
  local name = alpha33_delete_fx_name(exact.owner_kind, owner, exact.slot_index)
  if not name then
    return alpha33_delete_fx_error("COMMAND_FAILED", "delete_fx could not read the exact FX name before mutation.", {
      fx_ref = exact.ref,
      fx_guid = fx_guid,
    }, false)
  end
  local ident = alpha33_delete_fx_ident(exact.owner_kind, owner, exact.slot_index)

  local command_ok, deleted
  if exact.owner_kind == "take" then
    command_ok, deleted = call_reaper("TakeFX_Delete", owner, exact.slot_index)
  else
    command_ok, deleted = call_reaper("TrackFX_Delete", owner, exact.slot_index)
  end
  if not command_ok or deleted == false then
    return alpha33_delete_fx_error("COMMAND_FAILED", "REAPER rejected exact FX deletion.", {
      fx_ref = exact.ref,
      name = name,
    }, false)
  end

  local count_after = alpha33_delete_fx_count(exact.owner_kind, owner)
  if count_after == nil or count_after ~= count_before - 1 then
    return alpha33_delete_fx_error("VERIFY_FAILED", "FX chain count did not decrement by exactly one after deletion.", {
      fx_ref = exact.ref,
      fx_count_before = count_before,
      fx_count_after = count_after,
    }, false)
  end
  local remaining_matches, readback_complete = alpha33_delete_fx_guid_occurrences(exact.owner_kind, owner, fx_guid, count_after)
  if not readback_complete then
    return alpha33_delete_fx_error("VERIFY_FAILED", "delete_fx could not read every native FX GUID in the complete owner chain after mutation.", {
      fx_ref = exact.ref,
      fx_guid = fx_guid,
    }, false)
  end
  if remaining_matches ~= 0 then
    return alpha33_delete_fx_error("VERIFY_FAILED", "Deleted native FX GUID still exists in the complete owner chain.", {
      fx_ref = exact.ref,
      fx_guid = fx_guid,
    }, false)
  end
  call_reaper("UpdateArrange")

  return {
    kind = "fx_deleted",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    deleted_fx_ref = exact.ref,
    owner_kind = exact.owner_kind,
    owner_ref = exact.owner_ref,
    slot_index = exact.slot_index,
    name = name,
    ident = ident,
    fx_guid = fx_guid,
    fx_count_before = count_before,
    fx_count_after = count_after,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({ exact.object_ref })
end
