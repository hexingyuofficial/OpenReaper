import {
  ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
  planAlpha3D1StartupHealth,
  summarizeAlpha3D1StartupHealth,
} from "./alpha3-d1-startup-health-v1.mjs";

export const ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT = "alpha3.d1.startup_assistant.v1";
export const ALPHA3_D1_STARTUP_WRAPPER_CONTRACT = "alpha3.d1.startup_wrapper.v1";
export const ALPHA3_D1_MCP_STARTUP_REQUIREMENT =
  "OpenReaper MCP can connect only when REAPER is started through the OpenReaper startup helper or an equivalent session env launcher.";

export const ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
  mode: "local_session_card_plan",
  product_goal: "Prepare or reconnect a local OpenReaper session without exposing connection path lore.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    health_source: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
    local_helper: "npm run prepare:startup-session",
    local_launch_helper: "~/.openreaper/current/bin/openreaper-start",
  },
  statuses: ["ready", "prepare_session", "reconnect_existing", "blocked"],
  safety_policy: {
    opens_reaper: false,
    live_reaper_called: false,
    safe_write_called: false,
    raw_execution: false,
    hidden_executor: false,
    public_call_recipe: false,
  },
  output: [
    "session_card",
    "environment",
    "user_steps",
    "agent_next_steps",
    "verification_steps",
    "mcp_connection_requirement",
  ],
});

export const ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
  mode: "non_spawning_app_wrapper_plan",
  product_goal: "Prepare a user-owned startup package and future one-click evidence route without starting REAPER from the agent.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    assistant_source: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
    local_helper: "npm run prepare:startup-wrapper",
    local_launch_helper: "~/.openreaper/current/bin/openreaper-start",
    local_one_command_helper: "~/.openreaper/current/bin/openreaper-start",
  },
  wrapper_types: ["startup_package", "macos_launcher_candidate", "codex_session_card"],
  statuses: ["ready", "prepare_wrapper", "reconnect_existing", "blocked"],
  evidence_statuses: ["static_plan_ready", "needs_bounded_startup_window", "live_evidence_accepted"],
  safety_policy: {
    generated_only: true,
    opens_reaper_now: false,
    spawns_process_now: false,
    live_reaper_called: false,
    safe_write_called: false,
    raw_execution: false,
    hidden_executor: false,
    public_call_recipe: false,
  },
  output: [
    "wrapper_plan",
    "session_card",
    "user_readme",
    "evidence_appendix",
    "bounded_live_prompt",
    "acceptance_checks",
    "agent_user_reminder",
  ],
});

const DEFAULT_RUN_ID = "openreaper-alpha3-session";
const DEFAULT_RUN_ROOT = "/tmp/openreaper-alpha3-session";
const DEFAULT_OWNER = "openreaper-alpha3-local";
const DEFAULT_GENERATION = 1;
const DEFAULT_TIMEOUT_MS = 300_000;
const DEFAULT_BRIDGE_SCRIPT_PATH = "reaper/bridge/openreaper-live-bridge.lua";

export function planAlpha3D1StartupAssistant(input = {}) {
  const health = planAlpha3D1StartupHealth({
    runtime: input.runtime ?? input.live_gate ?? input.live,
    expected: input.expected ?? input.expected_session,
    observed: input.observed ?? input.current ?? input.session,
    requested: input.requested ?? input.task,
  });
  const sessionCard = createAlpha3D1StartupSessionCard(input.session ?? input.startup ?? input);
  const status = assistantStatusFromHealth(health);
  const actions = assistantActions(status, { health, sessionCard });

  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
    ok: status === "ready",
    mode: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY.mode,
    status,
    user_message: assistantUserMessage(status),
    mcp_connection_requirement: mcpConnectionRequirement(),
    next_step: actions[0]?.summary ?? "Prepare a fresh local OpenReaper session card.",
    health: summarizeAlpha3D1StartupHealth({
      runtime: input.runtime ?? input.live_gate ?? input.live,
      expected: input.expected ?? input.expected_session,
      observed: input.observed ?? input.current ?? input.session,
      requested: input.requested ?? input.task,
    }),
    session_card: sessionCard,
    user_steps: userSteps(status, sessionCard),
    agent_next_steps: agentNextSteps(status),
    verification_steps: verificationSteps(status),
    actions,
    safety: {
      plan_only: true,
      prepares_files_only: true,
      opens_reaper: false,
      live_reaper_called: false,
      safe_write_called: false,
      raw_execution: false,
      hidden_executor: false,
      public_call_recipe: false,
      spawned_reaper: false,
      requires_user_reaper_action: false,
      manual_recovery_action_only: true,
    },
  });
}

export function summarizeAlpha3D1StartupAssistant(input = {}, options = {}) {
  const plan = planAlpha3D1StartupAssistant(input);
  const sessionCardSummary = {
    run_id: plan.session_card.run_id,
    run_root: plan.session_card.paths.run_root,
    transport_dir: plan.session_card.paths.transport_dir,
    card_path: plan.session_card.paths.card_path,
    env_file_path: plan.session_card.paths.env_file_path,
  };
  if (options.include_openreaper_script_path !== false) {
    sessionCardSummary.openreaper_script_path = plan.session_card.paths.bridge_script_path;
  }
  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
    status: plan.status,
    ok: plan.ok,
    user_message: plan.user_message,
    mcp_connection_requirement: plan.mcp_connection_requirement,
    next_step: plan.next_step,
    helper: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY.tool_surface.local_helper,
    launch_helper: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY.tool_surface.local_launch_helper,
    session_card: sessionCardSummary,
    safety: plan.safety,
  });
}

export function planAlpha3D1StartupWrapper(input = {}) {
  const assistant = planAlpha3D1StartupAssistant(input);
  const sessionCard = assistant.session_card;
  const wrapperDir = normalizePath(input.wrapper_dir ?? input.wrapperDir, `${sessionCard.paths.run_root}/startup-wrapper`);
  const wrapperPlanPath = normalizePath(
    input.wrapper_plan_path ?? input.wrapperPlanPath,
    `${wrapperDir}/openreaper-startup-wrapper-plan.json`,
  );
  const readmePath = normalizePath(input.readme_path ?? input.readmePath, `${wrapperDir}/START_OPENREAPER.md`);
  const launcherName = safeToken(input.launcher_name ?? input.launcherName, "OpenReaper Start");
  const launcherCommandPath = normalizePath(
    input.launcher_command_path ?? input.launcherCommandPath,
    `${wrapperDir}/${launcherName}.command`,
  );
  const liveEvidenceRoot = normalizePath(
    input.live_evidence_root ?? input.liveEvidenceRoot,
    `${sessionCard.paths.run_root}/evidence/startup-wrapper`,
  );
  const status = wrapperStatusFromAssistant(assistant.status);
  const evidenceStatus = status === "blocked" ? "static_plan_ready" : "live_evidence_accepted";

  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
    ok: status !== "blocked",
    prepared: status !== "blocked",
    health_ready: assistant.ok,
    customer_ready: false,
    one_click_live_accepted: status !== "blocked",
    mode: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.mode,
    status,
    evidence_status: evidenceStatus,
    customer_claim: status === "blocked"
      ? "startup wrapper blocked; no one-click claim"
      : "local macOS one-command startup helper is live-accepted with startup-dialog caveat; broad platform/customer-ready remains blocked",
    user_message: wrapperUserMessage(status),
    agent_user_reminder: ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
    mcp_connection_requirement: mcpConnectionRequirement(),
    next_step: wrapperNextStep(status),
    assistant: summarizeAlpha3D1StartupAssistant(input),
    session_card: sessionCard,
    wrapper_plan: {
      wrapper_dir: wrapperDir,
      wrapper_plan_path: wrapperPlanPath,
      readme_path: readmePath,
      candidate_launcher_command_path: launcherCommandPath,
      launcher_name: launcherName,
      wrapper_type: "macos_user_owned_launcher_candidate",
      user_owned_execution: true,
      generated_by_agent: true,
      generated_files_only: true,
      launcher_written: false,
      launcher_status: status === "blocked" ? "blocked" : "local_macos_live_accepted",
      run_by_agent: "allowed_only_with_explicit_startup_window",
      launch_helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_launch_helper,
      one_command_helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_one_command_helper,
      one_command_evidence: {
        status: status === "blocked" ? "blocked" : "accepted_local_macos_with_dialog_caveat",
        requires_conditional_reaper_startup_hook: false,
        uses_trusted_package_command_line_reascript: true,
        user_may_need_to_dismiss_startup_dialog: true,
      },
      live_evidence_root: liveEvidenceRoot,
    },
    user_steps: wrapperUserSteps(status),
    agent_next_steps: wrapperAgentNextSteps(status),
    bounded_live_prompt: boundedStartupWrapperPrompt({ sessionCard, wrapperPlanPath, readmePath, liveEvidenceRoot }),
    acceptance_checks: wrapperAcceptanceChecks(),
    blockers: status === "blocked" ? assistant.health.blockers : [],
    safety: {
      plan_only: true,
      generated_files_only: true,
      opens_reaper_now: false,
      spawns_process_now: false,
      live_reaper_called: false,
      safe_write_called: false,
      raw_execution: false,
      hidden_executor: false,
      public_call_recipe: false,
      spawned_reaper: false,
      agent_can_launch_with_explicit_startup_window: true,
      one_click_live_accepted: status !== "blocked",
      support_claim_broadened: false,
      requires_bounded_startup_window: true,
    },
  });
}

export function summarizeAlpha3D1StartupWrapper(input = {}) {
  const plan = planAlpha3D1StartupWrapper(input);
  return deepFreeze({
    contract: ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
    status: plan.status,
    ok: plan.ok,
    prepared: plan.prepared,
    health_ready: plan.health_ready,
    customer_ready: plan.customer_ready,
    one_click_live_accepted: plan.one_click_live_accepted,
    evidence_status: plan.evidence_status,
    customer_claim: plan.customer_claim,
    user_message: plan.user_message,
    agent_user_reminder: plan.agent_user_reminder,
    mcp_connection_requirement: plan.mcp_connection_requirement,
    next_step: plan.next_step,
    helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_helper,
    launch_helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_launch_helper,
    one_command_helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_one_command_helper,
    wrapper_plan: plan.wrapper_plan,
    safety: plan.safety,
  });
}

export function createAlpha3D1StartupSessionCard(input = {}) {
  const runId = safeToken(input.run_id ?? input.runId ?? input.session_id, DEFAULT_RUN_ID);
  const runRoot = normalizePath(input.run_root ?? input.runRoot, DEFAULT_RUN_ROOT);
  const transportDir = normalizePath(input.transport_dir ?? input.transportDir, `${runRoot}/transport`);
  const artifactRoot = normalizePath(input.artifact_root ?? input.artifactRoot, `${runRoot}/artifacts`);
  const reportDir = normalizePath(input.report_dir ?? input.reportDir, `${runRoot}/reports`);
  const bridgeScriptPath = normalizePath(
    input.bridge_script_path ?? input.bridgeScriptPath,
    DEFAULT_BRIDGE_SCRIPT_PATH,
  );
  const owner = safeToken(input.owner, DEFAULT_OWNER);
  const generation = normalizePositiveInteger(input.generation, DEFAULT_GENERATION);
  const timeoutMs = normalizePositiveInteger(input.timeout_ms ?? input.timeoutMs, DEFAULT_TIMEOUT_MS);
  const sessionId = safeToken(input.session_id ?? input.sessionId, runId);
  const cardPath = normalizePath(input.card_path ?? input.cardPath, `${reportDir}/openreaper-session-card.json`);
  const envFilePath = normalizePath(input.env_file_path ?? input.envFilePath, `${reportDir}/openreaper-session.env`);

  const env = deepFreeze({
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR: transportDir,
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH: bridgeScriptPath,
    OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: String(timeoutMs),
    OPENREAPER_LIVE_BRIDGE_OWNER: owner,
    OPENREAPER_LIVE_BRIDGE_GENERATION: String(generation),
    OPENREAPER_LIVE_BRIDGE_SESSION_ID: sessionId,
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT: artifactRoot,
  });

  return deepFreeze({
    contract: "alpha3.d1.startup_session_card.v1",
    run_id: runId,
    owner,
    generation,
    session_id: sessionId,
    timeout_ms: timeoutMs,
    paths: {
      run_root: runRoot,
      transport_dir: transportDir,
      requests_dir: `${transportDir}/requests`,
      results_dir: `${transportDir}/results`,
      artifact_root: artifactRoot,
      report_dir: reportDir,
      bridge_script_path: bridgeScriptPath,
      card_path: cardPath,
      env_file_path: envFilePath,
    },
    env,
    shareable: false,
    scrub_before_share: true,
    notes: [
      "This card prepares a local OpenReaper session; it is not a recipe or public support claim.",
      ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
      "The agent may prepare these paths and may launch REAPER only inside an explicit bounded startup window.",
      "After reconnect, run startup health again before any live or safe-write call.",
    ],
  });
}

export function formatAlpha3D1StartupWrapperReadme(wrapperPlan) {
  const plan = isPlainObject(wrapperPlan) && wrapperPlan.contract === ALPHA3_D1_STARTUP_WRAPPER_CONTRACT
    ? wrapperPlan
    : planAlpha3D1StartupWrapper(wrapperPlan);
  return `${[
    "# Start OpenReaper",
    "",
    "This folder is a prepared startup package. The agent wrote local files only; it did not open REAPER, write a launcher, run live calls, or run safe-write.",
    "",
    "## MCP Startup Requirement",
    "",
    ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
    "",
    "## User Steps",
    ...plan.user_steps.map((step) => `- ${step}`),
    "",
    "## Agent Steps After You Reconnect",
    ...plan.agent_next_steps.map((step) => `- ${step}`),
    "",
    "## Agent Evidence Prompt",
    "",
    plan.bounded_live_prompt,
    "",
    "## Safety",
    "",
    `- opens_reaper_now: ${plan.safety.opens_reaper_now}`,
    `- spawns_process_now: ${plan.safety.spawns_process_now}`,
    `- live_reaper_called: ${plan.safety.live_reaper_called}`,
    `- safe_write_called: ${plan.safety.safe_write_called}`,
    `- customer_claim: ${plan.customer_claim}`,
    `- launcher_status: ${plan.wrapper_plan.launcher_status}`,
  ].join("\n")}\n`;
}

export function formatAlpha3D1StartupEnvFile(sessionCard) {
  const card = isPlainObject(sessionCard) ? sessionCard : createAlpha3D1StartupSessionCard();
  const env = isPlainObject(card.env) ? card.env : {};
  const lines = [
    "# OpenReaper Alpha3 local startup session.",
    "# Source this only for the terminal/session that will launch or prepare REAPER.",
  ];
  for (const [key, value] of Object.entries(env)) {
    lines.push(`export ${key}=${shellQuote(value)}`);
  }
  return `${lines.join("\n")}\n`;
}

function wrapperStatusFromAssistant(status) {
  if (status === "ready") return "ready";
  if (status === "blocked") return "blocked";
  if (status === "reconnect_existing") return "reconnect_existing";
  return "prepare_wrapper";
}

function wrapperUserMessage(status) {
  return ({
    ready: "OpenReaper already looks connected; keep the wrapper plan as recovery evidence.",
    prepare_wrapper: "I can prepare a one-click startup wrapper plan, but live startup evidence needs your bounded window.",
    reconnect_existing: "I can prepare a reconnect wrapper plan for the current OpenReaper session.",
    blocked: "Startup wrapper preparation is blocked by the connection safety check.",
  })[status] ?? "Startup wrapper needs review.";
}

function wrapperNextStep(status) {
  if (status === "ready") return "Keep startup health visible; use the wrapper plan only if the session drops.";
  if (status === "blocked") return "Report the startup blocker; do not prepare a launcher claim.";
  return "Generate the startup package; keep broad customer-ready wording blocked while local macOS one-command startup remains evidence-bound.";
}

function wrapperUserSteps(status) {
  if (status === "ready") {
    return deepFreeze([
      "No startup action is needed right now.",
      "Use the wrapper package only if this session needs reconnect later.",
    ]);
  }
  if (status === "blocked") {
    return deepFreeze([
      "Review the startup blocker before trying any app wrapper or live connection.",
    ]);
  }
  return deepFreeze([
    "Let the agent prepare the wrapper plan, session card, README, and OpenReaper startup helper command.",
    "Start REAPER through the OpenReaper helper; ordinary REAPER launches do not carry the MCP session env.",
    "After REAPER reports the bridge loop is running, tell the agent to rerun startup health.",
  ]);
}

function wrapperAgentNextSteps(status) {
  if (status === "ready") {
    return deepFreeze([
      "Do not rerun startup work unless health changes.",
      "Keep readback and startup health in the response.",
    ]);
  }
  if (status === "blocked") {
    return deepFreeze([
      "Do not create support wording for one-click startup.",
      "Report blockers and wait for the smallest needed user decision.",
    ]);
  }
  return deepFreeze([
    "Write the wrapper plan, session card, env file, and README only.",
    "Remind the user that MCP works only through the OpenReaper startup helper or equivalent session env launcher.",
    "Launch REAPER only when the user has opened an explicit bounded startup window.",
    "Use the bounded live prompt when the user authorizes startup evidence.",
  ]);
}

function boundedStartupWrapperPrompt({ sessionCard, wrapperPlanPath, readmePath, liveEvidenceRoot }) {
  return [
    "Open a bounded OpenReaper startup evidence window.",
    `Evidence root: ${liveEvidenceRoot}`,
    `Session card: ${sessionCard.paths.card_path}`,
    `Wrapper plan: ${wrapperPlanPath}`,
    `User README: ${readmePath}`,
    "Allowed actions: prepare the local startup package, let the user open/reconnect REAPER, run startup health, and capture readback evidence.",
    "Forbidden actions: safe-write, plugin/project mutation, raw Lua/action/shell bypass as product capability, support-matrix promotion, and broad platform claims.",
    "Acceptance: user can start/reconnect without reasoning about transport paths, owner, generation, session id, or bridge internals; startup health returns ready for the bounded scope.",
  ].join("\n");
}

function wrapperAcceptanceChecks() {
  return deepFreeze([
    "Wrapper materials are generated without starting REAPER or spawning a process.",
    "Agent-facing output includes the OpenReaper startup helper command and the MCP-only-through-helper reminder.",
    "User-facing instructions avoid transport-path and session-id lore until the evidence appendix.",
    "Startup health is rerun after reconnect before any live or safe-write call.",
    "Local macOS one-command startup evidence is accepted only with the startup-dialog caveat; broad customer-ready wording remains blocked.",
  ]);
}

function assistantStatusFromHealth(health) {
  if (health.status === "ready") return "ready";
  if (health.status === "stale_session") return "reconnect_existing";
  if (health.status === "needs_reconnect") return "reconnect_existing";
  if (health.status === "blocked") return "blocked";
  return "prepare_session";
}

function assistantUserMessage(status) {
  return ({
    ready: "OpenReaper already looks connected for the bounded task.",
    prepare_session: "I can prepare a fresh OpenReaper session card for you.",
    reconnect_existing: "OpenReaper needs a quick reconnect using a fresh session card.",
    blocked: "OpenReaper startup is blocked by a safety or scope issue.",
  })[status] ?? "OpenReaper startup needs review.";
}

function assistantActions(status, { health, sessionCard }) {
  if (status === "ready") {
    return [deepFreeze({
      id: "continue_after_health",
      summary: "Continue with bounded discovery and readback; keep startup health visible.",
      user_owned: false,
      agent_owned: true,
    })];
  }
  if (status === "blocked") {
    return [deepFreeze({
      id: "report_startup_blocker",
      summary: health.next_step,
      user_owned: true,
      agent_owned: false,
      blockers: health.blockers,
    })];
  }
  return [deepFreeze({
    id: "prepare_local_session_card",
    summary: "Prepare the local session folders and session card, then ask the user to open or reconnect REAPER.",
    user_owned: false,
    agent_owned: true,
    writes_files: [
      sessionCard.paths.card_path,
      sessionCard.paths.env_file_path,
    ],
  })];
}

function userSteps(status, sessionCard) {
  if (status === "ready") {
    return deepFreeze([
      "No startup action needed for this bounded task.",
    ]);
  }
  if (status === "blocked") {
    return deepFreeze([
      "Review the reported startup blocker before continuing.",
    ]);
  }
  return deepFreeze([
    "Open or restart REAPER through the OpenReaper startup helper so the MCP session env is present.",
    "Use the registered OpenReaper Bridge Action only if the startup helper reports it as the manual recovery fallback.",
    "Tell the agent you reconnected once the startup helper reports the Bridge ready.",
  ]);
}

function agentNextSteps(status) {
  if (status === "ready") {
    return deepFreeze([
      "Run only bounded allowed template calls.",
      "Keep readback and startup health in the response.",
    ]);
  }
  if (status === "blocked") {
    return deepFreeze([
      "Do not run live or safe-write calls.",
      "Report the blocker and ask for the smallest needed user decision.",
    ]);
  }
  return deepFreeze([
    "Create the requests/results/artifacts/reports folders.",
    "Write the session card and env file.",
    "Tell the user that normal REAPER launches cannot connect to the OpenReaper MCP session.",
    "After the user reconnects, rerun startup health before call_template live execution.",
  ]);
}

function verificationSteps(status) {
  if (status === "blocked") {
    return deepFreeze([
      "No live verification is allowed while startup is blocked.",
    ]);
  }
  return deepFreeze([
    "Check that requests and results directories exist.",
    "Check that the session card owner, generation, session id, and connection folder match the live executor config.",
    "Run startup health again before any live or safe-write call.",
  ]);
}

function mcpConnectionRequirement() {
  return deepFreeze({
    only_openreaper_launch_supported: true,
    ordinary_reaper_launch_supported: false,
    user_reminder: ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
    agent_launch_helper: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY.tool_surface.local_launch_helper,
    agent_one_command_helper: ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY.tool_surface.local_one_command_helper,
  });
}

function normalizePath(value, fallback) {
  const normalized = nonEmptyString(value);
  return normalized ?? fallback;
}

function safeToken(value, fallback) {
  const normalized = nonEmptyString(value);
  if (!normalized) return fallback;
  return normalized.replace(/[^\w./:@+-]/g, "_").slice(0, 160);
}

function normalizePositiveInteger(value, fallback) {
  if (Number.isInteger(value) && value > 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value.trim())) {
    const parsed = Number.parseInt(value.trim(), 10);
    if (Number.isInteger(parsed) && parsed > 0) return parsed;
  }
  return fallback;
}

function shellQuote(value) {
  const text = String(value ?? "");
  return `'${text.replaceAll("'", "'\\''")}'`;
}

function nonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed.slice(0, 2048);
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
