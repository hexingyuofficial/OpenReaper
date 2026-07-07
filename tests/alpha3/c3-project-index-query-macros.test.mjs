import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY,
  ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
  createAlpha3C3OfficialQueryMacroDiscoveryItems,
  createAlpha3C3ProjectIndexSchemaContract,
  listAlpha3C3ProjectIndexQueryMacros,
  planAlpha3C3ProjectIndexQueryMacro,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha3 C3 Project SQLite Index query macros", () => {
  it("registers the project index contract without adding tools or changing truth source", () => {
    const registry = listAlpha3C3ProjectIndexQueryMacros();
    const schema = createAlpha3C3ProjectIndexSchemaContract();

    assert.equal(registry.contract, ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT);
    assert.equal(registry.mode, "plan_only_project_index_query_macros");
    assert.deepEqual(registry.tool_surface, {
      added_tools: 0,
      discovery_tools: ["list_templates"],
      execution_tool: "call_template",
      artifact_tool: "get_state",
    });
    assert.equal(schema.truth_boundary.project_truth, "REAPER");
    assert.equal(schema.truth_boundary.index_role, "local_query_navigation_cache");
    assert.equal(schema.truth_boundary.capability_truth, "runtime_catalog_not_sqlite");
    assert.equal(schema.tables.includes("tracks"), true);
    assert.equal(schema.tables.includes("freshness_scopes"), true);
    assert.equal(schema.tables.includes("object_changes"), true);
    assert.equal(registry.write_safety_loop.sqlite_may_authorize_write, false);
    assert.deepEqual(registry.write_safety_loop.required_sequence, [
      "select_candidate_refs_from_project_index",
      "re_resolve_targets_in_reaper",
      "execute_through_accepted_call_template_or_macro",
      "batch_readback_from_reaper",
      "update_artifact_store_and_project_index_after_readback",
    ]);
    assert.equal(registry.macros.find((macro) => macro.id === "macro.index_status").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_tracks").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_items").status, "planned");
  });

  it("creates official query macro discovery entries over list_templates/call_template", () => {
    const entries = createAlpha3C3OfficialQueryMacroDiscoveryItems();
    const status = entries.find((entry) => entry.id === "macro.index_status");
    const tracks = entries.find((entry) => entry.id === "macro.query_tracks");
    const items = entries.find((entry) => entry.id === "macro.query_items");

    assert.equal(entries.length, 11);
    assert.equal(status.kind, "official_macro");
    assert.equal(status.action_kind, "macro");
    assert.equal(status.menu_group, "query");
    assert.equal(status.macro_kind, "project_index_query");
    assert.equal(status.execution_shape, "project_index_query_plan");
    assert.equal(status.live_runnable_now, true);
    assert.equal(status.support_state, "supported");
    assert.equal(tracks.inputSchema.properties.filters.type, "object");
    assert.equal(tracks.expectedDelta.summary, "Returns a plan-only Project SQLite Index query envelope. It does not mutate REAPER or execute SQL.");
    assert.equal(items.support_state, "blocked");
    assert.equal(items.known_blocker, "planned_after_c3_1");
  });

  it("reports index status and refresh requests when no project index exists yet", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.index_status", {
      limit: 12,
    });

    assert.equal(plan.ok, true);
    assert.equal(plan.id, "macro.index_status");
    assert.equal(plan.index_status.lifecycle, "missing");
    assert.equal(plan.storage.truth_source, "REAPER_project_state");
    assert.equal(plan.query_policy.raw_sql_exposed, false);
    assert.equal(plan.safety.added_tools, 0);
    assert.equal(plan.safety.hidden_executor, false);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.project.create_observation_bundle",
        "template.project.create_project_map_snapshot",
      ],
    );
  });

  it("blocks track queries until the task-scoped index scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 10,
      filters: { selected: true },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.tracks.list_tracks",
        "template.tracks.read_mixer_controls",
      ],
    );
    assert.equal(plan.write_safety_loop.sqlite_rows_are_candidates_only, true);
    assert.equal(plan.write_safety_loop.sqlite_may_authorize_write, false);
    assert.equal(plan.page.has_more, false);
  });

  it("queries compact track rows from a fresh injected project index adapter", () => {
    const projectIndex = readyProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 1,
      filters: {
        selected: true,
        has_fx: true,
      },
      fields: ["name", "selected", "fx_count", "payload_ref"],
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.rows.length, 1);
    assert.deepEqual(firstPage.refs, ["track:guid:{TRACK-1}"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "track:guid:{TRACK-1}",
      name: "Lead Vocal",
      selected: true,
      fx_count: 3,
      payload_ref: "artifact:tracks:1",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.complete, true);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.status, "planned");
    assert.equal(firstPage.hydrate_request.callable_now, false);
    assert.equal(firstPage.hydrate_request.planned_macro_id, "macro.hydrate_refs");
    assert.equal(firstPage.hydrate_request.blocker.code, "HYDRATE_REFS_PLANNED");
    assert.equal("tool" in firstPage.hydrate_request, false);

    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 1,
      cursor: firstPage.page.next_cursor,
      filters: {
        selected: true,
        has_fx: true,
      },
      fields: ["name"],
    }, { projectIndex });

    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["track:guid:{TRACK-3}"]);
    assert.equal(secondPage.page.has_more, false);
  });

  it("rejects raw SQL-shaped input instead of exposing database execution", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      raw_sql: "select * from tracks",
      filters: {
        where: "selected = true",
      },
      limit: 10,
    }, { projectIndex: readyProjectIndex() });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "RAW_SQL_NOT_ALLOWED"), true);
    assert.equal(plan.blockers.some((blocker) => blocker.field === "filters.where"), true);
    assert.equal(plan.query_policy.raw_sql_exposed, false);
    assert.equal(plan.safety.raw_sql_exposed, false);
    assert.equal(plan.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(plan.rows.length, 0);
  });

  it("exposes C3 query macros and metadata through the existing executable surface", () => {
    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates();
    const exact = runtime.list_templates({
      ids: ["macro.query_tracks"],
      fields: ["summary", "inputSchema", "expectedDelta", "task_intents", "capability_truth"],
    });

    assert.equal(menu.items.some((item) => item.id === "macro.index_status"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_tracks"), true);
    assert.deepEqual(
      menu.product_surface.project_index_queries,
      ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY,
    );
    assert.equal(menu.product_surface.project_index_queries.tool_surface.added_tools, 0);
    assert.equal(exact.items[0].id, "macro.query_tracks");
    assert.equal(exact.items[0].capability_truth.kind, "official_macro");
    assert.equal(exact.items[0].current_status, "available_now");
    assert.equal(exact.items[0].inputSchema.properties.filters.type, "object");
  });

  it("calls C3 query macro ids through call_template as plan-only envelopes", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T16:28:15.000Z"),
      projectIndex: readyProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_tracks",
      input: {
        limit: 2,
        filters: { selected: true },
        fields: ["name", "selected", "fx_count"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.error, null);
    assert.equal(response.template.id, "macro.query_tracks");
    assert.equal(response.template.action_kind, "macro");
    assert.equal(response.request.macro.contract, ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT);
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.alias_execution, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "track:guid:{TRACK-1}",
      "track:guid:{TRACK-3}",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.refresh_requests.length, 0);
    assert.equal(runtime.last_evidence().template.id, "macro.query_tracks");
  });

  it("returns typed planned blockers for future query macros through call_template", async () => {
    const runtime = createCallTemplateRuntime();
    const response = await runtime.call_template({
      id: "macro.query_items",
      input: { limit: 10 },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.source, "macro");
    assert.equal(response.error.code, "MACRO_PLANNED");
    assert.equal(response.result.plan.ok, false);
    assert.equal(response.result.rows.length, 0);
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.blockers[0].code, "MACRO_PLANNED");
  });
});

function readyProjectIndex() {
  return {
    lifecycle: "ready",
    schema_version: 1,
    db_path: "run_root/state/openreaper-project-index.sqlite",
    project_ref: "project:active",
    bridge_owner: "openreaper-alpha3-local",
    bridge_generation: 1,
    session_id: "session:alpha3-c3",
    snapshot_id: "snapshot:c3:001",
    freshness_scopes: {
      tracks: {
        scope_kind: "tracks",
        scope_ref: "project",
        snapshot_id: "snapshot:c3:001",
        status: "fresh",
        coverage_status: "complete",
        observed_at: "2026-07-07T16:20:00.000Z",
        source_template_id: "template.tracks.list_tracks",
      },
    },
    coverage: {
      tracks: "complete",
    },
    rows: {
      tracks: [
        {
          ref: "track:guid:{TRACK-1}",
          name: "Lead Vocal",
          index: 0,
          display_number: "1",
          selected: true,
          muted: false,
          solo: false,
          record_arm: false,
          folder_depth: 0,
          item_count: 8,
          fx_count: 3,
          send_count: 2,
          freshness_status: "fresh",
          coverage_status: "complete",
          observed_at: "2026-07-07T16:20:00.000Z",
          payload_ref: "artifact:tracks:1",
        },
        {
          ref: "track:guid:{TRACK-2}",
          name: "Drum Bus",
          index: 1,
          display_number: "2",
          selected: false,
          muted: false,
          solo: false,
          record_arm: false,
          folder_depth: 1,
          item_count: 12,
          fx_count: 4,
          send_count: 1,
          freshness_status: "fresh",
          coverage_status: "complete",
          observed_at: "2026-07-07T16:20:00.000Z",
          payload_ref: "artifact:tracks:2",
        },
        {
          ref: "track:guid:{TRACK-3}",
          name: "Guitar Double",
          index: 2,
          display_number: "3",
          selected: true,
          muted: false,
          solo: false,
          record_arm: true,
          folder_depth: 0,
          item_count: 5,
          fx_count: 2,
          send_count: 0,
          freshness_status: "fresh",
          coverage_status: "complete",
          observed_at: "2026-07-07T16:20:00.000Z",
          payload_ref: "artifact:tracks:3",
        },
      ],
    },
  };
}
