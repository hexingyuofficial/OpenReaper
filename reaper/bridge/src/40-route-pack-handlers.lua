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

  open_required_undo_block(request, key)
  local ok, summary, handler_failure, artifacts, jobs, refs = pcall(operation.handler, request)
  close_required_undo_block(request, key)
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
