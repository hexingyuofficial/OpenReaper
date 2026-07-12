-- Extracted D14 handler: destructive item deletion by canonical item refs.

local function d14_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d14_items_item_guid(item)
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

local function d14_items_item_ref_string(item)
  local guid = d14_items_item_guid(item)
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

local function d14_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d14_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d14_items_resolve_item_token(token)
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
    return d14_items_find_item_by_guid(guid)
  end
  return nil
end

local function d14_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^item:([^:]+):(.+)$")
  if not scheme or (scheme ~= "selected" and scheme ~= "index" and scheme ~= "guid") then
    return nil
  end
  if ref.identity.scheme ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  return d14_items_resolve_item_token(ref.ref)
end

local function d14_items_item_object_ref_from_string(ref)
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

local function d14_items_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function d14_items_item_selected(item)
  local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", item, "B_UISEL")
  return ok_selected and first_number(selected) == 1
end

local function d14_items_collect_entries(request)
  if not is_json_array(request.refs) then
    return nil, {
      code = "REF_INVALID",
      message = "D14 items delete request requires item refs.",
      details = {},
    }
  end
  local entries = {}
  local seen = {}
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" then
      local item = d14_items_resolve_item_from_ref_object(ref)
      if not item then
        return nil, {
          code = "ITEM_NOT_FOUND",
          message = "Item ref could not be resolved for deletion.",
          details = {
            item_ref = bounded_string(ref.ref, 160),
          },
        }
      end
      local item_ref = d14_items_item_ref_string(item)
      if not seen[item_ref] then
        seen[item_ref] = true
        entries[#entries + 1] = {
          item = item,
          item_ref = item_ref,
          object_ref = d14_items_item_object_ref_from_string(item_ref),
          track = d14_items_item_track(item),
          selected = d14_items_item_selected(item),
        }
      end
    end
  end
  if #entries == 0 then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D14 items delete request requires at least one resolvable item ref.",
      details = {},
    }
  end
  local budget = safe_budget(request)
  if #entries > budget.max_items then
    return nil, {
      code = "PARAMS_INVALID",
      message = "D14 items delete request exceeds the request item budget.",
      details = {
        requested = #entries,
        max_items = budget.max_items,
      },
    }
  end
  return entries
end

local function d14_items_delete_entries(request, entries)
  if request.params.require_selected == true then
    for index = 1, #entries do
      if not entries[index].selected then
        return nil, {
          code = "ITEM_NOT_SELECTED",
          message = "D14 items delete request required selected items.",
          details = {
            item_ref = entries[index].item_ref,
          },
        }
      end
    end
  end
  for index = 1, #entries do
    if not entries[index].track then
      return nil, {
        code = "TRACK_NOT_FOUND",
        message = "Parent track could not be resolved for item deletion.",
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  for index = 1, #entries do
    local ok, deleted = call_reaper("DeleteTrackMediaItem", entries[index].track, entries[index].item)
    if not ok or deleted == false then
      return nil, {
        code = "COMMAND_FAILED",
        message = "REAPER rejected item deletion.",
        recoverable = false,
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  call_reaper("UpdateArrange")
  for index = 1, #entries do
    if d14_items_resolve_item_token(entries[index].item_ref) then
      return nil, {
        code = "VERIFICATION_FAILED",
        message = "Deleted item still resolved after deletion.",
        recoverable = false,
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  return true
end

local function d14_items_delete_summary(request, entries, singular)
  local deleted_item_refs = json_array({})
  local refs = json_array({})
  for index = 1, #entries do
    deleted_item_refs[#deleted_item_refs + 1] = entries[index].item_ref
    refs[#refs + 1] = entries[index].object_ref
  end
  local summary = {
    kind = singular and "item_deleted" or "items_deleted",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    deleted_count = #entries,
    deleted_item_refs = deleted_item_refs,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }
  if singular then
    summary.deleted_item_ref = entries[1].item_ref
  end
  return summary, nil, json_array({}), json_array({}), refs
end

local function d14_items_delete_item(request)
  local entries, failure = d14_items_collect_entries(request)
  if not entries then
    return d14_items_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  if #entries ~= 1 then
    return d14_items_error("REF_INVALID", "delete_item requires exactly one item ref.", {
      item_ref_count = #entries,
    })
  end
  local ok, delete_failure = d14_items_delete_entries(request, entries)
  if not ok then
    return d14_items_error(delete_failure.code, delete_failure.message, delete_failure.details, delete_failure.recoverable)
  end
  return d14_items_delete_summary(request, entries, true)
end

local function d14_items_delete_items(request)
  local entries, failure = d14_items_collect_entries(request)
  if not entries then
    return d14_items_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  local ok, delete_failure = d14_items_delete_entries(request, entries)
  if not ok then
    return d14_items_error(delete_failure.code, delete_failure.message, delete_failure.details, delete_failure.recoverable)
  end
  return d14_items_delete_summary(request, entries, false)
end
