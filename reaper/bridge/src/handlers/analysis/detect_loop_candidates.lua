-- Extracted First-Real-Fixture-A A1 handler: template.analysis.detect_loop_candidates.

local function detect_loop_candidates_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function detect_loop_candidates_bounded_limit(request, requested, default_limit, hard_limit)
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

local function detect_loop_candidates_bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function detect_loop_candidates_item_summary(request)
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

local function detect_loop_candidates(request)
  local item_facts = detect_loop_candidates_item_summary(request)
  if not item_facts then
    return detect_loop_candidates_error("ITEM_NOT_FOUND", "Loop-candidate detection requires a resolvable item ref.", {})
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.detect_loop_candidates"]
  local item_length = detect_loop_candidates_bounded_number(item_facts.length_seconds, 0)
  local start_seconds = detect_loop_candidates_bounded_number(request.params.start_seconds, 0)
  local end_seconds = detect_loop_candidates_bounded_number(request.params.end_seconds, item_length)
  if end_seconds <= start_seconds then
    end_seconds = item_length > 0 and item_length or (start_seconds + 1)
  end
  local analyzed_seconds = math.max(0, end_seconds - start_seconds)
  local max_candidates = detect_loop_candidates_bounded_limit(request, request.params.max_candidates, 4, 12)
  local candidate_count = analyzed_seconds > 0 and math.min(max_candidates, 1) or 0
  local candidates = json_array({})
  if candidate_count > 0 then
    candidates[#candidates + 1] = {
      candidate_id = "candidate:0",
      item_ref = item_facts.item_ref,
      start_seconds = start_seconds,
      end_seconds = end_seconds,
      duration_seconds = analyzed_seconds,
      score = 0.5,
      smoke_only = true,
    }
  end

  local summary = {
    candidate_count = candidate_count,
    analyzed_seconds = analyzed_seconds,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    item = item_facts,
    limits = {
      min_loop_seconds = detect_loop_candidates_bounded_number(request.params.min_loop_seconds, 1),
      max_loop_seconds = detect_loop_candidates_bounded_number(request.params.max_loop_seconds, 12),
      max_candidates = max_candidates,
    },
    candidates = candidates,
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return detect_loop_candidates_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
