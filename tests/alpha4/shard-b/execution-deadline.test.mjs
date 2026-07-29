import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
} from "../../../packages/core/src/foundation-bridge-v1.mjs";
import {
  buildTemplateBridgeRequest,
  TEMPLATE_EXECUTION_DEFAULT_DISPATCH_TIMEOUT_MS,
} from "../../../packages/core/src/template-execution-harness-v1.mjs";
import {
  createExecutionDeadline,
  effectiveDispatchTimeoutMs,
  EXECUTION_DEADLINE_MAX_MS,
  normalizeExecutionDeadlineMs,
} from "../../../packages/core/src/execution-deadline-v1.mjs";
import {
  createExecutionPerformance,
  finishExecutionPerformance,
  INTERNAL_EXECUTION_SPEED_GATE_MS,
} from "../../../packages/core/src/execution-performance-v1.mjs";
import {
  createAcceptedOfficialTemplateCatalog,
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha4 execution deadline contract", () => {
  it("keeps an unset deadline transparent and bounds an explicit deadline", () => {
    const controller = new AbortController();
    const passthrough = createExecutionDeadline({ signal: controller.signal });
    assert.equal(passthrough.signal, controller.signal);
    assert.equal(passthrough.deadline_ms, null);
    assert.equal(passthrough.remainingMs(), null);
    passthrough.cleanup();

    assert.equal(normalizeExecutionDeadlineMs(undefined), null);
    assert.equal(normalizeExecutionDeadlineMs(EXECUTION_DEADLINE_MAX_MS), EXECUTION_DEADLINE_MAX_MS);
    assert.throws(() => normalizeExecutionDeadlineMs(0), /deadline_ms/);
    assert.throws(() => normalizeExecutionDeadlineMs(EXECUTION_DEADLINE_MAX_MS + 1), /deadline_ms/);

    const deadline = createExecutionDeadline({ deadlineMs: 30 });
    assert.equal(deadline.deadline_ms, 30);
    assert.equal(effectiveDispatchTimeoutMs(300_000, deadline) <= 30, true);
    deadline.cleanup();
  });

  it("allows a user deadline to shorten the Bridge timeout below a descriptor default", () => {
    const descriptor = createAcceptedOfficialTemplateCatalog().get("template.project.read_summary");
    const request = buildTemplateBridgeRequest({
      descriptor,
      input: descriptor.examples[0]?.input ?? {},
      context: {
        session_id: "deadline-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
      deadlineMs: 25,
    });
    assert.equal(request.timeout_ms, 25);
  });

  it("uses the shared transport safety cap when no user deadline is supplied", () => {
    const descriptor = createAcceptedOfficialTemplateCatalog().get("template.project.read_summary");
    const request = buildTemplateBridgeRequest({
      descriptor,
      input: descriptor.examples[0]?.input ?? {},
      context: {
        session_id: "no-deadline-timeout-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-28T00:00:00.000Z",
      },
    });
    assert.equal(request.timeout_ms, TEMPLATE_EXECUTION_DEFAULT_DISPATCH_TIMEOUT_MS);
    assert.equal(request.timeout_ms > 30_000, true);
  });

  it("fails closed when a Template executor returns after the user deadline", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch(request) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return bridge.dispatch(request);
        },
      },
    });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      context: {
        session_id: "deadline-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
      deadline_ms: 5,
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.request_cancelled, true);
    assert.equal(response.error.details.deadline_exceeded, true);
    assert.equal(response.error.details.zero_write, true);
  });

  it("composes an explicit deadline with the caller AbortSignal", async () => {
    const caller = new AbortController();
    const deadline = createExecutionDeadline({
      deadlineMs: 30,
      signal: caller.signal,
    });
    assert.notEqual(deadline.signal, caller.signal);
    caller.abort(new Error("caller cancelled"));
    assert.equal(deadline.signal.aborted, true);
    deadline.cleanup();
  });

  it("preserves a late mutating Template result as applied_unverified", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch(request) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return bridge.dispatch(request);
        },
      },
    });
    const response = await runtime.call_template({
      id: "template.tracks.create_track",
      input: { name: "Late deadline track" },
      context: {
        session_id: "deadline-mutating-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
      deadline_ms: 5,
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.result_available_after_cancellation, true);
    assert.equal(response.error.details.mutation_truth, "applied_unverified");
    assert.equal(response.error.details.zero_write, false);
    assert.ok(response.result?.readback, JSON.stringify(response));
  });

  it("does not claim a late Template result when the executor returned no result", async () => {
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch() {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return {
            contract: "template.execution.v1",
            ok: false,
            error: { code: "BRIDGE_TIMEOUT", message: "fixture timeout" },
          };
        },
      },
    });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      context: {
        session_id: "deadline-no-result-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
      deadline_ms: 5,
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.details.result_available_after_cancellation, false);
  });

  it("reports a late read-only Macro as not_applied and zero-write", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch(request) {
          await new Promise((resolve) => setTimeout(resolve, 25));
          return bridge.dispatch(request);
        },
      },
    });
    const response = await runtime.call_template({
      id: "macro.project.inspect",
      input: { include: ["project_path"] },
      context: {
        session_id: "macro-deadline-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-28T00:00:00.000Z",
      },
      deadline_ms: 5,
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.request_cancelled, true);
    assert.equal(response.error.details.result_available_after_cancellation, false);
    assert.equal(response.error.details.mutation_truth, "not_applied");
    assert.equal(response.error.details.zero_write, true);
  });

  it("preserves late project-file mutation truth within the Macro response budget", async () => {
    const bridge = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
    const executor = {
      async dispatch(request) {
        if (request.pack?.capability === "project.create_project_tab") {
          await new Promise((resolve) => setTimeout(resolve, 250));
        }
        const response = structuredClone(bridge.dispatch(request));
        if (request.operation?.name === "project.list_open_projects") {
          response.result = {
            ...response.result,
            readback: {
              projects: [{
                project_ref: "project:tab:1",
                active: true,
                saved: false,
                path_state: "unsaved_project",
                name: "Fixture",
                path: "",
                path_truncated: false,
                dirty: false,
                raw_dirty_state: 0,
                tab_index: 0,
              }],
              total_count: 1,
              returned_count: 1,
              cursor: 0,
              next_cursor: null,
              coverage_status: "complete",
              truncated: false,
            },
          };
        }
        return response;
      },
    };
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const response = await runtime.call_template({
      id: "macro.project.file",
      input: {
        operation: "create_project_tab",
        name: "Deadline fixture",
        target_path: "/tmp/openreaper-project-file-deadline.RPP",
        overwrite: true,
        copy_active_project_settings: false,
      },
      context: {
        session_id: "deadline-project-file",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-29T00:00:00.000Z",
      },
      deadline_ms: 100,
    });

    assert.equal(response.contract, "macro.execution.v1", JSON.stringify(response));
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.deadline_exceeded, true);
    assert.equal(response.error.details.result_available_after_cancellation, false);
    assert.equal(response.error.details.mutation_truth, "unknown");
    assert.equal(response.error.details.zero_write, false);
    assert.equal(response.blockers.length, 1);
    assert.equal(response.budget.actual_bytes, Buffer.byteLength(JSON.stringify(response)));
    assert.equal(response.budget.actual_bytes <= response.budget.max_bytes, true);
  });

  it("fails closed when Project Index artifact post-processing returns after the user deadline", async () => {
    const fake = new FakeFoundationBridge({ owner: "artifact-deadline-owner", generation: 1 });
    let artifactObserved = 0;
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: {
          dispatch(request) {
            const response = structuredClone(fake.dispatch(request));
            response.result = {
              ...response.result,
              summary: {
                artifact_ref: "artifact:test:deadline",
                project_ref: "project:test:deadline",
                track_count: 0,
                track_cursor: 0,
                returned_track_count: 0,
                map_truncated: false,
              },
              readback: {
                artifact_ref: "artifact:test:deadline",
                project_ref: "project:test:deadline",
              },
            };
            return response;
          },
        },
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
      projectIndexRuntime: {
        identity: {
          project_ref: "project:test:deadline",
          bridge_owner: "artifact-deadline-owner",
          bridge_generation: 1,
          session_id: "artifact-deadline-session",
        },
        observeSuccessfulTemplateExecution() {
          return {
            ok: false,
            blockers: [{
              code: "ARTIFACT_PAYLOAD_REQUIRED",
              details: { artifact_refs: ["artifact:test:deadline"] },
            }],
          };
        },
        observeArtifactPayload() {
          artifactObserved += 1;
          return { ok: true };
        },
      },
      projectIndexArtifactReader: async () => {
        await new Promise((resolve) => setTimeout(resolve, 40));
        return { payload: { project_ref: "project:test:deadline" } };
      },
    });
    const response = await runtime.call_template({
      id: "template.project.create_observation_bundle",
      input: {
        max_tracks: 1,
        max_items_per_track: 0,
        max_selected_items: 0,
        track_cursor: 0,
        marker_region_limit: 1,
        tempo_marker_limit: 1,
        include_transport: true,
        include_track_items: false,
      },
      context: {
        session_id: "artifact-deadline-session",
        expected_owner: "artifact-deadline-owner",
        expected_generation: 1,
        created_at: "2026-07-28T00:00:00.000Z",
      },
      deadline_ms: 20,
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.deadline_exceeded, true);
    assert.equal(artifactObserved, 0);
  });

  it("keeps the public Macro performance envelope on a typed blocker", async () => {
    const runtime = createCallTemplateRuntime();
    const response = await runtime.call_template({
      id: "macro.controls.set",
      input: { target_kind: "track", fields: { volume_db: -6 } },
    });

    assert.equal(response.contract, "macro.execution.v1", JSON.stringify(response));
    assert.equal(response.ok, false);
    assert.equal(response.performance.contract, "openreaper.execution_performance.v1");
    assert.equal(response.performance.gate_mode, "internal_acceptance_only");
    assert.equal(response.performance.runtime_cancellation, false);
  });

  it("exposes the internal performance gate without turning it into runtime cancellation", async () => {
    const under = createExecutionPerformance();
    finishExecutionPerformance(under, INTERNAL_EXECUTION_SPEED_GATE_MS - 1);
    assert.equal(under.gate_ok, true);
    const at = createExecutionPerformance();
    finishExecutionPerformance(at, INTERNAL_EXECUTION_SPEED_GATE_MS);
    assert.equal(at.gate_ok, false);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({ executor: bridge });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      context: {
        session_id: "performance-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.performance.contract, "openreaper.execution_performance.v1");
    assert.equal(response.performance.gate_ms, INTERNAL_EXECUTION_SPEED_GATE_MS);
    assert.equal(response.performance.gate_mode, "internal_acceptance_only");
    assert.equal(response.performance.runtime_cancellation, false);
    assert.equal(response.performance.counters.transport_call_count, 1);
    assert.equal(response.performance.counters.readback_count, 1);
    assert.equal(response.performance.gate_ok, true);
  });

  it("maps bridge batch timings and counters into the shared performance envelope", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch(request, context) {
          const result = await bridge.dispatch(request, context);
          return {
            ...result,
            result: {
              ...result.result,
              summary: {
            batch_timings: {
              preflight_ms: 2,
              transport_ms: 3,
              mutation_ms: 4,
              readback_ms: 5,
              evidence_ms: 6,
              native_mutation_count: 8,
              native_readback_count: 8,
              chunks: 2,
              jobs: 1,
            },
              },
            },
          };
        },
      },
    });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      context: {
        session_id: "performance-batch-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-27T00:00:00.000Z",
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.performance.phase_timings_ms.live_preflight, 2);
    assert.equal(response.performance.phase_timings_ms.transport, 3);
    assert.equal(response.performance.phase_timings_ms.mutation, 4);
    assert.equal(response.performance.phase_timings_ms.native_mutation, 4);
    assert.equal(response.performance.phase_timings_ms.readback, 5);
    assert.ok(response.performance.phase_timings_ms.evidence >= 6);
    assert.equal(response.performance.counters.native_mutation_count, 8);
    assert.equal(response.performance.counters.readback_count, 8);
    assert.equal(response.performance.counters.batch_count, 2);
    assert.equal(response.performance.counters.job_count, 1);
  });
});
