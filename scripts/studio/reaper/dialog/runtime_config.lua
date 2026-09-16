local function module_paths()
  local entry = debug.getinfo(1, "S").source:match("^@(.+)$")
  local dir = entry:match("^(.*)/")
  local paths = dofile(dir .. "/paths.lua")
  return paths
end

local paths = module_paths()

local M = {}

function M.read_face_config()
  local file = io.open(paths.face_config_path(), "r")
  if not file then
    return {}
  end
  local content = file:read("*a")
  file:close()
  return {
    nodeCommand = content:match('"nodeCommand"%s*:%s*"([^"]+)"'),
    piBridgeScript = content:match('"piBridgeScript"%s*:%s*"([^"]+)"'),
    piMode = content:match('"piMode"%s*:%s*"([^"]+)"'),
  }
end

function M.consume_open_on_load_flag()
  local flag_path = paths.open_on_load_path()
  local file = io.open(flag_path, "r")
  if not file then
    return false
  end
  file:close()
  os.remove(flag_path)
  return true
end

return M
