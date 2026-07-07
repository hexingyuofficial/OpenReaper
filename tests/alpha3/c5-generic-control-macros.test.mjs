import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY,
  ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
  getAlpha3C5GenericControlMacro,
  listAlpha3C5GenericControlMacros,
  planAlpha3C5GenericControlMacro,
} from "../../packages/mcp-server/src/alpha3-c5-generic-control-macros-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha3 C5 generic control macro schemas", () => {
  it("registers the planned generic control macro surface without adding tools or an executor", () => {
    const registry = listAlpha3C5GenericControlMacros();

    assert.equal(registry.contract, ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT);
    assert.equal(registry.mode, "plan_only_schema_registry");
    assert.deepEqual(registry.tool_surface, {
      added_tools: 0,
      discovery_tools: ["list_templates"],
      execution_tool: "call_template",
      artifact_tool: "get_state",
    });
    assert.deepEqual(
      registry.macros.map((macro) => macro.id),
      [
        "macro.set_track_controls",
        "macro.set_item_controls",
        "macro.set_take_controls",
        "macro.set_transport_controls",
        "macro.set_send_controls",
        "macro.set_midi_controls",
      ],
    );
    assert.equal(registry.macros.every((macro) => macro.action_kind === "macro"), true);
    assert.equal(registry.macros.every((macro) => macro.menu_group === "act"), true);
    assert.equal(registry.macros.every((macro) => macro.safety.no_added_tools), true);
    assert.equal(registry.macros.every((macro) => macro.safety.no_public_call_recipe), true);
    assert.equal(registry.macros.every((macro) => macro.safety.no_hidden_executor), true);
    assert.equal(registry.macros.every((macro) => macro.safety.no_raw_lua_action_shell_or_ui), true);
  });

  it("keeps generic controls as partial schemas over accepted per-field templates", () => {
    const track = getAlpha3C5GenericControlMacro("macro.set_track_controls");
    const item = getAlpha3C5GenericControlMacro("macro.set_item_controls");
    const take = getAlpha3C5GenericControlMacro("macro.set_take_controls");

    assert.equal(track.coverage.status, "partial");
    assert.equal(track.fields.find((field) => field.name === "volume").template_id, "template.tracks.set_volume");
    assert.equal(track.fields.find((field) => field.name === "record_arm").template_id, "template.tracks.set_record_arm");
    assert.equal(track.blocked_fields.some((field) => field.field === "hardware_output" && field.code === "HARD_STOP_DOMAIN"), true);

    assert.equal(item.fields.find((field) => field.name === "position_seconds").template_id, "template.items.move_item");
    assert.equal(item.fields.find((field) => field.name === "fade_in_seconds").template_required_inputs.includes("fade_out_seconds"), true);
    assert.equal(item.blocked_fields.some((field) => field.field === "delete" && field.code === "DESTRUCTIVE_DOMAIN"), true);

    assert.equal(take.refs[0].name, "item_ref");
    assert.equal(take.blocked_fields.some((field) => field.field === "per_take_selection"), true);
    assert.equal(take.fields.find((field) => field.name === "playrate").template_required_inputs.includes("preserve_pitch"), true);
  });

  it("plans supplied track fields as serial call_template requests plus one readback", () => {
    const plan = planAlpha3C5GenericControlMacro("macro.set_track_controls", {
      refs: { track_ref: "track:guid:{TRACK-A}" },
      fields: {
        volume: 0.75,
        pan: -0.2,
        record_arm: true,
      },
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "plan_only_call_template_macro");
    assert.equal(plan.undo_scope, "serial_per_template_undo_evidence");
    assert.match(plan.policy, /do not claim an atomic multi-field transaction/);
    assert.deepEqual(
      plan.requests.map((request) => request.id),
      [
        "template.tracks.set_volume",
        "template.tracks.set_pan",
        "template.tracks.set_record_arm",
      ],
    );
    assert.deepEqual(plan.requests.map((request) => request.refs), [
      { track_ref: "track:guid:{TRACK-A}" },
      { track_ref: "track:guid:{TRACK-A}" },
      { track_ref: "track:guid:{TRACK-A}" },
    ]);
    assert.deepEqual(plan.readback, {
      tool: "call_template",
      id: "template.tracks.read_mixer_controls",
      refs: { track_ref: "track:guid:{TRACK-A}" },
      input: { include_selected: true, limit: 50 },
      expected_evidence: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    });
  });

  it("blocks incomplete grouped inputs instead of emitting invalid template calls", () => {
    const fadePlan = planAlpha3C5GenericControlMacro("macro.set_item_controls", {
      refs: { item_ref: "item:guid:{ITEM-A}" },
      fields: { fade_in_seconds: 0.02 },
    });
    const playratePlan = planAlpha3C5GenericControlMacro("macro.set_take_controls", {
      refs: { item_ref: "item:guid:{ITEM-A}" },
      fields: { playrate: 0.5 },
    });

    assert.equal(fadePlan.ok, false);
    assert.equal(fadePlan.requests.length, 0);
    assert.equal(fadePlan.blockers[0].code, "TEMPLATE_INPUT_GROUP_INCOMPLETE");
    assert.match(fadePlan.blockers[0].message, /fade_out_seconds/);

    assert.equal(playratePlan.ok, false);
    assert.equal(playratePlan.requests.length, 0);
    assert.equal(playratePlan.blockers[0].code, "TEMPLATE_INPUT_GROUP_INCOMPLETE");
    assert.match(playratePlan.blockers[0].message, /preserve_pitch/);
  });

  it("turns blocked or unknown supplied fields into blockers instead of silently dropping them", () => {
    const hardStopPlan = planAlpha3C5GenericControlMacro("macro.set_track_controls", {
      refs: { track_ref: "track:guid:{TRACK-A}" },
      fields: { hardware_output: 1 },
    });
    const typoPlan = planAlpha3C5GenericControlMacro("macro.set_track_controls", {
      refs: { track_ref: "track:guid:{TRACK-A}" },
      fields: { typo_volume: 0.5 },
    });

    assert.equal(hardStopPlan.ok, false);
    assert.equal(hardStopPlan.requests.length, 0);
    assert.equal(hardStopPlan.blockers[0].field, "hardware_output");
    assert.equal(hardStopPlan.blockers[0].code, "HARD_STOP_DOMAIN");

    assert.equal(typoPlan.ok, false);
    assert.equal(typoPlan.requests.length, 0);
    assert.equal(typoPlan.blockers[0].field, "typo_volume");
    assert.equal(typoPlan.blockers[0].code, "FIELD_NOT_SUPPORTED");
  });

  it("requires owner track refs for send controls so readback can verify routing", () => {
    const blocked = planAlpha3C5GenericControlMacro("macro.set_send_controls", {
      refs: { send_ref: "send:track:{TRACK-A}:0" },
      fields: { volume: 0.5 },
    });
    const covered = planAlpha3C5GenericControlMacro("macro.set_send_controls", {
      refs: {
        send_ref: "send:track:{TRACK-A}:0",
        track_ref: "track:guid:{TRACK-A}",
      },
      fields: { volume: 0.5, pan: 0.1 },
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.requests.length, 0);
    assert.equal(blocked.readback, null);
    assert.equal(blocked.blockers.some((blocker) => blocker.field === "track_ref" && blocker.code === "REQUIRED_REF_MISSING"), true);

    assert.equal(covered.ok, true);
    assert.deepEqual(
      covered.requests.map((request) => request.id),
      ["template.routing.set_send_volume", "template.routing.set_send_pan"],
    );
    assert.deepEqual(covered.readback, {
      tool: "call_template",
      id: "template.routing.read_track_routing",
      refs: { track_ref: "track:guid:{TRACK-A}" },
      input: { include_receives: true, include_master_parent: true, max_routes: 100 },
      expected_evidence: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    });
  });

  it("exposes the C5 schema summary through the existing list_templates product surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();

    assert.deepEqual(
      menu.product_surface.generic_control_macros,
      ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY,
    );
    assert.equal(menu.product_surface.generic_control_macros.tool_surface.added_tools, 0);
    assert.deepEqual(
      menu.product_surface.generic_control_macros.macro_ids.slice(0, 5),
      [
        "macro.set_track_controls",
        "macro.set_item_controls",
        "macro.set_take_controls",
        "macro.set_transport_controls",
        "macro.set_send_controls",
      ],
    );
  });
});
