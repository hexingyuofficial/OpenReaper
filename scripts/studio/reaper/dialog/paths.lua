-- Studio runtime paths (read by all dialog modules).

local M = {}

function M.home_dir()
  return os.getenv("HOME") or ""
end

function M.studio_dir()
  return M.home_dir() .. "/.openreaper/studio"
end

function M.face_config_path()
  return M.studio_dir() .. "/face-config-v1.json"
end

function M.open_on_load_path()
  return M.studio_dir() .. "/open-face-on-load"
end

function M.prompt_dir()
  return M.studio_dir() .. "/prompts"
end

function M.module_dir(entry_script_path)
  local dir = entry_script_path:match("^(.*)/[^/]+$")
  if not dir then
    return nil
  end
  return dir .. "/studio/dialog"
end

return M
