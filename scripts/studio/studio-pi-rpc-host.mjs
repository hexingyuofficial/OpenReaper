#!/usr/bin/env node
/**
 * Long-lived host: spawns private `pi --mode rpc` and exposes loopback HTTP for the agent seam.
 * Started detached by Studio Start; stopped by Studio Stop (SIGTERM this process).
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { startPiRpcHost } from "./lib/agent-seam/pi-rpc-host.mjs";
import { buildPiProcessEnv, buildPiStartPlan, resolvePiExecutable } from "./lib/pi.mjs";
import { resolveInstallRoot } from "./lib/paths.mjs";
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
  const plan = buildPiStartPlan({ piExecutable, env, layout });
  if (plan.mode !== "start") {
    process.stderr.write(`${plan.message ?? "Pi start plan is not runnable."}\n`);
    process.exit(1);
  }

  const piEnv = buildPiProcessEnv({ env, layout });
  const log = (message) => process.stderr.write(`${message}\n`);

  if (options.endpointFile) {
    await import("node:fs/promises").then(({ mkdir }) =>
      mkdir(path.dirname(options.endpointFile), { recursive: true }),
    );
  }

  await startPiRpcHost({
    piExecutable: plan.piExecutable,
    piArgs: plan.args,
    piEnv,
    endpointFile: options.endpointFile,
    log,
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}
