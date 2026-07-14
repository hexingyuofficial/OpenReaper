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
const PROJECT = options.project_path;
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Automation-fixture-before.RPP");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-b1d-automation-apply-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const INDEX_ROOT = path.join(ROOT, "automation-project-index-state");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const RENDER_ROOT = path.join(ROOT, "renders");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };
const SMALL_INVENTORY_BUDGET = { max_response_bytes: 65_536, max_items: 1, max_inline_value_bytes: 2_048 };

await Promise.all([
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.dirname(REPORT_PATH), { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
  mkdir(path.join(options.transport_dir, "requests"), { recursive: true }),
  mkdir(path.join(options.transport_dir, "results"), { recursive: true }),
]);
await copyFile(PROJECT, BACKUP_PROJECT);

const before = {
  project_sha256: await sha256(PROJECT),
  project_size: (await stat(PROJECT)).size,
  recovery_backup_sha256: await sha256(BACKUP_PROJECT),
};
const calls = {};
const clients = [];
let error = null;

try {
  const clientA = await connect("alpha33-b1d-client-a", "alpha33-b1d-shared");
  clients.push(clientA);
  calls.ping = await callTool(clientA, "ping", {});
  calls.menu = await callTool(clientA, "list_templates", {});
  calls.manual = await callTool(clientA, "list_templates", { ids: ["macro.automation.apply"], fields: ["id"] });
  assertPublicSurface(calls);

  calls.cold_page = await queryAutomation(clientA, { limit: 2, refresh_policy: "if_stale" });
  assertMacroSuccess(calls.cold_page, "macro.project.query cold Automation hydration");
  assertCoverageAtLeast(calls.cold_page, 14, 2);
  assert(calls.cold_page.result?.data?.refresh?.logical_refresh?.coverage?.automation === "complete", "Automation logical refresh did not commit complete coverage");
  assert(calls.cold_page.result?.data?.refresh?.logical_refresh?.row_counts?.automation === calls.cold_page.result?.data?.coverage?.known_total_row_count, "Automation logical refresh row count did not match complete coverage");

  calls.inventory_pages = await readInventoryPages(clientA);
  const inventoryRows = calls.inventory_pages.flatMap((page) => page.result?.summary?.envelopes ?? []);
  const trackRows = inventoryRows.filter((row) => row.parent_kind === "track" && row.envelope_type === "volume");
  assert(trackRows.length >= 14, `Expected at least 14 Track Volume Envelopes, got ${trackRows.length}`);
  assert(trackRows.every((row) => row.identity_kind === "guid" && /^envelope:guid:.+/u.test(row.envelope_ref)), "Inventory returned a non-GUID primary Envelope ref");
  assert(new Set(trackRows.map((row) => row.envelope_ref)).size === trackRows.length, "Inventory returned duplicate Envelope refs");
  const trackItemReads = [];
  for (const row of trackRows) {
    const read = await readAutomationItems(clientA, row.envelope_ref);
    trackItemReads.push({ row, read });
  }
  calls.track_automation_items_before = trackItemReads.map(({ row, read }) => ({ envelope_ref: row.envelope_ref, summary: read.result?.summary }));
  const targetEntry = trackItemReads.find(({ read }) => (read.result?.summary?.items?.length ?? 0) > 0);
  assert(targetEntry, "No Track Volume Envelope exposed an existing Automation Item deletion target");
  const target = targetEntry.row;
  assert(/^track:guid:.+/u.test(target.owner_ref), `Target owner is not a Track GUID: ${target.owner_ref}`);

  const takeItemObject = await resolveItemObject(clientA, options.take_item_ref);
  calls.take_item_before = await readItemSummary(clientA, takeItemObject);
  const takeSummaryBefore = calls.take_item_before.result?.summary;
  assert(Number.isFinite(takeSummaryBefore?.position_seconds) && takeSummaryBefore.position_seconds > 0, "Take fixture Item must start at a non-zero project position");
  assert(/^take:guid:.+/u.test(takeSummaryBefore?.active_take_ref ?? ""), "Take fixture returned no exact Active Take GUID");
  const takeRef = takeSummaryBefore.active_take_ref;
  const takePanRow = inventoryRows.find((row) => row.parent_kind === "take" && row.owner_ref === takeRef && row.envelope_type === "pan");
  assert(takePanRow, `Prepared Take ${takeRef} has no ordinary Pan Envelope; create it in the disposable fixture before this run`);

  const masterOwnerRef = inventoryRows.find((row) => row.parent_kind === "track" && row.name === "Tempo map")?.owner_ref;
  assert(/^track:guid:.+/u.test(masterOwnerRef ?? ""), "Automation inventory returned no exact Master Track identity through the Tempo map Envelope");
  const masterRows = inventoryRows.filter((row) => row.parent_kind === "track" && row.owner_ref === masterOwnerRef);
  assert(masterRows.length > 0, "Automation inventory returned no Master Track Envelope");

  calls.exact_final_ref = await queryAutomation(clientA, {
    limit: 1,
    refresh_policy: "never",
    selectors: { refs: [target.envelope_ref] },
  });
  assertMacroSuccess(calls.exact_final_ref, "macro.project.query exact final Envelope ref");
  assert(calls.exact_final_ref.result?.data?.rows?.[0]?.ref === target.envelope_ref, "Exact final Envelope ref did not resolve from SQLite");

  calls.warm_final_ref = await queryAutomation(clientA, {
    limit: 1,
    refresh_policy: "if_stale",
    selectors: { refs: [target.envelope_ref] },
  });
  assertMacroSuccess(calls.warm_final_ref, "macro.project.query warm Automation reuse");
  assert(calls.warm_final_ref.sqlite?.source === "warm_index", `Expected warm_index, got ${calls.warm_final_ref.sqlite?.source}`);

  const clientB = await connect("alpha33-b1d-client-b", "alpha33-b1d-peer");
  clients.push(clientB);
  calls.client_b_force = await queryAutomation(clientB, {
    limit: 1,
    refresh_policy: "force_read_only_refresh",
    selectors: { refs: [target.envelope_ref] },
  });
  assertMacroSuccess(calls.client_b_force, "macro.project.query second client");
  assert(calls.client_b_force.result?.data?.rows?.[0]?.ref === target.envelope_ref, "Second client did not independently hydrate the final Envelope");

  calls.set_take_playrate = await callTemplate(clientA, "template.items.set_take_playrate", {
    playrate: 2,
    preserve_pitch: true,
  }, { item_ref: takeItemObject });
  assertTemplateSuccess(calls.set_take_playrate, "template.items.set_take_playrate");
  assert(valuesMatch(calls.set_take_playrate.result?.summary?.playrate, 2), "Take playrate did not read back at 2x");

  calls.points_before = await readPoints(clientA, target.envelope_ref);
  const beforePoints = pointRows(calls.points_before);

  const insertedPoints = [
    point(30, 0.2),
    point(31, 0.4),
    point(32, 0.6),
    point(33, 0.8),
    point(34, 1),
  ];
  calls.insert_preview = await callTemplate(clientA, "macro.automation.apply", {
    mode: "insert_points",
    envelope_refs: [target.envelope_ref],
    points: insertedPoints,
  });
  assertDryRun(calls.insert_preview, "insert_points");
  calls.points_after_preview = await readPoints(clientA, target.envelope_ref);
  assert(JSON.stringify(pointRows(calls.points_after_preview)) === JSON.stringify(beforePoints), "Default dry-run changed existing Envelope points");

  calls.insert_points = await callTemplate(clientA, "macro.automation.apply", {
    mode: "insert_points",
    envelope_refs: [target.envelope_ref],
    points: insertedPoints,
    dry_run: false,
  });
  assertAutomationSuccess(calls.insert_points, "insert_points");
  assert(calls.insert_points.result?.changes?.[0]?.live_readback?.inserted_count === insertedPoints.length, "Inserted point count was not independently read back");
  calls.points_after_insert = await readPoints(clientA, target.envelope_ref);
  const updateTarget = requirePointAt(calls.points_after_insert, 31, "inserted update target");

  calls.update_point = await callTemplate(clientA, "macro.automation.apply", {
    mode: "update_point",
    envelope_refs: [target.envelope_ref],
    point_update: { autoitem_index: -1, point_index: updateTarget.point_index, value: 0.45 },
    dry_run: false,
  });
  assertAutomationSuccess(calls.update_point, "update_point");

  calls.lane_state = await callTemplate(clientA, "macro.automation.apply", {
    mode: "set_lane_state",
    envelope_refs: [target.envelope_ref],
    lane_state: { active: true, visible: true, show_lane: true, armed: false },
    dry_run: false,
  });
  assertAutomationSuccess(calls.lane_state, "set_lane_state");

  calls.track_mode = await callTemplate(clientA, "macro.automation.apply", {
    mode: "set_track_mode",
    track_refs: [target.owner_ref],
    track_mode: "read",
    dry_run: false,
  });
  assertAutomationSuccess(calls.track_mode, "set_track_mode");

  calls.create_automation_item = await callTemplate(clientA, "macro.automation.apply", {
    mode: "create_automation_item",
    envelope_refs: [target.envelope_ref],
    automation_item: { position_seconds: 40, length_seconds: 2, pool_mode: "new_empty" },
    dry_run: false,
  });
  assertAutomationSuccess(calls.create_automation_item, "create_automation_item");
  const automationItemIndex = calls.create_automation_item.result?.changes?.[0]?.live_readback?.automation_item_index;
  assert(Number.isInteger(automationItemIndex), "Automation Item creation returned no exact live index");

  calls.set_automation_item_bounds = await callTemplate(clientA, "macro.automation.apply", {
    mode: "set_automation_item_bounds",
    envelope_refs: [target.envelope_ref],
    automation_item_bounds: { automation_item_index: automationItemIndex, position_seconds: 40.5, length_seconds: 1.5, start_offset_seconds: 0.25, playrate: 1.25 },
    dry_run: false,
  });
  assertAutomationSuccess(calls.set_automation_item_bounds, "set_automation_item_bounds");

  const takeProjectTime = takeSummaryBefore.position_seconds + 0.5;
  calls.insert_take_points = await callTemplate(clientA, "macro.automation.apply", {
    mode: "insert_take_points",
    envelope_refs: [takePanRow.envelope_ref],
    points: [point(takeProjectTime, -0.25)],
    dry_run: false,
  });
  assertAutomationSuccess(calls.insert_take_points, "insert_take_points compatibility alias");
  calls.take_points_after = await readPoints(clientA, takePanRow.envelope_ref);
  assert(calls.take_points_after.result?.summary?.time_basis === "project", "Ordinary Take Envelope readback did not declare project time");
  const takePoint = requirePointAt(calls.take_points_after, takeProjectTime, "ordinary Take Pan project-time point");
  assert(valuesMatch(takePoint.value, -0.25), `Ordinary Take Pan value=${takePoint.value}`);

  calls.add_track_fx = await callTemplate(clientA, "template.fx.add_track_fx", {
    plugin_name: "ReaEQ (Cockos)",
  }, { track_ref: trackObjectRef(target.owner_ref) });
  assertTemplateSuccess(calls.add_track_fx, "template.fx.add_track_fx");
  const trackFxRef = requireResultRef(calls.add_track_fx, "fx", "Track FX add");
  calls.track_fx_mapping_before = await readFxMapping(clientA, trackFxRef, 0);
  assert(calls.track_fx_mapping_before.result?.summary?.envelope_exists === false, "Track-FX parameter Envelope unexpectedly existed before create-path smoke");
  const trackParamIdent = calls.track_fx_mapping_before.result?.summary?.param_ident;
  assert(typeof trackParamIdent === "string" && trackParamIdent.length > 0, "Track-FX mapping returned no actual param_ident");
  calls.track_fx_create = await insertFxPoints(clientA, trackFxRef, trackParamIdent, [point(35, 0.25)]);
  assertAutomationSuccess(calls.track_fx_create, "Track-FX Envelope create path");
  assert(calls.track_fx_create.result?.changes?.[0]?.live_readback?.created_envelope === true, "Track-FX create path did not report created_envelope=true");
  calls.track_fx_existing = await insertFxPoints(clientA, trackFxRef, trackParamIdent, [point(36, 0.75)]);
  assertAutomationSuccess(calls.track_fx_existing, "Track-FX Envelope existing path");
  assert(calls.track_fx_existing.result?.changes?.[0]?.live_readback?.created_envelope === false, "Track-FX existing path did not report created_envelope=false");

  calls.add_take_fx = await callTemplate(clientA, "template.fx.add_take_fx", {
    plugin_name: "ReaEQ (Cockos)",
  }, { take_ref: takeObjectRef(takeRef) });
  assertTemplateSuccess(calls.add_take_fx, "template.fx.add_take_fx");
  const takeFxRef = requireResultRef(calls.add_take_fx, "fx", "Take FX add");
  calls.take_fx_mapping_before = await readFxMapping(clientA, takeFxRef, 0);
  assert(calls.take_fx_mapping_before.result?.summary?.envelope_exists === false, "Take-FX parameter Envelope unexpectedly existed before create-path smoke");
  const takeParamIdent = calls.take_fx_mapping_before.result?.summary?.param_ident;
  assert(typeof takeParamIdent === "string" && takeParamIdent.length > 0, "Take-FX mapping returned no actual param_ident");
  calls.take_fx_create = await insertFxPoints(clientA, takeFxRef, takeParamIdent, [point(takeSummaryBefore.position_seconds + 0.75, 0.3)]);
  assertAutomationSuccess(calls.take_fx_create, "Take-FX Envelope create path");
  assert(calls.take_fx_create.result?.changes?.[0]?.live_readback?.created_envelope === true, "Take-FX create path did not report created_envelope=true");
  calls.take_fx_existing = await insertFxPoints(clientA, takeFxRef, takeParamIdent, [point(takeSummaryBefore.position_seconds + 1, 0.7)]);
  assertAutomationSuccess(calls.take_fx_existing, "Take-FX Envelope existing path");
  assert(calls.take_fx_existing.result?.changes?.[0]?.live_readback?.created_envelope === false, "Take-FX existing path did not report created_envelope=false");

  let masterSentinel = null;
  for (const row of masterRows) {
    const read = await readAutomationItems(clientA, row.envelope_ref);
    const selected = (read.result?.summary?.items ?? []).find((item) => item.selected === true);
    if (selected) {
      masterSentinel = { envelope: row, item: selected };
      calls.master_items_before_delete = read;
      break;
    }
  }
  if (!masterSentinel) {
    const masterEnvelope = masterRows.find((row) => row.envelope_type === "volume") ?? masterRows[0];
    calls.master_lane_state = await callTemplate(clientA, "macro.automation.apply", {
      mode: "set_lane_state",
      envelope_refs: [masterEnvelope.envelope_ref],
      lane_state: { active: true, visible: true, show_lane: true, armed: false },
      dry_run: false,
    });
    assertAutomationSuccess(calls.master_lane_state, "activate Master sentinel Envelope");
    calls.create_master_sentinel = await callTemplate(clientA, "macro.automation.apply", {
      mode: "create_automation_item",
      envelope_refs: [masterEnvelope.envelope_ref],
      automation_item: { position_seconds: 45, length_seconds: 2, pool_mode: "new_empty" },
      dry_run: false,
    });
    assertAutomationSuccess(calls.create_master_sentinel, "create Master sentinel Automation Item");
    calls.master_items_before_delete = await readAutomationItems(clientA, masterEnvelope.envelope_ref);
    const selected = (calls.master_items_before_delete.result?.summary?.items ?? []).find((item) => item.selected === true);
    assert(selected, "Created Master Automation Item is not selected; select it in the disposable fixture and rerun from a fresh evidence root");
    masterSentinel = { envelope: masterEnvelope, item: selected };
  }

  calls.delete_automation_item_preview = await callTemplate(clientA, "macro.automation.apply", {
    mode: "delete_automation_item",
    envelope_refs: [target.envelope_ref],
    automation_item_delete: { automation_item_index: automationItemIndex },
  });
  const automationItemRetry = requireConfirmationRetry(calls.delete_automation_item_preview, "delete_automation_item preview");
  calls.delete_automation_item = await callTemplate(clientA, automationItemRetry.id, automationItemRetry.input);
  assertAutomationSuccess(calls.delete_automation_item, "delete_automation_item");
  assert(calls.delete_automation_item.result?.changes?.[0]?.live_readback?.target_absent === true, "Automation Item deletion did not prove target absence");
  calls.master_items_after_delete = await readAutomationItems(clientA, masterSentinel.envelope.envelope_ref);
  const masterAfter = (calls.master_items_after_delete.result?.summary?.items ?? []).find((item) => automationItemsEqual(item, masterSentinel.item));
  assert(masterAfter?.selected === true, "Master selected Automation Item sentinel was not restored after Action 42086");

  calls.points_before_delete_preview = await readPoints(clientA, target.envelope_ref);
  const staleDeleteTarget = requirePointAt(calls.points_before_delete_preview, 30, "stale-token delete target");
  calls.delete_preview_stale = await callTemplate(clientA, "macro.automation.apply", {
    mode: "delete_point",
    envelope_refs: [target.envelope_ref],
    point_delete: { autoitem_index: -1, point_index: staleDeleteTarget.point_index },
  });
  assertDryRun(calls.delete_preview_stale, "delete_point");
  const staleRetry = requireConfirmationRetry(calls.delete_preview_stale, "delete_point stale preview");

  calls.insert_token_staler = await callTemplate(clientA, "macro.automation.apply", {
    mode: "insert_points",
    envelope_refs: [target.envelope_ref],
    points: [point(30.5, 0.3)],
    dry_run: false,
  });
  assertAutomationSuccess(calls.insert_token_staler, "insert token-staling point");
  calls.stale_token_block = await callTemplate(clientA, staleRetry.id, staleRetry.input);
  assert(calls.stale_token_block?.ok === false && calls.stale_token_block?.error?.code === "AUTOMATION_CONFIRMATION_TOKEN_STALE", `Stale token returned ${calls.stale_token_block?.error?.code}`);
  assert((calls.stale_token_block?.result?.changes?.length ?? 0) === 0, "Stale token returned mutation rows");

  calls.points_before_delete = await readPoints(clientA, target.envelope_ref);
  const deleteTarget = requirePointAt(calls.points_before_delete, 30, "confirmed delete target");
  calls.delete_point_preview = await callTemplate(clientA, "macro.automation.apply", {
    mode: "delete_point",
    envelope_refs: [target.envelope_ref],
    point_delete: { autoitem_index: -1, point_index: deleteTarget.point_index },
  });
  const pointRetry = requireConfirmationRetry(calls.delete_point_preview, "delete_point preview");
  calls.delete_point = await callTemplate(clientA, pointRetry.id, pointRetry.input);
  assertAutomationSuccess(calls.delete_point, "delete_point");

  calls.range_preview = await callTemplate(clientA, "macro.automation.apply", {
    mode: "delete_point_range",
    envelope_refs: [target.envelope_ref],
    point_range: { autoitem_index: -1, start_seconds: 32, end_seconds: 34 },
  });
  const rangeRetry = requireConfirmationRetry(calls.range_preview, "delete_point_range preview");
  calls.delete_range = await callTemplate(clientA, rangeRetry.id, rangeRetry.input);
  assertAutomationSuccess(calls.delete_range, "delete_point_range");

  calls.points_final = await readPoints(clientA, target.envelope_ref);
  const finalPoints = pointRows(calls.points_final);
  assert(finalPoints.every((row) => row.time_seconds < 32 || row.time_seconds >= 34), "A point remained in the deleted half-open range");
  assert(finalPoints.some((row) => valuesMatch(row.time_seconds, 34)), "The point exactly at end_seconds=34 was not preserved");

  calls.stale_index = await queryAutomation(clientA, {
    limit: 1,
    refresh_policy: "never",
    selectors: { refs: [target.envelope_ref] },
  });
  assert(calls.stale_index?.ok === false && calls.stale_index?.error?.code === "INDEX_REFRESH_REQUIRED", `Stale navigation query returned ${calls.stale_index?.error?.code}`);
  assert(calls.stale_index.result?.data?.freshness?.status === "stale", `Write invalidation did not mark Automation stale: ${calls.stale_index.result?.data?.freshness?.status}`);
  assert((calls.stale_index.result?.data?.rows?.length ?? -1) === 0, "Stale refresh_policy=never query exposed candidate rows");
  assert(calls.stale_index.result?.data?.coverage?.indexed_row_count === inventoryRows.length, "Write invalidation discarded internal Automation navigation knowledge");

  calls.refreshed_index = await queryAutomation(clientA, {
    limit: 1,
    refresh_policy: "if_stale",
    selectors: { refs: [target.envelope_ref] },
  });
  assertMacroSuccess(calls.refreshed_index, "macro.project.query post-write refresh");
  assert(calls.refreshed_index.result?.data?.rows?.[0]?.point_count === finalPoints.length, "Refreshed SQLite point count did not match live REAPER");

  calls.save_current = await callTemplate(clientA, "macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "macro.project.file save_current");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  for (const client of clients.reverse()) {
    try { await client.close(); } catch {}
  }
}

const after = {
  project_exists: await exists(PROJECT),
  project_sha256: await exists(PROJECT) ? await sha256(PROJECT) : null,
  project_size: await exists(PROJECT) ? (await stat(PROJECT)).size : null,
};
const report = {
  contract: "alpha3.3.b1d.automation_apply_live.v1",
  ok: error === null,
  evidence_root: ROOT,
  active_test_project: PROJECT,
  transport: { directory: options.transport_dir, owner: options.bridge_owner, generation: options.bridge_generation },
  budgets: { default: PUBLIC_BUDGET, inventory_page: SMALL_INVENTORY_BUDGET },
  fixture_precondition: {
    description: "The disposable seed retains at least fourteen existing Track Volume Envelopes plus one ordinary Take Pan Envelope on the exact take_item_ref; the Item starts after zero seconds.",
    product_capability_claimed: false,
    reason: "REAPER exposes no accepted native create route for ordinary Track/Take Pan Envelopes. The pre-existing Take Pan lane is fixture setup only; all writes and readback use public OpenReaper paths.",
    take_item_ref: options.take_item_ref,
  },
  tests: {
    visible_macro_count: calls.menu?.items?.filter((item) => item.action_kind === "macro").length ?? null,
    automation_apply_visible: calls.menu?.items?.some((item) => item.id === "macro.automation.apply") ?? false,
    exact_manual_runnable: calls.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0]?.runnable ?? false,
    inventory_page_count: calls.inventory_pages?.length ?? 0,
    inventory_total_count: calls.inventory_pages?.[0]?.result?.summary?.total_count ?? null,
    cold_hydration: calls.cold_page?.sqlite?.source ?? null,
    warm_reuse: calls.warm_final_ref?.sqlite?.source ?? null,
    dual_client: calls.client_b_force?.ok === true,
    exact_final_ref: calls.exact_final_ref?.result?.data?.rows?.[0]?.ref ?? null,
    stale_after_write: calls.stale_index?.result?.data?.freshness?.status ?? null,
    stale_query_error: calls.stale_index?.error?.code ?? null,
    refreshed_point_count: calls.refreshed_index?.result?.data?.rows?.[0]?.point_count ?? null,
    stale_token_error: calls.stale_token_block?.error?.code ?? null,
    take_item_position_seconds: calls.take_item_before?.result?.summary?.position_seconds ?? null,
    take_playrate_readback: calls.set_take_playrate?.result?.summary?.playrate ?? null,
    take_time_basis: calls.take_points_after?.result?.summary?.time_basis ?? null,
    take_pan_project_time: pointRows(calls.take_points_after).find((row) => valuesMatch(row.time_seconds, (calls.take_item_before?.result?.summary?.position_seconds ?? 0) + 0.5))?.time_seconds ?? null,
    track_fx_create_then_existing: [calls.track_fx_create, calls.track_fx_existing].map((value) => value?.result?.changes?.[0]?.live_readback?.created_envelope ?? null),
    take_fx_create_then_existing: [calls.take_fx_create, calls.take_fx_existing].map((value) => value?.result?.changes?.[0]?.live_readback?.created_envelope ?? null),
    automation_item_deleted: calls.delete_automation_item?.result?.changes?.[0]?.live_readback?.target_absent ?? false,
    master_selected_ai_preserved: (calls.master_items_after_delete?.result?.summary?.items ?? []).some((item) => item.selected === true),
    initial_point_count: pointRows(calls.points_before).length,
    half_open_end_preserved: pointRows(calls.points_final).some((row) => valuesMatch(row.time_seconds, 34)),
    final_points: pointRows(calls.points_final),
  },
  project_changes: {
    point_insert_rows: appliedCount(calls.insert_points) + appliedCount(calls.insert_token_staler),
    point_update_rows: appliedCount(calls.update_point),
    lane_state_rows: appliedCount(calls.lane_state),
    track_mode_rows: appliedCount(calls.track_mode),
    automation_item_create_rows: appliedCount(calls.create_automation_item),
    master_lane_state_rows: appliedCount(calls.master_lane_state),
    master_sentinel_create_rows: appliedCount(calls.create_master_sentinel),
    automation_item_bounds_rows: appliedCount(calls.set_automation_item_bounds),
    automation_item_delete_rows: appliedCount(calls.delete_automation_item),
    take_point_insert_rows: appliedCount(calls.insert_take_points),
    track_fx_point_rows: appliedCount(calls.track_fx_create) + appliedCount(calls.track_fx_existing),
    take_fx_point_rows: appliedCount(calls.take_fx_create) + appliedCount(calls.take_fx_existing),
    point_delete_rows: appliedCount(calls.delete_point),
    range_delete_rows: appliedCount(calls.delete_range),
    stale_token_mutation_rows: calls.stale_token_block?.result?.changes?.length ?? null,
    saved: calls.save_current?.ok === true,
  },
  rendered_files: [],
  recovery_backup_posture: {
    project_backup: BACKUP_PROJECT,
    evidence_project_preserved: after.project_exists,
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

async function connect(name, logicalSessionKey) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: process.execPath,
    args: [STDIO],
    cwd: REPO,
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
      OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation),
      OPENREAPER_CURRENT_PROJECT_PATH: PROJECT,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: INDEX_ROOT,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: logicalSessionKey,
      OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: RENDER_ROOT,
    },
  }));
  return client;
}

async function readInventoryPages(client) {
  const pages = [];
  let cursor = null;
  for (let index = 0; index < 4_096; index += 1) {
    const page = await callTemplate(client, "template.automation.list_project_envelopes", {
      parent_kinds: ["track", "take", "send", "fx"],
      limit: 1,
      ...(cursor ? { cursor } : {}),
    }, undefined, SMALL_INVENTORY_BUDGET);
    assertTemplateSuccess(page, "template.automation.list_project_envelopes");
    const summary = page.result?.summary ?? {};
    const publicProjectionBytes = Buffer.byteLength(JSON.stringify({
      envelopes: summary.envelopes,
      envelope_refs: summary.envelope_refs,
      returned_count: summary.returned_count,
      total_count: summary.total_count,
      next_cursor: summary.next_cursor,
      truncated: summary.truncated,
      coverage_status: summary.coverage_status,
      coverage: summary.coverage,
    }), "utf8");
    assert(publicProjectionBytes < 2_048, `Inventory public projection exceeded 2 KiB: ${publicProjectionBytes}`);
    pages.push(page);
    cursor = page.result?.summary?.next_cursor;
    if (cursor === null || cursor === undefined) {
      assert(page.result?.summary?.coverage_status === "complete", `Terminal inventory coverage=${page.result?.summary?.coverage_status}`);
      assert(page.result?.summary?.coverage?.internally_complete === true, "Terminal inventory did not prove complete internal coverage");
      return pages;
    }
  }
  throw new Error("Inventory pagination exceeded the safety bound");
}

async function queryAutomation(client, { limit, refresh_policy, selectors = undefined }) {
  return callTemplate(client, "macro.project.query", {
    entity: "automation",
    fields: ["ref", "owner_ref", "parent_kind", "name", "lane_kind", "visible", "point_count", "freshness_status", "coverage_status"],
    limit,
    refresh_policy,
    ...(selectors ? { selectors } : {}),
  });
}

async function readPoints(client, envelopeRef) {
  const envelopeObject = envelopeObjectRef(envelopeRef);
  return callTemplate(client, "template.automation.read_envelope_points", {
    autoitem_index: -1,
    limit: 64,
  }, { envelope_ref: envelopeObject });
}

async function readAutomationItems(client, envelopeRef) {
  const result = await callTemplate(client, "template.automation.read_automation_items", {
    limit: 64,
  }, { envelope_ref: envelopeObjectRef(envelopeRef) });
  assertTemplateSuccess(result, "template.automation.read_automation_items");
  assert(result.result?.summary?.truncated === false && result.result?.summary?.next_cursor == null, `Automation Item readback for ${envelopeRef} was incomplete`);
  return result;
}

async function resolveItemObject(client, itemRef) {
  const resolved = await callTemplate(client, "template.items.resolve_item_ref", { ref: itemRef });
  assertTemplateSuccess(resolved, `resolve ${itemRef}`);
  const object = resolved.result?.refs?.find((entry) => entry?.kind === "item" && entry.ref === itemRef);
  assert(object, `Resolved Item object missing for ${itemRef}`);
  return object;
}

async function readItemSummary(client, itemObject) {
  const result = await callTemplate(client, "template.items.read_item_summary", {
    include_take_summary: true,
  }, { item_ref: itemObject });
  assertTemplateSuccess(result, "template.items.read_item_summary");
  return result;
}

async function readFxMapping(client, fxRef, paramIndex) {
  const result = await callTemplate(client, "template.fx.parameter_to_envelope_mapping", {
    param_index: paramIndex,
  }, { fx_ref: fxObjectRef(fxRef) });
  assertTemplateSuccess(result, "template.fx.parameter_to_envelope_mapping");
  assert(result.result?.summary?.fx_ref === fxRef, `FX mapping identity mismatch for ${fxRef}`);
  return result;
}

async function insertFxPoints(client, fxRef, paramIdent, points) {
  return callTemplate(client, "macro.automation.apply", {
    mode: "insert_fx_parameter_points",
    fx_refs: [fxRef],
    fx_parameter: { param_index: 0, param_ident: paramIdent, create_if_missing: true },
    points,
    dry_run: false,
  });
}

function envelopeObjectRef(ref) {
  const match = /^envelope:([^:]+):(.+)$/u.exec(ref);
  if (!match) throw new Error(`Invalid Envelope ref ${ref}`);
  return { kind: "envelope", ref, identity: { scheme: match[1], value: match[2] } };
}

function trackObjectRef(ref) {
  const match = /^track:guid:(.+)$/u.exec(ref);
  if (!match) throw new Error(`Invalid Track ref ${ref}`);
  return { kind: "track", ref, identity: { scheme: "guid", value: match[1] } };
}

function takeObjectRef(ref) {
  const match = /^take:guid:(.+)$/u.exec(ref);
  if (!match) throw new Error(`Invalid Take ref ${ref}`);
  return { kind: "take", ref, identity: { scheme: "guid", value: match[1] } };
}

function fxObjectRef(ref) {
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  if (!match) throw new Error(`Invalid FX ref ${ref}`);
  return { kind: "fx", ref, identity: { scheme: `${match[1]}_fx`, value: `${match[1]}:guid:${match[2]}:${match[3]}` } };
}

async function callTemplate(client, id, input, refs = undefined, budget = PUBLIC_BUDGET) {
  return callTool(client, "call_template", { id, input, ...(refs ? { refs } : {}), budget });
}

async function callTool(client, name, args) {
  const response = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: 300_000, maxTotalTimeout: 600_000 },
  );
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  return JSON.parse(text);
}

function assertPublicSurface(value) {
  const visibleIds = value.menu?.items?.filter((item) => item.action_kind === "macro").map((item) => item.id) ?? [];
  assert(visibleIds.length === 15, `Expected 15 visible Macros, got ${visibleIds.length}`);
  assert(visibleIds.includes("macro.automation.apply"), "macro.automation.apply is not visible");
  const expansion = value.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0];
  assert(expansion?.id === "macro.automation.apply" && expansion.runnable === true, "Exact Automation manual is not runnable");
  assert(String(expansion.action_manual?.input_shape?.mode).includes("insert_points"), "Exact Automation manual omitted executable modes");
  assert(String(expansion.action_manual?.input_shape?.mode).includes("delete_automation_item"), "Exact Automation manual omitted Automation Item deletion");
  assert(String(expansion.action_manual?.input_shape?.mode).includes("insert_fx_parameter_points"), "Exact Automation manual omitted FX parameter points");
  assert(String(expansion.action_manual?.input_shape?.automation_item_bounds).includes("start_offset_seconds"), "Exact Automation manual omitted independently readable Item bounds fields");
}

function assertMacroSuccess(value, label) {
  assert(value?.contract === "macro.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(["completed", "dry_run_completed"].includes(value.execution?.status), `${label} status=${value.execution?.status}`);
  assert(value.budget?.truncated === false, `${label} result was truncated`);
}

function assertTemplateSuccess(value, label) {
  assert(value?.contract === "template.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error)}`);
}

function assertDryRun(value, mode) {
  assertMacroSuccess(value, `macro.automation.apply ${mode} preview`);
  assert(value.execution?.status === "dry_run_completed", `${mode} preview did not remain dry-run`);
  assert(value.result?.changes?.every((row) => row.status === "planned" && row.mutation?.status === "not_run"), `${mode} preview reported mutation`);
}

function assertAutomationSuccess(value, mode) {
  assertMacroSuccess(value, `macro.automation.apply ${mode}`);
  const rows = value.result?.changes ?? [];
  assert(rows.length > 0, `${mode} returned no change rows`);
  assert(rows.every((row) => row.status === "applied"), `${mode} returned a non-applied row`);
  assert(rows.every((row) => row.mutation?.status === "completed"), `${mode} mutation status was not completed`);
  assert(rows.every((row) => row.live_readback?.status === "passed"), `${mode} row-level live readback did not pass`);
  assert(rows.every((row) => ["completed", "skipped"].includes(row.index_maintenance?.status)), `${mode} index maintenance was not reported separately`);
}

function requireConfirmationRetry(value, label) {
  assertDryRun(value, label);
  const confirmation = value.result?.data?.confirmation;
  assert(/^automation-confirmation:v1:[a-f0-9]{64}$/u.test(confirmation?.token ?? ""), `${label} returned no deterministic token`);
  assert(confirmation?.retry?.id === "macro.automation.apply", `${label} returned no public retry`);
  assert(confirmation.retry.input?.confirmation_token === confirmation.token, `${label} retry token mismatch`);
  return confirmation.retry;
}

function assertCoverageAtLeast(value, minimumTotal, returned) {
  const coverage = value.result?.data?.coverage ?? {};
  assert(coverage.known_total_row_count >= minimumTotal, `known_total_row_count=${coverage.known_total_row_count}, expected at least ${minimumTotal}`);
  assert(coverage.indexed_row_count === coverage.known_total_row_count, `indexed_row_count=${coverage.indexed_row_count}, known_total_row_count=${coverage.known_total_row_count}`);
  assert(coverage.public_returned_row_count === returned, `public_returned_row_count=${coverage.public_returned_row_count}, expected ${returned}`);
}

function pointRows(value) {
  return value?.result?.summary?.points ?? [];
}

function requirePointAt(value, timeSeconds, label) {
  const matches = pointRows(value).filter((row) => valuesMatch(row.time_seconds, timeSeconds));
  assert(matches.length === 1, `${label} expected exactly one point at ${timeSeconds}, got ${matches.length}`);
  assert(Number.isInteger(matches[0].point_index), `${label} returned no exact point_index`);
  return matches[0];
}

function requireResultRef(value, kind, label) {
  const row = value?.result?.refs?.find((entry) => entry?.kind === kind && typeof entry.ref === "string");
  assert(row, `${label} returned no ${kind} ref`);
  return row.ref;
}

function automationItemsEqual(actual, expected) {
  return actual?.pool_id === expected?.pool_id
    && valuesMatch(actual?.position_seconds, expected?.position_seconds)
    && valuesMatch(actual?.length_seconds, expected?.length_seconds)
    && valuesMatch(actual?.start_offset_seconds, expected?.start_offset_seconds)
    && valuesMatch(actual?.playrate, expected?.playrate)
    && valuesMatch(actual?.baseline, expected?.baseline)
    && valuesMatch(actual?.amplitude, expected?.amplitude)
    && actual?.loop_source === expected?.loop_source
    && actual?.muted === expected?.muted;
}

function point(time_seconds, value) {
  return { time_seconds, value, shape: 0, tension: 0, selected: false };
}

function appliedCount(value) {
  return value?.result?.changes?.filter((row) => row.status === "applied").length ?? 0;
}

function valuesMatch(actual, expected) {
  return Number.isFinite(actual) && Math.abs(actual - expected) <= 0.000001;
}

function parseArgs(argv) {
  const result = { bridge_owner: "openreaper-alpha", bridge_generation: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--project-path") result.project_path = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else if (key === "--take-item-ref") result.take_item_ref = value;
    else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.project_path || !result.transport_dir || !/^item:guid:.+/u.test(result.take_item_ref ?? "") || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-b1d-automation-apply.mjs --evidence-root <fresh-root> --project-path <fixture.RPP> --transport-dir <bridge-transport> --take-item-ref <item:guid:{GUID}> [--bridge-owner owner] [--bridge-generation n]");
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
