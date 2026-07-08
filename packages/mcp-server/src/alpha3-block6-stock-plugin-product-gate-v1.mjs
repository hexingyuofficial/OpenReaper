import {
  ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  listAlpha3E1StockPluginMaps,
  planAlpha3E1StockPluginMacro,
  summarizeAlpha3E1StockPluginLiveEvidenceMatrix,
} from "./alpha3-e1-stock-plugin-fluency-v1.mjs";

export const ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT = "alpha3.block6.stock_plugin_product_gate.v1";

export const ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT,
  mode: "static_stock_plugin_product_gate",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  source_contracts: {
    stock_plugin_fluency: ALPHA3_E1_STOCK_PLUGIN_FLUENCY_CONTRACT,
    live_evidence_matrix: ALPHA3_E1_STOCK_PLUGIN_LIVE_EVIDENCE_MATRIX_CONTRACT,
  },
  gates: [
    "all ten priority stock plugins have semantic maps and one starter action",
    "each starter action can produce child call_template requests after fresh parameter metadata",
    "missing metadata returns typed hydration guidance instead of writes",
    "customer readback blocks success wording until child requests and readback pass",
    "live support wording remains limited to accepted bounded plugin rows only",
  ],
  exclusions: [
    "no sixth MCP tool",
    "no public call_recipe",
    "no hidden executor",
    "no raw Lua/action/shell/UI bypass",
    "no alias execution expansion",
    "no broad stock-plugin live support claim",
    "no live REAPER or safe-write run from this static gate",
  ],
  summary_function: "summarizeAlpha3Block6StockPluginProductGate",
});

export function summarizeAlpha3Block6StockPluginProductGate(request = {}) {
  const registry = listAlpha3E1StockPluginMaps();
  const matrix = summarizeAlpha3E1StockPluginLiveEvidenceMatrix(request.live_evidence_matrix ?? {});
  const starterFlows = registry.starter_actions.map((starter, index) =>
    summarizeStarterActionFlow({ starter, index })
  );
  const blockerProbe = summarizeBlockerProbe();
  const coverage = summarizeCoverage({ registry, matrix, starterFlows, blockerProbe });
  const failures = hardGateFailures({ registry, matrix, starterFlows, blockerProbe, coverage });

  return deepFreeze({
    contract: ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_CONTRACT,
    mode: "static_stock_plugin_fluency_gate",
    ok: failures.length === 0,
    status: failures.length === 0 ? "static_ready_evidence_bound" : "needs_repair",
    tool_surface: ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY.tool_surface,
    source_contracts: ALPHA3_BLOCK6_STOCK_PLUGIN_PRODUCT_GATE_DISCOVERY_SUMMARY.source_contracts,
    coverage,
    starter_action_flows: starterFlows,
    blocker_probe: blockerProbe,
    live_evidence_matrix: {
      contract: matrix.contract,
      broad_live_support: matrix.broad_live_support,
      customer_ready: matrix.customer_ready,
      accepted_live_plugin_ids: matrix.accepted_live_plugin_ids,
      pending_live_plugin_ids: matrix.pending_live_plugin_ids,
      accepted_live_count: matrix.accepted_live_count,
      pending_live_count: matrix.pending_live_count,
      bounded_live_smoke_status: matrix.bounded_live_smoke_plan.status,
    },
    hard_gate: {
      accepted: failures.length === 0,
      failures,
      thresholds: {
        required_plugin_count: 10,
        required_starter_action_count: 10,
        required_ready_starter_flows: 10,
        allowed_broad_live_support: false,
        allowed_customer_ready_without_broad_evidence: false,
      },
    },
    execution: {
      live_reaper: false,
      safe_write: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui: false,
      alias_execution: false,
      direct_live_write_from_macro: false,
    },
    customer_flow: {
      status: failures.length === 0 ? "static_ready_no_broad_live_claim" : "needs_repair",
      promise: "A user can ask for stock plugin controls in musical language; the agent hydrates FX identity/parameters, emits existing call_template child requests, and waits for readback before success wording.",
      support_wording: "Only ReaComp has accepted bounded live fixture wording today; other stock plugins remain evidence-gated.",
      bounded_followup: "Open a bounded live REAPER/safe-write window to promote any pending plugin row.",
    },
    trial_officer: {
      verdict: failures.length === 0 ? "accept_block6_static_stock_plugin_gate" : "needs_block6_repair",
      p0_p1_findings: failures,
      notes: [
        "The static flow feels product-shaped because starter actions map musical asks to bounded controls.",
        "The agent has an explicit hydrate/resume path and does not ask the user to inspect parameter indexes.",
        "The gate keeps support claims evidence-bound instead of making all plugins customer-ready.",
      ],
    },
  });
}

function summarizeStarterActionFlow({ starter, index }) {
  const refs = { fx_ref: `fx:track:guid:{BLOCK6-${starter.plugin_id.toUpperCase()}}:${index + 1}` };
  const baseInput = {
    starter_action: starter.id,
    action_parameters: starter.id === "tempo_delay" ? { tempo_bpm: 120, division: "1/4" } : {},
  };
  const hydrationPlan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
    ...baseInput,
    refs,
  });
  const metadata = createFreshParameterMetadata(hydrationPlan.customer_readback?.requested_controls ?? []);
  const readyPlan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
    ...baseInput,
    refs,
    parameter_metadata: metadata,
  });

  return deepFreeze({
    id: starter.id,
    label: starter.label,
    plugin_id: starter.plugin_id,
    hydration_gate: {
      ok: hydrationPlan.ok === false,
      status: hydrationPlan.agent_execution_flow?.status ?? null,
      resolution_request_count: hydrationPlan.resolution_requests?.length ?? 0,
      child_request_count: hydrationPlan.requests?.length ?? 0,
      blocker_codes: (hydrationPlan.blockers ?? []).map((blocker) => blocker.code),
    },
    ready_gate: {
      ok: readyPlan.ok === true,
      status: readyPlan.agent_execution_flow?.status ?? null,
      child_request_count: readyPlan.requests?.length ?? 0,
      readback_request_count: readyPlan.readback?.length ?? 0,
      customer_readback_status: readyPlan.customer_readback?.status ?? null,
      success_wording_allowed: readyPlan.customer_readback?.success_wording_allowed ?? null,
      evidence_status: readyPlan.evidence_plan?.status ?? null,
      emitted_template_ids: (readyPlan.requests ?? []).map((request) => request.id),
      readback_template_ids: (readyPlan.readback ?? []).map((request) => request.id),
    },
  });
}

function summarizeBlockerProbe() {
  const unknownPlugin = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
    plugin: "not-a-stock-plugin",
    controls: { threshold_db: -18 },
    refs: { fx_ref: "fx:track:guid:{BLOCK6}:1" },
  });
  const outOfRange = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
    plugin: "reacomp",
    controls: { ratio: 99 },
    refs: { fx_ref: "fx:track:guid:{BLOCK6}:1" },
    parameter_metadata: {
      ratio: { param_index: 1, param_ident: "ratio", freshness_status: "fresh" },
    },
  });

  return deepFreeze({
    unknown_plugin: summarizeBlockedPlan(unknownPlugin),
    out_of_range_control: summarizeBlockedPlan(outOfRange),
    ok: unknownPlugin.ok === false &&
      outOfRange.ok === false &&
      unknownPlugin.requests.length === 0 &&
      outOfRange.requests.length === 0 &&
      unknownPlugin.blockers.some((blocker) => blocker.code === "PLUGIN_NOT_SUPPORTED") &&
      outOfRange.blockers.some((blocker) => blocker.code === "CONTROL_VALUE_OUT_OF_RANGE"),
  });
}

function summarizeCoverage({ registry, matrix, starterFlows, blockerProbe }) {
  const starterPlugins = new Set(registry.starter_actions.map((starter) => starter.plugin_id));
  const mapPlugins = new Set(registry.plugins.map((plugin) => plugin.id));
  const readyStarterCount = starterFlows.filter((flow) => flow.ready_gate.ok).length;
  const hydrationBlockerCount = starterFlows.filter((flow) =>
    flow.hydration_gate.ok &&
    flow.hydration_gate.status === "needs_hydration_then_resume" &&
    flow.hydration_gate.child_request_count === 0
  ).length;
  const allStarterPluginsCovered = [...mapPlugins].every((pluginId) => starterPlugins.has(pluginId));

  return deepFreeze({
    plugin_count: registry.plugin_count,
    starter_action_count: registry.starter_actions.length,
    semantic_map_status: registry.coverage.status,
    all_starter_plugins_covered: allStarterPluginsCovered,
    ready_starter_flow_count: readyStarterCount,
    hydration_blocker_flow_count: hydrationBlockerCount,
    accepted_live_plugin_ids: matrix.accepted_live_plugin_ids,
    pending_live_plugin_ids: matrix.pending_live_plugin_ids,
    broad_live_support: matrix.broad_live_support,
    customer_ready: matrix.customer_ready,
    typed_blocker_probe_ok: blockerProbe.ok,
  });
}

function hardGateFailures({ registry, matrix, starterFlows, blockerProbe, coverage }) {
  const failures = [];
  if (registry.plugin_count !== 10) failures.push("Expected exactly ten priority stock plugin maps.");
  if (registry.starter_actions.length !== 10) failures.push("Expected exactly ten stock plugin starter actions.");
  if (registry.coverage.status !== "covered_by_existing_templates") failures.push("Required E1 child templates are missing.");
  if (!coverage.all_starter_plugins_covered) failures.push("Every priority plugin must have one starter action.");
  for (const flow of starterFlows) {
    if (!flow.hydration_gate.ok || flow.hydration_gate.status !== "needs_hydration_then_resume") {
      failures.push(`${flow.id} did not return the expected hydrate/resume gate.`);
    }
    if (flow.hydration_gate.child_request_count !== 0) {
      failures.push(`${flow.id} emitted child requests before fresh parameter metadata.`);
    }
    if (!flow.ready_gate.ok || flow.ready_gate.status !== "ready_for_child_execution_and_readback") {
      failures.push(`${flow.id} did not become ready after fresh parameter metadata.`);
    }
    if (flow.ready_gate.child_request_count === 0 || flow.ready_gate.child_request_count !== flow.ready_gate.readback_request_count) {
      failures.push(`${flow.id} must emit matching child write/readback request counts.`);
    }
    if (flow.ready_gate.success_wording_allowed !== false) {
      failures.push(`${flow.id} allowed success wording before readback evidence.`);
    }
  }
  if (!blockerProbe.ok) failures.push("Typed blocker probe did not block unsupported plugin/out-of-range controls.");
  if (matrix.broad_live_support !== false) failures.push("Block6 must not claim broad stock-plugin live support.");
  if (matrix.customer_ready !== false) failures.push("Block6 must not claim customer-ready stock-plugin support without broad evidence.");
  if (matrix.accepted_live_count !== 1 || matrix.accepted_live_plugin_ids[0] !== "reacomp") {
    failures.push("Only the accepted ReaComp bounded fixture should be green in the default matrix.");
  }
  if (matrix.pending_live_count !== 9) failures.push("Nine stock plugin rows must remain pending bounded live evidence.");
  return failures;
}

function createFreshParameterMetadata(requestedControls) {
  return Object.fromEntries(requestedControls
    .filter((control) => control.supported)
    .map((control, index) => [
      control.control,
      {
        param_index: index,
        param_ident: control.control,
        label: control.label,
        freshness_status: "fresh",
        observed_at: "2026-07-08T00:00:00.000Z",
      },
    ]));
}

function summarizeBlockedPlan(plan) {
  return deepFreeze({
    ok: plan.ok,
    request_count: plan.requests.length,
    readback_request_count: plan.readback.length,
    blocker_codes: plan.blockers.map((blocker) => blocker.code),
    customer_readback_status: plan.customer_readback?.status ?? null,
  });
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) {
    deepFreeze(child);
  }
  return value;
}
