-- Alpha3.3 exact native Track freeze: template.tracks.freeze_track.

local ALPHA3_3_FREEZE_TRACK_ACTION_IDS = {
  mono = 40901,
  stereo = 41223,
  multichannel = 40877,
}

local function alpha33_freeze_track_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_freeze_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_freeze_track_exact_ref(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, { code = "REF_INVALID", message = "freeze_track requires exactly one exact Track ref.", details = {} }
  end
  local ref = request.refs[1]
  if not is_object(ref) or ref.kind ~= "track" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil, { code = "REF_INVALID", message = "freeze_track requires one canonical Track ref object.", details = {} }
  end
  local guid = ref.ref:match("^track:guid:([^:]+)$")
  if not guid or ref.identity.scheme ~= "guid" or tostring(ref.identity.value) ~= guid then
    return nil, {
      code = "REF_INVALID",
      message = "freeze_track accepts only an exact Track GUID ref.",
      details = { track_ref = bounded_string(ref.ref, 160) },
    }
  end
  return { object_ref = ref, ref = ref.ref, guid = guid }, nil
end

local function alpha33_freeze_track_find(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  if not ok_count then return nil, nil end
  local found, matches = nil, 0
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if not ok_track or not track then return nil, nil end
    if alpha33_freeze_track_guid(track) == guid then
      found = track
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_freeze_track_selected_tracks()
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

local function alpha33_freeze_track_selected_items()
  local ok_count, count = call_reaper("CountSelectedMediaItems", 0)
  if not ok_count then return nil end
  local items = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
    if not ok_item or not item then return nil end
    local ok_guid, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
    local ok_track, track = call_reaper("GetMediaItemTrack", item)
    if not ok_track then ok_track, track = call_reaper("GetMediaItem_Track", item) end
    local track_guid = ok_track and track and alpha33_freeze_track_guid(track) or nil
    guid = ok_guid and first_string(guid) or nil
    if not guid or guid == "" or not track_guid then return nil end
    items[#items + 1] = { guid = guid, owner_track_guid = track_guid }
  end
  return items
end

local function alpha33_freeze_track_items()
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then return nil end
  local items = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if not ok_item or not item then return nil end
    local ok_guid, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
    local ok_track, track = call_reaper("GetMediaItemTrack", item)
    if not ok_track then ok_track, track = call_reaper("GetMediaItem_Track", item) end
    local track_guid = ok_track and track and alpha33_freeze_track_guid(track) or nil
    guid = ok_guid and first_string(guid) or nil
    if not guid or guid == "" or not track_guid then return nil end
    items[#items + 1] = { item = item, guid = guid, owner_track_guid = track_guid }
  end
  return items
end

local function alpha33_freeze_track_same_pointers(actual, expected)
  if not actual or #actual ~= #expected then return false end
  for index = 1, #expected do
    if actual[index] ~= expected[index] then return false end
  end
  return true
end

local function alpha33_freeze_track_clear_tracks()
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

local function alpha33_freeze_track_clear_items()
  local items = alpha33_freeze_track_items()
  if not items then return false end
  for index = 1, #items do
    if not call_reaper("SetMediaItemSelected", items[index].item, false) then return false end
  end
  return true
end

local function alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, target_track_guid)
  local current_items = alpha33_freeze_track_items()
  if not current_items then return false end
  local before_guids = {}
  for index = 1, #before_items do before_guids[before_items[index].guid] = true end
  local selected_guids = {}
  local target_mapping_needed = false
  for index = 1, #selected_items do
    local selected = selected_items[index]
    local found = false
    for current_index = 1, #current_items do
      if current_items[current_index].guid == selected.guid then
        selected_guids[selected.guid] = true
        found = true
        break
      end
    end
    if not found then
      if selected.owner_track_guid ~= target_track_guid then return false end
      target_mapping_needed = true
    end
  end
  if target_mapping_needed then
    local mapped = 0
    for index = 1, #current_items do
      local current = current_items[index]
      if current.owner_track_guid == target_track_guid and not before_guids[current.guid] then
        selected_guids[current.guid] = true
        mapped = mapped + 1
      end
    end
    if mapped == 0 then return false end
  end

  local ok = alpha33_freeze_track_clear_tracks() and alpha33_freeze_track_clear_items()
  for index = 1, #selected_tracks do
    if not call_reaper("SetTrackSelected", selected_tracks[index], true) then ok = false end
  end
  for index = 1, #current_items do
    if selected_guids[current_items[index].guid] and not call_reaper("SetMediaItemSelected", current_items[index].item, true) then
      ok = false
    end
  end
  local current_tracks = alpha33_freeze_track_selected_tracks()
  local current_selected = alpha33_freeze_track_selected_items()
  local expected_count = 0
  for _ in pairs(selected_guids) do expected_count = expected_count + 1 end
  local selected_match = current_selected and #current_selected == expected_count
  if selected_match then
    for index = 1, #current_selected do
      if not selected_guids[current_selected[index].guid] then selected_match = false break end
    end
  end
  return ok
    and alpha33_freeze_track_same_pointers(current_tracks, selected_tracks)
    and selected_match
end

local function alpha33_freeze_track_select_only(track)
  return alpha33_freeze_track_clear_tracks() and call_reaper("SetTrackSelected", track, true)
end

local function alpha33_freeze_track_count(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_FREEZECOUNT")
  local count = ok and first_number(value) or nil
  return count ~= nil and math.max(0, math.floor(count)) or nil
end

local function alpha33_freeze_track(request)
  local exact, ref_failure = alpha33_freeze_track_exact_ref(request)
  if not exact then return alpha33_freeze_track_error(ref_failure.code, ref_failure.message, ref_failure.details) end
  local mode = is_object(request.params) and request.params.mode or nil
  local action_id = is_string(mode) and ALPHA3_3_FREEZE_TRACK_ACTION_IDS[mode] or nil
  if not action_id then
    return alpha33_freeze_track_error("PARAMS_INVALID", "freeze_track mode must be mono, stereo, or multichannel.", {
      mode = bounded_string(mode, 40),
    })
  end

  local track, matches = alpha33_freeze_track_find(exact.guid)
  if matches == nil then
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not read the complete Track list.", {}, false)
  end
  if not track or matches ~= 1 then
    return alpha33_freeze_track_error(matches == 0 and "TRACK_NOT_FOUND" or "REF_INVALID", "freeze_track exact Track GUID was missing or duplicated.", {
      track_ref = exact.ref,
      duplicate_count = matches,
    }, matches == 0)
  end
  local count_before = alpha33_freeze_track_count(track)
  if count_before == nil then
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not read I_FREEZECOUNT before mutation.", {
      track_ref = exact.ref,
    }, false)
  end
  local selected_tracks = alpha33_freeze_track_selected_tracks()
  local selected_items = alpha33_freeze_track_selected_items()
  local before_items = alpha33_freeze_track_items()
  if not selected_tracks or not selected_items or not before_items then
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not snapshot Track and Item selection.", {}, false)
  end
  if not alpha33_freeze_track_select_only(track) then
    local restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, exact.guid)
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not select only the exact Track.", {
      selection_restored = restored,
    }, false)
  end

  local command_ok, command_result = call_reaper("Main_OnCommandEx", action_id, 0, 0)
  if not command_ok or command_result == false then
    local restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, exact.guid)
    return alpha33_freeze_track_error("COMMAND_FAILED", "REAPER rejected the fixed native Track freeze action.", {
      mode = mode,
      selection_restored = restored,
    }, false)
  end
  call_reaper("UpdateArrange")

  local readback_track, readback_matches = alpha33_freeze_track_find(exact.guid)
  local count_after = readback_track and readback_matches == 1 and alpha33_freeze_track_count(readback_track) or nil
  local selection_restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, exact.guid)
  if not readback_track or readback_matches ~= 1 or count_after == nil or count_after <= count_before then
    return alpha33_freeze_track_error("VERIFY_FAILED", "freeze_track I_FREEZECOUNT did not increase after action.", {
      track_ref = exact.ref,
      mode = mode,
      freeze_count_before = count_before,
      freeze_count_after = count_after,
      track_match_count = readback_matches,
      selection_restored = selection_restored,
    }, false)
  end
  if not selection_restored then
    return alpha33_freeze_track_error("VERIFY_FAILED", "freeze_track could not restore Track and Item selection.", {
      track_ref = exact.ref,
      mode = mode,
      freeze_count_before = count_before,
      freeze_count_after = count_after,
      selection_restored = false,
    }, false)
  end

  return {
    kind = "track_frozen",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    track_ref = exact.ref,
    mode = mode,
    freeze_count_before = count_before,
    freeze_count_after = count_after,
    selection_restored = true,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({ exact.object_ref })
end
