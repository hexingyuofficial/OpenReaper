#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const options = parseArgs(process.argv.slice(2));
const reportPath = path.join(options.evidence_root, "reports", "alpha3-3-proq3-lowcut-live.json");
const publicBudget = { max_response_bytes: 65_536, max_items: 1_000, max_inline_value_bytes: 12_000 };
const calls = {};
const parameterPages = [];
const probes = { shape: [], frequency: [] };
let client;
let error = null;

await mkdir(path.dirname(reportPath), { recursive: true });
const before = {
  project_sha256: await sha256(options.project_path),
  project_size: (await stat(options.project_path)).size,
};

try {
  client = new Client({ name: "alpha33-proq3-lowcut-live", version: "1.0.0" });
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
      OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha33-proq3-lowcut-live",
      OPENREAPER_ARTIFACT_ROOT: options.artifact_root,
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: options.artifact_root,
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT: options.render_root,
    },
  }));

  calls.ping = await callTool("ping", {});
  calls.search = await callTemplate("template.fx.search_installed_fx", {
    query: "Pro-Q 3",
    limit: 50,
    offset: 0,
  });
  assertTemplate(calls.search, "search installed Pro-Q 3");
  const installedRows = calls.search.result?.summary?.rows ?? [];
  const exactPlugin = installedRows.find((row) => row.name === "VST3: Pro-Q 3 (FabFilter)");
  assert(exactPlugin, `Exact VST3: Pro-Q 3 (FabFilter) not found: ${JSON.stringify(installedRows)}`);

  calls.create_track = await callTemplate("template.tracks.create_track", {
    name: "Alpha33 Pro-Q 3 Low Cut",
  });
  assertTemplate(calls.create_track, "create Pro-Q 3 test track");
  const trackRef = requireRef(calls.create_track, "track", "created track");

  calls.add_fx = await callTemplate("template.fx.add_track_fx", {
    plugin_name: exactPlugin.name,
  }, { track_ref: objectRef(trackRef, "track") });
  assertTemplate(calls.add_fx, "add Pro-Q 3");
  const fxRef = requireRef(calls.add_fx, "fx", "added Pro-Q 3");

  calls.fx_summary = await callTemplate("template.fx.read_fx_summary", {}, {
    fx_ref: objectRef(fxRef, "fx"),
  });
  assertTemplate(calls.fx_summary, "read Pro-Q 3 summary");

  const parameters = await readAllParameters(fxRef);
  assert(parameters.length === calls.fx_summary.result?.summary?.parameter_count, `Expected complete parameter inventory, got ${parameters.length}`);

  const used = requireParameter(parameters, "Band 1 Used");
  const enabled = requireParameter(parameters, "Band 1 Enabled");
  const frequency = requireParameter(parameters, "Band 1 Frequency");
  const shape = requireParameter(parameters, "Band 1 Shape");

  const lowCut = await findFormattedChoice(fxRef, shape, (formatted) => /^low cut$/iu.test(formatted.trim()), probes.shape);
  assert(lowCut, `Pro-Q 3 did not expose a Low Cut choice for ${shape.name}`);
  const frequency80 = await findFrequencyValue(fxRef, frequency, 80, probes.frequency);
  const frequency120 = await findFrequencyValue(fxRef, frequency, 120, probes.frequency);
  assert(Math.abs(frequency80.hz - 80) <= 1, `80 Hz probe read back ${frequency80.formatted_value}`);
  assert(Math.abs(frequency120.hz - 120) <= 1, `120 Hz probe read back ${frequency120.formatted_value}`);

  calls.set_used = await setParameter(fxRef, used, 1);
  calls.set_enabled = await setParameter(fxRef, enabled, 1);
  calls.set_shape = await setParameter(fxRef, shape, lowCut.normalized_value);
  calls.set_frequency = await setParameter(fxRef, frequency, frequency80.normalized_value);

  calls.read_used = await readParameter(fxRef, used);
  calls.read_enabled = await readParameter(fxRef, enabled);
  calls.read_shape = await readParameter(fxRef, shape);
  calls.read_frequency = await readParameter(fxRef, frequency);
  assert(calls.read_used.result.summary.normalized_value > 0.99, "Band 1 was not marked used");
  assert(calls.read_enabled.result.summary.normalized_value > 0.99, "Band 1 was not enabled");
  assert(/^low cut$/iu.test(calls.read_shape.result.summary.formatted_value.trim()), `Shape read back ${calls.read_shape.result.summary.formatted_value}`);
  assert(Math.abs(parseFrequencyHz(calls.read_frequency.result.summary.formatted_value) - 80) <= 1, `Frequency read back ${calls.read_frequency.result.summary.formatted_value}`);

  calls.automation = await callTemplate("macro.automation.apply", {
    mode: "insert_fx_parameter_points",
    fx_refs: [fxRef],
    fx_parameter: {
      param_index: frequency.param_index,
      param_ident: frequency.param_ident,
      create_if_missing: true,
    },
    points: [
      { time_seconds: 0, value: frequency80.normalized_value, shape: 0, tension: 0, selected: false },
      { time_seconds: 4, value: frequency120.normalized_value, shape: 0, tension: 0, selected: false },
    ],
    dry_run: false,
  });
  assertMacro(calls.automation, "write Pro-Q 3 frequency automation");
  const automationChange = calls.automation.result?.changes?.[0];
  assert(automationChange?.applied === true, `Automation change was not applied: ${JSON.stringify(automationChange)}`);
  assert(automationChange.live_readback?.status === "passed", `Automation live readback did not pass: ${JSON.stringify(automationChange?.live_readback)}`);
  const envelopeRef = automationChange.live_readback?.envelope_ref;
  assert(/^envelope:guid:/u.test(envelopeRef), `Automation returned no canonical Envelope GUID: ${envelopeRef}`);

  calls.automation_points = await callTemplate("template.automation.read_envelope_points", {
    autoitem_index: -1,
    cursor: "0",
    limit: 64,
  }, { envelope_ref: objectRef(envelopeRef, "envelope") });
  assertTemplate(calls.automation_points, "read Pro-Q 3 frequency automation points");
  const points = calls.automation_points.result?.summary?.points ?? [];
  assert(calls.automation_points.result?.summary?.truncated === false, "Automation point readback was truncated");
  assert(points.length === 2, `Expected 2 frequency automation points, got ${points.length}`);
  assert(pointMatches(points[0], 0, frequency80.normalized_value), `First automation point mismatched: ${JSON.stringify(points[0])}`);
  assert(pointMatches(points[1], 4, frequency120.normalized_value), `Second automation point mismatched: ${JSON.stringify(points[1])}`);

  calls.save_current = await callTemplate("macro.project.file", { operation: "save_current", dry_run: false });
  assertMacro(calls.save_current, "save Pro-Q 3 evidence project");
} catch (caught) {
  error = { name: caught?.name ?? "Error", message: caught?.message ?? String(caught), stack: caught?.stack ?? null };
} finally {
  await client?.close().catch(() => {});
}

const parameters = parameterPages.flatMap((page) => page.result?.summary?.parameters ?? []);
const automationChange = calls.automation?.result?.changes?.[0] ?? null;
const report = {
  contract: "alpha3.3.proq3_lowcut.live_evidence.v1",
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
  discovery: {
    exact_plugin_name: "VST3: Pro-Q 3 (FabFilter)",
    installed_rows: calls.search?.result?.summary?.rows ?? [],
  },
  parameter_inventory: parameterPages.length > 0 && {
    parameter_count: parameterPages[0].result?.summary?.parameter_count,
    returned_count: parameters.length,
    page_count: parameterPages.length,
    final_truncated: parameterPages.at(-1)?.result?.summary?.truncated,
    complete: parameterPages.at(-1)?.result?.summary?.inventory_complete,
    parameters,
  },
  low_cut: calls.read_shape && {
    used: compactParameter(calls.read_used),
    enabled: compactParameter(calls.read_enabled),
    shape: compactParameter(calls.read_shape),
    frequency: compactParameter(calls.read_frequency),
  },
  automation: automationChange && {
    envelope_ref: automationChange.live_readback?.envelope_ref,
    param_index: automationChange.live_readback?.param_index,
    param_ident: automationChange.live_readback?.param_ident,
    applied: automationChange.applied,
    mutation: automationChange.mutation,
    live_readback: automationChange.live_readback,
    index_maintenance: automationChange.index_maintenance,
    points: calls.automation_points?.result?.summary?.points ?? [],
  },
  probes,
  project_changes: {
    track_created: calls.create_track?.ok === true,
    fx_created: calls.add_fx?.ok === true,
    parameter_writes: [calls.set_used, calls.set_enabled, calls.set_shape, calls.set_frequency].filter((value) => value?.ok === true).length,
    automation_points_created: calls.automation_points?.result?.summary?.points?.length ?? 0,
    saved_to_evidence_copy: calls.save_current?.ok === true,
  },
  rendered_files: [],
  source_media_deleted: false,
  recovery: { evidence_project_preserved: true },
  calls,
  error,
};

await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ ok: report.ok, report: reportPath, parameter_inventory: report.parameter_inventory && { parameter_count: report.parameter_inventory.parameter_count, returned_count: report.parameter_inventory.returned_count, page_count: report.parameter_inventory.page_count, complete: report.parameter_inventory.complete }, low_cut: report.low_cut, automation: report.automation && { envelope_ref: report.automation.envelope_ref, applied: report.automation.applied, points: report.automation.points }, error }, null, 2)}\n`);
if (error) process.exit(1);

async function readAllParameters(fxRef) {
  let offset = 0;
  const rows = [];
  while (true) {
    const page = await callTemplate("template.fx.list_fx_parameters", { limit: 64, offset }, { fx_ref: objectRef(fxRef, "fx") });
    assertTemplate(page, `list Pro-Q 3 parameters at offset ${offset}`);
    const summary = page.result?.summary ?? {};
    assert(summary.offset === offset, `Parameter page offset mismatch: ${summary.offset} !== ${offset}`);
    assert(summary.returned_count === summary.parameters?.length, `Parameter page count mismatch at ${offset}`);
    parameterPages.push(page);
    rows.push(...(summary.parameters ?? []));
    if (summary.next_offset == null) {
      assert(summary.truncated === false && summary.inventory_complete === true && summary.coverage_status === "complete", "Final parameter page was not complete");
      break;
    }
    assert(summary.truncated === true && summary.inventory_complete === false && summary.coverage_status === "paged", `Intermediate page at ${offset} claimed complete coverage`);
    assert(Number.isInteger(summary.next_offset) && summary.next_offset > offset, `Invalid next_offset ${summary.next_offset}`);
    offset = summary.next_offset;
  }
  assert(new Set(rows.map((row) => row.param_index)).size === rows.length, "Parameter pages contained duplicate indexes");
  return rows;
}

function requireParameter(parameters, name) {
  const matches = parameters.filter((row) => row.name === name);
  assert(matches.length === 1, `Expected one ${name} parameter, got ${matches.length}`);
  assert(typeof matches[0].param_ident === "string" && matches[0].param_ident.length > 0, `${name} has no stable param_ident`);
  assert(typeof matches[0].formatted_value === "string", `${name} has no formatted_value`);
  return matches[0];
}

async function findFormattedChoice(fxRef, parameter, predicate, evidence) {
  for (let step = 0; step <= 64; step += 1) {
    const normalizedValue = step / 64;
    const result = await readParameter(fxRef, parameter, normalizedValue);
    const row = compactParameter(result);
    evidence.push(row);
    if (predicate(row.formatted_value)) return row;
  }
  return null;
}

async function findFrequencyValue(fxRef, parameter, targetHz, evidence) {
  let low = 0;
  let high = 1;
  let best = null;
  for (let iteration = 0; iteration < 24; iteration += 1) {
    const normalizedValue = (low + high) / 2;
    const result = await readParameter(fxRef, parameter, normalizedValue);
    const row = { ...compactParameter(result), target_hz: targetHz };
    row.hz = parseFrequencyHz(row.formatted_value);
    evidence.push(row);
    if (!best || Math.abs(row.hz - targetHz) < Math.abs(best.hz - targetHz)) best = row;
    if (row.hz < targetHz) low = normalizedValue;
    else high = normalizedValue;
  }
  return best;
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

function parseFrequencyHz(value) {
  const match = /^\s*([0-9]+(?:\.[0-9]+)?)\s*(k?)hz\s*$/iu.exec(String(value));
  assert(match, `Cannot parse frequency value ${value}`);
  return Number(match[1]) * (match[2].toLowerCase() === "k" ? 1000 : 1);
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
