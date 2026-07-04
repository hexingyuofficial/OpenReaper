-- Extracted Wave 0 handler: template.transport.read_state.

local function read_transport_state_has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function read_transport_state_play_state_label(value)
  if read_transport_state_has_flag(value, 4) then
    return "recording"
  elseif read_transport_state_has_flag(value, 1) then
    return "playing"
  elseif read_transport_state_has_flag(value, 2) then
    return "paused"
  elseif type(value) == "number" then
    return "stopped"
  end
  return "unknown"
end

local function read_transport_state_loop_time_range(is_loop)
  local ok, start_time, end_time = call_reaper("GetSet_LoopTimeRange", false, is_loop, 0, 0, false)
  if ok and type(start_time) == "number" and type(end_time) == "number" then
    return {
      start_seconds = start_time,
      end_seconds = end_time,
      active = end_time > start_time,
    }
  end
  return {
    start_seconds = 0,
    end_seconds = 0,
    active = false,
  }
end

local function read_transport_state()
  local ok_play_state, play_state = call_reaper("GetPlayState")
  local ok_cursor, edit_cursor = call_reaper("GetCursorPosition")
  local ok_play_position, play_position = call_reaper("GetPlayPosition")
  local ok_repeat, repeat_state = call_reaper("GetSetRepeat", -1)
  return {
    kind = "transport_state",
    play_state = read_transport_state_play_state_label(ok_play_state and play_state or nil),
    edit_cursor_seconds = ok_cursor and first_number(edit_cursor) or 0,
    play_cursor_seconds = ok_play_position and first_number(play_position) or 0,
    repeat_enabled = ok_repeat and first_number(repeat_state) == 1 or false,
    time_selection = read_transport_state_loop_time_range(false),
    loop_points = read_transport_state_loop_time_range(true),
    truncated = false,
  }
end
