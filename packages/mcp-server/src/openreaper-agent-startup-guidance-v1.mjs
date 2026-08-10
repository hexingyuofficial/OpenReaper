import {
  OPENREAPER_AGENT_FIRST_ROUND_FLOW,
  OPENREAPER_AGENT_START_HERE_DOCUMENT,
} from "./openreaper-agent-start-here-v1.mjs";

export const OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT = "openreaper.alpha3_1.agent_startup_guidance.v1";

export const OPENREAPER_DEFAULT_INSTALL_ROOT = "~/.openreaper/current";
export const OPENREAPER_INSTALLED_START_COMMAND =
  `${OPENREAPER_DEFAULT_INSTALL_ROOT}/bin/openreaper-start`;
export const OPENREAPER_INSTALLED_PROJECT_START_COMMAND =
  `${OPENREAPER_INSTALLED_START_COMMAND} --project-path /path/to/project.RPP`;
export const OPENREAPER_BRIDGE_ACTION_NAME = "OpenReaper: Start MCP bridge";

export const OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY = deepFreeze({
  contract: OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT,
  mode: "agent_startup_guidance",
  product_goal: "Tell a zero-premise agent how to start or reconnect a REAPER session that OpenReaper MCP can use.",
  agent_start_here: OPENREAPER_AGENT_START_HERE_DOCUMENT,
  first_round_flow: OPENREAPER_AGENT_FIRST_ROUND_FLOW,
  exposed_through: ["ping", "list_templates.product_surface", "mcp.instructions"],
  tool_surface: {
    added_tools: 0,
    mcp_server_name: "openreaper",
  },
  installed_commands: {
    start_reaper_for_mcp: OPENREAPER_INSTALLED_START_COMMAND,
    start_project_for_mcp: OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
  },
  caveats: {
    normal_reaper_launch_supported: false,
    only_openreaper_startup_supported: true,
    startup_lifetime_action: "openreaper-start launches REAPER with the OpenReaper bridge environment and returns only after a matching heartbeat and bounded public read probe pass.",
    startup_dialog_assist: "macOS and Windows: OpenReaper observes REAPER startup windows read-only and never clicks or closes them. A blocking window returns STARTUP_USER_ACTION_REQUIRED while preserving the REAPER PID and Bridge generation.",
    bridge_start_action: `openreaper-start passes the project and extra arguments to REAPER; the installed conditional Scripts/__startup.lua hook starts the Bridge only for an OpenReaper launch. The REAPER action "${OPENREAPER_BRIDGE_ACTION_NAME}" is a manual recovery fallback.`,
    connection_verification: "openreaper-start performs call_template(template.transport.read_state) before reporting startup-status=ready.",
  },
  startup_lifetime: {
    enabled_by: "openreaper-start",
    starts_reaper_with_openreaper_env: true,
    waits_for_reaper_process: true,
    waits_for_matching_bridge_heartbeat: true,
    verifies_public_read_before_ready: true,
    pid_file: "~/.openreaper/current/session/reaper.pid",
    log_dir: "~/.openreaper/current/session/logs",
    configurable_wait_env: "OPENREAPER_START_WAIT_SECONDS",
  },
  bridge_action: {
    installed_action_name: OPENREAPER_BRIDGE_ACTION_NAME,
    agent_should_try_to_run_action: false,
    role: "manual_recovery_fallback",
    user_fallback: `Only if autonomous startup reports a Bridge blocker: in REAPER, open Actions, search "${OPENREAPER_BRIDGE_ACTION_NAME}", click Run, then rerun Doctor.`,
    sws_required: false,
    command_line_reascript_bridge: true,
  },
  startup_dialog_assist: {
    requires_first_use_consent: false,
    consent_choices: {},
    persistent_choices: [],
    manual_behavior: "Observe all REAPER windows read-only; never click or close them. Preserve the REAPER PID and Bridge generation while the user resolves a blocker.",
    auto_dismisses: [],
    auto_dismisses_with_consent: [],
    explicit_per_launch_consent: {},
    does_not_dismiss: ["all_native_reaper_windows"],
    agent_recovery: "Resolve the visible REAPER blocker, then rerun openreaper-start --recover-existing. Do not start another REAPER.",
  },
  summary_function: "createOpenReaperAgentStartupGuidance",
});

export function createOpenReaperAgentStartupGuidance(input = {}) {
  const packageRoot = normalizePath(input.package_root ?? input.packageRoot ?? input.install_root ?? input.installRoot);
  const platform = input.platform ?? process.platform;
  const isWindows = platform === "win32";
  const currentPackageStart = packageRoot ? `${packageRoot}/bin/openreaper-start` : null;
  const startupDialogAssist = {
    platform_scope: isWindows ? "windows_read_only" : "macos_read_only",
    requires_first_use_consent: false,
    consent_choices: {},
    persistent_choices: [],
    policy_file: null,
    manual_behavior: "Observe REAPER windows read-only. Never click or close them. Preserve the REAPER PID and Bridge generation while the user resolves any blocker.",
    auto_dismisses: [],
    auto_dismisses_with_consent: [],
    explicit_per_launch_consent: {},
    does_not_dismiss: ["all_native_reaper_windows"],
    disable_flag: null,
    if_not_connected: "Resolve the visible REAPER blocker, then rerun openreaper-start --recover-existing. The helper preserves the existing session and does not start a duplicate REAPER.",
  };
  const startupDialogFlow = isWindows
    ? {
      id: "resolve_windows_startup_dialog",
      when: "REAPER shows any native window during Windows startup.",
      agent_action: "Do not dismiss native REAPER windows. Ask the user to resolve the visible blocker, then reconnect to the preserved OpenReaper session.",
      command: null,
    }
    : {
      id: "resolve_startup_dialog",
      when: "openreaper-start reports blocker-code=STARTUP_USER_ACTION_REQUIRED.",
      agent_action: "Stop and ask the user to resolve the visible REAPER window. Then rerun openreaper-start --recover-existing; do not start another REAPER.",
      command: null,
    };

  return deepFreeze({
    contract: OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT,
    mode: "agent_startup_guidance",
    status: "ready",
    user_reminder: "Only REAPER sessions started through OpenReaper can use the OpenReaper MCP. Follow docs/AGENT_START_HERE.md for the unique Agent entry, first-round Macro flow, and safety boundary.",
    agent_start_here: OPENREAPER_AGENT_START_HERE_DOCUMENT,
    first_round_flow: OPENREAPER_AGENT_FIRST_ROUND_FLOW,
    mcp_server_name: "openreaper",
    commands: {
      installed_start_reaper_for_mcp: OPENREAPER_INSTALLED_START_COMMAND,
      installed_start_project_for_mcp: OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
      current_package_start_reaper_for_mcp: currentPackageStart,
      current_package_start_project_for_mcp: currentPackageStart
        ? `${currentPackageStart} --project-path /path/to/project.RPP`
        : null,
    },
    agent_flow: [
      startupDialogFlow,
      {
        id: "start_reaper_for_live_mcp",
        when: "The user asks for live REAPER work and no current OpenReaper session is connected.",
        agent_action: "Run the OpenReaper startup helper. It opens REAPER with the OpenReaper launch environment; the installed conditional startup hook starts the Bridge and the helper returns only after a matching heartbeat and public read probe pass.",
        command: currentPackageStart ?? OPENREAPER_INSTALLED_START_COMMAND,
      },
      {
        id: "start_project_for_live_mcp",
        when: "The user asks to open a specific .RPP project for live OpenReaper work.",
        agent_action: "Run the OpenReaper startup helper with --project-path. It opens the project with the OpenReaper bridge environment.",
        command: currentPackageStart
          ? `${currentPackageStart} --project-path /path/to/project.RPP`
          : OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
      },
      {
        id: "recover_bridge_action",
        when: "Autonomous startup reports a Bridge blocker after known dialogs are resolved.",
        agent_action: `Use the REAPER action "${OPENREAPER_BRIDGE_ACTION_NAME}" only as the reported manual recovery fallback, then rerun Doctor.`,
        command: null,
      },
      {
        id: "verify_bridge_connected",
        when: "openreaper-start reports startup-status=ready.",
        agent_action: "Treat readiness as verified because openreaper-start already passed call_template(template.transport.read_state); reconnect the MCP client if its prior session was stale.",
        command: null,
      },
      {
        id: "recover_startup_dialog",
        when: "REAPER shows a license/evaluation, recovery, plugin, version, project warning, or other user-choice dialog.",
        agent_action: "Stop and ask the user to resolve it. OpenReaper never clicks or closes REAPER windows in the customer product.",
        command: null,
      },
    ],
    bridge_action: {
      installed_action_name: OPENREAPER_BRIDGE_ACTION_NAME,
      agent_should_try_to_run_action: false,
      role: "manual_recovery_fallback",
      user_fallback: `Only after an autonomous startup blocker: in REAPER, open Actions, search "${OPENREAPER_BRIDGE_ACTION_NAME}", click Run, then rerun Doctor.`,
      sws_required: false,
      command_line_reascript_bridge: true,
      reconnect_after_action: true,
      verification_probe: "call_template(template.transport.read_state)",
    },
    startup_dialog_assist: startupDialogAssist,
    startup_lifetime: {
      enabled_by: "openreaper-start",
      starts_reaper_with_openreaper_env: true,
      waits_for_reaper_process: true,
      waits_for_matching_bridge_heartbeat: true,
      verifies_public_read_before_ready: true,
      pid_file: packageRoot ? `${packageRoot}/session/reaper.pid` : "~/.openreaper/current/session/reaper.pid",
      log_dir: packageRoot ? `${packageRoot}/session/logs` : "~/.openreaper/current/session/logs",
      configurable_wait_env: "OPENREAPER_START_WAIT_SECONDS",
    },
    requirements: {
      mcp_client_server_name: "openreaper",
      normal_reaper_launch_supported: false,
      only_openreaper_startup_supported: true,
      bridge_action_required_after_start: false,
      live_probe_required_before_success_claim: true,
      restart_mcp_client_after_install: true,
      reconnect_after_startup: true,
    },
    safety: {
      added_tools: 0,
      opens_reaper_from_mcp_tool: false,
      live_reaper_called: false,
      safe_write_called: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_lua_action_shell_or_ui_bypass: false,
    },
  });
}

function normalizePath(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
