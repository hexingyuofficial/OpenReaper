import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  runAlpha34D2FxBatchHarness,
  validateBatchResponse,
} from "../../scripts/smoke-alpha3-4-d2-fx-batch.mjs";
import { executeAlpha3_2_5CControlMacro } from "../../packages/mcp-server/src/alpha3-2-5-c-control-runtime-v1.mjs";
import { canonicalizeAlpha3_3B1MacroExecutionEnvelope } from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  readEvidenceEvents,
  readEvidenceSummary,
} from "../../scripts/lib/alpha3-4-harness-evidence-v1.mjs";

function fxRef(n) {
  return `fx:track:guid:{TRACK-H${String(n).padStart(2, "0")}}:0`;
}

function fixtureAssignments() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `h${String(index + 1).padStart(2, "0")}abcdefgh`.slice(0, 12),
    fx_ref: fxRef((index % 3) + 1),
    param_index: index % 4,
    normalized_value: 0.2 + index * 0.05,
  }));
}

function inventoryRows(count = 16) {
  return Array.from({ length: count }, (_, index) => ({
    param_index: index,
    name: `Param ${index}`,
    param_ident: `p${index}`,
  }));
}

function execution(id, payload = {}, ok = true) {
  return {
    ok,
    request: { id },
    verification: { status: ok ? "passed" : "failed" },
    result: {
      readback: payload,
      summary: payload,
      data: payload,
      refs: Object.entries(payload)
        .filter(([key, value]) => key.endsWith("_ref") && typeof value === "string")
        .map(([key, ref]) => ({
          kind: key.slice(0, -4),
          ref,
          identity: { scheme: "guid", value: ref },
        })),
    },
  };
}

function makeLiveLikeTransport() {
  const values = new Map();
  const index = {
    calls: 0,
    invalidateScopes({ scopes }) {
      this.calls += 1;
      return { ok: true, scopes };
    },
  };
  const dispatchLog = [];
  const callTemplate = async (request) => {
    if (request.id === "macro.fx.set_controls") {
      const response = await executeAlpha3_2_5CControlMacro({
        request: {
          ...request,
          id: "macro.set_stock_plugin_controls",
        },
        projectIndexRuntime: index,
        executeAtomic: async (child) => {
          dispatchLog.push(child.id);
          if (child.id === "template.tracks.resolve_track_ref") {
            return execution(child.id, { track_ref: child.input.track_ref });
          }
          if (child.id === "template.fx.resolve_fx_ref") {
            const owner = child.refs?.track_ref?.ref ?? child.refs?.track_ref;
            const ref = `fx:${owner}:${child.input.slot_index}`;
            return {
              ok: true,
              request: { id: child.id },
              verification: { status: "passed" },
              result: {
                refs: [{ kind: "fx", ref, identity: { scheme: "owner_slot", value: ref } }],
                summary: { fx_ref: ref },
              },
            };
          }
          if (child.id === "template.fx.list_fx_parameters") {
            const offset = child.input.offset ?? 0;
            const limit = child.input.limit ?? 128;
            const rows = inventoryRows(16).slice(offset, offset + limit);
            const next = offset + rows.length < 16 ? offset + rows.length : null;
            return execution(child.id, {
              parameters: rows,
              parameter_count: 16,
              offset,
              next_offset: next,
              truncated: next !== null,
              inventory_complete: next === null,
              coverage_status: next === null ? "complete" : "paged",
            });
          }
          if (child.id === "template.fx.read_fx_parameter") {
            const fx = child.refs?.fx_ref?.ref ?? child.refs?.fx_ref;
            const key = `${fx}#${child.input.param_index}`;
            const value = values.get(key) ?? child.input.probe_normalized_value ?? 0;
            return execution(child.id, {
              param_index: child.input.param_index,
              param_ident: `p${child.input.param_index}`,
              normalized_value: value,
              formatted_value: String(value),
              updated: true,
            });
          }
          if (child.id === "template.fx.set_fx_parameter_normalized") {
            const fx = child.refs?.fx_ref?.ref ?? child.refs?.fx_ref;
            const key = `${fx}#${child.input.param_index}`;
            values.set(key, child.input.normalized_value);
            return execution(child.id, {
              param_index: child.input.param_index,
              param_ident: child.input.param_ident ?? `p${child.input.param_index}`,
              normalized_value: child.input.normalized_value,
              formatted_value: String(child.input.normalized_value),
              updated: true,
              tolerance: 0.001,
            });
          }
          if (child.id === "macro.project.file" || request.id === "macro.project.file") {
            return { ok: true, execution: { status: "completed" }, result: { summary: "saved" } };
          }
          return execution(child.id, {}, false);
        },
      });
      return canonicalizeAlpha3_3B1MacroExecutionEnvelope(response, "macro.fx.set_controls");
    }
    if (request.id === "macro.project.file") {
      return { ok: true, execution: { status: "completed" }, result: { summary: "saved" } };
    }
    throw new Error(`unexpected request ${request.id}`);
  };
  return { callTemplate, index, dispatchLog };
}

function successfulCompactResponse(assignments) {
  const uniqueFxCount = new Set(assignments.map((row) => row.fx_ref)).size;
  const calls = {
    resolve: uniqueFxCount * 2,
    inventory: uniqueFxCount,
    preflight: assignments.length,
    mutation: assignments.length,
    readback: assignments.length,
    index: 1,
  };
  calls.total = calls.resolve + calls.inventory + calls.preflight + calls.mutation + calls.readback + calls.index;
  return {
    ok: true,
    macro: {
      id: "macro.fx.set_controls",
      program_id: "openreaper.macro.fx.set_controls",
      program_version: "1.0.0",
      risk: "write",
    },
    execution: { status: "completed", stages: [], stage_count: 0 },
    sqlite: {
      used: true,
      source: "warm_index",
      freshness: "stale",
      snapshot_ref: null,
      revision: null,
      refreshed: false,
    },
    result: {
      changes: assignments.map((row) => ({
        id: row.id,
        status: "ok",
        mutation: "done",
        readback: "pass",
        index: "done",
      })),
      verification: { status: "passed", evidence_refs: [] },
      data: {
        mode: "exact_assignments",
        timings: {
          target_resolution_ms: 1,
          inventory_hydration_ms: 1,
          preflight_ms: 1,
          mutation_ms: 1,
          final_readback_ms: 1,
          index_maintenance_ms: 1,
          total_ms: 6,
        },
        calls,
        unique_fx_count: uniqueFxCount,
      },
    },
    budget: { max_bytes: 2048, actual_bytes: 500, truncated: false },
  };
}

describe("Alpha3.4-D2 fx batch live harness (fake transport)", () => {
  it("uses production exact_assignments path without rewriting requests", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d2-harness-"));
    const project = path.join(root, "fixture.RPP");
    const evidenceRoot = path.join(root, "evidence");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    const assignments = fixtureAssignments();
    let seen = 0;
    try {
      const report = await runAlpha34D2FxBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot,
        executeLive: false,
        fakeTransportOnly: true,
        fixtureAssignments: assignments,
        warmLatencyCeilingMs: 60_000,
        callTemplate: async (request) => {
          if (request.id === "macro.fx.set_controls") {
            seen += 1;
            assert.equal(request.input.mode, "exact_assignments");
            assert.equal(request.input.dry_run, false);
            assert.equal(request.input.assignments.length, 8);
            assert.deepEqual(request.input.assignments, assignments);
          }
          return transport.callTemplate(request);
        },
      });
      assert.equal(report.ok, true, JSON.stringify(report.error ?? report));
      assert.equal(report.runtime.source, "fake_transport");
      assert.equal(report.runtime.command, null);
      assert.equal(seen, 2);
      assert.equal(report.cold.calls.mutation, 8);
      assert.equal(report.cold.calls.readback, 8);
      assert.equal(report.cold.unique_fx_count, 3);
      assert.equal(report.cold.calls.inventory, 3);
      assert.equal(report.warm.calls.index, 1);
      assert.equal(transport.index.calls, 2);
      assert.equal(report.cold.response_bytes <= 2048, true);
      assert.equal(report.source_media_deleted, false);
      const events = await readEvidenceEvents(evidenceRoot);
      assert.deepEqual(events.map((event) => event.step), ["cold", "warm"]);
      assert.equal(events.every((event) => event.ok === true), true);
      const summary = await readEvidenceSummary(evidenceRoot);
      assert.equal(summary.ok, true);
      assert.equal(summary.final_status, "fake");
      assert.equal(summary.events.total, 2);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("supports connectFactory-only live path", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d2-connect-"));
    const project = path.join(root, "fixture.RPP");
    const evidenceRoot = path.join(root, "evidence");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    let connectCalls = 0;
    let closed = false;
    try {
      const report = await runAlpha34D2FxBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot,
        executeLive: true,
        fixtureAssignments: fixtureAssignments(),
        warmLatencyCeilingMs: 60_000,
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d2-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => {
          connectCalls += 1;
          return {
            async callTool({ name, arguments: args }) {
              assert.equal(name, "call_template");
              const response = await transport.callTemplate({
                id: args.id,
                input: args.input,
                refs: args.refs,
                budget: args.budget,
                context: {
                  request_id: "d2-fx-batch-connect-factory-request",
                  session_id: "d2-fx-batch",
                  request_sequence: 1,
                },
              });
              return { content: [{ type: "text", text: JSON.stringify(response) }] };
            },
            async close() {
              closed = true;
            },
          };
        },
      });
      assert.equal(report.ok, true, JSON.stringify(report.error ?? report));
      assert.equal(report.runtime.source, "injected_live_connector");
      assert.equal(connectCalls, 1);
      assert.equal(closed, true);
      assert.equal(report.client_close.ok, true);
      assert.equal(report.save.ok, true);
      assert.equal(report.recovery_posture.save_current_verified, true);
      assert.equal(report.recovery_posture.source_project_hashes_recorded, true);
      const events = await readEvidenceEvents(evidenceRoot);
      assert.deepEqual(events.map((event) => event.step), ["cold", "warm", "save_current"]);
      const summary = await readEvidenceSummary(evidenceRoot);
      assert.equal(summary.ok, true);
      assert.equal(summary.final_status, "live");
      assert.equal(summary.events.total, 3);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when warm latency ceiling is exceeded", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d2-slow-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const assignments = fixtureAssignments();
    try {
      const report = await runAlpha34D2FxBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        fakeTransportOnly: true,
        fixtureAssignments: assignments,
        warmLatencyCeilingMs: -1,
        callTemplate: async (request) => {
          const response = successfulCompactResponse(assignments);
          assert.equal(validateBatchResponse(response, { budget: request.budget, assignments }).ok, true);
          return response;
        },
      });
      assert.equal(report.ok, false);
      assert.equal(report.error?.code, "D2_HARNESS_WARM_LATENCY_EXCEEDED");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("rejects completed-looking responses without full row and counter truth", () => {
    const assignments = fixtureAssignments();
    const budget = { max_response_bytes: 2048 };
    const failedEnvelope = successfulCompactResponse(assignments);
    failedEnvelope.ok = false;
    assert.equal(validateBatchResponse(failedEnvelope, { budget, assignments }).code, "D2_HARNESS_EXECUTION_NOT_COMPLETED");

    const internalProgramId = successfulCompactResponse(assignments);
    internalProgramId.macro.program_id = "openreaper.macro.set_stock_plugin_controls";
    assert.equal(validateBatchResponse(internalProgramId, { budget, assignments }).code, "D2_HARNESS_PROGRAM_IDENTITY_INVALID");

    const failedRow = successfulCompactResponse(assignments);
    failedRow.result.changes[7].readback = "fail";
    assert.equal(validateBatchResponse(failedRow, { budget, assignments }).code, "D2_HARNESS_ROW_TRUTH_INVALID");

    const falseCounters = successfulCompactResponse(assignments);
    falseCounters.result.data.calls.total -= 1;
    assert.equal(validateBatchResponse(falseCounters, { budget, assignments }).code, "D2_HARNESS_CALL_TOTAL_INVALID");
  });

  it("fails closed when save_current fails", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d2-save-fail-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    try {
      const report = await runAlpha34D2FxBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: true,
        fixtureAssignments: fixtureAssignments(),
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d2-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => ({
          async callTool({ arguments: args }) {
            if (args.id === "macro.project.file") {
              return { content: [{ type: "text", text: JSON.stringify({ ok: false, execution: { status: "failed" }, error: { code: "SAVE_FAILED", message: "save failed" } }) }] };
            }
            const response = await transport.callTemplate({ id: args.id, input: args.input, refs: args.refs, budget: args.budget });
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
          },
          async close() {},
        }),
      });
      assert.equal(report.ok, false);
      assert.equal(report.error.code, "SAVE_FAILED");
      assert.equal(report.save.ok, false);
      assert.equal(report.recovery_posture.recovery_required, true);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("fails closed when the installed client cannot close", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-d2-close-fail-"));
    const project = path.join(root, "fixture.RPP");
    await writeFile(project, "<REAPER_PROJECT\n>");
    const transport = makeLiveLikeTransport();
    try {
      const report = await runAlpha34D2FxBatchHarness({
        installedWrapper: path.join(root, "openreaper-mcp"),
        sourceProject: project,
        evidenceRoot: path.join(root, "evidence"),
        executeLive: true,
        fixtureAssignments: fixtureAssignments(),
        liveEnvironment: {
          transportDir: path.join(root, "transport"),
          artifactRoot: path.join(root, "artifacts"),
          renderRoot: path.join(root, "render"),
          indexRoot: path.join(root, "index"),
          bridgeOwner: "d2-owner",
          bridgeGeneration: 1,
          projectPath: project,
        },
        connectFactory: async () => ({
          async callTool({ arguments: args }) {
            const response = await transport.callTemplate({ id: args.id, input: args.input, refs: args.refs, budget: args.budget });
            return { content: [{ type: "text", text: JSON.stringify(response) }] };
          },
          async close() {
            throw Object.assign(new Error("close failed"), { code: "CLOSE_FAILED" });
          },
        }),
      });
      assert.equal(report.ok, false);
      assert.equal(report.error.code, "CLOSE_FAILED");
      assert.equal(report.client_close.ok, false);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
