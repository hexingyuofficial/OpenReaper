import assert from "node:assert/strict";
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start.sh");
const BRIDGE_LAUNCHER_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start-mcp-bridge.lua");

it("reuses a verified healthy PID, isolates the Doctor from caller cwd, and truthfully blocks a stale Bridge", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-b-recovery-"));
  const packageRoot = path.join(root, "OpenReaper-alpha");
  const startPath = path.join(packageRoot, "bin", "openreaper-start");
  const readinessPath = path.join(packageRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "alpha3-2b3-runtime-doctor-readiness-v1.mjs");
  const doctorPath = path.join(packageRoot, "bin", "openreaper-doctor");
  const doctorCwdMarker = path.join(root, "doctor-cwd.marker");
  const doctorTimeoutMarker = path.join(root, "doctor-timeout.marker");
  const doctorAttemptMarker = path.join(root, "doctor-attempt.marker");
  const budgetDoctorMarker = path.join(root, "budget-doctor.marker");
  const hangingDoctorPidMarker = path.join(root, "hanging-doctor.pid");
  const callerRoot = path.join(root, "caller-with-invalid-package-scope");
  const fakeReaper = path.join(root, "fake-reaper");
  const launchMarker = path.join(root, "duplicate-launch.marker");
  const sessionRoot = path.join(root, "session");
  const renderRoot = path.join(root, "renders");
  const pidFile = path.join(sessionRoot, "reaper.pid");
  const transportRoot = path.join(sessionRoot, "transport");
  const parentPid = String(process.pid);

  try {
    await mkdir(path.dirname(startPath), { recursive: true });
    await mkdir(path.dirname(readinessPath), { recursive: true });
    await mkdir(path.dirname(doctorPath), { recursive: true });
    await mkdir(callerRoot, { recursive: true });
    await mkdir(transportRoot, { recursive: true });
    await mkdir(renderRoot, { recursive: true });
    await writeFile(startPath, (await readFile(START_SOURCE, "utf8"))
      .replace(
        /run_startup_dialog_observer\(\) \{[\s\S]*?\n\}\n\nstartup_dialog_result_is_safe\(\) \{/u,
        "run_startup_dialog_observer() {\n  echo \"no_safe_dialog\"\n}\n\nstartup_dialog_result_is_safe() {",
      ),
      "utf8");
    await copyFile(BRIDGE_LAUNCHER_SOURCE, path.join(packageRoot, "bin", "openreaper-start-mcp-bridge.lua"));
    await chmod(startPath, 0o755);
    await writeFile(doctorPath, `#!/bin/zsh
expected_root=${JSON.stringify(packageRoot)}
if [[ "\${PWD:A}" != "\${expected_root:A}" ]]; then
  print -ru2 -- "Doctor inherited caller cwd: \${PWD}"
  exit 91
fi
print -r -- "\${PWD}" > ${JSON.stringify(doctorCwdMarker)}
print -r -- "\${OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS}:\${OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS}" > ${JSON.stringify(doctorTimeoutMarker)}
probe_delay_ms=3250
if [[ "\${OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS}" != "15000" || "\${OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS}" != "22000" ]] \
    || (( OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS <= probe_delay_ms )); then
  exit 92
fi
sleep 3.25
exit 0
`, "utf8");
    await chmod(doctorPath, 0o755);
    await writeFile(path.join(callerRoot, "package.json"), "{ invalid package scope\n", "utf8");
    await writeFile(fakeReaper, `#!/bin/zsh\nprint -r -- launched > ${JSON.stringify(launchMarker)}\n`, "utf8");
    await chmod(fakeReaper, 0o755);
    await writeFile(readinessPath, `import { readFile } from "node:fs/promises";
export async function inspectAlpha3_2B3ReaperProcess({ sessionRoot }) {
  const pid = Number((await readFile(${JSON.stringify(pidFile)}, "utf8")).trim());
  return { status: "running", running: true, pid, identity_verified: true };
}
`, "utf8");
    await writeFile(pidFile, `${parentPid}\n`, "utf8");
    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000),
      sequence: 1,
    }), "utf8");
    const pidRecordBeforeRecovery = await stat(pidFile);

    const startArgs = [
      "--reaper-binary", fakeReaper,
      "--session-root", sessionRoot,
      "--render-root", renderRoot,
      "--recover-existing",
    ];
    // Keep the healthy-Bridge fixture fresh across slow CI/macOS process setup.
    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000),
      sequence: 1,
    }), "utf8");
    const healthyStartedAt = Date.now();
    const result = await execFileAsync(startPath, startArgs, {
      cwd: callerRoot,
      env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "1", OPENREAPER_TEST_PARENT_PID: parentPid },
      timeout: 10_000,
      maxBuffer: 1_048_576,
    });

    assert.match(result.stdout, /startup-mode=recover_existing/u);
    assert.match(result.stdout, new RegExp(`existing-session=reaper_pid=${parentPid};identity=verified`, "u"));
    assert.match(result.stdout, /startup-status=ready/u);
    assert.equal(Date.now() - healthyStartedAt >= 3_250, true);
    assert.equal(Date.now() - healthyStartedAt < 10_000, true);
    assert.equal((await readFile(doctorCwdMarker, "utf8")).trim(), await realpath(packageRoot));
    assert.equal((await readFile(doctorTimeoutMarker, "utf8")).trim(), "15000:22000");
    await assert.rejects(readFile(launchMarker), { code: "ENOENT" });
    assert.equal((await readFile(pidFile, "utf8")).trim(), parentPid);
    const pidRecordAfterRecovery = await stat(pidFile);
    assert.equal(pidRecordAfterRecovery.mtimeMs, pidRecordBeforeRecovery.mtimeMs);
    assert.equal(pidRecordAfterRecovery.ctimeMs, pidRecordBeforeRecovery.ctimeMs);

    await writeFile(doctorPath, `#!/bin/zsh
print -r -- "\${OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS}:\${OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS}" > ${JSON.stringify(doctorTimeoutMarker)}
if (( OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS < 250 \
    || OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS < 1000 \
    || OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS >= 15000 \
    || OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS >= 22000 )); then
  exit 92
fi
exit 0
`, "utf8");
    await chmod(doctorPath, 0o755);
    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000) - 60,
      sequence: 2,
    }), "utf8");
    const delayedHealthyHeartbeat = new Promise((resolve, reject) => {
      setTimeout(() => {
        writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
          contract: "openreaper.bridge_liveness.v1",
          active_owner: "openreaper-alpha",
          active_generation: 1,
          interval_ms: 500,
          refreshed_at_unix_s: Math.floor(Date.now() / 1000),
          sequence: 3,
        }), "utf8").then(resolve, reject);
      }, 2_000);
    });
    const reducedBudgetStartedAt = Date.now();
    const reducedBudgetResult = await execFileAsync(startPath, startArgs, {
      cwd: callerRoot,
      env: {
        ...process.env,
        OPENREAPER_START_WAIT_SECONDS: "10",
        OPENREAPER_STARTUP_BUDGET_MS: "10000",
        OPENREAPER_TEST_PARENT_PID: parentPid,
      },
      timeout: 10_000,
      maxBuffer: 1_048_576,
    });
    await delayedHealthyHeartbeat;
    assert.match(reducedBudgetResult.stdout, /startup-status=ready/u);
    const [reducedReadMs, reducedSmokeMs] = (await readFile(doctorTimeoutMarker, "utf8"))
      .trim()
      .split(":")
      .map(Number);
    assert.equal(reducedReadMs >= 250 && reducedReadMs < 15_000, true);
    assert.equal(reducedSmokeMs >= 1_000 && reducedSmokeMs < 22_000, true);
    assert.equal(reducedSmokeMs - reducedReadMs, 1_000);
    assert.equal(Date.now() - reducedBudgetStartedAt < 10_000, true);

    await rm(doctorAttemptMarker, { force: true });
    await writeFile(doctorPath, `#!/bin/zsh
typeset -i attempts=0
if [[ -f ${JSON.stringify(doctorAttemptMarker)} ]]; then
  attempts="$(<${JSON.stringify(doctorAttemptMarker)})"
fi
print -r -- "$(( attempts + 1 ))" > ${JSON.stringify(doctorAttemptMarker)}
print -ru2 -- "MCP_READ_PROBE_IDENTITY_MISMATCH"
exit 93
`, "utf8");
    await chmod(doctorPath, 0o755);
    await assert.rejects(
      execFileAsync(startPath, startArgs, {
        cwd: callerRoot,
        env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "10", OPENREAPER_TEST_PARENT_PID: parentPid },
        timeout: 10_000,
        maxBuffer: 1_048_576,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /public read probe failed/u);
        return true;
      },
    );
    assert.equal((await readFile(doctorAttemptMarker, "utf8")).trim(), "1");

    await rm(budgetDoctorMarker, { force: true });
    await writeFile(doctorPath, `#!/bin/zsh
print -r -- called > ${JSON.stringify(budgetDoctorMarker)}
exit 0
`, "utf8");
    await chmod(doctorPath, 0o755);
    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000) - 60,
      sequence: 4,
    }), "utf8");
    const nearBoundaryHeartbeat = new Promise((resolve, reject) => {
      setTimeout(() => {
        writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
          contract: "openreaper.bridge_liveness.v1",
          active_owner: "openreaper-alpha",
          active_generation: 1,
          interval_ms: 500,
          refreshed_at_unix_s: Math.floor(Date.now() / 1000),
          sequence: 5,
        }), "utf8").then(resolve, reject);
      }, 1_000);
    });
    const exhaustedBudgetStartedAt = Date.now();
    await assert.rejects(
      execFileAsync(startPath, startArgs, {
        cwd: callerRoot,
        env: {
          ...process.env,
          OPENREAPER_START_WAIT_SECONDS: "10",
          OPENREAPER_STARTUP_BUDGET_MS: "8000",
          OPENREAPER_TEST_PARENT_PID: parentPid,
        },
        timeout: 10_000,
        maxBuffer: 1_048_576,
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /startup-status=blocked_startup_budget_exhausted/u);
        assert.match(error.stderr, /blocker-code=STARTUP_BUDGET_EXHAUSTED/u);
        assert.match(
          error.stderr,
          /startup-budget-stage=(?:bridge_readiness_dialog_inspection|public_bridge_read)/u,
        );
        return true;
      },
    );
    await nearBoundaryHeartbeat;
    assert.equal(Date.now() - exhaustedBudgetStartedAt < 8_000, true);
    await assert.rejects(readFile(budgetDoctorMarker), { code: "ENOENT" });

    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000),
      sequence: 6,
    }), "utf8");
    await writeFile(doctorPath, `#!/bin/zsh
trap '' TERM
print -r -- "$$" > ${JSON.stringify(hangingDoctorPidMarker)}
sleep 60
`, "utf8");
    await chmod(doctorPath, 0o755);
    const hangingDoctorStartedAt = Date.now();
    await assert.rejects(
      execFileAsync(startPath, startArgs, {
        cwd: callerRoot,
        env: {
          ...process.env,
          OPENREAPER_START_WAIT_SECONDS: "10",
          OPENREAPER_STARTUP_BUDGET_MS: "8000",
          OPENREAPER_TEST_PARENT_PID: parentPid,
        },
        timeout: 10_000,
        maxBuffer: 1_048_576,
      }),
      (error) => {
        assert.equal(error.code, 124);
        assert.match(error.stderr, /startup-status=blocked_startup_budget_exhausted/u);
        assert.match(error.stderr, /blocker-code=STARTUP_BUDGET_EXHAUSTED/u);
        assert.match(error.stderr, /startup-budget-stage=supervisor_deadline/u);
        return true;
      },
    );
    assert.equal(Date.now() - hangingDoctorStartedAt < 9_000, true);
    const hangingDoctorPid = Number((await readFile(hangingDoctorPidMarker, "utf8")).trim());
    assert.equal(Number.isSafeInteger(hangingDoctorPid), true);
    assert.throws(() => process.kill(hangingDoctorPid, 0), { code: "ESRCH" });

    await writeFile(path.join(transportRoot, "openreaper-bridge-liveness-v1.json"), JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-alpha",
      active_generation: 1,
      interval_ms: 500,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000) - 60,
      sequence: 2,
    }), "utf8");
    await assert.rejects(
      execFileAsync(startPath, startArgs, {
        cwd: callerRoot,
        env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "1", OPENREAPER_TEST_PARENT_PID: parentPid },
        timeout: 10_000,
        maxBuffer: 1_048_576,
      }),
      (error) => {
        assert.equal(error.code, 4);
        assert.match(error.stderr, /startup-status=blocked_same_instance_bridge_not_ready/u);
        assert.match(error.stderr, /blocker-code=SAME_INSTANCE_BRIDGE_ACTION_REQUIRED/u);
        assert.match(error.stderr, /cannot restart its stopped Bridge externally/u);
        return true;
      },
    );
    await assert.rejects(readFile(launchMarker), { code: "ENOENT" });

    await assert.rejects(
      execFileAsync(startPath, startArgs.filter((arg) => arg !== "--recover-existing"), {
        cwd: callerRoot,
        env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "1", OPENREAPER_TEST_PARENT_PID: parentPid },
        timeout: 10_000,
        maxBuffer: 1_048_576,
      }),
      (error) => {
        assert.equal(error.code, 3);
        assert.match(error.stdout, /startup-status=existing_session/u);
        assert.match(error.stderr, /no duplicate REAPER will be started/u);
        return true;
      },
    );
    await assert.rejects(readFile(launchMarker), { code: "ENOENT" });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("reaps a newly launched REAPER after an early public-read failure in direct and LaunchServices modes", async () => {
  for (const mode of ["launchservices", "direct"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `openreaper-alpha4-b-${mode}-cleanup-`));
    const packageRoot = path.join(root, "OpenReaper-alpha");
    const startPath = path.join(packageRoot, "bin", "openreaper-start");
    const doctorPath = path.join(packageRoot, "bin", "openreaper-doctor");
    const launcherPath = path.join(packageRoot, "bin", "openreaper-start-mcp-bridge.lua");
    const sessionRoot = path.join(root, "session");
    const renderRoot = path.join(root, "renders");
    const pidMarker = path.join(root, "fresh-reaper.pid");
    const identityRetryMarker = path.join(root, "identity-retry.marker");
    const hangingDoctorPidMarker = path.join(root, "hanging-doctor.pid");
    const staggeredPidMarker = path.join(root, "staggered-reaper.pids");
    const launchServicesHelperPidMarker = path.join(root, "hanging-launchservices.pid");
    const launchctlMutationCountPath = path.join(root, "launchctl-mutation-count.txt");
    const launchctlStatePath = path.join(root, "launchctl-state.json");
    const launchservicesLockPath = path.join(packageRoot, "session", ".openreaper-launchservices-env.lock");
    const launchctlBaseline = { OPENREAPER_LIVE_BRIDGE_OWNER: "user-owned-owner" };
    const fakeApp = path.join(root, "FakeREAPER.app");
    const fakeReaper = mode === "launchservices"
      ? path.join(fakeApp, "Contents", "MacOS", "REAPER")
      : path.join(root, "fake-reaper");
    const fakeLaunchctl = path.join(root, "fake-launchctl");
    const fakeLaunchServices = path.join(root, "fake-launchservices");
    let launchedPid = null;
    let identityRetryPid = null;
    let hangingDoctorPid = null;
    let hangingReaperPid = null;
    let hangingLaunchServicesReaperPid = null;
    let launchServicesHelperPid = null;
    let preAtomicLaunchServicesReaperPid = null;
    let preAtomicLaunchServicesHelperPid = null;
    let preexistingPid = null;
    let staggeredPids = [];

    try {
      await mkdir(path.dirname(startPath), { recursive: true });
      await mkdir(path.dirname(fakeReaper), { recursive: true });
      await mkdir(sessionRoot, { recursive: true });
      await mkdir(renderRoot, { recursive: true });
      await writeFile(launchctlStatePath, JSON.stringify(launchctlBaseline), "utf8");
      let startSource = (await readFile(START_SOURCE, "utf8"))
        // The fake launchctl pays Node startup cost; only its cleanup copy gets
        // a wider bound than the product's native /bin/launchctl cleanup.
        .replace("STARTUP_LAUNCHCTL_CLEANUP_TIMEOUT_MS=300", "STARTUP_LAUNCHCTL_CLEANUP_TIMEOUT_MS=1000")
        .replace(
          /run_startup_dialog_observer\(\) \{[\s\S]*?\n\}\n\nstartup_dialog_result_is_safe\(\) \{/u,
          "run_startup_dialog_observer() {\n  echo \"no_safe_dialog\"\n}\n\nstartup_dialog_result_is_safe() {",
        )
        .replace(
          'capture_startup_reaper_identity() {\n  local candidate_pid="$1"',
          `capture_startup_reaper_identity() {
  if [[ "\${OPENREAPER_B_FORCE_FIRST_IDENTITY_FAILURE:-}" == "1" && ! -f ${JSON.stringify(identityRetryMarker)} ]]; then
    print -rn -- forced > ${JSON.stringify(identityRetryMarker)}
    return 1
  fi
  local candidate_pid="$1"`,
        );
      if (mode === "launchservices") {
        startSource = startSource
          .replace('LAUNCHCTL_BIN="/bin/launchctl"', `LAUNCHCTL_BIN=${JSON.stringify(fakeLaunchctl)}`)
          .replace('LAUNCHSERVICES_BIN="/usr/bin/osascript"', `LAUNCHSERVICES_BIN=${JSON.stringify(fakeLaunchServices)}`);
      }
      await writeFile(startPath, startSource, "utf8");
      await copyFile(BRIDGE_LAUNCHER_SOURCE, launcherPath);
      await writeFile(doctorPath, "#!/bin/zsh\nprint -ru2 -- MCP_READ_PROBE_IDENTITY_MISMATCH\nexit 93\n", "utf8");
      await writeFile(fakeReaper, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
if (process.env.OPENREAPER_B_PREEXISTING === "1" || process.env.OPENREAPER_B_WRONG_CANDIDATE === "1") {
  process.on("SIGTERM", () => {});
  setInterval(() => {}, 1000);
} else {
  const transport = process.env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR;
  fs.writeFileSync(${JSON.stringify(pidMarker)}, String(process.pid));
  fs.mkdirSync(transport, { recursive: true });
  fs.writeFileSync(path.join(transport, "openreaper-startup-status-v1.json"), JSON.stringify({ contract: "openreaper.startup_status.v1", stage: "bridge_dofile_succeeded" }));
  fs.writeFileSync(path.join(transport, "openreaper-bridge-liveness-v1.json"), JSON.stringify({ contract: "openreaper.bridge_liveness.v1", active_owner: process.env.OPENREAPER_LIVE_BRIDGE_OWNER, active_generation: Number(process.env.OPENREAPER_LIVE_BRIDGE_GENERATION), interval_ms: 500, refreshed_at_unix_s: Math.floor(Date.now() / 1000), sequence: 1 }));
}
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`, "utf8");
      await writeFile(fakeLaunchctl, `#!/usr/bin/env node
const fs = require("node:fs");
const statePath = ${JSON.stringify(launchctlStatePath)};
const mutationCountPath = ${JSON.stringify(launchctlMutationCountPath)};
const state = JSON.parse(fs.readFileSync(statePath, "utf8"));
const command = process.argv[2];
const key = process.argv[3];
if (command === "getenv") {
  if (!Object.hasOwn(state, key)) process.exit(1);
  process.stdout.write(state[key]);
  process.exit(0);
}
if (command === "setenv") state[key] = process.argv[4];
else if (command === "unsetenv") delete state[key];
else process.exit(2);
fs.writeFileSync(statePath, JSON.stringify(state));
const hangAfter = Number(process.env.OPENREAPER_B_LAUNCHCTL_HANG_AFTER_MUTATIONS || 0);
if (Number.isSafeInteger(hangAfter) && hangAfter > 0) {
  let mutationCount = 0;
  try { mutationCount = Number(fs.readFileSync(mutationCountPath, "utf8")); } catch {}
  mutationCount += 1;
  fs.writeFileSync(mutationCountPath, String(mutationCount));
  if (mutationCount >= hangAfter) {
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
  }
}
`, "utf8");
      await writeFile(fakeLaunchServices, `#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { spawn } = require("node:child_process");
const args = process.argv.slice(2);
const app = args[3];
const pidHandoff = args[4];
const reaper = path.join(app, "Contents", "MacOS", "REAPER");
const reaperArgs = args.slice(5);
(async () => {
  let wrong = null;
  if (process.env.OPENREAPER_B_STAGGERED_LAUNCH === "1") {
    wrong = spawn(reaper, reaperArgs, {
      detached: true,
      stdio: "ignore",
      env: {
        ...process.env,
        OPENREAPER_B_WRONG_CANDIDATE: "1",
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: ${JSON.stringify(path.join(root, "wrong-transport"))},
      },
    });
    wrong.unref();
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  const intended = spawn(reaper, reaperArgs, { detached: true, stdio: "ignore", env: process.env });
  intended.unref();
  if (wrong !== null) fs.writeFileSync(${JSON.stringify(staggeredPidMarker)}, String(wrong.pid) + "\\n" + intended.pid);
  fs.writeSync(1, String(intended.pid) + "\\n");
  if (process.env.OPENREAPER_B_HANG_BEFORE_ATOMIC_PID_HANDOFF === "1") {
    fs.writeFileSync(${JSON.stringify(launchServicesHelperPidMarker)}, String(process.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    return;
  }
  fs.writeFileSync(pidHandoff, String(intended.pid) + "\\n", { mode: 0o600 });
  if (process.env.OPENREAPER_B_HANG_AFTER_PID_HANDOFF === "1") {
    fs.writeFileSync(${JSON.stringify(launchServicesHelperPidMarker)}, String(process.pid));
    process.on("SIGTERM", () => {});
    setInterval(() => {}, 1000);
    return;
  }
})().catch((error) => {
  process.stderr.write(String(error?.stack ?? error) + "\\n");
  process.exitCode = 1;
});
`, "utf8");
      await Promise.all([startPath, doctorPath, fakeReaper, fakeLaunchctl, fakeLaunchServices].map((file) => chmod(file, 0o755)));

      const preexisting = spawn(fakeReaper, ["-newinst", "-nosplash", launcherPath], {
        detached: true,
        stdio: "ignore",
        env: { ...process.env, OPENREAPER_B_PREEXISTING: "1" },
      });
      preexistingPid = preexisting.pid;
      preexisting.unref();
      await new Promise((resolve) => setTimeout(resolve, 100));
      assert.doesNotThrow(() => process.kill(preexistingPid, 0));

      const args = mode === "launchservices"
        ? ["--reaper-app", fakeApp]
        : ["--direct-binary", "--reaper-binary", fakeReaper];
      args.push("--session-root", sessionRoot, "--render-root", renderRoot);
      await assert.rejects(
        execFileAsync(startPath, args, {
          cwd: root,
          env: {
            ...process.env,
            OPENREAPER_START_WAIT_SECONDS: "2",
            OPENREAPER_STARTUP_BUDGET_MS: "16000",
          },
          timeout: 20_000,
          maxBuffer: 1_048_576,
        }),
        (error) => {
          assert.equal(error.code, 1, error.stderr);
          assert.match(error.stderr, /public read probe failed/u);
          assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
          return true;
        },
      );
      launchedPid = Number((await readFile(pidMarker, "utf8")).trim());
      assert.equal(Number.isSafeInteger(launchedPid), true);
      await waitForPidExit(launchedPid);
      assert.throws(() => process.kill(launchedPid, 0), { code: "ESRCH" });
      assert.doesNotThrow(() => process.kill(preexistingPid, 0));
      await assert.rejects(readFile(path.join(sessionRoot, "reaper.pid")), { code: "ENOENT" });

      await assert.rejects(
        execFileAsync(startPath, args, {
          cwd: root,
          env: {
            ...process.env,
            OPENREAPER_B_FORCE_FIRST_IDENTITY_FAILURE: "1",
            OPENREAPER_START_WAIT_SECONDS: "2",
            OPENREAPER_STARTUP_BUDGET_MS: "16000",
          },
          timeout: 20_000,
          maxBuffer: 1_048_576,
        }),
        (error) => {
          assert.equal(error.code, 1, error.stderr);
          assert.match(error.stderr, /REAPER identity could not be verified/u);
          assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
          assert.doesNotMatch(error.stderr, /startup-cleanup=skipped_unverified/u);
          return true;
        },
      );
      identityRetryPid = Number((await readFile(pidMarker, "utf8")).trim());
      assert.equal(Number.isSafeInteger(identityRetryPid), true);
      await waitForPidExit(identityRetryPid);
      assert.throws(() => process.kill(identityRetryPid, 0), { code: "ESRCH" });
      assert.doesNotThrow(() => process.kill(preexistingPid, 0));
      await assert.rejects(readFile(path.join(sessionRoot, "reaper.pid")), { code: "ENOENT" });

      if (mode === "launchservices") {
        await assert.rejects(
          execFileAsync(startPath, args, {
            cwd: root,
            env: {
              ...process.env,
              OPENREAPER_B_STAGGERED_LAUNCH: "1",
              OPENREAPER_START_WAIT_SECONDS: "2",
              OPENREAPER_STARTUP_BUDGET_MS: "16000",
            },
            timeout: 20_000,
            maxBuffer: 1_048_576,
          }),
          (error) => {
            assert.equal(error.code, 1);
            assert.match(error.stderr, /public read probe failed/u);
            assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
            return true;
          },
        );
        staggeredPids = (await readFile(staggeredPidMarker, "utf8"))
          .trim()
          .split("\n")
          .map(Number);
        assert.equal(staggeredPids.length, 2);
        assert.doesNotThrow(() => process.kill(staggeredPids[0], 0));
        await waitForPidExit(staggeredPids[1]);
        assert.throws(() => process.kill(staggeredPids[1], 0), { code: "ESRCH" });

        const hangingLaunchServicesStartedAt = Date.now();
        await assert.rejects(
          execFileAsync(startPath, args, {
            cwd: root,
            env: {
              ...process.env,
              OPENREAPER_B_HANG_AFTER_PID_HANDOFF: "1",
              OPENREAPER_START_WAIT_SECONDS: "10",
              OPENREAPER_STARTUP_BUDGET_MS: "16000",
            },
            timeout: 20_000,
            maxBuffer: 1_048_576,
          }),
          (error) => {
            assert.equal(error.code, 124, error.stderr);
            assert.match(error.stderr, /LaunchServices timed out after 3000 ms/u);
            assert.match(error.stderr, /blocker-code=STARTUP_LAUNCHSERVICES_TIMEOUT/u);
            assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
            return true;
          },
        );
        assert.equal(Date.now() - hangingLaunchServicesStartedAt < 10_000, true);
        hangingLaunchServicesReaperPid = Number((await readFile(pidMarker, "utf8")).trim());
        launchServicesHelperPid = Number((await readFile(launchServicesHelperPidMarker, "utf8")).trim());
        assert.equal(Number.isSafeInteger(hangingLaunchServicesReaperPid), true);
        assert.equal(Number.isSafeInteger(launchServicesHelperPid), true);
        await waitForPidExit(hangingLaunchServicesReaperPid);
        await waitForPidExit(launchServicesHelperPid);
        assert.throws(() => process.kill(hangingLaunchServicesReaperPid, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(launchServicesHelperPid, 0), { code: "ESRCH" });
        assert.doesNotThrow(() => process.kill(preexistingPid, 0));
        assert.doesNotThrow(() => process.kill(staggeredPids[0], 0));
        assert.deepEqual(JSON.parse(await readFile(launchctlStatePath, "utf8")), launchctlBaseline);
        await assert.rejects(stat(launchservicesLockPath), { code: "ENOENT" });
        await assert.rejects(readFile(path.join(sessionRoot, "reaper.pid")), { code: "ENOENT" });

        const preAtomicStartedAt = Date.now();
        await assert.rejects(
          execFileAsync(startPath, args, {
            cwd: root,
            env: {
              ...process.env,
              OPENREAPER_B_HANG_BEFORE_ATOMIC_PID_HANDOFF: "1",
              OPENREAPER_START_WAIT_SECONDS: "10",
              OPENREAPER_STARTUP_BUDGET_MS: "16000",
            },
            timeout: 20_000,
            maxBuffer: 1_048_576,
          }),
          (error) => {
            assert.equal(error.code, 124, error.stderr);
            assert.match(error.stderr, /LaunchServices timed out after 3000 ms/u);
            assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
            return true;
          },
        );
        assert.equal(Date.now() - preAtomicStartedAt < 10_000, true);
        preAtomicLaunchServicesReaperPid = Number((await readFile(pidMarker, "utf8")).trim());
        preAtomicLaunchServicesHelperPid = Number((await readFile(launchServicesHelperPidMarker, "utf8")).trim());
        await waitForPidExit(preAtomicLaunchServicesReaperPid);
        await waitForPidExit(preAtomicLaunchServicesHelperPid);
        assert.throws(() => process.kill(preAtomicLaunchServicesReaperPid, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(preAtomicLaunchServicesHelperPid, 0), { code: "ESRCH" });
        assert.doesNotThrow(() => process.kill(preexistingPid, 0));
        assert.deepEqual(JSON.parse(await readFile(launchctlStatePath, "utf8")), launchctlBaseline);
        await assert.rejects(stat(launchservicesLockPath), { code: "ENOENT" });

        await writeFile(doctorPath, `#!/bin/zsh
trap '' TERM
print -r -- "$$" > ${JSON.stringify(hangingDoctorPidMarker)}
sleep 60
`, "utf8");
        await chmod(doctorPath, 0o755);
        await assert.rejects(
          execFileAsync(startPath, args, {
            cwd: root,
            env: {
              ...process.env,
              OPENREAPER_START_WAIT_SECONDS: "10",
              OPENREAPER_STARTUP_BUDGET_MS: "16000",
            },
            timeout: 20_000,
            maxBuffer: 1_048_576,
          }),
          (error) => {
            assert.equal(error.code, 124);
            assert.match(error.stderr, /startup-budget-stage=supervisor_deadline/u);
            assert.match(error.stderr, /startup-cleanup=reaper_terminated/u);
            return true;
          },
        );
        hangingDoctorPid = Number((await readFile(hangingDoctorPidMarker, "utf8")).trim());
        hangingReaperPid = Number((await readFile(pidMarker, "utf8")).trim());
        assert.equal(Number.isSafeInteger(hangingDoctorPid), true);
        assert.equal(Number.isSafeInteger(hangingReaperPid), true);
        await waitForPidExit(hangingDoctorPid);
        await waitForPidExit(hangingReaperPid);
        assert.throws(() => process.kill(hangingDoctorPid, 0), { code: "ESRCH" });
        assert.throws(() => process.kill(hangingReaperPid, 0), { code: "ESRCH" });
        assert.doesNotThrow(() => process.kill(preexistingPid, 0));
        assert.doesNotThrow(() => process.kill(staggeredPids[0], 0));
        await assert.rejects(readFile(path.join(sessionRoot, "reaper.pid")), { code: "ENOENT" });

        await writeFile(launchctlStatePath, JSON.stringify(launchctlBaseline), "utf8");
        await rm(launchctlMutationCountPath, { force: true });
        const launchctlTimeoutStartedAt = Date.now();
        await assert.rejects(
          execFileAsync(startPath, args, {
            cwd: root,
            env: {
              ...process.env,
              OPENREAPER_B_LAUNCHCTL_HANG_AFTER_MUTATIONS: "2",
              OPENREAPER_STARTUP_BUDGET_MS: "16000",
            },
            timeout: 20_000,
            maxBuffer: 1_048_576,
          }),
          (error) => {
            assert.equal(error.code, 1, error.stderr);
            assert.match(error.stderr, /failed to (?:set|clear stale) LaunchServices env/u);
            assert.match(error.stderr, /LaunchServices cleanup failed during exit/u);
            assert.match(error.stderr, /LaunchServices lock retained/u);
            return true;
          },
        );
        assert.equal(Date.now() - launchctlTimeoutStartedAt < 6_000, true);
        assert.deepEqual(JSON.parse(await readFile(launchctlStatePath, "utf8")), launchctlBaseline);
        assert.equal((await stat(launchservicesLockPath)).isDirectory(), true);
      }
    } finally {
      for (const pid of [
        launchedPid,
        identityRetryPid,
        hangingDoctorPid,
        hangingReaperPid,
        hangingLaunchServicesReaperPid,
        launchServicesHelperPid,
        preAtomicLaunchServicesReaperPid,
        preAtomicLaunchServicesHelperPid,
        preexistingPid,
        ...staggeredPids,
      ]) {
        if (!Number.isSafeInteger(pid)) continue;
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error?.code !== "ESRCH") throw error;
        }
      }
      await rm(root, { recursive: true, force: true });
    }
  }
});

async function waitForPidExit(pid) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  assert.fail(`process ${pid} did not exit`);
}
