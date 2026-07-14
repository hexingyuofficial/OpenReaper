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
const COPY_PROJECT = path.join(ROOT, "fixture", "Alpha33-Media-Place-Assets.RPP");
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Untitled-before.RPP");
const WAV_A = path.join(ROOT, "source-media", "alpha33-media-a.wav");
const WAV_B = path.join(ROOT, "source-media", "alpha33-media-b.wav");
const ARTIFACT_ROOT = options.artifact_root ?? path.join(ROOT, "artifacts");
const RENDER_ROOT = path.join(ROOT, "renders");
const INDEX_ROOT = path.join(ROOT, "project-index-state");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-media-place-assets-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };
const TINY_BUDGET = { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 };
const RUN_TOKEN = createHash("sha256").update(ROOT).digest("hex").slice(0, 8);
const EXISTING_TRACK_NAME = `A33 Media Existing ${RUN_TOKEN}`;
const REGION_NAME = `A33 Media Region ${RUN_TOKEN}`;
const NEW_TRACK_PREFIX = `A33 Media Layer ${RUN_TOKEN}`;

await Promise.all([
  mkdir(path.dirname(COPY_PROJECT), { recursive: true }),
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.dirname(WAV_A), { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
  mkdir(path.dirname(REPORT_PATH), { recursive: true }),
]);
await copyFile(SOURCE_PROJECT, BACKUP_PROJECT);
await Promise.all([
  writeDeterministicWav(WAV_A, { frequency: 330, seconds: 1 }),
  writeDeterministicWav(WAV_B, { frequency: 523.25, seconds: 1.5 }),
]);

const before = {
  source_project_sha256: await sha256(SOURCE_PROJECT),
  source_project_size: (await stat(SOURCE_PROJECT)).size,
  recovery_backup_sha256: await sha256(BACKUP_PROJECT),
  wav_a_sha256: await sha256(WAV_A),
  wav_a_size: (await stat(WAV_A)).size,
  wav_b_sha256: await sha256(WAV_B),
  wav_b_size: (await stat(WAV_B)).size,
};
const calls = {};
const clients = [];
let error = null;

try {
  const bootstrap = await connect("alpha33-media-bootstrap", {
    projectPath: SOURCE_PROJECT,
    logicalSessionKey: `alpha33-media-bootstrap-${RUN_TOKEN}`,
  });
  clients.push(bootstrap);
  calls.ping = await callTool(bootstrap, "ping", {});
  calls.menu = await callTool(bootstrap, "list_templates", {});
  calls.manual = await callTool(bootstrap, "list_templates", { ids: ["macro.media.place_assets"], fields: ["id"] });
  assertAlpha33Surface(calls);

  calls.current_path_before = await callTemplate(bootstrap, "template.project.read_current_project_path", {});
  assertTemplateSuccess(calls.current_path_before, "read current project path");
  assert(pathFacts(calls.current_path_before).path === SOURCE_PROJECT, `REAPER current project is ${pathFacts(calls.current_path_before).path}, expected ${SOURCE_PROJECT}`);

  calls.save_as = await callTemplate(bootstrap, "macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "macro.project.file save_as");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch REAPER to the evidence copy");
  await bootstrap.close();
  clients.pop();

  const sharedSessionKey = `alpha33-media-shared-${RUN_TOKEN}`;
  const clientA = await connect("alpha33-media-client-a", { projectPath: COPY_PROJECT, logicalSessionKey: sharedSessionKey });
  const clientB = await connect("alpha33-media-client-b", { projectPath: COPY_PROJECT, logicalSessionKey: sharedSessionKey });
  clients.push(clientA, clientB);
  calls.client_a_ping = await callTool(clientA, "ping", {});
  calls.client_b_ping = await callTool(clientB, "ping", {});

  calls.create_existing_track = await callTemplate(clientA, "template.tracks.create_track", { name: EXISTING_TRACK_NAME });
  assertTemplateSuccess(calls.create_existing_track, "create exact existing Track");
  const existingTrackRef = requireResultRef(calls.create_existing_track, "track", "created existing Track");
  assert(/^track:guid:.+/u.test(existingTrackRef), `Created Track ref is not exact GUID identity: ${existingTrackRef}`);
  const existingTrackObject = requireObjectRef(calls.create_existing_track, "track", existingTrackRef, "created existing Track");

  calls.resolve_existing_track = await callTemplate(clientA, "template.tracks.resolve_track_ref", { track_ref: existingTrackRef });
  assertTemplateSuccess(calls.resolve_existing_track, "resolve exact existing Track");
  const resolvedExisting = summaryOf(calls.resolve_existing_track);
  assert(resolvedExisting.track_ref === existingTrackRef, "Existing Track exact resolver returned a different ref");
  assert(resolvedExisting.name === EXISTING_TRACK_NAME, `Existing Track name readback=${resolvedExisting.name}`);

  calls.client_b_items_before = await queryItems(clientB, { limit: 50, refreshPolicy: "if_stale" });
  assertMacroSuccess(calls.client_b_items_before, "client B initial Item query");

  calls.inventory_before_budget = await listTrackItems(clientA, existingTrackObject);
  assertCompleteInventory(calls.inventory_before_budget, existingTrackRef);
  calls.public_budget_block = await callTemplate(clientA, "macro.media.place_assets", {
    assets: [{ id: "budget_block", path: WAV_A, position_seconds: 0 }],
    placement: { mode: "explicit" },
    track_policy: "existing_track",
    track_ref: existingTrackRef,
    dry_run: false,
  }, { budget: TINY_BUDGET });
  assert(calls.public_budget_block?.contract === "macro.execution.v1", `2 KiB call returned ${calls.public_budget_block?.contract}`);
  assert(calls.public_budget_block?.ok === false, "2 KiB media request unexpectedly mutated successfully");
  assert(calls.public_budget_block?.error?.code === "MEDIA_RESPONSE_BUDGET_EXCEEDED", `2 KiB blocker=${calls.public_budget_block?.error?.code}`);
  assert((calls.public_budget_block?.result?.changes?.length ?? -1) === 0, "2 KiB blocker returned mutation rows");
  assert(calls.public_budget_block?.budget?.max_bytes === 2_048, "2 KiB budget was not preserved through call_template");
  assert(calls.public_budget_block?.budget?.actual_bytes <= 2_048, "2 KiB blocker exceeded its public response budget");
  calls.inventory_after_budget = await listTrackItems(clientA, existingTrackObject);
  assertCompleteInventory(calls.inventory_after_budget, existingTrackRef);
  assertInventoryEqual(calls.inventory_before_budget, calls.inventory_after_budget, "2 KiB budget blocker mutated the Track");

  calls.sequence_existing_track = await callTemplate(clientA, "macro.media.place_assets", {
    assets: [
      { id: "sequence_a", path: WAV_A },
      { id: "sequence_b", path: WAV_B },
    ],
    placement: { mode: "sequence_on_one_track", start_seconds: 1, gap_seconds: 0.25 },
    track_policy: "existing_track",
    track_ref: existingTrackRef,
    dry_run: false,
  });
  assertMediaSuccess(calls.sequence_existing_track, { assetCount: 2, setupCount: 0 });
  const sequenceA = requireAssetChange(calls.sequence_existing_track, "sequence_a");
  const sequenceB = requireAssetChange(calls.sequence_existing_track, "sequence_b");
  assertClose(sequenceA.live_readback.position_seconds, 1, "sequence_a position");
  assertClose(sequenceB.live_readback.position_seconds, 2.25, "sequence_b position");
  assert(sequenceA.live_readback.track_ref === existingTrackRef && sequenceB.live_readback.track_ref === existingTrackRef, "Sequence did not land on the exact existing Track");
  const sequenceItemRefs = [sequenceA.live_readback.item_ref, sequenceB.live_readback.item_ref];
  assert(sequenceItemRefs.every(isExactItemRef) && new Set(sequenceItemRefs).size === 2, "Sequence did not return two distinct exact Item refs");

  calls.client_b_exact_after_client_a_write = await queryItems(clientB, {
    refs: [sequenceItemRefs[1]],
    limit: 1,
    refreshPolicy: "if_stale",
  });
  assertMacroSuccess(calls.client_b_exact_after_client_a_write, "client B exact Item query after client A write");
  assert(calls.client_b_exact_after_client_a_write.result?.data?.rows?.[0]?.ref === sequenceItemRefs[1], "Client B did not see Client A's newly imported exact Item through if_stale refresh");

  calls.inventory_before_append = await listTrackItems(clientA, existingTrackObject);
  assertCompleteInventory(calls.inventory_before_append, existingTrackRef);
  const appendEndBefore = inventoryEnd(calls.inventory_before_append);
  calls.append_after_existing = await callTemplate(clientA, "macro.media.place_assets", {
    assets: [{ id: "append_a", path: WAV_A }],
    placement: { mode: "append_after_existing", start_seconds: 0, gap_seconds: 0.5 },
    track_policy: "existing_track",
    track_ref: existingTrackRef,
    dry_run: false,
  });
  assertMediaSuccess(calls.append_after_existing, { assetCount: 1, setupCount: 0 });
  const appendChange = requireAssetChange(calls.append_after_existing, "append_a");
  assertClose(appendChange.planned_position_seconds, appendEndBefore + 0.5, "append planned position from complete pre-write inventory");
  assertClose(appendChange.live_readback.position_seconds, appendEndBefore + 0.5, "append live position");
  calls.inventory_after_append = await listTrackItems(clientA, existingTrackObject);
  assertCompleteInventory(calls.inventory_after_append, existingTrackRef);
  assert(summaryOf(calls.inventory_after_append).item_count === summaryOf(calls.inventory_before_append).item_count + 1, "Append did not add exactly one Item");

  calls.stack_new_tracks = await callTemplate(clientA, "macro.media.place_assets", {
    assets: [
      { id: "stack_a", path: WAV_A },
      { id: "stack_b", path: WAV_B },
    ],
    placement: { mode: "stack_on_separate_tracks", start_seconds: 8 },
    track_policy: "one_new_track_per_asset",
    new_track: { name_prefix: NEW_TRACK_PREFIX, starting_index: 1 },
    dry_run: false,
  });
  assertMediaSuccess(calls.stack_new_tracks, { assetCount: 2, setupCount: 2 });
  const trackSetupChanges = calls.stack_new_tracks.result.changes.filter((row) => row.setup_kind === "track");
  assert(trackSetupChanges.length === 2, `Expected two Track setup rows, got ${trackSetupChanges.length}`);
  calls.resolve_new_tracks = [];
  for (const [index, change] of trackSetupChanges.entries()) {
    const expectedName = `${NEW_TRACK_PREFIX} ${index + 1}`;
    assert(/^track:guid:.+/u.test(change.target_ref ?? ""), `New Track ${index + 1} has no exact GUID ref`);
    assert(change.live_readback?.track_ref === change.target_ref, `New Track ${index + 1} exact resolver ref mismatch`);
    assert(change.live_readback?.name === expectedName, `New Track ${index + 1} name=${change.live_readback?.name}`);
    const resolved = await callTemplate(clientA, "template.tracks.resolve_track_ref", { track_ref: change.target_ref });
    assertTemplateSuccess(resolved, `resolve new Track ${index + 1}`);
    assert(summaryOf(resolved).track_ref === change.target_ref && summaryOf(resolved).name === expectedName, `Independent new Track ${index + 1} readback mismatch`);
    calls.resolve_new_tracks.push(resolved);
  }
  const stackedTrackRefs = new Set(calls.stack_new_tracks.result.changes.filter((row) => row.asset_id).map((row) => row.live_readback?.track_ref));
  assert(stackedTrackRefs.size === 2 && trackSetupChanges.every((row) => stackedTrackRefs.has(row.target_ref)), "Stack assets did not land one-per-created-Track");

  calls.region_asset = await callTemplate(clientA, "macro.media.place_assets", {
    assets: [{
      id: "region_asset",
      path: WAV_A,
      position_seconds: 12,
      region: { name: REGION_NAME, start_seconds: 12, end_seconds: 13 },
    }],
    placement: { mode: "explicit" },
    track_policy: "existing_track",
    track_ref: existingTrackRef,
    dry_run: false,
  });
  assertMediaSuccess(calls.region_asset, { assetCount: 1, setupCount: 1 });
  const regionChange = calls.region_asset.result.changes.find((row) => row.setup_kind === "region");
  assert(/^region:index:\d+$/u.test(regionChange?.target_ref ?? ""), `Region exact ref=${regionChange?.target_ref}`);
  assert(regionChange.live_readback?.region_ref === regionChange.target_ref, "Region exact readback ref mismatch");
  assert(regionChange.live_readback?.name === REGION_NAME, `Region name readback=${regionChange.live_readback?.name}`);
  assertClose(regionChange.live_readback?.start_seconds, 12, "Region start");
  assertClose(regionChange.live_readback?.end_seconds, 13, "Region end");
  calls.region_inventory = await callTemplate(clientA, "template.project.list_markers_regions", {
    include_markers: false,
    include_regions: true,
    limit: 50,
  });
  assertTemplateSuccess(calls.region_inventory, "independent Region inventory");
  const regionFacts = summaryOf(calls.region_inventory);
  assert(regionFacts.truncated === false && regionFacts.region_count === regionFacts.items?.length, "Independent Region inventory was incomplete");
  const independentRegion = regionFacts.items.find((row) => row.region_ref === regionChange.target_ref);
  assert(independentRegion?.name === REGION_NAME, "Independent Region inventory did not resolve exact name");
  assertClose(independentRegion?.position_seconds, 12, "Independent Region start");
  assertClose(independentRegion?.end_seconds, 13, "Independent Region end");

  const relinkTakeRef = sequenceA.live_readback.take_ref;
  assert(/^take:guid:.+/u.test(relinkTakeRef ?? ""), `Sequence Take ref is not exact: ${relinkTakeRef}`);
  const relinkTakeObject = exactObjectRef("take", relinkTakeRef);
  calls.take_source_before_relink = await callTemplate(clientA, "template.media.read_take_source", {
    include_metadata_keys: false,
    include_parent_source: false,
  }, { refs: { take_ref: relinkTakeObject } });
  assertTemplateSuccess(calls.take_source_before_relink, "Take source before relink");
  assert(summaryOf(calls.take_source_before_relink).take_ref === relinkTakeRef, "Pre-relink Take identity mismatch");

  calls.relink_exact_take = await callTemplate(clientA, "macro.media.place_assets", {
    mode: "relink_sources",
    assets: [{ id: "relink_sequence_a", path: WAV_B, take_ref: relinkTakeRef }],
    dry_run: false,
  });
  assertMediaSuccess(calls.relink_exact_take, { assetCount: 1, setupCount: 0 });
  const relinkChange = requireAssetChange(calls.relink_exact_take, "relink_sequence_a");
  assert(relinkChange.live_readback?.take_ref === relinkTakeRef, "Relink changed the exact Take identity");
  calls.take_source_after_relink = await callTemplate(clientA, "template.media.read_take_source", {
    include_metadata_keys: false,
    include_parent_source: false,
  }, { refs: { take_ref: relinkTakeObject } });
  assertTemplateSuccess(calls.take_source_after_relink, "Take source after relink");
  const afterRelinkSource = summaryOf(calls.take_source_after_relink);
  assert(afterRelinkSource.take_ref === relinkTakeRef, "Post-relink Take identity mismatch");
  assert(afterRelinkSource.file_ref === relinkChange.live_readback?.source_file_ref, "Independent Take source readback disagrees with Macro live readback");
  assert(afterRelinkSource.file_ref === `file:path:${WAV_B}`, `Relink source=${afterRelinkSource.file_ref}`);

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
  source_project_sha256: await sha256(SOURCE_PROJECT),
  source_project_size: (await stat(SOURCE_PROJECT)).size,
  evidence_copy_exists: await exists(COPY_PROJECT),
  evidence_copy_sha256: await exists(COPY_PROJECT) ? await sha256(COPY_PROJECT) : null,
  evidence_copy_size: await exists(COPY_PROJECT) ? (await stat(COPY_PROJECT)).size : null,
  wav_a_exists: await exists(WAV_A),
  wav_a_sha256: await exists(WAV_A) ? await sha256(WAV_A) : null,
  wav_b_exists: await exists(WAV_B),
  wav_b_sha256: await exists(WAV_B) ? await sha256(WAV_B) : null,
};
const successfulMediaCalls = [
  calls.sequence_existing_track,
  calls.append_after_existing,
  calls.stack_new_tracks,
  calls.region_asset,
  calls.relink_exact_take,
].filter(Boolean);
const report = {
  contract: "alpha3.3.media_place_assets_live.v1",
  ok: error === null,
  generated_at: new Date().toISOString(),
  evidence_root: ROOT,
  source_project: SOURCE_PROJECT,
  active_test_project: COPY_PROJECT,
  transport: {
    directory: options.transport_dir,
    artifact_root: ARTIFACT_ROOT,
    owner: options.bridge_owner,
    generation: options.bridge_generation,
  },
  shared_project_index: {
    state_root: INDEX_ROOT,
    logical_session_key: `alpha33-media-shared-${RUN_TOKEN}`,
    client_a_write_client_b_if_stale_read: calls.client_b_exact_after_client_a_write?.result?.data?.rows?.[0]?.ref === sequenceBRef(calls),
  },
  public_budget: PUBLIC_BUDGET,
  tiny_public_budget: TINY_BUDGET,
  tests: {
    visible_macro_count: calls.menu?.items?.filter((item) => item.action_kind === "macro").length ?? null,
    media_macro_visible: calls.menu?.items?.some((item) => item.id === "macro.media.place_assets") ?? false,
    exact_manual_runnable: calls.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0]?.runnable ?? false,
    public_budget_block: outcome(calls.public_budget_block),
    budget_block_inventory_unchanged: inventoryMatches(calls.inventory_before_budget, calls.inventory_after_budget),
    sequence_existing_track: outcome(calls.sequence_existing_track),
    append_after_existing: outcome(calls.append_after_existing),
    stack_new_tracks: outcome(calls.stack_new_tracks),
    exact_region: outcome(calls.region_asset),
    exact_take_relink: outcome(calls.relink_exact_take),
    cross_client_exact_item_query: outcome(calls.client_b_exact_after_client_a_write),
    all_applied_rows_live_proved: successfulMediaCalls.every(allRowsLiveProved),
  },
  project_changes: {
    existing_track_created: calls.create_existing_track?.ok === true,
    existing_track_ref: resultRefs(calls.create_existing_track).find((ref) => ref.startsWith("track:guid:")) ?? null,
    existing_track_sequence_item_count: calls.sequence_existing_track?.result?.data?.asset_count ?? 0,
    appended_item_ref: requireOptionalAssetChange(calls.append_after_existing, "append_a")?.live_readback?.item_ref ?? null,
    new_tracks_created: calls.stack_new_tracks?.result?.changes?.filter((row) => row.setup_kind === "track" && row.status === "applied").length ?? 0,
    region_created: calls.region_asset?.result?.changes?.find((row) => row.setup_kind === "region")?.target_ref ?? null,
    exact_take_relinked: calls.relink_exact_take?.result?.changes?.find((row) => row.asset_id === "relink_sequence_a")?.live_readback?.take_ref ?? null,
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  recovery_backup_posture: {
    source_project_backup: BACKUP_PROJECT,
    source_hash_unchanged: before.source_project_sha256 === after.source_project_sha256,
    source_project_not_mutated_on_disk: before.source_project_sha256 === after.source_project_sha256,
    evidence_copy_preserved: after.evidence_copy_exists,
    generated_source_media_preserved: after.wav_a_exists && after.wav_b_exists,
    generated_source_hashes_unchanged: before.wav_a_sha256 === after.wav_a_sha256 && before.wav_b_sha256 === after.wav_b_sha256,
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

async function connect(name, { projectPath, logicalSessionKey }) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StdioClientTransport({
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
      OPENREAPER_LIVE_BRIDGE_SESSION_ID: logicalSessionKey,
      OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: RENDER_ROOT,
      OPENREAPER_CURRENT_PROJECT_PATH: projectPath,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: INDEX_ROOT,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: logicalSessionKey,
    },
  }));
  return client;
}

async function callTemplate(client, id, input, { refs, budget = PUBLIC_BUDGET } = {}) {
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

async function listTrackItems(client, trackObject) {
  return callTemplate(client, "template.items.list_items_on_track", {
    limit: 128,
    include_take_summary: true,
  }, { refs: { track_ref: trackObject } });
}

async function queryItems(client, { refs, limit, refreshPolicy }) {
  return callTemplate(client, "macro.project.query", {
    entity: "items",
    fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
    ...(refs ? { selectors: { refs } } : {}),
    limit,
    refresh_policy: refreshPolicy,
  });
}

function assertAlpha33Surface(value) {
  const visible = value.menu?.items?.filter((item) => item.action_kind === "macro") ?? [];
  assert(visible.length === 15, `Expected 15 visible Macros, got ${visible.length}`);
  assert(visible.some((item) => item.id === "macro.media.place_assets"), "macro.media.place_assets is not visible in the compact menu");
  const expansion = value.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0];
  assert(expansion?.id === "macro.media.place_assets" && expansion.runnable === true, "Exact media.place_assets manual is not runnable");
  assert(expansion.action_manual?.input_shape?.placement?.includes("append_after_existing"), "Exact manual omits append_after_existing");
  assert(expansion.action_manual?.input_shape?.mode?.includes("relink_sources"), "Exact manual omits exact Take relink");
}

function assertMacroSuccess(value, label) {
  assert(value?.contract === "macro.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(["completed", "dry_run_completed"].includes(value.execution?.status), `${label} status=${value.execution?.status}`);
  assert(value.result?.verification?.status === "passed", `${label} verification=${value.result?.verification?.status}`);
  assert(value.budget?.truncated === false, `${label} result was truncated`);
}

function assertTemplateSuccess(value, label) {
  assert(value?.contract === "template.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error)}`);
  assert(value.verification?.status === "passed" || value.result?.verification?.status === "passed", `${label} verification did not pass`);
}

function assertMediaSuccess(value, { assetCount, setupCount }) {
  assertMacroSuccess(value, "macro.media.place_assets");
  const changes = value.result?.changes ?? [];
  assert(changes.filter((row) => row.asset_id).length === assetCount, `Expected ${assetCount} asset rows, got ${changes.filter((row) => row.asset_id).length}`);
  assert(changes.filter((row) => row.mode === "setup").length === setupCount, `Expected ${setupCount} setup rows, got ${changes.filter((row) => row.mode === "setup").length}`);
  assert(changes.length === assetCount + setupCount, `Unexpected media change row count ${changes.length}`);
  for (const row of changes) {
    assert(row.status === "applied", `${row.asset_id ?? row.change_id} status=${row.status}`);
    assert(row.mutation?.status === "completed", `${row.asset_id ?? row.change_id} mutation=${row.mutation?.status}`);
    assert(row.live_readback?.status === "passed", `${row.asset_id ?? row.change_id} live_readback=${row.live_readback?.status}`);
    assert(row.index_maintenance?.status === "completed", `${row.asset_id ?? row.change_id} index_maintenance=${row.index_maintenance?.status}`);
  }
  assert(value.result?.data?.outcome?.mutation?.status === "completed", "Media mutation outcome was not completed");
  assert(value.result?.data?.outcome?.live_readback?.status === "passed", "Media live readback outcome was not passed");
  assert(value.result?.data?.outcome?.index_maintenance?.status === "completed", "Media index maintenance outcome was not completed");
}

function assertCompleteInventory(value, trackRef) {
  assertTemplateSuccess(value, `Track Item inventory ${trackRef}`);
  const facts = summaryOf(value);
  assert(facts.track_ref === trackRef, `Track Item inventory ref=${facts.track_ref}`);
  assert(Array.isArray(facts.items), "Track Item inventory returned no rows array");
  assert(facts.truncated === false, "Track Item inventory was truncated");
  assert(facts.item_count === facts.items.length, `Track Item inventory count=${facts.item_count}, rows=${facts.items.length}`);
}

function assertInventoryEqual(beforeValue, afterValue, message) {
  assert(inventoryMatches(beforeValue, afterValue), message);
}

function inventoryMatches(beforeValue, afterValue) {
  if (!beforeValue || !afterValue) return false;
  return JSON.stringify(inventoryProjection(beforeValue)) === JSON.stringify(inventoryProjection(afterValue));
}

function inventoryProjection(value) {
  return (summaryOf(value).items ?? []).map((row) => ({
    item_ref: row.item_ref,
    position_seconds: row.position_seconds,
    length_seconds: row.length_seconds,
    active_take_ref: row.active_take_ref ?? row.take_ref ?? null,
  })).sort((left, right) => String(left.item_ref).localeCompare(String(right.item_ref)));
}

function inventoryEnd(value) {
  return (summaryOf(value).items ?? []).reduce((maximum, row) => (
    Math.max(maximum, Number(row.position_seconds) + Number(row.length_seconds))
  ), 0);
}

function requireAssetChange(value, assetId) {
  const row = requireOptionalAssetChange(value, assetId);
  assert(row, `No change row for asset ${assetId}`);
  return row;
}

function requireOptionalAssetChange(value, assetId) {
  return value?.result?.changes?.find((row) => row.asset_id === assetId) ?? null;
}

function requireResultRef(value, kind, label) {
  const ref = resultRefs(value).find((entry) => entry.startsWith(`${kind}:`));
  assert(typeof ref === "string", `${label} returned no ${kind} ref`);
  return ref;
}

function requireObjectRef(value, kind, ref, label) {
  const object = value?.result?.refs?.find((entry) => entry?.kind === kind && entry.ref === ref);
  assert(object, `${label} returned no reusable ${kind} ObjectRef`);
  return object;
}

function resultRefs(value) {
  return (value?.result?.refs ?? []).map((entry) => typeof entry === "string" ? entry : entry?.ref).filter((entry) => typeof entry === "string");
}

function summaryOf(value) {
  return value?.result?.summary ?? value?.result?.readback ?? value?.result?.data ?? {};
}

function pathFacts(value) {
  return summaryOf(value);
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

function isExactItemRef(value) {
  return typeof value === "string" && /^item:guid:.+/u.test(value);
}

function assertClose(actual, expected, label) {
  assert(Number.isFinite(actual) && Math.abs(actual - expected) <= 0.000001, `${label}=${actual}, expected ${expected}`);
}

function allRowsLiveProved(value) {
  const changes = value?.result?.changes ?? [];
  return value?.ok === true && changes.length > 0 && changes.every((row) => (
    row.status === "applied"
    && row.mutation?.status === "completed"
    && row.live_readback?.status === "passed"
    && row.index_maintenance?.status === "completed"
  ));
}

function sequenceBRef(value) {
  return value?.sequence_existing_track?.result?.changes?.find((row) => row.asset_id === "sequence_b")?.live_readback?.item_ref ?? null;
}

function outcome(value) {
  return value ? {
    ok: value.ok,
    contract: value.contract ?? null,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? value.verification?.status ?? null,
    error_code: value.error?.code ?? null,
    change_count: value.result?.changes?.length ?? 0,
    applied_count: value.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    mutation_status: value.result?.data?.outcome?.mutation?.status ?? null,
    live_readback_status: value.result?.data?.outcome?.live_readback?.status ?? null,
    index_maintenance_status: value.result?.data?.outcome?.index_maintenance?.status ?? null,
    result_bytes: value.budget?.actual_bytes ?? null,
  } : null;
}

async function writeDeterministicWav(file, { frequency, seconds }) {
  const sampleRate = 48_000;
  const channels = 2;
  const frameCount = Math.round(sampleRate * seconds);
  const bitsPerSample = 16;
  const blockAlign = channels * bitsPerSample / 8;
  const data = Buffer.alloc(frameCount * blockAlign);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const time = frame / sampleRate;
    const sample = Math.sin(2 * Math.PI * frequency * time) * 0.35;
    const pcm = Math.round(Math.max(-1, Math.min(1, sample)) * 32767);
    data.writeInt16LE(pcm, frame * blockAlign);
    data.writeInt16LE(Math.round(pcm * 0.8), frame * blockAlign + 2);
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
  const result = { bridge_owner: "openreaper-alpha3-local", bridge_generation: 1 };
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.source_project || !result.transport_dir || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-media-place-assets.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> [--artifact-root <bridge-artifact-root>] [--bridge-owner owner] [--bridge-generation n]");
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
