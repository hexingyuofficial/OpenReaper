export const ALPHA3_C3_PROJECT_INDEX_CONTRACT = "alpha3.c3.project_sqlite_index.v1";
export const ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT = "alpha3.c3.project_index_schema.v1";
export const ALPHA3_C3_PROJECT_INDEX_MIGRATION_CONTRACT = "alpha3.c3.project_index_migrations.v1";
export const ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT = "alpha3.c3.project_index_lifecycle.v1";
export const ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT = "alpha3.c3.project_index_refresh_plan.v1";
export const ALPHA3_C3_PROJECT_INDEX_CHANGED_SINCE_CONTRACT = "alpha3.c3.project_index_changed_since.v1";
export const ALPHA3_C3_PROJECT_INDEX_SQLITE_LIFECYCLE_CONTRACT = "alpha3.c3.project_index_sqlite_lifecycle.v1";
export const ALPHA3_C3_PROJECT_INDEX_BACKGROUND_REFRESH_CONTRACT = "alpha3.c3.project_index_background_refresh.v1";

export const ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION = 1;
export const ALPHA3_C3_PROJECT_INDEX_DB_PATH = "run_root/state/openreaper-project-index.sqlite";

export const ALPHA3_C3_PROJECT_INDEX_TABLES = deepFreeze([
  "index_meta",
  "sessions",
  "snapshots",
  "freshness_scopes",
  "tracks",
  "items",
  "takes",
  "fx",
  "sends",
  "envelopes",
  "markers_regions",
  "media_sources",
  "selection_state",
  "object_changes",
  "background_jobs",
]);

export const ALPHA3_C3_PROJECT_INDEX_FRESHNESS_STATUSES = deepFreeze([
  "fresh",
  "fresh_enough",
  "stale",
  "unknown",
  "detail_not_loaded",
  "detail_stale",
  "refresh_failed",
  "stale_session",
]);

export const ALPHA3_C3_PROJECT_INDEX_COVERAGE_STATUSES = deepFreeze([
  "complete",
  "partial",
  "head_only",
  "selected_only",
  "paged",
  "truncated",
  "unknown",
  "failed",
]);

export const ALPHA3_C3_PROJECT_INDEX_DB_LIFECYCLE_STATES = deepFreeze([
  "missing",
  "opening",
  "ready",
  "degraded",
  "rebuilding",
  "stale_session",
  "closed",
]);

const BACKGROUND_JOB_STATUSES = deepFreeze([
  "planned",
  "queued",
  "running",
  "completed",
  "blocked",
  "failed",
]);

const OBJECT_ROW_REQUIRED_FIELDS = deepFreeze([
  "snapshot_id",
  "ref",
  "owner_ref",
  "summary",
  "observed_at",
  "freshness_status",
  "coverage_status",
  "payload_ref",
]);

const SQLITE_DDL_V1 = deepFreeze([
  `CREATE TABLE IF NOT EXISTS index_meta (
    key TEXT PRIMARY KEY,
    value_json TEXT NOT NULL,
    observed_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    session_id TEXT PRIMARY KEY,
    project_ref TEXT,
    bridge_owner TEXT,
    bridge_generation INTEGER,
    status TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    stale_reason TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS snapshots (
    snapshot_id TEXT PRIMARY KEY,
    project_ref TEXT,
    session_id TEXT,
    observed_at TEXT NOT NULL,
    source_template_id TEXT,
    coverage_status TEXT NOT NULL,
    payload_ref TEXT,
    summary_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS freshness_scopes (
    scope_key TEXT PRIMARY KEY,
    scope_kind TEXT NOT NULL,
    scope_ref TEXT NOT NULL,
    snapshot_id TEXT,
    status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    expires_at TEXT,
    source_template_id TEXT,
    reason TEXT,
    payload_ref TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS tracks (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    name TEXT NOT NULL,
    track_index INTEGER,
    display_number TEXT,
    selected INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    solo INTEGER NOT NULL DEFAULT 0,
    record_arm INTEGER NOT NULL DEFAULT 0,
    folder_depth INTEGER NOT NULL DEFAULT 0,
    item_count INTEGER NOT NULL DEFAULT 0,
    fx_count INTEGER NOT NULL DEFAULT 0,
    send_count INTEGER NOT NULL DEFAULT 0,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS items (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    track_ref TEXT,
    start_seconds REAL,
    end_seconds REAL,
    selected INTEGER NOT NULL DEFAULT 0,
    muted INTEGER NOT NULL DEFAULT 0,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS takes (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    item_ref TEXT,
    active INTEGER NOT NULL DEFAULT 0,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS fx (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    plugin_name TEXT,
    plugin_id TEXT,
    slot_index INTEGER,
    bypassed INTEGER NOT NULL DEFAULT 0,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS sends (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    source_track_ref TEXT,
    destination_track_ref TEXT,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS envelopes (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    target_ref TEXT,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS markers_regions (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    marker_kind TEXT NOT NULL,
    position_seconds REAL,
    end_seconds REAL,
    name TEXT,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS media_sources (
    snapshot_id TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    path_fingerprint TEXT,
    source_kind TEXT,
    freshness_status TEXT NOT NULL,
    coverage_status TEXT NOT NULL,
    observed_at TEXT,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS selection_state (
    snapshot_id TEXT NOT NULL,
    scope_kind TEXT NOT NULL,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    observed_at TEXT NOT NULL,
    payload_ref TEXT,
    summary_json TEXT NOT NULL,
    PRIMARY KEY (snapshot_id, scope_kind, ref)
  )`,
  `CREATE TABLE IF NOT EXISTS object_changes (
    change_id TEXT PRIMARY KEY,
    snapshot_id TEXT,
    ref TEXT NOT NULL,
    owner_ref TEXT,
    change_kind TEXT NOT NULL,
    observed_at TEXT NOT NULL,
    payload_ref TEXT,
    summary_json TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS background_jobs (
    job_id TEXT PRIMARY KEY,
    job_kind TEXT NOT NULL,
    status TEXT NOT NULL,
    started_at TEXT,
    completed_at TEXT,
    blocker_json TEXT,
    summary_json TEXT NOT NULL
  )`,
]);

const SQLITE_INDEX_DDL_V1 = deepFreeze([
  "CREATE INDEX IF NOT EXISTS idx_tracks_ref ON tracks(ref)",
  "CREATE INDEX IF NOT EXISTS idx_tracks_selected ON tracks(selected)",
  "CREATE INDEX IF NOT EXISTS idx_tracks_observed_at ON tracks(observed_at)",
  "CREATE INDEX IF NOT EXISTS idx_items_track_ref ON items(track_ref)",
  "CREATE INDEX IF NOT EXISTS idx_fx_owner_ref ON fx(owner_ref)",
  "CREATE INDEX IF NOT EXISTS idx_object_changes_observed_at ON object_changes(observed_at)",
  "CREATE INDEX IF NOT EXISTS idx_freshness_scope_kind ON freshness_scopes(scope_kind)",
]);

export function createAlpha3C3ProjectIndexSchemaContract(options = {}) {
  const dbPath = typeof options.dbPath === "string" && options.dbPath
    ? options.dbPath
    : ALPHA3_C3_PROJECT_INDEX_DB_PATH;
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT,
    schema_version: ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION,
    db_path: dbPath,
    storage_role: "sqlite_schema_contract_with_resident_adapter",
    backend_policy: {
      current_runtime_backend: "resident_memory_adapter",
      future_persistent_backend: "sqlite_file",
      optional_runtime_backend: "sqlite_file_when_node_sqlite_is_available",
      node_sqlite_dependency: "optional_dynamic_node_sqlite_with_degraded_mode",
    },
    tables: ALPHA3_C3_PROJECT_INDEX_TABLES,
    object_row_required_fields: OBJECT_ROW_REQUIRED_FIELDS,
    row_shape: {
      ref: "canonical object ref",
      owner_ref: "canonical owner ref or null for project-owned rows",
      summary: "compact JSON summary, never full payload by default",
      freshness_status: ALPHA3_C3_PROJECT_INDEX_FRESHNESS_STATUSES,
      coverage_status: ALPHA3_C3_PROJECT_INDEX_COVERAGE_STATUSES,
      observed_at: "ISO timestamp from REAPER readback/refresh",
      snapshot_id: "task or refresh snapshot id",
      payload_ref: "optional Artifact Store ref for source payload/readback proof",
    },
    migrations: createAlpha3C3ProjectIndexMigrations({ dbPath }),
    truth_boundary: projectIndexTruthBoundary(),
    safety: projectIndexSafety(),
  });
}

export function createAlpha3C3ProjectIndexMigrations(options = {}) {
  const dbPath = typeof options.dbPath === "string" && options.dbPath
    ? options.dbPath
    : ALPHA3_C3_PROJECT_INDEX_DB_PATH;
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_MIGRATION_CONTRACT,
    db_path: dbPath,
    current_schema_version: ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION,
    migrations: [
      {
        id: "001_project_index_core",
        from_version: 0,
        to_version: 1,
        statements: [
          ...SQLITE_DDL_V1,
          ...SQLITE_INDEX_DDL_V1,
        ],
        reversible: false,
        user_data_destructive: false,
      },
    ],
    policy: {
      raw_sql_user_input: false,
      migration_sql_is_internal_contract_only: true,
      sqlite_is_truth: false,
      write_requires_reaper_reresolve: true,
    },
  });
}

export async function openAlpha3C3ProjectIndexSqliteLifecycle(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const observedAt = safeInputIso(options.observed_at, now);
  const dbPath = typeof options.dbPath === "string" && options.dbPath
    ? options.dbPath
    : ALPHA3_C3_PROJECT_INDEX_DB_PATH;
  const migrationIds = createAlpha3C3ProjectIndexMigrations({ dbPath }).migrations.map((migration) => migration.id);
  let sqliteModule;
  try {
    sqliteModule = await import("node:sqlite");
  } catch (error) {
    return sqliteLifecycleResult({
      ok: false,
      lifecycle: "degraded",
      dbPath,
      observedAt,
      migrationIds,
      blockers: [
        {
          code: "SQLITE_BACKEND_UNAVAILABLE",
          message: "node:sqlite is not available in this runtime; use the resident adapter and task-scoped refresh until a SQLite backend is available.",
          detail: typeof error?.code === "string" ? error.code : "import_failed",
        },
      ],
    });
  }

  try {
    const { mkdir } = await import("node:fs/promises");
    const path = await import("node:path");
    await mkdir(path.dirname(dbPath), { recursive: true });
    const database = new sqliteModule.DatabaseSync(dbPath);
    try {
      for (const statement of SQLITE_DDL_V1) database.exec(statement);
      for (const statement of SQLITE_INDEX_DDL_V1) database.exec(statement);
      const schemaBlockers = validateSqliteSchema(database);
      if (schemaBlockers.length > 0) {
        return sqliteLifecycleResult({
          ok: false,
          lifecycle: "degraded",
          dbPath,
          observedAt,
          migrationIds,
          blockers: schemaBlockers,
        });
      }
      const schemaSummary = {
        schema_version: ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION,
        migrations: migrationIds,
        project_truth: "REAPER",
        index_role: "local_query_navigation_cache",
      };
      database
        .prepare("INSERT OR REPLACE INTO index_meta (key, value_json, observed_at) VALUES (?, ?, ?)")
        .run("schema", JSON.stringify(schemaSummary), observedAt);
      const row = database
        .prepare("SELECT value_json FROM index_meta WHERE key = ?")
        .get("schema");
      return sqliteLifecycleResult({
        ok: true,
        lifecycle: "ready",
        dbPath,
        observedAt,
        migrationIds,
        schemaSummary: parseJsonObject(row?.value_json),
      });
    } finally {
      database.close();
    }
  } catch (error) {
    return sqliteLifecycleResult({
      ok: false,
      lifecycle: "degraded",
      dbPath,
      observedAt,
      migrationIds,
      blockers: [
        {
          code: "SQLITE_OPEN_OR_MIGRATION_FAILED",
          message: "Project SQLite Index could not open or apply internal migrations; fall back to resident adapter and refresh before relying on rows.",
          detail: String(error?.message ?? error),
        },
      ],
    });
  }
}

export function planAlpha3C3ProjectIndexBackgroundRefresh(input = {}) {
  const now = typeof input.now === "function" ? input.now : () => new Date();
  const observedAt = safeInputIso(input.observed_at, now);
  const refreshPlan = planAlpha3C3ProjectIndexTaskRefresh(input);
  const jobSource = isPlainObject(input.job) ? input.job : input;
  const job = normalizeBackgroundJob({
    job_id: typeof jobSource.job_id === "string" ? jobSource.job_id : null,
    job_kind: "task_scoped_refresh",
    status: "planned",
    started_at: observedAt,
    summary: {
      scopes: refreshPlan.scopes,
      request_count: refreshPlan.requests.length,
      source_truth: "REAPER",
      execution: "agent_runs_planned_call_template_requests",
    },
  }, {
    job_id: typeof jobSource.job_id === "string" && jobSource.job_id
      ? jobSource.job_id
      : `job:project-index-refresh:${observedAt}:${refreshPlan.scopes.join("+")}`,
    job_kind: "task_scoped_refresh",
    status: "planned",
    started_at: observedAt,
    summary: {},
  });
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_BACKGROUND_REFRESH_CONTRACT,
    ok: true,
    mode: "background_refresh_plan",
    job,
    refresh_plan: refreshPlan,
    requests: refreshPlan.requests,
    update_policy: {
      source_truth: "REAPER",
      apply_after_readback: true,
      write_sqlite_only_after_readback: true,
      background_job_is_not_truth: true,
    },
    execution: {
      executed: false,
      hidden_executor: false,
      added_tools: 0,
      live_reaper: false,
      safe_write: false,
    },
    safety: projectIndexSafety(),
  });
}

export function createAlpha3C3ProjectIndex(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const state = {
    lifecycle: "ready",
    schema_version: ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION,
    db_path: typeof options.dbPath === "string" && options.dbPath ? options.dbPath : ALPHA3_C3_PROJECT_INDEX_DB_PATH,
    project_ref: typeof options.projectRef === "string" ? options.projectRef : null,
    bridge_owner: typeof options.bridgeOwner === "string" ? options.bridgeOwner : null,
    bridge_generation: Number.isInteger(options.bridgeGeneration) ? options.bridgeGeneration : null,
    session_id: typeof options.sessionId === "string" ? options.sessionId : null,
    snapshot_id: null,
    freshness_scopes: {},
    coverage: {},
    degraded_reason: null,
    rows: {
      tracks: [],
      items: [],
      takes: [],
      fx: [],
      sends: [],
      markers_regions: [],
      media_sources: [],
      selection_state: [],
      object_changes: [],
      background_jobs: [],
    },
  };

  return Object.freeze({
    contract: ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT,
    backend: "resident_memory_adapter",
    db_path: state.db_path,
    schema_version: state.schema_version,
    safety: projectIndexSafety(),
    open(metadata = {}) {
      mergeSessionMetadata(state, metadata);
      if (state.lifecycle === "closed" || state.lifecycle === "missing" || state.lifecycle === "opening") {
        state.lifecycle = "ready";
      }
      return lifecycleResult(state, "open", safeNowIso(now));
    },
    snapshot() {
      return snapshotState(state);
    },
    replaceTracks(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.tracks = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeTrackRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          }))
        : [];
      updateScope(state, {
        scope_kind: "tracks",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "complete"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.tracks.list_tracks",
        payload_ref: input.payload_ref,
      });
      state.coverage.tracks = normalizeCoverageStatus(input.coverage_status, "complete");
      return lifecycleResult(state, "replace_tracks", observedAt);
    },
    replaceItems(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.items = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeItemRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "items",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "paged"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.project.create_project_map_snapshot",
        payload_ref: input.payload_ref,
      });
      state.coverage.items = normalizeCoverageStatus(input.coverage_status, "paged");
      return lifecycleResult(state, "replace_items", observedAt);
    },
    replaceTakes(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.takes = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeTakeRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "takes",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "paged"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.items.read_item_summary",
        payload_ref: input.payload_ref,
      });
      state.coverage.takes = normalizeCoverageStatus(input.coverage_status, "paged");
      return lifecycleResult(state, "replace_takes", observedAt);
    },
    replaceFx(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.fx = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeFxRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "fx",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "paged"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.fx.list_track_fx_chain",
        payload_ref: input.payload_ref,
      });
      state.coverage.fx = normalizeCoverageStatus(input.coverage_status, "paged");
      return lifecycleResult(state, "replace_fx", observedAt);
    },
    replaceSends(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.sends = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeSendRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "routing",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "paged"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.routing.read_project_routing_graph",
        payload_ref: input.payload_ref,
      });
      state.coverage.routing = normalizeCoverageStatus(input.coverage_status, "paged");
      return lifecycleResult(state, "replace_sends", observedAt);
    },
    replaceMarkersRegions(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.markers_regions = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeMarkerRegionRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            freshness_status: input.freshness_status,
            coverage_status: input.coverage_status,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "markers",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "complete"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.project.list_markers_regions",
        payload_ref: input.payload_ref,
      });
      state.coverage.markers = normalizeCoverageStatus(input.coverage_status, "complete");
      return lifecycleResult(state, "replace_markers_regions", observedAt);
    },
    replaceMediaSources(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      const rows = Array.isArray(input.rows)
        ? input.rows
        : Array.isArray(input.file_refs)
          ? input.file_refs.map((fileRef) => ({ file_ref: fileRef }))
          : [];
      state.rows.media_sources = rows.map((row) => normalizeMediaSourceRow(row, {
        snapshot_id: snapshotId,
        observed_at: observedAt,
        freshness_status: input.freshness_status,
        coverage_status: input.coverage_status,
        payload_ref: input.payload_ref,
      })).filter(Boolean);
      updateScope(state, {
        scope_kind: "media",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "paged"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.media.read_project_media_files",
        payload_ref: input.payload_ref,
      });
      state.coverage.media = normalizeCoverageStatus(input.coverage_status, "paged");
      return lifecycleResult(state, "replace_media_sources", observedAt);
    },
    replaceSelection(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = normalizeSnapshotId(input.snapshot_id ?? state.snapshot_id, observedAt);
      mergeSessionMetadata(state, input);
      state.lifecycle = state.lifecycle === "stale_session" ? "stale_session" : "ready";
      state.snapshot_id = snapshotId;
      state.rows.selection_state = Array.isArray(input.rows)
        ? input.rows.map((row) => normalizeSelectionRow(row, {
            snapshot_id: snapshotId,
            observed_at: observedAt,
            payload_ref: input.payload_ref,
          })).filter(Boolean)
        : [];
      updateScope(state, {
        scope_kind: "selection",
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: snapshotId,
        status: normalizeFreshnessStatus(input.freshness_status, "fresh"),
        coverage_status: normalizeCoverageStatus(input.coverage_status, "selected_only"),
        observed_at: observedAt,
        source_template_id: input.source_template_id ?? "template.project.create_observation_bundle",
        payload_ref: input.payload_ref,
      });
      state.coverage.selection = normalizeCoverageStatus(input.coverage_status, "selected_only");
      return lifecycleResult(state, "replace_selection", observedAt);
    },
    markScopeStale(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      updateScope(state, {
        scope_kind: input.scope_kind,
        scope_ref: input.scope_ref ?? "project",
        snapshot_id: input.snapshot_id ?? state.snapshot_id,
        status: "stale",
        coverage_status: input.coverage_status ?? "unknown",
        observed_at: observedAt,
        reason: input.reason ?? "scope_marked_stale",
      });
      return lifecycleResult(state, "mark_scope_stale", observedAt);
    },
    recordObjectChanges(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = input.snapshot_id ?? state.snapshot_id ?? normalizeSnapshotId(null, observedAt);
      const changes = Array.isArray(input.changes) ? input.changes : [];
      for (const change of changes) {
        const row = normalizeObjectChange(change, {
          snapshot_id: snapshotId,
          observed_at: observedAt,
          payload_ref: input.payload_ref,
        });
        if (row) upsertByKey(state.rows.object_changes, row, "change_id");
      }
      return lifecycleResult(state, "record_object_changes", observedAt);
    },
    recordBackgroundJob(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const row = normalizeBackgroundJob(input, {
        job_id: `job:project-index:${observedAt}`,
        job_kind: "task_scoped_refresh",
        status: "planned",
        started_at: observedAt,
        summary: {},
      });
      upsertByKey(state.rows.background_jobs, row, "job_id");
      return lifecycleResult(state, "record_background_job", observedAt);
    },
    completeBackgroundJob(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const jobId = typeof input.job_id === "string" && input.job_id
        ? input.job_id
        : `job:project-index:${observedAt}`;
      const existing = state.rows.background_jobs.find((entry) => entry.job_id === jobId);
      const existingSummary = isPlainObject(existing?.summary) ? existing.summary : {};
      const inputSummary = isPlainObject(input.summary) ? input.summary : {};
      const row = normalizeBackgroundJob({
        ...(isPlainObject(existing) ? existing : {}),
        ...input,
        job_id: jobId,
        status: "completed",
        started_at: input.started_at ?? existing?.started_at,
        completed_at: input.completed_at ?? observedAt,
        summary: {
          ...cloneJson(existingSummary),
          ...cloneJson(inputSummary),
        },
      }, {
        job_id: jobId,
        job_kind: "task_scoped_refresh",
        status: "completed",
        completed_at: observedAt,
        summary: {},
      });
      upsertByKey(state.rows.background_jobs, row, "job_id");
      return lifecycleResult(state, "complete_background_job", observedAt);
    },
    markWriteReadbackApplied(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      const snapshotId = input.snapshot_id ?? state.snapshot_id ?? normalizeSnapshotId(null, observedAt);
      const refs = normalizeRefs(input.refs);
      const changes = refs.map((ref, index) => ({
        change_id: input.change_id_prefix
          ? `${input.change_id_prefix}:${index}`
          : `change:${snapshotId}:${index}:${ref}`,
        snapshot_id: snapshotId,
        ref,
        owner_ref: typeof input.owner_ref === "string" ? input.owner_ref : null,
        change_kind: input.change_kind ?? "write_readback_applied",
        observed_at: observedAt,
        payload_ref: input.payload_ref ?? null,
        summary: {
          readback_status: input.readback_status ?? "passed",
          source: "reaper_readback",
        },
      }));
      for (const row of changes) upsertByKey(state.rows.object_changes, normalizeObjectChange(row, {}), "change_id");
      for (const scopeKind of inferAffectedScopeKinds(input, refs)) {
        const currentScope = state.freshness_scopes[scopeKind] ?? {};
        updateScope(state, {
          scope_kind: scopeKind,
          scope_ref: currentScope.scope_ref ?? "project",
          snapshot_id: snapshotId,
          status: "stale",
          coverage_status: currentScope.coverage_status ?? "unknown",
          observed_at: observedAt,
          source_template_id: input.source_template_id,
          reason: "write_readback_requires_refresh",
          payload_ref: input.payload_ref,
        });
      }
      return lifecycleResult(state, "mark_write_readback_applied", observedAt);
    },
    changedSince(input = {}) {
      return changedSinceSnapshot(state, input);
    },
    degrade(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      state.lifecycle = "degraded";
      state.degraded_reason = input.reason ?? "degraded";
      return lifecycleResult(state, "degrade", observedAt);
    },
    markStaleSession(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      state.lifecycle = "stale_session";
      state.degraded_reason = input.reason ?? "stale_session";
      for (const scope of Object.keys(state.freshness_scopes)) {
        state.freshness_scopes[scope] = {
          ...state.freshness_scopes[scope],
          status: "stale_session",
          reason: state.degraded_reason,
          observed_at: observedAt,
        };
      }
      return lifecycleResult(state, "mark_stale_session", observedAt);
    },
    close(input = {}) {
      const observedAt = safeInputIso(input.observed_at, now);
      state.lifecycle = "closed";
      return lifecycleResult(state, "close", observedAt);
    },
  });
}

export function planAlpha3C3ProjectIndexTaskRefresh(input = {}) {
  const scopes = normalizeRefreshScopes(input.scopes);
  const limit = normalizeLimit(input.limit, 100);
  const requests = [];
  for (const scope of scopes) {
    if (scope === "project_head" || scope === "selection") {
      requests.push({
        tool: "call_template",
        id: "template.project.create_observation_bundle",
        refs: {},
        input: {
          max_tracks: limit,
          max_items_per_track: 0,
          max_selected_items: 25,
          include_transport: true,
          include_track_items: false,
        },
        refresh_scope: scope,
      });
    }
    if (scope === "tracks") {
      requests.push({
        tool: "call_template",
        id: "template.project.create_project_map_snapshot",
        refs: {},
        input: {
          max_tracks: limit,
          max_items_per_track: 0,
          include_selected_items: true,
          include_track_items: false,
        },
        refresh_scope: "tracks",
      });
      requests.push({
        tool: "call_template",
        id: "template.tracks.list_tracks",
        refs: {},
        input: {
          limit,
          include_selection: true,
        },
        refresh_scope: "tracks",
      });
      requests.push({
        tool: "call_template",
        id: "template.tracks.read_mixer_controls",
        refs: {},
        input: {
          include_selected: true,
          limit,
        },
        refresh_scope: "tracks",
      });
    }
    if (scope === "items") {
      requests.push({
        tool: "call_template",
        id: "template.project.create_project_map_snapshot",
        refs: {},
        input: {
          max_tracks: limit,
          max_items_per_track: Math.min(limit, 100),
          include_selected_items: true,
          include_track_items: true,
        },
        refresh_scope: "items",
      });
      requests.push({
        tool: "call_template",
        id: "template.items.list_selected_items",
        refs: {},
        input: {
          limit,
          include_take_summary: false,
        },
        refresh_scope: "items",
      });
    }
    if (scope === "takes") {
      requests.push({
        tool: "call_template",
        id: "template.project.create_project_map_snapshot",
        refs: {},
        input: {
          max_tracks: limit,
          max_items_per_track: Math.min(limit, 100),
          include_selected_items: true,
          include_track_items: true,
        },
        refresh_scope: "takes",
      });
      requests.push({
        tool: "call_template",
        id: "template.items.list_selected_items",
        refs: {},
        input: {
          limit,
          include_track_refs: true,
        },
        refresh_scope: "takes",
      });
      requests.push({
        tool: "call_template",
        id: "template.items.read_item_summary",
        refs: {},
        input: {
          include_take_summary: true,
        },
        callable_now: false,
        depends_on: ["template.items.list_selected_items"],
        foreach_ref_from: {
          request_id: "template.items.list_selected_items",
          output_ref: "item_ref",
          bind_ref_as: "item_ref",
          max: limit,
        },
        refresh_scope: "takes",
      });
    }
    if (scope === "fx") {
      requests.push({
        tool: "call_template",
        id: "template.project.create_project_map_snapshot",
        refs: {},
        input: {
          max_tracks: limit,
          max_items_per_track: 0,
          include_selected_items: true,
          include_track_items: false,
        },
        refresh_scope: "fx",
      });
      requests.push({
        tool: "call_template",
        id: "template.tracks.read_mixer_controls",
        refs: {},
        input: {
          include_selected: true,
          limit,
        },
        refresh_scope: "fx",
      });
    }
    if (scope === "routing") {
      requests.push({
        tool: "call_template",
        id: "template.routing.read_project_routing_graph",
        refs: {},
        input: {
          max_tracks: limit,
          max_edges: Math.min(limit * 4, 400),
          include_master_parent: true,
        },
        refresh_scope: "routing",
      });
    }
    if (scope === "markers") {
      requests.push({
        tool: "call_template",
        id: "template.project.list_markers_regions",
        refs: {},
        input: {
          limit,
          include_markers: true,
          include_regions: true,
        },
        refresh_scope: "markers",
      });
    }
    if (scope === "media") {
      requests.push({
        tool: "call_template",
        id: "template.media.read_project_media_files",
        refs: {},
        input: {
          include_offline: true,
          include_metadata_keys: false,
          max_sources: limit,
        },
        refresh_scope: "media",
      });
    }
  }
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_REFRESH_PLAN_CONTRACT,
    mode: "task_scoped_refresh_plan",
    scopes,
    requests: dedupeRequests(requests),
    update_policy: {
      source_truth: "REAPER",
      apply_after_readback: true,
      stale_on_session_mismatch: true,
      sqlite_rows_are_candidates_only: true,
    },
    safety: projectIndexSafety(),
  });
}

export function projectIndexScopeIsFreshEnough(snapshot, scopeKind, require = "fresh_enough") {
  if (snapshot?.lifecycle === "stale_session" || snapshot?.lifecycle === "closed") return false;
  const scope = snapshot?.freshness_scopes?.[scopeKind];
  if (!scope) return false;
  if (require === "fresh") return scope.status === "fresh";
  return scope.status === "fresh" || scope.status === "fresh_enough";
}

function changedSinceSnapshot(state, input) {
  const limit = normalizeLimit(input.limit, 100);
  const offset = decodeCursor(input.cursor);
  const since = typeof input.since === "string" ? input.since : null;
  const rows = state.rows.object_changes
    .filter((row) => since === null || row.observed_at > since)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.change_id.localeCompare(b.change_id));
  const pageRows = rows.slice(offset, offset + limit);
  const nextOffset = offset + pageRows.length < rows.length ? offset + pageRows.length : null;
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_CHANGED_SINCE_CONTRACT,
    ok: true,
    since,
    refs: pageRows.map((row) => row.ref),
    rows: pageRows.map((row) => ({
      change_id: row.change_id,
      ref: row.ref,
      owner_ref: row.owner_ref,
      change_kind: row.change_kind,
      observed_at: row.observed_at,
      payload_ref: row.payload_ref,
      summary: cloneJson(row.summary),
    })),
    page: {
      limit,
      cursor: input.cursor ?? null,
      next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
      has_more: nextOffset !== null,
    },
    freshness: {
      source: "project_index_object_changes",
      sqlite_is_truth: false,
    },
  });
}

function snapshotState(state) {
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_CONTRACT,
    schema_version: state.schema_version,
    db_path: state.db_path,
    lifecycle: state.lifecycle,
    project_ref: state.project_ref,
    bridge_owner: state.bridge_owner,
    bridge_generation: state.bridge_generation,
    session_id: state.session_id,
    snapshot_id: state.snapshot_id,
    freshness_scopes: cloneJson(state.freshness_scopes),
    coverage: cloneJson(state.coverage),
    degraded_reason: state.degraded_reason,
    rows: {
      tracks: cloneJson(state.rows.tracks),
      items: cloneJson(state.rows.items),
      fx: cloneJson(state.rows.fx),
      takes: cloneJson(state.rows.takes),
      sends: cloneJson(state.rows.sends),
      markers_regions: cloneJson(state.rows.markers_regions),
      media_sources: cloneJson(state.rows.media_sources),
      selection_state: cloneJson(state.rows.selection_state),
      object_changes: cloneJson(state.rows.object_changes),
      background_jobs: cloneJson(state.rows.background_jobs),
    },
    safety: projectIndexSafety(),
  });
}

function updateScope(state, input) {
  const scopeKind = typeof input.scope_kind === "string" && input.scope_kind ? input.scope_kind : "project";
  const scopeRef = typeof input.scope_ref === "string" && input.scope_ref ? input.scope_ref : "project";
  const key = scopeKind === "project" ? scopeKind : scopeKind;
  state.freshness_scopes[key] = {
    scope_kind: scopeKind,
    scope_ref: scopeRef,
    snapshot_id: typeof input.snapshot_id === "string" ? input.snapshot_id : null,
    status: normalizeFreshnessStatus(input.status, "unknown"),
    coverage_status: normalizeCoverageStatus(input.coverage_status, "unknown"),
    observed_at: typeof input.observed_at === "string" ? input.observed_at : null,
    expires_at: typeof input.expires_at === "string" ? input.expires_at : null,
    source_template_id: typeof input.source_template_id === "string" ? input.source_template_id : null,
    reason: typeof input.reason === "string" ? input.reason : null,
    payload_ref: typeof input.payload_ref === "string" ? input.payload_ref : null,
  };
}

function normalizeTrackRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref: typeof source.ref === "string" ? source.ref : null,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    name: typeof source.name === "string" ? source.name : "",
    index: Number.isInteger(source.index)
      ? source.index
      : Number.isInteger(source.track_index)
        ? source.track_index
        : null,
    display_number: typeof source.display_number === "string" ? source.display_number : null,
    selected: Boolean(source.selected),
    muted: Boolean(source.muted),
    solo: Boolean(source.solo),
    record_arm: Boolean(source.record_arm ?? source.armed),
    folder_depth: Number.isInteger(source.folder_depth) ? source.folder_depth : 0,
    item_count: Number.isInteger(source.item_count) ? source.item_count : 0,
    fx_count: Number.isInteger(source.fx_count) ? source.fx_count : 0,
    send_count: Number.isInteger(source.send_count) ? source.send_count : 0,
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "complete"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeItemRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  const startSeconds = finiteNumber(source.start_seconds ?? source.start);
  const endSeconds = finiteNumber(source.end_seconds ?? source.end);
  const explicitLength = finiteNumber(source.length_seconds ?? source.length);
  const ownerRef = typeof source.owner_ref === "string" ? source.owner_ref : null;
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: ownerRef,
    track_ref: typeof source.track_ref === "string"
      ? source.track_ref
      : ownerRef !== null && ownerRef.startsWith("track:")
        ? ownerRef
        : null,
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    length_seconds: explicitLength ?? (
      startSeconds !== null && endSeconds !== null ? Math.max(0, endSeconds - startSeconds) : null
    ),
    selected: Boolean(source.selected),
    muted: Boolean(source.muted),
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "paged"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeTakeRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  const summary = isPlainObject(source.summary) ? cloneJson(source.summary) : {};
  const ownerRef = typeof source.owner_ref === "string"
    ? source.owner_ref
    : typeof source.item_ref === "string"
      ? source.item_ref
      : null;
  const itemRef = typeof source.item_ref === "string"
    ? source.item_ref
    : ownerRef !== null && ownerRef.startsWith("item:")
      ? ownerRef
      : typeof summary.item_ref === "string"
        ? summary.item_ref
        : null;
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: ownerRef,
    item_ref: itemRef,
    track_ref: typeof source.track_ref === "string"
      ? source.track_ref
      : typeof summary.track_ref === "string"
        ? summary.track_ref
        : null,
    active: Boolean(source.active ?? source.is_active ?? summary.active ?? summary.is_active),
    selected: Boolean(source.selected ?? summary.selected),
    source_kind: typeof source.source_kind === "string"
      ? source.source_kind
      : typeof summary.source_kind === "string"
        ? summary.source_kind
        : null,
    source_ref: typeof source.source_ref === "string"
      ? source.source_ref
      : typeof summary.source_ref === "string"
        ? summary.source_ref
        : null,
    pitch_semitones: finiteNumber(source.pitch_semitones ?? source.pitch ?? summary.pitch_semitones ?? summary.pitch),
    playrate: finiteNumber(source.playrate ?? source.play_rate ?? summary.playrate ?? summary.play_rate),
    reverse: Boolean(source.reverse ?? source.reversed ?? summary.reverse ?? summary.reversed),
    has_take_fx: Boolean(source.has_take_fx ?? summary.has_take_fx ?? summary.fx_count > 0),
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "paged"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary,
  };
}

function normalizeFxRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    plugin_name: typeof source.plugin_name === "string" ? source.plugin_name : "",
    plugin_id: typeof source.plugin_id === "string" ? source.plugin_id : null,
    slot_index: Number.isInteger(source.slot_index)
      ? source.slot_index
      : Number.isInteger(source.index)
        ? source.index
        : null,
    bypassed: Boolean(source.bypassed),
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "paged"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeSendRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  const summary = isPlainObject(source.summary) ? cloneJson(source.summary) : {};
  const sourceTrackRef = typeof source.source_track_ref === "string"
    ? source.source_track_ref
    : typeof summary.source_track_ref === "string"
      ? summary.source_track_ref
      : typeof source.owner_ref === "string" && source.owner_ref.startsWith("track:")
        ? source.owner_ref
        : null;
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : sourceTrackRef,
    source_track_ref: sourceTrackRef,
    destination_track_ref: typeof source.destination_track_ref === "string"
      ? source.destination_track_ref
      : typeof summary.destination_track_ref === "string"
        ? summary.destination_track_ref
        : null,
    send_index: Number.isInteger(source.send_index)
      ? source.send_index
      : Number.isInteger(source.index)
        ? source.index
        : Number.isInteger(summary.send_index)
          ? summary.send_index
          : null,
    send_kind: typeof source.send_kind === "string"
      ? source.send_kind
      : typeof summary.send_kind === "string"
        ? summary.send_kind
        : "track_send",
    muted: Boolean(source.muted ?? source.mute ?? summary.muted ?? summary.mute),
    volume_db: finiteNumber(source.volume_db ?? summary.volume_db),
    pan: finiteNumber(source.pan ?? summary.pan),
    send_mode: typeof source.send_mode === "string"
      ? source.send_mode
      : typeof source.mode === "string"
        ? source.mode
        : typeof summary.send_mode === "string"
          ? summary.send_mode
          : typeof summary.mode === "string"
            ? summary.mode
            : null,
    audio_channels: typeof source.audio_channels === "string"
      ? source.audio_channels
      : typeof summary.audio_channels === "string"
        ? summary.audio_channels
        : null,
    midi_channels: typeof source.midi_channels === "string"
      ? source.midi_channels
      : typeof summary.midi_channels === "string"
        ? summary.midi_channels
        : null,
    phase_inverted: Boolean(source.phase_inverted ?? summary.phase_inverted),
    mono: Boolean(source.mono ?? summary.mono),
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "paged"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary,
  };
}

function normalizeMarkerRegionRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref
    ? source.ref
    : typeof source.marker_ref === "string" && source.marker_ref
      ? source.marker_ref
      : typeof source.region_ref === "string" && source.region_ref
        ? source.region_ref
        : null;
  if (ref === null) return null;
  const summary = isPlainObject(source.summary) ? cloneJson(source.summary) : {};
  const positionSeconds = finiteNumber(source.position_seconds ?? source.position ?? summary.position_seconds ?? summary.position);
  const endSeconds = finiteNumber(source.end_seconds ?? source.end ?? summary.end_seconds ?? summary.end);
  const explicitLength = finiteNumber(source.length_seconds ?? source.length ?? summary.length_seconds ?? summary.length);
  const markerKind = typeof source.marker_kind === "string"
    ? source.marker_kind
    : typeof source.kind === "string"
      ? source.kind
      : refKind(ref);
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : "project:active",
    marker_kind: markerKind === "region" ? "region" : "marker",
    position_seconds: positionSeconds,
    end_seconds: endSeconds,
    length_seconds: explicitLength ?? (
      positionSeconds !== null && endSeconds !== null ? Math.max(0, endSeconds - positionSeconds) : null
    ),
    name: typeof source.name === "string"
      ? source.name
      : typeof summary.name === "string"
        ? summary.name
        : "",
    index: Number.isInteger(source.index)
      ? source.index
      : Number.isInteger(summary.index)
        ? summary.index
        : null,
    number: Number.isInteger(source.number)
      ? source.number
      : Number.isInteger(summary.number)
        ? summary.number
        : null,
    color: typeof source.color === "string"
      ? source.color
      : typeof summary.color === "string"
        ? summary.color
        : null,
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "complete"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary,
  };
}

function normalizeMediaSourceRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref
    ? source.ref
    : typeof source.file_ref === "string" && source.file_ref
      ? source.file_ref
      : typeof source.source_file_ref === "string" && source.source_file_ref
        ? source.source_file_ref
        : null;
  if (ref === null) return null;
  const summary = isPlainObject(source.summary) ? cloneJson(source.summary) : {};
  const name = typeof source.name === "string"
    ? source.name
    : typeof summary.name === "string"
      ? summary.name
      : mediaNameFromRef(ref);
  const sourceKind = typeof source.source_kind === "string"
    ? source.source_kind
    : typeof source.source_type === "string"
      ? source.source_type
      : typeof source.media_type === "string"
        ? source.media_type
        : typeof summary.source_kind === "string"
          ? summary.source_kind
          : typeof summary.source_type === "string"
            ? summary.source_type
            : typeof summary.media_type === "string"
              ? summary.media_type
              : null;
  const extension = typeof source.extension === "string"
    ? normalizeExtension(source.extension)
    : typeof summary.extension === "string"
      ? normalizeExtension(summary.extension)
      : extensionFromName(name);
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : "project:active",
    name,
    path_fingerprint: typeof source.path_fingerprint === "string" ? source.path_fingerprint : null,
    source_kind: sourceKind,
    media_type: typeof source.media_type === "string"
      ? source.media_type
      : typeof summary.media_type === "string"
        ? summary.media_type
        : mediaTypeFromExtension(extension),
    extension,
    offline: nullableBoolean(source.offline, summary.offline),
    length_seconds: finiteNumber(source.length_seconds ?? source.length ?? summary.length_seconds ?? summary.length),
    channel_count: Number.isInteger(source.channel_count)
      ? source.channel_count
      : Number.isInteger(summary.channel_count)
        ? summary.channel_count
        : null,
    metadata_key_count: Array.isArray(source.metadata_keys)
      ? source.metadata_keys.length
      : Array.isArray(summary.metadata_keys)
        ? summary.metadata_keys.length
        : Number.isInteger(source.metadata_key_count)
          ? source.metadata_key_count
          : Number.isInteger(summary.metadata_key_count)
            ? summary.metadata_key_count
            : null,
    freshness_status: normalizeFreshnessStatus(source.freshness_status, defaults.freshness_status ?? "fresh"),
    coverage_status: normalizeCoverageStatus(source.coverage_status, defaults.coverage_status ?? "paged"),
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary,
  };
}

function normalizeObjectChange(change, defaults) {
  const source = isPlainObject(change) ? change : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  const observedAt = typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at;
  const changeKind = typeof source.change_kind === "string" && source.change_kind ? source.change_kind : "changed";
  return {
    change_id: typeof source.change_id === "string" && source.change_id
      ? source.change_id
      : `change:${observedAt}:${ref}:${changeKind}`,
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id ?? null,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    change_kind: changeKind,
    observed_at: observedAt,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeBackgroundJob(job, defaults) {
  const source = isPlainObject(job) ? job : {};
  const summary = isPlainObject(source.summary)
    ? cloneJson(source.summary)
    : isPlainObject(defaults.summary)
      ? cloneJson(defaults.summary)
      : {};
  return {
    job_id: typeof source.job_id === "string" && source.job_id ? source.job_id : defaults.job_id,
    job_kind: typeof source.job_kind === "string" && source.job_kind ? source.job_kind : defaults.job_kind,
    status: BACKGROUND_JOB_STATUSES.includes(source.status) ? source.status : defaults.status,
    started_at: typeof source.started_at === "string" ? source.started_at : defaults.started_at ?? null,
    completed_at: typeof source.completed_at === "string" ? source.completed_at : defaults.completed_at ?? null,
    blocker: isPlainObject(source.blocker) ? cloneJson(source.blocker) : defaults.blocker ?? null,
    summary,
  };
}

function normalizeSelectionRow(row, defaults) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  return {
    snapshot_id: typeof source.snapshot_id === "string" ? source.snapshot_id : defaults.snapshot_id,
    scope_kind: typeof source.scope_kind === "string" && source.scope_kind
      ? source.scope_kind
      : refKind(ref),
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    observed_at: typeof source.observed_at === "string" ? source.observed_at : defaults.observed_at,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : defaults.payload_ref ?? null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function refKind(ref) {
  const lower = typeof ref === "string" ? ref.toLocaleLowerCase() : "";
  if (lower.startsWith("track:")) return "track";
  if (lower.startsWith("item:")) return "item";
  if (lower.startsWith("take:")) return "take";
  if (lower.startsWith("fx:")) return "fx";
  if (lower.startsWith("send:")) return "send";
  if (lower.startsWith("envelope:")) return "envelope";
  if (lower.startsWith("marker:")) return "marker";
  if (lower.startsWith("region:")) return "region";
  return "unknown";
}

function finiteNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function nullableBoolean(...values) {
  for (const value of values) {
    if (typeof value === "boolean") return value;
  }
  return null;
}

function mediaNameFromRef(ref) {
  const path = filePathFromRef(ref);
  if (path === null) return "";
  const parts = path.split(/[\\/]+/).filter(Boolean);
  return parts.at(-1) ?? "";
}

function extensionFromName(name) {
  if (typeof name !== "string") return null;
  const match = name.toLocaleLowerCase().match(/\.([a-z0-9]+)$/);
  return match ? match[1] : null;
}

function normalizeExtension(value) {
  return value.trim().replace(/^\./, "").toLocaleLowerCase();
}

function mediaTypeFromExtension(extension) {
  if (extension === null) return null;
  if (["wav", "wave", "aif", "aiff", "flac", "mp3", "ogg", "m4a"].includes(extension)) return "audio";
  if (["mid", "midi"].includes(extension)) return "midi";
  if (["mov", "mp4", "mkv", "avi"].includes(extension)) return "video";
  return "unknown";
}

function filePathFromRef(ref) {
  if (typeof ref !== "string") return null;
  const prefix = "file:path:";
  if (!ref.toLocaleLowerCase().startsWith(prefix)) return null;
  return ref.slice(prefix.length);
}

function mergeSessionMetadata(state, metadata) {
  if (typeof metadata.project_ref === "string") state.project_ref = metadata.project_ref;
  if (typeof metadata.projectRef === "string") state.project_ref = metadata.projectRef;
  if (typeof metadata.bridge_owner === "string") state.bridge_owner = metadata.bridge_owner;
  if (typeof metadata.bridgeOwner === "string") state.bridge_owner = metadata.bridgeOwner;
  if (Number.isInteger(metadata.bridge_generation)) state.bridge_generation = metadata.bridge_generation;
  if (Number.isInteger(metadata.bridgeGeneration)) state.bridge_generation = metadata.bridgeGeneration;
  if (typeof metadata.session_id === "string") state.session_id = metadata.session_id;
  if (typeof metadata.sessionId === "string") state.session_id = metadata.sessionId;
}

function lifecycleResult(state, operation, observedAt) {
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_LIFECYCLE_CONTRACT,
    ok: true,
    operation,
    lifecycle: state.lifecycle,
    schema_version: state.schema_version,
    db_path: state.db_path,
    snapshot_id: state.snapshot_id,
    observed_at: observedAt,
    safety: projectIndexSafety(),
  });
}

function normalizeRefreshScopes(scopes) {
  const raw = Array.isArray(scopes) ? scopes : ["project_head", "tracks"];
  const allowed = new Set(["project_head", "selection", "tracks", "items", "takes", "fx", "routing", "markers", "media"]);
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || !allowed.has(entry) || result.includes(entry)) continue;
    result.push(entry);
  }
  return result.length > 0 ? result : ["project_head"];
}

function inferAffectedScopeKinds(input, refs) {
  const explicit = normalizeScopeKinds(input.affected_scopes ?? input.scope_kinds ?? input.scope_kind);
  if (explicit.length > 0) return explicit;

  const candidates = [
    ...refs,
    typeof input.owner_ref === "string" ? input.owner_ref : null,
    typeof input.change_kind === "string" ? input.change_kind : null,
  ].filter(Boolean);
  const lowered = candidates.map((candidate) => candidate.toLocaleLowerCase());
  const inferred = [];
  const add = (scopeKind) => {
    if (!inferred.includes(scopeKind)) inferred.push(scopeKind);
  };
  if (lowered.some((candidate) => candidate.includes("selection") || candidate.includes("selected") || candidate.includes("select_"))) add("selection");
  if (lowered.some((candidate) => candidate.startsWith("track:") || candidate.includes("track_"))) add("tracks");
  if (lowered.some((candidate) => candidate.startsWith("item:") || candidate.includes("item_"))) add("items");
  if (lowered.some((candidate) => candidate.startsWith("take:") || candidate.includes("take_"))) add("takes");
  if (lowered.some((candidate) => candidate.startsWith("fx:") || candidate.includes("fx_") || candidate.includes("plugin"))) add("fx");
  if (lowered.some((candidate) => candidate.startsWith("send:") || candidate.includes("send_") || candidate.includes("routing"))) add("routing");
  if (lowered.some((candidate) => candidate.startsWith("marker:") || candidate.startsWith("region:") || candidate.includes("marker") || candidate.includes("region"))) add("markers");
  if (lowered.some((candidate) => candidate.includes("automation") || candidate.includes("envelope"))) add("automation");
  if (lowered.some((candidate) => candidate.includes("media"))) add("media");
  return inferred.length > 0 ? inferred : ["project_head"];
}

function normalizeScopeKinds(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  const allowed = new Set([
    "project_head",
    "selection",
    "tracks",
    "items",
    "takes",
    "fx",
    "routing",
    "automation",
    "markers",
    "media",
  ]);
  const result = [];
  for (const entry of raw) {
    if (typeof entry !== "string") continue;
    const scopeKind = entry.trim();
    if (!allowed.has(scopeKind) || result.includes(scopeKind)) continue;
    result.push(scopeKind);
  }
  return result;
}

function dedupeRequests(requests) {
  const seen = new Set();
  const result = [];
  for (const request of requests) {
    const key = JSON.stringify([request.id, request.refs, request.input]);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(request);
  }
  return result;
}

function projectIndexTruthBoundary() {
  return deepFreeze({
    project_truth: "REAPER",
    index_role: "local_query_navigation_cache",
    capability_truth: "runtime_catalog_not_sqlite",
    artifact_role: "evidence_payload_and_readback_proof",
  });
}

function projectIndexSafety() {
  return deepFreeze({
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_sql_exposed: false,
    raw_lua_action_shell_or_ui: false,
    live_reaper: false,
    direct_reaper_write: false,
    sqlite_is_truth: false,
    sqlite_may_authorize_write: false,
    project_truth: "REAPER",
  });
}

function sqliteLifecycleResult({
  ok,
  lifecycle,
  dbPath,
  observedAt,
  migrationIds,
  schemaSummary = null,
  blockers = [],
}) {
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_SQLITE_LIFECYCLE_CONTRACT,
    ok,
    lifecycle,
    backend: "sqlite_file",
    db_path: dbPath,
    schema_version: ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION,
    migrations: {
      applied: ok ? migrationIds : [],
      planned: migrationIds,
    },
    schema_summary: schemaSummary,
    blockers,
    observed_at: observedAt,
    truth_boundary: projectIndexTruthBoundary(),
    safety: projectIndexSafety(),
  });
}

function validateSqliteSchema(database) {
  const blockers = [];
  for (const [table, columns] of Object.entries(expectedSqliteColumns())) {
    let rows = [];
    try {
      rows = database.prepare(`PRAGMA table_info(${table})`).all();
    } catch (error) {
      blockers.push({
        code: "SQLITE_SCHEMA_MISMATCH",
        table,
        message: `Project SQLite Index table ${table} could not be inspected; falling back to degraded mode.`,
        detail: String(error?.message ?? error),
      });
      continue;
    }
    const actual = new Set(rows.map((row) => row.name).filter(Boolean));
    const missing = columns.filter((column) => !actual.has(column));
    if (missing.length > 0) {
      blockers.push({
        code: "SQLITE_SCHEMA_MISMATCH",
        table,
        missing_columns: missing,
        message: `Project SQLite Index table ${table} does not match schema v${ALPHA3_C3_PROJECT_INDEX_SCHEMA_VERSION}; falling back to degraded mode.`,
      });
    }
  }
  return blockers;
}

function expectedSqliteColumns() {
  const result = {};
  for (const statement of SQLITE_DDL_V1) {
    const tableMatch = statement.match(/CREATE TABLE IF NOT EXISTS\s+([a-z_]+)/i);
    const open = statement.indexOf("(");
    const close = statement.lastIndexOf(")");
    if (!tableMatch || open === -1 || close === -1 || close <= open) continue;
    const columns = statement
      .slice(open + 1, close)
      .split("\n")
      .map((line) => line.trim().replace(/,$/, ""))
      .filter((line) => line && !/^(PRIMARY|FOREIGN|UNIQUE|CHECK|CONSTRAINT)\b/i.test(line))
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);
    result[tableMatch[1]] = columns;
  }
  return result;
}

function normalizeFreshnessStatus(value, fallback) {
  return ALPHA3_C3_PROJECT_INDEX_FRESHNESS_STATUSES.includes(value) ? value : fallback;
}

function normalizeCoverageStatus(value, fallback) {
  return ALPHA3_C3_PROJECT_INDEX_COVERAGE_STATUSES.includes(value) ? value : fallback;
}

function normalizeRefs(value) {
  const raw = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
  return raw.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

function normalizeLimit(value, fallback) {
  if (!Number.isInteger(value) || value < 1) return fallback;
  return Math.min(value, 500);
}

function normalizeSnapshotId(value, observedAt) {
  return typeof value === "string" && value
    ? value
    : `snapshot:project_index:${observedAt}`;
}

function safeInputIso(value, now) {
  if (typeof value === "string") return value;
  return safeNowIso(now);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  if (cursor === undefined || cursor === null) return 0;
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded?.v === 1 && Number.isInteger(decoded.offset) && decoded.offset >= 0) return decoded.offset;
  } catch {
    // Invalid cursors restart at the first page for this internal helper.
  }
  return 0;
}

function upsertByKey(rows, row, key) {
  const index = rows.findIndex((entry) => entry[key] === row[key]);
  if (index === -1) rows.push(row);
  else rows[index] = row;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function parseJsonObject(value) {
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(value);
    return isPlainObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
