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
const MAX_HYDRATION_CALLS = 16;
const MAX_RESULT_DATA_BYTES = 18_000;

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

  let plan = planAlpha3_2DGenericProjectQuery(request.input, {
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
  if (shouldProbeRevision) {
    const revision = await runRevisionProbe({
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
    plan = planAlpha3_2DGenericProjectQuery(request.input, {
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
    ? { ...request.input, refresh_policy: "never" }
    : request.input;
  plan = planAlpha3_2DGenericProjectQuery(finalInput, {
    projectIndex: projectIndexRuntime?.adapter,
    catalog,
  });
  const queryOk = plan.ok === true;
  stages.push(stageResult(
    "query-index-read",
    "sqlite_query",
    queryOk ? "completed" : "failed",
    queryOk
      ? `SQLite returned ${plan.rows.length} compact ${plan.entity} candidate row(s).`
      : "SQLite query remained blocked after the bounded refresh attempt.",
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
        code: firstBlockerCode(plan, "PROJECT_QUERY_BLOCKED"),
        message: "Project Index query could not produce fresh candidate rows.",
        recoverable: true,
      },
      blockers: plan.blockers,
      data: queryData(plan),
    });
  }

  stages.push(stageResult(
    "query-result-project",
    "result_project",
    "completed",
    "Projected bounded rows, canonical refs, freshness, coverage, and page evidence.",
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
    summary: `Project Index query completed for ${plan.entity}.`,
    canonicalRefs: plan.refs,
    artifactRefs: hydration.artifactRefs,
    data: queryData(plan, hydration),
  });
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

  const requestedEntities = inspectEntities(validationPlan.include);
  const needsHydration = initialCold || requestedEntities.some((entity) => {
    const planned = planAlpha3_2DGenericProjectQuery({
      entity,
      refresh_policy: "if_stale",
      limit: Math.min(validationPlan.limit, 100),
    }, { projectIndex: projectIndexRuntime?.adapter, catalog });
    return planned.ok !== true;
  });
  const hydration = needsHydration
    ? await runHydrationRequests({
        requests: [coldObservationBundleRequest(validationPlan.limit)],
        request,
        projectIndexRuntime,
        executeAtomic,
      })
    : emptyHydration("Matching fresh SQLite project state was reused.");
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
      ...(validationPlan.fields.length > 0 ? { fields: validationPlan.fields } : {}),
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
}) {
  const refreshPolicy = request.input?.refresh_policy ?? "if_stale";
  if (refreshPolicy === "never") return emptyHydration("Refresh policy forbids live hydration.");
  if (plan.ok && !forceColdBundle) return emptyHydration("Matching fresh SQLite rows were reused.");
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
  if (forceColdBundle) {
    const cold = await runHydrationRequests({
      requests: [coldObservationBundleRequest(request.input?.limit)],
      request,
      projectIndexRuntime,
      executeAtomic,
      seen,
    });
    if (!cold.ok) return cold;
    executions.push(...cold.executions);
    artifactRefs.push(...cold.artifactRefs);
    evidenceRefs.push(...cold.evidenceRefs);
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
    summary: executions.length > 0
      ? `Executed ${executions.length} bounded read-only Project Index refresh call(s).`
      : "Matching fresh SQLite rows were reused.",
  };
}

async function runRevisionProbe({ request, projectIndexRuntime, executeAtomic }) {
  const execution = await executeAtomic({
    id: READ_SUMMARY_ID,
    input: { include_counts: true },
    refs: [],
    context: request.context,
    budget: request.budget,
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

async function runHydrationRequests({ requests, request, projectIndexRuntime, executeAtomic, seen = new Set() }) {
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
    const fingerprint = JSON.stringify([child.id, child.input ?? {}, child.refs ?? {}]);
    if (seen.has(fingerprint)) continue;
    seen.add(fingerprint);
    const execution = await executeAtomic({
      id: child.id,
      input: child.input ?? {},
      refs: child.refs ?? [],
      context: request.context,
      budget: request.budget,
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

async function runDirectRead({ id, input, request, executeAtomic }) {
  const execution = await executeAtomic({
    id,
    input,
    refs: [],
    context: request.context,
    budget: request.budget,
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
      max_bytes: entry.result_budget.max_bytes,
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
      max_bytes: entry.result_budget.max_bytes,
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
      max_bytes: entry.result_budget.max_bytes,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  });
}

function finalizeMacroEnvelope(envelope) {
  const result = structuredClone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) {
    throw new TypeError(`Invalid Alpha3.2.5-B Macro envelope: ${validation.errors.join("; ")}`);
  }
  return deepFreeze(result);
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
  };
}

function coldObservationBundleRequest(limit) {
  const boundedLimit = Number.isInteger(limit) ? Math.max(1, Math.min(limit, 100)) : 50;
  return {
    id: OBSERVATION_BUNDLE_ID,
    input: {
      max_tracks: boundedLimit,
      max_items_per_track: 4,
      max_selected_items: 32,
      track_cursor: 0,
      marker_region_limit: 128,
      tempo_marker_limit: 64,
      include_transport: false,
      include_track_items: true,
    },
    refs: [],
    read_only: true,
  };
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

function hasNonRefreshBlockers(plan) {
  if (plan?.ok === true) return false;
  const refreshCodes = new Set([
    "INDEX_NOT_READY",
    "INDEX_REFRESH_REQUIRED",
    "GENERIC_QUERY_REFRESH_REQUIRED",
  ]);
  return (plan?.blockers ?? []).some((entry) => !refreshCodes.has(entry?.code));
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
