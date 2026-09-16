-- ReaImGui face — terminal-like Pi surface (slash palette + chat loop).

local function load_sibling(name)
  local entry = debug.getinfo(1, "S").source:match("^@(.+)$")
  local dir = entry:match("^(.*)/")
  return dofile(dir .. "/" .. name .. ".lua")
end

local studio_skin = load_sibling("studio_skin")

local M = {}

function M.slash_query(input)
  if not input or input == "" then
    return nil
  end
  local slash = input:match("^(/%S*)")
  if slash then
    return slash:sub(2):lower()
  end
  return nil
end

function M.filter_commands(commands, query)
  local filtered = {}
  if not query or query == "" then
    for _, cmd in ipairs(commands or {}) do
      table.insert(filtered, cmd)
    end
    return filtered
  end
  for _, cmd in ipairs(commands or {}) do
    local name = (cmd.name or ""):lower()
    if name:find(query, 1, true) == 1 then
      table.insert(filtered, cmd)
    end
  end
  return filtered
end

function M.draw(state, ctx, chip_mod, agent_bridge)
  local skin = studio_skin
  local viewport = reaper.ImGui_GetMainViewport(ctx)
  local vx, vy = reaper.ImGui_Viewport_GetPos(viewport)
  local vw, vh = reaper.ImGui_Viewport_GetSize(viewport)
  local win_w = math.min(skin.layout.max_width, math.max(skin.layout.min_width, vw * skin.layout.width_ratio))
  local slash_query = M.slash_query(state.input)
  local show_palette = slash_query ~= nil
  if show_palette and (not state.commands or #state.commands == 0) then
    M.refresh_commands(state, agent_bridge)
  end
  local win_h = skin.layout.base_height + (show_palette and skin.layout.palette_extra_height or 0)
  reaper.ImGui_SetNextWindowPos(
    ctx,
    vx + (vw - win_w) * 0.5,
    vy + vh - win_h - skin.layout.float_bottom_margin,
    reaper.ImGui_Cond_Always()
  )
  reaper.ImGui_SetNextWindowSize(ctx, win_w, win_h, reaper.ImGui_Cond_Always())

  local flags = reaper.ImGui_WindowFlags_NoCollapse() | reaper.ImGui_WindowFlags_NoScrollbar()
  local visible, open = reaper.ImGui_Begin(ctx, skin.layout.title, true, flags)
  state.open = open
  if not visible then
    return
  end

  skin.push_window_style(ctx)

  reaper.ImGui_TextColored(ctx, skin.colors.accent, "Pi")
  reaper.ImGui_SameLine(ctx)
  reaper.ImGui_Text(ctx, "— chat and /commands (same RPC as terminal Pi)")
  reaper.ImGui_Separator(ctx)

  M.draw_chips(state, ctx, chip_mod, skin)
  M.draw_attach_menu(state, ctx, chip_mod, skin)

  reaper.ImGui_TextColored(ctx, skin.colors.text_muted, "Message or /command")
  reaper.ImGui_PushItemWidth(ctx, -90)
  local changed, new_input = reaper.ImGui_InputText(ctx, "##studio_prompt", state.input, 4096)
  if changed then
    state.input = new_input
  end
  reaper.ImGui_PopItemWidth(ctx)
  reaper.ImGui_SameLine(ctx)

  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), skin.colors.accent_soft)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), skin.colors.accent)
  if reaper.ImGui_Button(ctx, "Send") then
    M.submit_prompt(state, agent_bridge)
  end
  reaper.ImGui_PopStyleColor(ctx, 2)

  if show_palette then
    M.draw_slash_palette(state, ctx, slash_query, skin)
  end

  if state.status ~= "" then
    reaper.ImGui_TextColored(ctx, skin.colors.text_muted, state.status)
  end
  if state.last_reply ~= "" then
    reaper.ImGui_BeginChild(ctx, "##studio_reply", 0, 72, 1, reaper.ImGui_WindowFlags_HorizontalScrollbar())
    reaper.ImGui_TextWrapped(ctx, state.last_reply)
    reaper.ImGui_EndChild(ctx)
  end

  skin.pop_window_style(ctx)
  reaper.ImGui_End(ctx)
end

function M.refresh_commands(state, agent_bridge)
  state.commands_status = "Loading Pi commands…"
  local ok, result = agent_bridge.fetch_commands(state.config)
  if ok and type(result) == "table" then
    state.commands = result.commands or {}
    state.commands_status = result.message or (#state.commands > 0 and "" or "No commands returned.")
  else
    state.commands = {}
    state.commands_status = result or "Could not load commands."
  end
end

function M.draw_slash_palette(state, ctx, slash_query, skin)
  reaper.ImGui_Spacing(ctx)
  reaper.ImGui_TextColored(ctx, skin.colors.text_muted, "Slash commands")
  if state.commands_status and state.commands_status ~= "" then
    reaper.ImGui_SameLine(ctx)
    reaper.ImGui_Text(ctx, "— " .. state.commands_status)
  end
  local filtered = M.filter_commands(state.commands, slash_query)
  reaper.ImGui_BeginChild(ctx, "##slash_palette", 0, 96, 1)
  if #filtered == 0 then
    reaper.ImGui_TextColored(ctx, skin.colors.text_muted, "Type to filter /commands…")
  else
    local max_rows = 6
    for i = 1, math.min(#filtered, max_rows) do
      local cmd = filtered[i]
      local label = "/" .. (cmd.name or "?")
      local desc = cmd.description or ""
      reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Header(), skin.colors.palette_row)
      reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_HeaderHovered(), skin.colors.palette_row_hover)
      if reaper.ImGui_Selectable(ctx, label .. "  " .. desc .. "##slash" .. tostring(i)) then
        state.input = "/" .. (cmd.name or "")
        state.status = ""
      end
      reaper.ImGui_PopStyleColor(ctx, 2)
    end
    if #filtered > max_rows then
      reaper.ImGui_TextColored(ctx, skin.colors.text_muted, string.format("+%d more…", #filtered - max_rows))
    end
  end
  reaper.ImGui_EndChild(ctx)
end

function M.submit_prompt(state, agent_bridge)
  local message = state.input:match("^%s*(.-)%s*$")
  if message == "" then
    state.status = "Type a message or /command before Send."
    return
  end
  state.status = "Sending…"
  local ok, reply = agent_bridge.send_prompt(state.config, message, state.chips)
  if ok then
    state.last_reply = reply
    state.status = "Sent."
    state.input = ""
  else
    state.status = reply
  end
end

function M.draw_chips(state, ctx, chip_mod, skin)
  if #state.chips == 0 then
    return
  end
  for index, chip in ipairs(state.chips) do
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), skin.colors.chip)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), skin.colors.chip_hover)
    reaper.ImGui_Button(ctx, chip.label .. "##chip" .. tostring(index))
    reaper.ImGui_PopStyleColor(ctx, 2)
    reaper.ImGui_SameLine(ctx)
    if reaper.ImGui_SmallButton(ctx, "x##dismiss" .. tostring(index)) then
      chip_mod.dismiss(state.chips, index)
    end
    reaper.ImGui_SameLine(ctx)
  end
  reaper.ImGui_NewLine(ctx)
end

function M.draw_attach_menu(state, ctx, chip_mod, skin)
  if reaper.ImGui_Button(ctx, "+") then
    reaper.ImGui_OpenPopup(ctx, "studio_attach_ctx")
  end
  if reaper.ImGui_BeginPopup(ctx, "studio_attach_ctx") then
    for _, item in ipairs(chip_mod.provider_menu()) do
      if reaper.ImGui_Selectable(ctx, item.label) then
        local chip, err = chip_mod.attach(item.kind)
        if chip then
          table.insert(state.chips, chip)
          state.status = ""
        else
          state.status = err or "Could not attach context."
        end
      end
    end
    reaper.ImGui_EndPopup(ctx)
  end
end

return M
