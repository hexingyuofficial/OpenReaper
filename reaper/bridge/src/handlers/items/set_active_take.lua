-- Exact item/take mutation handler: template.items.set_active_take.

local function set_active_take_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function set_active_take_item_guid(item)
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

local function set_active_take_take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function set_active_take_item_ref_string(item)
  local guid = set_active_take_item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return "item:unknown"
end

local function set_active_take_global_index(target_take)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  local global_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      local total_takes = ok_takes and math.max(0, math.floor(first_number(take_count) or 0)) or 0
      for take_index = 0, total_takes - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take == target_take then
          return global_index
        end
        global_index = global_index + 1
      end
    end
  end
  return nil
end

local function set_active_take_take_ref_string(take)
  local guid = set_active_take_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local index = set_active_take_global_index(take)
  if index ~= nil then
    return "take:index:" .. tostring(index)
  end
  return "take:unknown"
end

local function set_active_take_object_ref(kind, ref)
  local scheme, value = ref:match("^" .. kind .. ":([^:]+):(.+)$")
  return {
    kind = kind,
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function set_active_take_exact_ref(ref, kind)
  if not is_object(ref) or ref.kind ~= kind or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^" .. kind .. ":([^:]+):(.+)$")
  if not scheme or (scheme ~= "guid" and scheme ~= "index") then
    return nil
  end
  if ref.identity.scheme ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  if scheme == "index" and not value:match("^%d+$") then
    return nil
  end
  return {
    scheme = scheme,
    value = value,
    ref = ref.ref,
  }
end

local function set_active_take_request_refs(request)
  if not is_json_array(request.refs) or #request.refs ~= 2 then
    return nil, nil, {
      code = "REF_INVALID",
      message = "set_active_take requires exactly one exact item ref and one exact take ref.",
      details = { ref_count = is_json_array(request.refs) and #request.refs or 0 },
    }
  end
  local item_ref = nil
  local take_ref = nil
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" and not item_ref then
      item_ref = set_active_take_exact_ref(ref, "item")
    elseif is_object(ref) and ref.kind == "take" and not take_ref then
      take_ref = set_active_take_exact_ref(ref, "take")
    else
      return nil, nil, {
        code = "REF_INVALID",
        message = "set_active_take accepts one item ref and one take ref only.",
        details = { ref_index = index - 1 },
      }
    end
  end
  if not item_ref or not take_ref then
    return nil, nil, {
      code = "REF_INVALID",
      message = "set_active_take refs must be canonical GUID or index refs and must not use selection.",
      details = {},
    }
  end
  return item_ref, take_ref, nil
end

local function set_active_take_find_item(ref)
  if ref.scheme == "index" then
    local ok, item = call_reaper("GetMediaItem", 0, tonumber(ref.value))
    return ok and item or nil
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and set_active_take_item_guid(item) == ref.value then
      return item
    end
  end
  return nil
end

local function set_active_take_find_global_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  local global_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      local total_takes = ok_takes and math.max(0, math.floor(first_number(take_count) or 0)) or 0
      for take_index = 0, total_takes - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take then
          if global_index == target_index then
            return take, item
          end
          global_index = global_index + 1
        end
      end
    end
  end
  return nil, nil
end

local function set_active_take_find_take(ref, item)
  if ref.scheme == "index" then
    return set_active_take_find_global_take_by_index(tonumber(ref.value))
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, candidate_item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and candidate_item then
      local ok_takes, take_count = call_reaper("CountTakes", candidate_item)
      local total_takes = ok_takes and math.max(0, math.floor(first_number(take_count) or 0)) or 0
      for take_index = 0, total_takes - 1 do
        local ok_take, take = call_reaper("GetTake", candidate_item, take_index)
        if ok_take and take and set_active_take_take_guid(take) == ref.value then
          return take, candidate_item
        end
      end
    end
  end
  return nil, nil
end

local function set_active_take_member_index(item, target_take)
  local ok_takes, take_count = call_reaper("CountTakes", item)
  if not ok_takes then
    return nil, nil
  end
  local total_takes = math.max(0, math.floor(first_number(take_count) or 0))
  for index = 0, total_takes - 1 do
    local ok_take, take = call_reaper("GetTake", item, index)
    if ok_take and take == target_take then
      return index, total_takes
    end
  end
  return nil, total_takes
end

local function set_active_take(request)
  local item_ref, take_ref, ref_failure = set_active_take_request_refs(request)
  if ref_failure then
    return set_active_take_error(ref_failure.code, ref_failure.message, ref_failure.details)
  end

  local item = set_active_take_find_item(item_ref)
  if not item then
    return set_active_take_error("ITEM_NOT_FOUND", "Exact item ref could not be resolved for set_active_take.", {
      item_ref = bounded_string(item_ref.ref, 160),
    })
  end

  local take, resolved_owner = set_active_take_find_take(take_ref, item)
  if not take then
    return set_active_take_error("TAKE_NOT_FOUND", "Exact take ref could not be resolved for set_active_take.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
    })
  end
  if resolved_owner ~= item then
    return set_active_take_error("REF_INVALID", "The resolved take does not belong to the resolved item.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
      reason_code = "TAKE_ITEM_MISMATCH",
    })
  end

  local take_index, take_count = set_active_take_member_index(item, take)
  if take_index == nil then
    return set_active_take_error("REF_INVALID", "The resolved take is not a member of the resolved item.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
      reason_code = "TAKE_NOT_IN_ITEM",
    })
  end
  local ok_owner, owner = call_reaper("GetMediaItemTake_Item", take)
  if not ok_owner or owner ~= item then
    return set_active_take_error("REF_INVALID", "Live take ownership readback did not match the resolved item.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
      reason_code = "TAKE_OWNER_READBACK_MISMATCH",
    })
  end

  local ok_before, before = call_reaper("GetActiveTake", item)
  if not ok_before then
    return set_active_take_error("COMMAND_FAILED", "REAPER did not expose the active take before mutation.", {
      item_ref = bounded_string(item_ref.ref, 160),
    }, false)
  end
  local command_ok = call_reaper("SetActiveTake", take)
  if not command_ok then
    return set_active_take_error("COMMAND_FAILED", "REAPER rejected SetActiveTake.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
    }, false)
  end
  call_reaper("UpdateItemInProject", item)

  local ok_after, active_take = call_reaper("GetActiveTake", item)
  if not ok_after or active_take ~= take then
    return set_active_take_error("VERIFY_FAILED", "GetActiveTake readback did not match the requested exact take.", {
      item_ref = bounded_string(item_ref.ref, 160),
      take_ref = bounded_string(take_ref.ref, 160),
      readback_take_ref = active_take and bounded_string(set_active_take_take_ref_string(active_take), 160) or JSON_NULL,
    }, false)
  end

  local live_item_ref = set_active_take_item_ref_string(item)
  local live_take_ref = set_active_take_take_ref_string(active_take)
  return {
    kind = "active_take_write",
    item_ref = live_item_ref,
    active_take_ref = live_take_ref,
    take_index = take_index,
    take_count = take_count,
    changed = before ~= active_take,
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({
    set_active_take_object_ref("item", live_item_ref),
    set_active_take_object_ref("take", live_take_ref),
  })
end
