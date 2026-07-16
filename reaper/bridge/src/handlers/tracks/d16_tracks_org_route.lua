-- Extracted D16 tracks organization/delete handlers.

local function d16_tracks_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d16_tracks_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function d16_tracks_summary(request, readback)
  readback = readback or {}
  readback.capability = request.pack.capability
  readback.pack = request.pack.id
  readback.risk = request.pack.risk
  readback.readback_status = "passed"
  readback.undo_evidence = "required"
  readback.artifacts_allowed = false
  readback.truncated = false
  return readback
end

local function d16_tracks_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d16_tracks_index(track)
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

local function d16_tracks_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function d16_tracks_ref_string(track)
  local guid = d16_tracks_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(d16_tracks_index(track))
end

local function d16_tracks_object_ref(track)
  local ref = d16_tracks_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or d16_tracks_index(track)),
    },
    display = {
      name = d16_tracks_name(track),
      index = d16_tracks_index(track),
    },
  }
end

local function d16_tracks_numeric(track, key, fallback)
  local ok, value = call_reaper("GetMediaTrackInfo_Value", track, key)
  return ok and first_number(value) or fallback
end

local function d16_tracks_track_summary(track)
  return {
    track_ref = d16_tracks_ref_string(track),
    index = d16_tracks_index(track),
    name = d16_tracks_name(track),
    folder_depth = math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0),
    selected = d16_tracks_numeric(track, "I_SELECTED", 0) == 1,
  }
end

local function d16_tracks_find_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d16_tracks_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d16_tracks_find_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and d16_tracks_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function d16_tracks_resolve_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^track:selected:(%d+)$")
  if selected_index then
    local ok, track = call_reaper("GetSelectedTrack", 0, tonumber(selected_index))
    return ok and track or nil
  end
  local index = token:match("^index:(%d+)$") or token:match("^track:index:(%d+)$")
  if index then
    local ok, track = call_reaper("GetTrack", 0, tonumber(index))
    return ok and track or nil
  end
  local guid = token:match("^guid:(.+)$") or token:match("^track:guid:(.+)$")
  if guid then
    return d16_tracks_find_by_guid(guid)
  end
  local name = token:match("^track:(.+)$")
  if name then
    return d16_tracks_find_by_name(name)
  end
  return nil
end

local function d16_tracks_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d16_tracks_resolve_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d16_tracks_resolve_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d16_tracks_resolve_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return d16_tracks_find_by_name(tostring(identity.value))
  end
  return d16_tracks_resolve_token(ref.ref)
end

local function d16_tracks_from_request_refs(request)
  local tracks = {}
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track = d16_tracks_from_ref_object(request.refs[index])
      if track then
        tracks[#tracks + 1] = track
      end
    end
  end
  return tracks
end

local function d16_tracks_unique_tracks(tracks)
  local unique = {}
  local seen = {}
  for index = 1, #tracks do
    local ref = d16_tracks_ref_string(tracks[index])
    if not seen[ref] then
      unique[#unique + 1] = tracks[index]
      seen[ref] = true
    end
  end
  return unique
end

local function d16_tracks_track_count()
  local ok_count, count = call_reaper("CountTracks", 0)
  return ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
end

local function d16_tracks_select_only(tracks)
  local total = d16_tracks_track_count()
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track then
      call_reaper("SetTrackSelected", track, false)
    end
  end
  for index = 1, #tracks do
    call_reaper("SetTrackSelected", tracks[index], true)
  end
end

local function d16_tracks_verify_absent(refs)
  for index = 1, #refs do
    local track = d16_tracks_resolve_token(refs[index])
    if track then
      return false, refs[index]
    end
  end
  return true
end

local function d16_tracks_deleted_refs(tracks)
  local refs = json_array({})
  local tokens = {}
  for index = 1, #tracks do
    refs[#refs + 1] = d16_tracks_object_ref(tracks[index])
    tokens[#tokens + 1] = d16_tracks_ref_string(tracks[index])
  end
  return refs, tokens
end

local function d16_tracks_delete_tracks_impl(request, require_single)
  local tracks = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  if require_single and #tracks ~= 1 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 delete_track requires exactly one resolvable track ref.", {
      resolved_count = #tracks,
    })
  end
  if #tracks == 0 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 delete tracks requires one or more resolvable track refs.", {})
  end
  local refs, tokens = d16_tracks_deleted_refs(tracks)
  table.sort(tracks, function(left, right)
    return d16_tracks_index(left) > d16_tracks_index(right)
  end)
  for index = 1, #tracks do
    local ok = call_reaper("DeleteTrack", tracks[index])
    if not ok then
      return d16_tracks_error("COMMAND_FAILED", "Could not delete D16 track.", {
        track_ref = d16_tracks_ref_string(tracks[index]),
      }, false)
    end
  end
  call_reaper("TrackList_AdjustWindows", false)
  local absent, still_present = d16_tracks_verify_absent(tokens)
  if not absent then
    return d16_tracks_error("VERIFY_FAILED", "Deleted track still resolves after D16 delete.", {
      track_ref = still_present,
    })
  end
  return d16_tracks_summary(request, {
    deleted_count = #tokens,
    deleted_refs = refs,
  }), nil, json_array({}), refs, json_array({})
end

local function d16_tracks_delete_track(request)
  return d16_tracks_delete_tracks_impl(request, true)
end

local function d16_tracks_delete_tracks(request)
  return d16_tracks_delete_tracks_impl(request, false)
end

local function d16_tracks_create_folder_track(request)
  local total = d16_tracks_track_count()
  local index = is_non_negative_integer(request.params.index) and request.params.index or total
  index = math.max(0, math.min(index, total))
  local ok_insert = call_reaper("InsertTrackAtIndex", index, true)
  if not ok_insert then
    return d16_tracks_error("COMMAND_FAILED", "Could not insert D16 folder track.", { index = index }, false)
  end
  local ok_track, track = call_reaper("GetTrack", 0, index)
  if not ok_track or not track then
    return d16_tracks_error("TRACK_NOT_FOUND", "Inserted D16 folder track could not be resolved.", { index = index })
  end
  call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name), true)
  call_reaper("SetMediaTrackInfo_Value", track, "I_FOLDERDEPTH", 1)
  call_reaper("TrackList_AdjustWindows", false)
  local summary = d16_tracks_track_summary(track)
  summary.created = true
  summary.folder_track = true
  if summary.name ~= tostring(request.params.name) then
    return d16_tracks_error("VERIFY_FAILED", "D16 created folder track name did not match readback.", {
      expected = tostring(request.params.name),
      actual = summary.name,
    })
  end
  return d16_tracks_summary(request, summary), nil, nil, nil, d16_tracks_refs(d16_tracks_object_ref(track))
end

local function d16_tracks_set_folder_depth(request)
  local tracks = d16_tracks_from_request_refs(request)
  local track = tracks[1]
  if not track then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 set_folder_depth requires a resolvable track ref.", {})
  end
  local depth = math.floor(tonumber(request.params.folder_depth) or 0)
  if depth < -128 or depth > 128 then
    return d16_tracks_error("INPUT_INVALID", "D16 folder_depth must stay within [-128, 128].", { folder_depth = depth })
  end
  local ok = call_reaper("SetMediaTrackInfo_Value", track, "I_FOLDERDEPTH", depth)
  if not ok then
    return d16_tracks_error("COMMAND_FAILED", "Could not set D16 folder depth.", {
      track_ref = d16_tracks_ref_string(track),
    }, false)
  end
  call_reaper("TrackList_AdjustWindows", false)
  local readback = math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0)
  if readback ~= depth then
    return d16_tracks_error("VERIFY_FAILED", "D16 folder depth did not match readback.", {
      expected = depth,
      actual = readback,
    })
  end
  local summary = d16_tracks_track_summary(track)
  summary.folder_depth = readback
  return d16_tracks_summary(request, summary), nil, nil, nil, d16_tracks_refs(d16_tracks_object_ref(track))
end

local function d16_tracks_move_selected_to_index(request, tracks, index)
  local total = d16_tracks_track_count()
  if #tracks == 0 then
    return nil, d16_tracks_error("TRACK_NOT_FOUND", "D16 move requires one or more resolvable track refs.", {})
  end
  index = math.max(0, math.min(index, total))
  d16_tracks_select_only(tracks)
  local ok = call_reaper("ReorderSelectedTracks", index, 0)
  if not ok then
    return nil, d16_tracks_error("COMMAND_FAILED", "Could not reorder D16 selected tracks.", { index = index }, false)
  end
  call_reaper("TrackList_AdjustWindows", false)
  return true, nil
end

local function d16_tracks_move_tracks_impl(request, require_single)
  local tracks = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  if require_single and #tracks ~= 1 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 move_track requires exactly one resolvable track ref.", {
      resolved_count = #tracks,
    })
  end
  local target_index = math.floor(tonumber(request.params.index) or 0)
  local ok, failure = d16_tracks_move_selected_to_index(request, tracks, target_index)
  if not ok then
    return nil, failure
  end
  local refs = json_array({})
  local rows = json_array({})
  for index = 1, #tracks do
    refs[#refs + 1] = d16_tracks_object_ref(tracks[index])
    rows[#rows + 1] = d16_tracks_track_summary(tracks[index])
  end
  local first_index = rows[1] and rows[1].index or -1
  if first_index ~= target_index then
    return d16_tracks_error("VERIFY_FAILED", "D16 moved track block did not start at requested index.", {
      expected = target_index,
      actual = first_index,
    })
  end
  return d16_tracks_summary(request, {
    moved_count = #tracks,
    target_index = target_index,
    tracks = rows,
  }), nil, nil, nil, refs
end

local function d16_tracks_move_track(request)
  return d16_tracks_move_tracks_impl(request, true)
end

local function d16_tracks_move_tracks(request)
  return d16_tracks_move_tracks_impl(request, false)
end

local function d16_tracks_subtree_block(root)
  local tracks = { root }
  local start_index = d16_tracks_index(root)
  local cumulative_depth = math.floor(d16_tracks_numeric(root, "I_FOLDERDEPTH", 0) or 0)
  if cumulative_depth > 0 then
    local total = d16_tracks_track_count()
    for index = start_index + 1, total - 1 do
      local ok_track, track = call_reaper("GetTrack", 0, index)
      if not ok_track or not track then
        break
      end
      tracks[#tracks + 1] = track
      cumulative_depth = cumulative_depth + math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0)
      if cumulative_depth <= 0 then
        break
      end
    end
  end
  local last_track = tracks[#tracks]
  local last_depth = math.floor(d16_tracks_numeric(last_track, "I_FOLDERDEPTH", 0) or 0)
  return {
    root = root,
    tracks = tracks,
    start_index = start_index,
    end_index = start_index + #tracks - 1,
    normalized_last_depth = last_depth - cumulative_depth,
  }
end

local function d16_tracks_child_subtree_blocks(folder, children)
  local folder_index = d16_tracks_index(folder)
  local candidates = {}
  for index = 1, #children do
    candidates[#candidates + 1] = d16_tracks_subtree_block(children[index])
  end
  table.sort(candidates, function(left, right)
    return left.start_index < right.start_index
  end)
  local blocks = {}
  local covered_until = -1
  for index = 1, #candidates do
    local block = candidates[index]
    if folder_index >= block.start_index and folder_index <= block.end_index then
      return nil, {
        code = "FOLDER_CYCLE_REJECTED",
        message = "D16 cannot nest a folder inside one of its own child subtrees.",
        recoverable = true,
        details = {
          folder_ref = d16_tracks_ref_string(folder),
          child_ref = d16_tracks_ref_string(block.root),
        },
      }
    end
    if block.start_index > covered_until then
      blocks[#blocks + 1] = block
      covered_until = block.end_index
    end
  end
  return blocks, nil
end

local function d16_tracks_nest_tracks_in_folder(request)
  local refs = d16_tracks_unique_tracks(d16_tracks_from_request_refs(request))
  local folder = refs[1]
  if not folder then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 nest_tracks_in_folder requires a folder_ref.", {})
  end
  local children = {}
  for index = 2, #refs do
    children[#children + 1] = refs[index]
  end
  if #children == 0 then
    return d16_tracks_error("TRACK_NOT_FOUND", "D16 nest_tracks_in_folder requires at least one child track_ref.", {})
  end
  local blocks, block_failure = d16_tracks_child_subtree_blocks(folder, children)
  if not blocks then
    return nil, block_failure
  end
  local moved_tracks = {}
  for block_index = 1, #blocks do
    for track_index = 1, #blocks[block_index].tracks do
      moved_tracks[#moved_tracks + 1] = blocks[block_index].tracks[track_index]
    end
  end
  local folder_index = d16_tracks_index(folder)
  local ok, failure = d16_tracks_move_selected_to_index(request, moved_tracks, folder_index + 1)
  if not ok then
    return nil, failure
  end
  local folder_depth_set = call_reaper("SetMediaTrackInfo_Value", folder, "I_FOLDERDEPTH", 1)
  if not folder_depth_set then
    return d16_tracks_error("COMMAND_FAILED", "Could not open the D16 folder parent span.", {
      folder_ref = d16_tracks_ref_string(folder),
    }, false)
  end
  for index = 1, #blocks do
    local block = blocks[index]
    local closing_depth = block.normalized_last_depth - (index == #blocks and 1 or 0)
    local depth_set = call_reaper("SetMediaTrackInfo_Value", block.tracks[#block.tracks], "I_FOLDERDEPTH", closing_depth)
    if not depth_set then
      return d16_tracks_error("COMMAND_FAILED", "Could not balance a D16 child subtree folder span.", {
        child_ref = d16_tracks_ref_string(block.root),
      }, false)
    end
  end
  call_reaper("TrackList_AdjustWindows", false)
  local refs_out = json_array({ d16_tracks_object_ref(folder) })
  local rows = json_array({ d16_tracks_track_summary(folder) })
  local expected_index = d16_tracks_index(folder) + 1
  local cumulative_depth = 1
  for block_index = 1, #blocks do
    local block = blocks[block_index]
    refs_out[#refs_out + 1] = d16_tracks_object_ref(block.root)
    for track_index = 1, #block.tracks do
      local track = block.tracks[track_index]
      rows[#rows + 1] = d16_tracks_track_summary(track)
      if d16_tracks_index(track) ~= expected_index then
        return d16_tracks_error("VERIFY_FAILED", "D16 nested child subtree was not kept contiguous after the folder.", {
          child_ref = d16_tracks_ref_string(block.root),
          track_ref = d16_tracks_ref_string(track),
          expected_index = expected_index,
          actual_index = d16_tracks_index(track),
        })
      end
      expected_index = expected_index + 1
      cumulative_depth = cumulative_depth + math.floor(d16_tracks_numeric(track, "I_FOLDERDEPTH", 0) or 0)
      if cumulative_depth <= 0 and expected_index <= d16_tracks_index(folder) + #moved_tracks then
        return d16_tracks_error("VERIFY_FAILED", "D16 child subtree closed the folder before the final moved track.", {
          track_ref = d16_tracks_ref_string(track),
          cumulative_depth = cumulative_depth,
        })
      end
    end
  end
  if math.floor(d16_tracks_numeric(folder, "I_FOLDERDEPTH", 0) or 0) ~= 1 then
    return d16_tracks_error("VERIFY_FAILED", "D16 folder parent did not open a folder span.", {
      folder_ref = d16_tracks_ref_string(folder),
    })
  end
  if cumulative_depth ~= 0 then
    return d16_tracks_error("VERIFY_FAILED", "D16 nested child subtrees did not leave a balanced folder span.", {
      cumulative_depth = cumulative_depth,
      child_ref = d16_tracks_ref_string(blocks[#blocks].root),
    })
  end
  return d16_tracks_summary(request, {
    folder_ref = d16_tracks_ref_string(folder),
    child_count = #blocks,
    moved_track_count = #moved_tracks,
    tracks = rows,
  }), nil, nil, nil, refs_out
end
