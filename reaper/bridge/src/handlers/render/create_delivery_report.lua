-- Extracted First-Real-Fixture-A A2 handler: template.render.create_delivery_report.

local function create_delivery_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_delivery_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_delivery_report_bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function create_delivery_report_artifact_ref_from_request_refs(request, expected)
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

local function create_delivery_report_read_a2_artifact(ref, spec, expected_producer)
  local envelope, failure = read_artifact_envelope(ref, spec)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.id ~= expected_producer
    or envelope.producer.pack ~= "render" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 input artifact envelope does not match the expected render producer.",
      details = {
        blocker = "render_evidence_producer_mismatch",
        expected_producer = expected_producer,
      },
    }
  end
  return envelope
end

local function create_delivery_report(request)
  local output_ref = create_delivery_report_artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.region_wav_output)
  local evidence_ref = create_delivery_report_artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.render_job_evidence)
  if not output_ref or not evidence_ref then
    return create_delivery_report_error("ARTIFACT_NOT_FOUND", "A2 delivery report requires render output and render job evidence artifact refs.", {
      blocker = "render_evidence_refs_missing",
    })
  end

  local output_envelope, output_failure = create_delivery_report_read_a2_artifact(output_ref, A2_ARTIFACT_SPECS.region_wav_output, "template.render.render_region_wav")
  if not output_envelope then
    return create_delivery_report_error(output_failure.code, output_failure.message, output_failure.details)
  end
  local evidence_envelope, evidence_failure = create_delivery_report_read_a2_artifact(evidence_ref, A2_ARTIFACT_SPECS.render_job_evidence, "template.render.render_region_wav")
  if not evidence_envelope then
    return create_delivery_report_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end
  local evidence_summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  local evidence_payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local evidence_output_ref = evidence_summary.output_artifact_ref or evidence_payload.output_artifact_ref
  if evidence_output_ref ~= output_ref then
    return create_delivery_report_error("ARTIFACT_INVALID", "A2 render job evidence does not reference the requested output artifact.", {
      blocker = "render_evidence_output_mismatch",
    })
  end

  local file_size_value = is_object(output_envelope.summary) and create_delivery_report_bounded_number(output_envelope.summary.file_size_bytes, 0) or 0
  local nonempty_output_count = file_size_value > 0 and 1 or 0
  local issue_count = nonempty_output_count == 1 and 0 or 1
  local report_row_count = math.min(create_delivery_report_bounded_limit(request, request.params.max_report_rows, 1, 12), 1)
  local summary = {
    output_artifact_count = 1,
    job_evidence_count = 1,
    region_count = 1,
    nonempty_output_count = nonempty_output_count,
    report_row_count = report_row_count,
    issue_count = issue_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    consumed_artifact_refs = json_array({ output_ref, evidence_ref }),
    rows = json_array({
      {
        row = 1,
        output_basename = is_object(output_envelope.summary) and output_envelope.summary.output_basename or JSON_NULL,
        file_size_bytes = file_size_value,
        issue_count = issue_count,
      },
    }),
  }
  local write, failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.delivery_report, summary, payload)
  if not write then
    return create_delivery_report_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
