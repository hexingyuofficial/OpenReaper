import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";
import {
  ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY,
  executeAlpha3_2_5BProjectUnderstandingMacro,
} from "./alpha3-2-5-b-project-understanding-v1.mjs";
import {
  ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
} from "./alpha3-c3-project-index-query-v1.mjs";
import {
  ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY,
  ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
  executeAlpha3_2_5CControlMacro,
} from "./alpha3-2-5-c-control-runtime-v1.mjs";
import {
  ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
  planAlpha3E1StockPluginMacro,
} from "./alpha3-e1-stock-plugin-fluency-v1.mjs";

export const ALPHA3_2_5_D_NATIVE_FX_MACRO_ID = "macro.fx.apply_native_chain";
export const ALPHA3_2_5_D_NATIVE_FX_RUNTIME_CONTRACT =
  "alpha3.2.5.d.native_fx_runtime.v1";

const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const ADD_TRACK_FX_ID = "template.fx.add_track_fx";
const TRANSITIVE_STOCK_TEMPLATE_IDS = Object.freeze([
  "template.fx.resolve_fx_ref",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.read_fx_parameter",
]);
const TEMPLATE_IDS = Object.freeze([
  RESOLVE_TRACK_ID,
  ADD_TRACK_FX_ID,
  ...TRANSITIVE_STOCK_TEMPLATE_IDS,
]);
const RUNTIME_CAPABILITIES = Object.freeze([
  ALPHA3_2_5_B_PROJECT_INDEX_RUNTIME_CAPABILITY,
  ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY,
  ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY,
]);
const STAGE_IDS = Object.freeze([
  "native-fx-select-track",
  "native-fx-live-resolve",
  "native-fx-add",
  "native-fx-configure",
  "native-fx-verify",
  "native-fx-index-update",
  "native-fx-result",
]);
const INPUT_FIELDS = new Set([
  "plugin",
  "controls",
  "starter_action",
  "action_parameters",
  "control_overrides",
  "selector",
  "insert_at_index",
  "dry_run",
]);
const DEFAULT_STARTER_ACTION = "gentle_vocal_compression";
const REACOMP_ADD_NAME = "ReaComp (Cockos)";

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
  program_id: "openreaper.macro.fx.apply_native_chain",
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
    identity_fields: ["project", "bridge_owner", "bridge_generation", "snapshot", "revision"],
  },
  dependencies: {
    template_ids: TEMPLATE_IDS,
    runtime_capabilities: RUNTIME_CAPABILITIES,
  },
  stages: [
    stage("native-fx-select-track", "runtime_execute", "read", ALPHA3_2_5_C_PROJECT_UNDERSTANDING_CAPABILITY),
    stage("native-fx-live-resolve", "live_ref_resolve", "read"),
    stage("native-fx-add", "template_execute", "write", ADD_TRACK_FX_ID),
    stage("native-fx-configure", "runtime_execute", "write", ALPHA3_2_5_C_STOCK_PLUGIN_EXECUTOR_CAPABILITY),
    stage("native-fx-verify", "verify", "read"),
    stage("native-fx-index-update", "index_update", "read"),
    stage("native-fx-result", "result_project", "read"),
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

export function createAlpha3_2_5DNativeFxRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? RUNTIME_CAPABILITIES,
    registeredStageIds: options.registeredStageIds ?? STAGE_IDS,
  });
}

export const ALPHA3_2_5_D_NATIVE_FX_REGISTRY = createAlpha3_2_5DNativeFxRegistry();

export function isAlpha3_2_5DNativeFxMacroId(id) {
  return id === ALPHA3_2_5_D_NATIVE_FX_MACRO_ID;
}

export function createAlpha3_2_5DNativeFxMacroDiscoveryItems(options = {}) {
  return [deepFreeze({
    id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
    title: "Apply native FX chain",
    summary: "Add one live-accepted ReaComp instance to a track and apply verified musical controls in one registered Macro call.",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.fx",
    tags: ["macro", "fx", "native_fx", "reacomp", "compression", "alpha3_2_5_d"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "native_fx_chain",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    user_label: "Apply native FX chain",
    task_intents: [
      "add a compressor",
      "apply gentle compression",
      "add ReaComp and set it",
      "compress this track",
    ],
    support_status: "bounded_reacomp_runtime_bound",
    risk_domain: "fx_chain_and_parameter_control",
    inputSchema: {
      type: "object",
      required: [],
      properties: {
        plugin: { enum: ["reacomp"] },
        controls: { type: "object", additionalProperties: true },
        starter_action: { enum: [DEFAULT_STARTER_ACTION] },
        action_parameters: { type: "object", additionalProperties: true },
        control_overrides: { type: "object", additionalProperties: true },
        selector: { type: "object", additionalProperties: true },
        insert_at_index: { type: "integer", minimum: 0, maximum: 127 },
        dry_run: { type: "boolean" },
      },
      additionalProperties: false,
    },
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: {
        contract: { const: MACRO_EXECUTION_CONTRACT },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: {
      input: [{ name: "track_ref", kind: "track", required: false, summary: "Optional exact track ref; an unambiguous Project Index selector may be used instead." }],
      output: [{ name: "fx_ref", kind: "fx", required: true, summary: "The newly created owner-scoped ReaComp ref." }],
    },
    expectedDelta: {
      kind: "write",
      action: "apply_native_fx_chain",
      entities: ["track", "fx", "fx_parameter"],
      summary: "Creates one ReaComp instance, applies a bounded semantic control set, and verifies exact parameter readback.",
    },
    examples: [{
      input: { selector: { name: "Lead Vocal" }, starter_action: DEFAULT_STARTER_ACTION, dry_run: false },
      refs: {},
    }],
    live_runnable_now: options.liveRunnableNow === true,
    exists_in_catalog: true,
    evidence_level: options.liveRunnableNow === true
      ? "bounded_reacomp_runtime_live_route_available"
      : "runtime_bound_executable",
    support_state: "supported",
    known_blocker: null,
    allowed_live_group: null,
  })];
}

export async function executeAlpha3_2_5DNativeFxMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_D_NATIVE_FX_REGISTRY.get(ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = object(request.input) ? request.input : {};
  const dryRun = input.dry_run === true;
  const state = executionState();
  const stages = [];

  const requestValidation = validateMacroProgramRequest({
    macro_id: request.id,
    input,
    refs: request.refs ?? [],
    dry_run: dryRun,
    ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}),
  }, { registry: ALPHA3_2_5_D_NATIVE_FX_REGISTRY });
  const inputBlocker = validateInput(input, request);
  if (!requestValidation.valid || inputBlocker) {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: inputBlocker?.code ?? "MACRO_REQUEST_INVALID",
      message: inputBlocker?.message ?? requestValidation.errors.join("; "),
      blockers: inputBlocker ? [inputBlocker] : requestValidation.errors.map(validationBlocker),
    });
  }
  if (typeof executeAtomic !== "function") {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: "NATIVE_FX_EXECUTOR_UNAVAILABLE",
      message: "macro.fx.apply_native_chain needs the managed OpenReaper atomic route.",
    });
  }

  const stockInput = normalizeStockInput(input);
  const stockPreflight = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, {
    ...stockInput,
    refs: { fx_ref: "fx:track:guid:{DRY-RUN}:0" },
  }, { catalog });
  const stockBlockers = (stockPreflight.blockers ?? []).filter((item) => ![
    "PARAMETER_METADATA_REQUIRED",
    "PARAMETER_METADATA_NOT_FRESH",
    "PARAMETER_INDEX_REQUIRED",
  ].includes(item.code));
  if (stockPreflight.plugin?.id !== "reacomp" || stockBlockers.length > 0) {
    const blocker = stockPreflight.plugin?.id !== "reacomp"
      ? codedBlocker("NATIVE_FX_PLUGIN_NOT_ACCEPTED", "Alpha3.2.5-D currently adds only the live-accepted ReaComp chain.")
      : normalizeBlocker(stockBlockers[0]);
    return failure({
      entry, request, startedAt, now, stages, state,
      code: blocker.code,
      message: blocker.message,
      blockers: [blocker],
    });
  }

  const selected = await selectTrack({ request, input, executeAtomic, projectIndexRuntime, catalog, now, state, stages });
  if (!selected.ok) {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: selected.blockers[0].code,
      message: selected.blockers[0].message,
      blockers: selected.blockers,
    });
  }

  if (dryRun) {
    pushStage(stages, "native-fx-add", "template_execute", "skipped", "ReaComp creation skipped during dry_run.");
    pushStage(stages, "native-fx-configure", "runtime_execute", "skipped", "Semantic parameter writes skipped during dry_run.");
    pushStage(stages, "native-fx-verify", "verify", "skipped", "No mutation requires readback during dry_run.");
    pushStage(stages, "native-fx-index-update", "index_update", "skipped", "No Project Index scope changed during dry_run.");
    pushStage(stages, "native-fx-result", "result_project", "completed", "Projected the bounded one-node native FX program.");
    return success({
      entry, request, startedAt, now, stages, state,
      status: "dry_run_completed",
      summary: "Validated a one-node ReaComp chain without mutating the project.",
      data: {
        track_ref: selected.trackRef,
        plugin: "reacomp",
        starter_action: stockInput.starter_action ?? null,
        controls: stockInput.controls ?? null,
        insert_at_index: input.insert_at_index ?? null,
        sqlite_selector_used: selected.sqliteUsed,
      },
    });
  }

  try {
    const addExecution = await executeAtomic({
      id: ADD_TRACK_FX_ID,
      input: pruneUndefined({
        plugin_name: REACOMP_ADD_NAME,
        insert_at_index: input.insert_at_index,
      }),
      refs: { track_ref: selected.trackObject },
      context: request.context,
      budget: request.budget,
      observeProjectIndex: false,
    });
    collectAtomic(state, addExecution);
    if (addExecution?.ok !== true) throw childError(ADD_TRACK_FX_ID, addExecution);
    state.changes.push({ template_id: ADD_TRACK_FX_ID, status: "applied", plugin_id: "reacomp" });
    requireWriteVerification(ADD_TRACK_FX_ID, addExecution);
    const fxRef = firstRef(addExecution, "fx:");
    if (!fxRef) throw coded("NATIVE_FX_REF_MISSING", "template.fx.add_track_fx returned no canonical FX ref.");
    state.canonicalRefs.push(fxRef);
    pushStage(stages, "native-fx-add", "template_execute", "completed", "Added one verified ReaComp instance.", evidenceRefs(addExecution));

    const configured = await executeAlpha3_2_5CControlMacro({
      request: {
        id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
        input: { ...stockInput, dry_run: false },
        refs: { fx_ref: fxRef },
        context: request.context,
        budget: request.budget,
      },
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
    });
    collectMacro(state, configured);
    if (configured?.ok !== true) {
      throw coded(
        configured?.error?.code ?? "NATIVE_FX_CONFIGURATION_FAILED",
        configured?.error?.message ?? "The bounded ReaComp configuration program failed.",
        configured?.blockers,
      );
    }
    if (configured?.result?.verification?.status !== "passed") {
      throw coded("NATIVE_FX_CONFIGURATION_UNVERIFIED", "The ReaComp parameter program did not return passed verification.");
    }
    pushStage(stages, "native-fx-configure", "runtime_execute", "completed", "Applied the registered ReaComp semantic control program.", configured.result.verification.evidence_refs);
    pushStage(stages, "native-fx-verify", "verify", "completed", "Verified ReaComp identity and normalized parameter readback within each registered tolerance.", configured.result.verification.evidence_refs);
    const indexUpdated = configured.sqlite?.used === true;
    pushStage(
      stages,
      "native-fx-index-update",
      "index_update",
      indexUpdated ? "completed" : "skipped",
      indexUpdated
        ? "Marked the Project Index FX scope stale through the child program."
        : "No configured Project Index runtime required FX invalidation.",
    );
    pushStage(stages, "native-fx-result", "result_project", "completed", "Projected the created FX ref and compact semantic readback.");
    return success({
      entry, request, startedAt, now, stages, state,
      summary: "Added ReaComp and verified its semantic controls.",
      data: {
        track_ref: selected.trackRef,
        fx_ref: fxRef,
        plugin: { id: "reacomp", display_name: "ReaComp" },
        readback: configured.result.data?.readback ?? [],
        index_update: configured.result.data?.index_update ?? null,
      },
    });
  } catch (error) {
    const invalidation = invalidateFxScope(projectIndexRuntime, now);
    if (invalidation?.ok === true) {
      state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
      pushStage(stages, "native-fx-index-update", "index_update", "completed", "Marked the Project Index FX scope stale after a partial write.");
    }
    return failure({
      entry, request, startedAt, now, stages, state,
      status: state.changes.length > 0 ? "partial_failure" : "failed",
      code: error.code ?? "NATIVE_FX_EXECUTION_FAILED",
      message: error.message ?? "The registered native FX program failed.",
      blockers: error.blockers,
    });
  }
}

async function selectTrack({ request, input, executeAtomic, projectIndexRuntime, catalog, now, state, stages }) {
  const refs = normalizeNamedRefs(request.refs);
  let candidate = refs.track_ref;
  let sqliteUsed = false;
  if (!candidate && object(input.selector)) {
    if (!projectIndexRuntime) {
      return blocked("PROJECT_INDEX_REQUIRED_FOR_SELECTOR", "The track selector needs the managed Project Index; supply an exact track_ref or restore project-query readiness.");
    }
    const { selectors, filters } = queryParts(input.selector);
    const response = await executeAlpha3_2_5BProjectUnderstandingMacro({
      request: {
        id: ALPHA3_2D_GENERIC_PROJECT_QUERY_ID,
        input: { entity: "tracks", selectors, filters, refresh_policy: "if_stale", hydrate_refs: false, limit: 3 },
        refs: [],
        context: request.context,
        budget: request.budget,
      },
      projectIndexRuntime,
      catalog,
      executeAtomic,
      now,
    });
    if (response?.ok !== true) return blockedFromEnvelope(response, "NATIVE_FX_TRACK_SELECTOR_FAILED");
    const rows = response.result?.data?.rows ?? [];
    if (rows.length === 0) return blocked("NATIVE_FX_TRACK_NOT_FOUND", "No track matched the bounded Project Index selector.");
    if (rows.length > 1) return blocked("NATIVE_FX_TRACK_AMBIGUOUS", `The bounded selector matched ${rows.length} tracks; refine it or pass an exact track_ref.`);
    candidate = rows[0].ref ?? rows[0].track_ref;
    sqliteUsed = true;
    state.sqlite = response.sqlite;
    state.evidenceRefs.push(...(response.result?.verification?.evidence_refs ?? []));
    pushStage(stages, "native-fx-select-track", "runtime_execute", "completed", "Selected one fresh track candidate from the Project Index.", response.result?.verification?.evidence_refs);
  } else {
    pushStage(stages, "native-fx-select-track", "runtime_execute", "completed", "Used the supplied exact track ref.");
  }
  if (typeof candidate !== "string" || !candidate.startsWith("track:")) {
    return blocked("NATIVE_FX_TRACK_REF_REQUIRED", "Supply one exact track_ref or one unambiguous bounded selector.");
  }
  try {
    const execution = await executeAtomic({
      id: RESOLVE_TRACK_ID,
      input: { track_ref: candidate },
      refs: {},
      context: request.context,
      budget: request.budget,
      observeProjectIndex: false,
    });
    collectAtomic(state, execution);
    if (execution?.ok !== true) throw childError(RESOLVE_TRACK_ID, execution);
    const trackRef = firstRef(execution, "track:");
    if (!trackRef) throw coded("NATIVE_FX_TRACK_RESOLUTION_FAILED", "The live track resolver returned no canonical track ref.");
    if (requiresExactIdentity(candidate) && trackRef !== candidate) {
      throw coded("NATIVE_FX_TRACK_IDENTITY_MISMATCH", `The live resolver returned ${trackRef} instead of ${candidate}.`);
    }
    const trackObject = objectRefs(execution).find((entry) => entry.kind === "track" && entry.ref === trackRef);
    if (!trackObject) throw coded("NATIVE_FX_TRACK_OBJECT_REF_MISSING", "The live track resolver returned no reusable canonical object ref.");
    state.canonicalRefs.push(trackRef);
    pushStage(stages, "native-fx-live-resolve", "live_ref_resolve", "completed", "Live-resolved the selected track immediately before the FX write.", evidenceRefs(execution));
    return { ok: true, trackRef, trackObject, sqliteUsed };
  } catch (error) {
    return blocked(error.code ?? "NATIVE_FX_TRACK_RESOLUTION_FAILED", error.message ?? "The selected track could not be live-resolved.", error.blockers);
  }
}

function validateInput(input, request) {
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return codedBlocker("NATIVE_FX_INPUT_FIELD_UNSUPPORTED", `Unsupported native FX input field: ${unknown[0]}.`);
  if (request.idempotency_key !== undefined) return codedBlocker("NATIVE_FX_IDEMPOTENCY_UNSUPPORTED", "Adding a new FX instance is non-idempotent; omit idempotency_key.");
  if (input.plugin !== undefined && input.plugin !== "reacomp") return codedBlocker("NATIVE_FX_PLUGIN_NOT_ACCEPTED", "Alpha3.2.5-D currently adds only plugin=reacomp.");
  if (input.starter_action !== undefined && input.starter_action !== DEFAULT_STARTER_ACTION) return codedBlocker("NATIVE_FX_STARTER_NOT_ACCEPTED", `Alpha3.2.5-D currently accepts only starter_action=${DEFAULT_STARTER_ACTION}.`);
  if (input.insert_at_index !== undefined && (!Number.isInteger(input.insert_at_index) || input.insert_at_index < 0 || input.insert_at_index > 127)) {
    return codedBlocker("NATIVE_FX_INSERT_INDEX_INVALID", "insert_at_index must be an integer from 0 through 127.");
  }
  return null;
}

function normalizeStockInput(input) {
  const hasControls = object(input.controls) && Object.keys(input.controls).length > 0;
  return pruneUndefined({
    plugin: "reacomp",
    controls: input.controls,
    starter_action: input.starter_action ?? (hasControls ? undefined : DEFAULT_STARTER_ACTION),
    action_parameters: input.action_parameters,
    control_overrides: input.control_overrides,
  });
}

function success({ entry, request, startedAt, now, stages, state, status = "completed", summary, data }) {
  return finalize({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: macroIdentity(entry),
    request: requestSummary(request, status === "dry_run_completed"),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: state.sqlite,
    result: {
      summary,
      canonical_refs: unique(state.canonicalRefs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: { status: "passed", evidence_refs: unique(state.evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) },
      artifact_refs: unique(state.artifactRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: compactData(data),
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: budget(entry),
  });
}

function failure({ entry, request, startedAt, now, stages, state, status = "blocked", code, message, blockers = [] }) {
  const normalized = boundedBlockers(blockers.length > 0 ? blockers : [codedBlocker(code, message)]);
  return finalize({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: requestSummary(request, false),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: state.sqlite,
    result: {
      summary: message,
      canonical_refs: unique(state.canonicalRefs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: { status: status === "partial_failure" ? "failed" : "not_required", evidence_refs: unique(state.evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) },
      artifact_refs: unique(state.artifactRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: {},
    },
    blockers: normalized,
    error: { code: code ?? normalized[0]?.code ?? "NATIVE_FX_EXECUTION_FAILED", message, recoverable: normalized.every((item) => item.recoverable !== false) },
    recovery: {
      partial_changes_possible: status === "partial_failure",
      undo_policy: entry.undo_policy,
      sqlite_rows_authorize_writes: false,
      action: status === "partial_failure"
        ? "Inspect the created FX and stage evidence, use per-stage undo if needed, refresh the FX index scope, then retry only the remaining task."
        : "Resolve the typed blocker, then retry the same registered Macro.",
    },
    budget: budget(entry),
  });
}

function finalize(envelope) {
  const value = clone(envelope);
  for (let index = 0; index < 3; index += 1) value.budget.actual_bytes = Buffer.byteLength(JSON.stringify(value), "utf8");
  const validation = validateMacroExecutionEnvelope(value);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.2.5-D native FX envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(value);
}

function executionState() {
  return {
    canonicalRefs: [],
    evidenceRefs: [],
    artifactRefs: [],
    changes: [],
    sqlite: sqliteEvidence(),
  };
}

function collectAtomic(state, execution) {
  state.canonicalRefs.push(...canonicalRefs(execution));
  state.evidenceRefs.push(...evidenceRefs(execution));
  state.artifactRefs.push(...artifactRefs(execution));
}

function collectMacro(state, envelope) {
  state.canonicalRefs.push(...(envelope?.result?.canonical_refs ?? []));
  state.evidenceRefs.push(...(envelope?.result?.verification?.evidence_refs ?? []));
  state.artifactRefs.push(...(envelope?.result?.artifact_refs ?? []));
  state.changes.push(...(envelope?.result?.changes ?? []));
  if (envelope?.sqlite?.used === true) state.sqlite = clone(envelope.sqlite);
}

function requireWriteVerification(id, execution) {
  const verification = execution?.verification ?? execution?.result?.verification;
  if (verification?.status !== "passed") throw coded("NATIVE_FX_CHILD_VERIFICATION_FAILED", `${id} completed without passed accepted Template verification.`);
}

function canonicalRefs(value) {
  const refs = [];
  const visit = (entry) => {
    if (typeof entry === "string" && /^(track|fx|project):/u.test(entry)) refs.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (object(entry)) {
      if (typeof entry.ref === "string") visit(entry.ref);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value?.result?.refs);
  visit(value?.result?.canonical_refs);
  visit(value?.result?.readback);
  visit(value?.result?.summary);
  return unique(refs);
}

function objectRefs(value) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (object(entry)) {
      if (typeof entry.kind === "string" && typeof entry.ref === "string" && object(entry.identity)) refs.push(clone(entry));
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value?.result?.refs);
  visit(value?.result?.canonical_refs);
  return refs;
}

function firstRef(value, prefix) {
  return canonicalRefs(value).find((ref) => ref.startsWith(prefix)) ?? null;
}

function evidenceRefs(value) {
  return unique([
    value?.request?.id,
    value?.id,
    ...artifactRefs(value),
    ...(Array.isArray(value?.evidence_refs) ? value.evidence_refs : []),
    ...(Array.isArray(value?.result?.evidence_refs) ? value.result.evidence_refs : []),
  ]);
}

function artifactRefs(value) {
  return unique([
    ...(Array.isArray(value?.result?.artifacts) ? value.result.artifacts : []),
    ...(Array.isArray(value?.result?.artifact_refs) ? value.result.artifact_refs : []),
    ...(Array.isArray(value?.artifact_refs) ? value.artifact_refs : []),
  ].map((entry) => typeof entry === "string" ? entry : entry?.ref)
    .filter((entry) => typeof entry === "string" && entry.startsWith("artifact:")));
}

function queryParts(selector) {
  const selectorKeys = new Set(["refs", "ref", "selected", "name", "track_ref", "track_refs"]);
  const selectors = {};
  const filters = {};
  for (const [key, value] of Object.entries(selector ?? {})) {
    (selectorKeys.has(key) ? selectors : filters)[key] = clone(value);
  }
  return { selectors, filters };
}

function normalizeNamedRefs(value) {
  if (Array.isArray(value)) {
    const match = value.find((entry) => (typeof entry === "string" ? entry : entry?.ref)?.startsWith("track:"));
    const ref = typeof match === "string" ? match : match?.ref;
    return typeof ref === "string" ? { track_ref: ref } : {};
  }
  if (!object(value)) return {};
  const raw = value.track_ref;
  const ref = typeof raw === "string" ? raw : raw?.ref;
  return typeof ref === "string" ? { track_ref: ref } : {};
}

function invalidateFxScope(runtime, now) {
  if (!runtime || typeof runtime.invalidateScopes !== "function") return null;
  return runtime.invalidateScopes({ scopes: ["fx"], reason: "macro.fx.apply_native_chain", observed_at: safeNowIso(now) });
}

function sqliteEvidence(runtime, overrides = {}) {
  let status = {};
  try { status = runtime?.status?.() ?? {}; } catch { status = {}; }
  const revision = status.revision ?? status.project_revision ?? null;
  return {
    used: overrides.used ?? false,
    source: overrides.used ? "warm_index" : "not_used",
    freshness: overrides.freshness ?? (overrides.used ? "fresh" : "not_applicable"),
    snapshot_ref: overrides.used ? status.snapshot_id ?? null : null,
    revision: overrides.used && revision !== null ? String(revision) : null,
    refreshed: overrides.freshness === "refreshed",
  };
}

function blockedFromEnvelope(envelope, fallbackCode) {
  const blockers = Array.isArray(envelope?.blockers) && envelope.blockers.length > 0
    ? envelope.blockers.map(normalizeBlocker)
    : [codedBlocker(envelope?.error?.code ?? fallbackCode, envelope?.error?.message ?? "The Project Index selector failed.")];
  return { ok: false, blockers };
}

function blocked(code, message, blockers) {
  return { ok: false, blockers: boundedBlockers(blockers?.length ? blockers : [codedBlocker(code, message)]) };
}

function childError(id, execution) {
  return coded(execution?.error?.code ?? "NATIVE_FX_ATOMIC_FAILED", execution?.error?.message ?? `${id} failed through the managed atomic route.`, execution?.error?.details?.blockers);
}

function coded(code, message, blockers) {
  const error = new Error(message);
  error.code = code;
  error.blockers = blockers;
  return error;
}

function codedBlocker(code, message, recoverable = true) {
  return { code, message, recoverable };
}

function normalizeBlocker(value) {
  if (!object(value)) return codedBlocker("NATIVE_FX_BLOCKED", String(value));
  return codedBlocker(value.code ?? "NATIVE_FX_BLOCKED", value.message ?? "The native FX task is blocked.", value.recoverable !== false);
}

function validationBlocker(message) {
  return codedBlocker("MACRO_REQUEST_INVALID", message);
}

function boundedBlockers(values) {
  return values.map(normalizeBlocker).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count);
}

function pushStage(stages, id, kind, status, summary, refs = []) {
  stages.push({ id, kind, status, summary, evidence_refs: unique(refs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) });
}

function stage(id, kind, risk, dependencyRef) {
  return { id, kind, risk, stop_on_error: true, ...(dependencyRef ? { dependency_ref: dependencyRef } : {}) };
}

function macroIdentity(entry) {
  return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk };
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
    dry_run: dryRun,
  };
}

function budget(entry) {
  return { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false };
}

function compactData(value) {
  const encoded = Buffer.byteLength(JSON.stringify(value ?? {}), "utf8");
  if (encoded > MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes) return { truncated: true, reason: "inline_detail_budget" };
  return clone(value ?? {});
}

function requiresExactIdentity(ref) {
  return typeof ref === "string" && ref.includes(":guid:");
}

function unique(values, limit = Infinity) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))].slice(0, limit);
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

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function object(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
