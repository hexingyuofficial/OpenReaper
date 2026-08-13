#!/usr/bin/env node

import { createHash } from "node:crypto";
import { lstat, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const CONTRACT = "openreaper.alpha3.45.official_recipes_live_harness.v1";
const REPORT_NAME = "alpha3-45-official-recipes.json";
const MAX_REPORT_BYTES = 64 * 1024;
const OFFICIAL_IDS = Object.freeze([
  "recipe.mix.create_bus_processing",
  "recipe.midi.create_instrument_part",
]);
const OFFICIAL_OUTPUTS = Object.freeze({
  "recipe.mix.create_bus_processing": Object.freeze(["layout_changes", "routing_changes", "processing_evidence"]),
  "recipe.midi.create_instrument_part": Object.freeze(["layout_changes", "instrument_changes", "midi_evidence"]),
});
const INTERNAL_EXECUTION_SPEED_GATE_MS = 30_000;
const OFFICIAL_RECIPE_SPEED_BUDGET_MS = INTERNAL_EXECUTION_SPEED_GATE_MS;
const OFFICIAL_RECIPE_GET_BUDGET = Object.freeze({ max_response_bytes: 65_536 });
const PUBLIC_CALL_TIMEOUT_MS = 960_000;

export async function connectInstalledWrapperAlpha345({ installedWrapper, liveEnvironment = {}, clientName = "official-recipes" } = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  const client = new Client({ name: `openreaper-alpha345-${clientName}`, version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: installedWrapperEnvironmentAlpha345({ installedWrapper, liveEnvironment }),
    stderr: "pipe",
  }));
  return client;
}

export function installedWrapperEnvironmentAlpha345({
  installedWrapper,
  liveEnvironment = {},
  parentEnvironment = process.env,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  const installRoot = path.resolve(path.dirname(installedWrapper), "..");
  return {
    ...parentEnvironment,
    OPENREAPER_SESSION_ROOT: path.join(installRoot, "session"),
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: path.join(installRoot, "vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"),
    OPENREAPER_MCP_PACKAGE_ROOT: installRoot,
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: liveEnvironment.transportDir,
    OPENREAPER_LIVE_BRIDGE_OWNER: liveEnvironment.bridgeOwner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(liveEnvironment.bridgeGeneration),
    OPENREAPER_CURRENT_PROJECT_PATH: liveEnvironment.projectPath,
    OPENREAPER_PROJECT_INDEX_STATE_ROOT: liveEnvironment.indexRoot,
    OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: liveEnvironment.logicalSessionKey ?? "alpha345-official-recipes",
    OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
  };
}

export async function runAlpha345OfficialRecipesHarness({
  installedWrapper,
  evidenceRoot,
  fixture,
  executeLive = false,
  liveEnvironment = null,
  callRecipe = null,
  connectFactory = connectInstalledWrapperAlpha345,
  runForkProof = executeLive === true,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  await createFreshRoot(evidenceRoot);
  validateFixture(fixture);
  if (executeLive !== true && typeof callRecipe !== "function") throw coded("OFFICIAL_HARNESS_FAKE_CALL_REQUIRED", "Fake mode requires callRecipe.");
  if (executeLive === true && typeof connectFactory !== "function") throw coded("OFFICIAL_HARNESS_CONNECT_REQUIRED", "Live mode requires the installed-wrapper connector.");

  const started = performance.now();
  const report = {
    contract: CONTRACT,
    ok: false,
    status: executeLive ? "live" : "fake",
    runtime: { source: "installed_wrapper", command: path.resolve(installedWrapper), sha256: await sha256File(installedWrapper) },
    evidence_root: path.resolve(evidenceRoot),
    project: {
      path: fixture.project_path ?? liveEnvironment?.projectPath ?? null,
      changes: [],
      output_files: [],
      final_state: "unknown",
    },
    discovery: null,
    official_runs: [],
    fork_proof: null,
    recovery: { source_media_preserved: true, whole_recipe_undo_required: true, recovery_required: false },
    timings: { total_ms: 0, successful_run_ms: [], maximum_ms: 0 },
    error: null,
  };
  let client = null;
  try {
    let invoke = callRecipe;
    if (executeLive) {
      validateLiveEnvironment(liveEnvironment);
      client = await connectFactory({ installedWrapper, liveEnvironment, clientName: "official-recipes" });
      invoke = (args) => callPublicRecipe(client, args);
    }
    const listed = await timedCall(invoke, { operation: "list" });
    const officialItems = (listed.value?.items ?? []).filter((item) => item.source === "official");
    const byId = new Map(officialItems.map((item) => [item.recipe_id, item]));
    const officialDetails = new Map();
    for (const id of OFFICIAL_IDS) if (!byId.has(id)) throw coded("OFFICIAL_RECIPE_NOT_DISCOVERED", `${id} was not discoverable.`);
    report.discovery = { count: officialItems.length, ids: OFFICIAL_IDS, duration_ms: listed.duration_ms };

    for (const id of OFFICIAL_IDS) {
      const identity = exactIdentity(byId.get(id));
      const got = await timedCall(invoke, {
        operation: "get",
        ...identity,
        budget: OFFICIAL_RECIPE_GET_BUDGET,
      });
      if (got.value?.ok !== true || got.value?.source !== "official") throw coded("OFFICIAL_RECIPE_GET_FAILED", `${id} exact expansion failed.`);
      officialDetails.set(id, got.value);
      const run = await timedCall(invoke, { operation: "run", ...identity, inputs: fixture.inputs[id], budget: { max_response_bytes: 65_536 } });
      const row = summarizeRun(id, run, identity);
      report.official_runs.push(row);
      if (!row.ok) throw coded("OFFICIAL_RECIPE_RUN_FAILED", `${id} did not complete.`);
      if (!row.speed_ok) throw coded("OFFICIAL_RECIPE_TOO_SLOW", `${id} exceeded ${row.speed_budget_ms}ms.`);
      if (!hasOfficialRunTruth(row, fixture.inputs[id])) throw coded("OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE", `${id} lacks declared outputs, mutation/readback proof, evidence, or closed Whole-Recipe Undo.`);
    }

    if (runForkProof) {
      report.fork_proof = await runOfficialForkProof({
        invoke,
        executeLive,
        client,
        connectFactory,
        installedWrapper,
        liveEnvironment,
        fixture,
        officialDetails,
        evidenceRoot,
        onClientReplaced: (nextClient) => { client = nextClient; },
      });
      if (executeLive && report.fork_proof.reconnected !== true) {
        throw coded("OFFICIAL_FORK_RECONNECT_REQUIRED", "Live fork proof did not reconnect the installed wrapper before list/get/run.");
      }
      if (report.fork_proof.ok !== true) throw coded("OFFICIAL_FORK_PROOF_FAILED", "Official Recipe fork proof did not complete.");
    }
    report.ok = true;
    report.project.final_state = "completed";
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.error = { code: error?.code ?? "OFFICIAL_HARNESS_FAILED", message: error?.message ?? "Official Recipe harness failed." };
    report.recovery.recovery_required = true;
    report.project.final_state = "failed";
  } finally {
    if (client) await client.close().catch(() => { report.recovery.recovery_required = true; });
    report.timings.total_ms = roundMs(performance.now() - started);
    report.timings.successful_run_ms = [
      ...report.official_runs,
      ...(report.fork_proof?.forks ?? []),
    ].filter((row) => row.ok).map((row) => row.duration_ms);
    report.timings.maximum_ms = Math.max(0, ...report.timings.successful_run_ms);
    report.project.changes = [
      ...report.official_runs,
      ...(report.fork_proof?.forks ?? []),
    ].flatMap((row) => row.changes);
    report.project.output_files = unique([
      ...report.official_runs,
      ...(report.fork_proof?.forks ?? []),
    ].flatMap((row) => row.output_files));
    await writeBoundedReport(path.join(evidenceRoot, REPORT_NAME), persistedTruthSummary(report));
  }
  return report;
}

async function runOfficialForkProof({
  invoke,
  executeLive,
  client,
  connectFactory,
  installedWrapper,
  liveEnvironment,
  fixture,
  officialDetails,
  evidenceRoot,
  onClientReplaced,
} = {}) {
  const proof = {
    ok: false,
    reconnected: executeLive !== true,
    reconnect_mode: executeLive === true ? "installed_wrapper" : "fake_call_recipe",
    reconnect_count: 0,
    listed_user_count: 0,
    forks: [],
    error: null,
  };
  const prepared = [];
  const forkNonce = createHash("sha256").update(path.resolve(evidenceRoot)).digest("hex").slice(0, 8);
  let activeInvoke = invoke;
  try {
    for (const [index, officialId] of OFFICIAL_IDS.entries()) {
      const detail = officialDetails.get(officialId);
      const sourceDraft = detail?.draft ?? detail?.payload?.draft;
      if (!sourceDraft || typeof sourceDraft !== "object") {
        throw coded("OFFICIAL_FORK_DRAFT_MISSING", `${officialId} get did not return a draft.`);
      }
      const draft = structuredClone(sourceDraft);
      const userRecipeId = `recipe.user.forked_${index + 1}_${forkNonce}`;
      draft.id = userRecipeId;
      const validated = await timedCall(activeInvoke, { operation: "validate", draft });
      if (validated.value?.ok !== true || validated.value?.status !== "validated") {
        throw coded("OFFICIAL_FORK_VALIDATE_FAILED", `${officialId} fork validation failed.`);
      }
      const saved = await timedCall(activeInvoke, {
        operation: "save",
        draft,
        version: detail.version,
        revision: 1,
      });
      if (saved.value?.ok !== true || saved.value?.status !== "saved") {
        throw coded("OFFICIAL_FORK_SAVE_FAILED", `${officialId} fork save failed.`);
      }
      const identity = exactIdentity(saved.value.identity ?? saved.value);
      if (identity.recipe_id !== userRecipeId) {
        throw coded("OFFICIAL_FORK_IDENTITY_MISMATCH", `${officialId} fork save returned the wrong recipe identity.`);
      }
      prepared.push({
        official_id: officialId,
        recipe_id: userRecipeId,
        official_identity: exactIdentity(detail),
        identity,
        inputs: fixture.inputs[officialId],
        validate_ms: validated.duration_ms,
        save_ms: saved.duration_ms,
      });
    }

    if (executeLive === true) {
      if (client) await client.close().catch(() => {});
      const nextClient = await connectFactory({
        installedWrapper,
        liveEnvironment,
        clientName: "official-fork-proof",
      });
      onClientReplaced?.(nextClient);
      activeInvoke = (args) => callPublicRecipe(nextClient, args);
      proof.reconnected = true;
      proof.reconnect_count = 1;
    }

    const listed = await listAllRecipePages(activeInvoke);
    const listedItems = listed.items;
    proof.list_page_count = listed.pages.length;
    const listedById = new Map(listedItems.map((item) => [item.recipe_id, item]));
    proof.listed_user_count = prepared.filter((fork) => {
      const item = listedById.get(fork.recipe_id);
      return item?.source === "user";
    }).length;
    if (proof.listed_user_count !== prepared.length) {
      throw coded("OFFICIAL_FORK_LIST_FAILED", "Reconnect list did not expose every saved user fork.");
    }

    for (const fork of prepared) {
      const listedItem = listedById.get(fork.recipe_id);
      if (listedItem.content_hash === fork.official_identity.content_hash
        || listedItem.content_hash !== fork.identity.content_hash
        || listedItem.immutable !== true) {
        throw coded("OFFICIAL_FORK_IDENTITY_NOT_DISTINCT", `${fork.recipe_id} was not listed as a distinct immutable user revision.`);
      }
      const got = await timedCall(activeInvoke, { operation: "get", ...fork.identity });
      if (got.value?.ok !== true || got.value?.source !== "user" || got.value?.immutable !== true) {
        throw coded("OFFICIAL_FORK_GET_FAILED", `${fork.recipe_id} exact get failed after reconnect.`);
      }
      const gotIdentity = exactIdentity(got.value.identity ?? got.value);
      if (JSON.stringify(gotIdentity) !== JSON.stringify(fork.identity)
        || got.value.draft?.id !== fork.recipe_id) {
        throw coded("OFFICIAL_FORK_GET_IDENTITY_MISMATCH", `${fork.recipe_id} exact get changed immutable identity.`);
      }
      const run = await timedCall(activeInvoke, {
        operation: "run",
        ...fork.identity,
        inputs: fork.inputs,
        budget: { max_response_bytes: 65_536 },
      });
      const row = summarizeRun(fork.recipe_id, run, fork.identity, fork.official_id);
      row.official_recipe_id = fork.official_id;
      row.validation_ms = fork.validate_ms;
      row.save_ms = fork.save_ms;
      row.fork_truth = hasOfficialRunTruth(row, fork.inputs, fork.official_id);
      proof.forks.push(row);
      if (!row.ok || !row.fork_truth) {
        throw coded("OFFICIAL_FORK_RUN_TRUTH_INCOMPLETE", `${fork.recipe_id} did not prove generic mutation/readback and Whole-Recipe Undo truth.`);
      }
    }
    proof.ok = true;
  } catch (error) {
    proof.error = { code: error?.code ?? "OFFICIAL_FORK_PROOF_FAILED", message: error?.message ?? "Official Recipe fork proof failed." };
  }
  return proof;
}

async function listAllRecipePages(invoke) {
  const items = [];
  const pages = [];
  let cursor = null;
  for (let pageIndex = 0; pageIndex < 64; pageIndex += 1) {
    const args = { operation: "list", limit: 32 };
    if (cursor !== null) args.cursor = cursor;
    const listed = await timedCall(invoke, args);
    if (listed.value?.ok !== true || !Array.isArray(listed.value.items)) {
      throw coded("OFFICIAL_FORK_LIST_FAILED", "Recipe list returned an invalid page.");
    }
    const page = listed.value.page;
    items.push(...listed.value.items);
    if (!page) {
      pages.push({ cursor: cursor ?? "0", next_cursor: null, count: listed.value.items.length, duration_ms: listed.duration_ms });
      return { items, pages };
    }
    const pageCursor = typeof page.cursor === "string" ? page.cursor : cursor ?? "0";
    const nextCursor = page.next_cursor ?? null;
    if (pageCursor !== (cursor ?? "0")
      || (nextCursor !== null && (typeof nextCursor !== "string" || !/^\d+$/u.test(nextCursor)))
      || nextCursor === pageCursor
      || (page.has_more === true) !== (nextCursor !== null)) {
      throw coded("OFFICIAL_FORK_LIST_PAGING_INVALID", "Recipe list returned an invalid or non-advancing page cursor.");
    }
    pages.push({ cursor: pageCursor, next_cursor: nextCursor, count: listed.value.items.length, duration_ms: listed.duration_ms });
    if (nextCursor === null) return { items, pages };
    cursor = nextCursor;
  }
  throw coded("OFFICIAL_FORK_LIST_PAGING_LIMIT", "Recipe list exceeded the bounded 64-page fork proof limit.");
}

function summarizeRun(recipeId, call, identity, semanticRecipeId = recipeId) {
  const value = call.value ?? {};
  const verifiedOutputs = Array.isArray(value.verified_outputs)
    ? value.verified_outputs.filter((output) => output?.verified === true && typeof output?.id === "string")
    : [];
  return {
    recipe_id: recipeId,
    semantic_recipe_id: semanticRecipeId,
    identity,
    ok: value.ok === true && ["completed", "succeeded"].includes(value.status ?? value.execution?.status ?? "completed"),
    public_call_count: 1,
    duration_ms: call.duration_ms,
    speed_budget_ms: OFFICIAL_RECIPE_SPEED_BUDGET_MS,
    speed_ok: call.duration_ms < OFFICIAL_RECIPE_SPEED_BUDGET_MS,
    outputs: verifiedOutputs.map((output) => output.id).sort(),
    output_counts: Object.fromEntries(verifiedOutputs.map((output) => [output.id, Array.isArray(output.value) ? output.value.length : output.value == null ? 0 : 1])),
    output_omitted: Object.fromEntries(verifiedOutputs.map((output) => [output.id, output.value?.omitted === true])),
    output_values: Object.fromEntries(verifiedOutputs.map((output) => [output.id, output.value])),
    changes: verifiedOutputs.flatMap((output) => collectVerifiedChanges(output.value)),
    output_files: collectAbsolutePaths(value),
    evidence_refs: unique([value.evidence_ref, ...(value.undo?.evidence_refs ?? [])].filter((entry) => typeof entry === "string")),
    undo: value.undo ?? null,
    execution_truth: value.execution_truth ?? null,
    error: value.error ?? null,
  };
}

function hasOfficialRunTruth(run, _inputs, semanticRecipeId = run.semantic_recipe_id ?? run.recipe_id) {
  const expected = OFFICIAL_OUTPUTS[semanticRecipeId] ?? [];
  if (expected.length === 0 || !expected.every((id) => (
    hasNonEmptyOutput(run, id)
    || hasEvidenceBackedOmission(run, id, semanticRecipeId)
  ))) return false;
  if (run.evidence_refs.length === 0
    || run.undo?.claimed !== true
    || run.undo?.status !== "closed"
    || run.undo?.proven !== true
    || !Number.isSafeInteger(run.execution_truth?.native_mutation_count)
    || run.execution_truth.native_mutation_count < 1
    || !Number.isSafeInteger(run.execution_truth?.readback_count)
    || run.execution_truth.readback_count < 1) return false;
  const outputsProven = expected.every((id) => {
    const value = run.output_values?.[id];
    if (Array.isArray(value)) return value.length > 0 && value.every(provenOutputRow);
    return (typeof value === "string" && value.length > 0)
      || hasEvidenceBackedOmission(run, id, semanticRecipeId);
  });
  return outputsProven;
}

function provenOutputRow(row) {
  return row && typeof row === "object" && (
    (row.status === "ok" && row.mutation === "done" && row.readback === "pass")
    || (row.status === "applied"
      && row.live_readback?.status === "passed"
      && (row.mutation === undefined || row.mutation?.status === "completed"))
    || (row.status === "matched_existing"
      && row.match?.status === "matched_existing"
      && row.live_readback?.status === "passed"
      && row.mutation?.status === "completed"
      && row.mutation?.completed_count === 0)
    || (row.status === "unchanged"
      && row.mutation?.status === "not_run"
      && row.live_readback?.status === "passed")
  );
}

function hasNonEmptyOutput(run, id) {
  return run.outputs.includes(id)
    && run.output_omitted?.[id] !== true
    && Number.isInteger(run.output_counts?.[id])
    && run.output_counts[id] > 0;
}

function hasEvidenceBackedOmission(run, id, semanticRecipeId = run.semantic_recipe_id ?? run.recipe_id) {
  const value = run.output_values?.[id];
  return Boolean(semanticRecipeId)
    && run.outputs.includes(id)
    && run.output_omitted?.[id] === true
    && value?.omitted === true
    && value?.reason === "inline_value_exceeds_call_recipe_budget"
    && run.evidence_refs.length > 0;
}

async function timedCall(invoke, args) {
  const started = performance.now();
  const value = await invoke(args);
  return { value, duration_ms: roundMs(performance.now() - started) };
}

async function callPublicRecipe(client, args) {
  const response = await client.callTool(
    { name: "call_recipe", arguments: args },
    undefined,
    { timeout: PUBLIC_CALL_TIMEOUT_MS, maxTotalTimeout: PUBLIC_CALL_TIMEOUT_MS },
  );
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw coded("OFFICIAL_RECIPE_RESPONSE_INVALID", "call_recipe returned no JSON text.");
  return JSON.parse(text);
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || !fixture.inputs) throw coded("OFFICIAL_FIXTURE_REQUIRED", "fixture.inputs is required.");
  for (const id of OFFICIAL_IDS) if (!fixture.inputs[id] || typeof fixture.inputs[id] !== "object") throw coded("OFFICIAL_FIXTURE_INPUT_REQUIRED", `Missing fixture input for ${id}.`);
}

function isExactGuidRef(value, kind) {
  return typeof value === "string" && new RegExp(`^${kind}:guid:\\{[^{}]+\\}$`, "u").test(value);
}

function validateLiveEnvironment(value) {
  for (const key of ["transportDir", "artifactRoot", "renderRoot", "indexRoot", "bridgeOwner", "bridgeGeneration", "projectPath"]) {
    if (value?.[key] === undefined || value?.[key] === null || value[key] === "") throw coded("OFFICIAL_LIVE_ENVIRONMENT_INCOMPLETE", `liveEnvironment.${key} is required.`);
  }
  for (const key of ["transportDir", "artifactRoot", "renderRoot", "indexRoot", "projectPath"]) assertAbsolute(value[key], `liveEnvironment.${key}`);
}

function exactIdentity(value) {
  const identity = {
    recipe_id: value?.recipe_id,
    version: value?.version,
    revision: value?.revision,
    content_hash: value?.content_hash,
    validation_result_id: value?.validation_result_id,
  };
  if (
    typeof identity.recipe_id !== "string"
    || typeof identity.version !== "string"
    || !Number.isInteger(identity.revision)
    || typeof identity.content_hash !== "string"
    || typeof identity.validation_result_id !== "string"
    || identity.validation_result_id === ""
  ) throw coded("OFFICIAL_RECIPE_IDENTITY_INVALID", "Exact Recipe identity is incomplete.");
  return identity;
}

function collectVerifiedChanges(value) {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object");
  if (value && typeof value === "object") return [value];
  return [];
}

async function createFreshRoot(root) {
  const current = await lstat(root).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (current) {
    if (current.isSymbolicLink() || !current.isDirectory() || (await readdir(root)).length !== 0) throw coded("OFFICIAL_EVIDENCE_ROOT_NOT_FRESH", "evidenceRoot must be a fresh non-symlink directory.");
    return;
  }
  await mkdir(root, { recursive: true, mode: 0o700 });
}

async function writeBoundedReport(target, report) {
  const body = `${JSON.stringify(report, null, 2)}\n`;
  if (Buffer.byteLength(body, "utf8") > MAX_REPORT_BYTES) throw coded("OFFICIAL_REPORT_TOO_LARGE", `Report exceeds ${MAX_REPORT_BYTES} bytes.`);
  await writeFile(target, body, { encoding: "utf8", flag: "wx", mode: 0o600 });
}

function persistedTruthSummary(report) {
  const persistedForkProof = report.fork_proof == null
    ? null
    : {
      ...report.fork_proof,
      forks: (report.fork_proof.forks ?? []).map(persistedRunSummary),
    };
  return {
    ...report,
    fork_proof: persistedForkProof,
    report_storage: {
      mode: "bounded_truth_summary",
      full_evidence: "follow official_runs[].evidence_refs and fork_proof.forks[].evidence_refs",
    },
    project: {
      ...report.project,
      change_count: report.project.changes.length,
      changes: [
        ...report.official_runs,
        ...(report.fork_proof?.forks ?? []),
      ].map((row) => ({
        recipe_id: row.recipe_id,
        semantic_recipe_id: row.semantic_recipe_id,
        verified_change_count: row.changes.length,
        evidence_refs: row.evidence_refs,
      })),
    },
    official_runs: report.official_runs.map(persistedRunSummary),
  };
}

function persistedRunSummary({ output_values: _outputValues, changes, ...row }) {
  return {
    ...row,
    verified_change_count: changes.length,
  };
}

async function sha256File(file) {
  try { return createHash("sha256").update(await readFile(file)).digest("hex"); } catch { return null; }
}

function collectAbsolutePaths(value) {
  const paths = [];
  const visit = (entry) => {
    if (typeof entry === "string" && path.isAbsolute(entry)) paths.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === "object") Object.values(entry).forEach(visit);
  };
  visit(value);
  return unique(paths);
}

function unique(values) { return [...new Set(values)]; }
function roundMs(value) { return Math.round(value * 1000) / 1000; }
function assertAbsolute(value, name) { if (typeof value !== "string" || !path.isAbsolute(value)) throw coded("OFFICIAL_ABSOLUTE_PATH_REQUIRED", `${name} must be absolute.`); }
function coded(code, message) { return Object.assign(new Error(message), { code }); }

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const fixture = JSON.parse(await readFile(args.fixture, "utf8"));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: args.installed_wrapper,
    evidenceRoot: args.evidence_root,
    fixture,
    executeLive: true,
    liveEnvironment: fixture.live_environment,
  });
  process.stdout.write(`${JSON.stringify({ ok: report.ok, contract: CONTRACT, evidence: path.join(args.evidence_root, REPORT_NAME) })}\n`);
  if (!report.ok) process.exitCode = 1;
}

function parseArgs(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key === "--installed-wrapper") result.installed_wrapper = value;
    else if (key === "--evidence-root") result.evidence_root = value;
    else if (key === "--fixture") result.fixture = value;
    else throw coded("OFFICIAL_ARGUMENT_INVALID", `Unknown argument ${key}.`);
  }
  for (const key of ["installed_wrapper", "evidence_root", "fixture"]) assertAbsolute(result[key], key);
  return result;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  await main();
}

export {
  CONTRACT as ALPHA3_45_OFFICIAL_RECIPES_HARNESS_CONTRACT,
  INTERNAL_EXECUTION_SPEED_GATE_MS as ALPHA4_INTERNAL_EXECUTION_SPEED_GATE_MS,
  OFFICIAL_IDS as ALPHA3_45_OFFICIAL_RECIPE_IDS,
};
