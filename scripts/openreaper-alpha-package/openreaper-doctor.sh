#!/bin/zsh
set -euo pipefail

# Some MCP hosts export optional environment keys with empty values. Treat
# those placeholders as absent while preserving every non-empty override.
for optional_openreaper_env in \
  OPENREAPER_SESSION_ROOT \
  OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR \
  OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH \
  OPENREAPER_ARTIFACT_ROOT \
  OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT \
  OPENREAPER_LIVE_SMOKE_RENDER_ROOT \
  OPENREAPER_LIVE_BRIDGE_OWNER \
  OPENREAPER_LIVE_BRIDGE_GENERATION \
  OPENREAPER_LIVE_BRIDGE_SESSION_ID \
  OPENREAPER_PROJECT_INDEX_STATE_ROOT \
  OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY \
  OPENREAPER_EXECUTABLE_RECIPE_ROOT \
  OPENREAPER_CURRENT_PROJECT_PATH \
  OPENREAPER_CURRENT_PROJECT_REF \
  OPENREAPER_MCP_PACKAGE_ROOT \
  OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS \
  OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS; do
  if (( ${+parameters[${optional_openreaper_env}]} )) && [[ -z "${(P)optional_openreaper_env}" ]]; then
    unset "${optional_openreaper_env}"
  fi
done
unset optional_openreaper_env

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
SESSION_ROOT="${OPENREAPER_SESSION_ROOT:-${INSTALL_ROOT}/session}"
TRANSPORT_DIR="${OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR:-${SESSION_ROOT}/transport}"
ARTIFACT_ROOT="${OPENREAPER_ARTIFACT_ROOT:-${OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT:-${SESSION_ROOT}/artifacts}}"
EXECUTABLE_RECIPE_ROOT="${OPENREAPER_EXECUTABLE_RECIPE_ROOT:-${INSTALL_ROOT:h}/data/executable-recipes}"

export OPENREAPER_DOCTOR_INSTALL_ROOT="${INSTALL_ROOT}"
export OPENREAPER_DOCTOR_SESSION_ROOT="${SESSION_ROOT}"
export OPENREAPER_DOCTOR_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_DOCTOR_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_DOCTOR_EXECUTABLE_RECIPE_ROOT="${EXECUTABLE_RECIPE_ROOT}"

exec node --input-type=module - "$@" <<'NODE'
import { spawn } from "node:child_process";
import { constants as fsConstants, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { access, chmod, lstat, mkdir, mkdtemp, open, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";

const require = createRequire(import.meta.url);
const home = os.homedir();
const installRoot = process.env.OPENREAPER_DOCTOR_INSTALL_ROOT;
const sessionRoot = process.env.OPENREAPER_DOCTOR_SESSION_ROOT;
const transportDir = process.env.OPENREAPER_DOCTOR_TRANSPORT_DIR;
const artifactRoot = process.env.OPENREAPER_DOCTOR_ARTIFACT_ROOT;
const executableRecipeRoot = process.env.OPENREAPER_DOCTOR_EXECUTABLE_RECIPE_ROOT;
const mcpCommand = path.join(installRoot, "bin", "openreaper-mcp");
const vitalAgentMcpCommand = path.join(installRoot, "bin", "vital-agent-mcp");
const mcpCommandAliases = pathAliases(mcpCommand);
const vitalAgentMcpCommandAliases = pathAliases(vitalAgentMcpCommand);
const startCommand = path.join(installRoot, "bin", "openreaper-start");
const doctorCommand = path.join(installRoot, "bin", "openreaper-doctor");
const provenanceManifestPath = path.join(installRoot, "provenance.json");
const provenanceManifestMaxBytes = 16_384;
const serverScript = path.join(installRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs");
const readinessModulePath = path.join(installRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "alpha3-2b3-runtime-doctor-readiness-v1.mjs");
const projectUnderstandingModulePath = path.join(installRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "alpha3-2-5-b-project-understanding-v1.mjs");
const vitalAgentServerScript = path.join(installRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js");
const vitalAgentIncluded = existsSync(vitalAgentMcpCommand) && existsSync(vitalAgentServerScript);
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
const bridgeActionName = "OpenReaper: Start MCP bridge";
const bridgeActionScript = path.join(home, "Library", "Application Support", "REAPER", "Scripts", "OpenReaper", "openreaper-start-mcp-bridge.lua");
const reaperKbPath = path.join(home, "Library", "Application Support", "REAPER", "reaper-kb.ini");
const exactTools = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
const vitalAgentRequiredTools = ["create_openreaper_handoff_plan", "run_doctor"];
const requiredMacros = ["macro.project.inspect", "macro.project.query"];
const requiredFxTemplates = [
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.read_fx_parameter",
];
const activeMcpLifecycles = new Set();
let signalShutdownPromise = null;
for (const [signal, exitCode] of [["SIGINT", 130], ["SIGTERM", 143]]) {
  process.once(signal, () => {
    signalShutdownPromise ??= (async () => {
      await cleanupAllMcpLifecycles(`doctor_${signal.toLowerCase()}`).catch(() => {});
      process.exit(exitCode);
    })();
  });
}

const readinessModule = await import(pathToFileURL(readinessModulePath));
const projectUnderstandingModule = await import(pathToFileURL(projectUnderstandingModulePath));
const {
  ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
  alpha3_2B3ReadProbeTimeoutMs,
  createAlpha3_2B3DoctorTaskResult,
  inspectAlpha3_2B3ReaperProcess,
  inspectAlpha3_2B3RenderRoot,
  normalizeAlpha3_2B3RequestResponseProof,
  parseAlpha3_2B3DoctorArgs,
  parseAlpha3_2B3ExpectedIdentity,
  resolveAlpha3_2B3DoctorRenderRoot,
} = readinessModule;
const { projectAlpha3_2_5BProjectQueryDoctorTask } = projectUnderstandingModule;

const cli = parseAlpha3_2B3DoctorArgs(process.argv.slice(2));
if (!cli.ok) {
  process.stderr.write(`[OpenReaper] ${cli.error}\n`);
  process.stderr.write("usage: openreaper-doctor [--for live-edit|render|media-import|project-query] [--wait-bridge[=SECONDS]]\n");
  process.exit(2);
}

const renderSelection = await resolveAlpha3_2B3DoctorRenderRoot({
  env: process.env,
  installRoot,
  sessionRoot,
});
const effectiveRenderRoot = renderSelection.selection_status === "selected"
  ? renderSelection.path
  : "openreaper-invalid-render-root-selection";
const expectedOwner = Object.prototype.hasOwnProperty.call(process.env, "OPENREAPER_LIVE_BRIDGE_OWNER")
  ? process.env.OPENREAPER_LIVE_BRIDGE_OWNER
  : "openreaper-alpha";
const expectedGeneration = Object.prototype.hasOwnProperty.call(process.env, "OPENREAPER_LIVE_BRIDGE_GENERATION")
  ? process.env.OPENREAPER_LIVE_BRIDGE_GENERATION
  : "1";
const mcpEnv = {
  ...process.env,
  OPENREAPER_MCP_PACKAGE_ROOT: installRoot,
  OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
  OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
  OPENREAPER_ARTIFACT_ROOT: artifactRoot,
  OPENREAPER_EXECUTABLE_RECIPE_ROOT: executableRecipeRoot,
  OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
  OPENREAPER_LIVE_SMOKE_RENDER_ROOT: effectiveRenderRoot,
  OPENREAPER_LIVE_BRIDGE_OWNER: expectedOwner,
  OPENREAPER_LIVE_BRIDGE_GENERATION: expectedGeneration,
  OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: String(alpha3_2B3ReadProbeTimeoutMs(process.env)),
};
const identity = parseAlpha3_2B3ExpectedIdentity(mcpEnv);
const reaperProcess = await inspectAlpha3_2B3ReaperProcess({ sessionRoot });
const renderInspection = renderSelection.selection_status === "selected"
  ? await inspectAlpha3_2B3RenderRoot(renderSelection.path)
  : Object.freeze({
      status: "render_root_path_invalid",
      ready: false,
      configured: true,
      path: null,
      reason: renderSelection.reason ?? "managed_render_root_selection_invalid",
    });

const report = {
  product: "OpenReaper alpha",
  contract: "openreaper.alpha.doctor_report.v1",
  runtime_contract: readinessModule.ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
  install_root: installRoot,
  mcp_server_names: ["openreaper", ...(vitalAgentIncluded ? ["vital-agent-mcp"] : [])],
  commands: {
    mcp: mcpCommand,
    ...(vitalAgentIncluded ? { vital_agent_mcp: vitalAgentMcpCommand } : {}),
    start_reaper_for_mcp: startCommand,
  },
  optional_companions: {
    vital_agent_mcp: {
      included: vitalAgentIncluded,
      mode: "optional_companion",
    },
  },
  bridge_action: {
    name: bridgeActionName,
    script: bridgeActionScript,
    agent_should_try_to_run_action: false,
    role: "manual_recovery_fallback",
    user_fallback: `Only after autonomous startup reports a Bridge blocker: in REAPER, open Actions, search "${bridgeActionName}", click Run, then rerun Doctor.`,
    verification_probe: "call_template(template.transport.read_state)",
    sws_required: false,
    command_line_reascript_bridge: true,
  },
  startup_dialog_assist: {
    requires_first_use_consent: true,
    consent_choices: {
      once: "--startup-dialog-consent once",
      always: "--startup-dialog-consent always",
      manual: "--startup-dialog-consent manual",
    },
    persistent_policy_file: path.join(path.dirname(installRoot), "data", "startup-dialog-consent"),
    manual_behavior: "no_clicks_read_only_classification_wait_for_user_to_clear_blockers",
    auto_dismisses: ["Project Settings / Notes show notes on project load"],
    auto_dismisses_with_consent: ["Project Settings / Notes show notes on project load", "Ignore all missing files", "exact media-items-offline warning"],
    explicit_per_launch_consent: { missing_media: "--ignore-missing-media" },
    does_not_dismiss: ["missing media without consent", "license/evaluation", "recovery", "plugin/FX", "version", "unknown REAPER windows"],
    if_not_connected: "Resolve the typed dialog blocker and rerun openreaper-start. Use the Bridge Action only as the reported manual recovery fallback.",
  },
  checks: {},
  client_configs: [],
  stale_config_findings: [],
  migration_actions: [],
  smoke: null,
  package_status: "unknown",
  status: "unknown",
  runtime_readiness: null,
  runtime_diagnosis: null,
  project_index: null,
  project_index_readiness: null,
  reaper_process: reaperProcess,
  render_root_selection: {
    source: renderSelection.source,
    selection_status: renderSelection.selection_status,
    ...(renderSelection.path ? { path: renderSelection.path } : {}),
    ...(renderSelection.reason ? { reason: renderSelection.reason } : {}),
  },
  render_root_inspection: renderInspection,
  request_response: {
    status: "not_run",
    ready: false,
    template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
  },
  wait_bridge: cli.wait_bridge_seconds === null
    ? null
    : {
        requested: true,
        seconds: cli.wait_bridge_seconds,
        polls: 0,
        reached_bridge_ready: false,
      },
  task: null,
  recovery_card: null,
  provenance: await readProvenanceManifest(),
};

report.checks.node = {
  version: process.version,
  ok: Number(process.versions.node.split(".")[0]) >= 20,
};
report.checks.mcp_command = await pathCheck(mcpCommand);
report.checks.server_script = await pathCheck(serverScript);
report.checks.readiness_module = await pathCheck(readinessModulePath);
report.checks.project_understanding_module = await pathCheck(projectUnderstandingModulePath);
if (vitalAgentIncluded) {
  report.checks.vital_agent_mcp_command = await pathCheck(vitalAgentMcpCommand);
  report.checks.vital_agent_server_script = await pathCheck(vitalAgentServerScript);
}
report.checks.bridge_script = await pathCheck(bridgeScript);
report.checks.bridge_action_script = await pathCheck(bridgeActionScript);
report.checks.bridge_action_registration = await bridgeActionRegistrationCheck();
report.checks.sdk = await pathCheck(path.join(installRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"));
report.checks.zod = await pathCheck(path.join(installRoot, "node_modules", "zod", "package.json"));

await scanClientConfigs();
report.smoke = await smokeMcp();
report.runtime_readiness = report.smoke?.openreaper?.runtime_readiness ?? null;
report.request_response = report.smoke?.openreaper?.request_response ?? report.request_response;
report.project_index = report.smoke?.openreaper?.project_index
  ?? null;
report.project_index_readiness = projectIndexReadiness(report.project_index);
if (report.wait_bridge) {
  report.wait_bridge.polls = report.smoke?.openreaper?.wait_bridge_polls ?? 0;
  report.wait_bridge.reached_bridge_ready = report.runtime_readiness?.bridge?.status === "bridge_ready";
}
report.runtime_diagnosis = runtimeDiagnosis(report.runtime_readiness?.bridge, reaperProcess);
report.migration_actions = migrationActions();
report.package_status = computePackageStatus();
report.status = report.package_status;

if (cli.mode !== null) {
  const sharedTask = createAlpha3_2B3DoctorTaskResult({
    mode: cli.mode,
    runtimeReadiness: report.runtime_readiness,
    requestResponse: report.request_response,
    reaperProcess,
    renderInspection,
    installRoot,
    startCommand,
    bridgeActionName,
    transportDir,
  });
  report.task = projectAlpha3_2_5BProjectQueryDoctorTask({
    task: sharedTask,
    projectIndexReadiness: report.project_index_readiness,
    projectIndex: report.project_index,
  });
}
report.recovery_card = report.task?.recovery_card ?? (
  report.runtime_diagnosis === "bridge_ready" || report.runtime_diagnosis === "not_observed"
    ? null
    : compactDoctorRecoveryCard(report.runtime_diagnosis, report.runtime_readiness?.bridge, reaperProcess)
);

console.log(JSON.stringify(report, null, 2));
console.log("");
console.log("OpenReaper doctor agent report");
console.log(`status=${report.status}`);
console.log(`package_status=${report.package_status}`);
console.log(`mcp_server_names=${report.mcp_server_names.join(",")}`);
console.log(`mcp_command=${mcpCommand}`);
if (vitalAgentIncluded) console.log(`vital_agent_mcp_command=${vitalAgentMcpCommand}`);
console.log(`start_reaper_for_mcp=${startCommand}`);
console.log(`bridge_action=${bridgeActionName}`);
console.log(`bridge_action_script=${bridgeActionScript}`);
console.log(`bridge_status=${report.runtime_readiness?.bridge?.status ?? "not_observed"}`);
console.log(`bridge_diagnosis=${report.runtime_diagnosis ?? "not_observed"}`);
console.log(`reaper_process_status=${reaperProcess.status}`);
console.log(`render_root_status=${renderInspection.status}`);
console.log(`request_response_status=${report.request_response.status}`);
console.log(`project_index_status=${report.project_index_readiness.status}`);
console.log(`project_index_freshness=${report.project_index_readiness.status}`);
console.log(`project_index_backend=${report.project_index?.backend ?? "not_configured"}`);
console.log(`project_index_revision=${report.project_index?.revision ?? "not_hydrated"}`);
console.log(`project_index_recovery=${report.project_index?.recovery?.status ?? "none"}`);
console.log(`project_index_next_action=${report.project_index_readiness.next_action}`);
console.log(`provenance_package_version=${report.provenance?.package_version ?? "unavailable"}`);
console.log(`provenance_commit=${report.provenance?.openreaper_git_commit ?? "unavailable"}`);
console.log("important=REAPER must be started through OpenReaper for MCP live calls; a normal REAPER launch is not an OpenReaper MCP session.");
console.log("startup_lifetime=openreaper-start launches REAPER detached, records pid/log paths, and returns only after matching heartbeat plus a bounded public read probe.");
console.log("startup_dialog_assist=first use asks once|always|manual; consent covers only the exact safe allowlist; license/evaluation, recovery, plugin/FX, version, ambiguous, and unknown windows always fail closed.");
console.log("connection_probe=after bridge_ready, doctor uses MCP call_template(template.transport.read_state) before claiming request/response readiness.");
if (report.smoke?.ok) {
  console.log(`kernel=${report.smoke.openreaper.kernel}`);
  console.log(`tools=${report.smoke.openreaper.tool_surface.join(",")}`);
  console.log(`macros=${report.smoke.openreaper.required_macros.join(",")}`);
  console.log(`fx_templates=${report.smoke.openreaper.required_fx_templates.join(",")}`);
  if (vitalAgentIncluded) console.log(`vital_agent_tools=${report.smoke.vital_agent_mcp.required_tools.join(",")}`);
}
if (report.task) {
  console.log(`task_mode=${report.task.mode}`);
  console.log(`task_status=${report.task.status}`);
  console.log(`task_failure_layer=${report.task.failure_layer ?? "none"}`);
  console.log(`task_next_action=${report.task.next_action.instruction}`);
  if (report.task.safe_copy_paste_fix) console.log(`task_safe_fix=${report.task.safe_copy_paste_fix}`);
}
if (report.migration_actions.length > 0) {
  console.log("migration_needed=yes");
  for (const action of report.migration_actions) console.log(`migration_action=${action}`);
} else {
  console.log("migration_needed=no");
}
console.log(`next_agent_step=If live REAPER work is requested, run ${startCommand}; it automatically starts and verifies the Bridge. Use the REAPER action "${bridgeActionName}" only if startup reports that manual recovery fallback, then rerun Doctor.`);

if (cli.mode !== null && report.task?.status !== "ready") {
  process.exitCode = 1;
} else if (cli.wait_bridge_seconds !== null && report.request_response.ready !== true) {
  process.exitCode = 1;
}

async function pathCheck(filePath) {
  try {
    await access(filePath);
    return { ok: true, path: filePath };
  } catch {
    return { ok: false, path: filePath };
  }
}

async function readProvenanceManifest() {
  let handle;
  try {
    const before = await lstat(provenanceManifestPath);
    if (
      before.isSymbolicLink() ||
      !before.isFile() ||
      before.size < 1 ||
      before.size > provenanceManifestMaxBytes ||
      (before.mode & 0o222) !== 0 ||
      !Number.isInteger(fsConstants.O_NOFOLLOW)
    ) return { status: "invalid" };
    handle = await open(provenanceManifestPath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!sameFileSnapshot(before, opened)) return { status: "invalid" };
    const raw = await handle.readFile({ encoding: "utf8" });
    if (Buffer.byteLength(raw, "utf8") > provenanceManifestMaxBytes) return { status: "invalid" };
    const [finalHandle, finalPath] = await Promise.all([handle.stat(), lstat(provenanceManifestPath)]);
    if (finalPath.isSymbolicLink() || !sameFileSnapshot(opened, finalHandle) || !sameFileSnapshot(opened, finalPath)) {
      return { status: "invalid" };
    }
    const value = JSON.parse(raw);
    if (
      value?.contract !== "openreaper.package.provenance.v1" ||
      typeof value.package_version !== "string" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.package_version) || value.package_version === "0.0.0" ||
      typeof value.build_id !== "string" || value.build_id === "" ||
      !/^[0-9a-f]{40}$/u.test(value.openreaper_git_commit) ||
      typeof value.build_time_utc !== "string" || Number.isNaN(Date.parse(value.build_time_utc)) ||
      value.source_tree_clean !== true ||
      !["accepted_macro_count", "accepted_template_count", "bridge_handler_count"].every((key) =>
        Number.isSafeInteger(value[key]) && value[key] > 0)
      || value.exact_tool_count !== exactTools.length
      || JSON.stringify(value.exact_tools) !== JSON.stringify(exactTools)
      || value.executable_recipe_catalog_contract !== "recipe.executable.dependency_catalog.v1"
      || typeof value.executable_recipe_catalog_hash !== "string"
      || !/^[a-f0-9]{64}$/u.test(value.executable_recipe_catalog_hash)
    ) return { status: "invalid" };
    return {
      status: "ready",
      package_version: value.package_version,
      build_id: value.build_id,
      openreaper_git_commit: value.openreaper_git_commit,
      build_time_utc: value.build_time_utc,
      accepted_macro_count: value.accepted_macro_count,
      accepted_template_count: value.accepted_template_count,
      bridge_handler_count: value.bridge_handler_count,
      exact_tool_count: value.exact_tool_count,
      executable_recipe_catalog_hash: value.executable_recipe_catalog_hash,
    };
  } catch {
    return { status: "unavailable" };
  } finally {
    await handle?.close().catch(() => {});
  }
}

function sameFileSnapshot(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs
  );
}

function compactDoctorRecoveryCard(diagnosis, bridge, processEvidence) {
  const expected = bridge?.expected ?? {};
  const observed = bridge?.observed ?? {};
  const sameInstance = processEvidence?.running === true && processEvidence?.identity_verified === true && Number.isSafeInteger(processEvidence.pid) &&
    (diagnosis === "bridge_action_not_running" || diagnosis === "bridge_loop_unresponsive");
  const action = sameInstance
    ? `Verified REAPER PID ${processEvidence.pid} is alive, but OpenReaper cannot restart its stopped Bridge externally. In that same REAPER, run the Action "${bridgeActionName}", then rerun doctor; do not start another REAPER.`
    : diagnosis === "reaper_not_running"
    ? `Run ${startCommand}; it starts and verifies the Bridge automatically.`
    : diagnosis === "bridge_action_not_running"
      ? `Rerun ${startCommand}. If autonomous startup still reports this blocker, run the fallback Action "${bridgeActionName}" and rerun doctor.`
      : diagnosis === "bridge_loop_unresponsive"
        ? `In REAPER, rerun the Action "${bridgeActionName}" and rerun doctor; restart the session only if the heartbeat remains stale.`
        : diagnosis === "owner_generation_mismatch"
          ? "Reconnect the MCP client to the current OpenReaper session identity, then rerun doctor; restart the session only if the mismatch persists."
          : "Repair the reported OpenReaper precondition, then rerun doctor.";
  return {
    diagnosis: diagnosis ?? "not_observed",
    likely_cause: diagnosis === "bridge_loop_unresponsive"
      ? "The heartbeat is stale; it cannot distinguish a stopped Action from an unresponsive loop."
      : diagnosis === "bridge_action_not_running"
        ? "REAPER is present but the trusted package launcher has not produced a heartbeat."
        : diagnosis === "owner_generation_mismatch"
          ? "The heartbeat belongs to a different OpenReaper session identity."
          : diagnosis === "reaper_not_running"
            ? "The installed OpenReaper session has no verified running REAPER process."
            : "The OpenReaper live precondition is not ready.",
    ...(diagnosis === "owner_generation_mismatch" ? {
      expected_identity: { owner: expected.owner ?? null, generation: expected.generation ?? null },
      observed_identity: { owner: observed.owner ?? null, generation: observed.generation ?? null },
    } : {}),
    recovery: action,
    action_auto_run: false,
    ...(sameInstance ? {
      same_instance_recovery: {
        scope: "same_reaper_instance",
        reaper_pid: processEvidence.pid,
        identity_verified: true,
        duplicate_launch_forbidden: true,
        reaper_restart_allowed: false,
        automatic_bridge_restart_available: false,
        required_action: "run_registered_bridge_action",
      },
      reaper_pid: processEvidence.pid,
      reaper_identity_verified: true,
    } : {}),
  };
}

async function bridgeActionRegistrationCheck() {
  const text = await readTextIfExists(reaperKbPath);
  const source = text ?? "";
  return {
    ok: source.includes(`Custom: ${bridgeActionName}`) && source.includes("OpenReaper/openreaper-start-mcp-bridge.lua"),
    path: reaperKbPath,
    action_name: bridgeActionName,
  };
}

async function scanClientConfigs() {
  const configs = [
    { label: "Codex", path: path.join(home, ".codex", "config.toml"), type: "toml" },
    { label: "Cursor", path: path.join(home, ".cursor", "mcp.json"), type: "json" },
    { label: "Claude Desktop", path: path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), type: "json" },
  ];
  for (const config of configs) {
    const text = await readTextIfExists(config.path);
    const entry = {
      ...config,
      exists: text !== null,
      has_openreaper: false,
      has_vital_agent_mcp: false,
      references_current_mcp: false,
      references_current_vital_agent_mcp: false,
      stale_markers: [],
    };
    if (text !== null) {
      entry.has_openreaper = config.type === "toml"
        ? /\[mcp_servers\.openreaper\]/.test(text)
        : /"openreaper"\s*:/.test(text);
      entry.has_vital_agent_mcp = config.type === "toml"
        ? /\[mcp_servers\.vital-agent-mcp\]/.test(text)
        : /"vital-agent-mcp"\s*:/.test(text);
      entry.references_current_mcp = mcpCommandAliases.some((candidate) => text.includes(candidate));
      entry.references_current_vital_agent_mcp = vitalAgentMcpCommandAliases.some((candidate) => text.includes(candidate));
      entry.stale_markers = staleMarkers(text);
      for (const marker of entry.stale_markers) {
        report.stale_config_findings.push({
          config: config.label,
          path: config.path,
          marker,
        });
      }
    }
    report.client_configs.push(entry);
  }
}

function staleMarkers(text) {
  const markers = [];
  const checks = [
    ["legacy_streetlight_server", /streetlight-mcp|vendor\/streetlight-reaper-mcp|streetlight-reaper-mcp|packages\/mcp-server\/dist\/index\.js|\[mcp_servers\.streetlight\]|"streetlight"\s*:/i],
    ["old_openreaper_alpha_20260708", /openreaper-alpha-20260708|OpenReaper-alpha-20260708/i],
    ["old_streetlight_queue", /Streetlight\/queue/i],
  ];
  for (const [marker, pattern] of checks) {
    if (pattern.test(text)) markers.push(marker);
  }
  return markers;
}

function pathAliases(filePath) {
  const aliases = new Set([filePath]);
  if (filePath.startsWith("/private/tmp/")) {
    aliases.add(filePath.replace(/^\/private\/tmp\//, "/tmp/"));
  } else if (filePath.startsWith("/tmp/")) {
    aliases.add(filePath.replace(/^\/tmp\//, "/private/tmp/"));
  }
  return [...aliases];
}

async function smokeMcp() {
  const missing = Object.entries(report.checks)
    .filter(([, value]) => value && value.ok === false)
    .map(([key]) => key);
  if (missing.length > 0) {
    return { ok: false, reason: "required_path_missing", missing };
  }
  const smokeTimeoutMs = doctorSmokeTimeoutMs();
  try {
    return await withTimeout(smokeMcpInner(), smokeTimeoutMs, "MCP doctor smoke timed out", {
      onTimeout: () => cleanupAllMcpLifecycles("doctor_smoke_timeout"),
    });
  } catch (error) {
    return {
      ok: false,
      reason: "mcp_smoke_failed",
      error_code: boundedErrorCode(error),
      error_message: boundedErrorMessage(error),
    };
  }
}

async function smokeMcpInner() {
  const openreaper = await smokeOpenReaperMcpInner();
  const packageMcpCommand = await smokeOpenReaperMcpCommandInner();
  const vitalAgent = vitalAgentIncluded
    ? await smokeVitalAgentMcpInner()
    : { skipped: true, reason: "optional_companion_not_installed" };
  return {
    ok: packageMcpCommand.ok === true && (!vitalAgentIncluded || vitalAgent.ok === true),
    openreaper,
    package_mcp_command: packageMcpCommand,
    vital_agent_mcp: vitalAgent,
  };
}

async function smokeOpenReaperMcpCommandInner() {
  const packagePaths = [installRoot, path.join(installRoot, "node_modules")];
  const { Client, OwnedStdioClientTransport } = await loadOwnedMcpClientBindings(packagePaths);
  const client = new Client({ name: "openreaper-alpha-doctor-package-command", version: "0.0.0" });
  const validationRuntime = await createPackageCommandValidationRuntime();
  let lifecycle = null;
  try {
    const transport = new OwnedStdioClientTransport({
      command: mcpCommand,
      args: [],
      // Package reachability is intentionally independent of the selected live
      // session. Direct MCP above remains the only diagnosis of user roots.
      env: validationRuntime.env,
      stderr: "pipe",
    });
    lifecycle = createMcpLifecycle(client, transport, "packaged MCP command");
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assertExactArray(toolNames, exactTools, "packaged MCP command tool surface");
    const ping = parseJsonToolResult(await client.callTool({ name: "ping", arguments: {} }));
    if (ping.kernel !== "openreaper-mcp alpha kernel") {
      throw new Error(`expected packaged MCP command kernel, got ${ping.kernel}`);
    }
    return {
      ok: true,
      kernel: ping.kernel,
      tool_surface: toolNames,
      validation_scope: "isolated_package_runtime",
      render_root_status: ping.runtime_readiness?.render_root?.status ?? "not_observed",
    };
  } catch (error) {
    return {
      ok: false,
      reason: "package_mcp_command_failed",
      error_code: boundedErrorCode(error),
    };
  } finally {
    try {
      await lifecycle?.close("normal_finish");
    } finally {
      await validationRuntime.cleanup();
    }
  }
}

async function createPackageCommandValidationRuntime() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-doctor-package-"));
  try {
    await chmod(root, 0o700);
    const renderRoot = path.join(root, "renders");
    const transportRoot = path.join(root, "transport");
    const artifactRoot = path.join(root, "artifacts");
    const projectIndexRoot = path.join(root, "project-index");
    const recipeRoot = path.join(root, "executable-recipes");
    const directories = [renderRoot, transportRoot, artifactRoot, projectIndexRoot, recipeRoot];
    await Promise.all(directories.map((directory) => mkdir(directory, { mode: 0o700 })));
    await Promise.all(directories.map((directory) => chmod(directory, 0o700)));
    const env = {
      ...mcpEnv,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportRoot,
      OPENREAPER_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: projectIndexRoot,
      OPENREAPER_EXECUTABLE_RECIPE_ROOT: recipeRoot,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: `doctor-package:${path.basename(root)}`,
      OPENREAPER_CURRENT_PROJECT_REF: "project:doctor-package-validation",
    };
    delete env.OPENREAPER_CURRENT_PROJECT_PATH;
    return {
      env,
      cleanup: () => rm(root, { recursive: true, force: true }),
    };
  } catch (error) {
    await rm(root, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function smokeOpenReaperMcpInner() {
  const packagePaths = [installRoot, path.join(installRoot, "node_modules")];
  const { Client, OwnedStdioClientTransport } = await loadOwnedMcpClientBindings(packagePaths);
  const client = new Client({ name: "openreaper-alpha-doctor", version: "0.0.0" });
  const transport = new OwnedStdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: installRoot,
    env: mcpEnv,
    stderr: "pipe",
  });
  const lifecycle = createMcpLifecycle(client, transport, "OpenReaper MCP stdio");
  try {
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assertExactArray(toolNames, exactTools, "MCP tool surface");
    let ping = parseJsonToolResult(await client.callTool({ name: "ping", arguments: {} }));
    let waitPolls = 1;
    if (ping.kernel !== "openreaper-mcp alpha kernel") {
      throw new Error(`expected openreaper-mcp alpha kernel, got ${ping.kernel}`);
    }
    assertDiscoveredIds(
      parseJsonToolResult(await client.callTool({ name: "list_templates", arguments: { ids: requiredMacros } })),
      requiredMacros,
      "macro discovery",
    );
    assertDiscoveredIds(
      parseJsonToolResult(await client.callTool({ name: "list_templates", arguments: { ids: requiredFxTemplates } })),
      requiredFxTemplates,
      "FX template discovery",
    );

    if (cli.wait_bridge_seconds !== null && ping.runtime_readiness?.bridge?.status !== "bridge_ready") {
      const deadline = Date.now() + cli.wait_bridge_seconds * 1_000;
      while (Date.now() < deadline) {
        await sleep(200);
        ping = parseJsonToolResult(await client.callTool({ name: "ping", arguments: {} }));
        waitPolls += 1;
        if (ping.runtime_readiness?.bridge?.status === "bridge_ready") break;
      }
    }

    let requestResponse = {
      status: "not_run",
      ready: false,
      template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
    };
    if (
      (cli.mode !== null || cli.wait_bridge_seconds !== null) &&
      ping.runtime_readiness?.bridge?.status === "bridge_ready"
    ) {
      try {
        const probeResult = parseJsonToolResult(await withTimeout(
          client.callTool({
            name: "call_template",
            arguments: {
              id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
              input: {},
              refs: [],
              context: {
                session_id: "openreaper-doctor",
                expected_owner: identity.owner.value,
                expected_generation: identity.generation.value,
                request_sequence: 1,
              },
            },
          }),
          alpha3_2B3ReadProbeTimeoutMs(process.env) + 1_000,
          "OpenReaper read probe timed out",
        ));
        requestResponse = normalizeAlpha3_2B3RequestResponseProof(probeResult, identity);
      } catch (error) {
        requestResponse = {
          status: /timed out/i.test(String(error?.message ?? "")) ? "timeout" : "failed",
          ready: false,
          template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
          error_code: boundedErrorCode(error),
        };
      }
    }

    return {
      kernel: ping.kernel,
      tool_surface: toolNames,
      required_macros: requiredMacros,
      required_fx_templates: requiredFxTemplates,
      runtime_readiness: ping.runtime_readiness,
      project_index: ping.project_index ?? null,
      request_response: requestResponse,
      wait_bridge_polls: waitPolls,
    };
  } finally {
    await lifecycle.close("normal_finish");
  }
}

function projectIndexReadiness(index) {
  if (!index || index.lifecycle === "not_configured") {
    return {
      status: "not_configured",
      ready: false,
      next_action: "Run OpenReaper through the installed wrapper so the managed Project Index state root is configured.",
    };
  }
  if (index.lifecycle === "ready" && index.recovery?.status === "recovered") {
    return {
      status: "recovered_ready",
      ready: true,
      next_action: "The Project Index cache was rebuilt without reusing old rows; it helps navigation but REAPER remains the source of truth. Call macro.project.inspect or macro.project.query normally.",
    };
  }
  if (index.lifecycle === "ready" && index.snapshot_id === null) {
    return {
      status: "ready_cold",
      ready: true,
      next_action: "Call macro.project.inspect or macro.project.query; the first call performs bounded read-only hydration automatically.",
    };
  }
  if (index.lifecycle === "ready") {
    return {
      status: "ready_warm",
      ready: true,
      next_action: "Use macro.project.inspect or macro.project.query; matching fresh Project Index rows may be reused, but REAPER remains the source of truth.",
    };
  }
  return {
    status: index.lifecycle ?? "degraded",
    ready: false,
    next_action: "Restore the managed OpenReaper bridge/session, then retry macro.project.inspect or macro.project.query once.",
  };
}

async function smokeVitalAgentMcpInner() {
  const packagePaths = [installRoot, path.join(installRoot, "node_modules")];
  const { Client, OwnedStdioClientTransport } = await loadOwnedMcpClientBindings(packagePaths);
  const client = new Client({ name: "vital-agent-mcp-doctor", version: "0.0.0" });
  const transport = new OwnedStdioClientTransport({
    command: vitalAgentMcpCommand,
    args: [],
    env: {
      ...process.env,
      VITAL_AGENT_MCP_PACKAGE_ROOT: installRoot,
    },
    stderr: "pipe",
  });
  const lifecycle = createMcpLifecycle(client, transport, "vital-agent-mcp stdio");
  try {
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    for (const tool of vitalAgentRequiredTools) {
      if (!toolNames.includes(tool)) throw new Error(`vital-agent-mcp missing tool ${tool}`);
    }
    const doctor = parseJsonToolResult(await client.callTool({ name: "run_doctor", arguments: {} }));
    if (doctor.ok !== true) {
      throw new Error("vital-agent-mcp run_doctor did not report ok=true");
    }
    return {
      ok: true,
      required_tools: vitalAgentRequiredTools,
      doctor_schema: doctor.schema,
    };
  } finally {
    await lifecycle.close("normal_finish");
  }
}

function migrationActions() {
  const configRefreshNeeded = needsClientConfigRefresh();
  const legacyConfigFound = report.stale_config_findings.length > 0;
  if (!configRefreshNeeded && !legacyConfigFound) return [];
  const actions = [
    "Run the newer downloaded OpenReaper package's install.command directly to upgrade. Do not manually delete the existing OpenReaper install first.",
    `After install.command completes, run ${doctorCommand} and then restart the MCP client.`,
  ];
  if (legacyConfigFound) {
    actions.push(
      "Remove or disable legacy streetlight MCP server entries so agents choose server name openreaper.",
      "Do not register legacy Streetlight v0.1 kernel packages.",
    );
  }
  return actions;
}

function needsClientConfigRefresh() {
  return report.client_configs.some((config) =>
    (config.exists && config.has_openreaper && !config.references_current_mcp) ||
    (vitalAgentIncluded
      ? (config.exists && config.has_vital_agent_mcp && !config.references_current_vital_agent_mcp)
      : (config.exists && config.has_vital_agent_mcp)));
}

function computePackageStatus() {
  if (!report.checks.node.ok) return "not_ready_node_too_old";
  if (!report.smoke?.ok) return "not_ready_mcp_smoke_failed";
  if (needsClientConfigRefresh()) return "needs_client_config_refresh";
  if (report.stale_config_findings.length > 0) return "ready_with_legacy_config_warning";
  return "ready";
}

function runtimeDiagnosis(bridge, processEvidence) {
  if (bridge?.diagnosis === "bridge_action_not_running" && processEvidence?.running !== true) {
    return "reaper_not_running";
  }
  return bridge?.diagnosis ?? "not_observed";
}

function parseJsonToolResult(response) {
  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP tool response did not include text content");
  return JSON.parse(text);
}

function assertExactArray(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (actual.length !== expectedSorted.length || actual.some((value, index) => value !== expectedSorted[index])) {
    throw new Error(`${label} mismatch: expected ${expectedSorted.join(",")}; got ${actual.join(",")}`);
  }
}

function assertDiscoveredIds(response, expectedIds, label) {
  const actualIds = new Set((response.items ?? []).map((item) => item.id));
  for (const id of expectedIds) {
    if (!actualIds.has(id)) throw new Error(`${label} missing ${id}`);
  }
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

async function loadOwnedMcpClientBindings(packagePaths) {
  const [{ Client }, { ReadBuffer, serializeMessage }] = await Promise.all([
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js", { paths: packagePaths }))),
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/shared/stdio.js", { paths: packagePaths }))),
  ]);
  return {
    Client,
    OwnedStdioClientTransport: createOwnedStdioClientTransport({ ReadBuffer, serializeMessage }),
  };
}

function createOwnedStdioClientTransport({ ReadBuffer, serializeMessage }) {
  return class OwnedStdioClientTransport {
    constructor(server) {
      this._serverParams = server;
      this._readBuffer = new ReadBuffer();
      this._stderrStream = server.stderr === "pipe" || server.stderr === "overlapped"
        ? new PassThrough()
        : null;
      this._process = undefined;
      this._ownedProcess = undefined;
      this._ownedPgid = null;
      this._closePromise = null;
      this.onerror = undefined;
      this.onclose = undefined;
      this.onmessage = undefined;
    }

    get pid() {
      return this._process?.pid ?? this._ownedProcess?.pid ?? null;
    }

    get ownedPgid() {
      return this._ownedPgid;
    }

    get ownsProcessGroup() {
      return process.platform !== "win32" && this._ownedPgid !== null;
    }

    get stderr() {
      return this._stderrStream ?? this._process?.stderr ?? this._ownedProcess?.stderr ?? null;
    }

    async start() {
      if (this._process || this._ownedProcess) {
        throw new Error("OwnedStdioClientTransport already started! Client.connect() starts the transport automatically.");
      }
      const ownsProcessGroup = process.platform !== "win32";
      return new Promise((resolve, reject) => {
        let startSettled = false;
        const child = spawn(this._serverParams.command, this._serverParams.args ?? [], {
          env: this._serverParams.env ?? process.env,
          stdio: ["pipe", "pipe", this._serverParams.stderr ?? "inherit"],
          shell: false,
          detached: ownsProcessGroup,
          windowsHide: process.platform === "win32",
          cwd: this._serverParams.cwd,
        });
        this._process = child;
        this._ownedProcess = child;
        child.once("error", (error) => {
          if (!startSettled) {
            startSettled = true;
            reject(error);
          }
          this.onerror?.(error);
        });
        child.once("spawn", () => {
          if (ownsProcessGroup) {
            if (!Number.isSafeInteger(child.pid) || child.pid <= 0 || child.pid === process.pid) {
              const error = new Error("Owned MCP transport did not receive a safe detached process-group leader");
              if (!startSettled) {
                startSettled = true;
                reject(error);
              }
              this.onerror?.(error);
              return;
            }
            // POSIX detached children lead their own process group. Keep this durable
            // identity after the direct child closes so descendants are still reaped.
            this._ownedPgid = child.pid;
          }
          if (!startSettled) {
            startSettled = true;
            resolve();
          }
        });
        child.once("close", () => {
          if (this._process === child) this._process = undefined;
          this.onclose?.();
        });
        child.stdin?.on("error", (error) => this.onerror?.(error));
        child.stdout?.on("data", (chunk) => {
          this._readBuffer.append(chunk);
          this.processReadBuffer();
        });
        child.stdout?.on("error", (error) => this.onerror?.(error));
        if (this._stderrStream && child.stderr) child.stderr.pipe(this._stderrStream);
      });
    }

    processReadBuffer() {
      while (true) {
        try {
          const message = this._readBuffer.readMessage();
          if (message === null) break;
          this.onmessage?.(message);
        } catch (error) {
          this.onerror?.(error);
        }
      }
    }

    async close() {
      this._closePromise ??= this.closeProtocolStreams();
      return this._closePromise;
    }

    async closeProtocolStreams() {
      const child = this._process;
      this._process = undefined;
      this._readBuffer.clear();
      if (!child) return;
      try {
        child.stdin?.end();
      } catch {
        // Best effort only; lifecycle group cleanup follows.
      }
      try {
        child.stdout?.destroy();
      } catch {
        // Best effort only; lifecycle group cleanup follows.
      }
      try {
        child.stderr?.unpipe?.(this._stderrStream);
      } catch {
        // Best effort only; lifecycle group cleanup follows.
      }
      await settleWithin(new Promise((resolve) => child.once("close", resolve)), 200);
    }

    async terminateWindowsFallback(label) {
      if (process.platform !== "win32") {
        throw new Error(`${label} Windows direct-child fallback is unavailable on POSIX`);
      }
      const child = this._ownedProcess;
      if (!child || child.exitCode !== null) return;
      const waitForClose = () => settleWithin(new Promise((resolve) => child.once("close", resolve)), 750);
      try {
        child.kill("SIGTERM");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      if (await waitForClose()) return;
      try {
        child.kill("SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
      if (await settleWithin(new Promise((resolve) => child.once("close", resolve)), 1_000)) return;
      throw new Error(`${label} direct child did not exit after bounded Windows fallback cleanup`);
    }

    send(message) {
      return new Promise((resolve, reject) => {
        const stdin = this._process?.stdin;
        if (!stdin) {
          reject(new Error("Not connected"));
          return;
        }
        let json;
        try {
          json = serializeMessage(message);
        } catch (error) {
          reject(error);
          return;
        }
        const onError = (error) => {
          stdin.removeListener("drain", onDrain);
          reject(error);
        };
        const onDrain = () => {
          stdin.removeListener("error", onError);
          resolve();
        };
        stdin.once("error", onError);
        if (stdin.write(json)) onDrain();
        else stdin.once("drain", onDrain);
      });
    }
  };
}

function doctorSmokeTimeoutMs() {
  const configured = process.env.OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS;
  if (configured !== undefined && /^[1-9]\d{2,5}$/.test(configured)) {
    return Math.min(120_000, Math.max(1_000, Number(configured)));
  }
  return Math.max(
    10_000,
    (cli.wait_bridge_seconds ?? 0) * 1_000 + alpha3_2B3ReadProbeTimeoutMs(process.env) + 5_000,
  );
}

function createMcpLifecycle(client, transport, label) {
  let closePromise = null;
  const lifecycle = {
    async close(reason) {
      closePromise ??= closeMcpLifecycle({ client, transport, label, reason })
        .finally(() => activeMcpLifecycles.delete(lifecycle));
      return closePromise;
    },
  };
  activeMcpLifecycles.add(lifecycle);
  return lifecycle;
}

async function closeMcpLifecycle({ client, transport, label, reason }) {
  const clientClose = Promise.resolve().then(() => client.close?.());
  await settleWithin(clientClose, 500);
  const transportClose = Promise.resolve().then(() => transport.close?.());
  await settleWithin(transportClose, 250);
  await terminateOwnedMcpLifecycle(transport, `${label} (${reason})`);
  await settleWithin(Promise.allSettled([clientClose, transportClose]), 250);
}

async function cleanupAllMcpLifecycles(reason) {
  const cleanups = [...activeMcpLifecycles].map((lifecycle) => lifecycle.close(reason));
  const results = await Promise.allSettled(cleanups);
  const failures = results.filter((result) => result.status === "rejected").map((result) => result.reason);
  if (failures.length > 0) throw new AggregateError(failures, `MCP cleanup failed during ${reason}`);
}

async function terminateOwnedMcpLifecycle(transport, label) {
  if (transport.ownsProcessGroup === true) {
    const pgid = transport.ownedPgid;
    if (!Number.isSafeInteger(pgid) || pgid <= 0 || pgid === process.pid) {
      throw new Error(`${label} did not retain a safe owned MCP process group`);
    }
    await terminateOwnedProcessGroup(pgid, label);
    return;
  }
  if (process.platform !== "win32") {
    if (!Number.isSafeInteger(transport.pid) || transport.pid <= 0) return;
    throw new Error(`${label} did not start in an owned POSIX process group`);
  }
  await transport.terminateWindowsFallback(label);
}

async function terminateOwnedProcessGroup(pgid, label) {
  const target = -pgid;
  if (await waitForProcessGroupExit(target, 100)) return;
  signalOwnedProcessGroup(target, "SIGTERM");
  if (await waitForProcessGroupExit(target, 750)) return;
  signalOwnedProcessGroup(target, "SIGKILL");
  if (await waitForProcessGroupExit(target, 1_500)) return;
  throw new Error(`${label} owned process group ${pgid} did not exit after bounded TERM/KILL cleanup`);
}

function signalOwnedProcessGroup(target, signal) {
  try {
    process.kill(target, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

async function waitForProcessGroupExit(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      process.kill(target, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await sleep(20);
  } while (Date.now() < deadline);
  try {
    process.kill(target, 0);
    return false;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function settleWithin(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise.then(() => true, () => true),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve(false), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function withTimeout(promise, ms, message, { onTimeout = null } = {}) {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      callback(value);
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void (async () => {
        let cleanupError = null;
        try {
          await onTimeout?.();
        } catch (error) {
          cleanupError = error;
        }
        const timeoutError = new Error(message, cleanupError === null ? undefined : { cause: cleanupError });
        timeoutError.code = "OPENREAPER_DOCTOR_TIMEOUT";
        reject(timeoutError);
      })();
    }, ms);
    promise.then(
      (value) => finish(resolve, value),
      (error) => finish(reject, error),
    );
  });
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function boundedErrorCode(error) {
  const value = error?.code ?? error?.name ?? "ERROR";
  return String(value).replace(/[^A-Za-z0-9_.:-]/gu, "_").slice(0, 64);
}

function boundedErrorMessage(error) {
  return String(error?.message ?? error ?? "MCP doctor smoke failed")
    .replace(/[\u0000-\u001f\u007f]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, 320);
}
NODE
