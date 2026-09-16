#!/usr/bin/env node
/**
 * Agent seam CLI — invoked from REAPER (ExecProcess) with a prompt request JSON file.
 * Keep this thin; logic lives in lib/agent-seam/ and lib/contracts/.
 */

import { writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { readPromptPayload } from "./lib/agent-seam/read-payload.mjs";
import { sendStudioPrompt } from "./lib/agent-seam/send-prompt.mjs";
import { studioStatePath } from "./lib/paths.mjs";
import { readStudioState } from "./lib/state.mjs";

async function main() {
  const requestPath = process.argv[2];
  if (!requestPath) {
    process.stderr.write("Usage: studio-pi-send.mjs <request.json>\n");
    process.exit(2);
  }
  const payload = await readPromptPayload(requestPath);
  const state = await readStudioState(studioStatePath(os.homedir()));
  const result = await sendStudioPrompt(payload, state);
  const responsePath = requestPath.replace(/\.request\.json$/, ".response.json");
  const outPath =
    responsePath === requestPath ? `${requestPath}.response.json` : responsePath;
  await writeFile(outPath, `${JSON.stringify(result)}\n`, "utf8");
  process.stdout.write(`${JSON.stringify(result)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error?.stack ?? error}\n`);
    process.exit(1);
  });
}

export { main };
