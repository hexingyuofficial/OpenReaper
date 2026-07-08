import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, mkdir, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import {
  formatAlpha3D1StartupEnvFile,
  formatAlpha3D1StartupWrapperReadme,
  planAlpha3D1StartupWrapper,
} from "../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";

const options = parseArgs(process.argv.slice(2));
const now = new Date();
const runId = safeRunId(options.run_id, `openreaper-alpha3-start-${compactTimestamp(now)}`);
const runRoot = resolve(options.run_root ?? `/Users/Shared/${runId}`);
const bridgeScriptPath = resolve(options.bridge_script_path ?? "reaper/bridge/openreaper-live-bridge.lua");
const reaperBinary = resolveReaperBinary(options.reaper_binary ?? options.reaper_app);
const launch = options.launch === true;
const dryRun = options.dry_run === true || !launch;

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

const launcherPath = plan.wrapper_plan.candidate_launcher_command_path;
const launcherText = formatLauncherCommand({
  envFilePath: card.paths.env_file_path,
  reaperBinary,
  bridgeScriptPath: card.paths.bridge_script_path,
});
await writeFile(launcherPath, launcherText, { flag: "w" });
await chmod(launcherPath, 0o755);

const launchBlockers = [];
if (launch) {
  try {
    await access(reaperBinary, fsConstants.X_OK);
  } catch {
    launchBlockers.push({
      code: "REAPER_BINARY_NOT_EXECUTABLE",
      message: `REAPER binary is not executable: ${reaperBinary}`,
    });
  }
}

let child = null;
if (launch && launchBlockers.length === 0) {
  child = spawn(reaperBinary, [], {
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      ...card.env,
    },
  });
  child.unref();
}

const result = {
  contract: "alpha3.d1.start_openreaper_helper_result.v1",
  ok: launch ? launchBlockers.length === 0 : true,
  mode: launch ? "launch_requested" : "prepare_only",
  dry_run: dryRun,
  launched_reaper: launch && launchBlockers.length === 0,
  spawned_process_now: launch && launchBlockers.length === 0,
  spawned_pid: child?.pid ?? null,
  run_id: card.run_id,
  session_id: card.session_id,
  owner: card.owner,
  generation: card.generation,
  paths: {
    ...card.paths,
    wrapper_dir: plan.wrapper_plan.wrapper_dir,
    wrapper_plan_path: plan.wrapper_plan.wrapper_plan_path,
    readme_path: plan.wrapper_plan.readme_path,
    launcher_command_path: launcherPath,
    reaper_binary: reaperBinary,
  },
  launch_blockers: launchBlockers,
  safety: {
    explicit_launch_required: true,
    dry_run_default: true,
    safe_write_called: false,
    project_mutation: false,
    raw_execution_product_bypass: false,
    hidden_executor: false,
    public_call_recipe: false,
    bridge_script_auto_run: false,
    one_click_live_accepted: false,
    customer_ready: false,
  },
  next_steps: launch
    ? [
        "In REAPER, run the OpenReaper bridge script once if it is not already running.",
        `Bridge script: ${card.paths.bridge_script_path}`,
        "Then run startup health before any live or safe-write call.",
      ]
    : [
        `Run with --launch to open REAPER with this session env, or double-click ${launcherPath}.`,
        "In REAPER, run the OpenReaper bridge script once if it is not already running.",
        "Then run startup health before any live or safe-write call.",
      ],
};

console.log(JSON.stringify(result, null, 2));

function parseArgs(args) {
  const parsed = {};
  for (const arg of args) {
    if (!arg.startsWith("--")) continue;
    const equals = arg.indexOf("=");
    const key = toSnake(arg.slice(2, equals === -1 ? undefined : equals));
    if (equals === -1) {
      parsed[key] = true;
      continue;
    }
    parsed[key] = arg.slice(equals + 1);
  }
  return parsed;
}

function toSnake(value) {
  return value.replaceAll("-", "_");
}

function resolveReaperBinary(value) {
  const fallback = "/Applications/REAPER.app/Contents/MacOS/REAPER";
  const candidate = typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  if (candidate.endsWith(".app")) return resolve(candidate, "Contents/MacOS", basename(candidate, ".app"));
  return resolve(candidate);
}

function formatLauncherCommand({ envFilePath, reaperBinary, bridgeScriptPath }) {
  return `${[
    "#!/bin/zsh",
    "set -euo pipefail",
    `source ${shellQuote(envFilePath)}`,
    `exec ${shellQuote(reaperBinary)}`,
    "",
    `# After REAPER opens, run this bridge script from the REAPER Action List: ${bridgeScriptPath}`,
  ].join("\n")}\n`;
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

function shellQuote(value) {
  const text = String(value ?? "");
  return `'${text.replaceAll("'", "'\\''")}'`;
}
