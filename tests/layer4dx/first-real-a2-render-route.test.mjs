import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  createArtifactRef,
  createObjectRef,
  validateFoundationBridgeResult,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  artifactPathFromRef,
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SCRIPT_PATH = fileURLToPath(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url));
const BRIDGE_SOURCE = readFileSync(BRIDGE_SCRIPT_PATH, "utf8");
const A2_FLAG = "--first-real-a2-render";
const A2_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A2_LIVE_SMOKE";
const A2_REGION_REF_ENV = "OPENREAPER_FIRST_REAL_A_REGION_REF";
const A2_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
const A2_RENDER_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT";
const A2_OPERATIONS = Object.freeze([
  "render.region_wav",
  "render.delivery_report.create",
]);
const A2_OPERATION_KEYS = Object.freeze(A2_OPERATIONS.map((operation) => `run_job:${operation}`));
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
  "render.targets",
  "render.track_item",
  "template.execute",
].map((operation) => `run_job:${operation}`));
const A2_SCHEMAS = Object.freeze([
  "render.region_wav_output.v1",
  "render.render_job_evidence.v1",
  "render.delivery_report.v1",
]);

describe("First-Real-Fixture-A A2 render route", () => {
  it("adds a separate runtime allowlist for exactly the two A2 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS, [
      "template.render.render_region_wav",
      "template.render.create_delivery_report",
    ]);

    const bridge = capturingA2Executor();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
        opt_in_env: A2_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 4,
    });
    assert.deepEqual(runtime.live_gate.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS);

    const render = await runtime.call_template({
      id: "template.render.render_region_wav",
      input: a2RenderInput(),
      refs: {
        region_ref: regionRef(),
      },
      context: context({ request_sequence: 1 }),
    });
    assert.equal(render.ok, true);

    const delivery = await runtime.call_template({
      id: "template.render.create_delivery_report",
      input: a2DeliveryInput(),
      refs: {
        output_artifact_refs: outputArtifactRef(),
        render_job_evidence_ref: evidenceArtifactRef(),
        region_ref: regionRef(),
        job_ref: jobRef(),
      },
      context: context({ request_sequence: 2 }),
    });
    assert.equal(delivery.ok, true);

    assert.deepEqual(bridge.seen.map((request) => request.operation.name), A2_OPERATIONS);
    const renderRequest = bridge.seen[0];
    assert.equal(renderRequest.operation.family, "run_job");
    assert.equal(renderRequest.pack.id, "render");
    assert.equal(renderRequest.pack.risk, "write");
    assert.equal(renderRequest.undo.mode, "required");
    assert.equal(renderRequest.artifacts.allow, true);
    assert.equal(typeof renderRequest.idempotency_key, "string");
    assert.equal(renderRequest.params.output_policy, "openreaper_managed_render_root");
    assert.equal("output_path" in renderRequest.params, false);
    assert.equal("output_directory" in renderRequest.params, false);

    const deliveryRequest = bridge.seen[1];
    assert.equal(deliveryRequest.operation.family, "run_job");
    assert.equal(deliveryRequest.pack.id, "render");
    assert.equal(deliveryRequest.pack.risk, "read");
    assert.equal(deliveryRequest.undo.mode, "none");
    assert.equal(deliveryRequest.artifacts.allow, true);
    assert.equal("idempotency_key" in deliveryRequest, false);
    assert.equal(deliveryRequest.refs.filter((ref) => ref.kind === "artifact").length, 2);

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_FIRST_REAL_A1_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
    const rejected = await mixed.call_template({
      id: "template.render.render_region_wav",
      input: a2RenderInput(),
      refs: { region_ref: regionRef() },
      context: context(),
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED");
  });

  it("keeps the A2 runner safe-skipped by default and typed for missing roots or transport", async () => {
    const skipped = runSmoke([A2_FLAG], {
      [A2_OPT_IN_ENV]: "",
      [A2_ARTIFACT_ROOT_ENV]: "",
      [A2_RENDER_ROOT_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "First-Real-Fixture-A A2 Render Route");
    assert.equal(skipped.batch, "First-Real-Fixture-A A2 Render Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, A2_OPERATION_KEYS);
    assert.equal(skipped.fixture_inputs.region_ref, "region:index:0");

    const transportDir = await createTransportDir("openreaper-a2-blocker-transport-");
    const renderRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-render-root-"));
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-artifact-root-"));

    const missingArtifact = runSmokeExpectingFailure([A2_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A2_ARTIFACT_ROOT_ENV]: join(tmpdir(), `openreaper-a2-missing-artifact-${process.pid}`),
      [A2_RENDER_ROOT_ENV]: renderRoot,
    });
    assert.equal(missingArtifact.reason, "artifact_root_absent");
    assert.equal(missingArtifact.blocker, "artifact_root_absent");
    assert.equal("attempted_template_ids" in missingArtifact, false);

    const missingRender = runSmokeExpectingFailure([A2_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [A2_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A2_RENDER_ROOT_ENV]: join(tmpdir(), `openreaper-a2-missing-render-${process.pid}`),
    });
    assert.equal(missingRender.reason, "render_root_absent");
    assert.equal(missingRender.blocker, "render_root_absent");
    assert.equal("attempted_template_ids" in missingRender, false);

    const missingTransport = runSmokeExpectingFailure([A2_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(tmpdir(), `openreaper-a2-missing-transport-${process.pid}`),
      [A2_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A2_RENDER_ROOT_ENV]: renderRoot,
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.equal(missingTransport.blocker, "live_bridge_transport_absent");
    assert.equal("attempted_template_ids" in missingTransport, false);
  });

  it("proves fake A2 managed WAV output plus artifact summary/payload readback", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-fake-artifacts-"));
    const renderRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-fake-renders-"));
    const report = runSmoke([A2_FLAG, "--fake"], {
      [A2_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A2_RENDER_ROOT_ENV]: renderRoot,
      [A2_REGION_REF_ENV]: "region:index:0",
    });

    assert.equal(report.ok, true);
    assert.equal(report.mode, "fake");
    assert.equal(report.reason, "first_real_fixture_a2_render_delivery_readback_passed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.expected_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS);
    assert.deepEqual(Object.keys(report.artifact_refs).sort(), [...A2_SCHEMAS].sort());
    assert.equal(report.executions.length, 2);
    assert.equal(report.executions[0].id, "template.render.render_region_wav");
    assert.equal(report.executions[0].counts.artifacts, 2);
    assert.equal(report.executions[0].counts.jobs, 1);
    assert.equal(report.executions[0].physical_output.ok, true);
    assert.equal(report.executions[1].id, "template.render.create_delivery_report");
    assert.equal(report.executions[1].counts.artifacts, 1);
    assert.equal(report.executions[1].consumed_readbacks.length, 2);
    assert.equal(report.executions[1].produced_readback.summary_ok, true);
    assert.equal(report.executions[1].produced_readback.payload_ok, true);

    for (const [schema, ref] of Object.entries(report.artifact_refs)) {
      const parts = parseArtifactRef(ref);
      assert.equal(parts.owner_pack, "render");
      assert.equal(readFileSync(artifactPathFromRef(artifactRoot, ref), "utf8").includes('"contract":"artifact.state_store.v1"'), true);
      assert.equal(A2_SCHEMAS.includes(schema), true);
    }

    const wavPath = join(renderRoot, report.physical_output.managed_relative_path);
    const header = readFileSync(wavPath);
    assert.equal(header.subarray(0, 4).toString("ascii"), "RIFF");
    assert.equal(header.subarray(8, 12).toString("ascii"), "WAVE");
  });

  it("writes only the A2 render request to transport when no REAPER answers", async () => {
    const artifactRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-timeout-artifacts-"));
    const renderRoot = await mkdtemp(join(tmpdir(), "openreaper-a2-timeout-renders-"));
    const transportDir = await createTransportDir("openreaper-a2-timeout-transport-");
    await writeReadyHeartbeat(transportDir);
    const report = runSmokeExpectingFailure([A2_FLAG, "--live"], {
      [A2_ARTIFACT_ROOT_ENV]: artifactRoot,
      [A2_RENDER_ROOT_ENV]: renderRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [A2_REGION_REF_ENV]: "region:index:0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_FIRST_REAL_A2_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.attempted_template_ids, ["template.render.render_region_wav"]);
    assert.equal(report.executions.length, 2);
    assert.equal(report.executions[1].skipped, true);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 1);
    const request = requests[0];
    assert.equal(`${request.operation.family}:${request.operation.name}`, "run_job:render.region_wav");
    assert.equal(request.pack.id, "render");
    assert.equal(request.pack.risk, "write");
    assert.equal(request.undo.mode, "required");
    assert.equal(request.artifacts.allow, true);
    assert.equal(typeof request.idempotency_key, "string");
    assert.equal(request.params.output_policy, "openreaper_managed_render_root");
    assert.equal(request.params.collision_policy, "fail_if_exists");
    assert.equal("output_path" in request.params, false);
    assert.equal("output_directory" in request.params, false);
    assert.equal("lua" in request, false);
    assert.equal("action" in request, false);
    assert.equal("shell" in request, false);
    assert.equal("process" in request, false);
  });

  it("keeps the Lua bridge A2 allowlist exact and free of raw execution routes", () => {
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
      "run_job:project.create_project_map_snapshot",
      "run_job:project.create_observation_bundle",
      ...D29_RENDER_JOB_OPERATION_KEYS,
      ...A2_OPERATION_KEYS,
    ].sort());

    assert.match(BRIDGE_SOURCE, /A2_ARTIFACT_OPERATIONS/);
    assert.match(BRIDGE_SOURCE, /OPENREAPER_LIVE_SMOKE_RENDER_ROOT/);
    assert.match(BRIDGE_SOURCE, /render_root_not_configured/);
    assert.match(BRIDGE_SOURCE, /RenderFileSection/);
    assert.match(BRIDGE_SOURCE, /managed_render_output/);
    assert.match(BRIDGE_SOURCE, /render_output_exists/);
    assert.match(BRIDGE_SOURCE, /render_evidence_output_mismatch/);
    assert.match(BRIDGE_SOURCE, /template\.render\.render_region_wav/);
    assert.match(BRIDGE_SOURCE, /template\.render\.create_delivery_report/);
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
    assert.doesNotMatch(BRIDGE_SOURCE, /render_full_project|render_region_video|render_stems|upload|publish|LIVE_SMOKE_MATRIX|list_recipes|call_recipe/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
  });

  it("keeps A2 render preflight blockers typed and diagnostic without broadening the route", () => {
    for (const blocker of [
      "region_ref_missing",
      "region_ref_ambiguous",
      "region_bounds_invalid",
      "no_overlapping_audio_item",
      "take_source_missing",
      "source_file_missing_or_offline",
      "source_type_unsupported",
      "source_length_unreadable",
      "source_range_overlap_invalid",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(blocker), blocker);
    }

    for (const field of [
      "source_type",
      "source_filename_present",
      "source_file_exists",
      "item_ref",
      "take_ref",
      "region_ref",
      "preferred_region_ref",
      "item_start_seconds",
      "item_end_seconds",
      "region_start_seconds",
      "region_end_seconds",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`${field}\\s*=`), field);
    }

    assert.match(BRIDGE_SOURCE, /recommended_region_ref_scheme = "region:name:<unique-region-name>"/);
    assert.match(BRIDGE_SOURCE, /supported_region_ref_schemes/);
    assert.match(BRIDGE_SOURCE, /fallback_region_ref_scheme = "region:index:<zero-based-region-index>"/);
    assert.match(BRIDGE_SOURCE, /source_length_with_file_fallback/);
    assert.match(BRIDGE_SOURCE, /PCM_Source_CreateFromFile/);
    assert.match(BRIDGE_SOURCE, /source_length_method/);
    assert.match(BRIDGE_SOURCE, /pcm_source_create_from_file/);
    assert.match(BRIDGE_SOURCE, /RenderFileSection/);
    assert.match(BRIDGE_SOURCE, /source\.source_filename/);
    assert.doesNotMatch(BRIDGE_SOURCE, /RenderProject|RenderTrack|RenderFullProject|output_path\s*=|output_directory\s*=/);
  });
});

function a2RenderInput() {
  return {
    format: "wav",
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: 48000,
    bit_depth: 24,
    channel_count: 2,
    include_sidecar_manifest: false,
  };
}

function a2DeliveryInput() {
  return {
    max_report_rows: 12,
    include_output_metadata: true,
    include_job_evidence: true,
    include_region_summary: true,
  };
}

function regionRef() {
  return createObjectRef("region", { scheme: "index", value: "0" }, { ref: "region:index:0" });
}

function jobRef() {
  return createObjectRef("job", { scheme: "job_id", value: "render.region_wav.fixture" });
}

function outputArtifactRef() {
  return createArtifactRef({
    owner_pack: "render",
    scope: "region_wav_output",
    id: "art_20260704000000000_001_aaa111",
    schema: "render.region_wav_output.v1",
  });
}

function evidenceArtifactRef() {
  return createArtifactRef({
    owner_pack: "render",
    scope: "render_job_evidence",
    id: "art_20260704000000000_001_bbb222",
    schema: "render.render_job_evidence.v1",
  });
}

function reportArtifactRef(request) {
  return createArtifactRef({
    owner_pack: "render",
    scope: "delivery_report",
    id: `art_${request.id.slice(4)}`,
    schema: "render.delivery_report.v1",
  });
}

function capturingA2Executor() {
  const seen = [];
  return {
    seen,
    config: {
      contract: "first_real_fixture_a2.capture_executor.v1",
      kind: "capture",
      spawned_reaper: false,
    },
    dispatch(request) {
      seen.push(request);
      if (request.operation.name === "render.region_wav") {
        return okBridgeEnvelope(request, {
          summary: {
            job_ref: jobRef().ref,
            output_artifact_ref: outputArtifactRef().ref,
            evidence_artifact_ref: evidenceArtifactRef().ref,
            format: "wav",
            output_policy: "openreaper_managed_render_root",
            collision_policy: "fail_if_exists",
            file_count: 1,
            reused_existing: false,
            truncated: false,
          },
          artifacts: [outputArtifactRef(), evidenceArtifactRef()],
          jobs: [jobRef()],
        });
      }
      return okBridgeEnvelope(request, {
        summary: {
          artifact_ref: reportArtifactRef(request).ref,
          schema: "render.delivery_report.v1",
          output_artifact_count: 1,
          job_evidence_count: 1,
          nonempty_output_count: 1,
          report_row_count: 1,
          issue_count: 0,
          truncated: false,
        },
        artifacts: [reportArtifactRef(request)],
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
      jobs: result.jobs ?? [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    },
    undo: {
      mode: request.undo.mode,
      opened: request.undo.mode !== "none",
      closed: request.undo.mode !== "none",
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

async function createTransportDir(prefix) {
  const transportDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(transportDir, "requests"));
  await mkdir(join(transportDir, "results"));
  return transportDir;
}

async function writeReadyHeartbeat(transportDir) {
  await writeFile(join(transportDir, "openreaper-bridge-liveness-v1.json"), `${JSON.stringify({
    active_generation: Number(process.env.OPENREAPER_LIVE_BRIDGE_GENERATION || 1),
    active_owner: process.env.OPENREAPER_LIVE_BRIDGE_OWNER || "openreaper-live-smoke",
    contract: "openreaper.bridge_liveness.v1",
    interval_ms: 500,
    refreshed_at_unix_s: Math.floor(Date.now() / 1_000),
    sequence: 1,
  })}\n`);
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
        [A2_OPT_IN_ENV]: "",
        [A2_ARTIFACT_ROOT_ENV]: "",
        [A2_RENDER_ROOT_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: BRIDGE_SCRIPT_PATH,
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
        [A2_OPT_IN_ENV]: "",
        [A2_ARTIFACT_ROOT_ENV]: "",
        [A2_RENDER_ROOT_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: BRIDGE_SCRIPT_PATH,
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected A2 live smoke script to exit with status 2.");
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
