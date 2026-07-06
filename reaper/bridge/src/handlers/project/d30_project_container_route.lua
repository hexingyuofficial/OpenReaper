-- Extracted D30 handler: bounded project tab/subproject container ledger.

local function d30_project_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d30_project_current()
  local ok, project = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0
  end
  return 0
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
  return {
    kind = "project",
    ref = ref,
    identity = {
      scheme = ref:match("^project:([^:]+):") or "current",
      value = ref,
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
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = ref:match("^item:([^:]+):") or "placeholder",
      value = ref,
    },
    summary = summary,
  }
end

local function d30_project_write_ledger(request, key, row)
  local project = d30_project_current()
  local ok = call_reaper("SetProjExtState", project, "OPENREAPER_PROJECT_CONTAINERS", key, json.encode(row))
  if not ok then
    return false
  end
  return true
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
  fields.live_materialization = "ledger_only_waiting_fixture"
  return fields
end

local function create_subproject(request)
  local name = bounded_string(request.params.name or "", 160)
  if name == "" then
    return d30_project_error("PARAMS_INVALID", "create_subproject requires a non-empty name.", {
      field = "name",
    })
  end
  local id = d30_project_safe_id(request, "subproject")
  local subproject_ref = "project:subproject:" .. id
  local parent_ref = "project:current"
  local row = {
    kind = "subproject",
    id = id,
    name = name,
    parent_project_ref = parent_ref,
    activate = request.params.activate == true,
    inherit_time_selection = request.params.inherit_time_selection == true,
    materialization = "ledger_only_waiting_fixture",
  }
  if not d30_project_write_ledger(request, id, row) then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected subproject ledger write.", {
      blocker = "project_ext_state_write_failed",
    }, false)
  end
  local subproject_object_ref = d30_project_ref_object(subproject_ref, row)
  local parent_object_ref = d30_project_ref_object(parent_ref, { kind = "project", role = "parent" })
  return d30_project_summary(request, {
    subproject_project_ref = subproject_ref,
    parent_project_ref = parent_ref,
    name = name,
    created = true,
  }), nil, json_array({ subproject_object_ref, parent_object_ref }), json_array({}), json_array({ subproject_object_ref, parent_object_ref })
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

local function d30_first_track()
  local ok_track, track = call_reaper("GetTrack", 0, 0)
  if ok_track and track then
    return track
  end
  local ok_insert = call_reaper("InsertTrackAtIndex", 0, true)
  if not ok_insert then
    return nil
  end
  ok_track, track = call_reaper("GetTrack", 0, 0)
  return ok_track and track or nil
end

local function insert_subproject_item(request)
  local track = d30_first_track()
  if not track then
    return d30_project_error("TRACK_NOT_FOUND", "insert_subproject_item requires or creates a target track.", {
      blocker = "target_track_unavailable",
    })
  end
  local ok_item, item = call_reaper("AddMediaItemToTrack", track)
  if not ok_item or not item then
    return d30_project_error("COMMAND_FAILED", "REAPER rejected placeholder subproject item creation.", {
      blocker = "add_media_item_failed",
    }, false)
  end
  local position = tonumber(request.params.position_seconds) or 0
  if position < 0 then
    position = 0
  end
  call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", position)
  call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", 1)
  local item_ref = d30_item_ref(item)
  local subproject_ref = "project:subproject:" .. d30_project_safe_id(request, "linked")
  local item_object_ref = d30_item_ref_object(item, {
    kind = "subproject_item_placeholder",
    position_seconds = position,
    materialization = "placeholder_item_waiting_fixture",
  })
  local subproject_object_ref = d30_project_ref_object(subproject_ref, {
    kind = "subproject",
    role = "source",
    materialization = "ledger_only_waiting_fixture",
  })
  return d30_project_summary(request, {
    item_ref = item_ref,
    subproject_project_ref = subproject_ref,
    inserted = true,
    position_seconds = position,
    subproject_item_status = "placeholder_item_waiting_fixture",
  }), nil, json_array({ item_object_ref, subproject_object_ref }), json_array({}), json_array({ item_object_ref, subproject_object_ref })
end

local function render_or_update_subproject(request)
  local mode = request.params.mode or "render_or_update"
  if mode ~= "render" and mode ~= "update" and mode ~= "render_or_update" then
    return d30_project_error("PARAMS_INVALID", "render_or_update_subproject mode is invalid.", {
      mode = mode,
    })
  end
  local id = d30_project_safe_id(request, "subproject_job")
  local subproject_ref = "project:subproject:" .. id
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
      materialization = "ledger_only_waiting_fixture",
    },
  }
  local subproject_object_ref = d30_project_ref_object(subproject_ref, {
    kind = "subproject",
    mode = mode,
    materialization = "ledger_only_waiting_fixture",
  })
  return d30_project_summary(request, {
    subproject_project_ref = subproject_ref,
    job_ref = job_ref.ref,
    queued = true,
    mode = mode,
  }), nil, json_array({ subproject_object_ref }), json_array({ job_ref }), json_array({ subproject_object_ref })
end
