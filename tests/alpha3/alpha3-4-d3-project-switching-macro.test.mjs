import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
  createAlpha3_2C3DProjectFileMacroDiscoveryItems,
  executeAlpha3_2_5CProjectFileMacro,
  planAlpha3_2C3DProjectFileMacro,
} from "../../packages/mcp-server/src/alpha3-2c3d-project-file-macro-v1.mjs";
import { CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

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
  return async ({ id, input, refs }) => {
    const handler = handlers[id];
    if (!handler) return { ok: false, error: { code: "MISSING", message: `no handler ${id}` } };
    return handler(input, refs);
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
  it("exposes six operations in discovery and keeps 235 product live templates", () => {
    const items = createAlpha3_2C3DProjectFileMacroDiscoveryItems();
    assert.equal(items.length, 1);
    assert.deepEqual(items[0].inputSchema.properties.operation.enum, SIX_OPS);
    assert.equal(CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.length, 235);
    assert.equal(ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION, "1.2.0");
    assert.equal(ALPHA3_2C3D_PROJECT_FILE_MACRO_ID, "macro.project.file");
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
      assert.ok(envelope.error.details?.request_patch?.budget?.max_response_bytes > 2048
        || envelope.error.details?.request_patch?.input?.limit < 12);
    }
  });

  it("returns typed RESPONSE_TOO_LARGE before mutation for oversized identity and supports larger budget recovery", async () => {
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
    assert.ok(blocked.error.details?.request_patch?.budget?.max_response_bytes >= 4096);

    openCalls = 0;
    const recovered = await executeAlpha3_2_5CProjectFileMacro({
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
          return {
            ok: true,
            result: {
              summary: {
                opened: true,
                project_ref: `project:path:${longPath}`,
                path: longPath,
                active: true,
                prior_project_remains_open: true,
                prior_dirty_unchanged: true,
                live_materialization: "native_open_in_tab_verified",
              },
            },
          };
        },
      }),
    });
    assert.equal(recovered.ok, true, JSON.stringify(recovered.error));
    assert.equal(openCalls, 1);
    assert.ok(recovered.budget.actual_bytes <= 8192);
  });

  it("hydrates multi-page inventory and finds a target only on the last page", async () => {
    const rows = [
      row("/session/a.RPP", { active: true, tab_index: 0 }),
      row("/session/b.RPP", { tab_index: 1 }),
      row("/session/c.RPP", { tab_index: 2 }),
    ];
    const index = makeIndex({ project_ref: "project:path:/session/a.RPP", project_path: "/session/a.RPP" });
    let listCalls = 0;
    const envelope = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: { operation: "activate_project_tab", project_ref: "project:path:/session/c.RPP" },
        request_id: "page-last",
        budget: { max_response_bytes: 4096 },
      },
      projectIndexRuntime: index,
      executeAtomic: makeExecutor({
        "template.project.list_open_projects": (input) => {
          listCalls += 1;
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

    const indexFail = await executeAlpha3_2_5CProjectFileMacro({
      request: {
        input: {
          operation: "create_project_tab",
          name: "sound design",
          target_path: pathNew,
          overwrite: true,
          copy_active_project_settings: false,
        },
        request_id: "create-index-fail",
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
});
