import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT,
  ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY,
  summarizeAlpha3Block6StockPluginProductGate,
} from "../../packages/mcp-server/src/alpha3-block6-stock-plugin-product-gate-v1.mjs";
import {
  ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
} from "../../packages/mcp-server/src/alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha3 Block6 stock plugin product gate", () => {
  it("accepts the static stock-plugin fluency gate without broad live claims", () => {
    const summary = summarizeAlpha3Block6StockPluginProductGate();

    assert.equal(summary.contract, ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT);
    assert.equal(summary.mode, "static_stock_plugin_fluency_gate");
    assert.equal(summary.ok, true);
    assert.equal(summary.status, "static_ready_evidence_bound");
    assert.equal(summary.hard_gate.accepted, true);
    assert.deepEqual(summary.hard_gate.failures, []);
    assert.equal(summary.tool_surface.added_tools, 0);
    assert.equal(summary.coverage.plugin_count, 10);
    assert.equal(summary.coverage.starter_action_count, 10);
    assert.equal(summary.coverage.semantic_map_status, "covered_by_existing_templates");
    assert.equal(summary.coverage.all_starter_plugins_covered, true);
    assert.equal(summary.coverage.ready_starter_flow_count, 10);
    assert.equal(summary.coverage.hydration_blocker_flow_count, 10);
    assert.equal(summary.coverage.typed_blocker_probe_ok, true);
    assert.deepEqual(summary.coverage.accepted_live_plugin_ids, ["reacomp"]);
    assert.equal(summary.coverage.pending_live_plugin_ids.length, 9);
    assert.equal(summary.coverage.broad_live_support, false);
    assert.equal(summary.coverage.customer_ready, false);
    assert.equal(summary.live_evidence_matrix.contract, ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT);
    assert.equal(summary.live_evidence_matrix.broad_live_support, false);
    assert.equal(summary.live_evidence_matrix.customer_ready, false);
    assert.equal(summary.live_evidence_matrix.accepted_live_count, 1);
    assert.equal(summary.live_evidence_matrix.pending_live_count, 9);
    assert.equal(summary.live_evidence_matrix.bounded_live_smoke_status, "blocked_until_user_opens_bounded_live_window");
    assert.equal(summary.execution.live_reaper, false);
    assert.equal(summary.execution.safe_write, false);
    assert.equal(summary.execution.hidden_executor, false);
    assert.equal(summary.execution.public_call_recipe, false);
    assert.equal(summary.execution.raw_lua_action_shell_or_ui, false);
    assert.equal(summary.execution.alias_execution, false);
    assert.equal(summary.customer_flow.status, "static_ready_no_broad_live_claim");
    assert.equal(summary.trial_officer.verdict, "accept_block6_static_stock_plugin_gate");
    assert.deepEqual(summary.trial_officer.p0_p1_findings, []);
  });

  it("proves every starter hydrates first and then emits matching child write/readback requests", () => {
    const summary = summarizeAlpha3Block6StockPluginProductGate();
    const expectedPluginIds = [
      "reaeq",
      "reacomp",
      "reagate",
      "readelay",
      "reasynth",
      "rs5k",
      "reatune",
      "reapitch",
      "reaxcomp",
      "realimit",
    ];

    assert.deepEqual(summary.starter_action_flows.map((flow) => flow.plugin_id), expectedPluginIds);

    for (const flow of summary.starter_action_flows) {
      assert.equal(flow.hydration_gate.ok, true, flow.id);
      assert.equal(flow.hydration_gate.status, "needs_hydration_then_resume", flow.id);
      assert.equal(flow.hydration_gate.resolution_request_count, 2, flow.id);
      assert.equal(flow.hydration_gate.child_request_count, 0, flow.id);
      assert.equal(flow.hydration_gate.blocker_codes.includes("PARAMETER_METADATA_REQUIRED"), true, flow.id);
      assert.equal(flow.ready_gate.ok, true, flow.id);
      assert.equal(flow.ready_gate.status, "ready_for_child_execution_and_readback", flow.id);
      assert.equal(flow.ready_gate.child_request_count > 0, true, flow.id);
      assert.equal(flow.ready_gate.child_request_count, flow.ready_gate.readback_request_count, flow.id);
      assert.equal(flow.ready_gate.customer_readback_status, "ready_for_execution_and_readback", flow.id);
      assert.equal(flow.ready_gate.evidence_status, "ready_for_execution_and_readback", flow.id);
      assert.equal(flow.ready_gate.success_wording_allowed, false, flow.id);
      assert.equal(
        flow.ready_gate.emitted_template_ids.every((templateId) => templateId === "template.fx.set_fx_parameter_normalized"),
        true,
        flow.id,
      );
      assert.equal(
        flow.ready_gate.readback_template_ids.every((templateId) => templateId === "template.fx.read_fx_parameter"),
        true,
        flow.id,
      );
    }
  });

  it("keeps unsupported plugin and out-of-range controls as typed blockers", () => {
    const summary = summarizeAlpha3Block6StockPluginProductGate();

    assert.equal(summary.blocker_probe.ok, true);
    assert.equal(summary.blocker_probe.unknown_plugin.ok, false);
    assert.equal(summary.blocker_probe.unknown_plugin.request_count, 0);
    assert.equal(summary.blocker_probe.unknown_plugin.blocker_codes.includes("PLUGIN_NOT_SUPPORTED"), true);
    assert.equal(summary.blocker_probe.out_of_range_control.ok, false);
    assert.equal(summary.blocker_probe.out_of_range_control.request_count, 0);
    assert.equal(summary.blocker_probe.out_of_range_control.blocker_codes.includes("CONTROL_VALUE_OUT_OF_RANGE"), true);
  });

  it("exposes Block6 stock plugin status through the existing runtime product surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const productSurface = menu.product_surface;

    assert.equal(menu.mode, "menu");
    assert.equal(productSurface.detail_level, "compact");
    assert.deepEqual(
      productSurface.stock_plugin_product_gate,
      ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY,
    );
    assert.equal(productSurface.stock_plugin_product_gate.tool_surface.added_tools, 0);
    assert.equal(Object.hasOwn(productSurface, "stock_plugin_live_evidence"), false);
    assert.equal(Object.hasOwn(productSurface, "stock_plugin_product_gate_snapshot"), false);

    const expandedMenu = runtime.list_templates({
      ids: ["template.fx.read_fx_parameter"],
      fields: ["id"],
    });
    const expandedProductSurface = expandedMenu.product_surface;

    assert.equal(expandedMenu.mode, "ids");
    assert.deepEqual(expandedMenu.items.map((item) => item.id), ["template.fx.read_fx_parameter"]);
    assert.equal(expandedProductSurface.detail_level, "expanded");
    assert.equal(
      expandedProductSurface.stock_plugin_product_gate_snapshot.contract,
      ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT,
    );
    assert.equal(expandedProductSurface.stock_plugin_product_gate_snapshot.ok, true);
    assert.equal(expandedProductSurface.stock_plugin_product_gate_snapshot.hard_gate.accepted, true);
    assert.equal(expandedProductSurface.stock_plugin_product_gate_snapshot.coverage.ready_starter_flow_count, 10);
    assert.equal(expandedProductSurface.stock_plugin_product_gate_snapshot.coverage.broad_live_support, false);
    assert.equal(expandedProductSurface.stock_plugin_product_gate_snapshot.customer_flow.status, "static_ready_no_broad_live_claim");
  });
});
