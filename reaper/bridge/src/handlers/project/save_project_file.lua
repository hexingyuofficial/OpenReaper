-- Alpha3.2-C3B+C3C direct project-file save handlers.

local PROJECT_FILE_SAVE_PATH_MAX_BYTES = 2048
local PROJECT_FILE_SAVE_AS_OPTIONS = 8
local PROJECT_FILE_SAVE_SUCCESS_ENVELOPE_FIXED_MAX_BYTES = 16384
local PROJECT_FILE_SAVE_JSON_ESCAPE_FACTOR = 6
local PROJECT_FILE_SAVE_JSON_FIELD_OVERHEAD_BYTES = 96
local PROJECT_FILE_SAVE_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"
local PROJECT_FILE_SAVE_MAX_STABILIZATION_ATTEMPTS = 3

local function project_file_save_continue(phase, state, next_phase_may_mutate)
  return {
    contract = PROJECT_FILE_SAVE_CONTINUATION_CONTRACT,
    phase = phase,
    state = state or {},
    mutations_may_have_happened = true,
    next_phase_may_mutate = next_phase_may_mutate == true,
  }
end

local function project_file_save_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function project_file_save_api_available(name)
  if not reaper or type(reaper.APIExists) ~= "function" then
    return false, "api_exists_unavailable"
  end
  local ok_exists, exists = pcall(reaper.APIExists, name)
  if not ok_exists then
    return false, "api_exists_pcall_failed"
  end
  if exists ~= true then
    return false, "api_unavailable"
  end
  if type(reaper[name]) ~= "function" then
    return false, "binding_unavailable"
  end
  return true
end

local function project_file_save_require_api(name)
  local available, reason = project_file_save_api_available(name)
  if available then
    return true
  end
  return project_file_save_error("INTERNAL_ERROR", "Required direct REAPER project-file API is unavailable.", {
    api = name,
    reason = reason,
  }, false)
end

local function project_file_save_current_project_state()
  local enum_ok, enum_error = project_file_save_require_api("EnumProjects")
  if not enum_ok then
    return nil, enum_error
  end
  local dirty_ok, dirty_error = project_file_save_require_api("IsProjectDirty")
  if not dirty_ok then
    return nil, dirty_error
  end
  local ok_project, project, project_path = pcall(reaper.EnumProjects, -1, "")
  if not ok_project then
    return project_file_save_error("INTERNAL_ERROR", "REAPER EnumProjects failed while reading current project file state.", {
      api = "EnumProjects",
      reason = "pcall_failed",
    }, false)
  end
  if type(project_path) ~= "string" then
    return project_file_save_error("INTERNAL_ERROR", "REAPER EnumProjects returned an invalid current project path.", {
      api = "EnumProjects",
      reason = "invalid_result",
      actual_type = type(project_path),
    }, false)
  end
  local ok_dirty, raw_dirty_state = pcall(reaper.IsProjectDirty, project)
  if not ok_dirty then
    return project_file_save_error("INTERNAL_ERROR", "REAPER IsProjectDirty failed while reading current project dirty state.", {
      api = "IsProjectDirty",
      reason = "pcall_failed",
    }, false)
  end
  if type(raw_dirty_state) ~= "number"
    or raw_dirty_state ~= raw_dirty_state
    or raw_dirty_state == math.huge
    or raw_dirty_state == -math.huge
    or raw_dirty_state < 0
    or raw_dirty_state ~= math.floor(raw_dirty_state) then
    return project_file_save_error("INTERNAL_ERROR", "REAPER IsProjectDirty returned an invalid dirty-state value.", {
      api = "IsProjectDirty",
      reason = "invalid_result",
      actual_type = type(raw_dirty_state),
      actual_value = bounded_string(raw_dirty_state, 80),
    }, false)
  end
  return {
    project = project or 0,
    path = project_path,
    dirty = raw_dirty_state > 0,
    raw_dirty_state = raw_dirty_state,
  }
end

local function project_file_save_success_budget(request, paths)
  local budget = safe_budget(request)
  local max_inline = math.min(PROJECT_FILE_SAVE_PATH_MAX_BYTES, math.floor(tonumber(budget.max_inline_value_bytes) or 0))
  local required_response_bytes = PROJECT_FILE_SAVE_SUCCESS_ENVELOPE_FIXED_MAX_BYTES
  for index = 1, #paths do
    local project_path = paths[index]
    if type(project_path) ~= "string" or max_inline < 1 or #project_path > max_inline then
      return project_file_save_error("RESPONSE_TOO_LARGE", "Exact project path exceeds the request inline-value budget; save was not attempted.", {
        blocker = "exact_path_exceeds_inline_budget",
        path_index = index,
        path_bytes = type(project_path) == "string" and #project_path or -1,
        max_inline_value_bytes = max_inline,
      })
    end
    required_response_bytes = required_response_bytes
      + (#project_path * PROJECT_FILE_SAVE_JSON_ESCAPE_FACTOR)
      + PROJECT_FILE_SAVE_JSON_FIELD_OVERHEAD_BYTES
  end
  if budget.max_response_bytes < required_response_bytes then
    return project_file_save_error("RESPONSE_TOO_LARGE", "Conservative complete success-envelope budget proof failed; save was not attempted.", {
      blocker = "success_envelope_budget_insufficient",
      required_response_bytes = required_response_bytes,
      max_response_bytes = budget.max_response_bytes,
      fixed_max_overhead_bytes = PROJECT_FILE_SAVE_SUCCESS_ENVELOPE_FIXED_MAX_BYTES,
      json_escape_factor = PROJECT_FILE_SAVE_JSON_ESCAPE_FACTOR,
      path_field_count = #paths,
    })
  end
  return true
end

local function project_file_save_project_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function project_file_save_refs()
  return json_array({ project_file_save_project_ref() })
end

local function project_file_save_summary(request, values)
  values.capability = request.pack.capability
  values.pack = "project"
  values.risk = "write"
  values.readback_status = "passed"
  values.undo_evidence = "required"
  values.artifacts_allowed = false
  values.truncated = false
  return values
end

local function project_file_save_call_void_api(api_name, ...)
  local api_ok, api_error = project_file_save_require_api(api_name)
  if not api_ok then
    return nil, api_error
  end
  local call_results = { pcall(reaper[api_name], ...) }
  if call_results[1] ~= true then
    return project_file_save_error("COMMAND_FAILED", "Direct REAPER project-file save API call failed.", {
      api = api_name,
      reason = "pcall_failed",
    }, false)
  end
  local returned = call_results[2]
  if returned ~= nil and returned ~= true then
    return project_file_save_error("COMMAND_FAILED", "Direct REAPER project-file save API returned a failure value.", {
      api = api_name,
      reason = "failure_return",
      returned_type = type(returned),
      returned_value = bounded_string(returned, 80),
    }, false)
  end
  return true
end

local function save_current_project(request)
  if not is_json_array(request.refs) or #request.refs ~= 0 then
    return project_file_save_error("REF_INVALID", "save_current_project accepts only the canonical current project and no caller-supplied refs.", {
      expected = "empty_refs_for_project_current",
    })
  end
  local before, before_error = project_file_save_current_project_state()
  if not before then
    return nil, before_error
  end
  if before.path == "" then
    return project_file_save_error("COMMAND_FAILED", "Current project is unsaved; save_current_project will not open Save As UI.", {
      blocker = "unsaved_project",
      project_ref = "project:current",
      recovery = "Use template.project.save_project_as with one validated absolute .RPP target.",
    })
  end
  local success_budget_fits, success_budget_error = project_file_save_success_budget(request, { before.path, before.path })
  if not success_budget_fits then
    return nil, success_budget_error
  end
  local saved, save_error = project_file_save_call_void_api("Main_SaveProject", before.project, false)
  if not saved then
    return nil, save_error
  end
  local after, after_error = project_file_save_current_project_state()
  if not after then
    return nil, after_error
  end
  if after.path ~= before.path then
    return project_file_save_error("VERIFY_FAILED", "save_current_project changed the exact project path unexpectedly.", {
      blocker = "project_path_mismatch",
      before_path = bounded_string(before.path, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
      after_path = bounded_string(after.path, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
    }, false)
  end
  if after.dirty or after.raw_dirty_state ~= 0 then
    return project_file_save_error("VERIFY_FAILED", "save_current_project did not read back a clean raw-zero dirty state.", {
      blocker = "project_dirty_after_save",
      after_dirty = after.dirty,
      after_raw_dirty_state = after.raw_dirty_state,
    }, false)
  end
  return project_file_save_summary(request, {
    project_ref = "project:current",
    before_path = before.path,
    after_path = after.path,
    before_dirty = before.dirty,
    before_raw_dirty_state = before.raw_dirty_state,
    after_dirty = after.dirty,
    after_raw_dirty_state = after.raw_dirty_state,
    path_unchanged = true,
    summary = "Saved the already-named current project; exact path is unchanged and dirty state is clean/raw 0.",
  }), nil, nil, nil, project_file_save_refs()
end

local function project_file_save_as_structural_target(request)
  if not is_object(request.params) or not is_string(request.params.target_path) then
    return project_file_save_error("PARAMS_INVALID", "save_project_as requires the server-validated target_path string.", {
      blocker = "validated_target_missing",
    })
  end
  if request.params.overwrite ~= true then
    return project_file_save_error("PARAMS_INVALID", "save_project_as requires explicit overwrite=true authorization for the preflight-to-REAPER dispatch race.", {
      blocker = "overwrite_true_required_for_dispatch",
      atomic_overwrite_false = "held_future",
    })
  end
  local target = request.params.target_path
  if target == "" or #target > PROJECT_FILE_SAVE_PATH_MAX_BYTES or has_control_byte(target) then
    return project_file_save_error("PARAMS_INVALID", "save_project_as target failed bounded structural validation.", {
      blocker = "target_structure_invalid",
    })
  end
  local posix_absolute = target:sub(1, 1) == "/"
  local windows_absolute = target:match("^%a:[/\\]") ~= nil or target:match("^[/\\][/\\]") ~= nil
  if not posix_absolute and not windows_absolute then
    return project_file_save_error("PARAMS_INVALID", "save_project_as target must remain absolute at the bridge boundary.", {
      blocker = "target_not_absolute",
    })
  end
  if target:match("^[%a][%w+.-]*://") or target:match("^[%a][%w+.-]*:[^/\\]") then
    return project_file_save_error("PARAMS_INVALID", "save_project_as rejects URI and URL targets at the bridge boundary.", {
      blocker = "target_uri_rejected",
    })
  end
  if target:match("[/\\]%.%.[/\\]") or target:match("[/\\]%.[/\\]") then
    return project_file_save_error("PARAMS_INVALID", "save_project_as rejects dot-segment target paths at the bridge boundary.", {
      blocker = "target_dot_segment_rejected",
    })
  end
  local basename = target:match("([^/\\]+)$")
  if not basename or basename == "" or not basename:lower():match("%.rpp$") then
    return project_file_save_error("PARAMS_INVALID", "save_project_as accepts only a non-empty .RPP target basename.", {
      blocker = "target_extension_invalid",
    })
  end
  return target, request.params.overwrite
end

local function save_project_as(request, resume_continuation)
  if not is_json_array(request.refs) or #request.refs ~= 0 then
    return project_file_save_error("REF_INVALID", "save_project_as accepts only the canonical current project and no caller-supplied refs.", {
      expected = "empty_refs_for_project_current",
    })
  end

  if resume_continuation then
    if type(resume_continuation) ~= "table"
        or resume_continuation.contract ~= PROJECT_FILE_SAVE_CONTINUATION_CONTRACT
        or type(resume_continuation.phase) ~= "string"
        or type(resume_continuation.state) ~= "table" then
      return project_file_save_error("INTERNAL_ERROR", "save_project_as received malformed continuation state.", {
        blocker = "malformed_internal_continuation",
      }, false)
    end
    local state = resume_continuation.state
    local target = state.target_path
    local overwrite = state.overwrite
    local phase = resume_continuation.phase
    local after, after_error = project_file_save_current_project_state()
    if not after then
      return nil, after_error
    end
    if after.path ~= target then
      return project_file_save_error("VERIFY_FAILED", "save_project_as continuation changed the exact project path unexpectedly.", {
        blocker = "project_path_target_mismatch_after_stabilization",
        expected_path = bounded_string(target, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
        after_path = bounded_string(after.path, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
        overwrite = overwrite,
        phase = phase,
      }, false)
    end
    local attempts = tonumber(state.stabilization_attempts) or 0
    if phase == "save_as.wait_after_save" then
      if after.dirty or after.raw_dirty_state ~= 0 then
        return project_file_save_continue("save_as.stabilize", state, true)
      end
      return project_file_save_continue("save_as.verify_stable", state, false)
    end
    if phase == "save_as.stabilize" then
      if not (after.dirty or after.raw_dirty_state ~= 0) then
        return project_file_save_continue("save_as.verify_stable", state, false)
      end
      if attempts >= PROJECT_FILE_SAVE_MAX_STABILIZATION_ATTEMPTS then
        return project_file_save_error("VERIFY_FAILED", "save_project_as stabilization exceeded its bounded retry count.", {
          blocker = "project_dirty_after_save_as",
          expected_path = bounded_string(target, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
          after_dirty = after.dirty,
          after_raw_dirty_state = after.raw_dirty_state,
          overwrite = overwrite,
          stabilization_attempts = attempts,
        }, false)
      end
      local stabilized, stabilize_error = project_file_save_call_void_api("Main_SaveProject", after.project, false)
      if not stabilized then
        return nil, stabilize_error
      end
      state.stabilization_attempts = attempts + 1
      return project_file_save_continue("save_as.verify_stable", state, false)
    end
    if phase == "save_as.verify_stable" then
      if after.dirty or after.raw_dirty_state ~= 0 then
        if attempts >= PROJECT_FILE_SAVE_MAX_STABILIZATION_ATTEMPTS then
          return project_file_save_error("VERIFY_FAILED", "save_project_as did not read back a clean raw-zero dirty state after bounded stabilization.", {
            blocker = "project_dirty_after_save_as",
            expected_path = bounded_string(target, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
            after_dirty = after.dirty,
            after_raw_dirty_state = after.raw_dirty_state,
            overwrite = overwrite,
            stabilization_attempts = attempts,
          }, false)
        end
        return project_file_save_continue("save_as.stabilize", state, true)
      end
      return project_file_save_summary(request, {
        project_ref = "project:current",
        before_path = state.before_path,
        after_path = after.path,
        before_dirty = state.before_dirty,
        before_raw_dirty_state = state.before_raw_dirty_state,
        after_dirty = after.dirty,
        after_raw_dirty_state = after.raw_dirty_state,
        target_path = target,
        overwrite = overwrite,
        path_matches_target = true,
        stabilization_attempts = attempts,
        summary = "Saved the current project as the exact validated .RPP target under explicit overwrite=true race authorization; delayed native state was stabilized and current-project identity remains canonical with dirty state clean/raw 0.",
      }), nil, nil, nil, project_file_save_refs()
    end
    return project_file_save_error("INTERNAL_ERROR", "save_project_as received an unknown continuation phase.", {
      blocker = "malformed_internal_continuation",
      phase = phase,
    }, false)
  end

  local target, overwrite_or_error = project_file_save_as_structural_target(request)
  if not target then
    return nil, overwrite_or_error
  end
  local overwrite = overwrite_or_error
  local before, before_error = project_file_save_current_project_state()
  if not before then
    return nil, before_error
  end
  local success_budget_fits, success_budget_error = project_file_save_success_budget(request, { before.path, target, target })
  if not success_budget_fits then
    return nil, success_budget_error
  end
  local saved, save_error = project_file_save_call_void_api("Main_SaveProjectEx", before.project, target, PROJECT_FILE_SAVE_AS_OPTIONS)
  if not saved then
    return nil, save_error
  end
  local after, after_error = project_file_save_current_project_state()
  if not after then
    return nil, after_error
  end
  if after.path ~= target then
    return project_file_save_error("VERIFY_FAILED", "save_project_as project path readback did not exactly match the validated target.", {
      blocker = "project_path_target_mismatch",
      before_path = bounded_string(before.path, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
      expected_path = bounded_string(target, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
      after_path = bounded_string(after.path, PROJECT_FILE_SAVE_PATH_MAX_BYTES),
      overwrite = overwrite,
    }, false)
  end
  return project_file_save_continue("save_as.wait_after_save", {
    target_path = target,
    before_path = before.path,
    before_dirty = before.dirty,
    before_raw_dirty_state = before.raw_dirty_state,
    overwrite = overwrite,
    stabilization_attempts = 0,
  }, false)
end
