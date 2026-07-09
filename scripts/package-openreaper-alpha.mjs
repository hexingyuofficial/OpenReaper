#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
const options = parseArgs(process.argv.slice(2));
const vitalAgentRoot = path.resolve(options.vital_agent_root ?? path.join(repoRoot, "..", "vital-agent-mcp"));
const version = safeToken(options.version, `alpha-${compactTimestamp(new Date())}`);
const outDir = path.resolve(options.out_dir ?? path.join(repoRoot, "dist", `openreaper-${version}`));
const packageRoot = path.join(outDir, "OpenReaper-alpha");
const skipZip = options.skip_zip === true;
const skipSmoke = options.skip_smoke === true;
const EXACT_MCP_TOOLS = Object.freeze([
  "call_template",
  "get_state",
  "list_recipes",
  "list_templates",
  "ping",
]);
const REQUIRED_MACRO_IDS = Object.freeze([
  "macro.index_status",
  "macro.query_tracks",
]);
const REQUIRED_FX_TEMPLATE_IDS = Object.freeze([
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.read_fx_parameter",
]);
const REQUIRED_EXECUTABLE_TEMPLATE_ID = "template.tracks.create_track";
const REQUIRED_INSTALLED_START_COMMAND = "~/.openreaper/current/bin/openreaper-start";
const REQUIRED_INSTALLED_PROJECT_START_COMMAND =
  "~/.openreaper/current/bin/openreaper-start --project-path /path/to/project.RPP";
const REQUIRED_PROJECT_INDEX_USER_FLOW_CONTRACT = "alpha3.1.l3.project_index_user_flow.v1";
const REQUIRED_MACRO_EXECUTION_CONVENIENCE_CONTRACT = "alpha3.1.l4.macro_execution_convenience.v1";
const VITAL_AGENT_REQUIRED_TOOLS = Object.freeze([
  "create_openreaper_handoff_plan",
  "run_doctor",
]);

await assertReadable(path.join(repoRoot, "packages", "mcp-server", "src", "openreaper-mcp-stdio.mjs"));
await assertReadable(path.join(repoRoot, "reaper", "bridge", "openreaper-live-bridge.lua"));
await assertReadable(path.join(vitalAgentRoot, "package.json"));
await assertReadable(path.join(vitalAgentRoot, "src", "mcpServer.ts"));

await replaceOutputDir(outDir);
await mkdir(packageRoot, { recursive: true });
await mkdir(path.join(packageRoot, "bin"), { recursive: true });
await mkdir(path.join(packageRoot, "installer"), { recursive: true });
await mkdir(path.join(packageRoot, "vendor", "openreaper-kernel"), { recursive: true });

await copyInstallerTemplates();
await copyOpenReaperKernel();
await copyVitalAgentCompanion();
await installPackageDependencies();
await installVitalAgentCompanion();
await writePackageEntrypoints();
await writeReadme();
await removeDsStore(packageRoot);
const smoke = {
  installer_upgrade_migration: await smokePackagedInstallerUpgradeMigration(),
  openreaper_start_helper: await smokePackagedOpenReaperStartHelper(),
  openreaper: await smokePackagedOpenReaperMcp(),
  vital_agent_mcp: await smokePackagedVitalAgentMcp(),
};

let zipPath = null;
if (!skipZip) {
  zipPath = path.join(outDir, `OpenReaper-${version}-macOS-alpha.zip`);
  await removeDsStore(packageRoot);
  await zipPackage(zipPath);
  await removeDsStore(packageRoot);
}

console.log(JSON.stringify({
  ok: true,
  contract: "openreaper.alpha.package_result.v1",
  version,
  package_root: packageRoot,
  zip_path: zipPath,
  bundled_runtime: {
    mcp_server: "vendor/openreaper-kernel/packages/mcp-server/src/openreaper-mcp-stdio.mjs",
    bridge: "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua",
    companion_mcp: "vendor/vital-agent-mcp/dist/src/mcpServer.js",
    entrypoints: ["bin/openreaper-mcp", "bin/vital-agent-mcp", "bin/openreaper-start", "bin/openreaper-doctor"],
    dependency_source: "package_root_npm_install",
  },
  smoke,
  install: {
    command: "double-click install.command or run ./install.command",
    default_install_root: "~/.openreaper/current",
    mcp_server_name: "openreaper",
    startup_requirement: "REAPER must be started through openreaper-start for MCP to connect.",
  },
}, null, 2));

async function copyInstallerTemplates() {
  const templateRoot = path.join(repoRoot, "scripts", "openreaper-alpha-package");
  await cp(path.join(templateRoot, "install-openreaper.mjs"), path.join(packageRoot, "installer", "install-openreaper.mjs"));
  await cp(path.join(templateRoot, "uninstall-openreaper.mjs"), path.join(packageRoot, "installer", "uninstall-openreaper.mjs"));
  await cp(path.join(templateRoot, "openreaper-mcp.sh"), path.join(packageRoot, "bin", "openreaper-mcp"));
  await cp(path.join(templateRoot, "openreaper-start.sh"), path.join(packageRoot, "bin", "openreaper-start"));
  await cp(path.join(templateRoot, "openreaper-doctor.sh"), path.join(packageRoot, "bin", "openreaper-doctor"));
  await chmod(path.join(packageRoot, "bin", "openreaper-mcp"), 0o755);
  await chmod(path.join(packageRoot, "bin", "openreaper-start"), 0o755);
  await chmod(path.join(packageRoot, "bin", "openreaper-doctor"), 0o755);
}

async function copyOpenReaperKernel() {
  const target = path.join(packageRoot, "vendor", "openreaper-kernel");
  await cp(path.join(repoRoot, "package.json"), path.join(target, "package.json"));
  await cp(path.join(repoRoot, "packages"), path.join(target, "packages"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "recipes"), path.join(target, "recipes"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "reaper"), path.join(target, "reaper"), {
    recursive: true,
    filter: packageFilter,
  });
  await cp(path.join(repoRoot, "scripts", "start-openreaper-alpha3.mjs"), path.join(target, "scripts", "start-openreaper-alpha3.mjs")).catch(async () => {
    await mkdir(path.join(target, "scripts"), { recursive: true });
    await cp(path.join(repoRoot, "scripts", "start-openreaper-alpha3.mjs"), path.join(target, "scripts", "start-openreaper-alpha3.mjs"));
  });
}

async function copyVitalAgentCompanion() {
  const target = path.join(packageRoot, "vendor", "vital-agent-mcp");
  await cp(vitalAgentRoot, target, {
    recursive: true,
    filter: vitalAgentPackageFilter,
  });
}

async function installPackageDependencies() {
  await writeFile(path.join(packageRoot, "package.json"), `${JSON.stringify({
    name: "openreaper-alpha-package",
    version: "0.0.0",
    private: true,
    type: "module",
    dependencies: {
      "@modelcontextprotocol/sdk": "^1.29.0",
      "zod": "^3.25.76",
    },
  }, null, 2)}\n`, "utf8");
  await run("npm", ["install", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: packageRoot,
  });
}

async function installVitalAgentCompanion() {
  const companionRoot = path.join(packageRoot, "vendor", "vital-agent-mcp");
  await run("npm", ["install", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: companionRoot,
  });
  await run("npm", ["run", "build"], {
    cwd: companionRoot,
  });
  await run("npm", ["prune", "--omit=dev", "--ignore-scripts", "--no-audit", "--no-fund"], {
    cwd: companionRoot,
  });
}

async function writePackageEntrypoints() {
  const installCommand = `#!/bin/zsh
set -euo pipefail
cd "\${0:A:h}"
exec node "./installer/install-openreaper.mjs" "$@"
`;
  const uninstallCommand = `#!/bin/zsh
set -euo pipefail
cd "\${0:A:h}"
exec node "./installer/uninstall-openreaper.mjs" "$@"
`;
  const vitalAgentMcp = `#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="\${0:A:h}"
INSTALL_ROOT="\${SCRIPT_DIR:h}"
COMPANION_ROOT="\${INSTALL_ROOT}/vendor/vital-agent-mcp"

export VITAL_AGENT_MCP_PACKAGE_ROOT="\${INSTALL_ROOT}"

cd "\${COMPANION_ROOT}"
exec node "\${COMPANION_ROOT}/dist/src/mcpServer.js" "$@"
`;
  await writeFile(path.join(packageRoot, "install.command"), installCommand, "utf8");
  await writeFile(path.join(packageRoot, "uninstall.command"), uninstallCommand, "utf8");
  await writeFile(path.join(packageRoot, "bin", "vital-agent-mcp"), vitalAgentMcp, "utf8");
  await chmod(path.join(packageRoot, "install.command"), 0o755);
  await chmod(path.join(packageRoot, "uninstall.command"), 0o755);
  await chmod(path.join(packageRoot, "bin", "vital-agent-mcp"), 0o755);
}

async function writeReadme() {
  const readme = `OpenReaper macOS alpha package

What this package does:
- installs OpenReaper alpha to ~/.openreaper/current
- registers MCP server name "openreaper" for Codex, Cursor, and Claude Desktop where their config files live at standard macOS paths
- writes MCP config snippets for other clients, including Trae, under ~/.openreaper/current/config-snippets
- installs a conditional REAPER startup hook that is inert for normal REAPER launches
- provides ~/.openreaper/current/bin/openreaper-start for REAPER sessions that MCP can connect to
- provides companion MCP server "vital-agent-mcp" for Vital planning and OpenReaper handoff plans

Important:
REAPER must be started through OpenReaper for MCP to connect. Normal double-click REAPER launches are not OpenReaper MCP sessions.

Install:
Double-click install.command, or run:
  ./install.command

Start REAPER:
  ~/.openreaper/current/bin/openreaper-start
  ~/.openreaper/current/bin/openreaper-start --project-path /path/to/project.RPP

After install:
Restart Codex, Cursor, Claude, or your MCP client so it reloads MCP config. Then ask:
  Open REAPER with OpenReaper and inspect the current project.

If REAPER shows a startup/version/recovery/plugin dialog, dismiss it and ask the agent to reconnect.

Uninstall:
  ./uninstall.command

Alpha caveat:
The external product name and MCP server name are OpenReaper. This package uses the OpenReaper alpha stdio MCP kernel from vendor/openreaper-kernel. Some live REAPER execution paths remain evidence-gated; discovery and Alpha3 macro planning are available through list_templates and call_template.
The companion vital-agent-mcp server is plan-only and does not execute REAPER or Vital writes.
`;
  await writeFile(path.join(packageRoot, "README.txt"), readme, "utf8");
}

async function zipPackage(zipPath) {
  await rm(zipPath, { force: true });
  await run("zip", ["-q", "-r", "-X", zipPath, "OpenReaper-alpha"], {
    cwd: outDir,
  });
}

async function smokePackagedOpenReaperMcp() {
  if (skipSmoke) {
    return {
      skipped: true,
      reason: "skip_smoke",
    };
  }

  const packagePaths = [packageRoot, path.join(packageRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    importPackageModule("@modelcontextprotocol/sdk/client/index.js", packagePaths),
    importPackageModule("@modelcontextprotocol/sdk/client/stdio.js", packagePaths),
  ]);
  const artifactRoot = path.join(packageRoot, "session", "artifacts");
  const transportDir = path.join(packageRoot, "session", "transport");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });

  const client = new Client({
    name: "openreaper-alpha-package-smoke",
    version: "0.0.0",
  });
  const transport = new StdioClientTransport({
    command: path.join(packageRoot, "bin", "openreaper-mcp"),
    args: [],
    env: {
      ...process.env,
      OPENREAPER_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(
        packageRoot,
        "vendor",
        "openreaper-kernel",
        "reaper",
        "bridge",
        "openreaper-live-bridge.lua",
      ),
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha-package-smoke",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    },
  });

  try {
    await client.connect(transport);
    const toolResponse = await client.listTools();
    const toolNames = (toolResponse.tools ?? []).map((tool) => tool.name).sort();
    assertExactArray(toolNames, EXACT_MCP_TOOLS, "MCP tool surface");
    const ping = parseJsonToolResult(await client.callTool({
      name: "ping",
      arguments: {},
    }));
    if (ping.kernel !== "openreaper-mcp alpha kernel") {
      throw new Error(`Packaged MCP ping kernel mismatch: ${ping.kernel}`);
    }
    assertAgentStartupGuidance(ping.agent_startup_guidance, {
      label: "Packaged MCP ping startup guidance",
      expectedPackageRoot: packageRoot,
    });
    const macroResponse = await client.callTool({
      name: "list_templates",
      arguments: {
        ids: [...REQUIRED_MACRO_IDS],
      },
    });
    const macros = parseJsonToolResult(macroResponse);
    assertDiscoveredIds(macros, REQUIRED_MACRO_IDS, "Packaged MCP macro smoke");
    assertAgentStartupGuidance(macros.product_surface?.agent_startup_guidance_snapshot, {
      label: "Packaged MCP list_templates startup guidance",
      expectedPackageRoot: null,
    });
    assertProjectIndexUserFlow(macros.product_surface?.project_index_user_flow_snapshot);
    assertMacroExecutionConvenience(macros.product_surface?.macro_execution_convenience_snapshot);
    const fxTemplateResponse = await client.callTool({
      name: "list_templates",
      arguments: {
        ids: [...REQUIRED_FX_TEMPLATE_IDS],
      },
    });
    const fxTemplates = parseJsonToolResult(fxTemplateResponse);
    assertDiscoveredIds(fxTemplates, REQUIRED_FX_TEMPLATE_IDS, "Packaged MCP FX template smoke");
    const executableAllowlistSmoke = await smokeExecutableLiveAllowlist(client);
    return {
      ok: true,
      tool_surface: toolNames,
      kernel: ping.kernel,
      required_macros: [...REQUIRED_MACRO_IDS],
      required_fx_templates: [...REQUIRED_FX_TEMPLATE_IDS],
      agent_startup_guidance: {
        installed_start_reaper_for_mcp: ping.agent_startup_guidance.commands.installed_start_reaper_for_mcp,
        installed_start_project_for_mcp: ping.agent_startup_guidance.commands.installed_start_project_for_mcp,
        current_package_start_reaper_for_mcp: ping.agent_startup_guidance.commands.current_package_start_reaper_for_mcp,
        normal_reaper_launch_supported: ping.agent_startup_guidance.requirements.normal_reaper_launch_supported,
        only_openreaper_startup_supported: ping.agent_startup_guidance.requirements.only_openreaper_startup_supported,
      },
      project_index_user_flow: {
        contract: macros.product_surface.project_index_user_flow_snapshot.contract,
        primary_macro_ids: macros.product_surface.project_index_user_flow_snapshot.primary_macro_ids,
        hidden_executor: macros.product_surface.project_index_user_flow_snapshot.safety.hidden_executor,
        raw_sql_exposed: macros.product_surface.project_index_user_flow_snapshot.safety.raw_sql_exposed,
      },
      macro_execution_convenience: {
        contract: macros.product_surface.macro_execution_convenience_snapshot.contract,
        server_executes_children: macros.product_surface.macro_execution_convenience_snapshot.safety.server_executes_children,
        hidden_executor: macros.product_surface.macro_execution_convenience_snapshot.safety.hidden_executor,
        success_wording_requires_readback:
          macros.product_surface.macro_execution_convenience_snapshot.safety.success_wording_requires_readback,
      },
      executable_allowlist: executableAllowlistSmoke,
    };
  } finally {
    await client.close?.();
  }
}

async function smokePackagedOpenReaperStartHelper() {
  const startHelperPath = path.join(packageRoot, "bin", "openreaper-start");
  const source = await readFile(startHelperPath, "utf8");
  if (source.includes("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR by default");
  }
  if (source.includes("OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT by default");
  }
  if (source.includes("OPENREAPER_SESSION_ROOT:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_SESSION_ROOT by default");
  }
  if (source.includes("OPENREAPER_LIVE_BRIDGE_OWNER:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_LIVE_BRIDGE_OWNER by default");
  }
  if (source.includes("OPENREAPER_LIVE_BRIDGE_GENERATION:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_LIVE_BRIDGE_GENERATION by default");
  }
  for (const required of ["--session-root", "--transport-dir", "--artifact-root", "--bridge-owner", "--bridge-generation"]) {
    if (!source.includes(required)) {
      throw new Error(`openreaper-start missing explicit bounded evidence option ${required}`);
    }
  }
  return {
    ok: true,
    default_session_root: "package_root/session",
    ignores_stale_low_level_env: true,
    explicit_override_options: ["--session-root", "--transport-dir", "--artifact-root", "--bridge-owner", "--bridge-generation"],
  };
}

async function smokePackagedInstallerUpgradeMigration() {
  const installerPath = path.join(packageRoot, "installer", "install-openreaper.mjs");
  const source = await readFile(installerPath, "utf8");
  const requiredSnippets = [
    "replaceInstallRoot",
    "removeLegacyOpenReaperTomlSections",
    "LEGACY_STARTUP_BLOCKS",
    "OpenReaper Alpha3 MCP startup hook",
    "Streetlight MCP startup hook",
    "removeMarkedBlocks",
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      throw new Error(`Packaged installer missing upgrade migration guard: ${snippet}`);
    }
  }
  return {
    ok: true,
    running_install_root_replacement: "rename_first",
    removes_legacy_mcp_config: true,
    removes_legacy_startup_hooks: true,
  };
}

async function smokePackagedVitalAgentMcp() {
  if (skipSmoke) {
    return {
      skipped: true,
      reason: "skip_smoke",
    };
  }

  const packagePaths = [packageRoot, path.join(packageRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    importPackageModule("@modelcontextprotocol/sdk/client/index.js", packagePaths),
    importPackageModule("@modelcontextprotocol/sdk/client/stdio.js", packagePaths),
  ]);
  const client = new Client({
    name: "vital-agent-package-smoke",
    version: "0.0.0",
  });
  const transport = new StdioClientTransport({
    command: path.join(packageRoot, "bin", "vital-agent-mcp"),
    args: [],
    env: {
      ...process.env,
      VITAL_AGENT_MCP_PACKAGE_ROOT: packageRoot,
    },
  });

  try {
    await client.connect(transport);
    const toolResponse = await client.listTools();
    const toolNames = (toolResponse.tools ?? []).map((tool) => tool.name).sort();
    for (const tool of VITAL_AGENT_REQUIRED_TOOLS) {
      if (!toolNames.includes(tool)) {
        throw new Error(`Packaged vital-agent-mcp missing tool ${tool}`);
      }
    }
    const doctor = parseJsonToolResult(await client.callTool({
      name: "run_doctor",
      arguments: {},
    }));
    if (doctor.ok !== true) {
      throw new Error("Packaged vital-agent-mcp doctor did not report ok=true");
    }
    const handoff = parseJsonToolResult(await client.callTool({
      name: "create_openreaper_handoff_plan",
      arguments: {
        bundle: minimalResolvedVitalBundle(),
        fx_ref: "track:1/fx:Vital",
      },
    }));
    if (handoff.ok !== true || handoff.mode !== "plan_only_no_live_reaper_calls") {
      throw new Error("Packaged vital-agent-mcp handoff smoke did not return an ok plan-only handoff");
    }
    return {
      ok: true,
      required_tools: [...VITAL_AGENT_REQUIRED_TOOLS],
      doctor_schema: doctor.schema,
      handoff_schema: handoff.schema,
      handoff_required_templates: handoff.target?.required_template_ids ?? [],
    };
  } finally {
    await client.close?.();
  }
}

function minimalResolvedVitalBundle() {
  return {
    schema: "opensynth.resolved_host_actions.v1",
    transaction_id: "package_smoke_vital_handoff",
    plugin_target: {
      plugin: "vital",
    },
    actions: [
      {
        action: "readback_parameter_snapshot",
        phase: "before",
        plugin: "vital",
        snapshot_id: "package_smoke_before",
      },
      {
        action: "set_plugin_parameter_resolved",
        plugin: "vital",
        host_parameter_ref: "param:5",
        host_parameter_index: 5,
        host_parameter_name: "Filter 1 Cutoff",
        host_parameter_current_normalized_value: 0.5,
        host_parameter_freshness_status: "fresh",
        change: {
          stable_id: "vital.filter_1.cutoff",
          operation: "set",
          normalized_target: 0.55,
          rollback: "L1",
          reason: "Package smoke plan-only handoff.",
        },
      },
      {
        action: "readback_parameter_snapshot",
        phase: "after",
        plugin: "vital",
      },
    ],
    rollback: {
      required: true,
      minimum_level: "L1",
      target_snapshot_id: "package_smoke_before",
    },
    readback: {
      required: true,
      changed_parameters_only: true,
    },
    preview: {
      required: false,
      mode: "fake_preview",
      duration_seconds: 1,
    },
    executor_notes: [
      "Package smoke verifies plan shape only.",
    ],
    resolution: {
      ok: true,
      blockers: [],
    },
  };
}

async function importPackageModule(specifier, paths) {
  const resolved = require.resolve(specifier, { paths });
  return import(pathToFileURL(resolved));
}

function parseJsonToolResult(response) {
  const text = response?.content?.find((item) => item.type === "text")?.text;
  if (!text) {
    throw new Error("MCP tool response did not include text content");
  }
  return JSON.parse(text);
}

function assertExactArray(actual, expected, label) {
  const expectedSorted = [...expected].sort();
  if (
    actual.length !== expectedSorted.length ||
    actual.some((value, index) => value !== expectedSorted[index])
  ) {
    throw new Error(`${label} mismatch: expected ${expectedSorted.join(",")}; got ${actual.join(",")}`);
  }
}

function assertDiscoveredIds(response, expectedIds, label) {
  const actualIds = new Set((response.items ?? []).map((item) => item.id));
  for (const id of expectedIds) {
    if (!actualIds.has(id)) {
      throw new Error(`${label} missing ${id}`);
    }
  }
}

function assertAgentStartupGuidance(guidance, { label, expectedPackageRoot }) {
  if (!guidance || guidance.contract !== "openreaper.alpha3_1.agent_startup_guidance.v1") {
    throw new Error(`${label} missing OpenReaper agent startup guidance`);
  }
  if (guidance.commands?.installed_start_reaper_for_mcp !== REQUIRED_INSTALLED_START_COMMAND) {
    throw new Error(`${label} installed start command mismatch`);
  }
  if (guidance.commands?.installed_start_project_for_mcp !== REQUIRED_INSTALLED_PROJECT_START_COMMAND) {
    throw new Error(`${label} installed project start command mismatch`);
  }
  if (expectedPackageRoot !== null) {
    const expectedCurrentCommand = path.join(expectedPackageRoot, "bin", "openreaper-start");
    if (guidance.commands?.current_package_start_reaper_for_mcp !== expectedCurrentCommand) {
      throw new Error(`${label} current package start command mismatch`);
    }
  }
  if (guidance.requirements?.mcp_client_server_name !== "openreaper") {
    throw new Error(`${label} must name MCP server openreaper`);
  }
  if (guidance.requirements?.normal_reaper_launch_supported !== false) {
    throw new Error(`${label} must say normal REAPER launch is not an OpenReaper MCP session`);
  }
  if (guidance.requirements?.only_openreaper_startup_supported !== true) {
    throw new Error(`${label} must require OpenReaper startup helper`);
  }
  if (guidance.safety?.added_tools !== 0 || guidance.safety?.hidden_executor !== false) {
    throw new Error(`${label} expanded the tool surface or hid an executor`);
  }
}

function assertProjectIndexUserFlow(flow) {
  if (!flow || flow.contract !== REQUIRED_PROJECT_INDEX_USER_FLOW_CONTRACT) {
    throw new Error("Packaged MCP list_templates missing Project Index user flow");
  }
  for (const id of REQUIRED_MACRO_IDS) {
    if (!flow.primary_macro_ids?.includes(id)) {
      throw new Error(`Packaged MCP Project Index user flow missing primary macro ${id}`);
    }
  }
  if (flow.safety?.added_tools !== 0 || flow.safety?.hidden_executor !== false) {
    throw new Error("Packaged MCP Project Index user flow expanded tools or hid an executor");
  }
  if (flow.safety?.raw_sql_exposed !== false || flow.safety?.sqlite_authorizes_writes !== false) {
    throw new Error("Packaged MCP Project Index user flow weakened SQLite safety");
  }
}

function assertMacroExecutionConvenience(flow) {
  if (!flow || flow.contract !== REQUIRED_MACRO_EXECUTION_CONVENIENCE_CONTRACT) {
    throw new Error("Packaged MCP list_templates missing macro execution convenience flow");
  }
  if (flow.safety?.added_tools !== 0 || flow.safety?.hidden_executor !== false) {
    throw new Error("Packaged MCP macro execution convenience expanded tools or hid an executor");
  }
  if (flow.safety?.server_executes_children !== false || flow.safety?.public_call_recipe !== false) {
    throw new Error("Packaged MCP macro execution convenience introduced a hidden execution path");
  }
  if (flow.safety?.raw_lua_action_shell_or_ui !== false || flow.safety?.alias_execution !== false) {
    throw new Error("Packaged MCP macro execution convenience weakened raw/alias execution policy");
  }
  if (flow.safety?.success_wording_requires_readback !== true) {
    throw new Error("Packaged MCP macro execution convenience must require readback before success wording");
  }
}

async function smokeExecutableLiveAllowlist(client) {
  const executableItems = await listAllExecutableTemplateItems(client);
  const acceptedLiveIds = new Set(CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS);
  const callableTemplateItems = executableItems.filter((item) =>
    String(item.id ?? "").startsWith("template.")
    && item.action_kind !== "macro"
    && item.current_status !== "blocked"
    && item.current_status !== "bug_known"
  );
  const missingFromAllowlist = callableTemplateItems
    .map((item) => item.id)
    .filter((id) => !acceptedLiveIds.has(id));
  if (missingFromAllowlist.length > 0) {
    throw new Error(`Executable surface includes ids outside accepted live allowlist: ${missingFromAllowlist.join(", ")}`);
  }

  const createTrackExact = parseJsonToolResult(await client.callTool({
    name: "list_templates",
    arguments: {
      surface: "executable",
      ids: [REQUIRED_EXECUTABLE_TEMPLATE_ID],
      fields: ["summary"],
    },
  }));
  assertDiscoveredIds(createTrackExact, [REQUIRED_EXECUTABLE_TEMPLATE_ID], "Packaged MCP create_track exact executable smoke");
  const createTrack = createTrackExact.items[0];
  if (createTrack.current_status === "blocked" || createTrack.current_status === "bug_known") {
    throw new Error(`Packaged MCP ${REQUIRED_EXECUTABLE_TEMPLATE_ID} status regression: ${createTrack.current_status}`);
  }
  if (createTrack.capability_truth?.known_blocker !== null) {
    throw new Error(`Packaged MCP ${REQUIRED_EXECUTABLE_TEMPLATE_ID} has unexpected blocker: ${createTrack.capability_truth?.known_blocker}`);
  }
  if (createTrack.capability_truth?.live_runnable_now !== true) {
    throw new Error(`Packaged MCP ${REQUIRED_EXECUTABLE_TEMPLATE_ID} is not live-runnable in executable surface`);
  }
  if (!acceptedLiveIds.has(REQUIRED_EXECUTABLE_TEMPLATE_ID)) {
    throw new Error(`${REQUIRED_EXECUTABLE_TEMPLATE_ID} is missing from accepted live allowlist`);
  }

  const createTrackProbe = parseJsonToolResult(await client.callTool({
    name: "call_template",
    arguments: {
      id: REQUIRED_EXECUTABLE_TEMPLATE_ID,
      input: {},
      refs: [],
    },
  }));
  const probeCode = createTrackProbe?.error?.code ?? createTrackProbe?.error_code ?? null;
  if (probeCode === "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED") {
    throw new Error(`${REQUIRED_EXECUTABLE_TEMPLATE_ID} call_template probe still hit CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED`);
  }

  return {
    ok: true,
    accepted_live_allowlist_count: CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.length,
    executable_template_count: callableTemplateItems.length,
    pages_scanned: Math.ceil(executableItems.length / 100),
    required_template: {
      id: REQUIRED_EXECUTABLE_TEMPLATE_ID,
      current_status: createTrack.current_status,
      beginner_label: createTrack.beginner_label,
      live_runnable_now: createTrack.capability_truth?.live_runnable_now,
      known_blocker: createTrack.capability_truth?.known_blocker,
      probe_ok: createTrackProbe?.ok === true,
      probe_error_code: probeCode,
    },
  };
}

async function listAllExecutableTemplateItems(client) {
  const items = [];
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const response = parseJsonToolResult(await client.callTool({
      name: "list_templates",
      arguments: {
        surface: "executable",
        limit: 1000,
        ...(cursor === null ? {} : { cursor }),
      },
    }));
    items.push(...(response.items ?? []));
    cursor = response.page?.next_cursor ?? null;
    if (!response.page?.has_more) return items;
  }
  throw new Error("Executable surface pagination did not finish within 20 pages");
}

function packageFilter(src) {
  const base = path.basename(src);
  if (base === ".git" || base === ".DS_Store" || base === "setup-out" || base === "coverage") return false;
  if (src.includes(`${path.sep}.git${path.sep}`)) return false;
  return true;
}

function vitalAgentPackageFilter(src) {
  const base = path.basename(src);
  if (base === ".git" || base === ".DS_Store" || base === "node_modules" || base === "dist" || base === "coverage") return false;
  if (base === "tests" || base === "docs") return false;
  if (src.includes(`${path.sep}.git${path.sep}`)) return false;
  if (src.includes(`${path.sep}node_modules${path.sep}`)) return false;
  if (src.includes(`${path.sep}dist${path.sep}`)) return false;
  if (src.includes(`${path.sep}tests${path.sep}`)) return false;
  if (src.includes(`${path.sep}docs${path.sep}`)) return false;
  return true;
}

async function replaceOutputDir(target) {
  const previousTarget = `${target}.previous-${compactTimestamp(new Date())}`;
  try {
    await rename(target, previousTarget);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await rm(previousTarget, {
    recursive: true,
    force: true,
    maxRetries: 3,
    retryDelay: 100,
  });
}

async function removeDsStore(root) {
  const entries = await import("node:fs/promises").then((fs) => fs.readdir(root, { withFileTypes: true }));
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.name === ".DS_Store") {
      await rm(fullPath, { force: true });
    } else if (entry.isDirectory()) {
      await removeDsStore(fullPath);
    }
  }
}

async function assertReadable(filePath) {
  await access(filePath, fsConstants.R_OK);
  await stat(filePath);
}

function run(cmd, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(" ")} exited with code ${code}`));
    });
  });
}

function parseArgs(args) {
  const parsed = {};
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals !== -1) {
      parsed[raw.slice(0, equals).replaceAll("-", "_")] = parseArgValue(raw.slice(equals + 1));
      continue;
    }
    const key = raw.replaceAll("-", "_");
    const next = args[i + 1];
    if (next && !next.startsWith("--")) {
      parsed[key] = parseArgValue(next);
      i += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

function parseArgValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  return value;
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

function safeToken(value, fallback) {
  if (typeof value !== "string" || value.trim() === "") return fallback;
  return value.trim().replace(/[^\w.+-]/g, "_").slice(0, 120) || fallback;
}
