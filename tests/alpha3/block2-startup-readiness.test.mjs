import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import {
  ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT,
  ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY,
  runAlpha3Block2StartupReadinessGate,
  summarizeAlpha3Block2StartupReadiness,
} from "../../packages/mcp-server/src/alpha3-block2-startup-readiness-v1.mjs";
import {
  ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
  ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
} from "../../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";
import {
  ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
} from "../../packages/mcp-server/src/alpha3-d1-startup-health-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT,
  OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY,
  OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
  OPENREAPER_INSTALLED_START_COMMAND,
  createOpenReaperAgentStartupGuidance,
} from "../../packages/mcp-server/src/openreaper-agent-startup-guidance-v1.mjs";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const START_HELPER = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start.sh");

describe("Alpha3 Block2 startup and connection readiness", () => {
  it("keeps missing-media dialog automation consent-bound and exact", () => {
    const source = readFileSync(START_HELPER, "utf8");
    assert.match(source, /if windowTitle is "Project Load Warning" then/u);
    assert.match(source, /value of text area 1 of scroll area 1 of reaperWindow as text/u);
    assert.match(source, /warningText contains "in an off-line state" and warningText contains "filenames should be preserved"/u);
    assert.match(source, /allowMissingMedia and isOfflineMediaWarning and my directButtonCount\(reaperWindow, "OK"\) is 1/u);
    assert.match(source, /dismissed_missing_media_offline_warning:choice=OK/u);
    assert.match(source, /return "blocked_user_decision:title=Project Load Warning"/u);
    assert.match(source, /exists button "Ignore all missing files" of reaperWindow/u);
    assert.doesNotMatch(source, /uiElementNamed\(reaperWindow, "Ignore all missing files"\)/u);
    assert.match(source, /if subrole of reaperWindow is "AXDialog" then set isDialog to true/u);
    assert.match(source, /if isDialog then\s+if windowTitle contains "Evaluation"/u);
    assert.match(source, /osascript - "\$\{IGNORE_MISSING_MEDIA\}" "\$\{reaper_pid\}"/u);
    assert.match(source, /set launchedPid to item 2 of argv as integer/u);
    assert.match(source, /every process whose unix id is launchedPid/u);
    assert.match(source, /if \(count of matchingProcesses\) is not 1 then return "blocked_reaper_identity:pid="/u);
    assert.doesNotMatch(source, /tell process "REAPER"/u);
  });

  it("fails closed for every dialog-assist result outside the exact safe allowlist", () => {
    const source = readFileSync(START_HELPER, "utf8");
    const functionStart = source.indexOf("startup_dialog_result_is_safe() {");
    const functionEnd = source.indexOf("\n}\n\nrecord_dialog_result()", functionStart);
    assert.notEqual(functionStart, -1);
    assert.notEqual(functionEnd, -1);
    const classifier = source.slice(functionStart, functionEnd + 2);

    for (const result of [
      "disabled",
      "no_safe_dialog",
      "dismissed_project_notes",
      "dismissed_missing_media:choice=Ignore all missing files",
      "dismissed_missing_media_offline_warning:choice=OK",
    ]) {
      assert.equal(runDialogClassifier(classifier, result), 0, result);
    }

    for (const result of [
      "unavailable",
      "failed",
      "no_reaper_process",
      "blocked_reaper_identity:pid=123",
      "project_notes_seen_not_dismissed:permission denied",
      "project_settings_seen_but_not_notes",
      "blocked_missing_media:choice=Ignore all missing files:error=permission denied",
      "blocked_missing_media_offline_warning:choice=OK:error=permission denied",
      "blocked_user_decision:title=Project Load Warning",
      "blocked_unknown_dialog:title=Unexpected",
    ]) {
      assert.equal(runDialogClassifier(classifier, result), 1, result);
    }

    const decisionIndex = source.indexOf("if ! startup_dialog_result_is_safe \"${dialog_result}\"; then");
    const heartbeatIndex = source.indexOf("if bridge_heartbeat_ready; then", decisionIndex);
    const probeIndex = source.indexOf("verify_public_bridge_read || return 1", heartbeatIndex);
    assert.notEqual(decisionIndex, -1);
    assert.equal(decisionIndex < heartbeatIndex && heartbeatIndex < probeIndex, true);
  });

  it("summarizes startup readiness without opening REAPER or spawning processes", () => {
    const summary = summarizeAlpha3Block2StartupReadiness();

    assert.equal(summary.contract, ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT);
    assert.equal(summary.mode, "static_product_surface_summary");
    assert.equal(summary.status, "ready_for_startup_gate");
    assert.equal(summary.health.contract, ALPHA3_D1_STARTUP_HEALTH_CONTRACT);
    assert.equal(summary.assistant.contract, ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT);
    assert.equal(summary.wrapper.contract, ALPHA3_D1_STARTUP_WRAPPER_CONTRACT);
    assert.equal(summary.truth_boundary.one_click_live_accepted, true);
    assert.equal(summary.truth_boundary.one_click_scope, "local_macos_with_startup_dialog_caveat");
    assert.equal(summary.truth_boundary.customer_ready_startup_claim, false);
    assert.equal(summary.truth_boundary.bounded_startup_window_required, true);
    assert.equal(summary.safety.added_tools, 0);
    assert.equal(summary.safety.opens_reaper, false);
    assert.equal(summary.safety.spawns_process_now, false);
    assert.equal(summary.safety.live_reaper_called, false);
    assert.equal(summary.safety.safe_write_called, false);
    assert.equal(summary.safety.hidden_executor, false);
    assert.equal(summary.safety.public_call_recipe, false);
  });

  it("accepts the static startup/connect/reconnect/stale-session gate", () => {
    const gate = runAlpha3Block2StartupReadinessGate();

    assert.equal(gate.contract, ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT);
    assert.equal(gate.mode, "static_startup_connection_gate");
    assert.equal(gate.ok, true);
    assert.equal(gate.hard_gate.accepted, true);
    assert.deepEqual(gate.hard_gate.failures, []);
    assert.equal(gate.scenarios.ready.status, "ready");
    assert.equal(gate.scenarios.ready.ok, true);
    assert.equal(gate.scenarios.missing_startup.status, "needs_startup");
    assert.deepEqual(gate.scenarios.missing_startup.recovery_actions, ["ask_user_to_open"]);
    assert.equal(gate.scenarios.stale_session.status, "stale_session");
    assert.deepEqual(gate.scenarios.stale_session.blockers, [
      "SESSION_IDENTITY_MISMATCH",
      "BRIDGE_OWNER_MISMATCH",
      "BRIDGE_GENERATION_MISMATCH",
    ]);
    assert.equal(gate.scenarios.stale_session.safety.stale_session_guard, true);
    assert.equal(gate.scenarios.stale_session.safety.safe_write_called, false);
    assert.equal(gate.scenarios.scope_blocked.status, "blocked");
    assert.deepEqual(gate.scenarios.scope_blocked.blockers, ["LIVE_SCOPE_UNKNOWN"]);
    assert.equal(gate.assistant.status, "prepare_session");
    assert.equal(gate.assistant.session_card_contract, "alpha3.d1.startup_session_card.v1");
    assert.deepEqual(gate.assistant.actions, ["prepare_local_session_card"]);
    assert.equal(gate.assistant.safety.opens_reaper, false);
    assert.equal(gate.assistant.safety.live_reaper_called, false);
    assert.equal(gate.wrapper.prepared, true);
    assert.equal(gate.wrapper.customer_ready, false);
    assert.equal(gate.wrapper.one_click_live_accepted, true);
    assert.equal(gate.wrapper.evidence_status, "live_evidence_accepted");
    assert.match(gate.wrapper.bounded_live_prompt, /bounded OpenReaper startup evidence window/);
    assert.equal(gate.wrapper.safety.opens_reaper_now, false);
    assert.equal(gate.wrapper.safety.spawns_process_now, false);
    assert.equal(gate.session_card.shareable, false);
    assert.equal(gate.session_card.scrub_before_share, true);
    assert.equal(gate.session_card.env_file_preview_contains_transport, true);
    assert.equal(gate.session_card.wrapper_readme_blocks_spawning, true);
    assert.equal(gate.execution.live_reaper, false);
    assert.equal(gate.execution.safe_write, false);
    assert.equal(gate.execution.spawned_reaper, false);
    assert.equal(gate.execution.hidden_executor, false);
    assert.equal(gate.execution.public_call_recipe, false);
    assert.equal(gate.execution.one_click_live_claim, true);
    assert.equal(gate.execution.one_click_scope, "local_macos_with_startup_dialog_caveat");
    assert.equal(gate.customer_flow.status, "local_macos_one_click_live_accepted");
    assert.equal(gate.trial_officer.verdict, "accept_block2_static_startup_gate");
    assert.deepEqual(gate.trial_officer.p0_p1_findings, []);
  });

  it("exposes Block2 startup readiness through the existing runtime product surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const productSurface = menu.product_surface;

    assert.equal(menu.mode, "menu");
    assert.equal(productSurface.detail_level, "compact");
    assert.deepEqual(
      productSurface.agent_startup_guidance,
      OPENREAPER_AGENT_STARTUP_GUIDANCE_SUMMARY,
    );
    assert.equal(productSurface.agent_startup_guidance.tool_surface.added_tools, 0);
    assert.deepEqual(
      productSurface.startup_readiness,
      ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY,
    );
    assert.equal(productSurface.startup_readiness.tool_surface.added_tools, 0);
    assert.equal(Object.hasOwn(productSurface, "agent_startup_guidance_snapshot"), false);
    assert.equal(Object.hasOwn(productSurface, "startup_readiness_snapshot"), false);

    const expandedMenu = runtime.list_templates({
      ids: ["template.transport.read_state"],
      fields: ["id"],
    });
    const expandedProductSurface = expandedMenu.product_surface;

    assert.equal(expandedMenu.mode, "ids");
    assert.deepEqual(expandedMenu.items.map((item) => item.id), ["template.transport.read_state"]);
    assert.equal(expandedProductSurface.detail_level, "expanded");
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.contract, OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT);
    assert.equal(
      expandedProductSurface.agent_startup_guidance_snapshot.commands.installed_start_reaper_for_mcp,
      OPENREAPER_INSTALLED_START_COMMAND,
    );
    assert.equal(
      expandedProductSurface.agent_startup_guidance_snapshot.commands.installed_start_project_for_mcp,
      OPENREAPER_INSTALLED_PROJECT_START_COMMAND,
    );
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.requirements.normal_reaper_launch_supported, false);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.requirements.only_openreaper_startup_supported, true);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.requirements.bridge_action_required_after_start, false);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.requirements.live_probe_required_before_success_claim, true);
    assert.equal(
      expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.installed_action_name,
      "OpenReaper: Start MCP bridge",
    );
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.agent_should_try_to_run_action, false);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.sws_required, false);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.command_line_reascript_bridge, false);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.verification_probe, "call_template(template.transport.read_state)");
    assert.deepEqual(
      expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.auto_dismisses,
      ["project_settings_notes_show_notes_on_project_load"],
    );
    assert.deepEqual(
      expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.does_not_dismiss,
      ["missing_media_without_consent", "license_or_evaluation", "recovery", "plugin_or_fx", "version_notice", "unknown_reaper_window"],
    );
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.startup_lifetime.starts_reaper_with_openreaper_env, true);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.startup_lifetime.waits_for_reaper_process, true);
    assert.equal(
      expandedProductSurface.agent_startup_guidance_snapshot.startup_lifetime.configurable_wait_env,
      "OPENREAPER_START_WAIT_SECONDS",
    );
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.safety.added_tools, 0);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.safety.opens_reaper_from_mcp_tool, false);
    assert.equal(expandedProductSurface.startup_readiness_snapshot.contract, ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT);
    assert.equal(expandedProductSurface.startup_readiness_snapshot.status, "ready_for_startup_gate");
    assert.equal(expandedProductSurface.startup_readiness_snapshot.truth_boundary.one_click_live_accepted, true);
    assert.equal(expandedProductSurface.startup_readiness_snapshot.truth_boundary.one_click_scope, "local_macos_with_startup_dialog_caveat");
    assert.equal(expandedProductSurface.startup_readiness_snapshot.safety.opens_reaper, false);
    assert.equal(expandedProductSurface.startup_readiness_snapshot.safety.live_reaper_called, false);
  });

  it("formats package-specific agent startup commands without expanding the MCP tool surface", () => {
    const guidance = createOpenReaperAgentStartupGuidance({
      package_root: "/tmp/OpenReaper-alpha",
    });

    assert.equal(guidance.contract, OPENREAPER_AGENT_STARTUP_GUIDANCE_CONTRACT);
    assert.equal(guidance.commands.installed_start_reaper_for_mcp, "~/.openreaper/current/bin/openreaper-start");
    assert.equal(guidance.commands.current_package_start_reaper_for_mcp, "/tmp/OpenReaper-alpha/bin/openreaper-start");
    assert.equal(
      guidance.commands.current_package_start_project_for_mcp,
      "/tmp/OpenReaper-alpha/bin/openreaper-start --project-path /path/to/project.RPP",
    );
    assert.equal(guidance.requirements.mcp_client_server_name, "openreaper");
    assert.equal(guidance.requirements.normal_reaper_launch_supported, false);
    assert.equal(guidance.requirements.reconnect_after_startup, true);
    assert.equal(guidance.requirements.bridge_action_required_after_start, false);
    assert.equal(guidance.requirements.live_probe_required_before_success_claim, true);
    assert.equal(guidance.bridge_action.installed_action_name, "OpenReaper: Start MCP bridge");
    assert.equal(guidance.bridge_action.agent_should_try_to_run_action, false);
    assert.equal(guidance.bridge_action.sws_required, false);
    assert.equal(guidance.bridge_action.command_line_reascript_bridge, false);
    assert.equal(guidance.bridge_action.reconnect_after_action, true);
    assert.equal(guidance.bridge_action.verification_probe, "call_template(template.transport.read_state)");
    assert.deepEqual(guidance.startup_dialog_assist.auto_dismisses, ["project_settings_notes_show_notes_on_project_load"]);
    assert.deepEqual(
      guidance.startup_dialog_assist.does_not_dismiss,
      ["missing_media_without_consent", "license_or_evaluation", "recovery", "plugin_or_fx", "version_notice", "unknown_reaper_window"],
    );
    assert.equal(guidance.startup_lifetime.starts_reaper_with_openreaper_env, true);
    assert.equal(guidance.startup_lifetime.waits_for_reaper_process, true);
    assert.equal(guidance.startup_lifetime.pid_file, "/tmp/OpenReaper-alpha/session/reaper.pid");
    assert.equal(guidance.startup_lifetime.log_dir, "/tmp/OpenReaper-alpha/session/logs");
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /OpenReaper bridge environment/);
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /OpenReaper: Start MCP bridge/);
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /manual recovery fallback/);
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /public read probe/);
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /Do not auto-dismiss/);
    assert.match(guidance.agent_flow.map((step) => step.agent_action).join("\n"), /reconnect/);
    assert.equal(guidance.safety.added_tools, 0);
    assert.equal(guidance.safety.hidden_executor, false);
    assert.equal(guidance.safety.public_call_recipe, false);
    assert.equal(guidance.safety.raw_lua_action_shell_or_ui_bypass, false);
  });
});

function runDialogClassifier(classifier, result) {
  return spawnSync("zsh", ["-c", `${classifier}\nstartup_dialog_result_is_safe "$1"`, "dialog-classifier", result], {
    encoding: "utf8",
  }).status;
}
