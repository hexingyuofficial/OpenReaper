import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import os from "node:os";
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
const BRIDGE_LAUNCHER = path.join(REPO_ROOT, "scripts/openreaper-alpha-package/openreaper-start-mcp-bridge.lua");
const STARTUP_ASSISTANT = path.join(REPO_ROOT, "packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs");

describe("Alpha3 Block2 startup and connection readiness", () => {
  it("requires an explicit first-use choice and persists only always or manual", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-start-consent-"));
    const startPath = path.join(root, "current", "bin", "openreaper-start");
    const policyPath = path.join(root, "data", "startup-dialog-consent");
    const missingReaperApp = path.join(root, "MissingREAPER.app");
    mkdirSync(path.dirname(startPath), { recursive: true });
    copyFileSync(START_HELPER, startPath);
    copyFileSync(BRIDGE_LAUNCHER, path.join(path.dirname(startPath), "openreaper-start-mcp-bridge.lua"));
    chmodSync(startPath, 0o755);
    try {
      const first = spawnSync(startPath, [], { encoding: "utf8" });
      assert.equal(first.status, 3);
      assert.match(first.stderr, /startup-status=needs_user_consent/u);
      assert.match(first.stderr, /once, always, or handle windows themselves/u);

      const internalOnly = spawnSync(startPath, ["--startup-dialog-consent", "manual_once"], { encoding: "utf8" });
      assert.equal(internalOnly.status, 2);
      assert.match(internalOnly.stderr, /must be once, always, or manual/u);

      const always = spawnSync(startPath, ["--startup-dialog-consent", "always", "--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(always.status, 2);
      assert.equal(readFileSync(policyPath, "utf8"), "always\n");
      assert.equal(statSync(policyPath).mode & 0o777, 0o600);

      const reused = spawnSync(startPath, ["--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(reused.status, 2);
      assert.doesNotMatch(reused.stderr, /startup-dialog-consent=required/u);

      const manual = spawnSync(startPath, ["--startup-dialog-consent=manual", "--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(manual.status, 2);
      assert.equal(readFileSync(policyPath, "utf8"), "manual\n");

      const once = spawnSync(startPath, ["--startup-dialog-consent", "once", "--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(once.status, 2);
      assert.equal(readFileSync(policyPath, "utf8"), "manual\n");

      rmSync(path.dirname(policyPath), { recursive: true, force: true });
      const redirectedData = path.join(root, "redirected-data");
      mkdirSync(redirectedData);
      writeFileSync(path.join(redirectedData, "startup-dialog-consent"), "always\n");
      symlinkSync(redirectedData, path.dirname(policyPath));
      const redirectedRead = spawnSync(startPath, ["--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(redirectedRead.status, 1);
      assert.match(redirectedRead.stderr, /consent directory must be a real directory/u);

      const redirectedWrite = spawnSync(startPath, ["--startup-dialog-consent", "always", "--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(redirectedWrite.status, 1);
      assert.match(redirectedWrite.stderr, /consent directory must be a real directory/u);
      assert.equal(readFileSync(path.join(redirectedData, "startup-dialog-consent"), "utf8"), "always\n");

      rmSync(path.dirname(policyPath), { force: true });
      mkdirSync(policyPath, { recursive: true });
      const directoryDestination = spawnSync(startPath, ["--startup-dialog-consent", "always", "--reaper-app", missingReaperApp], { encoding: "utf8" });
      assert.equal(directoryDestination.status, 1);
      assert.match(directoryDestination.stderr, /consent path must be a regular non-symlink file/u);
      assert.equal(statSync(policyPath).isDirectory(), true);

      const source = readFileSync(startPath, "utf8");
      assert.match(source, /constants\.O_EXCL \| constants\.O_NOFOLLOW/u);
      assert.match(source, /randomBytes\(16\)/u);
      assert.doesNotMatch(source, /\.tmp\.\$\$/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("requires one fixed package-local launcher and keeps it after project and extra arguments", () => {
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-start-launcher-"));
    const binRoot = path.join(root, "current", "bin");
    const startPath = path.join(binRoot, "openreaper-start");
    const launcherPath = path.join(binRoot, "openreaper-start-mcp-bridge.lua");
    mkdirSync(binRoot, { recursive: true });
    copyFileSync(START_HELPER, startPath);
    chmodSync(startPath, 0o755);
    try {
      const missing = spawnSync(startPath, ["--startup-dialog-consent", "once"], { encoding: "utf8" });
      assert.equal(missing.status, 2);
      assert.match(missing.stderr, /trusted Bridge launcher must be a regular non-symlink package file/u);

      mkdirSync(launcherPath);
      const directory = spawnSync(startPath, ["--startup-dialog-consent", "once"], { encoding: "utf8" });
      assert.equal(directory.status, 2);
      assert.match(directory.stderr, /regular non-symlink package file/u);
      rmSync(launcherPath, { recursive: true, force: true });

      const outsideLauncher = path.join(root, "outside.lua");
      writeFileSync(outsideLauncher, "-- outside fixture\n", "utf8");
      symlinkSync(outsideLauncher, launcherPath);
      const linked = spawnSync(startPath, ["--startup-dialog-consent", "once"], { encoding: "utf8" });
      assert.equal(linked.status, 2);
      assert.match(linked.stderr, /regular non-symlink package file/u);

      rmSync(launcherPath, { force: true });
      copyFileSync(BRIDGE_LAUNCHER, launcherPath);
      chmodSync(launcherPath, 0o000);
      const unreadable = spawnSync(startPath, ["--startup-dialog-consent", "once"], { encoding: "utf8" });
      assert.equal(unreadable.status, 2);
      assert.match(unreadable.stderr, /trusted Bridge launcher is not readable/u);
      chmodSync(launcherPath, 0o444);

      const untrustedScript = spawnSync(startPath, ["--startup-dialog-consent", "once", path.join(root, "untrusted.lua")], { encoding: "utf8" });
      assert.equal(untrustedScript.status, 2);
      assert.match(untrustedScript.stderr, /refusing an untrusted command-line ReaScript argument/u);

      const source = readFileSync(startPath, "utf8");
      assert.doesNotMatch(source, /reaper_args\+=\("\$\{BRIDGE_SCRIPT\}"\)/u);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("keeps missing-media dialog automation consent-bound and exact", () => {
    const source = readFileSync(START_HELPER, "utf8");
    assert.match(source, /--recover-existing/u);
    assert.match(source, /verified_existing_reaper_pid\(\)/u);
    assert.match(source, /startup-mode=recover_existing/u);
    assert.match(source, /SAME_INSTANCE_BRIDGE_ACTION_REQUIRED/u);
    assert.match(source, /cannot restart (?:its|a) stopped Bridge/u);
    assert.match(source, /existing session could not be safely verified; refusing to launch another REAPER/u);
    assert.match(source, /OPENREAPER_SESSION_ROOT="\$\{SESSION_ROOT\}"/u);
    assert.match(source, /if windowTitle is "Project Load Warning" then/u);
    assert.match(source, /my uiTextAreaContains\(reaperWindow, "in an off-line state", "filenames should be preserved"\)/u);
    assert.doesNotMatch(source, /combinedText|uiTextContains\(reaperWindow/u);
    assert.doesNotMatch(source, /windowTitle is "Project Load Warning" or my uiElementNamed/u);
    assert.match(source, /allowMissingMedia and isOfflineMediaWarning and my exactUiElementCount\(reaperWindow, "OK", "AXButton"\) is 1/u);
    assert.match(source, /dismissed_missing_media_offline_warning:choice=OK/u);
    assert.match(source, /return "blocked_user_decision:title=Project Load Warning"/u);
    assert.match(source, /my exactUiElementCount\(reaperWindow, "Ignore all missing files", "AXButton"\) is 1/u);
    assert.match(source, /my clickUniqueExactButton\(reaperWindow, "Ignore all missing files"\)/u);
    assert.match(source, /set matchingElement to missing value[\s\S]+set matchCount to 0[\s\S]+if matchCount is not 1 then error "exact button is not unique"[\s\S]+click matchingElement/u);
    assert.match(source, /set windowSubrole to subrole of reaperWindow as text/u);
    const windowClassificationIndex = source.lastIndexOf('set windowSubrole to ""');
    const deepTreeScanIndex = source.indexOf("set hasIgnoreMissingFiles to false");
    assert.ok(windowClassificationIndex >= 0 && deepTreeScanIndex > windowClassificationIndex, "window subrole must be classified before deep accessibility scans");
    assert.match(source, /set isPotentialDialog to windowSubrole is "AXDialog" or windowSubrole is "AXSheet" or windowTitle is "Project Load Warning"/u);
    assert.match(source, /if isPotentialDialog then/u);
    assert.match(source, /if windowSubrole is "AXDialog" or windowSubrole is "AXSheet" then/u);
    assert.match(source, /if windowSubrole is "AXDialog" or windowSubrole is "AXSheet" then\s+if windowTitle contains "Evaluation"/u);
    assert.match(source, /if windowSubrole is not "AXWindow" and windowSubrole is not "AXStandardWindow" and windowSubrole is not "" then\s+return "blocked_unknown_dialog:title="/u);
    assert.match(source, /STARTUP_DIALOG_TIMEOUT_SECONDS="\$\{OPENREAPER_STARTUP_DIALOG_TIMEOUT_SECONDS:-15\}"/u);
    assert.match(source, /perl -e 'my \$seconds = shift @ARGV; alarm \$seconds; exec @ARGV or die/u);
    assert.match(source, /"\$\{STARTUP_DIALOG_TIMEOUT_SECONDS\}"[\s\\]+\/usr\/bin\/osascript - "\$\{STARTUP_DIALOG_ASSIST\}" "\$\{IGNORE_MISSING_MEDIA\}" "\$\{reaper_pid\}"/u);
    assert.match(source, /blocked_dialog_inspection_timeout:seconds=/u);
    assert.match(source, /blocked_dialog_inspection_failed:status=/u);
    const directLaunchStart = source.indexOf('nohup "${REAPER_BIN}"');
    const directLaunchEnd = source.indexOf("\n  fi\n  echo \"${reaper_pid}\" > \"${PID_FILE}\"", directLaunchStart);
    assert.ok(directLaunchStart >= 0 && directLaunchEnd > directLaunchStart, "direct launch branch must remain inspectable");
    const directLaunchSource = source.slice(directLaunchStart, directLaunchEnd);
    assert.ok(
      directLaunchSource.indexOf('echo "${reaper_pid}" > "${PID_FILE}"')
        < directLaunchSource.indexOf("wait_for_startup_hook"),
      "dialog classification must receive the direct launch PID",
    );
    assert.match(source, /set launchedPid to item 3 of argv as integer/u);
    assert.match(source, /every process whose unix id is launchedPid/u);
    assert.match(source, /if \(count of matchingProcesses\) is not 1 then return "blocked_reaper_identity:pid="/u);
    assert.doesNotMatch(source, /tell process "REAPER"/u);
    assert.match(source, /on isExactProjectNotesWindow\(theWindow\)[\s\S]+notesCheckboxCount is 1 and okButtonCount is 1[\s\S]+end isExactProjectNotesWindow/u);
    assert.match(source, /set isProjectNotesWindow to my isExactProjectNotesWindow\(reaperWindow\)/u);
    assert.doesNotMatch(source, /if my uiElementNamed\(reaperWindow, "Notes"\) then set isProjectNotesWindow to true/u);
    assert.doesNotMatch(source, /if my uiElementNamed\(reaperWindow, "Show notes on project load"\) then set isProjectNotesWindow to true/u);
    assert.match(source, /if not allowSafeActions then return "blocked_manual_dialog:title=Project Settings"/u);
    assert.match(source, /blocked_dialog_classification:title=/u);
    assert.doesNotMatch(source, /echo "disabled"/u);
  });

  it("does not expose the retired conditional-hook or manual bridge-script startup guidance", () => {
    const source = readFileSync(STARTUP_ASSISTANT, "utf8");
    assert.match(source, /requires_conditional_reaper_startup_hook: false/u);
    assert.match(source, /uses_trusted_package_command_line_reascript: true/u);
    assert.doesNotMatch(source, /Run the bundled OpenReaper script in REAPER/u);
    assert.doesNotMatch(source, /--install-startup-hook/u);
    assert.match(source, /manual recovery fallback/u);
  });

  it("fails closed for every dialog-assist result outside the exact safe allowlist", () => {
    const source = readFileSync(START_HELPER, "utf8");
    const functionStart = source.indexOf("startup_dialog_result_is_safe() {");
    const functionEnd = source.indexOf("\n}\n\nrecord_dialog_result()", functionStart);
    assert.notEqual(functionStart, -1);
    assert.notEqual(functionEnd, -1);
    const classifier = source.slice(functionStart, functionEnd + 2);

    for (const result of [
      "no_safe_dialog",
      "dismissed_project_notes",
      "dismissed_missing_media:choice=Ignore all missing files",
      "dismissed_missing_media_offline_warning:choice=OK",
    ]) {
      assert.equal(runDialogClassifier(classifier, result), 0, result);
    }

    for (const result of [
      "unavailable",
      "blocked_dialog_inspection_timeout:seconds=5",
      "blocked_dialog_inspection_failed:status=1",
      "failed",
      "no_reaper_process",
      "blocked_reaper_identity:pid=123",
      "disabled",
      "blocked_manual_dialog:title=Project Settings",
      "blocked_dialog_classification:title=Untitled:error=permission denied",
      "project_notes_seen_not_dismissed:permission denied",
      "project_settings_seen_but_not_notes",
      "blocked_missing_media:choice=Ignore all missing files:error=permission denied",
      "blocked_missing_media_offline_warning:choice=OK:error=permission denied",
      "blocked_user_decision:title=Project Load Warning",
      "blocked_unknown_dialog:title=Unexpected",
    ]) {
      assert.equal(runDialogClassifier(classifier, result), 1, result);
    }

    const readinessStart = source.indexOf("wait_for_startup_readiness() {");
    const readinessEnd = source.indexOf("\n}\n\ntrap 'launchservices_cleanup_on_exit'", readinessStart);
    const readiness = source.slice(readinessStart, readinessEnd);
    const dialogIndex = readiness.indexOf('dialog_result="$(run_startup_dialog_assist)"');
    const decisionIndex = readiness.indexOf("if ! startup_dialog_result_is_safe \"${dialog_result}\"; then");
    const heartbeatIndex = readiness.indexOf("if bridge_heartbeat_ready; then");
    const probeIndex = readiness.indexOf("verify_public_bridge_read || return 1", heartbeatIndex);
    const cleanScanIndex = readiness.indexOf('if [[ "${dialog_result}" != "no_safe_dialog" ]]', decisionIndex);
    assert.equal(readinessStart >= 0 && readinessEnd > readinessStart, true);
    assert.equal(heartbeatIndex >= 0 && heartbeatIndex < probeIndex && probeIndex < dialogIndex, true);
    assert.equal(dialogIndex < decisionIndex && decisionIndex < cleanScanIndex, true);
    assert.match(readiness, /if bridge_heartbeat_ready; then[\s\S]+verify_public_bridge_read \|\| return 1[\s\S]+dialog_result="\$\(run_startup_dialog_assist\)"/u);
    assert.match(readiness, /if startup_dialog_result_requires_manual_clearance "\$\{dialog_result\}"; then\s+sleep 0\.25\s+continue/u);
    assert.doesNotMatch(source, /startup_dialog_probe_is_unavailable/u);

    const hookStart = source.indexOf("wait_for_startup_hook() {");
    const hookEnd = source.indexOf("\n}\n\nverify_public_bridge_read()", hookStart);
    const hook = source.slice(hookStart, hookEnd);
    assert.equal(hook.indexOf("if startup_status_stage_ready; then") < hook.indexOf('dialog_result="$(run_startup_dialog_assist)"'), true);
    assert.match(hook, /if startup_dialog_result_requires_manual_clearance "\$\{dialog_result\}"; then\s+sleep 0\.25\s+continue/u);
    assert.match(source, /startup_dialog_result_requires_manual_clearance\(\) \{[\s\S]+if \[\[ "\$\{STARTUP_DIALOG_ASSIST\}" != "false" \]\]; then[\s\S]+blocked_user_decision:\*[\s\S]+blocked_unknown_dialog:\*/u);
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
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.command_line_reascript_bridge, true);
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.bridge_action.verification_probe, "call_template(template.transport.read_state)");
    assert.deepEqual(
      expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.auto_dismisses,
      ["project_settings_notes_show_notes_on_project_load"],
    );
    assert.equal(expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.requires_first_use_consent, true);
    assert.match(expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.manual_behavior, /Never click/u);
    assert.deepEqual(expandedProductSurface.agent_startup_guidance_snapshot.startup_dialog_assist.consent_choices, {
      once: "--startup-dialog-consent once",
      always: "--startup-dialog-consent always",
      manual: "--startup-dialog-consent manual",
    });
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
    assert.equal(guidance.bridge_action.command_line_reascript_bridge, true);
    assert.equal(guidance.bridge_action.reconnect_after_action, true);
    assert.equal(guidance.bridge_action.verification_probe, "call_template(template.transport.read_state)");
    assert.deepEqual(guidance.startup_dialog_assist.auto_dismisses, ["project_settings_notes_show_notes_on_project_load"]);
    assert.equal(guidance.startup_dialog_assist.requires_first_use_consent, true);
    assert.deepEqual(guidance.startup_dialog_assist.persistent_choices, ["always", "manual"]);
    assert.match(guidance.startup_dialog_assist.manual_behavior, /Never click/u);
    assert.equal(guidance.startup_dialog_assist.policy_file, "/tmp/OpenReaper-alpha/../data/startup-dialog-consent");
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
