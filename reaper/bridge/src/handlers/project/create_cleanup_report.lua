-- Extracted First-Real-Fixture-A A1 handler: template.project.create_cleanup_report.

local function create_cleanup_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_project_map_snapshot_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_cleanup_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_cleanup_report(request)
  local spec = A1_ARTIFACT_SPECS["run_job:project.create_cleanup_report"]
  local project_summary = read_project_summary({
    params = { include_counts = true },
    budget = request.budget,
  })
  local markers = list_markers_regions({
    params = {
      include_markers = request.params.include_markers ~= false,
      include_regions = request.params.include_regions ~= false,
      limit = request.params.marker_region_limit,
    },
    budget = request.budget,
  })
  local tempo = read_tempo_map({
    params = {
      limit = request.params.tempo_marker_limit,
      effective_at_seconds = json_array({ 0 }),
    },
    budget = request.budget,
  })
  local metadata = read_project_metadata({
    params = { fields = json_array({ "title", "author", "notes" }) },
    budget = request.budget,
  })
  local metadata_field_count = 0
  for _, field in ipairs({ "title", "author", "notes" }) do
    if metadata[field] ~= nil then
      metadata_field_count = metadata_field_count + 1
    end
  end
  local evidence_family_count = 4
  local report_row_count = math.min(create_cleanup_report_bounded_limit(request, request.params.max_report_rows, 8, 64), evidence_family_count)
  local project_fingerprint = "tracks:" .. tostring(project_summary.track_count or 0)
    .. "|items:" .. tostring(project_summary.item_count or 0)
    .. "|markers:" .. tostring(project_summary.marker_count or 0)
    .. "|regions:" .. tostring(project_summary.region_count or 0)
  local summary = {
    evidence_family_count = evidence_family_count,
    report_row_count = report_row_count,
    marker_count = markers.marker_count or 0,
    region_count = markers.region_count or 0,
    metadata_field_count = metadata_field_count,
    tempo_marker_count = tempo and #tempo.tempo_markers or 0,
    project_fingerprint = project_fingerprint,
    truncated = markers.truncated == true or tempo.truncated == true,
  }
  local payload = {
    smoke_only = true,
    cleanup_policy_claim = false,
    project_summary = project_summary,
    markers_regions = markers,
    tempo = tempo,
    metadata = metadata,
    rows = json_array({
      { row = 1, family = "project_summary" },
      { row = 2, family = "markers_regions" },
      { row = 3, family = "tempo" },
      { row = 4, family = "metadata" },
    }),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return create_cleanup_report_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local PROJECT_MAP_SNAPSHOT_INPUT = {
  owner_pack = "project",
  scope = "project_map_snapshot",
  schema = "project.project_map_snapshot.v1",
}

local function create_project_map_snapshot_previous_ref(request)
  if is_string(request.params.previous_snapshot_ref) and request.params.previous_snapshot_ref ~= "" then
    return request.params.previous_snapshot_ref
  end
  for _, ref in ipairs(request.refs or {}) do
    if is_object(ref) and ref.kind == "artifact" and is_string(ref.ref) then
      return ref.ref
    end
  end
  return nil
end

local function create_project_map_snapshot_diff(current, previous_ref)
  if not previous_ref then
    return {
      compared = false,
      changed_count = 0,
      track_count_changed = false,
      item_count_changed = false,
    }, nil
  end
  local envelope, failure = read_artifact_envelope(previous_ref, PROJECT_MAP_SNAPSHOT_INPUT)
  if not envelope then
    return nil, failure
  end
  local previous = is_object(envelope.summary) and envelope.summary or {}
  local changed_count = 0
  local track_count_changed = previous.track_count ~= current.track_count
  local item_count_changed = previous.item_count ~= current.item_count
  local cursor_changed = previous.track_cursor ~= current.track_cursor
  if track_count_changed then changed_count = changed_count + 1 end
  if item_count_changed then changed_count = changed_count + 1 end
  if cursor_changed then changed_count = changed_count + 1 end
  return {
    compared = true,
    previous_snapshot_ref = previous_ref,
    changed_count = changed_count,
    track_count_changed = track_count_changed,
    item_count_changed = item_count_changed,
    cursor_changed = cursor_changed,
  }, nil
end

local function create_project_map_snapshot(request)
  local spec = A1_ARTIFACT_SPECS["run_job:project.create_project_map_snapshot"]
  local overview, overview_failure = OPENREAPER_HANDLER_EXPORTS.read_track_item_overview({
    params = {
      max_tracks = request.params.max_tracks,
      max_items_per_track = request.params.max_items_per_track,
      max_selected_items = request.params.max_selected_items,
      track_cursor = request.params.track_cursor,
      include_selected_items = request.params.include_selected_items,
      include_track_items = request.params.include_track_items,
    },
    budget = request.budget,
  })
  if not overview then
    return create_project_map_snapshot_error(overview_failure.code, overview_failure.message, overview_failure.details)
  end

  local previous_ref = create_project_map_snapshot_previous_ref(request)
  local diff, diff_failure = create_project_map_snapshot_diff(overview, previous_ref)
  if not diff then
    return create_project_map_snapshot_error(diff_failure.code, diff_failure.message, diff_failure.details)
  end

  local selected_count = overview.selected_items and #overview.selected_items or 0
  local snapshot_token = "tracks:" .. tostring(overview.track_count or 0)
    .. "|items:" .. tostring(overview.item_count or 0)
    .. "|cursor:" .. tostring(overview.track_cursor or 0)
    .. "|returned:" .. tostring(overview.returned_track_count or 0)
  local summary = {
    project_ref = overview.project_ref or "project:current",
    track_count = overview.track_count or 0,
    item_count = overview.item_count or 0,
    track_cursor = overview.track_cursor or 0,
    returned_track_count = overview.returned_track_count or 0,
    selected_count = selected_count,
    snapshot_token = snapshot_token,
    coverage_status = overview.truncated == true and "paged_partial" or "complete_page",
    diff_compared = diff.compared == true,
    diff_changed_count = diff.changed_count or 0,
    truncated = overview.truncated == true,
  }
  if overview.next_track_cursor then
    summary.next_track_cursor = overview.next_track_cursor
  end
  local payload = {
    project_ref = summary.project_ref,
    overview = overview,
    coverage = {
      tracks = "paged",
      track_items = overview.max_items_per_track_effective and overview.max_items_per_track_effective > 0 and "bounded_per_track" or "counts_only",
      selected_items = "bounded",
      fx = "not_hydrated",
      envelopes = "not_hydrated",
      routing = "not_hydrated",
      media_sources = "not_hydrated",
    },
    diff = diff,
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return create_project_map_snapshot_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
