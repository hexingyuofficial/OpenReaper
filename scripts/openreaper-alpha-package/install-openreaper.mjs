#!/usr/bin/env node

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { chmod, cp, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STARTUP_BEGIN = "-- >>> OpenReaper alpha MCP startup hook >>>";
const STARTUP_END = "-- <<< OpenReaper alpha MCP startup hook <<<";
const DEFAULT_PACKS = "core,cleanup,delivery,analysis,loop,pack_contract_fixture";

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
const sessionRoot = path.join(installRoot, "session");
const transportDir = path.join(sessionRoot, "transport");
const artifactRoot = path.join(sessionRoot, "artifacts");
const bridgeScript = path.join(installRoot, "vendor", "openreaper-kernel", "reaper", "bridge", "openreaper-live-bridge.lua");

const report = {
  product: "OpenReaper alpha",
  dry_run: dryRun,
  package_root: packageRoot,
  install_root: installRoot,
  mcp_command: mcpCommand,
  vital_agent_mcp_command: vitalAgentMcpCommand,
  start_command: startCommand,
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
  await chmod(path.join(installedBin, "openreaper-doctor"), 0o755);
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await mkdir(artifactRoot, { recursive: true });
} else {
  report.skipped.push("dry run: did not copy package or create queue directories");
}

if (!skipStartupHook) {
  await installStartupHook();
} else {
  report.skipped.push("startup hook not installed because --skip-startup-hook was set");
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

async function installStartupHook() {
  const hookPath = path.join(home, "Library", "Application Support", "REAPER", "Scripts", "__startup.lua");
  const block = startupHookBlock();
  if (dryRun) {
    report.skipped.push(`dry run: would upsert REAPER startup hook at ${hookPath}`);
    return;
  }
  await mkdir(path.dirname(hookPath), { recursive: true });
  const existing = await readTextIfExists(hookPath);
  const next = upsertMarkedBlock(existing, STARTUP_BEGIN, STARTUP_END, block);
  if (existing !== next) {
    await writeFile(hookPath, next, "utf8");
    report.changed.push(`upserted conditional REAPER startup hook at ${hookPath}`);
  }
}

function startupHookBlock() {
  return `${STARTUP_BEGIN}
-- Inert for normal REAPER launches; active only when openreaper-start sets env.
do
  local bridge = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
  local transport = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")
  if bridge and bridge ~= "" and transport and transport ~= "" then
    local ok, err = pcall(dofile, bridge)
    if not ok and reaper and reaper.ShowConsoleMsg then
      reaper.ShowConsoleMsg("[OpenReaper] startup bridge failed: " .. tostring(err) .. "\\n")
    end
  end
end
${STARTUP_END}
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
  next = upsertTomlSection(next, "mcp_servers.openreaper", openReaperSection);
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

Restart Codex/Cursor/Claude so they reload MCP config, then ask:
  "Open REAPER with OpenReaper and inspect the current project."

Important: OpenReaper MCP connects only when REAPER is started through:
  ${startCommand}

If REAPER shows a startup/version/recovery/plugin dialog, dismiss it and ask the agent to reconnect.
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
    if (section.header === "[mcp_servers.streetlight]") {
      report.changed.push("removed legacy Codex MCP server streetlight");
      return false;
    }
    if (section.header === "[mcp_servers.streetlight.env]") return false;
    if (section.header === "[mcp_servers.openreaper.env]" && section.lines.join("\n").includes("STREETLIGHT_")) {
      report.changed.push("removed stale STREETLIGHT_* env block from Codex openreaper server");
      return false;
    }
    return true;
  });
  return `${kept.map((section) => section.lines.join("\n").trimEnd()).join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
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
