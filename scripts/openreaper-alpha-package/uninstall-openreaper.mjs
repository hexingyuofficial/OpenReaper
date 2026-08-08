#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, readdir, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const STARTUP_HOOKS = Object.freeze([
  Object.freeze({
    path: "Scripts/__startup.eel",
    blocks: Object.freeze([
      Object.freeze({
        begin: "// >>> OpenReaper alpha MCP startup hook >>>",
        end: "// <<< OpenReaper alpha MCP startup hook <<<",
      }),
    ]),
  }),
  Object.freeze({
    path: "Scripts/__startup.lua",
    blocks: Object.freeze([
      Object.freeze({
        begin: "-- >>> OpenReaper alpha MCP startup hook >>>",
        end: "-- <<< OpenReaper alpha MCP startup hook <<<",
      }),
      Object.freeze({
        begin: "-- >>> OpenReaper Alpha3 MCP startup hook >>>",
        end: "-- <<< OpenReaper Alpha3 MCP startup hook <<<",
      }),
      Object.freeze({
        begin: "-- >>> Streetlight MCP startup hook >>>",
        end: "-- <<< Streetlight MCP startup hook <<<",
      }),
    ]),
  }),
]);
const BRIDGE_ACTION_TITLE = "OpenReaper: Start MCP bridge";
const BRIDGE_ACTION_RELATIVE_SCRIPT = "OpenReaper/openreaper-start-mcp-bridge.lua";
const BRIDGE_ACTION_COMMAND_ID = `RS${createHash("sha1").update("openreaper.alpha.start_mcp_bridge.v1").digest("hex")}`;
const S3_ACTIONS = Object.freeze([
  // The installed Action pair uses stock GetUserInputs/ShowMessageBox and
  // GetExtState/SetExtState, with the shared plan_hash route retained here:
  // template.items.split_item_by_silence.
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
const CODEX_OWNED_LEADING_LINE_ENDING_MARKER = "# OpenReaper owns the preceding line ending";
const MANAGED_RENDER_ROOT_RECORD_MAX_BYTES = 4096;
const MANAGED_RENDER_ROOT_PATH_MAX_BYTES = 3072;

let options;
try {
  options = parseArgs(process.argv.slice(2));
} catch (error) {
  process.stderr.write(`[OpenReaper] ${String(error?.message ?? "invalid option").replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320)}\n`);
  process.exit(2);
}
if (options.help === true) {
  printUninstallHelp();
  process.exit(0);
}
const home = os.homedir();
const installRoot = path.resolve(options.install_root ?? path.join(home, ".openreaper", "current"));
const reaperResourceRoot = path.resolve(options.reaper_resource_root ?? defaultReaperResourceRoot(home));
const defaultRenderRoot = path.join(installRoot, "session", "renders");
const managedRenderRootRecord = path.join(installRoot, "session", "managed-render-root.path");
const executableRecipeRoot = path.join(path.dirname(installRoot), "data", "executable-recipes");
const startupDialogConsentPath = path.join(path.dirname(installRoot), "data", "startup-dialog-consent");
const skipClientConfig = options.skip_client_config === true;
const skipStartupHook = options.skip_startup_hook === true;
const managedRenderRootRecordResult = await readManagedRenderRootRecord();
const executableRecipeRootResult = await inspectExecutableRecipeRoot();
const report = {
  product: "OpenReaper alpha",
  install_root: installRoot,
  reaper_resource_root: reaperResourceRoot,
  s3_actions: S3_ACTIONS.map((action) => ({
    title: action.title,
    command_id: `_${action.commandId}`,
    script: path.join(reaperResourceRoot, "Scripts", ...action.relativeScript.split("/")),
    removed: false,
  })),
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
  executable_recipe_root: {
    path: executableRecipeRoot,
    status: executableRecipeRootResult.status,
    preserved: executableRecipeRootResult.status === "ready",
  },
  startup_dialog_consent: {
    path: startupDialogConsentPath,
    removed: false,
    status: "missing",
  },
  changed: [],
  skipped: [],
  warnings: [],
};

if (!skipStartupHook) {
  await removeStartupIntegration();
} else {
  report.skipped.push("manual REAPER bridge Action and legacy startup-hook cleanup skipped because --skip-startup-hook was set");
}
if (!skipClientConfig) {
  await removeCodexSection();
  await removeJsonServer(path.join(home, ".cursor", "mcp.json"), "Cursor");
  await removeJsonServer(defaultClaudeDesktopConfigPath(home), "Claude Desktop");
} else {
  report.skipped.push("client config cleanup skipped because --skip-client-config was set");
}
await preserveDefaultRenderOutputs();
await removeStartupDialogConsent();
await rm(installRoot, { recursive: true, force: true });
report.changed.push(`removed ${installRoot}`);
console.log(JSON.stringify(report, null, 2));

async function removeStartupDialogConsent() {
  const status = await safeLstat(startupDialogConsentPath);
  if (!status) return;
  if (status.isDirectory()) {
    report.startup_dialog_consent.status = "unsafe_directory_preserved";
    report.warnings.push(`startup dialog consent path is a directory and was not recursively removed: ${startupDialogConsentPath}`);
    return;
  }
  await rm(startupDialogConsentPath, { force: true });
  report.startup_dialog_consent.removed = true;
  report.startup_dialog_consent.status = status.isSymbolicLink() ? "symlink_removed_without_following" : "removed";
  report.changed.push(`removed startup dialog consent so reinstall asks again: ${startupDialogConsentPath}`);
}

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

async function inspectExecutableRecipeRoot() {
  const dataRoot = path.dirname(executableRecipeRoot);
  const dataStatus = await safeLstat(dataRoot);
  if (dataStatus?.isSymbolicLink()) {
    throw new Error(`Executable recipe data root must not be a symlink: ${dataRoot}`);
  }
  if (dataStatus && !dataStatus.isDirectory()) {
    throw new Error(`Executable recipe data root must be a directory: ${dataRoot}`);
  }
  const status = await safeLstat(executableRecipeRoot);
  if (!status) return { status: "missing" };
  if (status.isSymbolicLink()) {
    throw new Error(`Executable recipe root must not be a symlink: ${executableRecipeRoot}`);
  }
  if (!status.isDirectory()) {
    throw new Error(`Executable recipe root must be a directory: ${executableRecipeRoot}`);
  }
  return { status: "ready" };
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
      if (["install-root", "reaper-resource-root"].includes(rawKey) && rawValue === "") {
        throw new Error(`--${rawKey} requires a non-empty value.`);
      }
      parsed[rawKey.replaceAll("-", "_")] = rawValue;
      continue;
    }
    const key = raw.replaceAll("-", "_");
    const next = args[index + 1];
    if (["install-root", "reaper-resource-root"].includes(raw) && (!next || next.startsWith("--"))) {
      throw new Error(`--${raw} requires a non-empty value.`);
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

function printUninstallHelp() {
  process.stdout.write(`OpenReaper alpha uninstaller

Usage:
  ./uninstall.command [options]
  node ./installer/uninstall-openreaper.mjs [options]

Options:
  --install-root <path>       Install destination (default: ~/.openreaper/current)
  --reaper-resource-root <path>
                              REAPER resource directory; defaults to
                              ~/Library/Application Support/REAPER on macOS and
                              %APPDATA%/REAPER on Windows
  --skip-client-config        Do not update supported MCP client configs
  --skip-startup-hook         Keep the manual Action and legacy startup blocks
  --help                      Show this help without uninstalling
`);
}

async function removeStartupIntegration() {
  await removeBridgeAction();
  await removeS3Actions();
  for (const hook of STARTUP_HOOKS) {
    const hookPath = path.join(reaperResourceRoot, hook.path);
    const status = await safeLstat(hookPath);
    if (!status) continue;
    if (!status.isFile()) {
      report.warnings.push(`REAPER startup hook is not a regular file and was preserved: ${hookPath}`);
      continue;
    }
    const existing = await readFile(hookPath, "utf8");
    let next = existing;
    for (const block of hook.blocks) next = removeMarkedBlock(next, block.begin, block.end);
    if (next !== existing) {
      await writeFile(hookPath, next, "utf8");
      report.changed.push(`removed obsolete OpenReaper startup blocks from ${hookPath}`);
    }
  }
}

async function removeBridgeAction() {
  const actionPath = path.join(reaperResourceRoot, "Scripts", ...BRIDGE_ACTION_RELATIVE_SCRIPT.split("/"));
  const actionStatus = await safeLstat(actionPath);
  if (actionStatus) {
    if (actionStatus.isSymbolicLink() || !actionStatus.isFile()) {
      report.warnings.push(`REAPER bridge Action path is not a regular non-symlink file and was preserved: ${actionPath}`);
    } else {
      await rm(actionPath, { force: true });
      report.changed.push(`removed REAPER bridge Action ${BRIDGE_ACTION_TITLE} from ${actionPath}`);
    }
  }

  const kbPath = path.join(reaperResourceRoot, "reaper-kb.ini");
  const kbStatus = await safeLstat(kbPath);
  if (!kbStatus) return;
  if (kbStatus.isSymbolicLink() || !kbStatus.isFile()) {
    report.warnings.push(`REAPER Action registry is not a regular non-symlink file and was preserved: ${kbPath}`);
    return;
  }
  const existing = await readFile(kbPath, "utf8");
  const ownedLines = new Set([bridgeActionRegistryLine(), ...s3ActionRegistryLines()]);
  const next = removeLinesPreservingBytes(existing, (line) => !ownedLines.has(line));
  if (next !== existing) {
    await writeFile(kbPath, next, "utf8");
    report.changed.push(`removed OpenReaper Action registrations from ${kbPath}`);
  }
}

async function removeS3Actions() {
  const entries = [
    ...S3_ACTIONS,
    { title: "OpenReaper S3 shared Remove Silence core", relativeScript: S3_ACTION_SUPPORT_RELATIVE_SCRIPT },
  ];
  for (const action of entries) {
    const actionPath = path.join(reaperResourceRoot, "Scripts", ...action.relativeScript.split("/"));
    const status = await safeLstat(actionPath);
    if (!status) continue;
    if (status.isSymbolicLink() || !status.isFile()) {
      report.warnings.push(`REAPER Action path is not a regular non-symlink file and was preserved: ${actionPath}`);
      continue;
    }
    await rm(actionPath, { force: true });
    const reportEntry = report.s3_actions.find((entry) => entry.script === actionPath);
    if (reportEntry) reportEntry.removed = true;
    report.changed.push(`removed ${action.title} from ${actionPath}`);
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

async function removeCodexSection() {
  const configPath = path.join(home, ".codex", "config.toml");
  const existing = await readTextIfExists(configPath);
  if (existing === "") return;
  let next = removeManagedTomlSectionTree(existing, "mcp_servers.vital-agent-mcp", isManagedVitalMcpText);
  next = removeTomlSectionTree(next, "mcp_servers.openreaper");
  if (next !== existing) {
    await writeFile(configPath, next, "utf8");
    report.changed.push(`removed owned Codex OpenReaper MCP config from ${configPath}`);
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
    if (isManagedVitalMcpServer(parsed.mcpServers?.["vital-agent-mcp"])) {
      delete parsed.mcpServers["vital-agent-mcp"];
      changed = true;
    }
    if (changed) {
      await writeFile(configPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
      report.changed.push(`removed owned ${label} OpenReaper MCP config from ${configPath}`);
    }
  } catch {
    report.warnings.push(`Skipped ${label} config because it is not valid JSON: ${configPath}`);
  }
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

function removeTomlSectionTree(existing, sectionName) {
  const matches = coalesceTomlSectionMatches(
    existing,
    tomlSectionSpans(existing).filter((section) => tomlPathStartsWith(section.path, sectionName)),
  );
  if (matches.length === 0) return existing;
  let next = "";
  let cursor = 0;
  for (const section of matches) {
    next += existing.slice(cursor, section.start);
    cursor = section.end;
  }
  return `${next}${existing.slice(cursor)}`;
}

function removeManagedTomlSectionTree(existing, sectionName, isManagedText) {
  const sections = tomlSectionSpans(existing);
  const root = sections.find((section) => tomlPathEquals(section.path, sectionName));
  if (!root || !isManagedText(existing.slice(root.start, root.end))) return existing;
  return removeTomlSectionTree(existing, sectionName);
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

function tomlPathStartsWith(path, sectionName) {
  const expected = sectionName.split(".");
  return path.length >= expected.length && expected.every((part, index) => path[index] === part);
}

function tomlPathEquals(path, sectionName) {
  const expected = sectionName.split(".");
  return path.length === expected.length && path.every((part, index) => part === expected[index]);
}

function isManagedVitalMcpServer(server) {
  return server !== null && typeof server === "object" && isManagedVitalMcpText(JSON.stringify(server));
}

function isManagedVitalMcpText(text) {
  return /(?:[\\/]|\\\\)+\.openreaper(?:[\\/]|\\\\)+[\s\S]*vital-agent-mcp/i.test(text);
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return "";
    throw error;
  }
}
