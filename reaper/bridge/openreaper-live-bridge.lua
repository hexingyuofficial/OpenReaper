-- OpenReaper generated live bridge.
-- Handler registry: reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json (191 registered template handler row(s); 0 legacy_monolith row(s); 191 extracted handler row(s); 78 handler module file(s)).

-- OpenReaper 4D.x minimal live bridge loop.
-- Manual REAPER-side script: polls file transport requests and writes
-- foundation.bridge.v1 results for approved live-smoke handlers.

local CONTRACT = "foundation.bridge.v1"
local ARTIFACT_CONTRACT = "artifact.state_store.v1"
local TRANSPORT_ENV = "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
local ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT"
local RENDER_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT"
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
local ARTIFACT_ROOT = non_empty(os.getenv(ARTIFACT_ROOT_ENV))
local RENDER_ROOT = non_empty(os.getenv(RENDER_ROOT_ENV))
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

local TRANSPORT_DIR = non_empty(os.getenv(TRANSPORT_ENV))
local REQUESTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "requests") or nil
local RESULTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "results") or nil

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

local function ensure_directory(path)
  local ok = call_reaper("RecursiveCreateDirectory", path, 0)
  if ok then
    return true
  end
  return false, "recursive_create_directory_unavailable"
end

local function is_absolute_path(value)
  if type(value) ~= "string" then
    return false
  end
  if value:match("^[A-Za-z]:[\\/]") then
    return false
  end
  return value:sub(1, 1) == "/"
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
    opened = request and request.__openreaper_undo_opened == true,
    closed = request and request.__openreaper_undo_closed == true,
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

local function bridge_ok_envelope(request, started_at, summary, artifacts, jobs, refs)
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
      refs = refs or json_array({}),
      artifacts = artifacts or json_array({}),
      jobs = jobs or json_array({}),
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
local A1_ARTIFACT_OPERATIONS = {
  ["run_job:analysis.detect_loop_candidates"] = true,
  ["run_job:analysis.measure_loop_click_risk"] = true,
  ["run_job:analysis.create_loop_qa_report"] = true,
  ["run_job:analysis.measure_item_rms"] = true,
  ["run_job:analysis.measure_item_peaks"] = true,
  ["run_job:analysis.detect_item_silence"] = true,
  ["run_job:analysis.detect_item_transients"] = true,
  ["run_job:project.create_cleanup_report"] = true,
}

local FX_ARTIFACT_OPERATIONS = {
  ["query_state:fx.read_video_processor_code"] = true,
}

local A2_ARTIFACT_OPERATIONS = {
  ["run_job:render.region_wav"] = true,
  ["run_job:render.delivery_report.create"] = true,
}

local A3_ARTIFACT_OPERATIONS = {
  ["run_job:items.create_layer_report"] = true,
}

local ARTIFACT_PRODUCING_OPERATIONS = {}
for key, value in pairs(A1_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(FX_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(A2_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(A3_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end

local A1_ARTIFACT_SPECS = {
  ["run_job:analysis.detect_loop_candidates"] = {
    template_id = "template.analysis.detect_loop_candidates",
    owner_pack = "analysis",
    scope = "loop_candidates",
    schema = "analysis.loop_candidates.v1",
  },
  ["run_job:analysis.measure_loop_click_risk"] = {
    template_id = "template.analysis.measure_loop_click_risk",
    owner_pack = "analysis",
    scope = "loop_click_risk",
    schema = "analysis.loop_click_risk.v1",
  },
  ["run_job:analysis.create_loop_qa_report"] = {
    template_id = "template.analysis.create_loop_qa_report",
    owner_pack = "analysis",
    scope = "loop_qa_report",
    schema = "analysis.loop_qa_report.v1",
  },
  ["run_job:project.create_cleanup_report"] = {
    template_id = "template.project.create_cleanup_report",
    owner_pack = "project",
    scope = "cleanup_report",
    schema = "project.cleanup_report.v1",
  },
  ["run_job:analysis.measure_item_rms"] = {
    template_id = "template.analysis.measure_item_rms",
    owner_pack = "analysis",
    scope = "item_rms_report",
    schema = "analysis.item_rms.v1",
  },
  ["run_job:analysis.measure_item_peaks"] = {
    template_id = "template.analysis.measure_item_peaks",
    owner_pack = "analysis",
    scope = "item_peaks_report",
    schema = "analysis.item_peaks.v1",
  },
  ["run_job:analysis.detect_item_silence"] = {
    template_id = "template.analysis.detect_item_silence",
    owner_pack = "analysis",
    scope = "item_silence_report",
    schema = "analysis.item_silence.v1",
  },
  ["run_job:analysis.detect_item_transients"] = {
    template_id = "template.analysis.detect_item_transients",
    owner_pack = "analysis",
    scope = "item_transients_report",
    schema = "analysis.item_transients.v1",
  },
}

local A2_ARTIFACT_SPECS = {
  region_wav_output = {
    template_id = "template.render.render_region_wav",
    owner_pack = "render",
    scope = "region_wav_output",
    schema = "render.region_wav_output.v1",
  },
  render_job_evidence = {
    template_id = "template.render.render_region_wav",
    owner_pack = "render",
    scope = "render_job_evidence",
    schema = "render.render_job_evidence.v1",
  },
  delivery_report = {
    template_id = "template.render.create_delivery_report",
    owner_pack = "render",
    scope = "delivery_report",
    schema = "render.delivery_report.v1",
  },
}

local FX_ARTIFACT_SPECS = {
  video_processor_code = {
    template_id = "template.fx.read_video_processor_code",
    owner_pack = "fx",
    scope = "video_processor_code",
    schema = "fx.video_processor_code.v1",
  },
}

local A3_ARTIFACT_SPECS = {
  layer_evidence = {
    template_id = "template.items.fixture_layer_evidence",
    owner_pack = "items",
    scope = "layer_evidence",
    schema = "items.layer_evidence.v1",
  },
  layer_report = {
    template_id = "template.items.create_layer_report",
    owner_pack = "items",
    scope = "layer_report",
    schema = "items.layer_report.v1",
  },
}

local A1_LOOP_CANDIDATES_INPUT = {
  owner_pack = "analysis",
  scope = "loop_candidates",
  schema = "analysis.loop_candidates.v1",
}

local A1_LOOP_CLICK_RISK_INPUT = {
  owner_pack = "analysis",
  scope = "loop_click_risk",
  schema = "analysis.loop_click_risk.v1",
}

local function valid_lower_snake(value)
  return type(value) == "string" and value:match("^[a-z][a-z0-9_]*$") ~= nil
end

local function parse_artifact_ref(ref)
  if not is_string(ref) then
    return nil, "Artifact ref must be a non-empty string."
  end
  if ref:find("/", 1, true) or ref:find("\\", 1, true) or ref:sub(1, 7) == "file://" or ref:sub(1, 1) == "~" then
    return nil, "Artifact ref must not be a raw path."
  end
  local owner_pack, scope, id = ref:match("^artifact:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*):(art_%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d_%d%d%d_[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])$")
  if not owner_pack then
    return nil, "Malformed artifact ref; expected artifact:<owner_pack>:<scope>:<id>."
  end
  if not FIXED_PACKS[owner_pack] then
    return nil, "Invalid artifact owner_pack."
  end
  if WORKFLOW_SHAPED_IDS[owner_pack] or WORKFLOW_SHAPED_IDS[scope] then
    return nil, "Workflow-shaped artifact owner or scope is forbidden."
  end
  return {
    owner_pack = owner_pack,
    scope = scope,
    id = id,
    ref = ref,
  }
end

local function validate_schema(schema)
  if type(schema) ~= "string" or #schema > 160 then
    return false
  end
  if schema:find("..", 1, true) or schema:sub(1, 1) == "." or schema:sub(-1) == "." then
    return false
  end
  local segments = {}
  for segment in schema:gmatch("[^.]+") do
    segments[#segments + 1] = segment
  end
  if #segments < 3 or not segments[#segments]:match("^v%d+$") then
    return false
  end
  for index = 1, #segments - 1 do
    if not valid_lower_snake(segments[index]) then
      return false
    end
  end
  return true
end

local function artifact_id_from_request(request)
  local timestamp, sequence, suffix = tostring(request and request.id or ""):match("^cmd_(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d)_(%d%d%d)_([a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])$")
  if not timestamp then
    return nil
  end
  return "art_" .. timestamp .. "_" .. sequence .. "_" .. suffix
end

local function artifact_path(parts)
  local artifact_dir = path_join(path_join(ARTIFACT_ROOT, parts.owner_pack), parts.scope)
  return artifact_dir, path_join(artifact_dir, parts.id .. ".json")
end

local function artifact_object_ref(parts, schema)
  return {
    kind = "artifact",
    ref = parts.ref,
    identity = {
      scheme = "artifact_ref",
      value = parts.ref,
    },
    summary = {
      schema = schema,
      owner_pack = parts.owner_pack,
      scope = parts.scope,
    },
  }
end

local function artifact_ref_for_request(request, spec)
  local artifact_id = artifact_id_from_request(request)
  if not artifact_id then
    return nil, "Command id cannot derive a canonical artifact id."
  end
  return "artifact:" .. spec.owner_pack .. ":" .. spec.scope .. ":" .. artifact_id
end

local function artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A1 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A1 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a1_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A1 artifact ref does not match the operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local producer = {
    kind = "template",
    id = spec.template_id,
    pack = spec.owner_pack,
  }
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = producer,
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A1 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A1 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function a2_artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A2 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A2 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a2_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = a2_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= "render" or parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A2 artifact ref does not match the render operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = {
      kind = "template",
      id = spec.template_id,
      pack = spec.owner_pack,
    },
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A2 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A2 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  if file_exists(path_value) then
    return nil, {
      code = "IDEMPOTENCY_CONFLICT",
      message = "A2 artifact ref collision would overwrite existing evidence.",
      details = {
        blocker = "artifact_ref_collision",
        ref = ref,
      },
      recoverable = false,
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function a3_artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A3 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A3 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a3_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = a3_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= "items" or parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A3 artifact ref does not match the items layer-report operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = {
      kind = "template",
      id = spec.template_id,
      pack = spec.owner_pack,
    },
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A3 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A3 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  if file_exists(path_value) then
    return nil, {
      code = "IDEMPOTENCY_CONFLICT",
      message = "A3 artifact ref collision would overwrite existing layer-report evidence.",
      details = {
        blocker = "artifact_ref_collision",
        ref = ref,
      },
      recoverable = false,
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function read_artifact_envelope(ref, expected)
  expected = expected or {}
  local root_ok, blocker, root_message = artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end
  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if (expected.owner_pack and parts.owner_pack ~= expected.owner_pack)
    or (expected.scope and parts.scope ~= expected.scope) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A1 input artifact ref does not match the expected owner/scope.",
      details = {
        field = "artifact_ref",
        expected_owner_pack = expected.owner_pack,
        expected_scope = expected.scope,
      },
    }
  end
  local _, path_value = artifact_path(parts)
  local raw = read_file(path_value)
  if not raw then
    return nil, {
      code = "ARTIFACT_NOT_FOUND",
      message = "A1 input artifact was not found in the configured artifact root.",
      details = { ref = ref },
    }
  end
  local decoded_ok, envelope_or_error = pcall(json.decode, raw)
  if not decoded_ok or not is_object(envelope_or_error) then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 input artifact JSON could not be parsed.",
      details = { ref = ref },
    }
  end
  if envelope_or_error.contract ~= ARTIFACT_CONTRACT
    or envelope_or_error.ref ~= ref
    or envelope_or_error.id ~= parts.id
    or envelope_or_error.owner_pack ~= parts.owner_pack
    or envelope_or_error.scope ~= parts.scope
    or envelope_or_error.schema ~= expected.schema
    or (expected.owner_pack and envelope_or_error.owner_pack ~= expected.owner_pack)
    or (expected.scope and envelope_or_error.scope ~= expected.scope) then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 input artifact envelope does not match the expected schema/ref/owner/scope.",
      details = {
        ref = ref,
        expected_schema = expected.schema,
        expected_owner_pack = expected.owner_pack,
        expected_scope = expected.scope,
      },
    }
  end
  return envelope_or_error
end
local SAFE_WRITE_A_CAPABILITIES = {
  ["project.set_metadata_field"] = { pack = "project", risk = "write" },
  ["project.create_marker"] = { pack = "project", risk = "write" },
  ["project.create_region"] = { pack = "project", risk = "write" },
  ["track.create"] = { pack = "tracks", risk = "write" },
  ["track.rename"] = { pack = "tracks", risk = "write" },
  ["track.set_color"] = { pack = "tracks", risk = "write" },
  ["track.select"] = { pack = "tracks", risk = "write" },
  ["track.set_mute"] = { pack = "tracks", risk = "write" },
  ["track.set_solo"] = { pack = "tracks", risk = "write" },
  ["transport.set_edit_cursor"] = { pack = "transport", risk = "safe" },
  ["transport.set_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.clear_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.set_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.clear_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.set_repeat"] = { pack = "transport", risk = "safe" },
  ["items.move_item"] = { pack = "items", risk = "write" },
  ["items.trim_item"] = { pack = "items", risk = "write" },
  ["items.set_item_fades"] = { pack = "items", risk = "write" },
  ["items.set_take_pitch"] = { pack = "items", risk = "write" },
  ["items.set_item_snap_offset"] = { pack = "items", risk = "write" },
  ["midi.create_midi_item"] = { pack = "midi", risk = "write" },
  ["midi.insert_notes_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_cc_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_text_sysex_events"] = { pack = "midi", risk = "write" },
}

local E3_MEDIA_ROUTE_CAPABILITIES = {
  ["media.import_file_to_track"] = { pack = "media", risk = "write" },
  ["media.import_file_section_to_track"] = { pack = "media", risk = "write" },
  ["media.relink_take_source"] = { pack = "media", risk = "write" },
}

local E4_ITEM_ROUTE_CAPABILITIES = {
  ["item.copy_to_track"] = { pack = "items", risk = "write" },
  ["items.split_item_at_time"] = { pack = "items", risk = "write" },
  ["items.set_take_playrate"] = { pack = "items", risk = "write" },
}

local E5_ROUTING_WRITE_CAPABILITIES = {
  ["routing.send.create"] = { pack = "routing", risk = "write" },
  ["routing.send.set_volume"] = { pack = "routing", risk = "write" },
  ["routing.send.set_pan"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mute"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mode"] = { pack = "routing", risk = "write" },
  ["routing.master_parent.set"] = { pack = "routing", risk = "write" },
  ["routing.track_channels.set"] = { pack = "routing", risk = "write" },
  ["routing.track_hardware_output.set"] = { pack = "routing", risk = "write" },
  ["routing.track_hardware_output.remove"] = { pack = "routing", risk = "write" },
  ["routing.send.audio_channels.set"] = { pack = "routing", risk = "write" },
  ["routing.send.set_phase"] = { pack = "routing", risk = "write" },
  ["routing.send.set_mono"] = { pack = "routing", risk = "write" },
  ["routing.send.midi_channels.set"] = { pack = "routing", risk = "write" },
}

local E5_AUTOMATION_WRITE_CAPABILITIES = {
  ["automation.set_envelope_lane_state"] = { pack = "automation", risk = "write" },
  ["automation.insert_envelope_point"] = { pack = "automation", risk = "write" },
  ["automation.set_track_automation_mode"] = { pack = "automation", risk = "write" },
  ["automation.set_envelope_point"] = { pack = "automation", risk = "write" },
  ["automation.insert_envelope_points_batch"] = { pack = "automation", risk = "write" },
  ["automation.set_send_automation_mode"] = { pack = "automation", risk = "write" },
  ["automation.create_automation_item"] = { pack = "automation", risk = "write" },
  ["automation.set_automation_item_bounds"] = { pack = "automation", risk = "write" },
  ["automation.insert_fx_parameter_envelope_points"] = { pack = "automation", risk = "write" },
  ["automation.insert_sine_wave_points"] = { pack = "automation", risk = "write" },
}

local D6_PROJECT_TEMPO_WRITE_CAPABILITIES = {
  ["project.set_tempo"] = { pack = "project", risk = "write" },
  ["project.set_bpm"] = { pack = "project", risk = "write" },
  ["project.set_tempo_marker"] = { pack = "project", risk = "write" },
  ["project.set_grid"] = { pack = "project", risk = "write" },
}

local D9_TRACKS_MIXER_WRITE_CAPABILITIES = {
  ["track.set_record_arm"] = { pack = "tracks", risk = "write" },
  ["track.set_volume"] = { pack = "tracks", risk = "write" },
  ["track.set_pan"] = { pack = "tracks", risk = "write" },
  ["track.set_width"] = { pack = "tracks", risk = "write" },
}

local D11_PROJECT_MARKER_REGION_CAPABILITIES = {
  ["project.delete_marker"] = { pack = "project", risk = "destructive" },
  ["project.delete_region"] = { pack = "project", risk = "destructive" },
  ["project.remove_marker"] = { pack = "project", risk = "destructive" },
  ["project.remove_region"] = { pack = "project", risk = "destructive" },
  ["project.rename_marker"] = { pack = "project", risk = "write" },
  ["project.rename_region"] = { pack = "project", risk = "write" },
}

local D12_TRANSPORT_SAFE_CAPABILITIES = {
  ["transport.play"] = { pack = "transport", risk = "safe" },
  ["transport.pause"] = { pack = "transport", risk = "safe" },
  ["transport.stop_playback"] = { pack = "transport", risk = "safe" },
  ["transport.set_playback_rate"] = { pack = "transport", risk = "safe" },
  ["transport.start_recording"] = { pack = "transport", risk = "write" },
  ["transport.stop_recording"] = { pack = "transport", risk = "write" },
  ["transport.set_record_mode"] = { pack = "transport", risk = "safe" },
  ["transport.set_punch_record_range"] = { pack = "transport", risk = "safe" },
  ["transport.schedule_recording"] = { pack = "transport", risk = "write" },
}

local D13_ITEMS_CORE_WRITE_CAPABILITIES = {
  ["items.set_item_volume"] = { pack = "items", risk = "write" },
  ["items.set_take_volume"] = { pack = "items", risk = "write" },
  ["items.set_take_pan"] = { pack = "items", risk = "write" },
  ["items.rename_take"] = { pack = "items", risk = "write" },
  ["items.set_loop_source"] = { pack = "items", risk = "write" },
  ["items.set_mute"] = { pack = "items", risk = "write" },
  ["items.set_lock"] = { pack = "items", risk = "write" },
  ["items.set_play_all_takes"] = { pack = "items", risk = "write" },
  ["items.set_take_start_in_source"] = { pack = "items", risk = "write" },
  ["items.set_channel_mode"] = { pack = "items", risk = "write" },
  ["items.set_pitch_shift_mode"] = { pack = "items", risk = "write" },
  ["items.set_stretch_marker_fade_size"] = { pack = "items", risk = "write" },
}

local D14_ITEMS_DELETE_CAPABILITIES = {
  ["items.delete_item"] = { pack = "items", risk = "destructive" },
  ["items.delete_items"] = { pack = "items", risk = "destructive" },
}

local D15_ITEMS_SOURCE_PHASE_CAPABILITIES = {
  ["items.set_no_autofades"] = { pack = "items", risk = "write" },
  ["items.set_invert_phase"] = { pack = "items", risk = "write" },
  ["items.choose_new_source_file"] = { pack = "items", risk = "write" },
}

local D16_TRACKS_ORG_CAPABILITIES = {
  ["track.delete"] = { pack = "tracks", risk = "destructive" },
  ["tracks.delete"] = { pack = "tracks", risk = "destructive" },
  ["track.create_folder"] = { pack = "tracks", risk = "write" },
  ["track.set_folder_depth"] = { pack = "tracks", risk = "write" },
  ["track.move"] = { pack = "tracks", risk = "write" },
  ["tracks.move"] = { pack = "tracks", risk = "write" },
  ["tracks.nest_in_folder"] = { pack = "tracks", risk = "write" },
}

local D17_MIDI_EDIT_CAPABILITIES = {
  ["midi.set_notes_batch"] = { pack = "midi", risk = "write" },
  ["midi.quantize_notes"] = { pack = "midi", risk = "write" },
  ["midi.quantize_selected_notes"] = { pack = "midi", risk = "write" },
  ["midi.set_cc_events_batch"] = { pack = "midi", risk = "write" },
}

local D22_RENDER_SETTINGS_WRITE_CAPABILITIES = {
  ["render.sample_rate.set"] = { pack = "render", risk = "write" },
}

local D28_SMALL_WRITE_CAPABILITIES = {
  ["items.set_item_pan"] = { pack = "items", risk = "write" },
  ["items.set_reverse"] = { pack = "items", risk = "write" },
  ["project.set_snap"] = { pack = "project", risk = "write" },
  ["routing.track_mono_stereo.set"] = { pack = "routing", risk = "write" },
}

local E2_FX_B1_WRITE_CAPABILITIES = {
  ["fx.add_track"] = { pack = "fx", risk = "write" },
  ["fx.add_take"] = { pack = "fx", risk = "write" },
  ["fx.set_bypass"] = { pack = "fx", risk = "write" },
  ["fx.set_parameter_normalized"] = { pack = "fx", risk = "write" },
  ["fx.set_preset_by_name"] = { pack = "fx", risk = "write" },
  ["fx.set_preset_by_index"] = { pack = "fx", risk = "write" },
  ["fx.reorder"] = { pack = "fx", risk = "write" },
}

local function safe_write_a_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return SAFE_WRITE_A_CAPABILITIES[request.pack.capability]
end

local function e3_media_route_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E3_MEDIA_ROUTE_CAPABILITIES[request.pack.capability]
end

local function e4_item_route_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E4_ITEM_ROUTE_CAPABILITIES[request.pack.capability]
end

local function e5_routing_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E5_ROUTING_WRITE_CAPABILITIES[request.pack.capability]
end

local function e5_automation_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E5_AUTOMATION_WRITE_CAPABILITIES[request.pack.capability]
end

local function d6_project_tempo_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D6_PROJECT_TEMPO_WRITE_CAPABILITIES[request.pack.capability]
end

local function d9_tracks_mixer_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D9_TRACKS_MIXER_WRITE_CAPABILITIES[request.pack.capability]
end

local function d11_project_marker_region_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D11_PROJECT_MARKER_REGION_CAPABILITIES[request.pack.capability]
end

local function d12_transport_safe_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D12_TRANSPORT_SAFE_CAPABILITIES[request.pack.capability]
end

local function d13_items_core_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D13_ITEMS_CORE_WRITE_CAPABILITIES[request.pack.capability]
end

local function d14_items_delete_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D14_ITEMS_DELETE_CAPABILITIES[request.pack.capability]
end

local function d15_items_source_phase_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D15_ITEMS_SOURCE_PHASE_CAPABILITIES[request.pack.capability]
end

local function d16_tracks_org_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D16_TRACKS_ORG_CAPABILITIES[request.pack.capability]
end

local function d17_midi_edit_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D17_MIDI_EDIT_CAPABILITIES[request.pack.capability]
end

local function d22_render_settings_write_capability(request, operation_key)
  if operation_key ~= "run_command:render.sample_rate.set" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D22_RENDER_SETTINGS_WRITE_CAPABILITIES[request.pack.capability]
end

local function d28_small_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return D28_SMALL_WRITE_CAPABILITIES[request.pack.capability]
end

local function e2_fx_b1_write_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return E2_FX_B1_WRITE_CAPABILITIES[request.pack.capability]
end

local function template_execute_write_capability(request, operation_key)
  return safe_write_a_capability(request, operation_key)
    or e3_media_route_capability(request, operation_key)
    or e4_item_route_capability(request, operation_key)
    or e5_routing_write_capability(request, operation_key)
    or e5_automation_write_capability(request, operation_key)
    or e2_fx_b1_write_capability(request, operation_key)
    or d6_project_tempo_write_capability(request, operation_key)
    or d9_tracks_mixer_write_capability(request, operation_key)
    or d11_project_marker_region_capability(request, operation_key)
    or d12_transport_safe_capability(request, operation_key)
    or d13_items_core_write_capability(request, operation_key)
    or d14_items_delete_capability(request, operation_key)
    or d15_items_source_phase_capability(request, operation_key)
    or d16_tracks_org_capability(request, operation_key)
    or d17_midi_edit_capability(request, operation_key)
    or d22_render_settings_write_capability(request, operation_key)
    or d28_small_write_capability(request, operation_key)
end

local function open_required_undo_block(request, operation_key)
  if not template_execute_write_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_BeginBlock2", project)
  if not ok then
    ok = call_reaper("Undo_BeginBlock")
  end
  request.__openreaper_undo_opened = ok == true
end

local function close_required_undo_block(request, operation_key)
  if not template_execute_write_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local label = is_string(request.undo.label) and request.undo.label or "OpenReaper Safe-Write-A"
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_EndBlock2", project, label, -1)
  if not ok then
    ok = call_reaper("Undo_EndBlock", label, -1)
  end
  request.__openreaper_undo_closed = ok == true
end

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
  local operation_key = request.operation.family .. ":" .. request.operation.name
  local artifacts_allowed_for_operation = ARTIFACT_PRODUCING_OPERATIONS[operation_key] == true
  local a2_render_operation = operation_key == "run_job:render.region_wav"
  local safe_write_a_operation = safe_write_a_capability(request, operation_key)
  local e3_media_route_operation = e3_media_route_capability(request, operation_key)
  local e4_item_route_operation = e4_item_route_capability(request, operation_key)
  local e5_routing_write_operation = e5_routing_write_capability(request, operation_key)
  local e5_automation_write_operation = e5_automation_write_capability(request, operation_key)
  local e2_fx_b1_write_operation = e2_fx_b1_write_capability(request, operation_key)
  local d6_project_tempo_write_operation = d6_project_tempo_write_capability(request, operation_key)
  local d9_tracks_mixer_write_operation = d9_tracks_mixer_write_capability(request, operation_key)
  local d11_project_marker_region_operation = d11_project_marker_region_capability(request, operation_key)
  local d12_transport_safe_operation = d12_transport_safe_capability(request, operation_key)
  local d13_items_core_write_operation = d13_items_core_write_capability(request, operation_key)
  local d14_items_delete_operation = d14_items_delete_capability(request, operation_key)
  local d15_items_source_phase_operation = d15_items_source_phase_capability(request, operation_key)
  local d16_tracks_org_operation = d16_tracks_org_capability(request, operation_key)
  local d17_midi_edit_operation = d17_midi_edit_capability(request, operation_key)
  local d22_render_settings_write_operation = d22_render_settings_write_capability(request, operation_key)
  local d28_small_write_operation = d28_small_write_capability(request, operation_key)
  if not is_object(request.pack) or not FIXED_PACKS[request.pack.id] or not is_string(request.pack.capability) or not is_string(request.pack.risk) then
    return false, "pack.id, pack.capability, and pack.risk are required."
  end
  if a2_render_operation then
    if request.pack.id ~= "render" or request.pack.risk ~= "write" then
      return false, "A2 render_region_wav must be the render-owned write-risk route."
    end
  elseif safe_write_a_operation then
    if request.pack.id ~= safe_write_a_operation.pack or request.pack.risk ~= safe_write_a_operation.risk then
      return false, "Safe-Write-A request pack/capability/risk mismatch."
    end
  elseif e3_media_route_operation then
    if request.pack.id ~= e3_media_route_operation.pack or request.pack.risk ~= e3_media_route_operation.risk then
      return false, "E3 media route request pack/capability/risk mismatch."
    end
  elseif e4_item_route_operation then
    if request.pack.id ~= e4_item_route_operation.pack or request.pack.risk ~= e4_item_route_operation.risk then
      return false, "E4 item route request pack/capability/risk mismatch."
    end
  elseif e5_routing_write_operation then
    if request.pack.id ~= e5_routing_write_operation.pack or request.pack.risk ~= e5_routing_write_operation.risk then
      return false, "E5 routing write request pack/capability/risk mismatch."
    end
  elseif e5_automation_write_operation then
    if request.pack.id ~= e5_automation_write_operation.pack or request.pack.risk ~= e5_automation_write_operation.risk then
      return false, "E5 automation write request pack/capability/risk mismatch."
    end
  elseif e2_fx_b1_write_operation then
    if request.pack.id ~= e2_fx_b1_write_operation.pack or request.pack.risk ~= e2_fx_b1_write_operation.risk then
      return false, "E2 FX-B1 write request pack/capability/risk mismatch."
    end
  elseif d6_project_tempo_write_operation then
    if request.pack.id ~= d6_project_tempo_write_operation.pack or request.pack.risk ~= d6_project_tempo_write_operation.risk then
      return false, "D6 project tempo write request pack/capability/risk mismatch."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.pack.id ~= d9_tracks_mixer_write_operation.pack or request.pack.risk ~= d9_tracks_mixer_write_operation.risk then
      return false, "D9 tracks mixer write request pack/capability/risk mismatch."
    end
  elseif d11_project_marker_region_operation then
    if request.pack.id ~= d11_project_marker_region_operation.pack or request.pack.risk ~= d11_project_marker_region_operation.risk then
      return false, "D11 project marker/region request pack/capability/risk mismatch."
    end
  elseif d12_transport_safe_operation then
    if request.pack.id ~= d12_transport_safe_operation.pack or request.pack.risk ~= d12_transport_safe_operation.risk then
      return false, "D12 transport safe request pack/capability/risk mismatch."
    end
  elseif d13_items_core_write_operation then
    if request.pack.id ~= d13_items_core_write_operation.pack or request.pack.risk ~= d13_items_core_write_operation.risk then
      return false, "D13 items core request pack/capability/risk mismatch."
    end
  elseif d14_items_delete_operation then
    if request.pack.id ~= d14_items_delete_operation.pack or request.pack.risk ~= d14_items_delete_operation.risk then
      return false, "D14 items delete request pack/capability/risk mismatch."
    end
  elseif d15_items_source_phase_operation then
    if request.pack.id ~= d15_items_source_phase_operation.pack or request.pack.risk ~= d15_items_source_phase_operation.risk then
      return false, "D15 items source/phase request pack/capability/risk mismatch."
    end
  elseif d16_tracks_org_operation then
    if request.pack.id ~= d16_tracks_org_operation.pack or request.pack.risk ~= d16_tracks_org_operation.risk then
      return false, "D16 tracks organization request pack/capability/risk mismatch."
    end
  elseif d17_midi_edit_operation then
    if request.pack.id ~= d17_midi_edit_operation.pack or request.pack.risk ~= d17_midi_edit_operation.risk then
      return false, "D17 MIDI edit request pack/capability/risk mismatch."
    end
  elseif d22_render_settings_write_operation then
    if request.pack.id ~= d22_render_settings_write_operation.pack or request.pack.risk ~= d22_render_settings_write_operation.risk then
      return false, "D22 render settings write request pack/capability/risk mismatch."
    end
  elseif request.pack.risk ~= "read" then
    return false, "OpenReaper live bridge accepts read-only live-smoke requests only."
  end
  if not is_object(request.params) then
    return false, "params must be a JSON object."
  end
  if not is_json_array(request.refs) then
    return false, "refs must be a JSON array."
  end
  if not is_object(request.undo) then
    return false, "undo policy is required."
  end
  if a2_render_operation then
    if request.undo.mode ~= "required" then
      return false, "A2 render_region_wav must use undo.mode required."
    end
  elseif safe_write_a_operation then
    if request.undo.mode ~= "required" then
      return false, "Safe-Write-A write/safe requests must use undo.mode required."
    end
  elseif e3_media_route_operation then
    if request.undo.mode ~= "required" then
      return false, "E3 media route write requests must use undo.mode required."
    end
  elseif e4_item_route_operation then
    if request.undo.mode ~= "required" then
      return false, "E4 item route write requests must use undo.mode required."
    end
  elseif e5_routing_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E5 routing write requests must use undo.mode required."
    end
  elseif e5_automation_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E5 automation write requests must use undo.mode required."
    end
  elseif e2_fx_b1_write_operation then
    if request.undo.mode ~= "required" then
      return false, "E2 FX-B1 write requests must use undo.mode required."
    end
  elseif d6_project_tempo_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D6 project tempo write requests must use undo.mode required."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D9 tracks mixer write requests must use undo.mode required."
    end
  elseif d11_project_marker_region_operation then
    if request.undo.mode ~= "required" then
      return false, "D11 project marker/region requests must use undo.mode required."
    end
  elseif d12_transport_safe_operation then
    if request.undo.mode ~= "required" then
      return false, "D12 transport safe requests must use undo.mode required."
    end
  elseif d13_items_core_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D13 items core write requests must use undo.mode required."
    end
  elseif d14_items_delete_operation then
    if request.undo.mode ~= "required" then
      return false, "D14 items delete requests must use undo.mode required."
    end
  elseif d15_items_source_phase_operation then
    if request.undo.mode ~= "required" then
      return false, "D15 items source/phase requests must use undo.mode required."
    end
  elseif d16_tracks_org_operation then
    if request.undo.mode ~= "required" then
      return false, "D16 tracks organization requests must use undo.mode required."
    end
  elseif d17_midi_edit_operation then
    if request.undo.mode ~= "required" then
      return false, "D17 MIDI edit requests must use undo.mode required."
    end
  elseif d22_render_settings_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D22 render settings write requests must use undo.mode required."
    end
  elseif d28_small_write_operation then
    if request.undo.mode ~= "required" then
      return false, "D28 small write requests must use undo.mode required."
    end
  elseif request.undo.mode ~= "none" then
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
  if artifacts_allowed_for_operation then
    if request.artifacts.allow ~= true then
      return false, "Scoped First-Real-Fixture-A artifact handlers require artifacts.allow true."
    end
  elseif safe_write_a_operation then
    if request.artifacts.allow ~= false then
      return false, "Safe-Write-A write/safe requests must use artifacts.allow false."
    end
  elseif e3_media_route_operation then
    if request.artifacts.allow ~= false then
      return false, "E3 media route write requests must use artifacts.allow false."
    end
  elseif e4_item_route_operation then
    if request.artifacts.allow ~= false then
      return false, "E4 item route write requests must use artifacts.allow false."
    end
  elseif e5_routing_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E5 routing write requests must use artifacts.allow false."
    end
  elseif e5_automation_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E5 automation write requests must use artifacts.allow false."
    end
  elseif e2_fx_b1_write_operation then
    if request.artifacts.allow ~= false then
      return false, "E2 FX-B1 write requests must use artifacts.allow false."
    end
  elseif d6_project_tempo_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D6 project tempo write requests must use artifacts.allow false."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D9 tracks mixer write requests must use artifacts.allow false."
    end
  elseif d11_project_marker_region_operation then
    if request.artifacts.allow ~= false then
      return false, "D11 project marker/region requests must use artifacts.allow false."
    end
  elseif d12_transport_safe_operation then
    if request.artifacts.allow ~= false then
      return false, "D12 transport safe requests must use artifacts.allow false."
    end
  elseif d13_items_core_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D13 items core write requests must use artifacts.allow false."
    end
  elseif d14_items_delete_operation then
    if request.artifacts.allow ~= false then
      return false, "D14 items delete requests must use artifacts.allow false."
    end
  elseif d15_items_source_phase_operation then
    if request.artifacts.allow ~= false then
      return false, "D15 items source/phase requests must use artifacts.allow false."
    end
  elseif d16_tracks_org_operation then
    if request.artifacts.allow ~= false then
      return false, "D16 tracks organization requests must use artifacts.allow false."
    end
  elseif d17_midi_edit_operation then
    if request.artifacts.allow ~= false then
      return false, "D17 MIDI edit requests must use artifacts.allow false."
    end
  elseif d22_render_settings_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D22 render settings write requests must use artifacts.allow false."
    end
  elseif d28_small_write_operation then
    if request.artifacts.allow ~= false then
      return false, "D28 small write requests must use artifacts.allow false."
    end
  elseif request.artifacts.allow ~= false then
    return false, "Only scoped First-Real-Fixture-A artifact handlers may write artifacts."
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
  if a2_render_operation then
    if not is_string(request.idempotency_key) then
      return false, "A2 render_region_wav requires an idempotency_key."
    end
  elseif safe_write_a_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "Safe-Write-A idempotency_key must be a string when present."
    end
  elseif e3_media_route_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E3 media route idempotency_key must be a string when present."
    end
  elseif e4_item_route_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E4 item route idempotency_key must be a string when present."
    end
  elseif e5_routing_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E5 routing write idempotency_key must be a string when present."
    end
  elseif e5_automation_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E5 automation write idempotency_key must be a string when present."
    end
  elseif e2_fx_b1_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "E2 FX-B1 write idempotency_key must be a string when present."
    end
  elseif d6_project_tempo_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D6 project tempo write idempotency_key must be a string when present."
    end
  elseif d9_tracks_mixer_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D9 tracks mixer write idempotency_key must be a string when present."
    end
  elseif d11_project_marker_region_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D11 project marker/region idempotency_key must be a string when present."
    end
  elseif d12_transport_safe_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D12 transport safe idempotency_key must be a string when present."
    end
  elseif d13_items_core_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D13 items core idempotency_key must be a string when present."
    end
  elseif d14_items_delete_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D14 items delete idempotency_key must be a string when present."
    end
  elseif d15_items_source_phase_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D15 items source/phase idempotency_key must be a string when present."
    end
  elseif d16_tracks_org_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D16 tracks organization idempotency_key must be a string when present."
    end
  elseif d17_midi_edit_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D17 MIDI edit idempotency_key must be a string when present."
    end
  elseif d22_render_settings_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D22 render settings write idempotency_key must be a string when present."
    end
  elseif d28_small_write_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "D28 small write idempotency_key must be a string when present."
    end
  elseif request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL then
    return false, "read-only live-smoke requests must not carry idempotency_key."
  end
  return true
end
-- OpenReaper bridge handler module wrapper: keeps handler locals out of the main Lua chunk and out of one giant function.
local dispatch_request = (function()
local OPENREAPER_HANDLER_EXPORTS = {}
local OPENREAPER_HANDLER_SHARED = {}
local function __openreaper_register_handler_module(module_name, loader)
  local module = loader()
  if type(module) ~= "table" then
    error("OpenReaper bridge handler module did not return exports: " .. tostring(module_name))
  end
  if type(module.shared) == "table" then
    for key, value in pairs(module.shared) do
      OPENREAPER_HANDLER_SHARED[key] = value
    end
  end
  if type(module.exports) == "table" then
    for key, value in pairs(module.exports) do
      OPENREAPER_HANDLER_EXPORTS[key] = value
    end
  end
end
-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/read_summary.lua
__openreaper_register_handler_module("project/read_summary.lua", function()
-- Extracted Wave 0 handler: template.project.read_summary.

local function read_project_summary_current_project()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0, bounded_string(project_path or "", 240)
  end
  return 0, ""
end

local function read_project_summary(request)
  local project, project_path = read_project_summary_current_project()
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
return {
  exports = { read_project_summary = read_project_summary },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/read_state.lua
__openreaper_register_handler_module("transport/read_state.lua", function()
-- Extracted Wave 0 handler: template.transport.read_state.

local function read_transport_state_has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function read_transport_state_play_state_label(value)
  if read_transport_state_has_flag(value, 4) then
    return "recording"
  elseif read_transport_state_has_flag(value, 1) then
    return "playing"
  elseif read_transport_state_has_flag(value, 2) then
    return "paused"
  elseif type(value) == "number" then
    return "stopped"
  end
  return "unknown"
end

local function read_transport_state_loop_time_range(is_loop)
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
    play_state = read_transport_state_play_state_label(ok_play_state and play_state or nil),
    edit_cursor_seconds = ok_cursor and first_number(edit_cursor) or 0,
    play_cursor_seconds = ok_play_position and first_number(play_position) or 0,
    repeat_enabled = ok_repeat and first_number(repeat_state) == 1 or false,
    time_selection = read_transport_state_loop_time_range(false),
    loop_points = read_transport_state_loop_time_range(true),
    truncated = false,
  }
end
return {
  exports = { read_transport_state = read_transport_state },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/core/read_openreaper_status.lua
__openreaper_register_handler_module("core/read_openreaper_status.lua", function()
-- Extracted Wave 0 handler: template.core.read_openreaper_status.

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
return {
  exports = { read_openreaper_status = read_openreaper_status },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/system/read_runtime_environment.lua
__openreaper_register_handler_module("system/read_runtime_environment.lua", function()
-- Extracted Wave 0 handler: template.system.read_runtime_environment.

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
return {
  exports = { read_runtime_environment = read_runtime_environment },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/system/read_resource_paths.lua
__openreaper_register_handler_module("system/read_resource_paths.lua", function()
-- Extracted Wave 0 handler: template.system.read_resource_paths.

local function read_resource_paths_current_script_dir()
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
    bridge_script_dir = request.params.include_script_path == true and read_resource_paths_current_script_dir() or nil,
    queue_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    transport_dir = include_queue_paths and bounded_string(TRANSPORT_DIR or "", 240) or nil,
    requests_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    results_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    pending_dir = include_queue_paths and bounded_string(REQUESTS_DIR or "", 240) or nil,
    done_dir = include_queue_paths and bounded_string(RESULTS_DIR or "", 240) or nil,
    queue_override_present = TRANSPORT_DIR ~= nil,
  }
end
return {
  exports = { read_resource_paths = read_resource_paths },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/core/read_template_catalog_summary.lua
__openreaper_register_handler_module("core/read_template_catalog_summary.lua", function()
-- Extracted Wave 1A handler: template.core.read_template_catalog_summary.

local READ_TEMPLATE_CATALOG_SUMMARY_COUNTS = {
  template_count = 129,
  by_pack = {
    actions = 8,
    analysis = 7,
    automation = 15,
    core = 3,
    fx = 15,
    items = 11,
    media = 7,
    midi = 12,
    project = 8,
    render = 7,
    routing = 15,
    system = 3,
    tracks = 8,
    transport = 10,
  },
  by_risk = {
    read = 66,
    safe = 9,
    write = 54,
  },
  by_lifecycle = {
    experimental = 129,
  },
  by_entity_kind = {
    action = 4,
    api_symbol = 1,
    automation_item = 3,
    automation_mode = 3,
    automation_point = 4,
    channel = 4,
    cleanup_report = 1,
    command_id = 1,
    core_state = 2,
    cursor = 1,
    custom_action = 1,
    cycle_action = 1,
    delivery_report = 1,
    envelope = 5,
    fx = 5,
    fx_chain = 3,
    fx_param = 3,
    item = 8,
    item_layer_report = 1,
    last_result = 1,
    loop_candidates = 1,
    loop_click_risk = 1,
    loop_qa_report = 1,
    loop_state = 3,
    marker = 2,
    marker_action = 1,
    media_file = 5,
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
    render_job = 1,
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

local READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS = {
  template_count = 73,
  by_pack = {
    actions = 6,
    analysis = 3,
    automation = 0,
    core = 3,
    fx = 6,
    items = 11,
    media = 7,
    midi = 10,
    project = 8,
    render = 2,
    routing = 0,
    system = 3,
    tracks = 7,
    transport = 7,
  },
}

local function read_template_catalog_summary_table_key_count(source)
  local count = 0
  for _ in pairs(source or {}) do
    count = count + 1
  end
  return count
end

local function read_template_catalog_summary_clone_counts(source)
  local result = {}
  for key, value in pairs(source or {}) do
    result[key] = value
  end
  return result
end

local function read_template_catalog_summary_count_for_key(source, key)
  local result = {}
  result[key] = source[key]
  return result
end

local function read_template_catalog_summary_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function read_template_catalog_summary(request)
  local pack = is_string(request.params.pack) and request.params.pack or nil
  if pack and not READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack[pack] then
    return read_template_catalog_summary_error("PARAMS_INVALID", "Requested pack is not in the accepted runtime catalog.", {
      pack = bounded_string(pack, 80),
    })
  end

  local template_count = pack and READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack[pack] or READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.template_count
  local live_supported_template_count = pack and READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack[pack] or READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.template_count
  local summary = {
    template_count = template_count,
    accepted_runtime_template_count = template_count,
    live_supported_template_count = live_supported_template_count,
    catalog_count_semantics = "template_count is the accepted runtime catalog count; live_supported_template_count is the current bridge handler row count.",
    pack_count = pack and 1 or read_template_catalog_summary_table_key_count(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack),
    by_pack = pack and read_template_catalog_summary_count_for_key(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack, pack) or read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack),
    live_supported_by_pack = pack and read_template_catalog_summary_count_for_key(READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack, pack) or read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack),
    by_lifecycle = request.params.include_lifecycle_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_lifecycle) or nil,
    by_risk = request.params.include_risk_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_risk) or nil,
    by_entity_kind = request.params.include_entity_kind_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_entity_kind) or nil,
    truncated = false,
  }
  return summary
end
return {
  exports = { read_template_catalog_summary = read_template_catalog_summary },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/core/read_last_result.lua
__openreaper_register_handler_module("core/read_last_result.lua", function()
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
return {
  exports = { read_last_result = read_last_result },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/system/check_api_symbols.lua
__openreaper_register_handler_module("system/check_api_symbols.lua", function()
-- Extracted Wave 1A handler: template.system.check_api_symbols.

local CHECK_API_SYMBOLS_CORE_RUNTIME_SYMBOLS = json_array({
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

local CHECK_API_SYMBOLS_EXTENSION_PROBE_SYMBOLS = json_array({
  "APIExists",
  "BR_GetMediaItemGUID",
  "CF_GetSWSVersion",
  "SNM_GetIntConfigVar",
})

local function check_api_symbols_profile_defaults(profile)
  if profile == "extension_probe" then
    return CHECK_API_SYMBOLS_EXTENSION_PROBE_SYMBOLS
  end
  return CHECK_API_SYMBOLS_CORE_RUNTIME_SYMBOLS
end

local function check_api_symbols_valid_name(name)
  return is_string(name) and name:match("^[A-Za-z_][A-Za-z0-9_]*$") ~= nil
end

local function check_api_symbols_available(name)
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

local function check_api_symbols_bounded_limit(request, requested, default_limit, hard_limit)
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

local function read_api_symbols(request)
  local profile = is_string(request.params.profile) and request.params.profile or "core_runtime"
  local source = is_json_array(request.params.symbols) and request.params.symbols or check_api_symbols_profile_defaults(profile)
  local limit = check_api_symbols_bounded_limit(request, request.params.max_symbols, 16, 50)
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
      local valid = check_api_symbols_valid_name(name)
      local available = valid and check_api_symbols_available(name) or false
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
return {
  exports = { read_api_symbols = read_api_symbols },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/read_metadata.lua
__openreaper_register_handler_module("project/read_metadata.lua", function()
-- Extracted Wave 1A handler: template.project.read_metadata.

local PROJECT_READ_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function read_project_metadata_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function read_project_metadata_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function read_project_metadata_requested_fields(fields)
  if not is_json_array(fields) or #fields == 0 then
    return json_array({ "title", "author", "notes" })
  end
  local result = json_array({})
  local seen = {}
  for index = 1, #fields do
    local field = fields[index]
    if PROJECT_READ_METADATA_KEYS[field] and not seen[field] then
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
  local project = read_project_metadata_current_project()
  local fields = read_project_metadata_requested_fields(request.params.fields)
  local budget = safe_budget(request)
  local summary = {
    project_ref = "project:current",
  }
  for index = 1, #fields do
    local field = fields[index]
    summary[field] = read_project_metadata_info_string(project, PROJECT_READ_METADATA_KEYS[field], math.min(budget.max_inline_value_bytes, 1024))
  end
  return summary
end
return {
  exports = { read_project_metadata = read_project_metadata },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/list_markers_regions.lua
__openreaper_register_handler_module("project/list_markers_regions.lua", function()
-- Extracted Wave 1A handler: template.project.list_markers_regions.

local function list_markers_regions_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function list_markers_regions_bounded_limit(request, requested, default_limit, hard_limit)
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

local function list_markers_regions_marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return prefix .. ":index:" .. tostring(index_number or 0)
end

local function list_markers_regions(request)
  local project = list_markers_regions_current_project()
  local include_markers = request.params.include_markers ~= false
  local include_regions = request.params.include_regions ~= false
  local limit = list_markers_regions_bounded_limit(request, request.params.limit, 50, 50)
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
            item.region_ref = list_markers_regions_marker_ref("region", index_number)
            item.end_seconds = first_number(region_end) or item.position_seconds
          else
            item.marker_ref = list_markers_regions_marker_ref("marker", index_number)
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
return {
  exports = { list_markers_regions = list_markers_regions },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/read_tempo_map.lua
__openreaper_register_handler_module("project/read_tempo_map.lua", function()
-- Extracted Wave 1A handler: template.project.read_tempo_map.

local function read_tempo_map_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function read_tempo_map_bounded_limit(request, requested, default_limit, hard_limit)
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

local function read_tempo_map(request)
  local project = read_tempo_map_current_project()
  local limit = read_tempo_map_bounded_limit(request, request.params.limit, 32, 50)
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
  local effective_limit = read_tempo_map_bounded_limit(request, #requested_times, math.min(#requested_times, 8), 16)
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
return {
  exports = { read_tempo_map = read_tempo_map },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/resolve_track_ref.lua
__openreaper_register_handler_module("tracks/resolve_track_ref.lua", function()
-- Extracted Wave 1A handler: template.tracks.resolve_track_ref.

local function resolve_track_ref_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function resolve_track_ref_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function resolve_track_ref_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function resolve_track_ref_track_index(track)
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

local function resolve_track_ref_string(track)
  local guid = resolve_track_ref_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(resolve_track_ref_track_index(track))
end

local function resolve_track_ref_solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function resolve_track_ref_summary(track)
  local index = resolve_track_ref_track_index(track)
  local ok_selected, selected = call_reaper("GetMediaTrackInfo_Value", track, "I_SELECTED")
  local ok_mute, muted = call_reaper("GetMediaTrackInfo_Value", track, "B_MUTE")
  local ok_solo, solo = call_reaper("GetMediaTrackInfo_Value", track, "I_SOLO")
  local ok_arm, armed = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
  local ok_color, color = call_reaper("GetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR")
  return {
    track_ref = resolve_track_ref_string(track),
    index = index,
    name = resolve_track_ref_track_name(track),
    selected = ok_selected and first_number(selected) == 1 or false,
    muted = ok_mute and first_number(muted) == 1 or false,
    solo_mode = resolve_track_ref_solo_label(ok_solo and first_number(solo) or 0),
    record_armed = ok_arm and first_number(armed) == 1 or false,
    color = ok_color and type(color) == "number" and color > 0 and tostring(math.floor(color)) or JSON_NULL,
  }
end

local function resolve_track_ref_find_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and resolve_track_ref_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function resolve_track_ref_find_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and resolve_track_ref_track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function resolve_track_ref_token(token)
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
    return resolve_track_ref_find_by_guid(guid)
  end

  local name = token:match("^track:(.+)$")
  if name then
    return resolve_track_ref_find_by_name(name)
  end
  return nil
end

local function resolve_track_ref(request)
  local track, reason = resolve_track_ref_token(request.params.track_ref)
  if reason == "ambiguous" then
    return resolve_track_ref_error("REF_INVALID", "Track name is ambiguous.", {
      track_ref = bounded_string(request.params.track_ref, 160),
    })
  end
  if not track then
    return resolve_track_ref_error("TRACK_NOT_FOUND", "Track ref could not be resolved.", {
      track_ref = bounded_string(request.params.track_ref, 160),
    })
  end
  return resolve_track_ref_summary(track)
end
return {
  exports = { resolve_track_ref = resolve_track_ref },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/resolve_item_ref.lua
__openreaper_register_handler_module("items/resolve_item_ref.lua", function()
-- Extracted Wave 1A handler: template.items.resolve_item_ref.

local function resolve_item_ref_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function resolve_item_ref_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function resolve_item_ref_track_index(track)
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

local function resolve_item_ref_track_ref_string(track)
  local guid = resolve_item_ref_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(resolve_item_ref_track_index(track))
end

local function resolve_item_ref_item_guid(item)
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

local function resolve_item_ref_item_ref_string(item)
  local guid = resolve_item_ref_item_guid(item)
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

local function resolve_item_ref_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and resolve_item_ref_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function resolve_item_ref_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function resolve_item_ref_token(token)
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
    return resolve_item_ref_find_item_by_guid(guid)
  end
  return nil
end

local function resolve_item_ref_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function resolve_item_ref_summary(item)
  local track = resolve_item_ref_item_track(item)
  return {
    item_ref = resolve_item_ref_item_ref_string(item),
    track_ref = track and resolve_item_ref_track_ref_string(track) or JSON_NULL,
    position_seconds = resolve_item_ref_number(item, "D_POSITION"),
    length_seconds = resolve_item_ref_number(item, "D_LENGTH"),
    snap_offset_seconds = resolve_item_ref_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = resolve_item_ref_number(item, "D_FADEINLEN"),
    fade_out_seconds = resolve_item_ref_number(item, "D_FADEOUTLEN"),
  }
end

local function resolve_item_ref(request)
  local item = resolve_item_ref_token(request.params.ref)
  if not item then
    return resolve_item_ref_error("ITEM_NOT_FOUND", "Item ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
  end
  return resolve_item_ref_summary(item)
end
return {
  exports = { resolve_item_ref = resolve_item_ref },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/read_item_summary.lua
__openreaper_register_handler_module("items/read_item_summary.lua", function()
-- Extracted Wave 1A handler: template.items.read_item_summary.

local function read_item_summary_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function read_item_summary_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function read_item_summary_track_index(track)
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

local function read_item_summary_track_ref_string(track)
  local guid = read_item_summary_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(read_item_summary_track_index(track))
end

local function read_item_summary_item_guid(item)
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

local function read_item_summary_item_ref_string(item)
  local guid = read_item_summary_item_guid(item)
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

local function read_item_summary_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and read_item_summary_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function read_item_summary_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function read_item_summary_resolve_token(token)
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
    return read_item_summary_find_item_by_guid(guid)
  end
  return nil
end

local function read_item_summary_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return read_item_summary_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return read_item_summary_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return read_item_summary_resolve_token("guid:" .. tostring(identity.value))
  end
  return read_item_summary_resolve_token(ref.ref)
end

local function read_item_summary_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function read_item_summary_value(item, include_take_summary)
  local track = read_item_summary_item_track(item)
  local summary = {
    item_ref = read_item_summary_item_ref_string(item),
    track_ref = track and read_item_summary_track_ref_string(track) or JSON_NULL,
    position_seconds = read_item_summary_number(item, "D_POSITION"),
    length_seconds = read_item_summary_number(item, "D_LENGTH"),
    snap_offset_seconds = read_item_summary_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = read_item_summary_number(item, "D_FADEINLEN"),
    fade_out_seconds = read_item_summary_number(item, "D_FADEOUTLEN"),
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

local function read_item_summary(request)
  local item = nil
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      item = read_item_summary_from_ref_object(request.refs[index])
      if item then
        break
      end
    end
  end
  if not item then
    return read_item_summary_error("ITEM_NOT_FOUND", "Item summary requires a resolvable item ref.", {})
  end
  return read_item_summary_value(item, request.params.include_take_summary == true)
end
return {
  exports = { read_item_summary = read_item_summary },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/tempo_write.lua
__openreaper_register_handler_module("project/tempo_write.lua", function()
-- Extracted D6 handler: project tempo/BPM writes.

local function d6_tempo_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d6_tempo_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d6_tempo_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d6_tempo_bounded_bpm(value)
  if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
    return nil
  end
  if value < 20 or value > 400 then
    return nil
  end
  return value
end

local function d6_tempo_time_sig_num(value)
  local number = math.floor(tonumber(value) or 4)
  if number < 1 then
    return 4
  end
  if number > 32 then
    return 32
  end
  return number
end

local function d6_tempo_time_sig_denom(value)
  local number = math.floor(tonumber(value) or 4)
  if number == 1 or number == 2 or number == 4 or number == 8 or number == 16 or number == 32 then
    return number
  end
  return 4
end

local function d6_tempo_effective_at(project, position_seconds)
  local ok, timesig_num, timesig_denom, bpm = call_reaper("TimeMap_GetTimeSigAtTime", project, position_seconds)
  return {
    bpm = ok and first_number(bpm) or 0,
    time_sig_num = ok and math.floor(first_number(timesig_num) or 0) or 0,
    time_sig_denom = ok and math.floor(first_number(timesig_denom) or 0) or 0,
  }
end

local function d6_tempo_current_bpm(project)
  local ok, bpm = call_reaper("Master_GetTempo")
  if ok and type(bpm) == "number" then
    return bpm
  end
  return d6_tempo_effective_at(project, 0).bpm
end

local function d6_tempo_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.project_ref = "project:current"
  fields.truncated = false
  return fields
end

local function d6_tempo_refs()
  return json_array({ d6_tempo_project_ref() })
end

local function d6_tempo_set_base(request)
  local project = d6_tempo_current_project()
  local bpm = d6_tempo_bounded_bpm(request.params.bpm)
  if not bpm then
    return d6_tempo_error("BPM_INVALID", "Project tempo writes require bpm between 20 and 400.", {
      bpm = request.params.bpm,
    })
  end
  local ok = call_reaper("SetCurrentBPM", project, bpm, false)
  if not ok then
    return d6_tempo_error("COMMAND_FAILED", "REAPER rejected SetCurrentBPM.", {
      bpm = bpm,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback_bpm = d6_tempo_current_bpm(project)
  local updated = math.abs(readback_bpm - bpm) < 0.01
  if not updated then
    return d6_tempo_error("READBACK_MISMATCH", "Project tempo write did not read back the requested BPM.", {
      requested_bpm = bpm,
      readback_bpm = readback_bpm,
    }, false)
  end
  return d6_tempo_summary(request, {
    bpm = readback_bpm,
    requested_bpm = bpm,
    updated = updated,
    preserve_tempo_markers = request.params.preserve_tempo_markers == true,
  }), nil, json_array({}), json_array({}), d6_tempo_refs()
end

local function d6_tempo_marker_index_at(project, position_seconds)
  local ok_count, count = call_reaper("CountTempoTimeSigMarkers", project)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_marker, retval, timepos = call_reaper("GetTempoTimeSigMarker", project, index)
    if ok_marker and retval and math.abs((first_number(timepos) or 0) - position_seconds) < 0.000001 then
      return index
    end
  end
  return -1
end

local function d6_tempo_set_marker(request)
  local project = d6_tempo_current_project()
  local bpm = d6_tempo_bounded_bpm(request.params.bpm)
  if not bpm then
    return d6_tempo_error("BPM_INVALID", "Tempo marker writes require bpm between 20 and 400.", {
      bpm = request.params.bpm,
    })
  end
  local position_seconds = tonumber(request.params.position_seconds) or 0
  if position_seconds < 0 then
    return d6_tempo_error("POSITION_INVALID", "Tempo marker position_seconds must be non-negative.", {
      position_seconds = request.params.position_seconds,
    })
  end
  local numerator = d6_tempo_time_sig_num(request.params.time_signature_numerator)
  local denominator = d6_tempo_time_sig_denom(request.params.time_signature_denominator)
  local marker_index = d6_tempo_marker_index_at(project, position_seconds)
  local ok = call_reaper(
    "SetTempoTimeSigMarker",
    project,
    marker_index,
    position_seconds,
    -1,
    -1,
    bpm,
    numerator,
    denominator,
    request.params.linear_tempo == true
  )
  if not ok then
    return d6_tempo_error("COMMAND_FAILED", "REAPER rejected SetTempoTimeSigMarker.", {
      position_seconds = position_seconds,
      bpm = bpm,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local effective = d6_tempo_effective_at(project, position_seconds)
  local updated = math.abs(effective.bpm - bpm) < 0.01
  if not updated then
    return d6_tempo_error("READBACK_MISMATCH", "Tempo marker write did not read back the requested BPM.", {
      position_seconds = position_seconds,
      requested_bpm = bpm,
      readback_bpm = effective.bpm,
      time_sig_num = effective.time_sig_num,
      time_sig_denom = effective.time_sig_denom,
    }, false)
  end
  return d6_tempo_summary(request, {
    position_seconds = position_seconds,
    bpm = effective.bpm,
    requested_bpm = bpm,
    time_sig_num = effective.time_sig_num,
    time_sig_denom = effective.time_sig_denom,
    updated = updated,
  }), nil, json_array({}), json_array({}), d6_tempo_refs()
end

local function d6_project_set_tempo(request)
  return d6_tempo_set_base(request)
end

local function d6_project_set_bpm(request)
  return d6_tempo_set_base(request)
end

local function d6_project_set_tempo_marker(request)
  return d6_tempo_set_marker(request)
end
return {
  exports = { d6_project_set_tempo = d6_project_set_tempo, d6_project_set_bpm = d6_project_set_bpm, d6_project_set_tempo_marker = d6_project_set_tempo_marker },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/d20_project_grid_snap.lua
__openreaper_register_handler_module("project/d20_project_grid_snap.lua", function()
-- Extracted D20 handler: project grid writes.

local function d20_project_grid_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d20_project_grid_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d20_project_grid_refs()
  return json_array({
    {
      kind = "project",
      ref = "project:current",
      identity = {
        scheme = "current",
        value = "current",
      },
    },
  })
end

local function d20_project_grid_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.project_ref = "project:current"
  fields.truncated = false
  return fields
end

local function d20_project_grid_division(value)
  if type(value) == "number" and value == value and value > 0 and value <= 64 then
    return value, tostring(value)
  end
  if type(value) ~= "string" then
    return nil, nil
  end
  local numerator, denominator = value:match("^%s*(%d+)%s*/%s*(%d+)%s*$")
  if numerator and denominator then
    local num = tonumber(numerator)
    local den = tonumber(denominator)
    if num and den and num > 0 and den > 0 then
      local division = (num / den) * 4
      if division > 0 and division <= 64 then
        return division, tostring(num) .. "/" .. tostring(den)
      end
    end
  end
  local numeric = tonumber(value)
  if numeric and numeric > 0 and numeric <= 64 then
    return numeric, tostring(numeric)
  end
  return nil, nil
end

local function d20_project_grid_read(project)
  local ok, division = call_reaper("GetSetProjectGrid", project, false, 0)
  if ok and type(division) == "number" then
    return division
  end
  return nil
end

local function d20_project_snap_read(project)
  local ok, enabled = call_reaper("GetToggleCommandStateEx", 0, 1157)
  if ok and type(enabled) == "number" then
    return enabled ~= 0
  end
  local ok_info, value = call_reaper("GetSetProjectInfo", project, "PROJECT_GRID_USE", 0, false)
  if ok_info and type(value) == "number" then
    return value ~= 0
  end
  return nil
end

local function d20_project_set_grid(request)
  local project = d20_project_grid_current_project()
  local division, division_label = d20_project_grid_division(request.params.division)
  if not division then
    return d20_project_grid_error("GRID_DIVISION_INVALID", "Project grid division must be a positive numeric value or fraction string.", {
      division = request.params.division,
    })
  end
  local ok = call_reaper("GetSetProjectGrid", project, true, division)
  if not ok then
    return d20_project_grid_error("COMMAND_FAILED", "REAPER rejected project grid update.", {
      division = division_label,
      division_qn = division,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d20_project_grid_read(project)
  local updated = type(readback) == "number" and math.abs(readback - division) < 0.000001
  if not updated then
    return d20_project_grid_error("READBACK_MISMATCH", "Project grid division did not read back the requested value.", {
      requested_division = division_label,
      requested_division_qn = division,
      readback_division_qn = readback,
    }, false)
  end
  return d20_project_grid_summary(request, {
    division = division_label,
    division_qn = readback,
    swing = request.params.swing,
    updated = true,
  }), nil, json_array({}), json_array({}), d20_project_grid_refs()
end

local function d20_project_set_snap(request)
  local project = d20_project_grid_current_project()
  local enabled = request.params.enabled == true
  local ok = call_reaper("GetSetProjectInfo", project, "PROJECT_GRID_USE", enabled and 1 or 0, true)
  if not ok then
    return d20_project_grid_error("COMMAND_FAILED", "REAPER rejected project snap update.", {
      enabled = enabled,
    }, false)
  end
  call_reaper("UpdateTimeline")
  local readback = d20_project_snap_read(project)
  if readback == nil then
    return d20_project_grid_error("READBACK_UNAVAILABLE", "Project snap state could not be read back.", {
      enabled = enabled,
    }, false)
  end
  if readback ~= enabled then
    return d20_project_grid_error("READBACK_MISMATCH", "Project snap state did not read back the requested value.", {
      requested_enabled = enabled,
      readback_enabled = readback,
    }, false)
  end
  return d20_project_grid_summary(request, {
    enabled = readback,
    updated = true,
  }), nil, json_array({}), json_array({}), d20_project_grid_refs()
end
return {
  exports = { d20_project_set_grid = d20_project_set_grid, d20_project_set_snap = d20_project_set_snap },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/render/d21_render_read_route.lua
__openreaper_register_handler_module("render/d21_render_read_route.lua", function()
-- Extracted D21 handler: render read-only controls.

local function d21_render_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d21_render_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d21_render_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function d21_render_number(project, key, fallback)
  local ok, value = call_reaper("GetSetProjectInfo", project, key, 0, false)
  if ok and type(value) == "number" then
    return value
  end
  return fallback or 0
end

local function d21_render_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d21_render_region_ref(region_index)
  return "region:index:" .. tostring(region_index or 0)
end

local function d21_render_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d21_render_track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  return 0
end

local function d21_render_track_ref(track)
  local guid = d21_render_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d21_render_track_index(track))
end

local function d21_render_ref_object(kind, ref, scheme, value, summary)
  return {
    kind = kind,
    ref = ref,
    identity = {
      scheme = scheme,
      value = value,
    },
    summary = summary,
  }
end

local function d21_render_region_token_from_request(request)
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if ref.kind == "region" then
      local raw = ref.ref or ""
      local by_index = raw:match("^region:index:(%-?%d+)$")
      if by_index then
        return { scheme = "index", value = tonumber(by_index), ref = raw }
      end
      local by_name = raw:match("^region:name:(.+)$")
      if by_name then
        return { scheme = "name", value = by_name, ref = raw }
      end
    end
  end
  return nil
end

local function d21_render_regions(project, limit)
  local regions = json_array({})
  local ok_count, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = ok_count and math.max(0, math.floor((first_number(marker_count) or 0) + (first_number(region_count) or 0))) or 0
  local max_regions = math.min(limit or 100, 256)
  for index = 0, total - 1 do
    local ok, retval, is_region, start_pos, end_pos, name, region_index = call_reaper("EnumProjectMarkers3", project, index)
    if ok and retval and is_region == true then
      regions[#regions + 1] = {
        index = math.floor(first_number(region_index) or (#regions + 1)),
        name = bounded_string(first_string(name) or "", 160),
        start_seconds = first_number(start_pos) or 0,
        end_seconds = first_number(end_pos) or 0,
      }
      if #regions >= max_regions then
        break
      end
    end
  end
  return regions
end

local function d21_render_resolve_region(request)
  local project = d21_render_current_project()
  local token = d21_render_region_token_from_request(request)
  if not token then
    return nil, "REGION_REF_REQUIRED", "Render region read requires a region ref."
  end
  local matches = json_array({})
  local regions = d21_render_regions(project, 256)
  for index = 1, #regions do
    local region = regions[index]
    if token.scheme == "index" and region.index == token.value then
      matches[#matches + 1] = region
    elseif token.scheme == "name" and region.name == token.value then
      matches[#matches + 1] = region
    end
  end
  if #matches == 1 then
    return matches[1], nil, nil
  end
  if #matches > 1 then
    return nil, "REGION_AMBIGUOUS", "Render region ref matched multiple regions."
  end
  return nil, "REGION_NOT_FOUND", "Render region ref could not be resolved."
end

local function d21_render_bounds_from_kind(request)
  local project = d21_render_current_project()
  local kind = request.params.bounds_kind or "current_settings"
  if kind == "custom" then
    local start_seconds = tonumber(request.params.start_position_seconds)
    local end_seconds = tonumber(request.params.end_position_seconds)
    if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds < start_seconds then
      return nil, d21_render_error("BOUNDS_INVALID", "Custom render bounds require non-negative start/end with end >= start.", {
        start_position_seconds = request.params.start_position_seconds,
        end_position_seconds = request.params.end_position_seconds,
      })
    end
    return {
      resolved_kind = "custom",
      start_position_seconds = start_seconds,
      end_position_seconds = end_seconds,
      duration_seconds = end_seconds - start_seconds,
      label = bounded_string(request.params.label or "custom", 160),
    }
  end
  if kind == "time_selection" then
    local ok, start_seconds, end_seconds = call_reaper("GetSet_LoopTimeRange", false, false, 0, 0, false)
    if not ok or type(start_seconds) ~= "number" or type(end_seconds) ~= "number" or end_seconds <= start_seconds then
      return nil, d21_render_error("TIME_SELECTION_EMPTY", "Render bounds requested time selection, but no active time selection was found.", {})
    end
    return {
      resolved_kind = "time_selection",
      start_position_seconds = start_seconds,
      end_position_seconds = end_seconds,
      duration_seconds = end_seconds - start_seconds,
      label = "time_selection",
    }
  end
  if kind == "region" then
    local region, code, message = d21_render_resolve_region(request)
    if not region then
      return nil, d21_render_error(code, message, {})
    end
    return {
      resolved_kind = "region",
      region_ref = d21_render_region_ref(region.index),
      start_position_seconds = region.start_seconds,
      end_position_seconds = region.end_seconds,
      duration_seconds = region.end_seconds - region.start_seconds,
      label = region.name,
    }
  end
  if kind == "selected_project_regions" then
    return nil, d21_render_error("SELECTED_REGIONS_UNAVAILABLE", "Selected project regions are not exposed by the bounded D21 read route.", {})
  end
  local ok_length, project_length = call_reaper("GetProjectLength", project)
  local end_seconds = ok_length and first_number(project_length) or 0
  return {
    resolved_kind = "entire_project",
    start_position_seconds = 0,
    end_position_seconds = end_seconds,
    duration_seconds = end_seconds,
    label = "entire_project",
  }
end

local function read_render_settings(request)
  local project = d21_render_current_project()
  local start_seconds = d21_render_number(project, "RENDER_STARTPOS", 0)
  local end_seconds = d21_render_number(project, "RENDER_ENDPOS", 0)
  return d21_render_summary(request, {
    bounds_flag = math.floor(d21_render_number(project, "RENDER_BOUNDSFLAG", 0)),
    start_position_seconds = start_seconds,
    end_position_seconds = end_seconds,
    sample_rate = math.floor(d21_render_number(project, "RENDER_SRATE", 0)),
    channel_count = math.floor(d21_render_number(project, "RENDER_CHANNELS", 0)),
    ["output_directory"] = d21_render_string(project, "RENDER_FILE", 240),
    filename_pattern = d21_render_string(project, "RENDER_PATTERN", 160),
    format_fingerprint = bounded_string(d21_render_string(project, "RENDER_FORMAT", 80), 80),
    render_flags = json_array({}),
  }), nil, json_array({}), json_array({}), json_array({})
end

local function resolve_render_bounds(request)
  local bounds, err = d21_render_bounds_from_kind(request)
  if err then
    return nil, err
  end
  return d21_render_summary(request, bounds), nil, json_array({}), json_array({}), json_array({})
end

local function d21_render_target_name(pattern, label, index)
  local value = pattern
  if type(value) ~= "string" or value == "" then
    value = "$project"
  end
  value = value:gsub("%$region", label ~= "" and label or ("region_" .. tostring(index)))
  value = value:gsub("%$project", "current_project")
  value = value:gsub("[/\\:%c]", "_")
  if value == "" then
    value = "render_target_" .. tostring(index)
  end
  return bounded_string(value, 160)
end

local function preview_render_targets(request)
  local limit = bounded_limit(request, request.params.max_targets, 8, 32)
  local project = d21_render_current_project()
  local output_dir = bounded_string(request.params.output_directory or d21_render_string(project, "RENDER_FILE", 240), 240)
  local filename_pattern = bounded_string(request.params.filename_pattern or d21_render_string(project, "RENDER_PATTERN", 160), 160)
  local bounds_kind = request.params.bounds_kind or "current_settings"
  local targets = json_array({})
  local refs = json_array({})
  if bounds_kind == "selected_project_regions" then
    local regions = d21_render_regions(project, limit)
    for index = 1, #regions do
      local region = regions[index]
      local name = d21_render_target_name(filename_pattern, region.name, index)
      local ref = "file:render-preview:" .. tostring(index)
      targets[#targets + 1] = {
        file_ref = ref,
        ["output_directory"] = output_dir,
        filename = name,
        region_ref = d21_render_region_ref(region.index),
      }
      refs[#refs + 1] = d21_render_ref_object("file", ref, "render_preview", tostring(index), "Predicted render target.")
    end
  else
    local bounds, err = d21_render_bounds_from_kind({
      params = {
        bounds_kind = bounds_kind == "current_settings" and "entire_project" or bounds_kind,
        start_position_seconds = request.params.start_position_seconds,
        end_position_seconds = request.params.end_position_seconds,
        label = request.params.label,
      },
      refs = request.refs,
    })
    if err then
      return nil, err
    end
    local ref = "file:render-preview:1"
    targets[#targets + 1] = {
      file_ref = ref,
      ["output_directory"] = output_dir,
      filename = d21_render_target_name(filename_pattern, bounds.label, 1),
      bounds = bounds,
    }
    refs[#refs + 1] = d21_render_ref_object("file", ref, "render_preview", "1", "Predicted render target.")
  end
  return d21_render_summary(request, {
    targets = targets,
    target_count = #targets,
    truncated = #targets >= limit,
  }), nil, refs, json_array({}), refs
end

local function read_region_render_matrix(request)
  local region, code, message = d21_render_resolve_region(request)
  if not region then
    return nil, d21_render_error(code, message, {})
  end
  local project = d21_render_current_project()
  local limit = bounded_limit(request, request.params.limit, 64, 128)
  local tracks = json_array({})
  local refs = json_array({})
  for matrix_index = 0, limit - 1 do
    local ok, track = call_reaper("EnumRegionRenderMatrix", project, region.index, matrix_index)
    if not ok or not track then
      break
    end
    local ref = d21_render_track_ref(track)
    tracks[#tracks + 1] = {
      track_ref = ref,
      index = d21_render_track_index(track),
    }
    refs[#refs + 1] = d21_render_ref_object("track", ref, "guid_or_index", ref, "Track in region render matrix.")
  end
  return d21_render_summary(request, {
    region_ref = d21_render_region_ref(region.index),
    tracks = tracks,
    track_count = #tracks,
    truncated = #tracks >= limit,
  }), nil, refs, json_array({}), refs
end
return {
  exports = { read_render_settings = read_render_settings, resolve_render_bounds = resolve_render_bounds, preview_render_targets = preview_render_targets, read_region_render_matrix = read_region_render_matrix },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/d9_tracks_mixer_route.lua
__openreaper_register_handler_module("tracks/d9_tracks_mixer_route.lua", function()
-- Extracted D9 tracks mixer/basic control handlers.

local function d9_tracks_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d9_tracks_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d9_tracks_append_refs(target, source)
  if not is_json_array(source) then
    return target
  end
  for index = 1, #source do
    target[#target + 1] = source[index]
  end
  return target
end

local function d9_tracks_limit(request, default_limit, hard_limit)
  local value = tonumber(request.params and request.params.limit)
  if not value or value < 1 then
    value = default_limit
  end
  value = math.floor(value)
  if value > hard_limit then
    value = hard_limit
  end
  return value
end

local function d9_tracks_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = request.pack.risk == "write" and "required" or "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function d9_tracks_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d9_tracks_index(track)
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

local function d9_tracks_ref_string(track)
  local guid = d9_tracks_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d9_tracks_index(track))
end

local function d9_tracks_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d9_tracks_object_ref(track)
  local ref = d9_tracks_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or d9_tracks_index(track)),
    },
    display = {
      name = d9_tracks_name(track),
      index = d9_tracks_index(track),
    },
  }
end

local function d9_tracks_find_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d9_tracks_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d9_tracks_resolve_token(token)
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
    return d9_tracks_find_by_guid(guid)
  end
  return nil
end

local function d9_tracks_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d9_tracks_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d9_tracks_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d9_tracks_resolve_token("guid:" .. tostring(identity.value))
  end
  return d9_tracks_resolve_token(ref.ref)
end

local function d9_tracks_from_request_refs(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = d9_tracks_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function d9_tracks_primary_from_request_refs(request)
  local tracks = d9_tracks_from_request_refs(request)
  if tracks[1] then
    return tracks[1]
  end
  return nil
end

local function d9_tracks_solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function d9_tracks_numeric(track, key, fallback)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, key)
  return ok and first_number(value) or fallback
end

local function d9_tracks_mixer_summary(track)
  return {
    track_ref = d9_tracks_ref_string(track),
    index = d9_tracks_index(track),
    name = d9_tracks_name(track),
    selected = d9_tracks_numeric(track, "I_SELECTED", 0) == 1,
    muted = d9_tracks_numeric(track, "B_MUTE", 0) == 1,
    solo_mode = d9_tracks_solo_label(d9_tracks_numeric(track, "I_SOLO", 0)),
    record_armed = d9_tracks_numeric(track, "I_RECARM", 0) == 1,
    volume = d9_tracks_numeric(track, "D_VOL", 1),
    pan = d9_tracks_numeric(track, "D_PAN", 0),
    width = d9_tracks_numeric(track, "D_WIDTH", 1),
    folder_depth = math.floor(d9_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0),
  }
end

local function d9_tracks_all(limit)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local tracks = {}
  local max_index = math.min(total, limit)
  for index = 0, max_index - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = track
    end
  end
  return tracks, total, total > limit
end

local function d9_tracks_selected(limit)
  local ok_count, count = call_reaper("CountSelectedTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local tracks = {}
  local max_index = math.min(total, limit)
  for index = 0, max_index - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = track
    end
  end
  return tracks, total, total > limit
end

local function list_tracks(request)
  local limit = d9_tracks_limit(request, 64, 256)
  local tracks, total, truncated = d9_tracks_all(limit)
  local rows = json_array({})
  local refs = json_array({})
  local selected_count = 0
  for index = 1, #tracks do
    local summary = d9_tracks_mixer_summary(tracks[index])
    rows[#rows + 1] = {
      track_ref = summary.track_ref,
      index = summary.index,
      name = summary.name,
      selected = summary.selected,
      record_armed = summary.record_armed,
      muted = summary.muted,
      solo_mode = summary.solo_mode,
    }
    if summary.selected then
      selected_count = selected_count + 1
    end
    refs[#refs + 1] = d9_tracks_object_ref(tracks[index])
  end
  return d9_tracks_summary(request, {
    tracks = rows,
    track_count = total,
    selected_count = selected_count,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function read_mixer_controls(request)
  local limit = d9_tracks_limit(request, 32, 128)
  local tracks = d9_tracks_from_request_refs(request)
  local total = #tracks
  local truncated = false
  if total == 0 and request.params and request.params.include_selected == true then
    tracks, total, truncated = d9_tracks_selected(limit)
  elseif total == 0 then
    tracks, total, truncated = d9_tracks_all(limit)
  elseif total > limit then
    truncated = true
    local bounded = {}
    for index = 1, limit do
      bounded[index] = tracks[index]
    end
    tracks = bounded
  end
  local rows = json_array({})
  local refs = json_array({})
  for index = 1, #tracks do
    rows[#rows + 1] = d9_tracks_mixer_summary(tracks[index])
    refs[#refs + 1] = d9_tracks_object_ref(tracks[index])
  end
  return d9_tracks_summary(request, {
    tracks = rows,
    track_count = total,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function read_folder_structure(request)
  local limit = d9_tracks_limit(request, 64, 256)
  local tracks, total, truncated = d9_tracks_all(limit)
  local rows = json_array({})
  local folders = json_array({})
  local refs = json_array({})
  local depth = 0
  local parent_stack = {}
  for index = 1, #tracks do
    local track = tracks[index]
    local summary = d9_tracks_mixer_summary(track)
    local parent_ref = depth > 0 and parent_stack[depth] or JSON_NULL
    rows[#rows + 1] = {
      track_ref = summary.track_ref,
      index = summary.index,
      name = summary.name,
      depth = depth,
      folder_depth = summary.folder_depth,
      parent_ref = parent_ref,
    }
    refs[#refs + 1] = d9_tracks_object_ref(track)
    if summary.folder_depth > 0 then
      parent_stack[depth + 1] = summary.track_ref
      folders[#folders + 1] = {
        folder_ref = summary.track_ref,
        index = summary.index,
        name = summary.name,
        opens_depth = summary.folder_depth,
      }
      depth = depth + summary.folder_depth
    elseif summary.folder_depth < 0 then
      depth = math.max(0, depth + summary.folder_depth)
      for stack_index = depth + 1, #parent_stack do
        parent_stack[stack_index] = nil
      end
    end
  end
  return d9_tracks_summary(request, {
    folders = folders,
    tracks = rows,
    track_count = total,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), refs
end

local function d9_tracks_write_update(request, updater, readback_key, requested_value, tolerance)
  local track = d9_tracks_primary_from_request_refs(request)
  if not track then
    return d9_tracks_error("TRACK_NOT_FOUND", "D9 tracks mixer write requires a resolvable track ref.")
  end
  local ok, failure = updater(track)
  if not ok then
    return nil, failure
  end
  call_reaper("TrackList_AdjustWindows", false)
  local summary = d9_tracks_mixer_summary(track)
  local actual = summary[readback_key]
  local matched = actual == requested_value
  if type(actual) == "number" and type(requested_value) == "number" then
    matched = math.abs(actual - requested_value) <= (tolerance or 0.000001)
  end
  if not matched then
    return d9_tracks_error("VERIFY_FAILED", "D9 tracks mixer write did not read back the requested value.", {
      field = readback_key,
      requested = requested_value,
      readback = actual,
    }, false)
  end
  summary.requested_value = requested_value
  summary.updated = true
  return d9_tracks_summary(request, summary), nil, json_array({}), json_array({}), d9_tracks_refs(d9_tracks_object_ref(track))
end

local function set_record_arm(request)
  if type(request.params and request.params.armed) ~= "boolean" then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_record_arm requires boolean armed.")
  end
  local armed = request.params.armed == true
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "I_RECARM", armed and 1 or 0)
    return true
  end, "record_armed", armed)
end

local function set_volume(request)
  local volume = tonumber(request.params and request.params.volume)
  if not volume or volume < 0 or volume > 4 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_volume requires volume between 0 and 4.", {
      volume = request.params and request.params.volume,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_VOL", volume)
    return true
  end, "volume", volume, 0.000001)
end

local function set_pan(request)
  local pan = tonumber(request.params and request.params.pan)
  if not pan or pan < -1 or pan > 1 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_pan requires pan between -1 and 1.", {
      pan = request.params and request.params.pan,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_PAN", pan)
    return true
  end, "pan", pan, 0.000001)
end

local function set_width(request)
  local width = tonumber(request.params and request.params.width)
  if not width or width < 0 or width > 2 then
    return d9_tracks_error("PARAMS_INVALID", "D9 set_width requires width between 0 and 2.", {
      width = request.params and request.params.width,
    })
  end
  return d9_tracks_write_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "D_WIDTH", width)
    return true
  end, "width", width, 0.000001)
end
return {
  exports = { list_tracks = list_tracks, read_mixer_controls = read_mixer_controls, read_folder_structure = read_folder_structure, set_record_arm = set_record_arm, set_volume = set_volume, set_pan = set_pan, set_width = set_width },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/read_track_item_overview.lua
__openreaper_register_handler_module("project/read_track_item_overview.lua", function()
-- Extracted D10 handler: template.project.read_track_item_overview.

local function d10_overview_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d10_overview_bounded_limit(request, requested, default_limit, hard_limit)
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

local function d10_overview_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d10_overview_track_index(track)
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

local function d10_overview_track_ref_string(track)
  local guid = d10_overview_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d10_overview_track_index(track))
end

local function d10_overview_track_ref(track)
  local ref = d10_overview_track_ref_string(track)
  local guid = ref:match("^track:guid:(.+)$")
  if guid then
    return {
      kind = "track",
      ref = ref,
      identity = {
        scheme = "guid",
        value = guid,
      },
    }
  end
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = "index",
      value = tostring(d10_overview_track_index(track)),
    },
  }
end

local function d10_overview_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d10_overview_item_guid(item)
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

local function d10_overview_item_index(item)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return index
    end
  end
  return 0
end

local function d10_overview_item_ref_string(item)
  local guid = d10_overview_item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  return "item:index:" .. tostring(d10_overview_item_index(item))
end

local function d10_overview_item_ref(item)
  local ref = d10_overview_item_ref_string(item)
  local guid = ref:match("^item:guid:(.+)$")
  if guid then
    return {
      kind = "item",
      ref = ref,
      identity = {
        scheme = "guid",
        value = guid,
      },
    }
  end
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = "index",
      value = tostring(d10_overview_item_index(item)),
    },
  }
end

local function d10_overview_item_summary(item, track)
  return {
    item_ref = d10_overview_item_ref_string(item),
    track_ref = track and d10_overview_track_ref_string(track) or JSON_NULL,
    index = d10_overview_item_index(item),
    position_seconds = first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "D_POSITION"))) or 0,
    length_seconds = first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH"))) or 0,
    selected = (first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "B_UISEL"))) or 0) == 1,
  }
end

local function d10_overview_track_summary(track, max_items_per_track)
  local ok_track_items, track_item_count = call_reaper("CountTrackMediaItems", track)
  local item_count = ok_track_items and math.max(0, math.floor(first_number(track_item_count) or 0)) or 0
  local items = json_array({})
  for index = 0, math.min(item_count, max_items_per_track) - 1 do
    local ok_item, item = call_reaper("GetTrackMediaItem", track, index)
    if ok_item and item then
      items[#items + 1] = d10_overview_item_summary(item, track)
    end
  end
  return {
    track_ref = d10_overview_track_ref_string(track),
    index = d10_overview_track_index(track),
    name = d10_overview_track_name(track),
    item_count = item_count,
    items = items,
    items_truncated = item_count > #items,
  }
end

local function read_track_item_overview(request)
  local max_tracks = d10_overview_bounded_limit(request, request.params.max_tracks, 24, 128)
  local max_items_per_track = d10_overview_bounded_limit(request, request.params.max_items_per_track, 8, 64)
  local include_selected_items = request.params.include_selected_items ~= false
  local ok_tracks, track_count = call_reaper("CountTracks", 0)
  local ok_items, item_count = call_reaper("CountMediaItems", 0)
  local total_tracks = ok_tracks and math.max(0, math.floor(first_number(track_count) or 0)) or 0
  local total_items = ok_items and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  local tracks = json_array({})
  local selected_items = json_array({})
  local refs = json_array({ d10_overview_project_ref() })

  for index = 0, math.min(total_tracks, max_tracks) - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = d10_overview_track_summary(track, max_items_per_track)
      refs[#refs + 1] = d10_overview_track_ref(track)
    end
  end

  if include_selected_items then
    local ok_selected, selected_count = call_reaper("CountSelectedMediaItems", 0)
    local total_selected = ok_selected and math.max(0, math.floor(first_number(selected_count) or 0)) or 0
    local selected_limit = d10_overview_bounded_limit(request, total_selected, 16, 64)
    for index = 0, math.min(total_selected, selected_limit) - 1 do
      local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
      if ok_item and item then
        local ok_track, track = call_reaper("GetMediaItemTrack", item)
        selected_items[#selected_items + 1] = d10_overview_item_summary(item, ok_track and track or nil)
        refs[#refs + 1] = d10_overview_item_ref(item)
      end
    end
  end

  return {
    project_ref = "project:current",
    tracks = tracks,
    selected_items = selected_items,
    track_count = total_tracks,
    item_count = total_items,
    truncated = total_tracks > #tracks,
  }, nil, json_array({}), json_array({}), refs
end
return {
  exports = { read_track_item_overview = read_track_item_overview },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/read_action_metadata.lua
__openreaper_register_handler_module("actions/read_action_metadata.lua", function()
local READ_B_ACTIONS = OPENREAPER_HANDLER_SHARED.READ_B_ACTIONS
-- Extracted read-only handler: template.actions.read_action_metadata.

local function read_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  return {
    section = section,
    command_id = command_id,
    named_command = named_command,
    display_name = display_name,
    available = command_id ~= nil and command_id > 0,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
  }
end

local function read_custom_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  local resolved = command_id ~= nil and command_id > 0
  return {
    section = section,
    named_command = named_command,
    command_id = resolved and command_id or nil,
    display_name = display_name,
    step_count = 0,
    has_step_details = false,
    steps_truncated = false,
    resolved = resolved,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
    metadata_scope = "bounded_metadata_only",
  }
end

local function read_cycle_action_metadata(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local named_command = READ_B_ACTIONS.reverse_named_command(command_id) or bounded_string(request.params.named_command, 160)
  local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
  local ok_sws, sws_version = call_reaper("CF_GetSWSVersion")
  local resolved = command_id ~= nil and command_id > 0
  return {
    section = section,
    named_command = named_command,
    command_id = resolved and command_id or nil,
    display_name = display_name,
    sws_available = ok_sws and type(sws_version) == "string" and sws_version ~= "",
    step_count = 0,
    conditional = false,
    steps_truncated = false,
    resolved = resolved,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
    metadata_scope = "bounded_metadata_only",
  }
end
return {
  exports = { read_custom_action_metadata = read_custom_action_metadata, read_cycle_action_metadata = read_cycle_action_metadata, read_action_metadata = read_action_metadata },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/d11_marker_region_mutations.lua
__openreaper_register_handler_module("project/d11_marker_region_mutations.lua", function()
-- Extracted D11 handler: project marker/region rename and removal mutations.

local function d11_project_marker_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d11_project_marker_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d11_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d11_marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return {
    kind = prefix,
    ref = prefix .. ":index:" .. tostring(index_number),
    identity = {
      scheme = "index",
      value = tostring(index_number),
    },
  }
end

local function d11_marker_ref_from_request(request, kind)
  local expected_kind = kind == "region" and "region" or "marker"
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == expected_kind then
        local identity = is_object(ref.identity) and ref.identity or {}
        if identity.scheme == "index" then
          return tonumber(identity.value)
        end
        local from_ref = tostring(ref.ref or ""):match("^" .. expected_kind .. ":index:(%d+)$")
        if from_ref then
          return tonumber(from_ref)
        end
      end
    end
  end
  local params_ref = bounded_string(request.params[expected_kind .. "_ref"], 120)
  local from_param = params_ref:match("^" .. expected_kind .. ":index:(%d+)$")
  if from_param then
    return tonumber(from_param)
  end
  return nil
end

local function d11_find_marker(project, kind, index_number)
  if type(index_number) ~= "number" or index_number < 0 then
    return nil
  end
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = ok_count and ((first_number(marker_count) or 0) + (first_number(region_count) or 0)) or 0
  for enum_index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, candidate_index, color = call_reaper("EnumProjectMarkers3", project, enum_index)
    if ok_enum and retval then
      local candidate_kind = is_region and "region" or "marker"
      if candidate_kind == kind and tonumber(candidate_index) == index_number then
        return {
          enum_index = enum_index,
          kind = kind,
          index = index_number,
          is_region = is_region == true,
          position_seconds = first_number(pos) or 0,
          end_seconds = first_number(region_end) or first_number(pos) or 0,
          name = bounded_string(name or "", 160),
          color = type(color) == "number" and color or 0,
        }
      end
    end
  end
  return nil
end

local function d11_marker_summary(request, marker, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.project_ref = "project:current"
  fields.ref = marker and (marker.kind .. ":index:" .. tostring(marker.index)) or fields.ref
  fields.kind = marker and marker.kind or fields.kind
  fields.index = marker and marker.index or fields.index
  fields.position_seconds = marker and marker.position_seconds or fields.position_seconds
  if marker and marker.kind == "region" then
    fields.end_seconds = marker.end_seconds
  end
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d11_marker_refs(kind, index_number)
  return json_array({
    d11_project_ref(),
    d11_marker_ref(kind, index_number),
  })
end

local function d11_project_rename_marker_region(request, kind)
  local project = d11_project_marker_current_project()
  local index_number = d11_marker_ref_from_request(request, kind)
  if not index_number then
    return d11_project_marker_error("REF_INVALID", "Marker/region rename requires an index ref.", {
      kind = kind,
    })
  end
  local marker = d11_find_marker(project, kind, index_number)
  if not marker then
    local code = kind == "region" and "REGION_NOT_FOUND" or "MARKER_NOT_FOUND"
    return d11_project_marker_error(code, "Marker/region ref could not be resolved.", {
      ref = kind .. ":index:" .. tostring(index_number),
    })
  end
  local name = bounded_string(request.params.name, 160)
  local ok = call_reaper(
    "SetProjectMarkerByIndex2",
    project,
    marker.enum_index,
    marker.is_region,
    marker.position_seconds,
    marker.end_seconds,
    marker.index,
    name,
    marker.color,
    0
  )
  if not ok then
    return d11_project_marker_error("COMMAND_FAILED", "REAPER rejected project marker/region rename.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  local readback = d11_find_marker(project, kind, index_number)
  if not readback or readback.name ~= name then
    return d11_project_marker_error("VERIFY_FAILED", "Project marker/region rename did not read back.", {
      ref = kind .. ":index:" .. tostring(index_number),
      requested_name = name,
      readback_name = readback and readback.name or JSON_NULL,
    }, false)
  end
  return d11_marker_summary(request, readback, {
    name = readback.name,
    updated = true,
  }), nil, json_array({}), json_array({}), d11_marker_refs(kind, index_number)
end

local function d11_project_delete_marker_region(request, kind)
  local project = d11_project_marker_current_project()
  local index_number = d11_marker_ref_from_request(request, kind)
  if not index_number then
    return d11_project_marker_error("REF_INVALID", "Marker/region delete requires an index ref.", {
      kind = kind,
    })
  end
  local marker = d11_find_marker(project, kind, index_number)
  if not marker then
    local code = kind == "region" and "REGION_NOT_FOUND" or "MARKER_NOT_FOUND"
    return d11_project_marker_error(code, "Marker/region ref could not be resolved.", {
      ref = kind .. ":index:" .. tostring(index_number),
    })
  end
  local ok = call_reaper("DeleteProjectMarker", project, index_number, kind == "region")
  if not ok then
    return d11_project_marker_error("COMMAND_FAILED", "REAPER rejected project marker/region delete.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  local readback = d11_find_marker(project, kind, index_number)
  if readback then
    return d11_project_marker_error("VERIFY_FAILED", "Project marker/region delete did not read back as removed.", {
      ref = kind .. ":index:" .. tostring(index_number),
    }, false)
  end
  return d11_marker_summary(request, marker, {
    deleted = true,
  }), nil, json_array({}), json_array({}), d11_marker_refs(kind, index_number)
end

local function d11_project_rename_marker(request)
  return d11_project_rename_marker_region(request, "marker")
end

local function d11_project_rename_region(request)
  return d11_project_rename_marker_region(request, "region")
end

local function d11_project_delete_marker(request)
  return d11_project_delete_marker_region(request, "marker")
end

local function d11_project_delete_region(request)
  return d11_project_delete_marker_region(request, "region")
end

local function d11_project_remove_marker(request)
  return d11_project_delete_marker_region(request, "marker")
end

local function d11_project_remove_region(request)
  return d11_project_delete_marker_region(request, "region")
end
return {
  exports = { d11_project_delete_marker = d11_project_delete_marker, d11_project_delete_region = d11_project_delete_region, d11_project_remove_marker = d11_project_remove_marker, d11_project_remove_region = d11_project_remove_region, d11_project_rename_marker = d11_project_rename_marker, d11_project_rename_region = d11_project_rename_region },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/d12_transport_safe_route.lua
__openreaper_register_handler_module("transport/d12_transport_safe_route.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted D12 handler: transport safe controls.

local function d12_transport_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d12_transport_refs()
  return json_array({})
end

local function d12_transport_has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function d12_transport_play_state_value()
  local ok_play_state, play_state = call_reaper("GetPlayState")
  return ok_play_state and first_number(play_state) or 0
end

local function d12_transport_is_recording()
  return d12_transport_has_flag(d12_transport_play_state_value(), 4)
end

local D12_TRANSPORT_RECORD_MODE_VALUES = {
  normal = 0,
  time_selection_auto_punch = 1,
  selected_items_auto_punch = 2,
}

local D12_TRANSPORT_RECORD_MODE_NAMES = {
  [0] = "normal",
  [1] = "time_selection_auto_punch",
  [2] = "selected_items_auto_punch",
}

local d12_transport_bounded_number

local function d12_transport_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.truncated = false
  return fields
end

local function d12_transport_state_summary(request)
  return d12_transport_summary(request, OPENREAPER_HANDLER_EXPORTS.read_transport_state({}))
end

local function d12_transport_playback_rate()
  local ok_rate, rate = call_reaper("Master_GetPlayRateAtTime", 0, 0)
  local number = ok_rate and first_number(rate) or nil
  if number and number > 0 then
    return number
  end
  return 1
end

local function d12_transport_record_mode_value()
  local ok, value = call_reaper("GetSetProjectInfo", 0, "RECMODE", 0, false)
  local number = ok and first_number(value) or 0
  return math.max(0, math.floor(number or 0))
end

local function d12_transport_record_mode_name()
  return D12_TRANSPORT_RECORD_MODE_NAMES[d12_transport_record_mode_value()] or "normal"
end

local function d12_transport_set_record_mode_value(mode)
  local value = D12_TRANSPORT_RECORD_MODE_VALUES[mode]
  if value == nil then
    return nil, d12_transport_error("PARAMS_INVALID", "Record mode must be normal, time_selection_auto_punch, or selected_items_auto_punch.", {
      mode = mode,
    })
  end
  local ok = call_reaper("GetSetProjectInfo", 0, "RECMODE", value, true)
  if not ok then
    return nil, d12_transport_error("COMMAND_FAILED", "REAPER rejected record mode update.", {
      mode = mode,
    }, false)
  end
  local readback = d12_transport_record_mode_name()
  if readback ~= mode then
    return nil, d12_transport_error("READBACK_MISMATCH", "Record mode did not read back the requested value.", {
      expected_mode = mode,
      actual_mode = readback,
    }, false)
  end
  return true, nil
end

local function d12_transport_armed_track_count()
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local armed = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      local ok_arm, value = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
      if ok_arm and first_number(value) == 1 then
        armed = armed + 1
      end
    end
  end
  return armed
end

local function d12_transport_recording_guard(request)
  if d12_transport_is_recording() then
    return d12_transport_error("RECORDING_ACTIVE", "Transport playback controls do not stop or modify active recording.", {
      capability = request.pack.capability,
    })
  end
  return nil
end

local function d12_transport_verify_state(request, expected_state)
  local state = d12_transport_state_summary(request)
  if state.play_state ~= expected_state then
    return d12_transport_error("READBACK_MISMATCH", "Transport state did not read back the expected value.", {
      expected_play_state = expected_state,
      actual_play_state = state.play_state,
    }, false)
  end
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_play(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local ok = call_reaper("OnPlayButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnPlayButton.", {}, false)
  end
  return d12_transport_verify_state(request, "playing")
end

local function d12_transport_pause(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local ok = call_reaper("OnPauseButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnPauseButton.", {}, false)
  end
  return d12_transport_verify_state(request, "paused")
end

local function d12_transport_stop_playback(request)
  local _, guard = d12_transport_recording_guard(request)
  if guard then
    return nil, guard
  end
  local ok = call_reaper("OnStopButton")
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected OnStopButton.", {}, false)
  end
  return d12_transport_verify_state(request, "stopped")
end

local function d12_transport_set_playback_rate(request)
  local rate = d12_transport_bounded_number(request.params.playback_rate)
  if not rate or rate < 0.25 or rate > 4 then
    return d12_transport_error("PARAMS_INVALID", "Playback rate must be between 0.25 and 4.", {
      playback_rate = request.params.playback_rate,
    })
  end
  local preserve_pitch = request.params.preserve_pitch == true
  local ok_set = call_reaper("SetPlayRate", rate, preserve_pitch)
  if not ok_set then
    ok_set = call_reaper("CSurf_OnPlayRateChange", rate)
  end
  if not ok_set then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected playback rate update.", {
      playback_rate = rate,
    }, false)
  end
  local readback = d12_transport_playback_rate()
  if math.abs(readback - rate) > 0.0001 then
    return d12_transport_error("READBACK_MISMATCH", "Playback rate did not read back the requested value.", {
      requested_playback_rate = rate,
      actual_playback_rate = readback,
    }, false)
  end
  return d12_transport_summary(request, {
    playback_rate = readback,
    preserve_pitch = preserve_pitch,
  }), nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_start_recording(request)
  if request.params.require_armed_track == true and d12_transport_armed_track_count() < 1 then
    return d12_transport_error("ARMED_TRACK_REQUIRED", "Starting recording requires at least one armed track.", {})
  end
  if request.params.respect_punch_range == true then
    local range = d12_transport_state_summary(request).time_selection or {}
    if range.active ~= true then
      return d12_transport_error("PUNCH_RANGE_REQUIRED", "Starting guarded punch recording requires an active time selection.", {})
    end
  end
  local ok = call_reaper("CSurf_OnRecord", nil)
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected CSurf_OnRecord.", {}, false)
  end
  local state = d12_transport_state_summary(request)
  if state.play_state ~= "recording" then
    return d12_transport_error("READBACK_MISMATCH", "Transport did not enter recording.", {
      actual_play_state = state.play_state,
    }, false)
  end
  state.record_state = "recording"
  state.armed_track_count = d12_transport_armed_track_count()
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_stop_recording(request)
  local policy = request.params.recorded_media_policy or "keep"
  if policy ~= "keep" then
    return d12_transport_error("POLICY_UNSUPPORTED", "Stopping recording only supports recorded_media_policy keep in this bridge window.", {
      recorded_media_policy = policy,
    })
  end
  local ok = call_reaper("CSurf_OnStop", nil)
  if not ok then
    ok = call_reaper("OnStopButton")
  end
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected stop recording.", {}, false)
  end
  local state = d12_transport_state_summary(request)
  if state.play_state == "recording" then
    return d12_transport_error("READBACK_MISMATCH", "Transport is still recording after stop.", {
      actual_play_state = state.play_state,
    }, false)
  end
  state.record_state = "stopped"
  state.recorded_media_policy = policy
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_set_record_mode(request)
  local ok, err = d12_transport_set_record_mode_value(request.params.mode)
  if not ok then
    return nil, err
  end
  return d12_transport_summary(request, {
    mode = d12_transport_record_mode_name(),
  }), nil, json_array({}), json_array({}), d12_transport_refs()
end

d12_transport_bounded_number = function(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d12_transport_set_punch_record_range(request)
  local start_seconds = d12_transport_bounded_number(request.params.start_seconds)
  local end_seconds = d12_transport_bounded_number(request.params.end_seconds)
  if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds < start_seconds then
    return d12_transport_error("PARAMS_INVALID", "Punch range requires non-negative start_seconds and end_seconds >= start_seconds.", {
      start_seconds = request.params.start_seconds,
      end_seconds = request.params.end_seconds,
    })
  end
  local ok = call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  if not ok then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected punch range update.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    }, false)
  end
  local state = d12_transport_state_summary(request)
  local range = state.time_selection or {}
  local matches = type(range.start_seconds) == "number"
    and type(range.end_seconds) == "number"
    and math.abs(range.start_seconds - start_seconds) < 0.000001
    and math.abs(range.end_seconds - end_seconds) < 0.000001
  if not matches then
    return d12_transport_error("READBACK_MISMATCH", "Punch range did not read back the requested bounds.", {
      requested_start_seconds = start_seconds,
      requested_end_seconds = end_seconds,
      readback = range,
    }, false)
  end
  state.punch_range = {
    start_seconds = range.start_seconds,
    end_seconds = range.end_seconds,
    active = range.active == true,
  }
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end

local function d12_transport_schedule_recording(request)
  local start_seconds = d12_transport_bounded_number(request.params.start_seconds)
  local end_seconds = d12_transport_bounded_number(request.params.end_seconds)
  if not start_seconds or not end_seconds or start_seconds < 0 or end_seconds <= start_seconds then
    return d12_transport_error("PARAMS_INVALID", "Scheduled recording requires non-negative start_seconds and end_seconds > start_seconds.", {
      start_seconds = request.params.start_seconds,
      end_seconds = request.params.end_seconds,
    })
  end
  if request.params.require_armed_track == true and d12_transport_armed_track_count() < 1 then
    return d12_transport_error("ARMED_TRACK_REQUIRED", "Scheduled recording requires at least one armed track.", {})
  end
  local ok_mode, mode_error = d12_transport_set_record_mode_value(request.params.mode)
  if not ok_mode then
    return nil, mode_error
  end
  local ok_range = call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  if not ok_range then
    return d12_transport_error("COMMAND_FAILED", "REAPER rejected scheduled recording time range.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    }, false)
  end
  local state = d12_transport_state_summary(request)
  state.scheduled_recording = {
    start_seconds = start_seconds,
    end_seconds = end_seconds,
    mode = d12_transport_record_mode_name(),
    require_armed_track = request.params.require_armed_track == true,
    armed_track_count = d12_transport_armed_track_count(),
    prepared = true,
    started = false,
  }
  return state, nil, json_array({}), json_array({}), d12_transport_refs()
end
return {
  exports = { d12_transport_play = d12_transport_play, d12_transport_pause = d12_transport_pause, d12_transport_stop_playback = d12_transport_stop_playback, d12_transport_set_playback_rate = d12_transport_set_playback_rate, d12_transport_start_recording = d12_transport_start_recording, d12_transport_stop_recording = d12_transport_stop_recording, d12_transport_set_record_mode = d12_transport_set_record_mode, d12_transport_set_punch_record_range = d12_transport_set_punch_record_range, d12_transport_schedule_recording = d12_transport_schedule_recording },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/d13_items_core_route.lua
__openreaper_register_handler_module("items/d13_items_core_route.lua", function()
-- Extracted D13 handler: items core read/write controls.

local function d13_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d13_items_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d13_items_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d13_items_bounded_limit(request, requested, default_limit, hard_limit)
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

local function d13_items_db_to_linear(db)
  return 10 ^ (db / 20)
end

local function d13_items_linear_to_db(value)
  if type(value) ~= "number" or value <= 0 then
    return -150
  end
  return 20 * math.log(value) / math.log(10)
end

local function d13_items_bounded_db(value)
  local db = d13_items_finite_number(value)
  if not db or db < -120 or db > 24 then
    return nil
  end
  return db
end

local function d13_items_bounded_pan(value)
  local pan = d13_items_finite_number(value)
  if not pan or pan < -1 or pan > 1 then
    return nil
  end
  return pan
end

local function d13_items_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d13_items_track_index(track)
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

local function d13_items_track_ref_string(track)
  local guid = d13_items_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d13_items_track_index(track))
end

local function d13_items_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d13_items_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d13_items_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d13_items_find_track_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d13_items_track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function d13_items_resolve_track_token(token)
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
    return d13_items_find_track_by_guid(guid)
  end
  local name = token:match("^track:(.+)$")
  if name then
    return d13_items_find_track_by_name(name)
  end
  return nil
end

local function d13_items_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d13_items_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d13_items_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d13_items_resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return d13_items_find_track_by_name(tostring(identity.value))
  end
  return d13_items_resolve_track_token(ref.ref)
end

local function d13_items_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = d13_items_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "D13 items request requires a resolvable track ref.",
    details = {},
  }
end

local function d13_items_item_guid(item)
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

local function d13_items_item_ref_string(item)
  local guid = d13_items_item_guid(item)
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

local function d13_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d13_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d13_items_resolve_item_token(token)
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
    return d13_items_find_item_by_guid(guid)
  end
  return nil
end

local function d13_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d13_items_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d13_items_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d13_items_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d13_items_resolve_item_token(ref.ref)
end

local function d13_items_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d13_items_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d13_items_item_object_ref(item)
  local ref = d13_items_item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d13_items_track_object_ref(track)
  local ref = d13_items_track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d13_items_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function d13_items_item_index(item)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return index
    end
  end
  return 0
end

local function d13_items_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function d13_items_take_number(take, key)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  return ok and first_number(value) or 0
end

local function d13_items_channel_mode_label(value)
  local number = math.floor(tonumber(value) or 0)
  if number == 1 then
    return "reverse_stereo"
  elseif number == 3 then
    return "mono_left"
  elseif number == 4 then
    return "mono_right"
  end
  return "normal"
end

local function d13_items_channel_mode_value(value)
  if value == "normal" then
    return 0
  elseif value == "reverse_stereo" then
    return 1
  elseif value == "mono_left" then
    return 3
  elseif value == "mono_right" then
    return 4
  end
  return nil
end

local function d13_items_pitch_mode_label(value)
  local number = math.floor(tonumber(value) or -1)
  if number == -1 then
    return "project_default"
  end
  return tostring(number)
end

local function d13_items_pitch_mode_value(value)
  if value == "project_default" or value == "default" then
    return -1
  end
  if is_string(value) and value:match("^%-?%d+$") then
    return tonumber(value)
  end
  return nil
end

local function d13_items_active_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function d13_items_take_name(take)
  local ok, _, name = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", "", false)
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d13_items_item_summary(item, include_take_summary)
  local track = d13_items_item_track(item)
  local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", item, "B_UISEL")
  local summary = {
    item_ref = d13_items_item_ref_string(item),
    item_index = d13_items_item_index(item),
    track_ref = track and d13_items_track_ref_string(track) or JSON_NULL,
    position_seconds = d13_items_item_number(item, "D_POSITION"),
    length_seconds = d13_items_item_number(item, "D_LENGTH"),
    snap_offset_seconds = d13_items_item_number(item, "D_SNAPOFFSET"),
    pan = d13_items_item_number(item, "D_PAN"),
    fade_in_seconds = d13_items_item_number(item, "D_FADEINLEN"),
    fade_out_seconds = d13_items_item_number(item, "D_FADEOUTLEN"),
    selected = ok_selected and first_number(selected) == 1 or false,
    volume_db = d13_items_linear_to_db(d13_items_item_number(item, "D_VOL")),
    muted = d13_items_item_number(item, "B_MUTE") == 1,
    locked = d13_items_item_number(item, "C_LOCK") ~= 0,
    loop_source = d13_items_item_number(item, "B_LOOPSRC") == 1,
    play_all_takes = d13_items_item_number(item, "B_ALLTAKESPLAY") == 1,
  }
  if include_take_summary then
    local ok_take_count, take_count = call_reaper("CountTakes", item)
    local take = d13_items_active_take(item)
    summary.take_count = ok_take_count and first_number(take_count) or 0
    if take then
      summary.active_take_name = d13_items_take_name(take)
      summary.take_volume_db = d13_items_linear_to_db(d13_items_take_number(take, "D_VOL"))
      summary.take_pan = d13_items_take_number(take, "D_PAN")
      summary.start_offset_seconds = d13_items_take_number(take, "D_STARTOFFS")
      summary.channel_mode = d13_items_channel_mode_label(d13_items_take_number(take, "I_CHANMODE"))
      summary.reverse = d13_items_take_number(take, "B_REVERSE") == 1
      summary.pitch_shift_mode = d13_items_pitch_mode_label(d13_items_take_number(take, "I_PITCHMODE"))
      summary.stretch_marker_fade_size_ms = d13_items_take_number(take, "F_STRETCHFADESIZE") * 1000
    else
      summary.active_take_name = ""
    end
  end
  return summary
end

local function d13_items_list_selected_items(request)
  local ok_count, count = call_reaper("CountSelectedMediaItems", 0)
  local selected_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local limit = d13_items_bounded_limit(request, request.params.limit, 32, 128)
  local include_track_refs = request.params.include_track_refs == true
  local items = json_array({})
  local refs = json_array({})
  for index = 0, math.min(selected_count, limit) - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
    if ok_item and item then
      local summary = d13_items_item_summary(item, false)
      if not include_track_refs then
        summary.track_ref = JSON_NULL
      end
      items[#items + 1] = summary
      refs[#refs + 1] = d13_items_item_object_ref(item)
      if include_track_refs then
        local track = d13_items_item_track(item)
        if track then
          refs[#refs + 1] = d13_items_track_object_ref(track)
        end
      end
    end
  end
  return {
    kind = "selected_items",
    selected_count = selected_count,
    items = items,
    truncated = selected_count > limit,
  }, nil, nil, nil, refs
end

local function d13_items_list_items_on_track(request)
  local track, failure = d13_items_track_from_request_refs(request)
  if not track then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local ok_count, count = call_reaper("CountTrackMediaItems", track)
  local item_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local limit = d13_items_bounded_limit(request, request.params.limit, 32, 128)
  local include_take_summary = request.params.include_take_summary == true
  local items = json_array({})
  local refs = json_array({ d13_items_track_object_ref(track) })
  for index = 0, math.min(item_count, limit) - 1 do
    local ok_item, item = call_reaper("GetTrackMediaItem", track, index)
    if ok_item and item then
      items[#items + 1] = d13_items_item_summary(item, include_take_summary)
      refs[#refs + 1] = d13_items_item_object_ref(item)
    end
  end
  return {
    kind = "track_items",
    track_ref = d13_items_track_ref_string(track),
    item_count = item_count,
    items = items,
    truncated = item_count > limit,
  }, nil, nil, nil, refs
end

local function d13_items_write_summary(request, item)
  local summary = d13_items_item_summary(item, true)
  summary.capability = request.pack.capability
  summary.pack = request.pack.id
  summary.risk = request.pack.risk
  summary.readback_status = "passed"
  summary.undo_evidence = "required"
  summary.artifacts_allowed = false
  summary.truncated = false
  if request.pack.capability == "items.set_item_pan" then
    summary.pan = summary.pan
  elseif request.pack.capability == "items.set_take_pan" then
    summary.pan = summary.take_pan
  elseif request.pack.capability == "items.set_reverse" then
    summary.reverse = summary.reverse == true
  elseif request.pack.capability == "items.set_pitch_shift_mode" then
    summary.mode = summary.pitch_shift_mode
  elseif request.pack.capability == "items.set_stretch_marker_fade_size" then
    summary.fade_size_ms = summary.stretch_marker_fade_size_ms
  end
  return summary, nil, json_array({}), json_array({}), d13_items_refs(d13_items_item_object_ref(item))
end

local function d13_items_item_for_write(request)
  local item = d13_items_item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D13 items write request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function d13_items_take_for_write(request, item)
  local take = d13_items_active_take(item)
  if not take then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D13 take write request requires an active take.",
      details = {
        item_ref = d13_items_item_ref_string(item),
      },
    }
  end
  return take
end

local function d13_items_set_item_value(request, key, value)
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local ok = call_reaper("SetMediaItemInfo_Value", item, key, value)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected item property update.", {
      key = key,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  return d13_items_write_summary(request, item)
end

local function d13_items_set_take_value(request, key, value)
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d13_items_take_for_write(request, item)
  if not take then
    return d13_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local ok = call_reaper("SetMediaItemTakeInfo_Value", take, key, value)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected take property update.", {
      key = key,
    }, false)
  end
  call_reaper("UpdateItemInProject", item)
  return d13_items_write_summary(request, item)
end

local function d13_items_set_item_volume(request)
  local db = d13_items_bounded_db(request.params.volume_db)
  if not db then
    return d13_items_error("PARAMS_INVALID", "Item volume_db must be between -120 and 24.", {
      volume_db = request.params.volume_db,
    })
  end
  return d13_items_set_item_value(request, "D_VOL", d13_items_db_to_linear(db))
end

local function d13_items_set_take_volume(request)
  local db = d13_items_bounded_db(request.params.volume_db)
  if not db then
    return d13_items_error("PARAMS_INVALID", "Take volume_db must be between -120 and 24.", {
      volume_db = request.params.volume_db,
    })
  end
  return d13_items_set_take_value(request, "D_VOL", d13_items_db_to_linear(db))
end

local function d13_items_set_take_pan(request)
  local pan = d13_items_bounded_pan(request.params.pan)
  if pan == nil then
    return d13_items_error("PARAMS_INVALID", "Take pan must be between -1 and 1.", {
      pan = request.params.pan,
    })
  end
  return d13_items_set_take_value(request, "D_PAN", pan)
end

local function d13_items_set_item_pan(request)
  local pan = d13_items_bounded_pan(request.params.pan)
  if pan == nil then
    return d13_items_error("PARAMS_INVALID", "Item pan must be between -1 and 1.", {
      pan = request.params.pan,
    })
  end
  return d13_items_set_item_value(request, "D_PAN", pan)
end

local function d13_items_rename_take(request)
  local name = bounded_string(request.params.name, 160)
  if name == "" then
    return d13_items_error("PARAMS_INVALID", "Take name must be a non-empty string.", {})
  end
  local item, failure = d13_items_item_for_write(request)
  if not item then
    return d13_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d13_items_take_for_write(request, item)
  if not take then
    return d13_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local ok = call_reaper("GetSetMediaItemTakeInfo_String", take, "P_NAME", name, true)
  if not ok then
    return d13_items_error("COMMAND_FAILED", "REAPER rejected take rename.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  return d13_items_write_summary(request, item)
end

local function d13_items_set_loop_source(request)
  return d13_items_set_item_value(request, "B_LOOPSRC", request.params.loop_source == true and 1 or 0)
end

local function d13_items_set_mute(request)
  return d13_items_set_item_value(request, "B_MUTE", request.params.muted == true and 1 or 0)
end

local function d13_items_set_lock(request)
  return d13_items_set_item_value(request, "C_LOCK", request.params.locked == true and 1 or 0)
end

local function d13_items_set_play_all_takes(request)
  return d13_items_set_item_value(request, "B_ALLTAKESPLAY", request.params.play_all_takes == true and 1 or 0)
end

local function d13_items_set_take_start_in_source(request)
  local offset = d13_items_finite_number(request.params.start_offset_seconds)
  if not offset or offset < 0 then
    return d13_items_error("PARAMS_INVALID", "Take start_offset_seconds must be non-negative.", {
      start_offset_seconds = request.params.start_offset_seconds,
    })
  end
  return d13_items_set_take_value(request, "D_STARTOFFS", offset)
end

local function d13_items_set_channel_mode(request)
  local mode = d13_items_channel_mode_value(request.params.channel_mode)
  if mode == nil then
    return d13_items_error("PARAMS_INVALID", "Take channel_mode is outside the D13 enum.", {
      channel_mode = request.params.channel_mode,
    })
  end
  return d13_items_set_take_value(request, "I_CHANMODE", mode)
end

local function d13_items_set_reverse(request)
  return d13_items_set_take_value(request, "B_REVERSE", request.params.reverse == true and 1 or 0)
end

local function d13_items_set_pitch_shift_mode(request)
  local mode = d13_items_pitch_mode_value(request.params.mode)
  if mode == nil then
    return d13_items_error("PARAMS_INVALID", "Take pitch mode must be project_default or an integer I_PITCHMODE value.", {
      mode = request.params.mode,
    })
  end
  return d13_items_set_take_value(request, "I_PITCHMODE", mode)
end

local function d13_items_set_stretch_marker_fade_size(request)
  local fade_size_ms = d13_items_finite_number(request.params.fade_size_ms)
  if not fade_size_ms or fade_size_ms < 0 or fade_size_ms > 10000 then
    return d13_items_error("PARAMS_INVALID", "Stretch marker fade_size_ms must be between 0 and 10000.", {
      fade_size_ms = request.params.fade_size_ms,
    })
  end
  return d13_items_set_take_value(request, "F_STRETCHFADESIZE", fade_size_ms / 1000)
end
return {
  exports = { d13_items_list_selected_items = d13_items_list_selected_items, d13_items_list_items_on_track = d13_items_list_items_on_track, d13_items_set_item_volume = d13_items_set_item_volume, d13_items_set_take_volume = d13_items_set_take_volume, d13_items_set_take_pan = d13_items_set_take_pan, d13_items_rename_take = d13_items_rename_take, d13_items_set_loop_source = d13_items_set_loop_source, d13_items_set_mute = d13_items_set_mute, d13_items_set_lock = d13_items_set_lock, d13_items_set_play_all_takes = d13_items_set_play_all_takes, d13_items_set_take_start_in_source = d13_items_set_take_start_in_source, d13_items_set_channel_mode = d13_items_set_channel_mode, d13_items_set_pitch_shift_mode = d13_items_set_pitch_shift_mode, d13_items_set_stretch_marker_fade_size = d13_items_set_stretch_marker_fade_size, d13_items_set_item_pan = d13_items_set_item_pan, d13_items_set_reverse = d13_items_set_reverse },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/d14_items_delete_route.lua
__openreaper_register_handler_module("items/d14_items_delete_route.lua", function()
-- Extracted D14 handler: destructive item deletion by canonical item refs.

local function d14_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d14_items_item_guid(item)
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

local function d14_items_item_ref_string(item)
  local guid = d14_items_item_guid(item)
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

local function d14_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d14_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d14_items_resolve_item_token(token)
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
    return d14_items_find_item_by_guid(guid)
  end
  return nil
end

local function d14_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d14_items_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d14_items_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d14_items_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d14_items_resolve_item_token(ref.ref)
end

local function d14_items_item_object_ref_from_string(ref)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d14_items_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function d14_items_item_selected(item)
  local ok_selected, selected = call_reaper("GetMediaItemInfo_Value", item, "B_UISEL")
  return ok_selected and first_number(selected) == 1
end

local function d14_items_collect_entries(request)
  if not is_json_array(request.refs) then
    return nil, {
      code = "REF_INVALID",
      message = "D14 items delete request requires item refs.",
      details = {},
    }
  end
  local entries = {}
  local seen = {}
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" then
      local item = d14_items_resolve_item_from_ref_object(ref)
      if not item then
        return nil, {
          code = "ITEM_NOT_FOUND",
          message = "Item ref could not be resolved for deletion.",
          details = {
            item_ref = bounded_string(ref.ref, 160),
          },
        }
      end
      local item_ref = d14_items_item_ref_string(item)
      if not seen[item_ref] then
        seen[item_ref] = true
        entries[#entries + 1] = {
          item = item,
          item_ref = item_ref,
          object_ref = d14_items_item_object_ref_from_string(item_ref),
          track = d14_items_item_track(item),
          selected = d14_items_item_selected(item),
        }
      end
    end
  end
  if #entries == 0 then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D14 items delete request requires at least one resolvable item ref.",
      details = {},
    }
  end
  local budget = safe_budget(request)
  if #entries > budget.max_items then
    return nil, {
      code = "PARAMS_INVALID",
      message = "D14 items delete request exceeds the request item budget.",
      details = {
        requested = #entries,
        max_items = budget.max_items,
      },
    }
  end
  return entries
end

local function d14_items_delete_entries(request, entries)
  if request.params.require_selected == true then
    for index = 1, #entries do
      if not entries[index].selected then
        return nil, {
          code = "ITEM_NOT_SELECTED",
          message = "D14 items delete request required selected items.",
          details = {
            item_ref = entries[index].item_ref,
          },
        }
      end
    end
  end
  for index = 1, #entries do
    if not entries[index].track then
      return nil, {
        code = "TRACK_NOT_FOUND",
        message = "Parent track could not be resolved for item deletion.",
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  for index = 1, #entries do
    local ok, deleted = call_reaper("DeleteTrackMediaItem", entries[index].track, entries[index].item)
    if not ok or deleted == false then
      return nil, {
        code = "COMMAND_FAILED",
        message = "REAPER rejected item deletion.",
        recoverable = false,
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  call_reaper("UpdateArrange")
  for index = 1, #entries do
    if d14_items_resolve_item_token(entries[index].item_ref) then
      return nil, {
        code = "VERIFICATION_FAILED",
        message = "Deleted item still resolved after deletion.",
        recoverable = false,
        details = {
          item_ref = entries[index].item_ref,
        },
      }
    end
  end
  return true
end

local function d14_items_delete_summary(request, entries, singular)
  local deleted_item_refs = json_array({})
  local refs = json_array({})
  for index = 1, #entries do
    deleted_item_refs[#deleted_item_refs + 1] = entries[index].item_ref
    refs[#refs + 1] = entries[index].object_ref
  end
  local summary = {
    kind = singular and "item_deleted" or "items_deleted",
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    deleted_count = #entries,
    deleted_item_refs = deleted_item_refs,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }
  if singular then
    summary.deleted_item_ref = entries[1].item_ref
  end
  return summary, nil, json_array({}), json_array({}), refs
end

local function d14_items_delete_item(request)
  local entries, failure = d14_items_collect_entries(request)
  if not entries then
    return d14_items_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  if #entries ~= 1 then
    return d14_items_error("REF_INVALID", "delete_item requires exactly one item ref.", {
      item_ref_count = #entries,
    })
  end
  local ok, delete_failure = d14_items_delete_entries(request, entries)
  if not ok then
    return d14_items_error(delete_failure.code, delete_failure.message, delete_failure.details, delete_failure.recoverable)
  end
  return d14_items_delete_summary(request, entries, true)
end

local function d14_items_delete_items(request)
  local entries, failure = d14_items_collect_entries(request)
  if not entries then
    return d14_items_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  local ok, delete_failure = d14_items_delete_entries(request, entries)
  if not ok then
    return d14_items_error(delete_failure.code, delete_failure.message, delete_failure.details, delete_failure.recoverable)
  end
  return d14_items_delete_summary(request, entries, false)
end
return {
  exports = { d14_items_delete_item = d14_items_delete_item, d14_items_delete_items = d14_items_delete_items },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/d15_items_source_phase_route.lua
__openreaper_register_handler_module("items/d15_items_source_phase_route.lua", function()
-- Extracted D15 handler: item autofades, take phase, and source relink.

local function d15_items_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d15_items_finite_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d15_items_item_guid(item)
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

local function d15_items_item_ref_string(item)
  local guid = d15_items_item_guid(item)
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

local function d15_items_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d15_items_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d15_items_resolve_item_token(token)
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
    return d15_items_find_item_by_guid(guid)
  end
  return nil
end

local function d15_items_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d15_items_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d15_items_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d15_items_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d15_items_resolve_item_token(ref.ref)
end

local function d15_items_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d15_items_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d15_items_item_object_ref(item)
  local ref = d15_items_item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d15_items_file_object_ref(path_value)
  return {
    kind = "file",
    ref = "file:path:" .. bounded_string(path_value, 220),
    identity = {
      scheme = "path",
      value = path_value,
    },
  }
end

local function d15_items_file_path_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "file" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "path" and is_string(identity.value) then
    return identity.value
  end
  local path_value = is_string(ref.ref) and ref.ref:match("^file:path:(.+)$") or nil
  return path_value
end

local function d15_items_file_path_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local path_value = d15_items_file_path_from_ref_object(request.refs[index])
      if path_value then
        return path_value
      end
    end
  end
  return nil
end

local function d15_items_active_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function d15_items_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function d15_take_number(take, key)
  local ok, value = call_reaper("GetMediaItemTakeInfo_Value", take, key)
  return ok and first_number(value) or 0
end

local function d15_items_item_for_write(request)
  local item = d15_items_item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "D15 items request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function d15_items_take_for_write(request, item)
  local take = d15_items_active_take(item)
  if not take then
    return nil, {
      code = "TAKE_NOT_FOUND",
      message = "D15 take request requires an active take.",
      details = {
        item_ref = d15_items_item_ref_string(item),
      },
    }
  end
  return take
end

local function d15_items_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d15_items_summary(request, item, extra, refs)
  local summary = {
    item_ref = d15_items_item_ref_string(item),
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = "passed",
    undo_evidence = "required",
    artifacts_allowed = false,
    truncated = false,
  }
  for key, value in pairs(extra or {}) do
    summary[key] = value
  end
  return summary, nil, json_array({}), json_array({}), refs or d15_items_refs(d15_items_item_object_ref(item))
end

local function d15_items_set_no_autofades(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local no_autofades = request.params.no_autofades == true
  local value = no_autofades and -1 or 0
  local ok_in = call_reaper("SetMediaItemInfo_Value", item, "D_FADEINLEN_AUTO", value)
  local ok_out = call_reaper("SetMediaItemInfo_Value", item, "D_FADEOUTLEN_AUTO", value)
  if not ok_in or not ok_out then
    return d15_items_error("COMMAND_FAILED", "REAPER rejected item auto-fade update.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d15_items_number(item, "D_FADEINLEN_AUTO") < 0 and d15_items_number(item, "D_FADEOUTLEN_AUTO") < 0
  if readback ~= no_autofades then
    return d15_items_error("VERIFICATION_FAILED", "Item no-autofades readback did not match the request.", {
      requested = no_autofades,
      actual = readback,
    }, false)
  end
  return d15_items_summary(request, item, {
    no_autofades = readback,
  })
end

local function d15_items_take_phase_inverted(take)
  return d15_take_number(take, "D_VOL") < 0
end

local function d15_items_set_invert_phase(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d15_items_take_for_write(request, item)
  if not take then
    return d15_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local current_volume = d15_take_number(take, "D_VOL")
  local magnitude = math.abs(current_volume)
  if magnitude == 0 and request.params.invert_phase == true then
    return d15_items_error("PARAMS_INVALID", "Cannot invert phase on a zero-volume active take without changing its gain.", {
      item_ref = d15_items_item_ref_string(item),
    })
  end
  local next_volume = request.params.invert_phase == true and -magnitude or magnitude
  local ok = call_reaper("SetMediaItemTakeInfo_Value", take, "D_VOL", next_volume)
  if not ok then
    return d15_items_error("COMMAND_FAILED", "REAPER rejected take phase inversion update.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  local readback = d15_items_take_phase_inverted(take)
  if readback ~= (request.params.invert_phase == true) then
    return d15_items_error("VERIFICATION_FAILED", "Take phase readback did not match the request.", {
      requested = request.params.invert_phase == true,
      actual = readback,
    }, false)
  end
  return d15_items_summary(request, item, {
    invert_phase = readback,
  })
end

local function d15_items_create_source(path_value)
  if not is_string(path_value) or not file_exists(path_value) then
    return nil, "FILE_NOT_FOUND", "D15 replacement source file does not exist."
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return nil, "FILE_NOT_FOUND", "D15 replacement source could not be decoded by REAPER."
  end
  return source
end

local function d15_items_source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function d15_items_choose_new_source_file(request)
  local item, failure = d15_items_item_for_write(request)
  if not item then
    return d15_items_error(failure.code, failure.message, failure.details)
  end
  local take, take_failure = d15_items_take_for_write(request, item)
  if not take then
    return d15_items_error(take_failure.code, take_failure.message, take_failure.details)
  end
  local path_value = d15_items_file_path_from_request_refs(request)
  if not path_value then
    return d15_items_error("FILE_NOT_FOUND", "D15 source relink requires a file ref.", {})
  end
  local source, code, message = d15_items_create_source(path_value)
  if not source then
    return d15_items_error(code, message, { path = bounded_string(path_value, 240) })
  end
  local ok_old_source, old_source = call_reaper("GetMediaItemTake_Source", take)
  local old_start_offset = d15_take_number(take, "D_STARTOFFS")
  local old_item_length = d15_items_number(item, "D_LENGTH")
  local ok_set = call_reaper("SetMediaItemTake_Source", take, source)
  if not ok_set then
    call_reaper("PCM_Source_Destroy", source)
    return d15_items_error("COMMAND_FAILED", "REAPER rejected take source relink.", {}, false)
  end
  if request.params.preserve_timing == true then
    call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", old_start_offset)
    call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", old_item_length)
  end
  if ok_old_source and old_source and old_source ~= source then
    call_reaper("PCM_Source_Destroy", old_source)
  end
  call_reaper("UpdateItemInProject", item)
  local ok_readback_source, readback_source = call_reaper("GetMediaItemTake_Source", take)
  local filename = ok_readback_source and readback_source and d15_items_source_filename(readback_source) or ""
  if filename ~= path_value then
    return d15_items_error("VERIFICATION_FAILED", "Take source readback did not match the requested file ref.", {
      requested_path = bounded_string(path_value, 240),
      actual_path = bounded_string(filename, 240),
    }, false)
  end
  local file_ref = d15_items_file_object_ref(path_value)
  return d15_items_summary(request, item, {
    file_ref = file_ref.ref,
    preserve_timing = request.params.preserve_timing == true,
  }, d15_items_refs(d15_items_item_object_ref(item), file_ref))
end
return {
  exports = { d15_items_set_no_autofades = d15_items_set_no_autofades, d15_items_set_invert_phase = d15_items_set_invert_phase, d15_items_choose_new_source_file = d15_items_choose_new_source_file },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/d16_tracks_org_route.lua
__openreaper_register_handler_module("tracks/d16_tracks_org_route.lua", function()
-- Extracted D16 tracks organization/delete handlers.

local function d16_tracks_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d16_tracks_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d16_tracks_summary(request, readback)
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

local function d16_tracks_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d16_tracks_index(track)
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

local function d16_tracks_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d16_tracks_ref_string(track)
  local guid = d16_tracks_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d16_tracks_index(track))
end

local function d16_tracks_object_ref(track)
  local ref = d16_tracks_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or d16_tracks_index(track)),
    },
    display = {
      name = d16_tracks_name(track),
      index = d16_tracks_index(track),
    },
  }
end

local function d16_tracks_numeric(track, key, fallback)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, key)
  return ok and first_number(value) or fallback
end

local function d16_tracks_track_summary(track)
  return {
    track_ref = d16_tracks_ref_string(track),
    index = d16_tracks_index(track),
    name = d16_tracks_name(track),
    folder_depth = math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0),
    selected = d16_tracks_numeric(track, "I_SELECTED", 0) == 1,
  }
end

local function d16_tracks_find_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d16_tracks_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d16_tracks_find_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d16_tracks_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function d16_tracks_resolve_token(token)
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
    return d16_tracks_find_by_guid(guid)
  end
  local name = token:match("^track:(.+)$")
  if name then
    return d16_tracks_find_by_name(name)
  end
  return nil
end

local function d16_tracks_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d16_tracks_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d16_tracks_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d16_tracks_resolve_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return d16_tracks_find_by_name(tostring(identity.value))
  end
  return d16_tracks_resolve_token(ref.ref)
end

local function d16_tracks_from_request_refs(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = d16_tracks_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function d16_tracks_unique_tracks(tracks)
  local unique = {}
  local seen = {}
  for index = 1, #tracks do
    local ref = d16_tracks_ref_string(tracks[index])
    if not seen[ref] then
      unique[#unique + 1] = tracks[index]
      seen[ref] = true
    end
  end
  return unique
end

local function d16_tracks_track_count()
  local ok_count, count = call_reaper("CountTracks", 0)
  return ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function d16_tracks_select_only(tracks)
  local total = d16_tracks_track_count()
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      call_reaper("SetTrackSelected", track, false)
    end
  end
  for index = 1, #tracks do
    call_reaper("SetTrackSelected", tracks[index], true)
  end
end

local function d16_tracks_verify_absent(refs)
  for index = 1, #refs do
    local track = d16_tracks_resolve_token(refs[index])
    if track then
      return false, refs[index]
    end
  end
  return true
end

local function d16_tracks_deleted_refs(tracks)
  local refs = json_array({})
  local tokens = {}
  for index = 1, #tracks do
    refs[#refs + 1] = d16_tracks_object_ref(tracks[index])
    tokens[#tokens + 1] = d16_tracks_ref_string(tracks[index])
  end
  return refs, tokens
end

local function d16_tracks_delete_tracks_impl(request, require_single)
  local tracks = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  if require_single and #tracks ~= 1 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 delete_track requires exactly one resolvable track ref.", {
      resolved_count = #tracks,
    })
  end
  if #tracks == 0 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 delete tracks requires one or more resolvable track refs.", {})
  end
  local refs, tokens = d16_tracks_deleted_refs(tracks)
  table.sort(tracks, function(left, right)
    return d16_tracks_index(left) > d16_tracks_index(right)
  end)
  for index = 1, #tracks do
    local ok = call_reaper("DeleteTrack", tracks[index])
    if not ok then
      return d16_tracks_error("COMMAND_FAILED", "Could not delete D16 track.", {
        track_ref = d16_tracks_ref_string(tracks[index]),
      }, false)
    end
  end
  call_reaper("TrackList_AdjustWindows", false)
  local absent, still_present = d16_tracks_verify_absent(tokens)
  if not absent then
    return d16_tracks_error("VERIFICATION_FAILED", "Deleted track still resolves after D16 delete.", {
      track_ref = still_present,
    })
  end
  return d16_tracks_summary(request, {
    deleted_count = #tokens,
    deleted_refs = refs,
  }), nil, json_array({}), refs, json_array({})
end

local function d16_tracks_delete_track(request)
  return d16_tracks_delete_tracks_impl(request, true)
end

local function d16_tracks_delete_tracks(request)
  return d16_tracks_delete_tracks_impl(request, false)
end

local function d16_tracks_create_folder_track(request)
  local total = d16_tracks_track_count()
  local index = is_non_negative_integer(request.params.index) and request.params.index or total
  index = math.max(0, math.min(index, total))
  local ok_insert = call_reaper("InsertTrackAtIndex", index, true)
  if not ok_insert then
    return d16_tracks_error("COMMAND_FAILED", "Could not insert D16 folder track.", { index = index }, false)
  end
  local ok_track, track = call_reaper("GetTrack", 0, index)
  if not ok_track or not track then
    return d16_tracks_error("TRACK_NOT_FOUND", "Inserted D16 folder track could not be resolved.", { index = index })
  end
  call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name), true)
  call_reaper("SetMediaTrackInfo_Value", track, "I_FOLDERDEPTH", 1)
  call_reaper("TrackList_AdjustWindows", false)
  local summary = d16_tracks_track_summary(track)
  summary.created = true
  summary.folder_track = true
  if summary.name ~= tostring(request.params.name) then
    return d16_tracks_error("VERIFICATION_FAILED", "D16 created folder track name did not match readback.", {
      expected = tostring(request.params.name),
      actual = summary.name,
    })
  end
  return d16_tracks_summary(request, summary), nil, nil, nil, d16_tracks_refs(d16_tracks_object_ref(track))
end

local function d16_tracks_set_folder_depth(request)
  local tracks = d16_tracks_from_request_refs(request)
  local track = tracks[1]
  if not track then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 set_folder_depth requires a resolvable track ref.", {})
  end
  local depth = math.floor(tonumber(request.params.folder_depth) or 0)
  if depth < -128 or depth > 128 then
    return d16_tracks_error("INPUT_INVALID", "D16 folder_depth must stay within [-128, 128].", { folder_depth = depth })
  end
  local ok = call_reaper("SetMediaTrackInfo_Value", track, "I_FOLDERDEPTH", depth)
  if not ok then
    return d16_tracks_error("COMMAND_FAILED", "Could not set D16 folder depth.", {
      track_ref = d16_tracks_ref_string(track),
    }, false)
  end
  call_reaper("TrackList_AdjustWindows", false)
  local readback = math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0)
  if readback ~= depth then
    return d16_tracks_error("VERIFICATION_FAILED", "D16 folder depth did not match readback.", {
      expected = depth,
      actual = readback,
    })
  end
  local summary = d16_tracks_track_summary(track)
  summary.folder_depth = readback
  return d16_tracks_summary(request, summary), nil, nil, nil, d16_tracks_refs(d16_tracks_object_ref(track))
end

local function d16_tracks_move_selected_to_index(request, tracks, index)
  local total = d16_tracks_track_count()
  if #tracks == 0 then
    return nil, d16_tracks_error("TRACK_NOT_FOUND", "D16 move requires one or more resolvable track refs.", {})
  end
  index = math.max(0, math.min(index, total))
  d16_tracks_select_only(tracks)
  local ok = call_reaper("ReorderSelectedTracks", index, 0)
  if not ok then
    return nil, d16_tracks_error("COMMAND_FAILED", "Could not reorder D16 selected tracks.", { index = index }, false)
  end
  call_reaper("TrackList_AdjustWindows", false)
  return true, nil
end

local function d16_tracks_move_tracks_impl(request, require_single)
  local tracks = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  if require_single and #tracks ~= 1 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 move_track requires exactly one resolvable track ref.", {
      resolved_count = #tracks,
    })
  end
  local target_index = math.floor(tonumber(request.params.index) or 0)
  local ok, failure = d16_tracks_move_selected_to_index(request, tracks, target_index)
  if not ok then
    return nil, failure
  end
  local refs = json_array({})
  local rows = json_array({})
  for index = 1, #tracks do
    refs[#refs + 1] = d16_tracks_object_ref(tracks[index])
    rows[#rows + 1] = d16_tracks_track_summary(tracks[index])
  end
  local first_index = rows[1] and rows[1].index or -1
  if first_index ~= target_index then
    return d16_tracks_error("VERIFICATION_FAILED", "D16 moved track block did not start at requested index.", {
      expected = target_index,
      actual = first_index,
    })
  end
  return d16_tracks_summary(request, {
    moved_count = #tracks,
    target_index = target_index,
    tracks = rows,
  }), nil, nil, nil, refs
end

local function d16_tracks_move_track(request)
  return d16_tracks_move_tracks_impl(request, true)
end

local function d16_tracks_move_tracks(request)
  return d16_tracks_move_tracks_impl(request, false)
end

local function d16_tracks_nest_tracks_in_folder(request)
  local refs = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  local folder = refs[1]
  if not folder then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 nest_tracks_in_folder requires a folder_ref.", {})
  end
  local children = {}
  for index = 2, #refs do
    children[#children + 1] = refs[index]
  end
  if #children == 0 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 nest_tracks_in_folder requires at least one child track_ref.", {})
  end
  local folder_index = d16_tracks_index(folder)
  local ok, failure = d16_tracks_move_selected_to_index(request, children, folder_index + 1)
  if not ok then
    return nil, failure
  end
  call_reaper("SetMediaTrackInfo_Value", folder, "I_FOLDERDEPTH", 1)
  for index = 1, #children do
    local depth = index == #children and -1 or 0
    call_reaper("SetMediaTrackInfo_Value", children[index], "I_FOLDERDEPTH", depth)
  end
  call_reaper("TrackList_AdjustWindows", false)
  local refs_out = json_array({ d16_tracks_object_ref(folder) })
  local rows = json_array({ d16_tracks_track_summary(folder) })
  local expected_index = d16_tracks_index(folder) + 1
  for index = 1, #children do
    refs_out[#refs_out + 1] = d16_tracks_object_ref(children[index])
    rows[#rows + 1] = d16_tracks_track_summary(children[index])
    if d16_tracks_index(children[index]) ~= expected_index + index - 1 then
      return d16_tracks_error("VERIFICATION_FAILED", "D16 nested child track did not follow the folder.", {
        child_ref = d16_tracks_ref_string(children[index]),
      })
    end
  end
  if math.floor(d16_tracks_numeric(folder, "I_FOLDERDEPTH", 0) or 0) ~= 1 then
    return d16_tracks_error("VERIFICATION_FAILED", "D16 folder parent did not open a folder span.", {
      folder_ref = d16_tracks_ref_string(folder),
    })
  end
  if math.floor(d16_tracks_numeric(children[#children], "I_FOLDERDEPTH", 0) or 0) ~= -1 then
    return d16_tracks_error("VERIFICATION_FAILED", "D16 last child did not close the folder span.", {
      child_ref = d16_tracks_ref_string(children[#children]),
    })
  end
  return d16_tracks_summary(request, {
    folder_ref = d16_tracks_ref_string(folder),
    child_count = #children,
    tracks = rows,
  }), nil, nil, nil, refs_out
end
return {
  exports = { d16_tracks_delete_track = d16_tracks_delete_track, d16_tracks_delete_tracks = d16_tracks_delete_tracks, d16_tracks_create_folder_track = d16_tracks_create_folder_track, d16_tracks_set_folder_depth = d16_tracks_set_folder_depth, d16_tracks_move_track = d16_tracks_move_track, d16_tracks_move_tracks = d16_tracks_move_tracks, d16_tracks_nest_tracks_in_folder = d16_tracks_nest_tracks_in_folder },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/d17_midi_edit_route.lua
__openreaper_register_handler_module("midi/d17_midi_edit_route.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
local function read_take_event_counts(...)
  return OPENREAPER_HANDLER_EXPORTS.read_take_event_counts(...)
end
-- Extracted D17 MIDI edit handlers.

local function d17_midi_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d17_midi_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d17_midi_summary(request, readback)
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

local function d17_midi_take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function d17_midi_integer(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function d17_midi_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d17_midi_clamp(value, min_value, max_value)
  if value < min_value then
    return min_value
  elseif value > max_value then
    return max_value
  end
  return value
end

local function d17_midi_counts(request, take)
  return read_take_event_counts({
    refs = json_array({ d17_midi_take_object_ref(take) }),
    params = {},
    budget = request.budget,
  })
end

local function d17_midi_resolve_guarded_take(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local counts = d17_midi_counts(request, take)
  if is_string(request.params.expected_take_hash) and request.params.expected_take_hash ~= counts.take_hash then
    local _, stale = d17_midi_error("STALE_TAKE_HASH", "D17 MIDI edit rejected stale expected_take_hash.", {
      expected_take_hash = request.params.expected_take_hash,
      actual_take_hash = counts.take_hash,
    })
    return nil, stale
  end
  return take, nil, counts
end

local function d17_midi_ppq_from_event(take, event, key, fallback)
  local value = d17_midi_number(event[key])
  if value then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  local seconds = d17_midi_number(event[seconds_key])
  if seconds then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, seconds)
    return ok and first_number(ppq) or fallback
  end
  return fallback
end

local function d17_midi_grid_ppq(request, take)
  if request.params.grid_unit == "ppq" then
    local grid = d17_midi_number(request.params.grid_ppq)
    if not grid or grid <= 0 then
      return nil, "grid_ppq must be positive when grid_unit is ppq."
    end
    return grid, nil
  end
  local ok_grid, grid = call_reaper("MIDI_GetGrid", take)
  local value = ok_grid and first_number(grid) or nil
  if not value or value <= 0 then
    return nil, "MIDI take grid could not be read as a positive PPQ value."
  end
  return value, nil
end

local function d17_midi_note_count(take)
  local ok_count, count_retval, note_count = call_reaper("MIDI_CountEvts", take)
  if ok_count and count_retval ~= false then
    return math.max(0, math.floor(first_number(note_count) or 0))
  end
  return 0
end

local function d17_midi_cc_count(take)
  local ok_count, count_retval, _, cc_count = call_reaper("MIDI_CountEvts", take)
  if ok_count and count_retval ~= false then
    return math.max(0, math.floor(first_number(cc_count) or 0))
  end
  return 0
end

local function d17_midi_set_notes_batch(request)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  local updated = 0
  for row_index = 1, #notes do
    local note = is_object(notes[row_index]) and notes[row_index] or {}
    local index = d17_midi_integer(note.index)
    if index == nil or index < 0 or index >= d17_midi_note_count(take) then
      return d17_midi_error("NOTE_NOT_FOUND", "D17 MIDI set_notes_batch requires a valid note index.", {
        index = note.index,
      })
    end
    local ok_note, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if not ok_note or selected == nil then
      return d17_midi_error("NOTE_NOT_FOUND", "D17 MIDI note row could not be read.", { index = index })
    end
    local new_start = d17_midi_ppq_from_event(take, note, "start_ppq", first_number(start_ppq) or 0)
    local new_end = d17_midi_ppq_from_event(take, note, "end_ppq", first_number(end_ppq) or 0)
    if new_end <= new_start then
      return d17_midi_error("PARAMS_INVALID", "D17 MIDI note end must be greater than start.", { index = index })
    end
    local ok_set, success = call_reaper(
      "MIDI_SetNote",
      take,
      index,
      note.selected == nil and selected == true or note.selected == true,
      note.muted == nil and muted == true or note.muted == true,
      new_start,
      new_end,
      d17_midi_clamp(d17_midi_integer(note.channel) or first_number(channel) or 0, 0, 15),
      d17_midi_clamp(d17_midi_integer(note.pitch) or first_number(pitch) or 60, 0, 127),
      d17_midi_clamp(d17_midi_integer(note.velocity) or first_number(velocity) or 96, 1, 127),
      true
    )
    if not ok_set or success == false then
      return d17_midi_error("COMMAND_FAILED", "D17 MIDI_SetNote failed.", { index = index }, false)
    end
    updated = updated + 1
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end

local function d17_midi_quantize_notes_impl(request, selected_only)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local grid_ppq, grid_error = d17_midi_grid_ppq(request, take)
  if not grid_ppq then
    return d17_midi_error("PARAMS_INVALID", grid_error, {
      grid_unit = request.params.grid_unit,
      grid_ppq = request.params.grid_ppq,
    })
  end
  local strength = d17_midi_clamp(d17_midi_number(request.params.strength) or 1, 0, 1)
  local total = d17_midi_note_count(take)
  local selected_count = 0
  local updated = 0
  for index = 0, total - 1 do
    local ok_note, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if ok_note and selected ~= nil and ((not selected_only) or selected == true) then
      if selected == true then
        selected_count = selected_count + 1
      end
      local start_value = first_number(start_ppq) or 0
      local end_value = first_number(end_ppq) or start_value
      local target = math.floor((start_value / grid_ppq) + 0.5) * grid_ppq
      local new_start = start_value + ((target - start_value) * strength)
      local new_end = end_value
      if request.params.preserve_duration == true then
        new_end = new_start + math.max(0, end_value - start_value)
      end
      local ok_set, success = call_reaper(
        "MIDI_SetNote",
        take,
        index,
        selected == true,
        muted == true,
        new_start,
        new_end,
        first_number(channel) or 0,
        first_number(pitch) or 60,
        first_number(velocity) or 96,
        true
      )
      if not ok_set or success == false then
        return d17_midi_error("COMMAND_FAILED", "D17 MIDI quantize failed.", { index = index }, false)
      end
      updated = updated + 1
    end
  end
  if selected_only and request.params.require_selected_notes == true and selected_count == 0 then
    return d17_midi_error("NOTE_NOT_FOUND", "D17 selected-note quantize requires at least one selected note.", {})
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  counts.selected_count = selected_count
  counts.grid_ppq = grid_ppq
  counts.strength = strength
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end

local function d17_midi_quantize_notes(request)
  return d17_midi_quantize_notes_impl(request, false)
end

local function d17_midi_quantize_selected_notes(request)
  return d17_midi_quantize_notes_impl(request, true)
end

local function d17_midi_set_cc_events_batch(request)
  local take, failure = d17_midi_resolve_guarded_take(request)
  if not take then
    return nil, failure
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local updated = 0
  for row_index = 1, #events do
    local event = is_object(events[row_index]) and events[row_index] or {}
    local index = d17_midi_integer(event.index)
    if index == nil or index < 0 or index >= d17_midi_cc_count(take) then
      return d17_midi_error("CC_NOT_FOUND", "D17 MIDI set_cc_events_batch requires a valid CC index.", {
        index = event.index,
      })
    end
    local ok_cc, selected, muted, ppq, chanmsg, channel, msg2, msg3 = call_reaper("MIDI_GetCC", take, index)
    if not ok_cc or selected == nil then
      return d17_midi_error("CC_NOT_FOUND", "D17 MIDI CC row could not be read.", { index = index })
    end
    local ok_set, success = call_reaper(
      "MIDI_SetCC",
      take,
      index,
      event.selected == nil and selected == true or event.selected == true,
      event.muted == nil and muted == true or event.muted == true,
      d17_midi_ppq_from_event(take, event, "ppq", first_number(ppq) or 0),
      d17_midi_clamp(d17_midi_integer(event.chanmsg) or first_number(chanmsg) or 176, 0, 255),
      d17_midi_clamp(d17_midi_integer(event.channel) or first_number(channel) or 0, 0, 15),
      d17_midi_clamp(d17_midi_integer(event.controller) or d17_midi_integer(event.msg2) or first_number(msg2) or 1, 0, 127),
      d17_midi_clamp(d17_midi_integer(event.value) or d17_midi_integer(event.msg3) or first_number(msg3) or 0, 0, 127),
      true
    )
    if not ok_set or success == false then
      return d17_midi_error("COMMAND_FAILED", "D17 MIDI_SetCC failed.", { index = index }, false)
    end
    updated = updated + 1
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local counts = d17_midi_counts(request, take)
  counts.updated_count = updated
  return d17_midi_summary(request, counts), nil, nil, nil, d17_midi_refs(d17_midi_take_object_ref(take))
end
return {
  exports = { d17_midi_set_notes_batch = d17_midi_set_notes_batch, d17_midi_quantize_notes = d17_midi_quantize_notes, d17_midi_quantize_selected_notes = d17_midi_quantize_selected_notes, d17_midi_set_cc_events_batch = d17_midi_set_cc_events_batch },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/render/d22_render_settings_write_route.lua
__openreaper_register_handler_module("render/d22_render_settings_write_route.lua", function()
-- Extracted D22 handler: render settings writes.

local function d22_render_settings_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d22_render_settings_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function d22_render_settings_refs()
  return json_array({
    {
      kind = "project",
      ref = "project:current",
      identity = {
        scheme = "current",
        value = "current",
      },
    },
  })
end

local function d22_render_settings_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.project_ref = "project:current"
  fields.truncated = false
  return fields
end

local function d22_render_settings_sample_rate(value)
  local number = tonumber(value)
  if not number or number ~= number or number == math.huge or number == -math.huge then
    return nil
  end
  number = math.floor(number + 0.5)
  if number == 44100 or number == 48000 or number == 88200 or number == 96000 then
    return number
  end
  return nil
end

local function set_render_sample_rate(request)
  local sample_rate = d22_render_settings_sample_rate(request.params.sample_rate_hz)
  if not sample_rate then
    return d22_render_settings_error("SAMPLE_RATE_INVALID", "Render sample rate must be one of 44100, 48000, 88200, or 96000 Hz.", {
      sample_rate_hz = request.params.sample_rate_hz,
    })
  end
  local project = d22_render_settings_project()
  local ok_previous, previous_readback = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", 0, false)
  local previous_rate = ok_previous and math.floor(first_number(previous_readback) or 0) or 0
  local ok = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", sample_rate, true)
  if not ok then
    return d22_render_settings_error("COMMAND_FAILED", "REAPER rejected render sample-rate update.", {
      sample_rate_hz = sample_rate,
    }, false)
  end
  local ok_read, readback = call_reaper("GetSetProjectInfo", project, "RENDER_SRATE", 0, false)
  local readback_rate = ok_read and math.floor(first_number(readback) or 0) or 0
  local matches = readback_rate == sample_rate
  if request.params.require_readback_match ~= false and not matches then
    return d22_render_settings_error("READBACK_MISMATCH", "Render sample rate did not read back the requested value.", {
      requested_sample_rate_hz = sample_rate,
      readback_sample_rate_hz = readback_rate,
    }, false)
  end
  return d22_render_settings_summary(request, {
    sample_rate_hz = readback_rate,
    previous_sample_rate_hz = previous_rate,
    changed = previous_rate ~= readback_rate,
    readback_matched = matches,
  }), nil, json_array({}), json_array({}), d22_render_settings_refs()
end
return {
  exports = { set_render_sample_rate = set_render_sample_rate },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/analysis/d27_item_audio_analysis.lua
__openreaper_register_handler_module("analysis/d27_item_audio_analysis.lua", function()
local function read_item_summary(...)
  return OPENREAPER_HANDLER_EXPORTS.read_item_summary(...)
end
-- Extracted D27 handler: item audio analysis artifacts.

local function d27_analysis_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d27_analysis_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback
end

local function d27_analysis_linear_to_db(value)
  if type(value) ~= "number" or value <= 0 then
    return -150
  end
  return 20 * math.log(value) / math.log(10)
end

local function d27_analysis_item_guid(item)
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

local function d27_analysis_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d27_analysis_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d27_analysis_resolve_item_token(token)
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
    return d27_analysis_find_item_by_guid(guid)
  end
  return nil
end

local function d27_analysis_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d27_analysis_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d27_analysis_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d27_analysis_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d27_analysis_resolve_item_token(ref.ref)
end

local function d27_analysis_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d27_analysis_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d27_analysis_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and d27_analysis_number(first_number(value), 0) or 0
end

local function d27_analysis_scan(request)
  local item = d27_analysis_item_from_request_refs(request)
  if not item then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item audio analysis requires a resolvable item ref.", {})
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return nil, d27_analysis_error("TAKE_NOT_FOUND", "Item audio analysis requires an active take.", {})
  end

  local item_summary = read_item_summary({
    refs = request.refs,
    params = { include_take_summary = true },
    budget = request.budget,
  })
  if not item_summary then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item summary readback failed before audio analysis.", {})
  end

  local item_position = d27_analysis_item_number(item, "D_POSITION")
  local item_length = math.max(0, d27_analysis_item_number(item, "D_LENGTH"))
  local start_seconds = math.max(0, d27_analysis_number(request.params.start_seconds, 0))
  local end_seconds = d27_analysis_number(request.params.end_seconds, item_length)
  if end_seconds == nil or end_seconds <= start_seconds then
    end_seconds = item_length
  end
  end_seconds = math.min(item_length, math.max(start_seconds, end_seconds))
  local requested_duration = math.max(0, end_seconds - start_seconds)
  local max_duration = 30
  local analyzed_duration = math.min(requested_duration, max_duration)
  if analyzed_duration <= 0 then
    return nil, d27_analysis_error("EMPTY_RANGE", "Item audio analysis range is empty.", {
      item_length_seconds = item_length,
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end

  local sample_rate = 44100
  local channels = 2
  local ok_accessor, accessor = call_reaper("CreateTakeAudioAccessor", take)
  if not ok_accessor or not accessor then
    return nil, d27_analysis_error("AUDIO_ACCESSOR_UNAVAILABLE", "REAPER did not create a take audio accessor.", {}, false)
  end

  local total_frames = math.max(1, math.floor(analyzed_duration * sample_rate))
  local block_frames = 2048
  local frame_offset = 0
  local sum_squares = 0
  local sample_count = 0
  local positive_peak = 0
  local negative_peak = 0
  local abs_peak = 0
  local silence_threshold = 10 ^ (-60 / 20)
  local silence_segments = json_array({})
  local silence_start = nil
  local total_silence_seconds = 0
  local transient_threshold = 0.25
  local min_transient_gap_frames = math.floor(sample_rate * 0.03)
  local last_transient_frame = -min_transient_gap_frames
  local transients = json_array({})
  local total_transients = 0
  local previous_amp = 0

  while frame_offset < total_frames do
    local frames = math.min(block_frames, total_frames - frame_offset)
    local ok_buffer, buffer = call_reaper("new_array", frames * channels)
    if not ok_buffer or not buffer then
      call_reaper("DestroyAudioAccessor", accessor)
      return nil, d27_analysis_error("AUDIO_BUFFER_UNAVAILABLE", "REAPER did not allocate an audio sample buffer.", {}, false)
    end
    local ok_samples = call_reaper(
      "GetAudioAccessorSamples",
      accessor,
      sample_rate,
      channels,
      item_position + start_seconds + (frame_offset / sample_rate),
      frames,
      buffer
    )
    if not ok_samples then
      call_reaper("DestroyAudioAccessor", accessor)
      return nil, d27_analysis_error("AUDIO_SAMPLE_READ_FAILED", "REAPER rejected audio accessor sample read.", {}, false)
    end
    local values = {}
    if buffer and type(buffer.table) == "function" then
      local ok_table, table_values = pcall(function() return buffer.table() end)
      if ok_table and type(table_values) == "table" then
        values = table_values
      end
    end
    for frame = 0, frames - 1 do
      local frame_peak = 0
      for channel = 1, channels do
        local sample = d27_analysis_number(values[(frame * channels) + channel], 0)
        sum_squares = sum_squares + (sample * sample)
        sample_count = sample_count + 1
        if sample > positive_peak then positive_peak = sample end
        if sample < negative_peak then negative_peak = sample end
        local abs_sample = math.abs(sample)
        if abs_sample > abs_peak then abs_peak = abs_sample end
        if abs_sample > frame_peak then frame_peak = abs_sample end
      end
      local absolute_frame = frame_offset + frame
      if frame_peak <= silence_threshold then
        if silence_start == nil then silence_start = absolute_frame end
      elseif silence_start ~= nil then
        local length_frames = absolute_frame - silence_start
        if length_frames >= math.floor(sample_rate * 0.05) then
          local start_time = start_seconds + (silence_start / sample_rate)
          local end_time = start_seconds + (absolute_frame / sample_rate)
          total_silence_seconds = total_silence_seconds + (end_time - start_time)
          if #silence_segments < 32 then
            silence_segments[#silence_segments + 1] = {
              start_seconds = start_time,
              end_seconds = end_time,
              duration_seconds = end_time - start_time,
            }
          end
        end
        silence_start = nil
      end
      if frame_peak - previous_amp >= transient_threshold
        and absolute_frame - last_transient_frame >= min_transient_gap_frames then
        total_transients = total_transients + 1
        last_transient_frame = absolute_frame
        if #transients < 64 then
          transients[#transients + 1] = {
            time_seconds = start_seconds + (absolute_frame / sample_rate),
            strength = frame_peak - previous_amp,
          }
        end
      end
      previous_amp = frame_peak
    end
    frame_offset = frame_offset + frames
  end

  if silence_start ~= nil then
    local start_time = start_seconds + (silence_start / sample_rate)
    local end_time = start_seconds + (total_frames / sample_rate)
    total_silence_seconds = total_silence_seconds + (end_time - start_time)
    if #silence_segments < 32 then
      silence_segments[#silence_segments + 1] = {
        start_seconds = start_time,
        end_seconds = end_time,
        duration_seconds = end_time - start_time,
      }
    end
  end
  call_reaper("DestroyAudioAccessor", accessor)

  local rms_linear = sample_count > 0 and math.sqrt(sum_squares / sample_count) or 0
  return {
    item = item_summary,
    item_ref = item_summary.item_ref,
    start_seconds = start_seconds,
    end_seconds = start_seconds + analyzed_duration,
    requested_end_seconds = end_seconds,
    duration_seconds = analyzed_duration,
    sample_rate = sample_rate,
    channels = channels,
    sample_frames = total_frames,
    truncated = requested_duration > analyzed_duration,
    rms_linear = rms_linear,
    rms_dbfs = d27_analysis_linear_to_db(rms_linear),
    abs_peak_linear = abs_peak,
    abs_peak_dbfs = d27_analysis_linear_to_db(abs_peak),
    positive_peak_linear = positive_peak,
    negative_peak_linear = negative_peak,
    silence_segments = silence_segments,
    segment_count = #silence_segments,
    total_silence_seconds = total_silence_seconds,
    threshold_dbfs = -60,
    transients = transients,
    transient_count = #transients,
    total_detected = total_transients,
    first_transient_time = #transients > 0 and transients[1].time_seconds or 0,
    last_transient_time = #transients > 0 and transients[#transients].time_seconds or 0,
  }, nil
end

local function d27_analysis_write(request, operation_key, summary, payload)
  local spec = A1_ARTIFACT_SPECS[operation_key]
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return d27_analysis_error(failure.code, failure.message, failure.details)
  end
  summary.artifact_ref = write.object_ref.ref
  summary.schema = spec.schema
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function measure_item_rms(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_rms.v1",
    item_ref = scan.item_ref,
    rms_dbfs = scan.rms_dbfs,
    rms_linear = scan.rms_linear,
    duration_seconds = scan.duration_seconds,
    sample_frames = scan.sample_frames,
    truncated = scan.truncated,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_rms", summary, {
    item = scan.item,
    metrics = summary,
    analysis_quality_claim = true,
  })
end

local function measure_item_peaks(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_peaks.v1",
    item_ref = scan.item_ref,
    abs_peak_dbfs = scan.abs_peak_dbfs,
    abs_peak_linear = scan.abs_peak_linear,
    positive_peak_linear = scan.positive_peak_linear,
    negative_peak_linear = scan.negative_peak_linear,
    duration_seconds = scan.duration_seconds,
    sample_frames = scan.sample_frames,
    truncated = scan.truncated,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_peaks", summary, {
    item = scan.item,
    metrics = summary,
    analysis_quality_claim = true,
  })
end

local function detect_item_silence(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_silence.v1",
    item_ref = scan.item_ref,
    segment_count = scan.segment_count,
    total_silence_seconds = scan.total_silence_seconds,
    truncated = scan.truncated or scan.segment_count > #scan.silence_segments,
    threshold_dbfs = scan.threshold_dbfs,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_silence", summary, {
    item = scan.item,
    silence_segments = scan.silence_segments,
    threshold_dbfs = scan.threshold_dbfs,
    analysis_quality_claim = true,
  })
end

local function detect_item_transients(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_transients.v1",
    item_ref = scan.item_ref,
    transient_count = scan.transient_count,
    total_detected = scan.total_detected,
    truncated = scan.truncated or scan.total_detected > scan.transient_count,
    first_transient_time = scan.first_transient_time,
    last_transient_time = scan.last_transient_time,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_transients", summary, {
    item = scan.item,
    transients = scan.transients,
    analysis_quality_claim = true,
  })
end
return {
  exports = { measure_item_rms = measure_item_rms, measure_item_peaks = measure_item_peaks, detect_item_silence = detect_item_silence, detect_item_transients = detect_item_transients },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua
__openreaper_register_handler_module("fx/e2_fx_l1_read_route.lua", function()
-- Extracted E2 FX-L1 read handlers.

local function e2_fx_read_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e2_fx_read_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e2_fx_read_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "none"
  readback.artifacts_allowed = readback.artifacts_allowed == true
  readback.write_fx_status = readback.write_fx_status or "held"
  readback.preset_status = readback.preset_status or "held"
  readback.video_processor_status = readback.video_processor_status or "held"
  readback.truncated = readback.truncated == true
  return readback
end

local function e2_fx_read_bounded_limit(request, requested, default_limit, hard_limit)
  local value = tonumber(requested)
  if not value or value < 1 then
    value = default_limit
  end
  value = math.floor(value)
  if value > hard_limit then
    value = hard_limit
  end
  return value
end

local function e2_fx_read_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e2_fx_read_track_index(track)
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

local function e2_fx_read_track_ref_string(track)
  local guid = e2_fx_read_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e2_fx_read_track_index(track))
end

local function e2_fx_read_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e2_fx_read_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e2_fx_read_resolve_track_token(token)
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
    return e2_fx_read_find_track_by_guid(guid)
  end
  return nil
end

local function e2_fx_read_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e2_fx_read_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e2_fx_read_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e2_fx_read_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e2_fx_read_resolve_track_token(ref.ref)
end

local function e2_fx_read_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e2_fx_read_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e2_fx_read_item_guid(item)
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

local function e2_fx_read_take_guid(take)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok and type(guid) == "string" and guid ~= "" then
    return guid
  end
  return nil
end

local function e2_fx_read_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and e2_fx_read_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function e2_fx_read_take_ref_string(take)
  local guid = e2_fx_read_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  return "take:index:0"
end

local function e2_fx_read_find_take_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for item_index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_take_count, take_count = call_reaper("CountTakes", item)
      local takes = ok_take_count and first_number(take_count) or 0
      for take_index = 0, takes - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take and e2_fx_read_take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

local function e2_fx_read_resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
  end
  local active_item_index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if active_item_index then
    local ok_item, item = call_reaper("GetMediaItem", 0, tonumber(active_item_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
  end
  local item_guid, take_index = token:match("^take:item_guid:(.-):(%d+)$")
  if item_guid then
    local item = e2_fx_read_find_item_by_guid(item_guid)
    if item then
      local ok_take, take = call_reaper("GetTake", item, tonumber(take_index))
      return ok_take and take or nil
    end
  end
  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return e2_fx_read_find_take_by_guid(guid)
  end
  return nil
end

local function e2_fx_read_resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e2_fx_read_resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e2_fx_read_resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e2_fx_read_resolve_take_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "item_guid" then
    return e2_fx_read_resolve_take_token("take:item_guid:" .. tostring(identity.value))
  end
  return e2_fx_read_resolve_take_token(ref.ref)
end

local function e2_fx_read_take_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = e2_fx_read_resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return nil
end

local function e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index)
  return "fx:" .. tostring(owner_kind) .. ":" .. tostring(slot_index)
end

local function e2_fx_read_fx_object_ref(owner_kind, owner_ref, slot_index, name)
  local ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = {
      scheme = owner_kind,
      value = tostring(slot_index),
    },
    display = {
      name = bounded_string(name or "", 160),
      owner_ref = owner_ref,
      slot_index = slot_index,
    },
  }
end

local function e2_fx_read_fx_owner_from_ref_object(ref, request)
  if not is_object(ref) or ref.kind ~= "fx" then
    return nil, nil, nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  local scheme = identity.scheme
  local value = tostring(identity.value or "")
  if not is_string(scheme) or scheme == "" then
    scheme, value = ref.ref:match("^fx:([^:]+):(.+)$")
  end
  local slot_index = tonumber(value)
  if not slot_index then
    return nil, nil, nil
  end
  slot_index = math.floor(slot_index)
  if scheme == "track" then
    local track = e2_fx_read_track_from_request_refs(request)
    if not track then
      local ok, default_track = call_reaper("GetTrack", 0, 0)
      track = ok and default_track or nil
    end
    return "track", track, slot_index
  elseif scheme == "take" then
    local take = e2_fx_read_take_from_request_refs(request)
    if not take then
      local ok_item, item = call_reaper("GetSelectedMediaItem", 0, 0)
      if ok_item and item then
        local ok_take, default_take = call_reaper("GetActiveTake", item)
        take = ok_take and default_take or nil
      end
    end
    return "take", take, slot_index
  end
  return nil, nil, nil
end

local function e2_fx_read_fx_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local owner_kind, owner, slot_index = e2_fx_read_fx_owner_from_ref_object(request.refs[index], request)
      if owner_kind and owner and slot_index then
        return owner_kind, owner, slot_index
      end
    end
  end
  return nil, nil, nil
end

local function e2_fx_read_count(owner_kind, owner)
  local ok, count
  if owner_kind == "take" then
    ok, count = call_reaper("TakeFX_GetCount", owner)
  else
    ok, count = call_reaper("TrackFX_GetCount", owner)
  end
  return ok and first_number(count) or 0
end

local function e2_fx_read_name(owner_kind, owner, slot_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetFXName", owner, slot_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetFXName", owner, slot_index, "")
  end
  return bounded_string(ok and first_string(name) or "", 160)
end

local function e2_fx_read_enabled(owner_kind, owner, slot_index)
  local ok, enabled
  if owner_kind == "take" then
    ok, enabled = call_reaper("TakeFX_GetEnabled", owner, slot_index)
  else
    ok, enabled = call_reaper("TrackFX_GetEnabled", owner, slot_index)
  end
  return ok and enabled == true or false
end

local function e2_fx_read_param_count(owner_kind, owner, slot_index)
  local ok, count
  if owner_kind == "take" then
    ok, count = call_reaper("TakeFX_GetNumParams", owner, slot_index)
  else
    ok, count = call_reaper("TrackFX_GetNumParams", owner, slot_index)
  end
  return ok and first_number(count) or 0
end

local function e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetParamName", owner, slot_index, param_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetParamName", owner, slot_index, param_index, "")
  end
  return bounded_string(ok and first_string(name) or "", 160)
end

local function e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local ok, value, min_value, max_value
  if owner_kind == "take" then
    ok, value, min_value, max_value = call_reaper("TakeFX_GetParam", owner, slot_index, param_index)
  else
    ok, value, min_value, max_value = call_reaper("TrackFX_GetParam", owner, slot_index, param_index)
  end
  return {
    value = ok and first_number(value) or 0,
    min_value = ok and first_number(min_value) or 0,
    max_value = ok and first_number(max_value) or 1,
  }
end

local function e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local ok, value
  if owner_kind == "take" then
    ok, value = call_reaper("TakeFX_GetParamNormalized", owner, slot_index, param_index)
  else
    ok, value = call_reaper("TrackFX_GetParamNormalized", owner, slot_index, param_index)
  end
  return ok and first_number(value) or JSON_NULL
end

local function e2_fx_read_owner_ref(owner_kind, owner)
  if owner_kind == "take" then
    return e2_fx_read_take_ref_string(owner)
  end
  return e2_fx_read_track_ref_string(owner)
end

local function e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local name = e2_fx_read_name(owner_kind, owner, slot_index)
  return {
    fx_ref = e2_fx_read_fx_ref_string(owner_kind, owner_ref, slot_index),
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    slot_index = slot_index,
    name = name,
    enabled = e2_fx_read_enabled(owner_kind, owner, slot_index),
    parameter_count = e2_fx_read_param_count(owner_kind, owner, slot_index),
  }, e2_fx_read_fx_object_ref(owner_kind, owner_ref, slot_index, name)
end

local function e2_fx_read_chain(owner_kind, owner, request)
  local count = e2_fx_read_count(owner_kind, owner)
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 16, 32)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local summaries = json_array({})
  local refs = json_array({})
  local max_index = math.min(count, limit)
  for slot_index = 0, max_index - 1 do
    local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
    summaries[#summaries + 1] = summary
    refs[#refs + 1] = ref
  end
  return {
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    fx_count = count,
    fx = summaries,
    fx_refs = refs,
    truncated = count > limit,
  }, refs
end

local function resolve_fx_ref(request)
  local owner_kind = request.params and request.params.owner_kind or "track"
  local slot_index = math.floor(tonumber(request.params and request.params.slot_index) or 0)
  local owner = nil
  if owner_kind == "take" then
    owner = e2_fx_read_take_from_request_refs(request)
  else
    owner_kind = "track"
    owner = e2_fx_read_track_from_request_refs(request)
  end
  if not owner then
    return e2_fx_read_error("FX_OWNER_NOT_FOUND", "E2 FX-L1 resolve_fx_ref requires a resolvable track or take owner ref.", {
      owner_kind = owner_kind,
    })
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-L1 resolve_fx_ref slot index is outside the owner FX chain.", {
      owner_kind = owner_kind,
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_read_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function list_track_fx_chain(request)
  local track = e2_fx_read_track_from_request_refs(request)
  if not track then
    return e2_fx_read_error("TRACK_NOT_FOUND", "E2 FX-L1 list_track_fx_chain requires a resolvable track ref.")
  end
  local chain, refs = e2_fx_read_chain("track", track, request)
  return e2_fx_read_summary(request, chain), nil, json_array({}), json_array({}), refs
end

local function list_take_fx_chain(request)
  local take = e2_fx_read_take_from_request_refs(request)
  if not take then
    return e2_fx_read_error("TAKE_NOT_FOUND", "E2 FX-L1 list_take_fx_chain requires a resolvable take ref.")
  end
  local chain, refs = e2_fx_read_chain("take", take, request)
  return e2_fx_read_summary(request, chain), nil, json_array({}), json_array({}), refs
end

local function read_fx_summary(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 read_fx_summary requires a resolvable FX ref.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-L1 read_fx_summary slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_read_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function list_fx_parameters(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 list_fx_parameters requires a resolvable FX ref.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 32, 64)
  local parameters = json_array({})
  local max_index = math.min(count, limit)
  for param_index = 0, max_index - 1 do
    local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
    parameters[#parameters + 1] = {
      param_index = param_index,
      name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
      value = values.value,
      min_value = values.min_value,
      max_value = values.max_value,
      normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
    }
  end
  return e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    parameter_count = count,
    parameters = parameters,
    truncated = count > limit,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end

local function read_fx_parameter(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-L1 read_fx_parameter requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX-L1 read_fx_parameter requires a non-negative integer param_index.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX-L1 read_fx_parameter index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  return e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index),
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end

local function e2_fx_search_query(request)
  local query = request.params and request.params.query
  if not is_string(query) or query:gsub("%s+", "") == "" then
    return nil
  end
  return bounded_string(query, 120)
end

local function e2_fx_non_negative_integer(value, fallback)
  local number = tonumber(value)
  if not number or number < 0 or number ~= math.floor(number) then
    return fallback
  end
  return number
end

local function e2_fx_enum_installed_name(index)
  local ok, first, second = call_reaper("EnumInstalledFX", index, "")
  if not ok then
    return nil, "missing"
  end
  if first == false or first == nil then
    return nil, nil
  end
  if type(first) == "string" then
    return bounded_string(first, 240), nil
  end
  if type(second) == "string" then
    return bounded_string(second, 240), nil
  end
  return nil, nil
end

local function search_installed_fx(request)
  local query = e2_fx_search_query(request)
  if not query then
    return e2_fx_read_error("QUERY_INVALID", "FX installed search requires a non-empty query string.", {
      query = request.params and request.params.query or JSON_NULL,
    })
  end
  local limit = e2_fx_read_bounded_limit(request, request.params and request.params.limit, 16, 50)
  local offset = e2_fx_non_negative_integer(request.params and request.params.offset, 0)
  local needle = query:lower()
  local rows = json_array({})
  local matched = 0
  local scanned = 0
  local truncated = false
  local max_scan = 2048
  for index = 0, max_scan - 1 do
    local name, blocker = e2_fx_enum_installed_name(index)
    if blocker == "missing" then
      return e2_fx_read_error("API_UNAVAILABLE", "REAPER EnumInstalledFX API is not available in this bridge runtime.", {
        api = "EnumInstalledFX",
      })
    end
    if not name then
      break
    end
    scanned = scanned + 1
    if name:lower():find(needle, 1, true) then
      if matched >= offset and #rows < limit then
        rows[#rows + 1] = {
          index = index,
          name = name,
          ident = name,
        }
      elseif matched >= offset and #rows >= limit then
        truncated = true
      end
      matched = matched + 1
    end
  end
  if scanned >= max_scan then
    truncated = true
  end
  return e2_fx_read_summary(request, {
    query = query,
    rows = rows,
    row_count = #rows,
    matched_count = matched,
    scanned_count = scanned,
    limit = limit,
    offset = offset,
    truncated = truncated,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs()
end

local function read_video_processor_code(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX read_video_processor_code requires a resolvable FX ref.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX read_video_processor_code slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local name = e2_fx_read_name(owner_kind, owner, slot_index)
  local is_video_processor = name:lower():find("video processor", 1, true) ~= nil
  if not is_video_processor then
    return e2_fx_read_error("VIDEO_PROCESSOR_NOT_FOUND", "FX slot is not a Video Processor FX.", {
      slot_index = slot_index,
      name = name,
    })
  end
  local ok, _, code = call_reaper(
    owner_kind == "take" and "TakeFX_GetNamedConfigParm" or "TrackFX_GetNamedConfigParm",
    owner,
    slot_index,
    "VIDEO_CODE"
  )
  if not ok or type(code) ~= "string" then
    return e2_fx_read_error("VIDEO_CODE_UNAVAILABLE", "REAPER did not expose VIDEO_CODE for this Video Processor FX.", {
      slot_index = slot_index,
      name = name,
    })
  end
  local byte_limit = math.min(32768, tonumber(request.params and request.params.max_code_bytes) or 32768)
  if byte_limit < 1 then
    byte_limit = 1
  end
  local truncated = #code > byte_limit
  local bounded_code = truncated and code:sub(1, byte_limit) or code
  local summary = {
    artifact_ref = "",
    schema = FX_ARTIFACT_SPECS.video_processor_code.schema,
    owner_kind = owner_kind,
    owner_ref = e2_fx_read_owner_ref(owner_kind, owner),
    slot_index = slot_index,
    name = name,
    code_bytes = #bounded_code,
    original_code_bytes = #code,
    truncated = truncated,
  }
  local write, failure = write_a1_artifact(request, FX_ARTIFACT_SPECS.video_processor_code, summary, {
    fx = e2_fx_read_fx_summary(owner_kind, owner, slot_index),
    code = bounded_code,
  })
  if not write then
    return e2_fx_read_error(failure.code, failure.message, failure.details)
  end
  summary.artifact_ref = write.object_ref.ref
  summary.bytes = write.bytes
  summary.artifacts_allowed = true
  summary.video_processor_status = "passed"
  return e2_fx_read_summary(request, summary), nil, json_array({ write.object_ref }), json_array({}), e2_fx_read_refs(write.object_ref)
end

local function e2_fx_write_summary(request, readback)
  local summary = e2_fx_read_summary(request, readback)
  summary.undo_evidence = "required"
  summary.write_fx_status = "passed"
  return summary
end

local function e2_fx_plugin_name(request)
  local name = request.params and request.params.plugin_name
  if not is_string(name) or name:gsub("%s+", "") == "" then
    return nil
  end
  return bounded_string(name, 240)
end

local function e2_fx_insert_index(request, count)
  local raw = request.params and request.params.insert_at_index
  if raw == nil or raw == JSON_NULL then
    return count
  end
  local index = tonumber(raw)
  if not index or index < 0 or index ~= math.floor(index) or index > count then
    return nil
  end
  return index
end

local function e2_fx_track_add_by_name(track, plugin_name, insert_index)
  local instantiate = -1000 - insert_index
  local ok, slot_index = call_reaper("TrackFX_AddByName", track, plugin_name, false, instantiate)
  if not ok then
    return nil
  end
  return math.floor(first_number(slot_index) or -1)
end

local function e2_fx_take_add_by_name(take, plugin_name, insert_index)
  local instantiate = -1000 - insert_index
  local ok, slot_index = call_reaper("TakeFX_AddByName", take, plugin_name, instantiate)
  if not ok then
    return nil
  end
  return math.floor(first_number(slot_index) or -1)
end

local function e2_fx_set_enabled(owner_kind, owner, slot_index, enabled)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetEnabled", owner, slot_index, enabled) == true
  end
  return call_reaper("TrackFX_SetEnabled", owner, slot_index, enabled) == true
end

local function e2_fx_set_param_normalized(owner_kind, owner, slot_index, param_index, value)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetParamNormalized", owner, slot_index, param_index, value) == true
  end
  return call_reaper("TrackFX_SetParamNormalized", owner, slot_index, param_index, value) == true
end

local function e2_fx_get_preset(owner_kind, owner, slot_index)
  local ok, _, name
  if owner_kind == "take" then
    ok, _, name = call_reaper("TakeFX_GetPreset", owner, slot_index, "")
  else
    ok, _, name = call_reaper("TrackFX_GetPreset", owner, slot_index, "")
  end
  if not ok then
    return nil
  end
  return bounded_string(first_string(name) or "", 240)
end

local function e2_fx_set_preset(owner_kind, owner, slot_index, preset_name)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetPreset", owner, slot_index, preset_name) == true
  end
  return call_reaper("TrackFX_SetPreset", owner, slot_index, preset_name) == true
end

local function e2_fx_set_preset_by_index(owner_kind, owner, slot_index, preset_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_SetPresetByIndex", owner, slot_index, preset_index) == true
  end
  return call_reaper("TrackFX_SetPresetByIndex", owner, slot_index, preset_index) == true
end

local function e2_fx_get_preset_index(owner_kind, owner, slot_index)
  local ok, preset_index, preset_count
  if owner_kind == "take" then
    ok, preset_index, preset_count = call_reaper("TakeFX_GetPresetIndex", owner, slot_index)
  else
    ok, preset_index, preset_count = call_reaper("TrackFX_GetPresetIndex", owner, slot_index)
  end
  if not ok then
    return JSON_NULL, JSON_NULL
  end
  return math.floor(first_number(preset_index) or -1), math.floor(first_number(preset_count) or -1)
end

local function e2_fx_get_parameter_envelope(owner_kind, owner, slot_index, param_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_GetEnvelope", owner, slot_index, param_index, false)
  end
  return call_reaper("GetFXEnvelope", owner, slot_index, param_index, false)
end

local function e2_fx_envelope_name(envelope, fallback)
  if not envelope then
    return fallback
  end
  local ok, _, name = call_reaper("GetEnvelopeName", envelope, "")
  return bounded_string(ok and first_string(name) or fallback or "", 200)
end

local function e2_fx_envelope_object_ref(owner_kind, owner_ref, slot_index, param_index, envelope_name)
  local ref = "envelope:fx:" .. tostring(owner_kind) .. ":" .. tostring(slot_index) .. ":param:" .. tostring(param_index)
  return {
    kind = "envelope",
    ref = ref,
    identity = {
      scheme = "fx_parameter",
      value = tostring(owner_kind) .. ":" .. tostring(slot_index) .. ":" .. tostring(param_index),
    },
    display = {
      name = bounded_string(envelope_name or "", 200),
      owner_ref = owner_ref,
      fx_slot_index = slot_index,
      param_index = param_index,
    },
  }
end

local function e2_fx_copy_move(owner_kind, owner, slot_index, target_index)
  if owner_kind == "take" then
    return call_reaper("TakeFX_CopyToTake", owner, slot_index, owner, target_index, true) == true
  end
  return call_reaper("TrackFX_CopyToTrack", owner, slot_index, owner, target_index, true) == true
end

local function add_track_fx(request)
  local track = e2_fx_read_track_from_request_refs(request)
  if not track then
    return e2_fx_read_error("TRACK_NOT_FOUND", "E2 FX-B1 add_track_fx requires a resolvable track ref.")
  end
  local plugin_name = e2_fx_plugin_name(request)
  if not plugin_name then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_track_fx requires a non-empty plugin_name.")
  end
  local before_count = e2_fx_read_count("track", track)
  local insert_index = e2_fx_insert_index(request, before_count)
  if not insert_index then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_track_fx insert_at_index is outside the track FX chain.", {
      fx_count = before_count,
      insert_at_index = request.params and request.params.insert_at_index,
    })
  end
  local slot_index = e2_fx_track_add_by_name(track, plugin_name, insert_index)
  if not slot_index or slot_index < 0 then
    return e2_fx_read_error("FX_NOT_FOUND", "E2 FX-B1 add_track_fx could not instantiate the requested FX.", {
      plugin_name = plugin_name,
    })
  end
  local after_count = e2_fx_read_count("track", track)
  if after_count <= before_count then
    return e2_fx_read_error("COMMAND_FAILED", "E2 FX-B1 add_track_fx did not increase the track FX count.", {
      before_count = before_count,
      after_count = after_count,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary("track", track, slot_index)
  summary.plugin_name = plugin_name
  summary.fx_count_before = before_count
  summary.fx_count_after = after_count
  summary.created = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function add_take_fx(request)
  local take = e2_fx_read_take_from_request_refs(request)
  if not take then
    return e2_fx_read_error("TAKE_NOT_FOUND", "E2 FX-B1 add_take_fx requires a resolvable take ref.")
  end
  local plugin_name = e2_fx_plugin_name(request)
  if not plugin_name then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_take_fx requires a non-empty plugin_name.")
  end
  local before_count = e2_fx_read_count("take", take)
  local insert_index = e2_fx_insert_index(request, before_count)
  if not insert_index then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 add_take_fx insert_at_index is outside the take FX chain.", {
      fx_count = before_count,
      insert_at_index = request.params and request.params.insert_at_index,
    })
  end
  local slot_index = e2_fx_take_add_by_name(take, plugin_name, insert_index)
  if not slot_index or slot_index < 0 then
    return e2_fx_read_error("FX_NOT_FOUND", "E2 FX-B1 add_take_fx could not instantiate the requested FX.", {
      plugin_name = plugin_name,
    })
  end
  local after_count = e2_fx_read_count("take", take)
  if after_count <= before_count then
    return e2_fx_read_error("COMMAND_FAILED", "E2 FX-B1 add_take_fx did not increase the take FX count.", {
      before_count = before_count,
      after_count = after_count,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary("take", take, slot_index)
  summary.plugin_name = plugin_name
  summary.fx_count_before = before_count
  summary.fx_count_after = after_count
  summary.created = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_bypass(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 set_fx_bypass requires a resolvable FX ref.")
  end
  if type(request.params and request.params.enabled) ~= "boolean" then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 set_fx_bypass requires boolean enabled.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-B1 set_fx_bypass slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local enabled = request.params.enabled == true
  if not e2_fx_set_enabled(owner_kind, owner, slot_index, enabled) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX enabled-state update.", {}, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.requested_enabled = enabled
  summary.updated = summary.enabled == enabled
  if not summary.updated then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX-B1 set_fx_bypass did not read back the requested enabled state.", {
      requested_enabled = enabled,
      readback_enabled = summary.enabled,
    }, false)
  end
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_parameter_normalized(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 set_fx_parameter_normalized requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX-B1 set_fx_parameter_normalized requires a non-negative integer param_index.")
  end
  local normalized_value = tonumber(request.params and request.params.normalized_value)
  if not normalized_value or normalized_value < 0 or normalized_value > 1 then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 normalized_value must be between 0 and 1.", {
      normalized_value = request.params and request.params.normalized_value,
    })
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX-B1 set_fx_parameter_normalized index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  if not e2_fx_set_param_normalized(owner_kind, owner, slot_index, param_index, normalized_value) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX parameter update.", {}, false)
  end
  local tolerance = tonumber(request.params and request.params.tolerance) or 0.001
  if tolerance < 0 then
    tolerance = 0.001
  end
  local values = e2_fx_read_param_value(owner_kind, owner, slot_index, param_index)
  local readback_normalized = e2_fx_read_param_normalized(owner_kind, owner, slot_index, param_index)
  local updated = type(readback_normalized) == "number" and math.abs(readback_normalized - normalized_value) <= tolerance
  if not updated then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX-B1 set_fx_parameter_normalized did not read back within tolerance.", {
      requested_normalized_value = normalized_value,
      readback_normalized_value = readback_normalized,
      tolerance = tolerance,
    }, false)
  end
  local _, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  return e2_fx_write_summary(request, {
    owner_kind = owner_kind,
    slot_index = slot_index,
    param_index = param_index,
    name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index),
    value = values.value,
    min_value = values.min_value,
    max_value = values.max_value,
    normalized_value = readback_normalized,
    requested_normalized_value = normalized_value,
    tolerance = tolerance,
    updated = updated,
  }), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function reorder_fx(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX-B1 reorder_fx requires a resolvable FX ref.")
  end
  local target_index = tonumber(request.params and request.params.target_index)
  if not target_index or target_index < 0 or target_index ~= math.floor(target_index) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX-B1 reorder_fx requires a non-negative integer target_index.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count or target_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX-B1 reorder_fx slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      target_index = target_index,
      fx_count = count,
    })
  end
  if target_index ~= slot_index and not e2_fx_copy_move(owner_kind, owner, slot_index, target_index) then
    return e2_fx_read_error("COMMAND_FAILED", "REAPER rejected the FX reorder operation.", {}, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, target_index)
  summary.previous_slot_index = slot_index
  summary.target_index = target_index
  summary.updated = summary.slot_index == target_index
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_preset_by_name(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX preset write requires a resolvable FX ref.")
  end
  local preset_name = request.params and request.params.preset_name
  if not is_string(preset_name) or preset_name:gsub("%s+", "") == "" then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX preset write requires a non-empty preset_name.")
  end
  preset_name = bounded_string(preset_name, 240)
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX preset write slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local previous_preset = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  if not e2_fx_set_preset(owner_kind, owner, slot_index, preset_name) then
    return e2_fx_read_error("PRESET_NOT_FOUND", "REAPER rejected the requested FX preset name.", {
      preset_name = preset_name,
    })
  end
  local readback_preset = e2_fx_get_preset(owner_kind, owner, slot_index)
  if readback_preset ~= preset_name then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX preset write did not read back the requested preset name.", {
      requested_preset_name = preset_name,
      readback_preset_name = readback_preset or JSON_NULL,
    }, false)
  end
  local preset_index, preset_count = e2_fx_get_preset_index(owner_kind, owner, slot_index)
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.previous_preset_name = previous_preset
  summary.preset_name = readback_preset
  summary.preset_index = preset_index
  summary.preset_count = preset_count
  summary.updated = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function set_fx_preset_by_index(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX preset write requires a resolvable FX ref.")
  end
  local preset_index = tonumber(request.params and request.params.preset_index)
  if not preset_index or preset_index < 0 or preset_index ~= math.floor(preset_index) then
    return e2_fx_read_error("PARAMS_INVALID", "E2 FX preset write requires a non-negative integer preset_index.")
  end
  local count = e2_fx_read_count(owner_kind, owner)
  if slot_index < 0 or slot_index >= count then
    return e2_fx_read_error("FX_SLOT_NOT_FOUND", "E2 FX preset write slot index is outside the owner FX chain.", {
      slot_index = slot_index,
      fx_count = count,
    })
  end
  local previous_preset = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  if not e2_fx_set_preset_by_index(owner_kind, owner, slot_index, preset_index) then
    return e2_fx_read_error("PRESET_NOT_FOUND", "REAPER rejected the requested FX preset index.", {
      preset_index = preset_index,
    })
  end
  local readback_index, preset_count = e2_fx_get_preset_index(owner_kind, owner, slot_index)
  if type(readback_index) == "number" and readback_index >= 0 and readback_index ~= preset_index then
    return e2_fx_read_error("VERIFY_FAILED", "E2 FX preset write did not read back the requested preset index.", {
      requested_preset_index = preset_index,
      readback_preset_index = readback_index,
    }, false)
  end
  local summary, ref = e2_fx_read_fx_summary(owner_kind, owner, slot_index)
  summary.previous_preset_name = previous_preset
  summary.preset_name = e2_fx_get_preset(owner_kind, owner, slot_index) or JSON_NULL
  summary.preset_index = readback_index
  summary.requested_preset_index = preset_index
  summary.preset_count = preset_count
  summary.updated = true
  return e2_fx_write_summary(request, summary), nil, json_array({}), json_array({}), e2_fx_read_refs(ref)
end

local function parameter_to_envelope_mapping(request)
  local owner_kind, owner, slot_index = e2_fx_read_fx_from_request_refs(request)
  if not owner then
    return e2_fx_read_error("FX_REF_NOT_FOUND", "E2 FX parameter envelope mapping requires a resolvable FX ref.")
  end
  local param_index = tonumber(request.params and request.params.param_index)
  if not param_index or param_index < 0 or param_index ~= math.floor(param_index) then
    return e2_fx_read_error("FX_PARAMETER_INVALID", "E2 FX parameter envelope mapping requires a non-negative integer param_index.")
  end
  local count = e2_fx_read_param_count(owner_kind, owner, slot_index)
  if param_index >= count then
    return e2_fx_read_error("FX_PARAMETER_NOT_FOUND", "E2 FX parameter envelope mapping index is outside the FX parameter count.", {
      param_index = param_index,
      parameter_count = count,
    })
  end
  local ok, envelope = e2_fx_get_parameter_envelope(owner_kind, owner, slot_index, param_index)
  local owner_ref = e2_fx_read_owner_ref(owner_kind, owner)
  local param_name = e2_fx_read_param_name(owner_kind, owner, slot_index, param_index)
  local envelope_available = ok and envelope ~= nil
  local envelope_name = e2_fx_envelope_name(envelope_available and envelope or nil, param_name)
  local envelope_ref = e2_fx_envelope_object_ref(owner_kind, owner_ref, slot_index, param_index, envelope_name)
  local summary = e2_fx_read_summary(request, {
    owner_kind = owner_kind,
    owner_ref = owner_ref,
    slot_index = slot_index,
    param_index = param_index,
    param_ident = request.params and request.params.param_ident or JSON_NULL,
    parameter_count = count,
    parameter_name = param_name,
    envelope_available = envelope_available,
    envelope_ref = envelope_available and envelope_ref.ref or JSON_NULL,
    potential_envelope_ref = envelope_ref.ref,
    envelope_name = envelope_name,
  })
  return summary, nil, json_array({}), json_array({}), envelope_available and e2_fx_read_refs(envelope_ref) or e2_fx_read_refs()
end
return {
  exports = { read_video_processor_code = read_video_processor_code, resolve_fx_ref = resolve_fx_ref, list_track_fx_chain = list_track_fx_chain, list_take_fx_chain = list_take_fx_chain, read_fx_summary = read_fx_summary, list_fx_parameters = list_fx_parameters, read_fx_parameter = read_fx_parameter, parameter_to_envelope_mapping = parameter_to_envelope_mapping, add_track_fx = add_track_fx, add_take_fx = add_take_fx, set_fx_bypass = set_fx_bypass, set_fx_parameter_normalized = set_fx_parameter_normalized, set_fx_preset_by_name = set_fx_preset_by_name, set_fx_preset_by_index = set_fx_preset_by_index, reorder_fx = reorder_fx, search_installed_fx = search_installed_fx },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/routing/e5_r1_routing_read_route.lua
__openreaper_register_handler_module("routing/e5_r1_routing_read_route.lua", function()
local READ_B_MEDIA = OPENREAPER_HANDLER_SHARED.READ_B_MEDIA
-- Extracted E5-R1 routing read handlers.

local function e5_routing_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e5_routing_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e5_routing_append_refs(target, source)
  if not is_json_array(source) then
    return target
  end
  for index = 1, #source do
    target[#target + 1] = source[index]
  end
  return target
end

local function e5_routing_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function e5_routing_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e5_routing_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e5_routing_track_index(track)
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

local function e5_routing_track_ref_string(track)
  local guid = e5_routing_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e5_routing_track_index(track))
end

local function e5_routing_track_object_ref(track)
  local ref = e5_routing_track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function e5_routing_envelope_object_ref(envelope, ref)
  return {
    kind = "envelope",
    ref = ref,
    identity = {
      scheme = "synthetic",
      value = ref,
    },
  }
end

local function e5_routing_fx_object_ref(track, slot_index)
  local ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index)
  return {
    kind = "fx",
    ref = ref,
    identity = {
      scheme = "track_fx",
      value = e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
    },
  }
end

local function e5_routing_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e5_routing_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e5_routing_resolve_track_token(token)
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
    return e5_routing_find_track_by_guid(guid)
  end
  return nil
end

local function e5_routing_fx_from_ref(fx_ref)
  if not is_string(fx_ref) then
    return nil, nil
  end
  local track_ref, slot_text = fx_ref:match("^fx:(track:[^:]+:.+):(%d+)$")
  if not track_ref then
    slot_text = fx_ref:match("^fx:track:(%d+)$")
    if slot_text then
      track_ref = "track:index:0"
    end
  end
  if not track_ref or not slot_text then
    return nil, nil
  end
  local track = e5_routing_resolve_track_token(track_ref)
  local slot_index = tonumber(slot_text)
  if not track or not slot_index then
    return nil, nil
  end
  return track, math.floor(slot_index)
end

local function e5_routing_fx_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "fx" then
        local track, slot_index = e5_routing_fx_from_ref(ref.ref)
        if track then
          return track, slot_index
        end
      end
    end
  end
  return nil, nil
end

local function e5_routing_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e5_routing_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e5_routing_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e5_routing_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e5_routing_resolve_track_token(ref.ref)
end

local function e5_routing_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e5_routing_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e5_routing_send_ref(source_track, send_index)
  return "send:" .. e5_routing_track_ref_string(source_track) .. ":" .. tostring(send_index)
end

local function e5_routing_send_object_ref(source_track, send_index)
  local ref = e5_routing_send_ref(source_track, send_index)
  return {
    kind = "send",
    ref = ref,
    identity = {
      scheme = "track_send",
      value = e5_routing_track_ref_string(source_track) .. ":" .. tostring(send_index),
    },
  }
end

local function e5_routing_hardware_output_ref(track, output_index)
  return "hardware_output:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(output_index)
end

local function e5_routing_send_index_from_ref(send_ref)
  if not is_string(send_ref) then
    return nil
  end
  local track_ref, index_text = send_ref:match("^send:(track:[^:]+:.+):(%d+)$")
  if not track_ref then
    track_ref, index_text = send_ref:match("^send:track:(%d+):(%d+)$")
    if track_ref then
      track_ref = "track:index:" .. track_ref
    end
  end
  if not track_ref or not index_text then
    return nil, nil
  end
  local track = e5_routing_resolve_track_token(track_ref)
  local send_index = tonumber(index_text)
  if not track or not send_index then
    return nil, nil
  end
  return track, math.floor(send_index)
end

local function e5_routing_read_send_value(track, category, send_index, key, fallback)
  local ok, value = call_reaper("GetTrackSendInfo_Value", track, category, send_index, key)
  if ok then
    return first_number(value) or fallback
  end
  return fallback
end

local function e5_routing_send_mode_label(value)
  if value == 1 then
    return "pre_fx"
  elseif value == 3 then
    return "post_fx"
  end
  return "post_fader"
end

local function e5_routing_master_parent_enabled(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "B_MAINSEND")
  return ok and first_number(value) ~= 0 or false
end

local function e5_routing_channel_count(track)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, "I_NCHAN")
  local channels = ok and first_number(value) or 2
  if channels < 2 then
    return 2
  end
  return math.floor(channels)
end

local function e5_routing_send_summary(source_track, send_index, category)
  local ok_destination, destination_track = call_reaper("GetTrackSendInfo_Value", source_track, category, send_index, "P_DESTTRACK")
  if not ok_destination or not destination_track then
    return nil
  end
  return {
    send_ref = e5_routing_send_ref(source_track, send_index),
    category = category == -1 and "receive" or "send",
    source_track_ref = e5_routing_track_ref_string(source_track),
    destination_track_ref = e5_routing_track_ref_string(destination_track),
    index = send_index,
    volume = e5_routing_read_send_value(source_track, category, send_index, "D_VOL", 1),
    pan = e5_routing_read_send_value(source_track, category, send_index, "D_PAN", 0),
    muted = e5_routing_read_send_value(source_track, category, send_index, "B_MUTE", 0) ~= 0,
    mode = e5_routing_send_mode_label(e5_routing_read_send_value(source_track, category, send_index, "I_SENDMODE", 0)),
  }
end

local function e5_routing_compact_send_summary(source_track, send_index)
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return nil
  end
  return {
    send_ref = summary.send_ref,
    source_track_ref = summary.source_track_ref,
    destination_track_ref = summary.destination_track_ref,
    index = summary.index,
  }
end

local function e5_routing_send_count(track, category)
  local ok, count = call_reaper("GetTrackNumSends", track, category)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_routing_hardware_output_summary(track, hardware_index)
  local output_index = e5_routing_read_send_value(track, 1, hardware_index, "I_DSTCHAN", 0)
  local source_value = e5_routing_read_send_value(track, 1, hardware_index, "I_SRCCHAN", 0)
  local source_channel_offset = source_value % 1024
  local mix_to_mono = source_value >= 1024
  local ok_name, output_name = call_reaper("GetOutputChannelName", output_index)
  return {
    hardware_output_ref = e5_routing_hardware_output_ref(track, output_index),
    track_ref = e5_routing_track_ref_string(track),
    hardware_index = hardware_index,
    output_index = output_index,
    output_name = bounded_string(ok_name and first_string(output_name) or "", 160),
    source_channel_offset = source_channel_offset,
    source_channel_count = mix_to_mono and 1 or 2,
    mix_to_mono = mix_to_mono,
    muted = e5_routing_read_send_value(track, 1, hardware_index, "B_MUTE", 0) ~= 0,
  }
end

local function e5_routing_hardware_index_for_output(track, output_index)
  local count = e5_routing_send_count(track, 1)
  for hardware_index = 0, count - 1 do
    local current = e5_routing_read_send_value(track, 1, hardware_index, "I_DSTCHAN", -1)
    if current == output_index then
      return hardware_index
    end
  end
  return nil
end

local function e5_routing_hardware_source_value(request)
  local source_offset = math.max(0, math.floor(tonumber(request.params.source_channel_offset) or 0))
  local source_count = math.floor(tonumber(request.params.source_channel_count) or 2)
  if source_count ~= 1 and source_count ~= 2 then
    return nil
  end
  if request.params.mix_to_mono == true or source_count == 1 then
    return source_offset + 1024
  end
  return source_offset
end

local function e5_routing_output_index(request)
  local output_index = tonumber(request.params.output_index)
  if not output_index or output_index ~= output_index or output_index < 0 then
    return nil
  end
  return math.floor(output_index)
end

local function e5_routing_track_refs_from_request(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e5_routing_resolve_track_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function e5_routing_send_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "send" then
        local source_track, send_index = e5_routing_send_index_from_ref(ref.ref)
        if source_track then
          return source_track, send_index
        end
      end
    end
  end
  return nil, nil
end

local function e5_routing_send_index_for_destination(source_track, destination_track)
  local count = e5_routing_send_count(source_track, 0)
  local destination_ref = e5_routing_track_ref_string(destination_track)
  for send_index = 0, count - 1 do
    local summary = e5_routing_send_summary(source_track, send_index, 0)
    if summary and summary.destination_track_ref == destination_ref then
      return send_index
    end
  end
  return nil
end

local function e5_routing_write_summary(request, readback)
  readback = e5_routing_summary(request, readback)
  readback.undo_evidence = "required"
  return readback
end

local function e5_routing_set_media_track_value(track, key, value)
  local ok = call_reaper("SetMediaTrackInfo_Value", track, key, value)
  return ok == true
end

local function e5_routing_set_send_value(source_track, send_index, key, value)
  local ok = call_reaper("SetTrackSendInfo_Value", source_track, 0, send_index, key, value)
  return ok == true
end

local function e5_routing_clamp_number(value, min_value, max_value, fallback)
  local number = tonumber(value)
  if not number or number ~= number or number == math.huge or number == -math.huge then
    number = fallback
  end
  if number < min_value then
    number = min_value
  elseif number > max_value then
    number = max_value
  end
  return number
end

local function e5_routing_send_mode_value(mode)
  if mode == "pre_fx" then
    return 1
  elseif mode == "post_fx" then
    return 3
  end
  return 0
end

local function e5_routing_audio_channel_value(request)
  local source_offset = math.max(0, math.floor(tonumber(request.params.source_channel_offset) or 0))
  local source_count = math.floor(tonumber(request.params.source_channel_count) or 2)
  local destination_offset = math.max(0, math.floor(tonumber(request.params.destination_channel_offset) or 0))
  local source_value = source_offset
  if source_count == 1 or request.params.mix_to_mono == true then
    source_value = source_value + 1024
  end
  return source_value, destination_offset
end

local function e5_routing_midi_channel_number(value, fallback)
  if value == "all" or value == "original" or value == nil or value == JSON_NULL then
    return fallback or 0
  end
  local number = math.floor(tonumber(value) or 0)
  if number < 1 or number > 16 then
    return fallback or 0
  end
  return number
end

local function e5_routing_midi_flags(request)
  local source = e5_routing_midi_channel_number(request.params.source_channel, 0)
  local destination = e5_routing_midi_channel_number(request.params.destination_channel, 0)
  return source + destination * 32
end

local function e5_routing_read_sends(track, category, limit)
  local rows = json_array({})
  local refs = json_array({})
  local count = e5_routing_send_count(track, category)
  local truncated = false
  for index = 0, count - 1 do
    if #rows >= limit then
      truncated = true
      break
    end
    local summary = e5_routing_send_summary(track, index, category)
    if summary then
      rows[#rows + 1] = summary
      refs[#refs + 1] = e5_routing_send_object_ref(track, index)
    end
  end
  return rows, refs, truncated
end

local function read_track_routing(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5-R1 read_track_routing requires a resolvable track ref.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_routes, 32, 128)
  local sends, send_refs, sends_truncated = e5_routing_read_sends(track, 0, limit)
  local receives = json_array({})
  local receive_refs = json_array({})
  local receives_truncated = false
  if request.params.include_receives == true then
    receives, receive_refs, receives_truncated = e5_routing_read_sends(track, -1, limit)
  end
  local track_ref = e5_routing_track_ref_string(track)
  local refs = e5_routing_refs(e5_routing_track_object_ref(track))
  e5_routing_append_refs(refs, send_refs)
  e5_routing_append_refs(refs, receive_refs)
  return e5_routing_summary(request, {
    track_ref = track_ref,
    channel_count = e5_routing_channel_count(track),
    master_parent_enabled = request.params.include_master_parent == false and JSON_NULL or e5_routing_master_parent_enabled(track),
    sends = sends,
    receives = receives,
    truncated = sends_truncated or receives_truncated,
  }), nil, nil, nil, refs
end

local function list_track_hardware_outputs(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing list_track_hardware_outputs requires a resolvable track ref.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_outputs, 16, 64)
  local count = e5_routing_send_count(track, 1)
  local rows = json_array({})
  for hardware_index = 0, math.min(count, limit) - 1 do
    rows[#rows + 1] = e5_routing_hardware_output_summary(track, hardware_index)
  end
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    hardware_output_count = count,
    hardware_outputs = rows,
    truncated = count > limit,
  }), nil, nil, nil, e5_routing_refs(e5_routing_track_object_ref(track))
end

local function create_track_send(request)
  local tracks = e5_routing_track_refs_from_request(request)
  local source_track = tracks[1]
  local destination_track = tracks[2]
  if not source_track or not destination_track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing create_track_send requires source and destination track refs.", {})
  end
  local existing = e5_routing_send_index_for_destination(source_track, destination_track)
  if existing ~= nil and request.params.duplicate_policy == "reject_existing" then
    return e5_routing_error("SEND_NOT_FOUND", "E5 routing create_track_send rejected an existing duplicate send.", {
      send_ref = e5_routing_send_ref(source_track, existing),
    })
  end
  local send_index = existing
  if send_index == nil then
    local ok, created_index = call_reaper("CreateTrackSend", source_track, destination_track)
    send_index = ok and first_number(created_index) or nil
  end
  if send_index == nil or send_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER did not create a track send.", {})
  end
  send_index = math.floor(send_index)
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "Created send could not be read back.", {
      send_index = send_index,
    })
  end
  summary.created = existing == nil
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track),
    e5_routing_track_object_ref(destination_track)
  )
end

local function e5_routing_update_send(request, setter)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 routing send update requires a resolvable send ref.", {})
  end
  if not setter(source_track, send_index) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the send update.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "Updated send could not be read back.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track)
  )
end

local function set_send_volume(request)
  local volume = e5_routing_clamp_number(request.params.volume, 0, 4, 1)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "D_VOL", volume)
  end)
end

local function set_send_pan(request)
  local pan = e5_routing_clamp_number(request.params.pan, -1, 1, 0)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "D_PAN", pan)
  end)
end

local function set_send_mute(request)
  local muted = request.params.muted == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_MUTE", muted)
  end)
end

local function set_send_mode(request)
  local mode = e5_routing_send_mode_value(request.params.mode)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_SENDMODE", mode)
  end)
end

local function set_send_audio_channels(request)
  local source_value, destination_value = e5_routing_audio_channel_value(request)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_SRCCHAN", source_value)
      and e5_routing_set_send_value(source_track, send_index, "I_DSTCHAN", destination_value)
  end)
end

local function set_send_phase(request)
  local phase = request.params.phase_inverted == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_PHASE", phase)
  end)
end

local function set_send_mono(request)
  local mono = request.params.mono == true and 1 or 0
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "B_MONO", mono)
  end)
end

local function set_send_midi_channels(request)
  local flags = e5_routing_midi_flags(request)
  return e5_routing_update_send(request, function(source_track, send_index)
    return e5_routing_set_send_value(source_track, send_index, "I_MIDIFLAGS", flags)
  end)
end

local function set_master_parent_send(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_master_parent_send requires a resolvable track ref.", {})
  end
  if not e5_routing_set_media_track_value(track, "B_MAINSEND", request.params.enabled == true and 1 or 0) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the master-parent send update.", {})
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    master_parent_enabled = e5_routing_master_parent_enabled(track),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_channel_count(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_track_channel_count requires a resolvable track ref.", {})
  end
  local channels = math.floor(tonumber(request.params.channel_count) or 2)
  if channels < 2 then
    channels = 2
  end
  if channels % 2 == 1 then
    channels = channels + 1
  end
  if channels > 64 then
    channels = 64
  end
  if not e5_routing_set_media_track_value(track, "I_NCHAN", channels) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the track channel-count update.", {})
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    channel_count = e5_routing_channel_count(track),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function track_mono_or_stereo_button(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing track_mono_or_stereo_button requires a resolvable track ref.", {})
  end
  local mode = request.params.mode
  if mode ~= "mono" and mode ~= "stereo" then
    return e5_routing_error("PARAMS_INVALID", "Track mono/stereo mode must be mono or stereo.", {
      mode = request.params.mode,
    })
  end
  local channels = mode == "mono" and 1 or 2
  if not e5_routing_set_media_track_value(track, "I_NCHAN", channels) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the track mono/stereo update.", {
      mode = mode,
    }, false)
  end
  local readback_channels = e5_routing_channel_count(track)
  local readback_mode = readback_channels <= 1 and "mono" or "stereo"
  if readback_mode ~= mode then
    return e5_routing_error("READBACK_MISMATCH", "Track mono/stereo mode did not read back the requested value.", {
      requested_mode = mode,
      readback_mode = readback_mode,
      readback_channel_count = readback_channels,
    }, false)
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    mode = readback_mode,
    channel_count = readback_channels,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_hardware_output(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing set_track_hardware_output requires a resolvable track ref.", {})
  end
  local output_index = e5_routing_output_index(request)
  local source_value = e5_routing_hardware_source_value(request)
  if output_index == nil or source_value == nil then
    return e5_routing_error("PARAMS_INVALID", "Hardware output requires output_index >= 0 and source_channel_count of 1 or 2.", {
      output_index = request.params.output_index,
      source_channel_count = request.params.source_channel_count,
    })
  end
  local hardware_index = e5_routing_hardware_index_for_output(track, output_index)
  if hardware_index == nil then
    local ok_create, created_index = call_reaper("CreateTrackSend", track, nil)
    hardware_index = ok_create and first_number(created_index) or nil
  end
  if hardware_index == nil or hardware_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER did not create a hardware output send.", {}, false)
  end
  hardware_index = math.floor(hardware_index)
  local ok_dst = call_reaper("SetTrackSendInfo_Value", track, 1, hardware_index, "I_DSTCHAN", output_index)
  local ok_src = call_reaper("SetTrackSendInfo_Value", track, 1, hardware_index, "I_SRCCHAN", source_value)
  if not ok_dst or not ok_src then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the hardware output update.", {
      output_index = output_index,
    }, false)
  end
  local summary = e5_routing_hardware_output_summary(track, hardware_index)
  return e5_routing_write_summary(request, summary), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function remove_track_hardware_output(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 routing remove_track_hardware_output requires a resolvable track ref.", {})
  end
  local output_index = e5_routing_output_index(request)
  if output_index == nil then
    return e5_routing_error("PARAMS_INVALID", "Hardware output removal requires output_index >= 0.", {
      output_index = request.params.output_index,
    })
  end
  local hardware_index = e5_routing_hardware_index_for_output(track, output_index)
  if hardware_index == nil then
    if request.params.missing_policy == "error" then
      return e5_routing_error("HARDWARE_OUTPUT_NOT_FOUND", "Requested hardware output assignment was not found.", {
        output_index = output_index,
      })
    end
    return e5_routing_write_summary(request, {
      track_ref = e5_routing_track_ref_string(track),
      output_index = output_index,
      removed = false,
    }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
  end
  local ok_remove = call_reaper("RemoveTrackSend", track, 1, hardware_index)
  if not ok_remove then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected the hardware output removal.", {
      output_index = output_index,
    }, false)
  end
  return e5_routing_write_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    output_index = output_index,
    removed = e5_routing_hardware_index_for_output(track, output_index) == nil,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function resolve_send_ref(request)
  local source_track, send_index = e5_routing_send_index_from_ref(request.params.send_ref)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5-R1 resolve_send_ref requires send:<track-ref>:<index>.", {
      send_ref = bounded_string(request.params.send_ref, 160),
    })
  end
  local summary = e5_routing_send_summary(source_track, send_index, 0)
  if not summary then
    return e5_routing_error("SEND_NOT_FOUND", "E5-R1 resolve_send_ref could not resolve the requested send.", {
      send_ref = bounded_string(request.params.send_ref, 160),
    })
  end
  return e5_routing_summary(request, summary), nil, nil, nil, e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_track_object_ref(source_track)
  )
end

local function list_available_audio_outputs(request)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.max_outputs, 32, 128)
  local outputs = json_array({})
  local scanned = 0
  for output_index = 0, 127 do
    local ok, name = call_reaper("GetOutputChannelName", output_index)
    scanned = scanned + 1
    local label = ok and first_string(name) or ""
    if label ~= "" or request.params.include_unavailable == true then
      outputs[#outputs + 1] = {
        output_index = output_index,
        name = bounded_string(label, 160),
        available = label ~= "",
      }
      if #outputs >= limit then
        break
      end
    end
  end
  return e5_routing_summary(request, {
    audio_outputs = outputs,
    returned_output_count = #outputs,
    scanned_output_count = scanned,
    truncated = #outputs >= limit and scanned < 128,
  }), nil, nil, nil, e5_routing_refs()
end

local function read_project_routing_graph(request)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  local max_tracks = READ_B_MEDIA.bounded_limit(request, request.params.max_tracks, 8, 8)
  local max_edges = READ_B_MEDIA.bounded_limit(request, request.params.max_edges, 24, 24)
  local tracks = json_array({})
  local edges = json_array({})
  local refs = json_array({})
  local truncated = total > max_tracks
  for index = 0, math.min(total, max_tracks) - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      local track_ref = e5_routing_track_ref_string(track)
      tracks[#tracks + 1] = {
        track_ref = track_ref,
        index = index,
        channels = e5_routing_channel_count(track),
        master = request.params.include_master_parent == false and JSON_NULL or e5_routing_master_parent_enabled(track),
      }
      refs[#refs + 1] = e5_routing_track_object_ref(track)
      local send_count = e5_routing_send_count(track, 0)
      for send_index = 0, send_count - 1 do
        if #edges >= max_edges then
          truncated = true
          break
        end
        local summary = e5_routing_compact_send_summary(track, send_index)
        if summary then
          edges[#edges + 1] = summary
          refs[#refs + 1] = e5_routing_send_object_ref(track, send_index)
        end
      end
    end
    if #edges >= max_edges then
      break
    end
  end
  return e5_routing_summary(request, {
    track_count = total,
    returned_track_count = #tracks,
    edge_count = #edges,
    tracks = tracks,
    edges = edges,
    truncated = truncated,
  }), nil, nil, nil, refs
end

local function read_fx_pin_mapping(request)
  local track, slot_index = e5_routing_fx_from_request_refs(request)
  if not track then
    return e5_routing_error("FX_REF_NOT_FOUND", "E5 routing read_fx_pin_mapping requires a resolvable track FX ref.", {})
  end
  local ok_count, count = call_reaper("TrackFX_GetCount", track)
  local fx_count = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  if slot_index < 0 or slot_index >= fx_count then
    return e5_routing_error("FX_SLOT_NOT_FOUND", "E5 routing read_fx_pin_mapping slot index is outside the track FX chain.", {
      slot_index = slot_index,
      fx_count = fx_count,
    })
  end
  local direction = request.params.direction == "output" and "output" or "input"
  local is_output = direction == "output" and 1 or 0
  local pin_index = math.max(0, math.floor(tonumber(request.params.pin_index) or 0))
  local ok, low32, high32 = call_reaper("TrackFX_GetPinMappings", track, slot_index, is_output, pin_index)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected TrackFX_GetPinMappings.", {
      slot_index = slot_index,
      direction = direction,
      pin_index = pin_index,
    })
  end
  low32 = first_number(low32) or 0
  high32 = first_number(high32) or 0
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    fx_ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
    slot_index = slot_index,
    direction = direction,
    pin_index = pin_index,
    low32 = low32,
    high32 = high32,
    truncated = false,
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_track_object_ref(track),
    e5_routing_fx_object_ref(track, slot_index)
  )
end

local function e5_automation_envelope_key(value)
  local raw = is_string(value) and value or "Volume"
  local lowered = raw:lower()
  if lowered == "volume" or lowered == "vol" or lowered == "<volenv" then
    return "volume", "Volume", "<VOLENV", 0
  elseif lowered == "pan" or lowered == "<panenv" then
    return "pan", "Pan", "<PANENV", 1
  elseif lowered == "mute" or lowered == "<muteenv" then
    return "mute", "Mute", "<MUTEENV", 2
  end
  return "volume", "Volume", "<VOLENV", 0
end

local function e5_automation_track_envelope(track, name_or_key)
  local key, display_name, chunk_name = e5_automation_envelope_key(name_or_key)
  local ok_named, envelope = call_reaper("GetTrackEnvelopeByName", track, display_name)
  if ok_named and envelope then
    return envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  local ok_chunk, chunk_envelope = call_reaper("GetTrackEnvelopeByChunkName", track, chunk_name)
  if ok_chunk and chunk_envelope then
    return chunk_envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  local ok_media, media_envelope = call_reaper("GetMediaTrackInfo_Value", track, "P_ENV:" .. chunk_name)
  if ok_media and media_envelope then
    return media_envelope, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
  end
  return nil, "envelope:track:" .. e5_routing_track_ref_string(track) .. ":" .. key, "track", key, display_name
end

local function e5_automation_send_envelope(source_track, send_index, name_or_key)
  local key, display_name, chunk_name, envelope_type = e5_automation_envelope_key(name_or_key)
  local send_ref = e5_routing_send_ref(source_track, send_index)
  local ok_br, br_env = call_reaper("BR_GetMediaTrackSendInfo_Envelope", source_track, 0, send_index, envelope_type)
  if ok_br and br_env then
    return br_env, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
  end
  local ok_send, envelope = call_reaper("GetTrackSendInfo_Value", source_track, 0, send_index, "P_ENV:" .. chunk_name)
  if ok_send and envelope then
    return envelope, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
  end
  return nil, "envelope:" .. send_ref .. ":" .. key, "send", key, display_name
end

local function e5_automation_envelope_from_ref_string(ref)
  if not is_string(ref) then
    return nil
  end
  local key = ref:match("^envelope:track:(%a+)$")
  if key then
    local track = e5_routing_resolve_track_token("track:index:0")
    if not track then
      return nil
    end
    return e5_automation_track_envelope(track, key)
  end
  local track_ref, track_key = ref:match("^envelope:track:(track:[^:]+:.+):(%a+)$")
  if track_ref and track_key then
    local track = e5_routing_resolve_track_token(track_ref)
    if not track then
      return nil
    end
    return e5_automation_track_envelope(track, track_key)
  end
  local send_ref, send_key = ref:match("^envelope:(send:track:.+:%d+):(%a+)$")
  if send_ref and send_key then
    local source_track, send_index = e5_routing_send_index_from_ref(send_ref)
    if not source_track then
      return nil
    end
    return e5_automation_send_envelope(source_track, send_index, send_key)
  end
  return nil
end

local function e5_automation_envelope_from_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "envelope" then
        local envelope, envelope_ref, parent_kind, key, name = e5_automation_envelope_from_ref_string(ref.ref)
        if envelope then
          return envelope, envelope_ref, parent_kind, key, name
        end
      end
    end
  end
  local parent_kind = request.params.parent_kind
  if parent_kind == "track" or parent_kind == nil or parent_kind == JSON_NULL then
    local track = e5_routing_track_from_request_refs(request) or e5_routing_resolve_track_token("track:index:0")
    if track then
      return e5_automation_track_envelope(track, request.params.envelope_name or "Volume")
    end
  end
  return nil
end

local function e5_automation_envelope_name(envelope, fallback)
  local ok, _, name = call_reaper("GetEnvelopeName", envelope, "")
  if ok then
    return first_string(name) or fallback or "Envelope"
  end
  return fallback or "Envelope"
end

local function e5_automation_envelope_scaling(envelope)
  local ok, mode = call_reaper("GetEnvelopeScalingMode", envelope)
  return ok and math.floor(first_number(mode) or 0) or 0
end

local function e5_automation_envelope_point_count(envelope)
  local ok, count = call_reaper("CountEnvelopePoints", envelope)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_automation_item_count(envelope)
  local ok, count = call_reaper("CountAutomationItems", envelope)
  return ok and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function e5_automation_br_properties(envelope)
  local ok_alloc, br_env = call_reaper("BR_EnvAlloc", envelope, false)
  if not ok_alloc or not br_env then
    return {
      active = true,
      visible = false,
      armed = false,
      show_lane = false,
      lane_height = 0,
      default_shape = 0,
      fader_scaling = false,
      br_available = false,
    }
  end
  local ok_props, active, visible, armed, in_lane, lane_height, default_shape, min_value, max_value, center_value, env_type, fader_scaling, automation_options =
    call_reaper("BR_EnvGetProperties", br_env)
  call_reaper("BR_EnvFree", br_env, false)
  if not ok_props then
    return {
      active = true,
      visible = false,
      armed = false,
      show_lane = false,
      lane_height = 0,
      default_shape = 0,
      fader_scaling = false,
      br_available = false,
    }
  end
  return {
    active = active == true,
    visible = visible == true,
    armed = armed == true,
    show_lane = in_lane == true,
    lane_height = math.floor(first_number(lane_height) or 0),
    default_shape = math.floor(first_number(default_shape) or 0),
    min_value = first_number(min_value) or 0,
    max_value = first_number(max_value) or 1,
    center_value = first_number(center_value) or 0,
    envelope_type = math.floor(first_number(env_type) or 0),
    fader_scaling = fader_scaling == true,
    automation_items_options = math.floor(first_number(automation_options) or -1),
    br_available = true,
  }
end

local function e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, extra)
  local props = e5_automation_br_properties(envelope)
  local summary = {
    envelope_ref = envelope_ref,
    parent_kind = parent_kind or "track",
    envelope_type = key or "volume",
    name = e5_automation_envelope_name(envelope, display_name),
    scaling_mode = e5_automation_envelope_scaling(envelope),
    active = props.active,
    armed = props.armed,
    visible = props.visible,
    show_lane = props.show_lane,
    point_count = e5_automation_envelope_point_count(envelope),
    automation_item_count = e5_automation_item_count(envelope),
    br_available = props.br_available,
  }
  if is_object(extra) then
    for k, v in pairs(extra) do
      summary[k] = v
    end
  end
  return e5_routing_summary(request, summary)
end

local function e5_automation_resolve_or_error(request, message)
  local envelope, envelope_ref, parent_kind, key, display_name = e5_automation_envelope_from_request(request)
  if not envelope then
    local _, err = e5_routing_error("ENVELOPE_NOT_FOUND", message or "E5 automation requires a resolvable envelope ref.", {})
    return nil, nil, nil, nil, nil, err
  end
  return envelope, envelope_ref, parent_kind, key, display_name
end

local function resolve_envelope_ref(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request, "E5 automation resolve_envelope_ref requires a resolvable envelope parent/ref.")
  if not envelope then
    return nil, err
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function read_envelope_summary(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function e5_automation_point_row(envelope, index)
  local ok, time, value, shape, tension, selected = call_reaper("GetEnvelopePoint", envelope, index)
  if not ok then
    return nil
  end
  return {
    point_index = index,
    time_seconds = first_number(time) or 0,
    value = first_number(value) or 0,
    shape = math.floor(first_number(shape) or 0),
    tension = first_number(tension) or 0,
    selected = selected == true,
  }
end

local function read_envelope_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local total = e5_automation_envelope_point_count(envelope)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 16, 64)
  local points = json_array({})
  for index = 0, math.min(total, limit) - 1 do
    local row = e5_automation_point_row(envelope, index)
    if row then
      points[#points + 1] = row
    end
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    points = points,
    returned_count = #points,
    total_count = total,
    next_cursor = total > limit and tostring(limit) or JSON_NULL,
    truncated = total > limit,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function evaluate_envelope_at_time(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, 0)
  local sample_rate = e5_routing_finite_number(request.params.sample_rate, 48000)
  local samples_requested = math.max(0, math.floor(tonumber(request.params.samples_requested) or 0))
  local ok, valid_samples, value, dvds, ddvds, dddvds = call_reaper("Envelope_Evaluate", envelope, time_seconds, sample_rate, samples_requested)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected Envelope_Evaluate.", {
      envelope_ref = envelope_ref,
      time_seconds = time_seconds,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    time_seconds = time_seconds,
    value = first_number(value) or 0,
    valid_samples = math.floor(first_number(valid_samples) or 0),
    dVdS = first_number(dvds) or 0,
    ddVdS = first_number(ddvds) or 0,
    dddVdS = first_number(dddvds) or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_envelope_lane_state(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local ok_alloc, br_env = call_reaper("BR_EnvAlloc", envelope, false)
  if ok_alloc and br_env then
    local props = e5_automation_br_properties(envelope)
    local active = request.params.active
    if type(active) ~= "boolean" then active = props.active end
    local visible = request.params.visible
    if type(visible) ~= "boolean" then visible = props.visible end
    local armed = request.params.armed
    if type(armed) ~= "boolean" then armed = props.armed end
    local show_lane = request.params.show_lane
    if type(show_lane) ~= "boolean" then show_lane = props.show_lane end
    call_reaper("BR_EnvSetProperties", br_env, active, visible, armed, show_lane, props.lane_height or 0, props.default_shape or 0, props.fader_scaling == true, props.automation_items_options or -1)
    call_reaper("BR_EnvFree", br_env, true)
    call_reaper("UpdateArrange")
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end

local function insert_envelope_point(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, 0)
  local value = e5_routing_clamp_number(request.params.value, 0, 4, 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or 0))
  local tension = e5_routing_finite_number(request.params.tension, 0)
  local selected = request.params.selected == true
  local before = e5_automation_envelope_point_count(envelope)
  local ok = call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, selected, false)
  call_reaper("Envelope_SortPoints", envelope)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePoint.", {
      envelope_ref = envelope_ref,
    })
  end
  local after = e5_automation_envelope_point_count(envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    point_index = math.max(0, after - 1),
    time_seconds = time_seconds,
    value = value,
    inserted_count = math.max(0, after - before),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_mode_value(mode)
  if mode == "read" then
    return 1
  elseif mode == "touch" then
    return 2
  elseif mode == "write" then
    return 3
  elseif mode == "latch" then
    return 4
  elseif mode == "latch_preview" then
    return 5
  end
  return 0
end

local function e5_automation_send_mode_value(mode)
  if mode == "use_track" then
    return -1
  end
  return e5_automation_mode_value(mode)
end

local function e5_automation_mode_label(value)
  value = math.floor(tonumber(value) or 0)
  if value == -1 then return "use_track" end
  if value == 1 then return "read" end
  if value == 2 then return "touch" end
  if value == 3 then return "write" end
  if value == 4 then return "latch" end
  if value == 5 then return "latch_preview" end
  return "trim_off"
end

local function read_track_automation_mode(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 automation read_track_automation_mode requires a resolvable track ref.", {})
  end
  local ok, mode = call_reaper("GetTrackAutomationMode", track)
  mode = ok and first_number(mode) or 0
  return e5_routing_summary(request, {
    track_ref = e5_routing_track_ref_string(track),
    mode = e5_automation_mode_label(mode),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_track_object_ref(track))
end

local function set_track_automation_mode(request)
  local track = e5_routing_track_from_request_refs(request)
  if not track then
    return e5_routing_error("TRACK_NOT_FOUND", "E5 automation set_track_automation_mode requires a resolvable track ref.", {})
  end
  local mode = e5_automation_mode_value(request.params.mode)
  local ok = call_reaper("SetTrackAutomationMode", track, mode)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected SetTrackAutomationMode.", {})
  end
  return read_track_automation_mode(request)
end

local function read_automation_items(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local total = e5_automation_item_count(envelope)
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 16, 64)
  local items = json_array({})
  for index = 0, math.min(total, limit) - 1 do
    local position = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POSITION", 0, false))
    local length = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_LENGTH", 0, false))
    local pool_id = select(2, call_reaper("GetSetAutomationItemInfo", envelope, index, "D_POOL_ID", 0, false))
    items[#items + 1] = {
      automation_item_index = index,
      position_seconds = first_number(position) or 0,
      length_seconds = first_number(length) or 0,
      pool_id = math.floor(first_number(pool_id) or -1),
    }
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    items = items,
    returned_count = #items,
    total_count = total,
    next_cursor = total > limit and tostring(limit) or JSON_NULL,
    truncated = total > limit,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_envelope_point(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local point_index = math.max(0, math.floor(tonumber(request.params.point_index) or 0))
  if point_index >= e5_automation_envelope_point_count(envelope) then
    local inserted = insert_envelope_point(request)
    return inserted
  end
  local current = e5_automation_point_row(envelope, point_index) or {}
  local time_seconds = e5_routing_finite_number(request.params.time_seconds, current.time_seconds or 0)
  local value = e5_routing_clamp_number(request.params.value, 0, 4, current.value or 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or current.shape or 0))
  local tension = e5_routing_finite_number(request.params.tension, current.tension or 0)
  local selected = request.params.selected == true
  local ok = call_reaper("SetEnvelopePoint", envelope, point_index, time_seconds, value, shape, tension, selected, false)
  call_reaper("Envelope_SortPoints", envelope)
  if not ok then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected SetEnvelopePoint.", {
      envelope_ref = envelope_ref,
      point_index = point_index,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    point_index = point_index,
    time_seconds = time_seconds,
    value = value,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function insert_envelope_points_batch(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  if not is_json_array(request.params.points) then
    return e5_routing_error("REQUEST_INVALID", "E5 automation insert_envelope_points_batch requires points array.", {})
  end
  local limit = math.min(#request.params.points, 32)
  local first_time = nil
  local last_time = nil
  for index = 1, limit do
    local point = is_object(request.params.points[index]) and request.params.points[index] or {}
    local time_seconds = e5_routing_finite_number(point.time_seconds, index - 1)
    local value = e5_routing_clamp_number(point.value, 0, 4, 1)
    local shape = math.max(0, math.floor(tonumber(point.shape) or 0))
    local tension = e5_routing_finite_number(point.tension, 0)
    call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, point.selected == true, true)
    first_time = first_time or time_seconds
    last_time = time_seconds
  end
  call_reaper("Envelope_SortPoints", envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    inserted_count = limit,
    first_time_seconds = first_time or 0,
    last_time_seconds = last_time or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, points)
  if not is_json_array(points) then
    return e5_routing_error("REQUEST_INVALID", "E5 automation point insertion requires a points array.", {})
  end
  local limit = math.min(#points, 128)
  if limit < 1 then
    return e5_routing_error("REQUEST_INVALID", "E5 automation point insertion requires at least one point.", {})
  end
  local before = e5_automation_envelope_point_count(envelope)
  local first_time = nil
  local last_time = nil
  local min_value = nil
  local max_value = nil
  for index = 1, limit do
    local point = is_object(points[index]) and points[index] or {}
    local time_seconds = e5_routing_finite_number(point.time_seconds, index - 1)
    local value = e5_routing_clamp_number(point.value, 0, 4, 1)
    local shape = math.max(0, math.floor(tonumber(point.shape) or 0))
    local tension = e5_routing_finite_number(point.tension, 0)
    local ok = call_reaper("InsertEnvelopePoint", envelope, time_seconds, value, shape, tension, point.selected == true, true)
    if not ok then
      return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertEnvelopePoint in point batch.", {
        envelope_ref = envelope_ref,
        point_index = index - 1,
      })
    end
    first_time = first_time or time_seconds
    last_time = time_seconds
    min_value = min_value and math.min(min_value, value) or value
    max_value = max_value and math.max(max_value, value) or value
  end
  call_reaper("Envelope_SortPoints", envelope)
  local after = e5_automation_envelope_point_count(envelope)
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    requested_count = #points,
    inserted_count = math.max(0, after - before),
    processed_count = limit,
    first_time_seconds = first_time or 0,
    last_time_seconds = last_time or 0,
    min_value = min_value or 0,
    max_value = max_value or 0,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function e5_automation_fx_parameter_envelope_from_request(request)
  local track, slot_index = e5_routing_fx_from_request_refs(request)
  local param_index = math.floor(tonumber(request.params and request.params.param_index) or -1)
  if not track or param_index < 0 then
    return nil, nil, nil
  end
  local ok_count, param_count = call_reaper("TrackFX_GetNumParams", track, slot_index)
  param_count = ok_count and math.floor(first_number(param_count) or 0) or 0
  if param_index >= param_count then
    return nil, nil, {
      code = "FX_PARAMETER_NOT_FOUND",
      message = "FX parameter index is outside the FX parameter count.",
      details = {
        slot_index = slot_index,
        param_index = param_index,
        parameter_count = param_count,
      },
    }
  end
  local ok_env, envelope = call_reaper("GetFXEnvelope", track, slot_index, param_index, false)
  if not ok_env or not envelope then
    return nil, nil, {
      code = "ENVELOPE_NOT_FOUND",
      message = "FX parameter envelope is not available; resolve/create the envelope before inserting points.",
      details = {
        fx_ref = "fx:" .. e5_routing_track_ref_string(track) .. ":" .. tostring(slot_index),
        param_index = param_index,
      },
    }
  end
  local ok_name, _, name = call_reaper("TrackFX_GetParamName", track, slot_index, param_index, "")
  local envelope_ref = "envelope:fx:track:" .. tostring(slot_index) .. ":param:" .. tostring(param_index)
  return envelope, envelope_ref, {
    track = track,
    slot_index = slot_index,
    param_index = param_index,
    param_name = bounded_string(ok_name and first_string(name) or "", 160),
  }
end

local function insert_fx_parameter_envelope_points(request)
  local envelope, envelope_ref, info = e5_automation_fx_parameter_envelope_from_request(request)
  if not envelope then
    return e5_routing_error(info and info.code or "FX_REF_NOT_FOUND", info and info.message or "FX parameter envelope insertion requires a resolvable track FX ref.", info and info.details or {})
  end
  local summary, err, artifacts, jobs, refs = e5_automation_insert_points(request, envelope, envelope_ref, "fx", "fx_parameter", info.param_name, request.params.points)
  if err then
    return nil, err
  end
  summary.fx_ref = "fx:" .. e5_routing_track_ref_string(info.track) .. ":" .. tostring(info.slot_index)
  summary.param_index = info.param_index
  summary.param_ident = request.params.param_ident or JSON_NULL
  summary.param_name = info.param_name
  return summary, err, artifacts, jobs, refs
end

local function insert_sine_wave_points(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local start_seconds = e5_routing_finite_number(request.params.start_seconds, 0)
  local end_seconds = e5_routing_finite_number(request.params.end_seconds, start_seconds)
  if end_seconds <= start_seconds then
    return e5_routing_error("REQUEST_INVALID", "Sine wave end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local point_count = math.floor(tonumber(request.params.point_count) or 0)
  if point_count < 2 or point_count > 512 then
    return e5_routing_error("REQUEST_INVALID", "Sine wave point_count must be between 2 and 512.", {
      point_count = request.params.point_count,
    })
  end
  local center_value = e5_routing_finite_number(request.params.center_value, 0.5)
  local amplitude = math.max(0, e5_routing_finite_number(request.params.amplitude, 0))
  local cycles = e5_routing_finite_number(request.params.cycles, 1)
  local shape = math.max(0, math.floor(tonumber(request.params.shape) or 0))
  local tension = e5_routing_finite_number(request.params.tension, 0)
  local points = json_array({})
  for index = 0, point_count - 1 do
    local ratio = point_count == 1 and 0 or index / (point_count - 1)
    local time_seconds = start_seconds + ((end_seconds - start_seconds) * ratio)
    local radians = ratio * cycles * 2 * math.pi
    local value = e5_routing_clamp_number(center_value + (math.sin(radians) * amplitude), 0, 4, center_value)
    points[#points + 1] = {
      time_seconds = time_seconds,
      value = value,
      shape = shape,
      tension = tension,
    }
  end
  local summary, failure, artifacts, jobs, refs = e5_automation_insert_points(request, envelope, envelope_ref, parent_kind, key, display_name, points)
  if failure then
    return nil, failure
  end
  summary.start_seconds = start_seconds
  summary.end_seconds = end_seconds
  summary.center_value = center_value
  summary.amplitude = amplitude
  summary.cycles = cycles
  summary.point_count = point_count
  return summary, failure, artifacts, jobs, refs
end

local function set_send_automation_mode(request)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 automation set_send_automation_mode requires a resolvable send ref.", {})
  end
  local mode = e5_automation_send_mode_value(request.params.mode)
  if not e5_routing_set_send_value(source_track, send_index, "I_AUTOMODE", mode) then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected send automation mode update.", {})
  end
  local readback = e5_routing_read_send_value(source_track, 0, send_index, "I_AUTOMODE", mode)
  return e5_routing_write_summary(request, {
    send_ref = e5_routing_send_ref(source_track, send_index),
    mode = e5_automation_mode_label(readback),
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_send_object_ref(source_track, send_index))
end

local function create_automation_item(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local position = e5_routing_finite_number(request.params.position_seconds, 0)
  local length = math.max(0.001, e5_routing_finite_number(request.params.length_seconds, 1))
  local pool_id = -1
  if request.params.pool_mode == "reuse_pool" then
    pool_id = math.floor(tonumber(request.params.pool_id) or 0)
  end
  local ok, item_index = call_reaper("InsertAutomationItem", envelope, pool_id, position, length)
  item_index = ok and math.floor(first_number(item_index) or -1) or -1
  if item_index < 0 then
    return e5_routing_error("COMMAND_FAILED", "REAPER rejected InsertAutomationItem.", {
      envelope_ref = envelope_ref,
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    automation_item_index = item_index,
    pool_id = pool_id,
    position_seconds = position,
    length_seconds = length,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function set_automation_item_bounds(request)
  local envelope, envelope_ref, parent_kind, key, display_name, err = e5_automation_resolve_or_error(request)
  if not envelope then
    return nil, err
  end
  local item_index = math.max(0, math.floor(tonumber(request.params.automation_item_index) or 0))
  if item_index >= e5_automation_item_count(envelope) then
    local created = create_automation_item({
      params = {
        position_seconds = request.params.position_seconds or 0,
        length_seconds = request.params.length_seconds or 1,
        pool_mode = "new_empty",
      },
      refs = request.refs,
      pack = request.pack,
    })
    if is_object(created) and created.code then
      return created
    end
  end
  if request.params.position_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_POSITION", e5_routing_finite_number(request.params.position_seconds, 0), true)
  end
  if request.params.length_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_LENGTH", math.max(0.001, e5_routing_finite_number(request.params.length_seconds, 1)), true)
  end
  if request.params.start_offset_seconds ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_STARTOFFS", e5_routing_finite_number(request.params.start_offset_seconds, 0), true)
  end
  if request.params.playrate ~= nil then
    call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_PLAYRATE", math.max(0.001, e5_routing_finite_number(request.params.playrate, 1)), true)
  end
  local position = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_POSITION", 0, false))
  local length = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_LENGTH", 0, false))
  local start_offset = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_STARTOFFS", 0, false))
  local playrate = select(2, call_reaper("GetSetAutomationItemInfo", envelope, item_index, "D_PLAYRATE", 0, false))
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    automation_item_index = item_index,
    position_seconds = first_number(position) or 0,
    length_seconds = first_number(length) or 0,
    start_offset_seconds = first_number(start_offset) or 0,
    playrate = first_number(playrate) or 1,
  }), nil, json_array({}), json_array({}), e5_routing_refs(e5_routing_envelope_object_ref(envelope, envelope_ref))
end

local function resolve_send_envelope(request)
  local source_track, send_index = e5_routing_send_from_request_refs(request)
  if not source_track then
    return e5_routing_error("SEND_NOT_FOUND", "E5 automation resolve_send_envelope requires a resolvable send ref.", {})
  end
  local envelope, envelope_ref, parent_kind, key, display_name = e5_automation_send_envelope(source_track, send_index, request.params.envelope_type or "volume")
  if not envelope then
    return e5_routing_error("ENVELOPE_NOT_FOUND", "E5 automation resolve_send_envelope could not resolve the send envelope.", {
      send_ref = e5_routing_send_ref(source_track, send_index),
    })
  end
  return e5_automation_summary(request, envelope, envelope_ref, parent_kind, key, display_name, {
    send_ref = e5_routing_send_ref(source_track, send_index),
  }), nil, json_array({}), json_array({}), e5_routing_refs(
    e5_routing_send_object_ref(source_track, send_index),
    e5_routing_envelope_object_ref(envelope, envelope_ref)
  )
end
return {
  exports = { track_mono_or_stereo_button = track_mono_or_stereo_button, read_track_routing = read_track_routing, resolve_send_ref = resolve_send_ref, list_track_hardware_outputs = list_track_hardware_outputs, read_project_routing_graph = read_project_routing_graph, list_available_audio_outputs = list_available_audio_outputs, create_track_send = create_track_send, set_send_volume = set_send_volume, set_send_pan = set_send_pan, set_send_mute = set_send_mute, set_send_mode = set_send_mode, set_master_parent_send = set_master_parent_send, set_track_channel_count = set_track_channel_count, set_track_hardware_output = set_track_hardware_output, remove_track_hardware_output = remove_track_hardware_output, set_send_audio_channels = set_send_audio_channels, set_send_phase = set_send_phase, set_send_mono = set_send_mono, set_send_midi_channels = set_send_midi_channels, read_fx_pin_mapping = read_fx_pin_mapping, resolve_envelope_ref = resolve_envelope_ref, read_envelope_summary = read_envelope_summary, read_envelope_points = read_envelope_points, evaluate_envelope_at_time = evaluate_envelope_at_time, set_envelope_lane_state = set_envelope_lane_state, insert_envelope_point = insert_envelope_point, set_track_automation_mode = set_track_automation_mode, read_track_automation_mode = read_track_automation_mode, read_automation_items = read_automation_items, set_envelope_point = set_envelope_point, insert_envelope_points_batch = insert_envelope_points_batch, set_send_automation_mode = set_send_automation_mode, create_automation_item = create_automation_item, set_automation_item_bounds = set_automation_item_bounds, resolve_send_envelope = resolve_send_envelope, insert_fx_parameter_envelope_points = insert_fx_parameter_envelope_points, insert_sine_wave_points = insert_sine_wave_points },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/resolve_named_command.lua
__openreaper_register_handler_module("actions/resolve_named_command.lua", function()
-- Extracted read-only handler: template.actions.resolve_named_command.

local READ_B_ACTIONS = {}

READ_B_ACTIONS.SECTION_IDS = {
  main = 0,
  midi_editor = 32060,
  midi_event_list = 32061,
  crossfade_editor = 32062,
  media_explorer = 32063,
}

function READ_B_ACTIONS.section_name(value)
  if READ_B_ACTIONS.SECTION_IDS[value] ~= nil then
    return value
  end
  return "main"
end

function READ_B_ACTIONS.section_id(value)
  return READ_B_ACTIONS.SECTION_IDS[READ_B_ACTIONS.section_name(value)]
end

function READ_B_ACTIONS.integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

function READ_B_ACTIONS.action_source(named_command, command_id)
  if is_string(named_command) and named_command:sub(1, 1) == "_" then
    return "extension"
  end
  if type(command_id) == "number" and command_id > 0 then
    return "native"
  end
  return "unknown"
end

function READ_B_ACTIONS.lookup_named_command(named_command)
  if not is_string(named_command) then
    return 0
  end
  local ok, command_id = call_reaper("NamedCommandLookup", named_command)
  if ok and type(command_id) == "number" and command_id > 0 then
    return math.floor(command_id)
  end
  return 0
end

function READ_B_ACTIONS.reverse_named_command(command_id)
  local ok, named = call_reaper("ReverseNamedCommandLookup", command_id)
  if ok and type(named) == "string" and named ~= "" then
    return named
  end
  return nil
end

function READ_B_ACTIONS.action_display_name(section_id, command_id)
  local ok, name = call_reaper("kbd_getTextFromCmd", command_id, section_id)
  return bounded_string(ok and first_string(name) or "", 160)
end

function READ_B_ACTIONS.bounded_limit(request, requested, default_limit, hard_limit)
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

function READ_B_ACTIONS.lower_string(value)
  return tostring(value or ""):lower()
end

local function resolve_named_command(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local named_command = bounded_string(request.params.named_command, 160)
  local command_id = READ_B_ACTIONS.lookup_named_command(named_command)
  local resolved = command_id > 0
  return {
    named_command = named_command,
    section = section,
    resolved = resolved,
    command_id = resolved and command_id or nil,
    source = READ_B_ACTIONS.action_source(named_command, command_id),
  }
end
return {
  exports = { resolve_named_command = resolve_named_command },
  shared = { READ_B_ACTIONS = READ_B_ACTIONS },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/read_action_toggle_state.lua
__openreaper_register_handler_module("actions/read_action_toggle_state.lua", function()
local READ_B_ACTIONS = OPENREAPER_HANDLER_SHARED.READ_B_ACTIONS
-- Extracted read-only handler: template.actions.read_action_toggle_state.

local function read_action_toggle_state(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or READ_B_ACTIONS.lookup_named_command(request.params.named_command)
  local ok, state = call_reaper("GetToggleCommandStateEx", section_id, command_id or 0)
  local label = "unknown"
  if ok and type(state) == "number" then
    if state == 1 then
      label = "on"
    elseif state == 0 then
      label = "off"
    elseif state == -1 then
      label = "not_applicable"
    end
  end
  return {
    section = section,
    command_id = command_id,
    state = label,
    available = command_id ~= nil and command_id > 0,
  }
end
return {
  exports = { read_action_toggle_state = read_action_toggle_state },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/read_action_shortcuts.lua
__openreaper_register_handler_module("actions/read_action_shortcuts.lua", function()
local READ_B_ACTIONS = OPENREAPER_HANDLER_SHARED.READ_B_ACTIONS
-- Extracted read-only handler: template.actions.read_action_shortcuts.

local function read_action_shortcuts(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local command_id = READ_B_ACTIONS.integer_value(request.params.command_id) or 0
  local limit = READ_B_ACTIONS.bounded_limit(request, request.params.max_shortcuts, 8, 16)
  local ok_count, count = call_reaper("CountActionShortcuts", section_id, command_id)
  local shortcut_count = ok_count and first_number(count) or 0
  local shortcuts = json_array({})
  for index = 0, math.max(shortcut_count - 1, -1) do
    if #shortcuts >= limit then
      break
    end
    local ok_desc, desc = call_reaper("GetActionShortcutDesc", section_id, command_id, index, "")
    shortcuts[#shortcuts + 1] = {
      index = index,
      description = bounded_string(ok_desc and first_string(desc) or "", 160),
    }
  end
  return {
    section = section,
    command_id = command_id,
    shortcut_count = shortcut_count,
    shortcuts = shortcuts,
    truncated = shortcut_count > #shortcuts,
  }
end
return {
  exports = { read_action_shortcuts = read_action_shortcuts },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/parse_marker_action_text.lua
__openreaper_register_handler_module("actions/parse_marker_action_text.lua", function()
local READ_B_ACTIONS = OPENREAPER_HANDLER_SHARED.READ_B_ACTIONS
-- Extracted read-only handler: template.actions.parse_marker_action_text.

local function parse_marker_action_text(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local resolve_tokens = request.params.resolve_tokens == true
  local text = bounded_string(request.params.text, safe_budget(request).max_inline_value_bytes)
  local tokens = json_array({})
  local unresolved_count = 0

  for token in tostring(text or ""):gmatch("%S+") do
    local marker_token = token:sub(1, 1) == "!"
    local body = marker_token and token:sub(2) or token
    local command_id = tonumber(body)
    local named_command = nil
    local resolved = false
    if marker_token and command_id and command_id > 0 then
      command_id = math.floor(command_id)
      resolved = true
    elseif marker_token and body:sub(1, 1) == "_" then
      named_command = bounded_string(body, 160)
      if resolve_tokens then
        command_id = READ_B_ACTIONS.lookup_named_command(named_command)
        resolved = command_id > 0
      end
    end
    if marker_token and not resolved then
      unresolved_count = unresolved_count + 1
    end
    tokens[#tokens + 1] = {
      raw = bounded_string(token, 160),
      marker_token = marker_token,
      command_id = resolved and command_id or nil,
      named_command = named_command,
      resolved = resolved,
      section = section,
    }
  end

  return {
    is_marker_action = #tokens > 0 and tokens[1].marker_token == true,
    token_count = #tokens,
    tokens = tokens,
    macro_shaped = #tokens > 1,
    unresolved_count = unresolved_count,
  }
end
return {
  exports = { parse_marker_action_text = parse_marker_action_text },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/actions/search_action_commands.lua
__openreaper_register_handler_module("actions/search_action_commands.lua", function()
local READ_B_ACTIONS = OPENREAPER_HANDLER_SHARED.READ_B_ACTIONS
-- Extracted read-only handler: template.actions.search_action_commands.

local ACTION_SEARCH_DEFAULT_LIMIT = 6
local ACTION_SEARCH_MAX_LIMIT = 6
local ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS = 96
local ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS = 80

local function search_action_commands(request)
  local section = READ_B_ACTIONS.section_name(request.params.section)
  local section_id = READ_B_ACTIONS.section_id(section)
  local query = READ_B_ACTIONS.lower_string(request.params.query)
  local limit = READ_B_ACTIONS.bounded_limit(request, request.params.limit, ACTION_SEARCH_DEFAULT_LIMIT, ACTION_SEARCH_MAX_LIMIT)
  local cursor = READ_B_ACTIONS.integer_value(tonumber(request.params.cursor)) or 0
  local items = json_array({})
  local scanned = 0
  local index = cursor
  local truncated = false

  while scanned < 10000 do
    local ok_enum, command_id = call_reaper("kbd_enumerateActions", section_id, index)
    if not ok_enum or type(command_id) ~= "number" or command_id <= 0 then
      break
    end
    scanned = scanned + 1
    local display_name = READ_B_ACTIONS.action_display_name(section_id, command_id)
    local named_command = READ_B_ACTIONS.reverse_named_command(command_id)
    local haystack = READ_B_ACTIONS.lower_string(display_name .. " " .. tostring(named_command or "") .. " " .. tostring(command_id))
    if query == "" or haystack:find(query, 1, true) then
      if #items >= limit then
        truncated = true
        break
      end
      items[#items + 1] = {
        section = section,
        command_id = math.floor(command_id),
        display_name = bounded_string(display_name, ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS),
        named_command = bounded_string(named_command, ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS),
        source = READ_B_ACTIONS.action_source(named_command, command_id),
      }
    end
    index = index + 1
  end

  return {
    section = section,
    items = items,
    next_cursor = truncated and tostring(index) or nil,
    truncated = truncated,
  }
end
return {
  exports = { search_action_commands = search_action_commands },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/resolve_midi_take_ref.lua
__openreaper_register_handler_module("midi/resolve_midi_take_ref.lua", function()
-- Extracted read-only handler: template.midi.resolve_midi_take_ref.

local READ_B_MIDI = {}

function READ_B_MIDI.handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

function READ_B_MIDI.bounded_limit(request, requested, default_limit, hard_limit)
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

function READ_B_MIDI.integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

function READ_B_MIDI.item_guid(item)
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

function READ_B_MIDI.item_ref_string(item)
  local guid = READ_B_MIDI.item_guid(item)
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

function READ_B_MIDI.find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and READ_B_MIDI.item_guid(item) == guid then
      return item
    end
  end
  return nil
end

function READ_B_MIDI.item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

function READ_B_MIDI.take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

function READ_B_MIDI.take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

function READ_B_MIDI.take_ref_string(take)
  local guid = READ_B_MIDI.take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

function READ_B_MIDI.find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

function READ_B_MIDI.find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and READ_B_MIDI.take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

function READ_B_MIDI.resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return READ_B_MIDI.find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return READ_B_MIDI.find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = READ_B_MIDI.find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

function READ_B_MIDI.resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return READ_B_MIDI.resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return READ_B_MIDI.resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return READ_B_MIDI.resolve_take_token("guid:" .. tostring(identity.value))
  end
  return READ_B_MIDI.resolve_take_token(ref.ref)
end

function READ_B_MIDI.take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

function READ_B_MIDI.resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = READ_B_MIDI.resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return READ_B_MIDI.resolve_take_token(request.params.ref)
end

function READ_B_MIDI.resolve_midi_take_for_request(request)
  local take = READ_B_MIDI.resolve_take_for_request(request)
  if not take or not READ_B_MIDI.take_is_midi(take) then
    local _, failure = READ_B_MIDI.handler_error("TAKE_NOT_FOUND", "MIDI take ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
    return nil, failure
  end
  return take
end

function READ_B_MIDI.midi_take_summary(take)
  local item = READ_B_MIDI.take_item(take)
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local count_ok = ok_count and count_retval ~= false
  local start_ppq = 0
  local end_ppq = 0
  if item then
    local start_seconds = READ_B_MIDI.item_number(item, "D_POSITION")
    local end_seconds = start_seconds + READ_B_MIDI.item_number(item, "D_LENGTH")
    local ok_start, ppq_start = call_reaper("MIDI_GetPPQPosFromProjTime", take, start_seconds)
    local ok_end, ppq_end = call_reaper("MIDI_GetPPQPosFromProjTime", take, end_seconds)
    start_ppq = ok_start and first_number(ppq_start) or 0
    end_ppq = ok_end and first_number(ppq_end) or 0
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    item_ref = item and READ_B_MIDI.item_ref_string(item) or JSON_NULL,
    event_count = count_ok and ((first_number(note_count) or 0) + (first_number(cc_count) or 0) + (first_number(text_sysex_count) or 0)) or 0,
    ppq_start = start_ppq,
    ppq_end = end_ppq,
  }
end

local function resolve_midi_take_ref(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  return READ_B_MIDI.midi_take_summary(take)
end
return {
  exports = { resolve_midi_take_ref = resolve_midi_take_ref },
  shared = { READ_B_MIDI = READ_B_MIDI },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/read_take_event_counts.lua
__openreaper_register_handler_module("midi/read_take_event_counts.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted read-only handler: template.midi.read_take_event_counts.

local function read_take_event_counts(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local count_ok = ok_count and count_retval ~= false
  local take_ref = READ_B_MIDI.take_ref_string(take)
  return {
    take_ref = take_ref,
    note_count = count_ok and first_number(note_count) or 0,
    cc_count = count_ok and first_number(cc_count) or 0,
    text_sysex_count = count_ok and first_number(text_sysex_count) or 0,
    take_hash = take_ref .. ":" .. tostring(note_count or 0) .. ":" .. tostring(cc_count or 0) .. ":" .. tostring(text_sysex_count or 0),
  }
end
return {
  exports = { read_take_event_counts = read_take_event_counts },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/list_take_notes.lua
__openreaper_register_handler_module("midi/list_take_notes.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted read-only handler: template.midi.list_take_notes.

local function list_take_notes(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, note_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(note_count) or 0
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local notes = json_array({})
  for index = 0, math.max(total - 1, -1) do
    if #notes >= limit then
      break
    end
    local ok_note, selected, muted, start_ppq, end_ppq, channel, pitch, velocity = call_reaper("MIDI_GetNote", take, index)
    if ok_note and selected ~= nil then
      local note = {
        index = index,
        selected = selected == true,
        muted = muted == true,
        start_ppq = first_number(start_ppq) or 0,
        end_ppq = first_number(end_ppq) or 0,
        channel = first_number(channel) or 0,
        pitch = first_number(pitch) or 0,
        velocity = first_number(velocity) or 0,
      }
      if request.params.include_project_time == true then
        local ok_start, start_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.start_ppq)
        local ok_end, end_time = call_reaper("MIDI_GetProjTimeFromPPQPos", take, note.end_ppq)
        note.start_seconds = ok_start and first_number(start_time) or nil
        note.end_seconds = ok_end and first_number(end_time) or nil
      end
      notes[#notes + 1] = note
    end
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    notes = notes,
    returned_count = #notes,
    next_cursor = total > #notes and tostring(#notes) or nil,
    truncated = total > #notes,
  }
end
return {
  exports = { list_take_notes = list_take_notes },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/list_take_cc_events.lua
__openreaper_register_handler_module("midi/list_take_cc_events.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted read-only handler: template.midi.list_take_cc_events.

local function list_take_cc_events(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, _, cc_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(cc_count) or 0
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local controller = READ_B_MIDI.integer_value(request.params.controller)
  local events = json_array({})
  local matched = 0
  for index = 0, math.max(total - 1, -1) do
    local ok_cc, selected, muted, ppq, chanmsg, channel, msg2, msg3 = call_reaper("MIDI_GetCC", take, index)
    if ok_cc and selected ~= nil then
      local event_controller = first_number(msg2) or 0
      if controller == nil or controller == event_controller then
        matched = matched + 1
        if #events < limit then
          events[#events + 1] = {
            index = index,
            selected = selected == true,
            muted = muted == true,
            ppq = first_number(ppq) or 0,
            channel_message = first_number(chanmsg) or 0,
            channel = first_number(channel) or 0,
            controller = event_controller,
            value = first_number(msg3) or 0,
          }
        end
      end
    end
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    cc_events = events,
    returned_count = #events,
    next_cursor = matched > #events and tostring(#events) or nil,
    truncated = matched > #events,
  }
end
return {
  exports = { list_take_cc_events = list_take_cc_events },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/list_take_text_sysex_events.lua
__openreaper_register_handler_module("midi/list_take_text_sysex_events.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted read-only handler: template.midi.list_take_text_sysex_events.

local function read_b_midi_text_sysex_kind(type_value)
  if type_value == -1 then
    return "sysex"
  elseif type_value == 1 then
    return "text"
  elseif type_value == 5 then
    return "lyric"
  elseif type_value == 15 then
    return "notation"
  end
  return "text"
end

local function list_take_text_sysex_events(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_count, count_retval, _, _, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local total = (ok_count and count_retval ~= false) and first_number(text_sysex_count) or 0
  local limit = READ_B_MIDI.bounded_limit(request, request.params.limit, 16, 100)
  local requested_kind = is_string(request.params.event_kind) and request.params.event_kind or "any"
  local events = json_array({})
  local matched = 0
  for index = 0, math.max(total - 1, -1) do
    local ok_event, selected, muted, ppq, type_value, message = call_reaper("MIDI_GetTextSysexEvt", take, index)
    if ok_event and selected ~= nil then
      local kind = read_b_midi_text_sysex_kind(first_number(type_value) or 1)
      if requested_kind == "any" or requested_kind == kind then
        matched = matched + 1
        if #events < limit then
          events[#events + 1] = {
            index = index,
            selected = selected == true,
            muted = muted == true,
            ppq = first_number(ppq) or 0,
            event_kind = kind,
            text = bounded_string(message, 160),
          }
        end
      end
    end
  end
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    events = events,
    returned_count = #events,
    next_cursor = matched > #events and tostring(#events) or nil,
    truncated = matched > #events,
  }
end
return {
  exports = { list_take_text_sysex_events = list_take_text_sysex_events },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/read_take_grid.lua
__openreaper_register_handler_module("midi/read_take_grid.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted read-only handler: template.midi.read_take_grid.

local function read_take_grid(request)
  local take, failure = READ_B_MIDI.resolve_midi_take_for_request(request)
  if not take then
    return nil, failure
  end
  local ok_grid, grid, swing, note_length = call_reaper("MIDI_GetGrid", take)
  return {
    take_ref = READ_B_MIDI.take_ref_string(take),
    grid_ppq = ok_grid and first_number(grid) or 0,
    swing = ok_grid and first_number(swing) or 0,
    note_length_ppq = ok_grid and first_number(note_length) or 0,
  }
end
return {
  exports = { read_take_grid = read_take_grid },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/media/probe_file.lua
__openreaper_register_handler_module("media/probe_file.lua", function()
-- Extracted read-only handler: template.media.probe_file.

local READ_B_MEDIA = {}

function READ_B_MEDIA.handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

function READ_B_MEDIA.bounded_limit(request, requested, default_limit, hard_limit)
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

function READ_B_MEDIA.source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

function READ_B_MEDIA.source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true or false
end

function READ_B_MEDIA.source_channels(source)
  local ok, channels = call_reaper("GetMediaSourceNumChannels", source)
  return ok and first_number(channels) or 0
end

function READ_B_MEDIA.source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return bounded_string(ok and first_string(filename) or "", 240)
end

function READ_B_MEDIA.source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

function READ_B_MEDIA.metadata_keys_for_source(source, include_metadata_keys)
  local keys = json_array({})
  if include_metadata_keys ~= true then
    return keys
  end
  for _, key in ipairs({ "TITLE", "ARTIST", "ALBUM", "DATE", "BPM" }) do
    local ok_meta, value = call_reaper("GetMediaFileMetadata", source, key, "")
    if ok_meta and type(value) == "string" and value ~= "" then
      keys[#keys + 1] = key
    end
  end
  return keys
end

function READ_B_MEDIA.file_ref_for_path(path_value)
  return "file:path:" .. bounded_string(path_value, 220)
end

function READ_B_MEDIA.item_guid(item)
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

function READ_B_MEDIA.find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and READ_B_MEDIA.item_guid(item) == guid then
      return item
    end
  end
  return nil
end

function READ_B_MEDIA.take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

function READ_B_MEDIA.take_ref_string(take)
  local guid = READ_B_MEDIA.take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

function READ_B_MEDIA.find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

function READ_B_MEDIA.find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and READ_B_MEDIA.take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

function READ_B_MEDIA.resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return READ_B_MEDIA.find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return READ_B_MEDIA.find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = READ_B_MEDIA.find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

function READ_B_MEDIA.resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return READ_B_MEDIA.resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return READ_B_MEDIA.resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return READ_B_MEDIA.resolve_take_token("guid:" .. tostring(identity.value))
  end
  return READ_B_MEDIA.resolve_take_token(ref.ref)
end

function READ_B_MEDIA.resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = READ_B_MEDIA.resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return READ_B_MEDIA.resolve_take_token(request.params.ref)
end

local function probe_media_file(request)
  local path_value = request.params.path
  if not is_string(path_value) then
    return READ_B_MEDIA.handler_error("PARAMS_INVALID", "Media probe requires an absolute file path.", {
      field = "path",
    })
  end
  if not file_exists(path_value) then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file does not exist.", {
      path = bounded_string(path_value, 240),
    })
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Media probe file could not be decoded as a REAPER source.", {
      path = bounded_string(path_value, 240),
    })
  end
  local length, length_is_quarter_notes = READ_B_MEDIA.source_length(source)
  local summary = {
    file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    source_type = READ_B_MEDIA.source_type(source),
    length_seconds = length,
    length_is_quarter_notes = length_is_quarter_notes,
    channel_count = READ_B_MEDIA.source_channels(source),
    metadata_keys = READ_B_MEDIA.metadata_keys_for_source(source, request.params.include_metadata_keys),
    decodable = true,
  }
  call_reaper("PCM_Source_Destroy", source)
  return summary
end
return {
  exports = { probe_media_file = probe_media_file },
  shared = { READ_B_MEDIA = READ_B_MEDIA },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/media/read_take_source.lua
__openreaper_register_handler_module("media/read_take_source.lua", function()
local READ_B_MEDIA = OPENREAPER_HANDLER_SHARED.READ_B_MEDIA
-- Extracted read-only handler: template.media.read_take_source.

local function read_take_source(request)
  local take = READ_B_MEDIA.resolve_take_for_request(request)
  if not take then
    return READ_B_MEDIA.handler_error("TAKE_NOT_FOUND", "Take source read requires a resolvable take ref.", {})
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return READ_B_MEDIA.handler_error("FILE_NOT_FOUND", "Take source could not be read.", {
      take_ref = READ_B_MEDIA.take_ref_string(take),
    })
  end
  local filename = READ_B_MEDIA.source_filename(source)
  local length, _ = READ_B_MEDIA.source_length(source)
  local summary = {
    take_ref = READ_B_MEDIA.take_ref_string(take),
    file_ref = filename ~= "" and READ_B_MEDIA.file_ref_for_path(filename) or JSON_NULL,
    source_type = READ_B_MEDIA.source_type(source),
    filename = filename,
    length_seconds = length,
    channel_count = READ_B_MEDIA.source_channels(source),
    offline = filename ~= "" and not file_exists(filename) or false,
    metadata_keys = READ_B_MEDIA.metadata_keys_for_source(source, request.params.include_metadata_keys),
  }
  if request.params.include_parent_source == true then
    local ok_parent, parent = call_reaper("GetMediaSourceParent", source)
    summary.parent_source_type = ok_parent and parent and READ_B_MEDIA.source_type(parent) or nil
  end
  return summary
end
return {
  exports = { read_take_source = read_take_source },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/media/read_project_media_files.lua
__openreaper_register_handler_module("media/read_project_media_files.lua", function()
local READ_B_MEDIA = OPENREAPER_HANDLER_SHARED.READ_B_MEDIA
-- Extracted read-only handler: template.media.read_project_media_files.

local function read_project_media_files(request)
  local max_sources = READ_B_MEDIA.bounded_limit(request, request.params.max_sources, 25, 100)
  local include_offline = request.params.include_offline == true
  local seen = {}
  local file_refs = json_array({})
  local offline_count = 0
  local source_count = 0
  local truncated = false
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0

  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for take_index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, take_index)
        if ok_take and take then
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if ok_source and source then
            local filename = READ_B_MEDIA.source_filename_raw(source)
            if filename ~= "" and not seen[filename] then
              seen[filename] = true
              local offline = not file_exists(filename)
              if offline then
                offline_count = offline_count + 1
              end
              if include_offline or not offline then
                source_count = source_count + 1
                if #file_refs < max_sources then
                  file_refs[#file_refs + 1] = READ_B_MEDIA.file_ref_for_path(filename)
                else
                  truncated = true
                end
              end
            end
          end
        end
      end
    end
  end

  return {
    source_count = source_count,
    file_refs = file_refs,
    offline_count = offline_count,
    truncated = truncated,
  }
end
return {
  exports = { read_project_media_files = read_project_media_files },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/media/e3_media_route.lua
__openreaper_register_handler_module("media/e3_media_route.lua", function()
local READ_B_MEDIA = OPENREAPER_HANDLER_SHARED.READ_B_MEDIA
-- Extracted E3 media route handlers.

local function e3_media_handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e3_media_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e3_media_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = request.pack.risk == "write" and "required" or "none"
  readback.artifacts_allowed = false
  readback.truncated = readback.truncated == true
  return readback
end

local function e3_media_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e3_media_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e3_media_track_index(track)
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

local function e3_media_track_ref_string(track)
  local guid = e3_media_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e3_media_track_index(track))
end

local function e3_media_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e3_media_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e3_media_resolve_track_token(token)
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
    return e3_media_find_track_by_guid(guid)
  end
  return nil
end

local function e3_media_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e3_media_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e3_media_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e3_media_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e3_media_resolve_track_token(ref.ref)
end

local function e3_media_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e3_media_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e3_media_item_guid(item)
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

local function e3_media_item_ref_string(item)
  local guid = e3_media_item_guid(item)
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

local function e3_media_item_object_ref(item)
  local ref = e3_media_item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function e3_media_take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

local function e3_media_file_path_from_ref(ref)
  if not is_object(ref) or ref.kind ~= "file" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "path" and is_string(identity.value) then
    return identity.value
  end
  if is_string(ref.ref) then
    return ref.ref:match("^file:path:(.+)$")
  end
  return nil
end

local function e3_media_file_path_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local path_value = e3_media_file_path_from_ref(request.refs[index])
      if path_value then
        return path_value
      end
    end
  end
  return nil
end

local function e3_media_kind_for_path(path_value)
  local extension = tostring(path_value or ""):match("%.([^%.%/\\]+)$")
  extension = extension and extension:lower() or ""
  if extension == "wav" or extension == "wave" or extension == "aif" or extension == "aiff" or extension == "flac" or extension == "mp3" or extension == "ogg" or extension == "m4a" then
    return "audio"
  elseif extension == "mid" or extension == "midi" then
    return "midi"
  elseif extension == "mov" or extension == "mp4" or extension == "mkv" then
    return "video"
  end
  return "unknown"
end

local function e3_media_extension_allowed(filename, media_type, extension_filter)
  local extension = filename:match("%.([^%.]+)$")
  extension = extension and extension:lower() or ""
  if is_json_array(extension_filter) and #extension_filter > 0 then
    local matched = false
    for index = 1, #extension_filter do
      local allowed = tostring(extension_filter[index] or ""):lower():gsub("^%.", "")
      if allowed == extension then
        matched = true
      end
    end
    if not matched then
      return false
    end
  end
  if media_type and media_type ~= "any" then
    return e3_media_kind_for_path(filename) == media_type
  end
  return e3_media_kind_for_path(filename) ~= "unknown"
end

local function e3_media_folder_path(folder_ref)
  if not is_string(folder_ref) then
    return nil
  end
  return folder_ref:match("^folder:path:(.+)$")
end

local function list_folder_media_files(request)
  local folder_path = e3_media_folder_path(request.params.folder_ref)
  if not folder_path then
    return e3_media_handler_error("PARAMS_INVALID", "E3 folder media list requires folder:path:<absolute-path>.", {
      folder_ref = bounded_string(request.params.folder_ref, 240),
    })
  end
  if not reaper or type(reaper.EnumerateFiles) ~= "function" then
    return e3_media_handler_error("API_UNAVAILABLE", "REAPER EnumerateFiles API is required for folder media listing.", {})
  end
  local limit = READ_B_MEDIA.bounded_limit(request, request.params.limit, 20, 100)
  local offset = math.max(0, math.floor(e3_media_finite_number(request.params.offset, 0)))
  local media_type = is_string(request.params.media_type) and request.params.media_type or "any"
  local rows = json_array({})
  local file_refs = json_array({})
  local matched = 0
  local index = 0
  while true do
    local filename = reaper.EnumerateFiles(folder_path, index)
    if not filename then
      break
    end
    if e3_media_extension_allowed(filename, media_type, request.params.extension_filter) then
      if matched >= offset and #rows < limit then
        local path_value = folder_path .. "/" .. filename
        rows[#rows + 1] = {
          name = bounded_string(filename, 160),
          file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
          media_type = e3_media_kind_for_path(filename),
        }
        file_refs[#file_refs + 1] = READ_B_MEDIA.file_ref_for_path(path_value)
      end
      matched = matched + 1
    end
    index = index + 1
  end
  return e3_media_summary(request, {
    folder_ref = request.params.folder_ref,
    rows = rows,
    file_refs = file_refs,
    row_count = #rows,
    limit = limit,
    offset = offset,
    total_matching_count = matched,
    truncated = matched > offset + #rows,
  })
end

local function e3_media_create_source(path_value)
  if not is_string(path_value) or not file_exists(path_value) then
    return nil, "FILE_NOT_FOUND", "E3 media source file does not exist."
  end
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return nil, "FILE_NOT_FOUND", "E3 media source could not be decoded by REAPER."
  end
  return source
end

local function e3_media_set_item_source(track, path_value, position, start_percent, end_percent)
  local source, code, message = e3_media_create_source(path_value)
  if not source then
    return nil, e3_media_handler_error(code, message, { path = bounded_string(path_value, 240) })
  end
  local length, is_quarter_notes = READ_B_MEDIA.source_length(source)
  if is_quarter_notes or length <= 0 then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("SOURCE_LENGTH_UNREADABLE", "E3 media source length could not be measured.", {
      path = bounded_string(path_value, 240),
      source_type = e3_media_kind_for_path(path_value),
    })
  end

  local start_offset = 0
  local item_length = length
  if type(start_percent) == "number" or type(end_percent) == "number" then
    local start_value = e3_media_finite_number(start_percent, 0)
    local end_value = e3_media_finite_number(end_percent, 1)
    if start_value < 0 or end_value > 1 or end_value <= start_value then
      call_reaper("PCM_Source_Destroy", source)
      return nil, e3_media_handler_error("PARAMS_INVALID", "E3 media section import requires 0 <= start_percent < end_percent <= 1.", {
        start_percent = start_percent,
        end_percent = end_percent,
      })
    end
    start_offset = length * start_value
    item_length = length * (end_value - start_value)
  end

  local ok_item, item = call_reaper("AddMediaItemToTrack", track)
  if not ok_item or not item then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not create a media item.", {}, false)
  end
  call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", e3_media_finite_number(position, 0))
  call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", item_length)
  local ok_take, take = call_reaper("AddTakeToMediaItem", item)
  if not ok_take or not take then
    call_reaper("PCM_Source_Destroy", source)
    return nil, e3_media_handler_error("COMMAND_FAILED", "E3 media import could not create a take.", {}, false)
  end
  call_reaper("SetMediaItemTake_Source", take, source)
  if start_offset > 0 then
    call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", start_offset)
  end
  call_reaper("UpdateItemInProject", item)
  return item, nil
end

local function e3_media_import_to_track(request, section)
  local track = e3_media_track_from_request_refs(request)
  if not track then
    return e3_media_handler_error("TRACK_NOT_FOUND", "E3 media import requires a resolvable target track ref.", {})
  end
  local path_value = e3_media_file_path_from_request_refs(request)
  if not path_value then
    return e3_media_handler_error("FILE_NOT_FOUND", "E3 media import requires a source file ref.", {})
  end
  local item, failure = e3_media_set_item_source(
    track,
    path_value,
    request.params.position_seconds,
    section and request.params.start_percent or nil,
    section and request.params.end_percent or nil
  )
  if not item then
    return nil, failure
  end
  local item_ref = e3_media_item_object_ref(item)
  local readback = {
    imported_item_refs = json_array({ item_ref.ref }),
    item_count = 1,
    source_file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    track_ref = e3_media_track_ref_string(track),
    position_seconds = e3_media_finite_number(request.params.position_seconds, 0),
    selection_restored = request.params.preserve_selection == true,
  }
  if section then
    readback.start_percent = e3_media_finite_number(request.params.start_percent, 0)
    readback.end_percent = e3_media_finite_number(request.params.end_percent, 1)
  end
  return e3_media_summary(request, readback), nil, nil, nil, e3_media_refs(item_ref, {
    kind = "file",
    ref = READ_B_MEDIA.file_ref_for_path(path_value),
    identity = { scheme = "path", value = path_value },
  })
end

local function import_file_to_track(request)
  return e3_media_import_to_track(request, false)
end

local function import_file_section_to_track(request)
  return e3_media_import_to_track(request, true)
end

local function relink_take_source(request)
  local take = READ_B_MEDIA.resolve_take_for_request(request)
  if not take then
    return e3_media_handler_error("TAKE_NOT_FOUND", "E3 media relink requires a resolvable take ref.", {})
  end
  local path_value = e3_media_file_path_from_request_refs(request)
  if not path_value then
    return e3_media_handler_error("FILE_NOT_FOUND", "E3 media relink requires a source file ref.", {})
  end
  local source, code, message = e3_media_create_source(path_value)
  if not source then
    return e3_media_handler_error(code, message, { path = bounded_string(path_value, 240) })
  end
  if request.params.verify_source_type == true then
    local ok_old_source, old_source = call_reaper("GetMediaItemTake_Source", take)
    local old_type = ok_old_source and old_source and READ_B_MEDIA.source_type(old_source) or ""
    local new_type = READ_B_MEDIA.source_type(source)
    if old_type ~= "" and new_type ~= "" and old_type ~= new_type then
      call_reaper("PCM_Source_Destroy", source)
      return e3_media_handler_error("SOURCE_TYPE_MISMATCH", "E3 media relink source type does not match the current take source.", {
        current_source_type = old_type,
        replacement_source_type = new_type,
      })
    end
  end
  call_reaper("SetMediaItemTake_Source", take, source)
  local item = e3_media_take_item(take)
  if item then
    call_reaper("UpdateItemInProject", item)
  end
  local take_ref = READ_B_MEDIA.take_ref_string(take)
  return e3_media_summary(request, {
    take_ref = take_ref,
    source_file_ref = READ_B_MEDIA.file_ref_for_path(path_value),
    source_type = e3_media_kind_for_path(path_value),
    relinked = true,
  }), nil, nil, nil, e3_media_refs({
    kind = "take",
    ref = take_ref,
    identity = {
      scheme = take_ref:match("^take:([^:]+):") or "index",
      value = take_ref:match("^take:[^:]+:(.+)$") or "0",
    },
  }, {
    kind = "file",
    ref = READ_B_MEDIA.file_ref_for_path(path_value),
    identity = { scheme = "path", value = path_value },
  })
end
return {
  exports = { list_folder_media_files = list_folder_media_files, import_file_to_track = import_file_to_track, import_file_section_to_track = import_file_section_to_track, relink_take_source = relink_take_source },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/e4_item_route.lua
__openreaper_register_handler_module("items/e4_item_route.lua", function()
-- Extracted E4 item route handlers.

local function e4_item_handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function e4_item_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function e4_item_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.loop_source_status = "held"
  readback.truncated = false
  return readback
end

local function e4_item_finite_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function e4_item_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function e4_item_track_index(track)
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

local function e4_item_track_ref_string(track)
  local guid = e4_item_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(e4_item_track_index(track))
end

local function e4_item_find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and e4_item_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function e4_item_resolve_track_token(token)
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
    return e4_item_find_track_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_track_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_track_token(ref.ref)
end

local function e4_item_track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = e4_item_resolve_track_from_ref_object(request.refs[index])
      if track then
        return track
      end
    end
  end
  return nil
end

local function e4_item_guid(item)
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

local function e4_item_ref_string(item)
  local guid = e4_item_guid(item)
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

local function e4_item_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and e4_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function e4_item_resolve_item_token(token)
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
    return e4_item_find_item_by_guid(guid)
  end
  return nil
end

local function e4_item_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return e4_item_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return e4_item_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return e4_item_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return e4_item_resolve_item_token(ref.ref)
end

local function e4_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = e4_item_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function e4_item_object_ref(item)
  local ref = e4_item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function e4_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function e4_item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function e4_item_summary_for_item(item)
  local track = e4_item_track(item)
  return {
    item_ref = e4_item_ref_string(item),
    track_ref = track and e4_item_track_ref_string(track) or JSON_NULL,
    position_seconds = e4_item_number(item, "D_POSITION"),
    length_seconds = e4_item_number(item, "D_LENGTH"),
  }
end

local function e4_item_take(item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  return ok_take and take or nil
end

local function e4_item_read_source(take)
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  return ok_source and source or nil
end

local function e4_item_clone_active_take_footprint(source_item, target_item)
  local source_take = e4_item_take(source_item)
  if not source_take then
    return nil, e4_item_handler_error("TAKE_NOT_FOUND", "E4 copy_item_to_track requires an active source take.", {})
  end
  local source = e4_item_read_source(source_take)
  if not source then
    return nil, e4_item_handler_error("SOURCE_NOT_FOUND", "E4 copy_item_to_track could not read the source take media source.", {})
  end
  local ok_duplicate, duplicate = call_reaper("PCM_Source_Duplicate", source)
  if not ok_duplicate or not duplicate then
    return nil, e4_item_handler_error("SOURCE_NOT_FOUND", "E4 copy_item_to_track could not duplicate the source media footprint.", {})
  end
  local ok_take, target_take = call_reaper("AddTakeToMediaItem", target_item)
  if not ok_take or not target_take then
    call_reaper("PCM_Source_Destroy", duplicate)
    return nil, e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target take.", {}, false)
  end
  call_reaper("SetMediaItemTake_Source", target_take, duplicate)
  local ok_start, start_offset = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_STARTOFFS")
  local ok_playrate, playrate = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PLAYRATE")
  local ok_pitch, pitch = call_reaper("GetMediaItemTakeInfo_Value", source_take, "D_PITCH")
  local ok_preserve, preserve = call_reaper("GetMediaItemTakeInfo_Value", source_take, "B_PPITCH")
  if ok_start then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_STARTOFFS", first_number(start_offset) or 0)
  end
  if ok_playrate then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_PLAYRATE", first_number(playrate) or 1)
  end
  if ok_pitch then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "D_PITCH", first_number(pitch) or 0)
  end
  if ok_preserve then
    call_reaper("SetMediaItemTakeInfo_Value", target_take, "B_PPITCH", first_number(preserve) or 0)
  end
  return target_take
end

local function copy_item_to_track(request)
  local source_item = e4_item_from_request_refs(request)
  if not source_item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 copy_item_to_track requires a resolvable source item ref.", {})
  end
  local target_track = e4_item_track_from_request_refs(request)
  if not target_track then
    return e4_item_handler_error("TRACK_NOT_FOUND", "E4 copy_item_to_track requires a resolvable target track ref.", {})
  end
  local ok_item, new_item = call_reaper("AddMediaItemToTrack", target_track)
  if not ok_item or not new_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 copy_item_to_track could not create a target item.", {}, false)
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local length = math.max(0, e4_item_number(source_item, "D_LENGTH"))
  call_reaper("SetMediaItemInfo_Value", new_item, "D_POSITION", position)
  call_reaper("SetMediaItemInfo_Value", new_item, "D_LENGTH", length)
  local _, failure = e4_item_clone_active_take_footprint(source_item, new_item)
  if failure then
    call_reaper("DeleteTrackMediaItem", target_track, new_item)
    return nil, failure
  end
  call_reaper("UpdateItemInProject", new_item)
  local source_ref = e4_item_object_ref(source_item)
  local new_ref = e4_item_object_ref(new_item)
  return e4_item_summary(request, {
    new_item_ref = new_ref.ref,
    source_item_ref = source_ref.ref,
    target_track_ref = e4_item_track_ref_string(target_track),
    position_seconds = position,
    copy_depth = "active_take_footprint",
    source_item = e4_item_summary_for_item(source_item),
    new_item = e4_item_summary_for_item(new_item),
  }), nil, nil, nil, e4_item_refs(new_ref, source_ref, {
    kind = "track",
    ref = e4_item_track_ref_string(target_track),
    identity = {
      scheme = e4_item_track_ref_string(target_track):match("^track:([^:]+):") or "index",
      value = e4_item_track_ref_string(target_track):match("^track:[^:]+:(.+)$") or "0",
    },
  })
end

local function split_item_at_time(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 split_item_at_time requires a resolvable item ref.", {})
  end
  local position = e4_item_finite_number(request.params.position_seconds, 0)
  local start_position = e4_item_number(item, "D_POSITION")
  local length = e4_item_number(item, "D_LENGTH")
  local end_position = start_position + length
  if not (position > start_position and position < end_position) then
    return e4_item_handler_error("SPLIT_OUTSIDE_ITEM_BOUNDS", "E4 split_item_at_time requires a position inside item bounds.", {
      position_seconds = position,
      item_start_seconds = start_position,
      item_end_seconds = end_position,
    })
  end
  local ok_right, right_item = call_reaper("SplitMediaItem", item, position)
  if not ok_right or not right_item then
    return e4_item_handler_error("COMMAND_FAILED", "E4 split_item_at_time could not split the item.", {}, false)
  end
  call_reaper("UpdateItemInProject", item)
  call_reaper("UpdateItemInProject", right_item)
  local left_ref = e4_item_object_ref(item)
  local right_ref = e4_item_object_ref(right_item)
  return e4_item_summary(request, {
    left_item_ref = left_ref.ref,
    right_item_ref = right_ref.ref,
    split_position_seconds = position,
    left_item = e4_item_summary_for_item(item),
    right_item = e4_item_summary_for_item(right_item),
  }), nil, nil, nil, e4_item_refs(left_ref, right_ref)
end

local function set_take_playrate(request)
  local item = e4_item_from_request_refs(request)
  if not item then
    return e4_item_handler_error("ITEM_NOT_FOUND", "E4 set_take_playrate requires a resolvable item ref.", {})
  end
  local playrate = e4_item_finite_number(request.params.playrate, 1)
  if playrate <= 0 then
    return e4_item_handler_error("PARAMS_INVALID", "E4 set_take_playrate requires playrate > 0.", {
      playrate = request.params.playrate,
    })
  end
  local take = e4_item_take(item)
  if not take then
    return e4_item_handler_error("TAKE_NOT_FOUND", "E4 set_take_playrate requires an active take.", {})
  end
  call_reaper("SetMediaItemTakeInfo_Value", take, "D_PLAYRATE", playrate)
  call_reaper("SetMediaItemTakeInfo_Value", take, "B_PPITCH", request.params.preserve_pitch == true and 1 or 0)
  call_reaper("UpdateItemInProject", item)
  local item_ref = e4_item_object_ref(item)
  return e4_item_summary(request, {
    item_ref = item_ref.ref,
    playrate = playrate,
    preserve_pitch = request.params.preserve_pitch == true,
    item = e4_item_summary_for_item(item),
  }), nil, nil, nil, e4_item_refs(item_ref)
end
return {
  exports = { copy_item_to_track = copy_item_to_track, split_item_at_time = split_item_at_time, set_take_playrate = set_take_playrate },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/analysis/detect_loop_candidates.lua
__openreaper_register_handler_module("analysis/detect_loop_candidates.lua", function()
local function read_item_summary(...)
  return OPENREAPER_HANDLER_EXPORTS.read_item_summary(...)
end
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
return {
  exports = { detect_loop_candidates = detect_loop_candidates },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/analysis/measure_loop_click_risk.lua
__openreaper_register_handler_module("analysis/measure_loop_click_risk.lua", function()
local function read_item_summary(...)
  return OPENREAPER_HANDLER_EXPORTS.read_item_summary(...)
end
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
return {
  exports = { measure_loop_click_risk = measure_loop_click_risk },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/analysis/create_loop_qa_report.lua
__openreaper_register_handler_module("analysis/create_loop_qa_report.lua", function()
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
return {
  exports = { create_loop_qa_report = create_loop_qa_report },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/create_cleanup_report.lua
__openreaper_register_handler_module("project/create_cleanup_report.lua", function()
local function list_markers_regions(...)
  return OPENREAPER_HANDLER_EXPORTS.list_markers_regions(...)
end
local function read_project_metadata(...)
  return OPENREAPER_HANDLER_EXPORTS.read_project_metadata(...)
end
local function read_project_summary(...)
  return OPENREAPER_HANDLER_EXPORTS.read_project_summary(...)
end
local function read_tempo_map(...)
  return OPENREAPER_HANDLER_EXPORTS.read_tempo_map(...)
end
-- Extracted First-Real-Fixture-A A1 handler: template.project.create_cleanup_report.

local function create_cleanup_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_cleanup_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_cleanup_report(request)
  local spec = A1_ARTIFACT_SPECS["run_job:project.create_cleanup_report"]
  local project_summary = read_project_summary({
    params = { include_counts = true },
    budget = request.budget,
  })
  local markers = list_markers_regions({
    params = {
      include_markers = request.params.include_markers ~= false,
      include_regions = request.params.include_regions ~= false,
      limit = request.params.marker_region_limit,
    },
    budget = request.budget,
  })
  local tempo = read_tempo_map({
    params = {
      limit = request.params.tempo_marker_limit,
      effective_at_seconds = json_array({ 0 }),
    },
    budget = request.budget,
  })
  local metadata = read_project_metadata({
    params = { fields = json_array({ "title", "author", "notes" }) },
    budget = request.budget,
  })
  local metadata_field_count = 0
  for _, field in ipairs({ "title", "author", "notes" }) do
    if metadata[field] ~= nil then
      metadata_field_count = metadata_field_count + 1
    end
  end
  local evidence_family_count = 4
  local report_row_count = math.min(create_cleanup_report_bounded_limit(request, request.params.max_report_rows, 8, 64), evidence_family_count)
  local project_fingerprint = "tracks:" .. tostring(project_summary.track_count or 0)
    .. "|items:" .. tostring(project_summary.item_count or 0)
    .. "|markers:" .. tostring(project_summary.marker_count or 0)
    .. "|regions:" .. tostring(project_summary.region_count or 0)
  local summary = {
    evidence_family_count = evidence_family_count,
    report_row_count = report_row_count,
    marker_count = markers.marker_count or 0,
    region_count = markers.region_count or 0,
    metadata_field_count = metadata_field_count,
    tempo_marker_count = tempo and #tempo.tempo_markers or 0,
    project_fingerprint = project_fingerprint,
    truncated = markers.truncated == true or tempo.truncated == true,
  }
  local payload = {
    smoke_only = true,
    cleanup_policy_claim = false,
    project_summary = project_summary,
    markers_regions = markers,
    tempo = tempo,
    metadata = metadata,
    rows = json_array({
      { row = 1, family = "project_summary" },
      { row = 2, family = "markers_regions" },
      { row = 3, family = "tempo" },
      { row = 4, family = "metadata" },
    }),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return create_cleanup_report_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
return {
  exports = { create_cleanup_report = create_cleanup_report },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/render/render_region_wav.lua
__openreaper_register_handler_module("render/render_region_wav.lua", function()
-- Extracted First-Real-Fixture-A A2 handler: template.render.render_region_wav.

local function render_region_wav_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function render_region_wav_current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function render_region_wav_item_guid(item)
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

local function render_region_wav_item_ref_string(item)
  local guid = render_region_wav_item_guid(item)
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

local function render_region_wav_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function render_region_wav_take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function render_region_wav_take_ref_string(take)
  local guid = render_region_wav_take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

local function render_region_wav_take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

local function render_region_wav_source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

local function render_region_wav_source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true
end

local function render_region_wav_source_length_with_file_fallback(source, filename)
  local length, length_is_quarter_notes = render_region_wav_source_length(source)
  if length > 0 and not length_is_quarter_notes then
    return length, "take_source"
  end
  if length_is_quarter_notes then
    return 0, "quarter_notes"
  end
  if filename ~= "" and file_exists(filename) then
    local ok_file_source, file_source = call_reaper("PCM_Source_CreateFromFile", filename)
    if ok_file_source and file_source then
      local fallback_length, fallback_length_is_quarter_notes = render_region_wav_source_length(file_source)
      call_reaper("PCM_Source_Destroy", file_source)
      if fallback_length > 0 and not fallback_length_is_quarter_notes then
        return fallback_length, "pcm_source_create_from_file"
      end
      if fallback_length_is_quarter_notes then
        return 0, "quarter_notes"
      end
    end
  end
  return 0, "unreadable"
end

local function render_region_wav_source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function render_region_wav_root_ready()
  if not RENDER_ROOT then
    return false, "render_root_not_configured", "First-Real-Fixture-A A2 render root is not configured."
  end
  if RENDER_ROOT:sub(1, 7) == "file://" or not is_absolute_path(RENDER_ROOT) then
    return false, "render_root_invalid", "First-Real-Fixture-A A2 render root must be an absolute filesystem path."
  end
  return true
end

local function render_region_wav_safe_filename_suffix(value)
  local text = tostring(value or ""):gsub("^template:", ""):gsub("[^A-Za-z0-9_%-]", "_")
  if text == "" then
    text = "unknown"
  end
  if #text > 48 then
    text = text:sub(1, 48)
  end
  return text
end

local function managed_render_output(request)
  local suffix = render_region_wav_safe_filename_suffix(request.idempotency_key or request.id)
  local basename = "openreaper_a2_" .. suffix .. ".wav"
  return {
    basename = basename,
    relative_path = basename,
    path = path_join(RENDER_ROOT or "", basename),
  }
end

local function render_region_wav_file_size(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return nil
  end
  local size = handle:seek("end")
  handle:close()
  return size
end

local function render_region_wav_header_ok(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return false
  end
  local header = handle:read(12) or ""
  handle:close()
  return header:sub(1, 4) == "RIFF" and header:sub(9, 12) == "WAVE"
end

local function render_region_wav_parse_region_ref_token(token)
  if not is_string(token) then
    return nil
  end
  local index = token:match("^region:index:(%d+)$") or token:match("^index:(%d+)$")
  if index then
    return { scheme = "index", value = tonumber(index) }
  end
  local name = token:match("^region:name:(.+)$") or token:match("^name:(.+)$")
  if name and name ~= "" then
    return { scheme = "name", value = name }
  end
  local guid = token:match("^region:guid:(.+)$") or token:match("^guid:(.+)$")
  if guid and guid ~= "" then
    return { scheme = "guid", value = guid }
  end
  return nil
end

local function render_region_wav_region_token_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "region" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "index" or identity.scheme == "name" or identity.scheme == "guid" then
    return {
      scheme = identity.scheme,
      value = identity.scheme == "index" and tonumber(identity.value) or tostring(identity.value),
    }
  end
  return render_region_wav_parse_region_ref_token(ref.ref)
end

local function render_region_wav_region_token_from_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local token = render_region_wav_region_token_from_ref_object(request.refs[index])
      if token then
        return token
      end
    end
  end
  return nil
end

local function render_region_wav_resolve_region_for_render(request)
  local token = render_region_wav_region_token_from_request(request)
  if not token then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render_region_wav requires a resolvable region ref.",
      details = {
        blocker = "region_ref_missing",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  if token.scheme == "guid" then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render_region_wav currently supports region:index and region:name refs.",
      details = {
        blocker = "region_guid_ref_not_supported",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end

  local project = render_region_wav_current_project()
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = (ok_count and first_number(marker_count) or 0) + (ok_count and first_number(region_count) or 0)
  local match = nil
  local matches = 0
  local region_ordinal = 0
  for enum_index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, index_number = call_reaper("EnumProjectMarkers3", project, enum_index)
    if ok_enum and retval and is_region == true then
      local index_matches = token.scheme == "index"
        and (token.value == region_ordinal or token.value == first_number(index_number))
      local name_matches = token.scheme == "name" and tostring(name or "") == token.value
      if index_matches or name_matches then
        matches = matches + 1
        match = {
          region_ref = "region:index:" .. tostring(index_number or region_ordinal),
          name = bounded_string(name or "", 160),
          index = index_number or region_ordinal,
          start_seconds = first_number(pos) or 0,
          end_seconds = first_number(region_end) or 0,
        }
        if match.name ~= "" then
          match.preferred_region_ref = "region:name:" .. match.name
        end
      end
      region_ordinal = region_ordinal + 1
    end
  end
  if matches > 1 then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render region name is ambiguous.",
      details = {
        blocker = "region_ref_ambiguous",
        region_name = token.scheme == "name" and bounded_string(token.value, 160) or nil,
        match_count = matches,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        fallback_region_ref_scheme = "region:index:<zero-based-region-index>",
      },
    }
  end
  if not match then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region ref could not be resolved.",
      details = {
        blocker = "region_ref_not_found",
        requested_region_ref_scheme = token.scheme,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  match.duration_seconds = match.end_seconds - match.start_seconds
  if match.duration_seconds <= 0 or match.duration_seconds > 120 then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region bounds are empty or outside the bounded route limit.",
      details = {
        blocker = "region_bounds_invalid",
        region_ref = match.region_ref,
        preferred_region_ref = match.preferred_region_ref,
        region_start_seconds = match.start_seconds,
        region_end_seconds = match.end_seconds,
        duration_seconds = match.duration_seconds,
      },
    }
  end
  return match
end

local RENDER_REGION_WAV_UNSUPPORTED_SOURCE_TYPES = {
  MIDI = true,
  RPP_PROJECT = true,
  EMPTY = true,
  VIDEO = true,
}

local function render_region_wav_region_details(region)
  return {
    region_ref = region and region.region_ref or nil,
    preferred_region_ref = region and region.preferred_region_ref or nil,
    region_name = region and region.name or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  }
end

local function render_region_wav_merge_details(...)
  local merged = {}
  for index = 1, select("#", ...) do
    local source = select(index, ...)
    if is_object(source) then
      for key, value in pairs(source) do
        merged[key] = value
      end
    end
  end
  return merged
end

local function render_region_wav_source_details(region, item_facts, take_facts, source_facts)
  return render_region_wav_merge_details(render_region_wav_region_details(region), {
    item_ref = item_facts and item_facts.item_ref or nil,
    take_ref = take_facts and take_facts.take_ref or nil,
    source_type = source_facts and source_facts.source_type or nil,
    source_filename_present = source_facts and source_facts.source_filename_present == true or false,
    source_file_exists = source_facts and source_facts.source_file_exists == true or false,
    item_start_seconds = item_facts and item_facts.item_start_seconds or nil,
    item_end_seconds = item_facts and item_facts.item_end_seconds or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  })
end

local function render_region_wav_take_facts(take)
  if not take then
    return nil
  end
  return {
    take_ref = render_region_wav_take_ref_string(take),
  }
end

local function render_region_wav_source_facts(source)
  local filename = render_region_wav_source_filename_raw(source)
  return {
    source_type = render_region_wav_source_type(source),
    source_filename = filename,
    source_filename_present = filename ~= "",
    source_file_exists = filename ~= "" and file_exists(filename) or false,
  }
end

local function render_region_wav_active_audio_take_for_region(region)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local saw_overlap = false
  local first_failure = nil
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local item_start = render_region_wav_item_number(item, "D_POSITION")
      local item_end = item_start + render_region_wav_item_number(item, "D_LENGTH")
      local overlaps = item_end > region.start_seconds and item_start < region.end_seconds
      if overlaps then
        saw_overlap = true
        local item_facts = {
          item_ref = render_region_wav_item_ref_string(item),
          item_start_seconds = item_start,
          item_end_seconds = item_end,
        }
        local ok_take, take = call_reaper("GetActiveTake", item)
        if not ok_take or not take then
          first_failure = first_failure or {
            code = "TAKE_NOT_FOUND",
            message = "A2 render_region_wav found an overlapping item without an active take source.",
            details = render_region_wav_merge_details(render_region_wav_region_details(region), item_facts, {
              blocker = "take_source_missing",
            }),
          }
        elseif render_region_wav_take_is_midi(take) then
          local take_facts = render_region_wav_take_facts(take)
          first_failure = first_failure or {
            code = "PARAMS_INVALID",
            message = "A2 render_region_wav requires an audio take; the overlapping take is MIDI.",
            details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, {
              source_type = "MIDI",
              source_filename_present = false,
              source_file_exists = false,
            }), {
              blocker = "source_type_unsupported",
            }),
          }
        else
          local take_facts = render_region_wav_take_facts(take)
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if not ok_source or not source then
            first_failure = first_failure or {
              code = "TAKE_NOT_FOUND",
              message = "A2 render_region_wav could not read the active take source.",
              details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, nil), {
                blocker = "take_source_missing",
              }),
            }
          else
            local source_facts = render_region_wav_source_facts(source)
            if RENDER_REGION_WAV_UNSUPPORTED_SOURCE_TYPES[source_facts.source_type] then
              first_failure = first_failure or {
                code = "PARAMS_INVALID",
                message = "A2 render_region_wav does not support this take source type.",
                details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_type_unsupported",
                }),
              }
            elseif not source_facts.source_filename_present or not source_facts.source_file_exists then
              first_failure = first_failure or {
                code = "FILE_NOT_FOUND",
                message = "A2 render_region_wav source file is missing or offline.",
                details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_file_missing_or_offline",
                }),
              }
            else
              local source_len, source_length_method = render_region_wav_source_length_with_file_fallback(source, source_facts.source_filename)
              if source_length_method == "quarter_notes" then
                first_failure = first_failure or {
                  code = "PARAMS_INVALID",
                  message = "A2 render_region_wav does not support quarter-note based source length.",
                  details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_type_unsupported",
                    source_length_method = source_length_method,
                  }),
                }
              elseif not source_len or source_len <= 0 then
                first_failure = first_failure or {
                  code = "FILE_NOT_FOUND",
                  message = "A2 render_region_wav source length could not be measured from the take or file-backed fallback.",
                  details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_length_unreadable",
                    source_length_method = source_length_method,
                  }),
                }
              else
                local take_offset = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS"))) or 0
                local playrate = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE"))) or 1
                local overlap_start = math.max(region.start_seconds, item_start)
                local overlap_end = math.min(region.end_seconds, item_end)
                local source_start = take_offset + ((overlap_start - item_start) * playrate)
                local source_end = take_offset + ((overlap_end - item_start) * playrate)
                local clamped_source_start = math.max(0, math.min(source_len, source_start))
                local clamped_source_end = math.max(0, math.min(source_len, source_end))
                if playrate <= 0 or clamped_source_end <= clamped_source_start then
                  first_failure = first_failure or {
                    code = "REGION_NOT_FOUND",
                    message = "A2 render region does not overlap a renderable source range.",
                    details = render_region_wav_merge_details(render_region_wav_source_details(region, item_facts, take_facts, source_facts), {
                      blocker = "source_range_overlap_invalid",
                      source_length_seconds = source_len,
                      source_length_method = source_length_method,
                      source_start_seconds = source_start,
                      source_end_seconds = source_end,
                      playrate = playrate,
                    }),
                  }
                else
                  return {
                    item_ref = item_facts.item_ref,
                    take_ref = take_facts.take_ref,
                    source_type = source_facts.source_type,
                    source_filename = source_facts.source_filename,
                    source_filename_present = source_facts.source_filename_present,
                    source_file_exists = source_facts.source_file_exists,
                    source_length_seconds = source_len,
                    source_length_method = source_length_method,
                    source_start_seconds = clamped_source_start,
                    source_end_seconds = clamped_source_end,
                    item_start_seconds = item_start,
                    item_end_seconds = item_end,
                    playrate = playrate,
                  }
                end
              end
            end
          end
        end
      end
    end
  end
  if first_failure then
    return nil, first_failure
  end
  if saw_overlap then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "A2 render_region_wav found overlapping items but no renderable audio take.",
      details = render_region_wav_merge_details(render_region_wav_region_details(region), {
        blocker = "no_overlapping_audio_item",
      }),
    }
  end
  return nil, {
    code = "ITEM_NOT_FOUND",
    message = "A2 render_region_wav requires an audio item overlapping the resolved region.",
    details = render_region_wav_merge_details(render_region_wav_region_details(region), {
      blocker = "no_overlapping_audio_item",
    }),
  }
end

local function render_region_wav_job_object_ref(job_id)
  return {
    kind = "job",
    ref = "job:job_id:" .. job_id,
    identity = {
      scheme = "job_id",
      value = job_id,
    },
    summary = {
      template_id = "template.render.render_region_wav",
      pack = "render",
    },
  }
end

local function render_region_wav(request)
  local root_ok, blocker, root_message = render_region_wav_root_ready()
  if not root_ok then
    return render_region_wav_error("FILE_NOT_FOUND", root_message, {
      blocker = blocker,
      render_root_env = RENDER_ROOT_ENV,
    })
  end
  if request.params.output_policy ~= "openreaper_managed_render_root" then
    return render_region_wav_error("PARAMS_INVALID", "A2 render_region_wav requires managed render root output policy.", {
      field = "output_policy",
    })
  end
  if request.params.collision_policy ~= "fail_if_exists" then
    return render_region_wav_error("IDEMPOTENCY_CONFLICT", "A2 render_region_wav supports only first-pass fail_if_exists in this route.", {
      blocker = "reuse_idempotent_match_not_enabled",
      collision_policy = bounded_string(request.params.collision_policy, 80),
    }, false)
  end

  local region, region_failure = render_region_wav_resolve_region_for_render(request)
  if not region then
    return nil, region_failure
  end
  local source, source_failure = render_region_wav_active_audio_take_for_region(region)
  if not source then
    return nil, source_failure
  end

  local output = managed_render_output(request)
  if file_exists(output.path) then
    return render_region_wav_error("IDEMPOTENCY_CONFLICT", "A2 managed render output already exists and fail_if_exists forbids overwrite.", {
      blocker = "render_output_exists",
      output_basename = output.basename,
    }, false)
  end

  local start_percent = math.max(0, math.min(1, source.source_start_seconds / source.source_length_seconds))
  local end_percent = math.max(0, math.min(1, source.source_end_seconds / source.source_length_seconds))
  if end_percent <= start_percent then
    return render_region_wav_error("REGION_NOT_FOUND", "A2 render region does not overlap a renderable source range.", {
      blocker = "source_range_overlap_invalid",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
      source_length_seconds = source.source_length_seconds,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    })
  end

  local render_ok, render_success = call_reaper(
    "RenderFileSection",
    source.source_filename,
    output.path,
    start_percent,
    end_percent,
    source.playrate
  )
  if not render_ok or render_success == false then
    return render_region_wav_error("COMMAND_FAILED", "A2 render_region_wav could not render the source section through REAPER.", {
      blocker = "render_file_section_failed",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
    }, false)
  end

  local size = render_region_wav_file_size(output.path) or 0
  local wav_ok = render_region_wav_header_ok(output.path)
  if size <= 0 or not wav_ok then
    return render_region_wav_error("VERIFY_FAILED", "A2 render_region_wav output file failed WAV/non-empty verification.", {
      blocker = "wav_output_invalid",
      output_basename = output.basename,
      file_size_bytes = size,
      wav_header = wav_ok,
    }, false)
  end

  local output_summary = {
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    wav_header = wav_ok,
    file_count = 1,
    reused_existing = false,
    truncated = false,
  }
  local output_write, output_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.region_wav_output, output_summary, {
    smoke_only = false,
    output = output_summary,
    region = region,
    source = {
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      source_length_seconds = source.source_length_seconds,
      source_length_method = source.source_length_method,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    },
  })
  if not output_write then
    return render_region_wav_error(output_failure.code, output_failure.message, output_failure.details, output_failure.recoverable)
  end

  local artifact_id = artifact_id_from_request(request)
  local job_id = "render.region_wav." .. tostring(artifact_id or request.id)
  local job_ref = render_region_wav_job_object_ref(job_id)
  local evidence_summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    region_ref = region.region_ref,
    collision_policy = request.params.collision_policy,
    verification_status = "passed",
    truncated = false,
  }
  local evidence_write, evidence_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.render_job_evidence, evidence_summary, {
    smoke_only = false,
    output_artifact_ref = output_write.ref,
    region = region,
    output = output_summary,
    render_request = {
      format = request.params.format,
      output_policy = request.params.output_policy,
      collision_policy = request.params.collision_policy,
      sample_rate_hz = request.params.sample_rate_hz,
      bit_depth = request.params.bit_depth,
      channel_count = request.params.channel_count,
    },
  })
  if not evidence_write then
    return render_region_wav_error(evidence_failure.code, evidence_failure.message, evidence_failure.details, evidence_failure.recoverable)
  end

  local summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    evidence_artifact_ref = evidence_write.ref,
    format = "wav",
    output_policy = request.params.output_policy,
    collision_policy = request.params.collision_policy,
    file_count = 1,
    reused_existing = false,
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    truncated = false,
  }
  return summary, nil, json_array({ output_write.object_ref, evidence_write.object_ref }), json_array({ job_ref })
end
return {
  exports = { render_region_wav = render_region_wav },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/render/create_delivery_report.lua
__openreaper_register_handler_module("render/create_delivery_report.lua", function()
local function render_region_wav(...)
  return OPENREAPER_HANDLER_EXPORTS.render_region_wav(...)
end
-- Extracted First-Real-Fixture-A A2 handler: template.render.create_delivery_report.

local function create_delivery_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_delivery_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_delivery_report_bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function create_delivery_report_artifact_ref_from_request_refs(request, expected)
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

local function create_delivery_report_read_a2_artifact(ref, spec, expected_producer)
  local envelope, failure = read_artifact_envelope(ref, spec)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.id ~= expected_producer
    or envelope.producer.pack ~= "render" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 input artifact envelope does not match the expected render producer.",
      details = {
        blocker = "render_evidence_producer_mismatch",
        expected_producer = expected_producer,
      },
    }
  end
  return envelope
end

local function create_delivery_report(request)
  local output_ref = create_delivery_report_artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.region_wav_output)
  local evidence_ref = create_delivery_report_artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.render_job_evidence)
  if not output_ref or not evidence_ref then
    return create_delivery_report_error("ARTIFACT_NOT_FOUND", "A2 delivery report requires render output and render job evidence artifact refs.", {
      blocker = "render_evidence_refs_missing",
    })
  end

  local output_envelope, output_failure = create_delivery_report_read_a2_artifact(output_ref, A2_ARTIFACT_SPECS.region_wav_output, "template.render.render_region_wav")
  if not output_envelope then
    return create_delivery_report_error(output_failure.code, output_failure.message, output_failure.details)
  end
  local evidence_envelope, evidence_failure = create_delivery_report_read_a2_artifact(evidence_ref, A2_ARTIFACT_SPECS.render_job_evidence, "template.render.render_region_wav")
  if not evidence_envelope then
    return create_delivery_report_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end
  local evidence_summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  local evidence_payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local evidence_output_ref = evidence_summary.output_artifact_ref or evidence_payload.output_artifact_ref
  if evidence_output_ref ~= output_ref then
    return create_delivery_report_error("ARTIFACT_INVALID", "A2 render job evidence does not reference the requested output artifact.", {
      blocker = "render_evidence_output_mismatch",
    })
  end

  local file_size_value = is_object(output_envelope.summary) and create_delivery_report_bounded_number(output_envelope.summary.file_size_bytes, 0) or 0
  local nonempty_output_count = file_size_value > 0 and 1 or 0
  local issue_count = nonempty_output_count == 1 and 0 or 1
  local report_row_count = math.min(create_delivery_report_bounded_limit(request, request.params.max_report_rows, 1, 12), 1)
  local summary = {
    output_artifact_count = 1,
    job_evidence_count = 1,
    region_count = 1,
    nonempty_output_count = nonempty_output_count,
    report_row_count = report_row_count,
    issue_count = issue_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    consumed_artifact_refs = json_array({ output_ref, evidence_ref }),
    rows = json_array({
      {
        row = 1,
        output_basename = is_object(output_envelope.summary) and output_envelope.summary.output_basename or JSON_NULL,
        file_size_bytes = file_size_value,
        issue_count = issue_count,
      },
    }),
  }
  local write, failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.delivery_report, summary, payload)
  if not write then
    return create_delivery_report_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
return {
  exports = { create_delivery_report = create_delivery_report },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/create_layer_report.lua
__openreaper_register_handler_module("items/create_layer_report.lua", function()
-- Extracted First-Real-Fixture-A A3 handler: template.items.create_layer_report.

local function create_layer_report_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function create_layer_report_bounded_limit(request, requested, default_limit, hard_limit)
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

local function create_layer_report_artifact_ref_from_request_refs(request, expected)
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

local function create_layer_report_read_evidence_artifact(ref)
  local root_ok, blocker, root_message = a3_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end
  local envelope, failure = read_artifact_envelope(ref, A3_ARTIFACT_SPECS.layer_evidence)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.pack ~= "items" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 layer evidence artifact envelope does not match the expected items template producer.",
      details = {
        blocker = "layer_evidence_producer_mismatch",
      },
    }
  end
  return envelope
end

local function create_layer_report_count_from_summary_or_payload(envelope, summary_key, payload_key)
  local summary = is_object(envelope.summary) and envelope.summary or {}
  if type(summary[summary_key]) == "number" and summary[summary_key] >= 0 then
    return math.floor(summary[summary_key])
  end
  local payload = is_object(envelope.payload) and envelope.payload or {}
  local payload_value = payload[payload_key]
  if is_json_array(payload_value) then
    return #payload_value
  end
  return 0
end

local function create_layer_report_rows(evidence_envelope, row_count)
  local payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local items = is_json_array(payload.items) and payload.items or json_array({})
  local rows = json_array({})
  for index = 1, row_count do
    local item = is_object(items[index]) and items[index] or {}
    rows[#rows + 1] = {
      row = index,
      item_ref = bounded_string(item.item_ref or item.ref, 120) or JSON_NULL,
      track_ref = bounded_string(item.track_ref, 120) or JSON_NULL,
      name = bounded_string(item.name, 120) or JSON_NULL,
      color = bounded_string(item.color, 80) or JSON_NULL,
    }
  end
  return rows
end

local function create_layer_report_compact_evidence_summary(evidence_envelope)
  local summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  return {
    schema = summary.schema or evidence_envelope.schema,
    item_count = summary.item_count or 0,
    track_count = summary.track_count or 0,
    evidence_family_count = summary.evidence_family_count or 0,
    truncated = summary.truncated == true,
    fixture = bounded_string(summary.fixture, 120) or JSON_NULL,
  }
end

local function create_layer_report(request)
  local evidence_ref = create_layer_report_artifact_ref_from_request_refs(request, A3_ARTIFACT_SPECS.layer_evidence)
  if not evidence_ref then
    return create_layer_report_error("ARTIFACT_NOT_FOUND", "A3 layer report requires an items.layer_evidence.v1 artifact ref.", {
      blocker = "layer_evidence_ref_missing",
    })
  end

  local evidence_envelope, evidence_failure = create_layer_report_read_evidence_artifact(evidence_ref)
  if not evidence_envelope then
    return create_layer_report_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end

  local item_count = create_layer_report_count_from_summary_or_payload(evidence_envelope, "item_count", "items")
  local track_count = create_layer_report_count_from_summary_or_payload(evidence_envelope, "track_count", "tracks")
  local max_rows = create_layer_report_bounded_limit(request, request.params.max_report_rows, 24, 24)
  local report_row_count = math.min(max_rows, math.max(item_count, track_count, 1))
  local summary = {
    evidence_item_count = item_count,
    evidence_track_count = track_count,
    report_row_count = report_row_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    typed_fixture_smoke = true,
    consumed_artifact_refs = json_array({ evidence_ref }),
    evidence_summary = create_layer_report_compact_evidence_summary(evidence_envelope),
    rows = create_layer_report_rows(evidence_envelope, report_row_count),
  }
  local write, failure = write_a3_artifact(request, A3_ARTIFACT_SPECS.layer_report, summary, payload)
  if not write then
    return create_layer_report_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end
return {
  exports = { create_layer_report = create_layer_report },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/set_metadata_field.lua
__openreaper_register_handler_module("project/set_metadata_field.lua", function()
-- Extracted Safe-Write-A handler: template.project.set_metadata_field.

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

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function project_object_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function marker_object_ref(kind, index_number, name)
  local ref_kind = kind == "region" and "region" or "marker"
  return {
    kind = ref_kind,
    ref = ref_kind .. ":index:" .. tostring(index_number or 0),
    identity = {
      scheme = "index",
      value = tostring(index_number or 0),
    },
    display = {
      name = bounded_string(name or "", 160),
    },
  }
end

local function project_metadata_key(field)
  return PROJECT_METADATA_KEYS[field]
end

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
end

local function safe_write_project_metadata(request)
  local key = project_metadata_key(request.params.field)
  if not key then
    return handler_error("PARAMS_INVALID", "Safe-Write-A metadata field is not allowed.", {
      field = bounded_string(request.params.field, 80),
    })
  end
  local project = current_project()
  local ok, success = call_reaper("GetSetProjectInfo_String", project, key, tostring(request.params.value or ""), true)
  if not ok or success == false then
    return handler_error("COMMAND_FAILED", "Could not update project metadata field.", {
      field = request.params.field,
    }, false)
  end
  local readback = project_info_string(project, key, 240)
  return safe_write_a_summary(request, {
    project_ref = "project:current",
    field = request.params.field,
    value = bounded_string(readback, 240),
  }), nil, nil, nil, safe_write_a_refs(project_object_ref())
end
return {
  exports = { safe_write_project_metadata = safe_write_project_metadata },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/create_marker.lua
__openreaper_register_handler_module("project/create_marker.lua", function()
-- Extracted Safe-Write-A handler: template.project.create_marker.

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

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function project_object_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function marker_object_ref(kind, index_number, name)
  local ref_kind = kind == "region" and "region" or "marker"
  return {
    kind = ref_kind,
    ref = ref_kind .. ":index:" .. tostring(index_number or 0),
    identity = {
      scheme = "index",
      value = tostring(index_number or 0),
    },
    display = {
      name = bounded_string(name or "", 160),
    },
  }
end

local function project_metadata_key(field)
  return PROJECT_METADATA_KEYS[field]
end

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
end

local function safe_write_create_marker(request)
  local project = current_project()
  local color = native_color_from_hex(request.params.color)
  local ok, index_number = call_reaper(
    "AddProjectMarker2",
    project,
    false,
    bounded_number(request.params.position_seconds, 0),
    0,
    tostring(request.params.name or "OR_SAFE_WRITE_A_MARKER"),
    -1,
    color
  )
  if not ok or type(index_number) ~= "number" or index_number < 0 then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A marker.", {}, false)
  end
  return safe_write_a_summary(request, {
    marker_ref = "marker:index:" .. tostring(index_number),
    name = bounded_string(request.params.name, 160),
    position_seconds = bounded_number(request.params.position_seconds, 0),
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("marker", index_number, request.params.name))
end
return {
  exports = { safe_write_create_marker = safe_write_create_marker },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/project/create_region.lua
__openreaper_register_handler_module("project/create_region.lua", function()
-- Extracted Safe-Write-A handler: template.project.create_region.

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

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function current_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local function project_object_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function marker_object_ref(kind, index_number, name)
  local ref_kind = kind == "region" and "region" or "marker"
  return {
    kind = ref_kind,
    ref = ref_kind .. ":index:" .. tostring(index_number or 0),
    identity = {
      scheme = "index",
      value = tostring(index_number or 0),
    },
    display = {
      name = bounded_string(name or "", 160),
    },
  }
end

local function project_metadata_key(field)
  return PROJECT_METADATA_KEYS[field]
end

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
end

local function safe_write_create_region(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "Safe-Write-A region end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local project = current_project()
  local color = native_color_from_hex(request.params.color)
  local ok, index_number = call_reaper(
    "AddProjectMarker2",
    project,
    true,
    start_seconds,
    end_seconds,
    tostring(request.params.name or "OR_SAFE_WRITE_A_REGION"),
    -1,
    color
  )
  if not ok or type(index_number) ~= "number" or index_number < 0 then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A region.", {}, false)
  end
  return safe_write_a_summary(request, {
    region_ref = "region:index:" .. tostring(index_number),
    name = bounded_string(request.params.name, 160),
    start_seconds = start_seconds,
    end_seconds = end_seconds,
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("region", index_number, request.params.name))
end
return {
  exports = { safe_write_create_region = safe_write_create_region },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/create_track.lua
__openreaper_register_handler_module("tracks/create_track.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.create_track.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_create_track(request)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local index = is_non_negative_integer(request.params.index) and request.params.index or total
  index = math.max(0, math.min(index, total))
  local ok_insert = call_reaper("InsertTrackAtIndex", index, true)
  if not ok_insert then
    return handler_error("COMMAND_FAILED", "Could not insert Safe-Write-A track.", {
      index = index,
    }, false)
  end
  local ok_track, track = call_reaper("GetTrack", 0, index)
  if not ok_track or not track then
    return handler_error("TRACK_NOT_FOUND", "Inserted Safe-Write-A track could not be resolved.", {
      index = index,
    })
  end
  call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name or "OR_SAFE_WRITE_A_TARGET"), true)
  call_reaper("TrackList_AdjustWindows", false)
  local summary = track_summary(track)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end
return {
  exports = { safe_write_create_track = safe_write_create_track },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/rename_track.lua
__openreaper_register_handler_module("tracks/rename_track.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.rename_track.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_rename_track(request)
  return safe_write_track_update(request, function(track)
    local ok, success = call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name or ""), true)
    if not ok or success == false then
      return false, {
        code = "COMMAND_FAILED",
        message = "Could not rename Safe-Write-A track.",
        recoverable = false,
        details = {},
      }
    end
    return true
  end)
end
return {
  exports = { safe_write_rename_track = safe_write_rename_track },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/set_color.lua
__openreaper_register_handler_module("tracks/set_color.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.set_color.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_set_track_color(request)
  return safe_write_track_update(request, function(track)
    local color = native_color_from_hex(request.params.color)
    local ok, success = call_reaper("SetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR", color)
    if not ok or success == false then
      return false, {
        code = "COMMAND_FAILED",
        message = "Could not set Safe-Write-A track color.",
        recoverable = false,
        details = {},
      }
    end
    return true
  end)
end
return {
  exports = { safe_write_set_track_color = safe_write_set_track_color },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/select_track.lua
__openreaper_register_handler_module("tracks/select_track.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.select_track.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_select_track(request)
  return safe_write_track_update(request, function(track)
    local mode = request.params.mode
    if mode == "replace" then
      local ok_count, count = call_reaper("CountTracks", 0)
      for index = 0, (ok_count and first_number(count) or 0) - 1 do
        local ok_track, candidate = call_reaper("GetTrack", 0, index)
        if ok_track and candidate then
          call_reaper("SetMediaTrackInfo_Value", candidate, "I_SELECTED", 0)
        end
      end
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 1)
    elseif mode == "add" then
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 1)
    elseif mode == "remove" then
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 0)
    else
      return false, {
        code = "PARAMS_INVALID",
        message = "Track selection mode must be replace, add, or remove.",
        details = { mode = bounded_string(mode, 80) },
      }
    end
    return true
  end)
end
return {
  exports = { safe_write_select_track = safe_write_select_track },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/set_mute.lua
__openreaper_register_handler_module("tracks/set_mute.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.set_mute.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_set_track_mute(request)
  return safe_write_track_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "B_MUTE", request.params.muted == true and 1 or 0)
    return true
  end)
end
return {
  exports = { safe_write_set_track_mute = safe_write_set_track_mute },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/tracks/set_solo.lua
__openreaper_register_handler_module("tracks/set_solo.lua", function()
-- Extracted Safe-Write-A handler: template.tracks.set_solo.

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

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_set_track_solo(request)
  return safe_write_track_update(request, function(track)
    local value = 0
    if request.params.mode == "solo" then
      value = 1
    elseif request.params.mode == "solo_in_place" then
      value = 2
    elseif request.params.mode ~= "off" then
      return false, {
        code = "PARAMS_INVALID",
        message = "Track solo mode must be off, solo, or solo_in_place.",
        details = { mode = bounded_string(request.params.mode, 80) },
      }
    end
    call_reaper("SetMediaTrackInfo_Value", track, "I_SOLO", value)
    return true
  end)
end
return {
  exports = { safe_write_set_track_solo = safe_write_set_track_solo },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/set_edit_cursor.lua
__openreaper_register_handler_module("transport/set_edit_cursor.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted Safe-Write-A handler: template.transport.set_edit_cursor.

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

local function safe_write_transport_set_edit_cursor(request)
  call_reaper(
    "SetEditCurPos",
    bounded_number(request.params.position_seconds, 0),
    request.params.move_view == true,
    request.params.seek_playback == true
  )
  local state = read_transport_state()
  return safe_write_a_summary(request, {
    edit_cursor_seconds = state.edit_cursor_seconds,
  })
end
return {
  exports = { safe_write_transport_set_edit_cursor = safe_write_transport_set_edit_cursor },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/set_time_selection.lua
__openreaper_register_handler_module("transport/set_time_selection.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted Safe-Write-A handler: template.transport.set_time_selection.

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

local function safe_write_transport_set_time_selection(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds)
  if end_seconds < start_seconds then
    return handler_error("PARAMS_INVALID", "Time selection end_seconds must be greater than or equal to start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  return safe_write_a_summary(request, read_transport_state().time_selection)
end
return {
  exports = { safe_write_transport_set_time_selection = safe_write_transport_set_time_selection },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/clear_time_selection.lua
__openreaper_register_handler_module("transport/clear_time_selection.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted Safe-Write-A handler: template.transport.clear_time_selection.

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

local function safe_write_transport_clear_time_selection(request)
  call_reaper("GetSet_LoopTimeRange", true, false, 0, 0, false)
  return safe_write_a_summary(request, read_transport_state().time_selection)
end
return {
  exports = { safe_write_transport_clear_time_selection = safe_write_transport_clear_time_selection },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/set_loop_points.lua
__openreaper_register_handler_module("transport/set_loop_points.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
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
return {
  exports = { safe_write_transport_set_loop_points = safe_write_transport_set_loop_points },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/clear_loop_points.lua
__openreaper_register_handler_module("transport/clear_loop_points.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted Safe-Write-A handler: template.transport.clear_loop_points.

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

local function safe_write_transport_clear_loop_points(request)
  call_reaper("GetSet_LoopTimeRange", true, true, 0, 0, false)
  return safe_write_a_summary(request, read_transport_state().loop_points)
end
return {
  exports = { safe_write_transport_clear_loop_points = safe_write_transport_clear_loop_points },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/transport/set_repeat.lua
__openreaper_register_handler_module("transport/set_repeat.lua", function()
local function read_transport_state(...)
  return OPENREAPER_HANDLER_EXPORTS.read_transport_state(...)
end
-- Extracted Safe-Write-A handler: template.transport.set_repeat.

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

local function safe_write_transport_set_repeat(request)
  call_reaper("GetSetRepeat", request.params.enabled == true and 1 or 0)
  return safe_write_a_summary(request, {
    repeat_enabled = read_transport_state().repeat_enabled,
  })
end
return {
  exports = { safe_write_transport_set_repeat = safe_write_transport_set_repeat },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/move_item.lua
__openreaper_register_handler_module("items/move_item.lua", function()
-- Extracted Safe-Write-A handler: template.items.move_item.

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

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_move_item(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", bounded_number(request.params.position_seconds, 0))
    return true
  end)
end
return {
  exports = { safe_write_move_item = safe_write_move_item },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/trim_item.lua
__openreaper_register_handler_module("items/trim_item.lua", function()
-- Extracted Safe-Write-A handler: template.items.trim_item.

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

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_trim_item(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", math.max(0, bounded_number(request.params.length_seconds, 0)))
    if type(request.params.start_offset_seconds) == "number" then
      local ok_take, take = call_reaper("GetActiveTake", item)
      if ok_take and take then
        call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", math.max(0, request.params.start_offset_seconds))
      end
    end
    return true
  end)
end
return {
  exports = { safe_write_trim_item = safe_write_trim_item },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/set_item_fades.lua
__openreaper_register_handler_module("items/set_item_fades.lua", function()
-- Extracted Safe-Write-A handler: template.items.set_item_fades.

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

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_set_item_fades(request)
  return safe_write_item_update(request, function(item)
    local fade_in = request.params.fade_in_seconds == JSON_NULL and 0 or bounded_number(request.params.fade_in_seconds, 0)
    local fade_out = request.params.fade_out_seconds == JSON_NULL and 0 or bounded_number(request.params.fade_out_seconds, 0)
    call_reaper("SetMediaItemInfo_Value", item, "D_FADEINLEN", math.max(0, fade_in))
    call_reaper("SetMediaItemInfo_Value", item, "D_FADEOUTLEN", math.max(0, fade_out))
    return true
  end)
end
return {
  exports = { safe_write_set_item_fades = safe_write_set_item_fades },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/set_take_pitch.lua
__openreaper_register_handler_module("items/set_take_pitch.lua", function()
-- Extracted Safe-Write-A handler: template.items.set_take_pitch.

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

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_set_take_pitch(request)
  return safe_write_item_update(request, function(item)
    local ok_take, take = call_reaper("GetActiveTake", item)
    if not ok_take or not take then
      return false, {
        code = "TAKE_NOT_FOUND",
        message = "Safe-Write-A take pitch requires an active take.",
        details = {},
      }
    end
    call_reaper("SetMediaItemTakeInfo_Value", take, "D_PITCH", bounded_number(request.params.semitones, 0))
    return true
  end)
end
return {
  exports = { safe_write_set_take_pitch = safe_write_set_take_pitch },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/items/set_item_snap_offset.lua
__openreaper_register_handler_module("items/set_item_snap_offset.lua", function()
-- Extracted Safe-Write-A handler: template.items.set_item_snap_offset.

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

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_set_item_snap_offset(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_SNAPOFFSET", math.max(0, bounded_number(request.params.snap_offset_seconds, 0)))
    return true
  end)
end
return {
  exports = { safe_write_set_item_snap_offset = safe_write_set_item_snap_offset },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/create_midi_item.lua
__openreaper_register_handler_module("midi/create_midi_item.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
-- Extracted Safe-Write-A handler: template.midi.create_midi_item.

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

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function item_ref_string(item)
  return READ_B_MIDI.item_ref_string(item)
end

local function midi_take_summary(take)
  return READ_B_MIDI.midi_take_summary(take)
end

local function item_object_ref(item)
  local ref = READ_B_MIDI.item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function safe_write_create_midi_item(request)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "MIDI item end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local ok_item, item = call_reaper("CreateNewMIDIItemInProj", track, start_seconds, end_seconds, false)
  if not ok_item or not item then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A MIDI item.", {}, false)
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return handler_error("TAKE_NOT_FOUND", "Created MIDI item did not expose an active take.", {})
  end
  local summary = midi_take_summary(take)
  summary.item_ref = item_ref_string(item)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(item_object_ref(item), take_object_ref(take))
end
return {
  exports = { safe_write_create_midi_item = safe_write_create_midi_item },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/insert_notes_batch.lua
__openreaper_register_handler_module("midi/insert_notes_batch.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
local function read_take_event_counts(...)
  return OPENREAPER_HANDLER_EXPORTS.read_take_event_counts(...)
end
-- Extracted Safe-Write-A handler: template.midi.insert_notes_batch.

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

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function resolve_midi_take_for_request(request)
  return READ_B_MIDI.resolve_midi_take_for_request(request)
end

local function take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function ppq_position(take, event, key)
  local value = event[key]
  if type(value) == "number" then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  if type(event[seconds_key]) == "number" then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event[seconds_key])
    return ok and first_number(ppq) or 0
  end
  return 0
end

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  end
  return 1
end

local function safe_write_insert_notes_batch(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  local inserted = 0
  for index = 1, #notes do
    local note = is_object(notes[index]) and notes[index] or {}
    local start_ppq = ppq_position(take, note, "start_ppq")
    local end_ppq = ppq_position(take, note, "end_ppq")
    if end_ppq > start_ppq then
      local ok, success = call_reaper(
        "MIDI_InsertNote",
        take,
        note.selected == true,
        note.muted == true,
        start_ppq,
        end_ppq,
        math.max(0, math.min(15, integer_value(note.channel) or 0)),
        math.max(0, math.min(127, integer_value(note.pitch) or 60)),
        math.max(1, math.min(127, integer_value(note.velocity) or 96)),
        true
      )
      if ok and success ~= false then
        inserted = inserted + 1
      end
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_note_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
return {
  exports = { safe_write_insert_notes_batch = safe_write_insert_notes_batch },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/insert_cc_batch.lua
__openreaper_register_handler_module("midi/insert_cc_batch.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
local function read_take_event_counts(...)
  return OPENREAPER_HANDLER_EXPORTS.read_take_event_counts(...)
end
-- Extracted Safe-Write-A handler: template.midi.insert_cc_batch.

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

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function resolve_midi_take_for_request(request)
  return READ_B_MIDI.resolve_midi_take_for_request(request)
end

local function take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function ppq_position(take, event, key)
  local value = event[key]
  if type(value) == "number" then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  if type(event[seconds_key]) == "number" then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event[seconds_key])
    return ok and first_number(ppq) or 0
  end
  return 0
end

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  end
  return 1
end

local function safe_write_insert_cc_batch(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local inserted = 0
  for index = 1, #events do
    local event = is_object(events[index]) and events[index] or {}
    local ppq = ppq_position(take, event, "ppq")
    local ok, success = call_reaper(
      "MIDI_InsertCC",
      take,
      event.selected == true,
      event.muted == true,
      ppq,
      176,
      math.max(0, math.min(15, integer_value(event.channel) or 0)),
      math.max(0, math.min(127, integer_value(event.controller) or 1)),
      math.max(0, math.min(127, integer_value(event.value) or 0)),
      true
    )
    if ok and success ~= false then
      inserted = inserted + 1
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_cc_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
return {
  exports = { safe_write_insert_cc_batch = safe_write_insert_cc_batch },
  shared = {  },
}
end)

-- OpenReaper bridge handler module: reaper/bridge/src/handlers/midi/insert_text_sysex_events.lua
__openreaper_register_handler_module("midi/insert_text_sysex_events.lua", function()
local READ_B_MIDI = OPENREAPER_HANDLER_SHARED.READ_B_MIDI
local function read_take_event_counts(...)
  return OPENREAPER_HANDLER_EXPORTS.read_take_event_counts(...)
end
-- Extracted Safe-Write-A handler: template.midi.insert_text_sysex_events.

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

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function resolve_midi_take_for_request(request)
  return READ_B_MIDI.resolve_midi_take_for_request(request)
end

local function take_object_ref(take)
  local ref = READ_B_MIDI.take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function ppq_position(take, event, key)
  local value = event[key]
  if type(value) == "number" then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  if type(event[seconds_key]) == "number" then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event[seconds_key])
    return ok and first_number(ppq) or 0
  end
  return 0
end

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  end
  return 1
end

local function safe_write_insert_text_sysex_events(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local inserted = 0
  for index = 1, #events do
    local event = is_object(events[index]) and events[index] or {}
    local ppq = ppq_position(take, event, "ppq")
    local ok, success = call_reaper(
      "MIDI_InsertTextSysexEvt",
      take,
      event.selected == true,
      event.muted == true,
      ppq,
      text_sysex_type_value(event.event_kind),
      bounded_string(event.text or event.bytes or "", 240),
      true
    )
    if ok and success ~= false then
      inserted = inserted + 1
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_text_sysex_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end
return {
  exports = { safe_write_insert_text_sysex_events = safe_write_insert_text_sysex_events },
  shared = {  },
}
end)

local function current_project()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0, bounded_string(project_path or "", 240)
  end
  return 0, ""
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

local function marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return prefix .. ":index:" .. tostring(index_number or 0)
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

local ACTION_SECTION_IDS = {
  main = 0,
  midi_editor = 32060,
  midi_event_list = 32061,
  crossfade_editor = 32062,
  media_explorer = 32063,
}

local function action_section_name(value)
  if ACTION_SECTION_IDS[value] ~= nil then
    return value
  end
  return "main"
end

local function action_section_id(value)
  return ACTION_SECTION_IDS[action_section_name(value)]
end

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function action_source(named_command, command_id)
  if is_string(named_command) and named_command:sub(1, 1) == "_" then
    return "extension"
  end
  if type(command_id) == "number" and command_id > 0 then
    return "native"
  end
  return "unknown"
end

local function lookup_named_command(named_command)
  if not is_string(named_command) then
    return 0
  end
  local ok, command_id = call_reaper("NamedCommandLookup", named_command)
  if ok and type(command_id) == "number" and command_id > 0 then
    return math.floor(command_id)
  end
  return 0
end

local function reverse_named_command(command_id)
  local ok, named = call_reaper("ReverseNamedCommandLookup", command_id)
  if ok and type(named) == "string" and named ~= "" then
    return named
  end
  return nil
end

local function action_display_name(section_id, command_id)
  local ok, name = call_reaper("kbd_getTextFromCmd", command_id, section_id)
  return bounded_string(ok and first_string(name) or "", 160)
end

local function lower_string(value)
  return tostring(value or ""):lower()
end

local ACTION_SEARCH_DEFAULT_LIMIT = 6
local ACTION_SEARCH_MAX_LIMIT = 6
local ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS = 96
local ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS = 80

local function take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

local function take_ref_string(take)
  local guid = take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

local function find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

local function find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

local function resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

local function resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_take_token("guid:" .. tostring(identity.value))
  end
  return resolve_take_token(ref.ref)
end

local function take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

local function resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return resolve_take_token(request.params.ref)
end

local function resolve_midi_take_for_request(request)
  local take = resolve_take_for_request(request)
  if not take or not take_is_midi(take) then
    local _, failure = handler_error("TAKE_NOT_FOUND", "MIDI take ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
    return nil, failure
  end
  return take
end

local function midi_take_summary(take)
  local item = take_item(take)
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local count_ok = ok_count and count_retval ~= false
  local start_ppq = 0
  local end_ppq = 0
  if item then
    local start_seconds = item_number(item, "D_POSITION")
    local end_seconds = start_seconds + item_number(item, "D_LENGTH")
    local ok_start, ppq_start = call_reaper("MIDI_GetPPQPosFromProjTime", take, start_seconds)
    local ok_end, ppq_end = call_reaper("MIDI_GetPPQPosFromProjTime", take, end_seconds)
    start_ppq = ok_start and first_number(ppq_start) or 0
    end_ppq = ok_end and first_number(ppq_end) or 0
  end
  return {
    take_ref = take_ref_string(take),
    item_ref = item and item_ref_string(item) or JSON_NULL,
    event_count = count_ok and ((first_number(note_count) or 0) + (first_number(cc_count) or 0) + (first_number(text_sysex_count) or 0)) or 0,
    ppq_start = start_ppq,
    ppq_end = end_ppq,
  }
end

local function text_sysex_kind(type_value)
  if type_value == -1 then
    return "sysex"
  elseif type_value == 1 then
    return "text"
  elseif type_value == 5 then
    return "lyric"
  elseif type_value == 15 then
    return "notation"
  end
  return "text"
end

local function source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

local function source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true or false
end

local function source_length_with_file_fallback(source, filename)
  local length, length_is_quarter_notes = source_length(source)
  if length > 0 and not length_is_quarter_notes then
    return length, "take_source"
  end
  if length_is_quarter_notes then
    return 0, "quarter_notes"
  end
  if filename ~= "" and file_exists(filename) then
    local ok_file_source, file_source = call_reaper("PCM_Source_CreateFromFile", filename)
    if ok_file_source and file_source then
      local fallback_length, fallback_length_is_quarter_notes = source_length(file_source)
      call_reaper("PCM_Source_Destroy", file_source)
      if fallback_length > 0 and not fallback_length_is_quarter_notes then
        return fallback_length, "pcm_source_create_from_file"
      end
      if fallback_length_is_quarter_notes then
        return 0, "quarter_notes"
      end
    end
  end
  return 0, "unreadable"
end

local function source_channels(source)
  local ok, channels = call_reaper("GetMediaSourceNumChannels", source)
  return ok and first_number(channels) or 0
end

local function source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return bounded_string(ok and first_string(filename) or "", 240)
end

local function source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function metadata_keys_for_source(source, include_metadata_keys)
  local keys = json_array({})
  if include_metadata_keys ~= true then
    return keys
  end
  for _, key in ipairs({ "TITLE", "ARTIST", "ALBUM", "DATE", "BPM" }) do
    local ok_meta, value = call_reaper("GetMediaFileMetadata", source, key, "")
    if ok_meta and type(value) == "string" and value ~= "" then
      keys[#keys + 1] = key
    end
  end
  return keys
end

local function file_ref_for_path(path_value)
  return "file:path:" .. bounded_string(path_value, 220)
end

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function artifact_ref_from_request_refs(request, expected)
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


local SAFE_WRITE_A_HANDLERS = {
  ["project.set_metadata_field"] = OPENREAPER_HANDLER_EXPORTS.safe_write_project_metadata,
  ["project.create_marker"] = OPENREAPER_HANDLER_EXPORTS.safe_write_create_marker,
  ["project.create_region"] = OPENREAPER_HANDLER_EXPORTS.safe_write_create_region,
  ["track.create"] = OPENREAPER_HANDLER_EXPORTS.safe_write_create_track,
  ["track.rename"] = OPENREAPER_HANDLER_EXPORTS.safe_write_rename_track,
  ["track.set_color"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_track_color,
  ["track.select"] = OPENREAPER_HANDLER_EXPORTS.safe_write_select_track,
  ["track.set_mute"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_track_mute,
  ["track.set_solo"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_track_solo,
  ["transport.set_edit_cursor"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_set_edit_cursor,
  ["transport.set_time_selection"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_set_time_selection,
  ["transport.clear_time_selection"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_clear_time_selection,
  ["transport.set_loop_points"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_set_loop_points,
  ["transport.clear_loop_points"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_clear_loop_points,
  ["transport.set_repeat"] = OPENREAPER_HANDLER_EXPORTS.safe_write_transport_set_repeat,
  ["items.move_item"] = OPENREAPER_HANDLER_EXPORTS.safe_write_move_item,
  ["items.trim_item"] = OPENREAPER_HANDLER_EXPORTS.safe_write_trim_item,
  ["items.set_item_fades"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_item_fades,
  ["items.set_take_pitch"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_take_pitch,
  ["items.set_item_snap_offset"] = OPENREAPER_HANDLER_EXPORTS.safe_write_set_item_snap_offset,
  ["midi.create_midi_item"] = OPENREAPER_HANDLER_EXPORTS.safe_write_create_midi_item,
  ["midi.insert_notes_batch"] = OPENREAPER_HANDLER_EXPORTS.safe_write_insert_notes_batch,
  ["midi.insert_cc_batch"] = OPENREAPER_HANDLER_EXPORTS.safe_write_insert_cc_batch,
  ["midi.insert_text_sysex_events"] = OPENREAPER_HANDLER_EXPORTS.safe_write_insert_text_sysex_events,
}

local E3_MEDIA_ROUTE_HANDLERS = {
  ["media.import_file_to_track"] = OPENREAPER_HANDLER_EXPORTS.import_file_to_track,
  ["media.import_file_section_to_track"] = OPENREAPER_HANDLER_EXPORTS.import_file_section_to_track,
  ["media.relink_take_source"] = OPENREAPER_HANDLER_EXPORTS.relink_take_source,
}

local E4_ITEM_ROUTE_HANDLERS = {
  ["item.copy_to_track"] = OPENREAPER_HANDLER_EXPORTS.copy_item_to_track,
  ["items.split_item_at_time"] = OPENREAPER_HANDLER_EXPORTS.split_item_at_time,
  ["items.set_take_playrate"] = OPENREAPER_HANDLER_EXPORTS.set_take_playrate,
}

local E5_ROUTING_WRITE_HANDLERS = {
  ["routing.send.create"] = OPENREAPER_HANDLER_EXPORTS.create_track_send,
  ["routing.send.set_volume"] = OPENREAPER_HANDLER_EXPORTS.set_send_volume,
  ["routing.send.set_pan"] = OPENREAPER_HANDLER_EXPORTS.set_send_pan,
  ["routing.send.set_mute"] = OPENREAPER_HANDLER_EXPORTS.set_send_mute,
  ["routing.send.set_mode"] = OPENREAPER_HANDLER_EXPORTS.set_send_mode,
  ["routing.master_parent.set"] = OPENREAPER_HANDLER_EXPORTS.set_master_parent_send,
  ["routing.track_channels.set"] = OPENREAPER_HANDLER_EXPORTS.set_track_channel_count,
  ["routing.track_hardware_output.set"] = OPENREAPER_HANDLER_EXPORTS.set_track_hardware_output,
  ["routing.track_hardware_output.remove"] = OPENREAPER_HANDLER_EXPORTS.remove_track_hardware_output,
  ["routing.send.audio_channels.set"] = OPENREAPER_HANDLER_EXPORTS.set_send_audio_channels,
  ["routing.send.set_phase"] = OPENREAPER_HANDLER_EXPORTS.set_send_phase,
  ["routing.send.set_mono"] = OPENREAPER_HANDLER_EXPORTS.set_send_mono,
  ["routing.send.midi_channels.set"] = OPENREAPER_HANDLER_EXPORTS.set_send_midi_channels,
}

local E5_AUTOMATION_WRITE_HANDLERS = {
  ["automation.set_envelope_lane_state"] = OPENREAPER_HANDLER_EXPORTS.set_envelope_lane_state,
  ["automation.insert_envelope_point"] = OPENREAPER_HANDLER_EXPORTS.insert_envelope_point,
  ["automation.set_track_automation_mode"] = OPENREAPER_HANDLER_EXPORTS.set_track_automation_mode,
  ["automation.set_envelope_point"] = OPENREAPER_HANDLER_EXPORTS.set_envelope_point,
  ["automation.insert_envelope_points_batch"] = OPENREAPER_HANDLER_EXPORTS.insert_envelope_points_batch,
  ["automation.set_send_automation_mode"] = OPENREAPER_HANDLER_EXPORTS.set_send_automation_mode,
  ["automation.create_automation_item"] = OPENREAPER_HANDLER_EXPORTS.create_automation_item,
  ["automation.set_automation_item_bounds"] = OPENREAPER_HANDLER_EXPORTS.set_automation_item_bounds,
  ["automation.insert_fx_parameter_envelope_points"] = OPENREAPER_HANDLER_EXPORTS.insert_fx_parameter_envelope_points,
  ["automation.insert_sine_wave_points"] = OPENREAPER_HANDLER_EXPORTS.insert_sine_wave_points,
}

local E2_FX_B1_WRITE_HANDLERS = {
  ["fx.add_track"] = OPENREAPER_HANDLER_EXPORTS.add_track_fx,
  ["fx.add_take"] = OPENREAPER_HANDLER_EXPORTS.add_take_fx,
  ["fx.set_bypass"] = OPENREAPER_HANDLER_EXPORTS.set_fx_bypass,
  ["fx.set_parameter_normalized"] = OPENREAPER_HANDLER_EXPORTS.set_fx_parameter_normalized,
  ["fx.set_preset_by_name"] = OPENREAPER_HANDLER_EXPORTS.set_fx_preset_by_name,
  ["fx.set_preset_by_index"] = OPENREAPER_HANDLER_EXPORTS.set_fx_preset_by_index,
  ["fx.reorder"] = OPENREAPER_HANDLER_EXPORTS.reorder_fx,
}

local D6_PROJECT_TEMPO_WRITE_HANDLERS = {
  ["project.set_tempo"] = OPENREAPER_HANDLER_EXPORTS.d6_project_set_tempo,
  ["project.set_bpm"] = OPENREAPER_HANDLER_EXPORTS.d6_project_set_bpm,
  ["project.set_tempo_marker"] = OPENREAPER_HANDLER_EXPORTS.d6_project_set_tempo_marker,
  ["project.set_grid"] = OPENREAPER_HANDLER_EXPORTS.d20_project_set_grid,
}

local D9_TRACKS_MIXER_WRITE_HANDLERS = {
  ["track.set_record_arm"] = OPENREAPER_HANDLER_EXPORTS.set_record_arm,
  ["track.set_volume"] = OPENREAPER_HANDLER_EXPORTS.set_volume,
  ["track.set_pan"] = OPENREAPER_HANDLER_EXPORTS.set_pan,
  ["track.set_width"] = OPENREAPER_HANDLER_EXPORTS.set_width,
}

local D11_PROJECT_MARKER_REGION_HANDLERS = {
  ["project.delete_marker"] = OPENREAPER_HANDLER_EXPORTS.d11_project_delete_marker,
  ["project.delete_region"] = OPENREAPER_HANDLER_EXPORTS.d11_project_delete_region,
  ["project.remove_marker"] = OPENREAPER_HANDLER_EXPORTS.d11_project_remove_marker,
  ["project.remove_region"] = OPENREAPER_HANDLER_EXPORTS.d11_project_remove_region,
  ["project.rename_marker"] = OPENREAPER_HANDLER_EXPORTS.d11_project_rename_marker,
  ["project.rename_region"] = OPENREAPER_HANDLER_EXPORTS.d11_project_rename_region,
}

local D12_TRANSPORT_SAFE_HANDLERS = {
  ["transport.play"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_play,
  ["transport.pause"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_pause,
  ["transport.stop_playback"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_stop_playback,
  ["transport.set_playback_rate"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_set_playback_rate,
  ["transport.start_recording"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_start_recording,
  ["transport.stop_recording"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_stop_recording,
  ["transport.set_record_mode"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_set_record_mode,
  ["transport.set_punch_record_range"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_set_punch_record_range,
  ["transport.schedule_recording"] = OPENREAPER_HANDLER_EXPORTS.d12_transport_schedule_recording,
}

local D13_ITEMS_CORE_WRITE_HANDLERS = {
  ["items.set_item_volume"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_item_volume,
  ["items.set_take_volume"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_volume,
  ["items.set_take_pan"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_pan,
  ["items.rename_take"] = OPENREAPER_HANDLER_EXPORTS.d13_items_rename_take,
  ["items.set_loop_source"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_loop_source,
  ["items.set_mute"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_mute,
  ["items.set_lock"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_lock,
  ["items.set_play_all_takes"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_play_all_takes,
  ["items.set_take_start_in_source"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_start_in_source,
  ["items.set_channel_mode"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_channel_mode,
  ["items.set_pitch_shift_mode"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_pitch_shift_mode,
  ["items.set_stretch_marker_fade_size"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_stretch_marker_fade_size,
}

local D14_ITEMS_DELETE_HANDLERS = {
  ["items.delete_item"] = OPENREAPER_HANDLER_EXPORTS.d14_items_delete_item,
  ["items.delete_items"] = OPENREAPER_HANDLER_EXPORTS.d14_items_delete_items,
}

local D15_ITEMS_SOURCE_PHASE_HANDLERS = {
  ["items.set_no_autofades"] = OPENREAPER_HANDLER_EXPORTS.d15_items_set_no_autofades,
  ["items.set_invert_phase"] = OPENREAPER_HANDLER_EXPORTS.d15_items_set_invert_phase,
  ["items.choose_new_source_file"] = OPENREAPER_HANDLER_EXPORTS.d15_items_choose_new_source_file,
}

local D16_TRACKS_ORG_HANDLERS = {
  ["track.delete"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_delete_track,
  ["tracks.delete"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_delete_tracks,
  ["track.create_folder"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_create_folder_track,
  ["track.set_folder_depth"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_set_folder_depth,
  ["track.move"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_move_track,
  ["tracks.move"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_move_tracks,
  ["tracks.nest_in_folder"] = OPENREAPER_HANDLER_EXPORTS.d16_tracks_nest_tracks_in_folder,
}

local D17_MIDI_EDIT_HANDLERS = {
  ["midi.set_notes_batch"] = OPENREAPER_HANDLER_EXPORTS.d17_midi_set_notes_batch,
  ["midi.quantize_notes"] = OPENREAPER_HANDLER_EXPORTS.d17_midi_quantize_notes,
  ["midi.quantize_selected_notes"] = OPENREAPER_HANDLER_EXPORTS.d17_midi_quantize_selected_notes,
  ["midi.set_cc_events_batch"] = OPENREAPER_HANDLER_EXPORTS.d17_midi_set_cc_events_batch,
}

local D22_RENDER_SETTINGS_WRITE_HANDLERS = {
  ["render.sample_rate.set"] = OPENREAPER_HANDLER_EXPORTS.set_render_sample_rate,
}

local D28_SMALL_WRITE_HANDLERS = {
  ["items.set_item_pan"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_item_pan,
  ["items.set_reverse"] = OPENREAPER_HANDLER_EXPORTS.d13_items_set_reverse,
  ["project.set_snap"] = OPENREAPER_HANDLER_EXPORTS.d20_project_set_snap,
  ["routing.track_mono_stereo.set"] = OPENREAPER_HANDLER_EXPORTS.track_mono_or_stereo_button,
}

local function dispatch_template_execute(request)
  local handler = SAFE_WRITE_A_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E3_MEDIA_ROUTE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E4_ITEM_ROUTE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E5_ROUTING_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E5_AUTOMATION_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E2_FX_B1_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D6_PROJECT_TEMPO_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D9_TRACKS_MIXER_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D11_PROJECT_MARKER_REGION_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D12_TRANSPORT_SAFE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D13_ITEMS_CORE_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D14_ITEMS_DELETE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D15_ITEMS_SOURCE_PHASE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D16_TRACKS_ORG_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D17_MIDI_EDIT_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D22_RENDER_SETTINGS_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D28_SMALL_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  return handler_error("OPERATION_NOT_FOUND", "template.execute supports only approved live-smoke capabilities.", {
      capability = bounded_string(request.pack.capability, 120),
    })
end

local ALLOWED_OPERATIONS = {
  ["run_command:template.execute"] = {
    handler = dispatch_template_execute,
  },
  ["run_command:render.sample_rate.set"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.set_render_sample_rate,
  },
  ["query_state:project.read_summary"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.read_project_summary,
  },
  ["query_state:project.read_metadata"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.read_project_metadata,
  },
  ["query_state:project.list_markers_regions"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.list_markers_regions,
  },
  ["query_state:project.read_tempo_map"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.read_tempo_map,
  },
  ["query_state:project.read_track_item_overview"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.read_track_item_overview,
  },
  ["query_state:transport.read_state"] = {
    pack = "transport",
    handler = OPENREAPER_HANDLER_EXPORTS.read_transport_state,
  },
  ["query_state:openreaper.read_status"] = {
    pack = "core",
    handler = OPENREAPER_HANDLER_EXPORTS.read_openreaper_status,
  },
  ["query_state:template_catalog.read_summary"] = {
    pack = "core",
    handler = OPENREAPER_HANDLER_EXPORTS.read_template_catalog_summary,
  },
  ["query_state:last_result.read"] = {
    pack = "core",
    handler = OPENREAPER_HANDLER_EXPORTS.read_last_result,
  },
  ["query_state:track.resolve_ref"] = {
    pack = "tracks",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_track_ref,
  },
  ["query_state:tracks.list_tracks"] = {
    pack = "tracks",
    handler = OPENREAPER_HANDLER_EXPORTS.list_tracks,
  },
  ["query_state:tracks.read_mixer_controls"] = {
    pack = "tracks",
    handler = OPENREAPER_HANDLER_EXPORTS.read_mixer_controls,
  },
  ["query_state:tracks.read_folder_structure"] = {
    pack = "tracks",
    handler = OPENREAPER_HANDLER_EXPORTS.read_folder_structure,
  },
  ["query_state:items.resolve_item_ref"] = {
    pack = "items",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_item_ref,
  },
  ["query_state:items.read_item_summary"] = {
    pack = "items",
    handler = OPENREAPER_HANDLER_EXPORTS.read_item_summary,
  },
  ["query_state:items.list_selected_items"] = {
    pack = "items",
    handler = OPENREAPER_HANDLER_EXPORTS.d13_items_list_selected_items,
  },
  ["query_state:items.list_items_on_track"] = {
    pack = "items",
    handler = OPENREAPER_HANDLER_EXPORTS.d13_items_list_items_on_track,
  },
  ["query_state:system.runtime_environment.read"] = {
    pack = "system",
    handler = OPENREAPER_HANDLER_EXPORTS.read_runtime_environment,
  },
  ["query_state:system.resource_paths.read"] = {
    pack = "system",
    handler = OPENREAPER_HANDLER_EXPORTS.read_resource_paths,
  },
  ["query_state:system.api_symbols.check"] = {
    pack = "system",
    handler = OPENREAPER_HANDLER_EXPORTS.read_api_symbols,
  },
  ["query_state:actions.resolve_named_command"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_named_command,
  },
  ["query_state:actions.read_action_metadata"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.read_action_metadata,
  },
  ["query_state:actions.read_action_toggle_state"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.read_action_toggle_state,
  },
  ["query_state:actions.read_action_shortcuts"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.read_action_shortcuts,
  },
  ["query_state:actions.parse_marker_action_text"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.parse_marker_action_text,
  },
  ["query_state:actions.search_action_commands"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.search_action_commands,
  },
  ["query_state:fx.installed.search"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.search_installed_fx,
  },
  ["query_state:actions.read_custom_action_metadata"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.read_custom_action_metadata,
  },
  ["query_state:actions.read_cycle_action_metadata"] = {
    pack = "actions",
    handler = OPENREAPER_HANDLER_EXPORTS.read_cycle_action_metadata,
  },
  ["query_state:midi.resolve_midi_take_ref"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_midi_take_ref,
  },
  ["query_state:midi.read_take_event_counts"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.read_take_event_counts,
  },
  ["query_state:midi.list_take_notes"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.list_take_notes,
  },
  ["query_state:midi.list_take_cc_events"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.list_take_cc_events,
  },
  ["query_state:midi.list_take_text_sysex_events"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.list_take_text_sysex_events,
  },
  ["query_state:midi.read_take_grid"] = {
    pack = "midi",
    handler = OPENREAPER_HANDLER_EXPORTS.read_take_grid,
  },
  ["query_state:media.file.probe"] = {
    pack = "media",
    handler = OPENREAPER_HANDLER_EXPORTS.probe_media_file,
  },
  ["query_state:media.take_source.read"] = {
    pack = "media",
    handler = OPENREAPER_HANDLER_EXPORTS.read_take_source,
  },
  ["query_state:media.project_files.read"] = {
    pack = "media",
    handler = OPENREAPER_HANDLER_EXPORTS.read_project_media_files,
  },
  ["query_state:media.folder_media.list"] = {
    pack = "media",
    handler = OPENREAPER_HANDLER_EXPORTS.list_folder_media_files,
  },
  ["query_state:routing.track.read"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.read_track_routing,
  },
  ["query_state:routing.send.resolve_ref"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_send_ref,
  },
  ["query_state:routing.track_hardware_outputs.list"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.list_track_hardware_outputs,
  },
  ["query_state:routing.project_graph.read"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.read_project_routing_graph,
  },
  ["query_state:routing.audio_outputs.list"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.list_available_audio_outputs,
  },
  ["query_state:routing.fx_pin_mapping.read"] = {
    pack = "routing",
    handler = OPENREAPER_HANDLER_EXPORTS.read_fx_pin_mapping,
  },
  ["query_state:automation.resolve_envelope_ref"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_envelope_ref,
  },
  ["query_state:automation.read_envelope_summary"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.read_envelope_summary,
  },
  ["query_state:automation.read_envelope_points"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.read_envelope_points,
  },
  ["query_state:automation.evaluate_envelope_at_time"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.evaluate_envelope_at_time,
  },
  ["query_state:automation.read_track_automation_mode"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.read_track_automation_mode,
  },
  ["query_state:automation.read_automation_items"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.read_automation_items,
  },
  ["query_state:automation.resolve_send_envelope"] = {
    pack = "automation",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_send_envelope,
  },
  ["query_state:fx.resolve_ref"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_fx_ref,
  },
  ["query_state:fx.list_track_chain"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.list_track_fx_chain,
  },
  ["query_state:fx.list_take_chain"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.list_take_fx_chain,
  },
  ["query_state:fx.read_summary"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.read_fx_summary,
  },
  ["query_state:fx.list_parameters"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.list_fx_parameters,
  },
  ["query_state:fx.read_parameter"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.read_fx_parameter,
  },
  ["query_state:fx.parameter_to_envelope_mapping"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.parameter_to_envelope_mapping,
  },
  ["query_state:fx.read_video_processor_code"] = {
    pack = "fx",
    handler = OPENREAPER_HANDLER_EXPORTS.read_video_processor_code,
  },
  ["query_state:render.settings.read"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.read_render_settings,
  },
  ["query_state:render.bounds.resolve"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.resolve_render_bounds,
  },
  ["query_state:render.targets.preview"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.preview_render_targets,
  },
  ["query_state:render.region_matrix.read"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.read_region_render_matrix,
  },
  ["run_job:analysis.detect_loop_candidates"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.detect_loop_candidates,
  },
  ["run_job:analysis.measure_loop_click_risk"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.measure_loop_click_risk,
  },
  ["run_job:analysis.create_loop_qa_report"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.create_loop_qa_report,
  },
  ["run_job:analysis.measure_item_rms"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.measure_item_rms,
  },
  ["run_job:analysis.measure_item_peaks"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.measure_item_peaks,
  },
  ["run_job:analysis.detect_item_silence"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.detect_item_silence,
  },
  ["run_job:analysis.detect_item_transients"] = {
    pack = "analysis",
    handler = OPENREAPER_HANDLER_EXPORTS.detect_item_transients,
  },
  ["run_job:project.create_cleanup_report"] = {
    pack = "project",
    handler = OPENREAPER_HANDLER_EXPORTS.create_cleanup_report,
  },
  ["run_job:render.region_wav"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.render_region_wav,
  },
  ["run_job:render.delivery_report.create"] = {
    pack = "render",
    handler = OPENREAPER_HANDLER_EXPORTS.create_delivery_report,
  },
  ["run_job:items.create_layer_report"] = {
    pack = "items",
    handler = OPENREAPER_HANDLER_EXPORTS.create_layer_report,
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
    return bridge_error_envelope(request, "OPERATION_NOT_FOUND", "OpenReaper live bridge supports only the approved scoped live-smoke operations.", {
      recoverable = true,
      started_at = started_at,
      details = {
        operation_family = request.operation.family,
        operation_name = request.operation.name,
      },
    })
  end
  if operation.pack and operation.pack ~= request.pack.id then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Operation owner pack does not match the request pack.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_pack = operation.pack,
        actual_pack = request.pack.id,
      },
    })
  end

  open_required_undo_block(request, key)
  local ok, summary, handler_failure, artifacts, jobs, refs = pcall(operation.handler, request)
  close_required_undo_block(request, key)
  if not ok then
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Scoped live bridge handler failed.", {
      recoverable = false,
      started_at = started_at,
      details = {
        operation_name = request.operation.name,
        message = bounded_string(summary, 240),
      },
    })
  end
  if handler_failure then
    return bridge_error_envelope(request, handler_failure.code or "INTERNAL_ERROR", handler_failure.message or "Scoped live bridge handler failed.", {
      recoverable = handler_failure.recoverable ~= false,
      started_at = started_at,
      details = handler_failure.details or {},
    })
  end
  return bridge_ok_envelope(request, started_at, summary, artifacts, jobs, refs)
end

return dispatch_request
end)()
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
