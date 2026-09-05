import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT,
  attachAlpha3_3B1AgentContextProductMetadata,
  createAlpha3_3B1AgentContextMacroGuide,
  rankAlpha3_3B1MacroIntents,
} from "../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  planAlpha3_2ERoutingApplyMacro,
} from "../../packages/mcp-server/src/alpha3-2e-routing-apply-v1.mjs";

describe("Alpha3.3-B1 agent context Macro guide", () => {
  it("returns one flat compact fifteen-Macro menu without tier fields", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide({
      recommended_macro_ids: ["macro.midi.apply", "macro.fx.apply_chain", "macro.items.apply"],
    });

    assert.equal(guide.contract, ALPHA3_3_B1_AGENT_CONTEXT_MACRO_GUIDE_CONTRACT);
    assert.equal(guide.tool_surface.count, 6);
    assert.deepEqual(guide.tool_surface.tools, [
      "ping",
      "get_state",
      "list_templates",
      "list_recipes",
      "call_template",
      "call_recipe",
    ]);
    assert.equal(guide.tool_surface.adds_public_tool, true);
    assert.deepEqual(guide.macro_menu.macro_ids, ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);
    assert.equal(guide.macro_menu.visible_executable_count, 15);
    assert.equal(guide.macro_menu.final_target_count, 15);
    assert.deepEqual(guide.recommended_macro_ids, ["macro.midi.apply", "macro.fx.apply_chain", "macro.items.apply"]);

    assert.equal(guide.live_target_binding.contract, "openreaper.live_target_binding.agent_guidance.v1");
    assert.match(guide.live_target_binding.agent_rules.join(" "), /selected_context pre-query/iu);
    assert.match(guide.live_target_binding.agent_rules.join(" "), /enumerate\/loop/iu);
    assert.match(guide.live_target_binding.agent_rules.join(" "), /never invent refs/iu);
    assert.equal(guide.live_target_binding.supported.includes("selected_item_reverse"), true);
    assert.equal(guide.live_target_binding.supported.includes("selected_track_freeze_unfreeze"), true);
    assert.equal(guide.live_target_binding.supported.includes("selected_track_external_render"), true);
    assert.equal(guide.live_target_binding.supported.includes("track_time_items_query_or_mutation"), true);
    assert.deepEqual(
      guide.live_target_binding.safe_omitted_target_defaults.map((entry) => entry.operation_id),
      ["macro.items.apply", "template.tracks.freeze_track", "template.tracks.unfreeze_track", "macro.render.targets"],
    );
    assert.equal(guide.live_target_binding.safe_omitted_target_defaults[0].default_target_binding.selector, "selected");

    const keys = collectKeys(guide);
    for (const forbidden of ["primary_spine", "secondary_menu", "guide_tier", "primary_macro_ids"]) {
      assert.equal(keys.includes(forbidden), false, forbidden);
    }
  });

  it("expands full manuals only for exact visible canonical ids", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide({
      requested_ids: [
        "macro.midi.apply",
        "macro.fx.apply_chain",
        "macro.fx.set_controls",
        "macro.items.analyze",
        "macro.items.apply",
        "macro.automation.apply",
        "macro.controls.set",
        "macro.midi.create_clip",
      ],
    });

    assert.deepEqual(guide.requested_expansions.items.map((entry) => entry.id), [
      "macro.midi.apply",
      "macro.fx.apply_chain",
      "macro.fx.set_controls",
      "macro.items.analyze",
      "macro.items.apply",
      "macro.automation.apply",
      "macro.controls.set",
    ]);
    assert.deepEqual(guide.requested_expansions.missing_ids, [
      "macro.midi.create_clip",
    ]);
    assert.equal(guide.requested_expansions.items.every((entry) => entry.runnable === true), true);
    assert.match(
      guide.requested_expansions.items[0].action_manual.input_shape.mode,
      /create_clips/i,
    );
    assert.match(
      guide.requested_expansions.items[0].action_manual.input_shape.mode,
      /edit_notes/i,
    );
    const createClipExample = guide.requested_expansions.items[0].action_manual.examples.find((entry) => entry?.input?.notes);
    assert.equal(createClipExample.input.mode, "create_clips");
    assert.deepEqual(
      guide.requested_expansions.items[3].action_manual.input_shape.profile,
      "quick | audio | timing | full; defaults to quick.",
    );
    assert.match(
      guide.requested_expansions.items[4].action_manual.input_shape.mode,
      /align_starts/u,
    );
    assert.match(
      guide.requested_expansions.items[5].action_manual.input_shape.mode,
      /insert_points/u,
    );
    assert.match(
      guide.requested_expansions.items[6].action_manual.input_shape.target_kind,
      /project/u,
    );
    assert.equal(
      guide.requested_expansions.items[6].action_manual.examples[0].input.fields.bpm,
      128,
    );
    assert.match(
      guide.requested_expansions.items[6].action_manual.input_shape.changes,
      /1-8 rows/u,
    );
    assert.equal(
      guide.requested_expansions.items[6].action_manual.examples[2].input.changes.length,
      2,
    );
    const applyFx = guide.requested_expansions.items[1].action_manual;
    const setFx = guide.requested_expansions.items[2].action_manual;
    const selectedReverse = guide.live_target_binding.supported_examples.find((entry) => entry.name.includes("selected Items"));
    assert.equal(selectedReverse.call.arguments.input.mode, "reverse");
    assert.equal(selectedReverse.call.arguments.input.target_binding.selector, "selected");
    const itemDefaults = guide.requested_expansions.items[4].action_manual.default_target_bindings;
    assert.deepEqual(itemDefaults[0].when.mode, ["reverse", "glue"]);
    assert.equal(itemDefaults[0].target_binding.domain, "items");
    assert.equal(itemDefaults[0].zero_write_when_empty_or_over_limit, true);
    const itemManual = guide.requested_expansions.items[4].action_manual;
    assert.equal(itemManual.common_blockers.some((entry) => entry.code === "PROJECT_LOCKING_ENABLED"), true);
    assert.match(itemManual.recovery_steps.join(" "), /disable REAPER Locking.*retry the same Reverse call/iu);
    const constrainedGlue = guide.live_target_binding.supported_examples.find((entry) => entry.name.startsWith("glue Items"));
    assert.equal(constrainedGlue.call.arguments.input.mode, "glue");
    assert.deepEqual(constrainedGlue.call.arguments.input.target_binding.constraints.map((entry) => entry.kind), ["owner_in", "time_relation"]);
    const selectedFreeze = guide.live_target_binding.supported_examples.find((entry) => entry.name.includes("freeze the currently"));
    assert.equal(selectedFreeze.call.arguments.id, "template.tracks.freeze_track");
    assert.deepEqual(selectedFreeze.call.arguments.input, { mode: "stereo" });
    assert.match(selectedFreeze.counterpart, /empty input/u);
    const constrainedQuery = guide.live_target_binding.supported_examples.find((entry) => entry.name.startsWith("list Items"));
    assert.equal(constrainedQuery.call.arguments.id, "macro.project.query");
    assert.equal(constrainedQuery.call.arguments.input.entity, "items");
    assert.match(constrainedQuery.agent_note, /without this preliminary query/u);
    const selectedRender = guide.live_target_binding.supported_examples.find((entry) => entry.name.includes("render the currently"));
    assert.equal(selectedRender.call.arguments.id, "macro.render.targets");
    assert.equal(selectedRender.call.arguments.input.target_kind, "selected_tracks");
    assert.equal(Object.hasOwn(selectedRender.call.arguments, "refs"), false);
    const statuses = Object.fromEntries(guide.live_target_binding.capability_matrix.map((entry) => [entry.scenario, entry.status]));
    assert.equal(statuses.selected_item_reverse, "supported");
    assert.equal(statuses.selected_item_glue, "supported");
    assert.equal(statuses.selected_track_freeze_or_unfreeze, "supported");
    assert.equal(statuses.selected_track_external_render, "supported");
    assert.equal(statuses.selected_track_project_stem, "supported");
    assert.equal(statuses.items_on_tracks_intersecting_time_selection_query_or_mutation, "supported");
    assert.equal(statuses.selected_envelope_automation_item_or_point_binding, "supported_with_native_limits");
    assert.equal(statuses.recipe_target_sets, "supported");
    const stem = guide.live_target_binding.supported_examples.find((entry) => entry.name.includes("project Stem"));
    assert.equal(stem.call.arguments.id, "macro.render.targets");
    assert.equal(stem.call.arguments.input.destination, "new_project_track");
    assert.equal(Object.hasOwn(stem.call.arguments.input, "target_binding"), false);
    const automation = guide.live_target_binding.supported_examples.find((entry) => entry.name.includes("Automation Items"));
    assert.equal(automation.call.arguments.input.target_binding.domain, "automation_items");
    assert.match(automation.agent_note, /D_UISEL/u);
    assert.match(guide.live_target_binding.binding_lifetime.recipe_run, /run start/u);
    assert.deepEqual(guide.live_target_binding.unsupported_behavior.includes("Do not emulate"), true);
    assert.match(guide.live_target_binding.unsupported_behavior, /Do not emulate/u);
    const fanout = applyFx.examples.find((entry) => entry.name.includes("homogeneous active-Take FX set"));
    assert.equal(fanout.input.target_binding.selector, "active_take_of_items");
    assert.equal(fanout.input.target_binding.cardinality.maximum, 64);
    assert.match(fanout.returns, /fx_set_ref/u);
    const shared = setFx.examples.find((entry) => entry.name.includes("homogeneous Take FX set"));
    assert.equal(shared.prerequisite.public_sequence.length, 2);
    assert.equal(shared.prerequisite.public_sequence[1].arguments.input.mode, "inspect_set");
    assert.equal(shared.input.mode, "shared_plan");
    assert.match(setFx.when_not_to_use.join(" "), /never reuse an fx_set_ref or parameter_plan_ref/u);
    assert.equal(collectKeys(guide.requested_expansions).includes("guide_tier"), false);
  });

  it("keeps aliases out of the menu and preserves typed direct-Template fallback reasons", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide();
    const menuIds = new Set(guide.macro_menu.macro_ids);
    for (const alias of guide.compatibility.aliases) assert.equal(menuIds.has(alias.id), false);
    assert.deepEqual(guide.direct_template_fallback.typed_gap_reasons, [
      "macro_missing_for_task",
      "macro_task_out_of_scope",
      "macro_target_ambiguous_or_unavailable",
      "macro_domain_not_accepted",
      "macro_budget_prefers_atomic_template",
    ]);
    assert.match(guide.direct_template_fallback.routing, /does not execute a Recipe/u);
    assert.match(guide.direct_template_fallback.routing, /public call_recipe tool/u);
  });

  it("expands the current executable Media manual instead of the historical plan-only guide", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide({ requested_ids: ["macro.media.place_assets"] });
    const [media] = guide.requested_expansions.items;

    assert.equal(media.id, "macro.media.place_assets");
    assert.equal(media.runnable, true);
    assert.equal(media.implementation_status, "executable_registered_program");
    assert.match(media.action_manual.input_shape.placement, /sequence_on_one_track/u);
    assert.match(media.action_manual.input_shape.placement, /append_after_existing/u);
    assert.match(media.action_manual.input_shape.track_policy, /one_new_track_per_asset/u);
    assert.match(media.action_manual.input_shape.mode, /relink_sources/u);
    assert.match(media.action_manual.input_shape.assets, /native absolute OS path JSON string/u);
    assert.match(media.action_manual.input_shape.assets, /preserve Unicode and spaces literally/u);
    assert.match(media.action_manual.common_blockers.map((entry) => entry.code).join(" "), /MEDIA_SOURCE_PATH_ENCODING_INVALID/u);
    assert.match(media.action_manual.readback_steps.join(" "), /dispatch success alone never marks applied/iu);
  });

  it("teaches project-file Agents to pass native Unicode paths without shell encoding", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide({ requested_ids: ["macro.project.file"] });
    const [projectFile] = guide.requested_expansions.items;
    assert.match(projectFile.action_manual.input_shape.target_path, /native absolute \.RPP path/u);
    assert.match(projectFile.action_manual.input_shape.target_path, /Unicode and spaces literal/u);
    assert.match(projectFile.action_manual.common_blockers.map((entry) => entry.code).join(" "), /SAVE_AS_TARGET_PATH_ENCODING_INVALID/u);
  });

  it("publishes the exact executable Routing ABI and a planner-valid preview-to-execute handoff", () => {
    const guide = createAlpha3_3B1AgentContextMacroGuide({ requested_ids: ["macro.routing.apply"] });
    const [routing] = guide.requested_expansions.items;
    const manual = routing.action_manual;
    const manualText = JSON.stringify(manual);

    assert.deepEqual(Object.keys(manual.input_shape), [
      "routes",
      "master_parent",
      "channel_counts",
      "dry_run",
      "compact_response",
    ]);
    for (const staleField of ["source_ref", "target_ref", "track_channel_counts", "readback_policy", "\"mute\""]) {
      assert.equal(manualText.includes(staleField), false, staleField);
    }
    assert.match(manual.input_shape.routes, /source_track_ref/u);
    assert.match(manual.input_shape.routes, /destination_track_ref/u);
    assert.match(manual.input_shape.routes, /muted boolean/u);
    assert.match(manual.readback_steps.join(" "), /dispatch success alone never marks a change applied/iu);
    assert.match(manual.preflight_steps.join(" "), /complete live project routing graph/iu);
    assert.match(manual.recovery_steps.join(" "), /do not blindly replay/iu);

    const previewExample = manual.examples.find((entry) => entry.name === "preview one exact create");
    const executeExample = manual.examples.find((entry) => entry.name.startsWith("execute the unchanged create"));
    const preview = planAlpha3_2ERoutingApplyMacro(previewExample.input);
    const execution = planAlpha3_2ERoutingApplyMacro(executeExample.input);
    assert.equal(preview.ok, true);
    assert.equal(preview.dry_run, true);
    assert.equal(execution.ok, true, JSON.stringify(execution.blockers));
    assert.equal(execution.dry_run, false);
    assert.deepEqual(manual.examples.map((entry) => entry.name), [
      "preview one exact create",
      "execute the unchanged create after preview",
      "preview one exact update",
      "preview one exact delete",
    ]);
  });

  it("ranks one to three canonical Macros from ordinary English and Chinese intent", () => {
    assert.deepEqual(rankAlpha3_3B1MacroIntents("create a MIDI clip and add a compressor"), [
      "macro.midi.apply",
      "macro.fx.apply_chain",
    ]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("保存并渲染选中的 item"), [
      "macro.render.targets",
      "macro.project.file",
    ]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("设置项目 BPM 和轨道音量"), ["macro.controls.set"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("set the project grid and enable snap"), ["macro.controls.set"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("创建 Intro 标记和 Chorus 区域"), ["macro.project.apply_layout"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("quantize existing MIDI notes"), ["macro.midi.apply"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("render MP3"), []);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("open project"), ["macro.project.file"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("add fade in to selected items"), ["macro.items.apply"]);
    assert.deepEqual(rankAlpha3_3B1MacroIntents("给选中 item 加淡入"), ["macro.items.apply"]);
  });

  it("attaches the same flat guide to non-template product surfaces", () => {
    const response = attachAlpha3_3B1AgentContextProductMetadata({
      mode: "default",
      items: [],
      missing_ids: [],
    });
    assert.deepEqual(
      response.product_surface.agent_context_macro_guide.macro_menu.macro_ids,
      ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
    );
    assert.equal(collectKeys(response.product_surface.agent_context_macro_guide).includes("primary_spine"), false);
  });
});

function collectKeys(value) {
  if (Array.isArray(value)) return value.flatMap(collectKeys);
  if (value && typeof value === "object") {
    return Object.entries(value).flatMap(([key, entry]) => [key, ...collectKeys(entry)]);
  }
  return [];
}
