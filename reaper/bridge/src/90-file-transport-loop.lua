local completed_request_files = {}
local startup_orphan_claims = {}
local pending_result_writes = {}

local function claim_path_for(filename)
  return path_join(CLAIMS_DIR, filename)
end

local function finish_claim(filename)
  startup_orphan_claims[filename] = nil
  pending_result_writes[filename] = nil
  os.remove(claim_path_for(filename))
end

local function write_terminal_result(filename, result_path, result_json, result_id)
  if file_exists(result_path) then
    finish_claim(filename)
    completed_request_files[filename] = true
    return true
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

local function process_request_file(filename)
  local fallback_id = result_id_from_filename(filename)
  local result_path = path_join(RESULTS_DIR, fallback_id .. ".json")
  if file_exists(result_path) then
    return true
  end

  local request_path = path_join(REQUESTS_DIR, filename)
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

  local parsed_id = is_request_id(request_or_error.id) and request_or_error.id or fallback_id
  if parsed_id ~= fallback_id then
    local result_json = bridge_error_envelope(request_or_error, "REQUEST_INVALID", "Bridge request id must match its transport filename.", {
      fallback_id = fallback_id,
      recoverable = false,
      details = { filename_id = fallback_id, request_id = parsed_id },
    })
    return write_terminal_result(filename, result_path, result_json, fallback_id)
  end
  local parsed_result_path = path_join(RESULTS_DIR, parsed_id .. ".json")
  if file_exists(parsed_result_path) then
    return true
  end
  local claim_path = claim_path_for(filename)
  if file_exists(claim_path) then
    log("request claim already exists for " .. tostring(parsed_id))
    return false
  end
  local claimed, claim_error = write_file_atomic(claim_path, raw)
  if not claimed then
    log("could not claim request " .. tostring(parsed_id) .. ": " .. tostring(claim_error or "claim_write_failed"))
    return false
  end
  local result_json = dispatch_request(request_or_error, fallback_id)
  return write_terminal_result(filename, parsed_result_path, result_json, parsed_id)
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
  for _, filename in ipairs(request_filenames) do
    if not completed_request_files[filename] and process_request_file(filename) then
      completed_request_files[filename] = true
    end
  end
end

local next_poll_at = 0
local next_heartbeat_at = 0

local function monotonic_time()
  if reaper and type(reaper.time_precise) == "function" then
    return reaper.time_precise()
  end
  return os.clock()
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
