-- Extracted First-Real-Fixture-A A1 handler: template.analysis.measure_loop_click_risk.

local function measure_loop_click_risk_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function measure_loop_click_risk_bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function measure_loop_click_risk_artifact_ref_from_request_refs(request, expected)
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

local function measure_loop_click_risk_item_summary(request)
  local item_facts = read_item_summary({
    refs = request.refs,
    params = { include_take_summary = true },
    budget = request.budget,
  })
  if not item_facts then
    return nil
  end
  return item_facts
end

local function measure_loop_click_risk(request)
  local item_facts = measure_loop_click_risk_item_summary(request)
  if not item_facts then
    return measure_loop_click_risk_error("ITEM_NOT_FOUND", "Loop click-risk measurement requires a resolvable item ref.", {})
  end

  local candidate_ref = measure_loop_click_risk_artifact_ref_from_request_refs(request, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_ref then
    return measure_loop_click_risk_error("ARTIFACT_NOT_FOUND", "Loop click-risk measurement requires a loop-candidates artifact ref.", {})
  end
  local candidate_envelope, candidate_failure = read_artifact_envelope(candidate_ref, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_envelope then
    return measure_loop_click_risk_error(candidate_failure.code, candidate_failure.message, candidate_failure.details)
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.measure_loop_click_risk"]
  local candidate_count = 0
  if is_object(candidate_envelope.summary) and type(candidate_envelope.summary.candidate_count) == "number" then
    candidate_count = candidate_envelope.summary.candidate_count
  end
  local risk_fact_count = candidate_count > 0 and 1 or 0
  local summary = {
    measured_candidate_count = candidate_count,
    risk_fact_count = risk_fact_count,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    item = item_facts,
    candidate_artifact_ref = candidate_ref,
    boundary_window_ms = measure_loop_click_risk_bounded_number(request.params.boundary_window_ms, 20),
    risk_facts = risk_fact_count > 0 and json_array({
      {
        candidate_id = "candidate:0",
        click_risk = "unknown_smoke_heuristic",
        boundary_delta = 0,
      },
    }) or json_array({}),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return measure_loop_click_risk_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
