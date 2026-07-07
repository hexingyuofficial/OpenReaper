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
    assert.equal(schema.tables.includes("object_changes"), true);
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

  it("plans task-scoped refresh requests over accepted templates only", () => {
    const plan = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["project_head", "tracks", "selection", "tracks"],
      limit: 40,
    });

    assert.equal(plan.contract, ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT);
    assert.deepEqual(plan.scopes, ["project_head", "tracks", "selection"]);
    assert.deepEqual(
      plan.requests.map((request) => request.id),
      [
        "template.project.create_observation_bundle",
        "template.project.create_project_map_snapshot",
        "template.tracks.list_tracks",
        "template.tracks.read_mixer_controls",
      ],
    );
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
