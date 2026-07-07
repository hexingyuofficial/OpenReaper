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
  createAlpha3C3ProjectIndex,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-store-v1.mjs";
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
    assert.equal(registry.macros.find((macro) => macro.id === "macro.hydrate_refs").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.changed_since").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_items").status, "planned");
  });

  it("creates official query macro discovery entries over list_templates/call_template", () => {
    const entries = createAlpha3C3OfficialQueryMacroDiscoveryItems();
    const status = entries.find((entry) => entry.id === "macro.index_status");
    const tracks = entries.find((entry) => entry.id === "macro.query_tracks");
    const hydrate = entries.find((entry) => entry.id === "macro.hydrate_refs");
    const changed = entries.find((entry) => entry.id === "macro.changed_since");
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
    assert.equal(hydrate.support_state, "supported");
    assert.equal(hydrate.known_blocker, null);
    assert.equal(changed.support_state, "supported");
    assert.equal(changed.known_blocker, null);
    assert.equal(items.support_state, "blocked");
    assert.equal(items.known_blocker, "planned_after_c3_3");
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
    assert.equal(firstPage.hydrate_request.status, "available");
    assert.equal(firstPage.hydrate_request.callable_now, true);
    assert.equal(firstPage.hydrate_request.tool, "call_template");
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(firstPage.hydrate_request.planned_macro_id, "macro.hydrate_refs");
    assert.equal(firstPage.hydrate_request.blocker, null);
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["track:guid:{TRACK-1}"]);

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

  it("plans exact ref hydration through accepted read templates", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.hydrate_refs", {
      refs: [
        "track:guid:{TRACK-1}",
        "item:guid:{ITEM-1}",
        "fx:track:{TRACK-1}:0",
        "send:track:{TRACK-1}:0",
        "envelope:track:{TRACK-1}:volume",
      ],
      fields: ["parameters"],
      detail: "hydrated",
      limit: 64,
    }, { projectIndex: readyProjectIndex() });

    assert.equal(plan.ok, true);
    assert.deepEqual(
      plan.hydrate_request.requests.map((request) => request.id),
      [
        "template.tracks.resolve_track_ref",
        "template.tracks.read_mixer_controls",
        "template.items.read_item_summary",
        "template.fx.read_fx_summary",
        "template.fx.list_fx_parameters",
        "template.routing.resolve_send_ref",
        "template.automation.read_envelope_summary",
      ],
    );
    assert.equal(plan.hydrate_request.requests.every((request) => request.tool === "call_template"), true);
    assert.equal(plan.hydrate_request.status, "planned_requests");
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.raw_sql_exposed, false);
    assert.equal(plan.safety.raw_lua_action_shell_or_ui, false);
    assert.equal(plan.safety.live_reaper, false);
    assert.equal(plan.result, undefined);
  });

  it("blocks unsupported hydration refs with typed blockers", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.hydrate_refs", {
      refs: ["file:/tmp/source.wav", "marker:guid:{MARKER-1}", "region:guid:{REGION-1}"],
      limit: 10,
    }, { projectIndex: readyProjectIndex() });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.filter((entry) => entry.code === "HYDRATE_REF_UNSUPPORTED").length, 3);
    assert.equal(plan.hydrate_request.requests.length, 0);
    assert.equal(plan.hydrate_request.status, "no_supported_refs");
    assert.equal(plan.rows[0].status, "blocked");
    assert.equal(plan.rows[1].ref_kind, "marker");
    assert.equal(plan.rows[2].ref_kind, "region");
  });

  it("reads changed-since rows from the project index store and keeps hydration explicit", () => {
    const projectIndex = changedProjectIndex();
    const first = planAlpha3C3ProjectIndexQueryMacro("macro.changed_since", {
      since: "2026-07-07T17:05:00.000Z",
      limit: 1,
    }, { projectIndex });
    const second = planAlpha3C3ProjectIndexQueryMacro("macro.changed_since", {
      since: "2026-07-07T17:05:00.000Z",
      limit: 1,
      cursor: first.page.next_cursor,
    }, { projectIndex });

    assert.equal(first.ok, true);
    assert.equal(first.rows.length, 1);
    assert.deepEqual(first.refs, ["track:guid:{TRACK-1}"]);
    assert.equal(first.rows[0].payload_ref, "artifact:readback:track");
    assert.equal(first.page.has_more, true);
    assert.equal(first.freshness.sqlite_is_truth, false);
    assert.equal(first.hydrate_request.callable_now, true);
    assert.equal(first.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(second.ok, true);
    assert.deepEqual(second.refs, ["item:guid:{ITEM-1}"]);
    assert.equal(second.page.has_more, false);
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
    assert.equal(response.result.hydrate_request.callable_now, true);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(runtime.last_evidence().template.id, "macro.query_tracks");
  });

  it("calls hydrate_refs and changed_since through call_template without executing child requests", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T17:25:00.000Z"),
      projectIndex: changedProjectIndex(),
    });
    const hydrate = await runtime.call_template({
      id: "macro.hydrate_refs",
      input: {
        refs: ["item:guid:{ITEM-1}"],
        limit: 10,
      },
    });
    const changed = await runtime.call_template({
      id: "macro.changed_since",
      input: {
        since: "2026-07-07T17:05:00.000Z",
        limit: 2,
      },
    });

    assert.equal(hydrate.ok, true);
    assert.equal(hydrate.result.execution.executed, false);
    assert.equal(hydrate.result.execution.hidden_executor, false);
    assert.deepEqual(
      hydrate.result.hydrate_request.requests.map((request) => request.id),
      ["template.items.read_item_summary"],
    );
    assert.equal(changed.ok, true);
    assert.equal(changed.result.execution.executed, false);
    assert.equal(changed.result.execution.hidden_executor, false);
    assert.equal(changed.result.rows.length, 2);
    assert.deepEqual(changed.result.refs, ["track:guid:{TRACK-1}", "item:guid:{ITEM-1}"]);
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

function changedProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T17:30:00.000Z"),
  });
  index.replaceTracks({
    snapshot_id: "snapshot:c3-3:tracks",
    observed_at: "2026-07-07T17:00:00.000Z",
    rows: [
      { ref: "track:guid:{TRACK-1}", name: "Lead Vocal" },
    ],
  });
  index.markWriteReadbackApplied({
    snapshot_id: "snapshot:c3-3:write",
    observed_at: "2026-07-07T17:10:00.000Z",
    refs: ["track:guid:{TRACK-1}"],
    payload_ref: "artifact:readback:track",
    change_kind: "track_controls_readback",
    change_id_prefix: "readback:c3-3",
  });
  index.recordObjectChanges({
    observed_at: "2026-07-07T17:12:00.000Z",
    changes: [
      {
        change_id: "change:item:1",
        ref: "item:guid:{ITEM-1}",
        owner_ref: "track:guid:{TRACK-1}",
        change_kind: "item_moved",
        summary: { source: "batch_readback" },
      },
    ],
  });
  return index;
}
