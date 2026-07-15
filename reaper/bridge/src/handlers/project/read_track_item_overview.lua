-- Extracted D10 handler: template.project.read_track_item_overview.

local function d10_overview_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function d10_overview_bounded_limit(request, requested, default_limit, hard_limit)
  local budget = safe_budget(request)
  local limit = default_limit or budget.max_items
  if is_non_negative_integer(requested) and requested > 0 then
    limit = requested
  end
  limit = math.min(limit, budget.max_items, hard_limit or budget.max_items)
  if limit < 1 then
    return 1
  end
  return limit
end

local function d10_overview_bounded_offset(value)
  local number = tonumber(value)
  if not number or number < 0 or number ~= math.floor(number) then
    return 0
  end
  return math.floor(number)
end

local function d10_overview_budget_track_limit(request, requested)
  local budget = safe_budget(request)
  local inline_budget = budget.max_inline_value_bytes or 2048
  local requested_limit = d10_overview_bounded_limit(request, requested, 8, 32)
  local budget_limit = math.floor(math.max(1, inline_budget - 640) / 220)
  if budget_limit < 1 then
    budget_limit = 1
  end
  return math.min(requested_limit, budget_limit)
end

local function d10_overview_budget_item_limit(request, requested, track_limit)
  local requested_limit = d10_overview_bounded_limit(request, requested, 1, 8)
  if track_limit >= 6 then
    return math.min(requested_limit, 1)
  end
  return math.min(requested_limit, 2)
end

local function d10_overview_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d10_overview_track_index(track)
  local ok_number, number = call_reaper("GetMediaTrackInfo_Value", track, "IP_TRACKNUMBER")
  if ok_number and type(number) == "number" and number > 0 then
    return math.floor(number - 1)
  end
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, candidate = call_reaper("GetTrack", 0, index)
    if ok_track and candidate == track then
      return index
    end
  end
  return 0
end

local function d10_overview_track_ref_string(track)
  local guid = d10_overview_track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d10_overview_track_index(track))
end

local function d10_overview_track_ref(track)
  local ref = d10_overview_track_ref_string(track)
  local guid = ref:match("^track:guid:(.+)$")
  if guid then
    return {
      kind = "track",
      ref = ref,
      identity = {
        scheme = "guid",
        value = guid,
      },
    }
  end
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = "index",
      value = tostring(d10_overview_track_index(track)),
    },
  }
end

local function d10_overview_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 80)
end

local function d10_overview_item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function d10_overview_item_index(item)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return index
    end
  end
  return 0
end

local function d10_overview_item_ref_string(item)
  local guid = d10_overview_item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  return "item:index:" .. tostring(d10_overview_item_index(item))
end

local function d10_overview_item_ref(item)
  local ref = d10_overview_item_ref_string(item)
  local guid = ref:match("^item:guid:(.+)$")
  if guid then
    return {
      kind = "item",
      ref = ref,
      identity = {
        scheme = "guid",
        value = guid,
      },
    }
  end
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = "index",
      value = tostring(d10_overview_item_index(item)),
    },
  }
end

local function d10_overview_item_summary(item, track)
  return {
    item_ref = d10_overview_item_ref_string(item),
    track_ref = track and d10_overview_track_ref_string(track) or JSON_NULL,
    index = d10_overview_item_index(item),
    position_seconds = first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "D_POSITION"))) or 0,
    length_seconds = first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH"))) or 0,
    selected = (first_number(select(2, call_reaper("GetMediaItemInfo_Value", item, "B_UISEL"))) or 0) == 1,
  }
end

local function d10_overview_native_count(api_name, ...)
  local ok, value = call_reaper(api_name, ...)
  if not ok or type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then
    return nil
  end
  if value < 0 or value ~= math.floor(value) then
    return nil
  end
  return value
end

local function d10_overview_track_summary(track, max_items_per_track)
  local item_count = d10_overview_native_count("CountTrackMediaItems", track)
  local fx_count = d10_overview_native_count("TrackFX_GetCount", track)
  local send_count = d10_overview_native_count("GetTrackNumSends", track, 0)
  local items = json_array({})
  for index = 0, math.min(item_count or 0, max_items_per_track) - 1 do
    local ok_item, item = call_reaper("GetTrackMediaItem", track, index)
    if ok_item and item then
      items[#items + 1] = d10_overview_item_summary(item, track)
    end
  end
  local summary = {
    track_ref = d10_overview_track_ref_string(track),
    index = d10_overview_track_index(track),
    name = d10_overview_track_name(track),
    items = items,
    items_truncated = item_count == nil or item_count > #items,
  }
  summary.item_count = item_count
  summary.fx_count = fx_count
  summary.send_count = send_count
  return summary
end

local function read_track_item_overview(request)
  local track_cursor = d10_overview_bounded_offset(request.params and request.params.track_cursor)
  local max_tracks = d10_overview_budget_track_limit(request, request.params and request.params.max_tracks)
  local include_track_items = request.params and request.params.include_track_items ~= false
  local max_items_per_track = include_track_items and d10_overview_budget_item_limit(request, request.params and request.params.max_items_per_track, max_tracks) or 0
  local include_selected_items = request.params == nil or request.params.include_selected_items ~= false
  local max_selected_items = d10_overview_bounded_limit(request, request.params and request.params.max_selected_items, 4, 16)
  local ok_tracks, track_count = call_reaper("CountTracks", 0)
  local ok_items, item_count = call_reaper("CountMediaItems", 0)
  local total_tracks = ok_tracks and math.max(0, math.floor(first_number(track_count) or 0)) or 0
  local total_items = ok_items and math.max(0, math.floor(first_number(item_count) or 0)) or 0
  local tracks = json_array({})
  local selected_items = json_array({})
  local refs = json_array({ d10_overview_project_ref() })

  local end_track = math.min(total_tracks, track_cursor + max_tracks)
  for index = track_cursor, end_track - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      tracks[#tracks + 1] = d10_overview_track_summary(track, max_items_per_track)
      refs[#refs + 1] = d10_overview_track_ref(track)
    end
  end

  local total_selected = 0
  if include_selected_items then
    local ok_selected, selected_count = call_reaper("CountSelectedMediaItems", 0)
    total_selected = ok_selected and math.max(0, math.floor(first_number(selected_count) or 0)) or 0
    local selected_limit = math.min(total_selected, max_selected_items)
    for index = 0, math.min(total_selected, selected_limit) - 1 do
      local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
      if ok_item and item then
        local ok_track, track = call_reaper("GetMediaItemTrack", item)
        selected_items[#selected_items + 1] = d10_overview_item_summary(item, ok_track and track or nil)
        refs[#refs + 1] = d10_overview_item_ref(item)
      end
    end
  end

  local summary = {
    project_ref = "project:current",
    tracks = tracks,
    selected_items = selected_items,
    track_count = total_tracks,
    item_count = total_items,
    track_cursor = track_cursor,
    returned_track_count = #tracks,
    max_tracks_effective = max_tracks,
    max_items_per_track_effective = max_items_per_track,
    selected_items_truncated = include_selected_items and total_selected ~= nil and total_selected > #selected_items or false,
    truncated = end_track < total_tracks,
  }
  if end_track < total_tracks then
    summary.next_track_cursor = tostring(end_track)
  end
  return summary, nil, json_array({}), json_array({}), refs
end
