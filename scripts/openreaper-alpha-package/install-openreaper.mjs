#!/usr/bin/env node

import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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
const SWS_MISC_SECTION = "[Misc]";
const SWS_GLOBAL_STARTUP_KEY = "GlobalStartupAction";
const REAPER_RESOURCE_ROOT = path.join(os.homedir(), "Library", "Application Support", "REAPER");
const BRIDGE_ACTION_TITLE = "OpenReaper: Start MCP bridge";
const BRIDGE_ACTION_RELATIVE_SCRIPT = "OpenReaper/openreaper-start-mcp-bridge.lua";
const BRIDGE_ACTION_COMMAND_ID = `RS${createHash("sha1").update("openreaper.alpha.start_mcp_bridge.v1").digest("hex")}`;

const packageRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const options = parseArgs(process.argv.slice(2));
const home = os.homedir();
const installRoot = path.resolve(options.install_root ?? path.join(home, ".openreaper", "current"));
const dryRun = options.dry_run === true;
const skipClientConfig = options.skip_client_config === true;
const skipStartupHook = options.skip_startup_hook === true;

const installedBin = path.join(installRoot, "bin");
const mcpCommand = path.join(installedBin, "openreaper-mcp");
const vitalAgentMcpCommand = path.join(installedBin, "vital-agent-mcp");
const startCommand = path.join(installedBin, "openreaper-start");
const doctorCommand = path.join(installedBin, "openreaper-doctor");
const sessionRoot = path.join(installRoot, "session");
const transportDir = path.join(sessionRoot, "transport");
const artifactRoot = path.join(sessionRoot, "artifacts");
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");
const bridgeActionScript = path.join(REAPER_RESOURCE_ROOT, "Scripts", ...BRIDGE_ACTION_RELATIVE_SCRIPT.split("/"));
const bridgeActionCommand = `_${BRIDGE_ACTION_COMMAND_ID}`;

const report = {
  product: "OpenReaper alpha",
  dry_run: dryRun,
  package_root: packageRoot,
  install_root: installRoot,
  mcp_command: mcpCommand,
  vital_agent_mcp_command: vitalAgentMcpCommand,
  start_command: startCommand,
  bridge_action: {
    title: BRIDGE_ACTION_TITLE,
    command_id: bridgeActionCommand,
    script: bridgeActionScript,
  },
  startup_dialog_assist: {
    auto_dismisses: ["Project Settings / Notes show notes on project load"],
    does_not_dismiss: ["license/evaluation", "recovery", "plugin/FX", "version", "unknown REAPER windows"],
  },
  transport_dir: transportDir,
  artifact_root: artifactRoot,
  changed: [],
  skipped: [],
  warnings: [],
};

if (process.platform !== "darwin") {
  report.warnings.push("This alpha installer is macOS-first. Other platforms need a manual REAPER resource path and client config check.");
}

await requireNode20();

if (!dryRun) {
  await mkdir(path.dirname(installRoot), { recursive: true });
  await replaceInstallRoot();
  await cp(packageRoot, installRoot, {
    recursive: true,
    filter: (src) => !src.includes(`${path.sep}.DS_Store`),
  });
  report.changed.push(`installed package at ${installRoot}`);
  await chmod(path.join(installRoot, "install.command"), 0o755).catch(() => {});
  await chmod(path.join(installRoot, "uninstall.command"), 0o755).catch(() => {});
  await chmod(mcpCommand, 0o755);
  await chmod(vitalAgentMcpCommand, 0o755);
  await chmod(startCommand, 0o755);
  await chmod(doctorCommand, 0o755);
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
} else {
  report.skipped.push("dry run: did not copy package or create queue directories");
}

if (!skipStartupHook) {
  await installBridgeAction();
  await removeOptionalStartupHook();
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

async function requireNode20() {
  const major = Number(process.versions.node.split(".")[0]);
  if (!Number.isFinite(major) || major < 20) {
    throw new Error(`OpenReaper alpha needs Node >= 20. Current node: ${process.version}`);
  }
}

async function replaceInstallRoot() {
  if (!existsSync(installRoot)) return;
  const backupRoot = `${installRoot}.previous-${compactTimestamp(new Date())}`;
  try {
    await rename(installRoot, backupRoot);
    report.changed.push(`moved previous install to ${backupRoot}`);
  } catch (error) {
    report.warnings.push(
      `Could not move previous install out of the way. Close running MCP clients that use OpenReaper and retry. ${error.code ?? "ERROR"}: ${error.message}`,
    );
    throw error;
  }
  await rm(backupRoot, { recursive: true, force: true }).catch((error) => {
    report.warnings.push(`Previous install cleanup deferred: ${backupRoot}; ${error.code ?? "ERROR"}: ${error.message}`);
  });
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

async function removeOptionalStartupHook() {
  const hookPath = path.join(REAPER_RESOURCE_ROOT, "Scripts", "__startup.lua");
  const existing = await readTextIfExists(hookPath);
  if (existing === "") {
    report.skipped.push("no REAPER __startup.lua hook found; no OpenReaper startup hook cleanup needed");
    return;
  }
  const next = removeMarkedBlocks(existing, LEGACY_STARTUP_BLOCKS).trimEnd();
  if (!dryRun && next !== existing.trimEnd()) {
    await writeFile(hookPath, next === "" ? "" : `${next}\n`, "utf8");
    report.changed.push(`removed prior OpenReaper/Streetlight startup hook from ${hookPath}`);
  } else if (next === existing.trimEnd()) {
    report.skipped.push(`no prior OpenReaper/Streetlight startup hook found in ${hookPath}`);
  }
}

function bridgeActionScriptSource() {
  return `-- OpenReaper: Start MCP bridge
-- Installed by OpenReaper alpha. Run this action after openreaper-start opens REAPER.
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
OPENREAPER_LIVE_BRIDGE_OWNER = "openreaper-alpha"
OPENREAPER_LIVE_BRIDGE_GENERATION = "1"
`;
  const vitalAgentSection = `[mcp_servers.vital-agent-mcp]
command = ${tomlString(vitalAgentMcpCommand)}
args = []
`;
  if (dryRun) {
    report.skipped.push(`dry run: would upsert Codex MCP config for openreaper and vital-agent-mcp at ${configPath}`);
    return;
  }
  await mkdir(path.dirname(configPath), { recursive: true });
  const existing = await readTextIfExists(configPath);
  let next = removeLegacyOpenReaperTomlSections(existing);
  next = upsertTomlSectionTree(next, "mcp_servers.openreaper", openReaperSection);
  next = upsertTomlSection(next, "mcp_servers.vital-agent-mcp", vitalAgentSection);
  await writeFile(configPath, next, "utf8");
  report.changed.push(`registered Codex MCP servers openreaper and vital-agent-mcp at ${configPath}`);
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
      OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
      OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
    },
  };
  parsed.mcpServers["vital-agent-mcp"] = {
    command: vitalAgentMcpCommand,
    args: [],
  };
  await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  report.changed.push(`registered ${label} MCP servers openreaper and vital-agent-mcp at ${configPath}`);
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
          OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
          OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
        },
      },
      "vital-agent-mcp": {
        command: vitalAgentMcpCommand,
        args: [],
      },
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
OPENREAPER_LIVE_BRIDGE_OWNER = "openreaper-alpha"
OPENREAPER_LIVE_BRIDGE_GENERATION = "1"

[mcp_servers.vital-agent-mcp]
command = ${tomlString(vitalAgentMcpCommand)}
args = []
`, "utf8");
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
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replaceAll("-", "_");
    if (key.startsWith("no_")) {
      parsed[`skip_${key.slice(3)}`] = true;
      continue;
    }
    const equals = key.indexOf("=");
    if (equals !== -1) {
      parsed[key.slice(0, equals)] = parseArgValue(key.slice(equals + 1));
      continue;
    }
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
