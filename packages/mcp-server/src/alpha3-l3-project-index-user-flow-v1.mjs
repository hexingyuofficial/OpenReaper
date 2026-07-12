export const ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT = "alpha3.1.l3.project_index_user_flow.v1";

export const ALPHA3_L3_PROJECT_INDEX_USER_FLOW_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT,
  mode: "project_index_user_flow_gate",
  product_goal: "Teach one public macro.project.query flow: execute the registered Macro program, let it perform bounded read-only hydration when required, then use its final compact candidate rows or typed blockers.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    execution_tool: "call_template",
    state_tool: "get_state",
  },
  primary_macro_ids: ["macro.project.query"],
  user_path: [
    "Call macro.project.query with exactly one supported entity and bounded fields/filters/selectors.",
    "The registered Macro program internally performs only allowlisted bounded read-only refresh/hydration when current Project Index state requires it.",
    "Use the completed Macro response for final compact rows, freshness evidence, or typed blockers; do not replay internal refresh work.",
    "Use compact rows as candidate facts; hydrate where available or resolve through the target write template before mutation.",
  ],
  safety_policy: {
    registered_macro_program: true,
    bounded_read_only_hydration: "internal_when_required",
    agent_replays_internal_refresh: false,
    sqlite_is_truth: false,
    rows_authorize_writes: false,
    live_reaper_called: false,
    hidden_executor: false,
    public_call_recipe: false,
    raw_sql: false,
  },
  summary_function: "summarizeAlpha3L3ProjectIndexUserFlow",
});

export function summarizeAlpha3L3ProjectIndexUserFlow() {
  return deepFreeze({
    contract: ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT,
    mode: "static_product_surface_summary",
    status: "ready_for_project_index_flow_gate",
    primary_macro_ids: ["macro.project.query"],
    default_agent_flow: [
      {
        id: "execute_registered_query_program",
        tool: "call_template",
        template_id: "macro.project.query",
        purpose: "Choose one of the twelve entities and execute the fixed registered Macro program.",
      },
      {
        id: "consume_completed_query_result",
        tool: "call_template",
        template_id: "macro.project.query",
        purpose: "Consume final compact rows, freshness evidence, and typed blockers from the completed Macro response.",
      },
      {
        id: "hydrate_or_target_resolve",
        tool: "call_template",
        template_id: "target_specific_read_or_write_template",
        purpose: "Hydrate where supported; markers/regions and all writes require target-template live resolution rather than fabricated atomic hydration.",
      },
    ],
    user_copy: {
      missing_index: "I will call macro.project.query; it performs any bounded read-only Project Index hydration it needs before returning final rows or blockers.",
      ready_rows: "I found compact project-index rows; I will hydrate exact refs only if we need deeper detail or a write target.",
      stale_or_blocked: "The project index is stale or blocked, so I will reconnect or resolve blockers before using rows.",
    },
    safety: {
      added_tools: 0,
      registered_macro_program: true,
      bounded_read_only_hydration: "internal_when_required",
      agent_replays_internal_refresh: false,
      live_reaper_called: false,
      safe_write_called: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_sql_exposed: false,
      sqlite_rows_are_candidates_only: true,
      sqlite_authorizes_writes: false,
    },
  });
}

export function createAlpha3L3ProjectIndexUserFlow(plan = {}) {
  const blockers = Array.isArray(plan.blockers) ? plan.blockers : [];
  const blockerCodes = unique(blockers.map((entry) => entry?.code).filter(Boolean));
  const refreshRequests = Array.isArray(plan.refresh_requests) ? plan.refresh_requests : [];
  const rows = Array.isArray(plan.rows) ? plan.rows : [];
  const refs = Array.isArray(plan.refs) ? plan.refs : [];
  const nextActions = Array.isArray(plan.next_actions) ? plan.next_actions : [];
  const hydrateRequest = isPlainObject(plan.hydrate_request) ? plan.hydrate_request : null;
  const stage = projectIndexFlowStage({
    ok: plan.ok === true,
    blockers,
    refreshRequests,
    rows,
  });
  const primaryNextAction = refreshRequests.length > 0
    ? "await_macro_completion"
    : blockers.length > 0
      ? "resolve_blockers"
      : nextActions[0]?.kind ?? "no_followup_required";

  return deepFreeze({
    contract: ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT,
    mode: "runtime_project_index_user_flow",
    macro_id: typeof plan.id === "string" ? plan.id : null,
    stage,
    ok: plan.ok === true,
    user_message: projectIndexFlowUserMessage(stage, { rows, refs, refreshRequests, blockerCodes }),
    primary_next_action: primaryNextAction,
    agent_next_step: projectIndexFlowAgentNextStep(stage, { primaryNextAction }),
    row_count: rows.length,
    ref_count: refs.length,
    internal_read_only_refresh_required: refreshRequests.length > 0,
    blocker_codes: blockerCodes,
    safe_to_use_rows: plan.ok === true && blockers.length === 0,
    safe_to_write_from_rows: false,
    must_hydrate_or_re_resolve_before_write: refs.length > 0,
    hydrate_available: hydrateRequest?.callable_now === true,
    copyable_agent_summary: projectIndexFlowCopyableSummary(stage, { rows, refs, refreshRequests, blockerCodes }),
    safety: {
      added_tools: 0,
      registered_macro_program: true,
      bounded_read_only_hydration: "internal_when_required",
      agent_replays_internal_refresh: false,
      live_reaper_called: false,
      safe_write_called: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_sql_exposed: false,
      sqlite_rows_are_candidates_only: true,
      sqlite_authorizes_writes: false,
    },
  });
}

function projectIndexFlowStage({ ok, blockers, refreshRequests, rows }) {
  const blockerCodes = new Set(blockers.map((entry) => entry?.code).filter(Boolean));
  if (blockerCodes.has("INDEX_STALE_SESSION")) return "stale_session_reconnect";
  if (refreshRequests.length > 0) return "internal_read_only_refresh";
  if (blockers.length > 0) return "blocked";
  if (ok && rows.length > 0) return "ready_compact_rows";
  if (ok && rows.length === 0) return "ready_no_rows";
  if (blockers.length > 0) return "blocked";
  return "complete";
}

function projectIndexFlowUserMessage(stage, { rows, refs, refreshRequests, blockerCodes }) {
  if (stage === "internal_read_only_refresh") {
    return "macro.project.query will perform its bounded allowlisted read-only hydration internally, then return final rows or typed blockers.";
  }
  if (stage === "stale_session_reconnect") {
    return "Project Index belongs to an old session; reconnect through OpenReaper before using cached rows.";
  }
  if (stage === "blocked") {
    return `Project Index query is blocked by ${blockerCodes.join(", ") || "reported blockers"}; do not use cached rows yet.`;
  }
  if (stage === "ready_compact_rows") {
    return `Project Index returned ${rows.length} compact row(s) and ${refs.length} canonical ref(s); hydrate only if deeper detail is needed.`;
  }
  if (stage === "ready_no_rows") {
    return "Project Index is ready, but this entity query returned no rows; adjust macro.project.query filters/selectors or choose another entity.";
  }
  return "Project Index flow is complete; use compact rows first and hydrate only when needed.";
}

function projectIndexFlowAgentNextStep(stage, { primaryNextAction }) {
  if (stage === "internal_read_only_refresh") {
    return "Await the completed macro.project.query response; use its final rows or typed blockers and do not execute internal refresh work.";
  }
  if (stage === "blocked") {
    return "Resolve typed blockers before using Project Index rows.";
  }
  if (stage === "stale_session_reconnect") {
    return "Reconnect to the current OpenReaper session before using Project Index rows.";
  }
  if (stage === "ready_compact_rows") {
    return primaryNextAction === "page_next"
      ? "Page if needed; otherwise use compact rows for selection and hydrate/re-resolve before any write."
      : "Use compact rows for scan decisions; hydrate/re-resolve before any write.";
  }
  if (stage === "ready_no_rows") {
    return "Try different macro.project.query filters/selectors, entity selected_context, or a policy-permitted narrower refresh if matches were expected.";
  }
  return "No additional Project Index action is required.";
}

function projectIndexFlowCopyableSummary(stage, details) {
  if (stage === "internal_read_only_refresh") {
    return "macro.project.query performs bounded read-only hydration internally and returns the final compact rows or typed blockers.";
  }
  if (stage === "ready_compact_rows") {
    return `I found ${details.rows.length} compact project-index row(s); I will hydrate exact refs only if the task needs detail or a write target.`;
  }
  if (stage === "stale_session_reconnect") {
    return "The project index is from an old session, so I need to reconnect before using cached rows.";
  }
  if (stage === "blocked") {
    return `I cannot use project-index rows until these blockers are resolved: ${details.blockerCodes.join(", ") || "reported blockers"}.`;
  }
  return "The Project Index query flow is ready.";
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
