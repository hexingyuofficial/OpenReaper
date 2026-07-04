-- Extracted read-only handler: template.media.probe_file.

local READ_B_MEDIA = {}

function READ_B_MEDIA.handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

function READ_B_MEDIA.bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

function READ_B_MEDIA.source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

function READ_B_MEDIA.source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true or false
end

function READ_B_MEDIA.source_channels(source)
  local ok, channels = call_reaper("GetMediaSourceNumChannels", source)
  return ok and first_number(channels) or 0
end

function READ_B_MEDIA.source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return bounded_string(ok and first_string(filename) or "", 240)
end

function READ_B_MEDIA.source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

function READ_B_MEDIA.metadata_keys_for_source(source, include_metadata_keys)
  local keys = json_array({})
  if include_metadata_keys ~= true then
    return keys
  end
  for _, key in ipairs({ "TITLE", "ARTIST", "ALBUM", "DATE", "BPM" }) do
    local ok_meta, value = call_reaper("GetMediaFileMetadata", source, key, "")
    if ok_meta and type(value) == "string" and value ~= "" then
      keys[#keys + 1] = key
    end
  end
  return keys
end

function READ_B_MEDIA.file_ref_for_path(path_value)
  return "file:path:" .. bounded_string(path_value, 220)
end

function READ_B_MEDIA.item_guid(item)
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

function READ_B_MEDIA.find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and READ_B_MEDIA.item_guid(item) == guid then
      return item
    end
  end
  return nil
end

function READ_B_MEDIA.take_guid(take)
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

function READ_B_MEDIA.take_ref_string(take)
  local guid = READ_B_MEDIA.take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

function READ_B_MEDIA.find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

function READ_B_MEDIA.find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and READ_B_MEDIA.take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

function READ_B_MEDIA.resolve_take_token(token)
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
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return READ_B_MEDIA.find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return READ_B_MEDIA.find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = READ_B_MEDIA.find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

function READ_B_MEDIA.resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return READ_B_MEDIA.resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return READ_B_MEDIA.resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return READ_B_MEDIA.resolve_take_token("guid:" .. tostring(identity.value))
  end
  return READ_B_MEDIA.resolve_take_token(ref.ref)
end

function READ_B_MEDIA.resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = READ_B_MEDIA.resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return READ_B_MEDIA.resolve_take_token(request.params.ref)
end

local function probe_media_file(request)
  local path_value = request.params.path
  if not is_string(path_value) then
    return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Media probe requires an absolute file path.", {
      field = "path",
    })
  end
  if not file_exists(path_value) then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file does not exist.", {
      path = bounded_string(path_value, 240),
    })
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file could not be decoded as a REAPER source.", {
      path = bounded_string(path_value, 240),
    })
  end
  local length, length_is_quarter_notes = READ_B_MEDIA.source_length(source)
  local summary = {
    file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    source_type = READ_B_MEDIA.source_type(source),
    length_seconds = length,
    length_is_quarter_notes = length_is_quarter_notes,
    channel_count = READ_B_MEDIA.source_channels(source),
    metadata_keys = READ_B_MEDIA.metadata_keys_for_source(source, request.params.include_metadata_keys),
    decodable = true,
  }
  call_reaper("PCM_Source_Destroy", source)
  return summary
end
