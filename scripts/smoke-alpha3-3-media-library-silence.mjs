#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const ROOT = options.evidence_root;
const COPY_PROJECT = path.join(ROOT, "evidence", "projects", "Alpha33-Soundly-Kick-Silence.RPP");
const BACKUP_PROJECT = path.join(ROOT, "evidence", "backup", "Untitled.media-library-before.RPP");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-media-library-silence-live.json");
const INDEX_ROOT = options.index_root ?? path.join(ROOT, "session", "project-index");
const ARTIFACT_ROOT = options.artifact_root ?? path.join(ROOT, "session", "artifacts");
const RENDER_ROOT = options.render_root ?? path.join(ROOT, "renders");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 128, max_inline_value_bytes: 12_000 };
const SEARCH_BUDGET = { max_response_bytes: 2_048, max_items: 25, max_inline_value_bytes: 2_048 };
const REQUIRED_ASSETS = 5;
const REQUIRED_REMOVALS = 2;
const TRANSIENT_FALLBACK_DELTA = 0.05;
const SILENCE_THRESHOLD_DBFS = -40;
const MIN_SILENCE_MS = 10;
const RUN_TOKEN = createHash("sha256").update(ROOT).digest("hex").slice(0, 8);
const TRACK_NAME = `A33 Soundly Kick Trial ${RUN_TOKEN}`;
const calls = {
  search_pages: [],
  independent_readback: [],
  transient_fallbacks: [],
  silence_candidate_analysis: [],
  remove_silence_attempts: [],
};
const clients = [];
let error = null;

await Promise.all([
  mkdir(path.dirname(COPY_PROJECT), { recursive: true }),
  mkdir(path.dirname(BACKUP_PROJECT), { recursive: true }),
  mkdir(path.dirname(REPORT_PATH), { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
]);
await copyFile(options.source_project, BACKUP_PROJECT);

const before = {
  source_project_sha256: await sha256(options.source_project),
  source_project_size: (await stat(options.source_project)).size,
  recovery_backup_sha256: await sha256(BACKUP_PROJECT),
};
let selected = [];
let sourceMediaBefore = [];
let importRows = [];
let alignedItemRefs = [];
let removalSuccesses = [];

try {
  const bootstrap = await connect("alpha33-media-library-bootstrap", options.source_project, `alpha33-media-library-bootstrap-${RUN_TOKEN}`);
  clients.push(bootstrap);
  calls.ping = await callTool(bootstrap, "ping", {});
  calls.current_path_before = await callTemplate(bootstrap, "template.project.read_current_project_path", {});
  assertTemplateSuccess(calls.current_path_before, "read current project path");
  assert(summaryOf(calls.current_path_before).path === options.source_project, `REAPER current project is ${summaryOf(calls.current_path_before).path}, expected ${options.source_project}`);

  calls.save_as = await callTemplate(bootstrap, "macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "save evidence project");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch REAPER to the evidence project");
  await bootstrap.close();
  clients.pop();

  const sharedSessionKey = `alpha33-media-library-shared-${RUN_TOKEN}`;
  const clientA = await connect("alpha33-media-library-client-a", COPY_PROJECT, sharedSessionKey);
  const clientB = await connect("alpha33-media-library-client-b", COPY_PROJECT, sharedSessionKey);
  clients.push(clientA, clientB);
  calls.client_a_ping = await callTool(clientA, "ping", {});
  calls.client_b_ping = await callTool(clientB, "ping", {});

  const availableByPath = new Map();
  const seenCursors = new Set();
  let cursor = null;
  let expectedOffset = 0;
  let stableTotal = null;
  for (let pageIndex = 0; pageIndex < 20; pageIndex += 1) {
    const activeClient = pageIndex % 2 === 0 ? clientA : clientB;
    const page = await callTemplate(activeClient, "macro.media.place_assets", {
      mode: "search_library",
      query: "kick",
      database_ids: ["soundly"],
      page_size: 25,
      ...(cursor ? { cursor } : {}),
    }, { budget: SEARCH_BUDGET });
    assertSearchPage(page, { expectedOffset, stableTotal });
    calls.search_pages.push(page);
    stableTotal ??= page.result.data.page.total;
    for (const row of page.result.data.results) {
      if (row.available === true && !availableByPath.has(row.path)) availableByPath.set(row.path, row);
    }
    if (availableByPath.size >= REQUIRED_ASSETS) break;
    const nextCursor = page.result.data.page.next_cursor;
    assert(typeof nextCursor === "string" && nextCursor.length > 0, `Only ${availableByPath.size} available kick(s) found before pagination ended`);
    assert(!seenCursors.has(nextCursor), "Media Explorer pagination repeated a cursor");
    seenCursors.add(nextCursor);
    expectedOffset += page.result.data.page.returned;
    assert(expectedOffset > page.result.data.page.offset, "Media Explorer page did not advance under the 2 KiB budget");
    cursor = nextCursor;
  }

  selected = [...availableByPath.values()].slice(0, REQUIRED_ASSETS);
  assert(selected.length === REQUIRED_ASSETS, `Expected ${REQUIRED_ASSETS} available Soundly kicks, got ${selected.length}`);
  sourceMediaBefore = await Promise.all(selected.map(fileFacts));

  calls.import = await callTemplate(clientA, "macro.media.place_assets", {
    mode: "place_assets",
    assets: selected.map((row, index) => ({ id: `soundly-kick-${index + 1}`, path: row.path })),
    placement: { mode: "sequence_on_one_track", start_seconds: 0, gap_seconds: 0.1 },
    track_policy: "one_shared_new_track",
    new_track: { name: TRACK_NAME },
    dry_run: false,
  });
  assertMacroSuccess(calls.import, "import five Soundly kicks");
  const setupRows = calls.import.result?.changes?.filter((row) => row.mode === "setup") ?? [];
  importRows = calls.import.result?.changes?.filter((row) => row.asset_id) ?? [];
  assert(setupRows.length === 1 && setupRows[0].setup_kind === "track", `Expected one Track setup row, got ${setupRows.length}`);
  assertAppliedRow(setupRows[0], "Soundly shared Track");
  assert(importRows.length === REQUIRED_ASSETS, `Expected ${REQUIRED_ASSETS} imported asset rows, got ${importRows.length}`);
  for (const [index, row] of importRows.entries()) {
    assertAppliedRow(row, row.asset_id);
    assert(/^item:guid:/u.test(row.live_readback?.item_ref), `${row.asset_id} has no exact Item GUID`);
    assert(/^take:guid:/u.test(row.live_readback?.take_ref), `${row.asset_id} has no exact Take GUID`);
    assert(/^track:guid:/u.test(row.live_readback?.track_ref), `${row.asset_id} has no exact Track GUID`);
    assert(row.live_readback?.source_file_ref === `file:path:${selected[index].path}`, `${row.asset_id} source path readback mismatched`);
    assert(displayDurationMatches(row.live_readback?.length_seconds, selected[index].duration_seconds), `${row.asset_id} duration readback mismatched`);

    const item = await callTemplate(clientB, "template.items.read_item_summary", {
      include_take_summary: true,
    }, { refs: { item_ref: exactGuidObjectRef("item", row.live_readback.item_ref) } });
    assertTemplateSuccess(item, `read ${row.live_readback.item_ref}`);
    const itemSummary = summaryOf(item);
    assert(itemSummary.item_ref === row.live_readback.item_ref, "Independent Item identity mismatched");
    assert(itemSummary.active_take_ref === row.live_readback.take_ref, "Independent Active Take identity mismatched");
    assert(itemSummary.track_ref === row.live_readback.track_ref, "Independent Track identity mismatched");

    const source = await callTemplate(clientB, "template.media.read_take_source", {
      include_metadata_keys: false,
      include_parent_source: false,
    }, { refs: { take_ref: exactGuidObjectRef("take", row.live_readback.take_ref) } });
    assertTemplateSuccess(source, `read ${row.live_readback.take_ref}`);
    const sourceSummary = summaryOf(source);
    assert(sourceSummary.take_ref === row.live_readback.take_ref, "Independent Take identity mismatched");
    assert(sourceSummary.file_ref === row.live_readback.source_file_ref, "Independent Take source mismatched");
    calls.independent_readback.push({ item, source });
  }

  const importedItemRefs = importRows.map((row) => row.live_readback.item_ref);
  calls.client_b_exact_items = await callTemplate(clientB, "macro.project.query", {
    entity: "items",
    selectors: { refs: importedItemRefs },
    fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
    limit: REQUIRED_ASSETS,
    refresh_policy: "if_stale",
  });
  assertMacroSuccess(calls.client_b_exact_items, "cross-client exact Item query");
  const crossClientRows = calls.client_b_exact_items.result?.data?.rows ?? [];
  assert(crossClientRows.length === REQUIRED_ASSETS, `Cross-client query returned ${crossClientRows.length}/${REQUIRED_ASSETS} Items`);
  assert(new Set(crossClientRows.map((row) => row.ref)).size === REQUIRED_ASSETS, "Cross-client query returned duplicate Item refs");
  assert(importedItemRefs.every((itemRef) => crossClientRows.some((row) => row.ref === itemRef)), "Cross-client query did not return every exact imported Item ref");

  calls.selection_analysis = await callTemplate(clientB, "macro.items.analyze", {
    profile: "timing",
    target_refs: importedItemRefs,
    limit: REQUIRED_ASSETS,
    output: "compact",
  });
  assertMacroSuccess(calls.selection_analysis, "analyze imported kick timing");
  const analyzedItems = calls.selection_analysis.result?.data?.items ?? [];
  assert(analyzedItems.length === REQUIRED_ASSETS, `Timing analysis returned ${analyzedItems.length}/${REQUIRED_ASSETS} Items`);
  assert(importedItemRefs.every((itemRef) => analyzedItems.some((row) => row.item_ref === itemRef)), "Timing analysis did not return every exact imported Item ref");

  const defaultTransientCandidates = analyzedItems.filter((row) => {
    const transients = row.measurements?.transients;
    return Number.isInteger(transients?.transient_count)
      && transients.transient_count > 0
      && Number.isFinite(transients.first_transient_time)
      && transients.truncated !== true;
  });
  let transientCandidates = defaultTransientCandidates;
  if (transientCandidates.length < 2) {
    transientCandidates = [];
    for (const itemRef of importedItemRefs) {
      const result = await callTemplate(clientB, "template.analysis.detect_item_transients", {
        max_analysis_seconds: 600,
        transient_delta_linear: TRANSIENT_FALLBACK_DELTA,
        max_transients: 128,
      }, { refs: { item_ref: exactGuidObjectRef("item", itemRef) } });
      assertTemplateSuccess(result, `adaptive transient analysis ${itemRef}`);
      const summary = summaryOf(result);
      assert(summary.item_ref === itemRef, `Adaptive transient analysis identity mismatched for ${itemRef}`);
      calls.transient_fallbacks.push({ item_ref: itemRef, result });
      if (Number.isInteger(summary.transient_count)
        && summary.transient_count > 0
        && Number.isFinite(summary.first_transient_time)
        && summary.truncated !== true) {
        transientCandidates.push({ item_ref: itemRef, measurements: { transients: summary } });
      }
    }
  }
  assert(transientCandidates.length >= 2, `Only ${transientCandidates.length}/${REQUIRED_ASSETS} imported kicks had a complete first transient after the public threshold fallback`);
  alignedItemRefs = transientCandidates.slice(0, 2).map((row) => row.item_ref);
  calls.align_onsets = await callTemplate(clientB, "macro.items.apply", {
    mode: "align_onsets",
    target_refs: alignedItemRefs,
    transient_delta_linear: TRANSIENT_FALLBACK_DELTA,
    dry_run: false,
  });
  assertMacroSuccess(calls.align_onsets, "align two kick onsets");
  assert((calls.align_onsets.result?.changes?.length ?? 0) === 2, "Onset alignment did not return two rows");
  for (const row of calls.align_onsets.result.changes) assertAppliedRow(row, row.operation_id ?? "onset alignment");

  const silenceCandidateRefs = [];
  for (const itemRef of importedItemRefs) {
    const result = await callTemplate(clientA, "template.analysis.detect_item_silence", {
      max_analysis_seconds: 600,
      silence_threshold_dbfs: SILENCE_THRESHOLD_DBFS,
      min_silence_ms: MIN_SILENCE_MS,
      max_segments: 128,
    }, { refs: { item_ref: exactGuidObjectRef("item", itemRef) } });
    assertTemplateSuccess(result, `adaptive silence analysis ${itemRef}`);
    const summary = summaryOf(result);
    assert(summary.item_ref === itemRef, `Adaptive silence analysis identity mismatched for ${itemRef}`);
    calls.silence_candidate_analysis.push({ item_ref: itemRef, result });
    if (Number.isInteger(summary.segment_count)
      && summary.segment_count > 0
      && Number.isFinite(summary.total_silence_seconds)
      && summary.total_silence_seconds > 0
      && summary.truncated !== true) {
      silenceCandidateRefs.push(itemRef);
    }
  }
  const removalOrder = [...silenceCandidateRefs, ...importedItemRefs.filter((itemRef) => !silenceCandidateRefs.includes(itemRef))];
  for (const itemRef of removalOrder) {
    if (removalSuccesses.length >= REQUIRED_REMOVALS) break;
    const result = await callTemplate(clientA, "macro.items.apply", {
      mode: "remove_silence",
      target_refs: [itemRef],
      silence_threshold_dbfs: SILENCE_THRESHOLD_DBFS,
      min_silence_ms: MIN_SILENCE_MS,
      dry_run: false,
    });
    calls.remove_silence_attempts.push({ item_ref: itemRef, result });
    if (result.ok !== true) {
      assert(result.execution?.status === "blocked" && (result.result?.changes?.length ?? 0) === 0, `remove_silence partially failed for ${itemRef}: ${JSON.stringify(result.error)}`);
      continue;
    }
    assertMacroSuccess(result, `remove silence ${itemRef}`);
    assert((result.result?.changes?.length ?? 0) === 1, `remove_silence returned the wrong row count for ${itemRef}`);
    const change = result.result.changes[0];
    assertAppliedRow(change, `remove silence ${itemRef}`);
    const removedSeconds = change.live_readback?.observed_value?.removed_seconds;
    if (Number.isFinite(removedSeconds) && removedSeconds > 0) removalSuccesses.push({ item_ref: itemRef, removed_seconds: removedSeconds, change });
  }
  assert(removalSuccesses.length >= REQUIRED_REMOVALS, `Only ${removalSuccesses.length}/${REQUIRED_REMOVALS} Items had real removable silence`);

  calls.save_current = await callTemplate(clientA, "macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "save media-library evidence project");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  for (const client of clients.reverse()) {
    try { await client.close(); } catch {}
  }
}

const after = {
  source_project_sha256: await sha256(options.source_project),
  source_project_size: (await stat(options.source_project)).size,
  evidence_project: await optionalFileFacts(COPY_PROJECT),
  source_media: await Promise.all(selected.map((row) => optionalFileFacts(row.path))),
};
const sourceMediaUnchanged = sourceMediaBefore.length === REQUIRED_ASSETS
  && sourceMediaBefore.every((row, index) => row.sha256 === after.source_media[index]?.sha256 && row.size_bytes === after.source_media[index]?.size_bytes);
const report = {
  contract: "alpha3.3.media_library_silence_live_evidence.v1",
  ok: error === null,
  generated_at: new Date().toISOString(),
  evidence_root: ROOT,
  runtime: { source: "installed_wrapper", command: options.mcp_command },
  source_project: options.source_project,
  active_test_project: COPY_PROJECT,
  bridge: { transport_dir: options.transport_dir, owner: options.bridge_owner, generation: options.bridge_generation },
  budgets: { ordinary: PUBLIC_BUDGET, library_search: SEARCH_BUDGET },
  media_library: {
    database: "soundly",
    query: "kick",
    page_count: calls.search_pages.length,
    total: calls.search_pages[0]?.result?.data?.page?.total ?? null,
    every_page_within_2kib: calls.search_pages.every((page) => page.budget?.actual_bytes <= 2_048),
    cursors_advanced: calls.search_pages.every((page, index) => index === 0 || page.result?.data?.page?.offset > calls.search_pages[index - 1].result?.data?.page?.offset),
    selected: selected.map((row) => ({ filename: row.filename, path: row.path, duration_seconds: row.duration_seconds, available: row.available })),
  },
  import: {
    requested_count: REQUIRED_ASSETS,
    applied_count: importRows.filter((row) => row.status === "applied" && row.live_readback?.status === "passed").length,
    track_name: TRACK_NAME,
    rows: importRows.map((row) => ({ asset_id: row.asset_id, item_ref: row.live_readback?.item_ref, take_ref: row.live_readback?.take_ref, track_ref: row.live_readback?.track_ref, position_seconds: row.live_readback?.position_seconds, length_seconds: row.live_readback?.length_seconds, source_file_ref: row.live_readback?.source_file_ref })),
    independent_item_take_readback_count: calls.independent_readback.length,
    cross_client_exact_query_count: calls.client_b_exact_items?.result?.data?.rows?.length ?? 0,
  },
  onset_alignment: {
    analyzed_item_count: calls.selection_analysis?.result?.data?.items?.length ?? 0,
    default_transient_candidate_count: calls.selection_analysis?.result?.data?.items?.filter((row) => (row.measurements?.transients?.transient_count ?? 0) > 0).length ?? 0,
    fallback_used: calls.transient_fallbacks.length > 0,
    fallback_reason: calls.transient_fallbacks.length > 0 ? "default_timing_analysis_returned_fewer_than_two_complete_transient_candidates" : null,
    fallback_template_id: calls.transient_fallbacks.length > 0 ? "template.analysis.detect_item_transients" : null,
    transient_delta_linear: TRANSIENT_FALLBACK_DELTA,
    fallback_candidate_count: calls.transient_fallbacks.filter((row) => (summaryOf(row.result).transient_count ?? 0) > 0 && summaryOf(row.result).truncated !== true).length,
    requested_item_refs: alignedItemRefs,
    applied_count: calls.align_onsets?.result?.changes?.filter((row) => row.status === "applied" && row.live_readback?.status === "passed").length ?? 0,
  },
  silence_removal: {
    default_analyzed_candidate_count: calls.selection_analysis?.result?.data?.items?.filter((row) => (row.measurements?.silence?.segment_count ?? 0) > 0).length ?? 0,
    fallback_used: calls.silence_candidate_analysis.length > 0,
    fallback_reason: "default_timing_analysis_threshold_was_not_sufficient_for_material_selection",
    fallback_template_id: "template.analysis.detect_item_silence",
    silence_threshold_dbfs: SILENCE_THRESHOLD_DBFS,
    min_silence_ms: MIN_SILENCE_MS,
    analyzed_candidate_count: calls.silence_candidate_analysis.filter((row) => (summaryOf(row.result).segment_count ?? 0) > 0 && (summaryOf(row.result).total_silence_seconds ?? 0) > 0 && summaryOf(row.result).truncated !== true).length,
    attempted_count: calls.remove_silence_attempts.length,
    real_removed_count: removalSuccesses.length,
    successes: removalSuccesses.map((row) => ({ item_ref: row.item_ref, removed_seconds: row.removed_seconds, live_readback: row.change.live_readback })),
    attempts: calls.remove_silence_attempts.map((row) => ({ item_ref: row.item_ref, ok: row.result.ok, execution_status: row.result.execution?.status, error_code: row.result.error?.code ?? null, removed_seconds: row.result.result?.changes?.[0]?.live_readback?.observed_value?.removed_seconds ?? null })),
  },
  project_changes: {
    new_track_count: calls.import?.result?.changes?.filter((row) => row.mode === "setup" && row.setup_kind === "track" && row.status === "applied").length ?? 0,
    imported_item_count: importRows.length,
    onset_aligned_item_count: calls.align_onsets?.result?.changes?.filter((row) => row.status === "applied").length ?? 0,
    silence_edited_item_count: removalSuccesses.length,
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  recovery: {
    backup_project: BACKUP_PROJECT,
    source_project_hash_unchanged: before.source_project_sha256 === after.source_project_sha256,
    evidence_project_preserved: after.evidence_project?.exists === true,
    source_media_preserved: after.source_media.every((row) => row?.exists === true),
    source_media_hashes_unchanged: sourceMediaUnchanged,
    source_media_deleted: false,
  },
  before: { ...before, source_media: sourceMediaBefore },
  after,
  calls,
  error,
};
await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: REPORT_PATH, selected: report.media_library.selected.map((row) => ({ filename: row.filename, duration_seconds: row.duration_seconds })), imported: report.import.applied_count, aligned: report.onset_alignment.applied_count, silence_removed: report.silence_removal.real_removed_count, recovery: report.recovery, error }, null, 2)}\n`);
if (error) process.exit(1);

async function connect(name, projectPath, logicalSessionKey) {
  const client = new Client({ name, version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: options.mcp_command,
    args: [],
    cwd: path.dirname(options.mcp_command),
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
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
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000, maxTotalTimeout: 600_000 });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  return JSON.parse(text);
}

function assertSearchPage(value, { expectedOffset, stableTotal }) {
  assertMacroSuccess(value, "search Soundly kick library", { allowDryRun: true });
  const data = value.result?.data;
  const page = data?.page;
  assert(data?.mode === "search_library", `Search mode=${data?.mode}`);
  assert(Array.isArray(data.results), "Search returned no results array");
  assert(page?.offset === expectedOffset, `Search offset=${page?.offset}, expected ${expectedOffset}`);
  assert(page.returned === data.results.length, "Search page count does not match rows");
  assert(Number.isInteger(page.total) && page.total >= data.results.length, `Search total=${page.total}`);
  if (stableTotal !== null) assert(page.total === stableTotal, `Search total changed from ${stableTotal} to ${page.total}`);
  assert(value.budget?.max_bytes === 2_048, `Search max budget=${value.budget?.max_bytes}`);
  assert(value.budget?.actual_bytes <= 2_048, `Search used ${value.budget?.actual_bytes} bytes`);
  assert(value.budget?.truncated === false, "Search envelope reported truncation instead of pagination");
  assert((value.result?.changes?.length ?? -1) === 0, "Search unexpectedly returned mutation rows");
}

function assertMacroSuccess(value, label, { allowDryRun = false } = {}) {
  assert(value?.contract === "macro.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  const allowed = allowDryRun ? ["completed", "dry_run_completed"] : ["completed"];
  assert(allowed.includes(value.execution?.status), `${label} status=${value.execution?.status}`);
  assert(value.result?.verification?.status === "passed", `${label} verification=${value.result?.verification?.status}`);
  assert(value.budget?.truncated === false, `${label} response was truncated`);
}

function assertTemplateSuccess(value, label) {
  assert(value?.contract === "template.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error)}`);
  assert(value.verification?.status === "passed" || value.result?.verification?.status === "passed", `${label} verification did not pass`);
}

function assertAppliedRow(row, label) {
  assert(row?.status === "applied", `${label} status=${row?.status}`);
  assert(row.mutation?.status === "completed", `${label} mutation=${row.mutation?.status}`);
  assert(row.live_readback?.status === "passed", `${label} live_readback=${row.live_readback?.status}`);
  assert(["completed", "skipped"].includes(row.index_maintenance?.status), `${label} index_maintenance=${row.index_maintenance?.status}`);
}

function exactGuidObjectRef(kind, ref) {
  const match = new RegExp(`^${kind}:guid:(.+)$`, "u").exec(ref);
  assert(match, `Invalid ${kind} GUID ref ${ref}`);
  return { kind, ref, identity: { scheme: "guid", value: match[1] } };
}

function summaryOf(value) {
  return value?.result?.summary ?? value?.result?.readback ?? value?.result?.data ?? {};
}

function close(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= 0.000001;
}

function displayDurationMatches(actual, mediaDatabaseDuration) {
  return Number.isFinite(actual) && Number.isFinite(mediaDatabaseDuration) && Math.abs(actual - mediaDatabaseDuration) <= 0.001;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function fileFacts(row) {
  const facts = await stat(row.path);
  return { path: row.path, filename: row.filename, duration_seconds: row.duration_seconds, size_bytes: facts.size, sha256: await sha256(row.path) };
}

async function optionalFileFacts(file) {
  try {
    const facts = await stat(file);
    return { exists: true, path: file, size_bytes: facts.size, sha256: await sha256(file) };
  } catch {
    return { exists: false, path: file, size_bytes: null, sha256: null };
  }
}

async function sha256(file) {
  const { createReadStream } = await import("node:fs");
  const hash = createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = createReadStream(file);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
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
    else if (key === "--mcp-command") result.mcp_command = path.resolve(value);
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--render-root") result.render_root = path.resolve(value);
    else if (key === "--index-root") result.index_root = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.source_project || !result.transport_dir || !path.isAbsolute(result.mcp_command ?? "") || !Number.isInteger(result.bridge_generation)) {
    throw new Error("Usage: smoke-alpha3-3-media-library-silence.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> --mcp-command <installed-openreaper-mcp> [--artifact-root path] [--render-root path] [--index-root path] [--bridge-owner owner] [--bridge-generation n]");
  }
  return result;
}
