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
  ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
  planAlpha3E1StockPluginMacro,
} from "./alpha3-e1-stock-plugin-fluency-v1.mjs";
import {
  assertAlpha34CSemanticUnitsProven,
  STOCK_SEMANTIC_UNIT_UNPROVEN,
} from "./alpha3-4-c-fx-semantic-truth-v1.mjs";
import { fxSetAuthorityFromRequest } from "./fx-set-store-v1.mjs";

export const ALPHA3_2_5_D_NATIVE_FX_MACRO_ID = "macro.fx.apply_native_chain";
export const ALPHA3_2_5_D_NATIVE_FX_RUNTIME_CONTRACT =
  "alpha3.2.5.d.native_fx_runtime.v1";

const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const SEARCH_INSTALLED_FX_ID = "template.fx.search_installed_fx";
const LIST_TRACK_FX_CHAIN_ID = "template.fx.list_track_fx_chain";
const LIST_TAKE_FX_CHAIN_ID = "template.fx.list_take_fx_chain";
const ADD_TRACK_FX_ID = "template.fx.add_track_fx";
const ADD_TAKE_FX_ID = "template.fx.add_take_fx";
const SET_FX_BYPASS_ID = "template.fx.set_fx_bypass";
const SET_FX_PRESET_BY_NAME_ID = "template.fx.set_fx_preset_by_name";
const SET_FX_PRESET_BY_INDEX_ID = "template.fx.set_fx_preset_by_index";
const REORDER_FX_ID = "template.fx.reorder_fx";
const TRANSITIVE_STOCK_TEMPLATE_IDS = Object.freeze([
  "template.fx.resolve_fx_ref",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.read_fx_parameter",
]);
const TEMPLATE_IDS = Object.freeze([
  RESOLVE_TRACK_ID,
  SEARCH_INSTALLED_FX_ID,
  LIST_TRACK_FX_CHAIN_ID,
  LIST_TAKE_FX_CHAIN_ID,
  ADD_TRACK_FX_ID,
  ADD_TAKE_FX_ID,
  SET_FX_BYPASS_ID,
  SET_FX_PRESET_BY_NAME_ID,
  SET_FX_PRESET_BY_INDEX_ID,
  REORDER_FX_ID,
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
  "owner_kind",
  "chain",
  "plugin",
  "controls",
  "starter_action",
  "action_parameters",
  "control_overrides",
  "selector",
  "target_binding",
  "insert_at_index",
  "dry_run",
]);
const DEFAULT_STARTER_ACTION = "gentle_vocal_compression";
const REACOMP_ADD_NAME = "ReaComp (Cockos)";
const CHAIN_MAX_NODES = 8;
const FX_SET_REASON_CODE_ALLOWLIST = new Set([
  "FX_SET_ACTIVE_TAKE_MISSING",
  "FX_SET_CARDINALITY_INVALID",
  "FX_SET_CHAIN_COVERAGE_INVALID",
  "FX_SET_CONTROLS_SIZE_INVALID",
  "FX_SET_CONTROL_INVALID",
  "FX_SET_CONTROL_TARGET_DUPLICATE",
  "FX_SET_DUPLICATE_AMBIGUOUS",
  "FX_SET_EXPECTED_MEMBER_INVALID",
  "FX_SET_EXPECTED_MEMBER_MISMATCH",
  "FX_SET_FINGERPRINT_INVALID",
  "FX_SET_FX_GUID_UNAVAILABLE",
  "FX_SET_ITEM_IDENTITY_INVALID",
  "FX_SET_LAYOUT_FINGERPRINT_INVALID",
  "FX_SET_LAYOUT_MISMATCH",
  "FX_SET_MEMBER_IDENTITY_STALE",
  "FX_SET_MEMBER_REF_INVALID",
  "FX_SET_MEMBER_STALE",
  "FX_SET_MIDI_UNSUPPORTED",
  "FX_SET_MODE_INVALID",
  "FX_SET_NATURAL_VALUE_UNREACHABLE",
  "FX_SET_PARAMETER_INVENTORY_INCOMPLETE",
  "FX_SET_PARAMETER_SELECTOR_AMBIGUOUS",
  "FX_SET_PLUGIN_IDENTITY_INVALID",
  "FX_SET_PLUGIN_IDENTITY_MISMATCH",
  "FX_SET_PLUGIN_IDENTITY_UNAVAILABLE",
  "FX_SET_PROJECT_STALE",
  "FX_SET_REF_COVERAGE_INVALID",
  "FX_SET_REPRESENTATIVE_STALE",
  "FX_SET_REQUEST_INVALID",
  "FX_SET_TAKE_IDENTITY_INVALID",
]);
const CHAIN_NODE_FIELDS = new Set([
  "plugin_name",
  "plugin_query",
  "duplicate_policy",
  "insert_at_index",
  "preset_name",
  "preset_index",
  "enabled",
  "target_index",
  "controls",
  "starter_action",
  "action_parameters",
  "control_overrides",
]);
const DUPLICATE_POLICIES = new Set(["allow", "reuse_exact", "skip_exact", "fail_if_present"]);

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
    summary: "Apply one or a bounded ordered Track/Take FX chain from REAPER's installed inventory, then verify the final live chain.",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.fx",
    tags: ["macro", "fx", "chain", "installed_inventory", "track", "take", "preset", "bypass", "reorder", "reacomp"],
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
        owner_kind: { enum: ["track", "take"] },
        chain: {
          type: "array",
          minItems: 1,
          maxItems: CHAIN_MAX_NODES,
          items: { type: "object", additionalProperties: false },
        },
        plugin: { enum: ["reacomp"] },
        controls: { type: "object", additionalProperties: true },
        starter_action: { enum: [DEFAULT_STARTER_ACTION] },
        action_parameters: { type: "object", additionalProperties: true },
        control_overrides: { type: "object", additionalProperties: true },
        selector: { type: "object", additionalProperties: true },
        target_binding: { type: "object", additionalProperties: true },
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
      input: [
        { name: "track_ref", kind: "track", required: false, summary: "Exact Track ref, or use one unambiguous Track selector." },
        { name: "take_ref", kind: "take", required: false, summary: "Exact Take ref for owner_kind=take." },
      ],
      output: [{ name: "fx_refs", kind: "fx", required: true, summary: "The verified owner-scoped FX refs in final chain order." }],
    },
    expectedDelta: {
      kind: "write",
      action: "apply_native_fx_chain",
      entities: ["track", "fx", "fx_parameter"],
      summary: "Adds or reuses a bounded ordered FX chain, applies supported initial state, and verifies the final live chain.",
    },
    examples: [{
      input: {
        owner_kind: "track",
        selector: { name: "Lead Vocal" },
        chain: [
          { plugin_query: "ReaEQ", duplicate_policy: "reuse_exact" },
          { plugin_name: REACOMP_ADD_NAME, controls: { threshold_db: -18, ratio: 3 } },
        ],
        dry_run: false,
      },
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
  fxSetStore,
  catalog,
  semanticProofChecker = assertAlpha34CSemanticUnitsProven,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_D_NATIVE_FX_REGISTRY.get(ALPHA3_2_5_D_NATIVE_FX_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = object(request.input) ? request.input : {};
  const dryRun = Array.isArray(input.chain) ? input.dry_run !== false : input.dry_run === true;
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
  if (object(input.target_binding)) {
    return executeTrackOwnedActiveTakeFxSet({
      entry,
      request,
      input,
      executeAtomic,
      projectIndexRuntime,
      fxSetStore,
      catalog,
      now,
      startedAt,
      state,
      stages,
    });
  }
  if (Array.isArray(input.chain)) {
    return executeBoundedFxChain({
      entry,
      request,
      input,
      executeAtomic,
      projectIndexRuntime,
      catalog,
      semanticProofChecker,
      now,
      startedAt,
      state,
      stages,
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

  const requestedSemanticControls = stockPreflight.hydration_flow?.wanted_controls
    ?? stockPreflight.customer_readback?.requested_controls?.map((item) => item.control)
    ?? [];
  const semanticPluginId = stockPreflight.plugin.id;
  const semanticProof = semanticProofChecker(semanticPluginId, requestedSemanticControls);
  if (!semanticProof.ok) {
    const nextCall = createLegacyReaCompRecoveryCall({ request, input });
    return failure({
      entry, request, startedAt, now, stages, state,
      code: STOCK_SEMANTIC_UNIT_UNPROVEN,
      message: semanticProof.message,
      blockers: [codedBlocker(STOCK_SEMANTIC_UNIT_UNPROVEN, semanticProof.message)],
      data: {
        mode: "semantic",
        plugin_id: semanticPluginId,
        unproven_controls: semanticProof.unproven,
        next_call: nextCall,
      },
      recoveryAction: "Run next_call to add ReaComp without semantic controls, then use its returned FX ref to list exact parameters and call macro.fx.set_controls mode=exact_parameters.",
      recoveryNextCall: nextCall,
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
    const addVerification = addExecution?.verification ?? addExecution?.result?.verification;
    state.changes.push({
      template_id: ADD_TRACK_FX_ID,
      status: addVerification?.status === "passed" ? "mutation_completed" : "mutation_unverified",
      plugin_id: "reacomp",
      mutation: { status: "completed", verification_status: addVerification?.status ?? "missing" },
      live_readback: { status: "pending" },
      index_maintenance: { status: "pending" },
    });
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
      semanticProofChecker,
      now,
    });
    collectMacro(state, configured);
    const configuredReadbackPassed = configured?.result?.verification?.status === "passed"
      && (configured?.result?.changes?.length ?? 0) > 0
      && configured.result.changes.every((change) => change.status === "applied" && change.live_readback?.status === "passed");
    const configuredIndexFailed = configuredReadbackPassed
      && configured?.result?.data?.outcome?.index_maintenance?.status === "failed";
    if (configured?.ok !== true && !configuredIndexFailed) {
      throw coded(
        configured?.error?.code ?? "NATIVE_FX_CONFIGURATION_FAILED",
        configured?.error?.message ?? "The bounded ReaComp configuration program failed.",
        configured?.blockers,
      );
    }
    if (configured?.result?.verification?.status !== "passed") {
      throw coded("NATIVE_FX_CONFIGURATION_UNVERIFIED", "The ReaComp parameter program did not return passed verification.");
    }
    const addChange = state.changes.find((change) => change.template_id === ADD_TRACK_FX_ID);
    if (addChange) {
      addChange.status = "applied";
      addChange.live_readback = {
        status: "passed",
        source: "live_fx_identity_and_parameter_readback",
        fx_ref: fxRef,
      };
    }
    pushStage(stages, "native-fx-configure", "runtime_execute", "completed", "Applied the registered ReaComp semantic control program.", configured.result.verification.evidence_refs);
    pushStage(stages, "native-fx-verify", "verify", "completed", "Verified ReaComp identity and normalized parameter readback within each registered tolerance.", configured.result.verification.evidence_refs);
    if (configuredIndexFailed) {
      applyFxIndexMaintenance(state.changes, "failed", configured.result.data?.index_update);
      pushStage(stages, "native-fx-index-update", "index_update", "failed", "FX mutation/readback passed, but Project Index maintenance failed.");
      pushStage(stages, "native-fx-result", "result_project", "completed", "Projected verified FX changes separately from the failed cache-maintenance outcome.");
      return failure({
        entry,
        request,
        startedAt,
        now,
        stages,
        state,
        status: "partial_failure",
        code: configured?.error?.code ?? "NATIVE_FX_INDEX_MAINTENANCE_FAILED",
        message: configured?.error?.message ?? "FX mutation and live readback passed, but Project Index maintenance failed.",
        blockers: configured?.blockers,
        data: {
          track_ref: selected.trackRef,
          fx_ref: fxRef,
          plugin: { id: "reacomp", display_name: "ReaComp" },
          readback: configured.result.data?.readback ?? [],
          index_update: configured.result.data?.index_update ?? null,
          outcome: fxOutcome(state),
        },
      });
    }
    const indexUpdated = configured.sqlite?.used === true;
    applyFxIndexMaintenance(
      state.changes,
      indexUpdated ? "completed" : "skipped",
      configured.result.data?.index_update,
    );
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
        outcome: fxOutcome(state),
      },
    });
  } catch (error) {
    const invalidation = invalidateFxScope(projectIndexRuntime, now);
    if (invalidation?.ok === true) {
      applyFxIndexMaintenance(state.changes, "completed", invalidation);
      state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
      pushStage(stages, "native-fx-index-update", "index_update", "completed", "Marked the Project Index FX scope stale after a partial write.");
    } else if (invalidation?.ok === false) {
      applyFxIndexMaintenance(state.changes, "failed", invalidation);
    }
    return failure({
      entry, request, startedAt, now, stages, state,
      status: state.changes.length > 0 ? "partial_failure" : "failed",
      code: error.code ?? "NATIVE_FX_EXECUTION_FAILED",
      message: error.message ?? "The registered native FX program failed.",
      blockers: error.blockers,
      data: { index_update: compactData(invalidation), outcome: fxOutcome(state) },
    });
  }
}

async function executeTrackOwnedActiveTakeFxSet({
  entry,
  request,
  input,
  executeAtomic,
  projectIndexRuntime,
  fxSetStore,
  catalog,
  now,
  startedAt,
  state,
  stages,
}) {
  const dryRun = input.dry_run !== false;
  const bindingBlocker = validateTrackOwnedActiveTakeBinding(input, request);
  if (bindingBlocker) {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: bindingBlocker.code,
      message: bindingBlocker.message,
      blockers: [bindingBlocker],
    });
  }
  if (!fxSetStore || typeof fxSetStore.putSet !== "function") {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: "FX_SET_STORE_UNAVAILABLE",
      message: "The server-owned FX set store is unavailable; no Take FX mutation was attempted.",
    });
  }

  const authority = fxSetAuthorityFromRequest(request, projectIndexRuntime);
  const authorityBlocker = validateFxSetAuthority(authority);
  if (authorityBlocker) {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: authorityBlocker.code,
      message: authorityBlocker.message,
      blockers: [authorityBlocker],
    });
  }

  const selected = await selectTrack({
    request,
    input,
    executeAtomic,
    projectIndexRuntime,
    catalog,
    now,
    state,
    stages,
  });
  if (!selected.ok) {
    return failure({
      entry, request, startedAt, now, stages, state,
      code: selected.blockers[0].code,
      message: selected.blockers[0].message,
      blockers: selected.blockers,
    });
  }

  try {
    const node = input.chain[0];
    const installed = await resolveInstalledFx({ node, request, executeAtomic, state });
    const execution = await executeFxAtomic({
      id: ADD_TAKE_FX_ID,
      input: {
        plugin_name: installed.name,
        duplicate_policy: "reuse_exact",
        target_binding: clone(input.target_binding),
        include_parameter_layout: true,
        dry_run: dryRun,
      },
      refs: { track_ref: selected.trackObject },
      request,
      executeAtomic,
      state,
      write: !dryRun,
      budget: ALPHA3_E1_STOCK_PLUGIN_PARAMETER_LIST_BUDGET,
    });
    const readback = executionReadback(execution);
    const normalized = normalizeTrackTakeFxSetReadback({
      readback,
      expectedTrackRef: selected.trackRef,
      expectedPluginName: installed.name,
      dryRun,
    });
    if (!normalized.ok) throw coded(normalized.code, normalized.message, normalized.blockers);

    const change = {
      operation_id: "fx-set-active-takes",
      template_id: ADD_TAKE_FX_ID,
      target_ref: selected.trackRef,
      related_ref: normalized.representative_fx_ref,
      plugin_name: installed.name,
      duplicate_policy: "reuse_exact",
      status: dryRun ? "planned" : "applied",
      mutation: {
        status: dryRun ? "not_run" : "completed",
        created_count: normalized.created_count,
        reused_count: normalized.reused_count,
      },
      live_readback: {
        status: "passed",
        source: dryRun ? "native_full_batch_preflight" : "native_aggregate_take_fx_readback",
        member_count: normalized.members.length,
      },
      index_maintenance: { status: dryRun ? "skipped" : "pending", scopes: [] },
    };
    state.changes.push(change);
    state.canonicalRefs.push(selected.trackRef);
    if (normalized.representative_fx_ref) state.canonicalRefs.push(normalized.representative_fx_ref);
    pushStage(
      stages,
      "native-fx-add",
      "template_execute",
      dryRun ? "skipped" : "completed",
      dryRun
        ? `Preflighted ${normalized.members.length} active audio Take target(s) with zero mutation.`
        : `Added or reused one homogeneous Take FX across ${normalized.members.length} active audio Take target(s) in one native batch.`,
      evidenceRefs(execution),
    );
    pushStage(stages, "native-fx-configure", "runtime_execute", "skipped", "The FX-set creation call does not write shared controls; use inspect_set then shared_plan.");
    pushStage(stages, "native-fx-verify", "verify", "completed", `Verified ${normalized.members.length} homogeneous Take FX member(s) through aggregate native readback.`, evidenceRefs(execution));

    if (dryRun) {
      pushStage(stages, "native-fx-index-update", "index_update", "skipped", "Dry run did not stale the Project Index.");
      pushStage(stages, "native-fx-result", "result_project", "completed", "Projected the Track-owned active-Take FX set plan.");
      return success({
        entry, request, startedAt, now, stages, state,
        status: "dry_run_completed",
        summary: `Validated ${normalized.members.length} active audio Take FX target(s) without mutation.`,
        data: {
          mode: "track_owned_active_take_fx_set",
          track_ref: selected.trackRef,
          member_count: normalized.members.length,
          plugin_identity: normalized.plugin_identity,
          layout_fingerprint: normalized.layout_fingerprint,
          zero_write: true,
        },
      });
    }

    const stored = fxSetStore.putSet({
      authority,
      track_ref: selected.trackRef,
      plugin_identity: normalized.plugin_identity,
      layout_fingerprint: normalized.layout_fingerprint,
      representative_fx_ref: normalized.representative_fx_ref,
      members: normalized.members,
    });
    if (!stored.ok) {
      throw coded(stored.code ?? "FX_SET_STORE_FAILED", stored.message ?? "The verified FX set could not be retained.", stored.blockers);
    }
    const invalidation = invalidateFxScope(projectIndexRuntime, now);
    applyFxIndexMaintenance(
      state.changes,
      invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
      invalidation,
    );
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    pushStage(
      stages,
      "native-fx-index-update",
      "index_update",
      invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
      invalidation?.ok === false
        ? "Take FX readback passed, but Project Index FX invalidation failed."
        : invalidation
          ? "Marked the Project Index FX scope stale after verified Take FX batch mutation."
          : "No configured Project Index runtime required FX invalidation.",
    );
    pushStage(stages, "native-fx-result", "result_project", "completed", "Retained one project- and generation-bound homogeneous FX set.");
    const data = {
      mode: "track_owned_active_take_fx_set",
      track_ref: selected.trackRef,
      fx_set_ref: stored.record.ref,
      set_fingerprint: stored.record.set_fingerprint,
      member_count: stored.record.members.length,
      representative_fx_ref: stored.record.representative_fx_ref,
      plugin_identity: stored.record.plugin_identity,
      layout_fingerprint: stored.record.layout_fingerprint,
      created_count: normalized.created_count,
      reused_count: normalized.reused_count,
      project_instance_id: normalized.project_instance_id,
      expires_at_ms: stored.record.expires_at_ms,
      outcome: fxOutcome(state),
      index_update: compactData(invalidation),
    };
    if (invalidation?.ok === false) {
      return failure({
        entry, request, startedAt, now, stages, state,
        status: "partial_failure",
        code: invalidation.blockers?.[0]?.code ?? "FX_SET_INDEX_MAINTENANCE_FAILED",
        message: "Take FX batch mutation and readback passed, but Project Index maintenance failed.",
        blockers: invalidation.blockers,
        data,
      });
    }
    return success({
      entry, request, startedAt, now, stages, state,
      summary: `Applied and verified one homogeneous Take FX across ${stored.record.members.length} active Take target(s).`,
      data,
    });
  } catch (error) {
    const mutationAttempted = state.changes.some((change) => change.mutation?.status === "completed");
    return failure({
      entry, request, startedAt, now, stages, state,
      status: mutationAttempted ? "partial_failure" : "blocked",
      code: error.code ?? "FX_SET_CREATION_FAILED",
      message: error.message ?? "The Track-owned active-Take FX set could not be created.",
      blockers: error.blockers,
      details: error.details,
      data: { mode: "track_owned_active_take_fx_set", track_ref: selected.trackRef },
    });
  }
}

async function executeBoundedFxChain({
  entry,
  request,
  input,
  executeAtomic,
  projectIndexRuntime,
  catalog,
  semanticProofChecker = assertAlpha34CSemanticUnitsProven,
  now,
  startedAt,
  state,
  stages,
}) {
  const dryRun = input.dry_run !== false;
  let finalChain = null;
  let owner = null;
  try {
    owner = await resolveFxChainOwner({
      request,
      input,
      executeAtomic,
      projectIndexRuntime,
      catalog,
      now,
      state,
      stages,
    });
    if (!owner.ok) {
      return failure({
        entry, request, startedAt, now, stages, state,
        code: owner.blockers[0].code,
        message: owner.blockers[0].message,
        blockers: owner.blockers,
      });
    }

    const initialExecution = await executeFxAtomic({
      id: owner.listTemplateId,
      input: { include_preset: true },
      refs: owner.refs,
      request,
      executeAtomic,
      state,
    });
    const initialChain = requireCompleteFxChain(initialExecution, "initial");
    const knownRows = initialChain.fx.map((row) => ({ ...row }));
    const preparedNodes = [];
    for (let index = 0; index < input.chain.length; index += 1) {
      const node = input.chain[index];
      const installed = await resolveInstalledFx({ node, request, executeAtomic, state });
      preparedNodes.push({ index, node, installed });
    }

    const semanticPreflight = preflightBoundedFxChainSemanticControls({
      nodes: preparedNodes,
      catalog,
      semanticProofChecker,
    });
    if (!semanticPreflight.ok) {
      const nextCall = createChainSemanticRecoveryCall({ request, input });
      return failure({
        entry,
        request,
        startedAt,
        now,
        stages,
        state,
        code: semanticPreflight.code,
        message: semanticPreflight.message,
        blockers: semanticPreflight.blockers,
        data: {
          mode: "semantic",
          owner_kind: owner.ownerKind,
          owner_ref: owner.ownerRef,
          initial_chain: compactFxChain(initialChain),
          ...semanticPreflight.data,
          next_call: nextCall,
        },
        recoveryAction: "Run next_call to apply the installed chain without semantic controls, then use each returned real FX ref to list exact parameters and call macro.fx.set_controls mode=exact_parameters.",
        recoveryNextCall: nextCall,
      });
    }

    const operations = [];

    for (const prepared of preparedNodes) {
      const { index, node, installed } = prepared;
      const duplicatePolicy = node.duplicate_policy ?? "allow";
      const duplicateRows = knownRows.filter((row) => fxNamesEqual(row.name, installed.name));
      let fxRef = null;
      let fxObject = null;
      let skipped = false;
      let preferredSlot = null;
      const atomicChecks = [];
      const mutationActions = [];
      const change = {
        operation_id: `fx-chain-${index + 1}`,
        template_id: "macro.fx.apply_chain",
        target_ref: owner.ownerRef,
        related_ref: null,
        plugin_name: installed.name,
        duplicate_policy: duplicatePolicy,
        status: dryRun ? "planned" : "pending",
        mutation: {
          status: "not_run",
          actions: mutationActions,
        },
        live_readback: { status: dryRun ? "not_run" : "pending" },
        index_maintenance: { status: "pending", scopes: [] },
      };
      state.changes.push(change);

      if (duplicateRows.length > 0 && duplicatePolicy === "fail_if_present") {
        throw coded(
          "FX_CHAIN_DUPLICATE_PRESENT",
          `${installed.name} already exists on the target and duplicate_policy=fail_if_present.`,
        );
      }
      if (duplicateRows.length > 0 && ["reuse_exact", "skip_exact"].includes(duplicatePolicy)) {
        const reused = duplicateRows[0];
        fxRef = reused.fx_ref;
        preferredSlot = reused.slot_index;
        skipped = duplicatePolicy === "skip_exact";
        change.related_ref = fxRef;
        change.status = skipped ? "unchanged" : "pending";
      }

      if (!fxRef && !dryRun) {
        const addExecution = await executeFxAtomic({
          id: owner.addTemplateId,
          input: pruneUndefined({
            plugin_name: installed.name,
            insert_at_index: node.insert_at_index,
          }),
          refs: owner.refs,
          request,
          executeAtomic,
          state,
          write: true,
        });
        const addReadback = executionReadback(addExecution);
        fxRef = firstRef(addExecution, "fx:") ?? addReadback.fx_ref ?? null;
        fxObject = objectRefs(addExecution).find((entry) => entry.kind === "fx" && entry.ref === fxRef) ?? null;
        preferredSlot = integerOrNull(addReadback.slot_index);
        if (!fxRef || !fxObject || !fxNamesEqual(addReadback.name, installed.name)) {
          throw coded("FX_CHAIN_ADD_READBACK_MISMATCH", `The added FX did not read back as ${installed.name}.`);
        }
        mutationActions.push({ template_id: owner.addTemplateId, status: "completed" });
        change.mutation.status = "completed";
        change.related_ref = fxRef;
        atomicChecks.push(true);
        knownRows.push({ fx_ref: fxRef, fx_object: fxObject, slot_index: preferredSlot, name: installed.name });
      }

      if (!dryRun && !skipped && !fxRef) {
        throw coded("FX_CHAIN_REF_MISSING", `No exact FX ref is available for ${installed.name}.`);
      }
      if (!dryRun && !skipped && !fxObject) {
        fxObject = await resolveExactFxObject({
          fxRef,
          owner,
          preferredSlot,
          request,
          executeAtomic,
          state,
        });
      }

      if (!dryRun && !skipped && node.preset_name !== undefined) {
        const execution = await executeFxAtomic({
          id: SET_FX_PRESET_BY_NAME_ID,
          input: { preset_name: node.preset_name },
          refs: { fx_ref: fxObject },
          request,
          executeAtomic,
          state,
          write: true,
        });
        const readback = executionReadback(execution);
        atomicChecks.push(readback.preset_name === node.preset_name);
        mutationActions.push({ template_id: SET_FX_PRESET_BY_NAME_ID, status: "completed" });
        change.mutation.status = "completed";
      }
      if (!dryRun && !skipped && node.preset_index !== undefined) {
        const execution = await executeFxAtomic({
          id: SET_FX_PRESET_BY_INDEX_ID,
          input: { preset_index: node.preset_index },
          refs: { fx_ref: fxObject },
          request,
          executeAtomic,
          state,
          write: true,
        });
        const readback = executionReadback(execution);
        atomicChecks.push(readback.preset_index === node.preset_index);
        mutationActions.push({ template_id: SET_FX_PRESET_BY_INDEX_ID, status: "completed" });
        change.mutation.status = "completed";
      }
      if (!dryRun && !skipped && node.enabled !== undefined) {
        const execution = await executeFxAtomic({
          id: SET_FX_BYPASS_ID,
          input: { enabled: node.enabled },
          refs: { fx_ref: fxObject },
          request,
          executeAtomic,
          state,
          write: true,
        });
        const readback = executionReadback(execution);
        atomicChecks.push(readback.enabled === node.enabled);
        mutationActions.push({ template_id: SET_FX_BYPASS_ID, status: "completed" });
        change.mutation.status = "completed";
      }
      if (!dryRun && !skipped && node.target_index !== undefined) {
        const execution = await executeFxAtomic({
          id: REORDER_FX_ID,
          input: { target_index: node.target_index },
          refs: { fx_ref: fxObject },
          request,
          executeAtomic,
          state,
          write: true,
        });
        const readback = executionReadback(execution);
        fxRef = firstRef(execution, "fx:") ?? readback.fx_ref ?? fxRef;
        fxObject = objectRefs(execution).find((entry) => entry.kind === "fx" && entry.ref === fxRef) ?? fxObject;
        change.related_ref = fxRef;
        preferredSlot = integerOrNull(readback.slot_index);
        atomicChecks.push(readback.slot_index === node.target_index);
        mutationActions.push({ template_id: REORDER_FX_ID, status: "completed" });
        change.mutation.status = "completed";
      }
      if (!dryRun && !skipped && prepared.semantic) {
        if (!normalizeFxName(installed.name).includes("reacomp")) {
          throw coded(
            "FX_CHAIN_INITIAL_CONTROLS_UNSUPPORTED",
            `Initial semantic controls are accepted only for the reviewed ReaComp mapping; ${installed.name} must be configured through macro.fx.set_controls or direct normalized controls.`,
          );
        }
        const configured = await executeAlpha3_2_5CControlMacro({
          request: {
            id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID,
            input: pruneUndefined({
              plugin: "reacomp",
              controls: node.controls,
              starter_action: node.starter_action,
              action_parameters: node.action_parameters,
              control_overrides: node.control_overrides,
              dry_run: false,
            }),
            refs: { fx_ref: fxObject },
            context: request.context,
            budget: request.budget,
          },
          executeAtomic,
          projectIndexRuntime,
          catalog,
          semanticProofChecker,
          now,
        });
        collectMacro(state, configured);
        if (configured?.ok !== true || configured?.result?.verification?.status !== "passed") {
          throw coded(
            configured?.error?.code ?? "FX_CHAIN_INITIAL_CONTROLS_FAILED",
            configured?.error?.message ?? "The supported initial FX controls did not pass live readback.",
            configured?.blockers,
          );
        }
        atomicChecks.push(true);
        mutationActions.push({ template_id: ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, status: "completed" });
        change.mutation.status = "completed";
      }
      operations.push({
        node,
        change,
        installedName: installed.name,
        fxRef,
        preferredSlot,
        atomicChecks,
        skipped,
      });
    }

    pushStage(
      stages,
      "native-fx-add",
      "template_execute",
      dryRun ? "skipped" : "completed",
      dryRun
        ? `Validated ${operations.length} installed FX node(s) without mutation.`
        : `Applied ${operations.length} bounded FX chain node(s).`,
    );
    pushStage(
      stages,
      "native-fx-configure",
      "runtime_execute",
      dryRun ? "skipped" : "completed",
      dryRun ? "Optional FX state changes were not run during dry_run." : "Applied requested duplicate, preset, bypass, reorder, and supported initial-control policies.",
    );

    if (dryRun) {
      applyFxIndexMaintenance(state.changes, "skipped", null);
      pushStage(stages, "native-fx-verify", "verify", "skipped", "No mutation requires final chain readback during dry_run.");
      pushStage(stages, "native-fx-index-update", "index_update", "skipped", "No Project Index scope changed during dry_run.");
      pushStage(stages, "native-fx-result", "result_project", "completed", "Projected the bounded installed-FX chain plan.");
      return success({
        entry, request, startedAt, now, stages, state,
        status: "dry_run_completed",
        summary: `Validated ${operations.length} installed FX chain node(s) without mutating REAPER.`,
        data: {
          owner_kind: owner.ownerKind,
          owner_ref: owner.ownerRef,
          planned_chain: operations.map((operation) => ({
            plugin_name: operation.installedName,
            duplicate_policy: operation.node.duplicate_policy ?? "allow",
            insert_at_index: operation.node.insert_at_index ?? null,
            target_index: operation.node.target_index ?? null,
          })),
          initial_chain: compactFxChain(initialChain),
        },
      });
    }

    const finalExecution = await executeFxAtomic({
      id: owner.listTemplateId,
      input: { include_preset: true },
      refs: owner.refs,
      request,
      executeAtomic,
      state,
    });
    finalChain = requireCompleteFxChain(finalExecution, "final");
    let orderedCursor = 0;
    let readbackFailed = false;
    for (const operation of operations) {
      const matched = matchFinalFxRow(finalChain.fx, operation, orderedCursor);
      if (matched.row) orderedCursor = Math.max(orderedCursor, matched.row.slot_index + 1);
      const enabledMatches = operation.node.enabled === undefined || matched.row?.enabled === operation.node.enabled;
      const targetMatches = operation.node.target_index === undefined || matched.row?.slot_index === operation.node.target_index;
      const atomicMatches = operation.atomicChecks.every(Boolean);
      const passed = Boolean(matched.row) && enabledMatches && targetMatches && atomicMatches;
      operation.change.related_ref = matched.row?.fx_ref ?? operation.fxRef;
      operation.change.status = passed
        ? operation.skipped || operation.change.mutation.status === "not_run" ? "unchanged" : "applied"
        : "readback_failed";
      operation.change.live_readback = {
        status: passed ? "passed" : "failed",
        source: "complete_final_chain_plus_atomic_state_readback",
        observed_ref: matched.row?.fx_ref ?? null,
        observed_slot_index: matched.row?.slot_index ?? null,
        observed_name: matched.row?.name ?? null,
        observed_enabled: matched.row?.enabled ?? null,
      };
      readbackFailed ||= !passed;
    }
    pushStage(
      stages,
      "native-fx-verify",
      "verify",
      readbackFailed ? "failed" : "completed",
      readbackFailed
        ? "One or more FX nodes did not match the complete final live chain and atomic state readback."
        : `Verified all ${operations.length} FX node(s) in the complete final live chain.`,
      evidenceRefs(finalExecution),
    );
    if (readbackFailed) {
      throw coded("FX_CHAIN_FINAL_READBACK_MISMATCH", "The final live FX chain did not match every requested node.");
    }

    const invalidation = invalidateFxScope(projectIndexRuntime, now);
    applyFxIndexMaintenance(
      state.changes,
      invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
      invalidation,
    );
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    pushStage(
      stages,
      "native-fx-index-update",
      "index_update",
      invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
      invalidation?.ok === false
        ? "FX mutation/readback passed, but Project Index FX invalidation failed."
        : invalidation
          ? "Marked the Project Index FX scope stale after verified chain mutation."
          : "No configured Project Index runtime required FX invalidation.",
    );
    pushStage(stages, "native-fx-result", "result_project", "completed", "Projected the complete verified final FX chain.");
    const resultData = {
      owner_kind: owner.ownerKind,
      owner_ref: owner.ownerRef,
      final_chain: compactFxChain(finalChain),
      outcome: fxOutcome(state),
      index_update: compactData(invalidation),
    };
    if (invalidation?.ok === false) {
      return failure({
        entry, request, startedAt, now, stages, state,
        status: "partial_failure",
        code: invalidation.blockers?.[0]?.code ?? "FX_CHAIN_INDEX_MAINTENANCE_FAILED",
        message: "FX chain mutation and live readback passed, but Project Index maintenance failed.",
        blockers: invalidation.blockers,
        data: resultData,
      });
    }
    return success({
      entry, request, startedAt, now, stages, state,
      summary: `Applied and verified ${operations.length} FX chain node(s).`,
      data: resultData,
    });
  } catch (error) {
    const mutated = state.changes.some((change) => change.mutation?.status === "completed");
    const invalidation = mutated ? invalidateFxScope(projectIndexRuntime, now) : null;
    if (invalidation) {
      applyFxIndexMaintenance(state.changes, invalidation.ok === false ? "failed" : "completed", invalidation);
      state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    }
    if (!stages.some((stageEntry) => stageEntry.id === "native-fx-index-update")) {
      pushStage(
        stages,
        "native-fx-index-update",
        "index_update",
        invalidation?.ok === false ? "failed" : invalidation ? "completed" : "skipped",
        invalidation
          ? "Marked the Project Index FX scope stale after a blocked or partial chain mutation."
          : "No mutation required Project Index maintenance.",
      );
    }
    return failure({
      entry, request, startedAt, now, stages, state,
      status: mutated ? "partial_failure" : "blocked",
      code: error.code ?? "FX_CHAIN_EXECUTION_FAILED",
      message: error.message ?? "The bounded FX chain program failed.",
      blockers: error.blockers,
      data: {
        owner_kind: owner?.ownerKind ?? null,
        owner_ref: owner?.ownerRef ?? null,
        final_chain: finalChain ? compactFxChain(finalChain) : null,
        outcome: fxOutcome(state),
        index_update: compactData(invalidation),
      },
    });
  }
}

async function resolveFxChainOwner({ request, input, executeAtomic, projectIndexRuntime, catalog, now, state, stages }) {
  const refs = normalizeNamedRefs(request.refs);
  const ownerKind = input.owner_kind ?? (refs.take_ref ? "take" : "track");
  if (ownerKind === "track") {
    const selected = await selectTrack({ request, input, executeAtomic, projectIndexRuntime, catalog, now, state, stages });
    if (!selected.ok) return selected;
    return {
      ok: true,
      ownerKind,
      ownerRef: selected.trackRef,
      refs: { track_ref: selected.trackObject },
      listTemplateId: LIST_TRACK_FX_CHAIN_ID,
      addTemplateId: ADD_TRACK_FX_ID,
    };
  }
  pushStage(stages, "native-fx-select-track", "runtime_execute", "completed", "Used the supplied exact Take ref.");
  if (typeof refs.take_ref !== "string" || !refs.take_ref.startsWith("take:guid:")) {
    return blocked("FX_CHAIN_TAKE_REF_REQUIRED", "owner_kind=take requires one exact canonical take:guid ref.");
  }
  const takeObject = exactGuidObjectRef("take", refs.take_ref);
  if (takeObject === null) {
    return blocked("FX_CHAIN_TAKE_REF_REQUIRED", "owner_kind=take requires one exact canonical take:guid ref.");
  }
  const probe = await executeFxAtomic({
    id: LIST_TAKE_FX_CHAIN_ID,
    input: { include_preset: true },
    refs: { take_ref: takeObject },
    request,
    executeAtomic,
    state,
  });
  const chain = requireCompleteFxChain(probe, "owner preflight");
  if (chain.owner_ref !== refs.take_ref) {
    return blocked("FX_CHAIN_TAKE_IDENTITY_MISMATCH", `The live Take chain resolved as ${chain.owner_ref ?? "unknown"} instead of ${refs.take_ref}.`);
  }
  state.canonicalRefs.push(refs.take_ref);
  pushStage(stages, "native-fx-live-resolve", "live_ref_resolve", "completed", "Live-resolved the exact Take through its FX chain readback.", evidenceRefs(probe));
  return {
    ok: true,
    ownerKind,
    ownerRef: refs.take_ref,
    refs: { take_ref: takeObject },
    listTemplateId: LIST_TAKE_FX_CHAIN_ID,
    addTemplateId: ADD_TAKE_FX_ID,
  };
}

async function resolveInstalledFx({ node, request, executeAtomic, state }) {
  const query = node.plugin_name ?? node.plugin_query;
  const execution = await executeFxAtomic({
    id: SEARCH_INSTALLED_FX_ID,
    input: { query, limit: 8, offset: 0 },
    refs: {},
    request,
    executeAtomic,
    state,
  });
  const readback = executionReadback(execution);
  const rows = Array.isArray(readback.rows) ? readback.rows : [];
  if (readback.truncated === true) {
    throw coded(
      "FX_INVENTORY_COVERAGE_INCOMPLETE",
      `Installed FX search for ${query} was truncated; no exact plugin selection was authorized.`,
    );
  }
  let matches;
  if (node.plugin_name !== undefined) {
    matches = rows.filter((row) => fxNamesEqual(row.name, node.plugin_name) || fxNamesEqual(row.ident, node.plugin_name));
  } else {
    matches = Number(readback.matched_count) === 1 && rows.length === 1 ? rows : [];
  }
  if (matches.length !== 1) {
    const suggestions = rows.slice(0, 3).map((row) => row.name).filter(Boolean).join(", ");
    throw coded(
      rows.length === 0 ? "FX_INSTALLED_MATCH_NOT_FOUND" : "FX_INSTALLED_MATCH_AMBIGUOUS",
      rows.length === 0
        ? `No installed FX matched ${query}.`
        : `Installed FX search for ${query} is not exact; use one exact plugin_name${suggestions ? ` such as ${suggestions}` : ""}.`,
    );
  }
  return { name: matches[0].name, ident: matches[0].ident ?? matches[0].name };
}

function preflightBoundedFxChainSemanticControls({ nodes, catalog, semanticProofChecker }) {
  let firstFailure = null;
  for (const prepared of nodes) {
    const { index, node, installed } = prepared;
    if (!hasFxChainSemanticIntent(node)) continue;

    const semanticFields = requestedFxChainSemanticFields(node);

    if (!normalizeFxName(installed.name).includes("reacomp")) {
      firstFailure ??= {
        ok: false,
        code: "FX_CHAIN_INITIAL_CONTROLS_UNSUPPORTED",
        message: `Initial semantic controls are accepted only for the reviewed ReaComp mapping; ${installed.name} must be configured through macro.fx.set_controls mode=exact_parameters.`,
        blockers: [codedBlocker(
          "FX_CHAIN_INITIAL_CONTROLS_UNSUPPORTED",
          `Initial semantic controls are accepted only for the reviewed ReaComp mapping; ${installed.name} must be configured through macro.fx.set_controls mode=exact_parameters.`,
        )],
        data: {
          chain_index: index,
          plugin_name: installed.name,
          plugin_id: null,
          requested_controls: Object.keys(node.controls ?? {}),
          semantic_fields: semanticFields,
        },
      };
      continue;
    }

    const stockInput = pruneUndefined({
      plugin: "reacomp",
      controls: node.controls,
      starter_action: node.starter_action,
      action_parameters: node.action_parameters,
      control_overrides: node.control_overrides,
    });
    const plan = planAlpha3E1StockPluginMacro(ALPHA3_E1_STOCK_PLUGIN_MACRO_ID, stockInput, { catalog });
    const hardBlockers = (plan.blockers ?? []).filter((item) => ![
      "REQUIRED_REF_MISSING",
      "PARAMETER_METADATA_REQUIRED",
      "PARAMETER_METADATA_NOT_FRESH",
      "PARAMETER_INDEX_REQUIRED",
    ].includes(item.code));
    if (plan.plugin?.id !== "reacomp" || hardBlockers.length > 0) {
      const blocker = plan.plugin?.id !== "reacomp"
        ? codedBlocker("FX_CHAIN_INITIAL_CONTROLS_UNSUPPORTED", `The installed FX ${installed.name} did not resolve to the reviewed ReaComp semantic mapping.`)
        : normalizeBlocker(hardBlockers[0]);
      firstFailure ??= {
        ok: false,
        code: blocker.code,
        message: blocker.message,
        blockers: [blocker],
        data: {
          chain_index: index,
          plugin_name: installed.name,
          plugin_id: plan.plugin?.id ?? null,
          requested_controls: Object.keys(node.controls ?? {}),
          semantic_fields: semanticFields,
        },
      };
      continue;
    }

    const controlIds = plan.hydration_flow?.wanted_controls
      ?? plan.customer_readback?.requested_controls?.map((item) => item.control)
      ?? Object.keys(node.controls ?? {});
    prepared.semantic = { pluginId: plan.plugin.id, controlIds };
    const proof = semanticProofChecker(plan.plugin.id, controlIds);
    if (!proof.ok) {
      const message = proof.message
        ?? `Semantic unit conversion is unproven for ${plan.plugin.id}: ${(proof.unproven ?? controlIds).join(", ")}.`;
      firstFailure ??= {
        ok: false,
        code: STOCK_SEMANTIC_UNIT_UNPROVEN,
        message,
        blockers: [codedBlocker(STOCK_SEMANTIC_UNIT_UNPROVEN, message)],
        data: {
          chain_index: index,
          plugin_name: installed.name,
          plugin_id: plan.plugin.id,
          unproven_controls: proof.unproven ?? controlIds,
          semantic_fields: semanticFields,
        },
      };
    }
  }
  return firstFailure ?? { ok: true };
}

function hasFxChainSemanticIntent(node) {
  return ["controls", "starter_action", "action_parameters", "control_overrides"]
    .some((field) => Object.hasOwn(node, field));
}

function requestedFxChainSemanticFields(node) {
  return ["controls", "starter_action", "action_parameters", "control_overrides"]
    .filter((field) => Object.hasOwn(node, field));
}

async function resolveExactFxObject({ fxRef, owner, preferredSlot, request, executeAtomic, state }) {
  let slotIndex = preferredSlot;
  if (!Number.isInteger(slotIndex)) {
    const parsed = Number(String(fxRef).slice(String(fxRef).lastIndexOf(":") + 1));
    slotIndex = Number.isInteger(parsed) ? parsed : null;
  }
  if (!Number.isInteger(slotIndex)) {
    throw coded("FX_CHAIN_SLOT_IDENTITY_MISSING", `No exact live slot is available for ${fxRef}.`);
  }
  const execution = await executeFxAtomic({
    id: "template.fx.resolve_fx_ref",
    input: { owner_kind: owner.ownerKind, slot_index: slotIndex },
    refs: owner.refs,
    request,
    executeAtomic,
    state,
  });
  const resolvedRef = firstRef(execution, "fx:");
  const resolvedObject = objectRefs(execution).find((entry) => entry.kind === "fx" && entry.ref === resolvedRef) ?? null;
  if (resolvedRef !== fxRef || !resolvedObject) {
    throw coded("FX_CHAIN_IDENTITY_MISMATCH", `The live FX resolver returned ${resolvedRef ?? "no ref"} instead of ${fxRef}.`);
  }
  return resolvedObject;
}

async function executeFxAtomic({ id, input, refs, request, executeAtomic, state, write = false, budget }) {
  const execution = await executeAtomic({
    id,
    input,
    refs,
    context: request.context,
    budget: budget ?? request.budget,
    observeProjectIndex: false,
  });
  collectAtomic(state, execution);
  if (execution?.ok !== true) throw childError(id, execution);
  if (write) requireWriteVerification(id, execution);
  return execution;
}

function requireCompleteFxChain(execution, label) {
  const readback = executionReadback(execution);
  const rows = Array.isArray(readback.fx) ? readback.fx : [];
  if (readback.truncated === true || Number(readback.fx_count) !== rows.length) {
    throw coded(
      "FX_CHAIN_COVERAGE_INCOMPLETE",
      `The ${label} FX chain readback is incomplete (${rows.length}/${readback.fx_count ?? "unknown"}); no definitive chain result is allowed.`,
    );
  }
  return { ...readback, fx: rows };
}

function matchFinalFxRow(rows, operation, orderedCursor) {
  if (Number.isInteger(operation.node.target_index)) {
    const row = rows.find((entry) => entry.slot_index === operation.node.target_index && fxNamesEqual(entry.name, operation.installedName));
    return { row: row ?? null };
  }
  if (Number.isInteger(operation.preferredSlot)) {
    const preferred = rows.find((entry) => entry.slot_index === operation.preferredSlot && fxNamesEqual(entry.name, operation.installedName));
    if (preferred) return { row: preferred };
  }
  return {
    row: rows.find((entry) => entry.slot_index >= orderedCursor && fxNamesEqual(entry.name, operation.installedName)) ?? null,
  };
}

function compactFxChain(chain) {
  return {
    owner_kind: chain.owner_kind ?? null,
    owner_ref: chain.owner_ref ?? null,
    fx_count: chain.fx_count ?? chain.fx.length,
    truncated: chain.truncated === true,
    fx: chain.fx.map((row) => ({
      fx_ref: row.fx_ref ?? null,
      slot_index: row.slot_index ?? null,
      name: row.name ?? null,
      enabled: row.enabled ?? null,
      parameter_count: row.parameter_count ?? null,
    })),
  };
}

function executionReadback(execution) {
  return object(execution?.result?.readback)
    ? execution.result.readback
    : object(execution?.result?.summary)
      ? execution.result.summary
      : {};
}

function normalizeFxName(value) {
  return String(value ?? "").trim().toLocaleLowerCase();
}

function fxNamesEqual(left, right) {
  return normalizeFxName(left) === normalizeFxName(right);
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
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
    if (rows.length > 1) {
      const candidates = boundedTrackCandidates(rows);
      const truncated = response.result?.data?.page?.has_more === true;
      const message = `The bounded selector matched ${truncated ? "at least " : ""}${rows.length} tracks; choose one canonical track_ref patch.`;
      return blocked("NATIVE_FX_TRACK_AMBIGUOUS", message, [codedBlocker("NATIVE_FX_TRACK_AMBIGUOUS", message, true, {
        entity: "tracks",
        candidate_count: candidates.length,
        candidates_truncated: truncated,
        candidates,
      })]);
    }
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

function validateTrackOwnedActiveTakeBinding(input, request) {
  if (input.dry_run !== false) {
    return codedBlocker("FX_SET_MUTATION_CONFIRMATION_REQUIRED", "FX-set creation requires explicit dry_run=false; use the owning read paths for analysis-only work.");
  }
  if (input.owner_kind !== "take") {
    return codedBlocker("FX_SET_OWNER_KIND_INVALID", "Track-owned active-Take fanout requires owner_kind=take.");
  }
  if (!Array.isArray(input.chain) || input.chain.length !== 1) {
    return codedBlocker("FX_SET_CHAIN_SIZE_INVALID", "Track-owned active-Take fanout requires exactly one chain node.");
  }
  const node = input.chain[0];
  if (!object(node) || node.duplicate_policy !== "reuse_exact") {
    return codedBlocker("FX_SET_DUPLICATE_POLICY_INVALID", "The homogeneous Take-FX set requires duplicate_policy=reuse_exact.");
  }
  const unsupportedNodeField = [
    "insert_at_index",
    "preset_name",
    "preset_index",
    "enabled",
    "target_index",
    "controls",
    "starter_action",
    "action_parameters",
    "control_overrides",
  ].find((field) => Object.hasOwn(node, field));
  if (unsupportedNodeField) {
    return codedBlocker(
      "FX_SET_CHAIN_NODE_FIELD_UNSUPPORTED",
      `Track-owned active-Take fanout does not accept chain[0].${unsupportedNodeField}; create the set first, then use inspect_set and shared_plan.`,
    );
  }
  const binding = input.target_binding;
  const allowed = new Set(["bind_at", "domain", "selector", "owner", "aggregation", "cardinality"]);
  const unknown = Object.keys(binding).find((field) => !allowed.has(field));
  if (unknown) return codedBlocker("FX_SET_TARGET_BINDING_INVALID", `Unsupported target_binding field: ${unknown}.`);
  if (binding.bind_at !== "execution"
      || binding.domain !== "takes"
      || binding.selector !== "active_take_of_items"
      || binding.aggregation !== "batch") {
    return codedBlocker(
      "FX_SET_TARGET_BINDING_INVALID",
      "The first FX-set slice accepts bind_at=execution, domain=takes, selector=active_take_of_items, aggregation=batch.",
    );
  }
  if (!object(binding.owner)
      || binding.owner.domain !== "tracks"
      || binding.owner.selector !== "explicit_refs"
      || binding.owner.items !== "all"
      || Object.keys(binding.owner).some((field) => !["domain", "selector", "items"].includes(field))) {
    return codedBlocker(
      "FX_SET_TARGET_OWNER_INVALID",
      "target_binding.owner must be exactly {domain:\"tracks\", selector:\"explicit_refs\", items:\"all\"}.",
    );
  }
  if (!object(binding.cardinality)
      || binding.cardinality.minimum !== 1
      || binding.cardinality.maximum !== 64
      || Object.keys(binding.cardinality).some((field) => !["minimum", "maximum"].includes(field))) {
    return codedBlocker("FX_SET_CARDINALITY_INVALID", "target_binding.cardinality must be exactly minimum=1 and maximum=64.");
  }
  const refs = normalizeNamedRefs(request.refs);
  if (refs.take_ref) {
    return codedBlocker("FX_SET_TAKE_REF_CONFLICT", "Track-owned active-Take fanout accepts one Track target, not an exact Take ref.");
  }
  return null;
}

function validateFxSetAuthority(authority) {
  if (typeof authority?.bridge_owner !== "string" || authority.bridge_owner.length === 0) {
    return codedBlocker("FX_SET_BRIDGE_OWNER_REQUIRED", "FX-set creation requires the current authoritative Bridge owner before mutation.");
  }
  if (!Number.isSafeInteger(authority.bridge_generation) || authority.bridge_generation < 0) {
    return codedBlocker("FX_SET_BRIDGE_GENERATION_REQUIRED", "FX-set creation requires the current authoritative Bridge generation before mutation.");
  }
  if (typeof authority.project_ref !== "string" || authority.project_ref.length === 0) {
    return codedBlocker("FX_SET_PROJECT_REF_REQUIRED", "FX-set creation requires the current Project Index project_ref before mutation.");
  }
  return null;
}

function normalizeTrackTakeFxSetReadback({ readback, expectedTrackRef, expectedPluginName, dryRun }) {
  const value = object(readback?.fx_set) ? readback.fx_set : readback;
  const members = Array.isArray(value?.members) ? value.members : [];
  const memberCount = Number(value?.member_count);
  if (value?.track_ref !== expectedTrackRef) {
    return failedFxSetReadback("FX_SET_TRACK_READBACK_MISMATCH", "Native FX-set readback did not preserve the exact target Track identity.");
  }
  if (!Number.isInteger(memberCount) || memberCount < 1 || memberCount > 64 || memberCount !== members.length) {
    return failedFxSetReadback("FX_SET_MEMBER_COVERAGE_INVALID", "Native FX-set readback must contain every one of 1-64 active Take members.");
  }
  if (dryRun && value?.zero_write !== true) {
    return failedFxSetReadback("FX_SET_DRY_RUN_ZERO_WRITE_UNPROVEN", "FX-set dry_run did not return typed zero-write truth.");
  }
  const pluginIdentity = object(value?.plugin_identity) ? clone(value.plugin_identity) : null;
  const layoutFingerprint = value?.layout_fingerprint;
  if (!pluginIdentity
      || typeof pluginIdentity.plugin_id !== "string"
      || pluginIdentity.plugin_id.length === 0
      || typeof pluginIdentity.name !== "string"
      || !fxNamesEqual(pluginIdentity.name, expectedPluginName)
      || typeof layoutFingerprint !== "string"
      || layoutFingerprint.length === 0) {
    return failedFxSetReadback("FX_SET_HOMOGENEITY_UNPROVEN", "Native FX-set readback did not prove one exact plug-in identity and parameter-layout fingerprint.");
  }

  const normalizedMembers = [];
  const takeRefs = new Set();
  const fxRefs = new Set();
  let createdCount = 0;
  let reusedCount = 0;
  for (const [index, member] of members.entries()) {
    const valid = object(member)
      && typeof member.item_ref === "string" && member.item_ref.startsWith("item:guid:")
      && typeof member.take_ref === "string" && member.take_ref.startsWith("take:guid:")
      && typeof member.fx_ref === "string" && member.fx_ref.startsWith("fx:take:guid:")
      && typeof member.fx_guid === "string" && member.fx_guid.length > 0
      && member.track_ref === expectedTrackRef
      && member.plugin_id === pluginIdentity.plugin_id
      && member.layout_fingerprint === layoutFingerprint
      && Number.isInteger(member.parameter_count) && member.parameter_count >= 0
      && ["created", "reused", "planned_create", "planned_reuse"].includes(member.status);
    if (!valid || takeRefs.has(member?.take_ref) || fxRefs.has(member?.fx_ref)) {
      return failedFxSetReadback("FX_SET_MEMBER_IDENTITY_INVALID", `Native FX-set member ${index} lacks unique exact owner/FX/layout truth.`);
    }
    takeRefs.add(member.take_ref);
    fxRefs.add(member.fx_ref);
    if (member.status === "created") createdCount += 1;
    if (member.status === "reused") reusedCount += 1;
    normalizedMembers.push({
      track_ref: member.track_ref,
      item_ref: member.item_ref,
      take_ref: member.take_ref,
      fx_ref: member.fx_ref,
      fx_guid: member.fx_guid,
      plugin_id: member.plugin_id,
      parameter_count: member.parameter_count,
      layout_fingerprint: member.layout_fingerprint,
      status: member.status,
    });
  }
  if (!dryRun && createdCount + reusedCount !== normalizedMembers.length) {
    return failedFxSetReadback("FX_SET_MUTATION_TRUTH_INCOMPLETE", "Native FX-set mutation readback did not classify every member as created or reused.");
  }
  const representativeFxRef = value?.representative_fx_ref ?? normalizedMembers[0]?.fx_ref ?? null;
  if (!fxRefs.has(representativeFxRef)) {
    return failedFxSetReadback("FX_SET_REPRESENTATIVE_INVALID", "The representative FX ref is not a member of the verified FX set.");
  }
  return {
    ok: true,
    members: normalizedMembers,
    plugin_identity: pluginIdentity,
    layout_fingerprint: layoutFingerprint,
    representative_fx_ref: representativeFxRef,
    project_instance_id: typeof value?.project_instance_id === "string" ? value.project_instance_id : null,
    created_count: createdCount,
    reused_count: reusedCount,
  };
}

function failedFxSetReadback(code, message) {
  return { ok: false, code, message, blockers: [codedBlocker(code, message)] };
}

function validateInput(input, request) {
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return codedBlocker("NATIVE_FX_INPUT_FIELD_UNSUPPORTED", `Unsupported native FX input field: ${unknown[0]}.`);
  if (request.idempotency_key !== undefined) return codedBlocker("NATIVE_FX_IDEMPOTENCY_UNSUPPORTED", "Adding a new FX instance is non-idempotent; omit idempotency_key.");
  if (input.chain !== undefined) {
    if (!Array.isArray(input.chain) || input.chain.length < 1 || input.chain.length > CHAIN_MAX_NODES) {
      return codedBlocker("FX_CHAIN_NODES_INVALID", `chain must contain 1 through ${CHAIN_MAX_NODES} FX nodes.`);
    }
    if (input.owner_kind !== undefined && !["track", "take"].includes(input.owner_kind)) {
      return codedBlocker("FX_CHAIN_OWNER_KIND_INVALID", "owner_kind must be track or take.");
    }
    for (let index = 0; index < input.chain.length; index += 1) {
      const node = input.chain[index];
      if (!object(node)) return codedBlocker("FX_CHAIN_NODE_INVALID", `chain[${index}] must be an object.`);
      const nodeUnknown = Object.keys(node).filter((field) => !CHAIN_NODE_FIELDS.has(field));
      if (nodeUnknown.length > 0) return codedBlocker("FX_CHAIN_NODE_FIELD_UNSUPPORTED", `Unsupported chain[${index}] field: ${nodeUnknown[0]}.`);
      const hasName = typeof node.plugin_name === "string" && node.plugin_name.trim().length > 0;
      const hasQuery = typeof node.plugin_query === "string" && node.plugin_query.trim().length > 0;
      if (hasName === hasQuery) return codedBlocker("FX_CHAIN_PLUGIN_SELECTOR_INVALID", `chain[${index}] requires exactly one non-empty plugin_name or plugin_query.`);
      if (node.duplicate_policy !== undefined && !DUPLICATE_POLICIES.has(node.duplicate_policy)) {
        return codedBlocker("FX_CHAIN_DUPLICATE_POLICY_INVALID", `chain[${index}].duplicate_policy must be allow, reuse_exact, skip_exact, or fail_if_present.`);
      }
      for (const field of ["insert_at_index", "target_index", "preset_index"]) {
        if (node[field] !== undefined && (!Number.isInteger(node[field]) || node[field] < 0 || node[field] > 127)) {
          return codedBlocker("FX_CHAIN_INDEX_INVALID", `chain[${index}].${field} must be an integer from 0 through 127.`);
        }
      }
      if (node.preset_name !== undefined && (typeof node.preset_name !== "string" || node.preset_name.trim().length === 0)) {
        return codedBlocker("FX_CHAIN_PRESET_NAME_INVALID", `chain[${index}].preset_name must be a non-empty string.`);
      }
      if (node.preset_name !== undefined && node.preset_index !== undefined) {
        return codedBlocker("FX_CHAIN_PRESET_SELECTOR_CONFLICT", `chain[${index}] must not supply both preset_name and preset_index.`);
      }
      if (node.enabled !== undefined && typeof node.enabled !== "boolean") {
        return codedBlocker("FX_CHAIN_ENABLED_INVALID", `chain[${index}].enabled must be boolean.`);
      }
      for (const field of ["controls", "action_parameters", "control_overrides"]) {
        if (node[field] !== undefined && !object(node[field])) {
          return codedBlocker("FX_CHAIN_SEMANTIC_FIELD_INVALID", `chain[${index}].${field} must be an object.`);
        }
      }
      if (node.starter_action !== undefined
          && (typeof node.starter_action !== "string" || node.starter_action.trim().length === 0)) {
        return codedBlocker("FX_CHAIN_STARTER_ACTION_INVALID", `chain[${index}].starter_action must be a non-empty string.`);
      }
    }
    const legacyFields = ["plugin", "controls", "starter_action", "action_parameters", "control_overrides", "insert_at_index"];
    const conflict = legacyFields.find((field) => input[field] !== undefined);
    if (conflict) return codedBlocker("FX_CHAIN_LEGACY_INPUT_CONFLICT", `Top-level ${conflict} cannot be combined with chain[].`);
    return null;
  }
  if (input.plugin !== undefined && input.plugin !== "reacomp") return codedBlocker("NATIVE_FX_PLUGIN_NOT_ACCEPTED", "Alpha3.2.5-D currently adds only plugin=reacomp.");
  for (const field of ["controls", "action_parameters", "control_overrides"]) {
    if (Object.hasOwn(input, field) && !object(input[field])) {
      return codedBlocker("NATIVE_FX_SEMANTIC_FIELD_INVALID", `${field} must be an object.`);
    }
  }
  if (Object.hasOwn(input, "starter_action")
      && (typeof input.starter_action !== "string" || input.starter_action.trim().length === 0)) {
    return codedBlocker("NATIVE_FX_STARTER_ACTION_INVALID", "starter_action must be a non-empty string.");
  }
  if (input.starter_action !== undefined && input.starter_action !== DEFAULT_STARTER_ACTION) return codedBlocker("NATIVE_FX_STARTER_NOT_ACCEPTED", `Alpha3.2.5-D currently accepts only starter_action=${DEFAULT_STARTER_ACTION}.`);
  if (input.insert_at_index !== undefined && (!Number.isInteger(input.insert_at_index) || input.insert_at_index < 0 || input.insert_at_index > 127)) {
    return codedBlocker("NATIVE_FX_INSERT_INDEX_INVALID", "insert_at_index must be an integer from 0 through 127.");
  }
  return null;
}

function normalizeStockInput(input) {
  const hasExplicitSemanticInput = ["controls", "starter_action", "action_parameters", "control_overrides"]
    .some((field) => Object.hasOwn(input, field));
  return pruneUndefined({
    plugin: "reacomp",
    controls: input.controls,
    starter_action: input.starter_action ?? (hasExplicitSemanticInput ? undefined : DEFAULT_STARTER_ACTION),
    action_parameters: input.action_parameters,
    control_overrides: input.control_overrides,
  });
}

function createLegacyReaCompRecoveryCall({ request, input }) {
  const refs = normalizeNamedRefs(request.refs);
  return {
    tool: "call_template",
    arguments: {
      id: "macro.fx.apply_chain",
      input: pruneUndefined({
        owner_kind: "track",
        chain: [pruneUndefined({
          plugin_query: "ReaComp",
          duplicate_policy: "allow",
          insert_at_index: input.insert_at_index,
        })],
        selector: input.selector,
        dry_run: false,
      }),
      ...(Object.keys(refs).length > 0 ? { refs } : {}),
    },
    instruction: "This adds ReaComp without semantic parameter writes. Use the returned real fx_ref to list parameters and continue through macro.fx.set_controls mode=exact_parameters.",
  };
}

function createChainSemanticRecoveryCall({ request, input }) {
  const refs = normalizeNamedRefs(request.refs);
  return {
    tool: "call_template",
    arguments: {
      id: "macro.fx.apply_chain",
      input: pruneUndefined({
        owner_kind: input.owner_kind,
        chain: input.chain.map((node) => pruneUndefined({
          plugin_name: node.plugin_name,
          plugin_query: node.plugin_query,
          duplicate_policy: node.duplicate_policy,
          insert_at_index: node.insert_at_index,
          preset_name: node.preset_name,
          preset_index: node.preset_index,
          enabled: node.enabled,
          target_index: node.target_index,
        })),
        selector: input.selector,
        dry_run: false,
      }),
      ...(Object.keys(refs).length > 0 ? { refs } : {}),
    },
    instruction: "This applies the installed chain without semantic parameter writes. Use each returned real fx_ref to list parameters and continue through macro.fx.set_controls mode=exact_parameters.",
  };
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

function failure({
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
  details,
  data = {},
  recoveryAction,
  recoveryNextCall,
}) {
  const normalized = boundedBlockers(blockers.length > 0 ? blockers : [codedBlocker(code, message)]);
  const verifiedByLiveReadback = state.changes.length > 0
    && state.changes.every((change) => change.live_readback?.status === "passed");
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
      verification: { status: verifiedByLiveReadback ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: verifiedByLiveReadback || status === "partial_failure" ? unique(state.evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) : [] },
      artifact_refs: unique(state.artifactRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data: compactData(data),
    },
    blockers: normalized,
    error: {
      code: code ?? normalized[0]?.code ?? "NATIVE_FX_EXECUTION_FAILED",
      message,
      recoverable: normalized.every((item) => item.recoverable !== false),
      ...(object(details) ? { details: clone(details) } : {}),
    },
    recovery: {
      partial_changes_possible: status === "partial_failure",
      undo_policy: entry.undo_policy,
      sqlite_rows_authorize_writes: false,
      action: recoveryAction ?? (status === "partial_failure"
        ? "Inspect the created FX and stage evidence, use per-stage undo if needed, refresh the FX index scope, then retry only the remaining task."
        : "Resolve the typed blocker, then retry the same registered Macro."),
      ...(recoveryNextCall ? { next_call: clone(recoveryNextCall) } : {}),
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
  state.changes.push(...clone(envelope?.result?.changes ?? []));
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
    const result = {};
    for (const entry of value) {
      const ref = typeof entry === "string" ? entry : entry?.ref;
      if (typeof ref !== "string") continue;
      if (ref.startsWith("track:") && !result.track_ref) result.track_ref = ref;
      if (ref.startsWith("take:") && !result.take_ref) result.take_ref = ref;
    }
    return result;
  }
  if (!object(value)) return {};
  const result = {};
  for (const [field, prefix] of [["track_ref", "track:"], ["take_ref", "take:"]]) {
    const raw = value[field];
    const ref = typeof raw === "string" ? raw : raw?.ref;
    if (typeof ref === "string" && ref.startsWith(prefix)) result[field] = ref;
  }
  return result;
}

function exactGuidObjectRef(kind, ref) {
  if (typeof ref !== "string" || !ref.startsWith(`${kind}:guid:`)) return null;
  const value = ref.slice(`${kind}:guid:`.length);
  if (value.length === 0) return null;
  return { kind, ref, identity: { scheme: "guid", value } };
}

function invalidateFxScope(runtime, now) {
  if (!runtime || typeof runtime.invalidateScopes !== "function") return null;
  return runtime.invalidateScopes({ scopes: ["fx"], reason: "macro.fx.apply_chain", observed_at: safeNowIso(now) });
}

function applyFxIndexMaintenance(changes, status, invalidation) {
  for (const change of changes) {
    change.index_maintenance = {
      status,
      scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : status === "completed" ? ["fx"] : [],
      blocker_code: invalidation?.blockers?.[0]?.code ?? null,
    };
  }
}

function fxOutcome(state) {
  const changes = state.changes ?? [];
  const readbackPassed = changes.filter((change) => change.live_readback?.status === "passed").length;
  const indexStatuses = [...new Set(changes.map((change) => change.index_maintenance?.status).filter(Boolean))];
  return {
    mutation: {
      status: changes.some((change) => change.mutation?.status === "completed") ? "completed" : "not_run",
      completed_count: changes.filter((change) => change.mutation?.status === "completed").length,
    },
    live_readback: {
      status: changes.length > 0 && readbackPassed === changes.length ? "passed" : readbackPassed > 0 ? "partial" : "not_passed",
      passed_count: readbackPassed,
      total_count: changes.length,
    },
    index_maintenance: {
      status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run",
      blocker_code: changes.find((change) => change.index_maintenance?.blocker_code)?.index_maintenance.blocker_code ?? null,
    },
  };
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
  const bridgeCode = execution?.error?.code ?? "NATIVE_FX_ATOMIC_FAILED";
  const bridgeDetails = execution?.error?.details;
  const reasonCode = bridgeCode === "PARAMS_INVALID" && typeof bridgeDetails?.reason_code === "string"
    ? bridgeDetails.reason_code
    : null;
  const code = FX_SET_REASON_CODE_ALLOWLIST.has(reasonCode) ? reasonCode : bridgeCode;
  return coded(
    code,
    execution?.error?.message ?? `${id} failed through the managed atomic route.`,
    bridgeDetails?.blockers,
    FX_SET_REASON_CODE_ALLOWLIST.has(reasonCode) ? boundedFxSetFailureDetails(bridgeDetails) : undefined,
  );
}

function coded(code, message, blockers, details) {
  const error = new Error(message);
  error.code = code;
  error.blockers = blockers;
  if (object(details)) error.details = details;
  return error;
}

function boundedFxSetFailureDetails(value) {
  if (!object(value)) return null;
  const result = {};
  for (const field of ["reason_code", "zero_write", "target_count", "minimum", "maximum"]) {
    const entry = value[field];
    if (typeof entry === "string" || typeof entry === "boolean" || Number.isInteger(entry)) result[field] = entry;
  }
  return result;
}

function codedBlocker(code, message, recoverable = true, details) {
  return { code, message, recoverable, ...(boundedTrackCandidateDetails(details) ? { details: boundedTrackCandidateDetails(details) } : {}) };
}

function normalizeBlocker(value) {
  if (!object(value)) return codedBlocker("NATIVE_FX_BLOCKED", String(value));
  return codedBlocker(value.code ?? "NATIVE_FX_BLOCKED", value.message ?? "The native FX task is blocked.", value.recoverable !== false, value.details);
}

function boundedTrackCandidates(rows) {
  return rows.slice(0, 3).flatMap((row) => {
    const ref = row?.ref ?? row?.track_ref;
    if (typeof ref !== "string" || !ref.startsWith("track:")) return [];
    return [{
      kind: "track",
      ref,
      ...(typeof row.name === "string" ? { name: row.name } : {}),
      ...(Number.isInteger(row.index) ? { index: row.index } : {}),
      request_patch: { refs: { track_ref: ref } },
    }];
  });
}

function boundedTrackCandidateDetails(value) {
  if (!object(value) || !Array.isArray(value.candidates)) return null;
  const candidates = value.candidates.slice(0, 3).flatMap((candidate) => {
    const ref = candidate?.ref;
    if (typeof ref !== "string" || !ref.startsWith("track:") || ref.length > 240) return [];
    return [{
      kind: "track",
      ref,
      ...(typeof candidate.name === "string" ? { name: candidate.name.slice(0, 240) } : {}),
      ...(Number.isInteger(candidate.index) ? { index: candidate.index } : {}),
      request_patch: { refs: { track_ref: ref } },
    }];
  });
  return {
    entity: "tracks",
    candidate_count: candidates.length,
    candidates_truncated: value.candidates_truncated === true,
    candidates,
  };
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
