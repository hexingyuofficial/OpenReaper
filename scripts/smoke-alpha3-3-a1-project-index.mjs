#!/usr/bin/env node

import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const ROOT = options.evidence_root;
const REPO = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const SOURCE_PROJECT = options.source_project;
const TRACK_COUNT = options.track_count ?? 14;
const FIXTURE_LABEL = options.fixture_label ?? "A1";
const COPY_PROJECT = path.join(ROOT, "fixture", `Alpha33-${FIXTURE_LABEL}-${TRACK_COUNT}Track.RPP`);
const BACKUP_PROJECT = path.join(ROOT, "recovery", "Untitled-before.RPP");
const REPORT_PATH = path.join(ROOT, "reports", options.report_name ?? "alpha3-3-a1-project-index-live.json");
const STDIO = path.join(REPO, "packages/mcp-server/src/openreaper-mcp-stdio.mjs");
const MCP_COMMAND = options.mcp_command ?? process.execPath;
const MCP_ARGS = options.mcp_command ? [] : [STDIO];
const MCP_CWD = options.mcp_command ? path.dirname(options.mcp_command) : REPO;
const ARTIFACT_ROOT = options.artifact_root ?? path.join(ROOT, "artifacts");
const PUBLIC_BUDGET = {
  max_response_bytes: 65_536,
  max_items: 50,
  max_inline_value_bytes: 2_048,
};
const MINIMUM_PUBLIC_BUDGET = {
  max_response_bytes: 2_048,
  max_items: 50,
  max_inline_value_bytes: 2_048,
};
const LAYOUT_BATCH_SIZE = options.layout_batch_size ?? 14;
const TRACK_NAMES = Array.from({ length: TRACK_COUNT }, (_, index) => `A33 Highway ${String(index + 1).padStart(2, "0")}`);
const EXACT_TOOLS = ["call_template", "get_state", "list_recipes", "list_templates", "ping"];

await mkdir(path.dirname(COPY_PROJECT), { recursive: true });
await mkdir(path.dirname(BACKUP_PROJECT), { recursive: true });
await mkdir(ARTIFACT_ROOT, { recursive: true });
await mkdir(path.join(ROOT, "reports"), { recursive: true });
await mkdir(path.join(ROOT, "project-index-bootstrap"), { recursive: true });
await mkdir(path.join(ROOT, "project-index-state"), { recursive: true });
await copyFile(SOURCE_PROJECT, BACKUP_PROJECT);

const before = {
  source_sha256: await sha256(SOURCE_PROJECT),
  source_size: (await stat(SOURCE_PROJECT)).size,
  backup_sha256: await sha256(BACKUP_PROJECT),
};
const calls = {};
const clients = [];
let error = null;

try {
  const bootstrap = await connect("alpha33-a1-bootstrap", {
    OPENREAPER_CURRENT_PROJECT_PATH: SOURCE_PROJECT,
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: path.join(ROOT, "project-index-bootstrap"),
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha33-a1-bootstrap",
  });
  clients.push(bootstrap);
  const toolNames = (await bootstrap.listTools()).tools.map((tool) => tool.name).sort();
  assert(JSON.stringify(toolNames) === JSON.stringify(EXACT_TOOLS), `Unexpected MCP tools: ${JSON.stringify(toolNames)}`);
  calls.bootstrap_ping = await callTool(bootstrap, "ping", {});
  calls.save_as = await callTemplate(bootstrap, "macro.project.file", {
    operation: "save_as",
    target_path: COPY_PROJECT,
    overwrite: true,
    dry_run: false,
  });
  assertMacroSuccess(calls.save_as, "macro.project.file");
  assert(calls.save_as.result?.data?.path_after === COPY_PROJECT, "save_as did not switch to the evidence copy");
  await bootstrap.close();
  clients.pop();

  const sharedEnv = {
    OPENREAPER_CURRENT_PROJECT_PATH: COPY_PROJECT,
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: path.join(ROOT, "project-index-state"),
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha33-a1-shared",
  };
  const clientA = await connect("alpha33-a1-client-a", sharedEnv);
  clients.push(clientA);
  calls.client_a_ping = await callTool(clientA, "ping", {});

  calls.initial_track_pages = [];
  let initialCursor;
  do {
    const page = await queryTracks(clientA, {
      limit: 50,
      refresh_policy: "if_stale",
      cursor: initialCursor,
    });
    assertMacroSuccess(page, "macro.project.query");
    calls.initial_track_pages.push(page);
    initialCursor = page.result?.data?.page?.has_more === true
      ? page.result?.data?.page?.next_cursor
      : undefined;
    if (calls.initial_track_pages.length > 100) throw new Error("Initial track pagination exceeded 100 pages");
  } while (initialCursor);
  calls.initial_tracks = calls.initial_track_pages[0];
  const initialRefs = calls.initial_track_pages.flatMap((page) => page.result?.data?.rows?.map((row) => row.ref).filter(Boolean) ?? []);
  const initialKnownTotal = calls.initial_tracks.result?.data?.coverage?.known_total_row_count ?? 0;
  assert(initialRefs.length === initialKnownTotal, `Initial pagination returned ${initialRefs.length} of ${initialKnownTotal} tracks`);
  if (initialRefs.length > 0) {
    calls.delete_preview = await callTemplate(clientA, "macro.project.delete_targets", {
      refs: { tracks: initialRefs },
      delete_policy: "project_objects_only",
      dry_run: true,
    });
    assertMacroSuccess(calls.delete_preview, "macro.project.delete_targets");
    const retry = calls.delete_preview.result?.data?.executable_retry;
    assert(retry?.id === "macro.project.delete_targets", "delete preview returned no public executable retry");
    assert(calls.delete_preview.result?.data?.mutation_skipped === true, "delete preview did not report mutation_skipped");
    calls.delete_initial = await callTemplate(clientA, retry.id, retry.input);
    assertMacroSuccess(calls.delete_initial, "macro.project.delete_targets");
    assertAppliedRows(calls.delete_initial);
  }

  calls.empty_tracks = await queryTracks(clientA, { limit: 10, refresh_policy: "if_stale" });
  assertMacroSuccess(calls.empty_tracks, "macro.project.query");
  assert(calls.empty_tracks.result?.data?.rows?.length === 0, `Project was not empty before the ${TRACK_COUNT}-track fixture build`);
  assert(calls.empty_tracks.result?.data?.coverage?.complete === true, "Empty track coverage was not complete");

  calls.create_layout_batches = [];
  for (let start = 0; start < TRACK_NAMES.length; start += LAYOUT_BATCH_SIZE) {
    const names = TRACK_NAMES.slice(start, start + LAYOUT_BATCH_SIZE);
    const response = await callTemplate(clientA, "macro.project.apply_layout", {
      layout: names.map((name, offset) => ({
        id: `track_${start + offset + 1}`,
        kind: "track",
        name,
        index: start + offset,
      })),
      match_policy: "create_only",
      conflict_policy: "stop",
      dry_run: false,
    });
    const batch = {
      start_index: start,
      end_index: start + names.length - 1,
      response,
    };
    calls.create_layout_batches.push(batch);
    assertMacroSuccess(response, "macro.project.apply_layout");
    assertAppliedRows(response);
    assertLayoutOperationRows(response, { start, names });
    assert(response.result?.data?.outcome?.live_readback?.status === "passed", `Layout batch ${start / LAYOUT_BATCH_SIZE + 1} live readback was not passed`);
  }

  calls.cold_page = await queryTracks(clientA, { limit: 3, refresh_policy: "if_stale" });
  assertMacroSuccess(calls.cold_page, "macro.project.query");
  assertCoverage(calls.cold_page, TRACK_COUNT, TRACK_COUNT, Math.min(3, TRACK_COUNT));
  assert(calls.cold_page.result?.data?.refresh?.logical_refresh?.coverage?.tracks === "complete", "Track logical refresh did not commit complete coverage");
  assert(calls.cold_page.result?.data?.page?.has_more === true, "Public page did not expose has_more");

  calls.exact_name_recovery_preview = await callTemplate(clientA, "macro.project.apply_layout", {
    layout: TRACK_NAMES.map((name, index) => ({ id: `track_${index + 1}`, kind: "track", name, index })),
    match_policy: "exact_name",
    conflict_policy: "update_declared_fields",
    dry_run: true,
  });
  assertMacroSuccess(calls.exact_name_recovery_preview, "macro.project.apply_layout");
  assert(calls.exact_name_recovery_preview.result?.data?.preview?.target_counts?.matched_existing === TRACK_COUNT, "Dry-run did not recover every exact live track name");
  assert(calls.exact_name_recovery_preview.result?.data?.preview?.target_counts?.create === 0, "Dry-run still previewed recovered tracks as creates");

  calls.exact_name_recovery = await callTemplate(clientA, "macro.project.apply_layout", {
    layout: TRACK_NAMES.map((name, index) => ({ id: `track_${index + 1}`, kind: "track", name, index })),
    match_policy: "exact_name",
    conflict_policy: "update_declared_fields",
    dry_run: false,
  });
  assertMacroSuccess(calls.exact_name_recovery, "macro.project.apply_layout");
  assert(calls.exact_name_recovery.result?.changes?.length === TRACK_COUNT, "Exact-name recovery returned incomplete change rows");
  assert(calls.exact_name_recovery.result.changes.every((change) => change.status === "matched_existing" && change.mutation?.status === "not_run" && change.live_readback?.status === "passed"), "Exact-name recovery mutated or failed live readback");

  calls.minimum_budget_page = await queryTracks(clientA, {
    limit: Math.min(5, TRACK_COUNT),
    refresh_policy: "never",
    fields: ["name", "index"],
    budget: MINIMUM_PUBLIC_BUDGET,
  });
  assertMacroSuccess(calls.minimum_budget_page, "macro.project.query");
  const minimumBudgetRows = calls.minimum_budget_page.result?.data?.rows?.length ?? 0;
  const minimumBudgetCoverage = calls.minimum_budget_page.result?.data?.coverage ?? {};
  assert(minimumBudgetCoverage.known_total_row_count === TRACK_COUNT, `Minimum-budget known total was ${minimumBudgetCoverage.known_total_row_count}`);
  assert(minimumBudgetCoverage.indexed_row_count === TRACK_COUNT, `Minimum-budget indexed total was ${minimumBudgetCoverage.indexed_row_count}`);
  assert(minimumBudgetCoverage.public_returned_row_count === minimumBudgetRows, "Minimum-budget public row count did not match returned rows");
  assert(minimumBudgetRows > 0 && minimumBudgetRows <= Math.min(5, TRACK_COUNT), `Minimum-budget page returned ${minimumBudgetRows} rows`);
  assert(calls.minimum_budget_page.result?.data?.page?.has_more === true, "Minimum-budget page did not preserve pagination");
  assert(typeof calls.minimum_budget_page.result?.data?.page?.next_cursor === "string", "Minimum-budget page returned no continuation cursor");
  assert(Buffer.byteLength(JSON.stringify(calls.minimum_budget_page), "utf8") <= MINIMUM_PUBLIC_BUDGET.max_response_bytes, "Minimum-budget page exceeded 2 KiB");

  calls.exact_last = await queryTracks(clientA, {
    limit: 1,
    refresh_policy: "never",
    filters: { name: TRACK_NAMES.at(-1) },
    budget: MINIMUM_PUBLIC_BUDGET,
  });
  assertMacroSuccess(calls.exact_last, "macro.project.query");
  assert(calls.exact_last.result?.data?.rows?.[0]?.name === TRACK_NAMES.at(-1), "Exact final track was not resolved");
  assert(calls.exact_last.result?.data?.rows?.[0]?.index === TRACK_COUNT - 1, `Exact final track index was not ${TRACK_COUNT - 1}`);

  calls.warm_last = await queryTracks(clientA, {
    limit: 1,
    refresh_policy: "if_stale",
    filters: { name: TRACK_NAMES.at(-1) },
  });
  assertMacroSuccess(calls.warm_last, "macro.project.query");
  assert(calls.warm_last.sqlite?.source === "warm_index", `Expected warm_index, got ${calls.warm_last.sqlite?.source}`);

  const clientB = await connect("alpha33-a1-client-b", sharedEnv);
  clients.push(clientB);
  calls.client_b_last = await queryTracks(clientB, {
    limit: 1,
    refresh_policy: "if_stale",
    filters: { name: TRACK_NAMES.at(-1) },
  });
  assertMacroSuccess(calls.client_b_last, "macro.project.query");
  assert(calls.client_b_last.result?.data?.rows?.[0]?.name === TRACK_NAMES.at(-1), "Second client did not reuse/resolve the final track");

  const lastRef = calls.exact_last.result.data.rows[0].ref;
  const renamedLast = `${TRACK_NAMES.at(-1)} Refreshed`;
  calls.rename_last = await callTemplate(clientA, "macro.project.apply_layout", {
    layout: [{ id: `track_${TRACK_COUNT}`, kind: "track", track_ref: lastRef, name: renamedLast, index: TRACK_COUNT - 1 }],
    match_policy: "by_ref",
    conflict_policy: "update_declared_fields",
    dry_run: false,
  });
  assertMacroSuccess(calls.rename_last, "macro.project.apply_layout");
  assertAppliedRows(calls.rename_last);

  calls.refreshed_a = await queryTracks(clientA, { limit: 1, refresh_policy: "if_stale", filters: { name: renamedLast } });
  assertMacroSuccess(calls.refreshed_a, "macro.project.query");
  assert(calls.refreshed_a.result?.data?.rows?.[0]?.name === renamedLast, "Client A did not refresh after write invalidation");

  calls.refreshed_b = await queryTracks(clientB, { limit: 1, refresh_policy: "if_stale", filters: { name: renamedLast } });
  assertMacroSuccess(calls.refreshed_b, "macro.project.query");
  assert(calls.refreshed_b.result?.data?.rows?.[0]?.name === renamedLast, "Client B did not refresh after another client's write");
  assertCoverage(calls.refreshed_b, TRACK_COUNT, TRACK_COUNT, 1);

  calls.save_current = await callTemplate(clientA, "macro.project.file", { operation: "save_current", dry_run: false });
  assertMacroSuccess(calls.save_current, "macro.project.file");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  for (const client of clients.reverse()) {
    try { await client.close(); } catch {}
  }
}

const after = {
  source_sha256: await sha256(SOURCE_PROJECT),
  source_size: (await stat(SOURCE_PROJECT)).size,
  copy_exists: await exists(COPY_PROJECT),
  copy_sha256: await exists(COPY_PROJECT) ? await sha256(COPY_PROJECT) : null,
  copy_size: await exists(COPY_PROJECT) ? (await stat(COPY_PROJECT)).size : null,
};
const report = {
  contract: options.contract ?? "alpha3.3.a1.project_index_live.v1",
  ok: error === null,
  evidence_root: ROOT,
  source_project: SOURCE_PROJECT,
  active_test_project: COPY_PROJECT,
  runtime: {
    source: options.mcp_command ? "installed_wrapper" : "source_stdio",
    command: MCP_COMMAND,
    args: MCP_ARGS,
    cwd: MCP_CWD,
    artifact_root: ARTIFACT_ROOT,
  },
  public_budget: PUBLIC_BUDGET,
  minimum_public_budget: MINIMUM_PUBLIC_BUDGET,
  layout_batch_size: LAYOUT_BATCH_SIZE,
  expected_track_count: TRACK_COUNT,
  expected_last_track_name: `${TRACK_NAMES.at(-1)} Refreshed`,
  tests: {
    cold_hydration: calls.initial_tracks?.sqlite?.source ?? null,
    post_build_refresh: calls.cold_page?.sqlite?.source ?? null,
    logical_refresh: calls.cold_page?.result?.data?.refresh?.logical_refresh ?? null,
    exact_name_recovery: {
      matched_existing: calls.exact_name_recovery?.result?.changes?.filter((change) => change.status === "matched_existing").length ?? 0,
      mutation_count: calls.exact_name_recovery?.result?.data?.outcome?.mutation?.completed_count ?? null,
    },
    minimum_budget_page_bytes: calls.minimum_budget_page ? Buffer.byteLength(JSON.stringify(calls.minimum_budget_page), "utf8") : null,
    warm_reuse: calls.warm_last?.sqlite?.source ?? null,
    write_invalidation_refresh_a: calls.refreshed_a?.sqlite?.source ?? null,
    cross_client_refresh_b: calls.refreshed_b?.sqlite?.source ?? null,
    exact_last_track_resolved: calls.refreshed_b?.result?.data?.rows?.[0]?.name === `${TRACK_NAMES.at(-1)} Refreshed`,
    coverage: calls.refreshed_b?.result?.data?.coverage ?? null,
    layout_outcomes: calls.create_layout_batches?.map((batch) => ({
      start_index: batch.start_index,
      end_index: batch.end_index,
      outcome: batch.response?.result?.data?.outcome ?? null,
    })) ?? [],
  },
  project_changes: {
    initial_track_count: calls.initial_tracks?.result?.data?.coverage?.known_total_row_count ?? null,
    initial_tracks_deleted: calls.delete_initial?.result?.changes?.filter((change) => change.status === "applied").length ?? 0,
    tracks_requested: TRACK_COUNT,
    tracks_created: calls.cold_page?.result?.data?.coverage?.known_total_row_count ?? null,
    tracks_created_from_applied_change_rows: calls.create_layout_batches?.reduce((count, batch) => (
      count + (batch.response?.result?.changes ?? []).filter((change) => (
        change.status === "applied"
        && typeof change.operation_id === "string"
        && typeof change.target_ref === "string"
        && change.target_ref.startsWith("track:guid:")
      )).length
    ), 0) ?? 0,
    layout_batch_count: calls.create_layout_batches?.length ?? 0,
    layout_batches_completed: calls.create_layout_batches?.filter((batch) => batch.response?.ok === true).length ?? 0,
    final_track_renamed: calls.rename_last?.ok === true,
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

async function connect(name, overrides) {
  const client = new Client({ name, version: "0.0.0" });
  await client.connect(new StdioClientTransport({
    command: MCP_COMMAND,
    args: MCP_ARGS,
    cwd: MCP_CWD,
    env: {
      ...process.env,
      OPENREAPER_ARTIFACT_ROOT: ARTIFACT_ROOT,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: ARTIFACT_ROOT,
      ...overrides,
    },
  }));
  return client;
}

async function queryTracks(client, { limit, refresh_policy, filters = undefined, fields = ["ref", "name", "index"], budget = PUBLIC_BUDGET, cursor = undefined }) {
  return callTemplate(client, "macro.project.query", {
    entity: "tracks",
    fields,
    limit,
    refresh_policy,
    ...(filters ? { filters } : {}),
    ...(cursor ? { cursor } : {}),
  }, undefined, budget);
}

async function callTemplate(client, id, input, refs = undefined, budget = PUBLIC_BUDGET) {
  return callTool(client, "call_template", {
    id,
    input,
    ...(refs ? { refs } : {}),
    budget,
  });
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

function assertLayoutOperationRows(value, { start, names }) {
  const changes = value?.result?.changes ?? [];
  assert(changes.length === names.length, `Expected ${names.length} layout operation rows, got ${changes.length}`);
  for (const [offset, change] of changes.entries()) {
    const operationId = `track_${start + offset + 1}`;
    assert(change.operation_id === operationId, `Layout operation id mismatch: expected ${operationId}, got ${change.operation_id}`);
    assert(typeof change.target_ref === "string" && change.target_ref.startsWith("track:guid:"), `Layout ${operationId} returned no canonical target_ref`);
    assert(change.status === "applied", `Layout ${operationId} status=${change.status}`);
    assert(change.mutation?.status === "completed", `Layout ${operationId} mutation=${change.mutation?.status}`);
    assert(change.live_readback?.status === "passed", `Layout ${operationId} live_readback=${change.live_readback?.status}`);
    assert(change.index_maintenance?.status === "completed", `Layout ${operationId} index_maintenance=${change.index_maintenance?.status}`);
  }
}

function assertMacroSuccess(value, id) {
  assert(value?.contract === "macro.execution.v1", `${id} returned ${value?.contract}`);
  assert(value?.ok === true, `${id} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value?.execution?.status === "completed" || value?.execution?.status === "dry_run_completed", `${id} status=${value?.execution?.status}`);
}

function assertAppliedRows(value) {
  const changes = value?.result?.changes ?? [];
  assert(changes.length > 0, "Mutation Macro returned no change rows");
  assert(changes.every((change) => change.status === "applied"), `Non-applied change row: ${JSON.stringify(changes)}`);
  assert(changes.every((change) => change.live_readback?.status === "passed"), `Change lacked live readback: ${JSON.stringify(changes)}`);
}

function assertCoverage(value, total, indexed, returned) {
  const coverage = value?.result?.data?.coverage ?? {};
  assert(coverage.known_total_row_count === total, `known_total_row_count=${coverage.known_total_row_count}`);
  assert(coverage.indexed_row_count === indexed, `indexed_row_count=${coverage.indexed_row_count}`);
  assert(coverage.public_returned_row_count === returned, `public_returned_row_count=${coverage.public_returned_row_count}`);
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--source-project") result.source_project = path.resolve(value);
    else if (key === "--mcp-command") result.mcp_command = path.resolve(value);
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--track-count") {
      if (!/^[1-9][0-9]{0,3}$/u.test(value)) throw new Error("--track-count must be an integer from 1 to 9999");
      result.track_count = Number(value);
      if (result.track_count > 4096) throw new Error("--track-count may not exceed the Project Index row bound of 4096");
    } else if (key === "--layout-batch-size") {
      if (!/^[1-9][0-9]{0,2}$/u.test(value)) throw new Error("--layout-batch-size must be an integer from 1 to 100");
      result.layout_batch_size = Number(value);
      if (result.layout_batch_size > 100) throw new Error("--layout-batch-size may not exceed the public layout row bound of 100");
    } else if (key === "--fixture-label") {
      if (!/^[A-Za-z0-9_-]{1,32}$/u.test(value)) throw new Error("--fixture-label must be a bounded filename token");
      result.fixture_label = value;
    } else if (key === "--report-name") {
      if (!/^[A-Za-z0-9_.-]{1,128}\.json$/u.test(value) || path.basename(value) !== value) throw new Error("--report-name must be a plain .json filename");
      result.report_name = value;
    } else if (key === "--contract") {
      if (!/^[A-Za-z0-9_.-]{1,128}$/u.test(value)) throw new Error("--contract must be a bounded contract token");
      result.contract = value;
    }
    else throw new Error(`Unknown option ${key}`);
    index += 1;
  }
  if (!result.evidence_root || !result.source_project) throw new Error("Usage: smoke-alpha3-3-a1-project-index.mjs --evidence-root <fresh-root> --source-project <project.RPP> [--mcp-command /absolute/openreaper-mcp] [--artifact-root /absolute/artifacts] [--track-count N] [--layout-batch-size N]");
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
