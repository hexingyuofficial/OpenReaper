-- Step 1 default Studio skin (rough — neutral modern minimal AI DAW bar).
-- Float window now; dock/embed in REAPER theme is a follow-up.

local M = {}

M.layout = {
  title = "OpenReaper Studio",
  float_bottom_margin = 52,
  width_ratio = 0.62,
  min_width = 440,
  max_width = 760,
  base_height = 196,
  palette_extra_height = 132,
}

M.colors = {
  window_bg = 0x0c0c10f0,
  child_bg = 0x121218ff,
  frame_bg = 0x1a1a22ff,
  text = 0xe8e8eeff,
  text_muted = 0x9a9aa8ff,
  accent = 0x4a7cffff,
  accent_soft = 0x2a3550ff,
  chip = 0x22222eff,
  chip_hover = 0x2e2e3cff,
  palette_row = 0x181820ff,
  palette_row_hover = 0x242430ff,
  border = 0x30304080,
}

function M.push_window_style(ctx)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_WindowBg(), M.colors.window_bg)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_ChildBg(), M.colors.child_bg)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_FrameBg(), M.colors.frame_bg)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Text(), M.colors.text)
  reaper.ImGui_PushStyleColor(ctx, reaper.ImGui_Col_Border(), M.colors.border)
  reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowRounding(), 8)
  reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_FrameRounding(), 6)
  reaper.ImGui_PushStyleVar(ctx, reaper.ImGui_StyleVar_WindowPadding(), 12, 10)
end

function M.pop_window_style(ctx)
  reaper.ImGui_PopStyleVar(ctx, 3)
  reaper.ImGui_PopStyleColor(ctx, 5)
end

return M
