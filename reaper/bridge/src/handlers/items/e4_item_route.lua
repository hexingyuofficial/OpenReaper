-- Extracted E4 item route handlers.

local function e4_item_handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e4_item_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e4_item_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.loop_source_status = "held"
  readback.truncated = false
  return readback
end

local function e4_item_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e4_item_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e4_item_track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, candidate = call_reaper("GetTrack", 0, index)
    if ok_track and candidate == track then
      return index
    end
  end
  return 0
end

local function e4_item_track_ref_string(track)
  local guid = e4_item_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e4_item_track_index(track))
end

local function e4_item_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e4_item_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e4_item_resolve_track_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^track:selected:(%d+)$")
  if selected_index then
    local ok, track = call_reaper("GetSelectedTrack", 0, tonumber(selected_index))
    return ok and track or nil
  end
  local index = token:match("^index:(%d+)$") or token:match("^track:index:(%d+)$")
  if index then
    local ok, track = call_reaper("GetTrack", 0, tonumber(index))
    return ok and track or nil
  end
  local guid = token:match("^guid:(.+)$") or token:match("^track:guid:(.+)$")
  if guid then
    return e4_item_find_track_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_track_token(ref.ref)
end

local function e4_item_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e4_item_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e4_item_guid(item)
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

local function e4_item_ref_string(item)
  local guid = e4_item_guid(item)
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

local function e4_item_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function e4_item_take_ref_string(take)
  local guid = e4_item_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  return "take:index:0"
end

local function e4_item_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and e4_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function e4_item_resolve_item_token(token)
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
    return e4_item_find_item_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_item_token(ref.ref)
end

local function e4_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = e4_item_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function e4_item_object_ref(item)
  local ref = e4_item_ref_string(item)
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

local function e4_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function e4_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function e4_item_summary_for_item(item)
  local track = e4_item_track(item)
  return {
    item_ref = e4_item_ref_string(item),
    track_ref = track and e4_item_track_ref_string(track) or JSON_NULL,
    position_seconds = e4_item_number(item, "D_POSITION"),
    length_seconds = e4_item_number(item, "D_LENGTH"),
  }
end

local function e4_item_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function e4_item_read_source(take)
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  return ok_source and source or nil
end

local function e4_item_finite_native_number(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

-- Copy responses are evidence, not best-effort display data.  These helpers
-- deliberately refuse index fallbacks so a successful copy cannot claim an
-- identity that was not read back from REAPER.
local function e4_item_strict_ref(kind, value)
  if type(value) ~= "string" or value == "" then return nil end
  return kind .. ":guid:" .. value
end

local function e4_item_strict_item_ref(item)
  return e4_item_strict_ref("item", e4_item_guid(item))
end

local function e4_item_strict_take_ref(take)
  return e4_item_strict_ref("take", e4_item_take_guid(take))
end

local function e4_item_strict_track_ref(track)
  return e4_item_strict_ref("track", e4_item_track_guid(track))
end

local function e4_item_ref_object(kind, ref)
  local value = ref and ref:match("^" .. kind .. ":guid:(.+)$")
  if not value then return nil end
  return { kind = kind, ref = ref, identity = { scheme = "guid", value = value } }
end

local function e4_item_read_strict_snapshot(item)
  local item_ref = e4_item_strict_item_ref(item)
  local take = e4_item_take(item)
  local take_ref = take and e4_item_strict_take_ref(take) or nil
  local track = e4_item_track(item)
  local track_ref = track and e4_item_strict_track_ref(track) or nil
  local ok_position, position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
  local ok_length, length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
  if not item_ref or not take or not take_ref or not track or not track_ref
      or not ok_position or not e4_item_finite_native_number(first_number(position))
      or not ok_length or not e4_item_finite_native_number(first_number(length)) or first_number(length) < 0 then
    return nil
  end
  return {
    item = item, item_ref = item_ref, track = track, track_ref = track_ref,
    active_take = take, active_take_ref = take_ref, active_take_available = true,
    position_seconds = first_number(position), length_seconds = first_number(length),
  }
end

local function e4_item_snapshot_matches(snapshot)
  local current = e4_item_read_strict_snapshot(snapshot.item)
  return current and current.item_ref == snapshot.item_ref and current.track == snapshot.track
    and current.track_ref == snapshot.track_ref and current.active_take == snapshot.active_take
    and current.active_take_ref == snapshot.active_take_ref
    and current.position_seconds == snapshot.position_seconds and current.length_seconds == snapshot.length_seconds
end

local function e4_item_read_source_footprint(source_item)
  local source_take = e4_item_take(source_item)
  if not source_take then
    return e4_item_handler_error("TAKE_NOT_FOUND", "E4 copy_item_to_track requires an active source take.", { blocker = "source_active_take_missing" })
  end
  local source = e4_item_read_source(source_take)
  if not source then
    return e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track could not read the source take media source.", { blocker = "source_media_missing" })
  end
  local ok_identity, source_identity = call_reaper("GetMediaSourceFileName", source, "")
  local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
  local ok_source_length, source_length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  local ok_item_length, item_length = call_reaper("GetMediaItemInfo_Value", source_item, "D_LENGTH")
  local ok_start, start_offset = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_STARTOFFS")
  local ok_playrate, playrate = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PLAYRATE")
  local ok_pitch, pitch = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PITCH")
  local ok_preserve, preserve = call_reaper("GetMediaItemTakeInfo_Value", source_take, "B_PPITCH")
  local canonical_path = ok_identity and READ_B_MEDIA.canonical_path(first_string(source_identity)) or nil
  if not ok_identity or not is_string(first_string(source_identity)) or not ok_type or not is_string(first_string(source_type))
      or not canonical_path or first_string(source_type) == "SECTION"
      or not ok_source_length or not e4_item_finite_native_number(first_number(source_length)) or first_number(source_length) <= 0
      or length_is_quarter_notes == true or not ok_item_length or not e4_item_finite_native_number(first_number(item_length)) or first_number(item_length) < 0
      or not ok_start or not e4_item_finite_native_number(first_number(start_offset))
      or not ok_playrate or not e4_item_finite_native_number(first_number(playrate)) or first_number(playrate) <= 0
      or not ok_pitch or not e4_item_finite_native_number(first_number(pitch))
      or not ok_preserve or (first_number(preserve) ~= 0 and first_number(preserve) ~= 1) then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not prove the complete source footprint before mutation.", {
      blocker = "source_footprint_unreadable",
    }, false)
  end
  if type(file_exists) ~= "function" or file_exists(canonical_path) ~= true then
    return e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track requires an available canonical source file.", {
      blocker = "source_file_unavailable",
    }, false)
  end
  return {
    source_take = source_take,
    source = source,
    canonical_source_path = canonical_path,
    canonical_source_identity = "file:path:" .. canonical_path,
    source_type = first_string(source_type),
    source_length_seconds = first_number(source_length),
    item_length_seconds = first_number(item_length),
    start_offset_seconds = first_number(start_offset),
    playrate = first_number(playrate),
    pitch = first_number(pitch),
    preserve_pitch = first_number(preserve),
  }
end

local function e4_item_source_matches(source, footprint)
  if not source then return false end
  local ok_identity, identity = call_reaper("GetMediaSourceFileName", source, "")
  local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
  local ok_length, source_length, quarter_notes = call_reaper("GetMediaSourceLength", source)
  local canonical_path = ok_identity and READ_B_MEDIA.canonical_path(first_string(identity)) or nil
  return canonical_path and "file:path:" .. canonical_path == footprint.canonical_source_identity
    and ok_type and first_string(source_type) == footprint.source_type
    and ok_length and first_number(source_length) == footprint.source_length_seconds and quarter_notes ~= true
end

local function e4_item_footprint_matches(take, footprint)
  local source = e4_item_read_source(take)
  if not e4_item_source_matches(source, footprint) then return false end
  local ok_start, start_offset = call_reaper("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS")
  local ok_playrate, playrate = call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE")
  local ok_pitch, pitch = call_reaper("GetMediaItemTakeInfo_Value", take, "D_PITCH")
  local ok_preserve, preserve = call_reaper("GetMediaItemTakeInfo_Value", take, "B_PPITCH")
  return ok_start and first_number(start_offset) == footprint.start_offset_seconds
    and ok_playrate and first_number(playrate) == footprint.playrate
    and ok_pitch and first_number(pitch) == footprint.pitch
    and ok_preserve and first_number(preserve) == footprint.preserve_pitch
end

local function e4_item_preflight_copy_budget(request, source_snapshot, target_track_ref, footprint)
  local budget = is_object(request.budget) and request.budget or {}
  local max_inline = math.floor(tonumber(budget.max_inline_value_bytes) or 65536)
  local new_item_ref = "item:guid:{OPENREAPER-COPY-ITEM-IDENTITY-MAX-0123456789ABCDEF}"
  local new_take_ref = "take:guid:{OPENREAPER-COPY-TAKE-IDENTITY-MAX-0123456789ABCDEF}"
  local values = {
    footprint.canonical_source_identity, footprint.source_type, source_snapshot.item_ref,
    source_snapshot.track_ref, source_snapshot.active_take_ref, target_track_ref, new_item_ref, new_take_ref,
  }
  for _, value in ipairs(values) do
    if type(value) ~= "string" or #value > max_inline then
      local file_ref_bytes = #footprint.canonical_source_identity
      local _, failure = e4_item_handler_error("RESPONSE_TOO_LARGE", "E4 copy_item_to_track source identity exceeds the inline-value budget before mutation.", {
        blocker = "source_identity_exceeds_inline_budget", file_ref_bytes = file_ref_bytes, max_inline_value_bytes = max_inline, zero_write = true,
      })
      return failure
    end
  end
  local prototype = e4_item_summary(request, {
    new_item_ref = new_item_ref, source_item_ref = source_snapshot.item_ref,
    target_track_ref = target_track_ref, active_take_ref = new_take_ref, active_take_available = true,
    position_seconds = e4_item_finite_number(request.params.position_seconds, 0), copy_depth = "active_take_footprint",
    source_footprint = { canonical_source_identity = footprint.canonical_source_identity, source_type = footprint.source_type,
      source_length_seconds = footprint.source_length_seconds, item_length_seconds = footprint.item_length_seconds,
      start_offset_seconds = footprint.start_offset_seconds, playrate = footprint.playrate, pitch = footprint.pitch,
      preserve_pitch = footprint.preserve_pitch == 1 },
    source_item = { item_ref = source_snapshot.item_ref, track_ref = source_snapshot.track_ref, position_seconds = source_snapshot.position_seconds, length_seconds = source_snapshot.length_seconds, active_take_ref = source_snapshot.active_take_ref, active_take_available = true },
    new_item = { item_ref = new_item_ref, track_ref = target_track_ref, position_seconds = e4_item_finite_number(request.params.position_seconds, 0), length_seconds = footprint.item_length_seconds, active_take_ref = new_take_ref, active_take_available = true },
  })
  local refs = json_array({ e4_item_ref_object("item", source_snapshot.item_ref), e4_item_ref_object("track", target_track_ref),
    e4_item_ref_object("item", new_item_ref), e4_item_ref_object("take", new_take_ref) })
  local fits, required_bytes, budget = READ_B_MEDIA.complete_success_envelope_fits(request, prototype, refs, { undo_opened = true, undo_closed = true, verification_status = "passed" })
  if not fits then
    local _, failure = e4_item_handler_error("RESPONSE_TOO_LARGE", "E4 copy_item_to_track complete success envelope cannot fit before mutation.", {
      blocker = "success_envelope_budget_insufficient", required_response_bytes = required_bytes, max_response_bytes = budget.max_response_bytes, zero_write = true,
    })
    return failure
  end
  return nil
end

local function e4_item_clone_active_take_footprint(footprint, target_item)
  local function destroy_unowned_source(source, failure)
    local ok_destroy = call_reaper("PCM_Source_Destroy", source)
    if ok_destroy then return failure end
    local _, cleanup_failure = e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track could not release an unowned source after failure.", {
      original_code = failure.code,
      blocker = "unowned_source_cleanup_failed",
    }, false)
    return cleanup_failure
  end
  local ok_created, created_source = call_reaper("PCM_Source_CreateFromFile", footprint.canonical_source_path)
  if not ok_created or not created_source then
    local _, failure = e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track could not create an independent source from the verified media file.", {
      blocker = "source_file_create_failed",
    }, false)
    return nil, false, failure
  end
  if not e4_item_source_matches(created_source, footprint) then
    local _, failure = e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track rejected an imported source whose footprint did not match preflight.", {
      blocker = "created_source_footprint_mismatch",
    }, false)
    return nil, false, destroy_unowned_source(created_source, failure)
  end
  local ok_take, target_take = call_reaper("AddTakeToMediaItem", target_item)
  if not ok_take or not target_take then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target take.", {}, false)
    return nil, false, destroy_unowned_source(created_source, failure)
  end
  local ok_source_set, source_set_accepted = call_reaper("SetMediaItemTake_Source", target_take, created_source)
  local ok_assigned_source, assigned_source = call_reaper("GetMediaItemTake_Source", target_take)
  local source_attached = ok_assigned_source and assigned_source == created_source
  local source_may_be_attached = source_set_accepted == true or source_attached or not ok_assigned_source
  local setter_accepted = source_set_accepted == nil or source_set_accepted == true
  if not ok_source_set or not setter_accepted or not source_attached then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not verify the assigned target take source.", { blocker = "target_source_set_failed" }, false)
    if source_may_be_attached then
      return nil, true, failure
    end
    return nil, true, destroy_unowned_source(created_source, failure)
  end
  local function set_take_value(key, value)
    local ok, accepted = call_reaper("SetMediaItemTakeInfo_Value", target_take, key, value)
    return ok and accepted == true
  end
  if not set_take_value("D_STARTOFFS", footprint.start_offset_seconds)
      or not set_take_value("D_PLAYRATE", footprint.playrate)
      or not set_take_value("D_PITCH", footprint.pitch)
      or not set_take_value("B_PPITCH", footprint.preserve_pitch) then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track REAPER rejected a target take footprint field.", { blocker = "target_take_footprint_set_failed" }, false)
    return nil, true, failure
  end
  local ok_active = call_reaper("SetActiveTake", target_take)
  if not ok_active then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not activate the target take.", { blocker = "target_active_take_set_failed" }, false)
    return nil, true, failure
  end
  local active_take = e4_item_take(target_item)
  if active_take ~= target_take or not e4_item_footprint_matches(active_take, footprint) then
    local _, failure = e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track target take did not read back with the verified source footprint.", { blocker = "target_footprint_readback_failed" }, false)
    return nil, true, failure
  end
  return target_take, true
end

local function copy_item_to_track(request)
  local source_item = e4_item_from_request_refs(request)
  if not source_item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 copy_item_to_track requires a resolvable source item ref.", {})
  end
  local target_track = e4_item_track_from_request_refs(request)
  if not target_track then
    return e4_item_handler_error("TRACK_NOT_FOUND", "E4 copy_item_to_track requires a resolvable target track ref.", {})
  end
  local source_snapshot = e4_item_read_strict_snapshot(source_item)
  local target_track_ref = e4_item_strict_track_ref(target_track)
  if not source_snapshot or not target_track_ref then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not establish canonical source or target identities before mutation.", {
      blocker = "copy_identity_unreadable",
    }, false)
  end
  local footprint, preflight_failure = e4_item_read_source_footprint(source_item)
  if preflight_failure then return nil, preflight_failure end
  if source_snapshot.length_seconds ~= footprint.item_length_seconds then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track source item changed during preflight.", { blocker = "source_snapshot_changed" }, false)
  end
  local budget_failure = e4_item_preflight_copy_budget(request, source_snapshot, target_track_ref, footprint)
  if budget_failure then return nil, budget_failure end
  local ok_item, new_item = call_reaper("AddMediaItemToTrack", target_track)
  if not ok_item or not new_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target item.", {}, false)
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local function fail_after_mutation(failure)
    local ok_delete, deleted = call_reaper("DeleteTrackMediaItem", target_track, new_item)
    if not ok_delete or deleted ~= true then
      return e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track failed and could not remove the partial target item.", { original_code = failure.code, blocker = "partial_target_cleanup_failed" }, false)
    end
    return nil, failure
  end
  local ok_position, position_set = call_reaper("SetMediaItemInfo_Value", new_item, "D_POSITION", position)
  local ok_length, length_set = call_reaper("SetMediaItemInfo_Value", new_item, "D_LENGTH", footprint.item_length_seconds)
  if not ok_position or position_set ~= true or not ok_length or length_set ~= true then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track REAPER rejected target item bounds.", { blocker = "target_item_bounds_set_failed" }, false)
    return fail_after_mutation(failure)
  end
  local target_take, _, failure = e4_item_clone_active_take_footprint(footprint, new_item)
  if failure then
    return fail_after_mutation(failure)
  end
  local ok_update = call_reaper("UpdateItemInProject", new_item)
  if not ok_update then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not update the target item.", { blocker = "target_item_update_failed" }, false)
    return fail_after_mutation(failure)
  end
  local new_snapshot = e4_item_read_strict_snapshot(new_item)
  if not new_snapshot or new_snapshot.track ~= target_track or new_snapshot.track_ref ~= target_track_ref
      or new_snapshot.position_seconds ~= position or new_snapshot.length_seconds ~= footprint.item_length_seconds
      or new_snapshot.active_take ~= target_take or not e4_item_footprint_matches(new_snapshot.active_take, footprint)
      or not e4_item_snapshot_matches(source_snapshot) or not e4_item_footprint_matches(source_snapshot.active_take, footprint) then
    local _, failure = e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track source or target readback did not preserve the verified footprint.", { blocker = "copy_footprint_readback_failed" }, false)
    return fail_after_mutation(failure)
  end
  local source_ref = e4_item_ref_object("item", source_snapshot.item_ref)
  local new_ref = e4_item_ref_object("item", new_snapshot.item_ref)
  local target_ref = e4_item_ref_object("track", target_track_ref)
  local take_ref = e4_item_ref_object("take", new_snapshot.active_take_ref)
  return e4_item_summary(request, {
    new_item_ref = new_snapshot.item_ref,
    source_item_ref = source_snapshot.item_ref,
    target_track_ref = target_track_ref,
    active_take_ref = new_snapshot.active_take_ref,
    active_take_available = true,
    position_seconds = position,
    copy_depth = "active_take_footprint",
    source_footprint = {
      canonical_source_identity = footprint.canonical_source_identity,
      source_type = footprint.source_type,
      source_length_seconds = footprint.source_length_seconds,
      item_length_seconds = footprint.item_length_seconds,
      start_offset_seconds = footprint.start_offset_seconds,
      playrate = footprint.playrate,
      pitch = footprint.pitch,
      preserve_pitch = footprint.preserve_pitch == 1,
    },
    source_item = { item_ref = source_snapshot.item_ref, track_ref = source_snapshot.track_ref,
      position_seconds = source_snapshot.position_seconds, length_seconds = source_snapshot.length_seconds,
      active_take_ref = source_snapshot.active_take_ref, active_take_available = true },
    new_item = { item_ref = new_snapshot.item_ref, track_ref = new_snapshot.track_ref,
      position_seconds = new_snapshot.position_seconds, length_seconds = new_snapshot.length_seconds,
      active_take_ref = new_snapshot.active_take_ref, active_take_available = true },
  }), nil, nil, nil, e4_item_refs(new_ref, source_ref, target_ref, take_ref)
end

local function split_item_at_time(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 split_item_at_time requires a resolvable item ref.", {})
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local start_position = e4_item_number(item, "D_POSITION")
  local length = e4_item_number(item, "D_LENGTH")
  local end_position = start_position + length
  if not (position > start_position and position < end_position) then
    return e4_item_handler_error("SPLIT_OUTSIDE_ITEM_BOUNDS", "E4 split_item_at_time requires a position inside item bounds.", {
      position_seconds = position,
      item_start_seconds = start_position,
      item_end_seconds = end_position,
    })
  end
  local ok_right, right_item = call_reaper("SplitMediaItem", item, position)
  if not ok_right or not right_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 split_item_at_time could not split the item.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  call_reaper("UpdateItemInProject", right_item)
  local left_ref = e4_item_object_ref(item)
  local right_ref = e4_item_object_ref(right_item)
  return e4_item_summary(request, {
    left_item_ref = left_ref.ref,
    right_item_ref = right_ref.ref,
    split_position_seconds = position,
    left_item = e4_item_summary_for_item(item),
    right_item = e4_item_summary_for_item(right_item),
  }), nil, nil, nil, e4_item_refs(left_ref, right_ref)
end

local function set_take_playrate(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 set_take_playrate requires a resolvable item ref.", {})
  end
  local playrate = e4_item_finite_number(request.params.playrate, 1)
  if playrate <= 0 then
    return e4_item_handler_error("PARAMS_INVALID", "E4 set_take_playrate requires playrate > 0.", {
      playrate = request.params.playrate,
    })
  end
  local take = e4_item_take(item)
  if not take then
    return e4_item_handler_error("TAKE_NOT_FOUND", "E4 set_take_playrate requires an active take.", {})
  end
  call_reaper("SetMediaItemTakeInfo_Value", take, "D_PLAYRATE", playrate)
  call_reaper("SetMediaItemTakeInfo_Value", take, "B_PPITCH", request.params.preserve_pitch == true and 1 or 0)
  call_reaper("UpdateItemInProject", item)
  local readback_playrate = e4_item_finite_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE")), 1)
  if math.abs(readback_playrate - playrate) > 0.000001 then
    return e4_item_handler_error("VERIFY_FAILED", "E4 set_take_playrate readback did not match the requested playrate.", {
      requested_playrate = playrate,
      readback_playrate = readback_playrate,
    }, false)
  end
  local item_ref = e4_item_object_ref(item)
  return e4_item_summary(request, {
    item_ref = item_ref.ref,
    playrate = readback_playrate,
    requested_playrate = playrate,
    preserve_pitch = request.params.preserve_pitch == true,
    item = e4_item_summary_for_item(item),
  }), nil, nil, nil, e4_item_refs(item_ref)
end
