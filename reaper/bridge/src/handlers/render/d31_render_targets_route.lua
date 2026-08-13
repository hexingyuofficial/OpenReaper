-- Extracted D31 handler: bounded project render targets.
-- Uses project render settings and an audited native render action; never RenderFileSection.

local D31_MANIFEST_SPEC = {
  template_id = "template.render.render_targets",
  owner_pack = "render",
  scope = "render_targets_manifest",
  schema = "render.targets_manifest.v1",
}
local D31_EVIDENCE_SPEC = {
  template_id = "template.render.render_targets",
  owner_pack = "render",
  scope = "render_targets_evidence",
  schema = "render.targets_evidence.v1",
}
local D31_ACTION_ID = 41824
local D31_MAX_TARGETS = 16
local D31_NUMERIC_KEYS = {
  "RENDER_BOUNDSFLAG",
  "RENDER_STARTPOS",
  "RENDER_ENDPOS",
  "RENDER_SRATE",
  "RENDER_CHANNELS",
  "RENDER_SETTINGS",
  "RENDER_ADDTOPROJ",
  "RENDER_TAILFLAG",
  "RENDER_TAILMS",
  "RENDER_NORMALIZE",
  "RENDER_DITHER",
}
local D31_STRING_KEYS = { "RENDER_FILE", "RENDER_PATTERN", "RENDER_FORMAT", "RENDER_FORMAT2" }

-- RENDER_FORMAT values are base64 strings. Decoding the WAV values gives:
--   ZXZhdxADAA== => 65 76 61 77 10 03 00 (evaw, 16-bit, LargeFiles=2, BWF=0, markers=0, tempo=false)
--   ZXZhdxgDAA== => 65 76 61 77 18 03 00 (evaw, 24-bit, LargeFiles=2, BWF=0, markers=0, tempo=false)
-- OGG encodes vggo + float32 LE quality + mode byte 0 + four zero LE ints + NUL.
-- MP3 values were captured from REAPER 7.71's native LAME 3.100 CBR/q=0 settings.
local D31_WAV_FORMATS = { [16] = "ZXZhdxADAA==", [24] = "ZXZhdxgDAA==" }
local D31_OGG_FORMATS = {
  [0.3] = "dmdnb5qZmT4AAAAAAAAAAAAAAAAAAAAAAAA=",
  [0.5] = "dmdnbwAAAD8AAAAAAAAAAAAAAAAAAAAAAAA=",
  [0.6] = "dmdnb5qZGT8AAAAAAAAAAAAAAAAAAAAAAAA=",
  [0.8] = "dmdnb83MTD8AAAAAAAAAAAAAAAAAAAAAAAA=",
  [1.0] = "dmdnbwAAgD8AAAAAAAAAAAAAAAAAAAAAAAA=",
}
local D31_MP3_FORMATS = {
  [128] = "bDNwbYAAAAAAAAAAAAAAAP////8EAAAAgAAAAAAAAAA=",
  [192] = "bDNwbcAAAAAAAAAAAAAAAP////8EAAAAwAAAAAAAAAA=",
  [256] = "bDNwbQABAAAAAAAAAAAAAP////8EAAAAAAEAAAAAAAA=",
  [320] = "bDNwbUABAAAAAAAAAAAAAP////8EAAAAQAEAAAAAAAA=",
}

local D31_ERROR_CODE_MAP = {
  RENDER_SETTINGS_UNAVAILABLE = "INTERNAL_ERROR",
  SELECTION_UNAVAILABLE = "INTERNAL_ERROR",
  SELECTION_SET_FAILED = "INTERNAL_ERROR",
  RENDER_SETTINGS_WRITE_FAILED = "INTERNAL_ERROR",
  TARGET_REFS_REQUIRED = "REF_INVALID",
  TARGET_REFS_FORBIDDEN = "REF_INVALID",
  REGION_REF_INVALID = "REF_INVALID",
  REGION_RESOLUTION_FAILED = "INTERNAL_ERROR",
  REGION_REF_AMBIGUOUS = "REF_INVALID",
  WAV_BIT_DEPTH_REQUIRED = "PARAMS_INVALID",
  OGG_QUALITY_REQUIRED = "PARAMS_INVALID",
  MP3_BITRATE_REQUIRED = "PARAMS_INVALID",
  FORMAT_INVALID = "PARAMS_INVALID",
  TIME_SELECTION_EMPTY = "PARAMS_INVALID",
  TARGET_REFS_DUPLICATE = "REF_INVALID",
  SELECTED_ITEMS_REQUIRED = "REF_INVALID",
  SELECTED_TRACKS_REQUIRED = "REF_INVALID",
  TARGET_KIND_INVALID = "PARAMS_INVALID",
  MAX_TARGETS_INVALID = "PARAMS_INVALID",
  TARGET_COUNT_EXCEEDED = "PARAMS_INVALID",
  OUTPUT_BASENAME_INVALID = "PARAMS_INVALID",
  RENDER_OUTPUT_ALL_ZERO = "VERIFY_FAILED",
  RESTORE_FAILED = "VERIFY_FAILED",
}

local function d31_error(code, message, details, recoverable)
  local mapped = D31_ERROR_CODE_MAP[code] or code
  local bounded_details = details or {}
  if mapped ~= code then bounded_details.local_code = code end
  return nil, { code = mapped, message = message, recoverable = recoverable ~= false, details = bounded_details }
end

local function d31_project()
  local ok, project = call_reaper("EnumProjects", -1, "")
  return ok and (project or 0) or 0
end

local function d31_project_name()
  local ok, _, path_value = call_reaper("EnumProjects", -1, "")
  local value = ok and first_string(path_value) or ""
  value = (value or ""):match("([^/\\]+)$") or value or ""
  value = value:gsub("%.[Rr][Pp][Pp]$", "")
  return value ~= "" and value or "current_project"
end

local function d31_safe_name(value, fallback)
  local text = tostring(value or ""):gsub("[%z\r\n]", ""):gsub("[^A-Za-z0-9_%-]", "_")
  text = text:gsub("_+", "_"):gsub("^_+", ""):gsub("_+$", "")
  if text == "" then text = fallback or "target" end
  return text:sub(1, 64)
end

local function d31_output_basename(value)
  if value == nil then return nil end
  if type(value) ~= "string" or value == "" or #value > 96 or value == "." or value == ".." then
    return nil, "output_basename must be a safe 1-96 byte filename stem."
  end
  if value ~= value:match("^%s*(.-)%s*$") or value:find("[<>:\"/\\|%?%*%$]") or value:find("[%z\1-\31\127]") or value:find("[%. ]$") then
    return nil, "output_basename contains a path, wildcard, reserved, control, or unsafe trailing character."
  end
  local lower = value:lower()
  if lower:match("%.wav$") or lower:match("%.ogg$") or lower:match("%.mp3$") then
    return nil, "output_basename is a filename stem and must not include the output extension."
  end
  return value
end

local function d31_root_ready()
  if not RENDER_ROOT then return false, "render_root_not_configured", "D31 managed render root is not configured." end
  if RENDER_ROOT:sub(1, 7) == "file://" or not is_absolute_path(RENDER_ROOT) then
    return false, "render_root_invalid", "D31 managed render root must be an absolute filesystem path."
  end
  return true
end

local function d31_size(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then return 0 end
  local size = handle:seek("end") or 0
  handle:close()
  return size
end

local function d31_mp3_probe(header)
  local offset = 1
  if header:sub(1, 3) == "ID3" then
    if #header < 10 then return false end
    local a, b, c, d = header:byte(7, 10)
    if not a or a >= 128 or b >= 128 or c >= 128 or d >= 128 then return false end
    offset = 11 + a * 2097152 + b * 16384 + c * 128 + d
  end
  for index = offset, math.max(offset, #header - 3) do
    local first, second, third = header:byte(index, index + 2)
    if first == 0xFF and second and second >= 0xE0 and third then
      local version_bits = math.floor(second / 8) % 4
      local layer_bits = math.floor(second / 2) % 4
      local bitrate_index = math.floor(third / 16) % 16
      local sample_rate_index = math.floor(third / 4) % 4
      if version_bits ~= 1 and layer_bits == 1 and bitrate_index > 0 and bitrate_index < 15 and sample_rate_index < 3 then
        local mpeg1 = { 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320 }
        local mpeg2 = { 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160 }
        return true, version_bits == 3 and mpeg1[bitrate_index] or mpeg2[bitrate_index]
      end
    end
  end
  return false
end

local function d31_probe_output(path_value, extension)
  local handle = io.open(path_value, "rb")
  if not handle then return false end
  local header = handle:read(1048576) or ""
  handle:close()
  if extension == "wav" then return #header >= 12 and header:sub(1, 4) == "RIFF" and header:sub(9, 12) == "WAVE", "wav" end
  if extension == "ogg" then return #header >= 4 and header:sub(1, 4) == "OggS", "ogg" end
  if extension == "mp3" then
    local ok, bitrate = d31_mp3_probe(header)
    return ok, ok and "mp3" or nil, bitrate
  end
  return false
end

local function d31_u16(bytes, offset)
  local low, high = bytes:byte(offset, offset + 1)
  if not low or not high then return nil end
  return low + (high * 256)
end

local function d31_u32(bytes, offset)
  local a, b, c, d = bytes:byte(offset, offset + 3)
  if not a or not b or not c or not d then return nil end
  return a + (b * 256) + (c * 65536) + (d * 16777216)
end

local function d31_linear_db(value)
  if type(value) ~= "number" or value <= 0 then return -150 end
  return 20 * math.log(value) / math.log(10)
end

local function d31_pcm_sample(bytes, offset, bits)
  local b1, b2, b3, b4 = bytes:byte(offset, offset + 3)
  if not b1 then return nil end
  if bits == 8 then return (b1 - 128) / 128 end
  if bits == 16 then
    if not b2 then return nil end
    local value = b1 + (b2 * 256)
    if value >= 32768 then value = value - 65536 end
    return value / 32768
  end
  if bits == 24 then
    if not b2 or not b3 then return nil end
    local value = b1 + (b2 * 256) + (b3 * 65536)
    if value >= 8388608 then value = value - 16777216 end
    return value / 8388608
  end
  if bits == 32 then
    if not b2 or not b3 or not b4 then return nil end
    local value = b1 + (b2 * 256) + (b3 * 65536) + (b4 * 16777216)
    if value >= 2147483648 then value = value - 4294967296 end
    return value / 2147483648
  end
  return nil
end

-- D31 needs exact RMS, which the stock PCM peak API does not expose. For the
-- lossless WAV path, read the rendered PCM bytes in bounded blocks so the
-- result cannot infer audible content from file size alone.
local function d31_measure_wav_pcm(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Could not open the rendered WAV for PCM measurement." } end
  local header = handle:read(12) or ""
  if #header < 12 or header:sub(1, 4) ~= "RIFF" or header:sub(9, 12) ~= "WAVE" then
    handle:close()
    return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered output is not a RIFF/WAVE file." }
  end

  local fmt_bytes = nil
  local data_position = nil
  local data_size = nil
  while true do
    local chunk_header = handle:read(8) or ""
    if #chunk_header == 0 then break end
    if #chunk_header < 8 then
      handle:close()
      return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV contains a truncated chunk header." }
    end
    local chunk_id = chunk_header:sub(1, 4)
    local chunk_size = d31_u32(chunk_header, 5)
    if not chunk_size then
      handle:close()
      return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV contains an invalid chunk size." }
    end
    local chunk_position = handle:seek()
    if not chunk_position then
      handle:close()
      return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Could not seek while parsing rendered WAV chunks." }
    end
    if chunk_id == "fmt " and chunk_size >= 16 and not fmt_bytes then
      fmt_bytes = handle:read(math.min(chunk_size, 64)) or ""
    elseif chunk_id == "data" and not data_position then
      data_position = chunk_position
      data_size = chunk_size
    end
    local next_position = chunk_position + chunk_size + (chunk_size % 2)
    if not handle:seek("set", next_position) then
      handle:close()
      return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Could not seek to the next rendered WAV chunk." }
    end
  end

  local format_code = fmt_bytes and d31_u16(fmt_bytes, 1) or nil
  local channel_count = fmt_bytes and d31_u16(fmt_bytes, 3) or nil
  local sample_rate_hz = fmt_bytes and d31_u32(fmt_bytes, 5) or nil
  local bits = fmt_bytes and d31_u16(fmt_bytes, 15) or nil
  if format_code ~= 1 or not channel_count or channel_count < 1 or channel_count > 64 or not sample_rate_hz or sample_rate_hz < 1 or not bits or not ({ [8] = true, [16] = true, [24] = true, [32] = true })[bits] or not data_position or not data_size then
    handle:close()
    return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV is not a supported integer PCM stream." }
  end
  local bytes_per_sample = bits / 8
  local frame_bytes = channel_count * bytes_per_sample
  if frame_bytes < 1 or data_size < frame_bytes or data_size % frame_bytes ~= 0 then
    handle:close()
    return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV data does not contain complete PCM frames." }
  end

  local frame_count = math.floor(data_size / frame_bytes)
  local sample_count = frame_count * channel_count
  local remaining_frames = frame_count
  local frame_offset = 0
  local peak_linear = 0
  local sum_squares = 0
  if not handle:seek("set", data_position) then
    handle:close()
    return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Could not seek to rendered WAV PCM data." }
  end
  while remaining_frames > 0 do
    local block_frames = math.min(8192, remaining_frames)
    local block = handle:read(block_frames * frame_bytes) or ""
    if #block ~= block_frames * frame_bytes then
      handle:close()
      return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV PCM data ended before the declared frame count." }
    end
    for frame = 0, block_frames - 1 do
      for channel = 0, channel_count - 1 do
        local sample_offset = (frame * frame_bytes) + (channel * bytes_per_sample) + 1
        local sample = d31_pcm_sample(block, sample_offset, bits)
        if sample == nil then
          handle:close()
          return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered WAV PCM sample decoding failed." }
        end
        local absolute = math.abs(sample)
        if absolute > peak_linear then peak_linear = absolute end
        sum_squares = sum_squares + (sample * sample)
      end
    end
    frame_offset = frame_offset + block_frames
    remaining_frames = remaining_frames - block_frames
  end
  handle:close()

  local rms_linear = math.sqrt(sum_squares / sample_count)
  local all_zero = peak_linear == 0
  return {
    measurement_status = "measured",
    measurement_scope = "rendered_file_pcm",
    measurement_format = "wav_pcm",
    sample_rate_hz = sample_rate_hz,
    channel_count = channel_count,
    frame_count = frame_count,
    sample_count = sample_count,
    peak_linear = peak_linear,
    peak_dbfs = d31_linear_db(peak_linear),
    rms_linear = rms_linear,
    rms_dbfs = d31_linear_db(rms_linear),
    silence_classification = all_zero and "all_zero" or "non_silent",
    is_silent = all_zero,
  }
end

local function d31_measure_native_peaks(path_value, extension)
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", path_value)
  if not ok_source or not source then
    return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "REAPER could not decode the rendered output for native peak measurement." }
  end
  local function finish(result, failure)
    local destroyed = call_reaper("PCM_Source_Destroy", source)
    if not destroyed then return nil, { code = "MEASUREMENT_UNAVAILABLE", message = "REAPER could not release the rendered-output measurement source." } end
    return result, failure
  end
  local ok_length, raw_length, length_is_qn = call_reaper("GetMediaSourceLength", source)
  local ok_rate, raw_rate = call_reaper("GetMediaSourceSampleRate", source)
  local ok_channels, raw_channels = call_reaper("GetMediaSourceNumChannels", source)
  local length_seconds = ok_length and first_number(raw_length) or nil
  local sample_rate = ok_rate and first_number(raw_rate) or nil
  local channels = ok_channels and first_number(raw_channels) or nil
  if length_is_qn == true or type(length_seconds) ~= "number" or length_seconds <= 0
      or type(sample_rate) ~= "number" or sample_rate <= 0
      or type(channels) ~= "number" or channels < 1 or channels > 64 then
    return finish(nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered output reported invalid native duration, sample-rate, or channel metadata." })
  end
  channels = math.floor(channels)
  local peak_rate = math.min(sample_rate, 1000)
  local total_frames = math.max(1, math.ceil(length_seconds * peak_rate))
  local frame_offset = 0
  local peak_linear = 0
  while frame_offset < total_frames do
    local requested_frames = math.min(8192, total_frames - frame_offset)
    local ok_buffer, buffer = call_reaper("new_array", requested_frames * channels * 2)
    if not ok_buffer or not buffer then return finish(nil, { code = "MEASUREMENT_UNAVAILABLE", message = "REAPER could not allocate a rendered-output peak buffer." }) end
    local ok_peaks, raw_return = call_reaper("PCM_Source_GetPeaks", source, peak_rate, frame_offset / peak_rate, channels, requested_frames, 0, buffer)
    local return_value = ok_peaks and first_number(raw_return) or nil
    local returned_frames = type(return_value) == "number" and math.floor(return_value) % 1048576 or -1
    if returned_frames < 1 or returned_frames > requested_frames then return finish(nil, { code = "MEASUREMENT_UNAVAILABLE", message = "REAPER returned an invalid rendered-output peak frame count." }) end
    local values = nil
    if type(buffer.table) == "function" then
      local table_ok, table_values = pcall(function() return buffer.table() end)
      if table_ok and type(table_values) == "table" then values = table_values end
    end
    if not values then return finish(nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered-output peak data was not readable." }) end
    local block_values = returned_frames * channels
    for value_index = 1, block_values * 2 do
      local value = tonumber(values[value_index])
      if value == nil then return finish(nil, { code = "MEASUREMENT_UNAVAILABLE", message = "Rendered-output peak data contained an invalid sample." }) end
      local absolute = math.abs(value)
      if absolute > peak_linear then peak_linear = absolute end
    end
    frame_offset = frame_offset + returned_frames
  end
  local all_zero = peak_linear == 0
  return finish({
    measurement_status = "measured",
    measurement_scope = "rendered_file_native_peaks",
    measurement_format = extension .. "_native_peaks",
    sample_rate_hz = sample_rate,
    channel_count = channels,
    frame_count = total_frames,
    sample_count = JSON_NULL,
    peak_linear = peak_linear,
    peak_dbfs = d31_linear_db(peak_linear),
    rms_linear = JSON_NULL,
    rms_dbfs = JSON_NULL,
    silence_classification = all_zero and "all_zero" or "non_silent",
    is_silent = all_zero,
  })
end

local function d31_measure_output(path_value, extension)
  if extension == "wav" then return d31_measure_wav_pcm(path_value) end
  return d31_measure_native_peaks(path_value, extension)
end

local function d31_get_number(project, key)
  local ok, value = call_reaper("GetSetProjectInfo", project, key, 0, false)
  return ok and type(value) == "number" and value or nil
end

local function d31_get_string(project, key)
  local ok, _, value = call_reaper("GetSetProjectInfo_String", project, key, "", false)
  return ok and type(value) == "string" and value or nil
end

local function d31_set_number(project, key, value)
  local ok, success = call_reaper("GetSetProjectInfo", project, key, value, true)
  return ok and success ~= false
end

local function d31_set_string(project, key, value)
  local ok, success = call_reaper("GetSetProjectInfo_String", project, key, value, true)
  return ok and success ~= false
end

local function d31_snapshot_settings(project)
  local snapshot = { numeric = {}, strings = {} }
  for index = 1, #D31_NUMERIC_KEYS do
    local key = D31_NUMERIC_KEYS[index]
    local value = d31_get_number(project, key)
    if value == nil then return d31_error("RENDER_SETTINGS_UNAVAILABLE", "Could not snapshot a required REAPER numeric render setting.", { key = key }, false) end
    snapshot.numeric[key] = value
  end
  for index = 1, #D31_STRING_KEYS do
    local key = D31_STRING_KEYS[index]
    local value = d31_get_string(project, key)
    if value == nil then return d31_error("RENDER_SETTINGS_UNAVAILABLE", "Could not snapshot a required REAPER string render setting.", { key = key }, false) end
    snapshot.strings[key] = value
  end
  return snapshot
end

local function d31_restore_settings(project, snapshot)
  local failed = json_array({})
  for index = 1, #D31_NUMERIC_KEYS do
    local key = D31_NUMERIC_KEYS[index]
    if not d31_set_number(project, key, snapshot.numeric[key]) then failed[#failed + 1] = key end
  end
  for index = 1, #D31_STRING_KEYS do
    local key = D31_STRING_KEYS[index]
    if not d31_set_string(project, key, snapshot.strings[key]) then failed[#failed + 1] = key end
  end
  return #failed == 0, failed
end

local function d31_selected_tracks(project)
  local ok_count, count = call_reaper("CountSelectedTracks2", project, false)
  if not ok_count or type(count) ~= "number" then return d31_error("SELECTION_UNAVAILABLE", "Could not snapshot selected tracks before rendering.", {}, false) end
  local selected = json_array({})
  for index = 0, math.floor(count) - 1 do
    local ok_track, track = call_reaper("GetSelectedTrack2", project, index, false)
    if not ok_track or not track then return d31_error("SELECTION_UNAVAILABLE", "Could not read a selected track before rendering.", { index = index }, false) end
    selected[#selected + 1] = track
  end
  return selected
end

local function d31_selected_items(project)
  local ok_count, count = call_reaper("CountSelectedMediaItems", project)
  if not ok_count or type(count) ~= "number" then return d31_error("SELECTION_UNAVAILABLE", "Could not snapshot selected items before rendering.", {}, false) end
  local selected = json_array({})
  for index = 0, math.floor(count) - 1 do
    local ok_item, item = call_reaper("GetSelectedMediaItem", project, index)
    if not ok_item or not item then return d31_error("SELECTION_UNAVAILABLE", "Could not read a selected item before rendering.", { index = index }, false) end
    selected[#selected + 1] = item
  end
  return selected
end

local function d31_apply_track_selection(project, selected)
  local ok_count, count = call_reaper("CountTracks", project)
  if not ok_count or type(count) ~= "number" then return false end
  for index = 0, math.floor(count) - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    if not ok_track or not track or not call_reaper("SetTrackSelected", track, false) then return false end
  end
  for index = 1, #selected do if not call_reaper("SetTrackSelected", selected[index], true) then return false end end
  return true
end

local function d31_apply_item_selection(project, selected)
  local ok_count, count = call_reaper("CountMediaItems", project)
  if not ok_count or type(count) ~= "number" then return false end
  for index = 0, math.floor(count) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, index)
    if not ok_item or not item or not call_reaper("SetMediaItemSelected", item, false) then return false end
  end
  for index = 1, #selected do if not call_reaper("SetMediaItemSelected", selected[index], true) then return false end end
  return true
end

local function d31_refs(request)
  local groups = { region = json_array({}), item = json_array({}), track = json_array({}) }
  if not is_json_array(request.refs) then return d31_error("PARAMS_INVALID", "D31 render targets requires normalized object refs.", {}, false) end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if not is_object(ref) or not is_string(ref.kind) or not is_string(ref.ref) then return d31_error("PARAMS_INVALID", "D31 render targets received an invalid object ref.", { index = index - 1 }, false) end
    if not groups[ref.kind] then return d31_error("PARAMS_INVALID", "D31 rejects refs outside region_refs, item_refs, and track_refs.", { ref_kind = ref.kind }, false) end
    groups[ref.kind][#groups[ref.kind] + 1] = ref
  end
  return groups
end

local function d31_validate_refs(kind, groups)
  local expected = { regions = "region", explicit_items = "item", explicit_tracks = "track" }
  local need = expected[kind]
  local counts = { region = #groups.region, item = #groups.item, track = #groups.track }
  if need then
    if counts[need] < 1 then return d31_error("TARGET_REFS_REQUIRED", "The selected target_kind requires matching refs.", { target_kind = kind, required_ref_kind = need }) end
    for ref_kind, count in pairs(counts) do
      if ref_kind ~= need and count > 0 then return d31_error("TARGET_REFS_FORBIDDEN", "The selected target_kind rejects refs of other kinds.", { target_kind = kind, unexpected_ref_kind = ref_kind }, false) end
    end
  elseif counts.region > 0 or counts.item > 0 or counts.track > 0 then
    return d31_error("TARGET_REFS_FORBIDDEN", "The selected target_kind does not accept explicit refs.", { target_kind = kind, region_ref_count = counts.region, item_ref_count = counts.item, track_ref_count = counts.track }, false)
  end
  return true
end

local function d31_regions(project)
  local ok_count, _, marker_count, region_count = call_reaper("CountProjectMarkers", project)
  if not ok_count then return nil end
  local rows = json_array({})
  local total = math.max(0, math.floor((first_number(marker_count) or 0) + (first_number(region_count) or 0)))
  for index = 0, total - 1 do
    local ok, retval, is_region, start_pos, end_pos, name, region_index = call_reaper("EnumProjectMarkers3", project, index)
    if ok and retval and is_region == true then
      rows[#rows + 1] = { index = math.floor(first_number(region_index) or index), start_seconds = first_number(start_pos) or 0, end_seconds = first_number(end_pos) or 0, name = first_string(name) or "" }
    end
  end
  return rows
end

local function d31_region(project, raw)
  local index_token = raw:match("^region:index:(%-?%d+)$") or raw:match("^index:(%-?%d+)$")
  local name_token = raw:match("^region:name:(.+)$")
  if not index_token and not name_token then return d31_error("REGION_REF_INVALID", "Explicit region refs must use region:index:<id> or region:name:<name>.", { region_ref = bounded_string(raw, 160) }, false) end
  local rows = d31_regions(project)
  if not rows then return d31_error("REGION_RESOLUTION_FAILED", "Could not enumerate project regions for D31 rendering.", {}, false) end
  local matched = nil
  for index = 1, #rows do
    local row = rows[index]
    if (index_token and row.index == tonumber(index_token)) or (name_token and row.name == name_token) then
      if matched then return d31_error("REGION_REF_AMBIGUOUS", "D31 region:name refs must resolve exactly once.", { region_ref = bounded_string(raw, 160) }, false) end
      matched = row
    end
  end
  if not matched or matched.end_seconds <= matched.start_seconds then return d31_error("REGION_NOT_FOUND", "D31 region ref did not resolve to a non-empty project region.", { region_ref = bounded_string(raw, 160) }, false) end
  matched.ref = "region:index:" .. tostring(matched.index)
  return matched
end

local function d31_item_guid(item)
  local ok, _, guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  return ok and first_string(guid) or nil
end

local function d31_item_ref(item, fallback)
  local guid = d31_item_guid(item)
  return guid and guid ~= "" and ("item:guid:" .. guid) or ("item:index:" .. tostring(fallback or 0))
end

local function d31_item(project, raw)
  local guid = raw:match("^item:guid:(.+)$") or raw:match("^guid:(.+)$")
  local index_token = raw:match("^item:index:(%d+)$") or raw:match("^index:(%d+)$")
  if index_token then
    local ok, item = call_reaper("GetMediaItem", project, tonumber(index_token))
    return ok and item or nil, tonumber(index_token)
  end
  if not guid then return nil end
  local ok_count, count = call_reaper("CountMediaItems", project)
  if not ok_count then return nil end
  for index = 0, math.floor(count) - 1 do
    local ok, item = call_reaper("GetMediaItem", project, index)
    if ok and item and d31_item_guid(item) == guid then return item, index end
  end
  return nil
end

local function d31_item_name(item, fallback)
  local ok_take, take = call_reaper("GetActiveTake", item)
  if ok_take and take then
    local ok_name, name = call_reaper("GetTakeName", take)
    if ok_name and is_string(name) and name ~= "" then return name end
  end
  return fallback
end

local function d31_track_ref(track, fallback)
  local ok, guid = call_reaper("GetTrackGUID", track)
  return ok and is_string(guid) and guid ~= "" and ("track:guid:" .. guid) or ("track:index:" .. tostring(fallback or 0))
end

local function d31_track(project, raw)
  local guid = raw:match("^track:guid:(.+)$") or raw:match("^guid:(.+)$")
  local index_token = raw:match("^track:index:(%d+)$") or raw:match("^index:(%d+)$")
  if index_token then
    local ok, track = call_reaper("GetTrack", project, tonumber(index_token))
    return ok and track or nil, tonumber(index_token)
  end
  if not guid then return nil end
  local ok_count, count = call_reaper("CountTracks", project)
  if not ok_count then return nil end
  for index = 0, math.floor(count) - 1 do
    local ok, track = call_reaper("GetTrack", project, index)
    if ok and track then
      local guid_ok, candidate = call_reaper("GetTrackGUID", track)
      if guid_ok and candidate == guid then return track, index end
    end
  end
  return nil
end

local function d31_track_name(track, fallback)
  local ok, _, name = call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", "", false)
  return ok and is_string(name) and name ~= "" and name or fallback
end

local function d31_format(params)
  if params.format == "wav" then
    local depth = tonumber(params.wav_bit_depth)
    local config = D31_WAV_FORMATS[depth]
    if not config then return d31_error("WAV_BIT_DEPTH_REQUIRED", "WAV renders require wav_bit_depth 16 or 24.", { wav_bit_depth = params.wav_bit_depth }, false) end
    return { extension = "wav", config = config, wav_bit_depth = depth }
  end
  if params.format == "ogg" then
    local quality = tonumber(params.ogg_quality)
    local config = D31_OGG_FORMATS[quality]
    if not config then return d31_error("OGG_QUALITY_REQUIRED", "OGG renders require an allowed ogg_quality.", { ogg_quality = params.ogg_quality }, false) end
    return { extension = "ogg", config = config, ogg_quality = quality }
  end
  if params.format == "mp3" then
    local bitrate = tonumber(params.mp3_bitrate_kbps)
    local config = D31_MP3_FORMATS[bitrate]
    if not config then return d31_error("MP3_BITRATE_REQUIRED", "MP3 renders require mp3_bitrate_kbps 128, 192, 256, or 320.", { mp3_bitrate_kbps = params.mp3_bitrate_kbps }, false) end
    return { extension = "mp3", config = config, mp3_bitrate_kbps = bitrate }
  end
  return d31_error("FORMAT_INVALID", "D31 supports only wav, ogg, and mp3.", { format = params.format }, false)
end

local function d31_resolve_targets(project, request, groups)
  local targets = json_array({})
  local kind = request.params.target_kind
  if kind == "whole_project" then
    targets[#targets + 1] = { source = 0, bounds = 1, source_name = d31_project_name(), label = "whole_project" }
  elseif kind == "time_selection" then
    local ok, start_pos, end_pos = call_reaper("GetSet_LoopTimeRange", false, false, 0, 0, false)
    if not ok or type(start_pos) ~= "number" or type(end_pos) ~= "number" or end_pos <= start_pos then return d31_error("TIME_SELECTION_EMPTY", "time_selection requires a non-empty time selection.", {}) end
    targets[#targets + 1] = { source = 0, bounds = 2, source_name = d31_project_name(), label = "time_selection" }
  elseif kind == "regions" then
    local seen = {}
    for index = 1, #groups.region do
      local region, err = d31_region(project, groups.region[index].ref)
      if not region then return nil, err end
      if seen[region.index] then return d31_error("TARGET_REFS_DUPLICATE", "regions rejects duplicate region refs.", { region_ref = region.ref }, false) end
      seen[region.index] = true
      targets[#targets + 1] = { source = 0, bounds = 0, start_seconds = region.start_seconds, end_seconds = region.end_seconds, source_name = region.name ~= "" and region.name or ("region_" .. tostring(region.index)), label = "region_" .. tostring(region.index), ref = region.ref }
    end
  elseif kind == "selected_items" then
    local selected, err = d31_selected_items(project)
    if not selected then return nil, err end
    if #selected == 0 then return d31_error("SELECTED_ITEMS_REQUIRED", "selected_items requires at least one selected item.", {}) end
    for index = 1, #selected do
      local item = selected[index]
      targets[#targets + 1] = { source = 32, bounds = 4, item = item, source_name = d31_item_name(item, "item_" .. tostring(index)), label = d31_item_ref(item, index - 1), ref = d31_item_ref(item, index - 1) }
    end
  elseif kind == "explicit_items" then
    local seen = {}
    for index = 1, #groups.item do
      local item, item_index = d31_item(project, groups.item[index].ref)
      if not item then return d31_error("ITEM_NOT_FOUND", "Explicit item ref could not be resolved.", { item_ref = bounded_string(groups.item[index].ref, 160) }, false) end
      if seen[item] then return d31_error("TARGET_REFS_DUPLICATE", "explicit_items rejects duplicate item refs.", { item_ref = bounded_string(groups.item[index].ref, 160) }, false) end
      seen[item] = true
      targets[#targets + 1] = { source = 32, bounds = 4, item = item, source_name = d31_item_name(item, "item_" .. tostring(index)), label = d31_item_ref(item, item_index or index - 1), ref = d31_item_ref(item, item_index or index - 1) }
    end
  elseif kind == "selected_tracks" then
    local selected, err = d31_selected_tracks(project)
    if not selected then return nil, err end
    if #selected == 0 then return d31_error("SELECTED_TRACKS_REQUIRED", "selected_tracks requires at least one selected track.", {}) end
    for index = 1, #selected do
      local track = selected[index]
      targets[#targets + 1] = { source = 3, bounds = 1, track = track, source_name = d31_track_name(track, "track_" .. tostring(index)), label = d31_track_ref(track, index - 1), ref = d31_track_ref(track, index - 1) }
    end
  elseif kind == "explicit_tracks" then
    local seen = {}
    for index = 1, #groups.track do
      local track, track_index = d31_track(project, groups.track[index].ref)
      if not track then return d31_error("TRACK_NOT_FOUND", "Explicit track ref could not be resolved.", { track_ref = bounded_string(groups.track[index].ref, 160) }, false) end
      if seen[track] then return d31_error("TARGET_REFS_DUPLICATE", "explicit_tracks rejects duplicate track refs.", { track_ref = bounded_string(groups.track[index].ref, 160) }, false) end
      seen[track] = true
      targets[#targets + 1] = { source = 3, bounds = 1, track = track, source_name = d31_track_name(track, "track_" .. tostring(index)), label = d31_track_ref(track, track_index or index - 1), ref = d31_track_ref(track, track_index or index - 1) }
    end
  else
    return d31_error("TARGET_KIND_INVALID", "Unsupported D31 target_kind.", { target_kind = kind }, false)
  end
  return targets
end

local function d31_plan_outputs(request, targets, extension, requested_basename)
  local suffix = d31_safe_name(request.idempotency_key or request.id or "request", "request"):sub(1, 48)
  local project_name = d31_safe_name(d31_project_name(), "current_project")
  local outputs = json_array({})
  for index = 1, #targets do
    local target = targets[index]
    local basename = requested_basename or (project_name .. "_" .. d31_safe_name(target.source_name, "target") .. "_" .. d31_safe_name(target.label, "target") .. "_" .. suffix)
    if #targets > 1 then basename = basename .. "_" .. string.format("%02d", index) end
    basename = basename:sub(1, 180)
    outputs[#outputs + 1] = { source_name = bounded_string(target.source_name, 160), output_basename = basename, absolute_path = path_join(RENDER_ROOT, basename .. "." .. extension), extension = extension, target = target }
  end
  return outputs
end

local function d31_preflight(request, outputs)
  local ready, blocker, message = d31_root_ready()
  if not ready then return d31_error("FILE_NOT_FOUND", message, { blocker = blocker, render_root_env = RENDER_ROOT_ENV }, false) end
  local artifact_ready, artifact_blocker, artifact_message = a2_artifact_root_ready()
  if not artifact_ready then return d31_error("ARTIFACT_INVALID", artifact_message, { blocker = artifact_blocker, artifact_root_env = ARTIFACT_ROOT_ENV }, false) end
  local dir_ok, dir_error = ensure_directory(RENDER_ROOT)
  if not dir_ok then return d31_error("FILE_NOT_FOUND", "D31 managed render root could not be prepared.", { blocker = "render_root_unavailable", message = bounded_string(dir_error, 160) }, false) end
  for index = 1, #outputs do
    if file_exists(outputs[index].absolute_path) then return d31_error("IDEMPOTENCY_CONFLICT", "fail_if_exists rejected an existing managed output before rendering began.", { blocker = "render_output_exists", output_basename = outputs[index].output_basename }, false) end
    if file_exists(outputs[index].absolute_path .. ".RPP") then return d31_error("IDEMPOTENCY_CONFLICT", "fail_if_exists rejected an existing generated project-copy path before rendering began.", { blocker = "render_project_copy_exists", output_basename = outputs[index].output_basename }, false) end
  end
  for _, spec in ipairs({ D31_MANIFEST_SPEC, D31_EVIDENCE_SPEC }) do
    local ref, ref_error = artifact_ref_for_request(request, spec)
    if not ref then return d31_error("PARAMS_INVALID", ref_error, { field = "id" }, false) end
    local parts, parse_error = parse_artifact_ref(ref)
    if not parts then return d31_error("PARAMS_INVALID", parse_error, { field = "artifact_ref" }, false) end
    local artifact_dir, artifact_file = artifact_path(parts)
    local artifact_dir_ok, artifact_dir_error = ensure_directory(artifact_dir)
    if not artifact_dir_ok then return d31_error("ARTIFACT_INVALID", "D31 evidence artifact directory could not be prepared before rendering.", { blocker = "artifact_directory_unavailable", message = bounded_string(artifact_dir_error, 160) }, false) end
    if file_exists(artifact_file) then return d31_error("IDEMPOTENCY_CONFLICT", "D31 evidence artifact collision would occur after rendering.", { blocker = "artifact_ref_collision", artifact_ref = ref }, false) end
  end
  return true
end

local function d31_apply_settings(project, target, output, params, format)
  if output.output_basename:find("/", 1, true) or output.output_basename:find("\\", 1, true) then return false, "RENDER_PATTERN_PATH_FORBIDDEN" end
  local values = {
    RENDER_BOUNDSFLAG = target.bounds,
    RENDER_STARTPOS = target.start_seconds or 0,
    RENDER_ENDPOS = target.end_seconds or 0,
    RENDER_SRATE = params.sample_rate_hz,
    RENDER_CHANNELS = params.channel_count,
    RENDER_SETTINGS = target.source,
    RENDER_ADDTOPROJ = 0,
    RENDER_TAILFLAG = 0,
    RENDER_TAILMS = 0,
    RENDER_NORMALIZE = 0,
    RENDER_DITHER = 16,
  }
  for index = 1, #D31_NUMERIC_KEYS do
    local key = D31_NUMERIC_KEYS[index]
    if not d31_set_number(project, key, values[key]) then return false, key end
  end
  if not d31_set_string(project, "RENDER_FILE", RENDER_ROOT) then return false, "RENDER_FILE" end
  if not d31_set_string(project, "RENDER_PATTERN", output.output_basename) then return false, "RENDER_PATTERN" end
  if not d31_set_string(project, "RENDER_FORMAT", format.config) then return false, "RENDER_FORMAT" end
  if not d31_set_string(project, "RENDER_FORMAT2", "") then return false, "RENDER_FORMAT2" end
  if d31_get_string(project, "RENDER_FORMAT") ~= format.config then return false, "RENDER_FORMAT_READBACK" end
  if d31_get_string(project, "RENDER_FORMAT2") ~= "" then return false, "RENDER_FORMAT2_READBACK" end
  return true
end

local function d31_job_ref(request)
  local suffix = d31_safe_name(artifact_id_from_request(request) or request.id or "request", "request")
  local job_id = "render.targets." .. suffix
  return { kind = "job", ref = "job:job_id:" .. job_id, identity = { scheme = "job_id", value = job_id }, summary = { template_id = "template.render.render_targets", pack = "render" } }
end

local function d31_finish_render_attempt(project, settings, prior_tracks, prior_items, call_ok, outcome)
  local settings_restored, failed_settings = d31_restore_settings(project, settings)
  local tracks_restored = d31_apply_track_selection(project, prior_tracks)
  local items_restored = d31_apply_item_selection(project, prior_items)
  if not settings_restored or not tracks_restored or not items_restored then
    return d31_error("RESTORE_FAILED", "D31 could not restore pre-render settings or selections.", {
      failed_render_setting_keys = failed_settings,
      track_selection_restored = tracks_restored,
      item_selection_restored = items_restored,
      render_attempt_failed = not call_ok or (is_object(outcome) and outcome.failure ~= nil),
    }, false)
  end
  if not call_ok then
    return d31_error("INTERNAL_ERROR", "D31 render target execution failed unexpectedly after state restoration.", { message = bounded_string(outcome, 240) }, false)
  end
  if outcome.failure then
    return d31_error(outcome.failure.code, outcome.failure.message, outcome.failure.details, outcome.failure.recoverable)
  end
  return outcome
end

local function d31_render_targets(request)
  if request.params.output_policy ~= "openreaper_managed_render_root" then return d31_error("PARAMS_INVALID", "D31 requires openreaper_managed_render_root output_policy.", { field = "output_policy" }, false) end
  if request.params.collision_policy ~= "fail_if_exists" then return d31_error("IDEMPOTENCY_CONFLICT", "D31 currently supports only collision_policy fail_if_exists.", { collision_policy = request.params.collision_policy }, false) end
  local max_targets = tonumber(request.params.max_targets)
  if not max_targets or max_targets ~= math.floor(max_targets) or max_targets < 1 or max_targets > D31_MAX_TARGETS then return d31_error("MAX_TARGETS_INVALID", "max_targets must be an integer from 1 through 16.", { max_targets = request.params.max_targets }, false) end
  local format, format_error = d31_format(request.params)
  if not format then return nil, format_error end
  local requested_basename, basename_error = d31_output_basename(request.params.output_basename)
  if basename_error then return d31_error("OUTPUT_BASENAME_INVALID", basename_error, { field = "output_basename" }, false) end
  local root_ready, root_blocker, root_message = d31_root_ready()
  if not root_ready then return d31_error("FILE_NOT_FOUND", root_message, { blocker = root_blocker, render_root_env = RENDER_ROOT_ENV }, false) end
  local project = d31_project()
  local groups, groups_error = d31_refs(request)
  if not groups then return nil, groups_error end
  local refs_ok, refs_error = d31_validate_refs(request.params.target_kind, groups)
  if not refs_ok then return nil, refs_error end
  local targets, targets_error = d31_resolve_targets(project, request, groups)
  if not targets then return nil, targets_error end
  if #targets < 1 or #targets > max_targets or #targets > D31_MAX_TARGETS then return d31_error("TARGET_COUNT_EXCEEDED", "Resolved targets exceed max_targets.", { resolved_target_count = #targets, max_targets = max_targets, hard_max_targets = D31_MAX_TARGETS }, false) end
  local outputs = d31_plan_outputs(request, targets, format.extension, requested_basename)
  local preflight_ok, preflight_error = d31_preflight(request, outputs)
  if not preflight_ok then return nil, preflight_error end

  local settings, settings_error = d31_snapshot_settings(project)
  if not settings then return nil, settings_error end
  local prior_tracks, tracks_error = d31_selected_tracks(project)
  if not prior_tracks then return nil, tracks_error end
  local prior_items, items_error = d31_selected_items(project)
  if not prior_items then return nil, items_error end

  local function render_all()
    local result_outputs = json_array({})
    for index = 1, #outputs do
      local output = outputs[index]
      local target = output.target
      if target.item and not d31_apply_item_selection(project, json_array({ target.item })) then return { failure = { code = "SELECTION_SET_FAILED", message = "Could not select D31 item target.", details = { target_index = index - 1 }, recoverable = false } } end
      if target.track and not d31_apply_track_selection(project, json_array({ target.track })) then return { failure = { code = "SELECTION_SET_FAILED", message = "Could not select D31 track target.", details = { target_index = index - 1 }, recoverable = false } } end
      if file_exists(output.absolute_path) or file_exists(output.absolute_path .. ".RPP") then
        return { failure = { code = "IDEMPOTENCY_CONFLICT", message = "fail_if_exists rejected a managed output collision immediately before rendering the target.", details = { blocker = "render_target_collision", output_basename = output.output_basename, target_index = index - 1 }, recoverable = false } }
      end
      local settings_ok, setting_key = d31_apply_settings(project, target, output, request.params, format)
      if not settings_ok then return { failure = { code = "RENDER_SETTINGS_WRITE_FAILED", message = "Could not configure REAPER project render settings.", details = { key = setting_key, target_index = index - 1 }, recoverable = false } } end
      local action_ok = call_reaper("Main_OnCommandEx", D31_ACTION_ID, 0, project)
      if not action_ok then return { failure = { code = "COMMAND_FAILED", message = "The audited REAPER project-render action 41824 failed.", details = { action_id = D31_ACTION_ID, target_index = index - 1 }, recoverable = false } } end
      local size = d31_size(output.absolute_path)
      local header_ok, actual_format, actual_bitrate = d31_probe_output(output.absolute_path, output.extension)
      if size <= 0 or not header_ok or actual_format ~= request.params.format or (format.mp3_bitrate_kbps and actual_bitrate ~= format.mp3_bitrate_kbps) then return { failure = { code = "VERIFY_FAILED", message = "Rendered output is absent, empty, or has the wrong container, MPEG layer, or bitrate.", details = { output_basename = output.output_basename, requested_format = request.params.format, actual_format = actual_format, requested_bitrate_kbps = format.mp3_bitrate_kbps, actual_bitrate_kbps = actual_bitrate, extension = output.extension, file_size_bytes = size, target_index = index - 1 }, recoverable = false } } end
      local measurement, measurement_error = d31_measure_output(output.absolute_path, output.extension)
      if not measurement then return { failure = { code = "VERIFY_FAILED", message = "Rendered output could not be measured without inferring audible content from file size.", details = { output_basename = output.output_basename, measurement_error = measurement_error and measurement_error.message or "unknown_measurement_failure", target_index = index - 1 }, recoverable = false } } end
      if measurement.is_silent == true then return { failure = { code = "RENDER_OUTPUT_ALL_ZERO", message = "Rendered output decoded successfully but every measured sample was zero; the render is not accepted as successful.", details = { output_basename = output.output_basename, requested_format = request.params.format, actual_format = actual_format, measurement_status = measurement.measurement_status, measurement_scope = measurement.measurement_scope, silence_classification = measurement.silence_classification, measured_peak_linear = measurement.peak_linear, target_identity = target.ref or target.label, target_index = index - 1 }, recoverable = false } } end
      local project_copy_path = output.absolute_path .. ".RPP"
      local project_copy_retained = file_exists(project_copy_path)
      result_outputs[#result_outputs + 1] = {
        source_name = output.source_name,
        output_basename = output.output_basename,
        absolute_path = output.absolute_path,
        size = size,
        extension = output.extension,
        requested_format = request.params.format,
        actual_format = actual_format,
        requested_bitrate_kbps = format.mp3_bitrate_kbps or JSON_NULL,
        actual_bitrate_kbps = actual_bitrate or JSON_NULL,
        measurement_status = measurement.measurement_status,
        measurement_scope = measurement.measurement_scope,
        measurement_format = measurement.measurement_format,
        sample_rate_hz = measurement.sample_rate_hz or JSON_NULL,
        measured_channel_count = measurement.channel_count or JSON_NULL,
        frame_count = measurement.frame_count or JSON_NULL,
        sample_count = measurement.sample_count or JSON_NULL,
        measured_peak_linear = measurement.peak_linear,
        measured_peak_dbfs = measurement.peak_dbfs,
        measured_rms_linear = measurement.rms_linear,
        measured_rms_dbfs = measurement.rms_dbfs,
        silence_classification = measurement.silence_classification,
        is_silent = measurement.is_silent,
        target_identity = target.ref or target.label,
        generated_project_copy_retained = project_copy_retained,
        generated_project_copy_path = project_copy_retained and project_copy_path or nil,
      }
    end
    return { outputs = result_outputs }
  end

  local call_ok, outcome = xpcall(render_all, function(message) return tostring(message) end)
  local finished_outcome, finish_error = d31_finish_render_attempt(project, settings, prior_tracks, prior_items, call_ok, outcome)
  if not finished_outcome then return nil, finish_error end
  outcome = finished_outcome

  local job_ref = d31_job_ref(request)
  local manifest_summary = { job_ref = job_ref.ref, format = request.params.format, mp3_bitrate_kbps = format.mp3_bitrate_kbps, requested_output_basename = requested_basename, file_count = #outcome.outputs, max_targets = max_targets, output_policy = request.params.output_policy, collision_policy = request.params.collision_policy, truncated = false }
  local manifest, manifest_error = write_a2_artifact(request, D31_MANIFEST_SPEC, manifest_summary, { target_kind = request.params.target_kind, outputs = outcome.outputs })
  if not manifest then return d31_error(manifest_error.code, manifest_error.message, manifest_error.details, manifest_error.recoverable) end
  local evidence_summary = { job_ref = job_ref.ref, output_artifact_ref = manifest.ref, verification_status = "passed", render_settings_restored = true, selections_restored = true, truncated = false }
  local evidence, evidence_error = write_a2_artifact(request, D31_EVIDENCE_SPEC, evidence_summary, { action_id = D31_ACTION_ID, target_kind = request.params.target_kind, render_request = { format = request.params.format, output_basename = requested_basename, sample_rate_hz = request.params.sample_rate_hz, channel_count = request.params.channel_count, wav_bit_depth = format.wav_bit_depth, ogg_quality = format.ogg_quality, mp3_bitrate_kbps = format.mp3_bitrate_kbps, max_targets = max_targets }, restoration = { render_settings = true, track_selection = true, item_selection = true }, outputs = outcome.outputs })
  if not evidence then return d31_error(evidence_error.code, evidence_error.message, evidence_error.details, evidence_error.recoverable) end
  return { job_ref = job_ref.ref, output_artifact_ref = manifest.ref, evidence_artifact_ref = evidence.ref, format = request.params.format, output_policy = request.params.output_policy, collision_policy = request.params.collision_policy, file_count = #outcome.outputs, outputs = outcome.outputs, restoration = { render_settings = true, track_selection = true, item_selection = true }, truncated = false }, nil, json_array({ manifest.object_ref, evidence.object_ref }), json_array({ job_ref })
end
