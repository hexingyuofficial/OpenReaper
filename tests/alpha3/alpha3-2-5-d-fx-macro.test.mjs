import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
  createAlpha3_2_5DNativeFxMacroDiscoveryItems,
  executeAlpha3_2_5DNativeFxMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import { STOCK_SEMANTIC_UNIT_UNPROVEN } from "../../packages/mcp-server/src/alpha3-4-c-fx-semantic-truth-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const NOW = "2026-07-12T10:00:00.000Z";
const TRACK_REF = "track:guid:{TRACK-A}";
const FX_REF = `fx:${TRACK_REF}:0`;
const TAKE_REF = "take:guid:{TAKE-A}";

describe("Alpha3.2.5-D native FX Macro", () => {
  it("registers and discovers one executable ReaComp task program", () => {
    assert.deepEqual(ALPHA3_2_5_D_NATIVE_FX_REGISTRY.ids, [ALPHA3_2_5_D_NATIVE_FX_MACRO_ID]);
    const entry = ALPHA3_2_5_D_NATIVE_FX_REGISTRY.get(ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.dependencies.template_ids.includes("template.fx.add_track_fx"), true);
    assert.equal(entry.dependencies.template_ids.includes("template.fx.search_installed_fx"), true);
    assert.equal(entry.dependencies.template_ids.includes("template.fx.add_take_fx"), true);
    assert.equal(entry.dependencies.template_ids.includes("template.fx.reorder_fx"), true);
    assert.equal(entry.dependencies.runtime_capabilities.includes("stock_plugin.semantic_parameter_program.v1"), true);

    const [item] = createAlpha3_2_5DNativeFxMacroDiscoveryItems({ liveRunnableNow: true });
    assert.equal(item.id, ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.live_runnable_now, true);
    assert.deepEqual(item.inputSchema.properties.plugin.enum, ["reacomp"]);
    assert.equal(item.inputSchema.properties.chain.maxItems, 8);
  });

  it("defaults the canonical bounded chain to dry-run after exact installed-inventory search", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [
            { plugin_query: "ReaEQ", duplicate_policy: "reuse_exact" },
            { plugin_name: "VST: ReaComp (Cockos)", enabled: false },
          ],
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.equal(result.request.dry_run, true);
    assert.deepEqual(result.result.data.planned_chain.map((row) => row.plugin_name), [
      "VST: ReaEQ (Cockos)",
      "VST: ReaComp (Cockos)",
    ]);
    assert.equal(bridge.writes.length, 0);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.list_track_fx_chain",
      "template.fx.search_installed_fx",
      "template.fx.search_installed_fx",
    ]);
    assert.equal(result.result.changes.every((change) => change.status === "planned"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "not_run"), true);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("applies a bounded ordered Track chain with duplicate, preset, bypass, reorder, and final complete readback", async () => {
    const bridge = chainAtomic({
      initial: [{ name: "VST: ReaEQ (Cockos)", enabled: true }],
    });
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          owner_kind: "track",
          chain: [
            { plugin_name: "VST: ReaEQ (Cockos)", duplicate_policy: "reuse_exact", preset_index: 0 },
            { plugin_query: "ReaComp", duplicate_policy: "allow", enabled: false, target_index: 0 },
          ],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: indexRuntime(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "completed");
    assert.deepEqual(bridge.writes.map((call) => call.id), [
      "template.fx.set_fx_preset_by_index",
      "template.fx.add_track_fx",
      "template.fx.set_fx_bypass",
      "template.fx.reorder_fx",
    ]);
    assert.deepEqual(result.result.data.final_chain.fx.map((row) => row.name), [
      "VST: ReaComp (Cockos)",
      "VST: ReaEQ (Cockos)",
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied", "applied"]);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "completed"), true);
    assert.deepEqual(invalidations, [["fx"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("targets an exact Take without touching selection and verifies its final chain", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          owner_kind: "take",
          chain: [{ plugin_name: "VST: ReaEQ (Cockos)" }],
          dry_run: false,
        },
        refs: { take_ref: TAKE_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.writes.map((call) => call.id), ["template.fx.add_take_fx"]);
    assert.equal(bridge.calls.some((call) => call.id.includes("selected")), false);
    const takeCalls = bridge.calls.filter((call) => call.refs?.take_ref !== undefined);
    assert.equal(takeCalls.length > 0, true);
    assert.equal(takeCalls.every((call) => {
      const takeRef = call.refs?.take_ref;
      return takeRef?.kind === "take"
        && takeRef.ref === TAKE_REF
        && takeRef.identity?.scheme === "guid"
        && takeRef.identity.value === TAKE_REF.slice("take:guid:".length);
    }), true);
    assert.equal(result.result.data.owner_ref, TAKE_REF);
    assert.equal(result.result.data.final_chain.fx[0].fx_ref, `fx:${TAKE_REF}:0`);
  });

  it("blocks unproven chain controls before a write request mutates or exposes a new FX ref", async () => {
    const bridge = chainAtomic();
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{ plugin_name: "VST: ReaComp (Cockos)", controls: { threshold_db: -18 } }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: indexRuntime(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, ["threshold_db"]);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(result.result.canonical_refs.filter((ref) => ref.startsWith("fx:")), []);
    assert.deepEqual(bridge.writes, []);
    assert.deepEqual(invalidations, []);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.list_track_fx_chain",
      "template.fx.search_installed_fx",
    ]);
    assert.equal(result.recovery.partial_changes_possible, false);
    assert.equal(result.recovery.next_call.arguments.id, "macro.fx.apply_chain");
    assert.equal(Object.hasOwn(result.recovery.next_call.arguments.input.chain[0], "controls"), false);
    assert.equal(JSON.stringify(result.recovery.next_call).includes("fx:"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("blocks an unproven starter-action-only node before any chain mutation", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{
            plugin_name: "VST: ReaComp (Cockos)",
            starter_action: "gentle_vocal_compression",
          }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ]);
    assert.deepEqual(result.result.data.semantic_fields, ["starter_action"]);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
    assert.equal(Object.hasOwn(result.recovery.next_call.arguments.input.chain[0], "starter_action"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("applies the same semantic proof gate to chain dry-run", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{ plugin_query: "ReaComp", controls: { ratio: 3 } }],
          dry_run: true,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, ["ratio"]);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
    assert.equal(result.recovery.partial_changes_possible, false);
  });

  it("continues a controls-bearing chain dry-run when semantic proof succeeds", async () => {
    const bridge = chainAtomic();
    const proofCalls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{ plugin_query: "ReaComp", controls: { ratio: 3 } }],
          dry_run: true,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      semanticProofChecker: (pluginId, controlIds) => {
        proofCalls.push([pluginId, [...controlIds]]);
        return { ok: true, unproven: [] };
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.deepEqual(proofCalls, [["reacomp", ["ratio"]]]);
    assert.deepEqual(bridge.writes, []);
    assert.deepEqual(result.result.data.planned_chain.map((row) => row.plugin_name), [
      "VST: ReaComp (Cockos)",
    ]);
    assert.equal(result.result.changes.every((change) => change.status === "planned"), true);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("preflights a later unproven controls node before mutating an earlier node", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [
            { plugin_name: "VST: ReaEQ (Cockos)", enabled: false },
            { plugin_name: "VST: ReaComp (Cockos)", controls: { release_ms: 100 } },
          ],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.equal(result.result.data.chain_index, 1);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.list_track_fx_chain",
      "template.fx.search_installed_fx",
      "template.fx.search_installed_fx",
    ]);
  });

  it("preflights a later starter-action-only node before mutating an earlier node", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [
            { plugin_name: "VST: ReaEQ (Cockos)", enabled: false },
            {
              plugin_name: "VST: ReaComp (Cockos)",
              starter_action: "gentle_vocal_compression",
            },
          ],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.equal(result.result.data.chain_index, 1);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
  });

  it("rejects non-ReaComp initial semantic controls before any chain mutation", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{ plugin_name: "VST: ReaEQ (Cockos)", controls: { low_mid_gain_db: 2 } }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "FX_CHAIN_INITIAL_CONTROLS_UNSUPPORTED");
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
    assert.equal(result.recovery.partial_changes_possible, false);
  });

  it("uses the real C semantic executor after whole-chain proof succeeds", async () => {
    const bridge = chainAtomic();
    const invalidations = [];
    const proofCalls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{
            plugin_name: "VST: ReaComp (Cockos)",
            controls: { threshold_db: -18, ratio: 3 },
          }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: indexRuntime(invalidations),
      semanticProofChecker: (pluginId, controlIds) => {
        proofCalls.push([pluginId, [...controlIds]]);
        return { ok: true, unproven: [] };
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "completed");
    assert.deepEqual(proofCalls, [
      ["reacomp", ["threshold_db", "ratio"]],
      ["reacomp", ["threshold_db", "ratio"]],
    ]);
    assert.deepEqual(bridge.writes.map((call) => call.id), [
      "template.fx.add_track_fx",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
    ]);
    assert.equal(bridge.calls.filter((call) => call.id === "template.fx.read_fx_parameter").length, 2);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.deepEqual(invalidations, [["fx"], ["fx"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("executes a proven starter action with overrides through C and verifies every live readback", async () => {
    const bridge = chainAtomic({ parameterRows: completeReaCompParameterRows() });
    const invalidations = [];
    const proofCalls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{
            plugin_name: "VST: ReaComp (Cockos)",
            starter_action: "gentle_vocal_compression",
            control_overrides: { ratio: 4 },
          }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: indexRuntime(invalidations),
      semanticProofChecker: (pluginId, controlIds) => {
        proofCalls.push([pluginId, [...controlIds]]);
        return { ok: true, unproven: [] };
      },
      now: () => new Date(NOW),
    });

    const expectedControls = [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ];
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(proofCalls, [
      ["reacomp", expectedControls],
      ["reacomp", expectedControls],
    ]);
    assert.deepEqual(bridge.writes.map((call) => call.id), [
      "template.fx.add_track_fx",
      ...Array.from({ length: 5 }, () => "template.fx.set_fx_parameter_normalized"),
    ]);
    const ratioWrite = bridge.writes.find((call) =>
      call.id === "template.fx.set_fx_parameter_normalized" && call.input.param_index === 1);
    assert.equal(ratioWrite.input.normalized_value, 0.157895);
    assert.equal(bridge.calls.filter((call) => call.id === "template.fx.read_fx_parameter").length, 5);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.deepEqual(invalidations, [["fx"], ["fx"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("rejects action parameters without a starter action instead of silently ignoring them", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{
            plugin_name: "VST: ReaComp (Cockos)",
            action_parameters: { tempo_bpm: 120 },
          }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      semanticProofChecker: () => {
        throw new Error("invalid semantic intent must not reach proof");
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "CONTROL_FIELDS_REQUIRED");
    assert.deepEqual(result.result.data.semantic_fields, ["action_parameters"]);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
  });

  it("rejects an explicitly empty semantic field instead of degrading to a plain FX add", async () => {
    const bridge = chainAtomic();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          chain: [{ plugin_name: "VST: ReaComp (Cockos)", controls: {} }],
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, "CONTROL_FIELDS_REQUIRED");
    assert.deepEqual(result.result.data.semantic_fields, ["controls"]);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(bridge.writes, []);
  });

  it("fails closed on incomplete inventory or chain coverage and never treats dispatch as applied", async () => {
    for (const options of [
      { inventoryTruncated: true },
      { finalChainTruncated: true },
      { finalNameMismatch: true },
    ]) {
      const bridge = chainAtomic(options);
      const result = await executeAlpha3_2_5DNativeFxMacro({
        request: {
          id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
          input: { chain: [{ plugin_name: "VST: ReaEQ (Cockos)" }], dry_run: false },
          refs: { track_ref: TRACK_REF },
        },
        executeAtomic: bridge.executeAtomic,
        projectIndexRuntime: indexRuntime([]),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.result.changes.every((change) => change.status !== "applied"), true);
      if (bridge.writes.length > 0) {
        assert.equal(result.execution.status, "partial_failure");
        assert.equal(result.result.changes.some((change) => change.mutation.status === "completed"), true);
      } else {
        assert.equal(result.execution.status, "blocked");
      }
    }
  });

  it("rejects malformed bounded-chain requests before any live call", async () => {
    const invalidInputs = [
      { chain: [] },
      { owner_kind: "master", chain: [{ plugin_query: "ReaEQ" }] },
      { chain: [{ plugin_name: "ReaEQ", plugin_query: "ReaEQ" }] },
      { chain: [{ plugin_query: "ReaEQ", duplicate_policy: "maybe" }] },
      { chain: [{ plugin_query: "ReaEQ", preset_name: "A", preset_index: 0 }] },
      { chain: [{ plugin_query: "ReaEQ", enabled: "yes" }] },
      { chain: [{ plugin_query: "ReaComp", starter_action: "" }] },
      { chain: [{ plugin_query: "ReaComp", action_parameters: [] }] },
      { chain: Array.from({ length: 9 }, () => ({ plugin_query: "ReaEQ" })) },
    ];
    for (const input of invalidInputs) {
      const calls = [];
      const result = await executeAlpha3_2_5DNativeFxMacro({
        request: { id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID, input, refs: { track_ref: TRACK_REF } },
        executeAtomic: async (request) => {
          calls.push(request);
          throw new Error("must not dispatch");
        },
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "blocked");
      assert.equal(calls.length, 0);
    }
  });

  it("reports an unavailable executor before evaluating semantic proof", async () => {
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      semanticProofChecker: () => {
        throw new Error("semantic proof must not run without an atomic executor");
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "NATIVE_FX_EXECUTOR_UNAVAILABLE");
    assert.deepEqual(result.result.changes, []);
    assert.equal(result.recovery.partial_changes_possible, false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("rejects malformed and empty legacy semantic input without default-starter fallback", async () => {
    for (const [input, expectedCode] of [
      [{ controls: "bad" }, "NATIVE_FX_SEMANTIC_FIELD_INVALID"],
      [{ controls: {} }, "CONTROL_FIELDS_REQUIRED"],
      [{ action_parameters: {} }, "CONTROL_FIELDS_REQUIRED"],
      [{ control_overrides: {} }, "CONTROL_FIELDS_REQUIRED"],
    ]) {
      const calls = [];
      let proofCalls = 0;
      const result = await executeAlpha3_2_5DNativeFxMacro({
        request: {
          id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
          input,
          refs: { track_ref: TRACK_REF },
        },
        executeAtomic: async (request) => {
          calls.push(request);
          throw new Error("invalid semantic input must not dispatch");
        },
        semanticProofChecker: () => {
          proofCalls += 1;
          throw new Error("invalid semantic input must not reach proof");
        },
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, expectedCode);
      assert.deepEqual(calls, []);
      assert.equal(proofCalls, 0);
      assert.deepEqual(result.result.changes, []);
    }
  });

  it("blocks the default gentle ReaComp controls before live track resolution", async () => {
    const calls = [];
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { insert_at_index: 2, dry_run: true },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map()),
      projectIndexRuntime: indexRuntime(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ]);
    assert.deepEqual(calls, []);
    assert.deepEqual(invalidations, []);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(result.result.canonical_refs, []);
    assert.equal(result.recovery.partial_changes_possible, false);
    assert.equal(result.result.data.next_call.arguments.id, "macro.fx.apply_chain");
    assert.deepEqual(result.result.data.next_call.arguments.refs, { track_ref: TRACK_REF });
    assert.deepEqual(result.result.data.next_call.arguments.input.chain, [{
      plugin_query: "ReaComp",
      duplicate_policy: "allow",
      insert_at_index: 2,
    }]);
    assert.equal(JSON.stringify(result.result.data.next_call).includes("DRY-RUN"), false);
    assert.equal(JSON.stringify(result.result.data.next_call).includes("fx:"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("continues the legacy dry-run when every resolved starter control is proven", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { dry_run: true },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map()),
      semanticProofChecker: (pluginId, controlIds) => {
        assert.equal(pluginId, "reacomp");
        assert.deepEqual(controlIds, [
          "threshold_db",
          "ratio",
          "attack_ms",
          "release_ms",
          "wet_mix_percent",
        ]);
        return { ok: true, unproven: [] };
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.deepEqual(calls.map((call) => call.id), ["template.tracks.resolve_track_ref"]);
    assert.equal(result.result.data.starter_action, "gentle_vocal_compression");
    assert.equal(result.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("blocks explicit ReaComp controls with zero mutation and an executable chain recovery", async () => {
    const calls = [];
    const values = new Map();
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          controls: { threshold_db: -18, ratio: 3 },
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
        context: { request_id: "fx-d-1", session_id: "fx-d", request_sequence: 1 },
      },
      executeAtomic: fxAtomic(calls, values),
      projectIndexRuntime: indexRuntime(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, ["threshold_db", "ratio"]);
    assert.deepEqual(calls, []);
    assert.deepEqual(invalidations, []);
    assert.deepEqual(result.result.changes, []);
    assert.deepEqual(result.result.canonical_refs, []);
    assert.equal(result.result.verification.status, "not_required");
    assert.equal(result.recovery.partial_changes_possible, false);
    assert.deepEqual(result.recovery.next_call, result.result.data.next_call);
    assert.equal(result.recovery.next_call.arguments.id, "macro.fx.apply_chain");
    assert.deepEqual(result.recovery.next_call.arguments.input.chain, [{
      plugin_query: "ReaComp",
      duplicate_policy: "allow",
    }]);
    assert.equal(Object.hasOwn(result.recovery.next_call.arguments.input, "controls"), false);
    assert.equal(JSON.stringify(result.recovery.next_call).includes("fx:"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("continues legacy add, configure, readback, and index maintenance when controls are proven", async () => {
    const calls = [];
    const values = new Map();
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          controls: { threshold_db: -18, ratio: 3 },
          dry_run: false,
        },
        refs: { track_ref: TRACK_REF },
        context: { request_id: "fx-d-proof-ok", session_id: "fx-d", request_sequence: 2 },
      },
      executeAtomic: fxAtomic(calls, values),
      projectIndexRuntime: indexRuntime(invalidations),
      semanticProofChecker: (pluginId, controlIds) => {
        assert.equal(pluginId, "reacomp");
        assert.deepEqual(controlIds, ["threshold_db", "ratio"]);
        return { ok: true, unproven: [] };
      },
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.data.fx_ref, FX_REF);
    assert.equal(result.result.data.readback.length, 2);
    assert.equal(result.result.data.readback.every((row) =>
      row.requested_normalized_value === row.observed_normalized_value), true);
    assert.deepEqual(calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.add_track_fx",
      "template.tracks.resolve_track_ref",
      "template.fx.resolve_fx_ref",
      "template.fx.read_fx_summary",
      "template.fx.list_fx_parameters",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.read_fx_parameter",
      "template.fx.read_fx_parameter",
    ]);
    assert.deepEqual(invalidations, [["fx"]]);
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.data.outcome.index_maintenance.status, "completed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("proof-gates resolved starter controls and overrides before parameter inventory", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: {
          starter_action: "gentle_vocal_compression",
          control_overrides: { ratio: 4 },
          selector: { name: "Lead Vocal" },
          dry_run: false,
        },
      },
      executeAtomic: fxAtomic(calls, new Map(), { parameterRows: duplicateReaCompWetRows() }),
      projectIndexRuntime: indexRuntime([]),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(result.result.data.unproven_controls, [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ]);
    assert.deepEqual(calls, []);
    assert.deepEqual(result.result.data.next_call.arguments.input.selector, { name: "Lead Vocal" });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("does not reach index maintenance when semantic units are unproven", async () => {
    const calls = [];
    const invalidations = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map()),
      projectIndexRuntime: indexRuntime(invalidations, { fail: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(calls, []);
    assert.deepEqual(invalidations, []);
    assert.deepEqual(result.result.changes, []);
    assert.equal(result.recovery.partial_changes_possible, false);
  });

  it("does not inspect ambiguous parameter metadata before semantic proof", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map(), {
        parameterRows: [
          { param_index: 0, name: "Threshold", normalized_value: 0.5 },
          { param_index: 4, name: "Threshold", normalized_value: 0.5 },
          { param_index: 21, name: "Bypass", normalized_value: 0 },
          { param_index: 22, name: "Wet", normalized_value: 1 },
          { param_index: 23, name: "Delta", normalized_value: 0 },
        ],
      }),
      projectIndexRuntime: indexRuntime([]),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(calls, []);
  });

  it("does not create an FX before semantic proof even if creation verification would fail", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map(), { omitAddVerification: true }),
      projectIndexRuntime: indexRuntime([]),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(calls, []);
    assert.deepEqual(result.result.changes, []);
    assert.equal(result.recovery.partial_changes_possible, false);
  });

  it("rejects unsupported plugins and non-idempotent replay keys before dispatch", async () => {
    for (const request of [
      { id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID, input: { plugin: "reaeq" }, refs: { track_ref: TRACK_REF } },
      { id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID, input: {}, refs: { track_ref: TRACK_REF }, idempotency_key: "repeat" },
    ]) {
      const calls = [];
      const result = await executeAlpha3_2_5DNativeFxMacro({
        request,
        executeAtomic: fxAtomic(calls, new Map()),
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "blocked");
      assert.equal(calls.length, 0);
    }
  });
});

function fxAtomic(calls, values, options = {}) {
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: input.track_ref }, [objectRef("track", input.track_ref)]);
    }
    if (id === "template.fx.add_track_fx") {
      return execution(
        id,
        { track_ref: refValue(refs.track_ref), fx_ref: FX_REF, name: "VST: ReaComp (Cockos)", slot_index: 0 },
        [objectRef("track", TRACK_REF), objectRef("fx", FX_REF)],
        options.omitAddVerification ? null : { status: "passed" },
      );
    }
    if (id === "template.fx.resolve_fx_ref") {
      return execution(id, { fx_ref: FX_REF, owner_kind: "track", slot_index: input.slot_index }, [objectRef("fx", FX_REF)]);
    }
    if (id === "template.fx.read_fx_summary") {
      return execution(id, { fx_ref: FX_REF, name: "VST: ReaComp (Cockos)", parameter_count: 2 }, [objectRef("fx", FX_REF)]);
    }
    if (id === "template.fx.list_fx_parameters") {
      const parameterRows = options.parameterRows ?? [
        { param_index: 0, name: "Threshold", normalized_value: 0.5 },
        { param_index: 1, name: "Ratio", normalized_value: 0.1 },
      ];
      return execution(id, {
        parameter_count: parameterRows.length,
        parameters: parameterRows,
        truncated: false,
      });
    }
    if (id === "template.fx.set_fx_parameter_normalized") {
      values.set(input.param_index, input.normalized_value);
      return execution(id, { fx_ref: FX_REF, param_index: input.param_index, normalized_value: input.normalized_value }, [objectRef("fx", FX_REF)], { status: "passed" });
    }
    if (id === "template.fx.read_fx_parameter") {
      return execution(id, { fx_ref: FX_REF, param_index: input.param_index, normalized_value: values.get(input.param_index) }, [objectRef("fx", FX_REF)]);
    }
    throw new Error(`Unexpected FX Template ${id}`);
  };
}

function chainAtomic(options = {}) {
  const calls = [];
  const writes = [];
  const installed = [
    { index: 10, name: "VST: ReaEQ (Cockos)", ident: "VST: ReaEQ (Cockos)" },
    { index: 11, name: "VST: ReaComp (Cockos)", ident: "VST: ReaComp (Cockos)" },
  ];
  const chains = {
    track: (options.initial ?? []).map((row, index) => fxRow("track", index, row)),
    take: [],
  };
  const parameterValues = new Map();
  let chainReadCount = 0;

  const executeAtomic = async ({ id, input = {}, refs = {} }) => {
    const call = { id, input: structuredClone(input), refs: structuredClone(refs) };
    calls.push(call);
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: TRACK_REF }, [objectRef("track", TRACK_REF)]);
    }
    if (id === "template.fx.search_installed_fx") {
      const needle = input.query.toLocaleLowerCase();
      const rows = installed.filter((row) => row.name.toLocaleLowerCase().includes(needle));
      return execution(id, {
        query: input.query,
        rows,
        row_count: rows.length,
        matched_count: rows.length,
        truncated: options.inventoryTruncated === true,
      });
    }
    if (id === "template.fx.list_track_fx_chain" || id === "template.fx.list_take_fx_chain") {
      const kind = id.includes("track") ? "track" : "take";
      const ownerRef = kind === "track" ? TRACK_REF : TAKE_REF;
      chainReadCount += 1;
      const finalRead = chainReadCount > (kind === "take" ? 1 : 1);
      const source = chains[kind].map((row) => ({ ...row }));
      if (options.finalNameMismatch && finalRead && source.length > 0) source[source.length - 1].name = "VST: Wrong FX";
      return execution(id, {
        owner_kind: kind,
        owner_ref: ownerRef,
        fx_count: source.length + (options.finalChainTruncated && finalRead ? 1 : 0),
        fx: source,
        fx_refs: source.map((row) => row.fx_ref),
        truncated: options.finalChainTruncated === true && finalRead,
      }, source.map((row) => objectRef("fx", row.fx_ref)));
    }
    if (id === "template.fx.resolve_fx_ref") {
      const kind = input.owner_kind === "take" ? "take" : "track";
      const row = chains[kind][input.slot_index];
      return row
        ? execution(id, { ...row }, [objectRef("fx", row.fx_ref)])
        : failure(id, "FX_REF_NOT_FOUND", "FX not found");
    }
    if (id === "template.fx.read_fx_summary") {
      const fxRef = refValue(refs.fx_ref);
      const located = locateFx(chains, fxRef);
      return located
        ? execution(id, { ...located.row }, [objectRef("fx", located.row.fx_ref)])
        : failure(id, "FX_REF_NOT_FOUND", "FX not found");
    }
    if (id === "template.fx.list_fx_parameters") {
      const parameterRows = options.parameterRows ?? [
        { param_index: 0, name: "Threshold", normalized_value: 0.5 },
        { param_index: 1, name: "Ratio", normalized_value: 0.1 },
      ];
      return execution(id, {
        parameter_count: parameterRows.length,
        parameters: parameterRows,
        truncated: false,
      });
    }
    const ownerKind = id === "template.fx.add_take_fx" ? "take" : "track";
    if (id === "template.fx.add_track_fx" || id === "template.fx.add_take_fx") {
      writes.push(call);
      const row = fxRow(ownerKind, chains[ownerKind].length, { name: input.plugin_name, enabled: true });
      chains[ownerKind].push(row);
      return execution(id, { ...row, readback_status: "passed" }, [objectRef("fx", row.fx_ref)], { status: "passed" });
    }
    const fxRef = refValue(refs.fx_ref);
    const located = locateFx(chains, fxRef);
    if (!located) return failure(id, "FX_REF_NOT_FOUND", "FX not found");
    if (id === "template.fx.set_fx_parameter_normalized") {
      writes.push(call);
      parameterValues.set(`${fxRef}:${input.param_index}`, input.normalized_value);
      return execution(
        id,
        { fx_ref: fxRef, param_index: input.param_index, normalized_value: input.normalized_value },
        [objectRef("fx", fxRef)],
        { status: "passed" },
      );
    }
    if (id === "template.fx.read_fx_parameter") {
      return execution(id, {
        fx_ref: fxRef,
        param_index: input.param_index,
        normalized_value: parameterValues.get(`${fxRef}:${input.param_index}`),
      }, [objectRef("fx", fxRef)]);
    }
    if (id === "template.fx.set_fx_bypass") {
      writes.push(call);
      located.row.enabled = input.enabled;
      return execution(id, { ...located.row, readback_status: "passed" }, [objectRef("fx", located.row.fx_ref)], { status: "passed" });
    }
    if (id === "template.fx.set_fx_preset_by_index") {
      writes.push(call);
      located.row.preset_index = input.preset_index;
      return execution(id, { ...located.row, readback_status: "passed" }, [objectRef("fx", located.row.fx_ref)], { status: "passed" });
    }
    if (id === "template.fx.set_fx_preset_by_name") {
      writes.push(call);
      located.row.preset_name = input.preset_name;
      return execution(id, { ...located.row, readback_status: "passed" }, [objectRef("fx", located.row.fx_ref)], { status: "passed" });
    }
    if (id === "template.fx.reorder_fx") {
      writes.push(call);
      const [row] = chains[located.kind].splice(located.index, 1);
      chains[located.kind].splice(input.target_index, 0, row);
      reindexChain(chains[located.kind], located.kind);
      const moved = chains[located.kind][input.target_index];
      return execution(id, { ...moved, readback_status: "passed" }, [objectRef("fx", moved.fx_ref)], { status: "passed" });
    }
    throw new Error(`Unexpected chain Template ${id}`);
  };

  return { calls, writes, chains, executeAtomic };
}

function fxRow(kind, index, values = {}) {
  const ownerRef = kind === "track" ? TRACK_REF : TAKE_REF;
  return {
    owner_kind: kind,
    owner_ref: ownerRef,
    fx_ref: `fx:${ownerRef}:${index}`,
    slot_index: index,
    name: values.name,
    enabled: values.enabled ?? true,
    parameter_count: values.parameter_count ?? 4,
    ...(values.preset_index !== undefined ? { preset_index: values.preset_index } : {}),
    ...(values.preset_name !== undefined ? { preset_name: values.preset_name } : {}),
  };
}

function locateFx(chains, ref) {
  for (const kind of ["track", "take"]) {
    const index = chains[kind].findIndex((row) => row.fx_ref === ref);
    if (index >= 0) return { kind, index, row: chains[kind][index] };
  }
  return null;
}

function reindexChain(chain, kind) {
  for (let index = 0; index < chain.length; index += 1) {
    Object.assign(chain[index], fxRow(kind, index, chain[index]));
  }
}

function duplicateReaCompWetRows() {
  return [
    { param_index: 0, name: "Threshold", normalized_value: 0.5 },
    { param_index: 1, name: "Ratio", normalized_value: 0.1 },
    { param_index: 2, name: "Attack", normalized_value: 0.01 },
    { param_index: 3, name: "Release", normalized_value: 0.02 },
    { param_index: 10, name: "Dry", normalized_value: 0 },
    { param_index: 11, name: "Wet", normalized_value: 0.5 },
    { param_index: 21, name: "Bypass", normalized_value: 0 },
    { param_index: 22, name: "Wet", normalized_value: 1 },
    { param_index: 23, name: "Delta", normalized_value: 0 },
  ];
}

function completeReaCompParameterRows() {
  return [
    { param_index: 0, param_ident: "threshold_db", name: "Threshold", normalized_value: 0.5 },
    { param_index: 1, param_ident: "ratio", name: "Ratio", normalized_value: 0.1 },
    { param_index: 2, param_ident: "attack_ms", name: "Attack", normalized_value: 0.01 },
    { param_index: 3, param_ident: "release_ms", name: "Release", normalized_value: 0.02 },
    { param_index: 4, param_ident: "wet_mix_percent", name: "Wet", normalized_value: 1 },
  ];
}

function execution(id, readback, refs = [], verification = undefined) {
  return {
    contract: "template.execution.v1",
    ok: true,
    request: { id: `evidence:${id}` },
    ...(verification ? { verification } : {}),
    result: { readback, refs },
    error: null,
  };
}

function failure(id, code, message) {
  return {
    contract: "template.execution.v1",
    ok: false,
    request: { id: `evidence:${id}` },
    result: { readback: null, refs: [] },
    error: { code, message },
  };
}

function refValue(value) {
  return typeof value === "string" ? value : value?.ref;
}

function objectRef(kind, ref) {
  if (kind === "fx") return { kind, ref, identity: { scheme: "track_fx", value: ref.slice("fx:".length) } };
  const prefix = `${kind}:`;
  const remainder = ref.slice(prefix.length);
  const separator = remainder.indexOf(":");
  return { kind, ref, identity: { scheme: remainder.slice(0, separator), value: remainder.slice(separator + 1) } };
}

function indexRuntime(invalidations, { fail = false } = {}) {
  return {
    status: () => ({ snapshot_id: "snapshot:fx-d", revision: 4 }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      if (fail) {
        return { ok: false, scopes, blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }] };
      }
      return { ok: true, scopes, snapshot_id: "snapshot:fx-d", revision: 4 };
    },
  };
}
