#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createEvidenceJournal } from "./lib/alpha3-4-harness-evidence-v1.mjs";

const CONTRACT = "openreaper.alpha3.4.d2_fx_batch_live_harness.v1";
const PUBLIC_BUDGET = Object.freeze({
  max_response_bytes: 2_048,
  max_items: 8,
  max_inline_value_bytes: 256,
});

export async function connectInstalledWrapperD2FxBatch({
  installedWrapper,
  liveEnvironment = null,
  clientName = "d2-fx-batch",
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
        OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: "alpha34-d2-fx-batch",
        OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
      } : {}),
    },
  }));
  return client;
}

export async function runAlpha34D2FxBatchHarness({
  installedWrapper,
  sourceProject,
  evidenceRoot,
  executeLive = false,
  warmLatencyCeilingMs = null,
  maxResponseBytes = PUBLIC_BUDGET.max_response_bytes,
  liveEnvironment = null,
  fixtureAssignments = null,
  connectFactory = connectInstalledWrapperD2FxBatch,
  callTemplate = null,
  fakeTransportOnly = false,
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(sourceProject, "sourceProject");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  if (executeLive === true && fakeTransportOnly === true) {
    throw coded("D2_HARNESS_FAKE_TRANSPORT_FORBIDDEN", "Real execution cannot select the fake-only transport path.");
  }
  if (executeLive !== true && fakeTransportOnly !== true && typeof callTemplate !== "function") {
    throw coded("D2_HARNESS_FAKE_TRANSPORT_REQUIRED", "Unit tests must set fakeTransportOnly with an explicit callTemplate adapter.");
  }
  if (executeLive === true && typeof connectFactory !== "function") {
    throw coded("D2_HARNESS_LIVE_TRANSPORT_REQUIRED", "Live harness requires connectFactory for the installed wrapper.");
  }
  if (fakeTransportOnly === true && typeof callTemplate !== "function") {
    throw coded("D2_HARNESS_CALL_TEMPLATE_REQUIRED", "fakeTransportOnly requires an explicit callTemplate adapter.");
  }
  if (!Array.isArray(fixtureAssignments) || fixtureAssignments.length < 1 || fixtureAssignments.length > 8) {
    throw coded("D2_HARNESS_FIXTURE_REQUIRED", "Harness requires explicit 1-8 vendor-neutral exact assignment rows.");
  }

  const harnessStarted = performance.now();
  const wrapperCommand = path.resolve(installedWrapper);
  const runtimeSource = executeLive === true
    ? connectFactory === connectInstalledWrapperD2FxBatch ? "installed_wrapper" : "injected_live_connector"
    : "fake_transport";
  const budget = Object.freeze({
    max_response_bytes: maxResponseBytes,
    max_items: 8,
    max_inline_value_bytes: 256,
  });
  const journal = await createEvidenceJournal({
    evidenceRoot: path.resolve(evidenceRoot),
    provenance: {
      canary_contract: CONTRACT,
      runtime_source: runtimeSource,
      runtime_command: runtimeSource === "installed_wrapper" ? wrapperCommand : null,
      configured_wrapper_command: wrapperCommand,
      transport: runtimeSource,
      auto_promote_proof: false,
    },
  });

  const report = {
    contract: CONTRACT,
    ok: true,
    status: executeLive ? "live" : "fake",
    runtime: {
      source: runtimeSource,
      command: runtimeSource === "installed_wrapper" ? wrapperCommand : null,
      configured_wrapper_command: wrapperCommand,
    },
    evidence: journal.paths,
    source_project: path.resolve(sourceProject),
    budget,
    fixture_assignments: fixtureAssignments,
    cold: null,
    warm: null,
    warm_latency_ceiling_ms: warmLatencyCeilingMs,
    source_media_deleted: false,
    rendered_outputs: [],
    project_before_hash: null,
    project_after_hash: null,
    recovery_posture: {
      source_project_is_authorized_disposable_fixture: executeLive === true,
      source_project_hashes_recorded: false,
      save_current_verified: false,
      recovery_required: false,
      automatic_proof_catalog_write: false,
    },
    source_media_deletion_evidence: "FX parameter batch and project save expose no source-media deletion route.",
    render_evidence: "Harness issues no render call.",
  };

  let client = null;
  let transportCall = null;
  try {
    report.project_before_hash = await sha256File(sourceProject);
    if (executeLive === true && report.project_before_hash === null) {
      throw coded("D2_HARNESS_PROJECT_HASH_REQUIRED", "Live harness could not hash the source project before mutation.");
    }
    if (executeLive === true) {
      const env = normalizeLiveEnvironment(liveEnvironment, sourceProject);
      client = await connectFactory({
        installedWrapper: path.resolve(installedWrapper),
        liveEnvironment: env,
        clientName: "d2-fx-batch",
      });
      transportCall = createClientCallTemplate(client);
    } else {
      transportCall = callTemplate;
    }

    const cold = await runBatchOnce({
      label: "cold",
      callTemplate: transportCall,
      journal,
      budget,
      assignments: fixtureAssignments,
    });
    report.cold = cold;
    const warm = await runBatchOnce({
      label: "warm",
      callTemplate: transportCall,
      journal,
      budget,
      assignments: fixtureAssignments,
    });
    report.warm = warm;

    if (Number.isFinite(warmLatencyCeilingMs) && warm.total_ms > warmLatencyCeilingMs) {
      report.ok = false;
      report.status = "warm_latency_exceeded";
      report.error = {
        code: "D2_HARNESS_WARM_LATENCY_EXCEEDED",
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
        budget: { max_response_bytes: 12_000, max_items: 8, max_inline_value_bytes: 256 },
        context: {
          request_id: "d2-fx-batch-save-current-request-id-30c",
          session_id: "d2-fx-batch",
          request_sequence: 99,
        },
      };
      const saveStarted = performance.now();
      let saveResponse;
      try {
        saveResponse = await transportCall(saveRequest);
      } catch (error) {
        await journal.recordCall({
          scenario: "d2_fx_batch",
          step_id: "save_current",
          client: runtimeSource,
          tool: "call_template",
          requested_id: saveRequest.id,
          request: saveRequest,
          response: { thrown: { code: error?.code ?? null, message: error?.message ?? "save failed" } },
          ok: false,
          error,
          duration_ms: Math.max(0, performance.now() - saveStarted),
          response_bytes: 0,
          request_budget: saveRequest.budget,
        });
        throw error;
      }
      const saveOk = saveResponse?.ok === true && saveResponse?.execution?.status === "completed";
      const saveBytes = Buffer.byteLength(JSON.stringify(saveResponse ?? {}), "utf8");
      await journal.recordCall({
        scenario: "d2_fx_batch",
        step_id: "save_current",
        client: runtimeSource,
        tool: "call_template",
        requested_id: saveRequest.id,
        request: saveRequest,
        response: saveResponse,
        ok: saveOk,
        error: saveOk ? null : saveResponse?.error ?? { code: "D2_HARNESS_SAVE_FAILED", message: "save_current did not complete." },
        duration_ms: Math.max(0, performance.now() - saveStarted),
        response_bytes: saveBytes,
        request_budget: saveRequest.budget,
        value: saveResponse,
      });
      report.save = {
        ok: saveOk,
        execution_status: saveResponse?.execution?.status ?? null,
        response_bytes: saveBytes,
        error: saveOk ? null : saveResponse?.error ?? { code: "D2_HARNESS_SAVE_FAILED", message: "save_current did not complete." },
      };
      report.recovery_posture.save_current_verified = saveOk;
      if (!saveOk) {
        report.ok = false;
        report.status = "failed";
        report.error = report.save.error;
        report.recovery_posture.recovery_required = true;
      }
    }
    report.project_after_hash = await sha256File(sourceProject);
    if (executeLive === true && report.project_after_hash === null) {
      throw coded("D2_HARNESS_PROJECT_HASH_REQUIRED", "Live harness could not hash the source project after save.");
    }
    report.recovery_posture.source_project_hashes_recorded = report.project_before_hash !== null && report.project_after_hash !== null;
    report.source_hashes = { before: report.project_before_hash, after: report.project_after_hash };
  } catch (error) {
    report.ok = false;
    report.status = "failed";
    report.error = {
      code: error?.code ?? "D2_HARNESS_FAILED",
      message: error?.message ?? "Harness failed.",
    };
    report.recovery_posture.recovery_required = executeLive === true;
  } finally {
    if (client && typeof client.close === "function") {
      try {
        await client.close();
        report.client_close = { attempted: true, ok: true };
      } catch (error) {
        report.client_close = {
          attempted: true,
          ok: false,
          error: { code: error?.code ?? "D2_HARNESS_CLIENT_CLOSE_FAILED", message: error?.message ?? "close failed" },
        };
        report.ok = false;
        report.status = "failed";
        report.error ??= report.client_close.error;
        report.recovery_posture.recovery_required = true;
      }
    }
    report.duration_ms = Math.max(0, performance.now() - harnessStarted);
    await journal.finalize(report);
  }
  return report;
}

export function validateBatchResponse(response, { budget, assignments }) {
  if (!response || typeof response !== "object") {
    return { ok: false, code: "D2_HARNESS_RESPONSE_INVALID", message: "Batch response missing." };
  }
  const bytes = Buffer.byteLength(JSON.stringify(response), "utf8");
  if (bytes > budget.max_response_bytes) {
    return { ok: false, code: "D2_HARNESS_BUDGET_EXCEEDED", message: `Response ${bytes} exceeds ${budget.max_response_bytes}.` };
  }
  if (response.ok !== true || response?.execution?.status !== "completed") {
    return { ok: false, code: "D2_HARNESS_EXECUTION_NOT_COMPLETED", message: "Batch response must be ok:true with execution.status=completed." };
  }
  if (response?.macro?.id !== "macro.fx.set_controls"
    || response?.macro?.program_id !== "openreaper.macro.fx.set_controls") {
    return { ok: false, code: "D2_HARNESS_PROGRAM_IDENTITY_INVALID", message: "Batch response did not preserve macro identity." };
  }
  if (response?.result?.verification?.status !== "passed") {
    return { ok: false, code: "D2_HARNESS_VERIFICATION_INVALID", message: "Batch response verification must pass." };
  }
  if (!Array.isArray(response?.result?.changes) || response.result.changes.length !== assignments.length) {
    return { ok: false, code: "D2_HARNESS_ROW_COUNT_INVALID", message: "Batch response did not retain every row." };
  }
  for (const [index, row] of assignments.entries()) {
    const observed = response.result.changes[index];
    if (observed?.id !== row.id) {
      return { ok: false, code: "D2_HARNESS_ROW_ID_MISMATCH", message: `Row ${index} id was rewritten.` };
    }
    if (observed.status !== "ok" || observed.mutation !== "done" || observed.readback !== "pass" || observed.index !== "done") {
      return { ok: false, code: "D2_HARNESS_ROW_TRUTH_INVALID", message: `Row ${row.id} did not prove applied mutation, live readback, and index maintenance.` };
    }
  }
  if (response?.result?.data?.mode !== "exact_assignments") {
    return { ok: false, code: "D2_HARNESS_MODE_INVALID", message: "Result mode must be exact_assignments." };
  }
  const uniqueFxCount = new Set(assignments.map((row) => row.fx_ref)).size;
  const calls = response?.result?.data?.calls;
  if (response?.result?.data?.unique_fx_count !== uniqueFxCount) {
    return { ok: false, code: "D2_HARNESS_UNIQUE_FX_COUNT_INVALID", message: "Batch response unique_fx_count does not match the exact request." };
  }
  if (!calls || calls.resolve !== uniqueFxCount * 2 || calls.inventory < uniqueFxCount || calls.preflight !== assignments.length
    || calls.mutation !== assignments.length || calls.readback !== assignments.length || calls.index !== 1) {
    return { ok: false, code: "D2_HARNESS_CALL_COUNTERS_INVALID", message: "Batch response actual-call counters do not prove the required execution path." };
  }
  const callTotal = calls.resolve + calls.inventory + calls.preflight + calls.mutation + calls.readback + calls.index;
  if (calls.total !== callTotal) {
    return { ok: false, code: "D2_HARNESS_CALL_TOTAL_INVALID", message: "Batch response call total is not the sum of actual counters." };
  }
  if (response?.sqlite?.used !== true || response?.sqlite?.freshness !== "stale") {
    return { ok: false, code: "D2_HARNESS_SQLITE_TRUTH_INVALID", message: "Batch response must report the once-invalidated FX index as stale." };
  }
  if (response?.budget?.truncated !== false || response?.budget?.actual_bytes > budget.max_response_bytes) {
    return { ok: false, code: "D2_HARNESS_RESPONSE_BUDGET_INVALID", message: "Batch response budget truth is invalid." };
  }
  return { ok: true, bytes };
}

async function runBatchOnce({ label, callTemplate, journal, budget, assignments }) {
  const started = performance.now();
  const request = {
    id: "macro.fx.set_controls",
    input: {
      mode: "exact_assignments",
      dry_run: false,
      assignments,
    },
    budget,
    context: {
      request_id: `d2-fx-batch-${label}-request-id-30chars`,
      session_id: "d2-fx-batch",
      request_sequence: label === "cold" ? 1 : 2,
    },
  };
  const response = await callTemplate(request);
  const totalMs = Math.max(0, performance.now() - started);
  const validation = validateBatchResponse(response, { budget, assignments });
  await journal.recordCall({
    scenario: "d2_fx_batch",
    step_id: label,
    client: "fx_batch",
    tool: "call_template",
    requested_id: request.id,
    request,
    response,
    ok: validation.ok === true,
    error: validation.ok === true ? null : validation,
    duration_ms: totalMs,
    response_bytes: validation.bytes ?? Buffer.byteLength(JSON.stringify(response ?? {}), "utf8"),
    request_budget: budget,
    value: response,
  });
  return {
    ok: validation.ok === true,
    total_ms: totalMs,
    request_bytes: Buffer.byteLength(JSON.stringify(request), "utf8"),
    response_bytes: validation.bytes ?? Buffer.byteLength(JSON.stringify(response ?? {}), "utf8"),
    validation,
    calls: response?.result?.data?.calls ?? null,
    timings: response?.result?.data?.timings ?? null,
    unique_fx_count: response?.result?.data?.unique_fx_count ?? null,
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

function normalizeLiveEnvironment(value, sourceProject) {
  if (!value || typeof value !== "object") {
    throw coded("D2_HARNESS_LIVE_ENV_REQUIRED", "executeLive requires explicit owner/generation and fresh bridge/session paths.");
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
    throw coded("D2_HARNESS_BRIDGE_OWNER_INVALID", "bridgeOwner is required.");
  }
  if (!Number.isInteger(result.bridgeGeneration) || result.bridgeGeneration < 1) {
    throw coded("D2_HARNESS_BRIDGE_GENERATION_INVALID", "bridgeGeneration must be a positive integer.");
  }
  if (path.resolve(result.projectPath) !== path.resolve(sourceProject)) {
    throw coded("D2_HARNESS_PROJECT_IDENTITY_MISMATCH", "live projectPath must equal sourceProject.");
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
    throw coded("D2_HARNESS_PATH_INVALID", `${name} must be an absolute path.`);
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.error("Control-tower live runner only. Import runAlpha34D2FxBatchHarness from tests or CT scripts.");
  process.exit(2);
}
