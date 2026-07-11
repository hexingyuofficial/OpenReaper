#!/usr/bin/env node

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  mkdir,
  readFile,
  readdir,
  stat,
  unlink,
  writeFile,
} from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONTRACT = "alpha3.2.c3a.project_file_read.v1";
const REPORT_FILENAME = "alpha3-2c3a-project-file-read.json";
const IDS = [
  "template.project.read_current_project_path",
  "template.project.read_dirty_state",
];
const EXACT_TOOLS = ["call_template", "get_state", "list_recipes", "list_templates", "ping"];
const MAX_SNAPSHOT_ENTRIES = 2_000;

let options;
try {
  options = parseArgs(process.argv.slice(2));
  validateOptionPaths(options);
} catch (error) {
  failWithoutReport(error);
}

const reportPath = path.join(options.evidence_root, REPORT_FILENAME);
let client = null;
let before = null;
let preflight = null;
let calls = null;
let toolNames = null;
let runError = null;
let evidenceRootCreated = false;

try {
  await createFreshEvidenceRoot(options.evidence_root);
  evidenceRootCreated = true;
  preflight = await validatePreflight(options);
  before = await captureFilesystemEvidence(options.expected_project_path);
  assertSnapshotComplete(before, "before");

  client = new Client({ name: "openreaper-alpha32-c3a-live-smoke", version: "0.0.0" });
  const transport = new StdioClientTransport({
    command: options.mcp_command,
    args: [],
    cwd: process.cwd(),
    env: process.env,
  });
  await client.connect(transport);
  toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assertSameArray(toolNames, EXACT_TOOLS, "MCP tool surface");

  const pathCall = parseToolJson(await client.callTool({
    name: "call_template",
    arguments: { id: IDS[0], input: {} },
  }));
  const dirtyCall = parseToolJson(await client.callTool({
    name: "call_template",
    arguments: { id: IDS[1], input: {} },
  }));
  calls = { current_project_path: pathCall, dirty_state: dirtyCall };
  assertSuccessfulRead(pathCall, IDS[0]);
  assertSuccessfulRead(dirtyCall, IDS[1]);
  assertExactSavedPathSummary(pathCall.result?.summary, options.expected_project_path);
  assertDirtySummary(dirtyCall.result?.summary);
  assertProjectRef(pathCall, IDS[0]);
  assertProjectRef(dirtyCall, IDS[1]);
  assertBridgeIdentity(pathCall, preflight.bridge_identity, IDS[0]);
  assertBridgeIdentity(dirtyCall, preflight.bridge_identity, IDS[1]);
  if (
    pathCall.bridge.owner !== dirtyCall.bridge.owner ||
    pathCall.bridge.generation !== dirtyCall.bridge.generation
  ) {
    throw new Error("C3A calls reported different bridge owner/generation identities");
  }
} catch (error) {
  runError = error;
} finally {
  if (client) {
    try {
      await client.close?.();
    } catch (error) {
      runError ??= error;
    }
  }
}

let after = null;
try {
  if (before) {
    after = await captureFilesystemEvidence(options.expected_project_path);
    assertSnapshotComplete(after, "after");
  }
  if (preflight) {
    if (calls) {
      preflight.owned_transport_cleanup = await cleanupOwnedTransportFiles({
        transportDir: preflight.transport_dir,
        expectedIdentity: preflight.bridge_identity,
        calls,
      });
    }
    const finalTransport = await transportState(preflight.transport_dir);
    preflight.transport_final = finalTransport;
    if (finalTransport.requests.length !== 0 || finalTransport.results.length !== 0) {
      throw new Error(`C3A unknown transport residue remained and was preserved: ${JSON.stringify(finalTransport)}`);
    }
  }
  if (before && after) assertExpectedProjectUnchanged(before.expected_project, after.expected_project);
} catch (error) {
  runError ??= error;
}

if (!evidenceRootCreated) failWithoutReport(runError ?? new Error("Evidence root creation failed"));

const report = {
  contract: CONTRACT,
  ok: runError === null,
  spawned_reaper: false,
  started_reaper: false,
  stopped_reaper: false,
  mcp_command: options.mcp_command,
  evidence_root: options.evidence_root,
  evidence_file: reportPath,
  expected_project_path: options.expected_project_path,
  tool_surface: toolNames,
  preflight,
  calls,
  filesystem_evidence: before && after ? composeFilesystemEvidence(before, after) : { before, after },
  error: runError ? boundedError(runError) : null,
};

try {
  const existingEvidenceEntries = await readdir(options.evidence_root);
  if (existingEvidenceEntries.length !== 0) {
    throw new Error(`Evidence root was not report-exclusive before final write: ${JSON.stringify(existingEvidenceEntries)}`);
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  const finalEvidenceEntries = await readdir(options.evidence_root);
  assertSameArray(finalEvidenceEntries.sort(), [REPORT_FILENAME], "Evidence root report exclusivity");
} catch (error) {
  process.stderr.write(`${JSON.stringify({ contract: CONTRACT, ok: false, error: boundedError(error) })}\n`);
  process.exitCode = 1;
}

process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (!report.ok) process.exitCode = 1;

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--mcp-command") result.mcp_command = path.resolve(requiredValue(argv, ++index, arg));
    else if (arg === "--evidence-root") result.evidence_root = path.resolve(requiredValue(argv, ++index, arg));
    else if (arg === "--expected-project-path") result.expected_project_path = requiredValue(argv, ++index, arg);
    else throw new Error(`Unknown option: ${arg}`);
  }
  for (const option of ["mcp_command", "evidence_root", "expected_project_path"]) {
    if (!result[option]) throw new Error(`Missing required option: --${option.replaceAll("_", "-")}`);
  }
  return result;
}

function requiredValue(argv, index, option) {
  const value = argv[index];
  if (!value || value.startsWith("--")) throw new Error(`${option} requires a value`);
  return value;
}

function validateOptionPaths(input) {
  if (!path.isAbsolute(input.expected_project_path)) {
    throw new Error("--expected-project-path must be absolute");
  }
  if (!/\.RPP$/u.test(input.expected_project_path)) {
    throw new Error("--expected-project-path must end with exact .RPP");
  }
  if (!path.isAbsolute(input.evidence_root) || !path.isAbsolute(input.mcp_command)) {
    throw new Error("--mcp-command and --evidence-root must resolve to absolute paths");
  }
}

async function createFreshEvidenceRoot(root) {
  if (await pathExists(root)) throw new Error(`Evidence root must not already exist: ${root}`);
  const parent = path.dirname(root);
  const parentStat = await stat(parent);
  if (!parentStat.isDirectory()) {
    throw new Error(`Evidence root parent must be an existing directory: ${parent}`);
  }
  await mkdir(root, { mode: 0o700 });
}

async function validatePreflight(input) {
  await assertExecutableRegularFile(input.mcp_command, "MCP command");
  await assertRegularFile(input.expected_project_path, "Expected project", { rejectSymlink: true });

  const transportDir = requiredAbsoluteEnv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR");
  const bridgeScript = requiredAbsoluteEnv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH");
  const owner = requiredBoundedIdentityEnv("OPENREAPER_LIVE_BRIDGE_OWNER");
  const generationText = requiredBoundedIdentityEnv("OPENREAPER_LIVE_BRIDGE_GENERATION");
  if (!/^(?:0|[1-9][0-9]*)$/u.test(generationText)) {
    throw new Error("OPENREAPER_LIVE_BRIDGE_GENERATION must be a non-negative decimal integer");
  }
  const generation = Number(generationText);
  if (!Number.isSafeInteger(generation)) {
    throw new Error("OPENREAPER_LIVE_BRIDGE_GENERATION exceeds the safe integer range");
  }

  await assertDirectory(transportDir, "Transport directory", { rejectSymlink: true });
  await assertRegularFile(bridgeScript, "Bridge script", { rejectSymlink: true });
  const initialTransport = await transportState(transportDir, { requireDirectories: true });
  if (initialTransport.requests.length !== 0 || initialTransport.results.length !== 0) {
    throw new Error(`Transport requests/results must be empty before MCP startup: ${JSON.stringify(initialTransport)}`);
  }
  return {
    transport_dir: transportDir,
    bridge_script_path: bridgeScript,
    bridge_identity: { owner, generation },
    transport_initial: initialTransport,
  };
}

function requiredAbsoluteEnv(name) {
  const value = process.env[name];
  if (typeof value !== "string" || value === "" || !path.isAbsolute(value)) {
    throw new Error(`${name} must be an absolute path`);
  }
  return value;
}

function requiredBoundedIdentityEnv(name) {
  const value = process.env[name];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    Buffer.byteLength(value, "utf8") > 256 ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Error(`${name} must be a non-empty bounded identity without control characters`);
  }
  return value;
}

async function transportState(root, { requireDirectories = false } = {}) {
  const requestsDir = path.join(root, "requests");
  const resultsDir = path.join(root, "results");
  if (requireDirectories) {
    await assertDirectory(requestsDir, "Transport requests directory", { rejectSymlink: true });
    await assertDirectory(resultsDir, "Transport results directory", { rejectSymlink: true });
  }
  return {
    requests: await directoryEntryNames(requestsDir),
    results: await directoryEntryNames(resultsDir),
  };
}

async function cleanupOwnedTransportFiles({ transportDir, expectedIdentity, calls }) {
  const rows = [
    {
      label: "current_project_path",
      call: calls.current_project_path,
      operation: { family: "query_state", name: "project.read_current_project_path" },
    },
    {
      label: "dirty_state",
      call: calls.dirty_state,
      operation: { family: "query_state", name: "project.read_dirty_state" },
    },
  ];
  const requestIds = rows.map((row) => strictOwnedRequestId(row.call?.request?.id, row.label));
  if (new Set(requestIds).size !== requestIds.length) {
    throw new Error("C3A calls reused the same transport request id");
  }

  const validated = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const id = requestIds[index];
    const requestPath = ownedTransportPath(transportDir, "requests", id);
    const resultPath = ownedTransportPath(transportDir, "results", id);
    await assertRegularFile(requestPath, `${row.label} owned request`, { rejectSymlink: true });
    await assertRegularFile(resultPath, `${row.label} owned result`, { rejectSymlink: true });
    const request = await readJsonFile(requestPath, `${row.label} owned request`);
    const result = await readJsonFile(resultPath, `${row.label} owned result`);
    if (
      request.contract !== "foundation.bridge.v1" ||
      request.id !== id ||
      request.bridge?.expected_owner !== expectedIdentity.owner ||
      request.bridge?.expected_generation !== expectedIdentity.generation ||
      request.operation?.family !== row.operation.family ||
      request.operation?.name !== row.operation.name
    ) {
      throw new Error(`${row.label} owned request did not match the exact C3A call identity`);
    }
    if (
      result.contract !== "foundation.bridge.v1" ||
      result.id !== id ||
      result.bridge?.owner !== expectedIdentity.owner ||
      result.bridge?.generation !== expectedIdentity.generation
    ) {
      throw new Error(`${row.label} owned result did not match its request contract/id/bridge identity`);
    }
    validated.push({
      label: row.label,
      id,
      request_path: requestPath,
      result_path: resultPath,
      operation: row.operation,
    });
  }

  for (const row of validated) {
    await unlink(row.request_path);
    await unlink(row.result_path);
  }

  // The REAPER defer loop may already have enumerated a request immediately
  // before the first unlink and can publish one late open_failed result for the
  // same owned id. Allow one bounded settle window, validate any such exact
  // owned result, and remove only that result. Unknown files remain untouched.
  await new Promise((resolve) => setTimeout(resolve, 750));
  const lateResultRewrites = [];
  for (const row of validated) {
    if (await pathExists(row.request_path)) {
      throw new Error(`${row.label} owned request unexpectedly reappeared after cleanup`);
    }
    if (!(await pathExists(row.result_path))) continue;
    await assertRegularFile(row.result_path, `${row.label} late owned result`, { rejectSymlink: true });
    const result = await readJsonFile(row.result_path, `${row.label} late owned result`);
    if (
      result.contract !== "foundation.bridge.v1" ||
      result.id !== row.id ||
      result.bridge?.owner !== expectedIdentity.owner ||
      result.bridge?.generation !== expectedIdentity.generation
    ) {
      throw new Error(`${row.label} late owned result did not match its request contract/id/bridge identity`);
    }
    await unlink(row.result_path);
    lateResultRewrites.push({
      label: row.label,
      id: row.id,
      result_path: row.result_path,
      error_code: result.error?.code ?? null,
      error_reason: result.error?.details?.message ?? null,
    });
  }
  await new Promise((resolve) => setTimeout(resolve, 250));
  return {
    policy: "exact_owned_request_result_files_only_with_bounded_late_result_settle",
    removed: validated,
    removed_file_count: validated.length * 2 + lateResultRewrites.length,
    initial_removed_file_count: validated.length * 2,
    late_result_rewrites: lateResultRewrites,
  };
}

function strictOwnedRequestId(value, label) {
  if (typeof value !== "string" || !/^cmd_[A-Za-z0-9_]+$/u.test(value)) {
    throw new Error(`${label} returned an unsafe transport request id`);
  }
  return value;
}

function ownedTransportPath(transportDir, kind, requestId) {
  const filename = `${requestId}.json`;
  if (path.basename(filename) !== filename) throw new Error("Unsafe owned transport basename");
  const directory = path.resolve(transportDir, kind);
  const target = path.resolve(directory, filename);
  if (!target.startsWith(`${directory}${path.sep}`)) {
    throw new Error("Owned transport path escaped its request/result directory");
  }
  return target;
}

async function readJsonFile(file, label) {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`${label} was not valid JSON: ${String(error?.message ?? error)}`);
  }
}

async function captureFilesystemEvidence(expectedProjectPath) {
  const projectDir = path.dirname(expectedProjectPath);
  const backupsDir = path.join(projectDir, "Backups");
  const dsStorePath = path.join(projectDir, ".DS_Store");
  return {
    captured_at: new Date().toISOString(),
    expected_project: await projectFileEvidence(expectedProjectPath),
    project_dir: await directorySnapshot(projectDir),
    backups: await directorySnapshot(backupsDir),
    ds_store: await pathMetadata(dsStorePath),
  };
}

async function projectFileEvidence(file) {
  const metadata = await pathMetadata(file);
  if (!metadata.exists || metadata.type !== "file") throw new Error(`Expected project is not a regular file: ${file}`);
  return {
    path: file,
    sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
    size: metadata.size,
    mtime_ns: metadata.mtime_ns,
  };
}

async function directorySnapshot(dir) {
  const metadata = await pathMetadata(dir);
  if (!metadata.exists) return { path: dir, exists: false, entries: [], truncated: false };
  if (metadata.type !== "directory") return { path: dir, ...metadata, entries: [], truncated: false };
  const names = await readdir(dir);
  names.sort();
  const selected = names.slice(0, MAX_SNAPSHOT_ENTRIES);
  const entries = [];
  for (const name of selected) {
    entries.push({ name, ...(await pathMetadata(path.join(dir, name))) });
  }
  return {
    path: dir,
    exists: true,
    type: "directory",
    entries,
    truncated: names.length > selected.length,
    omitted_entries: names.length - selected.length,
  };
}

async function pathMetadata(target) {
  try {
    const value = await lstat(target, { bigint: true });
    return {
      exists: true,
      type: value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "directory" : value.isFile() ? "file" : "other",
      size: value.size.toString(),
      mtime_ns: value.mtimeNs.toString(),
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

function assertSnapshotComplete(value, phase) {
  for (const [name, snapshot] of [["project_dir", value.project_dir], ["backups", value.backups]]) {
    if (snapshot?.truncated) {
      throw new Error(`${phase} ${name} snapshot exceeded ${MAX_SNAPSHOT_ENTRIES} entries; evidence would be incomplete`);
    }
  }
}

function composeFilesystemEvidence(beforeValue, afterValue) {
  return {
    expected_project: {
      before: beforeValue.expected_project,
      after: afterValue.expected_project,
      unchanged: sameProjectEvidence(beforeValue.expected_project, afterValue.expected_project),
    },
    project_dir: {
      before: beforeValue.project_dir,
      after: afterValue.project_dir,
      side_effects: snapshotDelta(beforeValue.project_dir, afterValue.project_dir),
    },
    backups: {
      before: beforeValue.backups,
      after: afterValue.backups,
      new_backup_entries: addedEntryNames(beforeValue.backups, afterValue.backups),
      side_effects: snapshotDelta(beforeValue.backups, afterValue.backups),
    },
    ds_store: {
      before: beforeValue.ds_store,
      after: afterValue.ds_store,
      changed: JSON.stringify(beforeValue.ds_store) !== JSON.stringify(afterValue.ds_store),
    },
  };
}

function snapshotDelta(beforeSnapshot, afterSnapshot) {
  const beforeMap = new Map((beforeSnapshot.entries ?? []).map((entry) => [entry.name, entry]));
  const afterMap = new Map((afterSnapshot.entries ?? []).map((entry) => [entry.name, entry]));
  const names = [...new Set([...beforeMap.keys(), ...afterMap.keys()])].sort();
  return names
    .filter((name) => JSON.stringify(beforeMap.get(name) ?? null) !== JSON.stringify(afterMap.get(name) ?? null))
    .map((name) => ({ name, before: beforeMap.get(name) ?? null, after: afterMap.get(name) ?? null }));
}

function addedEntryNames(beforeSnapshot, afterSnapshot) {
  const beforeNames = new Set((beforeSnapshot.entries ?? []).map((entry) => entry.name));
  return (afterSnapshot.entries ?? []).map((entry) => entry.name).filter((name) => !beforeNames.has(name));
}

function assertExpectedProjectUnchanged(beforeProject, afterProject) {
  if (!sameProjectEvidence(beforeProject, afterProject)) {
    throw new Error(`Expected RPP changed during C3A read smoke: ${JSON.stringify({ before: beforeProject, after: afterProject })}`);
  }
}

function sameProjectEvidence(left, right) {
  return left.sha256 === right.sha256 && left.mtime_ns === right.mtime_ns && left.size === right.size;
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP tool response did not contain JSON text");
  return JSON.parse(text);
}

function assertSuccessfulRead(result, id) {
  if (result.ok !== true || result.template?.id !== id || result.template?.risk !== "read") {
    throw new Error(`${id} did not return a successful read template result`);
  }
  if (
    result.undo?.mode !== "none" ||
    (result.result?.artifacts?.length ?? 0) !== 0 ||
    (result.result?.jobs?.length ?? 0) !== 0
  ) {
    throw new Error(`${id} violated the no-undo/no-artifact/no-job C3A boundary`);
  }
}

function assertExactSavedPathSummary(summary, expectedPath) {
  if (
    !summary ||
    summary.project_ref !== "project:current" ||
    typeof summary.name !== "string" ||
    summary.path !== expectedPath ||
    summary.has_project_path !== true ||
    summary.path_state !== "saved_project" ||
    summary.path_truncated !== false
  ) {
    throw new Error(`C3A path summary did not prove the exact expected saved project: ${JSON.stringify(summary)}`);
  }
}

function assertDirtySummary(summary) {
  if (
    !summary ||
    summary.project_ref !== "project:current" ||
    !Number.isSafeInteger(summary.raw_dirty_state) ||
    summary.raw_dirty_state < 0
  ) {
    throw new Error("C3A dirty-state summary shape is invalid");
  }
  const expectedDirty = summary.raw_dirty_state > 0;
  if (summary.dirty !== expectedDirty || summary.dirty_state !== (expectedDirty ? "dirty" : "clean")) {
    throw new Error("C3A dirty-state projection disagrees with raw_dirty_state");
  }
}

function assertProjectRef(result, id) {
  const ref = result.result?.refs?.find((entry) => entry?.ref === "project:current");
  if (
    ref?.kind !== "project" ||
    ref?.identity?.scheme !== "current" ||
    ref?.identity?.value !== "current"
  ) {
    throw new Error(`${id} did not return the canonical project:current object ref`);
  }
}

function assertBridgeIdentity(result, expected, id) {
  if (result.bridge?.owner !== expected.owner || result.bridge?.generation !== expected.generation) {
    throw new Error(`${id} bridge identity did not match the strict environment identity`);
  }
}

async function assertExecutableRegularFile(target, label) {
  await assertRegularFile(target, label, { rejectSymlink: true });
  await access(target, fsConstants.X_OK);
}

async function assertRegularFile(target, label, { rejectSymlink = false } = {}) {
  const value = await lstat(target);
  if (!value.isFile() || (rejectSymlink && value.isSymbolicLink())) {
    throw new Error(`${label} must be an existing non-symlink regular file: ${target}`);
  }
}

async function assertDirectory(target, label, { rejectSymlink = false } = {}) {
  const value = await lstat(target);
  if (!value.isDirectory() || (rejectSymlink && value.isSymbolicLink())) {
    throw new Error(`${label} must be an existing non-symlink directory: ${target}`);
  }
}

async function directoryEntryNames(dir) {
  const names = await readdir(dir);
  return names.sort();
}

async function pathExists(target) {
  try {
    await lstat(target);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

function assertSameArray(actual, expected, label) {
  if (actual.length !== expected.length || actual.some((value, index) => value !== expected[index])) {
    throw new Error(`${label} mismatch: ${JSON.stringify(actual)}`);
  }
}

function boundedError(error) {
  return {
    name: String(error?.name ?? "Error").slice(0, 80),
    message: String(error?.message ?? error).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 1_024),
    code: typeof error?.code === "string" ? error.code.slice(0, 80) : null,
  };
}

function failWithoutReport(error) {
  process.stderr.write(`${JSON.stringify({ contract: CONTRACT, ok: false, error: boundedError(error) })}\n`);
  process.exit(2);
}
