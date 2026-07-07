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
import {
  createAlpha3C3ProjectIndexSchemaContract as createAlpha3C3ProjectIndexStoreSchemaContract,
} from "./alpha3-c3-project-index-store-v1.mjs";

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
    "macro.selected_context",
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
    "macro.selected_context",
    "macro.query_tracks",
    "macro.query_items",
    "macro.query_takes",
    "macro.query_fx",
    "macro.query_routing",
    "macro.query_markers",
    "macro.query_media",
    "macro.hydrate_refs",
    "macro.changed_since",
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
  "template.items.list_items_on_track",
  "template.items.list_selected_items",
  "template.items.read_item_summary",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.media.read_take_source",
  "template.media.read_project_media_files",
  "template.media.probe_file",
  "template.routing.read_project_routing_graph",
  "template.routing.read_track_routing",
  "template.routing.resolve_send_ref",
  "template.project.list_markers_regions",
]);

const QUERY_DETAIL_VALUES = new Set(["summary", "refs", "compact", "hydrated"]);
const QUERY_SCOPE_VALUES = new Set(["project", "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media"]);
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

const ITEM_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "track_ref",
  "start_seconds",
  "end_seconds",
  "length_seconds",
  "selected",
  "muted",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const TAKE_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "item_ref",
  "track_ref",
  "active",
  "selected",
  "source_kind",
  "source_ref",
  "pitch_semitones",
  "playrate",
  "reverse",
  "has_take_fx",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const FX_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "plugin_name",
  "plugin_id",
  "slot_index",
  "bypassed",
  "offline",
  "stock_plugin",
  "parameter_summary_available",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const ROUTING_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "source_track_ref",
  "destination_track_ref",
  "send_index",
  "send_kind",
  "muted",
  "volume_db",
  "pan",
  "send_mode",
  "audio_channels",
  "midi_channels",
  "phase_inverted",
  "mono",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const MARKER_REGION_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "marker_kind",
  "position_seconds",
  "end_seconds",
  "length_seconds",
  "name",
  "index",
  "number",
  "color",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const MEDIA_SOURCE_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "name",
  "path_fingerprint",
  "source_kind",
  "media_type",
  "extension",
  "offline",
  "length_seconds",
  "channel_count",
  "metadata_key_count",
  "freshness_status",
  "coverage_status",
  "observed_at",
  "payload_ref",
  "summary",
]);

const SELECTED_CONTEXT_ROW_FIELDS = deepFreeze([
  "ref",
  "ref_kind",
  "scope_kind",
  "owner_ref",
  "observed_at",
  "payload_ref",
  "summary",
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
    id: "macro.selected_context",
    user_label: "Selected context",
    summary: "Read compact selected refs from the Project SQLite Index after task-scoped selection freshness is satisfied.",
    status: "implemented",
    query_kind: "selected_context",
    task_intents: ["selected context", "what is selected", "current selection", "selected refs"],
    tags: ["project_index", "sqlite", "query", "selection", "selected_context", "alpha3_c3"],
    required_templates: [
      "template.project.create_observation_bundle",
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
  queryMacro({
    id: "macro.query_items",
    user_label: "Query items",
    summary: "Query compact item rows from the Project SQLite Index by selection, track refs, and time range.",
    status: "implemented",
    query_kind: "items",
    task_intents: ["find items", "selected items", "items on track", "items in time range", "large project item query"],
    tags: ["project_index", "sqlite", "query", "items", "time_range", "alpha3_c3"],
    required_templates: [
      "template.project.create_project_map_snapshot",
      "template.items.list_items_on_track",
      "template.items.list_selected_items",
      "template.items.read_item_summary",
    ],
  }),
  queryMacro({
    id: "macro.query_takes",
    user_label: "Query takes",
    summary: "Query compact take rows from the Project SQLite Index by item refs, track refs, source facts, active state, and take-FX presence.",
    status: "implemented",
    query_kind: "takes",
    task_intents: ["find takes", "active takes", "takes on item", "take source", "take fx presence", "large project take query"],
    tags: ["project_index", "sqlite", "query", "takes", "media", "alpha3_c3"],
    required_templates: [
      "template.project.create_project_map_snapshot",
      "template.items.list_items_on_track",
      "template.items.list_selected_items",
      "template.items.read_item_summary",
      "template.media.read_take_source",
    ],
  }),
  queryMacro({
    id: "macro.query_fx",
    user_label: "Query FX",
    summary: "Query compact FX rows from the Project SQLite Index by owner refs, plugin identity, stock status, bypass, and slot.",
    status: "implemented",
    query_kind: "fx",
    task_intents: ["find fx", "find plugins", "stock plugins", "fx on track", "large project plugin query"],
    tags: ["project_index", "sqlite", "query", "fx", "plugins", "stock_plugins", "alpha3_c3"],
    required_templates: [
      "template.project.create_project_map_snapshot",
      "template.tracks.read_mixer_controls",
      "template.fx.list_track_fx_chain",
      "template.fx.list_take_fx_chain",
      "template.fx.read_fx_summary",
    ],
  }),
  queryMacro({
    id: "macro.query_routing",
    user_label: "Query routing",
    summary: "Query compact send/routing rows from the Project SQLite Index by source/destination track refs, send refs, mute/mode/channel facts, and send level/pan.",
    status: "implemented",
    query_kind: "routing",
    task_intents: ["find sends", "track routing", "routing graph", "receives", "large project routing query"],
    tags: ["project_index", "sqlite", "query", "routing", "sends", "alpha3_c3"],
    required_templates: [
      "template.routing.read_project_routing_graph",
      "template.routing.read_track_routing",
      "template.routing.resolve_send_ref",
    ],
  }),
  queryMacro({ id: "macro.query_automation", user_label: "Query automation", query_kind: "automation" }),
  queryMacro({
    id: "macro.query_markers",
    user_label: "Query markers",
    summary: "Query compact marker/region rows from the Project SQLite Index by kind, name, refs, and time range.",
    status: "implemented",
    query_kind: "markers",
    task_intents: ["find markers", "find regions", "timeline markers", "marker regions", "large project marker query"],
    tags: ["project_index", "sqlite", "query", "markers", "regions", "alpha3_c3"],
    required_templates: [
      "template.project.list_markers_regions",
    ],
  }),
  queryMacro({
    id: "macro.query_media",
    user_label: "Query media",
    summary: "Query compact project media-source rows from the Project SQLite Index by file refs, kind, offline state, extension, and basic source facts.",
    status: "implemented",
    query_kind: "media",
    task_intents: ["find project media", "media files", "offline media", "audio sources", "large project media query"],
    tags: ["project_index", "sqlite", "query", "media", "files", "alpha3_c3"],
    required_templates: [
      "template.media.read_project_media_files",
      "template.media.probe_file",
    ],
  }),
  queryMacro({
    id: "macro.hydrate_refs",
    user_label: "Hydrate refs",
    summary: "Plan accepted call_template reads that hydrate exact canonical refs without dumping broad project state.",
    status: "implemented",
    query_kind: "hydrate_refs",
    task_intents: ["hydrate refs", "read exact refs", "detail for selected refs", "fetch object details"],
    tags: ["project_index", "sqlite", "query", "hydrate_refs", "refs", "alpha3_c3"],
    required_templates: [
      "template.tracks.resolve_track_ref",
      "template.tracks.read_mixer_controls",
      "template.items.read_item_summary",
      "template.media.read_take_source",
      "template.media.probe_file",
      "template.fx.read_fx_summary",
      "template.fx.list_fx_parameters",
      "template.routing.resolve_send_ref",
      "template.automation.read_envelope_summary",
    ],
  }),
  queryMacro({
    id: "macro.changed_since",
    user_label: "Changed since",
    summary: "Read compact Project Index object changes since a timestamp and suggest exact hydration when needed.",
    status: "implemented",
    query_kind: "changed_since",
    task_intents: ["changed since", "what changed", "recent readback changes", "index diff"],
    tags: ["project_index", "sqlite", "query", "changed_since", "diff", "alpha3_c3"],
  }),
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
  return createAlpha3C3ProjectIndexStoreSchemaContract();
}

export function planAlpha3C3ProjectIndexQueryMacro(id, request = {}, options = {}) {
  const catalog = options.catalog ?? createAlpha3C3AcceptedCatalog();
  const macro = getAlpha3C3ProjectIndexQueryMacro(id, { ...options, catalog });
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
    blockers.push(blocker("macro", "MACRO_PLANNED", `${macro.id} is planned but not implemented in the current C3 runtime slice.`));
  }

  if (macro.id === "macro.index_status") {
    return indexStatusPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.selected_context") {
    return selectedContextPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_tracks") {
    return queryTracksPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_items") {
    return queryItemsPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_takes") {
    return queryTakesPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_fx") {
    return queryFxPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_routing") {
    return queryRoutingPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_markers") {
    return queryMarkersPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.query_media") {
    return queryMediaPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.hydrate_refs") {
    return hydrateRefsPlan({ macro, normalized, indexState, blockers, catalog });
  }
  if (macro.id === "macro.changed_since") {
    return changedSincePlan({
      macro,
      normalized,
      indexState,
      projectIndex: options.projectIndex,
      blockers,
      catalog,
    });
  }

  return blockedPlan(macro.id, blockers);
}

export function createAlpha3C3ProjectIndexQueryRuntimeEnvelope({
  request = {},
  plan,
  projectIndex,
  catalog,
  now = () => new Date(),
} = {}) {
  const normalizedPlan = plan ?? planAlpha3C3ProjectIndexQueryMacro(request.id, {
    ...cloneJson(request.input ?? {}),
    refs: cloneJson(request.refs ?? {}),
  }, { projectIndex, catalog });
  const macro = getAlpha3C3ProjectIndexQueryMacro(normalizedPlan.id, { catalog }) ?? null;
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
        reason: "C3 query macros are plan-only. They may read resident Project Index rows or emit existing call_template requests, but they do not execute child requests, raw SQL, live REAPER, or writes.",
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

function indexStatusPlan({ macro, normalized, indexState, blockers, catalog }) {
  const status = summarizeIndexStatus(indexState);
  const refreshPlan = status.lifecycle === "stale_session"
    ? { requests: [], blockers: [] }
    : catalogBoundRequestPlans(indexStatusRefreshRequests(normalized.query), catalog);
  const allBlockers = [
    ...blockers,
    ...refreshPlan.blockers,
  ];
  const refreshRequests = status.lifecycle === "stale_session"
    ? []
    : refreshPlan.requests;
  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: allBlockers.length === 0,
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
    blockers: allBlockers,
    index_status: status,
  }));
}

function queryTracksPlan({ macro, normalized, indexState, blockers, catalog }) {
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
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryTrackRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryTracksDecisionSummary({ blockers: finalBlockers, rows, trackScope }),
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
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryItemsPlan({ macro, normalized, indexState, blockers, catalog }) {
  const itemScope = freshnessScope(indexState, "items");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, itemScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateItemScope(normalized.query.scope),
    ...validateItemFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryItemRows(indexState.rows.items, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryItemRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryItemsDecisionSummary({ blockers: finalBlockers, rows, itemScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "items",
      status: itemScope.status,
      coverage_status: itemScope.coverage_status,
      observed_at: itemScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: itemScope.coverage_status,
      source_scope: "items",
      row_count: rows.rows.length,
      complete: itemScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryTakesPlan({ macro, normalized, indexState, blockers, catalog }) {
  const takeScope = freshnessScope(indexState, "takes");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, takeScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateTakeScope(normalized.query.scope),
    ...validateTakeFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryTakeRows(indexState.rows.takes, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryTakeRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryTakesDecisionSummary({ blockers: finalBlockers, rows, takeScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "takes",
      status: takeScope.status,
      coverage_status: takeScope.coverage_status,
      observed_at: takeScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: takeScope.coverage_status,
      source_scope: "takes",
      row_count: rows.rows.length,
      complete: takeScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryFxPlan({ macro, normalized, indexState, blockers, catalog }) {
  const fxScope = freshnessScope(indexState, "fx");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, fxScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateFxScope(normalized.query.scope),
    ...validateFxFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryFxRows(indexState.rows.fx, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryFxRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryFxDecisionSummary({ blockers: finalBlockers, rows, fxScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "fx",
      status: fxScope.status,
      coverage_status: fxScope.coverage_status,
      observed_at: fxScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: fxScope.coverage_status,
      source_scope: "fx",
      row_count: rows.rows.length,
      complete: fxScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryRoutingPlan({ macro, normalized, indexState, blockers, catalog }) {
  const routingScope = freshnessScope(indexState, "routing");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, routingScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateRoutingScope(normalized.query.scope),
    ...validateRoutingFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryRoutingRows(indexState.rows.sends, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryRoutingRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryRoutingDecisionSummary({ blockers: finalBlockers, rows, routingScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "routing",
      status: routingScope.status,
      coverage_status: routingScope.coverage_status,
      observed_at: routingScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: routingScope.coverage_status,
      source_scope: "routing",
      row_count: rows.rows.length,
      complete: routingScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryMarkersPlan({ macro, normalized, indexState, blockers, catalog }) {
  const markersScope = freshnessScope(indexState, "markers");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, markersScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateMarkerScope(normalized.query.scope),
    ...validateMarkerFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryMarkerRows(indexState.rows.markers_regions, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryMarkerRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryMarkersDecisionSummary({ blockers: finalBlockers, rows, markersScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "markers",
      status: markersScope.status,
      coverage_status: markersScope.coverage_status,
      observed_at: markersScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: markersScope.coverage_status,
      source_scope: "markers",
      row_count: rows.rows.length,
      complete: markersScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? markerDetailRequest(rows.refs, normalized.query.fields)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function queryMediaPlan({ macro, normalized, indexState, blockers, catalog }) {
  const mediaScope = freshnessScope(indexState, "media");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, mediaScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateMediaScope(normalized.query.scope),
    ...validateMediaFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryMediaRows(indexState.rows.media_sources, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryMediaRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: queryMediaDecisionSummary({ blockers: finalBlockers, rows, mediaScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "media",
      status: mediaScope.status,
      coverage_status: mediaScope.coverage_status,
      observed_at: mediaScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: mediaScope.coverage_status,
      source_scope: "media",
      row_count: rows.rows.length,
      complete: mediaScope.coverage_status === "complete",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function selectedContextPlan({ macro, normalized, indexState, blockers, catalog }) {
  const selectionScope = freshnessScope(indexState, "selection");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, selectionScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateSelectedContextFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? querySelectedContextRows(indexState.rows.selection_state, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(selectedContextRefreshRequests(normalized.query), catalog)
    : { requests: [], blockers: [] };
  const finalBlockers = [
    ...allBlockers,
    ...refreshPlan.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0,
    decision_summary: selectedContextDecisionSummary({ blockers: finalBlockers, rows, selectionScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "selection",
      status: selectionScope.status,
      coverage_status: selectionScope.coverage_status,
      observed_at: selectionScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: selectionScope.coverage_status,
      source_scope: "selection",
      row_count: rows.rows.length,
      complete: selectionScope.coverage_status === "complete" || selectionScope.coverage_status === "selected_only",
    },
    page: pageEnvelope(normalized.query.limit, normalized.query.cursor, rows.next_cursor),
    refresh_requests: refreshPlan.requests,
    hydrate_request: rows.refs.length > 0
      ? hydrateRefsNextStep(rows.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function hydrateRefsPlan({ macro, normalized, indexState, blockers, catalog }) {
  const hydration = catalogBoundHydrationPlan(
    planHydrateRefs(normalized.query.refs, normalized.query),
    catalog,
  );
  const allBlockers = [
    ...blockers,
    ...hydrateReadinessBlockers(indexState),
    ...hydration.blockers,
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: allBlockers.length === 0,
    decision_summary: hydrateRefsDecisionSummary({ blockers: allBlockers, hydration }),
    rows: hydration.rows,
    refs: hydration.refs,
    freshness: {
      status: indexState.lifecycle === "ready" || indexState.lifecycle === "degraded" ? "fresh_enough" : "unknown",
      source: "exact_ref_hydration_plan",
      sqlite_is_truth: false,
    },
    coverage: {
      status: hydration.blockers.length === 0 ? "complete" : "partial",
      requested_ref_count: normalized.query.refs.length,
      planned_request_count: hydration.requests.length,
      unsupported_ref_count: hydration.blockers.filter((entry) => entry.code === "HYDRATE_REF_UNSUPPORTED").length,
    },
    page: pageEnvelope(normalized.query.limit),
    refresh_requests: [],
    hydrate_request: hydrateRefsRequestEnvelope(hydration.requests, normalized.query.refs, normalized.query.fields, allBlockers),
    blockers: allBlockers,
    index_status: summarizeIndexStatus(indexState),
  }));
}

function changedSincePlan({ macro, normalized, indexState, projectIndex, blockers, catalog }) {
  const allBlockers = [
    ...blockers,
    ...changedSinceReadinessBlockers(indexState),
  ];
  const changes = allBlockers.length === 0
    ? readChangedSinceRows({ projectIndex, indexState, query: normalized.query })
    : {
        refs: [],
        rows: [],
        page: pageEnvelope(normalized.query.limit, normalized.query.cursor),
        freshness: {
          source: "project_index_object_changes",
          sqlite_is_truth: false,
        },
      };

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: allBlockers.length === 0,
    decision_summary: changedSinceDecisionSummary({ blockers: allBlockers, changes, since: normalized.query.since }),
    rows: changes.rows,
    refs: changes.refs,
    freshness: {
      ...changes.freshness,
      lifecycle: indexState.lifecycle,
      since: normalized.query.since,
    },
    coverage: {
      status: "complete",
      source_scope: "object_changes",
      row_count: changes.rows.length,
      complete: true,
    },
    page: changes.page,
    refresh_requests: [],
    hydrate_request: changes.refs.length > 0
      ? hydrateRefsNextStep(changes.refs, normalized.query, catalog)
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
  const scope = normalizeScope(source.scope, blockers);
  const fields = normalizeFields(source.fields, blockers);
  const detail = normalizeDetail(source.detail, blockers);
  const freshness = normalizeFreshness(source.freshness, blockers);
  const since = normalizeSince(source.since, blockers);

  return {
    blockers,
    query: {
      scope,
      refs: normalizeRefs(source.refs),
      filters: normalizeFilters(source.filters, blockers),
      fields,
      detail,
      since,
      time_range: source.time_range ?? null,
      limit,
      cursor,
      freshness,
    },
  };
}

function normalizeScope(value, blockers) {
  if (value === undefined || value === null || value === "") return "project";
  if (typeof value === "string" && QUERY_SCOPE_VALUES.has(value.trim())) return value.trim();
  blockers.push(blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "scope must be project, selection, tracks, items, takes, fx, routing, automation, markers, or media."));
  return "project";
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
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? [value]
      : isPlainObject(value)
        ? Object.values(value).flatMap((entry) => Array.isArray(entry) ? entry : [entry])
        : [];
  return unique(raw.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
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
      items: Array.isArray(raw.rows?.items)
        ? raw.rows.items.map(normalizeItemRow).filter(Boolean)
        : [],
      takes: Array.isArray(raw.rows?.takes)
        ? raw.rows.takes.map(normalizeTakeRow).filter(Boolean)
        : [],
      fx: Array.isArray(raw.rows?.fx)
        ? raw.rows.fx.map(normalizeFxRow).filter(Boolean)
        : [],
      sends: Array.isArray(raw.rows?.sends)
        ? raw.rows.sends.map(normalizeRoutingRow).filter(Boolean)
        : [],
      markers_regions: Array.isArray(raw.rows?.markers_regions)
        ? raw.rows.markers_regions.map(normalizeMarkerRegionRow).filter(Boolean)
        : [],
      media_sources: Array.isArray(raw.rows?.media_sources)
        ? raw.rows.media_sources.map(normalizeMediaSourceRow).filter(Boolean)
        : [],
      selection_state: Array.isArray(raw.rows?.selection_state)
        ? raw.rows.selection_state.map(normalizeSelectionRow).filter(Boolean)
        : [],
      object_changes: Array.isArray(raw.rows?.object_changes) ? raw.rows.object_changes.map(normalizeObjectChangeRow).filter(Boolean) : [],
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

function normalizeItemRow(row) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  const startSeconds = finiteNumber(source.start_seconds ?? source.start);
  const endSeconds = finiteNumber(source.end_seconds ?? source.end);
  const explicitLength = finiteNumber(source.length_seconds ?? source.length);
  return {
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    track_ref: typeof source.track_ref === "string"
      ? source.track_ref
      : typeof source.owner_ref === "string" && source.owner_ref.startsWith("track:")
        ? source.owner_ref
        : null,
    start_seconds: startSeconds,
    end_seconds: endSeconds,
    length_seconds: explicitLength ?? itemLengthSeconds({ start_seconds: startSeconds, end_seconds: endSeconds }),
    selected: Boolean(source.selected),
    muted: Boolean(source.muted),
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeTakeRow(row) {
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
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary,
  };
}

function normalizeFxRow(row) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  return {
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
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeRoutingRow(row) {
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
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary,
  };
}

function normalizeMarkerRegionRow(row) {
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
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary,
  };
}

function normalizeMediaSourceRow(row) {
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
    freshness_status: FRESHNESS_STATUSES.includes(source.freshness_status) ? source.freshness_status : "unknown",
    coverage_status: COVERAGE_STATUSES.includes(source.coverage_status) ? source.coverage_status : "unknown",
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary,
  };
}

function normalizeObjectChangeRow(row) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  const observedAt = typeof source.observed_at === "string" ? source.observed_at : null;
  if (!ref || !observedAt) return null;
  return {
    change_id: typeof source.change_id === "string" && source.change_id
      ? source.change_id
      : `change:${observedAt}:${ref}`,
    ref,
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    change_kind: typeof source.change_kind === "string" && source.change_kind ? source.change_kind : "changed",
    observed_at: observedAt,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
  };
}

function normalizeSelectionRow(row) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref ? source.ref : null;
  if (ref === null) return null;
  return {
    ref,
    ref_kind: typeof source.ref_kind === "string" && source.ref_kind
      ? source.ref_kind
      : refKind(ref),
    scope_kind: typeof source.scope_kind === "string" && source.scope_kind
      ? source.scope_kind
      : refKind(ref),
    owner_ref: typeof source.owner_ref === "string" ? source.owner_ref : null,
    observed_at: typeof source.observed_at === "string" ? source.observed_at : null,
    payload_ref: typeof source.payload_ref === "string" ? source.payload_ref : null,
    summary: isPlainObject(source.summary) ? cloneJson(source.summary) : {},
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

function hydrateReadinessBlockers(indexState) {
  if (indexState.lifecycle === "stale_session") {
    return [blocker("index", "INDEX_STALE_SESSION", "Project index belongs to a stale bridge/session; reconnect before hydrating refs.")];
  }
  if (indexState.lifecycle === "closed") {
    return [blocker("index", "INDEX_NOT_READY", "Project index is closed; reconnect or rebuild before hydrating refs.")];
  }
  return [];
}

function changedSinceReadinessBlockers(indexState) {
  if (indexState.lifecycle === "stale_session") {
    return [blocker("index", "INDEX_STALE_SESSION", "Project index belongs to a stale bridge/session; reconnect before reading changes.")];
  }
  if (indexState.lifecycle !== "ready" && indexState.lifecycle !== "degraded") {
    return [blocker("index", "INDEX_NOT_READY", "Project index is not ready; run a task-scoped refresh before reading changed-since rows.")];
  }
  return [];
}

function freshnessStatusSatisfies(status, require) {
  if (require === "fresh") return status === "fresh";
  return status === "fresh" || status === "fresh_enough";
}

function readChangedSinceRows({ projectIndex, indexState, query }) {
  if (typeof projectIndex?.changedSince === "function") {
    const result = projectIndex.changedSince({
      since: query.since,
      limit: query.limit,
      cursor: query.cursor,
    });
    return {
      refs: Array.isArray(result.refs) ? result.refs : [],
      rows: Array.isArray(result.rows) ? result.rows.map(projectObjectChangeRow) : [],
      page: result.page ?? pageEnvelope(query.limit, query.cursor),
      freshness: result.freshness ?? {
        source: "project_index_object_changes",
        sqlite_is_truth: false,
      },
    };
  }

  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const rows = indexState.rows.object_changes
    .filter((row) => query.since === null || row.observed_at > query.since)
    .sort((a, b) => a.observed_at.localeCompare(b.observed_at) || a.change_id.localeCompare(b.change_id));
  const pageRows = rows.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < rows.length ? offset + pageRows.length : null;
  return {
    refs: pageRows.map((row) => row.ref),
    rows: pageRows.map(projectObjectChangeRow),
    page: pageEnvelope(query.limit, query.cursor, nextOffset === null ? null : encodeCursor(nextOffset)),
    freshness: {
      source: "project_index_object_changes",
      sqlite_is_truth: false,
    },
  };
}

function projectObjectChangeRow(row) {
  return {
    change_id: row.change_id,
    ref: row.ref,
    owner_ref: row.owner_ref ?? null,
    change_kind: row.change_kind,
    observed_at: row.observed_at,
    payload_ref: row.payload_ref ?? null,
    summary: isPlainObject(row.summary) ? cloneJson(row.summary) : {},
  };
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

function queryItemRows(itemRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = itemRows
    .filter((row) => row.ref)
    .filter((row) => itemRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectItemRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function queryTakeRows(takeRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = takeRows
    .filter((row) => row.ref)
    .filter((row) => takeRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectTakeRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function queryFxRows(fxRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = fxRows
    .filter((row) => row.ref)
    .filter((row) => fxRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectFxRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function queryRoutingRows(routingRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = routingRows
    .filter((row) => row.ref)
    .filter((row) => routingRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectRoutingRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function queryMarkerRows(markerRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = markerRows
    .filter((row) => row.ref)
    .filter((row) => markerRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectMarkerRegionRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function queryMediaRows(mediaRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = mediaRows
    .filter((row) => row.ref)
    .filter((row) => mediaRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectMediaSourceRow(row, query.fields)),
    refs: pageRows.map((row) => row.ref),
    next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
  };
}

function querySelectedContextRows(selectionRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = selectionRows
    .filter((row) => row.ref)
    .filter((row) => selectedContextRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectSelectedContextRow(row, query.fields)),
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

function itemRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.scope === "selection" && row.selected !== true) return false;
  if (query.refs.length > 0 && !itemRefsMatch(row, query.refs)) return false;
  if (!itemTrackFiltersMatch(row, filters)) return false;
  if (filters.selected !== undefined && Boolean(filters.selected) !== row.selected) return false;
  if (filters.muted !== undefined && Boolean(filters.muted) !== row.muted) return false;
  if (!itemTimeRangeMatches(row, query.time_range)) return false;
  if (Number.isFinite(filters.min_length_seconds) && (itemLengthSeconds(row) ?? -Infinity) < filters.min_length_seconds) return false;
  if (Number.isFinite(filters.max_length_seconds) && (itemLengthSeconds(row) ?? Infinity) > filters.max_length_seconds) return false;
  if (Number.isFinite(filters.starts_after_seconds) && (row.start_seconds ?? -Infinity) < filters.starts_after_seconds) return false;
  if (Number.isFinite(filters.starts_before_seconds) && (row.start_seconds ?? Infinity) > filters.starts_before_seconds) return false;
  return true;
}

function takeRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.scope === "selection" && row.selected !== true) return false;
  if (query.refs.length > 0 && !takeRefsMatch(row, query.refs)) return false;
  if (!takeOwnerFiltersMatch(row, filters)) return false;
  if (filters.active !== undefined && Boolean(filters.active) !== row.active) return false;
  if (filters.selected !== undefined && Boolean(filters.selected) !== row.selected) return false;
  if (filters.reverse !== undefined && Boolean(filters.reverse) !== row.reverse) return false;
  if (filters.has_take_fx !== undefined && Boolean(filters.has_take_fx) !== row.has_take_fx) return false;
  if (typeof filters.source_kind === "string" && !String(row.source_kind ?? "").toLocaleLowerCase().includes(filters.source_kind.toLocaleLowerCase())) return false;
  if (typeof filters.source_ref === "string" && !String(row.source_ref ?? "").toLocaleLowerCase().includes(filters.source_ref.toLocaleLowerCase())) return false;
  if (Number.isFinite(filters.min_pitch_semitones) && (row.pitch_semitones ?? -Infinity) < filters.min_pitch_semitones) return false;
  if (Number.isFinite(filters.max_pitch_semitones) && (row.pitch_semitones ?? Infinity) > filters.max_pitch_semitones) return false;
  if (Number.isFinite(filters.min_playrate) && (row.playrate ?? -Infinity) < filters.min_playrate) return false;
  if (Number.isFinite(filters.max_playrate) && (row.playrate ?? Infinity) > filters.max_playrate) return false;
  return true;
}

function fxRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.refs.length > 0 && !fxRefsMatch(row, query.refs)) return false;
  if (!fxOwnerFiltersMatch(row, filters)) return false;
  if (typeof filters.plugin_name === "string" && !row.plugin_name.toLocaleLowerCase().includes(filters.plugin_name.toLocaleLowerCase())) return false;
  if (typeof filters.plugin_id === "string" && !String(row.plugin_id ?? "").toLocaleLowerCase().includes(filters.plugin_id.toLocaleLowerCase())) return false;
  if (filters.stock_plugin !== undefined && Boolean(filters.stock_plugin) !== isStockReaperPlugin(row)) return false;
  if (filters.bypassed !== undefined && Boolean(filters.bypassed) !== row.bypassed) return false;
  if (filters.offline !== undefined && Boolean(filters.offline) !== fxOffline(row)) return false;
  if (filters.parameter_summary_available !== undefined && Boolean(filters.parameter_summary_available) !== fxParameterSummaryAvailable(row)) return false;
  if (Number.isFinite(filters.slot_index) && row.slot_index !== filters.slot_index) return false;
  if (Number.isFinite(filters.slot_min) && (row.slot_index ?? -Infinity) < filters.slot_min) return false;
  if (Number.isFinite(filters.slot_max) && (row.slot_index ?? Infinity) > filters.slot_max) return false;
  return true;
}

function routingRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.refs.length > 0 && !routingRefsMatch(row, query.refs)) return false;
  if (!routingTrackFiltersMatch(row, filters)) return false;
  if (filters.muted !== undefined && Boolean(filters.muted) !== row.muted) return false;
  if (typeof filters.send_mode === "string" && filters.send_mode !== row.send_mode) return false;
  if (typeof filters.mode === "string" && filters.mode !== row.send_mode) return false;
  if (typeof filters.send_kind === "string" && filters.send_kind !== row.send_kind) return false;
  if (filters.phase_inverted !== undefined && Boolean(filters.phase_inverted) !== row.phase_inverted) return false;
  if (filters.mono !== undefined && Boolean(filters.mono) !== row.mono) return false;
  if (Number.isFinite(filters.send_index) && row.send_index !== filters.send_index) return false;
  if (Number.isFinite(filters.send_index_min) && (row.send_index ?? -Infinity) < filters.send_index_min) return false;
  if (Number.isFinite(filters.send_index_max) && (row.send_index ?? Infinity) > filters.send_index_max) return false;
  if (Number.isFinite(filters.min_volume_db) && (row.volume_db ?? -Infinity) < filters.min_volume_db) return false;
  if (Number.isFinite(filters.max_volume_db) && (row.volume_db ?? Infinity) > filters.max_volume_db) return false;
  if (Number.isFinite(filters.min_pan) && (row.pan ?? -Infinity) < filters.min_pan) return false;
  if (Number.isFinite(filters.max_pan) && (row.pan ?? Infinity) > filters.max_pan) return false;
  if (typeof filters.audio_channels === "string" && filters.audio_channels !== row.audio_channels) return false;
  if (typeof filters.midi_channels === "string" && filters.midi_channels !== row.midi_channels) return false;
  return true;
}

function markerRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.refs.length > 0 && !markerRefsMatch(row, query.refs)) return false;
  const ownerRefs = normalizeFilterRefs(filters, "owner_ref", "owner_refs");
  if (ownerRefs.length > 0 && !ownerRefs.includes(row.owner_ref)) return false;
  const kind = typeof filters.marker_kind === "string"
    ? filters.marker_kind
    : typeof filters.kind === "string"
      ? filters.kind
      : null;
  if (kind !== null && kind !== row.marker_kind) return false;
  if (filters.include_markers === false && row.marker_kind === "marker") return false;
  if (filters.include_regions === false && row.marker_kind === "region") return false;
  if (typeof filters.name === "string" && !row.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase())) return false;
  if (Number.isFinite(filters.index) && row.index !== filters.index) return false;
  if (Number.isFinite(filters.number) && row.number !== filters.number) return false;
  if (Number.isFinite(filters.min_position_seconds) && (row.position_seconds ?? -Infinity) < filters.min_position_seconds) return false;
  if (Number.isFinite(filters.max_position_seconds) && (row.position_seconds ?? Infinity) > filters.max_position_seconds) return false;
  if (Number.isFinite(filters.min_length_seconds) && (row.length_seconds ?? -Infinity) < filters.min_length_seconds) return false;
  if (Number.isFinite(filters.max_length_seconds) && (row.length_seconds ?? Infinity) > filters.max_length_seconds) return false;
  if (!markerTimeRangeMatches(row, query.time_range)) return false;
  return true;
}

function mediaRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.refs.length > 0 && !mediaRefsMatch(row, query.refs)) return false;
  const ownerRefs = normalizeFilterRefs(filters, "owner_ref", "owner_refs");
  if (ownerRefs.length > 0 && !ownerRefs.includes(row.owner_ref)) return false;
  if (typeof filters.name === "string" && !row.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase())) return false;
  if (typeof filters.source_kind === "string" && !String(row.source_kind ?? "").toLocaleLowerCase().includes(filters.source_kind.toLocaleLowerCase())) return false;
  if (typeof filters.source_type === "string" && !String(row.source_kind ?? "").toLocaleLowerCase().includes(filters.source_type.toLocaleLowerCase())) return false;
  if (typeof filters.media_type === "string" && filters.media_type !== row.media_type) return false;
  if (typeof filters.extension === "string" && normalizeExtension(filters.extension) !== row.extension) return false;
  if (Array.isArray(filters.extensions)) {
    const extensions = filters.extensions
      .filter((entry) => typeof entry === "string" && entry.trim())
      .map(normalizeExtension);
    if (extensions.length > 0 && !extensions.includes(row.extension)) return false;
  }
  if (filters.offline !== undefined) {
    if (typeof row.offline !== "boolean") return false;
    if (Boolean(filters.offline) !== row.offline) return false;
  }
  if (Number.isFinite(filters.min_length_seconds) && (row.length_seconds ?? -Infinity) < filters.min_length_seconds) return false;
  if (Number.isFinite(filters.max_length_seconds) && (row.length_seconds ?? Infinity) > filters.max_length_seconds) return false;
  if (Number.isFinite(filters.min_channel_count) && (row.channel_count ?? -Infinity) < filters.min_channel_count) return false;
  if (Number.isFinite(filters.max_channel_count) && (row.channel_count ?? Infinity) > filters.max_channel_count) return false;
  if (filters.metadata_available !== undefined) {
    if (row.metadata_key_count === null) return false;
    if (Boolean(filters.metadata_available) !== (row.metadata_key_count > 0)) return false;
  }
  return true;
}

function fxRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.owner_ref);
}

function routingRefsMatch(row, refs) {
  return refs.includes(row.ref)
    || refs.includes(row.owner_ref)
    || refs.includes(row.source_track_ref)
    || refs.includes(row.destination_track_ref);
}

function markerRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.owner_ref);
}

function mediaRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.owner_ref);
}

function fxOwnerFiltersMatch(row, filters) {
  const raw = [];
  if (typeof filters.owner_ref === "string") raw.push(filters.owner_ref);
  if (Array.isArray(filters.owner_refs)) raw.push(...filters.owner_refs);
  const ownerRefs = unique(raw.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
  if (ownerRefs.length === 0) return true;
  return ownerRefs.includes(row.owner_ref);
}

function routingTrackFiltersMatch(row, filters) {
  const ownerRefs = normalizeFilterRefs(filters, "owner_ref", "owner_refs");
  if (ownerRefs.length > 0 && !ownerRefs.includes(row.owner_ref) && !ownerRefs.includes(row.source_track_ref)) return false;

  const sourceTrackRefs = normalizeFilterRefs(filters, "source_track_ref", "source_track_refs");
  if (sourceTrackRefs.length > 0 && !sourceTrackRefs.includes(row.source_track_ref)) return false;

  const destinationTrackRefs = normalizeFilterRefs(filters, "destination_track_ref", "destination_track_refs");
  if (destinationTrackRefs.length > 0 && !destinationTrackRefs.includes(row.destination_track_ref)) return false;
  return true;
}

function itemRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.track_ref) || refs.includes(row.owner_ref);
}

function itemTrackFiltersMatch(row, filters) {
  const raw = [];
  if (typeof filters.track_ref === "string") raw.push(filters.track_ref);
  if (Array.isArray(filters.track_refs)) raw.push(...filters.track_refs);
  const trackRefs = unique(raw.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
  if (trackRefs.length === 0) return true;
  return trackRefs.includes(row.track_ref) || trackRefs.includes(row.owner_ref);
}

function takeRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.item_ref) || refs.includes(row.track_ref) || refs.includes(row.owner_ref);
}

function takeOwnerFiltersMatch(row, filters) {
  const itemRefs = [];
  if (typeof filters.item_ref === "string") itemRefs.push(filters.item_ref);
  if (Array.isArray(filters.item_refs)) itemRefs.push(...filters.item_refs);
  const normalizedItemRefs = unique(itemRefs.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
  if (normalizedItemRefs.length > 0 && !normalizedItemRefs.includes(row.item_ref) && !normalizedItemRefs.includes(row.owner_ref)) return false;

  const trackRefs = [];
  if (typeof filters.track_ref === "string") trackRefs.push(filters.track_ref);
  if (Array.isArray(filters.track_refs)) trackRefs.push(...filters.track_refs);
  const normalizedTrackRefs = unique(trackRefs.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
  if (normalizedTrackRefs.length > 0 && !normalizedTrackRefs.includes(row.track_ref)) return false;
  return true;
}

function normalizeFilterRefs(filters, singularField, pluralField) {
  const raw = [];
  if (typeof filters[singularField] === "string") raw.push(filters[singularField]);
  if (Array.isArray(filters[pluralField])) raw.push(...filters[pluralField]);
  return unique(raw.filter((entry) => typeof entry === "string" && entry.trim()).map((entry) => entry.trim()));
}

function itemTimeRangeMatches(row, timeRange) {
  if (!isPlainObject(timeRange)) return true;
  const rangeStart = finiteNumber(timeRange.start_seconds ?? timeRange.start);
  const rangeEnd = finiteNumber(timeRange.end_seconds ?? timeRange.end);
  if (rangeStart === null && rangeEnd === null) return true;
  const itemStart = row.start_seconds;
  const itemEnd = row.end_seconds ?? row.start_seconds;
  if (itemStart === null && itemEnd === null) return false;
  if (rangeStart !== null && itemEnd !== null && itemEnd < rangeStart) return false;
  if (rangeEnd !== null && itemStart !== null && itemStart > rangeEnd) return false;
  return true;
}

function markerTimeRangeMatches(row, timeRange) {
  if (!isPlainObject(timeRange)) return true;
  const rangeStart = finiteNumber(timeRange.start_seconds ?? timeRange.start);
  const rangeEnd = finiteNumber(timeRange.end_seconds ?? timeRange.end);
  if (rangeStart === null && rangeEnd === null) return true;
  const markerStart = row.position_seconds;
  const markerEnd = row.end_seconds ?? row.position_seconds;
  if (markerStart === null && markerEnd === null) return false;
  if (rangeStart !== null && markerEnd !== null && markerEnd < rangeStart) return false;
  if (rangeEnd !== null && markerStart !== null && markerStart > rangeEnd) return false;
  return true;
}

function selectedContextRowMatches(row, query) {
  if (!selectedContextScopeMatches(row, query.scope)) return false;
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (typeof filters.scope_kind === "string" && filters.scope_kind !== row.scope_kind) return false;
  if (typeof filters.ref_kind === "string" && filters.ref_kind !== row.ref_kind) return false;
  if (typeof filters.owner_ref === "string" && filters.owner_ref !== row.owner_ref) return false;
  return true;
}

function selectedContextScopeMatches(row, scope) {
  if (scope === "project" || scope === "selection") return true;
  if (scope === "tracks") return row.ref_kind === "track" || row.scope_kind === "track";
  if (scope === "items") return row.ref_kind === "item" || row.scope_kind === "item";
  if (scope === "takes") return row.ref_kind === "take" || row.scope_kind === "take";
  if (scope === "fx") return row.ref_kind === "fx" || row.scope_kind === "fx";
  if (scope === "routing") return row.ref_kind === "send" || row.scope_kind === "send";
  if (scope === "automation") return row.ref_kind === "envelope" || row.scope_kind === "envelope";
  if (scope === "markers") return row.ref_kind === "marker" || row.ref_kind === "region";
  if (scope === "media") return row.ref_kind === "take" || row.scope_kind === "media";
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

function projectItemRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "owner_ref",
    "track_ref",
    "start_seconds",
    "end_seconds",
    "length_seconds",
    "selected",
    "muted",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (ITEM_ROW_FIELDS.includes(field)) projected[field] = field === "length_seconds"
      ? itemLengthSeconds(row)
      : row[field];
  }
  return projected;
}

function projectTakeRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "owner_ref",
    "item_ref",
    "track_ref",
    "active",
    "source_kind",
    "playrate",
    "pitch_semitones",
    "reverse",
    "has_take_fx",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (TAKE_ROW_FIELDS.includes(field)) projected[field] = row[field];
  }
  return projected;
}

function projectFxRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "owner_ref",
    "plugin_name",
    "plugin_id",
    "slot_index",
    "bypassed",
    "stock_plugin",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (!FX_ROW_FIELDS.includes(field)) continue;
    if (field === "stock_plugin") projected[field] = isStockReaperPlugin(row);
    else if (field === "offline") projected[field] = fxOffline(row);
    else if (field === "parameter_summary_available") projected[field] = fxParameterSummaryAvailable(row);
    else projected[field] = row[field];
  }
  return projected;
}

function projectRoutingRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "owner_ref",
    "source_track_ref",
    "destination_track_ref",
    "send_index",
    "muted",
    "volume_db",
    "pan",
    "send_mode",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (ROUTING_ROW_FIELDS.includes(field)) projected[field] = row[field];
  }
  return projected;
}

function projectMarkerRegionRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "marker_kind",
    "position_seconds",
    "end_seconds",
    "name",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (MARKER_REGION_ROW_FIELDS.includes(field)) projected[field] = field === "length_seconds"
      ? markerRegionLengthSeconds(row)
      : row[field];
  }
  return projected;
}

function projectMediaSourceRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "name",
    "source_kind",
    "media_type",
    "extension",
    "offline",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (MEDIA_SOURCE_ROW_FIELDS.includes(field)) projected[field] = row[field];
  }
  return projected;
}

function projectSelectedContextRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "ref_kind",
    "scope_kind",
    "owner_ref",
    "observed_at",
    "payload_ref",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (SELECTED_CONTEXT_ROW_FIELDS.includes(field)) projected[field] = row[field];
  }
  return projected;
}

function validateTrackFields(fields) {
  return fields
    .filter((field) => !TRACK_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_tracks does not expose field ${field}.`));
}

function validateItemScope(scope) {
  if (["project", "items", "selection", "tracks"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_items supports project, items, selection, or tracks scope.")];
}

function validateItemFields(fields) {
  return fields
    .filter((field) => !ITEM_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_items does not expose field ${field}.`));
}

function validateTakeScope(scope) {
  if (["project", "takes", "selection", "tracks", "items"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_takes supports project, takes, selection, tracks, or items scope.")];
}

function validateTakeFields(fields) {
  return fields
    .filter((field) => !TAKE_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_takes does not expose field ${field}.`));
}

function validateFxScope(scope) {
  if (["project", "fx", "tracks", "items", "takes"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_fx supports project, fx, tracks, items, or takes scope.")];
}

function validateFxFields(fields) {
  return fields
    .filter((field) => !FX_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_fx does not expose field ${field}.`));
}

function validateRoutingScope(scope) {
  if (["project", "routing", "tracks"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_routing supports project, routing, or tracks scope.")];
}

function validateRoutingFields(fields) {
  return fields
    .filter((field) => !ROUTING_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_routing does not expose field ${field}.`));
}

function validateMarkerScope(scope) {
  if (["project", "markers"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_markers supports project or markers scope.")];
}

function validateMarkerFields(fields) {
  return fields
    .filter((field) => !MARKER_REGION_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_markers does not expose field ${field}.`));
}

function validateMediaScope(scope) {
  if (["project", "media"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_media supports project or media scope.")];
}

function validateMediaFields(fields) {
  return fields
    .filter((field) => !MEDIA_SOURCE_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_media does not expose field ${field}.`));
}

function validateSelectedContextFields(fields) {
  return fields
    .filter((field) => !SELECTED_CONTEXT_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `selected_context does not expose field ${field}.`));
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

function queryItemRefreshRequests(query) {
  const trackRefs = queryItemTrackRefs(query);
  const itemRefs = query.refs.filter((ref) => ref.startsWith("item:"));
  const requests = [
    {
      tool: "call_template",
      id: "template.project.create_project_map_snapshot",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: Math.min(query.limit, 100),
        include_selected_items: true,
        include_track_items: true,
      },
      purpose: "Refresh paged item rows from REAPER truth before using Project SQLite Index item rows.",
    },
  ];

  if (query.scope === "selection" || query.filters.selected === true) {
    requests.push({
      tool: "call_template",
      id: "template.items.list_selected_items",
      refs: {},
      input: {
        limit: query.limit,
        include_take_summary: false,
      },
      purpose: "Refresh selected item refs from REAPER truth for selected-item queries.",
    });
  }

  for (const trackRef of trackRefs) {
    requests.push({
      tool: "call_template",
      id: "template.items.list_items_on_track",
      refs: { track_ref: trackRef },
      input: {
        limit: query.limit,
        include_take_summary: false,
      },
      purpose: "Refresh items for an exact track ref before using indexed item rows.",
    });
  }

  for (const itemRef of itemRefs) {
    requests.push({
      tool: "call_template",
      id: "template.items.read_item_summary",
      refs: { item_ref: itemRef },
      input: {
        include_take_summary: false,
      },
      purpose: "Re-read an exact item ref from REAPER truth before using indexed item rows.",
    });
  }

  return dedupeRequestPlans(requests);
}

function queryTakeRefreshRequests(query) {
  const trackRefs = queryTakeTrackRefs(query);
  const itemRefs = queryTakeItemRefs(query);
  const takeRefs = query.refs.filter((ref) => ref.startsWith("take:"));
  const requests = [
    {
      tool: "call_template",
      id: "template.project.create_project_map_snapshot",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: Math.min(query.limit, 100),
        include_selected_items: true,
        include_track_items: true,
      },
      purpose: "Refresh compact item/take candidates from REAPER truth before using Project SQLite Index take rows.",
    },
  ];

  if (query.scope === "selection" || query.filters.selected === true) {
    requests.push({
      tool: "call_template",
      id: "template.items.list_selected_items",
      refs: {},
      input: {
        limit: query.limit,
        include_track_refs: true,
      },
      purpose: "Refresh selected item refs from REAPER truth before deriving selected active-take candidates.",
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
        max: query.limit,
      },
      purpose: "For each selected item_ref returned by list_selected_items, read the item summary with active-take facts before updating take rows.",
    });
  }

  for (const trackRef of trackRefs) {
    requests.push({
      tool: "call_template",
      id: "template.items.list_items_on_track",
      refs: { track_ref: trackRef },
      input: {
        limit: query.limit,
        include_take_summary: true,
      },
      purpose: "Refresh item rows with active-take summaries for an exact track ref.",
    });
  }

  for (const itemRef of itemRefs) {
    requests.push({
      tool: "call_template",
      id: "template.items.read_item_summary",
      refs: { item_ref: itemRef },
      input: {
        include_take_summary: true,
      },
      purpose: "Re-read an exact item and active-take summary from REAPER truth.",
    });
  }

  for (const takeRef of takeRefs) {
    requests.push({
      tool: "call_template",
      id: "template.media.read_take_source",
      refs: { take_ref: takeRef },
      input: {
        include_metadata_keys: false,
        include_parent_source: false,
      },
      purpose: "Re-read an exact take source from REAPER truth before using indexed take rows.",
    });
  }

  return dedupeRequestPlans(requests);
}

function queryFxRefreshRequests(query) {
  const ownerRefs = queryFxOwnerRefs(query);
  const fxRefs = query.refs.filter((ref) => ref.startsWith("fx:"));
  const requests = [
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
      purpose: "Refresh compact project/track rows before resolving FX candidates from REAPER truth.",
    },
    {
      tool: "call_template",
      id: "template.tracks.read_mixer_controls",
      refs: {},
      input: {
        include_selected: true,
        limit: query.limit,
      },
      purpose: "Refresh track mixer context and FX presence before using indexed FX rows.",
    },
  ];

  for (const ownerRef of ownerRefs) {
    const ownerKind = refKind(ownerRef);
    if (ownerKind === "track") {
      requests.push({
        tool: "call_template",
        id: "template.fx.list_track_fx_chain",
        refs: { track_ref: ownerRef },
        input: {
          include_preset: false,
        },
        purpose: "Refresh FX chain rows for an exact track owner from REAPER truth.",
      });
    } else if (ownerKind === "take") {
      requests.push({
        tool: "call_template",
        id: "template.fx.list_take_fx_chain",
        refs: { take_ref: ownerRef },
        input: {
          include_preset: false,
        },
        purpose: "Refresh FX chain rows for an exact take owner from REAPER truth.",
      });
    }
  }

  for (const fxRef of fxRefs) {
    requests.push({
      tool: "call_template",
      id: "template.fx.read_fx_summary",
      refs: { fx_ref: fxRef },
      input: {},
      purpose: "Re-read an exact FX ref from REAPER truth before using indexed FX rows.",
    });
  }

  return dedupeRequestPlans(requests);
}

function queryRoutingRefreshRequests(query) {
  const trackRefs = queryRoutingTrackRefs(query);
  const sendRefs = query.refs.filter((ref) => ref.startsWith("send:"));
  const requests = [
    {
      tool: "call_template",
      id: "template.routing.read_project_routing_graph",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_edges: Math.min(query.limit * 4, 400),
        include_master_parent: true,
      },
      purpose: "Refresh compact project send/routing candidates from REAPER truth before using indexed routing rows.",
    },
  ];

  for (const trackRef of trackRefs) {
    requests.push({
      tool: "call_template",
      id: "template.routing.read_track_routing",
      refs: { track_ref: trackRef },
      input: {
        include_receives: true,
        include_master_parent: true,
        max_routes: query.limit,
      },
      purpose: "Refresh send/receive rows for an exact track ref before using indexed routing rows.",
    });
  }

  for (const sendRef of sendRefs) {
    requests.push({
      tool: "call_template",
      id: "template.routing.resolve_send_ref",
      refs: {},
      input: { send_ref: sendRef },
      purpose: "Re-resolve an exact send ref from REAPER truth before using indexed routing rows.",
    });
  }

  return dedupeRequestPlans(requests);
}

function queryMarkerRefreshRequests(query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  const kind = typeof filters.marker_kind === "string"
    ? filters.marker_kind
    : typeof filters.kind === "string"
      ? filters.kind
      : null;
  const includeMarkers = kind === "region" ? false : filters.include_markers !== false;
  const includeRegions = kind === "marker" ? false : filters.include_regions !== false;
  return [
    {
      tool: "call_template",
      id: "template.project.list_markers_regions",
      refs: {},
      input: {
        limit: query.limit,
        include_markers: includeMarkers,
        include_regions: includeRegions,
      },
      purpose: "Refresh compact marker/region rows from REAPER truth before using Project SQLite Index marker rows.",
    },
  ];
}

function queryMediaRefreshRequests(query) {
  return [
    {
      tool: "call_template",
      id: "template.media.read_project_media_files",
      refs: {},
      input: {
        include_offline: query.filters.offline === false ? false : true,
        include_metadata_keys: query.detail === "hydrated" || query.fields.includes("metadata_key_count"),
        max_sources: query.limit,
      },
      purpose: "Refresh distinct project media file refs from REAPER truth before using Project SQLite Index media rows.",
    },
  ];
}

function queryItemTrackRefs(query) {
  const filterRefs = [];
  if (typeof query.filters.track_ref === "string") filterRefs.push(query.filters.track_ref);
  if (Array.isArray(query.filters.track_refs)) filterRefs.push(...query.filters.track_refs);
  return unique([
    ...query.refs.filter((ref) => ref.startsWith("track:")),
    ...filterRefs.filter((ref) => typeof ref === "string" && ref.startsWith("track:")),
  ]);
}

function queryTakeTrackRefs(query) {
  const filterRefs = [];
  if (typeof query.filters.track_ref === "string") filterRefs.push(query.filters.track_ref);
  if (Array.isArray(query.filters.track_refs)) filterRefs.push(...query.filters.track_refs);
  return unique([
    ...query.refs.filter((ref) => ref.startsWith("track:")),
    ...filterRefs.filter((ref) => typeof ref === "string" && ref.startsWith("track:")),
  ]);
}

function queryTakeItemRefs(query) {
  const filterRefs = [];
  if (typeof query.filters.item_ref === "string") filterRefs.push(query.filters.item_ref);
  if (Array.isArray(query.filters.item_refs)) filterRefs.push(...query.filters.item_refs);
  return unique([
    ...query.refs.filter((ref) => ref.startsWith("item:")),
    ...filterRefs.filter((ref) => typeof ref === "string" && ref.startsWith("item:")),
  ]);
}

function queryFxOwnerRefs(query) {
  const filterRefs = [];
  if (typeof query.filters.owner_ref === "string") filterRefs.push(query.filters.owner_ref);
  if (Array.isArray(query.filters.owner_refs)) filterRefs.push(...query.filters.owner_refs);
  return unique([
    ...query.refs.filter((ref) => ref.startsWith("track:") || ref.startsWith("take:")),
    ...filterRefs.filter((ref) =>
      typeof ref === "string" && (ref.startsWith("track:") || ref.startsWith("take:"))
    ),
  ]);
}

function queryRoutingTrackRefs(query) {
  const filterRefs = [
    ...normalizeFilterRefs(query.filters, "owner_ref", "owner_refs"),
    ...normalizeFilterRefs(query.filters, "source_track_ref", "source_track_refs"),
    ...normalizeFilterRefs(query.filters, "destination_track_ref", "destination_track_refs"),
  ];
  return unique([
    ...query.refs.filter((ref) => ref.startsWith("track:")),
    ...filterRefs.filter((ref) => typeof ref === "string" && ref.startsWith("track:")),
  ]);
}

function selectedContextRefreshRequests(query) {
  return [
    {
      tool: "call_template",
      id: "template.project.create_observation_bundle",
      refs: {},
      input: {
        max_tracks: query.limit,
        max_items_per_track: 0,
        max_selected_items: Math.min(query.limit, 100),
        include_transport: true,
        include_track_items: false,
      },
      purpose: "Refresh selected refs from REAPER truth before using Project SQLite Index selection rows.",
    },
  ];
}

function hydrateRefsRequest(refs, fields, detail = "summary") {
  const input = { refs, fields };
  if (detail !== "summary") input.detail = detail;
  return {
    status: "available",
    callable_now: true,
    tool: "call_template",
    id: "macro.hydrate_refs",
    input,
    planned_macro_id: "macro.hydrate_refs",
    blocker: null,
    refs,
    fields,
    purpose: "Hydrate returned canonical refs through the official plan-only hydrate_refs macro.",
  };
}

function hydrateRefsNextStep(refs, query, catalog) {
  const hydration = catalogBoundHydrationPlan(planHydrateRefs(refs, query), catalog);
  const missingTemplateBlockers = uniqueBlockers(
    hydration.blockers.filter((entry) => entry.code === "MISSING_ACCEPTED_TEMPLATE")
  );
  if (missingTemplateBlockers.length === 0) {
    return hydrateRefsRequest(refs, query.fields, query.detail);
  }
  const input = { refs, fields: query.fields };
  if (query.detail !== "summary") input.detail = query.detail;
  return {
    status: "blocked_by_catalog_drift",
    callable_now: false,
    tool: "call_template",
    id: "macro.hydrate_refs",
    input,
    planned_macro_id: "macro.hydrate_refs",
    blocker: missingTemplateBlockers[0],
    blockers: missingTemplateBlockers,
    refs,
    fields: query.fields,
    purpose: "Hydration depends on missing accepted read templates; do not call macro.hydrate_refs until the runtime catalog drift is fixed.",
  };
}

function markerDetailRequest(refs, fields) {
  return {
    status: "no_supported_exact_hydration",
    callable_now: false,
    tool: "call_template",
    id: null,
    planned_macro_id: "macro.hydrate_refs",
    blocker: {
      code: "HYDRATE_REF_UNSUPPORTED",
      message: "No exact marker/region hydration template is accepted yet; use returned compact marker rows or refresh macro.query_markers.",
    },
    refs,
    fields,
    purpose: "Marker/region query rows are compact by default; deeper exact hydration waits for a dedicated accepted template.",
  };
}

function hydrateRefsRequestEnvelope(requests, refs, fields, blockers = []) {
  if (blockers.length > 0) {
    return {
      status: "blocked",
      callable_now: false,
      planned_macro_id: "macro.hydrate_refs",
      refs,
      fields,
      requests,
      blocker: blockers[0],
      blockers,
      purpose: "Hydration cannot emit executable read requests until the reported blocker is resolved.",
    };
  }
  return {
    status: requests.length > 0 ? "planned_requests" : "no_supported_refs",
    callable_now: requests.length > 0,
    planned_macro_id: "macro.hydrate_refs",
    refs,
    fields,
    requests,
    purpose: "Agent executes these existing call_template read requests when deeper detail is explicitly requested.",
  };
}

function planHydrateRefs(refs, query) {
  const blockers = [];
  if (refs.length === 0) {
    blockers.push(blocker("refs", "HYDRATE_REFS_REQUIRED", "macro.hydrate_refs requires at least one canonical ref."));
  }

  const requests = [];
  const rows = [];
  for (const ref of refs) {
    const kind = refKind(ref);
    const requestGroup = hydrateRequestsForRef(kind, ref, query);
    if (requestGroup.blocker) {
      blockers.push(requestGroup.blocker);
      rows.push({
        ref,
        ref_kind: kind,
        status: "blocked",
        planned_request_ids: [],
      });
      continue;
    }
    for (const request of requestGroup.requests) requests.push(request);
    rows.push({
      ref,
      ref_kind: kind,
      status: "planned",
      planned_request_ids: requestGroup.requests.map((request) => request.id),
    });
  }

  return {
    refs,
    rows,
    requests: dedupeRequestPlans(requests),
    blockers,
  };
}

function hydrateRequestsForRef(kind, ref, query) {
  if (kind === "track") {
    return requestGroup([
      callTemplateRequest({
        id: "template.tracks.resolve_track_ref",
        input: { track_ref: ref },
        purpose: "Re-resolve the track ref against REAPER truth.",
      }),
      callTemplateRequest({
        id: "template.tracks.read_mixer_controls",
        refs: { track_ref: ref },
        input: { limit: 1, include_selected: true },
        purpose: "Read compact mixer controls for the exact track ref.",
      }),
    ]);
  }
  if (kind === "item") {
    return requestGroup([
      callTemplateRequest({
        id: "template.items.read_item_summary",
        refs: { item_ref: ref },
        input: { include_take_summary: query.detail === "hydrated" || query.fields.includes("take_summary") },
        purpose: "Read compact item summary for the exact item ref.",
      }),
    ]);
  }
  if (kind === "take") {
    return requestGroup([
      callTemplateRequest({
        id: "template.media.read_take_source",
        refs: { take_ref: ref },
        input: {
          include_metadata_keys: query.fields.includes("metadata_keys"),
          include_parent_source: query.detail === "hydrated",
        },
        purpose: "Read compact media source information for the exact take ref.",
      }),
    ]);
  }
  if (kind === "fx") {
    const requests = [
      callTemplateRequest({
        id: "template.fx.read_fx_summary",
        refs: { fx_ref: ref },
        input: {},
        purpose: "Read compact FX identity and bypass/preset summary for the exact FX ref.",
      }),
    ];
    if (query.detail === "hydrated" || query.fields.includes("parameters") || query.fields.includes("parameter_metadata")) {
      requests.push(callTemplateRequest({
        id: "template.fx.list_fx_parameters",
        refs: { fx_ref: ref },
        input: { limit: query.limit },
        purpose: "List FX parameter metadata only because parameter fields were explicitly requested.",
      }));
    }
    if (fxPinMappingFieldRequested(query)) {
      return {
        requests: [],
        blocker: blocker(
          "fields",
          "HYDRATE_FIELD_UNSUPPORTED",
          "FX pin mapping hydration requires explicit direction and pin_index, so macro.hydrate_refs cannot infer a valid exact read from fx_ref alone.",
        ),
      };
    }
    return requestGroup(requests);
  }
  if (kind === "send") {
    const requests = [
      callTemplateRequest({
        id: "template.routing.resolve_send_ref",
        input: { send_ref: ref },
        purpose: "Re-resolve the send ref against REAPER truth.",
      }),
    ];
    const sourceTrackRef = sourceTrackRefFromSendRef(ref);
    if (sourceTrackRef !== null) {
      requests.push(callTemplateRequest({
        id: "template.routing.read_track_routing",
        refs: { track_ref: sourceTrackRef },
        input: { include_receives: true, include_master_parent: false, max_routes: query.limit },
        purpose: "Read source-track routing so the exact send ref can be verified against REAPER truth.",
      }));
    }
    return requestGroup(requests);
  }
  if (kind === "envelope") {
    return requestGroup([
      callTemplateRequest({
        id: "template.automation.read_envelope_summary",
        refs: { envelope_ref: ref },
        input: {},
        purpose: "Read compact automation envelope summary for the exact envelope ref.",
      }),
    ]);
  }
  if (kind === "file") {
    const path = filePathFromRef(ref);
    if (path === null) {
      return {
        requests: [],
        blocker: blocker("refs", "HYDRATE_REF_UNSUPPORTED", `No accepted exact hydration template is mapped for non-path file ref ${ref}.`),
      };
    }
    return requestGroup([
      callTemplateRequest({
        id: "template.media.probe_file",
        input: {
          path,
          include_metadata_keys: query.detail === "hydrated" || query.fields.includes("metadata_keys") || query.fields.includes("metadata_key_count"),
        },
        purpose: "Probe exact media file facts through the accepted media probe template.",
      }),
    ]);
  }
  return {
    requests: [],
    blocker: blocker("refs", "HYDRATE_REF_UNSUPPORTED", `No accepted exact hydration template is mapped for ref ${ref}.`),
  };
}

function requestGroup(requests) {
  return {
    requests,
    blocker: null,
  };
}

function callTemplateRequest({ id, refs = {}, input = {}, purpose }) {
  return {
    tool: "call_template",
    id,
    refs,
    input,
    purpose,
  };
}

function dedupeRequestPlans(requests) {
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

function catalogBoundRequestPlans(requests, catalog) {
  const deduped = dedupeRequestPlans(requests);
  const blockers = [];
  const result = [];
  for (const request of deduped) {
    const missingTemplateIds = missingCatalogTemplateIdsForRequest(request, catalog);
    if (missingTemplateIds.length > 0) {
      for (const templateId of missingTemplateIds) {
        blockers.push(blocker("template", "MISSING_ACCEPTED_TEMPLATE", `Required refresh template ${templateId} is not accepted.`));
      }
      continue;
    }
    result.push(request);
  }
  return {
    requests: result,
    blockers,
  };
}

function catalogBoundHydrationPlan(hydration, catalog) {
  const bound = catalogBoundRequestPlans(hydration.requests, catalog);
  const allowedKeys = new Set(bound.requests.map((request) => JSON.stringify([request.id, request.refs, request.input])));
  const rows = hydration.rows.map((row) => {
    const plannedRequestIds = [];
    for (const request of hydration.requests) {
      if (!row.planned_request_ids.includes(request.id)) continue;
      const key = JSON.stringify([request.id, request.refs, request.input]);
      if (allowedKeys.has(key) && !plannedRequestIds.includes(request.id)) {
        plannedRequestIds.push(request.id);
      }
    }
    const lostRequest = plannedRequestIds.length !== row.planned_request_ids.length;
    const status = row.status === "planned" && lostRequest
      ? plannedRequestIds.length > 0 ? "partial" : "blocked"
      : row.status;
    return {
      ...row,
      status,
      planned_request_ids: plannedRequestIds,
    };
  });
  return {
    ...hydration,
    rows,
    requests: bound.requests,
    blockers: [
      ...hydration.blockers,
      ...bound.blockers,
    ],
  };
}

function missingCatalogTemplateIdsForRequest(request, catalog) {
  const ids = [];
  if (request?.id && !catalogHasTemplate(catalog, request.id)) ids.push(request.id);
  for (const dependencyId of Array.isArray(request?.depends_on) ? request.depends_on : []) {
    if (!catalogHasTemplate(catalog, dependencyId)) ids.push(dependencyId);
  }
  return unique(ids);
}

function catalogHasTemplate(catalog, templateId) {
  if (!templateId || !catalog || typeof catalog.get !== "function") return true;
  return catalog.get(templateId) !== null;
}

function refKind(ref) {
  if (typeof ref !== "string") return "unknown";
  const lower = ref.toLocaleLowerCase();
  if (lower.startsWith("track:")) return "track";
  if (lower.startsWith("item:")) return "item";
  if (lower.startsWith("take:")) return "take";
  if (lower.startsWith("fx:")) return "fx";
  if (lower.startsWith("send:")) return "send";
  if (lower.startsWith("envelope:")) return "envelope";
  if (lower.startsWith("marker:")) return "marker";
  if (lower.startsWith("region:")) return "region";
  if (lower.startsWith("file:")) return "file";
  return "unknown";
}

function isStockReaperPlugin(row) {
  const identity = `${row.plugin_name ?? ""} ${row.plugin_id ?? ""}`.toLocaleLowerCase();
  return [
    "reaeq",
    "reacomp",
    "reagate",
    "readelay",
    "reasynth",
    "reasamplomatic",
    "rs5k",
    "reatune",
    "reapitch",
    "reaxcomp",
    "realimit",
  ].some((token) => identity.includes(token));
}

function fxOffline(row) {
  return Boolean(row.summary?.offline ?? row.summary?.is_offline);
}

function fxParameterSummaryAvailable(row) {
  if (row.summary?.parameter_summary_available !== undefined) {
    return Boolean(row.summary.parameter_summary_available);
  }
  if (Number.isInteger(row.summary?.parameter_count)) return true;
  return Array.isArray(row.summary?.parameters);
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

function itemLengthSeconds(row) {
  if (Number.isFinite(row.length_seconds)) return row.length_seconds;
  if (Number.isFinite(row.start_seconds) && Number.isFinite(row.end_seconds)) {
    return Math.max(0, row.end_seconds - row.start_seconds);
  }
  return null;
}

function markerRegionLengthSeconds(row) {
  if (Number.isFinite(row.length_seconds)) return row.length_seconds;
  if (Number.isFinite(row.position_seconds) && Number.isFinite(row.end_seconds)) {
    return Math.max(0, row.end_seconds - row.position_seconds);
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

function sourceTrackRefFromSendRef(ref) {
  if (typeof ref !== "string") return null;
  const match = ref.match(/^send:(track:.+):\d+$/);
  if (!match) return null;
  const sourceTrackRef = match[1];
  const numericIndex = sourceTrackRef.match(/^track:([0-9]+)$/);
  return numericIndex ? `track:index:${numericIndex[1]}` : sourceTrackRef;
}

function fxPinMappingFieldRequested(query) {
  return query.fields.includes("pin_mapping")
    || query.fields.includes("routing")
    || query.fields.includes("io_pins");
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

function queryItemsDecisionSummary({ blockers, rows, itemScope }) {
  if (blockers.length > 0) {
    return "Item query needs a task-scoped item refresh before rows are safe to use.";
  }
  return `Item query returned ${rows.rows.length} compact rows with ${itemScope.status} freshness and ${itemScope.coverage_status} coverage.`;
}

function queryTakesDecisionSummary({ blockers, rows, takeScope }) {
  if (blockers.length > 0) {
    return "Take query needs a task-scoped take refresh before rows are safe to use.";
  }
  return `Take query returned ${rows.rows.length} compact rows with ${takeScope.status} freshness and ${takeScope.coverage_status} coverage.`;
}

function queryFxDecisionSummary({ blockers, rows, fxScope }) {
  if (blockers.length > 0) {
    return "FX query needs a task-scoped FX refresh before rows are safe to use.";
  }
  return `FX query returned ${rows.rows.length} compact rows with ${fxScope.status} freshness and ${fxScope.coverage_status} coverage.`;
}

function queryRoutingDecisionSummary({ blockers, rows, routingScope }) {
  if (blockers.length > 0) {
    return "Routing query needs a task-scoped routing refresh before send rows are safe to use.";
  }
  return `Routing query returned ${rows.rows.length} compact send rows with ${routingScope.status} freshness and ${routingScope.coverage_status} coverage.`;
}

function queryMarkersDecisionSummary({ blockers, rows, markersScope }) {
  if (blockers.length > 0) {
    return "Marker query needs a task-scoped marker/region refresh before rows are safe to use.";
  }
  return `Marker query returned ${rows.rows.length} compact marker/region rows with ${markersScope.status} freshness and ${markersScope.coverage_status} coverage.`;
}

function queryMediaDecisionSummary({ blockers, rows, mediaScope }) {
  if (blockers.length > 0) {
    return "Media query needs a task-scoped project-media refresh before rows are safe to use.";
  }
  return `Media query returned ${rows.rows.length} compact media rows with ${mediaScope.status} freshness and ${mediaScope.coverage_status} coverage.`;
}

function selectedContextDecisionSummary({ blockers, rows, selectionScope }) {
  if (blockers.length > 0) {
    return "Selected-context query needs a task-scoped selection refresh before refs are safe to use.";
  }
  return `Selected-context query returned ${rows.rows.length} compact refs with ${selectionScope.status} freshness and ${selectionScope.coverage_status} coverage.`;
}

function hydrateRefsDecisionSummary({ blockers, hydration }) {
  if (blockers.length > 0) {
    return `Hydrate refs planned ${hydration.requests.length} accepted read requests, but ${blockers.length} blockers need attention.`;
  }
  return `Hydrate refs planned ${hydration.requests.length} accepted read requests for ${hydration.refs.length} refs.`;
}

function changedSinceDecisionSummary({ blockers, changes, since }) {
  if (blockers.length > 0) {
    return "Changed-since query needs a ready Project Index before changes are safe to use.";
  }
  const sinceText = since === null ? "the beginning of the task index" : since;
  return `Changed-since query returned ${changes.rows.length} compact change rows since ${sinceText}.`;
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
        input: queryMacroExampleInput(macro.id),
        refs: {},
      },
    ],
    live_runnable_now: true,
    exists_in_catalog: true,
    evidence_level: implemented ? "runtime_bound_static_fake" : "contract_only",
    support_state: implemented ? "supported" : "blocked",
    known_blocker: implemented ? null : "planned_after_c3_8",
    allowed_live_group: null,
  });
}

function queryMacroExampleInput(id) {
  if (id === "macro.query_tracks") return { filters: { selected: true }, limit: 25 };
  if (id === "macro.query_items") return { scope: "selection", filters: { selected: true }, limit: 25 };
  if (id === "macro.query_takes") return { scope: "selection", filters: { active: true }, limit: 25 };
  if (id === "macro.query_fx") return { filters: { stock_plugin: true }, limit: 25 };
  if (id === "macro.query_routing") return { scope: "tracks", filters: { source_track_ref: "track:guid:{TRACK-GUID}" }, limit: 25 };
  if (id === "macro.query_markers") return { filters: { marker_kind: "region" }, time_range: { start_seconds: 0, end_seconds: 120 }, limit: 25 };
  if (id === "macro.query_media") return { filters: { media_type: "audio", offline: false }, limit: 25 };
  if (id === "macro.selected_context") return { scope: "selection", limit: 25 };
  if (id === "macro.changed_since") return { since: "2026-07-07T00:00:00.000Z", limit: 25 };
  if (id === "macro.hydrate_refs") return { refs: ["track:guid:{TRACK-GUID}"], detail: "summary" };
  return { scope: "project" };
}

function sharedQueryInputContract() {
  return deepFreeze({
    scope: "project|selection|tracks|items|takes|fx|routing|automation|markers|media",
    refs: "optional exact canonical refs",
    filters: "bounded JSON object filters; no raw SQL",
    fields: "optional compact field names",
    detail: "summary|refs|compact|hydrated",
    since: "optional ISO timestamp for changed_since",
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
      since: { type: "string" },
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

function normalizeSince(value, blockers) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || value.trim() === "") {
    blockers.push(blocker("since", "CHANGED_SINCE_INVALID", "since must be an ISO timestamp string."));
    return null;
  }
  if (Number.isNaN(Date.parse(value))) {
    blockers.push(blocker("since", "CHANGED_SINCE_INVALID", "since must be a valid ISO timestamp string."));
    return null;
  }
  return value;
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
