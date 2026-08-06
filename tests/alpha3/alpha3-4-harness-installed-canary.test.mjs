import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readEvidenceEvents, readEvidenceSummary } from "../../scripts/lib/alpha3-4-harness-evidence-v1.mjs";
import {
  INSTALLED_CANARY_BUDGET,
  runInstalledWrapperCanary,
} from "../../scripts/smoke-alpha3-4-harness-installed-canary.mjs";
import {
  createOpenReaperMcpInitializationInstructions,
} from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";

test("installed-wrapper canary keeps inline values at 2 KiB while allowing the bounded response envelope", () => {
  assert.deepEqual(INSTALLED_CANARY_BUDGET, {
    max_response_bytes: 4_096,
    max_items: 50,
    max_inline_value_bytes: 2_048,
  });
});

test("installed-wrapper canary performs exactly ping plus one bounded project read, closes the client, and preserves the source hash", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-canary-"));
  const installedWrapper = await writeInstalledFixture(root);
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(sourceProject, "RPP fixture", "utf8");
  const requests = [];
  let closed = false;
  const instructions = createOpenReaperMcpInitializationInstructions();
  const client = {
    getInstructions() { return instructions; },
    async callTool(request) {
      requests.push(request);
      if (request.name === "ping") return jsonResponse(runtimePing());
      assert.equal(request.name, "call_template");
      assert.deepEqual(request.arguments, { id: "template.project.read_summary", input: { include_counts: true }, budget: INSTALLED_CANARY_BUDGET });
      return jsonResponse({ ok: true, result: { summary: { path: sourceProject, track_count: 0, item_count: 0 } } });
    },
    async close() { closed = true; },
  };
  const before = createHash("sha256").update(await readFile(sourceProject)).digest("hex");
  try {
    const report = await runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory: async ({ installedWrapper: wrapper }) => {
      assert.equal(wrapper, installedWrapper);
      return client;
    } });
    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.equal(report.status, "passed");
    assert.equal(requests.length, 2);
    assert.deepEqual(requests.map((request) => request.name), ["ping", "call_template"]);
    assert.equal(report.initialization_instructions.utf8_bytes, Buffer.byteLength(instructions, "utf8"));
    assert.equal(report.initialization_instructions.macro_ids.length, 15);
    assert.equal(closed, true);
    assert.equal(report.provenance.transport, "installed_wrapper_only");
    assert.equal(report.provenance.package_provenance.contract, "openreaper.package.provenance.v1");
    assert.equal(report.provenance.package_provenance.package_version, "3.3.0-alpha.0");
    assert.deepEqual(report.provenance.runtime_ping, {
      product: "OpenReaper",
      kernel: "openreaper-mcp kernel",
      version: "0.3.0-alpha",
    });
    assert.match(report.provenance.package_provenance.provenance_sha256, /^[0-9a-f]{64}$/u);
    assert.equal(report.source_hashes.before, before);
    assert.equal(report.source_hashes.after, before);
    assert.deepEqual(report.project_changes, []);
    assert.deepEqual(report.rendered_outputs, []);
    const events = await readEvidenceEvents(evidenceRoot);
    assert.deepEqual(events.map((event) => [event.tool, event.requested_id, event.status]), [["ping", null, "success"], ["call_template", "template.project.read_summary", "success"]]);
    assert.equal(events[1].budget.max_response_bytes, 4096);
    const summary = await readEvidenceSummary(evidenceRoot);
    assert.equal(summary.client_close.ok, true);
    assert.equal(summary.error, null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed-wrapper canary fails if the supposedly read-only run changes the source RPP", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-canary-mutation-"));
  const installedWrapper = await writeInstalledFixture(root);
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(sourceProject, "RPP fixture", "utf8");
  try {
    const report = await runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory: async () => ({
      getInstructions() { return createOpenReaperMcpInitializationInstructions(); },
      async callTool({ name }) {
        if (name === "ping") return jsonResponse(runtimePing());
        await writeFile(sourceProject, "unexpected mutation", "utf8");
        return jsonResponse({ ok: true, result: { summary: { path: sourceProject }, changes: [] } });
      },
      async close() {},
    }) });
    assert.equal(report.ok, false);
    assert.equal(report.error.code, "CANARY_SOURCE_PROJECT_CHANGED");
    assert.equal(report.recovery_posture.source_project_unchanged, false);
    const summary = await readEvidenceSummary(evidenceRoot);
    assert.equal(summary.error.code, "CANARY_SOURCE_PROJECT_CHANGED");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed-wrapper canary records a failed read and closes the injected client", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-canary-fail-"));
  const installedWrapper = await writeInstalledFixture(root);
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(sourceProject, "RPP fixture", "utf8");
  let closeCount = 0;
  try {
    const report = await runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory: async () => ({
      getInstructions() { return createOpenReaperMcpInitializationInstructions(); },
      async callTool({ name }) {
        if (name === "ping") return jsonResponse(runtimePing());
        return jsonResponse({ ok: true, result: { summary: { path: "/wrong/project.RPP" } } });
      },
      async close() { closeCount += 1; },
    }) });
    assert.equal(report.ok, false);
    assert.equal(report.error.code, "CANARY_PROJECT_PATH_MISMATCH");
    assert.equal(closeCount, 1);
    const events = await readEvidenceEvents(evidenceRoot);
    assert.equal(events.length, 2);
    assert.equal(events[1].status, "success");
    assert.equal(report.recovery_posture.source_project_unchanged, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("installed-wrapper canary fails before connecting when package provenance is missing", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-canary-provenance-"));
  const installedWrapper = path.join(root, "OpenReaper-alpha", "bin", "openreaper-mcp");
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await mkdir(path.dirname(installedWrapper), { recursive: true });
  await writeFile(installedWrapper, "installed-wrapper-only", "utf8");
  await writeFile(sourceProject, "RPP fixture", "utf8");
  let connected = false;
  try {
    const report = await runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory: async () => {
      connected = true;
      assert.fail("must not connect without package provenance");
    } });
    assert.equal(report.ok, false);
    assert.equal(report.error.code, "CANARY_PACKAGE_PROVENANCE_UNREADABLE");
    assert.equal(connected, false);
    const summary = await readEvidenceSummary(evidenceRoot);
    assert.equal(summary.error.code, "CANARY_PACKAGE_PROVENANCE_UNREADABLE");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canary source statically uses only the installed wrapper transport and the two read calls", async () => {
  const source = await readFile(path.join(path.resolve(import.meta.dirname, "../.."), "scripts/smoke-alpha3-4-harness-installed-canary.mjs"), "utf8");
  assert.match(source, /command: installedWrapper/u);
  assert.doesNotMatch(source, /process\.execPath|root_override|rootOverrides|raw Lua|shell/u);
  assert.equal((source.match(/tool: "ping"/gu) ?? []).length, 1);
  assert.equal((source.match(/template\.project\.read_summary/gu) ?? []).length, 1);
  assert.match(source, /getInstructions/u);
});

test("installed-wrapper canary rejects a ping that does not identify the OpenReaper kernel", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-canary-runtime-"));
  const installedWrapper = await writeInstalledFixture(root);
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await writeFile(sourceProject, "RPP fixture", "utf8");
  try {
    const report = await runInstalledWrapperCanary({ installedWrapper, sourceProject, evidenceRoot, connectFactory: async () => ({
      getInstructions() { return createOpenReaperMcpInitializationInstructions(); },
      async callTool() { return jsonResponse({ ok: true, product: "Other", kernel: "other", version: "0.3.0-alpha" }); },
      async close() {},
    }) });
    assert.equal(report.ok, false);
    assert.equal(report.error.code, "CANARY_RUNTIME_IDENTITY_MISMATCH");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

function jsonResponse(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function runtimePing() {
  return { ok: true, product: "OpenReaper", kernel: "openreaper-mcp kernel", version: "0.3.0-alpha" };
}

async function writeInstalledFixture(root) {
  const installRoot = path.join(root, "OpenReaper-alpha");
  const installedWrapper = path.join(installRoot, "bin", "openreaper-mcp");
  await mkdir(path.dirname(installedWrapper), { recursive: true });
  await writeFile(installedWrapper, "installed-wrapper-only", "utf8");
  await writeFile(path.join(installRoot, "provenance.json"), JSON.stringify({
    contract: "openreaper.package.provenance.v1",
    product: "OpenReaper alpha",
    package_version: "3.3.0-alpha.0",
    build_id: "alpha33-fixture",
    openreaper_git_commit: "936536f4c6ced6cd2fe9472c3c673e8a12284545",
    build_time_utc: "2026-07-17T00:00:00.000Z",
    source_tree_clean: true,
  }), "utf8");
  return installedWrapper;
}
