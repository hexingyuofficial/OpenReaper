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
  return READ_B_MEDIA.track_guid(track)
end

local function e3_media_track_index(track)
  return READ_B_MEDIA.track_index(track)
end

local function e3_media_track_ref_string(track)
  return READ_B_MEDIA.track_ref_string(track)
end

local function e3_media_track_from_request_refs(request)
  return READ_B_MEDIA.resolve_track_for_request(request)
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
  if type(guid) == "string" and guid ~= "" and READ_B_MEDIA.identity_value_within_mutation_bound(guid) then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  if not ok_count then
    return nil
  end
  local total = first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return nil
end

local function e3_media_item_object_ref(item)
  local ref = e3_media_item_ref_string(item)
  if not ref then
    return nil
  end
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

local function e3_media_selected_items()
  local selected = json_array({})
  local ok_count, count = call_reaper("CountSelectedMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
    if ok_item and item then
      selected[#selected + 1] = item
    end
  end
  return selected
end

local function e3_media_select_only_item(target_item)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item then
      call_reaper("SetMediaItemSelected", item, item == target_item)
    end
  end
  call_reaper("UpdateArrange")
end

local function e3_media_restore_selected_items(selected)
  local selected_lookup = {}
  if is_json_array(selected) then
    for index = 1, #selected do
      selected_lookup[selected[index]] = true
    end
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item then
      call_reaper("SetMediaItemSelected", item, selected_lookup[item] == true)
    end
  end
  call_reaper("UpdateArrange")
end

local function e3_media_file_path_from_ref(ref)
  local path_value, reason = READ_B_MEDIA.file_path_from_ref_object(ref)
  if reason then
    return nil, reason
  end
  return path_value
end

local function e3_media_file_path_from_request_refs(request)
  local path_value, reason = READ_B_MEDIA.file_path_from_request_refs_strict(request)
  if not path_value then
    return nil, reason
  end
  return path_value
end

local function e3_media_file_ref_failure(reason)
  if reason == "contradictory_file_ref" then
    return e3_media_handler_error("PARAMS_INVALID", "E3 media write rejected contradictory file ref identity.", {
      blocker = reason,
      zero_write = true,
    })
  end
  if reason == "relative_path" or reason == "empty_path" or reason == "nul_char" then
    return e3_media_handler_error("PARAMS_INVALID", "E3 media write requires a valid absolute source file path.", {
      blocker = reason,
      zero_write = true,
    })
  end
  return e3_media_handler_error("FILE_NOT_FOUND", "E3 media write requires a resolvable absolute source file ref.", {
    blocker = reason or "missing_file_ref",
    zero_write = true,
  })
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
      folder_ref = READ_B_MEDIA.display_path(request.params.folder_ref, 240),
    })
  end
  local absolute_folder, folder_error = READ_B_MEDIA.ensure_folder_ref_inline_budget(request, folder_path)
  if not absolute_folder then
    return nil, folder_error
  end
  folder_path = absolute_folder
  local folder_ref = READ_B_MEDIA.folder_ref_for_path(folder_path)
  if not folder_ref then
    return e3_media_handler_error("PARAMS_INVALID", "E3 folder media list requires a valid absolute folder path.", {
      folder_ref = READ_B_MEDIA.display_path(request.params.folder_ref, 240),
      blocker = "invalid_path",
    })
  end
  if not reaper or type(reaper.EnumerateFiles) ~= "function" then
    return e3_media_handler_error("API_UNAVAILABLE", "REAPER EnumerateFiles API is required for folder media listing.", {})
  end
  local budget = safe_budget(request)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 20, 100)
  local offset = math.max(0, math.floor(e3_media_finite_number(request.params.offset, 0)))
  local media_type = is_string(request.params.media_type) and request.params.media_type or "any"
  local matched_paths = json_array({})
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(folder_path, index)
    if not filename then
      break
    end
    if e3_media_extension_allowed(filename, media_type, request.params.extension_filter) then
      local path_value = READ_B_MEDIA.path_join(folder_path, filename)
      if not path_value then
        return e3_media_handler_error("PARAMS_INVALID", "Folder media entry path is invalid for canonical absolute file identity.", {
          path = READ_B_MEDIA.display_path(filename, 240),
        })
      end
      local path, path_error = READ_B_MEDIA.ensure_identity_inline_budget(request, path_value)
      if not path then
        return nil, path_error
      end
      local file_ref = READ_B_MEDIA.file_ref_for_path(path)
      if not file_ref then
        return e3_media_handler_error("PARAMS_INVALID", "Folder media entry path is invalid for canonical absolute file identity.", {
          path = READ_B_MEDIA.display_path(path_value, 240),
        })
      end
      matched_paths[#matched_paths + 1] = {
        name = filename,
        path = path,
        file_ref = file_ref,
        media_type = e3_media_kind_for_path(filename),
      }
    end
    index = index + 1
  end
  local matched = #matched_paths
  local function build_summary(page_rows, page_refs, truncated)
    return e3_media_summary(request, {
      folder_ref = folder_ref,
      rows = page_rows,
      file_refs = page_refs,
      row_count = #page_rows,
      limit = limit,
      offset = offset,
      total_matching_count = matched,
      truncated = truncated,
    })
  end
  local function page_fits(candidate_rows, candidate_refs, truncated)
    local summary = build_summary(candidate_rows, candidate_refs, truncated)
    local fits, required_bytes = READ_B_MEDIA.complete_success_envelope_fits(request, summary, json_array({}), {
      undo_opened = false,
      undo_closed = false,
      verification_status = "passed",
    })
    return fits, required_bytes, summary
  end

  -- Empty / no-match still validates returned folder_ref and empty-page complete envelope.
  if matched == 0 or offset >= matched then
    local empty_rows = json_array({})
    local empty_refs = json_array({})
    local fits, encoded_bytes, summary = page_fits(empty_rows, empty_refs, false)
    if not fits then
      return e3_media_handler_error("RESPONSE_TOO_LARGE", "Folder media empty page cannot fit within the complete success envelope budget.", {
        blocker = "empty_page_exceeds_budget",
        required_response_bytes = encoded_bytes,
        max_response_bytes = budget.max_response_bytes,
        max_inline_value_bytes = budget.max_inline_value_bytes,
        folder_ref = folder_ref,
        proof = "complete_success_envelope",
      })
    end
    return summary
  end

  local rows = json_array({})
  local file_refs = json_array({})
  local end_index = math.min(matched, offset + limit)
  for entry_index = offset + 1, end_index do
    local entry = matched_paths[entry_index]
    rows[#rows + 1] = {
      name = READ_B_MEDIA.display_path(entry.name, 160),
      file_ref = entry.file_ref,
      media_type = entry.media_type,
    }
    file_refs[#file_refs + 1] = entry.file_ref
  end

  while #rows > 0 do
    local truncated = offset + #rows < matched
    local fits = page_fits(rows, file_refs, truncated)
    if fits then
      break
    end
    table.remove(rows)
    table.remove(file_refs)
  end

  if #rows == 0 then
    local entry = matched_paths[offset + 1]
    local single_rows = json_array({
      {
        name = READ_B_MEDIA.display_path(entry.name, 160),
        file_ref = entry.file_ref,
        media_type = entry.media_type,
      },
    })
    local single_refs = json_array({ entry.file_ref })
    local fits, encoded_bytes = page_fits(single_rows, single_refs, offset + 1 < matched)
    if not fits then
      return e3_media_handler_error("RESPONSE_TOO_LARGE", "One folder media identity row cannot fit within the complete success envelope budget.", {
        blocker = "single_identity_row_exceeds_budget",
        required_response_bytes = encoded_bytes,
        max_response_bytes = budget.max_response_bytes,
        max_inline_value_bytes = budget.max_inline_value_bytes,
        file_ref = entry.file_ref,
        proof = "complete_success_envelope",
      })
    end
    rows = single_rows
    file_refs = single_refs
  end

  local truncated = offset + #rows < matched
  local fits, encoded_bytes, summary = page_fits(rows, file_refs, truncated)
  if not fits then
    return e3_media_handler_error("RESPONSE_TOO_LARGE", "Folder media empty page cannot fit within the complete success envelope budget.", {
      blocker = "empty_page_exceeds_budget",
      required_response_bytes = encoded_bytes,
      max_response_bytes = budget.max_response_bytes,
      proof = "complete_success_envelope",
    })
  end
  return summary
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
    return nil, e3_media_handler_error(code, message, {
      path = READ_B_MEDIA.display_path(path_value, 240),
      file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    })
  end
  local length, is_quarter_notes = READ_B_MEDIA.source_length(source)
  if is_quarter_notes or length <= 0 then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("SOURCE_LENGTH_UNREADABLE", "E3 media source length could not be measured.", {
      path = READ_B_MEDIA.display_path(path_value, 240),
      file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
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
  local target = is_object(request.__openreaper_media_target) and request.__openreaper_media_target or nil
  local track = target and target.track or e3_media_track_from_request_refs(request)
  if not track then
    return e3_media_handler_error("TRACK_NOT_FOUND", "E3 media import requires a resolvable target track ref.", {})
  end
  local track_ref = target and target.track_ref or e3_media_track_ref_string(track)
  if not track_ref then
    return e3_media_handler_error("TRACK_NOT_FOUND", "E3 media import could not prove a truthful track identity before mutation.", {
      blocker = "track_identity_unavailable",
      zero_write = true,
    })
  end
  local path = target and target.path or nil
  if not path then
    local path_value, path_reason = e3_media_file_path_from_request_refs(request)
    if not path_value then
      return e3_media_file_ref_failure(path_reason)
    end
    local budget_path, budget_error = READ_B_MEDIA.ensure_mutation_path_budget(request, path_value)
    if not budget_path then
      return nil, budget_error
    end
    path = budget_path
  end
  local file_object_ref = READ_B_MEDIA.file_object_ref(path)
  local preserve_selection = request.params.preserve_selection == true
  local previous_selection = preserve_selection and e3_media_selected_items() or nil
  local item, failure = e3_media_set_item_source(
    track,
    path,
    request.params.position_seconds,
    section and request.params.start_percent or nil,
    section and request.params.end_percent or nil
  )
  if not item then
    return nil, failure
  end
  if preserve_selection then
    e3_media_restore_selected_items(previous_selection)
  else
    e3_media_select_only_item(item)
  end
  -- Public refs use native GUID only when JSON-escaped content fits the bound;
  -- otherwise truthful enumerated index (never fabricate GUID or index 0).
  local item_ref = e3_media_item_object_ref(item)
  if not item_ref then
    return e3_media_handler_error("COMMAND_FAILED", "E3 media import could not prove a truthful item identity after mutation.", {
      blocker = "item_identity_unavailable",
      zero_write = false,
      track_ref = track_ref,
    }, false)
  end
  local source_file_ref = file_object_ref.ref
  local readback = {
    imported_item_refs = json_array({ item_ref.ref }),
    item_count = 1,
    source_file_ref = source_file_ref,
    track_ref = track_ref,
    position_seconds = e3_media_finite_number(request.params.position_seconds, 0),
    selection_restored = preserve_selection,
  }
  if section then
    readback.start_percent = e3_media_finite_number(request.params.start_percent, 0)
    readback.end_percent = e3_media_finite_number(request.params.end_percent, 1)
  end
  return e3_media_summary(request, readback), nil, nil, nil, e3_media_refs(item_ref, file_object_ref)
end

local function import_file_to_track(request)
  return e3_media_import_to_track(request, false)
end

local function import_file_section_to_track(request)
  return e3_media_import_to_track(request, true)
end

local function relink_take_source(request)
  local target = is_object(request.__openreaper_media_target) and request.__openreaper_media_target or nil
  local take = target and target.take or READ_B_MEDIA.resolve_take_for_request(request)
  if not take then
    return e3_media_handler_error("TAKE_NOT_FOUND", "E3 media relink requires a resolvable take ref.", {})
  end
  local take_ref = target and target.take_ref or READ_B_MEDIA.take_ref_string(take)
  if not take_ref then
    return e3_media_handler_error("TAKE_NOT_FOUND", "E3 media relink could not prove a truthful take identity before mutation.", {
      blocker = "take_identity_unavailable",
      zero_write = true,
    })
  end
  local path = target and target.path or nil
  if not path then
    local path_value, path_reason = e3_media_file_path_from_request_refs(request)
    if not path_value then
      return e3_media_file_ref_failure(path_reason)
    end
    local budget_path, budget_error = READ_B_MEDIA.ensure_mutation_path_budget(request, path_value)
    if not budget_path then
      return nil, budget_error
    end
    path = budget_path
  end
  local file_object_ref = READ_B_MEDIA.file_object_ref(path)
  local source, code, message = e3_media_create_source(path)
  if not source then
    return e3_media_handler_error(code, message, {
      path = READ_B_MEDIA.display_path(path, 240),
      file_ref = file_object_ref.ref,
    })
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
  return e3_media_summary(request, {
    take_ref = take_ref,
    source_file_ref = file_object_ref.ref,
    source_type = e3_media_kind_for_path(path),
    relinked = true,
  }), nil, nil, nil, e3_media_refs({
    kind = "take",
    ref = take_ref,
    identity = {
      scheme = take_ref:match("^take:([^:]+):") or "index",
      value = take_ref:match("^take:[^:]+:(.+)$") or "0",
    },
  }, file_object_ref)
end
