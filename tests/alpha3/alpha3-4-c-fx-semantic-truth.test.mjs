import assert from "node:assert/strict";
import test from "node:test";

import {
  ALPHA3_4_C_FX_SET_CONTROLS_MODES,
  assertAlpha34CSemanticUnitsProven,
  createExactParametersRecoveryCall,
  hydrateCompleteFxParameterInventory,
  listAlpha34CStockSemanticControls,
  normalizeAlpha34CFxSetControlsInput,
  resolveExactParameterTargets,
  STOCK_SEMANTIC_UNIT_UNPROVEN,
} from "../../packages/mcp-server/src/alpha3-4-c-fx-semantic-truth-v1.mjs";
import {
  executeAlpha3_2_5CControlMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-c-control-runtime-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadOpenReaperAgentStartHereProjection,
} from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";

test("catalog enumerates exactly 10 plugins and 43 unproven semantic controls", () => {
  const catalog = listAlpha34CStockSemanticControls();
  assert.equal(catalog.plugin_count, 10);
  assert.equal(catalog.control_count, 43);
  assert.equal(catalog.controls.every((row) => row.proof_status === "unproven"), true);
  assert.equal(catalog.controls.every((row) => row.executable_semantic_conversion === false), true);
  assert.deepEqual(ALPHA3_4_C_FX_SET_CONTROLS_MODES, ["semantic", "exact_parameters", "reaeq_bands"]);
});

test("reaeq_bands normalizes a strict unique first-four-band profile", () => {
  const valid = normalizeAlpha34CFxSetControlsInput({
    mode: "reaeq_bands",
    dry_run: false,
    bands: [
      { band: 1, type: "high_pass", enabled: true, frequency_hz: 85 },
      { band: 2, type: "band", gain_db: -3, bandwidth_oct: 1.2 },
    ],
  });
  assert.equal(valid.ok, true, JSON.stringify(valid));
  assert.equal(valid.mode, "reaeq_bands");
  assert.equal(valid.bands.length, 2);

  for (const input of [
    { mode: "reaeq_bands", bands: [] },
    { mode: "reaeq_bands", bands: [{ band: 1 }, { band: 1 }] },
    { mode: "reaeq_bands", bands: [{ band: 1, type: "arbitrary" }] },
    { mode: "reaeq_bands", bands: [{ band: 1, frequency_hz: 1 }] },
    { mode: "reaeq_bands", bands: [{ band: 1, BANDTYPE0: "0" }] },
  ]) {
    assert.equal(normalizeAlpha34CFxSetControlsInput(input).ok, false, JSON.stringify(input));
  }
});

test("reaeq_bands dispatches one typed atomic batch and invalidates FX once", async () => {
  const calls = [];
  const invalidations = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: { mode: "reaeq_bands", dry_run: false, bands: [{ band: 1, type: "high_pass", enabled: true, frequency_hz: 85 }] },
      refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
    },
    executeAtomic: async ({ id, input, refs }) => {
      calls.push({ id, input, refs });
      if (id === "template.tracks.resolve_track_ref") {
        return atomic(id, { track_ref: "track:guid:{TRACK}" }, [{ kind: "track", ref: "track:guid:{TRACK}", identity: { scheme: "guid", value: "{TRACK}" } }]);
      }
      if (id === "template.fx.resolve_fx_ref") {
        return atomic(id, { fx_ref: "fx:track:guid:{TRACK}:0" }, [{ kind: "fx", ref: "fx:track:guid:{TRACK}:0", identity: { scheme: "track_fx", value: "track:guid:{TRACK}:0" } }]);
      }
      if (id === "template.fx.set_reaeq_bands") {
        return atomic(id, {
          fx_ref: "fx:track:guid:{TRACK}:0",
          plugin_identity: "VST3:ReaEQ (Cockos)",
          owner_kind: "track",
          topology: [{ band: 1, type: "high_pass", enabled: true }],
          parameter_inventory: Array.from({ length: 19 }, (_, param_index) => ({ param_index })),
          rows: [{ band: 1, type: "high_pass", enabled: true, readback_status: "aggregate_passed" }],
          mutation_attempted: true,
          batch_timings: { preflight_ms: 1, mutation_ms: 1, readback_ms: 1 },
        });
      }
      throw new Error(`unexpected ${id}`);
    },
    projectIndexRuntime: {
      invalidateScopes({ scopes }) {
        invalidations.push(scopes);
        return { ok: true, scopes };
      },
    },
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  assert.equal(calls.filter((call) => call.id === "template.fx.set_reaeq_bands").length, 1);
  assert.deepEqual(calls.at(-1).input.bands, [{ band: 1, type: "high_pass", enabled: true, frequency_hz: 85 }]);
  assert.deepEqual(invalidations, [["fx"]]);
});

test("reaeq_bands preserves mutation-attempted failure truth and invalidates FX once", async () => {
  const invalidations = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: { mode: "reaeq_bands", dry_run: false, bands: [{ band: 1, type: "high_pass", frequency_hz: 85 }] },
      refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
    },
    executeAtomic: async ({ id }) => {
      if (id === "template.tracks.resolve_track_ref") {
        return atomic(id, { track_ref: "track:guid:{TRACK}" }, [{ kind: "track", ref: "track:guid:{TRACK}", identity: { scheme: "guid", value: "{TRACK}" } }]);
      }
      if (id === "template.fx.resolve_fx_ref") {
        return atomic(id, { fx_ref: "fx:track:guid:{TRACK}:0" }, [{ kind: "fx", ref: "fx:track:guid:{TRACK}:0", identity: { scheme: "track_fx", value: "track:guid:{TRACK}:0" } }]);
      }
      if (id === "template.fx.set_reaeq_bands") {
        return {
          contract: "template.execution.v1",
          ok: false,
          error: {
            code: "VERIFY_FAILED",
            message: "ReaEQ write completed but aggregate readback failed.",
            details: { mutation_attempted: true, zero_write: false },
          },
        };
      }
      throw new Error(`unexpected ${id}`);
    },
    projectIndexRuntime: exactIndexRuntime(invalidations),
  });

  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.execution.status, "partial_failure");
  assert.equal(response.error.code, "VERIFY_FAILED");
  assert.equal(response.result.data.outcome.mutation.status, "unknown");
  assert.deepEqual(invalidations, [["fx"]]);
});

test("reaeq_bands live-resolves exact audio Take FX without the MIDI-only resolver", async () => {
  const takeRef = "take:guid:{TAKE}";
  const fxRef = `fx:${takeRef}:0`;
  const calls = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: { mode: "reaeq_bands", dry_run: false, bands: [{ band: 1, type: "high_pass", frequency_hz: 85 }] },
      refs: { fx_ref: fxRef },
    },
    executeAtomic: async ({ id, input, refs }) => {
      calls.push({ id, input, refs });
      if (id === "template.fx.resolve_fx_ref") {
        assert.deepEqual(input, { owner_kind: "take", slot_index: 0 });
        assert.deepEqual(refs, {
          take_ref: { kind: "take", ref: takeRef, identity: { scheme: "guid", value: "{TAKE}" } },
        });
        return atomic(id, { fx_ref: fxRef }, [
          { kind: "fx", ref: fxRef, identity: { scheme: "take_fx", value: `${takeRef}:0` } },
        ]);
      }
      if (id === "template.fx.set_reaeq_bands") {
        return atomic(id, {
          fx_ref: fxRef,
          plugin_identity: "VST3:ReaEQ (Cockos)",
          owner_kind: "take",
          topology: [{ band: 1, type: "high_pass", enabled: true }],
          parameter_inventory: Array.from({ length: 19 }, (_, param_index) => ({ param_index })),
          rows: [{ band: 1, type: "high_pass", frequency_hz: 85, readback_status: "aggregate_passed" }],
          mutation_attempted: true,
          batch_timings: { preflight_ms: 1, mutation_ms: 1, readback_ms: 1 },
        });
      }
      throw new Error(`unexpected ${id}`);
    },
  });

  assert.equal(response.ok, true, JSON.stringify(response));
  assert.deepEqual(calls.map((call) => call.id), [
    "template.fx.resolve_fx_ref",
    "template.fx.set_reaeq_bands",
  ]);
});

test("semantic mode fails closed for ReaSynth and RS5k Attack without native proof", async () => {
  for (const [plugin, control] of [["reasynth", "attack_ms"], ["rs5k", "attack_ms"]]) {
    const proof = assertAlpha34CSemanticUnitsProven(plugin, [control]);
    assert.equal(proof.ok, false);
    assert.equal(proof.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.equal(proof.recovery, null);

    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          mode: "semantic",
          plugin,
          controls: { [control]: 100 },
          dry_run: true,
        },
        refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
      },
      executeAtomic: async () => {
        throw new Error("semantic unproven path must not call live atoms");
      },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error?.code ?? response.blockers?.[0]?.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.equal(response.result?.data?.next_call?.arguments?.id, "template.fx.list_fx_parameters");
  }
});

test("default semantic compatibility mode still fails closed and returns a schema-valid recovery call", async () => {
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: { plugin: "reacomp", controls: { threshold_db: -18 }, dry_run: true },
      refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
    },
    executeAtomic: async () => {
      throw new Error("unproven default semantic mode must stop before live execution");
    },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
  const recovery = response.result.data.next_call;
  assert.equal(recovery.arguments.id, "template.fx.list_fx_parameters");
  assert.deepEqual(recovery.arguments.refs, { fx_ref: "fx:track:guid:{TRACK}:0" });
  assert.deepEqual(recovery.arguments.input, { limit: 128, offset: 0 });
  assert.equal(recovery.recovery_context.next_mode, "exact_parameters");
  assert.equal(Object.hasOwn(recovery.arguments.input, "note"), false);
  assert.equal(Object.hasOwn(recovery.arguments.input, "refs_hint"), false);
});

test("exact_parameters hydrates complete multi-page inventory and never invents missing rows", async () => {
  const pages = [
    {
      ok: true,
      result: {
        data: {
          parameter_count: 495,
          parameters: Array.from({ length: 128 }, (_, index) => ({ param_index: index, name: `P${index}`, param_ident: `id${index}` })),
          next_offset: 128,
          truncated: true,
          coverage_status: "paged",
          inventory_complete: false,
        },
      },
    },
    {
      ok: true,
      result: {
        data: {
          parameter_count: 495,
          parameters: Array.from({ length: 128 }, (_, index) => ({ param_index: 128 + index, name: `P${128 + index}`, param_ident: `id${128 + index}` })),
          next_offset: 256,
          truncated: true,
          coverage_status: "paged",
          inventory_complete: false,
        },
      },
    },
    {
      ok: true,
      result: {
        data: {
          parameter_count: 495,
          parameters: Array.from({ length: 128 }, (_, index) => ({ param_index: 256 + index, name: `P${256 + index}`, param_ident: `id${256 + index}` })),
          next_offset: 384,
          truncated: true,
          coverage_status: "paged",
          inventory_complete: false,
        },
      },
    },
    {
      ok: true,
      result: {
        data: {
          parameter_count: 495,
          parameters: Array.from({ length: 111 }, (_, index) => ({ param_index: 384 + index, name: `P${384 + index}`, param_ident: `id${384 + index}` })),
          next_offset: null,
          truncated: false,
          coverage_status: "complete",
          inventory_complete: true,
        },
      },
    },
  ];
  let call = 0;
  const inventory = await hydrateCompleteFxParameterInventory({
    executeAtomic: async () => pages[call++],
    request: {},
    fxRef: "fx:track:guid:{TRACK}:0",
  });
  assert.equal(inventory.ok, true);
  assert.equal(inventory.parameter_count, 495);
  assert.equal(inventory.parameters.length, 495);
  assert.equal(inventory.pages, 4);
  assert.equal(inventory.inventory_complete, true);

  const resolved = resolveExactParameterTargets([
    { id: "a", param_index: 494, normalized_value: 0.25 },
    { id: "b", param_name: "P10", normalized_value: 0.5 },
  ], inventory.parameters);
  assert.equal(resolved.ok, true);
  assert.equal(resolved.resolved[0].param_index, 494);
  assert.equal(resolved.resolved[1].param_index, 10);

  const missing = resolveExactParameterTargets([
    { id: "x", param_name: "DoesNotExist", normalized_value: 0.1 },
  ], inventory.parameters);
  assert.equal(missing.ok, false);
  assert.equal(missing.code, "FX_PARAMETER_MATCH_NOT_FOUND");

  const gap = await hydrateCompleteFxParameterInventory({
    executeAtomic: async () => ({
      ok: true,
      result: {
        data: {
          parameter_count: 3,
          parameters: [{ param_index: 0, name: "A", param_ident: "a" }],
          offset: 0,
          next_offset: 2,
          truncated: true,
          inventory_complete: false,
          coverage_status: "paged",
        },
      },
    }),
    fxRef: "fx:track:guid:{TRACK}:0",
  });
  assert.equal(gap.ok, false);
  assert.equal(gap.code, "FX_PARAMETER_LIST_PAGING_GAP");

  const duplicateTarget = resolveExactParameterTargets([
    { id: "by_index", param_index: 10, normalized_value: 0.1 },
    { id: "by_ident", param_ident: "id10", normalized_value: 0.2 },
  ], inventory.parameters);
  assert.equal(duplicateTarget.ok, false);
  assert.equal(duplicateTarget.code, "FX_EXACT_PARAMETERS_DUPLICATE_TARGET");
});

test("exact_parameters executes with separate mutation/readback/index truth and not_run trailing rows", async () => {
  const values = new Map([[0, 0.1], [1, 0.2]]);
  const calls = [];
  const invalidations = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        dry_run: false,
        changes: [
          { id: "ok", param_index: 0, normalized_value: 0.55 },
          { id: "bad", param_index: 1, normalized_value: 0.66 },
          { id: "later", param_index: 2, normalized_value: 0.77 },
        ],
      },
      refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
    },
    executeAtomic: async ({ id, input = {}, refs = {} }) => {
      calls.push(id);
      if (id === "template.tracks.resolve_track_ref") {
        return atomic(id, { track_ref: "track:guid:{TRACK-A}", name: "Lead" });
      }
      if (id === "template.fx.resolve_fx_ref") {
        const trackRef = typeof refs.track_ref === "string" ? refs.track_ref : refs.track_ref?.ref;
        return atomic(id, { fx_ref: `fx:${trackRef}:${input.slot_index}` });
      }
      if (id === "template.fx.list_fx_parameters") {
        return atomic(id, {
          parameter_count: 3,
          parameters: [
            { param_index: 0, name: "A", param_ident: "a" },
            { param_index: 1, name: "B", param_ident: "b" },
            { param_index: 2, name: "C", param_ident: "c" },
          ],
          offset: input.offset ?? 0,
          next_offset: null,
          truncated: false,
          inventory_complete: true,
          coverage_status: "complete",
        });
      }
      if (id === "template.fx.set_fx_parameter_normalized") {
        values.set(input.param_index, input.normalized_value);
        return atomic(id, {
          param_index: input.param_index,
          param_ident: ["a", "b", "c"][input.param_index],
          normalized_value: input.normalized_value,
          formatted_value: String(input.normalized_value),
          requested_normalized_value: input.normalized_value,
          requested_formatted_value: String(input.normalized_value),
          tolerance: 0.001,
          verification_mode: "numeric_tolerance",
          is_discrete: false,
          updated: true,
        });
      }
      if (id === "template.fx.read_fx_parameter") {
        const observed = input.probe_normalized_value !== undefined
          ? input.probe_normalized_value
          : input.param_index === 1 ? 0.01 : values.get(input.param_index);
        return atomic(id, {
          param_index: input.param_index,
          param_ident: ["a", "b", "c"][input.param_index],
          normalized_value: observed,
          formatted_value: String(observed),
          step_sizes_available: false,
          step_size: null,
          is_toggle: null,
          is_discrete: false,
        });
      }
      throw new Error(`unexpected ${id}`);
    },
    projectIndexRuntime: {
      invalidateScopes({ scopes }) {
        invalidations.push([...scopes]);
        return { ok: true, scopes };
      },
      status() { return { ok: true, lifecycle: "ready" }; },
    },
  });
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.execution?.status, "partial_failure");
  const changes = response.result?.changes ?? [];
  assert.equal(changes[0].status, "applied");
  assert.equal(changes[0].live_readback.status, "passed");
  assert.equal(changes[1].status, "failed");
  assert.equal(changes[2].status, "not_run");
  assert.deepEqual(invalidations, [["fx"]]);
  assert.ok(calls.includes("template.fx.list_fx_parameters"));
  const firstWrite = calls.indexOf("template.fx.set_fx_parameter_normalized");
  assert.equal(calls.slice(0, firstWrite).filter((id) => id === "template.fx.read_fx_parameter").length, 3);
});

test("exact_parameters accepts REAPER-native discrete quantization and fails the envelope if index invalidation fails", async () => {
  const calls = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        changes: [{ id: "enabled", param_index: 0, normalized_value: 0.5 }],
      },
      refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
    },
    executeAtomic: async ({ id, input = {}, refs = {} }) => {
      calls.push({ id, input });
      if (id === "template.tracks.resolve_track_ref") {
        return atomic(id, { track_ref: "track:guid:{TRACK-A}" });
      }
      if (id === "template.fx.resolve_fx_ref") {
        const trackRef = typeof refs.track_ref === "string" ? refs.track_ref : refs.track_ref?.ref;
        return atomic(id, { fx_ref: `fx:${trackRef}:${input.slot_index}` });
      }
      if (id === "template.fx.list_fx_parameters") {
        return atomic(id, {
          parameter_count: 1,
          parameters: [{ param_index: 0, name: "Enabled", param_ident: "enabled" }],
          offset: input.offset ?? 0,
          next_offset: null,
          truncated: false,
          inventory_complete: true,
          coverage_status: "complete",
        });
      }
      if (id === "template.fx.read_fx_parameter") {
        const probing = input.probe_normalized_value !== undefined;
        return atomic(id, {
          param_index: 0,
          param_ident: "enabled",
          normalized_value: probing ? input.probe_normalized_value : 1,
          formatted_value: "On",
          step_sizes_available: true,
          step_size: 1,
          is_toggle: true,
          is_discrete: true,
        });
      }
      if (id === "template.fx.set_fx_parameter_normalized") {
        return atomic(id, {
          param_index: 0,
          param_ident: "enabled",
          normalized_value: 1,
          formatted_value: "On",
          requested_normalized_value: 0.5,
          requested_formatted_value: "On",
          tolerance: 0.001,
          verification_mode: "native_discrete_format",
          step_sizes_available: true,
          step_size: 1,
          is_toggle: true,
          is_discrete: true,
          updated: true,
        });
      }
      throw new Error(`unexpected ${id}`);
    },
    projectIndexRuntime: {
      invalidateScopes() {
        return {
          ok: false,
          blockers: [{ code: "FX_INDEX_INVALIDATION_FAILED", message: "test invalidation failed", recoverable: true }],
        };
      },
      status() { return { ok: true, lifecycle: "ready" }; },
    },
  });
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.execution.status, "partial_failure");
  assert.equal(response.error.code, "FX_INDEX_INVALIDATION_FAILED");
  assert.equal(response.result.changes[0].status, "applied");
  assert.equal(response.result.changes[0].live_readback.verification, "native_formatted");
  assert.equal(response.result.changes[0].live_readback.observed_normalized_value, 1);
  assert.equal(response.result.changes[0].index_maintenance.status, "failed");
  assert.equal(calls.filter((call) => call.id === "template.fx.read_fx_parameter").length, 2);
});

test("exact_parameters rejects unsupported public input fields before live calls", async () => {
  let calls = 0;
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        changes: [{ id: "p0", param_index: 0, normalized_value: 0.5 }],
        note: "not a public field",
      },
      refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
    },
    executeAtomic: async () => { calls += 1; },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "STOCK_PLUGIN_INPUT_FIELD_UNSUPPORTED");
  assert.equal(calls, 0);
});

test("public call_template rejects non-boolean dry_run before any atomic dispatch", async () => {
  let dispatches = 0;
  const runtime = createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor: async () => { dispatches += 1; },
    },
  });
  const response = await runtime.call_template({
    id: "macro.fx.set_controls",
    input: {
      mode: "exact_parameters",
      dry_run: "true",
      changes: [{ id: "p0", param_index: 0, normalized_value: 0.5 }],
    },
    refs: { fx_ref: "fx:track:guid:{TRACK}:0" },
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "FX_SET_CONTROLS_DRY_RUN_INVALID");
  assert.equal(dispatches, 0);
});

test("a rejected atomic write is mutation-unknown and conservatively invalidates FX once", async () => {
  const calls = [];
  const invalidations = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        dry_run: false,
        changes: [{ id: "enabled", param_index: 0, param_ident: "enabled", normalized_value: 0.5 }],
      },
      refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
    },
    executeAtomic: exactSingleParameterAtomic(calls, { writeFailure: true }),
    projectIndexRuntime: exactIndexRuntime(invalidations),
  });
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.execution.status, "partial_failure");
  assert.equal(response.error.code, "VERIFY_FAILED");
  assert.equal(response.result.changes[0].mutation.status, "unknown");
  assert.equal(response.result.changes[0].mutation.dispatch_status, "attempted");
  assert.equal(response.result.changes[0].live_readback.status, "not_run");
  assert.equal(response.result.changes[0].index_maintenance.status, "completed");
  assert.equal(response.result.data.outcome.mutation.status, "unknown");
  assert.equal(response.result.data.outcome.mutation.unknown_count, 1);
  assert.deepEqual(invalidations, [["fx"]]);
  assert.equal(calls.filter((call) => call.id === "template.fx.set_fx_parameter_normalized").length, 1);
});

test("discrete exact_parameters requires matching native formatted readback", async () => {
  const calls = [];
  const invalidations = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        dry_run: false,
        changes: [{ id: "enabled", param_index: 0, param_ident: "enabled", normalized_value: 0.5 }],
      },
      refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
    },
    executeAtomic: exactSingleParameterAtomic(calls, { readbackFormatted: "Off" }),
    projectIndexRuntime: exactIndexRuntime(invalidations),
  });
  assert.equal(response.ok, false, JSON.stringify(response));
  assert.equal(response.error.code, "FX_EXACT_PARAMETERS_READBACK_MISMATCH");
  assert.equal(response.result.changes[0].status, "failed");
  assert.equal(response.result.changes[0].mutation.status, "completed");
  assert.equal(response.result.changes[0].live_readback.observed_formatted_value, "Off");
  assert.deepEqual(invalidations, [["fx"]]);
});

function atomic(id, readback, objectRefs = null) {
  return {
    contract: "template.execution.v1",
    ok: true,
    request: { id: `evidence:${id}` },
    result: {
      readback,
      data: readback,
      refs: objectRefs ?? Object.entries(readback)
        .filter(([, value]) => typeof value === "string" && /^(track|item|send|fx|project):/u.test(value))
        .map(([key, ref]) => ({ kind: key.replace(/_ref$/u, ""), ref })),
    },
    error: null,
  };
}

function exactSingleParameterAtomic(calls, { writeFailure = false, readbackFormatted = "On" } = {}) {
  return async ({ id, input = {}, refs = {} }) => {
    calls.push({ id, input, refs });
    if (id === "template.tracks.resolve_track_ref") {
      return atomic(id, { track_ref: "track:guid:{TRACK-A}" });
    }
    if (id === "template.fx.resolve_fx_ref") {
      const trackRef = typeof refs.track_ref === "string" ? refs.track_ref : refs.track_ref?.ref;
      return atomic(id, { fx_ref: `fx:${trackRef}:${input.slot_index}` });
    }
    if (id === "template.fx.list_fx_parameters") {
      return atomic(id, {
        parameter_count: 1,
        parameters: [{ param_index: 0, name: "Enabled", param_ident: "enabled" }],
        offset: 0,
        next_offset: null,
        truncated: false,
        inventory_complete: true,
        coverage_status: "complete",
      });
    }
    if (id === "template.fx.read_fx_parameter") {
      const probing = input.probe_normalized_value !== undefined || input.probe_display_value !== undefined;
      return atomic(id, {
        param_index: 0,
        param_ident: "enabled",
        value: 0.25,
        normalized_value: input.probe_display_value !== undefined ? null : 0.5,
        formatted_value: probing ? "On" : readbackFormatted,
        step_sizes_available: true,
        step_size: 1,
        is_toggle: true,
        is_discrete: true,
      });
    }
    if (id === "template.fx.set_fx_parameter_normalized") {
      if (writeFailure) {
        return {
          contract: "template.execution.v1",
          ok: false,
          error: { code: "VERIFY_FAILED", message: "write may have happened before verification failed" },
        };
      }
      return atomic(id, {
        param_index: 0,
        param_ident: "enabled",
        value: 0.25,
        normalized_value: 0.5,
        formatted_value: "On",
        requested_normalized_value: null,
        requested_display_value: input.display_value,
        requested_value: 0.25,
        requested_formatted_value: "On",
        tolerance: 0.001,
        verification_mode: "native_display_value",
        is_discrete: true,
        updated: true,
      });
    }
    throw new Error(`unexpected ${id}`);
  };
}

function exactIndexRuntime(invalidations) {
  return {
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      return { ok: true, scopes };
    },
    status() { return { ok: true, lifecycle: "ready" }; },
  };
}

test("normalize rejects fuzzy-less exact_parameters rows and defaults mode to semantic", () => {
  assert.equal(normalizeAlpha34CFxSetControlsInput({}).mode, "semantic");
  assert.equal(normalizeAlpha34CFxSetControlsInput({ dry_run: "true" }).code, "FX_SET_CONTROLS_DRY_RUN_INVALID");
  assert.equal(normalizeAlpha34CFxSetControlsInput({ mode: "exact_parameters", changes: [] }).ok, false);
  assert.equal(normalizeAlpha34CFxSetControlsInput({
    mode: "exact_parameters",
    changes: [{ id: "a", normalized_value: 0.5 }],
  }).ok, false);
});

test("exact_parameters accepts one native display target and rejects missing or conflicting value modes", () => {
  const display = normalizeAlpha34CFxSetControlsInput({
    mode: "exact_parameters",
    changes: [{ id: "freq", param_ident: "frequency", display_value: " 3000 Hz " }],
  });
  assert.equal(display.ok, true, JSON.stringify(display));
  assert.equal(display.changes[0].display_value, "3000 Hz");
  assert.equal(Object.hasOwn(display.changes[0], "normalized_value"), false);
  for (const changes of [
    [{ id: "freq", param_ident: "frequency" }],
    [{ id: "freq", param_ident: "frequency", display_value: "" }],
    [{ id: "freq", param_ident: "frequency", display_value: "3000 Hz", normalized_value: 0.5 }],
  ]) {
    assert.equal(normalizeAlpha34CFxSetControlsInput({ mode: "exact_parameters", changes }).ok, false);
  }
});

test("exact_parameters sends display_value through the raw native setter path", async () => {
  const calls = [];
  const response = await executeAlpha3_2_5CControlMacro({
    request: {
      id: "macro.set_stock_plugin_controls",
      input: {
        mode: "exact_parameters",
        dry_run: false,
        changes: [{ id: "enabled", param_ident: "enabled", display_value: "On" }],
      },
      refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
    },
    executeAtomic: exactSingleParameterAtomic(calls),
    projectIndexRuntime: exactIndexRuntime([]),
  });
  assert.equal(response.ok, true, JSON.stringify(response));
  const probe = calls.find((call) => call.id === "template.fx.read_fx_parameter" && call.input.probe_display_value);
  const write = calls.find((call) => call.id === "template.fx.set_fx_parameter_normalized");
  assert.equal(probe.input.probe_display_value, "On");
  assert.equal(write.input.display_value, "On");
  assert.equal(Object.hasOwn(write.input, "normalized_value"), false);
});

test("AGENT_START_HERE and discovery manuals teach exact_parameters highway", () => {
  const start = loadOpenReaperAgentStartHereProjection();
  assert.match(start.compact_text, /exact_parameters/u);
  assert.match(start.compact_text, /STOCK_SEMANTIC_UNIT_UNPROVEN/u);
  const runtime = createCallTemplateRuntime();
  const exact = runtime.list_templates({ ids: ["macro.fx.set_controls"], fields: ["id", "inputSchema"] });
  const expansion = exact.product_surface.agent_context_macro_guide.requested_expansions.items[0];
  assert.equal(exact.items[0].inputSchema.oneOf.length, 2);
  assert.equal(exact.items[0].inputSchema.properties.changes.minItems, 1);
  assert.equal(exact.items[0].inputSchema.properties.changes.items.additionalProperties, false);
  assert.equal(exact.items[0].inputSchema.properties.changes.items.properties.display_value.maxLength, 80);
  assert.match(JSON.stringify(expansion.action_manual), /exact_parameters/u);
  assert.deepEqual(expansion.action_manual.examples[0].input.selector, { plugin_id: "reacomp" });
  assert.ok(expansion.first_try_execution_guide);
});
