import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
  ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  createAlpha3E1OfficialMacroDiscoveryItems,
  getAlpha3E1StockPluginMap,
  listAlpha3E1StockPluginMaps,
  planAlpha3E1StockPluginMacro,
} from "../../packages/mcp-server/src/alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Alpha3 E1 stock plugin fluency", () => {
  it("registers semantic maps for the Phase 3 stock plugin set without adding tools", () => {
    const registry = listAlpha3E1StockPluginMaps();

    assert.equal(registry.contract, ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT);
    assert.equal(registry.mode, "plan_only_stock_plugin_semantic_maps");
    assert.deepEqual(registry.tool_surface, {
      added_tools: 0,
      discovery_tools: ["list_templates"],
      execution_tool: "call_template",
      artifact_tool: "get_state",
    });
    assert.deepEqual(
      registry.plugins.map((plugin) => plugin.id),
      [
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
      ],
    );
    assert.deepEqual(registry.starter_actions.map((action) => action.id), [
      "vocal_presence_eq",
      "gentle_vocal_compression",
      "bleed_cleanup_gate",
      "tempo_delay",
      "soft_synth_pad",
      "tight_sampler_pad",
      "natural_pitch_correction",
      "octave_down_pitch",
      "gentle_multiband_control",
      "safe_peak_limit",
    ]);
    assert.deepEqual(registry.starter_actions.map((action) => action.plugin_id), [
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
    ]);
    assert.equal(registry.coverage.status, "covered_by_existing_templates");
    assert.equal(registry.safety.added_tools, 0);
    assert.equal(registry.safety.public_call_recipe, false);
    assert.equal(registry.safety.hidden_executor, false);
    assert.equal(registry.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(registry.safety.parameter_truth, "fresh_fx_parameter_metadata_required_before_write");
    assert.deepEqual([...TOOL_ABI_V1_TOOL_NAMES].sort(), [
      "call_template",
      "get_state",
      "list_recipes",
      "list_templates",
      "ping",
    ].sort());
  });

  it("keeps every semantic parameter bounded and metadata-resolved instead of baking parameter indexes", () => {
    const registry = listAlpha3E1StockPluginMaps();

    for (const plugin of registry.plugins) {
      assert.equal(plugin.parameters.length >= 3, true, plugin.id);
      assert.equal(plugin.resolution_policy.no_baked_param_indexes, true, plugin.id);
      assert.equal(plugin.resolution_policy.source, "fresh_fx_parameter_metadata", plugin.id);
      assert.equal(plugin.resolution_policy.write_template, "template.fx.set_fx_parameter_normalized", plugin.id);
      for (const parameter of plugin.parameters) {
        assert.equal(Number.isFinite(parameter.safe_range.min), true, `${plugin.id}:${parameter.id}`);
        assert.equal(Number.isFinite(parameter.safe_range.max), true, `${plugin.id}:${parameter.id}`);
        assert.equal(parameter.safe_range.min < parameter.safe_range.max, true, `${plugin.id}:${parameter.id}`);
        assert.equal(parameter.resolution.source, "fresh_fx_parameter_metadata", `${plugin.id}:${parameter.id}`);
        assert.equal(parameter.resolution.accepts.includes("param_index"), true, `${plugin.id}:${parameter.id}`);
      }
    }

    assert.equal(getAlpha3E1StockPluginMap("VST: ReaComp (Cockos)").id, "reacomp");
    assert.equal(getAlpha3E1StockPluginMap("RS5k").id, "rs5k");
  });

  it("creates one official macro discovery entry over existing list_templates/call_template", () => {
    const [entry] = createAlpha3E1OfficialMacroDiscoveryItems();

    assert.equal(entry.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(entry.kind, "official_macro");
    assert.equal(entry.action_kind, "macro");
    assert.equal(entry.macro_kind, "stock_plugin_control");
    assert.equal(entry.menu_group, "act");
    assert.equal(entry.pack, "core");
    assert.equal(entry.live_runnable_now, true);
    assert.equal(entry.known_blocker, null);
    assert.equal(entry.inputSchema.required.includes("plugin"), false);
    assert.equal(entry.inputSchema.required.includes("controls"), false);
    assert.equal(Object.hasOwn(entry.inputSchema.properties, "starter_action"), true);
    assert.equal(entry.starter_action_ids.includes("gentle_vocal_compression"), true);
    assert.equal(entry.task_intents.includes("monster voice"), true);
    assert.equal(entry.refs.input[0].name, "fx_ref");
    assert.equal(entry.expectedDelta.summary, "Returns a plan-only stock-plugin macro envelope. It does not mutate REAPER directly.");
  });

  it("blocks stock plugin writes until fresh FX parameter metadata resolves the real index", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: {
        threshold_db: -18,
        ratio: 4,
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.requests.length, 0);
    assert.equal(plan.readback.length, 0);
    assert.equal(plan.resolution_requests.length, 2);
    assert.equal(plan.resolution_requests[0].id, "template.fx.read_fx_summary");
    assert.equal(plan.resolution_requests[1].id, "template.fx.list_fx_parameters");
    assert.equal(
      plan.blockers.every((blocker) => blocker.code === "PARAMETER_METADATA_REQUIRED"),
      true,
    );
  });

  it("turns starter actions into hydration-first stock plugin control plans", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "gentle_vocal_compression",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.plugin.id, "reacomp");
    assert.equal(plan.starter_action.id, "gentle_vocal_compression");
    assert.deepEqual(Object.keys(plan.starter_action.action_parameters), []);
    assert.equal(plan.requests.length, 0);
    assert.equal(plan.readback.length, 0);
    assert.equal(plan.hydration_flow.contract, "alpha3.e1.stock_plugin_hydration_flow.v1");
    assert.equal(plan.hydration_flow.status, "needs_fresh_parameter_metadata");
    assert.deepEqual(plan.hydration_flow.steps.map((step) => step.id), [
      "verify_fx_identity",
      "hydrate_parameter_metadata",
    ]);
    assert.deepEqual(plan.hydration_flow.steps[1].wanted_controls, [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ]);
    assert.equal(
      plan.blockers.every((blocker) => blocker.code === "PARAMETER_METADATA_REQUIRED"),
      true,
    );
  });

  it("calculates tempo-delay starter controls without guessing tempo", () => {
    const missingTempo = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "tempo_delay",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
    });
    const tempoPlan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "tempo_delay",
      action_parameters: { tempo_bpm: 120, division: "1/8d" },
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
    });

    assert.equal(missingTempo.ok, false);
    assert.equal(missingTempo.blockers.some((blocker) => blocker.code === "ACTION_INPUT_REQUIRED"), true);
    assert.equal(tempoPlan.plugin.id, "readelay");
    assert.equal(tempoPlan.starter_action.action_parameters.tempo_bpm, 120);
    assert.equal(tempoPlan.hydration_flow.wanted_controls.includes("delay_ms"), true);
    assert.equal(tempoPlan.hydration_flow.wanted_controls.includes("feedback_percent"), true);
  });

  it("plans accepted FX parameter calls and human readback when metadata is fresh", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: {
        threshold_db: -18,
        ratio: 4,
      },
      parameter_metadata: {
        threshold_db: { param_index: 0, param_ident: "threshold", label: "Threshold", freshness_status: "fresh" },
        ratio: { param_index: 1, param_ident: "ratio", label: "Ratio", freshness_status: "fresh" },
      },
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.requests.length, 2);
    assert.deepEqual(
      plan.requests.map((request) => request.id),
      [
        "template.fx.set_fx_parameter_normalized",
        "template.fx.set_fx_parameter_normalized",
      ],
    );
    assert.deepEqual(plan.requests.map((request) => request.input.param_index), [0, 1]);
    assert.deepEqual(plan.requests.map((request) => request.input.param_ident), ["threshold", "ratio"]);
    assert.deepEqual(plan.requests.map((request) => request.refs), [
      { fx_ref: "fx:track:guid:{TRACK}:1" },
      { fx_ref: "fx:track:guid:{TRACK}:1" },
    ]);
    assert.equal(plan.requests[0].input.normalized_value, 0.7);
    assert.equal(plan.readback.length, 2);
    assert.equal(plan.readback[0].id, "template.fx.read_fx_parameter");
    assert.equal(plan.human_readback[0].phrase, "Threshold at -18 dB.");
    assert.equal(plan.human_readback[1].phrase, "4:1 ratio.");
  });

  it("plans accepted starter action child requests when all metadata is fresh", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "safe_peak_limit",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      parameter_metadata: {
        threshold_db: { param_index: 0, freshness_status: "fresh" },
        ceiling_db: { param_index: 1, freshness_status: "fresh" },
        release_ms: { param_index: 2, freshness_status: "fresh" },
        lookahead_ms: { param_index: 3, freshness_status: "fresh" },
      },
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.plugin.id, "realimit");
    assert.equal(plan.starter_action.id, "safe_peak_limit");
    assert.equal(plan.requests.length, 4);
    assert.equal(plan.readback.length, 4);
    assert.equal(plan.hydration_flow.status, "ready_for_child_requests");
    assert.equal(plan.hydration_flow.steps.at(-1).id, "execute_stock_plugin_controls");
    assert.deepEqual(plan.requests.map((request) => request.id), [
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
      "template.fx.set_fx_parameter_normalized",
    ]);
    assert.equal(plan.human_readback[0].phrase, "Limiter threshold at -3 dB.");
    assert.equal(plan.human_readback[1].phrase, "Limiter ceiling at -1 dB.");
  });

  it("returns typed blockers for unsupported plugins, fields, refs, and unsafe ranges", () => {
    const unsupported = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "serum",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: { threshold_db: -18 },
    });
    const badField = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "realimit",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: { magic_button: 1 },
    });
    const missingRef = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "readelay",
      controls: { feedback_percent: 50 },
      parameter_metadata: { feedback_percent: { param_index: 2 } },
    });
    const outOfRange = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reapitch",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: { shift_semitones: 99 },
      parameter_metadata: { shift_semitones: { param_index: 0 } },
    });

    assert.equal(unsupported.blockers.some((blocker) => blocker.code === "PLUGIN_NOT_SUPPORTED"), true);
    assert.equal(badField.blockers[0].code, "FIELD_NOT_SUPPORTED");
    assert.equal(missingRef.blockers.some((blocker) => blocker.code === "REQUIRED_REF_MISSING"), true);
    assert.equal(outOfRange.blockers[0].code, "CONTROL_VALUE_OUT_OF_RANGE");
    assert.equal(missingRef.blockers.some((blocker) => blocker.code === "PARAMETER_METADATA_NOT_FRESH"), true);
  });

  it("returns a typed blocker for unsupported starter actions", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "make_everything_magical",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.requests.length, 0);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "STARTER_ACTION_NOT_SUPPORTED"), true);
  });

  it("blocks starter action and explicit plugin mismatches", () => {
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      starter_action: "safe_peak_limit",
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.plugin.id, "realimit");
    assert.equal(plan.requests.length, 0);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "STARTER_ACTION_PLUGIN_MISMATCH"), true);
  });

  it("requires parameter metadata to be explicitly fresh before emitting child write plans", () => {
    const stale = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: { threshold_db: -18 },
      parameter_metadata: {
        threshold_db: { param_index: 0, param_ident: "threshold", freshness_status: "stale" },
      },
    });
    const missingFreshness = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: { threshold_db: -18 },
      parameter_metadata: {
        threshold_db: { param_index: 0, param_ident: "threshold" },
      },
    });

    assert.equal(stale.ok, false);
    assert.equal(stale.requests.length, 0);
    assert.equal(stale.blockers[0].code, "PARAMETER_METADATA_NOT_FRESH");
    assert.equal(missingFreshness.ok, false);
    assert.equal(missingFreshness.requests.length, 0);
    assert.equal(missingFreshness.blockers[0].code, "PARAMETER_METADATA_NOT_FRESH");
  });

  it("exposes stock plugin fluency through the existing runtime product surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates({ query: "stock plugin controls", limit: 10 });

    assert.deepEqual(
      runtime.list_templates().product_surface.stock_plugin_fluency,
      ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
    );
    assert.equal(menu.items.some((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID), true);
    const entry = menu.items.find((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(entry.action_kind, "macro");
    assert.equal(entry.current_status, "needs_ref");
    assert.equal(entry.beginner_label, "Select or resolve an object first");
    assert.equal(entry.capability_truth.kind, "official_macro");

    for (const pluginId of ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.plugin_ids) {
      const pluginMenu = runtime.list_templates({ query: pluginId, limit: 10 });
      assert.equal(pluginMenu.items.some((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID), true, pluginId);
    }
  });

  it("calls the E1 stock plugin macro through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T14:31:44.000Z"),
    });
    const response = await runtime.call_template({
      id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
      input: {
        plugin: "reacomp",
        controls: {
          threshold_db: -18,
          ratio: 4,
        },
        parameter_metadata: {
          threshold_db: { param_index: 0, param_ident: "threshold", freshness_status: "fresh" },
          ratio: { param_index: 1, param_ident: "ratio", freshness_status: "fresh" },
        },
      },
      refs: {
        fx_ref: "fx:track:guid:{TRACK}:1",
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.error, null);
    assert.equal(response.template.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(response.template.action_kind, "macro");
    assert.equal(response.request.macro.contract, ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT);
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.public_call_recipe, false);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.equal(response.result.plan.hydration_flow.status, "ready_for_child_requests");
    assert.deepEqual(
      response.result.child_requests.map((request) => request.id),
      [
        "template.fx.set_fx_parameter_normalized",
        "template.fx.set_fx_parameter_normalized",
      ],
    );
    assert.equal(response.result.readback[0].id, "template.fx.read_fx_parameter");
    assert.equal(runtime.last_evidence().template.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
  });

  it("calls starter actions through call_template and returns hydration guidance", async () => {
    const runtime = createCallTemplateRuntime();
    const response = await runtime.call_template({
      id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
      input: {
        starter_action: "gentle_vocal_compression",
      },
      refs: {
        fx_ref: "fx:track:guid:{TRACK}:1",
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "PARAMETER_METADATA_REQUIRED");
    assert.equal(response.result.plan.plugin.id, "reacomp");
    assert.equal(response.result.plan.starter_action.id, "gentle_vocal_compression");
    assert.equal(response.result.plan.hydration_flow.status, "needs_fresh_parameter_metadata");
    assert.deepEqual(response.result.plan.hydration_flow.steps.map((step) => step.id), [
      "verify_fx_identity",
      "hydrate_parameter_metadata",
    ]);
    assert.equal(response.result.child_requests.length, 0);
    assert.equal(response.result.readback.length, 0);
  });

  it("reports unsupported starter actions clearly through call_template", async () => {
    const runtime = createCallTemplateRuntime();
    const response = await runtime.call_template({
      id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
      input: {
        starter_action: "make_everything_magical",
      },
      refs: {
        fx_ref: "fx:track:guid:{TRACK}:1",
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "STARTER_ACTION_NOT_SUPPORTED");
    assert.equal(response.result.child_requests.length, 0);
    assert.equal(response.result.readback.length, 0);
  });

  it("returns typed macro blockers through call_template without child mutation requests", async () => {
    const runtime = createCallTemplateRuntime();
    const response = await runtime.call_template({
      id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
      input: {
        plugin: "reacomp",
        controls: {
          ratio: 400,
        },
      },
      refs: {
        fx_ref: "fx:track:guid:{TRACK}:1",
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.source, "macro");
    assert.equal(response.error.code, "CONTROL_VALUE_OUT_OF_RANGE");
    assert.equal(response.result.child_requests.length, 0);
    assert.equal(response.result.readback.length, 0);
    assert.equal(response.result.blockers[0].field, "ratio");
  });
});
