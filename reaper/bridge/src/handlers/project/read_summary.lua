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
  return summary
end
