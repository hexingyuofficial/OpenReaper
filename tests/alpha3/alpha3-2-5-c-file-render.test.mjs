import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2_5_C_FILE_MACRO_REGISTRY,
  executeAlpha3_2_5CProjectFileMacro,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import {
  ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY,
  executeAlpha3_2_5CRenderTargetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-render-targets-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const now = () => new Date("2026-07-12T00:00:00.000Z");
const managedRenderRoot = "/managed/renders";

function atomicExecution(result = {}, ok = true, requestId = null) {
  return { contract: "template.execution.v1", ok, ...(requestId ? { request: { id: requestId } } : {}), result, error: ok ? null : { code: "ATOMIC_FAILED", message: "atomic failed" } };
}

function verifiedRenderResult(overrides = {}) {
  const manifestRef = "artifact:render:manifest";
  const evidenceRef = "artifact:render:evidence";
  const jobRef = "job:job_id:render.targets.test";
  return {
    ...overrides,
    data: {
      job_ref: jobRef,
      output_artifact_ref: manifestRef,
      evidence_artifact_ref: evidenceRef,
      file_count: 1,
      outputs: [{ absolute_path: "/managed/renders/trial.wav", size: 4096, extension: "wav", requested_format: "wav", actual_format: "wav", target_identity: "whole_project" }],
      ...overrides.data,
    },
    refs: overrides.refs ?? [
      { kind: "artifact", ref: manifestRef },
      { kind: "artifact", ref: evidenceRef },
      { kind: "job", ref: jobRef },
    ],
    artifacts: overrides.artifacts ?? [{ kind: "artifact", ref: manifestRef }, { kind: "artifact", ref: evidenceRef }],
    jobs: overrides.jobs ?? [{ kind: "job", ref: jobRef }],
    verification: Object.hasOwn(overrides, "verification")
      ? overrides.verification
      : { status: "passed", evidence_refs: [evidenceRef] },
  };
}

function assertExecutableRenderEnvelope(response) {
  const serialized = JSON.stringify(response);
  for (const forbidden of ["plan_only", "agent_executed_child", "bound_plan_only_child_route"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(response.result.data.preview.runtime_binding, "server_executed_registered_route");
}

describe("Alpha3.2.5-C executable file/render Macros", () => {
  it("registers exactly the two fixed executable programs", () => {
    assert.deepEqual(ALPHA3_2_5_C_FILE_MACRO_REGISTRY.ids, ["macro.project.file"]);
    assert.deepEqual(ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY.ids, ["macro.render.targets"]);
    for (const entry of [...ALPHA3_2_5_C_FILE_MACRO_REGISTRY.entries, ...ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY.entries]) {
      assert.equal(entry.contract, "macro.program.registry.v1");
      assert.equal(entry.implementation_status, "executable");
      assert.equal(entry.stages.every((stage) => stage.stop_on_error), true);
      assert.equal(entry.dependencies.template_ids.length > 0, true);
    }
  });

  it("allocates a unique bridge request identity for repeated identical dependencies inside one Macro", async () => {
    const requests = [];
    const fake = new FakeFoundationBridge({ owner: "owner-test", generation: 1 });
    let saved = false;
    const executor = {
      dispatch(request) {
        requests.push(structuredClone(request));
        const response = structuredClone(fake.dispatch(request));
        if (request.operation.name === "project.read_current_project_path") {
          response.result.summary = {
            has_project_path: true,
            path_state: "saved_project",
            path: "/tmp/current.RPP",
          };
        } else if (request.operation.name === "project.read_dirty_state") {
          response.result.summary = saved
            ? { raw_dirty_state: 0, dirty_state: "clean", dirty: false }
            : { raw_dirty_state: 1, dirty_state: "dirty", dirty: true };
        } else if (request.pack.capability === "project.save_current_project") {
          saved = true;
          response.result.summary = { saved: true };
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
      input: { operation: "save_current" },
      context: {
        client_id: "macro-child-id-test",
        session_id: "macro-child-id-test",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-12T00:00:00.000Z",
        request_sequence: 1,
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(requests.length, 5);
    assert.equal(new Set(requests.map((request) => request.id)).size, requests.length);
    assert.equal(new Set(requests.map((request) => request.created_at)).size, requests.length);
  });

  it("executes save_as serially and verifies exact path and clean dirty state", async () => {
    const calls = [];
    const rebinds = [];
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-1", input: { operation: "save_as", target_path: "/tmp/trial.RPP", overwrite: true, dry_run: false } },
      now,
      executeAtomic: async ({ id, input }) => {
        calls.push({ id, input });
        if (id === "template.project.read_current_project_path") {
          return atomicExecution({ readback: calls.length > 3
            ? { has_project_path: true, path_state: "saved_project", path: "/tmp/trial.RPP" }
            : { has_project_path: false, path_state: "unsaved_project", path: "" } }, true, `child-${calls.length}`);
        }
        if (id === "template.project.read_dirty_state") return atomicExecution({ readback: calls.length === 2
          ? { raw_dirty_state: 1, dirty_state: "dirty", dirty: true }
          : { raw_dirty_state: 0, dirty_state: "clean", dirty: false } }, true, `child-${calls.length}`);
        return atomicExecution({ summary: { saved: true }, changes: [{ kind: "project_file", action: "save_as" }] }, true, `child-${calls.length}`);
      },
      projectIndexRuntime: {
        status: () => ({
          lifecycle: "ready",
          project_ref: rebinds.length === 0 ? "project:path:/tmp/original.RPP" : "project:path:/tmp/trial.RPP",
          project_path: rebinds.length === 0 ? "/tmp/original.RPP" : "/tmp/trial.RPP",
          session_id: rebinds.length === 0 ? "session:old" : "session:new",
        }),
        async rebindProjectIdentity(input) {
          rebinds.push(input);
          return {
            ok: true,
            status: "identity_rebound",
            project_ref: "project:path:/tmp/trial.RPP",
            project_path: "/tmp/trial.RPP",
            session_id: "session:new",
            db_path: "/state/new.sqlite",
            scopes: ["project_head", "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media"],
            snapshot_id: null,
            revision: null,
            old_rows_migrated: false,
          };
        },
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.execution.status, "completed");
    assert.deepEqual(calls.map(({ id }) => id), [
      "template.project.read_current_project_path",
      "template.project.read_dirty_state",
      "template.project.save_project_as",
      "template.project.read_current_project_path",
      "template.project.read_dirty_state",
    ]);
    assert.equal(response.result.data.path_after, "/tmp/trial.RPP");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
    assert.deepEqual(rebinds, [{
      project_path: "/tmp/trial.RPP",
      expected_previous_project_ref: "project:path:/tmp/original.RPP",
      observed_at: "2026-07-12T00:00:00.000Z",
    }]);
    assert.equal(response.result.data.index_update.project_ref, "project:path:/tmp/trial.RPP");
    assert.equal(response.result.data.index_update.project_path, "/tmp/trial.RPP");
    assert.equal(response.result.data.index_update.old_rows_migrated, false);
    assert.deepEqual(response.result.verification.evidence_refs, ["child-1", "child-2", "child-3", "child-4", "child-5"]);
    assert.deepEqual(response.execution.stages.at(-1).evidence_refs, response.result.verification.evidence_refs);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("keeps an exact verified save applied when only Project Index maintenance fails", async () => {
    let pathReads = 0;
    let dirtyReads = 0;
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-index-fail", input: { operation: "save_as", target_path: "/tmp/trial-index-fail.RPP", overwrite: true, dry_run: false } },
      now,
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_current_project_path") {
          pathReads += 1;
          return atomicExecution({ readback: pathReads === 1
            ? { has_project_path: true, path_state: "saved_project", path: "/tmp/original.RPP" }
            : { has_project_path: true, path_state: "saved_project", path: "/tmp/trial-index-fail.RPP" } });
        }
        if (id === "template.project.read_dirty_state") {
          dirtyReads += 1;
          return atomicExecution({ readback: dirtyReads === 1
            ? { raw_dirty_state: 1, dirty_state: "dirty", dirty: true }
            : { raw_dirty_state: 0, dirty_state: "clean", dirty: false } });
        }
        return atomicExecution({ summary: { saved: true } });
      },
      projectIndexRuntime: {
        status: () => ({ lifecycle: "degraded" }),
        rebindProjectIdentity: ({ project_path }) => ({
          ok: false,
          scopes: [],
          project_path,
          blockers: [{ code: "RUNTIME_NOT_OPEN", message: "Project Index runtime did not open.", recoverable: true }],
        }),
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "RUNTIME_NOT_OPEN");
    assert.equal(response.result.verification.status, "passed");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "failed");
    assert.equal(response.result.data.path_after, "/tmp/trial-index-fail.RPP");
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "failed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("fails Save As truthfully after verified live readback when Project Index is not configured", async () => {
    let pathReads = 0;
    let dirtyReads = 0;
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-no-index", input: { operation: "save_as", target_path: "/tmp/trial-no-index.RPP", overwrite: true } },
      now,
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_current_project_path") {
          pathReads += 1;
          return atomicExecution({ readback: pathReads === 1
            ? { has_project_path: true, path_state: "saved_project", path: "/tmp/original.RPP" }
            : { has_project_path: true, path_state: "saved_project", path: "/tmp/trial-no-index.RPP" } });
        }
        if (id === "template.project.read_dirty_state") {
          dirtyReads += 1;
          return atomicExecution({ readback: dirtyReads === 1
            ? { raw_dirty_state: 1, dirty_state: "dirty", dirty: true }
            : { raw_dirty_state: 0, dirty_state: "clean", dirty: false } });
        }
        return atomicExecution({ summary: { saved: true } });
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "PROJECT_INDEX_REBIND_UNAVAILABLE");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "failed");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("does not promote a post-mutation child zero-write into a Macro zero-write", async () => {
    let pathReads = 0;
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-postflight-bridge-gap", input: { operation: "save_as", target_path: "/tmp/postflight-gap.RPP", overwrite: true } },
      now,
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_current_project_path") {
          pathReads += 1;
          if (pathReads === 1) return atomicExecution({ readback: { has_project_path: true, path_state: "saved_project", path: "/tmp/original.RPP" } });
          return {
            contract: "template.execution.v1",
            ok: false,
            error: {
              code: "BRIDGE_NOT_RUNNING",
              message: "Live bridge is not ready for request dispatch.",
              details: { blocker: "bridge_action_not_running", zero_write: true },
            },
          };
        }
        if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { raw_dirty_state: 1, dirty_state: "dirty", dirty: true } });
        return atomicExecution({ summary: { saved: true } });
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "BRIDGE_NOT_RUNNING");
    assert.notEqual(response.error.details.zero_write, true);
    assert.equal(response.error.details.outcome, "unknown");
    assert.equal(response.blockers[0].recoverable, false);
    assert.equal(response.result.data.zero_write, false);
    assert.equal(response.result.data.outcome.mutation.status, "unknown");
    assert.equal(response.result.data.outcome.live_readback.status, "not_run");
    assert.match(response.recovery.action, /Inspect live project state/u);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("invalidates only project_head for save_current and never rebinds identity", async () => {
    let saved = false;
    const invalidations = [];
    let rebindCalls = 0;
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-current-index", input: { operation: "save_current" } },
      now,
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_current_project_path") {
          return atomicExecution({ readback: { has_project_path: true, path_state: "saved_project", path: "/tmp/current.RPP" } });
        }
        if (id === "template.project.read_dirty_state") {
          return atomicExecution({ readback: saved
            ? { raw_dirty_state: 0, dirty_state: "clean", dirty: false }
            : { raw_dirty_state: 1, dirty_state: "dirty", dirty: true } });
        }
        saved = true;
        return atomicExecution({ summary: { saved: true } });
      },
      projectIndexRuntime: {
        status: () => ({ lifecycle: "ready", project_ref: "project:path:/tmp/current.RPP" }),
        rebindProjectIdentity: async () => { rebindCalls += 1; throw new Error("save_current must not rebind"); },
        invalidateScopes(input) {
          invalidations.push(input);
          return { ok: true, status: "scopes_invalidated", scopes: input.scopes, snapshot_id: "snapshot:current", revision: "revision:current" };
        },
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(rebindCalls, 0);
    assert.deepEqual(invalidations, [{ scopes: ["project_head"], observed_at: "2026-07-12T00:00:00.000Z" }]);
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
  });

  it("dry-runs the same save program without executing mutation", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-dry", input: { operation: "save_current", dry_run: true } },
      now,
      executeAtomic: async ({ id }) => {
        calls.push(id);
        return id.endsWith("path")
          ? atomicExecution({ readback: { has_project_path: true, path_state: "saved_project", path: "/tmp/current.RPP" } })
          : atomicExecution({ readback: { raw_dirty_state: 1, dirty_state: "dirty", dirty: true } });
      },
    });
    assert.equal(response.ok, true);
    assert.equal(response.execution.status, "dry_run_completed");
    assert.deepEqual(calls, ["template.project.read_current_project_path", "template.project.read_dirty_state"]);
  });

  it("stops on the first failed preflight and never calls the save template", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CProjectFileMacro({
      request: { request_id: "save-fail", input: { operation: "save_current" } },
      now,
      executeAtomic: async ({ id }) => {
        calls.push(id);
        return atomicExecution({}, false);
      },
    });
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "failed");
    assert.deepEqual(calls, ["template.project.read_current_project_path"]);
  });

  it("dry-runs render through the public Macro envelope without dispatching a child", async () => {
    let calls = 0;
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { request_id: "render-dry", input: { target_kind: "whole_project", format: "wav", dry_run: true } },
      now,
      managedRenderRoot,
      executeAtomic: async () => {
        calls += 1;
        throw new Error("dry_run must not dispatch an atomic child");
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.equal(response.result.verification.status, "passed");
    assert.equal(response.result.data.mutation_skipped, true);
    assert.equal(response.result.data.managed_render_root, managedRenderRoot);
    assert.equal(calls, 0);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assertExecutableRenderEnvelope(response);
  });

  it("renders through one audited atomic route and preserves returned evidence", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { request_id: "render-1", input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      now,
      managedRenderRoot,
      executeAtomic: async ({ id, input }) => {
        calls.push({ id, input });
        if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { dirty: true } });
        return atomicExecution(verifiedRenderResult({
          data: { retained_project_path: "/tmp/trial.RPP", dirty_before: true, dirty_after: true, save_recommendation: "save_after_render" },
        }));
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(calls.map(({ id }) => id), ["template.project.read_dirty_state", "template.render.render_targets", "template.project.read_dirty_state"]);
    assert.equal(response.result.data.outputs[0].absolute_path, "/managed/renders/trial.wav");
    assert.equal(response.result.data.save_recommendation, "save_after_render");
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assertExecutableRenderEnvelope(response);
  });

  it("passes a user-owned basename to D31 and rejects mismatched output naming", async () => {
    const calls = [];
    const request = { request_id: "render-named", input: { target_kind: "whole_project", format: "wav", output_basename: "Client Mix", dry_run: false } };
    const run = async (outputBasename) => executeAlpha3_2_5CRenderTargetsMacro({
      request,
      now,
      managedRenderRoot,
      executeAtomic: async ({ id, input }) => {
        calls.push({ id, input });
        if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { dirty: false } });
        return atomicExecution(verifiedRenderResult({ data: { outputs: [{ absolute_path: `/managed/renders/${outputBasename}.wav`, output_basename: outputBasename, size: 4096, extension: "wav", requested_format: "wav", actual_format: "wav", target_identity: "whole_project" }] } }));
      },
    });

    const passed = await run("Client Mix");
    assert.equal(passed.ok, true, JSON.stringify(passed));
    assert.equal(calls.find(({ id }) => id === "template.render.render_targets").input.output_basename, "Client Mix");
    assert.equal(passed.result.data.outputs[0].output_basename, "Client Mix");

    calls.length = 0;
    const failed = await run("internal_request_name");
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "RENDER_OUTPUT_BASENAME_MISMATCH");
  });

  it("requires exact requested and actual native MP3 facts from D31", async () => {
    const run = async (actualBitrate) => executeAlpha3_2_5CRenderTargetsMacro({
      request: { request_id: `render-mp3-${actualBitrate}`, input: { target_kind: "whole_project", format: "mp3", mp3_bitrate_kbps: 320, dry_run: false } },
      now,
      managedRenderRoot,
      executeAtomic: async ({ id, input }) => {
        if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { dirty: false } });
        assert.equal(input.mp3_bitrate_kbps, 320);
        return atomicExecution(verifiedRenderResult({
          data: {
            outputs: [{
              absolute_path: "/managed/renders/trial.mp3",
              size: 8192,
              extension: "mp3",
              requested_format: "mp3",
              actual_format: "mp3",
              requested_bitrate_kbps: 320,
              actual_bitrate_kbps: actualBitrate,
              target_identity: "whole_project",
            }],
          },
        }));
      },
    });

    const passed = await run(320);
    assert.equal(passed.ok, true, JSON.stringify(passed));
    assert.deepEqual(passed.result.data.audio_outputs[0], {
      absolute_path: "/managed/renders/trial.mp3",
      size: 8192,
      extension: "mp3",
      requested_format: "mp3",
      actual_format: "mp3",
      requested_bitrate_kbps: 320,
      actual_bitrate_kbps: 320,
      target_identity: "whole_project",
    });

    const failed = await run(256);
    assert.equal(failed.ok, false);
    assert.equal(failed.error.code, "RENDER_OUTPUT_ROW_INVALID");
  });

  it("retains completed render evidence when post-render dirty readback fails", async () => {
    let dirtyReads = 0;
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { request_id: "render-post-read-fail", input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      now,
      managedRenderRoot,
      executeAtomic: async ({ id }) => {
        if (id === "template.project.read_dirty_state") {
          dirtyReads += 1;
          return dirtyReads === 1
            ? atomicExecution({ readback: { dirty: false } }, true, "dirty-before")
            : atomicExecution({}, false, "dirty-after");
        }
        return atomicExecution(verifiedRenderResult({
          data: {
            outputs: [{
              absolute_path: "/managed/renders/retained.wav",
              size: 4096,
              extension: "wav",
              requested_format: "wav",
              actual_format: "wav",
              target_identity: "whole_project",
              generated_project_copy_retained: true,
              generated_project_copy_path: "/managed/renders/retained.wav.RPP",
            }],
          },
        }), true, "render-completed");
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "RENDER_DIRTY_STATE_REQUIRED");
    assert.equal(response.result.data.render_completed, true);
    assert.equal(response.result.data.audio_outputs[0].absolute_path, "/managed/renders/retained.wav");
    assert.equal(response.result.data.retained_project_copies[0].audio_output_path, "/managed/renders/retained.wav");
    assert.equal(response.result.data.dirty_after, null);
    assert.equal(response.result.data.save_recommendation, "check_dirty_state_and_save_if_needed");
    assert.equal(response.recovery.rendered_outputs_retained, true);
    assert.equal(response.result.verification.evidence_refs.includes("render-completed"), true);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("rejects idempotency keys before calling the non-idempotent render route", async () => {
    let calls = 0;
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { idempotency_key: "render-once", input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      now,
      managedRenderRoot,
      executeAtomic: async () => { calls += 1; return atomicExecution(verifiedRenderResult()); },
    });
    assert.equal(response.ok, false);
    assert.equal(response.error.code, "RENDER_IDEMPOTENCY_KEY_UNSUPPORTED");
    assert.equal(calls, 0);
  });

  it("fails closed when the audited render result omits required completion evidence", async () => {
    const cases = [
      ["verification", { verification: undefined }, "RENDER_VERIFICATION_FAILED"],
      ["manifest", { data: { output_artifact_ref: undefined } }, "RENDER_MANIFEST_ARTIFACT_REQUIRED"],
      ["evidence", { data: { evidence_artifact_ref: undefined } }, "RENDER_EVIDENCE_ARTIFACT_REQUIRED"],
      ["job", { data: { job_ref: undefined }, jobs: [], refs: [] }, "RENDER_JOB_REF_REQUIRED"],
      ["outputs", { data: { file_count: 0, outputs: [] } }, "RENDER_OUTPUTS_REQUIRED"],
    ];
    for (const [name, overrides, code] of cases) {
      const response = await executeAlpha3_2_5CRenderTargetsMacro({
        request: { request_id: `render-missing-${name}`, input: { target_kind: "whole_project", format: "wav", dry_run: false } },
        now,
        managedRenderRoot,
        executeAtomic: async ({ id }) => id === "template.project.read_dirty_state"
          ? atomicExecution({ readback: { dirty: false } })
          : atomicExecution(verifiedRenderResult(overrides)),
      });
      assert.equal(response.ok, false, name);
      assert.equal(response.error.code, code, name);
    }
  });

  it("projects the live D31 summary, artifacts, jobs, outputs, and verification", async () => {
    const manifest = { kind: "artifact", ref: "artifact:render:manifest", identity: { scheme: "artifact_ref", value: "artifact:render:manifest" } };
    const evidence = { kind: "artifact", ref: "artifact:render:evidence", identity: { scheme: "artifact_ref", value: "artifact:render:evidence" } };
    const job = { kind: "job", ref: "job:job_id:render.targets.live", identity: { scheme: "job_id", value: "render.targets.live" } };
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: { request_id: "render-live-shape", input: { target_kind: "whole_project", format: "wav", dry_run: false } },
      now,
      managedRenderRoot,
      executeAtomic: async ({ id }) => id === "template.project.read_dirty_state"
        ? atomicExecution({ readback: { dirty: false } })
        : ({
        contract: "template.execution.v1",
        ok: true,
        request: { id: "cmd-render-live" },
        verification: { status: "passed", checks: [] },
        result: {
          summary: {
            job_ref: job.ref,
            output_artifact_ref: manifest.ref,
            evidence_artifact_ref: evidence.ref,
            format: "wav",
            output_policy: "openreaper_managed_render_root",
            collision_policy: "fail_if_exists",
            file_count: 1,
            outputs: [{
              absolute_path: "/managed/renders/live.wav",
              size: 4096,
              extension: "wav",
              requested_format: "wav",
              actual_format: "wav",
              target_identity: "whole_project",
              generated_project_copy_retained: true,
              generated_project_copy_path: "/managed/renders/live.wav.RPP",
            }],
            truncated: false,
          },
          refs: [manifest, evidence, job],
          artifacts: [manifest, evidence],
          jobs: [job],
          readback: null,
        },
        error: null,
      }),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.file_count, 1);
    assert.equal(response.result.data.outputs[0].absolute_path, "/managed/renders/live.wav");
    assert.deepEqual(response.result.artifact_refs, [manifest.ref, evidence.ref]);
    assert.equal(response.result.canonical_refs.includes(job.ref), true);
    assert.equal(response.result.verification.evidence_refs.includes("cmd-render-live"), true);
    assert.equal(response.result.verification.evidence_refs.includes(manifest.ref), true);
    assert.equal(response.result.changes[0].file_count, 1);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("preserves typed offline/all-zero details and mechanical recovery at the public Macro boundary", async () => {
    for (const testCase of [
      {
        bridgeCode: "FILE_NOT_FOUND",
        localCode: "RENDER_SOURCE_OFFLINE",
        message: "The target audio source is still offline or missing after REAPER Set all media online.",
        details: {
          source_path: "/Users/Shared/中文 素材/dialogue.wav",
          source_type: "WAVE",
          target_identity: "item:guid:{OFFLINE}",
          media_online_action_id: 40101,
          render_action_id: 41824,
          retry_requires_source_reconnect: true,
        },
      },
      {
        bridgeCode: "VERIFY_FAILED",
        localCode: "RENDER_OUTPUT_ALL_ZERO",
        message: "Rendered output decoded successfully but every measured sample was zero.",
        details: {
          output_basename: "silent-output",
          silence_classification: "all_zero",
          probable_causes: ["intentionally_silent_target", "unavailable_source_or_instrument", "silent_signal_path"],
          retry_requires_fresh_output_basename: true,
          audio_device_required: false,
        },
      },
    ]) {
      const response = await executeAlpha3_2_5CRenderTargetsMacro({
        request: {
          request_id: `render-${testCase.localCode}`,
          input: { target_kind: "whole_project", format: "wav", output_basename: "trial", dry_run: false },
        },
        now,
        managedRenderRoot,
        executeAtomic: async ({ id }) => {
          if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { dirty: false } });
          return {
            contract: "template.execution.v1",
            ok: false,
            result: null,
            error: {
              code: testCase.bridgeCode,
              message: testCase.message,
              recoverable: true,
              details: { local_code: testCase.localCode, ...testCase.details },
            },
          };
        },
      });

      assert.equal(response.ok, false);
      assert.equal(response.error.code, testCase.bridgeCode);
      assert.equal(response.error.details.local_code, testCase.localCode);
      assert.equal(response.blockers[0].details.local_code, testCase.localCode);
      assert.equal(response.recovery.audio_device_required, false);
      if (testCase.localCode === "RENDER_SOURCE_OFFLINE") {
        assert.equal(response.error.details.source_path, testCase.details.source_path);
        assert.equal(response.recovery.source_path, testCase.details.source_path);
        assert.deepEqual(response.recovery.request_patch, {
          id: "macro.render.targets",
          input: { target_kind: "whole_project", format: "wav", output_basename: "trial", dry_run: false },
        });
        assert.equal(response.recovery.restart_reaper_required, false);
      } else {
        assert.deepEqual(response.error.details.probable_causes, testCase.details.probable_causes);
        assert.equal(response.recovery.fresh_output_basename_required, true);
      }
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    }
  });

  it("live-resolves explicit track, item, and region targets into full object refs before rendering", async () => {
    const cases = [
      {
        target_kind: "explicit_tracks",
        requested_ref: "track:name:Drums",
        resolver_id: "template.tracks.resolve_track_ref",
        live_ref: { kind: "track", ref: "track:guid:{TRACK-LIVE}", identity: { scheme: "guid", value: "{TRACK-LIVE}" }, provenance: { source: "live_resolver" } },
        ref_key: "track_refs",
      },
      {
        target_kind: "explicit_items",
        requested_ref: "item:guid:{ITEM-CANDIDATE}",
        resolver_id: "template.items.resolve_item_ref",
        live_ref: { kind: "item", ref: "item:guid:{ITEM-CANDIDATE}", identity: { scheme: "guid", value: "{ITEM-CANDIDATE}" }, provenance: { source: "live_resolver" } },
        ref_key: "item_refs",
      },
      {
        target_kind: "regions",
        requested_ref: "region:index:3",
        resolver_id: "template.project.list_markers_regions",
        live_ref: { kind: "region", ref: "region:index:3", identity: { scheme: "index", value: "3" }, provenance: { source: "live_resolver" } },
        ref_key: "region_refs",
      },
    ];

    for (const fixture of cases) {
      const calls = [];
      const response = await executeAlpha3_2_5CRenderTargetsMacro({
        request: {
          request_id: `render-${fixture.target_kind}`,
          input: { target_kind: fixture.target_kind, refs: [fixture.requested_ref], format: "wav", dry_run: false },
        },
        now,
        managedRenderRoot,
        executeAtomic: async ({ id, input, refs }) => {
          calls.push({ id, input, refs });
          if (id === "template.project.read_dirty_state") return atomicExecution({ readback: { dirty: false } });
          if (id === fixture.resolver_id) return atomicExecution({ refs: [fixture.live_ref] });
          if (id === "template.render.render_targets") {
            return atomicExecution(verifiedRenderResult({
              verification: { status: "passed", evidence_refs: [`evidence:${fixture.target_kind}`] },
            }));
          }
          throw new Error(`Unexpected explicit-render dependency ${id}`);
        },
      });

      assert.equal(response.ok, true, JSON.stringify(response));
      assert.deepEqual(calls.map(({ id }) => id), [fixture.resolver_id, "template.project.read_dirty_state", "template.render.render_targets", "template.project.read_dirty_state"]);
      assert.deepEqual(calls[2].refs, { [fixture.ref_key]: [fixture.live_ref] });
      assert.equal(JSON.stringify(calls[2].refs).includes(fixture.requested_ref), fixture.live_ref.ref === fixture.requested_ref);
      assert.equal(response.result.canonical_refs.includes(fixture.live_ref.ref), true);
      assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    }
  });

  it("rejects a stable render GUID when the live resolver returns a different object", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5CRenderTargetsMacro({
      request: {
        request_id: "render-stable-guid-mismatch",
        input: { target_kind: "explicit_items", refs: ["item:guid:{EXPECTED}"], format: "wav", dry_run: false },
      },
      now,
      managedRenderRoot,
      executeAtomic: async ({ id }) => {
        calls.push(id);
        if (id === "template.items.resolve_item_ref") {
          return atomicExecution({ refs: [{ kind: "item", ref: "item:guid:{WRONG}", identity: { scheme: "guid", value: "{WRONG}" } }] });
        }
        throw new Error(`Unexpected render call ${id}`);
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "RENDER_LIVE_REF_IDENTITY_MISMATCH");
    assert.deepEqual(calls, ["template.items.resolve_item_ref"]);
  });
});
