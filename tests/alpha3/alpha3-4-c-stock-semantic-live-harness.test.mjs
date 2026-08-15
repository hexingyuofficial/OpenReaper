import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAlpha34CStockSemanticLiveAuditPlan,
  listAlpha34CStockSemanticControls,
} from "../../packages/mcp-server/src/alpha3-4-c-fx-semantic-truth-v1.mjs";
import {
  runStockSemanticTruthAudit,
} from "../../scripts/smoke-alpha3-4-c-stock-semantic-truth.mjs";

test("live audit plan covers all 43 controls with low/mid/high and never auto-promotes", () => {
  const catalog = listAlpha34CStockSemanticControls();
  const plan = createAlpha34CStockSemanticLiveAuditPlan();
  assert.equal(plan.auto_promote_proof, false);
  assert.equal(plan.control_count, 43);
  assert.equal(plan.plugin_count, 10);
  assert.equal(plan.probes.length, catalog.control_count);
  assert.equal(plan.probes.every((probe) => probe.points.join(",") === "low,mid,high"), true);
  assert.equal(plan.probes.every((probe) => probe.promotion_allowed === false), true);
});

test("harness defaults to planned_only without connecting to the installed wrapper", async () => {
  const fixture = await createFixture();
  try {
    const report = await runStockSemanticTruthAudit({
      ...fixture,
      connectFactory: async () => {
        throw new Error("planned-only mode must not connect");
      },
    });
    assert.equal(report.ok, true);
    assert.equal(report.status, "planned_only");
    assert.equal(report.auto_promote_proof, false);
    assert.equal(report.control_count, 43);
    assert.equal(report.calls.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("executeLive requires explicit bridge/session identity instead of silently auto-running", async () => {
  const fixture = await createFixture();
  try {
    const report = await runStockSemanticTruthAudit({
      ...fixture,
      executeLive: true,
      connectFactory: async () => ({ async close() {} }),
    });
    assert.equal(report.ok, false);
    assert.equal(report.status, "failed");
    assert.equal(report.error.code, "STOCK_AUDIT_LIVE_ENV_REQUIRED");
    assert.equal(report.calls.length, 0);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("fake live client proves installed-wrapper audit calls, native probes, exact write, and save without promoting proof", async () => {
  const fixture = await createFixture();
  const fake = fakeReaCompClient();
  try {
    const report = await runStockSemanticTruthAudit({
      ...fixture,
      executeLive: true,
      selectedPluginIds: ["reacomp"],
      liveEnvironment: {
        transportDir: path.join(fixture.root, "session", "transport"),
        artifactRoot: path.join(fixture.root, "session", "artifacts"),
        renderRoot: path.join(fixture.root, "session", "renders"),
        indexRoot: path.join(fixture.root, "session", "index"),
        bridgeOwner: "alpha34-c-fake-live",
        bridgeGeneration: 1,
        projectPath: fixture.sourceProject,
      },
      connectFactory: async ({ installedWrapper, liveEnvironment }) => {
        assert.equal(installedWrapper, fixture.installedWrapper);
        assert.equal(liveEnvironment.bridgeOwner, "alpha34-c-fake-live");
        return fake.client;
      },
    });
    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.equal(report.status, "completed_native_observations_pending_review");
    assert.equal(report.runtime.source, "installed_wrapper");
    assert.deepEqual(report.selected_plugin_ids, ["reacomp"]);
    assert.equal(report.plugins[0].parameter_inventory.inventory_complete, true);
    assert.equal(report.plugins[0].native_low_mid_high_observed_count, 5);
    assert.equal(report.plugins[0].exact_write.status, "passed");
    assert.equal(report.plugins[0].controls.every((entry) => entry.proof_status_after === "unproven"), true);
    assert.equal(report.auto_promote_proof, false);
    assert.equal(report.audit_counts.still_unproven, 5);
    assert.ok(fake.calls.some((entry) => entry.arguments?.id === "template.fx.search_installed_fx"));
    assert.equal(fake.calls.filter((entry) => entry.arguments?.id === "template.fx.read_fx_parameter").length, 15);
    assert.equal(fake.calls.filter((entry) => entry.arguments?.id === "macro.fx.set_controls").length, 1);
    assert.equal(fake.calls.filter((entry) => entry.arguments?.id === "macro.project.file").length, 1);
    const catalogAfter = listAlpha34CStockSemanticControls();
    assert.equal(catalogAfter.controls.every((entry) => entry.proof_status === "unproven"), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

test("native probe evidence rejects finite normalized readback outside tolerance", async () => {
  const fixture = await createFixture();
  const fake = fakeReaCompClient({ probeOffset: 0.01 });
  try {
    const report = await runStockSemanticTruthAudit({
      ...fixture,
      executeLive: true,
      selectedPluginIds: ["reacomp"],
      liveEnvironment: {
        transportDir: path.join(fixture.root, "session", "transport"),
        artifactRoot: path.join(fixture.root, "session", "artifacts"),
        renderRoot: path.join(fixture.root, "session", "renders"),
        indexRoot: path.join(fixture.root, "session", "index"),
        bridgeOwner: "alpha34-c-fake-live",
        bridgeGeneration: 1,
        projectPath: fixture.sourceProject,
      },
      connectFactory: async () => fake.client,
    });
    assert.equal(report.ok, true, JSON.stringify(report.error));
    assert.equal(report.status, "completed_with_unproven_controls");
    assert.equal(report.plugins[0].native_low_mid_high_observed_count, 0);
    assert.equal(report.plugins[0].exact_write.status, "not_run");
    assert.equal(report.plugins[0].controls.every((entry) => entry.audit_status === "native_probe_unproven"), true);
    assert.equal(report.plugins[0].controls.every((entry) => entry.probes.every((probe) => probe.status === "invalid")), true);
  } finally {
    await rm(fixture.root, { recursive: true, force: true });
  }
});

async function createFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha34-c-harness-"));
  const installedWrapper = path.join(root, "OpenReaper-alpha", "bin", "openreaper-mcp");
  const sourceProject = path.join(root, "source.RPP");
  const evidenceRoot = path.join(root, "evidence");
  await mkdir(path.dirname(installedWrapper), { recursive: true });
  await writeFile(installedWrapper, "wrapper", "utf8");
  await writeFile(sourceProject, "RPP", "utf8");
  return { root, installedWrapper, sourceProject, evidenceRoot };
}

function fakeReaCompClient({ probeOffset = 0 } = {}) {
  const calls = [];
  const parameters = [
    { param_index: 0, name: "Threshold", param_ident: "threshold" },
    { param_index: 1, name: "Ratio", param_ident: "ratio" },
    { param_index: 2, name: "Attack", param_ident: "attack" },
    { param_index: 3, name: "Release", param_ident: "release" },
    { param_index: 4, name: "Wet", param_ident: "wet" },
  ];
  const client = {
    async listTools() {
      return { tools: ["ping", "get_state", "list_templates", "list_recipes", "call_template", "call_recipe"].map((name) => ({ name })) };
    },
    async callTool(request) {
      calls.push(structuredClone(request));
      if (request.name === "ping") return toolResponse({ ok: true, contract: "openreaper.ping.v1" });
      assert.equal(request.name, "call_template");
      const { id, input = {} } = request.arguments;
      if (id === "template.fx.search_installed_fx") {
        return toolResponse(templateExecution({ rows: [{ name: "VST: ReaComp (Cockos)" }] }));
      }
      if (id === "template.tracks.create_track") {
        return toolResponse(templateExecution({ track_ref: "track:guid:{FAKE-TRACK}" }, [{ kind: "track", ref: "track:guid:{FAKE-TRACK}" }]));
      }
      if (id === "template.fx.add_track_fx") {
        return toolResponse(templateExecution({ fx_ref: "fx:track:guid:{FAKE-TRACK}:0" }, [{ kind: "fx", ref: "fx:track:guid:{FAKE-TRACK}:0" }]));
      }
      if (id === "template.fx.read_fx_summary") {
        return toolResponse(templateExecution({ fx_ref: "fx:track:guid:{FAKE-TRACK}:0", parameter_count: parameters.length }));
      }
      if (id === "template.fx.list_fx_parameters") {
        return toolResponse(templateExecution({
          parameter_count: parameters.length,
          parameters,
          offset: input.offset ?? 0,
          next_offset: null,
          truncated: false,
          inventory_complete: true,
          coverage_status: "complete",
        }));
      }
      if (id === "template.fx.read_fx_parameter") {
        const parameter = parameters[input.param_index];
        return toolResponse(templateExecution({
          ...parameter,
          normalized_value: input.probe_normalized_value + probeOffset,
          formatted_value: `${Math.round(input.probe_normalized_value * 100)} native`,
          step_sizes_available: false,
          step_size: null,
          is_toggle: false,
          is_discrete: false,
        }));
      }
      if (id === "macro.fx.set_controls") {
        return toolResponse(macroExecution(input.changes));
      }
      if (id === "macro.project.file") {
        return toolResponse(macroExecution([]));
      }
      throw new Error(`Unexpected fake call ${id}`);
    },
    async close() {},
  };
  return { client, calls };
}

function toolResponse(value) {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

function templateExecution(summary, refs = []) {
  return {
    contract: "template.execution.v1",
    ok: true,
    verification: { status: "passed" },
    result: { summary, data: summary, refs, verification: { status: "passed" } },
    error: null,
  };
}

function macroExecution(changes) {
  return {
    contract: "macro.execution.v1",
    ok: true,
    execution: { status: "completed" },
    result: {
      verification: { status: "passed" },
      changes: changes.map((entry) => ({
        id: entry.id,
        param_index: entry.param_index,
        status: "applied",
        mutation: { status: "completed" },
        live_readback: { status: "passed" },
        index_maintenance: { status: "completed" },
      })),
    },
    error: null,
  };
}
