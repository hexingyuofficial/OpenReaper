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
  CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const E5_R1_FLAG = "--routing-read";
const E5_R1_OPT_IN_ENV = "OPENREAPER_E5_R1_ROUTING_READ_LIVE_SMOKE";
const E5_TRACK_REF_ENV = "OPENREAPER_E5_TRACK_REF";
const E5_SEND_REF_ENV = "OPENREAPER_E5_SEND_REF";
const E5_R1_OPERATION_KEYS = Object.freeze([
  "query_state:routing.track.read",
  "query_state:routing.send.resolve_ref",
  "query_state:routing.project_graph.read",
]);

describe("E5-R1 routing read live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the three E5-R1 routing read template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS, [
      "template.routing.read_track_routing",
      "template.routing.resolve_send_ref",
      "template.routing.read_project_routing_graph",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
        opt_in_env: E5_R1_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e5R1Input(id),
        refs: e5R1Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      E5_R1_OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "routing.track.read",
      "routing.send.resolve_ref",
      "routing.project_graph.read",
    ]);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "routing");
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
          ...CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the E5-R1 runner default-skipped and typed for missing transport blockers", () => {
    const skipped = runSmoke([E5_R1_FLAG], {
      [E5_R1_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [E5_TRACK_REF_ENV]: "",
      [E5_SEND_REF_ENV]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "E5-R1 Routing Read Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, E5_R1_OPERATION_KEYS);

    const noExecutor = runSmokeExpectingFailure([E5_R1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal("attempted_template_ids" in noExecutor, false);
  });

  it("writes the exact E5-R1 routing read requests to transport without starting REAPER", async () => {
    const transportDir = await createTransportDir("openreaper-e5-r1-timeout-");
    const report = runSmokeExpectingFailure([E5_R1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [E5_TRACK_REF_ENV]: "track:guid:{E5-R1-SOURCE-TRACK}",
      [E5_SEND_REF_ENV]: "send:track:0:0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, E5_R1_OPERATION_KEYS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 3);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`),
      E5_R1_OPERATION_KEYS,
    );

    for (const request of requests) {
      assert.equal(request.pack.id, "routing");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(requests[0].refs.find((ref) => ref.kind === "track").ref, "track:guid:{E5-R1-SOURCE-TRACK}");
    assert.equal(requests[1].params.send_ref, "send:track:0:0");
    assert.equal(requests[2].params.max_tracks, 16);
    assert.equal(requests[2].params.max_edges, 64);
  });

  it("keeps the Lua bridge E5-R1 routing read surface exact and read-only", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.track\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_track_routing/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.send\.resolve_ref"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.resolve_send_ref/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.project_graph\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_project_routing_graph/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.fx_pin_mapping\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_fx_pin_mapping/);
    assert.match(BRIDGE_SOURCE, /GetTrackNumSends/);
    assert.match(BRIDGE_SOURCE, /GetTrackSendInfo_Value/);
    assert.match(BRIDGE_SOURCE, /E5-R1 read_track_routing requires a resolvable track ref/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["query_state:(routing\.[^"]+)"\]\s*=/g)].map((match) => match[1]))],
      ["routing.track.read", "routing.send.resolve_ref", "routing.project_graph.read", "routing.fx_pin_mapping.read"],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(BRIDGE_SOURCE, /set_loop_source|Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function e5R1Input(id) {
  if (id === "template.routing.read_track_routing") {
    return { include_receives: true, include_master_parent: true, max_routes: 32 };
  }
  if (id === "template.routing.resolve_send_ref") {
    return { send_ref: "send:track:0:0" };
  }
  if (id === "template.routing.read_project_routing_graph") {
    return { include_master_parent: true, max_tracks: 16, max_edges: 64 };
  }
  return {};
}

function e5R1Refs(id) {
  if (id === "template.routing.read_track_routing") {
    return {
      track_ref: createObjectRef("track", { scheme: "guid", value: "{E5-R1-SOURCE-TRACK}" }, {
        ref: "track:guid:{E5-R1-SOURCE-TRACK}",
      }),
    };
  }
  return {};
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
        [E5_R1_OPT_IN_ENV]: "",
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
  assert.fail("Expected E5-R1 routing read live smoke script to exit with status 2.");
}
