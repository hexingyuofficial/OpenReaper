import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";

export const ALPHA3_C3_PROJECT_INDEX_CONTRACT = "alpha3.c3.project_sqlite_index.v1";
export const ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT = "alpha3.c3.project_index_query_macros.v1";
export const ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT = "alpha3.c3.project_index_schema.v1";

export const ALPHA3_C3_PROJECT_INDEX_DB_PATH = "run_root/state/openreaper-project-index.sqlite";

export const ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
  mode: "plan_only_project_index_query_macros",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "query",
  action_kind: "macro",
  execution_shape: "project_index_query_plan",
  storage: {
    kind: "project_sqlite_index",
    default_path: ALPHA3_C3_PROJECT_INDEX_DB_PATH,
    truth_source: "REAPER_project_state",
    cache_role: "query_navigation_freshness_cache",
  },
  macro_ids: [
    "macro.index_status",
    "macro.query_tracks",
    "macro.query_items",
    "macro.query_takes",
    "macro.query_fx",
    "macro.query_routing",
    "macro.query_automation",
    "macro.query_markers",
    "macro.query_media",
    "macro.hydrate_refs",
    "macro.changed_since",
  ],
  implemented_macro_ids: [
    "macro.index_status",
    "macro.query_tracks",
  ],
  rule: "SQLite is a task-scoped project index/cache. REAPER remains truth; writes must re-resolve in REAPER and update the index only after readback.",
});

const PROJECT_INDEX_TABLES = deepFreeze([
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

const FRESHNESS_STATUSES = deepFreeze([
  "fresh",
  "fresh_enough",
  "stale",
  "unknown",
  "detail_not_loaded",
  "detail_stale",
  "refresh_failed",
  "stale_session",
]);

const COVERAGE_STATUSES = deepFreeze([
  "complete",
  "partial",
  "head_only",
  "selected_only",
  "paged",
  "truncated",
  "unknown",
  "failed",
]);

const DB_LIFECYCLE_STATES = deepFreeze([
  "missing",
  "opening",
  "ready",
  "degraded",
  "rebuilding",
  "stale_session",
  "closed",
]);

const REQUIRED_REFRESH_TEMPLATE_IDS = Object.freeze([
  "template.project.create_project_map_snapshot",
  "template.project.create_observation_bundle",
  "template.tracks.list_tracks",
  "template.tracks.read_mixer_controls",
]);

const QUERY_DETAIL_VALUES = new Set(["summary", "refs", "compact", "hydrated"]);
const FRESHNESS_REQUIRE_VALUES = new Set(["fresh", "fresh_enough"]);
const REFRESH_POLICY_VALUES = new Set(["task_scoped", "none", "if_stale"]);
const RAW_SQL_INPUT_FIELDS = new Set([
  "sql",
  "raw_sql",
  "statement",
  "select",
  "from",
  "where",
  "join",
  "order_by",
  "group_by",
]);

const TRACK_ROW_FIELDS = deepFreeze([
  "ref",
  "name",
  "index",
  "display_number",
  "selected",
  "muted",
  "solo",
  "record_arm",
  "folder_depth",
  "item_count",
  "fx_count",
  "send_count",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
]);

const QUERY_MACRO_DEFINITIONS = deepFreeze([
  queryMacro({
    id: "macro.index_status",
    user_label: "Index status",
    summary: "Read Project SQLite Index health, freshness, coverage, and recommended refresh steps.",
    status: "implemented",
    query_kind: "index_status",
    task_intents: ["index status", "project index health", "stale session", "refresh project index"],
    tags: ["project_index", "sqlite", "status", "freshness", "coverage", "alpha3_c3"],
    required_templates: [
      "template.project.create_observation_bundle",
      "template.project.create_project_map_snapshot",
    ],
  }),
  queryMacro({
    id: "macro.query_tracks",
    user_label: "Query tracks",
    summary: "Query compact track rows from the Project SQLite Index after task-scoped freshness is satisfied.",
    status: "implemented",
    query_kind: "tracks",
    task_intents: ["find tracks", "selected tracks", "tracks with fx", "large project track query"],
    tags: ["project_index", "sqlite", "query", "tracks", "freshness", "alpha3_c3"],
    required_templates: [
      "template.project.create_project_map_snapshot",
      "template.tracks.list_tracks",
      "template.tracks.read_mixer_controls",
    ],
  }),
  queryMacro({ id: "macro.query_items", user_label: "Query items", query_kind: "items" }),
  queryMacro({ id: "macro.query_takes", user_label: "Query takes", query_kind: "takes" }),
  queryMacro({ id: "macro.query_fx", user_label: "Query FX", query_kind: "fx" }),
  queryMacro({ id: "macro.query_routing", user_label: "Query routing", query_kind: "routing" }),
  queryMacro({ id: "macro.query_automation", user_label: "Query automation", query_kind: "automation" }),
  queryMacro({ id: "macro.query_markers", user_label: "Query markers", query_kind: "markers" }),
  queryMacro({ id: "macro.query_media", user_label: "Query media", query_kind: "media" }),
  queryMacro({ id: "macro.hydrate_refs", user_label: "Hydrate refs", query_kind: "hydrate_refs" }),
  queryMacro({ id: "macro.changed_since", user_label: "Changed since", query_kind: "changed_since" }),
]);

export function listAlpha3C3ProjectIndexQueryMacros(options = {}) {
  const catalog = options.catalog ?? createAlpha3C3AcceptedCatalog();
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
    mode: "plan_only_project_index_query_macros",
    tool_surface: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.tool_surface,
    schema: createAlpha3C3ProjectIndexSchemaContract(),
    freshness_model: projectIndexFreshnessModel(),
    write_safety_loop: projectIndexWriteSafetyLoop(),
    macros: QUERY_MACRO_DEFINITIONS.map((definition) => annotateQueryMacro(definition, catalog)),
  });
}

export function createAlpha3C3OfficialQueryMacroDiscoveryItems(options = {}) {
  return listAlpha3C3ProjectIndexQueryMacros(options).macros.map((macro) =>
    officialQueryMacroDiscoveryItem(macro)
  );
}

export function getAlpha3C3ProjectIndexQueryMacro(id, options = {}) {
  const catalog = options.catalog ?? createAlpha3C3AcceptedCatalog();
  const definition = QUERY_MACRO_DEFINITIONS.find((macro) => macro.id === id);
  if (!definition) return null;
  return annotateQueryMacro(definition, catalog);
}

export function isAlpha3C3OfficialQueryMacroId(id) {
  return typeof id === "string" && QUERY_MACRO_DEFINITIONS.some((macro) => macro.id === id);
}

export function createAlpha3C3ProjectIndexSchemaContract() {
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT,
    schema_version: 1,
    db_path: ALPHA3_C3_PROJECT_INDEX_DB_PATH,
    tables: PROJECT_INDEX_TABLES,
    object_row_required_fields: [
      "snapshot_id",
      "ref",
      "owner_ref",
      "summary",
      "observed_at",
      "freshness_status",
      "coverage_status",
      "payload_ref",
    ],
    truth_boundary: {
      project_truth: "REAPER",
      index_role: "local_query_navigation_cache",
      capability_truth: "runtime_catalog_not_sqlite",
    },
  });
}

export function planAlpha3C3ProjectIndexQueryMacro(id, request = {}, options = {}) {
  const macro = getAlpha3C3ProjectIndexQueryMacro(id, options);
  if (!macro) {
    return blockedPlan(id, [blocker("macro", "MACRO_UNKNOWN", "Project index query macro is not registered.")]);
  }

  const normalized = normalizeQueryInput(request);
  const indexState = readProjectIndexState(options.projectIndex);
  const coverageBlockers = macro.coverage.missing_templates.map((templateId) =>
    blocker("template", "MISSING_ACCEPTED_TEMPLATE", `Required refresh template ${templateId} is not accepted.`)
  );
  const blockers = [
    ...normalized.blockers,
    ...coverageBlockers,
  ];

  if (macro.status !== "implemented") {
    blockers.push(blocker("macro", "MACRO_PLANNED", `${macro.id} is planned but not implemented in C3.1.`));
  }

  if (macro.id === "macro.index_status") {
    return indexStatusPlan({ macro, normalized, indexState, blockers });
  }
  if (macro.id === "macro.query_tracks") {
    return queryTracksPlan({ macro, normalized, indexState, blockers });
  }

  return blockedPlan(macro.id, blockers);
}

export function createAlpha3C3ProjectIndexQueryRuntimeEnvelope({
  request = {},
  plan,
  projectIndex,
  now = () => new Date(),
} = {}) {
  const normalizedPlan = plan ?? planAlpha3C3ProjectIndexQueryMacro(request.id, {
    ...cloneJson(request.input ?? {}),
    refs: cloneJson(request.refs ?? {}),
  }, { projectIndex });
  const macro = getAlpha3C3ProjectIndexQueryMacro(normalizedPlan.id) ?? null;
  const completedAt = safeNowIso(now);
  const envelope = {
    contract: "template.execution.v1",
    ok: Boolean(normalizedPlan.ok),
    template: {
      id: normalizedPlan.id,
      pack: "macro",
      risk: "read",
      action_kind: "macro",
    },
    request: {
      id: null,
      client: {
        id: "openreaper-mcp",
      },
      macro: {
        id: normalizedPlan.id,
        contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
        mode: "plan_only_project_index_query_macro",
      },
      input: cloneJson(request.input ?? {}),
      refs: cloneJson(request.refs ?? {}),
    },
    completed_at: completedAt,
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
      action_kind: "macro",
      mode: "plan_only_project_index_query_macro",
      execution_shape: "project_index_query_plan",
      macro: macro === null
        ? null
        : {
            id: macro.id,
            user_label: macro.user_label,
            menu_group: macro.menu_group,
            query_kind: macro.query_kind,
            coverage: macro.coverage,
          },
      plan: normalizedPlan,
      execution: {
        executed: false,
        reason: "C3.1 binds Project SQLite Index query planning and macro discovery only; refresh and hydration remain agent-executed through existing call_template/get_state requests.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_execution: false,
        alias_execution: false,
        live_reaper: false,
      },
      decision_summary: normalizedPlan.decision_summary,
      refs: normalizedPlan.refs,
      rows: normalizedPlan.rows,
      freshness: normalizedPlan.freshness,
      coverage: normalizedPlan.coverage,
      page: normalizedPlan.page,
      refresh_requests: normalizedPlan.refresh_requests,
      hydrate_request: normalizedPlan.hydrate_request,
      blockers: normalizedPlan.blockers,
    },
    budget: {
      max_response_bytes: 65_536,
      response_bytes: 0,
      truncated: false,
    },
  };
  envelope.budget.response_bytes = byteLength(envelope);
  return deepFreeze(envelope);
}

function indexStatusPlan({ macro, normalized, indexState, blockers }) {
  const status = summarizeIndexStatus(indexState);
  const refreshRequests = status.lifecycle === "stale_session"
    ? []
    : indexStatusRefreshRequests(normalized.query);
  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: blockers.length === 0,
    decision_summary: indexStatusDecisionSummary(status),
    rows: [],
    refs: [],
    freshness: {
      status: status.lifecycle === "ready" ? "fresh_enough" : "unknown",
      scopes: status.freshness_scopes,
    },
    coverage: status.coverage,
    page: pageEnvelope(normalized.query.limit),
    refresh_requests: refreshRequests,
    hydrate_request: null,
    blockers,
    index_status: status,
  }));
}

function queryTracksPlan({ macro, normalized, indexState, blockers }) {
  const trackScope = freshnessScope(indexState, "tracks");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, trackScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateTrackFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryTrackRows(indexState.rows.tracks, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshRequests = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? queryTrackRefreshRequests(normalized.query)
    : [];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: allBlockers.length === 0,
    decision_summary: queryTracksDecisionSummary({ blockers: allBlockers, rows, trackScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "tracks",
      status: trackScope.status,
      coverage_status: trackScope.coverage_status,
      observed_at: trackScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: trackScope.coverage_status,
      source_scope: "tracks",
      row_count: rows.rows.length,
      complete: trackScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshRequests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsRequest(rows.refs, normalized.query.fields)
      : null,
    blockers: allBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function basePlan({
  macro,
  normalized,
  indexState,
  ok,
  decision_summary,
  rows,
  refs,
  freshness,
  coverage,
  page,
  refresh_requests,
  hydrate_request,
  blockers,
  index_status,
}) {
  return {
    contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
    ok,
    id: macro.id,
    mode: "plan_only_project_index_query_macro",
    action_kind: "macro",
    menu_group: "query",
    execution_shape: "project_index_query_plan",
    query_kind: macro.query_kind,
    storage: {
      kind: "project_sqlite_index",
      db_path: indexState.db_path,
      truth_source: "REAPER_project_state",
      index_role: "local_query_navigation_cache",
    },
    input: normalized.query,
    decision_summary,
    refs,
    rows,
    freshness,
    coverage,
    page,
    artifact_ref: null,
    refresh_requests,
    hydrate_request,
    query_policy: {
      default_output: "decision_summary + canonical refs + freshness + coverage + compact rows",
      deep_detail_requires: ["fields", "detail", "time_range", "hydrate_refs"],
      raw_sql_exposed: false,
      sqlite_authorizes_writes: false,
    },
    write_safety_loop: projectIndexWriteSafetyLoop(),
    safety: projectIndexSafety(),
    index_status,
    blockers: uniqueBlockers(blockers),
  };
}

function normalizeQueryInput(request) {
  const source = isPlainObject(request) ? request : {};
  const blockers = [];
  for (const key of Object.keys(source)) {
    if (RAW_SQL_INPUT_FIELDS.has(key.toLowerCase())) {
      blockers.push(blocker(key, "RAW_SQL_NOT_ALLOWED", "Project index query macros do not accept raw SQL or SQL-shaped fields."));
    }
  }

  const limit = normalizeLimit(source.limit, blockers);
  const cursor = normalizeCursor(source.cursor, blockers);
  const fields = normalizeFields(source.fields, blockers);
  const detail = normalizeDetail(source.detail, blockers);
  const freshness = normalizeFreshness(source.freshness, blockers);

  return {
    blockers,
    query: {
      scope: typeof source.scope === "string" && source.scope.trim() ? source.scope : "project",
      refs: normalizeRefs(source.refs),
      filters: normalizeFilters(source.filters, blockers),
      fields,
      detail,
      time_range: source.time_range ?? null,
      limit,
      cursor,
      freshness,
    },
  };
}

function normalizeFilters(value, blockers) {
  if (!isPlainObject(value)) return {};
  const filters = {};
  for (const [key, entry] of Object.entries(value)) {
    if (RAW_SQL_INPUT_FIELDS.has(key.toLowerCase())) {
      blockers.push(blocker(`filters.${key}`, "RAW_SQL_NOT_ALLOWED", "Project index query filters do not accept raw SQL or SQL-shaped fields."));
      continue;
    }
    filters[key] = cloneJson(entry);
  }
  return filters;
}

function normalizeLimit(value, blockers) {
  if (value === undefined) return 25;
  if (!Number.isInteger(value) || value < 1) {
    blockers.push(blocker("limit", "QUERY_LIMIT_INVALID", "limit must be a positive integer."));
    return 25;
  }
  return Math.min(value, 100);
}

function normalizeCursor(value, blockers) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    blockers.push(blocker("cursor", "QUERY_CURSOR_INVALID", "cursor must be a non-empty opaque string."));
    return null;
  }
  try {
    decodeCursor(value);
    return value;
  } catch {
    blockers.push(blocker("cursor", "QUERY_CURSOR_INVALID", "cursor is not a valid project index cursor."));
    return null;
  }
}

function normalizeFields(value, blockers) {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  const fields = [];
  for (const entry of raw) {
    if (typeof entry !== "string" || entry.trim() === "") {
      blockers.push(blocker("fields", "QUERY_FIELDS_INVALID", "fields must contain non-empty strings."));
      continue;
    }
    fields.push(entry.trim());
  }
  return unique(fields);
}

function normalizeDetail(value, blockers) {
  if (value === undefined) return "summary";
  if (typeof value !== "string" || !QUERY_DETAIL_VALUES.has(value)) {
    blockers.push(blocker("detail", "QUERY_DETAIL_UNSUPPORTED", "detail must be summary, refs, compact, or hydrated."));
    return "summary";
  }
  return value;
}

function normalizeFreshness(value, blockers) {
  const source = isPlainObject(value) ? value : {};
  const require = source.require ?? "fresh_enough";
  const refresh = source.refresh ?? "task_scoped";
  if (!FRESHNESS_REQUIRE_VALUES.has(require)) {
    blockers.push(blocker("freshness.require", "FRESHNESS_REQUIRE_UNSUPPORTED", "freshness.require must be fresh or fresh_enough."));
  }
  if (!REFRESH_POLICY_VALUES.has(refresh)) {
    blockers.push(blocker("freshness.refresh", "FRESHNESS_REFRESH_UNSUPPORTED", "freshness.refresh must be task_scoped, if_stale, or none."));
  }
  return {
    require: FRESHNESS_REQUIRE_VALUES.has(require) ? require : "fresh_enough",
    refresh: REFRESH_POLICY_VALUES.has(refresh) ? refresh : "task_scoped",
  };
}

function normalizeRefs(value) {
  if (!Array.isArray(value)) return [];
  return value.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim());
}

function readProjectIndexState(projectIndex) {
  const raw = typeof projectIndex?.snapshot === "function"
    ? projectIndex.snapshot()
    : isPlainObject(projectIndex)
      ? projectIndex
      : {};
  const lifecycle = DB_LIFECYCLE_STATES.includes(raw.lifecycle) ? raw.lifecycle : "missing";
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_CONTRACT,
    schema_version: Number.isInteger(raw.schema_version) ? raw.schema_version : 1,
    db_path: typeof raw.db_path === "string" ? raw.db_path : ALPHA3_C3_PROJECT_INDEX_DB_PATH,
    lifecycle,
    project_ref: typeof raw.project_ref === "string" ? raw.project_ref : null,
    bridge_owner: typeof raw.bridge_owner === "string" ? raw.bridge_owner : null,
    bridge_generation: Number.isInteger(raw.bridge_generation) ? raw.bridge_generation : null,
    session_id: typeof raw.session_id === "string" ? raw.session_id : null,
    snapshot_id: typeof raw.snapshot_id === "string" ? raw.snapshot_id : null,
    freshness_scopes: normalizeFreshnessScopes(raw.freshness_scopes),
    coverage: isPlainObject(raw.coverage) ? cloneJson(raw.coverage) : {},
    degraded_reason: typeof raw.degraded_reason === "string" ? raw.degraded_reason : null,
    rows: {
      tracks: Array.isArray(raw.rows?.tracks) ? raw.rows.tracks.map(normalizeTrackRow) : [],
    },
  });
}

function normalizeFreshnessScopes(scopes) {
  if (!isPlainObject(scopes)) return {};
  const result = {};
  for (const [key, value] of Object.entries(scopes)) {
    if (!isPlainObject(value)) continue;
    result[key] = {
      scope_kind: typeof value.scope_kind === "string" ? value.scope_kind : key,
      scope_ref: typeof value.scope_ref === "string" ? value.scope_ref : "project",
      snapshot_id: typeof value.snapshot_id === "string" ? value.snapshot_id : null,
      status: FRESHNESS_STATUSES.includes(value.status) ? value.status : "unknown",
      coverage_status: COVERAGE_STATUSES.includes(value.coverage_status) ? value.coverage_status : "unknown",
      observed_at: typeof value.observed_at === "string" ? value.observed_at : null,
      expires_at: typeof value.expires_at === "string" ? value.expires_at : null,
      source_template_id: typeof value.source_template_id === "string" ? value.source_template_id : null,
      reason: typeof value.reason === "string" ? value.reason : null,
    };
  }
  return result;
}

function normalizeTrackRow(row) {
  const source = isPlainObject(row) ? row : {};
  return {
    ref: typeof source.ref === "string" ? source.ref : null,
    name: typeof source.name === "string" ? source.name : "",
    index: Number.isInteger(source.index) ? source.index : null,
    display_number: typeof source.display_number === "string" ? source.display_number : null,
    selected: Boolean(source.selected),
    muted: Boolean(source.muted),
    solo: Boolean(source.solo),
    record_arm: Boolean(source.record_arm ?? source.armed),
    folder_depth: Number.isInteger(source.folder_depth) ? source.folder_depth : 0,
    item_count: Number.isInteger(source.item_count) ? source.item_count : 0,
    fx_count: Number.isInteger(source.fx_count) ? source.fx_count : 0,
    send_count: Number.isInteger(source.send_count) ? source.send_count : 0,
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
  };
}

function freshnessScope(indexState, scopeKind) {
  return indexState.freshness_scopes[scopeKind] ?? {
    scope_kind: scopeKind,
    scope_ref: "project",
    snapshot_id: indexState.snapshot_id,
    status: "unknown",
    coverage_status: "unknown",
    observed_at: null,
    expires_at: null,
    source_template_id: null,
    reason: "scope_not_loaded",
  };
}

function queryReadinessBlockers(indexState, scope, freshness) {
  if (indexState.lifecycle === "stale_session") {
    return [blocker("index", "INDEX_STALE_SESSION", "Project index belongs to a stale bridge/session; reconnect or rebuild before using rows.")];
  }
  if (indexState.lifecycle !== "ready" && indexState.lifecycle !== "degraded") {
    return [blocker("index", "INDEX_NOT_READY", "Project index is not ready; run the planned task-scoped refresh first.")];
  }
  if (!freshnessStatusSatisfies(scope.status, freshness.require)) {
    return [blocker("freshness", "INDEX_REFRESH_REQUIRED", "Requested scope is not fresh enough; run the planned refresh before using index rows.")];
  }
  return [];
}

function freshnessStatusSatisfies(status, require) {
  if (require === "fresh") return status === "fresh";
  return status === "fresh" || status === "fresh_enough";
}

function queryTrackRows(trackRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = trackRows
    .filter((row) => row.ref)
    .filter((row) => trackRowMatches(row, query.filters));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectTrackRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function trackRowMatches(row, filters) {
  if (!isPlainObject(filters)) return true;
  if (typeof filters.name === "string" && !row.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase())) return false;
  if (filters.selected !== undefined && Boolean(filters.selected) !== row.selected) return false;
  if (filters.armed !== undefined && Boolean(filters.armed) !== row.record_arm) return false;
  if (filters.mute !== undefined && Boolean(filters.mute) !== row.muted) return false;
  if (filters.solo !== undefined && Boolean(filters.solo) !== row.solo) return false;
  if (filters.has_items !== undefined && Boolean(filters.has_items) !== (row.item_count > 0)) return false;
  if (filters.has_fx !== undefined && Boolean(filters.has_fx) !== (row.fx_count > 0)) return false;
  if (filters.has_sends !== undefined && Boolean(filters.has_sends) !== (row.send_count > 0)) return false;
  return true;
}

function projectTrackRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "name",
    "index",
    "selected",
    "muted",
    "solo",
    "record_arm",
    "item_count",
    "fx_count",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (TRACK_ROW_FIELDS.includes(field)) projected[field] = row[field];
  }
  return projected;
}

function validateTrackFields(fields) {
  return fields
    .filter((field) => !TRACK_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_tracks does not expose field ${field}.`));
}

function indexStatusRefreshRequests(query) {
  return [
    {
      tool: "call_template",
      id: "template.project.create_observation_bundle",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: 0,
        max_selected_items: 25,
        include_transport: true,
        include_track_items: false,
      },
      purpose: "Refresh project head, selection, transport, marker, tempo, and compact track scopes before indexing.",
    },
    {
      tool: "call_template",
      id: "template.project.create_project_map_snapshot",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: 0,
        include_selected_items: true,
        include_track_items: false,
      },
      purpose: "Refresh a paged project map snapshot and store artifact-backed compact rows.",
    },
  ];
}

function queryTrackRefreshRequests(query) {
  return [
    {
      tool: "call_template",
      id: "template.project.create_project_map_snapshot",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: 0,
        include_selected_items: true,
        include_track_items: false,
      },
      purpose: "Refresh project map track rows before using the Project SQLite Index.",
    },
    {
      tool: "call_template",
      id: "template.tracks.list_tracks",
      refs: {},
      input: {
        limit: query.limit,
        include_selection: true,
      },
      purpose: "Resolve canonical track refs and selection state from REAPER truth.",
    },
    {
      tool: "call_template",
      id: "template.tracks.read_mixer_controls",
      refs: {},
      input: {
        include_selected: true,
        limit: query.limit,
      },
      purpose: "Hydrate compact mixer fields for track query rows.",
    },
  ];
}

function hydrateRefsRequest(refs, fields) {
  return {
    status: "planned",
    callable_now: false,
    planned_macro_id: "macro.hydrate_refs",
    blocker: {
      code: "HYDRATE_REFS_PLANNED",
      message: "macro.hydrate_refs is planned after C3.1; do not call it as an executable macro yet.",
      recoverable: true,
    },
    refs,
    fields,
    current_safe_alternative: "Request additional compact query_tracks fields now, or run accepted read templates against the returned canonical refs.",
    purpose: "Declare the future exact-ref hydration path without suggesting an unavailable call_template route.",
  };
}

function summarizeIndexStatus(indexState) {
  const staleScopes = Object.entries(indexState.freshness_scopes)
    .filter(([, scope]) => !freshnessStatusSatisfies(scope.status, "fresh_enough"))
    .map(([scopeKind, scope]) => ({ scope_kind: scopeKind, status: scope.status, reason: scope.reason ?? null }));
  return {
    contract: ALPHA3_C3_PROJECT_INDEX_CONTRACT,
    lifecycle: indexState.lifecycle,
    schema_version: indexState.schema_version,
    db_path: indexState.db_path,
    project_ref: indexState.project_ref,
    bridge_owner: indexState.bridge_owner,
    bridge_generation: indexState.bridge_generation,
    session_id: indexState.session_id,
    snapshot_id: indexState.snapshot_id,
    stale_scope_count: staleScopes.length,
    stale_scopes: staleScopes,
    freshness_scopes: indexState.freshness_scopes,
    coverage: indexState.coverage,
    degraded_reason: indexState.degraded_reason,
  };
}

function indexStatusDecisionSummary(status) {
  if (status.lifecycle === "ready") {
    return `Project index is ready at ${status.db_path}; ${status.stale_scope_count} scopes are not fresh enough.`;
  }
  if (status.lifecycle === "stale_session") {
    return "Project index belongs to a stale session; reconnect or rebuild before using rows for action.";
  }
  return `Project index is ${status.lifecycle}; run the planned task-scoped refresh before relying on rows.`;
}

function queryTracksDecisionSummary({ blockers, rows, trackScope }) {
  if (blockers.length > 0) {
    return "Track query needs a task-scoped index refresh before rows are safe to use.";
  }
  return `Track query returned ${rows.rows.length} compact rows with ${trackScope.status} freshness and ${trackScope.coverage_status} coverage.`;
}

function pageEnvelope(limit, cursor = null, nextCursor = null) {
  return {
    limit,
    cursor,
    next_cursor: nextCursor,
    has_more: nextCursor !== null,
  };
}

function projectIndexFreshnessModel() {
  return deepFreeze({
    freshness_statuses: FRESHNESS_STATUSES,
    coverage_statuses: COVERAGE_STATUSES,
    read_policy: "Read tasks may use fresh_enough rows when freshness and coverage are returned.",
    write_policy: "Write tasks require fresh target refs and owner context, then REAPER re-resolution before mutation.",
  });
}

function projectIndexWriteSafetyLoop() {
  return deepFreeze({
    sqlite_rows_are_candidates_only: true,
    required_sequence: [
      "select_candidate_refs_from_project_index",
      "re_resolve_targets_in_reaper",
      "execute_through_accepted_call_template_or_macro",
      "batch_readback_from_reaper",
      "update_artifact_store_and_project_index_after_readback",
    ],
    sqlite_may_authorize_write: false,
  });
}

function projectIndexSafety() {
  return {
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_sql_exposed: false,
    raw_lua_action_shell_or_ui: false,
    live_reaper: false,
    direct_reaper_write: false,
    sqlite_is_truth: false,
    project_truth: "REAPER",
  };
}

function annotateQueryMacro(definition, catalog) {
  const missingTemplates = definition.required_templates.filter((templateId) => !catalog.get(templateId));
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
    id: definition.id,
    status: definition.status,
    action_kind: "macro",
    menu_group: "query",
    execution_shape: "project_index_query_plan",
    query_kind: definition.query_kind,
    user_label: definition.user_label,
    summary: definition.summary,
    task_intents: definition.task_intents,
    required_templates: definition.required_templates,
    coverage: {
      status: missingTemplates.length === 0 ? definition.status : "missing_template",
      missing_templates: missingTemplates,
    },
    input_contract: sharedQueryInputContract(),
    output_contract: sharedQueryOutputContract(),
    safety: projectIndexSafety(),
  });
}

function officialQueryMacroDiscoveryItem(macro) {
  const implemented = macro.status === "implemented" && macro.coverage.missing_templates.length === 0;
  return deepFreeze({
    id: macro.id,
    title: macro.user_label,
    summary: macro.summary,
    pack: "core",
    lifecycle: implemented ? "experimental" : "draft",
    risk: "read",
    entity_kind: `macro.project_index.${macro.query_kind}`,
    tags: unique([
      "macro",
      "query",
      "project_index",
      "sqlite",
      "alpha3_c3",
      ...macro.task_intents.flatMap((intent) => intent.split(/\s+/)),
    ].map((entry) => entry.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()).filter(Boolean)).slice(0, 12),
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_index_query",
    menu_group: "query",
    execution_shape: macro.execution_shape,
    user_label: macro.user_label,
    task_intents: macro.task_intents,
    support_status: implemented ? "plan_only_runtime_bound" : "planned",
    risk_domain: "project_index_query_read",
    inputSchema: sharedQueryInputSchema(),
    outputSchema: {
      type: "object",
      required: ["contract", "action_kind", "mode", "plan", "execution"],
      properties: {
        contract: { const: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT },
        action_kind: { const: "macro" },
        mode: { const: "plan_only_project_index_query_macro" },
        plan: { type: "object" },
        execution: { type: "object" },
      },
    },
    refs: {
      input: [],
      output: [],
    },
    expectedDelta: {
      kind: "read",
      action: "read",
      entities: ["project_index_query_plan"],
      summary: "Returns a plan-only Project SQLite Index query envelope. It does not mutate REAPER or execute SQL.",
    },
    examples: [
      {
        input: macro.id === "macro.query_tracks"
          ? { filters: { selected: true }, limit: 25 }
          : { scope: "project" },
        refs: {},
      },
    ],
    live_runnable_now: true,
    exists_in_catalog: true,
    evidence_level: implemented ? "runtime_bound_static_fake" : "contract_only",
    support_state: implemented ? "supported" : "blocked",
    known_blocker: implemented ? null : "planned_after_c3_1",
    allowed_live_group: null,
  });
}

function sharedQueryInputContract() {
  return deepFreeze({
    scope: "project|selection|tracks|items|takes|fx|routing|automation|markers|media",
    refs: "optional exact canonical refs",
    filters: "bounded JSON object filters; no raw SQL",
    fields: "optional compact field names",
    detail: "summary|refs|compact|hydrated",
    time_range: "optional bounded time range",
    limit: "1..100",
    cursor: "opaque project index cursor",
    freshness: {
      require: "fresh|fresh_enough",
      refresh: "task_scoped|if_stale|none",
    },
  });
}

function sharedQueryOutputContract() {
  return deepFreeze({
    decision_summary: "string",
    refs: "canonical refs",
    rows: "compact summary rows only",
    freshness: "scope freshness",
    coverage: "coverage summary",
    page: "limit/cursor/next_cursor/has_more",
    artifact_ref: "optional artifact ref for large hydrated payloads",
    warnings: "bounded typed blockers or warnings",
  });
}

function sharedQueryInputSchema() {
  return {
    type: "object",
    required: [],
    properties: {
      scope: { type: "string" },
      refs: { type: "array" },
      filters: { type: "object", additionalProperties: true },
      fields: { type: "array" },
      detail: { type: "string" },
      time_range: { type: "object", additionalProperties: true },
      limit: { type: "integer" },
      cursor: { type: "string" },
      freshness: { type: "object", additionalProperties: true },
    },
  };
}

function queryMacro({
  id,
  user_label,
  query_kind,
  summary = `${user_label} is planned for a later C3 query macro slice.`,
  status = "planned",
  task_intents = [user_label.toLocaleLowerCase()],
  tags = ["project_index", "sqlite", "query", "alpha3_c3"],
  required_templates = [],
}) {
  return deepFreeze({
    id,
    user_label,
    summary,
    status,
    query_kind,
    task_intents,
    tags,
    required_templates,
  });
}

function blockedPlan(id, blockers) {
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
    ok: false,
    id,
    mode: "plan_only_project_index_query_macro",
    action_kind: "macro",
    menu_group: "query",
    execution_shape: "project_index_query_plan",
    decision_summary: "Project index query macro is blocked.",
    refs: [],
    rows: [],
    freshness: {},
    coverage: {},
    page: pageEnvelope(25),
    refresh_requests: [],
    hydrate_request: null,
    write_safety_loop: projectIndexWriteSafetyLoop(),
    safety: projectIndexSafety(),
    blockers: uniqueBlockers(blockers),
  });
}

function macroRuntimeError(plan) {
  const firstBlocker = plan.blockers[0] ?? blocker("macro", "MACRO_BLOCKED", "Project index query macro returned a blocker.");
  return {
    source: "macro",
    code: firstBlocker.code,
    message: firstBlocker.message,
    recoverable: firstBlocker.recoverable !== false,
    details: {
      blockers: plan.blockers,
    },
  };
}

function blocker(field, code, message) {
  return deepFreeze({
    field,
    code,
    message,
    recoverable: true,
  });
}

function createAlpha3C3AcceptedCatalog() {
  return createTemplateCatalog({
    templates: [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
      ...createTemplateCatalogP1Templates(),
    ],
  });
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
  if (decoded?.v !== 1 || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
    throw new Error("bad cursor");
  }
  return decoded.offset;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
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

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value ?? null));
}

function unique(values) {
  return [...new Set(values)];
}

function uniqueBlockers(blockers) {
  const seen = new Set();
  const result = [];
  for (const entry of blockers) {
    const key = `${entry.field}:${entry.code}:${entry.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(entry);
  }
  return result;
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
