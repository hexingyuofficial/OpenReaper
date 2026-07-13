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
const COPY_PROJECT = path.join(ROOT, "fixture", "Alpha33-B1c-Items-Apply.RPP");
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Untitled-before.RPP");
const WAV_SOURCE = path.join(ROOT, "source-media", "alpha33-b1c-items.wav");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const RENDER_ROOT = path.join(ROOT, "renders");
const INDEX_ROOT = path.join(ROOT, "project-index-state");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-b1c-items-apply-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };

await Promise.all([
  mkdir(path.dirname(COPY_PROJECT), { recursive: true }),
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.dirname(WAV_SOURCE), { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
  mkdir(path.dirname(REPORT_PATH), { recursive: true }),
]);
await copyFile(SOURCE_PROJECT, BACKUP_PROJECT);
await writeDeterministicWav(WAV_SOURCE);

const before = {
  source_project_sha256: await sha256(SOURCE_PROJECT),
  source_project_size: (await stat(SOURCE_PROJECT)).size,
  recovery_backup_sha256: await sha256(BACKUP_PROJECT),
  wav_source_sha256: await sha256(WAV_SOURCE),
  wav_source_size: (await stat(WAV_SOURCE)).size,
};
const calls = {};
let client = null;
let error = null;

try {
  client = await connect(SOURCE_PROJECT, "alpha33-b1c-bootstrap");
  calls.ping = await callTool(client, "ping", {});
  calls.menu = await callTool(client, "list_templates", {});
  calls.manual = await callTool(client, "list_templates", { ids: ["macro.items.apply"], fields: ["id"] });
  assertAlpha33Surface(calls);

  calls.save_as = await callTemplate("macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "macro.project.file save_as");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch to the evidence copy");
  await client.close();
  client = await connect(COPY_PROJECT, "alpha33-b1c-live");

  const itemRefs = [];
  const importPositions = [1, 4, 8];
  for (const [index, positionSeconds] of importPositions.entries()) {
    const key = `import_wav_${index + 1}`;
    calls[key] = await callTemplate("macro.media.place_assets", {
      assets: [{
        id: `b1c_wav_${index + 1}`,
        path: WAV_SOURCE,
        track_name: `A33 B1c ${index + 1}`,
        create_track: true,
        track_index: index,
        position_seconds: positionSeconds,
        preserve_selection: true,
      }],
      dry_run: false,
    });
    assertMacroSuccess(calls[key], `macro.media.place_assets ${index + 1}`);
    itemRefs.push(requireCanonicalRef(calls[key], "item:", `WAV import ${index + 1}`));
  }
  assert(new Set(itemRefs).size === 3, "Three imports did not return three distinct exact Item refs");

  calls.before_dry_run = await readItemSummaries(itemRefs);
  calls.dry_run = await callTemplate("macro.items.apply", {
    mode: "sequence_with_gap",
    target_refs: itemRefs,
    anchor_seconds: 2,
    gap_seconds: 0.25,
    dry_run: true,
  });
  assertDryRun(calls.dry_run, itemRefs.length);
  calls.after_dry_run = await readItemSummaries(itemRefs);
  assertPositionsEqual(calls.before_dry_run, calls.after_dry_run, "dry_run mutated Item positions");

  calls.arrangement = await callTemplate("macro.items.apply", {
    mode: "sequence_with_gap",
    target_refs: itemRefs,
    anchor_seconds: 2,
    gap_seconds: 0.25,
    dry_run: false,
  });
  assertItemsApplySuccess(calls.arrangement, 3);
  calls.after_arrangement = await readItemSummaries(itemRefs);
  assertExactPositions(calls.after_arrangement, [2, 4.25, 6.5]);

  calls.before_item_pan_block = await readItemSummaries([itemRefs[0]]);
  calls.item_pan_block = await callTemplate("macro.items.apply", {
    mode: "set_properties",
    target_refs: [itemRefs[0]],
    properties: { pan: 0.25 },
    dry_run: false,
  });
  assert(calls.item_pan_block?.ok === false, "Item pan unexpectedly succeeded");
  assert(calls.item_pan_block?.error?.code === "ITEM_APPLY_ITEM_PAN_UNSUPPORTED", `Item pan returned ${calls.item_pan_block?.error?.code}`);
  assert((calls.item_pan_block?.result?.changes?.length ?? -1) === 0, "Blocked Item pan returned mutation rows");
  assert(String(calls.item_pan_block?.error?.message).includes("target_kind=take"), "Blocked Item pan omitted the Active Take recovery route");
  calls.after_item_pan_block = await readItemSummaries([itemRefs[0]]);
  assertSummaryEqual(calls.before_item_pan_block[0], calls.after_item_pan_block[0], "Blocked Item pan changed the target Item");

  calls.withdrawn_item_pan = await callTemplate("template.items.set_item_pan", { pan: 0.25 });
  assert(calls.withdrawn_item_pan?.ok === false, "Withdrawn Item pan Template unexpectedly succeeded");
  assert(calls.withdrawn_item_pan?.error?.code === "CALL_TEMPLATE_ID_WITHDRAWN", `Withdrawn Item pan returned ${calls.withdrawn_item_pan?.error?.code}`);
  assert(String(calls.withdrawn_item_pan?.error?.message).includes("Active Take"), "Withdrawn Item pan omitted the Active Take explanation");

  const firstItemObject = await resolveItemObject(itemRefs[0]);
  const activeTakeBefore = calls.after_item_pan_block[0].active_take_ref;
  calls.set_active_take_pan = await callTemplate("macro.controls.set", {
    target_kind: "take",
    fields: { pan: 0.25 },
    dry_run: false,
  }, { item_ref: firstItemObject });
  assertMacroSuccess(calls.set_active_take_pan, "macro.controls.set take pan");
  assert((calls.set_active_take_pan.result?.changes?.length ?? 0) === 1, "Take pan did not return one mutation row");
  assert(calls.set_active_take_pan.result.changes[0]?.status === "applied", "Take pan row was not applied from readback");
  const takePanReadback = calls.set_active_take_pan.result.changes[0]?.live_readback?.fields?.find((row) => row.field === "pan");
  assert(takePanReadback?.source === "accepted_template_live_readback", `Take pan readback source=${takePanReadback?.source}`);
  assert(valuesMatch(takePanReadback?.observed_value, 0.25), `Active Take pan observed=${takePanReadback?.observed_value}`);
  calls.after_take_pan = await readItemSummaries([itemRefs[0]]);
  assert(calls.after_take_pan[0].active_take_ref === activeTakeBefore, "Take pan changed the Active Take identity");

  calls.set_properties = await callTemplate("macro.items.apply", {
    mode: "set_properties",
    target_refs: [itemRefs[0]],
    properties: {
      volume_db: -6,
      muted: true,
      locked: true,
      loop_source: false,
    },
    dry_run: false,
  });
  assertItemsApplySuccess(calls.set_properties, 4);
  assertPropertyChanges(calls.set_properties, {
    volume_db: -6,
    muted: true,
    locked: true,
    loop_source: false,
  });
  calls.after_properties = await readItemSummaries([itemRefs[0]]);
  assert(valuesMatch(calls.after_properties[0].position_seconds, calls.after_take_pan[0].position_seconds), "Property writes changed Item position");
  assert(calls.after_properties[0].active_take_ref === activeTakeBefore, "Property writes changed the Active Take identity");

  const heldBefore = calls.after_properties[0];
  calls.held_mode = await callTemplate("macro.items.apply", {
    mode: "normalize_lufs",
    target_refs: [itemRefs[0]],
    dry_run: false,
  });
  assert(calls.held_mode?.ok === false, "Held normalize_lufs mode unexpectedly succeeded");
  assert(calls.held_mode?.error?.code === "ITEM_APPLY_MODE_HELD", `Held mode returned ${calls.held_mode?.error?.code}`);
  assert((calls.held_mode?.result?.changes?.length ?? -1) === 0, "Held mode returned mutation rows");
  calls.after_held_mode = await readItemSummaries([itemRefs[0]]);
  assertSummaryEqual(heldBefore, calls.after_held_mode[0], "Held mode changed the target Item");

  calls.save_current = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "macro.project.file save_current");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  try { await client?.close(); } catch {}
}

const after = {
  source_project_sha256: await sha256(SOURCE_PROJECT),
  source_project_size: (await stat(SOURCE_PROJECT)).size,
  evidence_copy_exists: await exists(COPY_PROJECT),
  evidence_copy_sha256: await exists(COPY_PROJECT) ? await sha256(COPY_PROJECT) : null,
  evidence_copy_size: await exists(COPY_PROJECT) ? (await stat(COPY_PROJECT)).size : null,
  wav_source_exists: await exists(WAV_SOURCE),
};
const report = {
  contract: "alpha3.3.b1c.items_apply_live.v1",
  ok: error === null,
  evidence_root: ROOT,
  source_project: SOURCE_PROJECT,
  active_test_project: COPY_PROJECT,
  transport: { directory: options.transport_dir, owner: options.bridge_owner, generation: options.bridge_generation },
  public_budget: PUBLIC_BUDGET,
  tests: {
    visible_macro_count: calls.menu?.items?.filter((item) => item.action_kind === "macro").length ?? null,
    items_apply_visible: calls.menu?.items?.some((item) => item.id === "macro.items.apply") ?? false,
    exact_manual_runnable: calls.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0]?.runnable ?? false,
    imported_item_count: [calls.import_wav_1, calls.import_wav_2, calls.import_wav_3].filter((value) => value?.ok === true).length,
    dry_run: outcome(calls.dry_run),
    arrangement: outcome(calls.arrangement),
    item_pan_block: outcome(calls.item_pan_block),
    withdrawn_item_pan: outcome(calls.withdrawn_item_pan),
    active_take_pan: outcome(calls.set_active_take_pan),
    set_properties: outcome(calls.set_properties),
    held_mode: outcome(calls.held_mode),
    final_positions: calls.after_arrangement?.map((row) => row.position_seconds) ?? [],
    final_properties: propertyChangeProjection(calls.set_properties),
  },
  project_changes: {
    tracks_and_items_created: 3,
    arrangement_rows_applied: appliedCount(calls.arrangement),
    blocked_item_pan_mutation_rows: calls.item_pan_block?.result?.changes?.length ?? null,
    active_take_pan_rows_applied: appliedCount(calls.set_active_take_pan),
    property_rows_applied: appliedCount(calls.set_properties),
    held_mode_mutation_rows: calls.held_mode?.result?.changes?.length ?? null,
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  recovery_backup_posture: {
    source_project_backup: BACKUP_PROJECT,
    source_hash_unchanged: before.source_project_sha256 === after.source_project_sha256,
    source_project_not_mutated_on_disk: before.source_project_sha256 === after.source_project_sha256,
    evidence_copy_preserved: after.evidence_copy_exists,
    generated_source_media_preserved: after.wav_source_exists,
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
  const activeClient = new Client({ name: "alpha33-b1c-items-apply-live", version: "0.0.0" });
  await activeClient.connect(new StdioClientTransport({
    command: process.execPath,
    args: [STDIO],
    cwd: REPO,
    env: {
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
    },
  }));
  return activeClient;
}

async function callTemplate(id, input, refs = undefined) {
  return callTool(client, "call_template", { id, input, ...(refs ? { refs } : {}), budget: PUBLIC_BUDGET });
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

async function readItemSummaries(itemRefs) {
  const rows = [];
  for (const itemRef of itemRefs) {
    const resolved = await callTemplate("template.items.resolve_item_ref", { ref: itemRef });
    assertTemplateSuccess(resolved, `resolve ${itemRef}`);
    const itemObject = resolved.result?.refs?.find((entry) => entry?.kind === "item" && entry.ref === itemRef);
    assert(itemObject, `Resolved Item object missing for ${itemRef}`);
    const summary = await callTemplate(
      "template.items.read_item_summary",
      { include_take_summary: true },
      { item_ref: itemObject },
    );
    assertTemplateSuccess(summary, `read ${itemRef}`);
    assert(summary.result?.summary?.item_ref === itemRef, `Item summary identity mismatch for ${itemRef}`);
    rows.push(summary.result.summary);
  }
  return rows;
}

async function resolveItemObject(itemRef) {
  const resolved = await callTemplate("template.items.resolve_item_ref", { ref: itemRef });
  assertTemplateSuccess(resolved, `resolve ${itemRef}`);
  const itemObject = resolved.result?.refs?.find((entry) => entry?.kind === "item" && entry.ref === itemRef);
  assert(itemObject, `Resolved Item object missing for ${itemRef}`);
  return itemObject;
}

function assertAlpha33Surface(value) {
  const visibleIds = value.menu?.items?.filter((item) => item.action_kind === "macro").map((item) => item.id) ?? [];
  assert(visibleIds.length === 15, `Expected 15 visible executable Macros, got ${visibleIds.length}`);
  assert(visibleIds.includes("macro.items.apply"), "macro.items.apply is not visible");
  const expansion = value.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0];
  assert(expansion?.id === "macro.items.apply" && expansion.runnable === true, "Exact items.apply manual is not runnable");
  assert(expansion.action_manual?.input_shape?.mode?.includes("sequence_with_gap"), "Exact manual does not expose the accepted arrangement modes");
}

function assertDryRun(value, expectedRows) {
  assert(value?.contract === "macro.execution.v1" && value.ok === true, `items.apply dry run failed: ${JSON.stringify(value?.error)}`);
  assert(value.execution?.status === "dry_run_completed", `Dry run status=${value.execution?.status}`);
  assert(value.result?.changes?.length === expectedRows, "Dry run returned the wrong row count");
  assert(value.result.changes.every((row) => row.status === "planned" && row.mutation?.status === "not_run"), "Dry run reported a mutation");
}

function assertItemsApplySuccess(value, expectedRows) {
  assertMacroSuccess(value, "macro.items.apply");
  assert(value.result?.changes?.length === expectedRows, `items.apply returned ${value.result?.changes?.length} rows, expected ${expectedRows}`);
  assert(value.result.changes.every((row) => row.status === "applied"), "items.apply returned a non-applied row");
  assert(value.result.changes.every((row) => row.mutation?.status === "completed"), "items.apply mutation status is not completed row by row");
  assert(value.result.changes.every((row) => row.live_readback?.status === "passed"), "items.apply live readback did not pass row by row");
  assert(value.result.changes.every((row) => ["completed", "skipped"].includes(row.index_maintenance?.status)), "items.apply index maintenance was not reported separately");
}

function assertPropertyChanges(value, expected) {
  const rows = new Map((value.result?.changes ?? []).map((row) => [row.field, row]));
  for (const [field, expectedValue] of Object.entries(expected)) {
    const row = rows.get(field);
    assert(row?.status === "applied", `${field} was not applied`);
    assert(row.live_readback?.status === "passed", `${field} live readback did not pass`);
    assert(valuesMatch(row.live_readback?.observed_value, expectedValue), `${field} observed ${row.live_readback?.observed_value}, expected ${expectedValue}`);
  }
}

function assertMacroSuccess(value, id) {
  assert(value?.contract === "macro.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value.execution?.status === "completed", `${id} status=${value.execution?.status}`);
  assert(value.budget?.truncated === false, `${id} result was truncated`);
}

function assertTemplateSuccess(value, id) {
  assert(value?.contract === "template.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error)}`);
}

function requireCanonicalRef(value, prefix, label) {
  const ref = value?.result?.canonical_refs?.find((entry) => typeof entry === "string" && entry.startsWith(prefix));
  assert(typeof ref === "string", `${label} canonical ref missing`);
  return ref;
}

function assertPositionsEqual(beforeRows, afterRows, message) {
  assert(beforeRows.length === afterRows.length, `${message}: row count changed`);
  for (let index = 0; index < beforeRows.length; index += 1) {
    assert(valuesMatch(beforeRows[index].position_seconds, afterRows[index].position_seconds), `${message}: Item ${index + 1}`);
  }
}

function assertExactPositions(rows, expected) {
  assert(rows.length === expected.length, "Final position row count mismatch");
  for (let index = 0; index < expected.length; index += 1) {
    assert(valuesMatch(rows[index].position_seconds, expected[index]), `Item ${index + 1} position=${rows[index].position_seconds}, expected ${expected[index]}`);
  }
}

function assertSummaryEqual(beforeRow, afterRow, message) {
  for (const field of ["item_ref", "position_seconds", "length_seconds", "snap_offset_seconds", "fade_in_seconds", "fade_out_seconds", "active_take_ref", "take_count"]) {
    assert(valuesMatch(beforeRow?.[field], afterRow?.[field]), `${message}: ${field}`);
  }
}

function valuesMatch(actual, expected) {
  if (typeof expected === "number") return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.000001;
  return actual === expected;
}

function outcome(value) {
  return value ? {
    ok: value.ok,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? null,
    error_code: value.error?.code ?? null,
    change_count: value.result?.changes?.length ?? 0,
    applied_count: appliedCount(value),
    mutation_status: value.result?.data?.outcome?.mutation?.status ?? null,
    live_readback_status: value.result?.data?.outcome?.live_readback?.status ?? null,
    index_maintenance_status: value.result?.data?.outcome?.index_maintenance?.status ?? null,
    result_bytes: value.budget?.actual_bytes ?? null,
  } : null;
}

function appliedCount(value) {
  return value?.result?.changes?.filter((row) => row.status === "applied").length ?? 0;
}

function propertyChangeProjection(value) {
  return (value?.result?.changes ?? []).map((row) => ({
    field: row.field,
    status: row.status,
    requested_value: row.requested_value,
    observed_value: row.live_readback?.observed_value,
    readback_source: row.live_readback?.source,
  }));
}

async function writeDeterministicWav(file) {
  const sampleRate = 48_000;
  const channels = 2;
  const seconds = 2;
  const frameCount = sampleRate * seconds;
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const data = Buffer.alloc(frameCount * blockAlign);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    const sample = Math.sin(2 * Math.PI * 330 * time) * 0.35;
    const pcm = Math.max(-1, Math.min(1, sample)) * 32767;
    for (let channel = 0; channel < channels; channel += 1) {
      data.writeInt16LE(Math.round(pcm * (channel === 0 ? 1 : 0.8)), (frame * channels + channel) * 2);
    }
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "ascii");
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8, "ascii");
  header.write("fmt ", 12, "ascii");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * blockAlign, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write("data", 36, "ascii");
  header.writeUInt32LE(data.length, 40);
  await writeFile(file, Buffer.concat([header, data]));
}

function parseArgs(argv) {
  const result = { bridge_owner: "openreaper-alpha", bridge_generation: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.source_project || !result.transport_dir || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-b1c-items-apply.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> [--bridge-owner owner] [--bridge-generation n]");
  }
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
