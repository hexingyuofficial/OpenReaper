import assert from "node:assert/strict";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { it } from "node:test";

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const START_SOURCE = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start.sh");

it("reuses a verified healthy PID, isolates the Doctor from caller cwd, and truthfully blocks a stale Bridge", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha4-b-recovery-"));
  const packageRoot = path.join(root, "OpenReaper-alpha");
  const startPath = path.join(packageRoot, "bin", "openreaper-start");
  const readinessPath = path.join(packageRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "alpha3-2b3-runtime-doctor-readiness-v1.mjs");
  const doctorPath = path.join(packageRoot, "bin", "openreaper-doctor");
  const doctorCwdMarker = path.join(root, "doctor-cwd.marker");
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
        /run_startup_dialog_assist\(\) \{[\s\S]*?\n\}\n\nstartup_dialog_result_is_safe\(\) \{/u,
        "run_startup_dialog_assist() {\n  echo \"no_safe_dialog\"\n}\n\nstartup_dialog_result_is_safe() {",
      ),
      "utf8");
    await chmod(startPath, 0o755);
    await writeFile(doctorPath, `#!/bin/zsh
expected_root=${JSON.stringify(packageRoot)}
if [[ "\${PWD:A}" != "\${expected_root:A}" ]]; then
  print -ru2 -- "Doctor inherited caller cwd: \${PWD}"
  exit 91
fi
print -r -- "\${PWD}" > ${JSON.stringify(doctorCwdMarker)}
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

    const startArgs = [
      "--reaper-binary", fakeReaper,
      "--session-root", sessionRoot,
      "--render-root", renderRoot,
      "--no-startup-dialog-assist",
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
    const result = await execFileAsync(startPath, startArgs, {
      cwd: callerRoot,
      env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "1", OPENREAPER_TEST_PARENT_PID: parentPid },
      timeout: 10_000,
      maxBuffer: 1_048_576,
    });

    assert.match(result.stdout, /startup-mode=recover_existing/u);
    assert.match(result.stdout, new RegExp(`existing-session=reaper_pid=${parentPid};identity=verified`, "u"));
    assert.match(result.stdout, /startup-status=ready/u);
    assert.equal((await readFile(doctorCwdMarker, "utf8")).trim(), await realpath(packageRoot));
    await assert.rejects(readFile(launchMarker), { code: "ENOENT" });
    assert.equal((await readFile(pidFile, "utf8")).trim(), parentPid);

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
