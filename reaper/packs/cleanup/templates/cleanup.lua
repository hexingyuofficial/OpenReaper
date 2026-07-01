-- Cleanup pack templates.
--
-- Slice 22 is read-only: inspect project/track/region state, write one
-- cleanup-plan JSON artifact, and leave the REAPER project untouched.

local M = {}

local SCHEMA = "openreaper.cleanup_plan.v1"
local MAX_TARGETS_PER_SUGGESTION = 2
local MAX_TITLE_CHARS = 96
local MAX_DETAIL_CHARS = 192
local MAX_TARGET_NAME_CHARS = 80
local MAX_PREVIEW_ITEMS = 8
local HASH_MOD = 4294967296

local KINDS = {
  "duplicate_track_names",
  "empty_or_unnamed_tracks",
  "inconsistent_region_names",
  "folder_depth_observation",
  "state_warning",
}

local KIND_LABELS = {
  duplicate_track_names = "duplicate track names",
  empty_or_unnamed_tracks = "empty or unnamed tracks",
  inconsistent_region_names = "inconsistent region names",
  folder_depth_observation = "folder/depth observation",
  state_warning = "track state warning",
}

local SEVERITY_RANK = {
  warning = 1,
  info = 2,
}

local function raise(code, message)
  error({ code = code, message = message })
end

local function trim(value)
  return tostring(value or ""):match("^%s*(.-)%s*$")
end

local function truncate_string(value, max_chars)
  local s = tostring(value or "")
  if #s <= max_chars then return s, false end
  local cut = max_chars
  while cut > 0 do
    local next_byte = s:byte(cut + 1)
    if not next_byte or next_byte < 128 or next_byte >= 192 then break end
    cut = cut - 1
  end
  if cut <= 0 then return "...", true end
  return s:sub(1, cut) .. "...", true
end

local function set_if_true(t, key, value)
  if value then t[key] = true end
  return t
end

local function round6(value)
  if type(value) ~= "number" then return 0 end
  return math.floor(value * 1000000 + 0.5) / 1000000
end

local function clamp_max_suggestions(value)
  if type(value) ~= "number" then return 25 end
  local n = math.floor(value)
  if n < 1 then return 1 end
  if n > 50 then return 50 end
  return n
end

local function get_track_name(track)
  local _, name = reaper.GetSetMediaTrackInfo_String(track, "P_NAME", "", false)
  return name or ""
end

local function get_track_guid(track)
  local _, guid = reaper.GetSetMediaTrackInfo_String(track, "GUID", "", false)
  return guid or ""
end

local function track_target(track)
  local name, name_truncated = truncate_string(track.name, MAX_TARGET_NAME_CHARS)
  return set_if_true({
    type = "track",
    id = track.id,
    index = track.index,
    name = name,
  }, "name_truncated", name_truncated)
end

local function region_target(region)
  local name, name_truncated = truncate_string(region.name, MAX_TARGET_NAME_CHARS)
  return set_if_true({
    type = "region",
    name = name,
    start = region.start,
    ["end"] = region["end"],
  }, "name_truncated", name_truncated)
end

local function read_project()
  local ts_num, ts_den, tempo = reaper.TimeMap_GetTimeSigAtTime(0, 0)
  if type(ts_num) ~= "number" or ts_num <= 0 then ts_num = 4 end
  if type(ts_den) ~= "number" or ts_den <= 0 then ts_den = 4 end
  if type(tempo) ~= "number" or tempo <= 0 then tempo = reaper.Master_GetTempo() end
  if type(tempo) ~= "number" or tempo <= 0 then tempo = 120 end

  local sample_rate = reaper.GetSetProjectInfo(0, "PROJECT_SRATE", 0, false)
  if type(sample_rate) ~= "number" then sample_rate = 0 end

  local length_seconds = reaper.GetProjectLength(0)
  if type(length_seconds) ~= "number" then length_seconds = 0 end

  return {
    bpm = round6(tempo),
    time_sig_num = math.floor(ts_num),
    time_sig_den = math.floor(ts_den),
    sample_rate = sample_rate,
    length_seconds = round6(length_seconds),
  }
end

local function read_tracks()
  local tracks = {}
  local depth = 0
  local total = reaper.CountTracks(0)

  for i = 0, total - 1 do
    local track = reaper.GetTrack(0, i)
    if track then
      local delta = reaper.GetMediaTrackInfo_Value(track, "I_FOLDERDEPTH")
      if type(delta) ~= "number" then delta = 0 end
      delta = math.floor(delta)

      tracks[#tracks + 1] = {
        id = "guid:" .. get_track_guid(track),
        index = i,
        name = get_track_name(track),
        depth = depth,
        folder_depth_delta = delta,
        item_count = reaper.CountTrackMediaItems(track),
        mute = reaper.GetMediaTrackInfo_Value(track, "B_MUTE") ~= 0,
        solo = reaper.GetMediaTrackInfo_Value(track, "I_SOLO") ~= 0,
        recarm = reaper.GetMediaTrackInfo_Value(track, "I_RECARM") ~= 0,
      }

      depth = depth + delta
      if depth < 0 then depth = 0 end
    end
  end

  return tracks, depth
end

local function read_regions()
  local regions = {}
  local i = 0
  while true do
    local retval, isrgn, pos, rgnend, name = reaper.EnumProjectMarkers3(0, i)
    if retval == 0 then break end
    if isrgn then
      regions[#regions + 1] = {
        name = name or "",
        start = round6(pos),
        ["end"] = round6(rgnend),
      }
    end
    i = i + 1
  end
  return regions
end

local function target_sort_key(target)
  if not target then return "" end
  if target.type == "track" then
    return string.format("track:%010d:%s:%s", target.index or 0, target.id or "", target.name or "")
  end
  if target.type == "region" then
    return string.format("region:%012.6f:%012.6f:%s", target.start or 0, target["end"] or 0, target.name or "")
  end
  return tostring(target.type or "")
end

local function bounded_targets(targets)
  local source = targets or {}
  local out = {}
  local limit = math.min(#source, MAX_TARGETS_PER_SUGGESTION)
  for i = 1, limit do out[#out + 1] = source[i] end
  return out, #source, #source > MAX_TARGETS_PER_SUGGESTION
end

local function preview_list(values)
  local shown = {}
  local limit = math.min(#values, MAX_PREVIEW_ITEMS)
  for i = 1, limit do
    local value = truncate_string(values[i], MAX_TARGET_NAME_CHARS)
    shown[#shown + 1] = value
  end
  if #values > MAX_PREVIEW_ITEMS then
    shown[#shown + 1] = "... +" .. tostring(#values - MAX_PREVIEW_ITEMS) .. " more"
  end
  return table.concat(shown, ", ")
end

local function add_candidate(candidates, kind, severity, title, detail, targets, safe_action)
  local bounded, target_count, targets_truncated = bounded_targets(targets)
  local title_out, title_truncated = truncate_string(title, MAX_TITLE_CHARS)
  local detail_out, detail_truncated = truncate_string(detail, MAX_DETAIL_CHARS)
  local first_target = bounded[1] or nil
  candidates[#candidates + 1] = {
    kind = kind,
    severity = severity,
    title = title_out,
    detail = detail_out,
    text_truncated = title_truncated or detail_truncated,
    targets = bounded,
    target_count = target_count,
    targets_truncated = targets_truncated,
    safe_action = safe_action,
    sort_key = table.concat({
      tostring(SEVERITY_RANK[severity] or 99),
      kind,
      target_sort_key(first_target),
      title_out,
    }, "|"),
  }
end

local function add_duplicate_track_name_candidates(candidates, tracks)
  local groups = {}
  for _, track in ipairs(tracks) do
    if trim(track.name) ~= "" then
      groups[track.name] = groups[track.name] or {}
      groups[track.name][#groups[track.name] + 1] = track
    end
  end

  local names = {}
  for name, group in pairs(groups) do
    if #group > 1 then names[#names + 1] = name end
  end
  table.sort(names)

  for _, name in ipairs(names) do
    local group = groups[name]
    table.sort(group, function(a, b) return a.index < b.index end)
    local targets = {}
    for _, track in ipairs(group) do targets[#targets + 1] = track_target(track) end
    local display_name = truncate_string(name, MAX_TARGET_NAME_CHARS)
    add_candidate(
      candidates,
      "duplicate_track_names",
      "warning",
      "Duplicate track name: " .. display_name,
      tostring(#group) .. " tracks share the exact name " .. display_name .. ".",
      targets,
      {
        type = "review_rename",
        apply_template = "track_rename",
        auto_apply = false,
      }
    )
  end
end

local function add_empty_or_unnamed_candidates(candidates, tracks)
  for _, track in ipairs(tracks) do
    local unnamed = trim(track.name) == ""
    local empty = track.item_count == 0
    if unnamed or empty then
      local parts = {}
      if unnamed then parts[#parts + 1] = "unnamed" end
      if empty then parts[#parts + 1] = "empty" end
      local label = table.concat(parts, " and ")
      add_candidate(
        candidates,
        "empty_or_unnamed_tracks",
        "info",
        "Review " .. label .. " track at index " .. tostring(track.index),
        "Track " .. tostring(track.index) .. " is " .. label .. ".",
        { track_target(track) },
        unnamed and {
          type = "review_rename",
          apply_template = "track_rename",
          auto_apply = false,
        } or nil
      )
    end
  end
end

local function normalized_region_family(name)
  local trimmed = trim(name)
  if trimmed == "" then return "" end
  local lower = trimmed:lower()
  local prefix = lower:match("^([%a]+)[%s_%-%d]*$")
  return prefix or lower:gsub("%d+", "#")
end

local function add_region_candidates(candidates, regions)
  local empty_targets = {}
  local by_name = {}
  local by_family = {}

  for _, region in ipairs(regions) do
    local name = trim(region.name)
    if name == "" then
      empty_targets[#empty_targets + 1] = region_target(region)
    else
      by_name[name] = by_name[name] or {}
      by_name[name][#by_name[name] + 1] = region
      local family = normalized_region_family(name)
      by_family[family] = by_family[family] or {}
      by_family[family][#by_family[family] + 1] = name
    end
  end

  if #empty_targets > 0 then
    add_candidate(
      candidates,
      "inconsistent_region_names",
      "warning",
      "Unnamed region",
      tostring(#empty_targets) .. " region(s) have empty names.",
      empty_targets,
      nil
    )
  end

  local duplicate_names = {}
  for name, group in pairs(by_name) do
    if #group > 1 then duplicate_names[#duplicate_names + 1] = name end
  end
  table.sort(duplicate_names)
  for _, name in ipairs(duplicate_names) do
    local targets = {}
    table.sort(by_name[name], function(a, b)
      if a.start == b.start then return a["end"] < b["end"] end
      return a.start < b.start
    end)
    for _, region in ipairs(by_name[name]) do targets[#targets + 1] = region_target(region) end
    add_candidate(
      candidates,
      "inconsistent_region_names",
      "warning",
      "Duplicate region name: " .. name,
      tostring(#targets) .. " regions share the exact name " .. name .. ".",
      targets,
      nil
    )
  end

  local family_names = {}
  for family, names in pairs(by_family) do
    local variants = {}
    for _, name in ipairs(names) do variants[name] = true end
    local variant_count = 0
    for _ in pairs(variants) do variant_count = variant_count + 1 end
    if family ~= "" and variant_count > 1 then family_names[#family_names + 1] = family end
  end
  table.sort(family_names)

  for _, family in ipairs(family_names) do
    local variants = {}
    for _, name in ipairs(by_family[family]) do variants[name] = true end
    local variant_list = {}
    for name in pairs(variants) do variant_list[#variant_list + 1] = name end
    table.sort(variant_list)
    add_candidate(
      candidates,
      "inconsistent_region_names",
      "warning",
      "Mixed region naming family: " .. family,
      "Region names in this family use multiple spellings: " .. preview_list(variant_list) .. ".",
      {},
      nil
    )
  end
end

local function add_folder_candidates(candidates, tracks, final_depth)
  for _, track in ipairs(tracks) do
    if math.abs(track.folder_depth_delta) > 1 then
      add_candidate(
        candidates,
        "folder_depth_observation",
        "info",
        "Large folder depth jump at track " .. tostring(track.index),
        "Track " .. tostring(track.index) .. " changes folder depth by " .. tostring(track.folder_depth_delta) .. ".",
        { track_target(track) },
        nil
      )
    end
  end

  if final_depth ~= 0 then
    add_candidate(
      candidates,
      "folder_depth_observation",
      "info",
      "Project folder depth does not close cleanly",
      "The final computed folder depth is " .. tostring(final_depth) .. ". Review folder structure before applying cleanup.",
      {},
      nil
    )
  end
end

local function add_state_warning_candidates(candidates, tracks)
  for _, track in ipairs(tracks) do
    local states = {}
    if track.mute then states[#states + 1] = "mute" end
    if track.solo then states[#states + 1] = "solo" end
    if track.recarm then states[#states + 1] = "recarm" end
    if #states > 0 then
      add_candidate(
        candidates,
        "state_warning",
        "warning",
        "Track has active state flags: " .. (track.name ~= "" and track.name or ("index " .. tostring(track.index))),
        "Track has active " .. table.concat(states, ", ") .. " state. This may affect cleanup review or delivery.",
        { track_target(track) },
        nil
      )
    end
  end
end

local function build_fingerprint(project, tracks, regions)
  local h = 2166136261

  local function update(value)
    local s = tostring(value or "")
    for i = 1, #s do
      h = (h * 131 + s:byte(i)) % HASH_MOD
    end
  end

  update("tracks")
  update(#tracks)
  update("regions")
  update(#regions)
  update("project_length")
  update(project.length_seconds)

  for _, track in ipairs(tracks) do
    update("track")
    update(track.index)
    update(track.id)
    update(track.name)
    update(track.item_count)
    update(track.folder_depth_delta)
    update(track.mute and "m" or "")
    update(track.solo and "s" or "")
    update(track.recarm and "r" or "")
  end
  for i, region in ipairs(regions) do
    update("region")
    update(i)
    update(region.name)
    update(region.start)
    update(region["end"])
  end

  return string.format(
    "tracks=%d;regions=%d;project=%.6f;hash=%08x",
    #tracks,
    #regions,
    project.length_seconds,
    math.floor(h)
  )
end

local function suggestion_counts()
  local counts = {}
  for _, kind in ipairs(KINDS) do counts[kind] = 0 end
  return counts
end

local function finalize_suggestions(candidates, max_suggestions)
  table.sort(candidates, function(a, b)
    return a.sort_key < b.sort_key
  end)

  local returned = {}
  local counts = suggestion_counts()
  local warning_count = 0
  local limit = math.min(#candidates, max_suggestions)

  for i = 1, limit do
    local candidate = candidates[i]
    counts[candidate.kind] = (counts[candidate.kind] or 0) + 1
    if candidate.severity == "warning" then warning_count = warning_count + 1 end
    returned[#returned + 1] = {
      id = string.format("cln_%03d", i),
      kind = candidate.kind,
      severity = candidate.severity,
      title = candidate.title,
      detail = candidate.detail,
      text_truncated = candidate.text_truncated or nil,
      targets = candidate.targets,
      target_count = candidate.target_count,
      targets_truncated = candidate.targets_truncated or nil,
      safe_action = candidate.safe_action,
    }
  end

  return returned, counts, warning_count, #candidates > max_suggestions
end

function M.cleanup_plan(params, ctx)
  params = params or {}
  if not ctx.artifacts then
    raise(ctx.errs.INTERNAL_ERROR, "Artifact helper was not provided to template context")
  end

  local max_suggestions = clamp_max_suggestions(params.max_suggestions)
  local project = read_project()
  local tracks, final_depth = read_tracks()
  local regions = read_regions()
  local candidates = {}

  add_duplicate_track_name_candidates(candidates, tracks)
  add_empty_or_unnamed_candidates(candidates, tracks)
  add_region_candidates(candidates, regions)
  add_folder_candidates(candidates, tracks, final_depth)
  add_state_warning_candidates(candidates, tracks)

  local suggestions, counts, warning_count, truncated = finalize_suggestions(candidates, max_suggestions)
  local summary = {
    title = "Cleanup plan",
    schema = SCHEMA,
    project = {
      track_count = #tracks,
      region_count = #regions,
      length_seconds = project.length_seconds,
    },
    suggestion_count = #suggestions,
    warning_count = warning_count,
    suggestion_counts = counts,
    truncated = truncated,
  }

  local payload = {
    schema = SCHEMA,
    inputs = {
      max_suggestions = max_suggestions,
    },
    source = {
      project = project,
      track_count = #tracks,
      region_count = #regions,
      fingerprint = build_fingerprint(project, tracks, regions),
    },
    limits = {
      max_suggestions = max_suggestions,
      candidate_count = #candidates,
      returned_suggestions = #suggestions,
      truncated = truncated,
    },
    suggestions = suggestions,
    deferred = {
      "cleanup_apply_safe",
      "cleanup_apply_destructive",
      "routing_repair",
      "fx_repair",
      "audio_content_analysis",
      "delivery_closure",
    },
  }

  local ref = ctx.artifacts:write_json({
    owner_pack = "cleanup",
    scope = "plan",
    producer_template = "cleanup_plan",
    schema = SCHEMA,
    command_id = ctx.command_id,
    summary = summary,
    payload = payload,
  })

  return { changed_ids = { ref } }
end

return M
