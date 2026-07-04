-- Extracted First-Real-Fixture-A A1 handler: template.project.create_cleanup_report.

local function create_cleanup_report_error(code, message, details, recoverable)
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
