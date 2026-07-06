-- Extracted D29 handler: render output policy, codec intent, and managed render jobs.

local D29_RENDER_SETTING_KEYS = {
  format = "format",
  ogg_quality = "ogg_quality",
  mp3_bitrate_kbps = "mp3_bitrate_kbps",
  flac_compression = "flac_compression",
  aiff_bit_depth = "aiff_bit_depth",
}

local D29_RENDER_OUTPUT_SPEC = {
  template_id = "template.render.render_item",
  owner_pack = "render",
  scope = "managed_output",
  schema = "render.managed_output.v1",
}

local D29_RENDER_EVIDENCE_SPEC = {
  template_id = "template.render.render_item",
  owner_pack = "render",
  scope = "render_job_evidence",
  schema = "render.render_job_evidence.v1",
}

local function d29_render_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d29_render_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d29_render_file_size(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return 0
  end
  local size = handle:seek("end") or 0
  handle:close()
  return size
end

local function d29_render_parent_directory(path_value)
  return tostring(path_value or ""):match("^(.*)[/\\][^/\\]*$") or ""
end

local function d29_render_extension(path_value)
  return tostring(path_value or ""):match("%.([A-Za-z0-9]+)$") or ""
end

local function d29_render_wav_header(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return {
      present = false,
      riff = false,
      wave = false,
    }
  end
  local header = handle:read(12) or ""
  handle:close()
  return {
    present = #header >= 12,
    riff = header:sub(1, 4) == "RIFF",
    wave = header:sub(9, 12) == "WAVE",
  }
end

local function d29_render_root_ready()
  if not RENDER_ROOT then
    return false, "render_root_not_configured", "D29 render output root is not configured."
  end
  if RENDER_ROOT:sub(1, 7) == "file://" or not is_absolute_path(RENDER_ROOT) then
    return false, "render_root_invalid", "D29 render output root must be an absolute filesystem path."
  end
  return true
end

local function d29_render_safe_suffix(value)
  local text = tostring(value or ""):gsub("^template:", ""):gsub("[^A-Za-z0-9_%-]", "_")
  if text == "" then
    text = "unknown"
  end
  if #text > 48 then
    text = text:sub(1, 48)
  end
  return text
end

local function d29_render_format(request, fallback)
  local value = request.params and request.params.format
  if not is_string(value) or value == "" then
    value = fallback or "wav"
  end
  value = value:lower()
  local allowed = {
    wav = true,
    ogg = true,
    mp3 = true,
    flac = true,
    aiff = true,
    m4a = true,
    opus = true,
  }
  if not allowed[value] then
    return nil
  end
  return value
end

local function d29_render_output_path(request, format)
  local suffix = d29_render_safe_suffix((request.idempotency_key or request.id) .. "_" .. tostring(format))
  local basename = "openreaper_d29_" .. suffix .. "." .. format
  return {
    basename = basename,
    relative_path = basename,
    path = path_join(RENDER_ROOT or "", basename),
  }
end

local function d29_render_item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and is_string(guid) and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and is_string(native_guid) and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function d29_render_item_ref(item)
  local guid = d29_render_item_guid(item)
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

local function d29_render_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d29_render_track_ref(track)
  local guid = d29_render_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  local index = ok_number and math.max(0, math.floor((first_number(number) or 1) - 1)) or 0
  return "track:index:" .. tostring(index)
end

local function d29_render_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function d29_render_take_number(take, key, fallback)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  return ok and first_number(value) or fallback or 0
end

local function d29_render_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d29_render_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d29_render_item_from_ref(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "item" and is_string(ref.ref) then
        local guid = ref.ref:match("^item:guid:(.+)$") or ref.ref:match("^guid:(.+)$")
        if guid then
          local item = d29_render_find_item_by_guid(guid)
          if item then
            return item
          end
        end
        local item_index = ref.ref:match("^item:index:(%d+)$") or ref.ref:match("^index:(%d+)$")
        if item_index then
          local ok_item, item = call_reaper("GetMediaItem", 0, tonumber(item_index))
          if ok_item and item then
            return item
          end
        end
      end
    end
  end
  return nil
end

local function d29_render_selected_item()
  local ok_item, item = call_reaper("GetSelectedMediaItem", 0, 0)
  return ok_item and item or nil
end

local function d29_render_first_item()
  local ok_item, item = call_reaper("GetMediaItem", 0, 0)
  return ok_item and item or nil
end

local function d29_render_track_from_ref(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "track" and is_string(ref.ref) then
        local track_index = ref.ref:match("^track:index:(%d+)$") or ref.ref:match("^index:(%d+)$")
        if track_index then
          local ok_track, track = call_reaper("GetTrack", 0, tonumber(track_index))
          if ok_track and track then
            return track
          end
        end
      end
    end
  end
  return nil
end

local function d29_render_first_item_on_track(track)
  if not track then
    return nil
  end
  local ok_count, count = call_reaper("CountTrackMediaItems", track)
  local total = ok_count and first_number(count) or 0
  if total <= 0 then
    return nil
  end
  local ok_item, item = call_reaper("GetTrackMediaItem", track, 0)
  return ok_item and item or nil
end

local function d29_render_source_for_item(item)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D29 render job requires a resolvable audio item.",
      details = {
        blocker = "item_ref_missing",
      },
    }
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D29 render job requires an item with an active take.",
      details = {
        item_ref = d29_render_item_ref(item),
        blocker = "active_take_missing",
      },
    }
  end
  local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
  if ok_midi and is_midi == true then
    return nil, {
      code = "PARAMS_INVALID",
      message = "D29 managed render jobs require an audio take in this bounded route.",
      details = {
        item_ref = d29_render_item_ref(item),
        blocker = "midi_take_not_supported",
      },
    }
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D29 managed render job could not read the active take source.",
      details = {
        item_ref = d29_render_item_ref(item),
        blocker = "take_source_missing",
      },
    }
  end
  local ok_filename, filename = call_reaper("GetMediaSourceFileName", source, "")
  filename = ok_filename and first_string(filename) or ""
  if filename == "" or not file_exists(filename) then
    return nil, {
      code = "FILE_NOT_FOUND",
      message = "D29 managed render job source file is missing or offline.",
      details = {
        item_ref = d29_render_item_ref(item),
        source_filename_present = filename ~= "",
        source_file_exists = filename ~= "" and file_exists(filename) or false,
        blocker = "source_file_missing_or_offline",
      },
    }
  end
  local item_start = d29_render_item_number(item, "D_POSITION")
  local item_length = d29_render_item_number(item, "D_LENGTH")
  local take_offset = d29_render_take_number(take, "D_STARTOFFS", 0)
  local playrate = d29_render_take_number(take, "D_PLAYRATE", 1)
  local ok_length, source_length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  local length = ok_length and first_number(source_length) or 0
  if length_is_quarter_notes == true or length <= 0 or playrate <= 0 or item_length <= 0 then
    return nil, {
      code = "PARAMS_INVALID",
      message = "D29 managed render job could not derive a bounded source range.",
      details = {
        item_ref = d29_render_item_ref(item),
        blocker = "source_range_invalid",
      },
    }
  end
  local source_start = math.max(0, math.min(length, take_offset))
  local source_end = math.max(0, math.min(length, take_offset + item_length * playrate))
  if source_end <= source_start then
    return nil, {
      code = "PARAMS_INVALID",
      message = "D29 managed render job source range is empty.",
      details = {
        item_ref = d29_render_item_ref(item),
        blocker = "source_range_empty",
      },
    }
  end
  return {
    item_ref = d29_render_item_ref(item),
    filename = filename,
    source_length_seconds = length,
    source_start_seconds = source_start,
    source_end_seconds = source_end,
    item_start_seconds = item_start,
    item_length_seconds = item_length,
    playrate = playrate,
  }
end

local function d29_render_pick_item(request, mode)
  if mode == "selected_item" then
    return d29_render_selected_item()
  end
  if mode == "track_item" then
    return d29_render_item_from_ref(request) or d29_render_first_item_on_track(d29_render_track_from_ref(request))
  end
  if mode == "selected_tracks" then
    local ok_track, track = call_reaper("GetSelectedTrack", 0, 0)
    return d29_render_first_item_on_track(ok_track and track or nil)
  end
  return d29_render_item_from_ref(request) or d29_render_selected_item() or d29_render_first_item()
end

local function d29_render_job_ref(job_id, template_id)
  return {
    kind = "job",
    ref = "job:job_id:" .. job_id,
    identity = {
      scheme = "job_id",
      value = job_id,
    },
    summary = {
      template_id = template_id,
      pack = "render",
    },
  }
end

local function d29_render_managed_job(request, template_id, format_fallback, mode)
  local root_ok, blocker, root_message = d29_render_root_ready()
  if not root_ok then
    return d29_render_error("FILE_NOT_FOUND", root_message, {
      blocker = blocker,
      render_root_env = RENDER_ROOT_ENV,
    })
  end
  if request.params.output_policy ~= "openreaper_managed_render_root" then
    return d29_render_error("PARAMS_INVALID", "D29 render jobs require managed render root output policy.", {
      field = "output_policy",
    })
  end
  if request.params.collision_policy ~= "fail_if_exists" then
    return d29_render_error("IDEMPOTENCY_CONFLICT", "D29 render jobs currently support only fail_if_exists.", {
      blocker = "reuse_idempotent_match_not_enabled",
      collision_policy = bounded_string(request.params.collision_policy, 80),
    }, false)
  end
  local format = d29_render_format(request, format_fallback)
  if not format then
    return d29_render_error("PARAMS_INVALID", "D29 render job format is not supported by this route.", {
      format = request.params.format,
    })
  end
  local source, source_failure = d29_render_source_for_item(d29_render_pick_item(request, mode))
  if not source then
    return nil, source_failure
  end
  local output = d29_render_output_path(request, format)
  if file_exists(output.path) then
    return d29_render_error("IDEMPOTENCY_CONFLICT", "D29 managed render output already exists and fail_if_exists forbids overwrite.", {
      blocker = "render_output_exists",
      output_basename = output.basename,
    }, false)
  end
  local start_percent = math.max(0, math.min(1, source.source_start_seconds / source.source_length_seconds))
  local end_percent = math.max(0, math.min(1, source.source_end_seconds / source.source_length_seconds))
  local render_ok, render_success = call_reaper("RenderFileSection", source.filename, output.path, start_percent, end_percent, source.playrate)
  if not render_ok or render_success == false then
    return d29_render_error("COMMAND_FAILED", "D29 managed render job could not render the source section through REAPER.", {
      blocker = "render_file_section_failed",
      item_ref = source.item_ref,
      output_basename = output.basename,
      format = format,
    }, false)
  end
  local size = d29_render_file_size(output.path)
  if size <= 0 then
    return d29_render_error("VERIFY_FAILED", "D29 managed render output was empty or missing after render.", {
      blocker = "render_output_empty",
      output_basename = output.basename,
      file_size_bytes = size,
    }, false)
  end
  local output_spec = {
    template_id = template_id,
    owner_pack = D29_RENDER_OUTPUT_SPEC.owner_pack,
    scope = D29_RENDER_OUTPUT_SPEC.scope,
    schema = D29_RENDER_OUTPUT_SPEC.schema,
  }
  local evidence_spec = {
    template_id = template_id,
    owner_pack = D29_RENDER_EVIDENCE_SPEC.owner_pack,
    scope = D29_RENDER_EVIDENCE_SPEC.scope,
    schema = D29_RENDER_EVIDENCE_SPEC.schema,
  }
  local output_summary = {
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    absolute_path = output.path,
    parent_directory = d29_render_parent_directory(output.path),
    exists = file_exists(output.path),
    file_size_bytes = size,
    extension = d29_render_extension(output.path),
    file_count = 1,
    format = format,
    reused_existing = false,
    truncated = false,
  }
  local output_write, output_failure = write_a2_artifact(request, output_spec, output_summary, {
    output = output_summary,
    source = source,
  })
  if not output_write then
    return d29_render_error(output_failure.code, output_failure.message, output_failure.details, output_failure.recoverable)
  end
  local job_id = request.operation.name .. "." .. d29_render_safe_suffix(artifact_id_from_request(request) or request.id)
  local job_ref = d29_render_job_ref(job_id, template_id)
  local evidence_summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    format = format,
    verification_status = "passed",
    truncated = false,
  }
  local evidence_write, evidence_failure = write_a2_artifact(request, evidence_spec, evidence_summary, {
    output_artifact_ref = output_write.ref,
    output = output_summary,
    source = source,
    render_request = request.params,
  })
  if not evidence_write then
    return d29_render_error(evidence_failure.code, evidence_failure.message, evidence_failure.details, evidence_failure.recoverable)
  end
  local summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    evidence_artifact_ref = evidence_write.ref,
    format = format,
    output_policy = request.params.output_policy,
    collision_policy = request.params.collision_policy,
    file_count = 1,
    reused_existing = false,
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    truncated = false,
  }
  return summary, nil, json_array({ output_write.object_ref, evidence_write.object_ref }), json_array({ job_ref })
end

local function d29_render_set_ext_state(request, key, value)
  local project = d29_render_project()
  local ok_previous, previous_value = call_reaper("GetProjExtState", project, "OPENREAPER_RENDER", key)
  previous_value = ok_previous and first_string(previous_value) or ""
  local ok = call_reaper("SetProjExtState", project, "OPENREAPER_RENDER", key, tostring(value))
  if not ok then
    return d29_render_error("COMMAND_FAILED", "REAPER rejected OpenReaper render setting ext-state update.", {
      key = key,
    }, false)
  end
  local ok_read, readback = call_reaper("GetProjExtState", project, "OPENREAPER_RENDER", key)
  readback = ok_read and first_string(readback) or ""
  return {
    previous_value = previous_value,
    value = readback,
    changed = previous_value ~= readback,
    readback_matched = tostring(value) == readback,
  }
end

local function set_render_format(request)
  local format = d29_render_format(request, nil)
  if not format then
    return d29_render_error("PARAMS_INVALID", "Render format must be wav, ogg, mp3, flac, aiff, m4a, or opus.", {
      format = request.params.format,
    })
  end
  local update, failure = d29_render_set_ext_state(request, D29_RENDER_SETTING_KEYS.format, format)
  if not update then
    return nil, failure
  end
  return {
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = update.readback_matched and "passed" or "mismatch",
    undo_evidence = "required",
    artifacts_allowed = false,
    project_ref = "project:current",
    format = update.value,
    previous_format = update.previous_value,
    changed = update.changed,
    readback_matched = update.readback_matched,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({})
end

local function d29_render_set_numeric_setting(request, format, field, min_value, max_value)
  if request.params.format ~= format then
    return d29_render_error("PARAMS_INVALID", "Render codec setting format does not match the route.", {
      expected_format = format,
      format = request.params.format,
    })
  end
  local value = tonumber(request.params[field])
  if not value or value ~= value or value < min_value or value > max_value then
    return d29_render_error("PARAMS_INVALID", "Render codec setting value is outside the bounded descriptor range.", {
      field = field,
      value = request.params[field],
    })
  end
  local update, failure = d29_render_set_ext_state(request, D29_RENDER_SETTING_KEYS[field] or field, value)
  if not update then
    return nil, failure
  end
  return {
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = update.readback_matched and "passed" or "mismatch",
    undo_evidence = "required",
    artifacts_allowed = false,
    project_ref = "project:current",
    format = format,
    [field] = tonumber(update.value) or value,
    changed = update.changed,
    readback_matched = update.readback_matched,
    truncated = false,
  }, nil, json_array({}), json_array({}), json_array({})
end

local function set_ogg_quality_or_compression(request)
  return d29_render_set_numeric_setting(request, "ogg", "ogg_quality", 0, 1)
end

local function set_mp3_bitrate_or_quality(request)
  return d29_render_set_numeric_setting(request, "mp3", "mp3_bitrate_kbps", 128, 320)
end

local function set_flac_compression(request)
  return d29_render_set_numeric_setting(request, "flac", "flac_compression", 0, 8)
end

local function set_aiff_bit_depth(request)
  return d29_render_set_numeric_setting(request, "aiff", "aiff_bit_depth", 16, 32)
end

local function d29_render_artifact_ref(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "artifact" and is_string(ref.ref) then
        local parts = parse_artifact_ref(ref.ref)
        if parts and parts.owner_pack == "render" then
          return ref.ref, parts
        end
      end
    end
  end
  return nil, nil
end

local function d29_render_output_expected(parts)
  if not parts or parts.owner_pack ~= "render" then
    return nil
  end
  if parts.scope == "managed_output" then
    return D29_RENDER_OUTPUT_SPEC
  end
  if parts.scope == "region_wav_output" then
    return A2_ARTIFACT_SPECS.region_wav_output
  end
  return nil
end

local function d29_render_read_output_envelope(request)
  local ref, parts = d29_render_artifact_ref(request)
  local expected = d29_render_output_expected(parts)
  if not ref or not expected then
    return nil, d29_render_error("ARTIFACT_NOT_FOUND", "Render output metadata requires a render output artifact ref.", {
      blocker = "render_output_artifact_ref_missing",
    })
  end
  local envelope, failure = read_artifact_envelope(ref, expected)
  if not envelope then
    return nil, d29_render_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  return envelope, nil, ref
end

local function output_file_metadata(request)
  local envelope, failure, ref = d29_render_read_output_envelope(request)
  if not envelope then
    return nil, failure
  end
  local summary = is_object(envelope.summary) and envelope.summary or {}
  local absolute_path = is_string(summary.absolute_path) and summary.absolute_path or ""
  local exists = absolute_path ~= "" and file_exists(absolute_path)
  local wave_header = request.params.include_wave_header == true and d29_render_wav_header(absolute_path) or {}
  local file_ref = "file:render-output:" .. d29_render_safe_suffix(ref)
  local object_ref = {
    kind = "file",
    ref = file_ref,
    identity = {
      scheme = "render_output_artifact",
      value = ref,
    },
  }
  return {
    output_artifact_ref = ref,
    exists = exists,
    size_bytes = exists and d29_render_file_size(absolute_path) or 0,
    modified_at = "",
    extension = d29_render_extension(absolute_path),
    wave_header = wave_header,
    sidecars = json_array({}),
    truncated = false,
  }, nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
end

local function output_absolute_path(request)
  local envelope, failure, ref = d29_render_read_output_envelope(request)
  if not envelope then
    return nil, failure
  end
  local summary = is_object(envelope.summary) and envelope.summary or {}
  local absolute_path = is_string(summary.absolute_path) and summary.absolute_path or ""
  local exists = absolute_path ~= "" and file_exists(absolute_path)
  if request.params.require_exists == true and not exists then
    return d29_render_error("FILE_NOT_FOUND", "Render output artifact absolute path does not exist.", {
      output_artifact_ref = ref,
      blocker = "render_output_file_missing",
    })
  end
  local file_ref = "file:render-output:" .. d29_render_safe_suffix(ref)
  local object_ref = {
    kind = "file",
    ref = file_ref,
    identity = {
      scheme = "render_output_artifact",
      value = ref,
    },
  }
  return {
    output_artifact_ref = ref,
    absolute_path = absolute_path,
    parent_directory = request.params.include_parent_directory == true and d29_render_parent_directory(absolute_path) or "",
    exists = exists,
    managed_root = RENDER_ROOT or "",
    truncated = false,
  }, nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
end

local function render_item(request)
  return d29_render_managed_job(request, "template.render.render_item", "wav", "item")
end

local function render_selected_item(request)
  return d29_render_managed_job(request, "template.render.render_selected_item", "wav", "selected_item")
end

local function render_track_item(request)
  return d29_render_managed_job(request, "template.render.render_track_item", "wav", "track_item")
end

local function render_selected_tracks(request)
  return d29_render_managed_job(request, "template.render.render_selected_tracks", "wav", "selected_tracks")
end

local function render_region_with_track_filter(request)
  return d29_render_managed_job(request, "template.render.render_region_with_track_filter", "wav", "track_item")
end

local function render_ogg(request)
  return d29_render_managed_job(request, "template.render.render_ogg", "ogg", "item")
end

local function render_mp3(request)
  return d29_render_managed_job(request, "template.render.render_mp3", "mp3", "item")
end

local function render_flac(request)
  return d29_render_managed_job(request, "template.render.render_flac", "flac", "item")
end

local function render_aiff(request)
  return d29_render_managed_job(request, "template.render.render_aiff", "aiff", "item")
end

local function render_m4a(request)
  return d29_render_managed_job(request, "template.render.render_m4a", "m4a", "item")
end

local function render_opus(request)
  return d29_render_managed_job(request, "template.render.render_opus", "opus", "item")
end

return {
  exports = {
    render_item = render_item,
    render_selected_item = render_selected_item,
    render_track_item = render_track_item,
    render_selected_tracks = render_selected_tracks,
    render_ogg = render_ogg,
    render_mp3 = render_mp3,
    render_flac = render_flac,
    render_aiff = render_aiff,
    render_m4a = render_m4a,
    render_opus = render_opus,
    set_render_format = set_render_format,
    set_ogg_quality_or_compression = set_ogg_quality_or_compression,
    set_mp3_bitrate_or_quality = set_mp3_bitrate_or_quality,
    set_flac_compression = set_flac_compression,
    set_aiff_bit_depth = set_aiff_bit_depth,
    render_region_with_track_filter = render_region_with_track_filter,
    output_absolute_path = output_absolute_path,
    output_file_metadata = output_file_metadata,
  },
}
