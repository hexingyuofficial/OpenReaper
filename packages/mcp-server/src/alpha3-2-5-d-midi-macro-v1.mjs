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

export const ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID = "macro.midi.create_clip";
export const ALPHA3_2_5_D_MIDI_MACRO_CONTRACT = "alpha3.2.5.d.midi_macro.v1";
export const ALPHA3_2_5_D_MIDI_TEMPLATE_IDS = Object.freeze([
  "template.tracks.resolve_track_ref",
  "template.midi.create_midi_item",
  "template.midi.insert_notes_batch",
  "template.midi.resolve_midi_take_ref",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
]);

const TRACK_RESOLVER_ID = "template.tracks.resolve_track_ref";
const CREATE_ITEM_ID = "template.midi.create_midi_item";
const INSERT_NOTES_ID = "template.midi.insert_notes_batch";
const RESOLVE_TAKE_ID = "template.midi.resolve_midi_take_ref";
const COUNT_NOTES_ID = "template.midi.read_take_event_counts";
const LIST_NOTES_ID = "template.midi.list_take_notes";
const PROJECT_QUERY_ID = "macro.project.query";
const PROJECT_INDEX_RUNTIME_CAPABILITY = "project_index.runtime.v1";
const PROJECT_UNDERSTANDING_RUNTIME_CAPABILITY = "project_understanding.runtime.v1";
const INPUT_FIELDS = new Set(["start_seconds", "end_seconds", "notes", "selector", "dry_run"]);
const MIN_RESPONSE_BUDGET = 2_048;
const MAX_NOTES = 128;
const MAX_NOTE_PAGE = 64;
const MAX_NOTE_VERIFICATION_PAGES = Math.ceil(MAX_NOTES / MAX_NOTE_PAGE);
const INTERNAL_ATOMIC_BUDGET = Object.freeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: MAX_NOTE_PAGE,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});
const TRACK_SCOPES = Object.freeze(["items", "takes", "selection"]);

const REGISTRY_ENTRIES = Object.freeze([{
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
  program_id: "openreaper.macro.midi.create_clip",
  program_version: "1.0.0",
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      notes: { type: "array", maxItems: MAX_NOTES },
      selector: { type: "object" },
      dry_run: { type: "boolean" },
    },
    required: ["start_seconds", "end_seconds", "notes"],
  },
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
    template_ids: ALPHA3_2_5_D_MIDI_TEMPLATE_IDS,
    runtime_capabilities: [PROJECT_INDEX_RUNTIME_CAPABILITY, PROJECT_UNDERSTANDING_RUNTIME_CAPABILITY],
  },
  stages: [
    { id: "midi-create-clip-select-track", kind: "selector_resolve", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-live-resolve", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-create-item", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: CREATE_ITEM_ID },
    { id: "midi-create-clip-insert-notes", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: INSERT_NOTES_ID },
    { id: "midi-create-clip-resolve-take", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-verify-count", kind: "verify", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-verify-list", kind: "verify", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-index-update", kind: "index_update", risk: "read", stop_on_error: true },
    { id: "midi-create-clip-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
}]);

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRIES[0].stages.map((stage) => stage.id));

export function createAlpha3_2_5DMidiMacroRegistry(options = {}) {
  return createMacroProgramRegistry(REGISTRY_ENTRIES, {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_2_5_D_MIDI_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [PROJECT_INDEX_RUNTIME_CAPABILITY, PROJECT_UNDERSTANDING_RUNTIME_CAPABILITY],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_2_5_D_MIDI_MACRO_REGISTRY = createAlpha3_2_5DMidiMacroRegistry();

export function isAlpha3_2_5DMidiMacroId(id) {
  return id === ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID;
}

export function createAlpha3_2_5DMidiMacroDiscoveryItem({ liveRunnableNow = false } = {}) {
  return deepFreeze({
    id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
    title: "Create MIDI clip",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.midi",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "midi_create_clip",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable_runtime_bound",
    live_runnable_now: liveRunnableNow,
    user_label: "Create MIDI clip",
    tags: ["macro", "midi", "clip", "create", "notes", "ppq", "alpha3_2_5_d"],
    task_intents: ["create a MIDI clip", "write MIDI notes", "add a melody", "make a bounded MIDI item"],
    summary: "Create one bounded PPQ MIDI clip on an existing track and verify its notes.",
    inputSchema: REGISTRY_ENTRIES[0].input_schema,
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
      output: [
        { name: "item_ref", kind: "item", required: true, summary: "The created MIDI item ref." },
        { name: "take_ref", kind: "take", required: true, summary: "The created active MIDI take ref." },
      ],
    },
    expectedDelta: {
      kind: "write",
      action: "create_midi_clip",
      entities: ["item", "take", "midi_note"],
      summary: "Creates one MIDI item, inserts bounded PPQ notes, and verifies exact count/list readback.",
    },
    examples: [{
      input: {
        start_seconds: 0,
        end_seconds: 2,
        notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
        selector: { name: "Instrument" },
        dry_run: false,
      },
      refs: {},
    }],
    exists_in_catalog: true,
    evidence_level: liveRunnableNow ? "runtime_bound_live_route_available" : "runtime_bound_executable",
    support_state: "supported",
    known_blocker: null,
    allowed_live_group: null,
  });
}

export async function executeAlpha3_2_5DMidiMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  catalog,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_D_MIDI_MACRO_REGISTRY.get(request.id);
  if (!entry) throw new TypeError(`Unsupported Alpha3.2.5-D MIDI Macro id: ${String(request.id)}`);

  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState(projectIndexRuntime);
  const input = isObject(request.input) ? request.input : {};
  const requestedResponseBudget = request?.budget?.max_response_bytes;
  if (Number.isInteger(requestedResponseBudget) && requestedResponseBudget > 0 && requestedResponseBudget < MIN_RESPONSE_BUDGET) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: "MIDI_RESPONSE_BUDGET_TOO_SMALL",
      message: `macro.midi.create_clip requires at least ${MIN_RESPONSE_BUDGET} response bytes.`,
      data: { requested_bytes: requestedResponseBudget, minimum_bytes: MIN_RESPONSE_BUDGET },
    });
  }
  const requestValidation = validateMacroProgramRequest({
    macro_id: request.id,
    input,
    refs: request.refs ?? {},
    dry_run: input.dry_run === true,
    ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
  }, { registry: ALPHA3_2_5_D_MIDI_MACRO_REGISTRY });
  const inputBlockers = validateInput(input, request);
  if (!requestValidation.valid || inputBlockers.length > 0) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: inputBlockers[0]?.code ?? "MACRO_REQUEST_INVALID",
      message: inputBlockers[0]?.message ?? requestValidation.errors.join("; "),
      blockers: [...inputBlockers, ...requestValidation.errors.map((message) => blocker("MACRO_REQUEST_INVALID", message))],
    });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: "MIDI_MACRO_EXECUTOR_UNAVAILABLE",
      message: "macro.midi.create_clip needs the managed OpenReaper atomic route.",
    });
  }

  const plan = validateClipInput(input);
  if (!plan.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      code: plan.blockers[0].code,
      message: plan.blockers[0].message,
      blockers: plan.blockers,
    });
  }

  try {
    const target = await selectTrack({
      request,
      input,
      projectIndexRuntime,
      catalog,
      executeAtomic,
      now,
      state,
      stages,
    });
    if (!target.ok) throw coded(target.blockers[0]?.code ?? "MIDI_TRACK_TARGET_BLOCKED", target.blockers[0]?.message ?? "The MIDI track target is blocked.", target.blockers);

    const resolvedTrack = await runAtomic({
      request,
      executeAtomic,
      state,
      id: TRACK_RESOLVER_ID,
      input: { track_ref: target.trackRef },
      refs: {},
      stages,
      stageId: "midi-create-clip-live-resolve",
      kind: "live_ref_resolve",
      now,
    });
    const liveTrackRef = readback(resolvedTrack).track_ref ?? firstCanonicalRef(resolvedTrack, "track:");
    if (typeof liveTrackRef !== "string" || (requiresExactIdentity(target.trackRef) && liveTrackRef !== target.trackRef)) {
      throw coded("MIDI_TRACK_IDENTITY_MISMATCH", "The live track resolver did not return the selected stable track ref.");
    }
    state.canonicalRefs.push(liveTrackRef);

    if (plan.dryRun) {
      pushStage(stages, "midi-create-clip-create-item", "template_execute", "skipped", "MIDI item creation skipped during dry_run.");
      pushStage(stages, "midi-create-clip-insert-notes", "template_execute", "skipped", "PPQ note insertion skipped during dry_run.");
      pushStage(stages, "midi-create-clip-resolve-take", "live_ref_resolve", "skipped", "MIDI take resolution skipped during dry_run.");
      pushStage(stages, "midi-create-clip-verify-count", "verify", "skipped", "MIDI readback skipped during dry_run.");
      pushStage(stages, "midi-create-clip-verify-list", "verify", "skipped", "MIDI note list readback skipped during dry_run.");
      pushStage(stages, "midi-create-clip-index-update", "index_update", "skipped", "No Project Index scope changed during dry_run.");
      pushStage(stages, "midi-create-clip-result", "result_project", "completed", "Validated the fixed MIDI clip program without mutation.");
      return successEnvelope({
        entry, request, startedAt, now, stages, state, status: "dry_run_completed",
        summary: "Validated bounded MIDI clip creation without mutation.",
        data: {
          track_ref: liveTrackRef,
          start_seconds: plan.startSeconds,
          end_seconds: plan.endSeconds,
          note_count: plan.notes.length,
          notes: plan.notes,
          sqlite_selector_used: target.sqliteUsed,
        },
      });
    }

    const created = await runAtomic({
      request,
      executeAtomic,
      state,
      id: CREATE_ITEM_ID,
      input: { start_seconds: plan.startSeconds, end_seconds: plan.endSeconds },
      refs: { track_ref: liveTrackRef },
      stages,
      stageId: "midi-create-clip-create-item",
      kind: "template_execute",
      requiresPassedVerification: true,
      now,
    });
    const createdReadback = readback(created);
    const itemRef = createdReadback.item_ref ?? firstCanonicalRef(created, "item:");
    const takeRef = createdReadback.take_ref ?? firstCanonicalRef(created, "take:");
    if (typeof itemRef !== "string" || !itemRef.startsWith("item:") || typeof takeRef !== "string" || !takeRef.startsWith("take:")) {
      throw coded("MIDI_CREATE_TAKE_REF_MISSING", "template.midi.create_midi_item did not return a real take_ref.");
    }
    state.canonicalRefs.push(itemRef, takeRef);
    state.created = { itemRef, takeRef };
    state.changes.push({
      template_id: CREATE_ITEM_ID,
      status: "mutation_completed",
      item_ref: itemRef,
      take_ref: takeRef,
      mutation: { status: "completed", verification_status: "passed" },
      live_readback: { status: "pending" },
      index_maintenance: { status: "pending" },
    });

    const inserted = await runAtomic({
      request,
      executeAtomic,
      state,
      id: INSERT_NOTES_ID,
      input: { position_unit: "ppq", notes: plan.notes, sort_events: true },
      refs: { take_ref: takeRef },
      stages,
      stageId: "midi-create-clip-insert-notes",
      kind: "template_execute",
      requiresPassedVerification: true,
      now,
    });
    const insertedCount = readback(inserted).inserted_count;
    if (Number.isInteger(insertedCount) && insertedCount !== plan.notes.length) {
      throw coded("MIDI_INSERTED_COUNT_MISMATCH", `MIDI insertion reported ${insertedCount}; expected ${plan.notes.length}.`);
    }
    state.changes.push({
      template_id: INSERT_NOTES_ID,
      status: "mutation_completed",
      take_ref: takeRef,
      inserted_count: plan.notes.length,
      mutation: { status: "completed", verification_status: "passed" },
      live_readback: { status: "pending" },
      index_maintenance: { status: "pending" },
    });

    const resolvedTake = await runAtomic({
      request,
      executeAtomic,
      state,
      id: RESOLVE_TAKE_ID,
      input: { ref: takeRef },
      refs: {},
      stages,
      stageId: "midi-create-clip-resolve-take",
      kind: "live_ref_resolve",
      now,
    });
    const resolvedTakeRef = readback(resolvedTake).take_ref ?? firstCanonicalRef(resolvedTake, "take:");
    if (resolvedTakeRef !== takeRef) throw coded("MIDI_TAKE_IDENTITY_MISMATCH", "The MIDI take resolver did not return the exact take_ref created by the Macro.");
    state.canonicalRefs.push(resolvedTakeRef);

    const counted = await runAtomic({
      request,
      executeAtomic,
      state,
      id: COUNT_NOTES_ID,
      input: {},
      refs: { take_ref: resolvedTakeRef },
      stages,
      stageId: "midi-create-clip-verify-count",
      kind: "verify",
      budget: INTERNAL_ATOMIC_BUDGET,
      now,
    });
    const countReadback = readback(counted);
    const noteCount = countReadback.note_count;
    if (!Number.isInteger(noteCount) || noteCount !== plan.notes.length) {
      throw coded("MIDI_NOTE_COUNT_READBACK_MISMATCH", `MIDI note count readback was ${String(noteCount)}; expected ${plan.notes.length}.`);
    }

    const listed = await listAllNotes({
      request,
      executeAtomic,
      state,
      takeRef: resolvedTakeRef,
      stages,
      now,
    });
    const actualNotes = listed.notes;
    if (actualNotes.length !== noteCount || actualNotes.length !== plan.notes.length || !notesMatch(plan.notes, actualNotes)) {
      throw coded("MIDI_NOTE_LIST_READBACK_MISMATCH", "MIDI note list readback did not exactly match the bounded PPQ notes.");
    }
    state.changes[0].status = "applied";
    state.changes[0].live_readback = {
      status: "passed",
      source: "live_take_identity_and_note_readback",
      item_ref: itemRef,
      take_ref: resolvedTakeRef,
      note_count: noteCount,
    };
    state.changes[1].status = "applied";
    state.changes[1].live_readback = {
      status: "passed",
      source: "live_note_count_and_list_readback",
      take_ref: resolvedTakeRef,
      note_count: noteCount,
      page_count: listed.pageCount,
      list_truncated: false,
    };

    const invalidation = invalidateProjectIndex(projectIndexRuntime, now);
    if (invalidation?.ok === false) {
      state.indexUpdate = invalidation;
      applyMidiIndexMaintenance(state.changes, "failed", invalidation);
      throw coded(
        invalidation.blockers?.[0]?.code ?? "MIDI_INDEX_INVALIDATION_FAILED",
        invalidation.blockers?.[0]?.message ?? "MIDI creation completed but Project Index invalidation failed.",
        invalidation.blockers,
      );
    }
    state.indexUpdate = invalidation;
    applyMidiIndexMaintenance(state.changes, invalidation ? "completed" : "skipped", invalidation);
    if (invalidation) state.sqlite = sqliteEvidence(projectIndexRuntime, "stale");
    pushStage(stages, "midi-create-clip-index-update", "index_update", invalidation ? "completed" : "skipped", invalidation ? "Marked items, takes, and selection Project Index scopes stale." : "No configured Project Index runtime required invalidation.");
    pushStage(stages, "midi-create-clip-result", "result_project", "completed", "Created the MIDI clip and passed exact count/list readback.");
    return successEnvelope({
      entry, request, startedAt, now, stages, state,
      summary: "Created and verified one bounded PPQ MIDI clip.",
      data: {
        track_ref: liveTrackRef,
        sqlite_selector_used: target.sqliteUsed,
        item_ref: itemRef,
        take_ref: takeRef,
        note_count: noteCount,
        inserted_count: insertedCount ?? plan.notes.length,
        verification: {
          note_count: actualNotes.length,
          page_count: listed.pageCount,
          cursor_complete: true,
        },
        index_update: compact(invalidation),
        outcome: midiOutcome(state),
      },
    });
  } catch (error) {
    const partial = state.mutationAttempted === true || state.writeExecuted === true || state.changes.length > 0 || state.created !== null;
    if (partial) {
      const invalidation = invalidateProjectIndex(projectIndexRuntime, now);
      if (invalidation?.ok === true) {
        state.indexUpdate = invalidation;
        applyMidiIndexMaintenance(state.changes, "completed", invalidation);
        state.sqlite = sqliteEvidence(projectIndexRuntime, "stale");
        pushStage(stages, "midi-create-clip-index-update", "index_update", "completed", "Marked items, takes, and selection Project Index scopes stale after a partial write.");
      } else if (invalidation?.ok === false) {
        state.indexUpdate = invalidation;
        applyMidiIndexMaintenance(state.changes, "failed", invalidation);
      }
    }
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: partial ? "partial_failure" : "failed",
      code: error.code ?? "MIDI_MACRO_EXECUTION_FAILED",
      message: error.message ?? "The registered MIDI Macro failed.",
      blockers: error.blockers,
      data: {
        track_ref: state.trackRef ?? null,
        created: state.created ?? null,
        index_update: compact(state.indexUpdate),
        outcome: midiOutcome(state),
      },
    });
  }
}

async function selectTrack({ request, input, projectIndexRuntime, catalog, executeAtomic, now, state, stages }) {
  const direct = normalizeTrackRef(request.refs);
  if (typeof direct === "string") {
    if (!direct.startsWith("track:")) return { ok: false, blockers: [blocker("MIDI_TRACK_REF_INVALID", "request.refs.track_ref must be a track ref.")] };
    state.trackRef = direct;
    pushStage(stages, "midi-create-clip-select-track", "selector_resolve", "completed", "Used the supplied track_ref.");
    return { ok: true, trackRef: direct, sqliteUsed: false };
  }
  if (!isObject(input.selector)) return { ok: false, blockers: [blocker("MIDI_TRACK_TARGET_REQUIRED", "Supply request.refs.track_ref or one bounded input.selector.")] };
  if (!projectIndexRuntime) return { ok: false, blockers: [blocker("PROJECT_INDEX_REQUIRED_FOR_SELECTOR", "input.selector needs the managed Project Index; supply an exact track_ref or restore Project Index readiness.")] };

  const response = await executeAlpha3_2_5BProjectUnderstandingMacro({
    request: {
      id: PROJECT_QUERY_ID,
      input: {
        entity: "tracks",
        ...queryParts(input.selector),
        refresh_policy: "if_stale",
        hydrate_refs: false,
        limit: 3,
      },
      refs: [],
      context: request.context,
      budget: INTERNAL_ATOMIC_BUDGET,
    },
    projectIndexRuntime,
    catalog,
    executeAtomic,
    now,
  });
  if (response.ok !== true) return { ok: false, blockers: response.blockers ?? [blocker(response.error?.code ?? "PROJECT_INDEX_SELECTOR_FAILED", response.error?.message ?? "Project Index track selection failed.")] };
  const rows = response.result?.data?.rows ?? [];
  if (rows.length === 0) return { ok: false, blockers: [blocker("MIDI_TRACK_SELECTOR_NOT_FOUND", "The bounded track selector matched no candidates.")] };
  if (rows.length > 1) return { ok: false, blockers: [blocker("MIDI_TRACK_SELECTOR_AMBIGUOUS", `The bounded track selector matched ${rows.length} candidates.`)] };
  const trackRef = rows[0]?.ref ?? rows[0]?.track_ref;
  if (typeof trackRef !== "string" || !trackRef.startsWith("track:")) return { ok: false, blockers: [blocker("MIDI_TRACK_CANDIDATE_INVALID", "The Project Index returned no canonical track candidate.")] };
  state.trackRef = trackRef;
  state.sqlite = response.sqlite ?? state.sqlite;
  state.evidenceRefs.push(...(response.result?.verification?.evidence_refs ?? []));
  pushStage(stages, "midi-create-clip-select-track", "selector_resolve", "completed", "Selected one unique Project Index track candidate.", response.result?.verification?.evidence_refs ?? []);
  return { ok: true, trackRef, sqliteUsed: true };
}

async function runAtomic({ request, executeAtomic, state, id, input, refs, stages, stageId, kind, requiresPassedVerification = false, budget, now }) {
  const materializedRefs = materializeRefs(refs, state);
  if (kind === "template_execute") state.mutationAttempted = true;
  const execution = await executeAtomic({
    id,
    input,
    refs: materializedRefs,
    context: request.context,
    budget: budget ?? INTERNAL_ATOMIC_BUDGET,
    observeProjectIndex: false,
  });
  const evidence = executionEvidenceRefs(execution);
  state.evidenceRefs.push(...evidence);
  collectObjectRefs(state, execution);
  state.canonicalRefs.push(...canonicalRefs(execution));
  if (id === CREATE_ITEM_ID) rememberCreatedRefs(state, execution);
  if (execution?.ok !== true) {
    const error = execution?.error ?? {};
    pushStage(stages, stageId, kind, "failed", `${id} failed.`, evidence);
    throw coded(error.code ?? "MIDI_MACRO_ATOMIC_STAGE_FAILED", error.message ?? `${id} failed through the managed atomic route.`, error.details?.blockers);
  }
  if (kind === "template_execute") state.writeExecuted = true;
  const verification = execution?.verification ?? execution?.result?.verification;
  if (requiresPassedVerification && verification?.status !== "passed") {
    pushStage(stages, stageId, kind, "failed", `${id} did not return passed accepted Template verification.`, evidence);
    throw coded("MIDI_MACRO_CHILD_VERIFICATION_FAILED", `${id} completed without passed accepted Template verification.`);
  }
  pushStage(stages, stageId, kind, "completed", `${id} completed.`, evidence);
  return execution;
}

async function listAllNotes({ request, executeAtomic, state, takeRef, stages, now }) {
  const notes = [];
  const pageFingerprints = new Set();
  let cursor = "0";
  let pageCount = 0;

  while (pageCount < MAX_NOTE_VERIFICATION_PAGES) {
    const listed = await runAtomic({
      request,
      executeAtomic,
      state,
      id: LIST_NOTES_ID,
      input: { cursor, limit: MAX_NOTE_PAGE, include_project_time: false },
      refs: { take_ref: takeRef },
      stages,
      stageId: "midi-create-clip-verify-list",
      kind: "verify",
      budget: INTERNAL_ATOMIC_BUDGET,
      now,
    });
    const page = readback(listed);
    const pageNotes = page.notes;
    if (!Array.isArray(pageNotes)
      || !Number.isInteger(page.returned_count)
      || page.returned_count !== pageNotes.length
      || typeof page.truncated !== "boolean"
      || pageNotes.length > MAX_NOTE_PAGE
      || (page.take_ref !== undefined && page.take_ref !== takeRef)) {
      throw coded("MIDI_NOTE_LIST_PAGE_INVALID", "MIDI note verification returned an invalid pagination shape.");
    }
    if (notes.length + pageNotes.length > MAX_NOTES) {
      throw coded("MIDI_NOTE_LIST_LIMIT_EXCEEDED", `MIDI note verification exceeded the ${MAX_NOTES}-note bound.`);
    }
    const fingerprint = JSON.stringify(pageNotes);
    if (pageFingerprints.has(fingerprint)) {
      throw coded("MIDI_NOTE_LIST_PAGE_REPEATED", "MIDI note verification repeated a previously returned page.");
    }
    pageFingerprints.add(fingerprint);
    notes.push(...pageNotes);
    pageCount += 1;

    if (page.truncated !== true) {
      if (page.next_cursor !== undefined && page.next_cursor !== null && page.next_cursor !== "") {
        throw coded("MIDI_NOTE_LIST_CURSOR_INVALID", "Complete MIDI note verification returned an unexpected next_cursor.");
      }
      return { notes, pageCount };
    }

    if (typeof page.next_cursor !== "string" || !/^\d+$/u.test(page.next_cursor)) {
      throw coded("MIDI_NOTE_LIST_CURSOR_INVALID", "Truncated MIDI note verification did not return a decimal next_cursor.");
    }
    const currentOffset = Number(cursor);
    const nextOffset = Number(page.next_cursor);
    if (!Number.isSafeInteger(nextOffset) || nextOffset <= currentOffset) {
      throw coded("MIDI_NOTE_LIST_CURSOR_NOT_ADVANCING", "MIDI note verification returned a non-progressing next_cursor.");
    }
    if (nextOffset !== currentOffset + pageNotes.length) {
      throw coded("MIDI_NOTE_LIST_CURSOR_INVALID", "MIDI note verification next_cursor did not match the returned page length.");
    }
    cursor = page.next_cursor;
  }

  throw coded("MIDI_NOTE_LIST_PAGINATION_INCOMPLETE", "MIDI note verification did not complete within the bounded page count.");
}

function rememberCreatedRefs(state, execution) {
  const createdReadback = readback(execution);
  const rawItemRef = createdReadback.item_ref ?? firstCanonicalRef(execution, "item:");
  const rawTakeRef = createdReadback.take_ref ?? firstCanonicalRef(execution, "take:");
  const itemRef = typeof rawItemRef === "string" && rawItemRef.startsWith("item:") ? rawItemRef : null;
  const takeRef = typeof rawTakeRef === "string" && rawTakeRef.startsWith("take:") ? rawTakeRef : null;
  if (itemRef !== null || takeRef !== null) state.created = { itemRef, takeRef };
}

function validateInput(input, request) {
  const blockers = Object.keys(input).filter((key) => !INPUT_FIELDS.has(key)).slice(0, 16).map((key) => blocker("MIDI_MACRO_INPUT_FIELD_UNSUPPORTED", `Unsupported Macro input field: ${key}.`));
  if (request.idempotency_key !== undefined) blockers.unshift(blocker("MIDI_MACRO_IDEMPOTENCY_UNSUPPORTED", "Creating a new MIDI item is non-idempotent; omit idempotency_key."));
  return blockers;
}

function validateClipInput(input) {
  const blockers = [];
  if (!Number.isFinite(input.start_seconds) || input.start_seconds < 0) blockers.push(blocker("MIDI_CLIP_START_INVALID", "start_seconds must be a finite number >= 0."));
  if (!Number.isFinite(input.end_seconds) || input.end_seconds <= input.start_seconds) blockers.push(blocker("MIDI_CLIP_END_INVALID", "end_seconds must be greater than start_seconds."));
  if (!Array.isArray(input.notes) || input.notes.length < 1 || input.notes.length > MAX_NOTES) blockers.push(blocker("MIDI_CLIP_NOTES_INVALID", `notes must contain 1 to ${MAX_NOTES} bounded PPQ notes.`));
  const notes = Array.isArray(input.notes) ? input.notes : [];
  for (const [index, note] of notes.entries()) {
    if (isObject(note) && Object.keys(note).some((key) => key.endsWith("_seconds") || key === "seconds")) {
      blockers.push(blocker("MIDI_SECONDS_MODE_BLOCKED", "seconds-based note insertion is fail-closed; use start_ppq/end_ppq."));
      continue;
    }
    if (!isObject(note) || Object.keys(note).some((key) => !["start_ppq", "end_ppq", "pitch", "velocity", "channel"].includes(key))) {
      blockers.push(blocker("MIDI_NOTE_SHAPE_INVALID", `notes[${index}] must contain only bounded PPQ note fields.`));
      continue;
    }
    if (!Number.isInteger(note.start_ppq) || note.start_ppq < 0 || !Number.isInteger(note.end_ppq) || note.end_ppq <= note.start_ppq) blockers.push(blocker("MIDI_NOTE_PPQ_INVALID", `notes[${index}] must use integer PPQ bounds with end_ppq > start_ppq.`));
    if (!Number.isInteger(note.pitch) || note.pitch < 0 || note.pitch > 127) blockers.push(blocker("MIDI_NOTE_PITCH_INVALID", `notes[${index}].pitch must be an integer from 0 to 127.`));
    if (!Number.isInteger(note.velocity) || note.velocity < 1 || note.velocity > 127) blockers.push(blocker("MIDI_NOTE_VELOCITY_INVALID", `notes[${index}].velocity must be an integer from 1 to 127.`));
    if (!Number.isInteger(note.channel) || note.channel < 0 || note.channel > 15) blockers.push(blocker("MIDI_NOTE_CHANNEL_INVALID", `notes[${index}].channel must be an integer from 0 to 15.`));
  }
  return blockers.length > 0 ? { ok: false, blockers } : { ok: true, dryRun: input.dry_run === true, startSeconds: input.start_seconds, endSeconds: input.end_seconds, notes: input.notes.map((note) => ({ ...note })) };
}

function notesMatch(expected, actual) {
  const normalized = (notes) => notes.map((note) => [
    note?.start_ppq,
    note?.end_ppq,
    note?.pitch,
    note?.velocity,
    note?.channel,
  ]).sort(compareNoteTuples);
  return JSON.stringify(normalized(expected)) === JSON.stringify(normalized(actual));
}

function compareNoteTuples(left, right) {
  for (let index = 0; index < left.length; index += 1) {
    if (left[index] !== right[index]) return Number(left[index]) - Number(right[index]);
  }
  return 0;
}

function invalidateProjectIndex(runtime, now) {
  if (typeof runtime?.invalidateScopes !== "function") return null;
  return runtime.invalidateScopes({ scopes: TRACK_SCOPES, observed_at: safeNowIso(now) });
}

function applyMidiIndexMaintenance(changes, status, invalidation) {
  for (const change of changes) {
    change.index_maintenance = {
      status,
      scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
      blocker_code: invalidation?.blockers?.[0]?.code ?? null,
    };
  }
}

function midiOutcome(state) {
  const changes = state.changes ?? [];
  const readbackPassed = changes.filter((change) => change.live_readback?.status === "passed").length;
  const indexStatuses = [...new Set(changes.map((change) => change.index_maintenance?.status).filter(Boolean))];
  return {
    mutation: { status: state.writeExecuted === true ? "completed" : state.mutationAttempted === true ? "attempted_unknown" : "not_run", completed_count: changes.length },
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

function createState(runtime) {
  return {
    trackRef: null,
    created: null,
    changes: [],
    canonicalRefs: [],
    evidenceRefs: [],
    objectRefs: new Map(),
    mutationAttempted: false,
    writeExecuted: false,
    sqlite: sqliteEvidence(runtime),
    indexUpdate: null,
  };
}

function successEnvelope({ entry, request, startedAt, now, stages, state, status = "completed", summary, data }) {
  return finalizeEnvelope({
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
      artifact_refs: [],
      data: compactData(data),
    },
    blockers: [], error: null, recovery: null,
    budget: { max_bytes: macroResponseBudget(request, entry), actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, status = "blocked", code, message, blockers = [], data = {} }) {
  const bounded = (blockers.length > 0 ? blockers : [blocker(code, message)]).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count);
  const verifiedByLiveReadback = state.changes.length > 0
    && state.changes.every((change) => change.live_readback?.status === "passed");
  return finalizeEnvelope({
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
      artifact_refs: [], data: compactData(data),
    },
    blockers: bounded,
    error: { code: code ?? bounded[0]?.code ?? "MIDI_MACRO_EXECUTION_FAILED", message, recoverable: bounded.every((item) => item.recoverable !== false) },
    recovery: failureRecovery({ status, code, state, entry }),
    budget: { max_bytes: macroResponseBudget(request, entry), actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  compactEnvelopeToBudget(result);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.2.5-D MIDI Macro envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function compactEnvelopeToBudget(envelope) {
  envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (envelope.budget.actual_bytes <= envelope.budget.max_bytes) return;

  envelope.execution.stages = [];
  envelope.execution.stage_count = 0;
  envelope.result.verification.evidence_refs = [];
  envelope.result.canonical_refs = [];
  envelope.sqlite.snapshot_ref = null;
  envelope.sqlite.revision = null;
  envelope.result.data = compactBudgetData(envelope.result.data, envelope.result.changes.length);
  envelope.result.changes = envelope.result.changes.map(compactBudgetChange);
  envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (envelope.budget.actual_bytes > envelope.budget.max_bytes) {
    envelope.result.data = compactCriticalBudgetData(envelope.result.data);
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
}

function compactBudgetData(data, changeCount) {
  const value = isObject(data) ? data : {};
  return compactData({
    compacted: true,
    change_count: changeCount,
    track_ref: value.track_ref ?? null,
    item_ref: value.item_ref ?? value.created?.itemRef ?? null,
    take_ref: value.take_ref ?? value.created?.takeRef ?? null,
    note_count: value.note_count ?? value.verification?.note_count ?? null,
    inserted_count: value.inserted_count ?? null,
    verification: value.verification,
    outcome: value.outcome,
  });
}

function compactBudgetChange(change) {
  return {
    template_id: change?.template_id ?? null,
    status: change?.status ?? "unknown",
    mutation: { status: change?.mutation?.status ?? "unknown" },
    live_readback: { status: change?.live_readback?.status ?? "unknown" },
    index_maintenance: { status: change?.index_maintenance?.status ?? "unknown" },
  };
}

function compactCriticalBudgetData(data) {
  const value = isObject(data) ? data : {};
  return compactData({
    compacted: true,
    change_count: value.change_count,
    verification: value.verification,
    outcome: value.outcome,
  });
}

function macroResponseBudget(request, entry) {
  const requested = request?.budget?.max_response_bytes;
  return Number.isInteger(requested) && requested > 0
    ? Math.max(MIN_RESPONSE_BUDGET, Math.min(requested, entry.result_budget.max_bytes))
    : entry.result_budget.max_bytes;
}

function failureRecovery({ status, code, state, entry }) {
  if (status === "partial_failure") {
    const itemRef = state.created?.itemRef ?? null;
    const takeRef = state.created?.takeRef ?? null;
    return {
      partial_changes_possible: true,
      undo_policy: entry.undo_policy,
      sqlite_rows_authorize_writes: false,
      replay_policy: "do_not_replay",
      item_ref: itemRef,
      take_ref: takeRef,
      action: takeRef !== null
        ? "Do not replay this non-idempotent Macro. Read and resolve the existing take_ref, inspect its current MIDI notes, and decide the next bounded mutation from that live state."
        : itemRef !== null
          ? "Do not replay this non-idempotent Macro. Resolve the retained item_ref, locate its active MIDI take, inspect the live notes, and decide the next bounded mutation from that state."
          : "Do not replay this non-idempotent Macro. Inspect the live project for the attempted MIDI item and decide the next bounded mutation from the current state.",
    };
  }
  if (code === "RESPONSE_TOO_LARGE") {
    return {
      partial_changes_possible: false,
      undo_policy: entry.undo_policy,
      sqlite_rows_authorize_writes: false,
      replay_policy: "retry_after_blocker",
      action: "Keep the requested response budget unchanged and restore a complete bounded atomic response before retrying the registered Macro.",
    };
  }
  return {
    partial_changes_possible: false,
    undo_policy: entry.undo_policy,
    sqlite_rows_authorize_writes: false,
    replay_policy: "retry_after_blocker",
    action: "Resolve the typed blocker, refresh stale Project Index scopes, then retry the same registered Macro.",
  };
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const stage = { id, kind, status, summary, evidence_refs: unique(evidenceRefs, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) };
  const index = stages.findIndex((entry) => entry.id === id);
  if (index >= 0) stages[index] = stage;
  else stages.push(stage);
}

function executionEvidenceRefs(execution) {
  return unique([
    execution?.request?.id,
    execution?.template?.id,
    ...(Array.isArray(execution?.result?.artifact_refs) ? execution.result.artifact_refs : []),
    ...(Array.isArray(execution?.result?.evidence_refs) ? execution.result.evidence_refs : []),
  ], MACRO_CONTRACT_CEILINGS.evidence_ref_max_count);
}

function canonicalRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (typeof value === "string" && /^(track|item|take):/u.test(value)) refs.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) Object.values(value).forEach(visit);
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  visit(execution?.result?.readback);
  visit(execution?.result?.summary);
  return unique(refs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count);
}

function firstCanonicalRef(execution, prefix) {
  return canonicalRefs(execution).find((ref) => ref.startsWith(prefix)) ?? null;
}

function collectObjectRefs(state, execution) {
  for (const ref of executionObjectRefs(execution)) state.objectRefs.set(ref.ref, structuredClone(ref));
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isObject(value)) {
      if (typeof value.kind === "string" && typeof value.ref === "string" && isObject(value.identity)) refs.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  return refs;
}

function materializeRefs(refs, state) {
  const materialize = (value) => {
    if (typeof value === "string") {
      const ref = state.objectRefs.get(value);
      if (!ref) throw coded("MIDI_OBJECT_REF_REQUIRED", `No reusable live object ref is available for ${value}.`);
      return structuredClone(ref);
    }
    if (Array.isArray(value)) return value.map(materialize);
    if (isObject(value) && typeof value.kind === "string" && typeof value.ref === "string") return structuredClone(value);
    if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, materialize(child)]));
    return value;
  };
  return materialize(refs);
}

function readback(execution) {
  if (isObject(execution?.result?.readback)) return execution.result.readback;
  if (isObject(execution?.result?.summary)) return execution.result.summary;
  if (isObject(execution?.result?.data)) return execution.result.data;
  return {};
}

function sqliteEvidence(runtime, freshness = "not_applicable") {
  const status = typeof runtime?.status === "function" ? runtime.status() : {};
  const used = freshness !== "not_applicable";
  return { used, source: used ? "warm_index" : "not_used", freshness, snapshot_ref: used ? status.snapshot_id ?? null : null, revision: used ? String(status.revision ?? status.project_revision ?? "") || null : null, refreshed: false };
}

function compactData(data) {
  const result = isObject(data) ? structuredClone(data) : {};
  if (Buffer.byteLength(JSON.stringify(result), "utf8") <= MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes) return result;
  return { compacted: true, summary: "MIDI Macro result exceeded the inline detail bound.", track_ref: result.track_ref ?? null, item_ref: result.item_ref ?? null, take_ref: result.take_ref ?? null, note_count: result.note_count ?? null };
}

function compact(value) {
  return isObject(value) ? Object.fromEntries(Object.entries(value).slice(0, 32)) : value ?? null;
}

function normalizeTrackRef(value) {
  if (Array.isArray(value)) {
    const entry = value.find((candidate) => {
      const ref = typeof candidate === "string" ? candidate : candidate?.ref;
      const kind = candidate?.kind ?? (typeof ref === "string" ? ref.split(":", 1)[0] : null);
      return kind === "track" && typeof ref === "string";
    });
    return typeof entry === "string" ? entry : entry?.ref;
  }
  if (!isObject(value)) return undefined;
  const raw = value.track_ref;
  return typeof raw === "string" ? raw : raw?.ref;
}

function queryParts(selector) {
  const selectorKeys = new Set(["refs", "ref", "selected", "name", "track_ref", "track_refs"]);
  const selectors = {};
  const filters = {};
  for (const [key, value] of Object.entries(selector ?? {})) {
    (selectorKeys.has(key) ? selectors : filters)[key] = structuredClone(value);
  }
  return { selectors, filters };
}

function requiresExactIdentity(ref) {
  return typeof ref === "string" && ref.includes(":guid:");
}

function blocker(code, message, recoverable = true) { return { code, message, recoverable }; }
function coded(code, message, blockers) { const error = new Error(message); error.code = code; error.blockers = blockers; return error; }
function unique(values, limit = Number.POSITIVE_INFINITY) { return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))].slice(0, limit); }
function macroIdentity(entry) { return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk }; }
function requestSummary(request, dryRun) { const context = isObject(request.context) ? request.context : {}; return { request_id: request.request_id ?? ["macro", request.id ?? "unknown", context.session_id ?? "session", context.request_sequence ?? 0].join(":"), dry_run: dryRun === true }; }
function safeNowIso(now) { try { const value = now(); const date = value instanceof Date ? value : new Date(value); if (!Number.isNaN(date.getTime())) return date.toISOString(); } catch {} return new Date().toISOString(); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
