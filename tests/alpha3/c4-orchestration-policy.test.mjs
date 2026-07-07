import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C4_EXECUTION_DECISIONS,
  ALPHA3_C4_HARD_STOP_DOMAINS,
  ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
  ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY,
  ALPHA3_C4_RISK_DOMAINS,
  createAlpha3C4OrchestrationPlanner,
  planAlpha3C4Execution,
} from "../../packages/mcp-server/src/alpha3-c4-orchestration-policy-v1.mjs";

describe("Alpha3 C4 orchestration policy", () => {
  it("plans independent read calls as safe parallel read groups without adding tools", () => {
    const plan = planAlpha3C4Execution({
      calls: [
        { id: "template.project.read_summary" },
        { id: "template.transport.read_state" },
        { id: "template.project.list_markers_regions" },
      ],
    });

    assert.equal(plan.contract, ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT);
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "agent_side_plan_only");
    assert.equal(plan.tool_surface.added_tools, 0);
    assert.deepEqual(plan.tool_surface.execution_tools, ["call_template", "get_state"]);
    assert.equal(plan.safe_parallel_reads.enabled, true);
    assert.deepEqual(plan.safe_parallel_reads.groups, [
      {
        call_indexes: [0, 1, 2],
        template_ids: [
          "template.project.read_summary",
          "template.transport.read_state",
          "template.project.list_markers_regions",
        ],
        execution: "parallel",
      },
    ]);
    assert.equal(plan.calls.every((call) => call.decision === "parallel_read"), true);
    assert.equal(plan.batch_readback.required, false);
  });

  it("keeps dependency-linked reads serial", () => {
    const plan = planAlpha3C4Execution({
      calls: [
        { id: "template.items.resolve_item_ref" },
        { id: "template.items.read_item_summary", depends_on: [0] },
      ],
    });

    assert.equal(plan.calls[0].decision, "parallel_read");
    assert.equal(plan.calls[1].decision, "serial_read");
    assert.equal(plan.calls[1].can_parallelize, false);
    assert.deepEqual(plan.calls[1].depends_on, [0]);
    assert.deepEqual(plan.safe_parallel_reads.groups, [
      {
        call_indexes: [0],
        template_ids: ["template.items.resolve_item_ref"],
        execution: "serial",
      },
    ]);
  });

  it("allows ordinary reversible work to run without repeated prompts inside task authorization", () => {
    const plan = planAlpha3C4Execution({
      authorization: {
        granted: true,
        task_id: "make-basic-session",
        allowed_risk_domains: ["safe_write", "write_project_reversible", "fx_parameter_control"],
      },
      calls: [
        { id: "template.transport.set_time_selection" },
        { id: "template.tracks.create_track" },
        { id: "template.fx.set_fx_parameter_normalized" },
      ],
    });

    assert.equal(plan.authorization.prompt_policy, "ask_once_per_task_and_risk_domain_then_execute_until_boundary");
    assert.equal(plan.authorized_fast_execution.enabled, true);
    assert.equal(plan.authorized_fast_execution.reusable_without_prompt_count, 3);
    assert.equal(plan.authorized_fast_execution.needs_authorization_count, 0);
    assert.equal(plan.authorized_fast_execution.needs_confirmation_count, 0);
    assert.deepEqual(
      plan.calls.map((call) => call.risk_domain),
      ["safe_write", "write_project_reversible", "fx_parameter_control"],
    );
    assert.equal(plan.calls.every((call) => call.decision === "run_without_prompt"), true);
    assert.equal(plan.calls.every((call) => call.requires_user_prompt === false), true);
    assert.equal(plan.batch_readback.required, true);
    assert.deepEqual(plan.batch_readback.call_indexes, [0, 1, 2]);
    assert.deepEqual(plan.batch_readback.evidence_required, [
      "request_id",
      "undo_evidence",
      "canonical_refs",
      "readback_status",
      "typed_blockers",
    ]);
  });

  it("asks once for missing task authorization instead of prompting every safe mutation forever", () => {
    const plan = planAlpha3C4Execution({
      calls: [
        { id: "template.project.create_marker" },
        { id: "template.tracks.create_track" },
      ],
    });

    assert.equal(plan.authorized_fast_execution.enabled, false);
    assert.deepEqual(
      plan.calls.map((call) => call.decision),
      ["requires_task_authorization", "requires_task_authorization"],
    );
    assert.equal(plan.calls.every((call) => call.requires_user_prompt), true);
    assert.match(plan.calls[0].safety_note, /Ask once/);
  });

  it("hard-stops destructive, render/export, hardware, and privacy/download domains even when authorization is broad", () => {
    const plan = planAlpha3C4Execution({
      authorization: {
        granted: true,
        task_id: "too-broad",
        allowed_risk_domains: [
          "safe_write",
          "write_project_reversible",
          "destructive_delete",
          "render_or_export",
          "hardware_io",
          "privacy_sensitive",
          "paid_or_licensed_download",
        ],
      },
      calls: [
        { id: "template.items.delete_item" },
        { id: "template.render.render_selected_item" },
        { id: "template.routing.set_track_hardware_output" },
      ],
    });

    assert.deepEqual(ALPHA3_C4_HARD_STOP_DOMAINS, [
      "render_or_export",
      "destructive_delete",
      "hardware_io",
      "privacy_sensitive",
      "paid_or_licensed_download",
    ]);
    assert.deepEqual(plan.authorization.allowed_risk_domains, [
      "read",
      "safe_write",
      "write_project_reversible",
    ]);
    assert.deepEqual(
      plan.calls.map((call) => call.risk_domain),
      ["destructive_delete", "render_or_export", "hardware_io"],
    );
    assert.equal(plan.calls.every((call) => call.decision === "requires_user_confirmation"), true);
    assert.equal(plan.calls.every((call) => call.requires_user_prompt), true);
    assert.equal(plan.authorized_fast_execution.needs_confirmation_count, 3);
  });

  it("blocks unknown templates before execution planning", () => {
    const plan = planAlpha3C4Execution({
      calls: [
        { id: "template.project.not_real" },
      ],
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.calls[0].decision, "blocked");
    assert.equal(plan.calls[0].reason, "template_not_in_accepted_runtime_catalog");
    assert.equal(plan.calls[0].readback_required, false);
  });

  it("exports stable vocabularies for product and trial-officer checks", () => {
    assert.deepEqual(ALPHA3_C4_EXECUTION_DECISIONS, [
      "parallel_read",
      "serial_read",
      "run_without_prompt",
      "requires_task_authorization",
      "requires_user_confirmation",
      "blocked",
    ]);
    assert.equal(ALPHA3_C4_RISK_DOMAINS.includes("fx_parameter_control"), true);
    assert.equal(ALPHA3_C4_RISK_DOMAINS.includes("privacy_sensitive"), true);
    assert.equal(
      ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY.contract,
      ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
    );
    assert.equal(ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY.tool_surface.added_tools, 0);
    assert.deepEqual(
      ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY.batch_readback.evidence_required,
      ["request_id", "undo_evidence", "canonical_refs", "readback_status", "typed_blockers"],
    );
    assert.equal("executor" in ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY, false);

    const planner = createAlpha3C4OrchestrationPlanner();
    assert.equal(planner.contract, ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT);
    assert.equal(
      planner.plan({ calls: [{ id: "template.project.read_summary" }] }).calls[0].decision,
      "parallel_read",
    );
  });
});
