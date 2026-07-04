-- Extracted Wave 1A handler: template.core.read_last_result.

local function read_last_result_bounded_limit(request, requested, default_limit, hard_limit)
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

local function read_last_result(request)
  local limit = read_last_result_bounded_limit(request, request.params.limit, 8, 50)
  local kind = is_string(request.params.kind) and request.params.kind or nil
  return {
    owner = ACTIVE_OWNER,
    generation = ACTIVE_GENERATION,
    updated = false,
    kind = kind,
    limit = limit,
    refs = json_array({}),
    truncated = false,
  }
end
