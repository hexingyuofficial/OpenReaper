#!/usr/bin/env node
/**
 * Studio steward: spawns private `pi --mode rpc` (native extension tools) and
 * exposes loopback HTTP for the dialog seam. Started detached by Studio Start.
 * Stops on Studio Stop (SIGTERM) or when the watched REAPER pid exits.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir } from "node:fs/promises";
import { startPiRpcHost } from "./lib/agent-seam/pi-rpc-host.mjs";
import { buildPiProcessEnv, buildPiStartPlan, resolvePiExecutable } from "./lib/pi.mjs";
import { repoRootFromStudio, resolveInstallRoot } from "./lib/paths.mjs";
import { resolveStudioPiLayout } from "./lib/pi/private-layout.mjs";

function parseArgs(argv) {
  const options = { endpointFile: null, logFile: null };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--endpoint-file") {
      options.endpointFile = argv[i + 1] ?? null;
      i += 1;
      continue;
    }
    if (token.startsWith("--endpoint-file=")) {
      options.endpointFile = token.slice("--endpoint-file=".length);
      continue;
    }
  }
  return options;
}

function parseOptionalPid(value) {
  const pid = Number(value);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const env = process.env;
  const homeDir = os.homedir();
  const installRoot = resolveInstallRoot(env, homeDir);
  const layout = resolveStudioPiLayout({ homeDir, installRoot, env });
  const piExecutable =
    env.OPENREAPER_STUDIO_PI_BIN?.trim() ||
    layout.bundledPiExecutable ||
    resolvePiExecutable(env);
  const plan = buildPiStartPlan({
    piExecutable,
    env,
    layout,
    repoRoot: repoRootFromStudio(),
  });
  if (plan.mode !== "start") {
    process.stderr.write(`${plan.message ?? "Pi start plan is not runnable."}\n`);
    process.exit(1);
  }

  const piEnv = buildPiProcessEnv({ env, layout });
  const log = (message) => process.stderr.write(`${message}\n`);
  const piCwd = env.OPENREAPER_STUDIO_PI_CWD?.trim() || plan.cwd;
  if (piCwd) {
    await mkdir(piCwd, { recursive: true });
  }

  if (options.endpointFile) {
    await mkdir(path.dirname(options.endpointFile), { recursive: true });
  }

  await startPiRpcHost({
    piExecutable: plan.piExecutable,
    piArgs: plan.args,
    piEnv,
    piCwd,
    endpointFile: options.endpointFile,
    reaperPid: parseOptionalPid(env.OPENREAPER_STUDIO_REAPER_PID),
    reaperPidFile: env.OPENREAPER_STUDIO_REAPER_PID_FILE?.trim() || null,
    log,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
