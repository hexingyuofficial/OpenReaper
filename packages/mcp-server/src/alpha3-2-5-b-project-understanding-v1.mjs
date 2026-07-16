import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";
import {
  ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
  planAlpha3_2DGenericProjectQuery,
} from "./alpha3-c3-project-index-query-v1.mjs";
import {
  ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS,
} from "./alpha3-2d-project-index-runtime-v1.mjs";
import {
  ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
  planAlpha3_2EProjectInspectMacro,
} from "./alpha3-2e-small-macro-spine-v1.mjs";

export const ALPHA3_2_5_B_PROJECT_UNDERSTANDING_CONTRACT =
  "alpha3.2.5.b.project_understanding.v1";
export const ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY =
  "project_index.runtime.v1";

const READ_SUMMARY_ID = "template.project.read_summary";
const READ_DIRTY_ID = "template.project.read_dirty_state";
const READ_RENDER_SETTINGS_ID = "template.render.read_settings";
const OBSERVATION_BUNDLE_ID = "template.project.create_observation_bundle";
const AUTOMATION_INVENTORY_ID = "template.automation.list_project_envelopes";
const MAX_HYDRATION_CALLS = 16;
const MAX_EXACT_SELECTOR_REFS = 100;
const MAX_RESULT_DATA_BYTES = 18_000;
const MINIMUM_PUBLIC_QUERY_BUDGET = 2_048;
const PROJECT_INDEX_HYDRATION_TRACK_LIMIT = 32;
const PROJECT_INDEX_HYDRATION_AUTOMATION_LIMIT = 32;
const PROJECT_INDEX_MAX_TRACK_CHUNKS = 128;
const PROJECT_INDEX_MAX_AUTOMATION_PAGES = 128;
const PROJECT_INDEX_LOGICAL_REFRESH_ATTEMPTS = 2;
const PROJECT_INDEX_HYDRATION_BUDGET = Object.freeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: 128,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});
const EXACT_GUID_HYDRATION_REF_KINDS = new Set([
  "track",
  "item",
  "take",
  "envelope",
]);

const INSPECT_STAGE_IDS = Object.freeze([
  "inspect-project-revision",
  "inspect-index-hydrate",
  "inspect-dirty-state",
  "inspect-render-settings",
  "inspect-index-query",
  "inspect-result-project",
]);
const QUERY_STAGE_IDS = Object.freeze([
  "query-project-revision",
  "query-index-hydrate",
  "query-index-read",
  "query-result-project",
]);
const REGISTERED_STAGE_IDS = new Set([...INSPECT_STAGE_IDS, ...QUERY_STAGE_IDS]);
const HYDRATION_TEMPLATE_IDS = new Set(ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS);
const PROJECT_UNDERSTANDING_TEMPLATE_IDS = Object.freeze([
  ...new Set([
    ...ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS,
    READ_SUMMARY_ID,
    READ_DIRTY_ID,
    READ_RENDER_SETTINGS_ID,
  ]),
]);

const REGISTRY_ENTRIES = Object.freeze([
  macroEntry({
    macroId: ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
    programId: "openreaper.macro.project.inspect",
    templateIds: [
      OBSERVATION_BUNDLE_ID,
      READ_SUMMARY_ID,
      READ_DIRTY_ID,
      READ_RENDER_SETTINGS_ID,
    ],
    stages: [
      templateStage("inspect-project-revision", READ_SUMMARY_ID),
      stage("inspect-index-hydrate", "sqlite_hydrate"),
      templateStage("inspect-dirty-state", READ_DIRTY_ID),
      templateStage("inspect-render-settings", READ_RENDER_SETTINGS_ID),
      stage("inspect-index-query", "sqlite_query"),
      stage("inspect-result-project", "result_project"),
    ],
  }),
  macroEntry({
    macroId: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
    programId: "openreaper.macro.project.query",
    templateIds: PROJECT_UNDERSTANDING_TEMPLATE_IDS,
    stages: [
      templateStage("query-project-revision", READ_SUMMARY_ID),
      stage("query-index-hydrate", "sqlite_hydrate"),
      stage("query-index-read", "sqlite_query"),
      stage("query-result-project", "result_project"),
    ],
  }),
]);

export function createAlpha3_2_5BProjectUnderstandingRegistry(options = {}) {
  return createMacroProgramRegistry(REGISTRY_ENTRIES, {
    acceptedTemplateIds: options.acceptedTemplateIds ?? PROJECT_UNDERSTANDING_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [
      ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY,
    ],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY =
  createAlpha3_2_5BProjectUnderstandingRegistry();

export function isAlpha3_2_5BProjectUnderstandingMacroId(id) {
  return id === ALPHA3_2E_PROJECT_INSPECT_MACRO_ID
    || id === ALPHA3_2D_GENERIC_PROJECT_QUERY_ID;
}

export function projectAlpha3_2_5BProjectQueryDoctorTask({
  task,
  projectIndexReadiness,
  projectIndex,
} = {}) {
  const projected = clone(isObject(task) ? task : {});
  if (projected.mode !== "project-query" || projected.status === "blocked") {
    return deepFreeze(projected);
  }

  const readiness = isObject(projectIndexReadiness) ? projectIndexReadiness : {};
  const index = isObject(projectIndex) ? projectIndex : {};
  const readinessStatus = typeof readiness.status === "string"
    ? readiness.status
    : "not_configured";
  const indexEvidence = {
    readiness_status: readinessStatus,
    lifecycle: index.lifecycle ?? "not_configured",
    backend: index.backend ?? "none",
    revision: index.revision ?? null,
    recovery_status: index.recovery?.status ?? "none",
    rows_available: index.rows_available === true,
    sqlite_rows_are_candidates_only: index.sqlite_rows_are_candidates_only !== false,
    sqlite_is_truth: index.sqlite_is_truth === true,
  };

  if (readiness.ready === true) {
    return deepFreeze({
      ...projected,
      status: "ready",
      ready: true,
      missing_precondition: null,
      missing_preconditions: [],
      failure_layer: null,
      recoverable: true,
      next_action: {
        code: "project_query_ready",
        instruction: "Bridge/read preflight and the managed Project Index are ready; use macro.project.inspect or macro.project.query.",
      },
      user_action_required: false,
      restart_required: { mcp_client: false, reaper: false },
      safe_copy_paste_fix: null,
      task_specific_readiness: readinessStatus,
      evidence: {
        ...(isObject(projected.evidence) ? projected.evidence : {}),
        project_index: indexEvidence,
      },
    });
  }

  const missing = `project_index_${doctorStatusToken(readinessStatus)}`;
  return deepFreeze({
    ...projected,
    status: "degraded",
    ready: false,
    missing_precondition: missing,
    missing_preconditions: [missing],
    failure_layer: "project_index",
    recoverable: true,
    next_action: {
      code: "restore_project_index",
      instruction: typeof readiness.next_action === "string" && readiness.next_action.length > 0
        ? readiness.next_action
        : "Restore the managed OpenReaper Project Index, then retry project-query Doctor mode.",
    },
    user_action_required: false,
    restart_required: { mcp_client: false, reaper: false },
    safe_copy_paste_fix: null,
    task_specific_readiness: readinessStatus,
    evidence: {
      ...(isObject(projected.evidence) ? projected.evidence : {}),
      project_index: indexEvidence,
    },
  });
}

export async function executeAlpha3_2_5BProjectUnderstandingMacro(options = {}) {
  const request = isObject(options.request) ? options.request : {};
  if (request.id === ALPHA3_2E_PROJECT_INSPECT_MACRO_ID) {
    return executeProjectInspect({ ...options, request });
  }
  if (request.id === ALPHA3_2D_GENERIC_PROJECT_QUERY_ID) {
    return executeProjectQuery({ ...options, request });
  }
  throw new TypeError(`Unsupported Alpha3.2.5-B Macro id: ${String(request.id)}`);
}

async function executeProjectQuery({
  request,
  projectIndexRuntime,
  catalog,
  executeAtomic,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.get(request.id);
  const startedAt = safeNowIso(now);
  const stages = [];
  const initialStatus = runtimeStatus(projectIndexRuntime);
  const initialCold = !hasIndexedProjectRows(initialStatus);
  const programRequest = macroProgramRequest(request);
  const requestValidation = validateMacroProgramRequest(programRequest, {
    registry: ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  });
  if (!requestValidation.valid) {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: "MACRO_REQUEST_INVALID",
      message: requestValidation.errors.join("; "),
      blockers: requestValidation.errors.map((message) => ({
        code: "MACRO_REQUEST_INVALID",
        message,
        recoverable: true,
      })),
    });
  }

  const budgetConflict = projectQueryBudgetConflict(request);
  if (budgetConflict) {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: budgetConflict.code,
      message: budgetConflict.message,
      blockers: [budgetConflict],
      data: { budget_conflict: clone(budgetConflict.details) },
    });
  }

  const publicInput = publicQueryInput(request);
  let plan = planAlpha3_2DGenericProjectQuery(publicInput, {
    projectIndex: projectIndexRuntime?.adapter,
    catalog,
  });
  if (hasNonRefreshBlockers(plan)) {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: firstBlockerCode(plan, "PROJECT_QUERY_INVALID"),
      message: "macro.project.query input or query state is blocked before execution.",
      blockers: plan.blockers,
      data: queryData(plan),
    });
  }

  const refreshPolicy = request.input?.refresh_policy ?? "if_stale";
  const shouldProbeRevision = typeof executeAtomic === "function" && refreshPolicy !== "never";
  let revision = null;
  if (shouldProbeRevision) {
    revision = await runRevisionProbe({
      request,
      projectIndexRuntime,
      executeAtomic,
    });
    stages.push(stageResult(
      "query-project-revision",
      "template_execute",
      revision.ok ? "completed" : "failed",
      revision.summary,
      revision.evidenceRefs,
    ));
    if (!revision.ok) {
      return executionFailure({
        entry,
        request,
        startedAt,
        now,
        stages,
        projectIndexRuntime,
        error: revision.error,
        blockers: revision.blockers,
      });
    }
    plan = planAlpha3_2DGenericProjectQuery(publicInput, {
      projectIndex: projectIndexRuntime?.adapter,
      catalog,
    });
  } else {
    stages.push(stageResult(
      "query-project-revision",
      "template_execute",
      "skipped",
      refreshPolicy === "never"
        ? "Explicit refresh_policy=never skipped the live revision probe."
        : "No live atomic executor was available for the revision probe.",
    ));
  }

  const hydration = await hydrateForQuery({
    request,
    plan,
    projectIndexRuntime,
    catalog,
    executeAtomic,
    forceColdBundle: initialCold && refreshPolicy !== "never",
    expectedRevision: revisionKey(revision),
    now,
  });
  stages.push(stageResult(
    "query-index-hydrate",
    "sqlite_hydrate",
    hydration.ok ? (hydration.executions.length > 0 ? "completed" : "skipped") : "failed",
    hydration.summary,
    hydration.evidenceRefs,
  ));
  if (!hydration.ok) {
    return executionFailure({
      entry,
      request,
      startedAt,
      now,
      stages,
      projectIndexRuntime,
      error: hydration.error,
      blockers: hydration.blockers,
    });
  }

  const finalInput = hydration.executions.length > 0
    ? { ...publicInput, refresh_policy: "never" }
    : publicInput;
  plan = planAlpha3_2DGenericProjectQuery(finalInput, {
    projectIndex: projectIndexRuntime?.adapter,
    catalog,
  });
  const queryOk = plan.ok === true;
  if (!queryOk) {
    stages.push(stageResult(
      "query-index-read",
      "sqlite_query",
      "failed",
      "SQLite query remained blocked after the bounded refresh attempt.",
    ));
    return executionFailure({
      entry,
      request,
      startedAt,
      now,
      stages,
      projectIndexRuntime,
      error: {
        code: firstBlockerCode(plan, "PROJECT_QUERY_BLOCKED"),
        message: "Project Index query could not produce fresh candidate rows.",
        recoverable: true,
      },
      blockers: plan.blockers,
      data: queryData(plan),
    });
  }

  let candidateLimit = finalInput.limit;
  let minimumCandidateLimit = 1;
  let maximumCandidateLimit = candidateLimit;
  let bestEnvelope = null;
  let budgetFailure = null;
  while (candidateLimit >= 1) {
    if (candidateLimit !== plan.page.limit) {
      plan = planAlpha3_2DGenericProjectQuery({ ...finalInput, limit: candidateLimit }, {
        projectIndex: projectIndexRuntime?.adapter,
        catalog,
      });
    }
    const resultStages = [
      ...stages,
      stageResult(
        "query-index-read",
        "sqlite_query",
        "completed",
        `SQLite returned ${plan.rows.length} compact ${plan.entity} candidate row(s).`,
      ),
      stageResult(
        "query-result-project",
        "result_project",
        "completed",
        "Projected bounded rows, canonical refs, freshness, coverage, and page evidence.",
      ),
    ];
    const envelope = successEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages: resultStages,
      projectIndexRuntime,
      initialCold,
      refreshed: hydration.executions.length > 0,
      summary: `Project Index query completed for ${plan.entity}.`,
      canonicalRefs: plan.refs,
      artifactRefs: hydration.artifactRefs,
      data: queryData(plan, hydration),
    });
    const preservesPageTruth = Array.isArray(envelope.result?.data?.rows)
      && envelope.result.data.rows_truncated_by_macro_budget !== true
      && envelope.result.data.rows.length === plan.rows.length;
    if (envelope.error?.code !== "RESPONSE_TOO_LARGE" && preservesPageTruth) {
      bestEnvelope = envelope;
      minimumCandidateLimit = candidateLimit + 1;
    } else {
      budgetFailure = envelope;
      maximumCandidateLimit = candidateLimit - 1;
    }
    if (minimumCandidateLimit > maximumCandidateLimit) break;
    candidateLimit = Math.floor((minimumCandidateLimit + maximumCandidateLimit) / 2);
  }
  return bestEnvelope ?? budgetFailure;
}

async function executeProjectInspect({
  request,
  projectIndexRuntime,
  catalog,
  executeAtomic,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.get(request.id);
  const startedAt = safeNowIso(now);
  const stages = [];
  const initialStatus = runtimeStatus(projectIndexRuntime);
  const initialCold = !hasIndexedProjectRows(initialStatus);
  const validationPlan = planAlpha3_2EProjectInspectMacro(request.input, {
    refs_provided: hasRefs(request.refs),
    idempotency_key_present: request.idempotency_key !== undefined,
  });
  if (!validationPlan.ok) {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: firstBlockerCode(validationPlan, "PROJECT_INSPECT_INVALID"),
      message: "macro.project.inspect input is invalid.",
      blockers: validationPlan.blockers,
    });
  }
  const requestedEntities = inspectEntities(validationPlan.include);
  const queryValidationBlockers = requestedEntities.flatMap((entity) => {
    const plan = planAlpha3_2DGenericProjectQuery({
      entity,
      refresh_policy: "if_stale",
      limit: Math.min(validationPlan.limit, 100),
      ...inspectFieldsInput(validationPlan, entity),
    }, { projectIndex: projectIndexRuntime?.adapter, catalog });
    return nonRefreshBlockers(plan);
  });
  if (queryValidationBlockers.length > 0) {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: firstBlockerCode({ blockers: queryValidationBlockers }, "PROJECT_INSPECT_INVALID"),
      message: "macro.project.inspect fields are invalid for one or more requested scopes.",
      blockers: queryValidationBlockers,
    });
  }
  if (typeof executeAtomic !== "function") {
    return blockedEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      status: initialStatus,
      code: "PROJECT_INSPECT_LIVE_READ_UNAVAILABLE",
      message: "macro.project.inspect needs the configured OpenReaper live read route.",
      blockers: [{
        code: "PROJECT_INSPECT_LIVE_READ_UNAVAILABLE",
        message: "Start or reconnect the managed OpenReaper bridge, then retry macro.project.inspect.",
        recoverable: true,
      }],
    });
  }

  const revision = await runRevisionProbe({
    request,
    projectIndexRuntime,
    executeAtomic,
  });
  stages.push(stageResult(
    "inspect-project-revision",
    "template_execute",
    revision.ok ? "completed" : "failed",
    revision.summary,
    revision.evidenceRefs,
  ));
  if (!revision.ok) {
    return executionFailure({
      entry,
      request,
      startedAt,
      now,
      stages,
      projectIndexRuntime,
      error: revision.error,
      blockers: revision.blockers,
    });
  }

  const needsHydration = initialCold || requestedEntities.some((entity) => {
    const planned = planAlpha3_2DGenericProjectQuery({
      entity,
      refresh_policy: "if_stale",
      limit: Math.min(validationPlan.limit, 100),
    }, { projectIndex: projectIndexRuntime?.adapter, catalog });
    return planned.ok !== true;
  });
  let hydration = emptyHydration("Matching fresh SQLite project state was reused.");
  if (needsHydration) {
    if (requestedEntities.includes("tracks")) {
      const tracksHydration = await runCompleteTrackRefresh({
          request,
          projectIndexRuntime,
          executeAtomic,
          expectedRevision: revisionKey(revision),
          now,
        });
      if (!tracksHydration.ok) {
        hydration = tracksHydration;
      } else if (requestedEntities.some((entity) => !["status", "tracks"].includes(entity))) {
        const supplemental = await runHydrationRequests({
          requests: [coldObservationBundleRequest()],
          request,
          projectIndexRuntime,
          executeAtomic,
        });
        hydration = mergeHydrationResults(tracksHydration, supplemental);
      } else {
        hydration = tracksHydration;
      }
    } else {
      hydration = await runHydrationRequests({
        requests: [coldObservationBundleRequest()],
        request,
        projectIndexRuntime,
        executeAtomic,
      });
    }
  }
  stages.push(stageResult(
    "inspect-index-hydrate",
    "sqlite_hydrate",
    hydration.ok ? (hydration.executions.length > 0 ? "completed" : "skipped") : "failed",
    hydration.summary,
    hydration.evidenceRefs,
  ));
  if (!hydration.ok) {
    return executionFailure({
      entry,
      request,
      startedAt,
      now,
      stages,
      projectIndexRuntime,
      error: hydration.error,
      blockers: hydration.blockers,
    });
  }

  const directReads = {};
  const directArtifactRefs = [];
  if (validationPlan.include.includes("dirty_state")) {
    const dirty = await runDirectRead({ id: READ_DIRTY_ID, input: {}, request, executeAtomic });
    stages.push(stageResult(
      "inspect-dirty-state",
      "template_execute",
      dirty.ok ? "completed" : "failed",
      dirty.summary,
      dirty.evidenceRefs,
    ));
    if (!dirty.ok) {
      return executionFailure({ entry, request, startedAt, now, stages, projectIndexRuntime, error: dirty.error, blockers: dirty.blockers });
    }
    directReads.dirty_state = dirty.readback;
    directArtifactRefs.push(...dirty.artifactRefs);
  } else {
    stages.push(stageResult("inspect-dirty-state", "template_execute", "skipped", "Dirty state was not requested."));
  }
  if (validationPlan.include.includes("render")) {
    const render = await runDirectRead({ id: READ_RENDER_SETTINGS_ID, input: {}, request, executeAtomic });
    stages.push(stageResult(
      "inspect-render-settings",
      "template_execute",
      render.ok ? "completed" : "failed",
      render.summary,
      render.evidenceRefs,
    ));
    if (!render.ok) {
      return executionFailure({ entry, request, startedAt, now, stages, projectIndexRuntime, error: render.error, blockers: render.blockers });
    }
    directReads.render = render.readback;
    directArtifactRefs.push(...render.artifactRefs);
  } else {
    stages.push(stageResult("inspect-render-settings", "template_execute", "skipped", "Render settings were not requested."));
  }

  const queryResults = {};
  const canonicalRefs = [];
  const queryBlockers = [];
  for (const entity of requestedEntities) {
    const plan = planAlpha3_2DGenericProjectQuery({
      entity,
      refresh_policy: "never",
      limit: Math.min(validationPlan.limit, 100),
      ...inspectFieldsInput(validationPlan, entity),
    }, { projectIndex: projectIndexRuntime?.adapter, catalog });
    if (plan.ok) {
      queryResults[entity] = queryData(plan);
      canonicalRefs.push(...plan.refs);
    } else {
      queryBlockers.push(...plan.blockers);
      queryResults[entity] = queryData(plan);
    }
  }
  const queryOk = queryBlockers.length === 0;
  stages.push(stageResult(
    "inspect-index-query",
    "sqlite_query",
    queryOk ? "completed" : "failed",
    queryOk
      ? `SQLite projected ${requestedEntities.length} requested project scope(s).`
      : "One or more requested project scopes remained stale or unavailable.",
  ));
  if (!queryOk) {
    return executionFailure({
      entry,
      request,
      startedAt,
      now,
      stages,
      projectIndexRuntime,
      error: {
        code: firstBlockerCode({ blockers: queryBlockers }, "PROJECT_INSPECT_SCOPE_BLOCKED"),
        message: "Project inspection could not satisfy every requested indexed scope.",
        recoverable: true,
      },
      blockers: queryBlockers,
      data: boundedData({
        project: projectSummaryData(revision.readback, projectIndexRuntime),
        scopes: queryResults,
        ...directReads,
      }),
    });
  }

  stages.push(stageResult(
    "inspect-result-project",
    "result_project",
    "completed",
    "Projected compact project identity, requested indexed scopes, and direct readiness reads.",
  ));
  return successEnvelope({
    entry,
    request,
    startedAt,
    now,
    stages,
    projectIndexRuntime,
    initialCold,
    refreshed: hydration.executions.length > 0,
    summary: "Current project inspected through the SQLite Project Index and bounded live reads.",
    canonicalRefs: unique(canonicalRefs),
    artifactRefs: unique([...hydration.artifactRefs, ...directArtifactRefs]),
    data: boundedData({
      contract: ALPHA3_2_5_B_PROJECT_UNDERSTANDING_CONTRACT,
      project: projectSummaryData(revision.readback, projectIndexRuntime),
      scopes: queryResults,
      ...directReads,
      index: compactIndexStatus(projectIndexRuntime),
      refresh: hydrationEvidence(hydration),
    }),
  });
}

async function hydrateForQuery({
  request,
  plan,
  projectIndexRuntime,
  catalog,
  executeAtomic,
  forceColdBundle,
  expectedRevision,
  now = () => new Date(),
}) {
  const refreshPolicy = request.input?.refresh_policy ?? "if_stale";
  const forceRefresh = refreshPolicy === "required" || refreshPolicy === "force_read_only_refresh";
  if (refreshPolicy === "never") return emptyHydration("Refresh policy forbids live hydration.");
  const exactSelectorRefreshRequired = exactSelectorRefreshRequests(request, projectIndexRuntime).length > 0;
  if (plan.ok && !forceColdBundle && !forceRefresh && !exactSelectorRefreshRequired) {
    return emptyHydration("Matching fresh SQLite rows were reused.");
  }
  if (typeof executeAtomic !== "function") {
    return hydrationFailure(
      "PROJECT_INDEX_REFRESH_UNAVAILABLE",
      "The query needs a read-only Project Index refresh, but the live OpenReaper executor is unavailable.",
    );
  }

  const executions = [];
  const artifactRefs = [];
  const evidenceRefs = [];
  const seen = new Set();
  const objectRefs = new Map();
  let logicalRefresh = null;
  let revisionProbeCount = 0;
  if (forceRefresh && !forceColdBundle) {
    const scope = refreshScopeForEntity(request.input?.entity);
    if (scope && typeof projectIndexRuntime?.invalidateScopes === "function") {
      const invalidation = projectIndexRuntime.invalidateScopes({
        scopes: [scope],
        observed_at: safeNowIso(now),
      });
      if (invalidation?.ok === false) {
        return hydrationFailure(
          invalidation.blockers?.[0]?.code ?? "PROJECT_INDEX_FORCE_REFRESH_INVALIDATION_FAILED",
          invalidation.blockers?.[0]?.message ?? "The requested Project Index scope could not be marked stale for forced read-only refresh.",
          invalidation.blockers ?? [],
        );
      }
    }
  }
  const completeTracks = request.input?.entity === "tracks"
    && (forceColdBundle || forceRefresh || plan.ok !== true);
  const completeAutomation = request.input?.entity === "automation"
    && (forceColdBundle || forceRefresh || plan.ok !== true);
  if (completeTracks) {
    const cold = await runCompleteTrackRefresh({
      request,
      projectIndexRuntime,
      executeAtomic,
      expectedRevision,
      now,
    });
    if (!cold.ok) return cold;
    executions.push(...cold.executions);
    artifactRefs.push(...cold.artifactRefs);
    evidenceRefs.push(...cold.evidenceRefs);
    logicalRefresh = cold.logicalRefresh ?? null;
    revisionProbeCount += cold.revisionProbeCount ?? 0;
  } else if (completeAutomation) {
    const cold = await runCompleteAutomationRefresh({
      request,
      projectIndexRuntime,
      executeAtomic,
      expectedRevision,
      now,
    });
    if (!cold.ok) return cold;
    executions.push(...cold.executions);
    artifactRefs.push(...cold.artifactRefs);
    evidenceRefs.push(...cold.evidenceRefs);
    logicalRefresh = cold.logicalRefresh ?? null;
    revisionProbeCount += cold.revisionProbeCount ?? 0;
  } else if (forceColdBundle) {
    const cold = await runHydrationRequests({
      requests: [coldObservationBundleRequest()],
      request,
      projectIndexRuntime,
      executeAtomic,
      seen,
      objectRefs,
    });
    if (!cold.ok) return cold;
    executions.push(...cold.executions);
    artifactRefs.push(...cold.artifactRefs);
    evidenceRefs.push(...cold.evidenceRefs);
  }

  const exactSelectorRequests = exactSelectorRefreshRequests(request, projectIndexRuntime);
  if (exactSelectorRequests.length > 0) {
    const exact = await runHydrationRequests({
      requests: exactSelectorRequests,
      request,
      projectIndexRuntime,
      executeAtomic,
      seen,
      objectRefs,
    });
    if (!exact.ok) return mergeHydrationResults({
      ok: true,
      executions,
      artifactRefs,
      evidenceRefs,
      blockers: [],
      error: null,
      logicalRefresh,
      revisionProbeCount,
      summary: "Completed earlier Project Index hydration.",
    }, exact);
    executions.push(...exact.executions);
    artifactRefs.push(...exact.artifactRefs);
    evidenceRefs.push(...exact.evidenceRefs);
  }
  const missingExactRefs = exactSelectorMissingRefs(request, projectIndexRuntime);
  if (missingExactRefs.length > 0) {
    return hydrationFailure(
      "PROJECT_INDEX_EXACT_SELECTOR_HYDRATION_INCOMPLETE",
      "Exact selector hydration completed, but one or more requested refs were not accepted into the Project Index.",
      [{
        code: "PROJECT_INDEX_EXACT_SELECTOR_HYDRATION_INCOMPLETE",
        message: "Do not treat missing exact selector rows as not found; retry after restoring live readback/index observation.",
        recoverable: true,
        details: { missing_refs: missingExactRefs.slice(0, MAX_EXACT_SELECTOR_REFS) },
      }],
      { executions, artifactRefs, evidenceRefs },
    );
  }

  for (let pass = 0; pass < 3 && executions.length < MAX_HYDRATION_CALLS; pass += 1) {
    const nextPlan = planAlpha3_2DGenericProjectQuery({
      ...request.input,
      refresh_policy: "if_stale",
    }, { projectIndex: projectIndexRuntime?.adapter, catalog });
    if (nextPlan.ok) break;
    const requests = Array.isArray(nextPlan.refresh_requests) ? nextPlan.refresh_requests : [];
    if (requests.length === 0) {
      return hydrationFailure(
        firstBlockerCode(nextPlan, "PROJECT_INDEX_REFRESH_BLOCKED"),
        "Project Index refresh could not derive another safe read-only request.",
        nextPlan.blockers,
        { executions, artifactRefs, evidenceRefs },
      );
    }
    const remaining = MAX_HYDRATION_CALLS - executions.length;
    const refreshed = await runHydrationRequests({
      requests: requests.slice(0, remaining),
      request,
      projectIndexRuntime,
      executeAtomic,
      seen,
      objectRefs,
    });
    if (!refreshed.ok) {
      return { ...refreshed, executions: [...executions, ...refreshed.executions], artifactRefs: unique([...artifactRefs, ...refreshed.artifactRefs]), evidenceRefs: unique([...evidenceRefs, ...refreshed.evidenceRefs]) };
    }
    if (refreshed.executions.length === 0) {
      return hydrationFailure(
        "PROJECT_INDEX_REFRESH_NO_PROGRESS",
        "The bounded Project Index refresh made no progress.",
        nextPlan.blockers,
        { executions, artifactRefs, evidenceRefs },
      );
    }
    executions.push(...refreshed.executions);
    artifactRefs.push(...refreshed.artifactRefs);
    evidenceRefs.push(...refreshed.evidenceRefs);
  }

  return {
    ok: true,
    executions,
    artifactRefs: unique(artifactRefs),
    evidenceRefs: unique(evidenceRefs),
    blockers: [],
    error: null,
    logicalRefresh,
    revisionProbeCount,
    summary: executions.length > 0
      ? `Executed ${executions.length} bounded read-only Project Index refresh call(s).`
      : "Matching fresh SQLite rows were reused.",
  };
}

function exactSelectorRefreshRequests(request, projectIndexRuntime) {
  const entity = request.input?.entity;
  const requested = exactSelectorRequestedRefs(request);
  const scopeStatus = projectIndexRuntime?.adapter?.snapshot?.().freshness_scopes?.[entity]?.status;
  const refs = scopeStatus === "fresh" || scopeStatus === "fresh_enough"
    ? exactSelectorMissingRefs(request, projectIndexRuntime)
    : requested;
  return refs.map((ref) => {
    if (request.input.entity === "items") {
      return {
        id: "template.items.read_item_summary",
        input: { include_take_summary: false },
        refs: { item_ref: ref },
        read_only: true,
      };
    }
    return {
      id: "template.media.read_take_source",
      input: { include_metadata_keys: false, include_parent_source: false },
      refs: { take_ref: ref },
      read_only: true,
    };
  });
}

function exactSelectorMissingRefs(request, projectIndexRuntime) {
  const entity = request.input?.entity;
  const requested = exactSelectorRequestedRefs(request);
  if (requested.length === 0) return [];
  const indexed = new Set((projectIndexRuntime?.adapter?.snapshot?.().rows?.[entity] ?? [])
    .map((row) => row?.ref)
    .filter((ref) => typeof ref === "string"));
  return requested.filter((ref) => !indexed.has(ref));
}

function exactSelectorRequestedRefs(request) {
  const entity = request.input?.entity;
  if (entity !== "items" && entity !== "takes") return [];
  const prefix = entity === "items" ? "item:guid:" : "take:guid:";
  return unique(Array.isArray(request.input?.selectors?.refs)
    ? request.input.selectors.refs.filter((ref) => typeof ref === "string" && ref.startsWith(prefix))
    : []).slice(0, MAX_EXACT_SELECTOR_REFS);
}

function mergeHydrationResults(primary, supplemental) {
  if (primary?.ok !== true) return primary;
  if (supplemental?.ok !== true) {
    return {
      ...supplemental,
      executions: [...(primary.executions ?? []), ...(supplemental.executions ?? [])],
      artifactRefs: unique([...(primary.artifactRefs ?? []), ...(supplemental.artifactRefs ?? [])]),
      evidenceRefs: unique([...(primary.evidenceRefs ?? []), ...(supplemental.evidenceRefs ?? [])]),
      logicalRefresh: primary.logicalRefresh ?? null,
      revisionProbeCount: (primary.revisionProbeCount ?? 0) + (supplemental.revisionProbeCount ?? 0),
    };
  }
  const executions = [...(primary.executions ?? []), ...(supplemental.executions ?? [])];
  return {
    ok: true,
    executions,
    artifactRefs: unique([...(primary.artifactRefs ?? []), ...(supplemental.artifactRefs ?? [])]),
    evidenceRefs: unique([...(primary.evidenceRefs ?? []), ...(supplemental.evidenceRefs ?? [])]),
    blockers: [],
    error: null,
    logicalRefresh: primary.logicalRefresh ?? supplemental.logicalRefresh ?? null,
    revisionProbeCount: (primary.revisionProbeCount ?? 0) + (supplemental.revisionProbeCount ?? 0),
    summary: `${primary.summary} ${supplemental.summary}`,
  };
}

async function runCompleteTrackRefresh({
  request,
  projectIndexRuntime,
  executeAtomic,
  expectedRevision,
  now = () => new Date(),
}) {
  if (
    typeof projectIndexRuntime?.beginLogicalRefresh !== "function"
    || typeof projectIndexRuntime?.commitLogicalRefresh !== "function"
    || typeof projectIndexRuntime?.abortLogicalRefresh !== "function"
  ) {
    return hydrationFailure(
      "PROJECT_INDEX_LOGICAL_REFRESH_UNAVAILABLE",
      "Complete track hydration requires the managed Project Index logical-refresh transaction runtime.",
    );
  }
  if (typeof expectedRevision !== "string") {
    return hydrationFailure(
      "PROJECT_INDEX_REFRESH_REVISION_REQUIRED",
      "Complete track hydration requires a validated REAPER revision before reading physical chunks.",
    );
  }

  const executions = [];
  const artifactRefs = [];
  const evidenceRefs = [];
  let revisionProbeCount = 0;
  let attemptRevision = expectedRevision;

  for (let attempt = 1; attempt <= PROJECT_INDEX_LOGICAL_REFRESH_ATTEMPTS; attempt += 1) {
    const observedAt = safeNowIso(now);
    const begun = projectIndexRuntime.beginLogicalRefresh({
      scopes: ["tracks"],
      expected_revision: attemptRevision,
      observed_at: observedAt,
    });
    if (begun?.ok !== true || typeof begun.transaction_id !== "string") {
      return hydrationFailure(
        begun?.blockers?.[0]?.code ?? "PROJECT_INDEX_LOGICAL_REFRESH_BEGIN_FAILED",
        begun?.blockers?.[0]?.message ?? "Project Index logical track refresh could not begin.",
        begun?.blockers ?? [],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const transactionId = begun.transaction_id;
    const attemptExecutionStart = executions.length;
    let cursor = 0;
    let declaredTrackCount = null;
    let completed = false;

    for (let chunkIndex = 0; chunkIndex < PROJECT_INDEX_MAX_TRACK_CHUNKS; chunkIndex += 1) {
      const child = coldObservationBundleRequest(cursor);
      const execution = await executeAtomic({
        id: child.id,
        input: child.input,
        refs: child.refs,
        context: request.context,
        budget: PROJECT_INDEX_HYDRATION_BUDGET,
        observeProjectIndex: true,
        projectIndexObservationContext: {
          logical_refresh: { transaction_id: transactionId },
        },
      });
      executions.push(execution);
      evidenceRefs.push(...executionEvidenceRefs(execution));
      artifactRefs.push(...executionArtifactRefs(execution));
      if (execution?.ok !== true || execution?.result?.project_index_observation?.ok !== true) {
        projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "chunk_observation_failed", observed_at: safeNowIso(now) });
        const failed = execution?.ok === true
          ? {
              error: {
                code: execution.result?.project_index_observation?.blockers?.[0]?.code ?? "PROJECT_INDEX_OBSERVATION_FAILED",
                message: "A physical track chunk was not accepted into logical-refresh staging.",
              },
              blockers: execution.result?.project_index_observation?.blockers ?? [],
            }
          : readFailure(child.id, execution);
        return hydrationFailure(failed.error.code, failed.error.message, failed.blockers, { executions, artifactRefs, evidenceRefs });
      }

      const readback = executionReadback(execution);
      const chunkFacts = trackChunkFacts(readback, cursor, declaredTrackCount);
      if (!chunkFacts.ok) {
        projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: chunkFacts.code, observed_at: safeNowIso(now) });
        return hydrationFailure(chunkFacts.code, chunkFacts.message, [chunkFacts.blocker], { executions, artifactRefs, evidenceRefs });
      }
      declaredTrackCount = chunkFacts.track_count;
      if (!chunkFacts.truncated) {
        completed = true;
        break;
      }
      cursor = chunkFacts.next_cursor;
    }

    if (!completed) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "chunk_limit_exceeded", observed_at: safeNowIso(now) });
      return hydrationFailure(
        "PROJECT_INDEX_TRACK_CHUNK_LIMIT_EXCEEDED",
        `Complete track hydration exceeded ${PROJECT_INDEX_MAX_TRACK_CHUNKS} hidden physical chunks and was not committed.`,
        [],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const postRevision = await runRevisionProbe({ request, projectIndexRuntime, executeAtomic });
    revisionProbeCount += 1;
    evidenceRefs.push(...(postRevision.evidenceRefs ?? []));
    artifactRefs.push(...(postRevision.artifactRefs ?? []));
    if (!postRevision.ok) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "post_revision_probe_failed", observed_at: safeNowIso(now) });
      return hydrationFailure(postRevision.error.code, postRevision.error.message, postRevision.blockers, { executions, artifactRefs, evidenceRefs });
    }

    const observedRevision = revisionKey(postRevision);
    if (observedRevision !== attemptRevision) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "revision_changed_during_refresh", observed_at: safeNowIso(now) });
      if (attempt < PROJECT_INDEX_LOGICAL_REFRESH_ATTEMPTS && typeof observedRevision === "string") {
        attemptRevision = observedRevision;
        continue;
      }
      return hydrationFailure(
        "PROJECT_INDEX_REFRESH_REVISION_CHANGED",
        "REAPER changed while Project Index track chunks were being read; the mixed snapshot was discarded.",
        [{
          code: "PROJECT_INDEX_REFRESH_REVISION_CHANGED",
          message: `Expected ${attemptRevision}, observed ${String(observedRevision)} after hydration.`,
          recoverable: true,
        }],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const committed = projectIndexRuntime.commitLogicalRefresh({
      transaction_id: transactionId,
      observed_revision: observedRevision,
      observed_at: safeNowIso(now),
    });
    if (committed?.ok !== true) {
      return hydrationFailure(
        committed?.blockers?.[0]?.code ?? "PROJECT_INDEX_LOGICAL_REFRESH_COMMIT_FAILED",
        committed?.blockers?.[0]?.message ?? "Complete track hydration could not be committed atomically.",
        committed?.blockers ?? [],
        { executions, artifactRefs, evidenceRefs },
      );
    }
    return {
      ok: true,
      executions,
      artifactRefs: unique(artifactRefs),
      evidenceRefs: unique(evidenceRefs),
      blockers: [],
      error: null,
      revisionProbeCount,
      logicalRefresh: {
        status: "committed",
        transaction_id: transactionId,
        attempt_count: attempt,
        chunk_count: executions.length - attemptExecutionStart,
        expected_revision: attemptRevision,
        observed_revision: observedRevision,
        declared_track_count: declaredTrackCount,
        applied_scopes: committed.applied_scopes ?? ["tracks"],
        row_counts: committed.row_counts ?? {},
        coverage: committed.coverage ?? { tracks: "complete" },
      },
      summary: `Merged ${executions.length} hidden physical track chunk(s) and committed one complete logical scope.`,
    };
  }

  return hydrationFailure(
    "PROJECT_INDEX_LOGICAL_REFRESH_RETRY_EXHAUSTED",
    "Complete track hydration exhausted its bounded retry policy without a stable REAPER revision.",
    [],
    { executions, artifactRefs, evidenceRefs },
  );
}

async function runCompleteAutomationRefresh({
  request,
  projectIndexRuntime,
  executeAtomic,
  expectedRevision,
  now = () => new Date(),
}) {
  if (
    typeof projectIndexRuntime?.beginLogicalRefresh !== "function"
    || typeof projectIndexRuntime?.commitLogicalRefresh !== "function"
    || typeof projectIndexRuntime?.abortLogicalRefresh !== "function"
  ) {
    return hydrationFailure(
      "PROJECT_INDEX_LOGICAL_REFRESH_UNAVAILABLE",
      "Complete Automation hydration requires the managed Project Index logical-refresh transaction runtime.",
    );
  }
  if (typeof expectedRevision !== "string") {
    return hydrationFailure(
      "PROJECT_INDEX_REFRESH_REVISION_REQUIRED",
      "Complete Automation hydration requires a validated REAPER revision before reading Envelope pages.",
    );
  }

  const executions = [];
  const artifactRefs = [];
  const evidenceRefs = [];
  let revisionProbeCount = 0;
  let attemptRevision = expectedRevision;

  for (let attempt = 1; attempt <= PROJECT_INDEX_LOGICAL_REFRESH_ATTEMPTS; attempt += 1) {
    const begun = projectIndexRuntime.beginLogicalRefresh({
      scopes: ["automation"],
      expected_revision: attemptRevision,
      observed_at: safeNowIso(now),
    });
    if (begun?.ok !== true || typeof begun.transaction_id !== "string") {
      return hydrationFailure(
        begun?.blockers?.[0]?.code ?? "PROJECT_INDEX_LOGICAL_REFRESH_BEGIN_FAILED",
        begun?.blockers?.[0]?.message ?? "Project Index logical Automation refresh could not begin.",
        begun?.blockers ?? [],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const transactionId = begun.transaction_id;
    const attemptExecutionStart = executions.length;
    let cursor = 0;
    let declaredEnvelopeCount = null;
    let completed = false;

    for (let pageIndex = 0; pageIndex < PROJECT_INDEX_MAX_AUTOMATION_PAGES; pageIndex += 1) {
      const child = automationInventoryRequest(cursor);
      const execution = await executeAtomic({
        id: child.id,
        input: child.input,
        refs: child.refs,
        context: request.context,
        budget: PROJECT_INDEX_HYDRATION_BUDGET,
        observeProjectIndex: true,
        projectIndexObservationContext: {
          logical_refresh: {
            transaction_id: transactionId,
            scope: "automation",
            envelope_cursor: cursor,
            revision: attemptRevision,
          },
        },
      });
      executions.push(execution);
      evidenceRefs.push(...executionEvidenceRefs(execution));
      artifactRefs.push(...executionArtifactRefs(execution));
      if (execution?.ok !== true || execution?.result?.project_index_observation?.ok !== true) {
        projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "automation_page_observation_failed", observed_at: safeNowIso(now) });
        const failed = execution?.ok === true
          ? {
              error: {
                code: execution.result?.project_index_observation?.blockers?.[0]?.code ?? "PROJECT_INDEX_OBSERVATION_FAILED",
                message: "An Automation inventory page was not accepted into logical-refresh staging.",
              },
              blockers: execution.result?.project_index_observation?.blockers ?? [],
            }
          : readFailure(child.id, execution);
        return hydrationFailure(failed.error.code, failed.error.message, failed.blockers, { executions, artifactRefs, evidenceRefs });
      }

      const readback = executionReadback(execution);
      const pageFacts = automationPageFacts(readback, cursor, declaredEnvelopeCount);
      if (!pageFacts.ok) {
        projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: pageFacts.code, observed_at: safeNowIso(now) });
        return hydrationFailure(pageFacts.code, pageFacts.message, [pageFacts.blocker], { executions, artifactRefs, evidenceRefs });
      }
      declaredEnvelopeCount = pageFacts.envelope_count;
      if (!pageFacts.truncated) {
        completed = true;
        break;
      }
      cursor = pageFacts.next_cursor;
    }

    if (!completed) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "automation_page_limit_exceeded", observed_at: safeNowIso(now) });
      return hydrationFailure(
        "PROJECT_INDEX_AUTOMATION_PAGE_LIMIT_EXCEEDED",
        `Complete Automation hydration exceeded ${PROJECT_INDEX_MAX_AUTOMATION_PAGES} hidden pages and was not committed.`,
        [],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const postRevision = await runRevisionProbe({ request, projectIndexRuntime, executeAtomic });
    revisionProbeCount += 1;
    evidenceRefs.push(...(postRevision.evidenceRefs ?? []));
    artifactRefs.push(...(postRevision.artifactRefs ?? []));
    if (!postRevision.ok) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "post_revision_probe_failed", observed_at: safeNowIso(now) });
      return hydrationFailure(postRevision.error.code, postRevision.error.message, postRevision.blockers, { executions, artifactRefs, evidenceRefs });
    }

    const observedRevision = revisionKey(postRevision);
    if (observedRevision !== attemptRevision) {
      projectIndexRuntime.abortLogicalRefresh({ transaction_id: transactionId, reason: "revision_changed_during_refresh", observed_at: safeNowIso(now) });
      if (attempt < PROJECT_INDEX_LOGICAL_REFRESH_ATTEMPTS && typeof observedRevision === "string") {
        attemptRevision = observedRevision;
        continue;
      }
      return hydrationFailure(
        "PROJECT_INDEX_REFRESH_REVISION_CHANGED",
        "REAPER changed while Automation inventory pages were being read; the mixed snapshot was discarded.",
        [{
          code: "PROJECT_INDEX_REFRESH_REVISION_CHANGED",
          message: `Expected ${attemptRevision}, observed ${String(observedRevision)} after hydration.`,
          recoverable: true,
        }],
        { executions, artifactRefs, evidenceRefs },
      );
    }

    const committed = projectIndexRuntime.commitLogicalRefresh({
      transaction_id: transactionId,
      observed_revision: observedRevision,
      observed_at: safeNowIso(now),
    });
    if (committed?.ok !== true) {
      return hydrationFailure(
        committed?.blockers?.[0]?.code ?? "PROJECT_INDEX_LOGICAL_REFRESH_COMMIT_FAILED",
        committed?.blockers?.[0]?.message ?? "Complete Automation hydration could not be committed atomically.",
        committed?.blockers ?? [],
        { executions, artifactRefs, evidenceRefs },
      );
    }
    return {
      ok: true,
      executions,
      artifactRefs: unique(artifactRefs),
      evidenceRefs: unique(evidenceRefs),
      blockers: [],
      error: null,
      revisionProbeCount,
      logicalRefresh: {
        status: "committed",
        transaction_id: transactionId,
        attempt_count: attempt,
        page_count: executions.length - attemptExecutionStart,
        expected_revision: attemptRevision,
        observed_revision: observedRevision,
        declared_envelope_count: declaredEnvelopeCount,
        applied_scopes: committed.applied_scopes ?? ["automation"],
        row_counts: committed.row_counts ?? {},
        coverage: committed.coverage ?? { automation: "complete" },
      },
      summary: `Merged ${executions.length - attemptExecutionStart} hidden Automation inventory page(s) and committed one complete logical scope.`,
    };
  }

  return hydrationFailure(
    "PROJECT_INDEX_LOGICAL_REFRESH_RETRY_EXHAUSTED",
    "Complete Automation hydration exhausted its bounded retry policy without a stable REAPER revision.",
    [],
    { executions, artifactRefs, evidenceRefs },
  );
}

async function runRevisionProbe({ request, projectIndexRuntime, executeAtomic }) {
  const execution = await executeAtomic({
    id: READ_SUMMARY_ID,
    input: { include_counts: true },
    refs: [],
    context: request.context,
    budget: internalReadBudget(request),
    observeProjectIndex: false,
  });
  if (execution?.ok !== true) return readFailure(READ_SUMMARY_ID, execution);
  const readback = executionReadback(execution);
  const changeCount = Number.isInteger(readback?.change_count) ? readback.change_count : null;
  if (changeCount === null) {
    return {
      ok: false,
      readback,
      evidenceRefs: executionEvidenceRefs(execution),
      blockers: [{
        code: "PROJECT_REVISION_MISSING",
        message: "template.project.read_summary did not return an integer change_count.",
        recoverable: true,
      }],
      error: {
        code: "PROJECT_REVISION_MISSING",
        message: "The live project revision probe returned no usable change_count.",
        recoverable: true,
      },
      summary: "Live project revision probe failed closed.",
    };
  }
  const reconciliation = typeof projectIndexRuntime?.reconcileProjectRevision === "function"
    ? projectIndexRuntime.reconcileProjectRevision({
        change_count: changeCount,
        project_ref: readback.project_ref,
        observed_at: execution.completed_at,
      })
    : null;
  if (reconciliation?.ok === false) {
    return {
      ok: false,
      readback,
      evidenceRefs: executionEvidenceRefs(execution),
      blockers: reconciliation.blockers ?? [],
      error: {
        code: reconciliation.blockers?.[0]?.code ?? "PROJECT_REVISION_RECONCILE_FAILED",
        message: "Project revision could not be reconciled with the Project Index.",
        recoverable: true,
      },
      summary: "Live project revision reconciliation failed closed.",
    };
  }
  return {
    ok: true,
    execution,
    readback,
    reconciliation,
    evidenceRefs: executionEvidenceRefs(execution),
    artifactRefs: executionArtifactRefs(execution),
    blockers: [],
    error: null,
    summary: reconciliation?.changed === true
      ? `REAPER project revision changed to ${changeCount}; dependent SQLite scopes were invalidated.`
      : `REAPER project revision ${changeCount} matches the active Project Index identity.`,
  };
}

async function runHydrationRequests({ requests, request, projectIndexRuntime, executeAtomic, seen = new Set(), objectRefs = new Map() }) {
  const executions = [];
  const artifactRefs = [];
  const evidenceRefs = [];
  for (const child of requests) {
    if (!isObject(child) || typeof child.id !== "string" || !HYDRATION_TEMPLATE_IDS.has(child.id)) {
      return hydrationFailure(
        "PROJECT_INDEX_REFRESH_DEPENDENCY_REJECTED",
        "The code-owned refresh plan referenced a dependency outside the registered read-only allowlist.",
        [{
          code: "PROJECT_INDEX_REFRESH_DEPENDENCY_REJECTED",
          message: `Rejected refresh dependency ${String(child?.id)}.`,
          recoverable: false,
        }],
        { executions, artifactRefs, evidenceRefs },
      );
    }
    const internalChild = internalHydrationRequest(child);
    const fingerprint = JSON.stringify([internalChild.id, internalChild.input, internalChild.refs]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const execution = await executeAtomic({
      id: internalChild.id,
      input: internalChild.input,
      refs: materializeHydrationRefs(internalChild.refs, objectRefs),
      context: request.context,
      budget: PROJECT_INDEX_HYDRATION_BUDGET,
      observeProjectIndex: true,
    });
    executions.push(execution);
    evidenceRefs.push(...executionEvidenceRefs(execution));
    artifactRefs.push(...executionArtifactRefs(execution));
    if (execution?.ok !== true) {
      const failed = readFailure(child.id, execution);
      return hydrationFailure(failed.error.code, failed.error.message, failed.blockers, {
        executions,
        artifactRefs,
        evidenceRefs,
      });
    }
    rememberHydrationObjectRefs(objectRefs, execution);
    const observation = execution?.result?.project_index_observation;
    if (observation?.ok !== true) {
      return hydrationFailure(
        observation?.blockers?.[0]?.code ?? "PROJECT_INDEX_OBSERVATION_FAILED",
        `Read-only refresh ${child.id} completed but was not accepted into the Project Index.`,
        observation?.blockers ?? [],
        { executions, artifactRefs, evidenceRefs },
      );
    }
  }
  return {
    ok: true,
    executions,
    artifactRefs: unique(artifactRefs),
    evidenceRefs: unique(evidenceRefs),
    blockers: [],
    error: null,
    summary: executions.length > 0
      ? `Executed ${executions.length} bounded read-only Project Index refresh call(s).`
      : "No new refresh dependency was required.",
  };
}

function materializeHydrationRefs(refs, objectRefs) {
  const visit = (value) => {
    if (typeof value === "string") {
      const objectRef = objectRefs.get(value);
      return objectRef ? structuredClone(objectRef) : exactGuidHydrationObjectRef(value) ?? value;
    }
    if (Array.isArray(value)) return value.map(visit);
    if (isObject(value) && typeof value.kind === "string" && typeof value.ref === "string") return structuredClone(value);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, visit(child)]));
    return value;
  };
  return visit(refs);
}

function exactGuidHydrationObjectRef(ref) {
  const match = typeof ref === "string"
    ? /^([a-z_]+):guid:(\{[^{}\r\n]{1,128}\})$/u.exec(ref)
    : null;
  if (!match || !EXACT_GUID_HYDRATION_REF_KINDS.has(match[1])) return null;
  return {
    kind: match[1],
    ref,
    identity: { scheme: "guid", value: match[2] },
  };
}

function rememberHydrationObjectRefs(objectRefs, execution) {
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isObject(value)) return;
    if (typeof value.kind === "string" && typeof value.ref === "string") {
      objectRefs.set(value.ref, structuredClone(value));
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
}

function internalHydrationRequest(child) {
  const input = clone(child.input ?? {});
  if (child.id === OBSERVATION_BUNDLE_ID || child.id === "template.project.create_project_map_snapshot") {
    input.max_tracks = Math.max(
      Number.isInteger(input.max_tracks) ? input.max_tracks : 0,
      PROJECT_INDEX_HYDRATION_TRACK_LIMIT,
    );
  }
  if (child.id === "template.tracks.list_tracks" || child.id === "template.tracks.read_mixer_controls") {
    input.limit = Math.max(
      Number.isInteger(input.limit) ? input.limit : 0,
      PROJECT_INDEX_HYDRATION_TRACK_LIMIT,
    );
  }
  return {
    id: child.id,
    input,
    refs: clone(child.refs ?? []),
  };
}

function refreshScopeForEntity(entity) {
  return {
    status: "project_head",
    selected_context: "selection",
    tracks: "tracks",
    items: "items",
    takes: "takes",
    fx: "fx",
    routing: "routing",
    automation: "automation",
    markers_regions: "markers",
    media_sources: "media",
    duplicates: "media",
  }[entity] ?? null;
}

async function runDirectRead({ id, input, request, executeAtomic }) {
  const execution = await executeAtomic({
    id,
    input,
    refs: [],
    context: request.context,
    budget: internalReadBudget(request),
    observeProjectIndex: false,
  });
  if (execution?.ok !== true) return readFailure(id, execution);
  return {
    ok: true,
    execution,
    readback: executionReadback(execution),
    evidenceRefs: executionEvidenceRefs(execution),
    artifactRefs: executionArtifactRefs(execution),
    blockers: [],
    error: null,
    summary: `${id} completed through the configured OpenReaper live route.`,
  };
}

function successEnvelope({
  entry,
  request,
  startedAt,
  now,
  stages,
  projectIndexRuntime,
  initialCold,
  refreshed,
  summary,
  canonicalRefs,
  artifactRefs,
  data,
}) {
  const status = runtimeStatus(projectIndexRuntime);
  const activeBudget = responseBudget(request, entry);
  const source = refreshed
    ? initialCold ? "cold_hydration" : "refreshed_index"
    : "warm_index";
  const freshness = refreshed && !initialCold ? "refreshed" : "fresh";
  return finalizeMacroEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: macroIdentity(entry),
    request: macroRequestSummary(request),
    execution: {
      status: "completed",
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: stages.length,
      stages,
    },
    sqlite: {
      used: true,
      source,
      freshness,
      snapshot_ref: status.snapshot_id ?? null,
      revision: status.revision ?? status.project_revision ?? null,
      refreshed: refreshed && !initialCold,
    },
    result: {
      summary,
      canonical_refs: unique(canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: [],
      verification: { status: "passed", evidence_refs: [] },
      artifact_refs: unique(artifactRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: boundedData(data),
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: {
      max_bytes: activeBudget,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  });
}

function blockedEnvelope({
  entry,
  request,
  startedAt,
  now,
  stages,
  status,
  code,
  message,
  blockers = [],
  data = {},
}) {
  const activeBudget = responseBudget(request, entry);
  return finalizeMacroEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: macroRequestSummary(request),
    execution: {
      status: "blocked",
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: stages.length,
      stages,
    },
    sqlite: sqliteEvidenceFromStatus(status),
    result: {
      summary: message,
      canonical_refs: [],
      changes: [],
      verification: { status: "not_required", evidence_refs: [] },
      artifact_refs: [],
      data: boundedData(data),
    },
    blockers: boundedBlockers(blockers),
    error: { code, message, recoverable: true },
    recovery: {
      action: "Reconnect the managed OpenReaper bridge or fix the reported bounded input, then retry the same Macro.",
      sqlite_rows_authorize_writes: false,
    },
    budget: {
      max_bytes: activeBudget,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  });
}

function executionFailure({
  entry,
  request,
  startedAt,
  now,
  stages,
  projectIndexRuntime,
  error,
  blockers = [],
  data = {},
}) {
  const activeBudget = responseBudget(request, entry);
  return finalizeMacroEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: macroRequestSummary(request),
    execution: {
      status: "failed",
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: stages.length,
      stages,
    },
    sqlite: sqliteEvidenceFromStatus(runtimeStatus(projectIndexRuntime)),
    result: {
      summary: error?.message ?? "Project-understanding Macro failed.",
      canonical_refs: [],
      changes: [],
      verification: { status: "not_required", evidence_refs: [] },
      artifact_refs: [],
      data: boundedData(data),
    },
    blockers: boundedBlockers(blockers),
    error: {
      code: error?.code ?? "PROJECT_UNDERSTANDING_FAILED",
      message: error?.message ?? "Project-understanding Macro failed.",
      recoverable: error?.recoverable !== false,
    },
    recovery: {
      action: "Use ping or openreaper-doctor to restore the managed bridge/index route, then retry the same Macro.",
      stale_sqlite_rows_used_for_write: false,
    },
    budget: {
      max_bytes: activeBudget,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  });
}

function finalizeMacroEnvelope(envelope) {
  const result = structuredClone(envelope);
  updateActualBytes(result);
  let validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid
    && result.ok === true
    && result.macro?.id === ALPHA3_2D_GENERIC_PROJECT_QUERY_ID
    && result.budget.actual_bytes > result.budget.max_bytes) {
    compactProjectQueryEnvelope(result);
    updateActualBytes(result);
    validation = validateMacroExecutionEnvelope(result);
  }
  if (!validation.valid && result.budget.actual_bytes > result.budget.max_bytes) {
    return finalizeResponseBudgetFailure(result);
  }
  if (!validation.valid) {
    throw new TypeError(`Invalid Alpha3.2.5-B Macro envelope: ${validation.errors.join("; ")}`);
  }
  return deepFreeze(result);
}

function compactProjectQueryEnvelope(envelope) {
  envelope.execution.stages = [];
  envelope.execution.stage_count = 0;
  envelope.result.canonical_refs = [];
  envelope.result.artifact_refs = [];
  envelope.result.data = compactQueryTruth(envelope.result.data);
}

function compactQueryTruth(data) {
  const source = isObject(data) ? data : {};
  const refresh = isObject(source.refresh) ? source.refresh : null;
  return compactObject({
    projection: "minimum_query_truth",
    entity: source.entity,
    rows: clone(source.rows ?? []),
    rows_truncated_by_macro_budget: source.rows_truncated_by_macro_budget,
    coverage: compactObject({
      complete: source.coverage?.complete,
      known_total_row_count: source.coverage?.known_total_row_count,
      indexed_row_count: source.coverage?.indexed_row_count,
      public_returned_row_count: source.coverage?.public_returned_row_count,
    }),
    page: compactObject({
      next_cursor: source.page?.next_cursor,
      has_more: source.page?.has_more,
    }),
    sqlite_authorizes_writes: source.refs_truth?.sqlite_authorizes_writes ?? false,
    refresh: refresh?.attempted !== true ? undefined : compactObject({
      attempted: refresh.attempted,
      call_count: refresh.call_count,
      revision_probe_count: refresh.revision_probe_count,
      logical_refresh: compactLogicalRefresh(refresh.logical_refresh),
    }),
  });
}

function compactLogicalRefresh(value) {
  if (!isObject(value)) return null;
  return compactObject({
    status: value.status,
    coverage: clone(value.coverage ?? {}),
  });
}

function finalizeResponseBudgetFailure(source) {
  const originalBytes = source.budget.actual_bytes;
  const result = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: clone(source.macro),
    request: clone(source.request),
    execution: {
      status: "failed",
      started_at: source.execution.started_at,
      completed_at: source.execution.completed_at,
      stage_count: 0,
      stages: [],
    },
    sqlite: {
      used: source.sqlite.used,
      source: source.sqlite.source,
      freshness: source.sqlite.freshness,
      snapshot_ref: source.sqlite.snapshot_ref,
      revision: source.sqlite.revision,
      refreshed: source.sqlite.refreshed,
    },
    result: {
      summary: "The requested Project Index projection exceeds the response budget.",
      canonical_refs: [],
      changes: [],
      verification: { status: "not_required", evidence_refs: [] },
      artifact_refs: [],
      data: { required_bytes: originalBytes, max_bytes: source.budget.max_bytes },
    },
    blockers: [{
      code: "RESPONSE_TOO_LARGE",
      message: "Use a smaller page or narrower fields; internal Project Index rows remain intact.",
      recoverable: true,
    }],
    error: {
      code: "RESPONSE_TOO_LARGE",
      message: "Project Index query result exceeds max_response_bytes.",
      recoverable: true,
    },
    recovery: {
      action: "Retry with a smaller limit or narrower fields; do not treat omitted public rows as absent from the index.",
      sqlite_rows_authorize_writes: false,
    },
    budget: {
      max_bytes: source.budget.max_bytes,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  };
  updateActualBytes(result);
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) {
    throw new TypeError(`Invalid Alpha3.2.5-B response-budget envelope: ${validation.errors.join("; ")}`);
  }
  return deepFreeze(result);
}

function updateActualBytes(value) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    value.budget.actual_bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  }
}

function responseBudget(request, entry) {
  const standard = request?.budget?.max_response_bytes;
  const alias = request?.budget?.max_bytes;
  const candidates = [standard, alias].filter((value) =>
    Number.isInteger(value)
      && value >= MINIMUM_PUBLIC_QUERY_BUDGET
      && value <= entry.result_budget.max_bytes
  );
  const requested = candidates.length > 0 ? Math.min(...candidates) : undefined;
  return Number.isInteger(requested)
    ? requested
    : entry.result_budget.max_bytes;
}

function projectQueryBudgetConflict(request) {
  const budget = request?.budget;
  if (!isObject(budget)
    || !Object.hasOwn(budget, "max_response_bytes")
    || !Object.hasOwn(budget, "max_bytes")
    || budget.max_response_bytes === budget.max_bytes) {
    return null;
  }
  return {
    code: "PROJECT_QUERY_BUDGET_CONFLICT",
    message: "budget.max_response_bytes and budget.max_bytes must match when both are provided.",
    recoverable: true,
    details: {
      max_response_bytes: budget.max_response_bytes,
      max_bytes: budget.max_bytes,
    },
  };
}

function publicQueryInput(request) {
  const input = clone(request?.input ?? {});
  const requestedLimit = input.limit === undefined ? 25 : input.limit;
  if (!Number.isInteger(requestedLimit) || requestedLimit < 1) return input;
  const publicMaxItems = Number.isInteger(request?.budget?.max_items) && request.budget.max_items > 0
    ? request.budget.max_items
    : requestedLimit;
  return {
    ...input,
    limit: Math.min(requestedLimit, publicMaxItems, MAX_EXACT_SELECTOR_REFS),
  };
}

function internalReadBudget(request) {
  return {
    ...PROJECT_INDEX_HYDRATION_BUDGET,
    max_items: Math.max(
      PROJECT_INDEX_HYDRATION_BUDGET.max_items,
      Number.isInteger(request?.budget?.max_items) ? request.budget.max_items : 0,
    ),
  };
}

function queryData(plan, hydration = null) {
  const rows = boundedRows(plan?.rows);
  return boundedData({
    entity: plan?.entity ?? null,
    rows: rows.rows,
    returned_row_count: rows.rows.length,
    available_row_count: Array.isArray(plan?.rows) ? plan.rows.length : 0,
    rows_truncated_by_macro_budget: rows.truncated,
    freshness: clone(plan?.freshness ?? {}),
    coverage: clone(plan?.coverage ?? {}),
    page: clone(plan?.page ?? null),
    refs_truth: {
      posture: "candidate_refs_from_project_index",
      sqlite_authorizes_writes: false,
      write_requires_live_re_resolution: Array.isArray(plan?.refs) && plan.refs.length > 0,
    },
    index: clone(plan?.index_status ?? {}),
    ...(hydration ? { refresh: hydrationEvidence(hydration) } : {}),
  });
}

function projectSummaryData(readback, projectIndexRuntime) {
  return compactObject({
    ref: readback?.project_ref ?? runtimeStatus(projectIndexRuntime).project_ref,
    name: readback?.name,
    path: readback?.path ?? runtimeStatus(projectIndexRuntime).project_path,
    length_seconds: readback?.length_seconds,
    sample_rate: readback?.sample_rate,
    change_count: readback?.change_count,
    track_count: readback?.track_count,
    item_count: readback?.item_count,
    marker_count: readback?.marker_count,
    region_count: readback?.region_count,
  });
}

function compactIndexStatus(projectIndexRuntime) {
  const status = runtimeStatus(projectIndexRuntime);
  return compactObject({
    lifecycle: status.lifecycle,
    backend: status.backend,
    snapshot_id: status.snapshot_id,
    revision: status.revision ?? status.project_revision,
    freshness: status.freshness,
    row_counts: status.row_counts,
    recovery: status.recovery,
    sqlite_rows_are_candidates_only: true,
  });
}

function hydrationEvidence(hydration) {
  return {
    attempted: hydration.executions.length > 0,
    call_count: hydration.executions.length,
    template_ids: unique(hydration.executions.map((execution) => execution?.template?.id).filter(Boolean)),
    artifact_refs: hydration.artifactRefs,
    revision_probe_count: hydration.revisionProbeCount ?? 0,
    logical_refresh: hydration.logicalRefresh ?? null,
  };
}

function coldObservationBundleRequest(trackCursor = 0) {
  return {
    id: OBSERVATION_BUNDLE_ID,
    input: {
      max_tracks: PROJECT_INDEX_HYDRATION_TRACK_LIMIT,
      max_items_per_track: 4,
      max_selected_items: 32,
      track_cursor: trackCursor,
      marker_region_limit: 128,
      tempo_marker_limit: 64,
      include_transport: false,
      include_track_items: true,
    },
    refs: [],
    read_only: true,
  };
}

function automationInventoryRequest(envelopeCursor = 0) {
  return {
    id: AUTOMATION_INVENTORY_ID,
    input: {
      parent_kinds: ["track", "take", "send", "fx"],
      limit: PROJECT_INDEX_HYDRATION_AUTOMATION_LIMIT,
      ...(envelopeCursor > 0 ? { cursor: String(envelopeCursor) } : {}),
    },
    refs: [],
    read_only: true,
  };
}

function revisionKey(probe) {
  const changeCount = probe?.readback?.change_count;
  return Number.isInteger(changeCount) && changeCount >= 0
    ? `reaper-change-count:${changeCount}`
    : null;
}

function trackChunkFacts(readback, expectedCursor, priorTrackCount) {
  const trackCount = readback?.track_count;
  const trackCursor = readback?.track_cursor;
  const returnedTrackCount = readback?.returned_track_count;
  const truncated = readback?.map_truncated;
  const invalid = (code, message, details = {}) => ({
    ok: false,
    code,
    message,
    blocker: { code, message, recoverable: true, details },
  });
  if (!Number.isInteger(trackCount) || trackCount < 0) {
    return invalid("PROJECT_INDEX_TRACK_COUNT_INVALID", "A hidden track chunk did not report a non-negative REAPER track_count.");
  }
  if (priorTrackCount !== null && trackCount !== priorTrackCount) {
    return invalid(
      "PROJECT_INDEX_TRACK_COUNT_CHANGED",
      "REAPER track_count changed between hidden physical chunks.",
      { expected_track_count: priorTrackCount, observed_track_count: trackCount },
    );
  }
  if (!Number.isInteger(trackCursor) || trackCursor !== expectedCursor) {
    return invalid(
      "PROJECT_INDEX_TRACK_CURSOR_MISMATCH",
      "A hidden track chunk did not echo the requested cursor.",
      { expected_cursor: expectedCursor, observed_cursor: trackCursor },
    );
  }
  if (!Number.isInteger(returnedTrackCount) || returnedTrackCount < 0) {
    return invalid("PROJECT_INDEX_RETURNED_TRACK_COUNT_INVALID", "A hidden track chunk did not report a non-negative returned_track_count.");
  }
  if (typeof truncated !== "boolean") {
    return invalid("PROJECT_INDEX_TRACK_TRUNCATION_INVALID", "A hidden track chunk did not report map_truncated truthfully.");
  }
  if (!truncated && trackCursor + returnedTrackCount < trackCount) {
    return invalid(
      "PROJECT_INDEX_TRACK_CHUNK_INCOMPLETE",
      "The final hidden track chunk ended before the declared REAPER track total.",
      { track_count: trackCount, track_cursor: trackCursor, returned_track_count: returnedTrackCount },
    );
  }
  if (!truncated) {
    return { ok: true, track_count: trackCount, truncated: false, next_cursor: null };
  }
  const nextCursor = typeof readback.next_track_cursor === "string" && /^(?:0|[1-9][0-9]*)$/u.test(readback.next_track_cursor)
    ? Number(readback.next_track_cursor)
    : Number.isInteger(readback.next_track_cursor)
      ? readback.next_track_cursor
      : null;
  if (!Number.isInteger(nextCursor) || nextCursor <= expectedCursor || nextCursor > trackCount) {
    return invalid(
      "PROJECT_INDEX_TRACK_CURSOR_NO_PROGRESS",
      "A truncated hidden track chunk did not provide a strictly advancing next_track_cursor.",
      { expected_cursor: expectedCursor, next_track_cursor: readback.next_track_cursor, track_count: trackCount },
    );
  }
  return { ok: true, track_count: trackCount, truncated: true, next_cursor: nextCursor };
}

function automationPageFacts(readback, expectedCursor, priorEnvelopeCount) {
  const envelopeCount = readback?.total_count;
  const returnedEnvelopeCount = readback?.returned_count;
  const truncated = readback?.truncated;
  const coverageStatus = readback?.coverage_status;
  const internallyComplete = readback?.coverage?.internally_complete;
  const rows = Array.isArray(readback?.envelopes) ? readback.envelopes : [];
  const invalid = (code, message, details = {}) => ({
    ok: false,
    code,
    message,
    blocker: { code, message, recoverable: true, details },
  });
  if (!Number.isInteger(envelopeCount) || envelopeCount < 0) {
    return invalid("PROJECT_INDEX_AUTOMATION_COUNT_INVALID", "A hidden Automation page did not report a non-negative total_count.");
  }
  if (priorEnvelopeCount !== null && envelopeCount !== priorEnvelopeCount) {
    return invalid(
      "PROJECT_INDEX_AUTOMATION_COUNT_CHANGED",
      "REAPER Envelope total_count changed between hidden Automation pages.",
      { expected_envelope_count: priorEnvelopeCount, observed_envelope_count: envelopeCount },
    );
  }
  if (!Number.isInteger(returnedEnvelopeCount) || returnedEnvelopeCount < 0 || returnedEnvelopeCount !== rows.length) {
    return invalid(
      "PROJECT_INDEX_RETURNED_AUTOMATION_COUNT_INVALID",
      "A hidden Automation page returned_count did not match its Envelope rows.",
      { returned_count: returnedEnvelopeCount, row_count: rows.length },
    );
  }
  if (typeof truncated !== "boolean" || internallyComplete !== true) {
    return invalid(
      "PROJECT_INDEX_AUTOMATION_COVERAGE_UNKNOWN",
      "A hidden Automation page did not prove complete internal REAPER enumeration.",
      { truncated, coverage_status: coverageStatus, internally_complete: internallyComplete },
    );
  }
  const rawNextCursor = readback?.next_cursor;
  const nextCursor = rawNextCursor === null || rawNextCursor === undefined
    ? null
    : typeof rawNextCursor === "string" && /^(?:0|[1-9][0-9]*)$/u.test(rawNextCursor)
      ? Number(rawNextCursor)
      : Number.isInteger(rawNextCursor)
        ? rawNextCursor
        : null;
  if (truncated) {
    const expectedNextCursor = expectedCursor + returnedEnvelopeCount;
    if (coverageStatus !== "paged" || nextCursor !== expectedNextCursor || nextCursor > envelopeCount) {
      return invalid(
        "PROJECT_INDEX_AUTOMATION_CURSOR_NO_PROGRESS",
        "A paged hidden Automation read did not provide the exact next Envelope cursor.",
        { expected_cursor: expectedCursor, expected_next_cursor: expectedNextCursor, next_cursor: rawNextCursor, envelope_count: envelopeCount },
      );
    }
    return { ok: true, envelope_count: envelopeCount, truncated: true, next_cursor: nextCursor };
  }
  if (coverageStatus !== "complete" || nextCursor !== null || expectedCursor + returnedEnvelopeCount !== envelopeCount) {
    return invalid(
      "PROJECT_INDEX_AUTOMATION_PAGE_INCOMPLETE",
      "The final hidden Automation page did not end at the declared complete Envelope total.",
      { expected_cursor: expectedCursor, returned_count: returnedEnvelopeCount, envelope_count: envelopeCount, coverage_status: coverageStatus, next_cursor: rawNextCursor },
    );
  }
  return { ok: true, envelope_count: envelopeCount, truncated: false, next_cursor: null };
}

function inspectEntities(include) {
  const result = [];
  if (include.includes("index_status")) result.push("status");
  if (include.includes("selected_context")) result.push("selected_context");
  if (include.includes("tracks")) result.push("tracks");
  if (include.includes("items")) result.push("items");
  if (include.includes("markers_regions")) result.push("markers_regions");
  return result;
}

function inspectFieldsInput(validationPlan, entity) {
  if (entity === "status") return {};
  const fields = validationPlan.fields_by_scope?.[entity] ?? validationPlan.fields;
  return Array.isArray(fields) && fields.length > 0 ? { fields } : {};
}

function hasNonRefreshBlockers(plan) {
  return nonRefreshBlockers(plan).length > 0;
}

function nonRefreshBlockers(plan) {
  if (plan?.ok === true) return [];
  const refreshCodes = new Set([
    "INDEX_NOT_READY",
    "INDEX_REFRESH_REQUIRED",
    "INDEX_COVERAGE_INCOMPLETE",
    "GENERIC_QUERY_REFRESH_REQUIRED",
  ]);
  return (plan?.blockers ?? []).filter((entry) => !refreshCodes.has(entry?.code));
}

function runtimeStatus(runtime) {
  if (typeof runtime?.status === "function") return runtime.status();
  return {
    ok: false,
    lifecycle: "not_configured",
    backend: "none",
    snapshot_id: null,
    revision: null,
    project_revision: null,
    row_counts: {},
    rows_available: false,
    blockers: [{
      code: "PROJECT_INDEX_NOT_CONFIGURED",
      message: "The managed Project Index runtime is not configured.",
      recoverable: true,
    }],
  };
}

function hasIndexedProjectRows(status) {
  if (status?.rows_available !== true) return false;
  return Object.entries(status.row_counts ?? {})
    .some(([scope, count]) => !["object_changes", "background_jobs"].includes(scope) && Number(count) > 0);
}

function sqliteEvidenceFromStatus(status) {
  const hasSnapshot = typeof status?.snapshot_id === "string";
  return {
    used: hasSnapshot,
    source: hasSnapshot ? "warm_index" : "not_used",
    freshness: hasSnapshot ? status.lifecycle === "ready" ? "fresh" : "stale" : "not_applicable",
    snapshot_ref: status?.snapshot_id ?? null,
    revision: status?.revision ?? status?.project_revision ?? null,
    refreshed: false,
  };
}

function emptyHydration(summary) {
  return {
    ok: true,
    executions: [],
    artifactRefs: [],
    evidenceRefs: [],
    blockers: [],
    error: null,
    summary,
  };
}

function hydrationFailure(code, message, blockers = [], partial = {}) {
  return {
    ok: false,
    executions: partial.executions ?? [],
    artifactRefs: unique(partial.artifactRefs ?? []),
    evidenceRefs: unique(partial.evidenceRefs ?? []),
    blockers: boundedBlockers(blockers.length > 0 ? blockers : [{ code, message, recoverable: true }]),
    error: { code, message, recoverable: true },
    summary: message,
  };
}

function readFailure(id, execution) {
  const error = execution?.error ?? {};
  const code = error.code ?? "PROJECT_UNDERSTANDING_CHILD_FAILED";
  const message = error.message ?? `${id} failed through the configured OpenReaper route.`;
  return {
    ok: false,
    execution,
    readback: null,
    evidenceRefs: executionEvidenceRefs(execution),
    artifactRefs: executionArtifactRefs(execution),
    blockers: [{ code, message, recoverable: error.recoverable !== false }],
    error: { code, message, recoverable: error.recoverable !== false },
    summary: message,
  };
}

function executionReadback(execution) {
  if (isObject(execution?.result?.readback)) return clone(execution.result.readback);
  if (isObject(execution?.result?.summary)) return clone(execution.result.summary);
  return {};
}

function executionEvidenceRefs(execution) {
  return unique([
    execution?.request?.id,
    ...executionArtifactRefs(execution),
  ].filter((value) => typeof value === "string" && value.length > 0));
}

function executionArtifactRefs(execution) {
  const candidates = [
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts : []),
    ...(Array.isArray(execution?.result?.refs) ? execution.result.refs : []),
    execution?.result?.summary?.artifact_ref,
  ];
  return unique(candidates.map((entry) => typeof entry === "string" ? entry : entry?.ref)
    .filter((ref) => typeof ref === "string" && ref.startsWith("artifact:")));
}

function boundedRows(rows) {
  const result = [];
  let bytes = 2;
  for (const row of Array.isArray(rows) ? rows : []) {
    const compact = compactRow(row);
    const rowBytes = Buffer.byteLength(JSON.stringify(compact), "utf8") + 1;
    if (bytes + rowBytes > MAX_RESULT_DATA_BYTES) return { rows: result, truncated: true };
    result.push(compact);
    bytes += rowBytes;
  }
  return { rows: result, truncated: false };
}

function compactRow(row) {
  if (!isObject(row)) return row;
  const result = {};
  for (const [key, value] of Object.entries(row)) {
    if (key === "summary" && isObject(value)) {
      const compactSummary = {};
      for (const [summaryKey, summaryValue] of Object.entries(value).slice(0, 16)) {
        if (typeof summaryValue === "string") compactSummary[summaryKey] = summaryValue.slice(0, 256);
        else if (typeof summaryValue === "number" || typeof summaryValue === "boolean" || summaryValue === null) compactSummary[summaryKey] = summaryValue;
      }
      result.summary = compactSummary;
      continue;
    }
    result[key] = typeof value === "string" ? value.slice(0, 512) : clone(value);
  }
  return result;
}

function boundedData(value) {
  if (!isObject(value)) return {};
  const cloned = clone(value);
  if (Buffer.byteLength(JSON.stringify(cloned), "utf8") <= MAX_RESULT_DATA_BYTES) return cloned;
  return {
    compacted: true,
    summary: "Detailed project-understanding data exceeded the inline Macro budget.",
    index: isObject(cloned.index) ? cloned.index : undefined,
    entity: typeof cloned.entity === "string" ? cloned.entity : undefined,
    returned_row_count: Number.isInteger(cloned.returned_row_count) ? cloned.returned_row_count : undefined,
    rows_truncated_by_macro_budget: true,
  };
}

function macroEntry({ macroId, programId, templateIds, stages }) {
  return {
    contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
    macro_id: macroId,
    program_id: programId,
    program_version: "1.0.0",
    implementation_status: "executable",
    risk: "read",
    input_schema: { type: "object", additionalProperties: false },
    selector_policy: {
      task_shaped: true,
      canonical_refs_optional_at_public_boundary: true,
      live_reresolve_before_write: true,
    },
    sqlite_policy: {
      mode: "hydrate_or_reuse",
      write_authority: false,
      identity_fields: ["project", "bridge_owner", "bridge_generation", "snapshot", "revision"],
    },
    dependencies: {
      template_ids: templateIds,
      runtime_capabilities: [ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY],
    },
    stages,
    undo_policy: "not_required",
    verification_policy: "required",
    dry_run_supported: false,
    result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
  };
}

function stage(id, kind) {
  return { id, kind, risk: "read", stop_on_error: true };
}

function templateStage(id, dependencyRef) {
  return { ...stage(id, "template_execute"), dependency_ref: dependencyRef };
}

function stageResult(id, kind, status, summary, evidenceRefs = []) {
  return {
    id,
    kind,
    status,
    summary,
    evidence_refs: unique(evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
  };
}

function macroProgramRequest(request) {
  return {
    macro_id: request.id,
    input: isObject(request.input) ? request.input : {},
    refs: request.refs ?? [],
    dry_run: false,
    response_budget: responseBudget(
      request,
      ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.get(request.id),
    ),
    ...(request.idempotency_key !== undefined ? { idempotency_key: request.idempotency_key } : {}),
  };
}

function macroRequestSummary(request) {
  const context = isObject(request.context) ? request.context : {};
  return {
    request_id: [
      "macro",
      request.id,
      context.session_id ?? "session",
      context.request_sequence ?? 0,
    ].join(":"),
    dry_run: false,
  };
}

function macroIdentity(entry) {
  return {
    id: entry.macro_id,
    program_id: entry.program_id,
    program_version: entry.program_version,
    risk: entry.risk,
  };
}

function firstBlockerCode(value, fallback) {
  return value?.blockers?.find((entry) => typeof entry?.code === "string")?.code ?? fallback;
}

function boundedBlockers(blockers) {
  return (Array.isArray(blockers) ? blockers : [])
    .slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count)
    .map((entry) => isObject(entry)
      ? {
          code: typeof entry.code === "string" ? entry.code : "PROJECT_UNDERSTANDING_BLOCKED",
          message: typeof entry.message === "string" ? entry.message : "Project-understanding operation is blocked.",
          recoverable: entry.recoverable !== false,
          ...(entry.details !== undefined ? { details: clone(entry.details) } : {}),
        }
      : { code: "PROJECT_UNDERSTANDING_BLOCKED", message: String(entry), recoverable: true });
}

function hasRefs(refs) {
  if (Array.isArray(refs)) return refs.length > 0;
  return isObject(refs) && Object.keys(refs).length > 0;
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function doctorStatusToken(value) {
  return String(value ?? "not_configured")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "_")
    .replace(/^_+|_+$/gu, "")
    .slice(0, 64) || "not_configured";
}

function unique(values) {
  return [...new Set(Array.isArray(values) ? values : [])];
}

function clone(value) {
  if (value === undefined) return undefined;
  return structuredClone(value);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {}
  return new Date().toISOString();
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
