import assert from "node:assert/strict";
import { describe, it } from "node:test";
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

describe("Alpha3 Block2 startup and connection readiness", () => {
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
    const productSurface = runtime.list_templates().product_surface;

    assert.deepEqual(
      productSurface.startup_readiness,
      ALPHA3_BLOCK2_STARTUP_READINESS_DISCOVERY_SUMMARY,
    );
    assert.equal(productSurface.startup_readiness.tool_surface.added_tools, 0);
    assert.equal(productSurface.startup_readiness_snapshot.contract, ALPHA3_BLOCK2_STARTUP_READINESS_CONTRACT);
    assert.equal(productSurface.startup_readiness_snapshot.status, "ready_for_startup_gate");
    assert.equal(productSurface.startup_readiness_snapshot.truth_boundary.one_click_live_accepted, true);
    assert.equal(productSurface.startup_readiness_snapshot.truth_boundary.one_click_scope, "local_macos_with_startup_dialog_caveat");
    assert.equal(productSurface.startup_readiness_snapshot.safety.opens_reaper, false);
    assert.equal(productSurface.startup_readiness_snapshot.safety.live_reaper_called, false);
  });
});
