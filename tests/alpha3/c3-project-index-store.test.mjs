import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C3_PROJECT_INDEX_CHANGED_SINCE_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_MIGRATION_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT,
  createAlpha3C3ProjectIndex,
  createAlpha3C3ProjectIndexMigrations,
  createAlpha3C3ProjectIndexSchemaContract,
  planAlpha3C3ProjectIndexTaskRefresh,
  projectIndexScopeIsFreshEnough,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-store-v1.mjs";
import {
  planAlpha3C3ProjectIndexQueryMacro,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";

describe("Alpha3 C3 Project SQLite Index store helpers", () => {
  it("defines a SQLite schema and migration contract without making SQLite truth", () => {
    const schema = createAlpha3C3ProjectIndexSchemaContract();
    const migrations = createAlpha3C3ProjectIndexMigrations();

    assert.equal(schema.contract, ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT);
    assert.equal(schema.schema_version, 1);
    assert.equal(schema.backend_policy.current_runtime_backend, "resident_memory_adapter");
    assert.equal(schema.backend_policy.future_persistent_backend, "sqlite_file");
    assert.equal(schema.truth_boundary.project_truth, "REAPER");
    assert.equal(schema.truth_boundary.index_role, "local_query_navigation_cache");
    assert.equal(schema.truth_boundary.artifact_role, "evidence_payload_and_readback_proof");
    assert.equal(schema.safety.added_tools, 0);
    assert.equal(schema.safety.raw_sql_exposed, false);
    assert.equal(schema.safety.sqlite_is_truth, false);
    assert.equal(schema.tables.includes("tracks"), true);
    assert.equal(schema.tables.includes("selection_state"), true);
    assert.equal(schema.tables.includes("object_changes"), true);
    assert.equal(
      migrations.migrations[0].statements.some((statement) =>
        /CREATE TABLE IF NOT EXISTS selection_state[\s\S]*summary_json TEXT NOT NULL/.test(statement)
      ),
      true,
    );
    assert.equal(schema.object_row_required_fields.includes("payload_ref"), true);

    assert.equal(migrations.contract, ALPHA3_C3_PROJECT_INDEX_MIGRATION_CONTRACT);
    assert.equal(migrations.current_schema_version, 1);
    assert.equal(migrations.policy.raw_sql_user_input, false);
    assert.equal(migrations.policy.sqlite_is_truth, false);
    assert.equal(migrations.migrations.length, 1);
    assert.equal(migrations.migrations[0].to_version, 1);
    assert.equal(migrations.migrations[0].user_data_destructive, false);
    assert.equal(
      migrations.migrations[0].statements.some((statement) => /CREATE TABLE IF NOT EXISTS tracks/.test(statement)),
      true,
    );
    assert.equal(
      migrations.migrations[0].statements.some((statement) => /CREATE TABLE IF NOT EXISTS freshness_scopes/.test(statement)),
      true,
    );
  });

  it("maintains a resident project index adapter snapshot that C3.1 query macros can consume", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-2",
    });

    const result = index.replaceTracks({
      snapshot_id: "snapshot:c3-2:tracks",
      observed_at: "2026-07-07T16:50:00.000Z",
      source_template_id: "template.tracks.list_tracks",
      payload_ref: "artifact:project_map:tracks",
      rows: [
        {
          ref: "track:guid:{A}",
          owner_ref: "project:active",
          name: "Kick",
          index: 0,
          selected: true,
          item_count: 4,
          fx_count: 1,
          send_count: 0,
        },
        {
          ref: "track:guid:{B}",
          owner_ref: "project:active",
          name: "Pads",
          index: 1,
          selected: false,
          item_count: 2,
          fx_count: 3,
          send_count: 1,
        },
      ],
    });
    const snapshot = index.snapshot();

    assert.equal(result.contract, ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT);
    assert.equal(result.operation, "replace_tracks");
    assert.equal(snapshot.lifecycle, "ready");
    assert.equal(snapshot.project_ref, "project:active");
    assert.equal(snapshot.bridge_generation, 3);
    assert.equal(snapshot.rows.tracks.length, 2);
    assert.equal(snapshot.rows.tracks[0].payload_ref, "artifact:project_map:tracks");
    assert.equal(snapshot.freshness_scopes.tracks.status, "fresh");
    assert.equal(snapshot.freshness_scopes.tracks.coverage_status, "complete");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "tracks"), true);

    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      filters: { selected: true },
      fields: ["name", "item_count", "fx_count", "payload_ref"],
      limit: 10,
    }, { projectIndex: index });

    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["track:guid:{A}"]);
    assert.deepEqual(plan.rows[0], {
      ref: "track:guid:{A}",
      name: "Kick",
      item_count: 4,
      fx_count: 1,
      payload_ref: "artifact:project_map:tracks",
    });
    assert.equal(plan.refresh_requests.length, 0);
  });

  it("maintains selected context rows with freshness and compact refs", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-4",
    });

    const result = index.replaceSelection({
      snapshot_id: "snapshot:c3-4:selection",
      observed_at: "2026-07-07T16:55:00.000Z",
      payload_ref: "artifact:selection:bundle",
      rows: [
        {
          ref: "track:guid:{A}",
          owner_ref: "project:active",
        },
        {
          ref: "item:guid:{ITEM-1}",
          owner_ref: "track:guid:{A}",
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 10,
      fields: ["ref_kind", "owner_ref", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_selection");
    assert.equal(snapshot.rows.selection_state.length, 2);
    assert.equal(snapshot.rows.selection_state[0].scope_kind, "track");
    assert.equal(snapshot.rows.selection_state[0].payload_ref, "artifact:selection:bundle");
    assert.equal(snapshot.freshness_scopes.selection.status, "fresh");
    assert.equal(snapshot.freshness_scopes.selection.coverage_status, "selected_only");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "selection"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["track:guid:{A}", "item:guid:{ITEM-1}"]);
    assert.deepEqual(plan.rows[1], {
      ref: "item:guid:{ITEM-1}",
      ref_kind: "item",
      owner_ref: "track:guid:{A}",
      payload_ref: "artifact:selection:bundle",
    });
  });

  it("maintains item rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-5",
    });

    const result = index.replaceItems({
      snapshot_id: "snapshot:c3-5:items",
      observed_at: "2026-07-07T17:05:00.000Z",
      payload_ref: "artifact:items:map",
      rows: [
        {
          ref: "item:guid:{ITEM-1}",
          track_ref: "track:guid:{A}",
          start_seconds: 1.25,
          end_seconds: 3.75,
          selected: true,
        },
        {
          ref: "item:guid:{ITEM-2}",
          owner_ref: "track:guid:{B}",
          start_seconds: 9,
          end_seconds: 12,
          muted: true,
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
      scope: "selection",
      limit: 10,
      fields: ["track_ref", "start_seconds", "length_seconds", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_items");
    assert.equal(snapshot.rows.items.length, 2);
    assert.equal(snapshot.rows.items[0].length_seconds, 2.5);
    assert.equal(snapshot.rows.items[1].track_ref, "track:guid:{B}");
    assert.equal(snapshot.rows.items[0].payload_ref, "artifact:items:map");
    assert.equal(snapshot.freshness_scopes.items.status, "fresh");
    assert.equal(snapshot.freshness_scopes.items.coverage_status, "paged");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "items"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["item:guid:{ITEM-1}"]);
    assert.deepEqual(plan.rows[0], {
      ref: "item:guid:{ITEM-1}",
      track_ref: "track:guid:{A}",
      start_seconds: 1.25,
      length_seconds: 2.5,
      payload_ref: "artifact:items:map",
    });
  });

  it("maintains take rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-takes",
    });

    const result = index.replaceTakes({
      snapshot_id: "snapshot:c3-takes",
      observed_at: "2026-07-07T18:25:00.000Z",
      payload_ref: "artifact:takes:map",
      rows: [
        {
          ref: "take:guid:{TAKE-1}",
          item_ref: "item:guid:{ITEM-1}",
          track_ref: "track:guid:{A}",
          active: true,
          source_kind: "wav",
          playrate: 1,
          pitch_semitones: 0,
        },
        {
          ref: "take:guid:{TAKE-2}",
          owner_ref: "item:guid:{ITEM-2}",
          track_ref: "track:guid:{B}",
          active: true,
          source_kind: "wav",
          reverse: true,
          has_take_fx: true,
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
      scope: "takes",
      limit: 10,
      filters: { has_take_fx: true },
      fields: ["item_ref", "track_ref", "active", "reverse", "has_take_fx", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_takes");
    assert.equal(snapshot.rows.takes.length, 2);
    assert.equal(snapshot.rows.takes[1].item_ref, "item:guid:{ITEM-2}");
    assert.equal(snapshot.rows.takes[0].payload_ref, "artifact:takes:map");
    assert.equal(snapshot.freshness_scopes.takes.status, "fresh");
    assert.equal(snapshot.freshness_scopes.takes.coverage_status, "paged");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "takes"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["take:guid:{TAKE-2}"]);
    assert.deepEqual(plan.rows[0], {
      ref: "take:guid:{TAKE-2}",
      item_ref: "item:guid:{ITEM-2}",
      track_ref: "track:guid:{B}",
      active: true,
      reverse: true,
      has_take_fx: true,
      payload_ref: "artifact:takes:map",
    });
  });

  it("maintains FX rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-6",
    });

    const result = index.replaceFx({
      snapshot_id: "snapshot:c3-6:fx",
      observed_at: "2026-07-07T18:35:00.000Z",
      payload_ref: "artifact:fx:chain",
      rows: [
        {
          ref: "fx:track:guid:{A}:0",
          owner_ref: "track:guid:{A}",
          plugin_name: "VST: ReaEQ (Cockos)",
          plugin_id: "reaeq",
          slot_index: 0,
          summary: { parameter_count: 16 },
        },
        {
          ref: "fx:track:guid:{B}:1",
          owner_ref: "track:guid:{B}",
          plugin_name: "VST3: Vital",
          plugin_id: "vital",
          slot_index: 1,
          bypassed: true,
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_fx", {
      limit: 10,
      filters: { owner_ref: "track:guid:{A}", stock_plugin: true },
      fields: ["owner_ref", "plugin_name", "slot_index", "stock_plugin", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_fx");
    assert.equal(snapshot.rows.fx.length, 2);
    assert.equal(snapshot.rows.fx[0].payload_ref, "artifact:fx:chain");
    assert.equal(snapshot.freshness_scopes.fx.status, "fresh");
    assert.equal(snapshot.freshness_scopes.fx.coverage_status, "paged");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "fx"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["fx:track:guid:{A}:0"]);
    assert.deepEqual(plan.rows[0], {
      ref: "fx:track:guid:{A}:0",
      owner_ref: "track:guid:{A}",
      plugin_name: "VST: ReaEQ (Cockos)",
      slot_index: 0,
      stock_plugin: true,
      payload_ref: "artifact:fx:chain",
    });
  });

  it("maintains routing/send rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-9",
    });

    const result = index.replaceSends({
      snapshot_id: "snapshot:c3-9:routing",
      observed_at: "2026-07-07T19:05:00.000Z",
      payload_ref: "artifact:routing:graph",
      rows: [
        {
          ref: "send:track:guid:{A}:0",
          source_track_ref: "track:guid:{A}",
          destination_track_ref: "track:guid:{B}",
          send_index: 0,
          send_mode: "post_fader",
          volume_db: -6,
          pan: 0,
        },
        {
          ref: "send:track:guid:{B}:0",
          owner_ref: "track:guid:{B}",
          destination_track_ref: "track:guid:{A}",
          send_index: 0,
          muted: true,
          summary: {
            send_mode: "pre_fader",
            audio_channels: "1/2->1/2",
          },
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_routing", {
      scope: "routing",
      limit: 10,
      filters: { source_track_ref: "track:guid:{A}" },
      fields: ["source_track_ref", "destination_track_ref", "send_index", "send_mode", "volume_db", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_sends");
    assert.equal(snapshot.rows.sends.length, 2);
    assert.equal(snapshot.rows.sends[1].source_track_ref, "track:guid:{B}");
    assert.equal(snapshot.rows.sends[1].send_mode, "pre_fader");
    assert.equal(snapshot.rows.sends[0].payload_ref, "artifact:routing:graph");
    assert.equal(snapshot.freshness_scopes.routing.status, "fresh");
    assert.equal(snapshot.freshness_scopes.routing.coverage_status, "paged");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "routing"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["send:track:guid:{A}:0"]);
    assert.deepEqual(plan.rows[0], {
      ref: "send:track:guid:{A}:0",
      source_track_ref: "track:guid:{A}",
      destination_track_ref: "track:guid:{B}",
      send_index: 0,
      send_mode: "post_fader",
      volume_db: -6,
      payload_ref: "artifact:routing:graph",
    });
  });

  it("maintains marker/region rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-10",
    });

    const result = index.replaceMarkersRegions({
      snapshot_id: "snapshot:c3-10:markers",
      observed_at: "2026-07-07T19:25:00.000Z",
      payload_ref: "artifact:markers:regions",
      rows: [
        {
          marker_ref: "marker:guid:{M1}",
          marker_kind: "marker",
          position_seconds: 4,
          name: "Intro",
        },
        {
          region_ref: "region:guid:{R1}",
          kind: "region",
          position_seconds: 16,
          end_seconds: 48,
          name: "Chorus",
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_markers", {
      scope: "markers",
      limit: 10,
      filters: { marker_kind: "region" },
      fields: ["marker_kind", "position_seconds", "end_seconds", "length_seconds", "name", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_markers_regions");
    assert.equal(snapshot.rows.markers_regions.length, 2);
    assert.equal(snapshot.rows.markers_regions[1].marker_kind, "region");
    assert.equal(snapshot.rows.markers_regions[1].length_seconds, 32);
    assert.equal(snapshot.rows.markers_regions[0].payload_ref, "artifact:markers:regions");
    assert.equal(snapshot.freshness_scopes.markers.status, "fresh");
    assert.equal(snapshot.freshness_scopes.markers.coverage_status, "complete");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "markers"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["region:guid:{R1}"]);
    assert.deepEqual(plan.rows[0], {
      ref: "region:guid:{R1}",
      marker_kind: "region",
      position_seconds: 16,
      end_seconds: 48,
      length_seconds: 32,
      name: "Chorus",
      payload_ref: "artifact:markers:regions",
    });
  });

  it("marks selected context stale after selection-changing readback", () => {
    const index = createAlpha3C3ProjectIndex({ now: fixedNow });

    index.replaceSelection({
      snapshot_id: "snapshot:c3-4:selection",
      observed_at: "2026-07-07T16:55:00.000Z",
      rows: [
        { ref: "track:guid:{A}", owner_ref: "project:active" },
      ],
    });
    index.markWriteReadbackApplied({
      snapshot_id: "snapshot:c3-4:selection-write",
      observed_at: "2026-07-07T16:56:00.000Z",
      refs: ["track:guid:{A}"],
      change_kind: "track_selection_changed",
      payload_ref: "artifact:readback:selection-write",
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.selected_context", {
      limit: 5,
    }, { projectIndex: index });

    assert.equal(snapshot.freshness_scopes.selection.status, "stale");
    assert.equal(snapshot.freshness_scopes.tracks.status, "stale");
    assert.equal(plan.ok, false);
    assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_REFRESH_REQUIRED"), true);
  });

  it("plans task-scoped refresh requests over accepted templates only", () => {
    const plan = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["project_head", "tracks", "items", "takes", "fx", "routing", "selection", "tracks"],
      limit: 40,
    });

    assert.equal(plan.contract, ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT);
    assert.deepEqual(plan.scopes, ["project_head", "tracks", "items", "takes", "fx", "routing", "selection"]);
    assert.deepEqual(
      plan.requests.map((request) => request.id),
      [
        "template.project.create_observation_bundle",
        "template.project.create_project_map_snapshot",
        "template.tracks.list_tracks",
        "template.tracks.read_mixer_controls",
        "template.project.create_project_map_snapshot",
        "template.items.list_selected_items",
        "template.items.list_selected_items",
        "template.items.read_item_summary",
        "template.routing.read_project_routing_graph",
      ],
    );
    const takesOnly = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["takes"],
      limit: 40,
    });
    assert.deepEqual(
      takesOnly.requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.items.list_selected_items",
        "template.items.read_item_summary",
      ],
    );
    const selectedTakeSummary = takesOnly.requests.find((request) =>
      request.id === "template.items.read_item_summary"
    );
    assert.equal(selectedTakeSummary.callable_now, false);
    assert.deepEqual(selectedTakeSummary.foreach_ref_from, {
      request_id: "template.items.list_selected_items",
      output_ref: "item_ref",
      bind_ref_as: "item_ref",
      max: 40,
    });
    const fxOnly = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["fx"],
      limit: 40,
    });
    assert.deepEqual(
      fxOnly.requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.tracks.read_mixer_controls",
      ],
    );
    const routingOnly = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["routing"],
      limit: 40,
    });
    assert.deepEqual(
      routingOnly.requests.map((request) => request.id),
      ["template.routing.read_project_routing_graph"],
    );
    assert.deepEqual(routingOnly.requests[0].input, {
      max_tracks: 40,
      max_edges: 160,
      include_master_parent: true,
    });
    const markersOnly = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["markers"],
      limit: 40,
    });
    assert.deepEqual(
      markersOnly.requests.map((request) => request.id),
      ["template.project.list_markers_regions"],
    );
    assert.deepEqual(markersOnly.requests[0].input, {
      limit: 40,
      include_markers: true,
      include_regions: true,
    });
    assert.equal(plan.update_policy.source_truth, "REAPER");
    assert.equal(plan.update_policy.apply_after_readback, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("records object changes only after readback and supports changed-since paging", () => {
    const index = createAlpha3C3ProjectIndex({ now: fixedNow });

    index.replaceTracks({
      snapshot_id: "snapshot:c3-2:tracks",
      observed_at: "2026-07-07T16:45:00.000Z",
      rows: [
        { ref: "track:guid:{A}", name: "Kick" },
      ],
    });
    index.markWriteReadbackApplied({
      snapshot_id: "snapshot:c3-2:write",
      observed_at: "2026-07-07T16:51:00.000Z",
      refs: ["track:guid:{A}", "track:guid:{B}"],
      owner_ref: "project:active",
      payload_ref: "artifact:readback:write",
      change_kind: "track_controls_readback",
      change_id_prefix: "readback:001",
    });
    const staleAfterReadback = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 10,
    }, { projectIndex: index });
    assert.equal(index.snapshot().freshness_scopes.tracks.status, "stale");
    assert.equal(index.snapshot().freshness_scopes.tracks.reason, "write_readback_requires_refresh");
    assert.equal(staleAfterReadback.ok, false);
    assert.equal(staleAfterReadback.blockers.some((blocker) => blocker.code === "INDEX_REFRESH_REQUIRED"), true);

    index.recordObjectChanges({
      observed_at: "2026-07-07T16:52:00.000Z",
      changes: [
        {
          change_id: "change:manual:001",
          ref: "item:guid:{ITEM-1}",
          owner_ref: "track:guid:{A}",
          change_kind: "item_moved",
          summary: { source: "batch_readback" },
        },
      ],
    });

    const first = index.changedSince({
      since: "2026-07-07T16:50:00.000Z",
      limit: 2,
    });
    const second = index.changedSince({
      since: "2026-07-07T16:50:00.000Z",
      limit: 2,
      cursor: first.page.next_cursor,
    });

    assert.equal(first.contract, ALPHA3_C3_PROJECT_INDEX_CHANGED_SINCE_CONTRACT);
    assert.equal(first.rows.length, 2);
    assert.deepEqual(first.refs, ["track:guid:{A}", "track:guid:{B}"]);
    assert.equal(first.page.has_more, true);
    assert.equal(first.rows[0].payload_ref, "artifact:readback:write");
    assert.equal(second.rows.length, 1);
    assert.deepEqual(second.refs, ["item:guid:{ITEM-1}"]);
    assert.equal(second.page.has_more, false);
    assert.equal(second.freshness.sqlite_is_truth, false);
  });

  it("marks stale sessions and stale scopes as unusable for fresh query action", () => {
    const index = createAlpha3C3ProjectIndex({ now: fixedNow });
    index.replaceTracks({
      snapshot_id: "snapshot:c3-2:tracks",
      observed_at: "2026-07-07T16:50:00.000Z",
      rows: [{ ref: "track:guid:{A}", name: "Kick" }],
    });
    index.markScopeStale({
      scope_kind: "tracks",
      reason: "write_after_query",
      observed_at: "2026-07-07T16:52:30.000Z",
    });

    const stalePlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 10,
    }, { projectIndex: index });
    assert.equal(stalePlan.ok, false);
    assert.equal(stalePlan.blockers.some((blocker) => blocker.code === "INDEX_REFRESH_REQUIRED"), true);

    index.markStaleSession({
      reason: "bridge_generation_changed",
      observed_at: "2026-07-07T16:53:00.000Z",
    });
    const staleSessionPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
      limit: 10,
    }, { projectIndex: index });

    assert.equal(staleSessionPlan.ok, false);
    assert.equal(staleSessionPlan.blockers.some((blocker) => blocker.code === "INDEX_STALE_SESSION"), true);
    assert.equal(index.snapshot().lifecycle, "stale_session");
    assert.equal(projectIndexScopeIsFreshEnough(index.snapshot(), "tracks"), false);
  });
});

function fixedNow() {
  return new Date("2026-07-07T16:59:15.000Z");
}
