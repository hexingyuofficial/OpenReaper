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
  local ok_count, count_retval, note_count, cc_count, text_sysex_count = call_reaper("MIDI_CountEvts", take)
  local count_ok = ok_count and count_retval ~= false
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
    event_count = count_ok and ((first_number(note_count) or 0) + (first_number(cc_count) or 0) + (first_number(text_sysex_count) or 0)) or 0,
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
  ["fx.delete_fx"] = alpha33_delete_fx,
  ["routing.remove_send"] = alpha33_remove_send,
  ["items.move_item_to_track"] = alpha33_move_item_to_track,
  ["items.glue_item"] = alpha33_glue_item,
  ["tracks.freeze_track"] = alpha33_freeze_track,
  ["tracks.unfreeze_track"] = alpha33_unfreeze_track,
  ["automation.ensure_take_pitch_envelope"] = alpha33_ensure_take_pitch_envelope,
  ["items.split_item_by_silence"] = alpha33_split_item_by_silence,
}

local E3_MEDIA_ROUTE_HANDLERS = {
  ["media.import_file_to_track"] = import_file_to_track,
  ["media.import_file_section_to_track"] = import_file_section_to_track,
  ["media.import_files_batch"] = import_files_batch,
  ["media.relink_take_source"] = relink_take_source,
}

local E4_ITEM_ROUTE_HANDLERS = {
  ["item.copy_to_track"] = copy_item_to_track,
  ["items.split_item_at_time"] = split_item_at_time,
  ["items.set_take_playrate"] = set_take_playrate,
}

local E5_ROUTING_WRITE_HANDLERS = {
  ["routing.send.create"] = create_track_send,
  ["routing.send.set_volume"] = set_send_volume,
  ["routing.send.set_pan"] = set_send_pan,
  ["routing.send.set_mute"] = set_send_mute,
  ["routing.send.set_mode"] = set_send_mode,
  ["routing.master_parent.set"] = set_master_parent_send,
  ["routing.track_channels.set"] = set_track_channel_count,
  ["routing.track_hardware_output.set"] = set_track_hardware_output,
  ["routing.track_hardware_output.remove"] = remove_track_hardware_output,
  ["routing.send.audio_channels.set"] = set_send_audio_channels,
  ["routing.send.set_phase"] = set_send_phase,
  ["routing.send.set_mono"] = set_send_mono,
  ["routing.send.midi_channels.set"] = set_send_midi_channels,
}

local E5_AUTOMATION_WRITE_HANDLERS = {
  ["automation.set_envelope_lane_state"] = set_envelope_lane_state,
  ["automation.insert_envelope_point"] = insert_envelope_point,
  ["automation.set_track_automation_mode"] = set_track_automation_mode,
  ["automation.set_envelope_point"] = set_envelope_point,
  ["automation.insert_envelope_points_batch"] = insert_envelope_points_batch,
  ["automation.delete_envelope_points"] = delete_envelope_points,
  ["automation.set_send_automation_mode"] = set_send_automation_mode,
  ["automation.create_automation_item"] = create_automation_item,
  ["automation.set_automation_item_bounds"] = set_automation_item_bounds,
  ["automation.delete_automation_item"] = delete_automation_item,
  ["automation.ensure_fx_parameter_envelope"] = ensure_fx_parameter_envelope,
  ["automation.insert_fx_parameter_envelope_points"] = insert_fx_parameter_envelope_points,
  ["automation.insert_fx_parameter_envelope_points_batch"] = insert_fx_parameter_envelope_points_batch,
  ["automation.insert_sine_wave_points"] = insert_sine_wave_points,
}

local E2_FX_B1_WRITE_HANDLERS = {
  ["fx.add_track"] = add_track_fx,
  ["fx.add_take"] = add_take_fx,
  ["fx.set_bypass"] = set_fx_bypass,
  ["fx.set_parameter_normalized"] = set_fx_parameter_normalized,
  ["fx.set_parameter_assignments_batch"] = e2_fx_parameter_assignments_batch,
  ["fx.set_reaeq_bands"] = e2_fx_set_reaeq_bands,
  ["fx.set_preset_by_name"] = set_fx_preset_by_name,
  ["fx.set_preset_by_index"] = set_fx_preset_by_index,
  ["fx.reorder"] = reorder_fx,
}

local D6_PROJECT_TEMPO_WRITE_HANDLERS = {
  ["project.set_tempo"] = d6_project_set_tempo,
  ["project.set_bpm"] = d6_project_set_bpm,
  ["project.set_tempo_marker"] = d6_project_set_tempo_marker,
  ["project.set_grid"] = d20_project_set_grid,
}

local D9_TRACKS_MIXER_WRITE_HANDLERS = {
  ["track.set_record_arm"] = set_record_arm,
  ["track.set_volume"] = set_volume,
  ["track.set_pan"] = set_pan,
  ["track.set_width"] = set_width,
}

local D11_PROJECT_MARKER_REGION_HANDLERS = {
  ["project.delete_marker"] = d11_project_delete_marker,
  ["project.delete_region"] = d11_project_delete_region,
  ["project.remove_marker"] = d11_project_remove_marker,
  ["project.remove_region"] = d11_project_remove_region,
  ["project.rename_marker"] = d11_project_rename_marker,
  ["project.rename_region"] = d11_project_rename_region,
}

local D12_TRANSPORT_SAFE_HANDLERS = {
  ["transport.play"] = d12_transport_play,
  ["transport.pause"] = d12_transport_pause,
  ["transport.stop_playback"] = d12_transport_stop_playback,
  ["transport.set_playback_rate"] = d12_transport_set_playback_rate,
  ["transport.start_recording"] = d12_transport_start_recording,
  ["transport.stop_recording"] = d12_transport_stop_recording,
  ["transport.set_record_mode"] = d12_transport_set_record_mode,
  ["transport.set_punch_record_range"] = d12_transport_set_punch_record_range,
  ["transport.schedule_recording"] = d12_transport_schedule_recording,
}

local D13_ITEMS_CORE_WRITE_HANDLERS = {
  ["items.set_exact_selection"] = d13_items_set_exact_selection,
  ["items.set_item_volume"] = d13_items_set_item_volume,
  ["items.set_item_take_controls_batch"] = d13_items_set_item_take_controls_batch,
  ["items.set_take_volume"] = d13_items_set_take_volume,
  ["items.set_take_pan"] = d13_items_set_take_pan,
  ["items.set_active_take"] = set_active_take,
  ["items.rename_take"] = d13_items_rename_take,
  ["items.set_loop_source"] = d13_items_set_loop_source,
  ["items.set_mute"] = d13_items_set_mute,
  ["items.set_lock"] = d13_items_set_lock,
  ["items.set_play_all_takes"] = d13_items_set_play_all_takes,
  ["items.set_take_start_in_source"] = d13_items_set_take_start_in_source,
  ["items.set_channel_mode"] = d13_items_set_channel_mode,
  ["items.set_pitch_shift_mode"] = d13_items_set_pitch_shift_mode,
  ["items.set_stretch_marker_fade_size"] = d13_items_set_stretch_marker_fade_size,
}

local D14_ITEMS_DELETE_HANDLERS = {
  ["items.delete_item"] = d14_items_delete_item,
  ["items.delete_items"] = d14_items_delete_items,
}

local D15_ITEMS_SOURCE_PHASE_HANDLERS = {
  ["items.set_no_autofades"] = d15_items_set_no_autofades,
  ["items.set_invert_phase"] = d15_items_set_invert_phase,
  ["items.choose_new_source_file"] = d15_items_choose_new_source_file,
}

local D16_TRACKS_ORG_HANDLERS = {
  ["track.delete"] = d16_tracks_delete_track,
  ["tracks.delete"] = d16_tracks_delete_tracks,
  ["track.create_folder"] = d16_tracks_create_folder_track,
  ["track.set_folder_depth"] = d16_tracks_set_folder_depth,
  ["track.move"] = d16_tracks_move_track,
  ["tracks.move"] = d16_tracks_move_tracks,
  ["tracks.nest_in_folder"] = d16_tracks_nest_tracks_in_folder,
}

local D17_MIDI_EDIT_HANDLERS = {
  ["midi.set_notes_batch"] = d17_midi_set_notes_batch,
  ["midi.quantize_notes"] = d17_midi_quantize_notes,
  ["midi.quantize_selected_notes"] = d17_midi_quantize_selected_notes,
  ["midi.set_cc_events_batch"] = d17_midi_set_cc_events_batch,
}

local D22_RENDER_SETTINGS_WRITE_HANDLERS = {
  ["render.sample_rate.set"] = set_render_sample_rate,
}

local D28_SMALL_WRITE_HANDLERS = {
  ["items.set_reverse"] = d13_items_set_reverse,
  ["project.set_snap"] = d20_project_set_snap,
  ["routing.track_mono_stereo.set"] = track_mono_or_stereo_button,
}

local D29_RENDER_SETTINGS_WRITE_HANDLERS = {
  ["render.format.set"] = set_render_format,
  ["render.ogg_quality.set"] = set_ogg_quality_or_compression,
  ["render.mp3_bitrate_kbps.set"] = set_mp3_bitrate_or_quality,
  ["render.flac_compression.set"] = set_flac_compression,
  ["render.aiff_bit_depth.set"] = set_aiff_bit_depth,
}

local D30_PROJECT_CONTAINER_HANDLERS = {
  ["project.create_subproject"] = create_subproject,
  ["project.create_project_tab"] = create_project_tab,
  ["project.open_project_in_tab"] = open_project_in_tab,
  ["project.activate_project_tab"] = activate_project_tab,
  ["project.insert_subproject_item"] = insert_subproject_item,
  ["project.render_or_update_subproject"] = render_or_update_subproject,
}

local ALPHA3_2C3BC_PROJECT_FILE_SAVE_HANDLERS = {
  ["project.save_current_project"] = save_current_project,
  ["project.save_project_as"] = save_project_as,
}

local function dispatch_template_execute(request, resume_continuation)
  local handler = SAFE_WRITE_A_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  handler = E3_MEDIA_ROUTE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  handler = E4_ITEM_ROUTE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  handler = E5_ROUTING_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E5_AUTOMATION_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = E2_FX_B1_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D6_PROJECT_TEMPO_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D9_TRACKS_MIXER_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D11_PROJECT_MARKER_REGION_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D12_TRANSPORT_SAFE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D13_ITEMS_CORE_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  handler = D14_ITEMS_DELETE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D15_ITEMS_SOURCE_PHASE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D16_TRACKS_ORG_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D17_MIDI_EDIT_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D22_RENDER_SETTINGS_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D28_SMALL_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D29_RENDER_SETTINGS_WRITE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request)
  end
  handler = D30_PROJECT_CONTAINER_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  handler = ALPHA3_2C3BC_PROJECT_FILE_SAVE_HANDLERS[request.pack.capability]
  if handler then
    return handler(request, resume_continuation)
  end
  return handler_error("OPERATION_NOT_FOUND", "template.execute supports only approved live-smoke capabilities.", {
      capability = bounded_string(request.pack.capability, 120),
    })
end

local function dispatch_recipe_undo_transaction(request)
  local function active_recipe_undo_conflict_details()
    local active = ACTIVE_RECIPE_UNDO_TRANSACTION
    if not active then
      return {
        blocker = "recipe_undo_transaction_not_active",
        outcome = "not_run",
        zero_write = true,
      }
    end
    local active_project_matches = active_recipe_undo_project_matches()
    local proven_not_run = active.mutation_may_have_happened == false
      and active.close_outcome_unknown ~= true
      and active_project_matches == true
    return {
      blocker = proven_not_run and "recipe_undo_orphan_not_run" or "recipe_undo_transaction_state_uncertain",
      outcome = proven_not_run and "not_run" or "unknown",
      zero_write = proven_not_run,
      active_transaction_id = bounded_string(active.id, 160),
      active_transaction = {
        transaction_id = bounded_string(active.id, 160),
        project_ref = bounded_string(active.project_ref, 240),
        label = bounded_string(active.label, 240),
        owner = bounded_string(active.owner, 160),
        generation = active.generation,
        mutation_may_have_happened = active.mutation_may_have_happened == true,
        close_outcome_unknown = active.close_outcome_unknown == true,
        active_project_matches = active_project_matches == true,
      },
    }
  end

  local params = is_object(request.params) and request.params or {}
  local action = params.action
  local transaction_id = params.transaction_id
  local project_ref = params.project_ref
  local label = params.label
  if (action ~= "begin" and action ~= "end" and action ~= "reconcile_not_run") or not is_string(transaction_id)
      or not is_string(project_ref) or not is_string(label) then
    return handler_error("PARAMS_INVALID", "Recipe Undo transaction requires begin, end, or reconcile_not_run with transaction_id, project_ref, and label.", {
      zero_write = true,
    })
  end

  if action == "begin" then
    if ACTIVE_RECIPE_UNDO_TRANSACTION then
      return handler_error("QUEUE_CONFLICT", "A Recipe Undo transaction is already active.", active_recipe_undo_conflict_details())
    end
    local ok_project, project, project_path = call_reaper("EnumProjects", -1, "")
    if not ok_project or project == nil then
      return handler_error("PROJECT_NOT_FOUND", "The active project is unavailable for Recipe Undo begin.", {
        zero_write = true,
      })
    end
    local expected_path = project_ref:match("^project:path:(.+)$")
    if expected_path and project_path ~= expected_path then
      return handler_error("PROJECT_NOT_FOUND", "Recipe Undo begin project identity does not match the active project.", {
        expected_project_ref = bounded_string(project_ref, 240),
        active_project_path = bounded_string(project_path or "", 240),
        zero_write = true,
      })
    end
    local ok_begin = call_reaper("Undo_BeginBlock2", project)
    if ok_begin ~= true then
      return handler_error("COMMAND_FAILED", "Recipe Undo block could not be opened before mutation.", {
        blocker = "recipe_undo_begin_failed",
        zero_write = true,
      })
    end
    ACTIVE_RECIPE_UNDO_TRANSACTION = {
      id = transaction_id,
      label = label,
      project = project,
      project_ref = project_ref,
      session_id = request.client.session_id,
      owner = request.bridge.expected_owner,
      generation = request.bridge.expected_generation,
      mutation_may_have_happened = false,
      close_outcome_unknown = false,
    }
    request.__openreaper_undo_opened = true
    request.__openreaper_undo_closed = false
    request.__openreaper_undo_required_any = true
    return {
      contract = "openreaper.recipe_undo_transaction.v1",
      action = "begin",
      transaction_id = transaction_id,
      project_ref = project_ref,
      opened = true,
      closed = false,
      verified = true,
      readback_status = "passed",
    }
  end

  local active = ACTIVE_RECIPE_UNDO_TRANSACTION
  if action == "reconcile_not_run" then
    if not active
        or active.id ~= transaction_id
        or active.project_ref ~= project_ref
        or active.label ~= label
        or active.owner ~= request.bridge.expected_owner
        or active.generation ~= request.bridge.expected_generation then
      return handler_error("QUEUE_CONFLICT", "Recipe Undo reconcile_not_run does not match the exact active transaction.", active_recipe_undo_conflict_details())
    end
    if active.mutation_may_have_happened == true or active.close_outcome_unknown == true then
      return handler_error("QUEUE_CONFLICT", "Recipe Undo transaction is not proven not_run and cannot be reconciled automatically.", active_recipe_undo_conflict_details(), false)
    end
    if not active_recipe_undo_project_matches() then
      return handler_error("VERIFY_FAILED", "The active project changed before Recipe Undo reconcile_not_run.", active_recipe_undo_conflict_details(), false)
    end
    local results = { call_reaper("Undo_EndBlock2", active.project, active.label, -1) }
    local closed = results[1] == true and (results[2] == nil or results[2] == true)
    request.__openreaper_undo_opened = true
    request.__openreaper_undo_closed = closed
    request.__openreaper_undo_required_any = true
    if not closed then
      active.close_outcome_unknown = true
      return handler_error("INTERNAL_ERROR", "Recipe Undo reconcile_not_run close outcome is unknown.", active_recipe_undo_conflict_details(), false)
    end
    ACTIVE_RECIPE_UNDO_TRANSACTION = nil
    return {
      contract = "openreaper.recipe_undo_transaction.v1",
      action = "reconcile_not_run",
      transaction_id = transaction_id,
      project_ref = project_ref,
      mutation_truth = "not_run",
      opened = true,
      closed = true,
      verified = true,
      readback_status = "passed",
    }
  end

  if not active or active.id ~= transaction_id or active.project_ref ~= project_ref
      or active.label ~= label or active.session_id ~= request.client.session_id
      or active.owner ~= request.bridge.expected_owner
      or active.generation ~= request.bridge.expected_generation then
    return handler_error("QUEUE_CONFLICT", "Recipe Undo end does not match the active transaction.", active_recipe_undo_conflict_details())
  end
  local active_project_matches = active_recipe_undo_project_matches()
  local results = { call_reaper("Undo_EndBlock2", active.project, active.label, -1) }
  local closed = results[1] == true and (results[2] == nil or results[2] == true)
  request.__openreaper_undo_opened = true
  request.__openreaper_undo_closed = closed
  request.__openreaper_undo_required_any = true
  if not closed then
    active.close_outcome_unknown = true
    return handler_error("INTERNAL_ERROR", "Recipe Undo close outcome is unknown.", {
      blocker = "recipe_undo_close_failed",
      outcome = "unknown",
      zero_write = false,
      mutations_may_have_happened = params.mutation_truth ~= "not_run",
    }, false)
  end
  ACTIVE_RECIPE_UNDO_TRANSACTION = nil
  if not active_project_matches then
    return handler_error("VERIFY_FAILED", "The active project changed before Recipe Undo close verification.", {
      blocker = "recipe_active_project_changed",
      outcome = "unknown",
      mutations_may_have_happened = params.mutation_truth ~= "not_run",
    }, false)
  end
  return {
    contract = "openreaper.recipe_undo_transaction.v1",
    action = "end",
    transaction_id = transaction_id,
    project_ref = project_ref,
    mutation_truth = params.mutation_truth,
    opened = true,
    closed = true,
    verified = true,
    readback_status = "passed",
  }
end

local RECIPE_UNDO_OPERATION_KEY = "run_command:" .. "recipe.undo.transaction"

local ALLOWED_OPERATIONS = {
  ["run_command:template.execute"] = {
    handler = dispatch_template_execute,
  },
  ["run_job:template.execute"] = {
    handler = dispatch_template_execute,
  },
  ["run_command:render.sample_rate.set"] = {
    pack = "render",
    handler = set_render_sample_rate,
  },
  ["run_command:render.format.set"] = {
    pack = "render",
    handler = set_render_format,
  },
  ["run_command:render.ogg_quality.set"] = {
    pack = "render",
    handler = set_ogg_quality_or_compression,
  },
  ["run_command:render.mp3_bitrate_kbps.set"] = {
    pack = "render",
    handler = set_mp3_bitrate_or_quality,
  },
  ["run_command:render.flac_compression.set"] = {
    pack = "render",
    handler = set_flac_compression,
  },
  ["run_command:render.aiff_bit_depth.set"] = {
    pack = "render",
    handler = set_aiff_bit_depth,
  },
  ["artifact_metadata:render.output.absolute_path"] = {
    pack = "render",
    handler = output_absolute_path,
  },
  ["artifact_metadata:render.output_file.metadata"] = {
    pack = "render",
    handler = output_file_metadata,
  },
  ["query_state:project.read_summary"] = {
    pack = "project",
    handler = read_project_summary,
  },
  ["query_state:project.read_current_project_path"] = {
    pack = "project",
    handler = read_current_project_path,
  },
  ["query_state:project.read_dirty_state"] = {
    pack = "project",
    handler = read_dirty_state,
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
  ["query_state:project.read_track_item_overview"] = {
    pack = "project",
    handler = read_track_item_overview,
  },
  ["query_state:project.list_open_projects"] = {
    pack = "project",
    handler = list_open_projects,
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
  ["query_state:tracks.list_tracks"] = {
    pack = "tracks",
    handler = list_tracks,
  },
  ["query_state:tracks.read_mixer_controls"] = {
    pack = "tracks",
    handler = read_mixer_controls,
  },
  ["query_state:tracks.read_folder_structure"] = {
    pack = "tracks",
    handler = read_folder_structure,
  },
  ["query_state:items.resolve_item_ref"] = {
    pack = "items",
    handler = resolve_item_ref,
  },
  ["query_state:items.read_item_summary"] = {
    pack = "items",
    handler = read_item_summary,
  },
  ["query_state:items.list_selected_items"] = {
    pack = "items",
    handler = d13_items_list_selected_items,
  },
  ["query_state:items.list_items_on_track"] = {
    pack = "items",
    handler = d13_items_list_items_on_track,
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
  ["query_state:fx.installed.search"] = {
    pack = "fx",
    handler = search_installed_fx,
  },
  ["query_state:actions.read_custom_action_metadata"] = {
    pack = "actions",
    handler = read_custom_action_metadata,
  },
  ["query_state:actions.read_cycle_action_metadata"] = {
    pack = "actions",
    handler = read_cycle_action_metadata,
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
  ["query_state:media.folder_media.list"] = {
    pack = "media",
    handler = list_folder_media_files,
  },
  ["query_state:routing.track.read"] = {
    pack = "routing",
    handler = read_track_routing,
  },
  ["query_state:routing.send.resolve_ref"] = {
    pack = "routing",
    handler = resolve_send_ref,
  },
  ["query_state:routing.track_hardware_outputs.list"] = {
    pack = "routing",
    handler = list_track_hardware_outputs,
  },
  ["query_state:routing.project_graph.read"] = {
    pack = "routing",
    handler = read_project_routing_graph,
  },
  ["query_state:routing.audio_outputs.list"] = {
    pack = "routing",
    handler = list_available_audio_outputs,
  },
  ["query_state:routing.fx_pin_mapping.read"] = {
    pack = "routing",
    handler = read_fx_pin_mapping,
  },
  ["query_state:automation.resolve_envelope_ref"] = {
    pack = "automation",
    handler = resolve_envelope_ref,
  },
  ["query_state:automation.project_envelopes.list"] = {
    pack = "automation",
    handler = list_project_envelopes,
  },
  ["query_state:automation.read_envelope_summary"] = {
    pack = "automation",
    handler = read_envelope_summary,
  },
  ["query_state:automation.read_envelope_points"] = {
    pack = "automation",
    handler = read_envelope_points,
  },
  ["query_state:automation.evaluate_envelope_at_time"] = {
    pack = "automation",
    handler = evaluate_envelope_at_time,
  },
  ["query_state:automation.read_track_automation_mode"] = {
    pack = "automation",
    handler = read_track_automation_mode,
  },
  ["query_state:automation.read_automation_items"] = {
    pack = "automation",
    handler = read_automation_items,
  },
  ["query_state:automation.resolve_send_envelope"] = {
    pack = "automation",
    handler = resolve_send_envelope,
  },
  ["query_state:fx.resolve_ref"] = {
    pack = "fx",
    handler = resolve_fx_ref,
  },
  ["query_state:fx.list_track_chain"] = {
    pack = "fx",
    handler = list_track_fx_chain,
  },
  ["query_state:fx.list_take_chain"] = {
    pack = "fx",
    handler = list_take_fx_chain,
  },
  ["query_state:fx.read_summary"] = {
    pack = "fx",
    handler = read_fx_summary,
  },
  ["query_state:fx.list_parameters"] = {
    pack = "fx",
    handler = list_fx_parameters,
  },
  ["query_state:fx.read_parameter"] = {
    pack = "fx",
    handler = read_fx_parameter,
  },
  ["query_state:fx.parameter_to_envelope_mapping"] = {
    pack = "fx",
    handler = parameter_to_envelope_mapping,
  },
  ["query_state:fx.read_video_processor_code"] = {
    pack = "fx",
    handler = read_video_processor_code,
  },
  ["query_state:render.settings.read"] = {
    pack = "render",
    handler = read_render_settings,
  },
  ["query_state:render.bounds.resolve"] = {
    pack = "render",
    handler = resolve_render_bounds,
  },
  ["query_state:render.targets.preview"] = {
    pack = "render",
    handler = preview_render_targets,
  },
  ["query_state:render.region_matrix.read"] = {
    pack = "render",
    handler = read_region_render_matrix,
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
  ["run_job:analysis.measure_item_rms"] = {
    pack = "analysis",
    handler = measure_item_rms,
  },
  ["run_job:analysis.measure_item_peaks"] = {
    pack = "analysis",
    handler = measure_item_peaks,
  },
  ["run_job:analysis.detect_item_silence"] = {
    pack = "analysis",
    handler = detect_item_silence,
  },
  ["run_job:analysis.detect_item_transients"] = {
    pack = "analysis",
    handler = detect_item_transients,
  },
  ["run_job:project.create_cleanup_report"] = {
    pack = "project",
    handler = create_cleanup_report,
  },
  ["run_job:project.create_project_map_snapshot"] = {
    pack = "project",
    handler = create_project_map_snapshot,
  },
  ["run_job:project.create_observation_bundle"] = {
    pack = "project",
    handler = create_observation_bundle,
  },
  ["run_job:render.region_wav"] = {
    pack = "render",
    handler = render_region_wav,
  },
  ["run_job:render.item"] = {
    pack = "render",
    handler = render_item,
  },
  ["run_job:render.selected_item"] = {
    pack = "render",
    handler = render_selected_item,
  },
  ["run_job:render.track_item"] = {
    pack = "render",
    handler = render_track_item,
  },
  ["run_job:render.selected_tracks"] = {
    pack = "render",
    handler = render_selected_tracks,
  },
  ["run_job:render.ogg"] = {
    pack = "render",
    handler = render_ogg,
  },
  ["run_job:render.mp3"] = {
    pack = "render",
    handler = render_mp3,
  },
  ["run_job:render.flac"] = {
    pack = "render",
    handler = render_flac,
  },
  ["run_job:render.aiff"] = {
    pack = "render",
    handler = render_aiff,
  },
  ["run_job:render.m4a"] = {
    pack = "render",
    handler = render_m4a,
  },
  ["run_job:render.opus"] = {
    pack = "render",
    handler = render_opus,
  },
  ["run_job:render.region_track_filter"] = {
    pack = "render",
    handler = render_region_with_track_filter,
  },
  ["run_job:render.targets"] = {
    pack = "render",
    handler = d31_render_targets,
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

ALLOWED_OPERATIONS[RECIPE_UNDO_OPERATION_KEY] = {
  pack = "core",
  handler = dispatch_recipe_undo_transaction,
}

local BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"
local D30_DISPATCH_WRITE_RESPONSE_MIN_BYTES = 65536

local function is_bridge_internal_continuation(value)
  return type(value) == "table"
    and value.contract == BRIDGE_INTERNAL_CONTINUATION_CONTRACT
    and type(value.phase) == "string"
    and value.phase ~= ""
    and type(value.state) == "table"
    and type(value.mutations_may_have_happened) == "boolean"
    and type(value.next_phase_may_mutate) == "boolean"
end

local function bridge_internal_continuation(phase, state, mutations_may_have_happened, next_phase_may_mutate)
  return {
    contract = BRIDGE_INTERNAL_CONTINUATION_CONTRACT,
    phase = phase,
    state = state or {},
    mutations_may_have_happened = mutations_may_have_happened == true,
    next_phase_may_mutate = next_phase_may_mutate == true,
  }
end

local function unknown_outcome_details(mutated, extra)
  local details = extra or {}
  if mutated then
    details.outcome = "unknown"
    details.zero_write = false
    details.next_action = "Inspect live project state before deciding whether any mutation should be retried."
  end
  return details
end

local function dispatch_request(request, fallback_id, resume_continuation, runtime)
  local started_at = (runtime and runtime.started_at) or now_iso()
  local valid, validation_error = validate_request(request)
  if not valid then
    return bridge_error_envelope(request, "REQUEST_INVALID", "Bridge request failed validation.", {
      fallback_id = fallback_id,
      recoverable = true,
      started_at = started_at,
      details = { reason = validation_error },
    })
  end
  if resume_continuation ~= nil and not is_bridge_internal_continuation(resume_continuation) then
    local mutated = type(resume_continuation) == "table" and resume_continuation.mutations_may_have_happened == true
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge continuation state is malformed.", {
      recoverable = false,
      started_at = started_at,
      details = unknown_outcome_details(mutated, { reason = "malformed_internal_continuation" }),
    })
  end
  if request.bridge.expected_owner ~= ACTIVE_OWNER then
    local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
    return bridge_error_envelope(request, "BRIDGE_OWNER_MISMATCH", "Bridge owner token changed.", {
      recoverable = not mutated,
      started_at = started_at,
      details = unknown_outcome_details(mutated, {
        expected_owner = request.bridge.expected_owner,
        actual_owner = ACTIVE_OWNER,
      }),
    })
  end
  if request.bridge.expected_generation ~= ACTIVE_GENERATION then
    local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
    return bridge_error_envelope(request, "BRIDGE_GENERATION_MISMATCH", "Bridge generation changed.", {
      recoverable = not mutated,
      started_at = started_at,
      details = unknown_outcome_details(mutated, {
        expected_generation = request.bridge.expected_generation,
        actual_generation = ACTIVE_GENERATION,
      }),
    })
  end

  if runtime and type(runtime.deadline_monotonic) == "number" then
    local now_mono = runtime.now_monotonic
    if type(now_mono) ~= "number" then
      if reaper and type(reaper.time_precise) == "function" then
        now_mono = reaper.time_precise()
      else
        now_mono = os.clock()
      end
    end
    if now_mono > runtime.deadline_monotonic then
      local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
      return bridge_error_envelope(request, "BRIDGE_TIMEOUT", "Bridge request exceeded timeout_ms before a terminal result.", {
        recoverable = not mutated,
        started_at = started_at,
        queue_state = "timeout",
        details = unknown_outcome_details(mutated, {
          reason = "continuation_timeout",
          timeout_ms = request.timeout_ms,
        }),
      })
    end
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

  local capability = is_object(request.pack) and request.pack.capability or nil
  local d30_write_capability = capability == "project.create_project_tab"
    or capability == "project.open_project_in_tab"
    or capability == "project.activate_project_tab"
    or capability == "project.create_subproject"
    or capability == "project.insert_subproject_item"
    or capability == "project.render_or_update_subproject"
  local request_budget = is_object(request.budget) and request.budget or {}
  local max_response_bytes = math.floor(tonumber(request_budget.max_response_bytes) or 0)
  if d30_write_capability
      and max_response_bytes > 0
      and max_response_bytes < D30_DISPATCH_WRITE_RESPONSE_MIN_BYTES then
    local mutated = resume_continuation and resume_continuation.mutations_may_have_happened == true
    return bridge_error_envelope(request, "RESPONSE_TOO_LARGE", "D30 write success envelope cannot fit the request response budget before dispatch mutation.", {
      recoverable = not mutated,
      started_at = started_at,
      details = unknown_outcome_details(mutated, {
        zero_write = not mutated,
        required_response_bytes = D30_DISPATCH_WRITE_RESPONSE_MIN_BYTES,
        max_response_bytes = max_response_bytes,
        next_action = mutated
          and "Inspect live project state before deciding whether any mutation should be retried."
          or "Use the internal atomic child budget (65536) before retrying the write.",
      }),
    })
  end
  local project_switch_capability = capability == "project.create_project_tab"
    or capability == "project.open_project_in_tab"
    or capability == "project.activate_project_tab"
    or capability == "project.create_subproject"
    or capability == "project.insert_subproject_item"
    or capability == "project.render_or_update_subproject"
  local d13_item_take_batch_capability = capability == "items.set_item_take_controls_batch"
  local phase_may_mutate = true
  if resume_continuation then
    phase_may_mutate = resume_continuation.next_phase_may_mutate == true
  end
  -- D30 project-switch and subproject-item first ticks are preflight/zero-write;
  -- mutation phases are entered only through an exact-project continuation.
  if project_switch_capability and not resume_continuation then
    phase_may_mutate = false
  end
  -- D13 freezes and resolves its complete 1-64 row plan on the first tick.
  -- Mutation starts only after that zero-write preflight yields a continuation.
  if d13_item_take_batch_capability and not resume_continuation then
    phase_may_mutate = false
  end
  -- activate_project_tab selection is a pure tab-focus change. Real REAPER
  -- Undo_EndBlock2(..., -1) on the prior project increments IsProjectDirty even
  -- when no content changed. Selection-only therefore uses internal no-content
  -- Undo (skip_undo) strictly for this capability's mutate_select phase. Create /
  -- open / subproject content mutations keep exact-project required Undo.
  local selection_only_no_content_undo = capability == "project.activate_project_tab"
    and phase_may_mutate == true
    and resume_continuation ~= nil
    and resume_continuation.phase == "activate_project_tab.mutate_select"
  local exact_undo_project = nil
  if resume_continuation and is_object(resume_continuation.state) then
    exact_undo_project = resume_continuation.state.undo_project
  end
  if phase_may_mutate and project_switch_capability and exact_undo_project == nil and not selection_only_no_content_undo then
    return bridge_error_envelope(request, "COMMAND_FAILED", "Required exact project Undo target is missing before mutation.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "required_undo_exact_project_missing",
        zero_write = true,
      },
    })
  end
  -- InsertTrackAtIndex targets the active project rather than an explicit
  -- project pointer. Revalidate the retained parent before opening Undo so a
  -- cross-tick tab change cannot write to a foreign project or dirty the
  -- intended parent through an otherwise empty Undo pair.
  local insert_state = resume_continuation and resume_continuation.state or nil
  if capability == "project.insert_subproject_item"
      and phase_may_mutate
      and is_object(insert_state)
      and insert_state.create_default_track == true then
    local ok_active, active_project = call_reaper("EnumProjects", -1, "")
    if not ok_active or not active_project or active_project ~= exact_undo_project then
      return bridge_error_envelope(request, "VERIFY_FAILED", "Active project changed before the default target Track could be created.", {
        recoverable = false,
        started_at = started_at,
        details = {
          blocker = "active_parent_changed_before_default_track_create",
          zero_write = true,
        },
      })
    end
  end
  -- E3 media write path/budget preflight must terminate before any Undo open
  -- or REAPER mutation. Pure validation only (no EnumProjects / Undo_*).
  local e3_media_write_capability = capability == "media.import_file_to_track"
    or capability == "media.import_file_section_to_track"
    or capability == "media.import_files_batch"
    or capability == "media.relink_take_source"
  local e3_media_batch_capability = capability == "media.import_files_batch"
  if e3_media_write_capability and phase_may_mutate then
    local preflight_ok, preflight_result
    if e3_media_batch_capability then
      preflight_ok, preflight_result = OPENREAPER_HANDLER_EXPORTS.import_files_batch(request, true)
    else
      preflight_ok, preflight_result = READ_B_MEDIA.preflight_mutation_write(request)
    end
    if preflight_ok ~= true then
      local failure = preflight_result or {
        code = "PARAMS_INVALID",
        message = "E3 media write preflight failed.",
        recoverable = true,
        details = { zero_write = true },
      }
      return bridge_error_envelope(request, failure.code or "PARAMS_INVALID", failure.message or "E3 media write preflight failed.", {
        recoverable = failure.recoverable ~= false,
        started_at = started_at,
        details = failure.details or { zero_write = true },
      })
    end
  end
  -- D15 source relink shares E3's frozen canonical file identity and budget
  -- helpers, but has its own truthful item/file success shape.
  local d15_source_relink = capability == "items.choose_new_source_file"
  if d15_source_relink and phase_may_mutate then
    request.__openreaper_d15_source_path = nil
    request.__openreaper_d15_item_ref = nil
    request.__openreaper_d15_item_object_ref = nil
    if is_json_array(request.refs) then
      for index = 1, #request.refs do
        local ref = request.refs[index]
        if is_object(ref) and ref.kind == "file" then
          local prefix = "file:path:"
          local identity = is_object(ref.identity) and ref.identity or nil
          if type(ref.ref) ~= "string"
              or ref.ref:sub(1, #prefix) ~= prefix
              or not identity
              or identity.scheme ~= "path"
              or type(identity.value) ~= "string" then
            return bridge_error_envelope(request, "PARAMS_INVALID", "D15 source relink requires a complete canonical File ref.", {
              recoverable = true,
              started_at = started_at,
              details = { blocker = "malformed_file_ref", zero_write = true },
            })
          end
          if ref.ref:sub(#prefix + 1) ~= identity.value then
            return bridge_error_envelope(request, "PARAMS_INVALID", "D15 source relink rejected contradictory File ref identity.", {
              recoverable = true,
              started_at = started_at,
              details = { blocker = "contradictory_file_ref", zero_write = true },
            })
          end
        end
      end
    end
    local path_value, path_reason = READ_B_MEDIA.file_path_from_request_refs_strict(request)
    if not path_value then
      local code = path_reason == "contradictory_file_ref" and "PARAMS_INVALID" or "FILE_NOT_FOUND"
      if path_reason == "relative_path" or path_reason == "empty_path" or path_reason == "nul_char" then
        code = "PARAMS_INVALID"
      end
      return bridge_error_envelope(request, code, "D15 source relink requires one consistent canonical absolute file ref.", {
        recoverable = true,
        started_at = started_at,
        details = { blocker = path_reason or "missing_file_ref", zero_write = true },
      })
    end
    local path, budget_error = READ_B_MEDIA.ensure_identity_inline_budget(request, path_value)
    if not path then
      budget_error.details = budget_error.details or {}
      budget_error.details.zero_write = true
      return bridge_error_envelope(request, budget_error.code, budget_error.message, {
        recoverable = budget_error.recoverable ~= false,
        started_at = started_at,
        details = budget_error.details,
      })
    end
    local item = d15_items_item_from_request_refs(request)
    if not item then
      return bridge_error_envelope(request, "ITEM_NOT_FOUND", "D15 source relink requires a resolvable item ref.", {
        recoverable = true,
        started_at = started_at,
        details = { blocker = "item_not_found", zero_write = true },
      })
    end
    local item_ref = d15_items_item_ref_string(item)
    if not item_ref then
      return bridge_error_envelope(request, "ITEM_NOT_FOUND", "D15 item identity could not be proven without fabrication.", {
        recoverable = true,
        started_at = started_at,
        details = { blocker = "item_identity_unavailable", zero_write = true },
      })
    end
    local item_scheme, item_value = item_ref:match("^item:([^:]+):(.+)$")
    if not item_scheme or not item_value then
      return bridge_error_envelope(request, "ITEM_NOT_FOUND", "D15 item identity could not be encoded truthfully.", {
        recoverable = true,
        started_at = started_at,
        details = { blocker = "item_identity_invalid", zero_write = true },
      })
    end
    local file_ref = "file:path:" .. path
    local summary = {
      item_ref = item_ref,
      file_ref = file_ref,
      preserve_timing = request.params and request.params.preserve_timing == true,
      -- D15 returns native source truth after mutation; preflight with bounded
      -- field prototypes so an undersized response cannot mutate first.
      source_type = string.rep("W", 80),
      source_length_seconds = string.rep("9", 309),
      take_name = string.rep("W", 160),
      capability = capability,
      pack = request.pack.id,
      risk = request.pack.risk,
      readback_status = "passed",
      undo_evidence = "required",
      artifacts_allowed = false,
      truncated = false,
    }
    local refs = json_array({
      { kind = "item", ref = item_ref, identity = { scheme = item_scheme, value = item_value } },
      { kind = "file", ref = file_ref, identity = { scheme = "path", value = path } },
    })
    local fits, required_response_bytes, budget = READ_B_MEDIA.complete_success_envelope_fits(request, summary, refs, {
      undo_opened = true,
      undo_closed = true,
      verification_status = "passed",
    })
    if not fits then
      return bridge_error_envelope(request, "RESPONSE_TOO_LARGE", "D15 complete success envelope cannot fit before mutation.", {
        recoverable = true,
        started_at = started_at,
        details = {
          blocker = "success_envelope_budget_insufficient",
          required_response_bytes = required_response_bytes,
          max_response_bytes = budget.max_response_bytes,
          zero_write = true,
        },
      })
    end
    request.__openreaper_d15_source_path = path
    request.__openreaper_d15_item_ref = item_ref
    request.__openreaper_d15_item_object_ref = refs[1]
  end
  request.__openreaper_undo_phase = {
    skip_undo = (not phase_may_mutate) or selection_only_no_content_undo,
    require_project_identity = d30_write_capability and phase_may_mutate and not selection_only_no_content_undo,
    exact_project = selection_only_no_content_undo and nil or exact_undo_project,
  }
  open_required_undo_block(request, key)
  if phase_may_mutate and d30_write_capability and not selection_only_no_content_undo and request.__openreaper_undo_block_open ~= true then
    request.__openreaper_undo_phase = nil
    return bridge_error_envelope(request, "COMMAND_FAILED", "Required project-targeted Undo block could not be opened before mutation.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "required_undo_project_identity_unavailable",
        zero_write = true,
      },
    })
  end
  -- Every required-Undo mutation must stop before its handler when both
  -- Undo_BeginBlock2 and fallback Undo_BeginBlock failed. Preflight/read-only
  -- phases and the selection-only no-content phase do not require a block.
  if phase_may_mutate
      and not selection_only_no_content_undo
      and required_undo_capability(request, key)
      and is_object(request.undo)
      and request.undo.mode == "required"
      and request.__openreaper_undo_block_open ~= true then
    request.__openreaper_undo_phase = nil
    return bridge_error_envelope(request, "COMMAND_FAILED", "Required Undo block could not be opened before mutation.", {
      recoverable = true,
      started_at = started_at,
      details = {
        blocker = "required_undo_begin_failed",
        zero_write = true,
      },
    })
  end
  if phase_may_mutate == true and ACTIVE_RECIPE_UNDO_TRANSACTION
      and is_object(request.pack) and request.pack.risk ~= "read"
      and recipe_undo_transaction_flag(request) == ACTIVE_RECIPE_UNDO_TRANSACTION.id then
    ACTIVE_RECIPE_UNDO_TRANSACTION.mutation_may_have_happened = true
  end
  local ok, summary, handler_failure, artifacts, jobs, refs = pcall(operation.handler, request, resume_continuation)
  close_required_undo_block(request, key)
  if not ok then
    local mutated = (resume_continuation and resume_continuation.mutations_may_have_happened == true) or (phase_may_mutate and d30_write_capability) or request.__openreaper_undo_required_any == true
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Scoped live bridge handler failed.", {
      recoverable = false,
      started_at = started_at,
      details = unknown_outcome_details(mutated, {
        operation_name = request.operation.name,
        message = bounded_string(summary, 240),
      }),
    })
  end
  if request.__openreaper_undo_close_failed == true and request.__openreaper_undo_required_any == true then
    return bridge_error_envelope(request, "INTERNAL_ERROR", "Required Undo block could not be closed after a mutation phase.", {
      recoverable = false,
      started_at = started_at,
      details = unknown_outcome_details(true, {
        blocker = "required_undo_close_failed",
      }),
    })
  end
  if type(summary) == "table" and summary.contract == BRIDGE_INTERNAL_CONTINUATION_CONTRACT then
    if not is_bridge_internal_continuation(summary) then
      local mutated = (resume_continuation and resume_continuation.mutations_may_have_happened == true) or phase_may_mutate
      return bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge continuation payload is malformed.", {
        recoverable = false,
        started_at = started_at,
        details = unknown_outcome_details(mutated, { reason = "malformed_internal_continuation" }),
      })
    end
    if handler_failure then
      local mutated = summary.mutations_may_have_happened == true
        or (resume_continuation and resume_continuation.mutations_may_have_happened == true)
      return bridge_error_envelope(request, "INTERNAL_ERROR", "Bridge continuation cannot carry a handler failure.", {
        recoverable = false,
        started_at = started_at,
        details = unknown_outcome_details(mutated, { reason = "malformed_internal_continuation" }),
      })
    end
    summary.mutations_may_have_happened = summary.mutations_may_have_happened == true
      or (resume_continuation ~= nil and resume_continuation.mutations_may_have_happened == true)
    summary.started_at = started_at
    return summary
  end
  if handler_failure then
    local mutated =
      (resume_continuation and resume_continuation.mutations_may_have_happened == true)
      or (phase_may_mutate and d30_write_capability)
      or request.__openreaper_undo_required_any == true
    local details = handler_failure.details or {}
    -- A handler can prove that its failure happened during preflight before
    -- content mutation. Opening and closing the required Undo block is not
    -- itself content mutation, so preserve that typed truth.
    local handler_proved_zero_write = details.zero_write == true
    if mutated and not handler_proved_zero_write then
      details.zero_write = false
      if details.outcome == nil then
        details = unknown_outcome_details(true, details)
      end
    end
    return bridge_error_envelope(request, handler_failure.code or "INTERNAL_ERROR", handler_failure.message or "Scoped live bridge handler failed.", {
      recoverable = (mutated and not handler_proved_zero_write) and false or (handler_failure.recoverable ~= false),
      started_at = started_at,
      details = details,
    })
  end
  return bridge_ok_envelope(request, started_at, summary, artifacts, jobs, refs)
end

ALLOWED_OPERATIONS["run_command:template.execute"].handler = (function(original_handler)
return function(request, resume_continuation)
  if request.pack.capability ~= "recipe.read_batch" then
    return original_handler(request, resume_continuation)
  end

  local params = is_object(request.params) and request.params or {}
  local rows = params.rows
  if params.contract ~= "openreaper.recipe_read_batch.v1" or not is_json_array(rows) or #rows < 2 or #rows > 64 then
    return handler_error("PARAMS_INVALID", "Recipe read batch requires 2-64 frozen child requests.", {
      zero_write = true,
      child_count = is_json_array(rows) and #rows or 0,
    })
  end

  local compiled = json_array({})
  local seen_ids = {}
  for index = 1, #rows do
    local child = rows[index]
    local valid, reason = validate_request(child)
    if not valid then
      return handler_error("PARAMS_INVALID", "Recipe read batch child preflight failed.", {
        zero_write = true,
        failed_index = index,
        reason = bounded_string(reason, 240),
      })
    end
    local key = child.operation.family .. ":" .. child.operation.name
    local operation = ALLOWED_OPERATIONS[key]
    if child.pack.capability == "recipe.read_batch"
        or (child.operation.family ~= "query_state" and child.operation.family ~= "artifact_metadata")
        or child.pack.risk ~= "read"
        or child.undo.mode ~= "none"
        or not operation
        or (operation.pack and operation.pack ~= child.pack.id)
        or child.bridge.expected_owner ~= request.bridge.expected_owner
        or child.bridge.expected_generation ~= request.bridge.expected_generation
        or seen_ids[child.id] then
      return handler_error("PARAMS_INVALID", "Recipe read batch rejected a child outside its read-only identity boundary.", {
        zero_write = true,
        failed_index = index,
        child_id = bounded_string(child.id, 120),
      })
    end
    seen_ids[child.id] = true
    compiled[#compiled + 1] = { request = child, operation = operation }
  end

  local results = json_array({})
  for index = 1, #compiled do
    local entry = compiled[index]
    local child = entry.request
    local started_at = now_iso()
    local ok, summary, handler_failure, artifacts, jobs, refs = pcall(entry.operation.handler, child)
    if not ok then
      results[#results + 1] = json.decode(bridge_error_envelope(child, "INTERNAL_ERROR", "Recipe read batch child handler failed.", {
        recoverable = false,
        started_at = started_at,
        details = {
          zero_write = true,
          failed_index = index,
          message = bounded_string(summary, 240),
        },
      }))
    elseif handler_failure then
      local details = handler_failure.details or {}
      details.zero_write = true
      results[#results + 1] = json.decode(bridge_error_envelope(
        child,
        handler_failure.code or "INTERNAL_ERROR",
        handler_failure.message or "Recipe read batch child failed.",
        {
          recoverable = handler_failure.recoverable ~= false,
          started_at = started_at,
          details = details,
        }
      ))
    else
      results[#results + 1] = json.decode(bridge_ok_envelope(child, started_at, summary, artifacts, jobs, refs))
    end
  end

  return {
    contract = "openreaper.recipe_read_batch.v1",
    execution_shape = "single_bridge_request_dependency_safe_read_batch",
    aggregate_readback = true,
    rows = results,
    row_count = #results,
    batch_timings = {
      batch_count = 1,
      readback_count = #results,
      native_readback_count = #results,
      native_mutation_count = 0,
    },
  }
end
end)(ALLOWED_OPERATIONS["run_command:template.execute"].handler)
