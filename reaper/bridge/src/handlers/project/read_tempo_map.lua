-- Extracted Wave 1A handler: template.project.read_tempo_map.

local function read_tempo_map_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function read_tempo_map_bounded_limit(request, requested, default_limit, hard_limit)
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

local function read_tempo_map(request)
  local project = read_tempo_map_current_project()
  local limit = read_tempo_map_bounded_limit(request, request.params.limit, 32, 50)
  local ok_count, marker_count = call_reaper("CountTempoTimeSigMarkers", project)
  local total = ok_count and first_number(marker_count) or 0
  local tempo_markers = json_array({})

  for index = 0, math.max(total - 1, -1) do
    if #tempo_markers >= limit then
      break
    end
    local ok_marker, retval, timepos, measurepos, beatpos, bpm, timesig_num, timesig_denom, lineartempo = call_reaper("GetTempoTimeSigMarker", project, index)
    if ok_marker and retval then
      tempo_markers[#tempo_markers + 1] = {
        index = index,
        time_seconds = first_number(timepos) or 0,
        measure = first_number(measurepos) or 0,
        beat = first_number(beatpos) or 0,
        bpm = first_number(bpm) or 0,
        time_sig_num = first_number(timesig_num) or 0,
        time_sig_denom = first_number(timesig_denom) or 0,
        linear_tempo = lineartempo == true,
      }
    end
  end

  local effective = json_array({})
  local requested_times = is_json_array(request.params.effective_at_seconds) and request.params.effective_at_seconds or json_array({})
  local effective_limit = read_tempo_map_bounded_limit(request, #requested_times, math.min(#requested_times, 8), 16)
  for index = 1, math.min(#requested_times, effective_limit) do
    local time_seconds = requested_times[index]
    if type(time_seconds) == "number" then
      local ok_effective, bpm, timesig_num, timesig_denom = call_reaper("TimeMap_GetTimeSigAtTime", project, time_seconds)
      effective[#effective + 1] = {
        time_seconds = time_seconds,
        bpm = ok_effective and first_number(bpm) or 0,
        time_sig_num = ok_effective and first_number(timesig_num) or 0,
        time_sig_denom = ok_effective and first_number(timesig_denom) or 0,
      }
    end
  end

  return {
    tempo_markers = tempo_markers,
    effective = effective,
    truncated = total > #tempo_markers,
  }
end
