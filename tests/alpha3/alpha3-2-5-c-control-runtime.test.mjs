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
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(response.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(response.result.data.outcome.index_maintenance.status, "completed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("executes project BPM without refs and verifies it through a separate live tempo read", async () => {
    const calls = [];
    const invalidations = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "project", fields: { bpm: 128 }, dry_run: false },
        refs: [],
      },
      executeAtomic: controlAtomic(calls, { initialProjectBpm: 120 }),
      projectIndexRuntime: projectIndexInvalidator(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.project.read_tempo_map",
      "template.project.set_bpm",
      "template.project.read_tempo_map",
    ]);
    assert.deepEqual(calls.map((call) => call.refs), [{}, {}, {}]);
    assert.deepEqual(calls[1].input, { bpm: 128 });
    assert.deepEqual(invalidations, [["project_head"]]);
    assert.deepEqual(response.result.data.target_refs, {});
    assert.deepEqual(response.result.data.fields, { bpm: 128 });
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].live_readback.fields[0].observed_value, 128);
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
    assert.equal(response.result.data.outcome.mutation.status, "completed");
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "completed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("executes project grid and snap with row-specific accepted Template readback", async () => {
    const calls = [];
    const invalidations = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "project",
          fields: { grid_division: "1/8", grid_swing: 0.2, snap_enabled: true },
          dry_run: false,
        },
        refs: [],
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: projectIndexInvalidator(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.project.read_tempo_map",
      "template.project.set_grid",
      "template.project.set_snap",
      "template.project.read_tempo_map",
    ]);
    assert.deepEqual(calls[1].input, { division: "1/8", swing: 0.2 });
    assert.deepEqual(calls[2].input, { enabled: true });
    assert.deepEqual(invalidations, [["project_head"]]);
    assert.equal(response.result.changes.length, 2);
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.deepEqual(
      response.result.changes.flatMap((change) => change.live_readback.fields.map((field) => [field.field, field.observed_value])),
      [["grid_division", "1/8"], ["grid_swing", 0.2], ["snap_enabled", true]],
    );
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("executes project time signature with the current BPM and verifies all marker fields", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "project",
          fields: { time_signature_numerator: 7, time_signature_denominator: 8 },
          dry_run: false,
        },
        refs: [],
      },
      executeAtomic: controlAtomic(calls, { initialProjectBpm: 123, initialProjectLinearTempo: true }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.project.read_tempo_map",
      "template.project.set_tempo_marker",
      "template.project.read_tempo_map",
    ]);
    assert.deepEqual(calls[1].input, {
      position_seconds: 0,
      bpm: 123,
      time_signature_numerator: 7,
      time_signature_denominator: 8,
    });
    assert.equal(response.result.data.readback.tempo_markers[0].linear_tempo, true);
    assert.deepEqual(response.result.data.readback_verification.map((row) => [row.field, row.observed]), [
      ["time_signature_numerator", 7],
      ["time_signature_denominator", 8],
    ]);
  });

  it("fails project grid truth when accepted atomic live readback disagrees", async () => {
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "project", fields: { grid_division: "1/8" }, dry_run: false },
        refs: [],
      },
      executeAtomic: controlAtomic([], { gridReadbackDivision: "1/4" }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "CONTROL_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "readback_failed");
    assert.equal(response.result.changes[0].live_readback.status, "failed");
  });

  it("fails project snap truth when the atomic result omits passed readback status", async () => {
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "project", fields: { snap_enabled: true }, dry_run: false },
        refs: [],
      },
      executeAtomic: controlAtomic([], { omitSnapReadbackStatus: true }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "CONTROL_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "readback_failed");
  });

  it("executes bounded changes rows with independent target resolution, readback, and index truth", async () => {
    const calls = [];
    const invalidations = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          changes: [
            { id: "lead_volume", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-A}" }, fields: { volume: 0.75 } },
            { id: "take_pan", target_kind: "take", refs: { item_ref: "item:guid:{ITEM-A}" }, fields: { pan: 0.25 } },
          ],
          dry_run: false,
        },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: projectIndexInvalidator(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result.changes.map((row) => row.operation_id), ["lead_volume", "take_pan"]);
    assert.equal(response.result.changes.every((row) => row.status === "applied"), true);
    assert.equal(response.result.changes.every((row) => row.mutation.status === "completed"), true);
    assert.equal(response.result.changes.every((row) => row.live_readback.status === "passed"), true);
    assert.equal(response.result.changes.every((row) => row.index_maintenance.status === "completed"), true);
    assert.deepEqual(invalidations, [["tracks"], ["items", "takes"]]);
    assert.equal(response.result.data.total_count, 2);
    assert.equal(response.result.data.applied_count, 2);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("preflights every changes row before mutation and defaults the batch to dry-run", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          changes: [
            { id: "track_a", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-A}" }, fields: { mute: true } },
            { id: "track_b", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-B}" }, fields: { pan: -0.2 } },
          ],
        },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.equal(calls.filter((call) => call.id === "template.tracks.resolve_track_ref").length, 2);
    assert.equal(calls.some((call) => call.id === "template.tracks.set_mute" || call.id === "template.tracks.set_pan"), false);
    assert.equal(response.result.changes.every((row) => row.status === "planned" && row.mutation.status === "not_run"), true);
    assert.equal(response.result.data.mutation_skipped, true);
    assert.equal(response.result.data.executable_retry.input.dry_run, false);
  });

  it("keeps earlier verified changes applied and stops later rows after one batch readback failure", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          changes: [
            { id: "first", target_kind: "take", refs: { item_ref: "item:guid:{ITEM-A}" }, fields: { pan: 0.25 } },
            { id: "bad", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-A}" }, fields: { volume: 0.75 } },
            { id: "never", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-B}" }, fields: { mute: true } },
          ],
          dry_run: false,
        },
      },
      executeAtomic: controlAtomic(calls, { readbackVolume: 0.5 }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "CONTROL_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[1].status, "failed");
    assert.equal(response.result.changes[1].mutation.status, "completed");
    assert.equal(response.result.changes[1].live_readback.status, "failed");
    assert.equal(response.result.changes[2].status, "not_run");
    assert.equal(response.result.changes[2].mutation.status, "not_run");
    const executedWriteIds = calls.filter((call) => call.id.startsWith("template.tracks.set_") || call.id === "template.items.set_take_pan").map((call) => call.id);
    assert.deepEqual(executedWriteIds, ["template.items.set_take_pan", "template.tracks.set_volume"]);
  });

  it("keeps a verified batch row applied when only its index maintenance fails", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          changes: [
            { id: "verified", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-A}" }, fields: { volume: 0.75 } },
            { id: "later", target_kind: "track", refs: { track_ref: "track:guid:{TRACK-B}" }, fields: { mute: true } },
          ],
          dry_run: false,
        },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:batch-index-failed", revision: 1 }),
        invalidateScopes: ({ scopes }) => ({
          ok: false,
          scopes,
          blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }],
        }),
      },
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "INDEX_WRITE_FAILED");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "failed");
    assert.equal(response.result.changes[1].status, "not_run");
    assert.equal(response.result.data.applied_count, 1);
    assert.equal(calls.some((call) => call.id === "template.tracks.set_mute"), false);
  });

  it("rejects malformed or conflicting changes rows before any live call", async () => {
    for (const input of [
      { changes: [], dry_run: false },
      { changes: [{ id: "dup", target_kind: "track", fields: { mute: true } }, { id: "dup", target_kind: "track", fields: { mute: false } }] },
      { changes: [{ id: "row", target_kind: "track", fields: { mute: true }, steps: [] }] },
      { changes: [{ id: "row", target_kind: "track", fields: { mute: true } }], target_kind: "track" },
    ]) {
      const calls = [];
      const response = await executeAlpha3_2_5CControlMacro({
        request: { id: "macro.controls.set", input },
        executeAtomic: controlAtomic(calls),
        now: () => new Date(NOW),
      });
      assert.equal(response.ok, false);
      assert.deepEqual(calls, []);
    }
  });

  it("normalizes project tempo during dry_run and performs no mutation", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "project", fields: { tempo: 126 }, dry_run: true },
        refs: [],
      },
      executeAtomic: controlAtomic(calls),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.deepEqual(calls.map((call) => call.id), ["template.project.read_tempo_map"]);
    assert.deepEqual(response.result.data.fields, { bpm: 126 });
    assert.deepEqual(response.result.data.registered_template_ids, ["template.project.set_bpm"]);
    assert.deepEqual(response.result.changes, []);
  });

  it("does not mark project BPM applied when dispatch succeeds but live readback differs", async () => {
    const calls = [];
    const invalidations = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "project", fields: { bpm: 128 }, dry_run: false },
        refs: [],
      },
      executeAtomic: controlAtomic(calls, { projectReadbackBpm: 127 }),
      projectIndexRuntime: projectIndexInvalidator(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "CONTROL_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].status, "readback_failed");
    assert.equal(response.result.changes[0].live_readback.status, "failed");
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
    assert.deepEqual(invalidations, [["project_head"]]);
    assert.equal(response.result.data.outcome.mutation.status, "completed");
    assert.equal(response.result.data.outcome.live_readback.status, "not_passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "completed");
    assert.equal(response.result.changes.some((change) => change.status === "applied"), false);
  });

  it("rejects invalid project BPM fields before any live call", async () => {
    for (const [fields, code] of [
      [{ bpm: 401 }, "CONTROL_BPM_INVALID"],
      [{ bpm: 120, tempo: 121 }, "CONTROL_FIELD_ALIAS_CONFLICT"],
      [{ bpm: 120, grid: "1/16" }, "FIELD_NOT_SUPPORTED"],
    ]) {
      const calls = [];
      const response = await executeAlpha3_2_5CControlMacro({
        request: { id: "macro.controls.set", input: { target_kind: "project", fields, dry_run: false }, refs: [] },
        executeAtomic: controlAtomic(calls),
        now: () => new Date(NOW),
      });
      assert.equal(response.ok, false);
      assert.equal(response.execution.status, "blocked");
      assert.equal(response.error.code, code);
      assert.deepEqual(calls, []);
    }
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

  it("returns canonical patches for duplicate Chinese Track names without choosing one", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: {
          target_kind: "track",
          fields: { mute: true },
          selector: { name: "对白 主轨" },
          dry_run: true,
        },
        refs: [],
        context: { session_id: "duplicate-chinese-track", request_sequence: 1 },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: readyTrackIndexRuntime([
        trackIndexRow({ ref: "track:guid:{TRACK-A}", name: "对白 主轨", index: 0 }),
        trackIndexRow({ ref: "track:guid:{TRACK-B}", name: "对白 主轨", index: 1 }),
      ]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "blocked");
    assert.equal(response.error.code, "SELECTOR_TARGET_AMBIGUOUS", JSON.stringify(response));
    assert.deepEqual(response.blockers[0].details, {
      entity: "tracks",
      candidate_count: 2,
      candidates_truncated: false,
      candidates: [
        {
          kind: "track",
          ref: "track:guid:{TRACK-A}",
          name: "对白 主轨",
          index: 0,
          request_patch: { refs: { track_ref: "track:guid:{TRACK-A}" } },
        },
        {
          kind: "track",
          ref: "track:guid:{TRACK-B}",
          name: "对白 主轨",
          index: 1,
          request_patch: { refs: { track_ref: "track:guid:{TRACK-B}" } },
        },
      ],
    });
    assert.equal(calls.some((call) => call.id === "template.tracks.resolve_track_ref"), false);
  });

  it("bounds duplicate FX candidates and returns owner, slot, and exact fx_ref patches", async () => {
    const calls = [];
    const rows = [0, 1, 2, 3].map((slotIndex) => ({
      ref: `fx:track:guid:{TRACK-A}:${slotIndex}`,
      owner_ref: "track:guid:{TRACK-A}",
      plugin_name: "VST3: 对白工具",
      plugin_id: "dialogue-tool",
      slot_index: slotIndex,
      bypassed: false,
      summary: { parameter_count: 16 },
    }));
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          mode: "exact_parameters",
          selector: { owner_ref: "track:guid:{TRACK-A}", plugin_id: "dialogue-tool" },
          dry_run: true,
          changes: [{ id: "band-1-frequency", param_index: 0, normalized_value: 0.5 }],
        },
        refs: [],
        context: { session_id: "duplicate-fx", request_sequence: 1 },
      },
      executeAtomic: stockAtomic(calls, new Map()),
      projectIndexRuntime: readyThirdPartyFxIndexRuntime(rows),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "blocked");
    assert.equal(response.error.code, "SELECTOR_TARGET_AMBIGUOUS", JSON.stringify(response));
    assert.equal(response.blockers[0].details.candidate_count, 3);
    assert.equal(response.blockers[0].details.candidates_truncated, true);
    assert.deepEqual(response.blockers[0].details.candidates, rows.slice(0, 3).map((row) => ({
      kind: "fx",
      ref: row.ref,
      owner_ref: row.owner_ref,
      plugin_name: row.plugin_name,
      slot_index: row.slot_index,
      request_patch: { refs: { fx_ref: row.ref } },
    })));
    assert.equal(calls.some((call) => call.id === "template.fx.resolve_fx_ref"), false);
  });

  it("blocks false Item-level pan before live resolution and points to explicit Active Take pan", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "item", fields: { pan: 0.25 }, dry_run: false },
        refs: { item_ref: "item:guid:{ITEM-A}" },
      },
      executeAtomic: controlAtomic(calls),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "blocked");
    assert.equal(response.error.code, "ITEM_PAN_UNSUPPORTED");
    assert.match(response.error.message, /target_kind=take/);
    assert.deepEqual(calls, []);
    assert.deepEqual(response.result.changes, []);
  });

  it("carries the exact accepted Template value into Active Take pan changes", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "take", fields: { pan: 0.25 }, dry_run: false },
        refs: { item_ref: "item:guid:{ITEM-A}" },
      },
      executeAtomic: controlAtomic(calls),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.set_take_pan",
      "template.items.read_item_summary",
    ]);
    assert.deepEqual(response.result.changes[0].live_readback, {
      status: "passed",
      classification: "passed_exact",
      source: "accepted_template_live_readback",
      fields: [{
        field: "pan",
        status: "passed",
        classification: "passed_exact",
        source: "accepted_template_live_readback",
        requested_value: 0.25,
        observed_value: 0.25,
        delta: 0,
      }],
    });
  });

  it("classifies a registered numeric epsilon difference as precision-equivalent live truth", async () => {
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "track", fields: { volume: 0.75 }, dry_run: false },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic([], { readbackVolume: 0.75005 }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    const field = response.result.changes[0].live_readback.fields[0];
    assert.equal(response.result.changes[0].live_readback.classification, "precision_equivalent");
    assert.equal(field.classification, "precision_equivalent");
    assert.equal(field.tolerance, 0.0001);
    assert.equal(field.tolerance_source, "registered_control_field");
    assert.equal(Math.abs(field.delta - 0.00005) < 1e-12, true);
    assert.deepEqual(response.result.data.outcome.live_readback.classifications, ["precision_equivalent"]);
  });

  it("classifies an atomic write rejection as mutation failure before readback", async () => {
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "track", fields: { volume: 0.75 }, dry_run: false },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic([], { failVolumeWrite: true }),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "failed");
    assert.equal(response.error.code, "TRACK_VOLUME_WRITE_FAILED");
    assert.equal(response.result.changes[0].status, "mutation_failed");
    assert.equal(response.result.changes[0].mutation.status, "failed");
    assert.equal(response.result.changes[0].live_readback.status, "not_run");
    assert.equal(response.result.data.outcome.mutation.status, "failed");
    assert.equal(response.result.data.outcome.live_readback.status, "not_passed");
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
    assert.equal(response.result.changes.every((change) => change.status !== "applied"), true);
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.classification, "live_mismatch");
    assert.equal(response.result.changes[0].live_readback.fields[0].classification, "live_mismatch");
  });

  it("keeps verified control rows applied when only index maintenance fails", async () => {
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.controls.set",
        input: { target_kind: "track", fields: { volume: 0.75 }, dry_run: false },
        refs: { track_ref: "track:guid:{TRACK-A}" },
      },
      executeAtomic: controlAtomic([]),
      projectIndexRuntime: {
        status: () => ({ snapshot_id: "snapshot:failed-index", revision: 1 }),
        invalidateScopes: ({ scopes }) => ({
          ok: false,
          scopes,
          blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }],
        }),
      },
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "INDEX_WRITE_FAILED");
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(response.result.changes.every((change) => change.index_maintenance.status === "failed"), true);
    assert.equal(response.result.verification.status, "passed");
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "failed");
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

  it("fails closed for unproven ReaComp semantic units and recovers via exact_parameters", async () => {
    const semanticCalls = [];
    const exactCalls = [];
    const values = new Map();
    const semantic = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          mode: "semantic",
          plugin: "reacomp",
          controls: { threshold_db: -18, ratio: 3 },
          dry_run: false,
        },
        refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
      },
      executeAtomic: stockAtomic(semanticCalls, values),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });
    assert.equal(semantic.ok, false, JSON.stringify(semantic));
    assert.equal(semantic.error.code, "STOCK_SEMANTIC_UNIT_UNPROVEN");
    assert.equal(semantic.result.data.next_call.arguments.id, "template.fx.list_fx_parameters");
    assert.deepEqual(semantic.result.data.next_call.arguments.input, { limit: 128, offset: 0 });
    assert.deepEqual(semanticCalls, []);

    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          mode: "exact_parameters",
          dry_run: false,
          changes: [
            { id: "threshold", param_index: 0, normalized_value: 0.4 },
            { id: "ratio", param_index: 1, normalized_value: 0.2 },
          ],
        },
        refs: { fx_ref: "fx:track:guid:{TRACK-A}:0" },
      },
      executeAtomic: stockAtomic(exactCalls, values),
      projectIndexRuntime: projectIndexInvalidator([]),
      now: () => new Date(NOW),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.macro.id, "macro.set_stock_plugin_controls");
    assert.deepEqual(exactCalls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.fx.resolve_fx_ref",
      "template.fx.list_fx_parameters",
      "template.fx.read_fx_parameter",
      "template.fx.read_fx_parameter",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.read_fx_parameter",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.read_fx_parameter",
    ]);
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(response.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(response.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("lets exact_parameters select an owner-scoped third-party FX without injecting stock_plugin=true", async () => {
    const calls = [];
    const values = new Map();
    const response = await executeAlpha3_2_5CControlMacro({
      request: {
        id: "macro.set_stock_plugin_controls",
        input: {
          mode: "exact_parameters",
          selector: { owner_ref: "track:guid:{TRACK-A}", plugin_id: "snapheap" },
          dry_run: true,
          changes: [{ id: "mix", param_index: 0, normalized_value: 0.5 }],
        },
        context: { session_id: "third-party-selector", request_sequence: 1 },
      },
      executeAtomic: stockAtomic(calls, values),
      projectIndexRuntime: readyThirdPartyFxIndexRuntime(),
      now: () => new Date(NOW),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.equal(response.sqlite.used, true);
    assert.equal(calls.some((call) => call.id === "template.fx.list_track_fx_chain"), true);
    assert.equal(calls.some((call) => call.id === "template.fx.set_fx_parameter_normalized"), false);
  });
});

function controlAtomic(calls, options = {}) {
  let projectBpm = options.initialProjectBpm ?? 120;
  let projectTimeSigNum = 4;
  let projectTimeSigDenom = 4;
  let projectLinearTempo = options.initialProjectLinearTempo === true;
  return async ({ id, input = {}, refs = {} }) => {
    calls.push({ id, input, refs });
    if (id === "template.project.read_summary") {
      return execution(id, { project_ref: "project:active", change_count: 1 });
    }
    if (id === "template.project.read_tempo_map") {
      return execution(id, {
        tempo_markers: [{ index: 0, time_seconds: 0, bpm: options.projectReadbackBpm ?? projectBpm, time_sig_num: projectTimeSigNum, time_sig_denom: projectTimeSigDenom, linear_tempo: projectLinearTempo }],
        effective: [{ time_seconds: 0, bpm: options.projectReadbackBpm ?? projectBpm, time_sig_num: projectTimeSigNum, time_sig_denom: projectTimeSigDenom }],
        truncated: false,
      });
    }
    if (id === "template.project.set_bpm") {
      projectBpm = input.bpm;
      return execution(id, {
        project_ref: "project:current",
        bpm: input.bpm,
        requested_bpm: input.bpm,
        updated: true,
        readback_status: "passed",
      });
    }
    if (id === "template.project.set_tempo_marker") {
      projectBpm = input.bpm;
      projectTimeSigNum = input.time_signature_numerator;
      projectTimeSigDenom = input.time_signature_denominator;
      if (typeof input.linear_tempo === "boolean") projectLinearTempo = input.linear_tempo;
      return execution(id, {
        project_ref: "project:current",
        position_seconds: input.position_seconds,
        bpm: input.bpm,
        time_sig_num: projectTimeSigNum,
        time_sig_denom: projectTimeSigDenom,
        linear_tempo: projectLinearTempo,
        updated: true,
        readback_status: "passed",
      });
    }
    if (id === "template.project.set_grid") {
      return execution(id, {
        project_ref: "project:current",
        division: options.gridReadbackDivision ?? input.division,
        division_qn: 0.5,
        swingmode: input.swing > 0 ? 1 : 0,
        swing: options.gridReadbackSwing ?? input.swing ?? 0,
        updated: true,
        readback_status: "passed",
      });
    }
    if (id === "template.project.set_snap") {
      return execution(id, {
        project_ref: "project:current",
        enabled: options.snapReadbackEnabled ?? input.enabled,
        updated: true,
        ...(!options.omitSnapReadbackStatus ? { readback_status: "passed" } : {}),
      });
    }
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: options.resolvedTrackRef ?? input.track_ref, name: "Lead Vocal" });
    }
    if (id === "template.items.resolve_item_ref") {
      return execution(id, {
        item_ref: input.ref,
        track_ref: "track:guid:{TRACK-A}",
        active_take_ref: "take:guid:{TAKE-A}",
      });
    }
    if (id === "template.items.set_take_pan") {
      return execution(id, {
        item_ref: typeof refs.item_ref === "string" ? refs.item_ref : refs.item_ref?.ref,
        active_take_ref: "take:guid:{TAKE-A}",
        pan: input.pan,
        take_pan: input.pan,
        readback_status: "passed",
      });
    }
    if (id === "template.items.read_item_summary") {
      return execution(id, {
        item_ref: typeof refs.item_ref === "string" ? refs.item_ref : refs.item_ref?.ref,
        active_take_ref: "take:guid:{TAKE-A}",
        take_count: 1,
      });
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
    if (id === "template.tracks.set_volume" && options.failVolumeWrite) {
      return {
        contract: "template.execution.v1",
        ok: false,
        request: { id: `evidence:${id}` },
        result: null,
        error: { code: "TRACK_VOLUME_WRITE_FAILED", message: "Fixture rejected the Track volume write." },
      };
    }
    return execution(id, { ...input, track_ref: refs.track_ref });
  };
}

function stockAtomic(calls, values) {
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (id === "template.project.read_summary") {
      return execution(id, { project_ref: "project:active", change_count: 1 });
    }
    if (id === "template.tracks.resolve_track_ref") {
      return execution(id, { track_ref: input.track_ref, name: "Lead Vocal" });
    }
    if (id === "template.fx.list_track_fx_chain") {
      const ownerRef = typeof refs.track_ref === "string" ? refs.track_ref : refs.track_ref?.ref;
      const result = execution(id, {
        owner_ref: ownerRef,
        track_ref: ownerRef,
        fx_count: 1,
        fx: [{
          ref: `fx:${ownerRef}:0`,
          owner_ref: ownerRef,
          plugin_name: "VST3: Snap Heap (Kilohearts)",
          plugin_id: "snapheap",
          slot_index: 0,
          bypassed: false,
        }],
        truncated: false,
      });
      result.result.project_index_observation = { ok: true, blockers: [] };
      return result;
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
        parameter_count: 2,
        parameters: [
          { param_index: 0, name: "Threshold", normalized_value: 0.5, param_ident: "threshold" },
          { param_index: 1, name: "Ratio", normalized_value: 0.1, param_ident: "ratio" },
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
      return execution(id, {
        fx_ref: refs.fx_ref,
        param_index: input.param_index,
        param_ident: input.param_index === 0 ? "threshold" : "ratio",
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
      const normalizedValue = input.probe_normalized_value ?? values.get(input.param_index);
      return execution(id, {
        fx_ref: refs.fx_ref,
        param_index: input.param_index,
        param_ident: input.param_index === 0 ? "threshold" : "ratio",
        normalized_value: normalizedValue,
        formatted_value: String(normalizedValue),
        step_sizes_available: false,
        step_size: null,
        is_toggle: null,
        is_discrete: false,
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

function readyTrackIndexRuntime(rows = [trackIndexRow()]) {
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
    rows,
    coverage_status: "complete",
    freshness_status: "fresh",
  });
  return {
    adapter,
    status: () => ({
      ...adapter.snapshot(),
      rows_available: true,
      row_counts: { tracks: rows.length },
    }),
    reconcileProjectRevision: () => ({ ok: true, changed: false }),
    invalidateScopes: ({ scopes }) => ({ ok: true, scopes }),
  };
}

function trackIndexRow(overrides = {}) {
  return {
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
    ...overrides,
  };
}

function readyThirdPartyFxIndexRuntime(rows = [{
  ref: "fx:track:guid:{TRACK-A}:0",
  owner_ref: "track:guid:{TRACK-A}",
  plugin_name: "VST3: Snap Heap (Kilohearts)",
  plugin_id: "snapheap",
  slot_index: 0,
  bypassed: false,
  summary: { parameter_count: 2 },
}]) {
  const adapter = createAlpha3C3ProjectIndex({
    now: () => new Date(NOW),
    projectRef: "project:active",
    bridgeOwner: "owner-controls",
    bridgeGeneration: 1,
    sessionId: "session:controls",
  });
  const ownerRefs = [...new Set(rows.map((row) => row.owner_ref).filter((ref) => typeof ref === "string"))];
  adapter.replaceTracks({
    snapshot_id: "snapshot:controls:fx-owners",
    observed_at: NOW,
    rows: ownerRefs.map((ref, index) => trackIndexRow({ ref, name: `FX Owner ${index + 1}`, index })),
    coverage_status: "complete",
    freshness_status: "fresh",
  });
  adapter.replaceFx({
    snapshot_id: "snapshot:controls:fx",
    observed_at: NOW,
    rows,
    coverage_status: "complete",
    freshness_status: "fresh",
  });
  return {
    adapter,
    status: () => ({
      ...adapter.snapshot(),
      rows_available: true,
      row_counts: { tracks: ownerRefs.length, fx: rows.length },
    }),
    reconcileProjectRevision: () => ({ ok: true, changed: false }),
    invalidateScopes: ({ scopes }) => ({ ok: true, scopes }),
  };
}
