import {
  ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
  ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY,
  ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
  ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY,
  createAlpha3D1StartupSessionCard,
  formatAlpha3D1StartupEnvFile,
  formatAlpha3D1StartupWrapperReadme,
  planAlpha3D1StartupAssistant,
  planAlpha3D1StartupWrapper,
  summarizeAlpha3D1StartupAssistant,
  summarizeAlpha3D1StartupWrapper,
} from "./alpha3-d1-startup-assistant-v1.mjs";
import {
  ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
  ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY,
  planAlpha3D1StartupHealth,
  summarizeAlpha3D1StartupHealth,
} from "./alpha3-d1-startup-health-v1.mjs";

export const ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT = "alpha3.block2.startup_readiness.v1";

export const ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT,
  mode: "static_startup_connection_gate",
  product_goal: "Make start, reconnect, stale-session guard, and one-click evidence boundaries visible without requiring connection internals.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    health_source: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
    assistant_source: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
    wrapper_source: ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
  },
  gates: [
    "ready connection can proceed only inside bounded allowed live scope",
    "missing startup gives one beginner-readable action without spawning REAPER",
    "stale session stops before live/safe-write calls",
    "startup assistant prepares session card/env guidance without live calls",
    "wrapper route remains candidate-only until bounded startup evidence passes",
  ],
  summary_function: "summarizeAlpha3Block2StartupReadiness",
  gate_function: "runAlpha3Block2StartupReadinessGate",
});

export function summarizeAlpha3Block2StartupReadiness(input = {}) {
  const health = summarizeAlpha3D1StartupHealth(input.health ?? {});
  const assistant = summarizeAlpha3D1StartupAssistant(input.assistant ?? {}, {
    include_openreaper_script_path: false,
  });
  const wrapper = summarizeAlpha3D1StartupWrapper(input.wrapper ?? {});

  return deepFreeze({
    contract: ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT,
    mode: "static_product_surface_summary",
    status: "ready_for_startup_gate",
    health,
    assistant,
    wrapper,
    truth_boundary: {
      one_click_live_accepted: false,
      customer_ready_startup_claim: false,
      bounded_startup_window_required: true,
    },
    safety: safetySummary([health.safety, assistant.safety, wrapper.safety]),
    next_gate: "Run runAlpha3Block2StartupReadinessGate; open a bounded startup window only for true one-click/live evidence.",
  });
}

export function runAlpha3Block2StartupReadinessGate(input = {}) {
  const ready = planAlpha3D1StartupHealth(readyScenario(input.ready));
  const missingStartup = planAlpha3D1StartupHealth(missingStartupScenario(input.missing_startup));
  const stale = planAlpha3D1StartupHealth(staleScenario(input.stale_session));
  const scopeBlocked = planAlpha3D1StartupHealth(scopeBlockedScenario(input.scope_blocked));
  const assistant = planAlpha3D1StartupAssistant(assistantScenario(input.assistant));
  const wrapper = planAlpha3D1StartupWrapper(wrapperScenario(input.wrapper));
  const sessionCard = createAlpha3D1StartupSessionCard(sessionCardScenario(input.session_card));
  const envFile = formatAlpha3D1StartupEnvFile(sessionCard);
  const wrapperReadme = formatAlpha3D1StartupWrapperReadme(wrapper);

  const failures = hardGateFailures({
    ready,
    missingStartup,
    stale,
    scopeBlocked,
    assistant,
    wrapper,
    sessionCard,
    envFile,
    wrapperReadme,
  });

  return deepFreeze({
    contract: ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT,
    mode: "static_startup_connection_gate",
    ok: failures.length === 0,
    tool_surface: ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY.tool_surface,
    source_contracts: {
      startup_health: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
      startup_assistant: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
      startup_wrapper: ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
    },
    scenarios: {
      ready: summarizeHealthPlan(ready),
      missing_startup: summarizeHealthPlan(missingStartup),
      stale_session: summarizeHealthPlan(stale),
      scope_blocked: summarizeHealthPlan(scopeBlocked),
    },
    assistant: {
      contract: assistant.contract,
      ok: assistant.ok,
      status: assistant.status,
      session_card_contract: assistant.session_card.contract,
      actions: assistant.actions.map((action) => action.id),
      writes_files: assistant.actions.flatMap((action) => action.writes_files ?? []),
      user_steps: assistant.user_steps,
      agent_next_steps: assistant.agent_next_steps,
      safety: assistant.safety,
    },
    wrapper: {
      contract: wrapper.contract,
      prepared: wrapper.prepared,
      customer_ready: wrapper.customer_ready,
      one_click_live_accepted: wrapper.one_click_live_accepted,
      evidence_status: wrapper.evidence_status,
      bounded_live_prompt: wrapper.bounded_live_prompt,
      acceptance_checks: wrapper.acceptance_checks,
      safety: wrapper.safety,
    },
    session_card: {
      contract: sessionCard.contract,
      run_id: sessionCard.run_id,
      owner: sessionCard.owner,
      generation: sessionCard.generation,
      shareable: sessionCard.shareable,
      scrub_before_share: sessionCard.scrub_before_share,
      env_keys: Object.keys(sessionCard.env),
      env_file_preview_contains_transport: envFile.includes("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR"),
      wrapper_readme_blocks_spawning: wrapperReadme.includes("spawns_process_now: false"),
    },
    hard_gate: {
      accepted: failures.length === 0,
      failures,
    },
    execution: {
      live_reaper: false,
      safe_write: false,
      spawned_reaper: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui: false,
      one_click_live_claim: false,
    },
    customer_flow: {
      status: failures.length === 0 ? "static_ready_needs_bounded_startup_window" : "needs_repair",
      promise: "The agent can tell the user whether to continue, start, reconnect, or stop for stale-session safety without exposing connection internals first.",
      bounded_followup: "True one-click/app-wrapper startup evidence still needs a user-opened bounded startup window.",
    },
    trial_officer: {
      verdict: failures.length === 0 ? "accept_block2_static_startup_gate" : "needs_block2_repair",
      p0_p1_findings: failures,
    },
  });
}

function readyScenario(input = {}) {
  return mergeScenario({
    runtime: {
      opted_in: true,
      executor_configured: true,
      spawned_reaper: false,
      allowed_template_ids: ["template.project.read_summary"],
    },
    expected: {
      session_id: "block2-session",
      owner: "openreaper-alpha3-local",
      generation: 2,
    },
    observed: {
      session_id: "block2-session",
      owner: "openreaper-alpha3-local",
      generation: 2,
    },
    requested: {
      task_id: "startup-readiness",
      requires_live: true,
      allowed_template_ids: ["template.project.read_summary"],
    },
  }, input);
}

function missingStartupScenario(input = {}) {
  return mergeScenario({}, input);
}

function staleScenario(input = {}) {
  return mergeScenario({
    runtime: {
      opted_in: true,
      executor_configured: true,
      spawned_reaper: false,
      allowed_template_ids: ["template.project.read_summary"],
    },
    expected: {
      session_id: "old-session",
      owner: "old-owner",
      generation: 1,
    },
    observed: {
      session_id: "current-session",
      owner: "current-owner",
      generation: 2,
    },
    requested: {
      task_id: "stale-write-probe",
      requires_live: true,
      requires_safe_write: true,
      allowed_template_ids: ["template.project.read_summary"],
    },
  }, input);
}

function scopeBlockedScenario(input = {}) {
  return mergeScenario({
    runtime: {
      opted_in: true,
      executor_configured: true,
      spawned_reaper: false,
      allowed_template_ids: ["template.project.read_summary"],
    },
    expected: {
      session_id: "block2-session",
      owner: "openreaper-alpha3-local",
      generation: 2,
    },
    observed: {
      session_id: "block2-session",
      owner: "openreaper-alpha3-local",
      generation: 2,
    },
    requested: {
      task_id: "out-of-scope-live",
      requires_live: true,
      allowed_template_ids: ["template.transport.play"],
    },
  }, input);
}

function assistantScenario(input = {}) {
  return mergeScenario({
    session: sessionCardScenario({}),
  }, input);
}

function wrapperScenario(input = {}) {
  return mergeScenario({
    session: sessionCardScenario({}),
  }, input);
}

function sessionCardScenario(input = {}) {
  return {
    run_id: input.run_id ?? "openreaper-alpha3-block2-startup",
    run_root: input.run_root ?? "/tmp/openreaper-alpha3-block2-startup",
    owner: input.owner ?? "openreaper-alpha3-local",
    generation: input.generation ?? 7,
    session_id: input.session_id ?? "openreaper-alpha3-block2-startup",
    bridge_script_path: input.bridge_script_path ?? "reaper/bridge/openreaper-live-bridge.lua",
  };
}

function summarizeHealthPlan(plan) {
  return deepFreeze({
    contract: plan.contract,
    ok: plan.ok,
    status: plan.status,
    user_message: plan.user_message,
    next_step: plan.next_step,
    blockers: plan.blockers.map((blocker) => blocker.code),
    warnings: plan.warnings.map((warning) => warning.code),
    recovery_actions: plan.recovery_actions.map((action) => action.id),
    safety: plan.safety,
  });
}

function hardGateFailures({ ready, missingStartup, stale, scopeBlocked, assistant, wrapper, sessionCard, envFile, wrapperReadme }) {
  const failures = [];
  if (ready.status !== "ready" || !ready.ok) failures.push(failure("READY_CONNECTION_NOT_READY", "Ready scenario did not pass startup health."));
  if (missingStartup.status !== "needs_startup") failures.push(failure("MISSING_STARTUP_NOT_ACTIONABLE", "Missing startup scenario did not produce a startup action."));
  if (!missingStartup.recovery_actions.some((action) => action.id === "ask_user_to_open" && action.no_spawn_reaper === true)) failures.push(failure("MISSING_STARTUP_SPAWN_GUARD_FAILED", "Missing startup must ask the user to open/reconnect without spawning REAPER."));
  if (stale.status !== "stale_session") failures.push(failure("STALE_SESSION_NOT_BLOCKED", "Stale session did not hard-stop before live/safe-write."));
  if (stale.safety.safe_write_called !== false || stale.safety.stale_session_guard !== true) failures.push(failure("STALE_SESSION_SAFETY_FAILED", "Stale session guard safety flags are wrong."));
  if (scopeBlocked.status !== "blocked" || !scopeBlocked.blockers.some((blocker) => blocker.code === "LIVE_SCOPE_UNKNOWN")) failures.push(failure("LIVE_SCOPE_BLOCKER_MISSING", "Out-of-scope live template did not return LIVE_SCOPE_UNKNOWN."));
  if (assistant.status !== "prepare_session") failures.push(failure("ASSISTANT_DID_NOT_PREPARE_SESSION", "Startup assistant should prepare a session when no connection is present."));
  if (assistant.safety.opens_reaper !== false || assistant.safety.live_reaper_called !== false) failures.push(failure("ASSISTANT_SIDE_EFFECT_FAILED", "Startup assistant must not open REAPER or call live."));
  if (!assistant.actions.some((action) => action.id === "prepare_local_session_card")) failures.push(failure("ASSISTANT_SESSION_CARD_ACTION_MISSING", "Startup assistant did not expose the local session-card action."));
  if (wrapper.prepared !== true || wrapper.customer_ready !== false) failures.push(failure("WRAPPER_EVIDENCE_BOUNDARY_FAILED", "Startup wrapper must be prepared but not customer-ready until bounded evidence passes."));
  if (wrapper.one_click_live_accepted !== false || wrapper.evidence_status !== "needs_bounded_startup_window") failures.push(failure("ONE_CLICK_EVIDENCE_BOUNDARY_FAILED", "One-click startup must remain evidence-gated."));
  if (wrapper.safety.opens_reaper_now !== false || wrapper.safety.spawns_process_now !== false) failures.push(failure("WRAPPER_SPAWN_GUARD_FAILED", "Wrapper route must not open REAPER or spawn processes now."));
  if (sessionCard.shareable !== false || sessionCard.scrub_before_share !== true) failures.push(failure("SESSION_CARD_SHARE_BOUNDARY_FAILED", "Session cards must not be shareable without scrub."));
  if (!envFile.includes("OPENREAPER_LIVE_BRIDGE_SESSION_ID")) failures.push(failure("ENV_FILE_SESSION_ID_MISSING", "Startup env file must preserve session identity."));
  if (!wrapperReadme.includes("it did not open REAPER")) failures.push(failure("WRAPPER_README_SUPPORT_BOUNDARY_MISSING", "Wrapper README must state that the agent did not open REAPER."));
  return deepFreeze(failures);
}

function safetySummary(entries) {
  return deepFreeze({
    added_tools: 0,
    opens_reaper: entries.some((entry) => entry?.opens_reaper === true || entry?.opens_reaper_now === true),
    spawns_process_now: entries.some((entry) => entry?.spawns_process_now === true),
    live_reaper_called: entries.some((entry) => entry?.live_reaper_called === true),
    safe_write_called: entries.some((entry) => entry?.safe_write_called === true),
    hidden_executor: entries.some((entry) => entry?.hidden_executor === true),
    public_call_recipe: entries.some((entry) => entry?.public_call_recipe === true),
    raw_execution: entries.some((entry) => entry?.raw_execution === true),
  });
}

function mergeScenario(base, input) {
  if (!isPlainObject(input)) return base;
  return deepFreeze({
    ...base,
    ...input,
    runtime: { ...(base.runtime ?? {}), ...(input.runtime ?? {}) },
    expected: { ...(base.expected ?? {}), ...(input.expected ?? {}) },
    observed: { ...(base.observed ?? {}), ...(input.observed ?? {}) },
    requested: { ...(base.requested ?? {}), ...(input.requested ?? {}) },
    session: { ...(base.session ?? {}), ...(input.session ?? {}) },
  });
}

function failure(code, message) {
  return deepFreeze({
    code,
    severity: "P1",
    message,
  });
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
