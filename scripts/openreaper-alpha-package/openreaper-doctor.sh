#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
SESSION_ROOT="${OPENREAPER_SESSION_ROOT:-${INSTALL_ROOT}/session}"
TRANSPORT_DIR="${OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR:-${SESSION_ROOT}/transport}"
ARTIFACT_ROOT="${OPENREAPER_ARTIFACT_ROOT:-${OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT:-${SESSION_ROOT}/artifacts}}"

mkdir -p "${TRANSPORT_DIR}/requests" "${TRANSPORT_DIR}/results" "${ARTIFACT_ROOT}"

export OPENREAPER_DOCTOR_INSTALL_ROOT="${INSTALL_ROOT}"
export OPENREAPER_DOCTOR_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_DOCTOR_ARTIFACT_ROOT="${ARTIFACT_ROOT}"

node --input-type=module <<'NODE'
import { createRequire } from "node:module";
import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const home = os.homedir();
const installRoot = process.env.OPENREAPER_DOCTOR_INSTALL_ROOT;
const transportDir = process.env.OPENREAPER_DOCTOR_TRANSPORT_DIR;
const artifactRoot = process.env.OPENREAPER_DOCTOR_ARTIFACT_ROOT;
const mcpCommand = path.join(installRoot, "bin", "openreaper-mcp");
const vitalAgentMcpCommand = path.join(installRoot, "bin", "vital-agent-mcp");
const mcpCommandAliases = pathAliases(mcpCommand);
const vitalAgentMcpCommandAliases = pathAliases(vitalAgentMcpCommand);
const startCommand = path.join(installRoot, "bin", "openreaper-start");
const doctorCommand = path.join(installRoot, "bin", "openreaper-doctor");
const serverScript = path.join(installRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs");
const vitalAgentServerScript = path.join(installRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js");
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
const bridgeActionName = "OpenReaper: Start MCP bridge";
const bridgeActionScript = path.join(home, "Library", "Application Support", "REAPER", "Scripts", "OpenReaper", "openreaper-start-mcp-bridge.lua");
const reaperKbPath = path.join(home, "Library", "Application Support", "REAPER", "reaper-kb.ini");
const exactTools = ["call_template", "get_state", "list_recipes", "list_templates", "ping"];
const vitalAgentRequiredTools = ["create_openreaper_handoff_plan", "run_doctor"];
const requiredMacros = ["macro.index_status", "macro.query_tracks"];
const requiredFxTemplates = [
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.read_fx_parameter",
];

const report = {
  product: "OpenReaper alpha",
  contract: "openreaper.alpha.doctor_report.v1",
  install_root: installRoot,
  mcp_server_names: ["openreaper", "vital-agent-mcp"],
  commands: {
    mcp: mcpCommand,
    vital_agent_mcp: vitalAgentMcpCommand,
    start_reaper_for_mcp: startCommand,
  },
  bridge_action: {
    name: bridgeActionName,
    script: bridgeActionScript,
    agent_should_try_to_run_action: true,
    user_fallback: `In REAPER, open Actions, search "${bridgeActionName}", click Run, then ask the agent to reconnect.`,
    verification_probe: "call_template(template.transport.read_state)",
    sws_required: false,
  },
  startup_dialog_assist: {
    auto_dismisses: ["Project Settings / Notes show notes on project load"],
    does_not_dismiss: ["license/evaluation", "recovery", "plugin/FX", "version", "unknown REAPER windows"],
    if_not_connected: "Check whether REAPER has a window waiting for agent/user action; resolve it, run the bridge action, reconnect, then run the live read probe.",
  },
  checks: {},
  client_configs: [],
  stale_config_findings: [],
  migration_actions: [],
  smoke: null,
  status: "unknown",
};

report.checks.node = {
  version: process.version,
  ok: Number(process.versions.node.split(".")[0]) >= 20,
};
report.checks.mcp_command = await pathCheck(mcpCommand);
report.checks.vital_agent_mcp_command = await pathCheck(vitalAgentMcpCommand);
report.checks.server_script = await pathCheck(serverScript);
report.checks.vital_agent_server_script = await pathCheck(vitalAgentServerScript);
report.checks.bridge_script = await pathCheck(bridgeScript);
report.checks.bridge_action_script = await pathCheck(bridgeActionScript);
report.checks.bridge_action_registration = await bridgeActionRegistrationCheck();
report.checks.sdk = await pathCheck(path.join(installRoot, "node_modules", "@modelcontextprotocol", "sdk", "package.json"));
report.checks.zod = await pathCheck(path.join(installRoot, "node_modules", "zod", "package.json"));

await scanClientConfigs();
report.smoke = await smokeMcp();
report.migration_actions = migrationActions();
report.status = computeStatus();

console.log(JSON.stringify(report, null, 2));
console.log("");
console.log("OpenReaper doctor agent report");
console.log(`status=${report.status}`);
console.log("mcp_server_names=openreaper,vital-agent-mcp");
console.log(`mcp_command=${mcpCommand}`);
console.log(`vital_agent_mcp_command=${vitalAgentMcpCommand}`);
console.log(`start_reaper_for_mcp=${startCommand}`);
console.log(`bridge_action=${bridgeActionName}`);
console.log(`bridge_action_script=${bridgeActionScript}`);
console.log("important=REAPER must be started through OpenReaper for MCP live calls; a normal REAPER launch is not an OpenReaper MCP session.");
console.log("startup_lifetime=openreaper-start launches REAPER detached from the agent shell and returns a pid/log path.");
console.log("startup_dialog_assist=only Project Settings / Notes show-notes-on-load is auto-dismissed; license/evaluation, recovery, plugin/FX, version, and unknown windows require agent/user action.");
console.log("connection_probe=after the bridge action and MCP reconnect, run call_template(template.transport.read_state) before claiming live bridge connection.");
if (report.smoke?.ok) {
  console.log(`kernel=${report.smoke.openreaper.kernel}`);
  console.log(`tools=${report.smoke.openreaper.tool_surface.join(",")}`);
  console.log(`macros=${report.smoke.openreaper.required_macros.join(",")}`);
  console.log(`fx_templates=${report.smoke.openreaper.required_fx_templates.join(",")}`);
  console.log(`vital_agent_tools=${report.smoke.vital_agent_mcp.required_tools.join(",")}`);
}
if (report.migration_actions.length > 0) {
  console.log("migration_needed=yes");
  for (const action of report.migration_actions) console.log(`migration_action=${action}`);
} else {
  console.log("migration_needed=no");
}
console.log(`next_agent_step=If live REAPER work is requested, run the start_reaper_for_mcp command. After REAPER opens, try to run the REAPER action "${bridgeActionName}". If the agent cannot operate the REAPER UI, ask the user to open Actions, search "${bridgeActionName}", click Run, then reconnect through MCP server openreaper and run call_template(template.transport.read_state). If the probe does not return, check for REAPER windows waiting for action and ask the user to resolve them.`);

async function pathCheck(filePath) {
  try {
    await access(filePath);
    return { ok: true, path: filePath };
  } catch {
    return { ok: false, path: filePath };
  }
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
  try {
    return await withTimeout(smokeMcpInner(), 8000, "MCP doctor smoke timed out");
  } catch (error) {
    return { ok: false, reason: "mcp_smoke_failed", error: error.message };
  }
}

async function smokeMcpInner() {
  const openreaper = await smokeOpenReaperMcpInner();
  const vitalAgent = await smokeVitalAgentMcpInner();
  return {
    ok: true,
    openreaper,
    vital_agent_mcp: vitalAgent,
  };
}

async function smokeOpenReaperMcpInner() {
  const packagePaths = [installRoot, path.join(installRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js", { paths: packagePaths }))),
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js", { paths: packagePaths }))),
  ]);
  const client = new Client({ name: "openreaper-alpha-doctor", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: mcpCommand,
    args: [],
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
      OPENREAPER_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha-doctor",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assertExactArray(toolNames, exactTools, "MCP tool surface");
    const ping = parseJsonToolResult(await client.callTool({ name: "ping", arguments: {} }));
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
    return {
      kernel: ping.kernel,
      tool_surface: toolNames,
      required_macros: requiredMacros,
      required_fx_templates: requiredFxTemplates,
    };
  } finally {
    await client.close?.();
  }
}

async function smokeVitalAgentMcpInner() {
  const packagePaths = [installRoot, path.join(installRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/index.js", { paths: packagePaths }))),
    import(pathToFileURL(require.resolve("@modelcontextprotocol/sdk/client/stdio.js", { paths: packagePaths }))),
  ]);
  const client = new Client({ name: "vital-agent-mcp-doctor", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: vitalAgentMcpCommand,
    args: [],
    env: {
      ...process.env,
      VITAL_AGENT_MCP_PACKAGE_ROOT: installRoot,
    },
    stderr: "pipe",
  });
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
      required_tools: vitalAgentRequiredTools,
      doctor_schema: doctor.schema,
    };
  } finally {
    await client.close?.();
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
    (config.exists && config.has_vital_agent_mcp && !config.references_current_vital_agent_mcp));
}

function computeStatus() {
  if (!report.checks.node.ok) return "not_ready_node_too_old";
  if (!report.smoke?.ok) return "not_ready_mcp_smoke_failed";
  if (needsClientConfigRefresh()) return "needs_client_config_refresh";
  if (report.stale_config_findings.length > 0) return "ready_with_legacy_config_warning";
  return "ready";
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

function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
NODE
