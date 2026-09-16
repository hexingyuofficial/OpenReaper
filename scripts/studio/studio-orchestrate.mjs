#!/usr/bin/env node

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runPipeline, createStudioLog } from "./lib/orchestration/run-pipeline.mjs";
import { START_STEPS } from "./lib/orchestration/start-steps.mjs";
import { STOP_STEPS, loadStopContext } from "./lib/orchestration/stop-steps.mjs";
import { studioStatePath } from "./lib/paths.mjs";
import { probePiRpcHealth } from "./lib/orchestration/pi-rpc-lifecycle.mjs";
import { readStudioState } from "./lib/state.mjs";

function printHelp() {
  process.stdout.write(`OpenReaper Studio orchestration

Usage:
  node scripts/studio/studio-orchestrate.mjs start [--project-path /path/to.rpp]
  node scripts/studio/studio-orchestrate.mjs stop
  node scripts/studio/studio-orchestrate.mjs status

See scripts/studio/README.md for module map and extension points.

Requires packaged OpenReaper at ~/.openreaper/current (or OPENREAPER_INSTALL_ROOT).
`);
}

function parseCli(argv) {
  const [command, ...rest] = argv;
  const options = { projectPath: null };
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (token === "--project-path") {
      options.projectPath = rest[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token.startsWith("--project-path=")) {
      options.projectPath = token.slice("--project-path=".length);
      continue;
    }
    throw new Error(`Unknown argument: ${token}`);
  }
  return { command, options };
}

async function startStudio(options, env = process.env) {
  const platform = process.platform;
  if (platform !== "darwin" && platform !== "win32") {
    throw new Error(
      "OpenReaper Studio start/stop is verified on macOS; Windows scripts are experimental.",
    );
  }

  const ctx = {
    homeDir: os.homedir(),
    platform,
    env,
    options,
    log: createStudioLog(),
  };

  await runPipeline({ steps: START_STEPS, ctx });
  process.stdout.write("[OpenReaper Studio] Start chain complete.\n");
}

async function stopStudio(env = process.env) {
  const homeDir = os.homedir();
  const loaded = await loadStopContext(homeDir);
  if (!loaded) {
    process.stdout.write("[OpenReaper Studio] No active Studio session state file.\n");
    return;
  }

  const ctx = {
    ...loaded,
    env,
    log: createStudioLog(),
  };

  await runPipeline({ steps: STOP_STEPS, ctx });
  process.stdout.write("[OpenReaper Studio] Stop complete.\n");
}

async function statusStudio() {
  const state = await readStudioState(studioStatePath());
  if (!state) {
    process.stdout.write("[OpenReaper Studio] status=idle\n");
    return;
  }
  if (state.pi?.mode === "started" && state.pi?.rpcHealthUrl) {
    const healthy = await probePiRpcHealth(state.pi.rpcHealthUrl);
    process.stdout.write(
      `[OpenReaper Studio] private_pi_rpc_health=${healthy ? "ok" : "down"}\n`,
    );
  }
  process.stdout.write(`${JSON.stringify(state, null, 2)}\n`);
}

export function studioFailureExitCode(error) {
  const code = Number(error?.exitCode);
  if (Number.isInteger(code) && code > 0) {
    return code;
  }
  return 1;
}

async function main() {
  let parsed;
  try {
    parsed = parseCli(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n`);
    printHelp();
    process.exit(2);
  }

  const { command, options } = parsed;
  if (!command || command === "--help" || command === "-h") {
    printHelp();
    process.exit(0);
  }

  try {
    if (command === "start") {
      await startStudio(options);
      return;
    }
    if (command === "stop") {
      await stopStudio();
      return;
    }
    if (command === "status") {
      await statusStudio();
      return;
    }
    throw new Error(`Unknown command: ${command}`);
  } catch (error) {
    const code = studioFailureExitCode(error);
    process.exitCode = code;
    process.stderr.write(`[OpenReaper Studio] ${error?.message ?? error}\n`);
    process.exit(code);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    const code = studioFailureExitCode(error);
    process.exitCode = code;
    process.stderr.write(`[OpenReaper Studio] ${error?.message ?? error}\n`);
    process.exit(code);
  });
}

export { parseCli, startStudio, stopStudio, statusStudio };
