export const ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_CONTRACT = "alpha3.1.l4.macro_execution_convenience.v1";

export const ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_CONTRACT,
  mode: "registered_macro_execution_highway",
  product_goal: "Let agents call task-shaped registered Macros that execute fixed code-owned stages and return compact verification evidence.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    execution_tool: "call_template",
    state_tool: "get_state",
  },
  covered_macro_families: [
    "project_understanding_and_query",
    "project_file_layout_delete_media_routing_render",
    "generic_controls_and_stock_plugin_controls",
  ],
  registered_program_exclusions: [],
  execution_authority: "server_runs_fixed_registered_program",
  user_prompt_policy: "Authorize the bounded task once; the registered Macro stops at confirmation gates, typed blockers, or verification mismatch.",
  safety_policy: registeredMacroExecutionSafety(),
});

export function summarizeAlpha3L4MacroExecutionConvenience() {
  return deepFreeze({
    contract: ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_CONTRACT,
    mode: "registered_macro_product_surface_summary",
    status: "registered_macro_programs_active",
    agent_default_flow: [
      {
        id: "select_task_macro",
        source: "compact list_templates Macro menu",
        purpose: "Choose the narrowest executable Macro that covers the requested task.",
      },
      {
        id: "call_registered_program",
        source: "call_template",
        purpose: "Send task-shaped inputs or selectors; the server executes only registered dependencies and re-resolves live write refs.",
      },
      {
        id: "accept_verified_result",
        source: "macro.execution.v1",
        purpose: "Inspect compact stages, SQLite freshness, canonical refs, changes, verification, blockers, and recovery.",
      },
      {
        id: "fallback_only_for_gap",
        source: "list_templates",
        purpose: "Search atomic Templates only when no registered Macro covers the bounded task, and record the coverage gap.",
      },
    ],
    customer_copy: {
      ready: "I can run this bounded OpenReaper task through one registered Macro and verify what changed.",
      blocked: "I need to resolve the typed blocker before retrying the same Macro.",
      success_gate: "I will not report completion until the Macro's required readback matches.",
    },
    supported_sources: {
      project_understanding: "macro.project.inspect and macro.project.query hydrate or reuse SQLite and return compact project truth.",
      c5: "macro.controls.set executes bounded control stages and required readback internally.",
      e1: "macro.set_stock_plugin_controls hydrates live FX metadata, writes semantic controls, and verifies normalized values internally.",
    },
    safety: registeredMacroExecutionSafety(),
  });
}

export function createAlpha3L4MacroExecutionConvenienceFlow({
  macro_id = null,
  macro_family = "unknown_macro_family",
  risk_domain = null,
  ok = false,
  child_requests = [],
  readback = null,
  resolution_requests = [],
  blockers = [],
  evidence_plan = null,
} = {}) {
  const childRequests = normalizeRequestArray(child_requests);
  const readbackRequests = normalizeReadbackRequests(readback);
  const resolutionRequests = normalizeRequestArray(resolution_requests);
  const blockerList = Array.isArray(blockers) ? blockers : [];
  const status = macroExecutionStatus({
    ok,
    childRequests,
    readbackRequests,
    resolutionRequests,
    blockerList,
  });

  return deepFreeze({
    contract: ALPHA3_L4_MACRO_EXECUTION_CONVENIENCE_CONTRACT,
    mode: "agent_runs_existing_call_template_requests",
    macro_id,
    macro_family,
    status,
    risk_domain,
    execution_authority: "agent_calls_existing_call_template_requests",
    agent_can_continue_after_task_authorization: status === "ready_for_child_execution_and_readback"
      || status === "needs_resolution_then_resume",
    task_authorization: {
      required: status === "ready_for_child_execution_and_readback" && risk_domain !== "read",
      allowed_risk_domain: risk_domain,
      prompt_policy: "ask_once_per_task_and_risk_domain_then_execute_until_boundary",
      hard_stops: macroExecutionHardStops(),
    },
    request_counts: {
      resolution: resolutionRequests.length,
      child: childRequests.length,
      readback: readbackRequests.length,
      blocker: blockerList.length,
    },
    steps: macroExecutionSteps({
      status,
      resolutionRequests,
      childRequests,
      readbackRequests,
      blockerList,
      evidencePlan: evidence_plan,
    }),
    success_gate: {
      success_wording_allowed_now: false,
      success_wording_allowed_after: successWordingGate(status, readbackRequests.length),
      mismatch_policy: "Return a typed blocker and recovery step; never report success on mismatched readback.",
    },
    friction_reduction: {
      expected_agent_round_trips: expectedAgentRoundTrips(status),
      old_loop: "inspect macro plan, ask repeatedly, run each low-level call manually, then remember readback",
      new_loop: "ask once for scoped authorization, run returned child requests, run returned readback, compare evidence",
    },
    safety: macroExecutionConvenienceSafety(),
    blockers: blockerList,
  });
}

function macroExecutionStatus({ ok, childRequests, readbackRequests, resolutionRequests, blockerList }) {
  if (childRequests.length > 0 && ok) return "ready_for_child_execution_and_readback";
  const resolutionOnly = blockerList.length > 0
    && resolutionRequests.length > 0
    && childRequests.length === 0
    && readbackRequests.length === 0;
  if (resolutionOnly) return "needs_resolution_then_resume";
  if (!ok || blockerList.length > 0) return "blocked_before_agent_execution";
  return "no_child_requests";
}

function macroExecutionSteps({
  status,
  resolutionRequests,
  childRequests,
  readbackRequests,
  blockerList,
  evidencePlan,
}) {
  if (status === "ready_for_child_execution_and_readback") {
    return deepFreeze([
      {
        id: "execute_child_requests",
        request_source: "result.child_requests",
        execution: "serial",
        request_count: childRequests.length,
        requests: childRequests,
        stop_on_first_blocker: true,
      },
      {
        id: "run_readback_requests",
        request_source: "result.readback",
        execution: "serial",
        request_count: readbackRequests.length,
        requests: readbackRequests,
        stop_on_first_blocker: true,
      },
      {
        id: "compare_readback_to_requested_changes",
        required_after_execution: evidencePlan?.required_after_execution ?? [
          "all child requests returned ok",
          "all readback requests returned ok",
          "readback matches requested changes",
        ],
        mismatch_policy: evidencePlan?.mismatch_policy ?? "Report a typed blocker and do not claim success.",
      },
    ]);
  }

  if (status === "needs_resolution_then_resume") {
    return deepFreeze([
      {
        id: "run_resolution_requests",
        request_source: "result.resolution_requests",
        execution: "serial",
        request_count: resolutionRequests.length,
        requests: resolutionRequests,
        stop_on_first_blocker: true,
      },
      {
        id: "resume_macro",
        tool: "call_template",
        input_policy: "Preserve the original macro request and add the fresh readback/metadata requested by the macro.",
        expected_result: "A ready_for_child_execution_and_readback flow or typed blocker.",
      },
    ]);
  }

  if (status === "blocked_before_agent_execution") {
    return deepFreeze([
      {
        id: "resolve_typed_blockers",
        blockers: blockerList,
        purpose: "Do not run child requests or report success until these blockers are resolved.",
      },
    ]);
  }

  return deepFreeze([
    {
      id: "no_child_requests",
      purpose: "No macro child execution is needed; use the returned summary or blockers.",
    },
  ]);
}

function successWordingGate(status, readbackRequestCount) {
  if (status === "ready_for_child_execution_and_readback" && readbackRequestCount > 0) {
    return "All child requests and planned readback requests returned ok and matched the requested changes.";
  }
  if (status === "needs_resolution_then_resume") {
    return "Resolution succeeded, the macro was resumed, child requests ran, and readback matched.";
  }
  return "No success wording until the macro returns a ready flow and readback evidence exists.";
}

function expectedAgentRoundTrips(status) {
  if (status === "ready_for_child_execution_and_readback") return 1;
  if (status === "needs_resolution_then_resume") return 2;
  return 0;
}

function normalizeReadbackRequests(readback) {
  if (Array.isArray(readback)) return normalizeRequestArray(readback);
  if (readback && typeof readback === "object") return normalizeRequestArray([readback]);
  return [];
}

function normalizeRequestArray(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((request) => request && request.tool === "call_template");
}

function macroExecutionHardStops() {
  return [
    "destructive_or_irreversible_request",
    "render_or_export",
    "hardware_or_privacy_boundary",
    "typed_child_request_blocker",
    "readback_mismatch",
    "stale_or_unresolved_ref_identity",
  ];
}

function macroExecutionConvenienceSafety() {
  return deepFreeze({
    added_tools: 0,
    plan_only_macro: true,
    server_executes_children: false,
    hidden_executor: false,
    public_call_recipe: false,
    raw_lua_action_shell_or_ui: false,
    alias_execution: false,
    live_reaper_called: false,
    safe_write_called: false,
    success_wording_requires_readback: true,
  });
}

function registeredMacroExecutionSafety() {
  return deepFreeze({
    added_tools: 0,
    fixed_registered_programs: true,
    model_supplied_execution_graph: false,
    hidden_executor: false,
    public_call_recipe: false,
    raw_lua_action_shell_or_ui: false,
    live_write_refs_reresolved: true,
    success_wording_requires_readback: true,
  });
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
