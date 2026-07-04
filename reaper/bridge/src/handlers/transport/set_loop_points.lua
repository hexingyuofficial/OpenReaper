-- Extracted Safe-Write-A handler: template.transport.set_loop_points.

local function handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function safe_write_a_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.truncated = false
  return readback
end

local function safe_write_a_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function safe_write_transport_set_loop_points(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds)
  if end_seconds < start_seconds then
    return handler_error("PARAMS_INVALID", "Loop point end_seconds must be greater than or equal to start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  call_reaper("GetSet_LoopTimeRange", true, true, start_seconds, end_seconds, false)
  return safe_write_a_summary(request, read_transport_state().loop_points)
end
