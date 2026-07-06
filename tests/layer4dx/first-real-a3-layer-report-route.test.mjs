import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  createArtifactRef,
  validateFoundationBridgeResult,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  artifactPathFromRef,
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../../packages/core/src/artifact-state-store-live-helper-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const A3_FLAG = "--first-real-a3-layer-report";
const A3_PHASE = "A3-layer-report";
const A3_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A3_LIVE_SMOKE";
const A3_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const A3_LAYER_EVIDENCE_REF_ENV = "OPENREAPER_FIRST_REAL_A_LAYER_EVIDENCE_REF";
const A3_OPERATION = "items.create_layer_report";
const A3_OPERATION_KEY = `run_job:${A3_OPERATION}`;
const D29_RENDER_JOB_OPERATION_KEYS = Object.freeze([
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
].map((operation) => `run_job:${operation}`));
const A3_INPUT_SCHEMA = "items.layer_evidence.v1";
const A3_OUTPUT_SCHEMA = "items.layer_report.v1";
const A3_DEFAULT_LAYER_EVIDENCE_REF = "artifact:items:layer_evidence:art_20260704000000000_003_a3a3a3";

describe("First-Real-Fixture-A A3 layer report route", () => {
  it("adds a separate runtime allowlist for exactly the one A3 template id", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS, [
      "template.items.create_layer_report",
    ]);

    const bridge = capturingA3Executor();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
        opt_in_env: A3_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 2,
    });
    assert.deepEqual(runtime.live_gate.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);

    const response = await runtime.call_template({
      id: "template.items.create_layer_report",
      input: a3Input(),
      refs: {
        layer_evidence_artifact_ref: layerEvidenceRef(),
      },
      context: context(),
    });
    assert.equal(response.ok, true);

    assert.equal(bridge.seen.length, 1);
    const request = bridge.seen[0];
    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, A3_OPERATION);
    assert.equal(request.pack.id, "items");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.pack.capability, A3_OPERATION);
    assert.equal(request.undo.mode, "none");
    assert.equal(request.artifacts.allow, true);
    assert.equal("idempotency_key" in request, false);
    assert.equal(request.refs.length, 1);
    assert.equal(request.refs[0].kind, "artifact");
    assert.equal(request.refs[0].summary.schema, A3_INPUT_SCHEMA);
    assert.equal("role_assignment_plan" in request.params, false);
    assert.equal("target_track_plan" in request.params, false);
    assert.equal("lua" in request, false);
    assert.equal("action" in request, false);
    assert.equal("shell" in request, false);

    for (const id of [
      "template.render.render_region_wav",
      "template.render.create_delivery_report",
      "template.project.create_cleanup_report",
      "template.items.move_item",
      "template.core.read_template_catalog_summary",
    ]) {
      const rejected = await runtime.call_template({
        id,
        input: {},
        refs: [],
        context: context({ request_sequence: 2 }),
      });
      assert.equal(rejected.ok, false, id);
      assert.equal(rejected.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED", id);
    }

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the A3 runner safe-skipped by default and typed for missing roots or input artifacts", async () => {
    const skipped = runSmoke([A3_FLAG], {
      [A3_OPT_IN_ENV]: "",
      [A3_ARTIFACT_ROOT_ENV]: "",
      [A3_LAYER_EVIDENCE_REF_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "First-Real-Fixture-A A3 Layer Report Route");
    assert.equal(skipped.batch, "First-Real-Fixture-A A3 Layer Report Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, [A3_OPERATION_KEY]);
    assert.equal(skipped.fixture_inputs.layer_evidence_ref, null);

    const noExecutor = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [A3_ARTIFACT_ROOT_ENV]: "",
      [A3_LAYER_EVIDENCE_REF_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.equal("attempted_template_ids" in noExecutor, false);

    const transportDir = await createTransportDir("openreaper-a3-blocker-transport-");
    const missingRoot = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A3_ARTIFACT_ROOT_ENV]: "",
      [A3_LAYER_EVIDENCE_REF_ENV]: layerEvidenceRef().ref,
    });
    assert.equal(missingRoot.reason, "artifact_root_not_configured");
    assert.equal(missingRoot.blocker, "artifact_root_not_configured");
    assert.equal("attempted_template_ids" in missingRoot, false);

    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a3-artifact-root-"));
    const missingRef = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A3_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A3_LAYER_EVIDENCE_REF_ENV]: "",
    });
    assert.equal(missingRef.reason, "layer_evidence_artifact_ref_not_configured");
    assert.equal(missingRef.blocker, "layer_evidence_artifact_ref_not_configured");

    const rawPathRef = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A3_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A3_LAYER_EVIDENCE_REF_ENV]: "/tmp/openreaper-layer-evidence.json",
    });
    assert.equal(rawPathRef.reason, "layer_evidence_artifact_ref_invalid");
    assert.equal(rawPathRef.blocker, "layer_evidence_artifact_ref_invalid");

    const missingInput = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A3_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A3_LAYER_EVIDENCE_REF_ENV]: layerEvidenceRef().ref,
    });
    assert.equal(missingInput.reason, "layer_evidence_artifact_absent");
    assert.equal(missingInput.blocker, "layer_evidence_artifact_absent");
    assert.equal("attempted_template_ids" in missingInput, false);
  });

  it("proves fake A3 typed fixture input plus layer report artifact readback without inline payload", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a3-fake-artifacts-"));
    const report = runSmoke([A3_FLAG, "--fake"], {
      [A3_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A3_LAYER_EVIDENCE_REF_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });

    assert.equal(report.ok, true);
    assert.equal(report.mode, "fake");
    assert.equal(report.reason, "first_real_fixture_a3_layer_report_readback_passed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.expected_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);
    assert.equal(report.input_artifact_ref, A3_DEFAULT_LAYER_EVIDENCE_REF);
    assert.deepEqual(Object.keys(report.artifact_refs).sort(), [A3_INPUT_SCHEMA, A3_OUTPUT_SCHEMA].sort());
    assert.equal(report.executions.length, 1);

    const execution = report.executions[0];
    assert.equal(execution.id, "template.items.create_layer_report");
    assert.equal(execution.ok, true);
    assert.equal(execution.counts.artifacts, 1);
    assert.equal(execution.counts.jobs, 0);
    assert.equal(execution.last_result_updated, false);
    assert.equal(execution.consumed_readbacks.length, 1);
    assert.equal(execution.consumed_readbacks[0].schema, A3_INPUT_SCHEMA);
    assert.equal(execution.consumed_readbacks[0].summary_ok, true);
    assert.equal(execution.consumed_readbacks[0].payload_ok, true);
    assert.equal(execution.produced_readback.schema, A3_OUTPUT_SCHEMA);
    assert.equal(execution.produced_readback.summary_ok, true);
    assert.equal(execution.produced_readback.payload_ok, true);
    assert.equal("payload" in execution.produced_readback, false);
    assert.equal(execution.summary.schema, A3_OUTPUT_SCHEMA);
    assert.equal(execution.summary.evidence_item_count, 2);
    assert.equal(execution.summary.evidence_track_count, 2);
    assert.equal(execution.summary.report_row_count, 2);

    for (const [schema, ref] of Object.entries(report.artifact_refs)) {
      const parts = parseArtifactRef(ref);
      assert.equal(parts.owner_pack, "items");
      assert.equal([A3_INPUT_SCHEMA, A3_OUTPUT_SCHEMA].includes(schema), true);
      assert.equal(readFileSync(artifactPathFromRef(artifactRoot, ref), "utf8").includes('"contract":"artifact.state_store.v1"'), true);
    }

    const outputBody = readFileSync(artifactPathFromRef(artifactRoot, report.artifact_refs[A3_OUTPUT_SCHEMA]), "utf8");
    assert.doesNotMatch(outputBody, /role_assignment|target_track|approval|recipe|layer_plan|shell|raw_lua|raw_action/i);
  });

  it("writes only the single A3 layer report request to transport when no REAPER answers", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a3-timeout-artifacts-"));
    const transportDir = await createTransportDir("openreaper-a3-timeout-transport-");
    const inputRef = await seedLayerEvidenceFixture(artifactRoot);
    const report = runSmokeExpectingFailure([A3_FLAG, "--live"], {
      [A3_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A3_LAYER_EVIDENCE_REF_ENV]: inputRef,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);
    assert.equal(report.executions.length, 1);
    assert.equal(report.executions[0].consumed_readbacks[0].summary_ok, true);
    assert.equal(report.executions[0].consumed_readbacks[0].payload_ok, true);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(`${request.operation.family}:${request.operation.name}`, A3_OPERATION_KEY);
    assert.equal(request.pack.id, "items");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.undo.mode, "none");
    assert.equal(request.artifacts.allow, true);
    assert.equal("idempotency_key" in request, false);
    assert.equal(request.refs.length, 1);
    assert.equal(request.refs[0].kind, "artifact");
    assert.equal(request.refs[0].ref, inputRef);
    assert.equal(request.refs[0].summary.schema, A3_INPUT_SCHEMA);
    assert.equal("artifact_root" in request.params, false);
    assert.equal("output_path" in request.params, false);
    assert.equal("role_assignment_plan" in request.params, false);
    assert.equal("target_track_plan" in request.params, false);
    assert.equal("lua" in request, false);
    assert.equal("action" in request, false);
    assert.equal("shell" in request, false);
    assert.equal("process" in request, false);
  });

  it("keeps the Lua bridge A3 allowlist exact and free of plan, recipe, raw, or broad write routes", () => {
    const runJobKeys = [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_job:([^"]+)"\]\s*=/g)]
      .map((match) => `run_job:${match[1]}`))]
      .sort();
    assert.deepEqual(runJobKeys, [
      "run_job:analysis.create_loop_qa_report",
      "run_job:analysis.detect_loop_candidates",
      "run_job:analysis.detect_item_silence",
      "run_job:analysis.detect_item_transients",
      "run_job:analysis.measure_item_peaks",
      "run_job:analysis.measure_item_rms",
      "run_job:analysis.measure_loop_click_risk",
      "run_job:items.create_layer_report",
      "run_job:project.create_cleanup_report",
      ...D29_RENDER_JOB_OPERATION_KEYS,
      "run_job:render.delivery_report.create",
      "run_job:render.region_wav",
    ].sort());

    assert.match(BRIDGE_SOURCE, /A3_ARTIFACT_OPERATIONS/);
    assert.match(BRIDGE_SOURCE, /template\.items\.create_layer_report/);
    assert.match(BRIDGE_SOURCE, /items\.layer_evidence\.v1/);
    assert.match(BRIDGE_SOURCE, /items\.layer_report\.v1/);
    assert.match(BRIDGE_SOURCE, /scope = "layer_evidence"/);
    assert.match(BRIDGE_SOURCE, /A3 layer report requires an items\.layer_evidence\.v1 artifact ref/);
    assert.match(BRIDGE_SOURCE, /Only scoped First-Real-Fixture-A artifact handlers may write artifacts/);
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
    assert.doesNotMatch(BRIDGE_SOURCE, /create_layer_plan|apply_layer_plan|assign_item_roles|move_items_to_layer_tracks/);
    assert.doesNotMatch(BRIDGE_SOURCE, /role_assignment_plan|target_track_plan|official recipe|call_recipe|list_recipes|recipes\//i);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
  });

  it("selects the same A3 route through the phase flag without opting into live by default", () => {
    const report = runSmoke(["--phase", A3_PHASE], {
      [A3_OPT_IN_ENV]: "",
      [A3_ARTIFACT_ROOT_ENV]: "",
      [A3_LAYER_EVIDENCE_REF_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(report.ok, true);
    assert.equal(report.skipped, true);
    assert.equal(report.route_flag, `--phase ${A3_PHASE}`);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A3_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, [A3_OPERATION_KEY]);
  });
});

function a3Input() {
  return {
    max_report_rows: 24,
    include_track_facts: true,
    include_color_facts: true,
    include_item_samples: true,
  };
}

function layerEvidenceRef() {
  return createArtifactRef({
    owner_pack: "items",
    scope: "layer_evidence",
    id: "art_20260704000000000_101_abcdef",
    schema: A3_INPUT_SCHEMA,
    summary: {
      schema: A3_INPUT_SCHEMA,
      item_count: 2,
      track_count: 2,
    },
  });
}

function reportArtifactRef(request) {
  return createArtifactRef({
    owner_pack: "items",
    scope: "layer_report",
    id: `art_${request.id.slice(4)}`,
    schema: A3_OUTPUT_SCHEMA,
    summary: {
      schema: A3_OUTPUT_SCHEMA,
      evidence_item_count: 2,
      evidence_track_count: 2,
      report_row_count: 2,
      truncated: false,
    },
  });
}

function capturingA3Executor() {
  const seen = [];
  return {
    seen,
    config: {
      contract: "first_real_fixture_a3.capture_executor.v1",
      kind: "capture",
      spawned_reaper: false,
    },
    dispatch(request) {
      seen.push(request);
      const artifact = reportArtifactRef(request);
      return okBridgeEnvelope(request, {
        summary: {
          schema: A3_OUTPUT_SCHEMA,
          artifact_ref: artifact.ref,
          evidence_item_count: 2,
          evidence_track_count: 2,
          report_row_count: 2,
          truncated: false,
        },
        artifacts: [artifact],
      });
    },
  };
}

function okBridgeEnvelope(request, result) {
  const completedAt = "2026-07-04T00:00:00.000Z";
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: request.id,
    ok: true,
    completed_at: completedAt,
    bridge: {
      owner: request.bridge.expected_owner,
      generation: request.bridge.expected_generation,
    },
    queue: {
      state: "done",
      started_at: completedAt,
      completed_at: completedAt,
    },
    result: {
      summary: result.summary,
      refs: [],
      artifacts: result.artifacts ?? [],
      jobs: [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    },
    undo: {
      mode: request.undo.mode,
      opened: false,
      closed: false,
      label: request.undo.label ?? null,
    },
    verification: {
      mode: request.verification.mode,
      status: "passed",
      checks: request.verification.checks ?? [],
    },
    budget: {
      max_response_bytes: request.budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: request.idempotency_key ?? null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  validateFoundationBridgeResult(envelope);
  return envelope;
}

async function seedLayerEvidenceFixture(artifactRoot) {
  const ref = layerEvidenceRef().ref;
  await writeArtifactStateStoreEnvelope({
    artifactRoot,
    envelope: createArtifactStateStoreEnvelope({
      ref,
      schema: A3_INPUT_SCHEMA,
      producer: {
        kind: "template",
        id: "template.items.fixture_layer_evidence",
        pack: "items",
      },
      created_at: "2026-07-04T00:00:00.000Z",
      summary: {
        schema: A3_INPUT_SCHEMA,
        item_count: 2,
        track_count: 2,
        evidence_family_count: 2,
        truncated: false,
        fixture: "first_real_a3_layer_report",
      },
      payload: {
        fixture: "first_real_a3_layer_report",
        smoke_only: true,
        evidence_families: ["items", "tracks"],
        items: [
          {
            item_ref: "item:guid:{A3-FIXTURE-ITEM-001}",
            track_ref: "track:name:Dialog",
            name: "dialog-layer-cue",
            color: "blue",
          },
          {
            item_ref: "item:guid:{A3-FIXTURE-ITEM-002}",
            track_ref: "track:name:Music",
            name: "music-layer-cue",
            color: "green",
          },
        ],
        tracks: [
          {
            track_ref: "track:name:Dialog",
            name: "Dialog",
            item_count: 1,
          },
          {
            track_ref: "track:name:Music",
            name: "Music",
            item_count: 1,
          },
        ],
      },
    }),
  });
  return ref;
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
        [A3_OPT_IN_ENV]: "",
        [A3_ARTIFACT_ROOT_ENV]: "",
        [A3_LAYER_EVIDENCE_REF_ENV]: "",
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
        [A3_OPT_IN_ENV]: "",
        [A3_ARTIFACT_ROOT_ENV]: "",
        [A3_LAYER_EVIDENCE_REF_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected A3 live smoke script to exit with status 2.");
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-04T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
