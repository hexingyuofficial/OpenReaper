import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT,
  ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY,
  summarizeAlpha3Block3SpeedProductization,
} from "../../packages/mcp-server/src/alpha3-block3-speed-productization-v1.mjs";
import {
  createAlpha3C5OfficialMacroDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-c5-generic-control-macros-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha3 Block3 speed and generic controls productization", () => {
  it("accepts the static speed/friction gate over real C4/C5 planner outputs", () => {
    const summary = summarizeAlpha3Block3SpeedProductization();

    assert.equal(summary.contract, ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT);
    assert.equal(summary.mode, "static_speed_and_friction_gate");
    assert.equal(summary.ok, true);
    assert.equal(summary.hard_gate.accepted, true);
    assert.deepEqual(summary.hard_gate.failures, []);
    assert.equal(summary.tool_surface.added_tools, 0);
    assert.equal(summary.generic_control_flow.target_count, 8);
    assert.deepEqual(summary.generic_control_flow.fields, ["volume", "pan", "mute"]);
    assert.equal(summary.generic_control_flow.child_mutation_request_count, 24);
    assert.equal(summary.generic_control_flow.c4_product_flow.batch_readback_coverage.readback_request_count, 8);
    assert.equal(summary.generic_control_flow.round_trip_model.prompt_reduction_factor, 24);
    assert.equal(summary.generic_control_flow.round_trip_model.readback_reduction_factor, 3);
    assert.equal(summary.generic_control_flow.round_trip_model.meets_3x_target, true);
    assert.equal(summary.safe_parallel_read_flow.round_trip_model.safe_read_phase_reduction_factor, 3);
    assert.equal(summary.safe_parallel_read_flow.round_trip_model.meets_3x_target, true);
    assert.deepEqual(summary.safety_boundary.decisions, [
      "requires_user_confirmation",
      "requires_user_confirmation",
      "requires_user_confirmation",
    ]);
    assert.deepEqual(summary.safety_boundary.allowed_risk_domains_after_normalization, [
      "read",
      "safe_write",
      "write_project_reversible",
    ]);
    assert.equal(summary.macro_truth.live_runnable_now_count, 0);
    assert.equal(summary.execution.live_reaper, false);
    assert.equal(summary.execution.safe_write, false);
    assert.equal(summary.execution.hidden_executor, false);
    assert.equal(summary.execution.public_call_recipe, false);
    assert.equal(summary.execution.raw_lua_action_shell_or_ui, false);
    assert.equal(summary.execution.alias_execution, false);
    assert.equal(summary.execution.low_level_mutation_calls_reduced, false);
    assert.equal(summary.customer_flow.status, "static_ready_no_live_claim");
    assert.equal(summary.trial_officer.verdict, "accept_block3_static_speed_gate");
    assert.deepEqual(summary.trial_officer.p0_p1_findings, []);
  });

  it("keeps C5 generic controls non-live while making plan-only macro calls discoverable", () => {
    const entries = createAlpha3C5OfficialMacroDiscoveryItems();
    const track = entries.find((entry) => entry.id === "macro.set_track_controls");

    assert.equal(entries.every((entry) => entry.live_runnable_now === false), true);
    assert.equal(track.support_status, "plan_only_runtime_bound");
    assert.equal(track.support_state, "supported");
    assert.equal(track.expectedDelta.summary, "Returns a plan-only macro envelope. It does not mutate REAPER directly.");

    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates({
      ids: ["macro.set_track_controls"],
      fields: ["summary", "capability_truth"],
    });

    assert.equal(menu.items[0].id, "macro.set_track_controls");
    assert.equal(menu.items[0].current_status, "needs_ref");
    assert.equal(menu.items[0].capability_truth.live_runnable_now, false);
    assert.equal(menu.items[0].capability_truth.support_state, "supported");
    assert.equal(menu.items[0].user_message.includes("canonical ref"), true);
    assert.equal(menu.items[0].safety_note.includes("Macro planner only"), true);
  });

  it("exposes Block3 speed status through the existing runtime product surface", () => {
    const runtime = createCallTemplateRuntime();
    const productSurface = runtime.list_templates().product_surface;

    assert.deepEqual(
      productSurface.speed_productization,
      ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_DISCOVERY_SUMMARY,
    );
    assert.equal(productSurface.speed_productization.tool_surface.added_tools, 0);
    assert.equal(productSurface.speed_productization_snapshot.contract, ALPHA3_BLOCK3_SPEED_PRODUCTIZATION_CONTRACT);
    assert.equal(productSurface.speed_productization_snapshot.ok, true);
    assert.equal(productSurface.speed_productization_snapshot.hard_gate.accepted, true);
    assert.equal(productSurface.speed_productization_snapshot.customer_flow.status, "static_ready_no_live_claim");
  });
});
