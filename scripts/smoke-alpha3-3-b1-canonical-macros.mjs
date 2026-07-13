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
const SOURCE_PROJECT = options.source_project;
const COPY_PROJECT = path.join(ROOT, "fixture", "Alpha33-B1-Canonical-Macros.RPP");
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Untitled-before.RPP");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-b1-canonical-macros-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };
const CANONICAL_IDS = [
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
];
const DRAFT_IDS = [];
const ALIAS_IDS = ["macro.midi.create_clip", "macro.fx.apply_native_chain", "macro.set_stock_plugin_controls"];

await Promise.all([
  mkdir(path.dirname(COPY_PROJECT), { recursive: true }),
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.join(ROOT, "artifacts"), { recursive: true }),
  mkdir(path.join(ROOT, "project-index-state"), { recursive: true }),
  mkdir(path.join(ROOT, "reports"), { recursive: true }),
]);
await copyFile(SOURCE_PROJECT, BACKUP_PROJECT);

const before = {
  source_sha256: await sha256(SOURCE_PROJECT),
  source_size: (await stat(SOURCE_PROJECT)).size,
  backup_sha256: await sha256(BACKUP_PROJECT),
};
const calls = {};
let client = null;
let error = null;

try {
  client = await connect(SOURCE_PROJECT, "alpha33-b1-bootstrap");
  calls.ping = await callTool(client, "ping", {});
  calls.menu = await callTool(client, "list_templates", {});
  calls.recipes = await callTool(client, "list_recipes", {});
  assertGuide(calls.ping.product_surface?.agent_context_macro_guide, "ping");
  assertGuide(calls.menu.product_surface?.agent_context_macro_guide, "list_templates");
  assertGuide(calls.recipes.product_surface?.agent_context_macro_guide, "list_recipes");

  const visibleIds = calls.menu.items?.filter((item) => item.action_kind === "macro").map((item) => item.id) ?? [];
  assert(visibleIds.length === 15, `Expected 15 visible canonical Macros, got ${visibleIds.length}`);
  for (const id of CANONICAL_IDS) assert(visibleIds.includes(id), `${id} is not visible`);
  for (const id of [...DRAFT_IDS, ...ALIAS_IDS]) assert(!visibleIds.includes(id), `${id} leaked into the menu`);

  calls.save_as = await callTemplate("macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "macro.project.file");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch to the evidence copy");
  await client.close();
  client = await connect(COPY_PROJECT, "alpha33-b1-live");

  calls.layout = await callTemplate("macro.project.apply_layout", {
    layout: [
      { id: "b1_midi", kind: "track", name: "A33 B1 MIDI", index: 0 },
      { id: "b1_fx", kind: "track", name: "A33 B1 FX", index: 1 },
    ],
    match_policy: "create_only",
    conflict_policy: "stop",
    dry_run: false,
  });
  assertMacroSuccess(calls.layout, "macro.project.apply_layout");
  const layoutRows = calls.layout.result?.changes ?? [];
  assert(layoutRows.length === 2, `Expected two layout outcomes, got ${layoutRows.length}`);
  assert(layoutRows.every((row) => row.status === "applied" && row.live_readback?.status === "passed"), "Layout readback failed");
  const midiTrackRef = layoutRows.find((row) => row.operation_id === "b1_midi")?.target_ref;
  const fxTrackRef = layoutRows.find((row) => row.operation_id === "b1_fx")?.target_ref;
  assert(typeof midiTrackRef === "string", "MIDI track ref missing");
  assert(typeof fxTrackRef === "string", "FX track ref missing");

  calls.midi_apply = await callTemplate("macro.midi.apply", {
    mode: "create_clips",
    start_seconds: 0,
    end_seconds: 1,
    notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
    dry_run: false,
  }, { track_ref: midiTrackRef });
  assertCanonicalSuccess(calls.midi_apply, "macro.midi.apply");
  assert(calls.midi_apply.result?.data?.note_count === 1, "MIDI note readback did not return one note");

  calls.fx_apply_chain = await callTemplate("macro.fx.apply_chain", {
    controls: { threshold_db: -18, ratio: 3 },
    dry_run: false,
  }, { track_ref: fxTrackRef });
  assertCanonicalSuccess(calls.fx_apply_chain, "macro.fx.apply_chain");
  const fxRef = calls.fx_apply_chain.result?.data?.fx_ref;
  assert(typeof fxRef === "string" && fxRef.startsWith("fx:"), "FX chain returned no canonical fx_ref");

  calls.fx_set_controls = await callTemplate("macro.fx.set_controls", {
    plugin: "reacomp",
    controls: { threshold_db: -12, ratio: 4 },
    dry_run: false,
  }, { fx_ref: fxRef });
  assertCanonicalSuccess(calls.fx_set_controls, "macro.fx.set_controls");

  calls.aliases = {};
  for (const id of ALIAS_IDS) {
    const response = await callTemplate(id, {});
    calls.aliases[id] = response;
    assert(response.error?.code === "CALL_TEMPLATE_ID_REPLACED", `${id} did not return replacement guidance`);
    assert(typeof response.error?.details?.replacement === "string", `${id} replacement missing`);
  }

  calls.drafts = {};
  for (const id of DRAFT_IDS) {
    const response = await callTemplate(id, {});
    calls.drafts[id] = response;
    assert(response.error?.code === "CALL_TEMPLATE_ID_HELD", `${id} was not held`);
    assert(response.error?.details?.visible === false, `${id} did not report hidden draft truth`);
  }

  calls.save_current = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "macro.project.file");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  try { await client?.close(); } catch {}
}

const after = {
  source_sha256: await sha256(SOURCE_PROJECT),
  source_size: (await stat(SOURCE_PROJECT)).size,
  copy_exists: await exists(COPY_PROJECT),
  copy_sha256: await exists(COPY_PROJECT) ? await sha256(COPY_PROJECT) : null,
  copy_size: await exists(COPY_PROJECT) ? (await stat(COPY_PROJECT)).size : null,
};
const report = {
  contract: "alpha3.3.b1.canonical_macros_live.v1",
  ok: error === null,
  evidence_root: ROOT,
  source_project: SOURCE_PROJECT,
  active_test_project: COPY_PROJECT,
  public_budget: PUBLIC_BUDGET,
  tests: {
    visible_canonical_macro_count: calls.menu?.items?.filter((item) => item.action_kind === "macro").length ?? null,
    three_product_surfaces_share_alpha33_guide: [calls.ping, calls.menu, calls.recipes].every((value) =>
      value?.product_surface?.agent_context_macro_guide?.contract === "alpha3.3.agent_context_macro_guide.v1"),
    midi_apply: outcome(calls.midi_apply),
    fx_apply_chain: outcome(calls.fx_apply_chain),
    fx_set_controls: outcome(calls.fx_set_controls),
    aliases_replaced: Object.values(calls.aliases ?? {}).every((value) => value?.error?.code === "CALL_TEMPLATE_ID_REPLACED"),
    drafts_hidden_and_held: Object.values(calls.drafts ?? {}).every((value) => value?.error?.code === "CALL_TEMPLATE_ID_HELD" && value?.error?.details?.visible === false),
  },
  project_changes: {
    tracks_created: calls.layout?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    midi_clip_created: calls.midi_apply?.ok === true,
    fx_chain_applied: calls.fx_apply_chain?.ok === true,
    fx_controls_updated: calls.fx_set_controls?.ok === true,
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  recovery_backup_posture: {
    source_project_backup: BACKUP_PROJECT,
    source_hash_unchanged: before.source_sha256 === after.source_sha256,
    source_project_not_mutated_on_disk: before.source_sha256 === after.source_sha256,
    evidence_copy_preserved: after.copy_exists,
    source_media_deleted: false,
  },
  before,
  after,
  calls,
  error,
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: REPORT_PATH, error }, null, 2)}\n`);
if (error) process.exit(1);

async function connect(projectPath, logicalSessionKey) {
  const client = new Client({ name: "alpha33-b1-live", version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [STDIO],
    cwd: REPO,
    env: {
      ...process.env,
      OPENREAPER_ARTIFACT_ROOT: path.join(ROOT, "artifacts"),
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: path.join(ROOT, "artifacts"),
      OPENREAPER_CURRENT_PROJECT_PATH: projectPath,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: path.join(ROOT, "project-index-state"),
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: logicalSessionKey,
    },
  }));
  return client;
}

async function callTemplate(id, input, refs = undefined) {
  return callTool(client, "call_template", {
    id,
    input,
    ...(refs ? { refs } : {}),
    budget: PUBLIC_BUDGET,
  });
}

async function callTool(activeClient, name, args) {
  const response = await activeClient.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 600_000 },
  );
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  return JSON.parse(text);
}

function assertGuide(guide, surface) {
  assert(guide?.contract === "alpha3.3.agent_context_macro_guide.v1", `${surface} returned the wrong guide`);
  assert(Array.isArray(guide?.macro_menu?.macro_ids) && guide.macro_menu.macro_ids.length === 15, `${surface} returned no compact 15-Macro menu`);
  assert(!Object.hasOwn(guide, "primary_spine") && !Object.hasOwn(guide, "secondary_menu"), `${surface} retained tier fields`);
}

function assertMacroSuccess(value, id) {
  assert(value?.contract === "macro.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(["completed", "dry_run_completed"].includes(value?.execution?.status), `${id} status=${value?.execution?.status}`);
}

function assertCanonicalSuccess(value, id) {
  assertMacroSuccess(value, id);
  assert(value.macro?.id === id, `${id} returned macro identity ${value.macro?.id}`);
  assert(value.result?.verification?.status === "passed", `${id} verification did not pass`);
  assert(value.budget?.truncated === false, `${id} result was truncated`);
}

function outcome(value) {
  return value ? {
    ok: value.ok,
    contract: value.contract,
    macro_id: value.macro?.id ?? null,
    program_id: value.macro?.program_id ?? null,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? null,
    result_bytes: value.budget?.actual_bytes ?? null,
  } : null;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.source_project) throw new Error("Usage: smoke-alpha3-3-b1-canonical-macros.mjs --evidence-root <fresh-root> --source-project <project.RPP>");
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

async function exists(file) {
  try { await stat(file); return true; } catch { return false; }
}
