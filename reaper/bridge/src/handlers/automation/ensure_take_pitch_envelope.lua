-- Alpha3.3 exact native Take Pitch Envelope ensure: template.automation.ensure_take_pitch_envelope.

local ALPHA3_3_ENSURE_TAKE_PITCH_ENVELOPE_ACTION_ID = 41612

local function alpha33_take_pitch_envelope_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_take_pitch_envelope_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  guid = ok and first_string(guid) or nil
  return guid and guid ~= "" and guid or nil
end

local function alpha33_take_pitch_envelope_exact_ref(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, { code = "REF_INVALID", message = "ensure_take_pitch_envelope requires exactly one exact Take ref.", details = {} }
  end
  local ref = request.refs[1]
  if not is_object(ref) or ref.kind ~= "take" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil, { code = "REF_INVALID", message = "ensure_take_pitch_envelope requires one canonical Take ref object.", details = {} }
  end
  local guid = ref.ref:match("^take:guid:([^:]+)$")
  if not guid or ref.identity.scheme ~= "guid" or tostring(ref.identity.value) ~= guid then
    return nil, {
      code = "REF_INVALID",
      message = "ensure_take_pitch_envelope accepts only an exact Take GUID ref.",
      details = { take_ref = bounded_string(ref.ref, 160) },
    }
  end
  return { object_ref = ref, ref = ref.ref, guid = guid }, nil
end

local function alpha33_take_pitch_envelope_items()
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then return nil end
  local items = {}
  local total = math.max(0, math.floor(first_number(count) or 0))
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if not ok_item or not item then return nil end
    items[#items + 1] = item
  end
  return items
end

local function alpha33_take_pitch_envelope_find(guid)
  local items = alpha33_take_pitch_envelope_items()
  if not items then return nil, nil, nil end
  local found_take, found_item, matches = nil, nil, 0
  for item_index = 1, #items do
    local ok_count, count = call_reaper("CountTakes", items[item_index])
    if not ok_count then return nil, nil, nil end
    local total = math.max(0, math.floor(first_number(count) or 0))
    for take_index = 0, total - 1 do
      local ok_take, take = call_reaper("GetTake", items[item_index], take_index)
      if not ok_take or not take then return nil, nil, nil end
      if alpha33_take_pitch_envelope_take_guid(take) == guid then
        found_take = take
        found_item = items[item_index]
        matches = matches + 1
      end
    end
  end
  return found_take, found_item, matches
end

local function alpha33_take_pitch_envelope_selected_tracks()
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

local function alpha33_take_pitch_envelope_selected_items()
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

local function alpha33_take_pitch_envelope_active_takes(items)
  local active = {}
  for index = 1, #items do
    local ok_take, take = call_reaper("GetActiveTake", items[index])
    if not ok_take then return nil end
    active[#active + 1] = { item = items[index], take = take }
  end
  return active
end

local function alpha33_take_pitch_envelope_same_pointers(actual, expected)
  if not actual or #actual ~= #expected then return false end
  for index = 1, #expected do
    if actual[index] ~= expected[index] then return false end
  end
  return true
end

local function alpha33_take_pitch_envelope_clear_tracks()
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

local function alpha33_take_pitch_envelope_clear_items(items)
  for index = 1, #items do
    if not call_reaper("SetMediaItemSelected", items[index], false) then return false end
  end
  return true
end

local function alpha33_take_pitch_envelope_select_only(item, items)
  if not alpha33_take_pitch_envelope_clear_items(items) then return false end
  return call_reaper("SetMediaItemSelected", item, true)
end

local function alpha33_take_pitch_envelope_restore(snapshot)
  local ok = alpha33_take_pitch_envelope_clear_tracks() and alpha33_take_pitch_envelope_clear_items(snapshot.items)
  for index = 1, #snapshot.selected_tracks do
    if not call_reaper("SetTrackSelected", snapshot.selected_tracks[index], true) then ok = false end
  end
  for index = 1, #snapshot.selected_items do
    if not call_reaper("SetMediaItemSelected", snapshot.selected_items[index], true) then ok = false end
  end
  local active_ok = true
  for index = 1, #snapshot.active_takes do
    local saved = snapshot.active_takes[index]
    local ok_current, current = call_reaper("GetActiveTake", saved.item)
    if not ok_current then
      active_ok = false
    elseif current ~= saved.take then
      if saved.take then
        if not call_reaper("SetActiveTake", saved.take) then active_ok = false end
      else
        active_ok = false
      end
    end
  end
  local selection_ok = ok
    and alpha33_take_pitch_envelope_same_pointers(alpha33_take_pitch_envelope_selected_tracks(), snapshot.selected_tracks)
    and alpha33_take_pitch_envelope_same_pointers(alpha33_take_pitch_envelope_selected_items(), snapshot.selected_items)
  return selection_ok, active_ok
end

local function alpha33_take_pitch_envelope_lookup(take)
  local ok, envelope = call_reaper("GetTakeEnvelopeByName", take, "Pitch")
  if not ok then return nil, false end
  return envelope, true
end

local function alpha33_take_pitch_envelope_guid(envelope)
  local ok, api_ok, guid = call_reaper("GetSetEnvelopeInfo_String", envelope, "GUID", "", false)
  if not ok or api_ok == false then return nil end
  guid = first_string(guid)
  return guid and guid ~= "" and guid or nil
end

local function alpha33_take_pitch_envelope_result(request, exact, envelope_guid, existing_before, changed)
  local envelope_ref = "envelope:guid:" .. envelope_guid
  return {
    kind = "take_pitch_envelope_ensure",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    take_ref = exact.ref,
    envelope_ref = envelope_ref,
    envelope_guid = envelope_guid,
    existing_before = existing_before,
    changed = changed,
    selection_restored = true,
    active_take_restored = true,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({
    exact.object_ref,
    { kind = "envelope", ref = envelope_ref, identity = { scheme = "guid", value = envelope_guid } },
  })
end

local function alpha33_ensure_take_pitch_envelope(request)
  local exact, ref_failure = alpha33_take_pitch_envelope_exact_ref(request)
  if not exact then return alpha33_take_pitch_envelope_error(ref_failure.code, ref_failure.message, ref_failure.details) end
  local take, item, matches = alpha33_take_pitch_envelope_find(exact.guid)
  if matches == nil then
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "ensure_take_pitch_envelope could not read every Take GUID.", {}, false)
  end
  if not take or not item or matches ~= 1 then
    return alpha33_take_pitch_envelope_error(matches == 0 and "TAKE_NOT_FOUND" or "REF_INVALID", "ensure_take_pitch_envelope exact Take GUID was missing or duplicated.", {
      take_ref = exact.ref,
      duplicate_count = matches,
    }, matches == 0)
  end
  local ok_owner, owner = call_reaper("GetMediaItemTake_Item", take)
  if not ok_owner or owner ~= item then
    return alpha33_take_pitch_envelope_error("REF_INVALID", "ensure_take_pitch_envelope Take owner readback did not match.", {
      take_ref = exact.ref,
    }, false)
  end

  local envelope, lookup_ok = alpha33_take_pitch_envelope_lookup(take)
  if not lookup_ok then
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "ensure_take_pitch_envelope could not query the Pitch envelope.", {
      take_ref = exact.ref,
    }, false)
  end
  if envelope then
    local envelope_guid = alpha33_take_pitch_envelope_guid(envelope)
    if not envelope_guid then
      return alpha33_take_pitch_envelope_error("VERIFY_FAILED", "Existing Pitch envelope did not expose a native GUID.", {
        take_ref = exact.ref,
      }, false)
    end
    return alpha33_take_pitch_envelope_result(request, exact, envelope_guid, true, false)
  end

  local items = alpha33_take_pitch_envelope_items()
  local selected_tracks = alpha33_take_pitch_envelope_selected_tracks()
  local selected_items = alpha33_take_pitch_envelope_selected_items()
  local active_takes = items and alpha33_take_pitch_envelope_active_takes(items) or nil
  if not items or not selected_tracks or not selected_items or not active_takes then
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "ensure_take_pitch_envelope could not snapshot selection and active Takes.", {}, false)
  end
  local snapshot = {
    items = items,
    selected_tracks = selected_tracks,
    selected_items = selected_items,
    active_takes = active_takes,
  }
  if not alpha33_take_pitch_envelope_select_only(item, items) or not call_reaper("SetActiveTake", take) then
    local selection_restored, active_take_restored = alpha33_take_pitch_envelope_restore(snapshot)
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "ensure_take_pitch_envelope could not target the exact Take for the native action.", {
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  local ok_active, active_take = call_reaper("GetActiveTake", item)
  if not ok_active or active_take ~= take then
    local selection_restored, active_take_restored = alpha33_take_pitch_envelope_restore(snapshot)
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "ensure_take_pitch_envelope exact Take did not become active before action.", {
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end

  local command_ok, command_result = call_reaper("Main_OnCommandEx", ALPHA3_3_ENSURE_TAKE_PITCH_ENVELOPE_ACTION_ID, 0, 0)
  if not command_ok or command_result == false then
    local selection_restored, active_take_restored = alpha33_take_pitch_envelope_restore(snapshot)
    return alpha33_take_pitch_envelope_error("COMMAND_FAILED", "REAPER rejected the fixed native Take Pitch envelope action.", {
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  call_reaper("UpdateArrange")

  local readback_envelope, readback_ok = alpha33_take_pitch_envelope_lookup(take)
  local envelope_guid = readback_envelope and alpha33_take_pitch_envelope_guid(readback_envelope) or nil
  local selection_restored, active_take_restored = alpha33_take_pitch_envelope_restore(snapshot)
  if not readback_ok or not readback_envelope or not envelope_guid then
    return alpha33_take_pitch_envelope_error("VERIFY_FAILED", "Pitch envelope or native Envelope GUID was absent after action.", {
      take_ref = exact.ref,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  if not selection_restored or not active_take_restored then
    return alpha33_take_pitch_envelope_error("VERIFY_FAILED", "ensure_take_pitch_envelope could not restore selection and active Takes.", {
      take_ref = exact.ref,
      envelope_guid = envelope_guid,
      selection_restored = selection_restored,
      active_take_restored = active_take_restored,
    }, false)
  end
  return alpha33_take_pitch_envelope_result(request, exact, envelope_guid, false, true)
end
