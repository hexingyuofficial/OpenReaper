import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";
import {
  executeAlpha3_2_5BProjectUnderstandingMacro,
} from "./alpha3-2-5-b-project-understanding-v1.mjs";
import {
  ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
} from "./alpha3-c3-project-index-query-v1.mjs";
import {
  ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
  ALPHA3_2_5_C_CONTROL_TARGET_KINDS,
  getAlpha3_2_5CControlTargetDefinition,
  planAlpha3_2_5CControlsSetMacro,
} from "./alpha3-c5-generic-control-macros-v1.mjs";
import {
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
  ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
  ALPHA3_E1_STOCK_PLUGIN_SUMMARY_BUDGET,
  getAlpha3E1StockPluginMap,
  planAlpha3E1StockPluginMacro,
} from "./alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  assertAlpha34CSemanticUnitsProven,
  createAlpha34CExactParametersPublicResult,
  createExactParametersRecoveryCall,
  hydrateCompleteFxParameterInventory,
  normalizeAlpha34CFxSetControlsInput,
  resolveExactParameterTargets,
  STOCK_SEMANTIC_UNIT_UNPROVEN,
} from "./alpha3-4-c-fx-semantic-truth-v1.mjs";
import {
  executeExactAssignmentsBatch,
  isExactAssignmentsMode,
} from "./alpha3-4-d2-fx-batch-v1.mjs";

export const ALPHA3_2_5_C_CONTROL_RUNTIME_CONTRACT =
  "alpha3.2.5.c.control_runtime.v1";

export const ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY =
  "project_understanding.runtime.v1";
export const ALPHA3_2_5_C_CONTROL_EXECUTOR_CAPABILITY =
  "controls.serial_template_program.v1";
export const ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY =
  "stock_plugin.semantic_parameter_program.v1";

const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const RESOLVE_ITEM_ID = "template.items.resolve_item_ref";
const RESOLVE_SEND_ID = "template.routing.resolve_send_ref";
const READ_TRANSPORT_ID = "template.transport.read_state";
const READ_PROJECT_TEMPO_ID = "template.project.read_tempo_map";
const READ_FX_SUMMARY_ID = "template.fx.read_fx_summary";
const RESOLVE_FX_ID = "template.fx.resolve_fx_ref";
const RESOLVE_MIDI_TAKE_ID = "template.midi.resolve_midi_take_ref";
const LIST_FX_PARAMETERS_ID = "template.fx.list_fx_parameters";
const SET_FX_PARAMETER_ID = "template.fx.set_fx_parameter_normalized";
const READ_FX_PARAMETER_ID = "template.fx.read_fx_parameter";
const SET_REAEQ_BANDS_ID = "template.fx.set_reaeq_bands";

const CONTROL_INPUT_FIELDS = new Set(["target_kind", "fields", "selector", "changes", "dry_run"]);
const CONTROL_BATCH_ROW_FIELDS = new Set(["id", "target_kind", "fields", "selector", "refs"]);
const CONTROL_BATCH_MAX_ROWS = 8;
const STOCK_INPUT_FIELDS = new Set([
  "plugin", "plugin_id", "plugin_name", "controls", "starter_action",
  "action_parameters", "control_overrides", "parameter_metadata", "selector", "dry_run",
  "mode", "changes", "bands",
]);
const CONTROL_TARGET_KINDS = ALPHA3_2_5_C_CONTROL_TARGET_KINDS;
const SQLITE_IDENTITY_FIELDS = Object.freeze([
  "project", "bridge_owner", "bridge_generation", "snapshot", "revision",
]);

const CONTROL_TEMPLATE_IDS = Object.freeze([...new Set([
  RESOLVE_TRACK_ID,
  RESOLVE_ITEM_ID,
  RESOLVE_SEND_ID,
  READ_TRANSPORT_ID,
  ...CONTROL_TARGET_KINDS.flatMap((targetKind) => {
    const definition = getAlpha3_2_5CControlTargetDefinition(targetKind);
    return [
      ...(definition?.fields ?? []).map((field) => field.template_id),
      definition?.readback?.template_id,
    ].filter(Boolean);
  }),
])]);

const STOCK_TEMPLATE_IDS = Object.freeze([
  RESOLVE_TRACK_ID,
  RESOLVE_MIDI_TAKE_ID,
  RESOLVE_FX_ID,
  READ_FX_SUMMARY_ID,
  LIST_FX_PARAMETERS_ID,
  SET_FX_PARAMETER_ID,
  READ_FX_PARAMETER_ID,
  SET_REAEQ_BANDS_ID,
]);

const RUNTIME_CAPABILITIES = Object.freeze([
  ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY,
  ALPHA3_2_5_C_CONTROL_EXECUTOR_CAPABILITY,
  ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
]);

const REGISTRY_ENTRIES = Object.freeze([
  registryEntry({
    macroId: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
    programId: "openreaper.macro.controls.set",
    templateIds: CONTROL_TEMPLATE_IDS,
    executorCapability: ALPHA3_2_5_C_CONTROL_EXECUTOR_CAPABILITY,
    stagePrefix: "controls",
  }),
  registryEntry({
    macroId: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
    programId: "openreaper.macro.set_stock_plugin_controls",
    templateIds: STOCK_TEMPLATE_IDS,
    executorCapability: ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
    stagePrefix: "stock-plugin",
  }),
]);

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRIES.flatMap((entry) =>
  entry.stages.map((stage) => stage.id)
));

export function createAlpha3_2_5CControlRegistry(options = {}) {
  return createMacroProgramRegistry(REGISTRY_ENTRIES, {
    acceptedTemplateIds: options.acceptedTemplateIds ?? [
      ...CONTROL_TEMPLATE_IDS,
      ...STOCK_TEMPLATE_IDS,
    ],
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? RUNTIME_CAPABILITIES,
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_2_5_C_CONTROL_REGISTRY = createAlpha3_2_5CControlRegistry();

export function isAlpha3_2_5CExecutableControlMacroId(id) {
  return id === ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID
    || id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID;
}

export async function executeAlpha3_2_5CControlMacro(options = {}) {
  const id = options.request?.id;
  if (id === ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID) {
    return executeControlsSet(options);
  }
  if (id === ALPHA3_E1_STOCK_PLUGIN_MACRO_ID) {
    return executeStockPluginControls(options);
  }
  throw new TypeError(`Unsupported Alpha3.2.5-C control Macro id: ${String(id)}`);
}

async function executeControlsSet({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_C_CONTROL_REGISTRY.get(ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = object(request.input) ? request.input : {};
  const dryRun = input.dry_run === true;
  const stages = [];
  const state = executionState();
  rememberInputObjectRefs(state, request.refs);

  if (Object.hasOwn(input, "changes")) {
    return executeControlsBatch({
      request,
      input,
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
      entry,
      startedAt,
      stages,
      state,
    });
  }

  const inputBlockers = validateInputFields(input, CONTROL_INPUT_FIELDS, "CONTROL_INPUT_FIELD_UNSUPPORTED");
  const requestValidation = validateMacroProgramRequest({
    macro_id: request.id,
    input,
    refs: request.refs ?? [],
    dry_run: dryRun,
    ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}),
  }, { registry: ALPHA3_2_5_C_CONTROL_REGISTRY });
  if (inputBlockers.length > 0 || !requestValidation.valid) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: inputBlockers[0]?.code ?? "MACRO_REQUEST_INVALID",
      message: inputBlockers[0]?.message ?? requestValidation.errors.join("; "),
      blockers: [...inputBlockers, ...validationBlockers(requestValidation.errors)],
    });
  }
  const preliminaryPlan = planAlpha3_2_5CControlsSetMacro(input, normalizeNamedRefs(request.refs), { catalog });
  const preliminaryBlockers = (preliminaryPlan.blockers ?? []).filter((item) => item.code !== "REQUIRED_REF_MISSING");
  if (preliminaryBlockers.length > 0) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: preliminaryBlockers[0].code,
      message: preliminaryBlockers[0].message,
      blockers: preliminaryBlockers,
      data: { target_kind: input.target_kind ?? null },
    });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: "CONTROL_LIVE_EXECUTOR_UNAVAILABLE",
      message: "macro.controls.set needs the managed OpenReaper atomic route.",
    });
  }

  const target = await resolveControlTarget({
    targetKind: input.target_kind,
    selector: input.selector,
    refs: request.refs,
    request,
    executeAtomic,
    projectIndexRuntime,
    catalog,
    now,
    stages,
    state,
  });
  if (!target.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: target.blockers[0]?.code ?? "CONTROL_TARGET_BLOCKED",
      message: target.blockers[0]?.message ?? "The control target could not be resolved.",
      blockers: target.blockers,
    });
  }

  const plan = planAlpha3_2_5CControlsSetMacro(input, target.refs, { catalog });
  if (plan.ok !== true) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: plan.blockers[0]?.code ?? "CONTROL_PLAN_BLOCKED",
      message: plan.blockers[0]?.message ?? "The bounded control request is blocked.",
      blockers: plan.blockers,
      data: { target_kind: input.target_kind },
    });
  }
  const requestedFields = plan.normalized_fields ?? input.fields;

  if (dryRun) {
    pushStage(stages, "controls-execute", "runtime_execute", "skipped", "Mutation skipped during dry_run.");
    pushStage(stages, "controls-verify", "verify", "skipped", "Readback comparison is not required for a non-mutating preview.");
    pushStage(stages, "controls-index-update", "index_update", "skipped", "No Project Index scope changed during dry_run.");
    pushStage(stages, "controls-result", "result_project", "completed", "Projected the fixed bounded control program.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "dry_run_completed",
      summary: `Validated ${input.target_kind} control changes without mutation.`,
      data: {
        target_kind: input.target_kind,
        fields: clone(requestedFields),
        target_refs: clone(target.refs),
        registered_template_ids: plan.requests.map((child) => child.id),
        sqlite_selector_used: target.sqliteUsed,
      },
    });
  }

  try {
    for (const [index, child] of plan.requests.entries()) {
      const execution = await runAtomic({
        executeAtomic,
        request,
        state,
        child: materializeProjectTimeSignatureChild(child, target.projectTempo),
        idempotencyKey: childIdempotencyKey(request.idempotency_key, index),
      });
      collectExecution(state, execution);
      const atomicReadback = captureRequiredAtomicControlReadback({
        targetKind: input.target_kind,
        fields: child.fields,
        requestedFields,
        readback: executionReadback(execution),
      });
      state.changes.push({
        template_id: child.id,
        fields: clone(child.fields ?? []),
        status: "mutation_completed",
        mutation: { status: "completed", dispatch_status: "completed" },
        live_readback: { status: "pending" },
        index_maintenance: { status: "pending" },
        atomic_readback: atomicReadback,
      });
    }
    pushStage(
      stages,
      "controls-execute",
      "runtime_execute",
      "completed",
      `Executed ${plan.requests.length} fixed accepted control Template call(s).`,
      state.evidenceRefs,
    );

    const readbackExecution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: plan.readback,
    });
    collectExecution(state, readbackExecution);
    state.readback = executionReadback(readbackExecution);
    const readbackVerification = verifyControlReadback({
      targetKind: input.target_kind,
      requestedFields,
      targetRefs: target.refs,
      readback: state.readback,
      atomicChanges: state.changes,
    });
    applyControlReadbackToChanges(state.changes, readbackVerification.rows);
    if (!readbackVerification.ok) {
      pushStage(
        stages,
        "controls-verify",
        "verify",
        "failed",
        "One or more requested control fields did not match live readback.",
        executionEvidenceRefs(readbackExecution),
      );
      const invalidation = invalidateKnownScopes(projectIndexRuntime, controlScopes(input.target_kind), now);
      state.indexUpdate = invalidation;
      applyIndexMaintenanceToChanges(state.changes, invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped", invalidation);
      if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
      pushStage(
        stages,
        "controls-index-update",
        "index_update",
        invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
        invalidation?.ok === false
          ? "Live readback failed and affected Project Index scopes could not be marked stale."
          : invalidation
            ? `Live readback failed; marked ${invalidation.scopes.length} affected Project Index scope(s) stale.`
            : "Live readback failed; no configured Project Index runtime required invalidation.",
      );
      throw coded(
        "CONTROL_READBACK_MISMATCH",
        "One or more batch-readable control fields did not match the requested values.",
        [
          ...readbackVerification.blockers,
          ...(invalidation?.ok === false ? invalidation.blockers ?? [] : []),
        ],
      );
    }
    pushStage(
      stages,
      "controls-verify",
      "verify",
      "completed",
      `Compared ${readbackVerification.compared_count} batch-readable field(s); ${readbackVerification.atomic_only_count} remaining field(s) retained accepted atomic Template verification.`,
      executionEvidenceRefs(readbackExecution),
    );

    const invalidation = invalidateKnownScopes(projectIndexRuntime, controlScopes(input.target_kind), now);
    if (invalidation?.ok === false) {
      state.indexUpdate = invalidation;
      applyIndexMaintenanceToChanges(state.changes, "failed", invalidation);
      throw coded(
        invalidation.blockers?.[0]?.code ?? "CONTROL_INDEX_INVALIDATION_FAILED",
        invalidation.blockers?.[0]?.message ?? "The write completed but affected Project Index scopes could not be marked stale.",
        invalidation.blockers,
      );
    }
    state.indexUpdate = invalidation;
    applyIndexMaintenanceToChanges(state.changes, invalidation ? "completed" : "skipped", invalidation);
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    pushStage(
      stages,
      "controls-index-update",
      "index_update",
      invalidation ? "completed" : "skipped",
      invalidation
        ? `Marked ${invalidation.scopes.length} affected Project Index scope(s) stale.`
        : "No configured Project Index runtime required invalidation.",
    );
    pushStage(stages, "controls-result", "result_project", "completed", "Projected compact requested fields, refs, readback, and index freshness.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      summary: `Applied and read back ${input.target_kind} controls.`,
      data: {
        target_kind: input.target_kind,
        fields: clone(requestedFields),
        target_refs: clone(target.refs),
        readback: compactObject(state.readback),
        readback_verification: readbackVerification.rows,
        index_update: compactObject(invalidation),
        outcome: outcomeEvidence(state),
      },
    });
  } catch (error) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: state.changes.length > 0 ? "partial_failure" : "failed",
      code: error.code ?? "CONTROL_EXECUTION_FAILED",
      message: error.message ?? "The registered control program failed.",
      blockers: error.blockers,
      data: {
        target_kind: input.target_kind,
        target_refs: clone(target.refs),
        readback: compactObject(state.readback),
        index_update: compactObject(state.indexUpdate),
        outcome: outcomeEvidence(state),
      },
    });
  }
}

async function executeControlsBatch({
  request,
  input,
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now,
  entry,
  startedAt,
  stages,
  state,
}) {
  const normalized = normalizeControlBatchInput(input, request.refs);
  if (!normalized.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: normalized.blockers[0].code,
      message: normalized.blockers[0].message,
      blockers: normalized.blockers,
    });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: "CONTROL_LIVE_EXECUTOR_UNAVAILABLE",
      message: "macro.controls.set changes[] needs the managed OpenReaper atomic route.",
    });
  }

  const preflights = [];
  for (const row of normalized.rows) {
    const preview = await executeControlsSet({
      request: controlBatchChildRequest(request, row, true),
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
    });
    collectMacroEnvelopeEvidence(state, preview);
    if (preview?.ok !== true || preview?.execution?.status !== "dry_run_completed") {
      pushStage(stages, "controls-select-target", "selector_resolve", "failed", `Batch preflight failed for ${row.id}.`, preview?.result?.verification?.evidence_refs);
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        code: preview?.error?.code ?? "CONTROL_BATCH_PREFLIGHT_FAILED",
        message: `Control batch preflight failed for ${row.id}: ${preview?.error?.message ?? preview?.result?.summary ?? "unknown blocker"}`,
        blockers: preview?.blockers,
        data: {
          mode: "changes",
          failed_operation_id: row.id,
          preflighted_count: preflights.length,
          total_count: normalized.rows.length,
          mutation_skipped: true,
        },
      });
    }
    preflights.push(preview);
  }

  state.changes = normalized.rows.map((row, index) => controlBatchChangeFromEnvelope({
    row,
    envelope: preflights[index],
    status: "planned",
  }));
  pushStage(stages, "controls-select-target", "selector_resolve", "completed", `Preflighted ${normalized.rows.length} independent live control target(s).`, state.evidenceRefs);
  pushStage(stages, "controls-live-resolve", "live_ref_resolve", "completed", "Every batch row resolved its own live target before mutation.", state.evidenceRefs);

  if (normalized.dryRun) {
    pushStage(stages, "controls-execute", "runtime_execute", "skipped", "All batch mutations were skipped during dry_run.");
    pushStage(stages, "controls-verify", "verify", "skipped", "Mutation readback is not required for a non-mutating batch preview.");
    pushStage(stages, "controls-index-update", "index_update", "skipped", "No Project Index scope changed during dry_run.");
    pushStage(stages, "controls-result", "result_project", "completed", "Projected the bounded multi-target control preview.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "dry_run_completed",
      summary: `Validated ${normalized.rows.length} independent control change row(s) without mutation.`,
      data: {
        mode: "changes",
        total_count: normalized.rows.length,
        planned_count: normalized.rows.length,
        mutation_skipped: true,
        executable_retry: {
          id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
          input: { changes: clone(input.changes), dry_run: false },
        },
      },
    });
  }

  let failed = null;
  for (let index = 0; index < normalized.rows.length; index += 1) {
    const row = normalized.rows[index];
    const result = await executeControlsSet({
      request: controlBatchChildRequest(request, row, false),
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
    });
    collectMacroEnvelopeEvidence(state, result);
    state.changes[index] = controlBatchChangeFromEnvelope({ row, envelope: result });
    if (result?.ok !== true) {
      failed = { row, result, index };
      for (let later = index + 1; later < normalized.rows.length; later += 1) {
        state.changes[later] = {
          ...state.changes[later],
          status: "not_run",
          mutation: { status: "not_run" },
          live_readback: { status: "not_run" },
          index_maintenance: { status: "not_run", scopes: [] },
        };
      }
      break;
    }
  }

  const appliedCount = state.changes.filter((row) => row.status === "applied").length;
  const readbackPassedCount = state.changes.filter((row) => row.live_readback?.status === "passed").length;
  const scopes = unique(state.changes.flatMap((row) => row.index_maintenance?.scopes ?? []));
  if (failed) {
    pushStage(stages, "controls-execute", "runtime_execute", appliedCount > 0 ? "completed" : "failed", `Stopped after ${failed.row.id}; ${appliedCount} earlier row(s) have row-specific live truth.`, state.evidenceRefs);
    pushStage(stages, "controls-verify", "verify", readbackPassedCount > 0 ? "completed" : "failed", `${readbackPassedCount} batch row(s) passed independent live readback.`, state.evidenceRefs);
    pushStage(stages, "controls-index-update", "index_update", "completed", `Preserved each executed row's independent index-maintenance outcome across ${scopes.length} scope(s).`, state.evidenceRefs);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: appliedCount > 0 || failed.result?.execution?.status === "partial_failure" ? "partial_failure" : "failed",
      code: failed.result?.error?.code ?? "CONTROL_BATCH_ROW_FAILED",
      message: `Control batch stopped at ${failed.row.id}: ${failed.result?.error?.message ?? failed.result?.result?.summary ?? "row failed"}`,
      blockers: failed.result?.blockers,
      data: {
        mode: "changes",
        failed_operation_id: failed.row.id,
        total_count: normalized.rows.length,
        applied_count: appliedCount,
        live_readback_passed_count: readbackPassedCount,
        index_scopes: scopes,
      },
    });
  }

  pushStage(stages, "controls-execute", "runtime_execute", "completed", `Executed ${normalized.rows.length} fixed control row(s) serially.`, state.evidenceRefs);
  pushStage(stages, "controls-verify", "verify", "completed", `Every batch row passed its own live readback.`, state.evidenceRefs);
  pushStage(stages, "controls-index-update", "index_update", "completed", `Preserved row-specific index maintenance across ${scopes.length} affected scope(s).`, state.evidenceRefs);
  pushStage(stages, "controls-result", "result_project", "completed", "Projected per-row mutation, live-readback, and index-maintenance truth.");
  return successEnvelope({
    entry, request, startedAt, now, stages, state,
    summary: `Applied and verified ${appliedCount} independent control change row(s).`,
    data: {
      mode: "changes",
      total_count: normalized.rows.length,
      applied_count: appliedCount,
      live_readback_passed_count: readbackPassedCount,
      index_scopes: scopes,
    },
  });
}

async function executeStockPluginControls({
  request = {},
  executeAtomic,
  nativeBatchExecutor,
  projectIndexRuntime,
  catalog,
  semanticProofChecker = assertAlpha34CSemanticUnitsProven,
  now = () => new Date(),
  monoNow = () => performance.now(),
} = {}) {
  const entry = ALPHA3_2_5_C_CONTROL_REGISTRY.get(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = object(request.input) ? request.input : {};
  const dryRun = input.dry_run === true;
  const stages = [];
  const state = executionState();
  rememberInputObjectRefs(state, request.refs);
  if (isExactAssignmentsMode(input)) {
    return executeExactAssignmentsBatch({
      request,
      executeAtomic,
      projectIndexRuntime,
      now,
      monoNow,
      entry,
      startedAt,
      stages,
      state,
      listBudget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
      readBudget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
      nativeBatchExecutor,
    });
  }
  const inputBlockers = validateInputFields(input, STOCK_INPUT_FIELDS, "STOCK_PLUGIN_INPUT_FIELD_UNSUPPORTED");
  const normalizedMode = normalizeAlpha34CFxSetControlsInput(input);
  if (!normalizedMode.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: normalizedMode.code,
      message: normalizedMode.message,
      blockers: [{ code: normalizedMode.code, message: normalizedMode.message, recoverable: true }],
    });
  }
  if (inputBlockers.length > 0) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: inputBlockers[0].code,
      message: inputBlockers[0].message,
      blockers: inputBlockers,
    });
  }
  if (normalizedMode.mode === "exact_parameters") {
    return executeExactFxParameters({
      request,
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
      entry,
      startedAt,
      stages,
      state,
      normalized: normalizedMode,
    });
  }
  if (normalizedMode.mode === "reaeq_bands") {
    return executeReaEqBands({
      request,
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
      entry,
      startedAt,
      stages,
      state,
      normalized: normalizedMode,
    });
  }
  const requestValidation = validateMacroProgramRequest({
    macro_id: request.id,
    input,
    refs: request.refs ?? [],
    dry_run: dryRun,
    ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}),
  }, { registry: ALPHA3_2_5_C_CONTROL_REGISTRY });
  if (inputBlockers.length > 0 || !requestValidation.valid) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: inputBlockers[0]?.code ?? "MACRO_REQUEST_INVALID",
      message: inputBlockers[0]?.message ?? requestValidation.errors.join("; "),
      blockers: [...inputBlockers, ...validationBlockers(requestValidation.errors)],
    });
  }
  const directRefs = normalizeNamedRefs(request.refs);
  const preliminary = planAlpha3E1StockPluginMacro(request.id, {
    ...input,
    refs: directRefs,
  }, { catalog });
  const hardBlockers = (preliminary.blockers ?? []).filter((item) => ![
    "REQUIRED_REF_MISSING",
    "PARAMETER_METADATA_REQUIRED",
    "PARAMETER_METADATA_NOT_FRESH",
    "PARAMETER_INDEX_REQUIRED",
  ].includes(item.code));
  if (hardBlockers.length > 0) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: hardBlockers[0].code,
      message: hardBlockers[0].message,
      blockers: hardBlockers,
    });
  }
  const wantedControls = preliminary.hydration_flow?.wanted_controls
    ?? Object.keys(isPlainObject(input.controls) ? input.controls : {});
  const pluginId = preliminary.plugin?.id ?? getAlpha3E1StockPluginMap(input.plugin ?? input.plugin_id ?? input.plugin_name)?.id ?? null;
  if (pluginId && wantedControls.length > 0) {
    const proof = semanticProofChecker(pluginId, wantedControls);
    if (!proof.ok) {
      const recovery = createExactParametersRecoveryCall({
        plugin_id: pluginId,
        unproven_controls: proof.unproven,
        fx_ref: directRefs.fx_ref ?? null,
      });
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: STOCK_SEMANTIC_UNIT_UNPROVEN,
        message: proof.message,
        blockers: [{
          code: STOCK_SEMANTIC_UNIT_UNPROVEN,
          message: proof.message,
          recoverable: true,
          details: {
            plugin_id: pluginId,
            unproven_controls: proof.unproven,
            ...(recovery ? { recovery } : {}),
          },
        }],
        data: {
          mode: "semantic",
          unproven_controls: proof.unproven,
          ...(recovery ? { next_call: recovery } : {}),
        },
      });
    }
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: "STOCK_PLUGIN_LIVE_EXECUTOR_UNAVAILABLE",
      message: "macro.set_stock_plugin_controls needs the managed OpenReaper atomic route.",
    });
  }

  const selected = await resolveFxTarget({
    refs: directRefs,
    selector: input.selector,
    plugin: preliminary.plugin,
    request,
    executeAtomic,
    projectIndexRuntime,
    catalog,
    now,
    stages,
    state,
  });
  if (!selected.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: selected.blockers[0]?.code ?? "STOCK_PLUGIN_TARGET_BLOCKED",
      message: selected.blockers[0]?.message ?? "The stock-plugin target could not be resolved.",
      blockers: selected.blockers,
    });
  }

  try {
    const summaryExecution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: {
        id: READ_FX_SUMMARY_ID,
        input: {},
        refs: { fx_ref: selected.fxRef },
        budget: ALPHA3_E1_STOCK_PLUGIN_SUMMARY_BUDGET,
      },
    });
    collectExecution(state, summaryExecution);
    const liveSummary = executionReadback(summaryExecution);
    const pluginMap = getAlpha3E1StockPluginMap(preliminary.plugin?.id ?? input.plugin ?? input.plugin_id ?? input.plugin_name);
    if (!pluginMap || !pluginIdentityMatches(pluginMap, liveSummary?.name ?? liveSummary?.plugin_name)) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: "STOCK_PLUGIN_IDENTITY_MISMATCH",
        message: "The live FX identity does not match the requested supported stock plugin.",
        data: {
          expected_plugin: pluginMap?.display_name ?? preliminary.plugin?.display_name ?? null,
          observed_plugin: liveSummary?.name ?? liveSummary?.plugin_name ?? null,
          fx_ref: selected.fxRef,
        },
      });
    }

    const parameterExecution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: {
        id: LIST_FX_PARAMETERS_ID,
        input: { limit: 128 },
        refs: { fx_ref: selected.fxRef },
        budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
      },
    });
    collectExecution(state, parameterExecution);
    const parameterRows = executionReadback(parameterExecution)?.parameters;
    const metadataResult = resolveFreshParameterMetadata({
      pluginMap,
      wantedControls: preliminary.hydration_flow?.wanted_controls ?? [],
      rows: parameterRows,
      observedAt: safeNowIso(now),
    });
    if (!metadataResult.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: metadataResult.blockers[0]?.code ?? "STOCK_PARAMETER_METADATA_BLOCKED",
        message: metadataResult.blockers[0]?.message ?? "Fresh parameter metadata could not be matched deterministically.",
        blockers: metadataResult.blockers,
      });
    }
    pushStage(
      stages,
      "stock-plugin-live-resolve",
      "live_ref_resolve",
      "completed",
      `Verified ${pluginMap.display_name} identity and resolved ${Object.keys(metadataResult.metadata).length} fresh parameter index(es).`,
      [...executionEvidenceRefs(summaryExecution), ...executionEvidenceRefs(parameterExecution)],
    );

    const plan = planAlpha3E1StockPluginMacro(request.id, {
      ...input,
      refs: { fx_ref: selected.fxRef },
      parameter_metadata: metadataResult.metadata,
    }, { catalog });
    if (plan.ok !== true) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: plan.blockers[0]?.code ?? "STOCK_PLUGIN_PLAN_BLOCKED",
        message: plan.blockers[0]?.message ?? "The stock-plugin semantic program remained blocked after live metadata hydration.",
        blockers: plan.blockers,
      });
    }

    if (dryRun) {
      pushStage(stages, "stock-plugin-execute", "runtime_execute", "skipped", "Parameter writes skipped during dry_run.");
      pushStage(stages, "stock-plugin-verify", "verify", "skipped", "Readback comparison is not required for a non-mutating preview.");
      pushStage(stages, "stock-plugin-index-update", "index_update", "skipped", "No FX Project Index scope changed during dry_run.");
      pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected fresh semantic-to-parameter mappings without mutation.");
      return successEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "dry_run_completed",
        summary: `Validated ${pluginMap.display_name} semantic controls without mutation.`,
        data: {
          plugin: { id: pluginMap.id, display_name: pluginMap.display_name },
          fx_ref: selected.fxRef,
          controls: plan.evidence_plan?.requested_controls ?? [],
          parameter_metadata: metadataResult.compact,
          sqlite_selector_used: selected.sqliteUsed,
        },
      });
    }

    for (const [index, child] of plan.requests.entries()) {
      const execution = await runAtomic({
        executeAtomic,
        request,
        state,
        child,
        idempotencyKey: childIdempotencyKey(request.idempotency_key, index),
      });
      collectExecution(state, execution);
      state.changes.push({
        template_id: child.id,
        semantic_control: child.semantic_control?.id ?? null,
        param_index: child.input?.param_index,
        normalized_value: child.input?.normalized_value,
        status: "mutation_completed",
        mutation: { status: "completed", dispatch_status: "completed" },
        live_readback: { status: "pending" },
        index_maintenance: { status: "pending" },
      });
    }
    pushStage(stages, "stock-plugin-execute", "runtime_execute", "completed", `Executed ${plan.requests.length} fixed semantic parameter write(s).`, state.evidenceRefs);

    const readbackRows = [];
    for (const [index, child] of plan.readback.entries()) {
      const execution = await runAtomic({ executeAtomic, request, state, child });
      collectExecution(state, execution);
      const observed = executionReadback(execution);
      const expected = plan.requests[index]?.input?.normalized_value;
      const tolerance = plan.requests[index]?.input?.tolerance ?? 0.0001;
      const actual = Number(observed?.normalized_value);
      if (!Number.isFinite(actual) || !Number.isFinite(expected) || Math.abs(actual - expected) > tolerance) {
        throw coded(
          "STOCK_PLUGIN_READBACK_MISMATCH",
          `Readback for ${child.semantic_control?.id ?? `parameter ${index}`} did not match the requested normalized value.`,
        );
      }
      readbackRows.push({
        control: child.semantic_control?.id ?? null,
        param_index: child.input?.param_index,
        requested_normalized_value: expected,
        observed_normalized_value: actual,
        tolerance,
      });
      const change = state.changes[index];
      if (change) {
        change.status = "applied";
        change.live_readback = {
          status: "passed",
          source: "live_parameter_readback",
          requested_normalized_value: expected,
          observed_normalized_value: actual,
          tolerance,
        };
      }
    }
    state.readback = readbackRows;
    pushStage(stages, "stock-plugin-verify", "verify", "completed", `Verified ${readbackRows.length} parameter readback value(s).`, state.evidenceRefs);

    const invalidation = invalidateKnownScopes(projectIndexRuntime, ["fx"], now);
    if (invalidation?.ok === false) {
      state.indexUpdate = invalidation;
      applyIndexMaintenanceToChanges(state.changes, "failed", invalidation);
      throw coded(
        invalidation.blockers?.[0]?.code ?? "STOCK_PLUGIN_INDEX_INVALIDATION_FAILED",
        invalidation.blockers?.[0]?.message ?? "FX writes completed but the Project Index FX scope could not be marked stale.",
        invalidation.blockers,
      );
    }
    state.indexUpdate = invalidation;
    applyIndexMaintenanceToChanges(state.changes, invalidation ? "completed" : "skipped", invalidation);
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    pushStage(stages, "stock-plugin-index-update", "index_update", invalidation ? "completed" : "skipped", invalidation ? "Marked the Project Index FX scope stale." : "No configured Project Index runtime required invalidation.");
    pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected compact semantic controls and exact readback evidence.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      summary: `Applied and verified ${pluginMap.display_name} semantic controls.`,
      data: {
        plugin: { id: pluginMap.id, display_name: pluginMap.display_name },
        fx_ref: selected.fxRef,
        readback: readbackRows,
        index_update: compactObject(invalidation),
        outcome: outcomeEvidence(state),
      },
    });
  } catch (error) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: state.changes.length > 0 ? "partial_failure" : "failed",
      code: error.code ?? "STOCK_PLUGIN_EXECUTION_FAILED",
      message: error.message ?? "The registered stock-plugin program failed.",
      blockers: error.blockers,
      data: {
        fx_ref: selected.fxRef,
        readback: compactObject(state.readback),
        index_update: compactObject(state.indexUpdate),
        outcome: outcomeEvidence(state),
      },
    });
  }
}

async function executeReaEqBands({
  request,
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now,
  entry,
  startedAt,
  stages,
  state,
  normalized,
}) {
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: "STOCK_PLUGIN_LIVE_EXECUTOR_UNAVAILABLE",
      message: "macro.fx.set_controls reaeq_bands needs the managed OpenReaper atomic route.",
    });
  }
  const selected = await resolveFxTarget({
    refs: normalizeNamedRefs(request.refs),
    selector: normalized.selector ?? request.input?.selector,
    plugin: { id: "reaeq" },
    request,
    executeAtomic,
    projectIndexRuntime,
    catalog,
    now,
    stages,
    state,
  });
  if (!selected.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: selected.blockers[0]?.code ?? "STOCK_PLUGIN_TARGET_BLOCKED",
      message: selected.blockers[0]?.message ?? "The ReaEQ target could not be resolved.",
      blockers: selected.blockers,
      data: { mode: "reaeq_bands" },
    });
  }

  try {
    pushStage(stages, "stock-plugin-live-resolve", "live_ref_resolve", "completed", "Live-resolved one exact owner-scoped FX target before the ReaEQ batch preflight.", state.evidenceRefs);
    const execution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: {
        id: SET_REAEQ_BANDS_ID,
        input: { bands: normalized.bands, dry_run: normalized.dry_run },
        refs: { fx_ref: selected.fxRef },
        budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
      },
    });
    collectExecution(state, execution);
    const readback = executionReadback(execution);
    if (!readback || readback.fx_ref !== selected.fxRef || readback.plugin_identity === undefined
        || readback.owner_kind === undefined || !Array.isArray(readback.rows)
        || readback.rows.length !== normalized.bands.length
        || readback.mutation_attempted !== !normalized.dry_run) {
      throw coded("FX_REAEQ_AGGREGATE_READBACK_INVALID", "The ReaEQ batch returned incomplete aggregate identity, topology, or value truth.");
    }

    const changeStatus = normalized.dry_run ? "planned" : "applied";
    state.changes = readback.rows.map((row) => ({
      id: `band_${row.band}`,
      status: changeStatus,
      fx_ref: selected.fxRef,
      band: row.band,
      mutation: { status: normalized.dry_run ? "skipped" : "completed" },
      live_readback: { status: normalized.dry_run ? "preflight_passed" : "passed" },
      index_maintenance: { status: "not_run", scopes: [] },
    }));
    pushStage(stages, "stock-plugin-execute", "runtime_execute", normalized.dry_run ? "skipped" : "completed", normalized.dry_run ? "ReaEQ dry_run completed with zero writes." : "Executed one native ReaEQ band batch.", executionEvidenceRefs(execution));
    pushStage(stages, "stock-plugin-verify", "verify", normalized.dry_run ? "completed" : "completed", "Received one aggregate ReaEQ identity, topology, exact-parameter, and value readback.", executionEvidenceRefs(execution));

    let invalidation = null;
    if (!normalized.dry_run) {
      invalidation = invalidateKnownScopes(projectIndexRuntime, ["fx"], now);
      state.indexUpdate = invalidation;
      applyIndexMaintenanceToChanges(state.changes, invalidation?.ok === false ? "failed" : (invalidation ? "completed" : "skipped"), invalidation);
      if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    }
    pushStage(
      stages,
      "stock-plugin-index-update",
      "index_update",
      invalidation?.ok === false ? "failed" : (!normalized.dry_run && invalidation ? "completed" : "skipped"),
      normalized.dry_run ? "No FX index change during dry_run." : (invalidation ? "Invalidated FX Project Index scope once after the ReaEQ batch." : "No configured Project Index runtime required invalidation."),
    );
    pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected the typed ReaEQ band profile and aggregate native readback.");
    if (invalidation?.ok === false) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "partial_failure",
        code: invalidation.blockers?.[0]?.code ?? "FX_REAEQ_INDEX_INVALIDATION_FAILED",
        message: invalidation.blockers?.[0]?.message ?? "ReaEQ mutation passed but the FX index could not be invalidated.",
        data: { mode: "reaeq_bands", ...readback, index_update: compactObject(invalidation), outcome: outcomeEvidence(state) },
      });
    }
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      status: normalized.dry_run ? "dry_run_completed" : "completed",
      summary: normalized.dry_run
        ? `Validated ${readback.rows.length} ReaEQ band row(s) without mutation.`
        : `Applied and verified ${readback.rows.length} ReaEQ band row(s) in one native batch.`,
      data: { mode: "reaeq_bands", ...readback, index_update: compactObject(invalidation), outcome: outcomeEvidence(state) },
    });
  } catch (error) {
    const mutationUnknown = error?.details?.mutation_outcome === "unknown" || error?.details?.mutation_attempted === true;
    if (mutationUnknown) {
      const invalidation = invalidateKnownScopes(projectIndexRuntime, ["fx"], now);
      state.indexUpdate = invalidation;
    }
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: mutationUnknown ? "partial_failure" : "failed",
      code: error.code ?? "FX_REAEQ_BANDS_FAILED",
      message: error.message ?? "ReaEQ band execution failed.",
      blockers: error.blockers,
      data: { mode: "reaeq_bands", fx_ref: selected.fxRef, outcome: outcomeEvidence(state) },
    });
  }
}

async function executeExactFxParameters({
  request,
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now,
  entry,
  startedAt,
  stages,
  state,
  normalized,
}) {
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: "STOCK_PLUGIN_LIVE_EXECUTOR_UNAVAILABLE",
      message: "macro.fx.set_controls exact_parameters needs the managed OpenReaper atomic route.",
    });
  }
  const directRefs = normalizeNamedRefs(request.refs);
  const selected = await resolveFxTarget({
    refs: directRefs,
    selector: normalized.selector ?? request.input?.selector,
    plugin: null,
    request,
    executeAtomic,
    projectIndexRuntime,
    catalog,
    now,
    stages,
    state,
  });
  if (!selected.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: "blocked",
      code: selected.blockers[0]?.code ?? "STOCK_PLUGIN_TARGET_BLOCKED",
      message: selected.blockers[0]?.message ?? "The FX target could not be resolved for exact_parameters.",
      blockers: selected.blockers,
    });
  }

  try {
    const inventory = await hydrateCompleteFxParameterInventory({
      executeAtomic: async (childRequest) => {
        const execution = await runAtomic({
          executeAtomic,
          request,
          state,
          child: {
            id: childRequest.id,
            input: childRequest.input,
            refs: childRequest.refs,
            budget: childRequest.budget,
          },
          idempotencyKey: childRequest.idempotency_key,
        });
        collectExecution(state, execution);
        return execution;
      },
      request,
      fxRef: selected.fxRef,
      listTemplateId: LIST_FX_PARAMETERS_ID,
      budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
    });
    if (!inventory.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: inventory.code,
        message: inventory.message,
        data: {
          mode: "exact_parameters",
          fx_ref: selected.fxRef,
          rows_collected: inventory.rows_collected ?? null,
        },
      });
    }
    const resolved = resolveExactParameterTargets(normalized.changes, inventory.parameters);
    if (!resolved.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "blocked",
        code: resolved.code,
        message: resolved.message,
        data: {
          mode: "exact_parameters",
          fx_ref: selected.fxRef,
          suggestions: resolved.suggestions ?? resolved.matches ?? [],
          parameter_count: inventory.parameter_count,
        },
      });
    }

    const preparedChanges = [];
    for (const change of resolved.resolved) {
      const probeExecution = await runAtomic({
        executeAtomic,
        request,
        state,
        child: {
          id: READ_FX_PARAMETER_ID,
          input: {
            param_index: change.param_index,
            ...(change.param_ident ? { param_ident: change.param_ident } : {}),
            probe_normalized_value: change.normalized_value,
          },
          refs: { fx_ref: selected.fxRef },
          budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
        },
      });
      collectExecution(state, probeExecution);
      const probe = executionReadback(probeExecution);
      const probeIndexMatches = probe?.param_index === change.param_index;
      const probeIdentMatches = !change.param_ident || probe?.param_ident === change.param_ident;
      const probeNormalized = Number(probe?.normalized_value);
      const probeFormatted = probe?.formatted_value;
      if (!probeIndexMatches
          || !probeIdentMatches
          || !Number.isFinite(probeNormalized)
          || Math.abs(probeNormalized - change.normalized_value) > 0.000001
          || typeof probeFormatted !== "string"
          || probeFormatted.length === 0) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state,
          status: "blocked",
          code: "FX_EXACT_PARAMETERS_PREFLIGHT_INVALID",
          message: `Native preflight for exact parameter ${change.param_index} did not return matching identity and formatted target truth.`,
          data: {
            mode: "exact_parameters",
            fx_ref: selected.fxRef,
            change_id: change.id,
            param_index: change.param_index,
          },
        });
      }
      if (typeof change.requested_formatted_value === "string"
          && change.requested_formatted_value !== probeFormatted) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state,
          status: "blocked",
          code: "FX_EXACT_PARAMETERS_FORMATTED_TARGET_MISMATCH",
          message: `changes[${change.id}] requested_formatted_value does not match REAPER native formatting for the requested normalized value.`,
          data: {
            mode: "exact_parameters",
            fx_ref: selected.fxRef,
            change_id: change.id,
            param_index: change.param_index,
            requested_formatted_value: change.requested_formatted_value,
            native_formatted_value: probeFormatted,
          },
        });
      }
      preparedChanges.push({
        ...change,
        native_target_formatted_value: probeFormatted,
        step_sizes_available: probe?.step_sizes_available ?? false,
        step_size: probe?.step_size ?? null,
        is_toggle: probe?.is_toggle ?? null,
        is_discrete: probe?.is_discrete ?? null,
      });
    }
    pushStage(
      stages,
      "stock-plugin-live-resolve",
      "live_ref_resolve",
      "completed",
      `Hydrated all ${inventory.parameter_count} FX parameters across ${inventory.pages} page(s) and preflighted ${preparedChanges.length} native target value(s).`,
      state.evidenceRefs,
    );

    if (normalized.dry_run) {
      pushStage(stages, "stock-plugin-execute", "runtime_execute", "skipped", "exact_parameters dry_run skipped mutation.");
      pushStage(stages, "stock-plugin-verify", "verify", "skipped", "exact_parameters dry_run skipped readback.");
      pushStage(stages, "stock-plugin-index-update", "index_update", "skipped", "No FX index change during dry_run.");
      pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected exact parameter targets without mutation.");
      return successEnvelope({
        entry, request, startedAt, now, stages, state,
        status: "dry_run_completed",
        summary: `Validated ${preparedChanges.length} exact FX parameter target(s) without mutation.`,
        data: createAlpha34CExactParametersPublicResult({
          fxRef: selected.fxRef,
          inventory,
          changes: preparedChanges,
        }),
      });
    }

    let failedAt = null;
    let rowFailure = null;
    for (let index = 0; index < preparedChanges.length; index += 1) {
      const change = preparedChanges[index];
      if (failedAt !== null) {
        state.changes.push({
          id: change.id,
          template_id: SET_FX_PARAMETER_ID,
          param_index: change.param_index,
          normalized_value: change.normalized_value,
          status: "not_run",
          mutation: { status: "not_run" },
          live_readback: { status: "not_run" },
          index_maintenance: { status: "not_run" },
        });
        continue;
      }
      const writeChild = {
        id: SET_FX_PARAMETER_ID,
        input: {
          param_index: change.param_index,
          normalized_value: change.normalized_value,
          ...(change.param_ident ? { param_ident: change.param_ident } : {}),
        },
        refs: { fx_ref: selected.fxRef },
        budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
      };
      let writeExecution;
      try {
        writeExecution = await runAtomic({
          executeAtomic,
          request,
          state,
          child: writeChild,
          idempotencyKey: childIdempotencyKey(request.idempotency_key, index),
        });
        collectExecution(state, writeExecution);
      } catch (error) {
        failedAt = index;
        rowFailure = error;
        state.changes.push({
          id: change.id,
          template_id: SET_FX_PARAMETER_ID,
          param_index: change.param_index,
          normalized_value: change.normalized_value,
          status: "failed",
          mutation: {
            status: "unknown",
            dispatch_status: "attempted",
            error_code: error.code ?? "MACRO_ATOMIC_STAGE_FAILED",
            reason: "The managed write returned failure after dispatch; REAPER may have mutated before verification failed.",
          },
          live_readback: { status: "not_run" },
          index_maintenance: { status: "not_run" },
        });
        continue;
      }
      const writeReadback = executionReadback(writeExecution);
      const changeRow = {
        id: change.id,
        template_id: SET_FX_PARAMETER_ID,
        param_index: change.param_index,
        param_ident: change.param_ident ?? null,
        name: change.name ?? null,
        normalized_value: change.normalized_value,
        status: "mutation_completed",
        mutation: {
          status: "completed",
          dispatch_status: "completed",
          native_verification_mode: writeReadback?.verification_mode ?? null,
          native_target_formatted_value: change.native_target_formatted_value,
        },
        live_readback: { status: "pending" },
        index_maintenance: { status: "pending" },
      };
      state.changes.push(changeRow);

      const readChild = {
        id: READ_FX_PARAMETER_ID,
        input: {
          param_index: change.param_index,
          ...(change.param_ident ? { param_ident: change.param_ident } : {}),
        },
        refs: { fx_ref: selected.fxRef },
        budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_READBACK_BUDGET,
      };
      let readExecution;
      try {
        readExecution = await runAtomic({ executeAtomic, request, state, child: readChild });
        collectExecution(state, readExecution);
      } catch (error) {
        failedAt = index;
        rowFailure = error;
        changeRow.status = "failed";
        changeRow.live_readback = {
          status: "failed",
          source: "live_parameter_readback",
          error_code: error.code ?? "MACRO_ATOMIC_STAGE_FAILED",
        };
        continue;
      }
      const observed = executionReadback(readExecution);
      const actual = Number(observed?.normalized_value);
      const expected = change.normalized_value;
      const nativeTolerance = Number(writeReadback?.tolerance);
      const tolerance = Number.isFinite(nativeTolerance) && nativeTolerance >= 0 ? nativeTolerance : 0.001;
      const identityOk = observed?.param_index === change.param_index
        && (!change.param_ident || observed?.param_ident === change.param_ident)
        && writeReadback?.param_index === change.param_index
        && (!change.param_ident || writeReadback?.param_ident === change.param_ident)
        && writeReadback?.updated === true;
      const discrete = observed?.is_discrete === true
        || change.is_discrete === true
        || writeReadback?.is_discrete === true
        || writeReadback?.verification_mode === "native_discrete_format";
      const formattedOk = discrete
        && change.native_target_formatted_value === (observed?.formatted_value ?? null);
      const continuousOk = Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= tolerance;
      const valueOk = discrete ? formattedOk : continuousOk;
      if (!identityOk || !valueOk) {
        failedAt = index;
        rowFailure = coded(
          "FX_EXACT_PARAMETERS_READBACK_MISMATCH",
          `Live readback for exact parameter ${change.param_index} did not match native identity/value truth.`,
        );
        changeRow.status = "failed";
        changeRow.live_readback = {
          status: "failed",
          source: "live_parameter_readback",
          requested_normalized_value: expected,
          observed_normalized_value: Number.isFinite(actual) ? actual : null,
          native_target_formatted_value: change.native_target_formatted_value,
          observed_formatted_value: observed?.formatted_value ?? null,
          identity_matched: identityOk,
          tolerance,
        };
        continue;
      }
      changeRow.status = "applied";
      changeRow.live_readback = {
        status: "passed",
        source: "live_parameter_readback",
        requested_normalized_value: expected,
        observed_normalized_value: actual,
        native_target_formatted_value: change.native_target_formatted_value,
        observed_formatted_value: observed?.formatted_value ?? null,
        verification: formattedOk ? "native_formatted" : "normalized_tolerance",
        tolerance,
      };
    }

    if (failedAt !== null) {
      for (let index = failedAt + 1; index < preparedChanges.length; index += 1) {
        if (state.changes[index]) continue;
        const change = preparedChanges[index];
        state.changes.push({
          id: change.id,
          template_id: SET_FX_PARAMETER_ID,
          param_index: change.param_index,
          normalized_value: change.normalized_value,
          status: "not_run",
          mutation: { status: "not_run" },
          live_readback: { status: "not_run" },
          index_maintenance: { status: "not_run" },
        });
      }
    }

    const possiblyMutated = state.changes.some((change) => ["completed", "unknown"].includes(change.mutation?.status));
    pushStage(
      stages,
      "stock-plugin-execute",
      "runtime_execute",
      failedAt === null ? "completed" : "failed",
      failedAt === null ? "exact_parameters mutation phase completed." : "exact_parameters stopped on the first row mutation/readback failure.",
      state.evidenceRefs,
    );
    pushStage(
      stages,
      "stock-plugin-verify",
      "verify",
      failedAt === null ? "completed" : "failed",
      failedAt === null ? "Every exact parameter row passed independent live readback." : "At least one exact parameter row lacked matching live readback truth.",
      state.evidenceRefs,
    );
    let invalidation = null;
    if (possiblyMutated) {
      invalidation = invalidateKnownScopes(projectIndexRuntime, ["fx"], now);
      state.indexUpdate = invalidation;
      applyIndexMaintenanceToChanges(
        state.changes.filter((change) => ["completed", "unknown"].includes(change.mutation?.status)),
        invalidation?.ok === false ? "failed" : (invalidation ? "completed" : "skipped"),
        invalidation,
      );
      if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
      pushStage(
        stages,
        "stock-plugin-index-update",
        "index_update",
        invalidation?.ok === false ? "failed" : (invalidation ? "completed" : "skipped"),
        invalidation ? "Invalidated FX Project Index scope once after mutation phase." : "No configured Project Index runtime required invalidation.",
      );
    } else {
      pushStage(stages, "stock-plugin-index-update", "index_update", "skipped", "No mutation completed; FX index unchanged.");
    }

    const readbackRows = state.changes
      .filter((change) => change.live_readback?.status === "passed")
      .map((change) => ({
        id: change.id,
        param_index: change.param_index,
        requested_normalized_value: change.normalized_value,
        observed_normalized_value: change.live_readback.observed_normalized_value,
        observed_formatted_value: change.live_readback.observed_formatted_value ?? null,
      }));
    pushStage(stages, "stock-plugin-result", "result_project", "completed", "Projected exact parameter highway result.");

    if (failedAt !== null || invalidation?.ok === false) {
      const indexFailed = invalidation?.ok === false;
      return failureEnvelope({
        entry, request, startedAt, now, stages, state,
        status: possiblyMutated ? "partial_failure" : "failed",
        code: indexFailed
          ? (invalidation.blockers?.[0]?.code ?? "FX_EXACT_PARAMETERS_INDEX_INVALIDATION_FAILED")
          : (rowFailure?.code ?? "FX_EXACT_PARAMETERS_PARTIAL_FAILURE"),
        message: indexFailed
          ? (invalidation.blockers?.[0]?.message ?? "FX writes completed but the Project Index FX scope could not be invalidated.")
          : "exact_parameters stopped after a row-level mutation or live-readback failure; earlier verified truth is preserved.",
        data: {
          ...createAlpha34CExactParametersPublicResult({
            fxRef: selected.fxRef,
            inventory,
            changes: preparedChanges,
            readbackRows,
          }),
          index_update: compactObject(invalidation),
          outcome: outcomeEvidence(state),
        },
      });
    }

    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      summary: `Applied and verified ${readbackRows.length} exact FX parameter change(s).`,
      data: {
        ...createAlpha34CExactParametersPublicResult({
          fxRef: selected.fxRef,
          inventory,
          changes: preparedChanges,
          readbackRows,
        }),
        index_update: compactObject(invalidation),
        outcome: outcomeEvidence(state),
      },
    });
  } catch (error) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: state.changes.length > 0 ? "partial_failure" : "failed",
      code: error.code ?? "FX_EXACT_PARAMETERS_FAILED",
      message: error.message ?? "exact_parameters execution failed.",
      blockers: error.blockers,
      data: {
        mode: "exact_parameters",
        outcome: outcomeEvidence(state),
      },
    });
  }
}

async function resolveControlTarget(options) {
  const targetKind = options.targetKind;
  if (!CONTROL_TARGET_KINDS.includes(targetKind)) {
    return blocked("CONTROL_TARGET_KIND_UNSUPPORTED", "target_kind must be project, track, item, take, transport, or send.");
  }
  if (targetKind === "project") {
    const execution = await runAtomic({
      executeAtomic: options.executeAtomic,
      request: options.request,
      state: options.state,
      child: { id: READ_PROJECT_TEMPO_ID, input: { limit: 1, effective_at_seconds: [0] }, refs: {} },
    });
    collectExecution(options.state, execution);
    const readback = executionReadback(execution);
    if (!projectTempoReadback(readback)) {
      return blocked("CONTROL_PROJECT_TEMPO_UNAVAILABLE", "The active project BPM could not be read before mutation.");
    }
    pushStage(options.stages, "controls-select-target", "selector_resolve", "completed", "Read the active project tempo target.", executionEvidenceRefs(execution));
    pushStage(options.stages, "controls-live-resolve", "live_ref_resolve", "completed", "Project controls target the active project without an object ref.", executionEvidenceRefs(execution));
    return { ok: true, refs: {}, sqliteUsed: false, projectTempo: projectTempoReadback(readback) };
  }
  if (targetKind === "transport") {
    const execution = await runAtomic({
      executeAtomic: options.executeAtomic,
      request: options.request,
      state: options.state,
      child: { id: READ_TRANSPORT_ID, input: {}, refs: {} },
    });
    collectExecution(options.state, execution);
    pushStage(options.stages, "controls-select-target", "selector_resolve", "completed", "Read the live transport target state.", executionEvidenceRefs(execution));
    pushStage(options.stages, "controls-live-resolve", "live_ref_resolve", "completed", "Transport controls target the active project transport.", executionEvidenceRefs(execution));
    return { ok: true, refs: {}, sqliteUsed: false };
  }

  let refs = normalizeNamedRefs(options.refs);
  let sqliteUsed = false;
  if (!hasRequiredControlRefs(targetKind, refs) && object(options.selector)) {
    const query = await querySelector({
      entity: entityForTargetKind(targetKind),
      selector: options.selector,
      request: options.request,
      executeAtomic: options.executeAtomic,
      projectIndexRuntime: options.projectIndexRuntime,
      catalog: options.catalog,
      now: options.now,
    });
    if (!query.ok) return query;
    refs = refsFromQueryRow(targetKind, query.row);
    sqliteUsed = true;
    options.state.sqlite = query.sqlite;
    pushStage(options.stages, "controls-select-target", "sqlite_query", "completed", "Selected one fresh Project Index candidate.", query.evidenceRefs);
  } else {
    pushStage(options.stages, "controls-select-target", "selector_resolve", "completed", "Used the supplied bounded target refs.");
  }
  if (!hasRequiredControlRefs(targetKind, refs)) {
    return blocked("CONTROL_TARGET_REF_REQUIRED", `macro.controls.set target_kind=${targetKind} needs one exact ref or one unambiguous selector.`);
  }

  try {
    const resolved = await liveResolveControlRefs({
      targetKind,
      refs,
      request: options.request,
      executeAtomic: options.executeAtomic,
      state: options.state,
    });
    pushStage(options.stages, "controls-live-resolve", "live_ref_resolve", "completed", "Live-resolved the selected target immediately before mutation.", resolved.evidenceRefs);
    options.state.canonicalRefs.push(...Object.values(resolved.refs).filter((value) => typeof value === "string"));
    return { ok: true, refs: resolved.refs, sqliteUsed };
  } catch (error) {
    return blocked(error.code ?? "CONTROL_LIVE_REF_FAILED", error.message ?? "The selected control target could not be live-resolved.", error.blockers);
  }
}

async function resolveFxTarget(options) {
  let fxRef = options.refs.fx_ref;
  let sqliteUsed = false;
  if (!fxRef && object(options.selector)) {
    const selector = {
      ...options.selector,
      ...(options.plugin?.id && options.selector.plugin_id === undefined
        ? { plugin_id: options.plugin.id }
        : {}),
      ...(options.plugin?.id ? { stock_plugin: true } : {}),
    };
    const query = await querySelector({
      entity: "fx",
      selector,
      request: options.request,
      executeAtomic: options.executeAtomic,
      projectIndexRuntime: options.projectIndexRuntime,
      catalog: options.catalog,
      now: options.now,
    });
    if (!query.ok) return query;
    fxRef = query.row.ref ?? query.row.fx_ref;
    sqliteUsed = true;
    options.state.sqlite = query.sqlite;
    pushStage(options.stages, "stock-plugin-select-target", "sqlite_query", "completed", "Selected one fresh stock-plugin candidate from the Project Index.", query.evidenceRefs);
  } else {
    pushStage(options.stages, "stock-plugin-select-target", "selector_resolve", "completed", "Used the supplied FX ref.");
  }
  if (typeof fxRef !== "string" || !fxRef.startsWith("fx:")) {
    return blocked("STOCK_PLUGIN_FX_REF_REQUIRED", "Supply one fx_ref or one unambiguous bounded FX selector.");
  }
  if (!options.state.objectRefs.has(fxRef)) {
    try {
      fxRef = await liveResolveFxCandidate({
        fxRef,
        request: options.request,
        executeAtomic: options.executeAtomic,
        state: options.state,
      });
    } catch (error) {
      return blocked(error.code ?? "STOCK_PLUGIN_FX_REF_RESOLUTION_FAILED", error.message ?? "The selected FX ref could not be live-resolved.", error.blockers);
    }
  }
  options.state.canonicalRefs.push(fxRef);
  return { ok: true, fxRef, sqliteUsed };
}

async function liveResolveFxCandidate({ fxRef, request, executeAtomic, state }) {
  const parsed = parseFxRef(fxRef);
  if (!parsed) throw coded("STOCK_PLUGIN_FX_REF_UNSUPPORTED", "The FX ref must be an owner-scoped track/take slot ref.");
  const ownerExecution = await runAtomic({
    executeAtomic,
    request,
    state,
    child: parsed.ownerKind === "track"
      ? { id: RESOLVE_TRACK_ID, input: { track_ref: parsed.ownerRef }, refs: {} }
      : { id: RESOLVE_MIDI_TAKE_ID, input: { take_ref: parsed.ownerRef }, refs: {} },
  });
  collectExecution(state, ownerExecution);
  const ownerObject = state.objectRefs.get(parsed.ownerRef)
    ?? executionObjectRefs(ownerExecution).find((entry) => entry.kind === parsed.ownerKind);
  if (!ownerObject) throw coded("STOCK_PLUGIN_FX_OWNER_RESOLUTION_FAILED", "The live owner resolver returned no canonical object ref.");
  requireStableRefMatch(parsed.ownerRef, ownerObject.ref, "STOCK_PLUGIN_FX_OWNER_IDENTITY_MISMATCH");
  const fxExecution = await runAtomic({
    executeAtomic,
    request,
    state,
    child: {
      id: RESOLVE_FX_ID,
      input: { owner_kind: parsed.ownerKind, slot_index: parsed.slotIndex },
      refs: parsed.ownerKind === "track"
        ? { track_ref: ownerObject }
        : { take_ref: ownerObject },
    },
  });
  collectExecution(state, fxExecution);
  const objectRef = executionObjectRefs(fxExecution).find((entry) => entry.kind === "fx");
  if (!objectRef) throw coded("STOCK_PLUGIN_FX_REF_RESOLUTION_FAILED", "The live FX resolver returned no canonical FX object ref.");
  requireStableRefMatch(fxRef, objectRef.ref, "STOCK_PLUGIN_FX_IDENTITY_MISMATCH", { alwaysExact: true });
  return objectRef.ref;
}

function parseFxRef(ref) {
  if (typeof ref !== "string" || !ref.startsWith("fx:")) return null;
  const lastColon = ref.lastIndexOf(":");
  if (lastColon <= 3) return null;
  const slotIndex = Number(ref.slice(lastColon + 1));
  const ownerRef = ref.slice(3, lastColon);
  const ownerKind = ownerRef.startsWith("track:") ? "track" : ownerRef.startsWith("take:") ? "take" : null;
  if (!ownerKind || !Number.isInteger(slotIndex) || slotIndex < 0) return null;
  return { ownerKind, ownerRef, slotIndex };
}

async function querySelector({
  entity,
  selector,
  request,
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now,
}) {
  if (!projectIndexRuntime) {
    return blocked("PROJECT_INDEX_REQUIRED_FOR_SELECTOR", "This selector needs the managed Project Index; supply an exact canonical ref or restore project-query readiness.");
  }
  const { selectors, filters } = queryParts(selector);
  const response = await executeAlpha3_2_5BProjectUnderstandingMacro({
    request: {
      id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
      input: {
        entity,
        selectors,
        filters,
        refresh_policy: "if_stale",
        hydrate_refs: false,
        limit: 3,
      },
      refs: [],
      context: request.context,
      budget: request.budget,
    },
    projectIndexRuntime,
    catalog,
    executeAtomic,
    now,
  });
  if (response.ok !== true) {
    return {
      ok: false,
      blockers: response.blockers?.length > 0
        ? response.blockers
        : [{ code: response.error?.code ?? "PROJECT_INDEX_SELECTOR_FAILED", message: response.error?.message ?? "Project Index selector failed.", recoverable: true }],
    };
  }
  const rows = response.result?.data?.rows ?? [];
  if (rows.length === 0) return blocked("SELECTOR_TARGET_NOT_FOUND", `No ${entity} candidate matched the bounded selector.`);
  if (rows.length > 1) return blocked("SELECTOR_TARGET_AMBIGUOUS", `The bounded selector matched ${rows.length} ${entity} candidates; refine it or pass an exact ref.`);
  return {
    ok: true,
    row: rows[0],
    sqlite: response.sqlite,
    evidenceRefs: response.result?.verification?.evidence_refs ?? [],
  };
}

function queryParts(selector) {
  const selectorKeys = new Set([
    "refs", "ref", "selected", "name", "track_ref", "track_refs", "item_ref", "item_refs",
    "owner_ref", "owner_refs", "source_ref", "source_path", "path_fingerprint", "time_range", "since",
  ]);
  const selectors = {};
  const filters = {};
  for (const [key, value] of Object.entries(selector ?? {})) {
    if (selectorKeys.has(key)) selectors[key] = clone(value);
    else filters[key] = clone(value);
  }
  return { selectors, filters };
}

function refsFromQueryRow(targetKind, row = {}) {
  if (targetKind === "track") return { track_ref: row.ref ?? row.track_ref };
  if (targetKind === "item") return { item_ref: row.ref ?? row.item_ref };
  if (targetKind === "take") return { item_ref: row.item_ref };
  if (targetKind === "send") {
    return {
      send_ref: row.ref ?? row.send_ref,
      track_ref: row.source_track_ref ?? row.track_ref ?? row.owner_ref,
    };
  }
  return {};
}

async function liveResolveControlRefs({ targetKind, refs, request, executeAtomic, state }) {
  const evidenceRefs = [];
  if (targetKind === "track") {
    const execution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: { id: RESOLVE_TRACK_ID, input: { track_ref: refs.track_ref }, refs: {} },
    });
    collectExecution(state, execution);
    evidenceRefs.push(...executionEvidenceRefs(execution));
    const readback = executionReadback(execution);
    const trackRef = readback.track_ref ?? firstRef(execution, "track:");
    requireStableRefMatch(refs.track_ref, trackRef, "CONTROL_TRACK_IDENTITY_MISMATCH");
    return { refs: { track_ref: trackRef }, evidenceRefs };
  }
  if (targetKind === "item" || targetKind === "take") {
    const execution = await runAtomic({
      executeAtomic,
      request,
      state,
      child: { id: RESOLVE_ITEM_ID, input: { ref: refs.item_ref }, refs: {} },
    });
    collectExecution(state, execution);
    evidenceRefs.push(...executionEvidenceRefs(execution));
    const readback = executionReadback(execution);
    const itemRef = readback.item_ref ?? firstRef(execution, "item:");
    requireStableRefMatch(refs.item_ref, itemRef, "CONTROL_ITEM_IDENTITY_MISMATCH");
    return { refs: { item_ref: itemRef }, evidenceRefs };
  }
  const sendExecution = await runAtomic({
    executeAtomic,
    request,
    state,
    child: { id: RESOLVE_SEND_ID, input: { send_ref: refs.send_ref }, refs: {} },
  });
  collectExecution(state, sendExecution);
  evidenceRefs.push(...executionEvidenceRefs(sendExecution));
  const sendReadback = executionReadback(sendExecution);
  const trackCandidate = refs.track_ref ?? sendReadback.source_track_ref;
  if (typeof trackCandidate !== "string") throw coded("SEND_OWNER_TRACK_REQUIRED", "The live send resolver returned no source owner track ref.");
  const trackExecution = await runAtomic({
    executeAtomic,
    request,
    state,
    child: { id: RESOLVE_TRACK_ID, input: { track_ref: trackCandidate }, refs: {} },
  });
  collectExecution(state, trackExecution);
  evidenceRefs.push(...executionEvidenceRefs(trackExecution));
  const trackReadback = executionReadback(trackExecution);
  const sendRef = sendReadback.send_ref ?? firstRef(sendExecution, "send:");
  const trackRef = trackReadback.track_ref ?? firstRef(trackExecution, "track:");
  requireStableRefMatch(refs.send_ref, sendRef, "CONTROL_SEND_IDENTITY_MISMATCH", { alwaysExact: true });
  requireStableRefMatch(trackCandidate, trackRef, "CONTROL_SEND_OWNER_IDENTITY_MISMATCH");
  return {
    refs: {
      send_ref: sendRef,
      track_ref: trackRef,
    },
    evidenceRefs,
  };
}

function resolveFreshParameterMetadata({ pluginMap, wantedControls, rows, observedAt }) {
  if (!Array.isArray(rows)) return blocked("STOCK_PARAMETER_ROWS_MISSING", "template.fx.list_fx_parameters returned no bounded parameter rows.");
  const metadata = {};
  const compact = [];
  const usedIndexes = new Set();
  const blockers = [];
  const hostWrapperIndexes = reaperHostWrapperParameterIndexes(rows);
  for (const control of wantedControls) {
    const parameter = pluginMap.parameters.find((entry) => entry.id === control);
    if (!parameter) {
      blockers.push({ code: "STOCK_PARAMETER_DEFINITION_MISSING", message: `No registered semantic parameter definition exists for ${control}.`, recoverable: false });
      continue;
    }
    const ranked = rows
      .filter((row) => Number.isInteger(row?.param_index) && row.param_index >= 0 && typeof row.name === "string")
      .map((row) => ({
        row,
        score: parameterMatchScore(parameter, row.name),
        hostWrapper: hostWrapperIndexes.has(row.param_index),
      }))
      .filter((candidate) => candidate.score > 0 && !usedIndexes.has(candidate.row.param_index))
      .sort((left, right) => right.score - left.score || Number(left.hostWrapper) - Number(right.hostWrapper) || left.row.param_index - right.row.param_index);
    if (ranked.length === 0 || ranked[0].score < 50) {
      blockers.push({ code: "STOCK_PARAMETER_MATCH_NOT_FOUND", message: `${pluginMap.display_name} parameter metadata did not contain one deterministic match for ${parameter.label}.`, recoverable: true });
      continue;
    }
    if (ranked[1] && ranked[1].score === ranked[0].score && ranked[1].hostWrapper === ranked[0].hostWrapper) {
      blockers.push({ code: "STOCK_PARAMETER_MATCH_AMBIGUOUS", message: `${pluginMap.display_name} parameter metadata produced an ambiguous match for ${parameter.label}.`, recoverable: true });
      continue;
    }
    const row = ranked[0].row;
    const hostWrapperDisambiguated = ranked.some((candidate, index) =>
      index > 0 && candidate.score === ranked[0].score && candidate.hostWrapper !== ranked[0].hostWrapper);
    usedIndexes.add(row.param_index);
    metadata[parameter.id] = {
      param_index: row.param_index,
      ...(typeof row.param_ident === "string" ? { param_ident: row.param_ident } : {}),
      label: row.name,
      freshness_status: "fresh",
      observed_at: observedAt,
    };
    compact.push({
      control: parameter.id,
      param_index: row.param_index,
      parameter_name: row.name,
      ...(hostWrapperDisambiguated ? { disambiguation: "preferred_plugin_parameter_over_trailing_reaper_host_wrapper" } : {}),
    });
  }
  return blockers.length > 0 ? { ok: false, blockers } : { ok: true, metadata, compact };
}

function reaperHostWrapperParameterIndexes(rows) {
  const ordered = rows
    .filter((row) => Number.isInteger(row?.param_index) && row.param_index >= 0 && typeof row.name === "string")
    .sort((left, right) => left.param_index - right.param_index);
  const tail = ordered.slice(-3);
  if (
    tail.length !== 3 ||
    tail[1].param_index !== tail[0].param_index + 1 ||
    tail[2].param_index !== tail[1].param_index + 1 ||
    tail.map((row) => normalizeToken(row.name)).join("|") !== "bypass|wet|delta"
  ) return new Set();
  return new Set(tail.map((row) => row.param_index));
}

function parameterMatchScore(parameter, liveName) {
  const live = normalizeToken(liveName);
  if (!live) return 0;
  const hints = [parameter.id, parameter.label, ...(parameter.aliases ?? [])]
    .map(normalizeToken)
    .filter(Boolean);
  let best = 0;
  for (const hint of hints) {
    if (live === hint) best = Math.max(best, 100);
    else if (live.length >= 3 && hint.length >= 3 && (live.includes(hint) || hint.includes(live))) best = Math.max(best, 80);
    const liveTokens = new Set(live.split(" "));
    const hintTokens = new Set(hint.split(" "));
    const overlap = [...liveTokens].filter((token) => token.length >= 3 && hintTokens.has(token)).length;
    if (overlap > 0) best = Math.max(best, 50 + overlap * 5);
  }
  return best;
}

function pluginIdentityMatches(pluginMap, liveName) {
  const live = normalizeToken(liveName);
  if (!live) return false;
  return [pluginMap.id, pluginMap.display_name, ...(pluginMap.aliases ?? [])]
    .map(normalizeToken)
    .some((candidate) => live === candidate || live.includes(candidate) || candidate.includes(live));
}

const CONTROL_BATCH_READBACK_PATHS = Object.freeze({
  project: Object.freeze({
    bpm: ["bpm"],
    time_signature_numerator: ["time_sig_num"],
    time_signature_denominator: ["time_sig_denom"],
  }),
  track: Object.freeze({
    volume: ["volume"],
    pan: ["pan"],
    record_arm: ["record_armed"],
    mute: ["muted"],
    solo_mode: ["solo_mode"],
    width: ["width"],
    name: ["name"],
  }),
  item: Object.freeze({
    position_seconds: ["position_seconds"],
    length_seconds: ["length_seconds"],
    fade_in_seconds: ["fade_in_seconds"],
    fade_out_seconds: ["fade_out_seconds"],
    snap_offset_seconds: ["snap_offset_seconds"],
  }),
  take: Object.freeze({
    name: ["active_take_name"],
  }),
  transport: Object.freeze({
    edit_cursor_seconds: ["edit_cursor_seconds"],
    repeat: ["repeat_enabled"],
    loop_start_seconds: ["loop_points", "start_seconds"],
    loop_end_seconds: ["loop_points", "end_seconds"],
    time_selection_start_seconds: ["time_selection", "start_seconds"],
    time_selection_end_seconds: ["time_selection", "end_seconds"],
  }),
  send: Object.freeze({
    volume: ["volume"],
    pan: ["pan"],
    mute: ["muted"],
    mode: ["mode"],
  }),
});

const CONTROL_REQUIRED_ATOMIC_READBACK_PATHS = Object.freeze({
  project: Object.freeze({
    grid_division: ["division"],
    grid_swing: ["swing"],
    snap_enabled: ["enabled"],
  }),
  take: Object.freeze({
    pan: ["pan"],
  }),
});

function applyControlReadbackToChanges(changes, rows) {
  const byField = new Map((rows ?? []).map((row) => [row.field, row]));
  for (const change of changes) {
    const fields = Array.isArray(change.fields) ? change.fields : [];
    const evidence = fields.map((field) => byField.get(field)).filter(Boolean);
    if (evidence.length !== fields.length || evidence.some((row) => !["passed", "verified_by_atomic_template"].includes(row.status))) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "live_control_readback" };
      continue;
    }
    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: evidence.every((row) => row.source === "accepted_template_live_readback")
        ? "accepted_template_live_readback"
        : evidence.some((row) => row.status === "passed")
          ? "live_control_readback"
          : "accepted_template_readback",
      fields: evidence.map((row) => compactObject({
        field: row.field,
        status: row.status,
        source: row.source,
        requested_value: row.requested,
        observed_value: row.observed,
      })),
    };
    delete change.atomic_readback;
  }
}

function applyIndexMaintenanceToChanges(changes, status, invalidation) {
  for (const change of changes) {
    change.index_maintenance = {
      status,
      scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
      blocker_code: invalidation?.blockers?.[0]?.code ?? null,
    };
  }
}

function outcomeEvidence(state) {
  const changes = Array.isArray(state.changes) ? state.changes : [];
  const readbackPassed = changes.filter((change) => change.live_readback?.status === "passed").length;
  const mutationCompleted = changes.filter((change) => change.mutation?.status === "completed").length;
  const mutationUnknown = changes.filter((change) => change.mutation?.status === "unknown").length;
  const indexStatuses = unique(changes.map((change) => change.index_maintenance?.status).filter(Boolean), 8);
  return {
    mutation: {
      status: mutationUnknown > 0 ? (mutationCompleted > 0 ? "partial_unknown" : "unknown") : changes.length > 0 ? "completed" : "not_run",
      completed_count: mutationCompleted,
      unknown_count: mutationUnknown,
    },
    live_readback: {
      status: changes.length > 0 && readbackPassed === changes.length ? "passed" : readbackPassed > 0 ? "partial" : "not_passed",
      passed_count: readbackPassed,
      total_count: changes.length,
    },
    index_maintenance: {
      status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run",
      scopes: Array.isArray(state.indexUpdate?.scopes) ? state.indexUpdate.scopes.slice(0, 16) : [],
      blocker_code: state.indexUpdate?.blockers?.[0]?.code ?? null,
    },
  };
}

function verifyControlReadback({ targetKind, requestedFields, targetRefs, readback, atomicChanges = [] }) {
  const target = controlReadbackTarget(targetKind, targetRefs, readback);
  if (!target.ok) return { ok: false, blockers: target.blockers, rows: [], compared_count: 0, atomic_only_count: 0 };
  const paths = CONTROL_BATCH_READBACK_PATHS[targetKind] ?? {};
  const rows = [];
  const blockers = [];
  let comparedCount = 0;
  let atomicOnlyCount = 0;
  for (const [field, requested] of Object.entries(requestedFields ?? {})) {
    const path = paths[field];
    if (!path) {
      atomicOnlyCount += 1;
      const atomic = requiredAtomicEvidenceForField(atomicChanges, field);
      rows.push(atomic ?? { field, status: "verified_by_atomic_template" });
      if (atomic && atomic.status !== "passed") {
        blockers.push({
          code: "CONTROL_READBACK_MISMATCH",
          message: `Accepted Template readback for ${targetKind}.${field} did not match the requested value.`,
          recoverable: true,
        });
      }
      continue;
    }
    const observed = valueAtPath(target.value, path);
    if (observed === undefined) {
      atomicOnlyCount += 1;
      const atomic = requiredAtomicEvidenceForField(atomicChanges, field);
      rows.push(atomic ?? { field, status: "verified_by_atomic_template" });
      if (atomic && atomic.status !== "passed") {
        blockers.push({
          code: "CONTROL_READBACK_MISMATCH",
          message: `Accepted Template readback for ${targetKind}.${field} did not match the requested value.`,
          recoverable: true,
        });
      }
      continue;
    }
    comparedCount += 1;
    const matched = controlValuesMatch(requested, observed);
    rows.push({ field, status: matched ? "passed" : "mismatch", requested, observed });
    if (!matched) {
      blockers.push({
        code: "CONTROL_READBACK_MISMATCH",
        message: `Readback for ${targetKind}.${field} did not match the requested value.`,
        recoverable: true,
      });
    }
  }
  return {
    ok: blockers.length === 0,
    blockers,
    rows,
    compared_count: comparedCount,
    atomic_only_count: atomicOnlyCount,
  };
}

function captureRequiredAtomicControlReadback({ targetKind, fields = [], requestedFields = {}, readback }) {
  const paths = CONTROL_REQUIRED_ATOMIC_READBACK_PATHS[targetKind] ?? {};
  return fields.flatMap((field) => {
    const path = paths[field];
    if (!path) return [];
    const requested = requestedFields[field];
    const observed = valueAtPath(readback, path);
    return [{
      field,
      status: readback?.readback_status === "passed" && observed !== undefined && controlValuesMatch(requested, observed) ? "passed" : "mismatch",
      source: "accepted_template_live_readback",
      requested,
      observed,
    }];
  });
}

function requiredAtomicEvidenceForField(changes, field) {
  for (const change of changes) {
    const row = change.atomic_readback?.find((entry) => entry.field === field);
    if (row) return row;
  }
  return null;
}

function controlReadbackTarget(targetKind, targetRefs, readback) {
  if (targetKind === "project") {
    const value = projectTempoReadback(readback);
    return value
      ? { ok: true, value }
      : blocked("CONTROL_READBACK_TARGET_MISSING", "Project control readback did not contain effective BPM at project time zero.");
  }
  if (targetKind === "track") {
    const rows = Array.isArray(readback?.tracks) ? readback.tracks : [];
    const value = rows.find((row) => row?.track_ref === targetRefs?.track_ref);
    return value
      ? { ok: true, value }
      : blocked("CONTROL_READBACK_TARGET_MISSING", "Track control readback did not contain the live-resolved target track.");
  }
  if (targetKind === "item" || targetKind === "take") {
    return readback?.item_ref === targetRefs?.item_ref
      ? { ok: true, value: readback }
      : blocked("CONTROL_READBACK_TARGET_MISSING", "Item/take control readback did not match the live-resolved target item.");
  }
  if (targetKind === "send") {
    const rows = Array.isArray(readback?.sends) ? readback.sends : [];
    const value = rows.find((row) => row?.send_ref === targetRefs?.send_ref);
    return value
      ? { ok: true, value }
      : blocked("CONTROL_READBACK_TARGET_MISSING", "Send control readback did not contain the live-resolved target send.");
  }
  return { ok: true, value: readback ?? {} };
}

function projectTempoReadback(readback) {
  const rows = Array.isArray(readback?.effective) ? readback.effective : [];
  const effective = rows.find((row) => row?.time_seconds === 0 && typeof row?.bpm === "number" && Number.isFinite(row.bpm));
  if (!effective) return null;
  const markers = Array.isArray(readback?.tempo_markers) ? readback.tempo_markers : [];
  const markerAtZero = markers.find((row) => row?.time_seconds === 0);
  return {
    ...effective,
    ...(markerAtZero ? { linear_tempo: markerAtZero.linear_tempo === true } : {}),
  };
}

function materializeProjectTimeSignatureChild(child, projectTempo) {
  if (child?.id !== "template.project.set_tempo_marker" || child?.input?.bpm !== undefined) return child;
  if (typeof projectTempo?.bpm !== "number" || !Number.isFinite(projectTempo.bpm)) {
    throw coded("CONTROL_PROJECT_TEMPO_UNAVAILABLE", "The current project BPM is required to change only the time signature.");
  }
  return {
    ...child,
    input: {
      ...child.input,
      bpm: projectTempo.bpm,
      ...(typeof projectTempo.linear_tempo === "boolean" ? { linear_tempo: projectTempo.linear_tempo } : {}),
    },
  };
}

function valueAtPath(value, path) {
  let current = value;
  for (const key of path) {
    if (!object(current) || !Object.hasOwn(current, key)) return undefined;
    current = current[key];
  }
  return current;
}

function controlValuesMatch(requested, observed) {
  if (typeof requested === "number" && typeof observed === "number") {
    return Number.isFinite(requested) && Number.isFinite(observed)
      && Math.abs(requested - observed) <= 0.0001;
  }
  return Object.is(requested, observed);
}

function requireStableRefMatch(requested, observed, code, { alwaysExact = false } = {}) {
  if (typeof observed !== "string") throw coded(code, `The live resolver returned no canonical ref for ${String(requested)}.`);
  if ((alwaysExact || requiresExactLiveIdentity(requested)) && observed !== requested) {
    throw coded(code, `The live resolver returned ${observed} instead of the exact stable ref ${requested}.`);
  }
}

function requiresExactLiveIdentity(ref) {
  return typeof ref === "string" && ref.includes(":guid:");
}

async function runAtomic({ executeAtomic, request, state, child, idempotencyKey }) {
  if (!child || typeof child.id !== "string") throw coded("MACRO_CHILD_INVALID", "The fixed program produced no valid atomic child request.");
  const execution = await executeAtomic({
    id: child.id,
    input: child.input ?? {},
    refs: materializeRefs(child.refs ?? {}, state),
    context: request.context,
    budget: child.budget ?? request.budget,
    ...(idempotencyKey ? { idempotency_key: idempotencyKey } : {}),
    observeProjectIndex: false,
  });
  if (execution?.ok !== true) {
    throw coded(
      execution?.error?.code ?? "MACRO_ATOMIC_STAGE_FAILED",
      execution?.error?.message ?? `${child.id} failed through the managed atomic route.`,
      execution?.error?.details?.blockers,
    );
  }
  return execution;
}

function registryEntry({ macroId, programId, templateIds, executorCapability, stagePrefix }) {
  return {
    contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
    macro_id: macroId,
    program_id: programId,
    program_version: "1.0.0",
    implementation_status: "executable",
    risk: "write",
    input_schema: { type: "object", additionalProperties: false },
    selector_policy: {
      task_shaped: true,
      canonical_refs_optional_at_public_boundary: true,
      live_reresolve_before_write: true,
    },
    sqlite_policy: {
      mode: "invalidate_after_write",
      write_authority: false,
      identity_fields: SQLITE_IDENTITY_FIELDS,
    },
    dependencies: {
      template_ids: templateIds,
      runtime_capabilities: [
        ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY,
        executorCapability,
      ],
    },
    stages: [
      { id: `${stagePrefix}-select-target`, kind: "runtime_execute", dependency_ref: ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY, risk: "read", stop_on_error: true },
      { id: `${stagePrefix}-live-resolve`, kind: "live_ref_resolve", risk: "read", stop_on_error: true },
      { id: `${stagePrefix}-execute`, kind: "runtime_execute", dependency_ref: executorCapability, risk: "write", stop_on_error: true },
      { id: `${stagePrefix}-verify`, kind: "verify", risk: "read", stop_on_error: true },
      { id: `${stagePrefix}-index-update`, kind: "index_update", risk: "read", stop_on_error: true },
      { id: `${stagePrefix}-result`, kind: "result_project", risk: "read", stop_on_error: true },
    ],
    undo_policy: "per_stage_undo",
    verification_policy: "required",
    dry_run_supported: true,
    result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
  };
}

function successEnvelope({
  entry,
  request,
  startedAt,
  now,
  stages,
  state,
  status = "completed",
  summary,
  data,
}) {
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: macroIdentity(entry),
    request: requestSummary(request, status === "dry_run_completed"),
    execution: {
      status,
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: stages.length,
      stages,
    },
    sqlite: state.sqlite,
    result: {
      summary,
      canonical_refs: unique(state.canonicalRefs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: "passed",
        evidence_refs: unique(state.evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      },
      artifact_refs: unique(state.artifactRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: compactData(data),
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

function failureEnvelope({
  entry,
  request,
  startedAt,
  now,
  stages,
  state,
  status = "blocked",
  code,
  message,
  blockers = [],
  data = {},
}) {
  const bounded = boundedBlockers(blockers.length > 0 ? blockers : [{ code, message, recoverable: true }]);
  const verifiedByLiveReadback = state.changes.length > 0
    && state.changes.every((change) => change.live_readback?.status === "passed");
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: requestSummary(request, false),
    execution: {
      status,
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: stages.length,
      stages,
    },
    sqlite: state.sqlite,
    result: {
      summary: message,
      canonical_refs: unique(state.canonicalRefs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: verifiedByLiveReadback ? "passed" : status === "partial_failure" ? "failed" : "not_required",
        evidence_refs: verifiedByLiveReadback || status === "partial_failure"
          ? unique(state.evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count)
          : [],
      },
      artifact_refs: unique(state.artifactRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: compactData(data),
    },
    blockers: bounded,
    error: {
      code: code ?? bounded[0]?.code ?? "MACRO_EXECUTION_FAILED",
      message,
      recoverable: bounded.every((item) => item.recoverable !== false),
    },
    recovery: {
      partial_changes_possible: status === "partial_failure",
      undo_policy: entry.undo_policy,
      sqlite_rows_authorize_writes: false,
      action: status === "partial_failure"
        ? "Inspect applied changes and stage evidence, use available per-stage undo, refresh stale Project Index scopes, then retry only the remaining task."
        : "Resolve the typed blocker, then retry the same registered Macro.",
    },
    budget: {
      max_bytes: entry.result_budget.max_bytes,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  });
}

function finalizeEnvelope(envelope) {
  const result = clone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) {
    throw new TypeError(`Invalid Alpha3.2.5-C control Macro envelope: ${validation.errors.join("; ")}`);
  }
  return deepFreeze(result);
}

function executionState() {
  return {
    objectRefs: new Map(),
    evidenceRefs: [],
    artifactRefs: [],
    canonicalRefs: [],
    changes: [],
    readback: null,
    indexUpdate: null,
    sqlite: {
      used: false,
      source: "not_used",
      freshness: "not_applicable",
      snapshot_ref: null,
      revision: null,
      refreshed: false,
    },
  };
}

function collectExecution(state, execution) {
  for (const objectRef of executionObjectRefs(execution)) {
    state.objectRefs.set(objectRef.ref, clone(objectRef));
  }
  state.evidenceRefs.push(...executionEvidenceRefs(execution));
  state.artifactRefs.push(...executionArtifactRefs(execution));
  state.canonicalRefs.push(...executionCanonicalRefs(execution));
}

function rememberInputObjectRefs(state, refs) {
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!object(value)) return;
    if (typeof value.kind === "string" && typeof value.ref === "string") {
      state.objectRefs.set(value.ref, clone(value));
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(refs);
}

function normalizeControlBatchInput(input, requestRefs) {
  const blockers = [];
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > CONTROL_BATCH_MAX_ROWS) {
    blockers.push(blockedRow("CONTROL_BATCH_SIZE_INVALID", `changes must contain 1-${CONTROL_BATCH_MAX_ROWS} rows.`));
    return { ok: false, blockers };
  }
  if (input.target_kind !== undefined || input.fields !== undefined || input.selector !== undefined) {
    blockers.push(blockedRow("CONTROL_BATCH_SHAPE_CONFLICT", "changes[] cannot be combined with top-level target_kind, fields, or selector."));
  }
  if (input.dry_run !== undefined && typeof input.dry_run !== "boolean") {
    blockers.push(blockedRow("CONTROL_BATCH_DRY_RUN_INVALID", "changes[] dry_run must be boolean when supplied."));
  }
  if (Array.isArray(requestRefs) ? requestRefs.length > 0 : object(requestRefs) && Object.keys(requestRefs).length > 0) {
    blockers.push(blockedRow("CONTROL_BATCH_REFS_CONFLICT", "changes[] keeps refs inside each row; top-level refs are not accepted."));
  }
  const ids = new Set();
  const rows = [];
  for (let index = 0; index < input.changes.length; index += 1) {
    const value = input.changes[index];
    if (!object(value)) {
      blockers.push(blockedRow("CONTROL_BATCH_ROW_INVALID", `changes[${index}] must be an object.`));
      continue;
    }
    const unknown = Object.keys(value).filter((field) => !CONTROL_BATCH_ROW_FIELDS.has(field));
    if (unknown.length > 0) blockers.push(blockedRow("CONTROL_BATCH_ROW_FIELD_UNSUPPORTED", `changes[${index}] contains unsupported field(s): ${unknown.join(", ")}.`));
    const id = typeof value.id === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/u.test(value.id)
      ? value.id
      : null;
    if (!id) blockers.push(blockedRow("CONTROL_BATCH_ROW_ID_INVALID", `changes[${index}].id must be a stable 1-64 character token.`));
    else if (ids.has(id)) blockers.push(blockedRow("CONTROL_BATCH_ROW_ID_DUPLICATE", `changes[] contains duplicate id=${id}.`));
    else ids.add(id);
    if (!CONTROL_TARGET_KINDS.includes(value.target_kind)) blockers.push(blockedRow("CONTROL_TARGET_KIND_UNSUPPORTED", `changes[${index}].target_kind must be project, track, item, take, transport, or send.`));
    if (!object(value.fields) || Object.keys(value.fields).length === 0) blockers.push(blockedRow("CONTROL_FIELDS_REQUIRED", `changes[${index}].fields must be a non-empty object.`));
    if (value.selector !== undefined && !object(value.selector)) blockers.push(blockedRow("CONTROL_BATCH_SELECTOR_INVALID", `changes[${index}].selector must be an object when supplied.`));
    if (value.refs !== undefined && !object(value.refs) && !Array.isArray(value.refs)) blockers.push(blockedRow("CONTROL_BATCH_ROW_REFS_INVALID", `changes[${index}].refs must be named refs or MCP object refs.`));
    rows.push({
      id: id ?? `row-${index + 1}`,
      target_kind: value.target_kind,
      fields: clone(value.fields),
      selector: clone(value.selector),
      refs: clone(value.refs ?? {}),
    });
  }
  return blockers.length > 0
    ? { ok: false, blockers }
    : { ok: true, rows, dryRun: input.dry_run !== false };
}

function controlBatchChildRequest(request, row, dryRun) {
  return {
    id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
    input: {
      target_kind: row.target_kind,
      fields: clone(row.fields),
      ...(row.selector === undefined ? {} : { selector: clone(row.selector) }),
      dry_run: dryRun,
    },
    refs: clone(row.refs),
    context: request.context,
    budget: request.budget,
    ...(!dryRun && typeof request.idempotency_key === "string" && request.idempotency_key.length > 0
      ? { idempotency_key: `${request.idempotency_key}:change:${row.id}` }
      : {}),
    request_id: `${request.request_id ?? requestSummary(request, dryRun).request_id}:change:${row.id}:${dryRun ? "preview" : "execute"}`,
  };
}

function collectMacroEnvelopeEvidence(state, envelope) {
  state.evidenceRefs.push(...(envelope?.result?.verification?.evidence_refs ?? []));
  state.artifactRefs.push(...(envelope?.result?.artifact_refs ?? []));
  state.canonicalRefs.push(...(envelope?.result?.canonical_refs ?? []));
}

function controlBatchChangeFromEnvelope({ row, envelope, status }) {
  const childRows = Array.isArray(envelope?.result?.changes) ? envelope.result.changes : [];
  const allApplied = childRows.length > 0 && childRows.every((entry) => entry.status === "applied" && entry.live_readback?.status === "passed");
  const dryRun = envelope?.execution?.status === "dry_run_completed";
  const targetRefs = object(envelope?.result?.data?.target_refs) ? envelope.result.data.target_refs : {};
  return {
    operation_id: row.id,
    target_kind: row.target_kind,
    target_refs: clone(targetRefs),
    fields: Object.keys(row.fields),
    status: status ?? (allApplied ? "applied" : envelope?.ok === true ? "readback_failed" : "failed"),
    mutation: {
      status: dryRun ? "not_run" : allApplied ? "completed" : childRows.some((entry) => entry.mutation?.status === "completed") ? "completed" : "not_run",
    },
    live_readback: {
      status: dryRun ? "not_run" : allApplied ? "passed" : childRows.some((entry) => entry.live_readback?.status === "failed") ? "failed" : "not_run",
      source: dryRun ? null : "row_specific_macro_live_readback",
    },
    index_maintenance: {
      status: dryRun ? "not_run" : childRows.length > 0 && childRows.every((entry) => ["completed", "skipped"].includes(entry.index_maintenance?.status)) ? "completed" : childRows.some((entry) => entry.index_maintenance?.status === "failed") ? "failed" : "not_run",
      scopes: Array.isArray(envelope?.result?.data?.index_update?.scopes)
        ? envelope.result.data.index_update.scopes
        : controlScopes(row.target_kind),
    },
    blocker_code: envelope?.error?.code ?? null,
  };
}

function blockedRow(code, message) {
  return { code, message, recoverable: true };
}

function executionObjectRefs(execution) {
  const result = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!object(value)) return;
    if (typeof value.kind === "string" && typeof value.ref === "string") {
      result.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  return result;
}

function materializeRefs(refs, state) {
  const materialize = (value) => {
    if (typeof value === "string") {
      const objectRef = state?.objectRefs?.get(value);
      if (!objectRef) throw coded("MACRO_OBJECT_REF_REQUIRED", `No live-resolved object ref is available for ${value}.`);
      return clone(objectRef);
    }
    if (Array.isArray(value)) return value.map(materialize);
    if (object(value) && typeof value.kind === "string" && typeof value.ref === "string") return clone(value);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]));
    return value;
  };
  return materialize(refs);
}

function executionReadback(execution) {
  if (object(execution?.result?.readback)) return clone(execution.result.readback);
  if (object(execution?.result?.summary)) return clone(execution.result.summary);
  if (object(execution?.result?.data)) return clone(execution.result.data);
  return {};
}

function executionEvidenceRefs(execution) {
  return unique([
    execution?.request?.id,
    execution?.id,
    ...executionArtifactRefs(execution),
    ...(Array.isArray(execution?.evidence_refs) ? execution.evidence_refs : []),
    ...(Array.isArray(execution?.result?.evidence_refs) ? execution.result.evidence_refs : []),
  ], MACRO_CONTRACT_CEILINGS.evidence_ref_max_count);
}

function executionArtifactRefs(execution) {
  const values = [
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts : []),
    ...(Array.isArray(execution?.result?.artifact_refs) ? execution.result.artifact_refs : []),
    ...(Array.isArray(execution?.artifact_refs) ? execution.artifact_refs : []),
  ];
  return unique(values.map((value) => typeof value === "string" ? value : value?.ref)
    .filter((value) => typeof value === "string" && value.startsWith("artifact:")));
}

function executionCanonicalRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (typeof value === "string" && /^(track|item|take|send|fx|project|marker|region):/u.test(value)) refs.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (object(value)) {
      if (typeof value.ref === "string") visit(value.ref);
      else Object.values(value).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  visit(execution?.result?.readback);
  visit(execution?.result?.summary);
  return unique(refs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count);
}

function firstRef(execution, prefix) {
  return executionCanonicalRefs(execution).find((ref) => ref.startsWith(prefix)) ?? null;
}

function normalizeNamedRefs(value) {
  if (Array.isArray(value)) {
    const result = {};
    for (const entry of value) {
      const ref = typeof entry === "string" ? entry : entry?.ref;
      const kind = entry?.kind ?? refKind(ref);
      if (typeof ref !== "string" || typeof kind !== "string") continue;
      if (kind === "track" && result.track_ref === undefined) result.track_ref = ref;
      if (kind === "item" && result.item_ref === undefined) result.item_ref = ref;
      if (kind === "take" && result.take_ref === undefined) result.take_ref = ref;
      if (kind === "send" && result.send_ref === undefined) result.send_ref = ref;
      if (kind === "fx" && result.fx_ref === undefined) result.fx_ref = ref;
    }
    return result;
  }
  if (!object(value)) return {};
  const result = {};
  for (const [key, raw] of Object.entries(value)) {
    const ref = typeof raw === "string" ? raw : raw?.ref;
    if (typeof ref === "string") result[key] = ref;
  }
  return result;
}

function refKind(ref) {
  return typeof ref === "string" ? ref.split(":", 1)[0] : null;
}

function hasRequiredControlRefs(targetKind, refs) {
  if (targetKind === "project") return true;
  if (targetKind === "track") return typeof refs.track_ref === "string";
  if (targetKind === "item" || targetKind === "take") return typeof refs.item_ref === "string";
  if (targetKind === "send") return typeof refs.send_ref === "string" && typeof refs.track_ref === "string";
  return targetKind === "transport";
}

function entityForTargetKind(targetKind) {
  if (targetKind === "project") return "status";
  if (targetKind === "track") return "tracks";
  if (targetKind === "item") return "items";
  if (targetKind === "take") return "takes";
  if (targetKind === "send") return "routing";
  return "status";
}

function controlScopes(targetKind) {
  if (targetKind === "project") return ["project_head"];
  if (targetKind === "track") return ["tracks"];
  if (targetKind === "item") return ["items", "takes"];
  if (targetKind === "take") return ["items", "takes"];
  if (targetKind === "send") return ["routing"];
  return ["project_head", "selection"];
}

function invalidateKnownScopes(runtime, scopes, now) {
  if (typeof runtime?.invalidateScopes !== "function") return null;
  return runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
}

function sqliteEvidence(runtime, overrides = {}) {
  const status = typeof runtime?.status === "function" ? runtime.status() : {};
  const revision = status.revision ?? status.project_revision ?? null;
  return {
    used: overrides.used === true,
    source: overrides.used === true ? "warm_index" : "not_used",
    freshness: overrides.used === true ? overrides.freshness ?? "fresh" : "not_applicable",
    snapshot_ref: overrides.used === true ? status.snapshot_id ?? null : null,
    revision: overrides.used === true && revision !== null ? String(revision) : null,
    refreshed: overrides.refreshed === true,
  };
}

function validateInputFields(input, allowed, code) {
  if (!object(input)) return [{ code, message: "Macro input must be an object.", recoverable: true }];
  return Object.keys(input)
    .filter((key) => !allowed.has(key))
    .slice(0, 16)
    .map((key) => ({ code, message: `Unsupported Macro input field: ${key}.`, recoverable: true }));
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const stage = {
    id,
    kind,
    status,
    summary,
    evidence_refs: unique(evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
  };
  const index = stages.findIndex((entry) => entry.id === id);
  if (index >= 0) stages[index] = stage;
  else stages.push(stage);
}

function requestSummary(request, dryRun) {
  const context = object(request.context) ? request.context : {};
  return {
    request_id: request.request_id ?? [
      "macro",
      request.id ?? "unknown",
      context.session_id ?? "session",
      context.request_sequence ?? 0,
    ].join(":"),
    dry_run: dryRun === true,
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

function childIdempotencyKey(base, index) {
  return typeof base === "string" && base.length > 0 ? `${base}:stage:${index + 1}` : undefined;
}

function boundedBlockers(entries) {
  return entries.slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count).map((item) => ({
    code: typeof item?.code === "string" ? item.code : "MACRO_BLOCKED",
    message: typeof item?.message === "string" ? item.message : String(item),
    recoverable: item?.recoverable !== false,
  }));
}

function validationBlockers(errors = []) {
  return errors.map((message) => ({ code: "MACRO_REQUEST_INVALID", message, recoverable: true }));
}

function blocked(code, message, blockers) {
  return {
    ok: false,
    blockers: Array.isArray(blockers) && blockers.length > 0
      ? blockers
      : [{ code, message, recoverable: true }],
  };
}

function coded(code, message, blockers) {
  const error = new Error(message);
  error.code = code;
  error.blockers = blockers;
  return error;
}

function compactData(value) {
  const data = object(value) ? clone(value) : {};
  if (Buffer.byteLength(JSON.stringify(data), "utf8") <= 18_000) return data;
  return {
    compacted: true,
    target_kind: data.target_kind ?? null,
    plugin: data.plugin ?? null,
    target_refs: data.target_refs ?? null,
    fx_ref: data.fx_ref ?? null,
    index_update: data.index_update ?? null,
  };
}

function compactObject(value) {
  if (!object(value)) return value ?? null;
  const result = {};
  for (const [key, entry] of Object.entries(value).slice(0, 32)) {
    if (typeof entry === "string") result[key] = entry.slice(0, 512);
    else if (typeof entry === "number" || typeof entry === "boolean" || entry === null) result[key] = entry;
    else if (Array.isArray(entry)) result[key] = clone(entry.slice(0, 32));
    else if (object(entry)) result[key] = clone(entry);
  }
  return result;
}

function normalizeToken(value) {
  return typeof value === "string"
    ? value.toLocaleLowerCase().replace(/[^a-z0-9]+/gu, " ").trim()
    : "";
}

function unique(values, limit = Number.POSITIVE_INFINITY) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))]
    .slice(0, limit);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {}
  return new Date().toISOString();
}

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
