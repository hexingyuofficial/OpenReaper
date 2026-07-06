-- Extracted D21 handler: render read-only controls.

local function d21_render_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function bounded_limit(request, requested, default_limit, hard_limit)
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

local function d21_render_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d21_render_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function d21_render_number(project, key, fallback)
  local ok, value = call_reaper("GetSetProjectInfo", project, key, 0, false)
  if ok and type(value) == "number" then
    return value
  end
  return fallback or 0
end

local function d21_render_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d21_render_region_ref(region_index)
  return "region:index:" .. tostring(region_index or 0)
end

local function d21_render_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d21_render_track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  return 0
end

local function d21_render_track_ref(track)
  local guid = d21_render_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d21_render_track_index(track))
end

local function d21_render_ref_object(kind, ref, scheme, value, summary)
  return {
    kind = kind,
    ref = ref,
    identity = {
      scheme = scheme,
      value = value,
    },
    summary = summary,
  }
end

local function d21_render_region_token_from_request(request)
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if ref.kind == "region" then
      local raw = ref.ref or ""
      local by_index = raw:match("^region:index:(%-?%d+)$")
      if by_index then
        return { scheme = "index", value = tonumber(by_index), ref = raw }
      end
      local by_name = raw:match("^region:name:(.+)$")
      if by_name then
        return { scheme = "name", value = by_name, ref = raw }
      end
    end
  end
  return nil
end

local function d21_render_regions(project, limit)
  local regions = json_array({})
  local ok_count, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = ok_count and math.max(0, math.floor((first_number(marker_count) or 0) + (first_number(region_count) or 0))) or 0
  local max_regions = math.min(limit or 100, 256)
  for index = 0, total - 1 do
    local ok, retval, is_region, start_pos, end_pos, name, region_index = call_reaper("EnumProjectMarkers3", project, index)
    if ok and retval and is_region == true then
      regions[#regions + 1] = {
        index = math.floor(first_number(region_index) or (#regions + 1)),
        name = bounded_string(first_string(name) or "", 160),
        start_seconds = first_number(start_pos) or 0,
        end_seconds = first_number(end_pos) or 0,
      }
      if #regions >= max_regions then
        break
      end
    end
  end
  return regions
end

local function d21_render_resolve_region(request)
  local project = d21_render_current_project()
  local token = d21_render_region_token_from_request(request)
  if not token then
    return nil, "REGION_REF_REQUIRED", "Render region read requires a region ref."
  end
  local matches = json_array({})
  local regions = d21_render_regions(project, 256)
  for index = 1, #regions do
    local region = regions[index]
    if token.scheme == "index" and region.index == token.value then
      matches[#matches + 1] = region
    elseif token.scheme == "name" and region.name == token.value then
      matches[#matches + 1] = region
    end
  end
  if #matches == 1 then
    return matches[1], nil, nil
  end
  if #matches > 1 then
    return nil, "REGION_AMBIGUOUS", "Render region ref matched multiple regions."
  end
  return nil, "REGION_NOT_FOUND", "Render region ref could not be resolved."
end

local function d21_render_bounds_from_kind(request)
  local project = d21_render_current_project()
  local kind = request.params.bounds_kind or "current_settings"
  if kind == "custom" then
    local start_seconds = tonumber(request.params.start_position_seconds)
    local end_seconds = tonumber(request.params.end_position_seconds)
    if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds < start_seconds then
      return nil, d21_render_error("BOUNDS_INVALID", "Custom render bounds require non-negative start/end with end >= start.", {
        start_position_seconds = request.params.start_position_seconds,
        end_position_seconds = request.params.end_position_seconds,
      })
    end
    return {
      resolved_kind = "custom",
      start_position_seconds = start_seconds,
      end_position_seconds = end_seconds,
      duration_seconds = end_seconds - start_seconds,
      label = bounded_string(request.params.label or "custom", 160),
    }
  end
  if kind == "time_selection" then
    local ok, start_seconds, end_seconds = call_reaper("GetSet_LoopTimeRange", false, false, 0, 0, false)
    if not ok or type(start_seconds) ~= "number" or type(end_seconds) ~= "number" or end_seconds <= start_seconds then
      return nil, d21_render_error("TIME_SELECTION_EMPTY", "Render bounds requested time selection, but no active time selection was found.", {})
    end
    return {
      resolved_kind = "time_selection",
      start_position_seconds = start_seconds,
      end_position_seconds = end_seconds,
      duration_seconds = end_seconds - start_seconds,
      label = "time_selection",
    }
  end
  if kind == "region" then
    local region, code, message = d21_render_resolve_region(request)
    if not region then
      return nil, d21_render_error(code, message, {})
    end
    return {
      resolved_kind = "region",
      region_ref = d21_render_region_ref(region.index),
      start_position_seconds = region.start_seconds,
      end_position_seconds = region.end_seconds,
      duration_seconds = region.end_seconds - region.start_seconds,
      label = region.name,
    }
  end
  if kind == "selected_project_regions" then
    return nil, d21_render_error("SELECTED_REGIONS_UNAVAILABLE", "Selected project regions are not exposed by the bounded D21 read route.", {})
  end
  local ok_length, project_length = call_reaper("GetProjectLength", project)
  local end_seconds = ok_length and first_number(project_length) or 0
  return {
    resolved_kind = "entire_project",
    start_position_seconds = 0,
    end_position_seconds = end_seconds,
    duration_seconds = end_seconds,
    label = "entire_project",
  }
end

local function read_render_settings(request)
  local project = d21_render_current_project()
  local start_seconds = d21_render_number(project, "RENDER_STARTPOS", 0)
  local end_seconds = d21_render_number(project, "RENDER_ENDPOS", 0)
  return d21_render_summary(request, {
    bounds_flag = math.floor(d21_render_number(project, "RENDER_BOUNDSFLAG", 0)),
    start_position_seconds = start_seconds,
    end_position_seconds = end_seconds,
    sample_rate = math.floor(d21_render_number(project, "RENDER_SRATE", 0)),
    channel_count = math.floor(d21_render_number(project, "RENDER_CHANNELS", 0)),
    ["output_directory"] = d21_render_string(project, "RENDER_FILE", 240),
    filename_pattern = d21_render_string(project, "RENDER_PATTERN", 160),
    format_fingerprint = bounded_string(d21_render_string(project, "RENDER_FORMAT", 80), 80),
    render_flags = json_array({}),
  }), nil, json_array({}), json_array({}), json_array({})
end

local function resolve_render_bounds(request)
  local bounds, err = d21_render_bounds_from_kind(request)
  if err then
    return nil, err
  end
  return d21_render_summary(request, bounds), nil, json_array({}), json_array({}), json_array({})
end

local function d21_render_target_name(pattern, label, index)
  local value = pattern
  if type(value) ~= "string" or value == "" then
    value = "$project"
  end
  value = value:gsub("%$region", label ~= "" and label or ("region_" .. tostring(index)))
  value = value:gsub("%$project", "current_project")
  value = value:gsub("[/\\:%c]", "_")
  if value == "" then
    value = "render_target_" .. tostring(index)
  end
  return bounded_string(value, 160)
end

local function preview_render_targets(request)
  local limit = bounded_limit(request, request.params.max_targets, 8, 32)
  local project = d21_render_current_project()
  local output_dir = bounded_string(request.params.output_directory or d21_render_string(project, "RENDER_FILE", 240), 240)
  local filename_pattern = bounded_string(request.params.filename_pattern or d21_render_string(project, "RENDER_PATTERN", 160), 160)
  local bounds_kind = request.params.bounds_kind or "current_settings"
  local targets = json_array({})
  local refs = json_array({})
  if bounds_kind == "selected_project_regions" then
    local regions = d21_render_regions(project, limit)
    for index = 1, #regions do
      local region = regions[index]
      local name = d21_render_target_name(filename_pattern, region.name, index)
      local ref = "file:render-preview:" .. tostring(index)
      targets[#targets + 1] = {
        file_ref = ref,
        ["output_directory"] = output_dir,
        filename = name,
        region_ref = d21_render_region_ref(region.index),
      }
      refs[#refs + 1] = d21_render_ref_object("file", ref, "render_preview", tostring(index), "Predicted render target.")
    end
  else
    local bounds, err = d21_render_bounds_from_kind({
      params = {
        bounds_kind = bounds_kind == "current_settings" and "entire_project" or bounds_kind,
        start_position_seconds = request.params.start_position_seconds,
        end_position_seconds = request.params.end_position_seconds,
        label = request.params.label,
      },
      refs = request.refs,
    })
    if err then
      return nil, err
    end
    local ref = "file:render-preview:1"
    targets[#targets + 1] = {
      file_ref = ref,
      ["output_directory"] = output_dir,
      filename = d21_render_target_name(filename_pattern, bounds.label, 1),
      bounds = bounds,
    }
    refs[#refs + 1] = d21_render_ref_object("file", ref, "render_preview", "1", "Predicted render target.")
  end
  return d21_render_summary(request, {
    targets = targets,
    target_count = #targets,
    truncated = #targets >= limit,
  }), nil, refs, json_array({}), refs
end

local function read_region_render_matrix(request)
  local region, code, message = d21_render_resolve_region(request)
  if not region then
    return nil, d21_render_error(code, message, {})
  end
  local project = d21_render_current_project()
  local limit = bounded_limit(request, request.params.limit, 64, 128)
  local tracks = json_array({})
  local refs = json_array({})
  for matrix_index = 0, limit - 1 do
    local ok, track = call_reaper("EnumRegionRenderMatrix", project, region.index, matrix_index)
    if not ok or not track then
      break
    end
    local ref = d21_render_track_ref(track)
    tracks[#tracks + 1] = {
      track_ref = ref,
      index = d21_render_track_index(track),
    }
    refs[#refs + 1] = d21_render_ref_object("track", ref, "guid_or_index", ref, "Track in region render matrix.")
  end
  return d21_render_summary(request, {
    region_ref = d21_render_region_ref(region.index),
    tracks = tracks,
    track_count = #tracks,
    truncated = #tracks >= limit,
  }), nil, refs, json_array({}), refs
end
