-- OpenReaper 4D.x minimal live bridge loop.
-- Manual REAPER-side script: polls file transport requests and writes
-- foundation.bridge.v1 results for approved read-only live-smoke handlers.

local CONTRACT = "foundation.bridge.v1"
local TRANSPORT_ENV = "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
local OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER"
local GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION"
local DEFAULT_OWNER = "openreaper-live-smoke"
local DEFAULT_GENERATION = 1
local DEFAULT_BUDGET = {
  max_response_bytes = 65536,
  max_items = 50,
  max_inline_value_bytes = 2048,
}
local POLL_INTERVAL_SECONDS = 0.10
local SCRIPT_NAME = "openreaper-live-bridge.lua"

local JSON_NULL = {}
local JSON_ARRAY_MT = { __openreaper_json_array = true }

local function json_array(values)
  return setmetatable(values or {}, JSON_ARRAY_MT)
end

local function is_json_array(value)
  return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT
end

local json = {}

local function parse_error(message, position)
  error((message or "invalid JSON") .. " at byte " .. tostring(position), 0)
end

local function skip_ws(source, position)
  local _, next_position = source:find("^[ \n\r\t]*", position)
  return (next_position or (position - 1)) + 1
end

local function parse_string(source, position)
  if source:sub(position, position) ~= '"' then
    parse_error("expected string", position)
  end
  position = position + 1
  local parts = {}
  while position <= #source do
    local char = source:sub(position, position)
    if char == '"' then
      return table.concat(parts), position + 1
    end
    if char == "\\" then
      local escaped = source:sub(position + 1, position + 1)
      if escaped == '"' or escaped == "\\" or escaped == "/" then
        parts[#parts + 1] = escaped
        position = position + 2
      elseif escaped == "b" then
        parts[#parts + 1] = "\b"
        position = position + 2
      elseif escaped == "f" then
        parts[#parts + 1] = "\f"
        position = position + 2
      elseif escaped == "n" then
        parts[#parts + 1] = "\n"
        position = position + 2
      elseif escaped == "r" then
        parts[#parts + 1] = "\r"
        position = position + 2
      elseif escaped == "t" then
        parts[#parts + 1] = "\t"
        position = position + 2
      elseif escaped == "u" then
        local hex = source:sub(position + 2, position + 5)
        if not hex:match("^[0-9a-fA-F][0-9a-fA-F][0-9a-fA-F][0-9a-fA-F]$") then
          parse_error("invalid unicode escape", position)
        end
        local codepoint = tonumber(hex, 16)
        if utf8 and utf8.char then
          parts[#parts + 1] = utf8.char(codepoint)
        elseif codepoint <= 127 then
          parts[#parts + 1] = string.char(codepoint)
        else
          parts[#parts + 1] = "?"
        end
        position = position + 6
      else
        parse_error("invalid string escape", position)
      end
    else
      parts[#parts + 1] = char
      position = position + 1
    end
  end
  parse_error("unterminated string", position)
end

local parse_value

local function parse_number(source, position)
  local start_position = position
  if source:sub(position, position) == "-" then
    position = position + 1
  end
  local digit = source:sub(position, position)
  if digit == "0" then
    position = position + 1
  elseif digit:match("%d") then
    repeat
      position = position + 1
      digit = source:sub(position, position)
    until not digit:match("%d")
  else
    parse_error("invalid number", position)
  end
  if source:sub(position, position) == "." then
    position = position + 1
    if not source:sub(position, position):match("%d") then
      parse_error("invalid number fraction", position)
    end
    repeat
      position = position + 1
      digit = source:sub(position, position)
    until not digit:match("%d")
  end
  local exponent = source:sub(position, position)
  if exponent == "e" or exponent == "E" then
    position = position + 1
    local sign = source:sub(position, position)
    if sign == "+" or sign == "-" then
      position = position + 1
    end
    if not source:sub(position, position):match("%d") then
      parse_error("invalid number exponent", position)
    end
    repeat
      position = position + 1
      digit = source:sub(position, position)
    until not digit:match("%d")
  end
  local value = tonumber(source:sub(start_position, position - 1))
  if value == nil then
    parse_error("invalid number", start_position)
  end
  return value, position
end

local function parse_array(source, position)
  local result = json_array({})
  position = skip_ws(source, position + 1)
  if source:sub(position, position) == "]" then
    return result, position + 1
  end
  while true do
    local value
    value, position = parse_value(source, position)
    result[#result + 1] = value
    position = skip_ws(source, position)
    local char = source:sub(position, position)
    if char == "]" then
      return result, position + 1
    end
    if char ~= "," then
      parse_error("expected comma or array end", position)
    end
    position = skip_ws(source, position + 1)
  end
end

local function parse_object(source, position)
  local result = {}
  position = skip_ws(source, position + 1)
  if source:sub(position, position) == "}" then
    return result, position + 1
  end
  while true do
    local key
    key, position = parse_string(source, position)
    position = skip_ws(source, position)
    if source:sub(position, position) ~= ":" then
      parse_error("expected object colon", position)
    end
    local value
    value, position = parse_value(source, skip_ws(source, position + 1))
    result[key] = value
    position = skip_ws(source, position)
    local char = source:sub(position, position)
    if char == "}" then
      return result, position + 1
    end
    if char ~= "," then
      parse_error("expected comma or object end", position)
    end
    position = skip_ws(source, position + 1)
  end
end

function parse_value(source, position)
  position = skip_ws(source, position)
  local char = source:sub(position, position)
  if char == '"' then
    return parse_string(source, position)
  elseif char == "{" then
    return parse_object(source, position)
  elseif char == "[" then
    return parse_array(source, position)
  elseif char == "-" or char:match("%d") then
    return parse_number(source, position)
  elseif source:sub(position, position + 3) == "true" then
    return true, position + 4
  elseif source:sub(position, position + 4) == "false" then
    return false, position + 5
  elseif source:sub(position, position + 3) == "null" then
    return JSON_NULL, position + 4
  end
  parse_error("unexpected JSON value", position)
end

function json.decode(source)
  if type(source) ~= "string" then
    error("JSON input must be a string", 0)
  end
  local value, position = parse_value(source, 1)
  position = skip_ws(source, position)
  if position <= #source then
    parse_error("unexpected trailing JSON", position)
  end
  return value
end

local ESCAPES = {
  ['"'] = '\\"',
  ["\\"] = "\\\\",
  ["\b"] = "\\b",
  ["\f"] = "\\f",
  ["\n"] = "\\n",
  ["\r"] = "\\r",
  ["\t"] = "\\t",
}

local function encode_string(value)
  return '"' .. value:gsub('[%c\\"]', function(char)
    return ESCAPES[char] or string.format("\\u%04x", char:byte())
  end) .. '"'
end

local function is_finite_number(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local encode_value

local function encode_array(value)
  local parts = {}
  for index = 1, #value do
    parts[#parts + 1] = encode_value(value[index])
  end
  return "[" .. table.concat(parts, ",") .. "]"
end

local function encode_object(value)
  local keys = {}
  for key, nested in pairs(value) do
    if type(key) == "string" and nested ~= nil then
      keys[#keys + 1] = key
    end
  end
  table.sort(keys)
  local parts = {}
  for _, key in ipairs(keys) do
    parts[#parts + 1] = encode_string(key) .. ":" .. encode_value(value[key])
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

function encode_value(value)
  local value_type = type(value)
  if value == JSON_NULL or value_type == "nil" then
    return "null"
  elseif value_type == "string" then
    return encode_string(value)
  elseif value_type == "number" then
    return is_finite_number(value) and tostring(value) or "null"
  elseif value_type == "boolean" then
    return value and "true" or "false"
  elseif value_type == "table" then
    return is_json_array(value) and encode_array(value) or encode_object(value)
  end
  return "null"
end

function json.encode(value)
  return encode_value(value)
end

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function non_empty(value)
  if type(value) ~= "string" then
    return nil
  end
  local trimmed = value:match("^%s*(.-)%s*$")
  if trimmed == "" then
    return nil
  end
  return trimmed
end

local function parse_generation(value)
  local number = tonumber(value)
  if number == nil or number < 0 or number ~= math.floor(number) then
    return DEFAULT_GENERATION
  end
  return number
end

local ACTIVE_OWNER = non_empty(os.getenv(OWNER_ENV)) or DEFAULT_OWNER
local ACTIVE_GENERATION = parse_generation(os.getenv(GENERATION_ENV))

local function path_separator(path)
  return type(path) == "string" and path:find("\\", 1, true) and "\\" or "/"
end

local function path_join(base, child)
  local separator = path_separator(base)
  if base:sub(-1) == "/" or base:sub(-1) == "\\" then
    return base .. child
  end
  return base .. separator .. child
end

local function dirname(path)
  if type(path) ~= "string" then
    return ""
  end
  local normalized = path:gsub("\\", "/")
  return normalized:match("^(.*)/[^/]*$") or ""
end

local function file_exists(path)
  local handle = io.open(path, "rb")
  if handle then
    handle:close()
    return true
  end
  return false
end

local function read_file(path)
  local handle = io.open(path, "rb")
  if not handle then
    return nil, "open_failed"
  end
  local content = handle:read("*a")
  handle:close()
  return content
end

local function write_file_atomic(path, content)
  local temp_path = path .. ".tmp." .. tostring(math.floor((os.time() or 0))) .. "." .. tostring(math.random(100000, 999999))
  local handle = io.open(temp_path, "wb")
  if not handle then
    return false, "temp_open_failed"
  end
  local ok, write_error = handle:write(content)
  handle:flush()
  handle:close()
  if not ok then
    os.remove(temp_path)
    return false, tostring(write_error or "write_failed")
  end
  local renamed, rename_error = os.rename(temp_path, path)
  if not renamed then
    os.remove(temp_path)
    return false, tostring(rename_error or "rename_failed")
  end
  return true
end

local function log(message)
  if reaper and type(reaper.ShowConsoleMsg) == "function" then
    reaper.ShowConsoleMsg("[OpenReaper live bridge] " .. tostring(message) .. "\n")
  end
end

local function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then
    return false
  end
  return pcall(reaper[name], ...)
end

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

local function bridge_ok_envelope(request, started_at, summary)
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
      artifacts = json_array({}),
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

local function validate_request(request)
  if not is_object(request) then
    return false, "Bridge request must be an object."
  end
  if request.contract ~= CONTRACT then
    return false, "Bridge request contract must be foundation.bridge.v1."
  end
  if not is_request_id(request.id) then
    return false, "id must be a cmd_ request id."
  end
  if not is_string(request.created_at) then
    return false, "created_at must be a non-empty string."
  end
  if not is_object(request.client) or not is_string(request.client.id) or not is_string(request.client.session_id) then
    return false, "client.id and client.session_id are required."
  end
  if not is_object(request.bridge) or not is_string(request.bridge.expected_owner) then
    return false, "bridge.expected_owner is required."
  end
  if not is_non_negative_integer(request.bridge.expected_generation) then
    return false, "bridge.expected_generation must be a non-negative integer."
  end
  if not is_object(request.operation) or not is_string(request.operation.family) or not is_string(request.operation.name) then
    return false, "operation.family and operation.name are required."
  end
  if not FIXED_FAMILIES[request.operation.family] then
    return false, "operation.family is outside foundation.bridge.v1."
  end
  if not is_object(request.pack) or not FIXED_PACKS[request.pack.id] or not is_string(request.pack.capability) or not is_string(request.pack.risk) then
    return false, "pack.id, pack.capability, and pack.risk are required."
  end
  if request.pack.risk ~= "read" then
    return false, "OpenReaper live bridge accepts read-only live-smoke requests only."
  end
  if not is_object(request.params) then
    return false, "params must be a JSON object."
  end
  if not is_json_array(request.refs) then
    return false, "refs must be a JSON array."
  end
  if not is_object(request.undo) or request.undo.mode ~= "none" then
    return false, "read-only live-smoke requests must use undo.mode none."
  end
  if not is_object(request.verification) or not is_string(request.verification.mode) then
    return false, "verification.mode is required."
  end
  if request.verification.checks ~= nil and request.verification.checks ~= JSON_NULL and not is_json_array(request.verification.checks) then
    return false, "verification.checks must be a JSON array."
  end
  if not is_object(request.artifacts) or type(request.artifacts.allow) ~= "boolean" then
    return false, "artifacts.allow must be a boolean."
  end
  if request.artifacts.allow ~= false then
    return false, "Read-only live-smoke handlers do not write artifacts."
  end
  local budget = request.budget
  if not is_object(budget)
    or not (is_non_negative_integer(budget.max_response_bytes) and budget.max_response_bytes > 0)
    or not (is_non_negative_integer(budget.max_items) and budget.max_items > 0)
    or not (is_non_negative_integer(budget.max_inline_value_bytes) and budget.max_inline_value_bytes > 0) then
    return false, "budget must include positive integer limits."
  end
  if not (is_non_negative_integer(request.timeout_ms) and request.timeout_ms > 0) then
    return false, "timeout_ms must be a positive integer."
  end
  if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL then
    return false, "read-only live-smoke requests must not carry idempotency_key."
  end
  return true
end

local function current_project()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0, bounded_string(project_path or "", 240)
  end
  return 0, ""
end

local function read_project_summary(request)
  local project, project_path = current_project()
  local ok_name, name_a, name_b = call_reaper("GetProjectName", project, "")
  local ok_length, project_length = call_reaper("GetProjectLength", project)
  local ok_tracks, track_count = call_reaper("CountTracks", project)
  local ok_items, item_count = call_reaper("CountMediaItems", project)
  local ok_markers, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local ok_changes, change_count = call_reaper("GetProjectStateChangeCount", project)
  local ok_sample_rate, sample_rate = call_reaper("GetSetProjectInfo", project, "PROJECT_SRATE", 0, false)
  local include_counts = request.params.include_counts == true

  local summary = {
    kind = "project_summary",
    project_ref = "project:current",
    name = bounded_string((ok_name and first_string(name_a, name_b)) or "current", 160),
    path = bounded_string(project_path or "", 240),
    length_seconds = ok_length and first_number(project_length) or nil,
    sample_rate = ok_sample_rate and first_number(sample_rate) or nil,
    truncated = false,
  }
  if include_counts then
    summary.track_count = ok_tracks and first_number(track_count) or 0
    summary.item_count = ok_items and first_number(item_count) or 0
    summary.marker_count = ok_markers and first_number(marker_count) or 0
    summary.region_count = ok_markers and first_number(region_count) or 0
    summary.change_count = ok_changes and first_number(change_count) or 0
  end
  return summary
end

local function has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function play_state_label(value)
  if has_flag(value, 4) then
    return "recording"
  elseif has_flag(value, 1) then
    return "playing"
  elseif has_flag(value, 2) then
    return "paused"
  elseif type(value) == "number" then
    return "stopped"
  end
  return "unknown"
end

local function loop_time_range(is_loop)
  local ok, start_time, end_time = call_reaper("GetSet_LoopTimeRange", false, is_loop, 0, 0, false)
  if ok and type(start_time) == "number" and type(end_time) == "number" then
    return {
      start_seconds = start_time,
      end_seconds = end_time,
      active = end_time > start_time,
    }
  end
  return {
    start_seconds = 0,
    end_seconds = 0,
    active = false,
  }
end

local function read_transport_state()
  local ok_play_state, play_state = call_reaper("GetPlayState")
  local ok_cursor, edit_cursor = call_reaper("GetCursorPosition")
  local ok_play_position, play_position = call_reaper("GetPlayPosition")
  local ok_repeat, repeat_state = call_reaper("GetSetRepeat", -1)
  return {
    kind = "transport_state",
    play_state = play_state_label(ok_play_state and play_state or nil),
    edit_cursor_seconds = ok_cursor and first_number(edit_cursor) or 0,
    play_cursor_seconds = ok_play_position and first_number(play_position) or 0,
    repeat_enabled = ok_repeat and first_number(repeat_state) == 1 or false,
    time_selection = loop_time_range(false),
    loop_points = loop_time_range(true),
    truncated = false,
  }
end

local function read_openreaper_status(request)
  local include_contracts = request.params.include_contracts == true
  local include_pack_status = request.params.include_pack_status == true
  local include_catalog_status = request.params.include_catalog_status == true
  return {
    status = "ok",
    bridge = {
      owner = ACTIVE_OWNER,
      generation = ACTIVE_GENERATION,
      transport = "file_transport",
      script = SCRIPT_NAME,
      wave = "wave0-plus-wave1a-read-handlers",
      spawned_reaper = false,
    },
    contracts = include_contracts and {
      bridge = CONTRACT,
      executor = "live_bridge.executor.v1",
    } or nil,
    enabled_packs = include_pack_status and json_array({ "project", "transport", "core", "system" }) or json_array({}),
    catalog = include_catalog_status and {
      accepted_official_catalog = true,
      wave0_canary_count = 5,
      wave1a_read_handler_count = 9,
    } or nil,
    warnings = json_array({}),
    truncated = false,
  }
end

local function read_runtime_environment(request)
  local ok_version, version = call_reaper("GetAppVersion")
  local ok_os, os_name = call_reaper("GetOS")
  local ok_exe, exe_path = call_reaper("GetExePath")
  return {
    reaper_version = bounded_string(ok_version and first_string(version) or "unknown", 120),
    os = bounded_string(ok_os and first_string(os_name) or "unknown", 120),
    executable_path = request.params.include_bridge_runtime == true and bounded_string(ok_exe and first_string(exe_path) or "", 240) or nil,
    bridge_runtime = request.params.include_bridge_runtime == true and "manual_reaper_defer_file_transport" or nil,
    queue_override_present = non_empty(os.getenv(TRANSPORT_ENV)) ~= nil,
    runtime_flags = request.params.include_runtime_flags == true and {
      spawned_reaper = false,
      writes_project = false,
      process_spawn = false,
    } or {},
  }
end

local TRANSPORT_DIR = non_empty(os.getenv(TRANSPORT_ENV))
local REQUESTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "requests") or nil
local RESULTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "results") or nil

local function current_script_dir()
  if debug and type(debug.getinfo) == "function" then
    local info = debug.getinfo(1, "S")
    if info and type(info.source) == "string" then
      return dirname(info.source:gsub("^@", ""))
    end
  end
  return ""
end

local function read_resource_paths(request)
  local ok_resource, resource_path = call_reaper("GetResourcePath")
  local ok_exe, exe_path = call_reaper("GetExePath")
  local include_queue_paths = request.params.include_queue_paths == true
  return {
    resource_path = bounded_string(ok_resource and first_string(resource_path) or "", 240),
    executable_path = bounded_string(ok_exe and first_string(exe_path) or "", 240),
    bridge_script_dir = request.params.include_script_path == true and current_script_dir() or nil,
    queue_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    transport_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    requests_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    results_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    pending_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    done_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    queue_override_present = TRANSPORT_DIR ~= nil,
  }
end

local ACCEPTED_CATALOG_COUNTS = {
  template_count = 119,
  by_pack = {
    actions = 8,
    analysis = 4,
    automation = 15,
    core = 3,
    fx = 14,
    items = 9,
    media = 6,
    midi = 12,
    project = 7,
    render = 5,
    routing = 15,
    system = 3,
    tracks = 8,
    transport = 10,
  },
  by_risk = {
    read = 58,
    safe = 9,
    write = 52,
  },
  by_lifecycle = {
    experimental = 119,
  },
  by_entity_kind = {
    action = 4,
    api_symbol = 1,
    automation_item = 3,
    automation_mode = 3,
    automation_point = 4,
    channel = 4,
    command_id = 1,
    core_state = 2,
    cursor = 1,
    custom_action = 1,
    cycle_action = 1,
    envelope = 5,
    fx = 5,
    fx_chain = 3,
    fx_param = 3,
    item = 7,
    last_result = 1,
    loop_state = 3,
    marker = 2,
    marker_action = 1,
    media_file = 4,
    media_source = 2,
    midi_cc = 3,
    midi_event = 4,
    midi_item = 2,
    midi_note = 3,
    output_file = 2,
    peak = 1,
    pin_mapping = 1,
    preset = 2,
    project = 3,
    region = 1,
    render_matrix = 1,
    render_region = 1,
    render_setting = 1,
    resource_path = 1,
    rms = 1,
    send = 10,
    silence = 1,
    system_state = 1,
    take = 2,
    tempo_map = 1,
    time_selection = 2,
    track = 7,
    track_selection = 1,
    transient = 1,
    transport = 4,
    video_processor = 1,
  },
}

local function table_key_count(source)
  local count = 0
  for _ in pairs(source or {}) do
    count = count + 1
  end
  return count
end

local function clone_counts(source)
  local result = {}
  for key, value in pairs(source or {}) do
    result[key] = value
  end
  return result
end

local function count_for_key(source, key)
  local result = {}
  result[key] = source[key]
  return result
end

local function handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function bounded_limit(request, requested, default_limit, hard_limit)
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

local function read_template_catalog_summary(request)
  local pack = is_string(request.params.pack) and request.params.pack or nil
  if pack and not ACCEPTED_CATALOG_COUNTS.by_pack[pack] then
    return handler_error("PARAMS_INVALID", "Requested pack is not in the accepted runtime catalog.", {
      pack = bounded_string(pack, 80),
    })
  end

  local template_count = pack and ACCEPTED_CATALOG_COUNTS.by_pack[pack] or ACCEPTED_CATALOG_COUNTS.template_count
  local summary = {
    template_count = template_count,
    pack_count = pack and 1 or table_key_count(ACCEPTED_CATALOG_COUNTS.by_pack),
    by_pack = pack and count_for_key(ACCEPTED_CATALOG_COUNTS.by_pack, pack) or clone_counts(ACCEPTED_CATALOG_COUNTS.by_pack),
    by_lifecycle = request.params.include_lifecycle_counts == true and clone_counts(ACCEPTED_CATALOG_COUNTS.by_lifecycle) or nil,
    by_risk = request.params.include_risk_counts == true and clone_counts(ACCEPTED_CATALOG_COUNTS.by_risk) or nil,
    by_entity_kind = request.params.include_entity_kind_counts == true and clone_counts(ACCEPTED_CATALOG_COUNTS.by_entity_kind) or nil,
    truncated = false,
  }
  return summary
end

local function read_last_result(request)
  local limit = bounded_limit(request, request.params.limit, 8, 50)
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

local CORE_RUNTIME_SYMBOLS = json_array({
  "APIExists",
  "CountMediaItems",
  "CountProjectMarkers",
  "CountSelectedMediaItems",
  "CountTempoTimeSigMarkers",
  "CountTracks",
  "EnumProjectMarkers3",
  "EnumProjects",
  "GetAppVersion",
  "GetCursorPosition",
  "GetMediaItem",
  "GetMediaItemInfo_Value",
  "GetOS",
  "GetProjectLength",
  "GetProjectName",
  "GetResourcePath",
  "GetSelectedMediaItem",
  "GetTrack",
  "GetTrackGUID",
})

local EXTENSION_PROBE_SYMBOLS = json_array({
  "APIExists",
  "BR_GetMediaItemGUID",
  "CF_GetSWSVersion",
  "SNM_GetIntConfigVar",
})

local function symbol_profile_defaults(profile)
  if profile == "extension_probe" then
    return EXTENSION_PROBE_SYMBOLS
  end
  return CORE_RUNTIME_SYMBOLS
end

local function valid_api_symbol_name(name)
  return is_string(name) and name:match("^[A-Za-z_][A-Za-z0-9_]*$") ~= nil
end

local function api_symbol_available(name)
  if not reaper then
    return false
  end
  if type(reaper.APIExists) == "function" then
    local ok, exists = pcall(reaper.APIExists, name)
    if ok and type(exists) == "boolean" then
      return exists
    end
  end
  return type(reaper[name]) == "function"
end

local function read_api_symbols(request)
  local profile = is_string(request.params.profile) and request.params.profile or "core_runtime"
  local source = is_json_array(request.params.symbols) and request.params.symbols or symbol_profile_defaults(profile)
  local limit = bounded_limit(request, request.params.max_symbols, 16, 50)
  local symbols = json_array({})
  local unavailable_count = 0
  local scanned = 0

  for index = 1, #source do
    if scanned >= limit then
      break
    end
    local name = source[index]
    if type(name) == "string" then
      scanned = scanned + 1
      local valid = valid_api_symbol_name(name)
      local available = valid and api_symbol_available(name) or false
      if not available then
        unavailable_count = unavailable_count + 1
      end
      symbols[#symbols + 1] = {
        name = bounded_string(name, 120),
        available = available,
        reason = valid and nil or "invalid_symbol_name",
      }
    end
  end

  return {
    profile = profile,
    symbol_count = #symbols,
    symbols = symbols,
    unavailable_count = unavailable_count,
    truncated = #source > limit,
  }
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function requested_metadata_fields(fields)
  if not is_json_array(fields) or #fields == 0 then
    return json_array({ "title", "author", "notes" })
  end
  local result = json_array({})
  local seen = {}
  for index = 1, #fields do
    local field = fields[index]
    if PROJECT_METADATA_KEYS[field] and not seen[field] then
      seen[field] = true
      result[#result + 1] = field
    end
  end
  if #result == 0 then
    return json_array({ "title", "author", "notes" })
  end
  return result
end

local function read_project_metadata(request)
  local project = current_project()
  local fields = requested_metadata_fields(request.params.fields)
  local budget = safe_budget(request)
  local summary = {
    project_ref = "project:current",
  }
  for index = 1, #fields do
    local field = fields[index]
    summary[field] = project_info_string(project, PROJECT_METADATA_KEYS[field], math.min(budget.max_inline_value_bytes, 1024))
  end
  return summary
end

local function marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return prefix .. ":index:" .. tostring(index_number or 0)
end

local function list_markers_regions(request)
  local project = current_project()
  local include_markers = request.params.include_markers ~= false
  local include_regions = request.params.include_regions ~= false
  local limit = bounded_limit(request, request.params.limit, 50, 50)
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total_markers = ok_count and first_number(marker_count) or 0
  local total_regions = ok_count and first_number(region_count) or 0
  local total = total_markers + total_regions
  local items = json_array({})
  local included_count = 0

  for index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, index_number, color = call_reaper("EnumProjectMarkers3", project, index)
    if ok_enum and retval then
      local kind = is_region and "region" or "marker"
      local include = (kind == "marker" and include_markers) or (kind == "region" and include_regions)
      if include then
        included_count = included_count + 1
        if #items < limit then
          local item = {
            kind = kind,
            name = bounded_string(name or "", 160),
            index = index_number or included_count,
            position_seconds = first_number(pos) or 0,
            color_native = type(color) == "number" and color or nil,
          }
          if kind == "region" then
            item.region_ref = marker_ref("region", index_number)
            item.end_seconds = first_number(region_end) or item.position_seconds
          else
            item.marker_ref = marker_ref("marker", index_number)
          end
          items[#items + 1] = item
        end
      end
    end
  end

  return {
    items = items,
    marker_count = include_markers and total_markers or 0,
    region_count = include_regions and total_regions or 0,
    truncated = included_count > #items,
  }
end

local function read_tempo_map(request)
  local project = current_project()
  local limit = bounded_limit(request, request.params.limit, 32, 50)
  local ok_count, marker_count = call_reaper("CountTempoTimeSigMarkers", project)
  local total = ok_count and first_number(marker_count) or 0
  local tempo_markers = json_array({})

  for index = 0, math.max(total - 1, -1) do
    if #tempo_markers >= limit then
      break
    end
    local ok_marker, retval, timepos, measurepos, beatpos, bpm, timesig_num, timesig_denom, lineartempo = call_reaper("GetTempoTimeSigMarker", project, index)
    if ok_marker and retval then
      tempo_markers[#tempo_markers + 1] = {
        index = index,
        time_seconds = first_number(timepos) or 0,
        measure = first_number(measurepos) or 0,
        beat = first_number(beatpos) or 0,
        bpm = first_number(bpm) or 0,
        time_sig_num = first_number(timesig_num) or 0,
        time_sig_denom = first_number(timesig_denom) or 0,
        linear_tempo = lineartempo == true,
      }
    end
  end

  local effective = json_array({})
  local requested_times = is_json_array(request.params.effective_at_seconds) and request.params.effective_at_seconds or json_array({})
  local effective_limit = bounded_limit(request, #requested_times, math.min(#requested_times, 8), 16)
  for index = 1, math.min(#requested_times, effective_limit) do
    local time_seconds = requested_times[index]
    if type(time_seconds) == "number" then
      local ok_effective, bpm, timesig_num, timesig_denom = call_reaper("TimeMap_GetTimeSigAtTime", project, time_seconds)
      effective[#effective + 1] = {
        time_seconds = time_seconds,
        bpm = ok_effective and first_number(bpm) or 0,
        time_sig_num = ok_effective and first_number(timesig_num) or 0,
        time_sig_denom = ok_effective and first_number(timesig_denom) or 0,
      }
    end
  end

  return {
    tempo_markers = tempo_markers,
    effective = effective,
    truncated = total > #tempo_markers,
  }
end

local function track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, candidate = call_reaper("GetTrack", 0, index)
    if ok_track and candidate == track then
      return index
    end
  end
  return 0
end

local function track_ref_string(track)
  local guid = track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(track_index(track))
end

local function solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function track_summary(track)
  local index = track_index(track)
  local ok_selected, selected = call_reaper("GetMediaTrackInfo_Value", track, "I_SELECTED")
  local ok_mute, muted = call_reaper("GetMediaTrackInfo_Value", track, "B_MUTE")
  local ok_solo, solo = call_reaper("GetMediaTrackInfo_Value", track, "I_SOLO")
  local ok_arm, armed = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
  local ok_color, color = call_reaper("GetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR")
  return {
    track_ref = track_ref_string(track),
    index = index,
    name = track_name(track),
    selected = ok_selected and first_number(selected) == 1 or false,
    muted = ok_mute and first_number(muted) == 1 or false,
    solo_mode = solo_label(ok_solo and first_number(solo) or 0),
    record_armed = ok_arm and first_number(armed) == 1 or false,
    color = ok_color and type(color) == "number" and color > 0 and tostring(math.floor(color)) or JSON_NULL,
  }
end

local function find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function find_track_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function resolve_track_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^track:selected:(%d+)$")
  if selected_index then
    local ok, track = call_reaper("GetSelectedTrack", 0, tonumber(selected_index))
    return ok and track or nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^track:index:(%d+)$")
  if index then
    local ok, track = call_reaper("GetTrack", 0, tonumber(index))
    return ok and track or nil
  end

  local guid = token:match("^guid:(.+)$") or token:match("^track:guid:(.+)$")
  if guid then
    return find_track_by_guid(guid)
  end

  local name = token:match("^track:(.+)$")
  if name then
    return find_track_by_name(name)
  end
  return nil
end

local function resolve_track_ref(request)
  local track, reason = resolve_track_token(request.params.track_ref)
  if reason == "ambiguous" then
    return handler_error("REF_INVALID", "Track name is ambiguous.", {
      track_ref = bounded_string(request.params.track_ref, 160),
    })
  end
  if not track then
    return handler_error("TRACK_NOT_FOUND", "Track ref could not be resolved.", {
      track_ref = bounded_string(request.params.track_ref, 160),
    })
  end
  return track_summary(track)
end

local function item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function item_ref_string(item)
  local guid = item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return "item:unknown"
end

local function find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function resolve_item_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^item:selected:(%d+)$")
  if selected_index then
    local ok, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    return ok and item or nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^item:index:(%d+)$")
  if index then
    local ok, item = call_reaper("GetMediaItem", 0, tonumber(index))
    return ok and item or nil
  end

  local guid = token:match("^guid:(.+)$") or token:match("^item:guid:(.+)$")
  if guid then
    return find_item_by_guid(guid)
  end
  return nil
end

local function resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_item_token("guid:" .. tostring(identity.value))
  end
  return resolve_item_token(ref.ref)
end

local function item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function item_summary(item, include_take_summary)
  local track = item_track(item)
  local summary = {
    item_ref = item_ref_string(item),
    track_ref = track and track_ref_string(track) or JSON_NULL,
    position_seconds = item_number(item, "D_POSITION"),
    length_seconds = item_number(item, "D_LENGTH"),
    snap_offset_seconds = item_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = item_number(item, "D_FADEINLEN"),
    fade_out_seconds = item_number(item, "D_FADEOUTLEN"),
  }
  if include_take_summary then
    local ok_take_count, take_count = call_reaper("CountTakes", item)
    local ok_take, take = call_reaper("GetActiveTake", item)
    local ok_name, take_name = false, nil
    if ok_take and take then
      ok_name, take_name = call_reaper("GetTakeName", take)
    end
    summary.take_count = ok_take_count and first_number(take_count) or 0
    summary.active_take_name = bounded_string(ok_name and first_string(take_name) or "", 160)
  end
  return summary
end

local function resolve_item_ref(request)
  local item = resolve_item_token(request.params.ref)
  if not item then
    return handler_error("ITEM_NOT_FOUND", "Item ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
  end
  return item_summary(item, false)
end

local function read_item_summary(request)
  local item = nil
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      item = resolve_item_from_ref_object(request.refs[index])
      if item then
        break
      end
    end
  end
  if not item then
    return handler_error("ITEM_NOT_FOUND", "Item summary requires a resolvable item ref.", {})
  end
  return item_summary(item, request.params.include_take_summary == true)
end

local ALLOWED_OPERATIONS = {
  ["query_state:project.read_summary"] = {
    pack = "project",
    handler = read_project_summary,
  },
  ["query_state:project.read_metadata"] = {
    pack = "project",
    handler = read_project_metadata,
  },
  ["query_state:project.list_markers_regions"] = {
    pack = "project",
    handler = list_markers_regions,
  },
  ["query_state:project.read_tempo_map"] = {
    pack = "project",
    handler = read_tempo_map,
  },
  ["query_state:transport.read_state"] = {
    pack = "transport",
    handler = read_transport_state,
  },
  ["query_state:openreaper.read_status"] = {
    pack = "core",
    handler = read_openreaper_status,
  },
  ["query_state:template_catalog.read_summary"] = {
    pack = "core",
    handler = read_template_catalog_summary,
  },
  ["query_state:last_result.read"] = {
    pack = "core",
    handler = read_last_result,
  },
  ["query_state:track.resolve_ref"] = {
    pack = "tracks",
    handler = resolve_track_ref,
  },
  ["query_state:items.resolve_item_ref"] = {
    pack = "items",
    handler = resolve_item_ref,
  },
  ["query_state:items.read_item_summary"] = {
    pack = "items",
    handler = read_item_summary,
  },
  ["query_state:system.runtime_environment.read"] = {
    pack = "system",
    handler = read_runtime_environment,
  },
  ["query_state:system.resource_paths.read"] = {
    pack = "system",
    handler = read_resource_paths,
  },
  ["query_state:system.api_symbols.check"] = {
    pack = "system",
    handler = read_api_symbols,
  },
}

local function dispatch_request(request, fallback_id)
  local started_at = now_iso()
  local valid, validation_error = validate_request(request)
  if not valid then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Bridge request failed validation.", {
      fallback_id = fallback_id,
      recoverable = true,
      started_at = started_at,
      details = { reason = validation_error },
    })
  end
  if request.bridge.expected_owner ~= ACTIVE_OWNER then
    return bridge_error_envelope(request, "BRIDGE_OWNER_MISMATCH", "Bridge owner token changed.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_owner = request.bridge.expected_owner,
        actual_owner = ACTIVE_OWNER,
      },
    })
  end
  if request.bridge.expected_generation ~= ACTIVE_GENERATION then
    return bridge_error_envelope(request, "BRIDGE_GENERATION_MISMATCH", "Bridge generation changed.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_generation = request.bridge.expected_generation,
        actual_generation = ACTIVE_GENERATION,
      },
    })
  end

  local key = request.operation.family .. ":" .. request.operation.name
  local operation = ALLOWED_OPERATIONS[key]
  if not operation then
    return bridge_error_envelope(request, "OPERATION_NOT_FOUND", "OpenReaper live bridge supports only the approved read-only live-smoke operations.", {
      recoverable = true,
      started_at = started_at,
      details = {
        operation_family = request.operation.family,
        operation_name = request.operation.name,
      },
    })
  end
  if operation.pack ~= request.pack.id then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Operation owner pack does not match the request pack.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_pack = operation.pack,
        actual_pack = request.pack.id,
      },
    })
  end

  local ok, summary, handler_failure = pcall(operation.handler, request)
  if not ok then
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Read-only live bridge handler failed.", {
      recoverable = false,
      started_at = started_at,
      details = {
        operation_name = request.operation.name,
        message = bounded_string(summary, 240),
      },
    })
  end
  if handler_failure then
    return bridge_error_envelope(request, handler_failure.code or "INTERNAL_ERROR", handler_failure.message or "Read-only live bridge handler failed.", {
      recoverable = handler_failure.recoverable ~= false,
      started_at = started_at,
      details = handler_failure.details or {},
    })
  end
  return bridge_ok_envelope(request, started_at, summary)
end

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

local function monotonic_time()
  if reaper and type(reaper.time_precise) == "function" then
    return reaper.time_precise()
  end
  return os.clock()
end

local function bridge_loop()
  local current_time = monotonic_time()
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
  log("started manual bridge loop at " .. TRANSPORT_DIR .. " owner=" .. ACTIVE_OWNER .. " generation=" .. tostring(ACTIVE_GENERATION))
  bridge_loop()
end
