import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

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
const STDIO_SERVER = path.resolve("packages/mcp-server/src/openreaper-mcp-stdio.mjs");
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
  it("registers one fixed allowlisted destructive program and truthfully holds unfinished modes and Take fields", () => {
    assert.deepEqual(ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.ids, ["macro.items.apply"]);
    const entry = ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.entries[0];
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.risk, "destructive");
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

  it("stops a Macro before its next atomic operation when the MCP caller cancels", async () => {
    const controller = new AbortController();
    const bridge = new ItemsApplyRuntimeBridge();
    const dispatch = bridge.dispatch.bind(bridge);
    bridge.dispatch = async (request) => {
      const result = await dispatch(request);
      controller.abort("fixture timeout");
      return result;
    };
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
        request_id: "request:alpha33:b1c:cancel",
        session_id: "session:alpha33:b1c:cancel",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: NOW,
        request_sequence: 1,
      },
    }, { signal: controller.signal });

    assert.equal(result.ok, false, JSON.stringify({ result, capabilities: bridge.capabilities }));
    assert.equal(result.error.details.request_cancelled, true);
    assert.deepEqual(bridge.capabilities, ["items.resolve_item_ref"]);
    assert.equal(bridge.positionSeconds, 1);
  });

  it("stops a direct Template cancelled during async preflight before REAPER dispatch", async () => {
    const controller = new AbortController();
    const bridge = new ItemsApplyRuntimeBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const pending = runtime.call_template({
      id: "template.tracks.create_track",
      input: { name: "Cancelled" },
      context: {
        request_id: "request:alpha33:b1c:cancel-direct",
        session_id: "session:alpha33:b1c:cancel-direct",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: NOW,
        request_sequence: 1,
      },
    }, { signal: controller.signal });
    controller.abort("fixture timeout");
    const result = await pending;

    assert.equal(result.ok, false, JSON.stringify(result));
    assert.equal(result.error.details.request_cancelled, true);
    assert.equal(result.error.details.zero_write, true);
    assert.deepEqual(bridge.capabilities, []);
  });

  it("forwards real stdio MCP cancellation and stops a Macro before its write request", { timeout: 10_000 }, async () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-items-cancel-stdio-"));
    const transportDir = path.join(root, "transport");
    mkdirSync(path.join(transportDir, "requests"), { recursive: true });
    mkdirSync(path.join(transportDir, "results"), { recursive: true });
    const client = new Client({ name: "alpha33-items-cancel", version: "1.0.0" });
    const transport = new StdioClientTransport({
      command: process.execPath,
      args: [STDIO_SERVER],
      cwd: path.resolve("."),
      env: {
        ...process.env,
        OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
        OPENREAPER_LIVE_BRIDGE_OWNER: "owner-test",
        OPENREAPER_LIVE_BRIDGE_GENERATION: "1",
      },
      stderr: "pipe",
    });
    try {
      await client.connect(transport);
      const controller = new AbortController();
      const call = client.callTool({
        name: "call_template",
        arguments: {
          id: "macro.items.apply",
          input: {
            mode: "move_to_anchor",
            target_refs: [ITEM_A.ref],
            anchor_seconds: 9,
            dry_run: false,
          },
        },
      }, undefined, { signal: controller.signal, timeout: 5_000, maxTotalTimeout: 5_000 });
      const settledCall = call.then(
        () => ({ error: null }),
        (error) => ({ error }),
      );
      const first = await waitForBridgeRequest(transportDir);
      assert.equal(first.request.pack.capability, "items.resolve_item_ref");
      controller.abort("fixture timeout");
      await new Promise((resolve) => setTimeout(resolve, 50));
      const response = new ItemsApplyRuntimeBridge().dispatch(first.request);
      writeFileSync(path.join(transportDir, "results", first.file), `${JSON.stringify(response)}\n`, "utf8");
      const { error } = await settledCall;
      assert.match(error?.message ?? "", /timeout|abort|cancel/iu);
      const laterCapabilities = await collectLaterBridgeCapabilities(transportDir, first.file, 500);
      assert.deepEqual(laterCapabilities, []);
    } finally {
      await client.close().catch(() => {});
      rmSync(root, { recursive: true, force: true });
    }
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

  it("uses the complete explicit eight-Item set when limit is omitted but keeps an explicit smaller limit fail-closed", async () => {
    const itemRefs = Array.from({ length: 8 }, (_, index) => itemRef(`{ITEM-EXACT-${index + 1}}`));
    const bridge = new FakeFoundationBridge(itemRefs.map((ref, index) => item(ref, index * 2, 1)));
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "sequence_with_gap",
        target_refs: itemRefs.map((ref) => ref.ref),
        anchor_seconds: 10,
        gap_seconds: 0.25,
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 8);
    assert.equal(result.result.changes.every((change) => change.status === "applied" && change.live_readback.status === "passed"), true);
    assert.deepEqual(itemRefs.map((ref) => bridge.items.get(ref.ref).position_seconds), [10, 11.25, 12.5, 13.75, 15, 16.25, 17.5, 18.75]);

    const blockedBridge = new FakeFoundationBridge(itemRefs.map((ref, index) => item(ref, index * 2, 1)));
    const blocked = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "sequence_with_gap",
        target_refs: itemRefs.map((ref) => ref.ref),
        limit: 4,
        gap_seconds: 0,
        dry_run: false,
      }),
      executeAtomic: blockedBridge.executeAtomic,
      now: () => new Date(NOW),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "ITEM_APPLY_TARGET_LIMIT_EXCEEDED");
    assert.equal(blockedBridge.calls.length, 0);
  });

  it("uses the complete explicit request-ref set when limit is omitted", async () => {
    const itemRefs = Array.from({ length: 8 }, (_, index) => itemRef(`{ITEM-REQUEST-${index + 1}}`));
    const bridge = new FakeFoundationBridge(itemRefs.map((ref, index) => item(ref, index, 1)));
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: {
        ...request({ mode: "align_starts", dry_run: false }),
        refs: { item_refs: itemRefs },
      },
      executeAtomic: bridge.executeAtomic,
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.changes.length, 8);
    assert.equal(result.result.changes.every((change) => change.status === "applied" && change.live_readback.status === "passed"), true);
    assert.deepEqual(itemRefs.map((ref) => bridge.items.get(ref.ref).position_seconds), Array(8).fill(0));
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

  it("removes silence only after complete analysis and verifies every kept Item plus the owner Track count", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 2, 2, { silence_segment_count: 2, silence_seconds: 0.5 }),
    ]);
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "remove_silence",
        target_refs: [ITEM_A.ref],
        silence_threshold_dbfs: -55,
        min_silence_ms: 75,
        dry_run: false,
      }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(bridge.items.size, 3);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.analysis.detect_item_silence",
      "template.items.split_item_by_silence",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
      "template.items.list_items_on_track",
    ]);
    assert.equal(result.result.changes.length, 1);
    assert.equal(result.result.changes[0].status, "applied");
    assert.deepEqual(result.result.changes[0].mutation, {
      status: "completed",
      template_id: "template.items.split_item_by_silence",
    });
    assert.deepEqual(result.result.changes[0].live_readback, {
      status: "passed",
      source: "split_atom_plus_kept_items_plus_track_count",
      observed_value: {
        kept: 3,
        deleted: 2,
        removed_seconds: 0.5,
        remaining_seconds: 1.5,
        track_item_count: 3,
      },
    });
    assert.deepEqual(result.result.changes[0].index_maintenance, {
      status: "completed",
      scopes: ["items", "tracks", "takes"],
    });
    assert.deepEqual(invalidations, [["items", "tracks", "takes"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("blocks incomplete or all-silent analysis before split-by-silence mutation", async () => {
    const cases = [
      {
        options: { analysisCoverageIncomplete: true },
        extra: { silence_segment_count: 2, silence_seconds: 0.5 },
        code: "ITEM_APPLY_ANALYSIS_COVERAGE_INCOMPLETE",
      },
      {
        options: { allSilent: true },
        extra: { silence_segment_count: 1, silence_seconds: 2 },
        code: "ITEM_APPLY_ALL_SILENT_BLOCKED",
      },
    ];
    for (const testCase of cases) {
      const bridge = new FakeFoundationBridge([item(ITEM_A, 2, 2, testCase.extra)], testCase.options);
      const result = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "remove_silence", target_refs: [ITEM_A.ref], dry_run: false }),
        executeAtomic: bridge.executeAtomic,
        now: () => new Date(NOW),
      });

      assert.equal(result.ok, false);
      assert.equal(result.execution.status, "blocked");
      assert.equal(result.error.code, testCase.code);
      assert.equal(result.result.changes.length, 0);
      assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
      assert.deepEqual(bridge.calls.map((call) => call.id), [
        "template.items.resolve_item_ref",
        "template.items.read_item_summary",
        "template.analysis.detect_item_silence",
      ]);
    }
  });

  it("aligns two audio onsets and re-runs complete transient analysis after each move", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 1, 2, { first_transient_time: 0.2, transient_count: 2 }),
      item(ITEM_B, 4, 2, { first_transient_time: 0.5, transient_count: 3 }),
    ]);
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "align_onsets", target_refs: [ITEM_A.ref, ITEM_B.ref], anchor_seconds: 3, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(bridge.items.get(ITEM_A.ref).position_seconds, 2.8);
    assert.equal(bridge.items.get(ITEM_B.ref).position_seconds, 2.5);
    assert.deepEqual(bridge.calls.map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.analysis.detect_item_transients",
      "template.items.read_item_summary",
      "template.analysis.detect_item_transients",
      "template.items.move_item",
      "template.items.move_item",
      "template.items.read_item_summary",
      "template.analysis.detect_item_transients",
      "template.items.read_item_summary",
      "template.analysis.detect_item_transients",
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied", "applied"]);
    assert.deepEqual(result.result.changes.map((change) => change.live_readback), [
      { status: "passed", source: "live_item_summary_plus_transient_reanalysis", observed_value: 3 },
      { status: "passed", source: "live_item_summary_plus_transient_reanalysis", observed_value: 3 },
    ]);
    assert.deepEqual(invalidations, [["items"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
  });

  it("does not report an aligned onset as applied when post-move transient readback differs", async () => {
    const bridge = new FakeFoundationBridge([
      item(ITEM_A, 1, 2, { first_transient_time: 0.2, transient_count: 2 }),
      item(ITEM_B, 4, 2, { first_transient_time: 0.5, transient_count: 3 }),
    ], { transientReadbackMismatchFor: ITEM_B.ref });
    const invalidations = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "align_onsets", target_refs: [ITEM_A.ref, ITEM_B.ref], anchor_seconds: 3, dry_run: false }),
      executeAtomic: bridge.executeAtomic,
      projectIndexRuntime: projectIndex(invalidations),
      now: () => new Date(NOW),
    });

    assert.equal(result.ok, false);
    assert.equal(result.execution.status, "partial_failure");
    assert.equal(result.error.code, "ITEM_APPLY_READBACK_MISMATCH");
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied", "readback_failed"]);
    assert.equal(result.result.changes[1].mutation.status, "completed");
    assert.equal(result.result.changes[1].live_readback.status, "failed");
    assert.equal(result.result.changes[1].live_readback.source, "post_move_transient_analysis");
    assert.deepEqual(invalidations, [["items"]]);
    assert.deepEqual(validateMacroExecutionEnvelope(result), { valid: true, errors: [] });
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

async function waitForBridgeRequest(transportDir) {
  const requestsDir = path.join(transportDir, "requests");
  for (let attempt = 0; attempt < 400; attempt += 1) {
    const file = readdirSync(requestsDir).find((entry) => entry.endsWith(".json"));
    if (file) return { file, request: JSON.parse(readFileSync(path.join(requestsDir, file), "utf8")) };
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  throw new Error("Timed out waiting for stdio cancellation fixture request.");
}

async function collectLaterBridgeCapabilities(transportDir, firstFile, durationMs) {
  const requestsDir = path.join(transportDir, "requests");
  const capabilities = new Set();
  const deadline = Date.now() + durationMs;
  while (Date.now() < deadline) {
    for (const file of readdirSync(requestsDir).filter((entry) => entry.endsWith(".json") && entry !== firstFile)) {
      const request = JSON.parse(readFileSync(path.join(requestsDir, file), "utf8"));
      capabilities.add(request.pack?.capability);
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return [...capabilities];
}

class FakeFoundationBridge {
  constructor(items, options = {}) {
    this.items = new Map(items.map((entry) => [entry.item_ref.ref, structuredClone(entry)]));
    this.options = options;
    this.calls = [];
    this.readCounts = new Map();
    this.analysisCounts = new Map();
    this.splitSerial = 0;
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
    if (id === "template.items.list_items_on_track") {
      const trackReference = refs.track_ref;
      const trackRefString = typeof trackReference === "string" ? trackReference : trackReference?.ref;
      const rows = [...this.items.values()].filter((candidate) => candidate.track_ref === trackRefString);
      return execution(id, {
        track_ref: trackRefString,
        item_count: rows.length,
        returned_count: rows.length,
        truncated: false,
        items: rows.map(summary),
      }, [trackReference, ...rows.map((candidate) => candidate.item_ref)]);
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
    if (id === "template.analysis.detect_item_silence") {
      const silenceSeconds = this.options.allSilent ? entry.length_seconds : (entry.silence_seconds ?? 0);
      const silenceCount = this.options.allSilent ? 1 : (entry.silence_segment_count ?? 0);
      return execution(id, {
        item_ref: entry.item_ref.ref,
        segment_count: silenceCount,
        total_silence_seconds: silenceSeconds,
        total_detected: silenceCount,
        returned_count: silenceCount,
        truncated: false,
        coverage: {
          range_complete: this.options.analysisCoverageIncomplete !== true,
          channel_coverage_complete: true,
          result_rows_complete: true,
        },
      }, [entry.item_ref]);
    }
    if (id === "template.analysis.detect_item_transients") {
      const count = (this.analysisCounts.get(refString) ?? 0) + 1;
      this.analysisCounts.set(refString, count);
      const mismatch = this.options.transientReadbackMismatchFor === refString && count > 1;
      const transientCount = entry.transient_count ?? 1;
      return execution(id, {
        item_ref: entry.item_ref.ref,
        transient_count: transientCount,
        total_detected: transientCount,
        first_transient_time: (entry.first_transient_time ?? 0.1) + (mismatch ? 0.25 : 0),
        truncated: false,
        coverage: {
          range_complete: this.options.analysisCoverageIncomplete !== true,
          channel_coverage_complete: true,
          result_rows_complete: true,
        },
      }, [entry.item_ref]);
    }
    if (id === "template.items.split_item_by_silence") {
      const silenceCount = entry.silence_segment_count ?? 0;
      const removedSeconds = entry.silence_seconds ?? 0;
      const remainingSeconds = entry.length_seconds - removedSeconds;
      const keptCount = silenceCount + 1;
      const keptLength = remainingSeconds / keptCount;
      const itemCountBefore = [...this.items.values()].filter((candidate) => candidate.track_ref === entry.track_ref).length;
      const keptRefs = [entry.item_ref.ref];
      const deletedRefs = [];
      this.splitSerial += 1;
      entry.length_seconds = keptLength;
      for (let index = 1; index < keptCount; index += 1) {
        const keptRef = itemRef(`{SPLIT-${this.splitSerial}-KEPT-${index + 1}}`);
        const kept = structuredClone(entry);
        kept.item_ref = keptRef;
        kept.position_seconds = entry.position_seconds + (keptLength * index);
        this.items.set(keptRef.ref, kept);
        keptRefs.push(keptRef.ref);
      }
      for (let index = 0; index < silenceCount; index += 1) {
        deletedRefs.push(itemRef(`{SPLIT-${this.splitSerial}-DELETED-${index + 1}}`).ref);
      }
      return execution(id, {
        source_item_ref: entry.item_ref.ref,
        owner_track_ref: entry.track_ref,
        silence_segment_count: silenceCount,
        split_count: silenceCount * 2,
        delete_count: silenceCount,
        item_count_before: itemCountBefore,
        item_count_after: itemCountBefore + keptCount - 1,
        kept_item_refs: keptRefs,
        deleted_item_refs: deletedRefs,
        removed_duration_seconds: removedSeconds,
        remaining_duration_seconds: remainingSeconds,
        source_media_deleted: false,
        changed: silenceCount > 0,
        readback_status: "passed",
      }, keptRefs.map((ref) => exactItemObject(ref)));
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

function exactItemObject(ref) {
  return itemRef(ref.slice("item:guid:".length));
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
    "template.items.split_item_by_silence",
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
