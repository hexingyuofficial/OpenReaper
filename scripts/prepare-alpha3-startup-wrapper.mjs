import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  formatAlpha3D1StartupEnvFile,
  formatAlpha3D1StartupWrapperReadme,
  planAlpha3D1StartupWrapper,
} from "../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";

const options = parseArgs(process.argv.slice(2));
const runId = safeRunId(options.run_id, `openreaper-alpha3-wrapper-${compactTimestamp(new Date())}`);
const runRoot = resolve(options.run_root ?? `/tmp/${runId}`);
const bridgeScriptPath = resolve(options.bridge_script_path ?? "reaper/bridge/openreaper-live-bridge.lua");

const plan = planAlpha3D1StartupWrapper({
  ...options,
  run_id: runId,
  run_root: runRoot,
  bridge_script_path: bridgeScriptPath,
});
const card = plan.session_card;

await mkdir(card.paths.requests_dir, { recursive: true });
await mkdir(card.paths.results_dir, { recursive: true });
await mkdir(card.paths.artifact_root, { recursive: true });
await mkdir(card.paths.report_dir, { recursive: true });
await mkdir(plan.wrapper_plan.wrapper_dir, { recursive: true });
await writeFile(card.paths.card_path, `${JSON.stringify(card, null, 2)}\n`, { flag: "w" });
await writeFile(card.paths.env_file_path, formatAlpha3D1StartupEnvFile(card), { flag: "w" });
await writeFile(plan.wrapper_plan.wrapper_plan_path, `${JSON.stringify(plan, null, 2)}\n`, { flag: "w" });
await writeFile(plan.wrapper_plan.readme_path, formatAlpha3D1StartupWrapperReadme(plan), { flag: "w" });

console.log(JSON.stringify({
  contract: "alpha3.d1.startup_wrapper_prepare_result.v1",
  ok: true,
  prepared: true,
  run_id: card.run_id,
  session_id: card.session_id,
  owner: card.owner,
  generation: card.generation,
  status: plan.status,
  evidence_status: plan.evidence_status,
  customer_ready: plan.customer_ready,
  one_click_live_accepted: plan.one_click_live_accepted,
  customer_claim: plan.customer_claim,
  paths: {
    ...card.paths,
    wrapper_dir: plan.wrapper_plan.wrapper_dir,
    wrapper_plan_path: plan.wrapper_plan.wrapper_plan_path,
    readme_path: plan.wrapper_plan.readme_path,
  },
  bounded_live_prompt: plan.bounded_live_prompt,
  safety: plan.safety,
  next_steps: [
    `Review ${plan.wrapper_plan.readme_path}.`,
    "Do not claim one-click startup support until the bounded startup evidence window passes.",
    "When authorized, follow the bounded live prompt and rerun startup health after reconnect.",
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
