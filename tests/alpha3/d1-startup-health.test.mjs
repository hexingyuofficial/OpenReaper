import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT,
  ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY,
  ALPHA3_D1_STARTUP_WRAPPER_CONTRACT,
  ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY,
  ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
  createAlpha3D1StartupSessionCard,
  formatAlpha3D1StartupEnvFile,
  formatAlpha3D1StartupWrapperReadme,
  planAlpha3D1StartupAssistant,
  planAlpha3D1StartupWrapper,
  summarizeAlpha3D1StartupAssistant,
  summarizeAlpha3D1StartupWrapper,
} from "../../packages/mcp-server/src/alpha3-d1-startup-assistant-v1.mjs";
import {
  ALPHA3_D1_STARTUP_HEALTH_CONTRACT,
  ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY,
  planAlpha3D1StartupHealth,
  summarizeAlpha3D1StartupHealth,
} from "../../packages/mcp-server/src/alpha3-d1-startup-health-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  FakeFoundationBridge,
} from "../../packages/core/src/foundation-bridge-v1.mjs";

describe("Alpha3 D1 startup and connection health", () => {
  it("reports a ready bounded connection when live opt-in, executor, and identity match", () => {
    const plan = planAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
        spawned_reaper: false,
      },
      expected: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      observed: {
        session_id: "session-a",
        owner: "owner-a",
        generation: "4",
      },
      requested: {
        task_id: "observe",
        requires_live: true,
      },
    });

    assert.equal(plan.contract, ALPHA3_D1_STARTUP_HEALTH_CONTRACT);
    assert.equal(plan.ok, true);
    assert.equal(plan.status, "ready");
    assert.equal(plan.mode, "agent_side_plan_only");
    assert.equal(plan.tool_surface.added_tools, 0);
    assert.equal(plan.identity.match.matched, true);
    assert.deepEqual(plan.blockers, []);
    assert.equal(plan.safety.plan_only, true);
    assert.equal(plan.safety.spawned_reaper, false);
    assert.equal(plan.safety.live_reaper_called, false);
    assert.equal(plan.safety.safe_write_called, false);
    assert.equal(plan.safety.raw_execution, false);
    assert.match(plan.next_step, /bounded/);
  });

  it("turns missing opt-in and executor into beginner-readable startup recovery", () => {
    const plan = planAlpha3D1StartupHealth();

    assert.equal(plan.ok, false);
    assert.equal(plan.status, "needs_startup");
    assert.equal(plan.user_message, "OpenReaper is not connected yet.");
    assert.equal(
      plan.blockers.some((blocker) => blocker.code === "LIVE_OPT_IN_MISSING"),
      true,
    );
    assert.equal(
      plan.blockers.some((blocker) => blocker.code === "LIVE_EXECUTOR_MISSING"),
      true,
    );
    assert.equal(plan.recovery_actions[0].id, "ask_user_to_open");
    assert.match(plan.recovery_actions[0].user_action, /Open REAPER\/OpenReaper/);
    assert.equal(plan.recovery_actions[0].no_spawn_reaper, true);
  });

  it("hard-stops stale session identity before live or safe-write calls", () => {
    const plan = planAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "old-session",
        owner: "owner-a",
        generation: 1,
      },
      observed: {
        session_id: "new-session",
        owner: "owner-b",
        generation: 2,
      },
      requested: {
        requires_live: true,
        requires_safe_write: true,
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.status, "stale_session");
    assert.deepEqual(plan.identity.match.mismatches, ["session_id", "owner", "generation"]);
    assert.deepEqual(
      plan.blockers.map((blocker) => blocker.code),
      ["SESSION_IDENTITY_MISMATCH", "BRIDGE_OWNER_MISMATCH", "BRIDGE_GENERATION_MISMATCH"],
    );
    assert.equal(plan.safety.stale_session_guard, true);
    assert.equal(plan.safety.safe_write_called, false);
    assert.equal(plan.recovery_actions[0].id, "reconnect_current_session");
    assert.match(plan.next_step, /Stop before live calls/);
  });

  it("rejects reported automatic REAPER startup instead of hiding it in safety output", () => {
    const plan = planAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: true,
        spawned_reaper: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      observed: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      requested: {
        requires_live: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.status, "blocked");
    assert.equal(plan.safety.spawned_reaper, true);
    assert.equal(
      plan.blockers.some((blocker) => blocker.code === "SPAWNED_REAPER_REJECTED"),
      true,
    );
  });

  it("blocks requested live template ids outside the current bounded allowlist", () => {
    const plan = planAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      observed: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      requested: {
        requires_live: true,
        allowed_template_ids: ["template.transport.play"],
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.status, "blocked");
    assert.equal(
      plan.blockers.some((blocker) => blocker.code === "LIVE_SCOPE_UNKNOWN"),
      true,
    );
    assert.deepEqual(
      plan.blockers.find((blocker) => blocker.code === "LIVE_SCOPE_UNKNOWN").details.missing_requested_template_ids,
      ["template.transport.play"],
    );
  });

  it("treats malformed generation strings as unknown instead of parsing prefixes", () => {
    const plan = planAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      observed: {
        session_id: "session-a",
        owner: "owner-a",
        generation: "4-old",
      },
      requested: {
        requires_live: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.status, "needs_reconnect");
    assert.equal(plan.identity.observed.generation, null);
    assert.equal(
      plan.warnings.some((warning) => warning.id === "generation_match"),
      true,
    );
  });

  it("summarizes health for compact product-surface readback", () => {
    const summary = summarizeAlpha3D1StartupHealth({
      runtime: {
        opted_in: true,
        executor_configured: false,
      },
    });

    assert.equal(summary.contract, ALPHA3_D1_STARTUP_HEALTH_CONTRACT);
    assert.equal(summary.status, "needs_reconnect");
    assert.equal(summary.ok, false);
    assert.deepEqual(summary.blockers, ["LIVE_EXECUTOR_MISSING"]);
    assert.equal(summary.safety.hidden_executor, false);
    assert.equal(summary.safety.public_call_recipe, false);
  });

  it("exposes D1 health guidance through the existing list_templates product surface", () => {
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: ["template.project.read_summary"],
      },
    });
    const menu = runtime.list_templates({ limit: 5 });

    assert.deepEqual(menu.product_surface.startup_health, ALPHA3_D1_STARTUP_HEALTH_DISCOVERY_SUMMARY);
    assert.equal(menu.product_surface.startup_health.tool_surface.added_tools, 0);
    assert.equal(menu.product_surface.startup_health_snapshot.contract, ALPHA3_D1_STARTUP_HEALTH_CONTRACT);
    assert.equal(menu.product_surface.startup_health_snapshot.status, "needs_reconnect");
    assert.equal(menu.product_surface.startup_health_snapshot.safety.spawned_reaper, false);
    assert.equal(menu.product_surface.startup_health_snapshot.safety.live_reaper_called, false);
  });

  it("plans a beginner startup assistant package without starting REAPER", () => {
    const plan = planAlpha3D1StartupAssistant({
      session: {
        run_id: "openreaper-test-run",
        run_root: "/tmp/openreaper-test-run",
        owner: "owner-test",
        generation: "3",
      },
    });

    assert.equal(plan.contract, ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT);
    assert.equal(plan.ok, false);
    assert.equal(plan.status, "prepare_session");
    assert.equal(plan.health.status, "needs_startup");
    assert.equal(plan.session_card.run_id, "openreaper-test-run");
    assert.equal(plan.session_card.owner, "owner-test");
    assert.equal(plan.session_card.generation, 3);
    assert.equal(plan.session_card.paths.requests_dir, "/tmp/openreaper-test-run/transport/requests");
    assert.equal(plan.actions[0].id, "prepare_local_session_card");
    assert.equal(plan.mcp_connection_requirement.user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(plan.mcp_connection_requirement.ordinary_reaper_launch_supported, false);
    assert.equal(plan.safety.opens_reaper, false);
    assert.equal(plan.safety.live_reaper_called, false);
    assert.equal(plan.safety.safe_write_called, false);
    assert.equal(plan.safety.spawned_reaper, false);
    assert.match(plan.user_steps.join("\n"), /Open or restart REAPER/);
    assert.match(plan.agent_next_steps.join("\n"), /Write the session card/);
  });

  it("turns stale health into a reconnect assistant instead of live execution", () => {
    const plan = planAlpha3D1StartupAssistant({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "old-session",
        owner: "owner-a",
        generation: 1,
      },
      observed: {
        session_id: "new-session",
        owner: "owner-b",
        generation: 2,
      },
      requested: {
        requires_live: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
    });

    assert.equal(plan.status, "reconnect_existing");
    assert.equal(plan.health.status, "stale_session");
    assert.equal(plan.safety.requires_user_reaper_action, true);
    assert.deepEqual(
      plan.verification_steps,
      [
        "Check that requests and results directories exist.",
        "Check that the session card owner, generation, session id, and connection folder match the live executor config.",
        "Run startup health again before any live or safe-write call.",
      ],
    );
  });

  it("summarizes the startup assistant for compact product-surface readback", () => {
    const summary = summarizeAlpha3D1StartupAssistant({
      runtime: {
        opted_in: true,
        executor_configured: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
      expected: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      observed: {
        session_id: "session-a",
        owner: "owner-a",
        generation: 4,
      },
      requested: {
        requires_live: true,
        allowed_template_ids: ["template.project.read_summary"],
      },
    });

    assert.equal(summary.contract, ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT);
    assert.equal(summary.status, "ready");
    assert.equal(summary.ok, true);
    assert.equal(summary.helper, "npm run prepare:startup-session");
    assert.equal(summary.launch_helper, "npm run start:openreaper -- --launch");
    assert.equal(summary.mcp_connection_requirement.user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(summary.session_card.env_file_path, "/tmp/openreaper-alpha3-session/reports/openreaper-session.env");
    assert.equal(summary.session_card.openreaper_script_path, "reaper/bridge/openreaper-live-bridge.lua");
    assert.equal(summary.safety.opens_reaper, false);
  });

  it("formats a sourceable env file from a startup session card", () => {
    const card = createAlpha3D1StartupSessionCard({
      run_id: "openreaper-test",
      run_root: "/tmp/openreaper-test",
      bridge_script_path: "/Applications/REAPER Scripts/openreaper-live-bridge.lua",
    });
    const envFile = formatAlpha3D1StartupEnvFile(card);

    assert.match(envFile, /OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR='\/tmp\/openreaper-test\/transport'/);
    assert.match(envFile, /OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH='\/Applications\/REAPER Scripts\/openreaper-live-bridge.lua'/);
    assert.match(envFile, /OPENREAPER_LIVE_BRIDGE_GENERATION='1'/);
  });

  it("plans a one-click startup wrapper evidence route without live execution", () => {
    const plan = planAlpha3D1StartupWrapper({
      run_id: "openreaper-wrapper-test",
      run_root: "/tmp/openreaper-wrapper-test",
      owner: "owner-wrapper",
      generation: "7",
    });

    assert.equal(plan.contract, ALPHA3_D1_STARTUP_WRAPPER_CONTRACT);
    assert.equal(plan.ok, true);
    assert.equal(plan.prepared, true);
    assert.equal(plan.customer_ready, false);
    assert.equal(plan.one_click_live_accepted, true);
    assert.equal(plan.status, "prepare_wrapper");
    assert.equal(plan.evidence_status, "live_evidence_accepted");
    assert.match(plan.customer_claim, /local macOS one-command startup helper is live-accepted/);
    assert.equal(plan.wrapper_plan.wrapper_plan_path, "/tmp/openreaper-wrapper-test/startup-wrapper/openreaper-startup-wrapper-plan.json");
    assert.equal(plan.wrapper_plan.user_owned_execution, true);
    assert.equal(plan.wrapper_plan.generated_files_only, true);
    assert.equal(plan.wrapper_plan.launcher_written, false);
    assert.equal(plan.wrapper_plan.launcher_status, "local_macos_live_accepted");
    assert.equal(plan.wrapper_plan.launch_helper, "npm run start:openreaper -- --launch");
    assert.equal(plan.wrapper_plan.one_command_helper, "npm run start:openreaper -- --install-startup-hook --launch");
    assert.equal(plan.wrapper_plan.one_command_evidence.status, "accepted_local_macos_with_dialog_caveat");
    assert.equal(plan.agent_user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(plan.mcp_connection_requirement.only_openreaper_launch_supported, true);
    assert.equal(plan.safety.opens_reaper_now, false);
    assert.equal(plan.safety.spawns_process_now, false);
    assert.equal(plan.safety.live_reaper_called, false);
    assert.equal(plan.safety.safe_write_called, false);
    assert.equal(plan.safety.requires_bounded_startup_window, true);
    assert.match(plan.bounded_live_prompt, /Forbidden actions: safe-write/);
    assert.match(plan.bounded_live_prompt, /startup health returns ready/);

    const summary = summarizeAlpha3D1StartupWrapper({
      run_id: "openreaper-wrapper-test",
      run_root: "/tmp/openreaper-wrapper-test",
    });
    assert.equal(summary.contract, ALPHA3_D1_STARTUP_WRAPPER_CONTRACT);
    assert.equal(summary.ok, true);
    assert.equal(summary.customer_ready, false);
    assert.equal(summary.one_click_live_accepted, true);
    assert.equal(summary.helper, "npm run prepare:startup-wrapper");
    assert.equal(summary.launch_helper, "npm run start:openreaper -- --launch");
    assert.equal(summary.one_command_helper, "npm run start:openreaper -- --install-startup-hook --launch");
    assert.equal(summary.agent_user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(summary.safety.support_claim_broadened, false);

    const readme = formatAlpha3D1StartupWrapperReadme(plan);
    assert.match(readme, /Start OpenReaper/);
    assert.match(readme, /MCP Startup Requirement/);
    assert.match(readme, /agent wrote local files only; it did not open REAPER, write a launcher/);
  });

  it("prepares a local startup session card without live calls or process spawning", () => {
    const root = mkdtempSync(join(tmpdir(), "openreaper-alpha3-d1-"));
    const output = execFileSync(
      process.execPath,
      [
        "scripts/prepare-alpha3-startup-session.mjs",
        "--run-id=test-session-card",
        `--run-root=${root}`,
        "--owner=owner-test",
        "--generation=2",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
      },
    ).trim();
    const result = JSON.parse(output);

    assert.equal(result.contract, "alpha3.d1.startup_session_prepare_result.v1");
    assert.equal(result.ok, true);
    assert.equal(result.safety.opens_reaper, false);
    assert.equal(result.safety.live_reaper_called, false);
    assert.equal(result.safety.safe_write_called, false);
    assert.equal(existsSync(result.paths.requests_dir), true);
    assert.equal(existsSync(result.paths.results_dir), true);
    assert.equal(existsSync(result.paths.card_path), true);
    assert.equal(existsSync(result.paths.env_file_path), true);

    const card = JSON.parse(readFileSync(result.paths.card_path, "utf8"));
    assert.equal(card.owner, "owner-test");
    assert.equal(card.generation, 2);
    assert.equal(card.env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR, join(root, "transport"));

    const scriptSource = readFileSync(
      new URL("../../scripts/prepare-alpha3-startup-session.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(scriptSource, /child_process|spawn\(|execFile|execSync|open -a|REAPER\.app/);
  });

  it("prepares startup wrapper materials without opening REAPER or spawning a process", () => {
    const root = mkdtempSync(join(tmpdir(), "openreaper-alpha3-d1-wrapper-"));
    const output = execFileSync(
      process.execPath,
      [
        "scripts/prepare-alpha3-startup-wrapper.mjs",
        "--run-id=test-startup-wrapper",
        `--run-root=${root}`,
        "--owner=owner-wrapper",
        "--generation=5",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
      },
    ).trim();
    const result = JSON.parse(output);

    assert.equal(result.contract, "alpha3.d1.startup_wrapper_prepare_result.v1");
    assert.equal(result.ok, true);
    assert.equal(result.prepared, true);
    assert.equal(result.evidence_status, "live_evidence_accepted");
    assert.equal(result.customer_ready, false);
    assert.equal(result.one_click_live_accepted, true);
    assert.match(result.customer_claim, /local macOS one-command startup helper is live-accepted/);
    assert.equal(result.safety.opens_reaper_now, false);
    assert.equal(result.safety.spawns_process_now, false);
    assert.equal(result.safety.live_reaper_called, false);
    assert.equal(result.safety.safe_write_called, false);
    assert.equal(existsSync(result.paths.requests_dir), true);
    assert.equal(existsSync(result.paths.results_dir), true);
    assert.equal(existsSync(result.paths.wrapper_plan_path), true);
    assert.equal(existsSync(result.paths.readme_path), true);

    const wrapperPlan = JSON.parse(readFileSync(result.paths.wrapper_plan_path, "utf8"));
    assert.equal(wrapperPlan.contract, ALPHA3_D1_STARTUP_WRAPPER_CONTRACT);
    assert.equal(wrapperPlan.session_card.owner, "owner-wrapper");
    assert.equal(wrapperPlan.session_card.generation, 5);
    assert.match(readFileSync(result.paths.readme_path, "utf8"), /Agent Evidence Prompt/);

    const scriptSource = readFileSync(
      new URL("../../scripts/prepare-alpha3-startup-wrapper.mjs", import.meta.url),
      "utf8",
    );
    assert.doesNotMatch(scriptSource, /child_process|spawn\(|execFile|execSync|open -a|REAPER\.app/);
  });

  it("prepares a one-command startup helper in dry-run mode without spawning REAPER", () => {
    const root = mkdtempSync(join(tmpdir(), "openreaper-alpha3-start-helper-"));
    const projectPath = join(root, "test-project.RPP");
    writeFileSync(projectPath, "<REAPER_PROJECT 0.1 \"7.0/x64\" 0\n>");
    const output = execFileSync(
      process.execPath,
      [
        "scripts/start-openreaper-alpha3.mjs",
        "--run-id=test-start-openreaper",
        `--run-root=${root}`,
        "--dry-run",
        `--project-path=${projectPath}`,
        "--reaper-binary=/tmp/not-used-reaper",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
      },
    ).trim();
    const result = JSON.parse(output);

    assert.equal(result.contract, "alpha3.d1.start_openreaper_helper_result.v1");
    assert.equal(result.ok, true);
    assert.equal(result.mode, "prepare_only");
    assert.equal(result.dry_run, true);
    assert.equal(result.launched_reaper, false);
    assert.equal(result.spawned_process_now, false);
    assert.equal(result.agent_capability.can_launch_reaper_with_session_env, true);
    assert.equal(result.agent_capability.can_launch_specific_project_with_session_env, true);
    assert.equal(result.agent_capability.must_not_close_reaper_without_explicit_authorization, true);
    assert.equal(result.agent_capability.one_command_with_auto_bridge, "npm run start:openreaper -- --install-startup-hook --launch");
    assert.equal(result.mcp_connection_requirement.user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(result.mcp_connection_requirement.ordinary_reaper_launch_supported, false);
    assert.equal(result.startup_dialog_policy.user_may_need_to_dismiss_dialog, true);
    assert.match(result.startup_dialog_policy.user_reminder, /version, recovery, plugin/);
    assert.equal(result.safety.explicit_launch_required, true);
    assert.equal(result.safety.dry_run_default, true);
    assert.equal(result.safety.safe_write_called, false);
    assert.equal(result.safety.project_mutation, false);
    assert.equal(result.safety.closes_reaper, false);
    assert.equal(result.safety.close_reaper_requires_explicit_user_authorization, true);
    assert.equal(result.safety.bridge_script_auto_run, false);
    assert.equal(result.safety.bridge_script_auto_run_candidate, false);
    assert.equal(result.safety.one_click_live_accepted, true);
    assert.equal(result.startup_hook.status, "not_requested");
    assert.equal(result.target_project.requested, true);
    assert.equal(result.target_project.path, projectPath);
    assert.equal(result.target_project.launch_argument_used, false);
    assert.equal(existsSync(result.paths.env_file_path), true);
    assert.equal(existsSync(result.paths.launcher_command_path), true);

    const launcher = readFileSync(result.paths.launcher_command_path, "utf8");
    assert.match(launcher, /source/);
    assert.match(launcher, /exec/);
    assert.match(launcher, /test-project\.RPP/);
    assert.match(launcher, /OpenReaper MCP can connect only/);
  });

  it("installs a conditional startup hook with backup without launching REAPER", () => {
    const root = mkdtempSync(join(tmpdir(), "openreaper-alpha3-start-hook-"));
    const hookPath = join(root, "__startup.lua");
    writeExistingStartupHook(hookPath);
    const output = execFileSync(
      process.execPath,
      [
        "scripts/start-openreaper-alpha3.mjs",
        "--run-id=test-start-openreaper-hook",
        `--run-root=${root}`,
        "--dry-run",
        "--install-startup-hook",
        `--startup-hook-path=${hookPath}`,
        "--reaper-binary=/tmp/not-used-reaper",
      ],
      {
        cwd: new URL("../..", import.meta.url),
        encoding: "utf8",
      },
    ).trim();
    const result = JSON.parse(output);

    assert.equal(result.ok, true);
    assert.equal(result.launched_reaper, false);
    assert.equal(result.startup_hook.status, "appended_with_backup");
    assert.equal(result.startup_hook.installed, true);
    assert.equal(result.startup_hook.conditional_on_openreaper_env, true);
    assert.equal(existsSync(result.startup_hook.backup_path), true);
    assert.equal(result.safety.conditional_startup_hook_installed, true);
    assert.equal(result.safety.bridge_script_auto_run_candidate, true);
    assert.equal(result.safety.bridge_script_auto_run, false);

    const hook = readFileSync(hookPath, "utf8");
    assert.match(hook, /existing startup/);
    assert.match(hook, /OpenReaper Alpha3 MCP startup hook/);
    assert.match(hook, /OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH/);
    assert.match(hook, /pcall\(dofile, bridge_script\)/);
  });

  it("exposes D1 startup assistant guidance through the existing list_templates product surface", () => {
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: ["template.project.read_summary"],
      },
    });
    const menu = runtime.list_templates({ limit: 5 });

    assert.deepEqual(menu.product_surface.startup_assistant, ALPHA3_D1_STARTUP_ASSISTANT_DISCOVERY_SUMMARY);
    assert.equal(menu.product_surface.startup_assistant.tool_surface.added_tools, 0);
    assert.equal(menu.product_surface.startup_assistant_snapshot.contract, ALPHA3_D1_STARTUP_ASSISTANT_CONTRACT);
    assert.equal(menu.product_surface.startup_assistant_snapshot.status, "reconnect_existing");
    assert.equal(
      menu.product_surface.startup_assistant_snapshot.mcp_connection_requirement.user_reminder,
      ALPHA3_D1_MCP_STARTUP_REQUIREMENT,
    );
    assert.equal(
      menu.product_surface.startup_assistant_snapshot.session_card.env_file_path,
      "/tmp/openreaper-alpha3-session/reports/openreaper-session.env",
    );
    assert.equal(menu.product_surface.startup_assistant_snapshot.safety.opens_reaper, false);
    assert.equal(menu.product_surface.startup_assistant_snapshot.safety.live_reaper_called, false);
  });

  it("exposes D1 startup wrapper guidance through the existing list_templates product surface", () => {
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: new FakeFoundationBridge(),
        allowed_template_ids: ["template.project.read_summary"],
      },
    });
    const menu = runtime.list_templates({ limit: 5 });

    assert.deepEqual(menu.product_surface.startup_wrapper, ALPHA3_D1_STARTUP_WRAPPER_DISCOVERY_SUMMARY);
    assert.equal(menu.product_surface.startup_wrapper.tool_surface.added_tools, 0);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.contract, ALPHA3_D1_STARTUP_WRAPPER_CONTRACT);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.ok, true);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.customer_ready, false);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.one_click_live_accepted, true);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.status, "reconnect_existing");
    assert.equal(menu.product_surface.startup_wrapper_snapshot.evidence_status, "live_evidence_accepted");
    assert.equal(menu.product_surface.startup_wrapper_snapshot.agent_user_reminder, ALPHA3_D1_MCP_STARTUP_REQUIREMENT);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.one_command_helper, "npm run start:openreaper -- --install-startup-hook --launch");
    assert.equal(menu.product_surface.startup_wrapper_snapshot.safety.opens_reaper_now, false);
    assert.equal(menu.product_surface.startup_wrapper_snapshot.safety.spawns_process_now, false);
  });
});

function writeExistingStartupHook(hookPath) {
  const script = [
    "-- existing startup",
    "reaper.ShowConsoleMsg(\"existing startup\\n\")",
    "",
  ].join("\n");
  mkdirSync(dirname(hookPath), { recursive: true });
  writeFileSync(hookPath, script);
}
