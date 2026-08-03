-- Extracted E4 item route handlers.

local function e4_item_monotonic_now()
  if reaper and type(reaper.time_precise) == "function" then
    return reaper.time_precise()
  end
  return os.clock()
end

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

local function e4_item_probe_file_source_length(canonical_path, expected_type)
  local ok_created, probe_source = call_reaper("PCM_Source_CreateFromFile", canonical_path)
  if not ok_created or not probe_source then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not probe the canonical source file length.", {
      blocker = "source_length_probe_create_failed",
    }, false)
  end
  local ok_identity, identity = call_reaper("GetMediaSourceFileName", probe_source, "")
  local ok_type, source_type = call_reaper("GetMediaSourceType", probe_source, "")
  local ok_length, source_length, quarter_notes = call_reaper("GetMediaSourceLength", probe_source)
  local probe_path = ok_identity and READ_B_MEDIA.canonical_path(first_string(identity)) or nil
  local length = ok_length and first_number(source_length) or nil
  local matches = probe_path == canonical_path and ok_type and first_string(source_type) == expected_type
    and e4_item_finite_native_number(length) and length > 0 and quarter_notes ~= true
  local ok_destroy = call_reaper("PCM_Source_Destroy", probe_source)
  if not ok_destroy then
    return e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track could not release its source-length probe.", {
      blocker = "source_length_probe_cleanup_failed",
    }, false)
  end
  if not matches then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track canonical source probe did not match the attached source.", {
      blocker = "source_length_probe_mismatch",
    }, false)
  end
  return length
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

-- The native copy API is the only supported way to carry an arbitrary Take FX
-- state. Snapshot the bounded observable state first so the copy is not claimed
-- when REAPER cannot prove the source or final chain.
local E4_ITEM_COPY_MAX_TAKE_FX = 64
local E4_ITEM_COPY_MAX_FX_PARAMETERS = 512

local function e4_item_read_take_fx_snapshot(take)
  local ok_count, count = call_reaper("TakeFX_GetCount", take)
  count = ok_count and first_number(count) or nil
  if type(count) ~= "number" or count < 0 or count ~= math.floor(count) then
    return nil, "take_fx_count_unreadable"
  end
  if count > E4_ITEM_COPY_MAX_TAKE_FX then
    return nil, "take_fx_count_exceeds_limit"
  end
  local chain = json_array({})
  for fx_index = 0, count - 1 do
    local ok_name, _, name = call_reaper("TakeFX_GetFXName", take, fx_index, "")
    local ok_enabled, enabled = call_reaper("TakeFX_GetEnabled", take, fx_index)
    local ok_param_count, param_count = call_reaper("TakeFX_GetNumParams", take, fx_index)
    param_count = ok_param_count and first_number(param_count) or nil
    if not ok_name or not is_string(first_string(name)) or not ok_enabled or type(enabled) ~= "boolean"
        or type(param_count) ~= "number" or param_count < 0 or param_count ~= math.floor(param_count)
        or param_count > E4_ITEM_COPY_MAX_FX_PARAMETERS then
      return nil, "take_fx_state_unreadable"
    end
    local parameters = json_array({})
    for param_index = 0, param_count - 1 do
      local ok_param_name, _, param_name = call_reaper("TakeFX_GetParamName", take, fx_index, param_index, "")
      local ok_ident, _, ident = call_reaper("TakeFX_GetParamIdent", take, fx_index, param_index, "")
      local ok_value, value = call_reaper("TakeFX_GetParamNormalized", take, fx_index, param_index)
      if not ok_param_name or not is_string(first_string(param_name))
          or not ok_ident or not is_string(first_string(ident))
          or not ok_value or not e4_item_finite_native_number(first_number(value)) then
        return nil, "take_fx_parameter_unreadable"
      end
      parameters[#parameters + 1] = {
        name = first_string(param_name),
        ident = first_string(ident),
        normalized_value = first_number(value),
      }
    end
    chain[#chain + 1] = {
      name = first_string(name),
      enabled = enabled,
      parameters = parameters,
    }
  end
  return { fx_count = count, chain = chain }
end

local function e4_item_take_fx_snapshot_matches(take, expected)
  local actual = e4_item_read_take_fx_snapshot(take)
  if not actual or not expected or actual.fx_count ~= expected.fx_count
      or #actual.chain ~= #expected.chain then return false end
  for index = 1, #expected.chain do
    local expected_fx, actual_fx = expected.chain[index], actual.chain[index]
    if expected_fx.name ~= actual_fx.name or expected_fx.enabled ~= actual_fx.enabled
        or #expected_fx.parameters ~= #actual_fx.parameters then
      return false
    end
    for param_index = 1, #expected_fx.parameters do
      local expected_parameter, actual_parameter = expected_fx.parameters[param_index], actual_fx.parameters[param_index]
      if expected_parameter.name ~= actual_parameter.name or expected_parameter.ident ~= actual_parameter.ident
          or expected_parameter.normalized_value ~= actual_parameter.normalized_value then return false end
    end
  end
  return true
end

local function e4_item_copy_take_fx_snapshot(source_take, target_take, snapshot)
  for fx_index = 0, snapshot.fx_count - 1 do
    local ok_copy = call_reaper("TakeFX_CopyToTake", source_take, fx_index, target_take, fx_index, false)
    if not ok_copy then return false end
  end
  return e4_item_take_fx_snapshot_matches(target_take, snapshot)
end

-- Keep success evidence compact but exact about the visible ordered identity of
-- the copied chain. Full parameter state remains in the verified snapshot.
local function e4_item_take_fx_evidence(snapshot)
  local ordered_chain = json_array({})
  for index = 1, #snapshot.chain do
    local fx = snapshot.chain[index]
    local parameter_names, parameter_idents = json_array({}), json_array({})
    for parameter_index = 1, #fx.parameters do
      local parameter = fx.parameters[parameter_index]
      parameter_names[#parameter_names + 1] = parameter.name
      parameter_idents[#parameter_idents + 1] = parameter.ident
    end
    ordered_chain[#ordered_chain + 1] = {
      name = fx.name,
      enabled = fx.enabled,
      parameter_count = #fx.parameters,
      parameter_names = parameter_names,
      parameter_idents = parameter_idents,
    }
  end
  return {
    source_fx_count = snapshot.fx_count,
    target_fx_count = snapshot.fx_count,
    ordered_chain = ordered_chain,
  }
end

local function e4_item_take_fx_ref_string(take_ref, slot_index)
  return "fx:" .. take_ref .. ":" .. tostring(slot_index)
end

local function e4_item_take_fx_object_ref(take_ref, slot_index, name)
  local ref = e4_item_take_fx_ref_string(take_ref, slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = { scheme = "take_fx", value = take_ref .. ":" .. tostring(slot_index) },
    display = { name = name, owner_ref = take_ref, slot_index = slot_index },
  }
end

local function e4_item_take_fx_copy_evidence(snapshot, source_take_ref, target_take_ref)
  local slots = json_array({})
  for index = 1, #snapshot.chain do
    local fx = snapshot.chain[index]
    local slot_index = index - 1
    local parameter_names, parameter_idents = json_array({}), json_array({})
    for parameter_index = 1, #fx.parameters do
      local parameter = fx.parameters[parameter_index]
      parameter_names[#parameter_names + 1] = parameter.name
      parameter_idents[#parameter_idents + 1] = parameter.ident
    end
    slots[#slots + 1] = {
      slot_index = slot_index,
      source_fx_ref = e4_item_take_fx_ref_string(source_take_ref, slot_index),
      target_fx_ref = e4_item_take_fx_ref_string(target_take_ref, slot_index),
      name = fx.name,
      enabled = fx.enabled,
      parameter_count = #fx.parameters,
      parameter_names = parameter_names,
      parameter_idents = parameter_idents,
    }
  end
  return {
    status = "passed",
    source_take_ref = source_take_ref,
    target_take_ref = target_take_ref,
    source_count = snapshot.fx_count,
    copied_count = snapshot.fx_count,
    slots = slots,
  }
end

local function e4_item_take_fx_refs(take_ref, snapshot)
  local refs = json_array({})
  for index = 1, #snapshot.chain do
    refs[#refs + 1] = e4_item_take_fx_object_ref(take_ref, index - 1, snapshot.chain[index].name)
  end
  return refs
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
  local source_type_value = ok_type and first_string(source_type) or nil
  local source_length_value = ok_source_length and first_number(source_length) or nil
  if canonical_path and source_type_value and source_type_value ~= "SECTION"
      and type(file_exists) == "function" and file_exists(canonical_path) == true
      and ok_source_length and e4_item_finite_native_number(source_length_value)
      and source_length_value <= 0 and length_is_quarter_notes ~= true then
    local probed_length, probe_failure = e4_item_probe_file_source_length(canonical_path, source_type_value)
    if probe_failure then return nil, probe_failure end
    source_length = probed_length
    source_length_value = probed_length
    length_is_quarter_notes = false
  end
  local unreadable_fields = json_array({})
  local unreadable_reasons = {}
  local function mark_unreadable(condition, field)
    if condition then unreadable_fields[#unreadable_fields + 1] = field end
  end
  mark_unreadable(not ok_identity or not is_string(first_string(source_identity)), "source_identity")
  mark_unreadable(ok_identity and is_string(first_string(source_identity)) and not canonical_path, "source_path")
  mark_unreadable(not ok_type or not is_string(first_string(source_type)), "source_type")
  mark_unreadable(ok_type and first_string(source_type) == "SECTION", "source_type_section")
  mark_unreadable(not ok_source_length or not e4_item_finite_native_number(source_length_value) or (source_length_value or 0) <= 0, "source_length")
  mark_unreadable(length_is_quarter_notes == true, "source_length_quarter_notes")
  mark_unreadable(not ok_item_length or not e4_item_finite_native_number(first_number(item_length)) or (first_number(item_length) or -1) < 0, "item_length")
  mark_unreadable(not ok_start or not e4_item_finite_native_number(first_number(start_offset)), "start_offset")
  mark_unreadable(not ok_playrate or not e4_item_finite_native_number(first_number(playrate)) or (first_number(playrate) or 0) <= 0, "playrate")
  mark_unreadable(not ok_pitch or not e4_item_finite_native_number(first_number(pitch)), "pitch")
  mark_unreadable(not ok_preserve or (first_number(preserve) ~= 0 and first_number(preserve) ~= 1), "preserve_pitch")
  if #unreadable_fields > 0 then
    if not ok_source_length or not e4_item_finite_native_number(source_length_value) or (source_length_value or 0) <= 0 then
      unreadable_reasons.source_length = {
        call_ok = ok_source_length == true,
        value_type = type(source_length),
        value = e4_item_finite_native_number(source_length_value) and source_length_value or JSON_NULL,
        error = not ok_source_length and tostring(source_length):sub(1, 160) or JSON_NULL,
        quarter_notes_type = type(length_is_quarter_notes),
        quarter_notes = type(length_is_quarter_notes) == "boolean" and length_is_quarter_notes or JSON_NULL,
      }
    end
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not prove the complete source footprint before mutation.", {
      blocker = "source_footprint_unreadable",
      unreadable_fields = unreadable_fields,
      unreadable_reasons = unreadable_reasons,
    }, false)
  end
  if type(file_exists) ~= "function" or file_exists(canonical_path) ~= true then
    return e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track requires an available canonical source file.", {
      blocker = "source_file_unavailable",
    }, false)
  end
  local take_fx, take_fx_failure = e4_item_read_take_fx_snapshot(source_take)
  if take_fx_failure then
    return e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not prove the complete active Take FX state before mutation.", {
      blocker = take_fx_failure,
    }, false)
  end
  return {
    source_take = source_take,
    source = source,
    canonical_source_path = canonical_path,
    canonical_source_identity = "file:path:" .. canonical_path,
    source_type = source_type_value,
    source_length_seconds = source_length_value,
    item_length_seconds = first_number(item_length),
    start_offset_seconds = first_number(start_offset),
    playrate = first_number(playrate),
    pitch = first_number(pitch),
    preserve_pitch = first_number(preserve),
    take_fx = take_fx,
  }
end

local function e4_item_source_matches(source, footprint, allow_attached_zero_length)
  if not source then return false end
  local ok_identity, identity = call_reaper("GetMediaSourceFileName", source, "")
  local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
  local ok_length, source_length, quarter_notes = call_reaper("GetMediaSourceLength", source)
  local canonical_path = ok_identity and READ_B_MEDIA.canonical_path(first_string(identity)) or nil
  local length = ok_length and first_number(source_length) or nil
  local length_matches = e4_item_finite_native_number(length) and length == footprint.source_length_seconds
  if not length_matches and allow_attached_zero_length == true then
    length_matches = source == footprint.source and length == 0 and quarter_notes ~= true
  end
  return canonical_path and "file:path:" .. canonical_path == footprint.canonical_source_identity
    and ok_type and first_string(source_type) == footprint.source_type
    and ok_length and length_matches and quarter_notes ~= true
end

local function e4_item_footprint_matches(take, footprint, allow_attached_zero_length)
  local source = e4_item_read_source(take)
  if not e4_item_source_matches(source, footprint, allow_attached_zero_length) then return false end
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
      preserve_pitch = footprint.preserve_pitch == 1, take_fx = e4_item_take_fx_evidence(footprint.take_fx) },
    take_fx_copy = e4_item_take_fx_copy_evidence(footprint.take_fx, source_snapshot.active_take_ref, new_take_ref),
    source_item = { item_ref = source_snapshot.item_ref, track_ref = source_snapshot.track_ref, position_seconds = source_snapshot.position_seconds, length_seconds = source_snapshot.length_seconds, active_take_ref = source_snapshot.active_take_ref, active_take_available = true },
    new_item = { item_ref = new_item_ref, track_ref = target_track_ref, position_seconds = e4_item_finite_number(request.params.position_seconds, 0), length_seconds = footprint.item_length_seconds, active_take_ref = new_take_ref, active_take_available = true },
  })
  local refs = json_array({ e4_item_ref_object("item", source_snapshot.item_ref), e4_item_ref_object("track", target_track_ref),
    e4_item_ref_object("item", new_item_ref), e4_item_ref_object("take", new_take_ref) })
  local target_fx_refs = e4_item_take_fx_refs(new_take_ref, footprint.take_fx)
  for index = 1, #target_fx_refs do refs[#refs + 1] = target_fx_refs[index] end
  local fits, required_bytes, budget = READ_B_MEDIA.complete_success_envelope_fits(request, prototype, refs, { undo_opened = true, undo_closed = true, verification_status = "passed" })
  if not fits then
    local _, failure = e4_item_handler_error("RESPONSE_TOO_LARGE", "E4 copy_item_to_track complete success envelope cannot fit before mutation.", {
      blocker = "success_envelope_budget_insufficient", required_response_bytes = required_bytes, max_response_bytes = budget.max_response_bytes, zero_write = true,
    })
    return failure
  end
  return nil
end

local function e4_item_clone_active_take_footprint(footprint, target_item, source_entry)
  local source_is_reused = source_entry and source_entry.source ~= nil
  local created_source = source_is_reused and source_entry.source or nil
  local function destroy_unowned_source(source, failure)
    if source_entry and source_entry.attached == true then
      return failure
    end
    local ok_destroy = call_reaper("PCM_Source_Destroy", source)
    if ok_destroy then return failure end
    local _, cleanup_failure = e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track could not release an unowned source after failure.", {
      original_code = failure.code,
      blocker = "unowned_source_cleanup_failed",
    }, false)
    return cleanup_failure
  end
  if not source_is_reused then
    local ok_created
    ok_created, created_source = call_reaper("PCM_Source_CreateFromFile", footprint.canonical_source_path)
    if not ok_created or not created_source then
      local _, failure = e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track could not create an independent source from the verified media file.", {
        blocker = "source_file_create_failed",
      }, false)
      return nil, false, failure
    end
  end
  if not source_is_reused and not e4_item_source_matches(created_source, footprint) then
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
  local attachment, attachment_failure = READ_B_MEDIA.attach_take_source(target_take, created_source, {
    item = target_item,
    allow_zero_length = true,
    update_item = false,
    refresh_arrange = false,
  })
  if not attachment then
    local details = attachment_failure and attachment_failure.details or {}
    if details.source_attached == true or details.source_ownership_unknown == true then
      if source_entry then source_entry.attached = true end
      return nil, true, attachment_failure
    end
    return nil, true, destroy_unowned_source(created_source, attachment_failure)
  end
  if source_entry then source_entry.attached = true end
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
  if not e4_item_copy_take_fx_snapshot(footprint.source_take, target_take, footprint.take_fx) then
    local _, failure = e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track could not copy and read back the complete active Take FX state.", {
      blocker = "target_take_fx_copy_or_readback_failed",
    }, false)
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
  if source_entry then source_entry.attached = true end
  return target_take, true
end

local function e4_item_release_unattached_batch_source(source_entry, failure)
  if not source_entry or source_entry.attached == true then return failure end
  local ok_destroy = call_reaper("PCM_Source_Destroy", source_entry.source)
  if ok_destroy then return failure end
  local _, cleanup_failure = e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track could not release an unowned batch source after failure.", {
    original_code = failure.code,
    blocker = "unowned_source_cleanup_failed",
    source_key = source_entry.source_key,
  }, false)
  return cleanup_failure
end

local function copy_item_to_track_prepared(request, source_snapshot, target_track, target_track_ref, footprint, phase_timings, source_entry)
  local native_started = e4_item_monotonic_now()
  local function record_native_phase()
    if phase_timings then
      phase_timings.mutation_ms = phase_timings.mutation_ms + ((e4_item_monotonic_now() - native_started) * 1000)
    end
  end
  local ok_item, new_item = call_reaper("AddMediaItemToTrack", target_track)
  if not ok_item or not new_item then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target item.", {}, false)
    record_native_phase()
    return nil, e4_item_release_unattached_batch_source(source_entry, failure)
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
    record_native_phase()
    failure = e4_item_release_unattached_batch_source(source_entry, failure)
    return fail_after_mutation(failure)
  end
  local target_take, _, failure = e4_item_clone_active_take_footprint(footprint, new_item, source_entry)
  if failure then
    record_native_phase()
    return fail_after_mutation(failure)
  end
  local refreshed, refresh_reason = READ_B_MEDIA.refresh_item(new_item, true)
  if not refreshed then
    local _, failure = e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not update the target item.", { blocker = "target_item_update_failed" }, false)
    failure.details.blocker = refresh_reason or failure.details.blocker
    record_native_phase()
    return fail_after_mutation(failure)
  end
  record_native_phase()
  local readback_started = e4_item_monotonic_now()
  local function record_readback_phase()
    if phase_timings then
      phase_timings.readback_ms = phase_timings.readback_ms + ((e4_item_monotonic_now() - readback_started) * 1000)
    end
  end
  local new_snapshot = e4_item_read_strict_snapshot(new_item)
  if not new_snapshot or new_snapshot.track ~= target_track or new_snapshot.track_ref ~= target_track_ref
      or new_snapshot.position_seconds ~= position or new_snapshot.length_seconds ~= footprint.item_length_seconds
      or new_snapshot.active_take ~= target_take or not e4_item_footprint_matches(new_snapshot.active_take, footprint)
      or not e4_item_take_fx_snapshot_matches(new_snapshot.active_take, footprint.take_fx)
      or not e4_item_snapshot_matches(source_snapshot) or not e4_item_footprint_matches(source_snapshot.active_take, footprint, true)
      or not e4_item_take_fx_snapshot_matches(source_snapshot.active_take, footprint.take_fx) then
    local _, failure = e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track source or target readback did not preserve the verified footprint.", { blocker = "copy_footprint_readback_failed" }, false)
    record_readback_phase()
    return fail_after_mutation(failure)
  end
  record_readback_phase()
  local source_ref = e4_item_ref_object("item", source_snapshot.item_ref)
  local new_ref = e4_item_ref_object("item", new_snapshot.item_ref)
  local target_ref = e4_item_ref_object("track", target_track_ref)
  local take_ref = e4_item_ref_object("take", new_snapshot.active_take_ref)
  local target_fx_refs = e4_item_take_fx_refs(new_snapshot.active_take_ref, footprint.take_fx)
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
      take_fx = e4_item_take_fx_evidence(footprint.take_fx),
    },
    take_fx_copy = e4_item_take_fx_copy_evidence(footprint.take_fx, source_snapshot.active_take_ref, new_snapshot.active_take_ref),
    source_item = { item_ref = source_snapshot.item_ref, track_ref = source_snapshot.track_ref,
      position_seconds = source_snapshot.position_seconds, length_seconds = source_snapshot.length_seconds,
      active_take_ref = source_snapshot.active_take_ref, active_take_available = true },
    new_item = { item_ref = new_snapshot.item_ref, track_ref = new_snapshot.track_ref,
      position_seconds = new_snapshot.position_seconds, length_seconds = new_snapshot.length_seconds,
      active_take_ref = new_snapshot.active_take_ref, active_take_available = true },
  }), nil, nil, nil, e4_item_refs(new_ref, source_ref, target_ref, take_ref, table.unpack(target_fx_refs)), new_item, target_take
end

local function copy_item_to_track_single(request)
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
  return copy_item_to_track_prepared(request, source_snapshot, target_track, target_track_ref, footprint)
end

local E4_ITEM_COPY_BATCH_MAX_ROWS = 64
local E4_ITEM_COPY_BATCH_CHUNK_SIZE = 128

local function e4_item_batch_source_key(footprint)
  return table.concat({
    footprint.canonical_source_identity,
    footprint.source_type,
    tostring(footprint.source_length_seconds),
  }, "|")
end

-- SetMediaItemTake_Source binds the source to the target Take.  A source
-- handle must therefore be created per target; reusing one handle across
-- Takes can leave REAPER blocked after the first attachment.
local function e4_item_batch_prepare_source(footprint)
  local key = e4_item_batch_source_key(footprint)
  local ok_created, source = call_reaper("PCM_Source_CreateFromFile", footprint.canonical_source_path)
  if not ok_created or not source then
    return nil, e4_item_handler_error("FILE_NOT_FOUND", "E4 copy_item_to_track batch could not create the verified media source.", {
      blocker = "source_file_create_failed",
      source_key = key,
      zero_write = true,
    }, false)
  end
  if not e4_item_source_matches(source, footprint) then
    local ok_destroy = call_reaper("PCM_Source_Destroy", source)
    if not ok_destroy then
      return nil, e4_item_handler_error("RESTORE_FAILED", "E4 copy_item_to_track batch could not release a mismatched source.", {
        blocker = "unowned_source_cleanup_failed",
        original_code = "VERIFY_FAILED",
        source_key = key,
        zero_write = true,
      }, false)
    end
    return nil, e4_item_handler_error("VERIFY_FAILED", "E4 copy_item_to_track batch rejected an imported source whose footprint did not match preflight.", {
      blocker = "created_source_footprint_mismatch",
      source_key = key,
      zero_write = true,
    }, false)
  end
  local entry = { source = source, attached = false, source_key = key }
  return entry, true
end

local function e4_item_batch_error(code, message, row_index, extra)
  local details = extra or {}
  details.zero_write = true
  if row_index then details.row_index = row_index end
  return e4_item_handler_error(code, message, details)
end

local function e4_item_batch_row_request(request, row)
  return {
    pack = request.pack,
    params = { position_seconds = row.position_seconds },
    refs = json_array({
      e4_item_ref_object("item", row.source_item_ref),
      e4_item_ref_object("track", row.target_track_ref),
    }),
    budget = request.budget,
    bridge = request.bridge,
    operation = request.operation,
  }
end

local function e4_item_validate_batch_rows(request)
  local batch = request.params and request.params.batch or nil
  if not is_json_array(batch) then
    return e4_item_handler_error("PARAMS_INVALID", "E4 copy_item_to_track batch requires a JSON array payload.", { zero_write = true })
  end
  if #batch < 1 or #batch > E4_ITEM_COPY_BATCH_MAX_ROWS then
    return e4_item_handler_error("BATCH_LIMIT_EXCEEDED", "E4 copy_item_to_track batch accepts 1-64 rows.", {
      row_count = #batch,
      max_rows = E4_ITEM_COPY_BATCH_MAX_ROWS,
      zero_write = true,
    })
  end
  local ids = {}
  local rows = json_array({})
  for index = 1, #batch do
    local row = batch[index]
    if not is_object(row) then
      return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch rows must be objects.", index)
    end
    for key in pairs(row) do
      if key ~= "id" and key ~= "source_item_ref" and key ~= "target_track_ref"
          and key ~= "position_seconds" and key ~= "source_offset_seconds" then
        return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch row contains an unsupported field.", index, { field = key })
      end
    end
    if not is_string(row.id) or #row.id > 12 or not row.id:match("^[A-Za-z0-9_-]+$") or ids[row.id] then
      return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch row id must be unique and bounded.", index)
    end
    ids[row.id] = true
    if not e4_item_ref_object("item", row.source_item_ref) or not e4_item_ref_object("track", row.target_track_ref) then
      return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch rows require exact Item and Track GUID refs.", index)
    end
    if not e4_item_finite_native_number(row.position_seconds) or row.position_seconds < 0 then
      return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch position_seconds must be finite and non-negative.", index)
    end
    if row.source_offset_seconds ~= nil
        and (not e4_item_finite_native_number(row.source_offset_seconds) or row.source_offset_seconds < 0) then
      return e4_item_batch_error("PARAMS_INVALID", "E4 copy_item_to_track batch source_offset_seconds must be finite and non-negative.", index)
    end
    rows[#rows + 1] = {
      id = row.id,
      source_item_ref = row.source_item_ref,
      target_track_ref = row.target_track_ref,
      position_seconds = row.position_seconds,
      source_offset_seconds = row.source_offset_seconds,
    }
  end
  return rows
end

local function e4_item_batch_preflight_budget(request, prepared_rows)
  local budget = is_object(request.budget) and request.budget or {}
  local max_response = math.floor(tonumber(budget.max_response_bytes) or 65536)
  local max_inline = math.floor(tonumber(budget.max_inline_value_bytes) or 65536)
  local required = 4096
  local unique_sources = {}
  local unique_source_count = 0
  local unique_fx_slots = 0
  for index = 1, #prepared_rows do
    local prepared = prepared_rows[index]
    local footprint = prepared.footprint
    if #footprint.canonical_source_identity + #prepared.row.source_item_ref + #prepared.row.target_track_ref > max_inline then
      return e4_item_handler_error("RESPONSE_TOO_LARGE", "E4 copy_item_to_track batch source identity exceeds the inline-value budget before mutation.", {
        blocker = "source_identity_exceeds_inline_budget",
        row_index = index,
        max_inline_value_bytes = max_inline,
        zero_write = true,
      })
    end
    -- The batch result is compact per row. A complete source footprint is
    -- retained once per unique source in the aggregate evidence object below;
    -- counting it once avoids rejecting 64 variations of one source before
    -- the generic runner has a chance to execute them.
    required = required + 720
    if not unique_sources[prepared.row.source_item_ref] then
      unique_sources[prepared.row.source_item_ref] = true
      unique_source_count = unique_source_count + 1
      unique_fx_slots = unique_fx_slots + (#footprint.take_fx.chain * 160)
    end
  end
  required = required + unique_source_count * 900 + unique_fx_slots + (#prepared_rows * 180)
  if required > max_response then
    return e4_item_handler_error("RESPONSE_TOO_LARGE", "E4 copy_item_to_track batch success envelope cannot fit before mutation.", {
      blocker = "success_envelope_budget_insufficient",
      required_response_bytes = required,
      max_response_bytes = max_response,
      zero_write = true,
    })
  end
  return nil
end

local function e4_item_compact_batch_take_fx_copy(value)
  local slots = json_array({})
  for index = 1, #(value and value.slots or {}) do
    local slot = value.slots[index]
    slots[#slots + 1] = {
      slot_index = slot.slot_index,
      target_fx_ref = slot.target_fx_ref,
    }
  end
  return {
    status = value and value.status or "failed",
    source_count = value and value.source_count or 0,
    copied_count = value and value.copied_count or 0,
    slots = slots,
  }
end

local function e4_item_compact_batch_row(summary, row, source_footprint_index, target_track_index)
  return {
    id = row.id,
    new_item_ref = summary.new_item_ref,
    active_take_ref = summary.active_take_ref,
    source_footprint_index = source_footprint_index,
    target_track_index = target_track_index,
    position_seconds = summary.position_seconds,
    source_offset_seconds = row.source_offset_seconds,
    take_fx_copy = e4_item_compact_batch_take_fx_copy(summary.take_fx_copy),
  }
end

local function e4_item_copy_batch_set_offset(item, take, offset)
  if offset == nil then return true, false end
  local ok_set, accepted = call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", offset)
  if not ok_set or accepted ~= true then return false, true end
  call_reaper("UpdateItemInProject", item)
  local ok_read, readback = call_reaper("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS")
  return ok_read and e4_item_finite_native_number(first_number(readback)) and first_number(readback) == offset, true
end

local function copy_item_to_track_batch(request)
  local rows, validation_failure = e4_item_validate_batch_rows(request)
  if validation_failure then return nil, validation_failure end
  local preflight_started = e4_item_monotonic_now()
  local prepared_rows = {}
  local source_cache = {}
  local track_cache = {}
  for index = 1, #rows do
    local row = rows[index]
    local source_item = source_cache[row.source_item_ref] and source_cache[row.source_item_ref].item
      or e4_item_resolve_item_from_ref_object(e4_item_ref_object("item", row.source_item_ref))
    local target_track = track_cache[row.target_track_ref]
      or e4_item_resolve_track_from_ref_object(e4_item_ref_object("track", row.target_track_ref))
    if not source_item then
      return e4_item_batch_error("ITEM_NOT_FOUND", "E4 copy_item_to_track batch source Item could not be resolved.", index)
    end
    if not target_track then
      return e4_item_batch_error("TRACK_NOT_FOUND", "E4 copy_item_to_track batch target Track could not be resolved.", index)
    end
    local source_entry = source_cache[row.source_item_ref]
    if not source_entry then
      local source_snapshot = e4_item_read_strict_snapshot(source_item)
      local target_track_ref = e4_item_strict_track_ref(target_track)
      local footprint, footprint_failure = e4_item_read_source_footprint(source_item)
      if footprint_failure then
        footprint_failure.details = footprint_failure.details or {}
        footprint_failure.details.row_index = index
        footprint_failure.details.zero_write = true
        return nil, footprint_failure
      end
      if not source_snapshot or not target_track_ref or source_snapshot.length_seconds ~= footprint.item_length_seconds then
        return e4_item_batch_error("VERIFY_FAILED", "E4 copy_item_to_track batch source identity or footprint changed during preflight.", index, { blocker = "source_snapshot_changed" })
      end
      source_entry = { item = source_item, snapshot = source_snapshot, footprint = footprint }
      source_cache[row.source_item_ref] = source_entry
    end
    local target_track_ref = track_cache[row.target_track_ref] and row.target_track_ref or e4_item_strict_track_ref(target_track)
    if not target_track_ref then
      return e4_item_batch_error("VERIFY_FAILED", "E4 copy_item_to_track batch target Track GUID could not be read.", index, { blocker = "target_identity_unreadable" })
    end
    track_cache[row.target_track_ref] = target_track
    prepared_rows[#prepared_rows + 1] = {
      row = row,
      source_item = source_entry.item,
      source_snapshot = source_entry.snapshot,
      target_track = target_track,
      target_track_ref = target_track_ref,
      footprint = source_entry.footprint,
    }
  end
  local budget_failure = e4_item_batch_preflight_budget(request, prepared_rows)
  if budget_failure then return nil, budget_failure end
  local preflight_ms = (e4_item_monotonic_now() - preflight_started) * 1000
  local result_rows = json_array({})
  local source_footprints = json_array({})
  local source_footprint_seen = {}
  local target_tracks = json_array({})
  local target_track_seen = {}
  for index = 1, #prepared_rows do
    local target_track_ref = prepared_rows[index].target_track_ref
    if not target_track_seen[target_track_ref] then
      target_tracks[#target_tracks + 1] = { target_track_ref = target_track_ref }
      target_track_seen[target_track_ref] = #target_tracks
    end
  end
  local phase_timings = { mutation_ms = 0, readback_ms = 0 }
  local native_mutations = 0
  local native_readbacks = 0
  local native_source_create_count = 0
  local native_source_reuse_count = 0
  for chunk_start = 1, #prepared_rows, E4_ITEM_COPY_BATCH_CHUNK_SIZE do
    local chunk_end = math.min(#prepared_rows, chunk_start + E4_ITEM_COPY_BATCH_CHUNK_SIZE - 1)
    for index = chunk_start, chunk_end do
      local prepared = prepared_rows[index]
      local row_request = e4_item_batch_row_request(request, prepared.row)
      local source_entry, source_created_or_failure = e4_item_batch_prepare_source(prepared.footprint)
      if not source_entry then
        local source_failure = source_created_or_failure
        source_failure.details = source_failure.details or {}
        source_failure.details.row_index = index
        source_failure.details.completed_rows = #result_rows
        source_failure.details.native_mutations = native_mutations
        source_failure.details.zero_write = #result_rows == 0
        return nil, source_failure
      end
      if source_created_or_failure == true then
        native_source_create_count = native_source_create_count + 1
      else
        native_source_reuse_count = native_source_reuse_count + 1
      end
      local summary, failure, _, _, refs, new_item, target_take = copy_item_to_track_prepared(
        row_request, prepared.source_snapshot, prepared.target_track, prepared.target_track_ref, prepared.footprint, phase_timings, source_entry)
      if failure then
        failure.details = failure.details or {}
        failure.details.row_index = index
        failure.details.completed_rows = #result_rows
        failure.details.native_mutations = native_mutations
        failure.details.zero_write = false
        return nil, failure
      end
      native_mutations = native_mutations + 1
      local offset_started = e4_item_monotonic_now()
      local offset_ok = e4_item_copy_batch_set_offset(new_item, target_take, prepared.row.source_offset_seconds)
      phase_timings.readback_ms = phase_timings.readback_ms + ((e4_item_monotonic_now() - offset_started) * 1000)
      if not offset_ok then
        local ok_delete, deleted = call_reaper("DeleteTrackMediaItem", prepared.target_track, new_item)
        local code = ok_delete and deleted == true and "VERIFY_FAILED" or "RESTORE_FAILED"
        return e4_item_handler_error(code, "E4 copy_item_to_track batch source-offset writeback failed.", {
          blocker = "source_offset_readback_failed",
          row_index = index,
          completed_rows = #result_rows,
          native_mutations = native_mutations,
          zero_write = false,
        }, false)
      end
      native_readbacks = native_readbacks + 1
      local source_footprint_index = source_footprint_seen[prepared.row.source_item_ref]
      if not source_footprint_index then
        source_footprints[#source_footprints + 1] = {
          source_item_ref = prepared.row.source_item_ref,
          source_take_ref = prepared.source_snapshot.active_take_ref,
          source_footprint = {
            canonical_source_identity = prepared.footprint.canonical_source_identity,
            source_type = prepared.footprint.source_type,
            source_length_seconds = prepared.footprint.source_length_seconds,
            item_length_seconds = prepared.footprint.item_length_seconds,
            start_offset_seconds = prepared.footprint.start_offset_seconds,
            playrate = prepared.footprint.playrate,
            pitch = prepared.footprint.pitch,
            preserve_pitch = prepared.footprint.preserve_pitch == 1,
            take_fx = e4_item_take_fx_evidence(prepared.footprint.take_fx),
          },
        }
        source_footprint_index = #source_footprints
        source_footprint_seen[prepared.row.source_item_ref] = source_footprint_index
      end
      result_rows[#result_rows + 1] = e4_item_compact_batch_row(
        summary, prepared.row, source_footprint_index, target_track_seen[prepared.target_track_ref])
    end
  end
  local evidence_started = e4_item_monotonic_now()
  -- Batch rows already carry every exact target identity. Repeating the same
  -- Item and Take-FX identities in refs[] can exceed the Bridge response budget
  -- after successful mutation at the supported 64-row ceiling.
  local refs = json_array({})
  local evidence_ms = (e4_item_monotonic_now() - evidence_started) * 1000
  return e4_item_summary(request, {
    rows = result_rows,
    source_footprints = source_footprints,
    target_tracks = target_tracks,
    copy_depth = "active_take_footprint",
    new_item_ref = #result_rows == 1 and result_rows[1].new_item_ref or nil,
    source_item_ref = #result_rows == 1 and prepared_rows[1].row.source_item_ref or nil,
    target_track_ref = #result_rows == 1 and prepared_rows[1].target_track_ref or nil,
    position_seconds = #result_rows == 1 and result_rows[1].position_seconds or nil,
    source_footprint = #result_rows == 1 and source_footprints[1].source_footprint or nil,
    batch_timings = {
      preflight_ms = preflight_ms,
      mutation_ms = phase_timings.mutation_ms,
      readback_ms = phase_timings.readback_ms,
      evidence_ms = evidence_ms,
      transport_ms = 0,
      native_mutation_count = native_mutations,
      native_readback_count = native_readbacks,
      native_source_create_count = native_source_create_count,
      native_source_reuse_count = native_source_reuse_count,
      rows = #result_rows,
      chunk_size = E4_ITEM_COPY_BATCH_CHUNK_SIZE,
      chunks = math.ceil(#result_rows / E4_ITEM_COPY_BATCH_CHUNK_SIZE),
      runner = "e4_generic_copy_batch",
    },
  }), nil, nil, nil, refs
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

local function copy_item_to_track(request, resume_continuation)
  if request.params and request.params.batch ~= nil then
    if resume_continuation ~= nil then
      return e4_item_handler_error("INTERNAL_ERROR", "E4 copy_item_to_track batch does not accept an unexpected continuation.", {
        blocker = "batch_continuation_not_supported",
        zero_write = true,
      }, false)
    end
    return copy_item_to_track_batch(request)
  end
  return copy_item_to_track_single(request)
end
