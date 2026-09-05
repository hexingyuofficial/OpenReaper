import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D29_RENDER_OUTPUT_POLICY_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_jsstring, to_luastring } = require("fengari");

const HANDLER = readFileSync(
  new URL("../../reaper/bridge/src/handlers/render/d31_render_targets_route.lua", import.meta.url),
  "utf8",
);
const ARTIFACT_HELPER = readFileSync(
  new URL("../../reaper/bridge/src/30-artifact-helper.lua", import.meta.url),
  "utf8",
);
const ROUTE_POLICY = readFileSync(
  new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url),
  "utf8",
);
const DISPATCH = readFileSync(
  new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url),
  "utf8",
);
const BRIDGE = readFileSync(
  new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url),
  "utf8",
);

function context(overrides = {}) {
  return {
    session_id: "d31-test-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-11T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function wholeProjectWavInput() {
  return {
    target_kind: "whole_project",
    format: "wav",
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: 48_000,
    channel_count: 2,
    wav_bit_depth: 24,
    max_targets: 1,
  };
}

function runHandlerLua(body, exposedFunctions = []) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  let source = HANDLER;
  for (const name of exposedFunctions) {
    source = source.replace(`local function ${name}`, `function ${name}`);
  }
  const prelude = String.raw`
JSON_NULL = {}
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
function is_object(value) return type(value) == "table" end
function bounded_string(value) return tostring(value or "") end
function json_array(value) return value or {} end
`;
  const status = lauxlib.luaL_loadstring(state, to_luastring(`${prelude}\n${source}\n${body}\nreturn true`));
  if (status !== lua.LUA_OK) throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

function isoAtom(type, payload = Buffer.alloc(0)) {
  const size = Buffer.alloc(4);
  size.writeUInt32BE(payload.length + 8);
  return Buffer.concat([size, Buffer.from(type, "ascii"), payload]);
}

function isoVideoFixture({ brand, width, height, frameRate, quickTimeDataHandler = false }) {
  const u32 = (value) => {
    const bytes = Buffer.alloc(4);
    bytes.writeUInt32BE(value);
    return bytes;
  };
  const fixed = (value) => u32(value * 65536);
  const hdlr = (kind) => isoAtom("hdlr", Buffer.concat([Buffer.alloc(8), Buffer.from(kind, "ascii"), Buffer.alloc(12)]));
  const mdhd = isoAtom("mdhd", Buffer.concat([Buffer.alloc(12), u32(frameRate * 1000), u32(frameRate * 1000), Buffer.alloc(4)]));
  const stts = isoAtom("stts", Buffer.concat([Buffer.alloc(4), u32(1), u32(frameRate), u32(1000)]));
  const stsd = (codec) => isoAtom("stsd", Buffer.concat([Buffer.alloc(8), isoAtom(codec, Buffer.alloc(8))]));
  const videoTkhd = isoAtom("tkhd", Buffer.concat([Buffer.alloc(72), fixed(width), fixed(height)]));
  const dataHandler = quickTimeDataHandler ? isoAtom("dinf", hdlr("alis")) : Buffer.alloc(0);
  const videoMdia = isoAtom("mdia", Buffer.concat([hdlr("vide"), mdhd, isoAtom("minf", Buffer.concat([dataHandler, isoAtom("stbl", Buffer.concat([stts, stsd("avc1")]))]))]));
  const audioMdia = isoAtom("mdia", Buffer.concat([hdlr("soun"), mdhd, isoAtom("minf", Buffer.concat([dataHandler, isoAtom("stbl", Buffer.concat([stts, stsd("mp4a")]))]))]));
  const ftyp = isoAtom("ftyp", Buffer.concat([Buffer.from(brand, "ascii"), u32(0), Buffer.from(brand, "ascii")]));
  return Buffer.concat([ftyp, isoAtom("moov", Buffer.concat([isoAtom("trak", Buffer.concat([videoTkhd, videoMdia])), isoAtom("trak", audioMdia)])), isoAtom("mdat", Buffer.from([1, 2, 3, 4]))]);
}

describe("Alpha3.2 D31 render-targets bridge route", () => {
  it("exposes an exact D31 live allowlist while retaining the fixed D29 registry route membership", () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS, [
      "template.render.render_targets",
    ]);
    assert.equal(
      CALL_TEMPLATE_RUNTIME_D29_RENDER_OUTPUT_POLICY_TEMPLATE_IDS.includes("template.render.render_targets"),
      true,
    );
  });

  it("live-gates the real run_job descriptor without accepting raw render paths", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS,
      },
    });
    const response = await runtime.call_template({
      id: "template.render.render_targets",
      input: wholeProjectWavInput(),
      refs: {},
      context: context(),
    });

    assert.equal(response.ok, true);
    assert.deepEqual(runtime.live_gate.allowed_template_ids, CALL_TEMPLATE_RUNTIME_D31_RENDER_TARGETS_TEMPLATE_IDS);
    const bridgeRequest = bridge.seen[0];
    assert.equal(bridgeRequest.operation.family, "run_job");
    assert.equal(bridgeRequest.operation.name, "render.targets");
    assert.equal(bridgeRequest.pack.risk, "destructive");
    assert.equal(bridgeRequest.undo.mode, "required");
    assert.equal(Object.hasOwn(bridgeRequest, "idempotency_key"), false);
    assert.equal(Object.hasOwn(bridgeRequest.params, "output_path"), false);
    assert.equal(Object.hasOwn(bridgeRequest.params, "output_directory"), false);
  });

  it("parses the extracted D31 handler before bridge generation", () => {
    const state = lauxlib.luaL_newstate();
    const status = lauxlib.luaL_loadstring(state, to_luastring(HANDLER));
    const message = status === lua.LUA_OK ? "D31 Lua parsed" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(status, lua.LUA_OK, message);
  });

  it("executes native compressed-output peak measurement for non-zero and all-zero streams and always destroys the source", () => {
    runHandlerLua(String.raw`
local function install(peaks)
  local source = {}
  local destroyed = 0
  reaper = {
    PCM_Source_CreateFromFile = function(path) assert(path == "/tmp/render.ogg"); return source end,
    GetMediaSourceLength = function(actual) assert(actual == source); return 0.004, false end,
    GetMediaSourceSampleRate = function(actual) assert(actual == source); return 48000 end,
    GetMediaSourceNumChannels = function(actual) assert(actual == source); return 2 end,
    new_array = function(size)
      local values = {}
      return { values = values, table = function() return values end }
    end,
    PCM_Source_GetPeaks = function(actual, rate, start, channels, requested, extra, buffer)
      assert(actual == source and rate == 1000 and channels == 2 and extra == 0)
      local count = requested * channels
      for index = 1, count * 2 do buffer.values[index] = peaks[((index - 1) % #peaks) + 1] end
      return requested
    end,
    PCM_Source_Destroy = function(actual) assert(actual == source); destroyed = destroyed + 1 end,
  }
  return function() return destroyed end
end

local destroyed = install({ 0, 0.25, -0.5, 0 })
local measured, failure = d31_measure_native_peaks("/tmp/render.ogg", "ogg")
assert(failure == nil)
assert(measured.is_silent == false)
assert(measured.silence_classification == "non_silent")
assert(measured.peak_linear == 0.5)
assert(measured.measurement_format == "ogg_native_peaks")
assert(destroyed() == 1)

destroyed = install({ 0 })
measured, failure = d31_measure_native_peaks("/tmp/render.ogg", "ogg")
assert(failure == nil)
assert(measured.is_silent == true)
assert(measured.silence_classification == "all_zero")
assert(measured.peak_linear == 0)
assert(destroyed() == 1)
`, ["d31_measure_native_peaks"]);
  });

  it("executes restoration before returning a typed all-zero render failure", () => {
    let source = HANDLER
      .replace("local function d31_finish_render_attempt", "function d31_finish_render_attempt")
      .replace("local function d31_restore_settings", "function d31_restore_settings")
      .replace("local function d31_apply_track_selection", "function d31_apply_track_selection")
      .replace("local function d31_apply_item_selection", "function d31_apply_item_selection");
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const script = String.raw`
JSON_NULL = {}
function is_object(value) return type(value) == "table" end
function bounded_string(value) return tostring(value or "") end
function json_array(value) return value or {} end
function call_reaper() return false end
${source}
local order = {}
d31_restore_settings = function() order[#order + 1] = "settings"; return true, {} end
d31_apply_track_selection = function() order[#order + 1] = "tracks"; return true end
d31_apply_item_selection = function() order[#order + 1] = "items"; return true end
local result, failure = d31_finish_render_attempt({}, {}, {}, {}, true, {
  failure = {
    code = "RENDER_OUTPUT_ALL_ZERO",
    message = "all zero",
    details = { silence_classification = "all_zero" },
    recoverable = true,
  },
})
assert(result == nil)
assert(failure.code == "VERIFY_FAILED")
assert(failure.details.local_code == "RENDER_OUTPUT_ALL_ZERO")
assert(failure.recoverable == true)
assert(order[1] == "settings" and order[2] == "tracks" and order[3] == "items")
return true
`;
    const status = lauxlib.luaL_loadstring(state, to_luastring(script));
    if (status !== lua.LUA_OK) throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
    const callStatus = lua.lua_pcall(state, 0, 1, 0);
    if (callStatus !== lua.LUA_OK) throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
    assert.equal(lua.lua_toboolean(state, -1), true);
    lua.lua_close(state);
  });

  it("chooses one deterministic suffix for a Chinese multi-target batch", () => {
    runHandlerLua(String.raw`
RENDER_ROOT = "/tmp/渲染 输出"
path_join = function(root, name) return root .. "/" .. name end
file_exists = function(path)
  return path:find("中文 混音_01.wav", 1, true) ~= nil
    or path:find("中文 混音_02.wav", 1, true) ~= nil
    or path:find("中文 混音_1_", 1, true) ~= nil
end
d31_size = function() return 4096 end
local request = { id = "suffix-test", params = { collision_policy = "suffix" } }
local targets = {
  { source_name = "A", label = "A" },
  { source_name = "B", label = "B" },
}
local outputs, suffix_index = d31_resolve_outputs(request, targets, "wav", "中文 混音")
assert(outputs ~= nil and suffix_index == 2)
assert(outputs[1].output_basename == "中文 混音_2_01")
assert(outputs[2].output_basename == "中文 混音_2_02")
assert(outputs[1].absolute_path == "/tmp/渲染 输出/中文 混音_2_01.wav")
`, ["d31_resolve_outputs", "file_exists", "d31_size"]);
  });

  it("uses audited codec blobs with the expected raw WAV, OGG, and native MP3 layouts", () => {
    const wav16 = Buffer.from("ZXZhdxADAA==", "base64");
    const wav24 = Buffer.from("ZXZhdxgDAA==", "base64");
    assert.equal(wav16.toString("hex"), "65766177100300");
    assert.equal(wav24.toString("hex"), "65766177180300");
    assert.equal(wav16.subarray(0, 4).toString("ascii"), "evaw");
    assert.equal(wav24.subarray(0, 4).toString("ascii"), "evaw");
    assert.match(HANDLER, /\[16\] = "ZXZhdxADAA=="/);
    assert.match(HANDLER, /\[24\] = "ZXZhdxgDAA=="/);

    for (const [quality, encoded] of Object.entries({
      0.3: "dmdnb5qZmT4AAAAAAAAAAAAAAAAAAAAAAAA=",
      0.5: "dmdnbwAAAD8AAAAAAAAAAAAAAAAAAAAAAAA=",
      0.6: "dmdnb5qZGT8AAAAAAAAAAAAAAAAAAAAAAAA=",
      0.8: "dmdnb83MTD8AAAAAAAAAAAAAAAAAAAAAAAA=",
      1.0: "dmdnbwAAgD8AAAAAAAAAAAAAAAAAAAAAAAA=",
    })) {
      const raw = Buffer.from(encoded, "base64");
      assert.equal(raw.length, 26, quality);
      assert.equal(raw.subarray(0, 4).toString("ascii"), "vggo", quality);
      assert.ok(Math.abs(raw.readFloatLE(4) - Number(quality)) < 1e-6, quality);
      assert.equal(raw[8], 0, quality);
      assert.equal(raw.readInt32LE(9), 0, quality);
      assert.equal(raw.readInt32LE(13), 0, quality);
      assert.equal(raw.readInt32LE(17), 0, quality);
      assert.equal(raw.readInt32LE(21), 0, quality);
      assert.equal(raw[25], 0, quality);
    }

    for (const [bitrate, encoded] of Object.entries({
      128: "bDNwbYAAAAAAAAAAAAAAAP////8EAAAAgAAAAAAAAAA=",
      192: "bDNwbcAAAAAAAAAAAAAAAP////8EAAAAwAAAAAAAAAA=",
      256: "bDNwbQABAAAAAAAAAAAAAP////8EAAAAAAEAAAAAAAA=",
      320: "bDNwbUABAAAAAAAAAAAAAP////8EAAAAQAEAAAAAAAA=",
    })) {
      const raw = Buffer.from(encoded, "base64");
      assert.equal(raw.length, 32, bitrate);
      assert.equal(raw.subarray(0, 4).toString("ascii"), "l3pm", bitrate);
      assert.match(HANDLER, new RegExp(`\\[${bitrate}\\] = "${encoded}"`));
    }
  });

  it("builds the exact audited AVFoundation MP4 and MOV blobs", () => {
    runHandlerLua(String.raw`
local mp4, mp4_error = d31_format({
  format = "mp4", video_width = 1920, video_height = 1080, video_frame_rate = 30,
  video_codec = "h264", video_bitrate_kbps = 2048, audio_codec = "aac", audio_bitrate_kbps = 128,
})
assert(mp4_error == nil)
assert(mp4.config == "RlZBWAAAAAAAAAAAAAgAAAAAAACAAAAAgAcAADgEAAAAAPBBAQAAAF8AAAAAAA==")
assert(mp4.extension == "mp4" and mp4.video == true)

local mov, mov_error = d31_format({
  format = "mov", video_width = 1280, video_height = 720, video_frame_rate = 24,
  video_codec = "h264", video_bitrate_kbps = 4096, audio_codec = "aac", audio_bitrate_kbps = 192,
})
assert(mov_error == nil)
assert(mov.config == "RlZBWAIAAAAAAAAAABAAAAAAAADAAAAAAAUAANACAAAAAMBBAQAAAF8AAAAAAA==")
assert(mov.extension == "mov" and mov.video == true)

local invalid, invalid_error = d31_format({
  format = "mp4", video_width = 1919, video_height = 1080, video_frame_rate = 30,
  video_codec = "h264", video_bitrate_kbps = 8000, audio_codec = "aac", audio_bitrate_kbps = 192,
})
assert(invalid == nil and invalid_error.code == "PARAMS_INVALID")
assert(invalid_error.details.local_code == "VIDEO_WIDTH_REQUIRED")
`, ["d31_format"]);
  });

  it("probes MP4/MOV atoms, H.264/AAC tracks, dimensions, and frame rate", () => {
    const mp4Hex = isoVideoFixture({ brand: "mp42", width: 1920, height: 1080, frameRate: 30 }).toString("hex");
    const movHex = isoVideoFixture({ brand: "qt  ", width: 1280, height: 720, frameRate: 24, quickTimeDataHandler: true }).toString("hex");
    runHandlerLua(String.raw`
local function from_hex(value) return (value:gsub("..", function(pair) return string.char(tonumber(pair, 16)) end)) end
local fixtures = { ["/fixture.mp4"] = from_hex(${JSON.stringify(mp4Hex)}), ["/fixture.mov"] = from_hex(${JSON.stringify(movHex)}) }
io.open = function(path_value, mode)
  local bytes = fixtures[path_value]
  if not bytes or mode ~= "rb" then return nil end
  local position = 0
  return {
    seek = function(_, whence, offset)
      if whence == "end" then position = #bytes
      elseif whence == "set" then position = offset or 0
      elseif whence == "cur" then position = position + (offset or 0) end
      return position
    end,
    read = function(_, count)
      local value = bytes:sub(position + 1, position + count)
      position = position + #value
      return value
    end,
    close = function() end,
  }
end

local mp4_ok, mp4_format, _, mp4 = d31_probe_output("/fixture.mp4", "mp4")
assert(mp4_ok == true and mp4_format == "mp4")
assert(mp4.ftyp_verified and mp4.moov_verified and mp4.mdat_verified)
assert(mp4.video_track_count == 1 and mp4.audio_track_count == 1)
assert(mp4.width == 1920 and mp4.height == 1080 and math.abs(mp4.frame_rate - 30) < 0.001)
assert(mp4.video_codec == "h264" and mp4.audio_codec == "aac")

local mov_ok, mov_format, _, mov = d31_probe_output("/fixture.mov", "mov")
assert(mov_ok == true and mov_format == "mov")
assert(mov.width == 1280 and mov.height == 720 and math.abs(mov.frame_rate - 24) < 0.001)
assert(mov.major_brand == "qt  ")
`, ["d31_probe_output"]);
  });

  it("waits for REAPER to commit the final MP4/MOV container after AVFoundation returns", () => {
    runHandlerLua(String.raw`
local tick = 0
local polls = 0
d31_monotonic_seconds = function()
  tick = tick + 0.01
  return tick
end
d31_size = function(path_value)
  assert(path_value == "/managed/render.mp4")
  polls = polls + 1
  return polls < 3 and 0 or 65536
end
d31_probe_output = function(path_value, extension)
  assert(path_value == "/managed/render.mp4" and extension == "mp4")
  return true, "mp4", nil, { ok = true, width = 1920, height = 1080, frame_rate = 30, video_codec = "h264", audio_codec = "aac" }
end
local size, ok, actual_format, bitrate, probe, attempts = d31_wait_for_final_video("/managed/render.mp4", "mp4")
assert(size == 65536 and ok == true and actual_format == "mp4" and bitrate == nil)
assert(probe.video_codec == "h264" and probe.audio_codec == "aac")
assert(attempts == 3 and polls == 3)
`, ["d31_monotonic_seconds", "d31_size", "d31_probe_output", "d31_wait_for_final_video"]);
  });

  it("uses audited project-render APIs with strict target refs, preflight, verification, and restoration", () => {
    assert.doesNotMatch(HANDLER, /RenderFileSection\s*\(/);
    assert.match(HANDLER, /GetSetProjectInfo/);
    assert.match(HANDLER, /GetSetProjectInfo_String/);
    assert.match(HANDLER, /RENDER_SETTINGS/);
    assert.match(HANDLER, /RENDER_BOUNDSFLAG/);
    assert.match(HANDLER, /RENDER_PATTERN/);
    assert.match(HANDLER, /RENDER_FORMAT2/);
    assert.match(HANDLER, /RENDER_ADDTOPROJ/);
    assert.match(HANDLER, /RENDER_TAILFLAG/);
    assert.match(HANDLER, /RENDER_TAILMS/);
    assert.match(HANDLER, /RENDER_NORMALIZE/);
    assert.match(HANDLER, /RENDER_DITHER/);
    assert.match(HANDLER, /local ok_count, _, marker_count, region_count = call_reaper\("CountProjectMarkers", project\)/);
    assert.match(HANDLER, /Main_OnCommandEx", D31_ACTION_ID, 0, project/);
    assert.match(HANDLER, /D31_ACTION_ID = 41824/);
    assert.match(HANDLER, /D31_MEDIA_ONLINE_ACTION_ID = 40101/);
    assert.match(HANDLER, /D31_VIDEO_FINALIZATION_WAIT_SECONDS = 5/);
    assert.match(HANDLER, /d31_wait_for_final_video/);
    assert.match(HANDLER, /d31_target_source_preflight/);
    assert.match(HANDLER, /RENDER_SOURCE_OFFLINE/);
    assert.match(HANDLER, /RENDER_SOURCE_READBACK_UNAVAILABLE = "VERIFY_FAILED"/);
    assert.match(HANDLER, /RENDER_SOURCE_OFFLINE = "FILE_NOT_FOUND"/);
    assert.match(HANDLER, /target\.ref:match\("\^item:guid:/);
    assert.match(HANDLER, /GetSetMediaItemInfo_String", item, "GUID"/);
    assert.match(HANDLER, /target\.ref:match\("\^track:guid:/);
    assert.match(HANDLER, /GetTrackGUID", item_track/);
    assert.match(HANDLER, /GetMediaItem_Track/);
    assert.match(HANDLER, /GetMediaSourceFileName/);
    assert.match(HANDLER, /Set all media online/);
    assert.match(HANDLER, /TARGET_REFS_REQUIRED/);
    assert.match(HANDLER, /TARGET_REFS_FORBIDDEN/);
    assert.match(HANDLER, /TARGET_COUNT_EXCEEDED/);
    assert.match(HANDLER, /d31_preflight/);
    assert.match(HANDLER, /d31_restore_settings/);
    assert.match(HANDLER, /d31_apply_track_selection/);
    assert.match(HANDLER, /d31_apply_item_selection/);
    assert.match(HANDLER, /D31_ERROR_CODE_MAP/);
    assert.doesNotMatch(HANDLER, /for index = 0, math\.max\(0, math\.floor\(count\) - 1\) do/);
    assert.match(HANDLER, /a2_artifact_root_ready/);
    assert.match(HANDLER, /write_a2_artifact/);
    assert.match(HANDLER, /header:sub\(1, 4\) == "OggS"/);
    assert.match(HANDLER, /header:sub\(1, 4\) == "RIFF"/);
    assert.match(HANDLER, /layer_bits == 1/);
    assert.match(HANDLER, /actual_bitrate ~= format\.mp3_bitrate_kbps/);
    assert.match(HANDLER, /d31_measure_wav_pcm/);
    assert.match(HANDLER, /d31_measure_native_peaks/);
    assert.match(HANDLER, /PCM_Source_CreateFromFile/);
    assert.match(HANDLER, /PCM_Source_GetPeaks/);
    assert.match(HANDLER, /PCM_Source_Destroy/);
    assert.match(HANDLER, /RENDER_OUTPUT_ALL_ZERO = "VERIFY_FAILED"/);
    assert.match(HANDLER, /if measurement\.is_silent == true then return \{ failure = \{ code = "RENDER_OUTPUT_ALL_ZERO"/);
    assert.match(HANDLER, /d31_pcm_sample/);
    assert.match(HANDLER, /measured_peak_linear/);
    assert.match(HANDLER, /measured_rms_linear/);
    assert.match(HANDLER, /silence_classification = all_zero and "all_zero" or "non_silent"/);
    assert.doesNotMatch(HANDLER, /measurement_status = "unavailable"/);
    assert.match(HANDLER, /d31_get_string\(project, "RENDER_FORMAT"\) ~= format\.config/);
    assert.match(HANDLER, /requested_format = request\.params\.format/);
    assert.match(HANDLER, /target_identity = target\.ref or target\.label/);
    assert.match(HANDLER, /generated_project_copy_retained/);
    assert.match(HANDLER, /output\.absolute_path \.\. "\.RPP"/);
    assert.match(HANDLER, /os\.remove\(project_copy_path\)/);
    assert.match(HANDLER, /os\.remove\(output\.absolute_path\)/);
    assert.match(HANDLER, /collision_policy == "overwrite"/);
    assert.match(HANDLER, /for suffix_index = 0, 9999 do/);
    assert.match(HANDLER, /existing_size_bytes = d31_size/);
    assert.match(HANDLER, /zero_write = true/);
    assert.match(HANDLER, /render_target_collision/);
    assert.match(HANDLER, /requested_basename or/);
    assert.match(HANDLER, /request\.params\.output_basename/);
    assert.match(HANDLER, /OUTPUT_BASENAME_INVALID/);
    assert.match(HANDLER, /root_ready, root_blocker, root_message = d31_root_ready\(\)/);
    assert.match(HANDLER, /restoration = \{ render_settings = true, track_mix = true, track_selection = true, item_selection = true \}/);
    assert.match(ARTIFACT_HELPER, /\["run_job:render\.targets"\] = true/);
    assert.match(ROUTE_POLICY, /\["run_job:render\.targets"\] = \{ pack = "render", risk = "destructive" \}/);
    assert.match(ROUTE_POLICY, /operation_key == "run_job:render\.targets" or template_execute_write_capability/);
    assert.match(ROUTE_POLICY, /D31 render targets does not accept an idempotency_key/);
    assert.match(DISPATCH, /\["run_job:render\.targets"\]\s*=\s*\{\s*pack = "render",\s*handler = d31_render_targets,/s);
    assert.match(BRIDGE, /\["run_job:render\.targets"\]\s*=/);

    const preflight = HANDLER.indexOf("local preflight_ok, preflight_error = d31_preflight(request, outputs)");
    const mediaOnlineAction = HANDLER.indexOf("local online_ok = call_reaper(\"Main_OnCommandEx\", D31_MEDIA_ONLINE_ACTION_ID, 0, project)");
    const sourcePreflight = HANDLER.indexOf("local source_ready, source_error = d31_target_source_preflight(project, target)");
    const overwriteRemoval = HANDLER.indexOf("overwrite, overwrite_error = d31_remove_overwrite_target(output)");
    const firstAction = HANDLER.indexOf("local action_ok = call_reaper(\"Main_OnCommandEx\", D31_ACTION_ID, 0, project)");
    const rejectAllZero = HANDLER.indexOf("if measurement.is_silent == true then return { failure = { code = \"RENDER_OUTPUT_ALL_ZERO\"");
    const finish = HANDLER.indexOf("local finished_outcome, finish_error = d31_finish_render_attempt");
    assert.ok(preflight >= 0 && preflight < firstAction, "collision preflight occurs before the first audited action");
    assert.ok(mediaOnlineAction >= 0 && mediaOnlineAction < sourcePreflight, "media is brought online before source verification");
    assert.ok(sourcePreflight >= 0 && sourcePreflight < firstAction, "source verification gates the first render action");
    assert.ok(sourcePreflight < overwriteRemoval && overwriteRemoval < firstAction, "overwrite removes only the exact old output after source preflight and before the render action");
    assert.ok(firstAction >= 0 && firstAction < finish, "restoration closure runs after any action attempt");
    assert.ok(firstAction < rejectAllZero && rejectAllZero < finish, "all-zero output enters the protected failure path before restoration");
  });

  it("imports and verifies one Stem before muting its exact source Tracks", () => {
    const createSource = HANDLER.indexOf('call_reaper("PCM_Source_CreateFromFile", output.absolute_path)');
    const attachSource = HANDLER.indexOf('call_reaper("SetMediaItemTake_Source", take, source)');
    const verifySource = HANDLER.indexOf('first_string(actual_path) ~= output.absolute_path');
    const muteSources = HANDLER.indexOf('d31_write_track_number(target.tracks[index], "B_MUTE", 1)');
    assert.ok(createSource >= 0 && createSource < attachSource, "verified output is reopened before attachment");
    assert.ok(attachSource < verifySource && verifySource < muteSources, "exact imported source readback gates source muting");
    assert.match(HANDLER, /destination_track_count = 1/);
    assert.match(HANDLER, /destination_item_count = 1/);
    assert.match(HANDLER, /destination_take_count = 1/);
    assert.match(HANDLER, /source_tracks_muted = true/);
    assert.match(HANDLER, /non_silent_verified = output\.is_silent == false/);
  });

  it("rolls a failed Stem import back by deleting the destination and restoring mix and selections", () => {
    const rollback = HANDLER.indexOf("local function d31_stem_rollback");
    const deleteTrack = HANDLER.indexOf('call_reaper("DeleteTrack", context.created_track)', rollback);
    const restoreMix = HANDLER.indexOf("d31_restore_track_mix(context and context.mix_snapshot)", rollback);
    const restoreTracks = HANDLER.indexOf("d31_apply_track_selection(project, context and context.prior_tracks", rollback);
    const restoreItems = HANDLER.indexOf("d31_apply_item_selection(project, context and context.prior_items", rollback);
    assert.ok(rollback >= 0 && deleteTrack > rollback);
    assert.ok(deleteTrack < restoreMix && restoreMix < restoreTracks && restoreTracks < restoreItems);
    assert.match(HANDLER, /if stem_context then d31_stem_rollback\(project, stem_context\) end/);
  });
});
