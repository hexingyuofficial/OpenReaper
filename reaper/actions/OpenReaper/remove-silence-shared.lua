-- OpenReaper S3 Remove Silence Action shared orchestrator.
-- This file is deliberately independent of optional extensions and native
-- native dialog Actions. The REAPER-side batch capability owns analysis,
-- mutation, plan_hash, aggregate readback, and the required Undo boundary.

local ACTION_CONTRACT = "openreaper.action.s3_remove_silence.v1"
local BRIDGE_CONTRACT = "foundation.bridge.v1"
local CAPABILITY = "items.split_item_by_silence"
local TEMPLATE_ID = "template.items.split_item_by_silence"
local SETTINGS_SECTION = "OpenReaper"
local SETTINGS_KEY = "s3_remove_silence_settings_v1"
local PLAN_HASH_KEY = "s3_remove_silence_plan_hash_v1"
local RESULT_KEY = "s3_remove_silence_last_result_v1"
local TRANSPORT_ENV = "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"
local OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER"
local GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION"
local DEFAULT_TIMEOUT_MS = 29 * 1000
local POLL_INTERVAL_SECONDS = 0.10
local MAX_MESSAGE_BYTES = 2800

local JSON_ARRAY_MT = { __openreaper_json_array = true }
local function json_array(values)
  return setmetatable(values or {}, JSON_ARRAY_MT)
end

local function is_json_array(value)
  return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT
end

local function trim(value)
  return tostring(value or ""):gsub("^%s+", ""):gsub("%s+$", "")
end

local function bounded(value, maximum)
  local text = tostring(value or "")
  if #text <= maximum then return text end
  return text:sub(1, maximum - 3) .. "..."
end

local function finite_number(value)
  return type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge
end

local function show_message(title, message, buttons)
  if reaper and type(reaper.ShowMessageBox) == "function" then
    return reaper.ShowMessageBox(bounded(message, MAX_MESSAGE_BYTES), title, buttons or 0)
  end
  return 0
end

local function fail(title, message)
  show_message(title, "OpenReaper stopped without changing the project.\n\n" .. tostring(message), 0)
end

local function now_iso()
  return os.date("!%Y-%m-%dT%H:%M:%SZ")
end

local function monotonic_now()
  if reaper and type(reaper.time_precise) == "function" then
    return reaper.time_precise()
  end
  return os.clock()
end

local function path_join(base, child)
  local separator = base:find("\\", 1, true) and "\\" or "/"
  if base:sub(-1) == "/" or base:sub(-1) == "\\" then return base .. child end
  return base .. separator .. child
end

local function is_windows_runtime(path)
  if reaper and type(reaper.GetOS) == "function" then
    local ok, os_name = pcall(reaper.GetOS)
    if ok and type(os_name) == "string" then
      return os_name:match("^Win") ~= nil
    end
  end
  return type(path) == "string" and (path:match("^[A-Za-z]:[\\/]") or path:sub(1, 2) == "\\\\") ~= nil
end

local function write_file_atomic(file_path, content)
  local temporary = file_path .. ".tmp." .. tostring(math.floor(monotonic_now() * 1000))
  local handle = io.open(temporary, "wb")
  if not handle then return false, "temporary request file could not be opened" end
  local written, write_error = handle:write(content)
  handle:flush()
  handle:close()
  if not written then
    os.remove(temporary)
    return false, tostring(write_error or "request file write failed")
  end
  local renamed, rename_error = os.rename(temporary, file_path)
  if renamed then
    return true
  end
  if not is_windows_runtime(file_path) then
    os.remove(temporary)
    return false, tostring(rename_error or "request file rename failed")
  end
  local existing = io.open(file_path, "rb")
  if not existing then
    os.remove(temporary)
    return false, tostring(rename_error or "request file rename failed")
  end
  existing:close()

  -- Lua's Windows os.rename cannot replace an existing request file.
  local backup = file_path .. ".openreaper-replace." .. tostring(math.floor(monotonic_now() * 1000))
  local moved, backup_error = os.rename(file_path, backup)
  if not moved then
    os.remove(temporary)
    return false, "windows_existing_target_move_failed: " .. tostring(backup_error or rename_error or "rename_failed")
  end
  local published, publish_error = os.rename(temporary, file_path)
  if published then
    os.remove(backup)
    return true
  end
  local restore_error = nil
  local current = io.open(file_path, "rb")
  if current then
    current:close()
    if not os.remove(file_path) then restore_error = "new_target_remove_failed" end
  end
  if not restore_error then
    local restored, error_message = os.rename(backup, file_path)
    if not restored then restore_error = "old_target_restore_failed: " .. tostring(error_message or "rename_failed") end
  end
  os.remove(temporary)
  if restore_error then
    return false, "windows_replace_failed: " .. tostring(publish_error or rename_error or "rename_failed") .. "; " .. restore_error
  end
  return false, "windows_replace_failed: " .. tostring(publish_error or rename_error or "rename_failed")
end

local function read_file(file_path)
  local handle = io.open(file_path, "rb")
  if not handle then return nil end
  local content = handle:read("*a")
  handle:close()
  return content
end

local function escape_json_string(value)
  local escapes = {
    ["\\"] = "\\\\",
    ["\""] = "\\\"",
    ["\b"] = "\\b",
    ["\f"] = "\\f",
    ["\n"] = "\\n",
    ["\r"] = "\\r",
    ["\t"] = "\\t",
  }
  return '"' .. tostring(value):gsub('[%c\\"]', function(char)
    return escapes[char] or string.format("\\u%04x", char:byte())
  end) .. '"'
end

local function json_encode(value)
  local value_type = type(value)
  if value == nil then return "null" end
  if value_type == "string" then return escape_json_string(value) end
  if value_type == "boolean" then return value and "true" or "false" end
  if value_type == "number" then
    if not finite_number(value) then error("JSON cannot encode a non-finite number") end
    return tostring(value)
  end
  if value_type ~= "table" then error("JSON cannot encode " .. value_type) end
  local parts = {}
  if is_json_array(value) then
    for index = 1, #value do parts[#parts + 1] = json_encode(value[index]) end
    return "[" .. table.concat(parts, ",") .. "]"
  end
  local keys = {}
  for key in pairs(value) do
    if type(key) ~= "string" then error("JSON object keys must be strings") end
    keys[#keys + 1] = key
  end
  table.sort(keys)
  for _, key in ipairs(keys) do
    parts[#parts + 1] = escape_json_string(key) .. ":" .. json_encode(value[key])
  end
  return "{" .. table.concat(parts, ",") .. "}"
end

-- The stock REAPER Lua runtime has no JSON API. This parser handles the
-- foundation bridge JSON envelope without importing a third-party runtime.
local function json_decode(source)
  local position = 1
  local function error_at(message)
    error(message .. " at byte " .. tostring(position))
  end
  local function skip_whitespace()
    while position <= #source and source:sub(position, position):match("[%s]") do position = position + 1 end
  end
  local parse_value
  local function parse_string()
    if source:sub(position, position) ~= '"' then error_at("expected JSON string") end
    position = position + 1
    local parts = {}
    while position <= #source do
      local char = source:sub(position, position)
      if char == '"' then
        position = position + 1
        return table.concat(parts)
      end
      if char == "\\" then
        local escaped = source:sub(position + 1, position + 1)
        local replacements = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
        if replacements[escaped] ~= nil then
          parts[#parts + 1] = replacements[escaped]
          position = position + 2
        elseif escaped == "u" then
          local hex = source:sub(position + 2, position + 5)
          if not hex:match("^[0-9a-fA-F]{4}$") then error_at("invalid JSON unicode escape") end
          local codepoint = tonumber(hex, 16)
          if utf8 and utf8.char then parts[#parts + 1] = utf8.char(codepoint) else parts[#parts + 1] = "?" end
          position = position + 6
        else
          error_at("invalid JSON escape")
        end
      else
        if char:byte() < 32 then error_at("unescaped JSON control character") end
        parts[#parts + 1] = char
        position = position + 1
      end
    end
    error_at("unterminated JSON string")
  end
  local function parse_number()
    local start = position
    if source:sub(position, position) == "-" then position = position + 1 end
    if source:sub(position, position) == "0" then
      position = position + 1
    elseif source:sub(position, position):match("%d") then
      repeat position = position + 1 until not source:sub(position, position):match("%d")
    else
      error_at("invalid JSON number")
    end
    if source:sub(position, position) == "." then
      position = position + 1
      if not source:sub(position, position):match("%d") then error_at("invalid JSON fraction") end
      repeat position = position + 1 until not source:sub(position, position):match("%d")
    end
    local exponent = source:sub(position, position)
    if exponent == "e" or exponent == "E" then
      position = position + 1
      local sign = source:sub(position, position)
      if sign == "+" or sign == "-" then position = position + 1 end
      if not source:sub(position, position):match("%d") then error_at("invalid JSON exponent") end
      repeat position = position + 1 until not source:sub(position, position):match("%d")
    end
    local number = tonumber(source:sub(start, position - 1))
    if not finite_number(number) then error_at("invalid JSON number") end
    return number
  end
  local function parse_array()
    position = position + 1
    local values = json_array({})
    skip_whitespace()
    if source:sub(position, position) == "]" then position = position + 1; return values end
    while true do
      values[#values + 1] = parse_value()
      skip_whitespace()
      local separator = source:sub(position, position)
      if separator == "]" then position = position + 1; return values end
      if separator ~= "," then error_at("expected JSON array separator") end
      position = position + 1
      skip_whitespace()
    end
  end
  local function parse_object()
    position = position + 1
    local object = {}
    skip_whitespace()
    if source:sub(position, position) == "}" then position = position + 1; return object end
    while true do
      local key = parse_string()
      skip_whitespace()
      if source:sub(position, position) ~= ":" then error_at("expected JSON object colon") end
      position = position + 1
      object[key] = parse_value()
      skip_whitespace()
      local separator = source:sub(position, position)
      if separator == "}" then position = position + 1; return object end
      if separator ~= "," then error_at("expected JSON object separator") end
      position = position + 1
      skip_whitespace()
    end
  end
  function parse_value()
    skip_whitespace()
    local char = source:sub(position, position)
    if char == '"' then return parse_string() end
    if char == "{" then return parse_object() end
    if char == "[" then return parse_array() end
    if char == "-" or char:match("%d") then return parse_number() end
    if source:sub(position, position + 3) == "true" then position = position + 4; return true end
    if source:sub(position, position + 4) == "false" then position = position + 5; return false end
    if source:sub(position, position + 3) == "null" then position = position + 4; return nil end
    error_at("unexpected JSON value")
  end
  local value = parse_value()
  skip_whitespace()
  if position <= #source then error_at("unexpected trailing JSON") end
  return value
end

local function find_field(value, field, depth)
  if type(value) ~= "table" or (depth or 0) > 8 then return nil end
  if value[field] ~= nil then return value[field] end
  for _, child in pairs(value) do
    local found = find_field(child, field, (depth or 0) + 1)
    if found ~= nil then return found end
  end
  return nil
end

local function format_value(value)
  if value == nil then return "unavailable" end
  if type(value) == "boolean" then return value and "true" or "false" end
  if type(value) == "number" then return string.format("%.3f", value) end
  return bounded(value, 420)
end

local function parse_settings(value)
  local values = {}
  for token in tostring(value or ""):gmatch("([^|]+)") do values[#values + 1] = token end
  if values[1] == "v1" then table.remove(values, 1) end
  if #values ~= 8 then return nil, "saved settings are missing or from an incompatible version" end
  local settings = {
    threshold = tonumber(values[1]),
    min_silence = tonumber(values[2]),
    keep_before = tonumber(values[3]),
    keep_after = tonumber(values[4]),
    min_kept = tonumber(values[5]),
    fade = tonumber(values[6]),
    scope = trim(values[7]):lower(),
  }
  if values[8] ~= "remove_silence" then return nil, "saved settings operation is not remove_silence" end
  return settings
end

local function validate_settings(settings)
  local ranges = {
    { "threshold", -150, 0 },
    { "min_silence", 1, 60000 },
    { "keep_before", 0, 5000 },
    { "keep_after", 0, 5000 },
    { "min_kept", 0, 60000 },
    { "fade", 0, 1000 },
  }
  for _, range in ipairs(ranges) do
    local value = settings[range[1]]
    if not finite_number(value) or value < range[2] or value > range[3] then
      return false, range[1] .. " must be a finite value in [" .. range[2] .. ", " .. range[3] .. "]"
    end
  end
  local scopes = { all = true, leading = true, trailing = true, edges = true, internal = true }
  if not scopes[settings.scope] then return false, "scope must be all, leading, trailing, edges, or internal" end
  return true
end

local function settings_to_state(settings)
  return table.concat({
    "v1", tostring(settings.threshold), tostring(settings.min_silence), tostring(settings.keep_before),
    tostring(settings.keep_after), tostring(settings.min_kept), tostring(settings.fade), settings.scope, "remove_silence",
  }, "|")
end

local function load_saved_settings()
  local saved = reaper.GetExtState(SETTINGS_SECTION, SETTINGS_KEY)
  if saved == nil or saved == "" then return nil, "no saved Remove Silence settings exist" end
  local settings, parse_error = parse_settings(saved)
  if not settings then return nil, parse_error end
  local valid, validation_error = validate_settings(settings)
  if not valid then return nil, validation_error end
  return settings
end

local function collect_settings(existing)
  local defaults = existing or {
    threshold = -60,
    min_silence = 250,
    keep_before = 20,
    keep_after = 20,
    min_kept = 80,
    fade = 5,
    scope = "all",
  }
  local captions = "Threshold dBFS,Minimum silence ms,Keep before ms,Keep after ms,Minimum kept audio ms,Fade ms,Scope"
  local values = table.concat({
    tostring(defaults.threshold), tostring(defaults.min_silence), tostring(defaults.keep_before),
    tostring(defaults.keep_after), tostring(defaults.min_kept), tostring(defaults.fade), defaults.scope,
  }, ",")
  local accepted, returned = reaper.GetUserInputs("OpenReaper: Remove Silence...", 7, captions, values)
  if not accepted then return nil, "cancelled" end
  local fields = {}
  for token in tostring(returned or ""):gmatch("([^,]*)") do fields[#fields + 1] = trim(token) end
  if #fields ~= 7 then return nil, "REAPER returned an incomplete settings row" end
  local settings = {
    threshold = tonumber(fields[1]),
    min_silence = tonumber(fields[2]),
    keep_before = tonumber(fields[3]),
    keep_after = tonumber(fields[4]),
    min_kept = tonumber(fields[5]),
    fade = tonumber(fields[6]),
    scope = fields[7]:lower(),
  }
  local valid, validation_error = validate_settings(settings)
  if not valid then return nil, validation_error end
  return settings
end

local function bridge_identity()
  local transport = os.getenv(TRANSPORT_ENV)
  local owner = os.getenv(OWNER_ENV)
  local generation = tonumber(os.getenv(GENERATION_ENV) or "")
  if not transport or trim(transport) == "" then return nil, "OpenReaper live bridge transport is not configured" end
  if not owner or trim(owner) == "" then return nil, "OpenReaper bridge owner is not configured; refusing an unscoped Action" end
  if not finite_number(generation) or generation < 0 or generation ~= math.floor(generation) then
    return nil, "OpenReaper bridge generation is not configured; refusing a stale or unscoped Action"
  end
  return { transport = transport, owner = owner, generation = generation }
end

local function command_id()
  local millis = math.floor(monotonic_now() * 1000)
  local random = math.random(100000, 999999)
  return "cmd_openreaper_s3_silence_" .. tostring(millis) .. "_" .. tostring(random)
end

local function make_request(settings, dry_run, identity, preview_plan_hash)
  local id = command_id()
  local request = {
    contract = BRIDGE_CONTRACT,
    id = id,
    created_at = now_iso(),
    client = { id = "openreaper.reaper_action.s3", session_id = "reaper-action-s3-" .. id },
    bridge = { expected_owner = identity.owner, expected_generation = identity.generation },
    operation = { family = "run_command", name = "template.execute" },
    pack = { id = "items", capability = CAPABILITY, risk = "destructive" },
    params = {
      batch = true,
      operation = "remove_silence",
      target = "selected",
      target_refs = json_array({}),
      dry_run = dry_run,
      silence_threshold_dbfs = settings.threshold,
      min_silence_ms = settings.min_silence,
      silence_scope = settings.scope,
      keep_before_ms = settings.keep_before,
      keep_after_ms = settings.keep_after,
      min_kept_audio_ms = settings.min_kept,
      fade_ms = settings.fade,
      action_contract = ACTION_CONTRACT,
      template_id = TEMPLATE_ID,
    },
    refs = json_array({}),
    undo = { mode = "required", label = "OpenReaper: Remove Silence..." },
    verification = { mode = "required", checks = json_array({ "plan_hash", "aggregate_readback", "source_media_deleted", "undo_closed" }) },
    artifacts = { allow = false },
    budget = { max_response_bytes = 65536, max_items = 64, max_inline_value_bytes = 2048 },
    timeout_ms = DEFAULT_TIMEOUT_MS,
  }
  if preview_plan_hash then
    request.params.preview_plan_hash = preview_plan_hash
  end
  if not dry_run and preview_plan_hash then
    request.idempotency_key = "openreaper-s3-remove-silence:" .. preview_plan_hash
  end
  return request
end

local function extract_message(result)
  if result and result.error and result.error.message then return result.error.message end
  local summary = result and result.result and result.result.summary
  if type(summary) == "string" then return summary end
  return result and result.message or "The bridge returned no diagnostic message"
end

local function result_report(result, phase, fallback_plan_hash)
  local plan_hash = find_field(result, "plan_hash") or fallback_plan_hash
  local status = find_field(result, "status") or (result.ok and "completed" or "failed")
  local zero_write = find_field(result, "zero_write")
  local target_count = find_field(result, "target_count")
  local delete_count = find_field(result, "delete_count")
  local total_ms = find_field(result, "total_ms")
  local undo_closed = find_field(result, "undo_closed")
  return table.concat({
    "Phase: " .. phase,
    "Status: " .. format_value(status),
    "plan_hash: " .. format_value(plan_hash),
    "Targets: " .. format_value(target_count),
    "Deleted silence fragments: " .. format_value(delete_count),
    "zero_write: " .. format_value(zero_write),
    "total_ms: " .. format_value(total_ms),
    "undo_closed: " .. format_value(undo_closed),
    "source_media_deleted: " .. format_value(find_field(result, "source_media_deleted")),
  }, "\n")
end

local function poll_result(identity, request, callback)
  local result_path = path_join(path_join(identity.transport, "results"), request.id .. ".json")
  local deadline = monotonic_now() + (DEFAULT_TIMEOUT_MS / 1000)
  local function poll()
    local raw = read_file(result_path)
    if raw then
      local ok, decoded = pcall(json_decode, raw)
      if not ok then
        callback(nil, "Bridge result JSON was malformed; refusing to infer mutation truth")
        return
      end
      callback(decoded, nil)
      return
    end
    if monotonic_now() >= deadline then
      callback(nil, "Timed out waiting for the OpenReaper bridge result; project mutation outcome is unknown")
      return
    end
    reaper.defer(poll)
  end
  reaper.defer(poll)
end

local function dispatch(identity, request, callback)
  local requests_dir = path_join(identity.transport, "requests")
  local results_dir = path_join(identity.transport, "results")
  if not reaper or type(reaper.RecursiveCreateDirectory) ~= "function" then
    callback(nil, "REAPER RecursiveCreateDirectory is unavailable; bridge transport cannot be prepared")
    return
  end
  reaper.RecursiveCreateDirectory(requests_dir, 0)
  reaper.RecursiveCreateDirectory(results_dir, 0)
  local request_path = path_join(requests_dir, request.id .. ".json")
  local encoded
  local encode_ok, encode_error = pcall(function() encoded = json_encode(request) end)
  if not encode_ok then
    callback(nil, "Could not encode the approved foundation bridge request: " .. tostring(encode_error))
    return
  end
  local written, write_error = write_file_atomic(request_path, encoded .. "\n")
  if not written then
    callback(nil, write_error)
    return
  end
  poll_result(identity, request, callback)
end

local function run(options)
  options = options or {}
  local title = options.title or "OpenReaper: Remove Silence..."
  local identity, identity_error = bridge_identity()
  if not identity then
    fail(title, identity_error)
    return
  end

  local previous, previous_error = load_saved_settings()
  local settings
  if options.repeat_last == true then
    if not previous then
      fail(title, "Repeat requires valid saved settings. " .. tostring(previous_error))
      return
    end
    settings = previous
  else
    local collected, collect_error = collect_settings(previous)
    if not collected then
      if collect_error ~= "cancelled" then fail(title, collect_error) end
      return
    end
    settings = collected
  end
  reaper.SetExtState(SETTINGS_SECTION, SETTINGS_KEY, settings_to_state(settings), true)

  local preview = make_request(settings, true, identity)
  dispatch(identity, preview, function(preview_result, preview_error)
    if not preview_result then
      fail(title, preview_error)
      return
    end
    if preview_result.ok ~= true then
      fail(title, "Dry-run was rejected.\n\n" .. extract_message(preview_result) .. "\n\n" .. result_report(preview_result, "dry-run rejected"))
      return
    end
    local plan_hash = find_field(preview_result, "plan_hash")
    if type(plan_hash) ~= "string" or plan_hash == "" then
      fail(title, "Dry-run completed without a typed plan_hash; Apply is disabled")
      return
    end
    reaper.SetExtState(SETTINGS_SECTION, PLAN_HASH_KEY, plan_hash, true)
    local choice = show_message(title, result_report(preview_result, "dry-run preview", plan_hash) .. "\n\nApply (OK) or Cancel (Cancel).", 1)
    if choice ~= 1 then return end

    local apply = make_request(settings, false, identity, plan_hash)
    dispatch(identity, apply, function(apply_result, apply_error)
      if not apply_result then
        fail(title, apply_error)
        return
      end
      local applied_plan_hash = find_field(apply_result, "plan_hash")
      if type(applied_plan_hash) == "string" and applied_plan_hash ~= "" then
        reaper.SetExtState(SETTINGS_SECTION, PLAN_HASH_KEY, applied_plan_hash, true)
      end
      reaper.SetExtState(SETTINGS_SECTION, RESULT_KEY, result_report(apply_result, apply_result.ok and "applied" or "apply rejected", applied_plan_hash or plan_hash), true)
      if apply_result.ok ~= true then
        fail(title, "Apply was rejected.\n\n" .. extract_message(apply_result) .. "\n\n" .. result_report(apply_result, "apply rejected", plan_hash))
        return
      end
      show_message(title, result_report(apply_result, "applied", applied_plan_hash or plan_hash), 0)
    end)
  end)
end

return {
  run = run,
  capability = CAPABILITY,
  template_id = TEMPLATE_ID,
  plan_hash_field = "plan_hash",
}
