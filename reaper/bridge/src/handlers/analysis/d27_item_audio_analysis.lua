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
  if sample_rate == nil or sample_rate <= 0 or sample_rate ~= math.floor(sample_rate) then
    return nil, d27_analysis_error("AUDIO_SOURCE_UNSUPPORTED", "Item audio analysis requires an audio source with a native sample rate.", {
      sample_rate = sample_rate or 0,
    }, false)
  end
  if channels == nil or channels < 1 or channels ~= math.floor(channels) or channels > D27_MAX_CHANNELS then
    return nil, d27_analysis_error("AUDIO_CHANNELS_UNSUPPORTED", "Item audio analysis requires a bounded native source channel count.", {
      channels = channels or 0,
      maximum = D27_MAX_CHANNELS,
    }, false)
  end

  local ok_type, source_type = call_reaper("GetMediaSourceType", source, "")
  if not ok_type or type(source_type) ~= "string" or source_type == "" then
    source_type = "unknown"
  end
  local ok_source_length, source_length, length_is_qn = call_reaper("GetMediaSourceLength", source)
  source_length = ok_source_length and d27_analysis_number(first_number(source_length)) or nil
  if source_length ~= nil and source_length < 0 then source_length = nil end

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
