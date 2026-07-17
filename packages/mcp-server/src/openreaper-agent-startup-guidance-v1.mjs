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
    startup_lifetime_action: "openreaper-start launches REAPER with the OpenReaper bridge environment and returns a pid/log path after the process stays alive.",
    startup_dialog_assist: "openreaper-start may dismiss only the known Project Settings / Notes project-load notes window. Other REAPER windows are user-choice blockers.",
    bridge_start_action: `After REAPER opens, run the REAPER action "${OPENREAPER_BRIDGE_ACTION_NAME}". The agent should try that UI step first; if it cannot, ask the user for that small assist.`,
    connection_verification: "After the bridge action, reconnect the MCP client and run a bounded live read probe before claiming the bridge is connected.",
  },
  startup_lifetime: {
    enabled_by: "openreaper-start",
    starts_reaper_with_openreaper_env: true,
    waits_for_reaper_process: true,
    pid_file: "~/.openreaper/current/session/reaper.pid",
    log_dir: "~/.openreaper/current/session/logs",
    configurable_wait_env: "OPENREAPER_START_WAIT_SECONDS",
  },
  bridge_action: {
    installed_action_name: OPENREAPER_BRIDGE_ACTION_NAME,
    agent_should_try_to_run_action: true,
    user_fallback: `In REAPER, open Actions, search "${OPENREAPER_BRIDGE_ACTION_NAME}", click Run, then ask the agent to reconnect.`,
    sws_required: false,
    command_line_reascript_bridge: false,
  },
  startup_dialog_assist: {
    auto_dismisses: ["project_settings_notes_show_notes_on_project_load"],
    does_not_dismiss: ["license_or_evaluation", "recovery", "plugin_or_fx", "version_notice", "unknown_reaper_window"],
    agent_recovery: "If the bridge does not connect, inspect REAPER for a waiting window or ask the user to close/answer it; then run the bridge action and reconnect.",
  },
  summary_function: "createOpenReaperAgentStartupGuidance",
});

export function createOpenReaperAgentStartupGuidance(input = {}) {
  const packageRoot = normalizePath(input.package_root ?? input.packageRoot ?? input.install_root ?? input.installRoot);
  const currentPackageStart = packageRoot ? `${packageRoot}/bin/openreaper-start` : null;

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
      {
        id: "start_reaper_for_live_mcp",
        when: "The user asks for live REAPER work and no current OpenReaper session is connected.",
        agent_action: "Run the OpenReaper startup helper. It opens REAPER with the OpenReaper bridge environment, prints the pid/log path, and may safely clear only the Project Settings / Notes project-load window.",
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
        id: "start_bridge_action",
        when: "REAPER is open from openreaper-start, but live MCP calls are not connected yet.",
        agent_action: `Try to run the REAPER action "${OPENREAPER_BRIDGE_ACTION_NAME}". If you cannot operate REAPER UI, ask the user to open Actions, search that exact action name, click Run, and then tell you to reconnect.`,
        command: null,
      },
      {
        id: "verify_bridge_connected",
        when: "After the bridge action has run and the MCP client reconnects.",
        agent_action: "Run a bounded live read probe such as call_template(template.transport.read_state). Treat timeout/no result as not connected yet; check for REAPER windows blocking startup or ask the user to resolve them.",
        command: null,
      },
      {
        id: "recover_startup_dialog",
        when: "REAPER shows a license/evaluation, recovery, plugin, version, project warning, or other user-choice dialog.",
        agent_action: "Do not auto-dismiss it. Tell the user or operate the UI only with clear intent, then run or ask for the bridge action and reconnect before live MCP calls.",
        command: null,
      },
    ],
    bridge_action: {
      installed_action_name: OPENREAPER_BRIDGE_ACTION_NAME,
      agent_should_try_to_run_action: true,
      user_fallback: `In REAPER, open Actions, search "${OPENREAPER_BRIDGE_ACTION_NAME}", click Run, then ask the agent to reconnect.`,
      sws_required: false,
      command_line_reascript_bridge: false,
      reconnect_after_action: true,
      verification_probe: "call_template(template.transport.read_state)",
    },
    startup_dialog_assist: {
      auto_dismisses: ["project_settings_notes_show_notes_on_project_load"],
      does_not_dismiss: ["license_or_evaluation", "recovery", "plugin_or_fx", "version_notice", "unknown_reaper_window"],
      disable_flag: "--no-startup-dialog-assist",
      if_not_connected: "Check for a REAPER window waiting for user/agent action; resolve it, run the bridge action, reconnect, then run the live read probe.",
    },
    startup_lifetime: {
      enabled_by: "openreaper-start",
      starts_reaper_with_openreaper_env: true,
      waits_for_reaper_process: true,
      pid_file: packageRoot ? `${packageRoot}/session/reaper.pid` : "~/.openreaper/current/session/reaper.pid",
      log_dir: packageRoot ? `${packageRoot}/session/logs` : "~/.openreaper/current/session/logs",
      configurable_wait_env: "OPENREAPER_START_WAIT_SECONDS",
    },
    requirements: {
      mcp_client_server_name: "openreaper",
      normal_reaper_launch_supported: false,
      only_openreaper_startup_supported: true,
      bridge_action_required_after_start: true,
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
