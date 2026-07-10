local function process_request_file(filename)
  local fallback_id = result_id_from_filename(filename)
  local result_path = path_join(RESULTS_DIR, fallback_id .. ".json")
  if file_exists(result_path) then
    return
  end

  local request_path = path_join(REQUESTS_DIR, filename)
  local raw, read_error = read_file(request_path)
  if not raw then
    local result_json = bridge_error_envelope(nil, "REQUEST_INVALID", "Bridge request could not be read.", {
      fallback_id = fallback_id,
      recoverable = true,
      details = { message = read_error },
    })
    write_file_atomic(result_path, result_json .. "\n")
    return
  end

  local decoded_ok, request_or_error = pcall(json.decode, raw)
  if not decoded_ok then
    local result_json = bridge_error_envelope(nil, "REQUEST_INVALID", "Bridge request JSON is malformed.", {
      fallback_id = fallback_id,
      recoverable = true,
      details = { message = bounded_string(request_or_error, 240) },
    })
    write_file_atomic(result_path, result_json .. "\n")
    return
  end

  local parsed_id = is_request_id(request_or_error.id) and request_or_error.id or fallback_id
  local parsed_result_path = path_join(RESULTS_DIR, parsed_id .. ".json")
  if file_exists(parsed_result_path) then
    return
  end
  local result_json = dispatch_request(request_or_error, fallback_id)
  local ok, write_error = write_file_atomic(parsed_result_path, result_json .. "\n")
  if not ok then
    log("could not write result for " .. tostring(parsed_id) .. ": " .. tostring(write_error))
  end
end

local function poll_once()
  if not REQUESTS_DIR or not RESULTS_DIR then
    return
  end
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(REQUESTS_DIR, index)
    if not filename then
      break
    end
    if filename:match("%.json$") then
      process_request_file(filename)
    end
    index = index + 1
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
  local heartbeat_ok, heartbeat_error = write_bridge_heartbeat()
  if not heartbeat_ok then
    log("startup heartbeat failed: " .. tostring(heartbeat_error))
  end
  next_heartbeat_at = monotonic_time() + HEARTBEAT_INTERVAL_SECONDS
  log("started manual bridge loop at " .. TRANSPORT_DIR .. " owner=" .. ACTIVE_OWNER .. " generation=" .. tostring(ACTIVE_GENERATION))
  bridge_loop()
end
