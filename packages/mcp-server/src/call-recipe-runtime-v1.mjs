import {
  EXECUTABLE_RECIPE_REVISION_CONTRACT,
  createExecutableDependencyCatalog,
  hashExecutableRecipeContent,
  normalizeExecutableRecipeRevision,
  sealExecutableRecipeRevision,
  validateExecutableRecipeDraft,
  validateExecutableRecipeRevision,
} from "../../core/src/executable-recipe-contract-v1.mjs";
import {
  ExecutableRecipeRevisionStoreError,
  buildExecutableRecipeRevisionIdentity,
  createExecutableRecipeRevisionStore,
} from "../../core/src/executable-recipe-revision-store-v1.mjs";
import {
  EXECUTABLE_RECIPE_EVIDENCE_CONTRACT,
  EXECUTABLE_RECIPE_RUN_CONTRACT,
  EXECUTABLE_RECIPE_RUN_BUDGETS,
  EXECUTABLE_RECIPE_RUN_ERROR_CODES,
  EXECUTABLE_RECIPE_RUN_OPERATIONS,
  ExecutableRecipeRunError,
  applyBindingsAfterStage,
  buildExactNextCall,
  buildExactRunRevisionIdentity,
  collectRecipeOutputs,
  compactStageEvidence,
  createExecutableRecipeEvidenceRef,
  createExecutableRecipeRunId,
  evaluateRunTrust,
  matchStoredRevisionIdentity,
  pageExecutableRecipeEvidence,
  preflightExecutableRecipeRevision,
  projectRunFailureEnvelope,
  projectRunSuccessEnvelope,
  rejectInlineExecutionPayload,
  resolveStageBindings,
  seedBindingValuesFromInputs,
} from "../../core/src/executable-recipe-run-v1.mjs";
import {
  TEMPLATE_EXECUTION_HARNESS_CONTRACT,
} from "../../core/src/template-execution-harness-v1.mjs";
import {
  GET_STATE_RUNTIME_CONTRACT,
} from "./get-state-runtime-v1.mjs";
import {
  MACRO_EXECUTION_CONTRACT,
  validateMacroExecutionEnvelope,
} from "./macro-runtime-contract-v1.mjs";

export const CALL_RECIPE_RUNTIME_CONTRACT = "call_recipe.runtime.v1";
export const CALL_RECIPE_TOOL_NAME = "call_recipe";

export const CALL_RECIPE_OPERATIONS = EXECUTABLE_RECIPE_RUN_OPERATIONS;
export const CALL_RECIPE_STAGE_RESULT_CONTRACT = "call_recipe.stage_result.v1";
export const CALL_RECIPE_CHECKPOINT_PROOF_CONTRACT = "call_recipe.checkpoint_proof.v1";

const COMPACT_FAILURE_PARTIAL_CHANGE_MAX_COUNT = 4;

export class CallRecipeRuntimeError extends Error {
  constructor(message, code = "PARAMS_INVALID", details = {}) {
    super(message);
    this.name = "CallRecipeRuntimeError";
    this.code = EXECUTABLE_RECIPE_RUN_ERROR_CODES.includes(code) ? code : "PARAMS_INVALID";
    this.details = details;
  }
}

export function createCallRecipeRuntime(options = {}) {
  const store = bindStore(options);
  const catalog = options.catalog ?? options.executableDependencyCatalog ?? store?.catalog ?? null;
  const dispatchers = normalizeDispatchers(options.dispatchers ?? options.runtimes ?? {});
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const evidenceStore = createEvidenceStore(options.evidenceStore);
  const runStore = createRunStore(options.runStore);
  const runtimeFactsProvider = normalizeRuntimeFactsProvider(options);

  return Object.freeze({
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    tool: CALL_RECIPE_TOOL_NAME,
    store,
    async call_recipe(request = {}) {
      return callRecipe(request, {
        store,
        catalog,
        dispatchers,
        now,
        evidenceStore,
        runStore,
        runtimeFactsProvider,
      });
    },
  });
}

export function createAuthoritativeRuntimeFactsProvider(options = {}) {
  const catalog = options.catalog;
  const projectInventoryProvider = options.projectInventoryProvider;
  const bridgeLivenessProvider = options.bridgeLivenessProvider;
  const riskGrantProvider = options.riskGrantProvider;
  const checkpointEvidenceProvider = options.checkpointEvidenceProvider;
  if (
    !catalog
    || typeof projectInventoryProvider !== "function"
    || typeof bridgeLivenessProvider !== "function"
    || typeof riskGrantProvider !== "function"
    || typeof checkpointEvidenceProvider !== "function"
  ) {
    throw new CallRecipeRuntimeError(
      "Authoritative runtime facts require bound catalog, project inventory, Bridge liveness, risk grant, and checkpoint evidence providers.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }

  return async ({ revision, operation, run_id, latest_checkpoint }) => {
    if (!isPlainObject(revision)) {
      throw new CallRecipeRuntimeError("Stored revision is unavailable for runtime facts.", "RUNTIME_FACTS_UNAVAILABLE");
    }
    let contentHash;
    try {
      contentHash = hashExecutableRecipeContent(revision.draft, { catalog });
    } catch (error) {
      throw new CallRecipeRuntimeError(
        "Stored revision content could not be independently hashed for runtime facts.",
        "RUNTIME_FACTS_UNAVAILABLE",
        { message: boundedText(error?.message, 160) },
      );
    }
    const identity = freeze({
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    });
    const providerContext = freeze({
      identity,
      operation: operation ?? null,
      run_id: run_id ?? null,
      latest_checkpoint: latest_checkpoint ?? null,
      recomputed_content_hash: contentHash,
    });
    const [inventory, liveness, riskGrants, checkpointEvidence] = await Promise.all([
      projectInventoryProvider(),
      bridgeLivenessProvider(),
      riskGrantProvider(providerContext),
      checkpointEvidenceProvider(providerContext),
    ]);
    if (!Array.isArray(riskGrants) || !Array.isArray(checkpointEvidence)) {
      throw new CallRecipeRuntimeError(
        "Authoritative risk grants or checkpoint evidence are unavailable.",
        "RUNTIME_FACTS_UNAVAILABLE",
      );
    }
    const projectIdentity = authoritativeActiveProjectIdentity(inventory);
    const bridgeIdentity = authoritativeBridgeIdentity(liveness);
    const lockedEntries = Array.isArray(revision.dependency_lock?.entries)
      ? revision.dependency_lock.entries
      : [];
    const currentDependencies = lockedEntries.map((entry) => {
      const current = entry.kind === "macro"
        ? catalog.getMacro?.(entry.id)
        : catalog.getTemplate?.(entry.id);
      return { entry, current };
    });

    return freeze({
      content_hash: contentHash,
      risk_grants: [...riskGrants],
      project_identity: projectIdentity,
      bridge_owner: bridgeIdentity.owner,
      bridge_generation: bridgeIdentity.generation,
      available_capabilities: [...(catalog.capabilities ?? [])],
      checkpoint_evidence: checkpointEvidence.map((item) => cloneJson(item)),
      dependency_versions: currentDependencies.map(({ entry, current }) => ({
        kind: entry.kind,
        id: entry.id,
        version: current?.version,
      })),
      dependency_descriptors: currentDependencies.map(({ entry, current }) => ({
        kind: entry.kind,
        id: entry.id,
        descriptor_hash: current?.descriptor_hash,
      })),
    });
  };
}

export async function callRecipe(request = {}, options = {}) {
  const startedAt = Date.now();
  try {
    if (!isPlainObject(request)) {
      throw new CallRecipeRuntimeError("call_recipe request must be an object.", "PARAMS_INVALID");
    }
    const operation = request.operation;
    if (typeof operation !== "string" || !CALL_RECIPE_OPERATIONS.includes(operation)) {
      throw new CallRecipeRuntimeError(
        `call_recipe.operation must be one of: ${CALL_RECIPE_OPERATIONS.join(", ")}.`,
        "OPERATION_INVALID",
        { operation },
      );
    }

    const store = options.store;
    if (!store && ["validate", "save", "list", "get", "delete", "run", "resume"].includes(operation)) {
      throw new CallRecipeRuntimeError(
        "call_recipe requires a bound executable recipe revision store.",
        "STORE_ERROR",
      );
    }

    const budget = normalizeCallRecipeBudget(request.budget);
    if (["save", "delete", "run", "resume"].includes(operation)) {
      assertMutationResponseBudget(budget, operation);
    }

    let response;
    switch (operation) {
      case "validate":
        response = opValidate(request, options);
        break;
      case "save":
        response = opSave(request, options);
        break;
      case "list":
        response = opList(request, options, budget);
        break;
      case "get":
        response = opGet(request, options);
        break;
      case "delete":
        response = opDelete(request, options);
        break;
      case "run":
        response = await opRun(request, options, { startedAt, resume: false, budget });
        break;
      case "resume":
        response = await opRun(request, options, { startedAt, resume: true, budget });
        break;
      default:
        throw new CallRecipeRuntimeError("Unsupported operation.", "OPERATION_INVALID");
    }
    return enforceCallRecipeResponseBudget(response, budget, { operation });
  } catch (error) {
    const response = finalizeError(error, request, options, startedAt);
    return enforceCallRecipeResponseBudget(response, safeCallRecipeBudget(request?.budget), {
      operation: request?.operation,
    });
  }
}

function opValidate(request, options) {
  const draft = request.draft ?? request.revision ?? request.input;
  if (!isPlainObject(draft)) {
    throw new CallRecipeRuntimeError("validate requires draft object.", "PARAMS_INVALID");
  }
  const catalog = requireCatalog(options);
  const result = draft.contract === EXECUTABLE_RECIPE_REVISION_CONTRACT
    ? validateExecutableRecipeRevision(draft, { catalog })
    : validateExecutableRecipeDraft(draft, { catalog });
  return freeze({
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    ok: result.ok,
    operation: "validate",
    status: result.ok ? "validated" : "failed",
    mutates_project: false,
    mutates_recipe_root: false,
    errors: result.ok ? [] : result.errors,
    next_call: result.ok
      ? buildExactNextCall("save", { note: "pass the validated draft to operation save" })
      : null,
  });
}

function opSave(request, options) {
  const store = options.store;
  const draft = request.draft
    ?? (isPlainObject(request.revision) ? request.revision : undefined)
    ?? request.input;
  if (!isPlainObject(draft)) {
    throw new CallRecipeRuntimeError("save requires draft or sealed revision object.", "PARAMS_INVALID");
  }
  const catalog = requireCatalog(options);
  try {
    const saved = store.save(draft, {
      version: request.version,
      revision: request.revision_number ?? request.revision,
      relative_path: request.relative_path,
      saved_at: request.saved_at,
    });
    return freeze({
      contract: CALL_RECIPE_RUNTIME_CONTRACT,
      ok: true,
      operation: "save",
      status: "saved",
      mutates_project: false,
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      immutable: true,
      idempotent: saved.idempotent === true,
      identity: {
        recipe_id: saved.recipe_id,
        version: saved.version,
        revision: saved.revision,
        content_hash: saved.content_hash,
        validation_result_id: saved.validation_result_id,
      },
      next_call: buildExactNextCall("run", {
        recipe_id: saved.recipe_id,
        version: saved.version,
        revision: saved.revision,
        content_hash: saved.content_hash,
        validation_result_id: saved.validation_result_id,
        inputs: {},
      }),
    });
  } catch (error) {
    throw mapStoreError(error);
  }
}

function opList(request, options, budget) {
  const store = options.store;
  try {
    const listed = store.list({
      filter: isPlainObject(request.filter) ? request.filter : undefined,
    });
    const allItems = (listed.items ?? []).map((item) => ({
      recipe_id: item.recipe_id,
      version: item.version,
      revision: item.revision,
      content_hash: item.content_hash,
      validation_result_id: item.validation_result_id,
      lifecycle: "validated",
      executable: true,
      discovery: compactRevisionDiscovery(item.payload ?? item),
    }));
    const limit = clampInteger(
      request.limit,
      1,
      EXECUTABLE_RECIPE_RUN_BUDGETS.list_max_items,
      EXECUTABLE_RECIPE_RUN_BUDGETS.list_default_items,
    );
    const start = parseCursor(request.cursor, allItems.length);
    let end = Math.min(start + limit, allItems.length);
    let items = allItems.slice(start, end);
    let response = buildListResponse({ allItems, items, start, end, limit });
    while (items.length > 0 && responseBytes(response) > budget.max_response_bytes) {
      items = items.slice(0, -1);
      end -= 1;
      response = buildListResponse({ allItems, items, start, end, limit });
    }
    if (items.length === 0 && start < allItems.length) {
      throw new CallRecipeRuntimeError(
        "One executable recipe discovery row exceeds the response budget.",
        "RESPONSE_TOO_LARGE",
        { max_response_bytes: budget.max_response_bytes },
      );
    }
    if (responseBytes(response) > budget.max_response_bytes) {
      throw new CallRecipeRuntimeError(
        "The executable recipe list envelope exceeds the response budget.",
        "RESPONSE_TOO_LARGE",
        { max_response_bytes: budget.max_response_bytes },
      );
    }
    return freeze(response);
  } catch (error) {
    throw mapStoreError(error);
  }
}

function buildListResponse({ allItems, items, start, end, limit }) {
  const hasMore = end < allItems.length;
  return {
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    ok: true,
    operation: "list",
    status: "listed",
    mutates_project: false,
    count: items.length,
    total: allItems.length,
    items,
    page: {
      limit,
      cursor: String(start),
      next_cursor: hasMore ? String(end) : null,
      has_more: hasMore,
    },
    executable_truth: "saved_validated_revisions_only",
  };
}

function opGet(request, options) {
  if (typeof request.evidence_ref === "string" && request.evidence_ref.trim() !== "") {
    const page = pageExecutableRecipeEvidence(options.evidenceStore, request);
    return freeze({ ...page, operation: "get" });
  }
  const store = options.store;
  const identity = extractIdentity(request, { requireFull: false });
  try {
    const loaded = store.get(identity);
    const payload = loaded.payload ?? loaded;
    const fullIdentity = {
      recipe_id: identity.recipe_id ?? payload.recipe_id,
      version: identity.version ?? payload.version,
      revision: identity.revision ?? payload.revision,
      content_hash: identity.content_hash ?? payload.content_hash,
      validation_result_id: identity.validation_result_id
        ?? loaded.validation_result_id
        ?? payload.validation_result_id,
      dependency_lock: identity.dependency_lock ?? loaded.dependency_lock ?? payload.dependency_lock,
      source_payload_identity: identity.source_payload_identity
        ?? loaded.source_payload_identity
        ?? payload.source_payload_identity,
    };
    const matched = matchStoredRevisionIdentity(loaded, fullIdentity, {
      catalog: requireCatalog(options),
    });
    return freeze({
      contract: CALL_RECIPE_RUNTIME_CONTRACT,
      ok: true,
      operation: "get",
      status: "loaded",
      mutates_project: false,
      identity: matched.identity,
      recipe_id: matched.payload.recipe_id,
      version: matched.payload.version,
      revision: matched.payload.revision,
      content_hash: matched.payload.content_hash,
      validation_result_id: matched.payload.validation_result_id,
      immutable: true,
      discovery: matched.discovery,
    });
  } catch (error) {
    if (error instanceof ExecutableRecipeRunError) throw error;
    throw mapStoreError(error);
  }
}

function opDelete(request, options) {
  const store = options.store;
  const partial = extractIdentity(request, { requireFull: true });
  try {
    // E1 delete requires complete stored identity; load then delete with exact stored facts.
    const loaded = store.get({
      recipe_id: partial.recipe_id,
      version: partial.version,
      revision: partial.revision,
      content_hash: partial.content_hash,
    });
    const payload = loaded.payload ?? loaded;
    if (payload.validation_result_id !== partial.validation_result_id) {
      throw new CallRecipeRuntimeError(
        "Delete validation_result_id does not match stored revision.",
        "REVISION_MISMATCH",
      );
    }
    const fullIdentity = buildExecutableRecipeRevisionIdentity(payload);
    const deleted = store.delete(fullIdentity, {
      confirm: request.confirm ?? request.confirmation,
    });
    return freeze({
      contract: CALL_RECIPE_RUNTIME_CONTRACT,
      ok: true,
      operation: "delete",
      status: "deleted",
      mutates_project: false,
      deleted: deleted.deleted === true,
      identity: {
        recipe_id: deleted.recipe_id ?? fullIdentity.recipe_id,
        version: deleted.version ?? fullIdentity.version,
        revision: deleted.revision ?? fullIdentity.revision,
        content_hash: deleted.content_hash ?? fullIdentity.content_hash,
        validation_result_id: deleted.validation_result_id ?? fullIdentity.validation_result_id,
      },
    });
  } catch (error) {
    if (error instanceof CallRecipeRuntimeError || error instanceof ExecutableRecipeRunError) throw error;
    throw mapStoreError(error);
  }
}

async function opRun(request, options, { startedAt, resume, budget }) {
  rejectInlineExecutionPayload(request, resume ? "resume" : "run");
  if (!resume && (request.run_id !== undefined || request.runId !== undefined)) {
    throw new CallRecipeRuntimeError(
      "run_id is server-owned for fresh runs and is accepted only by resume.",
      "PARAMS_INVALID",
      { field: "run_id", server_owned: true, zero_write: true },
    );
  }
  const store = options.store;
  const catalog = requireCatalog(options);
  const dispatchers = options.dispatchers;
  let runId = null;
  let resumeState = null;
  if (resume) {
    runId = request.run_id ?? request.runId;
    if (typeof runId !== "string" || runId.trim() === "") {
      throw new CallRecipeRuntimeError("resume requires run_id.", "RESUME_IDENTITY_INVALID");
    }
    resumeState = options.runStore.get(runId);
    if (!resumeState) {
      throw new CallRecipeRuntimeError("resume run identity not retained.", "RESUME_IDENTITY_INVALID", {
        run_id: runId,
      });
    }
    if (resumeState.resume_safe !== true) {
      throw new CallRecipeRuntimeError("resume is not safe for this run.", "RESUME_UNSAFE", {
        run_id: runId,
        reason: resumeState.resume_blocked_reason ?? "resume_safe_false",
      });
    }
    const checkpointId = request.checkpoint_id ?? request.checkpointId ?? request.latest_checkpoint_id;
    if (typeof checkpointId !== "string" || checkpointId !== resumeState.latest_checkpoint?.checkpoint_id) {
      throw new CallRecipeRuntimeError(
        "resume requires the latest verified checkpoint identity.",
        "CHECKPOINT_MISMATCH",
        {
          expected: resumeState.latest_checkpoint?.checkpoint_id ?? null,
          actual: checkpointId ?? null,
        },
      );
    }
    if (request.inputs !== undefined) {
      throw new CallRecipeRuntimeError(
        "resume reuses retained inputs and forbids request input overrides.",
        "RESUME_IDENTITY_INVALID",
        { field: "inputs" },
      );
    }
  }

  const identity = extractIdentity(request, {
    requireFull: true,
    fallback: null,
  });
  if (resume && !sameRunIdentity(identity, resumeState.identity)) {
    throw new CallRecipeRuntimeError(
      "resume identity must exactly match the retained run revision.",
      "RESUME_IDENTITY_INVALID",
      { run_id: runId },
    );
  }
  let loaded;
  try {
    loaded = store.get({
      recipe_id: identity.recipe_id,
      version: identity.version,
      revision: identity.revision,
      content_hash: identity.content_hash,
    });
  } catch (error) {
    throw mapStoreError(error);
  }
  const payload = loaded.payload ?? loaded;
  const matched = matchStoredRevisionIdentity(loaded, {
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
    content_hash: identity.content_hash,
    validation_result_id: identity.validation_result_id,
    dependency_lock: identity.dependency_lock ?? loaded.dependency_lock ?? payload.dependency_lock,
    source_payload_identity: identity.source_payload_identity
      ?? loaded.source_payload_identity
      ?? payload.source_payload_identity,
  }, { catalog });
  const revision = matched.payload;
  assertRunMutationResponseBudget(budget, resume ? "resume" : "run", revision);
  const runtimeFacts = await loadAuthoritativeRuntimeFacts(options.runtimeFactsProvider, {
    operation: resume ? "resume" : "run",
    revision,
    run_id: runId,
    latest_checkpoint: resumeState?.latest_checkpoint ?? null,
  });

  // Re-evaluate exact revision, dependency lock, capability, risk grant, project identity,
  // Bridge owner/generation and checkpoint evidence before dispatch.
  const trust = evaluateRunTrust(revision, runtimeFacts, { catalog });
  if (!trust.trusted) {
    const retained = retainedFailureTruth(revision, resumeState, runId);
    return projectRunFailureEnvelope({
      operation: resume ? "resume" : "run",
      revision,
      runId,
      status: "blocked",
      code: "TRUST_INVALID",
      message: "Executable recipe trust invalid before dispatch.",
      failedStageIds: [],
      completedStageIds: retained.completedStageIds,
      notStartedStageIds: retained.notStartedStageIds,
      provenPartialChanges: retained.provenPartialChanges,
      latestCheckpoint: retained.latestCheckpoint,
      resumeSafe: false,
      nextCall: buildExactNextCall("get", {
        recipe_id: revision.recipe_id,
        version: revision.version,
        revision: revision.revision,
        content_hash: revision.content_hash,
        validation_result_id: revision.validation_result_id,
      }),
      evidenceRef: retained.evidenceRef,
      details: { invalidation_reasons: trust.invalidation_reasons },
    });
  }

  const inputs = resume
    ? cloneJson(resumeState.inputs ?? {})
    : (isPlainObject(request.inputs) ? request.inputs : {});
  const preflight = preflightExecutableRecipeRevision(revision, {
    catalog,
    dispatchers,
    runtime_facts: runtimeFacts,
    inputs,
  });
  if (!preflight.ok) {
    const retained = retainedFailureTruth(revision, resumeState, runId);
    return projectRunFailureEnvelope({
      operation: resume ? "resume" : "run",
      revision,
      runId,
      status: "blocked",
      code: "PREFLIGHT_FAILED",
      message: "Whole-graph preflight failed before first mutating stage.",
      failedStageIds: [],
      completedStageIds: retained.completedStageIds,
      notStartedStageIds: retained.notStartedStageIds,
      provenPartialChanges: retained.provenPartialChanges,
      latestCheckpoint: retained.latestCheckpoint,
      resumeSafe: false,
      nextCall: buildExactNextCall("validate", { note: "repair draft then save a new revision" }),
      evidenceRef: retained.evidenceRef,
      details: { errors: preflight.errors, mutates_project: false },
    });
  }

  runId = runId ?? allocateRunId(options.runStore);
  const stages = revision.draft.stages;
  const completed = new Set(resumeState?.completed_stage_ids ?? []);
  const evidenceItems = [...(resumeState?.evidence_items ?? [])];
  let bindingValues = resumeState?.binding_values
    ?? seedBindingValuesFromInputs(revision.draft.bindings, inputs);
  let latestCheckpoint = resumeState?.latest_checkpoint ?? null;
  let applied = resumeState?.counts?.applied ?? 0;
  let skipped = resumeState?.counts?.skipped ?? 0;
  let processed = resumeState?.counts?.processed ?? 0;
  const provenPartialChanges = [...(resumeState?.proven_partial_changes ?? [])];

  for (const stage of stages) {
    if (completed.has(stage.id)) {
      skipped += 1;
      processed += 1;
      continue;
    }

    const dispatcher = selectDispatcher(dispatchers, stage.kind);
    if (typeof dispatcher !== "function") {
      return failPartial({
        operation: resume ? "resume" : "run",
        revision,
        runId,
        code: "DISPATCHER_UNAVAILABLE",
        message: `No dispatcher for stage kind ${stage.kind}.`,
        stage,
        stages,
        completed,
        evidenceItems,
        provenPartialChanges,
        latestCheckpoint,
        bindingValues,
        inputs,
        counts: { processed, applied, skipped },
        options,
        resumeSafe: latestCheckpoint != null,
      });
    }

    const stageInputs = resolveStageBindings(stage, bindingValues, inputs);
    let outcome;
    try {
      outcome = await dispatcher({
        stage,
        revision,
        inputs: stageInputs,
        recipe_inputs: inputs,
      });
    } catch (error) {
      outcome = {
        ok: false,
        verified: false,
        status: "failed",
        summary: error?.message ?? "stage dispatcher threw",
        error: {
          code: error?.code ?? "STAGE_FAILED",
          message: error?.message ?? "stage dispatcher threw",
        },
      };
    }

    const normalized = normalizeStageOutcome(stage, outcome, revision);
    processed += 1;
    evidenceItems.push(compactStageEvidence(stage, normalized));

    if (Array.isArray(normalized.proven_changes)) {
      provenPartialChanges.push(...normalized.proven_changes);
    }
    if (!normalized.ok || normalized.verified !== true) {
      return failPartial({
        operation: resume ? "resume" : "run",
        revision,
        runId,
        code: normalized.error?.code ?? (normalized.verified ? "STAGE_FAILED" : "READBACK_UNVERIFIED"),
        message: normalized.error?.message
          ?? (normalized.verified ? `Stage ${stage.id} failed.` : `Stage ${stage.id} lacked verified native readback.`),
        stage,
        stages,
        completed,
        evidenceItems,
        provenPartialChanges,
        latestCheckpoint,
        bindingValues,
        inputs,
        counts: { processed, applied, skipped },
        options,
        resumeSafe: latestCheckpoint != null && normalized.zero_write === true,
        details: normalized.error?.details,
      });
    }

    applied += 1;
    completed.add(stage.id);
    bindingValues = applyBindingsAfterStage(
      revision.draft.bindings,
      stage,
      normalized.output_map ?? {},
      bindingValues,
    );
    latestCheckpoint = buildVerifiedCheckpoint(revision, stage, normalized);

    options.runStore.put(runId, {
      run_id: runId,
      identity: {
        recipe_id: revision.recipe_id,
        version: revision.version,
        revision: revision.revision,
        content_hash: revision.content_hash,
        validation_result_id: revision.validation_result_id,
      },
      inputs,
      completed_stage_ids: [...completed],
      binding_values: bindingValues,
      latest_checkpoint: latestCheckpoint,
      evidence_items: evidenceItems,
      proven_partial_changes: provenPartialChanges,
      counts: { processed, applied, skipped },
      resume_safe: true,
    });
  }

  const verifiedOutputs = collectRecipeOutputs(revision.draft, bindingValues);
  const evidenceRef = createExecutableRecipeEvidenceRef(runId, 0);
  options.evidenceStore.put(evidenceRef, {
    run_id: runId,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    items: evidenceItems,
  });
  options.runStore.put(runId, {
    run_id: runId,
    identity: {
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    },
    inputs,
    completed_stage_ids: [...completed],
    binding_values: bindingValues,
    latest_checkpoint: latestCheckpoint,
    evidence_items: evidenceItems,
    proven_partial_changes: provenPartialChanges,
    counts: { processed, applied, skipped },
    resume_safe: false,
    status: "succeeded",
  });

  return projectRunSuccessEnvelope({
    operation: resume ? "resume" : "run",
    revision,
    runId,
    status: "succeeded",
    processed,
    applied,
    skipped,
    verifiedOutputs,
    timing: {
      duration_ms: Date.now() - startedAt,
      preflight_mutates_project: false,
    },
    evidenceRef,
    latestCheckpoint,
  });
}

function failPartial({
  operation,
  revision,
  runId,
  code,
  message,
  stage,
  stages,
  completed,
  evidenceItems,
  provenPartialChanges,
  latestCheckpoint,
  bindingValues,
  inputs,
  counts,
  options,
  resumeSafe,
  details = null,
}) {
  const failed = [stage.id];
  const completedIds = [...completed];
  const notStarted = stages
    .map((item) => item.id)
    .filter((id) => id !== stage.id && !completed.has(id));
  const evidenceRef = createExecutableRecipeEvidenceRef(runId, 0);
  options.evidenceStore.put(evidenceRef, {
    run_id: runId,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    items: evidenceItems,
  });
  options.runStore.put(runId, {
    run_id: runId,
    identity: {
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    },
    inputs,
    completed_stage_ids: completedIds,
    binding_values: bindingValues,
    latest_checkpoint: latestCheckpoint,
    evidence_items: evidenceItems,
    proven_partial_changes: provenPartialChanges,
    counts,
    resume_safe: resumeSafe === true,
    resume_blocked_reason: resumeSafe ? null : code,
    status: completedIds.length > 0 ? "partial" : "failed",
  });

  const nextCall = resumeSafe && latestCheckpoint
    ? buildExactNextCall("resume", {
      run_id: runId,
      checkpoint_id: latestCheckpoint.checkpoint_id,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    })
    : buildExactNextCall("get", {
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
      validation_result_id: revision.validation_result_id,
    });

  return projectRunFailureEnvelope({
    operation,
    revision,
    runId,
    status: completedIds.length > 0 ? "partial" : "failed",
    code,
    message,
    failedStageIds: failed,
    completedStageIds: completedIds,
    notStartedStageIds: notStarted,
    provenPartialChanges,
    latestCheckpoint,
    recovery: {
      strategy: resumeSafe ? "resume_from_checkpoint" : "inspect_and_repair",
      rollback_claimed: false,
    },
    undo: {
      claimed: false,
      proven: false,
    },
    resumeSafe,
    nextCall,
    evidenceRef,
    details,
  });
}

function normalizeStageOutcome(stage, outcome, revision) {
  if (!isPlainObject(outcome)) {
    return invalidStageOutcome(stage, "stage outcome must be an object");
  }
  if (stage.kind === "macro") return normalizeMacroStageOutcome(stage, outcome);
  if (stage.kind === "template") return normalizeTemplateStageOutcome(stage, outcome);
  if (stage.kind === "get_state") return normalizeGetStateStageOutcome(stage, outcome);
  if (stage.kind === "checkpoint") return normalizeCheckpointStageOutcome(stage, outcome, revision);
  return invalidStageOutcome(stage, `unsupported stage kind ${stage.kind}`);
}

function normalizeMacroStageOutcome(stage, outcome) {
  if (outcome.contract !== MACRO_EXECUTION_CONTRACT) {
    return invalidStageOutcome(stage, "macro stage did not return macro.execution.v1");
  }
  const validation = validateMacroExecutionEnvelope(outcome);
  if (!validation.valid) {
    return invalidStageOutcome(stage, "macro.execution.v1 envelope is invalid", {
      validation_errors: validation.errors?.slice(0, 8) ?? [],
    });
  }
  const ok = outcome.ok === true;
  const verified = ok && outcome.result?.verification?.status === "passed";
  const outputMap = requestedStageOutputs(stage, [outcome.result?.data]);
  const provenChanges = provenMacroChanges(stage, outcome.result?.changes);
  const zeroWrite = !ok
    && provenChanges.length === 0
    && explicitMacroZeroWrite(outcome);
  return normalizedStageResult(stage, {
    contract: outcome.contract,
    ok,
    verified,
    outputMap,
    summary: outcome.result?.summary,
    evidenceRefs: outcome.result?.verification?.evidence_refs,
    provenChanges,
    zeroWrite,
    error: ok ? null : outcome.error,
  });
}

function normalizeTemplateStageOutcome(stage, outcome) {
  if (outcome.contract !== TEMPLATE_EXECUTION_HARNESS_CONTRACT) {
    return invalidStageOutcome(stage, "template stage did not return template.execution.v1");
  }
  const ok = outcome.ok === true;
  const readback = outcome.result?.readback;
  const verified = ok
    && outcome.verification?.status === "passed"
    && readback !== undefined
    && readback !== null;
  const outputMap = requestedStageOutputs(stage, [readback]);
  const zeroWrite = !ok && outcome.error?.details?.zero_write === true;
  const provenChanges = verified && stage.risk !== "read"
    ? [{
        stage_id: stage.id,
        kind: stage.kind,
        dependency_id: stage.dependency?.id ?? null,
        refs: compactCanonicalRefs(outcome.result?.refs),
      }]
    : [];
  return normalizedStageResult(stage, {
    contract: outcome.contract,
    ok,
    verified,
    outputMap,
    summary: outcome.result?.summary,
    evidenceRefs: compactCanonicalRefs(outcome.result?.refs),
    provenChanges,
    zeroWrite,
    error: ok ? null : outcome.error,
  });
}

function normalizeGetStateStageOutcome(stage, outcome) {
  if (outcome.contract !== GET_STATE_RUNTIME_CONTRACT) {
    return invalidStageOutcome(stage, "get_state stage did not return get_state.runtime.v1");
  }
  const ok = outcome.ok === true && isPlainObject(outcome.result);
  const outputMap = requestedStageOutputs(stage, [outcome.result]);
  return normalizedStageResult(stage, {
    contract: outcome.contract,
    ok,
    verified: ok,
    outputMap,
    summary: ok ? `get_state ${stage.id} returned bounded runtime state` : outcome.error?.message,
    evidenceRefs: [],
    provenChanges: [],
    zeroWrite: outcome.ok === false,
    error: ok ? null : outcome.error,
  });
}

function normalizeCheckpointStageOutcome(stage, outcome, revision) {
  const declaration = checkpointDeclaration(revision, stage);
  const identityMatches = outcome.recipe_id === revision.recipe_id
    && outcome.version === revision.version
    && outcome.revision === revision.revision
    && outcome.content_hash === revision.content_hash;
  const proofMatches = outcome.contract === CALL_RECIPE_CHECKPOINT_PROOF_CONTRACT
    && outcome.ok === true
    && outcome.verified === true
    && outcome.checkpoint_id === declaration.id
    && outcome.evidence_id === declaration.evidence_id
    && outcome.resume_identity === declaration.resume_identity
    && identityMatches;
  if (!proofMatches) {
    return invalidStageOutcome(stage, "checkpoint stage lacked exact runtime-owned checkpoint proof", {
      checkpoint_id: declaration.id,
    }, true);
  }
  return normalizedStageResult(stage, {
    contract: outcome.contract,
    ok: true,
    verified: true,
    outputMap: requestedStageOutputs(stage, [outcome.outputs]),
    summary: outcome.summary,
    evidenceRefs: [outcome.evidence_id],
    provenChanges: [],
    zeroWrite: false,
    checkpointProof: {
      evidence_id: outcome.evidence_id,
      resume_identity: outcome.resume_identity,
    },
  });
}

function normalizedStageResult(stage, {
  contract,
  ok,
  verified,
  outputMap,
  summary,
  evidenceRefs,
  provenChanges,
  zeroWrite,
  checkpointProof = null,
  error = null,
}) {
  const missingOutputPorts = (stage.outputs ?? []).filter((port) => (
    !Object.prototype.hasOwnProperty.call(outputMap ?? {}, port)
    || outputMap[port] === undefined
  ));
  const acceptedVerified = verified && missingOutputPorts.length === 0;
  const normalizedError = ok && !acceptedVerified
    ? {
        code: "READBACK_UNVERIFIED",
        message: missingOutputPorts.length > 0
          ? `Stage ${stage.id} did not return every declared output.`
          : `Stage ${stage.id} completed without accepted runtime/native readback.`,
        details: missingOutputPorts.length > 0
          ? { missing_output_ports: missingOutputPorts }
          : undefined,
      }
    : (!ok
        ? {
            code: error?.code ?? "STAGE_FAILED",
            message: error?.message ?? `Stage ${stage.id} failed.`,
            details: error?.details,
          }
        : null);
  return {
    source_contract: contract,
    ok,
    verified: ok && acceptedVerified,
    status: ok && acceptedVerified ? "applied" : (ok ? "unverified" : "failed"),
    summary: typeof summary === "string" ? summary : `${stage.kind}:${stage.id}`,
    outputs: Object.keys(outputMap ?? {}),
    output_map: outputMap ?? {},
    evidence_refs: uniqueStrings(evidenceRefs),
    proven_changes: Array.isArray(provenChanges) ? provenChanges : [],
    zero_write: zeroWrite === true,
    checkpoint_proof: checkpointProof,
    error: normalizedError,
  };
}

function invalidStageOutcome(stage, message, details = undefined, zeroWrite = false) {
  return {
    source_contract: null,
    ok: false,
    verified: false,
    status: "failed",
    summary: message,
    outputs: [],
    output_map: {},
    evidence_refs: [],
    proven_changes: [],
    zero_write: zeroWrite === true,
    checkpoint_proof: null,
    error: { code: "STAGE_FAILED", message, details },
  };
}

function buildVerifiedCheckpoint(revision, stage, outcome) {
  if (outcome.verified !== true) {
    throw new CallRecipeRuntimeError(
      "Checkpoint cannot be created without accepted stage evidence.",
      "CHECKPOINT_UNVERIFIED",
      { stage_id: stage.id },
    );
  }
  const declaration = checkpointDeclaration(revision, stage);
  return freeze({
    contract: CALL_RECIPE_CHECKPOINT_PROOF_CONTRACT,
    checkpoint_id: declaration.id,
    stage_id: stage.id,
    evidence_id: declaration.evidence_id,
    resume_identity: declaration.resume_identity,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    verified: true,
    proof: {
      source_contract: outcome.source_contract,
      evidence_refs: outcome.evidence_refs,
      explicit_checkpoint_proof: outcome.checkpoint_proof != null,
    },
  });
}

function checkpointDeclaration(revision, stage) {
  const declaration = revision.draft.checkpoints.find((item) => item.id === stage.checkpoint);
  if (!declaration || declaration.after_stage !== stage.id) {
    throw new CallRecipeRuntimeError(
      "Stored checkpoint declaration does not match the executed stage.",
      "CHECKPOINT_MISMATCH",
      { stage_id: stage.id, checkpoint_id: stage.checkpoint },
    );
  }
  return declaration;
}

function requestedStageOutputs(stage, sources) {
  const output = {};
  for (const port of stage.outputs ?? []) {
    for (const source of sources) {
      const found = findNamedValue(source, port);
      if (found.found) {
        output[port] = cloneJson(found.value);
        break;
      }
    }
  }
  return output;
}

function findNamedValue(value, key, depth = 0) {
  if (depth > 4 || value == null || typeof value !== "object") return { found: false };
  if (!Array.isArray(value) && Object.prototype.hasOwnProperty.call(value, key)) {
    return { found: true, value: value[key] };
  }
  for (const child of Array.isArray(value) ? value : Object.values(value)) {
    const found = findNamedValue(child, key, depth + 1);
    if (found.found) return found;
  }
  return { found: false };
}

function provenMacroChanges(stage, changes) {
  if (!Array.isArray(changes)) return [];
  return changes
    .filter((change) => isPlainObject(change) && change.status === "applied" && (
      change.live_readback?.status === "passed"
      || change.mutation?.verification_status === "passed"
      || change.verification?.status === "passed"
    ))
    .slice(0, EXECUTABLE_RECIPE_RUN_BUDGETS.partial_change_max_count)
    .map((change) => ({
      stage_id: stage.id,
      kind: stage.kind,
      dependency_id: stage.dependency?.id ?? null,
      change: cloneJson(change),
    }));
}

function explicitMacroZeroWrite(outcome) {
  if (outcome.result?.data?.zero_write === true) return true;
  const blockers = Array.isArray(outcome.blockers) ? outcome.blockers : [];
  return blockers.length > 0 && blockers.every((item) => item?.details?.zero_write === true);
}

function compactCanonicalRefs(refs) {
  if (!Array.isArray(refs)) return [];
  return refs.slice(0, 16).map((item) => {
    if (typeof item === "string") return item;
    return typeof item?.ref === "string" ? item.ref : null;
  }).filter(Boolean);
}

function uniqueStrings(values) {
  return [...new Set((Array.isArray(values) ? values : []).filter((item) => typeof item === "string"))].slice(0, 16);
}

function selectDispatcher(dispatchers, kind) {
  if (kind === "macro") return dispatchers.macro;
  if (kind === "template") return dispatchers.template;
  if (kind === "get_state") return dispatchers.get_state;
  if (kind === "checkpoint") return dispatchers.checkpoint;
  return null;
}

function extractIdentity(request, { requireFull = false, fallback = null } = {}) {
  const source = isPlainObject(request.identity)
    ? request.identity
    : isPlainObject(request.recipe_identity)
      ? request.recipe_identity
      : request;
  const revisionNumber = Number.isInteger(source.revision)
    ? source.revision
    : Number.isInteger(source.revision_number)
      ? source.revision_number
      : Number.isInteger(request.revision_number)
        ? request.revision_number
        : Number.isInteger(request.revision)
          ? request.revision
          : fallback?.revision;
  const merged = {
    ...(isPlainObject(fallback) ? fallback : {}),
    recipe_id: source.recipe_id ?? source.recipeId ?? (typeof source.id === "string" ? source.id : undefined) ?? fallback?.recipe_id,
    version: source.version ?? fallback?.version,
    revision: revisionNumber,
    content_hash: source.content_hash ?? source.contentHash ?? fallback?.content_hash,
    validation_result_id: source.validation_result_id ?? source.validationResultId ?? fallback?.validation_result_id,
    dependency_lock: source.dependency_lock ?? source.dependencyLock ?? fallback?.dependency_lock,
    dependency_lock_identity: source.dependency_lock_identity ?? source.dependencyLockIdentity ?? fallback?.dependency_lock_identity,
    source_payload_identity: source.source_payload_identity ?? source.sourcePayloadIdentity ?? fallback?.source_payload_identity,
  };
  if (requireFull) {
    return buildExactRunRevisionIdentity(merged);
  }
  if (
    typeof merged.recipe_id !== "string"
    || typeof merged.version !== "string"
    || !Number.isInteger(merged.revision)
    || typeof merged.content_hash !== "string"
  ) {
    throw new CallRecipeRuntimeError(
      "Exact stored revision identity requires recipe_id, version, revision, and content_hash.",
      "REVISION_IDENTITY_INCOMPLETE",
    );
  }
  return merged;
}

function bindStore(options) {
  if (options.store) {
    assertStoreShape(options.store);
    return options.store;
  }
  if (options.root || options.recipeRoot) {
    if (!options.catalog && !options.executableDependencyCatalog) {
      throw new CallRecipeRuntimeError(
        "createCallRecipeRuntime requires catalog when constructing a bound store.",
        "PARAMS_INVALID",
      );
    }
    const catalog = options.catalog ?? options.executableDependencyCatalog;
    const store = createExecutableRecipeRevisionStore({
      root: options.root ?? options.recipeRoot,
      source: options.source ?? "user",
      catalog,
      reservedRecipeIds: options.reservedRecipeIds,
      officialRecipeIds: options.officialRecipeIds,
    });
    // Preserve catalog on the runtime binding only; store itself stays non-executing.
    return Object.assign(store, { catalog });
  }
  return null;
}

function assertStoreShape(store) {
  for (const method of ["validate", "save", "list", "get", "delete"]) {
    if (typeof store?.[method] !== "function") {
      throw new CallRecipeRuntimeError(
        `Bound store missing ${method}; E1 store must remain the non-executing authority.`,
        "STORE_ERROR",
      );
    }
  }
  if (typeof store.run === "function" || typeof store.resume === "function") {
    throw new CallRecipeRuntimeError(
      "Bound store must not expose run/resume; execution stays in call_recipe runtime.",
      "STORE_ERROR",
    );
  }
}

function requireCatalog(options) {
  const catalog = options.catalog
    ?? options.store?.catalog
    ?? options.executableDependencyCatalog;
  if (!catalog) {
    throw new CallRecipeRuntimeError("Executable dependency catalog is required.", "PARAMS_INVALID");
  }
  return catalog;
}

function normalizeDispatchers(value) {
  const input = isPlainObject(value) ? value : {};
  const macro = input.macro ?? input.call_template_macro ?? input.macroRuntime;
  const template = input.template ?? input.call_template ?? input.templateRuntime;
  const getState = input.get_state ?? input.getState ?? input.getStateRuntime;
  const checkpoint = input.checkpoint ?? input.checkpointRuntime;
  return {
    macro: wrapDispatcher(macro, "macro"),
    template: wrapDispatcher(template, "template"),
    get_state: wrapDispatcher(getState, "get_state"),
    checkpoint: wrapDispatcher(checkpoint, "checkpoint"),
  };
}

function wrapDispatcher(value, kind) {
  if (typeof value === "function") return value;
  if (value && typeof value.call_template === "function" && (kind === "macro" || kind === "template")) {
    return async ({ stage, inputs }) => {
      const result = await value.call_template({
        id: stage.dependency?.id,
        input: inputs,
      });
      return result;
    };
  }
  if (value && typeof value.get_state === "function" && kind === "get_state") {
    return async ({ stage, inputs }) => {
      const result = await value.get_state(inputs);
      return result;
    };
  }
  return typeof value === "function" ? value : null;
}

function createEvidenceStore(existing) {
  if (existing && typeof existing.get === "function" && typeof existing.put === "function") {
    return existing;
  }
  const map = new Map();
  return {
    put(ref, value) {
      map.set(ref, value);
    },
    get(ref) {
      return map.get(ref) ?? null;
    },
  };
}

function createRunStore(existing) {
  if (existing && typeof existing.get === "function" && typeof existing.put === "function") {
    return existing;
  }
  const map = new Map();
  return {
    put(id, value) {
      map.set(id, value);
    },
    get(id) {
      return map.get(id) ?? null;
    },
  };
}

function allocateRunId(runStore) {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const runId = createExecutableRecipeRunId();
    if (runStore.get(runId) == null) return runId;
  }
  throw new CallRecipeRuntimeError(
    "Unable to allocate a unique server-owned run_id.",
    "STORE_ERROR",
    { zero_write: true },
  );
}

function retainedFailureTruth(revision, resumeState, runId) {
  const completedSet = new Set(resumeState?.completed_stage_ids ?? []);
  const stageIds = (revision.draft?.stages ?? []).map((stage) => stage.id);
  return {
    completedStageIds: stageIds.filter((id) => completedSet.has(id)),
    notStartedStageIds: stageIds.filter((id) => !completedSet.has(id)),
    provenPartialChanges: [...(resumeState?.proven_partial_changes ?? [])],
    latestCheckpoint: resumeState?.latest_checkpoint ?? null,
    evidenceRef: resumeState && typeof runId === "string"
      ? createExecutableRecipeEvidenceRef(runId, 0)
      : null,
  };
}

function mapStoreError(error) {
  if (error instanceof ExecutableRecipeRevisionStoreError) {
    return new CallRecipeRuntimeError(error.message, mapStoreCode(error.code), error.details ?? {});
  }
  if (error instanceof ExecutableRecipeRunError || error instanceof CallRecipeRuntimeError) {
    return error;
  }
  return new CallRecipeRuntimeError(error?.message ?? "store error", "STORE_ERROR");
}

function mapStoreCode(code) {
  if (code === "REVISION_NOT_FOUND") return "REVISION_NOT_FOUND";
  if (code === "PARAMS_INVALID") return "PARAMS_INVALID";
  if (code === "ZERO_WRITE_FAILURE" || code === "ZERO_DELETE_FAILURE") return "ZERO_WRITE_FAILURE";
  return "STORE_ERROR";
}

function finalizeError(error, request, options, startedAt) {
  const mapped = error instanceof CallRecipeRuntimeError || error instanceof ExecutableRecipeRunError
    ? error
    : mapStoreError(error);
  const operation = typeof request?.operation === "string" ? request.operation : null;
  const code = mapped.code ?? "PARAMS_INVALID";
  const status = code === "TRUST_INVALID" || code === "PREFLIGHT_FAILED" || code === "INLINE_EXECUTION_FORBIDDEN"
    ? "blocked"
    : "failed";
  return freeze({
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    ok: false,
    operation,
    status,
    error: {
      code,
      message: mapped.message,
      details: mapped.details ?? undefined,
    },
    resume_safe: false,
    next_call: operation === "run" || operation === "resume"
      ? buildExactNextCall("list", {})
      : null,
    timing: {
      duration_ms: Date.now() - startedAt,
    },
  });
}

function normalizeRuntimeFactsProvider(options) {
  const provider = options.runtimeFactsProvider ?? options.runtime_facts_provider;
  if (typeof provider === "function") return provider;
  if (provider && typeof provider.getRuntimeFacts === "function") {
    return provider.getRuntimeFacts.bind(provider);
  }
  return null;
}

async function loadAuthoritativeRuntimeFacts(provider, context) {
  if (typeof provider !== "function") {
    throw new CallRecipeRuntimeError(
      "run/resume requires a runtime-owned facts provider.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  let facts;
  try {
    facts = await provider(freeze({ ...context }));
  } catch (error) {
    throw new CallRecipeRuntimeError(
      "runtime-owned facts provider failed.",
      "RUNTIME_FACTS_UNAVAILABLE",
      { message: boundedText(error?.message, 160) },
    );
  }
  if (!isPlainObject(facts)) {
    throw new CallRecipeRuntimeError(
      "runtime-owned facts provider returned no usable facts.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  return cloneJson(facts);
}

function normalizeCallRecipeBudget(input) {
  if (input !== undefined && !isPlainObject(input)) {
    throw new CallRecipeRuntimeError("budget must be an object.", "PARAMS_INVALID");
  }
  const maxResponseBytes = input?.max_response_bytes
    ?? EXECUTABLE_RECIPE_RUN_BUDGETS.response_default_bytes;
  if (
    !Number.isInteger(maxResponseBytes)
    || maxResponseBytes < 512
    || maxResponseBytes > EXECUTABLE_RECIPE_RUN_BUDGETS.response_max_bytes
  ) {
    throw new CallRecipeRuntimeError(
      `budget.max_response_bytes must be an integer from 512 to ${EXECUTABLE_RECIPE_RUN_BUDGETS.response_max_bytes}.`,
      "PARAMS_INVALID",
    );
  }
  return freeze({ max_response_bytes: maxResponseBytes });
}

function safeCallRecipeBudget(input) {
  try {
    return normalizeCallRecipeBudget(input);
  } catch {
    return freeze({ max_response_bytes: EXECUTABLE_RECIPE_RUN_BUDGETS.response_default_bytes });
  }
}

function assertMutationResponseBudget(budget, operation) {
  if (budget.max_response_bytes < EXECUTABLE_RECIPE_RUN_BUDGETS.mutation_response_min_bytes) {
    throw new CallRecipeRuntimeError(
      `operation ${operation} requires at least ${EXECUTABLE_RECIPE_RUN_BUDGETS.mutation_response_min_bytes} response bytes before dispatch.`,
      "RESPONSE_BUDGET_INSUFFICIENT",
      {
        operation,
        required: EXECUTABLE_RECIPE_RUN_BUDGETS.mutation_response_min_bytes,
        provided: budget.max_response_bytes,
        zero_write: true,
      },
    );
  }
}

function assertRunMutationResponseBudget(budget, operation, revision) {
  const required = requiredRunMutationResponseBytes(revision, operation);
  if (budget.max_response_bytes >= required) return;
  throw new CallRecipeRuntimeError(
    `operation ${operation} requires at least ${required} response bytes for this revision before dispatch.`,
    "RESPONSE_BUDGET_INSUFFICIENT",
    {
      operation,
      required,
      provided: budget.max_response_bytes,
      stage_count: revision.draft?.stages?.length ?? 0,
      zero_write: true,
    },
  );
}

function requiredRunMutationResponseBytes(revision, operation) {
  const stageIds = (revision.draft?.stages ?? []).map((stage) => stage.id);
  const outputCount = Math.min(
    revision.draft?.outputs?.length ?? 0,
    EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_count,
  );
  const checkpoint = (revision.draft?.checkpoints ?? []).at(-1);
  const longestStageId = stageIds.reduce(
    (longest, id) => typeof id === "string" && id.length > longest.length ? id : longest,
    "stage",
  );
  const identity = {
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
  };
  const projectedFailure = {
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    ok: false,
    operation,
    status: "partial",
    ...identity,
    run_id: `run.${"f".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars)}`,
    error: {
      code: "READBACK_UNVERIFIED",
      message: "x".repeat(240),
    },
    // Duplicate the ids across every partition to keep the pre-dispatch estimate
    // conservative even though a real terminal result partitions each id once.
    stages: {
      failed: stageIds,
      completed: stageIds,
      not_started: stageIds,
    },
    proven_partial_changes: Array.from({ length: COMPACT_FAILURE_PARTIAL_CHANGE_MAX_COUNT }, () => ({
      stage_id: longestStageId,
      kind: "template",
      dependency_id: "x".repeat(96),
      change: {
        payload: "x".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes),
      },
    })),
    latest_checkpoint: checkpoint
      ? {
          checkpoint_id: checkpoint.id,
          evidence_id: checkpoint.evidence_id,
          resume_identity: checkpoint.resume_identity,
          stage_id: longestStageId,
          verified: true,
          ...identity,
        }
      : null,
    recovery: { strategy: "resume_from_checkpoint", rollback_claimed: false },
    undo: { claimed: false, proven: false },
    resume_safe: true,
    next_call: buildExactNextCall("resume", {
      run_id: `run.${"f".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars)}`,
      checkpoint_id: checkpoint?.id ?? "checkpoint",
      ...identity,
    }),
    evidence_ref: `evidence:recipe-run:${"f".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars)}:0`,
    response_compacted: true,
  };
  const projectedSuccess = {
    contract: EXECUTABLE_RECIPE_RUN_CONTRACT,
    ok: true,
    operation,
    status: "succeeded",
    ...identity,
    run_id: `run.${"f".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars)}`,
    counts: {
      processed: stageIds.length,
      applied: stageIds.length,
      skipped: stageIds.length,
    },
    verified_outputs: Array.from({ length: outputCount }, () => ({
      id: "x".repeat(96),
      verified: true,
      value: {
        payload: "x".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes),
      },
    })),
    timing: {
      duration_ms: Number.MAX_SAFE_INTEGER,
      preflight_mutates_project: false,
    },
    evidence_ref: `evidence:recipe-run:${"f".repeat(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars)}:0`,
    latest_checkpoint: checkpoint
      ? {
          checkpoint_id: checkpoint.id,
          evidence_id: checkpoint.evidence_id,
          resume_identity: checkpoint.resume_identity,
          stage_id: longestStageId,
          verified: true,
          ...identity,
        }
      : null,
  };
  return Math.max(
    EXECUTABLE_RECIPE_RUN_BUDGETS.mutation_response_min_bytes,
    responseBytes(projectedFailure),
    responseBytes(projectedSuccess),
  );
}

function enforceCallRecipeResponseBudget(response, budget, context = {}) {
  if (responseBytes(response) <= budget.max_response_bytes) return response;
  if (response?.ok === true && context.operation === "list") {
    const tooLarge = {
      contract: CALL_RECIPE_RUNTIME_CONTRACT,
      ok: false,
      operation: "list",
      status: "failed",
      error: {
        code: "RESPONSE_TOO_LARGE",
        message: "The executable recipe list envelope exceeds max_response_bytes.",
      },
      resume_safe: false,
    };
    return responseBytes(tooLarge) <= budget.max_response_bytes
      ? freeze(tooLarge)
      : freeze({ ok: false, error: { code: "RESPONSE_TOO_LARGE" } });
  }
  const projected = compactCallRecipeResponse(response, context.operation);
  if (responseBytes(projected) <= budget.max_response_bytes) return freeze(projected);
  const minimal = {
    contract: CALL_RECIPE_RUNTIME_CONTRACT,
    ok: false,
    operation: typeof context.operation === "string" ? context.operation : null,
    status: "failed",
    error: {
      code: "RESPONSE_TOO_LARGE",
      message: "call_recipe response exceeds max_response_bytes.",
    },
    resume_safe: false,
  };
  if (responseBytes(minimal) <= budget.max_response_bytes) return freeze(minimal);
  return freeze({ ok: false, error: { code: "RESPONSE_TOO_LARGE" } });
}

function compactCallRecipeResponse(response, operation) {
  if (!isPlainObject(response)) {
    return {
      contract: CALL_RECIPE_RUNTIME_CONTRACT,
      ok: false,
      operation,
      status: "failed",
      error: { code: "RESPONSE_TOO_LARGE", message: "call_recipe response is not projectable." },
      resume_safe: false,
    };
  }
  if (response.ok === true) {
    return {
      contract: response.contract ?? CALL_RECIPE_RUNTIME_CONTRACT,
      ok: true,
      operation: response.operation ?? operation ?? null,
      status: response.status ?? "completed",
      recipe_id: response.recipe_id ?? response.identity?.recipe_id ?? null,
      version: response.version ?? response.identity?.version ?? null,
      revision: response.revision ?? response.identity?.revision ?? null,
      content_hash: response.content_hash ?? response.identity?.content_hash ?? null,
      validation_result_id: response.validation_result_id ?? response.identity?.validation_result_id ?? null,
      run_id: response.run_id ?? null,
      counts: response.counts,
      evidence_ref: response.evidence_ref ?? null,
      next_call: response.next_call ?? null,
      response_compacted: true,
    };
  }
  return {
    contract: response.contract ?? CALL_RECIPE_RUNTIME_CONTRACT,
    ok: false,
    operation: operation ?? response.operation ?? null,
    status: response.status ?? "failed",
    recipe_id: response.recipe_id ?? null,
    version: response.version ?? null,
    revision: response.revision ?? null,
    content_hash: response.content_hash ?? null,
    validation_result_id: response.validation_result_id ?? null,
    run_id: response.run_id ?? null,
    error: {
      code: response.error?.code ?? "RESPONSE_TOO_LARGE",
      message: boundedText(response.error?.message ?? "call_recipe failed.", 240),
    },
    stages: response.stages,
    proven_partial_changes: Array.isArray(response.proven_partial_changes)
      ? response.proven_partial_changes.slice(0, COMPACT_FAILURE_PARTIAL_CHANGE_MAX_COUNT)
      : undefined,
    latest_checkpoint: response.latest_checkpoint ?? null,
    recovery: response.recovery ?? {
      strategy: response.resume_safe === true ? "resume_from_checkpoint" : "inspect_and_repair",
      rollback_claimed: false,
    },
    undo: response.undo ?? { claimed: false, proven: false },
    resume_safe: response.resume_safe === true,
    next_call: response.next_call ?? null,
    evidence_ref: response.evidence_ref ?? null,
    response_compacted: true,
  };
}

function authoritativeActiveProjectIdentity(inventory) {
  if (!isPlainObject(inventory) || inventory.coverage_status !== "complete") {
    throw new CallRecipeRuntimeError(
      "Complete native open-project inventory is required for runtime facts.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  const projects = Array.isArray(inventory.projects) ? inventory.projects : [];
  if (
    !Number.isInteger(inventory.total_count)
    || inventory.total_count !== projects.length
    || !Number.isInteger(inventory.returned_count)
    || inventory.returned_count !== projects.length
  ) {
    throw new CallRecipeRuntimeError(
      "Native open-project inventory counts are incomplete or contradictory.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  const seenRefs = new Set();
  for (const project of projects) {
    const projectRef = project?.project_ref;
    if (!isCanonicalProjectRef(projectRef) || seenRefs.has(projectRef)) {
      throw new CallRecipeRuntimeError(
        "Native open-project inventory contains an invalid or duplicate project ref.",
        "RUNTIME_FACTS_UNAVAILABLE",
      );
    }
    seenRefs.add(projectRef);
  }
  const active = projects.filter((project) => project?.active === true);
  if (active.length !== 1 || typeof active[0].project_ref !== "string" || active[0].project_ref === "") {
    throw new CallRecipeRuntimeError(
      "Native open-project inventory must identify exactly one active project.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  return active[0].project_ref;
}

function isCanonicalProjectRef(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f]/u.test(value)) return false;
  for (const prefix of ["project:path:", "project:tab:"]) {
    if (value.startsWith(prefix) && value.length > prefix.length) return true;
  }
  return false;
}

function authoritativeBridgeIdentity(liveness) {
  const observed = liveness?.heartbeat?.observed;
  if (
    liveness?.ready !== true
    || !isPlainObject(observed)
    || typeof observed.active_owner !== "string"
    || observed.active_owner === ""
    || !Number.isSafeInteger(observed.active_generation)
    || observed.active_generation < 0
  ) {
    throw new CallRecipeRuntimeError(
      "Fresh ready Bridge heartbeat identity is required for runtime facts.",
      "RUNTIME_FACTS_UNAVAILABLE",
    );
  }
  return {
    owner: observed.active_owner,
    generation: String(observed.active_generation),
  };
}

function compactRevisionDiscovery(revision) {
  const draft = revision?.draft ?? {};
  return {
    id: revision?.recipe_id ?? draft.id ?? null,
    title: boundedText(draft.title, 120),
    summary: boundedText(draft.summary, 240),
    pack: draft.pack ?? null,
    risk: draft.risk ?? null,
  };
}

function clampInteger(value, min, max, fallback) {
  if (!Number.isInteger(value)) return fallback;
  return Math.max(min, Math.min(max, value));
}

function parseCursor(value, total) {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "string" || !/^\d+$/.test(value)) {
    throw new CallRecipeRuntimeError("cursor must be a decimal string.", "PARAMS_INVALID");
  }
  const cursor = Number(value);
  if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > total) {
    throw new CallRecipeRuntimeError("cursor is outside the executable recipe list.", "PARAMS_INVALID");
  }
  return cursor;
}

function responseBytes(value) {
  try {
    return Buffer.byteLength(JSON.stringify(value), "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function sameRunIdentity(left, right) {
  if (!isPlainObject(left) || !isPlainObject(right)) return false;
  return ["recipe_id", "version", "revision", "content_hash", "validation_result_id"]
    .every((key) => left[key] === right[key]);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function boundedText(value, maxChars) {
  const text = typeof value === "string" ? value : "";
  return text.length <= maxChars ? text : text.slice(0, maxChars);
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function freeze(value) {
  return Object.freeze(value);
}

export {
  EXECUTABLE_RECIPE_RUN_CONTRACT,
  EXECUTABLE_RECIPE_EVIDENCE_CONTRACT,
  buildExecutableRecipeRevisionIdentity,
  createExecutableDependencyCatalog,
  sealExecutableRecipeRevision,
};
