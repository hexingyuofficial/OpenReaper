import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_E1_STOCK_PLUGIN_AGENT_EXECUTION_FLOW_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_CUSTOMER_READBACK_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
  ALPHA3_E1_STOCK_PLUGIN_EVIDENCE_PLAN_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  createAlpha3E1OfficialMacroDiscoveryItems,
  getAlpha3E1StockPluginMap,
  listAlpha3E1StockPluginMaps,
  planAlpha3E1StockPluginMacro,
  summarizeAlpha3E1StockPluginLiveEvidenceMatrix,
} from "../../packages/mcp-server/src/alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { TOOL_ABI_V1_TOOL_NAMES } from "../../packages/mcp-server/src/tool-abi-v1.mjs";

describe("Alpha3 E1 stock plugin fluency", () => {
  it("registers semantic maps for the Phase 3 stock plugin set without adding tools", () => {
    const registry = listAlpha3E1StockPluginMaps();

    assert.equal(registry.contract, ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT);
    assert.equal(registry.mode, "semantic_map_registry");
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
    assert.equal(ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.broad_live_support, false);
    assert.equal(ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.live_support_status, "bounded_single_plugin_evidence_only");
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

  it("keeps the stock plugin live evidence matrix evidence-bound instead of promoting broad support", () => {
    const matrix = summarizeAlpha3E1StockPluginLiveEvidenceMatrix();

    assert.equal(matrix.contract, ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT);
    assert.equal(matrix.mode, "static_evidence_gate_for_bounded_live_smoke");
    assert.equal(matrix.generated_live_calls, false);
    assert.equal(matrix.live_reaper_called, false);
    assert.equal(matrix.safe_write_called, false);
    assert.equal(matrix.broad_live_support, false);
    assert.equal(matrix.customer_ready, false);
    assert.equal(matrix.plugin_count, 10);
    assert.equal(matrix.accepted_live_count, 1);
    assert.equal(matrix.pending_live_count, 9);
    assert.deepEqual(matrix.accepted_live_plugin_ids, ["reacomp"]);
    assert.equal(matrix.pending_live_plugin_ids.includes("reaeq"), true);
    assert.equal(matrix.pending_live_plugin_ids.includes("realimit"), true);

    const reacomp = matrix.plugins.find((plugin) => plugin.plugin_id === "reacomp");
    const reaeq = matrix.plugins.find((plugin) => plugin.plugin_id === "reaeq");

    assert.equal(reacomp.live_evidence_status, "bounded_fixture_accepted");
    assert.equal(reacomp.customer_claim_status, "limited_fixture_claim_only");
    assert.equal(reacomp.limited_claim_allowed.includes("bounded stock-plugin live write/readback"), true);
    assert.equal(reaeq.live_evidence_status, "needs_bounded_live_window");
    assert.equal(reaeq.customer_claim_status, "no_live_claim");
    assert.equal(reaeq.claim_not_allowed.includes("Do not claim live support"), true);
    assert.equal(matrix.claim_policy.not_allowed_yet.includes("All ten stock plugins are live-supported."), true);
    assert.equal(matrix.bounded_live_smoke_plan.status, "blocked_until_user_opens_bounded_live_window");
    assert.equal(matrix.bounded_live_smoke_plan.hard_stops.includes("registered Macro stage blocker or readback mismatch"), true);
    assert.equal(matrix.bounded_live_smoke_plan.recommended_batches[0].plugin_ids.includes("realimit"), true);
    assert.equal(matrix.bounded_live_smoke_plan.recommended_batches[1].plugin_ids.includes("reapitch"), true);
    assert.equal(matrix.safety.hidden_executor, false);
    assert.equal(matrix.safety.public_call_recipe, false);
    assert.equal(matrix.safety.raw_lua_action_shell_or_ui, false);
  });

  it("requires complete evidence citations before turning stock plugin rows green", () => {
    const matrix = summarizeAlpha3E1StockPluginLiveEvidenceMatrix({
      live_evidence_by_plugin: {
        reaeq: {
          evidence_ref: "alpha3.e1.6.reaeq.bounded_live",
          status: "bounded_fixture_accepted",
          scope: "single bounded ReaEQ write/readback fixture",
          claim_allowed: "ReaEQ passed one bounded live fixture.",
          claim_not_allowed: "Do not promote to broad stock-plugin support.",
        },
        realimit: {
          status: "bounded_fixture_accepted",
        },
      },
    });

    const reaeq = matrix.plugins.find((plugin) => plugin.plugin_id === "reaeq");
    const realimit = matrix.plugins.find((plugin) => plugin.plugin_id === "realimit");
    const recommendedIds = matrix.bounded_live_smoke_plan.recommended_batches
      .flatMap((batch) => batch.plugin_ids);

    assert.equal(reaeq.live_evidence_status, "bounded_fixture_accepted");
    assert.equal(realimit.live_evidence_status, "needs_bounded_live_window");
    assert.equal(recommendedIds.includes("reaeq"), false);
    assert.equal(recommendedIds.includes("realimit"), true);
    assert.equal(matrix.accepted_live_plugin_ids.includes("reaeq"), true);
    assert.equal(matrix.accepted_live_plugin_ids.includes("realimit"), false);
  });

  it("creates one official macro discovery entry over existing list_templates/call_template", () => {
    const [entry] = createAlpha3E1OfficialMacroDiscoveryItems();

    assert.equal(entry.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(entry.kind, "official_macro");
    assert.equal(entry.action_kind, "macro");
    assert.equal(entry.macro_kind, "stock_plugin_control");
    assert.equal(entry.menu_group, "act");
    assert.equal(entry.pack, "core");
    assert.equal(entry.execution_shape, "registered_macro_program");
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.support_status, "executable_runtime_bound");
    assert.equal(entry.live_runnable_now, false);
    assert.equal(entry.known_blocker, null);
    assert.equal(entry.inputSchema.required.includes("plugin"), false);
    assert.equal(entry.inputSchema.required.includes("controls"), false);
    assert.equal(Object.hasOwn(entry.inputSchema.properties, "starter_action"), true);
    assert.equal(entry.starter_action_ids.includes("gentle_vocal_compression"), true);
    assert.equal(entry.task_intents.includes("monster voice"), true);
    assert.equal(entry.refs.input[0].name, "fx_ref");
    assert.equal(entry.expectedDelta.summary, "Executes the registered semantic parameter program and verifies every touched normalized parameter value.");
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
    assert.deepEqual(plan.resolution_requests[0].budget, {
      max_response_bytes: 60000,
      max_items: 200,
      max_inline_value_bytes: 6000,
    });
    assert.deepEqual(plan.resolution_requests[1].budget, {
      max_response_bytes: 120000,
      max_items: 1000,
      max_inline_value_bytes: 12000,
    });
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
    assert.deepEqual(plan.hydration_flow.steps[1].budget, {
      max_response_bytes: 120000,
      max_items: 1000,
      max_inline_value_bytes: 12000,
    });
    assert.deepEqual(plan.hydration_flow.steps[1].wanted_controls, [
      "threshold_db",
      "ratio",
      "attack_ms",
      "release_ms",
      "wet_mix_percent",
    ]);
    assert.equal(plan.agent_execution_flow.contract, ALPHA3_E1_STOCK_PLUGIN_AGENT_EXECUTION_FLOW_CONTRACT);
    assert.equal(plan.agent_execution_flow.status, "needs_hydration_then_resume");
    assert.equal(plan.agent_execution_flow.agent_can_continue_after_task_authorization, true);
    assert.equal(plan.agent_execution_flow.safety.hidden_executor, false);
    assert.equal(plan.agent_execution_flow.safety.public_call_recipe, false);
    assert.equal(plan.agent_execution_flow.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(plan.agent_execution_flow.friction_reduction.expected_agent_round_trips, 2);
    assert.deepEqual(plan.agent_execution_flow.steps.map((step) => step.id), [
      "run_resolution_requests",
      "resume_macro_with_fresh_parameter_metadata",
      "continue_with_ready_flow",
    ]);
    assert.equal(plan.agent_execution_flow.steps[0].request_source, "result.plan.resolution_requests");
    assert.deepEqual(plan.agent_execution_flow.steps[0].requests[1].budget, {
      max_response_bytes: 120000,
      max_items: 1000,
      max_inline_value_bytes: 12000,
    });
    assert.equal(plan.agent_execution_flow.steps[0].identity_gate.expected_plugin_id, "reacomp");
    assert.equal(plan.agent_execution_flow.steps[0].identity_gate.must_match_before_metadata_fresh, true);
    assert.equal(plan.agent_execution_flow.steps[0].identity_gate.accepted_names.includes("ReaComp"), true);
    assert.equal(plan.agent_execution_flow.steps[1].template_id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(plan.agent_execution_flow.steps[1].input_policy.freshness_status, "fresh");
    assertNestedAgentRequestsUseOnlyAcceptedStockPluginTemplates(plan.agent_execution_flow);
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
    assert.deepEqual(plan.readback[0].budget, {
      max_response_bytes: 60000,
      max_items: 200,
      max_inline_value_bytes: 6000,
    });
    assert.equal(plan.evidence_plan.contract, ALPHA3_E1_STOCK_PLUGIN_EVIDENCE_PLAN_CONTRACT);
    assert.equal(plan.evidence_plan.status, "ready_for_execution_and_readback");
    assert.equal(plan.evidence_plan.success_wording_allowed, false);
    assert.equal(plan.evidence_plan.evidence_items.length, 2);
    assert.equal(plan.evidence_plan.evidence_items[0].control, "threshold_db");
    assert.equal(plan.evidence_plan.evidence_items[0].pending, true);
    assert.equal(plan.customer_readback.contract, ALPHA3_E1_STOCK_PLUGIN_CUSTOMER_READBACK_CONTRACT);
    assert.equal(plan.customer_readback.status, "ready_for_execution_and_readback");
    assert.equal(plan.customer_readback.success_wording_allowed, false);
    assert.equal(plan.customer_readback.lines[2].includes("read back every touched control"), true);
    assert.equal(plan.agent_execution_flow.contract, ALPHA3_E1_STOCK_PLUGIN_AGENT_EXECUTION_FLOW_CONTRACT);
    assert.equal(plan.agent_execution_flow.status, "ready_for_child_execution_and_readback");
    assert.equal(plan.agent_execution_flow.agent_can_continue_after_task_authorization, true);
    assert.equal(plan.agent_execution_flow.execution_authority, "agent_calls_existing_call_template_requests");
    assert.deepEqual(plan.agent_execution_flow.steps.map((step) => step.id), [
      "execute_child_requests",
      "run_readback_requests",
      "compare_readback_to_evidence_plan",
      "customer_readback_gate",
    ]);
    assert.equal(plan.agent_execution_flow.steps[0].request_source, "result.child_requests");
    assert.equal(plan.agent_execution_flow.steps[0].request_count, 2);
    assert.equal(plan.agent_execution_flow.steps[1].request_source, "result.readback");
    assert.equal(plan.agent_execution_flow.friction_reduction.expected_agent_round_trips, 1);
    assert.equal(plan.agent_execution_flow.safety.direct_live_write_from_macro, false);
    assert.equal(plan.agent_execution_flow.safety.success_wording_allowed, false);
    assertNestedAgentRequestsUseOnlyAcceptedStockPluginTemplates(plan.agent_execution_flow);
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
    assert.equal(plan.customer_readback.headline.includes("Safe peak limit"), true);
    assert.equal(plan.customer_readback.pending_readback_controls.length, 4);
    assert.equal(plan.customer_readback.do_not_say_until_readback.includes("Done"), true);
    assert.equal(plan.evidence_plan.required_after_execution.includes("all readback requests returned ok"), true);
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

  it("does not publish indexed evidence items when blockers suppress child requests", () => {
    const mixed = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
      plugin: "reacomp",
      refs: { fx_ref: "fx:track:guid:{TRACK}:1" },
      controls: {
        threshold_db: -18,
        ratio: 400,
      },
      parameter_metadata: {
        threshold_db: { param_index: 0, param_ident: "threshold", freshness_status: "fresh" },
        ratio: { param_index: 1, param_ident: "ratio", freshness_status: "fresh" },
      },
    });

    assert.equal(mixed.ok, false);
    assert.equal(mixed.requests.length, 0);
    assert.equal(mixed.readback.length, 0);
    assert.equal(mixed.blockers.some((blocker) => blocker.code === "CONTROL_VALUE_OUT_OF_RANGE"), true);
    assert.equal(mixed.evidence_plan.child_request_count, 0);
    assert.equal(mixed.evidence_plan.readback_request_count, 0);
    assert.deepEqual(mixed.evidence_plan.evidence_items, []);
    assert.equal(mixed.customer_readback.success_wording_allowed, false);
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
    assert.equal(stale.customer_readback.status, "needs_fresh_parameter_metadata");
    assert.equal(stale.customer_readback.lines[2].includes("fresh parameter_metadata"), true);
    assert.equal(stale.evidence_plan.status, "needs_fresh_parameter_metadata");
    assert.equal(stale.evidence_plan.success_wording_allowed, false);
    assert.equal(missingFreshness.ok, false);
    assert.equal(missingFreshness.requests.length, 0);
    assert.equal(missingFreshness.blockers[0].code, "PARAMETER_METADATA_NOT_FRESH");
  });

  it("exposes compact stock plugin fluency and exact-id live evidence", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates({ query: "stock plugin controls", limit: 10 });
    const expanded = runtime.list_templates({
      ids: [ALPHA3_E1_STOCK_PLUGIN_MACRO_ID],
      fields: ["id"],
    }).product_surface;

    assert.deepEqual(
      menu.product_surface.stock_plugin_fluency,
      ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY,
    );
    assert.equal(menu.product_surface.detail_level, "compact");
    assert.equal(Object.hasOwn(menu.product_surface, "stock_plugin_live_evidence"), false);
    assert.equal(expanded.detail_level, "expanded");
    assert.equal(expanded.expanded_via, "exact_ids");
    assert.equal(
      expanded.stock_plugin_live_evidence.contract,
      ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
    );
    assert.equal(expanded.stock_plugin_live_evidence.broad_live_support, false);
    assert.deepEqual(expanded.stock_plugin_live_evidence.accepted_live_plugin_ids, ["reacomp"]);
    assert.equal(menu.items.some((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID), true);
    const entry = menu.items.find((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(entry.action_kind, "macro");
    assert.equal(entry.current_status, "needs_live");
    assert.equal(entry.beginner_label, "Start or reconnect OpenReaper");
    assert.equal(entry.capability_truth.kind, "official_macro");

    for (const pluginId of ALPHA3_E1_STOCK_PLUGIN_DISCOVERY_SUMMARY.plugin_ids) {
      const pluginMenu = runtime.list_templates({ query: pluginId, limit: 10 });
      assert.equal(pluginMenu.items.some((item) => item.id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID), true, pluginId);
    }
  });

  it("keeps the executable stock-plugin Macro visible and returns a typed live blocker offline", async () => {
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

    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "STOCK_PLUGIN_LIVE_EXECUTOR_UNAVAILABLE");
    assert.equal(response.macro.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(response.execution.status, "blocked");
    assert.deepEqual(response.result.changes, []);
    assert.equal(response.recovery.sqlite_rows_authorize_writes, false);
    assert.equal(runtime.last_evidence().template.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
  });

  it("returns the same typed live blocker for a valid starter action offline", async () => {
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
    assert.equal(response.error.code, "STOCK_PLUGIN_LIVE_EXECUTOR_UNAVAILABLE");
    assert.equal(response.macro.id, ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
    assert.equal(response.execution.status, "blocked");
    assert.deepEqual(response.result.changes, []);
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
    assert.equal(response.blockers[0].code, "STARTER_ACTION_NOT_SUPPORTED");
    assert.deepEqual(response.result.changes, []);
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
    assert.equal(response.error.code, "CONTROL_VALUE_OUT_OF_RANGE");
    assert.equal(response.execution.status, "blocked");
    assert.deepEqual(response.result.changes, []);
    assert.equal(response.blockers[0].code, "CONTROL_VALUE_OUT_OF_RANGE");
  });
});

function assertNestedAgentRequestsUseOnlyAcceptedStockPluginTemplates(agentExecutionFlow) {
  const allowedIds = new Set([
    "template.fx.read_fx_summary",
    "template.fx.list_fx_parameters",
    "template.fx.read_fx_parameter",
    "template.fx.set_fx_parameter_normalized",
  ]);
  for (const step of agentExecutionFlow.steps) {
    for (const request of step.requests ?? []) {
      assert.equal(request.tool, "call_template", step.id);
      assert.equal(allowedIds.has(request.id), true, `${step.id}:${request.id}`);
    }
  }
}
