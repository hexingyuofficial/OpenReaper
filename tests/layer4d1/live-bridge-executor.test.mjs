import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CONTRACT,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutor,
  createLiveBridgeExecutorFromEnv,
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
    const timeout = await dispatchOne(timeoutExecutor);
    assert.equal(timeout.error.source, "bridge");
    assert.equal(timeout.error.code, "BRIDGE_TIMEOUT");
    assert.equal(timeout.error.details.blocker, "live_bridge_handshake_failed");
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
