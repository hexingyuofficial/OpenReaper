#!/usr/bin/env node
/**
 * CLI for REAPER face — list Pi slash commands from private RPC host.
 */

import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { fetchPiCommands } from "./lib/agent-seam/fetch-pi-commands.mjs";
import { readFaceConfig } from "./lib/face/runtime-config.mjs";
import { studioStatePath } from "./lib/paths.mjs";
import { readStudioState } from "./lib/state.mjs";

async function main() {
  const homeDir = os.homedir();
  const faceConfig = await readFaceConfig(homeDir);
  const state = await readStudioState(studioStatePath(homeDir));
  const result = await fetchPiCommands({ env: process.env, faceConfig, studioState: state });
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}

export { main };
