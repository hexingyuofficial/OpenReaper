import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import {
  ALPHA3_4_D2_FX_BATCH_MODE,
  normalizeExactAssignmentsInput,
} from "../../packages/mcp-server/src/alpha3-4-d2-fx-batch-v1.mjs";
import { executeAlpha3_2_5CControlMacro } from "../../packages/mcp-server/src/alpha3-2-5-c-control-runtime-v1.mjs";
import { ALPHA3_E1_STOCK_PLUGIN_MACRO_ID } from "../../packages/mcp-server/src/alpha3-e1-stock-plugin-fluency-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import { OPENREAPER_PUBLIC_TOOL_IDS } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const BUDGET = Object.freeze({ max_response_bytes: 2_048, max_items: 8, max_inline_value_bytes: 256 });
const LONG_REQUEST_ID = "req-alpha34-d2-fx-batch-fixture-30charsxx";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function fxRef(track, slot = 0) {
  return `fx:track:guid:{TRACK-${String(track).padStart(2, "0")}}:${slot}`;
}

function eightAssignments({ uniqueFx = 3, paramCount = 16 } = {}) {
  return Array.from({ length: 8 }, (_, index) => {
    const track = (index % uniqueFx) + 1;
    return {
      id: `r${String(index + 1).padStart(2, "0")}abcdefghij`.slice(0, 12),
      fx_ref: fxRef(track, 0),
      param_index: index % Math.min(paramCount, 8),
      normalized_value: Math.min(1, 0.1 + index * 0.05),
    };
  });
}

function batchAssignments(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `r${String(index + 1).padStart(2, "0")}abcdefghij`.slice(0, 12),
    fx_ref: fxRef(index + 1, 0),
    param_index: 0,
    normalized_value: 0.5,
  }));
}

function inventoryRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    param_index: index,
    name: `Param ${index}`,
    param_ident: `p${index}`,
    is_discrete: index % 7 === 0,
    is_toggle: index % 11 === 0,
    step_sizes_available: index % 7 === 0,
    step_size: index % 7 === 0 ? 1 : null,
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
    ...(ok ? {} : { error: { code: "ATOMIC_FAILED", message: `${id} failed: ${"X".repeat(80)}` } }),
  };
}

function fakeIndex({ fail = false } = {}) {
  return {
    calls: 0,
    status: () => ({ snapshot_id: "snapshot:d2", revision: "1" }),
    invalidateScopes({ scopes }) {
      this.calls += 1;
      return fail
        ? { ok: false, scopes, blockers: [{ code: "INDEX_WRITE_FAILED", message: "index failed", recoverable: true }] }
        : { ok: true, scopes };
    },
  };
}

function makeExecutor({
  paramCountByFx = {},
  defaultParamCount = 16,
  failMutationAt = null,
  mismatchAt = null,
  discreteIndexes = new Set(),
}) {
  const calls = [];
  let mutationCount = 0;
  const values = new Map();
  return {
    calls,
    executeAtomic: async (child) => {
      calls.push(child);
      if (child.id === "template.tracks.resolve_track_ref") {
        const ref = child.input.track_ref;
        return execution(child.id, {
          track_ref: ref,
        }, true);
      }
      if (child.id === "template.fx.resolve_fx_ref") {
        const owner = child.refs?.track_ref?.ref ?? child.refs?.track_ref ?? child.refs?.take_ref?.ref;
        const slot = child.input.slot_index;
        const ref = `fx:${owner}:${slot}`;
        const ownerKind = owner.startsWith("track:") ? "track" : "take";
        return {
          ok: true,
          request: { id: child.id },
          verification: { status: "passed" },
          result: {
            readback: { fx_ref: ref },
            summary: { fx_ref: ref },
            refs: [{ kind: "fx", ref, identity: { scheme: `${ownerKind}_fx`, value: `${owner}:${slot}` } }],
          },
        };
      }
      if (child.id === "template.fx.list_fx_parameters") {
        const fx = child.refs?.fx_ref?.ref ?? child.refs?.fx_ref;
        const total = paramCountByFx[fx] ?? defaultParamCount;
        const limit = child.input.limit ?? 128;
        const offset = child.input.offset ?? 0;
        const page = inventoryRows(total).slice(offset, offset + limit);
        const next = offset + page.length < total ? offset + page.length : null;
        return execution(child.id, {
          parameters: page,
          parameter_count: total,
          offset,
          next_offset: next,
          truncated: next !== null,
          inventory_complete: next === null,
          coverage_status: next === null ? "complete" : "paged",
        });
      }
      if (child.id === "template.fx.read_fx_parameter") {
        const fx = child.refs?.fx_ref?.ref ?? child.refs?.fx_ref;
        const index = child.input.param_index;
        const key = `${fx}#${index}`;
        const requested = child.input.probe_normalized_value;
        const current = values.has(key) ? values.get(key) : (Number.isFinite(requested) ? requested : 0);
        const discrete = discreteIndexes.has(index);
        return execution(child.id, {
          param_index: index,
          param_ident: `p${index}`,
          normalized_value: current,
          formatted_value: discrete ? `step:${Math.round(current)}` : String(current),
          is_discrete: discrete,
          is_toggle: false,
          step_sizes_available: discrete,
          step_size: discrete ? 1 : null,
          updated: true,
        });
      }
      if (child.id === "template.fx.set_fx_parameter_normalized") {
        mutationCount += 1;
        if (failMutationAt !== null && mutationCount > failMutationAt) {
          return execution(child.id, {}, false);
        }
        const fx = child.refs?.fx_ref?.ref ?? child.refs?.fx_ref;
        const index = child.input.param_index;
        const key = `${fx}#${index}`;
        let value = child.input.normalized_value;
        if (mismatchAt !== null && mutationCount === mismatchAt) value = Math.min(1, value + 0.2);
        values.set(key, value);
        const discrete = discreteIndexes.has(index);
        return execution(child.id, {
          param_index: index,
          param_ident: child.input.param_ident ?? `p${index}`,
          normalized_value: value,
          formatted_value: discrete ? `step:${Math.round(value)}` : String(value),
          updated: true,
          verification_mode: discrete ? "native_discrete_format" : "normalized_tolerance",
          tolerance: discrete ? 0 : 0.001,
          is_discrete: discrete,
        });
      }
      return execution(child.id, {}, false);
    },
  };
}

function request(input, budget = BUDGET) {
  return {
    id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
    input,
    refs: {},
    context: {
      request_id: LONG_REQUEST_ID,
      session_id: "d2-batch",
      request_sequence: 1,
      created_at: "2026-07-18T00:00:00.000Z",
    },
    budget,
  };
}

function countLua(dir) {
  let n = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) n += countLua(full);
    else if (entry.name.endsWith(".lua")) n += 1;
  }
  return n;
}

describe("Alpha3.4-D2 exact_assignments multi-target FX batch", () => {
  it("accepts 1, 8, and 64 exact assignments without truncation and rejects 65 before dispatch", async () => {
    for (const count of [1, 8, 64]) {
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", dry_run: false, assignments: batchAssignments(count) }, { max_response_bytes: 65_536, max_items: 128, max_inline_value_bytes: 24_576 }),
        executeAtomic: makeExecutor({}).executeAtomic,
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, true, `${count}:${JSON.stringify(response)}`);
      assert.equal(response.result.changes.length, count);
      assert.equal(response.result.data.calls.readback, count);
    }
    const calls = [];
    const blocked = await executeAlpha3_2_5CControlMacro({
      request: request({ mode: "exact_assignments", dry_run: false, assignments: batchAssignments(65) }),
      executeAtomic: async (child) => { calls.push(child); return execution(child.id, {}); },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "FX_ASSIGNMENTS_SIZE_INVALID");
    assert.equal(calls.length, 0);
  });

  it("resolves exact audio Take FX through the authoritative FX resolver", async () => {
    const executor = makeExecutor({});
    const takeRef = "take:guid:{AUDIO-TAKE-01}";
    const fx = `fx:${takeRef}:0`;
    const response = await executeAlpha3_2_5CControlMacro({
      request: request({
        mode: "exact_assignments",
        dry_run: true,
        assignments: [{ id: "take_tone_1", fx_ref: fx, param_index: 0, normalized_value: 0.5 }],
      }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(executor.calls.some((child) => child.id === "template.midi.resolve_midi_take_ref"), false);
    const resolve = executor.calls.find((child) => child.id === "template.fx.resolve_fx_ref");
    assert.deepEqual(resolve?.refs?.take_ref, {
      kind: "take",
      ref: takeRef,
      identity: { scheme: "guid", value: "{AUDIO-TAKE-01}" },
    });
    const downstream = executor.calls.filter((child) => [
      "template.fx.list_fx_parameters",
      "template.fx.read_fx_parameter",
      "template.fx.set_fx_parameter_normalized",
    ].includes(child.id));
    assert.equal(downstream.length > 0, true);
    assert.equal(downstream.every((child) => child.refs?.fx_ref?.ref === fx), true);
    assert.equal(downstream.every((child) => child.refs.fx_ref.identity.scheme === "take_fx"), true);
    assert.equal(downstream.every((child) => child.refs.fx_ref.identity.value === `${takeRef}:0`), true);
  });
  it("keeps public counts 6/15/235/91 and mode token", () => {
    assert.equal(ALPHA3_4_D2_FX_BATCH_MODE, "exact_assignments");
    assert.equal(OPENREAPER_PUBLIC_TOOL_IDS.length, 6);
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 235);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT });
    validateBridgeHandlerRegistry({ cwd: ROOT, registry });
    assert.equal(registry.entries.length, 235);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.equal(countLua(path.join(ROOT, "reaper/bridge/src/handlers")), 91);
  });

  it("fits required eight-row 2048-byte fixtures with compact truth", async () => {
    const rows = eightAssignments({ uniqueFx: 3 });
    assert.equal(LONG_REQUEST_ID.length >= 30, true);
    assert.equal(rows.every((row) => row.id.length === 12), true);
    const fixtures = {};

    {
      const executor = makeExecutor({});
      const index = fakeIndex();
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
      assert.equal(response.request.request_id, LONG_REQUEST_ID);
      assert.equal(response.result.changes.length, 8);
      assert.equal(response.result.changes.every((row) => row.status === "ok"), true);
      assert.equal(response.result.data.mode, "exact_assignments");
      assert.equal(response.result.data.unique_fx_count, 3);
      assert.equal(response.result.data.calls.index, 1);
      assert.equal(index.calls, 1);
      assert.equal(response.execution.stage_count, 0);
      assert.deepEqual(response.execution.stages, []);
      assert.deepEqual(Object.keys(response.result.data).sort(), ["calls", "mode", "timings", "unique_fx_count"]);
      fixtures.success = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.success <= 2048, true, `success=${fixtures.success}`);
      // shared inventory: 3 unique FX, each one page for 16 params
      assert.equal(response.result.data.calls.inventory, 3);
      assert.equal(response.result.data.calls.readback, 8);
      assert.equal(response.result.data.calls.mutation, 8);
    }

    {
      const executor = makeExecutor({});
      const index = fakeIndex();
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", assignments: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, true);
      assert.equal(response.execution.status, "dry_run_completed");
      assert.equal(response.result.data.calls.mutation, 0);
      assert.equal(response.result.data.calls.readback, 0);
      assert.equal(response.result.data.calls.index, 0);
      assert.equal(index.calls, 0);
      assert.equal(response.result.changes.every((row) => row.status === "plan"), true);
      fixtures.dry_run = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.dry_run <= 2048, true, `dry=${fixtures.dry_run}`);
    }

    {
      const bad = eightAssignments({ uniqueFx: 3 });
      bad[7] = { ...bad[7], normalized_value: 2 };
      const calls = [];
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", dry_run: false, assignments: bad }),
        executeAtomic: async (child) => {
          calls.push(child);
          return execution(child.id, {});
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false);
      assert.equal(response.error.code, "FX_ASSIGNMENTS_VALUE_INVALID");
      assert.equal(calls.length, 0);
      fixtures.blocker = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.blocker <= 2048, true, `blocker=${fixtures.blocker}`);
    }

    {
      const executor = makeExecutor({ failMutationAt: 1 });
      const index = fakeIndex();
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, false);
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.result.changes.length, 8);
      assert.equal(response.result.changes.slice(2).every((row) => row.status === "skip"), true);
      assert.equal(index.calls, 1);
      fixtures.partial = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.partial <= 2048, true, `partial=${fixtures.partial}`);
    }

    {
      const executor = makeExecutor({});
      const index = fakeIndex({ fail: true });
      const response = await executeAlpha3_2_5CControlMacro({
        request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, false);
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.result.changes.every((row) => row.status === "ok"), true);
      assert.equal(response.result.changes.every((row) => row.index === "fail"), true);
      assert.equal(response.sqlite.used, true);
      assert.equal(index.calls, 1);
      fixtures.index_failure = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.index_failure <= 2048, true, `index=${fixtures.index_failure}`);
    }

    globalThis.__OPENREAPER_D2_BATCH_BYTES__ = fixtures;
  });

  it("hydrates 495+ parameters once per unique FX and rejects duplicate targets", async () => {
    const fx = fxRef(1, 0);
    const rows = Array.from({ length: 4 }, (_, index) => ({
      id: `big${index + 1}xxxxxxx`.slice(0, 12),
      fx_ref: fx,
      param_index: index * 10,
      normalized_value: 0.25 + index * 0.1,
    }));
    const executor = makeExecutor({ paramCountByFx: { [fx]: 512 }, defaultParamCount: 512 });
    const response = await executeAlpha3_2_5CControlMacro({
      request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.unique_fx_count, 1);
    // 512 params / 128 page = 4 pages, shared once
    assert.equal(response.result.data.calls.inventory, 4);
    assert.equal(response.result.data.calls.mutation, 4);
    assert.equal(executor.calls.filter((call) => call.id === "template.fx.list_fx_parameters").length, 4);

    const dup = normalizeExactAssignmentsInput({
      mode: "exact_assignments",
      dry_run: false,
      assignments: [
        { id: "d1", fx_ref: fx, param_index: 1, normalized_value: 0.2 },
        { id: "d2", fx_ref: fx, param_index: 1, normalized_value: 0.3 },
      ],
    });
    assert.equal(dup.ok, false);
    assert.equal(dup.code, "FX_ASSIGNMENTS_DUPLICATE_TARGET");
  });

  it("zero-writes mixed legacy fields and missing authoritative resolve", async () => {
    const calls = [];
    const mixed = await executeAlpha3_2_5CControlMacro({
      request: request({
        mode: "exact_assignments",
        dry_run: false,
        assignments: eightAssignments().slice(0, 1),
        plugin: "reacomp",
      }),
      executeAtomic: async (child) => {
        calls.push(child);
        return execution(child.id, {});
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(mixed.ok, false);
    assert.equal(mixed.error.code, "FX_ASSIGNMENTS_FIELDS_INVALID");
    assert.equal(calls.length, 0);

    const defaultDryRunFailure = await executeAlpha3_2_5CControlMacro({
      request: request({
        mode: "exact_assignments",
        assignments: [{ id: "bad id", fx_ref: fxRef(1, 0), param_index: 0, normalized_value: 0.5 }],
      }),
      executeAtomic: async () => {
        throw new Error("invalid input must not dispatch");
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(defaultDryRunFailure.ok, false);
    assert.equal(defaultDryRunFailure.error.code, "FX_ASSIGNMENTS_ROW_ID_INVALID");
    assert.equal(defaultDryRunFailure.request.dry_run, true);
    assert.equal(Object.hasOwn(defaultDryRunFailure.error, "requested_dry_run"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(defaultDryRunFailure), { valid: true, errors: [] });

    const resolveFail = await executeAlpha3_2_5CControlMacro({
      request: request({
        mode: "exact_assignments",
        dry_run: false,
        assignments: [{ id: "res1", fx_ref: fxRef(1, 0), param_index: 0, normalized_value: 0.5 }],
      }),
      executeAtomic: async (child) => {
        if (child.id === "template.tracks.resolve_track_ref") {
          return execution(child.id, { track_ref: child.input.track_ref });
        }
        if (child.id === "template.fx.resolve_fx_ref") {
          return {
            ok: true,
            request: { id: child.id },
            verification: { status: "passed" },
            result: { refs: [], summary: {} },
          };
        }
        return execution(child.id, {});
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(resolveFail.ok, false);
    assert.equal(resolveFail.error.code, "FX_ASSIGNMENTS_RESOLVE_REF_REQUIRED");
  });

  it("uses discrete formatted truth and injectable mono timing", async () => {
    const rows = [{
      id: "discRow00001",
      fx_ref: fxRef(1, 0),
      param_index: 0,
      normalized_value: 1,
    }];
    const executor = makeExecutor({ discreteIndexes: new Set([0]) });
    const response = await executeAlpha3_2_5CControlMacro({
      request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.changes[0].status, "ok");

    let mono = 1000;
    const timed = await executeAlpha3_2_5CControlMacro({
      request: request({ mode: "exact_assignments", dry_run: false, assignments: rows }),
      monoNow: () => {
        mono += 7;
        return mono;
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(timed.ok, true);
    assert.equal(timed.execution.started_at.startsWith("2026-07-18T00:00:00"), true);
    assert.equal(timed.result.data.timings.total_ms > 0, true);
  });
});
