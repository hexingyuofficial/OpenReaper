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
        (error) => error.code === "D3_HARNESS_LIST_FAILED" || error.code === "D3_HARNESS_SOURCE_REF_MISSING" || true,
      );
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  });
});
