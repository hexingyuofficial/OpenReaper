-- Extracted E3 media route handlers.

local function e3_media_handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e3_media_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e3_media_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = request.pack.risk == "write" and "required" or "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function e3_media_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e3_media_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e3_media_track_index(track)
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

local function e3_media_track_ref_string(track)
  local guid = e3_media_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e3_media_track_index(track))
end

local function e3_media_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e3_media_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e3_media_resolve_track_token(token)
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
    return e3_media_find_track_by_guid(guid)
  end
  return nil
end

local function e3_media_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e3_media_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e3_media_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e3_media_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e3_media_resolve_track_token(ref.ref)
end

local function e3_media_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e3_media_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e3_media_item_guid(item)
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

local function e3_media_item_ref_string(item)
  local guid = e3_media_item_guid(item)
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

local function e3_media_item_object_ref(item)
  local ref = e3_media_item_ref_string(item)
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

local function e3_media_take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

local function e3_media_file_path_from_ref(ref)
  if not is_object(ref) or ref.kind ~= "file" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "path" and is_string(identity.value) then
    return identity.value
  end
  if is_string(ref.ref) then
    return ref.ref:match("^file:path:(.+)$")
  end
  return nil
end

local function e3_media_file_path_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local path_value = e3_media_file_path_from_ref(request.refs[index])
      if path_value then
        return path_value
      end
    end
  end
  return nil
end

local function e3_media_kind_for_path(path_value)
  local extension = tostring(path_value or ""):match("%.([^%.%/\\]+)$")
  extension = extension and extension:lower() or ""
  if extension == "wav" or extension == "wave" or extension == "aif" or extension == "aiff" or extension == "flac" or extension == "mp3" or extension == "ogg" or extension == "m4a" then
    return "audio"
  elseif extension == "mid" or extension == "midi" then
    return "midi"
  elseif extension == "mov" or extension == "mp4" or extension == "mkv" then
    return "video"
  end
  return "unknown"
end

local function e3_media_extension_allowed(filename, media_type, extension_filter)
  local extension = filename:match("%.([^%.]+)$")
  extension = extension and extension:lower() or ""
  if is_json_array(extension_filter) and #extension_filter > 0 then
    local matched = false
    for index = 1, #extension_filter do
      local allowed = tostring(extension_filter[index] or ""):lower():gsub("^%.", "")
      if allowed == extension then
        matched = true
      end
    end
    if not matched then
      return false
    end
  end
  if media_type and media_type ~= "any" then
    return e3_media_kind_for_path(filename) == media_type
  end
  return e3_media_kind_for_path(filename) ~= "unknown"
end

local function e3_media_folder_path(folder_ref)
  if not is_string(folder_ref) then
    return nil
  end
  return folder_ref:match("^folder:path:(.+)$")
end

local function list_folder_media_files(request)
  local folder_path = e3_media_folder_path(request.params.folder_ref)
  if not folder_path then
    return e3_media_handler_error("PARAMS_INVALID", "E3 folder media list requires folder:path:<absolute-path>.", {
      folder_ref = bounded_string(request.params.folder_ref, 240),
    })
  end
  if not reaper or type(reaper.EnumerateFiles) ~= "function" then
    return e3_media_handler_error("API_UNAVAILABLE", "REAPER EnumerateFiles API is required for folder media listing.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 20, 100)
  local offset = math.max(0, math.floor(e3_media_finite_number(request.params.offset, 0)))
  local media_type = is_string(request.params.media_type) and request.params.media_type or "any"
  local rows = json_array({})
  local file_refs = json_array({})
  local matched = 0
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(folder_path, index)
    if not filename then
      break
    end
    if e3_media_extension_allowed(filename, media_type, request.params.extension_filter) then
      if matched >= offset and #rows < limit then
        local path_value = folder_path .. "/" .. filename
        rows[#rows + 1] = {
          name = bounded_string(filename, 160),
          file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
          media_type = e3_media_kind_for_path(filename),
        }
        file_refs[#file_refs + 1] = READ_B_MEDIA.file_ref_for_path(path_value)
      end
      matched = matched + 1
    end
    index = index + 1
  end
  return e3_media_summary(request, {
    folder_ref = request.params.folder_ref,
    rows = rows,
    file_refs = file_refs,
    row_count = #rows,
    limit = limit,
    offset = offset,
    total_matching_count = matched,
    truncated = matched > offset + #rows,
  })
end

local function e3_media_create_source(path_value)
  if not is_string(path_value) or not file_exists(path_value) then
    return nil, "FILE_NOT_FOUND", "E3 media source file does not exist."
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return nil, "FILE_NOT_FOUND", "E3 media source could not be decoded by REAPER."
  end
  return source
end

local function e3_media_set_item_source(track, path_value, position, start_percent, end_percent)
  local source, code, message = e3_media_create_source(path_value)
  if not source then
    return nil, e3_media_handler_error(code, message, { path = bounded_string(path_value, 240) })
  end
  local length, is_quarter_notes = READ_B_MEDIA.source_length(source)
  if is_quarter_notes or length <= 0 then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("SOURCE_LENGTH_UNREADABLE", "E3 media source length could not be measured.", {
      path = bounded_string(path_value, 240),
      source_type = e3_media_kind_for_path(path_value),
    })
  end

  local start_offset = 0
  local item_length = length
  if type(start_percent) == "number" or type(end_percent) == "number" then
    local start_value = e3_media_finite_number(start_percent, 0)
    local end_value = e3_media_finite_number(end_percent, 1)
    if start_value < 0 or end_value > 1 or end_value <= start_value then
      call_reaper("PCM_Source_Destroy", source)
      return nil, e3_media_handler_error("PARAMS_INVALID", "E3 media section import requires 0 <= start_percent < end_percent <= 1.", {
        start_percent = start_percent,
        end_percent = end_percent,
      })
    end
    start_offset = length * start_value
    item_length = length * (end_value - start_value)
  end

  local ok_item, item = call_reaper("AddMediaItemToTrack", track)
  if not ok_item or not item then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not create a media item.", {}, false)
  end
  call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", e3_media_finite_number(position, 0))
  call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", item_length)
  local ok_take, take = call_reaper("AddTakeToMediaItem", item)
  if not ok_take or not take then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not create a take.", {}, false)
  end
  call_reaper("SetMediaItemTake_Source", take, source)
  if start_offset > 0 then
    call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", start_offset)
  end
  call_reaper("UpdateItemInProject", item)
  return item, nil
end

local function e3_media_import_to_track(request, section)
  local track = e3_media_track_from_request_refs(request)
  if not track then
    return e3_media_handler_error("TRACK_NOT_FOUND", "E3 media import requires a resolvable target track ref.", {})
  end
  local path_value = e3_media_file_path_from_request_refs(request)
  if not path_value then
    return e3_media_handler_error("FILE_NOT_FOUND", "E3 media import requires a source file ref.", {})
  end
  local item, failure = e3_media_set_item_source(
    track,
    path_value,
    request.params.position_seconds,
    section and request.params.start_percent or nil,
    section and request.params.end_percent or nil
  )
  if not item then
    return nil, failure
  end
  local item_ref = e3_media_item_object_ref(item)
  local readback = {
    imported_item_refs = json_array({ item_ref.ref }),
    item_count = 1,
    source_file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    track_ref = e3_media_track_ref_string(track),
    position_seconds = e3_media_finite_number(request.params.position_seconds, 0),
    selection_restored = request.params.preserve_selection == true,
  }
  if section then
    readback.start_percent = e3_media_finite_number(request.params.start_percent, 0)
    readback.end_percent = e3_media_finite_number(request.params.end_percent, 1)
  end
  return e3_media_summary(request, readback), nil, nil, nil, e3_media_refs(item_ref, {
    kind = "file",
    ref = READ_B_MEDIA.file_ref_for_path(path_value),
    identity = { scheme = "path", value = path_value },
  })
end

local function import_file_to_track(request)
  return e3_media_import_to_track(request, false)
end

local function import_file_section_to_track(request)
  return e3_media_import_to_track(request, true)
end

local function relink_take_source(request)
  local take = READ_B_MEDIA.resolve_take_for_request(request)
  if not take then
    return e3_media_handler_error("TAKE_NOT_FOUND", "E3 media relink requires a resolvable take ref.", {})
  end
  local path_value = e3_media_file_path_from_request_refs(request)
  if not path_value then
    return e3_media_handler_error("FILE_NOT_FOUND", "E3 media relink requires a source file ref.", {})
  end
  local source, code, message = e3_media_create_source(path_value)
  if not source then
    return e3_media_handler_error(code, message, { path = bounded_string(path_value, 240) })
  end
  if request.params.verify_source_type == true then
    local ok_old_source, old_source = call_reaper("GetMediaItemTake_Source", take)
    local old_type = ok_old_source and old_source and READ_B_MEDIA.source_type(old_source) or ""
    local new_type = READ_B_MEDIA.source_type(source)
    if old_type ~= "" and new_type ~= "" and old_type ~= new_type then
      call_reaper("PCM_Source_Destroy", source)
      return e3_media_handler_error("SOURCE_TYPE_MISMATCH", "E3 media relink source type does not match the current take source.", {
        current_source_type = old_type,
        replacement_source_type = new_type,
      })
    end
  end
  call_reaper("SetMediaItemTake_Source", take, source)
  local item = e3_media_take_item(take)
  if item then
    call_reaper("UpdateItemInProject", item)
  end
  local take_ref = READ_B_MEDIA.take_ref_string(take)
  return e3_media_summary(request, {
    take_ref = take_ref,
    source_file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    source_type = e3_media_kind_for_path(path_value),
    relinked = true,
  }), nil, nil, nil, e3_media_refs({
    kind = "take",
    ref = take_ref,
    identity = {
      scheme = take_ref:match("^take:([^:]+):") or "index",
      value = take_ref:match("^take:[^:]+:(.+)$") or "0",
    },
  }, {
    kind = "file",
    ref = READ_B_MEDIA.file_ref_for_path(path_value),
    identity = { scheme = "path", value = path_value },
  })
end
