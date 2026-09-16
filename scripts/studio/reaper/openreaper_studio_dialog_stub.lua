-- OpenReaper Studio — AI dialog placeholder (Day 2–3).
-- Product face slot; replaced by a real dialog in Day 4–5.

if not reaper then
  return
end

local function show_placeholder()
  reaper.ShowConsoleMsg(
    "[OpenReaper Studio] AI dialog placeholder is active (Day 2–3).\\n" ..
    "[OpenReaper Studio] Day 4–5 replaces this with the Suno-style input bar.\\n"
  )
  if reaper.MB then
    reaper.MB(
      "OpenReaper Studio\\n\\n" ..
      "AI dialog placeholder (Day 2–3).\\n" ..
      "REAPER, MCP bridge, and Pi orchestration run behind this slot.",
      "OpenReaper Studio",
      0
    )
  end
end

show_placeholder()
