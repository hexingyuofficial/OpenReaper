#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const reportPath = path.join(options.evidence_root, "reports", "alpha3-3-third-party-fx-breadth-live.json");
const publicBudget = { max_response_bytes: 65_536, max_items: 1_000, max_inline_value_bytes: 12_000 };
const pluginCases = [
  {
    id: "h_delay",
    query: "H-Delay",
    exact_name: "VST3: H-Delay Stereo (Waves)",
  },
  {
    id: "snap_heap",
    query: "Snap Heap",
    exact_name: "AU: Snap Heap (Kilohearts)",
  },
];
const selectedPluginCases = options.case_id
  ? pluginCases.filter((pluginCase) => pluginCase.id === options.case_id)
  : pluginCases;
assert(selectedPluginCases.length > 0, `Unknown --case-id ${options.case_id}`);
const calls = { plugins: {} };
const results = [];
let client;
let error = null;

await mkdir(path.dirname(reportPath), { recursive: true });
const before = {
  project_sha256: await sha256(options.project_path),
  project_size: (await stat(options.project_path)).size,
};

try {
  client = new Client({ name: "alpha33-third-party-fx-breadth-live", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: options.mcp_command,
    args: [],
    cwd: path.dirname(options.mcp_command),
    env: {
      ...process.env,
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: options.transport_dir,
      OPENREAPER_LIVE_BRIDGE_OWNER: options.bridge_owner,
      OPENREAPER_LIVE_BRIDGE_GENERATION: String(options.bridge_generation),
      OPENREAPER_CURRENT_PROJECT_PATH: options.project_path,
      OPENREAPER_PROJECT_INDEX_STATE_ROOT: options.index_root,
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha33-third-party-fx-breadth-live",
      OPENREAPER_ARTIFACT_ROOT: options.artifact_root,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: options.artifact_root,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: options.render_root,
    },
  }));

  calls.ping = await callTool("ping", {});
  for (const pluginCase of selectedPluginCases) {
    results.push(await exercisePlugin(pluginCase));
  }

  calls.save_current = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacro(calls.save_current, "save third-party FX evidence project");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  await client?.close().catch(() => {});
}

const report = {
  contract: "alpha3.3.third_party_fx_breadth.live_evidence.v1",
  ok: error === null,
  generated_at: new Date().toISOString(),
  evidence_root: options.evidence_root,
  runtime: { source: "installed_wrapper", command: options.mcp_command },
  project_path: options.project_path,
  bridge: { owner: options.bridge_owner, generation: options.bridge_generation },
  before,
  after: {
    project_sha256: await sha256(options.project_path),
    project_size: (await stat(options.project_path)).size,
  },
  plugins: results,
  project_changes: {
    tracks_created: results.filter((row) => row.track_ref).length,
    fx_created: results.filter((row) => row.fx_ref).length,
    parameter_writes: results.reduce((count, row) => count + row.parameter_writes.length, 0),
    automation_envelopes: results.filter((row) => row.automation?.envelope_ref).length,
    automation_points_created: results.reduce((count, row) => count + (row.automation?.points.length ?? 0), 0),
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  source_media_deleted: false,
  recovery: { evidence_project_preserved: true },
  calls,
  error,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({
  ok: report.ok,
  report: reportPath,
  plugins: report.plugins.map((row) => ({
    id: row.id,
    exact_plugin_name: row.exact_plugin_name,
    parameter_count: row.parameter_inventory.parameter_count,
    returned_count: row.parameter_inventory.returned_count,
    page_count: row.parameter_inventory.page_count,
    complete: row.parameter_inventory.complete,
    writes: row.parameter_writes,
    automation: row.automation && {
      parameter: row.automation.parameter,
      envelope_ref: row.automation.envelope_ref,
      applied: row.automation.applied,
      points: row.automation.points,
    },
  })),
  error,
}, null, 2)}\n`);
if (error) process.exit(1);

async function exercisePlugin(pluginCase) {
  const pluginCalls = {};
  calls.plugins[pluginCase.id] = pluginCalls;
  pluginCalls.search = await callTemplate("template.fx.search_installed_fx", {
    query: pluginCase.query,
    limit: 100,
    offset: 0,
  });
  assertTemplate(pluginCalls.search, `search installed ${pluginCase.query}`);
  const installedRows = pluginCalls.search.result?.summary?.rows ?? [];
  const exactPlugin = installedRows.find((row) => row.name === pluginCase.exact_name);
  assert(exactPlugin, `Exact ${pluginCase.exact_name} not found: ${JSON.stringify(installedRows)}`);

  pluginCalls.create_track = await callTemplate("template.tracks.create_track", {
    name: `Alpha33 Third-Party ${pluginCase.query}`,
  });
  assertTemplate(pluginCalls.create_track, `create ${pluginCase.query} track`);
  const trackRef = requireRef(pluginCalls.create_track, "track", `created ${pluginCase.query} track`);

  pluginCalls.add_fx = await callTemplate("template.fx.add_track_fx", {
    plugin_name: exactPlugin.name,
  }, { track_ref: objectRef(trackRef, "track") });
  assertTemplate(pluginCalls.add_fx, `add ${pluginCase.query}`);
  const fxRef = requireRef(pluginCalls.add_fx, "fx", `added ${pluginCase.query}`);

  pluginCalls.fx_summary = await callTemplate("template.fx.read_fx_summary", {}, {
    fx_ref: objectRef(fxRef, "fx"),
  });
  assertTemplate(pluginCalls.fx_summary, `read ${pluginCase.query} summary`);

  const parameterPages = [];
  const parameters = await readAllParameters(fxRef, pluginCase.query, parameterPages);
  const parameterCount = pluginCalls.fx_summary.result?.summary?.parameter_count;
  assert(parameters.length === parameterCount, `Expected ${parameterCount} ${pluginCase.query} parameters, got ${parameters.length}`);
  const candidateProfiles = await profileCandidates(fxRef, parameters);
  const continuous = candidateProfiles.find((row) => row.classification === "continuous");
  const discrete = candidateProfiles.find((row) => row.classification === "discrete");
  assert(continuous, `${pluginCase.query} exposed no usable continuous host parameter`);

  const parameterWrites = [];
  parameterWrites.push(await writeProfileTarget(fxRef, continuous, "continuous"));
  if (discrete && discrete.parameter.param_index !== continuous.parameter.param_index) {
    parameterWrites.push(await writeProfileTarget(fxRef, discrete, "discrete"));
  }

  const automationTargets = chooseDistinctTargets(continuous.samples);
  pluginCalls.automation = await callTemplate("macro.automation.apply", {
    mode: "insert_fx_parameter_points",
    fx_refs: [fxRef],
    fx_parameter: {
      param_index: continuous.parameter.param_index,
      param_ident: continuous.parameter.param_ident,
      create_if_missing: true,
    },
    points: [
      { time_seconds: 0, value: automationTargets[0].probe_normalized_value, shape: 0, tension: 0, selected: false },
      { time_seconds: 4, value: automationTargets[1].probe_normalized_value, shape: 0, tension: 0, selected: false },
    ],
    dry_run: false,
  });
  assertMacro(pluginCalls.automation, `write ${pluginCase.query} parameter automation`);
  const automationChange = pluginCalls.automation.result?.changes?.[0];
  assert(automationChange?.applied === true, `${pluginCase.query} automation was not applied: ${JSON.stringify(automationChange)}`);
  assert(automationChange.live_readback?.status === "passed", `${pluginCase.query} automation live readback did not pass`);
  const envelopeRef = automationChange.live_readback?.envelope_ref;
  assert(/^envelope:guid:/u.test(envelopeRef), `${pluginCase.query} automation returned no canonical Envelope GUID`);

  pluginCalls.automation_points = await callTemplate("template.automation.read_envelope_points", {
    autoitem_index: -1,
    cursor: "0",
    limit: 64,
  }, { envelope_ref: objectRef(envelopeRef, "envelope") });
  assertTemplate(pluginCalls.automation_points, `read ${pluginCase.query} automation points`);
  const points = pluginCalls.automation_points.result?.summary?.points ?? [];
  assert(pluginCalls.automation_points.result?.summary?.truncated === false, `${pluginCase.query} automation point readback was truncated`);
  assert(points.length === 2, `Expected 2 ${pluginCase.query} automation points, got ${points.length}`);
  assert(pointMatches(points[0], 0, automationTargets[0].probe_normalized_value), `${pluginCase.query} first automation point mismatched`);
  assert(pointMatches(points[1], 4, automationTargets[1].probe_normalized_value), `${pluginCase.query} second automation point mismatched`);

  return {
    id: pluginCase.id,
    exact_plugin_name: exactPlugin.name,
    track_ref: trackRef,
    fx_ref: fxRef,
    parameter_inventory: {
      parameter_count: parameterCount,
      returned_count: parameters.length,
      page_count: parameterPages.length,
      complete: parameterPages.at(-1)?.result?.summary?.inventory_complete === true,
      coverage_status: parameterPages.at(-1)?.result?.summary?.coverage_status,
      parameters,
    },
    candidate_profiles: candidateProfiles,
    parameter_writes: parameterWrites,
    automation: {
      parameter: compactParameter(continuous.parameter),
      targets: automationTargets,
      envelope_ref: envelopeRef,
      applied: automationChange.applied,
      mutation: automationChange.mutation,
      live_readback: automationChange.live_readback,
      index_maintenance: automationChange.index_maintenance,
      points,
    },
    installed_rows: installedRows,
  };
}

async function readAllParameters(fxRef, label, parameterPages) {
  let offset = 0;
  const rows = [];
  while (true) {
    const page = await callTemplate("template.fx.list_fx_parameters", { limit: 64, offset }, { fx_ref: objectRef(fxRef, "fx") });
    assertTemplate(page, `list ${label} parameters at offset ${offset}`);
    const summary = page.result?.summary ?? {};
    assert(summary.offset === offset, `${label} page offset mismatch: ${summary.offset} !== ${offset}`);
    assert(summary.returned_count === summary.parameters?.length, `${label} page count mismatch at ${offset}`);
    parameterPages.push(page);
    rows.push(...(summary.parameters ?? []));
    if (summary.next_offset == null) {
      assert(summary.truncated === false && summary.inventory_complete === true && summary.coverage_status === "complete", `${label} final parameter page was not complete`);
      break;
    }
    assert(summary.truncated === true && summary.inventory_complete === false && summary.coverage_status === "paged", `${label} intermediate page claimed complete coverage`);
    assert(Number.isInteger(summary.next_offset) && summary.next_offset > offset, `${label} returned invalid next_offset ${summary.next_offset}`);
    offset = summary.next_offset;
  }
  assert(new Set(rows.map((row) => row.param_index)).size === rows.length, `${label} parameter pages contained duplicate indexes`);
  return rows;
}

async function profileCandidates(fxRef, parameters) {
  const excludedNames = /^(?:bank|bypass|delta|midi cc|preset|program|wet)$/iu;
  const candidates = parameters.filter((row) => (
    typeof row.param_ident === "string"
    && row.param_ident.length > 0
    && typeof row.name === "string"
    && !excludedNames.test(row.name.trim())
  ));
  const profiles = [];
  for (const parameter of candidates.slice(0, 32)) {
    const samples = [];
    for (const probeNormalizedValue of [0, 0.125, 0.25, 0.5, 0.75, 0.875, 1]) {
      const read = await readParameter(fxRef, parameter, probeNormalizedValue);
      samples.push({ ...compactParameter(read), probe_normalized_value: probeNormalizedValue });
    }
    const meaningful = samples.filter((row) => !/^\s*(?:-|n\/a)?\s*$/iu.test(String(row.formatted_value)));
    const uniqueFormatted = [...new Set(meaningful.map((row) => row.formatted_value))];
    const uniqueNumeric = [...new Set(meaningful.map((row) => parseFormattedNumber(row.formatted_value)).filter(Number.isFinite))];
    const classification = uniqueNumeric.length >= 4
      ? "continuous"
      : uniqueFormatted.length >= 2
        ? "discrete"
        : "constant";
    profiles.push({
      parameter: compactParameter(parameter),
      classification,
      unique_formatted_values: uniqueFormatted,
      unique_numeric_values: uniqueNumeric,
      samples,
    });
    if (profiles.some((row) => row.classification === "continuous") && profiles.some((row) => row.classification === "discrete")) break;
  }
  return profiles;
}

async function writeProfileTarget(fxRef, profile, classification) {
  const targets = chooseDistinctTargets(profile.samples);
  const target = targets.at(-1);
  const set = await setParameter(fxRef, profile.parameter, target.probe_normalized_value);
  const read = await readParameter(fxRef, profile.parameter);
  const readback = compactParameter(read);
  assert(readback.param_ident === profile.parameter.param_ident, `${profile.parameter.name} write changed param_ident`);
  assert(readback.formatted_value === target.formatted_value, `${profile.parameter.name} formatted readback ${readback.formatted_value} !== ${target.formatted_value}`);
  return {
    classification,
    parameter: compactParameter(profile.parameter),
    requested_normalized_value: target.probe_normalized_value,
    expected_formatted_value: target.formatted_value,
    readback,
    updated: set.result?.summary?.updated === true,
    verification: set.verification?.status ?? set.result?.verification?.status,
  };
}

function chooseDistinctTargets(samples) {
  const preferred = samples.filter((row) => row.probe_normalized_value > 0 && row.probe_normalized_value < 1);
  const distinct = [];
  for (const row of preferred) {
    if (!distinct.some((existing) => existing.formatted_value === row.formatted_value)) distinct.push(row);
  }
  assert(distinct.length >= 2, `Parameter ${samples[0]?.name} did not expose two distinct non-edge values`);
  return [distinct[0], distinct.at(-1)];
}

function parseFormattedNumber(value) {
  const match = /[-+]?(?:\d+(?:\.\d+)?|\.\d+)/u.exec(String(value));
  return match ? Number(match[0]) : Number.NaN;
}

async function readParameter(fxRef, parameter, probeNormalizedValue = undefined) {
  const result = await callTemplate("template.fx.read_fx_parameter", {
    param_index: parameter.param_index,
    param_ident: parameter.param_ident,
    ...(probeNormalizedValue === undefined ? {} : { probe_normalized_value: probeNormalizedValue }),
  }, { fx_ref: objectRef(fxRef, "fx") });
  assertTemplate(result, `read ${parameter.name}`);
  assert(result.result?.summary?.param_ident === parameter.param_ident, `${parameter.name} param_ident changed`);
  return result;
}

async function setParameter(fxRef, parameter, normalizedValue) {
  const result = await callTemplate("template.fx.set_fx_parameter_normalized", {
    param_index: parameter.param_index,
    param_ident: parameter.param_ident,
    normalized_value: normalizedValue,
    tolerance: 0.000001,
  }, { fx_ref: objectRef(fxRef, "fx") });
  assertTemplate(result, `set ${parameter.name}`);
  assert(result.result?.summary?.updated === true, `${parameter.name} write did not verify`);
  assert(result.result?.summary?.param_ident === parameter.param_ident, `${parameter.name} write identity changed`);
  return result;
}

function compactParameter(result) {
  const summary = result?.result?.summary ?? result ?? {};
  return {
    param_index: summary.param_index,
    param_ident: summary.param_ident,
    name: summary.name,
    normalized_value: summary.normalized_value,
    formatted_value: summary.formatted_value,
  };
}

function pointMatches(point, timeSeconds, value) {
  return Math.abs(point?.time_seconds - timeSeconds) <= 0.000001 && Math.abs(point?.value - value) <= 0.000001;
}

async function callTemplate(id, input, refs = undefined) {
  return callTool("call_template", { id, input, ...(refs ? { refs } : {}), budget: publicBudget });
}

async function callTool(name, args) {
  const response = await client.callTool({ name, arguments: args }, undefined, { timeout: 300_000, maxTotalTimeout: 600_000 });
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  if (typeof text !== "string") throw new Error(`${name} returned no JSON text`);
  return JSON.parse(text);
}

function requireRef(value, kind, label) {
  const row = value.result?.refs?.find((entry) => entry.kind === kind);
  assert(typeof row?.ref === "string", `${label} returned no ${kind} ref`);
  return row.ref;
}

function objectRef(ref, kind) {
  if (kind === "track") {
    const match = /^track:guid:(.+)$/u.exec(ref);
    assert(match, `Invalid Track ref ${ref}`);
    return { kind, ref, identity: { scheme: "guid", value: match[1] } };
  }
  if (kind === "envelope") {
    const match = /^envelope:guid:(.+)$/u.exec(ref);
    assert(match, `Invalid Envelope ref ${ref}`);
    return { kind, ref, identity: { scheme: "guid", value: match[1] } };
  }
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  assert(match, `Invalid FX ref ${ref}`);
  return { kind, ref, identity: { scheme: `${match[1]}_fx`, value: `${match[1]}:guid:${match[2]}:${match[3]}` } };
}

function assertTemplate(value, label) {
  assert(value?.contract === "template.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value.verification?.status === "passed" || value.result?.verification?.status === "passed", `${label} verification did not pass`);
}

function assertMacro(value, label) {
  assert(value?.contract === "macro.execution.v1", `${label} returned ${value?.contract}`);
  assert(value?.ok === true, `${label} failed: ${JSON.stringify(value?.error ?? value?.blockers)}`);
  assert(value.execution?.status === "completed", `${label} execution did not complete`);
  assert(value.result?.verification?.status === "passed", `${label} verification did not pass`);
}

function parseArgs(argv) {
  const result = { bridge_generation: 1 };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!value) throw new Error(`Missing value for ${key}`);
    if (key === "--evidence-root") result.evidence_root = path.resolve(value);
    else if (key === "--project-path") result.project_path = path.resolve(value);
    else if (key === "--mcp-command") result.mcp_command = path.resolve(value);
    else if (key === "--transport-dir") result.transport_dir = path.resolve(value);
    else if (key === "--artifact-root") result.artifact_root = path.resolve(value);
    else if (key === "--render-root") result.render_root = path.resolve(value);
    else if (key === "--index-root") result.index_root = path.resolve(value);
    else if (key === "--bridge-owner") result.bridge_owner = value;
    else if (key === "--bridge-generation") result.bridge_generation = Number(value);
    else if (key === "--case-id") result.case_id = value;
    else throw new Error(`Unknown option ${key}`);
  }
  for (const key of ["evidence_root", "project_path", "mcp_command", "transport_dir", "artifact_root", "render_root", "index_root", "bridge_owner"]) {
    if (!result[key]) throw new Error(`Missing --${key.replaceAll("_", "-")}`);
  }
  if (!Number.isInteger(result.bridge_generation)) throw new Error("--bridge-generation must be an integer");
  return result;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}
