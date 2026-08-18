import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  ALPHA3_C3_PROJECT_INDEX_BACKGROUND_REFRESH_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_CHANGED_SINCE_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_MIGRATION_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_SQLITE_ADAPTER_CONTRACT,
  ALPHA3_C3_PROJECT_INDEX_SQLITE_LIFECYCLE_CONTRACT,
  createAlpha3C3ProjectIndex,
  createAlpha3C3ProjectIndexMigrations,
  createAlpha3C3ProjectIndexSchemaContract,
  openAlpha3C3ProjectIndexSqliteAdapter,
  openAlpha3C3ProjectIndexSqliteLifecycle,
  planAlpha3C3ProjectIndexBackgroundRefresh,
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
    assert.equal(schema.backend_policy.optional_runtime_backend, "sqlite_file_when_node_sqlite_is_available");
    assert.equal(schema.backend_policy.optional_persistent_adapter, "sqlite_file_adapter_when_node_sqlite_is_available");
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

  it("opens the optional SQLite lifecycle without making SQLite truth", async () => {
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-c3-sqlite-"));
    const dbPath = path.join(tempRoot, "state", "openreaper-project-index.sqlite");
    try {
      const result = await openAlpha3C3ProjectIndexSqliteLifecycle({
        dbPath,
        observed_at: "2026-07-07T20:10:00.000Z",
      });

      assert.equal(result.contract, ALPHA3_C3_PROJECT_INDEX_SQLITE_LIFECYCLE_CONTRACT);
      assert.equal(result.backend, "sqlite_file");
      assert.equal(result.safety.sqlite_is_truth, false);
      assert.equal(result.safety.raw_sql_exposed, false);
      if (result.ok) {
        assert.equal(result.lifecycle, "ready");
        assert.equal(result.db_path, dbPath);
        assert.deepEqual(result.migrations.applied, ["001_project_index_core"]);
        assert.equal(result.schema_summary.schema_version, 1);
        assert.equal(result.schema_summary.project_truth, "REAPER");
      } else {
        assert.equal(result.lifecycle, "degraded");
        assert.equal(result.blockers[0].code, "SQLITE_BACKEND_UNAVAILABLE");
      }
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("degrades instead of accepting an incompatible existing SQLite cache", async () => {
    let sqliteModule;
    try {
      sqliteModule = await import("node:sqlite");
    } catch {
      return;
    }
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-c3-sqlite-bad-"));
    const dbPath = path.join(tempRoot, "state", "openreaper-project-index.sqlite");
    try {
      await mkdir(path.dirname(dbPath), { recursive: true });
      const database = new sqliteModule.DatabaseSync(dbPath);
      try {
        database.exec("CREATE TABLE media_sources (foo TEXT)");
      } finally {
        database.close();
      }
      const result = await openAlpha3C3ProjectIndexSqliteLifecycle({
        dbPath,
        observed_at: "2026-07-07T20:12:00.000Z",
      });

      assert.equal(result.ok, false);
      assert.equal(result.lifecycle, "degraded");
      assert.equal(result.blockers.some((blocker) =>
        blocker.code === "SQLITE_SCHEMA_MISMATCH" &&
        blocker.table === "media_sources" &&
        blocker.missing_columns.includes("ref")
      ), true);
      assert.deepEqual(result.migrations.applied, []);
      assert.equal(result.safety.sqlite_is_truth, false);
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("persists compact rows into the SQLite adapter and restores them on reopen", async () => {
    try {
      await import("node:sqlite");
    } catch {
      return;
    }
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-c3-sqlite-adapter-"));
    const dbPath = path.join(tempRoot, "state", "openreaper-project-index.sqlite");
    try {
      const first = await openAlpha3C3ProjectIndexSqliteAdapter({
        dbPath,
        now: fixedNow,
        projectRef: "project:active",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 4,
        sessionId: "session:c3-sqlite",
        observed_at: "2026-07-08T00:05:00.000Z",
      });

      assert.equal(first.contract, ALPHA3_C3_PROJECT_INDEX_SQLITE_ADAPTER_CONTRACT);
      assert.equal(first.ok, true);
      assert.equal(first.lifecycle, "ready");
      assert.equal(first.adapter_lifecycle, "ready");
      assert.equal(first.backend, "sqlite_file_adapter");
      assert.equal(first.safety.sqlite_is_truth, false);
      assert.equal(first.safety.hidden_executor, false);

      first.adapter.replaceTracks({
        snapshot_id: "snapshot:c3-sqlite:tracks",
        observed_at: "2026-07-08T00:06:00.000Z",
        payload_ref: "artifact:sqlite:tracks",
        rows: [
          {
            ref: "track:guid:{SQLITE-A}",
            owner_ref: "project:active",
            name: "对白 主轨 中文",
            index: 0,
            selected: true,
            item_count: 8,
            fx_count: 2,
            summary: { role: "drums" },
          },
        ],
      });
      first.adapter.replaceItems({
        snapshot_id: "snapshot:c3-sqlite:items",
        observed_at: "2026-07-08T00:06:30.000Z",
        payload_ref: "artifact:sqlite:items",
        rows: [
          {
            ref: "item:guid:{SQLITE-ITEM}",
            track_ref: "track:guid:{SQLITE-A}",
            start_seconds: 1,
            end_seconds: 2.5,
          },
        ],
      });
      first.adapter.replaceTakes({
        snapshot_id: "snapshot:c3-sqlite:takes",
        observed_at: "2026-07-08T00:06:35.000Z",
        payload_ref: "artifact:sqlite:takes",
        rows: [
          {
            ref: "take:guid:{SQLITE-TAKE}",
            owner_ref: "item:guid:{SQLITE-ITEM}",
            item_ref: "item:guid:{SQLITE-ITEM}",
            track_ref: "track:guid:{SQLITE-A}",
            name: "对白 Take 你好",
            active: true,
            source_kind: "audio",
          },
        ],
      });
      first.adapter.replaceEnvelopes({
        snapshot_id: "snapshot:c3-sqlite:automation",
        observed_at: "2026-07-08T00:06:45.000Z",
        payload_ref: "artifact:sqlite:automation",
        rows: [
          {
            ref: "envelope:track:guid:{SQLITE-A}:volume",
            owner_ref: "track:guid:{SQLITE-A}",
            parent_kind: "track",
            name: "Volume",
            lane_kind: "volume",
            visible: true,
            armed: true,
            point_count: 3,
            summary: { preview_omitted: true },
          },
        ],
      });
      first.adapter.recordObjectChanges({
        observed_at: "2026-07-08T00:07:00.000Z",
        changes: [
          {
            change_id: "change:sqlite:001",
            ref: "track:guid:{SQLITE-A}",
            owner_ref: "project:active",
            change_kind: "track_controls_readback",
            payload_ref: "artifact:sqlite:readback",
            summary: { source: "batch_readback" },
          },
        ],
      });
      first.adapter.recordBackgroundJob({
        job_id: "job:sqlite:refresh",
        status: "queued",
        started_at: "2026-07-08T00:08:00.000Z",
        summary: { scopes: ["tracks"], request_count: 3 },
      });
      first.adapter.close({ observed_at: "2026-07-08T00:09:00.000Z" });
      const postCloseWrite = first.adapter.replaceTracks({
        snapshot_id: "snapshot:c3-sqlite:post-close",
        observed_at: "2026-07-08T00:09:30.000Z",
        rows: [{ ref: "track:guid:{SHOULD-NOT-WRITE}", name: "Closed Write" }],
      });
      assert.equal(postCloseWrite.ok, false);
      assert.equal(postCloseWrite.blockers[0].code, "SQLITE_ADAPTER_CLOSED");
      assert.equal(first.adapter.snapshot().rows.tracks[0].name, "对白 主轨 中文");

      const missingIdentity = await openAlpha3C3ProjectIndexSqliteAdapter({
        dbPath,
        now: fixedNow,
        observed_at: "2026-07-08T00:10:00.000Z",
      });
      assert.equal(missingIdentity.ok, true);
      assert.equal(missingIdentity.lifecycle, "stale_session");
      assert.equal(missingIdentity.blockers.some((blocker) =>
        blocker.code === "SQLITE_SESSION_IDENTITY_REQUIRED"
      ), true);
      const missingIdentityPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        limit: 10,
      }, { projectIndex: missingIdentity.adapter });
      assert.equal(missingIdentityPlan.ok, false);
      assert.equal(missingIdentityPlan.blockers.some((blocker) => blocker.code === "INDEX_STALE_SESSION"), true);
      const missingIdentityChanged = missingIdentity.adapter.changedSince({
        since: "2026-07-08T00:06:30.000Z",
        limit: 10,
      });
      assert.equal(missingIdentityChanged.ok, false);
      assert.equal(missingIdentityChanged.blockers[0].code, "INDEX_STALE_SESSION");
      missingIdentity.adapter.close({ observed_at: "2026-07-08T00:10:15.000Z" });

      const second = await openAlpha3C3ProjectIndexSqliteAdapter({
        dbPath,
        now: fixedNow,
        projectRef: "project:active",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 4,
        sessionId: "session:c3-sqlite",
        observed_at: "2026-07-08T00:10:30.000Z",
      });
      assert.equal(second.ok, true);
      assert.equal(second.lifecycle, "closed");
      assert.equal(second.adapter_lifecycle, "ready");
      assert.equal(second.snapshot.lifecycle, "closed");
      const snapshot = second.adapter.snapshot();
      const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        filters: { selected: true },
        fields: ["name", "item_count", "fx_count", "payload_ref"],
        limit: 10,
      }, { projectIndex: second.adapter });
      const changed = second.adapter.changedSince({
        since: "2026-07-08T00:06:30.000Z",
        limit: 10,
      });

      assert.equal(snapshot.db_path, dbPath);
      assert.equal(snapshot.project_ref, "project:active");
      assert.equal(snapshot.bridge_generation, 4);
      assert.equal(snapshot.rows.tracks.length, 1);
      assert.equal(snapshot.rows.items.length, 1);
      assert.equal(snapshot.rows.takes.length, 1);
      assert.equal(snapshot.rows.envelopes.length, 1);
      assert.equal(snapshot.rows.tracks[0].name, "对白 主轨 中文");
      assert.equal(snapshot.rows.takes[0].name, "对白 Take 你好");
      assert.equal(snapshot.rows.envelopes[0].payload_ref, "artifact:sqlite:automation");
      assert.equal(snapshot.rows.tracks[0].payload_ref, "artifact:sqlite:tracks");
      assert.deepEqual(snapshot.rows.tracks[0].summary, { role: "drums" });
      assert.equal("name" in snapshot.rows.tracks[0].summary, false);
      assert.equal(snapshot.freshness_scopes.tracks.status, "fresh");
      assert.equal(snapshot.rows.background_jobs[0].job_id, "job:sqlite:refresh");
      assert.equal(plan.ok, false);
      assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_NOT_READY"), true);
      assert.equal(changed.ok, false);
      assert.equal(changed.blockers[0].code, "INDEX_NOT_READY");
      second.adapter.open({ observed_at: "2026-07-08T00:11:00.000Z" });
      const reopenedPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        filters: { selected: true },
        fields: ["name", "item_count", "fx_count", "payload_ref"],
        limit: 10,
      }, { projectIndex: second.adapter });
      const reopenedItemsPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_items", {
        filters: { track_ref: "track:guid:{SQLITE-A}" },
        fields: ["track_ref", "start_seconds", "length_seconds", "payload_ref"],
        limit: 10,
      }, { projectIndex: second.adapter });
      const reopenedTakesPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_takes", {
        filters: { track_ref: "track:guid:{SQLITE-A}" },
        fields: ["name", "item_ref", "track_ref", "source_kind", "payload_ref"],
        limit: 10,
      }, { projectIndex: second.adapter });
      const reopenedAutomationPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_automation", {
        filters: { owner_ref: "track:guid:{SQLITE-A}", has_points: true },
        fields: ["owner_ref", "name", "point_count", "payload_ref"],
        limit: 10,
      }, { projectIndex: second.adapter });
      assert.equal(reopenedPlan.ok, true);
      assert.deepEqual(reopenedPlan.refs, ["track:guid:{SQLITE-A}"]);
      assert.deepEqual(reopenedPlan.rows[0], {
        ref: "track:guid:{SQLITE-A}",
        name: "对白 主轨 中文",
        item_count: 8,
        fx_count: 2,
        payload_ref: "artifact:sqlite:tracks",
      });
      assert.equal(reopenedItemsPlan.ok, true);
      assert.deepEqual(reopenedItemsPlan.refs, ["item:guid:{SQLITE-ITEM}"]);
      assert.deepEqual(reopenedItemsPlan.rows[0], {
        ref: "item:guid:{SQLITE-ITEM}",
        track_ref: "track:guid:{SQLITE-A}",
        start_seconds: 1,
        length_seconds: 1.5,
        payload_ref: "artifact:sqlite:items",
      });
      assert.equal(reopenedTakesPlan.ok, true);
      assert.deepEqual(reopenedTakesPlan.refs, ["take:guid:{SQLITE-TAKE}"]);
      assert.deepEqual(reopenedTakesPlan.rows[0], {
        ref: "take:guid:{SQLITE-TAKE}",
        name: "对白 Take 你好",
        item_ref: "item:guid:{SQLITE-ITEM}",
        track_ref: "track:guid:{SQLITE-A}",
        source_kind: "audio",
        payload_ref: "artifact:sqlite:takes",
      });
      assert.equal(reopenedAutomationPlan.ok, true);
      assert.deepEqual(reopenedAutomationPlan.refs, ["envelope:track:guid:{SQLITE-A}:volume"]);
      assert.deepEqual(reopenedAutomationPlan.rows[0], {
        ref: "envelope:track:guid:{SQLITE-A}:volume",
        owner_ref: "track:guid:{SQLITE-A}",
        name: "Volume",
        point_count: 3,
        payload_ref: "artifact:sqlite:automation",
      });
      const reopenedChanged = second.adapter.changedSince({
        since: "2026-07-08T00:06:30.000Z",
        limit: 10,
      });
      assert.deepEqual(reopenedChanged.refs, ["track:guid:{SQLITE-A}"]);
      assert.equal(reopenedChanged.rows[0].payload_ref, "artifact:sqlite:readback");
      second.adapter.close({ observed_at: "2026-07-08T00:12:00.000Z" });
      const closedChanged = second.adapter.changedSince({
        since: "2026-07-08T00:06:30.000Z",
        limit: 10,
      });
      assert.equal(closedChanged.ok, false);
      assert.equal(closedChanged.blockers[0].code, "INDEX_NOT_READY");
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
  });

  it("marks restored SQLite rows stale when caller identity does not match the cache", async () => {
    try {
      await import("node:sqlite");
    } catch {
      return;
    }
    const tempRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-c3-sqlite-stale-"));
    const dbPath = path.join(tempRoot, "state", "openreaper-project-index.sqlite");
    try {
      const first = await openAlpha3C3ProjectIndexSqliteAdapter({
        dbPath,
        now: fixedNow,
        projectRef: "project:old",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 4,
        sessionId: "session:old",
        observed_at: "2026-07-08T00:20:00.000Z",
      });
      assert.equal(first.ok, true);
      first.adapter.replaceTracks({
        snapshot_id: "snapshot:c3-sqlite:old",
        observed_at: "2026-07-08T00:21:00.000Z",
        rows: [{ ref: "track:guid:{OLD}", owner_ref: "project:old", name: "Old Session Track" }],
      });
      first.adapter.recordObjectChanges({
        observed_at: "2026-07-08T00:21:30.000Z",
        changes: [
          {
            change_id: "change:old-session:001",
            ref: "track:guid:{OLD}",
            owner_ref: "project:old",
            change_kind: "old_session_change",
          },
        ],
      });
      first.adapter.close({ observed_at: "2026-07-08T00:22:00.000Z" });

      const second = await openAlpha3C3ProjectIndexSqliteAdapter({
        dbPath,
        now: fixedNow,
        projectRef: "project:new",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 5,
        sessionId: "session:new",
        observed_at: "2026-07-08T00:23:00.000Z",
      });
      const snapshot = second.adapter.snapshot();
      const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        limit: 10,
      }, { projectIndex: second.adapter });

      assert.equal(second.ok, true);
      assert.equal(second.lifecycle, "stale_session");
      assert.equal(second.adapter_lifecycle, "ready");
      assert.equal(second.blockers.some((blocker) =>
        blocker.code === "SQLITE_SESSION_MISMATCH" && blocker.field === "project_ref"
      ), true);
      assert.equal(second.blockers.some((blocker) =>
        blocker.code === "SQLITE_SESSION_MISMATCH" && blocker.field === "bridge_generation"
      ), true);
      assert.equal(snapshot.lifecycle, "stale_session");
      assert.equal(snapshot.freshness_scopes.tracks.status, "stale_session");
      assert.equal(snapshot.rows.tracks[0].name, "Old Session Track");
      assert.equal(plan.ok, false);
      assert.equal(plan.blockers.some((blocker) => blocker.code === "INDEX_STALE_SESSION"), true);
      const staleChanged = second.adapter.changedSince({
        since: "2026-07-08T00:20:00.000Z",
        limit: 10,
      });
      assert.equal(staleChanged.ok, false);
      assert.equal(staleChanged.blockers[0].code, "INDEX_STALE_SESSION");
      assert.deepEqual(staleChanged.refs, []);
      const staleRecordChange = second.adapter.recordObjectChanges({
        observed_at: "2026-07-08T00:23:02.000Z",
        changes: [{ change_id: "change:stale:should-not-write", ref: "track:guid:{STALE}" }],
      });
      const staleReadbackChange = second.adapter.markWriteReadbackApplied({
        observed_at: "2026-07-08T00:23:03.000Z",
        refs: ["track:guid:{STALE-READBACK}"],
      });
      const staleBackgroundJob = second.adapter.recordBackgroundJob({
        job_id: "job:stale:should-not-write",
        observed_at: "2026-07-08T00:23:04.000Z",
      });
      const staleCompleteJob = second.adapter.completeBackgroundJob({
        job_id: "job:stale:should-not-complete",
        observed_at: "2026-07-08T00:23:05.000Z",
      });
      assert.equal(staleRecordChange.ok, false);
      assert.equal(staleRecordChange.blockers[0].code, "INDEX_STALE_SESSION_MUTATION_REJECTED");
      assert.equal(staleReadbackChange.ok, false);
      assert.equal(staleReadbackChange.blockers[0].code, "INDEX_STALE_SESSION_MUTATION_REJECTED");
      assert.equal(staleBackgroundJob.ok, false);
      assert.equal(staleBackgroundJob.blockers[0].code, "INDEX_STALE_SESSION_MUTATION_REJECTED");
      assert.equal(staleCompleteJob.ok, false);
      assert.equal(staleCompleteJob.blockers[0].code, "INDEX_STALE_SESSION_MUTATION_REJECTED");
      assert.deepEqual(
        second.adapter.snapshot().rows.object_changes.map((row) => row.change_id),
        ["change:old-session:001"],
      );
      assert.deepEqual(second.adapter.snapshot().rows.background_jobs, []);
      const partialRefresh = second.adapter.replaceTracks({
        projectRef: "project:new",
        snapshot_id: "snapshot:c3-sqlite:partial",
        observed_at: "2026-07-08T00:23:10.000Z",
        rows: [{ ref: "track:guid:{PARTIAL}", owner_ref: "project:new", name: "Partial Identity Track" }],
      });
      assert.equal(partialRefresh.ok, false);
      assert.equal(partialRefresh.blockers[0].code, "INDEX_STALE_SESSION_REFRESH_REJECTED");
      assert.equal(second.adapter.snapshot().lifecycle, "stale_session");
      assert.equal(second.adapter.snapshot().project_ref, "project:old");
      assert.equal(second.adapter.snapshot().rows.tracks[0].name, "Old Session Track");
      const staleOpen = second.adapter.open({
        projectRef: "project:new",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 5,
        sessionId: "session:new",
        observed_at: "2026-07-08T00:23:15.000Z",
      });
      assert.equal(staleOpen.lifecycle, "stale_session");
      assert.equal(second.adapter.snapshot().project_ref, "project:old");
      const oldIdentityRefresh = second.adapter.replaceTracks({
        projectRef: "project:old",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 4,
        sessionId: "session:old",
        snapshot_id: "snapshot:c3-sqlite:wrong",
        observed_at: "2026-07-08T00:23:20.000Z",
        rows: [{ ref: "track:guid:{OLD-AGAIN}", owner_ref: "project:old", name: "Old Again Track" }],
      });
      assert.equal(oldIdentityRefresh.ok, false);
      assert.equal(oldIdentityRefresh.blockers[0].code, "INDEX_STALE_SESSION_REFRESH_REJECTED");
      assert.equal(second.adapter.snapshot().lifecycle, "stale_session");
      assert.equal(second.adapter.snapshot().session_id, "session:old");
      assert.equal(second.adapter.snapshot().rows.tracks[0].name, "Old Session Track");
      second.adapter.replaceSelection({
        projectRef: "project:new",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 5,
        sessionId: "session:new",
        snapshot_id: "snapshot:c3-sqlite:new-selection",
        observed_at: "2026-07-08T00:23:25.000Z",
        rows: [{ ref: "track:guid:{NEW-SELECTION}", owner_ref: "project:new" }],
      });
      const tracksAfterSelectionRecovery = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        limit: 10,
      }, { projectIndex: second.adapter });
      assert.equal(second.adapter.snapshot().lifecycle, "ready");
      assert.equal(second.adapter.snapshot().freshness_scopes.tracks.status, "stale_session");
      assert.equal(tracksAfterSelectionRecovery.ok, false);
      assert.equal(tracksAfterSelectionRecovery.blockers.some((blocker) => blocker.code === "INDEX_REFRESH_REQUIRED"), true);
      second.adapter.replaceTracks({
        projectRef: "project:new",
        bridgeOwner: "openreaper-alpha3-local",
        bridgeGeneration: 5,
        sessionId: "session:new",
        snapshot_id: "snapshot:c3-sqlite:new",
        observed_at: "2026-07-08T00:23:30.000Z",
        rows: [{ ref: "track:guid:{NEW}", owner_ref: "project:new", name: "New Session Track" }],
      });
      const refreshedPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_tracks", {
        limit: 10,
        fields: ["name"],
      }, { projectIndex: second.adapter });
      assert.equal(second.adapter.snapshot().lifecycle, "ready");
      assert.equal(second.adapter.snapshot().project_ref, "project:new");
      assert.equal(second.adapter.snapshot().freshness_scopes.tracks.status, "fresh");
      assert.deepEqual(refreshedPlan.refs, ["track:guid:{NEW}"]);
      assert.deepEqual(refreshedPlan.rows[0], {
        ref: "track:guid:{NEW}",
        name: "New Session Track",
      });
      const changedAfterRecovery = second.adapter.changedSince({
        since: "2026-07-08T00:20:00.000Z",
        limit: 10,
      });
      assert.deepEqual(changedAfterRecovery.refs, []);
      assert.deepEqual(second.adapter.snapshot().rows.background_jobs, []);
      second.adapter.close({ observed_at: "2026-07-08T00:24:00.000Z" });
    } finally {
      await rm(tempRoot, { recursive: true, force: true });
    }
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
          preserve_pitch: false,
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
      fields: ["item_ref", "track_ref", "active", "preserve_pitch", "reverse", "has_take_fx", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_takes");
    assert.equal(snapshot.rows.takes.length, 2);
    assert.equal(snapshot.rows.takes[1].item_ref, "item:guid:{ITEM-2}");
    assert.equal(snapshot.rows.takes[0].payload_ref, "artifact:takes:map");
    assert.equal(snapshot.rows.takes[0].preserve_pitch, false);
    assert.equal(snapshot.rows.takes[0].reverse, null);
    assert.equal(snapshot.rows.takes[0].has_take_fx, null);
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
      preserve_pitch: null,
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

  it("maintains automation envelope rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-automation",
    });

    const result = index.replaceEnvelopes({
      snapshot_id: "snapshot:c3-automation",
      observed_at: "2026-07-07T19:15:00.000Z",
      payload_ref: "artifact:automation:envelopes",
      rows: [
        {
          envelope_ref: "envelope:track:guid:{A}:volume",
          owner_ref: "track:guid:{A}",
          parent_kind: "track",
          name: "Volume",
          lane_kind: "volume",
          visible: true,
          armed: true,
          point_count: 5,
        },
        {
          ref: "envelope:fx:track:guid:{A}:0:wet",
          owner_ref: "track:guid:{A}",
          target_ref: "fx:track:guid:{A}:0",
          parent_kind: "fx",
          name: "Wet",
          lane_kind: "fx_parameter",
          visible: true,
          point_count: 2,
        },
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_automation", {
      scope: "automation",
      limit: 10,
      filters: { owner_ref: "track:guid:{A}", visible: true, has_points: true },
      fields: ["owner_ref", "parent_kind", "name", "point_count", "payload_ref"],
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_envelopes");
    assert.equal(snapshot.rows.envelopes.length, 2);
    assert.equal(snapshot.rows.envelopes[0].ref, "envelope:track:guid:{A}:volume");
    assert.equal(snapshot.rows.envelopes[0].payload_ref, "artifact:automation:envelopes");
    assert.equal(snapshot.freshness_scopes.automation.status, "fresh");
    assert.equal(snapshot.freshness_scopes.automation.coverage_status, "paged");
    assert.equal(snapshot.freshness_scopes.automation.source_template_id, "template.automation.list_project_envelopes");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "automation"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, [
      "envelope:track:guid:{A}:volume",
      "envelope:fx:track:guid:{A}:0:wet",
    ]);
    assert.deepEqual(plan.rows[0], {
      ref: "envelope:track:guid:{A}:volume",
      owner_ref: "track:guid:{A}",
      parent_kind: "track",
      name: "Volume",
      point_count: 5,
      payload_ref: "artifact:automation:envelopes",
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

  it("maintains media source rows with task-scoped freshness and compact query fields", () => {
    const index = createAlpha3C3ProjectIndex({
      now: fixedNow,
      projectRef: "project:active",
      bridgeOwner: "openreaper-alpha3-local",
      bridgeGeneration: 3,
      sessionId: "session:c3-11",
    });

    const result = index.replaceMediaSources({
      snapshot_id: "snapshot:c3-11:media",
      observed_at: "2026-07-07T19:45:00.000Z",
      payload_ref: "artifact:media:project",
      file_refs: [
        "file:path:/tmp/openreaper/Kick.wav",
        "file:path:/tmp/openreaper/Guide.mid",
      ],
    });
    const snapshot = index.snapshot();
    const plan = planAlpha3C3ProjectIndexQueryMacro("macro.query_media", {
      scope: "media",
      limit: 10,
      filters: { media_type: "audio" },
      fields: ["name", "media_type", "extension", "payload_ref"],
    }, { projectIndex: index });
    const onlineFilterPlan = planAlpha3C3ProjectIndexQueryMacro("macro.query_media", {
      scope: "media",
      limit: 10,
      filters: { media_type: "audio", offline: false },
    }, { projectIndex: index });

    assert.equal(result.operation, "replace_media_sources");
    assert.equal(snapshot.rows.media_sources.length, 2);
    assert.equal(snapshot.rows.media_sources[0].name, "Kick.wav");
    assert.equal(snapshot.rows.media_sources[0].media_type, "audio");
    assert.equal(snapshot.rows.media_sources[0].offline, null);
    assert.equal(snapshot.rows.media_sources[1].media_type, "midi");
    assert.equal(snapshot.rows.media_sources[0].payload_ref, "artifact:media:project");
    assert.equal(snapshot.freshness_scopes.media.status, "fresh");
    assert.equal(snapshot.freshness_scopes.media.coverage_status, "paged");
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "media"), true);
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.refs, ["file:path:/tmp/openreaper/Kick.wav"]);
    assert.deepEqual(plan.rows[0], {
      ref: "file:path:/tmp/openreaper/Kick.wav",
      name: "Kick.wav",
      media_type: "audio",
      extension: "wav",
      payload_ref: "artifact:media:project",
    });
    assert.equal(onlineFilterPlan.ok, true);
    assert.deepEqual(onlineFilterPlan.refs, []);
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
    const mediaOnly = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["media"],
      limit: 40,
    });
    assert.deepEqual(
      mediaOnly.requests.map((request) => request.id),
      ["template.media.read_project_media_files"],
    );
    assert.deepEqual(mediaOnly.requests[0].input, {
      include_offline: true,
      include_metadata_keys: false,
      max_sources: 40,
    });
    assert.equal(plan.update_policy.source_truth, "REAPER");
    assert.equal(plan.update_policy.apply_after_readback, true);
    assert.equal(plan.safety.hidden_executor, false);
    assert.equal(plan.safety.live_reaper, false);
  });

  it("blocks catalog drift instead of emitting missing task refresh requests", () => {
    const plan = planAlpha3C3ProjectIndexTaskRefresh({
      scopes: ["tracks"],
      limit: 40,
      catalog: catalogMissing("template.tracks.list_tracks"),
    });

    assert.equal(plan.ok, false);
    assert.equal(
      plan.blockers.some((entry) =>
        entry.code === "MISSING_ACCEPTED_TEMPLATE" && /template\.tracks\.list_tracks/.test(entry.message)
      ),
      true,
    );
    assert.deepEqual(
      plan.requests.map((request) => request.id),
      [
        "template.project.create_project_map_snapshot",
        "template.tracks.read_mixer_controls",
      ],
    );

    const background = planAlpha3C3ProjectIndexBackgroundRefresh({
      job_id: "job:c3-13:refresh",
      scopes: ["takes"],
      limit: 40,
      catalog: catalogMissing("template.items.list_selected_items"),
    });
    assert.equal(background.ok, false);
    assert.equal(background.refresh_plan.ok, false);
    assert.deepEqual(
      background.requests.map((request) => request.id),
      ["template.project.create_project_map_snapshot"],
    );
    assert.equal(
      background.blockers.some((entry) =>
        entry.code === "MISSING_ACCEPTED_TEMPLATE" && /template\.items\.list_selected_items/.test(entry.message)
      ),
      true,
    );
    assert.equal(background.execution.executed, false);
    assert.equal(background.execution.hidden_executor, false);
  });

  it("plans background refresh jobs without adding an executor", () => {
    const plan = planAlpha3C3ProjectIndexBackgroundRefresh({
      job_id: "job:c3-12:refresh",
      status: "completed",
      completed_at: "2026-07-07T20:16:00.000Z",
      observed_at: "2026-07-07T20:15:00.000Z",
      scopes: ["tracks", "media"],
      limit: 40,
      summary: {
        applied_after_readback: true,
      },
    });

    assert.equal(plan.contract, ALPHA3_C3_PROJECT_INDEX_BACKGROUND_REFRESH_CONTRACT);
    assert.equal(plan.ok, true);
    assert.equal(plan.job.job_id, "job:c3-12:refresh");
    assert.equal(plan.job.status, "planned");
    assert.equal(plan.job.completed_at, null);
    assert.deepEqual(plan.job.summary.scopes, ["tracks", "media"]);
    assert.equal("applied_after_readback" in plan.job.summary, false);
    assert.equal(plan.requests.some((request) => request.id === "template.tracks.list_tracks"), true);
    assert.equal(plan.requests.some((request) => request.id === "template.media.read_project_media_files"), true);
    assert.equal(plan.execution.executed, false);
    assert.equal(plan.execution.hidden_executor, false);
    assert.equal(plan.execution.added_tools, 0);
    assert.equal(plan.update_policy.write_sqlite_only_after_readback, true);
    assert.equal(plan.safety.sqlite_is_truth, false);
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

  it("filters invalid track rows before resident or SQLite persistence", () => {
    const index = createAlpha3C3ProjectIndex({ now: fixedNow });
    const result = index.replaceTracks({
      snapshot_id: "snapshot:c3:invalid-track-filter",
      observed_at: "2026-07-07T16:58:00.000Z",
      rows: [
        { name: "Missing ref" },
        { ref: "", name: "Empty ref" },
        { ref: "track:guid:{VALID}", name: "Valid" },
      ],
    });

    assert.equal(result.ok, true);
    assert.deepEqual(index.snapshot().rows.tracks.map((row) => row.ref), ["track:guid:{VALID}"]);
  });

  it("keeps background job rows as status ledger, not project truth", () => {
    const index = createAlpha3C3ProjectIndex({ now: fixedNow });
    index.recordBackgroundJob({
      job_id: "job:c3-12:refresh",
      job_kind: "task_scoped_refresh",
      status: "queued",
      started_at: "2026-07-07T20:20:00.000Z",
      summary: {
        scopes: ["tracks"],
        request_count: 3,
      },
    });
    index.completeBackgroundJob({
      job_id: "job:c3-12:refresh",
      job_kind: "task_scoped_refresh",
      status: "completed",
      completed_at: "2026-07-07T20:21:00.000Z",
      summary: {
        applied_after_readback: true,
      },
    });
    const snapshot = index.snapshot();

    assert.equal(snapshot.rows.background_jobs.length, 1);
    assert.equal(snapshot.rows.background_jobs[0].status, "completed");
    assert.equal(snapshot.rows.background_jobs[0].started_at, "2026-07-07T20:20:00.000Z");
    assert.equal(snapshot.rows.background_jobs[0].completed_at, "2026-07-07T20:21:00.000Z");
    assert.deepEqual(snapshot.rows.background_jobs[0].summary.scopes, ["tracks"]);
    assert.equal(snapshot.rows.background_jobs[0].summary.request_count, 3);
    assert.equal(snapshot.rows.background_jobs[0].summary.applied_after_readback, true);
    assert.equal(snapshot.safety.sqlite_is_truth, false);
    assert.equal(projectIndexScopeIsFreshEnough(snapshot, "tracks"), false);
  });
});

function fixedNow() {
  return new Date("2026-07-07T16:59:15.000Z");
}

function catalogMissing(...missingTemplateIds) {
  const missing = new Set(missingTemplateIds);
  return {
    get(id) {
      return missing.has(id) ? null : { id };
    },
  };
}
