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
const RUNTIME_ITEM_OBJECT = createObjectRef("item", { scheme: "guid", value: "{ITEM-A}" }, { ref: ITEM_A.ref });

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
    assert.equal(JSON.stringify(entry.input_schema).includes("steps"), false);

    const discovery = createAlpha3_3B1cItemsApplyDiscoveryItems({ liveRunnableNow: true })[0];
    assert.deepEqual(discovery.supported_modes, ALPHA3_3_B1C_ITEMS_APPLY_MODES);
    assert.deepEqual(discovery.held_modes, ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES);
    assert.deepEqual(discovery.supported_property_fields, ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS);
    assert.deepEqual(discovery.held_property_fields, ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS);
    assert.equal(discovery.supported_property_fields.includes("pan"), false);
    assert.equal(discovery.held_property_fields.includes("pan"), true);
    const manual = createAlpha3_3B1cItemsApplyExactManual().action_manual;
    assert.match(manual.when_not_to_use.join(" "), /Take-level fields/u);
    assert.match(manual.when_not_to_use.join(" "), /no REAPER Item-level pan control is proven/u);
    assert.match(manual.recovery_steps.join(" "), /macro\.controls\.set with target_kind=take/u);
    assert.match(manual.recovery_steps.join(" "), /multi-Take Item/u);
    assert.match(manual.readback_steps.join(" "), /row by row/u);
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
    this.capabilities = [];
  }

  dispatch(input) {
    const request = structuredClone(input);
    const capability = request.pack?.capability;
    this.capabilities.push(capability);
    request.params = { ...(request.params ?? {}) };
    if (capability === "items.move_item") this.positionSeconds = request.params.position_seconds;
    request.params.emits = runtimeOutput([RUNTIME_ITEM_OBJECT], {
      item_ref: ITEM_A.ref,
      track_ref: "track:guid:{TRACK-A}",
      position_seconds: this.positionSeconds,
      length_seconds: 2,
      volume_db: 0,
      muted: false,
      locked: false,
      loop_source: false,
      active_take_ref: "take:guid:{TAKE-A}",
      take_count: 1,
      ...(capability === "items.move_item" ? { readback_status: "passed" } : {}),
    });
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
    active_take_ref: "take:guid:{TAKE-A}",
    take_count: 1,
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
  return id === "template.items.move_item" || propertyField(id) !== null;
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
