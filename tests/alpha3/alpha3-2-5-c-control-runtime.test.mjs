import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_2_5_C_CONTROL_REGISTRY,
  executeAlpha3_2_5CControlMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-c-control-runtime-v1.mjs";
import {
  createAlpha3C3ProjectIndex,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-store-v1.mjs";
import {
  validateMacroExecutionEnvelope,
} from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const NOW = "2026-07-12T09:00:00.000Z";

describe("Alpha3.2.5-C executable controls", () => {
  it("registers only the consolidated controls and stock-plugin programs", () => {
    assert.deepEqual(ALPHA3_2_5_C_CONTROL_REGISTRY.ids, [
      "macro.controls.set",
      "macro.set_stock_plugin_controls",
    ]);
    for (const entry of ALPHA3_2_5_C_CONTROL_REGISTRY.entries) {
      assert.equal(entry.implementation_status, "executable");
      assert.equal(entry.sqlite_policy.write_authority, false);
      assert.equal(entry.selector_policy.live_reresolve_before_write, true);
      assert.equal(entry.stages.every((stage) => stage.stop_on_error), true);
    }
  });

  it("executes one consolidated track control program and invalidates tracks", async () => {
    const calls = [];
    const invalidations = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "track",
          fields: { volume: 0.75, pan: -0.2 },
          dry_run: false,
        },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: projectIndexInvalidator(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.macro.id, "macro.controls.set");
    assert.deepEqual(calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.tracks.set_volume",
      "template.tracks.set_pan",
      "template.tracks.read_mixer_controls",
    ]);
    assert.deepEqual(invalidations, [["tracks"]]);
    assert.equal(response.sqlite.used, true);
    assert.equal(response.sqlite.freshness, "stale");
    assert.equal(response.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("uses the fresh Project Index for an unambiguous selector, then live-resolves it", async () => {
    const calls = [];
    const projectIndexRuntime = readyTrackIndexRuntime();
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "track",
          fields: { mute: true },
          selector: { name: "Lead Vocal" },
          dry_run: true,
        },
        refs: [],
        context: { session_id: "selector", request_sequence: 1 },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime,
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.equal(response.sqlite.used, true);
    assert.equal(response.result.data.sqlite_selector_used, true);
    assert.equal(calls.some((call) => call.id === "template.project.read_summary"), true);
    assert.equal(calls.some((call) => call.id === "template.tracks.resolve_track_ref"), true);
    assert.equal(calls.some((call) => call.id === "template.tracks.set_mute"), false);
  });

  it("fails closed when a batch-readable control value does not match", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "track",
          fields: { volume: 0.75 },
          dry_run: false,
        },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic(calls, { readbackVolume: 0.5 }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "CONTROL_READBACK_MISMATCH");
    assert.equal(response.result.verification.status, "failed");
    assert.equal(response.blockers[0].code, "CONTROL_READBACK_MISMATCH");
  });

  it("rejects a stable control GUID when the live resolver returns a different object", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "track", fields: { mute: true }, dry_run: false },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic(calls, { resolvedTrackRef: "track:guid:{WRONG}" }),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "CONTROL_TRACK_IDENTITY_MISMATCH");
    assert.equal(calls.some((call) => call.id === "template.tracks.set_mute"), false);
  });

  it("hydrates live ReaComp parameters, writes them, and verifies exact normalized readback", async () => {
    const calls = [];
    const values = new Map();
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          plugin: "reacomp",
          controls: { threshold_db: -18, ratio: 3 },
          dry_run: false,
        },
        refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
      },
      executeAtomic: stockAtomic(calls, values),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.macro.id, "macro.set_stock_plugin_controls");
    assert.deepEqual(calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.resolve_fx_ref",
      "template.fx.read_fx_summary",
      "template.fx.list_fx_parameters",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.read_fx_parameter",
      "template.fx.read_fx_parameter",
    ]);
    assert.equal(calls.find((call) => call.id === "template.fx.read_fx_summary").budget.max_inline_value_bytes, 6_000);
    assert.equal(calls.find((call) => call.id === "template.fx.list_fx_parameters").budget.max_inline_value_bytes, 12_000);
    assert.equal(calls.find((call) => call.id === "template.fx.list_fx_parameters").budget.max_items, 1_000);
    assert.equal(
      calls.filter((call) => call.id === "template.fx.read_fx_parameter")
        .every((call) => call.budget.max_inline_value_bytes === 6_000),
      true,
    );
    assert.equal(response.result.data.readback.length, 2);
    assert.equal(response.result.data.readback.every((row) => row.requested_normalized_value === row.observed_normalized_value), true);
    assert.equal(response.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });
});

function controlAtomic(calls, options = {}) {
  return async ({ id, input = {}, refs = {} }) => {
    calls.push({ id, input, refs });
    if (id === "template.project.read_summary") {
      return execution(id, { project_ref: "project:active", change_count: 1 });
    }
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: options.resolvedTrackRef ?? input.track_ref, name: "Lead Vocal" });
    }
    if (id === "template.tracks.read_mixer_controls") {
      return execution(id, {
        tracks: [{
          track_ref: typeof refs.track_ref === "string" ? refs.track_ref : refs.track_ref?.ref,
          volume: options.readbackVolume ?? 0.75,
          pan: -0.2,
          muted: true,
        }],
      });
    }
    return execution(id, { ...input, track_ref: refs.track_ref });
  };
}

function stockAtomic(calls, values) {
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: input.track_ref, name: "Lead Vocal" });
    }
    if (id === "template.fx.resolve_fx_ref") {
      return execution(id, { fx_ref: `fx:${refs.track_ref.ref}:${input.slot_index}` });
    }
    if (id === "template.fx.read_fx_summary") {
      return execution(id, {
        fx_ref: refs.fx_ref,
        name: "VST: ReaComp (Cockos)",
        parameter_count: 2,
      });
    }
    if (id === "template.fx.list_fx_parameters") {
      return execution(id, {
        parameters: [
          { param_index: 0, name: "Threshold", normalized_value: 0.5 },
          { param_index: 1, name: "Ratio", normalized_value: 0.1 },
        ],
      });
    }
    if (id === "template.fx.set_fx_parameter_normalized") {
      values.set(input.param_index, input.normalized_value);
      return execution(id, {
        fx_ref: refs.fx_ref,
        param_index: input.param_index,
        normalized_value: input.normalized_value,
      });
    }
    if (id === "template.fx.read_fx_parameter") {
      return execution(id, {
        fx_ref: refs.fx_ref,
        param_index: input.param_index,
        normalized_value: values.get(input.param_index),
      });
    }
    throw new Error(`Unexpected stock-plugin Template ${id}`);
  };
}

function execution(id, readback) {
  return {
    contract: "template.execution.v1",
    ok: true,
    request: { id: `evidence:${id}` },
    result: {
      readback,
      refs: Object.entries(readback)
        .filter(([, value]) => typeof value === "string" && /^(track|item|send|fx|project):/u.test(value))
        .map(([key, ref]) => ({ kind: key.replace(/_ref$/u, ""), ref })),
    },
    error: null,
  };
}

function projectIndexInvalidator(invalidations) {
  return {
    status: () => ({
      snapshot_id: "snapshot:controls",
      revision: 1,
    }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      return { ok: true, scopes, snapshot_id: "snapshot:controls", revision: 1 };
    },
  };
}

function readyTrackIndexRuntime() {
  const adapter = createAlpha3C3ProjectIndex({
    now: () => new Date(NOW),
    projectRef: "project:active",
    bridgeOwner: "owner-controls",
    bridgeGeneration: 1,
    sessionId: "session:controls",
  });
  adapter.replaceTracks({
    snapshot_id: "snapshot:controls",
    observed_at: NOW,
    rows: [{
      ref: "track:guid:{TRACK-A}",
      name: "Lead Vocal",
      index: 0,
      selected: true,
      muted: false,
      record_arm: false,
      folder_depth: 0,
      item_count: 1,
      fx_count: 1,
      send_count: 0,
    }],
    coverage_status: "complete",
    freshness_status: "fresh",
  });
  return {
    adapter,
    status: () => ({
      ...adapter.snapshot(),
      rows_available: true,
      row_counts: { tracks: 1 },
    }),
    reconcileProjectRevision: () => ({ ok: true, changed: false }),
    invalidateScopes: ({ scopes }) => ({ ok: true, scopes }),
  };
}
