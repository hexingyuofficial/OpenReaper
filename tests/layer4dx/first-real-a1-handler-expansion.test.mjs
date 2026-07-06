import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  artifactPathFromRef,
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const A1_FLAG = "--first-real-a1";
const A1_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A1_LIVE_SMOKE";
const A1_ITEM_REF_ENV = "OPENREAPER_FIRST_REAL_A_ITEM_REF";
const A1_PROJECT_REF_ENV = "OPENREAPER_FIRST_REAL_A_PROJECT_REF";
const A1_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";

const A1_OPERATIONS = Object.freeze([
  "analysis.detect_loop_candidates",
  "analysis.measure_loop_click_risk",
  "analysis.create_loop_qa_report",
  "project.create_cleanup_report",
]);
const D29_RENDER_JOB_OPERATIONS = Object.freeze([
  "render.aiff",
  "render.flac",
  "render.item",
  "render.m4a",
  "render.mp3",
  "render.ogg",
  "render.opus",
  "render.region_track_filter",
  "render.selected_item",
  "render.selected_tracks",
  "render.track_item",
  "template.execute",
]);

const A1_OPERATION_KEYS = Object.freeze(A1_OPERATIONS.map((operation) => `run_job:${operation}`));
const D27_ANALYSIS_AUDIO_OPERATIONS = Object.freeze([
  "analysis.measure_item_rms",
  "analysis.measure_item_peaks",
  "analysis.detect_item_silence",
  "analysis.detect_item_transients",
]);

const A1_SCHEMAS = Object.freeze([
  "analysis.loop_candidates.v1",
  "analysis.loop_click_risk.v1",
  "analysis.loop_qa_report.v1",
  "project.cleanup_report.v1",
]);

describe("First-Real-Fixture-A A1 live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the four A1 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS, [
      "template.analysis.detect_loop_candidates",
      "template.analysis.measure_loop_click_risk",
      "template.analysis.create_loop_qa_report",
      "template.project.create_cleanup_report",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
      },
    });
    assert.deepEqual(runtime.live_gate.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS);

    const refsById = a1RefsById();
    for (const [index, id] of CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: a1Input(id),
        refs: refsById[id] ?? {},
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(bridge.seen.map((request) => request.operation.name), A1_OPERATIONS);
    for (const request of bridge.seen) {
      assert.equal(request.operation.family, "run_job");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, true);
      assert.equal("idempotency_key" in request, false);
    }

    for (const id of [
      "template.render.render_region_wav",
      "template.render.create_delivery_report",
      "template.items.create_layer_report",
      "template.tracks.create_track",
      "template.core.read_template_catalog_summary",
    ]) {
      const response = await runtime.call_template({
        id,
        input: {},
        refs: [],
        context: context(),
      });
      assert.equal(response.ok, false, id);
      assert.equal(response.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED", id);
    }
  });

  it("keeps the A1 runner safe-skipped by default and labels the batch clearly", () => {
    const report = runSmoke([A1_FLAG], {
      [A1_OPT_IN_ENV]: "",
      [A1_ARTIFACT_ROOT_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [A1_ITEM_REF_ENV]: "",
      [A1_PROJECT_REF_ENV]: "",
    });

    assert.equal(report.ok, true);
    assert.equal(report.skipped, true);
    assert.equal(report.reason, "explicit_opt_in_required");
    assert.equal(report.wave, "First-Real-Fixture-A A1");
    assert.equal(report.batch, "First-Real-Fixture-A A1");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, undefined);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, A1_OPERATION_KEYS);
    assert.deepEqual(report.fixture_inputs.applies_to_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS);
    assert.equal(report.fixture_inputs.item_ref, "selected:0");
  });

  it("returns typed A1 blockers for configured-but-missing artifact root, transport, and bridge script", async () => {
    const transportDir = await createTransportDir("openreaper-a1-blocker-transport-");
    const missingRoot = join(tmpdir(), `openreaper-a1-missing-root-${process.pid}`);
    const missingRootReport = runSmokeExpectingFailure([A1_FLAG, "--live"], {
      [A1_ARTIFACT_ROOT_ENV]: missingRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
    });
    assert.equal(missingRootReport.reason, "artifact_root_absent");
    assert.equal(missingRootReport.blocker, "artifact_root_absent");
    assert.equal(missingRootReport.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingRootReport, false);

    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a1-artifacts-"));
    const missingTransport = runSmokeExpectingFailure([A1_FLAG, "--live"], {
      [A1_ARTIFACT_ROOT_ENV]: artifactRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(tmpdir(), `openreaper-a1-missing-transport-${process.pid}`),
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.equal(missingTransport.blocker, "live_bridge_transport_absent");
    assert.equal(missingTransport.spawned_reaper, false);

    const validTransport = await createTransportDir("openreaper-a1-script-transport-");
    const missingScript = runSmokeExpectingFailure([A1_FLAG, "--live"], {
      [A1_ARTIFACT_ROOT_ENV]: artifactRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: validTransport,
      [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: join(tmpdir(), `openreaper-a1-missing-script-${process.pid}.lua`),
    });
    assert.equal(missingScript.reason, "reaper_bridge_script_absent");
    assert.equal(missingScript.blocker, "reaper_bridge_script_absent");
    assert.equal(missingScript.spawned_reaper, false);
  });

  it("writes only A1 request shapes to transport when opted in but no REAPER answers", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a1-timeout-artifacts-"));
    const transportDir = await createTransportDir("openreaper-a1-timeout-transport-");
    const report = runSmokeExpectingFailure([A1_FLAG, "--live"], {
      [A1_ARTIFACT_ROOT_ENV]: artifactRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [A1_ITEM_REF_ENV]: "item:index:0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.attempted_template_ids, [
      "template.analysis.detect_loop_candidates",
      "template.project.create_cleanup_report",
    ]);

    const requests = await readTransportRequests(transportDir);
    assert.deepEqual(requests.map((request) => `${request.operation.family}:${request.operation.name}`).sort(), [
      "run_job:analysis.detect_loop_candidates",
      "run_job:project.create_cleanup_report",
    ].sort());
    for (const request of requests) {
      assert.equal(request.artifacts.allow, true);
      assert.equal(request.undo.mode, "none");
      assert.equal(request.pack.risk, "read");
      assert.equal("artifact_root" in request.params, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
    }
  });

  it("proves fake A1 artifact envelope write plus get_state summary/payload readback", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a1-fake-artifacts-"));
    const report = runSmoke([A1_FLAG, "--fake"], {
      [A1_ARTIFACT_ROOT_ENV]: artifactRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [A1_ITEM_REF_ENV]: "item:index:0",
      [A1_PROJECT_REF_ENV]: "project:current",
    });

    assert.equal(report.ok, true);
    assert.equal(report.mode, "fake");
    assert.equal(report.reason, "first_real_fixture_a1_live_readback_passed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.expected_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS);
    assert.deepEqual(Object.keys(report.artifact_refs).sort(), [...A1_SCHEMAS].sort());
    assert.equal(report.executions.length, 4);

    for (const execution of report.executions) {
      assert.equal(execution.ok, true, execution.id);
      assert.equal(execution.counts.artifacts, 1, execution.id);
      assert.equal(execution.counts.jobs, 0, execution.id);
      assert.equal(execution.last_result_updated, false, execution.id);
      assert.equal(execution.produced_readback.summary_ok, true, execution.id);
      assert.equal(execution.produced_readback.payload_ok, true, execution.id);
      assert.equal(execution.produced_readback.last_result_updated, false, execution.id);
      assert.equal("payload" in execution.produced_readback, false, execution.id);
      assert.equal(execution.produced_readback.get_state_contract, "get_state.runtime.v1", execution.id);
      assert.equal(execution.produced_readback.summary_view, "summary", execution.id);
      assert.equal(execution.produced_readback.payload_view, "payload", execution.id);
    }

    for (const [schema, ref] of Object.entries(report.artifact_refs)) {
      const parts = parseArtifactRef(ref);
      assert.equal(ref, `artifact:${parts.owner_pack}:${parts.scope}:${parts.id}`);
      assert.equal(A1_SCHEMAS.includes(schema), true);
      assert.equal(readFileSync(artifactPathFromRef(artifactRoot, ref), "utf8").includes('"contract":"artifact.state_store.v1"'), true);
    }

    const measure = report.executions.find((execution) => execution.id === "template.analysis.measure_loop_click_risk");
    const qa = report.executions.find((execution) => execution.id === "template.analysis.create_loop_qa_report");
    assert.equal(measure.consumed_readbacks.length, 1);
    assert.equal(qa.consumed_readbacks.length, 2);
    assert.equal(measure.consumed_readbacks.every((readback) => readback.summary_ok && readback.payload_ok), true);
    assert.equal(qa.consumed_readbacks.every((readback) => readback.summary_ok && readback.payload_ok), true);
  });

  it("keeps the Lua bridge A1 allowlist exact with canonical artifact refs and no forbidden routes", () => {
    const runJobKeys = [...BRIDGE_SOURCE.matchAll(/\["run_job:([^"]+)"\]\s*=/g)]
      .map((match) => match[1])
      .sort();
    const uniqueRunJobKeys = [...new Set(runJobKeys)];
    assert.deepEqual(uniqueRunJobKeys, [
      ...A1_OPERATIONS,
      ...D27_ANALYSIS_AUDIO_OPERATIONS,
      "items.create_layer_report",
      ...D29_RENDER_JOB_OPERATIONS,
      "render.delivery_report.create",
      "render.region_wav",
    ].sort());

    assert.match(BRIDGE_SOURCE, /A1_ARTIFACT_OPERATIONS/);
    assert.match(BRIDGE_SOURCE, /A1_LOOP_CANDIDATES_INPUT/);
    assert.match(BRIDGE_SOURCE, /A1_LOOP_CLICK_RISK_INPUT/);
    assert.match(BRIDGE_SOURCE, /summary\.owner_pack == expected\.owner_pack/);
    assert.match(BRIDGE_SOURCE, /summary\.scope == expected\.scope/);
    assert.match(BRIDGE_SOURCE, /parts\.owner_pack == expected\.owner_pack/);
    assert.match(BRIDGE_SOURCE, /parts\.scope == expected\.scope/);
    assert.match(BRIDGE_SOURCE, /expected schema\/ref\/owner\/scope/);
    assert.match(BRIDGE_SOURCE, /Only scoped First-Real-Fixture-A artifact handlers may write artifacts/);
    assert.match(BRIDGE_SOURCE, /artifact:<owner_pack>:<scope>:<id>/);
    assert.match(BRIDGE_SOURCE, /artifact\.state_store\.v1/);
    for (const schema of A1_SCHEMAS) {
      assert.match(BRIDGE_SOURCE, new RegExp(schema.replaceAll(".", "\\.")));
    }
    for (const templateId of CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS) {
      assert.match(BRIDGE_SOURCE, new RegExp(templateId.replaceAll(".", "\\.")));
    }

    assert.match(BRIDGE_SOURCE, /A2_ARTIFACT_OPERATIONS/);
    assert.match(BRIDGE_SOURCE, /A3_ARTIFACT_OPERATIONS/);
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
    assert.doesNotMatch(BRIDGE_SOURCE, /Read-B|LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
  });
});

function a1Input(id) {
  if (id === "template.analysis.detect_loop_candidates") {
    return { max_candidates: 8 };
  }
  if (id === "template.analysis.measure_loop_click_risk") {
    return { boundary_window_ms: 20, max_candidates: 8 };
  }
  if (id === "template.analysis.create_loop_qa_report") {
    return { max_report_rows: 8 };
  }
  return {
    max_report_rows: 32,
    marker_region_limit: 64,
    tempo_marker_limit: 32,
    include_markers: true,
    include_regions: true,
    include_metadata: true,
    include_tempo: true,
    include_project_fingerprint: true,
  };
}

function a1RefsById() {
  const item = createObjectRef("item", { scheme: "index", value: "0" }, { ref: "item:index:0" });
  const candidates = createArtifactRef({
    owner_pack: "analysis",
    scope: "loop_candidates",
    id: "art_20260703000000000_001_aaa111",
    schema: "analysis.loop_candidates.v1",
  });
  const risk = createArtifactRef({
    owner_pack: "analysis",
    scope: "loop_click_risk",
    id: "art_20260703000000000_002_bbb222",
    schema: "analysis.loop_click_risk.v1",
  });
  return {
    "template.analysis.detect_loop_candidates": { item_ref: item },
    "template.analysis.measure_loop_click_risk": {
      item_ref: item,
      candidate_artifact_ref: candidates,
    },
    "template.analysis.create_loop_qa_report": {
      candidate_artifact_ref: candidates,
      click_risk_artifact_ref: risk,
    },
    "template.project.create_cleanup_report": {},
  };
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
        [A1_OPT_IN_ENV]: "",
        [A1_ARTIFACT_ROOT_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    }).trim(),
  );
}

function runSmokeExpectingFailure(args, env) {
  try {
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [A1_OPT_IN_ENV]: "",
        [A1_ARTIFACT_ROOT_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected A1 live smoke script to exit with status 2.");
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
