#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createEvidenceJournal } from "./lib/alpha3-4-harness-evidence-v1.mjs";

const CONTRACT = "openreaper.alpha3.4.d3_project_switching_live_harness.v1";
const PUBLIC_BUDGET = Object.freeze({
  max_response_bytes: 2_048,
  max_items: 25,
  max_inline_value_bytes: 256,
});
const MACRO_ID = "macro.project.file";
const ACTIVATE_TAB_ID = "template.project.activate_project_tab";

export async function connectInstalledWrapperD3ProjectSwitching({
  installedWrapper,
  liveEnvironment = null,
  clientName = "d3-project-switching",
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
        OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY: clientName,
        OPENREAPER_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: liveEnvironment.artifactRoot,
        OPENREAPER_LIVE_SMOKE_RENDER_ROOT: liveEnvironment.renderRoot,
      } : {}),
    },
  }));
  return client;
}

export async function runAlpha34D3ProjectSwitchingHarness({
  installedWrapper,
  sourceProject,
  evidenceRoot,
  executeLive = false,
  liveEnvironment = null,
  connectFactory = connectInstalledWrapperD3ProjectSwitching,
  callTemplate = null,
  callTemplateB = null,
  fakeTransportOnly = false,
  maxResponseBytes = PUBLIC_BUDGET.max_response_bytes,
  now = () => new Date(),
} = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(sourceProject, "sourceProject");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  if (executeLive === true && fakeTransportOnly === true) {
    throw coded("D3_HARNESS_FAKE_TRANSPORT_FORBIDDEN", "Real execution cannot select the fake-only transport path.");
  }
  if (executeLive !== true && fakeTransportOnly !== true && typeof callTemplate !== "function") {
    throw coded("D3_HARNESS_FAKE_TRANSPORT_REQUIRED", "Unit tests must set fakeTransportOnly with an explicit callTemplate adapter.");
  }
  if (fakeTransportOnly === true && typeof callTemplate !== "function") {
    throw coded("D3_HARNESS_CALL_TEMPLATE_REQUIRED", "fakeTransportOnly requires an explicit callTemplate adapter.");
  }
  if (executeLive === true && typeof connectFactory !== "function") {
    throw coded("D3_HARNESS_LIVE_TRANSPORT_REQUIRED", "Live harness requires connectFactory for the installed wrapper.");
  }

  const wrapperCommand = path.resolve(installedWrapper);
  const sourcePath = path.resolve(sourceProject);
  const evidencePath = path.resolve(evidenceRoot);
  const runtimeSource = executeLive === true
    ? (connectFactory === connectInstalledWrapperD3ProjectSwitching ? "installed_wrapper" : "injected_live_connector")
    : "fake_transport";
  const journal = await createEvidenceJournal({
    evidenceRoot: evidencePath,
    provenance: {
      canary_contract: CONTRACT,
      runtime_source: runtimeSource,
      runtime_command: runtimeSource === "installed_wrapper" ? wrapperCommand : null,
      configured_wrapper_command: wrapperCommand,
      transport: runtimeSource,
      auto_promote_proof: false,
    },
  });

  let clientA = null;
  let clientB = null;
  const callLog = [];
  const budget = {
    max_response_bytes: maxResponseBytes,
    max_items: 25,
    max_inline_value_bytes: 256,
  };
  const report = {
    contract: CONTRACT,
    ok: true,
    status: executeLive ? "live" : "fake",
    runtime: {
      source: runtimeSource,
      command: runtimeSource === "installed_wrapper" ? wrapperCommand : null,
      configured_wrapper_command: wrapperCommand,
      dual_clients: true,
      source_runtime_fallback: false,
    },
    evidence: journal.paths,
    source_project: sourcePath,
    budget,
    steps: [],
    call_sequence: [],
    source_media_deleted: false,
    rendered_outputs: [],
    project_before_hash: null,
    project_after_hash: null,
    source_project_hash_unchanged: null,
    created_project_files: [],
    remaining_clean_test_tabs: [],
    remaining_tabs: [],
    mutation_sequence_stopped_after: null,
    first_mutation_failure: null,
    recovery_posture: {
      source_project_restored_active: false,
      source_active: null,
      source_hash: null,
      source_hash_unchanged: null,
      recovery_attempted: false,
      recovery_allowed: false,
      recovery_result: null,
      recovery_error_code: null,
      remaining_tabs: [],
      rendered_outputs: [],
      clients_closed: false,
      backup_posture: "evidence_local_copies_only",
      zero_renders: true,
      zero_source_media_deletion: true,
      no_timeout_mutation_replay: true,
    },
  };

  const MUTATING_OPS = new Set(["create_project_tab", "open_project_in_tab", "activate_project_tab"]);
  let mutationSequenceStopped = false;
  let clientsClosed = false;
  let shouldFinalize = false;
  let result = report;

  try {
    report.project_before_hash = await sha256File(sourcePath);

    const projectsDir = path.join(evidencePath, "projects");
    await mkdir(projectsDir, { recursive: true });
    const openTarget = path.join(projectsDir, "open-existing.RPP");
    const createTarget = path.join(projectsDir, "created-named.RPP");
    await copyFile(sourcePath, openTarget);
    report.created_project_files.push(openTarget);

    const callA = executeLive === true
      ? createClientCallTemplate((clientA = await connectFactory({
        installedWrapper: wrapperCommand,
        liveEnvironment,
        clientName: "d3-a",
      })), "A", callLog)
      : wrapCallTemplate(callTemplate, "A", callLog);
    const callB = executeLive === true
      ? createClientCallTemplate((clientB = await connectFactory({
        installedWrapper: wrapperCommand,
        liveEnvironment,
        clientName: "d3-b",
      })), "B", callLog)
      : wrapCallTemplate(typeof callTemplateB === "function" ? callTemplateB : callTemplate, "B", callLog);

    const recordMutationFailure = (step, response) => {
      const error = response?.error ?? null;
      const details = error?.details ?? {};
      report.first_mutation_failure = {
        step,
        ok: false,
        error_code: error?.code ?? null,
        message: error?.message ?? null,
        queue_state: details.queue_state ?? response?.queue?.state ?? null,
        outcome: details.outcome ?? null,
        recoverable: error?.recoverable ?? details.recoverable ?? null,
        partial_state: details.partial_state ?? null,
        reason: details.reason ?? null,
        timeout_ms: details.timeout_ms ?? null,
      };
      report.mutation_sequence_stopped_after = step;
      mutationSequenceStopped = true;
      report.steps.push({
        step,
        ok: false,
        error_code: report.first_mutation_failure.error_code,
        outcome: report.first_mutation_failure.outcome,
        partial_state: report.first_mutation_failure.partial_state,
        stopped_mutation_sequence: true,
      });
    };

    const listAllA = await listAllPages(callA, budget);
    report.steps.push({
      step: "list_open_projects_complete",
      ok: listAllA.ok === true,
      pages: listAllA.pages,
      total_count: listAllA.total_count,
    });
    if (listAllA.ok !== true) throw coded("D3_HARNESS_LIST_FAILED", "Initial complete open-project inventory failed.");

    const sourceRef = findSavedRef(listAllA.projects, sourcePath);
    if (typeof sourceRef !== "string") {
      throw coded("D3_HARNESS_SOURCE_REF_MISSING", "Could not resolve the source project ref from the initial inventory.");
    }

    const listB = await callB({
      id: MACRO_ID,
      input: { operation: "list_open_projects", cursor: "0", limit: 25 },
      budget,
    });
    report.steps.push({ step: "peer_list_open_projects", ok: listB?.ok === true });

    const created = await callA({
      id: MACRO_ID,
      input: {
        operation: "create_project_tab",
        name: "d3-evidence",
        target_path: createTarget,
        overwrite: true,
        copy_active_project_settings: false,
      },
      budget,
    });
    if (created?.ok !== true) {
      recordMutationFailure("create_project_tab", created);
    } else {
      report.steps.push({ step: "create_project_tab", ok: true, project_ref: created?.result?.data?.project_ref ?? null });
      report.created_project_files.push(createTarget);
    }

    if (!mutationSequenceStopped) {
      const peerSeesCreate = await callB({
        id: MACRO_ID,
        input: { operation: "list_open_projects", cursor: "0", limit: 25 },
        budget,
      });
      const peerCreateRows = peerSeesCreate?.result?.data?.projects ?? [];
      report.steps.push({
        step: "peer_sees_created_project",
        ok: peerSeesCreate?.ok === true && peerCreateRows.some((row) => (
          row.project_ref === `project:path:${createTarget}`
          && row.path === createTarget
          && row.active === true
        )),
      });

      const activateSource = await callA({
        id: MACRO_ID,
        input: { operation: "activate_project_tab", project_ref: sourceRef },
        budget,
      });
      if (activateSource?.ok !== true) {
        recordMutationFailure("activate_source_project", activateSource);
      } else {
        report.steps.push({ step: "activate_source_project", ok: true });
      }
    }

    if (!mutationSequenceStopped) {
      const opened = await callA({
        id: MACRO_ID,
        input: { operation: "open_project_in_tab", target_path: openTarget },
        budget,
      });
      if (opened?.ok !== true || opened?.result?.data?.project_ref !== `project:path:${openTarget}`) {
        recordMutationFailure("open_project_in_tab", opened);
      } else {
        report.steps.push({
          step: "open_project_in_tab",
          ok: true,
          project_ref: opened?.result?.data?.project_ref ?? null,
        });
      }
    }

    if (!mutationSequenceStopped) {
      const bothSeeOpen = await Promise.all([
        callA({ id: MACRO_ID, input: { operation: "list_open_projects", cursor: "0", limit: 25 }, budget }),
        callB({ id: MACRO_ID, input: { operation: "list_open_projects", cursor: "0", limit: 25 }, budget }),
      ]);
      report.steps.push({
        step: "dual_client_open_visibility",
        ok: bothSeeOpen.every((response) => response?.ok === true
          && (response?.result?.data?.projects ?? []).some((row) => (
            row.project_ref === `project:path:${openTarget}`
            && row.path === openTarget
            && row.active === true
          ))),
      });

      const createdRef = `project:path:${createTarget}`;
      const openRef = `project:path:${openTarget}`;
      const activateCreated = await callB({
        id: MACRO_ID,
        input: { operation: "activate_project_tab", project_ref: createdRef },
        budget,
      });
      if (activateCreated?.ok !== true) {
        recordMutationFailure("peer_stale_index_activate_created", activateCreated);
      } else {
        const activateOpen = await callA({
          id: MACRO_ID,
          input: { operation: "activate_project_tab", project_ref: openRef },
          budget,
        });
        if (activateOpen?.ok !== true) {
          recordMutationFailure("activate_open_project", activateOpen);
        } else {
          report.steps.push({
            step: "peer_stale_index_activate_among_saved_tabs",
            ok: activateCreated?.sqlite?.used === true,
          });
        }
      }
    }

    if (!mutationSequenceStopped) {
      const restore = await callA({
        id: MACRO_ID,
        input: { operation: "activate_project_tab", project_ref: sourceRef },
        budget,
      });
      if (restore?.ok !== true) {
        recordMutationFailure("restore_source_active", restore);
      } else {
        report.steps.push({ step: "restore_source_active", ok: true });
        report.recovery_posture.source_project_restored_active = true;
      }
    }

    // After any first mutation failure: only bounded read-only inventory, then
    // optional source restore via public native atom only when test tabs are clean.
    // Never auto-replay a timed-out or failed mutation.
    let finalInventory = await listAllPages(callA, budget);
    const projectRows = (finalInventory.projects ?? []).map((row) => ({
      project_ref: row.project_ref ?? null,
      path: row.path ?? null,
      active: row.active === true,
      saved: row.saved === true,
      dirty: typeof row.dirty === "boolean" ? row.dirty : null,
      path_state: row.path_state ?? null,
      raw_dirty_state: Number.isInteger(row.raw_dirty_state) ? row.raw_dirty_state : null,
    }));
    const updateInventoryReport = (inventory, rows) => {
      report.remaining_tabs = rows;
      report.remaining_clean_test_tabs = rows
      .filter((row) => row.project_ref === `project:path:${createTarget}` || row.project_ref === `project:path:${openTarget}`)
      .map((row) => ({
        project_ref: row.project_ref,
        path: row.path ?? null,
        dirty: row.dirty === true,
      }));
      report.recovery_posture.remaining_tabs = rows;
      report.recovery_posture.source_active = inventory.ok === true && rows.filter((row) => (
        row.project_ref === sourceRef
        && row.path === sourcePath
        && row.saved === true
        && row.path_state === "saved_project"
        && row.active === true
      )).length === 1;
    };
    let remainingTabs = projectRows;
    updateInventoryReport(finalInventory, remainingTabs);
    report.steps.push({
      step: "final_inventory",
      ok: finalInventory.ok === true,
      remaining_tabs: remainingTabs.length,
      remaining_clean_test_tabs: report.remaining_clean_test_tabs.length,
      read_only: true,
    });

    const sourceActive = finalInventory.ok === true && (finalInventory.projects ?? []).filter((row) => (
      row.project_ref === sourceRef
      && row.path === sourcePath
      && row.saved === true
      && row.path_state === "saved_project"
      && row.active === true
    )).length === 1;
    report.steps.push({ step: "source_active_readback", ok: sourceActive });
    report.recovery_posture.source_active = sourceActive;

    if (mutationSequenceStopped && !sourceActive) {
      const failedMutationCall = callLog.find((row) => MUTATING_OPS.has(row.normalized_operation) && row.ok === false) ?? null;
      const sameUnknownMutationReplay = report.first_mutation_failure?.outcome === "unknown"
        && failedMutationCall?.normalized_operation === "activate_project_tab"
        && failedMutationCall?.target_identity === sourceRef;
      const recoveryCheck = sameUnknownMutationReplay
        ? { allowed: false, reason: "same_unknown_mutation_replay_forbidden" }
        : validateRecoveryInventory(finalInventory, remainingTabs, sourceRef, sourcePath);
      report.recovery_posture.recovery_allowed = recoveryCheck.allowed;
      if (report.recovery_posture.recovery_allowed) {
        report.recovery_posture.recovery_attempted = true;
        const restoreAfterFail = await callA({
          id: ACTIVATE_TAB_ID,
          input: {},
          refs: [{
            kind: "project",
            ref: sourceRef,
            identity: { scheme: "path", value: sourcePath },
          }],
          budget,
        });
        report.recovery_posture.recovery_result = restoreAfterFail?.ok === true ? "pending_readback" : "failed";
        report.recovery_posture.recovery_error_code = restoreAfterFail?.ok === true
          ? null
          : (restoreAfterFail?.error?.code ?? "RESTORE_FAILED");
        report.steps.push({
          step: "bounded_recovery_restore_source",
          ok: restoreAfterFail?.ok === true,
          recovery_allowed: true,
          requested_id: ACTIVATE_TAB_ID,
          normalized_operation: "activate_project_tab",
          error_code: report.recovery_posture.recovery_error_code,
        });
        // Recovery is only truthful after a second complete read-only inventory.
        finalInventory = await listAllPages(callA, budget);
        remainingTabs = (finalInventory.projects ?? []).map((row) => ({
          project_ref: row.project_ref ?? null,
          path: row.path ?? null,
          active: row.active === true,
          saved: row.saved === true,
          dirty: typeof row.dirty === "boolean" ? row.dirty : null,
          path_state: row.path_state ?? null,
          raw_dirty_state: Number.isInteger(row.raw_dirty_state) ? row.raw_dirty_state : null,
        }));
        updateInventoryReport(finalInventory, remainingTabs);
        const restored = finalInventory.ok === true && remainingTabs.filter((row) => (
          row.project_ref === sourceRef
          && row.path === sourcePath
          && row.saved === true
          && row.path_state === "saved_project"
          && row.active === true
        )).length === 1;
        report.recovery_posture.source_project_restored_active = restored;
        report.recovery_posture.recovery_result = restored ? "restored" : "failed_readback";
        report.steps.push({
          step: "bounded_recovery_readback",
          ok: restored,
          read_only: true,
          source_active: restored,
          remaining_tabs: remainingTabs.length,
        });
      } else {
        report.recovery_posture.recovery_attempted = false;
        report.recovery_posture.recovery_result = recoveryCheck.reason === "same_unknown_mutation_replay_forbidden"
          ? "skipped_same_unknown_mutation_replay_forbidden"
          : "skipped_dirty_or_incomplete_inventory";
        report.steps.push({
          step: "bounded_recovery_restore_source",
          ok: false,
          recovery_allowed: false,
          reason: recoveryCheck.reason,
        });
      }
    }

    report.project_after_hash = await sha256File(sourcePath);
    report.source_project_hash_unchanged = report.project_after_hash === report.project_before_hash;
    report.recovery_posture.source_hash = report.project_after_hash;
    report.recovery_posture.source_hash_unchanged = report.source_project_hash_unchanged;
    report.steps.push({ step: "source_project_hash_unchanged", ok: report.source_project_hash_unchanged });
    report.call_sequence = callLog.map((entry) => ({
      client: entry.client,
      requested_id: entry.requested_id,
      normalized_operation: entry.normalized_operation,
      operation: entry.operation,
      target_identity: entry.target_identity,
      ok: entry.ok,
    }));
    const stopIndex = callLog.findIndex((row) => MUTATING_OPS.has(row.normalized_operation) && row.ok === false);
    const postStopMutations = stopIndex < 0 ? [] : callLog.slice(stopIndex + 1).filter((entry) => MUTATING_OPS.has(entry.normalized_operation));
    const failedMutation = stopIndex < 0 ? null : callLog[stopIndex];
    const replayedFailedMutation = failedMutation !== null && postStopMutations.some((entry) => (
      entry.normalized_operation === failedMutation.normalized_operation
      && entry.target_identity === failedMutation.target_identity
    ));
    const unexpectedPostStop = postStopMutations.filter((entry, index) => (
      index > 0
      || entry.requested_id !== ACTIVATE_TAB_ID
      || entry.normalized_operation !== "activate_project_tab"
      || entry.target_identity !== sourceRef
      || report.recovery_posture.recovery_attempted !== true
    ));
    report.recovery_posture.no_timeout_mutation_replay = !replayedFailedMutation;
    report.ok = report.steps.every((step) => step.ok === true)
      && report.source_media_deleted === false
      && report.rendered_outputs.length === 0
      && report.source_project_hash_unchanged === true
      && report.runtime.source_runtime_fallback === false
      && !mutationSequenceStopped
      && unexpectedPostStop.length === 0
      && report.recovery_posture.no_timeout_mutation_replay === true;
    report.recovery_posture.created_project_files = [...report.created_project_files];
    report.recovery_posture.remaining_clean_test_tabs = report.remaining_clean_test_tabs;
    report.recovery_posture.remaining_tabs = remainingTabs;
    report.recovery_posture.rendered_outputs = [...report.rendered_outputs];
    report.recovery_posture.zero_renders = report.rendered_outputs.length === 0;
    report.observed_at = (now() instanceof Date ? now() : new Date(now())).toISOString();

    shouldFinalize = true;
    result = report;
  } finally {
    await closeQuietly(clientA);
    await closeQuietly(clientB);
    clientsClosed = true;
    report.recovery_posture.clients_closed = clientsClosed;
    if (shouldFinalize && typeof journal.finalize === "function") {
      await journal.finalize(report);
    }
  }
  return result;
}

async function listAllPages(callTemplate, budget) {
  const projects = [];
  let cursor = "0";
  let pages = 0;
  let totalCount = null;
  const seen = new Set();
  while (pages < 64) {
    if (seen.has(String(cursor))) {
      return { ok: false, projects, pages, total_count: totalCount, error: "cursor_stalled" };
    }
    seen.add(String(cursor));
    pages += 1;
    const response = await callTemplate({
      id: MACRO_ID,
      input: { operation: "list_open_projects", cursor, limit: 25 },
      budget,
    });
    if (response?.ok !== true) {
      return { ok: false, projects, pages, total_count: totalCount, error: response?.error?.code ?? "list_failed" };
    }
    const data = response.result?.data ?? {};
    if (totalCount === null) totalCount = data.total_count ?? null;
    if (data.total_count !== totalCount) {
      return { ok: false, projects, pages, total_count: totalCount, error: "total_count_changed" };
    }
    const rows = data.projects ?? [];
    if (data.returned_count !== rows.length) {
      return { ok: false, projects, pages, total_count: totalCount, error: "returned_count_mismatch" };
    }
    for (const row of rows) projects.push(row);
    if (data.coverage_status === "complete" && data.next_cursor == null) {
      return { ok: true, projects, pages, total_count: totalCount };
    }
    if (data.coverage_status !== "paged" || data.next_cursor == null) {
      return { ok: false, projects, pages, total_count: totalCount, error: "coverage_cursor_mismatch" };
    }
    if ((data.returned_count ?? 0) === 0) {
      return { ok: false, projects, pages, total_count: totalCount, error: "zero_row_page" };
    }
    cursor = data.next_cursor;
  }
  return { ok: false, projects, pages, total_count: totalCount, error: "page_ceiling" };
}

function findSavedRef(projects, absolutePath) {
  const matches = (projects ?? []).filter((row) => (
    row.path === absolutePath
    && row.project_ref === `project:path:${absolutePath}`
    && row.saved === true
    && row.path_state === "saved_project"
  ));
  return matches.length === 1 ? matches[0].project_ref : null;
}

function validateRecoveryInventory(inventory, rows, sourceRef, sourcePath) {
  if (inventory?.ok !== true || inventory.total_count !== rows.length || rows.length === 0) {
    return { allowed: false, reason: "inventory_incomplete" };
  }
  const sourceIdentityRows = rows.filter((row) => row.project_ref === sourceRef || row.path === sourcePath);
  const sourceRows = sourceIdentityRows.filter((row) => (
    row.project_ref === sourceRef
    && row.path === sourcePath
    && row.saved === true
    && row.path_state === "saved_project"
  ));
  if (sourceIdentityRows.length !== 1 || sourceRows.length !== 1 || sourceRows[0].active === true) {
    return { allowed: false, reason: "source_identity_or_active_mismatch" };
  }
  const activeRows = rows.filter((row) => row.active === true);
  if (activeRows.length !== 1) return { allowed: false, reason: "active_identity_ambiguous" };
  const nonSourceRows = rows.filter((row) => row.project_ref !== sourceRef);
  if (nonSourceRows.length === 0) return { allowed: false, reason: "no_non_source_test_tab" };
  if (nonSourceRows.some((row) => row.dirty !== false || row.raw_dirty_state !== 0)) {
    return { allowed: false, reason: "dirty_or_missing_test_tab_state" };
  }
  return { allowed: true, reason: null };
}

function wrapCallTemplate(callTemplate, clientName, callLog) {
  return async (request) => {
    const response = await callTemplate(request);
    const normalizedOperation = normalizeOperation(request?.id, request?.input);
    callLog.push({
      client: clientName,
      requested_id: request?.id ?? null,
      operation: request?.input?.operation ?? null,
      normalized_operation: normalizedOperation,
      target_identity: requestTargetIdentity(request),
      ok: response?.ok === true,
    });
    return response;
  };
}

function createClientCallTemplate(client, clientName, callLog) {
  return async ({ id, input = {}, refs = {}, budget = PUBLIC_BUDGET }) => {
    const response = await client.callTool({
      name: "call_template",
      arguments: { id, input, refs, budget },
    });
    const parsed = response?.structuredContent
      ?? (response?.content?.find?.((entry) => entry.type === "text")?.text
        ? JSON.parse(response.content.find((entry) => entry.type === "text").text)
        : response);
    callLog.push({
      client: clientName,
      requested_id: id ?? null,
      operation: input?.operation ?? null,
      normalized_operation: normalizeOperation(id, input),
      target_identity: requestTargetIdentity({ id, input, refs }),
      ok: parsed?.ok === true,
    });
    return parsed;
  };
}

function normalizeOperation(requestedId, input = {}) {
  if (typeof input.operation === "string" && input.operation.length > 0) return input.operation;
  if (requestedId === ACTIVATE_TAB_ID) return "activate_project_tab";
  return requestedId ?? null;
}

function requestTargetIdentity(request = {}) {
  const input = request.input ?? {};
  if (typeof input.project_ref === "string") return input.project_ref;
  if (typeof input.target_path === "string") return `project:path:${input.target_path}`;
  const projectRef = Array.isArray(request.refs)
    ? request.refs.find((ref) => ref?.kind === "project")?.ref
    : null;
  return typeof projectRef === "string" ? projectRef : null;
}

async function closeQuietly(client) {
  if (!client) return;
  try {
    await client.close();
  } catch {
    // always attempt both clients
  }
}

async function sha256File(filePath) {
  const bytes = await readFile(filePath);
  return createHash("sha256").update(bytes).digest("hex");
}

function assertAbsolute(value, name) {
  if (typeof value !== "string" || !path.isAbsolute(value)) {
    throw coded("D3_HARNESS_PATH_REQUIRED", `${name} must be an absolute path.`);
  }
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  console.error("Control-tower live runner only. Import runAlpha34D3ProjectSwitchingHarness from tests or CT scripts.");
  process.exit(2);
}
