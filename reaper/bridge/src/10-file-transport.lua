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

