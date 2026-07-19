import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  ALPHA3_3_B1C_ITEMS_APPLY_MODES,
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
  executeAlpha3_3B1cItemsApplyMacro,
} from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import { createCallTemplateRuntime } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS } from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { OPENREAPER_PUBLIC_TOOL_IDS } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const BUDGET = Object.freeze({ max_response_bytes: 2_048, max_items: 8, max_inline_value_bytes: 256 });
const LONG_REQUEST_ID = "req-alpha34-d1-items-batch-fixture-30chars";
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function itemRef(n) {
  return `item:guid:{ITEM-${String(n).padStart(2, "0")}}`;
}
function takeRef(n) {
  return `take:guid:{TAKE-${String(n).padStart(2, "0")}}`;
}

function eightRows() {
  return Array.from({ length: 8 }, (_, index) => ({
    id: `r${String(index + 1).padStart(2, "0")}abcdefghij`.slice(0, 12),
    item_ref: itemRef(index + 1),
    take_ref: takeRef(index + 1),
    item: {
      volume_db: -3 - index,
      length_seconds: 2 + index * 0.1,
      fade_in_seconds: 0.01,
      fade_out_seconds: 0.05,
    },
    take: {
      volume_db: -6 - index,
      pan: -0.5 + index * 0.1,
      pitch_semitones: index,
      playrate: 1 + index * 0.05,
      preserve_pitch: index % 2 === 0,
    },
  }));
}

function summaryFor(row, overrides = {}) {
  return {
    item_ref: row.item_ref,
    active_take_ref: row.take_ref,
    volume_db: row.item?.volume_db ?? 0,
    length_seconds: row.item?.length_seconds ?? 2,
    fade_in_seconds: row.item?.fade_in_seconds ?? 0,
    fade_out_seconds: row.item?.fade_out_seconds ?? 0,
    snap_offset_seconds: row.item?.snap_offset_seconds ?? 0,
    take_volume_db: row.take?.volume_db ?? 0,
    take_pan: row.take?.pan ?? 0,
    take_pitch_semitones: row.take?.pitch_semitones ?? 0,
    playrate: row.take?.playrate ?? 1,
    preserve_pitch: row.take?.preserve_pitch ?? true,
    take_count: 1,
    ...overrides,
  };
}

function execution(id, readback, ok = true) {
  return {
    ok,
    request: { id },
    verification: { status: ok ? "passed" : "failed" },
    result: {
      readback,
      summary: readback,
      refs: Object.entries(readback)
        .filter(([key, value]) => key.endsWith("_ref") && typeof value === "string")
        .map(([key, ref]) => ({
          kind: key.slice(0, -4),
          ref,
          identity: { scheme: "guid", value: ref.slice(`${key.slice(0, -4)}:guid:`.length) },
        })),
    },
    ...(ok ? {} : { error: { code: "ATOMIC_FAILED", message: `${id} failed` } }),
  };
}

function fakeIndex({ fail = false } = {}) {
  return {
    calls: 0,
    status: () => ({ snapshot_id: "snapshot:d1", revision: "1" }),
    invalidateScopes({ scopes }) {
      this.calls += 1;
      return fail
        ? { ok: false, scopes, blockers: [{ code: "INDEX_WRITE_FAILED", message: "index failed", recoverable: true }] }
        : { ok: true, scopes };
    },
  };
}

function makeExecutor({
  rows,
  failMutationAt = null,
  mismatchField = null,
  initialOverrides = {},
}) {
  const calls = [];
  let mutationCount = 0;
  const state = new Map(rows.map((row) => [row.item_ref, summaryFor(row, {
    volume_db: 0,
    length_seconds: 8,
    fade_in_seconds: 0.2,
    fade_out_seconds: 0.2,
    snap_offset_seconds: 0,
    take_volume_db: 0,
    take_pan: 0,
    take_pitch_semitones: 0,
    playrate: 1,
    preserve_pitch: true,
    ...initialOverrides,
  })]));
  return {
    calls,
    state,
    executeAtomic: async (child) => {
      calls.push(child);
      if (child.id === "template.items.resolve_item_ref") {
        return execution(child.id, { item_ref: child.input.ref }, true);
      }
      if (child.id === "template.items.read_item_summary") {
        const item = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
        return execution(child.id, { ...state.get(item) }, true);
      }
      mutationCount += 1;
      if (failMutationAt !== null && mutationCount > failMutationAt) {
        return execution(child.id, {}, false);
      }
      const item = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
      const live = state.get(item);
      if (!live) return execution(child.id, {}, false);
      if (child.id === "template.items.set_item_volume") live.volume_db = child.input.volume_db;
      if (child.id === "template.items.trim_item") live.length_seconds = child.input.length_seconds;
      if (child.id === "template.items.set_item_fades") {
        live.fade_in_seconds = child.input.fade_in_seconds;
        live.fade_out_seconds = child.input.fade_out_seconds;
      }
      if (child.id === "template.items.set_item_snap_offset") live.snap_offset_seconds = child.input.snap_offset_seconds;
      if (child.id === "template.items.set_take_volume") live.take_volume_db = child.input.volume_db;
      if (child.id === "template.items.set_take_pan") live.take_pan = child.input.pan;
      if (child.id === "template.items.set_take_pitch") live.take_pitch_semitones = child.input.semitones;
      if (child.id === "template.items.set_take_playrate") {
        live.playrate = child.input.playrate;
        live.preserve_pitch = child.input.preserve_pitch;
      }
      if (mismatchField && mutationCount === 1) {
        if (mismatchField === "volume_db") live.volume_db = (live.volume_db ?? 0) + 10;
      }
      return execution(child.id, { item_ref: item, ...child.input, readback_status: "passed" }, true);
    },
  };
}

function request(input, budget = BUDGET) {
  return {
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input,
    refs: {},
    context: {
      request_id: LONG_REQUEST_ID,
      session_id: "d1-batch",
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

describe("Alpha3.4-D1 upper items batch set_item_take_controls", () => {
  it("keeps mode list and exact public counts 5/15/235/91", () => {
    assert.equal(ALPHA3_3_B1C_ITEMS_APPLY_MODES.includes("set_item_take_controls"), true);
    assert.equal(OPENREAPER_PUBLIC_TOOL_IDS.length, 5);
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 235);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT });
    validateBridgeHandlerRegistry({ cwd: ROOT, registry });
    assert.equal(registry.entries.length, 235);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.equal(countLua(path.join(ROOT, "reaper/bridge/src/handlers")), 91);
    assert.equal(ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.ids.includes(ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID), true);
  });

  it("fits five eight-row 2048-byte fixtures with fixed compact shapes", async () => {
    const rows = eightRows();
    const fixtures = {};
    assert.equal(LONG_REQUEST_ID.length >= 30, true);
    assert.equal(rows.every((row) => row.id.length === 12), true);
    assert.equal(rows.every((row) => Object.keys(row.item).length + Object.keys(row.take).length >= 4), true);

    {
      const executor = makeExecutor({ rows });
      const index = fakeIndex();
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, true, JSON.stringify(response));
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
      assert.equal(response.request.request_id, LONG_REQUEST_ID);
      assert.equal(response.macro.program_id, "openreaper.macro.items.apply");
      assert.equal(response.sqlite.used, true);
      assert.equal(response.sqlite.source, "warm_index");
      assert.equal(response.result.changes.length, 8);
      assert.equal(response.result.changes.every((row) => row.status === "ok"), true);
      assert.equal(response.result.data.calls.index, 1);
      assert.equal(index.calls, 1);
      assert.equal(response.result.data.calls.total, response.result.data.calls.resolve
        + response.result.data.calls.preflight
        + response.result.data.calls.mutation
        + response.result.data.calls.readback
        + response.result.data.calls.index);
      const plannedOps = rows.length * 7;
      assert.equal(plannedOps, 56);
      assert.equal(response.result.data.calls.mutation, 56);
      assert.equal(response.result.data.calls.readback, 8);
      assert.equal(response.result.data.calls.resolve, 8);
      assert.equal(response.result.data.calls.preflight, 8);
      assert.equal(response.execution.stage_count, 0);
      assert.deepEqual(response.execution.stages, []);
      assert.equal(Object.keys(response.result.changes[0]).every((key) => ["id", "status", "mutation", "readback", "index", "code", "fields"].includes(key)), true);
      assert.deepEqual(Object.keys(response.result.data).sort(), ["calls", "mode", "timings"]);
      fixtures.success = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.success <= 2048, true, `success bytes=${fixtures.success}`);
    }

    {
      const executor = makeExecutor({ rows });
      const index = fakeIndex();
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", changes: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, true);
      assert.equal(response.execution.status, "dry_run_completed");
      assert.equal(response.result.data.calls.mutation, 0);
      assert.equal(response.result.data.calls.readback, 0);
      assert.equal(response.result.data.calls.index, 0);
      assert.equal(index.calls, 0);
      assert.equal(response.result.data.calls.preflight, 8);
      assert.equal(response.result.changes.every((row) => row.status === "plan"), true);
      assert.equal(executor.calls.every((call) => !String(call.id).includes("set_")), true);
      fixtures.dry_run = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.dry_run <= 2048, true, `dry_run bytes=${fixtures.dry_run}`);
    }

    {
      const calls = [];
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({
          mode: "set_item_take_controls",
          dry_run: false,
          changes: rows,
          target_refs: [itemRef(1)],
        }),
        executeAtomic: async (child) => {
          calls.push(child);
          return execution(child.id, {});
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false);
      assert.equal(response.error.code, "ITEM_APPLY_BATCH_FIELDS_INVALID");
      assert.equal(calls.length, 0);
      fixtures.blocker = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.blocker <= 2048, true, `blocker bytes=${fixtures.blocker}`);
    }

    {
      const executor = makeExecutor({ rows, failMutationAt: 7 });
      const index = fakeIndex();
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, false, JSON.stringify(response));
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.result.changes.length, 8);
      assert.equal(response.result.changes[0].status, "ok");
      assert.equal(["fail", "rbf", "unk"].includes(response.result.changes[1].status), true);
      assert.equal(response.result.changes.slice(2).every((row) => row.status === "skip"), true);
      assert.equal(response.result.changes.slice(2).every((row) => row.mutation === "skip" && row.readback === "skip" && row.index === "skip"), true);
      assert.equal(index.calls, 1);
      assert.equal(response.result.data.calls.index, 1);
      assert.equal(response.result.data.calls.readback >= 1, true);
      fixtures.partial = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.partial <= 2048, true, `partial bytes=${fixtures.partial}`);
    }

    {
      const executor = makeExecutor({ rows });
      const index = fakeIndex({ fail: true });
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
        executeAtomic: executor.executeAtomic,
        projectIndexRuntime: index,
      });
      assert.equal(response.ok, false);
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.macro.program_id, "openreaper.macro.items.apply");
      assert.equal(response.sqlite.used, true);
      assert.equal(response.sqlite.source, "warm_index");
      assert.equal(response.result.changes.every((row) => row.status === "ok"), true);
      assert.equal(response.result.changes.every((row) => row.index === "fail"), true);
      assert.equal(index.calls, 1);
      fixtures.index_failure = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.index_failure <= 2048, true, `index_failure bytes=${fixtures.index_failure}`);
    }

    {
      // Pressure: long atomic error text + multi-field final mismatch; never drop code/fields.
      const executor = makeExecutor({ rows });
      let mutationCount = 0;
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
        executeAtomic: async (child) => {
          if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
          if (child.id === "template.items.read_item_summary") {
            const item = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
            if (mutationCount === 0) {
              return execution(child.id, summaryFor(rows.find((row) => row.item_ref === item), {
                volume_db: 0, length_seconds: 8, fade_in_seconds: 0.2, fade_out_seconds: 0.2,
                take_volume_db: 0, take_pan: 0, take_pitch_semitones: 0, playrate: 1, preserve_pitch: true,
              }));
            }
            return execution(child.id, summaryFor(rows[0], {
              volume_db: 9,
              length_seconds: 99,
              fade_in_seconds: 9,
              take_pan: 0.9,
              playrate: 9,
            }));
          }
          mutationCount += 1;
          return {
            ok: true,
            request: { id: child.id },
            verification: { status: "passed" },
            result: {
              readback: { item_ref: child.refs?.item_ref?.ref ?? child.refs?.item_ref, ...child.input, note: "N".repeat(180) },
              summary: { item_ref: child.refs?.item_ref?.ref ?? child.refs?.item_ref, ...child.input },
              refs: [],
            },
            error: null,
          };
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false);
      assert.equal(response.request.request_id, LONG_REQUEST_ID);
      assert.equal(response.macro.program_id, "openreaper.macro.items.apply");
      assert.equal(response.result.changes.length, 8);
      assert.equal(response.result.changes[0].id, rows[0].id);
      assert.equal(typeof response.result.changes[0].code, "string");
      assert.equal(Array.isArray(response.result.changes[0].fields), true);
      assert.equal(response.result.changes[0].fields.length >= 1, true);
      fixtures.pressure = Buffer.byteLength(JSON.stringify(response), "utf8");
      assert.equal(fixtures.pressure <= 2048, true, `pressure bytes=${fixtures.pressure}`);
    }

    globalThis.__OPENREAPER_D1_BATCH_BYTES__ = fixtures;
  });

  it("zero-writes whole-batch blockers for invalid shapes and take identity", async () => {
    const rows = eightRows();
    const cases = [
      {
        name: "duplicate ids",
        input: { mode: "set_item_take_controls", dry_run: false, changes: [rows[0], { ...rows[1], id: rows[0].id }] },
        code: "ITEM_APPLY_BATCH_ROW_ID_DUPLICATE",
      },
      {
        name: "duplicate item refs",
        input: { mode: "set_item_take_controls", dry_run: false, changes: [rows[0], { ...rows[1], item_ref: rows[0].item_ref, id: "dupItem" }] },
        code: "ITEM_APPLY_BATCH_ITEM_DUPLICATE",
      },
      {
        name: "unknown item field",
        input: {
          mode: "set_item_take_controls",
          dry_run: false,
          changes: [{ id: "badField", item_ref: itemRef(1), item: { volume_db: -1, pan: 0.1 } }],
        },
        code: "ITEM_APPLY_BATCH_ITEM_FIELDS_INVALID",
      },
      {
        name: "old mode properties mixed",
        input: {
          mode: "set_item_take_controls",
          dry_run: false,
          changes: [rows[0]],
          properties: { muted: true },
        },
        code: "ITEM_APPLY_BATCH_FIELDS_INVALID",
      },
      {
        name: "snap beyond final length",
        input: {
          mode: "set_item_take_controls",
          dry_run: false,
          changes: [{
            id: "snapBad",
            item_ref: itemRef(1),
            item: { length_seconds: 1, snap_offset_seconds: 2 },
          }],
        },
        code: "ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM",
      },
    ];
    for (const entry of cases) {
      const calls = [];
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request(entry.input),
        executeAtomic: async (child) => {
          calls.push(child);
          if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
          if (child.id === "template.items.read_item_summary") {
            return execution(child.id, summaryFor({ item_ref: child.refs.item_ref.ref, take_ref: takeRef(1) }, { length_seconds: 1 }));
          }
          return execution(child.id, {});
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false, entry.name);
      assert.equal(response.error.code, entry.code, entry.name);
      assert.equal(calls.some((call) => String(call.id).includes("set_") || String(call.id).includes("trim_")), false, entry.name);
    }

    const stale = eightRows();
    stale[0].take_ref = takeRef(99);
    const staleCalls = [];
    const staleResponse = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: stale }),
      executeAtomic: async (child) => {
        staleCalls.push(child);
        if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
        if (child.id === "template.items.read_item_summary") {
          const item = child.refs.item_ref.ref;
          const row = stale.find((entry) => entry.item_ref === item);
          return execution(child.id, summaryFor({ ...row, take_ref: takeRef(1) }));
        }
        return execution(child.id, {});
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(staleResponse.ok, false);
    assert.equal(staleResponse.error.code, "ITEM_APPLY_TAKE_IDENTITY_MISMATCH");
    assert.equal(staleCalls.some((call) => String(call.id).startsWith("template.items.set_")), false);
  });

  it("uses deterministic atom order and omission-preserving fade/playback pairing", async () => {
    const row = {
      id: "orderRow0001",
      item_ref: itemRef(1),
      take_ref: takeRef(1),
      item: { volume_db: -2, length_seconds: 3, fade_in_seconds: 0.03, snap_offset_seconds: 0.1 },
      take: { volume_db: -4, pan: 0.2, pitch_semitones: 1, playrate: 1.5 },
    };
    const executor = makeExecutor({
      rows: [row],
      initialOverrides: {
        fade_in_seconds: 0.4,
        fade_out_seconds: 0.7,
        playrate: 0.9,
        preserve_pitch: false,
      },
    });
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: [row] }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    const mutationIds = executor.calls
      .filter((call) => !["template.items.resolve_item_ref", "template.items.read_item_summary"].includes(call.id))
      .map((call) => call.id);
    assert.deepEqual(mutationIds, [
      "template.items.set_item_volume",
      "template.items.trim_item",
      "template.items.set_item_fades",
      "template.items.set_item_snap_offset",
      "template.items.set_take_volume",
      "template.items.set_take_pan",
      "template.items.set_take_pitch",
      "template.items.set_take_playrate",
    ]);
    const fades = executor.calls.find((call) => call.id === "template.items.set_item_fades");
    assert.equal(fades.input.fade_in_seconds, 0.03);
    assert.equal(fades.input.fade_out_seconds, 0.7);
    const playback = executor.calls.find((call) => call.id === "template.items.set_take_playrate");
    assert.equal(playback.input.playrate, 1.5);
    assert.equal(playback.input.preserve_pitch, false);
    assert.equal(response.result.data.calls.readback, 1);
  });

  it("counts real runAtomic dispatches not planned ops and applies POSITION_TOLERANCE", async () => {
    const rows = eightRows().slice(0, 2);
    const executor = makeExecutor({ rows, failMutationAt: 2 });
    const index = fakeIndex();
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: index,
    });
    assert.equal(response.ok, false);
    const plannedOps = rows.length * 7;
    assert.equal(plannedOps, 14);
    assert.equal(response.result.data.calls.mutation < plannedOps, true);
    assert.equal(response.result.data.calls.mutation, 3);
    assert.equal(response.result.data.calls.index, index.calls);
    assert.equal(index.calls <= 1, true);
    assert.equal(
      response.result.data.calls.total,
      response.result.data.calls.resolve
        + response.result.data.calls.preflight
        + response.result.data.calls.mutation
        + response.result.data.calls.readback
        + response.result.data.calls.index,
    );

    const tolRows = [{ id: "tolRow000001", item_ref: itemRef(1), item: { volume_db: -3 } }];
    let mutated = false;
    const within = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: tolRows }),
      executeAtomic: async (child) => {
        if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
        if (child.id === "template.items.read_item_summary") {
          if (!mutated) return execution(child.id, summaryFor(tolRows[0], { volume_db: 0, length_seconds: 2 }));
          return execution(child.id, summaryFor(tolRows[0], { volume_db: -3 + 5e-7, length_seconds: 2 }));
        }
        mutated = true;
        return execution(child.id, { item_ref: tolRows[0].item_ref, volume_db: -3, readback_status: "passed" });
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(within.ok, true, JSON.stringify(within));
    assert.equal(within.result.changes[0].status, "ok");
    assert.equal(within.result.data.calls.mutation, 1);
    assert.equal(within.result.data.calls.total, 5);

    let mutated2 = false;
    const beyond = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: tolRows }),
      executeAtomic: async (child) => {
        if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
        if (child.id === "template.items.read_item_summary") {
          if (!mutated2) return execution(child.id, summaryFor(tolRows[0], { volume_db: 0, length_seconds: 2 }));
          return execution(child.id, summaryFor(tolRows[0], { volume_db: -3 + 0.000002, length_seconds: 2 }));
        }
        mutated2 = true;
        return execution(child.id, { item_ref: tolRows[0].item_ref, volume_db: -3, readback_status: "passed" });
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(beyond.ok, false);
    assert.equal(beyond.error.code, "ITEM_APPLY_READBACK_MISMATCH");
  });

  it("fails closed for missing fade/playback counterparts and non-authoritative resolve refs", async () => {
    const cases = [
      {
        name: "missing fade counterpart",
        changes: [{ id: "pairRow00001", item_ref: itemRef(1), item: { fade_in_seconds: 0.02 } }],
        summary: summaryFor({ item_ref: itemRef(1), take_ref: takeRef(1) }, { fade_in_seconds: 0.1, fade_out_seconds: null, length_seconds: 2 }),
        code: "ITEM_APPLY_FADE_COUNTERPART_INVALID",
      },
      {
        name: "missing preserve_pitch counterpart",
        changes: [{ id: "pairRow00002", item_ref: itemRef(1), take_ref: takeRef(1), take: { playrate: 1.25 } }],
        summary: summaryFor({ item_ref: itemRef(1), take_ref: takeRef(1) }, { playrate: 1, preserve_pitch: "yes", length_seconds: 2 }),
        code: "ITEM_APPLY_PLAYBACK_COUNTERPART_INVALID",
      },
      {
        name: "missing playrate counterpart",
        changes: [{ id: "pairRow00003", item_ref: itemRef(1), take_ref: takeRef(1), take: { preserve_pitch: true } }],
        summary: summaryFor({ item_ref: itemRef(1), take_ref: takeRef(1) }, { playrate: Number.NaN, preserve_pitch: true, length_seconds: 2 }),
        code: "ITEM_APPLY_PLAYBACK_COUNTERPART_INVALID",
      },
    ];
    for (const entry of cases) {
      const calls = [];
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: entry.changes }),
        executeAtomic: async (child) => {
          calls.push(child);
          if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
          if (child.id === "template.items.read_item_summary") return execution(child.id, entry.summary);
          return execution(child.id, {});
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false, entry.name);
      assert.equal(response.error.code, entry.code, entry.name);
      assert.equal(calls.some((call) => String(call.id).includes("set_") || String(call.id).includes("trim_")), false, entry.name);
      assert.equal(response.result.data.calls.mutation, 0, entry.name);
      assert.equal(response.result.data.calls.readback, 0, entry.name);
      assert.equal(response.result.data.calls.index, 0, entry.name);
    }

    const resolveCases = [
      { name: "missing ref", refs: [] },
      { name: "wrong kind", refs: [{ kind: "track", ref: "track:guid:{T1}", identity: { scheme: "guid", value: "{T1}" } }] },
      { name: "malformed identity", refs: [{ kind: "item", ref: itemRef(1), identity: { scheme: "index", value: "{ITEM-01}" } }] },
      { name: "identity value mismatch", refs: [{ kind: "item", ref: itemRef(1), identity: { scheme: "guid", value: "{ITEM-99}" } }] },
      { name: "mismatched ref", refs: [{ kind: "item", ref: itemRef(2), identity: { scheme: "guid", value: "{ITEM-02}" } }] },
    ];
    for (const entry of resolveCases) {
      const calls = [];
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({
          mode: "set_item_take_controls",
          dry_run: false,
          changes: [{ id: "resRow000001", item_ref: itemRef(1), item: { volume_db: -1 } }],
        }),
        executeAtomic: async (child) => {
          calls.push(child);
          if (child.id === "template.items.resolve_item_ref") {
            return {
              ok: true,
              request: { id: child.id },
              verification: { status: "passed" },
              result: { readback: {}, summary: {}, refs: entry.refs },
            };
          }
          return execution(child.id, {});
        },
        projectIndexRuntime: fakeIndex(),
      });
      assert.equal(response.ok, false, entry.name);
      assert.equal(
        ["ITEM_APPLY_RESOLVE_REF_REQUIRED", "ITEM_APPLY_ITEM_IDENTITY_MISMATCH"].includes(response.error.code),
        true,
        `${entry.name}:${response.error.code}`,
      );
      assert.equal(calls.some((call) => call.id === "template.items.read_item_summary"), false, entry.name);
      assert.equal(calls.some((call) => String(call.id).includes("set_")), false, entry.name);
    }
  });

  it("uses injectable monotonic timing separate from wall clock", async () => {
    const rows = [{ id: "timeRow00001", item_ref: itemRef(1), item: { volume_db: -2 } }];
    let mono = 1000;
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
      monoNow: () => {
        mono += 5;
        return mono;
      },
      now: () => new Date("2026-07-18T00:00:00.000Z"),
      executeAtomic: async (child) => {
        if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
        if (child.id === "template.items.read_item_summary") {
          return execution(child.id, summaryFor(rows[0], { volume_db: child.id.includes("read") ? -2 : 0, length_seconds: 2 }));
        }
        return execution(child.id, { item_ref: rows[0].item_ref, volume_db: -2, readback_status: "passed" });
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.started_at.startsWith("2026-07-18T00:00:00"), true);
    assert.equal(response.result.data.timings.total_ms > 0, true);
    assert.equal(response.result.data.timings.target_resolution_ms >= 0, true);
  });

  it("marks applied only from final comprehensive readback and keeps old modes", async () => {
    const rows = [{
      id: "mismatchRow1",
      item_ref: itemRef(1),
      item: { volume_db: -5 },
    }];
    const executor = makeExecutor({ rows, mismatchField: "volume_db" });
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: rows }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "ITEM_APPLY_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "rbf");
    assert.equal(response.result.data.calls.readback, 1);
    assert.equal(response.result.data.calls.mutation, 1);

    const dryOnlyItem = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_item_take_controls",
        dry_run: true,
        changes: [{ id: "onlyItem", item_ref: itemRef(1), item: { volume_db: -1 } }],
      }),
      executeAtomic: async (child) => {
        if (child.id === "template.items.resolve_item_ref") return execution(child.id, { item_ref: child.input.ref });
        if (child.id === "template.items.read_item_summary") {
          return execution(child.id, summaryFor({ item_ref: itemRef(1), take_ref: takeRef(1) }, { volume_db: 0, length_seconds: 2 }));
        }
        return execution(child.id, {});
      },
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(dryOnlyItem.ok, true);
    assert.equal(dryOnlyItem.execution.status, "dry_run_completed");

    const warmRows = eightRows().slice(0, 2);
    const warmExecutor = makeExecutor({ rows: warmRows });
    const first = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: warmRows }),
      executeAtomic: warmExecutor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    const second = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: warmRows }),
      executeAtomic: warmExecutor.executeAtomic,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.result.data.calls.preflight, 2);
    assert.equal(second.result.data.calls.preflight, 2);
    assert.equal(typeof first.result.data.timings.total_ms, "number");
    assert.equal(typeof second.result.data.timings.mutation_ms, "number");

    const runtime = createCallTemplateRuntime();
    assert.equal(typeof runtime.call_template, "function");
  });
});
