import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  artifactPathFromRef,
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../../packages/core/src/artifact-state-store-live-helper-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  LIVE_BRIDGE_HEARTBEAT_FILENAME,
  LIVE_BRIDGE_LIVENESS_CONTRACT,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";
import {
  ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV,
  ARTIFACT_STATE_LIVE_SMOKE_HELPER_SCRIPT_PATH,
  ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV,
  ARTIFACT_STATE_LIVE_SMOKE_OPERATION,
  buildArtifactCanaryBridgeRequest,
  dispatchFakeArtifactCanary,
} from "../../scripts/smoke-artifact-state-live.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-artifact-state-live.mjs";
const BRIDGE_SCRIPT_PATH = fileURLToPath(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url));
const HELPER_SOURCE = readFileSync(ARTIFACT_STATE_LIVE_SMOKE_HELPER_SCRIPT_PATH, "utf8");
const VALID_REF = "artifact:core:live_artifact_smoke:art_20260703010203999_451_a4b5c6";

describe("Layer 4.5C Lua artifact helper and live artifact smoke gate", () => {
  it("keeps the artifact smoke gate default safe-skipped and non-spawning", () => {
    const report = runSmoke([], {
      [ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV]: "",
      [ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });

    assert.equal(report.ok, true);
    assert.equal(report.skipped, true);
    assert.equal(report.reason, "explicit_opt_in_required");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.helper_default_enabled, false);
    assert.deepEqual(report.attempted_template_ids, []);
    assert.equal(report.broad_live_smoke, false);
    assert.equal(report.live_pass_claimed, false);
    assert.equal(report.old_matrix_updated, false);
  });

  it("proves fake request/result shape and get_state summary/payload readback", () => {
    const report = runSmoke(["--fake"], {
      [ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV]: "",
      [ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });

    assert.equal(report.ok, true);
    assert.equal(report.mode, "fake");
    assert.equal(report.reason, "artifact_helper_fake_shape_passed");
    assert.deepEqual(report.request_shape.operation, ARTIFACT_STATE_LIVE_SMOKE_OPERATION);
    assert.equal(report.request_shape.pack.id, "core");
    assert.equal(report.request_shape.artifacts_allow, true);
    assert.equal(report.request_shape.idempotency_key_present, false);
    assert.equal(report.bridge.ok, true);
    assert.equal(report.bridge.artifact_count, 1);
    assert.equal(report.bridge.last_result_updated, false);
    assert.equal(report.readback.ok, true);
    assert.equal(report.readback.summary_ok, true);
    assert.equal(report.readback.payload_ok, true);
    assert.equal(report.readback.payload_fixture, "layer4_5c_artifact_helper");
    assert.equal(report.readback.last_result_updated, false);
    assert.equal(report.artifact_path, artifactPathFromRef(report.artifact_root.path, report.request_shape.artifact_ref));
    assert.deepEqual(parseArtifactRef(report.request_shape.artifact_ref), {
      owner_pack: "core",
      scope: "live_artifact_smoke",
      id: "art_20260703010203999_451_a4b5c6",
    });
  });

  it("uses artifactPathFromRef rules for helper filesystem writes", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), "openreaper-layer4_5c-helper-"));
    const envelope = createArtifactStateStoreEnvelope({
      ref: VALID_REF,
      schema: "core.live_artifact_smoke.v1",
      producer: {
        kind: "template",
        id: "template.core.live_artifact_smoke_canary",
        pack: "core",
      },
      created_at: "2026-07-03T01:02:03.999Z",
      summary: { label: "summary fixture" },
      payload: { label: "payload fixture" },
    });

    const write = await writeArtifactStateStoreEnvelope({ artifactRoot, envelope });
    assert.equal(write.path, artifactPathFromRef(artifactRoot, VALID_REF));
    assert.equal(JSON.parse(readFileSync(write.path, "utf8")).contract, "artifact.state_store.v1");

    assert.throws(
      () => createArtifactStateStoreEnvelope({
        ...envelope,
        ref: "../artifact:core:live_artifact_smoke:art_20260703010203999_451_a4b5c6",
      }),
      /raw or relative path|Malformed artifact ref/,
    );
    await assert.rejects(
      () => writeArtifactStateStoreEnvelope({ artifactRoot: "relative-root", envelope }),
      /artifactRoot must be an absolute path/,
    );
  });

  it("rejects non-canary artifact identities before helper writes", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), "openreaper-layer4_5c-non-canary-"));
    const request = buildArtifactCanaryBridgeRequest({
      commandId: "cmd_20260703010203999_451_a4b5c6",
      context: {
        session_id: "non-canary-test",
        expected_owner: "openreaper-artifact-state-smoke",
        expected_generation: 1,
        created_at: "2026-07-03T01:02:03.999Z",
      },
    });
    request.params.artifact_ref = "artifact:analysis:live_artifact_smoke:art_20260703010203999_451_a4b5c6";
    request.params.schema = "analysis.live_artifact_smoke.v1";
    request.params.producer = {
      kind: "template",
      id: "template.analysis.live_artifact_smoke_canary",
      pack: "analysis",
    };

    const result = await dispatchFakeArtifactCanary(request, { artifactRoot });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PARAMS_INVALID");
    assert.match(result.error.message, /core live_artifact_smoke canary refs/);
    assert.deepEqual(await readdir(artifactRoot), []);
  });

  it("returns a typed blocker when opt-in live smoke has a configured but missing artifact root", () => {
    const missingRoot = path.join(tmpdir(), `openreaper-missing-artifact-root-${process.pid}`);
    const report = runSmokeExpectingFailure(["--live"], {
      [ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV]: "",
      [ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV]: missingRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });

    assert.equal(report.ok, false);
    assert.equal(report.reason, "artifact_root_absent");
    assert.equal(report.blocker, "artifact_root_absent");
    assert.equal(report.spawned_reaper, false);
    assert.equal("request_shape" in report, false);
    assert.equal(report.live_pass_claimed, false);
  });

  it("does not claim live pass when no real REAPER helper answers the transport", async () => {
    const artifactRoot = await mkdtemp(path.join(tmpdir(), "openreaper-layer4_5c-live-root-"));
    const transportDir = await mkdtemp(path.join(tmpdir(), "openreaper-layer4_5c-transport-"));
    await mkdir(path.join(transportDir, "requests"));
    await mkdir(path.join(transportDir, "results"));
    await writeFile(path.join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME), `${JSON.stringify({
      contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
      active_owner: "openreaper-artifact-state-smoke",
      active_generation: 1,
      sequence: 1,
      refreshed_at_unix_s: Math.floor(Date.now() / 1_000),
      interval_ms: 500,
    })}\n`);

    const report = runSmokeExpectingFailure(["--live"], {
      [ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV]: "",
      [ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV]: artifactRoot,
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-artifact-state-smoke",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    });

    assert.equal(report.ok, false);
    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.details.bridge.code, "BRIDGE_TIMEOUT");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.equal(report.request_shape.operation.family, "artifact_metadata");
    assert.equal(report.request_shape.operation.name, "artifact_state_store.write_canary");
    assert.deepEqual(report.attempted_template_ids, []);

    const requestFiles = await readdir(path.join(transportDir, "requests"));
    assert.equal(requestFiles.length, 1);
    const request = JSON.parse(readFileSync(path.join(transportDir, "requests", requestFiles[0]), "utf8"));
    assert.equal(request.operation.family, "artifact_metadata");
    assert.equal(request.operation.name, "artifact_state_store.write_canary");
    assert.equal(request.artifacts.allow, true);
    assert.equal(request.undo.mode, "none");
    assert.equal("artifact_root" in request.params, false);
  });

  it("keeps the Lua helper narrow: no raw Lua/action/shell/process or broad bridge operations", () => {
    assert.match(HELPER_SOURCE, /OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT/);
    assert.match(HELPER_SOURCE, /artifact_state_store\.write_canary/);
    assert.match(HELPER_SOURCE, /artifact\.state_store\.v1/);
    assert.match(HELPER_SOURCE, /artifact:<owner_pack>:<scope>:<id>/);
    assert.match(HELPER_SOURCE, /CANARY_OWNER_PACK = "core"/);
    assert.match(HELPER_SOURCE, /CANARY_SCOPE = "live_artifact_smoke"/);
    assert.match(HELPER_SOURCE, /CANARY_SCHEMA = "core\.live_artifact_smoke\.v1"/);
    assert.match(HELPER_SOURCE, /CANARY_PRODUCER_ID = "template\.core\.live_artifact_smoke_canary"/);
    assert.match(HELPER_SOURCE, /validate_canary_identity/);
    assert.match(HELPER_SOURCE, /schema:find\("\.\.", 1, true\)/);
    assert.match(HELPER_SOURCE, /schema:sub\(1, 1\) == "\."/);
    assert.match(HELPER_SOURCE, /schema:sub\(-1\) == "\."/);
    assert.match(HELPER_SOURCE, /rest:find\("\.\.", 1, true\)/);
    assert.match(HELPER_SOURCE, /rest:sub\(1, 1\) == "\."/);
    assert.match(HELPER_SOURCE, /rest:sub\(-1\) == "\."/);
    assert.match(HELPER_SOURCE, /segment_count > 4/);
    assert.equal(HELPER_SOURCE.includes('value:match("^[A-Za-z]:[\\\\/]")'), true);
    assert.match(HELPER_SOURCE, /validate_created_at\(request\.created_at\)/);
    assert.match(HELPER_SOURCE, /ISO-8601 UTC millisecond timestamp/);
    assert.match(HELPER_SOURCE, /contains_public_artifact_last_result_ref/);
    assert.match(HELPER_SOURCE, /last_result:artifact:%d\+/);
    assert.doesNotMatch(
      HELPER_SOURCE,
      /\b(Main_OnCommand|NamedCommandLookup|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(HELPER_SOURCE, /\["(?:query_state|run_command|run_action|run_job):/);
    assert.doesNotMatch(HELPER_SOURCE, /call_template|list_templates|recipe|LIVE_SMOKE_MATRIX/);
  });

  it("does not add MCP tools, call_template live ids, recipe paths, or raw execution bypasses", () => {
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_recipe",
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
    assert.equal(TOOL_ABI_V1_TOOL_NAMES.length, 6);

    const smokeSource = readFileSync(new URL(`../../${SMOKE_SCRIPT}`, import.meta.url), "utf8");
    assert.doesNotMatch(smokeSource, /createCallTemplateRuntime|CALL_TEMPLATE_RUNTIME|list_templates|list_recipes/);
    assert.doesNotMatch(smokeSource, /Main_OnCommand|NamedCommandLookup|child_process|spawn\(|execFile/);

    const request = buildArtifactCanaryBridgeRequest({
      commandId: "cmd_20260703010203999_451_a4b5c6",
      context: {
        session_id: "shape-test",
        expected_owner: "openreaper-artifact-state-smoke",
        expected_generation: 1,
        created_at: "2026-07-03T01:02:03.999Z",
      },
    });
    assert.equal(request.operation.family, "artifact_metadata");
    assert.equal(request.pack.id, "core");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.artifacts.allow, true);
    assert.equal("idempotency_key" in request, false);
    assert.equal("lua" in request, false);
    assert.equal("action" in request, false);
    assert.equal("shell" in request, false);
  });
});

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
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
        [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: BRIDGE_SCRIPT_PATH,
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected artifact live smoke script to exit with status 2.");
}
