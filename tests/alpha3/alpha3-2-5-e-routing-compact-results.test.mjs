import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import {
  ALPHA3_2_5_E_FALLBACK_GAP_REASONS,
  ALPHA3_2_5_E_MACRO_FIRST_ROUTING_CONTRACT,
  ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES,
} from "../../packages/mcp-server/src/alpha3-2a-agent-context-macro-guide-v1.mjs";
import { createAlpha3_3B1AgentContextMacroGuide } from "../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const EXPECTED_DEFAULT_MENU_MACRO_IDS = [
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
  "macro.controls.set",
  "macro.render.targets",
];

describe("Alpha3.2.5-E macro-first routing and compact results", () => {
  it("keeps the compact default menu focused on the 12 executable Macros before templates", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const macroIds = menu.items.filter((item) => item.action_kind === "macro").map((item) => item.id);

    assert.deepEqual(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS, EXPECTED_DEFAULT_MENU_MACRO_IDS);
    assert.deepEqual(macroIds, EXPECTED_DEFAULT_MENU_MACRO_IDS);
    assert.equal(Buffer.byteLength(JSON.stringify(menu)) <= ALPHA3_2A_DEFAULT_LIST_TEMPLATES_MAX_BYTES, true);

    const guide = menu.product_surface.agent_context_macro_guide;
    assert.deepEqual(guide.macro_menu.macro_ids, EXPECTED_DEFAULT_MENU_MACRO_IDS);
    assert.equal(guide.macro_menu.flat, true);
    assert.equal(guide.macro_menu.compact, true);
    assert.equal(menu.product_surface.macro_first_routing.contract, ALPHA3_2_5_E_MACRO_FIRST_ROUTING_CONTRACT);
    assert.equal(menu.product_surface.macro_first_routing.route, "macro_first");
    assert.deepEqual(menu.product_surface.macro_first_routing.selected_macro_ids, EXPECTED_DEFAULT_MENU_MACRO_IDS);
    assert.equal(menu.product_surface.macro_first_routing.fallback_gap, null);
  });

  it("keeps exact detail truthful and records typed reasons on real Template fallback responses", () => {
    const runtime = createCallTemplateRuntime();
    const guide = createAlpha3_3B1AgentContextMacroGuide();
    const exact = runtime.list_templates({
      ids: ["macro.midi.apply", "macro.fx.apply_chain", "macro.controls.set"],
      fields: ["id"],
    });
    const expansions = exact.product_surface.agent_context_macro_guide.requested_expansions.items;

    assert.equal(guide.direct_template_fallback.allowed, true);
    assert.equal(guide.direct_template_fallback.discovery_tool, "list_templates");
    assert.deepEqual(guide.direct_template_fallback.request_shape, {
      surface: "catalog",
      query: "one bounded capability phrase",
      limit: 25,
    });
    assert.deepEqual(guide.direct_template_fallback.typed_gap_reasons, ALPHA3_2_5_E_FALLBACK_GAP_REASONS);
    assert.match(guide.direct_template_fallback.routing, /do not add a new tool/i);
    assert.match(guide.direct_template_fallback.routing, /call_recipe/i);

    assert.deepEqual(expansions.map((item) => item.id), [
      "macro.midi.apply",
      "macro.fx.apply_chain",
      "macro.controls.set",
    ]);
    assert.equal(expansions.every((item) => item.implementation_status === "executable_registered_program"), true);
    assert.equal(expansions.every((item) => item.runnable === true), true);

    const fallback = runtime.list_templates({ surface: "catalog", query: "quantize", limit: 10 });
    assert.deepEqual(fallback.items.map((item) => item.id), [
      "template.midi.quantize_notes",
      "template.midi.quantize_selected_notes",
    ]);
    assert.equal(fallback.product_surface.macro_first_routing.route, "template_fallback");
    assert.equal(fallback.product_surface.macro_first_routing.fallback_gap.recorded, true);
    assert.equal(fallback.product_surface.macro_first_routing.fallback_gap.reason, "macro_task_out_of_scope");
    assert.equal(fallback.product_surface.macro_first_routing.task_text_persisted, false);

    const uncovered = runtime.list_templates({ surface: "catalog", query: "unmapped_spectral_surgery", limit: 10 });
    assert.deepEqual(uncovered.items, []);
    assert.equal(uncovered.product_surface.macro_first_routing.route, "no_match");
    assert.equal(uncovered.product_surface.macro_first_routing.fallback_gap.reason, "macro_missing_for_task");
  });

  it("makes SQLite candidates and live re-resolution the convenient project-aware path without low-level ref assembly", () => {
    const runtime = createCallTemplateRuntime();
    const expansions = runtime.list_templates({
      ids: ["macro.project.query", "macro.controls.set", "macro.midi.apply", "macro.fx.apply_chain"],
      fields: ["id"],
    }).product_surface.agent_context_macro_guide.requested_expansions.items;

    const byId = new Map(expansions.map((item) => [item.id, item.action_manual]));

    assert.match(byId.get("macro.project.query").when_to_use.join(" "), /selector\/ref source/i);
    assert.match(byId.get("macro.controls.set").required_readiness.join(" "), /fresh SQLite candidates/i);
    assert.match(byId.get("macro.controls.set").recovery_steps.join(" "), /never treat SQLite rows as write authority/i);
    assert.equal(Object.hasOwn(byId.get("macro.controls.set").input_shape, "selector"), true);
    assert.equal(Object.hasOwn(byId.get("macro.controls.set").input_shape, "selectors"), false);
    assert.match(byId.get("macro.midi.apply").required_readiness.join(" "), /fresh unambiguous project-aware selector/i);
    assert.match(byId.get("macro.midi.apply").recovery_steps.join(" "), /do not assemble take refs manually/i);
    assert.equal(byId.get("macro.midi.apply").dry_run_shape.supported, true);
    assert.match(byId.get("macro.fx.apply_chain").input_shape.selector, /Project Index track selector/i);
    assert.match(byId.get("macro.fx.apply_chain").input_shape.plugin, /reacomp/i);
  });

  it("keeps representative Macro envelopes compact under offline blockers", async () => {
    const runtime = createCallTemplateRuntime();
    const responses = await Promise.all([
      runtime.call_template({ id: "macro.project.inspect", input: { include: ["project_path"] } }),
      runtime.call_template({ id: "macro.project.query", input: { entity: "tracks", limit: 25 } }),
      runtime.call_template({ id: "macro.controls.set", input: { target_kind: "track", fields: { volume_db: -6 } } }),
      runtime.call_template({ id: "macro.midi.apply", input: { mode: "create_clips", start_seconds: 0, end_seconds: 1, notes: [] } }),
      runtime.call_template({ id: "macro.fx.apply_chain", input: { controls: { threshold_db: -18, ratio: 3 } } }),
    ]);

    for (const response of responses) {
      assert.equal(response.contract, "macro.execution.v1");
      assert.equal(response.ok, false);
      assert.equal(["blocked", "failed"].includes(response.execution.status), true);
      assert.equal(response.budget.truncated, false);
      assert.equal(response.budget.artifact_fallback, false);
      assert.equal(response.budget.actual_bytes <= response.budget.max_bytes, true, JSON.stringify(response.budget));
    }
  });
});
