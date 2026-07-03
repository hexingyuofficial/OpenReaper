local function first_string(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "string" then
      return value
    end
  end
  return nil
end

local function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then
      return value
    end
  end
  return nil
end

local function bounded_string(value, max_length)
  if value == nil or value == JSON_NULL then
    return nil
  end
  local text = tostring(value)
  local limit = max_length or 240
  if #text <= limit then
    return text
  end
  return text:sub(1, limit - 3) .. "..."
end

local function is_object(value)
  return type(value) == "table" and value ~= JSON_NULL and not is_json_array(value)
end

local function is_string(value)
  return type(value) == "string" and value:match("%S") ~= nil
end

local function is_request_id(value)
  return is_string(value) and value:match("^cmd_[A-Za-z0-9_]+$") ~= nil
end

local function is_non_negative_integer(value)
  return type(value) == "number" and value >= 0 and value == math.floor(value)
end

local function safe_budget(request)
  local budget = is_object(request and request.budget) and request.budget or {}
  return {
    max_response_bytes = is_non_negative_integer(budget.max_response_bytes) and budget.max_response_bytes > 0 and budget.max_response_bytes or DEFAULT_BUDGET.max_response_bytes,
    max_items = is_non_negative_integer(budget.max_items) and budget.max_items > 0 and budget.max_items or DEFAULT_BUDGET.max_items,
    max_inline_value_bytes = is_non_negative_integer(budget.max_inline_value_bytes) and budget.max_inline_value_bytes > 0 and budget.max_inline_value_bytes or DEFAULT_BUDGET.max_inline_value_bytes,
  }
end

local function result_id_from_filename(filename)
  local id = tostring(filename or ""):match("^([A-Za-z0-9_%-%.]+)%.json$")
  if id and id ~= "" then
    return id
  end
  return "cmd_invalid"
end

local function envelope_id(request, fallback_id)
  if is_request_id(request and request.id) then
    return request.id
  end
  return fallback_id or "cmd_invalid"
end

local function undo_result(request)
  local undo = is_object(request and request.undo) and request.undo or {}
  local mode = is_string(undo.mode) and undo.mode or "none"
  return {
    mode = mode,
    opened = false,
    closed = false,
    label = is_string(undo.label) and undo.label or JSON_NULL,
  }
end

local function verification_result(request, status)
  local verification = is_object(request and request.verification) and request.verification or {}
  return {
    mode = is_string(verification.mode) and verification.mode or "none",
    status = status,
    checks = is_json_array(verification.checks) and verification.checks or json_array({}),
  }
end

local function idempotency_result(request)
  return {
    key = is_string(request and request.idempotency_key) and request.idempotency_key or JSON_NULL,
    replayed = false,
  }
end

local function finalize_json_with_budget(envelope)
  local last_length = -1
  local encoded = nil
  for _ = 1, 8 do
    envelope.budget.response_bytes = math.max(last_length, 0)
    encoded = json.encode(envelope)
    local length = #encoded
    if length == last_length then
      return encoded
    end
    last_length = length
  end
  envelope.budget.response_bytes = #json.encode(envelope)
  return json.encode(envelope)
end

local function bridge_error_envelope(request, code, message, options)
  options = options or {}
  local completed_at = now_iso()
  local budget = safe_budget(request)
  local envelope = {
    contract = CONTRACT,
    id = envelope_id(request, options.fallback_id),
    ok = false,
    completed_at = completed_at,
    bridge = {
      owner = ACTIVE_OWNER,
      generation = ACTIVE_GENERATION,
    },
    queue = {
      state = options.queue_state or "failed",
      started_at = options.started_at or completed_at,
      completed_at = completed_at,
    },
    error = {
      code = code,
      message = message,
      recoverable = options.recoverable ~= false,
      details = options.details or {},
    },
    undo = undo_result(request),
    verification = verification_result(request, options.verification_status or "skipped"),
    budget = {
      max_response_bytes = budget.max_response_bytes,
      response_bytes = 0,
      truncated = false,
    },
    idempotency = idempotency_result(request),
  }
  return finalize_json_with_budget(envelope)
end

local function bridge_ok_envelope(request, started_at, summary, artifacts)
  local completed_at = now_iso()
  local budget = safe_budget(request)
  local envelope = {
    contract = CONTRACT,
    id = request.id,
    ok = true,
    completed_at = completed_at,
    bridge = {
      owner = ACTIVE_OWNER,
      generation = ACTIVE_GENERATION,
    },
    queue = {
      state = "done",
      started_at = started_at,
      completed_at = completed_at,
    },
    result = {
      summary = summary or {},
      refs = json_array({}),
      artifacts = artifacts or json_array({}),
      jobs = json_array({}),
      last_result = {
        updated = false,
        refs = json_array({}),
        truncated = false,
      },
    },
    undo = undo_result(request),
    verification = verification_result(request, "passed"),
    budget = {
      max_response_bytes = budget.max_response_bytes,
      response_bytes = 0,
      truncated = false,
    },
    idempotency = idempotency_result(request),
  }
  local encoded = finalize_json_with_budget(envelope)
  if #encoded > budget.max_response_bytes then
    return bridge_error_envelope(request, "RESPONSE_TOO_LARGE", "Bridge response exceeded request budget.", {
      recoverable = true,
      started_at = started_at,
      details = {
        response_bytes = #encoded,
        max_response_bytes = budget.max_response_bytes,
      },
    })
  end
  return encoded
end

local FIXED_FAMILIES = {
  query_state = true,
  run_command = true,
  run_action = true,
  run_job = true,
  artifact_metadata = true,
}

local FIXED_PACKS = {
  core = true,
  project = true,
  transport = true,
  tracks = true,
  items = true,
  media = true,
  analysis = true,
  midi = true,
  fx = true,
  routing = true,
  automation = true,
  render = true,
  actions = true,
  ui = true,
  system = true,
  hardware_control = true,
}

local WORKFLOW_SHAPED_IDS = {
  loop = true,
  cleanup = true,
  delivery = true,
  layer = true,
  music_sketch = true,
}

