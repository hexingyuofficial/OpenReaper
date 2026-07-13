import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogAlpha3C3Templates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";
import {
  createAlpha3C3ProjectIndexSchemaContract as createAlpha3C3ProjectIndexStoreSchemaContract,
} from "./alpha3-c3-project-index-store-v1.mjs";
import {
  createAlpha3L3ProjectIndexUserFlow,
} from "./alpha3-l3-project-index-user-flow-v1.mjs";

export const ALPHA3_C3_PROJECT_INDEX_CONTRACT = "alpha3.c3.project_sqlite_index.v1";
export const ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT = "alpha3.c3.project_index_query_macros.v1";
export const ALPHA3_C3_PROJECT_INDEX_SCHEMA_CONTRACT = "alpha3.c3.project_index_schema.v1";

export const ALPHA3_C3_PROJECT_INDEX_DB_PATH = "run_root/state/openreaper-project-index.sqlite";

export const ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT = "alpha3.2.generic_project_query.v1";
export const ALPHA3_2D_GENERIC_PROJECT_QUERY_ID = "macro.project.query";
export const ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES = deepFreeze([
  "status",
  "selected_context",
  "tracks",
  "items",
  "takes",
  "fx",
  "routing",
  "automation",
  "markers_regions",
  "media_sources",
  "duplicates",
  "changed_since",
]);
export const ALPHA3_2D_COVERED_LEGACY_QUERY_IDS = deepFreeze([
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
]);
export const ALPHA3_2D_INTERNAL_LEGACY_QUERY_IDS = deepFreeze(
  ALPHA3_2D_COVERED_LEGACY_QUERY_IDS.filter((id) => id !== "macro.selected_context"),
);
export const ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT = deepFreeze({
  id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
  covers_legacy_ids: ALPHA3_2D_COVERED_LEGACY_QUERY_IDS,
  replaces_public_ids: ALPHA3_2D_INTERNAL_LEGACY_QUERY_IDS,
  temporary_compatibility_ids: ["macro.selected_context"],
  legacy_posture: "internal_covered_not_public",
  runtime_posture: "registered_executable_macro_program",
});

export const ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_C3_PROJECT_INDEX_QUERY_MACROS_CONTRACT,
  mode: "executable_project_index_query_macro",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "query",
  action_kind: "macro",
  execution_shape: "registered_macro_program",
  storage: {
    kind: "project_sqlite_index",
    default_path: ALPHA3_C3_PROJECT_INDEX_DB_PATH,
    truth_source: "REAPER_project_state",
    cache_role: "query_navigation_freshness_cache",
  },
  macro_ids: [ALPHA3_2D_GENERIC_PROJECT_QUERY_ID],
  implemented_macro_ids: [ALPHA3_2D_GENERIC_PROJECT_QUERY_ID],
  covered_legacy_ids: ALPHA3_2D_COVERED_LEGACY_QUERY_IDS,
  internal_legacy_ids: ALPHA3_2D_INTERNAL_LEGACY_QUERY_IDS,
  temporary_compatibility_ids: ["macro.selected_context"],
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
  "template.automation.list_project_envelopes",
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

const AUTOMATION_ROW_FIELDS = deepFreeze([
  "ref",
  "owner_ref",
  "target_ref",
  "parent_kind",
  "name",
  "lane_kind",
  "active",
  "armed",
  "visible",
  "show_lane",
  "point_count",
  "automation_item_count",
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
  queryMacro({
    id: "macro.query_automation",
    user_label: "Query automation",
    summary: "Query compact automation envelope rows from the Project SQLite Index by owner refs, parent kind, envelope name, lane state, and point/automation-item presence.",
    status: "implemented",
    query_kind: "automation",
    task_intents: ["find automation", "find envelopes", "visible automation", "armed envelopes", "large project automation query"],
    tags: ["project_index", "sqlite", "query", "automation", "envelopes", "alpha3_c3"],
    required_templates: [
      "template.automation.list_project_envelopes",
      "template.automation.read_envelope_summary",
    ],
  }),
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
  if (macro.id === "macro.query_automation") {
    return queryAutomationPlan({ macro, normalized, indexState, blockers, catalog });
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
        reason: "Legacy C3 compatibility query envelopes remain plan-only. The public macro.project.query route is a separate registered executable program; neither route exposes raw SQL or write authority.",
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
      next_actions: normalizedPlan.next_actions,
      user_flow: normalizedPlan.user_flow,
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
    ? catalogBoundRequestPlans(queryTakeRefreshRequests(normalized.query, indexState), catalog)
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
    ? catalogBoundRequestPlans(queryFxRefreshRequests(normalized.query, indexState), catalog)
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

function queryAutomationPlan({ macro, normalized, indexState, blockers, catalog }) {
  const automationScope = freshnessScope(indexState, "automation");
  const indexReadinessBlockers = queryReadinessBlockers(indexState, automationScope, normalized.query.freshness);
  const allBlockers = [
    ...blockers,
    ...validateAutomationScope(normalized.query.scope),
    ...validateAutomationFields(normalized.query.fields),
    ...indexReadinessBlockers,
  ];
  const rows = allBlockers.length === 0
    ? queryAutomationRows(indexState.rows.envelopes, normalized.query)
    : { rows: [], next_cursor: null, refs: [] };
  const refreshPlan = allBlockers.some((entry) =>
    entry.code === "INDEX_REFRESH_REQUIRED" || entry.code === "INDEX_NOT_READY"
  )
    ? catalogBoundRequestPlans(queryAutomationRefreshRequests(normalized.query), catalog)
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
    decision_summary: queryAutomationDecisionSummary({ blockers: finalBlockers, rows, automationScope }),
    rows: rows.rows,
    refs: rows.refs,
    freshness: {
      scope: "automation",
      status: automationScope.status,
      coverage_status: automationScope.coverage_status,
      observed_at: automationScope.observed_at,
      required: normalized.query.freshness.require,
      refresh_policy: normalized.query.freshness.refresh,
    },
    coverage: {
      status: automationScope.coverage_status,
      source_scope: "automation",
      row_count: rows.rows.length,
      complete: automationScope.coverage_status === "complete",
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
        ok: false,
        blockers: [],
        refs: [],
        rows: [],
        page: pageEnvelope(normalized.query.limit, normalized.query.cursor),
        freshness: {
          source: "project_index_object_changes",
          sqlite_is_truth: false,
        },
      };
  const finalBlockers = [
    ...allBlockers,
    ...(Array.isArray(changes.blockers) ? changes.blockers : []),
  ];

  return deepFreeze(basePlan({
    macro,
    normalized,
    indexState,
    ok: finalBlockers.length === 0 && changes.ok !== false,
    decision_summary: changedSinceDecisionSummary({ blockers: finalBlockers, changes, since: normalized.query.since }),
    rows: changes.rows,
    refs: changes.refs,
    freshness: {
      ...changes.freshness,
      lifecycle: indexState.lifecycle,
      since: normalized.query.since,
    },
    coverage: {
      status: finalBlockers.length === 0 ? "complete" : "failed",
      source_scope: "object_changes",
      row_count: changes.rows.length,
      complete: finalBlockers.length === 0,
    },
    page: changes.page,
    refresh_requests: [],
    hydrate_request: changes.refs.length > 0
      ? hydrateRefsNextStep(changes.refs, normalized.query, catalog)
      : null,
    blockers: finalBlockers,
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
  const uniquePlanBlockers = uniqueBlockers(blockers);
  const next_actions = projectIndexNextActions({
    id: macro.id,
    input: normalized.query,
    refs,
    page,
    refresh_requests,
    hydrate_request,
    blockers: uniquePlanBlockers,
  });

  const plan = {
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
    next_actions,
    user_flow: null,
    query_policy: {
      default_output: "decision_summary + canonical refs + freshness + coverage + compact rows",
      deep_detail_requires: ["fields", "detail", "time_range", "hydrate_refs"],
      raw_sql_exposed: false,
      sqlite_authorizes_writes: false,
    },
    write_safety_loop: projectIndexWriteSafetyLoop(),
    safety: projectIndexSafety(),
    index_status,
    blockers: uniquePlanBlockers,
  };
  plan.user_flow = createAlpha3L3ProjectIndexUserFlow(plan);
  return plan;
}

function projectIndexNextActions({
  id,
  input = {},
  refs = [],
  page = pageEnvelope(25),
  refresh_requests = [],
  hydrate_request = null,
  blockers = [],
}) {
  const actions = [];
  const blockerCodes = unique(blockers.map((entry) => entry.code));
  const nonRefreshBlockerCodes = unique(
    blockerCodes.filter((code) => code !== "INDEX_NOT_READY" && code !== "INDEX_REFRESH_REQUIRED")
  );
  const hydrateBlockers = hydrateRequestBlockers(hydrate_request);
  const hydrateBlockerCodes = unique(hydrateBlockers.map((entry) => entry.code));
  const refreshResolvable = nonRefreshBlockerCodes.length === 0;
  if (refresh_requests.length > 0) {
    if (!refreshResolvable) {
      actions.push(resolveBlockersNextAction(nonRefreshBlockerCodes));
    }
    actions.push({
      kind: "run_refresh_requests",
      status: refreshResolvable ? "available" : "partial_blocked",
      tool: "call_template",
      request_count: refresh_requests.length,
      request_ids: refresh_requests.map((request) => request.id),
      then: "update_project_index_from_readback_and_rerun_macro",
      blocker_codes: refreshResolvable ? [] : nonRefreshBlockerCodes,
      purpose: refreshResolvable
        ? "Refresh the task-scoped Project SQLite Index from REAPER truth before relying on returned rows."
        : "Some refresh requests are available, but non-refresh blockers must be resolved before this macro can become safe.",
    });
  } else if (blockers.length > 0) {
    actions.push(resolveBlockersNextAction(blockerCodes));
  }

  if (page?.has_more) {
    actions.push({
      kind: "page_next",
      status: blockers.length === 0 ? "available" : "blocked_until_blockers_clear",
      tool: "call_template",
      id,
      input: {
        ...cloneJson(input),
        limit: page.limit,
        cursor: page.next_cursor,
      },
      purpose: "Fetch the next compact page with the same query macro instead of requesting a full project dump.",
    });
  }

  if (hydrate_request) {
    actions.push({
      kind: "hydrate_refs",
      status: hydrate_request.callable_now ? "available" : "blocked",
      tool: hydrate_request.id === null ? null : "call_template",
      id: hydrate_request.id,
      input: hydrate_request.input ?? {
        refs: hydrate_request.refs ?? refs,
        fields: hydrate_request.fields ?? [],
      },
      request_count: Array.isArray(hydrate_request.requests) ? hydrate_request.requests.length : null,
      blocker: hydrate_request.blocker ?? null,
      blockers: hydrateBlockers,
      blocker_codes: hydrateBlockerCodes,
      purpose: hydrate_request.callable_now
        ? "Only hydrate when deeper detail is explicitly needed; compact rows are enough for scan/query decisions."
        : hydrate_request.purpose,
    });
  }

  if (refs.length > 0 && blockers.length === 0) {
    const reResolveBlocked = hydrate_request !== null && hydrate_request.callable_now === false;
    actions.push({
      kind: "before_write_or_mutation",
      status: reResolveBlocked ? "blocked_until_ref_re_resolve_available" : "required_for_writes",
      sequence: projectIndexWriteSafetyLoop().required_sequence,
      blocker_codes: reResolveBlocked ? hydrateBlockerCodes : [],
      purpose: reResolveBlocked
        ? "Project SQLite Index refs are candidates only; resolve the blocked ref hydration/re-resolve path before planning writes."
        : "Project SQLite Index refs are candidates only; writes must re-resolve in REAPER and verify with readback.",
    });
  }

  if (actions.length === 0) {
    actions.push({
      kind: "no_followup_required",
      status: "complete",
      purpose: "Use the decision summary and compact rows; request deeper detail only when the task needs it.",
    });
  }

  return deepFreeze(actions);
}

function hydrateRequestBlockers(hydrate_request) {
  if (!hydrate_request) return [];
  const blockers = [];
  if (hydrate_request.blocker) blockers.push(hydrate_request.blocker);
  if (Array.isArray(hydrate_request.blockers)) blockers.push(...hydrate_request.blockers);
  return uniqueBlockers(blockers);
}

function resolveBlockersNextAction(blockerCodes) {
  return {
    kind: "resolve_blockers",
    status: "blocked",
    blocker_codes: unique(blockerCodes),
    purpose: "Resolve the reported blocker before using Project SQLite Index rows or child requests.",
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
      envelopes: Array.isArray(raw.rows?.envelopes)
        ? raw.rows.envelopes.map(normalizeAutomationRow).filter(Boolean)
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

function normalizeAutomationRow(row) {
  const source = isPlainObject(row) ? row : {};
  const ref = typeof source.ref === "string" && source.ref
    ? source.ref
    : typeof source.envelope_ref === "string" && source.envelope_ref
      ? source.envelope_ref
      : null;
  if (ref === null) return null;
  const summary = isPlainObject(source.summary) ? cloneJson(source.summary) : {};
  const ownerRef = typeof source.owner_ref === "string"
    ? source.owner_ref
    : typeof source.parent_ref === "string"
      ? source.parent_ref
      : typeof source.track_ref === "string"
        ? source.track_ref
        : typeof summary.owner_ref === "string"
          ? summary.owner_ref
          : typeof summary.parent_ref === "string"
            ? summary.parent_ref
            : null;
  return {
    ref,
    owner_ref: ownerRef,
    target_ref: typeof source.target_ref === "string"
      ? source.target_ref
      : typeof source.fx_ref === "string"
        ? source.fx_ref
        : typeof source.send_ref === "string"
          ? source.send_ref
          : typeof summary.target_ref === "string"
            ? summary.target_ref
            : null,
    parent_kind: typeof source.parent_kind === "string"
      ? source.parent_kind
      : typeof summary.parent_kind === "string"
        ? summary.parent_kind
        : ownerRef === null
          ? "unknown"
          : refKind(ownerRef),
    name: typeof source.name === "string"
      ? source.name
      : typeof summary.name === "string"
        ? summary.name
        : "",
    lane_kind: typeof source.lane_kind === "string"
      ? source.lane_kind
      : typeof source.envelope_kind === "string"
        ? source.envelope_kind
        : typeof summary.lane_kind === "string"
          ? summary.lane_kind
          : typeof summary.envelope_kind === "string"
            ? summary.envelope_kind
            : null,
    active: nullableBoolean(source.active, summary.active),
    armed: nullableBoolean(source.armed, summary.armed),
    visible: nullableBoolean(source.visible, summary.visible),
    show_lane: nullableBoolean(source.show_lane, summary.show_lane),
    point_count: Number.isInteger(source.point_count)
      ? source.point_count
      : Number.isInteger(summary.point_count)
        ? summary.point_count
        : 0,
    automation_item_count: Number.isInteger(source.automation_item_count)
      ? source.automation_item_count
      : Number.isInteger(summary.automation_item_count)
        ? summary.automation_item_count
        : 0,
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
    const adapterBlockers = Array.isArray(result?.blockers)
      ? result.blockers.map((entry) => normalizeAdapterBlocker(entry, "CHANGED_SINCE_ADAPTER_BLOCKED"))
      : [];
    if (result?.ok === false || adapterBlockers.length > 0) {
      return {
        ok: false,
        blockers: adapterBlockers.length > 0
          ? adapterBlockers
          : [blocker("changed_since", "CHANGED_SINCE_ADAPTER_BLOCKED", "Project Index changed-since adapter reported a blocked result.")],
        refs: [],
        rows: [],
        page: pageEnvelope(query.limit, query.cursor),
        freshness: result?.freshness ?? {
          source: "project_index_object_changes",
          sqlite_is_truth: false,
        },
      };
    }
    return {
      ok: true,
      blockers: [],
      refs: Array.isArray(result?.refs) ? result.refs : [],
      rows: Array.isArray(result?.rows) ? result.rows.map(projectObjectChangeRow) : [],
      page: result?.page ?? pageEnvelope(query.limit, query.cursor),
      freshness: result?.freshness ?? {
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
    ok: true,
    blockers: [],
    refs: pageRows.map((row) => row.ref),
    rows: pageRows.map(projectObjectChangeRow),
    page: pageEnvelope(query.limit, query.cursor, nextOffset === null ? null : encodeCursor(nextOffset)),
    freshness: {
      source: "project_index_object_changes",
      sqlite_is_truth: false,
    },
  };
}

function normalizeAdapterBlocker(entry, fallbackCode) {
  if (!isPlainObject(entry)) {
    return blocker("adapter", fallbackCode, "Project Index adapter reported an unstructured blocker.");
  }
  return deepFreeze({
    field: typeof entry.field === "string" ? entry.field : "adapter",
    code: typeof entry.code === "string" && entry.code ? entry.code : fallbackCode,
    message: typeof entry.message === "string" && entry.message
      ? entry.message
      : "Project Index adapter reported a blocked result.",
    recoverable: entry.recoverable !== false,
  });
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

function queryAutomationRows(automationRows, query) {
  const offset = query.cursor === null ? 0 : decodeCursor(query.cursor);
  const filtered = automationRows
    .filter((row) => row.ref)
    .filter((row) => automationRowMatches(row, query));
  const pageRows = filtered.slice(offset, offset + query.limit);
  const nextOffset = offset + pageRows.length < filtered.length ? offset + pageRows.length : null;
  return {
    rows: pageRows.map((row) => projectAutomationRow(row, query.fields)),
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

function automationRowMatches(row, query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  if (query.refs.length > 0 && !automationRefsMatch(row, query.refs)) return false;
  const ownerRefs = normalizeFilterRefs(filters, "owner_ref", "owner_refs");
  if (ownerRefs.length > 0 && !ownerRefs.includes(row.owner_ref)) return false;
  const targetRefs = normalizeFilterRefs(filters, "target_ref", "target_refs");
  if (targetRefs.length > 0 && !targetRefs.includes(row.target_ref)) return false;
  if (typeof filters.parent_kind === "string" && filters.parent_kind !== row.parent_kind) return false;
  if (typeof filters.name === "string" && !row.name.toLocaleLowerCase().includes(filters.name.toLocaleLowerCase())) return false;
  if (typeof filters.lane_kind === "string" && String(row.lane_kind ?? "").toLocaleLowerCase() !== filters.lane_kind.toLocaleLowerCase()) return false;
  if (typeof filters.envelope_kind === "string" && String(row.lane_kind ?? "").toLocaleLowerCase() !== filters.envelope_kind.toLocaleLowerCase()) return false;
  if (filters.active !== undefined && (row.active === null || Boolean(filters.active) !== row.active)) return false;
  if (filters.armed !== undefined && (row.armed === null || Boolean(filters.armed) !== row.armed)) return false;
  if (filters.visible !== undefined && (row.visible === null || Boolean(filters.visible) !== row.visible)) return false;
  if (filters.show_lane !== undefined && (row.show_lane === null || Boolean(filters.show_lane) !== row.show_lane)) return false;
  if (filters.has_points !== undefined && Boolean(filters.has_points) !== (row.point_count > 0)) return false;
  if (filters.has_automation_items !== undefined && Boolean(filters.has_automation_items) !== (row.automation_item_count > 0)) return false;
  if (Number.isFinite(filters.min_point_count) && row.point_count < filters.min_point_count) return false;
  if (Number.isFinite(filters.max_point_count) && row.point_count > filters.max_point_count) return false;
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

function automationRefsMatch(row, refs) {
  return refs.includes(row.ref) || refs.includes(row.owner_ref) || refs.includes(row.target_ref);
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

function projectAutomationRow(row, fields) {
  const selectedFields = fields.length > 0 ? unique(["ref", ...fields]) : [
    "ref",
    "owner_ref",
    "parent_kind",
    "name",
    "lane_kind",
    "active",
    "armed",
    "visible",
    "point_count",
    "automation_item_count",
    "freshness_status",
    "coverage_status",
  ];
  const projected = {};
  for (const field of selectedFields) {
    if (AUTOMATION_ROW_FIELDS.includes(field)) projected[field] = row[field];
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

function validateAutomationScope(scope) {
  if (["project", "automation", "tracks", "takes", "fx", "routing"].includes(scope)) return [];
  return [blocker("scope", "QUERY_SCOPE_UNSUPPORTED", "query_automation supports project, automation, tracks, takes, fx, or routing scope.")];
}

function validateAutomationFields(fields) {
  return fields
    .filter((field) => !AUTOMATION_ROW_FIELDS.includes(field))
    .map((field) => blocker("fields", "QUERY_FIELD_NOT_SUPPORTED", `query_automation does not expose field ${field}.`));
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
        include_selected: false,
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

function queryTakeRefreshRequests(query, indexState = null) {
  const trackRefs = queryTakeTrackRefs(query);
  const indexedItemRefs = trackRefs.length === 0
    ? (Array.isArray(indexState?.rows?.items) ? indexState.rows.items : []).map((row) => row.ref).filter(Boolean).slice(0, query.limit)
    : [];
  const itemRefs = unique([...queryTakeItemRefs(query), ...indexedItemRefs]);
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

function queryFxRefreshRequests(query, indexState = null) {
  const explicitOwnerRefs = queryFxOwnerRefs(query);
  const indexedTrackRefs = explicitOwnerRefs.length === 0
    ? (Array.isArray(indexState?.rows?.tracks) ? indexState.rows.tracks : []).map((row) => row.ref).filter(Boolean).slice(0, query.limit)
    : [];
  const ownerRefs = unique([...explicitOwnerRefs, ...indexedTrackRefs]);
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
        include_selected: false,
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

function queryAutomationRefreshRequests(query) {
  const filters = isPlainObject(query.filters) ? query.filters : {};
  const parentKinds = typeof filters.parent_kind === "string"
    ? [filters.parent_kind]
    : Array.isArray(filters.parent_kinds)
      ? filters.parent_kinds.filter((entry) => typeof entry === "string" && entry.trim())
      : ["track", "take", "send", "fx"];
  const requests = [
    {
      tool: "call_template",
      id: "template.automation.list_project_envelopes",
      refs: {},
      input: {
        parent_kinds: unique(parentKinds),
        only_visible: typeof filters.visible === "boolean" ? filters.visible : undefined,
        only_armed: typeof filters.armed === "boolean" ? filters.armed : undefined,
        limit: query.limit,
      },
      purpose: "Refresh compact project automation envelope candidates from REAPER truth before using Project SQLite Index automation rows.",
    },
  ];

  for (const envelopeRef of query.refs.filter((ref) => ref.startsWith("envelope:"))) {
    requests.push({
      tool: "call_template",
      id: "template.automation.read_envelope_summary",
      refs: { envelope_ref: envelopeRef },
      input: {},
      purpose: "Re-read an exact envelope ref from REAPER truth before using indexed automation rows.",
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

function queryAutomationDecisionSummary({ blockers, rows, automationScope }) {
  if (blockers.length > 0) {
    return "Automation query needs a task-scoped automation envelope refresh before rows are safe to use.";
  }
  return `Automation query returned ${rows.rows.length} compact envelope rows with ${automationScope.status} freshness and ${automationScope.coverage_status} coverage.`;
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
    live_runnable_now: false,
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
  if (id === "macro.query_automation") return { filters: { visible: true, has_points: true }, fields: ["owner_ref", "name", "point_count"], limit: 25 };
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
    next_actions: "ordered agent/user next steps for refresh, paging, hydration, blocker recovery, and write safety",
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

const GENERIC_QUERY_REFRESH_POLICIES = new Set(["never", "if_stale", "required", "force_read_only_refresh"]);
const GENERIC_QUERY_TOP_LEVEL_KEYS = new Set([
  "entity", "filters", "fields", "selectors", "refresh_policy", "hydrate_refs", "cursor", "limit",
]);
const GENERIC_QUERY_SELECTOR_KEYS = new Set([
  "refs", "ref", "selected", "name", "track_ref", "track_refs", "item_ref", "item_refs",
  "owner_ref", "owner_refs", "source_ref", "source_path", "path_fingerprint", "time_range", "since",
]);
const GENERIC_QUERY_MAX_OBJECT_KEYS = 32;
const GENERIC_QUERY_MAX_ARRAY_VALUES = 100;
const GENERIC_QUERY_MAX_STRING_BYTES = 512;
const GENERIC_QUERY_MAX_NESTING_DEPTH = 8;
const GENERIC_QUERY_MAX_NORMALIZED_NODES = 512;
const GENERIC_QUERY_CURSOR_VERSION = 2;
const GENERIC_QUERY_DUPLICATE_FIELDS = new Set([
  "duplicate_key", "count", "refs", "owner_refs", "source_path", "path_fingerprint", "freshness", "coverage",
]);
const GENERIC_QUERY_ENTITY_TO_LEGACY_ID = deepFreeze({
  status: "macro.index_status",
  selected_context: "macro.selected_context",
  tracks: "macro.query_tracks",
  items: "macro.query_items",
  takes: "macro.query_takes",
  fx: "macro.query_fx",
  routing: "macro.query_routing",
  automation: "macro.query_automation",
  markers_regions: "macro.query_markers",
  media_sources: "macro.query_media",
  changed_since: "macro.changed_since",
});

export function createAlpha3_2DGenericProjectQueryDiscoveryItems(options = {}) {
  const liveRunnableNow = options.liveRunnableNow === true;
  return [deepFreeze({
    id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
    title: "Query current project index",
    summary: "Execute one bounded Project SQLite Index query with automatic read-only hydration when needed.",
    pack: "core",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
    tags: ["macro", "project_index", "sqlite", "query", "alpha3_2_5_b", "executable"],
    kind: "macro",
    action_kind: "macro",
    macro_kind: "generic_project_query",
    menu_group: "primary_query",
    execution_shape: "registered_macro_program",
    support_status: "executable_runtime_bound",
    support_state: "supported",
    exists_in_catalog: true,
    live_runnable_now: liveRunnableNow,
    evidence_level: liveRunnableNow ? "runtime_bound_live_route" : "runtime_bound_product_store",
    known_blocker: liveRunnableNow ? null : "live_executor_not_configured",
    allowed_live_group: "macro_project_understanding",
    contract: ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
    entities: ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["entity"],
      properties: {
        entity: { type: "string", enum: ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES },
        filters: { type: "object", description: "Bounded structured filters; raw SQL is rejected." },
        fields: { type: "array", items: { type: "string" }, maxItems: GENERIC_QUERY_MAX_OBJECT_KEYS },
        selectors: { type: "object", description: "Bounded safe selectors only." },
        refresh_policy: { type: "string", enum: [...GENERIC_QUERY_REFRESH_POLICIES] },
        hydrate_refs: { type: "boolean" },
        cursor: { type: "string" },
        limit: { type: "integer", minimum: 1, maximum: 100 },
      },
    },
    output_summary_shape: {
      mode: "macro_execution_project_query",
      fields: ["result.data.rows", "result.canonical_refs", "sqlite", "result.data.coverage", "result.data.page", "blockers"],
      rows_are_candidate_facts: true,
      sqlite_authorizes_writes: false,
    },
    replacement: ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT,
  })];
}

export function planAlpha3_2DGenericProjectQuery(request = {}, options = {}) {
  const indexState = readProjectIndexState(options.projectIndex);
  const normalized = normalizeGenericProjectQueryInput(request, indexState);
  if (normalized.blockers.length > 0) {
    return genericProjectQueryBlockedPlan(normalized, indexState);
  }

  const { query } = normalized;
  const internalCursor = query.cursor_offset > 0 ? encodeCursor(query.cursor_offset) : null;
  const legacyRequest = genericLegacyRequest(query, internalCursor);
  const legacyId = query.entity === "duplicates" ? "macro.query_media" : GENERIC_QUERY_ENTITY_TO_LEGACY_ID[query.entity];
  let legacyPlan = planAlpha3C3ProjectIndexQueryMacro(legacyId, legacyRequest, options);

  if (query.entity === "duplicates") {
    legacyPlan = genericDuplicatePlanFromMedia({ query, indexState, legacyPlan });
  } else if (query.entity === "status" && legacyPlan.blockers.length === 0) {
    legacyPlan = {
      ...legacyPlan,
      rows: [genericStatusRow(legacyPlan.index_status)],
      coverage: {
        ...(isPlainObject(legacyPlan.coverage) ? legacyPlan.coverage : {}),
        row_count: 1,
      },
    };
  }

  const coverageTruthBlockers = genericCoverageTruthBlockers({ query, legacyPlan });
  const refreshDecision = genericRefreshDecision({ query, indexState, legacyPlan, options });
  const forcedRefreshPending = refreshDecision.forced;
  const legacyBlockers = Array.isArray(legacyPlan.blockers) ? legacyPlan.blockers : [];
  const blockers = uniqueBlockers([
    ...legacyBlockers,
    ...coverageTruthBlockers,
    ...(forcedRefreshPending
      ? [blocker("refresh_policy", "GENERIC_QUERY_REFRESH_REQUIRED", `${query.refresh_policy} requires the returned read-only refresh plan to complete before rows are usable.`)]
      : []),
  ]);
  const rows = forcedRefreshPending ? [] : boundedCloneRows(legacyPlan.rows, query.limit);
  const refs = forcedRefreshPending ? [] : unique(rows.flatMap(genericRowRefs)).slice(0, GENERIC_QUERY_MAX_ARRAY_VALUES);
  const nextOffset = !forcedRefreshPending && legacyPlan.page?.next_cursor
    ? query.cursor_offset + rows.length
    : null;
  const nextCursor = nextOffset === null
    ? null
    : encodeGenericQueryCursor({
        entity: query.entity,
        identity: normalized.identity,
        fingerprint: normalized.fingerprint,
        offset: nextOffset,
      });
  const hydrate = genericHydrationPosture({ query, legacyPlan, refs });
  const coverageFacts = genericCoverageFacts({ query, indexState, legacyPlan, rows, blockers });
  const plan = {
    contract: ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
    ok: blockers.length === 0,
    id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
    mode: "plan_only_generic_project_query",
    action_kind: "macro",
    execution_shape: "generic_project_index_query_plan",
    entity: query.entity,
    input: genericInputSummary(query),
    rows,
    refs,
    refs_truth: {
      posture: "candidate_refs_from_project_index",
      sqlite_authorizes_writes: false,
      write_requires_live_re_resolution: refs.length > 0,
    },
    freshness: {
      ...(isPlainObject(legacyPlan.freshness) ? cloneJson(legacyPlan.freshness) : {}),
      identity_token: normalized.identity,
      refresh_policy: query.refresh_policy,
      refresh_pending: refreshDecision.requests.length > 0,
    },
    coverage: {
      ...(isPlainObject(legacyPlan.coverage) ? cloneJson(legacyPlan.coverage) : {}),
      row_count: rows.length,
      ...coverageFacts,
      complete: blockers.length === 0 && genericLegacyCoverageIsDefinitive(query.entity, legacyPlan),
    },
    page: {
      limit: query.limit,
      cursor: query.cursor,
      next_cursor: nextCursor,
      has_more: nextCursor !== null,
      offset: query.cursor_offset,
      cursor_contract: "snapshot_and_query_bound_v2",
    },
    refresh_requests: refreshDecision.requests,
    refresh_execution: {
      owner: "agent",
      server_executes_children: false,
      read_only: true,
      required_behavior: "Agent executes returned call_template refresh children; runtime integration must automatically observe accepted readback into the Project Index before rerun.",
    },
    hydrate_request: hydrate.request,
    hydration_truth: hydrate.truth,
    blockers,
    legacy_implementation: {
      id: legacyId,
      posture: "internal_covered_helper",
      public_discovery: false,
    },
    replacement: ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT,
    execution: {
      executed: false,
      executor_call_count: 0,
      child_executor: false,
      live_reaper: false,
      raw_sql: false,
      sqlite_write: false,
    },
    safety: projectIndexSafety(),
  };
  plan.user_flow = createAlpha3L3ProjectIndexUserFlow(plan);
  return deepFreeze(plan);
}

export function createAlpha3_2DGenericProjectQueryRuntimeEnvelope({
  request = {},
  plan,
  projectIndex,
  catalog,
  now = () => new Date(),
} = {}) {
  const normalizedPlan = plan ?? planAlpha3_2DGenericProjectQuery(request.input ?? request, { projectIndex, catalog });
  return deepFreeze({
    contract: "template.execution.v1",
    ok: normalizedPlan.ok,
    template: {
      id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
      pack: "core",
      risk: "read",
      action_kind: "macro",
    },
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
      mode: "plan_only_generic_project_query",
      plan: normalizedPlan,
      rows: normalizedPlan.rows,
      refs: normalizedPlan.refs,
      freshness: normalizedPlan.freshness,
      coverage: normalizedPlan.coverage,
      page: normalizedPlan.page,
      refresh_requests: normalizedPlan.refresh_requests,
      hydrate_request: normalizedPlan.hydrate_request,
      blockers: normalizedPlan.blockers,
      execution: normalizedPlan.execution,
    },
  });
}

function normalizeGenericProjectQueryInput(request, indexState) {
  const source = isPlainObject(request) ? request : {};
  const blockers = [];
  if (!isPlainObject(request)) {
    blockers.push(blocker("input", "GENERIC_QUERY_INPUT_INVALID", "macro.project.query input must be an object."));
  }
  const keys = Object.keys(source);
  if (keys.length > GENERIC_QUERY_MAX_OBJECT_KEYS) {
    blockers.push(blocker("input", "GENERIC_QUERY_INPUT_TOO_LARGE", `macro.project.query accepts at most ${GENERIC_QUERY_MAX_OBJECT_KEYS} top-level fields.`));
  }
  for (const key of keys.slice(0, GENERIC_QUERY_MAX_OBJECT_KEYS + 1)) {
    const fieldLabel = genericFieldLabel("input", key);
    if (byteLength(key) > 128) {
      blockers.push(blocker(fieldLabel, "GENERIC_QUERY_KEY_TOO_LARGE", "macro.project.query field names must stay within the bounded key budget."));
      continue;
    }
    if (!GENERIC_QUERY_TOP_LEVEL_KEYS.has(key)) {
      blockers.push(blocker(fieldLabel, "GENERIC_QUERY_UNKNOWN_FIELD", "macro.project.query rejects unknown top-level fields."));
    }
    if (RAW_SQL_INPUT_FIELDS.has(key.toLowerCase())) {
      blockers.push(blocker(fieldLabel, "RAW_SQL_NOT_ALLOWED", "macro.project.query never accepts raw SQL or SQL-shaped fields."));
    }
  }

  const entity = typeof source.entity === "string" ? source.entity.trim() : "";
  if (!ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES.includes(entity)) {
    blockers.push(blocker("entity", "GENERIC_QUERY_ENTITY_REQUIRED", "entity is required and must be one of the exact twelve supported values."));
  }
  const refreshPolicy = source.refresh_policy ?? "if_stale";
  if (!GENERIC_QUERY_REFRESH_POLICIES.has(refreshPolicy)) {
    blockers.push(blocker("refresh_policy", "GENERIC_QUERY_REFRESH_POLICY_INVALID", "refresh_policy must be never, if_stale, required, or force_read_only_refresh."));
  }
  if (source.hydrate_refs !== undefined && typeof source.hydrate_refs !== "boolean") {
    blockers.push(blocker("hydrate_refs", "GENERIC_QUERY_HYDRATE_REFS_INVALID", "hydrate_refs must be boolean."));
  }

  const fields = normalizeGenericStringArray(source.fields, "fields", blockers, GENERIC_QUERY_MAX_OBJECT_KEYS);
  const filters = normalizeGenericBoundedObject(source.filters, "filters", blockers, { allowUnknown: true });
  const selectors = normalizeGenericBoundedObject(source.selectors, "selectors", blockers, { allowUnknown: false });
  const limit = normalizeLimit(source.limit, blockers);
  if (entity === "duplicates") {
    for (const field of fields) {
      if (!GENERIC_QUERY_DUPLICATE_FIELDS.has(field)) {
        blockers.push(blocker("fields", "GENERIC_QUERY_FIELD_UNSUPPORTED", `duplicates does not support field ${field}.`));
      }
    }
  }

  const fingerprint = genericQueryFingerprint({ entity, fields, filters, selectors });
  const identity = genericQueryIdentity(indexState, entity);
  const cursorResult = decodeGenericQueryCursor(source.cursor, { entity, identity, fingerprint });
  blockers.push(...cursorResult.blockers);
  return {
    blockers: uniqueBlockers(blockers),
    identity,
    fingerprint,
    query: {
      entity,
      filters,
      fields,
      selectors,
      refresh_policy: GENERIC_QUERY_REFRESH_POLICIES.has(refreshPolicy) ? refreshPolicy : "if_stale",
      hydrate_refs: source.hydrate_refs === true,
      cursor: typeof source.cursor === "string" ? source.cursor : null,
      cursor_offset: cursorResult.offset,
      limit,
    },
  };
}

function normalizeGenericBoundedObject(value, field, blockers, { allowUnknown }) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    blockers.push(blocker(field, "GENERIC_QUERY_OBJECT_INVALID", `${field} must be an object.`));
    return {};
  }
  const entries = Object.entries(value);
  if (entries.length > GENERIC_QUERY_MAX_OBJECT_KEYS) {
    blockers.push(blocker(field, "GENERIC_QUERY_OBJECT_TOO_LARGE", `${field} accepts at most ${GENERIC_QUERY_MAX_OBJECT_KEYS} keys.`));
  }
  const output = {};
  const budget = { nodes: 0, depth_blocked: false, node_blocked: false };
  for (const [key, raw] of entries.slice(0, GENERIC_QUERY_MAX_OBJECT_KEYS)) {
    const fieldLabel = genericFieldLabel(field, key);
    if (byteLength(key) > 128) {
      blockers.push(blocker(fieldLabel, "GENERIC_QUERY_KEY_TOO_LARGE", `${field} keys must stay within the bounded key budget.`));
      continue;
    }
    if (RAW_SQL_INPUT_FIELDS.has(key.toLowerCase())) {
      blockers.push(blocker(fieldLabel, "RAW_SQL_NOT_ALLOWED", "macro.project.query never accepts raw SQL or SQL-shaped fields."));
      continue;
    }
    if (!allowUnknown && !GENERIC_QUERY_SELECTOR_KEYS.has(key)) {
      blockers.push(blocker(fieldLabel, "GENERIC_QUERY_SELECTOR_UNSUPPORTED", "selectors accepts only bounded common selector keys."));
      continue;
    }
    const valueResult = normalizeGenericValue(raw, fieldLabel, blockers, { depth: 1, budget });
    if (valueResult !== undefined) output[key] = valueResult;
  }
  return output;
}

function normalizeGenericValue(value, field, blockers, state = { depth: 0, budget: { nodes: 0 } }) {
  const budget = state.budget ?? { nodes: 0 };
  budget.nodes += 1;
  if (budget.nodes > GENERIC_QUERY_MAX_NORMALIZED_NODES) {
    if (!budget.node_blocked) {
      blockers.push(blocker(field, "GENERIC_QUERY_VALUE_BUDGET_EXCEEDED", `filters/selectors accept at most ${GENERIC_QUERY_MAX_NORMALIZED_NODES} normalized nodes.`));
      budget.node_blocked = true;
    }
    return undefined;
  }
  if (state.depth > GENERIC_QUERY_MAX_NESTING_DEPTH) {
    if (!budget.depth_blocked) {
      blockers.push(blocker(field, "GENERIC_QUERY_VALUE_DEPTH_EXCEEDED", `filters/selectors nesting depth may not exceed ${GENERIC_QUERY_MAX_NESTING_DEPTH}.`));
      budget.depth_blocked = true;
    }
    return undefined;
  }
  if (value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value))) return value;
  if (typeof value === "string") {
    if (byteLength(value) > GENERIC_QUERY_MAX_STRING_BYTES) {
      blockers.push(blocker(field, "GENERIC_QUERY_VALUE_TOO_LARGE", `${field} exceeds the bounded string budget.`));
      return undefined;
    }
    return value;
  }
  if (Array.isArray(value)) {
    if (value.length > GENERIC_QUERY_MAX_ARRAY_VALUES) {
      blockers.push(blocker(field, "GENERIC_QUERY_ARRAY_TOO_LARGE", `${field} accepts at most ${GENERIC_QUERY_MAX_ARRAY_VALUES} values.`));
      return undefined;
    }
    const output = [];
    for (const entry of value) {
      const normalized = normalizeGenericValue(entry, field, blockers, { depth: state.depth + 1, budget });
      if (normalized !== undefined && !isPlainObject(normalized)) output.push(normalized);
    }
    return output;
  }
  if (isPlainObject(value)) {
    const entries = Object.entries(value);
    if (entries.length > GENERIC_QUERY_MAX_OBJECT_KEYS) {
      blockers.push(blocker(field, "GENERIC_QUERY_OBJECT_TOO_LARGE", `${field} accepts at most ${GENERIC_QUERY_MAX_OBJECT_KEYS} nested keys.`));
      return undefined;
    }
    const output = {};
    for (const [key, entry] of entries) {
      const fieldLabel = genericFieldLabel(field, key);
      if (byteLength(key) > 128) {
        blockers.push(blocker(fieldLabel, "GENERIC_QUERY_KEY_TOO_LARGE", "Nested filter keys must stay within the bounded key budget."));
        continue;
      }
      if (RAW_SQL_INPUT_FIELDS.has(key.toLowerCase())) {
        blockers.push(blocker(fieldLabel, "RAW_SQL_NOT_ALLOWED", "macro.project.query never accepts nested raw SQL or SQL-shaped fields."));
        continue;
      }
      const normalized = normalizeGenericValue(entry, fieldLabel, blockers, { depth: state.depth + 1, budget });
      if (normalized !== undefined) output[key] = normalized;
    }
    return output;
  }
  blockers.push(blocker(field, "GENERIC_QUERY_VALUE_INVALID", `${field} contains an unsupported value type.`));
  return undefined;
}

function genericFieldLabel(parent, key) {
  const safeKey = typeof key === "string" && key.length <= 64 ? key : "oversized_key";
  return parent ? `${parent}.${safeKey}` : safeKey;
}

function normalizeGenericStringArray(value, field, blockers, maxItems) {
  if (value === undefined) return [];
  const raw = Array.isArray(value) ? value : [value];
  if (raw.length > maxItems) {
    blockers.push(blocker(field, "GENERIC_QUERY_ARRAY_TOO_LARGE", `${field} accepts at most ${maxItems} values.`));
  }
  const output = [];
  for (const entry of raw.slice(0, maxItems)) {
    if (typeof entry !== "string" || entry.trim() === "" || byteLength(entry) > 128) {
      blockers.push(blocker(field, "GENERIC_QUERY_FIELDS_INVALID", `${field} must contain short non-empty strings.`));
      continue;
    }
    if (RAW_SQL_INPUT_FIELDS.has(entry.trim().toLowerCase())) {
      blockers.push(blocker(field, "RAW_SQL_NOT_ALLOWED", "macro.project.query fields never accept raw SQL tokens."));
      continue;
    }
    output.push(entry.trim());
  }
  return unique(output);
}

function genericLegacyRequest(query, internalCursor) {
  const selectors = query.selectors;
  const refs = unique([
    ...normalizeRefs(selectors.refs),
    ...normalizeRefs(selectors.ref),
    ...normalizeRefs(selectors.track_refs),
    ...normalizeRefs(selectors.track_ref),
    ...normalizeRefs(selectors.item_refs),
    ...normalizeRefs(selectors.item_ref),
    ...normalizeRefs(selectors.owner_refs),
    ...normalizeRefs(selectors.owner_ref),
  ]).slice(0, GENERIC_QUERY_MAX_ARRAY_VALUES);
  const filters = {
    ...cloneJson(query.filters),
  };
  for (const key of ["selected", "name", "track_ref", "item_ref", "owner_ref", "source_ref", "source_path", "path_fingerprint"]) {
    if (selectors[key] !== undefined && filters[key] === undefined) filters[key] = cloneJson(selectors[key]);
  }
  const scope = selectors.selected === true ? "selection" : genericLegacyScope(query.entity);
  return {
    scope,
    refs,
    filters,
    fields: query.entity === "duplicates" ? [] : query.fields,
    detail: query.hydrate_refs ? "hydrated" : "compact",
    since: query.entity === "changed_since" ? (selectors.since ?? filters.since ?? null) : null,
    time_range: selectors.time_range ?? filters.time_range ?? null,
    limit: query.limit,
    cursor: internalCursor,
    freshness: { require: "fresh_enough", refresh: "if_stale" },
  };
}

function genericLegacyScope(entity) {
  return ({
    selected_context: "selection",
    markers_regions: "markers",
    media_sources: "media",
    duplicates: "media",
  })[entity] ?? (QUERY_SCOPE_VALUES.has(entity) ? entity : "project");
}

function genericRefreshDecision({ query, indexState, legacyPlan, options }) {
  if (query.refresh_policy === "never") return { requests: [], forced: false };
  if (query.refresh_policy === "if_stale") {
    if (!genericIndexOrScopeNeedsRefresh(indexState, query.entity)) return { requests: [], forced: false };
    const planned = boundedReadOnlyRefreshRequests(legacyPlan.refresh_requests);
    if (planned.length > 0) return { requests: planned, forced: false };
    return { requests: genericMissingIndexRefreshRequests(query, indexState, options), forced: false };
  }
  return { requests: genericMissingIndexRefreshRequests(query, indexState, options), forced: true };
}

function genericMissingIndexRefreshRequests(query, indexState, options) {
  const refreshSourceId = query.entity === "duplicates"
    ? "macro.query_media"
    : (GENERIC_QUERY_ENTITY_TO_LEGACY_ID[query.entity] ?? "macro.index_status");
  let forcedPlan = planAlpha3C3ProjectIndexQueryMacro(refreshSourceId, genericLegacyRequest(query, null), {
    ...options,
    projectIndex: genericMissingIndexProjection(indexState),
  });
  let requests = boundedReadOnlyRefreshRequests(forcedPlan.refresh_requests);
  if (requests.length === 0) {
    forcedPlan = planAlpha3C3ProjectIndexQueryMacro("macro.index_status", { limit: query.limit }, {
      ...options,
      projectIndex: genericMissingIndexProjection(indexState),
    });
    requests = boundedReadOnlyRefreshRequests(forcedPlan.refresh_requests);
  }
  return requests;
}

function genericIndexOrScopeNeedsRefresh(indexState, entity) {
  if (indexState.lifecycle !== "ready" && indexState.lifecycle !== "degraded") return true;
  const scopeName = ({ selected_context: "selection", markers_regions: "markers", media_sources: "media", duplicates: "media" })[entity] ?? entity;
  if (entity === "status" || entity === "changed_since") return false;
  const scope = freshnessScope(indexState, scopeName);
  return !freshnessStatusSatisfies(scope.status, "fresh_enough")
    || !genericCoverageStatusIsDefinitive(entity, scope.coverage_status);
}

function genericCoverageTruthBlockers({ query, legacyPlan }) {
  if (query.entity === "status" || query.entity === "changed_since") return [];
  if (Array.isArray(legacyPlan.rows) && legacyPlan.rows.length > 0) return [];
  if (genericLegacyCoverageIsDefinitive(query.entity, legacyPlan)) return [];
  return [blocker(
    "coverage",
    "INDEX_COVERAGE_INCOMPLETE",
    "Project Index coverage is incomplete, so an empty candidate page is not a definitive not-found result; refresh this scope from REAPER truth and retry.",
  )];
}

function genericCoverageFacts({ query, indexState, legacyPlan, rows, blockers }) {
  const indexedRows = genericIndexedRows(indexState, query.entity);
  const indexedRowCount = query.entity === "status"
    ? Array.isArray(legacyPlan.rows) ? legacyPlan.rows.length : 0
    : indexedRows.length;
  const knownTotalRowCount = genericKnownTotalRowCount(indexState, query.entity, indexedRowCount, legacyPlan);
  const incompleteNoMatch = blockers.some((entry) => entry.code === "INDEX_COVERAGE_INCOMPLETE");
  const coverageComplete = genericLegacyCoverageIsDefinitive(query.entity, legacyPlan);
  return {
    known_total_row_count: knownTotalRowCount,
    indexed_row_count: indexedRowCount,
    public_returned_row_count: rows.length,
    public_limit: query.limit,
    public_offset: query.cursor_offset,
    match_status: incompleteNoMatch
      ? "no_match_not_definitive"
      : rows.length === 0
        ? coverageComplete ? "no_match_definitive" : "blocked_or_unknown"
        : coverageComplete ? "matches_from_complete_coverage" : "candidate_matches_from_incomplete_coverage",
  };
}

function genericIndexedRows(indexState, entity) {
  const rowKey = ({
    selected_context: "selection_state",
    tracks: "tracks",
    items: "items",
    takes: "takes",
    fx: "fx",
    routing: "sends",
    automation: "envelopes",
    markers_regions: "markers_regions",
    media_sources: "media_sources",
    duplicates: "media_sources",
    changed_since: "object_changes",
  })[entity];
  if (!rowKey) return [];
  const rows = indexState.rows?.[rowKey];
  if (!Array.isArray(rows)) return [];
  return entity === "selected_context"
    ? rows.filter((row) => row.scope_kind !== "project_head")
    : rows;
}

function genericKnownTotalRowCount(indexState, entity, indexedRowCount, legacyPlan) {
  if (entity === "duplicates") {
    return Number.isInteger(legacyPlan.coverage?.duplicate_group_count)
      ? legacyPlan.coverage.duplicate_group_count
      : legacyPlan.coverage?.complete === true ? indexedRowCount : null;
  }
  const projectHead = indexState.rows?.selection_state?.find((row) => row.scope_kind === "project_head");
  const summary = isPlainObject(projectHead?.summary) ? projectHead.summary : {};
  const known = ({
    selected_context: summary.selected_count,
    tracks: summary.track_count,
    items: summary.item_count,
    markers_regions: Number.isInteger(summary.marker_count) && Number.isInteger(summary.region_count)
      ? summary.marker_count + summary.region_count
      : null,
  })[entity];
  if (Number.isInteger(known) && known >= 0) return known;
  return legacyPlan.coverage?.complete === true ? indexedRowCount : null;
}

function genericCoverageStatusIsDefinitive(entity, status) {
  if (status === "complete") return true;
  return entity === "selected_context" && status === "selected_only";
}

function genericLegacyCoverageIsDefinitive(entity, legacyPlan) {
  if (legacyPlan.coverage?.complete === true) return true;
  const status = legacyPlan.coverage?.status ?? legacyPlan.freshness?.coverage_status;
  return genericCoverageStatusIsDefinitive(entity, status);
}

function genericMissingIndexProjection(indexState) {
  return {
    lifecycle: "missing",
    schema_version: indexState.schema_version,
    db_path: indexState.db_path,
    project_ref: indexState.project_ref,
    session_id: indexState.session_id,
    snapshot_id: indexState.snapshot_id,
    freshness_scopes: {},
    rows: {},
  };
}

function boundedReadOnlyRefreshRequests(requests) {
  if (!Array.isArray(requests)) return [];
  return requests.slice(0, 24).map((request) => deepFreeze({
    ...cloneJson(request),
    risk: "read",
    read_only: true,
  }));
}

function genericDuplicatePlanFromMedia({ query, indexState, legacyPlan }) {
  if (!legacyPlan.ok) return legacyPlan;
  const groups = new Map();
  for (const row of indexState.rows.media_sources.slice(0, 10_000)) {
    if (!row.ref) continue;
    const sourcePath = filePathFromRef(row.ref);
    const pathFingerprint = row.path_fingerprint || (sourcePath ? stableFingerprint(sourcePath.toLocaleLowerCase()) : null);
    const identity = row.path_fingerprint
      ? `fingerprint:${row.path_fingerprint}`
      : sourcePath
        ? `path:${sourcePath.toLocaleLowerCase()}`
        : null;
    if (!identity) continue;
    if (typeof query.filters.path_fingerprint === "string" && pathFingerprint !== query.filters.path_fingerprint) continue;
    if (typeof query.filters.source_path === "string" && !String(sourcePath ?? "").toLocaleLowerCase().includes(query.filters.source_path.toLocaleLowerCase())) continue;
    const group = groups.get(identity) ?? { identity, pathFingerprint, sourcePath, rows: [] };
    group.rows.push(row);
    groups.set(identity, group);
  }
  const minimumCount = Number.isInteger(query.filters.minimum_count) && query.filters.minimum_count >= 2
    ? Math.min(query.filters.minimum_count, 100)
    : 2;
  const duplicateRows = [...groups.values()]
    .filter((group) => group.rows.length >= minimumCount)
    .sort((a, b) => b.rows.length - a.rows.length || a.identity.localeCompare(b.identity));
  const pageRows = duplicateRows.slice(query.cursor_offset, query.cursor_offset + query.limit);
  const projected = pageRows.map((group) => projectGenericDuplicateRow(group));
  const hasMore = query.cursor_offset + pageRows.length < duplicateRows.length;
  return {
    ...legacyPlan,
    rows: projected,
    refs: unique(projected.flatMap((row) => row.refs ?? [])),
    freshness: {
      ...(isPlainObject(legacyPlan.freshness) ? legacyPlan.freshness : {}),
      source: "derived_media_source_identity_groups",
    },
    coverage: {
      ...(isPlainObject(legacyPlan.coverage) ? legacyPlan.coverage : {}),
      source_scope: "media_sources",
      row_count: projected.length,
      duplicate_group_count: duplicateRows.length,
      complete: legacyPlan.coverage?.complete === true,
    },
    page: pageEnvelope(query.limit, query.cursor, hasMore ? "internal_has_more" : null),
  };
}

function projectGenericDuplicateRow(group) {
  const rows = group.rows;
  const complete = rows.every((row) => row.coverage_status === "complete");
  const freshness = rows.every((row) => row.freshness_status === "fresh")
    ? "fresh"
    : rows.every((row) => freshnessStatusSatisfies(row.freshness_status, "fresh_enough"))
      ? "fresh_enough"
      : "stale_or_unknown";
  const distinctSourcePaths = unique(rows.map((row) => filePathFromRef(row.ref)).filter(Boolean));
  const full = {
    duplicate_key: group.identity,
    count: rows.length,
    refs: unique(rows.map((row) => row.ref)).slice(0, GENERIC_QUERY_MAX_ARRAY_VALUES),
    owner_refs: unique(rows.map((row) => row.owner_ref).filter(Boolean)).slice(0, GENERIC_QUERY_MAX_ARRAY_VALUES),
    source_path: distinctSourcePaths.length === 1 ? distinctSourcePaths[0] : null,
    path_fingerprint: group.pathFingerprint,
    freshness,
    coverage: complete ? "complete" : "partial_or_unknown",
  };
  return full;
}

function genericStatusRow(status) {
  return {
    lifecycle: status?.lifecycle ?? "missing",
    project_ref: status?.project_ref ?? null,
    session_id: status?.session_id ?? null,
    snapshot_id: status?.snapshot_id ?? null,
    freshness_scopes: status?.freshness_scopes ?? {},
    coverage: status?.coverage ?? {},
  };
}

function genericHydrationPosture({ query, legacyPlan, refs }) {
  if (query.entity === "markers_regions" && query.hydrate_refs) {
    return {
      request: null,
      truth: {
        status: "exact_hydration_unavailable",
        write_posture: "write_requires_target_template_live_resolution",
        reason: "No new atomic marker/region hydration route is introduced by macro.project.query.",
      },
    };
  }
  if (!query.hydrate_refs || refs.length === 0) {
    return {
      request: null,
      truth: {
        status: query.hydrate_refs ? "no_candidate_refs" : "not_requested",
        write_posture: refs.length > 0 ? "write_requires_live_re_resolution" : "no_write_target",
      },
    };
  }
  return {
    request: legacyPlan.hydrate_request ?? null,
    truth: {
      status: legacyPlan.hydrate_request?.callable_now === true ? "planned_exact_read" : "exact_hydration_unavailable",
      write_posture: "write_requires_target_template_live_resolution",
    },
  };
}

function genericRowRefs(row) {
  if (!isPlainObject(row)) return [];
  return unique([
    typeof row.ref === "string" ? row.ref : null,
    ...(Array.isArray(row.refs) ? row.refs : []),
  ].filter(Boolean));
}

function boundedCloneRows(rows, limit) {
  if (!Array.isArray(rows)) return [];
  return rows.slice(0, limit).map((row) => cloneJson(row));
}

function genericInputSummary(query) {
  return {
    entity: query.entity,
    filter_keys: Object.keys(query.filters).slice(0, GENERIC_QUERY_MAX_OBJECT_KEYS),
    fields: query.fields.slice(0, GENERIC_QUERY_MAX_OBJECT_KEYS),
    selector_keys: Object.keys(query.selectors).slice(0, GENERIC_QUERY_MAX_OBJECT_KEYS),
    refresh_policy: query.refresh_policy,
    hydrate_refs: query.hydrate_refs,
    limit: query.limit,
    cursor_present: query.cursor !== null,
  };
}

function genericProjectQueryBlockedPlan(normalized, indexState) {
  const plan = {
    contract: ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
    ok: false,
    id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
    mode: "plan_only_generic_project_query",
    action_kind: "macro",
    execution_shape: "generic_project_index_query_plan",
    entity: normalized.query.entity || null,
    input: genericInputSummary(normalized.query),
    rows: [],
    refs: [],
    refs_truth: {
      posture: "no_candidate_refs",
      sqlite_authorizes_writes: false,
      write_requires_live_re_resolution: false,
    },
    freshness: { identity_token: normalized.identity },
    coverage: { status: "failed", row_count: 0, complete: false },
    page: { limit: normalized.query.limit, cursor: null, next_cursor: null, has_more: false, offset: 0, cursor_contract: "snapshot_and_query_bound_v2" },
    refresh_requests: [],
    hydrate_request: null,
    hydration_truth: { status: "not_available_while_blocked", write_posture: "no_write_target" },
    blockers: normalized.blockers,
    replacement: ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT,
    execution: { executed: false, executor_call_count: 0, child_executor: false, live_reaper: false, raw_sql: false, sqlite_write: false },
    safety: projectIndexSafety(),
  };
  plan.user_flow = createAlpha3L3ProjectIndexUserFlow(plan);
  return deepFreeze(plan);
}

function genericQueryIdentity(indexState, entity) {
  const scopeName = ({ selected_context: "selection", markers_regions: "markers", media_sources: "media", duplicates: "media" })[entity] ?? entity;
  const scope = freshnessScope(indexState, scopeName);
  return [
    `snapshot:${indexState.snapshot_id ?? "none"}`,
    `session:${indexState.session_id ?? "none"}`,
    `scope_snapshot:${scope.snapshot_id ?? "none"}`,
    `observed:${scope.observed_at ?? "none"}`,
    `status:${scope.status}`,
  ].join("|");
}

function genericQueryFingerprint(value) {
  return stableFingerprint(stableJson(value));
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function stableFingerprint(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a32:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function encodeGenericQueryCursor({ entity, identity, fingerprint, offset }) {
  return Buffer.from(JSON.stringify({
    v: GENERIC_QUERY_CURSOR_VERSION,
    contract: ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
    entity,
    identity,
    fingerprint,
    offset,
  }), "utf8").toString("base64url");
}

function decodeGenericQueryCursor(cursor, expected) {
  if (cursor === undefined || cursor === null) return { offset: 0, blockers: [] };
  if (typeof cursor !== "string" || cursor.trim() === "" || byteLength(cursor) > 2048) {
    return { offset: 0, blockers: [blocker("cursor", "GENERIC_QUERY_CURSOR_INVALID", "cursor must be a bounded non-empty opaque string.")] };
  }
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (
      decoded?.v !== GENERIC_QUERY_CURSOR_VERSION
      || decoded.contract !== ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT
      || !Number.isInteger(decoded.offset)
      || decoded.offset < 0
      || decoded.entity !== expected.entity
      || decoded.fingerprint !== expected.fingerprint
    ) {
      return { offset: 0, blockers: [blocker("cursor", "GENERIC_QUERY_CURSOR_INVALID", "cursor does not match this entity or bounded query shape.")] };
    }
    if (decoded.identity !== expected.identity) {
      return { offset: 0, blockers: [blocker("cursor", "GENERIC_QUERY_CURSOR_STALE", "cursor belongs to a different Project Index snapshot or freshness identity.")] };
    }
    return { offset: decoded.offset, blockers: [] };
  } catch {
    return { offset: 0, blockers: [blocker("cursor", "GENERIC_QUERY_CURSOR_INVALID", "cursor is not a valid macro.project.query cursor.")] };
  }
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
  const uniquePlanBlockers = uniqueBlockers(blockers);
  const page = pageEnvelope(25);
  const plan = {
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
    page,
    refresh_requests: [],
    hydrate_request: null,
    next_actions: projectIndexNextActions({
      id,
      refs: [],
      page,
      refresh_requests: [],
      hydrate_request: null,
      blockers: uniquePlanBlockers,
    }),
    write_safety_loop: projectIndexWriteSafetyLoop(),
    safety: projectIndexSafety(),
    user_flow: null,
    blockers: uniquePlanBlockers,
  };
  plan.user_flow = createAlpha3L3ProjectIndexUserFlow(plan);
  return deepFreeze(plan);
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
    ...createTemplateCatalogAlpha3C3Templates(),
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
