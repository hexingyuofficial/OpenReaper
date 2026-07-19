-- Extracted D30 handler: native project tab/subproject container lifecycle.

local D30_NEW_PROJECT_TAB_ACTION = 41929
local D30_NEXT_PROJECT_TAB_ACTION = 40861
local D30_SAVE_RENDER_SUBPROJECT_ACTION = 42332
local D30_SAVE_AS_OPTIONS = 8
local D30_PROJECT_TAB_NAME_MAX_BYTES = 160
local D30_PROJECT_TAB_PATH_MAX_BYTES = 4096
local D30_PROJECT_TAB_DISPLAY_MAX_BYTES = 256
local D30_PROJECT_LIST_DEFAULT_LIMIT = 25
local D30_PROJECT_LIST_HARD_LIMIT = 100
local D30_PROJECT_OPEN_PREFIX = "noprompt:"

local d30_project_tab_tokens = {}
local d30_project_tab_owner = nil
local d30_project_tab_generation = nil
local d30_project_tab_seq = 0

local d30_project_select_exact

local function d30_project_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d30_project_current_state()
  local ok, project, path = call_reaper("EnumProjects", -1, "")
  if not ok or not project or not is_string(path) then
    return nil
  end
  return {
    project = project,
    path = path,
  }
end

local function d30_project_safe_id(request, prefix)
  local raw = tostring(artifact_id_from_request(request) or request.id or prefix):gsub("[^A-Za-z0-9_%-]", "_")
  if raw == "" then
    raw = prefix
  end
  if #raw > 64 then
    raw = raw:sub(1, 64)
  end
  return prefix .. "_" .. raw
end

local function d30_project_ref_object(ref, summary)
  local scheme, value = ref:match("^project:([^:]+):(.+)$")
  return {
    kind = "project",
    ref = ref,
    identity = {
      scheme = scheme or "current",
      value = value or "current",
    },
    summary = summary,
  }
end

local function d30_item_guid(item)
  local ok_sws, guid = call_reaper("BR_GetMediaItemGUID", item)
  if ok_sws and is_string(guid) and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and is_string(native_guid) and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function d30_item_ref(item)
  local guid = d30_item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  return "item:placeholder:" .. tostring(item)
end

local function d30_item_ref_object(item, summary)
  local ref = d30_item_ref(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "placeholder",
      value = value or tostring(item),
    },
    summary = summary,
  }
end

local function d30_project_write_ledger(request, key, row)
  local state = d30_project_current_state()
  if not state then
    return false
  end
  local ok = call_reaper("SetProjExtState", state.project, "OPENREAPER_PROJECT_CONTAINERS", key, json.encode(row))
  return ok == true
end

local function d30_project_summary(request, fields)
  fields = fields or {}
  fields.capability = request.pack.capability
  fields.pack = request.pack.id
  fields.risk = request.pack.risk
  fields.readback_status = "passed"
  fields.undo_evidence = "required"
  fields.artifacts_allowed = false
  fields.truncated = false
  fields.live_materialization = fields.live_materialization or "ledger_only_waiting_fixture"
  return fields
end

local function d30_project_restore(parent_project)
  return d30_project_select_exact(parent_project) == true
end

local function d30_project_failure_after_restore(parent_project, code, message, details, recoverable)
  if parent_project and not d30_project_restore(parent_project) then
    return d30_project_error("RESTORE_FAILED", "Subproject operation failed and the parent project could not be restored.", {
      original_code = code,
      original_blocker = details and details.blocker or nil,
    }, false)
  end
  return d30_project_error(code, message, details, recoverable)
end

local function d30_project_call_void(api_name, ...)
  local results = { call_reaper(api_name, ...) }
  if results[1] ~= true then
    return false, "pcall_failed_or_binding_unavailable"
  end
  if results[2] ~= nil and results[2] ~= true then
    return false, "failure_return"
  end
  return true
end

local function d30_project_call_command(api_name, ...)
  local results = { call_reaper(api_name, ...) }
  if results[1] ~= true then
    return false, "pcall_failed_or_binding_unavailable"
  end
  if results[2] == false then
    return false, "failure_return"
  end
  return true
end

local function d30_project_time_selection(project)
  local ok, start_time, end_time = call_reaper("GetSet_LoopTimeRange2", project, false, false, 0, 0, false)
  if not ok or type(start_time) ~= "number" or type(end_time) ~= "number" then
    return nil
  end
  return {
    start_time = start_time,
    end_time = end_time,
  }
end

local function d30_project_set_time_selection(project, selection)
  local ok = call_reaper(
    "GetSet_LoopTimeRange2",
    project,
    true,
    false,
    selection.start_time,
    selection.end_time,
    false
  )
  if not ok then
    return false
  end
  local readback = d30_project_time_selection(project)
  return readback ~= nil
    and math.abs(readback.start_time - selection.start_time) <= 0.000001
    and math.abs(readback.end_time - selection.end_time) <= 0.000001
end

local function d30_project_path_parts(path)
  if not is_string(path) or path == "" then
    return nil
  end
  local directory, separator, basename = path:match("^(.*)([/\\])([^/\\]+)$")
  if directory == nil or not separator or not basename or basename == "" then
    return nil
  end
  return directory, separator
end

local function d30_project_child_path(request, parent_path, name)
  local directory, separator = d30_project_path_parts(parent_path)
  if not directory then
    return nil
  end
  local stem = tostring(name):gsub("[^A-Za-z0-9 _%-]", "_"):gsub("%s+", "_"):gsub("_+", "_")
  stem = stem:gsub("^[_.%-]+", ""):gsub("[_.%-]+$", "")
  if stem == "" then
    stem = "subproject"
  end
  if #stem > 72 then
    stem = stem:sub(1, 72)
  end
  return directory .. separator .. stem .. "__" .. d30_project_safe_id(request, "subproject") .. ".RPP"
end

local function d30_project_path_ref_from_object(ref)
  if not is_object(ref) or ref.kind ~= "project" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local path = ref.ref:match("^project:path:(.+)$")
  if not path or ref.identity.scheme ~= "path" or tostring(ref.identity.value) ~= path then
    return nil
  end
  return path
end

local function d30_project_path_from_request(request)
  local found = nil
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      if is_object(request.refs[index]) and request.refs[index].kind == "project" then
        local path = d30_project_path_ref_from_object(request.refs[index])
        if not path or found then
          return nil, "invalid_or_duplicate_project_ref"
        end
        found = path
      end
    end
  end
  if not found then
    return nil, "project_ref_missing"
  end
  return found
end

local function d30_project_find_open_by_path(path)
  local index = 0
  while true do
    local ok, project, project_path = call_reaper("EnumProjects", index, "")
    if not ok then
      return nil
    end
    if not project then
      return nil
    end
    if project_path == path then
      return project
    end
    index = index + 1
  end
end

local function d30_project_state_for_instance(target_project)
  if not target_project then
    return nil
  end
  local index = 0
  while true do
    local ok, project, project_path = call_reaper("EnumProjects", index, "")
    if not ok or not project then
      return nil
    end
    if project == target_project then
      return {
        project = project,
        path = is_string(project_path) and project_path or "",
      }
    end
    index = index + 1
  end
end

local function d30_project_open_instances()
  local instances = {}
  local index = 0
  while true do
    local ok, project, project_path = call_reaper("EnumProjects", index, "")
    if not ok then
      return nil
    end
    if not project then
      return instances
    end
    instances[#instances + 1] = {
      project = project,
      path = is_string(project_path) and project_path or "",
    }
    index = index + 1
  end
end

d30_project_select_exact = function(target_project)
  if not target_project then
    return false, "target_project_missing"
  end
  local current = d30_project_current_state()
  if current and current.project == target_project then
    return true, "already_active"
  end

  d30_project_call_void("SelectProjectInstance", target_project)
  current = d30_project_current_state()
  if current and current.project == target_project then
    return true, "select_project_instance"
  end

  local instances = d30_project_open_instances()
  if not instances then
    return false, "project_tab_enumeration_failed"
  end
  for _ = 1, #instances do
    current = d30_project_current_state()
    local advanced = d30_project_call_void("Main_OnCommandEx", D30_NEXT_PROJECT_TAB_ACTION, 0, 0)
    if not advanced then
      return false, "next_project_tab_action_failed"
    end
    current = d30_project_current_state()
    if current and current.project == target_project then
      return true, "next_project_tab_action"
    end
  end
  return false, "project_tab_selection_readback_failed"
end

local function d30_project_find_single_added_instance(before)
  local after = d30_project_open_instances()
  if not after then
    return nil, "project_tab_enumeration_failed"
  end
  local known = {}
  local before_count = #before
  for index = 1, before_count do
    local project = before[index].project
    if known[project] then
      return nil, "project_tab_preflight_duplicate_instance", 0
    end
    known[project] = true
  end
  local after_seen = {}
  local added = nil
  local added_count = 0
  local retained_count = 0
  for index = 1, #after do
    local project = after[index].project
    if after_seen[project] then
      return nil, "project_tab_after_duplicate_instance", added_count
    end
    after_seen[project] = true
    if known[project] then
      retained_count = retained_count + 1
    else
      added = after[index]
      added_count = added_count + 1
    end
  end
  if retained_count ~= before_count then
    return nil, "project_tab_prior_instance_missing", added_count
  end
  if added_count ~= 1 then
    return nil, "new_project_tab_identity_ambiguous", added_count
  end
  return added, nil, added_count
end

local function d30_track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function d30_track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return ok and first_string(name) or nil
end

local function d30_find_track_by_guid(project, guid)
  local ok_count, count = call_reaper("CountTracks", project)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    if ok_track and track and d30_track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function d30_find_track_by_name(project, name)
  local ok_count, count = call_reaper("CountTracks", project)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    if ok_track and track and d30_track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches == 1 then
    return found
  end
  return nil
end

local function d30_track_from_ref(project, ref)
  if not is_object(ref) or ref.kind ~= "track" or not is_string(ref.ref) or not is_object(ref.identity) then
    return nil
  end
  local scheme, value = ref.ref:match("^track:([^:]+):(.+)$")
  if not scheme or tostring(ref.identity.scheme) ~= scheme or tostring(ref.identity.value) ~= value then
    return nil
  end
  if scheme == "guid" then
    return d30_find_track_by_guid(project, value)
  elseif scheme == "index" and value:match("^%d+$") then
    local ok, track = call_reaper("GetTrack", project, tonumber(value))
    return ok and track or nil
  elseif scheme == "selected" and value:match("^%d+$") then
    local ok, track = call_reaper("GetSelectedTrack", project, tonumber(value))
    return ok and track or nil
  elseif scheme == "name" then
    return d30_find_track_by_name(project, value)
  end
  return nil
end

local function d30_track_from_request(project, request)
  local target = nil
  local supplied = false
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "track" then
        if supplied then
          return nil, "duplicate"
        end
        supplied = true
        target = d30_track_from_ref(project, ref)
        if not target then
          return nil, "invalid"
        end
      end
    end
  end
  return target, supplied and nil or "missing"
end

local function d30_first_track(project)
  local ok_track, track = call_reaper("GetTrack", project, 0)
  if ok_track and track then
    return track
  end
  local ok_insert = call_reaper("InsertTrackAtIndex", 0, true)
  if not ok_insert then
    return nil
  end
  ok_track, track = call_reaper("GetTrack", project, 0)
  return ok_track and track or nil
end

local function d30_snapshot_project_ui(project)
  local ok_tracks, track_count = call_reaper("CountTracks", project)
  local ok_items, item_count = call_reaper("CountMediaItems", project)
  local ok_cursor, cursor = call_reaper("GetCursorPositionEx", project)
  if not ok_tracks or not ok_items or not ok_cursor then
    return nil
  end
  local snapshot = {
    tracks = {},
    items = {},
    cursor = first_number(cursor) or 0,
  }
  for index = 0, (first_number(track_count) or 0) - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    local ok_selected, selected = false, false
    if ok_track and track then
      ok_selected, selected = call_reaper("IsTrackSelected", track)
    end
    if not ok_track or not track or not ok_selected then
      return nil
    end
    snapshot.tracks[track] = selected == true
  end
  for index = 0, (first_number(item_count) or 0) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, index)
    local ok_selected, selected = false, false
    if ok_item and item then
      ok_selected, selected = call_reaper("IsMediaItemSelected", item)
    end
    if not ok_item or not item or not ok_selected then
      return nil
    end
    snapshot.items[item] = selected == true
  end
  return snapshot
end

local function d30_restore_project_ui(project, snapshot)
  if not snapshot then
    return false
  end
  local ok_tracks, track_count = call_reaper("CountTracks", project)
  local ok_items, item_count = call_reaper("CountMediaItems", project)
  if not ok_tracks or not ok_items then
    return false
  end
  for index = 0, (first_number(track_count) or 0) - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    if not ok_track or not track or not call_reaper("SetTrackSelected", track, snapshot.tracks[track] == true) then
      return false
    end
  end
  for index = 0, (first_number(item_count) or 0) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, index)
    if not ok_item or not item or not call_reaper("SetMediaItemSelected", item, snapshot.items[item] == true) then
      return false
    end
  end
  local ok_cursor = call_reaper("SetEditCurPos2", project, snapshot.cursor, false, false)
  call_reaper("UpdateArrange")
  return ok_cursor == true
end

local D30_MAX_SOURCE_CHAIN_DEPTH = 16

local function d30_source_path_truth(source_path, expected_proxy_path, expected_child_path)
  if not is_string(source_path) or source_path == "" then
    return nil
  end
  if source_path == expected_child_path then
    return {
      source_path = source_path,
      proxy_path = expected_proxy_path,
      mode = "exact_requested_child_project",
    }
  end
  if source_path == expected_proxy_path then
    return {
      source_path = source_path,
      proxy_path = expected_proxy_path,
      mode = "exact_requested_proxy",
    }
  end
  if source_path:sub(-5):upper() == "-PROX" and file_exists(source_path) then
    return {
      source_path = source_path,
      proxy_path = source_path,
      mode = "reaper_managed_proxy_copy",
    }
  end
  local managed_proxy_path = source_path .. "-PROX"
  if source_path:sub(-4):upper() == ".RPP" and file_exists(managed_proxy_path) then
    return {
      source_path = source_path,
      proxy_path = managed_proxy_path,
      mode = "reaper_managed_proxy_copy",
    }
  end
  return nil
end

local function d30_item_source_truth(item, expected_proxy_path, expected_child_path)
  local ok_track, track = call_reaper("GetMediaItem_Track", item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_track or not track or not ok_take or not take or not is_string(expected_child_path) or expected_child_path == "" then
    return nil
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return nil
  end

  local current_source = source
  local visited = {}
  local path_source = nil
  local path_truth = nil
  local subproject_source = nil
  local subproject = nil
  local terminated = false
  for _ = 1, D30_MAX_SOURCE_CHAIN_DEPTH do
    if visited[current_source] then
      return nil
    end
    visited[current_source] = true

    local ok_path, path_a, path_b = call_reaper("GetMediaSourceFileName", current_source, "")
    local ok_type, source_type_value = call_reaper("GetMediaSourceType", current_source, "")
    if not ok_path or not ok_type then
      return nil
    end
    local current_path = first_string(path_a, path_b)
    local current_path_truth = d30_source_path_truth(current_path, expected_proxy_path, expected_child_path)
    if current_path_truth then
      if first_string(source_type_value) ~= "RPP_PROJECT" then
        return nil
      end
      path_source = current_source
      path_truth = current_path_truth
    end

    local ok_subproject, current_subproject = call_reaper("GetSubProjectFromSource", current_source)
    if not ok_subproject then
      return nil
    end
    local current_subproject_state = current_subproject and d30_project_state_for_instance(current_subproject) or nil
    if current_subproject_state and current_subproject_state.path == expected_child_path then
      subproject_source = current_source
      subproject = current_subproject
    end

    local ok_parent, parent_source = call_reaper("GetMediaSourceParent", current_source)
    if not ok_parent then
      return nil
    end
    if not parent_source then
      terminated = true
      break
    end
    current_source = parent_source
  end
  if not terminated or not path_source or not path_truth or not subproject_source then
    return nil
  end
  return {
    track = track,
    take = take,
    source = path_source,
    subproject_source = subproject_source,
    subproject = subproject,
    source_path = path_truth.source_path,
    source_proxy_path = path_truth.proxy_path,
    requested_proxy_path = expected_proxy_path,
    source_path_mode = path_truth.mode,
    source_type = "RPP_PROJECT",
  }
end

local function d30_destroy_source(source)
  if not source then
    return true
  end
  local destroyed = d30_project_call_void("PCM_Source_Destroy", source)
  return destroyed == true
end

local function d30_delete_created_item(track, item)
  if not track or not item then
    return true
  end
  local ok, removed = call_reaper("DeleteTrackMediaItem", track, item)
  return ok and removed ~= false
end

local function d30_create_native_subproject_source(child_path)
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", child_path)
  if not ok_source or not source then
    return nil, nil, "subproject_source_create_failed"
  end

  local ok_type, source_type_value = call_reaper("GetMediaSourceType", source, "")
  if not ok_type or first_string(source_type_value) ~= "RPP_PROJECT" then
    return source, nil, "subproject_source_type_mismatch"
  end
  local ok_path, path_a, path_b = call_reaper("GetMediaSourceFileName", source, "")
  if not ok_path or first_string(path_a, path_b) ~= child_path then
    return source, nil, "subproject_source_path_mismatch"
  end
  local ok_length, source_length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  if not ok_length
    or type(source_length) ~= "number"
    or source_length ~= source_length
    or source_length == math.huge
    or source_length == -math.huge
    or source_length <= 0
    or length_is_quarter_notes ~= false
  then
    return source, nil, "subproject_source_length_invalid"
  end
  return source, source_length, nil
end

local function d30_item_from_request(project, request)
  if not is_json_array(request.refs) then
    return nil
  end
  local item_ref = nil
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" then
      if item_ref then
        return nil
      end
      item_ref = ref
    end
  end
  if not item_ref or not is_string(item_ref.ref) or not is_object(item_ref.identity) then
    return nil
  end
  local scheme, value = item_ref.ref:match("^item:([^:]+):(.+)$")
  if not scheme or item_ref.identity.scheme ~= scheme or tostring(item_ref.identity.value) ~= value then
    return nil
  end
  local ok_count, count = call_reaper("CountMediaItems", project)
  local total = ok_count and first_number(count) or 0
  if scheme == "index" and value:match("^%d+$") then
    local ok_item, item = call_reaper("GetMediaItem", project, tonumber(value))
    return ok_item and item or nil
  elseif scheme == "guid" then
    for index = 0, total - 1 do
      local ok_item, item = call_reaper("GetMediaItem", project, index)
      if ok_item and item and d30_item_guid(item) == value then
        return item
      end
    end
  end
  return nil
end

local function create_subproject(request)
  local name = bounded_string(request.params.name or "", 160)
  if name == "" then
    return d30_project_error("PARAMS_INVALID", "create_subproject requires a non-empty name.", {
      field = "name",
    })
  end
  if is_json_array(request.refs) and #request.refs > 0 then
    return d30_project_error("REF_INVALID", "create_subproject does not accept caller-supplied refs.", {})
  end
  local parent = d30_project_current_state()
  if not parent or parent.path == "" then
    return d30_project_error("COMMAND_FAILED", "create_subproject requires a saved parent project.", {
      blocker = "parent_project_unsaved_or_unreadable",
    })
  end
  local inherited_time_selection = nil
  if request.params.inherit_time_selection == true then
    inherited_time_selection = d30_project_time_selection(parent.project)
    if not inherited_time_selection then
      return d30_project_error("COMMAND_FAILED", "create_subproject could not read the parent time selection requested for inheritance.", {
        blocker = "parent_time_selection_unreadable",
      }, false)
    end
  end
  local child_path = d30_project_child_path(request, parent.path, name)
  if not child_path then
    return d30_project_error("COMMAND_FAILED", "create_subproject could not derive a child path beside the parent project.", {
      blocker = "parent_project_directory_unavailable",
    })
  end
  local proxy_path = child_path .. "-PROX"
  if file_exists(child_path) or file_exists(proxy_path) then
    return d30_project_error("FILE_EXISTS", "create_subproject refuses to overwrite an existing child project or proxy.", {
      blocker = "subproject_target_exists",
      child_project_path = child_path,
      proxy_path = proxy_path,
    })
  end

  local projects_before = d30_project_open_instances()
  if not projects_before then
    return d30_project_error("COMMAND_FAILED", "create_subproject could not enumerate open projects before creating the child tab.", {
      blocker = "project_tab_preflight_enumeration_failed",
    }, false)
  end
  local created_tab, create_reason = d30_project_call_void("Main_OnCommandEx", D30_NEW_PROJECT_TAB_ACTION, 0, 0)
  if not created_tab then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected creation of a new project tab for the subproject.", {
      blocker = "new_project_tab_failed",
      reason = create_reason,
    }, false)
  end
  local child, added_reason, added_count = d30_project_find_single_added_instance(projects_before)
  if not child then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "New project tab identity could not be verified exactly.", {
      blocker = added_reason,
      added_project_count = added_count,
    }, false)
  end
  if inherited_time_selection and not d30_project_set_time_selection(child.project, inherited_time_selection) then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "Child subproject did not inherit the parent time selection exactly.", {
      blocker = "child_time_selection_readback_failed",
      expected_start_seconds = inherited_time_selection.start_time,
      expected_end_seconds = inherited_time_selection.end_time,
    }, false)
  end

  local saved, save_reason = d30_project_call_void("Main_SaveProjectEx", child.project, child_path, D30_SAVE_AS_OPTIONS)
  if not saved then
    return d30_project_failure_after_restore(parent.project, "COMMAND_FAILED", "REAPER rejected saving the child subproject.", {
      blocker = "subproject_save_failed",
      reason = save_reason,
    }, false)
  end
  child = d30_project_state_for_instance(child.project)
  if not child or child.path ~= child_path or not file_exists(child_path) then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "Child subproject path did not read back exactly after save.", {
      blocker = "subproject_save_readback_failed",
      expected_path = child_path,
      actual_path = child and child.path or "",
    }, false)
  end

  local rendered, render_reason = d30_project_call_void("Main_OnCommandEx", D30_SAVE_RENDER_SUBPROJECT_ACTION, 0, child.project)
  if not rendered then
    return d30_project_failure_after_restore(parent.project, "COMMAND_FAILED", "REAPER rejected subproject proxy rendering.", {
      blocker = "subproject_proxy_render_failed",
      reason = render_reason,
    }, false)
  end
  if not file_exists(proxy_path) then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "Subproject proxy file did not exist after native render.", {
      blocker = "subproject_proxy_missing",
      proxy_path = proxy_path,
    }, false)
  end
  if not d30_project_restore(parent.project) then
    return d30_project_error("RESTORE_FAILED", "Created subproject but could not restore the parent project.", {
      child_project_path = child_path,
    }, false)
  end

  local child_ref = "project:path:" .. child_path
  local parent_ref = "project:path:" .. parent.path
  local row = {
    kind = "subproject",
    name = name,
    child_project_path = child_path,
    proxy_path = proxy_path,
    parent_project_ref = parent_ref,
    materialization = "native_rpp_proxy_verified",
  }
  d30_project_write_ledger(request, d30_project_safe_id(request, "subproject"), row)
  local child_object_ref = d30_project_ref_object(child_ref, row)
  local parent_object_ref = d30_project_ref_object(parent_ref, { kind = "project", role = "parent", path = parent.path })
  return d30_project_summary(request, {
    subproject_project_ref = child_ref,
    parent_project_ref = parent_ref,
    name = name,
    child_project_path = child_path,
    proxy_path = proxy_path,
    created = true,
    parent_restored = true,
    requested_activate = request.params.activate == true,
    inherited_time_selection = inherited_time_selection ~= nil,
    inherited_time_selection_start_seconds = inherited_time_selection and inherited_time_selection.start_time or nil,
    inherited_time_selection_end_seconds = inherited_time_selection and inherited_time_selection.end_time or nil,
    live_materialization = "native_rpp_proxy_verified",
  }), nil, json_array({ child_object_ref, parent_object_ref }), json_array({}), json_array({ child_object_ref, parent_object_ref })
end

local function d30_project_tab_scope_ready()
  if d30_project_tab_owner ~= ACTIVE_OWNER or d30_project_tab_generation ~= ACTIVE_GENERATION then
    d30_project_tab_tokens = {}
    d30_project_tab_owner = ACTIVE_OWNER
    d30_project_tab_generation = ACTIVE_GENERATION
    d30_project_tab_seq = 0
  end
end

local function d30_project_bounded_text(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  local limit = math.max(4, math.floor(tonumber(max_bytes) or 4))
  if #text <= limit then
    return text, false
  end
  local cut = limit - 3
  while cut > 0 do
    local next_byte = string.byte(text, cut + 1)
    if next_byte == nil or next_byte < 128 or next_byte >= 192 then
      break
    end
    cut = cut - 1
  end
  return text:sub(1, cut) .. "...", true
end

local function d30_project_raw_dirty(project)
  local ok, raw_dirty_state = call_reaper("IsProjectDirty", project)
  if not ok then
    return nil, "is_project_dirty_failed"
  end
  if type(raw_dirty_state) ~= "number"
    or raw_dirty_state ~= raw_dirty_state
    or raw_dirty_state == math.huge
    or raw_dirty_state == -math.huge
    or raw_dirty_state < 0
    or raw_dirty_state ~= math.floor(raw_dirty_state)
  then
    return nil, "is_project_dirty_invalid"
  end
  return raw_dirty_state
end

local function d30_project_display_name(project, path)
  local name = nil
  local ok, first, second = call_reaper("GetProjectName", project, "")
  if ok then
    name = first_string(first, second)
  end
  if not is_string(name) or name == "" then
    if is_string(path) and path ~= "" then
      name = path:match("([^/\\]+)$") or "project"
    else
      name = "unsaved"
    end
  end
  local bounded = d30_project_bounded_text(name, D30_PROJECT_TAB_DISPLAY_MAX_BYTES)
  return bounded
end

local function d30_project_mint_tab_token(project)
  d30_project_tab_scope_ready()
  d30_project_tab_seq = d30_project_tab_seq + 1
  local token = string.format(
    "%s_g%s_t%s",
    tostring(ACTIVE_OWNER):gsub("[^A-Za-z0-9_%-]", "_"),
    tostring(ACTIVE_GENERATION),
    tostring(d30_project_tab_seq)
  )
  if #token > 96 then
    token = token:sub(1, 96)
  end
  d30_project_tab_tokens[token] = project
  return token
end

local function d30_project_token_for_instance(project)
  d30_project_tab_scope_ready()
  for token, bound in pairs(d30_project_tab_tokens) do
    if bound == project then
      return token
    end
  end
  return d30_project_mint_tab_token(project)
end

local function d30_project_purge_stale_tokens(live_projects)
  d30_project_tab_scope_ready()
  local live = {}
  for index = 1, #live_projects do
    live[live_projects[index].project] = true
  end
  for token, project in pairs(d30_project_tab_tokens) do
    if not live[project] then
      d30_project_tab_tokens[token] = nil
    end
  end
end

local function d30_project_canonical_ref(project, path)
  if is_string(path) and path ~= "" then
    return "project:path:" .. path, "path", path
  end
  local token = d30_project_token_for_instance(project)
  return "project:tab:" .. token, "tab", token
end

local function d30_project_snapshot_identity(project)
  if not project then
    return nil
  end
  local state = d30_project_state_for_instance(project)
  if not state then
    return nil
  end
  local raw_dirty_state, dirty_reason = d30_project_raw_dirty(project)
  if raw_dirty_state == nil then
    return nil, dirty_reason
  end
  local ref, scheme, value = d30_project_canonical_ref(project, state.path)
  return {
    project = project,
    path = state.path,
    project_ref = ref,
    scheme = scheme,
    identity_value = value,
    dirty = raw_dirty_state > 0,
    raw_dirty_state = raw_dirty_state,
  }
end

local function d30_project_inventory_rows(display_path_limit)
  local instances = d30_project_open_instances()
  if not instances then
    return nil, "project_tab_enumeration_failed"
  end
  d30_project_purge_stale_tokens(instances)
  local current = d30_project_current_state()
  if not current or not current.project then
    return nil, "active_project_unreadable"
  end
  local path_limit = math.min(
    D30_PROJECT_TAB_PATH_MAX_BYTES,
    math.max(64, math.floor(tonumber(display_path_limit) or D30_PROJECT_TAB_PATH_MAX_BYTES))
  )
  local rows = {}
  local path_counts = {}
  local ref_counts = {}
  local project_counts = {}
  local active_count = 0
  for index = 1, #instances do
    local instance = instances[index]
    project_counts[instance.project] = (project_counts[instance.project] or 0) + 1
    local raw_dirty_state, dirty_reason = d30_project_raw_dirty(instance.project)
    if raw_dirty_state == nil then
      return nil, dirty_reason
    end
    local project_ref, scheme, value = d30_project_canonical_ref(instance.project, instance.path)
    if is_string(instance.path) and instance.path ~= "" then
      path_counts[instance.path] = (path_counts[instance.path] or 0) + 1
    end
    ref_counts[project_ref] = (ref_counts[project_ref] or 0) + 1
    local is_active = current.project == instance.project
    if is_active then
      active_count = active_count + 1
    end
    local bounded_path, path_truncated = d30_project_bounded_text(instance.path, path_limit)
    local display_name = d30_project_display_name(instance.project, instance.path)
    rows[#rows + 1] = {
      project = instance.project,
      project_ref = project_ref,
      identity_scheme = scheme,
      identity_value = value,
      active = is_active,
      saved = is_string(instance.path) and instance.path ~= "",
      path_state = (is_string(instance.path) and instance.path ~= "") and "saved_project" or "unsaved_project",
      path = bounded_path,
      exact_path = instance.path,
      path_truncated = path_truncated,
      name = display_name,
      dirty = raw_dirty_state > 0,
      raw_dirty_state = raw_dirty_state,
      tab_index = index - 1,
    }
  end
  if active_count == 0 then
    return nil, "active_project_not_in_inventory"
  end
  if active_count ~= 1 then
    return nil, "active_project_ambiguous"
  end
  for index = 1, #rows do
    local row = rows[index]
    if project_counts[row.project] and project_counts[row.project] > 1 then
      return nil, "project_identity_duplicate"
    end
    if row.saved and path_counts[row.exact_path] and path_counts[row.exact_path] > 1 then
      return nil, "project_path_duplicate"
    end
    if ref_counts[row.project_ref] and ref_counts[row.project_ref] > 1 then
      return nil, "project_ref_duplicate"
    end
  end
  return rows
end

local function d30_project_row_public(row)
  return {
    project_ref = row.project_ref,
    active = row.active == true,
    saved = row.saved == true,
    path_state = row.path_state,
    name = row.name,
    path = row.path,
    path_truncated = row.path_truncated == true,
    dirty = row.dirty == true,
    raw_dirty_state = row.raw_dirty_state,
    tab_index = row.tab_index,
  }
end

local function d30_project_find_row_by_ref(rows, project_ref)
  local matches = {}
  for index = 1, #rows do
    if rows[index].project_ref == project_ref then
      matches[#matches + 1] = rows[index]
    end
  end
  if #matches == 0 then
    return nil, "project_ref_not_open"
  end
  if #matches > 1 then
    return nil, "project_ref_ambiguous"
  end
  local row = matches[1]
  if row.duplicate_path or row.duplicate_ref then
    return nil, "project_identity_duplicate"
  end
  return row
end

local function d30_project_parse_project_ref(request)
  local found = nil
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local ref = request.refs[index]
      if is_object(ref) and ref.kind == "project" then
        if found then
          return nil, "duplicate_project_ref"
        end
        if not is_string(ref.ref) or not is_object(ref.identity) then
          return nil, "invalid_project_ref"
        end
        local scheme, value = ref.ref:match("^project:([^:]+):(.+)$")
        if not scheme or not value then
          return nil, "invalid_project_ref"
        end
        if tostring(ref.identity.scheme) ~= scheme or tostring(ref.identity.value) ~= value then
          return nil, "project_ref_identity_mismatch"
        end
        if scheme ~= "path" and scheme ~= "tab" then
          return nil, "unsupported_project_ref_scheme"
        end
        if scheme == "tab" then
          d30_project_tab_scope_ready()
          if not d30_project_tab_tokens[value] then
            return nil, "stale_project_tab_token"
          end
        end
        found = ref.ref
      end
    end
  end
  if not found and is_string(request.params.project_ref) and request.params.project_ref ~= "" then
    found = request.params.project_ref
    local scheme, value = found:match("^project:([^:]+):(.+)$")
    if not scheme or not value or (scheme ~= "path" and scheme ~= "tab") then
      return nil, "invalid_project_ref"
    end
    if scheme == "tab" then
      d30_project_tab_scope_ready()
      if not d30_project_tab_tokens[value] then
        return nil, "stale_project_tab_token"
      end
    end
  end
  if not found then
    return nil, "project_ref_missing"
  end
  return found
end

local function d30_project_validate_open_path(path)
  if not is_string(path) or path == "" or #path > D30_PROJECT_TAB_PATH_MAX_BYTES or path:find("[%c%z]") then
    return nil, "path_structure_invalid"
  end
  local posix_absolute = path:sub(1, 1) == "/"
  local windows_absolute = path:match("^%a:[/\\]") ~= nil or path:match("^[/\\][/\\]") ~= nil
  if not posix_absolute and not windows_absolute then
    return nil, "path_not_absolute"
  end
  if path:match("^[%a][%w+.-]*://") or path:match("^[%a][%w+.-]*:[^/\\]") then
    return nil, "path_uri_rejected"
  end
  if path:match("[/\\]%.%.[/\\]") or path:match("[/\\]%.[/\\]") then
    return nil, "path_dot_segment_rejected"
  end
  local basename = path:match("([^/\\]+)$")
  if not basename or basename == "" or not basename:lower():match("%.rpp$") then
    return nil, "path_extension_invalid"
  end
  if not file_exists(path) then
    return nil, "path_not_found"
  end
  return path
end

local function d30_project_open_into_active(path)
  local open_arg = D30_PROJECT_OPEN_PREFIX .. path
  local results = { call_reaper("Main_openProject", open_arg) }
  if results[1] ~= true then
    return false, "pcall_failed_or_binding_unavailable"
  end
  if results[2] ~= nil and results[2] ~= true then
    return false, "failure_return"
  end
  return true
end

local function d30_project_list_summary_budget(request)
  local budget = safe_budget(request)
  local response_budget = math.floor(tonumber(budget.max_response_bytes) or 0)
  local fixed_envelope_reserve = 1580
  local summary_budget = math.max(response_budget - fixed_envelope_reserve, 0)
  local inline_budget = math.floor(tonumber(budget.max_inline_value_bytes) or 0)
  if inline_budget > 0 then
    summary_budget = math.min(summary_budget, math.max(inline_budget * 8, inline_budget + 512))
  end
  return summary_budget, budget
end

local function d30_project_list_build_summary(request, page, total_count, cursor, has_more)
  return {
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = "passed",
    undo_evidence = "none",
    artifacts_allowed = false,
    truncated = has_more,
    projects = page,
    total_count = total_count,
    returned_count = #page,
    cursor = cursor,
    next_cursor = has_more and tostring(cursor + #page) or nil,
    coverage_status = has_more and "paged" or "complete",
    live_materialization = "native_enum_projects_verified",
  }
end

local function list_open_projects(request)
  if is_json_array(request.refs) and #request.refs > 0 then
    return d30_project_error("REF_INVALID", "list_open_projects does not accept caller-supplied refs.", {})
  end
  local cursor = 0
  if request.params.cursor ~= nil then
    if type(request.params.cursor) == "string" then
      if request.params.cursor == "" or not request.params.cursor:match("^%d+$") then
        return d30_project_error("PARAMS_INVALID", "list_open_projects cursor must be a non-negative integer or decimal string.", {
          field = "cursor",
          blocker = "cursor_not_decimal_string",
        })
      end
      cursor = tonumber(request.params.cursor)
    elseif is_non_negative_integer(request.params.cursor) then
      cursor = request.params.cursor
    else
      return d30_project_error("PARAMS_INVALID", "list_open_projects cursor must be a non-negative integer or decimal string.", {
        field = "cursor",
        blocker = "cursor_type_invalid",
      })
    end
  end
  local limit = D30_PROJECT_LIST_DEFAULT_LIMIT
  if request.params.limit ~= nil then
    if not is_non_negative_integer(request.params.limit) or request.params.limit < 1 then
      return d30_project_error("PARAMS_INVALID", "list_open_projects limit must be a positive integer.", {
        field = "limit",
      })
    end
    limit = request.params.limit
  end
  if limit > D30_PROJECT_LIST_HARD_LIMIT then
    return d30_project_error("PARAMS_INVALID", "list_open_projects limit exceeds the hard maximum of 100.", {
      field = "limit",
      hard_limit = D30_PROJECT_LIST_HARD_LIMIT,
    })
  end
  local summary_budget, budget = d30_project_list_summary_budget(request)
  limit = math.min(limit, budget.max_items, D30_PROJECT_LIST_HARD_LIMIT)
  if limit < 1 then
    limit = 1
  end

  local rows, inventory_reason = d30_project_inventory_rows(budget.max_inline_value_bytes)
  if not rows then
    local code = "COMMAND_FAILED"
    if inventory_reason == "project_path_duplicate"
      or inventory_reason == "project_ref_duplicate"
      or inventory_reason == "project_identity_duplicate"
    then
      code = "COMMAND_FAILED"
    end
    return d30_project_error(code, "list_open_projects could not build a truthful open-project inventory.", {
      blocker = inventory_reason,
      zero_write = true,
    }, false)
  end
  local total_count = #rows
  if cursor > total_count then
    return d30_project_error("PARAMS_INVALID", "list_open_projects cursor is past the complete open-project inventory.", {
      field = "cursor",
      cursor = cursor,
      total_count = total_count,
      coverage_status = "complete",
    })
  end

  local page = json_array({})
  local max_index = math.min(total_count, cursor + limit)
  for index = cursor + 1, max_index do
    page[#page + 1] = d30_project_row_public(rows[index])
  end

  local function page_fits(candidate)
    local has_more = cursor + #candidate < total_count
    local summary = d30_project_list_build_summary(request, candidate, total_count, cursor, has_more)
    local encoded = json.encode(summary)
    return #encoded <= summary_budget, #encoded, summary
  end

  while #page > 0 do
    local fits = page_fits(page)
    if fits then
      break
    end
    table.remove(page)
  end

  if #page == 0 and cursor < total_count then
    local single = json_array({ d30_project_row_public(rows[cursor + 1]) })
    local fits, encoded_bytes = page_fits(single)
    if not fits then
      return d30_project_error("RESPONSE_TOO_LARGE", "One open-project row cannot fit within the request summary budget.", {
        blocker = "single_project_row_exceeds_budget",
        required_response_bytes = encoded_bytes,
        max_summary_bytes = summary_budget,
        max_response_bytes = budget.max_response_bytes,
        max_inline_value_bytes = budget.max_inline_value_bytes,
        project_ref = rows[cursor + 1].project_ref,
        zero_write = true,
      }, false)
    end
    page = single
  end

  local has_more = cursor + #page < total_count
  local fits, _, summary = page_fits(page)
  if not fits then
    return d30_project_error("RESPONSE_TOO_LARGE", "list_open_projects empty page cannot fit within the request summary budget.", {
      blocker = "empty_page_exceeds_budget",
      max_summary_bytes = summary_budget,
      max_response_bytes = budget.max_response_bytes,
      zero_write = true,
    }, false)
  end
  if has_more and #page == 0 then
    return d30_project_error("RESPONSE_TOO_LARGE", "list_open_projects cannot return a zero-row page while inventory remains.", {
      blocker = "zero_row_page_with_remaining",
      total_count = total_count,
      cursor = cursor,
      zero_write = true,
    }, false)
  end
  return summary
end

local function create_project_tab(request)
  local raw_name = type(request.params.name) == "string" and request.params.name or tostring(request.params.name or "")
  local name = d30_project_bounded_text(raw_name, D30_PROJECT_TAB_NAME_MAX_BYTES)
  if name == "" then
    return d30_project_error("PARAMS_INVALID", "create_project_tab requires a non-empty name.", {
      field = "name",
    })
  end
  if request.params.copy_active_project_settings == true then
    return d30_project_error("PARAMS_INVALID", "create_project_tab cannot natively prove copy_active_project_settings; refuse before mutation.", {
      field = "copy_active_project_settings",
      blocker = "copy_active_project_settings_unproven",
    })
  end
  if is_json_array(request.refs) and #request.refs > 0 then
    return d30_project_error("REF_INVALID", "create_project_tab does not accept caller-supplied refs.", {})
  end

  local prior = d30_project_current_state()
  if not prior then
    return d30_project_error("COMMAND_FAILED", "create_project_tab could not read the active project before creating a tab.", {
      blocker = "active_project_unreadable",
    }, false)
  end
  local prior_identity, prior_reason = d30_project_snapshot_identity(prior.project)
  if not prior_identity then
    return d30_project_error("COMMAND_FAILED", "create_project_tab could not snapshot the prior project identity/dirty state.", {
      blocker = prior_reason or "prior_identity_unreadable",
    }, false)
  end
  local projects_before = d30_project_open_instances()
  if not projects_before then
    return d30_project_error("COMMAND_FAILED", "create_project_tab could not enumerate open projects before creating a tab.", {
      blocker = "project_tab_preflight_enumeration_failed",
    }, false)
  end

  local created_tab, create_reason = d30_project_call_void("Main_OnCommandEx", D30_NEW_PROJECT_TAB_ACTION, 0, 0)
  if not created_tab then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected creation of a new project tab.", {
      blocker = "new_project_tab_failed",
      reason = create_reason,
    }, false)
  end
  local added, added_reason, added_count = d30_project_find_single_added_instance(projects_before)
  if not added then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("VERIFY_FAILED", "New project tab identity could not be verified exactly.", {
      blocker = added_reason,
      added_project_count = added_count,
      prior_project_restored = restored == true,
      partial_state = "blank_or_unknown_tab_may_remain",
    }, false)
  end

  local activate = request.params.activate == true
  local selection_mode = "none"
  if activate then
    local selected, select_mode = d30_project_select_exact(added.project)
    if not selected then
      local restored = d30_project_restore(prior.project)
      return d30_project_error("VERIFY_FAILED", "Created project tab but could not activate it with native readback.", {
        blocker = select_mode,
        prior_project_restored = restored == true,
        partial_state = "blank_tab_created",
      }, false)
    end
    selection_mode = select_mode
  else
    local current = d30_project_current_state()
    if current and current.project == added.project then
      if not d30_project_restore(prior.project) then
        return d30_project_error("RESTORE_FAILED", "Created project tab but could not restore the prior active project.", {
          blocker = "prior_project_restore_failed",
          partial_state = "blank_tab_created",
        }, false)
      end
      selection_mode = "restored_prior"
    end
  end

  local after_state = d30_project_state_for_instance(added.project)
  if not after_state then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("VERIFY_FAILED", "Created project tab left the inventory without a stable instance.", {
      blocker = "created_tab_not_enumerated",
      prior_project_restored = restored == true,
      partial_state = "blank_or_unknown_tab_may_remain",
    }, false)
  end
  if activate then
    local current = d30_project_current_state()
    if not current or current.project ~= added.project then
      local restored = d30_project_restore(prior.project)
      return d30_project_error("VERIFY_FAILED", "Created project tab did not remain active after selection.", {
        blocker = "created_tab_not_active",
        prior_project_restored = restored == true,
        partial_state = "blank_tab_created",
      }, false)
    end
  end

  local prior_after = d30_project_state_for_instance(prior.project)
  local prior_dirty_after = prior_after and d30_project_raw_dirty(prior.project) or nil
  if not prior_after or prior_dirty_after == nil or prior_dirty_after ~= prior_identity.raw_dirty_state then
    return d30_project_error("VERIFY_FAILED", "Prior project did not remain open with unchanged dirty state after tab creation.", {
      blocker = "prior_project_dirty_or_missing",
      prior_raw_dirty_before = prior_identity.raw_dirty_state,
      prior_raw_dirty_after = prior_dirty_after,
      partial_state = "blank_tab_created",
    }, false)
  end

  local project_ref, scheme, value = d30_project_canonical_ref(added.project, after_state.path)
  local object_ref = d30_project_ref_object(project_ref, {
    kind = "project_tab",
    name = name,
    activate = activate,
    label_only = true,
    materialization = "native_project_tab_verified",
  })
  return d30_project_summary(request, {
    project_ref = project_ref,
    name = name,
    created = true,
    activate = activate,
    active = activate,
    path_state = (after_state.path ~= "" and "saved_project") or "unsaved_project",
    openreaper_label = name,
    title_claim = "openreaper_label_only",
    selection_mode = selection_mode,
    prior_project_ref = prior_identity.project_ref,
    prior_dirty_unchanged = true,
    prior_raw_dirty_state = prior_identity.raw_dirty_state,
    live_materialization = "native_project_tab_verified",
  }), nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
end

local function open_project_in_tab(request)
  if is_json_array(request.refs) and #request.refs > 0 then
    return d30_project_error("REF_INVALID", "open_project_in_tab does not accept caller-supplied refs.", {})
  end
  local path, path_reason = d30_project_validate_open_path(request.params.path or request.params.project_path)
  if not path then
    local code = path_reason == "path_not_found" and "FILE_NOT_FOUND" or "PARAMS_INVALID"
    return d30_project_error(code, "open_project_in_tab requires one exact existing absolute .RPP path.", {
      field = "path",
      blocker = path_reason,
    }, path_reason ~= "path_not_found")
  end

  local prior = d30_project_current_state()
  if not prior then
    return d30_project_error("COMMAND_FAILED", "open_project_in_tab could not read the active project before opening.", {
      blocker = "active_project_unreadable",
    }, false)
  end
  local prior_identity, prior_reason = d30_project_snapshot_identity(prior.project)
  if not prior_identity then
    return d30_project_error("COMMAND_FAILED", "open_project_in_tab could not snapshot the prior project identity/dirty state.", {
      blocker = prior_reason or "prior_identity_unreadable",
    }, false)
  end

  local rows, inventory_reason = d30_project_inventory_rows()
  if not rows then
    return d30_project_error("COMMAND_FAILED", "open_project_in_tab could not enumerate open projects before opening.", {
      blocker = inventory_reason,
    }, false)
  end
  for index = 1, #rows do
    if rows[index].exact_path == path then
      if rows[index].duplicate_path then
        return d30_project_error("COMMAND_FAILED", "Target project path is already open more than once; refuse ambiguous open.", {
          blocker = "PROJECT_ALREADY_OPEN_AMBIGUOUS",
          project_ref = rows[index].project_ref,
        })
      end
      return d30_project_error("COMMAND_FAILED", "Target project is already open; zero-write blocker.", {
        blocker = "PROJECT_ALREADY_OPEN",
        project_ref = rows[index].project_ref,
        active = rows[index].active == true,
        zero_write = true,
      })
    end
  end

  local projects_before = d30_project_open_instances()
  if not projects_before then
    return d30_project_error("COMMAND_FAILED", "open_project_in_tab could not enumerate open projects before creating a blank tab.", {
      blocker = "project_tab_preflight_enumeration_failed",
    }, false)
  end
  local created_tab, create_reason = d30_project_call_void("Main_OnCommandEx", D30_NEW_PROJECT_TAB_ACTION, 0, 0)
  if not created_tab then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected creation of a blank project tab before open.", {
      blocker = "new_project_tab_failed",
      reason = create_reason,
    }, false)
  end
  local blank, added_reason, added_count = d30_project_find_single_added_instance(projects_before)
  if not blank then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("VERIFY_FAILED", "Blank project tab identity could not be verified exactly before open.", {
      blocker = added_reason,
      added_project_count = added_count,
      prior_project_restored = restored == true,
      partial_state = "blank_or_unknown_tab_may_remain",
      rollback_claimed = false,
    }, false)
  end

  local selected, select_mode = d30_project_select_exact(blank.project)
  if not selected then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("VERIFY_FAILED", "Blank project tab could not be activated before open.", {
      blocker = select_mode,
      prior_project_restored = restored == true,
      partial_state = "blank_tab_created",
      rollback_claimed = false,
    }, false)
  end

  local opened, open_reason = d30_project_open_into_active(path)
  if not opened then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("COMMAND_FAILED", "REAPER rejected Main_openProject after blank tab creation.", {
      blocker = "main_open_project_failed",
      reason = open_reason,
      prior_project_restored = restored == true,
      partial_state = "blank_tab_may_remain",
      rollback_claimed = false,
      recovery = "An extra blank or unknown tab may remain; OpenReaper did not claim tab closure.",
    }, false)
  end

  local opened_state = d30_project_state_for_instance(blank.project)
  local current = d30_project_current_state()
  if not opened_state or opened_state.path ~= path or not current or current.project ~= blank.project or current.path ~= path then
    local restored = d30_project_restore(prior.project)
    return d30_project_error("VERIFY_FAILED", "Opened project path/instance readback did not match the exact requested path.", {
      blocker = "open_project_path_readback_failed",
      expected_path = path,
      actual_path = opened_state and opened_state.path or (current and current.path or ""),
      prior_project_restored = restored == true,
      partial_state = "blank_or_unknown_tab_may_remain",
      rollback_claimed = false,
    }, false)
  end

  local prior_after = d30_project_state_for_instance(prior.project)
  local prior_dirty_after = prior_after and d30_project_raw_dirty(prior.project) or nil
  if not prior_after or prior_dirty_after == nil or prior_dirty_after ~= prior_identity.raw_dirty_state then
    return d30_project_error("VERIFY_FAILED", "Prior project did not remain open with unchanged dirty state after open.", {
      blocker = "prior_project_dirty_or_missing",
      prior_project_ref = prior_identity.project_ref,
      prior_raw_dirty_before = prior_identity.raw_dirty_state,
      prior_raw_dirty_after = prior_dirty_after,
      partial_state = "target_may_be_open",
      rollback_claimed = false,
    }, false)
  end

  local project_ref = "project:path:" .. path
  local object_ref = d30_project_ref_object(project_ref, {
    kind = "project",
    path = path,
    materialization = "native_open_in_tab_verified",
  })
  return d30_project_summary(request, {
    project_ref = project_ref,
    path = path,
    opened = true,
    active = true,
    prior_project_ref = prior_identity.project_ref,
    prior_project_remains_open = true,
    prior_dirty_unchanged = true,
    prior_raw_dirty_state = prior_identity.raw_dirty_state,
    selection_mode = select_mode,
    live_materialization = "native_open_in_tab_verified",
  }), nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
end

local function activate_project_tab(request)
  local project_ref, ref_reason = d30_project_parse_project_ref(request)
  if not project_ref then
    return d30_project_error("REF_INVALID", "activate_project_tab requires exactly one canonical project ref.", {
      blocker = ref_reason,
    })
  end

  local prior = d30_project_current_state()
  if not prior then
    return d30_project_error("COMMAND_FAILED", "activate_project_tab could not read the active project before selection.", {
      blocker = "active_project_unreadable",
    }, false)
  end
  local prior_identity, prior_reason = d30_project_snapshot_identity(prior.project)
  if not prior_identity then
    return d30_project_error("COMMAND_FAILED", "activate_project_tab could not snapshot the prior project identity/dirty state.", {
      blocker = prior_reason or "prior_identity_unreadable",
    }, false)
  end

  local rows, inventory_reason = d30_project_inventory_rows()
  if not rows then
    return d30_project_error("COMMAND_FAILED", "activate_project_tab could not enumerate open projects.", {
      blocker = inventory_reason,
    }, false)
  end
  local target, target_reason = d30_project_find_row_by_ref(rows, project_ref)
  if not target then
    local recoverable = target_reason == "project_ref_not_open" or target_reason == "stale_project_tab_token"
    return d30_project_error("REF_INVALID", "activate_project_tab could not resolve the exact open project ref.", {
      blocker = target_reason,
      project_ref = project_ref,
      coverage_status = "complete",
    }, recoverable)
  end

  if target.active then
    local object_ref = d30_project_ref_object(project_ref, {
      kind = "project",
      active = true,
      materialization = "native_activate_idempotent",
    })
    return d30_project_summary(request, {
      project_ref = project_ref,
      activated = true,
      already_active = true,
      selection_mode = "already_active",
      prior_project_ref = prior_identity.project_ref,
      prior_project_remains_open = true,
      prior_dirty_unchanged = true,
      prior_raw_dirty_state = prior_identity.raw_dirty_state,
      live_materialization = "native_activate_idempotent",
    }), nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
  end

  local selected, select_mode = d30_project_select_exact(target.project)
  if not selected then
    return d30_project_error("VERIFY_FAILED", "activate_project_tab could not make the exact project current.", {
      blocker = select_mode,
      project_ref = project_ref,
    }, false)
  end
  local current = d30_project_current_state()
  if not current or current.project ~= target.project then
    return d30_project_error("VERIFY_FAILED", "activate_project_tab readback did not show the exact target as current.", {
      blocker = "activation_readback_failed",
      project_ref = project_ref,
    }, false)
  end

  local prior_after = d30_project_state_for_instance(prior.project)
  local prior_dirty_after = prior_after and d30_project_raw_dirty(prior.project) or nil
  if not prior_after or prior_dirty_after == nil or prior_dirty_after ~= prior_identity.raw_dirty_state then
    return d30_project_error("VERIFY_FAILED", "Prior project did not remain open with unchanged dirty state after activation.", {
      blocker = "prior_project_dirty_or_missing",
      prior_project_ref = prior_identity.project_ref,
      prior_raw_dirty_before = prior_identity.raw_dirty_state,
      prior_raw_dirty_after = prior_dirty_after,
    }, false)
  end

  local object_ref = d30_project_ref_object(project_ref, {
    kind = "project",
    active = true,
    materialization = "native_activate_verified",
  })
  return d30_project_summary(request, {
    project_ref = project_ref,
    activated = true,
    already_active = false,
    selection_mode = select_mode,
    prior_project_ref = prior_identity.project_ref,
    prior_project_remains_open = true,
    prior_dirty_unchanged = true,
    prior_raw_dirty_state = prior_identity.raw_dirty_state,
    live_materialization = "native_activate_verified",
  }), nil, json_array({ object_ref }), json_array({}), json_array({ object_ref })
end

local function insert_subproject_item(request)
  local parent = d30_project_current_state()
  if not parent then
    return d30_project_error("COMMAND_FAILED", "insert_subproject_item could not read the active parent project.", {
      blocker = "parent_project_unreadable",
    })
  end
  local child_path, project_ref_reason = d30_project_path_from_request(request)
  if not child_path then
    return d30_project_error("REF_INVALID", "insert_subproject_item requires one exact project:path ref.", {
      blocker = project_ref_reason,
    })
  end
  local proxy_path = child_path .. "-PROX"
  if not file_exists(child_path) or not file_exists(proxy_path) then
    return d30_project_error("FILE_NOT_FOUND", "Subproject project or proxy file does not exist.", {
      child_project_path = child_path,
      proxy_path = proxy_path,
    })
  end
  local position = tonumber(request.params.position_seconds)
  if not position or position ~= position or position == math.huge or position == -math.huge or position < 0 then
    return d30_project_error("PARAMS_INVALID", "insert_subproject_item position_seconds must be a finite non-negative number.", {
      field = "position_seconds",
    })
  end
  local track, track_reason = d30_track_from_request(parent.project, request)
  if track_reason == "invalid" or track_reason == "duplicate" then
    return d30_project_error("REF_INVALID", "insert_subproject_item target track ref is invalid or duplicated.", {
      blocker = "target_track_ref_" .. track_reason,
    })
  end
  if not track then
    track = d30_first_track(parent.project)
  end
  if not track then
    return d30_project_error("TRACK_NOT_FOUND", "insert_subproject_item requires or creates a target track.", {
      blocker = "target_track_unavailable",
    })
  end

  local child_project = d30_project_find_open_by_path(child_path)
  if not child_project then
    return d30_project_error("COMMAND_FAILED", "The requested subproject must be open before its native project source can be inserted.", {
      blocker = "subproject_must_be_open_for_native_source",
      child_project_path = child_path,
    })
  end
  local child_state = d30_project_state_for_instance(child_project)
  if not child_state or child_state.path ~= child_path then
    return d30_project_error("VERIFY_FAILED", "Open subproject identity did not match the requested project ref.", {
      blocker = "open_subproject_path_mismatch",
      expected_path = child_path,
      actual_path = child_state and child_state.path or "",
    }, false)
  end

  local source, source_length, source_failure = d30_create_native_subproject_source(child_path)
  if source_failure then
    local source_destroyed = d30_destroy_source(source)
    return d30_project_error("VERIFY_FAILED", "REAPER did not create an exact native subproject source from the requested child project.", {
      blocker = source_failure,
      child_project_path = child_path,
      source_destroyed = source_destroyed,
    }, false)
  end

  local ui_snapshot = d30_snapshot_project_ui(parent.project)
  if not ui_snapshot then
    local source_destroyed = d30_destroy_source(source)
    return d30_project_error("COMMAND_FAILED", "Could not snapshot parent selection and edit cursor before subproject insertion.", {
      blocker = "parent_ui_snapshot_failed",
      source_destroyed = source_destroyed,
    }, false)
  end

  local item = nil
  local source_owned_by_take = false
  local function fail_after_mutation(code, message, details, recoverable)
    local source_destroyed = true
    if not source_owned_by_take then
      source_destroyed = d30_destroy_source(source)
    end
    local item_deleted = d30_delete_created_item(track, item)
    local parent_ui_restored = d30_restore_project_ui(parent.project, ui_snapshot)
    if not source_destroyed or not item_deleted or not parent_ui_restored then
      return d30_project_error("RESTORE_FAILED", "Subproject insertion failed and rollback did not complete.", {
        original_code = code,
        original_blocker = details and details.blocker or nil,
        source_destroyed = source_owned_by_take and nil or source_destroyed,
        item_deleted = item_deleted,
        parent_ui_restored = parent_ui_restored,
      }, false)
    end
    return d30_project_error(code, message, details, recoverable)
  end

  local ok_item, created_item = call_reaper("AddMediaItemToTrack", track)
  item = ok_item and created_item or nil
  if not item then
    return fail_after_mutation("COMMAND_FAILED", "REAPER could not create an Item for the native subproject source.", {
      blocker = "subproject_item_create_failed",
    }, false)
  end
  local ok_take, take = call_reaper("AddTakeToMediaItem", item)
  if not ok_take or not take then
    return fail_after_mutation("COMMAND_FAILED", "REAPER could not create a Take for the native subproject source.", {
      blocker = "subproject_take_create_failed",
    }, false)
  end
  local position_set, position_reason = d30_project_call_command("SetMediaItemInfo_Value", item, "D_POSITION", position)
  local length_set, length_reason = d30_project_call_command("SetMediaItemInfo_Value", item, "D_LENGTH", source_length)
  if not position_set or not length_set then
    return fail_after_mutation("COMMAND_FAILED", "REAPER rejected native subproject Item bounds.", {
      blocker = "subproject_item_bounds_write_failed",
      position_reason = position_reason,
      length_reason = length_reason,
    }, false)
  end
  local source_set, source_set_reason = d30_project_call_void("SetMediaItemTake_Source", take, source)
  if not source_set then
    return fail_after_mutation("COMMAND_FAILED", "REAPER rejected the native subproject Take source.", {
      blocker = "subproject_take_source_write_failed",
      reason = source_set_reason,
    }, false)
  end
  source_owned_by_take = true
  local item_updated, update_reason = d30_project_call_void("UpdateItemInProject", item)
  if not item_updated then
    return fail_after_mutation("COMMAND_FAILED", "REAPER rejected the native subproject Item update.", {
      blocker = "subproject_item_update_failed",
      reason = update_reason,
    }, false)
  end

  local truth = d30_item_source_truth(item, proxy_path, child_path)
  if not truth or truth.track ~= track then
    return fail_after_mutation("VERIFY_FAILED", "Inserted Item did not read back on the exact Track with a real subproject source.", {
      blocker = truth and "target_track_mismatch" or "subproject_source_readback_failed",
      proxy_path = proxy_path,
    }, false)
  end
  local ok_position, actual_position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
  if not ok_position or type(actual_position) ~= "number" or math.abs(actual_position - position) > 0.000001 then
    return fail_after_mutation("VERIFY_FAILED", "Inserted subproject Item did not read back at the requested position.", {
      blocker = "subproject_item_position_readback_failed",
      expected_position_seconds = position,
      actual_position_seconds = actual_position,
    }, false)
  end
  local ok_length, actual_length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
  if not ok_length or type(actual_length) ~= "number" or math.abs(actual_length - source_length) > 0.000001 then
    return fail_after_mutation("VERIFY_FAILED", "Inserted subproject Item did not read back at the native source length.", {
      blocker = "subproject_item_length_readback_failed",
      expected_length_seconds = source_length,
      actual_length_seconds = actual_length,
    }, false)
  end
  local requested_name = bounded_string(request.params.name or "", 160)
  if requested_name ~= "" then
    local ok_name, name_retval = call_reaper("GetSetMediaItemTakeInfo_String", truth.take, "P_NAME", requested_name, true)
    local ok_read, _, actual_name = call_reaper("GetSetMediaItemTakeInfo_String", truth.take, "P_NAME", "", false)
    if not ok_name or name_retval == false or not ok_read or actual_name ~= requested_name then
      return fail_after_mutation("VERIFY_FAILED", "Inserted subproject Item name did not read back exactly.", {
        blocker = "subproject_item_name_readback_failed",
      }, false)
    end
  end
  if not d30_restore_project_ui(parent.project, ui_snapshot) then
    local failed_item_ref = d30_item_ref(item)
    local item_deleted = d30_delete_created_item(track, item)
    return d30_project_error("RESTORE_FAILED", "Inserted subproject Item but could not restore selection and edit cursor.", {
      item_ref = failed_item_ref,
      item_deleted = item_deleted,
    }, false)
  end

  local item_ref = d30_item_ref(item)
  local child_ref = "project:path:" .. child_path
  local item_object_ref = d30_item_ref_object(item, {
    kind = "subproject_item",
    position_seconds = position,
    source_path = truth.source_path,
    source_proxy_path = truth.source_proxy_path,
    requested_proxy_path = proxy_path,
    source_path_mode = truth.source_path_mode,
    materialization = "native_subproject_source_verified",
  })
  local child_object_ref = d30_project_ref_object(child_ref, {
    kind = "subproject",
    role = "source",
    path = child_path,
  })
  return d30_project_summary(request, {
    item_ref = item_ref,
    subproject_project_ref = child_ref,
    inserted = true,
    position_seconds = position,
    proxy_path = proxy_path,
    source_path = truth.source_path,
    source_proxy_path = truth.source_proxy_path,
    requested_proxy_path = truth.requested_proxy_path,
    source_path_mode = truth.source_path_mode,
    parent_ui_restored = true,
    subproject_item_status = "native_source_verified",
    live_materialization = "native_subproject_source_verified",
  }), nil, json_array({ item_object_ref, child_object_ref }), json_array({}), json_array({ item_object_ref, child_object_ref })
end

local function render_or_update_subproject(request)
  local mode = request.params.mode or "render_or_update"
  if mode ~= "render" and mode ~= "update" and mode ~= "render_or_update" then
    return d30_project_error("PARAMS_INVALID", "render_or_update_subproject mode is invalid.", {
      mode = mode,
    })
  end
  local child_path, project_ref_reason = d30_project_path_from_request(request)
  if not child_path then
    return d30_project_error("REF_INVALID", "render_or_update_subproject requires one exact project:path ref.", {
      blocker = project_ref_reason,
    })
  end
  if not file_exists(child_path) then
    return d30_project_error("FILE_NOT_FOUND", "Subproject project file does not exist.", {
      child_project_path = child_path,
    })
  end
  local parent = d30_project_current_state()
  if not parent then
    return d30_project_error("COMMAND_FAILED", "render_or_update_subproject could not read the active parent project.", {
      blocker = "parent_project_unreadable",
    })
  end
  local linked_item = d30_item_from_request(parent.project, request)
  local item_ref_supplied = false
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      if is_object(request.refs[index]) and request.refs[index].kind == "item" then
        item_ref_supplied = true
      end
    end
  end
  if item_ref_supplied and not linked_item then
    return d30_project_error("REF_INVALID", "render_or_update_subproject optional Item ref could not be resolved exactly.", {
      blocker = "linked_item_ref_invalid",
    })
  end

  local child_project = d30_project_find_open_by_path(child_path)
  if not child_project then
    return d30_project_error("COMMAND_FAILED", "The requested subproject is not open, so OpenReaper will not risk replacing the active parent project.", {
      blocker = "subproject_must_be_open_for_native_update",
      child_project_path = child_path,
    })
  end
  local child_state = d30_project_state_for_instance(child_project)
  if not child_state or child_state.path ~= child_path then
    return d30_project_error("VERIFY_FAILED", "Open subproject identity did not match the requested project ref.", {
      blocker = "open_subproject_path_mismatch",
      expected_path = child_path,
      actual_path = child_state and child_state.path or "",
    }, false)
  end

  local rendered, render_reason = d30_project_call_void("Main_OnCommandEx", D30_SAVE_RENDER_SUBPROJECT_ACTION, 0, child_project)
  if not rendered then
    return d30_project_failure_after_restore(parent.project, "COMMAND_FAILED", "REAPER rejected native subproject save/render.", {
      blocker = "subproject_render_action_failed",
      reason = render_reason,
    }, false)
  end
  local proxy_path = child_path .. "-PROX"
  child_state = d30_project_state_for_instance(child_project)
  if not child_state or child_state.path ~= child_path or not file_exists(proxy_path) then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "Subproject proxy did not read back after native save/render.", {
      blocker = "subproject_render_readback_failed",
      proxy_path = proxy_path,
    }, false)
  end
  if not d30_project_restore(parent.project) then
    return d30_project_error("RESTORE_FAILED", "Rendered subproject but could not restore the parent project.", {
      child_project_path = child_path,
    }, false)
  end
  if linked_item and not d30_item_source_truth(linked_item, proxy_path, child_path) then
    return d30_project_error("VERIFY_FAILED", "Linked subproject Item did not retain exact source association after render.", {
      blocker = "linked_item_source_readback_failed",
      proxy_path = proxy_path,
    }, false)
  end

  local id = d30_project_safe_id(request, "subproject_job")
  local child_ref = "project:path:" .. child_path
  local job_ref = {
    kind = "job",
    ref = "job:job_id:project.subproject." .. id,
    identity = {
      scheme = "job_id",
      value = "project.subproject." .. id,
    },
    summary = {
      template_id = "template.project.render_or_update_subproject",
      pack = "project",
      mode = mode,
      state = "completed",
      synchronous = true,
    },
  }
  local child_object_ref = d30_project_ref_object(child_ref, {
    kind = "subproject",
    mode = mode,
    path = child_path,
    proxy_path = proxy_path,
    materialization = "native_rpp_proxy_verified",
  })
  return d30_project_summary(request, {
    subproject_project_ref = child_ref,
    job_ref = job_ref.ref,
    queued = false,
    completed = true,
    synchronous = true,
    mode = mode,
    proxy_path = proxy_path,
    parent_restored = true,
    linked_item_verified = linked_item ~= nil,
    live_materialization = "native_rpp_proxy_verified",
  }), nil, json_array({ child_object_ref }), json_array({ job_ref }), json_array({ child_object_ref })
end
