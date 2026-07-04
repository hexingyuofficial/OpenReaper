local SAFE_WRITE_A_CAPABILITIES = {
  ["project.set_metadata_field"] = { pack = "project", risk = "write" },
  ["project.create_marker"] = { pack = "project", risk = "write" },
  ["project.create_region"] = { pack = "project", risk = "write" },
  ["track.create"] = { pack = "tracks", risk = "write" },
  ["track.rename"] = { pack = "tracks", risk = "write" },
  ["track.set_color"] = { pack = "tracks", risk = "write" },
  ["track.select"] = { pack = "tracks", risk = "write" },
  ["track.set_mute"] = { pack = "tracks", risk = "write" },
  ["track.set_solo"] = { pack = "tracks", risk = "write" },
  ["transport.set_edit_cursor"] = { pack = "transport", risk = "safe" },
  ["transport.set_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.clear_time_selection"] = { pack = "transport", risk = "safe" },
  ["transport.set_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.clear_loop_points"] = { pack = "transport", risk = "safe" },
  ["transport.set_repeat"] = { pack = "transport", risk = "safe" },
  ["items.move_item"] = { pack = "items", risk = "write" },
  ["items.trim_item"] = { pack = "items", risk = "write" },
  ["items.set_item_fades"] = { pack = "items", risk = "write" },
  ["items.set_take_pitch"] = { pack = "items", risk = "write" },
  ["items.set_item_snap_offset"] = { pack = "items", risk = "write" },
  ["midi.create_midi_item"] = { pack = "midi", risk = "write" },
  ["midi.insert_notes_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_cc_batch"] = { pack = "midi", risk = "write" },
  ["midi.insert_text_sysex_events"] = { pack = "midi", risk = "write" },
}

local function safe_write_a_capability(request, operation_key)
  if operation_key ~= "run_command:template.execute" then
    return nil
  end
  if not is_object(request and request.pack) then
    return nil
  end
  return SAFE_WRITE_A_CAPABILITIES[request.pack.capability]
end

local function open_required_undo_block(request, operation_key)
  if not safe_write_a_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_BeginBlock2", project)
  if not ok then
    ok = call_reaper("Undo_BeginBlock")
  end
  request.__openreaper_undo_opened = ok == true
end

local function close_required_undo_block(request, operation_key)
  if not safe_write_a_capability(request, operation_key) then
    return
  end
  if not is_object(request) or not is_object(request.undo) or request.undo.mode ~= "required" then
    return
  end
  local label = is_string(request.undo.label) and request.undo.label or "OpenReaper Safe-Write-A"
  local ok_project, project = call_reaper("EnumProjects", -1, "")
  project = ok_project and project or 0
  local ok = call_reaper("Undo_EndBlock2", project, label, -1)
  if not ok then
    ok = call_reaper("Undo_EndBlock", label, -1)
  end
  request.__openreaper_undo_closed = ok == true
end

local function validate_request(request)
  if not is_object(request) then
    return false, "Bridge request must be an object."
  end
  if request.contract ~= CONTRACT then
    return false, "Bridge request contract must be foundation.bridge.v1."
  end
  if not is_request_id(request.id) then
    return false, "id must be a cmd_ request id."
  end
  if not is_string(request.created_at) then
    return false, "created_at must be a non-empty string."
  end
  if not is_object(request.client) or not is_string(request.client.id) or not is_string(request.client.session_id) then
    return false, "client.id and client.session_id are required."
  end
  if not is_object(request.bridge) or not is_string(request.bridge.expected_owner) then
    return false, "bridge.expected_owner is required."
  end
  if not is_non_negative_integer(request.bridge.expected_generation) then
    return false, "bridge.expected_generation must be a non-negative integer."
  end
  if not is_object(request.operation) or not is_string(request.operation.family) or not is_string(request.operation.name) then
    return false, "operation.family and operation.name are required."
  end
  if not FIXED_FAMILIES[request.operation.family] then
    return false, "operation.family is outside foundation.bridge.v1."
  end
  local operation_key = request.operation.family .. ":" .. request.operation.name
  local artifacts_allowed_for_operation = ARTIFACT_PRODUCING_OPERATIONS[operation_key] == true
  local a2_render_operation = operation_key == "run_job:render.region_wav"
  local safe_write_a_operation = safe_write_a_capability(request, operation_key)
  if not is_object(request.pack) or not FIXED_PACKS[request.pack.id] or not is_string(request.pack.capability) or not is_string(request.pack.risk) then
    return false, "pack.id, pack.capability, and pack.risk are required."
  end
  if a2_render_operation then
    if request.pack.id ~= "render" or request.pack.risk ~= "write" then
      return false, "A2 render_region_wav must be the render-owned write-risk route."
    end
  elseif safe_write_a_operation then
    if request.pack.id ~= safe_write_a_operation.pack or request.pack.risk ~= safe_write_a_operation.risk then
      return false, "Safe-Write-A request pack/capability/risk mismatch."
    end
  elseif request.pack.risk ~= "read" then
    return false, "OpenReaper live bridge accepts read-only live-smoke requests only."
  end
  if not is_object(request.params) then
    return false, "params must be a JSON object."
  end
  if not is_json_array(request.refs) then
    return false, "refs must be a JSON array."
  end
  if not is_object(request.undo) then
    return false, "undo policy is required."
  end
  if a2_render_operation then
    if request.undo.mode ~= "required" then
      return false, "A2 render_region_wav must use undo.mode required."
    end
  elseif safe_write_a_operation then
    if request.undo.mode ~= "required" then
      return false, "Safe-Write-A write/safe requests must use undo.mode required."
    end
  elseif request.undo.mode ~= "none" then
    return false, "read-only live-smoke requests must use undo.mode none."
  end
  if not is_object(request.verification) or not is_string(request.verification.mode) then
    return false, "verification.mode is required."
  end
  if request.verification.checks ~= nil and request.verification.checks ~= JSON_NULL and not is_json_array(request.verification.checks) then
    return false, "verification.checks must be a JSON array."
  end
  if not is_object(request.artifacts) or type(request.artifacts.allow) ~= "boolean" then
    return false, "artifacts.allow must be a boolean."
  end
  if artifacts_allowed_for_operation then
    if request.artifacts.allow ~= true then
      return false, "Scoped First-Real-Fixture-A artifact handlers require artifacts.allow true."
    end
  elseif safe_write_a_operation then
    if request.artifacts.allow ~= false then
      return false, "Safe-Write-A write/safe requests must use artifacts.allow false."
    end
  elseif request.artifacts.allow ~= false then
    return false, "Only scoped First-Real-Fixture-A artifact handlers may write artifacts."
  end
  local budget = request.budget
  if not is_object(budget)
    or not (is_non_negative_integer(budget.max_response_bytes) and budget.max_response_bytes > 0)
    or not (is_non_negative_integer(budget.max_items) and budget.max_items > 0)
    or not (is_non_negative_integer(budget.max_inline_value_bytes) and budget.max_inline_value_bytes > 0) then
    return false, "budget must include positive integer limits."
  end
  if not (is_non_negative_integer(request.timeout_ms) and request.timeout_ms > 0) then
    return false, "timeout_ms must be a positive integer."
  end
  if a2_render_operation then
    if not is_string(request.idempotency_key) then
      return false, "A2 render_region_wav requires an idempotency_key."
    end
  elseif safe_write_a_operation then
    if request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL and not is_string(request.idempotency_key) then
      return false, "Safe-Write-A idempotency_key must be a string when present."
    end
  elseif request.idempotency_key ~= nil and request.idempotency_key ~= JSON_NULL then
    return false, "read-only live-smoke requests must not carry idempotency_key."
  end
  return true
end

local function current_project()
  local ok, project, project_path = call_reaper("EnumProjects", -1, "")
  if ok then
    return project or 0, bounded_string(project_path or "", 240)
  end
  return 0, ""
end

local function has_flag(value, flag)
  if type(value) ~= "number" then
    return false
  end
  return value % (flag * 2) >= flag
end

local function play_state_label(value)
  if has_flag(value, 4) then
    return "recording"
  elseif has_flag(value, 1) then
    return "playing"
  elseif has_flag(value, 2) then
    return "paused"
  elseif type(value) == "number" then
    return "stopped"
  end
  return "unknown"
end

local function loop_time_range(is_loop)
  local ok, start_time, end_time = call_reaper("GetSet_LoopTimeRange", false, is_loop, 0, 0, false)
  if ok and type(start_time) == "number" and type(end_time) == "number" then
    return {
      start_seconds = start_time,
      end_seconds = end_time,
      active = end_time > start_time,
    }
  end
  return {
    start_seconds = 0,
    end_seconds = 0,
    active = false,
  }
end

local ACCEPTED_CATALOG_COUNTS = {
  template_count = 119,
  by_pack = {
    actions = 8,
    analysis = 4,
    automation = 15,
    core = 3,
    fx = 14,
    items = 9,
    media = 6,
    midi = 12,
    project = 7,
    render = 5,
    routing = 15,
    system = 3,
    tracks = 8,
    transport = 10,
  },
  by_risk = {
    read = 58,
    safe = 9,
    write = 52,
  },
  by_lifecycle = {
    experimental = 119,
  },
  by_entity_kind = {
    action = 4,
    api_symbol = 1,
    automation_item = 3,
    automation_mode = 3,
    automation_point = 4,
    channel = 4,
    command_id = 1,
    core_state = 2,
    cursor = 1,
    custom_action = 1,
    cycle_action = 1,
    envelope = 5,
    fx = 5,
    fx_chain = 3,
    fx_param = 3,
    item = 7,
    last_result = 1,
    loop_state = 3,
    marker = 2,
    marker_action = 1,
    media_file = 4,
    media_source = 2,
    midi_cc = 3,
    midi_event = 4,
    midi_item = 2,
    midi_note = 3,
    output_file = 2,
    peak = 1,
    pin_mapping = 1,
    preset = 2,
    project = 3,
    region = 1,
    render_matrix = 1,
    render_region = 1,
    render_setting = 1,
    resource_path = 1,
    rms = 1,
    send = 10,
    silence = 1,
    system_state = 1,
    take = 2,
    tempo_map = 1,
    time_selection = 2,
    track = 7,
    track_selection = 1,
    transient = 1,
    transport = 4,
    video_processor = 1,
  },
}

local function table_key_count(source)
  local count = 0
  for _ in pairs(source or {}) do
    count = count + 1
  end
  return count
end

local function clone_counts(source)
  local result = {}
  for key, value in pairs(source or {}) do
    result[key] = value
  end
  return result
end

local function count_for_key(source, key)
  local result = {}
  result[key] = source[key]
  return result
end

local function handler_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function bounded_limit(request, requested, default_limit, hard_limit)
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

local CORE_RUNTIME_SYMBOLS = json_array({
  "APIExists",
  "CountMediaItems",
  "CountProjectMarkers",
  "CountSelectedMediaItems",
  "CountTempoTimeSigMarkers",
  "CountTracks",
  "EnumProjectMarkers3",
  "EnumProjects",
  "GetAppVersion",
  "GetCursorPosition",
  "GetMediaItem",
  "GetMediaItemInfo_Value",
  "GetOS",
  "GetProjectLength",
  "GetProjectName",
  "GetResourcePath",
  "GetSelectedMediaItem",
  "GetTrack",
  "GetTrackGUID",
})

local EXTENSION_PROBE_SYMBOLS = json_array({
  "APIExists",
  "BR_GetMediaItemGUID",
  "CF_GetSWSVersion",
  "SNM_GetIntConfigVar",
})

local function symbol_profile_defaults(profile)
  if profile == "extension_probe" then
    return EXTENSION_PROBE_SYMBOLS
  end
  return CORE_RUNTIME_SYMBOLS
end

local function valid_api_symbol_name(name)
  return is_string(name) and name:match("^[A-Za-z_][A-Za-z0-9_]*$") ~= nil
end

local function api_symbol_available(name)
  if not reaper then
    return false
  end
  if type(reaper.APIExists) == "function" then
    local ok, exists = pcall(reaper.APIExists, name)
    if ok and type(exists) == "boolean" then
      return exists
    end
  end
  return type(reaper[name]) == "function"
end

local function project_info_string(project, key, max_length)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  if ok and type(value) == "string" then
    return bounded_string(value, max_length or 240)
  end
  return ""
end

local PROJECT_METADATA_KEYS = {
  title = "PROJECT_TITLE",
  author = "PROJECT_AUTHOR",
  notes = "PROJECT_NOTES",
}

local function requested_metadata_fields(fields)
  if not is_json_array(fields) or #fields == 0 then
    return json_array({ "title", "author", "notes" })
  end
  local result = json_array({})
  local seen = {}
  for index = 1, #fields do
    local field = fields[index]
    if PROJECT_METADATA_KEYS[field] and not seen[field] then
      seen[field] = true
      result[#result + 1] = field
    end
  end
  if #result == 0 then
    return json_array({ "title", "author", "notes" })
  end
  return result
end

local function marker_ref(kind, index_number)
  local prefix = kind == "region" and "region" or "marker"
  return prefix .. ":index:" .. tostring(index_number or 0)
end

local function track_name(track)
  local ok, _, name = call_reaper("GetTrackName", track, "")
  return bounded_string(ok and first_string(name) or "", 160)
end

local function track_guid(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and first_string(guid) or nil
end

local function track_index(track)
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

local function track_ref_string(track)
  local guid = track_guid(track)
  if guid then
    return "track:guid:" .. guid
  end
  return "track:index:" .. tostring(track_index(track))
end

local function solo_label(value)
  if value == 1 then
    return "solo"
  elseif value == 2 then
    return "solo_in_place"
  end
  return "off"
end

local function track_summary(track)
  local index = track_index(track)
  local ok_selected, selected = call_reaper("GetMediaTrackInfo_Value", track, "I_SELECTED")
  local ok_mute, muted = call_reaper("GetMediaTrackInfo_Value", track, "B_MUTE")
  local ok_solo, solo = call_reaper("GetMediaTrackInfo_Value", track, "I_SOLO")
  local ok_arm, armed = call_reaper("GetMediaTrackInfo_Value", track, "I_RECARM")
  local ok_color, color = call_reaper("GetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR")
  return {
    track_ref = track_ref_string(track),
    index = index,
    name = track_name(track),
    selected = ok_selected and first_number(selected) == 1 or false,
    muted = ok_mute and first_number(muted) == 1 or false,
    solo_mode = solo_label(ok_solo and first_number(solo) or 0),
    record_armed = ok_arm and first_number(armed) == 1 or false,
    color = ok_color and type(color) == "number" and color > 0 and tostring(math.floor(color)) or JSON_NULL,
  }
end

local function find_track_by_guid(guid)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_guid(track) == guid then
      return track
    end
  end
  return nil
end

local function find_track_by_name(name)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local found = nil
  local matches = 0
  for index = 0, total - 1 do
    local ok_track, track = call_reaper("GetTrack", 0, index)
    if ok_track and track and track_name(track) == name then
      found = track
      matches = matches + 1
    end
  end
  if matches > 1 then
    return nil, "ambiguous"
  end
  return found
end

local function resolve_track_token(token)
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
    return find_track_by_guid(guid)
  end

  local name = token:match("^track:(.+)$")
  if name then
    return find_track_by_name(name)
  end
  return nil
end

local function item_guid(item)
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

local function item_ref_string(item)
  local guid = item_guid(item)
  if guid then
    return "item:guid:" .. guid
  end
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, candidate = call_reaper("GetMediaItem", 0, index)
    if ok_item and candidate == item then
      return "item:index:" .. tostring(index)
    end
  end
  return "item:unknown"
end

local function find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and first_number(count) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function item_track(item)
  local ok_track, track = call_reaper("GetMediaItemTrack", item)
  if ok_track and track then
    return track
  end
  ok_track, track = call_reaper("GetMediaItem_Track", item)
  return ok_track and track or nil
end

local function resolve_item_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^item:selected:(%d+)$")
  if selected_index then
    local ok, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    return ok and item or nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^item:index:(%d+)$")
  if index then
    local ok, item = call_reaper("GetMediaItem", 0, tonumber(index))
    return ok and item or nil
  end

  local guid = token:match("^guid:(.+)$") or token:match("^item:guid:(.+)$")
  if guid then
    return find_item_by_guid(guid)
  end
  return nil
end

local function resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_item_token("guid:" .. tostring(identity.value))
  end
  return resolve_item_token(ref.ref)
end

local function item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and first_number(value) or 0
end

local function item_summary(item, include_take_summary)
  local track = item_track(item)
  local summary = {
    item_ref = item_ref_string(item),
    track_ref = track and track_ref_string(track) or JSON_NULL,
    position_seconds = item_number(item, "D_POSITION"),
    length_seconds = item_number(item, "D_LENGTH"),
    snap_offset_seconds = item_number(item, "D_SNAPOFFSET"),
    fade_in_seconds = item_number(item, "D_FADEINLEN"),
    fade_out_seconds = item_number(item, "D_FADEOUTLEN"),
  }
  if include_take_summary then
    local ok_take_count, take_count = call_reaper("CountTakes", item)
    local ok_take, take = call_reaper("GetActiveTake", item)
    local ok_name, take_name = false, nil
    if ok_take and take then
      ok_name, take_name = call_reaper("GetTakeName", take)
    end
    summary.take_count = ok_take_count and first_number(take_count) or 0
    summary.active_take_name = bounded_string(ok_name and first_string(take_name) or "", 160)
  end
  return summary
end

local ACTION_SECTION_IDS = {
  main = 0,
  midi_editor = 32060,
  midi_event_list = 32061,
  crossfade_editor = 32062,
  media_explorer = 32063,
}

local function action_section_name(value)
  if ACTION_SECTION_IDS[value] ~= nil then
    return value
  end
  return "main"
end

local function action_section_id(value)
  return ACTION_SECTION_IDS[action_section_name(value)]
end

local function integer_value(value)
  if type(value) == "number" and value == math.floor(value) then
    return value
  end
  return nil
end

local function action_source(named_command, command_id)
  if is_string(named_command) and named_command:sub(1, 1) == "_" then
    return "extension"
  end
  if type(command_id) == "number" and command_id > 0 then
    return "native"
  end
  return "unknown"
end

local function lookup_named_command(named_command)
  if not is_string(named_command) then
    return 0
  end
  local ok, command_id = call_reaper("NamedCommandLookup", named_command)
  if ok and type(command_id) == "number" and command_id > 0 then
    return math.floor(command_id)
  end
  return 0
end

local function reverse_named_command(command_id)
  local ok, named = call_reaper("ReverseNamedCommandLookup", command_id)
  if ok and type(named) == "string" and named ~= "" then
    return named
  end
  return nil
end

local function action_display_name(section_id, command_id)
  local ok, name = call_reaper("kbd_getTextFromCmd", command_id, section_id)
  return bounded_string(ok and first_string(name) or "", 160)
end

local function lower_string(value)
  return tostring(value or ""):lower()
end

local ACTION_SEARCH_DEFAULT_LIMIT = 6
local ACTION_SEARCH_MAX_LIMIT = 6
local ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS = 96
local ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS = 80

local function take_guid(take)
  local ok_sws, guid = call_reaper("BR_GetMediaItemTakeGUID", take)
  if ok_sws and type(guid) == "string" and guid ~= "" then
    return guid
  end
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function take_item(take)
  local ok, item = call_reaper("GetMediaItemTake_Item", take)
  return ok and item or nil
end

local function take_ref_string(take)
  local guid = take_guid(take)
  if guid then
    return "take:guid:" .. guid
  end
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, candidate = call_reaper("GetTake", item, index)
        if ok_take and candidate == take then
          return "take:index:" .. tostring(take_index)
        end
        take_index = take_index + 1
      end
    end
  end
  return "take:unknown"
end

local function find_take_by_index(target_index)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local take_index = 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take then
          if take_index == target_index then
            return take
          end
          take_index = take_index + 1
        end
      end
    end
  end
  return nil
end

local function find_take_by_guid(guid)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local ok_takes, take_count = call_reaper("CountTakes", item)
      for index = 0, (ok_takes and first_number(take_count) or 0) - 1 do
        local ok_take, take = call_reaper("GetTake", item, index)
        if ok_take and take and take_guid(take) == guid then
          return take
        end
      end
    end
  end
  return nil
end

local function resolve_take_token(token)
  if not is_string(token) then
    return nil
  end
  local selected_index = token:match("^selected:(%d+)$") or token:match("^take:selected:(%d+)$")
  if selected_index then
    local ok_item, item = call_reaper("GetSelectedMediaItem", 0, tonumber(selected_index))
    if ok_item and item then
      local ok_take, take = call_reaper("GetActiveTake", item)
      return ok_take and take or nil
    end
    return nil
  end

  local index = token:match("^index:(%d+)$") or token:match("^take:index:(%d+)$")
  if index then
    return find_take_by_index(tonumber(index))
  end

  local guid = token:match("^guid:(.+)$") or token:match("^take:guid:(.+)$")
  if guid then
    return find_take_by_guid(guid)
  end

  local item_selected = token:match("^item:selected:(%d+)$")
  local item_index = token:match("^item:index:(%d+)$")
  local item_guid_value = token:match("^item:guid:(.+)$")
  local item = nil
  if item_selected then
    local ok, selected_item = call_reaper("GetSelectedMediaItem", 0, tonumber(item_selected))
    item = ok and selected_item or nil
  elseif item_index then
    local ok, indexed_item = call_reaper("GetMediaItem", 0, tonumber(item_index))
    item = ok and indexed_item or nil
  elseif item_guid_value then
    item = find_item_by_guid(item_guid_value)
  end
  if item then
    local ok_take, take = call_reaper("GetActiveTake", item)
    return ok_take and take or nil
  end
  return nil
end

local function resolve_take_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "take" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_take_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_take_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_take_token("guid:" .. tostring(identity.value))
  end
  return resolve_take_token(ref.ref)
end

local function take_is_midi(take)
  local ok, is_midi = call_reaper("TakeIsMIDI", take)
  return ok and is_midi == true
end

local function resolve_take_for_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local take = resolve_take_from_ref_object(request.refs[index])
      if take then
        return take
      end
    end
  end
  return resolve_take_token(request.params.ref)
end

local function resolve_midi_take_for_request(request)
  local take = resolve_take_for_request(request)
  if not take or not take_is_midi(take) then
    local _, failure = handler_error("TAKE_NOT_FOUND", "MIDI take ref could not be resolved.", {
      ref = bounded_string(request.params.ref, 160),
    })
    return nil, failure
  end
  return take
end

local function midi_take_summary(take)
  local item = take_item(take)
  local ok_count, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local start_ppq = 0
  local end_ppq = 0
  if item then
    local start_seconds = item_number(item, "D_POSITION")
    local end_seconds = start_seconds + item_number(item, "D_LENGTH")
    local ok_start, ppq_start = call_reaper("MIDI_GetPPQPosFromProjTime", take, start_seconds)
    local ok_end, ppq_end = call_reaper("MIDI_GetPPQPosFromProjTime", take, end_seconds)
    start_ppq = ok_start and first_number(ppq_start) or 0
    end_ppq = ok_end and first_number(ppq_end) or 0
  end
  return {
    take_ref = take_ref_string(take),
    item_ref = item and item_ref_string(item) or JSON_NULL,
    event_count = ok_count and ((note_count or 0) + (cc_count or 0) + (text_sysex_count or 0)) or 0,
    ppq_start = start_ppq,
    ppq_end = end_ppq,
  }
end

local function text_sysex_kind(type_value)
  if type_value == -1 then
    return "sysex"
  elseif type_value == 1 then
    return "text"
  elseif type_value == 5 then
    return "lyric"
  elseif type_value == 15 then
    return "notation"
  end
  return "text"
end

local function source_type(source)
  local ok, source_type_value = call_reaper("GetMediaSourceType", source, "")
  return bounded_string(ok and first_string(source_type_value) or "", 80)
end

local function source_length(source)
  local ok, length, length_is_quarter_notes = call_reaper("GetMediaSourceLength", source)
  return ok and first_number(length) or 0, ok and length_is_quarter_notes == true or false
end

local function source_length_with_file_fallback(source, filename)
  local length, length_is_quarter_notes = source_length(source)
  if length > 0 and not length_is_quarter_notes then
    return length, "take_source"
  end
  if length_is_quarter_notes then
    return 0, "quarter_notes"
  end
  if filename ~= "" and file_exists(filename) then
    local ok_file_source, file_source = call_reaper("PCM_Source_CreateFromFile", filename)
    if ok_file_source and file_source then
      local fallback_length, fallback_length_is_quarter_notes = source_length(file_source)
      call_reaper("PCM_Source_Destroy", file_source)
      if fallback_length > 0 and not fallback_length_is_quarter_notes then
        return fallback_length, "pcm_source_create_from_file"
      end
      if fallback_length_is_quarter_notes then
        return 0, "quarter_notes"
      end
    end
  end
  return 0, "unreadable"
end

local function source_channels(source)
  local ok, channels = call_reaper("GetMediaSourceNumChannels", source)
  return ok and first_number(channels) or 0
end

local function source_filename(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return bounded_string(ok and first_string(filename) or "", 240)
end

local function source_filename_raw(source)
  local ok, filename = call_reaper("GetMediaSourceFileName", source, "")
  return ok and first_string(filename) or ""
end

local function metadata_keys_for_source(source, include_metadata_keys)
  local keys = json_array({})
  if include_metadata_keys ~= true then
    return keys
  end
  for _, key in ipairs({ "TITLE", "ARTIST", "ALBUM", "DATE", "BPM" }) do
    local ok_meta, value = call_reaper("GetMediaFileMetadata", source, key, "")
    if ok_meta and type(value) == "string" and value ~= "" then
      keys[#keys + 1] = key
    end
  end
  return keys
end

local function file_ref_for_path(path_value)
  return "file:path:" .. bounded_string(path_value, 220)
end

local function item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function artifact_ref_from_request_refs(request, expected)
  expected = expected or {}
  if not is_json_array(request.refs) then
    return nil
  end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "artifact" and is_string(ref.ref) then
      local summary = is_object(ref.summary) and ref.summary or {}
      if summary.schema == expected.schema
        and summary.owner_pack == expected.owner_pack
        and summary.scope == expected.scope then
        local parts = parse_artifact_ref(ref.ref)
        if parts
          and parts.owner_pack == expected.owner_pack
          and parts.scope == expected.scope then
          return ref.ref
        end
      end
    end
  end
  return nil
end

local function bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback or 0
end

local function detect_loop_candidates(request)
  local item = item_from_request_refs(request)
  if not item then
    return handler_error("ITEM_NOT_FOUND", "Loop-candidate detection requires a resolvable item ref.", {})
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.detect_loop_candidates"]
  local item_facts = item_summary(item, true)
  local item_length = bounded_number(item_facts.length_seconds, 0)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, item_length)
  if end_seconds <= start_seconds then
    end_seconds = item_length > 0 and item_length or (start_seconds + 1)
  end
  local analyzed_seconds = math.max(0, end_seconds - start_seconds)
  local max_candidates = bounded_limit(request, request.params.max_candidates, 4, 12)
  local candidate_count = analyzed_seconds > 0 and math.min(max_candidates, 1) or 0
  local candidates = json_array({})
  if candidate_count > 0 then
    candidates[#candidates + 1] = {
      candidate_id = "candidate:0",
      item_ref = item_facts.item_ref,
      start_seconds = start_seconds,
      end_seconds = end_seconds,
      duration_seconds = analyzed_seconds,
      score = 0.5,
      smoke_only = true,
    }
  end

  local summary = {
    candidate_count = candidate_count,
    analyzed_seconds = analyzed_seconds,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    item = item_facts,
    limits = {
      min_loop_seconds = bounded_number(request.params.min_loop_seconds, 1),
      max_loop_seconds = bounded_number(request.params.max_loop_seconds, 12),
      max_candidates = max_candidates,
    },
    candidates = candidates,
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function measure_loop_click_risk(request)
  local item = item_from_request_refs(request)
  if not item then
    return handler_error("ITEM_NOT_FOUND", "Loop click-risk measurement requires a resolvable item ref.", {})
  end

  local candidate_ref = artifact_ref_from_request_refs(request, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_ref then
    return handler_error("ARTIFACT_NOT_FOUND", "Loop click-risk measurement requires a loop-candidates artifact ref.", {})
  end
  local candidate_envelope, candidate_failure = read_artifact_envelope(candidate_ref, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_envelope then
    return handler_error(candidate_failure.code, candidate_failure.message, candidate_failure.details)
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.measure_loop_click_risk"]
  local candidate_count = 0
  if is_object(candidate_envelope.summary) and type(candidate_envelope.summary.candidate_count) == "number" then
    candidate_count = candidate_envelope.summary.candidate_count
  end
  local risk_fact_count = candidate_count > 0 and 1 or 0
  local summary = {
    measured_candidate_count = candidate_count,
    risk_fact_count = risk_fact_count,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    item = item_summary(item, true),
    candidate_artifact_ref = candidate_ref,
    boundary_window_ms = bounded_number(request.params.boundary_window_ms, 20),
    risk_facts = risk_fact_count > 0 and json_array({
      {
        candidate_id = "candidate:0",
        click_risk = "unknown_smoke_heuristic",
        boundary_delta = 0,
      },
    }) or json_array({}),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function create_loop_qa_report(request)
  local candidate_ref = artifact_ref_from_request_refs(request, A1_LOOP_CANDIDATES_INPUT)
  local risk_ref = artifact_ref_from_request_refs(request, A1_LOOP_CLICK_RISK_INPUT)
  if not candidate_ref or not risk_ref then
    return handler_error("ARTIFACT_NOT_FOUND", "Loop QA report requires loop-candidates and click-risk artifact refs.", {})
  end
  local candidate_envelope, candidate_failure = read_artifact_envelope(candidate_ref, A1_LOOP_CANDIDATES_INPUT)
  if not candidate_envelope then
    return handler_error(candidate_failure.code, candidate_failure.message, candidate_failure.details)
  end
  local risk_envelope, risk_failure = read_artifact_envelope(risk_ref, A1_LOOP_CLICK_RISK_INPUT)
  if not risk_envelope then
    return handler_error(risk_failure.code, risk_failure.message, risk_failure.details)
  end

  local spec = A1_ARTIFACT_SPECS["run_job:analysis.create_loop_qa_report"]
  local candidate_count = is_object(candidate_envelope.summary) and bounded_number(candidate_envelope.summary.candidate_count, 0) or 0
  local risk_fact_count = is_object(risk_envelope.summary) and bounded_number(risk_envelope.summary.risk_fact_count, 0) or 0
  local report_row_count = math.min(bounded_limit(request, request.params.max_report_rows, 8, 32), math.max(candidate_count, risk_fact_count, 1))
  local summary = {
    candidate_count = candidate_count,
    risk_fact_count = risk_fact_count,
    report_row_count = report_row_count,
    truncated = false,
  }
  local payload = {
    smoke_only = true,
    analysis_quality_claim = false,
    candidate_artifact_ref = candidate_ref,
    click_risk_artifact_ref = risk_ref,
    rows = json_array({
      {
        row = 1,
        finding = "fixture_smoke_readback",
        candidate_count = candidate_count,
        risk_fact_count = risk_fact_count,
      },
    }),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function create_cleanup_report(request)
  local spec = A1_ARTIFACT_SPECS["run_job:project.create_cleanup_report"]
  local project_summary = read_project_summary({
    params = { include_counts = true },
    budget = request.budget,
  })
  local markers = list_markers_regions({
    params = {
      include_markers = request.params.include_markers ~= false,
      include_regions = request.params.include_regions ~= false,
      limit = request.params.marker_region_limit,
    },
    budget = request.budget,
  })
  local tempo = read_tempo_map({
    params = {
      limit = request.params.tempo_marker_limit,
      effective_at_seconds = json_array({ 0 }),
    },
    budget = request.budget,
  })
  local metadata = read_project_metadata({
    params = { fields = json_array({ "title", "author", "notes" }) },
    budget = request.budget,
  })
  local metadata_field_count = 0
  for _, field in ipairs({ "title", "author", "notes" }) do
    if metadata[field] ~= nil then
      metadata_field_count = metadata_field_count + 1
    end
  end
  local evidence_family_count = 4
  local report_row_count = math.min(bounded_limit(request, request.params.max_report_rows, 8, 64), evidence_family_count)
  local project_fingerprint = "tracks:" .. tostring(project_summary.track_count or 0)
    .. "|items:" .. tostring(project_summary.item_count or 0)
    .. "|markers:" .. tostring(project_summary.marker_count or 0)
    .. "|regions:" .. tostring(project_summary.region_count or 0)
  local summary = {
    evidence_family_count = evidence_family_count,
    report_row_count = report_row_count,
    marker_count = markers.marker_count or 0,
    region_count = markers.region_count or 0,
    metadata_field_count = metadata_field_count,
    tempo_marker_count = tempo and #tempo.tempo_markers or 0,
    project_fingerprint = project_fingerprint,
    truncated = markers.truncated == true or tempo.truncated == true,
  }
  local payload = {
    smoke_only = true,
    cleanup_policy_claim = false,
    project_summary = project_summary,
    markers_regions = markers,
    tempo = tempo,
    metadata = metadata,
    rows = json_array({
      { row = 1, family = "project_summary" },
      { row = 2, family = "markers_regions" },
      { row = 3, family = "tempo" },
      { row = 4, family = "metadata" },
    }),
  }
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function render_root_ready()
  if not RENDER_ROOT then
    return false, "render_root_not_configured", "First-Real-Fixture-A A2 render root is not configured."
  end
  if RENDER_ROOT:sub(1, 7) == "file://" or not is_absolute_path(RENDER_ROOT) then
    return false, "render_root_invalid", "First-Real-Fixture-A A2 render root must be an absolute filesystem path."
  end
  return true
end

local function safe_filename_suffix(value)
  local text = tostring(value or ""):gsub("^template:", ""):gsub("[^A-Za-z0-9_%-]", "_")
  if text == "" then
    text = "unknown"
  end
  if #text > 48 then
    text = text:sub(1, 48)
  end
  return text
end

local function managed_render_output(request)
  local suffix = safe_filename_suffix(request.idempotency_key or request.id)
  local basename = "openreaper_a2_" .. suffix .. ".wav"
  return {
    basename = basename,
    relative_path = basename,
    path = path_join(RENDER_ROOT or "", basename),
  }
end

local function file_size(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return nil
  end
  local size = handle:seek("end")
  handle:close()
  return size
end

local function wav_header_ok(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then
    return false
  end
  local header = handle:read(12) or ""
  handle:close()
  return header:sub(1, 4) == "RIFF" and header:sub(9, 12) == "WAVE"
end

local function parse_region_ref_token(token)
  if not is_string(token) then
    return nil
  end
  local index = token:match("^region:index:(%d+)$") or token:match("^index:(%d+)$")
  if index then
    return { scheme = "index", value = tonumber(index) }
  end
  local name = token:match("^region:name:(.+)$") or token:match("^name:(.+)$")
  if name and name ~= "" then
    return { scheme = "name", value = name }
  end
  local guid = token:match("^region:guid:(.+)$") or token:match("^guid:(.+)$")
  if guid and guid ~= "" then
    return { scheme = "guid", value = guid }
  end
  return nil
end

local function region_token_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "region" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "index" or identity.scheme == "name" or identity.scheme == "guid" then
    return {
      scheme = identity.scheme,
      value = identity.scheme == "index" and tonumber(identity.value) or tostring(identity.value),
    }
  end
  return parse_region_ref_token(ref.ref)
end

local function region_token_from_request(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local token = region_token_from_ref_object(request.refs[index])
      if token then
        return token
      end
    end
  end
  return nil
end

local function resolve_region_for_render(request)
  local token = region_token_from_request(request)
  if not token then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render_region_wav requires a resolvable region ref.",
      details = {
        blocker = "region_ref_missing",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  if token.scheme == "guid" then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render_region_wav currently supports region:index and region:name refs.",
      details = {
        blocker = "region_guid_ref_not_supported",
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end

  local project = current_project()
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  local total = (ok_count and first_number(marker_count) or 0) + (ok_count and first_number(region_count) or 0)
  local match = nil
  local matches = 0
  local region_ordinal = 0
  for enum_index = 0, math.max(total - 1, -1) do
    local ok_enum, retval, is_region, pos, region_end, name, index_number = call_reaper("EnumProjectMarkers3", project, enum_index)
    if ok_enum and retval and is_region == true then
      local index_matches = token.scheme == "index"
        and (token.value == region_ordinal or token.value == first_number(index_number))
      local name_matches = token.scheme == "name" and tostring(name or "") == token.value
      if index_matches or name_matches then
        matches = matches + 1
        match = {
          region_ref = "region:index:" .. tostring(index_number or region_ordinal),
          name = bounded_string(name or "", 160),
          index = index_number or region_ordinal,
          start_seconds = first_number(pos) or 0,
          end_seconds = first_number(region_end) or 0,
        }
        if match.name ~= "" then
          match.preferred_region_ref = "region:name:" .. match.name
        end
      end
      region_ordinal = region_ordinal + 1
    end
  end
  if matches > 1 then
    return nil, {
      code = "REF_INVALID",
      message = "A2 render region name is ambiguous.",
      details = {
        blocker = "region_ref_ambiguous",
        region_name = token.scheme == "name" and bounded_string(token.value, 160) or nil,
        match_count = matches,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        fallback_region_ref_scheme = "region:index:<zero-based-region-index>",
      },
    }
  end
  if not match then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region ref could not be resolved.",
      details = {
        blocker = "region_ref_not_found",
        requested_region_ref_scheme = token.scheme,
        recommended_region_ref_scheme = "region:name:<unique-region-name>",
        supported_region_ref_schemes = json_array({ "region:name:<unique-region-name>", "region:index:<zero-based-region-index>" }),
      },
    }
  end
  match.duration_seconds = match.end_seconds - match.start_seconds
  if match.duration_seconds <= 0 or match.duration_seconds > 120 then
    return nil, {
      code = "REGION_NOT_FOUND",
      message = "A2 render region bounds are empty or outside the bounded route limit.",
      details = {
        blocker = "region_bounds_invalid",
        region_ref = match.region_ref,
        preferred_region_ref = match.preferred_region_ref,
        region_start_seconds = match.start_seconds,
        region_end_seconds = match.end_seconds,
        duration_seconds = match.duration_seconds,
      },
    }
  end
  return match
end

local A2_UNSUPPORTED_SOURCE_TYPES = {
  MIDI = true,
  RPP_PROJECT = true,
  EMPTY = true,
  VIDEO = true,
}

local function a2_region_details(region)
  return {
    region_ref = region and region.region_ref or nil,
    preferred_region_ref = region and region.preferred_region_ref or nil,
    region_name = region and region.name or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  }
end

local function merge_details(...)
  local merged = {}
  for index = 1, select("#", ...) do
    local source = select(index, ...)
    if is_object(source) then
      for key, value in pairs(source) do
        merged[key] = value
      end
    end
  end
  return merged
end

local function a2_source_details(region, item_facts, take_facts, source_facts)
  return merge_details(a2_region_details(region), {
    item_ref = item_facts and item_facts.item_ref or nil,
    take_ref = take_facts and take_facts.take_ref or nil,
    source_type = source_facts and source_facts.source_type or nil,
    source_filename_present = source_facts and source_facts.source_filename_present == true or false,
    source_file_exists = source_facts and source_facts.source_file_exists == true or false,
    item_start_seconds = item_facts and item_facts.item_start_seconds or nil,
    item_end_seconds = item_facts and item_facts.item_end_seconds or nil,
    region_start_seconds = region and region.start_seconds or nil,
    region_end_seconds = region and region.end_seconds or nil,
  })
end

local function a2_take_facts(take)
  if not take then
    return nil
  end
  return {
    take_ref = take_ref_string(take),
  }
end

local function a2_source_facts(source)
  local filename = source_filename_raw(source)
  return {
    source_type = source_type(source),
    source_filename = filename,
    source_filename_present = filename ~= "",
    source_file_exists = filename ~= "" and file_exists(filename) or false,
  }
end

local function active_audio_take_for_region(region)
  local ok_count, item_count = call_reaper("CountMediaItems", 0)
  local total_items = ok_count and first_number(item_count) or 0
  local saw_overlap = false
  local first_failure = nil
  for item_index = 0, total_items - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, item_index)
    if ok_item and item then
      local item_start = item_number(item, "D_POSITION")
      local item_end = item_start + item_number(item, "D_LENGTH")
      local overlaps = item_end > region.start_seconds and item_start < region.end_seconds
      if overlaps then
        saw_overlap = true
        local item_facts = {
          item_ref = item_ref_string(item),
          item_start_seconds = item_start,
          item_end_seconds = item_end,
        }
        local ok_take, take = call_reaper("GetActiveTake", item)
        if not ok_take or not take then
          first_failure = first_failure or {
            code = "TAKE_NOT_FOUND",
            message = "A2 render_region_wav found an overlapping item without an active take source.",
            details = merge_details(a2_region_details(region), item_facts, {
              blocker = "take_source_missing",
            }),
          }
        elseif take_is_midi(take) then
          local take_facts = a2_take_facts(take)
          first_failure = first_failure or {
            code = "PARAMS_INVALID",
            message = "A2 render_region_wav requires an audio take; the overlapping take is MIDI.",
            details = merge_details(a2_source_details(region, item_facts, take_facts, {
              source_type = "MIDI",
              source_filename_present = false,
              source_file_exists = false,
            }), {
              blocker = "source_type_unsupported",
            }),
          }
        else
          local take_facts = a2_take_facts(take)
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if not ok_source or not source then
            first_failure = first_failure or {
              code = "TAKE_NOT_FOUND",
              message = "A2 render_region_wav could not read the active take source.",
              details = merge_details(a2_source_details(region, item_facts, take_facts, nil), {
                blocker = "take_source_missing",
              }),
            }
          else
            local source_facts = a2_source_facts(source)
            if A2_UNSUPPORTED_SOURCE_TYPES[source_facts.source_type] then
              first_failure = first_failure or {
                code = "PARAMS_INVALID",
                message = "A2 render_region_wav does not support this take source type.",
                details = merge_details(a2_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_type_unsupported",
                }),
              }
            elseif not source_facts.source_filename_present or not source_facts.source_file_exists then
              first_failure = first_failure or {
                code = "FILE_NOT_FOUND",
                message = "A2 render_region_wav source file is missing or offline.",
                details = merge_details(a2_source_details(region, item_facts, take_facts, source_facts), {
                  blocker = "source_file_missing_or_offline",
                }),
              }
            else
              local source_len, source_length_method = source_length_with_file_fallback(source, source_facts.source_filename)
              if source_length_method == "quarter_notes" then
                first_failure = first_failure or {
                  code = "PARAMS_INVALID",
                  message = "A2 render_region_wav does not support quarter-note based source length.",
                  details = merge_details(a2_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_type_unsupported",
                    source_length_method = source_length_method,
                  }),
                }
              elseif not source_len or source_len <= 0 then
                first_failure = first_failure or {
                  code = "FILE_NOT_FOUND",
                  message = "A2 render_region_wav source length could not be measured from the take or file-backed fallback.",
                  details = merge_details(a2_source_details(region, item_facts, take_facts, source_facts), {
                    blocker = "source_length_unreadable",
                    source_length_method = source_length_method,
                  }),
                }
              else
                local take_offset = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS"))) or 0
                local playrate = first_number(select(2, call_reaper("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE"))) or 1
                local overlap_start = math.max(region.start_seconds, item_start)
                local overlap_end = math.min(region.end_seconds, item_end)
                local source_start = take_offset + ((overlap_start - item_start) * playrate)
                local source_end = take_offset + ((overlap_end - item_start) * playrate)
                local clamped_source_start = math.max(0, math.min(source_len, source_start))
                local clamped_source_end = math.max(0, math.min(source_len, source_end))
                if playrate <= 0 or clamped_source_end <= clamped_source_start then
                  first_failure = first_failure or {
                    code = "REGION_NOT_FOUND",
                    message = "A2 render region does not overlap a renderable source range.",
                    details = merge_details(a2_source_details(region, item_facts, take_facts, source_facts), {
                      blocker = "source_range_overlap_invalid",
                      source_length_seconds = source_len,
                      source_length_method = source_length_method,
                      source_start_seconds = source_start,
                      source_end_seconds = source_end,
                      playrate = playrate,
                    }),
                  }
                else
                  return {
                    item_ref = item_facts.item_ref,
                    take_ref = take_facts.take_ref,
                    source_type = source_facts.source_type,
                    source_filename = source_facts.source_filename,
                    source_filename_present = source_facts.source_filename_present,
                    source_file_exists = source_facts.source_file_exists,
                    source_length_seconds = source_len,
                    source_length_method = source_length_method,
                    source_start_seconds = clamped_source_start,
                    source_end_seconds = clamped_source_end,
                    item_start_seconds = item_start,
                    item_end_seconds = item_end,
                    playrate = playrate,
                  }
                end
              end
            end
          end
        end
      end
    end
  end
  if first_failure then
    return nil, first_failure
  end
  if saw_overlap then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "A2 render_region_wav found overlapping items but no renderable audio take.",
      details = merge_details(a2_region_details(region), {
        blocker = "no_overlapping_audio_item",
      }),
    }
  end
  return nil, {
    code = "ITEM_NOT_FOUND",
    message = "A2 render_region_wav requires an audio item overlapping the resolved region.",
    details = merge_details(a2_region_details(region), {
      blocker = "no_overlapping_audio_item",
    }),
  }
end

local function job_object_ref(job_id)
  return {
    kind = "job",
    ref = "job:job_id:" .. job_id,
    identity = {
      scheme = "job_id",
      value = job_id,
    },
    summary = {
      template_id = "template.render.render_region_wav",
      pack = "render",
    },
  }
end

local function render_region_wav(request)
  local root_ok, blocker, root_message = render_root_ready()
  if not root_ok then
    return handler_error("FILE_NOT_FOUND", root_message, {
      blocker = blocker,
      render_root_env = RENDER_ROOT_ENV,
    })
  end
  if request.params.output_policy ~= "openreaper_managed_render_root" then
    return handler_error("PARAMS_INVALID", "A2 render_region_wav requires managed render root output policy.", {
      field = "output_policy",
    })
  end
  if request.params.collision_policy ~= "fail_if_exists" then
    return handler_error("IDEMPOTENCY_CONFLICT", "A2 render_region_wav supports only first-pass fail_if_exists in this route.", {
      blocker = "reuse_idempotent_match_not_enabled",
      collision_policy = bounded_string(request.params.collision_policy, 80),
    }, false)
  end

  local region, region_failure = resolve_region_for_render(request)
  if not region then
    return nil, region_failure
  end
  local source, source_failure = active_audio_take_for_region(region)
  if not source then
    return nil, source_failure
  end

  local output = managed_render_output(request)
  if file_exists(output.path) then
    return handler_error("IDEMPOTENCY_CONFLICT", "A2 managed render output already exists and fail_if_exists forbids overwrite.", {
      blocker = "render_output_exists",
      output_basename = output.basename,
    }, false)
  end

  local start_percent = math.max(0, math.min(1, source.source_start_seconds / source.source_length_seconds))
  local end_percent = math.max(0, math.min(1, source.source_end_seconds / source.source_length_seconds))
  if end_percent <= start_percent then
    return handler_error("REGION_NOT_FOUND", "A2 render region does not overlap a renderable source range.", {
      blocker = "source_range_overlap_invalid",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
      source_length_seconds = source.source_length_seconds,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    })
  end

  local render_ok, render_success = call_reaper(
    "RenderFileSection",
    source.source_filename,
    output.path,
    start_percent,
    end_percent,
    source.playrate
  )
  if not render_ok or render_success == false then
    return handler_error("COMMAND_FAILED", "A2 render_region_wav could not render the source section through REAPER.", {
      blocker = "render_file_section_failed",
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      region_ref = region.region_ref,
      preferred_region_ref = region.preferred_region_ref,
      item_start_seconds = source.item_start_seconds,
      item_end_seconds = source.item_end_seconds,
      region_start_seconds = region.start_seconds,
      region_end_seconds = region.end_seconds,
    }, false)
  end

  local size = file_size(output.path) or 0
  local wav_ok = wav_header_ok(output.path)
  if size <= 0 or not wav_ok then
    return handler_error("VERIFY_FAILED", "A2 render_region_wav output file failed WAV/non-empty verification.", {
      blocker = "wav_output_invalid",
      output_basename = output.basename,
      file_size_bytes = size,
      wav_header = wav_ok,
    }, false)
  end

  local output_summary = {
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    wav_header = wav_ok,
    file_count = 1,
    reused_existing = false,
    truncated = false,
  }
  local output_write, output_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.region_wav_output, output_summary, {
    smoke_only = false,
    output = output_summary,
    region = region,
    source = {
      item_ref = source.item_ref,
      take_ref = source.take_ref,
      source_type = source.source_type,
      source_filename_present = source.source_filename_present,
      source_file_exists = source.source_file_exists,
      source_length_seconds = source.source_length_seconds,
      source_length_method = source.source_length_method,
      source_start_seconds = source.source_start_seconds,
      source_end_seconds = source.source_end_seconds,
    },
  })
  if not output_write then
    return handler_error(output_failure.code, output_failure.message, output_failure.details, output_failure.recoverable)
  end

  local artifact_id = artifact_id_from_request(request)
  local job_id = "render.region_wav." .. tostring(artifact_id or request.id)
  local job_ref = job_object_ref(job_id)
  local evidence_summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    region_ref = region.region_ref,
    collision_policy = request.params.collision_policy,
    verification_status = "passed",
    truncated = false,
  }
  local evidence_write, evidence_failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.render_job_evidence, evidence_summary, {
    smoke_only = false,
    output_artifact_ref = output_write.ref,
    region = region,
    output = output_summary,
    render_request = {
      format = request.params.format,
      output_policy = request.params.output_policy,
      collision_policy = request.params.collision_policy,
      sample_rate_hz = request.params.sample_rate_hz,
      bit_depth = request.params.bit_depth,
      channel_count = request.params.channel_count,
    },
  })
  if not evidence_write then
    return handler_error(evidence_failure.code, evidence_failure.message, evidence_failure.details, evidence_failure.recoverable)
  end

  local summary = {
    job_ref = job_ref.ref,
    output_artifact_ref = output_write.ref,
    evidence_artifact_ref = evidence_write.ref,
    format = "wav",
    output_policy = request.params.output_policy,
    collision_policy = request.params.collision_policy,
    file_count = 1,
    reused_existing = false,
    output_basename = output.basename,
    managed_relative_path = output.relative_path,
    file_size_bytes = size,
    truncated = false,
  }
  return summary, nil, json_array({ output_write.object_ref, evidence_write.object_ref }), json_array({ job_ref })
end

local function read_a2_artifact(ref, spec, expected_producer)
  local envelope, failure = read_artifact_envelope(ref, spec)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.id ~= expected_producer
    or envelope.producer.pack ~= "render" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A2 input artifact envelope does not match the expected render producer.",
      details = {
        blocker = "render_evidence_producer_mismatch",
        expected_producer = expected_producer,
      },
    }
  end
  return envelope
end

local function create_delivery_report(request)
  local output_ref = artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.region_wav_output)
  local evidence_ref = artifact_ref_from_request_refs(request, A2_ARTIFACT_SPECS.render_job_evidence)
  if not output_ref or not evidence_ref then
    return handler_error("ARTIFACT_NOT_FOUND", "A2 delivery report requires render output and render job evidence artifact refs.", {
      blocker = "render_evidence_refs_missing",
    })
  end

  local output_envelope, output_failure = read_a2_artifact(output_ref, A2_ARTIFACT_SPECS.region_wav_output, "template.render.render_region_wav")
  if not output_envelope then
    return handler_error(output_failure.code, output_failure.message, output_failure.details)
  end
  local evidence_envelope, evidence_failure = read_a2_artifact(evidence_ref, A2_ARTIFACT_SPECS.render_job_evidence, "template.render.render_region_wav")
  if not evidence_envelope then
    return handler_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end
  local evidence_summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  local evidence_payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local evidence_output_ref = evidence_summary.output_artifact_ref or evidence_payload.output_artifact_ref
  if evidence_output_ref ~= output_ref then
    return handler_error("ARTIFACT_INVALID", "A2 render job evidence does not reference the requested output artifact.", {
      blocker = "render_evidence_output_mismatch",
    })
  end

  local file_size_value = is_object(output_envelope.summary) and bounded_number(output_envelope.summary.file_size_bytes, 0) or 0
  local nonempty_output_count = file_size_value > 0 and 1 or 0
  local issue_count = nonempty_output_count == 1 and 0 or 1
  local report_row_count = math.min(bounded_limit(request, request.params.max_report_rows, 1, 12), 1)
  local summary = {
    output_artifact_count = 1,
    job_evidence_count = 1,
    region_count = 1,
    nonempty_output_count = nonempty_output_count,
    report_row_count = report_row_count,
    issue_count = issue_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    consumed_artifact_refs = json_array({ output_ref, evidence_ref }),
    rows = json_array({
      {
        row = 1,
        output_basename = is_object(output_envelope.summary) and output_envelope.summary.output_basename or JSON_NULL,
        file_size_bytes = file_size_value,
        issue_count = issue_count,
      },
    }),
  }
  local write, failure = write_a2_artifact(request, A2_ARTIFACT_SPECS.delivery_report, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function read_a3_layer_evidence_artifact(ref)
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
  local envelope, failure = read_artifact_envelope(ref, A3_ARTIFACT_SPECS.layer_evidence)
  if not envelope then
    return nil, failure
  end
  if not is_object(envelope.producer)
    or envelope.producer.kind ~= "template"
    or envelope.producer.pack ~= "items" then
    return nil, {
      code = "ARTIFACT_INVALID",
      message = "A3 layer evidence artifact envelope does not match the expected items template producer.",
      details = {
        blocker = "layer_evidence_producer_mismatch",
      },
    }
  end
  return envelope
end

local function artifact_count_from_summary_or_payload(envelope, summary_key, payload_key)
  local summary = is_object(envelope.summary) and envelope.summary or {}
  if type(summary[summary_key]) == "number" and summary[summary_key] >= 0 then
    return math.floor(summary[summary_key])
  end
  local payload = is_object(envelope.payload) and envelope.payload or {}
  local payload_value = payload[payload_key]
  if is_json_array(payload_value) then
    return #payload_value
  end
  return 0
end

local function layer_report_rows(evidence_envelope, row_count)
  local payload = is_object(evidence_envelope.payload) and evidence_envelope.payload or {}
  local items = is_json_array(payload.items) and payload.items or json_array({})
  local rows = json_array({})
  for index = 1, row_count do
    local item = is_object(items[index]) and items[index] or {}
    rows[#rows + 1] = {
      row = index,
      item_ref = bounded_string(item.item_ref or item.ref, 120) or JSON_NULL,
      track_ref = bounded_string(item.track_ref, 120) or JSON_NULL,
      name = bounded_string(item.name, 120) or JSON_NULL,
      color = bounded_string(item.color, 80) or JSON_NULL,
    }
  end
  return rows
end

local function compact_layer_evidence_summary(evidence_envelope)
  local summary = is_object(evidence_envelope.summary) and evidence_envelope.summary or {}
  return {
    schema = summary.schema or evidence_envelope.schema,
    item_count = summary.item_count or 0,
    track_count = summary.track_count or 0,
    evidence_family_count = summary.evidence_family_count or 0,
    truncated = summary.truncated == true,
    fixture = bounded_string(summary.fixture, 120) or JSON_NULL,
  }
end

local function create_layer_report(request)
  local evidence_ref = artifact_ref_from_request_refs(request, A3_ARTIFACT_SPECS.layer_evidence)
  if not evidence_ref then
    return handler_error("ARTIFACT_NOT_FOUND", "A3 layer report requires an items.layer_evidence.v1 artifact ref.", {
      blocker = "layer_evidence_ref_missing",
    })
  end

  local evidence_envelope, evidence_failure = read_a3_layer_evidence_artifact(evidence_ref)
  if not evidence_envelope then
    return handler_error(evidence_failure.code, evidence_failure.message, evidence_failure.details)
  end

  local item_count = artifact_count_from_summary_or_payload(evidence_envelope, "item_count", "items")
  local track_count = artifact_count_from_summary_or_payload(evidence_envelope, "track_count", "tracks")
  local max_rows = bounded_limit(request, request.params.max_report_rows, 24, 24)
  local report_row_count = math.min(max_rows, math.max(item_count, track_count, 1))
  local summary = {
    evidence_item_count = item_count,
    evidence_track_count = track_count,
    report_row_count = report_row_count,
    truncated = false,
  }
  local payload = {
    smoke_only = false,
    typed_fixture_smoke = true,
    consumed_artifact_refs = json_array({ evidence_ref }),
    evidence_summary = compact_layer_evidence_summary(evidence_envelope),
    rows = layer_report_rows(evidence_envelope, report_row_count),
  }
  local write, failure = write_a3_artifact(request, A3_ARTIFACT_SPECS.layer_report, summary, payload)
  if not write then
    return handler_error(failure.code, failure.message, failure.details, failure.recoverable)
  end
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function project_object_ref()
  return {
    kind = "project",
    ref = "project:current",
    identity = {
      scheme = "current",
      value = "current",
    },
  }
end

local function marker_object_ref(kind, index_number, name)
  local ref_kind = kind == "region" and "region" or "marker"
  return {
    kind = ref_kind,
    ref = ref_kind .. ":index:" .. tostring(index_number or 0),
    identity = {
      scheme = "index",
      value = tostring(index_number or 0),
    },
    display = {
      name = bounded_string(name or "", 160),
    },
  }
end

local function track_object_ref(track)
  local ref = track_ref_string(track)
  local scheme, value = ref:match("^track:([^:]+):(.+)$")
  return {
    kind = "track",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or track_index(track)),
    },
    display = {
      name = track_name(track),
    },
  }
end

local function item_object_ref(item)
  local ref = item_ref_string(item)
  local scheme, value = ref:match("^item:([^:]+):(.+)$")
  return {
    kind = "item",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function take_object_ref(take)
  local ref = take_ref_string(take)
  local scheme, value = ref:match("^take:([^:]+):(.+)$")
  return {
    kind = "take",
    ref = ref,
    identity = {
      scheme = scheme or "index",
      value = tostring(value or "0"),
    },
  }
end

local function safe_write_a_summary(request, readback)
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

local function safe_write_a_refs(...)
  local refs = json_array({})
  for index = 1, select("#", ...) do
    local ref = select(index, ...)
    if ref then
      refs[#refs + 1] = ref
    end
  end
  return refs
end

local function project_metadata_key(field)
  return PROJECT_METADATA_KEYS[field]
end

local function safe_write_project_metadata(request)
  local key = project_metadata_key(request.params.field)
  if not key then
    return handler_error("PARAMS_INVALID", "Safe-Write-A metadata field is not allowed.", {
      field = bounded_string(request.params.field, 80),
    })
  end
  local project = current_project()
  local ok, success = call_reaper("GetSetProjectInfo_String", project, key, tostring(request.params.value or ""), true)
  if not ok or success == false then
    return handler_error("COMMAND_FAILED", "Could not update project metadata field.", {
      field = request.params.field,
    }, false)
  end
  local readback = project_info_string(project, key, 240)
  return safe_write_a_summary(request, {
    project_ref = "project:current",
    field = request.params.field,
    value = bounded_string(readback, 240),
  }), nil, nil, nil, safe_write_a_refs(project_object_ref())
end

local function native_color_from_hex(value)
  if value == nil or value == JSON_NULL then
    return 0
  end
  if not is_string(value) then
    return 0
  end
  local r, g, b = value:match("^#(%x%x)(%x%x)(%x%x)$")
  if not r then
    return 0
  end
  local ok, native = call_reaper("ColorToNative", tonumber(r, 16), tonumber(g, 16), tonumber(b, 16))
  if ok and type(native) == "number" then
    return math.floor(native) + 0x1000000
  end
  return 0
end

local function safe_write_create_marker(request)
  local project = current_project()
  local color = native_color_from_hex(request.params.color)
  local ok, index_number = call_reaper(
    "AddProjectMarker2",
    project,
    false,
    bounded_number(request.params.position_seconds, 0),
    0,
    tostring(request.params.name or "OR_SAFE_WRITE_A_MARKER"),
    -1,
    color
  )
  if not ok or type(index_number) ~= "number" or index_number < 0 then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A marker.", {}, false)
  end
  return safe_write_a_summary(request, {
    marker_ref = "marker:index:" .. tostring(index_number),
    name = bounded_string(request.params.name, 160),
    position_seconds = bounded_number(request.params.position_seconds, 0),
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("marker", index_number, request.params.name))
end

local function safe_write_create_region(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "Safe-Write-A region end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local project = current_project()
  local color = native_color_from_hex(request.params.color)
  local ok, index_number = call_reaper(
    "AddProjectMarker2",
    project,
    true,
    start_seconds,
    end_seconds,
    tostring(request.params.name or "OR_SAFE_WRITE_A_REGION"),
    -1,
    color
  )
  if not ok or type(index_number) ~= "number" or index_number < 0 then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A region.", {}, false)
  end
  return safe_write_a_summary(request, {
    region_ref = "region:index:" .. tostring(index_number),
    name = bounded_string(request.params.name, 160),
    start_seconds = start_seconds,
    end_seconds = end_seconds,
  }), nil, nil, nil, safe_write_a_refs(marker_object_ref("region", index_number, request.params.name))
end

local function resolve_track_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "track" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return resolve_track_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return resolve_track_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return resolve_track_token("guid:" .. tostring(identity.value))
  elseif identity.scheme == "name" then
    return find_track_by_name(tostring(identity.value))
  end
  return resolve_track_token(ref.ref)
end

local function track_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local track, reason = resolve_track_from_ref_object(request.refs[index])
      if reason == "ambiguous" then
        return nil, {
          code = "REF_INVALID",
          message = "Track name is ambiguous.",
          details = { track_ref = bounded_string(request.refs[index].ref, 160) },
        }
      end
      if track then
        return track
      end
    end
  end
  return nil, {
    code = "TRACK_NOT_FOUND",
    message = "Safe-Write-A track request requires a resolvable track ref.",
    details = {},
  }
end

local function safe_write_create_track(request)
  local ok_count, count = call_reaper("CountTracks", 0)
  local total = ok_count and first_number(count) or 0
  local index = is_non_negative_integer(request.params.index) and request.params.index or total
  index = math.max(0, math.min(index, total))
  local ok_insert = call_reaper("InsertTrackAtIndex", index, true)
  if not ok_insert then
    return handler_error("COMMAND_FAILED", "Could not insert Safe-Write-A track.", {
      index = index,
    }, false)
  end
  local ok_track, track = call_reaper("GetTrack", 0, index)
  if not ok_track or not track then
    return handler_error("TRACK_NOT_FOUND", "Inserted Safe-Write-A track could not be resolved.", {
      index = index,
    })
  end
  call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name or "OR_SAFE_WRITE_A_TARGET"), true)
  call_reaper("TrackList_AdjustWindows", false)
  local summary = track_summary(track)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_track_update(request, updater)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(track)
  if not ok then
    return nil, fail
  end
  call_reaper("TrackList_AdjustWindows", false)
  return safe_write_a_summary(request, track_summary(track)), nil, nil, nil, safe_write_a_refs(track_object_ref(track))
end

local function safe_write_rename_track(request)
  return safe_write_track_update(request, function(track)
    local ok, success = call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", tostring(request.params.name or ""), true)
    if not ok or success == false then
      return false, {
        code = "COMMAND_FAILED",
        message = "Could not rename Safe-Write-A track.",
        recoverable = false,
        details = {},
      }
    end
    return true
  end)
end

local function safe_write_set_track_color(request)
  return safe_write_track_update(request, function(track)
    local color = native_color_from_hex(request.params.color)
    local ok, success = call_reaper("SetMediaTrackInfo_Value", track, "I_CUSTOMCOLOR", color)
    if not ok or success == false then
      return false, {
        code = "COMMAND_FAILED",
        message = "Could not set Safe-Write-A track color.",
        recoverable = false,
        details = {},
      }
    end
    return true
  end)
end

local function safe_write_select_track(request)
  return safe_write_track_update(request, function(track)
    local mode = request.params.mode
    if mode == "replace" then
      local ok_count, count = call_reaper("CountTracks", 0)
      for index = 0, (ok_count and first_number(count) or 0) - 1 do
        local ok_track, candidate = call_reaper("GetTrack", 0, index)
        if ok_track and candidate then
          call_reaper("SetMediaTrackInfo_Value", candidate, "I_SELECTED", 0)
        end
      end
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 1)
    elseif mode == "add" then
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 1)
    elseif mode == "remove" then
      call_reaper("SetMediaTrackInfo_Value", track, "I_SELECTED", 0)
    else
      return false, {
        code = "PARAMS_INVALID",
        message = "Track selection mode must be replace, add, or remove.",
        details = { mode = bounded_string(mode, 80) },
      }
    end
    return true
  end)
end

local function safe_write_set_track_mute(request)
  return safe_write_track_update(request, function(track)
    call_reaper("SetMediaTrackInfo_Value", track, "B_MUTE", request.params.muted == true and 1 or 0)
    return true
  end)
end

local function safe_write_set_track_solo(request)
  return safe_write_track_update(request, function(track)
    local value = 0
    if request.params.mode == "solo" then
      value = 1
    elseif request.params.mode == "solo_in_place" then
      value = 2
    elseif request.params.mode ~= "off" then
      return false, {
        code = "PARAMS_INVALID",
        message = "Track solo mode must be off, solo, or solo_in_place.",
        details = { mode = bounded_string(request.params.mode, 80) },
      }
    end
    call_reaper("SetMediaTrackInfo_Value", track, "I_SOLO", value)
    return true
  end)
end

local function safe_write_transport_set_edit_cursor(request)
  call_reaper(
    "SetEditCurPos",
    bounded_number(request.params.position_seconds, 0),
    request.params.move_view == true,
    request.params.seek_playback == true
  )
  local state = read_transport_state()
  return safe_write_a_summary(request, {
    edit_cursor_seconds = state.edit_cursor_seconds,
  })
end

local function safe_write_transport_set_time_selection(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds)
  if end_seconds < start_seconds then
    return handler_error("PARAMS_INVALID", "Time selection end_seconds must be greater than or equal to start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  call_reaper("GetSet_LoopTimeRange", true, false, start_seconds, end_seconds, false)
  return safe_write_a_summary(request, read_transport_state().time_selection)
end

local function safe_write_transport_clear_time_selection(request)
  call_reaper("GetSet_LoopTimeRange", true, false, 0, 0, false)
  return safe_write_a_summary(request, read_transport_state().time_selection)
end

local function safe_write_transport_set_loop_points(request)
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds)
  if end_seconds < start_seconds then
    return handler_error("PARAMS_INVALID", "Loop point end_seconds must be greater than or equal to start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  call_reaper("GetSet_LoopTimeRange", true, true, start_seconds, end_seconds, false)
  return safe_write_a_summary(request, read_transport_state().loop_points)
end

local function safe_write_transport_clear_loop_points(request)
  call_reaper("GetSet_LoopTimeRange", true, true, 0, 0, false)
  return safe_write_a_summary(request, read_transport_state().loop_points)
end

local function safe_write_transport_set_repeat(request)
  call_reaper("GetSetRepeat", request.params.enabled == true and 1 or 0)
  return safe_write_a_summary(request, {
    repeat_enabled = read_transport_state().repeat_enabled,
  })
end

local function item_from_safe_write_refs(request)
  local item = item_from_request_refs(request)
  if not item then
    return nil, {
      code = "ITEM_NOT_FOUND",
      message = "Safe-Write-A item request requires a resolvable item ref.",
      details = {},
    }
  end
  return item
end

local function safe_write_item_update(request, updater)
  local item, failure = item_from_safe_write_refs(request)
  if not item then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local ok, fail = updater(item)
  if not ok then
    return nil, fail
  end
  call_reaper("UpdateItemInProject", item)
  return safe_write_a_summary(request, item_summary(item, true)), nil, nil, nil, safe_write_a_refs(item_object_ref(item))
end

local function safe_write_move_item(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", bounded_number(request.params.position_seconds, 0))
    return true
  end)
end

local function safe_write_trim_item(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", math.max(0, bounded_number(request.params.length_seconds, 0)))
    if type(request.params.start_offset_seconds) == "number" then
      local ok_take, take = call_reaper("GetActiveTake", item)
      if ok_take and take then
        call_reaper("SetMediaItemTakeInfo_Value", take, "D_STARTOFFS", math.max(0, request.params.start_offset_seconds))
      end
    end
    return true
  end)
end

local function safe_write_set_item_fades(request)
  return safe_write_item_update(request, function(item)
    local fade_in = request.params.fade_in_seconds == JSON_NULL and 0 or bounded_number(request.params.fade_in_seconds, 0)
    local fade_out = request.params.fade_out_seconds == JSON_NULL and 0 or bounded_number(request.params.fade_out_seconds, 0)
    call_reaper("SetMediaItemInfo_Value", item, "D_FADEINLEN", math.max(0, fade_in))
    call_reaper("SetMediaItemInfo_Value", item, "D_FADEOUTLEN", math.max(0, fade_out))
    return true
  end)
end

local function safe_write_set_take_pitch(request)
  return safe_write_item_update(request, function(item)
    local ok_take, take = call_reaper("GetActiveTake", item)
    if not ok_take or not take then
      return false, {
        code = "TAKE_NOT_FOUND",
        message = "Safe-Write-A take pitch requires an active take.",
        details = {},
      }
    end
    call_reaper("SetMediaItemTakeInfo_Value", take, "D_PITCH", bounded_number(request.params.semitones, 0))
    return true
  end)
end

local function safe_write_set_item_snap_offset(request)
  return safe_write_item_update(request, function(item)
    call_reaper("SetMediaItemInfo_Value", item, "D_SNAPOFFSET", math.max(0, bounded_number(request.params.snap_offset_seconds, 0)))
    return true
  end)
end

local function safe_write_create_midi_item(request)
  local track, failure = track_from_request_refs(request)
  if not track then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local start_seconds = bounded_number(request.params.start_seconds, 0)
  local end_seconds = bounded_number(request.params.end_seconds, start_seconds + 1)
  if end_seconds <= start_seconds then
    return handler_error("PARAMS_INVALID", "MIDI item end_seconds must be greater than start_seconds.", {
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end
  local ok_item, item = call_reaper("CreateNewMIDIItemInProj", track, start_seconds, end_seconds, false)
  if not ok_item or not item then
    return handler_error("COMMAND_FAILED", "Could not create Safe-Write-A MIDI item.", {}, false)
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return handler_error("TAKE_NOT_FOUND", "Created MIDI item did not expose an active take.", {})
  end
  local summary = midi_take_summary(take)
  summary.item_ref = item_ref_string(item)
  summary.created = true
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(item_object_ref(item), take_object_ref(take))
end

local function ppq_position(take, event, key)
  local value = event[key]
  if type(value) == "number" then
    return value
  end
  local seconds_key = "seconds"
  if key == "start_ppq" then
    seconds_key = "start_seconds"
  elseif key == "end_ppq" then
    seconds_key = "end_seconds"
  elseif key == "ppq" then
    seconds_key = "position_seconds"
  end
  if type(event[seconds_key]) == "number" then
    local ok, ppq = call_reaper("MIDI_GetPPQPosFromProjTime", take, event[seconds_key])
    return ok and first_number(ppq) or 0
  end
  return 0
end

local function safe_write_insert_notes_batch(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local notes = is_json_array(request.params.notes) and request.params.notes or json_array({})
  local inserted = 0
  for index = 1, #notes do
    local note = is_object(notes[index]) and notes[index] or {}
    local start_ppq = ppq_position(take, note, "start_ppq")
    local end_ppq = ppq_position(take, note, "end_ppq")
    if end_ppq > start_ppq then
      local ok, success = call_reaper(
        "MIDI_InsertNote",
        take,
        note.selected == true,
        note.muted == true,
        start_ppq,
        end_ppq,
        math.max(0, math.min(15, integer_value(note.channel) or 0)),
        math.max(0, math.min(127, integer_value(note.pitch) or 60)),
        math.max(1, math.min(127, integer_value(note.velocity) or 96)),
        true
      )
      if ok and success ~= false then
        inserted = inserted + 1
      end
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_note_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end

local function safe_write_insert_cc_batch(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local inserted = 0
  for index = 1, #events do
    local event = is_object(events[index]) and events[index] or {}
    local ppq = ppq_position(take, event, "ppq")
    local ok, success = call_reaper(
      "MIDI_InsertCC",
      take,
      event.selected == true,
      event.muted == true,
      ppq,
      176,
      math.max(0, math.min(15, integer_value(event.channel) or 0)),
      math.max(0, math.min(127, integer_value(event.controller) or 1)),
      math.max(0, math.min(127, integer_value(event.value) or 0)),
      true
    )
    if ok and success ~= false then
      inserted = inserted + 1
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_cc_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end

local function text_sysex_type_value(kind)
  if kind == "sysex" then
    return -1
  elseif kind == "lyric" then
    return 5
  elseif kind == "notation" then
    return 15
  end
  return 1
end

local function safe_write_insert_text_sysex_events(request)
  local take, failure = resolve_midi_take_for_request(request)
  if not take then
    return handler_error(failure.code, failure.message, failure.details)
  end
  local events = is_json_array(request.params.events) and request.params.events or json_array({})
  local inserted = 0
  for index = 1, #events do
    local event = is_object(events[index]) and events[index] or {}
    local ppq = ppq_position(take, event, "ppq")
    local ok, success = call_reaper(
      "MIDI_InsertTextSysexEvt",
      take,
      event.selected == true,
      event.muted == true,
      ppq,
      text_sysex_type_value(event.event_kind),
      bounded_string(event.text or event.bytes or "", 240),
      true
    )
    if ok and success ~= false then
      inserted = inserted + 1
    end
  end
  if request.params.sort_events ~= false then
    call_reaper("MIDI_Sort", take)
  end
  local summary = read_take_event_counts({ refs = json_array({ take_object_ref(take) }), params = {}, budget = request.budget })
  summary.inserted_text_sysex_count = inserted
  return safe_write_a_summary(request, summary), nil, nil, nil, safe_write_a_refs(take_object_ref(take))
end

local SAFE_WRITE_A_HANDLERS = {
  ["project.set_metadata_field"] = safe_write_project_metadata,
  ["project.create_marker"] = safe_write_create_marker,
  ["project.create_region"] = safe_write_create_region,
  ["track.create"] = safe_write_create_track,
  ["track.rename"] = safe_write_rename_track,
  ["track.set_color"] = safe_write_set_track_color,
  ["track.select"] = safe_write_select_track,
  ["track.set_mute"] = safe_write_set_track_mute,
  ["track.set_solo"] = safe_write_set_track_solo,
  ["transport.set_edit_cursor"] = safe_write_transport_set_edit_cursor,
  ["transport.set_time_selection"] = safe_write_transport_set_time_selection,
  ["transport.clear_time_selection"] = safe_write_transport_clear_time_selection,
  ["transport.set_loop_points"] = safe_write_transport_set_loop_points,
  ["transport.clear_loop_points"] = safe_write_transport_clear_loop_points,
  ["transport.set_repeat"] = safe_write_transport_set_repeat,
  ["items.move_item"] = safe_write_move_item,
  ["items.trim_item"] = safe_write_trim_item,
  ["items.set_item_fades"] = safe_write_set_item_fades,
  ["items.set_take_pitch"] = safe_write_set_take_pitch,
  ["items.set_item_snap_offset"] = safe_write_set_item_snap_offset,
  ["midi.create_midi_item"] = safe_write_create_midi_item,
  ["midi.insert_notes_batch"] = safe_write_insert_notes_batch,
  ["midi.insert_cc_batch"] = safe_write_insert_cc_batch,
  ["midi.insert_text_sysex_events"] = safe_write_insert_text_sysex_events,
}

local function dispatch_safe_write_a(request)
  local handler = SAFE_WRITE_A_HANDLERS[request.pack.capability]
  if not handler then
    return handler_error("OPERATION_NOT_FOUND", "Safe-Write-A supports only the approved 24 capabilities.", {
      capability = bounded_string(request.pack.capability, 120),
    })
  end
  return handler(request)
end

local ALLOWED_OPERATIONS = {
  ["run_command:template.execute"] = {
    handler = dispatch_safe_write_a,
  },
  ["query_state:project.read_summary"] = {
    pack = "project",
    handler = read_project_summary,
  },
  ["query_state:project.read_metadata"] = {
    pack = "project",
    handler = read_project_metadata,
  },
  ["query_state:project.list_markers_regions"] = {
    pack = "project",
    handler = list_markers_regions,
  },
  ["query_state:project.read_tempo_map"] = {
    pack = "project",
    handler = read_tempo_map,
  },
  ["query_state:transport.read_state"] = {
    pack = "transport",
    handler = read_transport_state,
  },
  ["query_state:openreaper.read_status"] = {
    pack = "core",
    handler = read_openreaper_status,
  },
  ["query_state:template_catalog.read_summary"] = {
    pack = "core",
    handler = read_template_catalog_summary,
  },
  ["query_state:last_result.read"] = {
    pack = "core",
    handler = read_last_result,
  },
  ["query_state:track.resolve_ref"] = {
    pack = "tracks",
    handler = resolve_track_ref,
  },
  ["query_state:items.resolve_item_ref"] = {
    pack = "items",
    handler = resolve_item_ref,
  },
  ["query_state:items.read_item_summary"] = {
    pack = "items",
    handler = read_item_summary,
  },
  ["query_state:system.runtime_environment.read"] = {
    pack = "system",
    handler = read_runtime_environment,
  },
  ["query_state:system.resource_paths.read"] = {
    pack = "system",
    handler = read_resource_paths,
  },
  ["query_state:system.api_symbols.check"] = {
    pack = "system",
    handler = read_api_symbols,
  },
  ["query_state:actions.resolve_named_command"] = {
    pack = "actions",
    handler = resolve_named_command,
  },
  ["query_state:actions.read_action_metadata"] = {
    pack = "actions",
    handler = read_action_metadata,
  },
  ["query_state:actions.read_action_toggle_state"] = {
    pack = "actions",
    handler = read_action_toggle_state,
  },
  ["query_state:actions.read_action_shortcuts"] = {
    pack = "actions",
    handler = read_action_shortcuts,
  },
  ["query_state:actions.parse_marker_action_text"] = {
    pack = "actions",
    handler = parse_marker_action_text,
  },
  ["query_state:actions.search_action_commands"] = {
    pack = "actions",
    handler = search_action_commands,
  },
  ["query_state:midi.resolve_midi_take_ref"] = {
    pack = "midi",
    handler = resolve_midi_take_ref,
  },
  ["query_state:midi.read_take_event_counts"] = {
    pack = "midi",
    handler = read_take_event_counts,
  },
  ["query_state:midi.list_take_notes"] = {
    pack = "midi",
    handler = list_take_notes,
  },
  ["query_state:midi.list_take_cc_events"] = {
    pack = "midi",
    handler = list_take_cc_events,
  },
  ["query_state:midi.list_take_text_sysex_events"] = {
    pack = "midi",
    handler = list_take_text_sysex_events,
  },
  ["query_state:midi.read_take_grid"] = {
    pack = "midi",
    handler = read_take_grid,
  },
  ["query_state:media.file.probe"] = {
    pack = "media",
    handler = probe_media_file,
  },
  ["query_state:media.take_source.read"] = {
    pack = "media",
    handler = read_take_source,
  },
  ["query_state:media.project_files.read"] = {
    pack = "media",
    handler = read_project_media_files,
  },
  ["run_job:analysis.detect_loop_candidates"] = {
    pack = "analysis",
    handler = detect_loop_candidates,
  },
  ["run_job:analysis.measure_loop_click_risk"] = {
    pack = "analysis",
    handler = measure_loop_click_risk,
  },
  ["run_job:analysis.create_loop_qa_report"] = {
    pack = "analysis",
    handler = create_loop_qa_report,
  },
  ["run_job:project.create_cleanup_report"] = {
    pack = "project",
    handler = create_cleanup_report,
  },
  ["run_job:render.region_wav"] = {
    pack = "render",
    handler = render_region_wav,
  },
  ["run_job:render.delivery_report.create"] = {
    pack = "render",
    handler = create_delivery_report,
  },
  ["run_job:items.create_layer_report"] = {
    pack = "items",
    handler = create_layer_report,
  },
}

local function dispatch_request(request, fallback_id)
  local started_at = now_iso()
  local valid, validation_error = validate_request(request)
  if not valid then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Bridge request failed validation.", {
      fallback_id = fallback_id,
      recoverable = true,
      started_at = started_at,
      details = { reason = validation_error },
    })
  end
  if request.bridge.expected_owner ~= ACTIVE_OWNER then
    return bridge_error_envelope(request, "BRIDGE_OWNER_MISMATCH", "Bridge owner token changed.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_owner = request.bridge.expected_owner,
        actual_owner = ACTIVE_OWNER,
      },
    })
  end
  if request.bridge.expected_generation ~= ACTIVE_GENERATION then
    return bridge_error_envelope(request, "BRIDGE_GENERATION_MISMATCH", "Bridge generation changed.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_generation = request.bridge.expected_generation,
        actual_generation = ACTIVE_GENERATION,
      },
    })
  end

  local key = request.operation.family .. ":" .. request.operation.name
  local operation = ALLOWED_OPERATIONS[key]
  if not operation then
    return bridge_error_envelope(request, "OPERATION_NOT_FOUND", "OpenReaper live bridge supports only the approved scoped live-smoke operations.", {
      recoverable = true,
      started_at = started_at,
      details = {
        operation_family = request.operation.family,
        operation_name = request.operation.name,
      },
    })
  end
  if operation.pack and operation.pack ~= request.pack.id then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Operation owner pack does not match the request pack.", {
      recoverable = true,
      started_at = started_at,
      details = {
        expected_pack = operation.pack,
        actual_pack = request.pack.id,
      },
    })
  end

  open_required_undo_block(request, operation_key)
  local ok, summary, handler_failure, artifacts, jobs, refs = pcall(operation.handler, request)
  close_required_undo_block(request, operation_key)
  if not ok then
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Scoped live bridge handler failed.", {
      recoverable = false,
      started_at = started_at,
      details = {
        operation_name = request.operation.name,
        message = bounded_string(summary, 240),
      },
    })
  end
  if handler_failure then
    return bridge_error_envelope(request, handler_failure.code or "INTERNAL_ERROR", handler_failure.message or "Scoped live bridge handler failed.", {
      recoverable = handler_failure.recoverable ~= false,
      started_at = started_at,
      details = handler_failure.details or {},
    })
  end
  return bridge_ok_envelope(request, started_at, summary, artifacts, jobs, refs)
end
