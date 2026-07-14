#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const REPORT = path.join(options.evidence_root, "reports", "alpha3-3-lifecycle-macros-live.json");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };

await Promise.all([
  mkdir(path.dirname(REPORT), { recursive: true }),
  mkdir(path.join(options.evidence_root, "artifacts"), { recursive: true }),
  mkdir(path.join(options.evidence_root, "project-index-state"), { recursive: true }),
]);

const before = {
  source_sha256: await sha256(options.source_project),
  source_size: (await stat(options.source_project)).size,
  active_project_sha256: await sha256(options.project_path),
  active_project_size: (await stat(options.project_path)).size,
};
const calls = {};
let client = null;
let error = null;

try {
  client = await connect();
  calls.ping = await callTool("ping", {});
  assert(calls.ping.ok === true, `ping failed: ${JSON.stringify(calls.ping.error)}`);
  assert(calls.ping.product_surface?.agent_context_macro_guide?.macro_menu?.macro_ids?.length === 15, "ping did not expose the compact 15-Macro menu");

  calls.layout = await callTemplate("macro.project.apply_layout", {
    layout: [
      { id: "life_source", kind: "track", name: "A33 Lifecycle Source", index: 1 },
      { id: "life_target", kind: "track", name: "A33 Lifecycle Target", index: 2 },
      { id: "life_send_a", kind: "track", name: "A33 Lifecycle Send A", index: 3 },
      { id: "life_send_b", kind: "track", name: "A33 Lifecycle Send B", index: 4 },
    ],
    match_policy: "create_only",
    conflict_policy: "stop",
    dry_run: false,
  });
  assertMacroRows(calls.layout, "macro.project.apply_layout", 4);
  const trackRefs = Object.fromEntries(calls.layout.result.changes.map((row) => [row.operation_id, row.target_ref]));
  for (const id of ["life_source", "life_target", "life_send_a", "life_send_b"]) {
    assert(/^track:guid:.+/u.test(trackRefs[id] ?? ""), `layout returned no exact Track ref for ${id}`);
  }

  calls.create_item = await callTemplate("macro.midi.apply", {
    mode: "create_clips",
    start_seconds: 0,
    end_seconds: 1,
    notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
    dry_run: false,
  }, { track_ref: trackRefs.life_source });
  assertMacroSuccess(calls.create_item, "macro.midi.apply");
  const itemRef = calls.create_item.result?.data?.item_ref;
  assert(/^item:guid:.+/u.test(itemRef ?? ""), "MIDI creation returned no exact Item ref");

  const stackInput = {
    mode: "stack_on_existing_tracks",
    track_assignments: [{ item_ref: itemRef, target_track_ref: trackRefs.life_target }],
  };
  calls.item_move_preview = await callTemplate("macro.items.apply", stackInput);
  assert(calls.item_move_preview.ok === true && calls.item_move_preview.execution?.status === "dry_run_completed", "Item move did not default to a no-mutation preview");
  assert(calls.item_move_preview.result?.changes?.[0]?.mutation?.status === "not_run", "Item move preview reported a mutation");
  calls.item_move = await callTemplate("macro.items.apply", { ...stackInput, dry_run: false });
  assertMacroRows(calls.item_move, "macro.items.apply", 1);
  const itemMove = calls.item_move.result.changes[0];
  assert(itemMove.related_ref === trackRefs.life_target, "Item move did not preserve the exact requested target Track ref");
  assert(itemMove.live_readback?.source === "exact_item_track_readback", "Item move did not use exact Item/Track live readback");

  calls.fx_chain = await callTemplate("macro.fx.apply_chain", {
    owner_kind: "track",
    chain: [
      { plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" },
      { plugin_query: "ReaComp", duplicate_policy: "fail_if_present" },
    ],
    dry_run: false,
  }, { track_ref: trackRefs.life_source });
  assertMacroSuccess(calls.fx_chain, "macro.fx.apply_chain");
  const fxRefs = (calls.fx_chain.result?.data?.final_chain?.fx ?? []).map((row) => row.fx_ref).filter((ref) => /^fx:track:guid:.+:\d+$/u.test(ref));
  assert(fxRefs.length === 2, `Expected two exact FX refs, got ${fxRefs.length}`);

  calls.fx_delete_preview = await callTemplate("macro.project.delete_targets", {
    refs: { fx: [...fxRefs].sort(slotAscending) },
    dry_run: true,
    delete_policy: "project_objects_only",
  });
  assert(calls.fx_delete_preview.ok === true && calls.fx_delete_preview.execution?.status === "dry_run_completed", "FX deletion preview failed");
  const deleteRetry = calls.fx_delete_preview.result?.data?.executable_retry;
  assert(deleteRetry?.id === "macro.project.delete_targets", "FX deletion preview returned no executable retry");
  calls.fx_delete = await callTemplate(deleteRetry.id, deleteRetry.input);
  assertMacroRows(calls.fx_delete, "macro.project.delete_targets", 2);
  const deletedFxRefs = calls.fx_delete.result.changes.map((row) => row.live_readback?.observed_ref);
  assert(deletedFxRefs.every((ref) => typeof ref === "string"), "FX deletion lacked row-specific observed refs");
  assert(slotOf(deletedFxRefs[0]) > slotOf(deletedFxRefs[1]), "FX deletion did not execute in descending slot order");
  assert(calls.fx_delete.result.changes.every((row) => row.template_id === "template.fx.delete_fx" && row.live_readback?.source === "accepted_template_live_absence_readback"), "FX deletion rows did not retain accepted native absence readback");

  calls.routing_create = await callTemplate("macro.routing.apply", {
    routes: [
      { id: "send_a", action: "create", source_track_ref: trackRefs.life_source, destination_track_ref: trackRefs.life_send_a },
      { id: "send_b", action: "create", source_track_ref: trackRefs.life_source, destination_track_ref: trackRefs.life_send_b },
    ],
    dry_run: false,
  });
  assertMacroSuccess(calls.routing_create, "macro.routing.apply");
  const sendRefs = unique((calls.routing_create.result?.changes ?? [])
    .filter((row) => row.template_id === "template.routing.create_track_send")
    .flatMap((row) => row.target_refs ?? [])
    .filter((ref) => /^send:track:guid:.+:\d+$/u.test(ref)));
  assert(sendRefs.length === 2, `Routing create returned ${sendRefs.length} exact sends instead of 2`);

  calls.routing_delete_preview = await callTemplate("macro.routing.apply", {
    routes: sendRefs.map((sendRef, index) => ({ id: `remove_${index + 1}`, action: "delete", send_ref: sendRef })),
  });
  assert(calls.routing_delete_preview.ok === true && calls.routing_delete_preview.execution?.status === "dry_run_completed", "Routing removal did not default to preview");
  calls.routing_delete = await callTemplate("macro.routing.apply", {
    routes: sendRefs.map((sendRef, index) => ({ id: `remove_${index + 1}`, action: "delete", send_ref: sendRef })),
    dry_run: false,
  });
  assertMacroRows(calls.routing_delete, "macro.routing.apply", 2);
  const deletedSendRefs = calls.routing_delete.result.changes.map((row) => row.live_readback?.observed_ref);
  assert(slotOf(deletedSendRefs[0]) > slotOf(deletedSendRefs[1]), "Internal send removal did not execute in descending source-slot order");
  assert(calls.routing_delete.result.changes.every((row) => row.template_id === "template.routing.remove_send" && row.live_readback?.source === "accepted_template_live_absence_readback"), "Internal send removal rows lacked accepted native absence readback");

  calls.save = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save, "macro.project.file");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  try { await client?.close(); } catch {}
}

const after = {
  source_sha256: await sha256(options.source_project),
  source_size: (await stat(options.source_project)).size,
  active_project_sha256: await sha256(options.project_path),
  active_project_size: (await stat(options.project_path)).size,
};
const report = {
  contract: "alpha3.3.lifecycle_macros_live.v1",
  ok: error === null,
  evidence_root: options.evidence_root,
  source_project: options.source_project,
  active_test_project: options.project_path,
  transport_dir: options.transport_dir,
  bridge: { owner: options.bridge_owner, generation: options.bridge_generation },
  public_budget: PUBLIC_BUDGET,
  tests: {
    visible_macro_count: calls.ping?.product_surface?.agent_context_macro_guide?.macro_menu?.macro_ids?.length ?? null,
    item_move_preview: outcome(calls.item_move_preview),
    item_move: outcome(calls.item_move),
    fx_delete_preview: outcome(calls.fx_delete_preview),
    fx_delete: outcome(calls.fx_delete),
    routing_delete_preview: outcome(calls.routing_delete_preview),
    routing_delete: outcome(calls.routing_delete),
  },
  project_changes: {
    tracks_created: calls.layout?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    midi_item_created: calls.create_item?.ok === true,
    item_moved_to_existing_track: calls.item_move?.ok === true,
    fx_created: calls.fx_chain?.result?.data?.final_chain?.fx?.length ?? 0,
    fx_deleted: calls.fx_delete?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    internal_sends_created: calls.routing_create?.result?.changes?.filter((row) => row.template_id === "template.routing.create_track_send" && row.status === "applied").length ?? 0,
    internal_sends_deleted: calls.routing_delete?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    saved_to_evidence_copy: calls.save?.ok === true,
  },
  rendered_files: [],
  recovery_backup_posture: {
    backup_project: options.backup_project,
    backup_exists: await exists(options.backup_project),
    source_hash_unchanged: before.source_sha256 === after.source_sha256,
    source_project_not_mutated_on_disk: before.source_sha256 === after.source_sha256,
    evidence_copy_preserved: await exists(options.project_path),
    source_media_deleted: false,
  },
  before,
  after,
  calls,
  error,
};
await writeFile(REPORT, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: REPORT, error }, null, 2)}\n`);
if (error) process.exit(1);

async function connect() {
  const active = new Client({ name: "alpha33-lifecycle-live", version: "0.0.0" });
  await active.connect(new StdioClientTransport({
    command: process.execPath,
    args: [STDIO],
    cwd: REPO,
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(REPO, "reaper/bridge/openreaper-live-bridge.lua"),
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "300000",
      OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation),
      OPENREAPER_LIVE_BRIDGE_SESSION_ID: "alpha33-lifecycle-live",
      OPENREAPER_ARTIFACT_ROOT: path.join(options.evidence_root, "artifacts"),
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: path.join(options.evidence_root, "artifacts"),
      OPENREAPER_CURRENT_PROJECT_PATH: options.project_path,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: path.join(options.evidence_root, "project-index-state"),
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha33-lifecycle-live",
    },
  }));
  return active;
}

async function callTemplate(id, input, refs = undefined) {
  return callTool("call_template", { id, input, ...(refs ? { refs } : {}), budget: PUBLIC_BUDGET });
}

async function callTool(name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000, maxTotalTimeout: 600_000 });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  return JSON.parse(text);
}

function assertMacroSuccess(value, id) {
  assert(value?.contract === "macro.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(["completed", "dry_run_completed"].includes(value?.execution?.status), `${id} status=${value?.execution?.status}`);
  assert(value?.result?.verification?.status === "passed", `${id} verification did not pass`);
}

function assertMacroRows(value, id, count) {
  assertMacroSuccess(value, id);
  const rows = value.result?.changes ?? [];
  assert(rows.length === count, `${id} returned ${rows.length} rows instead of ${count}`);
  assert(rows.every((row) => row.status === "applied" && row.mutation?.status === "completed" && row.live_readback?.status === "passed" && ["completed", "skipped"].includes(row.index_maintenance?.status)), `${id} row truth failed: ${JSON.stringify(rows)}`);
}

function outcome(value) {
  return value ? {
    ok: value.ok,
    macro_id: value.macro?.id ?? null,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? null,
    change_count: value.result?.changes?.length ?? 0,
    response_bytes: value.budget?.actual_bytes ?? null,
  } : null;
}

function slotAscending(left, right) { return slotOf(left) - slotOf(right); }
function slotOf(ref) { return Number(String(ref).slice(String(ref).lastIndexOf(":") + 1)); }
function unique(values) { return [...new Set(values)]; }
function assert(condition, message) { if (!condition) throw new Error(message); }
async function sha256(file) { return createHash("sha256").update(await readFile(file)).digest("hex"); }
async function exists(file) { try { await stat(file); return true; } catch { return false; } }

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--project-path") result.project_path = path.resolve(value);
    else if (key === "--backup-project") result.backup_project = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  result.bridge_owner ??= "openreaper-alpha3-local";
  result.bridge_generation ??= 1;
  const required = ["evidence_root", "source_project", "project_path", "backup_project", "transport_dir"];
  if (required.some((key) => !result[key]) || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-lifecycle-macros.mjs --evidence-root <root> --source-project <source.RPP> --project-path <active-copy.RPP> --backup-project <backup.RPP> --transport-dir <transport> [--bridge-owner owner] [--bridge-generation n]");
  }
  return result;
}
