import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { link, mkdir, mkdtemp, readFile, readdir, rm, symlink, utimes, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import { buildTemplateBridgeRequest } from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createTemplateCatalogWave1aTemplates } from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_HEARTBEAT_FILENAME,
  LIVE_BRIDGE_EXECUTOR_ENV,
  LIVE_BRIDGE_LIVENESS_CONTRACT,
  LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS,
  LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT,
  LIVE_BRIDGE_LIVENESS_STATUS,
  createLiveBridgeExecutor,
  createLiveBridgeExecutorFromEnv,
  probeLiveBridgeLiveness,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

describe("Layer 4D.1 live bridge executor binding", () => {
  it("keeps the live bridge executor explicitly configured and non-spawning", () => {
    const config = createLiveBridgeExecutorFromEnv({});
    assert.equal(config.configured, false);
    assert.equal(config.reason, "live_bridge_executor_not_configured");
    assert.equal(config.spawned_reaper, false);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS, [
      "template.project.read_summary",
      "template.transport.read_state",
      "template.core.read_openreaper_status",
      "template.system.read_runtime_environment",
      "template.system.read_resource_paths",
    ]);
  });

  it("allows live executor dispatch only for Wave 0 canary ids", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
    });

    const allowed = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      refs: [],
      context: context(),
    });
    assert.equal(allowed.ok, true);
    assert.equal(allowed.request.bridge.expected_owner, "owner-test");
    assert.equal(allowed.bridge.owner, "owner-test");
    assert.equal(bridge.seen.length, 1);

    const rejected = await runtime.call_template({
      id: "template.project.read_metadata",
      input: {},
      refs: [],
      context: context(),
    });
    assert.equal(rejected.contract, CALL_TEMPLATE_RUNTIME_CONTRACT);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.source, "runtime");
    assert.equal(rejected.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED");
    assert.equal(bridge.seen.length, 1);

    const evidence = runtime.evidence();
    assert.equal(evidence.length, 2);
    assert.equal(evidence[0].bridge.expected_owner, "owner-test");
    assert.equal(evidence[0].bridge.owner, "owner-test");
    assert.equal(evidence[0].live.opted_in, true);
    assert.equal(evidence[0].live.spawned_reaper, false);
    assert.deepEqual(evidence[0].live.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS);
  });

  it("reports a specific blocker when configured transport is absent", async () => {
    const root = await mkdtemp(join(tmpdir(), "openreaper-live-absent-"));
    const missingTransport = join(root, "missing-transport");
    const configured = createLiveBridgeExecutorFromEnv({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: missingTransport,
    });
    assert.equal(configured.configured, true);
    assert.equal(configured.spawned_reaper, false);

    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: configured.executor,
        executor_config: configured.config,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      },
    });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      refs: [],
      context: context(),
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.source, "bridge");
    assert.equal(response.error.code, "BRIDGE_NOT_RUNNING");
    assert.equal(response.error.details.blocker, "live_bridge_transport_absent");
    assert.equal(response.error.details.spawned_reaper, false);
    assert.equal(response.request.id.startsWith("cmd_"), true);
  });

  it("reports bridge script absence and handshake failure without raw execution paths", async () => {
    const transport = await makeTransport();
    const scriptMissingExecutor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath: join(transport.root, "missing-openreaper-live-bridge.lua"),
      timeoutMs: 20,
      pollIntervalMs: 1,
    });
    const scriptMissing = await dispatchOne(scriptMissingExecutor);
    assert.equal(scriptMissing.error.code, "BRIDGE_NOT_RUNNING");
    assert.equal(scriptMissing.error.details.blocker, "reaper_bridge_script_absent");

    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    const timeoutExecutor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath,
      timeoutMs: 20,
      pollIntervalMs: 1,
    });
    const timeoutStartedAt = Date.now();
    const timeout = await timeoutExecutor.dispatch(idempotentProjectRequest({
      id: "cmd_handshake_timeout",
      idempotencyKey: "handshake-timeout",
      name: "Handshake Timeout",
      timeoutMs: 300_000,
    }));
    assert.equal(timeout.error.code, "BRIDGE_TIMEOUT");
    assert.equal(timeout.error.details.blocker, "live_bridge_handshake_failed");
    assert.equal(timeout.error.details.timeout_ms, 20);
    assert.equal(Date.now() - timeoutStartedAt < 500, true);
    assert.equal((await readdir(join(transport.root, "requests"))).length, 1);
    const [writtenRequestPath] = await readdir(join(transport.root, "requests"));
    const writtenRequest = JSON.parse(await readFile(join(transport.root, "requests", writtenRequestPath), "utf8"));
    assert.equal(writtenRequest.timeout_ms, 300_000);
  });

  it("uses the descriptor timeout as the live transport wait budget", async () => {
    const transport = await makeTransport();
    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 1,
    });
    const executor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath,
      pollIntervalMs: 1,
    });
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor,
        executor_config: executor.config,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D30_PROJECT_CONTAINER_TEMPLATE_IDS,
      },
    });

    const responsePromise = runtime.call_template({
      id: "template.project.create_subproject",
      input: { name: "Timeout Propagation", activate: true, inherit_time_selection: false },
      refs: [],
      context: context(),
      idempotency_key: "timeout-propagation",
    });
    const requestPath = await waitForSingleRequest(transport.root);
    const request = JSON.parse(await readFile(requestPath, "utf8"));
    assert.equal(request.timeout_ms, 300_000);

    await delay(20);
    const bridge = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
    const result = bridge.okEnvelope(request, request.created_at, {
      summary: { created: true },
    });
    await writeFile(join(transport.root, "results", `${request.id}.json`), `${JSON.stringify(result)}\n`);

    const response = await responsePromise;
    assert.equal(response.ok, true);
    assert.equal(response.request.timeout_ms, 300_000);
    assert.equal((await readdir(join(transport.root, "requests"))).length, 1);
  });

  it("preserves a valid bridge child error instead of reporting the bridge as unavailable", async () => {
    const transport = await makeTransport();
    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 1,
    });
    const executor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath,
      timeoutMs: 250,
      pollIntervalMs: 1,
    });
    const request = idempotentProjectRequest({
      id: "cmd_valid_child_error",
      idempotencyKey: "valid-child-error",
      name: "Valid Child Error",
      timeoutMs: 250,
    });

    const responsePromise = executor.dispatch(request);
    await waitForSingleRequest(transport.root);
    const bridge = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
    const result = bridge.errorEnvelope(request, "FILE_NOT_FOUND", "Source media is unavailable.", {
      recoverable: false,
      details: { blocker: "source_file_create_failed" },
    });
    await writeFile(join(transport.root, "results", `${request.id}.json`), `${JSON.stringify(result)}\n`);

    const response = await responsePromise;
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "FILE_NOT_FOUND");
    assert.equal(response.error.message, "Source media is unavailable.");
    assert.equal(response.error.details.blocker, "source_file_create_failed");
  });

  it("rejects a bridge result whose id does not match the dispatched request", async () => {
    await assertRejectsBridgeResultIdentityMismatch({
      mutateResult(result) {
        result.id = "cmd_wrong_result_id";
      },
      messagePattern: /result id does not match the dispatched request/u,
    });
  });

  it("rejects a bridge result whose owner does not match the dispatched request", async () => {
    await assertRejectsBridgeResultIdentityMismatch({
      mutateResult(result) {
        result.bridge.owner = "owner-stale";
      },
      messagePattern: /result owner does not match the dispatched request/u,
    });
  });

  it("rejects a bridge result whose generation does not match the dispatched request", async () => {
    await assertRejectsBridgeResultIdentityMismatch({
      mutateResult(result) {
        result.bridge.generation = 2;
      },
      messagePattern: /result generation does not match the dispatched request/u,
    });
  });

  it("caps a ready bridge at an explicitly configured executor timeout", async () => {
    const transport = await makeTransport();
    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 1,
    });
    const executor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath,
      timeoutMs: 5,
      pollIntervalMs: 1,
    });
    const request = idempotentProjectRequest({
      id: "cmd_explicit_timeout_cap",
      idempotencyKey: "explicit-timeout-cap",
      name: "Explicit Timeout Cap",
      timeoutMs: 300_000,
    });

    const startedAt = Date.now();
    const response = await executor.dispatch(request);
    assert.equal(response.error.code, "BRIDGE_TIMEOUT");
    assert.equal(response.error.details.timeout_ms, 5);
    assert.equal(Date.now() - startedAt < 250, true);
    const writtenRequest = JSON.parse(await readFile(
      join(transport.root, "requests", `${request.id}.json`),
      "utf8",
    ));
    assert.equal(writtenRequest.timeout_ms, 300_000);
  });

  it("does not turn a blank environment timeout into an explicit cap", async () => {
    const transport = await makeTransport();
    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    const now = new Date("2026-07-17T12:00:00.000Z");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 1,
      mtime: now,
    });
    const configured = createLiveBridgeExecutorFromEnv({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transport.root,
      [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: bridgeScriptPath,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "   ",
    }, {
      pollIntervalMs: 1,
      now: () => now,
    });
    const request = idempotentProjectRequest({
      id: "cmd_blank_env_timeout",
      idempotencyKey: "blank-env-timeout",
      name: "Blank Environment Timeout",
      timeoutMs: 300_000,
    });

    const originalDateNow = Date.now;
    let monotonicMs = 0;
    Date.now = () => {
      monotonicMs += 10_000;
      return monotonicMs;
    };
    try {
      const response = await configured.executor.dispatch(request);
      assert.equal(response.error.code, "BRIDGE_TIMEOUT");
      assert.equal(response.error.details.timeout_ms, 300_000);
    } finally {
      Date.now = originalDateNow;
    }
  });

  it("recovers a late idempotent result without dispatching a duplicate mutation", async () => {
    const transport = await makeTransport();
    const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
    await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 1,
    });
    const executor = createLiveBridgeExecutor({
      transportDir: transport.root,
      bridgeScriptPath,
      timeoutMs: 5,
      pollIntervalMs: 1,
    });
    const firstRequest = idempotentProjectRequest({
      id: "cmd_timeout_first",
      idempotencyKey: "late-result-recovery",
      name: "Late Result",
      timeoutMs: 10,
    });

    const timedOut = await executor.dispatch(firstRequest);
    assert.equal(timedOut.error.code, "BRIDGE_TIMEOUT");
    assert.equal(timedOut.error.details.outcome, "unknown");
    assert.equal(timedOut.error.details.retry_policy, "retry_only_with_same_idempotency_key");

    const bridge = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
    const lateResult = bridge.okEnvelope(firstRequest, firstRequest.created_at, {
      summary: { created: true },
    });
    await writeFile(join(transport.root, "results", `${firstRequest.id}.json`), `${JSON.stringify(lateResult)}\n`);

    const retryRequest = idempotentProjectRequest({
      id: "cmd_timeout_retry",
      idempotencyKey: "late-result-recovery",
      name: "Late Result",
      timeoutMs: 50,
    });
    const replay = await executor.dispatch(retryRequest);
    assert.equal(replay.ok, true);
    assert.equal(replay.id, retryRequest.id);
    assert.equal(replay.queue.state, "replayed");
    assert.deepEqual(replay.idempotency, { key: "late-result-recovery", replayed: true });
    assert.deepEqual(await readdir(join(transport.root, "requests")), [`${firstRequest.id}.json`]);

    const conflict = await executor.dispatch(idempotentProjectRequest({
      id: "cmd_timeout_conflict",
      idempotencyKey: "late-result-recovery",
      name: "Different Mutation",
      timeoutMs: 50,
    }));
    assert.equal(conflict.error.code, "IDEMPOTENCY_CONFLICT");
    assert.equal(conflict.error.recoverable, false);
    assert.deepEqual(await readdir(join(transport.root, "requests")), [`${firstRequest.id}.json`]);
  });

  it("probes basic liveness states without dispatching and recursively freezes results", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const expected = {
      expectedOwner: "owner-test",
      expectedGeneration: 3,
      maxAgeMs: 2_000,
      now: () => now,
    };

    const configAbsent = await probeLiveBridgeLiveness(expected);
    assert.equal(configAbsent.contract, LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT);
    assert.equal(configAbsent.status, LIVE_BRIDGE_LIVENESS_STATUS.CONFIG_ABSENT);
    assert.equal(configAbsent.ready, false);
    assert.equal(configAbsent.configured, false);
    assert.equal(configAbsent.spawned_reaper, false);

    const absentRoot = await mkdtemp(join(tmpdir(), "openreaper-liveness-absent-root-"));
    const transportAbsent = await probeLiveBridgeLiveness({
      ...expected,
      transportDir: join(absentRoot, "missing"),
    });
    assert.equal(transportAbsent.status, LIVE_BRIDGE_LIVENESS_STATUS.TRANSPORT_ABSENT);
    assert.equal(transportAbsent.details.missing, "transport_dir");

    const transport = await makeTransport();
    const actionNotRunning = await probeLiveBridgeLiveness({
      ...expected,
      transportDir: transport.root,
    });
    assert.equal(actionNotRunning.status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);
    assert.equal(actionNotRunning.heartbeat.filename, LIVE_BRIDGE_HEARTBEAT_FILENAME);
    assert.deepEqual(await readdir(join(transport.root, "requests")), []);

    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 3,
      mtime: new Date(now.getTime() - 500),
    });
    const executor = createLiveBridgeExecutor({
      transportDir: transport.root,
      heartbeatMaxAgeMs: 2_000,
      now: () => now,
    });
    const readyWithoutExpectedIdentity = await executor.probeLiveness();
    assert.equal(readyWithoutExpectedIdentity.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    assert.equal(readyWithoutExpectedIdentity.expected.owner_provided, false);
    assert.equal(readyWithoutExpectedIdentity.expected.generation_provided, false);

    const ready = await executor.probeLiveness({
      expectedOwner: "owner-test",
      expectedGeneration: 3,
    });
    assert.equal(ready.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    assert.equal(ready.ready, true);
    assert.equal(ready.heartbeat.observed.contract, LIVE_BRIDGE_LIVENESS_CONTRACT);
    assert.equal(ready.heartbeat.observed.age_ms, 500);
    assert.deepEqual(await readdir(join(transport.root, "requests")), []);
    for (const nested of [
      ready,
      ready.heartbeat,
      ready.heartbeat.observed,
      ready.expected,
      ready.details,
    ]) {
      assert.equal(Object.isFrozen(nested), true);
    }
  });

  it("opens only the fixed heartbeat entry with nofollow and rejects links and non-regular files", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    const heartbeatPath = join(transport.root, LIVE_BRIDGE_HEARTBEAT_FILENAME);
    const externalRoot = await mkdtemp(join(tmpdir(), "openreaper-liveness-external-"));
    const externalPath = await writeHeartbeat(externalRoot, { mtime: now });

    await symlink(externalPath, heartbeatPath);
    const symlinkResult = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
    });
    assert.equal(symlinkResult.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(symlinkResult.details.reason, "heartbeat_open_failed");
    assert.equal(symlinkResult.heartbeat.observed, null);
    assert.equal(JSON.stringify(symlinkResult).includes(externalPath), false);

    await rm(heartbeatPath, { force: true });
    await link(externalPath, heartbeatPath);
    const hardlinkResult = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
    });
    assert.equal(hardlinkResult.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(hardlinkResult.details.reason, "heartbeat_link_count_invalid");

    await rm(heartbeatPath, { force: true });
    await mkdir(heartbeatPath);
    const directoryResult = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
    });
    assert.equal(directoryResult.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(directoryResult.details.reason, "heartbeat_not_regular_file");

    await rm(heartbeatPath, { recursive: true, force: true });
    execFileSync("mkfifo", [heartbeatPath]);
    const fifoResult = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
    });
    assert.equal(fifoResult.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(fifoResult.details.reason, "heartbeat_not_regular_file");
    await rm(heartbeatPath, { force: true });

    const socketTransportRoot = await mkdtemp("/tmp/orls-");
    await mkdir(join(socketTransportRoot, "requests"));
    await mkdir(join(socketTransportRoot, "results"));
    const socketHeartbeatPath = join(socketTransportRoot, LIVE_BRIDGE_HEARTBEAT_FILENAME);
    const socketServer = createServer();
    await new Promise((resolveListen, rejectListen) => {
      socketServer.once("error", rejectListen);
      socketServer.listen(socketHeartbeatPath, resolveListen);
    });
    try {
      const socketResult = await probeLiveBridgeLiveness({
        transportDir: socketTransportRoot,
        now: () => now,
      });
      assert.equal(socketResult.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
      assert.equal(socketResult.details.reason, "heartbeat_open_failed");
      assert.equal(JSON.stringify(socketResult).length < 4_096, true);
    } finally {
      await new Promise((resolveClose) => socketServer.close(resolveClose));
      await rm(socketTransportRoot, { recursive: true, force: true });
    }
  });

  it("enforces initial and actual heartbeat byte budgets from one closed FileHandle", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    const heartbeatPath = join(transport.root, LIVE_BRIDGE_HEARTBEAT_FILENAME);

    await writeFile(heartbeatPath, "");
    const empty = await probeLiveBridgeLiveness({ transportDir: transport.root, now: () => now });
    assert.equal(empty.details.reason, "heartbeat_size_invalid");
    assert.equal(empty.details.heartbeat_bytes, 0);

    await writeFile(heartbeatPath, "x".repeat(2_048));
    await utimes(heartbeatPath, now, now);
    const exactBudget = await probeLiveBridgeLiveness({ transportDir: transport.root, now: () => now });
    assert.equal(exactBudget.details.reason, "heartbeat_json_invalid");

    await writeFile(heartbeatPath, "x".repeat(2_049));
    const maxPlusOne = await probeLiveBridgeLiveness({ transportDir: transport.root, now: () => now });
    assert.equal(maxPlusOne.details.reason, "heartbeat_size_invalid");
    assert.equal(maxPlusOne.details.heartbeat_bytes, 2_049);

    await writeFile(heartbeatPath, "x".repeat(4_096));
    const oversize = await probeLiveBridgeLiveness({ transportDir: transport.root, now: () => now });
    assert.equal(oversize.details.reason, "heartbeat_size_invalid");
    assert.equal(oversize.details.heartbeat_bytes, 4_096);

    let openedPath = null;
    let openedFlags = null;
    let closed = false;
    let readCount = 0;
    const boundedStat = fakeFileStat({ size: 2_048, mtimeMs: now.getTime() });
    const raced = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
      __openHeartbeatFileForTest: async (path, flags) => {
        openedPath = path;
        openedFlags = flags;
        return {
          stat: async () => boundedStat,
          read: async (buffer) => {
            readCount += 1;
            buffer.fill(0x78);
            return { bytesRead: buffer.length };
          },
          close: async () => {
            closed = true;
          },
        };
      },
    });
    assert.equal(raced.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(raced.details.reason, "heartbeat_size_invalid");
    assert.equal(raced.details.heartbeat_bytes, 2_049);
    assert.equal(openedPath, heartbeatPath);
    assert.equal((openedFlags & fsConstants.O_NOFOLLOW) !== 0, true);
    assert.equal((openedFlags & fsConstants.O_NONBLOCK) !== 0, true);
    assert.equal(readCount, 1);
    assert.equal(closed, true);

    let statCount = 0;
    let changedReadCount = 0;
    let changedHandleClosed = false;
    const changedDuringRead = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => now,
      __openHeartbeatFileForTest: async () => ({
        stat: async () => {
          statCount += 1;
          return fakeFileStat({
            size: 2,
            mtimeMs: now.getTime() + (statCount === 1 ? 0 : 1),
          });
        },
        read: async (buffer) => {
          changedReadCount += 1;
          if (changedReadCount > 1) return { bytesRead: 0 };
          buffer.write("{}", 0, "utf8");
          return { bytesRead: 2 };
        },
        close: async () => {
          changedHandleClosed = true;
        },
      }),
    });
    assert.equal(changedDuringRead.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(changedDuringRead.details.reason, "heartbeat_changed_during_read");
    assert.equal(statCount, 2);
    assert.equal(changedHandleClosed, true);
  });

  it("uses exact max-age boundaries and rejects clearly future filesystem or heartbeat times", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    const base = {
      transportDir: transport.root,
      maxAgeMs: 2_000,
      now: () => now,
    };

    await writeHeartbeat(transport.root, { mtime: new Date(now.getTime() - 2_000) });
    const exactThreshold = await probeLiveBridgeLiveness(base);
    assert.equal(exactThreshold.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    assert.equal(exactThreshold.heartbeat.observed.age_ms, 2_000);

    await writeHeartbeat(transport.root, { mtime: new Date(now.getTime() - 2_001) });
    const thresholdPlusOne = await probeLiveBridgeLiveness(base);
    assert.equal(thresholdPlusOne.status, LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE);
    assert.equal(thresholdPlusOne.heartbeat.observed.age_ms, 2_001);

    await writeHeartbeat(transport.root, {
      mtime: new Date(now.getTime() + Math.floor(LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS / 2)),
    });
    const slightFutureSkew = await probeLiveBridgeLiveness(base);
    assert.equal(slightFutureSkew.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    assert.equal(slightFutureSkew.heartbeat.observed.age_ms, 0);

    await writeHeartbeat(transport.root, {
      mtime: new Date(now.getTime() + LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS + 1_000),
    });
    const futureMtime = await probeLiveBridgeLiveness(base);
    assert.equal(futureMtime.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(futureMtime.details.reason, "heartbeat_mtime_in_future");

    await writeHeartbeat(transport.root, {
      mtime: now,
      refreshed_at_unix_s: Math.floor(
        (now.getTime() + LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS + 1_000) / 1_000,
      ),
    });
    const futureHeartbeatTime = await probeLiveBridgeLiveness(base);
    assert.equal(futureHeartbeatTime.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(futureHeartbeatTime.details.reason, "heartbeat_time_in_future");

    await writeHeartbeat(transport.root, {
      mtime: new Date(now.getTime() - 5_000),
      refreshed_at_unix_s: Math.floor(now.getTime() / 1_000),
    });
    const timeAfterMtime = await probeLiveBridgeLiveness(base);
    assert.equal(timeAfterMtime.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID);
    assert.equal(timeAfterMtime.details.reason, "heartbeat_time_after_file_mtime");
  });

  it("validates every heartbeat field type, boundary, and exact field set", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    const probe = () => probeLiveBridgeLiveness({ transportDir: transport.root, now: () => now });

    for (const valid of [
      {
        active_owner: "a",
        active_generation: 0,
        sequence: 1,
        refreshed_at_unix_s: 0,
        interval_ms: 50,
      },
      {
        active_owner: "o".repeat(256),
        active_generation: Number.MAX_SAFE_INTEGER,
        sequence: 999_999_999,
        refreshed_at_unix_s: Math.floor(now.getTime() / 1_000),
        interval_ms: 5_000,
      },
    ]) {
      await writeHeartbeat(transport.root, { ...valid, mtime: now });
      assert.equal((await probe()).status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
    }

    const invalidCases = [
      ["heartbeat_contract_invalid", { contract: "wrong.contract" }],
      ["heartbeat_owner_invalid", { active_owner: "" }],
      ["heartbeat_owner_invalid", { active_owner: "x".repeat(257) }],
      ["heartbeat_owner_invalid", { active_owner: "owner\ncontrol" }],
      ["heartbeat_owner_invalid", { active_owner: 3 }],
      ["heartbeat_generation_invalid", { active_generation: -1 }],
      ["heartbeat_generation_invalid", { active_generation: 3.5 }],
      ["heartbeat_generation_invalid", { active_generation: "3" }],
      ["heartbeat_generation_invalid", { active_generation: Number.MAX_SAFE_INTEGER + 1 }],
      ["heartbeat_sequence_invalid", { sequence: 0 }],
      ["heartbeat_sequence_invalid", { sequence: 1_000_000_000 }],
      ["heartbeat_sequence_invalid", { sequence: "1" }],
      ["heartbeat_time_invalid", { refreshed_at_unix_s: -1 }],
      ["heartbeat_time_invalid", { refreshed_at_unix_s: "1" }],
      ["heartbeat_time_invalid", { refreshed_at_unix_s: Math.floor(Number.MAX_SAFE_INTEGER / 1_000) + 1 }],
      ["heartbeat_interval_invalid", { interval_ms: 49 }],
      ["heartbeat_interval_invalid", { interval_ms: 5_001 }],
      ["heartbeat_interval_invalid", { interval_ms: "500" }],
      ["heartbeat_fields_invalid", { extra: { payload: "forbidden" } }],
      ["heartbeat_fields_invalid", { contract: undefined }],
    ];
    for (const [reason, overrides] of invalidCases) {
      await writeHeartbeat(transport.root, { ...overrides, mtime: now });
      const result = await probe();
      assert.equal(result.status, LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID, reason);
      assert.equal(result.details.reason, reason);
    }
  });

  it("rejects explicitly invalid expected identities without echoing unbounded input", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    await writeHeartbeat(transport.root, { mtime: now });
    const base = { transportDir: transport.root, now: () => now };

    for (const expectedOwner of [
      "",
      "owner\ncontrol",
      "x".repeat(257),
      "x".repeat(100_000),
      3,
      null,
      undefined,
    ]) {
      const result = await probeLiveBridgeLiveness({ ...base, expectedOwner });
      assert.equal(result.status, LIVE_BRIDGE_LIVENESS_STATUS.PROBE_INPUT_INVALID);
      assert.equal(result.ready, false);
      assert.deepEqual(result.details.invalid_fields, ["expected_owner"]);
      assert.equal(result.expected.owner, null);
      assert.equal(result.expected.owner_provided, true);
      assert.equal(JSON.stringify(result).length < 4_096, true);
    }

    for (const expectedGeneration of ["3", -1, 3.5, Number.MAX_SAFE_INTEGER + 1, null, undefined]) {
      const result = await probeLiveBridgeLiveness({ ...base, expectedGeneration });
      assert.equal(result.status, LIVE_BRIDGE_LIVENESS_STATUS.PROBE_INPUT_INVALID);
      assert.deepEqual(result.details.invalid_fields, ["expected_generation"]);
      assert.equal(result.expected.generation, null);
      assert.equal(result.expected.generation_provided, true);
    }

    const bothInvalid = await probeLiveBridgeLiveness({
      ...base,
      expectedOwner: "x".repeat(100_000),
      expectedGeneration: "3",
    });
    assert.deepEqual(bothInvalid.details.invalid_fields, ["expected_owner", "expected_generation"]);
    assert.equal(JSON.stringify(bothInvalid).includes("x".repeat(1_000)), false);

    await writeHeartbeat(transport.root, {
      active_owner: "o".repeat(256),
      active_generation: Number.MAX_SAFE_INTEGER,
      mtime: now,
    });
    const validBoundaries = await probeLiveBridgeLiveness({
      ...base,
      expectedOwner: "o".repeat(256),
      expectedGeneration: Number.MAX_SAFE_INTEGER,
    });
    assert.equal(validBoundaries.status, LIVE_BRIDGE_LIVENESS_STATUS.READY);
  });

  it("keeps stale and owner mismatch precedence deterministic", async () => {
    const now = new Date("2026-07-10T12:00:10.000Z");
    const transport = await makeTransport();
    const expected = {
      transportDir: transport.root,
      expectedOwner: "owner-test",
      expectedGeneration: 3,
      maxAgeMs: 2_000,
      now: () => now,
    };

    await writeHeartbeat(transport.root, {
      active_owner: "other-owner",
      active_generation: 4,
      mtime: new Date(now.getTime() - 5_000),
    });
    assert.equal(
      (await probeLiveBridgeLiveness(expected)).status,
      LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE,
    );

    await writeHeartbeat(transport.root, {
      active_owner: "other-owner",
      active_generation: 4,
      mtime: new Date(now.getTime() - 500),
    });
    assert.equal(
      (await probeLiveBridgeLiveness(expected)).status,
      LIVE_BRIDGE_LIVENESS_STATUS.OWNER_MISMATCH,
    );

    await writeHeartbeat(transport.root, {
      active_owner: "owner-test",
      active_generation: 4,
      mtime: new Date(now.getTime() - 500),
    });
    assert.equal(
      (await probeLiveBridgeLiveness(expected)).status,
      LIVE_BRIDGE_LIVENESS_STATUS.GENERATION_MISMATCH,
    );
  });

  it("contains throwing or invalid injected clocks without throwing the probe", async () => {
    const transport = await makeTransport();
    const throwingNow = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => {
        throw new Error("clock failed");
      },
    });
    assert.equal(throwingNow.status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);

    const invalidNow = await probeLiveBridgeLiveness({
      transportDir: transport.root,
      now: () => new Date("invalid"),
    });
    assert.equal(invalidNow.status, LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING);
  });

  it("live smoke script skips by default and stays on the Wave 1A read-handler allowlist", async () => {
    const skipped = JSON.parse(
      execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
        env: {
          ...process.env,
          OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
          [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        },
      }).trim(),
    );
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.spawned_reaper, false);
    assert.equal(skipped.wave, "wave1a-read-handlers");
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);

    const noExecutor = runLiveSmokeExpectingFailure({
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.deepEqual(noExecutor.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);

    const configuredMissing = runLiveSmokeExpectingFailure({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(await mkdtemp(join(tmpdir(), "openreaper-live-script-")), "missing"),
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "20",
    });
    assert.equal(configuredMissing.reason, "live_bridge_transport_absent");
    assert.equal(configuredMissing.attempted_template_ids.length, 9);
    assert.deepEqual(configuredMissing.attempted_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal(configuredMissing.accepted_catalog.size, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length);
    assert.equal(configuredMissing.executions.length, 9);
    assert.equal(configuredMissing.spawned_reaper, false);
  });
});

async function dispatchOne(executor) {
  const runtime = createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor,
      executor_config: executor.config,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
    },
  });
  return runtime.call_template({
    id: "template.project.read_summary",
    input: {},
    refs: [],
    context: context(),
  });
}

async function makeTransport() {
  const root = await mkdtemp(join(tmpdir(), "openreaper-live-transport-"));
  await mkdir(join(root, "requests"));
  await mkdir(join(root, "results"));
  return { root };
}

async function waitForSingleRequest(root) {
  const deadline = Date.now() + 1_000;
  while (Date.now() <= deadline) {
    const filenames = await readdir(join(root, "requests"));
    if (filenames.length === 1) return join(root, "requests", filenames[0]);
    await delay(2);
  }
  throw new Error("Timed out waiting for one live bridge request fixture.");
}

function idempotentProjectRequest({ id, idempotencyKey, name, timeoutMs }) {
  const descriptor = createTemplateCatalogWave1aTemplates()
    .find((entry) => entry.id === "template.project.create_subproject");
  const request = buildTemplateBridgeRequest({
    descriptor,
    input: { name, activate: true, inherit_time_selection: false },
    refs: [],
    context: context(),
    idempotencyKey,
    requestId: id,
  });
  return {
    ...request,
    timeout_ms: timeoutMs,
  };
}

async function assertRejectsBridgeResultIdentityMismatch({ mutateResult, messagePattern }) {
  const transport = await makeTransport();
  const bridgeScriptPath = join(transport.root, "openreaper-live-bridge.lua");
  await writeFile(bridgeScriptPath, "-- minimal test fixture; not a runtime\n");
  await writeHeartbeat(transport.root, {
    active_owner: "owner-test",
    active_generation: 1,
  });
  const executor = createLiveBridgeExecutor({
    transportDir: transport.root,
    bridgeScriptPath,
    timeoutMs: 250,
    pollIntervalMs: 1,
  });
  const request = idempotentProjectRequest({
    id: "cmd_result_identity_check",
    idempotencyKey: "result-identity-check",
    name: "Result Identity Check",
    timeoutMs: 250,
  });

  const responsePromise = executor.dispatch(request);
  await waitForSingleRequest(transport.root);
  const bridge = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
  const result = structuredClone(bridge.okEnvelope(request, request.created_at, {
    summary: { created: true },
  }));
  mutateResult(result);
  await writeFile(join(transport.root, "results", `${request.id}.json`), `${JSON.stringify(result)}\n`);

  const response = await responsePromise;
  assert.equal(response.ok, false);
  assert.equal(response.error.details.blocker, "live_bridge_result_invalid");
  assert.match(response.error.details.message, messagePattern);
}

function delay(ms) {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms));
}

async function writeHeartbeat(root, overrides = {}) {
  const { mtime = new Date(), extra = {}, ...heartbeatOverrides } = overrides;
  const path = join(root, LIVE_BRIDGE_HEARTBEAT_FILENAME);
  const heartbeat = {
    contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
    active_owner: "owner-test",
    active_generation: 3,
    sequence: 1,
    refreshed_at_unix_s: Math.floor(mtime.getTime() / 1_000),
    interval_ms: 500,
    ...heartbeatOverrides,
    ...extra,
  };
  await rm(path, { recursive: true, force: true });
  await writeFile(path, `${JSON.stringify(heartbeat)}\n`);
  await utimes(path, mtime, mtime);
  return path;
}

function fakeFileStat({ size, mtimeMs }) {
  return {
    dev: 1,
    ino: 1,
    size,
    nlink: 1,
    mtimeMs,
    ctimeMs: mtimeMs,
    isFile: () => true,
  };
}

function runLiveSmokeExpectingFailure(env) {
  try {
    execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", "--live"], {
      cwd: new URL("../..", import.meta.url),
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected live smoke script to exit with status 2.");
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
