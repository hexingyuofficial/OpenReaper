-- Alpha3.3 exact native Item owner move: template.items.move_item_to_track.

local function alpha33_move_item_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_move_item_item_guid(item)
  local ok, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  return ok and first_string(guid) or nil
end

local function alpha33_move_item_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function alpha33_move_item_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  return ok and first_string(guid) or nil
end

local function alpha33_move_item_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and alpha33_move_item_item_guid(item) == guid then
      found = item
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_move_item_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and alpha33_move_item_track_guid(track) == guid then
      found = track
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_move_item_exact_guid_ref(ref, kind)
  if not is_object(ref) or ref.kind ~= kind or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local value = ref.ref:match("^" .. kind .. ":guid:([^:]+)$")
  if not value or ref.identity.scheme ~= "guid" or tostring(ref.identity.value) ~= value then
    return nil
  end
  return { value = value, ref = ref.ref, object_ref = ref }
end

local function alpha33_move_item_request_refs(request)
  if not is_json_array(request.refs) or #request.refs ~= 2 then
    return nil, nil, {
      code = "REF_INVALID",
      message = "move_item_to_track requires exactly one exact Item GUID ref and one exact target Track GUID ref.",
      details = { ref_count = is_json_array(request.refs) and #request.refs or 0 },
    }
  end
  local item_ref = nil
  local track_ref = nil
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" and not item_ref then
      item_ref = alpha33_move_item_exact_guid_ref(ref, "item")
    elseif is_object(ref) and ref.kind == "track" and not track_ref then
      track_ref = alpha33_move_item_exact_guid_ref(ref, "track")
    else
      return nil, nil, {
        code = "REF_INVALID",
        message = "move_item_to_track accepts one Item ref and one target Track ref only.",
        details = { ref_index = index - 1 },
      }
    end
  end
  if not item_ref or not track_ref then
    return nil, nil, {
      code = "REF_INVALID",
      message = "move_item_to_track rejects selected and index aliases; both refs must use exact GUID identities.",
      details = {},
    }
  end
  return item_ref, track_ref, nil
end

local function alpha33_move_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or nil
end

local function alpha33_move_item_owner(item)
  local ok, track = call_reaper("GetMediaItemTrack", item)
  if ok and track then
    return track
  end
  ok, track = call_reaper("GetMediaItem_Track", item)
  return ok and track or nil
end

local function alpha33_move_item_take_snapshot(item)
  local ok_count, count = call_reaper("CountTakes", item)
  if not ok_count then
    return nil
  end
  local total = math.max(0, math.floor(first_number(count) or 0))
  local take_guids = {}
  local take_refs = json_array({})
  for index = 0, total - 1 do
    local ok_take, take = call_reaper("GetTake", item, index)
    local guid = ok_take and take and alpha33_move_item_take_guid(take) or nil
    if not guid or guid == "" then
      return nil
    end
    take_guids[#take_guids + 1] = guid
    take_refs[#take_refs + 1] = "take:guid:" .. guid
  end
  local ok_active, active_take = call_reaper("GetActiveTake", item)
  if not ok_active then
    return nil
  end
  local active_guid = active_take and alpha33_move_item_take_guid(active_take) or ""
  if active_take and (not active_guid or active_guid == "") then
    return nil
  end
  return {
    count = total,
    guids = take_guids,
    refs = take_refs,
    active_guid = active_guid or "",
    active_ref = active_guid and active_guid ~= "" and ("take:guid:" .. active_guid) or "",
  }
end

local function alpha33_move_item_same_takes(before, after)
  if not before or not after or before.count ~= after.count or before.active_guid ~= after.active_guid then
    return false
  end
  for index = 1, before.count do
    if before.guids[index] ~= after.guids[index] then
      return false
    end
  end
  return true
end

local function alpha33_move_item_track_ref_object(ref, guid)
  return {
    kind = "track",
    ref = ref,
    identity = { scheme = "guid", value = guid },
  }
end

local function alpha33_move_item_to_track(request)
  local item_ref, target_ref, ref_failure = alpha33_move_item_request_refs(request)
  if ref_failure then
    return alpha33_move_item_error(ref_failure.code, ref_failure.message, ref_failure.details)
  end
  local item, item_matches = alpha33_move_item_find_item_by_guid(item_ref.value)
  if item_matches == 0 or not item then
    return alpha33_move_item_error("ITEM_NOT_FOUND", "move_item_to_track exact Item GUID did not resolve.", {
      item_ref = item_ref.ref,
    })
  end
  if item_matches ~= 1 then
    return alpha33_move_item_error("REF_INVALID", "move_item_to_track exact Item GUID resolved more than once.", {
      item_ref = item_ref.ref,
      duplicate_count = item_matches,
    }, false)
  end
  local target_track, target_matches = alpha33_move_item_find_track_by_guid(target_ref.value)
  if target_matches == 0 or not target_track then
    return alpha33_move_item_error("TRACK_NOT_FOUND", "move_item_to_track exact existing target Track GUID did not resolve.", {
      target_track_ref = target_ref.ref,
    })
  end
  if target_matches ~= 1 then
    return alpha33_move_item_error("REF_INVALID", "move_item_to_track exact target Track GUID resolved more than once.", {
      target_track_ref = target_ref.ref,
      duplicate_count = target_matches,
    }, false)
  end

  local source_track = alpha33_move_item_owner(item)
  local source_guid = source_track and alpha33_move_item_track_guid(source_track) or nil
  local position_before = alpha33_move_item_number(item, "D_POSITION")
  local length_before = alpha33_move_item_number(item, "D_LENGTH")
  local takes_before = alpha33_move_item_take_snapshot(item)
  local ok_tracks, track_count_before_value = call_reaper("CountTracks", 0)
  local track_count_before = ok_tracks and math.max(0, math.floor(first_number(track_count_before_value) or 0)) or nil
  if not source_guid or position_before == nil or length_before == nil or not takes_before or track_count_before == nil then
    return alpha33_move_item_error("COMMAND_FAILED", "move_item_to_track could not capture complete preflight identity and content readback.", {
      item_ref = item_ref.ref,
      target_track_ref = target_ref.ref,
    }, false)
  end
  local max_items = is_object(request.budget) and math.floor(tonumber(request.budget.max_items) or 50) or 50
  if takes_before.count > math.max(1, max_items) then
    return alpha33_move_item_error("RESPONSE_TOO_LARGE", "move_item_to_track cannot return complete ordered Take identity readback within the request item budget.", {
      item_ref = item_ref.ref,
      take_count = takes_before.count,
      max_items = math.max(1, max_items),
    })
  end

  if source_guid == target_ref.value then
    local source_ref = "track:guid:" .. source_guid
    return {
      kind = "item_moved_to_track",
      capability = request.pack.capability,
      pack = request.pack.id,
      risk = request.pack.risk,
      item_ref = item_ref.ref,
      source_track_ref = source_ref,
      target_track_ref = target_ref.ref,
      position_seconds = position_before,
      length_seconds = length_before,
      take_count = takes_before.count,
      take_refs = takes_before.refs,
      active_take_ref = takes_before.active_ref,
      track_count_unchanged = true,
      changed = false,
      already_on_target = true,
      native_move_dispatched = false,
      readback_status = "passed",
      undo_evidence = "required",
      artifacts_allowed = false,
      truncated = false,
    }, nil, json_array({}), json_array({}), json_array({
      item_ref.object_ref,
      alpha33_move_item_track_ref_object(target_ref.ref, target_ref.value),
    })
  end

  local command_ok, moved = call_reaper("MoveMediaItemToTrack", item, target_track)
  if not command_ok or moved == false then
    return alpha33_move_item_error("COMMAND_FAILED", "REAPER rejected exact Item move to the existing target Track.", {
      item_ref = item_ref.ref,
      target_track_ref = target_ref.ref,
    }, false)
  end
  local readback_item, readback_matches = alpha33_move_item_find_item_by_guid(item_ref.value)
  local readback_track = readback_item and alpha33_move_item_owner(readback_item) or nil
  local readback_track_guid = readback_track and alpha33_move_item_track_guid(readback_track) or nil
  local position_after = readback_item and alpha33_move_item_number(readback_item, "D_POSITION") or nil
  local length_after = readback_item and alpha33_move_item_number(readback_item, "D_LENGTH") or nil
  local takes_after = readback_item and alpha33_move_item_take_snapshot(readback_item) or nil
  local ok_tracks_after, track_count_after_value = call_reaper("CountTracks", 0)
  local track_count_after = ok_tracks_after and math.max(0, math.floor(first_number(track_count_after_value) or 0)) or nil
  if readback_matches ~= 1 or readback_track_guid ~= target_ref.value then
    return alpha33_move_item_error("VERIFY_FAILED", "Moved Item owner readback did not exactly match the target Track GUID.", {
      item_ref = item_ref.ref,
      expected_target_track_ref = target_ref.ref,
      actual_target_track_guid = readback_track_guid,
    }, false)
  end
  if position_after == nil or length_after == nil or math.abs(position_after - position_before) > 0.000000001 or math.abs(length_after - length_before) > 0.000000001 then
    return alpha33_move_item_error("VERIFY_FAILED", "Moved Item position or length changed unexpectedly.", {
      item_ref = item_ref.ref,
      position_before = position_before,
      position_after = position_after,
      length_before = length_before,
      length_after = length_after,
    }, false)
  end
  if not alpha33_move_item_same_takes(takes_before, takes_after) then
    return alpha33_move_item_error("VERIFY_FAILED", "Moved Item take identities, order, or active take changed unexpectedly.", {
      item_ref = item_ref.ref,
      take_count_before = takes_before.count,
      take_count_after = takes_after and takes_after.count or nil,
    }, false)
  end
  if track_count_after ~= track_count_before then
    return alpha33_move_item_error("VERIFY_FAILED", "move_item_to_track changed the project Track count.", {
      track_count_before = track_count_before,
      track_count_after = track_count_after,
    }, false)
  end
  call_reaper("UpdateArrange")

  local source_ref = "track:guid:" .. source_guid
  return {
    kind = "item_moved_to_track",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    item_ref = item_ref.ref,
    source_track_ref = source_ref,
    target_track_ref = target_ref.ref,
    position_seconds = position_after,
    length_seconds = length_after,
    take_count = takes_after.count,
    take_refs = takes_after.refs,
    active_take_ref = takes_after.active_ref,
    track_count_unchanged = true,
    changed = true,
    already_on_target = false,
    native_move_dispatched = true,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({
    item_ref.object_ref,
    alpha33_move_item_track_ref_object(target_ref.ref, target_ref.value),
  })
end
