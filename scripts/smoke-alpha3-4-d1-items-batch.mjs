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
const SAVE_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: 8,
  max_inline_value_bytes: 4_096,
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

  const started = performance.now();
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
    provenance: {
      installed_wrapper_sha256: null,
      package_provenance: null,
    },
    source_project: path.resolve(sourceProject),
    budget,
    fixture_budget: fixtureBudget,
    save_budget: SAVE_BUDGET,
    live_environment: null,
    fixture_items: null,
    fixture_setup: null,
    cold: null,
    warm: null,
    warm_latency_ceiling_ms: warmLatencyCeilingMs,
    source_media_deleted: false,
    rendered_outputs: [],
    save: null,
    project_before_hash: null,
    project_after_hash: null,
    source_hashes: { before: null, after: null },
    project_changes: [],
    duration_ms: 0,
    response_bytes: { total: 0, maximum_single_call: 0 },
    evidence: journal.paths,
    backup_recovery_posture: {
      source_project_is_authorized_disposable_fixture: executeLive === true,
      source_project_saved: false,
      source_project_save_status: "not_attempted",
      source_media_preserved: true,
      rendered_outputs: [],
      backup_project: inferBackupProjectPath(evidenceRoot, sourceProject),
      backup_project_sha256: null,
      recovery_required: false,
    },
    recovery_posture: {
      source_project_is_authorized_disposable_fixture: executeLive === true,
      evidence_project_preserved: true,
      automatic_proof_catalog_write: false,
    },
  };

  let client = null;
  let transportCall = null;
  try {
    report.provenance.installed_wrapper_sha256 = await sha256File(installedWrapper);
    if (executeLive === true && !report.provenance.installed_wrapper_sha256) {
      throw coded("D1_HARNESS_INSTALLED_WRAPPER_UNREADABLE", "Live execution requires a readable installed wrapper.");
    }
    report.provenance.package_provenance = await loadInstalledPackageProvenance(installedWrapper, { required: executeLive === true });
    journal.setProvenance?.(report.provenance);
    report.project_before_hash = await sha256File(sourceProject);
    if (executeLive === true && !report.project_before_hash) {
      throw coded("D1_HARNESS_SOURCE_PROJECT_UNREADABLE", "Live execution requires a readable source project before mutation.");
    }
    report.source_hashes.before = report.project_before_hash;
    report.backup_recovery_posture.backup_project_sha256 = await sha256File(report.backup_recovery_posture.backup_project);
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

    const fixtureSetup = {
      source: "pending",
      discovered_count: 0,
      created_tracks: [],
      created_items: [],
      mutation_attempts: [],
    };
    report.fixture_setup = fixtureSetup;
    const fixture = await ensureEightItemsWithActiveTakes({
      callTemplate: transportCall,
      journal,
      budget: fixtureBudget,
      setup: fixtureSetup,
    });
    report.fixture_items = fixture.items;
    const changes = buildEightRowChanges(fixture.items);

    const cold = await runBatchOnce({
      label: "cold",
      callTemplate: transportCall,
      journal,
      budget,
      changes,
      dryRun: false,
    });
    report.cold = cold;
    if (cold.outcome === "unknown") {
      throw coded(cold.error?.code ?? "D1_HARNESS_BATCH_CALL_FAILED", cold.error?.message ?? "Cold batch outcome is unknown.");
    }
    const warm = await runBatchOnce({
      label: "warm",
      callTemplate: transportCall,
      journal,
      budget,
      changes,
      dryRun: false,
    });
    report.warm = warm;
    if (warm.outcome === "unknown") {
      throw coded(warm.error?.code ?? "D1_HARNESS_BATCH_CALL_FAILED", warm.error?.message ?? "Warm batch outcome is unknown.");
    }

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
      const saveRequest = {
        id: "macro.project.file",
        input: { operation: "save_current", dry_run: false },
        budget: SAVE_BUDGET,
        context: {
          request_id: "d1-items-batch-save-current-request-30c",
          session_id: "d1-items-batch",
          request_sequence: 99,
        },
      };
      const saveStarted = performance.now();
      let saveResponse = null;
      let saveError = null;
      try {
        saveResponse = await transportCall({ ...saveRequest });
      } catch (error) {
        saveError = error;
      }
      const saveOk = saveError === null && (saveResponse?.ok === true || saveResponse?.execution?.status === "completed");
      const saveOutcome = saveError ? "unknown" : saveOk ? "saved" : "failed";
      const saveDurationMs = Math.max(0, performance.now() - saveStarted);
      const saveResponseBytes = saveResponse === null ? 0 : Buffer.byteLength(JSON.stringify(saveResponse), "utf8");
      report.save = {
        ok: saveOk,
        status: saveOutcome,
        execution_status: saveResponse?.execution?.status ?? null,
        recovery_required: saveOutcome === "unknown",
        duration_ms: saveDurationMs,
        response_bytes: saveResponseBytes,
      };
      report.backup_recovery_posture.source_project_save_status = saveOutcome;
      if (saveOutcome === "unknown") {
        report.backup_recovery_posture.source_project_saved = null;
        report.backup_recovery_posture.recovery_required = true;
      }
      await journal.recordCall({
        scenario: "d1-items-batch",
        step_id: "save",
        client: "d1-items-batch",
        tool: "call_template",
        requested_id: saveRequest.id,
        request: saveRequest,
        response: saveResponse ?? { error: { code: saveError?.code ?? "D1_HARNESS_SAVE_FAILED", message: saveError?.message ?? "Save call failed." } },
        value: saveResponse,
        ok: saveOk,
        error: saveOk ? null : saveError ?? saveResponse?.error ?? { code: "D1_HARNESS_SAVE_FAILED", message: "Save did not complete." },
        duration_ms: saveDurationMs,
        response_bytes: saveResponseBytes,
        request_budget: SAVE_BUDGET,
      });
      if (saveError) throw saveError;
      if (!saveOk) {
        throw coded(
          saveResponse?.error?.code ?? "D1_HARNESS_SAVE_FAILED",
          saveResponse?.error?.message ?? "Saving the live fixture project did not complete.",
        );
      }
      report.backup_recovery_posture.source_project_saved = true;
      report.backup_recovery_posture.source_project_save_status = "saved";
    }
    report.project_after_hash = await sha256File(sourceProject);
    if (executeLive === true && !report.project_after_hash) {
      throw coded("D1_HARNESS_SOURCE_PROJECT_UNREADABLE", "Live execution requires a readable source project after mutation.");
    }
    report.source_hashes.after = report.project_after_hash;
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
    report.project_after_hash ??= await sha256File(sourceProject);
    report.source_hashes.after = report.project_after_hash;
    report.project_changes = summarizeProjectChanges(report);
    if (report.project_changes.some((change) => change?.recovery_required === true)) {
      report.backup_recovery_posture.recovery_required = true;
    }
    report.duration_ms = Math.round(performance.now() - started);
    report.response_bytes = summarizeResponseBytes(journal.events);
    report.recovery_posture = {
      ...report.recovery_posture,
      source_project_saved: report.backup_recovery_posture.source_project_saved,
      source_media_preserved: report.backup_recovery_posture.source_media_preserved,
      backup_project: report.backup_recovery_posture.backup_project,
      backup_project_sha256: report.backup_recovery_posture.backup_project_sha256,
    };
    try {
      await journal.recordCall({
        scenario: "d1-items-batch",
        step_id: "report-pre-finalize",
        client: "control-tower",
        tool: "harness_report",
        requested_id: CONTRACT,
        request: { contract: CONTRACT, evidence_root: path.resolve(evidenceRoot) },
        response: report,
        value: report,
        ok: report.ok === true,
        error: report.error ?? null,
        duration_ms: report.duration_ms,
        response_bytes: Buffer.byteLength(JSON.stringify(report), "utf8"),
      });
      await journal.finalize?.(report);
    } catch (error) {
      report.ok = false;
      report.status = "failed";
      report.evidence_error = {
        code: error?.code ?? "D1_HARNESS_EVIDENCE_FAILED",
        message: error?.message ?? "Evidence persistence failed.",
      };
      report.error ??= report.evidence_error;
    }
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

async function ensureEightItemsWithActiveTakes({ callTemplate, journal, budget, setup }) {
  const started = performance.now();
  const discovered = await discoverItems(callTemplate, journal, budget);
  setup.discovered_count = discovered.length;
  if (discovered.length >= 8) {
    const items = discovered.slice(0, 8);
    setup.source = "selected_items";
    await journal.recordStage({
      scenario: "d1-items-batch",
      step_id: "fixture-items",
      ok: true,
      duration_ms: Math.max(0, performance.now() - started),
      details: { source: setup.source, count: items.length },
    });
    return { items, setup };
  }
  const created = [];
  setup.source = discovered.length > 0 ? "selected_and_created" : "created_items";
  for (let index = discovered.length; index < 8; index += 1) {
    const trackRequest = {
      id: "template.tracks.create_track",
      input: { name: `d1-batch-${index + 1}` },
      budget,
      context: requestContext(`create-track-${index + 1}`),
    };
    const trackAttempt = {
      operation: "template.tracks.create_track",
      step_id: `fixture-create-track-${index + 1}`,
      outcome: "unknown",
      ref: null,
    };
    setup.mutation_attempts.push(trackAttempt);
    const track = await callFixtureTemplate({
      callTemplate,
      journal,
      request: trackRequest,
      stepId: trackAttempt.step_id,
    });
    const trackRef = firstObjectRef(track, "track");
    if (!trackRef) throw coded("D1_HARNESS_TRACK_CREATE_FAILED", "Could not create fixture Track.");
    trackAttempt.outcome = "created";
    trackAttempt.ref = trackRef.ref;
    setup.created_tracks.push(trackRef.ref);
    const itemRequest = {
      id: "template.midi.create_midi_item",
      input: {
        start_seconds: index,
        end_seconds: index + 2,
      },
      refs: { track_ref: trackRef },
      budget,
      context: requestContext(`create-item-${index + 1}`),
    };
    const itemAttempt = {
      operation: "template.midi.create_midi_item",
      step_id: `fixture-create-item-${index + 1}`,
      outcome: "unknown",
      ref: null,
    };
    setup.mutation_attempts.push(itemAttempt);
    const item = await callFixtureTemplate({
      callTemplate,
      journal,
      request: itemRequest,
      stepId: itemAttempt.step_id,
    });
    const itemRef = firstObjectRef(item, "item");
    if (!itemRef) throw coded("D1_HARNESS_ITEM_CREATE_FAILED", "Could not create fixture Item.");
    itemAttempt.outcome = "created";
    itemAttempt.ref = itemRef.ref;
    setup.created_items.push(itemRef.ref);
    const summaryRequest = {
      id: "template.items.read_item_summary",
      input: { include_take_summary: true },
      refs: { item_ref: itemRef },
      budget,
      context: requestContext(`summary-${index + 1}`),
    };
    const summary = await callFixtureTemplate({
      callTemplate,
      journal,
      request: summaryRequest,
      stepId: `fixture-created-summary-${index + 1}`,
    });
    const takeRef = summary?.result?.summary?.active_take_ref
      ?? summary?.result?.readback?.active_take_ref
      ?? summary?.result?.data?.active_take_ref
      ?? firstObjectRef(summary, "take")?.ref;
    if (typeof takeRef !== "string") throw coded("D1_HARNESS_TAKE_REQUIRED", "Created Item has no Active Take.");
    created.push({ item_ref: itemRef.ref, take_ref: takeRef });
  }
  const fixtureItems = [...discovered, ...created].slice(0, 8);
  await journal.recordStage({
    scenario: "d1-items-batch",
    step_id: "fixture-items",
    ok: true,
    duration_ms: Math.max(0, performance.now() - started),
    details: { source: setup.source, discovered: discovered.length, created: created.length, count: fixtureItems.length },
  });
  return { items: fixtureItems, setup };
}

async function discoverItems(callTemplate, journal, budget) {
  const selectedRequest = {
    id: "template.items.list_selected_items",
    input: { limit: 8, include_track_refs: true },
    budget,
    context: requestContext("list-selected"),
  };
  const selected = await callFixtureTemplate({
    callTemplate,
    journal,
    request: selectedRequest,
    stepId: "fixture-list-selected",
  });
  const refs = Array.isArray(selected?.result?.refs)
    ? selected.result.refs.filter((entry) => isCanonicalObjectRef(entry, "item"))
    : [];
  const out = [];
  for (const [index, itemRef] of refs.slice(0, 8).entries()) {
    const summaryRequest = {
      id: "template.items.read_item_summary",
      input: { include_take_summary: true },
      refs: { item_ref: itemRef },
      budget,
      context: requestContext(`discover-${index + 1}`),
    };
    const summary = await callFixtureTemplate({
      callTemplate,
      journal,
      request: summaryRequest,
      stepId: `fixture-discover-summary-${index + 1}`,
    });
    const takeRef = summary?.result?.summary?.active_take_ref
      ?? summary?.result?.readback?.active_take_ref
      ?? summary?.result?.data?.active_take_ref
      ?? firstObjectRef(summary, "take")?.ref;
    if (typeof takeRef === "string" && takeRef.length > 0) out.push({ item_ref: itemRef.ref, take_ref: takeRef });
  }
  return out;
}

async function callFixtureTemplate({ callTemplate, journal, request, stepId }) {
  const started = performance.now();
  let response = null;
  let callError = null;
  try {
    response = await callTemplate(request);
  } catch (error) {
    callError = error;
  }
  const durationMs = Math.max(0, performance.now() - started);
  const responseBytes = response === null ? 0 : Buffer.byteLength(JSON.stringify(response), "utf8");
  const ok = callError === null && templateCallSucceeded(response);
  const error = callError ?? (ok ? null : response?.error ?? coded("D1_HARNESS_FIXTURE_CALL_FAILED", `${request.id} did not complete.`));
  await journal.recordCall({
    scenario: "d1-items-batch",
    step_id: stepId,
    client: "d1-items-batch",
    tool: "call_template",
    requested_id: request.id,
    request,
    response: response ?? { error: { code: error?.code ?? "D1_HARNESS_FIXTURE_CALL_FAILED", message: error?.message ?? "Fixture call failed." } },
    value: response,
    ok,
    error,
    duration_ms: durationMs,
    response_bytes: responseBytes,
    request_budget: request.budget,
  });
  if (!ok) throw error;
  return response;
}

function templateCallSucceeded(response) {
  return response?.ok === true || response?.execution?.status === "completed" || response?.verification?.status === "passed";
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
  let response = null;
  let callError = null;
  try {
    response = await callTemplate(request);
  } catch (error) {
    callError = error;
  }
  const totalMs = Math.max(0, performance.now() - started);
  const validation = callError ? { ok: false, error: { code: callError?.code ?? "D1_HARNESS_BATCH_CALL_FAILED", message: callError?.message ?? "Batch call failed." } } : validateBatchResponse(response, { budget, changes });
  const ok = callError === null && validation.ok === true && (response?.ok === true || response?.execution?.status === "completed");
  const outcome = callError ? (dryRun ? "failed" : "unknown") : ok ? "applied" : "failed";
  const responseBytes = validation.bytes ?? (response === null ? 0 : Buffer.byteLength(JSON.stringify(response), "utf8"));
  await journal.recordCall({
    scenario: "d1-items-batch",
    step_id: label,
    client: "d1-items-batch",
    tool: "call_template",
    requested_id: request.id,
    request,
    response: response ?? { error: { code: callError?.code ?? "D1_HARNESS_BATCH_CALL_FAILED", message: callError?.message ?? "Batch call failed." } },
    value: response,
    ok,
    error: callError ?? (ok ? null : response?.error ?? validation.error ?? { code: "D1_HARNESS_BATCH_INVALID", message: "Batch response did not validate." }),
    duration_ms: totalMs,
    response_bytes: responseBytes,
    request_budget: budget,
  });
  return {
    ok,
    outcome,
    recovery_required: outcome === "unknown",
    error: ok ? null : validation.error ?? { code: "D1_HARNESS_BATCH_INVALID", message: "Batch response did not validate." },
    total_ms: totalMs,
    request_bytes: Buffer.byteLength(JSON.stringify(request), "utf8"),
    response_bytes: responseBytes,
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

function firstObjectRef(response, kind) {
  const refs = response?.result?.refs;
  if (!Array.isArray(refs)) return null;
  return refs.find((entry) => isCanonicalObjectRef(entry, kind)) ?? null;
}

function isCanonicalObjectRef(value, kind) {
  if (!value || typeof value !== "object" || value.kind !== kind || typeof value.ref !== "string") return false;
  if (value.identity?.scheme !== "guid" || typeof value.identity?.value !== "string") return false;
  return value.ref === `${kind}:guid:${value.identity.value}`;
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

async function loadInstalledPackageProvenance(wrapperPath, { required }) {
  const binDirectory = path.dirname(path.resolve(wrapperPath));
  if (path.basename(binDirectory) !== "bin") {
    if (!required) return null;
    throw coded("D1_HARNESS_INSTALLED_WRAPPER_LAYOUT_INVALID", "Installed wrapper must be located under the package bin directory.");
  }
  const provenancePath = path.join(path.dirname(binDirectory), "provenance.json");
  let bytes;
  let value;
  try {
    bytes = await readFile(provenancePath);
    value = JSON.parse(bytes.toString("utf8"));
  } catch {
    if (!required) return null;
    throw coded("D1_HARNESS_PACKAGE_PROVENANCE_UNREADABLE", "Installed package provenance is missing or invalid.");
  }
  if (
    value?.contract !== "openreaper.package.provenance.v1"
    || typeof value.package_version !== "string"
    || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(value.package_version)
    || value.package_version === "0.0.0"
    || typeof value.build_id !== "string"
    || value.build_id.length === 0
    || !/^[0-9a-f]{40}$/u.test(value?.openreaper_git_commit ?? "")
    || typeof value.build_time_utc !== "string"
    || Number.isNaN(Date.parse(value.build_time_utc))
    || value?.source_tree_clean !== true
    || value.accepted_macro_count !== 15
    || value.accepted_template_count !== 237
    || value.bridge_handler_count !== 91
  ) {
    throw coded("D1_HARNESS_PACKAGE_PROVENANCE_INVALID", "Installed package provenance does not prove a clean product commit.");
  }
  return {
    provenance_path: provenancePath,
    provenance_sha256: createHash("sha256").update(bytes).digest("hex"),
    contract: value.contract,
    package_version: value.package_version ?? null,
    build_id: value.build_id ?? null,
    openreaper_git_commit: value.openreaper_git_commit,
    build_time_utc: value.build_time_utc ?? null,
    source_tree_clean: value.source_tree_clean,
    accepted_macro_count: value.accepted_macro_count ?? null,
    accepted_template_count: value.accepted_template_count ?? null,
    bridge_handler_count: value.bridge_handler_count ?? null,
  };
}

function inferBackupProjectPath(evidenceRoot, sourceProject) {
  const extension = path.extname(sourceProject);
  const baseName = path.basename(sourceProject, extension);
  return path.join(path.dirname(path.resolve(evidenceRoot)), "recovery", `${baseName}.before${extension}`);
}

function summarizeProjectChanges(report) {
  const changes = [];
  if (Array.isArray(report.fixture_setup?.created_tracks) && report.fixture_setup.created_tracks.length > 0) {
    changes.push({
      operation: "template.tracks.create_track",
      phase: "fixture",
      status: "created",
      count: report.fixture_setup.created_tracks.length,
      refs: report.fixture_setup.created_tracks,
    });
  }
  if (Array.isArray(report.fixture_setup?.created_items) && report.fixture_setup.created_items.length > 0) {
    changes.push({
      operation: "template.midi.create_midi_item",
      phase: "fixture",
      status: "created",
      count: report.fixture_setup.created_items.length,
      refs: report.fixture_setup.created_items,
    });
  }
  const uncertainMutations = Array.isArray(report.fixture_setup?.mutation_attempts)
    ? report.fixture_setup.mutation_attempts.filter((attempt) => attempt?.outcome === "unknown")
    : [];
  for (const operation of ["template.tracks.create_track", "template.midi.create_midi_item"]) {
    const attempts = uncertainMutations.filter((attempt) => attempt?.operation === operation);
    if (attempts.length === 0) continue;
    changes.push({
      operation,
      phase: "fixture",
      status: "unknown",
      count: attempts.length,
      recovery_required: true,
      step_ids: attempts.map((attempt) => attempt.step_id),
    });
  }
  for (const phase of ["cold", "warm"]) {
    const result = report[phase];
    if (!result) continue;
    changes.push({
      operation: "macro.items.apply",
      phase,
      status: result.outcome ?? (result.ok === true ? "applied" : "failed"),
      recovery_required: result.recovery_required === true,
      requested_rows: 8,
      live_readback_rows: Array.isArray(result.row_truth) ? result.row_truth.filter((row) => row?.readback === "pass").length : 0,
      mutation_calls: result.calls?.mutation ?? 0,
      index_maintenance_calls: result.calls?.index ?? 0,
    });
  }
  if (report.save) {
    changes.push({
      operation: "macro.project.file",
      phase: "save",
      status: report.save.status ?? (report.save.ok === true ? "saved" : "failed"),
      recovery_required: report.save.recovery_required === true,
    });
  }
  return changes;
}

function summarizeResponseBytes(events) {
  const values = Array.isArray(events)
    ? events.filter((event) => event?.type === "call" && event?.tool === "call_template").map((event) => event.response_bytes).filter(Number.isFinite)
    : [];
  return {
    total: values.reduce((sum, value) => sum + value, 0),
    maximum_single_call: values.reduce((maximum, value) => Math.max(maximum, value), 0),
  };
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
