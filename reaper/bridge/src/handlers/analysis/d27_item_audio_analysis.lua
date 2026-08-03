-- D27 native-first item audio analysis artifact handlers.

local D27_MAX_CHANNELS = 64
local D27_MAX_ABS_SAMPLE = 1024
local D27_DEFAULT_MAX_ANALYSIS_SECONDS = 120
local D27_MAX_ANALYSIS_SECONDS = 600
local D27_PEAK_BLOCK_FRAMES = 8192
local D27_SAMPLE_BLOCK_FRAMES = 2048

local D27_FROZEN_ERROR_CODES = {
  REQUEST_INVALID = true,
  OPERATION_NOT_FOUND = true,
  PACK_DISABLED = true,
  RISK_BLOCKED = true,
  PARAMS_INVALID = true,
  REF_INVALID = true,
  PROJECT_NOT_FOUND = true,
  TRACK_NOT_FOUND = true,
  ITEM_NOT_FOUND = true,
  TAKE_NOT_FOUND = true,
  FX_NOT_FOUND = true,
  FX_OWNER_NOT_FOUND = true,
  FX_SLOT_NOT_FOUND = true,
  FX_REF_NOT_FOUND = true,
  FX_PARAMETER_INVALID = true,
  FX_PARAMETER_NOT_FOUND = true,
  SEND_NOT_FOUND = true,
  ENVELOPE_NOT_FOUND = true,
  MARKER_NOT_FOUND = true,
  REGION_NOT_FOUND = true,
  FILE_NOT_FOUND = true,
  JOB_NOT_FOUND = true,
  ARTIFACT_NOT_FOUND = true,
  ARTIFACT_INVALID = true,
  ACTION_NOT_ALLOWED = true,
  COMMAND_FAILED = true,
  JOB_FAILED = true,
  VERIFY_FAILED = true,
  RESPONSE_TOO_LARGE = true,
  IDEMPOTENCY_CONFLICT = true,
  QUEUE_CONFLICT = true,
  BRIDGE_NOT_RUNNING = true,
  BRIDGE_TIMEOUT = true,
  BRIDGE_OWNER_MISMATCH = true,
  BRIDGE_GENERATION_MISMATCH = true,
  INTERNAL_ERROR = true,
}

local D27_PARAM_REASON_CODES = {
  ANALYSIS_RANGE_UNSUPPORTED = true,
  EMPTY_RANGE = true,
  AUDIO_SOURCE_UNSUPPORTED = true,
  AUDIO_CHANNELS_UNSUPPORTED = true,
  MIDI_UNSUPPORTED = true,
}

local function d27_analysis_error(code, message, details, recoverable)
  local reason_code = type(code) == "string" and code or "UNKNOWN_D27_FAILURE"
  local public_code = reason_code
  if not D27_FROZEN_ERROR_CODES[reason_code] then
    public_code = D27_PARAM_REASON_CODES[reason_code] and "PARAMS_INVALID" or "COMMAND_FAILED"
  end
  details = type(details) == "table" and details or {}
  if public_code ~= reason_code and details.reason_code == nil then
    details.reason_code = reason_code
  end
  return {
    code = public_code,
    message = message,
    recoverable = recoverable ~= false,
    details = details,
  }
end

local function d27_analysis_number(value)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return nil
end

local function d27_analysis_linear_to_db(value)
  if type(value) ~= "number" or value <= 0 then
    return -150
  end
  return 20 * math.log(value) / math.log(10)
end

local function d27_analysis_db_to_linear(value)
  if type(value) ~= "number" or value <= -150 then
    return 0
  end
  return 10 ^ (value / 20)
end

local function d27_analysis_param_number(params, name, default_value, minimum, maximum, integer)
  local value = params[name]
  if value == nil then
    return default_value, nil
  end
  value = d27_analysis_number(value)
  if value == nil or (integer and value ~= math.floor(value)) then
    return nil, d27_analysis_error("PARAMS_INVALID", "Item audio analysis input must be a finite number.", {
      field = name,
    })
  end
  if (minimum ~= nil and value < minimum) or (maximum ~= nil and value > maximum) then
    return nil, d27_analysis_error("PARAMS_INVALID", "Item audio analysis input is outside the supported range.", {
      field = name,
      minimum = minimum,
      maximum = maximum,
      actual = value,
    })
  end
  return value, nil
end

local function d27_analysis_item_guid(item)
  local ok_native, _, native_guid = call_reaper("GetSetMediaItemInfo_String", item, "GUID", "", false)
  if ok_native and type(native_guid) == "string" and native_guid ~= "" then
    return native_guid
  end
  return nil
end

local function d27_analysis_find_item_by_guid(guid)
  local ok_count, count = call_reaper("CountMediaItems", 0)
  local total = ok_count and math.max(0, math.floor(first_number(count) or 0)) or 0
  for index = 0, total - 1 do
    local ok_item, item = call_reaper("GetMediaItem", 0, index)
    if ok_item and item and d27_analysis_item_guid(item) == guid then
      return item
    end
  end
  return nil
end

local function d27_analysis_resolve_item_token(token)
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
    return d27_analysis_find_item_by_guid(guid)
  end
  return nil
end

local function d27_analysis_resolve_item_from_ref_object(ref)
  if not is_object(ref) or ref.kind ~= "item" then
    return nil
  end
  local identity = is_object(ref.identity) and ref.identity or {}
  if identity.scheme == "selected" then
    return d27_analysis_resolve_item_token("selected:" .. tostring(identity.value))
  elseif identity.scheme == "index" then
    return d27_analysis_resolve_item_token("index:" .. tostring(identity.value))
  elseif identity.scheme == "guid" then
    return d27_analysis_resolve_item_token("guid:" .. tostring(identity.value))
  end
  return d27_analysis_resolve_item_token(ref.ref)
end

local function d27_analysis_item_from_request_refs(request)
  if is_json_array(request.refs) then
    for index = 1, #request.refs do
      local item = d27_analysis_resolve_item_from_ref_object(request.refs[index])
      if item then
        return item
      end
    end
  end
  return nil
end

local function d27_analysis_api_number(api_name, object, key)
  local ok, value = call_reaper(api_name, object, key)
  value = ok and d27_analysis_number(first_number(value)) or nil
  if value == nil then
    return nil, d27_analysis_error("ANALYSIS_READ_FAILED", "REAPER did not return required item/take analysis metadata.", {
      api = api_name,
      key = key,
    }, false)
  end
  return value, nil
end

local function d27_analysis_paths_match(expected, actual)
  if type(expected) ~= "string" or expected == "" or type(actual) ~= "string" or actual == "" then
    return false
  end
  if type(READ_B_MEDIA) == "table" and type(READ_B_MEDIA.canonical_path) == "function" then
    local expected_path = READ_B_MEDIA.canonical_path(expected)
    local actual_path = READ_B_MEDIA.canonical_path(actual)
    if expected_path and actual_path then
      return expected_path == actual_path
    end
  end
  return expected == actual
end

local function d27_analysis_probe_source_metadata(source_filename, source_type, current)
  local needs_probe = current.sample_rate == nil or current.sample_rate <= 0
    or current.channels == nil or current.channels < 1
    or current.source_length == nil or current.source_length <= 0
  if not needs_probe then
    return current, nil
  end

  local diagnostics = {
    attempted = false,
    path = source_filename,
    attached_source_type = source_type,
  }
  if source_filename == "" or type(file_exists) ~= "function" or not file_exists(source_filename) then
    diagnostics.blocker = "source_file_unavailable_for_native_probe"
    return current, diagnostics
  end
  diagnostics.attempted = true

  local ok_probe, probe_source = call_reaper("PCM_Source_CreateFromFile", source_filename)
  if not ok_probe or not probe_source then
    diagnostics.blocker = "native_probe_create_failed"
    return current, diagnostics
  end

  local ok_filename, filename_value = call_reaper("GetMediaSourceFileName", probe_source, "")
  local ok_type, type_value = call_reaper("GetMediaSourceType", probe_source, "")
  local ok_length, length_value, length_is_qn = call_reaper("GetMediaSourceLength", probe_source)
  local ok_rate, rate_value = call_reaper("GetMediaSourceSampleRate", probe_source)
  local ok_channels, channels_value = call_reaper("GetMediaSourceNumChannels", probe_source)
  local filename = ok_filename and type(filename_value) == "string" and filename_value or ""
  local fresh_type = ok_type and type(type_value) == "string" and type_value or ""
  local fresh_length = ok_length and d27_analysis_number(first_number(length_value)) or nil
  local fresh_rate = ok_rate and d27_analysis_number(first_number(rate_value)) or nil
  local fresh_channels = ok_channels and d27_analysis_number(first_number(channels_value)) or nil
  diagnostics.native = {
    filename = filename,
    source_type = fresh_type,
    source_length = fresh_length,
    source_length_is_qn = length_is_qn == true,
    sample_rate = fresh_rate or 0,
    channels = fresh_channels or 0,
    api_status = {
      GetMediaSourceFileName = ok_filename == true,
      GetMediaSourceType = ok_type == true,
      GetMediaSourceLength = ok_length == true,
      GetMediaSourceSampleRate = ok_rate == true,
      GetMediaSourceNumChannels = ok_channels == true,
    },
  }
  local valid = d27_analysis_paths_match(source_filename, filename)
    and source_type ~= "" and fresh_type == source_type
    and fresh_length ~= nil and fresh_length > 0 and length_is_qn ~= true
    and fresh_rate ~= nil and fresh_rate > 0 and fresh_rate == math.floor(fresh_rate)
    and fresh_channels ~= nil and fresh_channels >= 1 and fresh_channels == math.floor(fresh_channels)
    and fresh_channels <= D27_MAX_CHANNELS

  local ok_destroy = call_reaper("PCM_Source_Destroy", probe_source)
  diagnostics.destroy_ok = ok_destroy == true
  if not ok_destroy then
    diagnostics.blocker = "native_probe_destroy_failed"
    return nil, d27_analysis_error("ANALYSIS_READ_FAILED", "REAPER did not release the temporary native source probe.", {
      api = "PCM_Source_Destroy",
      probe = diagnostics,
    }, false)
  end
  if not valid then
    diagnostics.blocker = "native_probe_identity_or_metadata_invalid"
    return current, diagnostics
  end
  diagnostics.accepted = true
  return {
    sample_rate = fresh_rate,
    channels = fresh_channels,
    source_length = fresh_length,
    source_length_is_qn = false,
  }, diagnostics
end

local function d27_analysis_context(request)
  local item = d27_analysis_item_from_request_refs(request)
  if not item then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item audio analysis requires a resolvable item ref.", {})
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return nil, d27_analysis_error("TAKE_NOT_FOUND", "Item audio analysis requires an active take.", {})
  end
  local ok_source, source = call_reaper("GetMediaItemTake_Source", take)
  if not ok_source or not source then
    return nil, d27_analysis_error("SOURCE_NOT_FOUND", "The active take has no readable media source.", {})
  end
  local ok_midi, is_midi = call_reaper("TakeIsMIDI", take)
  if ok_midi and is_midi == true then
    return nil, d27_analysis_error("MIDI_UNSUPPORTED", "Audio analysis and batch processing do not support MIDI Items.", {
      typed_truth = "MIDI_UNSUPPORTED",
    }, false)
  end

  local item_summary = read_item_summary({
    refs = request.refs,
    params = { include_take_summary = true },
    budget = request.budget,
  })
  if not item_summary then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item summary readback failed before audio analysis.", {})
  end

  local item_position, position_failure = d27_analysis_api_number("GetMediaItemInfo_Value", item, "D_POSITION")
  if not item_position then return nil, position_failure end
  local item_length, length_failure = d27_analysis_api_number("GetMediaItemInfo_Value", item, "D_LENGTH")
  if not item_length then return nil, length_failure end
  item_length = math.max(0, item_length)
  local loop_source, loop_failure = d27_analysis_api_number("GetMediaItemInfo_Value", item, "B_LOOPSRC")
  if not loop_source then return nil, loop_failure end
  local take_start_offset, offset_failure = d27_analysis_api_number("GetMediaItemTakeInfo_Value", take, "D_STARTOFFS")
  if not take_start_offset then return nil, offset_failure end
  local take_playrate, playrate_failure = d27_analysis_api_number("GetMediaItemTakeInfo_Value", take, "D_PLAYRATE")
  if not take_playrate then return nil, playrate_failure end
  if take_playrate <= 0 then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "The active take playrate is not positive.", {
      playrate = take_playrate,
    }, false)
  end
  local take_reverse, reverse_failure = d27_analysis_api_number("GetMediaItemTakeInfo_Value", take, "B_REVERSE")
  if not take_reverse then return nil, reverse_failure end
  local ok_stretch_markers, stretch_marker_count = call_reaper("GetTakeNumStretchMarkers", take)
  stretch_marker_count = ok_stretch_markers and d27_analysis_number(first_number(stretch_marker_count)) or nil
  if stretch_marker_count == nil or stretch_marker_count < 0 or stretch_marker_count ~= math.floor(stretch_marker_count) then
    return nil, d27_analysis_error("ANALYSIS_READ_FAILED", "REAPER did not return the active take stretch-marker count.", {
      api = "GetTakeNumStretchMarkers",
    }, false)
  end

  local params = is_object(request.params) and request.params or {}
  local start_seconds, start_failure = d27_analysis_param_number(params, "start_seconds", 0, 0, nil, false)
  if start_seconds == nil then return nil, start_failure end
  local requested_end, end_failure = d27_analysis_param_number(params, "end_seconds", item_length, 0, nil, false)
  if requested_end == nil then return nil, end_failure end
  if requested_end <= start_seconds then
    return nil, d27_analysis_error("EMPTY_RANGE", "Item audio analysis end must be after start.", {
      start_seconds = start_seconds,
      end_seconds = requested_end,
    })
  end
  if start_seconds >= item_length then
    return nil, d27_analysis_error("EMPTY_RANGE", "Item audio analysis start is outside the item.", {
      item_length_seconds = item_length,
      start_seconds = start_seconds,
      end_seconds = requested_end,
    })
  end
  local end_seconds = math.min(item_length, requested_end)
  if end_seconds <= start_seconds then
    return nil, d27_analysis_error("EMPTY_RANGE", "Item audio analysis range is empty after applying item bounds.", {
      item_length_seconds = item_length,
      start_seconds = start_seconds,
      end_seconds = requested_end,
    })
  end

  local ok_rate, sample_rate = call_reaper("GetMediaSourceSampleRate", source)
  sample_rate = ok_rate and d27_analysis_number(first_number(sample_rate)) or nil
  local ok_channels, channels = call_reaper("GetMediaSourceNumChannels", source)
  channels = ok_channels and d27_analysis_number(first_number(channels)) or nil
  local ok_type, source_type_value = call_reaper("GetMediaSourceType", source, "")
  local source_type = ok_type and type(source_type_value) == "string" and source_type_value ~= ""
    and source_type_value or "unknown"
  local ok_filename, source_filename_value = call_reaper("GetMediaSourceFileName", source, "")
  local source_filename = ok_filename and type(source_filename_value) == "string" and source_filename_value or ""
  local ok_source_length, source_length_value, length_is_qn = call_reaper("GetMediaSourceLength", source)
  local source_length = ok_source_length and d27_analysis_number(first_number(source_length_value)) or nil
  if source_length ~= nil and source_length < 0 then source_length = nil end
  local source_diagnostics = {
    item_ref = item_summary.item_ref,
    take_ref = item_summary.active_take_ref,
    source_type = source_type,
    source_filename = source_filename,
    source_length = source_length,
    source_length_is_qn = length_is_qn == true,
    sample_rate = sample_rate or 0,
    channels = channels or 0,
    api_status = {
      GetMediaSourceSampleRate = ok_rate == true,
      GetMediaSourceNumChannels = ok_channels == true,
      GetMediaSourceType = ok_type == true,
      GetMediaSourceFileName = ok_filename == true,
      GetMediaSourceLength = ok_source_length == true,
    },
  }
  local source_metadata, source_probe = d27_analysis_probe_source_metadata(source_filename, source_type, {
    sample_rate = sample_rate,
    channels = channels,
    source_length = source_length,
  })
  if not source_metadata then
    return nil, source_probe
  end
  if source_probe then
    sample_rate = source_metadata.sample_rate
    channels = source_metadata.channels
    source_length = source_metadata.source_length
    length_is_qn = source_metadata.source_length_is_qn
    source_diagnostics.fresh_source_probe = source_probe
  end
  source_diagnostics.sample_rate = sample_rate or 0
  source_diagnostics.channels = channels or 0
  source_diagnostics.source_length = source_length
  source_diagnostics.source_length_is_qn = length_is_qn == true
  if sample_rate == nil or sample_rate <= 0 or sample_rate ~= math.floor(sample_rate) then
    return nil, d27_analysis_error("AUDIO_SOURCE_UNSUPPORTED", "Item audio analysis requires an audio source with a native sample rate.", {
      api = "GetMediaSourceSampleRate",
      source = source_diagnostics,
    }, false)
  end
  if channels == nil or channels < 1 or channels ~= math.floor(channels) or channels > D27_MAX_CHANNELS then
    return nil, d27_analysis_error("AUDIO_CHANNELS_UNSUPPORTED", "Item audio analysis requires a bounded native source channel count.", {
      api = "GetMediaSourceNumChannels",
      source = source_diagnostics,
      maximum = D27_MAX_CHANNELS,
    }, false)
  end

  return {
    request = request,
    params = params,
    item = item,
    take = take,
    source = source,
    item_summary = item_summary,
    item_ref = item_summary.item_ref,
    item_position = item_position,
    item_length = item_length,
    loop_source = loop_source > 0.5,
    take_start_offset = take_start_offset,
    take_playrate = take_playrate,
    take_reverse = take_reverse > 0.5,
    stretch_marker_count = stretch_marker_count,
    start_seconds = start_seconds,
    end_seconds = end_seconds,
    requested_end_seconds = requested_end,
    input_range_clamped = requested_end > item_length,
    sample_rate = sample_rate,
    channels = channels,
    source_type = source_type,
    source_length = source_length,
    source_length_is_qn = length_is_qn == true,
  }, nil
end

local function d27_analysis_limited_range(context, default_limit)
  local limit = default_limit
  if context.params.max_analysis_seconds ~= nil then
    local parsed, failure = d27_analysis_param_number(
      context.params,
      "max_analysis_seconds",
      default_limit,
      0.001,
      D27_MAX_ANALYSIS_SECONDS,
      false
    )
    if parsed == nil then return nil, failure end
    limit = parsed
  end
  local requested_duration = context.end_seconds - context.start_seconds
  local duration = limit and math.min(requested_duration, limit) or requested_duration
  return {
    start_seconds = context.start_seconds,
    end_seconds = context.start_seconds + duration,
    duration_seconds = duration,
    requested_duration_seconds = requested_duration,
    duration_limited = duration < requested_duration,
  }, nil
end

local function d27_analysis_source_bounds(context, local_start, local_end)
  if context.take_reverse then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "D27 native analysis does not claim reversed-take item-local bounds.", {
      reverse = true,
    }, false)
  end
  if context.stretch_marker_count > 0 then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "D27 native analysis does not claim non-linear stretch-marker bounds.", {
      stretch_marker_count = context.stretch_marker_count,
    }, false)
  end
  if context.source_length == nil then
    return nil, d27_analysis_error("ANALYSIS_READ_FAILED", "REAPER did not return the source length required to prove a contiguous item-local range.", {
      api = "GetMediaSourceLength",
      source_type = context.source_type,
    }, false)
  end
  local source_start = context.take_start_offset + (local_start * context.take_playrate)
  local source_end = context.take_start_offset + (local_end * context.take_playrate)
  if source_start < 0 or source_end <= source_start then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "The item-local range does not map to a valid contiguous source range.", {
      source_start_seconds = source_start,
      source_end_seconds = source_end,
    }, false)
  end
  if context.source_length_is_qn then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "Beat-based source bounds cannot prove a contiguous native audio range.", {
      source_type = context.source_type,
    }, false)
  end
  if context.source_length and source_end > context.source_length + 0.000001 then
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "The requested item range wraps or exceeds the contiguous source media.", {
      loop_source = context.loop_source,
      source_length_seconds = context.source_length,
      source_start_seconds = source_start,
      source_end_seconds = source_end,
    }, false)
  end
  return {
    start_seconds = source_start,
    end_seconds = context.source_length and math.min(source_end, context.source_length) or source_end,
  }, nil
end

local function d27_analysis_normalization_metric(context, local_start, local_end, normalize_to, metric_name)
  local source_range, range_failure = d27_analysis_source_bounds(context, local_start, local_end)
  if not source_range then return nil, range_failure end
  local ok, adjustment = call_reaper(
    "CalculateNormalization",
    context.source,
    normalize_to,
    0,
    source_range.start_seconds,
    source_range.end_seconds
  )
  adjustment = ok and d27_analysis_number(first_number(adjustment)) or nil
  if adjustment == nil or adjustment <= 0 then
    return nil, d27_analysis_error("NATIVE_ANALYSIS_FAILED", "REAPER native normalization did not return a valid adjustment.", {
      api = "CalculateNormalization",
      metric = metric_name,
      normalize_to = normalize_to,
      adjustment = adjustment or 0,
    }, false)
  end
  local measured_db = -d27_analysis_linear_to_db(adjustment)
  if measured_db < -300 or measured_db > 60 then
    return nil, d27_analysis_error("ANALYSIS_RESULT_INVALID", "REAPER native normalization returned a physically implausible level.", {
      api = "CalculateNormalization",
      metric = metric_name,
      measured_db = measured_db,
      adjustment = adjustment,
    }, false)
  end
  return {
    value_db = measured_db,
    adjustment_to_zero = adjustment,
    source_range = source_range,
  }, nil
end

local function d27_analysis_measure_levels(context, range)
  local rms, rms_failure = d27_analysis_normalization_metric(
    context,
    range.start_seconds,
    range.end_seconds,
    1,
    "rms_i"
  )
  if not rms then return nil, rms_failure end
  local lufs, lufs_failure = d27_analysis_normalization_metric(
    context,
    range.start_seconds,
    range.end_seconds,
    0,
    "lufs_i"
  )
  if not lufs then return nil, lufs_failure end
  return {
    rms_dbfs = rms.value_db,
    rms_linear = d27_analysis_db_to_linear(rms.value_db),
    lufs_i = lufs.value_db,
    source_range = rms.source_range,
    native_adjustments = {
      rms_i_to_zero = rms.adjustment_to_zero,
      lufs_i_to_zero = lufs.adjustment_to_zero,
    },
  }, nil
end

local function d27_analysis_required_sample(value, api_name, frame, channel)
  value = d27_analysis_number(value)
  if value == nil or math.abs(value) > D27_MAX_ABS_SAMPLE then
    return nil, d27_analysis_error("ANALYSIS_RESULT_INVALID", "REAPER returned a missing or physically implausible sample value.", {
      api = api_name,
      frame = frame,
      channel = channel,
      maximum_abs_sample = D27_MAX_ABS_SAMPLE,
      actual = value or 0,
    }, false)
  end
  return value, nil
end

local function d27_analysis_peak_scan(context, range)
  local total_frames = math.floor((range.duration_seconds * context.sample_rate) + 0.000000001)
  if total_frames < 1 then
    return nil, d27_analysis_error("EMPTY_RANGE", "Native peak analysis range is shorter than one source sample frame.", {
      duration_seconds = range.duration_seconds,
      sample_rate = context.sample_rate,
    })
  end
  local frame_offset = 0
  local short_read = false
  local positive_peak = 0
  local negative_peak = 0
  local abs_peak = 0
  local per_channel = {}
  for channel = 1, context.channels do
    per_channel[channel] = {
      channel = channel,
      positive_peak_linear = 0,
      negative_peak_linear = 0,
      abs_peak_linear = 0,
    }
  end

  while frame_offset < total_frames do
    local requested_frames = math.min(D27_PEAK_BLOCK_FRAMES, total_frames - frame_offset)
    local ok_buffer, buffer = call_reaper("new_array", requested_frames * context.channels * 2)
    if not ok_buffer or not buffer then
      return nil, d27_analysis_error("AUDIO_BUFFER_UNAVAILABLE", "REAPER did not allocate a native peak buffer.", {}, false)
    end
    local ok_peaks, raw_return = call_reaper(
      "GetMediaItemTake_Peaks",
      context.take,
      context.sample_rate,
      context.item_position + range.start_seconds + (frame_offset / context.sample_rate),
      context.channels,
      requested_frames,
      0,
      buffer
    )
    local return_value = ok_peaks and d27_analysis_number(first_number(raw_return)) or nil
    if return_value == nil or return_value < 0 then
      return nil, d27_analysis_error("NATIVE_ANALYSIS_FAILED", "REAPER rejected native active-take peak analysis.", {
        api = "GetMediaItemTake_Peaks",
      }, false)
    end
    local returned_frames = math.floor(return_value) % 1048576
    if returned_frames > requested_frames then
      return nil, d27_analysis_error("ANALYSIS_RESULT_INVALID", "REAPER native peak analysis returned an impossible frame count.", {
        requested_frames = requested_frames,
        returned_frames = returned_frames,
      }, false)
    end
    if returned_frames == 0 then
      short_read = true
      break
    end
    local values = nil
    if type(buffer.table) == "function" then
      local ok_table, table_values = pcall(function() return buffer.table() end)
      if ok_table and type(table_values) == "table" then values = table_values end
    end
    if not values then
      return nil, d27_analysis_error("AUDIO_BUFFER_UNAVAILABLE", "REAPER native peak buffer was not readable.", {}, false)
    end
    local block_values = returned_frames * context.channels
    for frame = 0, returned_frames - 1 do
      for channel = 1, context.channels do
        local index = (frame * context.channels) + channel
        local maximum, maximum_failure = d27_analysis_required_sample(
          values[index],
          "GetMediaItemTake_Peaks",
          frame_offset + frame,
          channel
        )
        if maximum == nil then return nil, maximum_failure end
        local minimum, minimum_failure = d27_analysis_required_sample(
          values[block_values + index],
          "GetMediaItemTake_Peaks",
          frame_offset + frame,
          channel
        )
        if minimum == nil then return nil, minimum_failure end
        if minimum > maximum then
          return nil, d27_analysis_error("ANALYSIS_RESULT_INVALID", "REAPER native peak minimum exceeded its maximum.", {
            frame = frame_offset + frame,
            channel = channel,
            minimum = minimum,
            maximum = maximum,
          }, false)
        end
        if maximum > positive_peak then positive_peak = maximum end
        if minimum < negative_peak then negative_peak = minimum end
        local frame_abs = math.max(math.abs(maximum), math.abs(minimum))
        if frame_abs > abs_peak then abs_peak = frame_abs end
        local channel_row = per_channel[channel]
        if maximum > channel_row.positive_peak_linear then channel_row.positive_peak_linear = maximum end
        if minimum < channel_row.negative_peak_linear then channel_row.negative_peak_linear = minimum end
        if frame_abs > channel_row.abs_peak_linear then channel_row.abs_peak_linear = frame_abs end
      end
    end
    frame_offset = frame_offset + returned_frames
    if returned_frames < requested_frames then
      short_read = true
      break
    end
  end

  if frame_offset == 0 then
    return nil, d27_analysis_error("NATIVE_ANALYSIS_FAILED", "REAPER native active-take peak analysis returned no peak frames.", {
      api = "GetMediaItemTake_Peaks",
    }, false)
  end
  for channel = 1, #per_channel do
    per_channel[channel].abs_peak_dbfs = d27_analysis_linear_to_db(per_channel[channel].abs_peak_linear)
  end
  local duration_seconds = frame_offset / context.sample_rate
  local truncated = context.input_range_clamped or range.duration_limited or short_read
  local truncation_reason = "none"
  if short_read then
    truncation_reason = "native_peak_short_read"
  elseif range.duration_limited then
    truncation_reason = "analysis_duration_limit"
  elseif context.input_range_clamped then
    truncation_reason = "item_range_clamped"
  end
  return {
    start_seconds = range.start_seconds,
    end_seconds = range.start_seconds + duration_seconds,
    duration_seconds = duration_seconds,
    sample_frames = frame_offset,
    positive_peak_linear = positive_peak,
    negative_peak_linear = negative_peak,
    abs_peak_linear = abs_peak,
    abs_peak_dbfs = d27_analysis_linear_to_db(abs_peak),
    per_channel = json_array(per_channel),
    truncated = truncated,
    coverage = {
      requested_start_seconds = context.start_seconds,
      requested_end_seconds = context.requested_end_seconds,
      available_end_seconds = context.end_seconds,
      analyzed_start_seconds = range.start_seconds,
      analyzed_end_seconds = range.start_seconds + duration_seconds,
      requested_sample_frames = total_frames,
      analyzed_sample_frames = frame_offset,
      sample_rate = context.sample_rate,
      source_channels = context.channels,
      analyzed_channels = context.channels,
      range_complete = not truncated,
      channel_coverage_complete = true,
      truncated = truncated,
      truncation_reason = truncation_reason,
    },
  }, nil
end

local function d27_analysis_bounded_rows(context, field, default_value, maximum)
  local value, failure = d27_analysis_param_number(context.params, field, default_value, 1, maximum, true)
  if value == nil then return nil, failure end
  local budget_items = is_object(context.request.budget) and d27_analysis_number(context.request.budget.max_items) or nil
  if budget_items and budget_items >= 1 then value = math.min(value, math.floor(budget_items)) end
  return value, nil
end

local function d27_analysis_sample_scan(context, range, options)
  options = options or {}
  local detect_silence = options.detect_silence == true
  local detect_transients = options.detect_transients == true
  local silence_threshold_dbfs = -60
  local min_silence_ms = 50
  local transient_delta_linear = 0.25
  local min_transient_gap_ms = 30
  local max_segments = 0
  local max_transients = 0
  if detect_silence then
    local silence_threshold_failure = nil
    silence_threshold_dbfs, silence_threshold_failure = d27_analysis_param_number(
      context.params,
      "silence_threshold_dbfs",
      silence_threshold_dbfs,
      -150,
      0,
      false
    )
    if silence_threshold_dbfs == nil then return nil, silence_threshold_failure end
    local min_silence_failure = nil
    min_silence_ms, min_silence_failure = d27_analysis_param_number(
      context.params,
      "min_silence_ms",
      min_silence_ms,
      0,
      60000,
      false
    )
    if min_silence_ms == nil then return nil, min_silence_failure end
    local segments_failure = nil
    max_segments, segments_failure = d27_analysis_bounded_rows(context, "max_segments", 64, 512)
    if max_segments == nil then return nil, segments_failure end
  end
  if detect_transients then
    local transient_failure = nil
    transient_delta_linear, transient_failure = d27_analysis_param_number(
      context.params,
      "transient_delta_linear",
      transient_delta_linear,
      0.000001,
      D27_MAX_ABS_SAMPLE,
      false
    )
    if transient_delta_linear == nil then return nil, transient_failure end
    local gap_failure = nil
    min_transient_gap_ms, gap_failure = d27_analysis_param_number(
      context.params,
      "min_transient_gap_ms",
      min_transient_gap_ms,
      0,
      60000,
      false
    )
    if min_transient_gap_ms == nil then return nil, gap_failure end
    local transients_failure = nil
    max_transients, transients_failure = d27_analysis_bounded_rows(context, "max_transients", 128, 1024)
    if max_transients == nil then return nil, transients_failure end
  end

  local source_range, source_range_failure = d27_analysis_source_bounds(
    context,
    range.start_seconds,
    range.end_seconds
  )
  if not source_range then return nil, source_range_failure end

  local ok_accessor, accessor = call_reaper("CreateTakeAudioAccessor", context.take)
  if not ok_accessor or not accessor then
    return nil, d27_analysis_error("AUDIO_ACCESSOR_UNAVAILABLE", "REAPER did not create a take audio accessor.", {}, false)
  end

  -- A take accessor is addressed on its own take-local timeline. Unlike a
  -- track accessor, its sample time must not include the item's project
  -- position. Ask REAPER for the readable take-local bounds and fail closed
  -- when the requested item-local range is not wholly available.
  local ok_accessor_start, accessor_start = call_reaper("GetAudioAccessorStartTime", accessor)
  accessor_start = ok_accessor_start and d27_analysis_number(first_number(accessor_start)) or nil
  local ok_accessor_end, accessor_end = call_reaper("GetAudioAccessorEndTime", accessor)
  accessor_end = ok_accessor_end and d27_analysis_number(first_number(accessor_end)) or nil
  if accessor_start == nil or accessor_end == nil or accessor_end <= accessor_start then
    call_reaper("DestroyAudioAccessor", accessor)
    return nil, d27_analysis_error("AUDIO_ACCESSOR_RANGE_INVALID", "REAPER did not return valid take-local audio accessor bounds.", {
      api_start = "GetAudioAccessorStartTime",
      api_end = "GetAudioAccessorEndTime",
      accessor_start_seconds = accessor_start or 0,
      accessor_end_seconds = accessor_end or 0,
    }, false)
  end
  local accessor_time_tolerance = 0.5 / context.sample_rate
  if range.start_seconds < accessor_start - accessor_time_tolerance
    or range.end_seconds > accessor_end + accessor_time_tolerance then
    call_reaper("DestroyAudioAccessor", accessor)
    return nil, d27_analysis_error("ANALYSIS_RANGE_UNSUPPORTED", "The requested item-local range is outside the readable take audio accessor bounds.", {
      coordinate_basis = "take_accessor_local_seconds",
      item_project_position_seconds = context.item_position,
      requested_start_seconds = range.start_seconds,
      requested_end_seconds = range.end_seconds,
      accessor_start_seconds = accessor_start,
      accessor_end_seconds = accessor_end,
    }, false)
  end

  local total_frames = math.floor((range.duration_seconds * context.sample_rate) + 0.000000001)
  if total_frames < 1 then
    call_reaper("DestroyAudioAccessor", accessor)
    return nil, d27_analysis_error("EMPTY_RANGE", "Sample analysis range is shorter than one source sample frame.", {
      duration_seconds = range.duration_seconds,
      sample_rate = context.sample_rate,
    })
  end
  local frame_offset = 0
  local silence_threshold = d27_analysis_db_to_linear(silence_threshold_dbfs)
  local min_silence_frames = math.floor(context.sample_rate * min_silence_ms / 1000)
  local min_transient_gap_frames = math.floor(context.sample_rate * min_transient_gap_ms / 1000)
  local silence_segments = json_array({})
  local silence_start = nil
  local total_silence_seconds = 0
  local total_silence_segments = 0
  local transients = json_array({})
  local total_transients = 0
  local last_transient_frame = -min_transient_gap_frames
  local previous_amp = 0
  local channel_sum_squares = {}
  for channel = 1, context.channels do channel_sum_squares[channel] = 0 end

  local function close_silence(end_frame)
    if silence_start == nil then return end
    local length_frames = end_frame - silence_start
    if length_frames >= min_silence_frames then
      local segment_start = range.start_seconds + (silence_start / context.sample_rate)
      local segment_end = range.start_seconds + (end_frame / context.sample_rate)
      total_silence_segments = total_silence_segments + 1
      total_silence_seconds = total_silence_seconds + (segment_end - segment_start)
      if #silence_segments < max_segments then
        silence_segments[#silence_segments + 1] = {
          start_seconds = segment_start,
          end_seconds = segment_end,
          duration_seconds = segment_end - segment_start,
        }
      end
    end
    silence_start = nil
  end

  while frame_offset < total_frames do
    local frames = math.min(D27_SAMPLE_BLOCK_FRAMES, total_frames - frame_offset)
    local accessor_sample_start = range.start_seconds + (frame_offset / context.sample_rate)
    local ok_buffer, buffer = call_reaper("new_array", frames * context.channels)
    if not ok_buffer or not buffer then
      call_reaper("DestroyAudioAccessor", accessor)
      return nil, d27_analysis_error("AUDIO_BUFFER_UNAVAILABLE", "REAPER did not allocate an audio sample buffer.", {}, false)
    end
    local ok_samples, raw_status = call_reaper(
      "GetAudioAccessorSamples",
      accessor,
      context.sample_rate,
      context.channels,
      accessor_sample_start,
      frames,
      buffer
    )
    local status = ok_samples and d27_analysis_number(first_number(raw_status)) or nil
    if status ~= 1 then
      call_reaper("DestroyAudioAccessor", accessor)
      local code = status == 0 and "AUDIO_SAMPLE_READ_EMPTY" or "AUDIO_SAMPLE_READ_FAILED"
      local message = status == 0
        and "REAPER returned no take audio for a range declared readable by the audio accessor."
        or "REAPER rejected audio accessor sample read."
      return nil, d27_analysis_error(code, message, {
        api = "GetAudioAccessorSamples",
        status = status or -1,
        coordinate_basis = "take_accessor_local_seconds",
        item_project_position_seconds = context.item_position,
        block_start_seconds = accessor_sample_start,
        block_end_seconds = accessor_sample_start + (frames / context.sample_rate),
        accessor_start_seconds = accessor_start,
        accessor_end_seconds = accessor_end,
      }, false)
    end
    local values = {}
    if type(buffer.table) == "function" then
      local ok_table, table_values = pcall(function() return buffer.table() end)
      if ok_table and type(table_values) == "table" then values = table_values end
    end
    for frame = 0, frames - 1 do
      local frame_peak = 0
      for channel = 1, context.channels do
        local index = (frame * context.channels) + channel
        local sample_failure
        local sample
        sample, sample_failure = d27_analysis_required_sample(
          values[index],
          "GetAudioAccessorSamples",
          frame_offset + frame,
          channel
        )
        if sample == nil then
          call_reaper("DestroyAudioAccessor", accessor)
          return nil, sample_failure
        end
        channel_sum_squares[channel] = channel_sum_squares[channel] + (sample * sample)
        local abs_sample = math.abs(sample)
        if abs_sample > frame_peak then frame_peak = abs_sample end
      end
      local absolute_frame = frame_offset + frame
      if detect_silence then
        if frame_peak <= silence_threshold then
          if silence_start == nil then silence_start = absolute_frame end
        else
          close_silence(absolute_frame)
        end
      end
      if detect_transients and frame_peak - previous_amp >= transient_delta_linear
        and absolute_frame - last_transient_frame >= min_transient_gap_frames then
        total_transients = total_transients + 1
        last_transient_frame = absolute_frame
        if #transients < max_transients then
          transients[#transients + 1] = {
            time_seconds = range.start_seconds + (absolute_frame / context.sample_rate),
            strength_linear = frame_peak - previous_amp,
          }
        end
      end
      if detect_transients then previous_amp = frame_peak end
    end
    frame_offset = frame_offset + frames
  end
  if detect_silence then close_silence(frame_offset) end
  call_reaper("DestroyAudioAccessor", accessor)

  local per_channel_rms = {}
  for channel = 1, context.channels do
    local linear = math.sqrt(channel_sum_squares[channel] / frame_offset)
    per_channel_rms[channel] = {
      channel = channel,
      rms_linear = linear,
      rms_dbfs = d27_analysis_linear_to_db(linear),
    }
  end
  local truncated = context.input_range_clamped
    or range.duration_limited
    or (detect_silence and total_silence_segments > #silence_segments)
    or (detect_transients and total_transients > #transients)
  local truncation_reason = "none"
  if range.duration_limited then
    truncation_reason = "analysis_duration_limit"
  elseif context.input_range_clamped then
    truncation_reason = "item_range_clamped"
  elseif (detect_silence and total_silence_segments > #silence_segments)
    or (detect_transients and total_transients > #transients) then
    truncation_reason = "artifact_row_limit"
  end
  return {
    start_seconds = range.start_seconds,
    end_seconds = range.start_seconds + (frame_offset / context.sample_rate),
    duration_seconds = frame_offset / context.sample_rate,
    sample_frames = frame_offset,
    silence_segments = silence_segments,
    total_silence_segments = total_silence_segments,
    total_silence_seconds = total_silence_seconds,
    threshold_dbfs = silence_threshold_dbfs,
    min_silence_ms = min_silence_ms,
    transients = transients,
    total_transients = total_transients,
    transient_delta_linear = transient_delta_linear,
    min_transient_gap_ms = min_transient_gap_ms,
    per_channel_rms = json_array(per_channel_rms),
    truncated = truncated,
    coverage = {
      requested_start_seconds = context.start_seconds,
      requested_end_seconds = context.requested_end_seconds,
      available_end_seconds = context.end_seconds,
      accessor_start_seconds = accessor_start,
      accessor_end_seconds = accessor_end,
      accessor_coordinate_basis = "take_accessor_local_seconds",
      source_start_seconds = source_range.start_seconds,
      source_end_seconds = source_range.end_seconds,
      analyzed_start_seconds = range.start_seconds,
      analyzed_end_seconds = range.start_seconds + (frame_offset / context.sample_rate),
      requested_sample_frames = total_frames,
      analyzed_sample_frames = frame_offset,
      sample_rate = context.sample_rate,
      source_channels = context.channels,
      analyzed_channels = context.channels,
      range_complete = not (context.input_range_clamped or range.duration_limited),
      channel_coverage_complete = true,
      result_rows_complete = (not detect_silence or total_silence_segments == #silence_segments)
        and (not detect_transients or total_transients == #transients),
      truncated = truncated,
      truncation_reason = truncation_reason,
    },
  }, nil
end

local function d27_analysis_measurement_details(context, basis)
  return {
    basis = basis,
    source_type = context.source_type,
    item_local_time = true,
    item_gain = "not_included",
    take_gain = "not_included",
    fades = "not_included",
    playrate = "bounds_mapped_only",
    pitch = "not_included",
    take_fx = "not_included",
    track_fx = "not_included",
  }
end

local function d27_analysis_write(request, operation_key, summary, payload)
  local spec = A1_ARTIFACT_SPECS[operation_key]
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return nil, d27_analysis_error(failure.code, failure.message, failure.details)
  end
  summary.artifact_ref = write.object_ref.ref
  summary.schema = spec.schema
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function measure_item_rms(request)
  local context, context_failure = d27_analysis_context(request)
  if not context then return nil, context_failure end
  local range, range_failure = d27_analysis_limited_range(context, nil)
  if not range then return nil, range_failure end
  local levels, levels_failure = d27_analysis_measure_levels(context, range)
  if not levels then return nil, levels_failure end
  local truncated = context.input_range_clamped or range.duration_limited
  local coverage = {
    requested_start_seconds = context.start_seconds,
    requested_end_seconds = context.requested_end_seconds,
    available_end_seconds = context.end_seconds,
    analyzed_start_seconds = range.start_seconds,
    analyzed_end_seconds = range.end_seconds,
    source_start_seconds = levels.source_range.start_seconds,
    source_end_seconds = levels.source_range.end_seconds,
    sample_rate = context.sample_rate,
    source_channels = context.channels,
    analyzed_channels = context.channels,
    analyzed_sample_frames = math.floor(range.duration_seconds * context.sample_rate),
    range_complete = not truncated,
    channel_coverage_complete = true,
    truncated = truncated,
    truncation_reason = context.input_range_clamped and "item_range_clamped"
      or (range.duration_limited and "analysis_duration_limit" or "none"),
  }
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_rms.v1",
    item_ref = context.item_ref,
    rms_dbfs = levels.rms_dbfs,
    rms_linear = levels.rms_linear,
    lufs_i = levels.lufs_i,
    duration_seconds = range.duration_seconds,
    sample_frames = coverage.analyzed_sample_frames,
    sample_rate = context.sample_rate,
    channels = context.channels,
    measurement_basis = "source_media_calculate_normalization",
    truncated = truncated,
    coverage = coverage,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_rms", summary, {
    item = context.item_summary,
    metrics = summary,
    measurement = d27_analysis_measurement_details(context, summary.measurement_basis),
    native_api = {
      name = "CalculateNormalization",
      modes = json_array({ "RMS-I", "LUFS-I" }),
      adjustments_to_zero = levels.native_adjustments,
    },
    analysis_quality_claim = true,
  })
end

local function measure_item_peaks(request)
  local context, context_failure = d27_analysis_context(request)
  if not context then return nil, context_failure end
  local range, range_failure = d27_analysis_limited_range(context, D27_DEFAULT_MAX_ANALYSIS_SECONDS)
  if not range then return nil, range_failure end
  local peaks, peaks_failure = d27_analysis_peak_scan(context, range)
  if not peaks then return nil, peaks_failure end

  local source_peak = nil
  local true_peak = nil
  local true_peak_failure = nil
  local source_peak_failure = nil
  source_peak, source_peak_failure = d27_analysis_normalization_metric(
    context,
    peaks.start_seconds,
    peaks.end_seconds,
    2,
    "source_sample_peak"
  )
  if not source_peak_failure then
    true_peak, true_peak_failure = d27_analysis_normalization_metric(
      context,
      peaks.start_seconds,
      peaks.end_seconds,
      3,
      "source_true_peak"
    )
  end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_peaks.v1",
    item_ref = context.item_ref,
    abs_peak_dbfs = peaks.abs_peak_dbfs,
    abs_peak_linear = peaks.abs_peak_linear,
    positive_peak_linear = peaks.positive_peak_linear,
    negative_peak_linear = peaks.negative_peak_linear,
    source_sample_peak_dbfs = source_peak and source_peak.value_db or nil,
    true_peak_dbfs = true_peak and true_peak.value_db or nil,
    true_peak_available = true_peak ~= nil,
    per_channel = peaks.per_channel,
    duration_seconds = peaks.duration_seconds,
    sample_frames = peaks.sample_frames,
    sample_rate = context.sample_rate,
    channels = context.channels,
    measurement_basis = "active_take_native_peak_blocks",
    truncated = peaks.truncated,
    coverage = peaks.coverage,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_peaks", summary, {
    item = context.item_summary,
    metrics = summary,
    measurement = {
      basis = summary.measurement_basis,
      native_peak_api = "GetMediaItemTake_Peaks",
      source_normalization_api = "CalculateNormalization",
      sample_peak = "active_take_peak_blocks",
      source_sample_peak = source_peak and "source_media_normalization" or "unavailable",
      true_peak = true_peak and "source_media_normalization" or "unavailable",
      item_gain = "not_claimed",
      take_gain = "not_claimed",
      fades = "not_claimed",
      playrate = "active_take_peak_path",
      pitch = "not_claimed",
      take_fx = "not_claimed",
      track_fx = "not_included",
      native_source_metric_blocker = source_peak_failure and source_peak_failure.code or "none",
      native_true_peak_blocker = true_peak_failure and true_peak_failure.code or "none",
    },
    analysis_quality_claim = true,
  })
end

local function detect_item_silence(request)
  local context, context_failure = d27_analysis_context(request)
  if not context then return nil, context_failure end
  local range, range_failure = d27_analysis_limited_range(context, D27_DEFAULT_MAX_ANALYSIS_SECONDS)
  if not range then return nil, range_failure end
  local scan, scan_failure = d27_analysis_sample_scan(context, range, { detect_silence = true })
  if not scan then return nil, scan_failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_silence.v1",
    item_ref = context.item_ref,
    segment_count = #scan.silence_segments,
    returned_count = #scan.silence_segments,
    total_detected = scan.total_silence_segments,
    total_silence_seconds = scan.total_silence_seconds,
    truncated = scan.truncated,
    threshold_dbfs = scan.threshold_dbfs,
    sample_rate = context.sample_rate,
    channels = context.channels,
    measurement_basis = "active_take_audio_accessor_pre_fx_samples",
    coverage = scan.coverage,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_silence", summary, {
    item = context.item_summary,
    silence_segments = scan.silence_segments,
    threshold_dbfs = scan.threshold_dbfs,
    min_silence_ms = scan.min_silence_ms,
    per_channel_rms = scan.per_channel_rms,
    measurement = {
      basis = summary.measurement_basis,
      native_api = "GetAudioAccessorSamples",
      fx_posture = "immediately_pre_fx",
      channel_combination = "maximum_absolute_sample_per_frame",
      item_gain = "not_claimed",
      take_gain = "not_claimed",
      fades = "not_claimed",
      playrate = "active_take_accessor_path",
      pitch = "active_take_accessor_path",
      take_fx = "not_included",
      track_fx = "not_included",
    },
    analysis_quality_claim = false,
    heuristic = true,
  })
end

local function detect_item_transients(request)
  local context, context_failure = d27_analysis_context(request)
  if not context then return nil, context_failure end
  local range, range_failure = d27_analysis_limited_range(context, D27_DEFAULT_MAX_ANALYSIS_SECONDS)
  if not range then return nil, range_failure end
  local scan, scan_failure = d27_analysis_sample_scan(context, range, { detect_transients = true })
  if not scan then return nil, scan_failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_transients.v1",
    item_ref = context.item_ref,
    transient_count = #scan.transients,
    total_detected = scan.total_transients,
    truncated = scan.truncated,
    first_transient_time = #scan.transients > 0 and scan.transients[1].time_seconds or 0,
    last_transient_time = #scan.transients > 0 and scan.transients[#scan.transients].time_seconds or 0,
    transient_delta_linear = scan.transient_delta_linear,
    sample_rate = context.sample_rate,
    channels = context.channels,
    measurement_basis = "active_take_audio_accessor_pre_fx_samples",
    coverage = scan.coverage,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_transients", summary, {
    item = context.item_summary,
    transients = scan.transients,
    transient_delta_linear = scan.transient_delta_linear,
    min_transient_gap_ms = scan.min_transient_gap_ms,
    per_channel_rms = scan.per_channel_rms,
    measurement = {
      basis = summary.measurement_basis,
      native_api = "GetAudioAccessorSamples",
      fx_posture = "immediately_pre_fx",
      detector = "bounded_frame_peak_delta",
      confidence = "heuristic_threshold_crossing_only",
      item_gain = "not_claimed",
      take_gain = "not_claimed",
      fades = "not_claimed",
      playrate = "active_take_accessor_path",
      pitch = "active_take_accessor_path",
      take_fx = "not_included",
      track_fx = "not_included",
    },
    analysis_quality_claim = false,
    heuristic = true,
  })
end

local function d27_split_exact_item_ref(request)
  if not is_json_array(request.refs) then return nil end
  for index = 1, #request.refs do
    local ref = request.refs[index]
    if is_object(ref) and ref.kind == "item" and is_string(ref.ref) and is_object(ref.identity) then
      local guid = ref.ref:match("^item:guid:(.+)$")
      if guid and ref.identity.scheme == "guid" and tostring(ref.identity.value) == guid then
        return ref.ref, guid
      end
    end
  end
  return nil
end

local function d27_split_track_ref(track)
  local ok, guid = call_reaper("GetTrackGUID", track)
  guid = ok and first_string(guid) or nil
  if not guid or guid == "" then return nil end
  return "track:guid:" .. guid
end

local function d27_split_item_ref(item)
  local guid = d27_analysis_item_guid(item)
  if not guid then return nil end
  return "item:guid:" .. guid, guid
end

local function d27_split_object_ref(kind, ref)
  local scheme, value = ref:match("^[^:]+:([^:]+):(.+)$")
  return {
    kind = kind,
    ref = ref,
    identity = { scheme = scheme or "guid", value = tostring(value or "") },
  }
end

local function d27_split_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  value = ok and d27_analysis_number(first_number(value)) or nil
  return value
end

local function d27_split_matches_silence(midpoint, segments, tolerance)
  for index = 1, #segments do
    local segment = segments[index]
    if midpoint >= segment.start_seconds - tolerance and midpoint <= segment.end_seconds + tolerance then
      return true
    end
  end
  return false
end

-- The public Template keeps its accepted export name, while batch requests use
-- this shared REAPER-side core.  Target resolution and the complete plan stay
-- here so MCP never has to round-trip one Item or one silence fragment at a time.
local alpha33_silence_batch

local function d27_batch_checksum(source)
  local checksum = 0
  for index = 1, #source do
    checksum = (checksum * 131 + source:byte(index)) % 2147483647
  end
  return tostring(checksum)
end

local function d27_batch_number(params, field, default_value, minimum, maximum)
  local value = params[field]
  if value == nil then value = default_value end
  value = d27_analysis_number(value)
  if value == nil or (minimum ~= nil and value < minimum) or (maximum ~= nil and value > maximum) then
    return nil, d27_analysis_error("PARAMS_INVALID", "Audio batch parameter is outside the supported range.", {
      field = field,
      minimum = minimum,
      maximum = maximum,
      zero_write = true,
    })
  end
  return value, nil
end

local function d27_batch_fail(code, message, details)
  details = type(details) == "table" and details or {}
  details.zero_write = true
  return nil, d27_analysis_error(code, message, details)
end

local function d27_batch_preflight_failure(failure)
  if type(failure) == "table" then
    failure.details = type(failure.details) == "table" and failure.details or {}
    failure.details.zero_write = true
  end
  return nil, failure
end

local function d27_batch_ref_object(ref)
  if not is_string(ref) then return nil end
  local guid = ref:match("^item:guid:(.+)$")
  if not guid or guid == "" then return nil end
  return d27_split_object_ref("item", ref)
end

local function d27_batch_targets(request, params)
  local target = params.target
  local tokens = is_json_array(params.target_refs) and params.target_refs or nil
  local refs = json_array({})
  if tokens and #tokens > 64 then
    return d27_batch_fail("BATCH_LIMIT_EXCEEDED", "Audio batch accepts at most 64 exact Item targets; zero_write=true.", {
      target_count = #tokens,
      maximum = 64,
    })
  end
  if target == nil then target = tokens and #tokens > 0 and "exact" or "selected" end
  if target ~= "selected" and target ~= "exact" then
    return d27_batch_fail("PARAMS_INVALID", "Audio batch target must be selected or exact.")
  end
  if target == "exact" then
    if not tokens then
      tokens = json_array({})
      if is_json_array(request.refs) then
        for index = 1, #request.refs do
          local ref = request.refs[index]
          if is_object(ref) and ref.kind == "item" and is_string(ref.ref) then
            tokens[#tokens + 1] = ref.ref
          end
        end
      end
    end
    if #tokens < 1 or #tokens > 64 then
      return d27_batch_fail("BATCH_LIMIT_EXCEEDED", "Exact audio batch requires 1-64 Item targets; zero_write=true.", {
        target_count = #tokens,
        maximum = 64,
      })
    end
    local seen = {}
    for index = 1, #tokens do
      local token = tokens[index]
      local object_ref = d27_batch_ref_object(token)
      if not object_ref then
        return d27_batch_fail("REF_INVALID", "Exact audio batch accepts only item:guid refs; zero_write=true.", {
          target_order = index,
          ref = tostring(token),
        })
      end
      if seen[token] then
        return d27_batch_fail("REF_INVALID", "Exact audio batch rejects duplicate Item GUID refs; zero_write=true.", {
          target_order = index,
          ref = token,
        })
      end
      seen[token] = true
      local guid = token:match("^item:guid:(.+)$")
      local item = d27_analysis_find_item_by_guid(guid)
      if not item then
        return d27_batch_fail("ITEM_NOT_FOUND", "Exact audio batch could not resolve an Item GUID; zero_write=true.", {
          target_order = index,
          item_ref = token,
        })
      end
      refs[#refs + 1] = { item = item, item_ref = token, guid = guid, target_order = index }
    end
  else
    local ok_count, raw_count = call_reaper("CountSelectedMediaItems", 0)
    local count = ok_count and math.floor(first_number(raw_count) or -1) or -1
    if count < 0 or count > 64 then
      return d27_batch_fail("BATCH_LIMIT_EXCEEDED", "Selected audio batch requires 1-64 selected Items; zero_write=true.", {
        target_count = count,
        maximum = 64,
      })
    end
    if count < 1 then
      return d27_batch_fail("ITEM_NOT_FOUND", "Selected audio batch requires at least one selected Item; zero_write=true.", {
        target_count = 0,
      })
    end
    local seen = {}
    for index = 0, count - 1 do
      local ok_item, item = call_reaper("GetSelectedMediaItem", 0, index)
      local item_ref, guid = item and d27_split_item_ref(item) or nil, nil
      if item then item_ref, guid = d27_split_item_ref(item) end
      if not ok_item or not item or not item_ref then
        return d27_batch_fail("ITEM_NOT_FOUND", "Selected audio batch could not prove an exact selected Item GUID; zero_write=true.", {
          target_order = index + 1,
        })
      end
      if seen[item_ref] then
        return d27_batch_fail("REF_INVALID", "Selected audio batch resolved duplicate Item GUIDs; zero_write=true.", {
          target_order = index + 1,
          item_ref = item_ref,
        })
      end
      seen[item_ref] = true
      refs[#refs + 1] = { item = item, item_ref = item_ref, guid = guid, target_order = index + 1 }
    end
  end
  return refs, nil
end

local function d27_batch_scope_matches(scope, segment, item_length, tolerance)
  local leading = segment.start_seconds <= tolerance
  local trailing = segment.end_seconds >= item_length - tolerance
  if scope == "all" then return true end
  if scope == "leading" then return leading end
  if scope == "trailing" then return trailing end
  if scope == "edges" then return leading or trailing end
  return not leading and not trailing
end

local function d27_batch_ranges(scan, context, params)
  local scope = params.silence_scope or "all"
  local keep_before_ms, keep_before_failure = d27_batch_number(params, "keep_before_ms", 20, 0, 5000)
  if not keep_before_ms then return nil, keep_before_failure end
  local keep_after_ms, keep_after_failure = d27_batch_number(params, "keep_after_ms", 20, 0, 5000)
  if not keep_after_ms then return nil, keep_after_failure end
  local min_kept_ms, min_kept_failure = d27_batch_number(params, "min_kept_audio_ms", 80, 0, 60000)
  if not min_kept_ms then return nil, min_kept_failure end
  local tolerance = math.max(0.000001, 1 / context.sample_rate)
  local ranges = {}
  local all_silent = false
  local covered = 0
  for index = 1, #scan.silence_segments do
    local segment = scan.silence_segments[index]
    covered = covered + math.max(0, segment.end_seconds - segment.start_seconds)
  end
  if covered >= context.item_length - tolerance then
    all_silent = true
  end
  if not all_silent then
    for index = 1, #scan.silence_segments do
      local segment = scan.silence_segments[index]
      if d27_batch_scope_matches(scope, segment, context.item_length, tolerance) then
        local start_seconds = math.max(0, segment.start_seconds + (keep_before_ms / 1000))
        local end_seconds = math.min(context.item_length, segment.end_seconds - (keep_after_ms / 1000))
        if end_seconds > start_seconds + tolerance then
          ranges[#ranges + 1] = {
            start_seconds = start_seconds,
            end_seconds = end_seconds,
            source_start_seconds = segment.start_seconds,
            source_end_seconds = segment.end_seconds,
          }
        end
      end
    end
  end
  table.sort(ranges, function(left, right) return left.start_seconds < right.start_seconds end)
  local filtered = {}
  local cursor = 0
  for index = 1, #ranges do
    local range = ranges[index]
    local previous_audio = range.start_seconds - cursor
    local next_audio = context.item_length - range.end_seconds
    if previous_audio <= tolerance or previous_audio >= (min_kept_ms / 1000) - tolerance then
      if next_audio <= tolerance or next_audio >= (min_kept_ms / 1000) - tolerance then
        filtered[#filtered + 1] = range
        cursor = range.end_seconds
      end
    end
  end
  return filtered, nil, all_silent
end

local function d27_batch_checksum_plan(rows, params, operation)
  local parts = {
    operation,
    params.target or "selected",
    params.silence_scope or "all",
    tostring(params.silence_threshold_dbfs or -60),
    tostring(params.min_silence_ms or 250),
    tostring(params.keep_before_ms or 20),
    tostring(params.keep_after_ms or 20),
    tostring(params.min_kept_audio_ms or 80),
    tostring(params.fade_ms or 5),
    tostring(params.normalization_metric or ""),
    tostring(params.normalization_target or ""),
  }
  for index = 1, #rows do
    local row = rows[index]
    parts[#parts + 1] = table.concat({ row.item_ref, row.context.item_position, row.context.item_length }, ":")
    for _, segment in ipairs(row.scan and row.scan.silence_segments or {}) do
      parts[#parts + 1] = table.concat({ segment.start_seconds, segment.end_seconds }, ",")
    end
    for _, range in ipairs(row.ranges or {}) do
      parts[#parts + 1] = table.concat({ range.start_seconds, range.end_seconds }, ",")
    end
    if row.normalization then parts[#parts + 1] = tostring(row.normalization.adjustment) end
  end
  return "alpha33_silence_batch:" .. d27_batch_checksum(table.concat(parts, "|"))
end

local function d27_batch_owner_track(context)
  local ok_track, track = call_reaper("GetMediaItemTrack", context.item)
  if not ok_track or not track then ok_track, track = call_reaper("GetMediaItem_Track", context.item) end
  if not ok_track or not track then return nil end
  local ref = d27_split_track_ref(track)
  if not ref then return nil end
  return track, ref
end

local function d27_batch_fragments(context, boundaries)
  local fragments = {{ item = context.item, start_seconds = 0, end_seconds = context.item_length, guid = context.item_ref:match("^item:guid:(.+)$"), item_ref = context.item_ref }}
  local tolerance = math.max(0.000001, 1 / context.sample_rate)
  for _, boundary in ipairs(boundaries) do
    local split_index = nil
    for index = 1, #fragments do
      if boundary > fragments[index].start_seconds + tolerance and boundary < fragments[index].end_seconds - tolerance then
        split_index = index
        break
      end
    end
    if not split_index then return nil, d27_analysis_error("VERIFY_FAILED", "A planned silence boundary no longer mapped to a live Item fragment.", { boundary_seconds = boundary }) end
    local left = fragments[split_index]
    local ok_split, right_item = call_reaper("SplitMediaItem", left.item, context.item_position + boundary)
    if not ok_split or not right_item then return nil, d27_analysis_error("COMMAND_FAILED", "REAPER rejected a planned native Item split.", { boundary_seconds = boundary }) end
    local right_ref, right_guid = d27_split_item_ref(right_item)
    if not right_ref or right_guid == left.guid then return nil, d27_analysis_error("VERIFY_FAILED", "Native Item split did not return a unique GUID.", { boundary_seconds = boundary }) end
    local right = { item = right_item, start_seconds = boundary, end_seconds = left.end_seconds, guid = right_guid, item_ref = right_ref }
    left.end_seconds = boundary
    table.insert(fragments, split_index + 1, right)
  end
  return fragments, nil
end

local function d27_batch_is_removed(midpoint, ranges, tolerance)
  for _, range in ipairs(ranges) do
    if midpoint >= range.start_seconds - tolerance and midpoint <= range.end_seconds + tolerance then return true end
  end
  return false
end

local function d27_batch_apply_silence(row, params, counters)
  if #row.ranges == 0 then
    return {
      status = row.all_silent and "ALL_SILENT_RETAINED" or "UNCHANGED",
      code = row.all_silent and "ALL_SILENT_RETAINED" or nil,
      item_ref = row.item_ref,
      owner_track_ref = row.owner_track_ref,
      changed = false,
      source_media_deleted = false,
      removed_duration_seconds = 0,
      remaining_duration_seconds = row.context.item_length,
      silence_segment_count = #row.scan.silence_segments,
    }, nil
  end
  local boundaries = {}
  local seen = {}
  for _, range in ipairs(row.ranges) do
    for _, boundary in ipairs({ range.start_seconds, range.end_seconds }) do
      if boundary > 0 and boundary < row.context.item_length then
        local key = string.format("%.9f", boundary)
        if not seen[key] then seen[key] = true; boundaries[#boundaries + 1] = boundary end
      end
    end
  end
  table.sort(boundaries)
  local fragments, fragment_failure = d27_batch_fragments(row.context, boundaries)
  if not fragments then return nil, fragment_failure end
  local kept, deleted = {}, {}
  local tolerance = math.max(0.000001, 1 / row.context.sample_rate)
  for _, fragment in ipairs(fragments) do
    if d27_batch_is_removed((fragment.start_seconds + fragment.end_seconds) / 2, row.ranges, tolerance) then deleted[#deleted + 1] = fragment else kept[#kept + 1] = fragment end
  end
  if #kept == 0 then return nil, d27_analysis_error("ALL_SILENT_RETAINED", "The complete Item is silent; the source Item was retained and no mutation was applied.", { item_ref = row.item_ref, zero_write = true }) end
  local fade_seconds = (params.fade_ms or 5) / 1000
  for _, fragment in ipairs(deleted) do
    local ok_track, track = call_reaper("GetMediaItemTrack", fragment.item)
    if not ok_track or not track then ok_track, track = call_reaper("GetMediaItem_Track", fragment.item) end
    if not ok_track or track ~= row.owner_track then return nil, d27_analysis_error("VERIFY_FAILED", "A silence fragment changed Track before deletion.", { item_ref = fragment.item_ref }) end
    local ok_delete, deleted_ok = call_reaper("DeleteTrackMediaItem", row.owner_track, fragment.item)
    if not ok_delete or deleted_ok ~= true then return nil, d27_analysis_error("COMMAND_FAILED", "REAPER rejected a planned silence fragment deletion.", { item_ref = fragment.item_ref }) end
    counters.native_mutation_count = counters.native_mutation_count + 1
  end
  for _, fragment in ipairs(kept) do
    if fade_seconds > 0 then
      call_reaper("SetMediaItemInfo_Value", fragment.item, "D_FADEINLEN", math.min(fade_seconds, math.max(0, fragment.end_seconds - fragment.start_seconds) / 2))
      call_reaper("SetMediaItemInfo_Value", fragment.item, "D_FADEOUTLEN", math.min(fade_seconds, math.max(0, fragment.end_seconds - fragment.start_seconds) / 2))
    end
  end
  call_reaper("UpdateArrange")
  local remaining = 0
  local kept_refs = json_array({})
  for _, fragment in ipairs(kept) do
    local live = d27_analysis_find_item_by_guid(fragment.guid)
    local live_position = live and d27_split_number(live, "D_POSITION") or nil
    local live_length = live and d27_split_number(live, "D_LENGTH") or nil
    if not live or live_position == nil or live_length == nil then return nil, d27_analysis_error("VERIFY_FAILED", "A kept Item failed aggregate readback.", { item_ref = fragment.item_ref }) end
    remaining = remaining + live_length
    kept_refs[#kept_refs + 1] = fragment.item_ref
    counters.native_readback_count = counters.native_readback_count + 1
  end
  local deleted_refs = json_array({})
  local removed = 0
  for _, fragment in ipairs(deleted) do
    if d27_analysis_find_item_by_guid(fragment.guid) then return nil, d27_analysis_error("VERIFY_FAILED", "A deleted silence Item remained in the project.", { item_ref = fragment.item_ref }) end
    deleted_refs[#deleted_refs + 1] = fragment.item_ref
    removed = removed + fragment.end_seconds - fragment.start_seconds
    counters.native_readback_count = counters.native_readback_count + 1
  end
  return {
    status = "APPLIED",
    item_ref = row.item_ref,
    owner_track_ref = row.owner_track_ref,
    changed = true,
    source_media_deleted = false,
    kept_item_refs = kept_refs,
    deleted_item_refs = deleted_refs,
    silence_segment_count = #row.scan.silence_segments,
    split_count = #fragments - 1,
    delete_count = #deleted,
    removed_duration_seconds = removed,
    remaining_duration_seconds = remaining,
  }, nil
end

local function d27_batch_apply_normalization(row, params, counters)
  local take = row.context.take
  local current_ok, current_volume = call_reaper("GetMediaItemTakeInfo_Value", take, "D_VOL")
  current_volume = current_ok and d27_analysis_number(first_number(current_volume)) or nil
  if current_volume == nil then return nil, d27_analysis_error("VERIFY_FAILED", "Native Take volume could not be read before normalization.", { item_ref = row.item_ref }) end
  local new_volume = current_volume * row.normalization.adjustment
  if new_volume ~= new_volume or new_volume == math.huge or new_volume == -math.huge or new_volume < 0 then return nil, d27_analysis_error("ANALYSIS_RESULT_INVALID", "Native normalization returned an invalid Take volume.", { item_ref = row.item_ref }) end
  local set_ok = call_reaper("SetMediaItemTakeInfo_Value", take, "D_VOL", new_volume)
  if set_ok ~= true then return nil, d27_analysis_error("COMMAND_FAILED", "REAPER rejected native source/Take normalization.", { item_ref = row.item_ref }) end
  counters.native_mutation_count = counters.native_mutation_count + 1
  local read_ok, read_volume = call_reaper("GetMediaItemTakeInfo_Value", take, "D_VOL")
  read_volume = read_ok and d27_analysis_number(first_number(read_volume)) or nil
  if read_volume == nil or math.abs(read_volume - new_volume) > 0.000001 then return nil, d27_analysis_error("VERIFY_FAILED", "Native Take normalization failed volume readback.", { item_ref = row.item_ref, expected_volume = new_volume, observed_volume = read_volume or -1 }) end
  counters.native_readback_count = counters.native_readback_count + 1
  return {
    status = "APPLIED",
    item_ref = row.item_ref,
    owner_track_ref = row.owner_track_ref,
    changed = true,
    source_media_deleted = false,
    measurement_scope = "source_item_take_pre_fx",
    normalization_metric = params.normalization_metric,
    normalization_target = params.normalization_target,
    adjustment = row.normalization.adjustment,
    take_volume_before = current_volume,
    take_volume_after = read_volume,
  }, nil
end

local function alpha33_split_item_by_silence(request)
  if is_object(request.params) and request.params.batch == true then
    return alpha33_silence_batch(request)
  end
  local source_item_ref, requested_guid = d27_split_exact_item_ref(request)
  if not source_item_ref then
    return nil, d27_analysis_error("REF_INVALID", "Split by silence requires one exact item:guid ref; selection and index aliases are rejected.", {})
  end

  request.params = is_object(request.params) and request.params or {}
  request.params.max_analysis_seconds = D27_MAX_ANALYSIS_SECONDS
  request.params.max_segments = 512
  local context, context_failure = d27_analysis_context(request)
  if not context then return nil, context_failure end
  if context.item_ref ~= source_item_ref or d27_analysis_item_guid(context.item) ~= requested_guid then
    return nil, d27_analysis_error("REF_INVALID", "Live Item identity changed before silence analysis.", {
      requested_item_ref = source_item_ref,
      observed_item_ref = context.item_ref or "",
    }, false)
  end
  if context.item_length > D27_MAX_ANALYSIS_SECONDS then
    return nil, d27_analysis_error("PARAMS_INVALID", "Split by silence requires complete analysis and refuses Items longer than 600 seconds.", {
      reason_code = "ANALYSIS_COVERAGE_INCOMPLETE",
      item_length_seconds = context.item_length,
      maximum_seconds = D27_MAX_ANALYSIS_SECONDS,
    })
  end

  local range, range_failure = d27_analysis_limited_range(context, D27_MAX_ANALYSIS_SECONDS)
  if not range then return nil, range_failure end
  local scan, scan_failure = d27_analysis_sample_scan(context, range, { detect_silence = true })
  if not scan then return nil, scan_failure end
  if scan.truncated or not scan.coverage or scan.coverage.range_complete ~= true
    or scan.coverage.channel_coverage_complete ~= true or scan.coverage.result_rows_complete ~= true
    or scan.total_silence_segments ~= #scan.silence_segments then
    return nil, d27_analysis_error("PARAMS_INVALID", "Split by silence requires complete range, channel, and silence-row coverage before mutation.", {
      reason_code = "ANALYSIS_COVERAGE_INCOMPLETE",
      truncated = scan.truncated == true,
      total_silence_segments = scan.total_silence_segments,
      returned_silence_segments = #scan.silence_segments,
      truncation_reason = scan.coverage and scan.coverage.truncation_reason or "unknown",
    })
  end

  local owner_ok, owner_track = call_reaper("GetMediaItemTrack", context.item)
  if not owner_ok or not owner_track then
    owner_ok, owner_track = call_reaper("GetMediaItem_Track", context.item)
  end
  local owner_track_ref = owner_ok and owner_track and d27_split_track_ref(owner_track) or nil
  if not owner_track_ref then
    return nil, d27_analysis_error("TRACK_NOT_FOUND", "Split by silence could not prove the exact owner Track GUID.", {}, false)
  end
  local ok_count_before, raw_count_before = call_reaper("CountTrackMediaItems", owner_track)
  local item_count_before = ok_count_before and math.max(0, math.floor(first_number(raw_count_before) or -1)) or -1
  if item_count_before < 1 then
    return nil, d27_analysis_error("VERIFY_FAILED", "Split by silence could not read the owner Track Item count before mutation.", {}, false)
  end

  local tolerance = math.max(0.000001, 1 / context.sample_rate)
  local boundaries = {}
  local seen_boundaries = {}
  for index = 1, #scan.silence_segments do
    local segment = scan.silence_segments[index]
    for _, boundary in ipairs({ segment.start_seconds, segment.end_seconds }) do
      if boundary > tolerance and boundary < context.item_length - tolerance then
        local key = string.format("%.9f", boundary)
        if not seen_boundaries[key] then
          seen_boundaries[key] = true
          boundaries[#boundaries + 1] = boundary
        end
      end
    end
  end
  table.sort(boundaries)

  local abstract_fragments = {{ start_seconds = 0, end_seconds = context.item_length }}
  for _, boundary in ipairs(boundaries) do
    for index = 1, #abstract_fragments do
      local fragment = abstract_fragments[index]
      if boundary > fragment.start_seconds + tolerance and boundary < fragment.end_seconds - tolerance then
        local right = { start_seconds = boundary, end_seconds = fragment.end_seconds }
        fragment.end_seconds = boundary
        table.insert(abstract_fragments, index + 1, right)
        break
      end
    end
  end
  local planned_kept = 0
  for index = 1, #abstract_fragments do
    local fragment = abstract_fragments[index]
    local midpoint = (fragment.start_seconds + fragment.end_seconds) / 2
    if not d27_split_matches_silence(midpoint, scan.silence_segments, tolerance) then planned_kept = planned_kept + 1 end
  end
  if planned_kept == 0 then
    return nil, d27_analysis_error("PARAMS_INVALID", "The complete Item is silent at the requested threshold; deleting the only source Item is refused.", {
      reason_code = "ALL_SILENT_ITEM_BLOCKED",
      item_ref = source_item_ref,
      item_length_seconds = context.item_length,
    })
  end

  if #scan.silence_segments == 0 then
    return {
      capability = request.pack.capability,
      pack = request.pack.id,
      risk = request.pack.risk,
      readback_status = "passed",
      source_item_ref = source_item_ref,
      owner_track_ref = owner_track_ref,
      kept_item_refs = json_array({ source_item_ref }),
      deleted_item_refs = json_array({}),
      silence_segment_count = 0,
      split_count = 0,
      delete_count = 0,
      item_count_before = item_count_before,
      item_count_after = item_count_before,
      original_duration_seconds = context.item_length,
      removed_duration_seconds = 0,
      remaining_duration_seconds = context.item_length,
      changed = false,
      source_media_deleted = false,
      analysis_coverage = scan.coverage,
    }, nil, json_array({}), json_array({}), json_array({
      d27_split_object_ref("item", source_item_ref),
      d27_split_object_ref("track", owner_track_ref),
    })
  end

  local fragments = {{
    item = context.item,
    start_seconds = 0,
    end_seconds = context.item_length,
    item_ref = source_item_ref,
    guid = requested_guid,
  }}
  local split_count = 0
  for _, boundary in ipairs(boundaries) do
    local split_index = nil
    for index = 1, #fragments do
      local fragment = fragments[index]
      if boundary > fragment.start_seconds + tolerance and boundary < fragment.end_seconds - tolerance then
        split_index = index
        break
      end
    end
    if not split_index then
      return nil, d27_analysis_error("VERIFY_FAILED", "A proven silence boundary no longer mapped to the live Item fragment chain.", {
        boundary_seconds = boundary,
      }, false)
    end
    local left = fragments[split_index]
    local ok_split, right_item = call_reaper("SplitMediaItem", left.item, context.item_position + boundary)
    if not ok_split or not right_item then
      return nil, d27_analysis_error("COMMAND_FAILED", "REAPER rejected native SplitMediaItem at a proven silence boundary.", {
        boundary_seconds = boundary,
      }, false)
    end
    local right_ref, right_guid = d27_split_item_ref(right_item)
    if not right_ref or right_guid == left.guid then
      return nil, d27_analysis_error("VERIFY_FAILED", "SplitMediaItem did not return a unique native GUID for the new right fragment.", {
        boundary_seconds = boundary,
      }, false)
    end
    local right = {
      item = right_item,
      start_seconds = boundary,
      end_seconds = left.end_seconds,
      item_ref = right_ref,
      guid = right_guid,
    }
    left.end_seconds = boundary
    table.insert(fragments, split_index + 1, right)
    split_count = split_count + 1
  end

  local kept = {}
  local deleted = {}
  for index = 1, #fragments do
    local fragment = fragments[index]
    local midpoint = (fragment.start_seconds + fragment.end_seconds) / 2
    if d27_split_matches_silence(midpoint, scan.silence_segments, tolerance) then
      deleted[#deleted + 1] = fragment
    else
      kept[#kept + 1] = fragment
    end
  end
  for index = 1, #deleted do
    local fragment = deleted[index]
    local ok_delete, deleted_ok = call_reaper("DeleteTrackMediaItem", owner_track, fragment.item)
    if not ok_delete or deleted_ok ~= true then
      return nil, d27_analysis_error("COMMAND_FAILED", "REAPER rejected deletion of a silence-classified Item fragment.", {
        item_ref = fragment.item_ref,
      }, false)
    end
  end
  call_reaper("UpdateArrange")

  local ok_count_after, raw_count_after = call_reaper("CountTrackMediaItems", owner_track)
  local item_count_after = ok_count_after and math.max(0, math.floor(first_number(raw_count_after) or -1)) or -1
  local expected_count_after = item_count_before + split_count - #deleted
  if item_count_after ~= expected_count_after then
    return nil, d27_analysis_error("VERIFY_FAILED", "Owner Track Item count did not match native split/delete operations.", {
      item_count_before = item_count_before,
      split_count = split_count,
      delete_count = #deleted,
      expected_item_count_after = expected_count_after,
      observed_item_count_after = item_count_after,
    }, false)
  end

  local kept_refs = json_array({})
  local deleted_refs = json_array({})
  local output_refs = json_array({ d27_split_object_ref("track", owner_track_ref) })
  local remaining_duration = 0
  for index = 1, #kept do
    local fragment = kept[index]
    local live_item = d27_analysis_find_item_by_guid(fragment.guid)
    local live_position = live_item and d27_split_number(live_item, "D_POSITION") or nil
    local live_length = live_item and d27_split_number(live_item, "D_LENGTH") or nil
    local live_track_ok, live_track = live_item and call_reaper("GetMediaItemTrack", live_item) or false, nil
    if live_item then
      live_track_ok, live_track = call_reaper("GetMediaItemTrack", live_item)
      if not live_track_ok or not live_track then live_track_ok, live_track = call_reaper("GetMediaItem_Track", live_item) end
    end
    local expected_position = context.item_position + fragment.start_seconds
    local expected_length = fragment.end_seconds - fragment.start_seconds
    if not live_item or not live_track_ok or live_track ~= owner_track or live_position == nil or live_length == nil
      or math.abs(live_position - expected_position) > tolerance or math.abs(live_length - expected_length) > tolerance then
      return nil, d27_analysis_error("VERIFY_FAILED", "A kept Item fragment failed exact GUID, Track, position, or length readback.", {
        item_ref = fragment.item_ref,
        expected_position_seconds = expected_position,
        observed_position_seconds = live_position or -1,
        expected_length_seconds = expected_length,
        observed_length_seconds = live_length or -1,
      }, false)
    end
    remaining_duration = remaining_duration + live_length
    kept_refs[#kept_refs + 1] = fragment.item_ref
    output_refs[#output_refs + 1] = d27_split_object_ref("item", fragment.item_ref)
  end
  local removed_duration = 0
  for index = 1, #deleted do
    local fragment = deleted[index]
    if d27_analysis_find_item_by_guid(fragment.guid) then
      return nil, d27_analysis_error("VERIFY_FAILED", "A deleted silence fragment GUID is still present in the live project.", {
        item_ref = fragment.item_ref,
      }, false)
    end
    removed_duration = removed_duration + (fragment.end_seconds - fragment.start_seconds)
    deleted_refs[#deleted_refs + 1] = fragment.item_ref
    output_refs[#output_refs + 1] = d27_split_object_ref("item", fragment.item_ref)
  end
  if math.abs((remaining_duration + removed_duration) - context.item_length) > tolerance then
    return nil, d27_analysis_error("VERIFY_FAILED", "Kept and removed Item fragment durations do not conserve the original Item duration.", {
      original_duration_seconds = context.item_length,
      remaining_duration_seconds = remaining_duration,
      removed_duration_seconds = removed_duration,
      tolerance_seconds = tolerance,
    }, false)
  end

  return {
    capability = request.pack.capability,
    pack = request.pack.id,
    risk = request.pack.risk,
    readback_status = "passed",
    source_item_ref = source_item_ref,
    owner_track_ref = owner_track_ref,
    kept_item_refs = kept_refs,
    deleted_item_refs = deleted_refs,
    silence_segment_count = #scan.silence_segments,
    split_count = split_count,
    delete_count = #deleted,
    item_count_before = item_count_before,
    item_count_after = item_count_after,
    original_duration_seconds = context.item_length,
    removed_duration_seconds = removed_duration,
    remaining_duration_seconds = remaining_duration,
    changed = true,
    source_media_deleted = false,
    analysis_coverage = scan.coverage,
  }, nil, json_array({}), json_array({}), output_refs
end

alpha33_silence_batch = function(request)
  local started = os.clock()
  local params = is_object(request.params) and request.params or {}
  local operation = params.operation or "remove_silence"
  if operation ~= "remove_silence" and operation ~= "normalize_level" then
    return d27_batch_fail("PARAMS_INVALID", "Audio batch operation must be remove_silence or normalize_level.")
  end
  local silence_threshold_dbfs, threshold_failure = d27_batch_number(params, "silence_threshold_dbfs", -60, -150, 0)
  if not silence_threshold_dbfs then return nil, threshold_failure end
  local min_silence_ms, min_silence_failure = d27_batch_number(params, "min_silence_ms", 250, 1, 60000)
  if not min_silence_ms then return nil, min_silence_failure end
  local scope = params.silence_scope or "all"
  if operation == "remove_silence" and not ({ all = true, leading = true, trailing = true, edges = true, internal = true })[scope] then
    return d27_batch_fail("PARAMS_INVALID", "silence_scope must be all, leading, trailing, edges, or internal.")
  end
  local metric_codes = { lufs_i = 0, rms_i = 1, peak = 2, true_peak = 3, lufs_m_max = 4, lufs_s_max = 5 }
  local normalization_metric = params.normalization_metric
  local normalization_target = params.normalization_target
  if operation == "normalize_level" then
    if not metric_codes[normalization_metric] then
      return d27_batch_fail("PARAMS_INVALID", "normalization_metric must be one of lufs_i, rms_i, peak, true_peak, lufs_m_max, or lufs_s_max.")
    end
    normalization_target = d27_analysis_number(normalization_target)
    if normalization_target == nil or normalization_target > 0 or normalization_target < -150 then
      return d27_batch_fail("PARAMS_INVALID", "normalization_target must be a finite value from -150 to 0 dB/LUFS.")
    end
  end
  local targets, target_failure = d27_batch_targets(request, params)
  if not targets then return nil, target_failure end

  local preflight_started = os.clock()
  local rows = {}
  for index = 1, #targets do
    local target = targets[index]
    local owner_track, owner_track_ref = d27_batch_owner_track({ item = target.item })
    if not owner_track then
      return d27_batch_fail("TRACK_NOT_FOUND", "Audio batch could not prove the exact owner Track before mutation.", { item_ref = target.item_ref })
    end
    local analysis_request = {
      refs = json_array({ d27_split_object_ref("item", target.item_ref) }),
      params = {
        silence_threshold_dbfs = silence_threshold_dbfs,
        min_silence_ms = min_silence_ms,
        max_analysis_seconds = D27_MAX_ANALYSIS_SECONDS,
        max_segments = 512,
      },
      -- Batch preflight must prove every silence row. The public max_items
      -- budget is a response boundary, not an internal analysis ceiling.
      budget = nil,
    }
    local context, context_failure = d27_analysis_context(analysis_request)
    if not context then
      return d27_batch_preflight_failure(context_failure)
    end
    if context.item_ref ~= target.item_ref or d27_analysis_item_guid(context.item) ~= target.guid then
      return d27_batch_fail("REF_INVALID", "Audio batch Item identity changed during preflight.", { item_ref = target.item_ref })
    end
    local source_type = string.upper(context.source_type or "")
    if source_type:find("MIDI", 1, true) then
      return d27_batch_fail("UNSUPPORTED_TARGET", "MIDI Items are unsupported by audio batch processing; zero_write=true.", {
        item_ref = target.item_ref,
        typed_truth = "MIDI_UNSUPPORTED",
      })
    end
    local source_range, source_range_failure = d27_analysis_source_bounds(context, 0, context.item_length)
    if not source_range then
      return d27_batch_preflight_failure(source_range_failure)
    end
    local row = {
      item = target.item,
      item_ref = target.item_ref,
      guid = target.guid,
      target_order = index,
      context = context,
      owner_track = owner_track,
      owner_track_ref = owner_track_ref,
      source_range = source_range,
    }
    if operation == "remove_silence" then
      context.params.silence_threshold_dbfs = silence_threshold_dbfs
      context.params.min_silence_ms = min_silence_ms
      local range, range_failure = d27_analysis_limited_range(context, D27_MAX_ANALYSIS_SECONDS)
      if not range then return d27_batch_preflight_failure(range_failure) end
      local scan, scan_failure = d27_analysis_sample_scan(context, range, { detect_silence = true })
      if not scan then return d27_batch_preflight_failure(scan_failure) end
      if scan.truncated or not scan.coverage or scan.coverage.range_complete ~= true
        or scan.coverage.channel_coverage_complete ~= true or scan.coverage.result_rows_complete ~= true
        or scan.total_silence_segments ~= #scan.silence_segments then
        return d27_batch_fail("ANALYSIS_COVERAGE_INCOMPLETE", "Audio batch requires complete range, channel, and silence-row coverage before mutation.", {
          item_ref = target.item_ref,
          truncation_reason = scan.coverage and scan.coverage.truncation_reason or "unknown",
        })
      end
      local ranges, ranges_failure, all_silent = d27_batch_ranges(scan, context, params)
      if not ranges then return d27_batch_preflight_failure(ranges_failure) end
      row.scan = scan
      row.ranges = ranges
      row.all_silent = all_silent
    else
      local ok_adjustment, adjustment = call_reaper(
        "CalculateNormalization",
        context.source,
        metric_codes[normalization_metric],
        normalization_target,
        source_range.start_seconds,
        source_range.end_seconds
      )
      adjustment = ok_adjustment and d27_analysis_number(first_number(adjustment)) or nil
      if adjustment == nil or adjustment <= 0 or adjustment == math.huge then
        return d27_batch_fail("NATIVE_NORMALIZATION_UNAVAILABLE", "REAPER CalculateNormalization did not return a valid native adjustment; zero_write=true.", {
          item_ref = target.item_ref,
          metric = normalization_metric,
          metric_code = metric_codes[normalization_metric],
        })
      end
      row.normalization = { adjustment = adjustment, metric_code = metric_codes[normalization_metric] }
      row.ranges = {}
      row.scan = { silence_segments = json_array({}) }
    end
    rows[#rows + 1] = row
  end
  local preflight_ms = (os.clock() - preflight_started) * 1000
  local plan_hash = d27_batch_checksum_plan(rows, {
    target = params.target or (#rows > 0 and "selected" or "exact"),
    silence_scope = scope,
    silence_threshold_dbfs = silence_threshold_dbfs,
    min_silence_ms = min_silence_ms,
    keep_before_ms = params.keep_before_ms or 20,
    keep_after_ms = params.keep_after_ms or 20,
    min_kept_audio_ms = params.min_kept_audio_ms or 80,
    fade_ms = params.fade_ms or 5,
    normalization_metric = normalization_metric,
    normalization_target = normalization_target,
  }, operation)
  local counters = {
    native_mutation_count = 0,
    native_readback_count = 0,
    aggregate_readback_count = 0,
    continuation_yield_count = 0,
    target_resolution_count = #rows,
  }
  local mutation_started = os.clock()
  local aggregate_readback = json_array({})
  local dry_run = params.dry_run == true
  if not dry_run then
    for index = 1, #rows do
      local result, result_failure
      if operation == "remove_silence" then
        result, result_failure = d27_batch_apply_silence(rows[index], params, counters)
      else
        result, result_failure = d27_batch_apply_normalization(rows[index], params, counters)
      end
      if not result then
        local details = result_failure and result_failure.details or {}
        details.plan_hash = plan_hash
        details.native_counters = counters
        details.zero_write = counters.native_mutation_count == 0
        return nil, result_failure
      end
      if #rows > 8 and operation == "remove_silence" then
        -- The native verifier already proved every kept/deleted GUID before
        -- returning. Keep the public batch envelope bounded while retaining
        -- one aggregate truth row and its conservation counters per target.
        local kept_count = type(result.kept_item_refs) == "table" and #result.kept_item_refs or 0
        local deleted_count = type(result.deleted_item_refs) == "table" and #result.deleted_item_refs or 0
        result.kept_item_count = kept_count
        result.deleted_item_count = deleted_count
        result.kept_item_refs = nil
        result.deleted_item_refs = nil
      end
      result.target_order = index
      result.plan_hash = plan_hash
      aggregate_readback[#aggregate_readback + 1] = result
    end
  else
    for index = 1, #rows do
      aggregate_readback[#aggregate_readback + 1] = {
        target_order = index,
        item_ref = rows[index].item_ref,
        owner_track_ref = rows[index].owner_track_ref,
        status = rows[index].all_silent and "ALL_SILENT_RETAINED" or "PLANNED",
        changed = false,
        source_media_deleted = false,
        planned_silence_range_count = #rows[index].ranges,
        normalization_metric = normalization_metric,
        measurement_scope = operation == "normalize_level" and "source_item_take_pre_fx" or nil,
      }
    end
  end
  local mutation_ms = (os.clock() - mutation_started) * 1000
  counters.aggregate_readback_count = #aggregate_readback
  local total_ms = (os.clock() - started) * 1000
  return {
    capability = request.pack and request.pack.capability or "items.split_item_by_silence",
    pack = request.pack and request.pack.id or "items",
    risk = request.pack and request.pack.risk or "destructive",
    readback_status = "passed",
    operation = operation,
    target_scope = params.target or (#targets > 0 and (is_json_array(params.target_refs) and #params.target_refs > 0 and "exact" or "selected") or "selected"),
    target_count = #targets,
    returned_target_count = #aggregate_readback,
    plan_hash = plan_hash,
    aggregate_readback = aggregate_readback,
    measurement_scope = operation == "normalize_level" and "source_item_take_pre_fx" or "source_item_take_pre_fx",
    source_media_deleted = false,
    zero_write = false,
    batch_timings = {
      target_resolution_ms = 0,
      preflight_ms = preflight_ms,
      mutation_ms = mutation_ms,
      readback_ms = 0,
      total_ms = total_ms,
    },
    timings = {
      target_resolution_ms = 0,
      preflight_ms = preflight_ms,
      mutation_ms = mutation_ms,
      final_readback_ms = 0,
      total_ms = total_ms,
    },
    native_counters = counters,
    transport_call_count = 1,
    undo_opened = request.__openreaper_undo_opened == true,
    undo_closed = request.__openreaper_undo_closed ~= false,
    undo = { mode = "required", one_invocation = true, undo_opened = request.__openreaper_undo_opened == true, undo_closed = request.__openreaper_undo_closed ~= false },
  }, nil, json_array({}), json_array({}), json_array({})
end
