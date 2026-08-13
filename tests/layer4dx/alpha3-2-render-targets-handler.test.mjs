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
    assert.equal(bridgeRequest.pack.risk, "write");
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
    recoverable = false,
  },
})
assert(result == nil)
assert(failure.code == "VERIFY_FAILED")
assert(failure.details.local_code == "RENDER_OUTPUT_ALL_ZERO")
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
    assert.doesNotMatch(HANDLER, /os\.remove\(project_copy_path\)/);
    assert.doesNotMatch(HANDLER, /os\.remove\(output\.absolute_path\)/);
    assert.match(HANDLER, /render_target_collision/);
    assert.match(HANDLER, /requested_basename or/);
    assert.match(HANDLER, /request\.params\.output_basename/);
    assert.match(HANDLER, /OUTPUT_BASENAME_INVALID/);
    assert.match(HANDLER, /root_ready, root_blocker, root_message = d31_root_ready\(\)/);
    assert.match(HANDLER, /restoration = \{ render_settings = true, track_selection = true, item_selection = true \}/);
    assert.match(ARTIFACT_HELPER, /\["run_job:render\.targets"\] = true/);
    assert.match(ROUTE_POLICY, /\["run_job:render\.targets"\] = \{ pack = "render", risk = "write" \}/);
    assert.match(ROUTE_POLICY, /operation_key == "run_job:render\.targets" or template_execute_write_capability/);
    assert.match(ROUTE_POLICY, /D31 render targets does not accept an idempotency_key/);
    assert.match(DISPATCH, /\["run_job:render\.targets"\]\s*=\s*\{\s*pack = "render",\s*handler = d31_render_targets,/s);
    assert.match(BRIDGE, /\["run_job:render\.targets"\]\s*=/);

    const preflight = HANDLER.indexOf("local preflight_ok, preflight_error = d31_preflight(request, outputs)");
    const firstAction = HANDLER.indexOf("local action_ok = call_reaper(\"Main_OnCommandEx\", D31_ACTION_ID, 0, project)");
    const rejectAllZero = HANDLER.indexOf("if measurement.is_silent == true then return { failure = { code = \"RENDER_OUTPUT_ALL_ZERO\"");
    const finish = HANDLER.indexOf("local finished_outcome, finish_error = d31_finish_render_attempt");
    assert.ok(preflight >= 0 && preflight < firstAction, "collision preflight occurs before the first audited action");
    assert.ok(firstAction >= 0 && firstAction < finish, "restoration closure runs after any action attempt");
    assert.ok(firstAction < rejectAllZero && rejectAllZero < finish, "all-zero output enters the protected failure path before restoration");
  });
});
