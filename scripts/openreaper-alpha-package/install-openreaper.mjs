#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { constants as fsConstants, existsSync } from "node:fs";
import { chmod, copyFile, cp, lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STARTUP_BEGIN = "-- >>> OpenReaper alpha MCP startup hook >>>";
const STARTUP_END = "-- <<< OpenReaper alpha MCP startup hook <<<";
const LEGACY_STARTUP_BLOCKS = Object.freeze([
  Object.freeze({
    begin: STARTUP_BEGIN,
    end: STARTUP_END,
    label: "prior OpenReaper alpha startup hook",
  }),
  Object.freeze({
    begin: "-- >>> OpenReaper Alpha3 MCP startup hook >>>",
    end: "-- <<< OpenReaper Alpha3 MCP startup hook <<<",
    label: "legacy OpenReaper Alpha3 startup hook",
  }),
  Object.freeze({
    begin: "-- >>> Streetlight MCP startup hook >>>",
    end: "-- <<< Streetlight MCP startup hook <<<",
    label: "legacy Streetlight startup hook",
  }),
]);
const DEFAULT_PACKS = "core,cleanup,delivery,analysis,loop,pack_contract_fixture";
const RENDER_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_RENDER_ROOT";
const MANAGED_RENDER_ROOT_RECORD = "managed-render-root.path";
const WRITE_PROBE_ATTEMPTS = 4;
const MANAGED_RENDER_ROOT_RECORD_MAX_BYTES = 4096;
const MANAGED_RENDER_ROOT_PATH_MAX_BYTES = 3072;
const PACKAGE_PROVENANCE_MANIFEST = "provenance.json";
const SWS_MISC_SECTION = "[Misc]";
const SWS_GLOBAL_STARTUP_KEY = "GlobalStartupAction";
const REAPER_RESOURCE_ROOT = path.join(os.homedir(), "Library", "Application Support", "REAPER");
const BRIDGE_ACTION_TITLE = "OpenReaper: Start MCP bridge";
const BRIDGE_ACTION_RELATIVE_SCRIPT = "OpenReaper/openreaper-start-mcp-bridge.lua";
const BRIDGE_ACTION_COMMAND_ID = `RS${createHash("sha1").update("openreaper.alpha.start_mcp_bridge.v1").digest("hex")}`;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[OpenReaper] ${String(error?.message ?? "invalid option").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320)}\n`);
  process.exit(2);
}
if (options.help === true) {
  printInstallHelp();
  process.exit(0);
}
const home = os.homedir();
const installRoot = path.resolve(options.install_root ?? path.join(home, ".openreaper", "current"));
const dryRun = options.dry_run === true;
const skipClientConfig = options.skip_client_config === true;
const skipStartupHook = options.skip_startup_hook === true;
const vitalAgentIncluded = existsSync(path.join(packageRoot, "bin", "vital-agent-mcp"))
  && existsSync(path.join(packageRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js"));

const installedBin = path.join(installRoot, "bin");
const mcpCommand = path.join(installedBin, "openreaper-mcp");
const vitalAgentMcpCommand = path.join(installedBin, "vital-agent-mcp");
const startCommand = path.join(installedBin, "openreaper-start");
const doctorCommand = path.join(installedBin, "openreaper-doctor");
const sessionRoot = path.join(installRoot, "session");
const transportDir = path.join(sessionRoot, "transport");
const artifactRoot = path.join(sessionRoot, "artifacts");
const defaultRenderRoot = path.join(sessionRoot, "renders");
const managedRenderRootRecord = path.join(sessionRoot, MANAGED_RENDER_ROOT_RECORD);
const executableRecipeRoot = path.join(path.dirname(installRoot), "data", "executable-recipes");
const installRootExisted = existsSync(installRoot);
const priorPersistedRenderRoot = await readManagedRenderRootRecord(managedRenderRootRecord);
const renderRootSelection = selectInstallerRenderRoot({
  explicit: options.render_root,
  persisted: priorPersistedRenderRoot,
  fallback: defaultRenderRoot,
});
const renderRoot = renderRootSelection.path;
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
const bridgeActionScript = path.join(REAPER_RESOURCE_ROOT, "Scripts", ...BRIDGE_ACTION_RELATIVE_SCRIPT.split("/"));
const bridgeActionCommand = `_${BRIDGE_ACTION_COMMAND_ID}`;

const report = {
  product: "OpenReaper alpha",
  dry_run: dryRun,
  package_root: packageRoot,
  install_root: installRoot,
  mcp_command: mcpCommand,
  optional_companions: {
    vital_agent_mcp: {
      included: vitalAgentIncluded,
      mode: "optional_companion",
      ...(vitalAgentIncluded ? { command: vitalAgentMcpCommand } : {}),
    },
  },
  start_command: startCommand,
  bridge_action: {
    title: BRIDGE_ACTION_TITLE,
    command_id: bridgeActionCommand,
    script: bridgeActionScript,
  },
  startup_hook: {
    path: path.join(REAPER_RESOURCE_ROOT, "Scripts", "__startup.lua"),
    mode: "conditional_openreaper_environment",
    installed: false,
    backup_path: null,
  },
  startup_dialog_assist: {
    auto_dismisses: ["Project Settings / Notes show notes on project load"],
    explicit_per_launch_consent: { missing_media: "--ignore-missing-media" },
    does_not_dismiss: ["missing media without consent", "license/evaluation", "recovery", "plugin/FX", "version", "unknown REAPER windows"],
  },
  transport_dir: transportDir,
  artifact_root: artifactRoot,
  executable_recipe_root: {
    path: executableRecipeRoot,
    created: false,
    writable: false,
    preserved_across_upgrade: true,
  },
  render_root: {
    path: renderRoot,
    source: renderRootSelection.source,
    created: false,
    writable: false,
    persisted_record: managedRenderRootRecord,
    previous_selection: priorPersistedRenderRoot,
    previous_default_nonempty: false,
    preserved_previous_default_at: null,
  },
  recovery: {
    replacement: "rename-first with rollback before previous-install cleanup",
    previous_install_backup: null,
    rollback_performed: false,
  },
  changed: [],
  skipped: [],
  warnings: [],
};

if (process.platform !== "darwin") {
  report.warnings.push("This alpha installer is macOS-first. Other platforms need a manual REAPER resource path and client config check.");
}

await runInstall();

async function runInstall() {
  let freshInstallRootOwned = false;
  try {
    await requireNode20();
    await prepareManagedRenderRoot(renderRoot, { mutate: false });
    await prepareExecutableRecipeRoot({ mutate: false });
    if (!dryRun && !installRootExisted) {
      await mkdir(path.dirname(installRoot), { recursive: true });
      try {
        await mkdir(installRoot);
        freshInstallRootOwned = true;
      } catch (error) {
        if (error?.code === "EEXIST") {
          throw new Error(`Fresh install root appeared concurrently; refusing to replace it: ${installRoot}`);
        }
        throw error;
      }
    }

    const preparedRenderRoot = await prepareManagedRenderRoot(renderRoot, { mutate: !dryRun });
    report.render_root.created = preparedRenderRoot.created;
    report.render_root.writable = preparedRenderRoot.writable;
    const preparedRecipeRoot = await prepareExecutableRecipeRoot({ mutate: !dryRun });
    report.executable_recipe_root.created = preparedRecipeRoot.created;
    report.executable_recipe_root.writable = preparedRecipeRoot.writable;
    const previousDefaultState = await inspectPreviousDefaultRenderRoot();
    report.render_root.previous_default_nonempty = previousDefaultState.nonempty;

    let replacement = null;
    let preReplacementPreservation = null;
    if (!dryRun) {
      await mkdir(path.dirname(installRoot), { recursive: true });
      try {
        preReplacementPreservation = await preservePreviousDefaultBeforeReplacement(previousDefaultState);
        replacement = await replaceInstallRoot();
        if (replacement) replacement.preservedDefault = preReplacementPreservation;
        report.recovery.previous_install_backup = replacement?.backupRoot ?? null;
        await cp(packageRoot, installRoot, {
          recursive: true,
          filter: (src) => !src.includes(`${path.sep}.DS_Store`),
        });
        report.changed.push(`installed package at ${installRoot}`);
        const installedProvenanceManifest = path.join(installRoot, PACKAGE_PROVENANCE_MANIFEST);
        await chmod(installedProvenanceManifest, 0o444);
        report.changed.push(`secured read-only package provenance at ${installedProvenanceManifest}`);
        await chmod(path.join(installRoot, "install.command"), 0o755).catch(() => {});
        await chmod(path.join(installRoot, "uninstall.command"), 0o755).catch(() => {});
        await chmod(mcpCommand, 0o755);
        if (vitalAgentIncluded) await chmod(vitalAgentMcpCommand, 0o755);
        await chmod(startCommand, 0o755);
        await chmod(doctorCommand, 0o755);
        await mkdir(path.join(transportDir, "requests"), { recursive: true });
        await mkdir(path.join(transportDir, "results"), { recursive: true });
        await mkdir(artifactRoot, { recursive: true });
        await finalizeManagedRenderRoot(replacement);
        await writeFile(managedRenderRootRecord, `${renderRoot}\n`, { encoding: "utf8", mode: 0o600 });
        report.changed.push(`persisted managed render root at ${managedRenderRootRecord}`);
        await cleanupPreviousInstall(replacement);
      } catch (error) {
        await rollbackInstallReplacement(replacement).catch((rollbackError) => {
          report.warnings.push(`Install rollback needs manual recovery: ${rollbackError.code ?? "ERROR"}: ${rollbackError.message}`);
        });
        if (!replacement && preReplacementPreservation) {
          await restorePreReplacementPreservation(preReplacementPreservation).catch((restoreError) => {
            report.warnings.push(`Previous render outputs remain preserved at ${preReplacementPreservation.path}; restore failed: ${restoreError.message}`);
          });
        }
        throw error;
      }
    } else {
      report.skipped.push("dry run: did not copy package, create queue directories, or persist the managed render root");
    }

    if (!skipStartupHook) {
      await installBridgeAction();
      await installConditionalStartupHook();
      await inspectOptionalStartupCompatibility();
    } else {
      report.skipped.push("REAPER bridge action installation skipped because --skip-startup-hook was set");
    }

    if (!skipClientConfig) {
      await configureCodex();
      await configureCursor();
      await configureClaudeDesktop();
      await writeClientSnippets();
    } else {
      report.skipped.push("client configs not changed because --skip-client-config was set");
    }

    await smokeMcpServer();
    printReport();
  } catch (error) {
    if (freshInstallRootOwned) {
      await rm(installRoot, { recursive: true, force: true }).catch(() => {});
    }
    throw error;
  }
}

async function requireNode20() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`OpenReaper alpha needs Node >= 20. Current node: ${process.version}`);
  }
}

async function replaceInstallRoot() {
  if (!installRootExisted) return null;
  const backupContainer = await allocateSiblingContainer(".openreaper-install-backup-");
  const backupRoot = path.join(backupContainer, "previous-install");
  try {
    await rename(installRoot, backupRoot);
    report.changed.push(`moved previous install to ${backupRoot}`);
    return {
      backupContainer,
      backupRoot,
      previousDefaultRoot: path.join(backupRoot, "session", "renders"),
      movedDefaultIntoInstall: false,
      preservedDefault: null,
    };
  } catch (error) {
    await rm(backupContainer, { recursive: true, force: true }).catch(() => {});
    report.warnings.push(
      `Could not move previous install into its allocated backup container. Source was left in place. ${error.code ?? "ERROR"}: ${error.message}`,
    );
    throw error;
  }
}

async function cleanupPreviousInstall(replacement) {
  if (!replacement?.backupContainer) return;
  await rm(replacement.backupContainer, { recursive: true, force: true }).catch((error) => {
    report.warnings.push(`Previous install cleanup deferred: ${replacement.backupContainer}; ${error.code ?? "ERROR"}: ${error.message}`);
  });
}

async function rollbackInstallReplacement(replacement) {
  if (!replacement?.backupRoot || !existsSync(replacement.backupRoot)) return;
  if (replacement.movedDefaultIntoInstall && existsSync(renderRoot)) {
    await mkdir(path.dirname(replacement.previousDefaultRoot), { recursive: true });
    await rename(renderRoot, replacement.previousDefaultRoot);
  }
  if (replacement.preservedDefault?.path && existsSync(replacement.preservedDefault.path)) {
    await mkdir(path.dirname(replacement.previousDefaultRoot), { recursive: true });
    await rename(replacement.preservedDefault.path, replacement.previousDefaultRoot);
    await rm(replacement.preservedDefault.container, { recursive: true, force: true });
  }
  await rm(installRoot, { recursive: true, force: true });
  await rename(replacement.backupRoot, installRoot);
  await rm(replacement.backupContainer, { recursive: true, force: true });
  report.recovery.rollback_performed = true;
  report.warnings.push(`restored previous install after failed replacement: ${installRoot}`);
}

async function finalizeManagedRenderRoot(replacement) {
  if (replacement && await sameCanonicalPath(renderRoot, defaultRenderRoot)) {
    const priorDefault = replacement.previousDefaultRoot;
    const priorDefaultStatus = await safeLstat(priorDefault);
    if (priorDefaultStatus?.isDirectory() && !priorDefaultStatus.isSymbolicLink()) {
      await rm(defaultRenderRoot, { recursive: true, force: true });
      await mkdir(path.dirname(defaultRenderRoot), { recursive: true });
      await rename(priorDefault, defaultRenderRoot);
      replacement.movedDefaultIntoInstall = true;
      report.changed.push(`restored previous default render root into ${defaultRenderRoot}`);
    } else {
      await mkdir(defaultRenderRoot, { recursive: true });
    }
  } else {
    await mkdir(renderRoot, { recursive: true });
  }
  const verified = await prepareManagedRenderRoot(renderRoot, { mutate: true });
  report.render_root.writable = verified.writable;
}

async function preservePreviousDefaultBeforeReplacement(previousDefaultState) {
  if (!previousDefaultState.nonempty || await sameCanonicalPath(renderRoot, defaultRenderRoot)) return null;
  const container = await allocateSiblingContainer(".openreaper-render-preservation-");
  const preservationRoot = path.join(container, "renders");
  try {
    await rename(defaultRenderRoot, preservationRoot);
  } catch (error) {
    await rm(container, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not preserve previous default render outputs; source was left in place. ${error.code ?? "ERROR"}: ${error.message}`);
  }
  report.render_root.preserved_previous_default_at = preservationRoot;
  report.changed.push(`preserved previous default render outputs before replacement at ${preservationRoot}`);
  return { container, path: preservationRoot };
}

async function restorePreReplacementPreservation(preservation) {
  if (!preservation?.path || !existsSync(preservation.path) || existsSync(defaultRenderRoot)) return;
  await mkdir(path.dirname(defaultRenderRoot), { recursive: true });
  await rename(preservation.path, defaultRenderRoot);
  await rm(preservation.container, { recursive: true, force: true });
}


async function inspectPreviousDefaultRenderRoot() {
  if (!installRootExisted) return { exists: false, nonempty: false, symlink: false };
  const status = await safeLstat(defaultRenderRoot);
  if (!status) return { exists: false, nonempty: false, symlink: false };
  if (status.isSymbolicLink()) {
    report.warnings.push(`previous default render root is a symlink and will not be followed: ${defaultRenderRoot}`);
    return { exists: true, nonempty: false, symlink: true };
  }
  if (!status.isDirectory()) {
    throw new Error(`Previous default render root is not a directory: ${defaultRenderRoot}`);
  }
  const entries = await readdir(defaultRenderRoot);
  return { exists: true, nonempty: entries.length > 0, symlink: false };
}

async function inspectOptionalStartupCompatibility() {
  const swsPath = path.join(REAPER_RESOURCE_ROOT, "S&M.ini");
  const swsConfig = await readTextIfExists(swsPath);
  if (!swsConfig.trim()) {
    report.skipped.push("SWS/S&M was not found; OpenReaper bridge startup does not require SWS.");
    return;
  }
  report.changed.push(`detected SWS/S&M startup config at ${swsPath}; OpenReaper does not require or take over SWS startup actions`);
  const globalStartupAction = readIniValue(swsConfig, SWS_MISC_SECTION, SWS_GLOBAL_STARTUP_KEY);
  if (globalStartupAction) {
    report.skipped.push(`preserved existing SWS GlobalStartupAction=${globalStartupAction}; OpenReaper bridge action is user/agent-run, not SWS-run`);
  } else {
    report.skipped.push("SWS is installed but has no GlobalStartupAction; OpenReaper did not add one");
  }
}

async function installBridgeAction() {
  if (dryRun) {
    report.skipped.push(`dry run: would install REAPER action ${BRIDGE_ACTION_TITLE} at ${bridgeActionScript}`);
    return;
  }
  await mkdir(path.dirname(bridgeActionScript), { recursive: true });
  const script = bridgeActionScriptSource();
  const existingScript = await readTextIfExists(bridgeActionScript);
  if (existingScript !== script) {
    await writeFile(bridgeActionScript, script, "utf8");
    report.changed.push(`installed REAPER action script ${BRIDGE_ACTION_TITLE} at ${bridgeActionScript}`);
  }
  await upsertBridgeActionInReaperKb();
}

async function upsertBridgeActionInReaperKb() {
  const kbPath = path.join(REAPER_RESOURCE_ROOT, "reaper-kb.ini");
  const existing = await readTextIfExists(kbPath);
  const actionLine = `SCR 4 0 ${BRIDGE_ACTION_COMMAND_ID} "Custom: ${BRIDGE_ACTION_TITLE}" "${BRIDGE_ACTION_RELATIVE_SCRIPT}"`;
  const withoutOldOpenReaperAction = existing
    .split(/\r?\n/)
    .filter((line) =>
      !line.includes(`Custom: ${BRIDGE_ACTION_TITLE}`) &&
      !line.includes(BRIDGE_ACTION_RELATIVE_SCRIPT),
    )
    .join("\n")
    .trimEnd();
  const next = withoutOldOpenReaperAction === "" ? `${actionLine}\n` : `${withoutOldOpenReaperAction}\n${actionLine}\n`;
  if (next !== existing) {
    await mkdir(path.dirname(kbPath), { recursive: true });
    await writeFile(kbPath, next, "utf8");
    report.changed.push(`registered REAPER action ${BRIDGE_ACTION_TITLE} (${bridgeActionCommand}) at ${kbPath}`);
  }
}

async function installConditionalStartupHook() {
  const hookPath = path.join(REAPER_RESOURCE_ROOT, "Scripts", "__startup.lua");
  const hookStatus = await safeLstat(hookPath);
  if (hookStatus && !hookStatus.isFile()) {
    throw new Error(`REAPER startup hook must be a regular file, not ${describeFileType(hookStatus)}: ${hookPath}`);
  }
  const existing = hookStatus ? await readFile(hookPath, "utf8") : "";
  let withoutLegacy = existing;
  for (const block of LEGACY_STARTUP_BLOCKS) {
    withoutLegacy = removeMarkedBlock(withoutLegacy, block.begin, block.end);
  }
  const next = upsertMarkedBlock(withoutLegacy, STARTUP_BEGIN, STARTUP_END, conditionalStartupHookSource()).trimEnd();
  const nextText = `${next}\n`;
  report.startup_hook.installed = true;
  if (nextText === existing) {
    report.skipped.push(`conditional OpenReaper startup hook already current at ${hookPath}`);
    return;
  }
  if (dryRun) {
    report.skipped.push(`dry run: would install conditional OpenReaper startup hook at ${hookPath}`);
    return;
  }
  await mkdir(path.dirname(hookPath), { recursive: true });
  if (hookStatus) {
    const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
    const backupPath = `${hookPath}.openreaper-backup-${stamp}-${randomBytes(4).toString("hex")}`;
    await copyFile(hookPath, backupPath, fsConstants.COPYFILE_EXCL);
    report.startup_hook.backup_path = backupPath;
    report.changed.push(`backed up existing REAPER startup hook at ${backupPath}`);
  }
  await writeFile(hookPath, nextText, { encoding: "utf8", mode: 0o644 });
  report.changed.push(`installed conditional OpenReaper startup hook at ${hookPath}`);
}

function conditionalStartupHookSource() {
  return `${STARTUP_BEGIN}
-- Inert for ordinary REAPER launches; active only for an OpenReaper-managed session.
do
  local bridge_script = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
  local transport_dir = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")
  if bridge_script and bridge_script ~= "" and transport_dir and transport_dir ~= "" then
    pcall(dofile, bridge_script)
  end
end
${STARTUP_END}`;
}

function bridgeActionScriptSource() {
  return `-- OpenReaper: Start MCP bridge
-- Installed by OpenReaper alpha as a manual recovery fallback.
local bridge = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
local transport = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")

if not bridge or bridge == "" or not transport or transport == "" then
  if reaper and reaper.MB then
    reaper.MB("Start REAPER through openreaper-start first, then run this action again.", "OpenReaper", 0)
  end
  return
end

local ok, err = pcall(dofile, bridge)
if not ok and reaper and reaper.MB then
  reaper.MB("OpenReaper MCP bridge failed: " .. tostring(err), "OpenReaper", 0)
end
`;
}

async function configureCodex() {
  const configPath = path.join(home, ".codex", "config.toml");
  const openReaperSection = `[mcp_servers.openreaper]
command = ${tomlString(mcpCommand)}
args = []

[mcp_servers.openreaper.env]
OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = ${tomlString(transportDir)}
OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH = ${tomlString(bridgeScript)}
OPENREAPER_ARTIFACT_ROOT = ${tomlString(artifactRoot)}
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT = ${tomlString(artifactRoot)}
OPENREAPER_LIVE_SMOKE_RENDER_ROOT = ${tomlString(renderRoot)}
OPENREAPER_LIVE_BRIDGE_OWNER = "openreaper-alpha"
OPENREAPER_LIVE_BRIDGE_GENERATION = "1"
`;
  const vitalAgentSection = `[mcp_servers.vital-agent-mcp]
command = ${tomlString(vitalAgentMcpCommand)}
args = []
`;
  if (dryRun) {
    report.skipped.push(`dry run: would upsert Codex MCP config for openreaper${vitalAgentIncluded ? " and optional vital-agent-mcp" : " core only"} at ${configPath}`);
    return;
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  const existing = await readTextIfExists(configPath);
  let next = removeLegacyOpenReaperTomlSections(existing);
  next = upsertTomlSectionTree(next, "mcp_servers.openreaper", openReaperSection);
  next = removeTomlSectionTree(next, "mcp_servers.vital-agent-mcp");
  if (vitalAgentIncluded) next = upsertTomlSection(next, "mcp_servers.vital-agent-mcp", vitalAgentSection);
  await writeFile(configPath, next, "utf8");
  report.changed.push(`registered Codex MCP server openreaper${vitalAgentIncluded ? " and optional vital-agent-mcp" : " only"} at ${configPath}`);
}

async function configureCursor() {
  const configPath = path.join(home, ".cursor", "mcp.json");
  await upsertJsonMcpServer(configPath, "Cursor");
}

async function configureClaudeDesktop() {
  const configPath = path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  await upsertJsonMcpServer(configPath, "Claude Desktop");
}

async function upsertJsonMcpServer(configPath, label) {
  if (dryRun) {
    report.skipped.push(`dry run: would upsert ${label} MCP config at ${configPath}`);
    return;
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  const existing = await readTextIfExists(configPath);
  let parsed = {};
  if (existing.trim() !== "") {
    try {
      parsed = JSON.parse(existing);
    } catch {
      const backup = `${configPath}.openreaper-invalid-backup`;
      await writeFile(backup, existing, "utf8");
      report.warnings.push(`${label} config was invalid JSON. Backed it up to ${backup} and wrote a fresh config.`);
      parsed = {};
    }
  }
  parsed.mcpServers = parsed.mcpServers && typeof parsed.mcpServers === "object" ? parsed.mcpServers : {};
  if (parsed.mcpServers.streetlight) {
    delete parsed.mcpServers.streetlight;
    report.changed.push(`removed legacy Streetlight MCP server from ${label} config at ${configPath}`);
  }
  parsed.mcpServers.openreaper = {
    command: mcpCommand,
    args: [],
    env: {
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
      OPENREAPER_ARTIFACT_ROOT: artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
      [RENDER_ROOT_ENV]: renderRoot,
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    },
  };
  delete parsed.mcpServers["vital-agent-mcp"];
  if (vitalAgentIncluded) {
    parsed.mcpServers["vital-agent-mcp"] = {
      command: vitalAgentMcpCommand,
      args: [],
    };
  }
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  report.changed.push(`registered ${label} MCP server openreaper${vitalAgentIncluded ? " and optional vital-agent-mcp" : " only"} at ${configPath}`);
}

async function writeClientSnippets() {
  if (dryRun) {
    report.skipped.push("dry run: would write client snippets under config-snippets");
    return;
  }
  const snippetDir = path.join(installRoot, "config-snippets");
  await mkdir(snippetDir, { recursive: true });
  const jsonSnippet = {
    mcpServers: {
      openreaper: {
        command: mcpCommand,
        args: [],
        env: {
          OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
          OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
          OPENREAPER_ARTIFACT_ROOT: artifactRoot,
          OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
          [RENDER_ROOT_ENV]: renderRoot,
          OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
          OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
        },
      },
      ...(vitalAgentIncluded ? {
        "vital-agent-mcp": {
          command: vitalAgentMcpCommand,
          args: [],
        },
      } : {}),
    },
  };
  await writeFile(path.join(snippetDir, "mcp.json"), `${JSON.stringify(jsonSnippet, null, 2)}\n`, "utf8");
  await writeFile(path.join(snippetDir, "codex-config.toml"), `[mcp_servers.openreaper]
command = ${tomlString(mcpCommand)}
args = []

[mcp_servers.openreaper.env]
OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR = ${tomlString(transportDir)}
OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH = ${tomlString(bridgeScript)}
OPENREAPER_ARTIFACT_ROOT = ${tomlString(artifactRoot)}
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT = ${tomlString(artifactRoot)}
OPENREAPER_LIVE_SMOKE_RENDER_ROOT = ${tomlString(renderRoot)}
OPENREAPER_LIVE_BRIDGE_OWNER = "openreaper-alpha"
OPENREAPER_LIVE_BRIDGE_GENERATION = "1"
${vitalAgentIncluded ? `
[mcp_servers.vital-agent-mcp]
command = ${tomlString(vitalAgentMcpCommand)}
args = []
` : ""}`, "utf8");
  await writeFile(path.join(snippetDir, "trae-mcp.json"), `${JSON.stringify(jsonSnippet, null, 2)}\n`, "utf8");
  report.changed.push(`wrote MCP config snippets at ${snippetDir}`);
}

async function smokeMcpServer() {
  if (dryRun) {
    report.skipped.push("dry run: skipped MCP server startup smoke");
    return;
  }
  await new Promise((resolve) => {
    const child = spawn(mcpCommand, [], {
      env: {
        ...process.env,
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
        OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
        OPENREAPER_ARTIFACT_ROOT: artifactRoot,
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
        [RENDER_ROOT_ENV]: renderRoot,
        OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (data) => {
      stderr += data;
    });
    const timer = setTimeout(() => child.kill("SIGTERM"), 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      if (stderr.includes("stdio server ready")) {
        report.changed.push("MCP server startup smoke passed");
      } else {
        report.warnings.push(`MCP server startup smoke did not see ready marker. stderr: ${stderr.trim()}`);
      }
      resolve();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      report.warnings.push(`MCP server startup smoke failed: ${error.message}`);
      resolve();
    });
  });
}

function printReport() {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`
OpenReaper alpha ${dryRun ? "dry run complete" : "installed"}.

Upgrade/install rule for agents:
If an older OpenReaper alpha is already installed, run this new package's
install.command directly. Do not manually delete the existing install at
${installRoot} first; the installer handles the rename-first replacement and
rewrites MCP client config. After install, verify with:
  ${doctorCommand}

Restart Codex/Cursor/Claude so they reload MCP config, then ask:
  "Open REAPER with OpenReaper and inspect the current project."

Important: OpenReaper MCP connects only when REAPER is started through:
  ${startCommand}

Startup lifetime: openreaper-start launches REAPER detached from the agent
shell, waits for the REAPER process to stay alive, and returns the pid/log
path for recovery.

Startup window assist: openreaper-start only tries to close the known Project
Settings / Notes "show notes on project load" window. It does not close
license/evaluation, recovery, plugin/FX, version, or unknown REAPER windows.
If bridge connection fails, check for a REAPER window waiting for action,
resolve it, run the bridge action, reconnect, and run the live read probe:
  call_template(template.transport.read_state)

After openreaper-start opens REAPER, run the REAPER action:
  ${BRIDGE_ACTION_TITLE}

The agent should try to run that REAPER action for you. If it cannot operate
the REAPER UI, open REAPER's Actions list, search the exact action name above,
click Run, and then ask the agent to reconnect to MCP server openreaper.
`);
}

function upsertMarkedBlock(existing, begin, end, block) {
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end);
  if (start !== -1 && finish !== -1 && finish > start) {
    const after = finish + end.length;
    return `${existing.slice(0, start).trimEnd()}\n\n${block.trimEnd()}\n${existing.slice(after).trimStart()}`;
  }
  return existing.trimEnd() === "" ? block : `${existing.trimEnd()}\n\n${block}`;
}

function removeMarkedBlocks(existing, blocks) {
  let next = existing;
  for (const block of blocks) {
    const before = next;
    next = removeMarkedBlock(next, block.begin, block.end);
    if (next !== before) {
      report.changed.push(`removed ${block.label} from REAPER startup hook`);
    }
  }
  return next;
}

function removeMarkedBlock(existing, begin, end) {
  let next = existing;
  while (true) {
    const start = next.indexOf(begin);
    const finish = next.indexOf(end);
    if (start === -1 || finish === -1 || finish <= start) return next;
    const after = finish + end.length;
    next = `${next.slice(0, start).trimEnd()}\n\n${next.slice(after).trimStart()}`;
  }
}

function upsertTomlSection(existing, sectionName, sectionText) {
  const header = `[${sectionName}]`;
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) {
    const prefix = existing.trimEnd();
    return prefix === "" ? `${sectionText.trimEnd()}\n` : `${prefix}\n\n${sectionText.trimEnd()}\n`;
  }
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  const nextLines = [...lines.slice(0, start), ...sectionText.trimEnd().split("\n"), ...lines.slice(end)];
  return `${nextLines.join("\n").trimEnd()}\n`;
}

function upsertTomlSectionTree(existing, sectionName, sectionText) {
  const sections = splitTomlSections(existing);
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

function removeTomlSectionTree(existing, sectionName) {
  const sections = splitTomlSections(existing).filter((section) =>
    section.name !== sectionName && !section.name?.startsWith(`${sectionName}.`));
  return `${sections.flatMap((section) => section.lines).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function splitTomlSections(existing) {
  const sections = [];
  let current = { name: null, lines: [] };
  for (const line of existing.split(/\r?\n/)) {
    const name = tomlSectionName(line);
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

function tomlSectionName(line) {
  const arrayTable = line.match(/^\s*\[\[([^\[\]]+)\]\]\s*(?:#.*)?$/);
  if (arrayTable) return arrayTable[1].trim();
  const table = line.match(/^\s*\[([^\[\]]+)\]\s*(?:#.*)?$/);
  return table ? table[1].trim() : null;
}

function removeLegacyOpenReaperTomlSections(existing) {
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
    if (section.header === "[mcp_servers.streetlight]") {
      report.changed.push("removed legacy Codex MCP server streetlight");
      return false;
    }
    if (section.header === "[mcp_servers.streetlight.env]") return false;
    if (section.header === "[mcp_servers.openreaper]" && isLegacyOpenReaperTomlSection(body)) {
      report.changed.push("removed stale Codex MCP server openreaper that pointed at the legacy Streetlight kernel");
      return false;
    }
    if (section.header === "[mcp_servers.openreaper.env]" && isLegacyOpenReaperTomlSection(body)) {
      report.changed.push("removed stale STREETLIGHT_* env block from Codex openreaper server");
      return false;
    }
    return true;
  });
  return `${kept.map((section) => section.lines.join("\n").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}

function readIniValue(source, sectionName, keyName) {
  let inSection = false;
  for (const line of source.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
      inSection = trimmed === sectionName;
      continue;
    }
    if (!inSection || trimmed.startsWith(";") || trimmed === "") continue;
    const equals = trimmed.indexOf("=");
    if (equals === -1) continue;
    if (trimmed.slice(0, equals).trim() === keyName) {
      return trimmed.slice(equals + 1).split(";")[0].trim();
    }
  }
  return null;
}

function isLegacyOpenReaperTomlSection(text) {
  return /streetlight-reaper-mcp|packages\/mcp-server\/dist\/index\.js|STREETLIGHT_/i.test(text);
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

function tomlString(value) {
  return JSON.stringify(String(value));
}

function selectInstallerRenderRoot({ explicit, persisted, fallback }) {
  if (explicit !== undefined) {
    if (explicit === true || String(explicit) === "") {
      throw new Error("--render-root requires a non-empty absolute path.");
    }
    return { path: String(explicit), source: "explicit" };
  }
  if (persisted) return { path: persisted, source: "persisted" };
  return { path: fallback, source: "default" };
}

async function readManagedRenderRootRecord(recordPath) {
  const status = await safeLstat(recordPath);
  if (!status) return null;
  if (status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`Managed render root record must be a regular file, not a symlink or non-file: ${recordPath}`);
  }
  if (status.size > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
    throw new Error(`Managed render root record exceeds ${MANAGED_RENDER_ROOT_RECORD_MAX_BYTES} bytes: ${recordPath}`);
  }
  const handle = await open(
    recordPath,
    fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
  );
  try {
    const openedStatus = await handle.stat();
    if (!openedStatus.isFile() || openedStatus.size > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
      throw new Error(`Managed render root record changed or is oversized: ${recordPath}`);
    }
    const buffer = Buffer.alloc(MANAGED_RENDER_ROOT_RECORD_MAX_BYTES + 1);
    const bytesRead = await readBoundedBytes(handle, buffer);
    if (bytesRead > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
      throw new Error(`Managed render root record exceeds ${MANAGED_RENDER_ROOT_RECORD_MAX_BYTES} bytes: ${recordPath}`);
    }
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw new Error(`Managed render root record is not valid UTF-8: ${recordPath}`);
    }
    const value = parseManagedRenderRootRecordText(text, recordPath);
    validateRenderRootText(value);
    return value;
  } finally {
    await handle.close();
  }
}

async function readBoundedBytes(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset;
}

function parseManagedRenderRootRecordText(text, recordPath) {
  if (text === "") throw new Error(`Managed render root record is empty: ${recordPath}`);
  const value = text.endsWith("\n") ? text.slice(0, -1) : text;
  if (value === "" || value.includes("\n")) {
    throw new Error(`Managed render root record must contain exactly one path line: ${recordPath}`);
  }
  return value;
}

async function prepareManagedRenderRoot(candidate, { mutate }) {
  validateRenderRootText(candidate);
  const absolute = path.normalize(candidate);
  const statusBefore = await safeLstat(absolute);
  if (statusBefore?.isSymbolicLink()) {
    throw new Error(`Managed render root final component must not be a symlink: ${absolute}`);
  }
  if (statusBefore && !statusBefore.isDirectory()) {
    throw new Error(`Managed render root must be a directory, not ${describeFileType(statusBefore)}: ${absolute}`);
  }
  await assertManagedRenderRootDoesNotOverlapReservedPaths(absolute);
  let created = false;
  if (!statusBefore && mutate) {
    await mkdir(absolute, { recursive: true, mode: 0o700 });
    created = true;
  }
  if (!mutate) {
    return { path: absolute, created: false, writable: statusBefore ? null : null };
  }
  const statusAfter = await safeLstat(absolute);
  if (!statusAfter) throw new Error(`Managed render root was not created: ${absolute}`);
  if (statusAfter.isSymbolicLink()) {
    throw new Error(`Managed render root final component must not be a symlink: ${absolute}`);
  }
  if (!statusAfter.isDirectory()) {
    throw new Error(`Managed render root must be a directory, not ${describeFileType(statusAfter)}: ${absolute}`);
  }
  await assertManagedRenderRootDoesNotOverlapReservedPaths(absolute);
  await boundedWriteProbe(absolute);
  return { path: absolute, created, writable: true };
}

async function prepareExecutableRecipeRoot({ mutate }) {
  const dataRoot = path.dirname(executableRecipeRoot);
  const dataStatus = await safeLstat(dataRoot);
  if (dataStatus?.isSymbolicLink()) {
    throw new Error(`Executable recipe data root must not be a symlink: ${dataRoot}`);
  }
  if (dataStatus && !dataStatus.isDirectory()) {
    throw new Error(`Executable recipe data root must be a directory: ${dataRoot}`);
  }
  const statusBefore = await safeLstat(executableRecipeRoot);
  if (statusBefore?.isSymbolicLink()) {
    throw new Error(`Executable recipe root must not be a symlink: ${executableRecipeRoot}`);
  }
  if (statusBefore && !statusBefore.isDirectory()) {
    throw new Error(`Executable recipe root must be a directory: ${executableRecipeRoot}`);
  }
  if (!mutate) return { created: false, writable: null };
  if (!dataStatus) await mkdir(dataRoot, { recursive: true, mode: 0o700 });
  if (!statusBefore) await mkdir(executableRecipeRoot, { recursive: true, mode: 0o700 });
  const statusAfter = await safeLstat(executableRecipeRoot);
  if (!statusAfter || statusAfter.isSymbolicLink() || !statusAfter.isDirectory()) {
    throw new Error(`Executable recipe root could not be safely prepared: ${executableRecipeRoot}`);
  }
  await boundedWriteProbe(executableRecipeRoot);
  return { created: !statusBefore, writable: true };
}

function validateRenderRootText(candidate) {
  if (typeof candidate !== "string" || candidate === "") {
    throw new Error("Managed render root must be a non-empty absolute path.");
  }
  if (Buffer.byteLength(candidate, "utf8") > MANAGED_RENDER_ROOT_PATH_MAX_BYTES) {
    throw new Error(`Managed render root exceeds ${MANAGED_RENDER_ROOT_PATH_MAX_BYTES} UTF-8 bytes.`);
  }
  if (/^file:/i.test(candidate)) {
    throw new Error(`Managed render root must be a filesystem path, not a file URI: ${candidate}`);
  }
  if (/[\u0000-\u001f\u007f]/u.test(candidate)) {
    throw new Error("Managed render root must not contain NUL or control characters.");
  }
  if (!path.isAbsolute(candidate)) {
    throw new Error(`Managed render root must be absolute: ${candidate}`);
  }
  const normalized = path.normalize(candidate);
  if (normalized === path.parse(normalized).root) {
    throw new Error(`Managed render root must not be the filesystem root: ${candidate}`);
  }
}

async function assertManagedRenderRootDoesNotOverlapReservedPaths(candidate) {
  const candidateCanonical = await canonicalPath(candidate);
  const homeCanonical = await canonicalPath(home);
  if (candidateCanonical === homeCanonical) {
    throw new Error(`Managed render root must not be the user home directory: ${candidate}`);
  }
  const defaultCanonical = await canonicalPath(defaultRenderRoot);
  if (candidateCanonical === defaultCanonical) return;
  for (const [label, reserved] of [
    ["install root", installRoot],
    ["session root", sessionRoot],
    ["transport root", transportDir],
    ["artifact root", artifactRoot],
  ]) {
    const reservedCanonical = await canonicalPath(reserved);
    if (pathsOverlap(candidateCanonical, reservedCanonical)) {
      throw new Error(`Managed render root must not overlap the OpenReaper ${label}: ${candidate}`);
    }
  }
}

async function boundedWriteProbe(directory) {
  let lastCollision = null;
  for (let attempt = 0; attempt < WRITE_PROBE_ATTEMPTS; attempt += 1) {
    const probePath = path.join(
      directory,
      `.openreaper-write-probe-${process.pid}-${randomBytes(8).toString("hex")}`,
    );
    let handle = null;
    try {
      handle = await open(probePath, "wx", 0o600);
      await handle.writeFile("openreaper-managed-render-root-probe\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await unlink(probePath);
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(probePath).catch(() => {});
      if (error?.code === "EEXIST") {
        lastCollision = error;
        continue;
      }
      throw new Error(`Managed render root write probe failed for ${directory}: ${error.code ?? "ERROR"}: ${error.message}`);
    }
  }
  throw new Error(`Managed render root write probe exhausted ${WRITE_PROBE_ATTEMPTS} exclusive attempts for ${directory}: ${lastCollision?.message ?? "collision"}`);
}

async function canonicalPath(candidate) {
  const normalized = path.resolve(candidate);
  let cursor = normalized;
  const suffix = [];
  while (true) {
    try {
      const resolved = await realpath(cursor);
      return path.join(resolved, ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...suffix.reverse());
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

async function sameCanonicalPath(left, right) {
  return await canonicalPath(left) === await canonicalPath(right);
}

async function safeLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function describeFileType(status) {
  if (status.isFile()) return "a regular file";
  if (status.isFIFO()) return "a FIFO";
  if (status.isSocket()) return "a socket";
  if (status.isBlockDevice()) return "a block device";
  if (status.isCharacterDevice()) return "a character device";
  return "a non-directory filesystem object";
}

async function allocateSiblingContainer(prefix) {
  const parent = path.dirname(installRoot);
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, prefix));
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}

function parseArgs(args) {
  const parsed = {};
  const requiredValueOptions = new Set(["install-root", "render-root"]);
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
    if (raw.startsWith("no-")) {
      parsed[`skip_${raw.slice(3).replaceAll("-", "_")}`] = true;
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

function printInstallHelp() {
  process.stdout.write(`OpenReaper alpha installer

Usage:
  ./install.command [options]
  node ./installer/install-openreaper.mjs [options]

Options:
  --install-root <path>       Install destination (default: ~/.openreaper/current)
  --render-root <path>        Managed render output destination
  --dry-run                   Validate without installing
  --skip-client-config        Do not update supported MCP client configs
  --skip-startup-hook         Do not install the conditional REAPER startup hook
  --help                      Show this help without installing
`);
}
