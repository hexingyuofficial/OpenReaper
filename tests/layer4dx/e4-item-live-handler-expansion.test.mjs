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
  CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const E4_FLAG = "--item-route";
const E4_OPT_IN_ENV = "OPENREAPER_E4_ITEM_ROUTE_LIVE_SMOKE";
const E4_ITEM_REF_ENV = "OPENREAPER_E4_ITEM_REF";
const E4_TARGET_TRACK_REF_ENV = "OPENREAPER_E4_TARGET_TRACK_REF";
const E4_ITEM_START_SECONDS_ENV = "OPENREAPER_E4_ITEM_START_SECONDS";
const E4_ITEM_LENGTH_SECONDS_ENV = "OPENREAPER_E4_ITEM_LENGTH_SECONDS";
const E4_SPLIT_POSITION_SECONDS_ENV = "OPENREAPER_E4_SPLIT_POSITION_SECONDS";
const E4_PLAYRATE_ENV = "OPENREAPER_E4_PLAYRATE";
const E4_OPERATION_KEYS = Object.freeze(["run_command:template.execute"]);
const E4_CAPABILITIES = Object.freeze([
  "item.copy_to_track",
  "items.split_item_at_time",
  "items.set_take_playrate",
]);

describe("E4 item live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the three E4 item route template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS, [
      "template.items.copy_item_to_track",
      "template.items.split_item_at_time",
      "template.items.set_take_playrate",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
        opt_in_env: E4_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e4Input(id),
        refs: e4Refs(id),
        idempotency_key: id === "template.items.set_take_playrate" ? "e4-item-route:set-take-playrate" : undefined,
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      ["run_command:template.execute", "run_command:template.execute", "run_command:template.execute"],
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), E4_CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen[2].idempotency_key, "e4-item-route:set-take-playrate");

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the E4 runner default-skipped and typed for missing transport blockers", () => {
    const skipped = runSmoke([E4_FLAG], {
      [E4_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [E4_ITEM_REF_ENV]: "",
      [E4_TARGET_TRACK_REF_ENV]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "E4 Item Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, E4_OPERATION_KEYS);

    const noExecutor = runSmokeExpectingFailure([E4_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal("attempted_template_ids" in noExecutor, false);
  });

  it("writes the exact E4 route requests to transport without starting REAPER", async () => {
    const transportDir = await createTransportDir("openreaper-e4-timeout-");
    const report = runSmokeExpectingFailure([E4_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [E4_ITEM_REF_ENV]: "item:guid:{E4-SOURCE-ITEM}",
      [E4_TARGET_TRACK_REF_ENV]: "track:guid:{E4-TARGET-TRACK}",
      [E4_ITEM_START_SECONDS_ENV]: "0",
      [E4_ITEM_LENGTH_SECONDS_ENV]: "4",
      [E4_SPLIT_POSITION_SECONDS_ENV]: "2",
      [E4_PLAYRATE_ENV]: "0.75",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, E4_OPERATION_KEYS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_E4_ITEM_ROUTE_TEMPLATE_IDS);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 3);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`),
      ["run_command:template.execute", "run_command:template.execute", "run_command:template.execute"],
    );
    assert.deepEqual(requests.map((request) => request.pack.capability), E4_CAPABILITIES);

    for (const request of requests) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.operation.name, "template.execute");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(requests[0].refs.find((ref) => ref.kind === "item").ref, "item:guid:{E4-SOURCE-ITEM}");
    assert.equal(requests[0].refs.find((ref) => ref.kind === "track").ref, "track:guid:{E4-TARGET-TRACK}");
    assert.equal(requests[0].params.position_seconds, 5);
    assert.equal(requests[1].params.position_seconds, 2);
    assert.equal(requests[2].params.playrate, 0.75);
    assert.equal(requests[2].params.preserve_pitch, true);
    assert.equal(requests[2].idempotency_key, "e4-item-route:set-take-playrate");
  });

  it("keeps the Lua bridge E4 item surface exact and keeps loop-source held", () => {
    assert.match(BRIDGE_SOURCE, /\["item\.copy_to_track"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.copy_item_to_track/);
    assert.match(BRIDGE_SOURCE, /\["items\.split_item_at_time"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.split_item_at_time/);
    assert.match(BRIDGE_SOURCE, /\["items\.set_take_playrate"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.set_take_playrate/);
    assert.match(BRIDGE_SOURCE, /AddMediaItemToTrack/);
    assert.match(BRIDGE_SOURCE, /SplitMediaItem/);
    assert.match(BRIDGE_SOURCE, /SetMediaItemTakeInfo_Value/);
    assert.match(BRIDGE_SOURCE, /loop_source_status = "held"/);
    assert.match(BRIDGE_SOURCE, /E4 item route write requests must use undo\.mode required/);
    assert.match(BRIDGE_SOURCE, /E4 item route write requests must use artifacts\.allow false/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_command:([^"]+)"\]\s*=/g)].map((match) => match[1]))],
      [
        "template.execute",
        "render.sample_rate.set",
        "render.format.set",
        "render.ogg_quality.set",
        "render.mp3_bitrate_kbps.set",
        "render.flac_compression.set",
        "render.aiff_bit_depth.set",
      ],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /set_item_loop_source|Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function e4Input(id) {
  if (id === "template.items.copy_item_to_track") {
    return { position_seconds: 4 };
  }
  if (id === "template.items.split_item_at_time") {
    return { position_seconds: 2 };
  }
  if (id === "template.items.set_take_playrate") {
    return { playrate: 0.75, preserve_pitch: true };
  }
  return {};
}

function e4Refs(id) {
  const sourceItemRef = createObjectRef("item", { scheme: "guid", value: "{E4-SOURCE-ITEM}" }, {
    ref: "item:guid:{E4-SOURCE-ITEM}",
  });
  const targetTrackRef = createObjectRef("track", { scheme: "guid", value: "{E4-TARGET-TRACK}" }, {
    ref: "track:guid:{E4-TARGET-TRACK}",
  });
  if (id === "template.items.copy_item_to_track") {
    return { source_item_ref: sourceItemRef, target_track_ref: targetTrackRef };
  }
  return { item_ref: sourceItemRef };
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

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
        [E4_OPT_IN_ENV]: "",
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
  assert.fail("Expected E4 item live smoke script to exit with status 2.");
}

function context(extra = {}) {
  return {
    client_id: "layer4dx-e4-item-test",
    session_id: "e4-item-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-05T00:00:00.000Z",
    ...extra,
  };
}
