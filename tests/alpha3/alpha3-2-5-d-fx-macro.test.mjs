import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
  ALPHA3_2_5_D_NATIVE_FX_REGISTRY,
  createAlpha3_2_5DNativeFxMacroDiscoveryItems,
  executeAlpha3_2_5DNativeFxMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const NOW = "2026-07-12T10:00:00.000Z";
const TRACK_REF = "track:guid:{TRACK-A}";
const FX_REF = `fx:${TRACK_REF}:0`;

describe("Alpha3.2.5-D native FX Macro", () => {
  it("registers and discovers one executable ReaComp task program", () => {
    assert.deepEqual(ALPHA3_2_5_D_NATIVE_FX_REGISTRY.ids, [ALPHA3_2_5_D_NATIVE_FX_MACRO_ID]);
    const entry = ALPHA3_2_5_D_NATIVE_FX_REGISTRY.get(ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.dependencies.template_ids.includes("template.fx.add_track_fx"), true);
    assert.equal(entry.dependencies.runtime_capabilities.includes("stock_plugin.semantic_parameter_program.v1"), true);

    const [item] = createAlpha3_2_5DNativeFxMacroDiscoveryItems({ liveRunnableNow: true });
    assert.equal(item.id, ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.live_runnable_now, true);
    assert.deepEqual(item.inputSchema.properties.plugin.enum, ["reacomp"]);
  });

  it("dry-runs the default gentle ReaComp chain after live track resolution", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { dry_run: true },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, new Map()),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.deepEqual(calls.map((call) => call.id), ["template.tracks.resolve_track_ref"]);
    assert.equal(result.result.data.starter_action, "gentle_vocal_compression");
    assert.equal(result.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("adds ReaComp, runs semantic controls, and returns exact readback", async () => {
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

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.data.fx_ref, FX_REF);
    assert.equal(result.result.data.readback.length, 2);
    assert.equal(result.result.data.readback.every((row) => row.requested_normalized_value === row.observed_normalized_value), true);
    assert.deepEqual(calls.find((call) => call.id === "template.fx.add_track_fx").refs.track_ref, objectRef("track", TRACK_REF));
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

  it("prefers the plugin Wet parameter over REAPER's trailing host-wrapper Wet parameter", async () => {
    const calls = [];
    const values = new Map();
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic(calls, values, { parameterRows: duplicateReaCompWetRows() }),
      projectIndexRuntime: indexRuntime([]),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.data.readback.length, 5);
    const wetWrite = calls.find((call) =>
      call.id === "template.fx.set_fx_parameter_normalized" && call.input.param_index === 11);
    assert.ok(wetWrite, "the plugin-owned Wet parameter was not selected");
    assert.equal(calls.some((call) =>
      call.id === "template.fx.set_fx_parameter_normalized" && call.input.param_index === 22), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("keeps verified FX changes applied when only index maintenance fails", async () => {
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic([], new Map()),
      projectIndexRuntime: indexRuntime([], { fail: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "INDEX_WRITE_FAILED");
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "failed"), true);
    assert.equal(result.result.data.outcome.live_readback.status, "passed");
    assert.equal(result.result.data.outcome.index_maintenance.status, "failed");
  });

  it("keeps equally ranked non-wrapper parameter names ambiguous", async () => {
    const result = await executeAlpha3_2_5DNativeFxMacro({
      request: {
        id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
        input: { controls: { threshold_db: -18 }, dry_run: false },
        refs: { track_ref: TRACK_REF },
      },
      executeAtomic: fxAtomic([], new Map(), {
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
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "STOCK_PARAMETER_MATCH_AMBIGUOUS");
  });

  it("reports partial failure when FX creation lacks accepted Template verification", async () => {
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
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "NATIVE_FX_CHILD_VERIFICATION_FAILED");
    assert.equal(calls.some((call) => call.id === "template.fx.set_fx_parameter_normalized"), false);
    assert.equal(result.result.verification.status, "failed");
    assert.equal(result.result.changes.every((change) => change.status !== "applied"), true);
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
