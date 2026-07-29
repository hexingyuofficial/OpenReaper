import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const REPO = path.resolve(import.meta.dirname, "../../..");
const WRAPPER_SOURCE = path.join(REPO, "scripts/openreaper-alpha-package/openreaper-mcp.sh");
const roots = [];

test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("installed MCP wrapper shares the start helper bridge identity by default", async () => {
  const run = await runWrapper("default", {});
  assert.equal(run.result.code, 0, run.result.stderr);
  assert.deepEqual(run.capture, {
    owner: "openreaper-alpha",
    generation: "1",
    logical_session_key: `reaper-pid:${process.pid}`,
    bridge_script_path: path.join(run.installRoot, "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"),
    executable_recipe_root: path.join(path.dirname(run.installRoot), "data/executable-recipes"),
    official_executable_recipe_root: path.join(run.installRoot, "session/executable-recipes.official"),
  });
});

test("installed MCP wrapper preserves an explicit bounded bridge identity", async () => {
  const run = await runWrapper("explicit", {
    OPENREAPER_LIVE_BRIDGE_OWNER: "alpha4-live-evidence",
    OPENREAPER_LIVE_BRIDGE_GENERATION: "7",
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha4-session",
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: "/tmp/openreaper-explicit-bridge.lua",
    OPENREAPER_EXECUTABLE_RECIPE_ROOT: "/tmp/openreaper-explicit-user-recipes",
    OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT: "/tmp/openreaper-stale-official-recipes",
  });
  assert.equal(run.result.code, 0, run.result.stderr);
  assert.deepEqual(run.capture, {
    owner: "alpha4-live-evidence",
    generation: "7",
    logical_session_key: "alpha4-session",
    bridge_script_path: "/tmp/openreaper-explicit-bridge.lua",
    executable_recipe_root: "/tmp/openreaper-explicit-user-recipes",
    official_executable_recipe_root: path.join(run.installRoot, "session/executable-recipes.official"),
  });
});

async function runWrapper(label, extraEnv) {
  const root = await mkdtemp(path.join(os.tmpdir(), `openreaper-alpha4-mcp-identity-${label}-`));
  roots.push(root);
  const installRoot = path.join(root, "OpenReaper-alpha");
  const wrapper = path.join(installRoot, "bin", "openreaper-mcp");
  const fakeBin = path.join(root, "fake-bin");
  const capturePath = path.join(root, "capture.json");
  await Promise.all([
    mkdir(path.dirname(wrapper), { recursive: true }),
    mkdir(path.join(installRoot, "session", "renders"), { recursive: true }),
    mkdir(path.join(installRoot, "vendor", "openreaper-kernel"), { recursive: true }),
    mkdir(fakeBin, { recursive: true }),
  ]);
  await writeFile(wrapper, await readFile(WRAPPER_SOURCE), { mode: 0o755 });
  await writeFile(path.join(installRoot, "session", "reaper.pid"), `${process.pid}\n`, "utf8");
  const fakeNode = path.join(fakeBin, "node");
  await writeFile(fakeNode, `#!/bin/zsh
if [[ "$1" == "--input-type=module" ]]; then
  exec ${shellQuote(process.execPath)} "$@"
fi
${shellQuote(process.execPath)} -e 'const fs = require("node:fs"); fs.writeFileSync(process.argv[1], JSON.stringify({ owner: process.env.OPENREAPER_LIVE_BRIDGE_OWNER, generation: process.env.OPENREAPER_LIVE_BRIDGE_GENERATION, logical_session_key: process.env.OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY, bridge_script_path: process.env.OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH, executable_recipe_root: process.env.OPENREAPER_EXECUTABLE_RECIPE_ROOT, official_executable_recipe_root: process.env.OPENREAPER_OFFICIAL_EXECUTABLE_RECIPE_ROOT }))' ${shellQuote(capturePath)}
`, "utf8");
  await chmod(fakeNode, 0o755);
  const env = { ...process.env, PATH: `${fakeBin}:${process.env.PATH ?? ""}`, ...extraEnv };
  for (const key of [
    "OPENREAPER_LIVE_BRIDGE_OWNER",
    "OPENREAPER_LIVE_BRIDGE_GENERATION",
    "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
    "OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY",
  ]) {
    if (!Object.hasOwn(extraEnv, key)) delete env[key];
  }
  const result = await run(wrapper, env);
  return { result, capture: JSON.parse(await readFile(capturePath, "utf8")), installRoot: await realpath(installRoot) };
}

function run(command, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [], { env, stdio: ["ignore", "pipe", "pipe"] });
    const stdout = [];
    const stderr = [];
    child.stdout.on("data", (chunk) => stdout.push(chunk));
    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.on("error", reject);
    child.on("close", (code, signal) => resolve({
      code,
      signal,
      stdout: Buffer.concat(stdout).toString("utf8"),
      stderr: Buffer.concat(stderr).toString("utf8"),
    }));
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}
