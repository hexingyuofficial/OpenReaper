#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import {
  createAlpha34CStockSemanticLiveAuditPlan,
  listAlpha34CStockSemanticControls,
} from "../packages/mcp-server/src/alpha3-4-c-fx-semantic-truth-v1.mjs";
import {
  listAlpha3E1StockPluginMaps,
} from "../packages/mcp-server/src/alpha3-e1-stock-plugin-fluency-v1.mjs";
import { createEvidenceJournal, serializeError } from "./lib/alpha3-4-harness-evidence-v1.mjs";

const AUDIT_CONTRACT = "openreaper.alpha3.4.stock_semantic_live_audit.v1";
const PUBLIC_BUDGET = Object.freeze({
  max_response_bytes: 120_000,
  max_items: 1_000,
  max_inline_value_bytes: 12_000,
});
const PROBE_POINTS = Object.freeze([
  { id: "low", normalized_value: 0.2 },
  { id: "mid", normalized_value: 0.5 },
  { id: "high", normalized_value: 0.8 },
]);
const PROBE_NORMALIZED_TOLERANCE = 0.000001;

export async function runStockSemanticTruthAudit({
  installedWrapper,
  sourceProject,
  evidenceRoot,
  connectFactory = connectInstalled,
  evidenceSink = null,
  executeLive = false,
  liveEnvironment = null,
  selectedPluginIds = null,
  performWrites = true,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(sourceProject, "sourceProject");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  const startedAt = Date.now();
  const catalog = listAlpha34CStockSemanticControls();
  const maps = listAlpha3E1StockPluginMaps();
  const pluginIds = selectPluginIds(catalog.plugins.map((entry) => entry.id), selectedPluginIds);
  const plan = createAlpha34CStockSemanticLiveAuditPlan();
  const journal = evidenceSink ?? await createEvidenceJournal({
    evidenceRoot: path.resolve(evidenceRoot),
    provenance: {
      canary_contract: AUDIT_CONTRACT,
      runtime_source: "installed_wrapper",
      runtime_command: path.resolve(installedWrapper),
      transport: "installed_wrapper_only",
      auto_promote_proof: false,
    },
  });
  const report = {
    contract: AUDIT_CONTRACT,
    ok: true,
    status: "planned_only",
    auto_promote_proof: false,
    runtime: { source: "installed_wrapper", command: path.resolve(installedWrapper) },
    source_project: path.resolve(sourceProject),
    plugin_count: catalog.plugin_count,
    control_count: catalog.control_count,
    selected_plugin_ids: pluginIds,
    plan,
    calls: [],
    plugins: [],
    project_changes: [],
    rendered_outputs: [],
    source_media_deleted: false,
    source_hashes: {},
    recovery_posture: {
      source_project_is_authorized_disposable_fixture: executeLive === true,
      evidence_project_preserved: executeLive === true,
      automatic_proof_catalog_write: false,
    },
    evidence: journal.paths ?? null,
    error: null,
  };
  let client = null;
  try {
    report.source_hashes.before = await fileMetadata(sourceProject);
    if (!executeLive) {
      report.note = "Static planning only. Pass executeLive with a fresh control-tower session to run; proof records are never auto-promoted.";
    } else {
      const normalizedEnvironment = normalizeLiveEnvironment(liveEnvironment, sourceProject);
      client = await connectFactory({
        installedWrapper: path.resolve(installedWrapper),
        liveEnvironment: normalizedEnvironment,
      });
      const tools = typeof client.listTools === "function" ? await client.listTools() : null;
      report.tool_surface = tools?.tools?.map((entry) => entry.name) ?? null;
      assertFiveToolSurface(report.tool_surface);
      const context = createAuditContext({ client, journal, report });
      await context.callTool("ping", {}, { scenario: "stock_semantic_audit", stage: "ping" });
      for (const pluginId of pluginIds) {
        const pluginMap = maps.plugins.find((entry) => entry.id === pluginId);
        const pluginCatalog = catalog.plugins.find((entry) => entry.id === pluginId);
        report.plugins.push(await auditPlugin({
          pluginMap,
          pluginCatalog,
          context,
          performWrites: performWrites === true,
        }));
      }
      const save = await context.callTemplate("macro.project.file", {
        operation: "save_current",
        dry_run: false,
      }, undefined, { scenario: "stock_semantic_audit", stage: "save_current" });
      assertMacro(save, "save stock semantic evidence project");
      report.project_changes.push({
        kind: "project_save",
        status: "completed",
        path: path.resolve(sourceProject),
      });
      const hardFailures = report.plugins.filter((entry) => entry.status === "failed");
      const observed = report.plugins.reduce((count, entry) => count + entry.native_low_mid_high_observed_count, 0);
      report.ok = hardFailures.length === 0;
      report.status = hardFailures.length > 0
        ? "failed"
        : observed === report.plugins.reduce((count, entry) => count + entry.control_count, 0)
          ? "completed_native_observations_pending_review"
          : "completed_with_unproven_controls";
      report.audit_counts = {
        selected_plugins: report.plugins.length,
        selected_controls: report.plugins.reduce((count, entry) => count + entry.control_count, 0),
        native_low_mid_high_observed: observed,
        still_unproven: report.plugins.reduce((count, entry) => count + entry.unproven_count, 0),
        failed_plugins: hardFailures.length,
      };
    }
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.error = serializeError(error);
  } finally {
    try {
      await client?.close?.();
      report.client_close = { status: client ? "closed" : "not_connected" };
    } catch (error) {
      report.ok = false;
      report.status = "failed";
      report.client_close = { status: "failed", error: serializeError(error) };
      report.error ??= serializeError(error);
    }
  }
  try {
    report.source_hashes.after = await fileMetadata(sourceProject);
  } catch (error) {
    report.source_hashes.after = { error: serializeError(error) };
    report.ok = false;
    report.status = "failed";
    report.error ??= serializeError(error);
  }
  report.duration_ms = Date.now() - startedAt;
  try {
    await journal.recordCall?.({
      scenario: "stock_semantic_audit",
      stage: "audit_result",
      tool: "harness",
      requested_id: AUDIT_CONTRACT,
      request: { selected_plugin_ids: pluginIds, execute_live: executeLive === true },
      response: report,
      ok: report.ok,
      error: report.error,
      duration_ms: report.duration_ms,
    });
    await journal.finalize?.(report);
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.evidence_error = serializeError(error);
    report.error ??= serializeError(error);
  }
  return report;
}

async function auditPlugin({ pluginMap, pluginCatalog, context, performWrites }) {
  const result = {
    plugin_id: pluginMap.id,
    display_name: pluginMap.display_name,
    status: "running",
    control_count: pluginCatalog.control_ids.length,
    native_low_mid_high_observed_count: 0,
    unproven_count: pluginCatalog.control_ids.length,
    track_ref: null,
    fx_ref: null,
    installed_plugin_name: null,
    parameter_inventory: null,
    controls: [],
    exact_write: { attempted: false, status: "not_run" },
    error: null,
  };
  try {
    const search = await context.callTemplate("template.fx.search_installed_fx", {
      query: pluginMap.display_name,
      limit: 100,
      offset: 0,
    }, undefined, { scenario: pluginMap.id, stage: "search_installed_fx" });
    assertTemplate(search, `search installed ${pluginMap.display_name}`);
    const installedRows = rowsFrom(search, "rows");
    const installed = chooseInstalledPlugin(installedRows, pluginMap);
    if (!installed.ok) throw coded(installed.code, installed.message);
    result.installed_plugin_name = installed.row.name;

    const createTrack = await context.callTemplate("template.tracks.create_track", {
      name: `Alpha3.4 C Audit ${pluginMap.display_name}`,
    }, undefined, { scenario: pluginMap.id, stage: "create_track" });
    assertTemplate(createTrack, `create ${pluginMap.display_name} audit track`);
    result.track_ref = requireRef(createTrack, "track", pluginMap.display_name);
    context.report.project_changes.push({ kind: "track_create", plugin_id: pluginMap.id, ref: result.track_ref });

    const addFx = await context.callTemplate("template.fx.add_track_fx", {
      plugin_name: installed.row.name,
    }, { track_ref: objectRef(result.track_ref, "track") }, { scenario: pluginMap.id, stage: "add_fx" });
    assertTemplate(addFx, `add ${pluginMap.display_name}`);
    result.fx_ref = requireRef(addFx, "fx", pluginMap.display_name);
    context.report.project_changes.push({ kind: "fx_create", plugin_id: pluginMap.id, ref: result.fx_ref });

    const summary = await context.callTemplate("template.fx.read_fx_summary", {}, {
      fx_ref: objectRef(result.fx_ref, "fx"),
    }, { scenario: pluginMap.id, stage: "read_fx_summary" });
    assertTemplate(summary, `read ${pluginMap.display_name} FX summary`);
    const parameterPages = [];
    const inventory = await readAllParameters({
      fxRef: result.fx_ref,
      pluginId: pluginMap.id,
      context,
      pages: parameterPages,
    });
    const summaryCount = payload(summary).parameter_count;
    if (Number.isInteger(summaryCount) && summaryCount !== inventory.parameters.length) {
      throw coded("STOCK_AUDIT_PARAMETER_COUNT_MISMATCH", `${pluginMap.display_name} summary and paged inventory counts differ.`);
    }
    result.parameter_inventory = {
      parameter_count: inventory.parameters.length,
      page_count: parameterPages.length,
      inventory_complete: true,
      coverage_status: "complete",
    };

    const mappings = matchSemanticControls(pluginMap, inventory.parameters);
    for (const mapping of mappings) {
      const control = {
        control_id: mapping.control_id,
        match_status: mapping.status,
        param_index: mapping.parameter?.param_index ?? null,
        param_ident: mapping.parameter?.param_ident ?? null,
        parameter_name: mapping.parameter?.name ?? null,
        candidates: mapping.candidates,
        probes: [],
        audit_status: "unproven",
        proof_status_after: "unproven",
      };
      if (mapping.status === "matched") {
        control.probes = await probeParameter({
          fxRef: result.fx_ref,
          parameter: mapping.parameter,
          pluginId: pluginMap.id,
          controlId: mapping.control_id,
          context,
        });
        const formatted = control.probes.map((entry) => entry.formatted_value).filter((value) => typeof value === "string" && value.length > 0);
        control.audit_status = control.probes.every((entry) => entry.status === "observed") && new Set(formatted).size >= 2
          ? "native_low_mid_high_observed"
          : "native_probe_unproven";
      }
      result.controls.push(control);
    }

    const writeCandidates = result.controls.filter((entry) => entry.audit_status === "native_low_mid_high_observed").slice(0, 8);
    if (performWrites && writeCandidates.length > 0) {
      result.exact_write.attempted = true;
      const write = await context.callTemplate("macro.fx.set_controls", {
        mode: "exact_parameters",
        dry_run: false,
        changes: writeCandidates.map((entry) => ({
          id: entry.control_id,
          param_index: entry.param_index,
          ...(entry.param_ident ? { param_ident: entry.param_ident } : {}),
          normalized_value: 0.5,
        })),
      }, { fx_ref: result.fx_ref }, { scenario: pluginMap.id, stage: "exact_parameters_write" });
      assertMacro(write, `write exact ${pluginMap.display_name} parameters`);
      const changes = write.result?.changes ?? [];
      if (changes.length !== writeCandidates.length || changes.some((entry) => entry.status !== "applied" || entry.live_readback?.status !== "passed")) {
        throw coded("STOCK_AUDIT_EXACT_WRITE_READBACK_FAILED", `${pluginMap.display_name} exact write rows did not all pass live readback.`);
      }
      result.exact_write = {
        attempted: true,
        status: "passed",
        change_count: changes.length,
        changes: changes.map((entry) => ({
          id: entry.id,
          param_index: entry.param_index,
          status: entry.status,
          mutation: entry.mutation?.status ?? null,
          live_readback: entry.live_readback?.status ?? null,
          index_maintenance: entry.index_maintenance?.status ?? null,
        })),
      };
    }
    result.native_low_mid_high_observed_count = result.controls.filter((entry) => entry.audit_status === "native_low_mid_high_observed").length;
    result.unproven_count = result.control_count;
    result.status = "completed_pending_manual_proof_review";
  } catch (error) {
    result.status = "failed";
    result.error = serializeError(error);
  }
  return result;
}

async function readAllParameters({ fxRef, pluginId, context, pages }) {
  const parameters = [];
  const seen = new Set();
  let offset = 0;
  let expectedCount = null;
  while (parameters.length < 4096) {
    const page = await context.callTemplate("template.fx.list_fx_parameters", {
      limit: 128,
      offset,
    }, { fx_ref: objectRef(fxRef, "fx") }, { scenario: pluginId, stage: `list_parameters_${offset}` });
    assertTemplate(page, `list ${pluginId} parameters at ${offset}`);
    pages.push(page);
    const data = payload(page);
    if (!Number.isInteger(data.parameter_count) || data.parameter_count < 0 || data.parameter_count > 4096) {
      throw coded("STOCK_AUDIT_PARAMETER_COUNT_INVALID", `${pluginId} returned an invalid parameter_count.`);
    }
    if (expectedCount !== null && expectedCount !== data.parameter_count) {
      throw coded("STOCK_AUDIT_PARAMETER_COUNT_CHANGED", `${pluginId} parameter_count changed during paging.`);
    }
    expectedCount = data.parameter_count;
    if (data.offset !== undefined && data.offset !== offset) {
      throw coded("STOCK_AUDIT_PARAMETER_OFFSET_MISMATCH", `${pluginId} returned offset ${data.offset} for requested ${offset}.`);
    }
    const rows = Array.isArray(data.parameters) ? data.parameters : [];
    for (const row of rows) {
      if (!Number.isInteger(row?.param_index) || row.param_index < 0 || row.param_index >= expectedCount || seen.has(row.param_index)) {
        throw coded("STOCK_AUDIT_PARAMETER_ROW_INVALID", `${pluginId} returned a duplicate or invalid param_index.`);
      }
      seen.add(row.param_index);
      parameters.push(row);
    }
    const next = data.next_offset ?? null;
    if (next === null) {
      if (data.inventory_complete !== true || data.coverage_status !== "complete" || data.truncated === true || parameters.length !== expectedCount) {
        throw coded("STOCK_AUDIT_PARAMETER_INVENTORY_INCOMPLETE", `${pluginId} final page did not prove complete inventory.`);
      }
      return { parameters };
    }
    if (!Number.isInteger(next) || next !== offset + rows.length || next <= offset) {
      throw coded("STOCK_AUDIT_PARAMETER_PAGING_GAP", `${pluginId} parameter paging skipped, overlapped, or stalled.`);
    }
    offset = next;
  }
  throw coded("STOCK_AUDIT_PARAMETER_CEILING_EXCEEDED", `${pluginId} exceeded the 4096 parameter audit ceiling.`);
}

function matchSemanticControls(pluginMap, parameters) {
  const provisional = pluginMap.parameters.map((definition) => {
    const ranked = parameters
      .map((parameter) => ({ parameter, score: parameterMatchScore(definition, parameter) }))
      .filter((entry) => entry.score > 0)
      .sort((left, right) => right.score - left.score || left.parameter.param_index - right.parameter.param_index);
    const best = ranked[0] ?? null;
    const tied = best ? ranked.filter((entry) => entry.score === best.score) : [];
    return {
      control_id: definition.id,
      status: best && best.score >= 80 && tied.length === 1 ? "matched" : best ? "ambiguous" : "not_found",
      parameter: best && best.score >= 80 && tied.length === 1 ? best.parameter : null,
      candidates: ranked.slice(0, 3).map((entry) => ({
        param_index: entry.parameter.param_index,
        param_ident: entry.parameter.param_ident ?? null,
        name: entry.parameter.name ?? null,
        score: entry.score,
      })),
    };
  });
  const byIndex = new Map();
  for (const entry of provisional.filter((value) => value.status === "matched")) {
    const group = byIndex.get(entry.parameter.param_index) ?? [];
    group.push(entry);
    byIndex.set(entry.parameter.param_index, group);
  }
  for (const group of byIndex.values()) {
    if (group.length < 2) continue;
    for (const entry of group) {
      entry.status = "collision";
      entry.parameter = null;
    }
  }
  return provisional;
}

function parameterMatchScore(definition, parameter) {
  const candidates = [parameter?.name, parameter?.param_ident].filter((value) => typeof value === "string" && value.length > 0);
  const hints = [definition.id, definition.label, ...(definition.resolution?.match_hints ?? []), ...(definition.aliases ?? [])];
  let best = 0;
  for (const candidate of candidates) {
    const candidateCompact = compactToken(candidate);
    const candidateWords = coreWords(candidate);
    for (const hint of hints) {
      const hintCompact = compactToken(hint);
      const hintWords = coreWords(hint);
      if (candidateCompact && candidateCompact === hintCompact) best = Math.max(best, 100);
      else if (candidateWords.length > 0 && sameWords(candidateWords, hintWords)) best = Math.max(best, 95);
      else if (candidateWords.length > 0 && hintWords.length > 0 && includesWords(candidateWords, hintWords)) best = Math.max(best, 85);
      else if (candidateWords.length > 0 && hintWords.length > 0 && includesWords(hintWords, candidateWords)) best = Math.max(best, 80);
    }
  }
  return best;
}

async function probeParameter({ fxRef, parameter, pluginId, controlId, context }) {
  const probes = [];
  for (const point of PROBE_POINTS) {
    const response = await context.callTemplate("template.fx.read_fx_parameter", {
      param_index: parameter.param_index,
      ...(parameter.param_ident ? { param_ident: parameter.param_ident } : {}),
      probe_normalized_value: point.normalized_value,
    }, { fx_ref: objectRef(fxRef, "fx") }, { scenario: pluginId, stage: `probe_${controlId}_${point.id}` });
    assertTemplate(response, `probe ${pluginId}.${controlId}.${point.id}`);
    const data = payload(response);
    const identityMatches = data.param_index === parameter.param_index
      && (!parameter.param_ident || data.param_ident === parameter.param_ident);
    const observedNormalizedValue = typeof data.normalized_value === "number" && Number.isFinite(data.normalized_value)
      ? data.normalized_value
      : null;
    const normalizedMatches = observedNormalizedValue !== null
      && Math.abs(observedNormalizedValue - point.normalized_value) <= PROBE_NORMALIZED_TOLERANCE;
    probes.push({
      point: point.id,
      requested_normalized_value: point.normalized_value,
      observed_normalized_value: observedNormalizedValue,
      formatted_value: typeof data.formatted_value === "string" ? data.formatted_value : null,
      step_sizes_available: data.step_sizes_available === true,
      step_size: Number.isFinite(Number(data.step_size)) ? Number(data.step_size) : null,
      is_toggle: data.is_toggle ?? null,
      is_discrete: data.is_discrete ?? null,
      status: identityMatches && normalizedMatches && typeof data.formatted_value === "string" && data.formatted_value.length > 0
        ? "observed"
        : "invalid",
    });
  }
  return probes;
}

function createAuditContext({ client, journal, report }) {
  return {
    report,
    async callTemplate(id, input, refs, metadata = {}) {
      return this.callTool("call_template", {
        id,
        input,
        ...(refs ? { refs } : {}),
        budget: PUBLIC_BUDGET,
      }, { ...metadata, requestedId: id });
    },
    async callTool(name, args, metadata = {}) {
      const started = Date.now();
      let value;
      try {
        const response = await client.callTool(
          { name, arguments: args },
          undefined,
          { timeout: 300_000, maxTotalTimeout: 600_000 },
        );
        const text = response.content?.find((entry) => entry.type === "text")?.text;
        if (typeof text !== "string") throw coded("STOCK_AUDIT_RESPONSE_INVALID", `${name} returned no JSON text.`);
        value = JSON.parse(text);
        const duration = Date.now() - started;
        const event = await journal.recordCall?.({
          scenario: metadata.scenario ?? "stock_semantic_audit",
          stage: metadata.stage ?? name,
          tool: name,
          requested_id: metadata.requestedId ?? null,
          request: args,
          response: value,
          ok: value?.ok !== false,
          error: value?.error,
          duration_ms: duration,
          response_bytes: Buffer.byteLength(text, "utf8"),
          request_budget: args?.budget,
        });
        report.calls.push({
          sequence: event?.sequence ?? report.calls.length + 1,
          scenario: metadata.scenario ?? "stock_semantic_audit",
          stage: metadata.stage ?? name,
          tool: name,
          requested_id: metadata.requestedId ?? null,
          ok: value?.ok !== false,
          duration_ms: duration,
        });
        return value;
      } catch (error) {
        const duration = Date.now() - started;
        await journal.recordCall?.({
          scenario: metadata.scenario ?? "stock_semantic_audit",
          stage: metadata.stage ?? name,
          tool: name,
          requested_id: metadata.requestedId ?? null,
          request: args,
          response: value ?? { error: serializeError(error) },
          ok: false,
          error,
          duration_ms: duration,
          request_budget: args?.budget,
        });
        report.calls.push({
          sequence: report.calls.length + 1,
          scenario: metadata.scenario ?? "stock_semantic_audit",
          stage: metadata.stage ?? name,
          tool: name,
          requested_id: metadata.requestedId ?? null,
          ok: false,
          duration_ms: duration,
        });
        throw error;
      }
    },
  };
}

async function connectInstalled({ installedWrapper, liveEnvironment }) {
  const client = new Client({ name: "openreaper-alpha34-c-stock-semantic", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: {
      ...process.env,
      ...(liveEnvironment ? {
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: liveEnvironment.transportDir,
        OPENREAPER_LIVE_BRIDGE_OWNER: liveEnvironment.bridgeOwner,
        OPENREAPER_LIVE_BRIDGE_GENERATION: String(liveEnvironment.bridgeGeneration),
        OPENREAPER_CURRENT_PROJECT_PATH: liveEnvironment.projectPath,
        OPENREAPER_PROJECT_INDEX_STATE_ROOT: liveEnvironment.indexRoot,
        OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha34-c-stock-semantic-live-audit",
        OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
      } : {}),
    },
  }));
  return client;
}

function normalizeLiveEnvironment(value, sourceProject) {
  if (!value || typeof value !== "object") throw coded("STOCK_AUDIT_LIVE_ENV_REQUIRED", "executeLive requires explicit fresh bridge/session paths.");
  const result = {
    transportDir: value.transportDir,
    artifactRoot: value.artifactRoot,
    renderRoot: value.renderRoot,
    indexRoot: value.indexRoot,
    bridgeOwner: value.bridgeOwner,
    bridgeGeneration: value.bridgeGeneration,
    projectPath: value.projectPath ?? sourceProject,
  };
  for (const key of ["transportDir", "artifactRoot", "renderRoot", "indexRoot", "projectPath"]) assertAbsolute(result[key], key);
  if (typeof result.bridgeOwner !== "string" || result.bridgeOwner.trim() === "") throw coded("STOCK_AUDIT_BRIDGE_OWNER_INVALID", "bridgeOwner is required.");
  if (!Number.isInteger(result.bridgeGeneration) || result.bridgeGeneration < 1) throw coded("STOCK_AUDIT_BRIDGE_GENERATION_INVALID", "bridgeGeneration must be a positive integer.");
  if (path.resolve(result.projectPath) !== path.resolve(sourceProject)) throw coded("STOCK_AUDIT_PROJECT_IDENTITY_MISMATCH", "live projectPath must equal sourceProject.");
  return result;
}

function chooseInstalledPlugin(rows, pluginMap) {
  const target = compactToken(pluginMap.display_name);
  const aliases = [pluginMap.display_name, ...(pluginMap.aliases ?? [])].map(compactToken).filter(Boolean);
  const ranked = rows
    .filter((row) => typeof row?.name === "string")
    .map((row) => {
      const name = compactToken(row.name);
      const exact = aliases.includes(name) || aliases.some((alias) => name.endsWith(alias));
      const display = name.includes(target);
      return { row, score: exact ? 100 : display ? 90 : 0 };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => right.score - left.score || left.row.name.localeCompare(right.row.name, "en"));
  if (ranked.length === 0) return { ok: false, code: "STOCK_AUDIT_PLUGIN_NOT_INSTALLED", message: `${pluginMap.display_name} was not found in REAPER installed FX.` };
  return { ok: true, row: ranked[0].row, candidates: ranked.map((entry) => entry.row.name) };
}

function rowsFrom(value, key) {
  const data = payload(value);
  return Array.isArray(data[key]) ? data[key] : [];
}

function payload(value) {
  return value?.result?.data ?? value?.result?.readback ?? value?.result?.summary ?? value?.result ?? {};
}

function requireRef(value, kind, label) {
  const row = value?.result?.refs?.find((entry) => entry.kind === kind);
  if (typeof row?.ref !== "string") throw coded("STOCK_AUDIT_REF_MISSING", `${label} returned no ${kind} ref.`);
  return row.ref;
}

function objectRef(ref, kind) {
  if (kind === "track") {
    const match = /^track:guid:(.+)$/u.exec(ref);
    if (!match) throw coded("STOCK_AUDIT_TRACK_REF_INVALID", `Invalid Track ref ${ref}.`);
    return { kind, ref, identity: { scheme: "guid", value: match[1] } };
  }
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  if (!match) throw coded("STOCK_AUDIT_FX_REF_INVALID", `Invalid FX ref ${ref}.`);
  return { kind, ref, identity: { scheme: `${match[1]}_fx`, value: `${match[1]}:guid:${match[2]}:${match[3]}` } };
}

function assertTemplate(value, label) {
  if (value?.contract !== "template.execution.v1" || value?.ok !== true) {
    throw coded(value?.error?.code ?? "STOCK_AUDIT_TEMPLATE_FAILED", `${label} failed: ${value?.error?.message ?? "unknown Template error"}`);
  }
  const verification = value.verification?.status ?? value.result?.verification?.status;
  if (verification !== "passed") throw coded("STOCK_AUDIT_TEMPLATE_UNVERIFIED", `${label} did not return passed verification.`);
}

function assertMacro(value, label) {
  if (value?.contract !== "macro.execution.v1" || value?.ok !== true || value.execution?.status !== "completed" || value.result?.verification?.status !== "passed") {
    throw coded(value?.error?.code ?? "STOCK_AUDIT_MACRO_FAILED", `${label} failed: ${value?.error?.message ?? "unverified Macro result"}`);
  }
}

function assertFiveToolSurface(tools) {
  const expected = ["ping", "get_state", "list_templates", "list_recipes", "call_template"];
  if (!Array.isArray(tools) || expected.some((name) => !tools.includes(name)) || tools.length !== expected.length) {
    throw coded("STOCK_AUDIT_TOOL_SURFACE_MISMATCH", "Installed wrapper did not expose exactly the five OpenReaper tools.");
  }
}

function selectPluginIds(allIds, selected) {
  if (selected == null) return [...allIds];
  if (!Array.isArray(selected) || selected.length === 0 || selected.some((id) => !allIds.includes(id))) {
    throw coded("STOCK_AUDIT_PLUGIN_SELECTION_INVALID", "selectedPluginIds must contain known stock plugin ids.");
  }
  return [...new Set(selected)];
}

function compactToken(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]+/gu, "");
}

function coreWords(value) {
  const ignored = new Set(["db", "hz", "khz", "ms", "milliseconds", "percent", "percentage", "semitones", "cents", "unitless", "parameter", "control"]);
  return String(value ?? "").toLowerCase().split(/[^a-z0-9]+/u).filter((word) => word && !ignored.has(word));
}

function sameWords(left, right) {
  return left.length === right.length && left.every((word, index) => word === right[index]);
}

function includesWords(haystack, needles) {
  return needles.length > 0 && needles.every((word) => haystack.includes(word));
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

function assertAbsolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw coded("PATH_INVALID", `${field} must be absolute.`);
}

async function fileMetadata(file) {
  const details = await stat(file);
  return {
    path: path.resolve(file),
    sha256: await sha256File(file),
    size: details.size,
    modified_ms: details.mtimeMs,
  };
}

export async function sha256File(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function parseArgs(argv) {
  const values = { executeLive: false, performWrites: true };
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (value === undefined) throw new Error(`Missing value for ${key}`);
    if (key === "--installed-wrapper") values.installedWrapper = path.resolve(value);
    else if (key === "--source-project") values.sourceProject = path.resolve(value);
    else if (key === "--evidence-root") values.evidenceRoot = path.resolve(value);
    else if (key === "--execute-live") values.executeLive = value === "true";
    else if (key === "--perform-writes") values.performWrites = value === "true";
    else if (key === "--transport-dir") (values.liveEnvironment ??= {}).transportDir = path.resolve(value);
    else if (key === "--artifact-root") (values.liveEnvironment ??= {}).artifactRoot = path.resolve(value);
    else if (key === "--render-root") (values.liveEnvironment ??= {}).renderRoot = path.resolve(value);
    else if (key === "--index-root") (values.liveEnvironment ??= {}).indexRoot = path.resolve(value);
    else if (key === "--bridge-owner") (values.liveEnvironment ??= {}).bridgeOwner = value;
    else if (key === "--bridge-generation") (values.liveEnvironment ??= {}).bridgeGeneration = Number(value);
    else if (key === "--plugin-ids") values.selectedPluginIds = value.split(",").map((entry) => entry.trim()).filter(Boolean);
    else throw new Error(`Unknown option ${key}`);
  }
  for (const key of ["installedWrapper", "sourceProject", "evidenceRoot"]) if (!values[key]) throw new Error(`Missing --${key.replace(/[A-Z]/gu, (match) => `-${match.toLowerCase()}`)}`);
  if (values.liveEnvironment) values.liveEnvironment.projectPath = values.sourceProject;
  return values;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = await runStockSemanticTruthAudit(parseArgs(process.argv.slice(2)));
  process.stdout.write(`${JSON.stringify({
    contract: report.contract,
    ok: report.ok,
    status: report.status,
    evidence: report.evidence,
    audit_counts: report.audit_counts ?? null,
    failed_plugins: report.plugins.filter((entry) => entry.status === "failed").map((entry) => ({ plugin_id: entry.plugin_id, error: entry.error })),
    error: report.error,
  }, null, 2)}\n`);
  if (!report.ok) process.exitCode = 1;
}
