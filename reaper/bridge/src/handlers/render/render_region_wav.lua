-- Extracted First-Real-Fixture-A A2 handler: template.render.render_region_wav.

local function render_region_wav_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function render_region_wav_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function render_region_wav_item_guid(item)
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

local function render_region_wav_item_ref_string(item)
  local guid = render_region_wav_item_guid(item)
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

local function render_region_wav_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function render_region_wav_take_guid(take)
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

local function render_region_wav_take_ref_string(take)
  local guid = render_region_wav_take_guid(take)
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

local function render_region_wav_take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

local function render_region_wav_source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

local function render_region_wav_source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true
end

local function render_region_wav_source_length_with_file_fallback(source, filename)
  local length, length_is_quarter_notes = render_region_wav_source_length(source)
  if length > 0 and not length_is_quarter_notes then
    return length, "take_source"
  end
  if length_is_quarter_notes then
    return 0, "quarter_notes"
  end
  if filename ~= "" and file_exists(filename) then
    local ok_file_source, file_source = call_reaper("PCM_Source_CreateFromFile", filename)
    if ok_file_source and file_source then
      local fallback_length, fallback_length_is_quarter_notes = render_region_wav_source_length(file_source)
      call_reaper("PCM_Source_Destroy", file_source)
      if fallback_length > 0 and not fallback_length_is_quarter_notes then
        return fallback_length, "pcm_source_create_from_file"
      end
      if fallback_length_is_quarter_notes then
        return 0, "quarter_notes"
      end
    end
  end
  return 0, "unreadable"
end

local function render_region_wav_source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function render_region_wav_root_ready()
  if not RENDER_ROOT then
    return false, "render_root_not_configured", "First-Real-Fixture-A A2 render root is not configured."
  end
  if RENDER_ROOT:sub(1, 7) == "file://" or not is_absolute_path(RENDER_ROOT) then
    return false, "render_root_invalid", "First-Real-Fixture-A A2 render root must be an absolute filesystem path."
  end
  return true
end

local function render_region_wav_safe_filename_suffix(value)
  local text = tostring(value or ""):gsub("^template:", ""):gsub("[^A-Za-z0-9_%-]", "_")
  if text == "" then
    text = "unknown"
  end
  if #text > 48 then
    text = text:sub(1, 48)
  end
  return text
end

local function managed_render_output(request)
  local suffix = render_region_wav_safe_filename_suffix(request.idempotency_key or request.id)
  local basename = "openreaper_a2_" .. suffix .. ".wav"
  return {
    basename = basename,
    relative_path = basename,
    path = path_join(RENDER_ROOT or "", basename),
  }
end

local function render_region_wav_file_size(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return nil
  end
  local size = handle:seek("end")
  handle:close()
  return size
end

local function render_region_wav_header_ok(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return false
  end
  local header = handle:read(12) or ""
  handle:close()
  return header:sub(1, 4) == "RIFF" and header:sub(9, 12) == "WAVE"
end

local function render_region_wav_parse_region_ref_token(token)
  if not is_string(token) then
    return nil
  end
  local index = token:match("^region:index:(%d+)$") or token:match("^index:(%d+)$")
  if index then
    return { scheme = "index", value = tonumber(index) }
  end
  local name = token:match("^region:name:(.+)$") or token:match("^name:(.+)$")
  if name and name ~= "" then
    return { scheme = "name", value = name }
  end
  local guid = token:match("^region:guid:(.+)$") or token:match("^guid:(.+)$")
  if guid and guid ~= "" then
    return { scheme = "guid", value = guid }
  end
  return nil
end

local function render_region_wav_region_token_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "region" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "index" or identity.scheme == "name" or identity.scheme == "guid" then
    return {
      scheme = identity.scheme,
      value = identity.scheme == "index" and tonumber(identity.value) or tostring(identity.value),
    }
  end
  return render_region_wav_parse_region_ref_token(ref.ref)
end

local function render_region_wav_region_token_from_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local token = render_region_wav_region_token_from_ref_object(request.refs[index])
      if token then
        return token
      end
    end
  end
  return nil
end

local function render_region_wav_resolve_region_for_render(request)
  local token = render_region_wav_region_token_from_request(request)
  if not token then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render_region_wav requires a resolvable region ref.",
      details = {
        blocker = "region_ref_missing",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  if token.scheme == "guid" then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render_region_wav currently supports region:index and region:name refs.",
      details = {
        blocker = "region_guid_ref_not_supported",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end

  local project = render_region_wav_current_project()
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = (ok_count and first_number(marker_count) or 0) + (ok_count and first_number(region_count) or 0)
  local match = nil
  local matches = 0
  local region_ordinal = 0
  for enum_index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, index_number = call_reaper("EnumProjectMarkers3", project, enum_index)
    if ok_enum and retval and is_region == true then
      local index_matches = token.scheme == "index"
        and (token.value == region_ordinal or token.value == first_number(index_number))
      local name_matches = token.scheme == "name" and tostring(name or "") == token.value
      if index_matches or name_matches then
        matches = matches + 1
        match = {
          region_ref = "region:index:" .. tostring(index_number or region_ordinal),
          name = bounded_string(name or "", 160),
          index = index_number or region_ordinal,
          start_seconds = first_number(pos) or 0,
          end_seconds = first_number(region_end) or 0,
        }
        if match.name ~= "" then
          match.preferred_region_ref = "region:name:" .. match.name
        end
      end
      region_ordinal = region_ordinal + 1
    end
  end
  if matches > 1 then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render region name is ambiguous.",
      details = {
        blocker = "region_ref_ambiguous",
        region_name = token.scheme == "name" and bounded_string(token.value, 160) or nil,
        match_count = matches,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        fallback_region_ref_scheme = "region:index:<zero-based-region-index>",
      },
    }
  end
  if not match then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region ref could not be resolved.",
      details = {
        blocker = "region_ref_not_found",
        requested_region_ref_scheme = token.scheme,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  match.duration_seconds = match.end_seconds - match.start_seconds
  if match.duration_seconds <= 0 or match.duration_seconds > 120 then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region bounds are empty or outside the bounded route limit.",
      details = {
        blocker = "region_bounds_invalid",
        region_ref = match.region_ref,
        preferred_region_ref = match.preferred_region_ref,
        region_start_seconds = match.start_seconds,
        region_end_seconds = match.end_seconds,
        duration_seconds = match.duration_seconds,
      },
    }
  end
  return match
end

local RENDER_REGION_WAV_UNSUPPORTED_SOURCE_TYPES = {
  MIDI = true,
  RPP_PROJECT = true,
  EMPTY = true,
  VIDEO = true,
}

local function render_region_wav_region_details(region)
  return {
    region_ref = region and region.region_ref or nil,
    preferred_region_ref = region and region.preferred_region_ref or nil,
    region_name = region and region.name or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  }
end

local function render_region_wav_merge_details(...)
  local merged = {}
  for index = 1, select("#", ...) do
    local source = select(index, ...)
    if is_object(source) then
      for key, value in pairs(source) do
        merged[key] = value
      end
    end
  end
  return merged
end

local function render_region_wav_source_details(region, item_facts, take_facts, source_facts)
  return render_region_wav_merge_details(render_region_wav_region_details(region), {
    item_ref = item_facts and item_facts.item_ref or nil,
    take_ref = take_facts and take_facts.take_ref or nil,
    source_type = source_facts and source_facts.source_type or nil,
    source_filename_present = source_facts and source_facts.source_filename_present == true or false,
    source_file_exists = source_facts and source_facts.source_file_exists == true or false,
    item_start_seconds = item_facts and item_facts.item_start_seconds or nil,
    item_end_seconds = item_facts and item_facts.item_end_seconds or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  })
end

local function render_region_wav_take_facts(take)
  if not take then
    return nil
  end
  return {
    take_ref = render_region_wav_take_ref_string(take),
  }
end

local function render_region_wav_source_facts(source)
  local filename = render_region_wav_source_filename_raw(source)
  return {
    source_type = render_region_wav_source_type(source),
    source_filename = filename,
    source_filename_present = filename ~= "",
    source_file_exists = filename ~= "" and file_exists(filename) or false,
  }
end

local function render_region_wav_active_audio_take_for_region(region)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local saw_overlap = false
  local first_failure = nil
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local item_start = render_region_wav_item_number(item, "D_POSITION")
      local item_end = item_start + render_region_wav_item_number(item, "D_LENGTH")
      local overlaps = item_end > region.start_seconds and item_start < region.end_seconds
      if overlaps then
        saw_overlap = true
        local item_facts = {
          item_ref = render_region_wav_item_ref_string(item),
          item_start_seconds = item_start,
          item_end_seconds = item_end,
        }
        local ok_take, take = call_reaper("GetActiveTake", item)
        if not ok_take or not take then
          first_failure = first_failure or {
            code = "TAKE_NOT_FOUND",
            message = "A2 render_region_wav found an overlapping item without an active take source.",
            details = render_region_wav_merge_details(render_region_wav_region_details(region), item_facts, {
              blocker = "take_source_missing",
            }),
          }
        elseif render_region_wav_take_is_midi(take) then
          local take_facts = render_region_wav_take_facts(take)
          first_failure = first_failure or {
            code = "PARAMS_INVALID",
            message = "A2 render_region_wav requires an audio take; the overlapping take is MIDI.",
            details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, {
              source_type = "MIDI",
              source_filename_present = false,
              source_file_exists = false,
            }), {
              blocker = "source_type_unsupported",
            }),
          }
        else
          local take_facts = render_region_wav_take_facts(take)
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if not ok_source or not source then
            first_failure = first_failure or {
              code = "TAKE_NOT_FOUND",
              message = "A2 render_region_wav could not read the active take source.",
              details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, nil), {
                blocker = "take_source_missing",
              }),
            }
          else
            local source_facts = render_region_wav_source_facts(source)
            if RENDER_REGION_WAV_UNSUPPORTED_SOURCE_TYPES[source_facts.source_type] then
              first_failure = first_failure or {
                code = "PARAMS_INVALID",
                message = "A2 render_region_wav does not support this take source type.",
                details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_type_unsupported",
                }),
              }
            elseif not source_facts.source_filename_present or not source_facts.source_file_exists then
              first_failure = first_failure or {
                code = "FILE_NOT_FOUND",
                message = "A2 render_region_wav source file is missing or offline.",
                details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_file_missing_or_offline",
                }),
              }
            else
              local source_len, source_length_method = render_region_wav_source_length_with_file_fallback(source, source_facts.source_filename)
              if source_length_method == "quarter_notes" then
                first_failure = first_failure or {
                  code = "PARAMS_INVALID",
                  message = "A2 render_region_wav does not support quarter-note based source length.",
                  details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_type_unsupported",
                    source_length_method = source_length_method,
                  }),
                }
              elseif not source_len or source_len <= 0 then
                first_failure = first_failure or {
                  code = "FILE_NOT_FOUND",
                  message = "A2 render_region_wav source length could not be measured from the take or file-backed fallback.",
                  details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_length_unreadable",
                    source_length_method = source_length_method,
                  }),
                }
              else
                local take_offset = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS"))) or 0
                local playrate = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE"))) or 1
                local overlap_start = math.max(region.start_seconds, item_start)
                local overlap_end = math.min(region.end_seconds, item_end)
                local source_start = take_offset + ((overlap_start - item_start) * playrate)
                local source_end = take_offset + ((overlap_end - item_start) * playrate)
                local clamped_source_start = math.max(0, math.min(source_len, source_start))
                local clamped_source_end = math.max(0, math.min(source_len, source_end))
                if playrate <= 0 or clamped_source_end <= clamped_source_start then
                  first_failure = first_failure or {
                    code = "REGION_NOT_FOUND",
                    message = "A2 render region does not overlap a renderable source range.",
                    details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                      blocker = "source_range_overlap_invalid",
                      source_length_seconds = source_len,
                      source_length_method = source_length_method,
                      source_start_seconds = source_start,
                      source_end_seconds = source_end,
                      playrate = playrate,
                    }),
                  }
                else
                  return {
                    item_ref = item_facts.item_ref,
                    take_ref = take_facts.take_ref,
                    source_type = source_facts.source_type,
                    source_filename = source_facts.source_filename,
                    source_filename_present = source_facts.source_filename_present,
                    source_file_exists = source_facts.source_file_exists,
                    source_length_seconds = source_len,
                    source_length_method = source_length_method,
                    source_start_seconds = clamped_source_start,
                    source_end_seconds = clamped_source_end,
                    item_start_seconds = item_start,
                    item_end_seconds = item_end,
                    playrate = playrate,
                  }
                end
              end
            end
          end
        end
      end
    end
  end
  if first_failure then
    return nil, first_failure
  end
  if saw_overlap then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "A2 render_region_wav found overlapping items but no renderable audio take.",
      details = render_region_wav_merge_details(render_region_wav_region_details(region), {
        blocker = "no_overlapping_audio_item",
      }),
    }
  end
  return nil, {
    code = "ITEM_NOT_FOUND",
    message = "A2 render_region_wav requires an audio item overlapping the resolved region.",
    details = render_region_wav_merge_details(render_region_wav_region_details(region), {
      blocker = "no_overlapping_audio_item",
    }),
  }
end

local function render_region_wav_job_object_ref(job_id)
  return {
    kind = "job",
    ref = "job:job_id:" .. job_id,
    identity = {
      scheme = "job_id",
      value = job_id,
    },
    summary = {
      template_id = "template.render.render_region_wav",
      pack = "render",
    },
  }
end

local function render_region_wav(request)
  local root_ok, blocker, root_message = render_region_wav_root_ready()
  if not root_ok then
    return render_region_wav_error("FILE_NOT_FOUND", root_message, {
      blocker = blocker,
      render_root_env = RENDER_ROOT_ENV,
    })
  end
  if request.params.output_policy ~= "openreaper_managed_render_root" then
    return render_region_wav_error("PARAMS_INVALID", "A2 render_region_wav requires managed render root output policy.", {
      field = "output_policy",
    })
  end
  if request.params.collision_policy ~= "fail_if_exists" then
    return render_region_wav_error("IDEMPOTENCY_CONFLICT", "A2 render_region_wav supports only first-pass fail_if_exists in this route.", {
      blocker = "reuse_idempotent_match_not_enabled",
      collision_policy = bounded_string(request.params.collision_policy, 80),
    }, false)
  end

  local region, region_failure = render_region_wav_resolve_region_for_render(request)
  if not region then
    return nil, region_failure
  end
  local source, source_failure = render_region_wav_active_audio_take_for_region(region)
  if not source then
    return nil, source_failure
  end

  local output = managed_render_output(request)
  if file_exists(output.path) then
    return render_region_wav_error("IDEMPOTENCY_CONFLICT", "A2 managed render output already exists and fail_if_exists forbids overwrite.", {
      blocker = "render_output_exists",
      output_basename = output.basename,
    }, false)
  end

  local start_percent = math.max(0, math.min(1, source.source_start_seconds / source.source_length_seconds))
  local end_percent = math.max(0, math.min(1, source.source_end_seconds / source.source_length_seconds))
  if end_percent <= start_percent then
    return render_region_wav_error("REGION_NOT_FOUND", "A2 render region does not overlap a renderable source range.", {
      blocker = "source_range_overlap_invalid",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
      source_length_seconds = source.source_length_seconds,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    })
  end

  local render_ok, render_success = call_reaper(
    "RenderFileSection",
    source.source_filename,
    output.path,
    start_percent,
    end_percent,
    source.playrate
  )
  if not render_ok or render_success == false then
    return render_region_wav_error("COMMAND_FAILED", "A2 render_region_wav could not render the source section through REAPER.", {
      blocker = "render_file_section_failed",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
    }, false)
  end

  local size = render_region_wav_file_size(output.path) or 0
  local wav_ok = render_region_wav_header_ok(output.path)
  if size <= 0 or not wav_ok then
    return render_region_wav_error("VERIFY_FAILED", "A2 render_region_wav output file failed WAV/non-empty verification.", {
      blocker = "wav_output_invalid",
      output_basename = output.basename,
      file_size_bytes = size,
      wav_header = wav_ok,
    }, false)
  end

  local output_summary = {
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    wav_header = wav_ok,
    file_count = 1,
    reused_existing = false,
    truncated = false,
  }
  local output_write, output_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.region_wav_output, output_summary, {
    smoke_only = false,
    output = output_summary,
    region = region,
    source = {
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      source_length_seconds = source.source_length_seconds,
      source_length_method = source.source_length_method,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    },
  })
  if not output_write then
    return render_region_wav_error(output_failure.code, output_failure.message, output_failure.details, output_failure.recoverable)
  end

  local artifact_id = artifact_id_from_request(request)
  local job_id = "render.region_wav." .. tostring(artifact_id or request.id)
  local job_ref = render_region_wav_job_object_ref(job_id)
  local evidence_summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    region_ref = region.region_ref,
    collision_policy = request.params.collision_policy,
    verification_status = "passed",
    truncated = false,
  }
  local evidence_write, evidence_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.render_job_evidence, evidence_summary, {
    smoke_only = false,
    output_artifact_ref = output_write.ref,
    region = region,
    output = output_summary,
    render_request = {
      format = request.params.format,
      output_policy = request.params.output_policy,
      collision_policy = request.params.collision_policy,
      sample_rate_hz = request.params.sample_rate_hz,
      bit_depth = request.params.bit_depth,
      channel_count = request.params.channel_count,
    },
  })
  if not evidence_write then
    return render_region_wav_error(evidence_failure.code, evidence_failure.message, evidence_failure.details, evidence_failure.recoverable)
  end

  local summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    evidence_artifact_ref = evidence_write.ref,
    format = "wav",
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
