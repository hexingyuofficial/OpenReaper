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
    assert.equal(registry.macros.find((macro) => macro.id === "macro.selected_context").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_tracks").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_items").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_takes").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_fx").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_routing").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_markers").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.hydrate_refs").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.changed_since").status, "implemented");
    assert.equal(registry.macros.find((macro) => macro.id === "macro.query_automation").status, "planned");
  });

  it("creates official query macro discovery entries over list_templates/call_template", () => {
    const entries = createAlpha3C3OfficialQueryMacroDiscoveryItems();
    const status = entries.find((entry) => entry.id === "macro.index_status");
    const selected = entries.find((entry) => entry.id === "macro.selected_context");
    const tracks = entries.find((entry) => entry.id === "macro.query_tracks");
    const hydrate = entries.find((entry) => entry.id === "macro.hydrate_refs");
    const changed = entries.find((entry) => entry.id === "macro.changed_since");
    const items = entries.find((entry) => entry.id === "macro.query_items");
    const takes = entries.find((entry) => entry.id === "macro.query_takes");
    const fx = entries.find((entry) => entry.id === "macro.query_fx");
    const routing = entries.find((entry) => entry.id === "macro.query_routing");
    const markers = entries.find((entry) => entry.id === "macro.query_markers");

    assert.equal(entries.length, 12);
    assert.equal(status.kind, "official_macro");
    assert.equal(status.action_kind, "macro");
    assert.equal(status.menu_group, "query");
    assert.equal(status.macro_kind, "project_index_query");
    assert.equal(status.execution_shape, "project_index_query_plan");
    assert.equal(status.live_runnable_now, true);
    assert.equal(status.support_state, "supported");
    assert.equal(selected.support_state, "supported");
    assert.equal(selected.known_blocker, null);
    assert.deepEqual(selected.examples[0].input, { scope: "selection", limit: 25 });
    assert.equal(tracks.inputSchema.properties.filters.type, "object");
    assert.equal(tracks.expectedDelta.summary, "Returns a plan-only Project SQLite Index query envelope. It does not mutate REAPER or execute SQL.");
    assert.equal(hydrate.support_state, "supported");
    assert.equal(hydrate.known_blocker, null);
    assert.equal(changed.support_state, "supported");
    assert.equal(changed.known_blocker, null);
    assert.equal(items.support_state, "supported");
    assert.equal(items.known_blocker, null);
    assert.deepEqual(items.examples[0].input, { scope: "selection", filters: { selected: true }, limit: 25 });
    assert.equal(takes.support_state, "supported");
    assert.equal(takes.known_blocker, null);
    assert.deepEqual(takes.examples[0].input, { scope: "selection", filters: { active: true }, limit: 25 });
    assert.equal(fx.support_state, "supported");
    assert.equal(fx.known_blocker, null);
    assert.deepEqual(fx.examples[0].input, { filters: { stock_plugin: true }, limit: 25 });
    assert.equal(routing.support_state, "supported");
    assert.equal(routing.known_blocker, null);
    assert.deepEqual(routing.examples[0].input, {
      scope: "tracks",
      filters: { source_track_ref: "track:guid:{TRACK-GUID}" },
      limit: 25,
    });
    assert.equal(markers.support_state, "supported");
    assert.equal(markers.known_blocker, null);
    assert.deepEqual(markers.examples[0].input, {
      filters: { marker_kind: "region" },
      time_range: { start_seconds: 0, end_seconds: 120 },
      limit: 25,
    });
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

  it("blocks selected context until the task-scoped selection scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 8,
      scope: "selection",
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      ["template.project.create_observation_bundle"],
    );
    assert.equal(plan.refresh_requests[0].input.max_selected_items, 8);
    assert.equal(plan.safety.added_tools, 0);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("blocks item queries until the task-scoped item scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      limit: 8,
      scope: "selection",
      filters: { selected: true },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.items.list_selected_items",
      ],
    );
    assert.equal(plan.refresh_requests[0].input.include_track_items, true);
    assert.equal(plan.write_safety_loop.sqlite_rows_are_candidates_only, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);

    const trackScoped = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      limit: 8,
      scope: "tracks",
      filters: { track_ref: "track:guid:{TRACK-1}" },
    });
    const exactTrackRefresh = trackScoped.refresh_requests.find((request) =>
      request.id === "template.items.list_items_on_track"
    );
    assert.deepEqual(exactTrackRefresh.refs, { track_ref: "track:guid:{TRACK-1}" });
  });

  it("blocks take queries until the task-scoped take scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      limit: 8,
      scope: "selection",
      refs: ["item:guid:{ITEM-1}", "take:guid:{TAKE-1}"],
      filters: { active: true, track_ref: "track:guid:{TRACK-1}" },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.items.list_selected_items",
        "template.items.read_item_summary",
        "template.items.list_items_on_track",
        "template.items.read_item_summary",
        "template.media.read_take_source",
      ],
    );
    assert.equal(plan.refresh_requests[0].input.include_track_items, true);
    assert.deepEqual(
      plan.refresh_requests.find((request) => request.id === "template.items.list_items_on_track").refs,
      { track_ref: "track:guid:{TRACK-1}" },
    );
    const selectedItemTakeSummary = plan.refresh_requests.find((request) =>
      request.id === "template.items.read_item_summary" && request.callable_now === false
    );
    assert.deepEqual(selectedItemTakeSummary.input, { include_take_summary: true });
    assert.deepEqual(selectedItemTakeSummary.foreach_ref_from, {
      request_id: "template.items.list_selected_items",
      output_ref: "item_ref",
      bind_ref_as: "item_ref",
      max: 8,
    });
    assert.deepEqual(
      plan.refresh_requests.find((request) =>
        request.id === "template.items.read_item_summary" && request.refs.item_ref === "item:guid:{ITEM-1}"
      ).refs,
      { item_ref: "item:guid:{ITEM-1}" },
    );
    assert.deepEqual(
      plan.refresh_requests.find((request) => request.id === "template.media.read_take_source").refs,
      { take_ref: "take:guid:{TAKE-1}" },
    );
    assert.equal(plan.write_safety_loop.sqlite_rows_are_candidates_only, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("blocks FX queries until the task-scoped FX scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      limit: 8,
      refs: ["track:guid:{TRACK-1}", "fx:track:guid:{TRACK-1}:0"],
      filters: { stock_plugin: true },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.tracks.read_mixer_controls",
        "template.fx.list_track_fx_chain",
        "template.fx.read_fx_summary",
      ],
    );
    assert.deepEqual(
      plan.refresh_requests.find((request) => request.id === "template.fx.list_track_fx_chain").refs,
      { track_ref: "track:guid:{TRACK-1}" },
    );
    assert.deepEqual(
      plan.refresh_requests.find((request) => request.id === "template.fx.read_fx_summary").refs,
      { fx_ref: "fx:track:guid:{TRACK-1}:0" },
    );
    assert.equal(plan.query_policy.raw_sql_exposed, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("blocks routing queries until the task-scoped routing scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      limit: 8,
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}", "send:track:guid:{TRACK-1}:0"],
      filters: {
        source_track_ref: "track:guid:{TRACK-1}",
        destination_track_ref: "track:guid:{TRACK-2}",
      },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      [
        "template.routing.read_project_routing_graph",
        "template.routing.read_track_routing",
        "template.routing.read_track_routing",
        "template.routing.resolve_send_ref",
      ],
    );
    assert.deepEqual(
      plan.refresh_requests
        .filter((request) => request.id === "template.routing.read_track_routing")
        .map((request) => request.refs),
      [
        { track_ref: "track:guid:{TRACK-1}" },
        { track_ref: "track:guid:{TRACK-2}" },
      ],
    );
    assert.deepEqual(
      plan.refresh_requests.find((request) => request.id === "template.routing.resolve_send_ref").input,
      { send_ref: "send:track:guid:{TRACK-1}:0" },
    );
    assert.equal(plan.query_policy.raw_sql_exposed, false);
    assert.equal(plan.write_safety_loop.sqlite_rows_are_candidates_only, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("blocks marker queries until the task-scoped marker scope is fresh enough", () => {
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      limit: 8,
      filters: { marker_kind: "region" },
      time_range: { start_seconds: 0, end_seconds: 60 },
    });

    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
    assert.deepEqual(
      plan.refresh_requests.map((request) => request.id),
      ["template.project.list_markers_regions"],
    );
    assert.deepEqual(plan.refresh_requests[0].input, {
      limit: 8,
      include_markers: false,
      include_regions: true,
    });
    assert.equal(plan.query_policy.raw_sql_exposed, false);
    assert.equal(plan.write_safety_loop.sqlite_rows_are_candidates_only, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
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

  it("queries compact selected context refs from a fresh resident project index", () => {
    const projectIndex = selectedProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 2,
      scope: "selection",
      fields: ["ref_kind", "owner_ref", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 2,
      scope: "items",
      cursor: null,
      fields: ["ref_kind", "owner_ref"],
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.rows.length, 2);
    assert.deepEqual(firstPage.refs, ["track:guid:{TRACK-1}", "item:guid:{ITEM-1}"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "track:guid:{TRACK-1}",
      ref_kind: "track",
      owner_ref: "project:active",
      payload_ref: "artifact:selection:1",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.complete, true);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.callable_now, true);
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["track:guid:{TRACK-1}", "item:guid:{ITEM-1}"]);
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["item:guid:{ITEM-1}"]);
    assert.deepEqual(secondPage.rows[0], {
      ref: "item:guid:{ITEM-1}",
      ref_kind: "item",
      owner_ref: "track:guid:{TRACK-1}",
    });

    const typoScope = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 10,
      scope: "item",
    }, { projectIndex });

    assert.equal(typoScope.ok, false);
    assert.equal(typoScope.rows.length, 0);
    assert.equal(typoScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
  });

  it("queries compact item rows from a fresh resident project index", () => {
    const projectIndex = itemsProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      time_range: { start_seconds: 0, end_seconds: 5 },
      filters: { selected: true, min_length_seconds: 1 },
      limit: 1,
      fields: ["track_ref", "start_seconds", "end_seconds", "length_seconds", "selected", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      time_range: { start_seconds: 0, end_seconds: 5 },
      filters: { selected: true, min_length_seconds: 1 },
      limit: 1,
      cursor: firstPage.page.next_cursor,
      fields: ["track_ref"],
    }, { projectIndex });
    const unsupportedScope = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      scope: "fx",
      limit: 10,
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.rows.length, 1);
    assert.deepEqual(firstPage.refs, ["item:guid:{ITEM-1}"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "item:guid:{ITEM-1}",
      track_ref: "track:guid:{TRACK-1}",
      start_seconds: 1,
      end_seconds: 2.5,
      length_seconds: 1.5,
      selected: true,
      payload_ref: "artifact:items:1",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.status, "paged");
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.callable_now, true);
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["item:guid:{ITEM-1}"]);
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["item:guid:{ITEM-2}"]);
    assert.equal(secondPage.page.has_more, false);
    assert.equal(unsupportedScope.ok, false);
    assert.equal(unsupportedScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
  });

  it("queries compact take rows from a fresh resident project index", () => {
    const projectIndex = takesProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        active: true,
        min_playrate: 0.75,
        max_pitch_semitones: 2,
      },
      limit: 1,
      fields: ["item_ref", "track_ref", "active", "source_kind", "playrate", "pitch_semitones", "reverse", "has_take_fx", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        active: true,
        min_playrate: 0.75,
        max_pitch_semitones: 2,
      },
      limit: 1,
      cursor: firstPage.page.next_cursor,
      fields: ["item_ref", "has_take_fx"],
    }, { projectIndex });
    const takeFx = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      scope: "takes",
      filters: { has_take_fx: true, reverse: true },
      limit: 10,
      fields: ["item_ref", "track_ref", "reverse", "has_take_fx"],
    }, { projectIndex });
    const unsupportedScope = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      scope: "fx",
      limit: 10,
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.rows.length, 1);
    assert.deepEqual(firstPage.refs, ["take:guid:{TAKE-1}"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "take:guid:{TAKE-1}",
      item_ref: "item:guid:{ITEM-1}",
      track_ref: "track:guid:{TRACK-1}",
      active: true,
      source_kind: "wav",
      playrate: 1,
      pitch_semitones: 0,
      reverse: false,
      has_take_fx: false,
      payload_ref: "artifact:takes:1",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.status, "paged");
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.callable_now, true);
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["take:guid:{TAKE-1}"]);
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["take:guid:{TAKE-2}"]);
    assert.equal(secondPage.page.has_more, false);
    assert.equal(takeFx.ok, true);
    assert.deepEqual(takeFx.refs, ["take:guid:{TAKE-2}"]);
    assert.equal(unsupportedScope.ok, false);
    assert.equal(unsupportedScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
  });

  it("queries compact FX rows from a fresh resident project index", () => {
    const projectIndex = fxProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        stock_plugin: true,
        parameter_summary_available: true,
      },
      limit: 1,
      fields: ["owner_ref", "plugin_name", "slot_index", "stock_plugin", "parameter_summary_available", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        stock_plugin: true,
        parameter_summary_available: true,
      },
      limit: 1,
      cursor: firstPage.page.next_cursor,
      fields: ["plugin_name", "bypassed"],
    }, { projectIndex });
    const vital = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      filters: { plugin_name: "vital", bypassed: true },
      limit: 10,
      fields: ["owner_ref", "plugin_name", "bypassed", "stock_plugin"],
    }, { projectIndex });
    const unsupportedScope = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      scope: "routing",
      limit: 10,
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.deepEqual(firstPage.refs, ["fx:track:guid:{TRACK-1}:0"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "fx:track:guid:{TRACK-1}:0",
      owner_ref: "track:guid:{TRACK-1}",
      plugin_name: "VST: ReaEQ (Cockos)",
      slot_index: 0,
      stock_plugin: true,
      parameter_summary_available: true,
      payload_ref: "artifact:fx:chain",
    });
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["fx:track:guid:{TRACK-1}:0"]);
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["fx:track:guid:{TRACK-1}:2"]);
    assert.equal(secondPage.page.has_more, false);
    assert.equal(vital.ok, true);
    assert.deepEqual(vital.refs, ["fx:track:guid:{TRACK-2}:1"]);
    assert.deepEqual(vital.rows[0], {
      ref: "fx:track:guid:{TRACK-2}:1",
      owner_ref: "track:guid:{TRACK-2}",
      plugin_name: "VST3: Vital",
      bypassed: true,
      stock_plugin: false,
    });
    assert.equal(unsupportedScope.ok, false);
    assert.equal(unsupportedScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
  });

  it("queries compact routing rows from a fresh resident project index", () => {
    const projectIndex = routingProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        source_track_ref: "track:guid:{TRACK-1}",
        muted: false,
      },
      limit: 1,
      fields: ["source_track_ref", "destination_track_ref", "send_index", "volume_db", "pan", "send_mode", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "tracks",
      refs: ["track:guid:{TRACK-1}"],
      filters: {
        source_track_ref: "track:guid:{TRACK-1}",
        muted: false,
      },
      limit: 1,
      cursor: firstPage.page.next_cursor,
      fields: ["destination_track_ref", "audio_channels"],
    }, { projectIndex });
    const destination = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "routing",
      filters: {
        destination_track_ref: "track:guid:{TRACK-2}",
        send_mode: "post_fader",
        min_volume_db: -12,
        max_pan: 0.25,
      },
      limit: 10,
      fields: ["source_track_ref", "destination_track_ref", "send_mode", "muted"],
    }, { projectIndex });
    const defaultCompact = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "routing",
      filters: { source_track_ref: "track:guid:{TRACK-1}" },
      limit: 1,
    }, { projectIndex });
    const unsupportedScope = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "automation",
      limit: 10,
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.deepEqual(firstPage.refs, ["send:track:guid:{TRACK-1}:0"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "send:track:guid:{TRACK-1}:0",
      source_track_ref: "track:guid:{TRACK-1}",
      destination_track_ref: "track:guid:{TRACK-2}",
      send_index: 0,
      volume_db: -6,
      pan: 0,
      send_mode: "post_fader",
      payload_ref: "artifact:routing:graph",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.status, "paged");
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.callable_now, true);
    assert.equal(firstPage.hydrate_request.id, "macro.hydrate_refs");
    assert.deepEqual(firstPage.hydrate_request.input.refs, ["send:track:guid:{TRACK-1}:0"]);
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["send:track:guid:{TRACK-1}:1"]);
    assert.equal(secondPage.page.has_more, false);
    assert.equal(destination.ok, true);
    assert.deepEqual(destination.refs, ["send:track:guid:{TRACK-1}:0"]);
    assert.deepEqual(destination.rows[0], {
      ref: "send:track:guid:{TRACK-1}:0",
      source_track_ref: "track:guid:{TRACK-1}",
      destination_track_ref: "track:guid:{TRACK-2}",
      send_mode: "post_fader",
      muted: false,
    });
    assert.equal(defaultCompact.ok, true);
    assert.deepEqual(defaultCompact.rows[0], {
      ref: "send:track:guid:{TRACK-1}:0",
      owner_ref: "track:guid:{TRACK-1}",
      source_track_ref: "track:guid:{TRACK-1}",
      destination_track_ref: "track:guid:{TRACK-2}",
      send_index: 0,
      muted: false,
      volume_db: -6,
      pan: 0,
      send_mode: "post_fader",
      freshness_status: "fresh",
      coverage_status: "paged",
    });
    assert.equal("summary" in defaultCompact.rows[0], false);
    assert.equal("payload_ref" in defaultCompact.rows[0], false);
    assert.equal(JSON.stringify(defaultCompact.rows[0]).includes("hardware_outputs"), false);
    assert.equal(JSON.stringify(defaultCompact.rows[0]).includes("routing_graph"), false);
    assert.equal(unsupportedScope.ok, false);
    assert.equal(unsupportedScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
  });

  it("queries compact marker/region rows from a fresh resident project index", () => {
    const projectIndex = markersProjectIndex();
    const firstPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      filters: {
        marker_kind: "region",
        name: "chorus",
      },
      time_range: { start_seconds: 0, end_seconds: 90 },
      limit: 1,
      fields: ["marker_kind", "position_seconds", "end_seconds", "length_seconds", "name", "payload_ref"],
    }, { projectIndex });
    const secondPage = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      filters: {
        marker_kind: "region",
        name: "chorus",
      },
      time_range: { start_seconds: 0, end_seconds: 90 },
      limit: 1,
      cursor: firstPage.page.next_cursor,
      fields: ["marker_kind", "name", "color"],
    }, { projectIndex });
    const defaultCompact = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      filters: { marker_kind: "marker" },
      limit: 1,
    }, { projectIndex });
    const unsupportedScope = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      scope: "automation",
      limit: 10,
    }, { projectIndex });

    assert.equal(firstPage.ok, true);
    assert.deepEqual(firstPage.refs, ["region:guid:{REGION-1}"]);
    assert.deepEqual(firstPage.rows[0], {
      ref: "region:guid:{REGION-1}",
      marker_kind: "region",
      position_seconds: 32,
      end_seconds: 64,
      length_seconds: 32,
      name: "Chorus A",
      payload_ref: "artifact:markers:regions",
    });
    assert.equal(firstPage.freshness.status, "fresh");
    assert.equal(firstPage.coverage.status, "complete");
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.hydrate_request.callable_now, false);
    assert.equal(firstPage.hydrate_request.status, "no_supported_exact_hydration");
    assert.equal(firstPage.hydrate_request.blocker.code, "HYDRATE_REF_UNSUPPORTED");
    assert.equal(secondPage.ok, true);
    assert.deepEqual(secondPage.refs, ["region:guid:{REGION-2}"]);
    assert.equal(secondPage.page.has_more, false);
    assert.deepEqual(defaultCompact.rows[0], {
      ref: "marker:guid:{MARKER-1}",
      marker_kind: "marker",
      position_seconds: 8,
      end_seconds: null,
      name: "Intro cue",
      freshness_status: "fresh",
      coverage_status: "complete",
    });
    assert.equal("summary" in defaultCompact.rows[0], false);
    assert.equal("payload_ref" in defaultCompact.rows[0], false);
    assert.equal(unsupportedScope.ok, false);
    assert.equal(unsupportedScope.blockers.some((blocker) => blocker.code === "QUERY_SCOPE_UNSUPPORTED"), true);
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
    assert.equal(menu.items.some((item) => item.id === "macro.selected_context"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_tracks"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_items"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_takes"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_fx"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_routing"), true);
    assert.equal(menu.items.some((item) => item.id === "macro.query_markers"), true);
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

  it("calls selected_context through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T17:45:00.000Z"),
      projectIndex: selectedProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.selected_context",
      input: {
        scope: "selection",
        limit: 3,
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.selected_context");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "track:guid:{TRACK-1}",
      "item:guid:{ITEM-1}",
      "fx:track:{TRACK-1}:0",
    ]);
    assert.equal(response.result.rows.length, 3);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
  });

  it("calls query_items through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T18:10:00.000Z"),
      projectIndex: itemsProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_items",
      input: {
        scope: "selection",
        limit: 2,
        fields: ["track_ref", "length_seconds", "selected"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.query_items");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "item:guid:{ITEM-1}",
      "item:guid:{ITEM-2}",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(runtime.last_evidence().template.id, "macro.query_items");
  });

  it("calls query_fx through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T18:35:00.000Z"),
      projectIndex: fxProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_fx",
      input: {
        limit: 2,
        filters: { stock_plugin: true },
        fields: ["owner_ref", "plugin_name", "slot_index", "stock_plugin"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.query_fx");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "fx:track:guid:{TRACK-1}:0",
      "fx:track:guid:{TRACK-1}:2",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(runtime.last_evidence().template.id, "macro.query_fx");
  });

  it("calls query_takes through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T18:45:00.000Z"),
      projectIndex: takesProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_takes",
      input: {
        limit: 2,
        filters: { active: true },
        fields: ["item_ref", "source_kind", "reverse", "has_take_fx"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.query_takes");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "take:guid:{TAKE-1}",
      "take:guid:{TAKE-2}",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(runtime.last_evidence().template.id, "macro.query_takes");
  });

  it("calls query_routing through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T19:10:00.000Z"),
      projectIndex: routingProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_routing",
      input: {
        limit: 2,
        filters: { source_track_ref: "track:guid:{TRACK-1}" },
        fields: ["destination_track_ref", "send_mode", "volume_db"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.query_routing");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "send:track:guid:{TRACK-1}:0",
      "send:track:guid:{TRACK-1}:1",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.hydrate_request.id, "macro.hydrate_refs");
    assert.equal(runtime.last_evidence().template.id, "macro.query_routing");
  });

  it("calls query_markers through call_template as a plan-only envelope", async () => {
    const runtime = createCallTemplateRuntime({
      now: () => new Date("2026-07-07T19:30:00.000Z"),
      projectIndex: markersProjectIndex(),
    });
    const response = await runtime.call_template({
      id: "macro.query_markers",
      input: {
        limit: 2,
        filters: { marker_kind: "region" },
        fields: ["marker_kind", "name", "position_seconds", "end_seconds"],
      },
    });

    assert.equal(response.contract, "template.execution.v1");
    assert.equal(response.ok, true);
    assert.equal(response.template.id, "macro.query_markers");
    assert.equal(response.result.execution.executed, false);
    assert.equal(response.result.execution.added_tools, 0);
    assert.equal(response.result.execution.hidden_executor, false);
    assert.equal(response.result.execution.live_reaper, false);
    assert.deepEqual(response.result.refs, [
      "region:guid:{REGION-1}",
      "region:guid:{REGION-2}",
    ]);
    assert.equal(response.result.rows.length, 2);
    assert.equal(response.result.hydrate_request.callable_now, false);
    assert.equal(response.result.hydrate_request.status, "no_supported_exact_hydration");
    assert.equal(runtime.last_evidence().template.id, "macro.query_markers");
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
      id: "macro.query_automation",
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

function selectedProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T17:45:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-4",
  });
  index.replaceSelection({
    snapshot_id: "snapshot:c3-4:selection",
    observed_at: "2026-07-07T17:40:00.000Z",
    payload_ref: "artifact:selection:1",
    rows: [
      {
        ref: "track:guid:{TRACK-1}",
        owner_ref: "project:active",
      },
      {
        ref: "item:guid:{ITEM-1}",
        owner_ref: "track:guid:{TRACK-1}",
      },
      {
        ref: "fx:track:{TRACK-1}:0",
        owner_ref: "track:guid:{TRACK-1}",
      },
    ],
  });
  return index;
}

function itemsProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T18:08:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-5",
  });
  index.replaceItems({
    snapshot_id: "snapshot:c3-5:items",
    observed_at: "2026-07-07T18:00:00.000Z",
    payload_ref: "artifact:items:1",
    rows: [
      {
        ref: "item:guid:{ITEM-1}",
        track_ref: "track:guid:{TRACK-1}",
        start_seconds: 1,
        end_seconds: 2.5,
        selected: true,
      },
      {
        ref: "item:guid:{ITEM-2}",
        track_ref: "track:guid:{TRACK-1}",
        start_seconds: 3,
        end_seconds: 4.5,
        selected: true,
      },
      {
        ref: "item:guid:{ITEM-3}",
        track_ref: "track:guid:{TRACK-2}",
        start_seconds: 6,
        end_seconds: 7,
        muted: true,
      },
    ],
  });
  return index;
}

function takesProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T18:44:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-takes",
  });
  index.replaceTakes({
    snapshot_id: "snapshot:c3-takes",
    observed_at: "2026-07-07T18:42:00.000Z",
    payload_ref: "artifact:takes:1",
    rows: [
      {
        ref: "take:guid:{TAKE-1}",
        item_ref: "item:guid:{ITEM-1}",
        track_ref: "track:guid:{TRACK-1}",
        active: true,
        source_kind: "wav",
        source_ref: "media:file:{KICK}",
        playrate: 1,
        pitch_semitones: 0,
      },
      {
        ref: "take:guid:{TAKE-2}",
        item_ref: "item:guid:{ITEM-2}",
        track_ref: "track:guid:{TRACK-1}",
        active: true,
        source_kind: "wav",
        source_ref: "media:file:{SNARE}",
        playrate: 0.9,
        pitch_semitones: -1,
        reverse: true,
        has_take_fx: true,
      },
      {
        ref: "take:guid:{TAKE-3}",
        item_ref: "item:guid:{ITEM-3}",
        track_ref: "track:guid:{TRACK-2}",
        active: false,
        source_kind: "midi",
      },
    ],
  });
  return index;
}

function fxProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T18:34:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-6",
  });
  index.replaceFx({
    snapshot_id: "snapshot:c3-6:fx",
    observed_at: "2026-07-07T18:30:00.000Z",
    payload_ref: "artifact:fx:chain",
    rows: [
      {
        ref: "fx:track:guid:{TRACK-1}:0",
        owner_ref: "track:guid:{TRACK-1}",
        plugin_name: "VST: ReaEQ (Cockos)",
        plugin_id: "reaeq",
        slot_index: 0,
        summary: { parameter_count: 16 },
      },
      {
        ref: "fx:track:guid:{TRACK-2}:1",
        owner_ref: "track:guid:{TRACK-2}",
        plugin_name: "VST3: Vital",
        plugin_id: "vital",
        slot_index: 1,
        bypassed: true,
      },
      {
        ref: "fx:track:guid:{TRACK-1}:2",
        owner_ref: "track:guid:{TRACK-1}",
        plugin_name: "VST: ReaComp (Cockos)",
        plugin_id: "reacomp",
        slot_index: 2,
        summary: { parameter_summary_available: true },
      },
    ],
  });
  return index;
}

function routingProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T19:08:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-9",
  });
  index.replaceSends({
    snapshot_id: "snapshot:c3-9:routing",
    observed_at: "2026-07-07T19:06:00.000Z",
    payload_ref: "artifact:routing:graph",
    rows: [
      {
        ref: "send:track:guid:{TRACK-1}:0",
        source_track_ref: "track:guid:{TRACK-1}",
        destination_track_ref: "track:guid:{TRACK-2}",
        send_index: 0,
        send_mode: "post_fader",
        volume_db: -6,
        pan: 0,
        audio_channels: "1/2->1/2",
        midi_channels: "all",
        summary: {
          hardware_outputs: ["hw:output:1"],
          routing_graph: { edges: Array.from({ length: 16 }, (_, index) => `edge:${index}`) },
        },
      },
      {
        ref: "send:track:guid:{TRACK-1}:1",
        source_track_ref: "track:guid:{TRACK-1}",
        destination_track_ref: "track:guid:{TRACK-3}",
        send_index: 1,
        send_mode: "pre_fader",
        volume_db: -12,
        pan: 0.5,
        audio_channels: "1/2->3/4",
      },
      {
        ref: "send:track:guid:{TRACK-2}:0",
        source_track_ref: "track:guid:{TRACK-2}",
        destination_track_ref: "track:guid:{TRACK-1}",
        send_index: 0,
        send_mode: "post_fader",
        muted: true,
        volume_db: -18,
        pan: -0.25,
      },
    ],
  });
  return index;
}

function markersProjectIndex() {
  const index = createAlpha3C3ProjectIndex({
    now: () => new Date("2026-07-07T19:28:00.000Z"),
    projectRef: "project:active",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:c3-10",
  });
  index.replaceMarkersRegions({
    snapshot_id: "snapshot:c3-10:markers",
    observed_at: "2026-07-07T19:25:00.000Z",
    payload_ref: "artifact:markers:regions",
    rows: [
      {
        ref: "marker:guid:{MARKER-1}",
        marker_kind: "marker",
        position_seconds: 8,
        name: "Intro cue",
      },
      {
        ref: "region:guid:{REGION-1}",
        marker_kind: "region",
        position_seconds: 32,
        end_seconds: 64,
        name: "Chorus A",
        color: "#7fb3ff",
      },
      {
        ref: "region:guid:{REGION-2}",
        marker_kind: "region",
        position_seconds: 72,
        end_seconds: 88,
        name: "Chorus B",
        color: "#ffd36a",
      },
    ],
  });
  return index;
}
