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
const startCommand = path.join(installRoot, "bin", "openreaper-start");
const serverScript = path.join(installRoot, "vendor", "openreaper-kernel", "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs");
const vitalAgentServerScript = path.join(installRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js");
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
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
console.log("important=REAPER must be started through OpenReaper for MCP live calls; a normal REAPER launch is not an OpenReaper MCP session.");
if (report.smoke?.ok) {
  console.log(`kernel=${report.smoke.openreaper.kernel}`);
  console.log(`tools=${report.smoke.openreaper.tool_surface.join(",")}`);
  console.log(`macros=${report.smoke.openreaper.required_macros.join(",")}`);
  console.log(`fx_templates=${report.smoke.openreaper.required_fx_templates.join(",")}`);
  console.log(`vital_agent_tools=${report.smoke.vital_agent_mcp.required_tools.join(",")}`);
}
if (report.stale_config_findings.length > 0) {
  console.log("migration_needed=yes");
  for (const action of report.migration_actions) console.log(`migration_action=${action}`);
} else {
  console.log("migration_needed=no");
}
console.log("next_agent_step=If live REAPER work is requested, run the start_reaper_for_mcp command, dismiss any REAPER startup/version/recovery/plugin dialog, then reconnect through MCP server openreaper.");

async function pathCheck(filePath) {
  try {
    await access(filePath);
    return { ok: true, path: filePath };
  } catch {
    return { ok: false, path: filePath };
  }
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
      entry.references_current_mcp = text.includes(mcpCommand);
      entry.references_current_vital_agent_mcp = text.includes(vitalAgentMcpCommand);
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
  if (report.stale_config_findings.length === 0) return [];
  return [
    "Run the current OpenReaper alpha install.command again, then restart the MCP client.",
    "Remove or disable legacy streetlight MCP server entries so agents choose server name openreaper.",
    "Do not register packages that start with [streetlight-mcp] v0.1 kernel.",
  ];
}

function computeStatus() {
  if (!report.checks.node.ok) return "not_ready_node_too_old";
  if (!report.smoke?.ok) return "not_ready_mcp_smoke_failed";
  if (report.client_configs.some((config) => config.exists && config.has_openreaper && !config.references_current_mcp)) {
    return "needs_client_config_refresh";
  }
  if (report.client_configs.some((config) => config.exists && config.has_vital_agent_mcp && !config.references_current_vital_agent_mcp)) {
    return "needs_client_config_refresh";
  }
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
