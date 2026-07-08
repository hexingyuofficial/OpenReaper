import { spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, chmod, copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import {
  formatAlpha3D1StartupEnvFile,
  formatAlpha3D1StartupWrapperReadme,
  planAlpha3D1StartupWrapper,
} from "../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";

const STARTUP_HOOK_BEGIN = "-- >>> OpenReaper Alpha3 MCP startup hook >>>";
const STARTUP_HOOK_END = "-- <<< OpenReaper Alpha3 MCP startup hook <<<";
const MCP_REQUIREMENT_MESSAGE =
  "OpenReaper MCP can connect only when REAPER is started through the OpenReaper startup helper or an equivalent session env launcher.";
const STARTUP_DIALOG_MESSAGE =
  "If REAPER shows a version, recovery, plugin, or first-run dialog, the user must dismiss it before the startup hook can finish connecting MCP.";

const options = parseArgs(process.argv.slice(2));
const now = new Date();
const runId = safeRunId(options.run_id, `openreaper-alpha3-start-${compactTimestamp(now)}`);
const runRoot = resolve(options.run_root ?? `/Users/Shared/${runId}`);
const bridgeScriptPath = resolve(options.bridge_script_path ?? "reaper/bridge/openreaper-live-bridge.lua");
const reaperBinary = resolveReaperBinary(options.reaper_binary ?? options.reaper_app);
const projectPath = resolveOptionalProjectPath(options.project_path ?? options.project ?? options.rpp_path);
const launch = options.launch === true;
const dryRun = options.dry_run === true || !launch;
const installStartupHook = options.install_startup_hook === true;
const startupHookPath = resolveStartupHookPath(options.startup_hook_path);

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
  projectPath,
  bridgeScriptPath: card.paths.bridge_script_path,
  startupHookPath,
});
await writeFile(launcherPath, launcherText, { flag: "w" });
await chmod(launcherPath, 0o755);

const startupHook = installStartupHook
  ? await installConditionalStartupHook({ startupHookPath, bridgeScriptPath: card.paths.bridge_script_path, now })
  : {
      requested: false,
      installed: false,
      status: "not_requested",
      path: startupHookPath,
      backup_path: null,
      marker_present: false,
      conditional_on_openreaper_env: true,
    };

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
  if (projectPath) {
    try {
      await access(projectPath, fsConstants.R_OK);
    } catch {
      launchBlockers.push({
        code: "PROJECT_PATH_NOT_READABLE",
        message: `Project path is not readable: ${projectPath}`,
      });
    }
  }
}

let child = null;
if (launch && launchBlockers.length === 0) {
  child = spawn(reaperBinary, projectPath ? [projectPath] : [], {
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
  agent_capability: {
    can_prepare_session: true,
    can_launch_reaper_with_session_env: true,
    can_launch_specific_project_with_session_env: true,
    can_install_conditional_startup_hook: true,
    launch_command: "npm run start:openreaper -- --launch",
    launch_project_command: "npm run start:openreaper -- --install-startup-hook --launch --project-path <path-to-project.RPP>",
    one_command_with_auto_bridge: "npm run start:openreaper -- --install-startup-hook --launch",
    must_remind_user: MCP_REQUIREMENT_MESSAGE,
    must_not_close_reaper_without_explicit_authorization: true,
  },
  mcp_connection_requirement: {
    only_openreaper_launch_supported: true,
    ordinary_reaper_launch_supported: false,
    user_reminder: MCP_REQUIREMENT_MESSAGE,
    reason: "The live MCP bridge session identity and transport paths are injected through the OpenReaper startup helper env.",
  },
  startup_dialog_policy: {
    agent_clicks_reaper_ui: false,
    user_may_need_to_dismiss_dialog: true,
    user_reminder: STARTUP_DIALOG_MESSAGE,
    agent_after_dialog_action: "Rerun startup health/read smoke after the user dismisses the dialog.",
  },
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
    project_path: projectPath,
    startup_hook_path: startupHookPath,
  },
  target_project: {
    requested: projectPath !== null,
    path: projectPath,
    launch_argument_used: launch && launchBlockers.length === 0 && projectPath !== null,
  },
  startup_hook: startupHook,
  launch_blockers: launchBlockers,
  safety: {
    explicit_launch_required: true,
    dry_run_default: true,
    safe_write_called: false,
    project_mutation: false,
    raw_execution_product_bypass: false,
    hidden_executor: false,
    public_call_recipe: false,
    closes_reaper: false,
    close_reaper_requires_explicit_user_authorization: true,
    conditional_startup_hook_installed: startupHook.installed,
    bridge_script_auto_run_candidate: startupHook.installed,
    bridge_script_auto_run: startupHook.installed && launch && launchBlockers.length === 0,
    one_click_live_accepted: true,
    customer_ready: false,
  },
  next_steps: launch
    ? launchNextSteps({ startupHook, bridgeScriptPath: card.paths.bridge_script_path })
    : [
        MCP_REQUIREMENT_MESSAGE,
        `Run with --launch to open REAPER with this session env, or double-click ${launcherPath}.`,
        `For one-command startup, rerun with --install-startup-hook --launch. Hook path: ${startupHookPath}`,
        "Then run startup health before any live or safe-write call.",
        STARTUP_DIALOG_MESSAGE,
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

function resolveOptionalProjectPath(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  return resolve(value.trim());
}

function resolveStartupHookPath(value) {
  const fallback = `${process.env.HOME ?? "/tmp"}/Library/Application Support/REAPER/Scripts/__startup.lua`;
  const candidate = typeof value === "string" && value.trim() !== "" ? value.trim() : fallback;
  return resolve(candidate);
}

async function installConditionalStartupHook({ startupHookPath, bridgeScriptPath, now }) {
  await mkdir(dirname(startupHookPath), { recursive: true });
  const block = formatStartupHookBlock({ bridgeScriptPath });
  let existing = "";
  let existed = false;
  try {
    existing = await readFile(startupHookPath, "utf8");
    existed = true;
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  if (existing.includes(STARTUP_HOOK_BEGIN)) {
    return {
      requested: true,
      installed: true,
      status: "already_installed",
      path: startupHookPath,
      backup_path: null,
      marker_present: true,
      conditional_on_openreaper_env: true,
    };
  }

  const backupPath = existed
    ? `${startupHookPath}.openreaper-backup-${compactTimestamp(now)}`
    : null;
  if (backupPath) {
    await copyFile(startupHookPath, backupPath);
  }

  const nextText = existed && existing.trimEnd() !== ""
    ? `${existing.trimEnd()}\n\n${block}\n`
    : `${block}\n`;
  await writeFile(startupHookPath, nextText, { flag: "w" });
  return {
    requested: true,
    installed: true,
    status: existed ? "appended_with_backup" : "created",
    path: startupHookPath,
    backup_path: backupPath,
    marker_present: true,
    conditional_on_openreaper_env: true,
  };
}

function formatStartupHookBlock({ bridgeScriptPath }) {
  return [
    STARTUP_HOOK_BEGIN,
    "-- Inert for normal REAPER launches; active only when OpenReaper session env exists.",
    "do",
    "  local bridge_script = os.getenv(\"OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH\")",
    "  local transport_dir = os.getenv(\"OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR\")",
    "  if bridge_script and bridge_script ~= \"\" and transport_dir and transport_dir ~= \"\" then",
    `    bridge_script = bridge_script or ${luaString(bridgeScriptPath)}`,
    "    local ok, err = pcall(dofile, bridge_script)",
    "    if not ok and reaper and reaper.ShowConsoleMsg then",
    "      reaper.ShowConsoleMsg(\"[OpenReaper] startup bridge failed: \" .. tostring(err) .. \"\\n\")",
    "    end",
    "  end",
    "end",
    STARTUP_HOOK_END,
  ].join("\n");
}

function formatLauncherCommand({ envFilePath, reaperBinary, projectPath, bridgeScriptPath, startupHookPath }) {
  return `${[
    "#!/bin/zsh",
    "set -euo pipefail",
    `# ${MCP_REQUIREMENT_MESSAGE}`,
    `source ${shellQuote(envFilePath)}`,
    projectPath ? `exec ${shellQuote(reaperBinary)} ${shellQuote(projectPath)}` : `exec ${shellQuote(reaperBinary)}`,
    "",
    `# Auto-bridge requires the conditional startup hook at: ${startupHookPath}`,
    `# If the hook is not installed, run this bridge script from the REAPER Action List: ${bridgeScriptPath}`,
  ].join("\n")}\n`;
}

function launchNextSteps({ startupHook, bridgeScriptPath }) {
  const steps = [MCP_REQUIREMENT_MESSAGE];
  if (startupHook.installed) {
    steps.push("The conditional REAPER startup hook is installed; it should start the OpenReaper bridge automatically for this env-launched session.");
  } else {
    steps.push("In REAPER, run the OpenReaper bridge script once if it is not already running.");
    steps.push(`Bridge script: ${bridgeScriptPath}`);
  }
  steps.push(STARTUP_DIALOG_MESSAGE);
  steps.push("Then run startup health before any live or safe-write call.");
  return steps;
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

function luaString(value) {
  return `"${String(value ?? "").replaceAll("\\", "\\\\").replaceAll("\"", "\\\"")}"`;
}
