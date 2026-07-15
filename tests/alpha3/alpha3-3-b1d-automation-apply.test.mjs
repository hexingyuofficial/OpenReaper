import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { createObjectRef } from "../../packages/core/src/foundation-bridge-v1.mjs";
import { buildTemplateBridgeRequest } from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createWave2AAutomationTemplates } from "../../packages/core/src/template-packs/wave2a-automation-templates-v1.mjs";

import {
  ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES,
  ALPHA3_3_B1D_AUTOMATION_APPLY_MODES,
  ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY,
  ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS,
  createAlpha3_3B1dAutomationApplyDiscoveryItems,
  createAlpha3_3B1dAutomationApplyExactManual,
  executeAlpha3_3B1dAutomationApplyMacro,
} from "../../packages/mcp-server/src/alpha3-3-b1d-automation-apply-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const NOW = "2026-07-14T02:00:00.000Z";
const ENV_A = "envelope:guid:{ENV-A}";
const ENV_B = "envelope:guid:{ENV-B}";
const TRACK_A = "track:guid:{TRACK-A}";
const FX_TRACK = "fx:track:guid:{TRACK-A}:0";
const FX_TAKE = "fx:take:guid:{TAKE-A}:0";
const ENV_FX_TRACK = "envelope:guid:{ENV-FX-TRACK}";
const ENV_FX_TAKE = "envelope:guid:{ENV-FX-TAKE}";

describe("Alpha3.3-B1d executable macro.automation.apply", () => {
  it("registers one fixed exact-live program and publishes explicit held atomic gaps", () => {
    assert.deepEqual(ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY.ids, ["macro.automation.apply"]);
    const entry = ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY.entries[0];
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.risk, "write");
    assert.equal(entry.selector_policy.canonical_refs_optional_at_public_boundary, false);
    assert.equal(entry.selector_policy.live_reresolve_before_write, true);
    assert.equal(entry.sqlite_policy.write_authority, false);
    assert.equal(entry.undo_policy, "per_stage_undo");
    assert.deepEqual(entry.dependencies.template_ids, ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS);
    assert.equal(JSON.stringify(entry.input_schema).includes("steps"), false);

    const discovery = createAlpha3_3B1dAutomationApplyDiscoveryItems({ liveRunnableNow: true })[0];
    assert.deepEqual(discovery.supported_modes, ALPHA3_3_B1D_AUTOMATION_APPLY_MODES);
    assert.deepEqual(discovery.held_modes, ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES);
    assert.deepEqual(discovery.limits, { envelope_targets: 8, track_targets: 8, fx_targets: 8, total_inserted_points: 64 });
    const manual = createAlpha3_3B1dAutomationApplyExactManual().action_manual;
    assert.match(manual.when_to_use.join(" "), /Automation Item deletion/u);
    assert.match(manual.when_to_use.join(" "), /Take-FX/u);
    assert.match(manual.readback_steps.join(" "), /complete pre\/post point tuples/u);
    assert.match(manual.common_blockers.map((row) => row.code).join(" "), /AUTOMATION_CONFIRMATION_TOKEN_REQUIRED/u);
    assert.match(manual.common_blockers.map((row) => row.code).join(" "), /AUTOMATION_COMPLETE_READBACK_REQUIRED/u);
  });

  it("passes a GUID-first Envelope ref unchanged through the real Template ref validator", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_lane_state", envelope_refs: [ENV_A], lane_state: { visible: true } }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    const captured = bridge.calls[0].refs.envelope_ref;
    assert.deepEqual(captured, createObjectRef("envelope", { scheme: "guid", value: "{ENV-A}" }));
    const descriptor = createWave2AAutomationTemplates().find((entry) => entry.id === "template.automation.read_envelope_summary");
    const foundationRequest = buildTemplateBridgeRequest({
      descriptor,
      input: {},
      refs: { envelope_ref: captured },
      context: { session_id: "session:b1d-ref", request_id: "request:b1d-ref", expected_owner: "owner", expected_generation: 1, request_sequence: 1 },
    });
    assert.deepEqual(foundationRequest.refs[0], captured);
  });

  it("dry-runs exact Envelope point work live without SQLite or mutation", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5), point(2, 0.75)] }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.equal(result.sqlite.used, false);
    assert.equal(result.result.data.exact_live_identity, true);
    assert.equal(result.result.data.sqlite_write_authority, false);
    assert.equal(result.result.changes[0].status, "planned");
    assert.equal(bridge.calls.some((call) => isMutation(call.id)), false);
    assert.deepEqual(bridge.envelopes.get(ENV_A).points, []);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("inserts a bounded point batch and derives applied only from complete pre/post live points", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5), point(2, 0.75)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.automation.read_envelope_points",
      "template.automation.insert_envelope_points_batch",
      "template.automation.read_envelope_points",
    ]);
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].mutation, { status: "completed", template_id: "template.automation.insert_envelope_points_batch" });
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_envelope_points", requested: 2, replaced: 0, net_new: 2, before: 1, after: 3 });
    assert.equal(result.result.changes[0].index_maintenance.status, "skipped");
    assert.equal(result.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("treats identical and colliding point tuples as bounded overlays", async () => {
    for (const scenario of [
      {
        before: [point(1, 0.5)],
        requested: [point(1, 0.5)],
        facts: { requested: 1, replaced: 1, net_new: 0, before: 1, after: 1 },
      },
      {
        before: [point(1, 0.25), point(3, 0.4)],
        requested: [point(1, 0.75), point(2, 0.6)],
        facts: { requested: 2, replaced: 1, net_new: 1, before: 2, after: 3 },
      },
    ]) {
      const bridge = new FakeAutomationBridge({ initialPoints: scenario.before });
      const result = await executeAlpha3_3B1dAutomationApplyMacro({
        request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: scenario.requested, dry_run: false }),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_envelope_points", ...scenario.facts });
    }
  });

  it("rejects duplicate requested Envelope times before mutation", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5), point(1, 0.75)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_DUPLICATE_POINT_TIME");
    assert.equal(bridge.calls.some((call) => call.id === "template.automation.insert_envelope_points_batch"), false);
    assert.deepEqual(bridge.envelopes.get(ENV_A).points, [point(0, 0.25)]);
  });

  it("allows a full 64-for-64 replacement and rejects a 65-point final overlay", async () => {
    const existing = Array.from({ length: 64 }, (_, index) => point(index, 0.1));
    const replacements = Array.from({ length: 64 }, (_, index) => point(index, 0.9));
    const acceptedBridge = new FakeAutomationBridge({ initialPoints: existing });
    const accepted = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: replacements, dry_run: false }),
      executeAtomic: acceptedBridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(accepted.ok, true, JSON.stringify(accepted));
    assert.deepEqual(accepted.result.changes[0].live_readback, { status: "passed", source: "live_envelope_points", requested: 64, replaced: 64, net_new: 0, before: 64, after: 64 });

    const rejectedBridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.1), point(100, 0.2)] });
    const rejected = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: replacements, dry_run: false }),
      executeAtomic: rejectedBridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(rejected.ok, false);
    assert.equal(rejected.error.code, "AUTOMATION_COMPLETE_READBACK_REQUIRED");
    assert.equal(rejectedBridge.calls.some((call) => call.id === "template.automation.insert_envelope_points_batch"), false);
  });

  it("sets an exact Track to safe read mode and verifies through the native read Template", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_track_mode", track_refs: [TRACK_A], track_mode: "read", dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.automation.read_track_automation_mode",
      "template.automation.set_track_automation_mode",
      "template.automation.read_track_automation_mode",
    ]);
    assert.equal(bridge.tracks.get(TRACK_A).mode, "read");
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_track_automation_mode", mode: "read" });
  });

  it("rejects a Track resolver identity change before automation-mode mutation", async () => {
    const bridge = new FakeAutomationBridge({ resolvedTrackRef: "track:guid:{WRONG}" });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_track_mode", track_refs: [TRACK_A], track_mode: "read", dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_TARGET_IDENTITY_MISMATCH");
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.tracks.resolve_track_ref"]);
    assert.equal(bridge.calls.some((call) => call.id === "template.automation.set_track_automation_mode"), false);
  });

  it("writes BR-backed lane state and independently re-reads every requested field", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_lane_state", envelope_refs: [ENV_A], lane_state: { visible: true, show_lane: true, armed: true }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.automation.read_envelope_summary",
      "template.automation.set_envelope_lane_state",
      "template.automation.read_envelope_summary",
    ]);
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_envelope_summary", visible: true, show_lane: true, armed: true });
  });

  it("creates one empty Automation Item and proves the unique new live index and bounds", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "create_automation_item", envelope_refs: [ENV_A], automation_item: { position_seconds: 3, length_seconds: 2, pool_mode: "new_empty" }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.automation.read_automation_items",
      "template.automation.create_automation_item",
      "template.automation.read_automation_items",
    ]);
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_automation_items", automation_item_index: 0, position_seconds: 3, length_seconds: 2, pool_id: 1 });
  });

  it("writes an existing ordinary Take Pan Envelope with project-time and live negative range truth", async () => {
    const bridge = new FakeAutomationBridge();
    const env = bridge.envelopes.get(ENV_B);
    env.parent_kind = "take";
    env.envelope_type = "pan";
    env.min_value = -1;
    env.max_value = 1;
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_take_points", envelope_refs: [ENV_B], points: [point(3, -0.5)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(bridge.envelopes.get(ENV_B).points[0].value, -0.5);
    assert.equal(result.result.changes[0].requested.time_basis, "project");
  });

  it("previews and deletes one exact Automation Item with a current confirmation token", async () => {
    const bridge = new FakeAutomationBridge({ initialItems: [
      { automation_item_index: 0, position_seconds: 1, length_seconds: 2, pool_id: 7, selected: true },
      { automation_item_index: 1, position_seconds: 5, length_seconds: 1, pool_id: 8 },
    ] });
    const preview = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "delete_automation_item", envelope_refs: [ENV_A], automation_item_delete: { automation_item_index: 0 } }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.match(preview.result.data.confirmation.token, /^automation-confirmation:v1:[a-f0-9]{64}$/u);
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request(preview.result.data.confirmation.retry.input),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_automation_items", automation_item_index: 0, deleted_count: 1, before_count: 2, after_count: 1, target_absent: true });
    assert.equal(bridge.envelopes.get(ENV_A).items[0].pool_id, 8);
  });

  it("inserts Track-FX parameter points through independent mapping, ensure, GUID readback, and generic point write", async () => {
    const bridge = new FakeAutomationBridge({ initialFxPoints: [point(0, 0.2)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_fx_parameter_points", fx_refs: [FX_TRACK], fx_parameter: { param_index: 0, param_ident: "gain" }, points: [point(2, 0.8)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[0].live_readback.envelope_ref, ENV_FX_TRACK);
    assert.equal(result.result.changes[0].live_readback.created_envelope, false);
    assert.equal(bridge.envelopes.get(ENV_FX_TRACK).points.length, 2);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.fx.parameter_to_envelope_mapping",
      "template.automation.read_envelope_points",
      "template.automation.ensure_fx_parameter_envelope",
      "template.fx.parameter_to_envelope_mapping",
      "template.automation.read_envelope_points",
      "template.automation.insert_envelope_points_batch",
      "template.fx.parameter_to_envelope_mapping",
      "template.automation.read_envelope_points",
    ]);
  });

  it("creates a missing Take-FX parameter Envelope natively, then writes and independently proves its GUID points", async () => {
    const bridge = new FakeAutomationBridge({ missingTakeFxEnvelope: true, newFxEnvelopePoints: [point(0, 0.5)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_take_fx_parameter_points", fx_refs: [FX_TAKE], fx_parameter: { param_index: 0, param_ident: "take_gain" }, points: [point(0, 0.6)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes[0].live_readback.owner_kind, "take");
    assert.equal(result.result.changes[0].live_readback.created_envelope, true);
    assert.equal(result.result.changes[0].live_readback.envelope_ref, ENV_FX_TAKE);
    assert.equal(result.result.changes[0].live_readback.replaced, 1);
    assert.equal(result.result.changes[0].live_readback.net_new, 0);
    assert.equal(bridge.envelopes.get(ENV_FX_TAKE).points[0].value, 0.6);
  });

  it("updates one existing point and independently proves the full tuple/count transition", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25), point(1, 0.5)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "update_point", envelope_refs: [ENV_A], point_update: { autoitem_index: -1, point_index: 1, time_seconds: 1.5, value: 0.8 }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.automation.read_envelope_points", "template.automation.set_envelope_point", "template.automation.read_envelope_points"]);
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[0].live_readback.point_count, 2);
    assert.equal(bridge.envelopes.get(ENV_A).points[1].time_seconds, 1.5);
    assertCallsValidateThroughHarness(bridge.calls, ["template.automation.set_envelope_point"]);
  });

  it("blocks an out-of-range point update from the live Envelope value domain before mutation", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "update_point", envelope_refs: [ENV_A], point_update: { point_index: 0, value: 5 }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_POINT_VALUE_OUT_OF_RANGE");
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.automation.read_envelope_points"]);
    assert.equal(bridge.envelopes.get(ENV_A).points[0].value, 0.25);
  });

  it("updates every supported Automation Item bounds field with independent Item-list readback", async () => {
    const bridge = new FakeAutomationBridge({ initialItems: [{ automation_item_index: 0, position_seconds: 1, length_seconds: 2, pool_id: -1 }] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_automation_item_bounds", envelope_refs: [ENV_A], automation_item_bounds: { automation_item_index: 0, position_seconds: 4, length_seconds: 3, start_offset_seconds: 0.5, playrate: 1.25 }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.automation.read_automation_items", "template.automation.set_automation_item_bounds", "template.automation.read_automation_items"]);
    assert.deepEqual(result.result.changes[0].live_readback, { status: "passed", source: "live_automation_items", automation_item_index: 0, position_seconds: 4, length_seconds: 3, start_offset_seconds: 0.5, playrate: 1.25 });
    assertCallsValidateThroughHarness(bridge.calls, ["template.automation.set_automation_item_bounds"]);
  });

  it("previews exact point deletion with a deterministic executable token, then executes that retry", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25), point(1, 0.5), point(2, 0.75)] });
    const preview = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "delete_point", envelope_refs: [ENV_A], point_delete: { autoitem_index: -1, point_index: 1 } }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(preview.ok, true, JSON.stringify(preview));
    assert.equal(preview.execution.status, "dry_run_completed");
    assert.match(preview.result.data.confirmation.token, /^automation-confirmation:v1:[a-f0-9]{64}$/u);
    assert.equal(preview.result.changes[0].requested.before_count, 3);
    assert.deepEqual(preview.result.changes[0].requested.current_point, { point_index: 1, ...point(1, 0.5) });
    assert.deepEqual(preview.result.data.confirmation.retry.input.confirmation_token, preview.result.data.confirmation.token);
    assert.equal(bridge.calls.some((call) => call.id === "template.automation.delete_envelope_points"), false);

    const executed = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request(preview.result.data.confirmation.retry.input),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(executed.ok, true, JSON.stringify(executed));
    assert.equal(executed.result.changes[0].status, "applied");
    assert.deepEqual(executed.result.changes[0].live_readback, { status: "passed", source: "live_envelope_points", autoitem_index: -1, deleted_count: 1, before_count: 3, after_count: 2 });
    assert.deepEqual(bridge.envelopes.get(ENV_A).points.map((row) => row.time_seconds), [0, 2]);
    assertCallsValidateThroughHarness(bridge.calls, ["template.automation.delete_envelope_points"]);
  });

  it("rejects a stale deletion token before mutation when the current lane changes", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25), point(1, 0.5)] });
    const preview = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "delete_point", envelope_refs: [ENV_A], point_delete: { point_index: 1 } }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    bridge.envelopes.get(ENV_A).points.push(point(2, 0.75));
    sortPoints(bridge.envelopes.get(ENV_A).points);
    const beforeDeleteCalls = bridge.calls.filter((call) => call.id === "template.automation.delete_envelope_points").length;
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request(preview.result.data.confirmation.retry.input),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_CONFIRMATION_TOKEN_STALE");
    assert.equal(bridge.calls.filter((call) => call.id === "template.automation.delete_envelope_points").length, beforeDeleteCalls);
  });

  it("requires a preview token after live preflight and never treats boolean confirmation as executable", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(0, 0.25)] });
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: { ...request({ mode: "delete_point", envelope_refs: [ENV_A], point_delete: { point_index: 0 }, dry_run: false }), confirmation: true },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_CONFIRMATION_TOKEN_REQUIRED");
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.automation.read_envelope_points"]);
    assert.equal(bridge.calls.some((call) => call.id === "template.automation.delete_envelope_points"), false);
  });

  it("deletes a half-open range and preserves the exact end_seconds point", async () => {
    const bridge = new FakeAutomationBridge({ initialPoints: [point(1, 0.25), point(2, 0.5), point(3, 0.75)] });
    const preview = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "delete_point_range", envelope_refs: [ENV_A], point_range: { start_seconds: 1, end_seconds: 3 } }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(preview.result.changes[0].requested.matching_count, 2);
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request(preview.result.data.confirmation.retry.input),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.envelopes.get(ENV_A).points.map((row) => row.time_seconds), [3]);
    assert.equal(result.result.changes[0].live_readback.interval, "half_open");
    assert.equal(result.result.changes[0].live_readback.deleted_count, 2);
    assertCallsValidateThroughHarness(bridge.calls, ["template.automation.delete_envelope_points"]);
  });

  it("rejects mutation success when complete point readback omits one requested row", async () => {
    const bridge = new FakeAutomationBridge({ dropLastInsertedPoint: true });
    const invalidations = [];
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5), point(2, 0.75)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "AUTOMATION_READBACK_MISMATCH");
    assert.equal(result.result.changes[0].status, "readback_failed");
    assert.equal(result.result.changes[0].mutation.status, "completed");
    assert.equal(result.result.changes[0].live_readback.status, "failed");
    assert.equal(result.result.changes[0].index_maintenance.status, "completed");
    assert.deepEqual(invalidations, [["automation"]]);
  });

  it("rejects overlays whose after-readback loses an old tuple or gains an extra tuple", async () => {
    for (const options of [
      { removeOldPointAfterMutation: 3 },
      { addExtraPointAfterMutation: point(9, 0.9) },
    ]) {
      const bridge = new FakeAutomationBridge({ initialPoints: [point(1, 0.25), point(3, 0.5)], ...options });
      const result = await executeAlpha3_3B1dAutomationApplyMacro({
        request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.75)], dry_run: false }),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "AUTOMATION_READBACK_MISMATCH");
      assert.equal(result.result.changes[0].status, "readback_failed");
      assert.equal(result.result.changes[0].live_readback.status, "failed");
    }
  });

  it("marks a failed write child unknown_or_partial, re-reads live, and still invalidates Automation", async () => {
    const bridge = new FakeAutomationBridge({ partialBatchFailure: true });
    const invalidations = [];
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5), point(2, 0.75)], dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });
    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "COMMAND_FAILED");
    assert.equal(result.result.changes[0].mutation.status, "unknown_or_partial");
    assert.equal(result.result.changes[0].mutation.details.mutation_applied, true);
    assert.equal(result.result.changes[0].live_readback.status, "failed");
    assert.equal(result.result.changes[0].index_maintenance.status, "completed");
    assert.deepEqual(invalidations, [["automation"]]);
  });

  it("keeps verified REAPER writes applied when only index maintenance fails", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: request({ mode: "set_track_mode", track_refs: [TRACK_A], track_mode: "read", dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex([], { fail: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "INDEX_WRITE_FAILED");
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[0].live_readback.status, "passed");
    assert.deepEqual(result.result.changes[0].index_maintenance, { status: "failed", scopes: ["tracks", "automation"], blocker_code: "INDEX_WRITE_FAILED" });
    assert.equal(result.result.verification.status, "passed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("blocks destructive and missing-atom surfaces before every live child call", async () => {
    const cases = [
      [{ mode: "delete_automation_item", envelope_refs: [ENV_A], dry_run: false }, "AUTOMATION_ITEM_DELETE_REQUIRED"],
      [{ mode: "insert_fx_parameter_points", envelope_refs: [ENV_A], points: [point(1, 0.5)], fx_parameter: { param_index: 0 }, dry_run: false }, "AUTOMATION_REQUEST_INVALID"],
      [{ mode: "set_track_mode", track_refs: [TRACK_A], track_mode: "write", dry_run: false }, "AUTOMATION_REALTIME_MODE_HELD"],
      [{ mode: "delete_point", envelope_refs: [ENV_A], point_delete: { point_index: 0 }, confirmation: true, dry_run: false }, "AUTOMATION_CONFIRMATION_TOKEN_REQUIRED"],
      [{ mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5)], steps: [], dry_run: false }, "AUTOMATION_REQUEST_INVALID"],
    ];
    for (const [input, code] of cases) {
      const bridge = new FakeAutomationBridge();
      const result = await executeAlpha3_3B1dAutomationApplyMacro({ request: request(input), executeAtomic: bridge.executeAtomic, now: () => new Date(NOW) });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, code);
      assert.equal(bridge.calls.length, 0);
      assert.equal(result.result.changes.length, 0);
      assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
    }
  });

  it("fails non-idempotent point and Automation Item requests closed instead of pretending replay safety", async () => {
    for (const input of [
      { mode: "insert_points", envelope_refs: [ENV_A], points: [point(1, 0.5)], dry_run: false },
      { mode: "create_automation_item", envelope_refs: [ENV_A], automation_item: { position_seconds: 1, length_seconds: 1, pool_mode: "new_empty" }, dry_run: false },
    ]) {
      const bridge = new FakeAutomationBridge();
      const result = await executeAlpha3_3B1dAutomationApplyMacro({
        request: { ...request(input), idempotency_key: "replay-key" },
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "AUTOMATION_IDEMPOTENCY_UNSUPPORTED");
      assert.equal(bridge.calls.length, 0);
    }
  });

  it("preflights the response budget after exact reads and before mutation", async () => {
    const bridge = new FakeAutomationBridge();
    const result = await executeAlpha3_3B1dAutomationApplyMacro({
      request: { ...request({ mode: "insert_points", envelope_refs: [ENV_A, ENV_B], points: [point(1, 0), point(2, 1)], dry_run: false }), budget: { max_response_bytes: 2_048 } },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "AUTOMATION_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(bridge.calls.some((call) => isMutation(call.id)), false);
    assert.equal(result.budget.actual_bytes <= 2_048, true);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });
});

class FakeAutomationBridge {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.envelopes = new Map([
      [ENV_A, envelope(ENV_A, "volume", options.initialPoints ?? [])],
      [ENV_B, envelope(ENV_B, "mute", [])],
    ]);
    if (Array.isArray(options.initialItems)) this.envelopes.get(ENV_A).items = options.initialItems.map(automationItem);
    this.tracks = new Map([[TRACK_A, { track_ref: TRACK_A, mode: "trim_read" }]]);
    this.fx = new Map([
      [FX_TRACK, { fx_ref: FX_TRACK, owner_kind: "track", owner_ref: TRACK_A, slot_index: 0, param_index: 0, param_ident: "gain", parameter_name: "Gain", envelope_ref: options.missingTrackFxEnvelope ? null : ENV_FX_TRACK }],
      [FX_TAKE, { fx_ref: FX_TAKE, owner_kind: "take", owner_ref: "take:guid:{TAKE-A}", slot_index: 0, param_index: 0, param_ident: "take_gain", parameter_name: "Take Gain", envelope_ref: options.missingTakeFxEnvelope ? null : ENV_FX_TAKE }],
    ]);
    if (!options.missingTrackFxEnvelope) this.envelopes.set(ENV_FX_TRACK, envelope(ENV_FX_TRACK, "fx_parameter", options.initialFxPoints ?? []));
    if (!options.missingTakeFxEnvelope) this.envelopes.set(ENV_FX_TAKE, envelope(ENV_FX_TAKE, "fx_parameter", options.initialTakeFxPoints ?? []));
    this.executeAtomic = this.executeAtomic.bind(this);
  }

  async executeAtomic({ id, input = {}, refs = {}, budget, observeProjectIndex }) {
    this.calls.push({ id, input: structuredClone(input), refs: structuredClone(refs), budget, observeProjectIndex });
    if (id === "template.tracks.resolve_track_ref") {
      const track = this.tracks.get(input.track_ref);
      if (!track) return failure(id, "TRACK_NOT_FOUND");
      const resolvedRef = this.options.resolvedTrackRef ?? track.track_ref;
      return execution(id, { ...track, track_ref: resolvedRef }, [trackRef(resolvedRef)]);
    }
    if (id === "template.automation.read_track_automation_mode") {
      const track = this.tracks.get(refs.track_ref?.ref);
      return track ? execution(id, track, [trackRef(track.track_ref)]) : failure(id, "TRACK_NOT_FOUND");
    }
    if (id === "template.automation.set_track_automation_mode") {
      const track = this.tracks.get(refs.track_ref?.ref);
      if (!track) return failure(id, "TRACK_NOT_FOUND");
      track.mode = input.mode;
      return execution(id, track, [trackRef(track.track_ref)]);
    }
    if (id === "template.fx.parameter_to_envelope_mapping") {
      const fx = this.fx.get(refs.fx_ref?.ref);
      if (!fx || fx.param_index !== input.param_index || input.param_ident && input.param_ident !== fx.param_ident) return failure(id, "FX_PARAMETER_NOT_FOUND");
      return execution(id, { ...fx, envelope_exists: fx.envelope_ref !== null }, [fxRef(fx.fx_ref), ...(fx.envelope_ref ? [envelopeRef(fx.envelope_ref)] : [])]);
    }
    if (id === "template.automation.ensure_fx_parameter_envelope") {
      const fx = this.fx.get(refs.fx_ref?.ref);
      if (!fx || fx.param_index !== input.param_index || input.param_ident && input.param_ident !== fx.param_ident) return failure(id, "FX_PARAMETER_NOT_FOUND");
      const created = fx.envelope_ref === null;
      if (created) {
        fx.envelope_ref = fx.owner_kind === "take" ? ENV_FX_TAKE : ENV_FX_TRACK;
        this.envelopes.set(fx.envelope_ref, envelope(fx.envelope_ref, "fx_parameter", this.options.newFxEnvelopePoints ?? []));
      }
      return execution(id, { ...fx, envelope_exists: true, created }, [fxRef(fx.fx_ref), envelopeRef(fx.envelope_ref)]);
    }

    const ref = refs.envelope_ref?.ref;
    const env = this.envelopes.get(ref);
    if (!env) return failure(id, "ENVELOPE_NOT_FOUND");
    if (id === "template.automation.read_envelope_summary") return execution(id, envelopeSummary(env), [envelopeRef(ref)]);
    if (id === "template.automation.read_envelope_points") return execution(id, pointsSummary(env, input.autoitem_index ?? -1), [envelopeRef(ref)]);
    if (id === "template.automation.insert_envelope_points_batch") {
      const inserted = this.options.dropLastInsertedPoint ? input.points.slice(0, -1) : input.points;
      if (this.options.partialBatchFailure) {
        upsertPoint(env.points, input.points[0]);
        sortPoints(env.points);
        return failure(id, "COMMAND_FAILED", { mutation_applied: true, inserted_before_failure: 1 }, false);
      }
      for (const row of inserted) upsertPoint(env.points, row);
      if (this.options.removeOldPointAfterMutation) {
        const removeIndex = env.points.findIndex((row) => row.time_seconds === this.options.removeOldPointAfterMutation);
        if (removeIndex >= 0) env.points.splice(removeIndex, 1);
      }
      if (this.options.addExtraPointAfterMutation) env.points.push(structuredClone(this.options.addExtraPointAfterMutation));
      sortPoints(env.points);
      return execution(id, { ...envelopeSummary(env), requested: input.points.length, first_time_seconds: input.points[0].time_seconds, last_time_seconds: input.points.at(-1).time_seconds }, [envelopeRef(ref)]);
    }
    if (id === "template.automation.set_envelope_lane_state") {
      Object.assign(env, input);
      return execution(id, envelopeSummary(env), [envelopeRef(ref)]);
    }
    if (id === "template.automation.set_envelope_point") {
      const current = env.points[input.point_index];
      if (!current) return failure(id, "REF_INVALID");
      Object.assign(current, Object.fromEntries(Object.entries(input).filter(([field]) => ["time_seconds", "value", "shape", "tension", "selected"].includes(field))));
      sortPoints(env.points);
      return execution(id, { ...envelopeSummary(env), autoitem_index: input.autoitem_index, point_index: env.points.indexOf(current), ...current }, [envelopeRef(ref)]);
    }
    if (id === "template.automation.delete_envelope_points") {
      if (this.options.deleteReadbackMismatch) return execution(id, { ...envelopeSummary(env), mode: input.mode, deleted_count: 1 }, [envelopeRef(ref)]);
      const before = env.points.length;
      if (input.mode === "point") env.points.splice(input.point_index, 1);
      else env.points = env.points.filter((row) => row.time_seconds < input.start_seconds || row.time_seconds >= input.end_seconds);
      sortPoints(env.points);
      return execution(id, { ...envelopeSummary(env), mode: input.mode, autoitem_index: input.autoitem_index, deleted_count: before - env.points.length, before_count: before, after_count: env.points.length, range_absent: true }, [envelopeRef(ref)]);
    }
    if (id === "template.automation.read_automation_items") return execution(id, itemsSummary(env), [envelopeRef(ref)]);
    if (id === "template.automation.create_automation_item") {
      const nextPoolId = Math.max(0, ...env.items.map((item) => item.pool_id)) + 1;
      env.items.push(automationItem({ automation_item_index: env.items.length, position_seconds: input.position_seconds, length_seconds: input.length_seconds, pool_id: nextPoolId }));
      return execution(id, { ...envelopeSummary(env), ...env.items.at(-1) }, [envelopeRef(ref)]);
    }
    if (id === "template.automation.set_automation_item_bounds") {
      const item = env.items.find((row) => row.automation_item_index === input.automation_item_index);
      if (!item) return failure(id, "REF_INVALID");
      if (!this.options.boundsReadbackMismatch) Object.assign(item, Object.fromEntries(Object.entries(input).filter(([field]) => field !== "automation_item_index")));
      return execution(id, { ...envelopeSummary(env), ...item }, [envelopeRef(ref)]);
    }
    if (id === "template.automation.delete_automation_item") {
      const index = input.automation_item_index;
      if (!env.items[index]) return failure(id, "REF_INVALID");
      env.items.splice(index, 1);
      env.items.forEach((item, itemIndex) => { item.automation_item_index = itemIndex; });
      return execution(id, { ...envelopeSummary(env), automation_item_index: index, deleted_count: 1, target_absent: true }, [envelopeRef(ref)]);
    }
    throw new Error(`Unexpected fake Template ${id}`);
  }
}

function request(input) {
  return { id: "macro.automation.apply", input, refs: {}, context: { request_id: "request:alpha33:b1d", session_id: "session:alpha33:b1d", request_sequence: 1 } };
}

function envelope(ref, envelopeType, points) {
  const range = envelopeType === "volume" ? { min_value: 0, max_value: 4, center_value: 1 } : envelopeType === "mute" ? { min_value: 0, max_value: 1, center_value: 0 } : envelopeType === "pan" ? { min_value: -1, max_value: 1, center_value: 0 } : { min_value: 0, max_value: 1, center_value: 0.5 };
  const env = { envelope_ref: ref, envelope_type: envelopeType, parent_kind: "track", active: true, armed: false, visible: false, show_lane: false, br_available: true, ...range, points: points.map((row) => structuredClone(row)), items: [] };
  sortPoints(env.points);
  return env;
}

function envelopeSummary(env) {
  return { envelope_ref: env.envelope_ref, envelope_type: env.envelope_type, parent_kind: env.parent_kind, active: env.active, armed: env.armed, visible: env.visible, show_lane: env.show_lane, br_available: env.br_available, min_value: env.min_value, max_value: env.max_value, center_value: env.center_value, point_count: env.points.length, automation_item_count: env.items.length };
}

function pointsSummary(env, autoitemIndex) {
  return { ...envelopeSummary(env), autoitem_index: autoitemIndex, points: env.points.map((row, index) => ({ point_index: index, ...row })), returned_count: env.points.length, total_count: env.points.length, next_cursor: null, truncated: false };
}

function itemsSummary(env) {
  return { ...envelopeSummary(env), items: env.items.map((row) => ({ ...row })), returned_count: env.items.length, total_count: env.items.length, next_cursor: null, truncated: false };
}

function automationItem(row) {
  return { start_offset_seconds: 0, playrate: 1, baseline: 0, amplitude: 1, loop_source: false, selected: false, muted: false, ...row };
}

function point(timeSeconds, value, extra = {}) {
  return { time_seconds: timeSeconds, value, shape: 0, tension: 0, selected: false, ...extra };
}

function sortPoints(points) {
  points.sort((a, b) => a.time_seconds - b.time_seconds || a.value - b.value);
}

function upsertPoint(points, pointRow) {
  const index = points.findIndex((row) => Math.abs(row.time_seconds - pointRow.time_seconds) <= 0.000001);
  if (index >= 0) points[index] = structuredClone(pointRow);
  else points.push(structuredClone(pointRow));
}

function envelopeRef(ref) {
  const [, scheme, value] = /^envelope:([^:]+):(.+)$/u.exec(ref);
  return createObjectRef("envelope", { scheme, value }, { ref });
}

function trackRef(ref) {
  return { kind: "track", ref, identity: { scheme: "guid", value: ref.slice("track:guid:".length) } };
}

function fxRef(ref) {
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  return createObjectRef("fx", { scheme: `${match[1]}_fx`, value: `${match[1]}:guid:${match[2]}:${match[3]}` }, { ref });
}

function execution(id, summary, refs) {
  return { contract: "template.execution.v1", ok: true, template: { id }, request: { id: `evidence:${id}:${summary.envelope_ref ?? summary.track_ref}` }, result: { summary: structuredClone(summary), refs: structuredClone(refs) }, error: null };
}

function failure(id, code, details, recoverable = true) {
  return { contract: "template.execution.v1", ok: false, template: { id }, request: { id: `evidence:${id}:failed` }, result: { summary: {}, refs: [] }, error: { code, message: `${id} failed.`, recoverable, ...(details ? { details } : {}) } };
}

function isMutation(id) {
  return [
    "template.automation.insert_envelope_points_batch",
    "template.automation.set_envelope_point",
    "template.automation.delete_envelope_points",
    "template.automation.set_envelope_lane_state",
    "template.automation.set_track_automation_mode",
    "template.automation.create_automation_item",
    "template.automation.set_automation_item_bounds",
    "template.automation.delete_automation_item",
    "template.automation.ensure_fx_parameter_envelope",
  ].includes(id);
}

function assertCallsValidateThroughHarness(calls, ids) {
  const descriptors = new Map(createWave2AAutomationTemplates().map((descriptor) => [descriptor.id, descriptor]));
  for (const [index, id] of ids.entries()) {
    const call = calls.find((entry) => entry.id === id);
    assert.ok(call, `missing captured ${id}`);
    const descriptor = descriptors.get(id);
    const foundationRequest = buildTemplateBridgeRequest({
      descriptor,
      input: call.input,
      refs: call.refs,
      ...(descriptor.bridge.idempotency === "supported" ? { idempotency_key: `b1d-harness-${index}` } : {}),
      context: { session_id: `session:b1d-harness:${index}`, request_id: `request:b1d-harness:${index}`, expected_owner: "owner", expected_generation: 1, request_sequence: index + 1 },
    });
    assert.equal(foundationRequest.pack.capability, descriptor.bridge.capability);
    assert.equal(foundationRequest.refs.some((ref) => ref.ref === ENV_A && ref.identity.scheme === "guid" && ref.identity.value === "{ENV-A}"), true);
  }
}

function projectIndex(invalidations, { fail = false } = {}) {
  return {
    status: () => ({ snapshot_id: "snapshot:automation", revision: 4 }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      if (fail) return { ok: false, blockers: [{ code: "INDEX_WRITE_FAILED", message: "Automation index maintenance failed.", recoverable: true }] };
      return { ok: true, scopes };
    },
  };
}
