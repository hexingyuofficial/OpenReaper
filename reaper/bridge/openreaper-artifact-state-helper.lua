-- OpenReaper Layer 4.5C minimal artifact state helper.
-- Manual REAPER-side script: polls file transport requests and writes one
-- canonical artifact.state_store.v1 canary envelope to the configured root.

local CONTRACT = "foundation.bridge.v1"
local ARTIFACT_CONTRACT = "artifact.state_store.v1"
local TRANSPORT_ENV = "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
local ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT"
local OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER"
local GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION"
local DEFAULT_OWNER = "openreaper-artifact-state-smoke"
local DEFAULT_GENERATION = 1
local POLL_INTERVAL_SECONDS = 0.10
local SCRIPT_NAME = "openreaper-artifact-state-helper.lua"
local CANARY_OWNER_PACK = "core"
local CANARY_SCOPE = "live_artifact_smoke"
local CANARY_SCHEMA = "core.live_artifact_smoke.v1"
local CANARY_PRODUCER_ID = "template.core.live_artifact_smoke_canary"
local DEFAULT_BUDGET = {
  max_response_bytes = 65536,
  max_items = 50,
  max_inline_value_bytes = 2048,
}

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

local function path_separator(path_value)
  return type(path_value) == "string" and path_value:find("\\", 1, true) and "\\" or "/"
end

local function path_join(base, child)
  local separator = path_separator(base)
  if base:sub(-1) == "/" or base:sub(-1) == "\\" then
    return base .. child
  end
  return base .. separator .. child
end

local function file_exists(path_value)
  local handle = io.open(path_value, "rb")
  if handle then
    handle:close()
    return true
  end
  return false
end

local function read_file(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return nil, "open_failed"
  end
  local content = handle:read("*a")
  handle:close()
  return content
end

local function is_windows_runtime(path_value)
  if reaper and type(reaper.GetOS) == "function" then
    local ok, os_name = pcall(reaper.GetOS)
    if ok and type(os_name) == "string" then
      return os_name:match("^Win") ~= nil
    end
  end
  return type(path_value) == "string" and (path_value:match("^[A-Za-z]:[\\/]") or path_value:sub(1, 2) == "\\\\") ~= nil
end

local function write_file_atomic(path_value, content)
  local temp_path = path_value .. ".tmp." .. tostring(math.floor((os.time() or 0))) .. "." .. tostring(math.random(100000, 999999))
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
  local renamed, rename_error = os.rename(temp_path, path_value)
  if renamed then
    return true
  end
  if not is_windows_runtime(path_value) or not file_exists(path_value) then
    os.remove(temp_path)
    return false, tostring(rename_error or "rename_failed")
  end

  -- Lua's Windows os.rename cannot replace an existing file. Move the old
  -- target aside, publish the complete temp file, and restore on failure.
  local backup_path = path_value .. ".openreaper-replace." .. tostring(math.floor((os.time() or 0))) .. "." .. tostring(math.random(100000, 999999))
  local moved, backup_error = os.rename(path_value, backup_path)
  if not moved then
    os.remove(temp_path)
    return false, "windows_existing_target_move_failed: " .. tostring(backup_error or rename_error or "rename_failed")
  end

  local published, publish_error = os.rename(temp_path, path_value)
  if published then
    os.remove(backup_path)
    return true
  end

  local restore_error = nil
  if file_exists(path_value) and not os.remove(path_value) then
    restore_error = "new_target_remove_failed"
  else
    local restored, error_message = os.rename(backup_path, path_value)
    if not restored then
      restore_error = "old_target_restore_failed: " .. tostring(error_message or "rename_failed")
    end
  end
  os.remove(temp_path)
  if restore_error then
    return false, "windows_replace_failed: " .. tostring(publish_error or rename_error or "rename_failed") .. "; " .. restore_error
  end
  return false, "windows_replace_failed: " .. tostring(publish_error or rename_error or "rename_failed")
end

local function log(message)
  if reaper and type(reaper.ShowConsoleMsg) == "function" then
    reaper.ShowConsoleMsg("[OpenReaper artifact helper] " .. tostring(message) .. "\n")
  end
end

local function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then
    return false
  end
  return pcall(reaper[name], ...)
end

local function ensure_directory(path_value)
  local ok = call_reaper("RecursiveCreateDirectory", path_value, 0)
  if ok then
    return true
  end
  return false, "recursive_create_directory_unavailable"
end

local function is_object(value)
  return type(value) == "table" and value ~= JSON_NULL and not is_json_array(value)
end

local function object_keys_allowed(value, allowed)
  for key in pairs(value or {}) do
    if not allowed[key] then
      return false, key
    end
  end
  return true
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

local function is_absolute_path(value)
  if type(value) ~= "string" then
    return false
  end
  if value:match("^[A-Za-z]:[\\/]") then
    return false
  end
  return value:sub(1, 1) == "/"
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

local function valid_lower_snake(value)
  return type(value) == "string" and value:match("^[a-z][a-z0-9_]*$") ~= nil
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
  if #segments < 3 then
    return false
  end
  if not segments[#segments]:match("^v%d+$") then
    return false
  end
  for index = 1, #segments - 1 do
    if not valid_lower_snake(segments[index]) then
      return false
    end
  end
  return true
end

local function is_leap_year(year)
  return (year % 4 == 0 and year % 100 ~= 0) or year % 400 == 0
end

local function days_in_month(year, month)
  if month == 2 then
    return is_leap_year(year) and 29 or 28
  end
  if month == 4 or month == 6 or month == 9 or month == 11 then
    return 30
  end
  return 31
end

local function validate_created_at(created_at)
  if type(created_at) ~= "string" then
    return false
  end
  local year, month, day, hour, minute, second, millisecond = created_at:match("^(%d%d%d%d)%-(%d%d)%-(%d%d)T(%d%d):(%d%d):(%d%d)%.(%d%d%d)Z$")
  if not year then
    return false
  end
  year = tonumber(year)
  month = tonumber(month)
  day = tonumber(day)
  hour = tonumber(hour)
  minute = tonumber(minute)
  second = tonumber(second)
  millisecond = tonumber(millisecond)
  if month < 1 or month > 12 then
    return false
  end
  if day < 1 or day > days_in_month(year, month) then
    return false
  end
  if hour > 23 or minute > 59 or second > 59 or millisecond > 999 then
    return false
  end
  return true
end

local function validate_producer(producer, owner_pack)
  if not is_object(producer) then
    return false, "producer must be an object."
  end
  local producer_fields_ok, producer_field = object_keys_allowed(producer, {
    kind = true,
    id = true,
    pack = true,
  })
  if not producer_fields_ok then
    return false, "producer contains an unsupported field: " .. tostring(producer_field)
  end
  if producer.kind ~= "template" or producer.pack ~= owner_pack then
    return false, "producer.kind and producer.pack must match the artifact owner."
  end
  local prefix = "template." .. owner_pack .. "."
  if type(producer.id) ~= "string" or producer.id:sub(1, #prefix) ~= prefix then
    return false, "producer.id must match template.<pack>.<lower_snake_segments>."
  end
  local rest = producer.id:sub(#prefix + 1)
  if rest:sub(1, 1) == "." or rest:sub(-1) == "." then
    return false, "producer.id must match template.<pack>.<lower_snake_segments>."
  end
  local segment_count = 0
  for segment in rest:gmatch("[^.]+") do
    segment_count = segment_count + 1
    if not valid_lower_snake(segment) then
      return false, "producer.id must match template.<pack>.<lower_snake_segments>."
    end
  end
  if segment_count < 1 or segment_count > 4 or rest:find("..", 1, true) then
    return false, "producer.id must match template.<pack>.<lower_snake_segments>."
  end
  if #json.encode(producer) > 1024 then
    return false, "producer exceeds 1024 bytes."
  end
  return true
end

local function validate_canary_identity(parts, params)
  if parts.owner_pack ~= CANARY_OWNER_PACK or parts.scope ~= CANARY_SCOPE then
    return false, "Layer 4.5C helper accepts only core live_artifact_smoke canary refs."
  end
  if params.schema ~= CANARY_SCHEMA then
    return false, "Layer 4.5C helper accepts only the core live artifact smoke schema."
  end
  if not is_object(params.producer)
    or params.producer.kind ~= "template"
    or params.producer.pack ~= CANARY_OWNER_PACK
    or params.producer.id ~= CANARY_PRODUCER_ID then
    return false, "Layer 4.5C helper accepts only the live artifact smoke canary producer."
  end
  if not is_object(params.summary)
    or params.summary.contract ~= ARTIFACT_CONTRACT
    or params.summary.helper_only ~= true
    or params.summary.proves ~= "artifact_helper_write_readback_only" then
    return false, "Layer 4.5C helper accepts only the live artifact smoke canary summary."
  end
  if not is_object(params.payload)
    or params.payload.fixture ~= "layer4_5c_artifact_helper"
    or params.payload.readback_required ~= true then
    return false, "Layer 4.5C helper accepts only the live artifact smoke canary payload."
  end
  return true
end

local function contains_public_artifact_last_result_ref(value, seen)
  if value == JSON_NULL or value == nil then
    return false
  end
  if type(value) == "string" then
    return value:find("last_result:artifact:%d+") ~= nil
  end
  if type(value) ~= "table" then
    return false
  end
  seen = seen or {}
  if seen[value] then
    return false
  end
  seen[value] = true
  if is_json_array(value) then
    for index = 1, #value do
      if contains_public_artifact_last_result_ref(value[index], seen) then
        return true
      end
    end
  else
    for key, nested in pairs(value) do
      if type(key) == "string" and key:find("last_result:artifact:%d+") then
        return true
      end
      if contains_public_artifact_last_result_ref(nested, seen) then
        return true
      end
    end
  end
  seen[value] = nil
  return false
end

local function json_value_valid(value, seen)
  if value == JSON_NULL or value == nil then
    return true
  end
  local value_type = type(value)
  if value_type == "string" or value_type == "boolean" then
    return true
  end
  if value_type == "number" then
    return is_finite_number(value)
  end
  if value_type ~= "table" then
    return false
  end
  seen = seen or {}
  if seen[value] then
    return false
  end
  seen[value] = true
  if is_json_array(value) then
    for index = 1, #value do
      if not json_value_valid(value[index], seen) then
        return false
      end
    end
  else
    for key, nested in pairs(value) do
      if type(key) ~= "string" or key == "" or not json_value_valid(nested, seen) then
        return false
      end
    end
  end
  seen[value] = nil
  return true
end

local function validate_json_object(value, label, max_bytes)
  if not is_object(value) then
    return false, label .. " must be a JSON object."
  end
  if not json_value_valid(value) then
    return false, label .. " must contain only JSON values."
  end
  if contains_public_artifact_last_result_ref(value) then
    return false, label .. " contains forbidden public last_result:artifact:N refs."
  end
  if #json.encode(value) > max_bytes then
    return false, label .. " exceeds " .. tostring(max_bytes) .. " bytes."
  end
  return true
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
  return {
    mode = is_string(undo.mode) and undo.mode or "none",
    opened = false,
    closed = false,
    label = JSON_NULL,
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

local function idempotency_result()
  return {
    key = JSON_NULL,
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
    idempotency = idempotency_result(),
  }
  return finalize_json_with_budget(envelope)
end

local function bridge_ok_envelope(request, started_at, summary, artifact_ref)
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
      artifacts = json_array({ artifact_ref }),
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
    idempotency = idempotency_result(),
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
  if not validate_created_at(request.created_at) then
    return false, "created_at must be an ISO-8601 UTC millisecond timestamp."
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
  if not is_object(request.operation)
    or request.operation.family ~= "artifact_metadata"
    or request.operation.name ~= "artifact_state_store.write_canary" then
    return false, "Layer 4.5C helper accepts only artifact_state_store.write_canary."
  end
  if not is_object(request.pack)
    or request.pack.id ~= "core"
    or request.pack.capability ~= "artifact_state_store.write_canary"
    or request.pack.risk ~= "read" then
    return false, "Layer 4.5C helper requires core artifact_state_store.write_canary read pack."
  end
  if not is_object(request.params) then
    return false, "params must be a JSON object."
  end
  local params_fields_ok, params_field = object_keys_allowed(request.params, {
    artifact_ref = true,
    schema = true,
    producer = true,
    summary = true,
    payload = true,
  })
  if not params_fields_ok then
    return false, "params contains an unsupported field: " .. tostring(params_field)
  end
  if not is_json_array(request.refs) then
    return false, "refs must be a JSON array."
  end
  if not is_object(request.undo) or request.undo.mode ~= "none" then
    return false, "artifact helper canary requests must use undo.mode none."
  end
  if not is_object(request.verification) or not is_string(request.verification.mode) then
    return false, "verification.mode is required."
  end
  if request.verification.checks ~= nil and request.verification.checks ~= JSON_NULL and not is_json_array(request.verification.checks) then
    return false, "verification.checks must be a JSON array."
  end
  if not is_object(request.artifacts) or request.artifacts.allow ~= true then
    return false, "Layer 4.5C helper requires artifacts.allow true."
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
    return false, "artifact helper canary requests must not carry idempotency_key."
  end
  return true
end

local function write_artifact_canary(request, started_at)
  if not ARTIFACT_ROOT then
    return bridge_error_envelope(request, "ARTIFACT_INVALID", "Layer 4.5C artifact root is not configured.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "artifact_root_not_configured",
        artifact_root_env = ARTIFACT_ROOT_ENV,
        helper_default_enabled = false,
      },
    })
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return bridge_error_envelope(request, "ARTIFACT_INVALID", "Layer 4.5C artifact root must be an absolute filesystem path.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "artifact_root_invalid",
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    })
  end

  local params = request.params
  local parts, ref_error = parse_artifact_ref(params.artifact_ref)
  if not parts then
    return bridge_error_envelope(request, "PARAMS_INVALID", ref_error, {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "artifact_ref",
      },
    })
  end
  local canary_ok, canary_error = validate_canary_identity(parts, params)
  if not canary_ok then
    return bridge_error_envelope(request, "PARAMS_INVALID", canary_error, {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "artifact_ref",
        expected_owner_pack = CANARY_OWNER_PACK,
        expected_scope = CANARY_SCOPE,
        expected_schema = CANARY_SCHEMA,
        expected_producer_id = CANARY_PRODUCER_ID,
      },
    })
  end
  if not validate_schema(params.schema) then
    return bridge_error_envelope(request, "PARAMS_INVALID", "Artifact schema must use dotted lower-snake grammar with a vN suffix.", {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "schema",
      },
    })
  end
  local producer_ok, producer_error = validate_producer(params.producer, parts.owner_pack)
  if not producer_ok then
    return bridge_error_envelope(request, "PARAMS_INVALID", producer_error, {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "producer",
      },
    })
  end
  local summary_ok, summary_error = validate_json_object(params.summary, "summary", 2048)
  if not summary_ok then
    return bridge_error_envelope(request, "PARAMS_INVALID", summary_error, {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "summary",
      },
    })
  end
  local payload_ok, payload_error = validate_json_object(params.payload, "payload", 65536)
  if not payload_ok then
    return bridge_error_envelope(request, "PARAMS_INVALID", payload_error, {
      recoverable = true,
      started_at = started_at,
      details = {
        field = "payload",
      },
    })
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return bridge_error_envelope(request, "ARTIFACT_INVALID", "Artifact helper could not create artifact directory.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    })
  end

  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = parts.ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = params.schema,
    producer = params.producer,
    created_at = request.created_at,
    summary = params.summary,
    payload = params.payload,
  }
  local encoded = json.encode(envelope)
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return bridge_error_envelope(request, "ARTIFACT_INVALID", "Artifact helper could not write the canonical artifact envelope.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    })
  end

  local artifact_ref = artifact_object_ref(parts, params.schema)
  return bridge_ok_envelope(request, started_at, {
    kind = "artifact_state_store_live_canary",
    contract = ARTIFACT_CONTRACT,
    artifact_ref = parts.ref,
    schema = params.schema,
    artifact_path_layout = "owner_pack/scope/id.json",
    helper_only = true,
    template_live_pass_proven = false,
    render_analysis_report_templates_proven = false,
    bytes = #encoded + 1,
  }, artifact_ref)
end

local TRANSPORT_DIR = non_empty(os.getenv(TRANSPORT_ENV))
local REQUESTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "requests") or nil
local RESULTS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "results") or nil

local function dispatch_request(request, fallback_id)
  local started_at = now_iso()
  local valid, validation_error = validate_request(request)
  if not valid then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Bridge request failed validation.", {
      fallback_id = fallback_id,
      recoverable = true,
      started_at = started_at,
      details = {
        reason = validation_error,
      },
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
  return write_artifact_canary(request, started_at)
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

if not TRANSPORT_DIR then
  log("transport not configured; set " .. TRANSPORT_ENV)
elseif not ARTIFACT_ROOT then
  log("artifact root not configured; set " .. ARTIFACT_ROOT_ENV)
else
  log(SCRIPT_NAME .. " started; transport=" .. TRANSPORT_DIR)
end

if reaper and type(reaper.defer) == "function" then
  reaper.defer(bridge_loop)
end
