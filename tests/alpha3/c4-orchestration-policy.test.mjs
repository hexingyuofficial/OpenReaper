import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C4_BATCH_READBACK_CONTRACT,
  ALPHA3_C4_EXECUTION_DECISIONS,
  ALPHA3_C4_HARD_STOP_DOMAINS,
  ALPHA3_C4_ORCHESTRATION_POLICY_CONTRACT,
  ALPHA3_C4_ORCHESTRATION_POLICY_DISCOVERY_SUMMARY,
  ALPHA3_C4_RISK_DOMAINS,
  createAlpha3C4OrchestrationPlanner,
  planAlpha3C4BatchReadback,
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
