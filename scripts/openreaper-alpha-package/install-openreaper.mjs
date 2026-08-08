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
const LEGACY_STARTUP_HOOKS = Object.freeze([
  Object.freeze({
    relativePath: "__startup.eel",
    blocks: Object.freeze([
      Object.freeze({
        begin: "// >>> OpenReaper alpha MCP startup hook >>>",
        end: "// <<< OpenReaper alpha MCP startup hook <<<",
        label: "obsolete OpenReaper EEL startup hook",
      }),
    ]),
  }),
  Object.freeze({
    relativePath: "__startup.lua",
    blocks: Object.freeze([
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
    ]),
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
const CODEX_OWNED_LEADING_LINE_ENDING_MARKER = "# OpenReaper owns the preceding line ending";
const BRIDGE_ACTION_TITLE = "OpenReaper: Start MCP bridge";
const BRIDGE_ACTION_RELATIVE_SCRIPT = "OpenReaper/openreaper-start-mcp-bridge.lua";
const BRIDGE_ACTION_COMMAND_ID = `RS${createHash("sha1").update("openreaper.alpha.start_mcp_bridge.v1").digest("hex")}`;
const BRIDGE_LAUNCHER_NAME = "openreaper-start-mcp-bridge.lua";
const S3_ACTIONS = Object.freeze([
  // These packaged Actions use stock GetUserInputs/ShowMessageBox and
  // GetExtState/SetExtState, and expose the shared plan_hash to the user.
  // Their shared route is template.items.split_item_by_silence.
  Object.freeze({
    title: "OpenReaper: Remove Silence...",
    relativeScript: "OpenReaper/remove-silence.lua",
    commandId: `RS${createHash("sha1").update("openreaper.s3.remove_silence.v1").digest("hex")}`,
  }),
  Object.freeze({
    title: "OpenReaper: Repeat Remove Silence with Last Settings",
    relativeScript: "OpenReaper/repeat-remove-silence.lua",
    commandId: `RS${createHash("sha1").update("openreaper.s3.repeat_remove_silence.v1").digest("hex")}`,
  }),
]);
const S3_ACTION_SUPPORT_RELATIVE_SCRIPT = "OpenReaper/remove-silence-shared.lua";
let s3ActionsAvailable = false;

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
const reaperResourceRoot = path.resolve(options.reaper_resource_root ?? defaultReaperResourceRoot(home));
const dryRun = options.dry_run === true;
const skipClientConfig = options.skip_client_config === true;
const skipStartupHook = options.skip_startup_hook === true;
const vitalAgentIncluded = existsSync(path.join(packageRoot, "bin", "vital-agent-mcp"))
  && existsSync(path.join(packageRoot, "vendor", "vital-agent-mcp", "dist", "src", "mcpServer.js"));

const installedBin = path.join(installRoot, "bin");
const mcpCommand = path.join(installedBin, process.platform === "win32" ? "openreaper-mcp.ps1" : "openreaper-mcp");
const mcpLaunch = process.platform === "win32"
  ? { command: resolveWindowsPowerShellCommand(), args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", mcpCommand] }
  : { command: mcpCommand, args: [] };
const vitalAgentMcpCommand = path.join(installedBin, "vital-agent-mcp");
const startCommand = path.join(installedBin, process.platform === "win32" ? "openreaper-start.ps1" : "openreaper-start");
const doctorCommand = path.join(installedBin, process.platform === "win32" ? "openreaper-doctor.ps1" : "openreaper-doctor");
const bridgeLauncherScript = path.join(installedBin, BRIDGE_LAUNCHER_NAME);
const packagedBridgeLauncherScript = path.join(packageRoot, "bin", BRIDGE_LAUNCHER_NAME);
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
const bridgeActionScript = path.join(reaperResourceRoot, "Scripts", ...BRIDGE_ACTION_RELATIVE_SCRIPT.split("/"));
const conditionalStartupHookPath = path.join(reaperResourceRoot, "Scripts", "__startup.lua");
const bridgeActionCommand = `_${BRIDGE_ACTION_COMMAND_ID}`;

function resolveWindowsPowerShellCommand() {
  const systemRoot = [process.env.SystemRoot, process.env.WINDIR]
    .find((value) => typeof value === "string" && value.length > 0)
    ?? "C:\\Windows";
  const nativePath = path.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  return existsSync(nativePath) ? nativePath : "powershell.exe";
}

const report = {
  product: "OpenReaper alpha",
  dry_run: dryRun,
  package_root: packageRoot,
  install_root: installRoot,
  mcp_command: mcpCommand,
  mcp_launch: mcpLaunch,
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
  reaper_resource_root: reaperResourceRoot,
  s3_actions: S3_ACTIONS.map((action) => ({
    title: action.title,
    command_id: `_${action.commandId}`,
    script: path.join(reaperResourceRoot, "Scripts", ...action.relativeScript.split("/")),
    installed: false,
  })),
  startup_hook: {
    path: conditionalStartupHookPath,
    mode: "conditional_openreaper_environment",
    installed: false,
    package_local: false,
    always_enabled: false,
    fallback_path: bridgeLauncherScript,
    fallback_mode: "trusted_package_manual_action_reascript",
    fallback_installed: false,
    backup_path: null,
    legacy_cleanup_paths: [],
    legacy_backup_paths: [],
    migrated_legacy_lua_path: null,
    legacy_backup_path: null,
  },
  startup_dialog_assist: {
    requires_first_use_consent: true,
    consent_choices: ["once", "always", "manual"],
    persistent_policy_file: path.join(path.dirname(installRoot), "data", "startup-dialog-consent"),
    manual_behavior: "no_clicks_read_only_classification_wait_for_user_to_clear_blockers",
    auto_dismisses: ["Project Settings / Notes show notes on project load"],
    auto_dismisses_with_consent: ["Project Settings / Notes show notes on project load", "Ignore all missing files", "exact media-items-offline warning"],
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

if (process.platform !== "darwin" && process.platform !== "win32") {
  report.warnings.push("This installer has macOS and Windows REAPER resource defaults; other platforms require --reaper-resource-root and manual client/runtime verification.");
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
        await requireRegularNonSymlinkFile(bridgeLauncherScript, "installed Bridge launcher");
        await chmod(bridgeLauncherScript, 0o444);
        report.startup_hook.fallback_installed = true;
        report.changed.push(`secured trusted package-local Bridge launcher at ${bridgeLauncherScript}`);
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
      await requireRegularNonSymlinkFile(packagedBridgeLauncherScript, "packaged Bridge launcher");
      report.skipped.push("dry run: did not copy package, create queue directories, or persist the managed render root");
    }

    if (!skipStartupHook) {
      await installS3Actions();
      await installBridgeAction();
      await installConditionalStartupHook();
      await cleanupLegacyStartupHooks();
      await inspectOptionalStartupCompatibility();
    } else {
      report.skipped.push("conditional REAPER startup hook, manual bridge Action installation, and legacy startup-hook cleanup skipped because --skip-startup-hook was set; the trusted package launcher remains available in the package");
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
  const swsPath = path.join(reaperResourceRoot, "S&M.ini");
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
  const sourcePath = dryRun ? packagedBridgeLauncherScript : bridgeLauncherScript;
  await requireRegularNonSymlinkFile(sourcePath, "trusted Bridge launcher source");
  if (dryRun) {
    report.skipped.push(`dry run: would install REAPER action ${BRIDGE_ACTION_TITLE} at ${bridgeActionScript}`);
    return;
  }
  const existingStatus = await safeLstat(bridgeActionScript);
  if (existingStatus && (existingStatus.isSymbolicLink() || !existingStatus.isFile())) {
    throw new Error(`REAPER bridge Action must be a regular non-symlink file: ${bridgeActionScript}`);
  }
  await mkdir(path.dirname(bridgeActionScript), { recursive: true });
  const script = await readFile(sourcePath, "utf8");
  const existingScript = await readTextIfExists(bridgeActionScript);
  if (existingScript !== script) {
    await copyFile(sourcePath, bridgeActionScript);
    await chmod(bridgeActionScript, 0o444);
    report.changed.push(`installed REAPER action script ${BRIDGE_ACTION_TITLE} at ${bridgeActionScript}`);
  }
  if (await readFile(bridgeActionScript, "utf8") !== script) {
    throw new Error(`Installed REAPER bridge Action does not match the trusted package launcher: ${bridgeActionScript}`);
  }
  await upsertBridgeActionInReaperKb([
    bridgeActionRegistryLine(),
    ...(s3ActionsAvailable ? s3ActionRegistryLines() : []),
  ]);
}

async function installS3Actions() {
  const sourceRoot = path.join(packageRoot, "vendor", "openreaper-kernel", "reaper", "actions");
  const actions = [
    ...S3_ACTIONS.map((action) => ({
      ...action,
      sourcePath: path.join(sourceRoot, action.relativeScript),
      targetPath: path.join(reaperResourceRoot, "Scripts", ...action.relativeScript.split("/")),
    })),
    {
      title: "OpenReaper S3 shared Remove Silence core",
      relativeScript: S3_ACTION_SUPPORT_RELATIVE_SCRIPT,
      sourcePath: path.join(sourceRoot, S3_ACTION_SUPPORT_RELATIVE_SCRIPT),
      targetPath: path.join(reaperResourceRoot, "Scripts", ...S3_ACTION_SUPPORT_RELATIVE_SCRIPT.split("/")),
    },
  ];
  const sourceStatuses = await Promise.all(actions.map((action) => safeLstat(action.sourcePath)));
  if (sourceStatuses.some((status) => !status)) {
    report.skipped.push("S3 Remove Silence Actions were not registered because this package does not contain the complete Action source set");
    report.warnings.push("S3 Action source set is incomplete; no S3 files or registry lines were installed");
    return;
  }
  const targetStatuses = await Promise.all(actions.map((action) => safeLstat(action.targetPath)));
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const sourceStatus = sourceStatuses[index];
    if (sourceStatus.isSymbolicLink() || !sourceStatus.isFile()) {
      throw new Error(`${action.title} package source must be a regular non-symlink file: ${action.sourcePath}`);
    }
    const existingStatus = targetStatuses[index];
    if (existingStatus && (existingStatus.isSymbolicLink() || !existingStatus.isFile())) {
      throw new Error(`REAPER Action path must be a regular non-symlink file: ${action.targetPath}`);
    }
  }
  s3ActionsAvailable = true;
  for (let index = 0; index < actions.length; index += 1) {
    const action = actions[index];
    const existingStatus = targetStatuses[index];
    if (dryRun) {
      report.skipped.push(`dry run: would install ${action.title} at ${action.targetPath}`);
      continue;
    }
    await mkdir(path.dirname(action.targetPath), { recursive: true });
    const source = await readFile(action.sourcePath);
    const existing = existingStatus ? await readFile(action.targetPath) : null;
    if (!existing || !source.equals(existing)) {
      if (existingStatus) await chmod(action.targetPath, 0o644);
      try {
        await copyFile(action.sourcePath, action.targetPath);
      } finally {
        if (existingStatus) await chmod(action.targetPath, 0o444).catch(() => {});
      }
      report.changed.push(`installed REAPER Action support file ${action.title} at ${action.targetPath}`);
    }
    await chmod(action.targetPath, 0o444);
    const installed = await readFile(action.targetPath);
    if (!source.equals(installed)) {
      throw new Error(`Installed REAPER Action does not match its package source: ${action.targetPath}`);
    }
    const reportEntry = report.s3_actions.find((entry) => entry.script === action.targetPath);
    if (reportEntry) reportEntry.installed = true;
  }
}

async function upsertBridgeActionInReaperKb(actionLines) {
  const kbPath = path.join(reaperResourceRoot, "reaper-kb.ini");
  const existingStatus = await safeLstat(kbPath);
  if (existingStatus && (existingStatus.isSymbolicLink() || !existingStatus.isFile())) {
    throw new Error(`REAPER Action registry must be a regular non-symlink file: ${kbPath}`);
  }
  const existing = await readTextIfExists(kbPath);
  const ownedLines = new Set(actionLines);
  const withoutOldOpenReaperAction = removeLinesPreservingBytes(existing, (line) => !ownedLines.has(line));
  const separator = withoutOldOpenReaperAction === "" || /(?:\r\n|\n|\r)$/u.test(withoutOldOpenReaperAction) ? "" : "\n";
  const next = `${withoutOldOpenReaperAction}${separator}${actionLines.join("\n")}\n`;
  if (next !== existing) {
    await mkdir(reaperResourceRoot, { recursive: true });
    await writeFile(kbPath, next, "utf8");
    report.changed.push(`registered ${actionLines.length} OpenReaper REAPER Actions at ${kbPath}`);
  }
}

function bridgeActionRegistryLine() {
  return `SCR 4 0 ${BRIDGE_ACTION_COMMAND_ID} "Custom: ${BRIDGE_ACTION_TITLE}" "${BRIDGE_ACTION_RELATIVE_SCRIPT}"`;
}

function s3ActionRegistryLines() {
  return S3_ACTIONS.map((action) =>
    `SCR 4 0 ${action.commandId} "Custom: ${action.title}" "${action.relativeScript}"`,
  );
}

async function installConditionalStartupHook() {
  const hookStatus = await safeLstat(conditionalStartupHookPath);
  if (hookStatus && !hookStatus.isFile()) {
    throw new Error(`REAPER startup hook must be a regular file, not ${describeFileType(hookStatus)}: ${conditionalStartupHookPath}`);
  }
  const existing = hookStatus ? await readFile(conditionalStartupHookPath, "utf8") : "";
  let withoutManagedBlocks = existing;
  withoutManagedBlocks = removeMarkedBlock(withoutManagedBlocks, STARTUP_BEGIN, STARTUP_END);
  for (const block of LEGACY_STARTUP_HOOKS.find((hook) => hook.relativePath === "__startup.lua")?.blocks ?? []) {
    withoutManagedBlocks = removeMarkedBlock(withoutManagedBlocks, block.begin, block.end);
  }
  const nextText = upsertMarkedBlock(withoutManagedBlocks, STARTUP_BEGIN, STARTUP_END, conditionalStartupHookSource());
  report.startup_hook.installed = true;
  if (nextText === existing) {
    report.skipped.push(`conditional OpenReaper startup hook already current at ${conditionalStartupHookPath}`);
    return;
  }
  if (dryRun) {
    report.skipped.push(`dry run: would install conditional OpenReaper startup hook at ${conditionalStartupHookPath}`);
    return;
  }
  await mkdir(path.dirname(conditionalStartupHookPath), { recursive: true });
  if (hookStatus) {
    const backupPath = await backupStartupHook(conditionalStartupHookPath);
    report.startup_hook.backup_path = backupPath;
    report.changed.push(`backed up existing REAPER startup hook at ${backupPath}`);
  }
  await writeFile(conditionalStartupHookPath, nextText, { encoding: "utf8", mode: 0o644 });
  report.changed.push(`installed conditional OpenReaper startup hook at ${conditionalStartupHookPath}`);
}

function conditionalStartupHookSource() {
  return `${STARTUP_BEGIN}
-- Inert for ordinary REAPER launches; active only for an OpenReaper-managed session.
do
  local bridge_script = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
  local transport_dir = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")
  local function write_startup_status(stage)
    if not transport_dir or transport_dir == "" then
      return
    end
    local status_path = transport_dir .. "/openreaper-startup-status-v1.json"
    local temp_path = status_path .. ".tmp"
    local file = io.open(temp_path, "w")
    if not file then return end
    file:write("{\\"contract\\":\\"openreaper.startup_status.v1\\",\\"stage\\":\\"" .. stage .. "\\"}\\n")
    file:close()
    os.remove(status_path)
    os.rename(temp_path, status_path)
  end
  write_startup_status("hook_seen")
  if not bridge_script or bridge_script == "" or not transport_dir or transport_dir == "" then
    write_startup_status("environment_missing")
  else
    local ok = pcall(dofile, bridge_script)
    if ok then
      write_startup_status("bridge_dofile_succeeded")
    else
      write_startup_status("bridge_dofile_failed")
    end
  end
end
${STARTUP_END}`;
}

function upsertMarkedBlock(existing, begin, end, block) {
  const withoutExistingBlock = removeMarkedBlock(existing, begin, end);
  // Keep user-owned bytes unchanged; the single separator is consumed by
  // removeMarkedBlock so repeated installs stay byte-stable.
  return `${block}\n${withoutExistingBlock}`;
}

async function cleanupLegacyStartupHooks() {
  const scriptsRoot = path.join(reaperResourceRoot, "Scripts");
  for (const hook of LEGACY_STARTUP_HOOKS) {
    const hookPath = path.join(scriptsRoot, hook.relativePath);
    const hookStatus = await safeLstat(hookPath);
    if (!hookStatus) continue;
    if (!hookStatus.isFile()) {
      report.warnings.push(`legacy REAPER startup hook was preserved because it is not a regular file: ${hookPath}`);
      continue;
    }
    const existing = await readFile(hookPath, "utf8");
    const next = removeMarkedBlocks(existing, hook.blocks);
    if (next === existing) continue;
    report.startup_hook.legacy_cleanup_paths.push(hookPath);
    if (hook.relativePath === "__startup.lua") report.startup_hook.migrated_legacy_lua_path = hookPath;
    if (dryRun) {
      report.skipped.push(`dry run: would remove obsolete OpenReaper startup blocks from ${hookPath}`);
      continue;
    }
    const backupPath = await backupStartupHook(hookPath);
    report.startup_hook.legacy_backup_paths.push(backupPath);
    if (hook.relativePath === "__startup.lua") report.startup_hook.legacy_backup_path = backupPath;
    await writeFile(hookPath, next, { encoding: "utf8", mode: 0o644 });
    report.changed.push(`removed obsolete OpenReaper startup blocks from ${hookPath}`);
  }
}

async function backupStartupHook(hookPath) {
  const stamp = new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);
  const backupPath = `${hookPath}.openreaper-backup-${stamp}-${randomBytes(4).toString("hex")}`;
  await copyFile(hookPath, backupPath, fsConstants.COPYFILE_EXCL);
  return backupPath;
}

async function configureCodex() {
  const configPath = path.join(home, ".codex", "config.toml");
  const openReaperSection = `[mcp_servers.openreaper]
command = ${tomlString(mcpLaunch.command)}
args = ${tomlArray(mcpLaunch.args)}

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
  if (tomlServerIsManaged(next, "mcp_servers.vital-agent-mcp", isManagedVitalMcpText)) {
    next = removeTomlSectionTree(next, "mcp_servers.vital-agent-mcp");
  }
  if (vitalAgentIncluded) {
    if (tomlServerIsPresent(next, "mcp_servers.vital-agent-mcp")) {
      report.warnings.push(`preserved unrelated Codex vital-agent-mcp MCP server at ${configPath}`);
    } else {
      next = upsertTomlSection(next, "mcp_servers.vital-agent-mcp", vitalAgentSection);
    }
  }
  await writeFile(configPath, next, "utf8");
  report.changed.push(`registered Codex MCP server openreaper${vitalAgentIncluded ? " and optional vital-agent-mcp" : " only"} at ${configPath}`);
}

async function configureCursor() {
  const configPath = path.join(home, ".cursor", "mcp.json");
  await upsertJsonMcpServer(configPath, "Cursor");
}

async function configureClaudeDesktop() {
  const configPath = defaultClaudeDesktopConfigPath(home);
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
  if (isLegacyOpenReaperJsonServer(parsed.mcpServers.streetlight)) {
    delete parsed.mcpServers.streetlight;
    report.changed.push(`removed legacy Streetlight MCP server from ${label} config at ${configPath}`);
  }
  parsed.mcpServers.openreaper = {
    command: mcpLaunch.command,
    args: [...mcpLaunch.args],
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
  if (isManagedVitalMcpServer(parsed.mcpServers["vital-agent-mcp"])) {
    delete parsed.mcpServers["vital-agent-mcp"];
  }
  if (vitalAgentIncluded) {
    if (parsed.mcpServers["vital-agent-mcp"]) {
      report.warnings.push(`preserved unrelated ${label} vital-agent-mcp MCP server at ${configPath}`);
    } else {
      parsed.mcpServers["vital-agent-mcp"] = {
        command: vitalAgentMcpCommand,
        args: [],
      };
    }
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
        command: mcpLaunch.command,
        args: [...mcpLaunch.args],
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
command = ${tomlString(mcpLaunch.command)}
args = ${tomlArray(mcpLaunch.args)}

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
    const child = spawn(mcpLaunch.command, mcpLaunch.args, {
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
    const timer = setTimeout(() => child.kill(process.platform === "win32" ? undefined : "SIGTERM"), 3000);
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

Startup window assist: on first use, the Agent must ask for once, always, or
manual. Once/always may handle only exact Project Settings / Notes,
Ignore all missing files, and the exact media-offline warning. Manual never
clicks; it only checks read-only and waits for the user to clear blockers.
License/evaluation, recovery, plugin/FX, version, ambiguous, decision-bearing,
and unknown windows always fail closed.

openreaper-start passes the project and extra arguments to REAPER, and the
installed conditional Scripts/__startup.lua hook starts the Bridge only when
the OpenReaper launch environment is present.
openreaper-start reports ready only after the matching heartbeat and public read probe both pass.
Only if openreaper-start reports the manual recovery fallback, open REAPER's
Actions list, run "${BRIDGE_ACTION_TITLE}", then rerun Doctor and reconnect the
MCP client.
`);
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
    const finish = next.indexOf(end, start + begin.length);
    if (start === -1 || finish === -1 || finish <= start) return next;
    let after = finish + end.length;
    if (next.startsWith("\r\n", after)) after += 2;
    else if (next[after] === "\n" || next[after] === "\r") after += 1;
    next = `${next.slice(0, start)}${next.slice(after)}`;
  }
}

function removeLinesPreservingBytes(existing, keepLine) {
  let next = "";
  let cursor = 0;
  while (cursor < existing.length) {
    let lineEnd = cursor;
    while (lineEnd < existing.length && existing[lineEnd] !== "\n" && existing[lineEnd] !== "\r") lineEnd += 1;
    let segmentEnd = lineEnd;
    if (existing.startsWith("\r\n", segmentEnd)) segmentEnd += 2;
    else if (segmentEnd < existing.length) segmentEnd += 1;
    if (keepLine(existing.slice(cursor, lineEnd))) next += existing.slice(cursor, segmentEnd);
    cursor = segmentEnd;
  }
  return next;
}

function upsertTomlSection(existing, sectionName, sectionText) {
  return rewriteTomlSectionsPreservingBytes(
    existing,
    (section) => tomlPathEquals(section.path, sectionName),
    sectionText,
  );
}

function upsertTomlSectionTree(existing, sectionName, sectionText) {
  return rewriteTomlSectionsPreservingBytes(
    existing,
    (section) => tomlPathStartsWith(section.path, sectionName),
    sectionText,
  );
}

function removeTomlSectionTree(existing, sectionName) {
  return rewriteTomlSectionsPreservingBytes(
    existing,
    (section) => tomlPathStartsWith(section.path, sectionName),
  );
}

function rewriteTomlSectionsPreservingBytes(existing, matchesSection, replacementText = null) {
  const matches = coalesceTomlSectionMatches(
    existing,
    tomlSectionSpans(existing).filter(matchesSection),
  );
  if (matches.length === 0) {
    return replacementText === null
      ? existing
      : appendTomlSectionPreservingBytes(existing, replacementText);
  }

  let replacement = replacementText === null
    ? ""
    : normalizeTomlSectionText(replacementText, preferredLineEnding(existing));
  if (replacement !== "" && matches[0]?.ownsLeadingLineEnding === true) {
    replacement = withOwnedLeadingLineEnding(replacement, preferredLineEnding(existing));
  }
  let next = "";
  let cursor = 0;
  let inserted = false;
  for (const section of matches) {
    next += existing.slice(cursor, section.start);
    if (!inserted && replacement !== "") {
      next += replacement;
      inserted = true;
    }
    cursor = section.end;
  }
  return `${next}${existing.slice(cursor)}`;
}

function coalesceTomlSectionMatches(existing, matches) {
  const coalesced = [];
  for (const match of matches) {
    const previous = coalesced.at(-1);
    if (previous && /^[\t \r\n]*$/u.test(existing.slice(previous.end, match.start))) {
      previous.end = match.end;
    } else {
      coalesced.push({ ...match });
    }
  }
  return coalesced;
}

function appendTomlSectionPreservingBytes(existing, sectionText) {
  const lineEnding = preferredLineEnding(existing);
  const replacement = normalizeTomlSectionText(sectionText, lineEnding);
  if (existing === "") return replacement;
  return /(?:\r\n|\r|\n)$/u.test(existing)
    ? `${existing}${replacement}`
    : `${existing}${withOwnedLeadingLineEnding(replacement, lineEnding)}`;
}

function withOwnedLeadingLineEnding(sectionText, lineEnding) {
  const firstLineEnd = sectionText.indexOf(lineEnding);
  if (firstLineEnd === -1) throw new Error("OpenReaper Codex section must contain a line ending");
  return `${lineEnding}${sectionText.slice(0, firstLineEnd)} ${CODEX_OWNED_LEADING_LINE_ENDING_MARKER}${sectionText.slice(firstLineEnd)}`;
}

function normalizeTomlSectionText(sectionText, lineEnding) {
  const normalized = sectionText.replace(/\r\n|\r|\n/gu, "\n").trimEnd();
  return `${normalized.replace(/\n/gu, lineEnding)}${lineEnding}`;
}

function preferredLineEnding(existing) {
  const match = existing.match(/\r\n|\r|\n/u);
  return match?.[0] ?? "\n";
}

function tomlSectionSpans(existing) {
  const lines = [];
  let cursor = 0;
  let multilineState = null;
  while (cursor < existing.length) {
    const start = cursor;
    while (cursor < existing.length && existing[cursor] !== "\r" && existing[cursor] !== "\n") cursor += 1;
    const lineEnd = cursor;
    if (existing.startsWith("\r\n", cursor)) cursor += 2;
    else if (cursor < existing.length) cursor += 1;
    const contentStart = start === 0 && existing.charCodeAt(0) === 0xfeff ? 1 : start;
    const line = existing.slice(contentStart, lineEnd);
    lines.push({
      start,
      contentStart,
      lineEnd,
      segmentEnd: cursor,
      line,
      path: multilineState === null ? tomlSectionPath(line) : null,
    });
    multilineState = tomlMultilineStateAfterLine(line, multilineState);
  }
  const headerIndexes = lines.flatMap((line, index) => line.path === null ? [] : [index]);
  return headerIndexes.map((lineIndex, headerIndex) => {
    const header = lines[lineIndex];
    const nextLineIndex = headerIndexes[headerIndex + 1] ?? lines.length;
    let end = header.segmentEnd;
    for (let index = lineIndex + 1; index < nextLineIndex; index += 1) {
      const line = existing.slice(lines[index].start, lines[index].lineEnd).trim();
      if (line !== "" && !line.startsWith("#")) end = lines[index].segmentEnd;
    }
    const ownsLeadingLineEnding = header.line.trimEnd().endsWith(CODEX_OWNED_LEADING_LINE_ENDING_MARKER);
    return {
      path: header.path,
      start: ownsLeadingLineEnding ? precedingLineEndingStart(existing, header.contentStart) : header.contentStart,
      end,
      ownsLeadingLineEnding,
    };
  });
}

function precedingLineEndingStart(existing, start) {
  if (start >= 2 && existing.slice(start - 2, start) === "\r\n") return start - 2;
  if (start >= 1 && (existing[start - 1] === "\r" || existing[start - 1] === "\n")) return start - 1;
  return start;
}

function tomlMultilineStateAfterLine(line, initialState) {
  let state = initialState;
  let cursor = 0;
  while (cursor < line.length) {
    if (state === "literal") {
      if (line.startsWith("'''", cursor)) {
        state = null;
        cursor += 3;
      } else {
        cursor += 1;
      }
      continue;
    }
    if (state === "basic") {
      if (line[cursor] === "\\") {
        cursor += 2;
      } else if (line.startsWith('\"\"\"', cursor)) {
        state = null;
        cursor += 3;
      } else {
        cursor += 1;
      }
      continue;
    }
    if (line[cursor] === "#") break;
    if (line.startsWith("'''", cursor)) {
      state = "literal";
      cursor += 3;
      continue;
    }
    if (line.startsWith('\"\"\"', cursor)) {
      state = "basic";
      cursor += 3;
      continue;
    }
    if (line[cursor] === "'") {
      const end = line.indexOf("'", cursor + 1);
      cursor = end === -1 ? line.length : end + 1;
      continue;
    }
    if (line[cursor] === '"') {
      cursor += 1;
      while (cursor < line.length && line[cursor] !== '"') {
        cursor += line[cursor] === "\\" ? 2 : 1;
      }
      cursor += 1;
      continue;
    }
    cursor += 1;
  }
  return state;
}

function tomlSectionPath(line) {
  let cursor = skipTomlWhitespace(line, 0);
  const arrayTable = line.startsWith("[[", cursor);
  if (!line.startsWith(arrayTable ? "[[" : "[", cursor)) return null;
  cursor += arrayTable ? 2 : 1;
  const path = [];
  while (cursor < line.length) {
    cursor = skipTomlWhitespace(line, cursor);
    const key = readTomlKey(line, cursor);
    if (key === null) return null;
    path.push(key.value);
    cursor = skipTomlWhitespace(line, key.end);
    if (line[cursor] === ".") {
      cursor += 1;
      continue;
    }
    const close = arrayTable ? "]]" : "]";
    if (!line.startsWith(close, cursor)) return null;
    cursor = skipTomlWhitespace(line, cursor + close.length);
    return cursor === line.length || line[cursor] === "#" ? path : null;
  }
  return null;
}

function readTomlKey(line, cursor) {
  if (line[cursor] === "'") {
    const end = line.indexOf("'", cursor + 1);
    return end === -1 ? null : { value: line.slice(cursor + 1, end), end: end + 1 };
  }
  if (line[cursor] === '"') {
    let value = "";
    for (let index = cursor + 1; index < line.length; index += 1) {
      const character = line[index];
      if (character === '"') return { value, end: index + 1 };
      if (character !== "\\") {
        value += character;
        continue;
      }
      const escape = line[++index];
      const simple = { b: "\b", t: "\t", n: "\n", f: "\f", r: "\r", '"': '"', "\\": "\\" }[escape];
      if (simple !== undefined) {
        value += simple;
        continue;
      }
      const digits = escape === "u" ? 4 : escape === "U" ? 8 : 0;
      const hex = digits > 0 ? line.slice(index + 1, index + 1 + digits) : "";
      if (digits === 0 || !new RegExp(`^[0-9a-fA-F]{${digits}}$`, "u").test(hex)) return null;
      const codePoint = Number.parseInt(hex, 16);
      if (codePoint > 0x10ffff || (codePoint >= 0xd800 && codePoint <= 0xdfff)) return null;
      value += String.fromCodePoint(codePoint);
      index += digits;
    }
    return null;
  }
  const match = /^[A-Za-z0-9_-]+/u.exec(line.slice(cursor));
  return match ? { value: match[0], end: cursor + match[0].length } : null;
}

function skipTomlWhitespace(line, cursor) {
  while (line[cursor] === " " || line[cursor] === "\t") cursor += 1;
  return cursor;
}

function tomlPathEquals(path, sectionName) {
  const expected = sectionName.split(".");
  return path.length === expected.length && path.every((part, index) => part === expected[index]);
}

function tomlPathStartsWith(path, sectionName) {
  const expected = sectionName.split(".");
  return path.length >= expected.length && expected.every((part, index) => path[index] === part);
}

function removeLegacyOpenReaperTomlSections(existing) {
  return rewriteTomlSectionsPreservingBytes(existing, (section) => {
    const body = existing.slice(section.start, section.end);
    if (tomlPathEquals(section.path, "mcp_servers.openreaper") && isLegacyOpenReaperTomlSection(body)) {
      report.changed.push("removed stale Codex MCP server openreaper that pointed at the legacy Streetlight kernel");
      return true;
    }
    if (tomlPathEquals(section.path, "mcp_servers.openreaper.env") && isLegacyOpenReaperTomlSection(body)) {
      report.changed.push("removed stale STREETLIGHT_* env block from Codex openreaper server");
      return true;
    }
    return false;
  });
}

function tomlServerIsPresent(existing, sectionName) {
  return tomlSectionSpans(existing).some((section) => tomlPathEquals(section.path, sectionName));
}

function tomlServerIsManaged(existing, sectionName, isManagedText) {
  return tomlSectionSpans(existing).some((section) =>
    tomlPathEquals(section.path, sectionName) && isManagedText(existing.slice(section.start, section.end)),
  );
}

function isLegacyOpenReaperJsonServer(server) {
  return server !== null && typeof server === "object" && isLegacyOpenReaperTomlSection(JSON.stringify(server));
}

function isManagedVitalMcpServer(server) {
  return server !== null && typeof server === "object" && isManagedVitalMcpText(JSON.stringify(server));
}

function isManagedVitalMcpText(text) {
  return /(?:[\\/]|\\\\)+\.openreaper(?:[\\/]|\\\\)+[\s\S]*vital-agent-mcp/i.test(text);
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

function tomlArray(values) {
  return `[${values.map((value) => tomlString(value)).join(", ")}]`;
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

async function requireRegularNonSymlinkFile(filePath, label) {
  const status = await safeLstat(filePath);
  if (!status || status.isSymbolicLink() || !status.isFile()) {
    throw new Error(`${label} must be a regular non-symlink file: ${filePath}`);
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
  const requiredValueOptions = new Set(["install-root", "render-root", "reaper-resource-root"]);
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

function defaultReaperResourceRoot(homeDirectory) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA && path.isAbsolute(process.env.APPDATA)
      ? process.env.APPDATA
      : path.join(homeDirectory, "AppData", "Roaming");
    return path.join(appData, "REAPER");
  }
  return path.join(homeDirectory, "Library", "Application Support", "REAPER");
}

function defaultClaudeDesktopConfigPath(homeDirectory) {
  if (process.platform === "win32") {
    const appData = process.env.APPDATA && path.isAbsolute(process.env.APPDATA)
      ? process.env.APPDATA
      : path.join(homeDirectory, "AppData", "Roaming");
    return path.join(appData, "Claude", "claude_desktop_config.json");
  }
  return path.join(homeDirectory, "Library", "Application Support", "Claude", "claude_desktop_config.json");
}

function printInstallHelp() {
  process.stdout.write(`OpenReaper alpha installer

Usage:
  ./install.command [options]
  node ./installer/install-openreaper.mjs [options]

Options:
  --install-root <path>       Install destination (default: ~/.openreaper/current)
  --render-root <path>        Managed render output destination
  --reaper-resource-root <path>
                              REAPER resource directory; defaults to
                              ~/Library/Application Support/REAPER on macOS and
                              %APPDATA%/REAPER on Windows
  --dry-run                   Validate without installing
  --skip-client-config        Do not update supported MCP client configs
  --skip-startup-hook         Skip manual Action install and legacy hook cleanup;
                              trusted package-local startup remains enabled
  --help                      Show this help without installing
`);
}
