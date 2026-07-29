import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  createAlpha3D1StartupSessionCard,
  formatAlpha3D1StartupEnvFile,
} from "../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";

const options = parseArgs(process.argv.slice(2));
const runId = safeRunId(options.run_id, `openreaper-alpha3-${compactTimestamp(new Date())}`);
const runRoot = resolve(options.run_root ?? `/tmp/${runId}`);
const bridgeScriptPath = resolve(options.bridge_script_path ?? "reaper/bridge/openreaper-live-bridge.lua");

const card = createAlpha3D1StartupSessionCard({
  ...options,
  run_id: runId,
  run_root: runRoot,
  bridge_script_path: bridgeScriptPath,
});

await mkdir(card.paths.requests_dir, { recursive: true });
await mkdir(card.paths.results_dir, { recursive: true });
await mkdir(card.paths.artifact_root, { recursive: true });
await mkdir(card.paths.report_dir, { recursive: true });
await writeFile(card.paths.card_path, `${JSON.stringify(card, null, 2)}\n`, { flag: "w" });
await writeFile(card.paths.env_file_path, formatAlpha3D1StartupEnvFile(card), { flag: "w" });

console.log(JSON.stringify({
  contract: "alpha3.d1.startup_session_prepare_result.v1",
  ok: true,
  run_id: card.run_id,
  session_id: card.session_id,
  owner: card.owner,
  generation: card.generation,
  paths: card.paths,
  env: card.env,
  safety: {
    prepared_files_only: true,
    opens_reaper: false,
    live_reaper_called: false,
    safe_write_called: false,
    raw_execution: false,
    hidden_executor: false,
    public_call_recipe: false,
    spawned_reaper: false,
  },
  next_steps: [
    `Keep ${card.paths.env_file_path} as the prepared session identity record.`,
    "Start or restart REAPER through the installed openreaper-start helper with the run root, transport, artifact root, owner, and generation from this card.",
    "Use the registered OpenReaper Bridge Action only if openreaper-start reports it as the manual recovery fallback.",
    "Tell the agent you reconnected after openreaper-start reports ready, then rerun startup health before live work.",
  ],
}, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    if (equals === -1) {
      parsed[toSnake(arg.slice(2))] = "true";
      continue;
    }
    parsed[toSnake(arg.slice(2, equals))] = arg.slice(equals + 1);
  }
  return parsed;
}

function toSnake(value) {
  return value.replaceAll("-", "_");
}

function compactTimestamp(date) {
  const pad = (value) => String(value).padStart(2, "0");
  return [
    date.getUTCFullYear(),
    pad(date.getUTCMonth() + 1),
    pad(date.getUTCDate()),
    "-",
    pad(date.getUTCHours()),
    pad(date.getUTCMinutes()),
    pad(date.getUTCSeconds()),
  ].join("");
}

function safeRunId(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().replace(/[^\w.+-]/g, "_").slice(0, 120) || fallback;
}
