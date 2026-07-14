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
const { lua, lauxlib, to_jsstring, to_luastring } = require("fengari");

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

  it("uses audited codec blobs with the expected raw WAV and OGG layouts", () => {
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
    const restore = HANDLER.indexOf("local settings_restored, failed_settings = d31_restore_settings(project, settings)");
    const failureReturn = HANDLER.indexOf("if not call_ok then return d31_error(\"INTERNAL_ERROR\"");
    assert.ok(preflight >= 0 && preflight < firstAction, "collision preflight occurs before the first audited action");
    assert.ok(firstAction >= 0 && firstAction < restore, "restoration runs after any action attempt");
    assert.ok(restore >= 0 && restore < failureReturn, "unexpected render failure returns only after restoration");
  });
});
