-- Agent seam from REAPER face → Node CLI (studio-pi-send / studio-pi-commands).

local function module_paths()
  local entry = debug.getinfo(1, "S").source:match("^@(.+)$")
  local dir = entry:match("^(.*)/")
  return dofile(dir .. "/paths.lua")
end

local paths = module_paths()

local M = {}

local function json_escape(value)
  return (tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"')
    :gsub("\n", "\\n"):gsub("\r", "\\r"))
end

function M.build_request_json(message, chips)
  local parts = {}
  table.insert(parts, '{"contract":"openreaper.studio.prompt_request.v1","message":"')
  table.insert(parts, json_escape(message))
  table.insert(parts, '","chips":[')
  for i, chip in ipairs(chips) do
    if i > 1 then
      table.insert(parts, ",")
    end
    table.insert(
      parts,
      '{"kind":"'
        .. json_escape(chip.kind or "")
        .. '","label":"'
        .. json_escape(chip.label or "")
        .. '"}'
    )
  end
  table.insert(parts, "]}")
  return table.concat(parts)
end

function M.parse_response_text(output)
  if not output or output == "" then
    return nil
  end
  local text = output:match('"text"%s*:%s*"([^"]*)"')
  if text then
    return text:gsub("\\n", "\n"):gsub('\\"', '"')
  end
  return output
end

function M.parse_commands_payload(output)
  if not output or output == "" then
    return false, "Empty commands response."
  end
  local commands = {}
  for name, description in output:gmatch('"name"%s*:%s*"([^"]+)"[^}]*"description"%s*:%s*"([^"]*)"') do
    table.insert(commands, { name = name, description = description })
  end
  local message = output:match('"message"%s*:%s*"([^"]*)"')
  return true, { commands = commands, message = message }
end

function M.resolve_commands_cli(config)
  if config.piCommandsScript and config.piCommandsScript ~= "" then
    return config.piCommandsScript
  end
  if config.piBridgeScript and config.piBridgeScript ~= "" then
    return (config.piBridgeScript:gsub("studio%-pi%-send%.mjs$", "studio-pi-commands.mjs"))
  end
  return nil
end

function M.fetch_commands(config)
  local node = config.nodeCommand
  local commands_cli = M.resolve_commands_cli(config)
  if not node or not commands_cli then
    return false, "Agent seam not configured. Run studio-start."
  end
  local cmd = string.format("%q %q", node, commands_cli)
  local output = reaper.ExecProcess(cmd, 15000) or ""
  return M.parse_commands_payload(output)
end

function M.send_prompt(config, message, chips)
  local node = config.nodeCommand
  local bridge = config.piBridgeScript
  if not node or not bridge then
    return false, "Agent seam not configured. Run studio-start from the repo."
  end

  os.execute('mkdir -p "' .. paths.prompt_dir():gsub('"', '\\"') .. '"')
  local id = tostring(math.floor(reaper.time_precise() * 1000))
  local req = paths.prompt_dir() .. "/" .. id .. ".request.json"
  local file = io.open(req, "w")
  if not file then
    return false, "Could not write prompt request file."
  end
  file:write(M.build_request_json(message, chips))
  file:close()

  local cmd = string.format("%q %q %q", node, bridge, req)
  local output = reaper.ExecProcess(cmd, 120000) or ""
  local reply = M.parse_response_text(output)
  if reply then
    return true, reply
  end
  return true, output
end

return M
