export const ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT = "alpha3.1.l3.project_index_user_flow.v1";

export const ALPHA3_L3_PROJECT_INDEX_USER_FLOW_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_L3_PROJECT_INDEX_USER_FLOW_CONTRACT,
  mode: "project_index_user_flow_gate",
  product_goal: "Make Project SQLite Index query macros feel like a user flow: check status, refresh if needed, query compact rows, hydrate only when needed.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    execution_tool: "call_template",
    state_tool: "get_state",
  },
  primary_macro_ids: ["macro.index_status", "macro.query_tracks"],
  user_path: [
    "Call macro.index_status before relying on index rows.",
    "If refresh_requests are returned, run those existing call_template requests and update the Project Index from readback.",
    "Rerun the intended query macro, such as macro.query_tracks.",
    "Use compact rows for scan decisions; hydrate or re-resolve refs before writes.",
  ],
  safety_policy: {
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
    primary_macro_ids: ["macro.index_status", "macro.query_tracks"],
    default_agent_flow: [
      {
        id: "check_index_status",
        tool: "call_template",
        template_id: "macro.index_status",
        purpose: "Tell the user whether the Project Index is ready, missing, stale, or blocked.",
      },
      {
        id: "refresh_from_readback",
        tool: "call_template",
        template_id: "returned_refresh_requests",
        purpose: "Run only the returned accepted read requests, then update the Project Index from readback.",
      },
      {
        id: "query_tracks",
        tool: "call_template",
        template_id: "macro.query_tracks",
        purpose: "Return compact track rows and canonical refs without dumping the whole project.",
      },
      {
        id: "hydrate_or_re_resolve",
        tool: "call_template",
        template_id: "macro.hydrate_refs",
        purpose: "Fetch deeper detail only when needed; re-resolve in REAPER before any write.",
      },
    ],
    user_copy: {
      missing_index: "I need to refresh the OpenReaper project index before using cached rows.",
      ready_rows: "I found compact project-index rows; I will hydrate exact refs only if we need deeper detail or a write target.",
      stale_or_blocked: "The project index is stale or blocked, so I will reconnect or resolve blockers before using rows.",
    },
    safety: {
      added_tools: 0,
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
  const primaryNextAction = nextActions[0]?.kind ?? (
    refreshRequests.length > 0
      ? "run_refresh_requests"
      : blockers.length > 0
        ? "resolve_blockers"
        : "no_followup_required"
  );

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
    refresh_request_count: refreshRequests.length,
    blocker_codes: blockerCodes,
    safe_to_use_rows: plan.ok === true && blockers.length === 0,
    safe_to_write_from_rows: false,
    must_hydrate_or_re_resolve_before_write: refs.length > 0,
    hydrate_available: hydrateRequest?.callable_now === true,
    copyable_agent_summary: projectIndexFlowCopyableSummary(stage, { rows, refs, refreshRequests, blockerCodes }),
    safety: {
      added_tools: 0,
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
  if (blockers.length > 0 && refreshRequests.length === 0) return "blocked";
  if (refreshRequests.length > 0) return blockers.length > 0 ? "needs_refresh_after_blockers" : "needs_refresh";
  if (ok && rows.length > 0) return "ready_compact_rows";
  if (ok && rows.length === 0) return "ready_no_rows";
  if (blockers.length > 0) return "blocked";
  return "complete";
}

function projectIndexFlowUserMessage(stage, { rows, refs, refreshRequests, blockerCodes }) {
  if (stage === "needs_refresh") {
    return `Project Index needs a read-only refresh first; run ${refreshRequests.length} returned call_template request(s), update the index from readback, then rerun the macro.`;
  }
  if (stage === "needs_refresh_after_blockers") {
    return `Project Index refresh is partially available, but blocker(s) ${blockerCodes.join(", ")} must be resolved first.`;
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
    return "Project Index is ready, but this query returned no rows; adjust filters or try another query macro.";
  }
  return "Project Index flow is complete; use compact rows first and hydrate only when needed.";
}

function projectIndexFlowAgentNextStep(stage, { primaryNextAction }) {
  if (stage === "needs_refresh") {
    return "Run the returned refresh_requests with call_template, update the Project Index from readback, then rerun the same macro.";
  }
  if (stage === "needs_refresh_after_blockers" || stage === "blocked") {
    return "Resolve typed blockers before using Project Index rows or child requests.";
  }
  if (stage === "stale_session_reconnect") {
    return "Reconnect to the current OpenReaper session, refresh index status, then rerun the query.";
  }
  if (stage === "ready_compact_rows") {
    return primaryNextAction === "page_next"
      ? "Page if needed; otherwise use compact rows for selection and hydrate/re-resolve before any write."
      : "Use compact rows for scan decisions; hydrate/re-resolve before any write.";
  }
  if (stage === "ready_no_rows") {
    return "Try different filters, query selected context, or refresh a narrower scope if the user expected matches.";
  }
  return "No additional Project Index action is required.";
}

function projectIndexFlowCopyableSummary(stage, details) {
  if (stage === "needs_refresh") {
    return "I need to refresh OpenReaper's project index first, using the returned read-only call_template requests.";
  }
  if (stage === "ready_compact_rows") {
    return `I found ${details.rows.length} compact project-index row(s); I will hydrate exact refs only if the task needs detail or a write target.`;
  }
  if (stage === "stale_session_reconnect") {
    return "The project index is from an old session, so I need to reconnect before using cached rows.";
  }
  if (stage === "blocked" || stage === "needs_refresh_after_blockers") {
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
