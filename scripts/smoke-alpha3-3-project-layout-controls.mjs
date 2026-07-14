#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const COPY_PROJECT = path.join(options.evidence_root, "fixture", "Alpha33-Project-Layout-Controls.RPP");
const BACKUP_PROJECT = path.join(options.evidence_root, "recovery", "Source-before.RPP");
const REPORT = path.join(options.evidence_root, "reports", "alpha3-3-project-layout-controls-live.json");
const ARTIFACT_ROOT = options.artifact_root ?? path.join(options.evidence_root, "session", "artifacts");
const RUN_TOKEN = path.basename(options.evidence_root).replace(/[^A-Za-z0-9]/gu, "_").slice(-24);
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };

await Promise.all([mkdir(path.dirname(COPY_PROJECT), { recursive: true }), mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }), mkdir(path.dirname(REPORT), { recursive: true }), mkdir(ARTIFACT_ROOT, { recursive: true }), mkdir(path.join(options.evidence_root, "project-index-state"), { recursive: true })]);
await copyFile(options.source_project, BACKUP_PROJECT);
const before = { source_sha256: await sha256(options.source_project), backup_sha256: await sha256(BACKUP_PROJECT) };
const calls = {};
let client;
let error = null;

try {
  client = await connect(options.source_project, "alpha33-project-layout-controls-bootstrap");
  calls.current_path_before = await callTemplate("template.project.read_current_project_path", {});
  assertTemplate(calls.current_path_before, "read current project path");
  assert(calls.current_path_before.result?.summary?.path === options.source_project, `REAPER current project is ${calls.current_path_before.result?.summary?.path}, expected ${options.source_project}`);
  calls.save_as = await callTemplate("macro.project.file", { operation: "save_as", target_path: COPY_PROJECT, overwrite: true, dry_run: false });
  assertMacro(calls.save_as, "save_as");
  await client.close();
  client = await connect(COPY_PROJECT, "alpha33-project-layout-controls-live");

  const annotationInput = { annotations: [{ id: "alpha33_marker", kind: "marker", name: `Alpha33 Marker ${RUN_TOKEN}`, position_seconds: 2 }, { id: "alpha33_region", kind: "region", name: `Alpha33 Region ${RUN_TOKEN}`, start_seconds: 4, end_seconds: 7 }] };
  calls.annotations_preview = await callTemplate("macro.project.apply_layout", annotationInput);
  assertMacro(calls.annotations_preview, "annotation preview");
  assert(calls.annotations_preview.execution.status === "dry_run_completed" && calls.annotations_preview.result.changes.every((row) => row.mutation.status === "not_run"), "Annotation preview reported mutation");
  calls.annotations = await callTemplate("macro.project.apply_layout", { ...annotationInput, dry_run: false });
  assertRows(calls.annotations, "annotations", 2);
  assert(calls.annotations.result.changes.every((row) => row.live_readback.source === "live_marker_region_readback"), "Annotation rows did not use exact live inventory readback");

  const controlInput = { target_kind: "project", fields: { grid_division: "1/8", grid_swing: 0.2, snap_enabled: true }, dry_run: true };
  calls.controls_preview = await callTemplate("macro.controls.set", controlInput);
  assertMacro(calls.controls_preview, "controls preview");
  assert(calls.controls_preview.execution.status === "dry_run_completed" && calls.controls_preview.result.changes.every((row) => row.mutation.status === "not_run"), "Project control preview reported mutation");
  calls.controls = await callTemplate("macro.controls.set", { ...controlInput, dry_run: false });
  assertRows(calls.controls, "project controls", 2);
  const observed = Object.fromEntries(calls.controls.result.changes.flatMap((row) => row.live_readback.fields.map((field) => [field.field, field.observed_value])));
  assert(observed.grid_division === "1/8" && Math.abs(observed.grid_swing - 0.2) < 1e-9 && observed.snap_enabled === true, `Project control live values mismatched: ${JSON.stringify(observed)}`);
  calls.save = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacro(calls.save, "save current");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally { await client?.close().catch(() => {}); }

const after = { source_sha256: await sha256(options.source_project), evidence_copy_sha256: await sha256(COPY_PROJECT).catch(() => null), evidence_copy_size: await stat(COPY_PROJECT).then((value) => value.size).catch(() => null) };
const report = {
  contract: "alpha3.3.project_layout_controls.live_evidence.v1", ok: error === null, generated_at: new Date().toISOString(), evidence_root: options.evidence_root,
  source_project: options.source_project, evidence_project: COPY_PROJECT, transport_dir: options.transport_dir, artifact_root: ARTIFACT_ROOT, bridge: { owner: options.bridge_owner, generation: options.bridge_generation }, public_budget: PUBLIC_BUDGET,
  before, after, source_unchanged: before.source_sha256 === after.source_sha256 && before.backup_sha256 === after.source_sha256,
  tests: { current_path_before: outcome(calls.current_path_before), annotations_preview: outcome(calls.annotations_preview), annotations: outcome(calls.annotations), controls_preview: outcome(calls.controls_preview), controls: outcome(calls.controls) },
  project_changes: { marker_created: calls.annotations?.result?.changes?.some((row) => row.target_kind === "marker" && row.status === "applied") ?? false, region_created: calls.annotations?.result?.changes?.some((row) => row.target_kind === "region" && row.status === "applied") ?? false, project_grid_and_snap_changed: calls.controls?.ok === true, saved_to_evidence_copy: calls.save?.ok === true },
  rendered_files: [], source_media_deleted: false, recovery: { backup_project: BACKUP_PROJECT, source_unchanged: before.source_sha256 === after.source_sha256 }, calls, error,
};
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: REPORT, error }, null, 2)}\n`);
if (error) process.exit(1);

async function connect(project, logicalSessionKey) {
  const next = new Client({ name: "alpha33-project-layout-controls-live", version: "1.0.0" });
  await next.connect(new StdioClientTransport({ command: process.execPath, args: [STDIO], cwd: REPO, env: { ...process.env, OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir, OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(REPO, "reaper/bridge/openreaper-live-bridge.lua"), OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "300000", OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner, OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation), OPENREAPER_LIVE_BRIDGE_SESSION_ID: logicalSessionKey, OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT, OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT, OPENREAPER_CURRENT_PROJECT_PATH: project, OPENREAPER_PROJECT_INDEX_STATE_ROOT: path.join(options.evidence_root, "project-index-state"), OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: logicalSessionKey } }));
  return next;
}
async function callTemplate(id, input) { const response = await client.callTool({ name: "call_template", arguments: { id, input, budget: PUBLIC_BUDGET } }, undefined, { timeout: 300_000, maxTotalTimeout: 600_000 }); return JSON.parse(response.content.find((row) => row.type === "text").text); }
function assertMacro(value, label) { assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`); assert(["completed", "dry_run_completed"].includes(value.execution?.status), `${label} status=${value.execution?.status}`); assert(value.result?.verification?.status === "passed", `${label} verification did not pass`); }
function assertTemplate(value, label) { assert(value?.contract === "template.execution.v1", `${label} returned ${value?.contract}`); assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error)}`); assert(value.verification?.status === "passed" || value.result?.verification?.status === "passed", `${label} verification did not pass`); }
function assertRows(value, label, count) { assertMacro(value, label); assert(value.result.changes.length === count, `${label} returned ${value.result.changes.length} rows`); assert(value.result.changes.every((row) => row.status === "applied" && row.mutation?.status === "completed" && row.live_readback?.status === "passed" && ["completed", "skipped"].includes(row.index_maintenance?.status)), `${label} row truth failed`); }
function outcome(value) { return value ? { ok: value.ok, status: value.execution?.status ?? null, verification: value.result?.verification?.status ?? null, changes: value.result?.changes ?? [], blockers: value.blockers ?? [] } : null; }
function parseArgs(argv) { const result = { bridge_owner: "openreaper-alpha3-local", bridge_generation: 1 }; for (let index = 0; index < argv.length; index += 2) { const key = argv[index]; const value = argv[index + 1]; if (!value) throw new Error(`Missing ${key}`); if (key === "--evidence-root") result.evidence_root = path.resolve(value); else if (key === "--source-project") result.source_project = path.resolve(value); else if (key === "--transport-dir") result.transport_dir = path.resolve(value); else if (key === "--artifact-root") result.artifact_root = path.resolve(value); else if (key === "--bridge-owner") result.bridge_owner = value; else if (key === "--bridge-generation") result.bridge_generation = Number(value); else throw new Error(`Unknown option ${key}`); } if (!result.evidence_root || !result.source_project || !result.transport_dir || !Number.isInteger(result.bridge_generation)) throw new Error("Usage: smoke-alpha3-3-project-layout-controls.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> [--artifact-root <bridge-artifact-root>] [--bridge-owner owner] [--bridge-generation n]"); return result; }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
