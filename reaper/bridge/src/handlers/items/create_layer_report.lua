-- Extracted First-Real-Fixture-A A3 handler: template.items.create_layer_report.

local function create_layer_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_layer_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_layer_report_artifact_ref_from_request_refs(request, expected)
  expected = expected or {}
  if not is_json_array(request.refs) then
    return nil
  end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "artifact" and is_string(ref.ref) then
      local summary = is_object(ref.summary) and ref.summary or {}
      if summary.schema == expected.schema
        and summary.owner_pack == expected.owner_pack
        and summary.scope == expected.scope then
        local parts = parse_artifact_ref(ref.ref)
        if parts
          and parts.owner_pack == expected.owner_pack
          and parts.scope == expected.scope then
          return ref.ref
        end
      end
    end
  end
  return nil
end

local function create_layer_report_read_evidence_artifact(ref)
  local root_ok, blocker, root_message = a3_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end
  local envelope, failure = read_artifact_envelope(ref, A3_ARTIFACT_SPECS.layer_evidence)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.pack ~= "items" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 layer evidence artifact envelope does not match the expected items template producer.",
      details = {
        blocker = "layer_evidence_producer_mismatch",
      },
    }
  end
  return envelope
end

local function create_layer_report_count_from_summary_or_payload(envelope, summary_key, payload_key)
  local summary = is_object(envelope.summary) and envelope.summary or {}
  if type(summary[summary_key]) == "number" and summary[summary_key] >= 0 then
    return math.floor(summary[summary_key])
  end
  local payload = is_object(envelope.payload) and envelope.payload or {}
  local payload_value = payload[payload_key]
  if is_json_array(payload_value) then
    return #payload_value
  end
  return 0
end

local function create_layer_report_rows(evidence_envelope, row_count)
  local payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local items = is_json_array(payload.items) and payload.items or json_array({})
  local rows = json_array({})
  for index = 1, row_count do
    local item = is_object(items[index]) and items[index] or {}
    rows[#rows + 1] = {
      row = index,
      item_ref = bounded_string(item.item_ref or item.ref, 120) or JSON_NULL,
      track_ref = bounded_string(item.track_ref, 120) or JSON_NULL,
      name = bounded_string(item.name, 120) or JSON_NULL,
      color = bounded_string(item.color, 80) or JSON_NULL,
    }
  end
  return rows
end

local function create_layer_report_compact_evidence_summary(evidence_envelope)
  local summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  return {
    schema = summary.schema or evidence_envelope.schema,
    item_count = summary.item_count or 0,
    track_count = summary.track_count or 0,
    evidence_family_count = summary.evidence_family_count or 0,
    truncated = summary.truncated == true,
    fixture = bounded_string(summary.fixture, 120) or JSON_NULL,
  }
end

local function create_layer_report(request)
  local evidence_ref = create_layer_report_artifact_ref_from_request_refs(request, A3_ARTIFACT_SPECS.layer_evidence)
  if not evidence_ref then
    return create_layer_report_error("ARTIFACT_NOT_FOUND", "A3 layer report requires an items.layer_evidence.v1 artifact ref.", {
      blocker = "layer_evidence_ref_missing",
    })
  end

  local evidence_envelope, evidence_failure = create_layer_report_read_evidence_artifact(evidence_ref)
  if not evidence_envelope then
    return create_layer_report_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end

  local item_count = create_layer_report_count_from_summary_or_payload(evidence_envelope, "item_count", "items")
  local track_count = create_layer_report_count_from_summary_or_payload(evidence_envelope, "track_count", "tracks")
  local max_rows = create_layer_report_bounded_limit(request, request.params.max_report_rows, 24, 24)
  local report_row_count = math.min(max_rows, math.max(item_count, track_count, 1))
  local summary = {
    evidence_item_count = item_count,
    evidence_track_count = track_count,
    report_row_count = report_row_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    typed_fixture_smoke = true,
    consumed_artifact_refs = json_array({ evidence_ref }),
    evidence_summary = create_layer_report_compact_evidence_summary(evidence_envelope),
    rows = create_layer_report_rows(evidence_envelope, report_row_count),
  }
  local write, failure = write_a3_artifact(request, A3_ARTIFACT_SPECS.layer_report, summary, payload)
  if not write then
    return create_layer_report_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
