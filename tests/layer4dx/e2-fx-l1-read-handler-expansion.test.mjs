import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url), "utf8");
const E2_FX_L1_FLAG = "--fx-read";
const E2_FX_L1_OPT_IN_ENV = "OPENREAPER_E2_FX_L1_READ_LIVE_SMOKE";
const E2_FX_TRACK_REF_ENV = "OPENREAPER_E2_FX_TRACK_REF";
const E2_FX_TAKE_REF_ENV = "OPENREAPER_E2_FX_TAKE_REF";
const E2_FX_REF_ENV = "OPENREAPER_E2_FX_REF";
const E2_FX_PARAM_INDEX_ENV = "OPENREAPER_E2_FX_PARAM_INDEX";
const E2_FX_L1_OPERATION_KEYS = Object.freeze([
  "query_state:fx.resolve_ref",
  "query_state:fx.list_track_chain",
  "query_state:fx.list_take_chain",
  "query_state:fx.read_summary",
  "query_state:fx.list_parameters",
  "query_state:fx.read_parameter",
  "query_state:fx.parameter_to_envelope_mapping",
]);
const E2_FX_B1_WRITE_IDS = Object.freeze([
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.reorder_fx",
]);

describe("E2-FX-L1 FX read live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the seven E2-FX-L1 read template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS, [
      "template.fx.resolve_fx_ref",
      "template.fx.list_track_fx_chain",
      "template.fx.list_take_fx_chain",
      "template.fx.read_fx_summary",
      "template.fx.list_fx_parameters",
      "template.fx.read_fx_parameter",
      "template.fx.parameter_to_envelope_mapping",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
        opt_in_env: E2_FX_L1_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 12,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e2FxL1Input(id),
        refs: e2FxL1Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      E2_FX_L1_OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "fx.resolve_ref",
      "fx.list_track_chain",
      "fx.list_take_chain",
      "fx.read_summary",
      "fx.list_parameters",
      "fx.read_parameter",
      "fx.parameter_to_envelope_mapping",
    ]);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "fx");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS,
          "template.fx.search_installed_fx",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the E2-FX-L1 runner default-skipped and typed for missing transport blockers", () => {
    const skipped = runSmoke([E2_FX_L1_FLAG], {
      [E2_FX_L1_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [E2_FX_TRACK_REF_ENV]: "",
      [E2_FX_TAKE_REF_ENV]: "",
      [E2_FX_REF_ENV]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "E2 FX-L1 Read Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, E2_FX_L1_OPERATION_KEYS);

    const noExecutor = runSmokeExpectingFailure([E2_FX_L1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal("attempted_template_ids" in noExecutor, false);
  });

  it("writes the exact E2-FX-L1 read requests to transport without starting REAPER", async () => {
    const transportDir = await createTransportDir("openreaper-e2-fx-l1-timeout-");
    const report = runSmokeExpectingFailure([E2_FX_L1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [E2_FX_TRACK_REF_ENV]: "track:guid:{E2-FX-L1-TRACK}",
      [E2_FX_TAKE_REF_ENV]: "take:guid:{E2-FX-L1-TAKE}",
      [E2_FX_REF_ENV]: "fx:track:guid:{E2-FX-L1-TRACK}:0",
      [E2_FX_PARAM_INDEX_ENV]: "0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, E2_FX_L1_OPERATION_KEYS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 7);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`),
      E2_FX_L1_OPERATION_KEYS,
    );

    for (const request of requests) {
      assert.equal(request.pack.id, "fx");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(requests[0].refs.find((ref) => ref.kind === "track").ref, "track:guid:{E2-FX-L1-TRACK}");
    assert.equal(requests[2].refs.find((ref) => ref.kind === "take").ref, "take:guid:{E2-FX-L1-TAKE}");
    assert.equal(requests[5].refs.find((ref) => ref.kind === "fx").ref, "fx:track:guid:{E2-FX-L1-TRACK}:0");
    assert.equal(requests[5].params.param_index, 0);
    assert.equal(requests[6].refs.find((ref) => ref.kind === "fx").ref, "fx:track:guid:{E2-FX-L1-TRACK}:0");
    assert.equal(requests[6].params.param_index, 0);
  });

  it("keeps the Lua bridge E2-FX-L1 read surface exact while adding only bounded E2-FX-B1 writes", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.resolve_ref"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.resolve_fx_ref/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.list_track_chain"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_track_fx_chain/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.list_take_chain"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_take_fx_chain/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.read_summary"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_fx_summary/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.list_parameters"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_fx_parameters/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.read_parameter"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_fx_parameter/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.parameter_to_envelope_mapping"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.parameter_to_envelope_mapping/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.read_video_processor_code"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_video_processor_code/);
    assert.match(BRIDGE_SOURCE, /\["query_state:fx\.installed\.search"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.search_installed_fx/);
    assert.match(BRIDGE_SOURCE, /TrackFX_GetCount/);
    assert.match(BRIDGE_SOURCE, /TrackFX_GetFXName/);
    assert.match(BRIDGE_SOURCE, /TrackFX_GetParam/);
    assert.match(BRIDGE_SOURCE, /TakeFX_GetCount/);
    assert.match(BRIDGE_SOURCE, /TakeFX_GetFXName/);
    assert.match(BRIDGE_SOURCE, /TakeFX_GetParam/);
    assert.match(BRIDGE_SOURCE, /\["fx\.add_track"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.add_track_fx/);
    assert.match(BRIDGE_SOURCE, /\["fx\.add_take"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.add_take_fx/);
    assert.match(BRIDGE_SOURCE, /\["fx\.set_bypass"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.set_fx_bypass/);
    assert.match(BRIDGE_SOURCE, /\["fx\.set_parameter_normalized"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.set_fx_parameter_normalized/);
    assert.match(BRIDGE_SOURCE, /\["fx\.reorder"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.reorder_fx/);
    assert.match(BRIDGE_SOURCE, /TrackFX_AddByName/);
    assert.match(BRIDGE_SOURCE, /TakeFX_AddByName/);
    assert.match(BRIDGE_SOURCE, /TrackFX_SetEnabled/);
    assert.match(BRIDGE_SOURCE, /TakeFX_SetEnabled/);
    assert.match(BRIDGE_SOURCE, /TrackFX_SetParamNormalized/);
    assert.match(BRIDGE_SOURCE, /TakeFX_SetParamNormalized/);
    assert.match(BRIDGE_SOURCE, /TrackFX_CopyToTrack/);
    assert.match(BRIDGE_SOURCE, /TakeFX_CopyToTake/);
    assert.match(HANDLER_SOURCE, /fx:" \.\. tostring\(owner_ref\) \.\. ":" \.\. tostring\(slot_index\)/);
    assert.match(HANDLER_SOURCE, /scheme == "track_fx"/);
    assert.match(HANDLER_SOURCE, /scheme == "take_fx"/);
    assert.match(HANDLER_SOURCE, /local fx_ref = e2_fx_read_fx_object_ref\([\s\S]*?fx_ref = fx_ref\.ref/);
    assert.match(HANDLER_SOURCE, /e2_fx_read_refs\(fx_ref, envelope_ref\)/);
    assert.match(HANDLER_SOURCE, /local E2_FX_INSTALLED_INVENTORY_CACHE = nil/);
    assert.match(HANDLER_SOURCE, /local ok, present, name, ident = call_reaper\("EnumInstalledFX", index\)/);
    assert.match(HANDLER_SOURCE, /while true do[\s\S]*?E2_FX_INSTALLED_INVENTORY_CACHE = inventory/);
    assert.match(HANDLER_SOURCE, /ident = candidate\.ident/);
    assert.match(HANDLER_SOURCE, /inventory_complete = true/);
    assert.doesNotMatch(HANDLER_SOURCE, /max_scan\s*=\s*2048/);
    assert.doesNotMatch(HANDLER_SOURCE, /GetTrack", 0, 0/);
    assert.doesNotMatch(HANDLER_SOURCE, /GetSelectedMediaItem", 0, 0/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["query_state:(fx\.[^"]+)"\]\s*=/g)].map((match) => match[1]))],
      [
        "fx.read_video_processor_code",
        "fx.installed.search",
        "fx.resolve_ref",
        "fx.list_track_chain",
        "fx.list_take_chain",
        "fx.read_summary",
        "fx.list_parameters",
        "fx.read_parameter",
        "fx.parameter_to_envelope_mapping",
      ],
    );
    assert.deepEqual(
      CALL_TEMPLATE_RUNTIME_E2_FX_B1_ROUTE_TEMPLATE_IDS.filter((id) => !CALL_TEMPLATE_RUNTIME_E2_FX_L1_READ_TEMPLATE_IDS.includes(id) && ![
        "template.fx.set_fx_preset_by_name",
        "template.fx.set_fx_preset_by_index",
        "template.fx.read_video_processor_code",
      ].includes(id)),
      [...E2_FX_B1_WRITE_IDS],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function e2FxL1Input(id) {
  if (id === "template.fx.resolve_fx_ref") {
    return { owner_kind: "track", slot_index: 0 };
  }
  if (id === "template.fx.list_track_fx_chain" || id === "template.fx.list_take_fx_chain") {
    return { include_preset: true };
  }
  if (id === "template.fx.list_fx_parameters") {
    return { limit: 16 };
  }
  if (id === "template.fx.read_fx_parameter" || id === "template.fx.parameter_to_envelope_mapping") {
    return { param_index: 0 };
  }
  return {};
}

function e2FxL1Refs(id) {
  const trackRef = createObjectRef("track", { scheme: "guid", value: "{E2-FX-L1-TRACK}" }, {
    ref: "track:guid:{E2-FX-L1-TRACK}",
  });
  const takeRef = createObjectRef("take", { scheme: "guid", value: "{E2-FX-L1-TAKE}" }, {
    ref: "take:guid:{E2-FX-L1-TAKE}",
  });
  const fxRef = createObjectRef("fx", { scheme: "track_fx", value: "track:guid:{E2-FX-L1-TRACK}:0" }, {
    ref: "fx:track:guid:{E2-FX-L1-TRACK}:0",
  });
  if (id === "template.fx.resolve_fx_ref" || id === "template.fx.list_track_fx_chain") {
    return { track_ref: trackRef };
  }
  if (id === "template.fx.list_take_fx_chain") {
    return { take_ref: takeRef };
  }
  return { fx_ref: fxRef };
}

async function createTransportDir(prefix) {
  const transportDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(transportDir, "requests"));
  await mkdir(join(transportDir, "results"));
  return transportDir;
}

async function readTransportRequests(transportDir) {
  const requestDir = join(transportDir, "requests");
  const names = await readdir(requestDir);
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(requestDir, name), "utf8")));
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

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
        [E2_FX_L1_OPT_IN_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    }).trim(),
  );
}

function runSmokeExpectingFailure(args, env) {
  try {
    return runSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
  assert.fail("Expected E2-FX-L1 read live smoke script to exit with status 2.");
}
