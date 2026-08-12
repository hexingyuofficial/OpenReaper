import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
  createAlpha3_2C3DProjectFileMacroDiscoveryItems,
  executeAlpha3_2_5CProjectFileMacro,
  getAlpha3ProjectFileInternalAtomicChildBudget,
  planAlpha3_2C3DProjectFileMacro,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const SIX_OPS = [
  "save_current",
  "save_as",
  "list_open_projects",
  "create_project_tab",
  "open_project_in_tab",
  "activate_project_tab",
];

function makeInventory(rows, { cursor = 0, limit = 100, total = rows.length } = {}) {
  const slice = rows.slice(cursor, cursor + limit);
  const next = cursor + slice.length;
  const hasMore = next < total;
  return {
    ok: true,
    result: {
      summary: {
        projects: slice,
        total_count: total,
        returned_count: slice.length,
        cursor,
        next_cursor: hasMore ? String(next) : null,
        coverage_status: hasMore ? "paged" : "complete",
        truncated: hasMore,
      },
    },
  };
}

function makeExecutor(handlers) {
  return async (call) => {
    const { id, input, refs } = call;
    const handler = handlers[id];
    if (!handler) return { ok: false, error: { code: "MISSING", message: `no handler ${id}` } };
    return handler(input, refs, call);
  };
}

function makeIndex({ project_ref, project_path }) {
  let current = { project_ref, project_path };
  return {
    status: () => ({ ...current, revision: 1, snapshot_id: "snap" }),
    rebindProjectIdentity: async ({ project_path: nextPath, expected_previous_project_ref }) => {
      if (expected_previous_project_ref !== current.project_ref) {
        return {
          ok: false,
          blockers: [{ code: "PROJECT_IDENTITY_REBIND_PREVIOUS_REF_MISMATCH", message: "mismatch" }],
          scopes: [],
        };
      }
      current = { project_ref: `project:path:${nextPath}`, project_path: nextPath };
      return {
        ok: true,
        status: "identity_rebound",
        previous_project_ref: expected_previous_project_ref,
        project_ref: current.project_ref,
        project_path: nextPath,
        scopes: ["project_head"],
        snapshot_id: "snap2",
        revision: 2,
        old_rows_migrated: false,
      };
    },
    invalidateScopes: async () => ({
      ok: true,
      status: "scopes_invalidated",
      scopes: ["project_head"],
      revision: 3,
      snapshot_id: "snap3",
    }),
  };
}

function row(path, { active = false, dirty = 0, unsaved = false, tab_index = 0 } = {}) {
  if (unsaved) {
    return {
      project_ref: `project:tab:t${tab_index}`,
      active,
      saved: false,
      path_state: "unsaved_project",
      name: "unsaved",
      path: "",
      path_truncated: false,
      dirty: dirty > 0,
      raw_dirty_state: dirty,
      tab_index,
    };
  }
  return {
    project_ref: `project:path:${path}`,
    active,
    saved: true,
    path_state: "saved_project",
    name: path.split("/").at(-1),
    path,
    path_truncated: false,
    dirty: dirty > 0,
    raw_dirty_state: dirty,
    tab_index,
  };
}

describe("Alpha3.4-D3 upper macro.project.file highway", () => {
  it("exposes six operations in discovery and keeps 241 product live templates", () => {
    const items = createAlpha3_2C3DProjectFileMacroDiscoveryItems();
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].inputSchema.properties.operation.enum, SIX_OPS);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 241);
    assert.equal(ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION, "1.2.0");
    assert.equal(ALPHA3_2C3D_PROJECT_FILE_MACRO_ID, "macro.project.file");
  });

  it("uses a bounded internal inventory budget without weakening the public 2 KiB identity gate", async () => {
    const publicBudget = { max_response_bytes: 2048, max_items: 25, max_inline_value_bytes: 256 };
    const pathA = "/session/Parent.RPP";
    let childBudget = null;
    const listed = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "list_open_projects", cursor: "0", limit: 1 },
        request_id: "list-budget",
        budget: publicBudget,
      },
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": (_input, _refs, call) => {
          childBudget = call.budget;
          return makeInventory([row(pathA, { active: true })]);
        },
      }),
    });
    assert.equal(listed.ok, true, JSON.stringify(listed.error));
    assert.ok(childBudget.max_response_bytes >= 32_768);
    assert.ok(childBudget.max_response_bytes <= 65_536);
    assert.ok(childBudget.max_inline_value_bytes >= 4096);
    assert.equal(childBudget.max_items, 25);
    assert.equal(listed.budget.max_bytes, 2048);
    assert.ok(listed.budget.actual_bytes <= 2048, listed.budget.actual_bytes);

    const longPath = `/session/${"x".repeat(1800)}.RPP`;
    let longIdentityChildBudget = null;
    const blocked = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "list_open_projects", cursor: "0", limit: 1 },
        request_id: "list-long-identity",
        budget: publicBudget,
      },
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": (_input, _refs, call) => {
          longIdentityChildBudget = call.budget;
          return makeInventory([row(longPath, { active: true })]);
        },
      }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(blocked.error.details?.zero_write, true);
    assert.ok(longIdentityChildBudget.max_response_bytes >= 32_768);
    assert.equal(blocked.budget.max_bytes, 2048);
    assert.ok(blocked.budget.actual_bytes <= 2048, blocked.budget.actual_bytes);
  });

  it("preserves full project_ref identities on public pages under 2 KiB and never slices rows", async () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(`/session/p${String(i).padStart(2, "0")}.RPP`, {
      active: i === 0,
      tab_index: i,
    }));
    const envelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "list_open_projects", cursor: "0", limit: 12 },
        request_id: "list12",
        budget: { max_response_bytes: 2048 },
      },
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": (input) => makeInventory(rows, {
          cursor: Number(input.cursor || 0),
          limit: input.limit,
        }),
      }),
    });
    if (envelope.ok === true) {
      assert.equal(envelope.result.data.returned_count, envelope.result.data.projects.length);
      for (const project of envelope.result.data.projects) {
        assert.match(project.project_ref, /^project:path:\/session\/p\d+\.RPP$/u);
        assert.equal(project.project_ref.includes("…"), false);
      }
      assert.ok(envelope.budget.actual_bytes <= 2048, envelope.budget.actual_bytes);
    } else {
      assert.equal(envelope.error.code, "RESPONSE_TOO_LARGE");
      assert.equal(envelope.error.details?.zero_write, true);
      assert.equal(envelope.error.details?.request_patch?.budget, undefined);
      assert.ok(envelope.error.details?.request_patch?.input?.limit < 12);
    }
  });

  it("returns typed RESPONSE_TOO_LARGE before mutation for oversized identity and keeps public envelope at 2048", async () => {
    const longPath = `/session/${"x".repeat(1800)}.RPP`;
    const pathA = "/session/Parent.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    let openCalls = 0;
    const blocked = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "open_project_in_tab", target_path: longPath },
        request_id: "long1",
        budget: { max_response_bytes: 2048 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
        "template.project.open_project_in_tab": () => {
          openCalls += 1;
          return { ok: true, result: { summary: {} } };
        },
      }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(blocked.error.details?.zero_write, true);
    assert.equal(openCalls, 0);
    assert.ok(blocked.error.details?.request_patch?.input?.note || blocked.error.details?.zero_write === true);
    assert.ok(blocked.budget.actual_bytes <= 2048);

    // Raising caller budget cannot bypass the product public 2048 Macro ceiling for long identity.
    openCalls = 0;
    const stillBlocked = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "open_project_in_tab", target_path: longPath },
        request_id: "long2",
        budget: { max_response_bytes: 8192 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
        "template.project.open_project_in_tab": () => {
          openCalls += 1;
          return { ok: true, result: { summary: {} } };
        },
      }),
    });
    assert.equal(stillBlocked.ok, false);
    assert.equal(stillBlocked.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(stillBlocked.error.details?.zero_write, true);
    assert.equal(openCalls, 0);
    assert.ok(stillBlocked.budget.actual_bytes <= 2048);
  });

  it("hydrates multi-page inventory and finds a target only on the last page", async () => {
    const rows = [
      row("/session/a.RPP", { active: true, tab_index: 0 }),
      row("/session/b.RPP", { tab_index: 1 }),
      row("/session/c.RPP", { tab_index: 2 }),
    ];
    const index = makeIndex({ project_ref: "project:path:/session/a.RPP", project_path: "/session/a.RPP" });
    let listCalls = 0;
    const listBudgets = [];
    const envelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "activate_project_tab", project_ref: "project:path:/session/c.RPP" },
        request_id: "page-last",
        budget: { max_response_bytes: 2048, max_items: 1, max_inline_value_bytes: 256 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": (input, _refs, call) => {
          listCalls += 1;
          listBudgets.push(call.budget);
          const cursor = Number(input.cursor || 0);
          return makeInventory(rows, { cursor, limit: 1, total: rows.length });
        },
        "template.project.activate_project_tab": () => ({
          ok: true,
          result: {
            summary: {
              activated: true,
              already_active: false,
              project_ref: "project:path:/session/c.RPP",
              prior_project_remains_open: true,
              prior_dirty_unchanged: true,
              live_materialization: "native_activate_verified",
            },
          },
        }),
      }),
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    assert.ok(listCalls >= 3, `expected multi-page hydration, got ${listCalls}`);
    assert.ok(listBudgets.every((budget) => budget.max_response_bytes >= 32_768));
    assert.ok(listBudgets.every((budget) => budget.max_inline_value_bytes >= 4096));
    assert.ok(listBudgets.every((budget) => budget.max_items === 1));
    assert.ok(envelope.budget.actual_bytes <= 2048, envelope.budget.actual_bytes);
  });

  it("fails closed on paged/null cursor, zero-row incomplete, and repeated cursor", async () => {
    const pathA = "/session/Parent.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    const cases = [
      {
        name: "paged_without_cursor",
        handler: () => ({
          ok: true,
          result: {
            summary: {
              projects: [row(pathA, { active: true })],
              total_count: 2,
              returned_count: 1,
              cursor: 0,
              next_cursor: null,
              coverage_status: "paged",
              truncated: true,
            },
          },
        }),
        code: "PROJECT_FILE_INVENTORY_PAGED_WITHOUT_CURSOR",
      },
      {
        name: "zero_row",
        handler: () => ({
          ok: true,
          result: {
            summary: {
              projects: [],
              total_count: 2,
              returned_count: 0,
              cursor: 0,
              next_cursor: "1",
              coverage_status: "paged",
              truncated: true,
            },
          },
        }),
        code: "PROJECT_FILE_INVENTORY_ZERO_PAGE",
      },
      {
        name: "repeat_cursor",
        handler: () => ({
          ok: true,
          result: {
            summary: {
              projects: [row(pathA, { active: true })],
              total_count: 2,
              returned_count: 1,
              cursor: 0,
              next_cursor: "0",
              coverage_status: "paged",
              truncated: true,
            },
          },
        }),
        code: "PROJECT_FILE_INVENTORY_CURSOR_STALLED",
      },
    ];
    for (const testCase of cases) {
      const envelope = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: { operation: "activate_project_tab", project_ref: "project:path:/session/Other.RPP" },
          request_id: testCase.name,
          budget: { max_response_bytes: 4096 },
        },
        projectIndexRuntime: index,
        executeAtomic: makeExecutor({
          "template.project.list_open_projects": testCase.handler,
        }),
      });
      assert.equal(envelope.ok, false, testCase.name);
      assert.equal(envelope.error.code, testCase.code, testCase.name);
      assert.equal(envelope.result.data?.zero_write ?? envelope.error.details?.zero_write, true);
    }
  });

  it("opens exact path, rebinds index, and reports truthful sqlite used", async () => {
    const pathA = "/session/Parent.RPP";
    const pathB = "/session/Child.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    const envelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "open_project_in_tab", target_path: pathB },
        request_id: "open1",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true, dirty: 2 })]),
        "template.project.open_project_in_tab": () => ({
          ok: true,
          result: {
            summary: {
              opened: true,
              project_ref: `project:path:${pathB}`,
              path: pathB,
              active: true,
              prior_project_remains_open: true,
              prior_dirty_unchanged: true,
              prior_raw_dirty_state: 2,
              live_materialization: "native_open_in_tab_verified",
            },
          },
        }),
      }),
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    assert.equal(envelope.result.changes[0].status, "applied");
    assert.equal(envelope.result.changes[0].live_readback.status, "passed");
    assert.equal(envelope.sqlite.used, true);
    assert.equal(envelope.sqlite.source, "warm_index");
    assert.equal(index.status().project_path, pathB);
    assert.ok(envelope.budget.actual_bytes <= 4096);
  });

  it("already-active is idempotent with mutation not_run and unsaved refs fail closed", async () => {
    const pathA = "/session/Parent.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    let activateCalls = 0;
    const already = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "activate_project_tab", project_ref: `project:path:${pathA}` },
        request_id: "already",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
        "template.project.activate_project_tab": () => {
          activateCalls += 1;
          return { ok: true, result: { summary: {} } };
        },
      }),
    });
    assert.equal(already.ok, true, JSON.stringify(already.error));
    assert.equal(activateCalls, 0);
    assert.equal(already.result.data.outcome.mutation.status, "not_run");
    assert.equal(already.result.changes[0].mutation.status, "not_run");

    const unsaved = planAlpha3_2C3DProjectFileMacro({
      operation: "activate_project_tab",
      project_ref: "project:tab:token1",
    });
    assert.equal(unsaved.ok, false);
    assert.equal(unsaved.blockers[0].code, "PROJECT_FILE_UNSAVED_REF_UNSUPPORTED");
  });

  it("clean unsaved active recovers via live inventory only; dirty unsaved fails closed zero-write", async () => {
    const pathTarget = "/session/SavedTarget.RPP";
    let rebindCalls = 0;
    let activateCalls = 0;
    const index = {
      ...makeIndex({ project_ref: "project:path:/session/Stale.RPP", project_path: "/session/Stale.RPP" }),
      rebindProjectIdentity: async (args) => {
        rebindCalls += 1;
        return {
          ok: true,
          status: "rebound",
          scopes: ["project_identity"],
          project_path: args.project_path,
          project_ref: `project:path:${args.project_path}`,
        };
      },
      status: () => ({
        project_ref: "project:path:/session/Stale.RPP",
        project_path: "/session/Stale.RPP",
      }),
    };

    const clean = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "activate_project_tab", project_ref: `project:path:${pathTarget}` },
        request_id: "clean-unsaved-active",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([
          row("", { active: true, dirty: 0, unsaved: true, tab_index: 0 }),
          row(pathTarget, { active: false, dirty: 0, tab_index: 1 }),
        ]),
        "template.project.activate_project_tab": () => {
          activateCalls += 1;
          return {
            ok: true,
            result: {
              summary: {
                activated: true,
                already_active: false,
                project_ref: `project:path:${pathTarget}`,
                prior_project_remains_open: true,
                prior_dirty_unchanged: true,
                live_materialization: "native_activate_verified",
              },
            },
          };
        },
      }),
    });
    assert.equal(clean.ok, true, JSON.stringify(clean.error));
    assert.equal(activateCalls, 1);
    // Preflight must not authorize from SQLite while active is unsaved; rebind only after success.
    assert.equal(rebindCalls, 1);
    assert.equal(clean.result.data.project_ref, `project:path:${pathTarget}`);
    assert.equal(clean.result.data.outcome.mutation.status, "completed");
    assert.ok(clean.execution.stages.some((stage) => (
      stage.id === "file-index-preflight-sync"
      && stage.status === "skipped"
    )));

    activateCalls = 0;
    rebindCalls = 0;
    const dirty = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "activate_project_tab", project_ref: `project:path:${pathTarget}` },
        request_id: "dirty-unsaved-active",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([
          row("", { active: true, dirty: 3, unsaved: true, tab_index: 0 }),
          row(pathTarget, { active: false, dirty: 0, tab_index: 1 }),
        ]),
        "template.project.activate_project_tab": () => {
          activateCalls += 1;
          return { ok: true, result: { summary: {} } };
        },
      }),
    });
    assert.equal(dirty.ok, false);
    assert.equal(dirty.error.code, "PROJECT_FILE_ACTIVE_UNSAVED");
    assert.equal(dirty.error.details?.zero_write ?? dirty.blockers?.[0]?.details?.zero_write, true);
    assert.equal(activateCalls, 0);
    assert.equal(rebindCalls, 0);

    for (const missingField of ["saved", "dirty"]) {
      const incompleteActive = row("", { active: true, dirty: 0, unsaved: true, tab_index: 0 });
      delete incompleteActive[missingField];
      const incomplete = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: { operation: "activate_project_tab", project_ref: `project:path:${pathTarget}` },
          request_id: `incomplete-unsaved-${missingField}`,
          budget: { max_response_bytes: 4096 },
        },
        projectIndexRuntime: index,
        executeAtomic: makeExecutor({
          "template.project.list_open_projects": () => makeInventory([
            incompleteActive,
            row(pathTarget, { active: false, dirty: 0, tab_index: 1 }),
          ]),
          "template.project.activate_project_tab": () => {
            activateCalls += 1;
            return { ok: true, result: { summary: {} } };
          },
        }),
      });
      assert.equal(incomplete.ok, false, missingField);
      assert.equal(incomplete.error.code, "PROJECT_FILE_ACTIVE_UNSAVED", missingField);
      assert.equal(incomplete.error.details?.zero_write ?? incomplete.blockers?.[0]?.details?.zero_write, true, missingField);
      assert.equal(activateCalls, 0, missingField);
      assert.equal(rebindCalls, 0, missingField);
    }
  });

  it("preserves nonrecoverable unknown timeout truth for create/open/activate atoms", async () => {
    const sourcePath = "/session/Source.RPP";
    const targetPath = "/session/Target.RPP";
    const timeout = () => ({
      ok: false,
      queue: { state: "timeout" },
      error: {
        code: "BRIDGE_TIMEOUT",
        message: "Bridge request exceeded timeout_ms before a terminal result.",
        recoverable: false,
        details: {
          outcome: "unknown",
          reason: "continuation_timeout",
          queue_state: "timeout",
          timeout_ms: 30000,
          partial_state: "project_tabs_may_have_changed",
        },
      },
    });
    const cases = [
      {
        operation: "create_project_tab",
        input: { name: "timeout", target_path: targetPath, overwrite: true },
        atom: "template.project.create_project_tab",
        rows: [row(sourcePath, { active: true })],
      },
      {
        operation: "open_project_in_tab",
        input: { target_path: targetPath },
        atom: "template.project.open_project_in_tab",
        rows: [row(sourcePath, { active: true })],
      },
      {
        operation: "activate_project_tab",
        input: { project_ref: `project:path:${targetPath}` },
        atom: "template.project.activate_project_tab",
        rows: [row(sourcePath, { active: true }), row(targetPath, { active: false, tab_index: 1 })],
      },
    ];

    for (const fixture of cases) {
      let atomCalls = 0;
      const envelope = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: { operation: fixture.operation, ...fixture.input },
          request_id: `timeout-${fixture.operation}`,
          budget: { max_response_bytes: 2048 },
        },
        executeAtomic: makeExecutor({
          "template.project.list_open_projects": () => makeInventory(fixture.rows),
          [fixture.atom]: () => {
            atomCalls += 1;
            return timeout();
          },
        }),
      });

      assert.equal(atomCalls, 1, fixture.operation);
      assert.equal(envelope.ok, false, fixture.operation);
      assert.equal(envelope.execution.status, "partial_failure", fixture.operation);
      assert.equal(envelope.result.data.outcome.mutation.status, "unknown", fixture.operation);
      assert.equal(envelope.result.data.outcome.live_readback.status, "not_run", fixture.operation);
      assert.equal(envelope.error.code, "BRIDGE_TIMEOUT", fixture.operation);
      assert.equal(envelope.error.recoverable, false, fixture.operation);
      assert.equal(envelope.error.details?.outcome, "unknown", fixture.operation);
      assert.equal(envelope.error.details?.reason, "continuation_timeout", fixture.operation);
      assert.equal(envelope.error.details?.queue_state, "timeout", fixture.operation);
      assert.equal(envelope.error.details?.timeout_ms, 30000, fixture.operation);
      assert.equal(envelope.error.details?.partial_state, "project_tabs_may_have_changed", fixture.operation);
      assert.equal(envelope.error.details?.recoverable, false, fixture.operation);
      assert.equal(envelope.blockers[0].recoverable, false, fixture.operation);
      assert.equal(envelope.blockers[0].details?.outcome, "unknown", fixture.operation);
      assert.match(envelope.recovery.action, /do not replay/i, fixture.operation);
      assert.ok(envelope.budget.actual_bytes <= 4096, `${fixture.operation}: ${envelope.budget.actual_bytes}`);
    }
  });

  it("preserves partial_state across create atom success and Save As/readback failures", async () => {
    const pathA = "/session/Parent.RPP";
    const pathNew = "/session/New.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });

    const createOnlyFail = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: {
          operation: "create_project_tab",
          name: "sound design",
          target_path: pathNew,
          overwrite: true,
          copy_active_project_settings: false,
        },
        request_id: "create-partial",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
        "template.project.create_project_tab": () => ({
          ok: true,
          result: {
            summary: {
              created: true,
              active: true,
              prior_dirty_unchanged: true,
              project_ref: "project:tab:t1",
              live_materialization: "native_project_tab_verified",
            },
          },
        }),
        "template.project.save_project_as": () => ({
          ok: false,
          error: { code: "SAVE_AS_FAILED", message: "save as failed", details: { partial_state: "blank_tab_may_remain" } },
        }),
      }),
    });
    assert.equal(createOnlyFail.ok, false);
    assert.equal(createOnlyFail.execution.status, "partial_failure");
    assert.equal(
      createOnlyFail.error.details?.partial_state
        ?? createOnlyFail.result.data?.partial_state,
      "blank_tab_may_remain",
    );

    for (const requestId of ["", 42]) {
      const indexFail = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: {
            operation: "create_project_tab",
            name: "sound design",
            target_path: pathNew,
            overwrite: true,
            copy_active_project_settings: false,
          },
          request_id: requestId,
          budget: { max_response_bytes: 4096 },
        },
        projectIndexRuntime: {
          ...index,
          rebindProjectIdentity: async (args) => {
            if (args.project_path === pathNew) {
              return { ok: false, blockers: [{ code: "INDEX_FAIL", message: "index fail" }], scopes: [] };
            }
            return index.rebindProjectIdentity(args);
          },
        },
        executeAtomic: makeExecutor({
          "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
          "template.project.create_project_tab": () => ({
            ok: true,
            result: {
              summary: {
                created: true,
                active: true,
                prior_dirty_unchanged: true,
                project_ref: "project:tab:t1",
                live_materialization: "native_project_tab_verified",
              },
            },
          }),
          "template.project.save_project_as": () => ({ ok: true, result: { summary: { path_matches_target: true } } }),
          "template.project.read_current_project_path": () => ({
            ok: true,
            result: { summary: { path: pathNew, has_project_path: true, path_state: "saved_project" } },
          }),
          "template.project.read_dirty_state": () => ({
            ok: true,
            result: { summary: { dirty: false, dirty_state: "clean", raw_dirty_state: 0 } },
          }),
        }),
      });
      assert.equal(indexFail.ok, false);
      assert.equal(indexFail.execution.status, "partial_failure");
      assert.equal(indexFail.result.changes[0].status, "applied");
      assert.equal(indexFail.result.changes[0].live_readback.status, "passed");
      assert.equal(indexFail.result.changes[0].index_maintenance.status, "failed");
      assert.equal(indexFail.sqlite.used, true);
      assert.equal(indexFail.request.request_id, "macro.project.file");
      assert.deepEqual(validateMacroExecutionEnvelope(indexFail), { valid: true, errors: [] });
    }
  });

  it("rejects wrong native readback without applying and rejects dry_run for switch ops", async () => {
    const pathA = "/session/Parent.RPP";
    const pathB = "/session/Child.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    const wrong = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "open_project_in_tab", target_path: pathB },
        request_id: "wrong-readback",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": () => makeInventory([row(pathA, { active: true })]),
        "template.project.open_project_in_tab": () => ({
          ok: true,
          result: {
            summary: {
              opened: true,
              project_ref: "project:path:/session/Wrong.RPP",
              path: "/session/Wrong.RPP",
              active: true,
              prior_project_remains_open: true,
              prior_dirty_unchanged: true,
              live_materialization: "native_open_in_tab_verified",
            },
          },
        }),
      }),
    });
    assert.equal(wrong.ok, false);
    assert.equal(wrong.error.code, "PROJECT_FILE_OPEN_READBACK_FAILED");
    assert.equal((wrong.result.changes ?? []).length, 0);

    const dry = planAlpha3_2C3DProjectFileMacro({
      operation: "open_project_in_tab",
      target_path: pathB,
      dry_run: true,
    });
    assert.equal(dry.ok, false);
    assert.equal(dry.blockers[0].code, "PROJECT_FILE_DRY_RUN_UNSUPPORTED");
  });

  it("plans all six operations without held open/create blockers", () => {
    for (const operation of SIX_OPS) {
      const input = operation === "save_current"
        ? { operation }
        : operation === "save_as"
          ? { operation, target_path: "/session/a.RPP", overwrite: true }
          : operation === "list_open_projects"
            ? { operation, cursor: "0", limit: 10 }
            : operation === "create_project_tab"
              ? {
                operation,
                name: "n",
                target_path: "/session/n.RPP",
                overwrite: true,
                copy_active_project_settings: false,
              }
              : operation === "open_project_in_tab"
                ? { operation, target_path: "/session/o.RPP" }
                : { operation, project_ref: "project:path:/session/a.RPP" };
      const plan = planAlpha3_2C3DProjectFileMacro(input);
      assert.equal(plan.ok, true, operation);
      assert.equal(plan.operation, operation);
    }
  });

  it("separates public 2048 Macro envelope from internal atomic child budgets for mutations and saves", async () => {
    const internal = getAlpha3ProjectFileInternalAtomicChildBudget();
    assert.equal(internal.max_response_bytes, 65_536);
    assert.ok(internal.max_inline_value_bytes >= 4_096);
    assert.equal(internal.max_items, 100);

    const pathA = "/session/Parent.RPP";
    const pathNew = "/session/Created.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    const childBudgets = [];
    const envelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: {
          operation: "create_project_tab",
          name: "budget-proof",
          target_path: pathNew,
          overwrite: true,
          copy_active_project_settings: false,
        },
        request_id: "internal-budget",
        budget: { max_response_bytes: 2048, max_items: 25, max_inline_value_bytes: 256 },
      },
      projectIndexRuntime: index,
      executeAtomic: async (call) => {
        childBudgets.push(call.budget);
        if (call.id === "template.project.list_open_projects") {
          return makeInventory([row(pathA, { active: true })]);
        }
        if (call.id === "template.project.create_project_tab") {
          return {
            ok: true,
            result: {
              summary: {
                created: true,
                active: true,
                prior_dirty_unchanged: true,
                project_ref: "project:tab:t1",
                live_materialization: "native_project_tab_verified",
              },
            },
          };
        }
        if (call.id === "template.project.save_project_as") {
          return { ok: true, result: { summary: { path_matches_target: true } } };
        }
        if (call.id === "template.project.read_current_project_path") {
          return {
            ok: true,
            result: { summary: { path: pathNew, has_project_path: true, path_state: "saved_project" } },
          };
        }
        if (call.id === "template.project.read_dirty_state") {
          return {
            ok: true,
            result: { summary: { dirty: false, dirty_state: "clean", raw_dirty_state: 0 } },
          };
        }
        return { ok: false, error: { code: "UNEXPECTED", message: call.id } };
      },
    });
    assert.equal(envelope.ok, true, JSON.stringify(envelope.error));
    assert.equal(envelope.budget.max_bytes, 2048);
    assert.equal(envelope.budget.actual_bytes, Buffer.byteLength(JSON.stringify(envelope)));
    assert.ok(envelope.budget.actual_bytes <= 2048, `public envelope ${envelope.budget.actual_bytes}`);
    assert.ok(childBudgets.length >= 2);
    for (const budget of childBudgets) {
      assert.equal(budget.max_response_bytes, 65_536, JSON.stringify(budget));
      assert.ok(budget.max_inline_value_bytes >= 4_096);
      assert.notEqual(budget.max_response_bytes, 2048);
    }

    const saveBudgets = [];
    const saveEnvelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "save_current" },
        request_id: "save-public-budget",
        budget: { max_response_bytes: 2048 },
      },
      projectIndexRuntime: index,
      executeAtomic: async (call) => {
        saveBudgets.push(call.budget);
        if (call.id === "template.project.read_current_project_path") {
          return {
            ok: true,
            result: { summary: { path: pathA, has_project_path: true, path_state: "saved_project" } },
          };
        }
        if (call.id === "template.project.read_dirty_state") {
          return {
            ok: true,
            result: { summary: { dirty: false, dirty_state: "clean", raw_dirty_state: 0 } },
          };
        }
        if (call.id === "template.project.save_current_project") {
          return { ok: true, result: { summary: { saved: true } } };
        }
        return { ok: false, error: { code: "UNEXPECTED", message: call.id } };
      },
    });
    assert.equal(saveEnvelope.ok, true, JSON.stringify(saveEnvelope.error));
    assert.equal(saveEnvelope.budget.max_bytes, 2048);
    assert.equal(saveEnvelope.budget.actual_bytes, Buffer.byteLength(JSON.stringify(saveEnvelope)));
    assert.ok(saveEnvelope.budget.actual_bytes <= 2048, `save envelope ${saveEnvelope.budget.actual_bytes}`);
    assert.ok(saveBudgets.every((budget) => budget.max_response_bytes === 65_536));
  });

  it("returns a typed zero-write block for mutation budgets below 2048 before atomic dispatch or index access", async () => {
    const mutationInputs = [
      { operation: "save_current" },
      { operation: "save_current", dry_run: true },
      { operation: "save_as", target_path: "/session/Saved.RPP", overwrite: true },
      { operation: "create_project_tab", name: "new", target_path: "/session/New.RPP", overwrite: true, copy_active_project_settings: false },
      { operation: "open_project_in_tab", target_path: "/session/Open.RPP" },
      { operation: "activate_project_tab", project_ref: "project:path:/session/Active.RPP" },
    ];
    for (const input of mutationInputs) {
      for (const maxBytes of [1, 512, 900, 1024, 1200, 2047]) {
        let atomicCalls = 0;
        let indexCalls = 0;
        const envelope = await executeAlpha3_2_5CProjectFileMacro({
          request: {
            input,
            request_id: `budget-too-small-${input.operation}-${maxBytes}`,
            budget: { max_response_bytes: maxBytes },
          },
          projectIndexRuntime: {
            status: () => { indexCalls += 1; return {}; },
            invalidateScopes: async () => { indexCalls += 1; return { ok: true }; },
          },
          executeAtomic: async () => {
            atomicCalls += 1;
            return { ok: true, result: { summary: {} } };
          },
        });
        assert.equal(envelope.contract, "macro.execution.v1");
        assert.equal(envelope.ok, false);
        assert.equal(envelope.execution.status, "blocked");
        assert.equal(envelope.request.dry_run, input.dry_run === true);
        assert.equal(envelope.error.code, "PROJECT_FILE_RESPONSE_BUDGET_TOO_SMALL");
        assert.equal(envelope.error.details?.operation, input.operation);
        assert.equal(envelope.error.details?.requested_max_response_bytes, maxBytes);
        assert.equal(envelope.error.details?.required_minimum_bytes, 2048);
        assert.equal(envelope.error.details?.zero_write, true);
        assert.equal(envelope.result.data.zero_write, true);
        assert.equal(envelope.budget.max_bytes, 2048);
        assert.equal(envelope.budget.actual_bytes, Buffer.byteLength(JSON.stringify(envelope), "utf8"));
        assert.ok(envelope.budget.actual_bytes <= envelope.budget.max_bytes);
        assert.deepEqual(validateMacroExecutionEnvelope(envelope), { valid: true, errors: [] });
        assert.equal(atomicCalls, 0, `${input.operation}:${maxBytes}`);
        assert.equal(indexCalls, 0, `${input.operation}:${maxBytes}`);
      }
    }
  });

  it("zero-write rejects identity that cannot fit the public 2048 envelope with honest bytes", async () => {
    const longPath = `/session/${"y".repeat(1800)}.RPP`;
    const pathA = "/session/Parent.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });
    for (const maxBytes of [2048]) {
      let mutationCalls = 0;
      const blocked = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: { operation: "open_project_in_tab", target_path: longPath },
          request_id: `public-identity-gate-${maxBytes}`,
          budget: { max_response_bytes: maxBytes },
        },
        projectIndexRuntime: index,
        executeAtomic: async ({ id }) => {
          if (id === "template.project.list_open_projects") {
            return makeInventory([row(pathA, { active: true })]);
          }
          mutationCalls += 1;
          return { ok: true, result: { summary: {} } };
        },
      });
      assert.equal(blocked.ok, false, String(maxBytes));
      assert.equal(blocked.error.code, "RESPONSE_TOO_LARGE", String(maxBytes));
      assert.equal(blocked.error.details?.zero_write ?? blocked.blockers?.[0]?.details?.zero_write, true, String(maxBytes));
      assert.equal(mutationCalls, 0, String(maxBytes));
      assert.equal(blocked.budget.max_bytes, Math.min(maxBytes, 2048), String(maxBytes));
      assert.equal(blocked.budget.actual_bytes, Buffer.byteLength(JSON.stringify(blocked)), String(maxBytes));
      assert.ok(blocked.budget.actual_bytes <= blocked.budget.max_bytes, String(maxBytes));
      assert.equal(blocked.budget.truncated, false, String(maxBytes));
      assert.equal(blocked.request.request_id, `public-identity-gate-${maxBytes}`, String(maxBytes));
    }
  });

  it("preflights medium save/open identities or preserves their full applied truth", async () => {
    const pathA = "/session/Parent.RPP";
    const index = makeIndex({ project_ref: `project:path:${pathA}`, project_path: pathA });

    for (const length of [50, 150]) {
      const targetPath = `/s/${"x".repeat(length)}.RPP`;
      let atomicCalls = 0;
      let saveCalls = 0;
      let indexCalls = 0;
      const envelope = await executeAlpha3_2_5CProjectFileMacro({
        request: {
          input: { operation: "save_as", target_path: targetPath, overwrite: true },
          request_id: `save-as-identity-${length}`,
          budget: { max_response_bytes: 2048 },
        },
        projectIndexRuntime: {
          ...index,
          rebindProjectIdentity: async (args) => {
            indexCalls += 1;
            return index.rebindProjectIdentity(args);
          },
        },
        executeAtomic: async ({ id }) => {
          atomicCalls += 1;
          if (id === "template.project.read_current_project_path") {
            const path = saveCalls === 0 ? pathA : targetPath;
            return { ok: true, result: { summary: { path, has_project_path: true, path_state: "saved_project" } } };
          }
          if (id === "template.project.read_dirty_state") {
            return { ok: true, result: { summary: { dirty: false, dirty_state: "clean", raw_dirty_state: 0 } } };
          }
          if (id === "template.project.save_project_as") {
            saveCalls += 1;
            return { ok: true, result: { summary: { path_matches_target: true } } };
          }
          return { ok: false, error: { code: "UNEXPECTED", message: id } };
        },
      });

      assert.equal(envelope.budget.actual_bytes, Buffer.byteLength(JSON.stringify(envelope)), String(length));
      assert.ok(envelope.budget.actual_bytes <= 2048, String(length));
      if (envelope.ok) {
        assert.equal(saveCalls, 1, String(length));
        assert.equal(indexCalls, 1, String(length));
        assert.equal(envelope.result.changes.length, 1, String(length));
        assert.equal(envelope.result.changes[0].status, "applied", String(length));
        assert.equal(envelope.result.changes[0].path, targetPath, String(length));
        assert.equal(envelope.result.data.path_after, targetPath, String(length));
      } else {
        assert.equal(envelope.error.code, "RESPONSE_TOO_LARGE", String(length));
        assert.equal(envelope.error.details?.zero_write ?? envelope.blockers[0]?.details?.zero_write, true, String(length));
        assert.equal(atomicCalls, 0, String(length));
        assert.equal(saveCalls, 0, String(length));
        assert.equal(indexCalls, 0, String(length));
      }
    }

    const openPath = `/s/${"z".repeat(200)}.RPP`;
    let openAtomicCalls = 0;
    const openBlocked = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "open_project_in_tab", target_path: openPath },
        request_id: "open-medium-identity",
        budget: { max_response_bytes: 2048 },
      },
      projectIndexRuntime: index,
      executeAtomic: async () => {
        openAtomicCalls += 1;
        return { ok: true, result: { summary: {} } };
      },
    });
    assert.equal(openBlocked.ok, false);
    assert.equal(openBlocked.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(openBlocked.error.details?.zero_write ?? openBlocked.blockers[0]?.details?.zero_write, true);
    assert.equal(openAtomicCalls, 0);
    assert.equal(openBlocked.request.request_id, "open-medium-identity");
    assert.equal(openBlocked.budget.actual_bytes, Buffer.byteLength(JSON.stringify(openBlocked)));
    assert.ok(openBlocked.budget.actual_bytes <= 2048);
  });
});
