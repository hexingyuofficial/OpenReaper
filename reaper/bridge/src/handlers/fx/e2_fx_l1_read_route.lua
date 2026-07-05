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
  readback.artifacts_allowed = false
  readback.write_fx_status = "held"
  readback.preset_status = "held"
  readback.video_processor_status = "held"
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
  return "fx:" .. tostring(owner_kind) .. ":" .. tostring(slot_index)
end

local function e2_fx_read_fx_object_ref(owner_kind, owner_ref, slot_index, name)
  local ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = {
      scheme = owner_kind,
      value = tostring(slot_index),
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
  local identity = is_object(ref.identity) and ref.identity or {}
  local scheme = identity.scheme
  local value = tostring(identity.value or "")
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
    if not track then
      local ok, default_track = call_reaper("GetTrack", 0, 0)
      track = ok and default_track or nil
    end
    return "track", track, slot_index
  elseif scheme == "take" then
    local take = e2_fx_read_take_from_request_refs(request)
    if not take then
      local ok_item, item = call_reaper("GetSelectedMediaItem", 0, 0)
      if ok_item and item then
        local ok_take, default_take = call_reaper("GetActiveTake", item)
        take = ok_take and default_take or nil
      end
    end
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
    slot_index = slot_index,
    name = name,
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

local function list_fx_parameters(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 list_fx_parameters requires a resolvable FX ref.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 32, 64)
  local parameters = json_array({})
  local max_index = math.min(count, limit)
  for param_index = 0, max_index - 1 do
    local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
    parameters[#parameters + 1] = {
      param_index = param_index,
      name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
    }
  end
  return e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    parameter_count = count,
    parameters = parameters,
    truncated = count > limit,
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
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  return e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end
