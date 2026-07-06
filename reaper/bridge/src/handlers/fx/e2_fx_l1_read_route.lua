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

local function e2_fx_enum_installed_name(index)
  local ok, first, second = call_reaper("EnumInstalledFX", index, "")
  if not ok then
    return nil, "missing"
  end
  if first == false or first == nil then
    return nil, nil
  end
  if type(first) == "string" then
    return bounded_string(first, 240), nil
  end
  if type(second) == "string" then
    return bounded_string(second, 240), nil
  end
  return nil, nil
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
  local scanned = 0
  local truncated = false
  local max_scan = 2048
  for index = 0, max_scan - 1 do
    local name, blocker = e2_fx_enum_installed_name(index)
    if blocker == "missing" then
      return e2_fx_read_error("API_UNAVAILABLE", "REAPER EnumInstalledFX API is not available in this bridge runtime.", {
        api = "EnumInstalledFX",
      })
    end
    if not name then
      break
    end
    scanned = scanned + 1
    if name:lower():find(needle, 1, true) then
      if matched >= offset and #rows < limit then
        rows[#rows + 1] = {
          index = index,
          name = name,
          ident = name,
        }
      elseif matched >= offset and #rows >= limit then
        truncated = true
      end
      matched = matched + 1
    end
  end
  if scanned >= max_scan then
    truncated = true
  end
  return e2_fx_read_summary(request, {
    query = query,
    rows = rows,
    row_count = #rows,
    matched_count = matched,
    scanned_count = scanned,
    limit = limit,
    offset = offset,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
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

local function add_take_fx(request)
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
  local normalized_value = tonumber(request.params and request.params.normalized_value)
  if not normalized_value or normalized_value < 0 or normalized_value > 1 then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 normalized_value must be between 0 and 1.", {
      normalized_value = request.params and request.params.normalized_value,
    })
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX-B1 set_fx_parameter_normalized index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  if not e2_fx_set_param_normalized(owner_kind, owner, slot_index, param_index, normalized_value) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX parameter update.", {}, false)
  end
  local tolerance = tonumber(request.params and request.params.tolerance) or 0.001
  if tolerance < 0 then
    tolerance = 0.001
  end
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local readback_normalized = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local updated = type(readback_normalized) == "number" and math.abs(readback_normalized - normalized_value) <= tolerance
  if not updated then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX-B1 set_fx_parameter_normalized did not read back within tolerance.", {
      requested_normalized_value = normalized_value,
      readback_normalized_value = readback_normalized,
      tolerance = tolerance,
    }, false)
  end
  local _, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_write_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = readback_normalized,
    requested_normalized_value = normalized_value,
    tolerance = tolerance,
    updated = updated,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
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
  local param_name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
  local envelope_available = ok and envelope ~= nil
  local envelope_name = e2_fx_envelope_name(envelope_available and envelope or nil, param_name)
  local envelope_ref = e2_fx_envelope_object_ref(owner_kind, owner_ref, slot_index, param_index, envelope_name)
  local summary = e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = request.params and request.params.param_ident or JSON_NULL,
    parameter_count = count,
    parameter_name = param_name,
    envelope_available = envelope_available,
    envelope_ref = envelope_available and envelope_ref.ref or JSON_NULL,
    potential_envelope_ref = envelope_ref.ref,
    envelope_name = envelope_name,
  })
  return summary, nil, json_array({}), json_array({}), envelope_available and e2_fx_read_refs(envelope_ref) or e2_fx_read_refs()
end
