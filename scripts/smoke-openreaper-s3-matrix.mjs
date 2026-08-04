#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  buildS3AudioRunRow,
  resultData,
  summarizeS3Result,
} from "./lib/s3-release-matrix-results.mjs";

const args = parseArgs(process.argv.slice(2));
const ROOT = args.evidence_root;
const REPO = path.resolve(args.repo ?? path.join(import.meta.dirname, ".."));
const STDIO = args.mcp_command;
const TRANSPORT = args.transport_dir;
const OWNER = args.bridge_owner;
const GENERATION = Number(args.bridge_generation);
const ARTIFACT_ROOT = path.join(ROOT, "session", "artifacts");
const INDEX_ROOT = path.join(ROOT, "session", "project-index");
const RENDER_ROOT = path.join(ROOT, "renders");
const SOURCE_ROOT = path.join(ROOT, "source-media");
const INPUT_ROOT = path.join(ROOT, "input");
const FIXTURE_ROOT = path.join(ROOT, "fixture");
const PROJECT_COPY = path.join(FIXTURE_ROOT, "S3-Release-Matrix.RPP");
const PUBLIC_BUDGET = { max_response_bytes: 65_536, max_items: 128, max_inline_value_bytes: 12_000 };
const scopes = ["all", "leading", "trailing", "edges", "internal"];
const metrics = ["lufs_i", "rms_i", "peak", "true_peak", "lufs_m_max", "lufs_s_max"];
const SHORT_GAPS = Object.freeze([[0.25, 0.55], [0.85, 1.15], [1.45, 1.75]]);
const SCOPE_GAPS = Object.freeze([[0, 0.30], [0.85, 1.15], [1.70, 2.0]]);
const AUDIO_PARAMS = Object.freeze({
  silence_threshold_dbfs: -40,
  min_silence_ms: 200,
  keep_before_ms: 20,
  keep_after_ms: 20,
  min_kept_audio_ms: 80,
  fade_ms: 5,
});
const calls = [];
const clients = [];

await mkdir(ROOT, { recursive: true });
await Promise.all([
  mkdir(SOURCE_ROOT, { recursive: true }),
  mkdir(INPUT_ROOT, { recursive: true }),
  mkdir(FIXTURE_ROOT, { recursive: true }),
  mkdir(ARTIFACT_ROOT, { recursive: true }),
  mkdir(INDEX_ROOT, { recursive: true }),
  mkdir(RENDER_ROOT, { recursive: true }),
]);

const sourceProjectCopy = path.join(INPUT_ROOT, path.basename(args.source_project));
await copyFile(args.source_project, sourceProjectCopy);
const dialogue = path.join(SOURCE_ROOT, "对话 279秒.wav");
const short = path.join(SOURCE_ROOT, "短音频 Unicode.wav");
const scopeFixture = path.join(SOURCE_ROOT, "scope-edges Unicode.wav");
const tone = path.join(SOURCE_ROOT, "无静音 tone.wav");
const silent = path.join(SOURCE_ROOT, "全静音 silent.wav");
await copyFile(args.dialogue_media, dialogue);
await writeWav(short, { seconds: 2, gaps: SHORT_GAPS });
await writeWav(scopeFixture, { seconds: 2, gaps: SCOPE_GAPS });
await writeWav(tone, { seconds: 2, gaps: [] });
await writeWav(silent, { seconds: 1, gaps: [[0, 1]] });

const before = await manifest([args.source_project, args.dialogue_media, sourceProjectCopy, dialogue, scopeFixture, short, tone, silent]);
let error = null;
let scopeRows = [];
let dialogueRows = [];
let silenceEightRows = [];
let silenceSixtyFourRows = [];
let normalizeMetricRows = [];
let normalizeSixtyFourRows = [];
let overflowRows = [];
let silentRef = null;
let toneRef = null;
let midiTrackRef = null;
let midiRef = null;
let action = null;
let repeatRuns = { dialogue: [], eight: [], sixty_four: [] };
const result = {
  scopes: {},
  normalization: {},
  fail_closed: {},
  hashes: {},
  performance: { dialogue: [], eight: [], sixty_four: [], normalization_sixty_four: [] },
  placement_readback: {},
};

try {
  const bootstrap = await connect("s3-macos-bootstrap", args.source_project, `s3-macos-bootstrap-${Date.now()}`);
  clients.push(bootstrap);
  const currentPath = await callTemplate(bootstrap, "template.project.read_current_project_path", {});
  record("current_path", currentPath);
  assertTemplate(currentPath, "current project path");
  action = await callTemplate(bootstrap, "macro.project.file", { operation: "save_as", target_path: PROJECT_COPY, overwrite: true, dry_run: false });
  record("save_as", action);
  assertMacro(action, "save evidence project");
  await closeClient(bootstrap);
  clients.pop();

  const shared = `s3-macos-matrix-${Date.now()}`;
  const client = await connect("s3-macos-matrix", PROJECT_COPY, shared);
  clients.push(client);
  const ping = await callTool(client, "ping", {});
  record("ping", ping);

  scopeRows = await place(client, scopeFixture, scopes.length, "scope", "stack_on_separate_tracks");
  dialogueRows = await place(client, dialogue, 3, "dialogue", "stack_on_separate_tracks");
  for (let run = 0; run < 3; run += 1) {
    silenceEightRows.push(await place(client, short, 8, `eight-${run + 1}`, "stack_on_separate_tracks"));
    silenceSixtyFourRows.push(await placeMany(client, short, 64, `sixty-four-${run + 1}`, "stack_on_separate_tracks"));
  }
  for (const metric of metrics) {
    normalizeMetricRows.push({
      metric,
      rows: await place(client, short, 8, `normalize-${metric}`, "stack_on_separate_tracks"),
    });
  }
  for (let run = 0; run < 3; run += 1) {
    normalizeSixtyFourRows.push(await placeMany(client, short, 64, `normalize-sixty-four-${run + 1}`, "stack_on_separate_tracks"));
  }
  overflowRows = await placeMany(client, short, 65, "overflow-65", "stack_on_separate_tracks");
  const silentRows = await place(client, silent, 1, "silent", "one_new_track_per_asset");
  const toneRows = await place(client, tone, 1, "tone", "one_new_track_per_asset");
  silentRef = assetRef(silentRows[0]);
  toneRef = assetRef(toneRows[0]);
  midiTrackRef = toneRows[0]?.track_ref ?? null;

  result.placement_readback = {
    scopes: await readPlacementRows(client, scopeRows),
    dialogue: await readPlacementRows(client, dialogueRows),
    eight: await readPlacementRows(client, silenceEightRows.flat()),
    sixty_four: await readPlacementRows(client, silenceSixtyFourRows.flat()),
    normalize: await readPlacementRows(client, normalizeMetricRows.flatMap((set) => set.rows)),
    normalize_sixty_four: await readPlacementRows(client, normalizeSixtyFourRows.flat()),
    silent: await readPlacementRows(client, silentRows),
    tone: await readPlacementRows(client, toneRows),
  };

  for (let index = 0; index < scopes.length; index += 1) {
    const row = await runAudio(client, "remove_silence", [assetRef(scopeRows[index])], {
      silence_scope: scopes[index],
      keep_before_ms: 0,
      keep_after_ms: 0,
    }, `scope-${scopes[index]}`);
    result.scopes[scopes[index]] = row;
    row.before_item = scopeRows[index].before_item ?? null;
    row.interval_readback = await readTrackIntervals(client, scopeRows[index], row.before_item);
  }
  for (const [index, placed] of dialogueRows.entries()) {
    const row = await runAudio(client, "remove_silence", [assetRef(placed)], {}, `dialogue-${index + 1}`);
    result.performance.dialogue.push(row);
    repeatRuns.dialogue.push(row);
  }

  for (const [index, placed] of silenceEightRows.entries()) {
    const row = await runAudio(client, "remove_silence", placed.map(assetRef), {}, `eight-${index + 1}`);
    result.performance.eight.push(row);
    repeatRuns.eight.push(row);
  }
  for (const [index, placed] of silenceSixtyFourRows.entries()) {
    const row = await runAudio(client, "remove_silence", placed.map(assetRef), {}, `sixty-four-${index + 1}`);
    result.performance.sixty_four.push(row);
    repeatRuns.sixty_four.push(row);
  }
  for (const { metric, rows } of normalizeMetricRows) {
    const row = await runAudio(client, "normalize_level", rows.map(assetRef), { normalization_metric: metric, normalization_target: -18 }, `normalize-${metric}`);
    result.normalization[metric] = row;
  }
  for (const [index, placed] of normalizeSixtyFourRows.entries()) {
    const row = await runAudio(client, "normalize_level", placed.map(assetRef), { normalization_metric: "peak", normalization_target: -6 }, `normalize-sixty-four-${index + 1}`);
    result.performance.normalization_sixty_four.push(row);
  }

  result.fail_closed.too_many_targets = await callTemplate(client, "macro.items.apply", {
    mode: "remove_silence", target: "exact", target_refs: overflowRows.map(assetRef), dry_run: false,
  });
  result.fail_closed.midi = await tryCreateAndRejectMidi(client, midiTrackRef);
  result.fail_closed.all_silent = await runAudio(client, "remove_silence", [silentRef], {}, "all-silent");
  result.fail_closed.no_silence = await runAudio(client, "remove_silence", [toneRef], {}, "no-silence");
  result.fail_closed.stale_ref = await callTemplate(client, "macro.items.apply", {
    mode: "remove_silence", target: "exact", target_refs: ["item:guid:{S3-STale-REF}"], dry_run: false,
  });
  result.fail_closed.invalid_ref = await callTemplate(client, "macro.items.apply", {
    mode: "remove_silence", target: "exact", target_refs: ["item:index:1"], dry_run: false,
  });
  result.hashes.macro_scope = result.scopes.all?.plan_hash ?? null;
  result.hashes.macro_normalize = result.normalization.lufs_i?.plan_hash ?? null;
  result.hashes.action_contract = {
    action_names: ["OpenReaper: Remove Silence...", "OpenReaper: Repeat Remove Silence with Last Settings"],
    shared_capability: "template.items.split_item_by_silence",
    plan_hash_field: "plan_hash",
    source: "reaper/actions/OpenReaper/remove-silence-shared.lua",
  };
  const save = await callTemplate(client, "macro.project.file", { operation: "save_current", dry_run: false });
  record("save_current", save);
  assertMacro(save, "save matrix project");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  for (const client of clients.reverse()) await closeClient(client);
}

const after = await manifest([args.source_project, args.dialogue_media, sourceProjectCopy, dialogue, short, scopeFixture, tone, silent, PROJECT_COPY]);
const report = {
  contract: "openreaper.s3.macOS.live_matrix.v1",
  ok: error === null && releaseMatrixPasses(result),
  generated_at: new Date().toISOString(),
  evidence_root: ROOT,
  product: { repo: REPO, mcp_command: STDIO, transport: TRANSPORT, owner: OWNER, generation: GENERATION, source_project: args.source_project, candidate: args.candidate ?? null },
  fixture: {
    project: PROJECT_COPY,
    dialogue_media: dialogue,
    short_media: short,
    scope_fixture: scopeFixture,
    tone_media: tone,
    silent_media: silent,
    dialogue_expected_duration_seconds: 279,
    dialogue_expected_gaps_at_least: 130,
    scope_source_gaps: SCOPE_GAPS,
  },
  requirements: {
    silence_scopes: scopes,
    normalization_metrics: metrics,
    target_cap: 64,
    zero_write_at: 65,
    internal_release_gate_ms: 30000,
    dialogue_runs: 3,
    eight_item_runs: 3,
    sixty_four_item_runs: 3,
    normalization_sixty_four_item_runs: 3,
  },
  results: result,
  repeat_runs: repeatRuns,
  before,
  after,
  preservation: { source_project_unchanged: before[args.source_project]?.sha256 === after[args.source_project]?.sha256, source_dialogue_unchanged: before[args.dialogue_media]?.sha256 === after[args.dialogue_media]?.sha256, generated_sources_unchanged: [dialogue, scopeFixture, short, tone, silent].every((file) => before[file]?.sha256 === after[file]?.sha256), source_media_deleted: false },
  calls: calls.map(({ label, value }) => ({ label, ok: value?.ok ?? null, error_code: value?.error?.code ?? null })),
  validation: releaseMatrixValidation(result),
  error,
};
const reportPath = path.join(ROOT, "reports", "s3-macos-live-matrix.json");
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: reportPath, error }, null, 2)}\n`);
if (error) process.exitCode = 1;

async function connect(name, projectPath, sessionKey) {
  const client = new Client({ name, version: "0.1.0-alpha.1" });
  await client.connect(new StdioClientTransport({
    command: process.platform === "win32" ? "powershell.exe" : STDIO,
    args: process.platform === "win32"
      ? ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", STDIO]
      : [],
    cwd: REPO,
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: TRANSPORT,
      OPENREAPER_LIVE_BRIDGE_OWNER: OWNER,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(GENERATION),
      OPENREAPER_LIVE_BRIDGE_SESSION_ID: sessionKey,
      OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: RENDER_ROOT,
      OPENREAPER_CURRENT_PROJECT_PATH: projectPath,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: INDEX_ROOT,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: sessionKey,
    },
  }));
  return client;
}

async function callTemplate(client, id, input, refs = undefined) {
  return callTool(client, "call_template", { id, input, ...(refs ? { refs } : {}), budget: PUBLIC_BUDGET });
}

async function callTool(client, name, argumentsValue) {
  const started = performance.now();
  const response = await client.callTool({ name, arguments: argumentsValue }, undefined, { timeout: 300_000, maxTotalTimeout: 600_000 });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  const value = JSON.parse(text);
  const elapsed = performance.now() - started;
  calls.push({ label: `${name}:${argumentsValue?.id ?? ""}`, value, elapsed_ms: elapsed });
  return value;
}

async function place(client, file, count, label, placementMode) {
  const assets = Array.from({ length: count }, (_, index) => ({ id: `${label}-${index + 1}`, path: file }));
  const input = placementMode === "stack_on_separate_tracks"
    ? { assets, placement: { mode: placementMode, start_seconds: 0 }, track_policy: "one_new_track_per_asset", new_track: { name_prefix: `S3 ${label}` }, dry_run: false }
    : { assets, placement: { mode: "sequence_on_one_track", start_seconds: 0, gap_seconds: 0.05 }, track_policy: "one_shared_new_track", new_track: { name: `S3 ${label}` }, dry_run: false };
  const value = await callTemplate(client, "macro.media.place_assets", input);
  assertMacro(value, `place ${label}`);
  const rows = value.result?.changes?.filter((row) => row.asset_id) ?? [];
  if (rows.length !== count) throw new Error(`place ${label} returned ${rows.length}/${count} asset rows`);
  const trackChange = value.result?.changes?.find((row) =>
    typeof row?.track_ref === "string" && row.track_ref.startsWith("track:")
    || typeof row?.target_ref === "string" && row.target_ref.startsWith("track:")
  );
  for (const row of rows) row.track_ref = row.track_ref ?? trackChange?.track_ref ?? trackChange?.target_ref ?? null;
  return rows;
}

async function placeMany(client, file, count, label, placementMode) {
  const rows = [];
  for (let offset = 0; offset < count; offset += 8) {
    const batchCount = Math.min(8, count - offset);
    rows.push(...await place(client, file, batchCount, `${label}-${offset + 1}`, placementMode));
  }
  if (rows.length !== count) throw new Error(`placeMany ${label} returned ${rows.length}/${count} asset rows`);
  return rows;
}

async function runAudio(client, mode, refs, extra, label) {
  const started = performance.now();
  const value = await callTemplate(client, "macro.items.apply", {
    mode,
    target: "exact",
    target_refs: refs,
    dry_run: false,
    ...(mode === "remove_silence" ? { ...AUDIO_PARAMS, silence_scope: "all", ...extra } : extra),
  });
  const elapsed = performance.now() - started;
  // Query templates place their payload under result.summary. Keep the
  // readback parser aligned with the public template envelope so a valid
  // Track item list is not mistaken for an empty result.
  const row = buildS3AudioRunRow(value, { label, refs, elapsedMs: elapsed });
  if (refs.length <= 8) row.raw_data = resultData(value);
  return row;
}

async function readPlacementRows(client, rows) {
  const output = [];
  for (const row of rows) {
    const itemRef = assetRef(row);
    if (typeof itemRef !== "string" || !itemRef.startsWith("item:guid:")) {
      output.push({ item_ref: itemRef ?? null, ok: false, blocker: "PLACEMENT_ITEM_REF_NOT_EXACT" });
      continue;
    }
    const item = await callTemplate(client, "template.items.read_item_summary", { include_take_summary: true }, {
      item_ref: exactGuidObjectRef("item", itemRef),
    });
    const summary = item.result?.summary ?? item.result?.data ?? item.result?.readback ?? {};
    const readback = {
      item_ref: itemRef,
      item_ok: item.ok === true,
      item_error_code: item.error?.code ?? null,
      item_reason_code: item.error?.details?.reason_code ?? null,
      track_ref: summary.track_ref ?? null,
      active_take_ref: summary.active_take_ref ?? null,
      position_seconds: summary.position_seconds ?? null,
      length_seconds: summary.length_seconds ?? null,
      active_take_name: summary.active_take_name ?? null,
    };
    row.track_ref = readback.track_ref ?? row.track_ref ?? null;
    row.before_item = {
      item_ref: readback.item_ref,
      track_ref: readback.track_ref,
      position_seconds: readback.position_seconds,
      length_seconds: readback.length_seconds,
      active_take_name: readback.active_take_name,
    };
    if (typeof readback.active_take_ref === "string" && readback.active_take_ref.startsWith("take:guid:")) {
      const source = await callTemplate(client, "template.media.read_take_source", {}, {
        take_ref: exactGuidObjectRef("take", readback.active_take_ref),
      });
      const sourceSummary = source.result?.summary ?? source.result?.data ?? source.result?.readback ?? {};
      readback.source = {
        ok: source.ok === true,
        error_code: source.error?.code ?? null,
        reason_code: source.error?.details?.reason_code ?? null,
        take_ref: sourceSummary.take_ref ?? null,
        filename: sourceSummary.filename ?? null,
        file_ref: sourceSummary.file_ref ?? null,
        source_type: sourceSummary.source_type ?? null,
        length_seconds: sourceSummary.length_seconds ?? null,
        channel_count: sourceSummary.channel_count ?? null,
        offline: sourceSummary.offline ?? null,
      };
    } else {
      readback.source = { ok: false, blocker: "PLACEMENT_ACTIVE_TAKE_REF_NOT_EXACT" };
    }
    output.push(readback);
  }
  return output;
}

async function readTrackIntervals(client, placedRow, beforeItem) {
  const trackRef = placedRow?.track_ref ?? beforeItem?.track_ref;
  if (typeof trackRef !== "string" || !trackRef.startsWith("track:guid:")) {
    return { ok: false, blocker: "SCOPE_TRACK_REF_NOT_EXACT", intervals: [] };
  }
  const value = await callTemplate(client, "template.items.list_items_on_track", {
    limit: 64,
    include_take_summary: false,
  }, { track_ref: exactGuidObjectRef("track", trackRef) });
  const data = value.result?.summary ?? value.result?.data ?? value.result ?? {};
  const items = Array.isArray(data.items) ? data.items : [];
  const intervals = items
    .map((item) => ({
      item_ref: item.item_ref ?? item.ref ?? item.live_readback?.item_ref ?? null,
      start_seconds: item.position_seconds ?? item.position ?? null,
      end_seconds: Number.isFinite(item.position_seconds) && Number.isFinite(item.length_seconds)
        ? item.position_seconds + item.length_seconds
        : null,
    }))
    .filter((item) => Number.isFinite(item.start_seconds) && Number.isFinite(item.end_seconds))
    .sort((left, right) => left.start_seconds - right.start_seconds);
  const start = Number(beforeItem?.position_seconds);
  const end = Number(beforeItem?.position_seconds) + Number(beforeItem?.length_seconds);
  const gaps = [];
  let cursor = Number.isFinite(start) ? start : null;
  for (const item of intervals) {
    if (cursor !== null && item.start_seconds > cursor + 0.00001) {
      gaps.push({ start_seconds: cursor, end_seconds: item.start_seconds });
    }
    cursor = Math.max(cursor ?? item.end_seconds, item.end_seconds);
  }
  if (cursor !== null && Number.isFinite(end) && end > cursor + 0.00001) {
    gaps.push({ start_seconds: cursor, end_seconds: end });
  }
  return {
    ok: value.ok === true,
    track_ref: trackRef,
    item_count: items.length,
    intervals,
    removed_gaps: gaps,
    item_before: beforeItem ?? null,
  };
}

function exactGuidObjectRef(kind, ref) {
  const prefix = `${kind}:guid:`;
  if (typeof ref !== "string" || !ref.startsWith(prefix) || ref.length <= prefix.length) throw new Error(`Expected exact ${kind} ref, got ${ref}`);
  return { kind, ref, identity: { scheme: "guid", value: ref.slice(prefix.length) } };
}

function releaseMatrixRows(result) {
  return [
    ...Object.values(result.scopes ?? {}),
    ...(result.performance?.dialogue ?? []),
    ...(result.performance?.eight ?? []),
    ...(result.performance?.sixty_four ?? []),
    ...Object.values(result.normalization ?? {}),
    ...(result.performance?.normalization_sixty_four ?? []),
  ];
}

function releaseMatrixValidation(result) {
  const rows = releaseMatrixRows(result);
  const placement = Object.fromEntries(Object.entries(result.placement_readback ?? {}).map(([key, values]) => [
    key,
    {
      count: values.length,
      failed: values.filter((value) => value.item_ok !== true || value.source?.ok !== true).length,
      unique_track_count: new Set(values.map((value) => value.track_ref).filter(Boolean)).size,
    },
  ]));
  const failClosed = {
    too_many_targets: summarize(result.fail_closed?.too_many_targets),
    midi: result.fail_closed?.midi?.reject ?? summarize(result.fail_closed?.midi),
    all_silent: summarize(result.fail_closed?.all_silent),
    no_silence: summarize(result.fail_closed?.no_silence),
    stale_ref: summarize(result.fail_closed?.stale_ref),
    invalid_ref: summarize(result.fail_closed?.invalid_ref),
  };
  const normalFailures = rows.filter((row) => row?.ok !== true || Number(row.elapsed_ms) >= 30_000).map((row) => ({ label: row.label, ok: row.ok, error_code: row.error_code, reason_code: row.reason_code, elapsed_ms: row.elapsed_ms }));
  const scopeIntervals = Object.fromEntries(scopes.map((scope) => [scope, validateScopeIntervals(scope, result.scopes?.[scope]?.interval_readback)]));
  const dialogueRuns = result.performance?.dialogue ?? [];
  const eightRuns = result.performance?.eight ?? [];
  const sixtyFourRuns = result.performance?.sixty_four ?? [];
  const normalizationSixtyFourRuns = result.performance?.normalization_sixty_four ?? [];
  const largeBatchEvidence = [...sixtyFourRuns, ...normalizationSixtyFourRuns].map((row) => ({
    label: row.label,
    artifact_refs: row.artifact_refs,
    aggregate_readback_count: row.aggregate_readback_count,
    evidence_ok: row.artifact_refs.length > 0 || row.aggregate_readback_count === row.target_count,
  }));
  const freshRunCounts = {
    dialogue: dialogueRuns.length,
    eight: eightRuns.length,
    sixty_four: sixtyFourRuns.length,
    normalization_sixty_four: normalizationSixtyFourRuns.length,
  };
  const zeroWrite = failClosed.too_many_targets.error_code === "ITEM_APPLY_TARGET_LIMIT_EXCEEDED"
    && failClosed.too_many_targets.zero_write === true
    && failClosed.midi.ok === false
    && /midi|unsupported/i.test(failClosed.midi.error_message ?? failClosed.midi.error_code ?? "")
    && failClosed.all_silent.status === "ALL_SILENT_RETAINED"
    && failClosed.no_silence.status === "UNCHANGED"
    && failClosed.stale_ref.ok === false
    && failClosed.stale_ref.zero_write === true
    && failClosed.invalid_ref.ok === false
    && failClosed.invalid_ref.zero_write === true;
  return {
    normal_failures: normalFailures,
    placement,
    fail_closed: failClosed,
    scope_intervals: scopeIntervals,
    fresh_run_counts: freshRunCounts,
    large_batch_evidence: largeBatchEvidence,
    zero_write_contract: zeroWrite,
  };
}

function validateScopeIntervals(scope, intervalReadback) {
  const actual = Array.isArray(intervalReadback?.removed_gaps) ? intervalReadback.removed_gaps : [];
  const expected = SCOPE_GAPS
    .filter(([start, end]) => {
      const leading = start === 0;
      const trailing = end === 2;
      if (scope === "all") return true;
      if (scope === "leading") return leading;
      if (scope === "trailing") return trailing;
      if (scope === "edges") return leading || trailing;
      return !leading && !trailing;
    })
    .map(([start_seconds, end_seconds]) => ({ start_seconds, end_seconds }));
  const tolerance = 0.01;
  const matches = actual.length === expected.length && expected.every((expectedGap, index) => {
    const observed = actual[index];
    return Math.abs(observed.start_seconds - expectedGap.start_seconds) <= tolerance
      && Math.abs(observed.end_seconds - expectedGap.end_seconds) <= tolerance;
  });
  return {
    ok: intervalReadback?.ok === true && matches,
    expected,
    actual,
    blocker: intervalReadback?.blocker ?? null,
  };
}

function releaseMatrixPasses(result) {
  const validation = releaseMatrixValidation(result);
  return validation.normal_failures.length === 0
    && Object.values(validation.placement).every((value) => value.failed === 0)
    && Object.values(validation.scope_intervals).every((value) => value.ok === true)
    && validation.fresh_run_counts.dialogue === 3
    && validation.fresh_run_counts.eight === 3
    && validation.fresh_run_counts.sixty_four === 3
    && validation.fresh_run_counts.normalization_sixty_four === 3
    && validation.large_batch_evidence.every((value) => value.evidence_ok)
    && validation.zero_write_contract;
}

async function tryCreateAndRejectMidi(client, trackRef) {
  try {
    if (typeof trackRef !== "string" || !trackRef.startsWith("track:guid:")) {
      return { attempted: false, blocker: { code: "MIDI_SETUP_TRACK_REF_MISSING", message: "S3 could not obtain the exact new Track ref needed for a valid MIDI fixture." } };
    }
    const created = await callTemplate(
      client,
      "macro.midi.apply",
      {
        mode: "create_clips",
        start_seconds: 0,
        duration_quarter_notes: 4,
        notes: [
          { start_offset_quarter_notes: 0, end_offset_quarter_notes: 1, pitch: 60, velocity: 90, channel: 0 },
        ],
        dry_run: false,
      },
      { track_ref: trackRef },
    );
    midiRef = created.result?.data?.item_ref ?? null;
    const value = await callTemplate(client, "macro.items.apply", { mode: "remove_silence", target: "exact", target_refs: midiRef ? [midiRef] : [], dry_run: false });
    return { create: summarize(created), reject: summarize(value), midi_ref: midiRef };
  } catch (caught) {
    return { attempted: true, blocker: { code: caught?.code ?? "MIDI_SETUP_FAILED", message: caught?.message ?? String(caught) } };
  }
}

function assetRef(row) { return row.live_readback?.item_ref ?? row.item_ref ?? row.target_ref; }
function summarize(value) {
  return summarizeS3Result(value);
}
function assertMacro(value, label) { if (value?.contract !== "macro.execution.v1" || value.ok !== true) throw new Error(`${label} failed: ${JSON.stringify(value?.error ?? value)}`); }
function assertTemplate(value, label) { if (value?.contract !== "template.execution.v1" || value.ok !== true) throw new Error(`${label} failed: ${JSON.stringify(value?.error ?? value)}`); }
async function closeClient(client) { try { await client.close(); } catch {} }
function record(label, value) { calls.push({ label, value }); }

async function manifest(files) {
  const output = {};
  for (const file of [...new Set(files)]) {
    try { output[file] = { exists: true, size: (await stat(file)).size, sha256: createHash("sha256").update(await readFile(file)).digest("hex") }; }
    catch { output[file] = { exists: false, size: null, sha256: null }; }
  }
  return output;
}

async function writeWav(file, { seconds, gaps }) {
  const sampleRate = 48_000;
  const frames = sampleRate * seconds;
  const pcm = Buffer.alloc(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    const time = frame / sampleRate;
    const silentFrame = gaps.some(([start, end]) => time >= start && time < end);
    const sample = silentFrame ? 0 : Math.sin(2 * Math.PI * 220 * time) * 0.35;
    pcm.writeInt16LE(Math.round(sample * 32767), frame * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0); header.writeUInt32LE(36 + pcm.length, 4); header.write("WAVE", 8); header.write("fmt ", 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(sampleRate, 24); header.writeUInt32LE(sampleRate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(pcm.length, 40);
  await writeFile(file, Buffer.concat([header, pcm]));
}

function parseArgs(argv) {
  const value = {};
  for (let index = 0; index < argv.length; index += 2) value[argv[index].replace(/^--/, "").replaceAll("-", "_")] = argv[index + 1];
  for (const key of ["evidence_root", "source_project", "dialogue_media", "mcp_command", "transport_dir"]) if (!value[key]) throw new Error(`Missing --${key.replaceAll("_", "-")}`);
  value.evidence_root = path.resolve(value.evidence_root); value.source_project = path.resolve(value.source_project); value.dialogue_media = path.resolve(value.dialogue_media); value.mcp_command = path.resolve(value.mcp_command); value.transport_dir = path.resolve(value.transport_dir); value.bridge_owner ??= "openreaper-alpha"; value.bridge_generation ??= "1";
  return value;
}
