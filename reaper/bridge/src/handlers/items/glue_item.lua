-- Alpha3.3 exact native Item glue: template.items.glue_item.

local ALPHA3_3_GLUE_ITEM_ACTION_ID = 40362

local function alpha33_glue_item_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_glue_item_guid(item)
  local ok, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_glue_item_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_glue_item_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_glue_item_owner_track(item)
  local ok, track = call_reaper("GetMediaItemTrack", item)
  if ok and track then return track end
  ok, track = call_reaper("GetMediaItem_Track", item)
  return ok and track or nil
end

local function alpha33_glue_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or nil
end

local function alpha33_glue_item_numbers_match(actual, expected)
  return actual ~= nil and expected ~= nil and math.abs(actual - expected) <= 0.000000001
end

local function alpha33_glue_item_exact_ref(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, { code = "REF_INVALID", message = "glue_item requires exactly one exact Item ref.", details = {} }
  end
  local ref = request.refs[1]
  if not is_object(ref) or ref.kind ~= "item" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil, { code = "REF_INVALID", message = "glue_item requires one canonical Item ref object.", details = {} }
  end
  local guid = ref.ref:match("^item:guid:([^:]+)$")
  if not guid or ref.identity.scheme ~= "guid" or tostring(ref.identity.value) ~= guid then
    return nil, {
      code = "REF_INVALID",
      message = "glue_item accepts only an exact Item GUID ref.",
      details = { item_ref = bounded_string(ref.ref, 160) },
    }
  end
  return { object_ref = ref, ref = ref.ref, guid = guid }, nil
end

local function alpha33_glue_item_list_items()
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then return nil end
  local items = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if not ok_item or not item then return nil end
    local guid = alpha33_glue_item_guid(item)
    if not guid then return nil end
    items[#items + 1] = { item = item, guid = guid }
  end
  return items
end

local function alpha33_glue_item_find_guid(items, guid)
  local found, matches = nil, 0
  for index = 1, #items do
    if items[index].guid == guid then
      found = items[index].item
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_glue_item_selected_tracks()
  local ok_count, count = call_reaper("CountSelectedTracks2", 0, true)
  if not ok_count then ok_count, count = call_reaper("CountSelectedTracks", 0) end
  if not ok_count then return nil end
  local tracks = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack2", 0, index, true)
    if not ok_track then ok_track, track = call_reaper("GetSelectedTrack", 0, index) end
    if not ok_track or not track then return nil end
    tracks[#tracks + 1] = track
  end
  return tracks
end

local function alpha33_glue_item_selected_items()
  local ok_count, count = call_reaper("CountSelectedMediaItems", 0)
  if not ok_count then return nil end
  local items = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
    if not ok_item or not item then return nil end
    items[#items + 1] = item
  end
  return items
end

local function alpha33_glue_item_active_snapshot(items)
  local snapshot = {}
  for index = 1, #items do
    local ok_take, take = call_reaper("GetActiveTake", items[index].item)
    if not ok_take then return nil end
    snapshot[#snapshot + 1] = { item = items[index].item, take = take }
  end
  return snapshot
end

local function alpha33_glue_item_item_exists(item, current_items)
  for index = 1, #current_items do
    if current_items[index].item == item then return true end
  end
  return false
end

local function alpha33_glue_item_clear_track_selection()
  local ok_master, master = call_reaper("GetMasterTrack", 0)
  if ok_master and master and not call_reaper("SetTrackSelected", master, false) then return false end
  local ok_count, count = call_reaper("CountTracks", 0)
  if not ok_count then return false end
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if not ok_track or not track or not call_reaper("SetTrackSelected", track, false) then return false end
  end
  return true
end

local function alpha33_glue_item_restore(snapshot, source_item, replacement_item)
  local current_items = alpha33_glue_item_list_items()
  if not current_items then return false, false end

  local track_ok = alpha33_glue_item_clear_track_selection()
  for index = 1, #snapshot.selected_tracks do
    if not call_reaper("SetTrackSelected", snapshot.selected_tracks[index], true) then track_ok = false end
  end

  local item_ok = true
  for index = 1, #current_items do
    if not call_reaper("SetMediaItemSelected", current_items[index].item, false) then item_ok = false end
  end
  for index = 1, #snapshot.selected_items do
    local selected = snapshot.selected_items[index]
    if selected == source_item then
      local restored_item = replacement_item
      if not restored_item and alpha33_glue_item_item_exists(source_item, current_items) then restored_item = source_item end
      if not restored_item or not call_reaper("SetMediaItemSelected", restored_item, true) then item_ok = false end
    elseif alpha33_glue_item_item_exists(selected, current_items) then
      if not call_reaper("SetMediaItemSelected", selected, true) then item_ok = false end
    else
      item_ok = false
    end
  end

  local active_ok = true
  for index = 1, #snapshot.active_takes do
    local saved = snapshot.active_takes[index]
    if saved.item ~= source_item and alpha33_glue_item_item_exists(saved.item, current_items) and saved.take then
      local ok_current, current_take = call_reaper("GetActiveTake", saved.item)
      if not ok_current or current_take ~= saved.take then
        if not call_reaper("SetActiveTake", saved.take) then active_ok = false end
      end
    end
  end
  return track_ok and item_ok, active_ok
end

local function alpha33_glue_item_select_only(item)
  local items = alpha33_glue_item_list_items()
  if not items then return false end
  for index = 1, #items do
    if not call_reaper("SetMediaItemSelected", items[index].item, items[index].item == item) then return false end
  end
  return true
end

local function alpha33_glue_item_source_readback(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then return nil end
  local take_guid = alpha33_glue_item_take_guid(take)
  if not take_guid then return nil end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then return nil end
  local ok_filename, filename = call_reaper("GetMediaSourceFileName", source, "")
  local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
  if not ok_filename then return nil end
  filename = first_string(filename) or ""
  source_type = ok_type and first_string(source_type) or nil
  if not source_type or source_type == "" then return nil end
  return {
    take = take,
    take_guid = take_guid,
    filename = bounded_string(filename, 512),
    source_type = bounded_string(source_type, 120),
  }
end

local function alpha33_glue_item(request)
  local exact, ref_failure = alpha33_glue_item_exact_ref(request)
  if not exact then return alpha33_glue_item_error(ref_failure.code, ref_failure.message, ref_failure.details) end

  local before_items = alpha33_glue_item_list_items()
  if not before_items then
    return alpha33_glue_item_error("COMMAND_FAILED", "glue_item could not read every Item GUID before mutation.", {}, false)
  end
  local source_item, source_matches = alpha33_glue_item_find_guid(before_items, exact.guid)
  if not source_item or source_matches ~= 1 then
    return alpha33_glue_item_error("REF_INVALID", "glue_item exact Item GUID was missing or duplicated.", {
      item_ref = exact.ref,
      duplicate_count = source_matches,
    }, false)
  end
  local ok_active, source_active_take = call_reaper("GetActiveTake", source_item)
  if not ok_active or not source_active_take then
    return alpha33_glue_item_error("TAKE_NOT_FOUND", "glue_item requires the exact Item to expose an active Take.", {
      item_ref = exact.ref,
    })
  end
  local source_track = alpha33_glue_item_owner_track(source_item)
  local source_track_guid = source_track and alpha33_glue_item_track_guid(source_track) or nil
  local source_position = alpha33_glue_item_number(source_item, "D_POSITION")
  local source_length = alpha33_glue_item_number(source_item, "D_LENGTH")
  if not source_track_guid or source_position == nil or source_length == nil then
    return alpha33_glue_item_error("COMMAND_FAILED", "glue_item could not read source Track, position, and length before mutation.", {
      item_ref = exact.ref,
    }, false)
  end
  local selected_tracks = alpha33_glue_item_selected_tracks()
  local selected_items = alpha33_glue_item_selected_items()
  local active_takes = alpha33_glue_item_active_snapshot(before_items)
  if not selected_tracks or not selected_items or not active_takes then
    return alpha33_glue_item_error("COMMAND_FAILED", "glue_item could not snapshot Track, Item, and active Take state.", {}, false)
  end
  local snapshot = {
    selected_tracks = selected_tracks,
    selected_items = selected_items,
    active_takes = active_takes,
  }
  if not alpha33_glue_item_select_only(source_item) then
    local restored_selection, restored_active = alpha33_glue_item_restore(snapshot, source_item, nil)
    return alpha33_glue_item_error("COMMAND_FAILED", "glue_item could not select only the exact Item.", {
      selection_restored = restored_selection,
      active_take_restored = restored_active,
    }, false)
  end
  if not call_reaper("SetActiveTake", source_active_take) then
    local restored_selection, restored_active = alpha33_glue_item_restore(snapshot, source_item, nil)
    return alpha33_glue_item_error("COMMAND_FAILED", "glue_item could not restore the exact Item active Take before action.", {
      selection_restored = restored_selection,
      active_take_restored = restored_active,
    }, false)
  end

  local command_ok, command_result = call_reaper("Main_OnCommandEx", ALPHA3_3_GLUE_ITEM_ACTION_ID, 0, 0)
  if not command_ok or command_result == false then
    local restored_selection, restored_active = alpha33_glue_item_restore(snapshot, source_item, nil)
    return alpha33_glue_item_error("COMMAND_FAILED", "REAPER rejected the fixed native glue action.", {
      selection_restored = restored_selection,
      active_take_restored = restored_active,
    }, false)
  end
  call_reaper("UpdateArrange")

  local after_items = alpha33_glue_item_list_items()
  local old_item_guid_absent = after_items and alpha33_glue_item_find_guid(after_items, exact.guid) == nil
  local new_candidates = {}
  if after_items then
    for index = 1, #after_items do
      local previously_seen = false
      for before_index = 1, #before_items do
        if before_items[before_index].guid == after_items[index].guid then previously_seen = true break end
      end
      if not previously_seen then new_candidates[#new_candidates + 1] = after_items[index].item end
    end
  end
  local replacement_item = #new_candidates == 1 and new_candidates[1] or nil
  local replacement_track = replacement_item and alpha33_glue_item_owner_track(replacement_item) or nil
  local replacement_track_guid = replacement_track and alpha33_glue_item_track_guid(replacement_track) or nil
  local replacement_position = replacement_item and alpha33_glue_item_number(replacement_item, "D_POSITION") or nil
  local replacement_length = replacement_item and alpha33_glue_item_number(replacement_item, "D_LENGTH") or nil
  local replacement_identity_matches = replacement_item
    and replacement_track_guid == source_track_guid
    and alpha33_glue_item_numbers_match(replacement_position, source_position)
    and alpha33_glue_item_numbers_match(replacement_length, source_length)
  local item_count_unchanged = after_items and #after_items == #before_items or false
  local source_readback = replacement_item and alpha33_glue_item_source_readback(replacement_item) or nil
  local selection_restored, active_take_restored = alpha33_glue_item_restore(snapshot, source_item, replacement_item)
  if not old_item_guid_absent then
    return alpha33_glue_item_error("VERIFY_FAILED", "The source Item GUID still exists after glue.", {
      source_item_ref = exact.ref,
      old_item_guid_absent = false,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  if #new_candidates ~= 1 or not item_count_unchanged or not replacement_identity_matches or not source_readback then
    return alpha33_glue_item_error("VERIFY_FAILED", "glue_item could not uniquely identify a new Item with readable Take source state.", {
      source_item_ref = exact.ref,
      new_item_candidate_count = #new_candidates,
      item_count_before = #before_items,
      item_count_after = after_items and #after_items or nil,
      item_count_unchanged = item_count_unchanged,
      owner_track_matches = replacement_track_guid == source_track_guid,
      position_matches = alpha33_glue_item_numbers_match(replacement_position, source_position),
      length_matches = alpha33_glue_item_numbers_match(replacement_length, source_length),
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  if not selection_restored or not active_take_restored then
    return alpha33_glue_item_error("VERIFY_FAILED", "glue_item could not restore Track, Item, or active Take state.", {
      source_item_ref = exact.ref,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end

  local glued_guid = alpha33_glue_item_guid(replacement_item)
  local glued_item_ref = glued_guid and ("item:guid:" .. glued_guid) or nil
  local glued_take_ref = "take:guid:" .. source_readback.take_guid
  return {
    kind = "item_glued",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    source_item_ref = exact.ref,
    glued_item_ref = glued_item_ref,
    glued_take_ref = glued_take_ref,
    owner_track_ref = "track:guid:" .. source_track_guid,
    position_seconds = replacement_position,
    length_seconds = replacement_length,
    source_filename = source_readback.filename,
    source_type = source_readback.source_type,
    item_count_before = #before_items,
    item_count_after = #after_items,
    item_count_unchanged = true,
    old_item_guid_absent = true,
    new_item_unique = true,
    selection_restored = true,
    active_take_restored = true,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({
    exact.object_ref,
    { kind = "item", ref = glued_item_ref, identity = { scheme = "guid", value = glued_guid } },
    { kind = "take", ref = glued_take_ref, identity = { scheme = "guid", value = source_readback.take_guid } },
  })
end
