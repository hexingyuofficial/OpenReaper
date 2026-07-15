import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";
import {
  ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
  planAlpha3_2EProjectLayoutMacro,
} from "./alpha3-2e-project-layout-v1.mjs";
import {
  ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
  planAlpha3_2EProjectDeleteTargetsMacro,
} from "./alpha3-2e-project-delete-targets-v1.mjs";
import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
} from "./alpha3-2e-media-place-assets-v1.mjs";
import {
  ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
  planAlpha3_2ERoutingApplyMacro,
} from "./alpha3-2e-routing-apply-v1.mjs";

export const ALPHA3_2_5_C_PROJECT_WRITE_RUNTIME_CONTRACT =
  "alpha3.2.5.c.project_write_runtime.v1";

const TRACK_RESOLVER_ID = "template.tracks.resolve_track_ref";
const ITEM_ID_RESOLVER_ID = "template.items.resolve_item_ref";
const ITEM_RESOLVER_ID = ITEM_ID_RESOLVER_ID;
const MARKER_REGION_RESOLVER_ID = "template.project.list_markers_regions";
const SEND_RESOLVER_ID = "template.routing.resolve_send_ref";
const FX_RESOLVER_ID = "template.fx.resolve_fx_ref";
const MAX_MUTATIONS = 256;
const LAYOUT_EVIDENCE_REF_MAX_COUNT = 16;
const LAYOUT_EVIDENCE_REF_MAX_BYTES = 128;
const LAYOUT_TARGET_REF_BUDGET_PLACEHOLDER = "track:guid:{00000000-0000-4000-8000-000000000000}";
const MARKER_TARGET_REF_BUDGET_PLACEHOLDER = "marker:index:2147483647";
const REGION_TARGET_REF_BUDGET_PLACEHOLDER = "region:index:2147483647";
const LAYOUT_RESPONSE_BUDGET_RESERVE_BYTES = 1_024;
const PROJECT_WRITE_INTERNAL_BUDGET = Object.freeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: MAX_MUTATIONS,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const PROGRAMS = Object.freeze({
  [ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID]: program({
    macroId: ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID,
    programId: "openreaper.macro.project.apply_layout",
    risk: "write",
    undoPolicy: "single_undo",
    planner: planAlpha3_2EProjectLayoutMacro,
    templateIds: [
      "template.tracks.list_tracks", "template.tracks.read_folder_structure", TRACK_RESOLVER_ID,
      "template.tracks.create_track", "template.tracks.create_folder_track", "template.tracks.rename_track",
      "template.tracks.set_color", "template.tracks.move_track", "template.tracks.set_folder_depth",
      "template.tracks.nest_tracks_in_folder", MARKER_REGION_RESOLVER_ID,
      "template.project.create_marker", "template.project.create_region",
    ],
    dryReads: [read("template.tracks.list_tracks", { limit: 100 }), read("template.tracks.read_folder_structure", {})],
  }),
  [ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID]: program({
    macroId: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
    programId: "openreaper.macro.project.delete_targets",
    risk: "destructive",
    undoPolicy: "per_stage_undo",
    planner: planAlpha3_2EProjectDeleteTargetsMacro,
    templateIds: [
      "template.tracks.list_tracks", TRACK_RESOLVER_ID, ITEM_RESOLVER_ID, ITEM_ID_RESOLVER_ID, MARKER_REGION_RESOLVER_ID, FX_RESOLVER_ID,
      "template.tracks.delete_tracks", "template.items.delete_items", "template.project.delete_marker", "template.project.delete_region", "template.fx.delete_fx",
    ],
    dryReads: [read("template.tracks.list_tracks", { limit: 100 }), read(MARKER_REGION_RESOLVER_ID, { limit: 250 })],
    confirmRequired: true,
  }),
  [ALPHA3_2E_ROUTING_APPLY_MACRO_ID]: program({
    macroId: ALPHA3_2E_ROUTING_APPLY_MACRO_ID,
    programId: "openreaper.macro.routing.apply",
    risk: "write",
    undoPolicy: "single_undo",
    planner: planAlpha3_2ERoutingApplyMacro,
    templateIds: [
      "template.routing.read_project_routing_graph", TRACK_RESOLVER_ID, SEND_RESOLVER_ID,
      "template.routing.create_track_send", "template.routing.set_send_volume", "template.routing.set_send_pan",
      "template.routing.set_send_mute", "template.routing.set_master_parent_send", "template.routing.set_track_channel_count",
      "template.routing.remove_send", "template.routing.read_track_routing",
    ],
    dryReads: [read("template.routing.read_project_routing_graph", { include_master_parent: true, max_tracks: 128, max_edges: 256 })],
    internalRoutingOnly: true,
  }),
});

const ACCEPTED_TEMPLATE_IDS = Object.freeze([...new Set(Object.values(PROGRAMS).flatMap((program) => program.templateIds))]);
const REGISTERED_STAGE_IDS = new Set(Object.values(PROGRAMS).flatMap((program) => program.entry.stages.map((stage) => stage.id)));

export function isAlpha3_2_5CProjectWriteMacroId(id) {
  return Object.hasOwn(PROGRAMS, id);
}

export function createAlpha3_2_5CProjectWriteRegistry(options = {}) {
  return createMacroProgramRegistry(Object.values(PROGRAMS).map((program) => program.entry), {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ACCEPTED_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY = createAlpha3_2_5CProjectWriteRegistry();

export async function executeAlpha3_2_5CProjectWriteMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
} = {}) {
  const program = PROGRAMS[request?.id];
  if (!program) throw new TypeError(`Unsupported Alpha3.2.5-C project-write Macro id: ${String(request?.id)}`);
  const startedAt = safeNowIso(now);
  const stages = [];
  const validation = validateMacroProgramRequest(macroRequest(request), { registry: ALPHA3_2_5_C_PROJECT_WRITE_REGISTRY });
  if (!validation.valid) return failure(program, request, startedAt, now, stages, "blocked", "MACRO_REQUEST_INVALID", validation.errors.join("; "));
  if (typeof executeAtomic !== "function") return failure(program, request, startedAt, now, stages, "blocked", "PROJECT_WRITE_EXECUTOR_UNAVAILABLE", "The managed OpenReaper atomic executor is unavailable.");

  const plan = program.planner(request.input ?? {}, { idempotency_key_present: request.idempotency_key !== undefined });
  if (plan.ok !== true) {
    const message = program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID
      ? "The registered Routing Macro input is blocked."
      : "The registered Macro input or required confirmation is blocked.";
    return failure(program, request, startedAt, now, stages, "blocked", firstCode(plan, "PROJECT_WRITE_INPUT_BLOCKED"), message, plan.blockers, { preview: plan.preview ?? {} });
  }

  const dryRun = request.input?.dry_run !== false;
  const state = {
    objectRefs: new Map(),
    localRefs: new Map(),
    evidenceRefs: [],
    changes: [],
    canonicalRefs: [],
    readbackRefs: new Set(),
    markerRegionReadbackRows: new Map(),
    routingReadbackRows: new Map(),
    routingResolvedSends: new Map(),
    readbackEvidenceRefs: [],
    writeAttempted: false,
    writeExecuted: false,
    sqlite: sqliteEvidence(),
    indexUpdate: null,
  };
  rememberInputObjectRefs(state, request.refs);
  if (!dryRun && program.entry.macro_id === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID) {
    const budgetBlocker = layoutResponseBudgetBlocker(program, request, plan);
    if (budgetBlocker) {
      return failure(
        program,
        request,
        startedAt,
        now,
        stages,
        "blocked",
        budgetBlocker.code,
        budgetBlocker.message,
        [budgetBlocker],
        { preview: plan.preview ?? {}, source_media_deleted: false },
        state,
      );
    }
    initializeLayoutOperationOutcomes(state, plan);
  }
  if (!dryRun && program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID) {
    initializeRoutingOperationOutcomes(state, plan);
  }
  try {
    const selectionReads = dryRun ? dryReadsForPlan(program, plan) : plan.preflight_requests ?? [];
    for (const child of selectionReads) {
      const readRequest = child.id === "template.media.probe_file" && child.input === null
        ? null
        : child;
      if (readRequest === null) continue;
      const execution = await atomicStage({ program, request, executeAtomic, stages, state, id: child.id, input: child.input ?? {}, refs: child.refs ?? {}, stageId: `select-${stageToken(child.id)}`, kind: "selector_resolve", now });
      bindPreflightLocalRef(plan, child, execution, state);
      validateLayoutAnnotationPreflight(program, plan, child, execution);
      validateRoutingPreflight(program, plan, child, execution, state);
    }
    if (dryRun && request.id === ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID) {
      for (const asset of request.input?.assets ?? []) {
        const execution = await atomicStage({ program, request, executeAtomic, stages, state, id: "template.media.probe_file", input: { path: asset.path, include_metadata_keys: false }, refs: {}, stageId: "select-media-probe", kind: "selector_resolve", now });
        bindPreflightLocalRef(plan, { id: "template.media.probe_file", input: { path: asset.path } }, execution, state);
      }
    }
    if (dryRun) {
      recordStage(stages, stageIdFor(program, "result_project"), "result_project", "completed", "Validated bounded targets without mutation.", state.evidenceRefs);
      const executableInput = {
        ...(object(request.input) ? structuredClone(request.input) : {}),
        dry_run: false,
        ...(plan.required_confirm_scope ? { confirm_scope: structuredClone(plan.required_confirm_scope) } : {}),
      };
      return success(program, request, startedAt, now, stages, state, "dry_run_completed", "Validated the registered Macro selection and risk without mutating the project.", {
        preview: plan.preview ?? {},
        mutation_skipped: true,
        required_confirm_scope: plan.required_confirm_scope ?? null,
        executable_retry: { id: request.id, input: executableInput },
        undo_policy: program.entry.undo_policy,
        source_media_deleted: false,
      });
    }

    if ((plan.mutation_requests ?? []).length > MAX_MUTATIONS) throw coded("PROJECT_WRITE_MUTATION_LIMIT", "The registered Macro exceeded its bounded mutation ceiling.");
    for (const mutation of plan.mutation_requests ?? []) {
      if (!program.templateIds.includes(mutation.id) || mutation.id.startsWith("macro.")) throw coded("PROJECT_WRITE_DEPENDENCY_REJECTED", `Rejected non-atomic dependency ${String(mutation.id)}.`);
      const resolvedRefs = await liveResolveRefs({ program, request, executeAtomic, stages, state, refs: mutation.refs ?? {}, now });
      const execution = await atomicStage({ program, request, executeAtomic, stages, state, id: mutation.id, input: mutation.input ?? {}, refs: resolvedRefs, stageId: `write-${stageToken(mutation.id)}`, kind: "template_execute", mutation, plan, now });
      rememberRefs(state, execution);
      bindMutationLocalRef(plan, mutation, execution, state);
      recordCompletedMutation(program, plan, state, mutation, resolvedRefs, execution);
    }
    let readbackFailure = null;
    if (program.entry.macro_id === ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID) {
      await verifyDeletedTargets({ program, plan, request, executeAtomic, stages, state, now });
    } else {
      for (const child of verificationReads(program, plan, state)) {
        const refs = await liveResolveRefs({
          program,
          request,
          executeAtomic,
          stages,
          state,
          refs: child.refs ?? {},
          allowProducedObjectRefs: true,
          now,
        });
        const execution = await atomicStage({ program, request, executeAtomic, stages, state, id: child.id, input: child.input ?? {}, refs, stageId: `verify-${stageToken(child.id)}`, kind: "verify", now });
        try {
          validateLayoutAnnotationVerification(program, plan, child, execution);
        } catch (error) {
          readbackFailure ??= error;
          continue;
        }
        recordProjectWriteReadback(state, execution);
      }
      try {
        if (program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID) {
          applyRoutingReadbackToChanges(state, plan);
        } else {
          applyProjectWriteReadbackToChanges(state);
        }
      } catch (error) {
        readbackFailure ??= error;
      }
    }
    const invalidation = invalidateProjectIndex(projectIndexRuntime, scopesFor(program.entry.macro_id, plan), now);
    if (invalidation?.ok === false) {
      state.indexUpdate = invalidation;
      applyProjectWriteIndexMaintenance(state.changes, "failed", invalidation);
      throw coded(
        invalidation.blockers?.[0]?.code ?? "PROJECT_WRITE_INDEX_INVALIDATION_FAILED",
        invalidation.blockers?.[0]?.message ?? "The write completed but affected Project Index scopes could not be marked stale.",
        invalidation.blockers,
      );
    }
    state.indexUpdate = invalidation;
    applyProjectWriteIndexMaintenance(state.changes, invalidation ? "completed" : "skipped", invalidation);
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, { used: true, freshness: "stale" });
    recordStage(
      stages,
      stageIdFor(program, "index_update"),
      "index_update",
      invalidation ? "completed" : "skipped",
      invalidation
        ? `Marked ${invalidation.scopes.length} affected Project Index scope(s) stale.`
        : "No configured Project Index runtime required invalidation.",
      [],
    );
    if (readbackFailure) throw readbackFailure;
    recordStage(stages, stageIdFor(program, "result_project"), "result_project", "completed", "Projected verified registered-write evidence.", state.evidenceRefs);
    return success(program, request, startedAt, now, stages, state, "completed", "Registered project write completed and required readback passed.", { preview: plan.preview ?? {}, undo_policy: program.entry.undo_policy, source_media_deleted: false, index_update: compactIndexUpdate(invalidation), outcome: projectWriteOutcome(state) });
  } catch (error) {
    const partial = state.writeAttempted === true || state.writeExecuted === true || state.changes.some((change) => change.mutation?.status === "completed");
    return failure(program, request, startedAt, now, stages, partial ? "partial_failure" : "failed", error.code ?? "PROJECT_WRITE_STAGE_FAILED", error.message ?? "A registered project-write stage failed.", error.blockers, {
      applied_change_count: state.changes.filter((change) => change.status === "applied").length,
      source_media_deleted: false,
      index_update: compactIndexUpdate(state.indexUpdate),
      outcome: projectWriteOutcome(state),
    }, state);
  }
}

function program({ macroId, programId, risk, undoPolicy, planner, templateIds, dryReads, confirmRequired = false, internalRoutingOnly = false }) {
  const stagePrefix = macroId.replace(/^macro\./u, "").replaceAll(".", "-");
  return {
    planner,
    stagePrefix,
    templateIds: Object.freeze([...new Set(templateIds)]),
    dryReads,
    confirmRequired,
    internalRoutingOnly,
    entry: {
      contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
      macro_id: macroId,
      program_id: programId,
      program_version: "1.0.0",
      implementation_status: "executable",
      risk,
      input_schema: { type: "object", additionalProperties: false },
      selector_policy: { task_shaped: true, canonical_refs_optional_at_public_boundary: true, live_reresolve_before_write: true },
      sqlite_policy: { mode: "invalidate_after_write", write_authority: false, identity_fields: ["project", "bridge_owner", "bridge_generation", "snapshot", "revision"] },
      dependencies: { template_ids: [...new Set(templateIds)], runtime_capabilities: [] },
      stages: [
        registryStage(`${stagePrefix}-selection`, "selector_resolve", "read"),
        registryStage(`${stagePrefix}-live-resolve`, "live_ref_resolve", "read"),
        registryStage(`${stagePrefix}-write`, "template_execute", risk, templateIds.find((id) => !id.includes(".read_") && !id.includes(".list_") && !id.includes(".resolve_") && !id.includes(".probe_"))),
        registryStage(`${stagePrefix}-verify`, "verify", "read"),
        registryStage(`${stagePrefix}-index-update`, "index_update", "read"),
        registryStage(`${stagePrefix}-result`, "result_project", "read"),
      ],
      undo_policy: undoPolicy,
      verification_policy: "required",
      dry_run_supported: true,
      result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
    },
  };
}

function registryStage(id, kind, risk, dependencyRef = undefined) {
  return { id, kind, risk, stop_on_error: true, ...(kind === "template_execute" ? { dependency_ref: dependencyRef } : {}) };
}
function read(id, input) { return { id, input, refs: {} }; }

async function liveResolveRefs({ program, request, executeAtomic, stages, state, refs, allowProducedObjectRefs = false, now }) {
  const resolved = {};
  for (const [key, value] of Object.entries(refs ?? {})) {
    resolved[key] = await resolveValue({
      program,
      request,
      executeAtomic,
      stages,
      state,
      key,
      value,
      allowProducedObjectRefs,
      now,
    });
  }
  return resolved;
}

async function resolveValue({ program, request, executeAtomic, stages, state, key, value, allowProducedObjectRefs, now }) {
  if (Array.isArray(value)) {
    return Promise.all(value.map((entry) => resolveValue({
      program,
      request,
      executeAtomic,
      stages,
      state,
      key,
      value: entry,
      allowProducedObjectRefs,
      now,
    })));
  }
  if (typeof value !== "string") return value;
  const local = state.localRefs.get(value);
  const candidate = local ?? value;
  if (allowProducedObjectRefs && local && state.objectRefs.has(candidate)) return candidate;
  if (candidate.startsWith("track:planned:") || candidate.startsWith("send:planned:") || candidate.startsWith("file:planned:")) throw coded("LIVE_REF_UNRESOLVED", `A planned ref was not produced by the registered program: ${candidate}.`);
  const resolver = resolverFor(key, candidate);
  if (!resolver) return candidate;
  if (!program.templateIds.includes(resolver.id)) throw coded("LIVE_REF_RESOLVER_REJECTED", `Resolver ${resolver.id} is outside the registered dependency set.`);
  const execution = await atomicStage({ program, request, executeAtomic, stages, state, id: resolver.id, input: resolver.input, refs: resolver.refs, stageId: `resolve-${stageToken(resolver.id)}`, kind: "live_ref_resolve", now });
  const canonical = canonicalRef(execution, candidate, {
    exact: requiresExactLiveIdentity(candidate),
  });
  if (!canonical || canonical.startsWith("track:planned:") || canonical.startsWith("send:planned:")) throw coded("LIVE_REF_RESOLUTION_FAILED", `The live resolver did not return a canonical ref for ${candidate}.`);
  return canonical;
}

function resolverFor(key, ref) {
  if (ref.startsWith("track:")) return { id: TRACK_RESOLVER_ID, input: { track_ref: ref }, refs: {} };
  if (ref.startsWith("item:")) return { id: ITEM_RESOLVER_ID, input: { ref }, refs: {} };
  if (ref.startsWith("send:")) return { id: SEND_RESOLVER_ID, input: { send_ref: ref }, refs: {} };
  if (ref.startsWith("marker:") || ref.startsWith("region:")) return { id: MARKER_REGION_RESOLVER_ID, input: { limit: 250 }, refs: {} };
  if (key === "source_file_ref" && ref.startsWith("file:")) return null;
  return null;
}

function parseExactFxOwner(ref) {
  const match = typeof ref === "string" ? /^fx:(track|take):guid:([^:]+):(\d+)$/u.exec(ref) : null;
  if (!match) return null;
  const slotIndex = Number(match[3]);
  if (!Number.isSafeInteger(slotIndex) || slotIndex < 0) return null;
  return { owner_kind: match[1], owner_ref: `${match[1]}:guid:${match[2]}`, slot_index: slotIndex };
}

function exactGuidObjectRef(kind, ref) {
  return { kind, ref, identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) } };
}

async function atomicStage({ program, request, executeAtomic, stages, state, id, input, refs, stageId, kind, mutation = null, plan = null, now }) {
  const materializedRefs = materializeRefs(refs, state);
  if (kind === "template_execute") state.writeAttempted = true;
  const execution = await executeAtomic({ id, input, refs: materializedRefs, context: request.context, budget: PROJECT_WRITE_INTERNAL_BUDGET, observeProjectIndex: false });
  const evidence = boundedProgramEvidenceRefs(program, evidenceRefs(execution));
  state.evidenceRefs.push(...evidence);
  const childVerification = execution?.verification ?? execution?.result?.verification;
  const verified = kind !== "template_execute" || childVerification?.status === "passed";
  recordStage(stages, stageIdFor(program, kind), kind, execution?.ok === true && verified ? "completed" : "failed", execution?.ok === true && verified ? `${id} completed.` : `${id} failed.`, evidence);
  if (execution?.ok !== true) {
    const childError = execution?.error ?? {};
    throw coded(childError.code ?? "PROJECT_WRITE_ATOMIC_FAILED", childError.message ?? `${id} failed through the managed atomic route.`, childError.blockers);
  }
  if (kind === "template_execute") state.writeExecuted = true;
  if (!verified) {
    recordUnverifiedMutation(program, plan, state, mutation, id, refs, execution);
    throw coded("PROJECT_WRITE_CHILD_VERIFICATION_FAILED", `${id} completed without passed accepted Template verification.`);
  }
  rememberRefs(state, execution);
  return execution;
}

function verificationReads(program, plan, state) {
  const reads = (plan.readback_requests ?? []).filter((entry) => !entry.id.startsWith("macro."));
  if (reads.length > 0) return reads;
  return program.dryReads;
}

function dryReadsForPlan(program, plan) {
  if (program.entry.macro_id === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID) return plan.preflight_requests ?? [];
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID) return program.dryReads;
  const reads = [...program.dryReads];
  for (const itemRef of plan.preview?.refs_by_kind?.items ?? []) {
    reads.push(read(ITEM_ID_RESOLVER_ID, { ref: itemRef }));
  }
  for (const fxRef of plan.preview?.refs_by_kind?.fx ?? []) {
    const parsed = parseExactFxOwner(fxRef);
    if (!parsed) continue;
    reads.push({
      id: FX_RESOLVER_ID,
      input: { owner_kind: parsed.owner_kind, slot_index: parsed.slot_index },
      refs: { [`${parsed.owner_kind}_ref`]: exactGuidObjectRef(parsed.owner_kind, parsed.owner_ref) },
    });
  }
  return reads;
}

function validateLayoutAnnotationPreflight(program, plan, child, execution) {
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID || child.id !== MARKER_REGION_RESOLVER_ID) return;
  const expected = (plan.preview?.rows ?? []).filter((row) => row.annotation === true);
  if (expected.length === 0) return;
  const summary = executionSummary(execution);
  const items = completeMarkerRegionItems(summary);
  if (items === null) {
    throw coded(
      "LAYOUT_ANNOTATION_PREFLIGHT_INCOMPLETE",
      "Timeline annotations require a complete non-truncated live Marker/Region read before any mutation.",
    );
  }
  if (items.length + expected.length > 50) {
    throw coded(
      "LAYOUT_ANNOTATION_READBACK_CAPACITY_EXCEEDED",
      "Creating these annotations would exceed the accepted Marker/Region read atom's 50-row complete-read ceiling, so row-specific post-write truth cannot be guaranteed.",
    );
  }
  for (const row of expected) {
    const sameName = items.find((item) => item?.kind === row.kind && item?.name === row.name);
    if (!sameName) continue;
    if (layoutAnnotationFieldsMatch(row, sameName)) {
      throw coded(
        "LAYOUT_ANNOTATION_ALREADY_EXISTS",
        `${row.kind} annotation ${row.id} already exists at the declared time; duplicate creation is blocked.`,
      );
    }
    throw coded(
      "LAYOUT_ANNOTATION_UPDATE_UNSUPPORTED",
      `${row.kind} annotation ${row.id} conflicts with an existing same-name row, and no accepted atom can move its position or change its bounds.`,
    );
  }
}

function validateRoutingPreflight(program, plan, child, execution, state) {
  if (program.entry.macro_id !== ALPHA3_2E_ROUTING_APPLY_MACRO_ID || child.id !== "template.routing.read_project_routing_graph") return;
  const graph = executionSummary(execution);
  if (graph.truncated === true) {
    throw coded("ROUTING_GRAPH_TRUNCATED", "Routing mutation requires the complete live graph; the preflight graph was truncated.");
  }
  if (graph.coverage_status !== "complete" || graph.coverage?.internally_complete !== true) {
    throw coded("ROUTING_GRAPH_COVERAGE_INCOMPLETE", "Routing mutation requires a complete live graph; REAPER graph enumeration was incomplete.");
  }
  if (!Array.isArray(graph.tracks) || !Array.isArray(graph.edges)) {
    throw coded("ROUTING_GRAPH_SHAPE_INVALID", "Routing mutation requires live tracks[] and edges[] arrays before the first write.");
  }
  if (!Number.isInteger(graph.returned_track_count) || graph.returned_track_count !== graph.tracks.length) {
    throw coded("ROUTING_GRAPH_TRACK_COUNT_MISMATCH", "Routing graph returned_track_count did not match the live tracks[] rows.");
  }
  if (!Number.isInteger(graph.track_count) || graph.track_count !== graph.tracks.length) {
    throw coded("ROUTING_GRAPH_TRACK_COVERAGE_INCOMPLETE", "Routing graph did not contain every live Track row.");
  }
  if (!Number.isInteger(graph.edge_count) || graph.edge_count !== graph.edges.length) {
    throw coded("ROUTING_GRAPH_EDGE_COUNT_MISMATCH", "Routing graph edge_count did not match the live edges[] rows.");
  }
  validateRoutingGraphTopology(plan, graph);
  state.routingPreflight = structuredClone(graph);
}

function validateRoutingGraphTopology(plan, graph) {
  const createRows = (plan.preview?.routes ?? []).filter((row) => row.action === "create");
  const liveEdges = graph.edges.filter((edge) => typeof edge?.source_track_ref === "string" && typeof edge?.destination_track_ref === "string");
  for (const row of createRows) {
    const duplicateCount = liveEdges.filter((edge) => edge.source_track_ref === row.source_track_ref && edge.destination_track_ref === row.destination_track_ref).length;
    if (duplicateCount > 0 && row.duplicate_policy !== "allow_duplicate") {
      throw coded("ROUTING_LIVE_DUPLICATE_EDGE", `Live routing already contains ${row.source_track_ref} -> ${row.destination_track_ref}; no write was dispatched.`);
    }
  }
  const combinedEdges = [
    ...liveEdges.map((edge) => ({ source: edge.source_track_ref, destination: edge.destination_track_ref, id: edge.send_ref ?? "live" })),
    ...createRows.map((row) => ({ source: row.source_track_ref, destination: row.destination_track_ref, id: row.id })),
  ];
  if (directedEdgesHaveCycle(combinedEdges)) {
    throw coded("ROUTING_LIVE_CYCLE", "The complete live graph plus requested creates contains a directed routing cycle; no write was dispatched.");
  }
}

function directedEdgesHaveCycle(edges) {
  const outgoing = new Map();
  for (const edge of edges) {
    if (typeof edge.source !== "string" || typeof edge.destination !== "string") continue;
    const destinations = outgoing.get(edge.source) ?? [];
    destinations.push(edge.destination);
    outgoing.set(edge.source, destinations);
  }
  const visiting = new Set();
  const visited = new Set();
  const visit = (node) => {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const destination of outgoing.get(node) ?? []) if (visit(destination)) return true;
    visiting.delete(node);
    visited.add(node);
    return false;
  };
  for (const node of outgoing.keys()) if (visit(node)) return true;
  return false;
}

function validateLayoutAnnotationVerification(program, plan, child, execution) {
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID || child.id !== MARKER_REGION_RESOLVER_ID) return;
  if (!(plan.preview?.rows ?? []).some((row) => row.annotation === true)) return;
  if (completeMarkerRegionItems(executionSummary(execution)) === null) {
    throw coded(
      "LAYOUT_ANNOTATION_READBACK_INCOMPLETE",
      "Timeline annotation writes completed, but the final live Marker/Region read was incomplete or truncated.",
    );
  }
}

function completeMarkerRegionItems(summary) {
  const items = Array.isArray(summary.items) ? summary.items : null;
  const markerCount = summary.marker_count;
  const regionCount = summary.region_count;
  return items !== null
    && summary.truncated === false
    && Number.isInteger(markerCount)
    && markerCount >= 0
    && Number.isInteger(regionCount)
    && regionCount >= 0
    && items.length === markerCount + regionCount
    ? items
    : null;
}

async function verifyDeletedTargets({ program, plan, request, executeAtomic, stages, state, now }) {
  const targets = deleteTargetsFromPlan(plan);
  const evidence = [];
  if (targets.tracks.length > 0) {
    const execution = await executeAtomic({
      id: "template.tracks.list_tracks",
      input: { limit: 250, include_selection: true },
      refs: {},
      context: request.context,
      budget: PROJECT_WRITE_INTERNAL_BUDGET,
      observeProjectIndex: false,
    });
    evidence.push(...evidenceRefs(execution));
    if (execution?.ok !== true) throw childExecutionError("template.tracks.list_tracks", execution);
    recordProjectWriteReadback(state, execution);
    const survivors = targets.tracks.filter((ref) => collectedRefs(execution).includes(ref));
    if (survivors.length > 0) throw coded("DELETE_TRACK_READBACK_SURVIVOR", "One or more confirmed track refs still exist after deletion.", survivors.map((ref) => ({ code: "DELETE_TRACK_READBACK_SURVIVOR", message: `Track survived deletion: ${ref}`, recoverable: true })));
  }
  for (const itemRef of targets.items) {
    const execution = await executeAtomic({
      id: ITEM_ID_RESOLVER_ID,
      input: { ref: itemRef },
      refs: {},
      context: request.context,
      budget: PROJECT_WRITE_INTERNAL_BUDGET,
      observeProjectIndex: false,
    });
    evidence.push(...evidenceRefs(execution));
    if (execution?.ok === true) throw coded("DELETE_ITEM_READBACK_SURVIVOR", `Confirmed item still resolves after deletion: ${itemRef}.`);
    const code = execution?.error?.code;
    if (!["ITEM_NOT_FOUND", "ITEM_REF_NOT_FOUND", "REF_NOT_FOUND"].includes(code)) {
      throw childExecutionError(ITEM_ID_RESOLVER_ID, execution);
    }
    state.readbackRefs.add(itemRef);
  }
  if (targets.markers.length > 0 || targets.regions.length > 0) {
    const execution = await executeAtomic({
      id: MARKER_REGION_RESOLVER_ID,
      input: { limit: 250 },
      refs: {},
      context: request.context,
      budget: PROJECT_WRITE_INTERNAL_BUDGET,
      observeProjectIndex: false,
    });
    evidence.push(...evidenceRefs(execution));
    if (execution?.ok !== true) throw childExecutionError(MARKER_REGION_RESOLVER_ID, execution);
    recordProjectWriteReadback(state, execution);
    const returned = new Set(collectedRefs(execution));
    const survivors = [...targets.markers, ...targets.regions].filter((ref) => returned.has(ref));
    if (survivors.length > 0) throw coded("DELETE_MARKER_REGION_READBACK_SURVIVOR", "One or more confirmed marker/region refs still exist after deletion.", survivors.map((ref) => ({ code: "DELETE_MARKER_REGION_READBACK_SURVIVOR", message: `Project object survived deletion: ${ref}`, recoverable: true })));
  }
  for (const change of state.changes) {
    if (change.mutation?.status !== "completed") continue;
    if (change.template_id === "template.fx.delete_fx") {
      if (change.live_readback?.status !== "passed") {
        throw coded("DELETE_FX_READBACK_MISSING", "An exact FX deletion completed without row-specific native absence readback.");
      }
      continue;
    }
    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: "live_absence_readback",
      evidence_refs: unique(evidence),
    };
  }
  state.evidenceRefs.push(...evidence);
  recordStage(
    stages,
    stageIdFor(program, "verify"),
    "verify",
    "completed",
    "Confirmed deleted track/item/marker/region refs and exact FX rows are absent through accepted live reads.",
    evidence,
  );
}

function deleteTargetsFromPlan(plan) {
  const result = { tracks: [], items: [], markers: [], regions: [], fx: [] };
  for (const mutation of plan.mutation_requests ?? []) {
    for (const ref of refsInValue(mutation.refs)) {
      if (ref.startsWith("track:")) result.tracks.push(ref);
      else if (ref.startsWith("item:")) result.items.push(ref);
      else if (ref.startsWith("marker:")) result.markers.push(ref);
      else if (ref.startsWith("region:")) result.regions.push(ref);
      else if (ref.startsWith("fx:")) result.fx.push(ref);
    }
  }
  return Object.fromEntries(Object.entries(result).map(([key, refs]) => [key, [...new Set(refs)]]));
}

function childExecutionError(id, execution) {
  return coded(
    execution?.error?.code ?? "PROJECT_WRITE_VERIFICATION_FAILED",
    execution?.error?.message ?? `${id} failed during required verification.`,
    execution?.error?.details?.blockers,
  );
}

function rememberRefs(state, execution) {
  for (const objectRef of executionObjectRefs(execution)) {
    state.objectRefs.set(objectRef.ref, structuredClone(objectRef));
  }
  for (const ref of collectedRefs(execution)) {
    state.canonicalRefs.push(ref);
    const planned = execution?.result?.summary?.planned_ref;
    if (typeof planned === "string") state.localRefs.set(planned, ref);
  }
  const summary = execution?.result?.summary ?? execution?.result?.readback ?? {};
  for (const [key, value] of Object.entries(summary)) {
    if (isCanonicalProjectRef(value)) state.localRefs.set(value, value);
    if (Array.isArray(value)) for (const ref of value) if (isCanonicalProjectRef(ref)) state.canonicalRefs.push(ref);
  }
}

function bindPreflightLocalRef(plan, child, execution, state) {
  if (child.id !== "template.media.probe_file") return;
  const asset = (plan.preview?.rows ?? []).find((row) => row.path === child.input?.path);
  const fileRef = firstCanonicalWithPrefix(execution, "file:");
  if (asset?.id && fileRef) state.localRefs.set(`file:planned:${asset.id}`, fileRef);
}

function bindMutationLocalRef(plan, mutation, execution, state) {
  const trackRef = firstCanonicalWithPrefix(execution, "track:");
  const itemRef = firstCanonicalWithPrefix(execution, "item:");
  const sendRef = firstCanonicalWithPrefix(execution, "send:");
  const markerRef = firstCanonicalWithPrefix(execution, "marker:");
  const regionRef = firstCanonicalWithPrefix(execution, "region:");
  if (mutation.produces_local_id && trackRef) state.localRefs.set(`track:planned:${mutation.produces_local_id}`, trackRef);
  if (mutation.produces_local_id && itemRef) state.localRefs.set(`item:planned:${mutation.produces_local_id}`, itemRef);
  if (mutation.produces_local_id && sendRef) state.localRefs.set(`send:planned:${mutation.produces_local_id}`, sendRef);
  if (mutation.produces_local_id && markerRef) state.localRefs.set(`marker:planned:${mutation.produces_local_id}`, markerRef);
  if (mutation.produces_local_id && regionRef) state.localRefs.set(`region:planned:${mutation.produces_local_id}`, regionRef);
  const assetId = /asset ([^ .]+)\.?$/u.exec(mutation.purpose ?? "")?.[1] ?? null;
  if (assetId && mutation.id === "template.tracks.create_track" && trackRef) state.localRefs.set(`track:planned:${assetId}`, trackRef);
  if (assetId && mutation.id.startsWith("template.media.import_file") && itemRef) state.localRefs.set(`item:planned:${assetId}`, itemRef);
  const routeId = /(?:route|send) ([^ .]+)\.?$/u.exec(mutation.purpose ?? "")?.[1] ?? null;
  if (routeId && mutation.id === "template.routing.create_track_send" && sendRef) state.localRefs.set(`send:planned:${routeId}`, sendRef);
  if (mutation.operation_id && mutation.id === "template.routing.create_track_send" && sendRef) {
    state.localRefs.set(`send:planned:${mutation.operation_id}`, sendRef);
    state.routingResolvedSends.set(mutation.operation_id, sendRef);
  }
}

function initializeLayoutOperationOutcomes(state, plan) {
  const projection = buildLayoutOperationProjection(plan);
  state.layoutOperations = {
    rowsById: new Map((plan.preview?.rows ?? []).map((row) => [row.id, row])),
    mutationRowIds: projection.mutationRowIds,
    changesById: new Map(projection.changes.map((change) => [change.operation_id, change])),
  };
  state.changes = projection.changes;
}

function initializeRoutingOperationOutcomes(state, plan) {
  const rows = routingOperationRows(plan);
  state.routingOperations = {
    rowsById: new Map(rows.map((row) => [row.id, row])),
    changesById: new Map(),
  };
  state.changes = rows.map((row) => {
    const totalCount = (plan.mutation_requests ?? []).filter((mutation) => mutation.operation_id === row.id).length;
    const change = {
      operation_id: row.id,
      operation_kind: row.operation_kind,
      target_ref: row.send_ref ?? row.track_ref ?? null,
      status: "pending",
      template_ids: uniqueUnbounded((plan.mutation_requests ?? []).filter((mutation) => mutation.operation_id === row.id).map((mutation) => mutation.id)),
      mutation: { status: "pending", completed_count: 0, total_count: totalCount },
      live_readback: { status: "pending" },
      index_maintenance: { status: "pending" },
    };
    state.routingOperations.changesById.set(row.id, change);
    return change;
  });
}

function routingOperationRows(plan) {
  return [
    ...(plan.preview?.routes ?? []).map((row) => ({ ...row, operation_kind: "route" })),
    ...(plan.preview?.master_parent ?? []).map((row) => ({ ...row, operation_kind: "master_parent" })),
    ...(plan.preview?.channel_counts ?? []).map((row) => ({ ...row, operation_kind: "channel_count" })),
  ];
}

function buildLayoutOperationProjection(plan, { projectedApplied = false } = {}) {
  const rows = plan.preview?.rows ?? [];
  const mutations = plan.mutation_requests ?? [];
  const mutationRowIds = new Map();
  const mutationsByRow = new Map(rows.map((row) => [row.id, []]));
  for (const mutation of mutations) {
    const rowIds = layoutRowIdsForMutation(rows, mutation);
    mutationRowIds.set(mutation.sequence, rowIds);
    for (const rowId of rowIds) mutationsByRow.get(rowId)?.push(mutation);
  }
  const changes = rows.map((row) => {
    const rowMutations = mutationsByRow.get(row.id) ?? [];
    const totalCount = rowMutations.length;
    return {
      operation_id: row.id,
      target_kind: row.annotation === true ? row.kind : "track",
      target_ref: row.track_ref ?? (projectedApplied ? projectedLayoutTargetRef(row) : null),
      status: projectedApplied ? "applied" : "pending",
      template_ids: uniqueUnbounded(rowMutations.map((mutation) => mutation.id)),
      mutation: {
        status: projectedApplied ? "completed" : "pending",
        completed_count: projectedApplied ? totalCount : 0,
        total_count: totalCount,
      },
      live_readback: { status: projectedApplied ? "passed" : "pending" },
      index_maintenance: { status: projectedApplied ? "skipped" : "pending" },
    };
  });
  return { changes, mutationRowIds };
}

function layoutRowIdsForMutation(rows, mutation) {
  const ids = [];
  for (const row of rows) {
    const target = row.track_ref ?? `track:planned:${row.id}`;
    if (mutation.produces_local_id === row.id || valueContainsExactString(mutation.refs, target)) ids.push(row.id);
  }
  return ids;
}

function valueContainsExactString(value, expected) {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((entry) => valueContainsExactString(entry, expected));
  if (object(value)) return Object.values(value).some((entry) => valueContainsExactString(entry, expected));
  return false;
}

function recordCompletedMutation(program, plan, state, mutation, resolvedRefs, execution) {
  if (program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID && state.routingOperations) {
    const change = state.routingOperations.changesById.get(mutation.operation_id);
    if (!change) return;
    const row = state.routingOperations.rowsById.get(mutation.operation_id);
    const sendRef = row?.action === "create"
      ? state.routingResolvedSends.get(row.id) ?? firstCanonicalWithPrefix(execution, "send:")
      : row?.send_ref;
    if (sendRef) change.target_ref = sendRef;
    change.mutation.completed_count += 1;
    const completed = change.mutation.completed_count === change.mutation.total_count;
    change.mutation.status = completed ? "completed" : "in_progress";
    change.status = completed ? "mutation_completed" : "mutation_in_progress";
    return;
  }
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID) {
    const deletionReadback = acceptedDeletionReadback(mutation, execution);
    state.changes.push({
      template_id: mutation.id,
      purpose: mutation.purpose ?? null,
      target_refs: unique([...refsInValue(resolvedRefs), ...collectedRefs(execution)]),
      status: deletionReadback ? "applied" : "mutation_completed",
      mutation: { status: "completed", verification_status: "passed" },
      live_readback: deletionReadback ?? { status: "pending" },
      index_maintenance: { status: "pending" },
    });
    return;
  }
  for (const change of layoutChangesForMutation(state, mutation)) {
    const row = state.layoutOperations.rowsById.get(change.operation_id);
    const targetRef = canonicalLayoutTargetRef(row, state, resolvedRefs, execution);
    if (targetRef) change.target_ref = targetRef;
    change.mutation.completed_count += 1;
    const completed = change.mutation.completed_count === change.mutation.total_count;
    change.mutation.status = completed ? "completed" : "in_progress";
    change.status = completed ? "mutation_completed" : "mutation_in_progress";
  }
}

function acceptedDeletionReadback(mutation, execution) {
  const summary = execution?.result?.summary ?? execution?.result?.readback ?? {};
  const expectedRefs = new Set(refsInValue(mutation.refs));
  if (mutation.id === "template.fx.delete_fx") {
    if (summary.readback_status !== "passed" || !expectedRefs.has(summary.deleted_fx_ref)) return null;
    return { status: "passed", source: "accepted_template_live_absence_readback", observed_ref: summary.deleted_fx_ref, evidence_refs: evidenceRefs(execution) };
  }
  if (mutation.id === "template.routing.remove_send") {
    if (summary.readback_status !== "passed" || !expectedRefs.has(summary.deleted_send_ref)) return null;
    return { status: "passed", source: "accepted_template_live_absence_readback", observed_ref: summary.deleted_send_ref, evidence_refs: evidenceRefs(execution) };
  }
  return null;
}

function recordUnverifiedMutation(program, plan, state, mutation, id, refs, execution) {
  if (program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID && mutation?.operation_id && state.routingOperations) {
    const change = state.routingOperations.changesById.get(mutation.operation_id);
    if (!change) return;
    change.status = "mutation_unverified";
    change.mutation.status = "unverified";
    change.mutation.verification_status = "failed";
    change.live_readback = { status: "not_run" };
    return;
  }
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID || !mutation || !state.layoutOperations) {
    state.changes.push({
      template_id: id,
      target_refs: refsInValue(refs),
      status: "mutation_unverified",
      mutation: { status: "completed", verification_status: "failed" },
      live_readback: { status: "not_run" },
      index_maintenance: { status: "pending" },
    });
    return;
  }
  for (const change of layoutChangesForMutation(state, mutation)) {
    const row = state.layoutOperations.rowsById.get(change.operation_id);
    const targetRef = canonicalLayoutTargetRef(row, state, refs, execution);
    if (targetRef) change.target_ref = targetRef;
    change.status = "mutation_unverified";
    change.mutation.status = "unverified";
    change.mutation.verification_status = "failed";
    change.live_readback = { status: "not_run" };
  }
}

function layoutChangesForMutation(state, mutation) {
  const rowIds = state.layoutOperations?.mutationRowIds.get(mutation.sequence) ?? [];
  return rowIds.map((rowId) => state.layoutOperations.changesById.get(rowId)).filter(Boolean);
}

function canonicalLayoutTargetRef(row, state, resolvedRefs, execution) {
  if (!row) return null;
  const prefix = row.annotation === true ? `${row.kind}:` : "track:";
  const plannedRef = `${prefix}planned:${row.id}`;
  const candidates = [
    state.localRefs.get(plannedRef),
    row.track_ref,
    ...refsInValue(resolvedRefs),
    ...collectedRefs(execution),
  ];
  return candidates.find((ref) => typeof ref === "string" && ref.startsWith(prefix) && !ref.startsWith(`${prefix}planned:`)) ?? null;
}

function projectedLayoutTargetRef(row) {
  if (row.annotation !== true) return LAYOUT_TARGET_REF_BUDGET_PLACEHOLDER;
  return row.kind === "region" ? REGION_TARGET_REF_BUDGET_PLACEHOLDER : MARKER_TARGET_REF_BUDGET_PLACEHOLDER;
}

function firstCanonicalWithPrefix(execution, prefix) {
  return collectedRefs(execution).find((ref) => ref.startsWith(prefix)) ?? null;
}

function rememberInputObjectRefs(state, refs) {
  const visit = (value) => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!object(value)) return;
    if (typeof value.kind === "string" && typeof value.ref === "string") {
      state.objectRefs.set(value.ref, structuredClone(value));
      return;
    }
    Object.values(value).forEach(visit);
  };
  visit(refs);
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
      const objectRef = state.objectRefs.get(value);
      if (!objectRef) throw coded("PROJECT_WRITE_OBJECT_REF_REQUIRED", `No live-resolved object ref is available for ${value}.`);
      return structuredClone(objectRef);
    }
    if (Array.isArray(value)) return value.map(materialize);
    if (object(value) && typeof value.kind === "string" && typeof value.ref === "string") return structuredClone(value);
    if (object(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]));
    return value;
  };
  return materialize(refs ?? {});
}

function collectedRefs(execution) {
  const output = [];
  const visit = (value) => {
    if (isCanonicalProjectRef(value)) output.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (value && typeof value === "object") Object.values(value).forEach(visit);
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.readback);
  visit(execution?.result?.summary);
  return [...new Set(output)].slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count);
}

function canonicalRef(execution, fallback, { exact = false } = {}) {
  const refs = collectedRefs(execution);
  if (exact) return refs.includes(fallback) ? fallback : null;
  return refs.find((ref) => ref.split(":", 1)[0] === fallback.split(":", 1)[0]) ?? null;
}

function requiresExactLiveIdentity(ref) {
  return typeof ref === "string" && (
    ref.includes(":guid:")
    || ref.startsWith("marker:")
    || ref.startsWith("region:")
    || ref.startsWith("send:")
  );
}

function refsInValue(value) {
  const refs = [];
  const visit = (entry) => {
    if (isCanonicalProjectRef(entry)) refs.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (object(entry)) {
      if (typeof entry.ref === "string") visit(entry.ref);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  return unique(refs);
}

function recordProjectWriteReadback(state, execution) {
  for (const ref of collectedRefs(execution)) state.readbackRefs.add(ref);
  const summary = executionSummary(execution);
  for (const row of Array.isArray(summary.items) ? summary.items : []) {
    const ref = row?.kind === "region" ? row.region_ref : row?.marker_ref;
    if (typeof ref === "string") state.markerRegionReadbackRows.set(ref, structuredClone(row));
  }
  if (typeof summary.track_ref === "string" && Array.isArray(summary.sends)) {
    state.routingReadbackRows.set(summary.track_ref, structuredClone(summary));
  }
  state.readbackEvidenceRefs.push(...evidenceRefs(execution));
}

function executionSummary(execution) {
  return execution?.result?.summary ?? execution?.result?.readback ?? {};
}

function verifyLayoutAnnotationRow(expected, targetRef, rowsByRef) {
  if (typeof targetRef !== "string") {
    return {
      ok: false,
      status: "readback_missing",
      code: "PROJECT_WRITE_ROW_READBACK_MISSING",
      message: `Created annotation ${expected.id} returned no exact canonical ref.`,
      mismatchedFields: ["target_ref"],
    };
  }
  const observed = rowsByRef.get(targetRef);
  if (!observed) {
    return {
      ok: false,
      status: "readback_missing",
      code: "PROJECT_WRITE_ROW_READBACK_MISSING",
      message: `No exact live Marker/Region row matched ${expected.id} at ${targetRef}.`,
      mismatchedFields: ["target_ref"],
    };
  }
  const mismatchedFields = annotationMismatchedFields(expected, observed);
  if (mismatchedFields.length > 0) {
    return {
      ok: false,
      status: "readback_mismatch",
      code: "PROJECT_WRITE_ROW_READBACK_MISMATCH",
      message: `Live Marker/Region fields did not match ${expected.id}: ${mismatchedFields.join(", ")}.`,
      mismatchedFields,
    };
  }
  return { ok: true, mismatchedFields: [] };
}

function layoutAnnotationFieldsMatch(expected, observed) {
  return annotationMismatchedFields(expected, observed).length === 0;
}

function annotationMismatchedFields(expected, observed) {
  const mismatched = [];
  if (observed?.kind !== expected.kind) mismatched.push("kind");
  if (observed?.name !== expected.name) mismatched.push("name");
  if (expected.kind === "marker") {
    if (!numbersMatch(observed?.position_seconds, expected.position_seconds)) mismatched.push("position_seconds");
  } else {
    if (!numbersMatch(observed?.position_seconds, expected.start_seconds)) mismatched.push("start_seconds");
    if (!numbersMatch(observed?.end_seconds, expected.end_seconds)) mismatched.push("end_seconds");
  }
  return mismatched;
}

function numbersMatch(left, right) {
  return typeof left === "number" && Number.isFinite(left)
    && typeof right === "number" && Number.isFinite(right)
    && Math.abs(left - right) <= 0.000001;
}

function applyProjectWriteReadbackToChanges(state) {
  const missing = [];
  for (const change of state.changes) {
    if (change.mutation?.status !== "completed") continue;
    if (change.live_readback?.status === "passed") continue;
    const targetRefs = typeof change.target_ref === "string" ? [change.target_ref] : change.target_refs ?? [];
    const layoutRow = change.operation_id ? state.layoutOperations?.rowsById.get(change.operation_id) : null;
    if (layoutRow?.annotation === true) {
      const annotation = verifyLayoutAnnotationRow(layoutRow, change.target_ref, state.markerRegionReadbackRows);
      if (!annotation.ok) {
        change.status = annotation.status;
        change.live_readback = { status: "failed", source: "live_marker_region_readback", mismatched_fields: annotation.mismatchedFields };
        missing.push({ ...change, readbackCode: annotation.code, readbackMessage: annotation.message });
        continue;
      }
      change.status = "applied";
      change.live_readback = { status: "passed", source: "live_marker_region_readback", observed_ref: change.target_ref };
      continue;
    }
    const matchedRefs = targetRefs.filter((ref) => state.readbackRefs.has(ref));
    if (matchedRefs.length === 0) {
      change.status = "readback_missing";
      change.live_readback = change.operation_id
        ? { status: "failed" }
        : { status: "failed", source: "live_project_readback", matched_refs: [] };
      missing.push(change);
      continue;
    }
    change.status = "applied";
    change.live_readback = change.operation_id
      ? { status: "passed" }
      : {
          status: "passed",
          source: "live_project_readback",
          matched_refs: matchedRefs,
          evidence_refs: unique(state.readbackEvidenceRefs),
        };
  }
  if (missing.length > 0) {
    const mismatch = missing.find((change) => change.readbackCode === "PROJECT_WRITE_ROW_READBACK_MISMATCH");
    throw coded(
      mismatch ? "PROJECT_WRITE_ROW_READBACK_MISMATCH" : "PROJECT_WRITE_ROW_READBACK_MISSING",
      mismatch?.readbackMessage ?? `${missing.length} mutation row(s) had no exact live readback match.`,
      missing.map((change) => ({
        code: change.readbackCode ?? "PROJECT_WRITE_ROW_READBACK_MISSING",
        message: change.readbackMessage ?? `No exact live readback matched ${change.operation_id ?? change.template_id}.`,
        recoverable: true,
      })),
    );
  }
}

function applyRoutingReadbackToChanges(state, plan) {
  const failures = [];
  for (const change of state.changes) {
    if (change.mutation?.status !== "completed") continue;
    const expected = state.routingOperations?.rowsById.get(change.operation_id);
    const verification = verifyRoutingOperation(expected, state);
    if (!verification.ok) {
      change.status = verification.status;
      change.live_readback = {
        status: "failed",
        source: "live_track_routing_readback",
        mismatched_fields: verification.mismatchedFields,
      };
      failures.push({ code: verification.code, message: verification.message, recoverable: true });
      continue;
    }
    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: "live_track_routing_readback",
      observed_ref: verification.observedRef,
    };
  }
  if (failures.length > 0) {
    throw coded(failures[0].code, failures[0].message, failures);
  }
}

function verifyRoutingOperation(expected, state) {
  if (!expected) return routingReadbackFailure("ROUTING_OPERATION_READBACK_MISSING", "readback_missing", "No routing operation definition was retained for live verification.", ["operation_id"]);
  if (expected.operation_kind === "route") return verifyRoutingRoute(expected, state);
  const track = state.routingReadbackRows.get(expected.track_ref);
  if (!completeRoutingTrackReadback(track)) {
    return routingReadbackFailure("ROUTING_TRACK_READBACK_INCOMPLETE", "readback_missing", `Complete routing readback was unavailable for ${expected.track_ref}.`, ["track_ref", "truncated", "coverage"]);
  }
  if (expected.operation_kind === "master_parent") {
    if (track.master_parent_enabled !== expected.enabled) return routingReadbackFailure("ROUTING_MASTER_PARENT_READBACK_MISMATCH", "readback_mismatch", `Master-parent readback did not match ${expected.id}.`, ["master_parent_enabled"]);
    return { ok: true, observedRef: expected.track_ref };
  }
  if (track.channel_count !== expected.channel_count) return routingReadbackFailure("ROUTING_CHANNEL_COUNT_READBACK_MISMATCH", "readback_mismatch", `Channel-count readback did not match ${expected.id}.`, ["channel_count"]);
  return { ok: true, observedRef: expected.track_ref };
}

function verifyRoutingRoute(expected, state) {
  const sourceTrackRef = expected.source_track_ref ?? parseSourceTrackRefFromSendRef(expected.send_ref);
  const track = sourceTrackRef ? state.routingReadbackRows.get(sourceTrackRef) : null;
  if (!completeRoutingTrackReadback(track) || !Array.isArray(track.sends)) {
    return routingReadbackFailure("ROUTING_TRACK_READBACK_INCOMPLETE", "readback_missing", `Complete source routing readback was unavailable for ${expected.id}.`, ["source_track_ref", "truncated", "coverage"]);
  }
  if (expected.action === "delete") {
    if (track.sends.some((send) => send?.send_ref === expected.send_ref)) return routingReadbackFailure("ROUTING_DELETE_READBACK_MISMATCH", "readback_mismatch", `Deleted send ${expected.send_ref} is still present.`, ["send_ref"]);
    return { ok: true, observedRef: expected.send_ref };
  }
  const sendRef = expected.action === "create" ? state.routingResolvedSends.get(expected.id) : expected.send_ref;
  if (typeof sendRef !== "string") return routingReadbackFailure("ROUTING_SEND_IDENTITY_MISSING", "readback_missing", `No exact send ref was bound to ${expected.id}.`, ["send_ref"]);
  const matches = track.sends.filter((send) => send?.send_ref === sendRef);
  if (matches.length === 0) return routingReadbackFailure("ROUTING_SEND_READBACK_MISSING", "readback_missing", `No exact live send matched ${expected.id} at ${sendRef}.`, ["send_ref"]);
  if (matches.length > 1) return routingReadbackFailure("ROUTING_SEND_READBACK_MULTIPLE", "readback_mismatch", `More than one live row claimed exact send ${sendRef}.`, ["send_ref"]);
  const send = matches[0];
  const mismatchedFields = [];
  if (expected.source_track_ref !== null && expected.source_track_ref !== undefined && send.source_track_ref !== expected.source_track_ref) mismatchedFields.push("source_track_ref");
  if (expected.destination_track_ref !== null && expected.destination_track_ref !== undefined && send.destination_track_ref !== expected.destination_track_ref) mismatchedFields.push("destination_track_ref");
  if (expected.volume !== undefined && !numbersMatch(send.volume, expected.volume)) mismatchedFields.push("volume");
  if (expected.pan !== undefined && !numbersMatch(send.pan, expected.pan)) mismatchedFields.push("pan");
  if (expected.muted !== undefined && send.muted !== expected.muted) mismatchedFields.push("muted");
  if (mismatchedFields.length > 0) return routingReadbackFailure("ROUTING_SEND_READBACK_MISMATCH", "readback_mismatch", `Live send fields did not match ${expected.id}: ${mismatchedFields.join(", ")}.`, mismatchedFields);
  return { ok: true, observedRef: sendRef };
}

function completeRoutingTrackReadback(track) {
  return Boolean(
    track
    && track.truncated !== true
    && track.coverage_status === "complete"
    && track.coverage?.internally_complete === true,
  );
}

function parseSourceTrackRefFromSendRef(sendRef) {
  const match = typeof sendRef === "string" ? /^send:(track:guid:[^:]+):\d+$/u.exec(sendRef) : null;
  return match?.[1] ?? null;
}

function routingReadbackFailure(code, status, message, mismatchedFields) {
  return { ok: false, code, status, message, mismatchedFields };
}

function applyProjectWriteIndexMaintenance(changes, status, invalidation) {
  for (const change of changes) {
    if (change.mutation?.status !== "completed") continue;
    change.index_maintenance = change.operation_id
      ? {
          status,
          ...(invalidation?.blockers?.[0]?.code ? { blocker_code: invalidation.blockers[0].code } : {}),
        }
      : {
          status,
          scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
          blocker_code: invalidation?.blockers?.[0]?.code ?? null,
        };
  }
}

function projectWriteOutcome(state) {
  const changes = state.changes.filter((change) => change.mutation?.status === "completed");
  const readbackPassed = changes.filter((change) => change.live_readback?.status === "passed").length;
  const indexStatuses = [...new Set(changes.map((change) => change.index_maintenance?.status).filter(Boolean))];
  return {
    mutation: { status: changes.length > 0 ? "completed" : "not_run", completed_count: changes.length },
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

function success(program, request, startedAt, now, stages, state, status, summary, data) {
  return finalize({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: identity(program), request: requestSummary(request),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: state.sqlite ?? sqliteEvidence(),
    result: { summary, canonical_refs: projectedCanonicalRefs(program, state), changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count), verification: { status: "passed", evidence_refs: projectedEvidenceRefs(program, state.evidenceRefs) }, data: projectResultData(program, request, data) },
    blockers: [], error: null, recovery: null,
    budget: { max_bytes: program.entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function failure(program, request, startedAt, now, stages, status, code, message, blockers = [], data = {}, state = { evidenceRefs: [], changes: [], canonicalRefs: [] }) {
  const verifiedByLiveReadback = state.changes.length > 0
    && state.changes.every((change) => change.live_readback?.status === "passed");
  return finalize({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: identity(program), request: requestSummary(request, { forceNonDry: true }),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: state.sqlite ?? sqliteEvidence(),
    result: { summary: message, canonical_refs: projectedCanonicalRefs(program, state), changes: state.changes.slice(0, MACRO_CONTRACT_CEILINGS.change_max_count), verification: { status: verifiedByLiveReadback ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: verifiedByLiveReadback || status === "partial_failure" ? projectedEvidenceRefs(program, state.evidenceRefs) : [] }, data: projectResultData(program, request, data) },
    blockers: boundedBlockers(blockers.length ? blockers : [{ code, message, recoverable: true }]),
    error: { code, message, recoverable: true },
    recovery: recoveryForFailure(program, status, code),
    budget: { max_bytes: program.entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function recoveryForFailure(program, status, code) {
  const partialChangesPossible = status === "partial_failure";
  if (program.entry.macro_id === ALPHA3_2E_ROUTING_APPLY_MACRO_ID) {
    return {
      undo_policy: program.entry.undo_policy,
      partial_changes_possible: partialChangesPossible,
      source_media_deleted: false,
      replay_policy: partialChangesPossible ? "do_not_replay" : "correct_and_retry",
      action: partialChangesPossible
        ? "Do not replay the routing request. Inspect the current complete live graph and reported changes, then use the single undo scope or issue a newly previewed correction."
        : `No routing mutation was dispatched for ${code}; correct the blocker, rerun dry-run with the same operations, then execute that same input with only dry_run changed to false.`,
    };
  }
  return { undo_policy: program.entry.undo_policy, partial_changes_possible: partialChangesPossible, source_media_deleted: false, action: "Inspect reported stage evidence, use the project undo scope where available, then retry only after live refs are current." };
}

function finalize(envelope) {
  const result = structuredClone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.2.5-C Macro envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}
function stage(id, kind, status, summary, evidence_refs) { return { id, kind, status, summary, evidence_refs: projectedStageEvidenceRefs(id, evidence_refs) }; }
function recordStage(stages, id, kind, status, summary, evidenceRefs) {
  const existing = stages.find((entry) => entry.id === id && entry.kind === kind);
  if (!existing) {
    if (stages.length < MACRO_CONTRACT_CEILINGS.stage_summary_max_count) stages.push(stage(id, kind, status, summary, evidenceRefs));
    return;
  }
  existing.status = status === "failed" ? "failed" : existing.status;
  existing.evidence_refs = projectedStageEvidenceRefs(id, [...existing.evidence_refs, ...evidenceRefs]);
  existing.summary = `${id} executed through the fixed registered dependency.`;
}
function identity(program) { const entry = program.entry; return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk }; }
function requestSummary(request, { forceNonDry = false } = {}) { const context = request.context ?? {}; return { request_id: ["macro", request.id ?? "unknown", context.session_id ?? "session", context.request_sequence ?? 0].join(":"), dry_run: forceNonDry ? false : request.input?.dry_run !== false }; }
function macroRequest(request) { return { macro_id: request.id, input: object(request.input) ? request.input : {}, refs: request.refs ?? [], dry_run: request.input?.dry_run !== false, ...(request.idempotency_key ? { idempotency_key: request.idempotency_key } : {}) }; }
function evidenceRefs(execution) { return unique([execution?.request?.id, ...collectedRefs(execution).filter((ref) => ref.startsWith("artifact:"))].filter((ref) => typeof ref === "string")); }
function firstCode(plan, fallback) { return plan?.blockers?.find((entry) => typeof entry?.code === "string")?.code ?? fallback; }
function boundedBlockers(entries) { return entries.slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count).map((entry) => ({ code: entry?.code ?? "PROJECT_WRITE_BLOCKED", message: entry?.message ?? String(entry), recoverable: entry?.recoverable !== false })); }
function layoutResponseBudgetBlocker(program, request, plan) {
  const projection = buildLayoutOperationProjection(plan, { projectedApplied: true });
  const sampleEvidenceRefs = Array.from({ length: LAYOUT_EVIDENCE_REF_MAX_COUNT }, (_, index) => `request:${String(index).padStart(2, "0")}:${"x".repeat(LAYOUT_EVIDENCE_REF_MAX_BYTES - 11)}`);
  const stages = program.entry.stages.map((entry) => stage(entry.id, entry.kind, "completed", "Projected bounded layout stage.", sampleEvidenceRefs));
  const data = projectResultData(program, request, {
    preview: plan.preview ?? {},
    undo_policy: program.entry.undo_policy,
    source_media_deleted: false,
    index_update: null,
    outcome: projectedLayoutOutcome(projection.changes),
  });
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: identity(program),
    request: requestSummary(request),
    execution: { status: "completed", started_at: new Date(0).toISOString(), completed_at: new Date(0).toISOString(), stage_count: stages.length, stages },
    sqlite: sqliteEvidence(),
    result: { summary: "Registered project write completed and required readback passed.", canonical_refs: [], changes: projection.changes, verification: { status: "passed", evidence_refs: sampleEvidenceRefs }, data },
    blockers: [],
    error: null,
    recovery: null,
    budget: { max_bytes: program.entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  const inline = JSON.stringify({ stages, changes: projection.changes, data, blockers: [], error: null, recovery: null });
  const inlineBytes = Buffer.byteLength(inline, "utf8") + LAYOUT_RESPONSE_BUDGET_RESERVE_BYTES;
  const envelopeBytes = Buffer.byteLength(JSON.stringify(envelope), "utf8") + LAYOUT_RESPONSE_BUDGET_RESERVE_BYTES;
  const requestedEnvelopeBytes = Number.isInteger(request.budget?.max_response_bytes) && request.budget.max_response_bytes > 0
    ? request.budget.max_response_bytes
    : program.entry.result_budget.max_bytes;
  const maxEnvelopeBytes = Math.min(MACRO_CONTRACT_CEILINGS.envelope_max_bytes, requestedEnvelopeBytes);
  if (inlineBytes <= MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes && envelopeBytes <= maxEnvelopeBytes) return null;
  return {
    code: "PROJECT_WRITE_RESPONSE_BUDGET_EXCEEDED",
    message: `The compact per-layout-row result would exceed the active response contract (${inlineBytes} inline bytes projected; ${envelopeBytes} envelope bytes projected; ${maxEnvelopeBytes} envelope bytes available). Split the layout into smaller calls or raise only the public response projection budget before mutation.`,
    recoverable: true,
  };
}
function projectedLayoutOutcome(changes) {
  return {
    mutation: { status: "completed", completed_count: changes.length },
    live_readback: { status: "passed", passed_count: changes.length, total_count: changes.length },
    index_maintenance: { status: "skipped", scopes: [], blocker_code: null },
  };
}
function projectedCanonicalRefs(program, state) {
  return program.entry.macro_id === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID ? [] : unique(state.canonicalRefs);
}
function boundedProgramEvidenceRefs(program, refs) {
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID) return refs;
  return refs.filter((ref) => Buffer.byteLength(ref, "utf8") <= LAYOUT_EVIDENCE_REF_MAX_BYTES);
}
function projectedEvidenceRefs(program, refs) {
  const values = unique(refs);
  return program.entry.macro_id === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID ? values.slice(0, LAYOUT_EVIDENCE_REF_MAX_COUNT) : values;
}
function projectedStageEvidenceRefs(id, refs) {
  const values = unique(refs);
  return String(id).startsWith("project-apply_layout-") ? values.slice(0, LAYOUT_EVIDENCE_REF_MAX_COUNT) : values;
}
function projectResultData(program, request, data) {
  if (program.entry.macro_id !== ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID || request.input?.dry_run !== false) return compactData(data);
  const cloned = structuredClone(object(data) ? data : {});
  const preview = object(cloned.preview) ? cloned.preview : {};
  return {
    preview: {
      target_counts: preview.target_counts ?? {},
      total_count: preview.target_counts?.rows ?? null,
    },
    ...(cloned.applied_change_count !== undefined ? { applied_change_count: cloned.applied_change_count } : {}),
    ...(cloned.undo_policy !== undefined ? { undo_policy: cloned.undo_policy } : {}),
    source_media_deleted: false,
    ...(cloned.index_update !== undefined ? { index_update: cloned.index_update } : {}),
    ...(cloned.outcome !== undefined ? { outcome: cloned.outcome } : {}),
  };
}
function compactData(data) {
  const cloned = structuredClone(object(data) ? data : {});
  if (Buffer.byteLength(JSON.stringify(cloned), "utf8") <= 16_000) return cloned;
  const preview = object(cloned.preview) ? cloned.preview : {};
  return {
    compacted: true,
    preview: {
      target_counts: preview.target_counts ?? preview.target_counts_by_kind ?? {},
      total_count: preview.total_count ?? null,
      target_hash: preview.target_hash ?? null,
    },
    undo_policy: cloned.undo_policy,
    source_media_deleted: false,
  };
}
function stageToken(id) { return String(id).replace(/^template\./u, "").replaceAll(".", "-"); }
function stageIdFor(program, kind) {
  if (kind === "selector_resolve") return `${program.stagePrefix}-selection`;
  if (kind === "live_ref_resolve") return `${program.stagePrefix}-live-resolve`;
  if (kind === "template_execute") return `${program.stagePrefix}-write`;
  if (kind === "verify") return `${program.stagePrefix}-verify`;
  if (kind === "index_update") return `${program.stagePrefix}-index-update`;
  return `${program.stagePrefix}-result`;
}
function scopesFor(macroId, plan) {
  if (macroId === ALPHA3_2E_PROJECT_LAYOUT_MACRO_ID) {
    const scopes = [];
    if ((plan.preview?.target_counts?.layout_rows ?? 0) > 0) scopes.push("tracks");
    if ((plan.preview?.target_counts?.annotations ?? 0) > 0) scopes.push("markers");
    return scopes;
  }
  if (macroId === ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID) return ["tracks", "items", "takes", "markers", "media"];
  if (macroId === ALPHA3_2E_ROUTING_APPLY_MACRO_ID) return ["routing", "tracks"];
  const targets = deleteTargetsFromPlan(plan);
  const scopes = [];
  if (targets.tracks.length > 0) scopes.push("tracks");
  if (targets.items.length > 0) scopes.push("items", "takes");
  if (targets.markers.length > 0 || targets.regions.length > 0) scopes.push("markers");
  if (targets.fx.length > 0) scopes.push("fx", "tracks", "takes", "automation");
  return [...new Set(scopes)];
}
function invalidateProjectIndex(runtime, scopes, now) {
  if (typeof runtime?.invalidateScopes !== "function" || scopes.length === 0) return null;
  return runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
}
function sqliteEvidence(runtime = null, { used = false, freshness = "not_applicable" } = {}) {
  const status = typeof runtime?.status === "function" ? runtime.status() : {};
  const revision = status.revision ?? status.project_revision ?? null;
  return {
    used,
    source: used ? "warm_index" : "not_used",
    freshness: used ? freshness : "not_applicable",
    snapshot_ref: used ? status.snapshot_id ?? null : null,
    revision: used && revision !== null ? String(revision) : null,
    refreshed: false,
  };
}
function compactIndexUpdate(value) {
  if (!value) return null;
  return {
    status: value.status ?? null,
    scopes: Array.isArray(value.scopes) ? value.scopes.slice(0, 16) : [],
    snapshot_id: value.snapshot_id ?? null,
    revision: value.revision ?? null,
  };
}
function unique(values) { return [...new Set((values ?? []).filter((value) => typeof value === "string"))].slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count); }
function uniqueUnbounded(values) { return [...new Set((values ?? []).filter((value) => typeof value === "string"))]; }
function isCanonicalProjectRef(value) {
  if (typeof value !== "string" || /[\u0000-\u001f\u007f|]/u.test(value)) return false;
  if (/^track:guid:\{[^{}:]+\}:\d+$/u.test(value)) return false;
  return /^(?:track|item|take|fx|send|file|marker|region):[^\s]+$/u.test(value);
}
function safeNowIso(now) { try { const value = now(); const date = value instanceof Date ? value : new Date(value); if (!Number.isNaN(date.getTime())) return date.toISOString(); } catch {} return new Date(0).toISOString(); }
function coded(code, message, blockers) { const error = new Error(message); error.code = code; error.blockers = blockers; return error; }
function object(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); for (const child of Object.values(value)) deepFreeze(child); } return value; }
