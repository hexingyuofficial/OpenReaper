-- Extracted Wave 0 handler: template.project.read_summary.

local function read_project_summary_current_project()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0, bounded_string(project_path or "", 240)
  end
  return 0, ""
end

local function read_project_summary(request)
  local project, project_path = read_project_summary_current_project()
  local ok_name, name_a, name_b = call_reaper("GetProjectName", project, "")
  local ok_length, project_length = call_reaper("GetProjectLength", project)
  local ok_tracks, track_count = call_reaper("CountTracks", project)
  local ok_items, item_count = call_reaper("CountMediaItems", project)
  local ok_markers, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local ok_changes, change_count = call_reaper("GetProjectStateChangeCount", project)
  local ok_sample_rate, sample_rate = call_reaper("GetSetProjectInfo", project, "PROJECT_SRATE", 0, false)
  local include_counts = request.params.include_counts == true
  local include_media_counts = request.params.include_media_counts == true

  local summary = {
    kind = "project_summary",
    project_ref = "project:current",
    name = bounded_string((ok_name and first_string(name_a, name_b)) or "current", 160),
    path = bounded_string(project_path or "", 240),
    length_seconds = ok_length and first_number(project_length) or nil,
    sample_rate = ok_sample_rate and first_number(sample_rate) or nil,
    truncated = false,
  }
  if include_counts then
    summary.track_count = ok_tracks and first_number(track_count) or 0
    summary.item_count = ok_items and first_number(item_count) or 0
    summary.marker_count = ok_markers and first_number(marker_count) or 0
    summary.region_count = ok_markers and first_number(region_count) or 0
    summary.change_count = ok_changes and first_number(change_count) or 0
  end
  if include_media_counts then
    local total_takes = 0
    local midi_takes = 0
    local total_items = ok_items and math.max(0, math.floor(first_number(item_count) or 0)) or 0
    for item_index = 0, total_items - 1 do
      local ok_item, item = call_reaper("GetMediaItem", project, item_index)
      if ok_item and item then
        local ok_take_count, take_count = call_reaper("CountTakes", item)
        local item_take_count = ok_take_count and math.max(0, math.floor(first_number(take_count) or 0)) or 0
        total_takes = total_takes + item_take_count
        for take_index = 0, item_take_count - 1 do
          local ok_take, take = call_reaper("GetTake", item, take_index)
          if ok_take and take then
            local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
            if ok_midi and (is_midi == true or is_midi == 1) then midi_takes = midi_takes + 1 end
          end
        end
      end
    end
    summary.take_count = total_takes
    summary.midi_take_count = midi_takes
  end
  return summary
end
