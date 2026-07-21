import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { once } from "node:events";
import { access, chmod, copyFile, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, utimes, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  ALPHA3_2B3_DOCTOR_TASK_MODES,
  ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
  ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
  composeAlpha3_2B3RuntimeDoctorReadiness,
  createAlpha3_2B3DoctorTaskResult,
  inspectAlpha3_2B3ReaperProcess,
  inspectAlpha3_2B3RenderRoot,
  normalizeAlpha3_2B3RequestResponseProof,
  parseAlpha3_2B3DoctorArgs,
  parseAlpha3_2B3ExpectedGeneration,
  parseAlpha3_2B3ExpectedIdentity,
  resolveAlpha3_2B3DoctorRenderRoot,
} from "../../packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs";
import {
  LIVE_BRIDGE_HEARTBEAT_FILENAME,
  LIVE_BRIDGE_LIVENESS_CONTRACT,
  LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT,
  LIVE_BRIDGE_LIVENESS_STATUS,
  createLiveBridgeExecutorFromEnv,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const STDIO_SERVER = path.join(REPO_ROOT, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const EXPECTED_TOOLS = ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"];

function runtimeEnv(transportRoot, renderRoot, overrides = {}) {
  return {
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportRoot,
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(REPO_ROOT, "reaper/bridge/openreaper-live-bridge.lua"),
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot,
    OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
    OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    ...overrides,
  };
}

describe("Alpha3.2-B3 runtime / doctor live readiness", () => {
  it("strictly parses safe non-negative generations and omits absent identity fields", () => {
    assert.deepEqual(parseAlpha3_2B3ExpectedGeneration(undefined), { present: false, valid: true });
    for (const [input, expected] of [["0", 0], ["1", 1], ["9007199254740991", Number.MAX_SAFE_INTEGER], [7, 7]]) {
      assert.deepEqual(parseAlpha3_2B3ExpectedGeneration(input), {
        present: true,
        valid: true,
        value: expected,
      });
    }
    for (const invalid of ["", "01", "+1", "1.0", "1x", "-1", "9007199254740992", -1, 1.5, null]) {
      assert.deepEqual(parseAlpha3_2B3ExpectedGeneration(invalid), { present: true, valid: false });
    }

    const absent = parseAlpha3_2B3ExpectedIdentity({});
    assert.equal(Object.hasOwn(absent.owner, "value"), false);
    assert.equal(Object.hasOwn(absent.generation, "value"), false);
  });

  it("composes exact B1 statuses with bounded MCP, bridge, render-root, and not-run request proof", async () => {
    const renderRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-render-"));
    const configAbsent = await composeAlpha3_2B3RuntimeDoctorReadiness({
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot },
      liveBridge: createLiveBridgeExecutorFromEnv({}),
    });
    assert.equal(configAbsent.contract, ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT);
    assert.equal(configAbsent.mcp_reachability.status, "reachable");
    assert.equal(configAbsent.bridge.probe_contract, LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT);
    assert.equal(configAbsent.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.CONFIG_ABSENT);
    assert.equal(configAbsent.render_root.status, "render_root_ready");
    assert.deepEqual(configAbsent.request_response, {
      status: "not_run",
      ready: false,
      template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
    });
    assert.deepEqual(configAbsent.safety, {
      read_only: true,
      dispatch_performed: false,
      direct_bridge_request_created: false,
      reaper_started: false,
      render_root_created: false,
    });

    const missingTransport = path.join(renderRoot, "missing-transport");
    const transportAbsent = await composeAlpha3_2B3RuntimeDoctorReadiness({
      env: runtimeEnv(missingTransport, renderRoot),
      liveBridge: createLiveBridgeExecutorFromEnv(runtimeEnv(missingTransport, renderRoot)),
    });
    assert.equal(transportAbsent.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.TRANSPORT_ABSENT);
    assert.equal(transportAbsent.bridge.diagnosis, "bridge_transport_absent");
  });

  it("preserves no-heartbeat, stale, invalid, owner mismatch, generation mismatch, and ready B1 states", async () => {
    const fixture = await makeTransportFixture();
    const renderRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-render-"));
    const env = runtimeEnv(fixture.root, renderRoot);
    const liveBridge = createLiveBridgeExecutorFromEnv(env);

    const absent = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(absent.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);
    assert.equal(absent.bridge.diagnosis, "bridge_action_not_running");
    assert.deepEqual(await readdir(fixture.requests), []);

    await writeHeartbeat(fixture.root, { mtime: new Date(Date.now() - 4_000) });
    const stale = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(stale.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE);

    await writeFile(path.join(fixture.root, LIVE_BRIDGE_HEARTBEAT_FILENAME), "{bad json\n", "utf8");
    const invalid = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(invalid.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(invalid.bridge.reason, "heartbeat_json_invalid");

    await writeHeartbeat(fixture.root, { owner: "other-owner" });
    const ownerMismatch = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(ownerMismatch.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.OWNER_MISMATCH);
    assert.equal(ownerMismatch.bridge.diagnosis, "owner_generation_mismatch");

    await writeHeartbeat(fixture.root, { generation: 2 });
    const generationMismatch = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(generationMismatch.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.GENERATION_MISMATCH);
    assert.equal(generationMismatch.bridge.diagnosis, "owner_generation_mismatch");

    await writeHeartbeat(fixture.root);
    const ready = await composeAlpha3_2B3RuntimeDoctorReadiness({ env, liveBridge });
    assert.equal(ready.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    assert.equal(ready.bridge.ready, true);
    assert.equal(ready.bridge.observed.owner, "openreaper-alpha");
    assert.equal(ready.bridge.observed.generation, 1);
    assert.equal(Number.isInteger(ready.bridge.observed.age_ms), true);
    assert.deepEqual(await readdir(fixture.requests), []);

    const serialized = JSON.stringify(ready);
    assert.equal(serialized.includes(fixture.root), false);
    assert.equal(serialized.includes(path.join(fixture.root, LIVE_BRIDGE_HEARTBEAT_FILENAME)), false);
    assert.equal(serialized.length < 8_192, true);
  });

  it("enforces directional transport permissions while preserving exact B1 status and bounded projection", async () => {
    const fixture = await makeTransportFixture();
    const renderRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-render-"));
    const env = runtimeEnv(fixture.root, renderRoot);

    await chmod(fixture.root, 0o000);
    try {
      const rootDenied = await composeAlpha3_2B3RuntimeDoctorReadiness({
        env,
        liveBridge: createLiveBridgeExecutorFromEnv(env),
      });
      assert.equal(rootDenied.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.TRANSPORT_ABSENT);
      assert.equal(rootDenied.bridge.diagnosis, "transport_permission_error");
      assert.equal(rootDenied.bridge.permission_repair, "manual_required");
    } finally {
      await chmod(fixture.root, 0o700);
    }

    for (const permissionCase of [
      { candidate: fixture.root, deniedMode: 0o300, restoreMode: 0o700, repair: "manual_required", label: "transport requires read/execute" },
      { candidate: fixture.requests, deniedMode: 0o500, restoreMode: 0o700, repair: "manual_required", label: "requests requires write/execute" },
      { candidate: fixture.results, deniedMode: 0o300, restoreMode: 0o700, repair: "manual_required", label: "results requires read/execute" },
    ]) {
      await chmod(permissionCase.candidate, permissionCase.deniedMode);
      try {
        const permissionDenied = await composeAlpha3_2B3RuntimeDoctorReadiness({
          env,
          liveBridge: createLiveBridgeExecutorFromEnv(env),
        });
        assert.equal(
          permissionDenied.bridge.status,
          LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING,
          permissionCase.label,
        );
        assert.equal(permissionDenied.bridge.diagnosis, "transport_permission_error", permissionCase.label);
        assert.equal(permissionDenied.bridge.ready, false, permissionCase.label);
        assert.equal(permissionDenied.bridge.permission_repair, permissionCase.repair, permissionCase.label);
        const serialized = JSON.stringify(permissionDenied);
        assert.equal(serialized.includes(fixture.root), false, permissionCase.label);
        assert.equal(serialized.includes("EACCES"), false, permissionCase.label);
        assert.equal(serialized.includes("EPERM"), false, permissionCase.label);
        assert.equal(serialized.includes("error_code"), false, permissionCase.label);
      } finally {
        await chmod(permissionCase.candidate, permissionCase.restoreMode);
      }
    }
  });

  it("fails invalid expected generation closed as the exact B1 probe-input status", async () => {
    const fixture = await makeTransportFixture();
    const renderRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-render-"));
    await writeHeartbeat(fixture.root);
    const env = runtimeEnv(fixture.root, renderRoot, {
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1trailing",
    });
    const readiness = await composeAlpha3_2B3RuntimeDoctorReadiness({
      env,
      liveBridge: createLiveBridgeExecutorFromEnv(env),
    });
    assert.equal(readiness.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.PROBE_INPUT_INVALID);
    assert.equal(readiness.bridge.diagnosis, "bridge_probe_input_invalid");
    assert.equal(readiness.bridge.expected.generation_present, true);
    assert.equal(readiness.bridge.expected.generation_valid, false);
    assert.equal(Object.hasOwn(readiness.bridge.expected, "generation"), false);
    assert.deepEqual(await readdir(fixture.requests), []);
  });

  it("inspects render roots read-only across missing, file, symlink, unwritable, and ready fixtures", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-roots-"));
    const missing = path.join(root, "missing");
    const regularFile = path.join(root, "file");
    const realDir = path.join(root, "real");
    const linkDir = path.join(root, "link");
    const unwritable = path.join(root, "unwritable");
    await writeFile(regularFile, "x", "utf8");
    await mkdir(realDir);
    await symlink(realDir, linkDir);
    await mkdir(unwritable);

    assert.equal((await inspectAlpha3_2B3RenderRoot(undefined)).status, "render_root_not_configured");
    for (const malicious of ["relative", "file:///tmp/render", "/tmp/render\nroot", path.parse(root).root]) {
      assert.equal((await inspectAlpha3_2B3RenderRoot(malicious)).status, "render_root_path_invalid");
    }
    assert.equal((await inspectAlpha3_2B3RenderRoot(missing)).status, "render_root_missing");
    assert.equal((await inspectAlpha3_2B3RenderRoot(regularFile)).status, "render_root_not_directory");
    assert.equal((await inspectAlpha3_2B3RenderRoot(linkDir)).status, "render_root_symlink");

    await chmod(unwritable, 0o500);
    const unwritableResult = await inspectAlpha3_2B3RenderRoot(unwritable);
    assert.equal(unwritableResult.ready, false);
    assert.ok(["render_root_not_writable", "render_root_permission_error"].includes(unwritableResult.status));
    await chmod(unwritable, 0o700);

    const ready = await inspectAlpha3_2B3RenderRoot(realDir);
    assert.equal(ready.status, "render_root_ready");
    assert.equal(ready.ready, true);
    assert.deepEqual((await readdir(realDir)).sort(), []);
  });

  it("fails render-root final-component TOCTOU swaps closed without creating a write probe", { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-root-race-"));
    const candidate = path.join(root, "candidate");
    const parked = path.join(root, "parked");
    const writableTarget = path.join(root, "writable-target");
    await mkdir(candidate);
    await chmod(candidate, 0o500);
    await mkdir(writableTarget);

    let stop = false;
    let swaps = 0;
    const swapper = (async () => {
      while (!stop) {
        try {
          await rename(candidate, parked);
          await symlink(writableTarget, candidate);
          await new Promise((resolve) => setImmediate(resolve));
          await rm(candidate);
          await rename(parked, candidate);
          swaps += 1;
          await new Promise((resolve) => setImmediate(resolve));
        } catch (error) {
          if (!stop) throw error;
        }
      }
    })();

    const statuses = new Map();
    try {
      for (let index = 0; index < 500; index += 1) {
        const inspection = await inspectAlpha3_2B3RenderRoot(candidate);
        statuses.set(inspection.status, (statuses.get(inspection.status) ?? 0) + 1);
        assert.equal(inspection.ready, false, inspection.status);
      }
    } finally {
      stop = true;
      await swapper;
      await rm(root, { recursive: true, force: true });
    }
    assert.ok(swaps > 0);
    assert.ok((statuses.get("render_root_changed_during_inspection") ?? 0) > 0);
  });

  it("resolves render-root precedence and rejects PID/name spoofing unless exact signed identity and launch record agree", { timeout: 30_000 }, async () => {
    const installRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-doctor-"));
    const sessionRoot = path.join(installRoot, "session");
    const pidFile = path.join(sessionRoot, "reaper.pid");
    await mkdir(sessionRoot);
    const defaultSelection = await resolveAlpha3_2B3DoctorRenderRoot({ env: {}, installRoot, sessionRoot });
    assert.equal(defaultSelection.source, "default");
    assert.equal(defaultSelection.path, path.join(sessionRoot, "renders"));
    assert.equal(await exists(defaultSelection.path), false);

    const persisted = path.join(installRoot, "external-renders");
    await writeFile(path.join(sessionRoot, "managed-render-root.path"), `${persisted}\n`, "utf8");
    const persistedSelection = await resolveAlpha3_2B3DoctorRenderRoot({ env: {}, installRoot, sessionRoot });
    assert.equal(persistedSelection.source, "persisted_record");
    assert.equal(persistedSelection.path, persisted);

    const explicit = path.join(installRoot, "explicit-renders");
    const explicitSelection = await resolveAlpha3_2B3DoctorRenderRoot({
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: explicit },
      installRoot,
      sessionRoot,
    });
    assert.equal(explicitSelection.source, "environment");
    assert.equal(explicitSelection.path, explicit);

    assert.equal((await inspectAlpha3_2B3ReaperProcess({ sessionRoot })).status, "pid_missing");

    await writeFile(pidFile, `${process.pid}\n`, "utf8");
    const unrelatedLivePid = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
    assert.equal(unrelatedLivePid.status, "pid_identity_mismatch");
    assert.equal(unrelatedLivePid.running, false);
    assert.equal(unrelatedLivePid.pid, process.pid);
    assert.equal(unrelatedLivePid.identity_verified, false);
    assert.equal(JSON.stringify(unrelatedLivePid).includes(process.execPath), false);

    const argvZeroSpoof = spawn("/bin/sleep", ["10"], {
      argv0: "REAPER",
      stdio: "ignore",
    });
    await once(argvZeroSpoof, "spawn");
    try {
      await writeFile(pidFile, `${argvZeroSpoof.pid}\n`, "utf8");
      const spoofed = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
      assert.equal(spoofed.status, "pid_identity_mismatch");
      assert.equal(spoofed.running, false);
    } finally {
      argvZeroSpoof.kill("SIGTERM");
      await once(argvZeroSpoof, "exit").catch(() => {});
    }

    const renamedSleep = path.join(installRoot, "REAPER");
    await copyFile("/bin/sleep", renamedSleep);
    await chmod(renamedSleep, 0o700);
    const renamedChild = spawn(renamedSleep, ["10"], { stdio: "ignore" });
    await once(renamedChild, "spawn");
    try {
      const fakeStartMs = Math.floor((Date.now() - 1_000) / 1_000) * 1_000;
      await writeFile(pidFile, `${renamedChild.pid}\n`, "utf8");
      const renamedRejected = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
      assert.equal(renamedRejected.status, "pid_identity_mismatch");
      assert.equal(renamedRejected.running, false);
      assert.equal(JSON.stringify(renamedRejected).includes(renamedSleep), false);

      const signedRunner = makeIdentityHelperRunner({
        pid: renamedChild.pid,
        executable: renamedSleep,
        startMs: fakeStartMs,
      });
      const verified = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: signedRunner,
        now: Date.now(),
      });
      assert.equal(verified.status, "running");
      assert.equal(verified.running, true);
      assert.equal(verified.pid, renamedChild.pid);
      assert.equal(verified.identity_verified, true);
      assert.equal(verified.process_identity, "cockos_reaper_codesign");
      assert.equal(verified.launch_record_verified, true);

      const staleTime = new Date(fakeStartMs - 60_000);
      await utimes(pidFile, staleTime, staleTime);
      const staleReuse = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: signedRunner,
        now: Date.now(),
      });
      assert.equal(staleReuse.status, "pid_record_stale");
      assert.equal(staleReuse.running, false);

      const lateTime = new Date(fakeStartMs + 180_000);
      await utimes(pidFile, lateTime, lateTime);
      const outsideLaunchWindow = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: signedRunner,
        now: fakeStartMs + 181_000,
      });
      assert.equal(outsideLaunchWindow.status, "pid_record_stale");
      assert.equal(outsideLaunchWindow.running, false);

      await writeFile(pidFile, `${renamedChild.pid}\n`, "utf8");
      const zombieRunner = makeIdentityHelperRunner({
        pid: renamedChild.pid,
        executable: renamedSleep,
        startMs: fakeStartMs,
        state: "Z",
      });
      const zombie = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: zombieRunner,
        now: Date.now(),
      });
      assert.equal(zombie.status, "pid_not_running");
      assert.equal(zombie.running, false);

      const ambiguousRunner = makeIdentityHelperRunner({
        pid: renamedChild.pid,
        executable: renamedSleep,
        startMs: fakeStartMs,
        lsofOutput: `p${renamedChild.pid}\nftxt\nn${renamedSleep}\np${renamedChild.pid}\n`,
      });
      const ambiguous = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: ambiguousRunner,
        now: Date.now(),
      });
      assert.equal(ambiguous.status, "pid_identity_unverified");
      assert.equal(ambiguous.running, false);
      assert.equal(JSON.stringify(ambiguous).includes(renamedSleep), false);


      const unavailable = await inspectAlpha3_2B3ReaperProcess({
        sessionRoot,
        identityHelperRunner: async () => {
          throw new Error(`/private/raw/helper/path: secret stderr`);
        },
        now: Date.now(),
      });
      assert.equal(unavailable.status, "pid_identity_unverified");
      assert.equal(unavailable.running, false);
      const unavailableJson = JSON.stringify(unavailable);
      assert.equal(unavailableJson.includes("/private/raw/helper/path"), false);
      assert.equal(unavailableJson.includes("secret stderr"), false);
    } finally {
      renamedChild.kill("SIGTERM");
      await once(renamedChild, "exit").catch(() => {});
    }

    const pidTarget = path.join(sessionRoot, "pid-target");
    await writeFile(pidTarget, `${process.pid}\n`, "utf8");
    await rm(pidFile, { force: true });
    await symlink(pidTarget, pidFile);
    const linkedPidRecord = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
    assert.equal(linkedPidRecord.status, "pid_invalid");
    assert.equal(linkedPidRecord.running, false);

    await rm(pidFile, { force: true });
    await writeFile(pidFile, "99999999\n", "utf8");
    const dead = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
    assert.equal(dead.running, false);
    assert.ok(["pid_dead", "pid_identity_unverified"].includes(dead.status));
  });
  it("normalizes matching read proof and produces bounded ready, blocked, and degraded task results", async () => {
    const identity = parseAlpha3_2B3ExpectedIdentity({
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    });
    const proof = normalizeAlpha3_2B3RequestResponseProof({
      ok: true,
      bridge: { owner: "openreaper-alpha", generation: 1 },
    }, identity);
    assert.equal(proof.status, "ready");
    assert.equal(proof.ready, true);

    const runtime = {
      mcp_reachability: { status: "reachable" },
      bridge: { status: "bridge_ready", diagnosis: "bridge_ready" },
      render_root: { status: "render_root_ready", ready: true },
    };
    const renderInspection = { status: "render_root_ready", ready: true, path: "/tmp/openreaper-renders" };
    const common = {
      runtimeReadiness: runtime,
      requestResponse: proof,
      reaperProcess: { status: "running", running: true, pid: process.pid },
      renderInspection,
      installRoot: "/tmp/OpenReaper-alpha",
      startCommand: "/tmp/OpenReaper-alpha/bin/openreaper-start",
      bridgeActionName: "OpenReaper: Start MCP bridge",
      transportDir: "/tmp/OpenReaper-alpha/session/transport",
    };

    const liveEdit = createAlpha3_2B3DoctorTaskResult({ ...common, mode: "live-edit" });
    assert.equal(liveEdit.status, "ready");
    assert.equal(liveEdit.ready, true);

    const render = createAlpha3_2B3DoctorTaskResult({ ...common, mode: "render" });
    assert.equal(render.status, "ready");
    assert.equal(render.ready_for_render, true);
    assert.equal(render.render_execution_proven, false);
    assert.equal(render.codec_support_assessed, false);
    assert.equal(render.scope, "preflight_only");

    for (const mode of ["media-import", "project-query"]) {
      const degraded = createAlpha3_2B3DoctorTaskResult({ ...common, mode });
      assert.equal(degraded.status, "degraded");
      assert.equal(degraded.task_specific_readiness, "not_assessed");
      assert.equal(degraded.failure_layer, "task_specific");
    }

    const blocked = createAlpha3_2B3DoctorTaskResult({
      ...common,
      mode: "live-edit",
      runtimeReadiness: {
        ...runtime,
        bridge: { status: "bridge_action_not_running", diagnosis: "bridge_action_not_running" },
      },
      requestResponse: { status: "not_run", ready: false },
      reaperProcess: { status: "pid_missing", running: false, pid: null },
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.missing_precondition, "reaper_not_running");
    assert.equal(blocked.failure_layer, "reaper_process");
    assert.equal(blocked.user_action_required, true);
    assert.match(blocked.safe_copy_paste_fix, /openreaper-start'?$/);
    assert.equal(JSON.stringify(blocked).length < 8_192, true);

    const actionMissing = createAlpha3_2B3DoctorTaskResult({
      ...common,
      mode: "live-edit",
      runtimeReadiness: {
        ...runtime,
        bridge: { status: "bridge_action_not_running", diagnosis: "bridge_action_not_running" },
      },
      requestResponse: { status: "not_run", ready: false },
    });
    assert.equal(actionMissing.missing_precondition, "bridge_action_not_running");
    assert.equal(actionMissing.failure_layer, "bridge_heartbeat");
    assert.equal(actionMissing.safe_copy_paste_fix, null);

    const staleHeartbeat = createAlpha3_2B3DoctorTaskResult({
      ...common,
      mode: "live-edit",
      runtimeReadiness: {
        ...runtime,
        bridge: {
          status: LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE,
          diagnosis: "bridge_loop_unresponsive",
          ready: false,
        },
      },
      requestResponse: { status: "not_run", ready: false },
    });
    assert.deepEqual(staleHeartbeat.restart_required, { mcp_client: false, reaper: false });
    assert.equal(staleHeartbeat.restart_escalation.reaper.conditional, true);
    assert.equal(
      staleHeartbeat.restart_escalation.reaper.condition,
      "heartbeat_remains_stale_after_rerunning_bridge_action",
    );
    assert.match(staleHeartbeat.next_action.instruction, /rerun the Action/);
    assert.match(staleHeartbeat.next_action.instruction, /only if the heartbeat remains stale/);

    const maliciousTransport = "/tmp/openreaper transport'; printf unsafe";
    const permissionRepair = createAlpha3_2B3DoctorTaskResult({
      ...common,
      mode: "live-edit",
      transportDir: maliciousTransport,
      runtimeReadiness: {
        ...runtime,
        bridge: {
          status: LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING,
          diagnosis: "transport_permission_error",
          permission_repair: "manual_required",
          ready: false,
        },
      },
      requestResponse: { status: "not_run", ready: false },
    });
    assert.equal(permissionRepair.missing_precondition, "transport_permission_error");
    assert.equal(permissionRepair.evidence.bridge_status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);
    assert.deepEqual(permissionRepair.restart_required, { mcp_client: false, reaper: false });
    assert.equal(permissionRepair.safe_copy_paste_fix, null);
    assert.match(permissionRepair.next_action.instruction, /Automatic transport mutation is intentionally unavailable/);
    assert.match(permissionRepair.next_action.instruction, /without following links/);
    assert.match(permissionRepair.next_action.instruction, /No MCP or REAPER restart is required/);

    for (const renderStatus of [
      "render_root_missing",
      "render_root_not_writable",
      "render_root_symlink",
      "render_root_path_invalid",
    ]) {
      const rejectedSelectedPath = `/tmp/rejected render '$(touch PWNED)'/${renderStatus}`;
      const renderRecovery = createAlpha3_2B3DoctorTaskResult({
        ...common,
        mode: "render",
        renderInspection: {
          status: renderStatus,
          ready: false,
          path: rejectedSelectedPath,
        },
      });
      assert.equal(renderRecovery.missing_precondition, renderStatus);
      assert.deepEqual(renderRecovery.restart_required, { mcp_client: true, reaper: true });
      assert.equal(renderRecovery.user_action_required, true);
      assert.equal(renderRecovery.ready_for_render, false);
      assert.equal(renderRecovery.render_execution_proven, false);
      assert.equal(renderRecovery.codec_support_assessed, false);
      assert.equal(renderRecovery.scope, "preflight_only");
      assert.equal(typeof renderRecovery.safe_copy_paste_fix, "string");
      assert.match(renderRecovery.safe_copy_paste_fix, /mkdtempSync/);
      assert.match(renderRecovery.safe_copy_paste_fix, /realpathSync/);
      assert.match(renderRecovery.safe_copy_paste_fix, /openreaper-render-recovery-/);
      assert.match(renderRecovery.safe_copy_paste_fix, /--render-root "\$ROOT"/);
      assert.equal(renderRecovery.safe_copy_paste_fix.includes(rejectedSelectedPath), false);
      assert.equal(renderRecovery.safe_copy_paste_fix.includes("fchmodSync"), false);
      assert.equal(renderRecovery.safe_copy_paste_fix.includes("mkdirSync"), false);
      assert.equal(Buffer.byteLength(renderRecovery.safe_copy_paste_fix, "utf8") <= 6_144, true);
      assert.match(renderRecovery.next_action.instruction, /start a new OpenReaper session/);
      assert.match(renderRecovery.next_action.instruction, /does not repair the original selected path/);
    }
  });

  it("keeps transport repair manual and routes render recovery through a fresh canonical temp root without touching ancestor-symlink selections", { timeout: 30_000 }, async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-recovery-fallback-"));
    const outsideA = path.join(root, "outside-a");
    const outsideB = path.join(root, "outside-b");
    const ancestor = path.join(root, "selected ancestor '$(touch ANCESTOR_PWNED)'");
    const rejectedName = "rejected render '$(touch SELECTED_PWNED)' ; echo";
    const rejectedSelectedPath = path.join(ancestor, rejectedName);
    const outsideMarkerA = path.join(outsideA, "marker.txt");
    const outsideMarkerB = path.join(outsideB, "marker.txt");
    await mkdir(outsideA);
    await mkdir(outsideB);
    await writeFile(outsideMarkerA, "outside-a-unchanged\n", "utf8");
    await writeFile(outsideMarkerB, "outside-b-unchanged\n", "utf8");
    await chmod(outsideA, 0o750);
    await chmod(outsideB, 0o750);
    await symlink(outsideA, ancestor);

    const actualTransport = path.join(outsideA, "transport");
    const actualRequests = path.join(actualTransport, "requests");
    const actualResults = path.join(actualTransport, "results");
    await mkdir(actualTransport);
    await mkdir(actualRequests);
    await mkdir(actualResults);
    await chmod(actualTransport, 0o700);
    await chmod(actualRequests, 0o500);
    await chmod(actualResults, 0o700);
    const selectedTransport = path.join(ancestor, "transport");
    const renderProbeRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-recovery-probe-"));
    const transportEnv = runtimeEnv(selectedTransport, renderProbeRoot);
    const transportReadiness = await composeAlpha3_2B3RuntimeDoctorReadiness({
      env: transportEnv,
      liveBridge: createLiveBridgeExecutorFromEnv(transportEnv),
    });
    assert.equal(transportReadiness.bridge.status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);
    assert.equal(transportReadiness.bridge.diagnosis, "transport_permission_error");
    assert.equal(transportReadiness.bridge.permission_repair, "manual_required");

    const transportTask = createAlpha3_2B3DoctorTaskResult({
      mode: "live-edit",
      runtimeReadiness: transportReadiness,
      requestResponse: { status: "not_run", ready: false },
      reaperProcess: { status: "running", running: true },
      transportDir: selectedTransport,
    });
    assert.equal(transportTask.safe_copy_paste_fix, null);
    assert.deepEqual(transportTask.restart_required, { mcp_client: false, reaper: false });
    assert.match(transportTask.next_action.instruction, /without following links/);
    assert.equal(await permissionMode(actualTransport), 0o700);
    assert.equal(await permissionMode(actualRequests), 0o500);
    assert.equal(await permissionMode(actualResults), 0o700);

    const fakeStart = path.join(root, "fake start '$(touch START_PWNED)' ; runner");
    const startRecord = path.join(root, "start-record.jsonl");
    await writeFile(fakeStart, `#!/usr/bin/env node\nconst f=require("node:fs");const r=process.env.OPENREAPER_B3_FAKE_START_RECORD;if(typeof r!=="string"||r==="")process.exit(2);f.appendFileSync(r,JSON.stringify(process.argv.slice(2))+"\\n");\n`, "utf8");
    await chmod(fakeStart, 0o700);

    const readyRuntime = {
      mcp_reachability: { status: "reachable" },
      bridge: { status: LIVE_BRIDGE_LIVENESS_STATUS.READY, diagnosis: "bridge_ready", ready: true },
      render_root: { status: "render_root_missing", ready: false },
    };
    const renderRecovery = createAlpha3_2B3DoctorTaskResult({
      mode: "render",
      runtimeReadiness: readyRuntime,
      requestResponse: { status: "ready", ready: true },
      reaperProcess: { status: "running", running: true },
      renderInspection: {
        status: "render_root_missing",
        ready: false,
        path: rejectedSelectedPath,
      },
      startCommand: fakeStart,
    });
    assert.equal(typeof renderRecovery.safe_copy_paste_fix, "string");
    assert.equal(renderRecovery.safe_copy_paste_fix.includes(rejectedSelectedPath), false);
    assert.equal(renderRecovery.safe_copy_paste_fix.includes(ancestor), false);
    assert.equal(renderRecovery.safe_copy_paste_fix.includes("mkdirSync"), false);
    assert.equal(renderRecovery.safe_copy_paste_fix.includes("fchmodSync"), false);
    assert.match(renderRecovery.safe_copy_paste_fix, /mkdtempSync/);
    assert.match(renderRecovery.safe_copy_paste_fix, /realpathSync/);
    assert.match(renderRecovery.safe_copy_paste_fix, /--render-root "\$ROOT"/);
    assert.equal(Buffer.byteLength(renderRecovery.safe_copy_paste_fix, "utf8") <= 6_144, true);
    assert.deepEqual(renderRecovery.restart_required, { mcp_client: true, reaper: true });
    assert.match(renderRecovery.next_action.instruction, /start a new OpenReaper session/);
    assert.match(renderRecovery.next_action.instruction, /does not repair the original selected path/);

    const commandEnv = {
      ...process.env,
      OPENREAPER_B3_FAKE_START_RECORD: startRecord,
    };
    const firstRun = await runCopyPasteFix(renderRecovery.safe_copy_paste_fix, {
      cwd: root,
      env: commandEnv,
    });
    assert.equal(firstRun.code, 0);
    assert.equal(firstRun.stdout, "");
    assert.equal(firstRun.stderr, "");

    let stop = false;
    let swaps = 0;
    const swapper = (async () => {
      while (!stop) {
        await rm(ancestor, { force: true });
        await symlink(outsideA, ancestor);
        await new Promise((resolve) => setImmediate(resolve));
        await rm(ancestor, { force: true });
        await symlink(outsideB, ancestor);
        swaps += 1;
        await new Promise((resolve) => setImmediate(resolve));
      }
    })();
    try {
      for (let index = 0; index < 12; index += 1) {
        const result = await runCopyPasteFix(renderRecovery.safe_copy_paste_fix, {
          cwd: root,
          env: commandEnv,
        });
        assert.equal(result.code, 0);
        assert.equal(result.stdout, "");
        assert.equal(result.stderr, "");
      }
    } finally {
      stop = true;
      await swapper;
    }
    assert.ok(swaps > 0);

    const records = (await readFile(startRecord, "utf8")).trim().split("\n").map(JSON.parse);
    assert.equal(records.length, 13);
    const canonicalTemp = await realpath(os.tmpdir());
    const recoveryRoots = [];
    for (const argv of records) {
      assert.equal(argv.length, 2);
      assert.equal(argv[0], "--render-root");
      const recoveryRoot = argv[1];
      recoveryRoots.push(recoveryRoot);
      assert.equal(path.dirname(recoveryRoot), canonicalTemp);
      assert.match(path.basename(recoveryRoot), /^openreaper-render-recovery-[A-Za-z0-9]+$/);
      const entry = await lstat(recoveryRoot);
      assert.equal(entry.isSymbolicLink(), false);
      assert.equal(entry.isDirectory(), true);
      await access(recoveryRoot, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
    }
    assert.equal(new Set(recoveryRoots).size, recoveryRoots.length);

    assert.equal(await pathExists(path.join(outsideA, rejectedName)), false);
    assert.equal(await pathExists(path.join(outsideB, rejectedName)), false);
    assert.equal(await readFile(outsideMarkerA, "utf8"), "outside-a-unchanged\n");
    assert.equal(await readFile(outsideMarkerB, "utf8"), "outside-b-unchanged\n");
    assert.equal(await permissionMode(outsideA), 0o750);
    assert.equal(await permissionMode(outsideB), 0o750);
    assert.equal(await pathExists(path.join(root, "ANCESTOR_PWNED")), false);
    assert.equal(await pathExists(path.join(root, "SELECTED_PWNED")), false);
    assert.equal(await pathExists(path.join(root, "START_PWNED")), false);

    for (const recoveryRoot of recoveryRoots) {
      await rm(recoveryRoot, { recursive: true, force: true });
    }
    await rm(renderProbeRoot, { recursive: true, force: true });
  });
  it("accepts only exact doctor task modes and bounded wait syntax", () => {
    assert.deepEqual(ALPHA3_2B3_DOCTOR_TASK_MODES, [
      "live-edit",
      "render",
      "media-import",
      "project-query",
    ]);
    assert.deepEqual(parseAlpha3_2B3DoctorArgs([]), {
      ok: true,
      mode: null,
      wait_bridge_seconds: null,
    });
    assert.deepEqual(parseAlpha3_2B3DoctorArgs(["--for", "render", "--wait-bridge=5"]), {
      ok: true,
      mode: "render",
      wait_bridge_seconds: 5,
    });
    assert.deepEqual(parseAlpha3_2B3DoctorArgs(["--wait-bridge"]), {
      ok: true,
      mode: null,
      wait_bridge_seconds: 10,
    });
    for (const invalid of [
      ["--for"],
      ["--for", "mix"],
      ["--wait-bridge=0"],
      ["--wait-bridge=61"],
      ["--wait-bridge", "5"],
      ["--unknown"],
    ]) {
      const result = parseAlpha3_2B3DoctorArgs(invalid);
      assert.equal(result.ok, false, invalid.join(" "));
      assert.equal(result.exit_code, 2, invalid.join(" "));
    }
  });

  it("keeps packaged Doctor smoke aligned with the current macro surface and returns bounded failure detail", async () => {
    const doctorSource = await readFile(path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-doctor.sh"), "utf8");
    const packageCommandSmoke = doctorSource.slice(
      doctorSource.indexOf("async function smokeOpenReaperMcpCommandInner()"),
      doctorSource.indexOf("async function smokeVitalAgentMcpInner()"),
    );
    assert.match(doctorSource, /const requiredMacros = \["macro\.project\.inspect", "macro\.project\.query"\];/);
    assert.doesNotMatch(doctorSource, /const requiredMacros = \[[^\]]*macro\.index_status/);
    assert.doesNotMatch(doctorSource, /const requiredMacros = \[[^\]]*macro\.query_tracks/);
    assert.match(doctorSource, /projectAlpha3_2_5BProjectQueryDoctorTask/);
    assert.match(doctorSource, /projectIndexReadiness: report\.project_index_readiness/);
    assert.match(doctorSource, /OPENREAPER_LIVE_SMOKE_RENDER_ROOT: effectiveRenderRoot/);
    assert.match(doctorSource, /report\.project_index = report\.smoke\?\.openreaper\?\.project_index\s+\?\? null/);
    assert.match(packageCommandSmoke, /createPackageCommandValidationRuntime\(\)/);
    assert.match(packageCommandSmoke, /try \{[\s\S]*command: mcpCommand,[\s\S]*env: validationRuntime\.env,[\s\S]*assertExactArray\(toolNames, exactTools/);
    assert.doesNotMatch(packageCommandSmoke, /path\.join\(installRoot, "session", "renders"\)/);
    assert.match(packageCommandSmoke, /validation_scope: "isolated_package_runtime"/);
    assert.match(packageCommandSmoke, /await lifecycle\?\.close\("normal_finish"\);\s+\} finally \{\s+await validationRuntime\.cleanup\(\)/);
    assert.match(packageCommandSmoke, /mkdtemp\(path\.join\(os\.tmpdir\(\), "openreaper-doctor-package-"\)\)/);
    for (const variable of [
      "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
      "OPENREAPER_ARTIFACT_ROOT",
      "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT",
      "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
      "OPENREAPER_PROJECT_INDEX_STATE_ROOT",
      "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
    ]) {
      assert.match(packageCommandSmoke, new RegExp(`${variable}:`), `${variable} is not isolated`);
    }
    assert.match(packageCommandSmoke, /delete env\.OPENREAPER_CURRENT_PROJECT_PATH/);
    assert.match(packageCommandSmoke, /chmod\(root, 0o700\)/);
    assert.match(packageCommandSmoke, /rm\(root, \{ recursive: true, force: true \}\)/);
    assert.match(doctorSource, /error_message: boundedErrorMessage\(error\)/);
    assert.match(doctorSource, /function boundedErrorMessage\(error\)/);
  });

  it("treats host-exported empty optional OpenReaper values as absent without discarding non-empty overrides", { timeout: 30_000 }, async () => {
    const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-doctor-empty-env-"));
    const installRoot = path.join(fixtureRoot, "installed");
    const binRoot = path.join(installRoot, "bin");
    const fakeBin = path.join(fixtureRoot, "fake-bin");
    const doctorPath = path.join(binRoot, "openreaper-doctor");
    const fakeNode = path.join(fakeBin, "node");
    await Promise.all([mkdir(binRoot, { recursive: true }), mkdir(fakeBin, { recursive: true })]);
    await copyFile(
      path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-doctor.sh"),
      doctorPath,
    );
    await chmod(doctorPath, 0o755);
    const canonicalInstallRoot = await realpath(installRoot);
    await writeFile(fakeNode, `#!/bin/zsh
for key in OPENREAPER_SESSION_ROOT OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR OPENREAPER_ARTIFACT_ROOT OPENREAPER_LIVE_SMOKE_RENDER_ROOT OPENREAPER_LIVE_BRIDGE_OWNER OPENREAPER_LIVE_BRIDGE_GENERATION OPENREAPER_CURRENT_PROJECT_PATH OPENREAPER_CURRENT_PROJECT_REF OPENREAPER_PROJECT_INDEX_STATE_ROOT OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY OPENREAPER_DOCTOR_INSTALL_ROOT OPENREAPER_DOCTOR_SESSION_ROOT OPENREAPER_DOCTOR_TRANSPORT_DIR OPENREAPER_DOCTOR_ARTIFACT_ROOT; do
  if (( \${+parameters[\${key}]} )); then
    print -r -- "\${key}=\${(P)key}"
  else
    print -r -- "\${key}=<unset>"
  fi
done
`, "utf8");
    await chmod(fakeNode, 0o755);

    try {
      const emptyPollution = Object.fromEntries([
        "OPENREAPER_SESSION_ROOT",
        "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
        "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
        "OPENREAPER_ARTIFACT_ROOT",
        "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT",
        "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
        "OPENREAPER_LIVE_BRIDGE_OWNER",
        "OPENREAPER_LIVE_BRIDGE_GENERATION",
        "OPENREAPER_LIVE_BRIDGE_SESSION_ID",
        "OPENREAPER_PROJECT_INDEX_STATE_ROOT",
        "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
        "OPENREAPER_CURRENT_PROJECT_PATH",
        "OPENREAPER_CURRENT_PROJECT_REF",
        "OPENREAPER_MCP_PACKAGE_ROOT",
        "OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS",
        "OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS",
      ].map((key) => [key, ""]));
      const emptyRun = await runCopyPasteFix(doctorPath, {
        env: {
          ...process.env,
          ...emptyPollution,
          PATH: `${fakeBin}:/usr/bin:/bin`,
        },
      });
      assert.equal(emptyRun.code, 0, emptyRun.stderr);
      const emptyCaptured = Object.fromEntries(emptyRun.stdout.trim().split("\n").map((line) => line.split(/=(.*)/su).slice(0, 2)));
      assert.equal(emptyCaptured.OPENREAPER_SESSION_ROOT, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_LIVE_SMOKE_RENDER_ROOT, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_LIVE_BRIDGE_OWNER, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_LIVE_BRIDGE_GENERATION, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_CURRENT_PROJECT_PATH, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_CURRENT_PROJECT_REF, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_PROJECT_INDEX_STATE_ROOT, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY, "<unset>");
      assert.equal(emptyCaptured.OPENREAPER_DOCTOR_INSTALL_ROOT, canonicalInstallRoot);
      assert.equal(emptyCaptured.OPENREAPER_DOCTOR_SESSION_ROOT, path.join(canonicalInstallRoot, "session"));
      assert.equal(emptyCaptured.OPENREAPER_DOCTOR_TRANSPORT_DIR, path.join(canonicalInstallRoot, "session", "transport"));
      assert.equal(emptyCaptured.OPENREAPER_DOCTOR_ARTIFACT_ROOT, path.join(canonicalInstallRoot, "session", "artifacts"));

      const explicitSession = path.join(fixtureRoot, "explicit-session");
      const explicitRender = path.join(fixtureRoot, "explicit-renders");
      const explicitRun = await runCopyPasteFix(doctorPath, {
        env: {
          ...process.env,
          ...emptyPollution,
          PATH: `${fakeBin}:/usr/bin:/bin`,
          OPENREAPER_SESSION_ROOT: explicitSession,
          OPENREAPER_LIVE_SMOKE_RENDER_ROOT: explicitRender,
          OPENREAPER_LIVE_BRIDGE_OWNER: "explicit-owner",
          OPENREAPER_LIVE_BRIDGE_GENERATION: "invalid-nonempty",
        },
      });
      assert.equal(explicitRun.code, 0, explicitRun.stderr);
      const explicitCaptured = Object.fromEntries(explicitRun.stdout.trim().split("\n").map((line) => line.split(/=(.*)/su).slice(0, 2)));
      assert.equal(explicitCaptured.OPENREAPER_SESSION_ROOT, explicitSession);
      assert.equal(explicitCaptured.OPENREAPER_LIVE_SMOKE_RENDER_ROOT, explicitRender);
      assert.equal(explicitCaptured.OPENREAPER_LIVE_BRIDGE_OWNER, "explicit-owner");
      assert.equal(explicitCaptured.OPENREAPER_LIVE_BRIDGE_GENERATION, "invalid-nonempty");
      assert.equal(explicitCaptured.OPENREAPER_DOCTOR_SESSION_ROOT, explicitSession);
    } finally {
      await rm(fixtureRoot, { recursive: true, force: true });
    }
  });

  it("publishes bounded readiness through actual stdio ping without dispatch or a sixth tool", { timeout: 30_000 }, async () => {
    const fixture = await makeTransportFixture();
    const renderRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-stdio-render-"));
    await writeHeartbeat(fixture.root);
    const env = sanitizedEnv(runtimeEnv(fixture.root, renderRoot));
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: REPO_ROOT,
      env,
      stderr: "pipe",
    });
    const client = new Client({ name: "alpha3-2b3-stdio", version: "1.0.0" }, { capabilities: {} });
    try {
      await client.connect(transport);
      const tools = await client.listTools();
      assert.deepEqual(tools.tools.map((tool) => tool.name).sort(), [...EXPECTED_TOOLS].sort());
      assert.equal(tools.tools.length, 6);
      const ping = parseToolJson(await client.callTool({ name: "ping", arguments: {} }));
      assert.equal(ping.ok, true);
      assert.equal(ping.runtime_readiness.contract, ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT);
      assert.equal(ping.runtime_readiness.mcp_reachability.status, "reachable");
      assert.equal(ping.runtime_readiness.bridge.status, "bridge_ready");
      assert.equal(ping.runtime_readiness.render_root.status, "render_root_ready");
      assert.equal(ping.runtime_readiness.request_response.status, "not_run");
      assert.equal(ping.live_bridge.status, "bridge_ready");
      assert.deepEqual(await readdir(fixture.requests), []);
      const serialized = JSON.stringify(ping.runtime_readiness);
      assert.equal(serialized.includes(fixture.root), false);
      assert.equal(serialized.includes(renderRoot), false);
    } finally {
      await client.close();
    }
    assert.deepEqual(await readdir(fixture.requests), []);
  });
});

async function makeTransportFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-b3-transport-"));
  const requests = path.join(root, "requests");
  const results = path.join(root, "results");
  await mkdir(requests);
  await mkdir(results);
  return { root, requests, results };
}

async function writeHeartbeat(root, options = {}) {
  const mtime = options.mtime ?? new Date();
  const heartbeat = {
    contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
    active_owner: options.owner ?? "openreaper-alpha",
    active_generation: options.generation ?? 1,
    sequence: 1,
    refreshed_at_unix_s: Math.floor(mtime.getTime() / 1_000),
    interval_ms: 500,
  };
  const heartbeatPath = path.join(root, LIVE_BRIDGE_HEARTBEAT_FILENAME);
  await rm(heartbeatPath, { recursive: true, force: true });
  await writeFile(heartbeatPath, `${JSON.stringify(heartbeat)}\n`, "utf8");
  await utimes(heartbeatPath, mtime, mtime);
  return heartbeatPath;
}

function sanitizedEnv(additions = {}) {
  const env = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (typeof value !== "string") continue;
    if (key.startsWith("OPENREAPER_LIVE_")) continue;
    if (key.startsWith("OPENREAPER_BRIDGE_")) continue;
    if (key === "OPENREAPER_ARTIFACT_ROOT") continue;
    env[key] = value;
  }
  return { ...env, ...additions };
}

function parseToolJson(result) {
  const text = result.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

function makeIdentityHelperRunner({ pid, executable, startMs, state = "S", lsofOutput }) {
  const launchText = formatPsLaunchTime(startMs);
  const defaultLsof = `p${pid}\nftxt\nn${executable}\nftxt\nn/usr/lib/dyld\n`;
  return async ({ command, args, maxBytes, timeoutMs }) => {
    assert.equal(maxBytes, 16_384);
    assert.equal(timeoutMs, 2_000);
    if (command === "/bin/ps") {
      assert.deepEqual(args, [
        "-p",
        String(pid),
        "-o",
        "pid=",
        "-o",
        "state=",
        "-o",
        "ucomm=",
        "-o",
        "lstart=",
      ]);
      return { ok: true, stdout: ` ${pid} ${state} REAPER ${launchText}\n` };
    }
    if (command === "/usr/sbin/lsof") {
      assert.deepEqual(args, ["-a", "-p", String(pid), "-d", "txt", "-Fn"]);
      return { ok: true, stdout: lsofOutput ?? defaultLsof };
    }
    if (command === "/usr/bin/codesign") {
      assert.deepEqual(args.slice(0, 3), [
        "-v",
        "--strict",
        '--test-requirement==identifier "com.cockos.reaper" and anchor apple generic and certificate leaf[subject.OU] = "Y3T58622SG"',
      ]);
      assert.equal(path.isAbsolute(args[3]), true);
      assert.equal(path.basename(args[3]), path.basename(executable));
      return { ok: true, stdout: "" };
    }
    return { ok: false, failure: "unavailable", stdout: "" };
  };
}

function formatPsLaunchTime(value) {
  const date = new Date(value);
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const time = [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":");
  return `${weekdays[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()} ${time} ${date.getFullYear()}`;
}

async function runCopyPasteFix(command, options = {}) {
  assert.equal(typeof command, "string");
  const child = spawn("/bin/zsh", ["-c", command], {
    cwd: options.cwd,
    env: options.env ?? process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  const stdoutChunks = [];
  const stderrChunks = [];
  child.stdout.on("data", (chunk) => stdoutChunks.push(chunk));
  child.stderr.on("data", (chunk) => stderrChunks.push(chunk));
  const [code, signal] = await once(child, "exit");
  const stdout = Buffer.concat(stdoutChunks).toString("utf8");
  const stderr = Buffer.concat(stderrChunks).toString("utf8");
  assert.equal(Buffer.byteLength(stdout, "utf8") <= 4_096, true);
  assert.equal(Buffer.byteLength(stderr, "utf8") <= 4_096, true);
  return { code, signal, stdout, stderr };
}

async function permissionMode(value) {
  return (await lstat(value)).mode & 0o777;
}

async function pathExists(value) {
  try {
    await lstat(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function exists(value) {
  try {
    await readdir(value);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}
