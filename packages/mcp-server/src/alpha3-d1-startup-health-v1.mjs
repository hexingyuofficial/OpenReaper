export const ALPHA3_D1_STARTUP_HEALTH_CONTRACT = "alpha3.d1.startup_health.v1";

export const ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
  mode: "agent_side_plan_only",
  product_goal: "Start or reconnect without exposing connection internals.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  checks: [
    "runtime_surface_visible",
    "live_opt_in",
    "executor_configured",
    "session_identity_match",
    "owner_generation_match",
    "allowed_live_scope",
  ],
  statuses: ["ready", "needs_startup", "needs_reconnect", "stale_session", "blocked"],
  stale_session_guard: {
    rule: "If expected and observed session/owner/generation disagree, stop before call_template live execution and give a reconnect step.",
    write_policy: "Never run safe-write or live calls on stale or unknown session identity.",
  },
  recovery_policy: "Return one beginner-readable next step before mentioning low-level connection fields.",
});

const DEFAULT_ALLOWED_TEMPLATE_IDS = Object.freeze([]);

export function planAlpha3D1StartupHealth(input = {}) {
  const runtime = normalizeRuntime(input.runtime ?? input.live_gate ?? input.live);
  const expected = normalizeIdentity(input.expected ?? input.expected_session);
  const observed = normalizeIdentity(input.observed ?? input.current ?? input.session);
  const requested = normalizeRequested(input.requested ?? input.task);
  const checks = buildChecks({ runtime, expected, observed, requested });
  const blockers = checks.filter((check) => check.status === "fail");
  const warnings = checks.filter((check) => check.status === "warn");
  const status = startupStatus({ runtime, expected, observed, requested, blockers });
  const nextStep = nextStepForStatus(status, { runtime, expected, observed, requested, blockers, warnings });

  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
    ok: status === "ready",
    mode: "agent_side_plan_only",
    status,
    user_message: userMessageForStatus(status),
    next_step: nextStep,
    tool_surface: ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY.tool_surface,
    requested,
    identity: {
      expected,
      observed,
      match: identityMatch(expected, observed),
    },
    checks,
    blockers: blockers.map(checkToBlocker),
    warnings: warnings.map(checkToWarning),
    recovery_actions: recoveryActions(status, { runtime, expected, observed, requested, blockers, warnings }),
    safety: {
      plan_only: true,
      spawned_reaper: false,
      live_reaper_called: false,
      safe_write_called: false,
      raw_execution: false,
      hidden_executor: false,
      public_call_recipe: false,
      stale_session_guard: status !== "ready",
    },
  });
}

export function summarizeAlpha3D1StartupHealth(input = {}) {
  const plan = planAlpha3D1StartupHealth(input);
  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
    status: plan.status,
    ok: plan.ok,
    user_message: plan.user_message,
    next_step: plan.next_step,
    blockers: plan.blockers.map((blocker) => blocker.code),
    warnings: plan.warnings.map((warning) => warning.code),
    safety: plan.safety,
  });
}

function buildChecks({ runtime, expected, observed, requested }) {
  return [
    check(
      "runtime_surface_visible",
      "pass",
      "OpenReaper product surface is available.",
      "Use list_templates product_surface before live calls.",
    ),
    check(
      "live_opt_in",
      runtime.opted_in ? "pass" : "fail",
      runtime.opted_in
        ? "Live connection access is explicitly opted in."
        : "Live connection access is not opted in for this session.",
      "Ask the user to start or reconnect OpenReaper; stay read-only until a bounded live window exists.",
    ),
    check(
      "executor_configured",
      runtime.executor_configured ? "pass" : "fail",
      runtime.executor_configured
        ? "A non-spawning live connection is configured."
        : "No live connection executor is configured.",
      "Ask the user to open REAPER/OpenReaper or paste the session line; do not try to spawn REAPER.",
    ),
    identityCheck("session_identity_match", "session_id", expected, observed),
    identityCheck("owner_match", "owner", expected, observed),
    identityCheck("generation_match", "generation", expected, observed),
    check(
      "allowed_live_scope",
      requested.requires_live && runtime.allowed_template_ids.length === 0 ? "warn" : "pass",
      requested.requires_live && runtime.allowed_template_ids.length === 0
        ? "No live template allowlist is visible yet."
        : "Live scope is bounded by the current allowlist.",
      "Use discovery and startup health before live execution; do not broaden support claims.",
      {
        allowed_template_count: runtime.allowed_template_ids.length,
      },
    ),
  ];
}

function identityCheck(id, field, expected, observed) {
  const expectedValue = expected[field];
  const observedValue = observed[field];
  if (expectedValue === null && observedValue === null) {
    return check(
      id,
      "warn",
      `${field} is not known yet.`,
      "Ask for a reconnect/session line before safe-write or live execution.",
    );
  }
  if (expectedValue === null || observedValue === null) {
    return check(
      id,
      "warn",
      `${field} is only partially known.`,
      "Refresh connection health or ask the user to paste the current session line.",
      { expected: expectedValue, observed: observedValue },
    );
  }
  return check(
    id,
    sameValue(expectedValue, observedValue) ? "pass" : "fail",
    sameValue(expectedValue, observedValue)
      ? `${field} matches the expected session.`
      : `${field} does not match the expected session.`,
    "Stop before live execution and reconnect to the current REAPER session.",
    { expected: expectedValue, observed: observedValue },
  );
}

function startupStatus({ runtime, expected, observed, requested, blockers }) {
  if (blockers.some((blocker) => ["session_identity_match", "owner_match", "generation_match"].includes(blocker.id))) {
    return "stale_session";
  }
  if (!runtime.opted_in && !runtime.executor_configured) return "needs_startup";
  if (!runtime.opted_in || !runtime.executor_configured) return "needs_reconnect";
  if (requested.requires_live && runtime.allowed_template_ids.length === 0) return "blocked";
  if (!identityMatch(expected, observed).known) return "needs_reconnect";
  return blockers.length === 0 ? "ready" : "blocked";
}

function nextStepForStatus(status, context) {
  if (status === "ready") return "Continue with discovery, then run only bounded allowed live/template calls.";
  if (status === "needs_startup") return "Ask the user to open REAPER/OpenReaper, then run this health check again.";
  if (status === "needs_reconnect") return "Refresh the connection or ask the user for the current OpenReaper session line.";
  if (status === "stale_session") return "Stop before live calls and reconnect to the current REAPER session.";
  return recoveryActions(status, context)[0]?.user_action ?? "Stop and report the connection blocker.";
}

function userMessageForStatus(status) {
  return ({
    ready: "OpenReaper connection looks ready for the bounded task.",
    needs_startup: "OpenReaper is not connected yet.",
    needs_reconnect: "OpenReaper needs a quick reconnect before live work.",
    stale_session: "This looks like an old or mismatched OpenReaper session.",
    blocked: "OpenReaper cannot safely run this live task yet.",
  })[status] ?? "OpenReaper connection needs review.";
}

function recoveryActions(status, { runtime, expected, observed, requested, blockers }) {
  const common = {
    no_raw_execution: true,
    no_spawn_reaper: true,
    retry_after: "rerun_startup_health",
  };
  if (status === "ready") {
    return [deepFreeze({
      id: "continue_bounded",
      user_action: "Proceed inside the current bounded live scope.",
      agent_action: "Use list_templates/call_template only; keep evidence and readback.",
      ...common,
    })];
  }
  if (status === "needs_startup") {
    return [deepFreeze({
      id: "ask_user_to_open",
      user_action: "Open REAPER/OpenReaper, then share the session line if the agent cannot see it.",
      agent_action: "Stay read-only and do not start REAPER automatically.",
      ...common,
    })];
  }
  if (status === "stale_session") {
    return [deepFreeze({
      id: "reconnect_current_session",
      user_action: "Reconnect to the current REAPER session before doing anything live.",
      agent_action: "Discard stale session assumptions and rerun health before call_template.",
      mismatches: blockers.map((blocker) => blocker.id),
      expected,
      observed,
      ...common,
    })];
  }
  if (status === "needs_reconnect") {
    return [deepFreeze({
      id: "refresh_connection",
      user_action: "Refresh OpenReaper connection health or paste the current session line.",
      agent_action: "Do not run safe-write/live calls until identity is known.",
      runtime,
      ...common,
    })];
  }
  return [deepFreeze({
    id: "report_blocker",
    user_action: requested.requires_live
      ? "Open a bounded live window with a visible allowlist for this task."
      : "Review the connection blocker before continuing.",
    agent_action: "Report blockers concisely and do not broaden support claims.",
    blockers: blockers.map((blocker) => blocker.id),
    ...common,
  })];
}

function check(id, status, message, recovery, details = {}) {
  return deepFreeze({
    id,
    status,
    message,
    recovery,
    details,
  });
}

function checkToBlocker(entry) {
  return deepFreeze({
    id: entry.id,
    code: checkCode(entry.id),
    message: entry.message,
    recoverable: true,
    recovery: entry.recovery,
    details: entry.details,
  });
}

function checkToWarning(entry) {
  return deepFreeze({
    id: entry.id,
    code: checkCode(entry.id),
    message: entry.message,
    recovery: entry.recovery,
    details: entry.details,
  });
}

function checkCode(id) {
  return ({
    live_opt_in: "LIVE_OPT_IN_MISSING",
    executor_configured: "LIVE_EXECUTOR_MISSING",
    session_identity_match: "SESSION_IDENTITY_MISMATCH",
    owner_match: "BRIDGE_OWNER_MISMATCH",
    generation_match: "BRIDGE_GENERATION_MISMATCH",
    allowed_live_scope: "LIVE_SCOPE_UNKNOWN",
  })[id] ?? "STARTUP_HEALTH_CHECK";
}

function normalizeRuntime(value) {
  const source = isPlainObject(value) ? value : {};
  return deepFreeze({
    opted_in: source.opted_in === true,
    executor_configured: source.executor_configured === true,
    spawned_reaper: source.spawned_reaper === true,
    allowed_template_ids: normalizeStringArray(source.allowed_template_ids ?? DEFAULT_ALLOWED_TEMPLATE_IDS),
    opt_in_env: nonEmptyString(source.opt_in_env),
    opt_in_flag: nonEmptyString(source.opt_in_flag),
  });
}

function normalizeIdentity(value) {
  const source = isPlainObject(value) ? value : {};
  return deepFreeze({
    session_id: nonEmptyString(source.session_id ?? source.id),
    owner: nonEmptyString(source.owner ?? source.expected_owner),
    generation: normalizeGeneration(source.generation ?? source.expected_generation),
    transport_dir: nonEmptyString(source.transport_dir),
  });
}

function normalizeRequested(value) {
  const source = isPlainObject(value) ? value : {};
  return deepFreeze({
    task_id: nonEmptyString(source.task_id ?? source.id),
    requires_live: source.requires_live === true,
    requires_safe_write: source.requires_safe_write === true,
    allowed_template_ids: normalizeStringArray(source.allowed_template_ids),
  });
}

function identityMatch(expected, observed) {
  const fields = ["session_id", "owner", "generation"];
  const knownFields = fields.filter((field) => expected[field] !== null && observed[field] !== null);
  const mismatches = knownFields.filter((field) => !sameValue(expected[field], observed[field]));
  return deepFreeze({
    known: knownFields.length === fields.length,
    matched: knownFields.length === fields.length && mismatches.length === 0,
    known_fields: knownFields,
    mismatches,
  });
}

function normalizeGeneration(value) {
  if (Number.isInteger(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isInteger(parsed)) return parsed;
  }
  return null;
}

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, 240);
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry) => typeof entry === "string" && entry.trim() !== "")
    .map((entry) => entry.trim())
    .slice(0, 250);
}

function sameValue(left, right) {
  return String(left) === String(right);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) {
      deepFreeze(nested);
    }
  }
  return value;
}
