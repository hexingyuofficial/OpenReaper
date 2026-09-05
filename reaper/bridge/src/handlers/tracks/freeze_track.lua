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

local function alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, target_track_guids)
  local current_items = alpha33_freeze_track_items()
  if not current_items then return false end
  local before_guids = {}
  for index = 1, #before_items do before_guids[before_items[index].guid] = true end
  local selected_guids = {}
  local target_mapping_needed = {}
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
      if not target_track_guids[selected.owner_track_guid] then return false end
      target_mapping_needed[selected.owner_track_guid] = true
    end
  end
  if next(target_mapping_needed) ~= nil then
    local mapped = {}
    for index = 1, #current_items do
      local current = current_items[index]
      if target_mapping_needed[current.owner_track_guid] and not before_guids[current.guid] then
        selected_guids[current.guid] = true
        mapped[current.owner_track_guid] = (mapped[current.owner_track_guid] or 0) + 1
      end
    end
    for guid in pairs(target_mapping_needed) do
      if not mapped[guid] then return false end
    end
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

local function alpha33_freeze_track_select_targets(targets)
  if not alpha33_freeze_track_clear_tracks() then return false end
  for index = 1, #targets do
    if not call_reaper("SetTrackSelected", targets[index].track, true) then return false end
  end
  return true
end

local function alpha33_freeze_track_count(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_FREEZECOUNT")
  local count = ok and first_number(value) or nil
  return count ~= nil and math.max(0, math.floor(count)) or nil
end

local function alpha33_freeze_track_binding(request)
  local params = is_object(request.params) and request.params or {}
  local binding = params.target_binding
  local has_exact_refs = is_json_array(request.refs) and #request.refs > 0
  if binding == nil then
    if has_exact_refs then return nil, nil end
    binding = {}
  end
  if not is_object(binding) then
    return nil, { code = "TARGET_BINDING_INVALID", message = "freeze_track target_binding must be an object.", details = { zero_write = true } }
  end
  local allowed = { bind_at = true, domain = true, selector = true, aggregation = true, cardinality = true }
  for key in pairs(binding) do
    if not allowed[key] then
      return nil, { code = "TARGET_BINDING_INVALID", message = "freeze_track target_binding contains an unsupported field.", details = { field = bounded_string(key, 80), zero_write = true } }
    end
  end
  local bind_at = binding.bind_at or "execution"
  local domain = binding.domain or "tracks"
  local selector = binding.selector or "selected"
  local aggregation = binding.aggregation or "batch"
  local cardinality = binding.cardinality or { minimum = 1, maximum = 64 }
  if bind_at ~= "execution" or domain ~= "tracks" or selector ~= "selected"
      or aggregation ~= "batch" or not is_object(cardinality)
      or cardinality.minimum ~= 1 or cardinality.maximum ~= 64 then
    return nil, {
      code = "TARGET_BINDING_INVALID",
      message = "freeze_track accepts only execution-time selected Track batch binding with cardinality 1-64.",
      details = { zero_write = true },
    }
  end
  for key in pairs(cardinality) do
    if key ~= "minimum" and key ~= "maximum" then
      return nil, { code = "TARGET_BINDING_INVALID", message = "freeze_track target_binding cardinality contains an unsupported field.", details = { field = bounded_string(key, 80), zero_write = true } }
    end
  end
  if has_exact_refs then
    return nil, { code = "TARGET_BINDING_INVALID", message = "freeze_track cannot combine target_binding with exact refs.", details = { zero_write = true } }
  end
  return {
    bind_at = bind_at,
    domain = domain,
    selector = selector,
    aggregation = aggregation,
    cardinality = cardinality,
  }, nil
end

local function alpha33_freeze_track_selected_targets()
  local ok_count, count = call_reaper("CountSelectedTracks", 0)
  if not ok_count then ok_count, count = call_reaper("CountSelectedTracks2", 0, false) end
  if not ok_count then return nil, "COMMAND_FAILED" end
  local total = math.max(0, math.floor(first_number(count) or 0))
  if total < 1 or total > 64 then return nil, "TARGET_BINDING_CARDINALITY_INVALID", total end
  local targets, seen = {}, {}
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack", 0, index)
    if not ok_track then ok_track, track = call_reaper("GetSelectedTrack2", 0, index, false) end
    local guid = ok_track and track and alpha33_freeze_track_guid(track) or nil
    if not guid or seen[guid] then return nil, "TARGET_BINDING_RESOLUTION_FAILED", total end
    seen[guid] = true
    targets[#targets + 1] = {
      track = track,
      guid = guid,
      ref = "track:guid:" .. guid,
      object_ref = { kind = "track", ref = "track:guid:" .. guid, identity = { scheme = "guid", value = guid } },
    }
  end
  return targets, nil, total
end

local function alpha33_freeze_track_targets(request)
  local binding, binding_failure = alpha33_freeze_track_binding(request)
  if binding_failure then return nil, nil, binding_failure end
  if binding then
    local targets, code, resolved_count = alpha33_freeze_track_selected_targets()
    if not targets then
      local message = code == "TARGET_BINDING_CARDINALITY_INVALID"
        and "freeze_track selected Track target count must be between 1 and 64."
        or "freeze_track could not resolve every selected Track to one unique GUID."
      return nil, nil, { code = code, message = message, details = { resolved_count = resolved_count, minimum = 1, maximum = 64, zero_write = true } }
    end
    return targets, "selected", nil
  end

  local exact, ref_failure = alpha33_freeze_track_exact_ref(request)
  if not exact then return nil, nil, ref_failure end
  local track, matches = alpha33_freeze_track_find(exact.guid)
  if matches == nil then
    return nil, nil, { code = "COMMAND_FAILED", message = "freeze_track could not read the complete Track list.", details = {}, recoverable = false }
  end
  if not track or matches ~= 1 then
    return nil, nil, {
      code = matches == 0 and "TRACK_NOT_FOUND" or "REF_INVALID",
      message = "freeze_track exact Track GUID was missing or duplicated.",
      details = { track_ref = exact.ref, duplicate_count = matches },
      recoverable = matches == 0,
    }
  end
  return {{ track = track, guid = exact.guid, ref = exact.ref, object_ref = exact.object_ref }}, "exact", nil
end

local function alpha33_freeze_track(request)
  local mode = is_object(request.params) and request.params.mode or nil
  local action_id = is_string(mode) and ALPHA3_3_FREEZE_TRACK_ACTION_IDS[mode] or nil
  if not action_id then
    return alpha33_freeze_track_error("PARAMS_INVALID", "freeze_track mode must be mono, stereo, or multichannel.", {
      mode = bounded_string(mode, 40),
    })
  end

  local targets, target_mode, target_failure = alpha33_freeze_track_targets(request)
  if not targets then
    return alpha33_freeze_track_error(target_failure.code, target_failure.message, target_failure.details, target_failure.recoverable)
  end
  local target_guids, target_refs, output_refs = {}, {}, {}
  for index = 1, #targets do
    local target = targets[index]
    target.count_before = alpha33_freeze_track_count(target.track)
    if target.count_before == nil then
      return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not read every I_FREEZECOUNT before mutation.", {
        track_ref = target.ref,
        zero_write = true,
      }, false)
    end
    target_guids[target.guid] = true
    target_refs[index] = target.ref
    output_refs[index] = target.object_ref
  end
  local selected_tracks = alpha33_freeze_track_selected_tracks()
  local selected_items = alpha33_freeze_track_selected_items()
  local before_items = alpha33_freeze_track_items()
  if not selected_tracks or not selected_items or not before_items then
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not snapshot Track and Item selection.", {}, false)
  end
  if not alpha33_freeze_track_select_targets(targets) then
    local restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, target_guids)
    return alpha33_freeze_track_error("COMMAND_FAILED", "freeze_track could not select exactly the frozen target set.", {
      selection_restored = restored,
    }, false)
  end

  local command_ok, command_result = call_reaper("Main_OnCommandEx", action_id, 0, 0)
  if not command_ok or command_result == false then
    local restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, target_guids)
    return alpha33_freeze_track_error("COMMAND_FAILED", "REAPER rejected the fixed native Track freeze action.", {
      mode = mode,
      selection_restored = restored,
    }, false)
  end
  call_reaper("UpdateArrange")

  local rows, verification_failure = {}, nil
  for index = 1, #targets do
    local target = targets[index]
    local readback_track, readback_matches = alpha33_freeze_track_find(target.guid)
    local count_after = readback_track and readback_matches == 1 and alpha33_freeze_track_count(readback_track) or nil
    target.count_after = count_after
    rows[index] = {
      track_ref = target.ref,
      freeze_count_before = target.count_before,
      freeze_count_after = count_after,
      verified = count_after ~= nil and count_after > target.count_before,
    }
    if not rows[index].verified and not verification_failure then
      verification_failure = { target = target, matches = readback_matches }
    end
  end
  local selection_restored = alpha33_freeze_track_restore(selected_tracks, selected_items, before_items, target_guids)
  if verification_failure then
    local target = verification_failure.target
    return alpha33_freeze_track_error("VERIFY_FAILED", "freeze_track I_FREEZECOUNT did not increase for every target after action.", {
      track_ref = target.ref,
      mode = mode,
      freeze_count_before = target.count_before,
      freeze_count_after = target.count_after,
      track_match_count = verification_failure.matches,
      target_count = #targets,
      selection_restored = selection_restored,
    }, false)
  end
  if not selection_restored then
    return alpha33_freeze_track_error("VERIFY_FAILED", "freeze_track could not restore Track and Item selection.", {
      track_ref = targets[1].ref,
      mode = mode,
      freeze_count_before = targets[1].count_before,
      freeze_count_after = targets[1].count_after,
      selection_restored = false,
    }, false)
  end

  return {
    kind = "track_frozen",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    track_ref = targets[1].ref,
    target_mode = target_mode,
    target_count = #targets,
    target_refs = json_array(target_refs),
    target_fingerprint = "track-set-v1|" .. table.concat(target_refs, "|"),
    targets = json_array(rows),
    mode = mode,
    freeze_count_before = targets[1].count_before,
    freeze_count_after = targets[1].count_after,
    selection_restored = true,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array(output_refs)
end
