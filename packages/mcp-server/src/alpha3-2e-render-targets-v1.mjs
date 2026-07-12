export const ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT = "alpha3.2e.render_targets_macro.v1";
export const ALPHA3_2E_RENDER_TARGETS_MACRO_ID = "macro.render.targets";
export const ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION = "1.0.0";

import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_2E_RENDER_TARGET_KINDS = Object.freeze([
  "whole_project",
  "time_selection",
  "regions",
  "selected_items",
  "explicit_items",
  "selected_tracks",
  "explicit_tracks",
]);
export const ALPHA3_2E_RENDER_FORMATS = Object.freeze(["wav", "ogg"]);
export const ALPHA3_2E_RENDER_SAMPLE_RATES = Object.freeze([44_100, 48_000]);
export const ALPHA3_2E_RENDER_CHANNEL_COUNTS = Object.freeze([1, 2]);
export const ALPHA3_2E_RENDER_WAV_BIT_DEPTHS = Object.freeze([16, 24]);
export const ALPHA3_2E_RENDER_OGG_QUALITIES = Object.freeze([0.3, 0.5, 0.6, 0.8, 1.0]);
export const ALPHA3_2E_RENDER_MAX_TARGETS = 16;

const ALLOWED_INPUT_FIELDS = new Set([
  "target_kind",
  "format",
  "refs",
  "region_refs",
  "item_refs",
  "track_refs",
  "sample_rate_hz",
  "channel_count",
  "wav_bit_depth",
  "ogg_quality",
  "output_policy",
  "collision_policy",
  "max_targets",
  "dry_run",
  "compact_response",
]);
const FORBIDDEN_INPUT_FIELDS = new Set([
  "output_path",
  "output_absolute_path",
  "output_root",
  "overwrite",
  "encoder",
  "external_encoder",
  "command",
  "shell",
  "lua",
  "action",
  "call_recipe",
  "executor",
]);
const REF_KINDS = Object.freeze(["regions", "items", "tracks"]);
const REF_PREFIXES = Object.freeze({ regions: "region:", items: "item:", tracks: "track:" });
const UNKNOWN_FIELD_DETAIL_LIMIT = 12;
const MAX_REF_BYTES = 256;
const LIVE_EVIDENCE_BLOCKER = null;
const RENDER_TEMPLATE_ID = "template.render.render_targets";
const DIRTY_STATE_TEMPLATE_ID = "template.project.read_dirty_state";
const TRACK_RESOLVER_ID = "template.tracks.resolve_track_ref";
const ITEM_RESOLVER_ID = "template.items.resolve_item_ref";
const MARKER_REGION_RESOLVER_ID = "template.project.list_markers_regions";
const RENDER_TEMPLATE_IDS = Object.freeze([
  RENDER_TEMPLATE_ID,
  DIRTY_STATE_TEMPLATE_ID,
  TRACK_RESOLVER_ID,
  ITEM_RESOLVER_ID,
  MARKER_REGION_RESOLVER_ID,
]);
const RENDER_STAGE_IDS = new Set([
  "render-selector-resolve",
  "render-live-ref-resolve",
  "render-dirty-before",
  "render-template-execute",
  "render-dirty-after",
  "render-result-project",
]);

export const ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY = createMacroProgramRegistry([{
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
  program_id: "openreaper.macro.render.targets",
  program_version: ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION,
  implementation_status: "executable",
  risk: "write",
  input_schema: { type: "object", additionalProperties: false },
  selector_policy: { task_shaped: true, canonical_refs_optional_at_public_boundary: true, live_reresolve_before_write: true },
  sqlite_policy: { mode: "not_used", write_authority: false, identity_fields: [] },
  dependencies: { template_ids: RENDER_TEMPLATE_IDS, runtime_capabilities: [] },
  stages: [
    { id: "render-selector-resolve", kind: "selector_resolve", risk: "read", stop_on_error: true },
    { id: "render-live-ref-resolve", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "render-dirty-before", kind: "template_execute", dependency_ref: DIRTY_STATE_TEMPLATE_ID, risk: "read", stop_on_error: true },
    { id: "render-template-execute", kind: "template_execute", dependency_ref: RENDER_TEMPLATE_ID, risk: "write", stop_on_error: true },
    { id: "render-dirty-after", kind: "template_execute", dependency_ref: DIRTY_STATE_TEMPLATE_ID, risk: "read", stop_on_error: true },
    { id: "render-result-project", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "single_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: 65_536 },
}], { acceptedTemplateIds: RENDER_TEMPLATE_IDS, registeredStageIds: RENDER_STAGE_IDS });

export const ALPHA3_2_5_C_RENDER_REGISTRY = ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY;

export function isAlpha3_2ERenderTargetsMacroId(id) {
  return id === ALPHA3_2E_RENDER_TARGETS_MACRO_ID;
}

export function planAlpha3_2ERenderTargetsMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = validateInput(input, normalized);
  if (requestPosture.idempotency_key_present === true) {
    blockers.push(blocker(
      "RENDER_IDEMPOTENCY_KEY_UNSUPPORTED",
      "macro.render.targets does not accept idempotency_key because the audited render route is non-idempotent.",
    ));
  }
  const sourceRefs = normalizeRefs(normalized, requestPosture, normalized.target_kind);
  blockers.push(...sourceRefs.blockers);
  blockers.push(...validateTargetRefs(normalized.target_kind, sourceRefs.refs));

  const settingsResult = normalizeSettings(normalized);
  blockers.push(...settingsResult.blockers);
  const settings = settingsResult.settings;
  const targetKind = normalized.target_kind;
  const targetRefs = refsForTargetKind(targetKind, sourceRefs.refs);
  const preview = buildPreview({ targetKind, targetRefs, refs: sourceRefs.refs, settings });
  if (["regions", "explicit_items", "explicit_tracks"].includes(targetKind) && targetRefs.length > settings.max_targets) {
    blockers.push(blocker("RENDER_MAX_TARGETS_EXCEEDED", `Resolved target refs exceed max_targets (${settings.max_targets}).`, { count: targetRefs.length, max_targets: settings.max_targets }));
  }
  const dryRun = normalized.dry_run !== false;

  if (blockers.length > 0) return blockedPlan(blockers, preview, dryRun);
  if (dryRun) return dryRunPlan(preview);

  const preflightRequests = [];
  const mutationRequests = [buildMutationRequest(preview)];
  const readbackRequests = [];
  const childRequests = [...mutationRequests];
  return deepFreeze({
    contract: ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    dry_run: false,
    preview,
    preflight_requests: preflightRequests,
    mutation_requests: mutationRequests,
    readback_requests: readbackRequests,
    child_requests: childRequests,
    success_criteria: successCriteriaFor(preview),
    agent_execution_flow: agentExecutionFlow(preview),
    blockers: [],
    typed_blockers: [],
    runtime_binding: "bound_plan_only_child_route",
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

export function createAlpha3_2ERenderTargetsMacroRuntimeEnvelope({ request = {}, plan, executeAtomic, projectIndexRuntime, managedRenderRoot = null, now = () => new Date() } = {}) {
  if (typeof executeAtomic === "function") return executeAlpha3_2_5CRenderTargetsMacro({ request, executeAtomic, projectIndexRuntime, managedRenderRoot, now });
  const normalizedPlan = plan ?? planAlpha3_2ERenderTargetsMacro(
    request.input ?? {},
    requestPosture(request),
  );
  const envelope = {
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: { id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID, pack: "render", risk: "write" },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT,
      action_kind: "macro",
      mode: normalizedPlan.mode,
      executed: false,
      plan: normalizedPlan,
      dry_run: normalizedPlan.dry_run,
      preview: normalizedPlan.preview,
      preflight_requests: normalizedPlan.preflight_requests,
      mutation_requests: normalizedPlan.mutation_requests,
      readback_requests: normalizedPlan.readback_requests,
      child_requests: normalizedPlan.child_requests,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      typed_blockers: normalizedPlan.typed_blockers,
      runtime_binding: normalizedPlan.runtime_binding ?? "pending_lower_layer_runtime_dispatch",
      no_executor_safety_posture: normalizedPlan.no_executor_safety_posture,
      execution: {
        executed: false,
        executor_call_count: 0,
        reason: "macro.render.targets only returns a plan; the server never dispatches render children or invokes REAPER.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_action_lua_shell_ui: false,
        bridge_request_created: false,
        live_reaper_called: false,
        external_encoder_called: false,
        output_overwritten: false,
      },
      safety: normalizedPlan.safety,
    },
    budget: { max_response_bytes: 65_536, response_bytes: 0 },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope));
  return deepFreeze(envelope);
}

export async function executeAlpha3_2_5CRenderTargetsMacro({ request = {}, executeAtomic, projectIndexRuntime, managedRenderRoot = null, now = () => new Date() } = {}) {
  const entry = ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY.get(ALPHA3_2E_RENDER_TARGETS_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = isPlainObject(request.input) ? request.input : {};
  const validation = validateMacroProgramRequest({ macro_id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID, input, refs: request.refs, dry_run: input.dry_run !== false }, { registry: ALPHA3_2_5_C_RENDER_TARGETS_REGISTRY });
  const plan = planAlpha3_2ERenderTargetsMacro(input, { refs: request.refs, idempotency_key_present: request.idempotency_key !== undefined });
  const managedRoot = normalizeManagedRenderRoot(managedRenderRoot);
  if (!validation.valid || !plan.ok) return renderEnvelope({ entry, request, startedAt, now, status: "blocked", stages: [], blockers: plan.blockers.length > 0 ? plan.blockers : validation.errors.map((message) => blocker("RENDER_REQUEST_INVALID", message)), summary: "Render-target Macro input was blocked.", data: { preview: plan.preview ?? null } });
  if (!managedRoot) return renderEnvelope({ entry, request, startedAt, now, status: "blocked", stages: [], blockers: [blocker("RENDER_MANAGED_ROOT_UNAVAILABLE", "The installed managed render root is unavailable; start a fresh OpenReaper session before rendering.")], summary: "Render-target Macro needs the installed managed render root.", data: { preview: plan.preview ?? null } });
  if (typeof executeAtomic !== "function") {
    return renderEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "blocked",
      stages: [],
      blockers: [blocker("RENDER_EXECUTOR_UNAVAILABLE", "The managed OpenReaper atomic executor is unavailable.")],
      summary: "Render-target Macro needs the managed OpenReaper atomic route.",
      data: { preview: plan.preview ?? null },
    });
  }
  const stages = [{ id: "render-selector-resolve", kind: "selector_resolve", status: "completed", summary: "Resolved bounded canonical or live-selection target posture.", evidence_refs: [] }];
  if (input.dry_run !== false) {
    stages.push({ id: "render-live-ref-resolve", kind: "live_ref_resolve", status: "skipped", summary: "Live target resolution is deferred until an executable render run.", evidence_refs: [] });
    stages.push({ id: "render-dirty-before", kind: "template_execute", status: "skipped", summary: "Dirty-state read skipped during dry_run.", evidence_refs: [] });
    stages.push({ id: "render-template-execute", kind: "template_execute", status: "skipped", summary: "Render mutation skipped during dry_run.", evidence_refs: [] });
    stages.push({ id: "render-dirty-after", kind: "template_execute", status: "skipped", summary: "Post-render dirty-state read skipped during dry_run.", evidence_refs: [] });
    stages.push({ id: "render-result-project", kind: "result_project", status: "completed", summary: "Managed-root render preview projected.", evidence_refs: [] });
    return renderEnvelope({ entry, request, startedAt, now, status: "dry_run_completed", stages, blockers: [], summary: "Render-target preview completed without mutation.", data: { preview: plan.preview, mutation_skipped: true, managed_root: true, managed_render_root: managedRoot, external_encoder: false } });
  }
  let partialResult = null;
  try {
    const child = plan.mutation_requests[0];
    const liveResolveStage = {
      id: "render-live-ref-resolve",
      kind: "live_ref_resolve",
      status: "running",
      summary: "Resolving explicit render targets from live REAPER state.",
      evidence_refs: [],
    };
    stages.push(liveResolveStage);
    let resolved;
    try {
      resolved = await resolveRenderTargetRefs({
        targetKind: plan.preview.target_kind,
        targetRefs: plan.preview.target_refs,
        executeAtomic,
        request,
      });
      liveResolveStage.status = resolved.required ? "completed" : "skipped";
      liveResolveStage.summary = resolved.required
        ? `Resolved ${resolved.canonical_refs.length} explicit render target ref(s) from live REAPER state.`
        : "This render target kind does not require explicit object refs.";
      liveResolveStage.evidence_refs = resolved.evidence_refs;
    } catch (error) {
      liveResolveStage.status = "failed";
      liveResolveStage.summary = error.message ?? "Live render target resolution failed.";
      throw error;
    }
    const dirtyBeforeStage = { id: "render-dirty-before", kind: "template_execute", status: "running", summary: "Reading exact project dirty state before render.", evidence_refs: [] };
    stages.push(dirtyBeforeStage);
    let dirtyBefore;
    try {
      dirtyBefore = await readRenderDirtyState({ executeAtomic, request });
      dirtyBeforeStage.status = "completed";
      dirtyBeforeStage.summary = `Project dirty-before=${dirtyBefore.dirty}.`;
      dirtyBeforeStage.evidence_refs = dirtyBefore.evidence_refs;
    } catch (error) {
      dirtyBeforeStage.status = "failed";
      dirtyBeforeStage.summary = error.message ?? "Pre-render dirty-state read failed.";
      throw error;
    }
    const renderStage = { id: "render-template-execute", kind: "template_execute", status: "running", summary: "Executing the audited managed-root render route.", evidence_refs: [] };
    stages.push(renderStage);
    const execution = await executeAtomic({ id: RENDER_TEMPLATE_ID, input: child.input, refs: resolved.refs, context: request.context, budget: request.budget, observeProjectIndex: false });
    renderStage.status = execution?.ok === true ? "completed" : "failed";
    renderStage.summary = typeof execution?.result?.summary === "string" ? execution.result.summary : "Audited render route completed.";
    renderStage.evidence_refs = evidenceRefs(execution);
    if (execution?.ok !== true) throw Object.assign(new Error(execution?.error?.message ?? "Audited render route failed."), { code: execution?.error?.code ?? "RENDER_TEMPLATE_FAILED" });
    const result = execution.result ?? {};
    const payload = renderAtomicPayload(result);
    const readback = isPlainObject(result.readback) ? result.readback : {};
    const artifactRefs = renderArtifactRefs(result, payload);
    const childVerification = isPlainObject(result.verification)
      ? result.verification
      : isPlainObject(execution.verification)
        ? execution.verification
        : isPlainObject(payload.verification)
          ? payload.verification
          : null;
    if (!childVerification || childVerification.status !== "passed") {
      throw coded("RENDER_VERIFICATION_FAILED", "The audited render route did not return passed verification.");
    }
    const completion = requireRenderCompletion({ result, payload, readback, artifactRefs });
    const canonicalRefs = uniqueStrings([
      ...resolved.canonical_refs,
      completion.job_ref,
      ...canonicalRefStrings(result.refs ?? result.canonical_refs),
      ...canonicalRefStrings(result.artifacts),
      ...canonicalRefStrings(result.jobs),
    ]);
    const verification = {
      status: "passed",
      evidence_refs: uniqueStrings([
        ...(childVerification?.evidence_refs ?? []),
        ...resolved.evidence_refs,
        ...dirtyBefore.evidence_refs,
        ...evidenceRefs(execution),
        ...artifactRefs,
        completion.job_ref,
      ]),
    };
    partialResult = {
      data: {
        preview: plan.preview,
        managed_root: true,
        managed_render_root: managedRoot,
        external_encoder: false,
        ...payload,
        render_completed: true,
        file_count: completion.file_count,
        outputs: completion.outputs,
        audio_outputs: completion.audio_outputs,
        retained_project_copies: completion.retained_project_copies,
        dirty_before: dirtyBefore.dirty,
        dirty_after: null,
        save_recommendation: "check_dirty_state_and_save_if_needed",
        job_ref: completion.job_ref,
        output_artifact_ref: completion.manifest_ref,
        evidence_artifact_ref: completion.evidence_ref,
        ...(isPlainObject(result.readback) ? { readback: result.readback } : {}),
        artifact_refs: artifactRefs,
        index_update: null,
      },
      canonicalRefs,
      verification,
      changes: [{ kind: "render", action: "render_targets", file_count: completion.file_count }],
      sqlite: null,
    };
    const invalidation = invalidateRenderIndex(projectIndexRuntime, now);
    if (invalidation?.ok === false) {
      throw Object.assign(new Error(invalidation.blockers?.[0]?.message ?? "Render completed but Project Index project state could not be invalidated."), { code: invalidation.blockers?.[0]?.code ?? "RENDER_INDEX_INVALIDATION_FAILED" });
    }
    partialResult.data.index_update = compactIndexUpdate(invalidation);
    partialResult.sqlite = sqliteEvidence(projectIndexRuntime, invalidation);
    const dirtyAfterStage = { id: "render-dirty-after", kind: "template_execute", status: "running", summary: "Reading exact project dirty state after render.", evidence_refs: [] };
    stages.push(dirtyAfterStage);
    let dirtyAfter;
    try {
      dirtyAfter = await readRenderDirtyState({ executeAtomic, request });
      dirtyAfterStage.status = "completed";
      dirtyAfterStage.summary = `Project dirty-after=${dirtyAfter.dirty}.`;
      dirtyAfterStage.evidence_refs = dirtyAfter.evidence_refs;
    } catch (error) {
      dirtyAfterStage.status = "failed";
      dirtyAfterStage.summary = error.message ?? "Post-render dirty-state read failed.";
      throw error;
    }
    partialResult.data.dirty_after = dirtyAfter.dirty;
    partialResult.data.save_recommendation = dirtyAfter.dirty ? "save_after_render" : "no_save_needed_after_render";
    partialResult.verification.evidence_refs = uniqueStrings([
      ...partialResult.verification.evidence_refs,
      ...dirtyAfter.evidence_refs,
    ]);
    stages.push({ id: "render-result-project", kind: "result_project", status: "completed", summary: "Render output, recovery-copy, and project dirty-state truth projected from the audited route.", evidence_refs: partialResult.verification.evidence_refs });
    return renderEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "completed",
      stages,
      blockers: [],
      summary: "Render targets completed through the audited managed-root route.",
      data: partialResult.data,
      canonicalRefs: partialResult.canonicalRefs,
      verification: partialResult.verification,
      changes: partialResult.changes,
      sqlite: partialResult.sqlite,
    });
  } catch (error) {
    const partial = partialResult !== null;
    return renderEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: partial ? "partial_failure" : "failed",
      stages,
      blockers: [blocker(error.code ?? "RENDER_EXECUTION_FAILED", error.message ?? "Render-target Macro failed.")],
      summary: error.message ?? "Render-target Macro failed.",
      data: partial ? partialResult.data : { preview: plan.preview, managed_root: true, managed_render_root: managedRoot, external_encoder: false },
      canonicalRefs: partial ? partialResult.canonicalRefs : [],
      verification: partial ? partialResult.verification : { status: "not_required", evidence_refs: [] },
      changes: partial ? partialResult.changes : [],
      sqlite: partial ? partialResult.sqlite : null,
    });
  }
}

async function resolveRenderTargetRefs({ targetKind, targetRefs, executeAtomic, request }) {
  const kind = targetKind === "regions"
    ? "region"
    : targetKind === "explicit_items"
      ? "item"
      : targetKind === "explicit_tracks"
        ? "track"
        : null;
  if (kind === null) {
    return { required: false, refs: {}, canonical_refs: [], evidence_refs: [] };
  }

  const executions = [];
  if (kind === "region") {
    executions.push(await executeRenderResolver({
      id: MARKER_REGION_RESOLVER_ID,
      input: { limit: 250 },
      executeAtomic,
      request,
    }));
  } else {
    const id = kind === "track" ? TRACK_RESOLVER_ID : ITEM_RESOLVER_ID;
    for (const targetRef of targetRefs) {
      executions.push(await executeRenderResolver({
        id,
        input: kind === "track" ? { track_ref: targetRef } : { ref: targetRef },
        executeAtomic,
        request,
      }));
    }
  }

  const liveRefs = targetRefs.map((targetRef, index) => {
    const execution = kind === "region" ? executions[0] : executions[index];
    return requireLiveObjectRef(execution, targetRef, kind);
  });
  const refKey = kind === "region" ? "region_refs" : kind === "item" ? "item_refs" : "track_refs";
  return {
    required: true,
    refs: { [refKey]: liveRefs },
    canonical_refs: liveRefs.map((entry) => entry.ref),
    evidence_refs: [...new Set(executions.flatMap(evidenceRefs))],
  };
}

async function executeRenderResolver({ id, input, executeAtomic, request }) {
  const execution = await executeAtomic({
    id,
    input,
    refs: {},
    context: request.context,
    budget: request.budget,
    observeProjectIndex: false,
  });
  if (execution?.ok !== true) {
    throw coded(
      execution?.error?.code ?? "RENDER_LIVE_REF_RESOLUTION_FAILED",
      execution?.error?.message ?? `${id} failed while resolving an explicit render target.`,
    );
  }
  return execution;
}

function requireLiveObjectRef(execution, requestedRef, kind) {
  const objectRefs = executionObjectRefs(execution).filter((entry) => entry.kind === kind);
  const exact = objectRefs.find((entry) => entry.ref === requestedRef);
  if (exact) return structuredClone(exact);

  if (kind === "region") {
    const mappedRef = mappedRegionRef(execution, requestedRef);
    const mapped = mappedRef === null ? null : objectRefs.find((entry) => entry.ref === mappedRef);
    if (mapped) return structuredClone(mapped);
    throw coded("RENDER_REGION_REF_NOT_FOUND", `The live marker/region resolver did not return the requested region ${requestedRef}.`);
  }
  if (requiresExactLiveIdentity(requestedRef)) {
    throw coded("RENDER_LIVE_REF_IDENTITY_MISMATCH", `The live resolver did not return the exact stable ${kind} ref ${requestedRef}.`);
  }
  if (objectRefs.length === 1) return structuredClone(objectRefs[0]);
  if (objectRefs.length > 1) {
    throw coded("RENDER_LIVE_REF_AMBIGUOUS", `The live resolver returned multiple ${kind} refs for ${requestedRef}.`);
  }
  throw coded("RENDER_LIVE_OBJECT_REF_REQUIRED", `The live resolver did not return a full ${kind} object ref for ${requestedRef}.`);
}

function requiresExactLiveIdentity(ref) {
  return typeof ref === "string" && ref.includes(":guid:");
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    if (typeof value.kind === "string" && typeof value.ref === "string") {
      refs.push(value);
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  return refs;
}

function mappedRegionRef(execution, requestedRef) {
  const prefix = "region:name:";
  if (!requestedRef.startsWith(prefix)) return null;
  const requestedName = requestedRef.slice(prefix.length);
  const rows = [];
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!isPlainObject(value)) return;
    if (typeof value.region_ref === "string" && value.name === requestedName) rows.push(value.region_ref);
    Object.values(value).forEach(visit);
  };
  visit(execution?.result?.readback);
  visit(execution?.result?.summary);
  visit(execution?.result?.data);
  const matches = [...new Set(rows)];
  if (matches.length > 1) throw coded("RENDER_REGION_NAME_AMBIGUOUS", `Multiple live regions are named ${requestedName}; use an index or GUID ref.`);
  return matches[0] ?? null;
}

function canonicalRefStrings(value) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) {
      entry.forEach(visit);
      return;
    }
    if (typeof entry === "string") {
      refs.push(entry);
      return;
    }
    if (!isPlainObject(entry)) return;
    if (typeof entry.ref === "string") refs.push(entry.ref);
    else Object.values(entry).forEach(visit);
  };
  visit(value);
  return [...new Set(refs)];
}

function renderAtomicPayload(result) {
  if (isPlainObject(result?.data)) return structuredClone(result.data);
  if (isPlainObject(result?.summary)) return structuredClone(result.summary);
  if (isPlainObject(result?.readback)) return structuredClone(result.readback);
  return {};
}

function renderArtifactRefs(result, payload) {
  return uniqueStrings([
    ...canonicalRefStrings(result?.artifact_refs),
    ...canonicalRefStrings(result?.artifacts),
    ...canonicalRefStrings(result?.refs).filter((ref) => ref.startsWith("artifact:")),
    ...[payload?.output_artifact_ref, payload?.evidence_artifact_ref]
      .filter((ref) => typeof ref === "string" && ref.startsWith("artifact:")),
  ]);
}

function requireRenderCompletion({ result, payload, readback, artifactRefs }) {
  const manifestRef = payload.output_artifact_ref;
  const evidenceRef = payload.evidence_artifact_ref;
  if (typeof manifestRef !== "string" || !manifestRef.startsWith("artifact:") || !artifactRefs.includes(manifestRef)) {
    throw coded("RENDER_MANIFEST_ARTIFACT_REQUIRED", "The audited render route did not return its manifest artifact ref.");
  }
  if (typeof evidenceRef !== "string" || !evidenceRef.startsWith("artifact:") || !artifactRefs.includes(evidenceRef)) {
    throw coded("RENDER_EVIDENCE_ARTIFACT_REQUIRED", "The audited render route did not return its evidence artifact ref.");
  }

  const jobRef = typeof payload.job_ref === "string" && payload.job_ref.startsWith("job:")
    ? payload.job_ref
    : canonicalRefStrings(result.jobs).find((ref) => ref.startsWith("job:")) ?? null;
  if (!jobRef) throw coded("RENDER_JOB_REF_REQUIRED", "The audited render route did not return a render job ref.");

  const outputs = Array.isArray(payload.outputs)
    ? payload.outputs
    : Array.isArray(readback.outputs)
      ? readback.outputs
      : [];
  const fileCount = payload.file_count ?? readback.file_count;
  if (!Number.isInteger(fileCount) || fileCount < 1 || outputs.length !== fileCount) {
    throw coded("RENDER_OUTPUTS_REQUIRED", "The audited render route must return a positive file_count matching non-empty output rows.");
  }
  if (outputs.some((output) => !isPlainObject(output) || typeof output.absolute_path !== "string" || output.absolute_path.length === 0)) {
    throw coded("RENDER_OUTPUT_ROW_INVALID", "The audited render route returned an invalid output row.");
  }
  const audioOutputs = outputs.map((output) => ({
    absolute_path: output.absolute_path,
    ...(output.size === undefined ? {} : { size: output.size }),
    ...(output.extension === undefined ? {} : { extension: output.extension }),
  }));
  const retainedProjectCopies = outputs
    .filter((output) => output.generated_project_copy_retained === true && typeof output.generated_project_copy_path === "string")
    .map((output) => ({
      absolute_path: output.generated_project_copy_path,
      audio_output_path: output.absolute_path,
      retained_for_recovery: true,
    }));
  return {
    manifest_ref: manifestRef,
    evidence_ref: evidenceRef,
    job_ref: jobRef,
    file_count: fileCount,
    outputs: structuredClone(outputs),
    audio_outputs: audioOutputs,
    retained_project_copies: retainedProjectCopies,
  };
}

async function readRenderDirtyState({ executeAtomic, request }) {
  const execution = await executeAtomic({
    id: DIRTY_STATE_TEMPLATE_ID,
    input: {},
    refs: {},
    context: request.context,
    budget: request.budget,
    observeProjectIndex: false,
  });
  const readback = execution?.result?.readback ?? execution?.result?.summary ?? {};
  if (execution?.ok !== true || typeof readback?.dirty !== "boolean") {
    throw coded("RENDER_DIRTY_STATE_REQUIRED", "The audited render route could not read the exact project dirty state.");
  }
  return { dirty: readback.dirty, evidence_refs: evidenceRefs(execution) };
}

function normalizeManagedRenderRoot(value) {
  if (
    typeof value !== "string" ||
    value === "" ||
    value.length > 3_072 ||
    Buffer.byteLength(value, "utf8") > 3_072 ||
    !value.startsWith("/") ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) return null;
  return value;
}

function renderEnvelope({ entry, request, startedAt, now, status, stages, blockers, summary, data = {}, canonicalRefs = [], verification = { status: "not_required", evidence_refs: [] }, changes = [], sqlite = null }) {
  const failed = status !== "completed" && status !== "dry_run_completed";
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT, ok: !failed,
    macro: { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk },
    request: { request_id: request.request_id ?? "macro.render.targets", dry_run: failed ? false : request.input?.dry_run !== false },
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: sqlite ?? { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: { summary, canonical_refs: canonicalRefs, changes, verification: failed ? { status: "not_required", evidence_refs: verification.evidence_refs ?? [] } : verification, artifact_refs: data.artifact_refs ?? [], data },
    blockers: failed ? blockers : [], error: failed ? { code: blockers[0]?.code ?? "RENDER_FAILED", message: summary, recoverable: true } : null,
    recovery: failed ? {
      action: status === "partial_failure"
        ? "Keep the reported managed outputs and evidence, repair the post-render blocker, inspect dirty state, then save if recommended before retrying."
        : "Repair the typed render blocker and retry the same registered Macro.",
      partial_changes_possible: status === "partial_failure",
      rendered_outputs_retained: status === "partial_failure" && Array.isArray(data.audio_outputs) && data.audio_outputs.length > 0,
      sqlite_rows_authorize_writes: false,
    } : null,
    budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope));
  const validation = validateMacroExecutionEnvelope(envelope);
  if (!validation.valid) throw new TypeError(`Invalid render Macro envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(envelope);
}

function evidenceRefs(execution) {
  return uniqueStrings([
    execution?.request?.id,
    ...(execution?.evidence_refs ?? []),
    ...(execution?.result?.evidence_refs ?? []),
    ...canonicalRefStrings(execution?.result?.artifacts),
  ]);
}
function uniqueStrings(values) {
  return [...new Set((values ?? []).filter((value) => typeof value === "string"))]
    .slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count);
}
function invalidateRenderIndex(runtime, now) {
  if (typeof runtime?.invalidateScopes !== "function") return null;
  return runtime.invalidateScopes({ scopes: ["project_head"], observed_at: safeNowIso(now) });
}
function sqliteEvidence(runtime, invalidation) {
  if (!invalidation) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  const status = typeof runtime?.status === "function" ? runtime.status() : {};
  const revision = status.revision ?? status.project_revision ?? invalidation.revision ?? null;
  return {
    used: true,
    source: "warm_index",
    freshness: "stale",
    snapshot_ref: status.snapshot_id ?? invalidation.snapshot_id ?? null,
    revision: revision === null ? null : String(revision),
    refreshed: false,
  };
}
function compactIndexUpdate(value) {
  if (!value) return null;
  return {
    status: value.status ?? null,
    scopes: Array.isArray(value.scopes) ? value.scopes.slice(0, 8) : [],
    snapshot_id: value.snapshot_id ?? null,
    revision: value.revision ?? null,
  };
}

export function createAlpha3_2ERenderTargetsMacroDiscoveryItems(options = {}) {
  return deepFreeze([{
    id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    title: "Render targets",
    summary: "Execute bounded managed-root WAV/OGG exports through the audited render route with output and project-state evidence.",
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.render.targets",
    tags: ["alpha3.2", "alpha3.2e", "macro", "render", "executable", "runtime_bound"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "render_targets",
    menu_group: "primary",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    runnable: true,
    support_status: "executable_runtime_bound",
    support_state: "supported_with_readback",
    exists_in_catalog: true,
    live_runnable_now: options.liveRunnableNow === true,
    evidence_level: options.liveRunnableNow === true
      ? "runtime_bound_live_route_available"
      : "runtime_bound_executable",
    known_blocker: LIVE_EVIDENCE_BLOCKER,
    allowed_live_group: "d31_render_targets",
    input_schema: {
      type: "object",
      properties: {
        target_kind: { enum: [...ALPHA3_2E_RENDER_TARGET_KINDS] },
        format: { enum: [...ALPHA3_2E_RENDER_FORMATS] },
        refs: { description: "Canonical refs array or grouped canonical ref arrays; target kind must match." },
        sample_rate_hz: { enum: [...ALPHA3_2E_RENDER_SAMPLE_RATES] },
        channel_count: { enum: [...ALPHA3_2E_RENDER_CHANNEL_COUNTS] },
        wav_bit_depth: { enum: [...ALPHA3_2E_RENDER_WAV_BIT_DEPTHS] },
        ogg_quality: { enum: [...ALPHA3_2E_RENDER_OGG_QUALITIES] },
        output_policy: { const: "openreaper_managed_render_root" },
        collision_policy: { const: "fail_if_exists" },
        max_targets: { type: "integer", minimum: 1, maximum: ALPHA3_2E_RENDER_MAX_TARGETS },
        dry_run: { type: "boolean" },
      },
      required: ["target_kind", "format"],
      additionalProperties: false,
    },
    output_schema: {
      type: "object",
      properties: {
        contract: { const: "macro.execution.v1" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
      required: ["contract", "macro", "execution", "result"],
      additionalProperties: true,
    },
    examples: [
      { name: "whole_project_wav_preview", input: { target_kind: "whole_project", format: "wav", sample_rate_hz: 48_000, channel_count: 2, wav_bit_depth: 24, dry_run: true } },
      { name: "explicit_regions_ogg_plan", input: { target_kind: "regions", refs: ["region:project:3"], format: "ogg", ogg_quality: 0.6, collision_policy: "fail_if_exists", dry_run: false } },
    ],
  }]);
}

function validateInput(rawInput, input) {
  const blockers = [];
  if (!isPlainObject(rawInput)) blockers.push(blocker("RENDER_INPUT_NOT_OBJECT", "macro.render.targets input must be an object."));
  const unknown = Object.keys(input).filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  for (const field of unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT)) {
    blockers.push(blocker(
      FORBIDDEN_INPUT_FIELDS.has(field) ? "RENDER_UNSAFE_INPUT_FIELD" : "RENDER_INPUT_UNKNOWN_FIELD",
      FORBIDDEN_INPUT_FIELDS.has(field)
        ? `${field} is forbidden; use the managed render root and the audited render child route.`
        : "Unsupported macro.render.targets input field.",
      { field },
    ));
  }
  if (unknown.length > UNKNOWN_FIELD_DETAIL_LIMIT) blockers.push(blocker("RENDER_INPUT_UNKNOWN_FIELD", "Too many unsupported macro.render.targets input fields.", { omitted_count: unknown.length - UNKNOWN_FIELD_DETAIL_LIMIT }));
  if (!ALPHA3_2E_RENDER_TARGET_KINDS.includes(input.target_kind)) blockers.push(blocker("RENDER_TARGET_KIND_INVALID", "target_kind must be one of the bounded render target kinds.", { allowed: ALPHA3_2E_RENDER_TARGET_KINDS }));
  if (!ALPHA3_2E_RENDER_FORMATS.includes(input.format)) blockers.push(blocker("RENDER_FORMAT_INVALID", "format must be wav or ogg."));
  if (input.dry_run !== undefined && typeof input.dry_run !== "boolean") blockers.push(blocker("RENDER_DRY_RUN_INVALID", "dry_run must be boolean when supplied."));
  if (input.compact_response !== undefined && typeof input.compact_response !== "boolean") blockers.push(blocker("RENDER_COMPACT_RESPONSE_INVALID", "compact_response must be boolean when supplied."));
  return blockers;
}

function normalizeRefs(input, posture, targetKind) {
  const grouped = { regions: [], items: [], tracks: [] };
  const blockers = [];
  const sources = [];
  const postureRefs = posture?.refs ?? posture?.target_refs ?? posture?.canonical_refs;
  if (postureRefs !== undefined) sources.push({ source: "request_posture", value: postureRefs });
  if (input.refs !== undefined) sources.push({ source: "input.refs", value: input.refs });
  for (const kind of REF_KINDS) {
    const field = `${kind.slice(0, -1)}_refs`;
    if (input[field] !== undefined) sources.push({ source: `input.${field}`, kind, value: input[field] });
  }

  for (const source of sources) {
    if (Array.isArray(source.value)) {
      const inferredKind = source.kind ?? refKindForTargetKind(targetKind);
      if (inferredKind === null) {
        if (source.value.length > 0) blockers.push(blocker("RENDER_REFS_KIND_REQUIRED", "An array of refs must be paired with an explicit item, track, or region target kind."));
        continue;
      }
      addRefs(grouped, inferredKind, source.value, source.source, blockers);
      continue;
    }
    if (!isPlainObject(source.value)) {
      blockers.push(blocker("RENDER_REFS_INVALID", `${source.source} refs must be a canonical array or grouped canonical arrays.`));
      continue;
    }
    for (const [rawKind, value] of Object.entries(source.value)) {
      const kind = normalizeRefKind(rawKind);
      if (!kind) {
        blockers.push(blocker("RENDER_REF_GROUP_INVALID", `Unsupported ref group ${rawKind}; use regions, items, or tracks.` , { source: source.source, kind: rawKind }));
        continue;
      }
      if (!Array.isArray(value)) {
        blockers.push(blocker("RENDER_REFS_INVALID", `${source.source}.${rawKind} must be an array of canonical refs.`, { source: source.source, kind: rawKind }));
        continue;
      }
      addRefs(grouped, kind, value, source.source, blockers);
    }
  }
  return { refs: deepFreeze(grouped), blockers };
}

function addRefs(grouped, kind, values, source, blockers) {
  for (const ref of values) {
    if (!isCanonicalRef(ref, kind)) {
      blockers.push(blocker("RENDER_REF_INVALID", `${source} contains a non-canonical or mismatched ${kind} ref.`, { source, kind, ref: boundedString(ref) }));
      continue;
    }
    if (!grouped[kind].includes(ref)) grouped[kind].push(ref);
  }
}

function validateTargetRefs(targetKind, refs) {
  const blockers = [];
  if (!ALPHA3_2E_RENDER_TARGET_KINDS.includes(targetKind)) return blockers;
  const presentKinds = REF_KINDS.filter((kind) => refs[kind].length > 0);
  const totalRefs = presentKinds.reduce((sum, kind) => sum + refs[kind].length, 0);
  if (["whole_project", "time_selection"].includes(targetKind)) {
    if (totalRefs > 0) blockers.push(blocker("RENDER_OBJECT_REFS_FORBIDDEN", `${targetKind} does not accept object refs; use no refs.`));
    return blockers;
  }
  if (["selected_items", "selected_tracks"].includes(targetKind)) {
    if (totalRefs > 0) blockers.push(blocker("RENDER_SELECTED_REFS_FORBIDDEN", `${targetKind} rejects explicit refs; selected targets are resolved from live selection.`));
    return blockers;
  }
  const requiredKind = targetKind === "regions" ? "regions" : targetKind === "explicit_items" ? "items" : "tracks";
  if (refs[requiredKind].length === 0) blockers.push(blocker("RENDER_EXPLICIT_REFS_REQUIRED", `${targetKind} requires a non-empty canonical ${requiredKind.slice(0, -1)} ref array.`));
  for (const kind of presentKinds) {
    if (kind !== requiredKind) blockers.push(blocker("RENDER_TARGET_REF_KIND_MISMATCH", `${targetKind} accepts only ${requiredKind} refs.`, { received_kind: kind, expected_kind: requiredKind }));
  }
  return blockers;
}

function normalizeSettings(input) {
  const blockers = [];
  const sampleRate = input.sample_rate_hz ?? 48_000;
  const channels = input.channel_count ?? 2;
  const maxTargets = input.max_targets ?? ALPHA3_2E_RENDER_MAX_TARGETS;
  const outputPolicy = input.output_policy ?? "openreaper_managed_render_root";
  const collisionPolicy = input.collision_policy ?? "fail_if_exists";
  if (!ALPHA3_2E_RENDER_SAMPLE_RATES.includes(sampleRate)) blockers.push(blocker("RENDER_SAMPLE_RATE_UNSUPPORTED", "sample_rate_hz must be 44100 or 48000."));
  if (!ALPHA3_2E_RENDER_CHANNEL_COUNTS.includes(channels)) blockers.push(blocker("RENDER_CHANNELS_UNSUPPORTED", "channel_count must be 1 or 2."));
  if (!Number.isInteger(maxTargets) || maxTargets < 1 || maxTargets > ALPHA3_2E_RENDER_MAX_TARGETS) blockers.push(blocker("RENDER_MAX_TARGETS_INVALID", `max_targets must be an integer from 1 to ${ALPHA3_2E_RENDER_MAX_TARGETS}.`));
  if (outputPolicy !== "openreaper_managed_render_root") blockers.push(blocker("RENDER_OUTPUT_POLICY_REQUIRED", "output_policy must be openreaper_managed_render_root."));
  if (collisionPolicy !== "fail_if_exists") blockers.push(blocker("RENDER_COLLISION_POLICY_REQUIRED", "collision_policy must be fail_if_exists; overwrite and suffix fallback are not supported."));

  const settings = {
    format: input.format,
    sample_rate_hz: sampleRate,
    channel_count: channels,
    max_targets: maxTargets,
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
  };
  if (input.format === "wav") {
    const bitDepth = input.wav_bit_depth ?? 24;
    if (!ALPHA3_2E_RENDER_WAV_BIT_DEPTHS.includes(bitDepth)) blockers.push(blocker("RENDER_WAV_BIT_DEPTH_UNSUPPORTED", "WAV wav_bit_depth must be 16 or 24."));
    if (input.ogg_quality !== undefined) blockers.push(blocker("RENDER_WAV_QUALITY_FORBIDDEN", "ogg_quality is only valid for OGG."));
    settings.wav_bit_depth = bitDepth;
  }
  if (input.format === "ogg") {
    const quality = input.ogg_quality ?? 0.5;
    if (!ALPHA3_2E_RENDER_OGG_QUALITIES.includes(quality)) blockers.push(blocker("RENDER_OGG_QUALITY_UNSUPPORTED", "OGG ogg_quality must be one of 0.3, 0.5, 0.6, 0.8, or 1.0."));
    if (input.wav_bit_depth !== undefined) blockers.push(blocker("RENDER_OGG_BIT_DEPTH_FORBIDDEN", "wav_bit_depth is only valid for WAV."));
    settings.ogg_quality = quality;
  }
  return { settings: deepFreeze(settings), blockers };
}

function buildPreview({ targetKind, targetRefs, refs, settings }) {
  const explicit = ["regions", "explicit_items", "explicit_tracks"].includes(targetKind);
  const targetCount = explicit ? targetRefs.length : null;
  return deepFreeze({
    target_kind: targetKind,
    format: settings.format,
    target_refs: [...targetRefs],
    normalized_refs: refs,
    target_count: targetCount,
    estimated_output_count: targetCount ?? 1,
    max_targets: settings.max_targets,
    render_settings: { ...settings },
    output_policy: {
      root: "openreaper_managed_render_root",
      collision_policy: "fail_if_exists",
      arbitrary_path_allowed: false,
      overwrite_allowed: false,
      external_encoder_allowed: false,
      deterministic_handler_naming: true,
    },
    runtime_binding: "bound_plan_only_child_route",
  });
}

function buildMutationRequest(preview) {
  const namedRefs = {};
  if (preview.target_kind === "regions") namedRefs.region_refs = preview.target_refs.map((ref) => childObjectRef("region", ref));
  if (preview.target_kind === "explicit_items") namedRefs.item_refs = preview.target_refs.map((ref) => childObjectRef("item", ref));
  if (preview.target_kind === "explicit_tracks") namedRefs.track_refs = preview.target_refs.map((ref) => childObjectRef("track", ref));
  const input = {
    target_kind: preview.target_kind,
    format: preview.format,
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    sample_rate_hz: preview.render_settings.sample_rate_hz,
    channel_count: preview.render_settings.channel_count,
    max_targets: preview.max_targets,
    ...(preview.format === "wav" ? { wav_bit_depth: preview.render_settings.wav_bit_depth } : { ogg_quality: preview.render_settings.ogg_quality }),
  };
  return childRequest(1, "mutation", "template.render.render_targets", namedRefs, input,
    "Run the single audited D31 project-render route; the child performs collision preflight, settings/selection restoration, output header verification, and manifest/evidence emission.",
    { callable_now: true, binding_status: "runtime_bound_live_evidenced" });
}

function childObjectRef(kind, ref) {
  const remainder = ref.slice(kind.length + 1);
  const separator = remainder.indexOf(":");
  const scheme = remainder.slice(0, separator);
  const value = remainder.slice(separator + 1);
  return deepFreeze({ kind, ref, identity: { scheme, value } });
}

function childRequest(sequence, stage, id, refs, input, purpose, extra = {}) {
  return deepFreeze({ sequence, stage, tool: "call_template", id, refs: deepFreeze(refs), input: deepFreeze(input), purpose, required: true, ...extra });
}

function dryRunPlan(preview) {
  return deepFreeze({
    contract: ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    ok: true,
    mode: "dry_run_preview",
    dry_run: true,
    preview,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    blockers: [],
    typed_blockers: [],
    runtime_binding: "bound_plan_only_child_route",
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function blockedPlan(blockers, preview, dryRun) {
  const frozenBlockers = deepFreeze(blockers.map((entry) => ({ ...entry })));
  return deepFreeze({
    contract: ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    ok: false,
    mode: "blocked",
    dry_run: dryRun,
    preview,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    blockers: frozenBlockers,
    typed_blockers: frozenBlockers,
    runtime_binding: "bound_plan_only_child_route",
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function successCriteriaFor(preview) {
  return deepFreeze([
    "The single template.render.render_targets child resolves the exact target set and rejects all collisions before the first render action.",
    `Every ${preview.format.toUpperCase()} output is non-empty, has the expected container header, and remains under the managed render root.`,
    "The D31 result returns compact output rows plus manifest/evidence artifact refs and confirms render-setting and selection restoration.",
  ]);
}

function agentExecutionFlow(preview) {
  return deepFreeze([
    { step: "run_single_render_mutation", request_count: 1, route: "template.render.render_targets", stop_on_error: true },
    { step: "accept_child_verified_outputs", expected_output_count: preview.estimated_output_count, require_manifest_and_evidence_refs: true },
  ]);
}

function noExecutorSafetyPosture() {
  return deepFreeze({
    added_tools: 0,
    server_executes_children: false,
    hidden_executor: false,
    public_call_recipe: false,
    raw_action_lua_shell_ui: false,
    hardware_device_io: false,
    external_encoder: false,
    arbitrary_output_path: false,
    overwrite: false,
    live_reaper_called: false,
  });
}

function refsForTargetKind(targetKind, refs) {
  if (targetKind === "regions") return refs.regions;
  if (targetKind === "explicit_items") return refs.items;
  if (targetKind === "explicit_tracks") return refs.tracks;
  return [];
}

function refKindForTargetKind(targetKind) {
  if (["regions"].includes(targetKind)) return "regions";
  if (["explicit_items", "selected_items"].includes(targetKind)) return "items";
  if (["explicit_tracks", "selected_tracks"].includes(targetKind)) return "tracks";
  return null;
}

function normalizeRefKind(value) {
  if (value === "region" || value === "regions" || value === "region_refs") return "regions";
  if (value === "item" || value === "items" || value === "item_refs") return "items";
  if (value === "track" || value === "tracks" || value === "track_refs") return "tracks";
  return null;
}

function isCanonicalRef(value, kind) {
  if (typeof value !== "string"
    || value.length === 0
    || Buffer.byteLength(value) > MAX_REF_BYTES
    || /[\u0000-\u001f\u007f]/u.test(value)
    || !value.startsWith(REF_PREFIXES[kind])) return false;
  const remainder = value.slice(REF_PREFIXES[kind].length);
  const separator = remainder.indexOf(":");
  return separator > 0 && separator < remainder.length - 1;
}



function requestPosture(request = {}) {
  return {
    refs: request.refs,
    target_refs: request.target_refs,
    canonical_refs: request.canonical_refs,
    idempotency_key_present: request.idempotency_key !== undefined,
  };
}

function summarizeRuntimeRequest(request = {}) {
  return {
    id: request.id ?? ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    input_keys: isPlainObject(request.input) ? Object.keys(request.input).sort() : [],
    refs_provided: request.refs !== undefined || request.target_refs !== undefined || request.canonical_refs !== undefined,
    idempotency_key_present: request.idempotency_key !== undefined,
  };
}

function macroRuntimeError(plan) {
  const first = plan.typed_blockers?.[0] ?? blocker("RENDER_TARGETS_BLOCKED", "macro.render.targets planning was blocked.");
  return { source: "macro", code: first.code, message: first.message, recoverable: true, details: { blockers: plan.typed_blockers } };
}

function safeNowIso(now) {
  try { return now().toISOString(); } catch { return new Date(0).toISOString(); }
}

function blocker(code, message, details = undefined) {
  return { code, message, recoverable: true, ...(details === undefined ? {} : { details }) };
}

function coded(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedString(value) {
  if (typeof value !== "string") return value;
  return value.length <= 160 ? value : `${value.slice(0, 159)}…`;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
