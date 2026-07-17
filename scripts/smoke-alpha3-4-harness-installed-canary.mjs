#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { createEvidenceJournal, serializeError } from "./lib/alpha3-4-harness-evidence-v1.mjs";
import {
  OPENREAPER_FLAT_FIFTEEN_MACRO_IDS,
} from "../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";

export const INSTALLED_CANARY_BUDGET = Object.freeze({
  max_response_bytes: 4_096,
  max_items: 50,
  max_inline_value_bytes: 2_048,
});

export const INSTALLED_CANARY_REQUIRED_MACROS = OPENREAPER_FLAT_FIFTEEN_MACRO_IDS;

export async function connectInstalledWrapperCanary({ installedWrapper }) {
  assertAbsolute(installedWrapper, "installedWrapper");
  const client = new Client({ name: "openreaper-alpha34-installed-canary", version: "1.0.0" });
  await client.connect(new StdioClientTransport({
    command: installedWrapper,
    args: [],
    cwd: path.dirname(installedWrapper),
    env: process.env,
  }));
  return client;
}

export function captureInstalledCanaryInstructions(client) {
  if (!client || typeof client.getInstructions !== "function") {
    throw canaryError("CANARY_INSTRUCTIONS_API_MISSING", "MCP client must expose getInstructions().");
  }
  const instructions = client.getInstructions();
  if (typeof instructions !== "string" || instructions.trim() === "") {
    throw canaryError("CANARY_INSTRUCTIONS_MISSING", "Installed wrapper did not publish MCP initialization instructions.");
  }
  const utf8Bytes = Buffer.byteLength(instructions, "utf8");
  if (utf8Bytes > 16_384) {
    throw canaryError("CANARY_INSTRUCTIONS_BUDGET_EXCEEDED", "Initialization instructions exceed the 16 KiB UTF-8 budget.", {
      utf8_bytes: utf8Bytes,
      max_utf8_bytes: 16_384,
    });
  }
  for (const macroId of INSTALLED_CANARY_REQUIRED_MACROS) {
    if (!instructions.includes(macroId)) {
      throw canaryError("CANARY_INSTRUCTIONS_MACRO_MISSING", `Initialization instructions omit Macro ${macroId}.`, { macro_id: macroId });
    }
  }
  for (const phrase of [
    "ping",
    "list_templates",
    "call_template",
    "exact-id",
    "live",
    "Macro-first",
    "cursor",
    "get_state",
    "openreaper-start",
  ]) {
    if (!instructions.includes(phrase)) {
      throw canaryError("CANARY_INSTRUCTIONS_FLOW_MISSING", `Initialization instructions omit required phrase: ${phrase}.`, { phrase });
    }
  }
  return {
    instructions,
    utf8_bytes: utf8Bytes,
    max_utf8_bytes: 16_384,
    macro_ids: [...INSTALLED_CANARY_REQUIRED_MACROS],
  };
}

export async function runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory = connectInstalledWrapperCanary, evidenceSink = null } = {}) {
  assertAbsolute(installedWrapper, "installedWrapper");
  assertAbsolute(sourceProject, "sourceProject");
  assertAbsolute(evidenceRoot, "evidenceRoot");
  const wrapperPath = path.resolve(installedWrapper);
  const projectPath = path.resolve(sourceProject);
  const journalRoot = path.resolve(evidenceRoot);
  if (path.extname(projectPath).toLowerCase() !== ".rpp") throw canaryError("CANARY_SOURCE_PROJECT_INVALID", "sourceProject must be an absolute .RPP path.");
  const journal = evidenceSink ?? await createEvidenceJournal({
    evidenceRoot: journalRoot,
    provenance: {
      canary_contract: "openreaper.alpha3.4.installed_wrapper_read_canary.v1",
      transport: "installed_wrapper_only",
      source_project: path.basename(projectPath),
    },
  });
  const report = {
    contract: "openreaper.alpha3.4.installed_wrapper_read_canary.v1",
    type: "alpha3.4_installed_wrapper_read_canary",
    ok: false,
    status: "running",
    provenance: {
      transport: "installed_wrapper_only",
      installed_wrapper: wrapperPath,
      installed_wrapper_sha256: null,
      package_provenance: null,
    },
    source_project: projectPath,
    source_hashes: { before: null, after: null },
    calls: [],
    client_close: { attempted: false, ok: null, error: null },
    project_changes: [],
    rendered_outputs: [],
    recovery_posture: { source_project_unchanged: null, project_changes: [], rendered_outputs: [] },
    duration_ms: 0,
    evidence: null,
    error: null,
  };
  const started = performance.now();
  let client = null;
  try {
    report.provenance.installed_wrapper_sha256 = await sha256(wrapperPath);
    report.provenance.package_provenance = await loadInstalledProvenance(wrapperPath);
    journal.setProvenance?.({ package_provenance: report.provenance.package_provenance });
    report.source_hashes.before = await sha256(projectPath);
    client = await connectFactory({ installedWrapper: wrapperPath, sourceProject: projectPath, clientName: "canary" });
    report.initialization_instructions = captureInstalledCanaryInstructions(client);
    journal.setProvenance?.({
      initialization_instructions: {
        utf8_bytes: report.initialization_instructions.utf8_bytes,
        max_utf8_bytes: report.initialization_instructions.max_utf8_bytes,
        macro_count: report.initialization_instructions.macro_ids.length,
      },
    });
    const ping = await canaryCall({ journal, client, step: "installed-wrapper-ping", tool: "ping", args: {}, report });
    assertCanary(ping?.ok === true, "CANARY_PING_NOT_OK", { response: ping });
    assertCanary(
      ping?.product === "OpenReaper" && ping?.kernel === "openreaper-mcp alpha kernel",
      "CANARY_RUNTIME_IDENTITY_MISMATCH",
      { product: ping?.product ?? null, kernel: ping?.kernel ?? null },
    );
    assertCanary(
      typeof ping?.version === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(ping.version),
      "CANARY_RUNTIME_VERSION_INVALID",
      { runtime_version: ping?.version ?? null },
    );
    report.provenance.runtime_ping = { product: ping.product, kernel: ping.kernel, version: ping.version };
    journal.setProvenance?.({ runtime_ping: report.provenance.runtime_ping });
    const read = await canaryCall({
      journal,
      client,
      step: "read-project-summary",
      tool: "call_template",
      args: { id: "template.project.read_summary", input: { include_counts: true }, budget: INSTALLED_CANARY_BUDGET },
      report,
    });
    assertCanary(read?.ok === true, "CANARY_READ_NOT_OK", { response: read });
    const currentPath = read?.result?.summary?.path ?? read?.result?.data?.path ?? read?.summary?.path ?? read?.data?.path ?? null;
    assertCanary(typeof currentPath === "string" && path.isAbsolute(currentPath) && path.resolve(currentPath) === projectPath, "CANARY_PROJECT_PATH_MISMATCH", { expected: projectPath, observed: currentPath });
    const observedChanges = read?.result?.changes ?? [];
    assertCanary(Array.isArray(observedChanges) && observedChanges.length === 0, "CANARY_READ_REPORTED_MUTATION", { observed_changes: observedChanges });
    assertCanary(report.calls.length === 2, "CANARY_TOOL_CALL_COUNT_INVALID", { call_count: report.calls.length });
    report.status = "passed";
    report.ok = true;
  } catch (error) {
    report.status = "failed";
    report.error = serializeError(error);
  } finally {
    report.client_close.attempted = Boolean(client);
    if (client) {
      try {
        await client.close();
        report.client_close.ok = true;
      } catch (error) {
        report.client_close.ok = false;
        report.client_close.error = serializeError(error);
        report.ok = false;
        report.status = "failed";
        report.error ??= report.client_close.error;
      }
    }
    report.source_hashes.after = await sha256(projectPath).catch(() => null);
    report.recovery_posture.source_project_unchanged = Boolean(report.source_hashes.before && report.source_hashes.before === report.source_hashes.after);
    if (report.ok && !report.recovery_posture.source_project_unchanged) {
      report.ok = false;
      report.status = "failed";
      report.error = serializeError(canaryError("CANARY_SOURCE_PROJECT_CHANGED", "The read-only canary did not preserve the source project hash.", report.source_hashes));
    }
    report.duration_ms = Math.round(performance.now() - started);
    report.evidence = journal.paths;
    try {
      await journal.finalize(report);
    } catch (error) {
      report.ok = false;
      report.status = "failed";
      report.error ??= serializeError(error);
      report.evidence_error = serializeError(error);
    }
  }
  return report;
}

async function canaryCall({ journal, client, step, tool, args, report }) {
  const started = performance.now();
  let wireResponse = null;
  let value = null;
  let error = null;
  let responseBytes = 0;
  try {
    wireResponse = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: 30_000, maxTotalTimeout: 30_000 });
    const text = wireResponse?.content?.find((entry) => entry.type === "text")?.text;
    if (typeof text !== "string") throw canaryError("CANARY_MALFORMED_MCP_RESPONSE", "Installed wrapper returned no JSON text.");
    responseBytes = Buffer.byteLength(text, "utf8");
    value = JSON.parse(text);
  } catch (candidate) {
    error = candidate;
  } finally {
    const call = {
      scenario: "installed-wrapper-canary",
      step_id: step,
      client: "canary",
      tool,
      requested_id: args.id ?? null,
      request: args,
      response: wireResponse ?? { error: serializeError(error) },
      value,
      ok: value?.ok === true,
      expected_failure: false,
      error: error ? serializeError(error) : value?.ok === false ? value.error ?? { code: "CANARY_CALL_NOT_OK" } : null,
      duration_ms: Math.round(performance.now() - started),
      response_bytes: responseBytes,
      request_budget: args.budget ?? null,
      truncated: value?.truncated ?? value?.result?.summary?.truncated ?? null,
      artifact_fallback: null,
    };
    report.calls.push({ step, tool, requested_id: args.id ?? null, ok: call.ok, status: call.ok ? "success" : "failure", response_bytes: responseBytes });
    await journal.recordCall(call);
  }
  if (error) throw error;
  return value;
}

function assertAbsolute(value, field) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw canaryError("CANARY_PATH_INVALID", `${field} must be absolute.`, { field });
}

function assertCanary(condition, code, details) {
  if (!condition) throw canaryError(code, code, details);
}

function canaryError(code, message, details = null) {
  return Object.assign(new Error(message), { name: "InstalledCanaryError", code, details });
}

function compactProvenance(value) {
  if (!value || typeof value !== "object") return value ?? null;
  return Object.fromEntries(Object.entries(value).slice(0, 12).map(([key, entry]) => [String(key).slice(0, 64), typeof entry === "string" ? entry.slice(0, 512) : entry]));
}

async function loadInstalledProvenance(wrapperPath) {
  const binDirectory = path.dirname(wrapperPath);
  assertCanary(path.basename(binDirectory) === "bin", "CANARY_INSTALLED_WRAPPER_LAYOUT_INVALID", { installed_wrapper: wrapperPath });
  const provenancePath = path.join(path.dirname(binDirectory), "provenance.json");
  let bytes;
  let value;
  try {
    bytes = await readFile(provenancePath);
    value = JSON.parse(bytes.toString("utf8"));
  } catch (error) {
    throw canaryError("CANARY_PACKAGE_PROVENANCE_UNREADABLE", "Installed package provenance is missing or invalid.", {
      provenance_path: provenancePath,
      cause: serializeError(error),
    });
  }
  assertCanary(value?.contract === "openreaper.package.provenance.v1", "CANARY_PACKAGE_PROVENANCE_INVALID", { field: "contract", observed: value?.contract ?? null });
  assertCanary(value?.source_tree_clean === true, "CANARY_PACKAGE_PROVENANCE_INVALID", { field: "source_tree_clean", observed: value?.source_tree_clean ?? null });
  assertCanary(typeof value?.package_version === "string" && value.package_version.length > 0, "CANARY_PACKAGE_PROVENANCE_INVALID", { field: "package_version" });
  assertCanary(/^[0-9a-f]{40}$/u.test(value?.openreaper_git_commit ?? ""), "CANARY_PACKAGE_PROVENANCE_INVALID", { field: "openreaper_git_commit", observed: value?.openreaper_git_commit ?? null });
  return compactProvenance({
    provenance_path: provenancePath,
    provenance_sha256: createHash("sha256").update(bytes).digest("hex"),
    contract: value.contract,
    product: value.product ?? null,
    package_version: value.package_version,
    build_id: value.build_id ?? null,
    openreaper_git_commit: value.openreaper_git_commit,
    build_time_utc: value.build_time_utc ?? null,
    source_tree_clean: value.source_tree_clean,
  });
}

async function sha256(file) {
  return createHash("sha256").update(await readFile(file)).digest("hex");
}

function parseArgs(args) {
  const result = { installedWrapper: null, sourceProject: null, evidenceRoot: null, fullReport: false };
  const names = new Map([["--installed-wrapper", "installedWrapper"], ["--source-project", "sourceProject"], ["--evidence-root", "evidenceRoot"]]);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--full-report") { result.fullReport = true; continue; }
    const key = names.get(argument);
    if (!key) throw canaryError("CANARY_ARGUMENT_UNKNOWN", "Unknown canary option.", { option: argument });
    if (result[key]) throw canaryError("CANARY_ARGUMENT_DUPLICATE", "Canary option was supplied more than once.", { option: argument });
    const value = args[++index];
    if (!value || value.startsWith("--")) throw canaryError("CANARY_ARGUMENT_VALUE_MISSING", "Canary option requires a value.", { option: argument });
    result[key] = value;
  }
  for (const [key, label] of [["installedWrapper", "--installed-wrapper"], ["sourceProject", "--source-project"], ["evidenceRoot", "--evidence-root"]]) if (!result[key]) throw canaryError("CANARY_ARGUMENT_REQUIRED", `${label} is required.`);
  return result;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const report = await runInstalledWrapperCanary(options);
    process.stdout.write(`${JSON.stringify(options.fullReport ? report : compactEnvelope(report))}\n`);
    if (!report.ok) process.exitCode = 1;
  } catch (error) {
    process.stdout.write(`${JSON.stringify(compactEnvelope({ ok: false, status: "cli_invalid", error: serializeError(error), evidence: null }))}\n`);
    process.exitCode = 2;
  }
}

function compactEnvelope(report) {
  return {
    contract: "openreaper.alpha3.4.installed_wrapper_read_canary.v1",
    type: "alpha3.4_installed_wrapper_read_canary",
    ok: report.ok === true,
    status: report.status ?? "failed",
    summary_path: report.evidence?.summary_path ?? null,
    events_path: report.evidence?.events_path ?? null,
    error: report.error ?? null,
    recovery_posture: report.recovery_posture ?? null,
  };
}
