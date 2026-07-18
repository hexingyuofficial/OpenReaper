#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createEvidenceJournal } from "./lib/alpha3-4-harness-evidence-v1.mjs";

const CONTRACT = "openreaper.alpha3.4.d1_items_batch_live_harness.v1";
const PUBLIC_BUDGET = Object.freeze({
  max_response_bytes: 2_048,
  max_items: 8,
  max_inline_value_bytes: 256,
});
const FIXTURE_BUDGET = Object.freeze({
  max_response_bytes: 12_000,
  max_items: 8,
  max_inline_value_bytes: 1_024,
});

export async function connectInstalledWrapperD1ItemsBatch({
  installedWrapper,
  liveEnvironment = null,
  clientName = "d1-items-batch",
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  const client = new Client({ name: `openreaper-alpha34-${clientName}`, version: "1.0.0" });
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
        OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha34-d1-items-batch",
        OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
      } : {}),
    },
  }));
  return client;
}

export async function runAlpha34D1ItemsBatchHarness({
  installedWrapper,
  sourceProject,
  evidenceRoot,
  executeLive = false,
  warmLatencyCeilingMs = null,
  maxResponseBytes = PUBLIC_BUDGET.max_response_bytes,
  liveEnvironment = null,
  connectFactory = connectInstalledWrapperD1ItemsBatch,
  callTemplate = null,
  fakeTransportOnly = false,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(sourceProject, "sourceProject");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  if (executeLive === true && fakeTransportOnly === true) {
    throw coded("D1_HARNESS_FAKE_TRANSPORT_FORBIDDEN", "Real execution cannot select the fake-only transport path.");
  }
  if (executeLive !== true && fakeTransportOnly !== true && typeof callTemplate !== "function") {
    throw coded("D1_HARNESS_FAKE_TRANSPORT_REQUIRED", "Unit tests must set fakeTransportOnly with an explicit callTemplate adapter.");
  }
  if (executeLive === true && typeof connectFactory !== "function") {
    throw coded("D1_HARNESS_LIVE_TRANSPORT_REQUIRED", "Live harness requires connectFactory for the installed wrapper.");
  }
  if (fakeTransportOnly === true && typeof callTemplate !== "function") {
    throw coded("D1_HARNESS_CALL_TEMPLATE_REQUIRED", "fakeTransportOnly requires an explicit callTemplate adapter.");
  }

  const budget = Object.freeze({
    max_response_bytes: maxResponseBytes,
    max_items: 8,
    max_inline_value_bytes: 256,
  });
  const fixtureBudget = FIXTURE_BUDGET;
  const journal = await createEvidenceJournal({
    evidenceRoot: path.resolve(evidenceRoot),
    provenance: {
      canary_contract: CONTRACT,
      runtime_source: "installed_wrapper",
      runtime_command: path.resolve(installedWrapper),
      transport: "installed_wrapper_only",
      auto_promote_proof: false,
    },
  });

  const report = {
    contract: CONTRACT,
    ok: true,
    status: executeLive ? "live" : "fake",
    runtime: { source: "installed_wrapper", command: path.resolve(installedWrapper) },
    source_project: path.resolve(sourceProject),
    budget,
    fixture_budget: fixtureBudget,
    live_environment: null,
    fixture_items: null,
    cold: null,
    warm: null,
    warm_latency_ceiling_ms: warmLatencyCeilingMs,
    source_media_deleted: false,
    rendered_outputs: [],
    save: null,
    project_before_hash: null,
    project_after_hash: null,
    recovery_posture: {
      source_project_is_authorized_disposable_fixture: executeLive === true,
      evidence_project_preserved: true,
      automatic_proof_catalog_write: false,
    },
  };

  let client = null;
  let transportCall = null;
  try {
    report.project_before_hash = await sha256File(sourceProject);
    if (executeLive === true) {
      const env = normalizeLiveEnvironment(liveEnvironment, sourceProject);
      report.live_environment = {
        transport_dir: env.transportDir,
        artifact_root: env.artifactRoot,
        render_root: env.renderRoot,
        index_root: env.indexRoot,
        bridge_owner: env.bridgeOwner,
        bridge_generation: env.bridgeGeneration,
        project_path: env.projectPath,
      };
      client = await connectFactory({
        installedWrapper: path.resolve(installedWrapper),
        liveEnvironment: env,
        clientName: "d1-items-batch",
      });
      transportCall = createClientCallTemplate(client);
    } else {
      transportCall = callTemplate;
    }

    const fixtureItems = await ensureEightItemsWithActiveTakes({
      callTemplate: transportCall,
      journal,
      budget: fixtureBudget,
    });
    report.fixture_items = fixtureItems;
    const changes = buildEightRowChanges(fixtureItems);

    const cold = await runBatchOnce({
      label: "cold",
      callTemplate: transportCall,
      journal,
      budget,
      changes,
      dryRun: false,
    });
    report.cold = cold;
    const warm = await runBatchOnce({
      label: "warm",
      callTemplate: transportCall,
      journal,
      budget,
      changes,
      dryRun: false,
    });
    report.warm = warm;

    if (Number.isFinite(warmLatencyCeilingMs) && warm.total_ms > warmLatencyCeilingMs) {
      report.ok = false;
      report.status = "warm_latency_exceeded";
      report.error = {
        code: "D1_HARNESS_WARM_LATENCY_EXCEEDED",
        message: `Warm run ${warm.total_ms}ms exceeded ceiling ${warmLatencyCeilingMs}ms.`,
      };
    }
    if (cold.ok !== true || warm.ok !== true) {
      report.ok = false;
      if (report.status !== "warm_latency_exceeded") report.status = "failed";
    }
    if (executeLive === true) {
      const saveResponse = await transportCall({
        id: "macro.project.file",
        input: { operation: "save_current", dry_run: false },
        budget: fixtureBudget,
        context: {
          request_id: "d1-items-batch-save-current-request-30c",
          session_id: "d1-items-batch",
          request_sequence: 99,
        },
      });
      const saveOk = saveResponse?.ok === true || saveResponse?.execution?.status === "completed";
      report.save = {
        ok: saveOk,
        status: saveResponse?.execution?.status ?? null,
        response_bytes: Buffer.byteLength(JSON.stringify(saveResponse ?? {}), "utf8"),
      };
      if (!saveOk) {
        throw coded(
          saveResponse?.error?.code ?? "D1_HARNESS_SAVE_FAILED",
          saveResponse?.error?.message ?? "Saving the live fixture project did not complete.",
        );
      }
    }
    report.project_after_hash = await sha256File(sourceProject);
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.error = {
      code: error?.code ?? "D1_HARNESS_FAILED",
      message: error?.message ?? "Harness failed.",
    };
  } finally {
    if (client && typeof client.close === "function") {
      try {
        await client.close();
        report.client_close = { attempted: true, ok: true };
      } catch (error) {
        report.client_close = {
          attempted: true,
          ok: false,
          error: { code: error?.code ?? "D1_HARNESS_CLIENT_CLOSE_FAILED", message: error?.message ?? "close failed" },
        };
        if (report.ok === true) {
          report.ok = false;
          report.status = "failed";
          report.error = report.client_close.error;
        }
      }
    }
    await journal.finalize?.({ report });
  }
  return report;
}

export function buildEightRowChanges(fixtureItems) {
  if (!Array.isArray(fixtureItems) || fixtureItems.length < 8) {
    throw coded("D1_HARNESS_FIXTURE_ITEMS_REQUIRED", "Harness requires at least eight Items with Active Takes.");
  }
  return fixtureItems.slice(0, 8).map((item, index) => ({
    id: `r${String(index + 1).padStart(2, "0")}abcdefghij`.slice(0, 12),
    item_ref: item.item_ref,
    take_ref: item.take_ref,
    item: {
      volume_db: -3 - index,
      length_seconds: 2 + index * 0.05,
      fade_in_seconds: 0.01,
      fade_out_seconds: 0.02,
    },
    take: {
      pan: Math.max(-1, Math.min(1, -0.4 + index * 0.1)),
      playrate: 1 + index * 0.02,
      preserve_pitch: index % 2 === 0,
    },
  }));
}

export function validateBatchResponse(response, { budget, changes }) {
  if (!response || typeof response !== "object") {
    return { ok: false, code: "D1_HARNESS_RESPONSE_INVALID", message: "Batch response missing." };
  }
  const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  if (bytes > budget.max_response_bytes) {
    return { ok: false, code: "D1_HARNESS_BUDGET_EXCEEDED", message: `Response ${bytes} exceeds ${budget.max_response_bytes}.` };
  }
  if (!Array.isArray(response?.result?.changes) || response.result.changes.length !== changes.length) {
    return { ok: false, code: "D1_HARNESS_ROW_COUNT_INVALID", message: "Batch response did not retain every row." };
  }
  for (const [index, row] of changes.entries()) {
    if (response.result.changes[index]?.id !== row.id) {
      return { ok: false, code: "D1_HARNESS_ROW_ID_MISMATCH", message: `Row ${index} id was rewritten.` };
    }
  }
  if (response?.macro?.program_id !== "openreaper.macro.items.apply") {
    return { ok: false, code: "D1_HARNESS_PROGRAM_ID_INVALID", message: "Compact program_id must remain openreaper.macro.items.apply." };
  }
  const expectedRows = changes.length;
  const rowsApplied = response.result.changes.every((row) => (
    row?.status === "ok"
    && row?.mutation === "done"
    && row?.readback === "pass"
    && row?.index === "done"
  ));
  if (!rowsApplied) {
    return { ok: false, code: "D1_HARNESS_ROW_TRUTH_INVALID", message: "Every batch row must be live-applied with completed mutation, readback and index maintenance." };
  }
  const calls = response?.result?.data?.calls;
  const expectedMutations = expectedMutationCalls(changes);
  if (!calls
    || calls.resolve !== expectedRows
    || calls.preflight !== expectedRows
    || calls.readback !== expectedRows
    || calls.index !== 1
    || calls.mutation !== expectedMutations
    || calls.total !== calls.resolve + calls.preflight + calls.mutation + calls.readback + calls.index) {
    return { ok: false, code: "D1_HARNESS_CALL_TRUTH_INVALID", message: "Runtime dispatch and index counters do not match the required eight-row live execution." };
  }
  if (response?.sqlite?.used !== true || response.sqlite.freshness !== "stale") {
    return { ok: false, code: "D1_HARNESS_SQLITE_TRUTH_INVALID", message: "Live mutation must report truthful Project Index invalidation evidence." };
  }
  return { ok: true, bytes };
}

function expectedMutationCalls(changes) {
  return changes.reduce((total, row) => {
    let count = 0;
    if (row?.item?.volume_db !== undefined) count += 1;
    if (row?.item?.length_seconds !== undefined) count += 1;
    if (row?.item?.fade_in_seconds !== undefined || row?.item?.fade_out_seconds !== undefined) count += 1;
    if (row?.item?.snap_offset_seconds !== undefined) count += 1;
    if (row?.take?.volume_db !== undefined) count += 1;
    if (row?.take?.pan !== undefined) count += 1;
    if (row?.take?.pitch_semitones !== undefined) count += 1;
    if (row?.take?.playrate !== undefined || row?.take?.preserve_pitch !== undefined) count += 1;
    return total + count;
  }, 0);
}

async function ensureEightItemsWithActiveTakes({ callTemplate, journal, budget }) {
  const discovered = await discoverItems(callTemplate, budget);
  if (discovered.length >= 8) {
    await journal.appendCall?.({ tool: "discover_items", response: { count: discovered.length }, label: "fixture" });
    return discovered.slice(0, 8);
  }
  const created = [];
  for (let index = discovered.length; index < 8; index += 1) {
    const track = await callTemplate({
      id: "template.tracks.create_track",
      input: { name: `d1-batch-${index + 1}` },
      budget,
      context: requestContext(`create-track-${index + 1}`),
    });
    const trackRef = firstRef(track, "track") ?? track?.result?.summary?.track_ref ?? track?.result?.data?.track_ref;
    if (typeof trackRef !== "string") throw coded("D1_HARNESS_TRACK_CREATE_FAILED", "Could not create fixture Track.");
    const item = await callTemplate({
      id: "template.midi.create_midi_item",
      input: {
        start_seconds: index,
        end_seconds: index + 2,
      },
      refs: { track_ref: trackRef },
      budget,
      context: requestContext(`create-item-${index + 1}`),
    });
    const itemRef = firstRef(item, "item") ?? item?.result?.summary?.item_ref ?? item?.result?.data?.item_ref;
    if (typeof itemRef !== "string") throw coded("D1_HARNESS_ITEM_CREATE_FAILED", "Could not create fixture Item.");
    const summary = await callTemplate({
      id: "template.items.read_item_summary",
      input: { include_take_summary: true },
      refs: { item_ref: itemRef },
      budget,
      context: requestContext(`summary-${index + 1}`),
    });
    const takeRef = summary?.result?.summary?.active_take_ref
      ?? summary?.result?.readback?.active_take_ref
      ?? summary?.result?.data?.active_take_ref
      ?? firstRef(summary, "take");
    if (typeof takeRef !== "string") throw coded("D1_HARNESS_TAKE_REQUIRED", "Created Item has no Active Take.");
    created.push({ item_ref: itemRef, take_ref: takeRef });
  }
  return [...discovered, ...created].slice(0, 8);
}

async function discoverItems(callTemplate, budget) {
  try {
    const selected = await callTemplate({
      id: "template.items.list_selected_items",
      input: { limit: 8, include_track_refs: true },
      budget,
      context: requestContext("list-selected"),
    });
    const refs = Array.isArray(selected?.result?.refs)
      ? selected.result.refs.filter((entry) => entry?.kind === "item").map((entry) => entry.ref)
      : [];
    const out = [];
    for (const itemRef of refs.slice(0, 8)) {
      const summary = await callTemplate({
        id: "template.items.read_item_summary",
        input: { include_take_summary: true },
        refs: { item_ref: itemRef },
        budget,
        context: requestContext(`discover-${out.length + 1}`),
      });
      const takeRef = summary?.result?.summary?.active_take_ref
        ?? summary?.result?.readback?.active_take_ref
        ?? summary?.result?.data?.active_take_ref;
      if (typeof takeRef === "string" && takeRef.length > 0) out.push({ item_ref: itemRef, take_ref: takeRef });
    }
    return out;
  } catch {
    return [];
  }
}

async function runBatchOnce({ label, callTemplate, journal, budget, changes, dryRun }) {
  const started = performance.now();
  const request = {
    id: "macro.items.apply",
    input: {
      mode: "set_item_take_controls",
      dry_run: dryRun,
      changes,
    },
    budget,
    context: {
      request_id: `d1-items-batch-${label}-request-id-30c`,
      session_id: "d1-items-batch",
      request_sequence: label === "cold" ? 1 : 2,
    },
  };
  const response = await callTemplate(request);
  const totalMs = Math.max(0, performance.now() - started);
  const validation = validateBatchResponse(response, { budget, changes });
  await journal.appendCall?.({
    tool: "call_template",
    request,
    response,
    label,
  });
  return {
    ok: validation.ok === true && (response?.ok === true || response?.execution?.status === "completed"),
    total_ms: totalMs,
    request_bytes: Buffer.byteLength(JSON.stringify(request), "utf8"),
    response_bytes: validation.bytes ?? Buffer.byteLength(JSON.stringify(response ?? {}), "utf8"),
    validation,
    calls: response?.result?.data?.calls ?? null,
    timings: response?.result?.data?.timings ?? null,
    row_truth: response?.result?.changes ?? null,
    index_outcome: response?.result?.changes?.[0]?.index ?? null,
    invalidate_scopes_count: response?.result?.data?.calls?.index ?? 0,
    program_id: response?.macro?.program_id ?? null,
    sqlite: response?.sqlite ?? null,
  };
}

function createClientCallTemplate(client) {
  return async (request) => {
    const result = await client.callTool({
      name: "call_template",
      arguments: {
        id: request.id,
        input: request.input,
        refs: request.refs,
        budget: request.budget,
      },
    });
    const text = result?.content?.find?.((entry) => entry?.type === "text")?.text;
    if (typeof text === "string" && text.trim().startsWith("{")) {
      try {
        return JSON.parse(text);
      } catch {
        // fall through
      }
    }
    return result?.structuredContent ?? result;
  };
}

function firstRef(response, kind) {
  const refs = response?.result?.refs;
  if (!Array.isArray(refs)) return null;
  const hit = refs.find((entry) => entry?.kind === kind && typeof entry?.ref === "string");
  return hit?.ref ?? null;
}

function requestContext(suffix) {
  return {
    request_id: `d1-items-batch-${suffix}-request-id-30c`.slice(0, 48),
    session_id: "d1-items-batch",
    request_sequence: 1,
  };
}

function normalizeLiveEnvironment(value, sourceProject) {
  if (!value || typeof value !== "object") {
    throw coded("D1_HARNESS_LIVE_ENV_REQUIRED", "executeLive requires explicit owner/generation and fresh bridge/session paths.");
  }
  const result = {
    transportDir: value.transportDir,
    artifactRoot: value.artifactRoot,
    renderRoot: value.renderRoot,
    indexRoot: value.indexRoot,
    bridgeOwner: value.bridgeOwner,
    bridgeGeneration: value.bridgeGeneration,
    projectPath: value.projectPath ?? sourceProject,
  };
  for (const key of ["transportDir", "artifactRoot", "renderRoot", "indexRoot", "projectPath"]) {
    assertAbsolute(result[key], key);
  }
  if (typeof result.bridgeOwner !== "string" || result.bridgeOwner.trim() === "") {
    throw coded("D1_HARNESS_BRIDGE_OWNER_INVALID", "bridgeOwner is required.");
  }
  if (!Number.isInteger(result.bridgeGeneration) || result.bridgeGeneration < 1) {
    throw coded("D1_HARNESS_BRIDGE_GENERATION_INVALID", "bridgeGeneration must be a positive integer.");
  }
  if (path.resolve(result.projectPath) !== path.resolve(sourceProject)) {
    throw coded("D1_HARNESS_PROJECT_IDENTITY_MISMATCH", "live projectPath must equal sourceProject.");
  }
  return result;
}

async function sha256File(filePath) {
  try {
    const bytes = await readFile(filePath);
    return createHash("sha256").update(bytes).digest("hex");
  } catch {
    return null;
  }
}

function assertAbsolute(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw coded("D1_HARNESS_PATH_INVALID", `${name} must be an absolute path.`);
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.error("Control-tower live runner only. Import runAlpha34D1ItemsBatchHarness from tests or CT scripts.");
  process.exit(2);
}
