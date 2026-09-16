-- Context chip model + attach providers (extension point: add to PROVIDERS).

local M = {}

M.CHIP_CONTRACT = "openreaper.studio.context_chip.v1"

function M.new_chip(kind, label, data)
  return {
    contract = M.CHIP_CONTRACT,
    kind = kind,
    label = label,
    data = data or {},
  }
end

local function format_time(seconds)
  return string.format("%.2fs", seconds)
end

local PROVIDERS = {
  time = {
    menu_label = "Time selection",
    attach = function()
      local start_pos, end_pos = reaper.GetSet_LoopTimeRange2(false, true, 0, 0, false)
      if end_pos <= start_pos then
        return nil, "No time selection — drag a range on the timeline first."
      end
      return M.new_chip(
        "time",
        string.format("Time %s–%s", format_time(start_pos), format_time(end_pos)),
        { start = start_pos, ["end"] = end_pos }
      ), nil
    end,
  },
  track = {
    menu_label = "Track",
    attach = function()
      local track = reaper.GetSelectedTrack(0, 0)
      if not track then
        return nil, "No track selected."
      end
      local _, name = reaper.GetTrackName(track)
      local number = math.floor(reaper.GetMediaTrackInfo_Value(track, "IP_TRACKNUMBER"))
      return M.new_chip(
        "track",
        string.format("Track %d: %s", number, name ~= "" and name or "(unnamed)"),
        { guid = reaper.GetTrackGUID(track), number = number, name = name }
      ), nil
    end,
  },
  item = {
    menu_label = "Item",
    attach = function()
      local item = reaper.GetSelectedMediaItem(0, 0)
      if not item then
        return nil, "No media item selected."
      end
      local pos = reaper.GetMediaItemInfo_Value(item, "D_POSITION")
      local len = reaper.GetMediaItemInfo_Value(item, "D_LENGTH")
      local take = reaper.GetActiveTake(item)
      local take_name = take and reaper.GetTakeName(take) or "take"
      return M.new_chip(
        "item",
        string.format("Item %s @ %s", take_name, format_time(pos)),
        { position = pos, length = len, take_name = take_name }
      ), nil
    end,
  },
  region = {
    menu_label = "Region at playhead",
    attach = function()
      local play_pos = reaper.GetPlayPosition()
      local count = reaper.CountProjectMarkers(0)
      for i = 0, count - 1 do
        local _, is_region, start_pos, end_pos, name, index = reaper.EnumProjectMarkers(0, i)
        if is_region and play_pos >= start_pos and play_pos <= end_pos then
          return M.new_chip(
            "region",
            string.format("Region %d: %s", index, name ~= "" and name or "(unnamed)"),
            { index = index, start = start_pos, ["end"] = end_pos, name = name }
          ), nil
        end
      end
      return nil, "Playhead is not inside a region."
    end,
  },
  marker = {
    menu_label = "Marker near playhead",
    attach = function()
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
        return nil, "No project markers found."
      end
      return M.new_chip(
        "marker",
        string.format(
          "Marker %d: %s @ %s",
          best_idx,
          best_name ~= "" and best_name or "(unnamed)",
          format_time(best_pos)
        ),
        { index = best_idx, position = best_pos, name = best_name }
      ), nil
    end,
  },
}

function M.provider_menu()
  local items = {}
  for kind, provider in pairs(PROVIDERS) do
    table.insert(items, { kind = kind, label = provider.menu_label })
  end
  table.sort(items, function(a, b) return a.label < b.label end)
  return items
end

function M.attach(kind)
  local provider = PROVIDERS[kind]
  if not provider then
    return nil, "Unknown chip provider."
  end
  return provider.attach()
end

function M.dismiss(chips, index)
  if index >= 1 and index <= #chips then
    table.remove(chips, index)
  end
end

return M
