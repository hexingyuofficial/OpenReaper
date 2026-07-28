local completed_request_files = {}
local startup_orphan_claims = {}
local pending_result_writes = {}
local active_continuation_runner = nil
local BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"

local function claim_path_for(filename)
  return path_join(CLAIMS_DIR, filename)
end

local function finish_claim(filename)
  startup_orphan_claims[filename] = nil
  pending_result_writes[filename] = nil
  if active_continuation_runner and active_continuation_runner.filename == filename then
    active_continuation_runner = nil
  end
  os.remove(claim_path_for(filename))
end

local function write_terminal_result(filename, result_path, result_json, result_id)
  if file_exists(result_path) then
    finish_claim(filename)
    completed_request_files[filename] = true
    return true
  end
  -- A long synchronous handler can block reaper.defer long enough for the
  -- next client dispatch to observe a stale heartbeat. Refresh before the
  -- terminal result becomes visible so its consumer cannot race the refresh.
  local heartbeat_ok, heartbeat_error = write_bridge_heartbeat()
  if not heartbeat_ok then
    log("heartbeat refresh before result failed: " .. tostring(heartbeat_error))
  end
  local ok, write_error = write_file_atomic(result_path, result_json .. "\n")
  if ok then
    finish_claim(filename)
    completed_request_files[filename] = true
    return true
  end
  pending_result_writes[filename] = {
    result_path = result_path,
    result_json = result_json,
    result_id = result_id,
  }
  log("could not write result for " .. tostring(result_id) .. ": " .. tostring(write_error))
  return false
end

local function retry_pending_result_writes()
  for filename, pending in pairs(pending_result_writes) do
    write_terminal_result(filename, pending.result_path, pending.result_json, pending.result_id)
  end
end

local function snapshot_startup_orphan_claims()
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(CLAIMS_DIR, index)
    if not filename then
      break
    end
    if filename:match("%.json$") then
      startup_orphan_claims[filename] = true
    end
    index = index + 1
  end
end

local function recover_startup_orphan_claims()
  for filename in pairs(startup_orphan_claims) do
    if not pending_result_writes[filename] then
      local claim_path = claim_path_for(filename)
      local fallback_id = result_id_from_filename(filename)
      local raw = read_file(claim_path)
      local decoded_ok, request = pcall(json.decode, raw or "")
      local request_valid = decoded_ok and is_object(request)
      local parsed_id = request_valid and is_request_id(request.id) and request.id or fallback_id
      local result_path = path_join(RESULTS_DIR, parsed_id .. ".json")
      if file_exists(result_path) then
        finish_claim(filename)
        completed_request_files[filename] = true
      else
        local result_json = bridge_error_envelope(request_valid and request or nil, "INTERNAL_ERROR", "A previously claimed bridge request was orphaned before its terminal result was durable.", {
          fallback_id = fallback_id,
          recoverable = false,
          details = {
            reason = "orphaned_request_after_bridge_restart",
            outcome = "unknown",
            next_action = "Inspect live project state before deciding whether any mutation should be retried.",
          },
        })
        write_terminal_result(filename, result_path, result_json, parsed_id)
      end
    end
  end
end

local function is_internal_continuation_result(result)
  return type(result) == "table"
    and result.contract == BRIDGE_INTERNAL_CONTINUATION_CONTRACT
    and type(result.phase) == "string"
    and result.phase ~= ""
    and type(result.state) == "table"
    and type(result.mutations_may_have_happened) == "boolean"
    and type(result.next_phase_may_mutate) == "boolean"
end

local function monotonic_now()
  if reaper and type(reaper.time_precise) == "function" then
    return reaper.time_precise()
  end
  return os.clock()
end

local function process_request_file(filename)
  local fallback_id = result_id_from_filename(filename)
  local result_path = path_join(RESULTS_DIR, fallback_id .. ".json")
  if file_exists(result_path) then
    return true
  end

  if pending_result_writes[filename] then
    return write_terminal_result(filename, pending_result_writes[filename].result_path, pending_result_writes[filename].result_json, pending_result_writes[filename].result_id)
  end

  if active_continuation_runner and active_continuation_runner.filename ~= filename then
    return false
  end

  local request_path = path_join(REQUESTS_DIR, filename)
  local claim_path = claim_path_for(filename)
  local request = nil
  local parsed_id = fallback_id
  local parsed_result_path = result_path
  local resume_continuation = nil
  local runtime = nil

  if active_continuation_runner and active_continuation_runner.filename == filename then
    request = active_continuation_runner.request
    parsed_id = active_continuation_runner.request_id
    parsed_result_path = active_continuation_runner.result_path
    resume_continuation = active_continuation_runner.continuation
    runtime = {
      started_at = active_continuation_runner.started_at,
      deadline_monotonic = active_continuation_runner.deadline_monotonic,
      now_monotonic = monotonic_now(),
    }
    if file_exists(parsed_result_path) then
      finish_claim(filename)
      completed_request_files[filename] = true
      return true
    end
  else
    local raw, read_error = read_file(request_path)
    if not raw then
      local result_json = bridge_error_envelope(nil, "REQUEST_INVALID", "Bridge request could not be read.", {
        fallback_id = fallback_id,
        recoverable = true,
        details = { message = read_error },
      })
      return write_terminal_result(filename, result_path, result_json, fallback_id)
    end

    local decoded_ok, request_or_error = pcall(json.decode, raw)
    if not decoded_ok then
      local result_json = bridge_error_envelope(nil, "REQUEST_INVALID", "Bridge request JSON is malformed.", {
        fallback_id = fallback_id,
        recoverable = true,
        details = { message = bounded_string(request_or_error, 240) },
      })
      return write_terminal_result(filename, result_path, result_json, fallback_id)
    end

    request = request_or_error
    parsed_id = is_request_id(request.id) and request.id or fallback_id
    if parsed_id ~= fallback_id then
      local result_json = bridge_error_envelope(request, "REQUEST_INVALID", "Bridge request id must match its transport filename.", {
        fallback_id = fallback_id,
        recoverable = false,
        details = { filename_id = fallback_id, request_id = parsed_id },
      })
      return write_terminal_result(filename, result_path, result_json, fallback_id)
    end
    parsed_result_path = path_join(RESULTS_DIR, parsed_id .. ".json")
    if file_exists(parsed_result_path) then
      return true
    end
    if file_exists(claim_path) then
      log("request claim already exists for " .. tostring(parsed_id))
      return false
    end
    local claimed, claim_error = write_file_atomic(claim_path, raw)
    if not claimed then
      log("could not claim request " .. tostring(parsed_id) .. ": " .. tostring(claim_error or "claim_write_failed"))
      return false
    end
    local timeout_ms = type(request.timeout_ms) == "number" and request.timeout_ms or 5000
    runtime = {
      started_at = now_iso(),
      deadline_monotonic = monotonic_now() + (timeout_ms / 1000),
      now_monotonic = monotonic_now(),
    }
  end

  local dispatch_ok, dispatch_result = pcall(dispatch_request, request, fallback_id, resume_continuation, runtime)
  if not dispatch_ok then
    local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
    local result_json = bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge dispatch failed before a terminal result.", {
      fallback_id = fallback_id,
      recoverable = false,
      started_at = runtime and runtime.started_at or nil,
      details = {
        message = bounded_string(dispatch_result, 240),
        outcome = mutated and "unknown" or nil,
        next_action = mutated and "Inspect live project state before deciding whether any mutation should be retried." or nil,
      },
    })
    return write_terminal_result(filename, parsed_result_path, result_json, parsed_id)
  end

  if type(dispatch_result) == "table" and dispatch_result.contract == BRIDGE_INTERNAL_CONTINUATION_CONTRACT then
    if not is_internal_continuation_result(dispatch_result) then
      local mutated = (resume_continuation and resume_continuation.mutations_may_have_happened == true)
        or (dispatch_result.mutations_may_have_happened == true)
      local result_json = bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge continuation payload is malformed.", {
        fallback_id = fallback_id,
        recoverable = false,
        started_at = runtime and runtime.started_at or nil,
        details = {
          reason = "malformed_internal_continuation",
          outcome = mutated and "unknown" or nil,
          next_action = mutated and "Inspect live project state before deciding whether any mutation should be retried." or nil,
        },
      })
      return write_terminal_result(filename, parsed_result_path, result_json, parsed_id)
    end
    active_continuation_runner = {
      filename = filename,
      request = request,
      request_id = parsed_id,
      result_path = parsed_result_path,
      started_at = dispatch_result.started_at or (runtime and runtime.started_at) or now_iso(),
      deadline_monotonic = runtime and runtime.deadline_monotonic or (monotonic_now() + 5),
      continuation = {
        contract = BRIDGE_INTERNAL_CONTINUATION_CONTRACT,
        phase = dispatch_result.phase,
        state = dispatch_result.state or {},
        mutations_may_have_happened = dispatch_result.mutations_may_have_happened == true,
        next_phase_may_mutate = dispatch_result.next_phase_may_mutate == true,
      },
    }
    return false
  end

  if type(dispatch_result) ~= "string" then
    local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
    local result_json = bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge dispatch returned a non-terminal non-continuation value.", {
      fallback_id = fallback_id,
      recoverable = false,
      started_at = runtime and runtime.started_at or nil,
      details = {
        reason = "malformed_dispatch_result",
        outcome = mutated and "unknown" or nil,
        next_action = mutated and "Inspect live project state before deciding whether any mutation should be retried." or nil,
      },
    })
    return write_terminal_result(filename, parsed_result_path, result_json, parsed_id)
  end

  return write_terminal_result(filename, parsed_result_path, dispatch_result, parsed_id)
end

local function poll_once()
  if not REQUESTS_DIR or not RESULTS_DIR then
    return
  end
  retry_pending_result_writes()
  recover_startup_orphan_claims()
  local request_filenames = {}
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(REQUESTS_DIR, index)
    if not filename then
      break
    end
    if filename:match("%.json$") then
      request_filenames[#request_filenames + 1] = filename
    end
    index = index + 1
  end
  table.sort(request_filenames)
  for _, filename in ipairs(request_filenames) do
    if not completed_request_files[filename] then
      if process_request_file(filename) then
        completed_request_files[filename] = true
      end
      -- Process one request per defer tick so the bridge heartbeat can refresh
      -- between queued native calls instead of going stale for the whole batch.
      return
    end
  end
end

local next_poll_at = 0
local next_heartbeat_at = 0

local function monotonic_time()
  return monotonic_now()
end

local function bridge_loop()
  local current_time = monotonic_time()
  if current_time >= next_heartbeat_at then
    next_heartbeat_at = current_time + HEARTBEAT_INTERVAL_SECONDS
    local heartbeat_ok, heartbeat_error = write_bridge_heartbeat()
    if not heartbeat_ok then
      log("heartbeat refresh failed: " .. tostring(heartbeat_error))
    end
  end
  if current_time >= next_poll_at then
    next_poll_at = current_time + POLL_INTERVAL_SECONDS
    local ok, error_message = pcall(poll_once)
    if not ok then
      log("poll failed: " .. tostring(error_message))
    end
  end
  reaper.defer(bridge_loop)
end

math.randomseed(os.time())

if not TRANSPORT_DIR then
  log("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR is not set; bridge loop not started.")
elseif not reaper or type(reaper.defer) ~= "function" or type(reaper.EnumerateFiles) ~= "function" then
  log("required REAPER defer/file APIs are unavailable; bridge loop not started.")
else
  local claims_ok, claims_error = ensure_directory(CLAIMS_DIR)
  if not claims_ok then
    log("could not initialize durable request claims: " .. tostring(claims_error))
    return
  end
  snapshot_startup_orphan_claims()
  local heartbeat_ok, heartbeat_error = write_bridge_heartbeat()
  if not heartbeat_ok then
    log("startup heartbeat failed: " .. tostring(heartbeat_error))
  end
  next_heartbeat_at = monotonic_time() + HEARTBEAT_INTERVAL_SECONDS
  log("started manual bridge loop at " .. TRANSPORT_DIR .. " owner=" .. ACTIVE_OWNER .. " generation=" .. tostring(ACTIVE_GENERATION))
  bridge_loop()
end
