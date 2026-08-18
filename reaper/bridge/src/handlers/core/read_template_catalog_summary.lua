-- Extracted Wave 1A handler: template.core.read_template_catalog_summary.

local READ_TEMPLATE_CATALOG_SUMMARY_COUNTS = {
  template_count = 242,
  by_pack = {
    actions = 8,
    analysis = 8,
    automation = 23,
    core = 3,
    fx = 19,
    items = 37,
    media = 8,
    midi = 14,
    project = 33,
    render = 26,
    routing = 21,
    system = 3,
    tracks = 23,
    transport = 16,
  },
  by_risk = {
    destructive = 16,
    read = 83,
    safe = 13,
    write = 130,
  },
  by_lifecycle = {
    experimental = 242,
  },
  by_entity_kind = {
    action = 4,
    api_symbol = 1,
    automation_item = 4,
    automation_mode = 3,
    automation_point = 8,
    channel = 5,
    cleanup_report = 1,
    command_id = 1,
    core_state = 2,
    cursor = 1,
    custom_action = 1,
    cycle_action = 1,
    delivery_report = 1,
    envelope = 8,
    fx = 6,
    fx_chain = 3,
    fx_param = 4,
    fx_reaeq_profile = 1,
    ["fx_param.envelope_mapping"] = 1,
    grid = 2,
    hardware_output = 4,
    item = 23,
    item_analysis_batch = 1,
    item_layer_report = 1,
    last_result = 1,
    loop_candidates = 1,
    loop_click_risk = 1,
    loop_qa_report = 1,
    loop_state = 3,
    marker = 5,
    marker_action = 1,
    media_file = 6,
    media_source = 2,
    midi_cc = 3,
    midi_event = 4,
    midi_item = 2,
    midi_note = 5,
    output_file = 3,
    peak = 1,
    pin_mapping = 1,
    playback_rate = 1,
    plugin = 1,
    preset = 2,
    project = 10,
    project_observation = 1,
    project_snapshot = 1,
    project_tab = 2,
    record_mode = 1,
    recording = 2,
    ["recording.punch_range"] = 1,
    ["recording.schedule"] = 1,
    region = 4,
    render_job = 1,
    ["render_job.format"] = 6,
    ["render_job.item"] = 1,
    ["render_job.item_selection"] = 1,
    ["render_job.region_track_filter"] = 1,
    ["render_job.targets"] = 1,
    ["render_job.track_item"] = 1,
    ["render_job.track_selection"] = 1,
    render_matrix = 1,
    render_region = 1,
    render_setting = 7,
    resource_path = 1,
    rms = 1,
    send = 11,
    silence = 1,
    subproject = 2,
    subproject_item = 1,
    system_state = 1,
    take = 13,
    tempo_map = 4,
    time_selection = 2,
    track = 15,
    track_folder = 4,
    track_mixer = 1,
    track_order = 2,
    track_selection = 1,
    transient = 1,
    transport = 4,
    video_processor = 1,
  },
}

local READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS = {
  template_count = 242,
  by_pack = {
    actions = 8,
    analysis = 8,
    automation = 23,
    core = 3,
    fx = 19,
    items = 37,
    media = 8,
    midi = 14,
    project = 33,
    render = 26,
    routing = 21,
    system = 3,
    tracks = 23,
    transport = 16,
  },
}

local function read_template_catalog_summary_table_key_count(source)
  local count = 0
  for _ in pairs(source or {}) do
    count = count + 1
  end
  return count
end

local function read_template_catalog_summary_clone_counts(source)
  local result = {}
  for key, value in pairs(source or {}) do
    result[key] = value
  end
  return result
end

local function read_template_catalog_summary_count_for_key(source, key)
  local result = {}
  result[key] = source[key]
  return result
end

local function read_template_catalog_summary_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function read_template_catalog_summary(request)
  local pack = is_string(request.params.pack) and request.params.pack or nil
  if pack and not READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack[pack] then
    return read_template_catalog_summary_error("PARAMS_INVALID", "Requested pack is not in the accepted runtime catalog.", {
      pack = bounded_string(pack, 80),
    })
  end

  local template_count = pack and READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack[pack] or READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.template_count
  local live_supported_template_count = pack and READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack[pack] or READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.template_count
  local summary = {
    template_count = template_count,
    accepted_runtime_template_count = template_count,
    live_supported_template_count = live_supported_template_count,
    catalog_count_semantics = "template_count is the accepted runtime catalog count; live_supported_template_count is the current bridge handler row count.",
    pack_count = pack and 1 or read_template_catalog_summary_table_key_count(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack),
    by_pack = pack and read_template_catalog_summary_count_for_key(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack, pack) or read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_pack),
    live_supported_by_pack = pack and read_template_catalog_summary_count_for_key(READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack, pack) or read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS.by_pack),
    by_lifecycle = request.params.include_lifecycle_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_lifecycle) or nil,
    by_risk = request.params.include_risk_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_risk) or nil,
    by_entity_kind = request.params.include_entity_kind_counts == true and read_template_catalog_summary_clone_counts(READ_TEMPLATE_CATALOG_SUMMARY_COUNTS.by_entity_kind) or nil,
    truncated = false,
  }
  return summary
end
