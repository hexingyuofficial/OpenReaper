#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const ROOT = options.evidence_root;
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const COPY_PROJECT = path.join(ROOT, "fixture", "Alpha33-Render-Basename.RPP");
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Source-before.RPP");
const REPORT_PATH = path.join(ROOT, "reports", "alpha3-3-render-basename-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const RENDER_ROOT = path.join(ROOT, "renders");
const ARTIFACT_ROOT = options.artifact_root ?? path.join(ROOT, "artifacts");
const INDEX_ROOT = path.join(ROOT, "project-index-state");
const OUTPUT_BASENAME = "Alpha33_User_Named_Mix";
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };

await Promise.all([
  mkdir(path.dirname(COPY_PROJECT), { recursive: true }),
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.dirname(REPORT_PATH), { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
]);
await copyFile(options.source_project, BACKUP_PROJECT);
const before = { source_sha256: await sha256(options.source_project), backup_sha256: await sha256(BACKUP_PROJECT) };
const calls = {};
let client;
let error = null;

try {
  client = await connect(options.source_project, "alpha33-render-basename-bootstrap");
  calls.menu = await client.callTool({ name: "list_templates", arguments: {} });
  assert(content(calls.menu).items.filter((row) => row.action_kind === "macro").length === 15, "Expected fifteen visible Macros");
  calls.current_path_before = await callTemplate("template.project.read_current_project_path", {});
  assertTemplateSuccess(calls.current_path_before, "read current project path");
  assert(calls.current_path_before.result?.summary?.path === options.source_project, `REAPER current project is ${calls.current_path_before.result?.summary?.path}, expected ${options.source_project}`);
  calls.save_as = await callTemplate("macro.project.file", { operation: "save_as", target_path: COPY_PROJECT, overwrite: true, dry_run: false });
  assertMacroSuccess(calls.save_as, "save_as");
  await client.close();

  client = await connect(COPY_PROJECT, "alpha33-render-basename-live");
  calls.preview = await callTemplate("macro.render.targets", { target_kind: "whole_project", format: "wav", output_basename: OUTPUT_BASENAME, dry_run: true });
  assertMacroSuccess(calls.preview, "render preview");
  assert(calls.preview.execution.status === "dry_run_completed", "Render preview did not stay mutation-free");
  assert(calls.preview.result.data.preview.render_settings.output_basename === OUTPUT_BASENAME, "Preview lost the requested basename");
  calls.render = await callTemplate("macro.render.targets", { target_kind: "whole_project", format: "wav", output_basename: OUTPUT_BASENAME, dry_run: false });
  assertMacroSuccess(calls.render, "render execute");
  const outputs = calls.render.result?.data?.outputs ?? [];
  assert(outputs.length === 1, `Expected one rendered output, got ${outputs.length}`);
  assert(outputs[0].output_basename === OUTPUT_BASENAME, "Live render did not return the requested basename");
  assert(outputs[0].absolute_path === path.join(RENDER_ROOT, `${OUTPUT_BASENAME}.wav`), "Live render output path does not use the requested managed basename");
  const bytes = await readFile(outputs[0].absolute_path);
  assert(bytes.length > 44 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WAVE", "Rendered file is not a non-empty WAV");
  assert(calls.render.result.verification?.status === "passed", "Render verification did not pass");
  assert(calls.render.result.data.restoration?.render_settings === true, "Render settings restoration was not proven");
  assert(calls.render.result.data.restoration?.track_selection === true, "Track selection restoration was not proven");
  assert(calls.render.result.data.restoration?.item_selection === true, "Item selection restoration was not proven");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  await client?.close().catch(() => {});
}

const after = {
  source_sha256: await sha256(options.source_project),
  copy_sha256: await sha256(COPY_PROJECT).catch(() => null),
  rendered_output: await outputEvidence(path.join(RENDER_ROOT, `${OUTPUT_BASENAME}.wav`)),
};
const report = {
  contract: "alpha3.3.render_basename.live_evidence.v1",
  generated_at: new Date().toISOString(),
  ok: error === null,
  source_project: options.source_project,
  evidence_project: COPY_PROJECT,
  transport_dir: options.transport_dir,
  artifact_root: ARTIFACT_ROOT,
  bridge_owner: options.bridge_owner,
  bridge_generation: options.bridge_generation,
  before,
  after,
  source_unchanged: before.source_sha256 === after.source_sha256 && before.backup_sha256 === after.source_sha256,
  calls: {
    current_path_before: macroOutcome(calls.current_path_before),
    preview: macroOutcome(calls.preview),
    render: macroOutcome(calls.render),
  },
  project_changes: ["Save-As to the evidence copy only", "No project content mutation; one whole-project WAV render"],
  rendered_files: after.rendered_output ? [after.rendered_output] : [],
  source_media_deleted: false,
  recovery: { backup_project: BACKUP_PROJECT, source_unchanged: before.source_sha256 === after.source_sha256 },
  error,
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`);
if (error) throw Object.assign(new Error(error.message), { cause: error });
process.stdout.write(`${JSON.stringify({ ok: true, report: REPORT_PATH, output: after.rendered_output }, null, 2)}\n`);

async function connect(projectPath, logicalSessionKey) {
  const next = new Client({ name: "openreaper-alpha33-render-basename-smoke", version: "1.0.0" });
  await next.connect(new StdioClientTransport({ command: process.execPath, args: [STDIO], env: {
    ...process.env,
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
    OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation),
    OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: RENDER_ROOT,
    OPENREAPER_CURRENT_PROJECT_PATH: projectPath,
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: INDEX_ROOT,
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: logicalSessionKey,
  } }));
  return next;
}

async function callTemplate(id, input) {
  const response = await client.callTool({ name: "call_template", arguments: { id, input, budget: PUBLIC_BUDGET } });
  return content(response);
}

function content(response) {
  const text = response?.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error("MCP response did not contain JSON text");
  return JSON.parse(text);
}

function assertMacroSuccess(value, label) {
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers ?? value)}`);
  assert(["completed", "dry_run_completed"].includes(value.execution?.status), `${label} returned ${value.execution?.status}`);
}

function assertTemplateSuccess(value, label) {
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers ?? value)}`);
  assert(value.verification?.status === "passed", `${label} verification returned ${value.verification?.status}`);
}

function macroOutcome(value) {
  return value ? { ok: value.ok, execution_status: value.execution?.status ?? null, verification_status: value.result?.verification?.status ?? null, outputs: value.result?.data?.outputs ?? [], blockers: value.blockers ?? [] } : null;
}

async function outputEvidence(file) {
  try {
    const bytes = await readFile(file);
    const info = await stat(file);
    return { absolute_path: file, output_basename: path.basename(file, path.extname(file)), size: info.size, sha256: createHash("sha256").update(bytes).digest("hex"), header: bytes.subarray(0, 12).toString("hex") };
  } catch { return null; }
}

function parseArgs(argv) {
  const result = { bridge_owner: "openreaper-alpha3-local", bridge_generation: 1 };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else throw new Error(`Unknown option ${key}`);
  }
  if (!result.evidence_root || !result.source_project || !result.transport_dir || !Number.isInteger(result.bridge_generation)) throw new Error("Usage: smoke-alpha3-3-render-basename.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> [--artifact-root <bridge-artifact-root>] [--bridge-owner owner] [--bridge-generation n]");
  return result;
}

function assert(condition, message) { if (!condition) throw new Error(message); }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
