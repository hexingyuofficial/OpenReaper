-- Extracted D30 handler: native project tab/subproject container lifecycle.

local D30_NEW_PROJECT_TAB_ACTION = 40859
local D30_NEXT_PROJECT_TAB_ACTION = 40861
local D30_SAVE_RENDER_SUBPROJECT_ACTION = 42332
local D30_SAVE_AS_OPTIONS = 8

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
    local command_project = current and current.project or target_project
    local advanced = d30_project_call_void("Main_OnCommandEx", D30_NEXT_PROJECT_TAB_ACTION, 0, command_project)
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
  for index = 1, #before do
    known[before[index].project] = true
  end
  local added = nil
  local added_count = 0
  for index = 1, #after do
    if not known[after[index].project] then
      added = after[index]
      added_count = added_count + 1
    end
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

local function d30_item_set(project)
  local ok_count, count = call_reaper("CountMediaItems", project)
  if not ok_count then
    return nil
  end
  local result = {}
  for index = 0, (first_number(count) or 0) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, index)
    if not ok_item or not item then
      return nil
    end
    result[item] = true
  end
  return result
end

local function d30_unique_new_item(project, before)
  local after = d30_item_set(project)
  if not after then
    return nil, 0
  end
  local found = nil
  local count = 0
  for item in pairs(after) do
    if not before[item] then
      found = item
      count = count + 1
    end
  end
  return count == 1 and found or nil, count
end

local function d30_item_source_truth(item, expected_proxy_path)
  local ok_track, track = call_reaper("GetMediaItem_Track", item)
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_track or not track or not ok_take or not take then
    return nil
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return nil
  end
  local ok_path, path_a, path_b = call_reaper("GetMediaSourceFileName", source, "")
  local source_path = ok_path and first_string(path_a, path_b) or nil
  local ok_subproject, subproject = call_reaper("GetSubProjectFromSource", source)
  if source_path ~= expected_proxy_path or not ok_subproject or not subproject then
    return nil
  end
  return {
    track = track,
    take = take,
    source = source,
    subproject = subproject,
    source_path = source_path,
  }
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
  local created_tab, create_reason = d30_project_call_void("Main_OnCommandEx", D30_NEW_PROJECT_TAB_ACTION, 0, parent.project)
  if not created_tab then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected creation of a new project tab for the subproject.", {
      blocker = "new_project_tab_failed",
      reason = create_reason,
    }, false)
  end
  local child = d30_project_current_state()
  if not child or child.project == parent.project then
    local added, added_reason, added_count = d30_project_find_single_added_instance(projects_before)
    if not added then
      return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "New project tab identity could not be verified exactly.", {
        blocker = added_reason,
        added_project_count = added_count,
      }, false)
    end
    local selected, selection_reason = d30_project_select_exact(added.project)
    if not selected then
      return d30_project_failure_after_restore(parent.project, "COMMAND_FAILED", "REAPER created a new project tab but rejected selecting its exact project instance.", {
        blocker = "new_project_tab_selection_failed",
        reason = selection_reason,
      }, false)
    end
    child = d30_project_current_state()
    if not child or child.project ~= added.project then
      return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "The exact newly created project tab did not become active after native selection.", {
        blocker = "new_project_tab_selection_readback_failed",
      }, false)
    end
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
  child = d30_project_current_state()
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

local function create_project_tab(request)
  local name = bounded_string(request.params.name or "", 160)
  if name == "" then
    return d30_project_error("PARAMS_INVALID", "create_project_tab requires a non-empty name.", {
      field = "name",
    })
  end
  local id = d30_project_safe_id(request, "project_tab")
  local project_ref = "project:tab:" .. id
  local row = {
    kind = "project_tab",
    id = id,
    name = name,
    activate = request.params.activate == true,
    copy_active_project_settings = request.params.copy_active_project_settings == true,
    materialization = "ledger_only_waiting_fixture",
  }
  if not d30_project_write_ledger(request, id, row) then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected project-tab ledger write.", {
      blocker = "project_ext_state_write_failed",
    }, false)
  end
  local object_ref = d30_project_ref_object(project_ref, row)
  return d30_project_summary(request, {
    project_ref = project_ref,
    name = name,
    created = true,
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

  local ui_snapshot = d30_snapshot_project_ui(parent.project)
  local items_before = d30_item_set(parent.project)
  if not ui_snapshot or not items_before then
    return d30_project_error("COMMAND_FAILED", "Could not snapshot parent selection and item identity before subproject insertion.", {
      blocker = "parent_ui_snapshot_failed",
    }, false)
  end
  for selected_track in pairs(ui_snapshot.tracks) do
    call_reaper("SetTrackSelected", selected_track, selected_track == track)
  end
  call_reaper("SetEditCurPos2", parent.project, position, false, false)

  local inserted, insert_reason = d30_project_call_command("InsertMedia", proxy_path, 0)
  if not inserted then
    d30_restore_project_ui(parent.project, ui_snapshot)
    return d30_project_error("COMMAND_FAILED", "REAPER rejected insertion of the subproject proxy.", {
      blocker = "insert_media_failed",
      reason = insert_reason,
    }, false)
  end
  local item, new_item_count = d30_unique_new_item(parent.project, items_before)
  if not item then
    d30_restore_project_ui(parent.project, ui_snapshot)
    return d30_project_error("VERIFY_FAILED", "Subproject insertion did not create exactly one identifiable Item.", {
      blocker = "new_item_identity_ambiguous",
      new_item_count = new_item_count,
    }, false)
  end
  local truth = d30_item_source_truth(item, proxy_path)
  if not truth or truth.track ~= track then
    d30_restore_project_ui(parent.project, ui_snapshot)
    return d30_project_error("VERIFY_FAILED", "Inserted Item did not read back on the exact Track with a real subproject source.", {
      blocker = truth and "target_track_mismatch" or "subproject_source_readback_failed",
      proxy_path = proxy_path,
    }, false)
  end
  local ok_position, actual_position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
  if not ok_position or type(actual_position) ~= "number" or math.abs(actual_position - position) > 0.000001 then
    d30_restore_project_ui(parent.project, ui_snapshot)
    return d30_project_error("VERIFY_FAILED", "Inserted subproject Item did not read back at the requested position.", {
      blocker = "subproject_item_position_readback_failed",
      expected_position_seconds = position,
      actual_position_seconds = actual_position,
    }, false)
  end
  local requested_name = bounded_string(request.params.name or "", 160)
  if requested_name ~= "" then
    local ok_name, name_retval = call_reaper("GetSetMediaItemTakeInfo_String", truth.take, "P_NAME", requested_name, true)
    local ok_read, _, actual_name = call_reaper("GetSetMediaItemTakeInfo_String", truth.take, "P_NAME", "", false)
    if not ok_name or name_retval == false or not ok_read or actual_name ~= requested_name then
      d30_restore_project_ui(parent.project, ui_snapshot)
      return d30_project_error("VERIFY_FAILED", "Inserted subproject Item name did not read back exactly.", {
        blocker = "subproject_item_name_readback_failed",
      }, false)
    end
  end
  if not d30_restore_project_ui(parent.project, ui_snapshot) then
    return d30_project_error("RESTORE_FAILED", "Inserted subproject Item but could not restore selection and edit cursor.", {
      item_ref = d30_item_ref(item),
    }, false)
  end

  local item_ref = d30_item_ref(item)
  local child_ref = "project:path:" .. child_path
  local item_object_ref = d30_item_ref_object(item, {
    kind = "subproject_item",
    position_seconds = position,
    source_path = proxy_path,
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
  if child_project then
    local selected, selection_reason = d30_project_select_exact(child_project)
    if not selected then
      return d30_project_error("COMMAND_FAILED", "REAPER could not activate the requested subproject tab.", {
        blocker = "subproject_tab_activation_failed",
        reason = selection_reason,
      }, false)
    end
  else
    local created = d30_project_call_void("Main_OnCommandEx", D30_NEW_PROJECT_TAB_ACTION, 0, parent.project)
    if not created then
      return d30_project_error("COMMAND_FAILED", "REAPER could not create a tab to open the requested subproject.", {
        blocker = "subproject_open_tab_failed",
      }, false)
    end
    local opened = d30_project_call_void("Main_openProject", child_path)
    if not opened then
      return d30_project_failure_after_restore(parent.project, "COMMAND_FAILED", "REAPER could not open the requested subproject path.", {
        blocker = "subproject_open_failed",
      }, false)
    end
    local opened_state = d30_project_current_state()
    child_project = opened_state and opened_state.project or nil
  end
  local active_child = d30_project_current_state()
  if not child_project or not active_child or active_child.project ~= child_project or active_child.path ~= child_path then
    return d30_project_failure_after_restore(parent.project, "VERIFY_FAILED", "Active subproject path did not match the requested project ref.", {
      blocker = "active_subproject_path_mismatch",
      expected_path = child_path,
      actual_path = active_child and active_child.path or "",
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
  active_child = d30_project_current_state()
  if not active_child or active_child.path ~= child_path or not file_exists(proxy_path) then
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
  if linked_item and not d30_item_source_truth(linked_item, proxy_path) then
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
