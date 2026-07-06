-- Extracted D27 handler: item audio analysis artifacts.

local function d27_analysis_error(code, message, details, recoverable)
  return nil, {
    code = code,
    message = message,
    recoverable = recoverable ~= false,
    details = details or {},
  }
end

local function d27_analysis_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then
    return value
  end
  return fallback
end

local function d27_analysis_linear_to_db(value)
  if type(value) ~= "number" or value <= 0 then
    return -150
  end
  return 20 * math.log(value) / math.log(10)
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

local function d27_analysis_item_number(item, key)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, key)
  return ok and d27_analysis_number(first_number(value), 0) or 0
end

local function d27_analysis_scan(request)
  local item = d27_analysis_item_from_request_refs(request)
  if not item then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item audio analysis requires a resolvable item ref.", {})
  end
  local ok_take, take = call_reaper("GetActiveTake", item)
  if not ok_take or not take then
    return nil, d27_analysis_error("TAKE_NOT_FOUND", "Item audio analysis requires an active take.", {})
  end

  local item_summary = read_item_summary({
    refs = request.refs,
    params = { include_take_summary = true },
    budget = request.budget,
  })
  if not item_summary then
    return nil, d27_analysis_error("ITEM_NOT_FOUND", "Item summary readback failed before audio analysis.", {})
  end

  local item_position = d27_analysis_item_number(item, "D_POSITION")
  local item_length = math.max(0, d27_analysis_item_number(item, "D_LENGTH"))
  local start_seconds = math.max(0, d27_analysis_number(request.params.start_seconds, 0))
  local end_seconds = d27_analysis_number(request.params.end_seconds, item_length)
  if end_seconds == nil or end_seconds <= start_seconds then
    end_seconds = item_length
  end
  end_seconds = math.min(item_length, math.max(start_seconds, end_seconds))
  local requested_duration = math.max(0, end_seconds - start_seconds)
  local max_duration = 30
  local analyzed_duration = math.min(requested_duration, max_duration)
  if analyzed_duration <= 0 then
    return nil, d27_analysis_error("EMPTY_RANGE", "Item audio analysis range is empty.", {
      item_length_seconds = item_length,
      start_seconds = start_seconds,
      end_seconds = end_seconds,
    })
  end

  local sample_rate = 44100
  local channels = 2
  local ok_accessor, accessor = call_reaper("CreateTakeAudioAccessor", take)
  if not ok_accessor or not accessor then
    return nil, d27_analysis_error("AUDIO_ACCESSOR_UNAVAILABLE", "REAPER did not create a take audio accessor.", {}, false)
  end

  local total_frames = math.max(1, math.floor(analyzed_duration * sample_rate))
  local block_frames = 2048
  local frame_offset = 0
  local sum_squares = 0
  local sample_count = 0
  local positive_peak = 0
  local negative_peak = 0
  local abs_peak = 0
  local silence_threshold = 10 ^ (-60 / 20)
  local silence_segments = json_array({})
  local silence_start = nil
  local total_silence_seconds = 0
  local transient_threshold = 0.25
  local min_transient_gap_frames = math.floor(sample_rate * 0.03)
  local last_transient_frame = -min_transient_gap_frames
  local transients = json_array({})
  local total_transients = 0
  local previous_amp = 0

  while frame_offset < total_frames do
    local frames = math.min(block_frames, total_frames - frame_offset)
    local ok_buffer, buffer = call_reaper("new_array", frames * channels)
    if not ok_buffer or not buffer then
      call_reaper("DestroyAudioAccessor", accessor)
      return nil, d27_analysis_error("AUDIO_BUFFER_UNAVAILABLE", "REAPER did not allocate an audio sample buffer.", {}, false)
    end
    local ok_samples = call_reaper(
      "GetAudioAccessorSamples",
      accessor,
      sample_rate,
      channels,
      item_position + start_seconds + (frame_offset / sample_rate),
      frames,
      buffer
    )
    if not ok_samples then
      call_reaper("DestroyAudioAccessor", accessor)
      return nil, d27_analysis_error("AUDIO_SAMPLE_READ_FAILED", "REAPER rejected audio accessor sample read.", {}, false)
    end
    local values = {}
    if buffer and type(buffer.table) == "function" then
      local ok_table, table_values = pcall(function() return buffer.table() end)
      if ok_table and type(table_values) == "table" then
        values = table_values
      end
    end
    for frame = 0, frames - 1 do
      local frame_peak = 0
      for channel = 1, channels do
        local sample = d27_analysis_number(values[(frame * channels) + channel], 0)
        sum_squares = sum_squares + (sample * sample)
        sample_count = sample_count + 1
        if sample > positive_peak then positive_peak = sample end
        if sample < negative_peak then negative_peak = sample end
        local abs_sample = math.abs(sample)
        if abs_sample > abs_peak then abs_peak = abs_sample end
        if abs_sample > frame_peak then frame_peak = abs_sample end
      end
      local absolute_frame = frame_offset + frame
      if frame_peak <= silence_threshold then
        if silence_start == nil then silence_start = absolute_frame end
      elseif silence_start ~= nil then
        local length_frames = absolute_frame - silence_start
        if length_frames >= math.floor(sample_rate * 0.05) then
          local start_time = start_seconds + (silence_start / sample_rate)
          local end_time = start_seconds + (absolute_frame / sample_rate)
          total_silence_seconds = total_silence_seconds + (end_time - start_time)
          if #silence_segments < 32 then
            silence_segments[#silence_segments + 1] = {
              start_seconds = start_time,
              end_seconds = end_time,
              duration_seconds = end_time - start_time,
            }
          end
        end
        silence_start = nil
      end
      if frame_peak - previous_amp >= transient_threshold
        and absolute_frame - last_transient_frame >= min_transient_gap_frames then
        total_transients = total_transients + 1
        last_transient_frame = absolute_frame
        if #transients < 64 then
          transients[#transients + 1] = {
            time_seconds = start_seconds + (absolute_frame / sample_rate),
            strength = frame_peak - previous_amp,
          }
        end
      end
      previous_amp = frame_peak
    end
    frame_offset = frame_offset + frames
  end

  if silence_start ~= nil then
    local start_time = start_seconds + (silence_start / sample_rate)
    local end_time = start_seconds + (total_frames / sample_rate)
    total_silence_seconds = total_silence_seconds + (end_time - start_time)
    if #silence_segments < 32 then
      silence_segments[#silence_segments + 1] = {
        start_seconds = start_time,
        end_seconds = end_time,
        duration_seconds = end_time - start_time,
      }
    end
  end
  call_reaper("DestroyAudioAccessor", accessor)

  local rms_linear = sample_count > 0 and math.sqrt(sum_squares / sample_count) or 0
  return {
    item = item_summary,
    item_ref = item_summary.item_ref,
    start_seconds = start_seconds,
    end_seconds = start_seconds + analyzed_duration,
    requested_end_seconds = end_seconds,
    duration_seconds = analyzed_duration,
    sample_rate = sample_rate,
    channels = channels,
    sample_frames = total_frames,
    truncated = requested_duration > analyzed_duration,
    rms_linear = rms_linear,
    rms_dbfs = d27_analysis_linear_to_db(rms_linear),
    abs_peak_linear = abs_peak,
    abs_peak_dbfs = d27_analysis_linear_to_db(abs_peak),
    positive_peak_linear = positive_peak,
    negative_peak_linear = negative_peak,
    silence_segments = silence_segments,
    segment_count = #silence_segments,
    total_silence_seconds = total_silence_seconds,
    threshold_dbfs = -60,
    transients = transients,
    transient_count = #transients,
    total_detected = total_transients,
    first_transient_time = #transients > 0 and transients[1].time_seconds or 0,
    last_transient_time = #transients > 0 and transients[#transients].time_seconds or 0,
  }, nil
end

local function d27_analysis_write(request, operation_key, summary, payload)
  local spec = A1_ARTIFACT_SPECS[operation_key]
  local write, failure = write_a1_artifact(request, spec, summary, payload)
  if not write then
    return d27_analysis_error(failure.code, failure.message, failure.details)
  end
  summary.artifact_ref = write.object_ref.ref
  summary.schema = spec.schema
  summary.bytes = write.bytes
  return summary, nil, json_array({ write.object_ref })
end

local function measure_item_rms(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_rms.v1",
    item_ref = scan.item_ref,
    rms_dbfs = scan.rms_dbfs,
    rms_linear = scan.rms_linear,
    duration_seconds = scan.duration_seconds,
    sample_frames = scan.sample_frames,
    truncated = scan.truncated,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_rms", summary, {
    item = scan.item,
    metrics = summary,
    analysis_quality_claim = true,
  })
end

local function measure_item_peaks(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_peaks.v1",
    item_ref = scan.item_ref,
    abs_peak_dbfs = scan.abs_peak_dbfs,
    abs_peak_linear = scan.abs_peak_linear,
    positive_peak_linear = scan.positive_peak_linear,
    negative_peak_linear = scan.negative_peak_linear,
    duration_seconds = scan.duration_seconds,
    sample_frames = scan.sample_frames,
    truncated = scan.truncated,
  }
  return d27_analysis_write(request, "run_job:analysis.measure_item_peaks", summary, {
    item = scan.item,
    metrics = summary,
    analysis_quality_claim = true,
  })
end

local function detect_item_silence(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_silence.v1",
    item_ref = scan.item_ref,
    segment_count = scan.segment_count,
    total_silence_seconds = scan.total_silence_seconds,
    truncated = scan.truncated or scan.segment_count > #scan.silence_segments,
    threshold_dbfs = scan.threshold_dbfs,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_silence", summary, {
    item = scan.item,
    silence_segments = scan.silence_segments,
    threshold_dbfs = scan.threshold_dbfs,
    analysis_quality_claim = true,
  })
end

local function detect_item_transients(request)
  local scan, failure = d27_analysis_scan(request)
  if not scan then return nil, failure end
  local summary = {
    artifact_ref = "",
    schema = "analysis.item_transients.v1",
    item_ref = scan.item_ref,
    transient_count = scan.transient_count,
    total_detected = scan.total_detected,
    truncated = scan.truncated or scan.total_detected > scan.transient_count,
    first_transient_time = scan.first_transient_time,
    last_transient_time = scan.last_transient_time,
  }
  return d27_analysis_write(request, "run_job:analysis.detect_item_transients", summary, {
    item = scan.item,
    transients = scan.transients,
    analysis_quality_claim = true,
  })
end
