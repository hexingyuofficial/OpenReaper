-- OpenReaper Studio — AI dialog MVP (Day 4–5).
-- Floating ReaImGui face: context chips, input, Send toward Pi/MCP bridge.

if not reaper then
  return
end

if not reaper.ImGui_CreateContext then
  reaper.ShowConsoleMsg(
    "[OpenReaper Studio] ReaImGui is required for the Studio dialog. " ..
    "Install ReaImGui via ReaPack, then run Studio Start again.\n"
  )
  if reaper.MB then
    reaper.MB(
      "OpenReaper Studio needs ReaImGui for the AI dialog.\n\n" ..
      "Install ReaImGui (ReaPack), then run studio-start again.",
      "OpenReaper Studio",
      0
    )
  end
  return
end

if OpenReaperStudioDialog and OpenReaperStudioDialog.running then
  OpenReaperStudioDialog.focus = true
  return
end

local HOME = os.getenv("HOME") or ""
local STUDIO_DIR = HOME .. "/.openreaper/studio"
local FACE_CONFIG_PATH = STUDIO_DIR .. "/face-config-v1.json"
local OPEN_ON_LOAD_PATH = STUDIO_DIR .. "/open-face-on-load"
local PROMPT_DIR = STUDIO_DIR .. "/prompts"

local M = {
  running = true,
  focus = false,
  ctx = reaper.ImGui_CreateContext("OpenReaper Studio"),
  open = true,
  input = "",
  chips = {},
  status = "",
  last_reply = "",
  show_attach_menu = false,
  config = {},
}

OpenReaperStudioDialog = M

local function json_escape(value)
  return (tostring(value):gsub("\\", "\\\\"):gsub('"', '\\"')
    :gsub("\n", "\\n"):gsub("\r", "\\r"))
end

local function read_face_config()
  local file = io.open(FACE_CONFIG_PATH, "r")
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

local function consume_open_on_load_flag()
  local file = io.open(OPEN_ON_LOAD_PATH, "r")
  if not file then
    return false
  end
  file:close()
  os.remove(OPEN_ON_LOAD_PATH)
  return true
end

local function format_time(seconds)
  return string.format("%.2fs", seconds)
end

local function attach_time_selection()
  local start_pos, end_pos = reaper.GetSet_LoopTimeRange2(false, true, 0, 0, false)
  if end_pos <= start_pos then
    M.status = "No time selection — drag a range on the timeline first."
    return
  end
  table.insert(M.chips, {
    kind = "time",
    label = string.format("Time %s–%s", format_time(start_pos), format_time(end_pos)),
    data = { start = start_pos, ["end"] = end_pos },
  })
  M.status = ""
end

local function attach_track()
  local track = reaper.GetSelectedTrack(0, 0)
  if not track then
    M.status = "No track selected."
    return
  end
  local _, name = reaper.GetTrackName(track)
  local number = math.floor(reaper.GetMediaTrackInfo_Value(track, "IP_TRACKNUMBER"))
  table.insert(M.chips, {
    kind = "track",
    label = string.format("Track %d: %s", number, name ~= "" and name or "(unnamed)"),
    data = { guid = reaper.GetTrackGUID(track), number = number, name = name },
  })
  M.status = ""
end

local function attach_item()
  local item = reaper.GetSelectedMediaItem(0, 0)
  if not item then
    M.status = "No media item selected."
    return
  end
  local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
  local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
  local take = reaper.GetActiveTake(item)
  local take_name = take and reaper.GetTakeName(take) or "take"
  table.insert(M.chips, {
    kind = "item",
    label = string.format("Item %s @ %s", take_name, format_time(pos)),
    data = { position = pos, length = len, take_name = take_name },
  })
  M.status = ""
end

local function attach_region_at_playhead()
  local play_pos = reaper.GetPlayPosition()
  local count = reaper.CountProjectMarkers(0)
  for i = 0, count - 1 do
    local _, is_region, start_pos, end_pos, name, index = reaper.EnumProjectMarkers(0, i)
    if is_region and play_pos >= start_pos and play_pos <= end_pos then
      table.insert(M.chips, {
        kind = "region",
        label = string.format("Region %d: %s", index, name ~= "" and name or "(unnamed)"),
        data = { index = index, start = start_pos, ["end"] = end_pos, name = name },
      })
      M.status = ""
      return
    end
  end
  M.status = "Playhead is not inside a region."
end

local function attach_marker_at_playhead()
  local play_pos = reaper.GetPlayPosition()
  local count = reaper.CountProjectMarkers(0)
  local best_idx = -1
  local best_dist = math.huge
  local best_name = ""
  local best_pos = 0.0
  for i = 0, count - 1 do
    local _, is_region, pos, _, name, index = reaper.EnumProjectMarkers(0, i)
    if not is_region then
      local dist = math.abs(pos - play_pos)
      if dist < best_dist then
        best_dist = dist
        best_idx = index
        best_name = name
        best_pos = pos
      end
    end
  end
  if best_idx < 0 then
    M.status = "No project markers found."
    return
  end
  table.insert(M.chips, {
    kind = "marker",
    label = string.format("Marker %d: %s @ %s", best_idx, best_name ~= "" and best_name or "(unnamed)", format_time(best_pos)),
    data = { index = best_idx, position = best_pos, name = best_name },
  })
  M.status = ""
end

local function build_request_json(message, chips)
  local parts = {}
  table.insert(parts, '{"message":"' .. json_escape(message) .. '","chips":[')
  for i, chip in ipairs(chips) do
    if i > 1 then
      table.insert(parts, ",")
    end
    table.insert(parts, '{"kind":"' .. json_escape(chip.kind or "") .. '","label":"' .. json_escape(chip.label or "") .. '"}')
  end
  table.insert(parts, "]}")
  return table.concat(parts)
end

local function parse_response_text(output)
  if not output or output == "" then
    return nil
  end
  local text = output:match('"text"%s*:%s*"([^"]*)"')
  if text then
    return text:gsub("\\n", "\n"):gsub('\\"', '"')
  end
  return output
end

local function send_prompt()
  local message = M.input:match("^%s*(.-)%s*$")
  if message == "" then
    M.status = "Type a message before Send."
    return
  end
  local node = M.config.nodeCommand
  local bridge = M.config.piBridgeScript
  if not node or not bridge then
    M.status = "Pi bridge is not configured. Run studio-start from the repo."
    return
  end
  os.execute('mkdir -p "' .. PROMPT_DIR:gsub('"', '\\"') .. '"')
  local id = tostring(math.floor(reaper.time_precise() * 1000))
  local req = PROMPT_DIR .. "/" .. id .. ".request.json"
  local file = io.open(req, "w")
  if not file then
    M.status = "Could not write prompt request file."
    return
  end
  file:write(build_request_json(message, M.chips))
  file:close()

  M.status = "Sending…"
  local cmd = string.format("%q %q %q", node, bridge, req)
  local output = reaper.ExecProcess(cmd, 30000) or ""
  local reply = parse_response_text(output)
  if reply then
    M.last_reply = reply
    M.status = "Sent."
    M.input = ""
  else
    M.status = "Send finished (check mock reply in console)."
    M.last_reply = output
  end
end

local function draw_chips(ctx)
  if #M.chips == 0 then
    return
  end
  for index, chip in ipairs(M.chips) do
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), 0x2A2A35FF)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), 0x3A3A48FF)
    reaper.ImGui_Button(ctx, chip.label .. "##chip" .. tostring(index))
    reaper.ImGui_PopStyleColor(ctx, 2)
    reaper.ImGui_SameLine(ctx)
    if reaper.ImGui_SmallButton(ctx, "x##dismiss" .. tostring(index)) then
      table.remove(M.chips, index)
    end
    reaper.ImGui_SameLine(ctx)
  end
  reaper.ImGui_NewLine(ctx)
end

local function draw_attach_menu(ctx)
  if reaper.ImGui_Button(ctx, "+") then
    reaper.ImGui_OpenPopup(ctx, "studio_attach_ctx")
  end
  if reaper.ImGui_BeginPopup(ctx, "studio_attach_ctx") then
    if reaper.ImGui_Selectable(ctx, "Time selection") then
      attach_time_selection()
    end
    if reaper.ImGui_Selectable(ctx, "Track") then
      attach_track()
    end
    if reaper.ImGui_Selectable(ctx, "Item") then
      attach_item()
    end
    if reaper.ImGui_Selectable(ctx, "Region at playhead") then
      attach_region_at_playhead()
    end
    if reaper.ImGui_Selectable(ctx, "Marker near playhead") then
      attach_marker_at_playhead()
    end
    reaper.ImGui_EndPopup(ctx)
  end
end

local function draw_dialog()
  local ctx = M.ctx
  if not ctx then
    return
  end

  local viewport = reaper.ImGui_GetMainViewport(ctx)
  local vx, vy = reaper.ImGui_Viewport_GetPos(viewport)
  local vw, vh = reaper.ImGui_Viewport_GetSize(viewport)
  local win_w = math.min(720, math.max(420, vw * 0.62))
  local win_h = 132
  reaper.ImGui_SetNextWindowPos(ctx, vx + (vw - win_w) * 0.5, vy + vh - win_h - 48, reaper.ImGui_Cond_Always())
  reaper.ImGui_SetNextWindowSize(ctx, win_w, win_h, reaper.ImGui_Cond_Always())

  local flags = reaper.ImGui_WindowFlags_NoCollapse() | reaper.ImGui_WindowFlags_NoScrollbar()
  local visible, open = reaper.ImGui_Begin(ctx, "OpenReaper Studio", true, flags)
  M.open = open
  if visible then
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_WindowBg(), 0x121218F0)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_FrameBg(), 0x1E1E28FF)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), 0xF2F2F8FF)

    reaper.ImGui_Text(ctx, "Ask OpenReaper")
    reaper.ImGui_Separator(ctx)

    draw_chips(ctx)
    draw_attach_menu(ctx)
    reaper.ImGui_SameLine(ctx)

    local changed, new_input = reaper.ImGui_InputText(ctx, "##studio_prompt", M.input, 4096)
    if changed then
      M.input = new_input
    end
    reaper.ImGui_SameLine(ctx)
    if reaper.ImGui_Button(ctx, "Send") then
      send_prompt()
    end

    if M.status ~= "" then
      reaper.ImGui_TextWrapped(ctx, M.status)
    end
    if M.last_reply ~= "" then
      reaper.ImGui_TextWrapped(ctx, M.last_reply)
    end

    reaper.ImGui_PopStyleColor(ctx, 3)
    reaper.ImGui_End(ctx)
  end
end

local function loop()
  if M.open then
    draw_dialog()
    reaper.defer(loop)
  else
    M.running = false
    OpenReaperStudioDialog = nil
  end
end

M.config = read_face_config()
if consume_open_on_load_flag() then
  M.open = true
end

reaper.defer(loop)
