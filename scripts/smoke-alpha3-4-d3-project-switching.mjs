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
    recovery_posture: {
      source_project_restored_active: false,
      backup_posture: "evidence_local_copies_only",
      zero_renders: true,
      zero_source_media_deletion: true,
    },
  };

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

    const listAllA = await listAllPages(callA, budget);
    report.steps.push({
      step: "list_open_projects_complete",
      ok: listAllA.ok === true,
      pages: listAllA.pages,
      total_count: listAllA.total_count,
    });
    if (listAllA.ok !== true) throw coded("D3_HARNESS_LIST_FAILED", "Initial complete open-project inventory failed.");

    const sourceRef = findSavedRef(listAllA.projects, sourcePath)
      ?? listAllA.projects.find((row) => row.active === true)?.project_ref
      ?? null;
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
    report.steps.push({ step: "create_project_tab", ok: created?.ok === true, project_ref: created?.result?.data?.project_ref ?? null });
    if (created?.ok === true) report.created_project_files.push(createTarget);

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
    report.steps.push({ step: "activate_source_project", ok: activateSource?.ok === true });

    const opened = await callA({
      id: MACRO_ID,
      input: { operation: "open_project_in_tab", target_path: openTarget },
      budget,
    });
    report.steps.push({
      step: "open_project_in_tab",
      ok: opened?.ok === true && opened?.result?.data?.project_ref === `project:path:${openTarget}`,
    });

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
    const activateOpen = await callA({
      id: MACRO_ID,
      input: { operation: "activate_project_tab", project_ref: openRef },
      budget,
    });
    report.steps.push({
      step: "peer_stale_index_activate_among_saved_tabs",
      ok: activateCreated?.ok === true
        && activateCreated?.sqlite?.used === true
        && activateOpen?.ok === true,
    });

    const restore = await callA({
      id: MACRO_ID,
      input: { operation: "activate_project_tab", project_ref: sourceRef },
      budget,
    });
    report.steps.push({ step: "restore_source_active", ok: restore?.ok === true });
    report.recovery_posture.source_project_restored_active = restore?.ok === true;

    const finalInventory = await listAllPages(callA, budget);
    report.remaining_clean_test_tabs = (finalInventory.projects ?? [])
      .filter((row) => row.project_ref === createdRef || row.project_ref === openRef)
      .map((row) => ({
        project_ref: row.project_ref,
        path: row.path ?? null,
        dirty: row.dirty === true,
      }));
    report.steps.push({
      step: "final_inventory",
      ok: finalInventory.ok === true,
      remaining_clean_test_tabs: report.remaining_clean_test_tabs.length,
    });
    report.steps.push({
      step: "source_active_readback",
      ok: finalInventory.ok === true && (finalInventory.projects ?? []).some((row) => (
        row.project_ref === sourceRef
        && row.path === sourcePath
        && row.active === true
      )),
    });

    report.project_after_hash = await sha256File(sourcePath);
    report.source_project_hash_unchanged = report.project_after_hash === report.project_before_hash;
    report.steps.push({ step: "source_project_hash_unchanged", ok: report.source_project_hash_unchanged });
    report.call_sequence = callLog.map((entry) => ({
      client: entry.client,
      operation: entry.operation,
      ok: entry.ok,
    }));
    report.ok = report.steps.every((step) => step.ok === true)
      && report.source_media_deleted === false
      && report.rendered_outputs.length === 0
      && report.source_project_hash_unchanged === true
      && report.runtime.source_runtime_fallback === false;
    report.recovery_posture.created_project_files = [...report.created_project_files];
    report.recovery_posture.remaining_clean_test_tabs = report.remaining_clean_test_tabs;
    report.observed_at = (now() instanceof Date ? now() : new Date(now())).toISOString();

    if (typeof journal.finalize === "function") {
      await journal.finalize(report);
    }
    return report;
  } finally {
    await closeQuietly(clientA);
    await closeQuietly(clientB);
  }
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
  const exact = (projects ?? []).find((row) => row.path === absolutePath || row.project_ref === `project:path:${absolutePath}`);
  return exact?.project_ref ?? null;
}

function wrapCallTemplate(callTemplate, clientName, callLog) {
  return async (request) => {
    const response = await callTemplate(request);
    callLog.push({
      client: clientName,
      operation: request?.input?.operation ?? null,
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
      operation: input?.operation ?? null,
      ok: parsed?.ok === true,
    });
    return parsed;
  };
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
