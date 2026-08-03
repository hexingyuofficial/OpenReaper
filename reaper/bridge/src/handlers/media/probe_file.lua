-- Extracted read-only handler: template.media.probe_file.

local READ_B_MEDIA = {}

local MEDIA_FILE_PATH_MAX_BYTES = 4096
local MEDIA_DISPLAY_PATH_MAX_BYTES = 240
local MEDIA_FILE_REF_PREFIX = "file:path:"
local MEDIA_FILE_REF_PREFIX_BYTES = #MEDIA_FILE_REF_PREFIX
local MEDIA_IDENTITY_JSON_ESCAPE_FACTOR = 6
local MEDIA_IDENTITY_JSON_FIELD_OVERHEAD_BYTES = 96
-- Fixed shell of foundation.bridge.v1 success envelope without request-echoed or summary fields.
local MEDIA_SUCCESS_ENVELOPE_SHELL_MAX_BYTES = 1200
local MEDIA_MUTATION_PATH_OCCURRENCES = 3
local MEDIA_READ_SUCCESS_ENVELOPE_FIXED_MAX_BYTES = 8192
local MEDIA_MUTATION_SUMMARY_FIXED_MAX_BYTES = 2048
local MEDIA_TAKE_NAME_MAX_BYTES = 160
local MEDIA_SOURCE_LENGTH_MAX_DIGITS = 309

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

function READ_B_MEDIA.display_path(path_value, max_bytes)
  local text = type(path_value) == "string" and path_value or tostring(path_value or "")
  local limit = math.max(4, math.floor(tonumber(max_bytes) or MEDIA_DISPLAY_PATH_MAX_BYTES))
  if #text <= limit then
    return text
  end
  local cut = limit - 3
  while cut > 0 do
    local next_byte = string.byte(text, cut + 1)
    if next_byte == nil or next_byte < 128 or next_byte >= 192 then
      break
    end
    cut = cut - 1
  end
  return text:sub(1, cut) .. "..."
end

function READ_B_MEDIA.is_absolute_path(path_value)
  if type(path_value) ~= "string" or path_value == "" then
    return false
  end
  if path_value:sub(1, 1) == "/" then
    return true
  end
  if path_value:match("^%a:[/\\]") then
    return true
  end
  if path_value:match("^\\\\[^\\/]+[\\/][^\\/]+") or path_value:match("^//[^/]+/[^/]+") then
    return true
  end
  return false
end

function READ_B_MEDIA.canonical_path(path_value)
  if type(path_value) ~= "string" or path_value == "" then
    return nil, "empty_path"
  end
  -- Canonical absolute identity rejects only embedded NUL unless a frozen ABI
  -- rule requires more. JSON-expressible characters (tab/newline) are preserved.
  if path_value:find("\0", 1, true) then
    return nil, "nul_char"
  end
  if not READ_B_MEDIA.is_absolute_path(path_value) then
    return nil, "relative_path"
  end
  return path_value
end

function READ_B_MEDIA.path_join(folder_path, filename)
  if type(folder_path) ~= "string" or type(filename) ~= "string" then
    return nil
  end
  -- POSIX absolute paths treat only '/' as separator; a legal backslash character
  -- in the folder path must not be promoted into a path separator.
  if folder_path:sub(1, 1) == "/" then
    if folder_path:sub(-1) == "/" then
      return folder_path .. filename
    end
    return folder_path .. "/" .. filename
  end
  if folder_path:match("^%a:[/\\]") or folder_path:match("^\\\\") or folder_path:match("^//") then
    local sep = "\\"
    if folder_path:find("/", 1, true) and not folder_path:find("\\", 1, true) then
      sep = "/"
    end
    if folder_path:sub(-1) == "/" or folder_path:sub(-1) == "\\" then
      return folder_path .. filename
    end
    return folder_path .. sep .. filename
  end
  return nil
end

function READ_B_MEDIA.folder_ref_for_path(folder_path)
  local path = READ_B_MEDIA.canonical_path(folder_path)
  if not path then
    return nil
  end
  return "folder:path:" .. path
end

function READ_B_MEDIA.folder_ref_bytes(folder_path)
  if type(folder_path) ~= "string" then
    return -1
  end
  return #"folder:path:" + #folder_path
end

function READ_B_MEDIA.ensure_folder_ref_inline_budget(request, folder_path)
  local path, reason = READ_B_MEDIA.canonical_path(folder_path)
  if not path then
    return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Media folder path is invalid for canonical absolute folder identity.", {
      blocker = reason or "invalid_path",
      path = READ_B_MEDIA.display_path(folder_path, MEDIA_DISPLAY_PATH_MAX_BYTES),
      path_bytes = type(folder_path) == "string" and #folder_path or -1,
    })
  end
  local budget = safe_budget(request)
  local max_inline = math.floor(tonumber(budget.max_inline_value_bytes) or 0)
  local ref_bytes = READ_B_MEDIA.folder_ref_bytes(path)
  if max_inline < 1 or ref_bytes < 1 or ref_bytes > max_inline then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Exact media folder_ref exceeds the request inline-value budget.", {
      blocker = "exact_folder_ref_exceeds_inline_budget",
      path_bytes = #path,
      folder_ref_bytes = ref_bytes,
      max_inline_value_bytes = max_inline,
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
    })
  end
  return path
end

function READ_B_MEDIA.encoded_bytes(value)
  if type(json) == "table" and type(json.encode) == "function" then
    return #json.encode(value)
  end
  -- Conservative fallback when json is not bound (unit harness without kernel).
  if type(value) == "string" then
    -- Worst-case JSON escaping for control/quote/backslash characters.
    return (#value * MEDIA_IDENTITY_JSON_ESCAPE_FACTOR) + 2
  end
  if type(value) == "number" or type(value) == "boolean" then
    return #tostring(value)
  end
  if type(value) ~= "table" then
    return 4
  end
  local total = 2
  if is_json_array(value) then
    for index = 1, #value do
      if index > 1 then
        total = total + 1
      end
      total = total + READ_B_MEDIA.encoded_bytes(value[index])
    end
    return total
  end
  local first = true
  for key, nested in pairs(value) do
    if type(key) == "string" and nested ~= nil then
      if not first then
        total = total + 1
      end
      first = false
      total = total + #key + 3 + READ_B_MEDIA.encoded_bytes(nested)
    end
  end
  return total
end

-- Mirror product bridge_ok_envelope request-echoed fields so preflight/list paging
-- prove the complete serialized success envelope, not summary-only bytes.
function READ_B_MEDIA.success_envelope_prototype(request, summary, refs, options)
  options = options or {}
  local budget = safe_budget(request)
  local undo = is_object(request and request.undo) and request.undo or {}
  local verification = is_object(request and request.verification) and request.verification or {}
  local opened = options.undo_opened == true
  local closed = options.undo_closed == true
  if options.undo_opened == nil and is_object(request.pack) and request.pack.risk == "write" then
    opened = true
    closed = true
  end
  local completed_at = "2026-07-20T00:00:00.000Z"
  local started_at = options.started_at or completed_at
  return {
    contract = (type(CONTRACT) == "string" and CONTRACT) or "foundation.bridge.v1",
    id = request and request.id or "cmd_invalid",
    ok = true,
    completed_at = completed_at,
    bridge = {
      owner = (type(ACTIVE_OWNER) == "string" and ACTIVE_OWNER) or "openreaper-live-smoke",
      generation = (type(ACTIVE_GENERATION) == "number" and ACTIVE_GENERATION) or 1,
    },
    queue = {
      state = "done",
      started_at = started_at,
      completed_at = completed_at,
    },
    result = {
      summary = is_object(summary) and summary or {},
      refs = refs or json_array({}),
      artifacts = json_array({}),
      jobs = json_array({}),
      last_result = {
        updated = false,
        refs = json_array({}),
        truncated = false,
      },
    },
    undo = {
      mode = is_string(undo.mode) and undo.mode or "none",
      opened = opened,
      closed = closed,
      label = is_string(undo.label) and undo.label or JSON_NULL,
    },
    verification = {
      mode = is_string(verification.mode) and verification.mode or "none",
      status = options.verification_status or "passed",
      checks = is_json_array(verification.checks) and verification.checks or json_array({}),
    },
    budget = {
      max_response_bytes = budget.max_response_bytes,
      response_bytes = 0,
      truncated = false,
    },
    idempotency = {
      key = is_string(request and request.idempotency_key) and request.idempotency_key or JSON_NULL,
      replayed = false,
    },
  }
end

function READ_B_MEDIA.success_envelope_bytes(request, summary, refs, options)
  local envelope = READ_B_MEDIA.success_envelope_prototype(request, summary, refs, options)
  if type(json) == "table" and type(json.encode) == "function" then
    local last_length = -1
    local encoded = nil
    for _ = 1, 8 do
      envelope.budget.response_bytes = math.max(last_length, 0)
      encoded = json.encode(envelope)
      local length = #encoded
      if length == last_length then
        return length, encoded
      end
      last_length = length
    end
    envelope.budget.response_bytes = #json.encode(envelope)
    encoded = json.encode(envelope)
    return #encoded, encoded
  end
  local summary_bytes = READ_B_MEDIA.encoded_bytes(summary or {})
  local refs_bytes = READ_B_MEDIA.encoded_bytes(refs or json_array({}))
  local echo_bytes = 0
  local undo = is_object(request and request.undo) and request.undo or {}
  if is_string(undo.label) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(undo.label) + 24
  end
  if is_string(undo.mode) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(undo.mode) + 16
  end
  local verification = is_object(request and request.verification) and request.verification or {}
  if is_string(verification.mode) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(verification.mode) + 16
  end
  if is_json_array(verification.checks) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(verification.checks) + 24
  end
  if is_string(request and request.idempotency_key) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(request.idempotency_key) + 24
  end
  if is_string(request and request.id) then
    echo_bytes = echo_bytes + READ_B_MEDIA.encoded_bytes(request.id) + 12
  end
  return MEDIA_SUCCESS_ENVELOPE_SHELL_MAX_BYTES + summary_bytes + refs_bytes + echo_bytes, nil
end

function READ_B_MEDIA.complete_success_envelope_fits(request, summary, refs, options)
  local budget = safe_budget(request)
  local required_bytes = READ_B_MEDIA.success_envelope_bytes(request, summary, refs, options)
  if required_bytes > budget.max_response_bytes then
    return false, required_bytes, budget
  end
  return true, required_bytes, budget
end

function READ_B_MEDIA.file_ref_bytes(path_value)
  if type(path_value) ~= "string" then
    return -1
  end
  return MEDIA_FILE_REF_PREFIX_BYTES + #path_value
end

function READ_B_MEDIA.inline_budget_allows_file_ref(request, path_value)
  local budget = safe_budget(request)
  local max_inline = math.floor(tonumber(budget.max_inline_value_bytes) or 0)
  local ref_bytes = READ_B_MEDIA.file_ref_bytes(path_value)
  if max_inline < 1 or ref_bytes < 1 or ref_bytes > max_inline then
    return false, ref_bytes, max_inline
  end
  return true, ref_bytes, max_inline
end

function READ_B_MEDIA.ensure_identity_inline_budget(request, path_value)
  local path, reason = READ_B_MEDIA.canonical_path(path_value)
  if not path then
    return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Media path is invalid for canonical absolute file identity.", {
      blocker = reason or "invalid_path",
      path = READ_B_MEDIA.display_path(path_value, MEDIA_DISPLAY_PATH_MAX_BYTES),
      path_bytes = type(path_value) == "string" and #path_value or -1,
    })
  end
  local ok_inline, ref_bytes, max_inline = READ_B_MEDIA.inline_budget_allows_file_ref(request, path)
  if not ok_inline then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Exact media file_ref exceeds the request inline-value budget.", {
      blocker = "exact_file_ref_exceeds_inline_budget",
      path_bytes = #path,
      file_ref_bytes = ref_bytes,
      max_inline_value_bytes = max_inline,
      file_ref_prefix_bytes = MEDIA_FILE_REF_PREFIX_BYTES,
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
    })
  end
  return path
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
  return ok and first_string(filename) or ""
end

function READ_B_MEDIA.source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

function READ_B_MEDIA.basename_for_path(path_value)
  local path = READ_B_MEDIA.canonical_path(path_value)
  if not path then
    return nil
  end
  local windows_path = path:match("^%a:[/\\]") or path:match("^\\\\") or path:match("^//")
  local last_separator = 0
  for index = 1, #path do
    local byte = string.byte(path, index)
    if byte == 47 or (windows_path and byte == 92) then
      last_separator = index
    end
  end
  local basename = path:sub(last_separator + 1)
  if basename == "" or basename == "." or basename == ".." then
    return nil
  end
  return basename
end

function READ_B_MEDIA.source_identity(source, options)
  options = options or {}
  if not source then
    return nil, {
      blocker = "source_pointer_missing",
    }
  end
  local ok_filename, filename = call_reaper("GetMediaSourceFileName", source, "")
  local raw_filename = ok_filename and first_string(filename) or nil
  local path = raw_filename and READ_B_MEDIA.canonical_path(raw_filename) or nil
  local ok_type, source_type_value = call_reaper("GetMediaSourceType", source, "")
  local source_type = ok_type and first_string(source_type_value) or nil
  local ok_length, source_length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  local length = ok_length and first_number(source_length) or nil
  local valid_length = type(length) == "number" and length == length
    and length ~= math.huge and length ~= -math.huge
    and (length > 0 or (options.allow_zero_length == true and length == 0))
    and length_is_quarter_notes ~= true
  local basename = path and READ_B_MEDIA.basename_for_path(path) or nil
  if not path or not source_type or source_type == "" or not valid_length or not basename then
    return nil, {
      blocker = "source_readback_incomplete",
      filename_call_ok = ok_filename == true,
      source_type_call_ok = ok_type == true,
      source_length_call_ok = ok_length == true,
      path = READ_B_MEDIA.display_path(raw_filename, MEDIA_DISPLAY_PATH_MAX_BYTES),
      source_type = source_type or "",
      source_length = length or JSON_NULL,
      length_is_quarter_notes = length_is_quarter_notes == true,
    }
  end
  return {
    source = source,
    path = path,
    file_ref = READ_B_MEDIA.file_ref_for_path(path),
    source_type = source_type,
    source_length_seconds = length,
    length_is_quarter_notes = false,
    take_name = basename,
  }
end

function READ_B_MEDIA.refresh_item(item, refresh_arrange)
  if not item then
    return false, "item_missing"
  end
  local ok_update = call_reaper("UpdateItemInProject", item)
  if not ok_update then
    return false, "item_update_failed"
  end
  if refresh_arrange ~= false then
    local ok_arrange = call_reaper("UpdateArrange")
    if not ok_arrange then
      return false, "arrange_refresh_failed"
    end
  end
  return true
end

function READ_B_MEDIA.attach_take_source(take, source, options)
  options = options or {}
  if not take or not source then
    return READ_B_MEDIA.handler_error("COMMAND_FAILED", "Media source attachment requires both a Take and a source pointer.", {
      blocker = "source_attach_arguments_missing",
      source_attached = false,
      source_ownership_unknown = false,
    }, false)
  end
  local ok_set, setter_result = call_reaper("SetMediaItemTake_Source", take, source)
  local ok_read, assigned_source = call_reaper("GetMediaItemTake_Source", take)
  local source_attached = ok_read and assigned_source == source
  local source_ownership_unknown = not ok_read
  local setter_accepted = setter_result == nil or setter_result == true
  local details = {
    source_attached = source_attached,
    source_ownership_unknown = source_ownership_unknown,
  }
  if not ok_set or not setter_accepted or not source_attached then
    details.blocker = "native_source_attach_failed"
    return READ_B_MEDIA.handler_error("COMMAND_FAILED", "REAPER did not prove the requested source was attached to the Take.", details, false)
  end

  local identity, identity_failure = READ_B_MEDIA.source_identity(assigned_source, {
    allow_zero_length = options.allow_zero_length == true,
  })
  if not identity then
    details.blocker = identity_failure and identity_failure.blocker or "source_readback_incomplete"
    details.source_readback = identity_failure or JSON_NULL
    return READ_B_MEDIA.handler_error("VERIFY_FAILED", "Attached media source identity could not be read back completely.", details, false)
  end

  local take_name = options.take_name or identity.take_name
  if type(take_name) ~= "string" or take_name == "" or take_name:find("\0", 1, true)
      or #take_name > MEDIA_TAKE_NAME_MAX_BYTES then
    details.blocker = "take_name_invalid"
    details.take_name = type(take_name) == "string" and READ_B_MEDIA.display_path(take_name, MEDIA_TAKE_NAME_MAX_BYTES) or JSON_NULL
    return READ_B_MEDIA.handler_error("VERIFY_FAILED", "Media source basename could not be used as a bounded Take name.", details, false)
  end
  local ok_name_set, name_set_result = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", take_name, true)
  local name_set_accepted = name_set_result == nil or name_set_result == true
  local ok_name_read, _, actual_name = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", "", false)
  actual_name = first_string(actual_name)
  if not ok_name_set or not name_set_accepted or not ok_name_read or actual_name ~= take_name then
    details.blocker = "take_name_readback_failed"
    details.requested_take_name = take_name
    details.actual_take_name = actual_name or JSON_NULL
    return READ_B_MEDIA.handler_error("VERIFY_FAILED", "Media Take name write/readback did not match the source basename.", details, false)
  end
  identity.take_name = actual_name

  if options.update_item ~= false then
    local item = options.item
    if not item then
      local ok_item, resolved_item = call_reaper("GetMediaItemTake_Item", take)
      item = ok_item and resolved_item or nil
    end
    local refreshed, refresh_reason = READ_B_MEDIA.refresh_item(item, options.refresh_arrange)
    if not refreshed then
      details.blocker = refresh_reason or "item_refresh_failed"
      return READ_B_MEDIA.handler_error("COMMAND_FAILED", "Attached media Take could not be refreshed in the project.", details, false)
    end
  end
  identity.take = take
  identity.source_attached = true
  return identity
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
  local path = READ_B_MEDIA.canonical_path(path_value)
  if not path then
    return nil
  end
  return MEDIA_FILE_REF_PREFIX .. path
end

function READ_B_MEDIA.file_object_ref(path_value)
  local path = READ_B_MEDIA.canonical_path(path_value)
  if not path then
    return nil
  end
  return {
    kind = "file",
    ref = MEDIA_FILE_REF_PREFIX .. path,
    identity = {
      scheme = "path",
      value = path,
    },
  }
end

function READ_B_MEDIA.ensure_read_identity_budget(request, path_value, path_field_count)
  local path, budget_error = READ_B_MEDIA.ensure_identity_inline_budget(request, path_value)
  if not path then
    return nil, budget_error
  end
  local occurrences = math.max(1, math.floor(tonumber(path_field_count) or 1))
  local budget = safe_budget(request)
  local required_response_bytes = MEDIA_READ_SUCCESS_ENVELOPE_FIXED_MAX_BYTES
    + occurrences * ((READ_B_MEDIA.file_ref_bytes(path) * MEDIA_IDENTITY_JSON_ESCAPE_FACTOR) + MEDIA_IDENTITY_JSON_FIELD_OVERHEAD_BYTES)
  if budget.max_response_bytes < required_response_bytes then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Conservative complete success-envelope budget proof failed for media identity read.", {
      blocker = "success_envelope_budget_insufficient",
      required_response_bytes = required_response_bytes,
      max_response_bytes = budget.max_response_bytes,
      fixed_max_overhead_bytes = MEDIA_READ_SUCCESS_ENVELOPE_FIXED_MAX_BYTES,
      json_escape_factor = MEDIA_IDENTITY_JSON_ESCAPE_FACTOR,
      path_field_count = occurrences,
      file_ref_bytes = READ_B_MEDIA.file_ref_bytes(path),
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
    })
  end
  return path
end

-- Proven upper bound for native item/take/track GUID identity values echoed on
-- mutation success: max JSON string *content* bytes after escaping (not raw).
-- Plain "G" needs no escape, so max-G prototype content length equals this bound.
-- Public refs use native GUID only when escaped content fits; otherwise truthful
-- enumerated index (never fabricate GUID or index 0 without enumeration proof).
local MEDIA_MUTATION_GUID_MAX_BYTES = 240
-- e3_media_kind_for_path returns only audio|midi|video|unknown; use longest.
local MEDIA_MUTATION_SOURCE_TYPE_MAX = "unknown"
local MEDIA_MUTATION_SOURCE_TYPE_MAX_BYTES = #MEDIA_MUTATION_SOURCE_TYPE_MAX

function READ_B_MEDIA.mutation_guid_max_bytes()
  return MEDIA_MUTATION_GUID_MAX_BYTES
end

function READ_B_MEDIA.mutation_max_guid_value()
  return string.rep("G", MEDIA_MUTATION_GUID_MAX_BYTES)
end

function READ_B_MEDIA.json_string_content_bytes(value)
  if type(value) ~= "string" then
    return -1
  end
  if type(json) == "table" and type(json.encode) == "function" then
    local encoded = json.encode(value)
    if type(encoded) == "string" and #encoded >= 2 and encoded:sub(1, 1) == '"' and encoded:sub(-1) == '"' then
      return #encoded - 2
    end
    return #encoded
  end
  -- Product-faithful JSON string content cost without a bound kernel json table.
  local total = 0
  for index = 1, #value do
    local byte = string.byte(value, index)
    if byte == 34 or byte == 92 then
      total = total + 2
    elseif byte < 32 then
      if byte == 8 or byte == 9 or byte == 10 or byte == 12 or byte == 13 then
        total = total + 2
      else
        total = total + 6
      end
    else
      total = total + 1
    end
  end
  return total
end

function READ_B_MEDIA.mutation_success_summary_prototype(request, path_value, options)
  options = options or {}
  local capability = is_object(request.pack) and request.pack.capability or "media.import_file_to_track"
  local file_ref = MEDIA_FILE_REF_PREFIX .. path_value
  local max_guid = options.guid_value
  if type(max_guid) ~= "string" or max_guid == "" then
    max_guid = READ_B_MEDIA.mutation_max_guid_value()
  end
  if #max_guid > MEDIA_MUTATION_GUID_MAX_BYTES then
    max_guid = max_guid:sub(1, MEDIA_MUTATION_GUID_MAX_BYTES)
  end
  local source_type = options.source_type
  if type(source_type) ~= "string" or source_type == "" then
    source_type = MEDIA_MUTATION_SOURCE_TYPE_MAX
  end
  if #source_type > MEDIA_MUTATION_SOURCE_TYPE_MAX_BYTES then
    source_type = source_type:sub(1, MEDIA_MUTATION_SOURCE_TYPE_MAX_BYTES)
  end
  -- Prefer the longer of provided vs proven max so the prototype remains an upper bound.
  if #source_type < MEDIA_MUTATION_SOURCE_TYPE_MAX_BYTES then
    source_type = MEDIA_MUTATION_SOURCE_TYPE_MAX
  end
  local summary = {
    capability = capability,
    pack = is_object(request.pack) and request.pack.id or "media",
    risk = is_object(request.pack) and request.pack.risk or "write",
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
    -- These fields are returned by native source attach/readback. Keep the
    -- budget prototype wider than any finite JSON number and bounded Take name.
    source_type = string.rep("W", 80),
    source_length_seconds = string.rep("9", MEDIA_SOURCE_LENGTH_MAX_DIGITS),
    take_name = string.rep("W", MEDIA_TAKE_NAME_MAX_BYTES),
  }
  if capability == "media.relink_take_source" then
    summary.take_ref = "take:guid:" .. max_guid
    summary.source_file_ref = file_ref
    summary.source_type = source_type
    summary.relinked = true
  else
    summary.imported_item_refs = json_array({ "item:guid:" .. max_guid })
    summary.item_count = 1
    summary.source_file_ref = file_ref
    summary.track_ref = "track:guid:" .. max_guid
    summary.position_seconds = type(request.params and request.params.position_seconds) == "number" and request.params.position_seconds or 0
    summary.selection_restored = request.params and request.params.preserve_selection == true
    if capability == "media.import_file_section_to_track" then
      summary.start_percent = type(request.params and request.params.start_percent) == "number" and request.params.start_percent or 0
      summary.end_percent = type(request.params and request.params.end_percent) == "number" and request.params.end_percent or 1
    end
  end
  local refs = json_array({
    {
      kind = capability == "media.relink_take_source" and "take" or "item",
      ref = capability == "media.relink_take_source" and summary.take_ref or summary.imported_item_refs[1],
      identity = {
        scheme = "guid",
        value = max_guid,
      },
    },
    {
      kind = "file",
      ref = file_ref,
      identity = {
        scheme = "path",
        value = path_value,
      },
    },
  })
  return summary, refs
end

function READ_B_MEDIA.identity_value_within_mutation_bound(value)
  if type(value) ~= "string" or value == "" then
    return false, "empty_identity"
  end
  local escaped_bytes = READ_B_MEDIA.json_string_content_bytes(value)
  if escaped_bytes < 0 or escaped_bytes > MEDIA_MUTATION_GUID_MAX_BYTES then
    return false, "identity_exceeds_mutation_bound"
  end
  return true
end

function READ_B_MEDIA.ensure_mutation_path_budget(request, path_value)
  local path, budget_error = READ_B_MEDIA.ensure_identity_inline_budget(request, path_value)
  if not path then
    return nil, budget_error
  end
  if #path > MEDIA_FILE_PATH_MAX_BYTES then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Exact media path exceeds the supported mutation path ceiling; mutation was not attempted.", {
      blocker = "path_exceeds_mutation_ceiling",
      path_bytes = #path,
      max_path_bytes = MEDIA_FILE_PATH_MAX_BYTES,
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
    })
  end
  -- Upper-bound prototype: max GUID identity lengths + longest source_type ("unknown").
  local summary, refs = READ_B_MEDIA.mutation_success_summary_prototype(request, path, {
    guid_value = READ_B_MEDIA.mutation_max_guid_value(),
    source_type = MEDIA_MUTATION_SOURCE_TYPE_MAX,
  })
  local fits, required_response_bytes, budget = READ_B_MEDIA.complete_success_envelope_fits(request, summary, refs, {
    undo_opened = true,
    undo_closed = true,
    verification_status = "passed",
  })
  if not fits then
    return READ_B_MEDIA.handler_error("RESPONSE_TOO_LARGE", "Complete success-envelope budget proof failed; mutation was not attempted.", {
      blocker = "success_envelope_budget_insufficient",
      required_response_bytes = required_response_bytes,
      max_response_bytes = budget.max_response_bytes,
      path_field_count = MEDIA_MUTATION_PATH_OCCURRENCES,
      file_ref_bytes = READ_B_MEDIA.file_ref_bytes(path),
      path_bytes = #path,
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
      proof = "complete_success_envelope_upper_bound",
      guid_max_bytes = MEDIA_MUTATION_GUID_MAX_BYTES,
      source_type_max = MEDIA_MUTATION_SOURCE_TYPE_MAX,
    })
  end
  return path
end

-- Pure preflight for write media routes. Must run before open_required_undo_block.
-- Uses no EnumProjects / Undo_* / mutation REAPER APIs; only request truth + budgets.
function READ_B_MEDIA.file_path_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "file" then
    return nil, nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  local path_from_identity = nil
  if identity.scheme == "path" and type(identity.value) == "string" then
    path_from_identity = identity.value
  end
  local path_from_ref = nil
  if is_string(ref.ref) then
    path_from_ref = ref.ref:match("^file:path:(.+)$")
  end
  if path_from_identity and path_from_ref and path_from_identity ~= path_from_ref then
    return nil, "contradictory_file_ref"
  end
  local path_value = path_from_identity or path_from_ref
  if not path_value then
    return nil, "invalid_file_ref"
  end
  local path, reason = READ_B_MEDIA.canonical_path(path_value)
  if not path then
    return nil, reason or "invalid_file_ref"
  end
  if path_from_identity and path_from_identity ~= path then
    return nil, "contradictory_file_ref"
  end
  if path_from_ref and path_from_ref ~= path then
    return nil, "contradictory_file_ref"
  end
  return path
end

function READ_B_MEDIA.file_path_from_request_refs_strict(request)
  if not is_json_array(request.refs) then
    return nil, "missing_file_ref"
  end
  local found = nil
  local saw_file = false
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "file" then
      saw_file = true
      local path_value, reason = READ_B_MEDIA.file_path_from_ref_object(ref)
      if reason or not path_value then
        return nil, reason or "invalid_file_ref"
      end
      if found and found ~= path_value then
        return nil, "contradictory_file_ref"
      end
      found = path_value
    end
  end
  if not saw_file or not found then
    return nil, "missing_file_ref"
  end
  return found
end

function READ_B_MEDIA.preflight_mutation_write(request)
  local capability = is_object(request.pack) and request.pack.capability or nil
  if capability ~= "media.import_file_to_track"
      and capability ~= "media.import_file_section_to_track"
      and capability ~= "media.relink_take_source" then
    return true
  end
  local path_value, path_reason = READ_B_MEDIA.file_path_from_request_refs_strict(request)
  if not path_value then
    local code = "FILE_NOT_FOUND"
    local message = "E3 media write requires a resolvable absolute source file ref."
    if path_reason == "contradictory_file_ref" then
      code = "PARAMS_INVALID"
      message = "E3 media write rejected contradictory file ref identity."
    elseif path_reason == "relative_path" or path_reason == "empty_path" or path_reason == "nul_char" then
      code = "PARAMS_INVALID"
      message = "E3 media write requires a valid absolute source file path."
    end
    return false, {
      code = code,
      message = message,
      recoverable = true,
      details = {
        blocker = path_reason or "invalid_file_ref",
        zero_write = true,
      },
    }
  end
  if capability == "media.import_file_section_to_track" then
    local start_value = request.params and request.params.start_percent
    local end_value = request.params and request.params.end_percent
    if type(start_value) == "number" or type(end_value) == "number" then
      local start_number = type(start_value) == "number" and start_value or 0
      local end_number = type(end_value) == "number" and end_value or 1
      if start_number < 0 or end_number > 1 or end_number <= start_number then
        return false, {
          code = "PARAMS_INVALID",
          message = "E3 media section import requires 0 <= start_percent < end_percent <= 1.",
          recoverable = true,
          details = {
            start_percent = start_value,
            end_percent = end_value,
            zero_write = true,
          },
        }
      end
    end
  end
  -- Oversized native GUIDs fall back to truthful index refs in success identity;
  -- preflight proves max-GUID upper bound which dominates index refs.
  local path, budget_error = READ_B_MEDIA.ensure_mutation_path_budget(request, path_value)
  if not path then
    if is_object(budget_error) then
      budget_error.details = budget_error.details or {}
      budget_error.details.zero_write = true
    end
    return false, budget_error
  end

  -- Clear any prior target proof; only a full successful preflight may open Undo.
  request.__openreaper_media_target = nil

  if capability == "media.import_file_to_track" or capability == "media.import_file_section_to_track" then
    local track = READ_B_MEDIA.resolve_track_for_request(request)
    if not track then
      return false, {
        code = "TRACK_NOT_FOUND",
        message = "E3 media import requires a resolvable target track ref.",
        recoverable = true,
        details = { blocker = "track_not_found", zero_write = true },
      }
    end
    local track_ref = READ_B_MEDIA.track_ref_string(track)
    if not track_ref then
      return false, {
        code = "TRACK_NOT_FOUND",
        message = "E3 media import could not prove a truthful track identity before mutation.",
        recoverable = true,
        details = { blocker = "track_identity_unavailable", zero_write = true },
      }
    end
    request.__openreaper_media_target = {
      capability = capability,
      path = path,
      track = track,
      track_ref = track_ref,
    }
  elseif capability == "media.relink_take_source" then
    local take = READ_B_MEDIA.resolve_take_for_request(request)
    if not take then
      return false, {
        code = "TAKE_NOT_FOUND",
        message = "E3 media relink requires a resolvable take ref.",
        recoverable = true,
        details = { blocker = "take_not_found", zero_write = true },
      }
    end
    local take_ref = READ_B_MEDIA.take_ref_string(take)
    if not take_ref then
      return false, {
        code = "TAKE_NOT_FOUND",
        message = "E3 media relink could not prove a truthful take identity before mutation.",
        recoverable = true,
        details = {
          blocker = "take_identity_unavailable",
          zero_write = true,
        },
      }
    end
    request.__openreaper_media_target = {
      capability = capability,
      path = path,
      take = take,
      take_ref = take_ref,
    }
  end
  return true, path
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
  if type(guid) == "string" and guid ~= "" and READ_B_MEDIA.identity_value_within_mutation_bound(guid) then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  if not ok_count then
    return nil
  end
  local total_items = first_number(item_count) or 0
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
  return nil
end

function READ_B_MEDIA.track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

function READ_B_MEDIA.track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  if not ok_count then
    return nil
  end
  local total = first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, candidate = call_reaper("GetTrack", 0, index)
    if ok_track and candidate == track then
      return index
    end
  end
  return nil
end

function READ_B_MEDIA.track_ref_string(track)
  local guid = READ_B_MEDIA.track_guid(track)
  if type(guid) == "string" and guid ~= "" and READ_B_MEDIA.identity_value_within_mutation_bound(guid) then
    return "track:guid:" .. guid
  end
  local index = READ_B_MEDIA.track_index(track)
  if index == nil then
    return nil
  end
  return "track:index:" .. tostring(index)
end

function READ_B_MEDIA.find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and READ_B_MEDIA.track_guid(track) == guid then
      return track
    end
  end
  return nil
end

function READ_B_MEDIA.resolve_track_token(token)
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
    return READ_B_MEDIA.find_track_by_guid(guid)
  end
  return nil
end

function READ_B_MEDIA.resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return READ_B_MEDIA.resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return READ_B_MEDIA.resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return READ_B_MEDIA.resolve_track_token("guid:" .. tostring(identity.value))
  end
  return READ_B_MEDIA.resolve_track_token(ref.ref)
end

function READ_B_MEDIA.resolve_track_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = READ_B_MEDIA.resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
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
  local path, budget_error = READ_B_MEDIA.ensure_read_identity_budget(request, path_value, 1)
  if not path then
    return nil, budget_error
  end
  if not file_exists(path) then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file does not exist.", {
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
      file_ref = READ_B_MEDIA.file_ref_for_path(path),
    })
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path)
  if not ok_source or not source then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file could not be decoded as a REAPER source.", {
      path = READ_B_MEDIA.display_path(path, MEDIA_DISPLAY_PATH_MAX_BYTES),
      file_ref = READ_B_MEDIA.file_ref_for_path(path),
    })
  end
  local length, length_is_quarter_notes = READ_B_MEDIA.source_length(source)
  local summary = {
    file_ref = READ_B_MEDIA.file_ref_for_path(path),
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
