#!/usr/bin/env node

import { rm, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STARTUP_BEGIN = "-- >>> OpenReaper alpha MCP startup hook >>>";
const STARTUP_END = "-- <<< OpenReaper alpha MCP startup hook <<<";

const home = os.homedir();
const installRoot = path.join(home, ".openreaper", "current");
const report = { product: "OpenReaper alpha", changed: [], warnings: [] };

await removeStartupHook();
await removeCodexSection();
await removeJsonServer(path.join(home, ".cursor", "mcp.json"), "Cursor");
await removeJsonServer(path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), "Claude Desktop");
await rm(installRoot, { recursive: true, force: true });
report.changed.push(`removed ${installRoot}`);
console.log(JSON.stringify(report, null, 2));

async function removeStartupHook() {
  const hookPath = path.join(home, "Library", "Application Support", "REAPER", "Scripts", "__startup.lua");
  const existing = await readTextIfExists(hookPath);
  if (existing === "") return;
  const next = removeMarkedBlock(existing, STARTUP_BEGIN, STARTUP_END);
  if (next !== existing) {
    await writeFile(hookPath, next, "utf8");
    report.changed.push(`removed REAPER startup hook from ${hookPath}`);
  }
}

async function removeCodexSection() {
  const configPath = path.join(home, ".codex", "config.toml");
  const existing = await readTextIfExists(configPath);
  if (existing === "") return;
  let next = removeTomlSection(existing, "mcp_servers.openreaper");
  next = removeTomlSection(next, "mcp_servers.vital-agent-mcp");
  if (next !== existing) {
    await writeFile(configPath, next, "utf8");
    report.changed.push(`removed Codex openreaper and vital-agent-mcp MCP config from ${configPath}`);
  }
}

async function removeJsonServer(configPath, label) {
  const existing = await readTextIfExists(configPath);
  if (existing.trim() === "") return;
  try {
    const parsed = JSON.parse(existing);
    let changed = false;
    if (parsed.mcpServers?.openreaper) {
      delete parsed.mcpServers.openreaper;
      changed = true;
    }
    if (parsed.mcpServers?.["vital-agent-mcp"]) {
      delete parsed.mcpServers["vital-agent-mcp"];
      changed = true;
    }
    if (changed) {
      await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      report.changed.push(`removed ${label} openreaper and vital-agent-mcp MCP config from ${configPath}`);
    }
  } catch {
    report.warnings.push(`Skipped ${label} config because it is not valid JSON: ${configPath}`);
  }
}

function removeMarkedBlock(existing, begin, end) {
  const start = existing.indexOf(begin);
  const finish = existing.indexOf(end);
  if (start === -1 || finish === -1 || finish <= start) return existing;
  return `${existing.slice(0, start).trimEnd()}\n${existing.slice(finish + end.length).trimStart()}`.trimEnd() + "\n";
}

function removeTomlSection(existing, sectionName) {
  const header = `[${sectionName}]`;
  const lines = existing.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === header);
  if (start === -1) return existing;
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i += 1) {
    if (/^\s*\[/.test(lines[i])) {
      end = i;
      break;
    }
  }
  return `${[...lines.slice(0, start), ...lines.slice(end)].join("\n").trimEnd()}\n`;
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}
