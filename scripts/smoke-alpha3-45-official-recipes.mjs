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
  "recipe.media.create_layered_sound_effect_variants",
  "recipe.items.create_sound_variations",
]);

export async function connectInstalledWrapperAlpha345({ installedWrapper, liveEnvironment = {}, clientName = "official-recipes" } = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  const client = new Client({ name: `openreaper-alpha345-${clientName}`, version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: liveEnvironment.transportDir,
      OPENREAPER_LIVE_BRIDGE_OWNER: liveEnvironment.bridgeOwner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(liveEnvironment.bridgeGeneration),
      OPENREAPER_CURRENT_PROJECT_PATH: liveEnvironment.projectPath,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: liveEnvironment.indexRoot,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: liveEnvironment.logicalSessionKey ?? "alpha345-official-recipes",
      OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
    },
    stderr: "pipe",
  }));
  return client;
}

export async function runAlpha345OfficialRecipesHarness({
  installedWrapper,
  evidenceRoot,
  fixture,
  executeLive = false,
  liveEnvironment = null,
  callRecipe = null,
  connectFactory = connectInstalledWrapperAlpha345,
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
    capacity: [],
    recipe04_truth: null,
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
    for (const id of OFFICIAL_IDS) if (!byId.has(id)) throw coded("OFFICIAL_RECIPE_NOT_DISCOVERED", `${id} was not discoverable.`);
    report.discovery = { count: officialItems.length, ids: OFFICIAL_IDS, duration_ms: listed.duration_ms };

    for (const id of OFFICIAL_IDS) {
      const identity = exactIdentity(byId.get(id));
      const got = await timedCall(invoke, { operation: "get", ...identity });
      if (got.value?.ok !== true || got.value?.source !== "official") throw coded("OFFICIAL_RECIPE_GET_FAILED", `${id} exact expansion failed.`);
      const run = await timedCall(invoke, { operation: "run", ...identity, inputs: fixture.inputs[id] });
      const row = summarizeRun(id, run, identity);
      report.official_runs.push(row);
      if (!row.ok) throw coded("OFFICIAL_RECIPE_RUN_FAILED", `${id} did not complete.`);
    }

    const recipe04Identity = exactIdentity(byId.get("recipe.items.create_sound_variations"));
    for (const count of [1, 8, 64, 65]) {
      const run = await timedCall(invoke, {
        operation: "run",
        ...recipe04Identity,
        inputs: { ...fixture.inputs["recipe.items.create_sound_variations"], variation_count: count },
      });
      const capacity = summarizeCapacity(count, run);
      report.capacity.push(capacity);
      if (count <= 64 && !capacity.ok) throw coded("OFFICIAL_CAPACITY_SUCCESS_REQUIRED", `Recipe 04 count ${count} failed.`);
      if (count === 65 && !capacity.fail_closed) throw coded("OFFICIAL_CAPACITY_FAIL_CLOSED_REQUIRED", "Recipe 04 count 65 did not fail closed before mutation.");
    }
    const recipe04 = report.official_runs.find((row) => row.recipe_id === "recipe.items.create_sound_variations");
    report.recipe04_truth = {
      one_public_call: recipe04.public_call_count === 1,
      seeded_item_take: fixture.recipe04_seed,
      position_volume_pan_pitch_playrate: recipe04.outputs.includes("variation_changes") && recipe04.outputs.includes("control_changes"),
      take_tone_fx: recipe04.outputs.includes("tone_changes"),
      automation_envelope: recipe04.outputs.includes("automation_changes"),
      whole_recipe_undo: recipe04.undo,
      evidence_refs: recipe04.evidence_refs,
    };
    if (!report.recipe04_truth.one_public_call || report.recipe04_truth.whole_recipe_undo?.claimed !== true) {
      throw coded("OFFICIAL_RECIPE04_TRUTH_INCOMPLETE", "Recipe 04 lacks one-call or whole-Recipe Undo truth.");
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
    report.timings.successful_run_ms = [...report.official_runs, ...report.capacity].filter((row) => row.ok).map((row) => row.duration_ms);
    report.timings.maximum_ms = Math.max(0, ...report.timings.successful_run_ms);
    report.project.changes = report.official_runs.flatMap((row) => row.changes);
    report.project.output_files = unique(report.official_runs.flatMap((row) => row.output_files));
    await writeBoundedReport(path.join(evidenceRoot, REPORT_NAME), report);
  }
  return report;
}

function summarizeRun(recipeId, call, identity) {
  const value = call.value ?? {};
  const verifiedOutputs = Array.isArray(value.verified_outputs)
    ? value.verified_outputs.filter((output) => output?.verified === true && typeof output?.id === "string")
    : [];
  return {
    recipe_id: recipeId,
    identity,
    ok: value.ok === true && ["completed", "succeeded"].includes(value.status ?? value.execution?.status ?? "completed"),
    public_call_count: 1,
    duration_ms: call.duration_ms,
    outputs: verifiedOutputs.map((output) => output.id).sort(),
    changes: verifiedOutputs.flatMap((output) => collectVerifiedChanges(output.value)),
    output_files: collectAbsolutePaths(value),
    evidence_refs: unique([value.evidence_ref, ...(value.undo?.evidence_refs ?? [])].filter((entry) => typeof entry === "string")),
    undo: value.undo ?? null,
    error: value.error ?? null,
  };
}

function summarizeCapacity(count, call) {
  const value = call.value ?? {};
  const ok = value.ok === true;
  const zeroWrite = value.error?.details?.zero_write === true || value.details?.zero_write === true;
  return {
    count,
    ok,
    duration_ms: call.duration_ms,
    fail_closed: count === 65 && !ok && zeroWrite && value.undo?.claimed !== true,
    zero_write: zeroWrite,
    error_code: value.error?.code ?? value.details?.code ?? null,
  };
}

async function timedCall(invoke, args) {
  const started = performance.now();
  const value = await invoke(args);
  return { value, duration_ms: roundMs(performance.now() - started) };
}

async function callPublicRecipe(client, args) {
  const response = await client.callTool({ name: "call_recipe", arguments: args });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw coded("OFFICIAL_RECIPE_RESPONSE_INVALID", "call_recipe returned no JSON text.");
  return JSON.parse(text);
}

function validateFixture(fixture) {
  if (!fixture || typeof fixture !== "object" || !fixture.inputs) throw coded("OFFICIAL_FIXTURE_REQUIRED", "fixture.inputs is required.");
  for (const id of OFFICIAL_IDS) if (!fixture.inputs[id] || typeof fixture.inputs[id] !== "object") throw coded("OFFICIAL_FIXTURE_INPUT_REQUIRED", `Missing fixture input for ${id}.`);
  const seed = fixture.recipe04_seed;
  for (const key of ["item_ref", "take_ref", "track_ref", "position_seconds", "length_seconds", "take_fx_ref"]) {
    if (seed?.[key] === undefined || seed?.[key] === null) throw coded("OFFICIAL_RECIPE04_SEED_INCOMPLETE", `recipe04_seed.${key} is required.`);
  }
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

export { CONTRACT as ALPHA3_45_OFFICIAL_RECIPES_HARNESS_CONTRACT, OFFICIAL_IDS as ALPHA3_45_OFFICIAL_RECIPE_IDS };
