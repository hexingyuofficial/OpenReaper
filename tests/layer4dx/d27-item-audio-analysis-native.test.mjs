import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/analysis/d27_item_audio_analysis.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
function json_array(value) return value or {} end
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function read_item_summary(request)
  return {
    item_ref = "item:guid:{D27-ITEM}",
    active_take_ref = "take:guid:{D27-TAKE}",
    position = fake.position,
    length = fake.item_length,
  }
end
A1_ARTIFACT_SPECS = {
  ["run_job:analysis.measure_item_rms"] = { schema = "analysis.item_rms.v1" },
  ["run_job:analysis.measure_item_peaks"] = { schema = "analysis.item_peaks.v1" },
  ["run_job:analysis.detect_item_silence"] = { schema = "analysis.item_silence.v1" },
  ["run_job:analysis.detect_item_transients"] = { schema = "analysis.item_transients.v1" },
}
function write_a1_artifact(request, spec, summary, payload)
  captured = { summary = summary, payload = payload, spec = spec }
  return {
    object_ref = { kind = "artifact", ref = "artifact:analysis:d27:art_test" },
    bytes = 321,
  }, nil
end
function make_request(params)
  return {
    refs = {
      {
        kind = "item",
        ref = "item:selected:0",
        identity = { scheme = "selected", value = "0" },
      },
    },
    params = params or {},
    budget = { max_response_bytes = 65536, max_items = 64, max_inline_value_bytes = 2048 },
  }
end
function close(actual, expected, tolerance)
  assert(math.abs(actual - expected) <= (tolerance or 0.000001), tostring(actual) .. " != " .. tostring(expected))
end
function install_fake(config)
  fake = {
    position = config.position ~= nil and config.position or 10,
    item_length = config.item_length or 1,
    sample_rate = config.sample_rate or 48000,
    channels = config.channels or 1,
    source_length = config.source_length or 30,
    source_type = config.source_type or "WAVE",
    start_offset = config.start_offset or 0,
    playrate = config.playrate or 1,
    reverse = config.reverse or 0,
    stretch_marker_count = config.stretch_marker_count or 0,
    loop_source = config.loop_source or 0,
    adjustments = config.adjustments or { [0] = 2, [1] = 4, [2] = 4, [3] = 2 },
    peak_maxima = config.peak_maxima or { 0.5 },
    peak_minima = config.peak_minima or { -0.5 },
    peak_returned = config.peak_returned,
    samples = config.samples or { 0 },
    sample_status = config.sample_status or 1,
    accessor_start = config.accessor_start ~= nil and config.accessor_start or 0,
    accessor_end = config.accessor_end ~= nil and config.accessor_end or (config.item_length or 1),
  }
  calls = { normalization = {}, peaks = {}, samples = {}, accessor_starts = 0, accessor_ends = 0, artifacts = 0, destroy = 0 }
  local item = {}
  local take = {}
  local source = {}
  local accessor = {}
  reaper = {}
  reaper.GetSelectedMediaItem = function(project, index) return item end
  reaper.GetActiveTake = function(actual_item) assert(actual_item == item); return take end
  reaper.GetMediaItemTake_Source = function(actual_take) assert(actual_take == take); return source end
  reaper.GetMediaItemInfo_Value = function(actual_item, key)
    assert(actual_item == item)
    if key == "D_POSITION" then return fake.position end
    if key == "D_LENGTH" then return fake.item_length end
    if key == "B_LOOPSRC" then return fake.loop_source end
    error("unexpected item key " .. tostring(key))
  end
  reaper.GetMediaItemTakeInfo_Value = function(actual_take, key)
    assert(actual_take == take)
    if key == "D_STARTOFFS" then return fake.start_offset end
    if key == "D_PLAYRATE" then return fake.playrate end
    if key == "B_REVERSE" then return fake.reverse end
    error("unexpected take key " .. tostring(key))
  end
  reaper.GetTakeNumStretchMarkers = function(actual_take)
    assert(actual_take == take)
    return fake.stretch_marker_count
  end
  reaper.GetMediaSourceSampleRate = function(actual_source) assert(actual_source == source); return fake.sample_rate end
  reaper.GetMediaSourceNumChannels = function(actual_source) assert(actual_source == source); return fake.channels end
  reaper.GetMediaSourceType = function(actual_source) assert(actual_source == source); return fake.source_type end
  reaper.GetMediaSourceLength = function(actual_source) assert(actual_source == source); return fake.source_length, false end
  reaper.CalculateNormalization = function(actual_source, mode, target, range_start, range_end)
    assert(actual_source == source)
    calls.normalization[#calls.normalization + 1] = {
      mode = mode,
      target = target,
      range_start = range_start,
      range_end = range_end,
    }
    return fake.adjustments[mode]
  end
  reaper.new_array = function(size)
    local values = {}
    return {
      values = values,
      table = function() return values end,
    }
  end
  reaper.GetMediaItemTake_Peaks = function(actual_take, peakrate, starttime, channels, requested, extra, buffer)
    assert(actual_take == take)
    local returned = fake.peak_returned or requested
    calls.peaks[#calls.peaks + 1] = {
      peakrate = peakrate,
      starttime = starttime,
      channels = channels,
      requested = requested,
      extra = extra,
      returned = returned,
    }
    local block_values = returned * channels
    for frame = 0, returned - 1 do
      for channel = 1, channels do
        local source_index = ((frame * channels + channel - 1) % #fake.peak_maxima) + 1
        local index = frame * channels + channel
        buffer.values[index] = fake.peak_maxima[source_index]
        buffer.values[block_values + index] = fake.peak_minima[source_index]
      end
    end
    return returned
  end
  reaper.CreateTakeAudioAccessor = function(actual_take) assert(actual_take == take); return accessor end
  reaper.GetAudioAccessorStartTime = function(actual_accessor)
    assert(actual_accessor == accessor)
    calls.accessor_starts = calls.accessor_starts + 1
    return fake.accessor_start
  end
  reaper.GetAudioAccessorEndTime = function(actual_accessor)
    assert(actual_accessor == accessor)
    calls.accessor_ends = calls.accessor_ends + 1
    return fake.accessor_end
  end
  reaper.GetAudioAccessorSamples = function(actual_accessor, sample_rate, channels, starttime, frames, buffer)
    assert(actual_accessor == accessor)
    calls.samples[#calls.samples + 1] = {
      sample_rate = sample_rate,
      channels = channels,
      starttime = starttime,
      frames = frames,
    }
    if fake.sample_status > 0 then
      for index = 1, frames * channels do
        buffer.values[index] = fake.samples[((index - 1) % #fake.samples) + 1]
      end
    end
    return fake.sample_status
  end
  reaper.DestroyAudioAccessor = function(actual_accessor)
    assert(actual_accessor == accessor)
    calls.destroy = calls.destroy + 1
  end
end
`;

function runLua(body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = `${PRELUDE}\n${HANDLER_SOURCE}\n${body}\nreturn true`;
  const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  const callStatus = lua.lua_pcall(L, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  assert.equal(lua.lua_toboolean(L, -1), true);
  lua.lua_close(L);
}

describe("D27 native-first item audio analysis handler", () => {
  it("normalizes internal D27 reasons to frozen bridge codes without losing their cause", () => {
    runLua(`
local param_reasons = {
  "ANALYSIS_RANGE_UNSUPPORTED",
  "EMPTY_RANGE",
  "AUDIO_SOURCE_UNSUPPORTED",
  "AUDIO_CHANNELS_UNSUPPORTED",
}
for _, reason in ipairs(param_reasons) do
  local failure = d27_analysis_error(reason, "test", {})
  assert(failure.code == "PARAMS_INVALID")
  assert(failure.details.reason_code == reason)
end
local command_reasons = {
  "ANALYSIS_READ_FAILED",
  "SOURCE_NOT_FOUND",
  "NATIVE_ANALYSIS_FAILED",
  "ANALYSIS_RESULT_INVALID",
  "AUDIO_BUFFER_UNAVAILABLE",
  "AUDIO_ACCESSOR_UNAVAILABLE",
  "AUDIO_ACCESSOR_RANGE_INVALID",
  "AUDIO_SAMPLE_READ_EMPTY",
  "AUDIO_SAMPLE_READ_FAILED",
}
for _, reason in ipairs(command_reasons) do
  local failure = d27_analysis_error(reason, "test", {})
  assert(failure.code == "COMMAND_FAILED")
  assert(failure.details.reason_code == reason)
end
local frozen = d27_analysis_error("TAKE_NOT_FOUND", "test", {})
assert(frozen.code == "TAKE_NOT_FOUND")
assert(frozen.details.reason_code == nil)
`);
  });

  it("derives RMS-I and LUFS-I from CalculateNormalization over exact mapped source bounds", () => {
    runLua(`
install_fake({ sample_rate = 48000, channels = 1, start_offset = 0.25, playrate = 2 })
local summary, failure = measure_item_rms(make_request({ start_seconds = 0.1, end_seconds = 0.2 }))
assert(failure == nil)
assert(summary.sample_rate == 48000)
assert(summary.channels == 1)
assert(summary.sample_frames == 4800)
assert(summary.measurement_basis == "source_media_calculate_normalization")
close(summary.rms_dbfs, -12.041199826559)
close(summary.rms_linear, 0.25)
close(summary.lufs_i, -6.0205999132796)
assert(summary.coverage.range_complete == true)
assert(#calls.normalization == 2)
assert(calls.normalization[1].mode == 1)
assert(calls.normalization[2].mode == 0)
close(calls.normalization[1].range_start, 0.45)
close(calls.normalization[1].range_end, 0.65)
assert(captured.payload.native_api.name == "CalculateNormalization")
assert(captured.payload.measurement.item_gain == "not_included")
`);
  });

  it("reads interleaved native peak blocks at the real source rate and returns per-channel plus true-peak facts", () => {
    runLua(`
install_fake({
  sample_rate = 1000,
  channels = 2,
  peak_maxima = { 0.25, 0.75, 0.5, 0.4 },
  peak_minima = { -0.1, -0.2, -0.3, -0.4 },
})
local summary, failure = measure_item_peaks(make_request({ start_seconds = 0, end_seconds = 0.002 }))
assert(failure == nil)
assert(summary.sample_rate == 1000)
assert(summary.channels == 2)
assert(summary.sample_frames == 2)
close(summary.abs_peak_linear, 0.75)
close(summary.positive_peak_linear, 0.75)
close(summary.negative_peak_linear, -0.4)
assert(#summary.per_channel == 2)
close(summary.per_channel[1].abs_peak_linear, 0.5)
close(summary.per_channel[2].abs_peak_linear, 0.75)
assert(summary.true_peak_available == true)
close(summary.source_sample_peak_dbfs, -12.041199826559)
close(summary.true_peak_dbfs, -6.0205999132796)
assert(summary.measurement_basis == "active_take_native_peak_blocks")
assert(#calls.peaks == 1)
assert(calls.peaks[1].peakrate == 1000)
assert(calls.peaks[1].channels == 2)
close(calls.peaks[1].starttime, 10)
assert(#calls.samples == 0)
`);
  });

  it("fails source-normalization RMS on non-linear stretch-marker mapping instead of mislabeling source bounds", () => {
    runLua(`
install_fake({ sample_rate = 48000, channels = 1, stretch_marker_count = 1 })
local summary, failure = measure_item_rms(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "ANALYSIS_RANGE_UNSUPPORTED")
assert(failure.details.stretch_marker_count == 1)
assert(#calls.normalization == 0)
assert(captured == nil)
`);
  });

  it("marks native peak short reads incomplete instead of presenting a definitive full-range result", () => {
    runLua(`
install_fake({ sample_rate = 1000, channels = 1, peak_returned = 1 })
local summary, failure = measure_item_peaks(make_request({ start_seconds = 0, end_seconds = 0.002 }))
assert(failure == nil)
assert(summary.sample_frames == 1)
assert(summary.truncated == true)
assert(summary.coverage.range_complete == false)
assert(summary.coverage.truncation_reason == "native_peak_short_read")
`);
  });

  it("rejects finite but physically implausible native peaks before writing an artifact", () => {
    runLua(`
install_fake({ sample_rate = 1000, channels = 1, peak_maxima = { 1000000000 }, peak_minima = { -0.5 } })
local summary, failure = measure_item_peaks(make_request({ start_seconds = 0, end_seconds = 0.001 }))
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.reason_code == "ANALYSIS_RESULT_INVALID")
assert(failure.details.api == "GetMediaItemTake_Peaks")
assert(captured == nil)
`);
  });

  it("uses actual accessor rate/channels and reports bounded silence row coverage and thresholds", () => {
    runLua(`
install_fake({ sample_rate = 1000, channels = 1, samples = { 0, 0, 0, 0.5, 0.5, 0, 0, 0, 0, 0 } })
local summary, failure = detect_item_silence(make_request({
  start_seconds = 0,
  end_seconds = 0.01,
  silence_threshold_dbfs = -40,
  min_silence_ms = 2,
  max_segments = 1,
}))
assert(failure == nil)
assert(summary.sample_rate == 1000)
assert(summary.channels == 1)
assert(summary.threshold_dbfs == -40)
assert(summary.total_detected == 2)
assert(summary.returned_count == 1)
assert(summary.truncated == true)
assert(summary.coverage.result_rows_complete == false)
assert(summary.coverage.truncation_reason == "artifact_row_limit")
assert(summary.measurement_basis == "active_take_audio_accessor_pre_fx_samples")
assert(calls.samples[1].sample_rate == 1000)
assert(calls.samples[1].channels == 1)
close(calls.samples[1].starttime, 0)
assert(calls.accessor_starts == 1)
assert(calls.accessor_ends == 1)
assert(summary.coverage.accessor_coordinate_basis == "take_accessor_local_seconds")
assert(captured.payload.analysis_quality_claim == false)
assert(captured.payload.heuristic == true)
assert(calls.destroy == 1)
`);
  });

  it("reads a non-zero-position item on the take-local accessor timeline", () => {
    runLua(`
install_fake({
  position = 37,
  item_length = 2,
  source_type = "VORBIS",
  sample_rate = 1000,
  channels = 1,
  accessor_start = 0,
  accessor_end = 2,
  samples = { 0, 0.5, 0, 0 },
})
local summary, failure = detect_item_transients(make_request({
  start_seconds = 0.25,
  end_seconds = 0.254,
  transient_delta_linear = 0.4,
  min_transient_gap_ms = 1,
}))
assert(failure == nil)
assert(summary.total_detected == 1)
assert(#calls.samples == 1)
close(calls.samples[1].starttime, 0.25)
assert(calls.samples[1].starttime ~= 37.25)
close(summary.coverage.accessor_start_seconds, 0)
close(summary.coverage.accessor_end_seconds, 2)
assert(summary.coverage.accessor_coordinate_basis == "take_accessor_local_seconds")
assert(calls.destroy == 1)
`);
  });

  it("fails closed when accessor bounds or reads cannot prove requested audio", () => {
    runLua(`
install_fake({ item_length = 1, accessor_start = 0.5, accessor_end = 1 })
local summary, failure = detect_item_silence(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "ANALYSIS_RANGE_UNSUPPORTED")
assert(failure.details.coordinate_basis == "take_accessor_local_seconds")
assert(#calls.samples == 0)
assert(calls.destroy == 1)

captured = nil
install_fake({ item_length = 1, accessor_start = 0, accessor_end = 1, sample_status = 0 })
summary, failure = detect_item_silence(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.reason_code == "AUDIO_SAMPLE_READ_EMPTY")
assert(failure.details.block_start_seconds == 0)
assert(captured == nil)
assert(calls.destroy == 1)
`);
  });

  it("allows loop-enabled contiguous ranges but rejects actual wraps", () => {
    runLua(`
install_fake({
  loop_source = 1,
  item_length = 2,
  source_length = 2,
  sample_rate = 10,
  accessor_start = 0,
  accessor_end = 2,
  samples = { 0.5 },
})
local summary, failure = detect_item_silence(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(failure == nil)
assert(summary ~= nil)
assert(#calls.samples == 1)
close(summary.coverage.source_start_seconds, 0)
close(summary.coverage.source_end_seconds, 0.1)

install_fake({ loop_source = 1, item_length = 2, source_length = 1, accessor_start = 0, accessor_end = 2 })
summary, failure = detect_item_silence(make_request({ start_seconds = 0, end_seconds = 2 }))
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "ANALYSIS_RANGE_UNSUPPORTED")
assert(failure.details.loop_source == true)
close(failure.details.source_length_seconds, 1)
close(failure.details.source_end_seconds, 2)
assert(#calls.samples == 0)
`);
  });

  it("keeps reversed and stretch-mapped accessor heuristics outside the repaired claim", () => {
    runLua(`

install_fake({ reverse = 1 })
local summary, failure = detect_item_transients(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "ANALYSIS_RANGE_UNSUPPORTED")
assert(failure.details.reverse == true)
assert(#calls.samples == 0)

install_fake({ stretch_marker_count = 1 })
summary, failure = detect_item_silence(make_request({ start_seconds = 0, end_seconds = 0.1 }))
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "ANALYSIS_RANGE_UNSUPPORTED")
assert(failure.details.stretch_marker_count == 1)
assert(#calls.samples == 0)
`);
  });

  it("keeps transient thresholds configurable and reports returned versus total detections", () => {
    runLua(`
install_fake({ sample_rate = 1000, channels = 1, samples = { 0, 0.5, 0, 0.6, 0, 0, 0, 0 } })
local summary, failure = detect_item_transients(make_request({
  start_seconds = 0,
  end_seconds = 0.008,
  transient_delta_linear = 0.4,
  min_transient_gap_ms = 1,
  max_transients = 1,
}))
assert(failure == nil)
assert(summary.transient_delta_linear == 0.4)
assert(summary.transient_count == 1)
assert(summary.total_detected == 2)
assert(summary.truncated == true)
assert(summary.coverage.result_rows_complete == false)
assert(captured.payload.measurement.confidence == "heuristic_threshold_crossing_only")
`);
  });
});
