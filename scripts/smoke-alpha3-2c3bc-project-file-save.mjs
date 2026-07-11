#!/usr/bin/env node

import { createHash } from "node:crypto";
import { access, lstat, mkdir, readFile, readdir, realpath, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONTRACT = "alpha3.2.c3bc.project_file_save.v1";
const REPORT_FILENAME = "alpha3-2c3bc-project-file-save.json";
const IDS = {
  readPath: "template.project.read_current_project_path",
  readDirty: "template.project.read_dirty_state",
  saveCurrent: "template.project.save_current_project",
  saveAs: "template.project.save_project_as",
};
const EXACT_TOOLS = ["call_template", "get_state", "list_recipes", "list_templates", "ping"];
const LATE_SETTLE_ATTEMPTS = 8;
const LATE_SETTLE_MS = 250;
const MCP_CLOSE_DELAYED_AUDIT_MS = 1000;
const MAX_INVENTORY_ENTRIES = 2000;

let options;
try {
  options = parseArgs(process.argv.slice(2));
  validateAbsoluteOptions(options);
} catch (error) {
  failWithoutReport(error);
}

const reportPath = path.join(options.evidence_root, REPORT_FILENAME);
let client = null;
let preflight = null;
let before = null;
let after = null;
let calls = {};
let toolNames = null;
let runError = null;
let evidenceRootCreated = false;
let processPosture = {
  external_control_tower_owns_reaper_start_stop: true,
  runner_started_reaper: false,
  runner_stopped_reaper: false,
  expected_owner_marker: options.expected_owner_marker,
  candidate_mcp_close: null,
  external_reaper_exit_audit: {
    responsibility: "external_control_tower",
    required_after_runner: true,
    expected_methods: ["pgrep/process audit", "REAPER UI exit confirmation"],
    runner_limitation: "The MCP stdio SDK does not expose a stable child PID contract to this runner; client.close resolution and delayed transport settle are recorded instead.",
  },
};

try {
  await createFreshEvidenceRoot(options.evidence_root);
  evidenceRootCreated = true;
  preflight = await validatePreflight(options);
  before = await captureEvidence(options);
  assertInventoryComplete(before, "before");

  client = new Client({ name: "openreaper-alpha32-c3bc-live-smoke", version: "0.0.0" });
  await client.connect(new StdioClientTransport({ command: options.mcp_command, args: [], cwd: process.cwd(), env: process.env }));
  toolNames = (await client.listTools()).tools.map((tool) => tool.name).sort();
  assertSameArray(toolNames, EXACT_TOOLS, "MCP tool surface");

  const initialPath = calls.initial_path = await call(IDS.readPath, {});
  const initialDirty = calls.initial_dirty = await call(IDS.readDirty, {});
  assertSuccessful(initialPath, IDS.readPath, "read");
  assertSuccessful(initialDirty, IDS.readDirty, "read");
  assertPath(initialPath, options.expected_project_path, "initial current project");

  const saveCurrent = calls.save_current = await call(IDS.saveCurrent, {});
  assertSuccessful(saveCurrent, IDS.saveCurrent, "write");
  assertSaveCurrentSummary(saveCurrent.result?.summary, options.expected_project_path);

  const saveAs = calls.save_as = await call(IDS.saveAs, { target_path: options.save_as_target, overwrite: true });
  assertSuccessful(saveAs, IDS.saveAs, "write");
  assertSaveAsSummary(saveAs.result?.summary, options.save_as_target, true);

  const finalPath = calls.final_path = await call(IDS.readPath, {});
  const finalDirty = calls.final_dirty = await call(IDS.readDirty, {});
  assertSuccessful(finalPath, IDS.readPath, "read");
  assertSuccessful(finalDirty, IDS.readDirty, "read");
  assertPath(finalPath, options.save_as_target, "final current project");
  if (finalDirty.result?.summary?.dirty !== false || finalDirty.result?.summary?.raw_dirty_state !== 0) {
    throw new Error("Final dirty-state readback was not clean/raw 0");
  }
  for (const [name, result] of Object.entries(calls)) assertBridgeIdentity(result, preflight.bridge_identity, name);
} catch (error) {
  runError = error;
} finally {
  if (client) {
    const closeStartedAt = new Date().toISOString();
    let closeResolved = false;
    let closeError = null;
    try {
      await client.close?.();
      closeResolved = true;
    } catch (error) {
      closeError = boundedError(error);
      runError ??= error;
    }
    const closeCompletedAt = new Date().toISOString();
    const immediateTransportState = preflight
      ? await transportState(preflight.transport_dir).catch((error) => ({ audit_error: boundedError(error) }))
      : null;
    await new Promise((resolve) => setTimeout(resolve, MCP_CLOSE_DELAYED_AUDIT_MS));
    const delayedTransportState = preflight
      ? await transportState(preflight.transport_dir).catch((error) => ({ audit_error: boundedError(error) }))
      : null;
    processPosture.candidate_mcp_close = {
      audit_method: "await MCP Client.close(), capture immediate transport state, then capture delayed transport state",
      sdk_child_pid_exposed: false,
      close_started_at: closeStartedAt,
      close_completed_at: closeCompletedAt,
      immediate: { client_close_resolved: closeResolved, error: closeError, observed_at: new Date().toISOString(), transport_state: immediateTransportState },
      delayed: { delay_ms: MCP_CLOSE_DELAYED_AUDIT_MS, observed_at: new Date().toISOString(), transport_state: delayedTransportState },
      external_process_exit_confirmation_required: true,
    };
  }
}

try {
  after = await captureEvidence(options);
  assertInventoryComplete(after, "after");
  if (preflight && Object.keys(calls).length > 0) {
    preflight.owned_transport_cleanup = await cleanupOwnedTransportFiles({
      transportDir: preflight.transport_dir,
      requestIds: Object.values(calls).map((result) => result.request?.id).filter(Boolean),
    });
  }
  if (preflight) {
    preflight.transport_final = await transportState(preflight.transport_dir);
    if (processPosture.candidate_mcp_close?.delayed) {
      processPosture.candidate_mcp_close.post_cleanup_transport_state = preflight.transport_final;
    }
    if (preflight.transport_final.requests.length !== 0 || preflight.transport_final.results.length !== 0) {
      throw new Error(`C3BC unknown transport residue remained and was preserved: ${JSON.stringify(preflight.transport_final)}`);
    }
  }
  if (after?.save_as_target?.type !== "file") throw new Error("save_project_as target was not created as a regular file");
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
  save_as_target: options.save_as_target,
  overwrite: true,
  overwrite_authorization: "explicit_true_for_preflight_to_reaper_dispatch_race",
  atomic_overwrite_false: "held_future",
  tool_surface: toolNames,
  preflight,
  calls,
  project_changes: { before, after },
  rendered_files: [],
  process_posture: processPosture,
  control_tower_handoff: {
    external_control_tower_owns_reaper_start_stop: true,
    external_reaper_exit_audit_required: true,
    candidate_mcp_exit_audit_requires_external_process_confirmation: true,
  },
  recovery_backup_posture: {
    source_project_preserved_on_disk: before?.expected_project?.exists === true && after?.expected_project?.exists === true,
    save_as_target_preserved_for_review: after?.save_as_target?.type === "file",
    cleanup_scope: "owned transport request/result files only; no project or media files deleted",
  },
  error: runError ? boundedError(runError) : null,
};

try {
  const entries = await readdir(options.evidence_root);
  if (entries.length !== 0) throw new Error(`Evidence root was not report-exclusive: ${JSON.stringify(entries)}`);
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  assertSameArray((await readdir(options.evidence_root)).sort(), [REPORT_FILENAME], "evidence root final contents");
} catch (error) {
  failWithoutReport(error);
}
if (runError) {
  process.stderr.write(`[OpenReaper C3BC] FAIL ${runError.message}\n`);
  process.exit(1);
}
process.stdout.write(`${JSON.stringify({ ok: true, contract: CONTRACT, evidence_file: reportPath })}\n`);

async function call(id, input) {
  return parseToolJson(await client.callTool({ name: "call_template", arguments: { id, input } }));
}

function parseArgs(argv) {
  const value = { overwrite: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--overwrite") { value.overwrite = true; continue; }
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) throw new Error(`Missing value for ${arg}`);
    if (arg === "--evidence-root") value.evidence_root = next;
    else if (arg === "--mcp-command") value.mcp_command = next;
    else if (arg === "--expected-project-path") value.expected_project_path = next;
    else if (arg === "--save-as-target") value.save_as_target = next;
    else if (arg === "--expected-owner-marker") value.expected_owner_marker = next;
    else throw new Error(`Unknown option: ${arg}`);
    index += 1;
  }
  for (const key of ["evidence_root", "mcp_command", "expected_project_path", "save_as_target", "expected_owner_marker"]) {
    if (typeof value[key] !== "string" || value[key] === "") throw new Error(`Missing required --${key.replaceAll("_", "-")}`);
  }
  return value;
}

function validateAbsoluteOptions(value) {
  for (const key of ["evidence_root", "mcp_command", "expected_project_path", "save_as_target"]) {
    if (!path.isAbsolute(value[key])) throw new Error(`${key} must be absolute`);
  }
  if (path.extname(value.expected_project_path).toLowerCase() !== ".rpp" || path.extname(value.save_as_target).toLowerCase() !== ".rpp") {
    throw new Error("expected project and save-as target must use .RPP extension");
  }
  if (value.expected_project_path === value.save_as_target) throw new Error("save-as target must differ from the current project path");
  if (value.overwrite !== true) throw new Error("Combined live requires --overwrite: explicit overwrite=true authorizes the preflight-to-REAPER dispatch race; atomic overwrite=false is held future");
}

async function createFreshEvidenceRoot(root) {
  try { await mkdir(root, { recursive: false }); }
  catch (error) { throw new Error(`Evidence root must be fresh and absent: ${root} (${error.code ?? error.message})`); }
}

async function validatePreflight(value) {
  await access(value.mcp_command);
  const transportDir = process.env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR;
  if (!transportDir || !path.isAbsolute(transportDir)) throw new Error("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR must be an explicit absolute fresh transport");
  const transport = await transportState(transportDir);
  if (transport.requests.length !== 0 || transport.results.length !== 0) throw new Error(`Transport must be fresh/empty: ${JSON.stringify(transport)}`);
  const heartbeatPath = path.join(transportDir, "openreaper-bridge-liveness-v1.json");
  const heartbeat = JSON.parse(await readFile(heartbeatPath, "utf8"));
  const bridgeIdentity = { owner: heartbeat.active_owner, generation: heartbeat.active_generation };
  if (typeof bridgeIdentity.owner !== "string" || !Number.isInteger(bridgeIdentity.generation)) throw new Error("Bridge heartbeat identity is invalid");
  if (bridgeIdentity.owner !== value.expected_owner_marker) throw new Error(`Bridge owner did not match --expected-owner-marker: ${JSON.stringify({ expected: value.expected_owner_marker, actual: bridgeIdentity.owner })}`);
  const expectedStat = await stat(value.expected_project_path);
  if (!expectedStat.isFile()) throw new Error("Expected current project path is not a regular file");
  const targetParent = await realpath(path.dirname(value.save_as_target));
  if (targetParent !== path.dirname(value.save_as_target)) throw new Error("save-as target parent must already be canonical and symlink-free");
  const targetBefore = await pathMetadata(value.save_as_target);
  if (targetBefore.exists && targetBefore.type !== "file") throw new Error("existing save-as target must be a regular file");
  return {
    transport_dir: transportDir,
    transport_initial: transport,
    bridge_identity: bridgeIdentity,
    expected_owner_marker: value.expected_owner_marker,
    heartbeat_path: heartbeatPath,
    target_before: targetBefore,
    overwrite_authorization: "explicit_true_for_preflight_to_reaper_dispatch_race",
    atomic_overwrite_false: "held_future",
  };
}

async function captureEvidence(value) {
  const sourceDir = path.dirname(value.expected_project_path);
  const targetDir = path.dirname(value.save_as_target);
  return {
    captured_at: new Date().toISOString(),
    expected_project: await projectMetadata(value.expected_project_path),
    save_as_target: await projectMetadata(value.save_as_target),
    project_parent_inventory: {
      scope: "bounded full immediate child inventory of each project parent; includes sibling .rpp-bak and backup-like files",
      source: await directoryInventory(sourceDir),
      target: await directoryInventory(targetDir),
    },
    adjacent_backups_subdirectory_inventory: {
      scope: "bounded immediate child inventory of the conventional Backups subdirectory adjacent to each project",
      source: await directoryInventory(path.join(sourceDir, "Backups")),
      target: await directoryInventory(path.join(targetDir, "Backups")),
    },
    ds_store: {
      source_directory: await fileMetadataWithHash(path.join(sourceDir, ".DS_Store")),
      target_directory: await fileMetadataWithHash(path.join(targetDir, ".DS_Store")),
    },
  };
}

async function directoryInventory(directory) {
  const metadata = await pathMetadata(directory);
  if (!metadata.exists) return { path: directory, exists: false, entries: [], truncated: false };
  if (metadata.type !== "directory") return { path: directory, ...metadata, entries: [], truncated: false };
  const names = (await readdir(directory)).sort();
  const selected = names.slice(0, MAX_INVENTORY_ENTRIES);
  const entries = [];
  for (const name of selected) entries.push({ name, ...(await pathMetadata(path.join(directory, name))) });
  return { path: directory, exists: true, type: "directory", entries, truncated: names.length > selected.length, omitted_entries: names.length - selected.length };
}

function assertInventoryComplete(evidence, phase) {
  for (const [scopeName, inventories] of [
    ["project parent inventory", evidence.project_parent_inventory],
    ["adjacent Backups subdirectory inventory", evidence.adjacent_backups_subdirectory_inventory],
  ]) {
    for (const [owner, inventory] of Object.entries(inventories ?? {}).filter(([key]) => key !== "scope")) {
      if (inventory?.truncated) {
        throw new Error(`${phase} ${owner} ${scopeName} exceeded ${MAX_INVENTORY_ENTRIES} entries; evidence would be incomplete`);
      }
    }
  }
}

async function fileMetadataWithHash(file) {
  const metadata = await pathMetadata(file);
  if (!metadata.exists) return { path: file, exists: false };
  if (metadata.type !== "file") return { path: file, ...metadata, sha256: null };
  return { path: file, ...metadata, sha256: createHash("sha256").update(await readFile(file)).digest("hex") };
}

async function projectMetadata(file) {
  const metadata = await pathMetadata(file);
  if (!metadata.exists || metadata.type !== "file") return { path: file, ...metadata };
  return { path: file, ...metadata, sha256: createHash("sha256").update(await readFile(file)).digest("hex") };
}

async function pathMetadata(target) {
  try {
    const value = await lstat(target, { bigint: true });
    return { exists: true, type: value.isSymbolicLink() ? "symlink" : value.isDirectory() ? "directory" : value.isFile() ? "file" : "other", size: value.size.toString(), mtime_ns: value.mtimeNs.toString() };
  } catch (error) {
    if (error?.code === "ENOENT") return { exists: false };
    throw error;
  }
}

async function transportState(transportDir) {
  return {
    requests: (await readdir(path.join(transportDir, "requests"))).sort(),
    results: (await readdir(path.join(transportDir, "results"))).sort(),
  };
}

async function cleanupOwnedTransportFiles({ transportDir, requestIds }) {
  const owned = new Set(requestIds.map((id) => `${id}.json`));
  const removed = [];
  for (let attempt = 0; attempt < LATE_SETTLE_ATTEMPTS; attempt += 1) {
    for (const directory of ["requests", "results"]) {
      const dir = path.join(transportDir, directory);
      for (const file of await readdir(dir)) {
        if (!owned.has(file)) continue;
        await unlink(path.join(dir, file)).catch((error) => { if (error?.code !== "ENOENT") throw error; });
        removed.push(`${directory}/${file}`);
      }
    }
    await new Promise((resolve) => setTimeout(resolve, LATE_SETTLE_MS));
  }
  return { request_ids: [...requestIds], removed: [...new Set(removed)].sort(), late_settle_attempts: LATE_SETTLE_ATTEMPTS, late_settle_ms: LATE_SETTLE_MS };
}

function assertSuccessful(result, id, risk) {
  if (result.ok !== true || result.template?.id !== id || result.template?.risk !== risk) throw new Error(`${id} did not return a successful ${risk} result`);
  if (risk === "write" && (result.undo?.mode !== "required" || result.verification?.status !== "passed")) throw new Error(`${id} lacked required undo/verification evidence`);
  assertProjectRef(result, id);
}

function assertProjectRef(result, label) {
  const ref = result.result?.refs?.find((entry) => entry?.ref === "project:current");
  if (ref?.kind !== "project" || ref?.identity?.scheme !== "current" || ref?.identity?.value !== "current") throw new Error(`${label} lacked canonical project:current ref`);
}

function assertPath(result, expected, label) {
  if (result.result?.summary?.path !== expected || result.result?.summary?.path_state !== "saved_project") throw new Error(`${label} path mismatch`);
}

function assertSaveCurrentSummary(summary, expectedPath) {
  if (summary?.before_path !== expectedPath || summary?.after_path !== expectedPath || summary?.path_unchanged !== true || summary?.after_dirty !== false || summary?.after_raw_dirty_state !== 0) {
    throw new Error("save_current_project exact readback mismatch");
  }
}

function assertSaveAsSummary(summary, target, overwrite) {
  if (summary?.target_path !== target || summary?.after_path !== target || summary?.overwrite !== overwrite || summary?.path_matches_target !== true || summary?.after_dirty !== false || summary?.after_raw_dirty_state !== 0) {
    throw new Error("save_project_as exact readback mismatch");
  }
}

function assertBridgeIdentity(result, expected, label) {
  if (result.bridge?.owner !== expected.owner || result.bridge?.generation !== expected.generation) throw new Error(`${label} bridge owner/generation mismatch`);
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP tool response did not contain JSON text");
  return JSON.parse(text);
}

function assertSameArray(actual, expected, label) {
  assertJson(actual, expected, label);
}
function assertJson(actual, expected, label) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error(`${label} mismatch: ${JSON.stringify({ actual, expected })}`);
}
function boundedError(error) {
  return { name: String(error?.name ?? "Error").slice(0, 80), message: String(error?.message ?? error).slice(0, 1200), code: error?.code ?? null };
}
function failWithoutReport(error) {
  process.stderr.write(`[OpenReaper C3BC] ${error?.stack ?? error}\n`);
  process.exit(1);
}
