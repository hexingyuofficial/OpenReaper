#!/usr/bin/env node

import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STARTUP_BEGIN = "-- >>> OpenReaper alpha MCP startup hook >>>";
const STARTUP_END = "-- <<< OpenReaper alpha MCP startup hook <<<";
const MANAGED_RENDER_ROOT_RECORD_MAX_BYTES = 4096;
const MANAGED_RENDER_ROOT_PATH_MAX_BYTES = 3072;

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[OpenReaper] ${String(error?.message ?? "invalid option").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320)}\n`);
  process.exit(2);
}
const home = os.homedir();
const installRoot = path.resolve(options.install_root ?? path.join(home, ".openreaper", "current"));
const defaultRenderRoot = path.join(installRoot, "session", "renders");
const managedRenderRootRecord = path.join(installRoot, "session", "managed-render-root.path");
const skipClientConfig = options.skip_client_config === true;
const skipStartupHook = options.skip_startup_hook === true;
const managedRenderRootRecordResult = await readManagedRenderRootRecord();
const report = {
  product: "OpenReaper alpha",
  install_root: installRoot,
  render_root: {
    record_status: managedRenderRootRecordResult.status,
    record_invalid_reason: managedRenderRootRecordResult.reason ?? null,
    persisted_selection: managedRenderRootRecordResult.status === "valid" ? managedRenderRootRecordResult.path : null,
    external_custom_untouched: null,
    default_root_nonempty: false,
    preserved_default_at: null,
    preservation_container: null,
    symlink_followed: false,
  },
  changed: [],
  skipped: [],
  warnings: [],
};

if (!skipStartupHook) {
  await removeStartupHook();
} else {
  report.skipped.push("REAPER startup hook cleanup skipped because --skip-startup-hook was set");
}
if (!skipClientConfig) {
  await removeCodexSection();
  await removeJsonServer(path.join(home, ".cursor", "mcp.json"), "Cursor");
  await removeJsonServer(path.join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json"), "Claude Desktop");
} else {
  report.skipped.push("client config cleanup skipped because --skip-client-config was set");
}
await preserveDefaultRenderOutputs();
await rm(installRoot, { recursive: true, force: true });
report.changed.push(`removed ${installRoot}`);
console.log(JSON.stringify(report, null, 2));

async function preserveDefaultRenderOutputs() {
  const selected = report.render_root.persisted_selection;
  if (managedRenderRootRecordResult.status === "invalid") {
    report.warnings.push(`ignored invalid managed render root record: ${managedRenderRootRecordResult.reason}`);
  }
  if (selected && !await sameCanonicalPath(selected, defaultRenderRoot)) {
    report.render_root.external_custom_untouched = selected;
    report.skipped.push(`external custom render root left untouched: ${selected}`);
  }
  const status = await safeLstat(defaultRenderRoot);
  if (!status) return;
  if (status.isSymbolicLink()) {
    report.warnings.push(`default render root is a symlink and will not be followed: ${defaultRenderRoot}`);
    return;
  }
  if (!status.isDirectory()) {
    report.warnings.push(`default render root is not a directory and will be removed with the install: ${defaultRenderRoot}`);
    return;
  }
  const entries = await readdir(defaultRenderRoot);
  if (entries.length === 0) return;
  report.render_root.default_root_nonempty = true;
  const container = await allocatePreservationContainer();
  const preservationRoot = path.join(container, "renders");
  try {
    await rename(defaultRenderRoot, preservationRoot);
  } catch (error) {
    await rm(container, { recursive: true, force: true }).catch(() => {});
    throw new Error(`Could not preserve default render outputs; source was left in place. ${error.code ?? "ERROR"}: ${error.message}`);
  }
  report.render_root.preserved_default_at = preservationRoot;
  report.render_root.preservation_container = container;
  report.changed.push(`preserved non-empty default render root at ${preservationRoot}`);
}

async function readManagedRenderRootRecord() {
  try {
    const status = await safeLstat(managedRenderRootRecord);
    if (!status) return { status: "missing" };
    if (status.isSymbolicLink() || !status.isFile()) {
      throw new Error("record entry is a symlink or non-regular file");
    }
    if (status.size > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
      throw new Error(`record exceeds ${MANAGED_RENDER_ROOT_RECORD_MAX_BYTES} bytes`);
    }
    const handle = await open(
      managedRenderRootRecord,
      fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0),
    );
    try {
      const openedStatus = await handle.stat();
      if (!openedStatus.isFile() || openedStatus.size > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
        throw new Error("record changed, is not regular, or is oversized");
      }
      const buffer = Buffer.alloc(MANAGED_RENDER_ROOT_RECORD_MAX_BYTES + 1);
      const bytesRead = await readBoundedBytes(handle, buffer);
      if (bytesRead > MANAGED_RENDER_ROOT_RECORD_MAX_BYTES) {
        throw new Error(`record exceeds ${MANAGED_RENDER_ROOT_RECORD_MAX_BYTES} bytes`);
      }
      let text;
      try {
        text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
      } catch {
        throw new Error("record is not valid UTF-8");
      }
      const value = text.endsWith("\n") ? text.slice(0, -1) : text;
      if (value === "" || value.includes("\n")) throw new Error("record must contain exactly one non-empty path line");
      validateRenderRootText(value);
      await validateRecordedRootSelection(value);
      return { status: "valid", path: value };
    } finally {
      await handle.close();
    }
  } catch (error) {
    return { status: "invalid", reason: boundedReason(error?.message ?? "invalid record") };
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

function validateRenderRootText(candidate) {
  if (typeof candidate !== "string" || candidate === "") throw new Error("path is empty");
  if (Buffer.byteLength(candidate, "utf8") > MANAGED_RENDER_ROOT_PATH_MAX_BYTES) {
    throw new Error(`path exceeds ${MANAGED_RENDER_ROOT_PATH_MAX_BYTES} UTF-8 bytes`);
  }
  if (/^file:/i.test(candidate)) throw new Error("path is a file URI");
  if (/[\u0000-\u001f\u007f]/u.test(candidate)) throw new Error("path contains C0/DEL control characters");
  if (!path.isAbsolute(candidate)) throw new Error("path is not absolute");
  if (path.normalize(candidate) === path.parse(path.normalize(candidate)).root) throw new Error("path is the filesystem root");
}

async function validateRecordedRootSelection(candidate) {
  const candidateCanonical = await canonicalPath(candidate);
  if (candidateCanonical === await canonicalPath(home)) throw new Error("path is the user home directory");
  const defaultCanonical = await canonicalPath(defaultRenderRoot);
  if (candidateCanonical !== defaultCanonical) {
    for (const reserved of [
      installRoot,
      path.join(installRoot, "session"),
      path.join(installRoot, "session", "transport"),
      path.join(installRoot, "session", "artifacts"),
    ]) {
      const reservedCanonical = await canonicalPath(reserved);
      if (pathsOverlap(candidateCanonical, reservedCanonical)) throw new Error("path overlaps a reserved OpenReaper root");
    }
  }
  const status = await safeLstat(candidate);
  if (status?.isSymbolicLink()) throw new Error("selected path final component is a symlink");
  if (status && !status.isDirectory()) throw new Error("selected path is not a directory");
}

function pathsOverlap(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

function boundedReason(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320);
}

async function allocatePreservationContainer() {
  const parent = path.dirname(installRoot);
  await mkdir(parent, { recursive: true });
  return mkdtemp(path.join(parent, ".openreaper-render-preservation-"));
}

async function sameCanonicalPath(left, right) {
  return await canonicalPath(left) === await canonicalPath(right);
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

async function safeLstat(filePath) {
  try {
    return await lstat(filePath);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const raw = arg.slice(2);
    const equals = raw.indexOf("=");
    if (equals !== -1) {
      const rawKey = raw.slice(0, equals);
      const rawValue = raw.slice(equals + 1);
      if (rawKey === "install-root" && rawValue === "") {
        throw new Error("--install-root requires a non-empty value.");
      }
      parsed[rawKey.replaceAll("-", "_")] = rawValue;
      continue;
    }
    const key = raw.replaceAll("-", "_");
    const next = args[index + 1];
    if (raw === "install-root" && (!next || next.startsWith("--"))) {
      throw new Error("--install-root requires a non-empty value.");
    }
    if (next && !next.startsWith("--")) {
      parsed[key] = next;
      index += 1;
    } else {
      parsed[key] = true;
    }
  }
  return parsed;
}

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
