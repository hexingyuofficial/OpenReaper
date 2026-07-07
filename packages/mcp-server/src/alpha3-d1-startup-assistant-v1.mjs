import {
  ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
  planAlpha3D1StartupHealth,
  summarizeAlpha3D1StartupHealth,
} from "./alpha3-d1-startup-health-v1.mjs";

export const ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT = "alpha3.d1.startup_assistant.v1";

export const ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
  mode: "local_session_card_plan",
  product_goal: "Prepare or reconnect a local OpenReaper session without exposing connection path lore.",
  tool_surface: {
    added_tools: 0,
    discovery_tool: "list_templates",
    health_source: ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
    local_helper: "npm run prepare:startup-session",
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
      requires_user_reaper_action: status !== "ready",
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
    next_step: plan.next_step,
    helper: ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY.tool_surface.local_helper,
    session_card: sessionCardSummary,
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
      "The agent may prepare these paths, but the user still owns opening/restarting REAPER.",
      "After reconnect, run startup health again before any live or safe-write call.",
    ],
  });
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
    "Open or restart REAPER using this prepared local session.",
    "Run the bundled OpenReaper script in REAPER.",
    "Tell the agent you reconnected once REAPER says the OpenReaper loop started.",
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
