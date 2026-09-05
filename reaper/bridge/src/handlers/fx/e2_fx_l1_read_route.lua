-- Extracted E2 FX-L1 read handlers.

local function e2_fx_read_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e2_fx_read_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e2_fx_read_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "none"
  readback.artifacts_allowed = readback.artifacts_allowed == true
  readback.write_fx_status = readback.write_fx_status or "held"
  readback.preset_status = readback.preset_status or "held"
  readback.video_processor_status = readback.video_processor_status or "held"
  readback.truncated = readback.truncated == true
  return readback
end

local function e2_fx_read_bounded_limit(request, requested, default_limit, hard_limit)
  local value = tonumber(requested)
  if not value or value < 1 then
    value = default_limit
  end
  value = math.floor(value)
  if value > hard_limit then
    value = hard_limit
  end
  return value
end

local function e2_fx_read_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e2_fx_read_track_index(track)
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

local function e2_fx_read_track_ref_string(track)
  local guid = e2_fx_read_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e2_fx_read_track_index(track))
end

local function e2_fx_read_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e2_fx_read_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e2_fx_read_resolve_track_token(token)
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
    return e2_fx_read_find_track_by_guid(guid)
  end
  return nil
end

local function e2_fx_read_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e2_fx_read_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e2_fx_read_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e2_fx_read_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e2_fx_read_resolve_track_token(ref.ref)
end

local function e2_fx_read_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e2_fx_read_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e2_fx_read_item_guid(item)
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

local function e2_fx_read_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function e2_fx_read_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and e2_fx_read_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function e2_fx_read_take_ref_string(take)
  local guid = e2_fx_read_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  return "take:index:0"
end

local function e2_fx_read_find_take_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for item_index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_take_count, take_count = call_reaper("CountTakes", item)
      local takes = ok_take_count and first_number(take_count) or 0
      for take_index = 0, takes - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take and e2_fx_read_take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

local function e2_fx_read_resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
  end
  local active_item_index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if active_item_index then
    local ok_item, item = call_reaper("GetMediaItem", 0, tonumber(active_item_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
  end
  local item_guid, take_index = token:match("^take:item_guid:(.-):(%d+)$")
  if item_guid then
    local item = e2_fx_read_find_item_by_guid(item_guid)
    if item then
      local ok_take, take = call_reaper("GetTake", item, tonumber(take_index))
      return ok_take and take or nil
    end
  end
  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return e2_fx_read_find_take_by_guid(guid)
  end
  return nil
end

local function e2_fx_read_resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e2_fx_read_resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e2_fx_read_resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e2_fx_read_resolve_take_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "item_guid" then
    return e2_fx_read_resolve_take_token("take:item_guid:" .. tostring(identity.value))
  end
  return e2_fx_read_resolve_take_token(ref.ref)
end

local function e2_fx_read_take_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = e2_fx_read_resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return nil
end

local function e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index)
  return "fx:" .. tostring(owner_ref) .. ":" .. tostring(slot_index)
end

local function e2_fx_read_fx_object_ref(owner_kind, owner_ref, slot_index, name)
  local ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = {
      scheme = tostring(owner_kind) .. "_fx",
      value = tostring(owner_ref) .. ":" .. tostring(slot_index),
    },
    display = {
      name = bounded_string(name or "", 160),
      owner_ref = owner_ref,
      slot_index = slot_index,
    },
  }
end

local function e2_fx_read_fx_owner_from_ref_object(ref, request)
  if not is_object(ref) or ref.kind ~= "fx" then
    return nil, nil, nil
  end
  local track_ref, track_slot = ref.ref:match("^fx:(track:[^:]+:.+):(%d+)$")
  if track_ref and track_slot then
    return "track", e2_fx_read_resolve_track_token(track_ref), math.floor(tonumber(track_slot))
  end
  local take_ref, take_slot = ref.ref:match("^fx:(take:[^:]+:.+):(%d+)$")
  if take_ref and take_slot then
    return "take", e2_fx_read_resolve_take_token(take_ref), math.floor(tonumber(take_slot))
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  local scheme = identity.scheme
  local value = tostring(identity.value or "")
  if scheme == "track_fx" then
    local owner_ref, slot_text = value:match("^(track:[^:]+:.+):(%d+)$")
    if owner_ref and slot_text then
      return "track", e2_fx_read_resolve_track_token(owner_ref), math.floor(tonumber(slot_text))
    end
  elseif scheme == "take_fx" then
    local owner_ref, slot_text = value:match("^(take:[^:]+:.+):(%d+)$")
    if owner_ref and slot_text then
      return "take", e2_fx_read_resolve_take_token(owner_ref), math.floor(tonumber(slot_text))
    end
  end
  if not is_string(scheme) or scheme == "" then
    scheme, value = ref.ref:match("^fx:([^:]+):(.+)$")
  end
  local slot_index = tonumber(value)
  if not slot_index then
    return nil, nil, nil
  end
  slot_index = math.floor(slot_index)
  if scheme == "track" then
    local track = e2_fx_read_track_from_request_refs(request)
    return "track", track, slot_index
  elseif scheme == "take" then
    local take = e2_fx_read_take_from_request_refs(request)
    return "take", take, slot_index
  end
  return nil, nil, nil
end

local function e2_fx_read_fx_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local owner_kind, owner, slot_index = e2_fx_read_fx_owner_from_ref_object(request.refs[index], request)
      if owner_kind and owner and slot_index then
        return owner_kind, owner, slot_index
      end
    end
  end
  return nil, nil, nil
end

local function e2_fx_read_count(owner_kind, owner)
  local ok, count
  if owner_kind == "take" then
    ok, count = call_reaper("TakeFX_GetCount", owner)
  else
    ok, count = call_reaper("TrackFX_GetCount", owner)
  end
  return ok and first_number(count) or 0
end

local function e2_fx_read_name(owner_kind, owner, slot_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetFXName", owner, slot_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetFXName", owner, slot_index, "")
  end
  return bounded_string(ok and first_string(name) or "", 160)
end

local function e2_fx_read_guid(owner_kind, owner, slot_index)
  local api = owner_kind == "take" and "TakeFX_GetFXGUID" or "TrackFX_GetFXGUID"
  local ok, guid = call_reaper(api, owner, slot_index)
  guid = ok and first_string(guid) or nil
  return type(guid) == "string" and guid ~= "" and guid or nil
end

local function e2_fx_read_plugin_id(owner_kind, owner, slot_index)
  local api = owner_kind == "take" and "TakeFX_GetNamedConfigParm" or "TrackFX_GetNamedConfigParm"
  local ok, available, ident = call_reaper(api, owner, slot_index, "fx_ident")
  ident = ok and available ~= false and first_string(ident) or nil
  return type(ident) == "string" and ident ~= "" and bounded_string(ident, 256) or nil
end

local function e2_fx_read_enabled(owner_kind, owner, slot_index)
  local ok, enabled
  if owner_kind == "take" then
    ok, enabled = call_reaper("TakeFX_GetEnabled", owner, slot_index)
  else
    ok, enabled = call_reaper("TrackFX_GetEnabled", owner, slot_index)
  end
  return ok and enabled == true or false
end

local function e2_fx_read_param_count(owner_kind, owner, slot_index)
  local ok, count
  if owner_kind == "take" then
    ok, count = call_reaper("TakeFX_GetNumParams", owner, slot_index)
  else
    ok, count = call_reaper("TrackFX_GetNumParams", owner, slot_index)
  end
  return ok and first_number(count) or 0
end

local function e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetParamName", owner, slot_index, param_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetParamName", owner, slot_index, param_index, "")
  end
  return bounded_string(ok and first_string(name) or "", 160)
end

local function e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local ok, value, min_value, max_value
  if owner_kind == "take" then
    ok, value, min_value, max_value = call_reaper("TakeFX_GetParam", owner, slot_index, param_index)
  else
    ok, value, min_value, max_value = call_reaper("TrackFX_GetParam", owner, slot_index, param_index)
  end
  return {
    value = ok and first_number(value) or 0,
    min_value = ok and first_number(min_value) or 0,
    max_value = ok and first_number(max_value) or 1,
  }
end

local function e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local ok, value
  if owner_kind == "take" then
    ok, value = call_reaper("TakeFX_GetParamNormalized", owner, slot_index, param_index)
  else
    ok, value = call_reaper("TrackFX_GetParamNormalized", owner, slot_index, param_index)
  end
  return ok and first_number(value) or JSON_NULL
end

local function e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
  local api = owner_kind == "take" and "TakeFX_GetParamIdent" or "TrackFX_GetParamIdent"
  local ok, _, ident = call_reaper(api, owner, slot_index, param_index, "")
  ident = ok and first_string(ident) or nil
  if not ident or ident == "" then
    return nil
  end
  return bounded_string(ident, 160)
end

local function e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index)
  local api = owner_kind == "take" and "TakeFX_GetFormattedParamValue" or "TrackFX_GetFormattedParamValue"
  local ok, _, formatted = call_reaper(api, owner, slot_index, param_index, "")
  return bounded_string(ok and first_string(formatted) or "", 160)
end

local function e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, normalized_value)
  local api = owner_kind == "take" and "TakeFX_FormatParamValueNormalized" or "TrackFX_FormatParamValueNormalized"
  local ok, formatted_ok, formatted = call_reaper(api, owner, slot_index, param_index, normalized_value, "")
  if not ok or formatted_ok == false then
    return nil
  end
  return bounded_string(first_string(formatted) or "", 160)
end

local function e2_fx_format_param_value(owner_kind, owner, slot_index, param_index, value)
  local api = owner_kind == "take" and "TakeFX_FormatParamValue" or "TrackFX_FormatParamValue"
  local ok, formatted_ok, formatted = call_reaper(api, owner, slot_index, param_index, value)
  if not ok or formatted_ok == false then
    return nil
  end
  return bounded_string(first_string(formatted) or "", 160)
end

local function e2_fx_read_param_step_sizes(owner_kind, owner, slot_index, param_index)
  local api = owner_kind == "take" and "TakeFX_GetParameterStepSizes" or "TrackFX_GetParameterStepSizes"
  local ok, available, step_size, small_step_size, large_step_size, is_toggle = call_reaper(
    api,
    owner,
    slot_index,
    param_index
  )
  if not ok or available ~= true then
    return {
      step_sizes_available = false,
      step_size = JSON_NULL,
      small_step_size = JSON_NULL,
      large_step_size = JSON_NULL,
      is_toggle = JSON_NULL,
      is_discrete = JSON_NULL,
    }
  end
  step_size = first_number(step_size)
  small_step_size = first_number(small_step_size)
  large_step_size = first_number(large_step_size)
  is_toggle = is_toggle == true
  return {
    step_sizes_available = true,
    step_size = step_size or JSON_NULL,
    small_step_size = small_step_size or JSON_NULL,
    large_step_size = large_step_size or JSON_NULL,
    is_toggle = is_toggle,
    is_discrete = is_toggle or (type(step_size) == "number" and step_size > 0),
  }
end

local function e2_fx_infer_native_discrete_format(
  owner_kind,
  owner,
  slot_index,
  param_index,
  target_formatted_value
)
  if type(target_formatted_value) ~= "string" or target_formatted_value == "" then
    return false
  end
  local unique = {}
  local unique_count = 0
  local target_count = 0
  local sample_intervals = 32
  for sample_index = 0, sample_intervals do
    local formatted = e2_fx_format_param_normalized(
      owner_kind,
      owner,
      slot_index,
      param_index,
      sample_index / sample_intervals
    )
    if type(formatted) ~= "string" or formatted == "" then
      return false
    end
    if not unique[formatted] then
      unique[formatted] = true
      unique_count = unique_count + 1
      if unique_count > 16 then
        return false
      end
    end
    if formatted == target_formatted_value then
      target_count = target_count + 1
    end
  end
  return unique_count >= 2 and target_count >= 2
end

local function e2_fx_parameter_readback_matches(
  requested_normalized_value,
  requested_formatted_value,
  readback_normalized_value,
  readback_formatted_value,
  tolerance,
  step_sizes
)
  if type(readback_normalized_value) == "number"
      and math.abs(readback_normalized_value - requested_normalized_value) <= tolerance then
    return true, "numeric_tolerance"
  end
  if step_sizes.is_discrete == true
      and type(requested_formatted_value) == "string"
      and requested_formatted_value == readback_formatted_value then
    return true, "native_discrete_format"
  end
  return false, "failed"
end

local function e2_fx_parameter_offset(value)
  local number = tonumber(value)
  if not number or number < 0 or number ~= math.floor(number) then
    return 0
  end
  return number
end

local function e2_fx_read_owner_ref(owner_kind, owner)
  if owner_kind == "take" then
    return e2_fx_read_take_ref_string(owner)
  end
  return e2_fx_read_track_ref_string(owner)
end

local function e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local name = e2_fx_read_name(owner_kind, owner, slot_index)
  return {
    fx_ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index),
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    fx_guid = e2_fx_read_guid(owner_kind, owner, slot_index) or JSON_NULL,
    slot_index = slot_index,
    name = name,
    plugin_id = e2_fx_read_plugin_id(owner_kind, owner, slot_index) or JSON_NULL,
    enabled = e2_fx_read_enabled(owner_kind, owner, slot_index),
    parameter_count = e2_fx_read_param_count(owner_kind, owner, slot_index),
  }, e2_fx_read_fx_object_ref(owner_kind, owner_ref, slot_index, name)
end

local function e2_fx_read_chain(owner_kind, owner, request)
  local count = e2_fx_read_count(owner_kind, owner)
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 16, 32)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local summaries = json_array({})
  local refs = json_array({})
  local max_index = math.min(count, limit)
  for slot_index = 0, max_index - 1 do
    local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
    summaries[#summaries + 1] = summary
    refs[#refs + 1] = ref
  end
  return {
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    fx_count = count,
    fx = summaries,
    fx_refs = refs,
    truncated = count > limit,
  }, refs
end

local function resolve_fx_ref(request)
  local owner_kind = request.params and request.params.owner_kind or "track"
  local slot_index = math.floor(tonumber(request.params and request.params.slot_index) or 0)
  local owner = nil
  if owner_kind == "take" then
    owner = e2_fx_read_take_from_request_refs(request)
  else
    owner_kind = "track"
    owner = e2_fx_read_track_from_request_refs(request)
  end
  if not owner then
    return e2_fx_read_error("FX_OWNER_NOT_FOUND", "E2 FX-L1 resolve_fx_ref requires a resolvable track or take owner ref.", {
      owner_kind = owner_kind,
    })
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-L1 resolve_fx_ref slot index is outside the owner FX chain.", {
      owner_kind = owner_kind,
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_read_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function list_track_fx_chain(request)
  local track = e2_fx_read_track_from_request_refs(request)
  if not track then
    return e2_fx_read_error("TRACK_NOT_FOUND", "E2 FX-L1 list_track_fx_chain requires a resolvable track ref.")
  end
  local chain, refs = e2_fx_read_chain("track", track, request)
  return e2_fx_read_summary(request, chain), nil, json_array({}), json_array({}), refs
end

local function list_take_fx_chain(request)
  local take = e2_fx_read_take_from_request_refs(request)
  if not take then
    return e2_fx_read_error("TAKE_NOT_FOUND", "E2 FX-L1 list_take_fx_chain requires a resolvable take ref.")
  end
  local chain, refs = e2_fx_read_chain("take", take, request)
  return e2_fx_read_summary(request, chain), nil, json_array({}), json_array({}), refs
end

local function read_fx_summary(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 read_fx_summary requires a resolvable FX ref.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-L1 read_fx_summary slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_read_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local E2_FX_HOMOGENEOUS_SET = {}

local function list_fx_parameters(request)
  if is_object(request.params) and request.params.mode == "inspect_set" then
    return E2_FX_HOMOGENEOUS_SET.inspect(request)
  end
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 list_fx_parameters requires a resolvable FX ref.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 32, 64)
  local offset = math.min(e2_fx_parameter_offset(request.params and request.params.offset), count)
  local parameters = json_array({})
  local max_index = math.min(count, offset + limit)
  for param_index = offset, max_index - 1 do
    local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
    parameters[#parameters + 1] = {
      param_index = param_index,
      param_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index) or JSON_NULL,
      name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
      formatted_value = e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index),
    }
  end
  local next_offset = max_index < count and max_index or JSON_NULL
  return e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    parameter_count = count,
    parameters = parameters,
    returned_count = #parameters,
    offset = offset,
    next_offset = next_offset,
    truncated = next_offset ~= JSON_NULL,
    inventory_complete = next_offset == JSON_NULL,
    coverage_status = next_offset == JSON_NULL and "complete" or "paged",
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end

local function read_fx_parameter(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 read_fx_parameter requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX-L1 read_fx_parameter requires a non-negative integer param_index.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX-L1 read_fx_parameter index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  local param_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
  if not param_ident then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_UNAVAILABLE", "REAPER did not return a stable identity for the exact FX parameter.", {
      param_index = param_index,
    })
  end
  local requested_ident = request.params and request.params.param_ident
  if is_string(requested_ident) and requested_ident ~= param_ident then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_MISMATCH", "Requested param_ident does not match the exact live FX parameter.", {
      requested_param_ident = bounded_string(requested_ident, 160),
      live_param_ident = param_ident,
    })
  end
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local step_sizes = e2_fx_read_param_step_sizes(owner_kind, owner, slot_index, param_index)
  local normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local formatted_value = e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index)
  local has_normalized_probe = request.params and request.params.probe_normalized_value ~= nil
  local has_display_probe = request.params and request.params.probe_display_value ~= nil
  if has_normalized_probe and has_display_probe then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-L1 accepts exactly one probe_normalized_value or probe_display_value.")
  end
  if has_normalized_probe then
    local probe_normalized_value = tonumber(request.params.probe_normalized_value)
    if not probe_normalized_value or probe_normalized_value < 0 or probe_normalized_value > 1 then
      return e2_fx_read_error("PARAMS_INVALID", "E2 FX-L1 probe_normalized_value must be between 0 and 1.", {
        probe_normalized_value = request.params.probe_normalized_value,
      })
    end
    local probe_formatted = e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, probe_normalized_value)
    if probe_formatted == nil then
      return e2_fx_read_error("API_UNAVAILABLE", "REAPER could not format the requested normalized FX parameter value.", {
        param_index = param_index,
        probe_normalized_value = probe_normalized_value,
      })
    end
    normalized_value = probe_normalized_value
    formatted_value = probe_formatted
  elseif has_display_probe then
    local probe_display_value = request.params.probe_display_value
    if not is_string(probe_display_value) or probe_display_value == "" or #probe_display_value > 80 then
      return e2_fx_read_error("PARAMS_INVALID", "E2 FX-L1 probe_display_value must be one bounded native-formatted target string.")
    end
    local compiled_value, compiled_formatted = E2_FX_HOMOGENEOUS_SET.search_formatted({
      owner_kind = owner_kind,
      owner = owner,
      slot_index = slot_index,
    }, param_index, probe_display_value)
    if not compiled_value then
      return e2_fx_read_error("FX_DISPLAY_VALUE_UNREACHABLE", "REAPER native formatting could not reach the requested FX display value without mutation.", {
        param_index = param_index,
        display_value = bounded_string(probe_display_value, 80),
        zero_write = true,
      })
    end
    values.value = compiled_value
    normalized_value = JSON_NULL
    formatted_value = compiled_formatted
  end
  local _, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_read_summary(request, {
    fx_ref = ref.ref,
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = param_ident,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = normalized_value,
    formatted_value = formatted_value,
    step_sizes_available = step_sizes.step_sizes_available,
    step_size = step_sizes.step_size,
    small_step_size = step_sizes.small_step_size,
    large_step_size = step_sizes.large_step_size,
    is_toggle = step_sizes.is_toggle,
    is_discrete = step_sizes.is_discrete,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function e2_fx_search_query(request)
  local query = request.params and request.params.query
  if not is_string(query) or query:gsub("%s+", "") == "" then
    return nil
  end
  return bounded_string(query, 120)
end

local function e2_fx_non_negative_integer(value, fallback)
  local number = tonumber(value)
  if not number or number < 0 or number ~= math.floor(number) then
    return fallback
  end
  return number
end

local E2_FX_INSTALLED_INVENTORY_CACHE = nil

local function e2_fx_enum_installed_name(index)
  local ok, present, name, ident = call_reaper("EnumInstalledFX", index)
  if not ok then
    return nil, nil, "missing"
  end
  if present == false or present == nil then
    return nil, nil, nil
  end
  if type(present) == "string" then
    local legacy_name = bounded_string(present, 240)
    local legacy_ident = type(name) == "string" and bounded_string(name, 240) or legacy_name
    return legacy_name, legacy_ident, nil
  end
  if type(name) == "string" then
    local bounded_name = bounded_string(name, 240)
    local bounded_ident = type(ident) == "string" and bounded_string(ident, 240) or bounded_name
    return bounded_name, bounded_ident, nil
  end
  return nil, nil, nil
end

local function e2_fx_installed_inventory()
  if E2_FX_INSTALLED_INVENTORY_CACHE then
    return E2_FX_INSTALLED_INVENTORY_CACHE, nil
  end
  local inventory = json_array({})
  local index = 0
  while true do
    local name, ident, blocker = e2_fx_enum_installed_name(index)
    if blocker then
      return nil, blocker
    end
    if not name then
      break
    end
    inventory[#inventory + 1] = {
      index = index,
      name = name,
      ident = ident,
    }
    index = index + 1
  end
  E2_FX_INSTALLED_INVENTORY_CACHE = inventory
  return inventory, nil
end

local function search_installed_fx(request)
  local query = e2_fx_search_query(request)
  if not query then
    return e2_fx_read_error("QUERY_INVALID", "FX installed search requires a non-empty query string.", {
      query = request.params and request.params.query or JSON_NULL,
    })
  end
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 16, 50)
  local offset = e2_fx_non_negative_integer(request.params and request.params.offset, 0)
  local needle = query:lower()
  local rows = json_array({})
  local matched = 0
  local truncated = false
  local inventory, blocker = e2_fx_installed_inventory()
  if blocker then
    return e2_fx_read_error("API_UNAVAILABLE", "REAPER EnumInstalledFX API is not available in this bridge runtime.", {
      api = "EnumInstalledFX",
    })
  end
  for inventory_index = 1, #inventory do
    local candidate = inventory[inventory_index]
    local name = candidate.name
    if name:lower():find(needle, 1, true) then
      if matched >= offset and #rows < limit then
        rows[#rows + 1] = {
          index = candidate.index,
          name = name,
          ident = candidate.ident,
        }
      elseif matched >= offset and #rows >= limit then
        truncated = true
      end
      matched = matched + 1
    end
  end
  return e2_fx_read_summary(request, {
    query = query,
    rows = rows,
    row_count = #rows,
    matched_count = matched,
    scanned_count = #inventory,
    limit = limit,
    offset = offset,
    truncated = truncated,
    inventory_complete = true,
    coverage_status = "complete",
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end

local function read_video_processor_code(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX read_video_processor_code requires a resolvable FX ref.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX read_video_processor_code slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local name = e2_fx_read_name(owner_kind, owner, slot_index)
  local is_video_processor = name:lower():find("video processor", 1, true) ~= nil
  if not is_video_processor then
    return e2_fx_read_error("VIDEO_PROCESSOR_NOT_FOUND", "FX slot is not a Video Processor FX.", {
      slot_index = slot_index,
      name = name,
    })
  end
  local ok, _, code = call_reaper(
    owner_kind == "take" and "TakeFX_GetNamedConfigParm" or "TrackFX_GetNamedConfigParm",
    owner,
    slot_index,
    "VIDEO_CODE"
  )
  if not ok or type(code) ~= "string" then
    return e2_fx_read_error("VIDEO_CODE_UNAVAILABLE", "REAPER did not expose VIDEO_CODE for this Video Processor FX.", {
      slot_index = slot_index,
      name = name,
    })
  end
  local byte_limit = math.min(32768, tonumber(request.params and request.params.max_code_bytes) or 32768)
  if byte_limit < 1 then
    byte_limit = 1
  end
  local truncated = #code > byte_limit
  local bounded_code = truncated and code:sub(1, byte_limit) or code
  local summary = {
    artifact_ref = "",
    schema = FX_ARTIFACT_SPECS.video_processor_code.schema,
    owner_kind = owner_kind,
    owner_ref = e2_fx_read_owner_ref(owner_kind, owner),
    slot_index = slot_index,
    name = name,
    code_bytes = #bounded_code,
    original_code_bytes = #code,
    truncated = truncated,
  }
  local write, failure = write_a1_artifact(request, FX_ARTIFACT_SPECS.video_processor_code, summary, {
    fx = e2_fx_read_fx_summary(owner_kind, owner, slot_index),
    code = bounded_code,
  })
  if not write then
    return e2_fx_read_error(failure.code, failure.message, failure.details)
  end
  summary.artifact_ref = write.object_ref.ref
  summary.bytes = write.bytes
  summary.artifacts_allowed = true
  summary.video_processor_status = "passed"
  return e2_fx_read_summary(request, summary), nil, json_array({ write.object_ref }), json_array({}), e2_fx_read_refs(write.object_ref)
end

local function e2_fx_write_summary(request, readback)
  local summary = e2_fx_read_summary(request, readback)
  summary.undo_evidence = "required"
  summary.write_fx_status = "passed"
  return summary
end

local function e2_fx_plugin_name(request)
  local name = request.params and request.params.plugin_name
  if not is_string(name) or name:gsub("%s+", "") == "" then
    return nil
  end
  return bounded_string(name, 240)
end

local function e2_fx_insert_index(request, count)
  local raw = request.params and request.params.insert_at_index
  if raw == nil or raw == JSON_NULL then
    return count
  end
  local index = tonumber(raw)
  if not index or index < 0 or index ~= math.floor(index) or index > count then
    return nil
  end
  return index
end

local function e2_fx_track_add_by_name(track, plugin_name, insert_index)
  local instantiate = -1000 - insert_index
  local ok, slot_index = call_reaper("TrackFX_AddByName", track, plugin_name, false, instantiate)
  if not ok then
    return nil
  end
  return math.floor(first_number(slot_index) or -1)
end

local function e2_fx_take_add_by_name(take, plugin_name, insert_index)
  local instantiate = -1000 - insert_index
  local ok, slot_index = call_reaper("TakeFX_AddByName", take, plugin_name, instantiate)
  if not ok then
    return nil
  end
  return math.floor(first_number(slot_index) or -1)
end

local function e2_fx_set_enabled(owner_kind, owner, slot_index, enabled)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetEnabled", owner, slot_index, enabled) == true
  end
  return call_reaper("TrackFX_SetEnabled", owner, slot_index, enabled) == true
end

local function e2_fx_set_param_normalized(owner_kind, owner, slot_index, param_index, value)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetParamNormalized", owner, slot_index, param_index, value) == true
  end
  return call_reaper("TrackFX_SetParamNormalized", owner, slot_index, param_index, value) == true
end

local function e2_fx_set_param_value(owner_kind, owner, slot_index, param_index, value)
  local api = owner_kind == "take" and "TakeFX_SetParam" or "TrackFX_SetParam"
  local ok, accepted = call_reaper(api, owner, slot_index, param_index, value)
  return ok and accepted == true
end

local function e2_fx_named_config_get(owner_kind, owner, slot_index, key)
  local api = owner_kind == "take" and "TakeFX_GetNamedConfigParm" or "TrackFX_GetNamedConfigParm"
  local ok, accepted, value = call_reaper(api, owner, slot_index, key)
  if not ok or accepted ~= true or type(value) ~= "string" then
    return nil
  end
  return bounded_string(value, 160)
end

local function e2_fx_named_config_set(owner_kind, owner, slot_index, key, value)
  local api = owner_kind == "take" and "TakeFX_SetNamedConfigParm" or "TrackFX_SetNamedConfigParm"
  local ok, accepted = call_reaper(api, owner, slot_index, key, value)
  return ok and accepted == true
end

local function e2_fx_get_preset(owner_kind, owner, slot_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetPreset", owner, slot_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetPreset", owner, slot_index, "")
  end
  if not ok then
    return nil
  end
  return bounded_string(first_string(name) or "", 240)
end

local function e2_fx_set_preset(owner_kind, owner, slot_index, preset_name)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetPreset", owner, slot_index, preset_name) == true
  end
  return call_reaper("TrackFX_SetPreset", owner, slot_index, preset_name) == true
end

local function e2_fx_set_preset_by_index(owner_kind, owner, slot_index, preset_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetPresetByIndex", owner, slot_index, preset_index) == true
  end
  return call_reaper("TrackFX_SetPresetByIndex", owner, slot_index, preset_index) == true
end

local function e2_fx_get_preset_index(owner_kind, owner, slot_index)
  local ok, preset_index, preset_count
  if owner_kind == "take" then
    ok, preset_index, preset_count = call_reaper("TakeFX_GetPresetIndex", owner, slot_index)
  else
    ok, preset_index, preset_count = call_reaper("TrackFX_GetPresetIndex", owner, slot_index)
  end
  if not ok then
    return JSON_NULL, JSON_NULL
  end
  return math.floor(first_number(preset_index) or -1), math.floor(first_number(preset_count) or -1)
end

local function e2_fx_get_parameter_envelope(owner_kind, owner, slot_index, param_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_GetEnvelope", owner, slot_index, param_index, false)
  end
  return call_reaper("GetFXEnvelope", owner, slot_index, param_index, false)
end

local function e2_fx_envelope_name(envelope, fallback)
  if not envelope then
    return fallback
  end
  local ok, _, name = call_reaper("GetEnvelopeName", envelope, "")
  return bounded_string(ok and first_string(name) or fallback or "", 200)
end

local function e2_fx_envelope_object_ref(owner_kind, owner_ref, slot_index, param_index, envelope_name)
  local ref = "envelope:fx:" .. tostring(owner_kind) .. ":" .. tostring(slot_index) .. ":param:" .. tostring(param_index)
  return {
    kind = "envelope",
    ref = ref,
    identity = {
      scheme = "fx_parameter",
      value = tostring(owner_kind) .. ":" .. tostring(slot_index) .. ":" .. tostring(param_index),
    },
    display = {
      name = bounded_string(envelope_name or "", 200),
      owner_ref = owner_ref,
      fx_slot_index = slot_index,
      param_index = param_index,
    },
  }
end

local function e2_fx_copy_move(owner_kind, owner, slot_index, target_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_CopyToTake", owner, slot_index, owner, target_index, true) == true
  end
  return call_reaper("TrackFX_CopyToTrack", owner, slot_index, owner, target_index, true) == true
end

local function add_track_fx(request)
  local track = e2_fx_read_track_from_request_refs(request)
  if not track then
    return e2_fx_read_error("TRACK_NOT_FOUND", "E2 FX-B1 add_track_fx requires a resolvable track ref.")
  end
  local plugin_name = e2_fx_plugin_name(request)
  if not plugin_name then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_track_fx requires a non-empty plugin_name.")
  end
  local before_count = e2_fx_read_count("track", track)
  local insert_index = e2_fx_insert_index(request, before_count)
  if not insert_index then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_track_fx insert_at_index is outside the track FX chain.", {
      fx_count = before_count,
      insert_at_index = request.params and request.params.insert_at_index,
    })
  end
  local slot_index = e2_fx_track_add_by_name(track, plugin_name, insert_index)
  if not slot_index or slot_index < 0 then
    return e2_fx_read_error("FX_NOT_FOUND", "E2 FX-B1 add_track_fx could not instantiate the requested FX.", {
      plugin_name = plugin_name,
    })
  end
  local after_count = e2_fx_read_count("track", track)
  if after_count <= before_count then
    return e2_fx_read_error("COMMAND_FAILED", "E2 FX-B1 add_track_fx did not increase the track FX count.", {
      before_count = before_count,
      after_count = after_count,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary("track", track, slot_index)
  summary.plugin_name = plugin_name
  summary.fx_count_before = before_count
  summary.fx_count_after = after_count
  summary.created = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local E2_FX_TAKE_FANOUT_MAX_TARGETS = 64
local E2_FX_LAYOUT_MAX_PARAMETERS = 4096
local E2_FX_CHAIN_MAX_INSTANCES = 4096

local function e2_fx_fingerprint_segments(prefix, segments)
  local lane_a = 104729
  local lane_b = 130363
  local byte_index = 0
  for segment_index = 1, #segments do
    local value = tostring(segments[segment_index] or "")
    local framed = tostring(#value) .. ":" .. value .. ";"
    for index = 1, #framed do
      local byte = framed:byte(index)
      byte_index = byte_index + 1
      lane_a = (lane_a * 131 + byte + byte_index) % 2147483647
      lane_b = (lane_b * 257 + byte + segment_index) % 2147483629
    end
  end
  return prefix .. ":" .. string.format("%08x", lane_a) .. string.format("%08x", lane_b)
end

local function e2_fx_parameter_layout(owner_kind, owner, slot_index, plugin_id, plugin_name)
  local count_api = owner_kind == "take" and "TakeFX_GetNumParams" or "TrackFX_GetNumParams"
  local ok_count, raw_parameter_count = call_reaper(count_api, owner, slot_index)
  local parameter_count = ok_count and first_number(raw_parameter_count) or nil
  if type(parameter_count) ~= "number" or parameter_count < 0
      or parameter_count ~= math.floor(parameter_count) then
    return nil, "FX_PARAMETER_LAYOUT_UNAVAILABLE"
  end
  if parameter_count > E2_FX_LAYOUT_MAX_PARAMETERS then
    return nil, "FX_PARAMETER_LAYOUT_LIMIT_EXCEEDED"
  end
  local segments = { "openreaper.fx_parameter_layout.v1", plugin_id, plugin_name, parameter_count }
  for param_index = 0, parameter_count - 1 do
    local param_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
    if not param_ident then
      return nil, "FX_PARAMETER_IDENTITY_UNAVAILABLE"
    end
    local name_api = owner_kind == "take" and "TakeFX_GetParamName" or "TrackFX_GetParamName"
    local ok_name, name_available, raw_param_name = call_reaper(name_api, owner, slot_index, param_index, "")
    local param_name = ok_name and name_available ~= false and first_string(raw_param_name) or nil
    if type(param_name) ~= "string" then
      return nil, "FX_PARAMETER_NAME_UNAVAILABLE"
    end
    segments[#segments + 1] = param_index
    segments[#segments + 1] = param_ident
    segments[#segments + 1] = bounded_string(param_name, 160)
  end
  return {
    parameter_count = parameter_count,
    layout_fingerprint = e2_fx_fingerprint_segments("fx-layout-v1", segments),
  }
end

local function e2_fx_native_item_guid(item)
  local ok, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if not ok or not is_string(guid) or guid == "" then
    return nil
  end
  return guid
end

local function e2_fx_exact_fanout_track(request)
  if not is_json_array(request.refs) or #request.refs ~= 1 then
    return nil, nil, "FX_SET_TRACK_REF_INVALID"
  end
  local ref = request.refs[1]
  local identity = is_object(ref) and is_object(ref.identity) and ref.identity or {}
  local guid = is_object(ref) and is_string(ref.ref) and ref.ref:match("^track:guid:(.+)$") or nil
  if not guid or ref.kind ~= "track" or identity.scheme ~= "guid" or identity.value ~= guid then
    return nil, nil, "FX_SET_TRACK_REF_INVALID"
  end
  local track = e2_fx_read_find_track_by_guid(guid)
  if not track or e2_fx_read_track_guid(track) ~= guid then
    return nil, nil, "TRACK_NOT_FOUND"
  end
  return track, ref.ref, nil
end

local function e2_fx_fanout_binding_valid(binding)
  if not is_object(binding) then return false end
  for key in pairs(binding) do
    if key ~= "bind_at" and key ~= "domain" and key ~= "selector" and key ~= "owner"
        and key ~= "aggregation" and key ~= "cardinality" then
      return false
    end
  end
  local owner = binding.owner
  local cardinality = binding.cardinality
  if not is_object(owner) or not is_object(cardinality) then return false end
  for key in pairs(owner) do
    if key ~= "domain" and key ~= "selector" and key ~= "items" then return false end
  end
  for key in pairs(cardinality) do
    if key ~= "minimum" and key ~= "maximum" then return false end
  end
  return binding.bind_at == "execution"
    and binding.domain == "takes"
    and binding.selector == "active_take_of_items"
    and binding.aggregation == "batch"
    and owner.domain == "tracks"
    and owner.selector == "explicit_refs"
    and owner.items == "all"
    and cardinality.minimum == 1
    and cardinality.maximum == E2_FX_TAKE_FANOUT_MAX_TARGETS
end

local function e2_fx_exact_installed_plugin(plugin_name)
  local inventory, blocker = e2_fx_installed_inventory()
  if not inventory then return nil, blocker or "installed_inventory_unavailable" end
  local matched = nil
  for index = 1, #inventory do
    local candidate = inventory[index]
    if candidate.name == plugin_name then
      if not is_string(candidate.ident) or candidate.ident == "" then
        return nil, "installed_plugin_identity_unavailable"
      end
      if matched and matched.ident ~= candidate.ident then
        return nil, "installed_plugin_identity_ambiguous"
      end
      matched = candidate
    end
  end
  if not matched then return nil, "installed_plugin_not_found" end
  return matched, nil
end

local function e2_fx_installed_identity_matches_live(installed_identity, live_identity)
  if not is_string(installed_identity) or installed_identity == ""
      or not is_string(live_identity) or live_identity == "" then
    return false
  end
  if live_identity == installed_identity then return true end
  if installed_identity:find("<", 1, true)
      or live_identity:sub(1, #installed_identity) ~= installed_identity then
    return false
  end
  return live_identity:sub(#installed_identity + 1):match("^<%d+$") ~= nil
end

local function e2_fx_current_project_truth()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if not ok or not project or type(project_path) ~= "string" then return nil end
  local ok_change, state_change_count = call_reaper("GetProjectStateChangeCount", project)
  if not ok_change or type(state_change_count) ~= "number" then return nil end
  return {
    project = project,
    project_ref = "project:current",
    project_path = bounded_string(project_path, 4096),
    project_instance_id = e2_fx_fingerprint_segments("native-project-v1", { tostring(project) }),
    state_change_count = math.floor(state_change_count),
  }
end

local E2_FX_SET_FOUNDATION_ERROR_CODES = {
  PARAMS_INVALID = true,
  PROJECT_NOT_FOUND = true,
  FX_NOT_FOUND = true,
  COMMAND_FAILED = true,
  VERIFY_FAILED = true,
}

function E2_FX_HOMOGENEOUS_SET.contract_error(code, message, details, recoverable)
  details = details or {}
  if details.zero_write == nil then details.zero_write = true end
  local public_code = E2_FX_SET_FOUNDATION_ERROR_CODES[code] and code or "PARAMS_INVALID"
  if public_code ~= code and details.reason_code == nil then details.reason_code = code end
  return e2_fx_read_error(public_code, message, details, recoverable)
end

function E2_FX_HOMOGENEOUS_SET.error(code, message, details, recoverable)
  local _, failure = E2_FX_HOMOGENEOUS_SET.contract_error(code, message, details, recoverable)
  return failure
end

function E2_FX_HOMOGENEOUS_SET.only_fields(value, allowed)
  if not is_object(value) then return false, nil end
  for key in pairs(value) do
    if not allowed[key] then return false, key end
  end
  return true, nil
end

function E2_FX_HOMOGENEOUS_SET.finite(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

function E2_FX_HOMOGENEOUS_SET.exact_ref(ref)
  if not is_object(ref) or ref.kind ~= "fx" or not is_string(ref.ref) then return nil end
  local take_ref, slot_text = ref.ref:match("^fx:(take:guid:.+):(%d+)$")
  local identity = is_object(ref.identity) and ref.identity or {}
  local slot_index = tonumber(slot_text)
  if not take_ref or not slot_index or identity.scheme ~= "take_fx"
      or identity.value ~= take_ref .. ":" .. tostring(math.floor(slot_index)) then
    return nil
  end
  return take_ref, math.floor(slot_index)
end

function E2_FX_HOMOGENEOUS_SET.validate_request(request, mode)
  local params = is_object(request.params) and request.params or {}
  local allowed = mode == "inspect_set" and {
    mode = true,
    expected_set_fingerprint = true,
    expected_plugin_identity = true,
    expected_layout_fingerprint = true,
    expected_representative_fx_ref = true,
    expected_members = true,
    controls = true,
  } or {
    mode = true,
    dry_run = true,
    batch = true,
    set_fingerprint = true,
    plan_hash = true,
    expected_plugin_identity = true,
    expected_layout_fingerprint = true,
    expected_representative_fx_ref = true,
    expected_members = true,
    controls = true,
  }
  local fields_ok, unexpected = E2_FX_HOMOGENEOUS_SET.only_fields(params, allowed)
  if not fields_ok then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_REQUEST_INVALID", "Homogeneous FX-set request contains an unsupported field.", {
      field = bounded_string(tostring(unexpected), 120),
    })
  end
  if params.mode ~= mode then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_MODE_INVALID", "Homogeneous FX-set request mode does not match its native route.")
  end
  local set_fingerprint = mode == "inspect_set" and params.expected_set_fingerprint or params.set_fingerprint
  if not is_string(set_fingerprint) or #set_fingerprint ~= 64 or not set_fingerprint:match("^[0-9a-f]+$") then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_FINGERPRINT_INVALID", "Homogeneous FX-set request requires one exact SHA-256 set fingerprint.")
  end
  if mode == "shared_plan" then
    if not is_json_array(params.batch) or #params.batch ~= 0 then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SHARED_PLAN_BATCH_SENTINEL_INVALID", "Shared FX plan requires the exact empty legacy batch sentinel.")
    end
    if type(params.dry_run) ~= "boolean" then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SHARED_PLAN_DRY_RUN_INVALID", "Shared FX plan requires explicit boolean dry_run.")
    end
    if not is_string(params.plan_hash) or #params.plan_hash ~= 64 or not params.plan_hash:match("^[0-9a-f]+$") then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_PARAMETER_PLAN_HASH_INVALID", "Shared FX plan requires one exact SHA-256 plan hash.")
    end
  end
  local plugin = params.expected_plugin_identity
  local plugin_fields_ok, plugin_unexpected = E2_FX_HOMOGENEOUS_SET.only_fields(plugin, {
    name = true,
    plugin_id = true,
    installed_index = true,
  })
  if not plugin_fields_ok or not is_string(plugin.name) or plugin.name == ""
      or not is_string(plugin.plugin_id) or plugin.plugin_id == "" then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_PLUGIN_IDENTITY_INVALID", "Homogeneous FX-set request lacks one exact plug-in identity.", {
      field = plugin_unexpected and bounded_string(tostring(plugin_unexpected), 120) or JSON_NULL,
    })
  end
  if not is_string(params.expected_layout_fingerprint) or params.expected_layout_fingerprint == "" then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_LAYOUT_FINGERPRINT_INVALID", "Homogeneous FX-set request lacks one exact parameter-layout fingerprint.")
  end
  if not is_json_array(params.expected_members) or #params.expected_members < 1
      or #params.expected_members > E2_FX_TAKE_FANOUT_MAX_TARGETS then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_CARDINALITY_INVALID", "Homogeneous FX-set request accepts 1-64 expected members.", {
      target_count = is_json_array(params.expected_members) and #params.expected_members or 0,
    })
  end
  if not is_json_array(request.refs) or #request.refs ~= #params.expected_members then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_REF_COVERAGE_INVALID", "Every retained FX-set member requires exactly one native FX object ref.", {
      expected_count = #params.expected_members,
      ref_count = is_json_array(request.refs) and #request.refs or 0,
    })
  end
  return {
    params = params,
    set_fingerprint = set_fingerprint,
    plugin = plugin,
    layout_fingerprint = params.expected_layout_fingerprint,
  }, nil
end

function E2_FX_HOMOGENEOUS_SET.resolve_members(request, validated)
  local params = validated.params
  local ref_map = {}
  local returned_refs = json_array({})
  for index = 1, #request.refs do
    local ref = request.refs[index]
    local take_ref = E2_FX_HOMOGENEOUS_SET.exact_ref(ref)
    if not take_ref or ref_map[ref.ref] then
      return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_MEMBER_REF_INVALID", "Homogeneous FX-set request contains a malformed or duplicate exact Take-FX ref.", {
        ref_index = index,
      })
    end
    ref_map[ref.ref] = ref
    returned_refs[#returned_refs + 1] = ref
  end

  local prepared = {}
  local seen_takes = {}
  local seen_fx_guids = {}
  local expected_fields = {
    fx_ref = true,
    take_ref = true,
    fx_guid = true,
    plugin_id = true,
    parameter_count = true,
    layout_fingerprint = true,
  }
  for index = 1, #params.expected_members do
    local expected = params.expected_members[index]
    local fields_ok, unexpected = E2_FX_HOMOGENEOUS_SET.only_fields(expected, expected_fields)
    local ref = fields_ok and is_string(expected.fx_ref) and ref_map[expected.fx_ref] or nil
    local take_ref, slot_index = ref and E2_FX_HOMOGENEOUS_SET.exact_ref(ref) or nil, nil
    if ref then take_ref, slot_index = E2_FX_HOMOGENEOUS_SET.exact_ref(ref) end
    if not fields_ok or not ref or take_ref ~= expected.take_ref or not is_string(expected.fx_guid)
        or expected.fx_guid == "" or not is_string(expected.plugin_id) or expected.plugin_id == ""
        or type(expected.parameter_count) ~= "number" or expected.parameter_count < 0
        or expected.parameter_count ~= math.floor(expected.parameter_count)
        or not is_string(expected.layout_fingerprint) or expected.layout_fingerprint == ""
        or unexpected ~= nil then
      return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_EXPECTED_MEMBER_INVALID", "A retained FX-set member lacks exact owner, FX, plug-in, count, or layout identity.", {
        member_index = index,
        field = unexpected and bounded_string(tostring(unexpected), 120) or JSON_NULL,
      })
    end
    if expected.plugin_id ~= validated.plugin.plugin_id
        or expected.layout_fingerprint ~= validated.layout_fingerprint or seen_takes[take_ref] then
      return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_EXPECTED_MEMBER_MISMATCH", "Retained FX-set members do not share the declared exact plug-in/layout identity.", {
        member_index = index,
      })
    end
    local owner_kind, take, live_slot = e2_fx_read_fx_owner_from_ref_object(ref, request)
    local take_guid = take and e2_fx_read_take_guid(take) or nil
    local expected_take_guid = take_ref:match("^take:guid:(.+)$")
    if owner_kind ~= "take" or not take or live_slot ~= slot_index or take_guid ~= expected_take_guid then
      return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_MEMBER_STALE", "A retained Take-FX owner no longer resolves to the exact native Take and slot.", {
        member_index = index,
        fx_ref = expected.fx_ref,
      })
    end
    local live_fx_guid = e2_fx_read_guid("take", take, slot_index)
    local live_plugin_id = e2_fx_read_plugin_id("take", take, slot_index)
    local layout, layout_blocker = e2_fx_parameter_layout(
      "take",
      take,
      slot_index,
      live_plugin_id or "",
      validated.plugin.name
    )
    if live_fx_guid ~= expected.fx_guid or seen_fx_guids[live_fx_guid]
        or live_plugin_id ~= expected.plugin_id or not layout
        or layout.parameter_count ~= expected.parameter_count
        or layout.layout_fingerprint ~= expected.layout_fingerprint then
      return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_MEMBER_IDENTITY_STALE", "A retained Take-FX instance no longer matches its exact native GUID, plug-in, count, or layout.", {
        member_index = index,
        fx_ref = expected.fx_ref,
        blocker = layout_blocker or JSON_NULL,
        expected_fx_guid = expected.fx_guid,
        live_fx_guid = live_fx_guid or JSON_NULL,
      })
    end
    seen_takes[take_ref] = true
    seen_fx_guids[live_fx_guid] = true
    prepared[#prepared + 1] = {
      expected = expected,
      ref = ref,
      take = take,
      slot_index = slot_index,
      layout = layout,
    }
  end
  if not ref_map[params.expected_representative_fx_ref] then
    return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_REPRESENTATIVE_STALE", "The retained representative FX is not a member of the exact native set.")
  end
  local representative = nil
  for index = 1, #prepared do
    if prepared[index].expected.fx_ref == params.expected_representative_fx_ref then
      representative = prepared[index]
      break
    end
  end
  if not representative then
    return nil, nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_REPRESENTATIVE_STALE", "The exact native representative FX could not be resolved.")
  end
  return prepared, { refs = returned_refs, representative = representative }, nil
end

function E2_FX_HOMOGENEOUS_SET.parameter_inventory(member)
  local parameters = json_array({})
  for param_index = 0, member.layout.parameter_count - 1 do
    local param_ident = e2_fx_read_param_ident("take", member.take, member.slot_index, param_index)
    local name = e2_fx_read_param_name("take", member.take, member.slot_index, param_index)
    local normalized = e2_fx_read_param_normalized("take", member.take, member.slot_index, param_index)
    local formatted = e2_fx_read_param_formatted("take", member.take, member.slot_index, param_index)
    if not is_string(param_ident) or param_ident == "" or not is_string(name)
        or not E2_FX_HOMOGENEOUS_SET.finite(normalized) or not is_string(formatted) or formatted == "" then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_PARAMETER_INVENTORY_INCOMPLETE", "Representative FX did not expose one complete native parameter inventory.", {
        param_index = param_index,
      })
    end
    local values = e2_fx_read_param_value("take", member.take, member.slot_index, param_index)
    parameters[#parameters + 1] = {
      param_index = param_index,
      param_ident = param_ident,
      name = name,
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = normalized,
      formatted_value = formatted,
    }
  end
  return parameters, nil
end

function E2_FX_HOMOGENEOUS_SET.formatted_quantity(value)
  if not is_string(value) then return nil end
  local number_text, unit_text = value:match("^%s*([-+]?%d*[.,]?%d+)%s*([^%s]*)%s*$")
  local number = number_text and tonumber((number_text:gsub(",", "."))) or nil
  if not E2_FX_HOMOGENEOUS_SET.finite(number) then return nil end
  local unit = (unit_text or ""):lower()
  local family = unit
  local scale = 1
  if unit == "hz" then
    family = "hz"
  elseif unit == "khz" then
    family = "hz"
    scale = 1000
  elseif unit == "mhz" then
    family = "hz"
    scale = 1000000
  elseif unit == "s" then
    family = "seconds"
  elseif unit == "ms" then
    family = "seconds"
    scale = 0.001
  end
  return { value = number * scale, family = family }
end

function E2_FX_HOMOGENEOUS_SET.formatted_matches(formatted, target, target_quantity)
  if formatted == target then return true end
  local candidate = E2_FX_HOMOGENEOUS_SET.formatted_quantity(formatted)
  local expected = target_quantity or E2_FX_HOMOGENEOUS_SET.formatted_quantity(target)
  if not candidate or not expected or candidate.family ~= expected.family then return false end
  local magnitude = math.max(1, math.abs(candidate.value), math.abs(expected.value))
  return math.abs(candidate.value - expected.value) <= magnitude * 0.000000001
end

function E2_FX_HOMOGENEOUS_SET.formatted_readback_matches(readback, requested)
  if E2_FX_HOMOGENEOUS_SET.formatted_matches(readback, requested) then return true end
  local candidate = E2_FX_HOMOGENEOUS_SET.formatted_quantity(readback)
  local expected = E2_FX_HOMOGENEOUS_SET.formatted_quantity(requested)
  if not candidate or not expected or candidate.family ~= "" or expected.family == "" then return false end
  local magnitude = math.max(1, math.abs(candidate.value), math.abs(expected.value))
  return math.abs(candidate.value - expected.value) <= magnitude * 0.000000001
end

function E2_FX_HOMOGENEOUS_SET.format_at_normalized(member, param_index, normalized)
  if not E2_FX_HOMOGENEOUS_SET.finite(normalized) or normalized < 0 or normalized > 1 then
    return nil
  end
  local owner_kind = member.owner_kind or "take"
  local owner = member.owner or member.take
  return e2_fx_format_param_normalized(
    owner_kind,
    owner,
    member.slot_index,
    param_index,
    normalized
  )
end

function E2_FX_HOMOGENEOUS_SET.format_at_value(member, param_index, value)
  if not E2_FX_HOMOGENEOUS_SET.finite(value) then return nil end
  local owner_kind = member.owner_kind or "take"
  local owner = member.owner or member.take
  return e2_fx_format_param_value(owner_kind, owner, member.slot_index, param_index, value)
end

function E2_FX_HOMOGENEOUS_SET.comparable_formatted_number(value, target_quantity)
  local quantity = E2_FX_HOMOGENEOUS_SET.formatted_quantity(value)
  if not quantity or not target_quantity or quantity.family ~= target_quantity.family then return nil end
  return quantity.value
end

function E2_FX_HOMOGENEOUS_SET.search_formatted(member, param_index, target)
  local owner_kind = member.owner_kind or "take"
  local owner = member.owner or member.take
  local values = e2_fx_read_param_value(owner_kind, owner, member.slot_index, param_index)
  local minimum = values.min_value
  local maximum = values.max_value
  if not E2_FX_HOMOGENEOUS_SET.finite(minimum)
      or not E2_FX_HOMOGENEOUS_SET.finite(maximum) or maximum < minimum then
    return nil
  end
  local function formatted_at(value)
    return E2_FX_HOMOGENEOUS_SET.format_at_value(member, param_index, value)
  end
  local target_quantity = E2_FX_HOMOGENEOUS_SET.formatted_quantity(target)
  local function matched(value)
    local formatted = formatted_at(value)
    if E2_FX_HOMOGENEOUS_SET.formatted_matches(formatted, target, target_quantity) then
      return true, formatted
    end
    return false, formatted
  end
  local current = values.value
  if E2_FX_HOMOGENEOUS_SET.finite(current) then
    local current_matches, current_formatted = matched(current)
    if current_matches then return current, current_formatted end
  end
  local target_number = target_quantity and target_quantity.value or nil
  local span = maximum - minimum
  local previous_value = minimum
  local previous_formatted = formatted_at(minimum)
  if E2_FX_HOMOGENEOUS_SET.formatted_matches(previous_formatted, target, target_quantity) then
    return minimum, previous_formatted
  end
  local previous_number = E2_FX_HOMOGENEOUS_SET.comparable_formatted_number(previous_formatted, target_quantity)
  for sample_index = 1, 256 do
    local value = minimum + span * sample_index / 256
    local formatted = formatted_at(value)
    if E2_FX_HOMOGENEOUS_SET.formatted_matches(formatted, target, target_quantity) then
      return value, formatted
    end
    local number = E2_FX_HOMOGENEOUS_SET.comparable_formatted_number(formatted, target_quantity)
    if target_number and previous_number and number and number ~= previous_number
        and target_number >= math.min(previous_number, number)
        and target_number <= math.max(previous_number, number) then
      local low = previous_value
      local high = value
      local low_number = previous_number
      local high_number = number
      for _ = 1, 64 do
        local middle = (low + high) / 2
        local middle_formatted = formatted_at(middle)
        if E2_FX_HOMOGENEOUS_SET.formatted_matches(middle_formatted, target, target_quantity) then
          return middle, middle_formatted
        end
        local middle_number = E2_FX_HOMOGENEOUS_SET.comparable_formatted_number(middle_formatted, target_quantity)
        if not middle_number then break end
        if target_number >= math.min(low_number, middle_number)
            and target_number <= math.max(low_number, middle_number) then
          high = middle
          high_number = middle_number
        else
          low = middle
          low_number = middle_number
        end
      end
    end
    previous_value = value
    previous_formatted = formatted
    previous_number = number
  end
  for sample_index = 0, 4096 do
    local value = minimum + span * sample_index / 4096
    local is_match, formatted = matched(value)
    if is_match then return value, formatted end
  end
  return nil
end

function E2_FX_HOMOGENEOUS_SET.compile_controls(member, parameters, controls)
  if controls == nil then return json_array({}), nil end
  if not is_json_array(controls) or #controls < 1 or #controls > 8 then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_CONTROLS_SIZE_INVALID", "FX-set inspection accepts 1-8 natural-unit controls.")
  end
  local compiled = json_array({})
  local seen_ids = {}
  local seen_targets = {}
  for index = 1, #controls do
    local control = controls[index]
    local fields_ok, unexpected = E2_FX_HOMOGENEOUS_SET.only_fields(control, {
      id = true,
      param_index = true,
      param_ident = true,
      param_name = true,
      natural_value = true,
      display_value = true,
      tolerance = true,
    })
    local display_value = control.display_value or control.natural_value
    if not fields_ok or not is_string(control.id) or #control.id < 1 or #control.id > 24
        or not control.id:match("^[%w_-]+$") or seen_ids[control.id]
        or (control.display_value ~= nil and control.natural_value ~= nil)
        or not is_string(display_value) or display_value == "" then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_CONTROL_INVALID", "A natural-unit FX control is malformed or duplicated.", {
        control_index = index,
        field = unexpected and bounded_string(tostring(unexpected), 120) or JSON_NULL,
      })
    end
    local param_index = tonumber(control.param_index)
    if param_index ~= nil and (param_index < 0 or param_index ~= math.floor(param_index)) then param_index = nil end
    local matches = {}
    for candidate_index = 1, #parameters do
      local parameter = parameters[candidate_index]
      local matched = false
      if control.param_name ~= nil then
        matched = is_string(control.param_name) and parameter.name == control.param_name
      elseif param_index ~= nil then
        matched = parameter.param_index == param_index
          and (control.param_ident == nil or parameter.param_ident == control.param_ident)
      elseif is_string(control.param_ident) and control.param_ident ~= "" then
        matched = parameter.param_ident == control.param_ident
      end
      if matched then matches[#matches + 1] = parameter end
    end
    if #matches ~= 1 then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_PARAMETER_SELECTOR_AMBIGUOUS", "Each natural-unit FX control must resolve exactly one representative parameter.", {
        control_index = index,
        match_count = #matches,
      })
    end
    local parameter = matches[1]
    local target_key = tostring(parameter.param_index) .. ":" .. parameter.param_ident
    if seen_targets[target_key] then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_CONTROL_TARGET_DUPLICATE", "Natural-unit controls contain a duplicate exact parameter target.", {
        control_index = index,
      })
    end
    local value, native_formatted = E2_FX_HOMOGENEOUS_SET.search_formatted(
      member,
      parameter.param_index,
      display_value
    )
    if not value then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_NATURAL_VALUE_UNREACHABLE", "REAPER native formatting could not reach the requested natural-unit value without mutation.", {
        control_index = index,
        param_index = parameter.param_index,
        display_value = bounded_string(display_value, 80),
      })
    end
    local owner_kind = member.owner_kind or "take"
    local owner = member.owner or member.take
    local step_sizes = e2_fx_read_param_step_sizes(owner_kind, owner, member.slot_index, parameter.param_index)
    local tolerance = tonumber(control.tolerance)
    if not E2_FX_HOMOGENEOUS_SET.finite(tolerance) or tolerance < 0 then
      tolerance = step_sizes.is_discrete == true and 0 or 0.000001
    end
    seen_ids[control.id] = true
    seen_targets[target_key] = true
    compiled[#compiled + 1] = {
      id = control.id,
      param_index = parameter.param_index,
      param_ident = parameter.param_ident,
      param_name = parameter.name,
      natural_value = display_value,
      display_value = display_value,
      value = value,
      requested_formatted_value = native_formatted,
      tolerance = tolerance,
    }
  end
  return compiled, nil
end

function E2_FX_HOMOGENEOUS_SET.member_checks(members)
  local checks = json_array({})
  for index = 1, #members do
    local member = members[index]
    checks[#checks + 1] = {
      fx_ref = member.expected.fx_ref,
      take_ref = member.expected.take_ref,
      fx_guid = member.expected.fx_guid,
      plugin_id = member.expected.plugin_id,
      parameter_count = member.expected.parameter_count,
      layout_fingerprint = member.expected.layout_fingerprint,
      status = "passed",
    }
  end
  return checks
end

function E2_FX_HOMOGENEOUS_SET.inspect(request)
  local validated, validation_failure = E2_FX_HOMOGENEOUS_SET.validate_request(request, "inspect_set")
  if not validated then return nil, validation_failure end
  local project_before = e2_fx_current_project_truth()
  if not project_before then
    return nil, E2_FX_HOMOGENEOUS_SET.error("PROJECT_NOT_FOUND", "FX-set inspection could not bind the active native project instance.")
  end
  local members, resolved, member_failure = E2_FX_HOMOGENEOUS_SET.resolve_members(request, validated)
  if not members then return nil, member_failure end
  local parameters, inventory_failure = E2_FX_HOMOGENEOUS_SET.parameter_inventory(resolved.representative)
  if not parameters then return nil, inventory_failure end
  local compiled, compile_failure = E2_FX_HOMOGENEOUS_SET.compile_controls(
    resolved.representative,
    parameters,
    validated.params.controls
  )
  if not compiled then return nil, compile_failure end
  local project_after = e2_fx_current_project_truth()
  if not project_after or project_after.project_instance_id ~= project_before.project_instance_id then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_PROJECT_STALE", "The active native project changed during FX-set inspection.")
  end
  return e2_fx_read_summary(request, {
    mode = "inspect_set",
    set_fingerprint = validated.set_fingerprint,
    plugin_identity = validated.plugin,
    layout_fingerprint = validated.layout_fingerprint,
    representative_fx_ref = validated.params.expected_representative_fx_ref,
    member_count = #members,
    member_checks = E2_FX_HOMOGENEOUS_SET.member_checks(members),
    parameter_count = #parameters,
    parameters = parameters,
    compiled_controls = compiled,
    returned_count = #parameters,
    truncated = false,
    inventory_complete = true,
    coverage_status = "complete",
    project_instance_id = project_after.project_instance_id,
    native_project_instance_verified = true,
  }), nil, json_array({}), json_array({}), resolved.refs
end

function E2_FX_HOMOGENEOUS_SET.validate_compiled_controls(member, controls)
  if not is_json_array(controls) or #controls < 1 or #controls > 8 then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_PARAMETER_PLAN_SIZE_INVALID", "Shared FX plan accepts 1-8 compiled controls.")
  end
  local prepared = {}
  local seen_ids = {}
  local seen_targets = {}
  for index = 1, #controls do
    local control = controls[index]
    local fields_ok, unexpected = E2_FX_HOMOGENEOUS_SET.only_fields(control, {
      id = true,
      param_index = true,
      param_ident = true,
      param_name = true,
      natural_value = true,
      value = true,
      requested_formatted_value = true,
      tolerance = true,
    })
    local param_index = is_object(control) and tonumber(control.param_index) or nil
    local value = is_object(control) and tonumber(control.value) or nil
    local tolerance = is_object(control) and tonumber(control.tolerance) or nil
    if not fields_ok or not is_string(control.id) or #control.id < 1 or #control.id > 24
        or not control.id:match("^[%w_-]+$") or seen_ids[control.id]
        or not param_index or param_index < 0 or param_index ~= math.floor(param_index)
        or param_index >= member.layout.parameter_count
        or not is_string(control.param_ident) or control.param_ident == ""
        or not is_string(control.natural_value) or control.natural_value == ""
        or not is_string(control.requested_formatted_value) or control.requested_formatted_value == ""
        or not E2_FX_HOMOGENEOUS_SET.finite(value)
        or not E2_FX_HOMOGENEOUS_SET.finite(tolerance) or tolerance < 0 then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_PARAMETER_PLAN_CONTROL_INVALID", "A compiled shared FX control is malformed, stale, or duplicated.", {
        control_index = index,
        field = unexpected and bounded_string(tostring(unexpected), 120) or JSON_NULL,
      })
    end
    local live_ident = e2_fx_read_param_ident("take", member.take, member.slot_index, param_index)
    local live_name = e2_fx_read_param_name("take", member.take, member.slot_index, param_index)
    local native_formatted = E2_FX_HOMOGENEOUS_SET.format_at_value(
      member,
      param_index,
      value
    )
    local target_key = tostring(param_index) .. ":" .. control.param_ident
    if live_ident ~= control.param_ident
        or (control.param_name ~= nil and live_name ~= control.param_name)
        or native_formatted ~= control.requested_formatted_value or seen_targets[target_key] then
      return nil, E2_FX_HOMOGENEOUS_SET.error("FX_PARAMETER_PLAN_STALE", "A compiled shared FX control no longer matches native parameter identity or formatting.", {
        control_index = index,
        param_index = param_index,
        native_formatted_value = native_formatted or JSON_NULL,
      })
    end
    seen_ids[control.id] = true
    seen_targets[target_key] = true
    prepared[#prepared + 1] = {
      id = control.id,
      param_index = param_index,
      param_ident = control.param_ident,
      value = value,
      requested_formatted_value = control.requested_formatted_value,
      tolerance = tolerance,
    }
  end
  return prepared, nil
end

function E2_FX_HOMOGENEOUS_SET.member_results(members, controls, status)
  local results = json_array({})
  for index = 1, #members do
    local member = members[index]
    results[#results + 1] = {
      fx_ref = member.expected.fx_ref,
      take_ref = member.expected.take_ref,
      fx_guid = member.expected.fx_guid,
      plugin_id = member.expected.plugin_id,
      parameter_count = member.expected.parameter_count,
      layout_fingerprint = member.expected.layout_fingerprint,
      control_count = #controls,
      status = status,
    }
  end
  return results
end

function E2_FX_HOMOGENEOUS_SET.apply(request)
  local validated, validation_failure = E2_FX_HOMOGENEOUS_SET.validate_request(request, "shared_plan")
  if not validated then return nil, validation_failure end
  local project_before = e2_fx_current_project_truth()
  if not project_before then
    return nil, E2_FX_HOMOGENEOUS_SET.error("PROJECT_NOT_FOUND", "Shared FX plan could not bind the active native project instance.")
  end
  local members, resolved, member_failure = E2_FX_HOMOGENEOUS_SET.resolve_members(request, validated)
  if not members then return nil, member_failure end
  local controls, controls_failure = E2_FX_HOMOGENEOUS_SET.validate_compiled_controls(
    resolved.representative,
    validated.params.controls
  )
  if not controls then return nil, controls_failure end
  for member_index = 1, #members do
    local member = members[member_index]
    for control_index = 1, #controls do
      local control = controls[control_index]
      local live_ident = e2_fx_read_param_ident("take", member.take, member.slot_index, control.param_index)
      local native_formatted = E2_FX_HOMOGENEOUS_SET.format_at_value(
        member,
        control.param_index,
        control.value
      )
      if live_ident ~= control.param_ident or native_formatted ~= control.requested_formatted_value then
        return nil, E2_FX_HOMOGENEOUS_SET.error("FX_PARAMETER_PLAN_MEMBER_STALE", "A shared FX control does not match every member's native parameter identity and formatting.", {
          member_index = member_index,
          control_index = control_index,
          fx_ref = member.expected.fx_ref,
        })
      end
    end
  end
  if validated.params.dry_run == true then
    return e2_fx_write_summary(request, {
      mode = "shared_plan",
      set_fingerprint = validated.set_fingerprint,
      plan_hash = validated.params.plan_hash,
      layout_fingerprint = validated.layout_fingerprint,
      target_count = #members,
      control_count = #controls,
      mutation_count = 0,
      undo_block_count = 0,
      mutation_attempted = false,
      zero_write = true,
      member_results = E2_FX_HOMOGENEOUS_SET.member_results(members, controls, "planned"),
      project_instance_id = project_before.project_instance_id,
      native_project_instance_verified = true,
    }), nil, json_array({}), json_array({}), resolved.refs
  end

  local mutation_count = 0
  for member_index = 1, #members do
    local member = members[member_index]
    for control_index = 1, #controls do
      local control = controls[control_index]
      if not e2_fx_set_param_value(
        "take",
        member.take,
        member.slot_index,
        control.param_index,
        control.value
      ) then
        return nil, E2_FX_HOMOGENEOUS_SET.error("COMMAND_FAILED", "REAPER rejected one shared FX parameter setter.", {
          member_index = member_index,
          control_index = control_index,
          mutation_attempted = mutation_count > 0,
          completed_mutations = mutation_count,
          zero_write = mutation_count == 0,
        }, false)
      end
      mutation_count = mutation_count + 1
    end
  end

  for member_index = 1, #members do
    local member = members[member_index]
    if e2_fx_read_guid("take", member.take, member.slot_index) ~= member.expected.fx_guid
        or e2_fx_read_plugin_id("take", member.take, member.slot_index) ~= member.expected.plugin_id then
      return nil, E2_FX_HOMOGENEOUS_SET.error("VERIFY_FAILED", "Shared FX aggregate readback lost exact member identity.", {
        member_index = member_index,
        mutation_attempted = true,
        completed_mutations = mutation_count,
        zero_write = false,
      }, false)
    end
    for control_index = 1, #controls do
      local control = controls[control_index]
      local values = e2_fx_read_param_value("take", member.take, member.slot_index, control.param_index)
      local formatted = e2_fx_read_param_formatted("take", member.take, member.slot_index, control.param_index)
      local updated = E2_FX_HOMOGENEOUS_SET.finite(values.value)
        and math.abs(values.value - control.value) <= control.tolerance
        and E2_FX_HOMOGENEOUS_SET.formatted_readback_matches(
          formatted,
          control.requested_formatted_value
        )
      if not updated then
        return nil, E2_FX_HOMOGENEOUS_SET.error("VERIFY_FAILED", "Shared FX aggregate readback did not match every native control target.", {
          member_index = member_index,
          control_index = control_index,
          mutation_attempted = true,
          completed_mutations = mutation_count,
          zero_write = false,
          readback_value = values.value,
          readback_formatted_value = formatted,
        }, false)
      end
    end
  end
  local project_after = e2_fx_current_project_truth()
  if not project_after or project_after.project_instance_id ~= project_before.project_instance_id then
    return nil, E2_FX_HOMOGENEOUS_SET.error("FX_SET_PROJECT_STALE", "The active native project changed during shared FX mutation/readback.", {
      mutation_attempted = true,
      completed_mutations = mutation_count,
      zero_write = false,
    }, false)
  end
  return e2_fx_write_summary(request, {
    mode = "shared_plan",
    set_fingerprint = validated.set_fingerprint,
    plan_hash = validated.params.plan_hash,
    layout_fingerprint = validated.layout_fingerprint,
    target_count = #members,
    control_count = #controls,
    mutation_count = mutation_count,
    undo_block_count = 1,
    mutation_attempted = true,
    zero_write = false,
    member_results = E2_FX_HOMOGENEOUS_SET.member_results(members, controls, "passed"),
    project_instance_id = project_after.project_instance_id,
    native_project_instance_verified = true,
  }), nil, json_array({}), json_array({}), resolved.refs
end

local function e2_fx_take_fanout_error(code, message, details, recoverable)
  return E2_FX_HOMOGENEOUS_SET.contract_error(code, message, details, recoverable)
end

local function e2_fx_add_take_fx_fanout(request)
  local params = is_object(request.params) and request.params or {}
  if params.duplicate_policy ~= "reuse_exact" or params.include_parameter_layout ~= true
      or params.dry_run ~= false or not e2_fx_fanout_binding_valid(params.target_binding) then
    return e2_fx_take_fanout_error(
      "FX_SET_REQUEST_INVALID",
      "Track-owned Take-FX fanout requires duplicate_policy=reuse_exact, include_parameter_layout=true, dry_run=false, and the exact active-Take batch binding."
    )
  end
  for key in pairs(params) do
    if key ~= "plugin_name" and key ~= "duplicate_policy" and key ~= "include_parameter_layout"
        and key ~= "dry_run" and key ~= "target_binding" then
      return e2_fx_take_fanout_error("FX_SET_REQUEST_INVALID", "Track-owned Take-FX fanout received an unsupported parameter.", {
        field = bounded_string(tostring(key), 120),
      })
    end
  end

  local track, track_ref, track_blocker = e2_fx_exact_fanout_track(request)
  if not track then
    return e2_fx_take_fanout_error(track_blocker, "Track-owned Take-FX fanout requires one live exact Track GUID object ref.")
  end
  local plugin_name = e2_fx_plugin_name(request)
  if not plugin_name then
    return e2_fx_take_fanout_error("PARAMS_INVALID", "Track-owned Take-FX fanout requires one exact installed plugin_name.")
  end
  local installed, installed_blocker = e2_fx_exact_installed_plugin(plugin_name)
  if not installed then
    return e2_fx_take_fanout_error("FX_NOT_FOUND", "Track-owned Take-FX fanout could not prove one exact installed plug-in identity.", {
      plugin_name = plugin_name,
      blocker = installed_blocker,
    })
  end
  local project_truth = e2_fx_current_project_truth()
  if not project_truth then
    return e2_fx_take_fanout_error("PROJECT_NOT_FOUND", "Track-owned Take-FX fanout could not bind the active native project instance.")
  end

  local ok_count, raw_item_count = call_reaper("CountTrackMediaItems", track)
  local item_count = ok_count and first_number(raw_item_count) or nil
  if type(item_count) ~= "number" or item_count < 0 or item_count ~= math.floor(item_count) then
    return e2_fx_take_fanout_error("API_UNAVAILABLE", "REAPER did not return the target Track Item count.", {
      api = "CountTrackMediaItems",
    })
  end
  if item_count < 1 or item_count > E2_FX_TAKE_FANOUT_MAX_TARGETS then
    return e2_fx_take_fanout_error("FX_SET_CARDINALITY_INVALID", "Track-owned Take-FX fanout accepts 1-64 active audio Take targets.", {
      target_count = item_count,
      maximum = E2_FX_TAKE_FANOUT_MAX_TARGETS,
    })
  end

  local prepared = {}
  local seen_items = {}
  local seen_takes = {}
  local expected_layout = nil
  local expected_plugin_id = nil
  for item_index = 0, item_count - 1 do
    local ok_item, item = call_reaper("GetTrackMediaItem", track, item_index)
    local item_guid = ok_item and item and e2_fx_native_item_guid(item) or nil
    if not item_guid or seen_items[item_guid] then
      return e2_fx_take_fanout_error("FX_SET_ITEM_IDENTITY_INVALID", "Track-owned Take-FX fanout could not prove one unique native Item GUID for every target.", {
        item_index = item_index,
      })
    end
    seen_items[item_guid] = true
    local ok_take, take = call_reaper("GetActiveTake", item)
    if not ok_take or not take then
      return e2_fx_take_fanout_error("FX_SET_ACTIVE_TAKE_MISSING", "A target Item has no active Take; the complete FX set remains zero-write.", {
        item_ref = "item:guid:" .. item_guid,
      })
    end
    local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
    if not ok_midi then
      return e2_fx_take_fanout_error("API_UNAVAILABLE", "REAPER could not classify an active Take as audio or MIDI.", {
        api = "TakeIsMIDI",
        item_ref = "item:guid:" .. item_guid,
      })
    end
    if is_midi == true then
      return e2_fx_take_fanout_error("FX_SET_MIDI_UNSUPPORTED", "Track-owned Take-FX fanout accepts audio active Takes only.", {
        item_ref = "item:guid:" .. item_guid,
      })
    end
    local take_guid = e2_fx_read_take_guid(take)
    if not take_guid or seen_takes[take_guid] then
      return e2_fx_take_fanout_error("FX_SET_TAKE_IDENTITY_INVALID", "Track-owned Take-FX fanout could not prove one unique native Take GUID for every target.", {
        item_ref = "item:guid:" .. item_guid,
      })
    end
    seen_takes[take_guid] = true

    local ok_fx_count, raw_fx_count = call_reaper("TakeFX_GetCount", take)
    local fx_count = ok_fx_count and first_number(raw_fx_count) or nil
    if type(fx_count) ~= "number" or fx_count < 0 or fx_count ~= math.floor(fx_count)
        or fx_count > E2_FX_CHAIN_MAX_INSTANCES then
      return e2_fx_take_fanout_error("FX_SET_CHAIN_COVERAGE_INVALID", "An active Take did not expose one complete bounded FX chain.", {
        take_ref = "take:guid:" .. take_guid,
      })
    end
    local matched_slot = nil
    local matched_plugin_id = nil
    for slot_index = 0, fx_count - 1 do
      local live_plugin_id = e2_fx_read_plugin_id("take", take, slot_index)
      if not live_plugin_id then
        return e2_fx_take_fanout_error("FX_SET_PLUGIN_IDENTITY_UNAVAILABLE", "An existing Take FX lacks native plug-in identity, so duplicate analysis cannot complete safely.", {
          take_ref = "take:guid:" .. take_guid,
          slot_index = slot_index,
        })
      elseif e2_fx_installed_identity_matches_live(installed.ident, live_plugin_id) then
        if matched_slot ~= nil then
          return e2_fx_take_fanout_error("FX_SET_DUPLICATE_AMBIGUOUS", "An active Take contains multiple instances of the exact requested plug-in identity.", {
            take_ref = "take:guid:" .. take_guid,
            plugin_id = installed.ident,
          })
        end
        matched_slot = slot_index
        matched_plugin_id = live_plugin_id
      end
    end

    local layout = nil
    local fx_guid = nil
    if matched_slot ~= nil then
      if expected_plugin_id and expected_plugin_id ~= matched_plugin_id then
        return e2_fx_take_fanout_error("FX_SET_PLUGIN_IDENTITY_MISMATCH", "Reusable Take FX instances do not share one exact native plug-in identity.", {
          take_ref = "take:guid:" .. take_guid,
          expected_plugin_id = expected_plugin_id,
          live_plugin_id = matched_plugin_id,
        })
      end
      expected_plugin_id = expected_plugin_id or matched_plugin_id
      fx_guid = e2_fx_read_guid("take", take, matched_slot)
      if not fx_guid then
        return e2_fx_take_fanout_error("FX_SET_FX_GUID_UNAVAILABLE", "A reusable Take FX did not expose an exact native FX GUID.", {
          take_ref = "take:guid:" .. take_guid,
          slot_index = matched_slot,
        })
      end
      local layout_blocker
      layout, layout_blocker = e2_fx_parameter_layout("take", take, matched_slot, matched_plugin_id, plugin_name)
      if not layout then
        return e2_fx_take_fanout_error(layout_blocker, "A reusable Take FX did not expose a complete stable parameter layout.", {
          take_ref = "take:guid:" .. take_guid,
          slot_index = matched_slot,
        })
      end
      if expected_layout and expected_layout.layout_fingerprint ~= layout.layout_fingerprint then
        return e2_fx_take_fanout_error("FX_SET_LAYOUT_MISMATCH", "Reusable Take FX instances do not share one exact parameter layout.", {
          take_ref = "take:guid:" .. take_guid,
          expected_layout_fingerprint = expected_layout.layout_fingerprint,
          live_layout_fingerprint = layout.layout_fingerprint,
        })
      end
      expected_layout = expected_layout or layout
    end
    prepared[#prepared + 1] = {
      item = item,
      take = take,
      item_ref = "item:guid:" .. item_guid,
      take_ref = "take:guid:" .. take_guid,
      fx_count_before = fx_count,
      slot_index = matched_slot,
      fx_guid = fx_guid,
      layout = layout,
      status = matched_slot ~= nil and "reused" or "created",
    }
  end

  local mutation_count = 0
  for index = 1, #prepared do
    local member = prepared[index]
    if member.slot_index == nil then
      local slot_index = e2_fx_take_add_by_name(member.take, plugin_name, member.fx_count_before)
      mutation_count = mutation_count + 1
      local fx_count_after = e2_fx_read_count("take", member.take)
      if not slot_index or slot_index < 0 or fx_count_after ~= member.fx_count_before + 1 then
        return e2_fx_take_fanout_error("COMMAND_FAILED", "REAPER rejected one prepared Take-FX creation.", {
          member_index = index,
          item_ref = member.item_ref,
          mutation_attempted = true,
          zero_write = false,
          completed_mutations = mutation_count - 1,
        }, false)
      end
      member.slot_index = slot_index
      member.fx_guid = e2_fx_read_guid("take", member.take, slot_index)
      local live_plugin_id = e2_fx_read_plugin_id("take", member.take, slot_index)
      local layout, layout_blocker = e2_fx_parameter_layout("take", member.take, slot_index, live_plugin_id or "", plugin_name)
      if not member.fx_guid or not e2_fx_installed_identity_matches_live(installed.ident, live_plugin_id) or not layout then
        return e2_fx_take_fanout_error("VERIFY_FAILED", "A created Take FX did not preserve exact native plug-in, GUID, and layout identity.", {
          member_index = index,
          item_ref = member.item_ref,
          blocker = layout_blocker,
          mutation_attempted = true,
          zero_write = false,
          completed_mutations = mutation_count,
        }, false)
      end
      if expected_plugin_id and expected_plugin_id ~= live_plugin_id then
        return e2_fx_take_fanout_error("FX_SET_PLUGIN_IDENTITY_MISMATCH", "A created Take FX did not match the homogeneous set native plug-in identity.", {
          member_index = index,
          item_ref = member.item_ref,
          expected_plugin_id = expected_plugin_id,
          live_plugin_id = live_plugin_id,
          mutation_attempted = true,
          zero_write = false,
          completed_mutations = mutation_count,
        }, false)
      end
      expected_plugin_id = expected_plugin_id or live_plugin_id
      if expected_layout and expected_layout.layout_fingerprint ~= layout.layout_fingerprint then
        return e2_fx_take_fanout_error("FX_SET_LAYOUT_MISMATCH", "A created Take FX did not match the homogeneous set parameter layout.", {
          member_index = index,
          item_ref = member.item_ref,
          expected_layout_fingerprint = expected_layout.layout_fingerprint,
          live_layout_fingerprint = layout.layout_fingerprint,
          mutation_attempted = true,
          zero_write = false,
          completed_mutations = mutation_count,
        }, false)
      end
      expected_layout = expected_layout or layout
      member.layout = layout
    end
  end

  local members = json_array({})
  local refs = json_array({})
  local created_count = 0
  local reused_count = 0
  local seen_fx_guids = {}
  for index = 1, #prepared do
    local member = prepared[index]
    local live_plugin_id = e2_fx_read_plugin_id("take", member.take, member.slot_index)
    local live_fx_guid = e2_fx_read_guid("take", member.take, member.slot_index)
    local live_layout, layout_blocker = e2_fx_parameter_layout(
      "take",
      member.take,
      member.slot_index,
      live_plugin_id or "",
      plugin_name
    )
    if not e2_fx_installed_identity_matches_live(installed.ident, live_plugin_id)
        or live_plugin_id ~= expected_plugin_id or live_fx_guid ~= member.fx_guid or not live_layout
        or live_layout.layout_fingerprint ~= expected_layout.layout_fingerprint or seen_fx_guids[live_fx_guid] then
      return e2_fx_take_fanout_error("VERIFY_FAILED", "Aggregate Take-FX set readback did not preserve exact unique member identity and layout truth.", {
        member_index = index,
        item_ref = member.item_ref,
        blocker = layout_blocker,
        mutation_attempted = mutation_count > 0,
        zero_write = mutation_count == 0,
        completed_mutations = mutation_count,
      }, false)
    end
    seen_fx_guids[live_fx_guid] = true
    local fx_ref = e2_fx_read_fx_object_ref("take", member.take_ref, member.slot_index, plugin_name)
    refs[#refs + 1] = fx_ref
    members[#members + 1] = {
      track_ref = track_ref,
      item_ref = member.item_ref,
      take_ref = member.take_ref,
      fx_ref = fx_ref.ref,
      fx_guid = live_fx_guid,
      plugin_id = live_plugin_id,
      parameter_count = live_layout.parameter_count,
      layout_fingerprint = live_layout.layout_fingerprint,
      status = member.status,
    }
    if member.status == "created" then created_count = created_count + 1 else reused_count = reused_count + 1 end
  end
  local after_truth = e2_fx_current_project_truth()
  if not after_truth or after_truth.project_instance_id ~= project_truth.project_instance_id then
    return e2_fx_take_fanout_error("VERIFY_FAILED", "The active native project instance changed during Take-FX fanout.", {
      mutation_attempted = mutation_count > 0,
      zero_write = mutation_count == 0,
      completed_mutations = mutation_count,
    }, false)
  end

  return e2_fx_write_summary(request, {
    mode = "track_owned_active_take_fx_set",
    track_ref = track_ref,
    member_count = #members,
    members = members,
    representative_fx_ref = members[1].fx_ref,
    plugin_identity = {
      name = plugin_name,
      plugin_id = expected_plugin_id,
      installed_index = installed.index,
    },
    layout_fingerprint = expected_layout.layout_fingerprint,
    project_ref = project_truth.project_ref,
    project_path = project_truth.project_path,
    project_instance_id = project_truth.project_instance_id,
    native_project_instance_verified = true,
    project_state_change_count_before = project_truth.state_change_count,
    project_state_change_count_after = after_truth.state_change_count,
    created_count = created_count,
    reused_count = reused_count,
    mutation_attempted = mutation_count > 0,
    native_mutation_count = mutation_count,
    aggregate_verification = {
      status = "passed",
      member_count = #members,
      exact_identity = true,
      homogeneous_layout = true,
      project_instance_preserved = true,
    },
  }), nil, json_array({}), json_array({}), refs
end

local function add_take_fx(request)
  if is_object(request.params) and request.params.target_binding ~= nil then
    return e2_fx_add_take_fx_fanout(request)
  end
  local take = e2_fx_read_take_from_request_refs(request)
  if not take then
    return e2_fx_read_error("TAKE_NOT_FOUND", "E2 FX-B1 add_take_fx requires a resolvable take ref.")
  end
  local plugin_name = e2_fx_plugin_name(request)
  if not plugin_name then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_take_fx requires a non-empty plugin_name.")
  end
  local before_count = e2_fx_read_count("take", take)
  local insert_index = e2_fx_insert_index(request, before_count)
  if not insert_index then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_take_fx insert_at_index is outside the take FX chain.", {
      fx_count = before_count,
      insert_at_index = request.params and request.params.insert_at_index,
    })
  end
  local slot_index = e2_fx_take_add_by_name(take, plugin_name, insert_index)
  if not slot_index or slot_index < 0 then
    return e2_fx_read_error("FX_NOT_FOUND", "E2 FX-B1 add_take_fx could not instantiate the requested FX.", {
      plugin_name = plugin_name,
    })
  end
  local after_count = e2_fx_read_count("take", take)
  if after_count <= before_count then
    return e2_fx_read_error("COMMAND_FAILED", "E2 FX-B1 add_take_fx did not increase the take FX count.", {
      before_count = before_count,
      after_count = after_count,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary("take", take, slot_index)
  summary.plugin_name = plugin_name
  summary.fx_count_before = before_count
  summary.fx_count_after = after_count
  summary.created = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_bypass(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 set_fx_bypass requires a resolvable FX ref.")
  end
  if type(request.params and request.params.enabled) ~= "boolean" then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 set_fx_bypass requires boolean enabled.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-B1 set_fx_bypass slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local enabled = request.params.enabled == true
  if not e2_fx_set_enabled(owner_kind, owner, slot_index, enabled) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX enabled-state update.", {}, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.requested_enabled = enabled
  summary.updated = summary.enabled == enabled
  if not summary.updated then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX-B1 set_fx_bypass did not read back the requested enabled state.", {
      requested_enabled = enabled,
      readback_enabled = summary.enabled,
    }, false)
  end
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_parameter_normalized(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 set_fx_parameter_normalized requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX-B1 set_fx_parameter_normalized requires a non-negative integer param_index.")
  end
  local has_normalized_value = request.params and request.params.normalized_value ~= nil
  local has_display_value = request.params and request.params.display_value ~= nil
  if has_normalized_value == has_display_value then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 requires exactly one normalized_value or display_value.")
  end
  local normalized_value = has_normalized_value and tonumber(request.params.normalized_value) or nil
  if has_normalized_value and (not normalized_value or normalized_value < 0 or normalized_value > 1) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 normalized_value must be between 0 and 1.", {
      normalized_value = request.params.normalized_value,
    })
  end
  local display_value = has_display_value and request.params.display_value or nil
  if has_display_value and (not is_string(display_value) or display_value == "" or #display_value > 80) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 display_value must be one bounded native-formatted target string.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX-B1 set_fx_parameter_normalized index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  local param_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
  if not param_ident then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_UNAVAILABLE", "REAPER did not return a stable identity for the exact FX parameter.", {
      param_index = param_index,
    })
  end
  local requested_ident = request.params and request.params.param_ident
  if is_string(requested_ident) and requested_ident ~= param_ident then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_MISMATCH", "Requested param_ident does not match the exact live FX parameter.", {
      requested_param_ident = bounded_string(requested_ident, 160),
      live_param_ident = param_ident,
    })
  end
  local step_sizes = e2_fx_read_param_step_sizes(owner_kind, owner, slot_index, param_index)
  local requested_value
  local requested_formatted_value
  if has_display_value then
    requested_value, requested_formatted_value = E2_FX_HOMOGENEOUS_SET.search_formatted({
      owner_kind = owner_kind,
      owner = owner,
      slot_index = slot_index,
    }, param_index, display_value)
    if not requested_value then
      return e2_fx_read_error("FX_DISPLAY_VALUE_UNREACHABLE", "REAPER native formatting could not reach the requested FX display value without mutation.", {
        param_index = param_index,
        display_value = bounded_string(display_value, 80),
        zero_write = true,
      })
    end
  else
    requested_formatted_value = e2_fx_format_param_normalized(
      owner_kind,
      owner,
      slot_index,
      param_index,
      normalized_value
    )
  end
  local accepted
  if has_display_value then
    accepted = e2_fx_set_param_value(owner_kind, owner, slot_index, param_index, requested_value)
  else
    accepted = e2_fx_set_param_normalized(owner_kind, owner, slot_index, param_index, normalized_value)
  end
  if not accepted then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX parameter update.", {}, false)
  end
  local tolerance = tonumber(request.params and request.params.tolerance)
    or (has_display_value and 0.000001 or 0.001)
  if tolerance < 0 then
    tolerance = has_display_value and 0.000001 or 0.001
  end
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local readback_normalized = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local readback_formatted_value = e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index)
  if not has_display_value and step_sizes.is_discrete ~= true
      and type(requested_formatted_value) == "string"
      and requested_formatted_value == readback_formatted_value
      and e2_fx_infer_native_discrete_format(
        owner_kind,
        owner,
        slot_index,
        param_index,
        requested_formatted_value
      ) then
    step_sizes.is_discrete = true
  end
  local updated
  local verification_mode
  if has_display_value then
    updated = E2_FX_HOMOGENEOUS_SET.finite(values.value)
      and math.abs(values.value - requested_value) <= tolerance
      and E2_FX_HOMOGENEOUS_SET.formatted_readback_matches(
        readback_formatted_value,
        requested_formatted_value
      )
    verification_mode = "native_display_value"
  else
    updated, verification_mode = e2_fx_parameter_readback_matches(
      normalized_value,
      requested_formatted_value,
      readback_normalized,
      readback_formatted_value,
      tolerance,
      step_sizes
    )
  end
  if not updated then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX-B1 set_fx_parameter_normalized did not read back the requested normalized or native display value.", {
      requested_normalized_value = has_normalized_value and normalized_value or JSON_NULL,
      requested_display_value = has_display_value and display_value or JSON_NULL,
      requested_value = has_display_value and requested_value or JSON_NULL,
      requested_formatted_value = requested_formatted_value or JSON_NULL,
      readback_normalized_value = readback_normalized,
      readback_formatted_value = readback_formatted_value,
      tolerance = tolerance,
      step_sizes_available = step_sizes.step_sizes_available,
      step_size = step_sizes.step_size,
      small_step_size = step_sizes.small_step_size,
      large_step_size = step_sizes.large_step_size,
      is_toggle = step_sizes.is_toggle,
      is_discrete = step_sizes.is_discrete,
    }, false)
  end
  local _, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_write_summary(request, {
    fx_ref = ref.ref,
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = param_ident,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = readback_normalized,
    formatted_value = readback_formatted_value,
    requested_normalized_value = has_normalized_value and normalized_value or JSON_NULL,
    requested_display_value = has_display_value and display_value or JSON_NULL,
    requested_value = has_display_value and requested_value or JSON_NULL,
    requested_formatted_value = requested_formatted_value or JSON_NULL,
    tolerance = tolerance,
    verification_mode = verification_mode,
    step_sizes_available = step_sizes.step_sizes_available,
    step_size = step_sizes.step_size,
    small_step_size = step_sizes.small_step_size,
    large_step_size = step_sizes.large_step_size,
    is_toggle = step_sizes.is_toggle,
    is_discrete = step_sizes.is_discrete,
    updated = updated,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local E2_FX_PARAMETER_ASSIGNMENTS_BATCH_MAX_ROWS = 64
local E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE = 8

local function e2_fx_batch_finite(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function e2_fx_batch_error(code, message, details)
  local _, failure = e2_fx_read_error(code, message, details)
  return nil, failure
end

local function e2_fx_batch_exact_ref(ref)
  if not is_object(ref) or ref.kind ~= "fx" or not is_string(ref.ref) then
    return nil
  end
  local owner_kind
  local owner_ref, slot_text = ref.ref:match("^fx:(track:[^:]+:.+):(%d+)$")
  if owner_ref then
    owner_kind = "track"
  else
    owner_ref, slot_text = ref.ref:match("^fx:(take:[^:]+:.+):(%d+)$")
    if owner_ref then
      owner_kind = "take"
    end
  end
  if not owner_kind or not owner_ref or not slot_text then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  local expected_scheme = owner_kind .. "_fx"
  local expected_value = owner_ref .. ":" .. slot_text
  if identity.scheme ~= expected_scheme or identity.value ~= expected_value then
    return nil
  end
  return owner_kind, owner_ref, math.floor(tonumber(slot_text))
end

local function e2_fx_batch_ref_map(request)
  if not is_json_array(request.refs) then
    return e2_fx_batch_error("PARAMS_INVALID", "FX assignment batch requires an exact FX ref array.", { zero_write = true })
  end
  local refs = {}
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if not e2_fx_batch_exact_ref(ref) then
      return e2_fx_batch_error("FX_REF_INVALID", "FX assignment batch rejected a malformed or contradictory FX object ref.", { ref_index = index, zero_write = true })
    end
    if refs[ref.ref] then
      return e2_fx_batch_error("FX_REF_DUPLICATE", "FX assignment batch received a duplicate FX object ref.", { ref = ref.ref, zero_write = true })
    end
    refs[ref.ref] = ref
  end
  return refs
end

local function e2_fx_batch_row_failure(code, message, index, details)
  details = details or {}
  details.row_index = index
  details.zero_write = details.zero_write ~= false
  local _, failure = e2_fx_read_error(code, message, details)
  return failure
end

local function e2_fx_batch_validate_rows(request, ref_map)
  local params = request.params or {}
  local batch = params.batch
  if not is_json_array(batch) or #batch < 1 or #batch > E2_FX_PARAMETER_ASSIGNMENTS_BATCH_MAX_ROWS then
    return e2_fx_batch_error("BATCH_LIMIT_EXCEEDED", "FX assignment batch accepts 1-64 rows.", { row_count = is_json_array(batch) and #batch or 0, zero_write = true })
  end
  if type(params.dry_run) ~= "boolean" then
    return e2_fx_batch_error("PARAMS_INVALID", "FX assignment batch dry_run must be boolean.", { zero_write = true })
  end
  local seen = {}
  local prepared = {}
  for index = 1, #batch do
    local row = batch[index]
    if not is_object(row) then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch rows must be objects.", index)
    end
    for key in pairs(row) do
      if key ~= "id" and key ~= "fx_ref" and key ~= "param_index" and key ~= "param_ident"
          and key ~= "param_name" and key ~= "normalized_value" and key ~= "display_value"
          and key ~= "requested_formatted_value" then
        return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch row contains an unsupported field.", index, { field = key })
      end
    end
    if not is_string(row.id) or row.id == "" or #row.id > 12 or seen[row.id] then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch row id must be unique and bounded.", index)
    end
    seen[row.id] = true
    if not is_string(row.fx_ref) or not ref_map[row.fx_ref] then
      return nil, e2_fx_batch_row_failure("FX_REF_NOT_FOUND", "FX assignment batch row requires a matching exact FX object ref.", index, { fx_ref = row.fx_ref })
    end
    local has_index = row.param_index ~= nil
    local has_ident = is_string(row.param_ident) and row.param_ident ~= ""
    local has_name = is_string(row.param_name) and row.param_name ~= ""
    if (has_index and has_name) or (has_ident and has_name) or (not has_index and not has_ident and not has_name) then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch row requires exactly one parameter selector.", index)
    end
    local param_index = has_index and tonumber(row.param_index) or nil
    if has_index and (not param_index or param_index < 0 or param_index ~= math.floor(param_index)) then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch param_index must be a non-negative integer.", index)
    end
    local has_normalized_value = row.normalized_value ~= nil
    local has_display_value = row.display_value ~= nil
    if has_normalized_value == has_display_value then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch row requires exactly one normalized_value or display_value.", index)
    end
    local normalized_value = has_normalized_value and tonumber(row.normalized_value) or nil
    if has_normalized_value and (not e2_fx_batch_finite(normalized_value) or normalized_value < 0 or normalized_value > 1) then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch normalized_value must be finite and between 0 and 1.", index)
    end
    if has_display_value and (not is_string(row.display_value) or row.display_value == "" or #row.display_value > 80) then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch display_value must be one bounded native-formatted target string.", index)
    end
    if row.requested_formatted_value ~= nil and (not is_string(row.requested_formatted_value) or row.requested_formatted_value == "") then
      return nil, e2_fx_batch_row_failure("PARAMS_INVALID", "FX assignment batch requested_formatted_value must be a non-empty string.", index)
    end
    local owner_kind, owner, slot_index = e2_fx_read_fx_owner_from_ref_object(ref_map[row.fx_ref], request)
    if not owner or not owner_kind or slot_index == nil then
      return nil, e2_fx_batch_row_failure("FX_REF_NOT_FOUND", "FX assignment batch could not resolve the exact FX owner.", index, { fx_ref = row.fx_ref })
    end
    local parameter_count = e2_fx_read_param_count(owner_kind, owner, slot_index)
    if param_index == nil then
      for candidate = 0, parameter_count - 1 do
        local candidate_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, candidate)
        local candidate_name = e2_fx_read_param_name(owner_kind, owner, slot_index, candidate)
        if (has_ident and candidate_ident == row.param_ident)
            or (has_name and type(candidate_name) == "string" and string.lower(candidate_name) == string.lower(row.param_name)) then
          param_index = candidate
          break
        end
      end
    end
    if param_index == nil or param_index >= parameter_count then
      return nil, e2_fx_batch_row_failure("FX_PARAMETER_NOT_FOUND", "FX assignment batch selector did not resolve to a live parameter.", index, { parameter_count = parameter_count })
    end
    local live_ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
    local live_name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
    if not live_ident then
      return nil, e2_fx_batch_row_failure("FX_PARAMETER_IDENTITY_UNAVAILABLE", "FX assignment batch could not prove stable native parameter identity.", index, { param_index = param_index })
    end
    if has_ident and live_ident ~= row.param_ident then
      return nil, e2_fx_batch_row_failure("FX_PARAMETER_IDENTITY_MISMATCH", "FX assignment batch param_ident does not match native identity.", index, { live_param_ident = live_ident })
    end
    if has_name and (type(live_name) ~= "string" or string.lower(live_name) ~= string.lower(row.param_name)) then
      return nil, e2_fx_batch_row_failure("FX_PARAMETER_NAME_MISMATCH", "FX assignment batch param_name does not match native name.", index, { live_param_name = live_name })
    end
    local value
    local formatted
    if has_display_value then
      value, formatted = E2_FX_HOMOGENEOUS_SET.search_formatted({
        owner_kind = owner_kind,
        owner = owner,
        slot_index = slot_index,
      }, param_index, row.display_value)
      if not value then
        return nil, e2_fx_batch_row_failure("FX_DISPLAY_VALUE_UNREACHABLE", "REAPER native formatting could not reach the requested FX display value without mutation.", index, {
          display_value = bounded_string(row.display_value, 80),
        })
      end
    else
      formatted = e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, normalized_value)
    end
    if not is_string(formatted) or formatted == "" then
      return nil, e2_fx_batch_row_failure("API_UNAVAILABLE", "FX assignment batch could not format the native target value.", index)
    end
    if is_string(row.requested_formatted_value)
        and not E2_FX_HOMOGENEOUS_SET.formatted_readback_matches(formatted, row.requested_formatted_value) then
      return nil, e2_fx_batch_row_failure("FX_ASSIGNMENTS_FORMATTED_TARGET_MISMATCH", "FX assignment batch requested formatted value does not match native formatting.", index, { requested_formatted_value = row.requested_formatted_value, native_formatted_value = formatted })
    end
    local step_sizes = e2_fx_read_param_step_sizes(owner_kind, owner, slot_index, param_index)
    prepared[#prepared + 1] = {
      row = row,
      owner_kind = owner_kind,
      owner = owner,
      slot_index = slot_index,
      param_index = param_index,
      param_ident = live_ident,
      name = live_name,
      normalized_value = normalized_value,
      value = value,
      display_value = row.display_value,
      requested_formatted_value = formatted,
      step_sizes = step_sizes,
      tolerance = has_display_value and 0.000001 or step_sizes.is_discrete == true and 0 or 0.001,
    }
  end
  return prepared
end

local function e2_fx_parameter_assignments_batch(request)
  if is_object(request.params) and request.params.mode == "shared_plan" then
    return E2_FX_HOMOGENEOUS_SET.apply(request)
  end
  local ref_map, ref_failure = e2_fx_batch_ref_map(request)
  if not ref_map then return nil, ref_failure end
  local prepared, validation_failure = e2_fx_batch_validate_rows(request, ref_map)
  if not prepared then return nil, validation_failure end
  local dry_run = request.params.dry_run == true
  local result_rows = json_array({})
  local refs = json_array({})
  for ref in pairs(ref_map) do
    local object_ref = ref_map[ref]
    refs[#refs + 1] = object_ref
  end
  local batch_timings = { preflight_ms = 0, mutation_ms = 0, readback_ms = 0, transport_ms = 0, rows = #prepared, chunk_size = E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE, chunks = math.ceil(#prepared / E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE), runner = "e2_generic_fx_native_serial_batch", native_mutation_count = 0, native_readback_count = 0 }
  local preflight_started = os.clock()
  batch_timings.preflight_ms = (os.clock() - preflight_started) * 1000
  if dry_run then
    for index = 1, #prepared do
      local item = prepared[index]
      result_rows[#result_rows + 1] = {
        id = item.row.id,
        fx_ref = item.row.fx_ref,
        param_index = item.param_index,
        param_ident = item.param_ident,
        name = item.name,
        value = item.display_value ~= nil and item.value or JSON_NULL,
        normalized_value = item.normalized_value or JSON_NULL,
        formatted_value = item.requested_formatted_value,
        requested_normalized_value = item.display_value == nil and item.normalized_value or JSON_NULL,
        requested_display_value = item.display_value or JSON_NULL,
        requested_value = item.display_value ~= nil and item.value or JSON_NULL,
        requested_formatted_value = item.requested_formatted_value,
        tolerance = item.tolerance,
        verification_mode = item.display_value ~= nil and "native_display_value"
          or item.tolerance == 0 and "native_discrete_format" or "numeric_tolerance",
        updated = true,
        readback_status = "preflight_passed",
      }
    end
    return e2_fx_read_summary(request, { rows = result_rows, mutation_attempted = false, batch_timings = batch_timings }), nil, json_array({}), json_array({}), refs
  end

  local mutation_started = os.clock()
  local mutation_failure = nil
  for chunk_start = 1, #prepared, E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE do
    local chunk_end = math.min(#prepared, chunk_start + E2_FX_PARAMETER_ASSIGNMENTS_BATCH_CHUNK_SIZE - 1)
    for index = chunk_start, chunk_end do
      local item = prepared[index]
      batch_timings.native_mutation_count = batch_timings.native_mutation_count + 1
      local accepted
      if item.display_value ~= nil then
        accepted = e2_fx_set_param_value(item.owner_kind, item.owner, item.slot_index, item.param_index, item.value)
      else
        accepted = e2_fx_set_param_normalized(item.owner_kind, item.owner, item.slot_index, item.param_index, item.normalized_value)
      end
      if not accepted then
        mutation_failure = e2_fx_batch_row_failure("COMMAND_FAILED", "REAPER rejected an FX assignment batch setter.", index, { mutation_attempted = true, zero_write = false })
        break
      end
    end
    if mutation_failure then break end
  end
  batch_timings.mutation_ms = (os.clock() - mutation_started) * 1000

  local readback_started = os.clock()
  local readback_failure = nil
  for index = 1, #prepared do
    local item = prepared[index]
    local normalized_value = e2_fx_read_param_normalized(item.owner_kind, item.owner, item.slot_index, item.param_index)
    local formatted_value = e2_fx_read_param_formatted(item.owner_kind, item.owner, item.slot_index, item.param_index)
    local values = e2_fx_read_param_value(item.owner_kind, item.owner, item.slot_index, item.param_index)
    local updated
    if item.display_value ~= nil then
      updated = e2_fx_batch_finite(values.value)
        and math.abs(values.value - item.value) <= item.tolerance
        and E2_FX_HOMOGENEOUS_SET.formatted_readback_matches(formatted_value, item.requested_formatted_value)
    else
      updated = item.tolerance == 0
        and formatted_value == item.requested_formatted_value
        or e2_fx_batch_finite(normalized_value) and math.abs(normalized_value - item.normalized_value) <= item.tolerance
    end
    if not e2_fx_batch_finite(values.value) or not e2_fx_batch_finite(normalized_value)
        or not is_string(formatted_value) or formatted_value == "" or not updated then
      readback_failure = e2_fx_batch_row_failure("VERIFY_FAILED", "FX assignment batch aggregate readback did not match native identity or value truth.", index, { mutation_attempted = batch_timings.native_mutation_count > 0, zero_write = false })
      break
    end
    batch_timings.native_readback_count = batch_timings.native_readback_count + 1
    result_rows[#result_rows + 1] = {
      id = item.row.id,
      fx_ref = item.row.fx_ref,
      owner_kind = item.owner_kind,
      slot_index = item.slot_index,
      param_index = item.param_index,
      param_ident = item.param_ident,
      name = item.name,
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = normalized_value,
      formatted_value = formatted_value,
      requested_normalized_value = item.display_value == nil and item.normalized_value or JSON_NULL,
      requested_display_value = item.display_value or JSON_NULL,
      requested_value = item.display_value ~= nil and item.value or JSON_NULL,
      requested_formatted_value = item.requested_formatted_value,
      tolerance = item.tolerance,
      verification_mode = item.display_value ~= nil and "native_display_value"
        or item.tolerance == 0 and "native_discrete_format" or "numeric_tolerance",
      step_sizes_available = item.step_sizes.step_sizes_available,
      step_size = item.step_sizes.step_size,
      small_step_size = item.step_sizes.small_step_size,
      large_step_size = item.step_sizes.large_step_size,
      is_toggle = item.step_sizes.is_toggle,
      is_discrete = item.step_sizes.is_discrete,
      updated = true,
      readback_status = "aggregate_passed",
    }
  end
  batch_timings.readback_ms = (os.clock() - readback_started) * 1000
  if mutation_failure then
    local failure = mutation_failure[2] or mutation_failure
    failure.details = failure.details or {}
    failure.details.mutation_attempted = true
    failure.details.completed_rows = batch_timings.native_readback_count
    return nil, failure
  end
  if readback_failure then
    local failure = readback_failure[2] or readback_failure
    failure.details = failure.details or {}
    failure.details.mutation_attempted = batch_timings.native_mutation_count > 0
    return nil, failure
  end
  return e2_fx_write_summary(request, { rows = result_rows, mutation_attempted = true, batch_timings = batch_timings }), nil, json_array({}), json_array({}), refs
end

local E2_FX_REAEQ_BAND_MAX = 4
local E2_FX_REAEQ_READ_TYPE_NAMES = {
  [0] = "low_shelf",
  [1] = "high_shelf",
  [3] = "low_pass",
  [4] = "high_pass",
  [6] = "notch",
  [8] = "band",
}
local E2_FX_REAEQ_IDENT_TOKENS = {
  high_pass = "High_Pass",
  low_shelf = "Low_Shelf",
  band = "Band",
  notch = "Notch",
  high_shelf = "High_Shelf",
  low_pass = "Low_Pass",
}

local function e2_fx_reaeq_type_allowed(value)
  for _, type_name in pairs(E2_FX_REAEQ_READ_TYPE_NAMES) do
    if value == type_name then return true end
  end
  return false
end

local function e2_fx_reaeq_type_value(type_name)
  for type_value, live_name in pairs(E2_FX_REAEQ_READ_TYPE_NAMES) do
    if live_name == type_name then return type_value end
  end
  return nil
end

local function e2_fx_reaeq_error(code, message, details)
  details = details or {}
  if details.zero_write == nil then details.zero_write = true end
  local public_code = code
  if code:match("^FX_REAEQ_") then
    local public_codes = {
      FX_REAEQ_IDENTITY_MISMATCH = "FX_NOT_FOUND",
      FX_REAEQ_INVENTORY_INVALID = "FX_PARAMETER_NOT_FOUND",
      FX_REAEQ_PARAMETER_IDENTITY_MISMATCH = "FX_PARAMETER_INVALID",
      FX_REAEQ_TOPOLOGY_UNAVAILABLE = "FX_PARAMETER_NOT_FOUND",
      FX_REAEQ_TARGET_UNAVAILABLE = "PARAMS_INVALID",
    }
    public_code = public_codes[code] or "PARAMS_INVALID"
    details.blocker = details.blocker or code
  end
  return e2_fx_batch_error(public_code, message, details)
end

local function e2_fx_reaeq_identity(owner_kind, owner, slot_index)
  return e2_fx_named_config_get(owner_kind, owner, slot_index, "fx_ident")
end

local function e2_fx_reaeq_identity_allowed(identity)
  if type(identity) ~= "string" then return false end
  local normalized = identity:lower():gsub("\\", "/"):gsub("%s+", " "):gsub(": ", ":")
  local basename = normalized:match("([^/]+)$") or normalized
  return normalized == "vst:reaeq (cockos)"
    or normalized == "vst3:reaeq (cockos)"
    or normalized == "au:reaeq (cockos)"
    or normalized == "reaeq (cockos)"
    or basename == "reaeq.vst.dylib<1919247729"
    or basename == "reaeq.vst.dll<1919247729"
    or basename == "reaeq.dll<1919247729"
end

local function e2_fx_reaeq_band_key(prefix, band)
  return prefix .. tostring(band - 1)
end

local function e2_fx_reaeq_read_topology(owner_kind, owner, slot_index, band)
  local type_raw = e2_fx_named_config_get(owner_kind, owner, slot_index, e2_fx_reaeq_band_key("BANDTYPE", band))
  local enabled_raw = e2_fx_named_config_get(owner_kind, owner, slot_index, e2_fx_reaeq_band_key("BANDENABLED", band))
  local type_value = tonumber(type_raw)
  if not E2_FX_REAEQ_READ_TYPE_NAMES[type_value] or (enabled_raw ~= "0" and enabled_raw ~= "1") then
    return nil, { type_raw = type_raw or JSON_NULL, enabled_raw = enabled_raw or JSON_NULL }
  end
  return {
    band = band,
    type = E2_FX_REAEQ_READ_TYPE_NAMES[type_value],
    type_value = type_value,
    enabled = enabled_raw == "1",
  }
end

local function e2_fx_reaeq_expected_ident(band, field, band_type)
  local prefix = field == "frequency_hz" and "_Freq_" or field == "gain_db" and "_Gain_" or "_BW_"
  local suffix = band == 1 and "" or "_" .. tostring(band)
  return prefix .. E2_FX_REAEQ_IDENT_TOKENS[band_type] .. suffix
end

local function e2_fx_reaeq_ident_matches(param_index, live_ident, expected_ident, band)
  if type(live_ident) ~= "string" or type(expected_ident) ~= "string" then return false end
  local native_ident = live_ident
  local native_index, indexed_ident = live_ident:match("^(%d+):(.*)$")
  if native_index ~= nil then
    if tonumber(native_index) ~= param_index then return false end
    native_ident = indexed_ident
  end
  if native_ident == expected_ident then return true end
  return band == 1 and native_ident == expected_ident .. "_1"
end

local function e2_fx_reaeq_inventory(owner_kind, owner, slot_index)
  local parameter_count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if parameter_count < E2_FX_REAEQ_BAND_MAX * 3 then return nil, parameter_count end
  local rows = json_array({})
  for param_index = 0, parameter_count - 1 do
    local ident = e2_fx_read_param_ident(owner_kind, owner, slot_index, param_index)
    if not ident then return nil, parameter_count end
    local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
    rows[#rows + 1] = {
      param_index = param_index,
      param_ident = ident,
      name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
      formatted_value = e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index),
    }
  end
  return rows, parameter_count
end

local function e2_fx_reaeq_read_layout(owner_kind, owner, slot_index, expected_parameter_count)
  local inventory, parameter_count = e2_fx_reaeq_inventory(owner_kind, owner, slot_index)
  if not inventory or (expected_parameter_count ~= nil and parameter_count ~= expected_parameter_count) then
    return e2_fx_reaeq_error("FX_REAEQ_INVENTORY_INVALID", "ReaEQ did not expose a complete stable parameter inventory.", { parameter_count = parameter_count, expected_parameter_count = expected_parameter_count or JSON_NULL })
  end
  local topology = json_array({})
  local unavailable_topology = json_array({})
  for band = 1, E2_FX_REAEQ_BAND_MAX do
    local current, topology_details = e2_fx_reaeq_read_topology(owner_kind, owner, slot_index, band)
    if not current then
      topology_details = topology_details or {}
      topology_details.band = band
      unavailable_topology[#unavailable_topology + 1] = topology_details
    else
      topology[#topology + 1] = current
      for field_offset, field in ipairs({ "frequency_hz", "gain_db", "bandwidth_oct" }) do
        local param_index = (band - 1) * 3 + field_offset - 1
        local live_ident = inventory[param_index + 1].param_ident
        local expected_ident = e2_fx_reaeq_expected_ident(band, field, current.type)
        if not e2_fx_reaeq_ident_matches(param_index, live_ident, expected_ident, band) then
          return e2_fx_reaeq_error("FX_REAEQ_PARAMETER_IDENTITY_MISMATCH", "ReaEQ first-four-band parameter identity does not match live topology.", { band = band, field = field, param_index = param_index, expected_param_ident = expected_ident, live_param_ident = live_ident })
        end
      end
    end
  end
  if #unavailable_topology > 0 then
    return e2_fx_reaeq_error("FX_REAEQ_TOPOLOGY_UNAVAILABLE", "ReaEQ did not expose the complete first-four-band topology.", { unavailable_topology = unavailable_topology })
  end
  return { inventory = inventory, parameter_count = parameter_count, topology = topology }
end

local function e2_fx_reaeq_parse_formatted(field, formatted)
  if type(formatted) ~= "string" then return nil end
  local normalized = formatted:lower():gsub(",", ".")
  local number_text = normalized:match("[-+]?%d+%.?%d*")
  local value = tonumber(number_text)
  if not value then return nil end
  if field == "frequency_hz" and normalized:find("khz", 1, true) then value = value * 1000 end
  return value
end

local function e2_fx_reaeq_target_tolerance(field, target)
  if field == "frequency_hz" then return math.max(0.5, math.abs(target) * 0.0025) end
  if field == "gain_db" then return 0.02 end
  return 0.02
end

local function e2_fx_reaeq_calibrate_setter_domain(owner_kind, owner, slot_index, param_index, field)
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local range = values.max_value - values.min_value
  local current_normalized = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local current_formatted = e2_fx_read_param_formatted(owner_kind, owner, slot_index, param_index)
  local current_value = e2_fx_reaeq_parse_formatted(field, current_formatted)
  if range <= 0 or type(current_normalized) ~= "number" or not current_value then return nil end

  local raw_coordinate = (values.value - values.min_value) / range
  if raw_coordinate < 0 or raw_coordinate > 1 then return nil end
  local normalized_probe = e2_fx_reaeq_parse_formatted(field, e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, current_normalized))
  local raw_probe = e2_fx_reaeq_parse_formatted(field, e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, raw_coordinate))
  local tolerance = e2_fx_reaeq_target_tolerance(field, current_value)
  local normalized_matches = normalized_probe and math.abs(normalized_probe - current_value) <= tolerance
  local raw_matches = raw_probe and math.abs(raw_probe - current_value) <= tolerance
  if not normalized_matches and not raw_matches then return nil end

  return {
    setter_domain = normalized_matches and "normalized" or "native",
    values = values,
    current_formatted_value = current_formatted,
    current_formatted_numeric = current_value,
    current_normalized_value = current_normalized,
    current_raw_coordinate = raw_coordinate,
    normalized_probe_numeric = normalized_probe or JSON_NULL,
    native_probe_numeric = raw_probe or JSON_NULL,
    normalized_probe_matches = normalized_matches == true,
    native_probe_matches = raw_matches == true,
  }
end

local function e2_fx_reaeq_compile_target(owner_kind, owner, slot_index, param_index, field, target)
  local calibration = e2_fx_reaeq_calibrate_setter_domain(owner_kind, owner, slot_index, param_index, field)
  if not calibration then return nil end
  local low_formatted = e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, 0)
  local high_formatted = e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, 1)
  local low_value = e2_fx_reaeq_parse_formatted(field, low_formatted)
  local high_value = e2_fx_reaeq_parse_formatted(field, high_formatted)
  if not low_value or not high_value or low_value == high_value then return nil end
  local minimum = math.min(low_value, high_value)
  local maximum = math.max(low_value, high_value)
  local tolerance = e2_fx_reaeq_target_tolerance(field, target)
  if target < minimum - tolerance or target > maximum + tolerance then return nil end
  local ascending = high_value > low_value
  local best_normalized = 0
  local best_value = low_value
  local best_formatted = low_formatted
  local left = 0
  local right = 1
  for _ = 1, 48 do
    local middle = (left + right) / 2
    local formatted = e2_fx_format_param_normalized(owner_kind, owner, slot_index, param_index, middle)
    local observed = e2_fx_reaeq_parse_formatted(field, formatted)
    if not observed then return nil end
    if math.abs(observed - target) < math.abs(best_value - target) then
      best_normalized = middle
      best_value = observed
      best_formatted = formatted
    end
    if (ascending and observed < target) or (not ascending and observed > target) then
      left = middle
    else
      right = middle
    end
  end
  if math.abs(best_value - target) > tolerance then return nil end
  local values = calibration.values
  local native_value = values.min_value + best_normalized * (values.max_value - values.min_value)
  return {
    setter_domain = calibration.setter_domain,
    normalized_value = best_normalized,
    native_value = native_value,
    requested_value = target,
    native_formatted_value = best_formatted,
    native_formatted_numeric = best_value,
    tolerance = tolerance,
    calibration = calibration,
  }
end

local function e2_fx_reaeq_compile_rows(owner_kind, owner, slot_index, prepared, layout)
  for index = 1, #prepared do
    local item = prepared[index]
    if layout.topology[item.band].type ~= item.target_type then
      return e2_fx_reaeq_error("FX_REAEQ_TOPOLOGY_WRITE_MISMATCH", "ReaEQ topology readback does not match the compiled band plan.", { band = item.band, requested_type = item.target_type, observed_type = layout.topology[item.band].type })
    end
    item.targets = {}
    for target_index = 1, #item.target_requests do
      local target_request = item.target_requests[target_index]
      local param_index = (item.band - 1) * 3 + target_request.field_offset - 1
      local live_ident = layout.inventory[param_index + 1].param_ident
      local expected_ident = e2_fx_reaeq_expected_ident(item.band, target_request.field, item.target_type)
      if not e2_fx_reaeq_ident_matches(param_index, live_ident, expected_ident, item.band) then
        return e2_fx_reaeq_error("FX_REAEQ_PARAMETER_IDENTITY_MISMATCH", "ReaEQ target parameter identity does not match the compiled topology.", { band = item.band, field = target_request.field, param_index = param_index, expected_param_ident = expected_ident, live_param_ident = live_ident })
      end
      local compiled = e2_fx_reaeq_compile_target(owner_kind, owner, slot_index, param_index, target_request.field, target_request.requested_value)
      if not compiled then
        return e2_fx_reaeq_error("FX_REAEQ_TARGET_UNAVAILABLE", "REAPER native formatting could not compile the requested ReaEQ value.", { row_index = item.row_index, band = item.band, field = target_request.field, requested_value = target_request.requested_value })
      end
      compiled.field = target_request.field
      compiled.param_index = param_index
      compiled.preflight_param_ident = live_ident
      compiled.expected_param_ident = expected_ident
      item.targets[#item.targets + 1] = compiled
    end
  end
  return true
end

local function e2_fx_reaeq_validate_request(request, owner_kind, owner, slot_index)
  local params = request.params or {}
  local bands = params.bands
  if type(params.dry_run) ~= "boolean" then
    return e2_fx_reaeq_error("PARAMS_INVALID", "ReaEQ band batch dry_run must be boolean.")
  end
  if not is_json_array(bands) or #bands < 1 or #bands > E2_FX_REAEQ_BAND_MAX then
    return e2_fx_reaeq_error("FX_REAEQ_BANDS_INVALID", "ReaEQ band batch accepts 1-4 rows.")
  end
  local identity = e2_fx_reaeq_identity(owner_kind, owner, slot_index)
  if not e2_fx_reaeq_identity_allowed(identity) then
    return e2_fx_reaeq_error("FX_REAEQ_IDENTITY_MISMATCH", "The exact live FX is not an approved Cockos ReaEQ instance.", { plugin_identity = identity or JSON_NULL })
  end
  local layout, layout_failure = e2_fx_reaeq_read_layout(owner_kind, owner, slot_index)
  if not layout then return nil, layout_failure end

  local seen = {}
  local prepared = {}
  local topology_change_count = 0
  for row_index = 1, #bands do
    local row = bands[row_index]
    if not is_object(row) then return e2_fx_reaeq_error("FX_REAEQ_BAND_ROW_INVALID", "ReaEQ band rows must be objects.", { row_index = row_index }) end
    for key in pairs(row) do
      if key ~= "band" and key ~= "type" and key ~= "enabled" and key ~= "frequency_hz" and key ~= "gain_db" and key ~= "bandwidth_oct" then
        return e2_fx_reaeq_error("FX_REAEQ_BAND_ROW_INVALID", "ReaEQ band row contains an unsupported field.", { row_index = row_index, field = key })
      end
    end
    local band = tonumber(row.band)
    if not band or band < 1 or band > E2_FX_REAEQ_BAND_MAX or band ~= math.floor(band) or seen[band] then
      return e2_fx_reaeq_error("FX_REAEQ_BAND_INDEX_INVALID", "ReaEQ band must be a unique integer from 1 through 4.", { row_index = row_index })
    end
    seen[band] = true
    if row.type ~= nil and not e2_fx_reaeq_type_allowed(row.type) then
      return e2_fx_reaeq_error("FX_REAEQ_BAND_TYPE_INVALID", "ReaEQ band type is not approved.", { row_index = row_index })
    end
    if row.enabled ~= nil and type(row.enabled) ~= "boolean" then
      return e2_fx_reaeq_error("FX_REAEQ_BAND_ENABLED_INVALID", "ReaEQ band enabled must be boolean.", { row_index = row_index })
    end
    local target_type = row.type or layout.topology[band].type
    local target_type_value = e2_fx_reaeq_type_value(target_type)
    if target_type_value == nil then
      return e2_fx_reaeq_error("FX_REAEQ_BAND_TYPE_INVALID", "ReaEQ band type has no approved named-topology value.", { row_index = row_index })
    end
    local topology_change = target_type ~= layout.topology[band].type
    if topology_change then topology_change_count = topology_change_count + 1 end
    local item = { row = row, row_index = row_index, band = band, target_type = target_type, target_type_value = target_type_value, topology_change = topology_change, target_requests = {}, targets = {} }
    for field_offset, field in ipairs({ "frequency_hz", "gain_db", "bandwidth_oct" }) do
      if row[field] ~= nil then
        local target = tonumber(row[field])
        local bounds = field == "frequency_hz" and { 10, 30000 } or field == "gain_db" and { -60, 60 } or { 0.01, 8 }
        if not e2_fx_batch_finite(target) or target < bounds[1] or target > bounds[2] then
          return e2_fx_reaeq_error("FX_REAEQ_BAND_VALUE_INVALID", "ReaEQ band value is outside the bounded public range.", { row_index = row_index, field = field })
        end
        item.target_requests[#item.target_requests + 1] = { field = field, field_offset = field_offset, requested_value = target }
      end
    end
    prepared[#prepared + 1] = item
  end
  if topology_change_count == 0 then
    local compiled, compile_failure = e2_fx_reaeq_compile_rows(owner_kind, owner, slot_index, prepared, layout)
    if not compiled then return nil, compile_failure end
  end
  return { prepared = prepared, identity = identity, inventory = layout.inventory, parameter_count = layout.parameter_count, topology = layout.topology, topology_change_count = topology_change_count }
end

local function e2_fx_set_reaeq_bands(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then return e2_fx_reaeq_error("FX_REF_NOT_FOUND", "ReaEQ band batch requires one resolvable exact FX ref.") end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then return e2_fx_reaeq_error("FX_SLOT_NOT_FOUND", "ReaEQ band batch slot is outside the exact owner FX chain.", { slot_index = slot_index, fx_count = count }) end
  local preflight_started = os.clock()
  local plan, failure = e2_fx_reaeq_validate_request(request, owner_kind, owner, slot_index)
  if not plan then return nil, failure end
  local batch_timings = { preflight_ms = (os.clock() - preflight_started) * 1000, mutation_ms = 0, readback_ms = 0, transport_ms = 0, rows = #plan.prepared, runner = "e2_reaeq_native_profile_batch", native_mutation_count = 0, native_readback_count = 0 }
  local _, fx_ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  if request.params.dry_run == true then
    local rows = json_array({})
    for index = 1, #plan.prepared do
      local item = plan.prepared[index]
      rows[#rows + 1] = { band = item.band, type = item.target_type, type_value = item.target_type_value, topology_change = item.topology_change, enabled = item.row.enabled == nil and plan.topology[item.band].enabled or item.row.enabled, targets = item.topology_change and item.target_requests or item.targets, readback_status = item.topology_change and "topology_preflight_passed" or "preflight_passed" }
    end
    return e2_fx_read_summary(request, { fx_ref = fx_ref.ref, plugin_identity = plan.identity, owner_kind = owner_kind, slot_index = slot_index, topology = plan.topology, parameter_inventory = plan.inventory, rows = rows, mutation_attempted = false, batch_timings = batch_timings }), nil, json_array({}), json_array({}), e2_fx_read_refs(fx_ref)
  end

  local mutation_started = os.clock()
  local mutation_attempted = false
  local mutation_topology = plan.topology
  local named_setter_rejections = json_array({})
  if plan.topology_change_count > 0 then
    for index = 1, #plan.prepared do
      local item = plan.prepared[index]
      if item.topology_change then
        mutation_attempted = true
        batch_timings.native_mutation_count = batch_timings.native_mutation_count + 1
        if not e2_fx_named_config_set(owner_kind, owner, slot_index, e2_fx_reaeq_band_key("BANDTYPE", item.band), item.target_type_value) then
          named_setter_rejections[#named_setter_rejections + 1] = { band = item.band, field = "type" }
        end
      end
    end
    local post_topology_layout, post_topology_failure = e2_fx_reaeq_read_layout(owner_kind, owner, slot_index, plan.parameter_count)
    if not post_topology_layout then
      post_topology_failure.details = post_topology_failure.details or {}
      post_topology_failure.details.mutation_attempted = true
      post_topology_failure.details.zero_write = false
      return nil, post_topology_failure
    end
    local post_topology_identity = e2_fx_reaeq_identity(owner_kind, owner, slot_index)
    if post_topology_identity ~= plan.identity then
      return e2_fx_reaeq_error("VERIFY_FAILED", "ReaEQ plugin identity changed after topology mutation.", { plugin_identity = post_topology_identity or JSON_NULL, expected_plugin_identity = plan.identity, mutation_attempted = true, zero_write = false })
    end
    local compiled, compile_failure = e2_fx_reaeq_compile_rows(owner_kind, owner, slot_index, plan.prepared, post_topology_layout)
    if not compiled then
      compile_failure.details = compile_failure.details or {}
      compile_failure.details.mutation_attempted = true
      compile_failure.details.zero_write = false
      return nil, compile_failure
    end
    mutation_topology = post_topology_layout.topology
  end
  for index = 1, #plan.prepared do
    local item = plan.prepared[index]
    if item.row.enabled ~= nil and item.row.enabled ~= mutation_topology[item.band].enabled then
      mutation_attempted = true
      batch_timings.native_mutation_count = batch_timings.native_mutation_count + 1
      if not e2_fx_named_config_set(owner_kind, owner, slot_index, e2_fx_reaeq_band_key("BANDENABLED", item.band), item.row.enabled and 1 or 0) then
        named_setter_rejections[#named_setter_rejections + 1] = { band = item.band, field = "enabled" }
      end
    end
    for target_index = 1, #item.targets do
      local target = item.targets[target_index]
      mutation_attempted = true
      batch_timings.native_mutation_count = batch_timings.native_mutation_count + 1
      local accepted = target.setter_domain == "normalized"
        and e2_fx_set_param_normalized(owner_kind, owner, slot_index, target.param_index, target.normalized_value)
        or target.setter_domain == "native"
          and e2_fx_set_param_value(owner_kind, owner, slot_index, target.param_index, target.native_value)
      if not accepted then
        return e2_fx_reaeq_error("COMMAND_FAILED", "REAPER rejected an exact ReaEQ parameter setter.", { band = item.band, field = target.field, mutation_attempted = true, zero_write = false })
      end
    end
  end
  batch_timings.mutation_ms = (os.clock() - mutation_started) * 1000

  local readback_started = os.clock()
  local final_layout, final_layout_failure = e2_fx_reaeq_read_layout(owner_kind, owner, slot_index, plan.parameter_count)
  if not final_layout then
    final_layout_failure.details = final_layout_failure.details or {}
    final_layout_failure.details.mutation_attempted = mutation_attempted
    final_layout_failure.details.zero_write = not mutation_attempted
    return nil, final_layout_failure
  end
  local topology = final_layout.topology
  local inventory = final_layout.inventory
  local rows = json_array({})
  for index = 1, #plan.prepared do
    local item = plan.prepared[index]
    if topology[item.band].type ~= item.target_type or (item.row.enabled ~= nil and topology[item.band].enabled ~= item.row.enabled) then
      return e2_fx_reaeq_error("VERIFY_FAILED", "ReaEQ named topology readback does not match the requested band row.", { band = item.band, mutation_attempted = mutation_attempted, zero_write = false })
    end
    local values = {}
    for target_index = 1, #item.targets do
      local target = item.targets[target_index]
      local live = inventory[target.param_index + 1]
      local observed = e2_fx_reaeq_parse_formatted(target.field, live.formatted_value)
      if not e2_fx_reaeq_ident_matches(target.param_index, live.param_ident, target.expected_param_ident, item.band) or not observed or math.abs(observed - target.requested_value) > target.tolerance then
        return e2_fx_reaeq_error("VERIFY_FAILED", "ReaEQ exact parameter identity or value readback does not match the requested band row.", { band = item.band, field = target.field, expected_param_ident = target.expected_param_ident, live_param_ident = live.param_ident, requested_value = target.requested_value, observed_value = observed or JSON_NULL, mutation_attempted = mutation_attempted, zero_write = false })
      end
      values[target.field] = { requested_value = target.requested_value, observed_value = observed, formatted_value = live.formatted_value, normalized_value = live.normalized_value, param_index = target.param_index, param_ident = live.param_ident, setter_domain = target.setter_domain, tolerance = target.tolerance }
      batch_timings.native_readback_count = batch_timings.native_readback_count + 1
    end
    rows[#rows + 1] = { band = item.band, type = topology[item.band].type, enabled = topology[item.band].enabled, values = values, readback_status = "aggregate_passed" }
  end
  local identity = e2_fx_reaeq_identity(owner_kind, owner, slot_index)
  if identity ~= plan.identity then return e2_fx_reaeq_error("VERIFY_FAILED", "ReaEQ plugin identity changed during mutation.", { mutation_attempted = mutation_attempted, zero_write = false }) end
  batch_timings.readback_ms = (os.clock() - readback_started) * 1000
  return e2_fx_write_summary(request, { fx_ref = fx_ref.ref, plugin_identity = identity, owner_kind = owner_kind, slot_index = slot_index, topology = topology, parameter_inventory = inventory, rows = rows, mutation_attempted = mutation_attempted, named_setter_rejections = named_setter_rejections, batch_timings = batch_timings }), nil, json_array({}), json_array({}), e2_fx_read_refs(fx_ref)
end

local function reorder_fx(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 reorder_fx requires a resolvable FX ref.")
  end
  local target_index = tonumber(request.params and request.params.target_index)
  if not target_index or target_index < 0 or target_index ~= math.floor(target_index) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 reorder_fx requires a non-negative integer target_index.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count or target_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-B1 reorder_fx slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      target_index = target_index,
      fx_count = count,
    })
  end
  if target_index ~= slot_index and not e2_fx_copy_move(owner_kind, owner, slot_index, target_index) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX reorder operation.", {}, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, target_index)
  summary.previous_slot_index = slot_index
  summary.target_index = target_index
  summary.updated = summary.slot_index == target_index
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_preset_by_name(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX preset write requires a resolvable FX ref.")
  end
  local preset_name = request.params and request.params.preset_name
  if not is_string(preset_name) or preset_name:gsub("%s+", "") == "" then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX preset write requires a non-empty preset_name.")
  end
  preset_name = bounded_string(preset_name, 240)
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX preset write slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local previous_preset = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  if not e2_fx_set_preset(owner_kind, owner, slot_index, preset_name) then
    return e2_fx_read_error("PRESET_NOT_FOUND", "REAPER rejected the requested FX preset name.", {
      preset_name = preset_name,
    })
  end
  local readback_preset = e2_fx_get_preset(owner_kind, owner, slot_index)
  if readback_preset ~= preset_name then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX preset write did not read back the requested preset name.", {
      requested_preset_name = preset_name,
      readback_preset_name = readback_preset or JSON_NULL,
    }, false)
  end
  local preset_index, preset_count = e2_fx_get_preset_index(owner_kind, owner, slot_index)
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.previous_preset_name = previous_preset
  summary.preset_name = readback_preset
  summary.preset_index = preset_index
  summary.preset_count = preset_count
  summary.updated = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_preset_by_index(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX preset write requires a resolvable FX ref.")
  end
  local preset_index = tonumber(request.params and request.params.preset_index)
  if not preset_index or preset_index < 0 or preset_index ~= math.floor(preset_index) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX preset write requires a non-negative integer preset_index.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX preset write slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local previous_preset = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  if not e2_fx_set_preset_by_index(owner_kind, owner, slot_index, preset_index) then
    return e2_fx_read_error("PRESET_NOT_FOUND", "REAPER rejected the requested FX preset index.", {
      preset_index = preset_index,
    })
  end
  local readback_index, preset_count = e2_fx_get_preset_index(owner_kind, owner, slot_index)
  if type(readback_index) == "number" and readback_index >= 0 and readback_index ~= preset_index then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX preset write did not read back the requested preset index.", {
      requested_preset_index = preset_index,
      readback_preset_index = readback_index,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.previous_preset_name = previous_preset
  summary.preset_name = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  summary.preset_index = readback_index
  summary.requested_preset_index = preset_index
  summary.preset_count = preset_count
  summary.updated = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function parameter_to_envelope_mapping(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX parameter envelope mapping requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX parameter envelope mapping requires a non-negative integer param_index.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX parameter envelope mapping index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  local ok, envelope = e2_fx_get_parameter_envelope(owner_kind, owner, slot_index, param_index)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local fx_ref = e2_fx_read_fx_object_ref(
    owner_kind,
    owner_ref,
    slot_index,
    e2_fx_read_name(owner_kind, owner, slot_index)
  )
  local param_name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
  local ident_api = owner_kind == "take" and "TakeFX_GetParamIdent" or "TrackFX_GetParamIdent"
  local ok_ident, _, param_ident = call_reaper(ident_api, owner, slot_index, param_index, "")
  param_ident = ok_ident and first_string(param_ident) or nil
  if not param_ident or param_ident == "" then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_UNAVAILABLE", "REAPER did not return a stable parameter ident for the exact FX parameter.", {
      fx_ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index),
      param_index = param_index,
    })
  end
  if is_string(request.params and request.params.param_ident) and request.params.param_ident ~= param_ident then
    return e2_fx_read_error("FX_PARAMETER_IDENTITY_MISMATCH", "Requested param_ident does not match the exact live FX parameter.", {
      requested_param_ident = bounded_string(request.params.param_ident, 160),
      live_param_ident = bounded_string(param_ident, 160),
    })
  end
  local envelope_available = ok and envelope ~= nil
  local envelope_name = e2_fx_envelope_name(envelope_available and envelope or nil, param_name)
  local envelope_ref = nil
  if envelope_available then
    local ok_guid, _, guid = call_reaper("GetSetEnvelopeInfo_String", envelope, "GUID", "", false)
    guid = ok_guid and first_string(guid) or nil
    if not guid or guid == "" then
      return e2_fx_read_error("ENVELOPE_IDENTITY_UNAVAILABLE", "Existing FX parameter Envelope did not expose a canonical GUID.", {
        fx_ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index),
        param_index = param_index,
      })
    end
    envelope_ref = {
      kind = "envelope",
      ref = "envelope:guid:" .. guid,
      identity = { scheme = "guid", value = guid },
      display = {
        name = bounded_string(envelope_name or "", 200),
        owner_ref = owner_ref,
        fx_slot_index = slot_index,
        param_index = param_index,
      },
    }
  end
  local summary = e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    fx_ref = fx_ref.ref,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = bounded_string(param_ident, 160),
    parameter_count = count,
    parameter_name = param_name,
    envelope_available = envelope_available,
    envelope_exists = envelope_available,
    envelope_ref = envelope_available and envelope_ref.ref or JSON_NULL,
    envelope_name = envelope_name,
  })
  return summary, nil, json_array({}), json_array({}), e2_fx_read_refs(fx_ref, envelope_ref)
end
