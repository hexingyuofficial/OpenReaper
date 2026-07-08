export const OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT = "openreaper.alpha3_1.agent_startup_guidance.v1";

export const OPENREAPER_DEFAULT_INSTALL_ROOT = "~/.openreaper/current";
export const OPENREAPER_INSTALLED_START_COMMAND =
  `${OPENREAPER_DEFAULT_INSTALL_ROOT}/bin/openreaper-start`;
export const OPENREAPER_INSTALLED_PROJECT_START_COMMAND =
  `${OPENREAPER_INSTALLED_START_COMMAND} --project-path /path/to/project.RPP`;

export const OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY = deepFreeze({
  contract: OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT,
  mode: "agent_startup_guidance",
  product_goal: "Tell a zero-premise agent how to start or reconnect a REAPER session that OpenReaper MCP can use.",
  exposed_through: ["ping", "list_templates.product_surface"],
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
    startup_dialog_action: "If REAPER shows a startup/version/recovery/plugin dialog, dismiss it and reconnect.",
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
    user_reminder: "Only REAPER sessions started through OpenReaper can use the OpenReaper MCP.",
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
        agent_action: "Run the OpenReaper startup helper, then reconnect to MCP server openreaper.",
        command: currentPackageStart ?? OPENREAPER_INSTALLED_START_COMMAND,
      },
      {
        id: "start_project_for_live_mcp",
        when: "The user asks to open a specific .RPP project for live OpenReaper work.",
        agent_action: "Run the OpenReaper startup helper with --project-path, then reconnect.",
        command: currentPackageStart
          ? `${currentPackageStart} --project-path /path/to/project.RPP`
          : OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
      },
      {
        id: "recover_startup_dialog",
        when: "REAPER shows a startup, version, recovery, or plugin dialog.",
        agent_action: "Ask the user to dismiss the dialog, then reconnect before live calls.",
        command: null,
      },
    ],
    requirements: {
      mcp_client_server_name: "openreaper",
      normal_reaper_launch_supported: false,
      only_openreaper_startup_supported: true,
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
