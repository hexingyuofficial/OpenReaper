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
local D31_MEDIA_ONLINE_ACTION_ID = 40101
local D31_MAX_TARGETS = 16
local D31_VIDEO_FINALIZATION_WAIT_SECONDS = 5
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
local D31_VIDEO_FRAME_RATE_BYTES = {
  [24] = string.char(0x00, 0x00, 0xC0, 0x41),
  [25] = string.char(0x00, 0x00, 0xC8, 0x41),
  [30] = string.char(0x00, 0x00, 0xF0, 0x41),
  [50] = string.char(0x00, 0x00, 0x48, 0x42),
  [60] = string.char(0x00, 0x00, 0x70, 0x42),
}
local D31_AUDIO_BITRATES = { [64] = true, [96] = true, [128] = true, [192] = true, [256] = true, [320] = true }
local D31_BASE64_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"

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
  VIDEO_WIDTH_REQUIRED = "PARAMS_INVALID",
  VIDEO_HEIGHT_REQUIRED = "PARAMS_INVALID",
  VIDEO_FRAME_RATE_REQUIRED = "PARAMS_INVALID",
  VIDEO_CODEC_REQUIRED = "PARAMS_INVALID",
  VIDEO_BITRATE_REQUIRED = "PARAMS_INVALID",
  VIDEO_AUDIO_CODEC_REQUIRED = "PARAMS_INVALID",
  VIDEO_AUDIO_BITRATE_REQUIRED = "PARAMS_INVALID",
  VIDEO_DESTINATION_UNSUPPORTED = "PARAMS_INVALID",
  FORMAT_INVALID = "PARAMS_INVALID",
  TIME_SELECTION_EMPTY = "PARAMS_INVALID",
  TARGET_REFS_DUPLICATE = "REF_INVALID",
  SELECTED_ITEMS_REQUIRED = "REF_INVALID",
  SELECTED_TRACKS_REQUIRED = "REF_INVALID",
  TARGET_KIND_INVALID = "PARAMS_INVALID",
  MAX_TARGETS_INVALID = "PARAMS_INVALID",
  TARGET_COUNT_EXCEEDED = "PARAMS_INVALID",
  OUTPUT_BASENAME_INVALID = "PARAMS_INVALID",
  RENDER_SOURCE_READBACK_UNAVAILABLE = "VERIFY_FAILED",
  RENDER_SOURCE_OFFLINE = "FILE_NOT_FOUND",
  RENDER_OUTPUT_ALL_ZERO = "VERIFY_FAILED",
  RENDER_OVERWRITE_REMOVE_FAILED = "INTERNAL_ERROR",
  STEM_MODE_INVALID = "PARAMS_INVALID",
  STEM_SOURCE_MUTED = "PARAMS_INVALID",
  STEM_IMPORT_FAILED = "COMMAND_FAILED",
  STEM_READBACK_FAILED = "VERIFY_FAILED",
  RESTORE_FAILED = "VERIFY_FAILED",
}

local d31_error

local function d31_u32le_bytes(value)
  return string.char(
    value % 256,
    math.floor(value / 256) % 256,
    math.floor(value / 65536) % 256,
    math.floor(value / 16777216) % 256
  )
end

local function d31_base64_encode(bytes)
  local output = {}
  for index = 1, #bytes, 3 do
    local a = bytes:byte(index) or 0
    local b = bytes:byte(index + 1)
    local c = bytes:byte(index + 2)
    local packed = a * 65536 + (b or 0) * 256 + (c or 0)
    output[#output + 1] = D31_BASE64_ALPHABET:sub(math.floor(packed / 262144) % 64 + 1, math.floor(packed / 262144) % 64 + 1)
    output[#output + 1] = D31_BASE64_ALPHABET:sub(math.floor(packed / 4096) % 64 + 1, math.floor(packed / 4096) % 64 + 1)
    output[#output + 1] = b and D31_BASE64_ALPHABET:sub(math.floor(packed / 64) % 64 + 1, math.floor(packed / 64) % 64 + 1) or "="
    output[#output + 1] = c and D31_BASE64_ALPHABET:sub(packed % 64 + 1, packed % 64 + 1) or "="
  end
  return table.concat(output)
end

local function d31_avfoundation_format(params)
  local width = tonumber(params.video_width)
  local height = tonumber(params.video_height)
  local frame_rate = tonumber(params.video_frame_rate)
  local video_bitrate = tonumber(params.video_bitrate_kbps)
  local audio_bitrate = tonumber(params.audio_bitrate_kbps)
  if not width or width ~= math.floor(width) or width < 16 or width > 7680 or width % 2 ~= 0 then return d31_error("VIDEO_WIDTH_REQUIRED", "MP4/MOV video_width must be an even integer from 16 through 7680.", { video_width = params.video_width }, false) end
  if not height or height ~= math.floor(height) or height < 16 or height > 4320 or height % 2 ~= 0 then return d31_error("VIDEO_HEIGHT_REQUIRED", "MP4/MOV video_height must be an even integer from 16 through 4320.", { video_height = params.video_height }, false) end
  if not D31_VIDEO_FRAME_RATE_BYTES[frame_rate] then return d31_error("VIDEO_FRAME_RATE_REQUIRED", "MP4/MOV video_frame_rate must be 24, 25, 30, 50, or 60.", { video_frame_rate = params.video_frame_rate }, false) end
  if params.video_codec ~= "h264" then return d31_error("VIDEO_CODEC_REQUIRED", "MP4/MOV video_codec must be h264.", { video_codec = params.video_codec }, false) end
  if not video_bitrate or video_bitrate ~= math.floor(video_bitrate) or video_bitrate < 256 or video_bitrate > 100000 then return d31_error("VIDEO_BITRATE_REQUIRED", "MP4/MOV video_bitrate_kbps must be an integer from 256 through 100000.", { video_bitrate_kbps = params.video_bitrate_kbps }, false) end
  if params.audio_codec ~= "aac" then return d31_error("VIDEO_AUDIO_CODEC_REQUIRED", "MP4/MOV audio_codec must be aac.", { audio_codec = params.audio_codec }, false) end
  if not audio_bitrate or not D31_AUDIO_BITRATES[audio_bitrate] then return d31_error("VIDEO_AUDIO_BITRATE_REQUIRED", "MP4/MOV audio_bitrate_kbps must be 64, 96, 128, 192, 256, or 320.", { audio_bitrate_kbps = params.audio_bitrate_kbps }, false) end
  if params.destination ~= nil and params.destination ~= "managed_file" then return d31_error("VIDEO_DESTINATION_UNSUPPORTED", "MP4/MOV support managed_file destination only.", { destination = params.destination }, false) end
  local container = params.format == "mov" and 2 or 0
  local bytes = "FVAX" .. d31_u32le_bytes(container) .. d31_u32le_bytes(0) ..
    d31_u32le_bytes(video_bitrate) .. d31_u32le_bytes(0) .. d31_u32le_bytes(audio_bitrate) ..
    d31_u32le_bytes(width) .. d31_u32le_bytes(height) .. D31_VIDEO_FRAME_RATE_BYTES[frame_rate] ..
    d31_u32le_bytes(1) .. d31_u32le_bytes(95) .. string.char(0, 0)
  return {
    extension = params.format,
    config = d31_base64_encode(bytes),
    video_width = width,
    video_height = height,
    video_frame_rate = frame_rate,
    video_codec = "h264",
    video_bitrate_kbps = video_bitrate,
    audio_codec = "aac",
    audio_bitrate_kbps = audio_bitrate,
    video = true,
  }
end

d31_error = function(code, message, details, recoverable)
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
  if lower:match("%.wav$") or lower:match("%.ogg$") or lower:match("%.mp3$") or lower:match("%.mp4$") or lower:match("%.mov$") then
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

local function d31_be_u32(bytes, offset)
  local a, b, c, d = bytes:byte(offset, offset + 3)
  if not a or not b or not c or not d then return nil end
  return a * 16777216 + b * 65536 + c * 256 + d
end

local function d31_atom_header(bytes, offset, limit)
  if offset + 7 > limit then return nil end
  local size = d31_be_u32(bytes, offset)
  local kind = bytes:sub(offset + 4, offset + 7)
  local header_size = 8
  if size == 1 then
    local high = d31_be_u32(bytes, offset + 8)
    local low = d31_be_u32(bytes, offset + 12)
    if not high or not low then return nil end
    size = high * 4294967296 + low
    header_size = 16
  elseif size == 0 then
    size = limit - offset + 1
  end
  if size < header_size or offset + size - 1 > limit then return nil end
  return kind, offset + header_size, offset + size - 1, offset + size
end

local D31_ISO_CONTAINERS = {
  mdia = true,
  minf = true,
  stbl = true,
  dinf = true,
  edts = true,
}

local function d31_walk_track_atoms(bytes, start_offset, limit, state, depth)
  if depth > 8 then return end
  local offset = start_offset
  while offset and offset <= limit do
    local kind, payload_start, atom_end, next_offset = d31_atom_header(bytes, offset, limit)
    if not kind then return end
    if kind == "tkhd" and atom_end - payload_start + 1 >= 8 then
      state.width = (d31_be_u32(bytes, atom_end - 7) or 0) / 65536
      state.height = (d31_be_u32(bytes, atom_end - 3) or 0) / 65536
    elseif kind == "hdlr" and payload_start + 11 <= atom_end then
      local handler = bytes:sub(payload_start + 8, payload_start + 11)
      if handler == "vide" or handler == "soun" then state.handler = handler end
    elseif kind == "mdhd" then
      local version = bytes:byte(payload_start)
      local timescale_offset = version == 1 and payload_start + 20 or payload_start + 12
      state.timescale = d31_be_u32(bytes, timescale_offset)
    elseif kind == "stts" and payload_start + 7 <= atom_end then
      local entry_count = d31_be_u32(bytes, payload_start + 4) or 0
      local cursor = payload_start + 8
      local sample_count = 0
      local sample_duration = 0
      for _ = 1, math.min(entry_count, 100000) do
        local count = d31_be_u32(bytes, cursor)
        local delta = d31_be_u32(bytes, cursor + 4)
        if not count or not delta then break end
        sample_count = sample_count + count
        sample_duration = sample_duration + count * delta
        cursor = cursor + 8
      end
      state.sample_count = sample_count
      state.sample_duration = sample_duration
    elseif kind == "stsd" then
      local payload = bytes:sub(payload_start, atom_end)
      if payload:find("avc1", 1, true) or payload:find("avc3", 1, true) then state.video_codec = "h264" end
      if payload:find("mp4a", 1, true) then state.audio_codec = "aac" end
    end
    if D31_ISO_CONTAINERS[kind] then d31_walk_track_atoms(bytes, payload_start, atom_end, state, depth + 1) end
    offset = next_offset
  end
end

local function d31_parse_moov(moov_bytes, moov_payload_start)
  local tracks = json_array({})
  local offset = moov_payload_start
  while offset and offset <= #moov_bytes do
    local kind, payload_start, atom_end, next_offset = d31_atom_header(moov_bytes, offset, #moov_bytes)
    if not kind then break end
    if kind == "trak" then
      local track = {}
      d31_walk_track_atoms(moov_bytes, payload_start, atom_end, track, 0)
      if track.timescale and track.timescale > 0 and track.sample_count and track.sample_count > 0 and track.sample_duration and track.sample_duration > 0 then
        track.frame_rate = track.timescale * track.sample_count / track.sample_duration
      end
      tracks[#tracks + 1] = track
    end
    offset = next_offset
  end
  return tracks
end

local function d31_probe_iso_bmff(path_value)
  local handle = io.open(path_value, "rb")
  if not handle then return nil end
  local file_size = handle:seek("end") or 0
  local offset = 0
  local state = { ftyp = false, moov = false, mdat = false, brand = nil, tracks = json_array({}) }
  while offset + 8 <= file_size do
    handle:seek("set", offset)
    local header = handle:read(16) or ""
    if #header < 8 then break end
    local size = d31_be_u32(header, 1)
    local kind = header:sub(5, 8)
    local header_size = 8
    if size == 1 then
      local high = d31_be_u32(header, 9)
      local low = d31_be_u32(header, 13)
      if not high or not low then break end
      size = high * 4294967296 + low
      header_size = 16
    elseif size == 0 then
      size = file_size - offset
    end
    if not size or size < header_size or offset + size > file_size then break end
    if kind == "ftyp" then
      state.ftyp = true
      handle:seek("set", offset + header_size)
      state.brand = handle:read(4)
    elseif kind == "moov" then
      state.moov = true
      if size <= 16777216 then
        handle:seek("set", offset)
        local bytes = handle:read(size) or ""
        state.tracks = d31_parse_moov(bytes, header_size + 1)
      end
    elseif kind == "mdat" then
      state.mdat = true
    end
    offset = offset + size
  end
  handle:close()
  local video_track = nil
  local audio_track = nil
  local video_count = 0
  local audio_count = 0
  for index = 1, #state.tracks do
    local track = state.tracks[index]
    if track.handler == "vide" then video_count = video_count + 1; video_track = video_track or track end
    if track.handler == "soun" then audio_count = audio_count + 1; audio_track = audio_track or track end
  end
  local actual_format = state.brand == "qt  " and "mov" or "mp4"
  return {
    ok = state.ftyp and state.moov and state.mdat and video_track ~= nil and video_track.video_codec == "h264",
    actual_format = actual_format,
    major_brand = state.brand,
    ftyp_verified = state.ftyp,
    moov_verified = state.moov,
    mdat_verified = state.mdat,
    video_track_count = video_count,
    audio_track_count = audio_count,
    width = video_track and math.floor((video_track.width or 0) + 0.5) or nil,
    height = video_track and math.floor((video_track.height or 0) + 0.5) or nil,
    frame_rate = video_track and video_track.frame_rate or nil,
    video_codec = video_track and video_track.video_codec or nil,
    audio_codec = audio_track and audio_track.audio_codec or nil,
  }
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
  if extension == "mp4" or extension == "mov" then
    local probe = d31_probe_iso_bmff(path_value)
    return probe ~= nil and probe.ok == true and probe.actual_format == extension, probe and probe.actual_format or nil, nil, probe
  end
  return false
end

local function d31_monotonic_seconds()
  local ok, value = call_reaper("time_precise")
  if ok and type(value) == "number" then return value end
  return os.clock()
end

local function d31_wait_for_final_video(path_value, extension)
  local started_at = d31_monotonic_seconds()
  local attempts = 0
  local size = 0
  local header_ok, actual_format, actual_bitrate, video_probe = false, nil, nil, nil
  repeat
    attempts = attempts + 1
    size = d31_size(path_value)
    if size > 0 then
      header_ok, actual_format, actual_bitrate, video_probe = d31_probe_output(path_value, extension)
      if header_ok then return size, header_ok, actual_format, actual_bitrate, video_probe, attempts end
    end
  until d31_monotonic_seconds() - started_at >= D31_VIDEO_FINALIZATION_WAIT_SECONDS
  return size, header_ok, actual_format, actual_bitrate, video_probe, attempts
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

-- REAPER can take file-backed media offline while the application is inactive
-- (`offlineinact=1`).  Action 40101 normally repairs that state, but a render
-- must prove the target source is readable before Action 41824 is allowed to
-- claim success.  MIDI/VSTi targets have no file-backed audio source and are
-- intentionally excluded from this probe.
local function d31_item_overlaps_target(project, item, target)
  if target.tracks then
    local ok_track, item_track = call_reaper("GetMediaItem_Track", item)
    if not ok_track or not item_track then return false end
    local matched = false
    for index = 1, #target.tracks do
      if target.tracks[index] == item_track then matched = true break end
    end
    if not matched then return false end
    if target.bounds == 0 and type(target.start_seconds) == "number" and type(target.end_seconds) == "number" then
      local ok_position, position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
      local ok_length, length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
      if not ok_position or not ok_length or type(position) ~= "number" or type(length) ~= "number" then return false end
      return position < target.end_seconds and (position + math.max(0, length)) > target.start_seconds
    end
    return true
  end
  if target.item then
    local item_guid = is_string(target.ref) and target.ref:match("^item:guid:(.+)$") or nil
    if item_guid then
      local ok_guid, _, candidate_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
      return ok_guid and first_string(candidate_guid) == item_guid
    end
    return target.item == item
  end
  if target.track then
    local ok_track, item_track = call_reaper("GetMediaItem_Track", item)
    if not ok_track or not item_track then return false end
    local track_guid = is_string(target.ref) and target.ref:match("^track:guid:(.+)$") or nil
    if track_guid then
      local ok_guid, candidate_guid = call_reaper("GetTrackGUID", item_track)
      return ok_guid and first_string(candidate_guid) == track_guid
    end
    return item_track == target.track
  end
  if target.bounds == 0 and type(target.start_seconds) == "number" and type(target.end_seconds) == "number" then
    local ok_position, position = call_reaper("GetMediaItemInfo_Value", item, "D_POSITION")
    local ok_length, length = call_reaper("GetMediaItemInfo_Value", item, "D_LENGTH")
    if not ok_position or not ok_length or type(position) ~= "number" or type(length) ~= "number" then return false end
    return position < target.end_seconds and (position + math.max(0, length)) > target.start_seconds
  end
  return true
end

local function d31_target_source_preflight(project, target)
  local ok_count, count = call_reaper("CountMediaItems", project)
  if not ok_count or type(count) ~= "number" or count < 0 then
    return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "Could not enumerate project media before rendering.", { target_identity = target.ref or target.label, api = "CountMediaItems" }, true)
  end
  for item_index = 0, math.floor(count) - 1 do
    local ok_item, item = call_reaper("GetMediaItem", project, item_index)
    if not ok_item or not item then
      return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "Could not read a project media item before rendering.", { target_identity = target.ref or target.label, item_index = item_index, api = "GetMediaItem" }, true)
    end
    if d31_item_overlaps_target(project, item, target) then
      local ok_take, take = call_reaper("GetActiveTake", item)
      if not ok_take then
        return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "Could not read the active Take before rendering.", { target_identity = target.ref or target.label, item_index = item_index, api = "GetActiveTake" }, true)
      end
      if take then
        local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
        if not ok_midi then
          return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "Could not classify the active Take before rendering.", { target_identity = target.ref or target.label, item_index = item_index, api = "TakeIsMIDI" }, true)
        end
        if is_midi ~= true and is_midi ~= 1 then
          local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
          if not ok_source or not source then
            return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "The target audio Take has no readable media source.", { target_identity = target.ref or target.label, item_index = item_index, api = "GetMediaItemTake_Source" }, true)
          end
          local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
          local ok_filename, filename = call_reaper("GetMediaSourceFileName", source, "")
          local source_kind = ok_type and first_string(source_type) or ""
          local source_path = ok_filename and first_string(filename) or ""
          if not ok_type or not ok_filename or source_kind == "" then
            return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "The target audio source identity could not be read before rendering.", { target_identity = target.ref or target.label, item_index = item_index, source_type = source_kind, api = "GetMediaSourceType/GetMediaSourceFileName" }, true)
          end
          if source_path == "" then
            return d31_error("RENDER_SOURCE_READBACK_UNAVAILABLE", "The target audio source has no file identity and cannot be proven renderable.", { target_identity = target.ref or target.label, item_index = item_index, source_type = source_kind }, true)
          end
          if not file_exists(source_path) then
            return d31_error("RENDER_SOURCE_OFFLINE", "The target audio source is still offline or missing after REAPER Set all media online.", { target_identity = target.ref or target.label, item_index = item_index, source_type = source_kind, source_path = bounded_string(source_path, 240), media_online_action_id = D31_MEDIA_ONLINE_ACTION_ID, render_action_id = D31_ACTION_ID, retry_requires_source_reconnect = true }, true)
          end
        end
      end
    end
  end
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

local function d31_take_ref(take, fallback)
  local ok, _, guid = call_reaper("GetSetMediaItemTakeInfo_String", take, "GUID", "", false)
  local value = ok and first_string(guid) or ""
  return value ~= "" and ("take:guid:" .. value) or ("take:take_index:" .. tostring(fallback or 0))
end

local function d31_track_mix_snapshot(project)
  local ok_count, count = call_reaper("CountTracks", project)
  if not ok_count or type(count) ~= "number" then return d31_error("SELECTION_UNAVAILABLE", "Could not snapshot Track mix state before Stem rendering.", {}, false) end
  local rows = json_array({})
  for index = 0, math.floor(count) - 1 do
    local ok_track, track = call_reaper("GetTrack", project, index)
    local ok_mute, mute = false, nil
    local ok_solo, solo = false, nil
    if track then
      ok_mute, mute = call_reaper("GetMediaTrackInfo_Value", track, "B_MUTE")
      ok_solo, solo = call_reaper("GetMediaTrackInfo_Value", track, "I_SOLO")
    end
    if not ok_track or not track or not ok_mute or type(mute) ~= "number" or not ok_solo or type(solo) ~= "number" then
      return d31_error("SELECTION_UNAVAILABLE", "Could not read exact Track mute/solo state before Stem rendering.", { track_index = index }, false)
    end
    rows[#rows + 1] = { track = track, muted = mute, solo = solo }
  end
  return rows
end

local function d31_write_track_number(track, key, value)
  local ok, accepted = call_reaper("SetMediaTrackInfo_Value", track, key, value)
  if not ok or accepted == false then return false end
  local ok_read, actual = call_reaper("GetMediaTrackInfo_Value", track, key)
  return ok_read and type(actual) == "number" and math.abs(actual - value) < 0.000001
end

local function d31_restore_track_mix(snapshot)
  if not snapshot then return true end
  for index = 1, #snapshot do
    local row = snapshot[index]
    if not d31_write_track_number(row.track, "B_MUTE", row.muted) or not d31_write_track_number(row.track, "I_SOLO", row.solo) then return false end
  end
  return true
end

local function d31_isolate_stem_tracks(target, snapshot)
  local members = {}
  for index = 1, #target.tracks do members[target.tracks[index]] = true end
  for index = 1, #snapshot do
    local row = snapshot[index]
    if members[row.track] and row.muted ~= 0 then
      return d31_error("STEM_SOURCE_MUTED", "Stem source Tracks must be audible before rendering; OpenReaper does not silently unmute them.", { track_ref = d31_track_ref(row.track, index - 1), zero_write = true }, true)
    end
  end
  for index = 1, #snapshot do
    local row = snapshot[index]
    if not d31_write_track_number(row.track, "I_SOLO", members[row.track] and 2 or 0) then
      return d31_error("SELECTION_SET_FAILED", "Could not apply temporary Stem source isolation.", { track_index = index - 1 }, false)
    end
  end
  return true
end

local function d31_stem_rollback(project, context)
  local track_deleted = true
  if context and context.created_track then
    local ok_delete, accepted = call_reaper("DeleteTrack", context.created_track)
    track_deleted = ok_delete and accepted ~= false
  end
  local mix_restored = d31_restore_track_mix(context and context.mix_snapshot)
  local tracks_restored = d31_apply_track_selection(project, context and context.prior_tracks or json_array({}))
  local items_restored = d31_apply_item_selection(project, context and context.prior_items or json_array({}))
  return track_deleted and mix_restored and tracks_restored and items_restored, {
    destination_track_deleted = track_deleted,
    source_mix_restored = mix_restored,
    track_selection_restored = tracks_restored,
    item_selection_restored = items_restored,
  }
end

local function d31_import_verified_stem(project, request, target, output, mix_snapshot, prior_tracks, prior_items)
  local context = { created_track = nil, mix_snapshot = mix_snapshot, prior_tracks = prior_tracks, prior_items = prior_items }
  local ok_source, source = call_reaper("PCM_Source_CreateFromFile", output.absolute_path)
  if not ok_source or not source then return d31_error("STEM_IMPORT_FAILED", "Verified Stem output could not be reopened for project import.", { output_basename = output.output_basename }, false) end
  local source_owned = false
  local function fail(code, message, details, recoverable)
    if not source_owned then call_reaper("PCM_Source_Destroy", source) end
    local rolled_back, recovery = d31_stem_rollback(project, context)
    details = details or {}
    details.recovery = recovery
    if not rolled_back then return d31_error("RESTORE_FAILED", "Stem import failed and exact project recovery did not complete.", details, false) end
    return d31_error(code, message, details, recoverable)
  end
  local ok_length, length, length_is_qn = call_reaper("GetMediaSourceLength", source)
  if not ok_length or type(length) ~= "number" or length <= 0 or length_is_qn == true then return fail("STEM_READBACK_FAILED", "Stem source length could not be verified in seconds.", {}, false) end
  local ok_count, count = call_reaper("CountTracks", project)
  if not ok_count or type(count) ~= "number" then return fail("STEM_IMPORT_FAILED", "Could not resolve the destination Track index.", {}, false) end
  local track_index = math.floor(count)
  local ok_insert, accepted_insert = call_reaper("InsertTrackAtIndex", track_index, true)
  if not ok_insert or accepted_insert == false then return fail("STEM_IMPORT_FAILED", "Could not create the Stem destination Track.", { track_index = track_index }, false) end
  local ok_track, track = call_reaper("GetTrack", project, track_index)
  if not ok_track or not track then return fail("STEM_READBACK_FAILED", "Created Stem destination Track could not be read back.", { track_index = track_index }, false) end
  context.created_track = track
  local expected_name = request.params.output_track_name or output.output_basename
  local ok_name, accepted_name = call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", expected_name, true)
  if not ok_name or accepted_name == false or d31_track_name(track, "") ~= expected_name then return fail("STEM_READBACK_FAILED", "Stem destination Track name did not read back exactly.", { expected_name = bounded_string(expected_name, 160) }, false) end
  local ok_item, item = call_reaper("AddMediaItemToTrack", track)
  if not ok_item or not item then return fail("STEM_IMPORT_FAILED", "Could not create the Stem destination Item.", {}, false) end
  local position = target.start_seconds or 0
  local ok_position, accepted_position = call_reaper("SetMediaItemInfo_Value", item, "D_POSITION", position)
  local ok_item_length, accepted_length = call_reaper("SetMediaItemInfo_Value", item, "D_LENGTH", length)
  if not ok_position or accepted_position == false or not ok_item_length or accepted_length == false then return fail("STEM_IMPORT_FAILED", "Could not set exact Stem Item bounds.", { position = position, length = length }, false) end
  local ok_take, take = call_reaper("AddTakeToMediaItem", item)
  if not ok_take or not take then return fail("STEM_IMPORT_FAILED", "Could not create the Stem destination Take.", {}, false) end
  local ok_attach, accepted_attach = call_reaper("SetMediaItemTake_Source", take, source)
  if not ok_attach or accepted_attach == false then return fail("STEM_IMPORT_FAILED", "Could not attach the verified Stem source to its Take.", {}, false) end
  source_owned = true
  local ok_update, accepted_update = call_reaper("UpdateItemInProject", item)
  if not ok_update or accepted_update == false then return fail("STEM_IMPORT_FAILED", "Could not refresh the imported Stem Item.", {}, false) end
  local ok_items, item_count = call_reaper("CountTrackMediaItems", track)
  local ok_first, actual_item = call_reaper("GetTrackMediaItem", track, 0)
  local ok_active, actual_take = call_reaper("GetActiveTake", item)
  local ok_attached, actual_source = call_reaper("GetMediaItemTake_Source", take)
  local ok_path, actual_path = false, nil
  if actual_source then ok_path, actual_path = call_reaper("GetMediaSourceFileName", actual_source, "") end
  if not ok_items or item_count ~= 1 or not ok_first or actual_item ~= item or not ok_active or actual_take ~= take or not ok_attached or actual_source ~= source or not ok_path or first_string(actual_path) ~= output.absolute_path then
    return fail("STEM_READBACK_FAILED", "Stem destination did not read back as exactly one Track, Item, Take, and exact source.", {}, false)
  end
  for index = 1, #target.tracks do
    if not d31_write_track_number(target.tracks[index], "B_MUTE", 1) then return fail("STEM_READBACK_FAILED", "A source Track did not read back muted after verified Stem insertion.", { source_track_index = index - 1 }, false) end
  end
  if not d31_apply_track_selection(project, prior_tracks) or not d31_apply_item_selection(project, prior_items) then return fail("RESTORE_FAILED", "Stem succeeded but visible selection could not be restored.", {}, false) end
  local source_refs = json_array({})
  for index = 1, #target.tracks do source_refs[#source_refs + 1] = d31_track_ref(target.tracks[index], index - 1) end
  return {
    destination_track_ref = d31_track_ref(track, track_index),
    destination_item_ref = d31_item_ref(item, 0),
    destination_take_ref = d31_take_ref(take, 0),
    output_basename = output.output_basename,
    source_track_refs = source_refs,
    source_track_count = #target.tracks,
    source_tracks_muted = true,
    destination_track_count = 1,
    destination_item_count = 1,
    destination_take_count = 1,
    imported_source_verified = true,
    non_silent_verified = output.is_silent == false,
  }, context
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
  if params.format == "mp4" or params.format == "mov" then return d31_avfoundation_format(params) end
  return d31_error("FORMAT_INVALID", "D31 supports only wav, ogg, mp3, mp4, and mov.", { format = params.format }, false)
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
  if request.params.destination == "new_project_track" then
    if (kind ~= "selected_tracks" and kind ~= "explicit_tracks") or request.params.stem_mode ~= "mixdown" or request.params.source_post_action ~= "mute_after_verified_insert" or request.params.format ~= "wav" then
      return d31_error("STEM_MODE_INVALID", "In-project Stem requires selected/explicit Tracks, WAV, mixdown, and mute_after_verified_insert.", { target_kind = kind, format = request.params.format }, false)
    end
    local source_tracks = json_array({})
    local source_refs = json_array({})
    for index = 1, #targets do
      source_tracks[#source_tracks + 1] = targets[index].track
      source_refs[#source_refs + 1] = targets[index].ref
    end
    local bounds = 1
    local start_seconds = nil
    local end_seconds = nil
    local range = request.params.render_range
    if is_object(range) then
      if range.mode == "time_selection" then
        local ok_range, start_pos, end_pos = call_reaper("GetSet_LoopTimeRange", false, false, 0, 0, false)
        if not ok_range or type(start_pos) ~= "number" or type(end_pos) ~= "number" or end_pos <= start_pos then return d31_error("TIME_SELECTION_EMPTY", "Stem time_selection requires a non-empty time selection.", {}) end
        start_seconds, end_seconds = start_pos, end_pos
      elseif range.mode == "explicit_range" and type(range.start_seconds) == "number" and type(range.end_seconds) == "number" and range.end_seconds > range.start_seconds then
        start_seconds, end_seconds = range.start_seconds, range.end_seconds
      else
        return d31_error("STEM_MODE_INVALID", "Stem render_range must be a non-empty explicit_range or time_selection.", {}, false)
      end
      bounds = 0
    end
    targets = json_array({ {
      source = 0,
      bounds = bounds,
      start_seconds = start_seconds,
      end_seconds = end_seconds,
      tracks = source_tracks,
      refs = source_refs,
      source_name = request.params.output_track_name or "OpenReaper_Stem",
      label = "project_stem",
      ref = "target-set:stem",
    } })
  elseif request.params.destination ~= nil and request.params.destination ~= "managed_file" then
    return d31_error("STEM_MODE_INVALID", "destination must be managed_file or new_project_track.", { destination = request.params.destination }, false)
  end
  return targets
end

local function d31_plan_outputs(request, targets, extension, requested_basename, collision_suffix_index)
  local suffix = d31_safe_name(request.idempotency_key or request.id or "request", "request"):sub(1, 48)
  local project_name = d31_safe_name(d31_project_name(), "current_project")
  local collision_suffix = collision_suffix_index and collision_suffix_index > 0 and ("_" .. tostring(collision_suffix_index)) or ""
  local outputs = json_array({})
  for index = 1, #targets do
    local target = targets[index]
    local base = requested_basename or (project_name .. "_" .. d31_safe_name(target.source_name, "target") .. "_" .. d31_safe_name(target.label, "target") .. "_" .. suffix)
    local target_suffix = #targets > 1 and ("_" .. string.format("%02d", index)) or ""
    local appended = collision_suffix .. target_suffix
    local basename = base:sub(1, 180 - #appended) .. appended
    outputs[#outputs + 1] = { source_name = bounded_string(target.source_name, 160), output_basename = basename, absolute_path = path_join(RENDER_ROOT, basename .. "." .. extension), extension = extension, target = target, collision_suffix_index = collision_suffix_index or 0 }
  end
  return outputs
end

local function d31_first_output_collision(outputs)
  for index = 1, #outputs do
    local output = outputs[index]
    if file_exists(output.absolute_path) then
      return { blocker = "render_output_exists", existing_kind = "audio_output", output_basename = output.output_basename, absolute_path = output.absolute_path, existing_size_bytes = d31_size(output.absolute_path), target_index = index - 1, collision_suffix_index = output.collision_suffix_index }
    end
    local project_copy_path = output.absolute_path .. ".RPP"
    if file_exists(project_copy_path) then
      return { blocker = "render_project_copy_exists", existing_kind = "project_copy", output_basename = output.output_basename, absolute_path = project_copy_path, existing_size_bytes = d31_size(project_copy_path), target_index = index - 1, collision_suffix_index = output.collision_suffix_index }
    end
  end
  return nil
end

local function d31_resolve_outputs(request, targets, extension, requested_basename)
  if request.params.collision_policy ~= "suffix" then
    return d31_plan_outputs(request, targets, extension, requested_basename, 0), 0
  end
  for suffix_index = 0, 9999 do
    local outputs = d31_plan_outputs(request, targets, extension, requested_basename, suffix_index)
    if not d31_first_output_collision(outputs) then return outputs, suffix_index end
  end
  return d31_error("IDEMPOTENCY_CONFLICT", "suffix could not find a free managed output name through _9999.", { blocker = "render_suffix_space_exhausted", collision_policy = "suffix", zero_write = true }, false)
end

local function d31_preflight(request, outputs)
  local ready, blocker, message = d31_root_ready()
  if not ready then return d31_error("FILE_NOT_FOUND", message, { blocker = blocker, render_root_env = RENDER_ROOT_ENV }, false) end
  local artifact_ready, artifact_blocker, artifact_message = a2_artifact_root_ready()
  if not artifact_ready then return d31_error("ARTIFACT_INVALID", artifact_message, { blocker = artifact_blocker, artifact_root_env = ARTIFACT_ROOT_ENV }, false) end
  local dir_ok, dir_error = ensure_directory(RENDER_ROOT)
  if not dir_ok then return d31_error("FILE_NOT_FOUND", "D31 managed render root could not be prepared.", { blocker = "render_root_unavailable", message = bounded_string(dir_error, 160) }, false) end
  if request.params.collision_policy ~= "overwrite" then
    local collision = d31_first_output_collision(outputs)
    if collision then
      collision.collision_policy = request.params.collision_policy
      collision.zero_write = true
      return d31_error("IDEMPOTENCY_CONFLICT", request.params.collision_policy .. " rejected an existing managed output before rendering began.", collision, false)
    end
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

local function d31_finish_render_attempt(project, settings, prior_tracks, prior_items, call_ok, outcome, mix_snapshot)
  local settings_restored, failed_settings = d31_restore_settings(project, settings)
  local mix_restored = d31_restore_track_mix(mix_snapshot)
  local tracks_restored = d31_apply_track_selection(project, prior_tracks)
  local items_restored = d31_apply_item_selection(project, prior_items)
  if not settings_restored or not mix_restored or not tracks_restored or not items_restored then
    return d31_error("RESTORE_FAILED", "D31 could not restore pre-render settings or selections.", {
      failed_render_setting_keys = failed_settings,
      track_mix_restored = mix_restored,
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

local function d31_remove_overwrite_target(output)
  local removed_audio = false
  local removed_audio_size = 0
  local removed_project_copy = false
  local project_copy_path = output.absolute_path .. ".RPP"
  if file_exists(project_copy_path) then
    local ok, message = os.remove(project_copy_path)
    if not ok then return nil, { existing_kind = "project_copy", absolute_path = project_copy_path, message = bounded_string(message, 160) } end
    removed_project_copy = true
  end
  if file_exists(output.absolute_path) then
    removed_audio_size = d31_size(output.absolute_path)
    local ok, message = os.remove(output.absolute_path)
    if not ok then return nil, { existing_kind = "audio_output", absolute_path = output.absolute_path, existing_size_bytes = removed_audio_size, message = bounded_string(message, 160) } end
    removed_audio = true
  end
  return { removed_audio = removed_audio, removed_audio_size = removed_audio_size, removed_project_copy = removed_project_copy }
end

local function d31_render_targets(request)
  if request.params.output_policy ~= "openreaper_managed_render_root" then return d31_error("PARAMS_INVALID", "D31 requires openreaper_managed_render_root output_policy.", { field = "output_policy" }, false) end
  if request.params.collision_policy ~= "fail_if_exists" and request.params.collision_policy ~= "overwrite" and request.params.collision_policy ~= "suffix" then return d31_error("PARAMS_INVALID", "D31 collision_policy must be fail_if_exists, overwrite, or suffix.", { collision_policy = request.params.collision_policy }, false) end
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
  local resolved_target_count = targets[1] and targets[1].tracks and #targets[1].tracks or #targets
  if #targets < 1 or resolved_target_count > max_targets or resolved_target_count > D31_MAX_TARGETS then return d31_error("TARGET_COUNT_EXCEEDED", "Resolved targets exceed max_targets.", { resolved_target_count = resolved_target_count, max_targets = max_targets, hard_max_targets = D31_MAX_TARGETS }, false) end
  local outputs, collision_suffix_index_or_error = d31_resolve_outputs(request, targets, format.extension, requested_basename)
  if not outputs then return nil, collision_suffix_index_or_error end
  local collision_suffix_index = collision_suffix_index_or_error
  local preflight_ok, preflight_error = d31_preflight(request, outputs)
  if not preflight_ok then return nil, preflight_error end

  local settings, settings_error = d31_snapshot_settings(project)
  if not settings then return nil, settings_error end
  local prior_tracks, tracks_error = d31_selected_tracks(project)
  if not prior_tracks then return nil, tracks_error end
  local prior_items, items_error = d31_selected_items(project)
  if not prior_items then return nil, items_error end
  local mix_snapshot = nil
  if request.params.destination == "new_project_track" then
    mix_snapshot, items_error = d31_track_mix_snapshot(project)
    if not mix_snapshot then return nil, items_error end
  end

  local function render_all()
    local result_outputs = json_array({})
    if mix_snapshot then
      local isolated, isolation_error = d31_isolate_stem_tracks(targets[1], mix_snapshot)
      if not isolated then
        return { failure = { code = isolation_error.details and isolation_error.details.local_code or isolation_error.code, message = isolation_error.message, details = isolation_error.details, recoverable = isolation_error.recoverable } }
      end
    end
    for index = 1, #outputs do
      local output = outputs[index]
      local target = output.target
      if target.item and not d31_apply_item_selection(project, json_array({ target.item })) then return { failure = { code = "SELECTION_SET_FAILED", message = "Could not select D31 item target.", details = { target_index = index - 1 }, recoverable = false } } end
      if target.track and not d31_apply_track_selection(project, json_array({ target.track })) then return { failure = { code = "SELECTION_SET_FAILED", message = "Could not select D31 track target.", details = { target_index = index - 1 }, recoverable = false } } end
      local settings_ok, setting_key = d31_apply_settings(project, target, output, request.params, format)
      if not settings_ok then return { failure = { code = "RENDER_SETTINGS_WRITE_FAILED", message = "Could not configure REAPER project render settings.", details = { key = setting_key, target_index = index - 1 }, recoverable = false } } end
      local online_ok = call_reaper("Main_OnCommandEx", D31_MEDIA_ONLINE_ACTION_ID, 0, project)
      if not online_ok then return { failure = { code = "COMMAND_FAILED", message = "REAPER could not set project media online before rendering.", details = { media_online_action_id = D31_MEDIA_ONLINE_ACTION_ID, render_action_id = D31_ACTION_ID, target_index = index - 1 }, recoverable = true } } end
      local source_ready, source_error = d31_target_source_preflight(project, target)
      if not source_ready then
        local details = source_error.details or {}
        details.target_index = index - 1
        details.media_online_action_id = D31_MEDIA_ONLINE_ACTION_ID
        details.render_action_id = D31_ACTION_ID
        return { failure = { code = source_error.code, message = source_error.message, details = details, recoverable = source_error.recoverable ~= false } }
      end
      local overwrite = { removed_audio = false, removed_audio_size = 0, removed_project_copy = false }
      if request.params.collision_policy == "overwrite" then
        local overwrite_error
        overwrite, overwrite_error = d31_remove_overwrite_target(output)
        if not overwrite then
          overwrite_error.blocker = "render_overwrite_remove_failed"
          overwrite_error.output_basename = output.output_basename
          overwrite_error.collision_policy = request.params.collision_policy
          overwrite_error.target_index = index - 1
          return { failure = { code = "RENDER_OVERWRITE_REMOVE_FAILED", message = "overwrite could not remove the exact existing managed output before rendering.", details = overwrite_error, recoverable = false } }
        end
      else
        local collision = d31_first_output_collision(json_array({ output }))
        if collision then
          collision.blocker = "render_target_collision"
          collision.collision_policy = request.params.collision_policy
          collision.zero_write = index == 1
          collision.target_index = index - 1
          return { failure = { code = "IDEMPOTENCY_CONFLICT", message = request.params.collision_policy .. " rejected a managed output collision immediately before rendering the target.", details = collision, recoverable = false } }
        end
      end
      local action_ok = call_reaper("Main_OnCommandEx", D31_ACTION_ID, 0, project)
      if not action_ok then return { failure = { code = "COMMAND_FAILED", message = "The audited REAPER project-render action 41824 failed.", details = { action_id = D31_ACTION_ID, target_index = index - 1 }, recoverable = false } } end
      local size, header_ok, actual_format, actual_bitrate, video_probe, finalization_poll_count
      if format.video then
        size, header_ok, actual_format, actual_bitrate, video_probe, finalization_poll_count = d31_wait_for_final_video(output.absolute_path, output.extension)
      else
        size = d31_size(output.absolute_path)
        header_ok, actual_format, actual_bitrate, video_probe = d31_probe_output(output.absolute_path, output.extension)
      end
      if size <= 0 or not header_ok or actual_format ~= request.params.format or (format.mp3_bitrate_kbps and actual_bitrate ~= format.mp3_bitrate_kbps) then return { failure = { code = "VERIFY_FAILED", message = "Rendered output is absent, empty, or has the wrong container, MPEG layer, bitrate, or video atom structure.", details = { output_basename = output.output_basename, requested_format = request.params.format, actual_format = actual_format, requested_bitrate_kbps = format.mp3_bitrate_kbps, actual_bitrate_kbps = actual_bitrate, extension = output.extension, file_size_bytes = size, target_index = index - 1, video_probe = video_probe }, recoverable = false } } end
      local measurement = nil
      if format.video then
        local frame_rate_matches = video_probe and type(video_probe.frame_rate) == "number" and math.abs(video_probe.frame_rate - format.video_frame_rate) <= 0.02
        if not video_probe or video_probe.width ~= format.video_width or video_probe.height ~= format.video_height or not frame_rate_matches or video_probe.video_codec ~= "h264" or video_probe.audio_codec ~= "aac" then
          return { failure = { code = "VERIFY_FAILED", message = "Rendered video container did not prove the requested dimensions, frame rate, H.264 video track, and AAC audio track.", details = { output_basename = output.output_basename, requested_video_width = format.video_width, requested_video_height = format.video_height, requested_video_frame_rate = format.video_frame_rate, requested_video_codec = format.video_codec, requested_audio_codec = format.audio_codec, video_probe = video_probe, target_index = index - 1 }, recoverable = false } }
        end
      else
        local measurement_error
        measurement, measurement_error = d31_measure_output(output.absolute_path, output.extension)
        if not measurement then return { failure = { code = "VERIFY_FAILED", message = "Rendered output could not be measured without inferring audible content from file size.", details = { output_basename = output.output_basename, measurement_error = measurement_error and measurement_error.message or "unknown_measurement_failure", target_index = index - 1 }, recoverable = false } } end
        if measurement.is_silent == true then return { failure = { code = "RENDER_OUTPUT_ALL_ZERO", message = "Rendered output decoded successfully but every measured sample was zero; media was explicitly brought online first, so the render is not accepted as successful.", details = { output_basename = output.output_basename, requested_format = request.params.format, actual_format = actual_format, measurement_status = measurement.measurement_status, measurement_scope = measurement.measurement_scope, silence_classification = measurement.silence_classification, measured_peak_linear = measurement.peak_linear, target_identity = target.ref or target.label, target_index = index - 1, media_online_action_id = D31_MEDIA_ONLINE_ACTION_ID, render_action_id = D31_ACTION_ID, probable_causes = json_array({ "intentionally_silent_target", "unavailable_source_or_instrument", "silent_signal_path" }), retry_requires_fresh_output_basename = true, audio_device_required = false }, recoverable = true } } end
      end
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
        measurement_status = format.video and "video_container_verified" or measurement.measurement_status,
        measurement_scope = format.video and "iso_bmff_atoms_and_track_metadata" or measurement.measurement_scope,
        measurement_format = format.video and request.params.format or measurement.measurement_format,
        sample_rate_hz = measurement and measurement.sample_rate_hz or JSON_NULL,
        measured_channel_count = measurement and measurement.channel_count or JSON_NULL,
        frame_count = measurement and measurement.frame_count or JSON_NULL,
        sample_count = measurement and measurement.sample_count or JSON_NULL,
        measured_peak_linear = measurement and measurement.peak_linear or JSON_NULL,
        measured_peak_dbfs = measurement and measurement.peak_dbfs or JSON_NULL,
        measured_rms_linear = measurement and measurement.rms_linear or JSON_NULL,
        measured_rms_dbfs = measurement and measurement.rms_dbfs or JSON_NULL,
        silence_classification = format.video and "not_applicable_video" or measurement.silence_classification,
        is_silent = format.video and JSON_NULL or measurement.is_silent,
        requested_video_width = format.video and format.video_width or nil,
        actual_video_width = format.video and video_probe.width or nil,
        requested_video_height = format.video and format.video_height or nil,
        actual_video_height = format.video and video_probe.height or nil,
        requested_video_frame_rate = format.video and format.video_frame_rate or nil,
        actual_video_frame_rate = format.video and video_probe.frame_rate or nil,
        requested_video_codec = format.video and format.video_codec or nil,
        actual_video_codec = format.video and video_probe.video_codec or nil,
        requested_audio_codec = format.video and format.audio_codec or nil,
        actual_audio_codec = format.video and video_probe.audio_codec or nil,
        configured_video_bitrate_kbps = format.video and format.video_bitrate_kbps or nil,
        configured_audio_bitrate_kbps = format.video and format.audio_bitrate_kbps or nil,
        video_track_count = format.video and video_probe.video_track_count or nil,
        audio_track_count = format.video and video_probe.audio_track_count or nil,
        iso_bmff_major_brand = format.video and video_probe.major_brand or nil,
        iso_bmff_ftyp_verified = format.video and video_probe.ftyp_verified or nil,
        iso_bmff_moov_verified = format.video and video_probe.moov_verified or nil,
        iso_bmff_mdat_verified = format.video and video_probe.mdat_verified or nil,
        native_video_settings_readback_verified = format.video and true or nil,
        video_finalization_poll_count = format.video and finalization_poll_count or nil,
        target_identity = target.ref or target.label,
        collision_policy = request.params.collision_policy,
        collision_suffix_index = output.collision_suffix_index,
        overwrote_existing = overwrite.removed_audio or overwrite.removed_project_copy,
        overwritten_size_bytes = overwrite.removed_audio_size,
        generated_project_copy_retained = project_copy_retained,
        generated_project_copy_path = project_copy_retained and project_copy_path or nil,
      }
    end
    return { outputs = result_outputs }
  end

  local call_ok, outcome = xpcall(render_all, function(message) return tostring(message) end)
  local finished_outcome, finish_error = d31_finish_render_attempt(project, settings, prior_tracks, prior_items, call_ok, outcome, mix_snapshot)
  if not finished_outcome then return nil, finish_error end
  outcome = finished_outcome

  local stem = nil
  local stem_context = nil
  if request.params.destination == "new_project_track" then
    stem, stem_context = d31_import_verified_stem(project, request, targets[1], outcome.outputs[1], mix_snapshot, prior_tracks, prior_items)
    if not stem then return nil, stem_context end
  end

  local audio_outputs = format.video and json_array({}) or outcome.outputs
  local video_outputs = format.video and outcome.outputs or json_array({})

  local job_ref = d31_job_ref(request)
  local manifest_summary = { job_ref = job_ref.ref, format = request.params.format, mp3_bitrate_kbps = format.mp3_bitrate_kbps, video_width = format.video_width, video_height = format.video_height, video_frame_rate = format.video_frame_rate, video_codec = format.video_codec, video_bitrate_kbps = format.video_bitrate_kbps, audio_codec = format.audio_codec, audio_bitrate_kbps = format.audio_bitrate_kbps, requested_output_basename = requested_basename, collision_suffix_index = collision_suffix_index, file_count = #outcome.outputs, max_targets = max_targets, output_policy = request.params.output_policy, collision_policy = request.params.collision_policy, truncated = false }
  local manifest, manifest_error = write_a2_artifact(request, D31_MANIFEST_SPEC, manifest_summary, { target_kind = request.params.target_kind, destination = request.params.destination or "managed_file", outputs = outcome.outputs, audio_outputs = audio_outputs, video_outputs = video_outputs, stem = stem })
  if not manifest then
    if stem_context then d31_stem_rollback(project, stem_context) end
    return d31_error(manifest_error.code, manifest_error.message, manifest_error.details, manifest_error.recoverable)
  end
  local evidence_summary = { job_ref = job_ref.ref, output_artifact_ref = manifest.ref, verification_status = "passed", media_online_verified = true, render_settings_restored = true, selections_restored = true, truncated = false }
  local evidence, evidence_error = write_a2_artifact(request, D31_EVIDENCE_SPEC, evidence_summary, { action_id = D31_ACTION_ID, media_online_action_id = D31_MEDIA_ONLINE_ACTION_ID, source_online_preflight = true, render_action_id = D31_ACTION_ID, target_kind = request.params.target_kind, destination = request.params.destination or "managed_file", render_request = { format = request.params.format, output_basename = requested_basename, sample_rate_hz = request.params.sample_rate_hz, channel_count = request.params.channel_count, wav_bit_depth = format.wav_bit_depth, ogg_quality = format.ogg_quality, mp3_bitrate_kbps = format.mp3_bitrate_kbps, video_width = format.video_width, video_height = format.video_height, video_frame_rate = format.video_frame_rate, video_codec = format.video_codec, video_bitrate_kbps = format.video_bitrate_kbps, audio_codec = format.audio_codec, audio_bitrate_kbps = format.audio_bitrate_kbps, max_targets = max_targets }, restoration = { render_settings = true, track_mix = true, track_selection = true, item_selection = true }, outputs = outcome.outputs, audio_outputs = audio_outputs, video_outputs = video_outputs, stem = stem })
  if not evidence then
    if stem_context then d31_stem_rollback(project, stem_context) end
    return d31_error(evidence_error.code, evidence_error.message, evidence_error.details, evidence_error.recoverable)
  end
  return { job_ref = job_ref.ref, output_artifact_ref = manifest.ref, evidence_artifact_ref = evidence.ref, format = request.params.format, output_policy = request.params.output_policy, collision_policy = request.params.collision_policy, collision_suffix_index = collision_suffix_index, file_count = #outcome.outputs, outputs = outcome.outputs, audio_outputs = audio_outputs, video_outputs = video_outputs, stem = stem, restoration = { render_settings = true, track_mix = true, track_selection = true, item_selection = true }, truncated = false }, nil, json_array({ manifest.object_ref, evidence.object_ref }), json_array({ job_ref })
end
