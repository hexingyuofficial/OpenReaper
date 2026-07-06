import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/transport/d12_transport_safe_route.lua", import.meta.url),
  "utf8",
);
const CAPABILITIES = Object.freeze([
  "transport.play",
  "transport.pause",
  "transport.stop_playback",
  "transport.set_playback_rate",
  "transport.start_recording",
  "transport.stop_recording",
  "transport.set_record_mode",
  "transport.set_punch_record_range",
  "transport.schedule_recording",
]);
const RISK_BY_CAPABILITY = Object.freeze({
  "transport.play": "safe",
  "transport.pause": "safe",
  "transport.stop_playback": "safe",
  "transport.set_playback_rate": "safe",
  "transport.start_recording": "write",
  "transport.stop_recording": "write",
  "transport.set_record_mode": "safe",
  "transport.set_punch_record_range": "safe",
  "transport.schedule_recording": "write",
});

describe("D12 transport safe live handler expansion", () => {
  it("registers exactly the bounded transport safe batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d12-transport-safe-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the nine D12 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS, [
      "template.transport.play",
      "template.transport.pause",
      "template.transport.stop_playback",
      "template.transport.set_playback_rate",
      "template.transport.start_recording",
      "template.transport.stop_recording",
      "template.transport.set_record_mode",
      "template.transport.set_punch_record_range",
      "template.transport.schedule_recording",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS,
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d12Input(id),
        refs: {},
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(CALL_TEMPLATE_RUNTIME_D12_TRANSPORT_SAFE_TEMPLATE_IDS.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "transport");
      assert.equal(request.pack.risk, RISK_BY_CAPABILITY[request.pack.capability]);
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(Array.isArray(request.refs), true);
      assert.equal(request.refs.length, 0);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
  });

  it("binds transport controls through template.execute without raw execution surfaces", () => {
    for (const capability of CAPABILITIES) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handlerExport(capability)}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    assert.match(HANDLER_SOURCE, /GetPlayState/);
    assert.match(HANDLER_SOURCE, /OnPlayButtonEx/);
    assert.match(HANDLER_SOURCE, /CSurf_OnPlay/);
    assert.match(HANDLER_SOURCE, /OnPlayButton/);
    assert.match(HANDLER_SOURCE, /OnPauseButtonEx/);
    assert.match(HANDLER_SOURCE, /CSurf_OnPause/);
    assert.match(HANDLER_SOURCE, /OnPauseButton/);
    assert.match(HANDLER_SOURCE, /OnStopButtonEx/);
    assert.match(HANDLER_SOURCE, /OnStopButton/);
    assert.match(HANDLER_SOURCE, /CSurf_OnRecord/);
    assert.match(HANDLER_SOURCE, /CSurf_OnStop/);
    assert.match(HANDLER_SOURCE, /D12_TRANSPORT_FIXED_ACTION_IDS/);
    assert.match(HANDLER_SOURCE, /play = 1007/);
    assert.match(HANDLER_SOURCE, /pause = 1008/);
    assert.match(HANDLER_SOURCE, /record = 1013/);
    assert.match(HANDLER_SOURCE, /stop = 1016/);
    assert.match(HANDLER_SOURCE, /Main_OnCommandEx/);
    assert.match(HANDLER_SOURCE, /SetPlayRate/);
    assert.match(HANDLER_SOURCE, /GetSetProjectInfo/);
    assert.match(HANDLER_SOURCE, /GetSet_LoopTimeRange/);
    assert.doesNotMatch(HANDLER_SOURCE, /request\.params\.(?:action|command|command_id|lua|script|shell)/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function d12Input(id) {
  if (id === "template.transport.set_playback_rate") {
    return { playback_rate: 1, preserve_pitch: true };
  }
  if (id === "template.transport.start_recording") {
    return { require_armed_track: false, respect_punch_range: false };
  }
  if (id === "template.transport.stop_recording") {
    return { recorded_media_policy: "keep" };
  }
  if (id === "template.transport.set_record_mode") {
    return { mode: "normal" };
  }
  if (id === "template.transport.set_punch_record_range") {
    return { start_seconds: 1, end_seconds: 2 };
  }
  if (id === "template.transport.schedule_recording") {
    return {
      start_seconds: 1,
      end_seconds: 2,
      mode: "time_selection_auto_punch",
      require_armed_track: false,
    };
  }
  return {};
}

function context(extra = {}) {
  return {
    session_id: "test-session",
    request_id: "test-request",
    expected_owner: "owner-test",
    expected_generation: 1,
    ...extra,
  };
}

function handlerExport(capability) {
  return {
    "transport.play": "OPENREAPER_HANDLER_EXPORTS.d12_transport_play",
    "transport.pause": "OPENREAPER_HANDLER_EXPORTS.d12_transport_pause",
    "transport.stop_playback": "OPENREAPER_HANDLER_EXPORTS.d12_transport_stop_playback",
    "transport.set_playback_rate": "OPENREAPER_HANDLER_EXPORTS.d12_transport_set_playback_rate",
    "transport.start_recording": "OPENREAPER_HANDLER_EXPORTS.d12_transport_start_recording",
    "transport.stop_recording": "OPENREAPER_HANDLER_EXPORTS.d12_transport_stop_recording",
    "transport.set_record_mode": "OPENREAPER_HANDLER_EXPORTS.d12_transport_set_record_mode",
    "transport.set_punch_record_range": "OPENREAPER_HANDLER_EXPORTS.d12_transport_set_punch_record_range",
    "transport.schedule_recording": "OPENREAPER_HANDLER_EXPORTS.d12_transport_schedule_recording",
  }[capability];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
