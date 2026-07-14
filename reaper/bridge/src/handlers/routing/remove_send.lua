-- Alpha3.3 exact native internal send deletion: template.routing.remove_send.

local function alpha33_remove_send_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function alpha33_remove_send_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function alpha33_remove_send_track_ref(track)
  local guid = alpha33_remove_send_track_guid(track)
  return guid and ("track:guid:" .. guid) or nil
end

local function alpha33_remove_send_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and alpha33_remove_send_track_guid(track) == guid then
      found = track
      matches = matches + 1
    end
  end
  return found, matches
end

local function alpha33_remove_send_exact_ref(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, {
      code = "REF_INVALID",
      message = "remove_send requires exactly one exact internal send ref.",
      details = { ref_count = is_json_array(request.refs) and #request.refs or 0 },
    }
  end
  local ref = request.refs[1]
  if not is_object(ref) or ref.kind ~= "send" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil, {
      code = "REF_INVALID",
      message = "remove_send requires one canonical send ref object.",
      details = {},
    }
  end
  local source_guid, index_text = ref.ref:match("^send:track:guid:([^:]+):(%d+)$")
  if not source_guid then
    return nil, {
      code = "REF_INVALID",
      message = "remove_send accepts only exact category-0 send refs whose source Track uses a GUID identity.",
      details = { send_ref = bounded_string(ref.ref, 160), category_allowed = 0 },
    }
  end
  local expected_value = "track:guid:" .. source_guid .. ":" .. index_text
  if ref.identity.scheme ~= "track_send" or tostring(ref.identity.value) ~= expected_value then
    return nil, {
      code = "REF_INVALID",
      message = "remove_send ref identity does not match its source Track and send index.",
      details = { send_ref = bounded_string(ref.ref, 160) },
    }
  end
  return {
    object_ref = ref,
    ref = ref.ref,
    source_guid = source_guid,
    source_ref = "track:guid:" .. source_guid,
    send_index = math.floor(tonumber(index_text)),
  }, nil
end

local function alpha33_remove_send_count(track)
  local ok, count = call_reaper("GetTrackNumSends", track, 0)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or nil
end

local function alpha33_remove_send_value(track, index, key)
  local ok, value = call_reaper("GetTrackSendInfo_Value", track, 0, index, key)
  return ok and first_number(value) or nil
end

local function alpha33_remove_send_snapshot(source_track, send_index)
  local ok_destination, destination_track = call_reaper("GetTrackSendInfo_Value", source_track, 0, send_index, "P_DESTTRACK")
  local destination_ref = ok_destination and destination_track and alpha33_remove_send_track_ref(destination_track) or nil
  if not destination_ref then
    return nil
  end
  local keys = {
    "D_VOL",
    "D_PAN",
    "D_PANLAW",
    "B_MUTE",
    "B_PHASE",
    "B_MONO",
    "I_SENDMODE",
    "I_AUTOMODE",
    "I_SRCCHAN",
    "I_DSTCHAN",
    "I_MIDIFLAGS",
  }
  local parts = { destination_ref }
  for index = 1, #keys do
    local value = alpha33_remove_send_value(source_track, send_index, keys[index])
    if value == nil then
      return nil
    end
    parts[#parts + 1] = string.format("%.17g", value)
  end
  return {
    destination_track = destination_track,
    destination_ref = destination_ref,
    fingerprint = table.concat(parts, "|"),
  }
end

local function alpha33_remove_send_fingerprint_occurrences(source_track, fingerprint, count)
  local matches = 0
  for send_index = 0, count - 1 do
    local snapshot = alpha33_remove_send_snapshot(source_track, send_index)
    if snapshot and snapshot.fingerprint == fingerprint then
      matches = matches + 1
    end
  end
  return matches
end

local function alpha33_remove_send(request)
  local exact, ref_failure = alpha33_remove_send_exact_ref(request)
  if not exact then
    return alpha33_remove_send_error(ref_failure.code, ref_failure.message, ref_failure.details)
  end
  local source_track, source_matches = alpha33_remove_send_find_track_by_guid(exact.source_guid)
  if source_matches == 0 or not source_track then
    return alpha33_remove_send_error("TRACK_NOT_FOUND", "remove_send exact source Track GUID did not resolve.", {
      source_track_ref = exact.source_ref,
    })
  end
  if source_matches ~= 1 then
    return alpha33_remove_send_error("REF_INVALID", "remove_send exact source Track GUID resolved more than once.", {
      source_track_ref = exact.source_ref,
      duplicate_count = source_matches,
    }, false)
  end
  local count_before = alpha33_remove_send_count(source_track)
  if count_before == nil then
    return alpha33_remove_send_error("COMMAND_FAILED", "remove_send could not read the complete category-0 send list.", {
      source_track_ref = exact.source_ref,
    }, false)
  end
  if exact.send_index < 0 or exact.send_index >= count_before then
    return alpha33_remove_send_error("SEND_NOT_FOUND", "remove_send exact index is outside the complete category-0 send list.", {
      send_ref = exact.ref,
      send_count = count_before,
    })
  end
  local before = alpha33_remove_send_snapshot(source_track, exact.send_index)
  if not before then
    return alpha33_remove_send_error("SEND_NOT_FOUND", "remove_send could not prove the destination identity for the exact send.", {
      send_ref = exact.ref,
    })
  end
  local destination_track, destination_matches = alpha33_remove_send_find_track_by_guid(
    before.destination_ref:match("^track:guid:(.+)$")
  )
  if destination_matches ~= 1 or destination_track ~= before.destination_track then
    return alpha33_remove_send_error("REF_INVALID", "remove_send destination Track GUID was missing or duplicated during preflight.", {
      send_ref = exact.ref,
      destination_track_ref = before.destination_ref,
      duplicate_count = destination_matches,
    }, false)
  end
  local fingerprint_matches = alpha33_remove_send_fingerprint_occurrences(source_track, before.fingerprint, count_before)
  if fingerprint_matches ~= 1 then
    return alpha33_remove_send_error("REF_INVALID", "remove_send exact routing fingerprint is duplicated and cannot be proved absent after deletion.", {
      send_ref = exact.ref,
      destination_track_ref = before.destination_ref,
      duplicate_count = fingerprint_matches,
    }, false)
  end

  local command_ok, removed = call_reaper("RemoveTrackSend", source_track, 0, exact.send_index)
  if not command_ok or removed == false then
    return alpha33_remove_send_error("COMMAND_FAILED", "REAPER rejected exact category-0 send deletion.", {
      send_ref = exact.ref,
      category = 0,
    }, false)
  end
  local count_after = alpha33_remove_send_count(source_track)
  if count_after == nil or count_after ~= count_before - 1 then
    return alpha33_remove_send_error("VERIFY_FAILED", "Category-0 send count did not decrement by exactly one.", {
      send_ref = exact.ref,
      send_count_before = count_before,
      send_count_after = count_after,
    }, false)
  end
  if alpha33_remove_send_fingerprint_occurrences(source_track, before.fingerprint, count_after) ~= 0 then
    return alpha33_remove_send_error("VERIFY_FAILED", "Deleted routing fingerprint still exists in the complete source routing list.", {
      send_ref = exact.ref,
      destination_track_ref = before.destination_ref,
    }, false)
  end
  call_reaper("TrackList_AdjustWindows", false)
  call_reaper("UpdateArrange")

  return {
    kind = "send_deleted",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    deleted_send_ref = exact.ref,
    source_track_ref = exact.source_ref,
    destination_track_ref = before.destination_ref,
    send_index = exact.send_index,
    category = 0,
    fingerprint = before.fingerprint,
    send_count_before = count_before,
    send_count_after = count_after,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({ exact.object_ref })
end
