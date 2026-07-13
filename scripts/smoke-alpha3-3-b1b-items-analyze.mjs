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
const COPY_PROJECT = path.join(ROOT, "fixture", "Alpha33-B1b-Items-Analyze.RPP");
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Untitled-before.RPP");
const WAV_SOURCE = path.join(ROOT, "source-media", "alpha33-b1b-analysis.wav");
const ARTIFACT_ROOT = path.join(ROOT, "artifacts");
const RENDER_ROOT = path.join(ROOT, "renders");
const INDEX_ROOT = path.join(ROOT, "project-index-state");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-b1b-items-analyze-live.json");
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
  client = await connect(SOURCE_PROJECT, "alpha33-b1b-bootstrap");
  calls.ping = await callTool(client, "ping", {});
  calls.menu = await callTool(client, "list_templates", {});
  calls.manual = await callTool(client, "list_templates", {
    ids: ["macro.items.analyze"],
    fields: ["id"],
  });
  assertAlpha33Surface(calls);

  calls.save_as = await callTemplate("macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "macro.project.file");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch to the evidence copy");
  await client.close();
  client = await connect(COPY_PROJECT, "alpha33-b1b-live");

  calls.import_wav = await callTemplate("macro.media.place_assets", {
    assets: [{
      id: "b1b_wav",
      path: WAV_SOURCE,
      track_name: "A33 B1b WAV",
      create_track: true,
      track_index: 0,
      position_seconds: 0,
      preserve_selection: true,
    }],
    dry_run: false,
  });
  assertMacroSuccess(calls.import_wav, "macro.media.place_assets");
  const wavItemRef = requireCanonicalRef(calls.import_wav, "item:", "WAV import item");

  calls.analyze_wav = await analyzeItem(wavItemRef, 2);
  assertAnalysis(calls.analyze_wav, { label: "WAV", itemRef: wavItemRef, expectedSampleRate: 48_000, expectedChannels: 2 });
  calls.wav_artifacts = await readArtifacts(calls.analyze_wav.result.artifact_refs);
  assertArtifactReads(calls.wav_artifacts, "WAV");

  calls.render_ogg = await callTemplate("macro.render.targets", {
    target_kind: "explicit_items",
    format: "ogg",
    item_refs: [wavItemRef],
    sample_rate_hz: 48_000,
    channel_count: 2,
    ogg_quality: 0.8,
    max_targets: 1,
    dry_run: false,
  });
  assertMacroSuccess(calls.render_ogg, "macro.render.targets");
  assert(calls.render_ogg.result?.verification?.status === "passed", "OGG render verification did not pass");
  const oggPath = calls.render_ogg.result?.data?.outputs?.[0]?.absolute_path;
  assert(typeof oggPath === "string" && path.extname(oggPath).toLowerCase() === ".ogg", "OGG render returned no .ogg output path");
  const oggStats = await stat(oggPath);
  const oggHeader = (await readFile(oggPath)).subarray(0, 4).toString("ascii");
  assert(oggStats.isFile() && oggStats.size > 0 && oggHeader === "OggS", "Rendered OGG file is missing, empty, or has the wrong container header");

  calls.import_ogg = await callTemplate("macro.media.place_assets", {
    assets: [{
      id: "b1b_ogg",
      path: oggPath,
      track_name: "A33 B1b OGG",
      create_track: true,
      track_index: 1,
      position_seconds: 3,
      preserve_selection: true,
    }],
    dry_run: false,
  });
  assertMacroSuccess(calls.import_ogg, "macro.media.place_assets");
  const oggItemRef = requireCanonicalRef(calls.import_ogg, "item:", "OGG import item");

  calls.analyze_ogg = await analyzeItem(oggItemRef, 2);
  assertAnalysis(calls.analyze_ogg, { label: "OGG", itemRef: oggItemRef, expectedSampleRate: 48_000, expectedChannels: 2 });
  calls.ogg_artifacts = await readArtifacts(calls.analyze_ogg.result.artifact_refs);
  assertArtifactReads(calls.ogg_artifacts, "OGG");

  calls.quick_selected = await callTemplate("macro.items.analyze", {
    profile: "quick",
    target: "selected",
    limit: 1,
  });
  assertMacroSuccess(calls.quick_selected, "macro.items.analyze quick");
  assert(calls.quick_selected.result?.data?.returned_target_count === 1, "quick selected analysis did not return one Item");

  calls.limited_wav = await callTemplate("macro.items.analyze", {
    profile: "audio",
    target_refs: [wavItemRef],
    range: { start_seconds: 0, end_seconds: 0.5 },
    output: "artifact_when_large",
  });
  assertMacroSuccess(calls.limited_wav, "macro.items.analyze limited WAV");
  assert(calls.limited_wav.result?.data?.items?.[0]?.measurements?.sample_peaks?.coverage?.range_complete === true, "bounded WAV range did not report complete native peak coverage");

  calls.save_current = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "macro.project.file");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  try { await client?.close(); } catch {}
}

const renderOutputs = calls.render_ogg?.result?.data?.outputs ?? [];
const after = {
  source_project_sha256: await sha256(SOURCE_PROJECT),
  source_project_size: (await stat(SOURCE_PROJECT)).size,
  evidence_copy_exists: await exists(COPY_PROJECT),
  evidence_copy_sha256: await exists(COPY_PROJECT) ? await sha256(COPY_PROJECT) : null,
  evidence_copy_size: await exists(COPY_PROJECT) ? (await stat(COPY_PROJECT)).size : null,
  wav_source_exists: await exists(WAV_SOURCE),
  rendered_outputs: await Promise.all(renderOutputs.map(async (output) => ({
    ...output,
    exists: await exists(output.absolute_path),
    size: await exists(output.absolute_path) ? (await stat(output.absolute_path)).size : null,
  }))),
};
const report = {
  contract: "alpha3.3.b1b.items_analyze_live.v1",
  ok: error === null,
  evidence_root: ROOT,
  source_project: SOURCE_PROJECT,
  active_test_project: COPY_PROJECT,
  transport: {
    directory: options.transport_dir,
    owner: options.bridge_owner,
    generation: options.bridge_generation,
  },
  public_budget: PUBLIC_BUDGET,
  tests: {
    visible_macro_count: calls.menu?.items?.filter((item) => item.action_kind === "macro").length ?? null,
    items_analyze_visible: calls.menu?.items?.some((item) => item.id === "macro.items.analyze") ?? false,
    exact_manual_runnable: calls.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0]?.runnable ?? false,
    wav_analysis: analysisOutcome(calls.analyze_wav),
    wav_cross_metric_consistency: crossMetricConsistency(calls.analyze_wav),
    ogg_analysis: analysisOutcome(calls.analyze_ogg),
    ogg_cross_metric_consistency: crossMetricConsistency(calls.analyze_ogg),
    quick_selected: analysisOutcome(calls.quick_selected),
    bounded_range: analysisOutcome(calls.limited_wav),
    wav_artifacts_read: artifactOutcome(calls.wav_artifacts),
    ogg_artifacts_read: artifactOutcome(calls.ogg_artifacts),
    ogg_render: renderOutcome(calls.render_ogg),
  },
  project_changes: {
    wav_track_and_item_created: calls.import_wav?.ok === true,
    ogg_track_and_item_created: calls.import_ogg?.ok === true,
    analysis_mutation_rows: [calls.analyze_wav, calls.analyze_ogg, calls.quick_selected, calls.limited_wav]
      .reduce((count, value) => count + (value?.result?.changes?.length ?? 0), 0),
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: after.rendered_outputs,
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
  const activeClient = new Client({ name: "alpha33-b1b-items-analyze-live", version: "0.0.0" });
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

async function analyzeItem(itemRef, endSeconds) {
  return callTemplate("macro.items.analyze", {
    profile: "full",
    target_refs: [itemRef],
    range: { start_seconds: 0, end_seconds: endSeconds },
    channel_policy: "combined",
    output: "artifact_when_large",
  });
}

async function readArtifacts(refs) {
  const rows = [];
  for (const artifactRef of refs ?? []) {
    rows.push({
      artifact_ref: artifactRef,
      summary: await callTool(client, "get_state", { scope: "artifact", artifact_ref: artifactRef, view: "summary", budget: PUBLIC_BUDGET }),
      payload: await callTool(client, "get_state", { scope: "artifact", artifact_ref: artifactRef, view: "payload", budget: PUBLIC_BUDGET }),
    });
  }
  return rows;
}

function assertAlpha33Surface(value) {
  const visibleIds = value.menu?.items?.filter((item) => item.action_kind === "macro").map((item) => item.id) ?? [];
  assert(visibleIds.length === 13, `Expected 13 visible executable Macros, got ${visibleIds.length}`);
  assert(visibleIds.includes("macro.items.analyze"), "macro.items.analyze is not visible");
  const expansion = value.manual?.product_surface?.agent_context_macro_guide?.requested_expansions?.items?.[0];
  assert(expansion?.id === "macro.items.analyze" && expansion.runnable === true, "Exact items.analyze manual is not runnable");
  assert(expansion.action_manual?.input_shape?.profile?.includes("quick | audio | timing | full"), "Exact manual does not expose the accepted profiles");
}

function assertAnalysis(value, { label, itemRef, expectedSampleRate, expectedChannels }) {
  assertMacroSuccess(value, `macro.items.analyze ${label}`);
  assert(value.macro?.id === "macro.items.analyze", `${label} analysis returned the wrong Macro identity`);
  assert(value.result?.changes?.length === 0, `${label} analysis returned mutation rows`);
  assert(value.result?.data?.mutation?.occurred === false, `${label} analysis reported a mutation`);
  const row = value.result?.data?.items?.[0];
  assert(row?.item_ref === itemRef, `${label} analysis did not round-trip the exact item_ref`);
  assert(row?.measurement_basis?.includes("source_media_calculate_normalization"), `${label} RMS/LUFS native basis missing`);
  assert(row?.measurement_basis?.includes("active_take_native_peak_blocks"), `${label} native peak basis missing`);
  assert(row?.measurement_basis?.includes("active_take_audio_accessor_pre_fx_samples"), `${label} timing basis missing`);
  const rms = row?.measurements?.rms;
  const peaks = row?.measurements?.sample_peaks;
  const silence = row?.measurements?.silence;
  const transients = row?.measurements?.transients;
  for (const [name, metric] of Object.entries({ rms, peaks, silence, transients })) {
    assert(metric && metric.measurement_basis, `${label} ${name} measurement_basis missing`);
    assert(metric.sample_rate === expectedSampleRate, `${label} ${name} sample_rate=${metric.sample_rate}`);
    assert(metric.channels === expectedChannels, `${label} ${name} channels=${metric.channels}`);
    assert(metric.coverage?.range_complete === true, `${label} ${name} range coverage is incomplete`);
    assert(metric.truncated === false, `${label} ${name} was silently truncated`);
  }
  assert(Number.isFinite(rms.rms_dbfs) && Number.isFinite(rms.lufs_i), `${label} RMS/LUFS facts are not finite`);
  assert(Number.isFinite(peaks.abs_peak_linear) && peaks.abs_peak_linear >= 0 && peaks.abs_peak_linear <= 1024, `${label} sample peak is physically implausible`);
  assert(peaks.true_peak_available === true && Number.isFinite(peaks.true_peak_dbfs), `${label} native true-peak fact is unavailable`);
  assert(Number.isInteger(silence.total_detected) && Number.isInteger(silence.returned_count), `${label} silence coverage counts missing`);
  assert(
    rms.rms_dbfs <= silence.threshold_dbfs || silence.total_silence_seconds < rms.duration_seconds,
    `${label} silence analysis contradicts the measured RMS by marking the complete audible range silent`,
  );
  assert(Number.isInteger(transients.total_detected), `${label} transient total count missing`);
  assert(value.result?.artifact_refs?.length === 4, `${label} analysis did not return four artifacts`);
}

function assertArtifactReads(rows, label) {
  assert(Array.isArray(rows) && rows.length === 4, `${label} artifact read count is not four`);
  for (const row of rows) {
    assert(row.summary?.ok === true, `${label} artifact summary read failed for ${row.artifact_ref}`);
    assert(row.payload?.ok === true, `${label} artifact payload read failed for ${row.artifact_ref}`);
    const summary = row.summary?.result?.artifact?.summary;
    const payload = row.payload?.result?.artifact?.payload;
    assert(summary && typeof summary.measurement_basis === "string", `${label} artifact summary measurement_basis missing`);
    assert(payload && typeof payload === "object", `${label} artifact payload missing`);
  }
}

function assertMacroSuccess(value, id) {
  assert(value?.contract === "macro.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value.execution?.status === "completed", `${id} status=${value.execution?.status}`);
  assert(value.budget?.truncated === false, `${id} result was truncated`);
}

function requireCanonicalRef(value, prefix, label) {
  const ref = value?.result?.canonical_refs?.find((entry) => typeof entry === "string" && entry.startsWith(prefix));
  assert(typeof ref === "string", `${label} canonical ref missing`);
  return ref;
}

function analysisOutcome(value) {
  return value ? {
    ok: value.ok,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? null,
    profile: value.result?.data?.profile ?? null,
    returned_target_count: value.result?.data?.returned_target_count ?? null,
    artifact_count: value.result?.artifact_refs?.length ?? 0,
    measurement_basis: value.result?.data?.measurement_basis ?? [],
    result_bytes: value.budget?.actual_bytes ?? null,
  } : null;
}

function crossMetricConsistency(value) {
  const measurements = value?.result?.data?.items?.[0]?.measurements;
  const rms = measurements?.rms;
  const silence = measurements?.silence;
  return {
    rms_above_silence_threshold: Number.isFinite(rms?.rms_dbfs)
      && Number.isFinite(silence?.threshold_dbfs)
      && rms.rms_dbfs > silence.threshold_dbfs,
    complete_range_not_all_silent: Number.isFinite(rms?.duration_seconds)
      && Number.isFinite(silence?.total_silence_seconds)
      && silence.total_silence_seconds < rms.duration_seconds,
  };
}

function artifactOutcome(rows) {
  return {
    count: rows?.length ?? 0,
    summary_ok: rows?.every((row) => row.summary?.ok === true) ?? false,
    payload_ok: rows?.every((row) => row.payload?.ok === true) ?? false,
  };
}

function renderOutcome(value) {
  return value ? {
    ok: value.ok,
    execution_status: value.execution?.status ?? null,
    verification_status: value.result?.verification?.status ?? null,
    outputs: value.result?.data?.outputs ?? [],
    artifact_refs: value.result?.artifact_refs ?? [],
  } : null;
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
    let sample = 0;
    if (time >= 0.25 && time < 1.75) sample = Math.sin(2 * Math.PI * 440 * time) * 0.45;
    if (frame === Math.floor(sampleRate * 0.5) || frame === Math.floor(sampleRate * 1.0)) sample = 0.9;
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
    throw new Error("Usage: smoke-alpha3-3-b1b-items-analyze.mjs --evidence-root <fresh-root> --source-project <project.RPP> --transport-dir <bridge-transport> [--bridge-owner owner] [--bridge-generation n]");
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
