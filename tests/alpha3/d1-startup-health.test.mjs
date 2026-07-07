import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
