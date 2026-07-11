local A1_ARTIFACT_OPERATIONS = {
  ["run_job:analysis.detect_loop_candidates"] = true,
  ["run_job:analysis.measure_loop_click_risk"] = true,
  ["run_job:analysis.create_loop_qa_report"] = true,
  ["run_job:analysis.measure_item_rms"] = true,
  ["run_job:analysis.measure_item_peaks"] = true,
  ["run_job:analysis.detect_item_silence"] = true,
  ["run_job:analysis.detect_item_transients"] = true,
  ["run_job:project.create_cleanup_report"] = true,
  ["run_job:project.create_project_map_snapshot"] = true,
  ["run_job:project.create_observation_bundle"] = true,
}

local FX_ARTIFACT_OPERATIONS = {
  ["query_state:fx.read_video_processor_code"] = true,
}

local A2_ARTIFACT_OPERATIONS = {
  ["run_job:render.region_wav"] = true,
  ["run_job:render.delivery_report.create"] = true,
  ["run_job:render.item"] = true,
  ["run_job:render.selected_item"] = true,
  ["run_job:render.track_item"] = true,
  ["run_job:render.selected_tracks"] = true,
  ["run_job:render.ogg"] = true,
  ["run_job:render.mp3"] = true,
  ["run_job:render.flac"] = true,
  ["run_job:render.aiff"] = true,
  ["run_job:render.m4a"] = true,
  ["run_job:render.opus"] = true,
  ["run_job:render.region_track_filter"] = true,
  ["run_job:render.targets"] = true,
}

local A3_ARTIFACT_OPERATIONS = {
  ["run_job:items.create_layer_report"] = true,
}

local ARTIFACT_PRODUCING_OPERATIONS = {}
for key, value in pairs(A1_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(FX_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(A2_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end
for key, value in pairs(A3_ARTIFACT_OPERATIONS) do
  ARTIFACT_PRODUCING_OPERATIONS[key] = value
end

local A1_ARTIFACT_SPECS = {
  ["run_job:analysis.detect_loop_candidates"] = {
    template_id = "template.analysis.detect_loop_candidates",
    owner_pack = "analysis",
    scope = "loop_candidates",
    schema = "analysis.loop_candidates.v1",
  },
  ["run_job:analysis.measure_loop_click_risk"] = {
    template_id = "template.analysis.measure_loop_click_risk",
    owner_pack = "analysis",
    scope = "loop_click_risk",
    schema = "analysis.loop_click_risk.v1",
  },
  ["run_job:analysis.create_loop_qa_report"] = {
    template_id = "template.analysis.create_loop_qa_report",
    owner_pack = "analysis",
    scope = "loop_qa_report",
    schema = "analysis.loop_qa_report.v1",
  },
  ["run_job:project.create_cleanup_report"] = {
    template_id = "template.project.create_cleanup_report",
    owner_pack = "project",
    scope = "cleanup_report",
    schema = "project.cleanup_report.v1",
  },
  ["run_job:project.create_project_map_snapshot"] = {
    template_id = "template.project.create_project_map_snapshot",
    owner_pack = "project",
    scope = "project_map_snapshot",
    schema = "project.project_map_snapshot.v1",
  },
  ["run_job:project.create_observation_bundle"] = {
    template_id = "template.project.create_observation_bundle",
    owner_pack = "project",
    scope = "observation_bundle",
    schema = "project.observation_bundle.v1",
  },
  ["run_job:analysis.measure_item_rms"] = {
    template_id = "template.analysis.measure_item_rms",
    owner_pack = "analysis",
    scope = "item_rms_report",
    schema = "analysis.item_rms.v1",
  },
  ["run_job:analysis.measure_item_peaks"] = {
    template_id = "template.analysis.measure_item_peaks",
    owner_pack = "analysis",
    scope = "item_peaks_report",
    schema = "analysis.item_peaks.v1",
  },
  ["run_job:analysis.detect_item_silence"] = {
    template_id = "template.analysis.detect_item_silence",
    owner_pack = "analysis",
    scope = "item_silence_report",
    schema = "analysis.item_silence.v1",
  },
  ["run_job:analysis.detect_item_transients"] = {
    template_id = "template.analysis.detect_item_transients",
    owner_pack = "analysis",
    scope = "item_transients_report",
    schema = "analysis.item_transients.v1",
  },
}

local A2_ARTIFACT_SPECS = {
  region_wav_output = {
    template_id = "template.render.render_region_wav",
    owner_pack = "render",
    scope = "region_wav_output",
    schema = "render.region_wav_output.v1",
  },
  render_job_evidence = {
    template_id = "template.render.render_region_wav",
    owner_pack = "render",
    scope = "render_job_evidence",
    schema = "render.render_job_evidence.v1",
  },
  delivery_report = {
    template_id = "template.render.create_delivery_report",
    owner_pack = "render",
    scope = "delivery_report",
    schema = "render.delivery_report.v1",
  },
}

local FX_ARTIFACT_SPECS = {
  video_processor_code = {
    template_id = "template.fx.read_video_processor_code",
    owner_pack = "fx",
    scope = "video_processor_code",
    schema = "fx.video_processor_code.v1",
  },
}

local A3_ARTIFACT_SPECS = {
  layer_evidence = {
    template_id = "template.items.fixture_layer_evidence",
    owner_pack = "items",
    scope = "layer_evidence",
    schema = "items.layer_evidence.v1",
  },
  layer_report = {
    template_id = "template.items.create_layer_report",
    owner_pack = "items",
    scope = "layer_report",
    schema = "items.layer_report.v1",
  },
}

local A1_LOOP_CANDIDATES_INPUT = {
  owner_pack = "analysis",
  scope = "loop_candidates",
  schema = "analysis.loop_candidates.v1",
}

local A1_LOOP_CLICK_RISK_INPUT = {
  owner_pack = "analysis",
  scope = "loop_click_risk",
  schema = "analysis.loop_click_risk.v1",
}

local function valid_lower_snake(value)
  return type(value) == "string" and value:match("^[a-z][a-z0-9_]*$") ~= nil
end

local function parse_artifact_ref(ref)
  if not is_string(ref) then
    return nil, "Artifact ref must be a non-empty string."
  end
  if ref:find("/", 1, true) or ref:find("\\", 1, true) or ref:sub(1, 7) == "file://" or ref:sub(1, 1) == "~" then
    return nil, "Artifact ref must not be a raw path."
  end
  local owner_pack, scope, id = ref:match("^artifact:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*):(art_%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d_%d%d%d_[a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])$")
  if not owner_pack then
    return nil, "Malformed artifact ref; expected artifact:<owner_pack>:<scope>:<id>."
  end
  if not FIXED_PACKS[owner_pack] then
    return nil, "Invalid artifact owner_pack."
  end
  if WORKFLOW_SHAPED_IDS[owner_pack] or WORKFLOW_SHAPED_IDS[scope] then
    return nil, "Workflow-shaped artifact owner or scope is forbidden."
  end
  return {
    owner_pack = owner_pack,
    scope = scope,
    id = id,
    ref = ref,
  }
end

local function validate_schema(schema)
  if type(schema) ~= "string" or #schema > 160 then
    return false
  end
  if schema:find("..", 1, true) or schema:sub(1, 1) == "." or schema:sub(-1) == "." then
    return false
  end
  local segments = {}
  for segment in schema:gmatch("[^.]+") do
    segments[#segments + 1] = segment
  end
  if #segments < 3 or not segments[#segments]:match("^v%d+$") then
    return false
  end
  for index = 1, #segments - 1 do
    if not valid_lower_snake(segments[index]) then
      return false
    end
  end
  return true
end

local function artifact_id_from_request(request)
  local timestamp, sequence, suffix = tostring(request and request.id or ""):match("^cmd_(%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d%d)_(%d%d%d)_([a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9][a-f0-9])$")
  if not timestamp then
    return nil
  end
  return "art_" .. timestamp .. "_" .. sequence .. "_" .. suffix
end

local function artifact_path(parts)
  local artifact_dir = path_join(path_join(ARTIFACT_ROOT, parts.owner_pack), parts.scope)
  return artifact_dir, path_join(artifact_dir, parts.id .. ".json")
end

local function artifact_object_ref(parts, schema)
  return {
    kind = "artifact",
    ref = parts.ref,
    identity = {
      scheme = "artifact_ref",
      value = parts.ref,
    },
    summary = {
      schema = schema,
      owner_pack = parts.owner_pack,
      scope = parts.scope,
    },
  }
end

local function artifact_ref_for_request(request, spec)
  local artifact_id = artifact_id_from_request(request)
  if not artifact_id then
    return nil, "Command id cannot derive a canonical artifact id."
  end
  return "artifact:" .. spec.owner_pack .. ":" .. spec.scope .. ":" .. artifact_id
end

local function artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A1 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A1 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a1_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A1 artifact ref does not match the operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local producer = {
    kind = "template",
    id = spec.template_id,
    pack = spec.owner_pack,
  }
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = producer,
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A1 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A1 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function a2_artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A2 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A2 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a2_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = a2_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= "render" or parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A2 artifact ref does not match the render operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = {
      kind = "template",
      id = spec.template_id,
      pack = spec.owner_pack,
    },
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A2 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A2 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  if file_exists(path_value) then
    return nil, {
      code = "IDEMPOTENCY_CONFLICT",
      message = "A2 artifact ref collision would overwrite existing evidence.",
      details = {
        blocker = "artifact_ref_collision",
        ref = ref,
      },
      recoverable = false,
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function a3_artifact_root_ready()
  if not ARTIFACT_ROOT then
    return false, "artifact_root_not_configured", "First-Real-Fixture-A A3 artifact root is not configured."
  end
  if ARTIFACT_ROOT:sub(1, 7) == "file://" or not is_absolute_path(ARTIFACT_ROOT) then
    return false, "artifact_root_invalid", "First-Real-Fixture-A A3 artifact root must be an absolute filesystem path."
  end
  return true
end

local function write_a3_artifact(request, spec, summary, payload)
  local root_ok, blocker, root_message = a3_artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end

  local ref, ref_error = artifact_ref_for_request(request, spec)
  if not ref then
    return nil, {
      code = "PARAMS_INVALID",
      message = ref_error,
      details = { field = "id" },
    }
  end

  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if parts.owner_pack ~= "items" or parts.owner_pack ~= spec.owner_pack or parts.scope ~= spec.scope then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A3 artifact ref does not match the items layer-report operation owner/scope.",
      details = {
        expected_owner_pack = spec.owner_pack,
        expected_scope = spec.scope,
      },
    }
  end
  if not validate_schema(spec.schema) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "Artifact schema must use dotted lower-snake grammar with a vN suffix.",
      details = { schema = spec.schema },
    }
  end

  summary.artifact_ref = ref
  summary.schema = spec.schema
  local envelope = {
    contract = ARTIFACT_CONTRACT,
    ref = ref,
    id = parts.id,
    owner_pack = parts.owner_pack,
    scope = parts.scope,
    schema = spec.schema,
    producer = {
      kind = "template",
      id = spec.template_id,
      pack = spec.owner_pack,
    },
    created_at = request.created_at,
    summary = summary,
    payload = payload,
  }

  local encoded = json.encode(envelope)
  if #json.encode(summary) > 2048 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A3 artifact summary exceeded the artifact.state_store.v1 summary budget.",
      details = { summary_bytes = #json.encode(summary) },
    }
  end
  if #json.encode(payload) > 65536 then
    return nil, {
      code = "RESPONSE_TOO_LARGE",
      message = "A3 artifact payload exceeded the artifact.state_store.v1 payload budget.",
      details = { payload_bytes = #json.encode(payload) },
    }
  end

  local artifact_dir, path_value = artifact_path(parts)
  local dir_ok, dir_error = ensure_directory(artifact_dir)
  if not dir_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 artifact directory could not be created.",
      details = {
        blocker = "artifact_directory_unavailable",
        message = dir_error,
      },
    }
  end
  if file_exists(path_value) then
    return nil, {
      code = "IDEMPOTENCY_CONFLICT",
      message = "A3 artifact ref collision would overwrite existing layer-report evidence.",
      details = {
        blocker = "artifact_ref_collision",
        ref = ref,
      },
      recoverable = false,
    }
  end
  local write_ok, write_error = write_file_atomic(path_value, encoded .. "\n")
  if not write_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 artifact envelope could not be written.",
      details = {
        blocker = "artifact_write_failed",
        message = bounded_string(write_error, 160),
      },
    }
  end

  return {
    ref = ref,
    object_ref = artifact_object_ref(parts, spec.schema),
    bytes = #encoded + 1,
  }
end

local function read_artifact_envelope(ref, expected)
  expected = expected or {}
  local root_ok, blocker, root_message = artifact_root_ready()
  if not root_ok then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = root_message,
      details = {
        blocker = blocker,
        artifact_root_env = ARTIFACT_ROOT_ENV,
      },
    }
  end
  local parts, parse_error_message = parse_artifact_ref(ref)
  if not parts then
    return nil, {
      code = "PARAMS_INVALID",
      message = parse_error_message,
      details = { field = "artifact_ref" },
    }
  end
  if (expected.owner_pack and parts.owner_pack ~= expected.owner_pack)
    or (expected.scope and parts.scope ~= expected.scope) then
    return nil, {
      code = "PARAMS_INVALID",
      message = "A1 input artifact ref does not match the expected owner/scope.",
      details = {
        field = "artifact_ref",
        expected_owner_pack = expected.owner_pack,
        expected_scope = expected.scope,
      },
    }
  end
  local _, path_value = artifact_path(parts)
  local raw = read_file(path_value)
  if not raw then
    return nil, {
      code = "ARTIFACT_NOT_FOUND",
      message = "A1 input artifact was not found in the configured artifact root.",
      details = { ref = ref },
    }
  end
  local decoded_ok, envelope_or_error = pcall(json.decode, raw)
  if not decoded_ok or not is_object(envelope_or_error) then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 input artifact JSON could not be parsed.",
      details = { ref = ref },
    }
  end
  if envelope_or_error.contract ~= ARTIFACT_CONTRACT
    or envelope_or_error.ref ~= ref
    or envelope_or_error.id ~= parts.id
    or envelope_or_error.owner_pack ~= parts.owner_pack
    or envelope_or_error.scope ~= parts.scope
    or envelope_or_error.schema ~= expected.schema
    or (expected.owner_pack and envelope_or_error.owner_pack ~= expected.owner_pack)
    or (expected.scope and envelope_or_error.scope ~= expected.scope) then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A1 input artifact envelope does not match the expected schema/ref/owner/scope.",
      details = {
        ref = ref,
        expected_schema = expected.schema,
        expected_owner_pack = expected.owner_pack,
        expected_scope = expected.scope,
      },
    }
  end
  return envelope_or_error
end
