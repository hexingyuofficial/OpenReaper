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
  local identity, identity_failure = READ_B_MEDIA.source_identity(source)
  if not identity then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("SOURCE_LENGTH_UNREADABLE", "E3 media source identity could not be read back completely.", {
      path = READ_B_MEDIA.display_path(path_value, 240),
      file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
      blocker = identity_failure and identity_failure.blocker or "source_readback_incomplete",
    })
  end

  local start_offset = 0
  local item_length = identity.source_length_seconds
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
    start_offset = identity.source_length_seconds * start_value
    item_length = identity.source_length_seconds * (end_value - start_value)
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
  local attachment, attachment_failure = READ_B_MEDIA.attach_take_source(take, source, {
    item = item,
    update_item = false,
    refresh_arrange = false,
  })
  if not attachment then
    local details = attachment_failure and attachment_failure.details or {}
    if details.source_attached ~= true and details.source_ownership_unknown ~= true then
      call_reaper("PCM_Source_Destroy", source)
    end
    return nil, attachment_failure
  end
  if start_offset > 0 then
    local ok_start, start_accepted = call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", start_offset)
    if not ok_start or (start_accepted ~= nil and start_accepted ~= true) then
      return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not set the requested source section offset.", {
        blocker = "native_start_offset_set_failed",
      }, false)
    end
  end
  local refreshed, refresh_reason = READ_B_MEDIA.refresh_item(item, false)
  if not refreshed then
    return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not refresh the attached Item.", {
      blocker = refresh_reason or "item_refresh_failed",
    }, false)
  end
  return item, nil, attachment
end

local E3_MEDIA_BATCH_MAX_ROWS = 64
local E3_MEDIA_BATCH_CHUNK_SIZE = 8

local function e3_media_batch_error(code, message, row_index, details, recoverable)
  local failure_details = details or {}
  if row_index then failure_details.row_index = row_index end
  return e3_media_handler_error(code, message, failure_details, recoverable)
end

local function e3_media_batch_finite(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function e3_media_batch_row_refs(request, row_count)
  local file_refs = json_array({})
  local track_refs = json_array({})
  if not is_json_array(request.refs) then
    return nil, nil, e3_media_handler_error("PARAMS_INVALID", "E3 media batch requires a JSON ref array.", { zero_write = true })
  end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "file" then
      file_refs[#file_refs + 1] = ref
    elseif is_object(ref) and ref.kind == "track" then
      track_refs[#track_refs + 1] = ref
    else
      return nil, nil, e3_media_handler_error("PARAMS_INVALID", "E3 media batch refs must contain only File and Track refs.", { zero_write = true })
    end
  end
  if #file_refs ~= row_count or #track_refs ~= row_count then
    return nil, nil, e3_media_handler_error("PARAMS_INVALID", "E3 media batch requires one exact File ref and one exact Track ref per row.", {
      file_ref_count = #file_refs,
      track_ref_count = #track_refs,
      row_count = row_count,
      zero_write = true,
    })
  end
  return file_refs, track_refs
end

local function e3_media_batch_prepare(request)
  local params = is_object(request.params) and request.params or {}
  local batch = params.batch
  if not is_json_array(batch) or #batch < 1 or #batch > E3_MEDIA_BATCH_MAX_ROWS then
    return nil, e3_media_handler_error("BATCH_LIMIT_EXCEEDED", "E3 media batch accepts 1-64 rows.", {
      row_count = is_json_array(batch) and #batch or 0,
      max_rows = E3_MEDIA_BATCH_MAX_ROWS,
      zero_write = true,
    })
  end
  if params.preserve_selection ~= true and params.preserve_selection ~= false then
    return nil, e3_media_handler_error("PARAMS_INVALID", "E3 media batch preserve_selection must be boolean.", { zero_write = true })
  end
  local file_refs, track_refs, ref_failure = e3_media_batch_row_refs(request, #batch)
  if ref_failure then return nil, ref_failure end
  local ids = {}
  local prepared = json_array({})
  local started = os.clock()
  for index = 1, #batch do
    local row = batch[index]
    if not is_object(row) then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch rows must be objects.", index, { zero_write = true })
    end
    for key in pairs(row) do
      if key ~= "id" and key ~= "position_seconds" and key ~= "start_percent" and key ~= "end_percent" then
        return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch row contains an unsupported field.", index, { field = key, zero_write = true })
      end
    end
    if not is_string(row.id) or #row.id < 1 or #row.id > 64 or row.id:find("[%c]") or ids[row.id] then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch row id must be unique and bounded.", index, { zero_write = true })
    end
    if not e3_media_batch_finite(row.position_seconds) or row.position_seconds < 0 then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch position_seconds must be finite and non-negative.", index, { zero_write = true })
    end
    local has_start = row.start_percent ~= nil
    local has_end = row.end_percent ~= nil
    if has_start ~= has_end
        or has_start and (not e3_media_batch_finite(row.start_percent) or not e3_media_batch_finite(row.end_percent)
          or row.start_percent < 0 or row.end_percent > 1 or row.end_percent <= row.start_percent) then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch section bounds must satisfy 0 <= start_percent < end_percent <= 1.", index, { zero_write = true })
    end
    ids[row.id] = true
    local file_ref = file_refs[index]
    local path, path_reason = e3_media_file_path_from_ref(file_ref)
    if not path then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch rejected a malformed or contradictory File ref.", index, { blocker = path_reason or "invalid_file_ref", zero_write = true })
    end
    local budget_path, budget_error = READ_B_MEDIA.ensure_mutation_path_budget(request, path)
    if not budget_path then
      budget_error.details = budget_error.details or {}
      budget_error.details.row_index = index
      budget_error.details.zero_write = true
      return nil, budget_error
    end
    path = budget_path
    local file_object_ref = READ_B_MEDIA.file_object_ref(path)
    if not file_object_ref or file_ref.ref ~= file_object_ref.ref
        or not is_object(file_ref.identity) or file_ref.identity.scheme ~= "path"
        or file_ref.identity.value ~= path then
      return nil, e3_media_batch_error("PARAMS_INVALID", "E3 media batch rejected contradictory File ref identity.", index, { blocker = "contradictory_file_ref", zero_write = true })
    end
    if not file_exists(path) then
      return nil, e3_media_batch_error("FILE_NOT_FOUND", "E3 media batch source file does not exist.", index, { file_ref = file_object_ref.ref, zero_write = true })
    end
    local track_ref = track_refs[index]
    local track = READ_B_MEDIA.resolve_track_from_ref_object(track_ref)
    local observed_track_ref = track and READ_B_MEDIA.track_ref_string(track) or nil
    if not track or not observed_track_ref or observed_track_ref ~= track_ref.ref then
      return nil, e3_media_batch_error("TRACK_NOT_FOUND", "E3 media batch could not prove the exact target Track identity.", index, { blocker = "track_identity_mismatch", zero_write = true })
    end
    local source, source_code, source_message = e3_media_create_source(path)
    if not source then
      return nil, e3_media_batch_error(source_code or "FILE_NOT_FOUND", source_message or "E3 media batch source could not be decoded.", index, { file_ref = file_object_ref.ref, zero_write = true })
    end
      local identity = READ_B_MEDIA.source_identity(source)
      local source_length = identity and identity.source_length_seconds or 0
      local length_is_quarter_notes = identity and identity.length_is_quarter_notes or false
      local source_type = identity and identity.source_type or ""
      call_reaper("PCM_Source_Destroy", source)
    if length_is_quarter_notes or not e3_media_batch_finite(source_length) or source_length <= 0 then
      return nil, e3_media_batch_error("SOURCE_LENGTH_UNREADABLE", "E3 media batch source length must be finite and positive.", index, {
        file_ref = file_object_ref.ref,
        source_type = source_type,
        zero_write = true,
      })
    end
    prepared[#prepared + 1] = {
      id = row.id,
      position_seconds = row.position_seconds,
      start_percent = row.start_percent,
      end_percent = row.end_percent,
      path = path,
      file_ref = file_object_ref.ref,
      file_object_ref = file_object_ref,
      track = track,
      track_ref = observed_track_ref,
      source_length_seconds = source_length,
      source_type = source_type,
    }
  end
  local preflight_ms = (os.clock() - started) * 1000
  local projected_rows = json_array({})
  local projected_refs = json_array({})
  local source_footprints = json_array({})
  for index = 1, #prepared do
    local row = prepared[index]
    projected_rows[#projected_rows + 1] = {
      id = row.id,
      item_ref = "item:guid:{E3-BATCH-ITEM-" .. tostring(index) .. "}",
      take_ref = "take:guid:{E3-BATCH-TAKE-" .. tostring(index) .. "}",
      source_file_ref = row.file_ref,
      track_ref = row.track_ref,
      position_seconds = row.position_seconds,
      length_seconds = row.source_length_seconds * ((row.start_percent and row.end_percent) and (row.end_percent - row.start_percent) or 1),
      source_type = row.source_type,
    }
    source_footprints[#source_footprints + 1] = {
      id = row.id,
      source_file_ref = row.file_ref,
      source_type = row.source_type,
      source_length_seconds = row.source_length_seconds,
    }
    projected_refs[#projected_refs + 1] = {
      kind = "item",
      ref = "item:guid:{E3-BATCH-ITEM-" .. tostring(index) .. "}",
      identity = { scheme = "guid", value = "{E3-BATCH-ITEM-" .. tostring(index) .. "}" },
    }
    projected_refs[#projected_refs + 1] = {
      kind = "take",
      ref = "take:guid:{E3-BATCH-TAKE-" .. tostring(index) .. "}",
      identity = { scheme = "guid", value = "{E3-BATCH-TAKE-" .. tostring(index) .. "}" },
    }
    projected_refs[#projected_refs + 1] = row.file_object_ref
  end
  local projected_summary = e3_media_summary(request, {
    rows = projected_rows,
    source_footprints = source_footprints,
    selection_restored = params.preserve_selection == true,
    batch_timings = {
      preflight_ms = preflight_ms,
      mutation_ms = 0,
      readback_ms = 0,
      evidence_ms = 0,
      transport_ms = 0,
      native_mutation_count = #prepared,
      native_readback_count = #prepared,
      rows = #prepared,
      completed_rows = #prepared,
      chunk_size = E3_MEDIA_BATCH_CHUNK_SIZE,
      chunks = math.ceil(#prepared / E3_MEDIA_BATCH_CHUNK_SIZE),
      runner = "e3_native_serial_batch",
    },
  })
  local fits, required_response_bytes, budget = READ_B_MEDIA.complete_success_envelope_fits(request, projected_summary, projected_refs, {
    undo_opened = true,
    undo_closed = true,
    verification_status = "passed",
  })
  if not fits then
    return nil, e3_media_handler_error("RESPONSE_TOO_LARGE", "E3 media batch success envelope cannot fit before mutation.", {
      blocker = "success_envelope_budget_insufficient",
      required_response_bytes = required_response_bytes,
      max_response_bytes = budget.max_response_bytes,
      row_count = #prepared,
      zero_write = true,
    })
  end
  prepared.preflight_ms = preflight_ms
  return prepared
end

local function e3_media_batch_take_object_ref(take)
  local take_ref = READ_B_MEDIA.take_ref_string(take)
  if not take_ref then return nil end
  return {
    kind = "take",
    ref = take_ref,
    identity = {
      scheme = take_ref:match("^take:([^:]+):") or "index",
      value = take_ref:match("^take:[^:]+:(.+)$") or "0",
    },
  }
end

local function e3_media_batch_row_readback(row, item, take, preserve_selection, take_name)
  local item_ref = e3_media_item_object_ref(item)
  local take_ref = e3_media_batch_take_object_ref(take)
  if not item_ref or not take_ref then
    return nil, e3_media_handler_error("VERIFY_FAILED", "E3 media batch could not prove a truthful Item or Take identity after mutation.", {
      blocker = "native_identity_unavailable",
      zero_write = false,
    }, false)
  end
  local ok_position, position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
  local ok_length, item_length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  local source_filename = ok_source and source and READ_B_MEDIA.source_filename_raw(source) or ""
  local source_length, source_is_quarter_notes = ok_source and source and READ_B_MEDIA.source_length(source) or 0, false
  local source_type = ok_source and source and READ_B_MEDIA.source_type(source) or ""
  if not ok_position or not ok_length or not ok_source or not source or source_filename ~= row.path
      or source_is_quarter_notes or not e3_media_batch_finite(source_length) or source_length <= 0 then
    return nil, e3_media_handler_error("VERIFY_FAILED", "E3 media batch native source or Item readback did not match preflight identity.", {
      blocker = "native_readback_mismatch",
      zero_write = false,
    }, false)
  end
  local expected_length = row.source_length_seconds
  if row.start_percent ~= nil then expected_length = expected_length * (row.end_percent - row.start_percent) end
  if not e3_media_batch_finite(position) or not e3_media_batch_finite(item_length)
      or math.abs(position - row.position_seconds) > 0.000001 or math.abs(item_length - expected_length) > 0.000001 then
    return nil, e3_media_handler_error("VERIFY_FAILED", "E3 media batch Item position or length readback did not match the requested row.", {
      blocker = "item_position_or_length_mismatch",
      zero_write = false,
    }, false)
  end
  return {
    id = row.id,
    batch_index = row.batch_index,
    item_ref = item_ref.ref,
    take_ref = take_ref.ref,
    source_file_ref = row.file_ref,
    track_ref = row.track_ref,
    position_seconds = position,
    length_seconds = item_length,
    source_length_seconds = source_length,
    source_type = source_type,
    take_name = take_name,
    selection_restored = preserve_selection,
    source_section = row.start_percent ~= nil and { start_percent = row.start_percent, end_percent = row.end_percent } or nil,
  }, item_ref, take_ref
end

local function import_files_batch(request, preflight_only)
  local prepared = request.__openreaper_media_batch_prepared
  if not is_json_array(prepared) then
    local failure
    prepared, failure = e3_media_batch_prepare(request)
    if not prepared then return nil, failure end
    request.__openreaper_media_batch_prepared = prepared
  end
  if preflight_only == true then return true end
  local preserve_selection = request.params.preserve_selection == true
  local previous_selection = preserve_selection and e3_media_selected_items() or nil
  local result_rows = json_array({})
  local source_footprints = json_array({})
  local refs = json_array({})
  local mutation_started = os.clock()
  local mutation_ms = 0
  local readback_ms = 0
  local native_mutations = 0
  local native_readbacks = 0
  local last_item = nil
  local function fail_batch(failure, index)
    failure.details = failure.details or {}
    failure.details.row_index = index
    failure.details.completed_rows = #result_rows
    failure.details.native_mutation_count = native_mutations
    failure.details.native_readback_count = native_readbacks
    failure.details.zero_write = native_mutations == 0
    if preserve_selection then e3_media_restore_selected_items(previous_selection) elseif last_item then e3_media_select_only_item(last_item) end
    return nil, failure
  end
  for chunk_start = 1, #prepared, E3_MEDIA_BATCH_CHUNK_SIZE do
    local chunk_end = math.min(#prepared, chunk_start + E3_MEDIA_BATCH_CHUNK_SIZE - 1)
    for index = chunk_start, chunk_end do
      local row = prepared[index]
      row.batch_index = index
      local source, source_code, source_message = e3_media_create_source(row.path)
      if not source then
        return fail_batch(e3_media_handler_error(source_code or "FILE_NOT_FOUND", source_message or "E3 media batch source could not be decoded.", { file_ref = row.file_ref }), index)
      end
      local start_offset = row.start_percent and row.source_length_seconds * row.start_percent or 0
      local item_length = row.start_percent and row.source_length_seconds * (row.end_percent - row.start_percent) or row.source_length_seconds
      local mutation_phase = os.clock()
      local ok_item, item = call_reaper("AddMediaItemToTrack", row.track)
      if not ok_item or not item then
        call_reaper("PCM_Source_Destroy", source)
        return fail_batch(e3_media_handler_error("COMMAND_FAILED", "E3 media batch could not create a media item.", {}, false), index)
      end
      native_mutations = native_mutations + 1
      local ok_position, position_accepted = call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", row.position_seconds)
      local ok_length, length_accepted = call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", item_length)
      local ok_take, take = call_reaper("AddTakeToMediaItem", item)
      local position_ok = position_accepted == nil or position_accepted == true
      local length_ok = length_accepted == nil or length_accepted == true
      if not ok_position or not position_ok or not ok_length or not length_ok or not ok_take or not take then
        call_reaper("PCM_Source_Destroy", source)
        return fail_batch(e3_media_handler_error("COMMAND_FAILED", "E3 media batch could not configure a media item and take.", { blocker = "native_item_setup_failed" }, false), index)
      end
      local attachment, attachment_failure = READ_B_MEDIA.attach_take_source(take, source, {
        item = item,
        update_item = false,
        refresh_arrange = false,
      })
      if not attachment then
        local details = attachment_failure and attachment_failure.details or {}
        if details.source_attached ~= true and details.source_ownership_unknown ~= true then
          call_reaper("PCM_Source_Destroy", source)
        end
        return fail_batch(attachment_failure, index)
      end
      if start_offset > 0 then
        local ok_start, start_accepted = call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", start_offset)
        if not ok_start or (start_accepted ~= nil and start_accepted ~= true) then
          return fail_batch(e3_media_handler_error("COMMAND_FAILED", "E3 media batch could not set the requested source section offset.", { blocker = "native_start_offset_set_failed" }, false), index)
        end
      end
      local refreshed, refresh_reason = READ_B_MEDIA.refresh_item(item, false)
      if not refreshed then
        return fail_batch(e3_media_handler_error("COMMAND_FAILED", "E3 media batch could not refresh the attached Item.", { blocker = refresh_reason or "item_refresh_failed" }, false), index)
      end
      mutation_ms = mutation_ms + ((os.clock() - mutation_phase) * 1000)
      last_item = item
      local readback_phase = os.clock()
      local result, item_ref, take_ref = e3_media_batch_row_readback(row, item, take, preserve_selection, attachment.take_name)
      readback_ms = readback_ms + ((os.clock() - readback_phase) * 1000)
      if not result then
        return fail_batch(item_ref, index)
      end
      native_readbacks = native_readbacks + 1
      result_rows[#result_rows + 1] = result
      source_footprints[#source_footprints + 1] = {
        id = row.id,
        source_file_ref = row.file_ref,
        source_type = result.source_type,
        source_length_seconds = result.source_length_seconds,
        take_name = attachment.take_name,
      }
      refs[#refs + 1] = item_ref
      refs[#refs + 1] = take_ref
      refs[#refs + 1] = row.file_object_ref
    end
  end
  if preserve_selection then e3_media_restore_selected_items(previous_selection) elseif last_item then e3_media_select_only_item(last_item) end
  local evidence_started = os.clock()
  local evidence_ms = (os.clock() - evidence_started) * 1000
  local total_ms = (os.clock() - mutation_started) * 1000
  return e3_media_summary(request, {
    rows = result_rows,
    source_footprints = source_footprints,
    selection_restored = preserve_selection,
    batch_timings = {
      preflight_ms = prepared.preflight_ms or 0,
      mutation_ms = mutation_ms,
      readback_ms = readback_ms,
      evidence_ms = evidence_ms,
      transport_ms = 0,
      total_native_ms = total_ms,
      native_mutation_count = native_mutations,
      native_readback_count = native_readbacks,
      rows = #result_rows,
      completed_rows = #result_rows,
      chunk_size = E3_MEDIA_BATCH_CHUNK_SIZE,
      chunks = math.ceil(#result_rows / E3_MEDIA_BATCH_CHUNK_SIZE),
      runner = "e3_native_serial_batch",
    },
  }), nil, nil, nil, refs
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
  local item, failure, attachment = e3_media_set_item_source(
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
    take_name = attachment and attachment.take_name or nil,
    source_type = attachment and attachment.source_type or nil,
    source_length_seconds = attachment and attachment.source_length_seconds or nil,
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
    local new_identity = READ_B_MEDIA.source_identity(source)
    local new_type = new_identity and new_identity.source_type or ""
    if old_type ~= "" and new_type ~= "" and old_type ~= new_type then
      call_reaper("PCM_Source_Destroy", source)
      return e3_media_handler_error("SOURCE_TYPE_MISMATCH", "E3 media relink source type does not match the current take source.", {
        current_source_type = old_type,
        replacement_source_type = new_type,
      })
    end
  end
  local item = e3_media_take_item(take)
  local attachment, attachment_failure = READ_B_MEDIA.attach_take_source(take, source, {
    item = item,
    update_item = true,
    refresh_arrange = true,
  })
  if not attachment then
    local details = attachment_failure and attachment_failure.details or {}
    if details.source_attached ~= true and details.source_ownership_unknown ~= true then
      call_reaper("PCM_Source_Destroy", source)
    end
    return nil, attachment_failure
  end
  return e3_media_summary(request, {
    take_ref = take_ref,
    source_file_ref = attachment.file_ref or file_object_ref.ref,
    source_type = attachment.source_type,
    source_length_seconds = attachment.source_length_seconds,
    take_name = attachment.take_name,
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
