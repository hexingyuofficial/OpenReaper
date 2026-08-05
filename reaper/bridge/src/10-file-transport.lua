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
local CLAIMS_DIR = TRANSPORT_DIR and path_join(TRANSPORT_DIR, "claims") or nil
local HEARTBEAT_CONTRACT = "openreaper.bridge_liveness.v1"
local HEARTBEAT_FILENAME = "openreaper-bridge-liveness-v1.json"
local HEARTBEAT_PATH = TRANSPORT_DIR and path_join(TRANSPORT_DIR, HEARTBEAT_FILENAME) or nil
local HEARTBEAT_INTERVAL_SECONDS = 0.50
local HEARTBEAT_INTERVAL_MS = 500
local HEARTBEAT_SEQUENCE_MAX = 999999999
local heartbeat_sequence = 0

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

local function is_windows_runtime(path)
  if reaper and type(reaper.GetOS) == "function" then
    local ok, os_name = pcall(reaper.GetOS)
    if ok and type(os_name) == "string" then
      return os_name:match("^Win") ~= nil
    end
  end
  return type(path) == "string" and (path:match("^[A-Za-z]:[\\/]") or path:sub(1, 2) == "\\\\") ~= nil
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
  if renamed then
    return true
  end
  if not is_windows_runtime(path) or not file_exists(path) then
    os.remove(temp_path)
    return false, tostring(rename_error or "rename_failed")
  end

  -- Lua's Windows os.rename cannot replace an existing file. Move the old
  -- target aside, place the complete temp file, and restore on failure.
  local backup_path = path .. ".openreaper-replace." .. tostring(math.floor((os.time() or 0))) .. "." .. tostring(math.random(100000, 999999))
  local moved, backup_error = os.rename(path, backup_path)
  if not moved then
    os.remove(temp_path)
    return false, "windows_existing_target_move_failed: " .. tostring(backup_error or rename_error or "rename_failed")
  end

  local replaced, replace_error = os.rename(temp_path, path)
  if replaced then
    os.remove(backup_path)
    return true
  end

  local restore_error = nil
  if file_exists(path) and not os.remove(path) then
    restore_error = "new_target_remove_failed"
  else
    local restored, error_message = os.rename(backup_path, path)
    if not restored then
      restore_error = "old_target_restore_failed: " .. tostring(error_message or "rename_failed")
    end
  end
  os.remove(temp_path)
  if restore_error then
    return false, "windows_replace_failed: " .. tostring(replace_error or rename_error or "rename_failed") .. "; " .. restore_error
  end
  return false, "windows_replace_failed: " .. tostring(replace_error or rename_error or "rename_failed")
end

local function write_bridge_heartbeat()
  if not HEARTBEAT_PATH then
    return false, "heartbeat_path_unavailable"
  end
  heartbeat_sequence = heartbeat_sequence + 1
  if heartbeat_sequence > HEARTBEAT_SEQUENCE_MAX then
    heartbeat_sequence = 1
  end
  local heartbeat = {
    contract = HEARTBEAT_CONTRACT,
    active_owner = ACTIVE_OWNER,
    active_generation = ACTIVE_GENERATION,
    sequence = heartbeat_sequence,
    refreshed_at_unix_s = math.floor(os.time() or 0),
    interval_ms = HEARTBEAT_INTERVAL_MS,
  }
  return write_file_atomic(HEARTBEAT_PATH, json.encode(heartbeat) .. "\n")
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
  if type(value) ~= "string" or value == "" then
    return false
  end
  if value:sub(1, 1) == "/" then
    return true
  end
  if value:match("^%a:[/\\]") then
    return true
  end
  return value:match("^\\\\[^\\/]+[/\\][^\\/]+") ~= nil
end
