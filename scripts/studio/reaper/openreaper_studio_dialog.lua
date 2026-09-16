-- OpenReaper Studio — dialog entry (installed to REAPER Scripts/OpenReaper/).
-- Modules live alongside under studio/dialog/ (copied by studio-start).

if not reaper then
  return
end

local function script_dir()
  local info = debug.getinfo(1, "S")
  local source = info.source or ""
  local path = source:match("^@(.+)$")
  if not path then
    return nil
  end
  return path:match("^(.*)/")
end

local dir = script_dir()
if not dir then
  reaper.ShowConsoleMsg("[OpenReaper Studio] Could not resolve script directory.\n")
  return
end

local bootstrap = dofile(dir .. "/studio/dialog/bootstrap.lua")
local ok, err = bootstrap.start()
if not ok then
  reaper.ShowConsoleMsg("[OpenReaper Studio] " .. tostring(err) .. "\n")
  if reaper.MB then
    reaper.MB(
      "OpenReaper Studio needs ReaImGui for the AI dialog.\n\nInstall ReaImGui (ReaPack), then run studio-start again.",
      "OpenReaper Studio",
      0
    )
  end
end
