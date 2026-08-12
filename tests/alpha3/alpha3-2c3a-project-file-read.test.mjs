import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { chmod, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const STDIO_SERVER = "packages/mcp-server/src/openreaper-mcp-stdio.mjs";
const REPO_BRIDGE_SCRIPT_PATH = path.resolve("reaper/bridge/openreaper-live-bridge.lua");
const IDS = [
  "template.project.read_current_project_path",
  "template.project.read_dirty_state",
];
const EXACT_TOOLS = ["call_recipe", "call_template", "get_state", "list_recipes", "list_templates", "ping"];
let sequence = 0;

function operationAwareSummary(operationName) {
  if (operationName === "project.read_current_project_path") {
    return {
      project_ref: "project:current",
      name: "Actual Stdio Fixture.RPP",
      path: "/tmp/Actual Stdio Fixture.RPP",
      has_project_path: true,
      path_state: "saved_project",
      path_truncated: false,
    };
  }
  if (operationName === "project.read_dirty_state") {
    return {
      project_ref: "project:current",
      dirty: true,
      dirty_state: "dirty",
      raw_dirty_state: 3,
    };
  }
  return null;
}

function context() {
  sequence += 1;
  return {
    client_id: "alpha32-c3a-test",
    session_id: "alpha32-c3a-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-11T08:00:00.000Z",
    request_sequence: sequence,
  };
}

class ScriptedProjectReadBridge {
  constructor(outcome) {
    this.fake = new FakeFoundationBridge();
    this.outcome = outcome;
  }

  dispatch(request) {
    if (this.outcome.error) {
      return this.fake.errorEnvelope(request, "INTERNAL_ERROR", this.outcome.error.message, {
        recoverable: true,
        details: this.outcome.error.details,
      });
    }
    const result = structuredClone(this.fake.dispatch(request));
    result.result.summary = structuredClone(this.outcome.summary);
    return result;
  }
}

class OperationAwareProjectReadBridge {
  constructor({ owner, generation }) {
    this.fake = new FakeFoundationBridge({ owner, generation });
  }

  dispatch(request) {
    const result = this.fake.dispatch(request);
    const summary = operationAwareSummary(request?.operation?.name);
    if (!summary || result?.ok !== true) return result;
    const scripted = structuredClone(result);
    scripted.result.summary = summary;
    return scripted;
  }
}

async function callWithOutcome(id, outcome) {
  const runtime = createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor: new ScriptedProjectReadBridge(outcome),
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
    },
  });
  return runtime.call_template({ id, input: {}, context: context() });
}

function parseToolJson(response) {
  const text = response.content?.find((entry) => entry.type === "text")?.text;
  assert.equal(typeof text, "string");
  return JSON.parse(text);
}

async function respondToNextBridgeRequest(transportDir, bridge) {
  const requestsDir = path.join(transportDir, "requests");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const files = (await readdir(requestsDir)).filter((file) => file.endsWith(".json"));
    if (files.length > 0) {
      const file = files[0];
      let request;
      try {
        request = JSON.parse(await readFile(path.join(requestsDir, file), "utf8"));
      } catch (error) {
        if (error instanceof SyntaxError) {
          await new Promise((resolve) => setTimeout(resolve, 5));
          continue;
        }
        throw error;
      }
      const result = bridge.dispatch(request);
      await writeFile(path.join(transportDir, "results", file), `${JSON.stringify(result)}\n`, "utf8");
      return request;
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for C3A stdio bridge request");
}

async function runDedicatedRunnerFixture({ unknownResidue = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "openreaper-c3a-runner-success-"));
  const expectedProject = path.join(root, "Expected.RPP");
  const transportDir = path.join(root, "transport");
  const evidenceRoot = path.join(root, "evidence");
  const bridgeScript = path.join(root, "openreaper-live-bridge.lua");
  const mcpCommand = path.join(root, "openreaper-mcp");
  await writeFile(expectedProject, "<REAPER_PROJECT 0.1\n  RIPPLE 0\n>\n", "utf8");
  await mkdir(path.join(transportDir, "requests"), { recursive: true });
  await mkdir(path.join(transportDir, "results"), { recursive: true });
  await writeFile(
    path.join(transportDir, "openreaper-bridge-liveness-v1.json"),
    `${JSON.stringify({
      contract: "openreaper.bridge_liveness.v1",
      active_owner: "openreaper-c3a-runner-test",
      active_generation: 7,
      sequence: 1,
      refreshed_at_unix_s: Math.floor(Date.now() / 1000),
      interval_ms: 500,
    })}\n`,
    "utf8",
  );
  await writeFile(bridgeScript, "-- C3A runner test bridge fixture\n", "utf8");
  await writeFile(
    mcpCommand,
    `#!/bin/zsh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(path.resolve(STDIO_SERVER))}\n`,
    "utf8",
  );
  await chmod(mcpCommand, 0o755);
  const beforeBytes = await readFile(expectedProject);
  const beforeStat = await stat(expectedProject, { bigint: true });
  const owner = "openreaper-c3a-runner-test";
  const generation = 7;
  const env = {
    ...process.env,
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScript,
    OPENREAPER_LIVE_BRIDGE_OWNER: owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(generation),
  };
  const child = spawn(process.execPath, [
    "scripts/smoke-alpha3-2c3a-project-file-read.mjs",
    "--mcp-command", mcpCommand,
    "--evidence-root", evidenceRoot,
    "--expected-project-path", expectedProject,
  ], { cwd: process.cwd(), env, stdio: ["ignore", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });

  const bridge = {
    fake: new FakeFoundationBridge({ owner, generation }),
    dispatch(request) {
      const result = this.fake.dispatch(request);
      if (result.ok !== true) return result;
      const scripted = structuredClone(result);
      if (request.operation.name === "project.read_current_project_path") {
        scripted.result.summary = {
          project_ref: "project:current",
          name: path.basename(expectedProject),
          path: expectedProject,
          has_project_path: true,
          path_state: "saved_project",
          path_truncated: false,
        };
      } else if (request.operation.name === "project.read_dirty_state") {
        scripted.result.summary = {
          project_ref: "project:current",
          dirty: false,
          dirty_state: "clean",
          raw_dirty_state: 0,
        };
      }
      return scripted;
    },
  };

  const responder = respondToRunnerBridgeRequests({ transportDir, bridge, unknownResidue });
  const exitPromise = new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Dedicated C3A runner fixture timed out"));
    }, 15_000);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
  });
  const [exit] = await Promise.all([exitPromise, responder]);
  const report = JSON.parse(await readFile(path.join(evidenceRoot, "alpha3-2c3a-project-file-read.json"), "utf8"));
  const afterBytes = await readFile(expectedProject);
  const afterStat = await stat(expectedProject, { bigint: true });
  return {
    root,
    expectedProject,
    transportDir,
    evidenceRoot,
    exit,
    stdout,
    stderr,
    report,
    projectIntegrity: {
      before_sha256: createHash("sha256").update(beforeBytes).digest("hex"),
      after_sha256: createHash("sha256").update(afterBytes).digest("hex"),
      before_mtime_ns: beforeStat.mtimeNs.toString(),
      after_mtime_ns: afterStat.mtimeNs.toString(),
    },
  };
}

async function respondToRunnerBridgeRequests({ transportDir, bridge, unknownResidue }) {
  const requestsDir = path.join(transportDir, "requests");
  const resultsDir = path.join(transportDir, "results");
  const seen = new Set();
  for (let attempt = 0; attempt < 2_000 && seen.size < 2; attempt += 1) {
    const files = (await readdir(requestsDir)).filter((file) => /^cmd_[A-Za-z0-9_]+\.json$/u.test(file));
    for (const file of files) {
      if (seen.has(file)) continue;
      let request;
      try {
        request = JSON.parse(await readFile(path.join(requestsDir, file), "utf8"));
      } catch {
        continue;
      }
      const result = bridge.dispatch(request);
      if (unknownResidue && seen.size === 1) {
        await writeFile(path.join(requestsDir, "unknown-residue.json"), "{}\n", "utf8");
      }
      await writeFile(path.join(resultsDir, file), `${JSON.stringify(result)}\n`, "utf8");
      seen.add(file);
    }
    if (seen.size < 2) await new Promise((resolve) => setTimeout(resolve, 5));
  }
  if (seen.size !== 2) throw new Error(`Runner fixture observed ${seen.size}/2 bridge requests`);
}

describe("Alpha3.2-C3A current project path and dirty-state reads", () => {
  it("adds exactly two official read descriptors with exact discovery truth", () => {
    const catalog = createAcceptedOfficialTemplateCatalog();
    assert.equal(catalog.size, 241);
    for (const id of IDS) {
      const descriptor = catalog.require(id);
      assert.equal(descriptor.pack, "project");
      assert.equal(descriptor.risk, "read");
      assert.equal(descriptor.bridge.operation_family, "query_state");
      assert.equal(descriptor.bridge.operation_name, id.replace("template.", ""));
      assert.equal(descriptor.bridge.idempotency, "none");
      assert.equal(descriptor.artifacts.mode, "none");
      assert.equal(descriptor.verification.mode, "none");
      assert.deepEqual(descriptor.inputSchema.required, []);
    }
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS,
      },
    });
    const exact = runtime.list_templates({ ids: IDS, fields: ["summary", "output_schema"] });
    assert.deepEqual(exact.items.map((item) => item.id), IDS);
    assert.equal(exact.items.every((item) => item.capability_truth.live_runnable_now === true), true);
    assert.equal(exact.items.every((item) => item.capability_truth.allowed_live_group === "alpha3_2c3a_project_file_read"), true);
    assert.equal(
      exact.items.every((item) => item.capability_truth.evidence_level === "live_smoked"),
      true,
    );
    assert.equal(exact.items.every((item) => item.capability_truth.evidence_level === "live_smoked"), true);
    assert.equal(exact.items.every((item) => item.risk === undefined), true);
  });

  it("keeps historical Alpha2 evidence at 215 while carrying the 241-id current product", () => {
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS.length, 215);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_HISTORICAL_EVIDENCE_TEMPLATE_IDS.includes("template.items.set_item_pan"), true);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.length, 214);
    assert.equal(CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.includes("template.items.set_item_pan"), false);
    assert.equal(IDS.some((id) => CALL_TEMPLATE_RUNTIME_ALPHA2_LIVE_GRADUATED_TEMPLATE_IDS.includes(id)), false);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_ALPHA3_2C3A_PROJECT_FILE_READ_TEMPLATE_IDS, IDS);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 241);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS[214], "template.items.set_active_take");
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.slice(215, 217), IDS);
    const current = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    assert.equal(current.live_gate.allowed_template_ids.length, 241);
    const invalid = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: [...IDS, "template.project.read_summary"],
      },
    });
    assert.deepEqual(invalid.live_gate.allowed_template_ids, []);
  });

  it("projects saved, unsaved, and truncated path states through the fake harness", async () => {
    const savedPath = "/Users/example/Projects/Exact Session.RPP";
    const saved = await callWithOutcome(IDS[0], {
      summary: {
        project_ref: "project:current",
        name: "Exact Session.RPP",
        path: savedPath,
        has_project_path: true,
        path_state: "saved_project",
        path_truncated: false,
      },
    });
    assert.equal(saved.ok, true);
    assert.deepEqual(saved.result.summary, {
      project_ref: "project:current",
      name: "Exact Session.RPP",
      path: savedPath,
      has_project_path: true,
      path_state: "saved_project",
      path_truncated: false,
    });
    assert.equal(saved.result.refs[0].ref, "project:current");

    const unsaved = await callWithOutcome(IDS[0], {
      summary: {
        project_ref: "project:current",
        name: "Untitled.RPP",
        path: "",
        has_project_path: false,
        path_state: "unsaved_project",
        path_truncated: false,
      },
    });
    assert.equal(unsaved.result.summary.path, "");
    assert.equal(unsaved.result.summary.path_state, "unsaved_project");

    const truncated = await callWithOutcome(IDS[0], {
      summary: {
        project_ref: "project:current",
        name: "Long.RPP",
        path: `${"/deep".repeat(300)}...`,
        has_project_path: true,
        path_state: "saved_project",
        path_truncated: true,
      },
    });
    assert.equal(truncated.result.summary.path_truncated, true);
    assert.equal(Buffer.byteLength(truncated.result.summary.path, "utf8") <= 1_536, true);
  });

  it("projects clean/dirty raw states and preserves strict typed runtime failures", async () => {
    for (const [raw, dirty, dirtyState] of [[0, false, "clean"], [2, true, "dirty"]]) {
      const result = await callWithOutcome(IDS[1], {
        summary: {
          project_ref: "project:current",
          dirty,
          dirty_state: dirtyState,
          raw_dirty_state: raw,
        },
      });
      assert.equal(result.ok, true);
      assert.equal(result.result.summary.raw_dirty_state, raw);
      assert.equal(result.result.summary.dirty, dirty);
      assert.equal(result.result.summary.dirty_state, dirtyState);
    }

    for (const [api, reason, actualValue] of [
      ["IsProjectDirty", "api_unavailable", null],
      ["IsProjectDirty", "pcall_failed", null],
      ["IsProjectDirty", "invalid_result", "nan"],
      ["IsProjectDirty", "invalid_result", "positive_infinity"],
      ["IsProjectDirty", "invalid_result", "negative_infinity"],
      ["IsProjectDirty", "invalid_result", "negative_integer"],
      ["IsProjectDirty", "invalid_result", "fractional_number"],
      ["IsProjectDirty", "invalid_result", "non_number"],
      ["EnumProjects", "invalid_result", "non_string_path"],
    ]) {
      const result = await callWithOutcome(IDS[1], {
        error: {
          message: `C3A ${api} ${reason}`,
          details: {
            api,
            reason,
            expected: reason === "invalid_result" ? "non_negative_integer" : undefined,
            actual_value: actualValue,
          },
        },
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "INTERNAL_ERROR");
      assert.equal(result.error.details.api, api);
      assert.equal(result.error.details.reason, reason);
      assert.equal(result.error.details.actual_value, actualValue);
    }
  });

  it("hardens the live runner before MCP startup and never controls REAPER", async () => {
    const source = await readFile("scripts/smoke-alpha3-2c3a-project-file-read.mjs", "utf8");
    for (const required of [
      "--mcp-command",
      "--evidence-root",
      "--expected-project-path",
      "Evidence root must not already exist",
      "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
      "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
      "OPENREAPER_LIVE_BRIDGE_OWNER",
      "OPENREAPER_LIVE_BRIDGE_GENERATION",
      "Transport requests/results must be empty before MCP startup",
      "Expected RPP changed during C3A read smoke",
      "new_backup_entries",
      "ds_store",
      "project:current",
      "Evidence root report exclusivity",
    ]) {
      assert.equal(source.includes(required), true, required);
    }
    assert.doesNotMatch(source, /openreaper-start|open\s+-a\s+REAPER|killall|pkill|Main_SaveProject|Main_OnCommand/u);

    const missing = spawnSync(process.execPath, ["scripts/smoke-alpha3-2c3a-project-file-read.mjs"], {
      cwd: process.cwd(),
      encoding: "utf8",
    });
    assert.equal(missing.status, 2);
    assert.match(missing.stderr, /Missing required option: --mcp-command/);

    const root = await mkdtemp(path.join(tmpdir(), "openreaper-c3a-runner-preflight-"));
    const existingEvidence = path.join(root, "existing-evidence");
    const expectedProject = path.join(root, "Expected.RPP");
    await mkdir(existingEvidence);
    await writeFile(expectedProject, "<REAPER_PROJECT 0.1\n>", "utf8");
    const existing = spawnSync(process.execPath, [
      "scripts/smoke-alpha3-2c3a-project-file-read.mjs",
      "--mcp-command", process.execPath,
      "--evidence-root", existingEvidence,
      "--expected-project-path", expectedProject,
    ], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(existing.status, 2);
    assert.match(existing.stderr, /Evidence root must not already exist/);

    const freshEvidence = path.join(root, "fresh-evidence");
    const cleanEnv = { ...process.env };
    for (const key of [
      "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
      "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
      "OPENREAPER_LIVE_BRIDGE_OWNER",
      "OPENREAPER_LIVE_BRIDGE_GENERATION",
    ]) delete cleanEnv[key];
    const preflightFailure = spawnSync(process.execPath, [
      "scripts/smoke-alpha3-2c3a-project-file-read.mjs",
      "--mcp-command", process.execPath,
      "--evidence-root", freshEvidence,
      "--expected-project-path", expectedProject,
    ], { cwd: process.cwd(), encoding: "utf8", env: cleanEnv });
    assert.equal(preflightFailure.status, 1);
    assert.deepEqual(await readdir(freshEvidence), ["alpha3-2c3a-project-file-read.json"]);
    const failureReport = JSON.parse(await readFile(path.join(freshEvidence, "alpha3-2c3a-project-file-read.json"), "utf8"));
    assert.equal(failureReport.ok, false);
    assert.match(failureReport.error.message, /OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/);
    assert.equal(failureReport.started_reaper, false);
    assert.equal(failureReport.stopped_reaper, false);
    await rm(root, { recursive: true, force: true });
  });

  it("runs the hardened dedicated runner through actual stdio and removes only its four owned transport files", async () => {
    const fixture = await runDedicatedRunnerFixture();
    try {
      assert.deepEqual(fixture.exit, { code: 0, signal: null });
      assert.equal(fixture.report.ok, true);
      assert.equal(fixture.report.preflight.owned_transport_cleanup.policy, "exact_owned_request_result_files_only_with_bounded_late_result_settle");
      assert.equal(fixture.report.preflight.owned_transport_cleanup.removed_file_count, 4);
      assert.deepEqual(fixture.report.preflight.transport_final, { requests: [], results: [] });
      assert.equal(fixture.report.filesystem_evidence.expected_project.unchanged, true);
      assert.equal(fixture.projectIntegrity.before_sha256, fixture.projectIntegrity.after_sha256);
      assert.equal(fixture.projectIntegrity.before_mtime_ns, fixture.projectIntegrity.after_mtime_ns);
      assert.deepEqual(await readdir(path.join(fixture.transportDir, "requests")), []);
      assert.deepEqual(await readdir(path.join(fixture.transportDir, "results")), []);
      assert.deepEqual(await readdir(fixture.evidenceRoot), ["alpha3-2c3a-project-file-read.json"]);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("preserves unknown transport residue and fails closed after deleting only owned files", async () => {
    const fixture = await runDedicatedRunnerFixture({ unknownResidue: true });
    try {
      assert.deepEqual(fixture.exit, { code: 1, signal: null });
      assert.equal(fixture.report.ok, false);
      assert.match(fixture.report.error.message, /unknown transport residue remained and was preserved/);
      assert.equal(fixture.report.preflight.owned_transport_cleanup.removed_file_count, 4);
      assert.deepEqual(fixture.report.preflight.transport_final, {
        requests: ["unknown-residue.json"],
        results: [],
      });
      assert.deepEqual(await readdir(path.join(fixture.transportDir, "requests")), ["unknown-residue.json"]);
      assert.deepEqual(await readdir(path.join(fixture.transportDir, "results")), []);
      assert.equal(fixture.projectIntegrity.before_sha256, fixture.projectIntegrity.after_sha256);
      assert.equal(fixture.projectIntegrity.before_mtime_ns, fixture.projectIntegrity.after_mtime_ns);
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });

  it("uses actual stdio, omitted context, a fake file bridge, and exactly six tools", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "openreaper-c3a-stdio-"));
    const transportDir = path.join(root, "transport");
    await mkdir(path.join(transportDir, "requests"), { recursive: true });
    await mkdir(path.join(transportDir, "results"), { recursive: true });
    await writeFile(
      path.join(transportDir, "openreaper-bridge-liveness-v1.json"),
      `${JSON.stringify({
        contract: "openreaper.bridge_liveness.v1",
        active_owner: "openreaper-alpha",
        active_generation: 1,
        sequence: 1,
        refreshed_at_unix_s: Math.floor(Date.now() / 1000),
        interval_ms: 500,
      })}\n`,
      "utf8",
    );
    const client = new Client({ name: "openreaper-c3a-stdio-test", version: "0.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: process.cwd(),
      env: {
        ...process.env,
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
        OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: REPO_BRIDGE_SCRIPT_PATH,
        OPENREAPER_LIVE_BRIDGE_OWNER: "openreaper-alpha",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
    });
    try {
      await client.connect(transport);
      assert.deepEqual((await client.listTools()).tools.map((tool) => tool.name).sort(), EXACT_TOOLS);
      const bridge = new OperationAwareProjectReadBridge({ owner: "openreaper-alpha", generation: 1 });
      for (const [id, operationName] of [
        [IDS[0], "project.read_current_project_path"],
        [IDS[1], "project.read_dirty_state"],
      ]) {
        const responsePromise = client.callTool({ name: "call_template", arguments: { id, input: {} } });
        const requestPromise = respondToNextBridgeRequest(transportDir, bridge);
        const [response, request] = await Promise.all([responsePromise.then(parseToolJson), requestPromise]);
        assert.equal(response.ok, true);
        assert.equal(request.operation.family, "query_state");
        assert.equal(request.operation.name, operationName);
        assert.equal(request.undo.mode, "none");
        assert.equal(request.artifacts.allow, false);
        assert.equal(request.client.session_id.startsWith("openreaper-mcp-"), true);
        assert.deepEqual(response.result.summary, operationAwareSummary(operationName));
        assert.equal(response.result.refs.some((ref) =>
          ref.kind === "project" &&
          ref.ref === "project:current" &&
          ref.identity?.scheme === "current" &&
          ref.identity?.value === "current"), true);
        assert.deepEqual(response.result.artifacts, []);
        assert.deepEqual(response.result.jobs, []);
        await rm(path.join(transportDir, "requests", `${request.id}.json`), { force: true });
        await rm(path.join(transportDir, "results", `${request.id}.json`), { force: true });
      }
    } finally {
      await client.close?.();
      await rm(root, { recursive: true, force: true });
    }
  });
});
