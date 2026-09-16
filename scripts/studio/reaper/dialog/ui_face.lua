-- ReaImGui face layout (swap this module for WebView/other UI later).

local M = {}

function M.draw(state, ctx, chip_mod, agent_bridge)
  local viewport = reaper.ImGui_GetMainViewport(ctx)
  local vx, vy = reaper.ImGui_Viewport_GetPos(viewport)
  local vw, vh = reaper.ImGui_Viewport_GetSize(viewport)
  local win_w = math.min(720, math.max(420, vw * 0.62))
  local win_h = 148
  reaper.ImGui_SetNextWindowPos(ctx, vx + (vw - win_w) * 0.5, vy + vh - win_h - 48, reaper.ImGui_Cond_Always())
  reaper.ImGui_SetNextWindowSize(ctx, win_w, win_h, reaper.ImGui_Cond_Always())

  local flags = reaper.ImGui_WindowFlags_NoCollapse() | reaper.ImGui_WindowFlags_NoScrollbar()
  local visible, open = reaper.ImGui_Begin(ctx, "OpenReaper Studio", true, flags)
  state.open = open
  if not visible then
    return
  end

  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_WindowBg(), 0x121218F0)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_FrameBg(), 0x1E1E28FF)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), 0xF2F2F8FF)

  reaper.ImGui_Text(ctx, "Ask OpenReaper")
  reaper.ImGui_Separator(ctx)

  M.draw_chips(state, ctx, chip_mod)
  M.draw_attach_menu(state, ctx, chip_mod)
  reaper.ImGui_SameLine(ctx)

  local changed, new_input = reaper.ImGui_InputText(ctx, "##studio_prompt", state.input, 4096)
  if changed then
    state.input = new_input
  end
  reaper.ImGui_SameLine(ctx)
  if reaper.ImGui_Button(ctx, "Send") then
    local message = state.input:match("^%s*(.-)%s*$")
    if message == "" then
      state.status = "Type a message before Send."
    else
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
  end

  if state.status ~= "" then
    reaper.ImGui_TextWrapped(ctx, state.status)
  end
  if state.last_reply ~= "" then
    reaper.ImGui_TextWrapped(ctx, state.last_reply)
  end

  reaper.ImGui_PopStyleColor(ctx, 3)
  reaper.ImGui_End(ctx)
end

function M.draw_chips(state, ctx, chip_mod)
  if #state.chips == 0 then
    return
  end
  for index, chip in ipairs(state.chips) do
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Button(), 0x2A2A35FF)
    reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ButtonHovered(), 0x3A3A48FF)
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

function M.draw_attach_menu(state, ctx, chip_mod)
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
