import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  runAlpha34D3ProjectSwitchingHarness,
} from "../../scripts/smoke-alpha3-4-d3-project-switching.mjs";
import {
  executeAlpha3_2_5CProjectFileMacro,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import { readEvidenceSummary } from "../../scripts/lib/alpha3-4-harness-evidence-v1.mjs";

function harnessInventory(rows) {
  return {
    ok: true,
    result: {
      data: {
        operation: "list_open_projects",
        projects: rows,
        total_count: rows.length,
        returned_count: rows.length,
        cursor: 0,
        next_cursor: null,
        coverage_status: "complete",
        truncated: false,
      },
    },
    budget: { max_bytes: 2048, actual_bytes: 300, truncated: false, artifact_fallback: false },
  };
}

function harnessSavedRow(projectPath, { active = false, dirty = false, rawDirty = 0, tabIndex = 0 } = {}) {
  return {
    project_ref: `project:path:${projectPath}`,
    active,
    saved: true,
    path_state: "saved_project",
    name: path.basename(projectPath),
    path: projectPath,
    path_truncated: false,
    dirty,
    raw_dirty_state: rawDirty,
    tab_index: tabIndex,
  };
}

function harnessUnsavedRow(ref, { active = false, dirty, rawDirty, tabIndex = 1 } = {}) {
  return {
    project_ref: ref,
    active,
    saved: false,
    path_state: "unsaved_project",
    name: "unsaved",
    path: "",
    path_truncated: false,
    ...(dirty === undefined ? {} : { dirty }),
    ...(rawDirty === undefined ? {} : { raw_dirty_state: rawDirty }),
    tab_index: tabIndex,
  };
}

describe("Alpha3.4-D3 project switching live harness", () => {
  it("requires explicit fake transport for unit mode and never falls back to source runtime", async () => {
    await assert.rejects(
      () => runAlpha34D3ProjectSwitchingHarness({
        installedWrapper: "/tmp/openreaper-mcp",
        sourceProject: "/tmp/source.RPP",
        evidenceRoot: "/tmp/evidence",
      }),
      (error) => error.code === "D3_HARNESS_FAKE_TRANSPORT_REQUIRED",
    );
  });

  it("runs the full create/list/activate/open/restore dual-client sequence through production macro executor", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "or-d3-harness-"));
    const evidenceRoot = path.join(parent, "fresh-root");
    const sourceProject = path.join(parent, "source.RPP");
    await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");

    const sourceRef = `project:path:${sourceProject}`;
    const openTarget = path.join(evidenceRoot, "projects", "open-existing.RPP");
    const createTarget = path.join(evidenceRoot, "projects", "created-named.RPP");
    const openRef = `project:path:${openTarget}`;
    const createRef = `project:path:${createTarget}`;

    let activeRef = sourceRef;
    const openProjects = new Map([
      [sourceRef, {
        project_ref: sourceRef,
        active: true,
        saved: true,
        path_state: "saved_project",
        name: "source.RPP",
        path: sourceProject,
        path_truncated: false,
        dirty: false,
        raw_dirty_state: 0,
        tab_index: 0,
      }],
    ]);

    const rebuildInventory = () => {
      const projects = [...openProjects.values()].map((row, index) => ({
        ...row,
        active: row.project_ref === activeRef,
        tab_index: index,
      }));
      return {
        ok: true,
        result: {
          data: {
            operation: "list_open_projects",
            projects,
            total_count: projects.length,
            returned_count: projects.length,
            cursor: 0,
            next_cursor: null,
            coverage_status: "complete",
            truncated: false,
            index_write: false,
            selection: false,
            outcome: {
              mutation: { status: "not_run" },
              live_readback: { status: "passed" },
              index_maintenance: { status: "not_run", scopes: [], blocker_code: null },
            },
          },
        },
        budget: { max_bytes: 2048, actual_bytes: 400, truncated: false, artifact_fallback: false },
      };
    };

    const callTemplate = async ({ id, input }) => {
      assert.equal(id, "macro.project.file");
      if (input.operation === "list_open_projects") {
        return rebuildInventory();
      }
      if (input.operation === "create_project_tab") {
        openProjects.set(createRef, {
          project_ref: createRef,
          active: true,
          saved: true,
          path_state: "saved_project",
          name: "created-named.RPP",
          path: createTarget,
          path_truncated: false,
          dirty: false,
          raw_dirty_state: 0,
          tab_index: openProjects.size,
        });
        activeRef = createRef;
        return {
          ok: true,
          sqlite: { used: true, source: "warm_index", freshness: "stale", snapshot_ref: "snap", revision: "2", refreshed: false },
          result: {
            data: {
              operation: "create_project_tab",
              project_ref: createRef,
              path_after: createTarget,
              outcome: {
                mutation: { status: "completed" },
                live_readback: { status: "passed" },
                index_maintenance: { status: "completed", blocker_code: null },
              },
            },
            changes: [{ status: "applied", mutation: { status: "completed" }, live_readback: { status: "passed" } }],
          },
          budget: { max_bytes: 2048, actual_bytes: 500, truncated: false, artifact_fallback: false },
        };
      }
      if (input.operation === "open_project_in_tab") {
        openProjects.set(openRef, {
          project_ref: openRef,
          active: true,
          saved: true,
          path_state: "saved_project",
          name: "open-existing.RPP",
          path: openTarget,
          path_truncated: false,
          dirty: false,
          raw_dirty_state: 0,
          tab_index: openProjects.size,
        });
        activeRef = openRef;
        return {
          ok: true,
          result: {
            data: {
              operation: "open_project_in_tab",
              project_ref: openRef,
              path_after: openTarget,
              outcome: {
                mutation: { status: "completed" },
                live_readback: { status: "passed" },
                index_maintenance: { status: "completed", blocker_code: null },
              },
            },
            changes: [{ status: "applied", mutation: { status: "completed" }, live_readback: { status: "passed" } }],
          },
          budget: { max_bytes: 2048, actual_bytes: 500, truncated: false, artifact_fallback: false },
        };
      }
      if (input.operation === "activate_project_tab") {
        activeRef = input.project_ref;
        return {
          ok: true,
          sqlite: { used: true, source: "warm_index", freshness: "stale", snapshot_ref: "snap", revision: "3", refreshed: false },
          result: {
            data: {
              operation: "activate_project_tab",
              project_ref: input.project_ref,
              outcome: {
                mutation: { status: input.project_ref === sourceRef ? "not_run" : "completed" },
                live_readback: { status: "passed" },
                index_maintenance: { status: "completed", blocker_code: null },
              },
            },
            changes: [{
              status: "applied",
              mutation: { status: input.project_ref === sourceRef ? "not_run" : "completed" },
              live_readback: { status: "passed" },
            }],
          },
          budget: { max_bytes: 2048, actual_bytes: 500, truncated: false, artifact_fallback: false },
        };
      }
      throw new Error(`unexpected operation ${input.operation}`);
    };

    try {
      const report = await runAlpha34D3ProjectSwitchingHarness({
        installedWrapper: "/tmp/openreaper-mcp",
        sourceProject,
        evidenceRoot,
        fakeTransportOnly: true,
        callTemplate,
        callTemplateB: callTemplate,
      });
      assert.equal(report.ok, true, JSON.stringify(report.steps, null, 2));
      assert.equal(report.runtime.source, "fake_transport");
      assert.equal(report.runtime.dual_clients, true);
      assert.equal(report.runtime.source_runtime_fallback, false);
      assert.equal(report.source_media_deleted, false);
      assert.deepEqual(report.rendered_outputs, []);
      assert.ok(report.project_before_hash);
      assert.equal(report.project_after_hash, report.project_before_hash);
      assert.equal(report.source_project_hash_unchanged, true);
      assert.ok(report.created_project_files.some((file) => file.endsWith("open-existing.RPP")));
      assert.ok(report.created_project_files.some((file) => file.endsWith("created-named.RPP")));
      assert.equal(report.recovery_posture.source_project_restored_active, true);
      assert.equal(report.recovery_posture.zero_renders, true);
      assert.equal(report.recovery_posture.zero_source_media_deletion, true);

      const ops = report.call_sequence.map((entry) => entry.operation);
      assert.ok(ops.includes("list_open_projects"));
      assert.ok(ops.includes("create_project_tab"));
      assert.ok(ops.includes("open_project_in_tab"));
      assert.ok(ops.includes("activate_project_tab"));
      assert.ok(report.steps.some((step) => step.step === "create_project_tab" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "open_project_in_tab" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "restore_source_active" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "peer_sees_created_project" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "dual_client_open_visibility" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "peer_stale_index_activate_among_saved_tabs" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "source_active_readback" && step.ok === true));
      assert.ok(report.steps.some((step) => step.step === "source_project_hash_unchanged" && step.ok === true));
      assert.ok(report.call_sequence.some((entry) => entry.client === "B" && entry.operation === "activate_project_tab" && entry.ok === true));
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("still routes fake list through the real macro executor for production binding", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "or-d3-harness-bind-"));
    const evidenceRoot = path.join(parent, "fresh-root");
    const sourceProject = path.join(parent, "source.RPP");
    await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");
    try {
      // Minimal smoke of harness wiring only; full sequence tested above.
      await assert.rejects(
        () => runAlpha34D3ProjectSwitchingHarness({
          installedWrapper: "/tmp/openreaper-mcp",
          sourceProject,
          evidenceRoot,
          fakeTransportOnly: true,
          callTemplate: async ({ id, input }) => executeAlpha3_2_5CProjectFileMacro({
            request: { input, request_id: "bind" },
            executeAtomic: async () => ({
              ok: false,
              error: { code: "STOP", message: "intentional early stop after list binding" },
            }),
          }),
        }),
        (error) => error.code === "D3_HARNESS_LIST_FAILED" || error.code === "D3_HARNESS_SOURCE_REF_MISSING",
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("stops mutation sequence after first mutation failure without replaying timeout and records recovery fields", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "or-d3-harness-failfast-"));
    const evidenceRoot = path.join(parent, "fresh-root");
    const sourceProject = path.join(parent, "source.RPP");
    await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");
    const sourceRef = `project:path:${sourceProject}`;
    const unsavedRef = "project:tab:recovery-unsaved";
    let openCalls = 0;
    let createCalls = 0;
    let activateCalls = 0;
    let inventoryRows = [{
      project_ref: sourceRef,
      active: true,
      saved: true,
      path_state: "saved_project",
      name: "source.RPP",
      path: sourceProject,
      path_truncated: false,
      dirty: false,
      raw_dirty_state: 0,
      tab_index: 0,
    }];
    const callTemplate = async ({ id, input = {}, refs = [], budget }) => {
      if (id === "template.project.activate_project_tab") {
        activateCalls += 1;
        assert.equal(refs[0]?.ref, sourceRef);
        assert.deepEqual(refs[0]?.identity, { scheme: "path", value: sourceProject });
        inventoryRows = inventoryRows.map((row) => ({
          ...row,
          active: row.project_ref === sourceRef,
        }));
        return {
          ok: true,
          result: {
            summary: {
              activated: true,
              already_active: false,
              project_ref: sourceRef,
              prior_project_remains_open: true,
              prior_dirty_unchanged: true,
              live_materialization: "native_activate_verified",
            },
          },
        };
      }
      assert.equal(id, "macro.project.file");
      return executeAlpha3_2_5CProjectFileMacro({
        request: { input, request_id: `harness-${input.operation}`, budget },
        executeAtomic: async ({ id: atomicId }) => {
          if (atomicId === "template.project.list_open_projects") {
            return {
              ok: true,
              result: {
                summary: {
                  projects: inventoryRows,
                  total_count: inventoryRows.length,
                  returned_count: inventoryRows.length,
                  cursor: 0,
                  next_cursor: null,
                  coverage_status: "complete",
                  truncated: false,
                },
              },
            };
          }
          if (atomicId === "template.project.create_project_tab") {
            createCalls += 1;
            inventoryRows = [
              { ...inventoryRows[0], active: false },
              {
                project_ref: unsavedRef,
                active: true,
                saved: false,
                path_state: "unsaved_project",
                name: "recovery-unsaved",
                path: "",
                path_truncated: false,
                dirty: false,
                raw_dirty_state: 0,
                tab_index: 1,
              },
            ];
            return {
              ok: false,
              error: {
                code: "BRIDGE_TIMEOUT",
                message: "Bridge request exceeded timeout_ms before a terminal result.",
                recoverable: false,
                details: {
                  outcome: "unknown",
                  reason: "continuation_timeout",
                  timeout_ms: 30000,
                  queue_state: "timeout",
                  partial_state: "blank_tab_may_remain",
                },
              },
            };
          }
          if (atomicId === "template.project.open_project_in_tab") {
            openCalls += 1;
          }
          throw new Error(`unexpected atomic operation ${atomicId}`);
        },
      });
    };

    try {
      const report = await runAlpha34D3ProjectSwitchingHarness({
        installedWrapper: "/tmp/openreaper-mcp",
        sourceProject,
        evidenceRoot,
        fakeTransportOnly: true,
        callTemplate,
        callTemplateB: callTemplate,
      });
      assert.equal(report.ok, false);
      assert.equal(createCalls, 1);
      assert.equal(openCalls, 0, "must not continue mutation sequence after first failure");
      assert.equal(activateCalls, 1, "recovery must use exactly one public native activation");
      assert.equal(report.mutation_sequence_stopped_after, "create_project_tab");
      assert.equal(report.first_mutation_failure?.error_code, "BRIDGE_TIMEOUT");
      assert.equal(report.first_mutation_failure?.outcome, "unknown");
      assert.equal(report.first_mutation_failure?.reason, "continuation_timeout");
      assert.equal(report.recovery_posture.no_timeout_mutation_replay, true);
      assert.ok(Array.isArray(report.remaining_tabs));
      assert.equal(typeof report.recovery_posture.source_hash, "string");
      assert.equal(report.recovery_posture.clients_closed, true);
      const summary = await readEvidenceSummary(evidenceRoot);
      assert.equal(summary.recovery.clients_closed, true);
      assert.equal(summary.recovery.no_timeout_mutation_replay, true);
      assert.equal(report.recovery_posture.recovery_result, "restored");
      assert.equal(report.recovery_posture.source_active, true);
      assert.ok(report.steps.some((step) => step.step === "create_project_tab" && step.ok === false && step.stopped_mutation_sequence === true));
      assert.ok(report.steps.some((step) => step.step === "final_inventory" && step.read_only === true));
      // Source already active in inventory; recovery activate may be skipped or used only when not active.
      assert.equal(report.call_sequence.find((entry) => entry.requested_id === "template.project.activate_project_tab")?.normalized_operation, "activate_project_tab");
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("skips bounded recovery when any inactive unsaved tab is dirty or lacks exact dirty truth", async () => {
    const cases = [
      {
        name: "dirty",
        badRow: harnessUnsavedRow("project:tab:dirty", { active: false, dirty: true, rawDirty: 1, tabIndex: 2 }),
      },
      {
        name: "missing-dirty",
        badRow: harnessUnsavedRow("project:tab:missing", { active: false, rawDirty: 0, tabIndex: 2 }),
      },
      {
        name: "missing-raw-dirty",
        badRow: harnessUnsavedRow("project:tab:missing-raw", { active: false, dirty: false, tabIndex: 2 }),
      },
    ];

    for (const fixture of cases) {
      const parent = await mkdtemp(path.join(os.tmpdir(), `or-d3-harness-${fixture.name}-`));
      const evidenceRoot = path.join(parent, "fresh-root");
      const sourceProject = path.join(parent, "source.RPP");
      const activeProject = path.join(parent, "active-test.RPP");
      await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");
      let afterFailure = false;
      let nativeActivateCalls = 0;
      const initialRows = [harnessSavedRow(sourceProject, { active: true })];
      const postRows = [
        harnessSavedRow(sourceProject, { active: false }),
        harnessSavedRow(activeProject, { active: true, tabIndex: 1 }),
        fixture.badRow,
      ];
      const callTemplate = async ({ id, input = {} }) => {
        if (id === "template.project.activate_project_tab") {
          nativeActivateCalls += 1;
          return { ok: true };
        }
        assert.equal(id, "macro.project.file");
        if (input.operation === "list_open_projects") return harnessInventory(afterFailure ? postRows : initialRows);
        if (input.operation === "create_project_tab") {
          afterFailure = true;
          return {
            ok: false,
            error: {
              code: "BRIDGE_TIMEOUT",
              message: "timeout",
              recoverable: false,
              details: { outcome: "unknown", reason: "continuation_timeout", queue_state: "timeout", timeout_ms: 30000 },
            },
          };
        }
        throw new Error(`unexpected operation ${input.operation}`);
      };

      try {
        const report = await runAlpha34D3ProjectSwitchingHarness({
          installedWrapper: "/tmp/openreaper-mcp",
          sourceProject,
          evidenceRoot,
          fakeTransportOnly: true,
          callTemplate,
          callTemplateB: callTemplate,
        });
        assert.equal(report.ok, false, fixture.name);
        assert.equal(nativeActivateCalls, 0, fixture.name);
        assert.equal(report.recovery_posture.recovery_allowed, false, fixture.name);
        assert.equal(report.recovery_posture.recovery_attempted, false, fixture.name);
        assert.equal(report.recovery_posture.recovery_result, "skipped_dirty_or_incomplete_inventory", fixture.name);
        assert.equal(
          report.steps.find((step) => step.step === "bounded_recovery_restore_source")?.reason,
          "dirty_or_missing_test_tab_state",
          fixture.name,
        );
      } finally {
        await rm(parent, { recursive: true, force: true });
      }
    }
  });

  it("does not replay an unknown activate-source failure as bounded recovery", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "or-d3-harness-activate-replay-"));
    const evidenceRoot = path.join(parent, "fresh-root");
    const sourceProject = path.join(parent, "source.RPP");
    await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");
    const sourceRef = `project:path:${sourceProject}`;
    let inventoryRows = [harnessSavedRow(sourceProject, { active: true })];
    let nativeActivateCalls = 0;

    const callTemplate = async ({ id, input = {} }) => {
      if (id === "template.project.activate_project_tab") {
        nativeActivateCalls += 1;
        return { ok: true };
      }
      assert.equal(id, "macro.project.file");
      if (input.operation === "list_open_projects") return harnessInventory(inventoryRows);
      if (input.operation === "create_project_tab") {
        const createdRef = `project:path:${input.target_path}`;
        inventoryRows = [
          harnessSavedRow(sourceProject, { active: false }),
          harnessSavedRow(input.target_path, { active: true, tabIndex: 1 }),
        ];
        return {
          ok: true,
          result: { data: { project_ref: createdRef } },
          budget: { max_bytes: 2048, actual_bytes: 300, truncated: false, artifact_fallback: false },
        };
      }
      if (input.operation === "activate_project_tab" && input.project_ref === sourceRef) {
        return {
          ok: false,
          error: {
            code: "BRIDGE_TIMEOUT",
            message: "timeout",
            recoverable: false,
            details: { outcome: "unknown", reason: "continuation_timeout", queue_state: "timeout", timeout_ms: 30000 },
          },
        };
      }
      throw new Error(`unexpected operation ${input.operation}`);
    };

    try {
      const report = await runAlpha34D3ProjectSwitchingHarness({
        installedWrapper: "/tmp/openreaper-mcp",
        sourceProject,
        evidenceRoot,
        fakeTransportOnly: true,
        callTemplate,
        callTemplateB: callTemplate,
      });
      assert.equal(report.ok, false);
      assert.equal(report.mutation_sequence_stopped_after, "activate_source_project");
      assert.equal(report.first_mutation_failure?.outcome, "unknown");
      assert.equal(nativeActivateCalls, 0);
      assert.equal(report.recovery_posture.recovery_allowed, false);
      assert.equal(report.recovery_posture.recovery_attempted, false);
      assert.equal(report.recovery_posture.recovery_result, "skipped_same_unknown_mutation_replay_forbidden");
      assert.equal(
        report.steps.find((step) => step.step === "bounded_recovery_restore_source")?.reason,
        "same_unknown_mutation_replay_forbidden",
      );
      assert.equal(report.recovery_posture.no_timeout_mutation_replay, true);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });

  it("does not claim restored when native recovery returns success without active-source readback", async () => {
    const parent = await mkdtemp(path.join(os.tmpdir(), "or-d3-harness-readback-fail-"));
    const evidenceRoot = path.join(parent, "fresh-root");
    const sourceProject = path.join(parent, "source.RPP");
    await writeFile(sourceProject, "<REAPER_PROJECT 0.1\n>");
    const sourceRows = [harnessSavedRow(sourceProject, { active: true })];
    const postRows = [
      harnessSavedRow(sourceProject, { active: false }),
      harnessUnsavedRow("project:tab:clean", { active: true, dirty: false, rawDirty: 0 }),
    ];
    let afterFailure = false;
    let nativeActivateCalls = 0;
    const callTemplate = async ({ id, input = {}, refs = [] }) => {
      if (id === "template.project.activate_project_tab") {
        nativeActivateCalls += 1;
        assert.equal(refs[0]?.ref, `project:path:${sourceProject}`);
        return { ok: true, result: { summary: { activated: true } } };
      }
      assert.equal(id, "macro.project.file");
      if (input.operation === "list_open_projects") return harnessInventory(afterFailure ? postRows : sourceRows);
      if (input.operation === "create_project_tab") {
        afterFailure = true;
        return {
          ok: false,
          error: {
            code: "BRIDGE_TIMEOUT",
            message: "timeout",
            recoverable: false,
            details: { outcome: "unknown", reason: "continuation_timeout", queue_state: "timeout", timeout_ms: 30000 },
          },
        };
      }
      throw new Error(`unexpected operation ${input.operation}`);
    };

    try {
      const report = await runAlpha34D3ProjectSwitchingHarness({
        installedWrapper: "/tmp/openreaper-mcp",
        sourceProject,
        evidenceRoot,
        fakeTransportOnly: true,
        callTemplate,
        callTemplateB: callTemplate,
      });
      assert.equal(nativeActivateCalls, 1);
      assert.equal(report.recovery_posture.recovery_allowed, true);
      assert.equal(report.recovery_posture.recovery_attempted, true);
      assert.equal(report.recovery_posture.recovery_result, "failed_readback");
      assert.equal(report.recovery_posture.source_project_restored_active, false);
      assert.equal(report.recovery_posture.source_active, false);
      assert.equal(report.remaining_tabs.find((row) => row.active)?.project_ref, "project:tab:clean");
      assert.equal(report.steps.find((step) => step.step === "bounded_recovery_readback")?.ok, false);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
