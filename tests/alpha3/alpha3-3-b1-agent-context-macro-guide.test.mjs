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
    assert.deepEqual(guide.macro_menu.macro_ids, ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);
    assert.equal(guide.macro_menu.visible_executable_count, 15);
    assert.equal(guide.macro_menu.final_target_count, 15);
    assert.deepEqual(guide.recommended_macro_ids, ["macro.midi.apply", "macro.fx.apply_chain", "macro.items.apply"]);

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
    assert.match(media.action_manual.readback_steps.join(" "), /dispatch success alone never marks applied/iu);
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
    assert.deepEqual(rankAlpha3_3B1MacroIntents("open project"), []);
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
