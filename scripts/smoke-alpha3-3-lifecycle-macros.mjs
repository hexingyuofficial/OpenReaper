#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const MCP_COMMAND = options.mcp_command ?? process.execPath;
const MCP_ARGS = options.mcp_command ? [] : [STDIO];
const MCP_CWD = options.mcp_command ? path.dirname(options.mcp_command) : REPO;
const BRIDGE_SCRIPT = options.mcp_command
  ? path.resolve(path.dirname(options.mcp_command), "../vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua")
  : path.join(REPO, "reaper/bridge/openreaper-live-bridge.lua");
const ARTIFACT_ROOT = options.artifact_root ?? path.join(options.evidence_root, "artifacts");
const RENDER_ROOT = options.render_root ?? path.join(options.evidence_root, "renders");
const REPORT = path.join(options.evidence_root, "reports", "alpha3-3-lifecycle-macros-live.json");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };

await Promise.all([
  mkdir(path.dirname(REPORT), { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
  mkdir(path.join(options.evidence_root, "project-index-state"), { recursive: true }),
]);

const before = {
  source_sha256: await sha256(options.source_project),
  source_size: (await stat(options.source_project)).size,
  active_project_sha256: await sha256(options.project_path),
  active_project_size: (await stat(options.project_path)).size,
  source_media_sha256: await sha256(options.source_media),
  source_media_size: (await stat(options.source_media)).size,
};
const calls = {};
const timings = {};
let client = null;
let error = null;

try {
  client = await connect();
  calls.ping = await timed("ping", () => callTool("ping", {}));
  assert(calls.ping.ok === true, `ping failed: ${JSON.stringify(calls.ping.error)}`);
  assert(calls.ping.product_surface?.agent_context_macro_guide?.macro_menu?.macro_ids?.length === 15, "ping did not expose the compact 15-Macro menu");

  calls.layout = await timed("layout", () => callTemplate("macro.project.apply_layout", {
    layout: [
      { id: "life_source", kind: "track", name: "A33 Lifecycle Source", index: 1 },
      { id: "life_target", kind: "track", name: "A33 Lifecycle Target", index: 2 },
      { id: "life_send_a", kind: "track", name: "A33 Lifecycle Send A", index: 3 },
      { id: "life_send_b", kind: "track", name: "A33 Lifecycle Send B", index: 4 },
    ],
    match_policy: "create_only",
    conflict_policy: "stop",
    dry_run: false,
  }));
  assertMacroRows(calls.layout, "macro.project.apply_layout", 4);
  const trackRefs = Object.fromEntries(calls.layout.result.changes.map((row) => [row.operation_id, row.target_ref]));
  for (const id of ["life_source", "life_target", "life_send_a", "life_send_b"]) {
    assert(/^track:guid:.+/u.test(trackRefs[id] ?? ""), `layout returned no exact Track ref for ${id}`);
  }

  calls.place_asset = await timed("place_asset", () => callTemplate("macro.media.place_assets", {
    assets: [{ id: "lifecycle_wav", path: options.source_media, position_seconds: 0 }],
    placement: { mode: "explicit" },
    track_policy: "existing_track",
    track_ref: trackRefs.life_source,
    dry_run: false,
  }));
  assertMacroSuccess(calls.place_asset, "macro.media.place_assets");
  const assetChange = calls.place_asset.result?.changes?.find((row) => row.asset_id === "lifecycle_wav");
  const itemRef = assetChange?.live_readback?.item_ref;
  const takeRef = assetChange?.live_readback?.take_ref;
  assert(/^item:guid:.+/u.test(itemRef ?? ""), "Media placement returned no exact Item ref");
  assert(/^take:guid:.+/u.test(takeRef ?? ""), "Media placement returned no exact Take ref");

  const stackInput = {
    mode: "stack_on_existing_tracks",
    track_assignments: [{ item_ref: itemRef, target_track_ref: trackRefs.life_target }],
  };
  calls.item_move_preview = await timed("item_move_preview", () => callTemplate("macro.items.apply", stackInput));
  assert(calls.item_move_preview.ok === true && calls.item_move_preview.execution?.status === "dry_run_completed", "Item move did not default to a no-mutation preview");
  assert(calls.item_move_preview.result?.changes?.[0]?.mutation?.status === "not_run", "Item move preview reported a mutation");
  calls.item_move = await timed("item_move", () => callTemplate("macro.items.apply", { ...stackInput, dry_run: false }));
  assertMacroRows(calls.item_move, "macro.items.apply", 1);
  const itemMove = calls.item_move.result.changes[0];
  assert(itemMove.related_ref === trackRefs.life_target, "Item move did not preserve the exact requested target Track ref");
  assert(itemMove.live_readback?.source === "exact_item_track_readback", "Item move did not use exact Item/Track live readback");

  calls.fx_chain = await timed("fx_chain", () => callTemplate("macro.fx.apply_chain", {
    owner_kind: "track",
    chain: [
      { plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" },
      { plugin_query: "ReaComp", duplicate_policy: "fail_if_present" },
    ],
    dry_run: false,
  }, { track_ref: trackRefs.life_source }));
  assertMacroSuccess(calls.fx_chain, "macro.fx.apply_chain");
  const fxRefs = (calls.fx_chain.result?.data?.final_chain?.fx ?? []).map((row) => row.fx_ref).filter((ref) => /^fx:track:guid:.+:\d+$/u.test(ref));
  assert(fxRefs.length === 2, `Expected two exact FX refs, got ${fxRefs.length}`);

  calls.fx_delete_preview = await timed("fx_delete_preview", () => callTemplate("macro.project.delete_targets", {
    refs: { fx: [...fxRefs].sort(slotAscending) },
    dry_run: true,
    delete_policy: "project_objects_only",
  }));
  assert(calls.fx_delete_preview.ok === true && calls.fx_delete_preview.execution?.status === "dry_run_completed", "FX deletion preview failed");
  const deleteRetry = calls.fx_delete_preview.result?.data?.executable_retry;
  assert(deleteRetry?.id === "macro.project.delete_targets", "FX deletion preview returned no executable retry");
  calls.fx_delete = await timed("fx_delete", () => callTemplate(deleteRetry.id, deleteRetry.input));
  assertMacroRows(calls.fx_delete, "macro.project.delete_targets", 2);
  const deletedFxRefs = calls.fx_delete.result.changes.map((row) => row.live_readback?.observed_ref);
  assert(deletedFxRefs.every((ref) => typeof ref === "string"), "FX deletion lacked row-specific observed refs");
  assert(slotOf(deletedFxRefs[0]) > slotOf(deletedFxRefs[1]), "FX deletion did not execute in descending slot order");
  assert(calls.fx_delete.result.changes.every((row) => row.template_id === "template.fx.delete_fx" && row.live_readback?.source === "accepted_template_live_absence_readback"), "FX deletion rows did not retain accepted native absence readback");

  calls.freeze_fx_chain = await timed("freeze_fx_chain", () => callTemplate("macro.fx.apply_chain", {
    owner_kind: "track",
    chain: [{ plugin_query: "ReaEQ", duplicate_policy: "fail_if_present" }],
    dry_run: false,
  }, { track_ref: trackRefs.life_target }));
  assertMacroSuccess(calls.freeze_fx_chain, "macro.fx.apply_chain freeze fixture");

  calls.glue_item = await timed("glue_item", () => callTemplate("template.items.glue_item", {}, {
    item_ref: exactObjectRef("item", itemRef),
  }));
  assertTemplateSuccess(calls.glue_item, "template.items.glue_item");
  const glue = summaryOf(calls.glue_item);
  assert(glue.source_item_ref === itemRef, "Glue did not echo the exact source Item ref");
  assert(/^item:guid:.+/u.test(glue.glued_item_ref ?? "") && glue.glued_item_ref !== itemRef, "Glue did not return one new Item GUID");
  assert(/^take:guid:.+/u.test(glue.glued_take_ref ?? ""), "Glue did not return one new Take GUID");
  assert(glue.owner_track_ref === trackRefs.life_target, "Glue replacement changed Track ownership");
  assert(valuesMatch(glue.position_seconds, assetChange.live_readback?.position_seconds), "Glue replacement position changed");
  assert(valuesMatch(glue.length_seconds, assetChange.live_readback?.length_seconds), "Glue replacement length changed");
  assert(glue.old_item_guid_absent === true && glue.new_item_unique === true && glue.item_count_unchanged === true, "Glue identity replacement truth failed");
  assert(glue.selection_restored === true && glue.active_take_restored === true, "Glue did not restore selection and active Take state");
  assert(typeof glue.source_filename === "string" && glue.source_filename.length > 0 && typeof glue.source_type === "string", "Glue replacement source was not readable");

  calls.pitch_envelope_first = await timed("pitch_envelope_first", () => callTemplate("template.automation.ensure_take_pitch_envelope", {}, {
    take_ref: exactObjectRef("take", glue.glued_take_ref),
  }));
  assertTemplateSuccess(calls.pitch_envelope_first, "template.automation.ensure_take_pitch_envelope first");
  const pitchFirst = summaryOf(calls.pitch_envelope_first);
  assert(/^envelope:guid:.+/u.test(pitchFirst.envelope_ref ?? ""), "Pitch ensure returned no exact Envelope ref");
  assert(pitchFirst.existing_before === false && pitchFirst.changed === true, "First Pitch ensure did not create a missing envelope");
  assert(pitchFirst.selection_restored === true && pitchFirst.active_take_restored === true, "Pitch ensure did not restore selection and active Take state");

  calls.pitch_envelope_second = await timed("pitch_envelope_second", () => callTemplate("template.automation.ensure_take_pitch_envelope", {}, {
    take_ref: exactObjectRef("take", glue.glued_take_ref),
  }));
  assertTemplateSuccess(calls.pitch_envelope_second, "template.automation.ensure_take_pitch_envelope second");
  const pitchSecond = summaryOf(calls.pitch_envelope_second);
  assert(pitchSecond.envelope_ref === pitchFirst.envelope_ref, "Repeated Pitch ensure changed Envelope identity");
  assert(pitchSecond.existing_before === true && pitchSecond.changed === false, "Repeated Pitch ensure was not an idempotent no-op");

  const itemLength = assetChange.live_readback?.length_seconds;
  assert(Number.isFinite(itemLength) && itemLength > 0, "Media placement returned no positive Item length");
  const pitchEnd = Math.max(0.002, Math.min(itemLength * 0.75, itemLength - 0.001));
  const pitchMid = pitchEnd / 2;
  const pitchPoints = [
    { time_seconds: 0, value: 0, shape: 0, tension: 0, selected: false },
    { time_seconds: pitchMid, value: 3, shape: 0, tension: 0, selected: false },
    { time_seconds: pitchEnd, value: -2, shape: 0, tension: 0, selected: false },
  ];
  calls.pitch_points_insert = await timed("pitch_points_insert", () => callTemplate("template.automation.insert_envelope_points_batch", {
    points: pitchPoints,
  }, { envelope_ref: exactObjectRef("envelope", pitchFirst.envelope_ref) }));
  assertTemplateSuccess(calls.pitch_points_insert, "template.automation.insert_envelope_points_batch Pitch");
  assert(summaryOf(calls.pitch_points_insert).inserted_count === pitchPoints.length, "Pitch point batch insert count mismatch");
  calls.pitch_points_read = await timed("pitch_points_read", () => callTemplate("template.automation.read_envelope_points", {
    autoitem_index: -1,
    start_seconds: 0,
    end_seconds: itemLength,
    limit: 10,
  }, { envelope_ref: exactObjectRef("envelope", pitchFirst.envelope_ref) }));
  assertTemplateSuccess(calls.pitch_points_read, "template.automation.read_envelope_points Pitch");
  const pitchRead = summaryOf(calls.pitch_points_read);
  assert(pitchRead.coverage_status === "complete" && pitchRead.truncated === false, "Pitch point readback was incomplete");
  for (const expected of pitchPoints) {
    assert((pitchRead.points ?? []).some((row) => valuesMatch(row.time_seconds, expected.time_seconds) && valuesMatch(row.value, expected.value)), `Pitch point ${expected.time_seconds}/${expected.value} was not read back`);
  }

  calls.track_channels = await timed("track_channels", () => callTemplate("template.routing.set_track_channel_count", {
    channel_count: 4,
  }, { track_ref: exactObjectRef("track", trackRefs.life_target) }));
  assertTemplateSuccess(calls.track_channels, "template.routing.set_track_channel_count");

  calls.freeze_cycles = [];
  for (const mode of ["mono", "stereo", "multichannel"]) {
    const frozen = await timed(`freeze_${mode}`, () => callTemplate("template.tracks.freeze_track", { mode }, {
      track_ref: exactObjectRef("track", trackRefs.life_target),
    }));
    assertTemplateSuccess(frozen, `template.tracks.freeze_track ${mode}`);
    const frozenSummary = summaryOf(frozen);
    assert(frozenSummary.mode === mode && frozenSummary.freeze_count_after > frozenSummary.freeze_count_before, `${mode} freeze did not increase I_FREEZECOUNT`);
    assert(frozenSummary.selection_restored === true, `${mode} freeze did not restore selection`);

    const unfrozen = await timed(`unfreeze_${mode}`, () => callTemplate("template.tracks.unfreeze_track", {}, {
      track_ref: exactObjectRef("track", trackRefs.life_target),
    }));
    assertTemplateSuccess(unfrozen, `template.tracks.unfreeze_track after ${mode}`);
    const unfrozenSummary = summaryOf(unfrozen);
    assert(unfrozenSummary.freeze_count_before === frozenSummary.freeze_count_after, `${mode} unfreeze did not start from the live frozen count`);
    assert(unfrozenSummary.freeze_count_after < unfrozenSummary.freeze_count_before, `${mode} unfreeze did not decrease I_FREEZECOUNT`);
    assert(unfrozenSummary.selection_restored === true, `${mode} unfreeze did not restore selection`);
    calls.freeze_cycles.push({ mode, freeze: frozen, unfreeze: unfrozen });
  }

  calls.routing_create = await timed("routing_create", () => callTemplate("macro.routing.apply", {
    routes: [
      { id: "send_a", action: "create", source_track_ref: trackRefs.life_source, destination_track_ref: trackRefs.life_send_a },
      { id: "send_b", action: "create", source_track_ref: trackRefs.life_source, destination_track_ref: trackRefs.life_send_b },
    ],
    dry_run: false,
  }));
  assertMacroSuccess(calls.routing_create, "macro.routing.apply");
  const sendRefs = unique((calls.routing_create.result?.changes ?? [])
    .filter((row) => rowUsesTemplate(row, "template.routing.create_track_send"))
    .map((row) => row.target_ref ?? row.live_readback?.observed_ref)
    .filter((ref) => /^send:track:guid:.+:\d+$/u.test(ref)));
  assert(sendRefs.length === 2, `Routing create returned ${sendRefs.length} exact sends instead of 2`);

  calls.routing_delete_preview = await timed("routing_delete_preview", () => callTemplate("macro.routing.apply", {
    routes: sendRefs.map((sendRef, index) => ({ id: `remove_${index + 1}`, action: "delete", send_ref: sendRef })),
  }));
  assert(calls.routing_delete_preview.ok === true && calls.routing_delete_preview.execution?.status === "dry_run_completed", "Routing removal did not default to preview");
  calls.routing_delete = await timed("routing_delete", () => callTemplate("macro.routing.apply", {
    routes: sendRefs.map((sendRef, index) => ({ id: `remove_${index + 1}`, action: "delete", send_ref: sendRef })),
    dry_run: false,
  }));
  assertMacroRows(calls.routing_delete, "macro.routing.apply", 2);
  const routingDeleteWriteStage = calls.routing_delete.execution?.stages?.find((stage) => stage.id === "routing-apply-write");
  calls.routing_delete_write_refs = await readBridgeRequestRefs(routingDeleteWriteStage?.evidence_refs, "send");
  assert(calls.routing_delete_write_refs.length === 2, "Internal send removal exposed no exact write-stage request evidence");
  assert(slotOf(calls.routing_delete_write_refs[0]) > slotOf(calls.routing_delete_write_refs[1]), "Internal send removal did not dispatch in descending source-slot order");
  assert(sameStringSet(calls.routing_delete_write_refs, sendRefs), "Internal send removal write evidence did not match the created Sends");
  const deletedSendRefs = calls.routing_delete.result.changes.map((row) => row.live_readback?.observed_ref);
  assert(sameStringSet(deletedSendRefs, sendRefs), "Internal send removal rows did not read back absence for the exact created Sends");
  assert(calls.routing_delete.result.changes.every((row) => rowUsesTemplate(row, "template.routing.remove_send") && row.live_readback?.source === "live_track_routing_readback"), "Internal send removal rows lacked exact live routing absence readback");

  calls.save = await timed("save", () => callTemplate("macro.project.file", { operation: "save_current", dry_run: false }));
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
  source_media_sha256: await sha256(options.source_media),
  source_media_size: (await stat(options.source_media)).size,
};
const generatedMedia = await listGeneratedMedia(options.evidence_root, new Set([
  path.resolve(options.source_media),
]));
const report = {
  contract: "alpha3.3.lifecycle_macros_live.v1",
  ok: error === null,
  evidence_root: options.evidence_root,
  source_project: options.source_project,
  active_test_project: options.project_path,
  transport_dir: options.transport_dir,
  bridge: { owner: options.bridge_owner, generation: options.bridge_generation },
  runtime: {
    source: options.mcp_command ? "installed_wrapper" : "source_stdio",
    command: MCP_COMMAND,
    args: MCP_ARGS,
    cwd: MCP_CWD,
    bridge_script: BRIDGE_SCRIPT,
    artifact_root: ARTIFACT_ROOT,
    render_root: RENDER_ROOT,
  },
  public_budget: PUBLIC_BUDGET,
  timings_ms: timings,
  tests: {
    visible_macro_count: calls.ping?.product_surface?.agent_context_macro_guide?.macro_menu?.macro_ids?.length ?? null,
    item_move_preview: outcome(calls.item_move_preview),
    item_move: outcome(calls.item_move),
    fx_delete_preview: outcome(calls.fx_delete_preview),
    fx_delete: outcome(calls.fx_delete),
    routing_delete_preview: outcome(calls.routing_delete_preview),
    routing_delete: outcome(calls.routing_delete),
    glue: templateOutcome(calls.glue_item),
    pitch_ensure_first: templateOutcome(calls.pitch_envelope_first),
    pitch_ensure_second: templateOutcome(calls.pitch_envelope_second),
    pitch_points_insert: templateOutcome(calls.pitch_points_insert),
    pitch_points_read: templateOutcome(calls.pitch_points_read),
    freeze_cycles: calls.freeze_cycles?.map((cycle) => ({
      mode: cycle.mode,
      freeze: templateOutcome(cycle.freeze),
      unfreeze: templateOutcome(cycle.unfreeze),
      freeze_counts: {
        before: summaryOf(cycle.freeze).freeze_count_before,
        frozen: summaryOf(cycle.freeze).freeze_count_after,
        restored: summaryOf(cycle.unfreeze).freeze_count_after,
      },
    })) ?? [],
  },
  project_changes: {
    tracks_created: calls.layout?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    source_media_imported: calls.place_asset?.ok === true,
    item_moved_to_existing_track: calls.item_move?.ok === true,
    item_glued: calls.glue_item?.ok === true,
    pitch_envelope_created: summaryOf(calls.pitch_envelope_first).changed === true,
    pitch_envelope_idempotent_reuse: summaryOf(calls.pitch_envelope_second).changed === false,
    pitch_points_written: summaryOf(calls.pitch_points_insert).inserted_count ?? 0,
    freeze_modes_completed: calls.freeze_cycles?.length ?? 0,
    unfreeze_modes_completed: calls.freeze_cycles?.filter((cycle) => cycle.unfreeze?.ok === true).length ?? 0,
    fx_created: calls.fx_chain?.result?.data?.final_chain?.fx?.length ?? 0,
    fx_deleted: calls.fx_delete?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    internal_sends_created: calls.routing_create?.result?.changes?.filter((row) => rowUsesTemplate(row, "template.routing.create_track_send") && row.status === "applied").length ?? 0,
    internal_sends_deleted: calls.routing_delete?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    saved_to_evidence_copy: calls.save?.ok === true,
  },
  rendered_files: generatedMedia,
  recovery_backup_posture: {
    backup_project: options.backup_project,
    backup_exists: await exists(options.backup_project),
    source_hash_unchanged: before.source_sha256 === after.source_sha256,
    source_project_not_mutated_on_disk: before.source_sha256 === after.source_sha256,
    evidence_copy_preserved: await exists(options.project_path),
    source_media_hash_unchanged: before.source_media_sha256 === after.source_media_sha256,
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
    command: MCP_COMMAND,
    args: MCP_ARGS,
    cwd: MCP_CWD,
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: BRIDGE_SCRIPT,
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "300000",
      OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation),
      OPENREAPER_LIVE_BRIDGE_SESSION_ID: "alpha33-lifecycle-live",
      OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: RENDER_ROOT,
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

function assertTemplateSuccess(value, id) {
  assert(value?.contract === "template.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value.verification?.status === "passed" || value.result?.verification?.status === "passed", `${id} verification did not pass`);
  assert(value.budget?.truncated !== true, `${id} result was truncated`);
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

function templateOutcome(value) {
  return value ? {
    ok: value.ok,
    template_id: value.template?.id ?? value.id ?? null,
    verification_status: value.verification?.status ?? value.result?.verification?.status ?? null,
    response_bytes: value.budget?.actual_bytes ?? null,
    summary: summaryOf(value),
  } : null;
}

function summaryOf(value) {
  return value?.result?.summary ?? value?.result?.readback ?? value?.result?.data ?? {};
}

function exactObjectRef(kind, ref) {
  const prefix = `${kind}:`;
  assert(typeof ref === "string" && ref.startsWith(prefix), `Invalid ${kind} ref ${ref}`);
  const remainder = ref.slice(prefix.length);
  const separator = remainder.indexOf(":");
  assert(separator > 0, `Invalid ${kind} ref ${ref}`);
  return {
    kind,
    ref,
    identity: {
      scheme: remainder.slice(0, separator),
      value: remainder.slice(separator + 1),
    },
  };
}

async function timed(label, operation) {
  const startedAt = performance.now();
  try {
    return await operation();
  } finally {
    timings[label] = Number((performance.now() - startedAt).toFixed(3));
  }
}

async function listGeneratedMedia(root, excludedPaths) {
  const extensions = new Set([".wav", ".wave", ".aif", ".aiff", ".flac", ".ogg", ".mp3", ".reapeaks"]);
  const rows = [];
  await walk(path.resolve(root));
  return rows.sort((left, right) => left.path.localeCompare(right.path));

  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const absolute = path.join(directory, entry.name);
      if (entry.isDirectory()) await walk(absolute);
      else if (entry.isFile() && extensions.has(path.extname(entry.name).toLowerCase()) && !excludedPaths.has(path.resolve(absolute))) {
        const facts = await stat(absolute);
        rows.push({
          path: absolute,
          bytes: facts.size,
          sha256: await sha256(absolute),
        });
      }
    }
  }
}

async function readBridgeRequestRefs(requestIds, kind) {
  const refs = [];
  for (const requestId of requestIds ?? []) {
    const request = JSON.parse(await readFile(path.join(options.transport_dir, "requests", `${requestId}.json`), "utf8"));
    const ref = request.refs?.find((entry) => entry?.kind === kind)?.ref;
    if (typeof ref === "string") refs.push(ref);
  }
  return refs;
}

function slotAscending(left, right) { return slotOf(left) - slotOf(right); }
function slotOf(ref) { return Number(String(ref).slice(String(ref).lastIndexOf(":") + 1)); }
function rowUsesTemplate(row, id) { return row?.template_id === id || row?.template_ids?.includes(id) === true; }
function unique(values) { return [...new Set(values)]; }
function sameStringSet(left, right) { return left.length === right.length && left.every((value) => right.includes(value)); }
function valuesMatch(actual, expected) {
  return Number.isFinite(actual)
    && Number.isFinite(expected)
    && Math.abs(actual - expected) <= 0.000001;
}
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
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--render-root") result.render_root = path.resolve(value);
    else if (key === "--mcp-command") result.mcp_command = path.resolve(value);
    else if (key === "--source-media") result.source_media = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  result.bridge_owner ??= "openreaper-alpha3-local";
  result.bridge_generation ??= 1;
  const required = ["evidence_root", "source_project", "project_path", "backup_project", "transport_dir", "source_media"];
  if (required.some((key) => !result[key]) || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-lifecycle-macros.mjs --evidence-root <root> --source-project <source.RPP> --project-path <active-copy.RPP> --backup-project <backup.RPP> --transport-dir <transport> --source-media <audio-file> [--artifact-root <bridge-artifacts>] [--render-root <renders>] [--mcp-command <installed-openreaper-mcp>] [--bridge-owner owner] [--bridge-generation n]");
  }
  return result;
}
