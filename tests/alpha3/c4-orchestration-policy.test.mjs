import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C4_BATCH_READBACK_CONTRACT,
  ALPHA3_C4_EXECUTION_DECISIONS,
  ALPHA3_C4_HARD_STOP_DOMAINS,
  ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
  ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY,
  ALPHA3_C4_PRODUCT_FLOW_CONTRACT,
  ALPHA3_C4_RECOVERY_PLAN_CONTRACT,
  ALPHA3_C4_RISK_DOMAINS,
  ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
  createAlpha3C4OrchestrationPlanner,
  planAlpha3C4BatchReadback,
  planAlpha3C4Execution,
  planAlpha3C4ProductFlow,
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
    assert.equal(plan.safe_parallel_reads.contract, ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT);
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
    assert.deepEqual(plan.execution_schedule, {
      contract: ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
      mode: "plan_only_call_template_schedule",
      tool_surface: {
        added_tools: 0,
        execution_tool: "call_template",
        artifact_tool: "get_state",
      },
      phases: [
        {
          kind: "parallel_read_group",
          execution: "parallel",
          call_indexes: [0, 1, 2],
          template_ids: [
            "template.project.read_summary",
            "template.transport.read_state",
            "template.project.list_markers_regions",
          ],
          requests: [
            { id: "template.project.read_summary", input: {}, refs: {} },
            { id: "template.transport.read_state", input: {}, refs: {} },
            { id: "template.project.list_markers_regions", input: {}, refs: {} },
          ],
          stop_before: false,
          evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
        },
      ],
      summary: {
        phase_count: 1,
        parallel_phase_count: 1,
        serial_phase_count: 0,
        stop_phase_count: 0,
        request_count: 3,
      },
      rule: "Execute parallel_read phases concurrently only when the caller can preserve per-call request/response evidence; all writes, prompts, hard stops, blockers, and dependency-linked reads stay serial.",
    });
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
    assert.deepEqual(
      plan.execution_schedule.phases.map((phase) => phase.kind),
      ["authorized_mutation", "authorized_mutation", "authorized_mutation"],
    );
    assert.equal(plan.execution_schedule.summary.serial_phase_count, 3);
    assert.equal(plan.execution_schedule.summary.stop_phase_count, 0);
    assert.equal(plan.batch_readback.required, true);
    assert.equal(plan.batch_readback.contract, ALPHA3_C4_BATCH_READBACK_CONTRACT);
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
    assert.deepEqual(
      plan.execution_schedule.phases.map((phase) => phase.execution),
      ["stop_for_task_authorization", "stop_for_task_authorization"],
    );
    assert.equal(plan.execution_schedule.summary.stop_phase_count, 2);
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
    assert.deepEqual(
      plan.execution_schedule.phases.map((phase) => phase.kind),
      ["hard_stop_confirmation", "hard_stop_confirmation", "hard_stop_confirmation"],
    );
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
    assert.equal(plan.execution_schedule.phases[0].kind, "blocked");
    assert.equal(plan.execution_schedule.phases[0].execution, "blocked");
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
    assert.equal(
      ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY.safe_parallel_reads.contract,
      ALPHA3_C4_SAFE_PARALLEL_EXECUTION_CONTRACT,
    );
    assert.equal(ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY.safe_parallel_reads.schedule_field, "execution_schedule");
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

  it("plans concrete batch readback requests for common reversible mutations", () => {
    const readback = planAlpha3C4BatchReadback({
      mutations: [
        {
          id: "template.tracks.create_track",
          input: { name: "Vox" },
          result_refs: { track_ref: "track:guid:{TRACK-A}" },
        },
        {
          id: "template.items.move_item",
          input: { position_seconds: 1.25 },
          refs: { item_ref: "item:guid:{ITEM-A}" },
        },
        {
          id: "template.transport.set_time_selection",
          input: { start_seconds: 1, end_seconds: 5 },
        },
        {
          id: "template.project.create_marker",
          input: { name: "Hook", position_seconds: 12 },
          result_refs: { marker_ref: "marker:guid:{MARKER-A}" },
        },
        {
          id: "template.fx.set_fx_parameter_normalized",
          input: { param_index: 3, normalized_value: 0.42 },
          refs: {
            fx_ref: "fx:track:{TRACK-A}:0",
            track_ref: "track:guid:{TRACK-A}",
          },
        },
      ],
    });

    assert.equal(readback.contract, ALPHA3_C4_BATCH_READBACK_CONTRACT);
    assert.equal(readback.ok, true);
    assert.equal(readback.tool_surface.added_tools, 0);
    assert.equal(readback.tool_surface.readback_tool, "call_template");
    assert.deepEqual(
      readback.requests.map((request) => request.call_template.id),
      [
        "template.tracks.read_mixer_controls",
        "template.items.read_item_summary",
        "template.transport.read_state",
        "template.project.list_markers_regions",
        "template.fx.read_fx_parameter",
      ],
    );
    assert.deepEqual(readback.requests[0].call_template.refs, { track_ref: "track:guid:{TRACK-A}" });
    assert.deepEqual(readback.requests[1].call_template.input, { include_take_summary: true });
    assert.deepEqual(readback.requests[3].call_template.input, {
      include_markers: true,
      include_regions: false,
      limit: 100,
    });
    assert.deepEqual(readback.requests[4].call_template.input, { param_index: 3 });
    assert.deepEqual(readback.requests[4].call_template.refs, {
      fx_ref: "fx:track:{TRACK-A}:0",
      track_ref: "track:guid:{TRACK-A}",
    });
    assert.equal(readback.coverage.status, "covered");
    assert.equal(readback.coverage.readback_request_count, 5);
    assert.deepEqual(readback.blockers, []);
  });

  it("plans a product flow with one task authorization prompt and deferred batch readback", () => {
    const flow = planAlpha3C4ProductFlow({
      task: {
        id: "prep-recording",
        label: "Prepare a recording track",
        intent: "Create, arm, and verify one new track",
      },
      calls: [
        { id: "template.project.read_summary" },
        { id: "template.tracks.create_track", input: { name: "Vocal" } },
        { id: "template.tracks.set_record_arm", refs: { track_ref: "track:pending:new" }, depends_on: [1] },
      ],
    });

    assert.equal(flow.contract, ALPHA3_C4_PRODUCT_FLOW_CONTRACT);
    assert.equal(flow.ok, true);
    assert.equal(flow.mode, "plan_only_agent_product_flow");
    assert.equal(flow.tool_surface.added_tools, 0);
    assert.deepEqual(flow.task, {
      id: "prep-recording",
      label: "Prepare a recording track",
      intent: "Create, arm, and verify one new track",
    });
    assert.equal(flow.authorization_prompt.kind, "task_authorization");
    assert.equal(flow.authorization_prompt.one_prompt_only, true);
    assert.deepEqual(flow.authorization_prompt.allowed_risk_domains, ["write_project_reversible"]);
    assert.deepEqual(flow.authorization_prompt.allowed_risk_labels, ["reversible project edits"]);
    assert.match(flow.authorization_prompt.message, /without repeated prompts/);
    assert.match(flow.authorization_prompt.message, /reversible project edits/);
    assert.match(flow.authorization_prompt.message, /batch-read back/);
    assert.doesNotMatch(flow.authorization_prompt.message, /write_project_reversible/);
    assert.deepEqual(
      flow.flow_steps.map((step) => step.id),
      ["discover", "authorize", "execute", "batch_readback", "report"],
    );
    assert.equal(flow.execution_schedule.phases[0].execution, "serial");
    assert.deepEqual(
      flow.execution_schedule.phases.slice(1).map((phase) => phase.execution),
      ["stop_for_task_authorization", "stop_for_task_authorization"],
    );
    assert.equal(flow.batch_readback.status, "pending_mutation_refs");
    assert.deepEqual(flow.batch_readback.expected_template_ids, [
      "template.tracks.create_track",
      "template.tracks.set_record_arm",
    ]);
    assert.equal(flow.recovery_plan.contract, ALPHA3_C4_RECOVERY_PLAN_CONTRACT);
    assert.equal(flow.recovery_plan.status, "needs_recovery");
    assert.equal(flow.recovery_plan.success_wording_allowed, false);
    assert.deepEqual(
      flow.recovery_plan.actions.map((action) => action.id),
      ["collect_mutation_refs"],
    );
    assert.match(flow.recovery_plan.actions[0].next_step, /plan batch readback/);
    assert.deepEqual(flow.batch_readback.expected_result_refs, [
      {
        call_index: 1,
        template_id: "template.tracks.create_track",
        expected_ref_kinds: ["track_ref"],
      },
      {
        call_index: 2,
        template_id: "template.tracks.set_record_arm",
        expected_ref_kinds: ["track_ref"],
      },
    ]);
  });

  it("plans an already-authorized product flow with concrete batch readback requests", () => {
    const flow = planAlpha3C4ProductFlow({
      authorization: {
        granted: true,
        task_id: "mix-pass",
        allowed_risk_domains: ["write_project_reversible", "fx_parameter_control"],
      },
      calls: [
        {
          id: "template.tracks.rename_track",
          input: { name: "Lead Vox" },
          refs: { track_ref: "track:guid:{TRACK-A}" },
        },
        {
          id: "template.fx.set_fx_parameter_normalized",
          input: { param_index: 2, normalized_value: 0.2 },
          refs: {
            track_ref: "track:guid:{TRACK-A}",
            fx_ref: "fx:track:{TRACK-A}:0",
          },
        },
      ],
      mutations: [
        {
          id: "template.tracks.rename_track",
          input: { name: "Lead Vox" },
          refs: { track_ref: "track:guid:{TRACK-A}" },
        },
        {
          id: "template.fx.set_fx_parameter_normalized",
          input: { param_index: 2, normalized_value: 0.2 },
          refs: {
            track_ref: "track:guid:{TRACK-A}",
            fx_ref: "fx:track:{TRACK-A}:0",
          },
        },
      ],
    });

    assert.equal(flow.ok, true);
    assert.equal(flow.authorization_prompt.needed, false);
    assert.equal(flow.authorization_prompt.kind, "already_authorized");
    assert.deepEqual(flow.authorization_prompt.allowed_risk_labels, [
      "reversible project edits",
      "plugin parameter changes",
    ]);
    assert.deepEqual(
      flow.execution_schedule.phases.map((phase) => phase.kind),
      ["authorized_mutation", "authorized_mutation"],
    );
    assert.equal(flow.batch_readback.contract, ALPHA3_C4_BATCH_READBACK_CONTRACT);
    assert.equal(flow.batch_readback.coverage.status, "covered");
    assert.deepEqual(
      flow.batch_readback.requests.map((request) => request.call_template.id),
      ["template.tracks.read_mixer_controls", "template.fx.read_fx_parameter"],
    );
    assert.deepEqual(
      flow.flow_steps.map((step) => step.id),
      ["discover", "execute", "batch_readback", "report"],
    );
    assert.equal(flow.recovery_plan.status, "clear");
    assert.equal(flow.recovery_plan.success_wording_allowed, true);
    assert.match(flow.report_policy, /claim success only/);
  });

  it("keeps hard-stop product prompts beginner-readable while retaining machine domains", () => {
    const flow = planAlpha3C4ProductFlow({
      authorization: {
        granted: true,
        task_id: "dangerous-task",
        allowed_risk_domains: ["destructive_delete", "render_or_export"],
      },
      calls: [
        { id: "template.items.delete_item", refs: { item_ref: "item:guid:{ITEM-A}" } },
        { id: "template.render.render_selected_item" },
      ],
    });

    assert.equal(flow.authorization_prompt.kind, "hard_stop_confirmation");
    assert.deepEqual(flow.authorization_prompt.hard_stop_domains, [
      "destructive_delete",
      "render_or_export",
    ]);
    assert.deepEqual(flow.authorization_prompt.hard_stop_labels, [
      "deleting project content",
      "rendering or exporting files",
    ]);
    assert.match(flow.authorization_prompt.message, /deleting project content/);
    assert.match(flow.authorization_prompt.message, /rendering or exporting files/);
    assert.doesNotMatch(flow.authorization_prompt.message, /destructive_delete|render_or_export/);
    assert.equal(flow.recovery_plan.status, "needs_recovery");
    assert.equal(flow.recovery_plan.success_wording_allowed, false);
    assert.equal(flow.recovery_plan.actions[0].id, "confirm_hard_stop");
    assert.match(flow.recovery_plan.actions[0].next_step, /explicit confirmation/);
  });

  it("gives a beginner-readable recovery plan for partial or blocked readback", () => {
    const flow = planAlpha3C4ProductFlow({
      authorization: {
        granted: true,
        task_id: "move-item",
        allowed_risk_domains: ["write_project_reversible"],
      },
      calls: [
        { id: "template.items.move_item", input: { position_seconds: 2 } },
      ],
      mutations: [
        { id: "template.items.move_item", input: { position_seconds: 2 } },
      ],
    });

    assert.equal(flow.ok, false);
    assert.equal(flow.batch_readback.coverage.status, "blocked");
    assert.equal(flow.recovery_plan.status, "needs_recovery");
    assert.equal(flow.recovery_plan.success_wording_allowed, false);
    assert.deepEqual(
      flow.recovery_plan.actions.map((action) => action.id),
      ["repair_readback_coverage"],
    );
    assert.match(flow.recovery_plan.actions[0].user_message, /could not verify every change/);
    assert.match(flow.recovery_plan.actions[0].next_step, /refreshed refs/);
    assert.equal(flow.recovery_plan.actions[0].evidence.blockers[0].code, "READBACK_TARGET_REF_MISSING");
  });

  it("deduplicates repeated readback requests and returns typed blockers for missing canonical refs", () => {
    const readback = planAlpha3C4BatchReadback({
      mutations: [
        {
          id: "template.tracks.rename_track",
          input: { name: "Lead" },
          refs: { track_ref: "track:guid:{TRACK-A}" },
        },
        {
          id: "template.tracks.set_mute",
          input: { muted: true },
          refs: { track_ref: "track:guid:{TRACK-A}" },
        },
        {
          id: "template.items.move_item",
          input: { position_seconds: 2 },
        },
      ],
    });

    assert.equal(readback.ok, false);
    assert.equal(readback.coverage.status, "partial");
    assert.deepEqual(
      readback.requests.map((request) => request.call_template.id),
      ["template.tracks.read_mixer_controls"],
    );
    assert.equal(readback.blockers.length, 1);
    assert.equal(readback.blockers[0].code, "READBACK_TARGET_REF_MISSING");
    assert.match(readback.blockers[0].message, /Item\/take readback needs an item ref/);
  });

  it("blocks unknown or currently unmapped readback targets without guessing", () => {
    const readback = planAlpha3C4BatchReadback({
      mutations: [
        {
          id: "template.project.not_real",
        },
        {
          id: "template.routing.set_send_volume",
          input: { volume_db: -6 },
          refs: { send_ref: "send:track:{TRACK-A}:0" },
        },
      ],
    });

    assert.equal(readback.ok, false);
    assert.equal(readback.coverage.status, "blocked");
    assert.deepEqual(
      readback.blockers.map((blocker) => blocker.code),
      ["READBACK_TEMPLATE_UNKNOWN", "READBACK_TARGET_REF_MISSING"],
    );
    assert.match(readback.blockers[1].message, /owner track ref/);
  });
});
