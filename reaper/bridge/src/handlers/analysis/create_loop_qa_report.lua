-- Extracted First-Real-Fixture-A A1 handler: template.analysis.create_loop_qa_report.

local function create_loop_qa_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_loop_qa_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_loop_qa_report_bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function create_loop_qa_report_artifact_ref_from_request_refs(request, expected)
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

local function create_loop_qa_report(request)
  local candidate_ref = create_loop_qa_report_artifact_ref_from_request_refs(request, A1_LOOP_CANDIDATES_INPUT)
  local risk_ref = create_loop_qa_report_artifact_ref_from_request_refs(request, A1_LOOP_CLICK_RISK_INPUT)
  if not candidate_ref or not risk_ref then
    return create_loop_qa_report_error("ARTIFACT_NOT_FOUND", "Loop QA report requires loop-candidates and click-risk artifact refs.", {})
  end
  local candidate_envelope, candidate_failure = read_artifact_envelope(candidate_ref, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_envelope then
    return create_loop_qa_report_error(candidate_failure.code, candidate_failure.message, candidate_failure.details)
  end
  local risk_envelope, risk_failure = read_artifact_envelope(risk_ref, A1_LOOP_CLICK_RISK_INPUT)
  if not risk_envelope then
    return create_loop_qa_report_error(risk_failure.code, risk_failure.message, risk_failure.details)
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.create_loop_qa_report"]
  local candidate_count = is_object(candidate_envelope.summary) and create_loop_qa_report_bounded_number(candidate_envelope.summary.candidate_count, 0) or 0
  local risk_fact_count = is_object(risk_envelope.summary) and create_loop_qa_report_bounded_number(risk_envelope.summary.risk_fact_count, 0) or 0
  local report_row_count = math.min(create_loop_qa_report_bounded_limit(request, request.params.max_report_rows, 8, 32), math.max(candidate_count, risk_fact_count, 1))
  local summary = {
    candidate_count = candidate_count,
    risk_fact_count = risk_fact_count,
    report_row_count = report_row_count,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    candidate_artifact_ref = candidate_ref,
    click_risk_artifact_ref = risk_ref,
    rows = json_array({
      {
        row = 1,
        finding = "fixture_smoke_readback",
        candidate_count = candidate_count,
        risk_fact_count = risk_fact_count,
      },
    }),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return create_loop_qa_report_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
