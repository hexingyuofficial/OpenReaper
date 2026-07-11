#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { constants as fsConstants } from "node:fs";
import { access, chmod, cp, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
} from "../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { FakeFoundationBridge } from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  LIVE_BRIDGE_HEARTBEAT_FILENAME,
  LIVE_BRIDGE_LIVENESS_CONTRACT,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const repoRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const require = createRequire(import.meta.url);
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[OpenReaper] ${String(error?.message ?? "invalid option").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320)}\n`);
  process.exit(2);
}
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
const ACTIVE_PACKAGE_FIXTURE_PROCESSES = new Map();

const invokedAsPackageBuilder = process.argv[1] !== undefined
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsPackageBuilder) await buildPackage();

async function buildPackage() {
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
    portable_paths: await smokePackagedPortablePaths(),
    openreaper: await smokePackagedOpenReaperMcp(),
    runtime_doctor_readiness: await smokePackagedRuntimeDoctorReadiness(),
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
      default_render_root: "~/.openreaper/current/session/renders",
      render_root_override: "--render-root /absolute/path/to/renders",
      mcp_server_name: "openreaper",
      startup_requirement: "REAPER must be started through openreaper-start for MCP to connect.",
    },
  }, null, 2));
}

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
- registers a REAPER action named "OpenReaper: Start MCP bridge"
- creates the managed render root ~/.openreaper/current/session/renders and reuses it for MCP/start sessions
- provides ~/.openreaper/current/bin/openreaper-start for REAPER sessions that MCP can connect to
- provides companion MCP server "vital-agent-mcp" for Vital planning and OpenReaper handoff plans

Important:
REAPER must be started through OpenReaper for MCP to connect. Normal double-click REAPER launches are not OpenReaper MCP sessions.

Install:
Double-click install.command, or run:
  ./install.command

Managed render root:
The default is ~/.openreaper/current/session/renders. To select an external
absolute writable directory during install, run:
  ./install.command --render-root /absolute/path/to/renders
The selection is persisted for MCP and normal openreaper-start sessions.

Upgrade from an older OpenReaper alpha:
Run the newer downloaded package's install.command directly.
Do not manually delete the old ~/.openreaper/current folder first; the installer handles the
rename-first replacement, rewrites MCP client config, and then runs a startup
smoke. After install, run:
  ~/.openreaper/current/bin/openreaper-doctor
Then restart Codex, Cursor, Claude, or your MCP client so it reloads config.

Start REAPER:
  ~/.openreaper/current/bin/openreaper-start
  ~/.openreaper/current/bin/openreaper-start --project-path /path/to/project.RPP
  ~/.openreaper/current/bin/openreaper-start --render-root /absolute/path/to/renders
For a bounded new session, --session-root /absolute/path/to/session derives
that session's own renders child unless --render-root is also supplied. New
session and render roots must be absolute writable directories.

After REAPER opens:
Run the REAPER action:
  OpenReaper: Start MCP bridge

The agent should try to run that action for you. If the agent cannot operate
the REAPER UI on your machine, it should ask you for one small assist:
Actions > Show action list, search "OpenReaper: Start MCP bridge", click Run,
then ask the agent to reconnect.

After reconnect:
The agent should run a bounded live probe before saying the bridge is connected:
  call_template(template.transport.read_state)

After install:
Restart Codex, Cursor, Claude, or your MCP client so it reloads MCP config. Then ask:
  Open REAPER with OpenReaper and inspect the current project.

Startup lifetime: openreaper-start launches REAPER detached from the agent
shell, with the OpenReaper bridge environment prepared, waits for the REAPER
process to stay alive, and then returns with a pid/log path. This keeps REAPER
open if a terminal, MCP client, or agent command session ends.

Startup dialogs: openreaper-start only tries to clear the known Project Settings / Notes
"show notes on project load" window. license/evaluation, recovery, plugin,
version, and other windows are user-choice dialogs. If MCP does not connect
after REAPER opens, check whether a REAPER window is waiting for agent or user
action, resolve it, run the bridge action, reconnect, and run the live probe
again.

Uninstall:
  ./uninstall.command
External custom render roots are never removed. A non-empty default render
root is moved into a uniquely allocated preservation container beside
~/.openreaper/current before the install tree is removed; the uninstaller
reports that path.

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
  const renderRoot = path.join(packageRoot, "session", "renders");
  const transportDir = path.join(packageRoot, "session", "transport");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(renderRoot, { recursive: true });

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
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot,
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
      expectedPackageRoot: await realpath(packageRoot),
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
        bridge_action_required_after_start: ping.agent_startup_guidance.requirements.bridge_action_required_after_start,
        live_probe_required_before_success_claim: ping.agent_startup_guidance.requirements.live_probe_required_before_success_claim,
        bridge_action: {
          installed_action_name: ping.agent_startup_guidance.bridge_action.installed_action_name,
          agent_should_try_to_run_action: ping.agent_startup_guidance.bridge_action.agent_should_try_to_run_action,
          sws_required: ping.agent_startup_guidance.bridge_action.sws_required,
          command_line_reascript_bridge: ping.agent_startup_guidance.bridge_action.command_line_reascript_bridge,
          verification_probe: ping.agent_startup_guidance.bridge_action.verification_probe,
        },
        startup_dialog_assist: {
          auto_dismisses: ping.agent_startup_guidance.startup_dialog_assist.auto_dismisses,
          does_not_dismiss: ping.agent_startup_guidance.startup_dialog_assist.does_not_dismiss,
        },
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
    await clearDirectoryEntries(path.join(transportDir, "requests"));
    await clearDirectoryEntries(path.join(transportDir, "results"));
  }
}

async function smokePackagedRuntimeDoctorReadiness() {
  if (skipSmoke) {
    return {
      skipped: true,
      reason: "skip_smoke",
    };
  }

  const fixtureRoot = await mkdtemp("/tmp/openreaper-alpha-b3-package-");
  const homeRoot = path.join(fixtureRoot, "home");
  const actionScript = path.join(
    homeRoot,
    "Library",
    "Application Support",
    "REAPER",
    "Scripts",
    "OpenReaper",
    "openreaper-start-mcp-bridge.lua",
  );
  const reaperKb = path.join(
    homeRoot,
    "Library",
    "Application Support",
    "REAPER",
    "reaper-kb.ini",
  );
  await mkdir(path.dirname(actionScript), { recursive: true });
  await writeFile(actionScript, "-- package smoke bridge action fixture\n", "utf8");
  await writeFile(
    reaperKb,
    'SCR 4 0 "OpenReaper/openreaper-start-mcp-bridge.lua" "Custom: OpenReaper: Start MCP bridge"\n',
    "utf8",
  );

  const bridgeScript = path.join(
    packageRoot,
    "vendor",
    "openreaper-kernel",
    "reaper",
    "bridge",
    "openreaper-live-bridge.lua",
  );
  const serverScript = path.join(
    packageRoot,
    "vendor",
    "openreaper-kernel",
    "packages",
    "mcp-server",
    "src",
    "openreaper-mcp-stdio.mjs",
  );
  const doctorPath = path.join(packageRoot, "bin", "openreaper-doctor");
  const owner = "openreaper-alpha";
  const generation = 1;
  const cases = {};

  try {
    const pingRoot = path.join(fixtureRoot, "stdio-ping");
    const pingRenderRoot = path.join(pingRoot, "renders");
    await mkdir(pingRenderRoot, { recursive: true });

    for (const fixture of [
      { name: "no_heartbeat", heartbeat: "absent", render: "valid", bridge_status: "bridge_action_not_running", render_status: "render_root_ready" },
      { name: "stale", heartbeat: "stale", render: "valid", bridge_status: "bridge_loop_unresponsive", render_status: "render_root_ready" },
      { name: "fresh_matching", heartbeat: "fresh", render: "valid", bridge_status: "bridge_ready", render_status: "render_root_ready" },
      { name: "missing_root", heartbeat: "fresh", render: "missing", bridge_status: "bridge_ready", render_status: "render_root_missing" },
    ]) {
      const transportDir = path.join(pingRoot, fixture.name, "transport");
      const requestsDir = path.join(transportDir, "requests");
      const resultsDir = path.join(transportDir, "results");
      await mkdir(requestsDir, { recursive: true });
      await mkdir(resultsDir, { recursive: true });
      if (fixture.heartbeat === "fresh") {
        await writePackageHeartbeat(transportDir, { owner, generation });
      } else if (fixture.heartbeat === "stale") {
        await writePackageHeartbeat(transportDir, {
          owner,
          generation,
          mtime: new Date(Date.now() - 5_000),
        });
      }
      const selectedRenderRoot = fixture.render === "valid"
        ? pingRenderRoot
        : path.join(pingRoot, fixture.name, "missing-renders");
      const ping = await callActualPackagedStdioPing({
        serverScript,
        transportDir,
        renderRoot: selectedRenderRoot,
        bridgeScript,
        owner,
        generation,
      });
      if (ping.runtime_readiness?.bridge?.status !== fixture.bridge_status) {
        throw new Error(`Packaged stdio ${fixture.name} bridge status mismatch: ${ping.runtime_readiness?.bridge?.status}`);
      }
      if (ping.runtime_readiness?.render_root?.status !== fixture.render_status) {
        throw new Error(`Packaged stdio ${fixture.name} render status mismatch: ${ping.runtime_readiness?.render_root?.status}`);
      }
      if (ping.runtime_readiness?.request_response?.status !== "not_run") {
        throw new Error(`Packaged stdio ${fixture.name} unexpectedly ran request/response proof`);
      }
      assertDirectoryEmpty(await readdir(requestsDir), `Packaged stdio ${fixture.name} requests`);
      cases[`stdio_${fixture.name}`] = {
        bridge_status: fixture.bridge_status,
        render_root_status: fixture.render_status,
        request_response_status: "not_run",
        requests_after_ping: 0,
      };
    }

    const doctorRoot = path.join(fixtureRoot, "doctor");
    const validRenderRoot = path.join(doctorRoot, "renders");
    const artifactRoot = path.join(doctorRoot, "artifacts");
    await mkdir(validRenderRoot, { recursive: true });
    await mkdir(artifactRoot, { recursive: true });

    const noHeartbeat = await makeDoctorFixture(doctorRoot, "no-heartbeat");
    const noHeartbeatResult = await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot: noHeartbeat.sessionRoot,
      transportDir: noHeartbeat.transportDir,
      artifactRoot,
      renderRoot: validRenderRoot,
      owner,
      generation,
      args: [],
    });
    if (noHeartbeatResult.code !== 0) {
      throw new Error(`Packaged doctor no-heartbeat default failed: ${noHeartbeatResult.stderr || noHeartbeatResult.stdout}`);
    }
    if (noHeartbeatResult.report.package_status !== "ready") {
      throw new Error(`Packaged doctor no-heartbeat changed package status: ${noHeartbeatResult.report.package_status}`);
    }
    if (noHeartbeatResult.report.runtime_readiness?.bridge?.status !== "bridge_action_not_running") {
      throw new Error("Packaged doctor no-heartbeat did not preserve bridge_action_not_running");
    }
    if (noHeartbeatResult.report.runtime_diagnosis !== "reaper_not_running") {
      throw new Error(`Packaged doctor no-heartbeat diagnosis mismatch: ${noHeartbeatResult.report.runtime_diagnosis}`);
    }
    cases.doctor_no_heartbeat = {
      exit_code: noHeartbeatResult.code,
      package_status: noHeartbeatResult.report.package_status,
      bridge_status: noHeartbeatResult.report.runtime_readiness.bridge.status,
      diagnosis: noHeartbeatResult.report.runtime_diagnosis,
      request_response_status: noHeartbeatResult.report.request_response.status,
    };

    const waitNoHeartbeatResult = await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot: noHeartbeat.sessionRoot,
      transportDir: noHeartbeat.transportDir,
      artifactRoot,
      renderRoot: validRenderRoot,
      owner,
      generation,
      args: ["--wait-bridge=1"],
    });
    if (
      waitNoHeartbeatResult.code !== 1 ||
      waitNoHeartbeatResult.report.wait_bridge?.polls < 2 ||
      waitNoHeartbeatResult.report.request_response?.status !== "not_run"
    ) {
      throw new Error(`Packaged doctor bounded wait fixture mismatch: ${waitNoHeartbeatResult.stderr || waitNoHeartbeatResult.stdout}`);
    }
    cases.doctor_wait_no_heartbeat = {
      exit_code: waitNoHeartbeatResult.code,
      bridge_status: waitNoHeartbeatResult.report.runtime_readiness.bridge.status,
      polls: waitNoHeartbeatResult.report.wait_bridge.polls,
      request_response_status: waitNoHeartbeatResult.report.request_response.status,
    };

    const stale = await makeDoctorFixture(doctorRoot, "stale");
    await writePackageHeartbeat(stale.transportDir, {
      owner,
      generation,
      mtime: new Date(Date.now() - 5_000),
    });
    const staleResult = await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot: stale.sessionRoot,
      transportDir: stale.transportDir,
      artifactRoot,
      renderRoot: validRenderRoot,
      owner,
      generation,
      args: ["--for", "live-edit"],
    });
    if (staleResult.code !== 1 || staleResult.report.task?.status !== "blocked") {
      throw new Error(`Packaged doctor stale fixture did not block: ${staleResult.stderr || staleResult.stdout}`);
    }
    if (staleResult.report.runtime_readiness?.bridge?.status !== "bridge_loop_unresponsive") {
      throw new Error("Packaged doctor stale fixture lost bridge_loop_unresponsive");
    }
    cases.doctor_stale = {
      exit_code: staleResult.code,
      bridge_status: staleResult.report.runtime_readiness.bridge.status,
      task_status: staleResult.report.task.status,
      request_response_status: staleResult.report.request_response.status,
    };

    const freshLive = await makeDoctorFixture(doctorRoot, "fresh-live-edit");
    await writePackageHeartbeat(freshLive.transportDir, { owner, generation });
    const freshLiveResult = await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot: freshLive.sessionRoot,
      transportDir: freshLive.transportDir,
      artifactRoot,
      renderRoot: validRenderRoot,
      owner,
      generation,
      args: ["--for", "live-edit"],
      provideReadResult: true,
    });
    if (freshLiveResult.code !== 0 || freshLiveResult.report.task?.status !== "ready") {
      throw new Error(`Packaged doctor fresh live-edit did not become ready: ${freshLiveResult.stderr || freshLiveResult.stdout}`);
    }
    cases.doctor_fresh_matching = {
      exit_code: freshLiveResult.code,
      bridge_status: freshLiveResult.report.runtime_readiness.bridge.status,
      request_response_status: freshLiveResult.report.request_response.status,
      task_status: freshLiveResult.report.task.status,
    };

    const missingRenderRoot = path.join(doctorRoot, "missing-render-root");
    const regularFileRenderRoot = path.join(doctorRoot, "regular-file-render-root");
    const symlinkRenderRoot = path.join(doctorRoot, "symlink-render-root");
    const permissionRenderRoot = path.join(doctorRoot, "permission-render-root");
    await writeFile(regularFileRenderRoot, "not a directory\n", "utf8");
    await symlink(validRenderRoot, symlinkRenderRoot);
    await mkdir(permissionRenderRoot, { recursive: true });
    await chmod(permissionRenderRoot, 0o500);
    const nonReadyRenderRoots = [
      { name: "missing", path: missingRenderRoot, status: "render_root_missing" },
      { name: "regular_file", path: regularFileRenderRoot, status: "render_root_not_directory" },
      { name: "final_symlink", path: symlinkRenderRoot, status: "render_root_symlink" },
      { name: "permission_unready", path: permissionRenderRoot, status: "render_root_not_writable" },
    ];

    try {
      for (const fixture of nonReadyRenderRoots) {
        const defaultDoctor = await makeDoctorFixture(doctorRoot, `${fixture.name}-default`);
        const defaultResult = await runPackagedDoctorFixture({
          doctorPath,
          homeRoot,
          sessionRoot: defaultDoctor.sessionRoot,
          transportDir: defaultDoctor.transportDir,
          artifactRoot,
          renderRoot: fixture.path,
          owner,
          generation,
          args: [],
        });
        const commandSmoke = defaultResult.report.smoke?.package_mcp_command;
        if (
          defaultResult.code !== 0 ||
          defaultResult.report.status !== "ready" ||
          defaultResult.report.package_status !== "ready" ||
          commandSmoke?.ok !== true ||
          commandSmoke?.kernel !== "openreaper-mcp alpha kernel"
        ) {
          throw new Error(`Packaged default doctor coupled ${fixture.name} render readiness to package health: ${defaultResult.stderr || defaultResult.stdout}`);
        }
        assertExactArray(commandSmoke.tool_surface, EXACT_MCP_TOOLS, `Packaged default doctor ${fixture.name} package command tool surface`);
        if (
          defaultResult.report.render_root_inspection?.status !== fixture.status ||
          defaultResult.report.runtime_readiness?.render_root?.status !== fixture.status ||
          defaultResult.report.runtime_readiness?.bridge?.status !== "bridge_action_not_running" ||
          defaultResult.report.request_response?.status !== "not_run"
        ) {
          throw new Error(`Packaged default doctor lost separated ${fixture.name} evidence: ${defaultResult.stderr || defaultResult.stdout}`);
        }

        const renderDoctor = await makeDoctorFixture(doctorRoot, `${fixture.name}-render`);
        await writePackageHeartbeat(renderDoctor.transportDir, { owner, generation });
        const renderResult = await runPackagedDoctorFixture({
          doctorPath,
          homeRoot,
          sessionRoot: renderDoctor.sessionRoot,
          transportDir: renderDoctor.transportDir,
          artifactRoot,
          renderRoot: fixture.path,
          owner,
          generation,
          args: ["--for", "render"],
          provideReadResult: true,
        });
        const renderTask = renderResult.report.task;
        if (
          renderResult.code !== 1 ||
          renderResult.report.package_status !== "ready" ||
          renderResult.report.smoke?.package_mcp_command?.ok !== true ||
          renderResult.report.render_root_inspection?.status !== fixture.status ||
          renderResult.report.request_response?.status !== "ready" ||
          renderTask?.status !== "blocked" ||
          renderTask?.missing_precondition !== fixture.status ||
          renderTask?.failure_layer !== "render_root" ||
          renderTask?.ready_for_render !== false ||
          renderTask?.next_action?.code !== "repair_managed_render_root" ||
          typeof renderTask?.safe_copy_paste_fix !== "string" ||
          !renderTask.safe_copy_paste_fix.includes('--render-root "$ROOT"')
        ) {
          throw new Error(`Packaged render doctor ${fixture.name} separation/recovery mismatch: ${renderResult.stderr || renderResult.stdout}`);
        }

        cases[`doctor_${fixture.name}_root_separation`] = {
          default: {
            exit_code: defaultResult.code,
            status: defaultResult.report.status,
            package_status: defaultResult.report.package_status,
            package_mcp_command_ok: commandSmoke.ok,
            render_root_status: defaultResult.report.render_root_inspection.status,
            bridge_status: defaultResult.report.runtime_readiness.bridge.status,
            request_response_status: defaultResult.report.request_response.status,
          },
          render_task: {
            exit_code: renderResult.code,
            package_status: renderResult.report.package_status,
            package_mcp_command_ok: renderResult.report.smoke.package_mcp_command.ok,
            render_root_status: renderResult.report.render_root_inspection.status,
            request_response_status: renderResult.report.request_response.status,
            task_status: renderTask.status,
            failure_layer: renderTask.failure_layer,
            fresh_root_recovery: true,
            ready_for_render: renderTask.ready_for_render,
          },
        };
      }

      const missingLiveEdit = await makeDoctorFixture(doctorRoot, "missing-root-live-edit");
      await writePackageHeartbeat(missingLiveEdit.transportDir, { owner, generation });
      const missingLiveEditResult = await runPackagedDoctorFixture({
        doctorPath,
        homeRoot,
        sessionRoot: missingLiveEdit.sessionRoot,
        transportDir: missingLiveEdit.transportDir,
        artifactRoot,
        renderRoot: missingRenderRoot,
        owner,
        generation,
        args: ["--for", "live-edit"],
        provideReadResult: true,
      });
      if (
        missingLiveEditResult.code !== 0 ||
        missingLiveEditResult.report.package_status !== "ready" ||
        missingLiveEditResult.report.render_root_inspection?.status !== "render_root_missing" ||
        missingLiveEditResult.report.request_response?.status !== "ready" ||
        missingLiveEditResult.report.task?.status !== "ready"
      ) {
        throw new Error(`Packaged live-edit incorrectly depended on render-root readiness: ${missingLiveEditResult.stderr || missingLiveEditResult.stdout}`);
      }
      cases.doctor_missing_root_live_edit_independent = {
        exit_code: missingLiveEditResult.code,
        package_status: missingLiveEditResult.report.package_status,
        render_root_status: missingLiveEditResult.report.render_root_inspection.status,
        request_response_status: missingLiveEditResult.report.request_response.status,
        task_status: missingLiveEditResult.report.task.status,
      };
    } finally {
      await chmod(permissionRenderRoot, 0o700).catch(() => {});
    }

    const readyRender = await makeDoctorFixture(doctorRoot, "ready-render");
    await writePackageHeartbeat(readyRender.transportDir, { owner, generation });
    const readyRenderResult = await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot: readyRender.sessionRoot,
      transportDir: readyRender.transportDir,
      artifactRoot,
      renderRoot: validRenderRoot,
      owner,
      generation,
      args: ["--for", "render"],
      provideReadResult: true,
    });
    const renderTask = readyRenderResult.report.task;
    if (
      readyRenderResult.code !== 0 ||
      renderTask?.status !== "ready" ||
      renderTask?.ready_for_render !== true ||
      renderTask?.render_execution_proven !== false ||
      renderTask?.codec_support_assessed !== false ||
      renderTask?.scope !== "preflight_only"
    ) {
      throw new Error(`Packaged doctor valid render preflight mismatch: ${readyRenderResult.stderr || readyRenderResult.stdout}`);
    }
    cases.doctor_valid_root = {
      exit_code: readyRenderResult.code,
      render_root_status: readyRenderResult.report.render_root_inspection.status,
      request_response_status: readyRenderResult.report.request_response.status,
      task_status: renderTask.status,
      ready_for_render: renderTask.ready_for_render,
      render_execution_proven: renderTask.render_execution_proven,
      codec_support_assessed: renderTask.codec_support_assessed,
      scope: renderTask.scope,
    };

    cases.doctor_never_settling_ping_cleanup = await smokePackagedDoctorNeverSettlingPing({
      fixtureRoot,
      homeRoot,
      sourceDoctorPath: doctorPath,
      owner,
      generation,
    });
    cases.doctor_fixture_timeout_cleanup = await smokePackagedDoctorFixtureTimeoutCleanup({
      fixtureRoot,
      homeRoot,
      owner,
      generation,
    });

    const probeFiles = await collectNamedFiles(fixtureRoot, (name) =>
      name.startsWith(".openreaper-write-probe-") || name.endsWith(".probe"));
    if (probeFiles.length > 0) {
      throw new Error(`Packaged B3 smoke left probe files: ${probeFiles.join(", ")}`);
    }
    await assertNoActivePackageFixtureProcesses(fixtureRoot);

    return {
      ok: true,
      no_reaper_started: true,
      exact_tool_count: EXACT_MCP_TOOLS.length,
      cases,
      audit: {
        active_fake_children: 0,
        request_files_after_cleanup: 0,
        result_files_after_cleanup: 0,
        probe_files_after_cleanup: 0,
      },
    };
  } finally {
    await assertNoActivePackageFixtureProcesses(fixtureRoot).catch(() => {});
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function smokePackagedDoctorNeverSettlingPing({
  fixtureRoot,
  homeRoot,
  sourceDoctorPath,
  owner,
  generation,
}) {
  const candidateRoot = path.join(fixtureRoot, "never-settling-ping-package");
  const candidateDoctor = path.join(candidateRoot, "bin", "openreaper-doctor");
  const candidateServer = path.join(
    candidateRoot,
    "vendor",
    "openreaper-kernel",
    "packages",
    "mcp-server",
    "src",
    "openreaper-mcp-stdio.mjs",
  );
  const candidateReadiness = path.join(path.dirname(candidateServer), "alpha3-2b3-runtime-doctor-readiness-v1.mjs");
  const sourceReadiness = path.join(
    packageRoot,
    "vendor",
    "openreaper-kernel",
    "packages",
    "mcp-server",
    "src",
    "alpha3-2b3-runtime-doctor-readiness-v1.mjs",
  );
  const candidateBridge = path.join(
    candidateRoot,
    "vendor",
    "openreaper-kernel",
    "reaper",
    "bridge",
    "openreaper-live-bridge.lua",
  );
  const candidateVitalServer = path.join(candidateRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js");
  const sessionRoot = path.join(candidateRoot, "session-fixture");
  const transportDir = path.join(sessionRoot, "transport");
  const artifactRoot = path.join(sessionRoot, "artifacts");
  const renderRoot = path.join(sessionRoot, "renders");

  await mkdir(path.dirname(candidateDoctor), { recursive: true });
  await mkdir(path.dirname(candidateServer), { recursive: true });
  await mkdir(path.dirname(candidateBridge), { recursive: true });
  await mkdir(path.dirname(candidateVitalServer), { recursive: true });
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(renderRoot, { recursive: true });
  await cp(sourceDoctorPath, candidateDoctor);
  await chmod(candidateDoctor, 0o755);
  await cp(sourceReadiness, candidateReadiness);
  await cp(
    path.join(path.dirname(sourceReadiness), "live-bridge-executor-v1.mjs"),
    path.join(path.dirname(candidateReadiness), "live-bridge-executor-v1.mjs"),
  );
  await cp(
    path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua"),
    candidateBridge,
  );
  await symlink(path.join(packageRoot, "node_modules"), path.join(candidateRoot, "node_modules"));
  await symlink(
    path.join(packageRoot, "vendor", "openreaper-kernel", "packages", "core"),
    path.join(candidateRoot, "vendor", "openreaper-kernel", "packages", "core"),
  );

  const fakeServerSource = `import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
const exactTools = ${JSON.stringify(EXACT_MCP_TOOLS)};
const grandchild = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});process.on('SIGINT',()=>{});setInterval(()=>{},1000)"], {
  detached: false,
  shell: false,
  stdio: "ignore",
});
writeFileSync(process.env.OPENREAPER_NEVER_PING_SERVER_PID_MARKER, String(process.pid) + "\\n", "utf8");
writeFileSync(process.env.OPENREAPER_NEVER_PING_GRANDCHILD_PID_MARKER, String(grandchild.pid) + "\\n", "utf8");
process.on("SIGTERM", () => {});
process.on("SIGINT", () => {});
const server = new Server({ name: "openreaper-never-ping-fixture", version: "0.0.0" }, { capabilities: { tools: {} } });
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: exactTools.map((name) => ({ name, inputSchema: { type: "object" } })) }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === "ping") await new Promise(() => {});
  return { content: [{ type: "text", text: JSON.stringify({ items: [] }) }] };
});
await server.connect(new StdioServerTransport());
`;
  await writeFile(candidateServer, fakeServerSource, "utf8");
  await writeFile(candidateVitalServer, "export {};\n", "utf8");
  for (const name of ["openreaper-mcp", "vital-agent-mcp", "openreaper-start"]) {
    const commandPath = path.join(candidateRoot, "bin", name);
    const command = name === "openreaper-mcp"
      ? `#!/bin/zsh\nexec ${shellQuote(process.execPath)} ${shellQuote(candidateServer)}\n`
      : "#!/bin/zsh\nexit 0\n";
    await writeFile(commandPath, command, "utf8");
    await chmod(commandPath, 0o755);
  }

  const timeoutServerPidMarker = path.join(candidateRoot, "never-ping-timeout-server.pid");
  const timeoutGrandchildPidMarker = path.join(candidateRoot, "never-ping-timeout-grandchild.pid");
  const startedAt = Date.now();
  const timeoutResult = await runPackagedDoctorFixture({
    doctorPath: candidateDoctor,
    homeRoot,
    sessionRoot,
    transportDir,
    artifactRoot,
    renderRoot,
    owner,
    generation,
    args: ["--wait-bridge=1"],
    timeoutMs: 7_000,
    extraEnv: {
      OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS: "1200",
      OPENREAPER_NEVER_PING_SERVER_PID_MARKER: timeoutServerPidMarker,
      OPENREAPER_NEVER_PING_GRANDCHILD_PID_MARKER: timeoutGrandchildPidMarker,
    },
    onSpawn: () => assertAdversarialMcpProcessGroupPresent({
      serverPidMarker: timeoutServerPidMarker,
      grandchildPidMarker: timeoutGrandchildPidMarker,
      label: "never-settling timeout MCP",
    }),
  });
  const elapsedMs = Date.now() - startedAt;
  if (timeoutResult.code !== 1 || timeoutResult.report.package_status !== "not_ready_mcp_smoke_failed") {
    throw new Error(`Never-settling ping doctor result mismatch: ${timeoutResult.stderr || timeoutResult.stdout}`);
  }
  if (timeoutResult.report.smoke?.error_code !== "OPENREAPER_DOCTOR_TIMEOUT") {
    throw new Error(`Never-settling ping doctor lost timeout code: ${timeoutResult.report.smoke?.error_code}`);
  }
  if (elapsedMs >= 7_000) {
    throw new Error(`Never-settling ping doctor exceeded clear bound: ${elapsedMs}ms`);
  }
  const timeoutPids = await readAdversarialMcpPids({
    serverPidMarker: timeoutServerPidMarker,
    grandchildPidMarker: timeoutGrandchildPidMarker,
    label: "never-settling timeout MCP",
  });
  await assertAdversarialMcpGroupGone(timeoutPids, "never-settling timeout MCP");

  const signalServerPidMarker = path.join(candidateRoot, "never-ping-signal-server.pid");
  const signalGrandchildPidMarker = path.join(candidateRoot, "never-ping-signal-grandchild.pid");
  const signalResult = await runPackagedDoctorFixture({
    doctorPath: candidateDoctor,
    homeRoot,
    sessionRoot,
    transportDir,
    artifactRoot,
    renderRoot,
    owner,
    generation,
    args: ["--wait-bridge=1"],
    timeoutMs: 7_000,
    expectMachineReport: false,
    extraEnv: {
      OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS: "5000",
      OPENREAPER_NEVER_PING_SERVER_PID_MARKER: signalServerPidMarker,
      OPENREAPER_NEVER_PING_GRANDCHILD_PID_MARKER: signalGrandchildPidMarker,
    },
    onSpawn: async (doctorChild) => {
      await assertAdversarialMcpProcessGroupPresent({
        serverPidMarker: signalServerPidMarker,
        grandchildPidMarker: signalGrandchildPidMarker,
        label: "SIGTERM MCP",
      });
      process.kill(doctorChild.pid, "SIGTERM");
    },
  });
  if (signalResult.code !== 143 || signalResult.signal !== null) {
    throw new Error(`External SIGTERM doctor result mismatch: ${signalResult.stderr || signalResult.stdout}`);
  }
  const signalPids = await readAdversarialMcpPids({
    serverPidMarker: signalServerPidMarker,
    grandchildPidMarker: signalGrandchildPidMarker,
    label: "SIGTERM MCP",
  });
  await assertAdversarialMcpGroupGone(signalPids, "SIGTERM MCP");

  return {
    timeout: {
      exit_code: timeoutResult.code,
      package_status: timeoutResult.report.package_status,
      error_code: timeoutResult.report.smoke.error_code,
      elapsed_ms: elapsedMs,
      direct_child_exited: true,
      grandchild_exited: true,
      owned_process_group_exited: true,
    },
    external_sigterm: {
      exit_code: signalResult.code,
      direct_child_exited: true,
      grandchild_exited: true,
      owned_process_group_exited: true,
    },
  };
}

async function readAdversarialMcpPids({ serverPidMarker, grandchildPidMarker, label }) {
  await Promise.all([
    waitForFile(serverPidMarker, { attempts: 100, delayMs: 20 }),
    waitForFile(grandchildPidMarker, { attempts: 100, delayMs: 20 }),
  ]);
  const [serverPidText, grandchildPidText] = await Promise.all([
    readFile(serverPidMarker, "utf8"),
    readFile(grandchildPidMarker, "utf8"),
  ]);
  const serverPid = Number(serverPidText.trim());
  const grandchildPid = Number(grandchildPidText.trim());
  for (const [kind, pid] of [["server", serverPid], ["grandchild", grandchildPid]]) {
    if (!Number.isSafeInteger(pid) || pid <= 0) {
      throw new Error(`${label} recorded invalid ${kind} PID: ${pid}`);
    }
  }
  return { serverPid, grandchildPid };
}

async function assertAdversarialMcpProcessGroupPresent({ serverPidMarker, grandchildPidMarker, label }) {
  const pids = await readAdversarialMcpPids({ serverPidMarker, grandchildPidMarker, label });
  if (!isProcessAlive(pids.serverPid) || !isProcessAlive(pids.grandchildPid)) {
    throw new Error(`${label} process exited before the doctor cleanup probe`);
  }
  if (process.platform !== "win32" && !isProcessGroupAlive(pids.serverPid)) {
    throw new Error(`${label} direct MCP child ${pids.serverPid} was not an owned process-group leader`);
  }
}

async function assertAdversarialMcpGroupGone({ serverPid, grandchildPid }, label) {
  const assertAbsent = () => {
    if (isProcessAlive(serverPid)) throw new Error(`${label} direct MCP child remained alive: ${serverPid}`);
    if (isProcessAlive(grandchildPid)) throw new Error(`${label} SIGTERM-ignoring grandchild remained alive: ${grandchildPid}`);
    if (process.platform !== "win32" && isProcessGroupAlive(serverPid)) {
      throw new Error(`${label} owned MCP process group remained alive: ${serverPid}`);
    }
  };
  assertAbsent();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 20));
    assertAbsent();
  }
}

function isProcessGroupAlive(pgid) {
  try {
    process.kill(-pgid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function smokePackagedDoctorFixtureTimeoutCleanup({ fixtureRoot, homeRoot, owner, generation }) {
  const root = path.join(fixtureRoot, "fixture-timeout-cleanup");
  const doctorPath = path.join(root, "fake-doctor.mjs");
  const childPidMarker = path.join(root, "stubborn-child.pid");
  const sessionRoot = path.join(root, "session");
  const transportDir = path.join(sessionRoot, "transport");
  const artifactRoot = path.join(sessionRoot, "artifacts");
  const renderRoot = path.join(sessionRoot, "renders");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
  await mkdir(renderRoot, { recursive: true });
  await writeFile(doctorPath, `#!/usr/bin/env node
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
process.on("SIGTERM", () => {});
const child = spawn(process.execPath, ["-e", "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: "ignore" });
writeFileSync(process.env.OPENREAPER_STUBBORN_CHILD_PID_MARKER, String(child.pid) + "\\n", "utf8");
setInterval(() => {}, 1000);
`, "utf8");
  await chmod(doctorPath, 0o755);

  let timeoutError = null;
  try {
    await runPackagedDoctorFixture({
      doctorPath,
      homeRoot,
      sessionRoot,
      transportDir,
      artifactRoot,
      renderRoot,
      owner,
      generation,
      args: [],
      timeoutMs: 1_000,
      extraEnv: {
        OPENREAPER_STUBBORN_CHILD_PID_MARKER: childPidMarker,
      },
    });
  } catch (error) {
    timeoutError = error;
  }
  if (timeoutError?.code !== "OPENREAPER_FIXTURE_TIMEOUT") {
    throw timeoutError ?? new Error("Packaged doctor fixture timeout cleanup unexpectedly succeeded");
  }
  await waitForFile(childPidMarker, { attempts: 100, delayMs: 20 });
  const childPid = Number((await readFile(childPidMarker, "utf8")).trim());
  if (!Number.isSafeInteger(childPid) || childPid <= 0 || isProcessAlive(childPid)) {
    throw new Error(`Packaged doctor fixture timeout left stubborn child alive: ${childPid}`);
  }
  if (
    timeoutError.cleanup?.term_sent !== true ||
    timeoutError.cleanup?.kill_sent !== true ||
    timeoutError.cleanup?.process_group_exited !== true
  ) {
    throw new Error(`Packaged doctor fixture timeout cleanup evidence incomplete: ${JSON.stringify(timeoutError.cleanup)}`);
  }
  return {
    timeout_code: timeoutError.code,
    term_sent: true,
    kill_sent: true,
    child_exited: true,
    process_group_exited: true,
  };
}

async function callActualPackagedStdioPing({
  serverScript,
  transportDir,
  renderRoot,
  bridgeScript,
  owner,
  generation,
}) {
  const packagePaths = [packageRoot, path.join(packageRoot, "node_modules")];
  const [{ Client }, { StdioClientTransport }] = await Promise.all([
    importPackageModule("@modelcontextprotocol/sdk/client/index.js", packagePaths),
    importPackageModule("@modelcontextprotocol/sdk/client/stdio.js", packagePaths),
  ]);
  const client = new Client({ name: "openreaper-alpha-b3-stdio-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [serverScript],
    cwd: packageRoot,
    env: {
      ...process.env,
      OPENREAPER_MCP_PACKAGE_ROOT: packageRoot,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot,
      OPENREAPER_LIVE_BRIDGE_OWNER: owner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(generation),
    },
    stderr: "pipe",
  });
  try {
    await client.connect(transport);
    const toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
    assertExactArray(toolNames, EXACT_MCP_TOOLS, "Packaged B3 stdio tool surface");
    return parseJsonToolResult(await client.callTool({ name: "ping", arguments: {} }));
  } finally {
    await client.close?.();
  }
}

async function makeDoctorFixture(root, name) {
  const sessionRoot = path.join(root, name, "session");
  const transportDir = path.join(sessionRoot, "transport");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  return { sessionRoot, transportDir };
}

async function runPackagedDoctorFixture({
  doctorPath,
  homeRoot,
  sessionRoot,
  transportDir,
  artifactRoot,
  renderRoot,
  owner,
  generation,
  args,
  provideReadResult = false,
  timeoutMs = 20_000,
  extraEnv = {},
  onSpawn = null,
  expectMachineReport = true,
}) {
  const requestsDir = path.join(transportDir, "requests");
  const resultsDir = path.join(transportDir, "results");
  await clearDirectoryEntries(requestsDir);
  await clearDirectoryEntries(resultsDir);
  const env = {
    ...process.env,
    HOME: homeRoot,
    OPENREAPER_SESSION_ROOT: sessionRoot,
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
    OPENREAPER_ARTIFACT_ROOT: artifactRoot,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: renderRoot,
    OPENREAPER_LIVE_BRIDGE_OWNER: owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(generation),
    OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS: "1000",
    ...extraEnv,
  };
  const abortController = new AbortController();
  const runPromise = runCaptured(doctorPath, args, {
    cwd: path.dirname(doctorPath),
    env,
    timeoutMs,
    cleanupProcessGroup: true,
    signal: abortController.signal,
    label: "packaged openreaper-doctor fixture",
    onSpawn,
  });

  try {
    if (provideReadResult) {
      let requestPath;
      try {
        requestPath = await waitForFirstJsonFile(requestsDir, { attempts: 200, delayMs: 20 });
      } catch (error) {
        const early = await runPromise;
        throw new Error(`Packaged doctor exited before read request: ${early.stderr || early.stdout || error.message}`);
      }
      const request = JSON.parse(await readFile(requestPath, "utf8"));
      const bridge = new FakeFoundationBridge({ owner, generation });
      const result = bridge.dispatch(request);
      await writeFile(path.join(resultsDir, path.basename(requestPath)), `${JSON.stringify(result)}\n`, "utf8");
    }

    const outcome = await runPromise;
    if (expectMachineReport !== true) return outcome;
    let report;
    try {
      report = parseLeadingJsonObject(outcome.stdout);
    } catch (error) {
      throw new Error(`Packaged doctor output was not machine-readable: ${outcome.stderr || outcome.stdout || error.message}`, { cause: error });
    }
    return { ...outcome, report };
  } finally {
    abortController.abort(new Error("packaged doctor fixture cleanup"));
    await runPromise.catch(() => {});
    await clearDirectoryEntries(requestsDir);
    await clearDirectoryEntries(resultsDir);
    assertDirectoryEmpty(await readdir(requestsDir), "Packaged doctor requests after cleanup");
    assertDirectoryEmpty(await readdir(resultsDir), "Packaged doctor results after cleanup");
  }
}

async function writePackageHeartbeat(transportDir, options = {}) {
  const mtime = options.mtime ?? new Date();
  const heartbeat = {
    contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
    active_owner: options.owner ?? "openreaper-alpha",
    active_generation: options.generation ?? 1,
    sequence: 1,
    refreshed_at_unix_s: Math.floor(mtime.getTime() / 1_000),
    interval_ms: 500,
  };
  const heartbeatPath = path.join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME);
  await writeFile(heartbeatPath, `${JSON.stringify(heartbeat)}\n`, "utf8");
  await utimes(heartbeatPath, mtime, mtime);
  return heartbeatPath;
}

async function waitForFirstJsonFile(directory, { attempts = 200, delayMs = 20 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const entries = (await readdir(directory)).filter((name) => name.endsWith(".json")).sort();
    if (entries.length > 0) return path.join(directory, entries[0]);
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`Timed out waiting for JSON request in ${directory}`);
}

async function clearDirectoryEntries(directory) {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error?.code === "ENOENT") return;
    throw error;
  }
  await Promise.all(entries.map((entry) => rm(path.join(directory, entry), { recursive: true, force: true })));
}

function assertDirectoryEmpty(entries, label) {
  if (entries.length !== 0) throw new Error(`${label} expected empty, found: ${entries.join(", ")}`);
}

async function collectNamedFiles(root, predicate) {
  const matches = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await collectNamedFiles(fullPath, predicate));
    } else if (entry.isFile() && predicate(entry.name)) {
      matches.push(fullPath);
    }
  }
  return matches;
}

function parseLeadingJsonObject(text) {
  const start = text.indexOf("{");
  if (start === -1) throw new Error("Doctor output did not include a JSON object");
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < text.length; index += 1) {
    const character = text[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
      continue;
    }
    if (character === "{") depth += 1;
    if (character === "}") {
      depth -= 1;
      if (depth === 0) return JSON.parse(text.slice(start, index + 1));
    }
  }
  throw new Error("Doctor JSON object was incomplete");
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
  if (source.includes("OPENREAPER_LIVE_SMOKE_RENDER_ROOT:-")) {
    throw new Error("openreaper-start must not inherit stale OPENREAPER_LIVE_SMOKE_RENDER_ROOT by default");
  }
  for (const required of ["--session-root", "--render-root", "--transport-dir", "--artifact-root", "--bridge-owner", "--bridge-generation", "--reaper-app"]) {
    if (!source.includes(required)) {
      throw new Error(`openreaper-start missing explicit bounded evidence option ${required}`);
    }
  }
  for (const required of [
    "launch_reaper()",
    'reaper_args=("-newinst")',
    'reaper_args+=("${PROJECT_PATH}")',
    'USE_LAUNCHSERVICES=true',
    "REAPER_APP",
    "/usr/bin/mdfind",
    '"${OPEN_BIN}" -na "${REAPER_APP}" --args "${reaper_args[@]}"',
    "LAUNCHSERVICES_ENV_KEYS",
    "snapshot_launchservices_env",
    "LAUNCHSERVICES_CLEANUP_REQUIRED",
    ".openreaper-launchservices-env.lock",
    "acquire_launchservices_lock",
    "LAUNCHSERVICES_LOCK_OWNED",
    "LAUNCHSERVICES_RECOVERY_RETAINED",
    "owner.meta",
    ".owner-token",
    "metadata_size > 1024",
    "will not be auto-broken",
    ".presence",
    "restore_launchservices_env",
    "trap 'launchservices_cleanup_on_exit' EXIT",
    'export OPENREAPER_LIVE_SMOKE_RENDER_ROOT="${RENDER_ROOT}"',
    'render-root=${RENDER_ROOT}',
    "managed-render-root.path",
    "wait_for_new_reaper_pid",
    "launch-method=macos_launchservices",
    "reaper-pid=",
    "reaper-pid-file=",
    "reaper-log=",
    "bridge-action=OpenReaper: Start MCP bridge",
    "bridge-status=needs_reaper_action",
    "startup-dialog-assist=project_notes_only",
    "Project Settings / Notes",
    "Show notes on project load",
    "license/evaluation, recovery, plugin, or other user-choice",
    "agent-next-step=Try to run REAPER action",
    "user-fallback=In REAPER: Actions",
    "wait_for_reaper_process()",
    "REAPER process stayed alive",
    "OPENREAPER_START_WAIT_SECONDS",
  ]) {
    if (!source.includes(required)) {
      throw new Error(`openreaper-start missing detached startup requirement: ${required}`);
    }
  }
  const sessionDerivedOrderingMarkers = [
    '["effective transport", effectiveTransportRoot]',
    '["effective artifact", effectiveArtifactRoot]',
    "const canonicalInstalledDefaultRoot",
    "const canonicalInstallRoot",
    "const canonicalEffectiveSessionRenderRoot",
    "const canonicalEffectiveSessionRoot",
  ];
  const sessionDerivedOrderingIndexes = sessionDerivedOrderingMarkers.map((value) => source.indexOf(value));
  if (
    sessionDerivedOrderingIndexes.some((value) => value < 0)
    || sessionDerivedOrderingIndexes.some((value, index) => index > 0 && value <= sessionDerivedOrderingIndexes[index - 1])
  ) {
    throw new Error(`openreaper-start session-derived render-root safety ordering drifted: ${JSON.stringify(sessionDerivedOrderingIndexes)}`);
  }
  if (source.includes('exec "${REAPER_BIN}"')) {
    throw new Error("openreaper-start must not exec into REAPER; agent shell lifetime must not own the REAPER process.");
  }
  if (source.includes("LAUNCHER_SCRIPT=") || source.includes('reaper_args+=("${LAUNCHER_SCRIPT}")')) {
    throw new Error("openreaper-start must not pass a generated bridge launcher script to REAPER.");
  }
  if (source.includes("pcall(dofile, bridge)")) {
    throw new Error("openreaper-start must not rely on command-line ReaScript to keep the bridge alive.");
  }
  if (source.includes("--no-dialog-guard") || source.includes("dialog guard")) {
    throw new Error("openreaper-start must use the narrow startup dialog assist wording, not the old dialog guard route.");
  }
  if (source.includes('"${PROJECT_PATH}" "${BRIDGE_SCRIPT}"') || source.includes('"${BRIDGE_SCRIPT}" "${ARGS[@]}"')) {
    throw new Error("openreaper-start must not rely on passing the bridge script directly to REAPER.");
  }
  if (source.includes('wt contains "License"') || source.includes('wt contains "license"')) {
    throw new Error("openreaper-start must not treat an already-licensed REAPER main window title as a blocking license dialog.");
  }
  const renderPropagationSmoke = skipSmoke
    ? { skipped: true, reason: "skip_smoke" }
    : await smokePackagedStartRenderPropagation(startHelperPath);
  const installerSource = await readFile(path.join(packageRoot, "installer", "install-openreaper.mjs"), "utf8");
  const doctorSource = await readFile(path.join(packageRoot, "bin", "openreaper-doctor"), "utf8");
  const readmeSource = await readFile(path.join(packageRoot, "README.txt"), "utf8");
  for (const [label, text] of [
    ["installer", installerSource],
    ["doctor", doctorSource],
    ["readme", readmeSource],
  ]) {
    if (!text.includes("OpenReaper: Start MCP bridge")) {
      throw new Error(`${label} must name the installed OpenReaper bridge action.`);
    }
    if (!text.includes("call_template(template.transport.read_state)")) {
      throw new Error(`${label} must tell the agent to run the live read probe after reconnect.`);
    }
    if (!text.includes("Project Settings") || !text.includes("Notes") || !text.includes("license/evaluation")) {
      throw new Error(`${label} must explain the narrow Project Notes assist and user-choice blocker windows.`);
    }
    if (!text.includes("agent") || !text.includes("Actions")) {
      throw new Error(`${label} must explain agent-first action launch and user fallback through REAPER Actions.`);
    }
    if (!text.includes("detached") || !text.includes("pid/log")) {
      throw new Error(`${label} must explain detached startup lifetime and pid/log recovery.`);
    }
    if (!text.includes("install.command") || !text.includes("openreaper-doctor")) {
      throw new Error(`${label} must explain agent-assisted upgrade/install and doctor verification.`);
    }
    if (!text.includes("Do not manually delete") && !text.includes("Do not delete")) {
      throw new Error(`${label} must tell agents not to manually delete an older install before upgrade.`);
    }
    if (text.includes("dismiss any REAPER startup/version/recovery/plugin dialog")) {
      throw new Error(`${label} must not regress to manual-only startup dialog wording.`);
    }
    if (text.includes("version notifications and project notes may be cleared")) {
      throw new Error(`${label} must not promise automatic version-notification dismissal.`);
    }
  }
  for (const required of [
    "needsClientConfigRefresh",
    "report.migration_actions.length > 0",
    "const doctorCommand = path.join(installRoot",
    "newer downloaded OpenReaper package's install.command",
  ]) {
    if (!doctorSource.includes(required)) {
      throw new Error(`doctor must keep upgrade/config-refresh guidance wired to the active install: ${required}`);
    }
  }
  if (doctorSource.includes("Run the current OpenReaper alpha install.command")) {
    throw new Error("doctor must not tell agents to run the installed package as the upgrade source.");
  }
  return {
    ok: true,
    default_session_root: "package_root/session",
    ignores_stale_low_level_env: true,
    managed_render_root: "package_root/session/renders",
    render_root_precedence: ["explicit --render-root", "persisted selection", "package_root/session/renders"],
    render_root_propagation_smoke: renderPropagationSmoke,
    starts_reaper_with_openreaper_env: true,
    macos_launchservices: true,
    launchservices_global_lock: "package_root/session/.openreaper-launchservices-env.lock",
    launchservices_lock_source_guard: true,
    bridge_action_required: true,
    bridge_action_name: "OpenReaper: Start MCP bridge",
    agent_should_try_to_run_action: true,
    startup_dialog_assist: "project_notes_only",
    connection_probe: "call_template(template.transport.read_state)",
    user_fallback: "Actions search Run",
    command_line_reascript_bridge: false,
    detached_from_agent_shell: true,
    waits_for_reaper_process: true,
    pid_file: "package_root/session/reaper.pid",
    log_dir: "package_root/session/logs",
    sws_required: false,
    explicit_override_options: ["--session-root", "--render-root", "--transport-dir", "--artifact-root", "--bridge-owner", "--bridge-generation", "--reaper-app"],
  };
}

async function smokePackagedStartRenderPropagation(startHelperPath) {
  const fixtureRoot = await mkdtemp(path.join("/tmp", "openreaper-b2-start-smoke-"));
  try {
    const installRoot = path.join(fixtureRoot, "install");
    const installedStart = path.join(installRoot, "bin", "openreaper-start");
    await mkdir(path.dirname(installedStart), { recursive: true });
    await mkdir(path.join(installRoot, "session"), { recursive: true });
    await cp(startHelperPath, installedStart);
    await chmod(installedStart, 0o755);
    const persistedRoot = path.join(fixtureRoot, "persisted 'quoted' renders");
    await mkdir(persistedRoot, { recursive: true });
    await writeFile(path.join(installRoot, "session", "managed-render-root.path"), `${persistedRoot}\n`, "utf8");

    const staleRoot = path.join(fixtureRoot, "stale-parent-renders");
    const persistedCapture = path.join(fixtureRoot, "direct-persisted.capture");
    await runFakeStart({
      startPath: installedStart,
      fixtureRoot,
      capturePath: persistedCapture,
      args: [],
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: staleRoot },
    });
    assertEqualText(await readFile(persistedCapture, "utf8"), persistedRoot, "direct start persisted render root");

    const explicitRoot = path.join(fixtureRoot, 'explicit "quoted" renders');
    const explicitCapture = path.join(fixtureRoot, "direct-explicit.capture");
    await runFakeStart({
      startPath: installedStart,
      fixtureRoot,
      capturePath: explicitCapture,
      args: ["--render-root", explicitRoot],
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: staleRoot },
    });
    assertEqualText(await readFile(explicitCapture, "utf8"), explicitRoot, "direct start explicit render root");

    const evidenceSession = path.join(fixtureRoot, "evidence-session");
    const sessionCapture = path.join(fixtureRoot, "direct-session.capture");
    await runFakeStart({
      startPath: installedStart,
      fixtureRoot,
      capturePath: sessionCapture,
      args: ["--session-root", evidenceSession],
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: staleRoot },
    });
    assertEqualText(
      await readFile(sessionCapture, "utf8"),
      path.join(evidenceSession, "renders"),
      "direct start explicit session render root",
    );

    const installedSessionRoot = path.join(installRoot, "session");
    const installedSessionCapture = path.join(fixtureRoot, "direct-installed-session.capture");
    await runFakeStart({
      startPath: installedStart,
      fixtureRoot,
      capturePath: installedSessionCapture,
      args: ["--session-root", installedSessionRoot],
      env: { OPENREAPER_LIVE_SMOKE_RENDER_ROOT: staleRoot },
    });
    assertEqualText(
      await readFile(installedSessionCapture, "utf8"),
      path.join(installedSessionRoot, "renders"),
      "direct start exact installed session default",
    );

    const forbiddenInstalledSessions = [
      ["install-root", installRoot],
      ["install-child", path.join(installRoot, "forbidden-session-child")],
      ["installed-transport", path.join(installRoot, "session", "transport")],
      ["installed-artifact", path.join(installRoot, "session", "artifacts")],
    ];
    for (const [label, sessionRoot] of forbiddenInstalledSessions) {
      await runFakeStartExpectFailure({
        startPath: installedStart,
        fixtureRoot,
        capturePath: path.join(fixtureRoot, `direct-${label}-session-overlap.capture`),
        args: ["--session-root", sessionRoot],
      });
      for (const rejectedSideEffect of [
        path.join(sessionRoot, "renders"),
        path.join(sessionRoot, "logs"),
        path.join(sessionRoot, "transport", "requests"),
        path.join(sessionRoot, "transport", "results"),
        path.join(sessionRoot, "artifacts"),
      ]) {
        try {
          await access(rejectedSideEffect, fsConstants.F_OK);
          throw new Error(`packaged start created a rejected session-root side effect: ${rejectedSideEffect}`);
        } catch (error) {
          if (error?.code !== "ENOENT") throw error;
        }
      }
    }

    const transportCollisionRoot = path.join(fixtureRoot, "packaged-transport-render-collision");
    const transportOverlapRejected = await runFakeStartExpectFailure({
      startPath: installedStart,
      fixtureRoot,
      capturePath: path.join(fixtureRoot, "direct-transport-overlap.capture"),
      args: ["--render-root", transportCollisionRoot, "--transport-dir", transportCollisionRoot],
    });
    const artifactCollisionRoot = path.join(fixtureRoot, "packaged-artifact-render-collision");
    const artifactOverlapRejected = await runFakeStartExpectFailure({
      startPath: installedStart,
      fixtureRoot,
      capturePath: path.join(fixtureRoot, "direct-artifact-overlap.capture"),
      args: ["--render-root", artifactCollisionRoot, "--artifact-root", artifactCollisionRoot],
    });
    for (const rejectedRoot of [transportCollisionRoot, artifactCollisionRoot]) {
      try {
        await access(rejectedRoot, fsConstants.F_OK);
        throw new Error(`packaged start created rejected effective-root overlap: ${rejectedRoot}`);
      } catch (error) {
        if (error?.code !== "ENOENT") throw error;
      }
    }

    await writeFile(path.join(installRoot, "session", "managed-render-root.path"), "/tmp/one\n/tmp/two\n", "utf8");
    const invalidRecordRejected = await runFakeStartExpectFailure({
      startPath: installedStart,
      fixtureRoot,
      capturePath: path.join(fixtureRoot, "direct-invalid-record.capture"),
    });

    const launchServices = await smokeFakeLaunchServicesRenderPropagation({
      source: await readFile(startHelperPath, "utf8"),
      fixtureRoot,
      selectedRoot: explicitRoot,
    });
    return {
      ok: true,
      stale_parent_env_ignored: true,
      direct_persisted: persistedRoot,
      direct_explicit: explicitRoot,
      explicit_session_derived: path.join(evidenceSession, "renders"),
      exact_installed_session_default_allowed: path.join(installedSessionRoot, "renders"),
      install_scoped_session_roots_rejected_before_launch: forbiddenInstalledSessions.map(([label]) => label),
      session_derived_overlap_source_order_guard: true,
      invalid_record_rejected_before_launch: invalidRecordRejected,
      effective_transport_overlap_rejected_before_launch: transportOverlapRejected,
      effective_artifact_overlap_rejected_before_launch: artifactOverlapRejected,
      launchservices: launchServices,
    };
  } finally {
    await assertNoActivePackageFixtureProcesses(fixtureRoot);
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function runFakeStart({ startPath, fixtureRoot, capturePath, args, env }) {
  const fakeBinary = path.join(fixtureRoot, `fake-reaper-${path.basename(capturePath)}`);
  const fakePidPath = `${fakeBinary}.pid`;
  const fakeExitedPath = `${fakeBinary}.exited`;
  await writeFile(fakeBinary, `#!/bin/zsh\nprint -rn -- "$$" > ${shellQuote(fakePidPath)}\nprint -r -- "$OPENREAPER_LIVE_SMOKE_RENDER_ROOT" > ${shellQuote(capturePath)}\nprint -rn -- "exited" > ${shellQuote(fakeExitedPath)}\n`, "utf8");
  await chmod(fakeBinary, 0o755);
  let result;
  try {
    result = await runCaptured(startPath, [
      "--reaper-binary",
      fakeBinary,
      "--no-startup-dialog-assist",
      ...args,
    ], {
      cwd: fixtureRoot,
      env: {
        ...process.env,
        ...env,
        OPENREAPER_START_WAIT_SECONDS: "0",
      },
    });
    if (result.code !== 0) {
      throw new Error(`fake direct openreaper-start failed: ${result.stderr || result.stdout}`);
    }
    await waitForFile(capturePath);
    await waitForFile(fakeExitedPath);
    const renderLines = result.stdout.split(/\r?\n/).filter((line) => line.includes("render-root="));
    if (renderLines.length !== 1) {
      throw new Error(`openreaper-start must print exactly one render-root=<path> line, saw ${JSON.stringify(renderLines)}`);
    }
  } finally {
    await reapFixtureProcess({
      pidPath: fakePidPath,
      exitedPath: fakeExitedPath,
      expectedStart: result?.code === 0,
      label: `direct fake REAPER ${path.basename(capturePath)}`,
    });
  }
}

async function runFakeStartExpectFailure({ startPath, fixtureRoot, capturePath, args = [] }) {
  const fakeBinary = path.join(fixtureRoot, `fake-reaper-${path.basename(capturePath)}`);
  const fakePidPath = `${fakeBinary}.pid`;
  const fakeExitedPath = `${fakeBinary}.exited`;
  await writeFile(fakeBinary, `#!/bin/zsh\nprint -rn -- "$$" > ${shellQuote(fakePidPath)}\nprint -r -- "$OPENREAPER_LIVE_SMOKE_RENDER_ROOT" > ${shellQuote(capturePath)}\nprint -rn -- "exited" > ${shellQuote(fakeExitedPath)}\n`, "utf8");
  await chmod(fakeBinary, 0o755);
  let result;
  try {
    result = await runCaptured(startPath, [
      "--reaper-binary",
      fakeBinary,
      "--no-startup-dialog-assist",
      ...args,
    ], {
      cwd: fixtureRoot,
      env: { ...process.env, OPENREAPER_START_WAIT_SECONDS: "0" },
    });
    if (result.code !== 2 || !result.stderr.includes("render-root validation failed")) {
      throw new Error(`invalid packaged start record did not fail closed: ${result.stderr || result.stdout}`);
    }
    try {
      await access(capturePath, fsConstants.F_OK);
      throw new Error("invalid packaged start record reached the fake executable");
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    return true;
  } finally {
    await reapFixtureProcess({
      pidPath: fakePidPath,
      exitedPath: fakeExitedPath,
      expectedStart: false,
      label: `rejected fake REAPER ${path.basename(capturePath)}`,
    });
  }
}

async function smokeFakeLaunchServicesRenderPropagation({ source, fixtureRoot, selectedRoot }) {
  const lsRoot = path.join(fixtureRoot, "launchservices");
  const installRoot = path.join(lsRoot, "install");
  const binRoot = path.join(lsRoot, "fixture-bin");
  const stateRoot = path.join(lsRoot, "launchctl-state");
  const launchctlPath = path.join(binRoot, "launchctl");
  const openPath = path.join(binRoot, "open");
  const unamePath = path.join(binRoot, "uname");
  const transformedStart = path.join(installRoot, "bin", "openreaper-start");
  const fakeApp = path.join(lsRoot, "FakeREAPER.app");
  const fakeBinary = path.join(fakeApp, "Contents", "MacOS", "REAPER");
  const capturePath = path.join(lsRoot, "launchservices.capture");
  const fakePidPath = path.join(lsRoot, "launchservices-fake-reaper.pid");
  const fakeReleasePath = path.join(lsRoot, "release-launchservices-fake-reaper");
  const fakeExitedPath = path.join(lsRoot, "launchservices-fake-reaper.exited");
  const fakeLaunchRequestPath = path.join(lsRoot, "launchservices-fake-reaper.requested");
  const keys = [
    "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
    "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
    "OPENREAPER_ARTIFACT_ROOT",
    "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT",
    "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
    "OPENREAPER_LIVE_BRIDGE_OWNER",
    "OPENREAPER_LIVE_BRIDGE_GENERATION",
  ];
  await mkdir(path.dirname(transformedStart), { recursive: true });
  await mkdir(path.dirname(fakeBinary), { recursive: true });
  await mkdir(binRoot, { recursive: true });
  await mkdir(stateRoot, { recursive: true });
  await writeFile(
    transformedStart,
    source
      .replace('LAUNCHCTL_BIN="/bin/launchctl"', `LAUNCHCTL_BIN=${shellQuote(launchctlPath)}`)
      .replace('OPEN_BIN="/usr/bin/open"', `OPEN_BIN=${shellQuote(openPath)}`),
    "utf8",
  );
  await writeFile(unamePath, "#!/bin/zsh\necho Darwin\n", "utf8");
  await writeFile(launchctlPath, `#!/bin/zsh
set -eu
state=${shellQuote(stateRoot)}
case "$1" in
  getenv)
    [[ -f "$state/$2.presence" && "$(cat "$state/$2.presence")" == "set" ]] || exit 1
    cat "$state/$2.value"
    ;;
  setenv)
    print -rn -- "set" > "$state/$2.presence"
    print -rn -- "$3" > "$state/$2.value"
    ;;
  unsetenv)
    print -rn -- "unset" > "$state/$2.presence"
    : > "$state/$2.value"
    ;;
esac
`, "utf8");
  const openExports = keys.map((key) => `if [[ -f ${shellQuote(path.join(stateRoot, `${key}.presence`))} && "$(cat ${shellQuote(path.join(stateRoot, `${key}.presence`))})" == "set" ]]; then export ${key}="$(cat ${shellQuote(path.join(stateRoot, `${key}.value`))})"; else unset ${key}; fi`).join("\n");
  await writeFile(openPath, `#!/bin/zsh
set -eu
app="$2"
shift 3
${openExports}
print -rn -- "requested" > ${shellQuote(fakeLaunchRequestPath)}
nohup "$app/Contents/MacOS/REAPER" "$@" >/dev/null 2>&1 &
`, "utf8");
  await writeFile(fakeBinary, `#!/bin/zsh\nprint -rn -- "$$" > ${shellQuote(fakePidPath)}\nprint -r -- "$OPENREAPER_LIVE_SMOKE_RENDER_ROOT" > ${shellQuote(capturePath)}\nfixture_wait_attempt=0\nwhile [[ ! -f ${shellQuote(fakeReleasePath)} && \${fixture_wait_attempt} -lt 200 ]]; do\n  sleep 0.05\n  fixture_wait_attempt=$(( fixture_wait_attempt + 1 ))\ndone\nprint -rn -- "exited" > ${shellQuote(fakeExitedPath)}\n`, "utf8");
  await Promise.all([transformedStart, unamePath, launchctlPath, openPath, fakeBinary].map((file) => chmod(file, 0o755)));

  const previousTransport = "previous transport with spaces";
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.presence"), "set", "utf8");
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.value"), previousTransport, "utf8");
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_SMOKE_RENDER_ROOT.presence"), "set", "utf8");
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_SMOKE_RENDER_ROOT.value"), "", "utf8");
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_OWNER.presence"), "unset", "utf8");
  await writeFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_OWNER.value"), "", "utf8");

  let result;
  let smokeResult = null;
  let reapedPid = null;
  try {
    result = await runCaptured(transformedStart, [
      "--reaper-app",
      fakeApp,
      "--render-root",
      selectedRoot,
      "--no-startup-dialog-assist",
    ], {
      cwd: lsRoot,
      env: {
        ...process.env,
        PATH: `${binRoot}:${process.env.PATH ?? ""}`,
        OPENREAPER_START_WAIT_SECONDS: "1",
        OPENREAPER_LIVE_SMOKE_RENDER_ROOT: path.join(lsRoot, "stale-parent-root"),
      },
    });
    if (result.code !== 0) {
      throw new Error(`fake LaunchServices openreaper-start failed: ${result.stderr || result.stdout}`);
    }
    await waitForFile(capturePath);
    assertEqualText(await readFile(capturePath, "utf8"), selectedRoot, "LaunchServices selected render root");
    assertEqualText(await readFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.value"), "utf8"), previousTransport, "LaunchServices spaced value restoration");
    assertEqualText(await readFile(path.join(stateRoot, "OPENREAPER_LIVE_SMOKE_RENDER_ROOT.presence"), "utf8"), "set", "LaunchServices empty value presence restoration");
    assertEqualText(await readFile(path.join(stateRoot, "OPENREAPER_LIVE_SMOKE_RENDER_ROOT.value"), "utf8"), "", "LaunchServices empty value restoration");
    assertEqualText(await readFile(path.join(stateRoot, "OPENREAPER_LIVE_BRIDGE_OWNER.presence"), "utf8"), "unset", "LaunchServices unset presence restoration");
    const stableLockPath = path.join(installRoot, "session", ".openreaper-launchservices-env.lock");
    try {
      await access(stableLockPath, fsConstants.F_OK);
      throw new Error(`successful LaunchServices smoke left the stable lock or snapshot behind: ${stableLockPath}`);
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
    smokeResult = {
      selected_root_propagated: true,
      spaced_value_restored: true,
      empty_but_set_restored: true,
      unset_restored: true,
      stable_lock_and_snapshot_removed: true,
      global_lock_source_guard: true,
      getenv_setenv_restore_unset: true,
    };
  } finally {
    reapedPid = await reapFixtureProcess({
      pidPath: fakePidPath,
      releasePath: fakeReleasePath,
      exitedPath: fakeExitedPath,
      launchRequestPath: fakeLaunchRequestPath,
      expectedStart: result?.code === 0,
      label: "packaged LaunchServices fake REAPER",
    });
  }
  smokeResult.fake_process_reaped = Number.isInteger(reapedPid);
  smokeResult.marker_timeout_cleanup = await smokeFixtureMarkerTimeoutCleanup(lsRoot);
  return smokeResult;

}

async function smokeFixtureMarkerTimeoutCleanup(parentRoot) {
  const root = path.join(parentRoot, "marker-timeout-cleanup");
  const fakeBinary = path.join(root, "ignore-release-no-exit.cjs");
  const pidPath = path.join(root, "fake.pid");
  const releasePath = path.join(root, "release");
  const exitedPath = path.join(root, "never-written.exited");
  const evidence = {};
  let child = null;
  let childOutcome = null;
  await mkdir(root, { recursive: true });
  await writeFile(fakeBinary, `#!${process.execPath}
const fs = require("node:fs");
fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
process.on("SIGTERM", () => {});
setInterval(() => {}, 1000);
`, "utf8");
  await chmod(fakeBinary, 0o755);
  try {
    child = spawn(process.execPath, [fakeBinary], { cwd: root, detached: true, stdio: "ignore" });
    childOutcome = captureChildOutcome(child);
    await waitForFile(pidPath, { attempts: 100, delayMs: 10 });
    let markerError = null;
    try {
      await reapFixtureProcess({
        pidPath,
        releasePath,
        exitedPath,
        expectedStart: true,
        label: "packaged marker-timeout cleanup fake",
        waitBudget: {
          delayMs: 20,
          pidAttempts: 20,
          markerAttempts: 5,
          graceAttempts: 0,
          termAttempts: 10,
          killAttempts: 100,
        },
        evidence,
      });
    } catch (error) {
      markerError = error;
    }
    if (markerError === null || !String(markerError.message).includes(`Timed out waiting for fixture file: ${exitedPath}`)) {
      throw markerError ?? new Error("packaged marker-timeout cleanup fixture unexpectedly succeeded");
    }
    await waitForCapturedChildOutcome(childOutcome, "packaged marker-timeout cleanup fake", { attempts: 100, delayMs: 20 });
    if (isProcessAlive(child.pid)) throw new Error(`packaged marker-timeout cleanup fake ${child.pid} remained alive`);
    if (evidence.term_sent !== true || evidence.kill_sent !== true || evidence.process_exited !== true) {
      throw new Error(`packaged marker-timeout cleanup evidence incomplete: ${JSON.stringify(evidence)}`);
    }
    for (const markerPath of [pidPath, releasePath, exitedPath]) {
      if (await fileExists(markerPath)) throw new Error(`packaged marker-timeout cleanup left marker ${markerPath}`);
    }
    return {
      original_marker_failure_reported: true,
      term_sent: true,
      kill_sent: true,
      process_reaped: true,
      markers_removed_after_exit: true,
    };
  } finally {
    if (child?.pid && isProcessAlive(child.pid)) {
      try {
        process.kill(child.pid, "SIGKILL");
      } catch (error) {
        if (error?.code !== "ESRCH") throw error;
      }
    }
    if (childOutcome !== null) {
      await waitForCapturedChildOutcome(childOutcome, "packaged marker-timeout fallback cleanup", { attempts: 100, delayMs: 20 });
    }
    if (child?.pid && isProcessAlive(child.pid)) {
      throw new Error(`refusing to remove marker-timeout fixture while process ${child.pid} is alive`);
    }
    await rm(root, { recursive: true, force: true });
  }
}

async function smokePackagedInstallerUpgradeMigration() {
  const installerPath = path.join(packageRoot, "installer", "install-openreaper.mjs");
  const source = await readFile(installerPath, "utf8");
  const requiredSnippets = [
    "replaceInstallRoot",
    "upsertTomlSectionTree",
    "splitTomlSections",
    "tomlSectionName",
    "removeLegacyOpenReaperTomlSections",
    "isLegacyOpenReaperTomlSection",
    "installBridgeAction",
    "bridgeActionScriptSource",
    "upsertBridgeActionInReaperKb",
    "BRIDGE_ACTION_TITLE",
    "BRIDGE_ACTION_COMMAND_ID",
    "OpenReaper: Start MCP bridge",
    "openreaper-start-mcp-bridge.lua",
    "reaper.MB",
    "LEGACY_STARTUP_BLOCKS",
    "prior OpenReaper alpha startup hook",
    "legacy OpenReaper Alpha3 startup hook",
    "legacy Streetlight startup hook",
    "removeMarkedBlocks",
    "removeOptionalStartupHook",
    "inspectOptionalStartupCompatibility",
    "readIniValue",
    "OpenReaper does not require or take over SWS startup actions",
    "preserved existing SWS GlobalStartupAction",
    "managed-render-root.path",
    "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
    "prepareManagedRenderRoot",
    "boundedWriteProbe",
    "preservePreviousDefaultBeforeReplacement",
    "allocateSiblingContainer",
    "mkdtemp",
    "MANAGED_RENDER_ROOT_RECORD_MAX_BYTES",
    'TextDecoder("utf-8", { fatal: true })',
  ];
  for (const snippet of requiredSnippets) {
    if (!source.includes(snippet)) {
      throw new Error(`Packaged installer missing upgrade migration guard: ${snippet}`);
    }
  }
  if (source.includes("ShowConsoleMsg")) {
    throw new Error("Packaged bridge action must not open the ReaScript console on successful startup.");
  }
const codexLegacyFixture = `[mcp_servers.streetlight]
command = "node"
args = ["/tmp/legacy-streetlight-reaper-mcp/packages/mcp-server/dist/index.js"]

[mcp_servers.streetlight.env]
STREETLIGHT_QUEUE_DIR = "/tmp/legacy-streetlight-queue"

[mcp_servers.openreaper]
command = "node"
args = ["/tmp/legacy-streetlight-reaper-mcp/packages/mcp-server/dist/index.js"]

[mcp_servers.openreaper.env]
STREETLIGHT_QUEUE_DIR = "/tmp/legacy-streetlight-queue"

[mcp_servers.other]
command = "node"
args = ["/tmp/other.js"]
`;
  const migrated = simulateLegacyOpenReaperTomlCleanup(codexLegacyFixture);
  const forbidden = [
    "[mcp_servers.streetlight]",
    "[mcp_servers.streetlight.env]",
    "/tmp/legacy-streetlight-reaper-mcp/packages/mcp-server/dist/index.js",
    "STREETLIGHT_QUEUE_DIR",
  ];
  for (const marker of forbidden) {
    if (migrated.includes(marker)) {
      throw new Error(`Packaged installer migration fixture still contains stale Codex marker: ${marker}`);
    }
  }
  if (!migrated.includes("[mcp_servers.other]")) {
    throw new Error("Packaged installer migration fixture removed unrelated Codex MCP config");
  }
  const openReaperSection = `[mcp_servers.openreaper]
command = "/Users/example/.openreaper/current/bin/openreaper-mcp"
args = []

[mcp_servers.openreaper.env]
OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = "/Users/example/.openreaper/current/session/transport"
OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH = "/Users/example/.openreaper/current/vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"
OPENREAPER_ARTIFACT_ROOT = "/Users/example/.openreaper/current/session/artifacts"
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT = "/Users/example/.openreaper/current/session/artifacts"
OPENREAPER_LIVE_SMOKE_RENDER_ROOT = "/Users/example/.openreaper/current/session/renders"
OPENREAPER_LIVE_BRIDGE_OWNER = "openreaper-alpha"
OPENREAPER_LIVE_BRIDGE_GENERATION = "1"
`;
  const once = simulateTomlSectionTreeUpsert(migrated, "mcp_servers.openreaper", openReaperSection);
  const twice = simulateTomlSectionTreeUpsert(once, "mcp_servers.openreaper", openReaperSection);
  if ((twice.match(/\[mcp_servers\.openreaper\.env\]/g) ?? []).length !== 1) {
    throw new Error("Packaged installer Codex upsert must be idempotent and keep exactly one openreaper env section.");
  }
  if (!twice.includes("[mcp_servers.other]")) {
    throw new Error("Packaged installer Codex upsert removed unrelated MCP config.");
  }
  const interleavedTreeFixture = `[mcp_servers.openreaper] # prior package entry
command = "/tmp/old-openreaper-mcp"
args = []

[mcp_servers.other]
command = "node"
args = ["/tmp/other.js"]

[mcp_servers.openreaper.env] # child may legally appear after another table
STALE_OPENREAPER_ENV = "1"

[mcp_servers.openreaper.experimental]
STALE_OPENREAPER_CHILD = "1"

[mcp_servers.tail]
command = "node"
args = ["/tmp/tail.js"]
`;
  const replacedTree = simulateTomlSectionTreeUpsert(
    interleavedTreeFixture,
    "mcp_servers.openreaper",
    openReaperSection,
  );
  const replacedTreeTwice = simulateTomlSectionTreeUpsert(
    replacedTree,
    "mcp_servers.openreaper",
    openReaperSection,
  );
  assertSingleTomlSection(replacedTreeTwice, "mcp_servers.openreaper");
  assertSingleTomlSection(replacedTreeTwice, "mcp_servers.openreaper.env");
  if (replacedTreeTwice.includes("STALE_OPENREAPER_")) {
    throw new Error("Packaged installer Codex upsert left stale non-contiguous openreaper child sections.");
  }
  for (const unrelated of ["[mcp_servers.other]", "[mcp_servers.tail]"]) {
    if (!replacedTreeTwice.includes(unrelated)) {
      throw new Error(`Packaged installer Codex tree upsert removed unrelated section ${unrelated}.`);
    }
  }
  const childOnlyFixture = `[mcp_servers.openreaper.env]
STALE_CHILD_ONLY = "1"

[mcp_servers.other]
command = "node"
args = ["/tmp/other.js"]
`;
  const replacedChildOnly = simulateTomlSectionTreeUpsert(
    childOnlyFixture,
    "mcp_servers.openreaper",
    openReaperSection,
  );
  assertSingleTomlSection(replacedChildOnly, "mcp_servers.openreaper");
  assertSingleTomlSection(replacedChildOnly, "mcp_servers.openreaper.env");
  if (replacedChildOnly.includes("STALE_CHILD_ONLY")) {
    throw new Error("Packaged installer Codex upsert left an orphaned child-only openreaper section.");
  }
  const managedRenderRootFixture = skipSmoke
    ? { skipped: true, reason: "skip_smoke" }
    : await smokePackagedInstallerManagedRenderRoot(installerPath);
  return {
    ok: true,
    managed_render_root_fixture: managedRenderRootFixture,
    running_install_root_replacement: "rename_first",
    replaces_codex_parent_and_children: true,
    removes_legacy_mcp_config: true,
    removes_legacy_openreaper_alias_to_streetlight_kernel: true,
    removes_legacy_startup_hooks: true,
    installs_reaper_bridge_action: true,
    bridge_action_name: "OpenReaper: Start MCP bridge",
    agent_or_user_runs_bridge_action: true,
    sws_startup_optional: true,
    sws_required: false,
  };
}

async function smokePackagedInstallerManagedRenderRoot(installerPath) {
  const fixtureRoot = await mkdtemp(path.join("/tmp", "openreaper-b2-installer-smoke-"));
  try {
    const fixturePackage = path.join(fixtureRoot, "package", "OpenReaper-alpha");
    const fixtureInstaller = path.join(fixturePackage, "installer", "install-openreaper.mjs");
    const home = path.join(fixtureRoot, "home");
    const installRoot = path.join(home, ".openreaper", "current");
    const capturePath = path.join(fixtureRoot, "mcp-render-root.capture");
    await mkdir(path.dirname(fixtureInstaller), { recursive: true });
    await mkdir(path.join(fixturePackage, "bin"), { recursive: true });
    await mkdir(path.join(fixturePackage, "vendor", "openreaper-kernel", "reaper", "bridge"), { recursive: true });
    await cp(installerPath, fixtureInstaller);
    const mcpStub = `#!/bin/zsh\nprint -r -- "$OPENREAPER_LIVE_SMOKE_RENDER_ROOT" >> ${shellQuote(capturePath)}\necho "stdio server ready" >&2\n`;
    await writeFile(path.join(fixturePackage, "bin", "openreaper-mcp"), mcpStub, "utf8");
    for (const name of ["vital-agent-mcp", "openreaper-start", "openreaper-doctor"]) {
      await writeFile(path.join(fixturePackage, "bin", name), "#!/bin/zsh\nexit 0\n", "utf8");
    }
    await writeFile(path.join(fixturePackage, "install.command"), "#!/bin/zsh\n", "utf8");
    await writeFile(path.join(fixturePackage, "uninstall.command"), "#!/bin/zsh\n", "utf8");
    await writeFile(
      path.join(fixturePackage, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua"),
      "-- fixture only\n",
      "utf8",
    );
    await Promise.all((await readdir(path.join(fixturePackage, "bin"))).map((name) => chmod(path.join(fixturePackage, "bin", name), 0o755)));

    const installerArgs = [
      fixtureInstaller,
      "--install-root",
      installRoot,
      "--skip-client-config",
      "--skip-startup-hook",
    ];
    const fresh = await runCaptured(process.execPath, installerArgs, {
      cwd: fixturePackage,
      env: { ...process.env, HOME: home },
    });
    if (fresh.code !== 0) throw new Error(`packaged installer fresh fixture failed: ${fresh.stderr || fresh.stdout}`);
    const freshReport = parseInstallerJsonReport(fresh.stdout);
    const defaultRoot = path.join(installRoot, "session", "renders");
    assertEqualText(await readFile(path.join(installRoot, "session", "managed-render-root.path"), "utf8"), defaultRoot, "installer persisted render root");
    if (!freshReport.render_root?.created || freshReport.render_root?.writable !== true || freshReport.render_root?.source !== "default") {
      throw new Error(`packaged installer fresh managed render report mismatch: ${JSON.stringify(freshReport.render_root)}`);
    }
    const outputPath = path.join(defaultRoot, "existing-output.wav");
    await writeFile(outputPath, "preserve-me\n", "utf8");

    const upgrade = await runCaptured(process.execPath, installerArgs, {
      cwd: fixturePackage,
      env: { ...process.env, HOME: home },
    });
    if (upgrade.code !== 0) throw new Error(`packaged installer upgrade fixture failed: ${upgrade.stderr || upgrade.stdout}`);
    const upgradeReport = parseInstallerJsonReport(upgrade.stdout);
    assertEqualText(await readFile(outputPath, "utf8"), "preserve-me", "installer default render output preservation");
    if (upgradeReport.render_root?.source !== "persisted" || upgradeReport.render_root?.writable !== true) {
      throw new Error(`packaged installer upgrade render report mismatch: ${JSON.stringify(upgradeReport.render_root)}`);
    }
    const capturedRoots = (await readFile(capturePath, "utf8")).trim().split(/\r?\n/);
    if (capturedRoots.length !== 2 || capturedRoots.some((value) => value !== defaultRoot)) {
      throw new Error(`installer MCP smoke did not receive selected render root: ${JSON.stringify(capturedRoots)}`);
    }
    const markerPath = path.join(installRoot, "package-smoke-marker.txt");
    await writeFile(markerPath, "keep-installed\n", "utf8");
    await writeFile(path.join(installRoot, "session", "managed-render-root.path"), "/tmp/one\n/tmp/two\n", "utf8");
    const invalidRecord = await runCaptured(process.execPath, installerArgs, {
      cwd: fixturePackage,
      env: { ...process.env, HOME: home },
    });
    if (invalidRecord.code === 0 || !invalidRecord.stderr.includes("exactly one")) {
      throw new Error(`packaged installer invalid record did not fail closed: ${invalidRecord.stderr || invalidRecord.stdout}`);
    }
    assertEqualText(await readFile(markerPath, "utf8"), "keep-installed", "installer invalid-record replacement guard");
    assertEqualText(await readFile(outputPath, "utf8"), "preserve-me", "installer invalid-record output guard");
    return {
      ok: true,
      default_root: defaultRoot,
      persisted_record: path.join(installRoot, "session", "managed-render-root.path"),
      existing_output_preserved: true,
      installer_mcp_smoke_env: true,
      invalid_record_rejected_before_replacement: true,
      atomic_backup_container: /\.openreaper-install-backup-/.test(upgradeReport.recovery?.previous_install_backup ?? ""),
      safety_flags: ["--skip-client-config", "--skip-startup-hook"],
    };
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

function parseInstallerJsonReport(stdout) {
  const marker = "\n\nOpenReaper alpha ";
  const end = stdout.indexOf(marker);
  if (end === -1) throw new Error(`installer fixture output did not contain report marker: ${stdout.slice(0, 500)}`);
  return JSON.parse(stdout.slice(0, end));
}

async function smokePackagedPortablePaths() {
  const forbiddenMarkers = [
    process.env.HOME,
    repoRoot,
    vitalAgentRoot,
  ]
    .filter((value) => typeof value === "string" && value.trim() !== "")
    .map((value) => path.resolve(value));
  const hits = [];
  let scannedFiles = 0;
  for (const filePath of await collectPackageTextFiles(packageRoot)) {
    scannedFiles += 1;
    const text = await readFile(filePath, "utf8");
    for (const marker of forbiddenMarkers) {
      if (text.includes(marker)) {
        hits.push({
          file: path.relative(packageRoot, filePath),
          marker,
        });
      }
    }
  }
  if (hits.length > 0) {
    throw new Error(`Packaged zip would contain developer-machine absolute paths: ${JSON.stringify(hits)}`);
  }
  return {
    ok: true,
    scanned_text_files: scannedFiles,
    forbids_developer_home_paths: true,
    install_paths_are_computed_on_target_machine: true,
    mcp_client_configs_use_target_machine_absolute_commands: true,
  };
}

async function collectPackageTextFiles(root) {
  const files = [];
  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      files.push(...await collectPackageTextFiles(fullPath));
      continue;
    }
    if (entry.isFile() && shouldScanPackageTextFile(fullPath)) {
      files.push(fullPath);
    }
  }
  return files;
}

function shouldScanPackageTextFile(filePath) {
  const extension = path.extname(filePath).toLowerCase();
  return new Set([
    "",
    ".command",
    ".json",
    ".js",
    ".lua",
    ".mjs",
    ".sh",
    ".txt",
  ]).has(extension);
}

function simulateLegacyOpenReaperTomlCleanup(existing) {
  const lines = existing.split(/\r?\n/);
  const sections = [];
  let current = { header: null, lines: [] };
  for (const line of lines) {
    if (/^\s*\[[^\]]+\]\s*$/.test(line)) {
      sections.push(current);
      current = { header: line.trim(), lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  sections.push(current);
  const kept = sections.filter((section) => {
    const body = section.lines.join("\n");
    if (section.header === "[mcp_servers.streetlight]") return false;
    if (section.header === "[mcp_servers.streetlight.env]") return false;
    if (section.header === "[mcp_servers.openreaper]" && isLegacyOpenReaperTomlSectionForPackageSmoke(body)) return false;
    if (section.header === "[mcp_servers.openreaper.env]" && isLegacyOpenReaperTomlSectionForPackageSmoke(body)) return false;
    return true;
  });
  return `${kept.map((section) => section.lines.join("\n").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function simulateTomlSectionTreeUpsert(existing, sectionName, sectionText) {
  const sections = splitTomlSectionsForPackageSmoke(existing);
  const matchesTree = (section) =>
    section.name === sectionName || section.name?.startsWith(`${sectionName}.`);
  if (!sections.some(matchesTree)) {
    const prefix = existing.trimEnd();
    return prefix === "" ? `${sectionText.trimEnd()}\n` : `${prefix}\n\n${sectionText.trimEnd()}\n`;
  }

  const replacement = {
    name: sectionName,
    lines: sectionText.trimEnd().split("\n"),
  };
  const nextSections = [];
  let inserted = false;
  for (const section of sections) {
    if (matchesTree(section)) {
      if (!inserted) {
        nextSections.push(replacement);
        inserted = true;
      }
      continue;
    }
    nextSections.push(section);
  }

  const nextLines = nextSections.flatMap((section) => section.lines);
  return `${nextLines.join("\n").trimEnd()}\n`;
}

function splitTomlSectionsForPackageSmoke(existing) {
  const sections = [];
  let current = { name: null, lines: [] };
  for (const line of existing.split(/\r?\n/)) {
    const name = tomlSectionNameForPackageSmoke(line);
    if (name !== null) {
      if (current.name !== null || current.lines.some((currentLine) => currentLine !== "")) {
        sections.push(current);
      }
      current = { name, lines: [line] };
    } else {
      current.lines.push(line);
    }
  }
  if (current.name !== null || current.lines.some((line) => line !== "")) {
    sections.push(current);
  }
  return sections;
}

function tomlSectionNameForPackageSmoke(line) {
  const arrayTable = line.match(/^\s*\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/);
  if (arrayTable) return arrayTable[1].trim();
  const table = line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/);
  return table ? table[1].trim() : null;
}

function assertSingleTomlSection(source, sectionName) {
  const count = splitTomlSectionsForPackageSmoke(source)
    .filter((section) => section.name === sectionName)
    .length;
  if (count !== 1) {
    throw new Error(`Packaged installer Codex upsert expected one [${sectionName}] section, found ${count}.`);
  }
}

function isLegacyOpenReaperTomlSectionForPackageSmoke(text) {
  return /streetlight-reaper-mcp|packages\/mcp-server\/dist\/index\.js|STREETLIGHT_/i.test(text);
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
  if (guidance.requirements?.bridge_action_required_after_start !== true) {
    throw new Error(`${label} must require the bridge action after openreaper-start`);
  }
  if (guidance.requirements?.live_probe_required_before_success_claim !== true) {
    throw new Error(`${label} must require a live read probe before claiming the bridge is connected`);
  }
  if (guidance.bridge_action?.installed_action_name !== "OpenReaper: Start MCP bridge") {
    throw new Error(`${label} must name the installed bridge action`);
  }
  if (guidance.bridge_action?.agent_should_try_to_run_action !== true) {
    throw new Error(`${label} must tell the agent to try running the bridge action first`);
  }
  if (guidance.bridge_action?.sws_required !== false) {
    throw new Error(`${label} must not require SWS for bridge startup`);
  }
  if (guidance.bridge_action?.command_line_reascript_bridge !== false) {
    throw new Error(`${label} must not claim command-line ReaScript can own bridge startup`);
  }
  if (guidance.bridge_action?.verification_probe !== "call_template(template.transport.read_state)") {
    throw new Error(`${label} must name the bridge connection verification probe`);
  }
  if (!guidance.startup_dialog_assist?.auto_dismisses?.includes("project_settings_notes_show_notes_on_project_load")) {
    throw new Error(`${label} must limit automatic startup dialog assist to Project Settings / Notes`);
  }
  for (const blocker of ["license_or_evaluation", "recovery", "plugin_or_fx", "version_notice", "unknown_reaper_window"]) {
    if (!guidance.startup_dialog_assist?.does_not_dismiss?.includes(blocker)) {
      throw new Error(`${label} must not auto-dismiss ${blocker}`);
    }
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

function assertEqualText(actual, expected, label) {
  if (actual.trimEnd() !== expected) {
    throw new Error(`${label} mismatch: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual.trimEnd())}`);
  }
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}

export async function reapFixtureProcess({
  pidPath,
  releasePath = null,
  exitedPath,
  launchRequestPath = null,
  expectedStart = false,
  label,
  waitBudget = {},
  evidence = {},
}) {
  const budget = {
    delayMs: waitBudget.delayMs ?? 25,
    pidAttempts: waitBudget.pidAttempts ?? 400,
    markerAttempts: waitBudget.markerAttempts ?? 400,
    graceAttempts: waitBudget.graceAttempts ?? 200,
    termAttempts: waitBudget.termAttempts ?? 80,
    killAttempts: waitBudget.killAttempts ?? 80,
  };
  const launchRequested = launchRequestPath !== null && await fileExists(launchRequestPath);
  const pidAlreadyPresent = await fileExists(pidPath);
  evidence.expected_start = expectedStart === true;
  evidence.launch_requested = launchRequested;
  evidence.pid_already_present = pidAlreadyPresent;
  if (!expectedStart && !launchRequested && !pidAlreadyPresent) {
    evidence.no_start_fast_path = true;
    return null;
  }

  ACTIVE_PACKAGE_FIXTURE_PROCESSES.set(pidPath, { label, pidPath, pid: null });
  let pid = null;
  let primaryError = null;
  let cleanupError = null;
  let processExited = false;
  try {
    try {
      await waitForFile(pidPath, { attempts: budget.pidAttempts, delayMs: budget.delayMs });
      const pidText = (await readFile(pidPath, "utf8")).trim();
      if (!/^[1-9]\d{0,9}$/.test(pidText)) throw new Error(`invalid fixture pid in ${pidPath}`);
      pid = Number(pidText);
      evidence.pid = pid;
      evidence.pid_observed = true;
      ACTIVE_PACKAGE_FIXTURE_PROCESSES.set(pidPath, { label, pidPath, pid });
    } catch (error) {
      primaryError = error;
    }

    if (pid !== null) {
      try {
        if (releasePath !== null) {
          await writeFile(releasePath, "release\n", "utf8");
          evidence.release_written = true;
        }
        await waitForFile(exitedPath, { attempts: budget.markerAttempts, delayMs: budget.delayMs });
        evidence.exit_marker_observed = true;
      } catch (error) {
        primaryError ??= error;
        evidence.exit_marker_observed = false;
      }
    }
  } finally {
    if (pid !== null) {
      try {
        await waitForProcessExit(pid, label, {
          delayMs: budget.delayMs,
          graceAttempts: primaryError === null ? budget.graceAttempts : 0,
          termAttempts: budget.termAttempts,
          killAttempts: budget.killAttempts,
          evidence,
        });
        processExited = true;
        evidence.process_exited = true;
        ACTIVE_PACKAGE_FIXTURE_PROCESSES.delete(pidPath);
      } catch (error) {
        cleanupError = error;
        evidence.process_exited = false;
      }
    }

    if (processExited) {
      const cleanupOrder = [];
      for (const [kind, target] of [
        ["exited_marker", exitedPath],
        ["release_marker", releasePath],
        ["launch_request_marker", launchRequestPath],
        ["pid_marker", pidPath],
      ]) {
        if (target === null) continue;
        try {
          await rm(target, { force: true });
          cleanupOrder.push(kind);
        } catch (error) {
          cleanupError ??= error;
        }
      }
      evidence.marker_cleanup_order = cleanupOrder;
    }
  }

  if (primaryError !== null) {
    if (cleanupError !== null) {
      throw new AggregateError([primaryError, cleanupError], primaryError.message, { cause: primaryError });
    }
    throw primaryError;
  }
  if (cleanupError !== null) throw cleanupError;
  return pid;
}

async function fileExists(filePath) {
  try {
    await access(filePath, fsConstants.F_OK);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForProcessExit(pid, label, {
  delayMs = 25,
  graceAttempts = 200,
  termAttempts = 80,
  killAttempts = 80,
  evidence = {},
} = {}) {
  if (await waitForDeadPid(pid, graceAttempts, delayMs)) return;
  try {
    process.kill(pid, "SIGTERM");
    evidence.term_sent = true;
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  if (await waitForDeadPid(pid, termAttempts, delayMs)) return;
  try {
    process.kill(pid, "SIGKILL");
    evidence.kill_sent = true;
  } catch (error) {
    if (error?.code === "ESRCH") return;
    throw error;
  }
  if (await waitForDeadPid(pid, killAttempts, delayMs)) return;
  throw new Error(`${label} fixture process ${pid} did not exit after bounded cleanup`);
}

async function waitForDeadPid(pid, attempts, delayMs) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (!isProcessAlive(pid)) return true;
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  return !isProcessAlive(pid);
}

function captureChildOutcome(child) {
  let settled = false;
  return new Promise((resolve) => {
    const settle = (outcome) => {
      if (settled) return;
      settled = true;
      resolve(outcome);
    };
    child.once("error", (error) => settle({ error }));
    child.once("close", (code, signal) => settle({ code, signal }));
  });
}

async function waitForCapturedChildOutcome(outcomePromise, label, { attempts = 100, delayMs = 20 } = {}) {
  let settled = false;
  let outcome = null;
  void outcomePromise.then((value) => {
    settled = true;
    outcome = value;
  });
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (settled) {
      if (outcome?.error) throw outcome.error;
      return outcome;
    }
    await new Promise((resolve) => setTimeout(resolve, delayMs));
  }
  throw new Error(`${label} child did not emit close/error after bounded cleanup`);
}

async function assertNoActivePackageFixtureProcesses(fixtureRoot) {
  const active = [];
  for (const [pidPath, record] of ACTIVE_PACKAGE_FIXTURE_PROCESSES) {
    if (record.pid !== null && !isProcessAlive(record.pid)) {
      ACTIVE_PACKAGE_FIXTURE_PROCESSES.delete(pidPath);
      continue;
    }
    const relative = path.relative(fixtureRoot, record.pidPath);
    if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
      active.push(`${record.label}:${record.pid ?? "pending-pid"}`);
    }
  }
  if (active.length > 0) {
    throw new Error(`refusing to remove package fixture root with active processes: ${active.join(", ")}`);
  }
}

function runCaptured(command, args, {
  cwd,
  env,
  timeoutMs = null,
  cleanupProcessGroup = false,
  signal = null,
  label = command,
  onSpawn = null,
}) {
  return new Promise((resolve, reject) => {
    const ownsProcessGroup = cleanupProcessGroup === true && process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      env,
      detached: ownsProcessGroup,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let cleanupPromise = null;
    let timer = null;
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });

    const clearWatchers = () => {
      if (timer !== null) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    };
    const cleanup = (reason) => {
      cleanupPromise ??= cleanupCapturedChild(child, {
        ownsProcessGroup,
        label,
        reason,
      });
      return cleanupPromise;
    };
    const failAfterCleanup = async (code, message, reason) => {
      if (settled) return;
      settled = true;
      clearWatchers();
      let cleanupEvidence;
      try {
        cleanupEvidence = await cleanup(reason);
      } catch (cleanupError) {
        const error = new AggregateError([new Error(message), cleanupError], message);
        error.code = code;
        error.stdout = stdout;
        error.stderr = stderr;
        reject(error);
        return;
      }
      const error = new Error(message);
      error.code = code;
      error.stdout = stdout;
      error.stderr = stderr;
      error.cleanup = cleanupEvidence;
      reject(error);
    };
    const onAbort = () => {
      void failAfterCleanup(
        "OPENREAPER_FIXTURE_ABORTED",
        `${label} aborted`,
        "abort",
      );
    };

    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearWatchers();
      reject(error);
    });
    child.once("spawn", () => {
      if (onSpawn === null) return;
      void Promise.resolve(onSpawn(child)).catch((error) => {
        void failAfterCleanup(
          "OPENREAPER_FIXTURE_SPAWN_HOOK_FAILED",
          `${label} spawn hook failed: ${String(error?.message ?? error)}`,
          "spawn_hook_failure",
        );
      });
    });

    child.once("close", (code, closeSignal) => {
      if (settled) return;
      settled = true;
      clearWatchers();
      void (async () => {
        try {
          const cleanupEvidence = cleanupProcessGroup
            ? await cleanup("normal_finish")
            : null;
          resolve({ code, signal: closeSignal, stdout, stderr, cleanup: cleanupEvidence });
        } catch (error) {
          reject(error);
        }
      })();
    });

    if (signal !== null) {
      if (signal.aborted) onAbort();
      else signal.addEventListener("abort", onAbort, { once: true });
    }
    if (Number.isFinite(timeoutMs) && timeoutMs > 0) {
      timer = setTimeout(() => {
        void failAfterCleanup(
          "OPENREAPER_FIXTURE_TIMEOUT",
          `${label} exceeded bounded timeout ${timeoutMs}ms`,
          "timeout",
        );
      }, timeoutMs);
    }
  });
}

async function cleanupCapturedChild(child, { ownsProcessGroup, label, reason }) {
  const pid = child.pid;
  const evidence = {
    reason,
    pid: Number.isSafeInteger(pid) ? pid : null,
    process_group_owned: ownsProcessGroup,
    term_sent: false,
    kill_sent: false,
    process_group_exited: false,
  };
  if (!Number.isSafeInteger(pid) || pid <= 0) return evidence;
  const target = ownsProcessGroup ? -pid : pid;
  if (await waitForSignalTargetExit(target, 100)) {
    evidence.process_group_exited = true;
    return evidence;
  }
  evidence.term_sent = signalProcessTarget(target, "SIGTERM");
  if (await waitForSignalTargetExit(target, 750)) {
    evidence.process_group_exited = true;
    return evidence;
  }
  evidence.kill_sent = signalProcessTarget(target, "SIGKILL");
  if (await waitForSignalTargetExit(target, 1_500)) {
    evidence.process_group_exited = true;
    return evidence;
  }
  throw new Error(`${label} ${pid} remained alive after bounded ${reason} TERM/KILL cleanup`);
}

function signalProcessTarget(target, signal) {
  try {
    process.kill(target, signal);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

async function waitForSignalTargetExit(target, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  do {
    try {
      process.kill(target, 0);
    } catch (error) {
      if (error?.code === "ESRCH") return true;
      throw error;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  } while (Date.now() < deadline);
  try {
    process.kill(target, 0);
    return false;
  } catch (error) {
    if (error?.code === "ESRCH") return true;
    throw error;
  }
}

async function waitForFile(filePath, { attempts = 400, delayMs = 25 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      await access(filePath, fsConstants.R_OK);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw new Error(`Timed out waiting for fixture file: ${filePath}`);
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
  const requiredValueOptions = new Set(["vital-agent-root", "version", "out-dir"]);
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals !== -1) {
      const rawKey = raw.slice(0, equals);
      const rawValue = raw.slice(equals + 1);
      if (requiredValueOptions.has(rawKey) && rawValue === "") {
        throw new Error(`--${rawKey} requires a non-empty value.`);
      }
      parsed[rawKey.replaceAll("-", "_")] = parseArgValue(rawValue);
      continue;
    }
    const key = raw.replaceAll("-", "_");
    const next = args[i + 1];
    if (requiredValueOptions.has(raw) && (!next || next.startsWith("--"))) {
      throw new Error(`--${raw} requires a non-empty value.`);
    }
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
