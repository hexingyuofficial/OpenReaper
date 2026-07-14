import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge as RuntimeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES,
  ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS,
  ALPHA3_3_B1C_ITEMS_APPLY_MODES,
  ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS,
  ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY,
  ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
  createAlpha3_3B1cItemsApplyDiscoveryItems,
  createAlpha3_3B1cItemsApplyExactManual,
  executeAlpha3_3B1cItemsApplyMacro,
} from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const NOW = "2026-07-13T16:00:00.000Z";
const ITEM_A = itemRef("{ITEM-A}");
const ITEM_B = itemRef("{ITEM-B}");
const TAKE_A0 = takeRef("{TAKE-A0}");
const TAKE_A1 = takeRef("{TAKE-A1}");
const TAKE_B0 = takeRef("{TAKE-B0}");
const TAKE_B1 = takeRef("{TAKE-B1}");
const RUNTIME_ITEM_OBJECT = createObjectRef("item", { scheme: "guid", value: "{ITEM-A}" }, { ref: ITEM_A.ref });
const RUNTIME_TAKE_A0_OBJECT = createObjectRef("take", { scheme: "guid", value: "{TAKE-A0}" }, { ref: TAKE_A0.ref });
const RUNTIME_TAKE_A1_OBJECT = createObjectRef("take", { scheme: "guid", value: "{TAKE-A1}" }, { ref: TAKE_A1.ref });

describe("Alpha3.3-B1c executable macro.items.apply", () => {
  it("registers one fixed allowlisted write program and truthfully holds unfinished modes and Take fields", () => {
    assert.deepEqual(ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.ids, ["macro.items.apply"]);
    const entry = ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.entries[0];
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.risk, "write");
    assert.equal(entry.selector_policy.live_reresolve_before_write, true);
    assert.equal(entry.sqlite_policy.write_authority, false);
    assert.equal(entry.undo_policy, "per_stage_undo");
    assert.equal(entry.verification_policy, "required");
    assert.equal(entry.dry_run_supported, true);
    assert.deepEqual(entry.dependencies.template_ids, ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS);
    assert.equal(entry.dependencies.template_ids.includes("template.items.set_item_pan"), false);
    assert.equal(entry.dependencies.template_ids.includes("template.items.set_active_take"), true);
    assert.equal(entry.dependencies.template_ids.includes("template.items.move_item_to_track"), true);
    assert.equal(JSON.stringify(entry.input_schema).includes("steps"), false);
    assert.equal(entry.input_schema.properties.active_take_assignments.maxItems, 8);

    const discovery = createAlpha3_3B1cItemsApplyDiscoveryItems({ liveRunnableNow: true })[0];
    assert.deepEqual(discovery.supported_modes, ALPHA3_3_B1C_ITEMS_APPLY_MODES);
    assert.deepEqual(discovery.held_modes, ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES);
    assert.deepEqual(discovery.supported_property_fields, ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS);
    assert.deepEqual(discovery.held_property_fields, ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS);
    assert.equal(discovery.supported_property_fields.includes("pan"), false);
    assert.equal(discovery.held_property_fields.includes("pan"), true);
    assert.equal(discovery.supported_modes.includes("set_active_take"), true);
    assert.equal(discovery.held_modes.includes("set_active_take"), false);
    assert.equal(discovery.supported_modes.includes("stack_on_existing_tracks"), true);
    assert.equal(discovery.held_modes.includes("stack_on_existing_tracks"), false);
    const manual = createAlpha3_3B1cItemsApplyExactManual().action_manual;
    assert.match(manual.when_to_use.join(" "), /explicit item_ref\/take_ref assignment rows/u);
    assert.match(manual.when_not_to_use.join(" "), /no REAPER Item-level pan control is proven/u);
    assert.match(manual.recovery_steps.join(" "), /macro\.controls\.set with target_kind=take/u);
    assert.match(manual.recovery_steps.join(" "), /multi-Take Item/u);
    assert.match(manual.readback_steps.join(" "), /row by row/u);
    assert.match(manual.readback_steps.join(" "), /native GetActiveTake readback/u);
    assert.match(manual.readback_steps.join(" "), /exact Item and target Track/u);
  });

  it("executes through the public createCallTemplateRuntime facade and verifies the final live Item position", async () => {
    const bridge = new ItemsApplyRuntimeBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const result = await runtime.call_template({
      id: "macro.items.apply",
      input: {
        mode: "move_to_anchor",
        target_refs: [ITEM_A.ref],
        anchor_seconds: 9,
        dry_run: false,
      },
      context: {
        request_id: "request:alpha33:b1c:runtime",
        session_id: "session:alpha33:b1c:runtime",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: NOW,
        request_sequence: 1,
      },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.macro.id, "macro.items.apply");
    assert.equal(result.execution.status, "completed");
    assert.equal(bridge.positionSeconds, 9);
    assert.deepEqual(bridge.capabilities, [
      "items.resolve_item_ref",
      "items.read_item_summary",
      "items.move_item",
      "items.read_item_summary",
    ]);
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "passed",
      source: "live_item_summary",
      observed_value: 9,
    });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("executes set_active_take through the public runtime facade and forwards the paired exact refs", async () => {
    const bridge = new ItemsApplyRuntimeBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const result = await runtime.call_template({
      id: "macro.items.apply",
      input: {
        mode: "set_active_take",
        active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref }],
        dry_run: false,
      },
      context: {
        request_id: "request:alpha33:b1c:active-take-runtime",
        session_id: "session:alpha33:b1c:active-take-runtime",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: NOW,
        request_sequence: 1,
      },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(bridge.activeTakeRef, TAKE_A1.ref);
    assert.deepEqual(bridge.capabilities, [
      "items.resolve_item_ref",
      "items.read_item_summary",
      "items.set_active_take",
    ]);
    assert.deepEqual(bridge.activeTakeRequestRefs, [ITEM_A.ref, TAKE_A1.ref]);
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "passed",
      source: "exact_active_take_readback",
      observed_value: TAKE_A1.ref,
    });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("sequences exact Items in deterministic timeline order and applies only exact post-write summary matches", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 1, 2),
      item(ITEM_B, 5, 1),
    ]);
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "sequence_with_gap",
        target_refs: [ITEM_A.ref, ITEM_B.ref],
        anchor_seconds: 0,
        gap_seconds: 0.5,
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(bridge.items.get(ITEM_A.ref).position_seconds, 0);
    assert.equal(bridge.items.get(ITEM_B.ref).position_seconds, 2.5);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
      "template.items.move_item",
      "template.items.move_item",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.requested_value), [0, 2.5]);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.mutation.status === "completed"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.source === "live_item_summary"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "completed"), true);
    assert.deepEqual(invalidations, [["items"]]);
    assert.deepEqual(result.result.data.outcome, {
      mutation: { status: "completed", completed_count: 2, total_count: 2 },
      live_readback: { status: "passed", passed_count: 2, total_count: 2 },
      index_maintenance: { status: "completed", scopes: ["items"] },
    });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("sets the four proven Item properties in fixed order and trusts only accepted atomic live readback", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 2, 1)]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_properties",
        target_refs: [ITEM_A.ref],
        properties: { loop_source: true, muted: true, volume_db: -3, locked: false },
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(
      bridge.calls.filter((call) => call.id.startsWith("template.items.set_")).map((call) => call.id),
      [
        "template.items.set_item_volume",
        "template.items.set_mute",
        "template.items.set_lock",
        "template.items.set_loop_source",
      ],
    );
    assert.deepEqual(result.result.changes.map((change) => change.field), ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS);
    assert.equal(result.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(result.result.changes.every((change) => change.live_readback.source === "accepted_template_live_readback"), true);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "skipped"), true);
    assert.equal(result.sqlite.used, false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("sets paired exact Active Takes without selection and applies only native exact readback rows", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 2, 1, { active_take_ref: TAKE_A0.ref, take_refs: [TAKE_A0.ref, TAKE_A1.ref] }),
      item(ITEM_B, 4, 1, { active_take_ref: TAKE_B0.ref, take_refs: [TAKE_B0.ref, TAKE_B1.ref] }),
    ]);
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_active_take",
        active_take_assignments: [
          { item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref },
          { item_ref: ITEM_B.ref, take_ref: TAKE_B1.ref },
        ],
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(bridge.items.get(ITEM_A.ref).active_take_ref, TAKE_A1.ref);
    assert.equal(bridge.items.get(ITEM_B.ref).active_take_ref, TAKE_B1.ref);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
      "template.items.set_active_take",
      "template.items.set_active_take",
    ]);
    assert.equal(bridge.calls.some((call) => call.id === "template.items.list_selected_items"), false);
    assert.deepEqual(bridge.calls.slice(-2).map((call) => [call.refs.item_ref.ref, call.refs.take_ref.ref]), [
      [ITEM_A.ref, TAKE_A1.ref],
      [ITEM_B.ref, TAKE_B1.ref],
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied", "applied"]);
    assert.deepEqual(result.result.changes.map((change) => change.live_readback), [
      { status: "passed", source: "exact_active_take_readback", observed_value: TAKE_A1.ref },
      { status: "passed", source: "exact_active_take_readback", observed_value: TAKE_B1.ref },
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.index_maintenance.scopes), [
      ["items", "takes"],
      ["items", "takes"],
    ]);
    assert.deepEqual(invalidations, [["items", "takes"]]);
    assert.deepEqual(result.result.data.outcome, {
      mutation: { status: "completed", completed_count: 2, total_count: 2 },
      live_readback: { status: "passed", passed_count: 2, total_count: 2 },
      index_maintenance: { status: "completed", scopes: ["items", "takes"] },
    });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("moves exact Items onto exact existing Tracks with row-specific native readback", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 3, 2)]);
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "stack_on_existing_tracks",
        track_assignments: [{ item_ref: ITEM_A.ref, target_track_ref: "track:guid:{TRACK-B}" }],
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.tracks.resolve_track_ref",
      "template.items.read_item_summary",
      "template.items.move_item_to_track",
    ]);
    assert.equal(bridge.items.get(ITEM_A.ref).track_ref, "track:guid:{TRACK-B}");
    assert.equal(result.result.changes[0].status, "applied");
    assert.equal(result.result.changes[0].before_value, "track:guid:{TRACK-A}");
    assert.equal(result.result.changes[0].related_ref, "track:guid:{TRACK-B}");
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "passed",
      source: "exact_item_track_readback",
      observed_value: "track:guid:{TRACK-B}",
    });
    assert.deepEqual(invalidations, [["items", "tracks", "takes"]]);
  });

  it("applies fades, exact trim, Take playback, and snap offset through fixed accepted atoms", async () => {
    const cases = [
      {
        input: { mode: "apply_fades", target_refs: [ITEM_A.ref], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false },
        template: "template.items.set_item_fades",
        requested: { fade_in_seconds: 0.02, fade_out_seconds: 0.08 },
        scopes: ["items"],
      },
      {
        input: { mode: "trim_exact", target_refs: [ITEM_A.ref], length_seconds: 1.25, dry_run: false },
        template: "template.items.trim_item",
        requested: 1.25,
        scopes: ["items"],
      },
      {
        input: { mode: "set_take_playback", target_refs: [ITEM_A.ref], playrate: 1.25, preserve_pitch: true, dry_run: false },
        template: "template.items.set_take_playrate",
        requested: { playrate: 1.25, preserve_pitch: true },
        scopes: ["items", "takes"],
      },
      {
        input: { mode: "set_snap_offset", target_refs: [ITEM_A.ref], snap_offset_seconds: 0.1, dry_run: false },
        template: "template.items.set_item_snap_offset",
        requested: 0.1,
        scopes: ["items"],
      },
    ];
    for (const testCase of cases) {
      const bridge = new FakeFoundationBridge([item(ITEM_A, 2, 2)]);
      const invalidations = [];
      const result = await executeAlpha3_3B1cItemsApplyMacro({
        request: request(testCase.input),
        executeAtomic: bridge.executeAtomic,
        projectIndexRuntime: projectIndex(invalidations),
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.changes.length, 1);
      assert.equal(result.result.changes[0].template_id, testCase.template);
      assert.equal(result.result.changes[0].status, "applied");
      assert.equal(result.result.changes[0].mutation.status, "completed");
      assert.deepEqual(result.result.changes[0].live_readback, {
        status: "passed",
        source: "accepted_template_live_readback",
        observed_value: testCase.requested,
      });
      assert.deepEqual(result.result.changes[0].index_maintenance.scopes, testCase.scopes);
      assert.deepEqual(invalidations, [testCase.scopes]);
      assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
    }
  });

  it("defaults new Item application modes to dry-run and dispatches no write", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 2, 2)]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "apply_fades", target_refs: [ITEM_A.ref], fade_in_seconds: 0.05, fade_out_seconds: null }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.equal(result.request.dry_run, true);
    assert.deepEqual(result.result.changes[0].requested_value, { fade_in_seconds: 0.05, fade_out_seconds: 0 });
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
  });

  it("fails new Item modes closed on absent Active Take, invalid ranges, and grouped readback mismatch", async () => {
    const preflightCases = [
      { item: item(ITEM_A, 0, 2, { active_take_ref: null, take_refs: [] }), input: { mode: "set_take_playback", target_refs: [ITEM_A.ref], playrate: 1.25, preserve_pitch: true, dry_run: false }, code: "ITEM_APPLY_ACTIVE_TAKE_REQUIRED" },
      { item: item(ITEM_A, 0, 2), input: { mode: "set_snap_offset", target_refs: [ITEM_A.ref], snap_offset_seconds: 2.5, dry_run: false }, code: "ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM" },
      { item: item(ITEM_A, 0, 2), input: { mode: "trim_exact", target_refs: [ITEM_A.ref], length_seconds: 0, dry_run: false }, code: "ITEM_APPLY_LENGTH_INVALID" },
      { item: item(ITEM_A, 0, 2), input: { mode: "set_take_playback", target_refs: [ITEM_A.ref], playrate: 1, dry_run: false }, code: "ITEM_APPLY_PRESERVE_PITCH_REQUIRED" },
    ];
    for (const testCase of preflightCases) {
      const bridge = new FakeFoundationBridge([testCase.item]);
      const result = await executeAlpha3_3B1cItemsApplyMacro({
        request: request(testCase.input),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, testCase.code);
      assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
      assert.equal(result.result.changes.length, 0);
    }

    const mismatchBridge = new FakeFoundationBridge([item(ITEM_A, 0, 2)], { propertyReadbackMismatch: "fade_out_seconds" });
    const invalidations = [];
    const mismatch = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "apply_fades", target_refs: [ITEM_A.ref], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false }),
      executeAtomic: mismatchBridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });
    assert.equal(mismatch.ok, false);
    assert.equal(mismatch.execution.status, "partial_failure");
    assert.equal(mismatch.error.code, "ITEM_APPLY_READBACK_MISMATCH");
    assert.equal(mismatch.result.changes[0].status, "readback_failed");
    assert.equal(mismatch.result.changes[0].mutation.status, "completed");
    assert.equal(mismatch.result.changes[0].live_readback.status, "failed");
    assert.deepEqual(invalidations, [["items"]]);
  });

  it("defaults Active Take assignment rows to dry-run and performs no selection or mutation", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 2, 1, { active_take_ref: TAKE_A0.ref, take_refs: [TAKE_A0.ref, TAKE_A1.ref] }),
    ]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_active_take", active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref }] }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.equal(result.request.dry_run, true);
    assert.equal(bridge.items.get(ITEM_A.ref).active_take_ref, TAKE_A0.ref);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
    ]);
    assert.deepEqual(result.result.changes[0], {
      operation_id: "item-1-active_take_ref",
      template_id: "template.items.set_active_take",
      target_ref: ITEM_A.ref,
      related_ref: TAKE_A1.ref,
      field: "active_take_ref",
      before_value: TAKE_A0.ref,
      requested_value: TAKE_A1.ref,
      status: "planned",
      mutation: { status: "not_run" },
      live_readback: { status: "not_run" },
      index_maintenance: { status: "skipped", scopes: [] },
    });
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("delegates Take ownership to the exact atom and never applies a Take to the wrong Item", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 2, 1, { active_take_ref: TAKE_A0.ref, take_refs: [TAKE_A0.ref, TAKE_A1.ref] }),
      item(ITEM_B, 4, 1, { active_take_ref: TAKE_B0.ref, take_refs: [TAKE_B0.ref, TAKE_B1.ref] }),
    ]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_active_take",
        active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_B1.ref }],
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "failed");
    assert.equal(result.error.code, "REF_INVALID");
    assert.equal(bridge.items.get(ITEM_A.ref).active_take_ref, TAKE_A0.ref);
    assert.equal(bridge.items.get(ITEM_B.ref).active_take_ref, TAKE_B0.ref);
    assert.deepEqual(result.result.changes.map((change) => change.status), ["pending"]);
    assert.deepEqual(result.result.changes.map((change) => change.mutation.status), ["failed"]);
    assert.equal(bridge.calls.some((call) => call.id === "template.items.list_selected_items"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("never marks Active Take applied when the atom response lacks the requested exact readback", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 2, 1, { active_take_ref: TAKE_A0.ref, take_refs: [TAKE_A0.ref, TAKE_A1.ref] }),
    ], { activeTakeReadbackMismatch: true });
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_active_take",
        active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref }],
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "ITEM_APPLY_READBACK_MISMATCH");
    assert.equal(result.result.changes[0].status, "readback_failed");
    assert.equal(result.result.changes[0].mutation.status, "completed");
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "failed",
      source: "exact_active_take_readback",
      observed_value: TAKE_A0.ref,
      observed_item_ref: ITEM_A.ref,
    });
    assert.deepEqual(invalidations, [["items", "takes"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("fails Item pan closed with typed Active Take guidance before target resolution or mutation", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 2, 1)]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "set_properties",
        target_refs: [ITEM_A.ref],
        properties: { pan: -0.25 },
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "ITEM_APPLY_ITEM_PAN_UNSUPPORTED");
    assert.match(result.error.message, /macro\.controls\.set target_kind=take/u);
    assert.match(result.error.message, /multi-Take Items are never redirected silently/u);
    assert.equal(result.result.changes.length, 0);
    assert.equal(bridge.calls.length, 0);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("dry-runs a bounded selected arrangement after live resolution and dispatches no write", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 3, 1, { selected: true }),
      item(ITEM_B, 6, 2, { selected: true }),
    ]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "move_to_anchor", target: "selected", anchor_seconds: 10, limit: 2 }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.execution.status, "dry_run_completed");
    assert.equal(result.request.dry_run, true);
    assert.deepEqual(result.result.changes.map((change) => change.requested_value), [10, 13]);
    assert.equal(result.result.changes.every((change) => change.status === "planned"), true);
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
    assert.equal(bridge.items.get(ITEM_A.ref).position_seconds, 3);
    assert.equal(bridge.items.get(ITEM_B.ref).position_seconds, 6);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("fails closed on incomplete selected coverage instead of mutating a truncated prefix", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 0, 1, { selected: true }),
      item(ITEM_B, 2, 1, { selected: true }),
      item(itemRef("{ITEM-C}"), 4, 1, { selected: true }),
    ]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "align_starts", target: "selected", limit: 2, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "blocked");
    assert.equal(result.error.code, "ITEM_APPLY_TARGET_COVERAGE_INCOMPLETE");
    assert.equal(result.result.changes.length, 0);
    assert.deepEqual(bridge.calls.map((call) => call.id), ["template.items.list_selected_items"]);
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
  });

  it("rejects held modes, Take fields, and model-supplied steps before the first child call", async () => {
    for (const input of [
      { mode: "normalize_lufs", target_refs: [ITEM_A.ref], dry_run: false },
      { mode: "set_properties", target_refs: [ITEM_A.ref], properties: { take_volume_db: -3 }, dry_run: false },
      { mode: "align_starts", target_refs: [ITEM_A.ref], steps: [{ id: "template.items.move_item" }], dry_run: false },
    ]) {
      const bridge = new FakeFoundationBridge([item(ITEM_A, 0, 1)]);
      const result = await executeAlpha3_3B1cItemsApplyMacro({
        request: request(input),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "blocked");
      assert.equal(bridge.calls.length, 0);
      assert.equal(result.result.changes.length, 0);
      assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
    }
  });

  it("rejects ambiguous, duplicate, malformed, or oversized Active Take rows before the first child call", async () => {
    const invalidInputs = [
      { mode: "set_active_take", target: "selected", active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref }], dry_run: false },
      { mode: "set_active_take", active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: TAKE_A1.ref }, { item_ref: ITEM_A.ref, take_ref: TAKE_A0.ref }], dry_run: false },
      { mode: "set_active_take", active_take_assignments: [{ item_ref: ITEM_A.ref, take_ref: "take:selected:0" }], dry_run: false },
      { mode: "set_active_take", active_take_assignments: Array.from({ length: 9 }, (_, index) => ({ item_ref: `item:guid:{ITEM-${index}}`, take_ref: `take:guid:{TAKE-${index}}` })), dry_run: false },
      { mode: "set_active_take", dry_run: false },
    ];
    for (const input of invalidInputs) {
      const bridge = new FakeFoundationBridge([item(ITEM_A, 0, 1)]);
      const result = await executeAlpha3_3B1cItemsApplyMacro({
        request: request(input),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, "ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID");
      assert.equal(bridge.calls.length, 0);
      assert.equal(result.result.changes.length, 0);
      assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
    }
  });

  it("preflights a compact response budget after reads but before every mutation", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 0, 1)]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: {
        ...request({ mode: "set_properties", target_refs: [ITEM_A.ref], properties: { volume_db: -3, muted: false, locked: true, loop_source: true }, dry_run: false }),
        budget: { max_response_bytes: 2_048 },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "ITEM_APPLY_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(result.result.changes.length, 0);
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
    assert.equal(result.budget.actual_bytes <= 2_048, true);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("never marks a property row applied when its live atomic readback value mismatches", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 0, 1)], { propertyReadbackMismatch: "muted" });
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_properties", target_refs: [ITEM_A.ref], properties: { volume_db: -3, muted: true, locked: true }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "ITEM_APPLY_READBACK_MISMATCH");
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied", "readback_failed"]);
    assert.deepEqual(result.result.changes.map((change) => change.mutation.status), ["completed", "completed"]);
    assert.deepEqual(result.result.changes.map((change) => change.live_readback.status), ["passed", "failed"]);
    assert.equal(result.result.changes.every((change) => change.index_maintenance.status === "completed"), true);
    assert.deepEqual(invalidations, [["items"]]);
    assert.equal(bridge.calls.some((call) => call.id === "template.items.set_lock"), false);
  });

  it("preserves verified applied truth when only Project Index maintenance fails", async () => {
    const bridge = new FakeFoundationBridge([item(ITEM_A, 0, 1)]);
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_properties", target_refs: [ITEM_A.ref], properties: { muted: true }, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex([], { fail: true }),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "INDEX_WRITE_FAILED");
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "passed",
      source: "accepted_template_live_readback",
      observed_value: true,
    });
    assert.deepEqual(result.result.changes[0].index_maintenance, {
      status: "failed",
      scopes: ["items"],
      blocker_code: "INDEX_WRITE_FAILED",
    });
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.data.outcome.index_maintenance.status, "failed");
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });
});

class ItemsApplyRuntimeBridge extends RuntimeFoundationBridge {
  constructor() {
    super();
    this.positionSeconds = 1;
    this.activeTakeRef = TAKE_A0.ref;
    this.activeTakeRequestRefs = [];
    this.capabilities = [];
  }

  dispatch(input) {
    const request = structuredClone(input);
    const capability = request.pack?.capability;
    this.capabilities.push(capability);
    request.params = { ...(request.params ?? {}) };
    if (capability === "items.move_item") this.positionSeconds = request.params.position_seconds;
    if (capability === "items.set_active_take") {
      this.activeTakeRef = TAKE_A1.ref;
      this.activeTakeRequestRefs = request.refs.map((ref) => ref.ref);
    }
    request.params.emits = runtimeOutput(
      capability === "items.set_active_take" ? [RUNTIME_ITEM_OBJECT, RUNTIME_TAKE_A1_OBJECT] : [RUNTIME_ITEM_OBJECT, RUNTIME_TAKE_A0_OBJECT],
      {
        item_ref: ITEM_A.ref,
        track_ref: "track:guid:{TRACK-A}",
        position_seconds: this.positionSeconds,
        length_seconds: 2,
        volume_db: 0,
        muted: false,
        locked: false,
        loop_source: false,
        active_take_ref: this.activeTakeRef,
        take_count: 2,
        ...(["items.move_item", "items.set_active_take"].includes(capability) ? { readback_status: "passed" } : {}),
      },
    );
    return super.dispatch(request);
  }
}

class FakeFoundationBridge {
  constructor(items, options = {}) {
    this.items = new Map(items.map((entry) => [entry.item_ref.ref, structuredClone(entry)]));
    this.options = options;
    this.calls = [];
    this.readCounts = new Map();
    this.executeAtomic = this.executeAtomic.bind(this);
  }

  async executeAtomic({ id, input = {}, refs = {}, budget, observeProjectIndex }) {
    this.calls.push({ id, input: structuredClone(input), refs: structuredClone(refs), budget, observeProjectIndex });
    if (id === "template.items.list_selected_items") {
      const selected = [...this.items.values()].filter((entry) => entry.selected);
      const rows = selected.slice(0, input.limit);
      return execution(id, {
        selected_count: selected.length,
        truncated: selected.length > input.limit,
        items: rows.map(summary),
      }, rows.map((entry) => entry.item_ref));
    }
    if (id === "template.items.resolve_item_ref") {
      const canonical = input.ref.startsWith("guid:") ? `item:${input.ref}` : input.ref;
      const entry = this.items.get(canonical);
      if (!entry) return failure(id, "ITEM_NOT_FOUND", "Fake Item was not found.");
      return execution(id, summary(entry), [entry.item_ref]);
    }
    if (id === "template.tracks.resolve_track_ref") {
      const resolved = trackRef(input.track_ref.slice("track:guid:".length));
      return execution(id, { track_ref: resolved.ref }, [resolved]);
    }
    const itemReference = refs.item_ref;
    const refString = typeof itemReference === "string" ? itemReference : itemReference?.ref;
    const entry = this.items.get(refString);
    if (!entry) return failure(id, "ITEM_NOT_FOUND", "Fake Item ref was not found.");
    if (id === "template.items.read_item_summary") {
      const count = (this.readCounts.get(refString) ?? 0) + 1;
      this.readCounts.set(refString, count);
      const row = summary(entry);
      if (this.options.arrangementReadbackMismatch && count > 1) row.position_seconds += 0.25;
      return execution(id, row, [entry.item_ref]);
    }
    if (id === "template.items.move_item") {
      entry.position_seconds = input.position_seconds;
      return execution(id, { ...summary(entry), readback_status: "passed" }, [entry.item_ref]);
    }
    if (id === "template.items.move_item_to_track") {
      const target = refs.target_track_ref;
      const targetRef = typeof target === "string" ? target : target?.ref;
      const sourceTrackRef = entry.track_ref;
      entry.track_ref = targetRef;
      return execution(id, {
        ...summary(entry),
        source_track_ref: sourceTrackRef,
        target_track_ref: targetRef,
        take_refs: [...entry.take_refs],
        track_count_unchanged: true,
        readback_status: "passed",
      }, [entry.item_ref, target]);
    }
    if (id === "template.items.set_active_take") {
      const takeReference = refs.take_ref;
      const takeRefString = typeof takeReference === "string" ? takeReference : takeReference?.ref;
      if (!entry.take_refs.includes(takeRefString)) {
        return failure(id, "REF_INVALID", "The exact Take does not belong to the exact Item.");
      }
      const previous = entry.active_take_ref;
      entry.active_take_ref = takeRefString;
      const observed = this.options.activeTakeReadbackMismatch ? previous : takeRefString;
      return execution(id, {
        ...summary(entry),
        active_take_ref: observed,
        changed: previous !== takeRefString,
        readback_status: "passed",
      }, [entry.item_ref, takeReference]);
    }
    if (id === "template.items.set_item_fades") {
      entry.fade_in_seconds = input.fade_in_seconds ?? 0;
      entry.fade_out_seconds = input.fade_out_seconds ?? 0;
      const row = { ...summary(entry), readback_status: "passed" };
      if (this.options.propertyReadbackMismatch === "fade_out_seconds") row.fade_out_seconds += 0.25;
      return execution(id, row, [entry.item_ref]);
    }
    if (id === "template.items.trim_item") {
      entry.length_seconds = input.length_seconds;
      const row = { ...summary(entry), readback_status: "passed" };
      if (this.options.propertyReadbackMismatch === "length_seconds") row.length_seconds += 0.25;
      return execution(id, row, [entry.item_ref]);
    }
    if (id === "template.items.set_take_playrate") {
      if (!entry.active_take_ref) return failure(id, "TAKE_NOT_FOUND", "No Active Take.");
      entry.playrate = input.playrate;
      entry.preserve_pitch = input.preserve_pitch;
      const row = { ...summary(entry), readback_status: "passed" };
      if (this.options.propertyReadbackMismatch === "playrate") row.playrate += 0.25;
      return execution(id, row, [entry.item_ref]);
    }
    if (id === "template.items.set_item_snap_offset") {
      entry.snap_offset_seconds = input.snap_offset_seconds;
      const row = { ...summary(entry), readback_status: "passed" };
      if (this.options.propertyReadbackMismatch === "snap_offset_seconds") row.snap_offset_seconds += 0.25;
      return execution(id, row, [entry.item_ref]);
    }
    const field = propertyField(id);
    if (field) {
      entry[field] = input[field];
      const row = { ...summary(entry), readback_status: "passed" };
      if (this.options.propertyReadbackMismatch === field) {
        row[field] = typeof input[field] === "number" ? input[field] + 0.25 : !input[field];
      }
      return execution(id, row, [entry.item_ref]);
    }
    throw new Error(`Unexpected fake Template ${id}`);
  }
}

function request(input) {
  return {
    id: "macro.items.apply",
    input,
    refs: {},
    context: { request_id: "request:alpha33:b1c", session_id: "session:alpha33:b1c", request_sequence: 1 },
  };
}

function itemRef(value) {
  return { kind: "item", ref: `item:guid:${value}`, identity: { scheme: "guid", value } };
}

function takeRef(value) {
  return { kind: "take", ref: `take:guid:${value}`, identity: { scheme: "guid", value } };
}

function trackRef(value) {
  return { kind: "track", ref: `track:guid:${value}`, identity: { scheme: "guid", value } };
}

function item(itemReference, positionSeconds, lengthSeconds, extra = {}) {
  return {
    item_ref: itemReference,
    track_ref: "track:guid:{TRACK-A}",
    position_seconds: positionSeconds,
    length_seconds: lengthSeconds,
    volume_db: 0,
    muted: false,
    locked: false,
    loop_source: false,
    fade_in_seconds: 0,
    fade_out_seconds: 0,
    snap_offset_seconds: 0,
    playrate: 1,
    preserve_pitch: true,
    active_take_ref: TAKE_A0.ref,
    take_refs: [TAKE_A0.ref],
    selected: false,
    ...extra,
  };
}

function summary(entry) {
  return {
    item_ref: entry.item_ref.ref,
    track_ref: entry.track_ref,
    position_seconds: entry.position_seconds,
    length_seconds: entry.length_seconds,
    volume_db: entry.volume_db,
    muted: entry.muted,
    locked: entry.locked,
    loop_source: entry.loop_source,
    fade_in_seconds: entry.fade_in_seconds,
    fade_out_seconds: entry.fade_out_seconds,
    snap_offset_seconds: entry.snap_offset_seconds,
    playrate: entry.playrate,
    preserve_pitch: entry.preserve_pitch,
    active_take_ref: entry.active_take_ref,
    take_count: entry.take_refs.length,
  };
}

function execution(id, readback, refs = []) {
  return {
    contract: "template.execution.v1",
    ok: true,
    template: { id },
    request: { id: `evidence:${id}:${readback.item_ref ?? "project"}` },
    result: { summary: readback, refs },
    error: null,
  };
}

function failure(id, code, message) {
  return {
    contract: "template.execution.v1",
    ok: false,
    template: { id },
    request: { id: `evidence:${id}:failed` },
    result: { summary: {}, refs: [] },
    error: { code, message, recoverable: true },
  };
}

function runtimeOutput(refs, readback) {
  return { refs, readback };
}

function propertyField(id) {
  return {
    "template.items.set_item_volume": "volume_db",
    "template.items.set_mute": "muted",
    "template.items.set_lock": "locked",
    "template.items.set_loop_source": "loop_source",
  }[id] ?? null;
}

function isWrite(id) {
  return [
    "template.items.move_item",
    "template.items.set_active_take",
    "template.items.set_item_fades",
    "template.items.trim_item",
    "template.items.set_take_playrate",
    "template.items.set_item_snap_offset",
  ].includes(id) || propertyField(id) !== null;
}

function projectIndex(invalidations, { fail = false } = {}) {
  return {
    status: () => ({ snapshot_id: "snapshot:items-apply", revision: 7 }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      if (fail) return { ok: false, blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }] };
      return { ok: true, scopes };
    },
  };
}
