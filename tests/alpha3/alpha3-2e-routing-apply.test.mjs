import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT,
  ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
  createAlpha3_2ERoutingApplyMacroDiscoveryItems,
  createAlpha3_2ERoutingApplyMacroRuntimeEnvelope,
  planAlpha3_2ERoutingApplyMacro,
} from "../../packages/mcp-server/src/alpha3-2e-routing-apply-v1.mjs";

describe("Alpha3.2-E routing apply planner", () => {
  it("publishes an executable registered routing Macro", () => {
    const [item] = createAlpha3_2ERoutingApplyMacroDiscoveryItems();
    assert.equal(item.id, ALPHA3_2E_ROUTING_APPLY_MACRO_ID);
    assert.equal(item.runnable, true);
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.implementation_status, "executable");
    assert.equal(item.support_status, "executable_runtime_bound");
    assert.equal(item.input_schema.properties.routes.type, "array");
  });

  it("returns a dry-run preview for internal routing operations", () => {
    const plan = planAlpha3_2ERoutingApplyMacro({
      routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5, pan: -0.1, muted: false }],
      master_parent: [{ id: "src_master", track_ref: "track:guid:{SRC}", enabled: false }],
      channel_counts: [{ id: "src_channels", track_ref: "track:guid:{SRC}", channel_count: 4 }],
      dry_run: true,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "dry_run_preview");
    assert.equal(plan.preview.target_counts.create_sends, 1);
    assert.equal(plan.preview.target_counts.send_updates, 1);
    assert.equal(plan.preview.target_counts.master_parent, 1);
    assert.equal(plan.preview.target_counts.channel_counts, 1);
    assert.deepEqual(plan.child_requests, []);
    assert.equal(plan.safety.hardware_device_io, false);
  });

  it("emits internal send, send-control, master-parent, channel-count, and readback requests", () => {
    const input = {
      routes: [
        { id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}", volume: 0.5, pan: 0, muted: false },
        { id: "send_b", action: "update", send_ref: "send:track:0:1", volume: 0.75 },
      ],
      master_parent: [{ id: "src_master", track_ref: "track:guid:{SRC}", enabled: true }],
      channel_counts: [{ id: "src_channels", track_ref: "track:guid:{SRC}", channel_count: 6 }],
    };
    const plan = planAlpha3_2ERoutingApplyMacro({ ...input, dry_run: false });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.preflight_requests.map((request) => request.id), ["template.routing.read_project_routing_graph"]);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), [
      "template.routing.create_track_send",
      "template.routing.set_send_volume",
      "template.routing.set_send_pan",
      "template.routing.set_send_mute",
      "template.routing.set_send_volume",
      "template.routing.set_master_parent_send",
      "template.routing.set_track_channel_count",
    ]);
    assert.equal(plan.mutation_requests[1].refs.send_ref, "send:planned:send_a");
    assert.equal(plan.mutation_requests[4].refs.send_ref, "send:track:0:1");
    assert.equal(plan.readback_requests.every((request) => request.id === "template.routing.read_track_routing"), true);
    assert.equal(plan.child_requests.length, plan.preflight_requests.length + plan.mutation_requests.length + plan.readback_requests.length);
  });

  it("emits exact internal send removals in descending source-slot order", () => {
    const input = {
      routes: [
        { id: "low", action: "delete", send_ref: "send:track:guid:{SRC}:1" },
        { id: "high", action: "delete", send_ref: "send:track:guid:{SRC}:4" },
        { id: "other", action: "delete", send_ref: "send:track:guid:{OTHER}:2" },
      ],
    };
    const plan = planAlpha3_2ERoutingApplyMacro({ ...input, dry_run: false });
    assert.equal(plan.ok, true);
    assert.equal(plan.preview.target_counts.remove_sends, 3);
    assert.deepEqual(plan.mutation_requests.map((request) => request.refs.send_ref.ref), [
      "send:track:guid:{OTHER}:2",
      "send:track:guid:{SRC}:4",
      "send:track:guid:{SRC}:1",
    ]);
    assert.deepEqual(plan.mutation_requests[1].refs.send_ref.identity, {
      scheme: "track_send",
      value: "track:guid:{SRC}:4",
    });
    assert.deepEqual(plan.readback_requests.map((request) => request.refs.track_ref), [
      "track:guid:{SRC}",
      "track:guid:{OTHER}",
    ]);
  });

  it("fails closed for delete, hardware/device endpoints, bad refs, bad values, duplicates, and unsupported idempotency", () => {
    const plan = planAlpha3_2ERoutingApplyMacro({
      routes: [
        { id: "dup", action: "delete", send_ref: "send:track:0:0" },
        { id: "dup", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "hardware:out:1", volume: 9, pan: 2, muted: "no" },
      ],
      master_parent: [{ track_ref: "device:main", enabled: "yes" }],
      channel_counts: [{ track_ref: "track:guid:{SRC}", channel_count: 3 }],
      extra: true,
    }, { idempotency_key_present: true });
    const codes = plan.blockers.map((entry) => entry.code);
    assert.equal(plan.ok, false);
    assert.equal(codes.includes("ROUTING_DELETE_SEND_REF_REQUIRED"), true);
    assert.equal(codes.includes("ROUTING_DEVICE_ENDPOINT_FORBIDDEN"), true);
    assert.equal(codes.includes("ROUTING_DESTINATION_TRACK_REF_INVALID"), true);
    assert.equal(codes.includes("ROUTING_ROUTE_ID_DUPLICATE"), true);
    assert.equal(codes.includes("ROUTING_SEND_VOLUME_INVALID"), true);
    assert.equal(codes.includes("ROUTING_SEND_PAN_INVALID"), true);
    assert.equal(codes.includes("ROUTING_SEND_MUTE_INVALID"), true);
    assert.equal(codes.includes("ROUTING_MASTER_PARENT_ENABLED_INVALID"), true);
    assert.equal(codes.includes("ROUTING_CHANNEL_COUNT_INVALID"), true);
    assert.equal(codes.includes("ROUTING_APPLY_IDEMPOTENCY_KEY_UNSUPPORTED"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("fails closed for self-sends, duplicate create edges, and request-local cycles", () => {
    const plan = planAlpha3_2ERoutingApplyMacro({
      routes: [
        { id: "self", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{A}" },
        { id: "ab1", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}" },
        { id: "ab2", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}" },
        { id: "ba", action: "create", source_track_ref: "track:guid:{B}", destination_track_ref: "track:guid:{A}" },
      ],
    });
    const codes = plan.blockers.map((entry) => entry.code);
    assert.equal(codes.includes("ROUTING_SELF_SEND_FORBIDDEN"), true);
    assert.equal(codes.includes("ROUTING_REQUEST_DUPLICATE_EDGE"), true);
    assert.equal(codes.includes("ROUTING_REQUEST_CYCLE"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("executes the same operation input with only dry_run changed to false", () => {
    const input = { routes: [{ id: "ab", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}" }] };
    const preview = planAlpha3_2ERoutingApplyMacro(input);
    const execution = planAlpha3_2ERoutingApplyMacro({ ...input, dry_run: false });
    assert.equal(preview.ok, true);
    assert.equal(preview.dry_run, true);
    assert.equal(Object.hasOwn(preview, "required_confirm_scope"), false);
    assert.equal(execution.ok, true);
    assert.equal(execution.mutation_requests.length, 1);
    assert.equal(execution.mutation_requests[0].operation_id, "ab");
  });

  it("allows repeated request-local edges only when every row explicitly allows duplicates", () => {
    const plan = planAlpha3_2ERoutingApplyMacro({
      routes: [
        { id: "ab1", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}", duplicate_policy: "allow_duplicate" },
        { id: "ab2", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}", duplicate_policy: "allow_duplicate" },
      ],
      dry_run: false,
    });
    assert.equal(plan.ok, true, JSON.stringify(plan.blockers));
    assert.equal(plan.mutation_requests.filter((request) => request.id === "template.routing.create_track_send").length, 2);
  });

  it("rejects operation ids reused across routing operation kinds", () => {
    const plan = planAlpha3_2ERoutingApplyMacro({
      routes: [{ id: "shared", action: "create", source_track_ref: "track:guid:{A}", destination_track_ref: "track:guid:{B}" }],
      master_parent: [{ id: "shared", track_ref: "track:guid:{A}", enabled: false }],
      channel_counts: [{ id: "shared", track_ref: "track:guid:{A}", channel_count: 4 }],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.filter((entry) => entry.code === "ROUTING_OPERATION_ID_DUPLICATE").length, 2);
    assert.deepEqual(plan.child_requests, []);
  });

  it("wraps routing plans in runtime envelopes without executing children", () => {
    const preview = planAlpha3_2ERoutingApplyMacro({ routes: [{ id: "send_a", action: "create", source_track_ref: "track:guid:{SRC}", destination_track_ref: "track:guid:{DST}" }] });
    const envelope = createAlpha3_2ERoutingApplyMacroRuntimeEnvelope({ request: { id: ALPHA3_2E_ROUTING_APPLY_MACRO_ID, input: {} }, plan: preview, now: () => new Date("2026-07-11T00:00:00Z") });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.contract, ALPHA3_2E_ROUTING_APPLY_MACRO_CONTRACT);
    assert.equal(envelope.result.executed, false);
    assert.equal(envelope.result.execution.executor_call_count, 0);
    assert.equal(envelope.result.execution.hardware_device_io, false);
  });
});
