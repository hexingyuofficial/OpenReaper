import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_3_MIDI_APPLY_MACRO_ID = "macro.midi.apply";
export const ALPHA3_3_MIDI_APPLY_CONTRACT = "alpha3.3.midi_apply.v1";
export const ALPHA3_3_MIDI_APPLY_MODES = deepFreeze(["edit_notes", "quantize", "write_cc"]);
export const ALPHA3_3_MIDI_APPLY_TEMPLATE_IDS = deepFreeze([
  "template.midi.resolve_midi_take_ref",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
  "template.midi.list_take_cc_events",
  "template.midi.read_take_grid",
  "template.midi.set_notes_batch",
  "template.midi.quantize_notes",
  "template.midi.quantize_selected_notes",
  "template.midi.insert_cc_batch",
]);

const RESOLVE_TAKE_ID = "template.midi.resolve_midi_take_ref";
const COUNT_EVENTS_ID = "template.midi.read_take_event_counts";
const LIST_NOTES_ID = "template.midi.list_take_notes";
const LIST_CC_ID = "template.midi.list_take_cc_events";
const READ_GRID_ID = "template.midi.read_take_grid";
const SET_NOTES_ID = "template.midi.set_notes_batch";
const QUANTIZE_NOTES_ID = "template.midi.quantize_notes";
const QUANTIZE_SELECTED_ID = "template.midi.quantize_selected_notes";
const INSERT_CC_ID = "template.midi.insert_cc_batch";
const MAX_OPERATIONS = 8;
const MAX_ROWS_PER_OPERATION = 32;
const COMPLETE_PAGE_LIMIT = 100;
const INDEX_SCOPES = deepFreeze(["items", "takes"]);
const INPUT_FIELDS = new Set(["mode", "operations", "dry_run"]);
const INTERNAL_READ_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: COMPLETE_PAGE_LIMIT,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_3_MIDI_APPLY_MACRO_ID,
  program_id: "openreaper.macro.midi.apply",
  program_version: "1.0.0",
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_MIDI_APPLY_MODES },
      operations: { type: "array", minItems: 1, maxItems: MAX_OPERATIONS },
      dry_run: { type: "boolean", default: true },
    },
    required: ["mode", "operations"],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: false,
    live_reresolve_before_write: true,
  },
  sqlite_policy: {
    mode: "invalidate_after_write",
    write_authority: false,
    identity_fields: ["take_ref", "bridge_owner", "bridge_generation"],
  },
  dependencies: { template_ids: ALPHA3_3_MIDI_APPLY_TEMPLATE_IDS, runtime_capabilities: [] },
  stages: [
    { id: "midi-apply-live-resolve", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "midi-apply-preflight", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: COUNT_EVENTS_ID },
    { id: "midi-apply-mutate", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: SET_NOTES_ID },
    { id: "midi-apply-readback", kind: "verify", risk: "read", stop_on_error: true },
    { id: "midi-apply-index", kind: "index_update", risk: "read", stop_on_error: true },
    { id: "midi-apply-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3MidiApplyRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_MIDI_APPLY_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_MIDI_APPLY_REGISTRY = createAlpha3_3MidiApplyRegistry();

export function isAlpha3_3MidiApplyMacroId(id) {
  return id === ALPHA3_3_MIDI_APPLY_MACRO_ID;
}

export function createAlpha3_3MidiApplyDiscoveryItem({ liveRunnableNow = false } = {}) {
  return deepFreeze({
    id: ALPHA3_3_MIDI_APPLY_MACRO_ID,
    title: "Apply bounded MIDI changes",
    user_label: "Apply MIDI",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.midi",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "midi_apply",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable_runtime_bound",
    support_state: "supported_with_exact_live_readback",
    live_runnable_now: liveRunnableNow,
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    summary: "Edit or quantize existing MIDI notes, or insert CC events, across one to eight exact MIDI takes with per-row live readback.",
    tags: ["macro", "midi", "notes", "edit", "quantize", "cc", "batch", "alpha3_3"],
    task_intents: ["edit MIDI notes", "quantize MIDI", "write MIDI CC", "apply MIDI changes"],
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_modes: ALPHA3_3_MIDI_APPLY_MODES,
    limits: { operations: MAX_OPERATIONS, changed_rows_per_operation: MAX_ROWS_PER_OPERATION, complete_take_page: COMPLETE_PAGE_LIMIT },
    examples: [
      { input: { mode: "edit_notes", operations: [{ take_ref: "take:guid:{TAKE}", notes: [{ index: 0, velocity: 100 }] }], dry_run: false } },
      { input: { mode: "quantize", operations: [{ take_ref: "take:guid:{TAKE}", grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true }], dry_run: false } },
      { input: { mode: "write_cc", operations: [{ take_ref: "take:guid:{TAKE}", events: [{ ppq: 0, channel: 0, controller: 1, value: 64 }] }], dry_run: false } },
    ],
  });
}

export function createAlpha3_3MidiApplyDiscoveryItems(options = {}) {
  return deepFreeze([createAlpha3_3MidiApplyDiscoveryItem(options)]);
}

export function createAlpha3_3MidiApplyExactManual() {
  return deepFreeze({
    id: ALPHA3_3_MIDI_APPLY_MACRO_ID,
    rollout_slice: "Alpha3.3 MIDI apply",
    action_manual: {
      when_to_use: [
        "Use edit_notes for indexed existing-note fields, quantize for all or selected existing notes, and write_cc for bounded PPQ CC insertion.",
        "Use one call for one to eight exact MIDI takes when every affected note or CC lane fits the complete 100-row live readback bound.",
      ],
      when_not_to_use: [
        "Do not use this slice to create clips, write new notes, edit existing CC rows, write text/sysex, load an instrument, or address a selected/index Take.",
        "Do not treat audible playback as implied; this Macro changes MIDI data and never silently inserts a VSTi.",
      ],
      required_readiness: [
        "Each operation requires a unique exact take_ref in take:guid:{GUID} form.",
        "The Macro live-resolves every Take and captures complete pre-mutation counts plus note/CC rows using its internal read budget; SQLite never authorizes a write.",
      ],
      input_shape: {
        mode: "edit_notes | quantize | write_cc",
        operations: "1-8 mode-specific rows; each row requires exact take_ref and may include operation_id.",
        edit_notes: "notes contains 1-32 rows with exact index plus one or more of selected, muted, start_ppq, end_ppq, channel, pitch, velocity.",
        quantize: "grid_unit=ppq with positive grid_ppq, or grid_unit=take_grid; strength 0..1; preserve_duration boolean; selected_only optional.",
        write_cc: "events contains 1-32 PPQ rows with ppq>=0, channel 0..15, controller/value 0..127, and optional selected/muted.",
        dry_run: "Defaults to true; set false only for mutation.",
      },
      underlying_actions: ALPHA3_3_MIDI_APPLY_TEMPLATE_IDS,
      readback_steps: [
        "Before writing, require note_count/cc_count to fit one complete non-truncated 100-row page; a truncated page is never treated as complete knowledge.",
        "After each mutation row, resolve the same exact Take again and independently re-read counts plus the complete affected lane.",
        "edit_notes and quantize compare the entire expected final note multiset; write_cc proves the exact inserted CC multiset delta.",
        "Each changes[] row reports mutation dispatch, exact live readback, and Project Index maintenance separately; status=applied comes only from that row's readback.",
      ],
      success_criteria: [
        "Every applied row has exact Take identity and complete row-specific live readback matching the requested final state.",
        "Mutation dispatch success alone never marks a row applied, and index failure never erases an already-proven REAPER result.",
      ],
      common_blockers: [
        blocker("MIDI_EXACT_TAKE_REF_REQUIRED", "Use a unique exact take:guid:{GUID} for every operation."),
        blocker("MIDI_COMPLETE_READBACK_REQUIRED", "The affected Take exceeds the accepted 100-row complete live-readback bound; no definitive mutation result is claimed."),
        blocker("MIDI_LIVE_READBACK_MISMATCH", "Independent post-write live rows do not match the requested final state."),
      ],
      recovery_steps: [
        "Refresh the exact Take ref or reduce the Take event lane below the reported complete-readback bound, then retry once.",
        "If mutation is unknown or partial, inspect the returned live row before retrying; never replay write_cc blindly.",
      ],
      dry_run_shape: { supported: true, behavior: "Performs exact live resolution and complete preflight reads without mutation or index invalidation." },
    },
  });
}

export async function executeAlpha3_3MidiApplyMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_3_MIDI_APPLY_REGISTRY.get(ALPHA3_3_MIDI_APPLY_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const normalized = normalizeInput(request.input);
  if (!normalized.ok) return failureEnvelope({ entry, request, startedAt, now, stages, state, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  const input = normalized.input;
  if (request.id !== ALPHA3_3_MIDI_APPLY_MACRO_ID) return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "MIDI_APPLY_ID_UNSUPPORTED", message: `Unsupported MIDI Macro id: ${String(request.id)}.` });
  if (request.idempotency_key !== undefined) return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "MIDI_APPLY_IDEMPOTENCY_UNSUPPORTED", message: "macro.midi.apply has no accepted batch replay ledger; omit idempotency_key." });
  const validation = validateMacroProgramRequest({ macro_id: request.id, input, refs: request.refs ?? {}, dry_run: input.dry_run }, { registry: ALPHA3_3_MIDI_APPLY_REGISTRY });
  if (!validation.valid) return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "MIDI_APPLY_REQUEST_INVALID", message: validation.errors.join("; "), blockers: validation.errors.map((message) => blocker("MIDI_APPLY_REQUEST_INVALID", message)) });
  if (typeof executeAtomic !== "function") return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "MIDI_APPLY_LIVE_EXECUTOR_REQUIRED", message: "macro.midi.apply requires the managed OpenReaper live executor." });

  try {
    for (const operation of input.operations) state.operations.push(await prepareOperation({ request, input, operation, executeAtomic, state }));
    pushStage(stages, "midi-apply-live-resolve", "live_ref_resolve", "completed", `Resolved ${state.operations.length} exact live MIDI Take(s).`, state.evidenceRefs);
    pushStage(stages, "midi-apply-preflight", "template_execute", "completed", "Captured complete pre-mutation event rows for every Take.", state.evidenceRefs);

    if (input.dry_run) {
      state.changes = state.operations.map(previewChange);
      pushStage(stages, "midi-apply-mutate", "template_execute", "skipped", "MIDI mutation skipped during dry_run.");
      pushStage(stages, "midi-apply-readback", "verify", "skipped", "Post-write readback was not required during dry_run.");
      pushStage(stages, "midi-apply-index", "index_update", "skipped", "No Project Index scope changed during dry_run.");
      pushStage(stages, "midi-apply-result", "result_project", "completed", "Validated the bounded MIDI program without mutation.");
      return successEnvelope({ entry, request, startedAt, now, stages, state, status: "dry_run_completed", summary: `Validated ${state.operations.length} MIDI operation(s) without mutation.`, data: resultData(input, state) });
    }

    for (const operation of state.operations) {
      const change = pendingChange(operation);
      state.changes.push(change);
      const mutation = await executeChild({ request, executeAtomic, state, id: operation.template_id, input: operation.template_input, takeObject: operation.take_object, mutation: true });
      change.mutation = mutation.ok && mutation.verificationPassed
        ? { status: "completed", dispatch_status: "completed", verification_status: "passed" }
        : { status: "unknown_or_partial", dispatch_status: mutation.ok ? "completed" : "failed", verification_status: mutation.verificationPassed ? "passed" : "not_passed", blocker_code: mutation.code };
      const after = await readCompleteState({ request, executeAtomic, state, takeRef: operation.take_ref, takeObject: operation.take_object, lane: operation.lane });
      const matched = verifyOperation(operation, after);
      change.live_readback = {
        status: matched ? "passed" : "failed",
        source: "independent_complete_live_take_readback",
        take_ref: after.take_ref,
        before_count: operation.before_count,
        after_count: after.count,
        coverage_complete: after.coverage_complete,
      };
      if (!matched) throw coded("MIDI_LIVE_READBACK_MISMATCH", `${operation.operation_id} did not match independent complete live readback.`);
      change.status = "applied";
      state.canonicalRefs.push(after.take_ref);
      if (!mutation.ok || !mutation.verificationPassed) throw coded(mutation.code, mutation.message, mutation.blockers);
    }
    pushStage(stages, "midi-apply-mutate", "template_execute", "completed", `Dispatched ${state.changes.length} bounded MIDI mutation row(s).`, state.evidenceRefs);
    pushStage(stages, "midi-apply-readback", "verify", "completed", "Every applied row passed independent complete live Take readback.", state.evidenceRefs);

    const indexResult = maintainProjectIndex(projectIndexRuntime, state, now);
    applyIndexMaintenance(state.changes, indexResult);
    pushStage(stages, "midi-apply-index", "index_update", indexResult.status, indexResult.message);
    if (!indexResult.ok) throw coded(indexResult.code, indexResult.message, indexResult.blockers);
    pushStage(stages, "midi-apply-result", "result_project", "completed", "Applied and verified all bounded MIDI rows.");
    return successEnvelope({ entry, request, startedAt, now, stages, state, summary: `Applied and verified ${state.changes.length} MIDI operation(s).`, data: resultData(input, state) });
  } catch (error) {
    appendNotRunChanges(state);
    const mutated = state.changes.some((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
    if (mutated && state.changes.some((change) => change.index_maintenance?.status === "pending")) {
      const indexResult = maintainProjectIndex(projectIndexRuntime, state, now);
      applyIndexMaintenance(state.changes, indexResult);
      if (!stages.some((stage) => stage.id === "midi-apply-index")) pushStage(stages, "midi-apply-index", "index_update", indexResult.status, indexResult.message);
    }
    return failureEnvelope({
      entry, request, startedAt, now, stages, state,
      status: mutated ? "partial_failure" : "blocked",
      code: error.code ?? "MIDI_APPLY_EXECUTION_FAILED",
      message: error.message ?? "The registered MIDI apply program failed.",
      blockers: error.blockers,
      data: resultData(input, state),
    });
  }
}

async function prepareOperation({ request, input, operation, executeAtomic, state }) {
  const resolved = await executeChild({ request, executeAtomic, state, id: RESOLVE_TAKE_ID, input: { ref: operation.take_ref }, takeObject: null });
  if (!resolved.ok) throw coded(resolved.code, resolved.message, resolved.blockers);
  const liveTakeRef = readback(resolved.execution).take_ref ?? canonicalRefs(resolved.execution).find((ref) => ref.startsWith("take:"));
  if (liveTakeRef !== operation.take_ref) throw coded("MIDI_TAKE_IDENTITY_MISMATCH", `${operation.operation_id} did not resolve to the exact requested Take GUID.`);
  const takeObject = executionObjectRefs(resolved.execution).find((ref) => ref.kind === "take" && ref.ref === liveTakeRef) ?? objectRefFromExactTake(liveTakeRef);
  if (!takeObject) throw coded("MIDI_TAKE_OBJECT_REF_MISSING", `${operation.operation_id} did not return a reusable exact Take object ref.`);
  state.canonicalRefs.push(liveTakeRef);
  const lane = input.mode === "write_cc" ? "cc" : "notes";
  const before = await readCompleteState({ request, executeAtomic, state, takeRef: liveTakeRef, takeObject, lane });
  const prepared = {
    ...operation,
    mode: input.mode,
    lane,
    take_ref: liveTakeRef,
    take_object: takeObject,
    before_rows: before.rows,
    before_count: before.count,
    take_hash: before.take_hash,
  };
  if (input.mode === "edit_notes") {
    prepared.template_id = SET_NOTES_ID;
    prepared.template_input = { notes: clone(operation.notes), expected_take_hash: before.take_hash, sort_events: true };
    prepared.expected_rows = applyNoteEdits(before.rows, operation.notes);
  } else if (input.mode === "quantize") {
    if (operation.selected_only && !before.rows.some((row) => row.selected === true)) throw coded("MIDI_SELECTED_NOTES_REQUIRED", `${operation.operation_id} requested selected-only quantize but complete live readback contains no selected notes.`);
    let gridPpq = operation.grid_ppq;
    if (operation.grid_unit === "take_grid") {
      const grid = await executeChild({ request, executeAtomic, state, id: READ_GRID_ID, input: {}, takeObject });
      if (!grid.ok) throw coded(grid.code, grid.message, grid.blockers);
      gridPpq = readback(grid.execution).grid_ppq;
      if (!finitePositive(gridPpq)) throw coded("MIDI_GRID_READBACK_INVALID", `${operation.operation_id} did not return a positive live Take grid.`);
    }
    prepared.grid_ppq = gridPpq;
    prepared.template_id = operation.selected_only ? QUANTIZE_SELECTED_ID : QUANTIZE_NOTES_ID;
    prepared.template_input = {
      grid_unit: operation.grid_unit,
      ...(operation.grid_unit === "ppq" ? { grid_ppq: operation.grid_ppq } : {}),
      strength: operation.strength,
      preserve_duration: operation.preserve_duration,
      expected_take_hash: before.take_hash,
      sort_events: true,
      ...(operation.selected_only ? { require_selected_notes: true } : {}),
    };
    prepared.expected_rows = quantizeNotes(before.rows, gridPpq, operation);
  } else {
    if (before.count + operation.events.length > COMPLETE_PAGE_LIMIT) throw coded("MIDI_COMPLETE_READBACK_REQUIRED", `${operation.operation_id} would exceed the complete ${COMPLETE_PAGE_LIMIT}-row CC readback bound after insertion.`);
    prepared.template_id = INSERT_CC_ID;
    prepared.template_input = { position_unit: "ppq", events: clone(operation.events), sort_events: true };
    prepared.expected_rows = [...before.rows, ...operation.events.map(normalizeInsertedCc)].sort(compareCcRows);
  }
  return prepared;
}

async function readCompleteState({ request, executeAtomic, state, takeRef, takeObject, lane }) {
  const counted = await executeChild({ request, executeAtomic, state, id: COUNT_EVENTS_ID, input: {}, takeObject });
  if (!counted.ok) throw coded(counted.code, counted.message, counted.blockers);
  const countData = readback(counted.execution);
  if (countData.take_ref !== takeRef) throw coded("MIDI_TAKE_IDENTITY_MISMATCH", "MIDI count readback returned a different Take ref.");
  const count = lane === "notes" ? countData.note_count : countData.cc_count;
  if (!Number.isInteger(count) || count < 0) throw coded("MIDI_COUNT_READBACK_INVALID", `Live ${lane} count is invalid.`);
  if (count > COMPLETE_PAGE_LIMIT) throw coded("MIDI_COMPLETE_READBACK_REQUIRED", `Live ${lane} count ${count} exceeds the complete ${COMPLETE_PAGE_LIMIT}-row readback bound.`);
  const listed = await executeChild({ request, executeAtomic, state, id: lane === "notes" ? LIST_NOTES_ID : LIST_CC_ID, input: { limit: COMPLETE_PAGE_LIMIT }, takeObject });
  if (!listed.ok) throw coded(listed.code, listed.message, listed.blockers);
  const listData = readback(listed.execution);
  const rawRows = lane === "notes" ? listData.notes : listData.cc_events;
  if (listData.take_ref !== takeRef || listData.truncated === true || !Array.isArray(rawRows) || rawRows.length !== count || listData.returned_count !== count) {
    throw coded("MIDI_COMPLETE_READBACK_REQUIRED", `Live ${lane} rows were truncated, incomplete, or bound to a different Take.`);
  }
  const rows = lane === "notes" ? rawRows.map(normalizeLiveNote) : rawRows.map(normalizeLiveCc);
  if (rows.some((row) => row === null)) throw coded("MIDI_LIVE_ROW_INVALID", `Live ${lane} readback contained an invalid row.`);
  return { take_ref: takeRef, take_hash: countData.take_hash, count, rows: rows.sort(lane === "notes" ? compareNoteRows : compareCcRows), coverage_complete: true };
}

async function executeChild({ request, executeAtomic, state, id, input, takeObject, mutation = false }) {
  let execution;
  try {
    execution = await executeAtomic({
      id,
      input,
      refs: takeObject ? { take_ref: clone(takeObject) } : {},
      context: request.context,
      budget: INTERNAL_READ_BUDGET,
      observeProjectIndex: false,
    });
  } catch (error) {
    return { ok: false, execution: null, verificationPassed: false, code: mutation ? "MIDI_MUTATION_DISPATCH_THROWN" : "MIDI_READ_DISPATCH_THROWN", message: error?.message ?? `${id} threw.`, blockers: [blocker(mutation ? "MIDI_MUTATION_DISPATCH_THROWN" : "MIDI_READ_DISPATCH_THROWN", error?.message ?? `${id} threw.`)] };
  }
  collectEvidence(state, execution);
  const verification = execution?.verification ?? execution?.result?.verification;
  const ok = execution?.ok === true;
  const verificationPassed = verification?.status === "passed";
  const code = execution?.error?.code ?? (mutation ? "MIDI_MUTATION_STAGE_FAILED" : "MIDI_READ_STAGE_FAILED");
  const message = execution?.error?.message ?? `${id} failed through the managed atomic route.`;
  return { ok, execution, verificationPassed, code, message, blockers: execution?.error?.details?.blockers };
}

function normalizeInput(value) {
  if (!isObject(value)) return failed("MIDI_APPLY_REQUEST_INVALID", "macro.midi.apply input must be an object.");
  const unknown = Object.keys(value).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length) return failed("MIDI_APPLY_REQUEST_INVALID", `Unsupported input field(s): ${unknown.slice(0, 8).join(", ")}.`);
  if (!ALPHA3_3_MIDI_APPLY_MODES.includes(value.mode)) return failed("MIDI_APPLY_MODE_UNSUPPORTED", `mode must be one of ${ALPHA3_3_MIDI_APPLY_MODES.join(", ")}.`);
  if (!Array.isArray(value.operations) || value.operations.length < 1 || value.operations.length > MAX_OPERATIONS) return failed("MIDI_APPLY_OPERATIONS_INVALID", `operations must contain 1-${MAX_OPERATIONS} rows.`);
  if (value.dry_run !== undefined && typeof value.dry_run !== "boolean") return failed("MIDI_APPLY_REQUEST_INVALID", "dry_run must be boolean.");
  const operations = [];
  const takeRefs = new Set();
  for (const [index, row] of value.operations.entries()) {
    const normalized = normalizeOperation(value.mode, row, index);
    if (!normalized.ok) return normalized;
    if (takeRefs.has(normalized.value.take_ref)) return failed("MIDI_DUPLICATE_TAKE_OPERATION", `operations contains duplicate take_ref ${normalized.value.take_ref}.`);
    takeRefs.add(normalized.value.take_ref);
    operations.push(normalized.value);
  }
  return { ok: true, input: { mode: value.mode, operations, dry_run: value.dry_run !== false } };
}

function normalizeOperation(mode, row, index) {
  if (!isObject(row)) return failed("MIDI_OPERATION_INVALID", `operations[${index}] must be an object.`);
  const common = ["operation_id", "take_ref"];
  const allowed = mode === "edit_notes" ? [...common, "notes"] : mode === "quantize" ? [...common, "grid_unit", "grid_ppq", "strength", "preserve_duration", "selected_only"] : [...common, "events"];
  const unknown = Object.keys(row).filter((field) => !allowed.includes(field));
  if (unknown.length) return failed("MIDI_OPERATION_INVALID", `operations[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
  if (!isExactTakeGuid(row.take_ref)) return failed("MIDI_EXACT_TAKE_REF_REQUIRED", `operations[${index}].take_ref must be take:guid:{GUID}.`);
  const operationId = row.operation_id ?? `midi-${String(index + 1).padStart(2, "0")}`;
  if (typeof operationId !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/u.test(operationId)) return failed("MIDI_OPERATION_ID_INVALID", `operations[${index}].operation_id must be 1-64 bounded identifier characters.`);
  if (mode === "edit_notes") {
    if (!Array.isArray(row.notes) || row.notes.length < 1 || row.notes.length > MAX_ROWS_PER_OPERATION) return failed("MIDI_NOTE_EDITS_INVALID", `operations[${index}].notes must contain 1-${MAX_ROWS_PER_OPERATION} rows.`);
    const notes = [];
    const indices = new Set();
    for (const [noteIndex, note] of row.notes.entries()) {
      const normalized = normalizeNoteEdit(note, index, noteIndex);
      if (!normalized.ok) return normalized;
      if (indices.has(normalized.value.index)) return failed("MIDI_NOTE_EDITS_INVALID", `operations[${index}].notes repeats index ${normalized.value.index}.`);
      indices.add(normalized.value.index);
      notes.push(normalized.value);
    }
    return { ok: true, value: { operation_id: operationId, take_ref: row.take_ref, notes } };
  }
  if (mode === "quantize") {
    const gridUnit = row.grid_unit ?? "take_grid";
    const strength = row.strength ?? 1;
    const preserveDuration = row.preserve_duration ?? true;
    const selectedOnly = row.selected_only ?? false;
    if (!new Set(["take_grid", "ppq"]).has(gridUnit) || (gridUnit === "ppq" && !finitePositive(row.grid_ppq)) || !Number.isFinite(strength) || strength < 0 || strength > 1 || typeof preserveDuration !== "boolean" || typeof selectedOnly !== "boolean") return failed("MIDI_QUANTIZE_INVALID", `operations[${index}] requires a valid grid, strength 0..1, and boolean preserve_duration/selected_only.`);
    return { ok: true, value: { operation_id: operationId, take_ref: row.take_ref, grid_unit: gridUnit, ...(gridUnit === "ppq" ? { grid_ppq: row.grid_ppq } : {}), strength, preserve_duration: preserveDuration, selected_only: selectedOnly } };
  }
  if (!Array.isArray(row.events) || row.events.length < 1 || row.events.length > MAX_ROWS_PER_OPERATION) return failed("MIDI_CC_EVENTS_INVALID", `operations[${index}].events must contain 1-${MAX_ROWS_PER_OPERATION} rows.`);
  const events = [];
  for (const [eventIndex, event] of row.events.entries()) {
    const normalized = normalizeCcInsert(event, index, eventIndex);
    if (!normalized.ok) return normalized;
    events.push(normalized.value);
  }
  return { ok: true, value: { operation_id: operationId, take_ref: row.take_ref, events } };
}

function normalizeNoteEdit(note, operationIndex, noteIndex) {
  if (!isObject(note)) return failed("MIDI_NOTE_EDITS_INVALID", `operations[${operationIndex}].notes[${noteIndex}] must be an object.`);
  const fields = ["index", "selected", "muted", "start_ppq", "end_ppq", "channel", "pitch", "velocity"];
  const unknown = Object.keys(note).filter((field) => !fields.includes(field));
  const changed = Object.keys(note).filter((field) => field !== "index");
  if (unknown.length || !Number.isInteger(note.index) || note.index < 0 || changed.length === 0) return failed("MIDI_NOTE_EDITS_INVALID", `operations[${operationIndex}].notes[${noteIndex}] requires index>=0 and at least one supported edit field.`);
  if ((note.selected !== undefined && typeof note.selected !== "boolean") || (note.muted !== undefined && typeof note.muted !== "boolean") || (note.start_ppq !== undefined && !finiteNonNegative(note.start_ppq)) || (note.end_ppq !== undefined && !finiteNonNegative(note.end_ppq)) || (note.channel !== undefined && !integerRange(note.channel, 0, 15)) || (note.pitch !== undefined && !integerRange(note.pitch, 0, 127)) || (note.velocity !== undefined && !integerRange(note.velocity, 1, 127))) return failed("MIDI_NOTE_EDITS_INVALID", `operations[${operationIndex}].notes[${noteIndex}] has an invalid field value.`);
  return { ok: true, value: clone(note) };
}

function normalizeCcInsert(event, operationIndex, eventIndex) {
  if (!isObject(event)) return failed("MIDI_CC_EVENTS_INVALID", `operations[${operationIndex}].events[${eventIndex}] must be an object.`);
  const unknown = Object.keys(event).filter((field) => !["ppq", "channel", "controller", "value", "selected", "muted"].includes(field));
  if (unknown.length || !finiteNonNegative(event.ppq) || !integerRange(event.channel ?? 0, 0, 15) || !integerRange(event.controller, 0, 127) || !integerRange(event.value, 0, 127) || (event.selected !== undefined && typeof event.selected !== "boolean") || (event.muted !== undefined && typeof event.muted !== "boolean")) return failed("MIDI_CC_EVENTS_INVALID", `operations[${operationIndex}].events[${eventIndex}] must use PPQ, channel 0..15, controller/value 0..127, and optional booleans.`);
  return { ok: true, value: { ppq: event.ppq, channel: event.channel ?? 0, controller: event.controller, value: event.value, selected: event.selected ?? false, muted: event.muted ?? false } };
}

function applyNoteEdits(beforeRows, edits) {
  const rows = beforeRows.map((row) => ({ ...row }));
  for (const edit of edits) {
    const row = rows.find((candidate) => candidate.index === edit.index);
    if (!row) throw coded("MIDI_NOTE_NOT_FOUND", `MIDI note index ${edit.index} does not exist in complete live readback.`);
    Object.assign(row, edit);
    if (row.end_ppq <= row.start_ppq) throw coded("MIDI_NOTE_BOUNDS_INVALID", `MIDI note index ${edit.index} must retain end_ppq > start_ppq.`);
  }
  return rows.map(stripIndex).sort(compareNoteRows);
}

function quantizeNotes(beforeRows, gridPpq, operation) {
  return beforeRows.map((row) => {
    if (operation.selected_only && !row.selected) return stripIndex(row);
    const start = row.start_ppq;
    const target = Math.floor((start / gridPpq) + 0.5) * gridPpq;
    const newStart = start + ((target - start) * operation.strength);
    return stripIndex({ ...row, start_ppq: newStart, end_ppq: operation.preserve_duration ? newStart + Math.max(0, row.end_ppq - start) : row.end_ppq });
  }).sort(compareNoteRows);
}

function verifyOperation(operation, after) {
  if (!after.coverage_complete || after.take_ref !== operation.take_ref) return false;
  if (operation.mode === "write_cc") return ccMultisetEquals(after.rows, operation.expected_rows);
  return noteMultisetEquals(after.rows.map(stripIndex), operation.expected_rows);
}

function normalizeLiveNote(row) {
  if (!isObject(row) || !Number.isInteger(row.index) || typeof row.selected !== "boolean" || typeof row.muted !== "boolean" || !Number.isFinite(row.start_ppq) || !Number.isFinite(row.end_ppq) || !integerRange(row.channel, 0, 15) || !integerRange(row.pitch, 0, 127) || !integerRange(row.velocity, 1, 127)) return null;
  return { index: row.index, selected: row.selected, muted: row.muted, start_ppq: row.start_ppq, end_ppq: row.end_ppq, channel: row.channel, pitch: row.pitch, velocity: row.velocity };
}

function normalizeLiveCc(row) {
  const channelMessage = row.channel_message ?? row.chanmsg;
  if (!isObject(row) || !Number.isInteger(row.index) || typeof row.selected !== "boolean" || typeof row.muted !== "boolean" || !Number.isFinite(row.ppq) || !integerRange(channelMessage, 0, 255) || !integerRange(row.channel, 0, 15) || !integerRange(row.controller, 0, 127) || !integerRange(row.value, 0, 127)) return null;
  return { selected: row.selected, muted: row.muted, ppq: row.ppq, channel_message: channelMessage, channel: row.channel, controller: row.controller, value: row.value };
}

function normalizeInsertedCc(row) {
  return { selected: row.selected, muted: row.muted, ppq: row.ppq, channel_message: 176, channel: row.channel, controller: row.controller, value: row.value };
}

function noteMultisetEquals(actual, expected) { return multisetEquals(actual, expected, noteRowsEqual); }
function ccMultisetEquals(actual, expected) { return multisetEquals(actual, expected, ccRowsEqual); }
function multisetEquals(actual, expected, equals) {
  if (actual.length !== expected.length) return false;
  const remaining = actual.map((row) => ({ ...row }));
  for (const row of expected) {
    const index = remaining.findIndex((candidate) => equals(candidate, row));
    if (index < 0) return false;
    remaining.splice(index, 1);
  }
  return remaining.length === 0;
}
function noteRowsEqual(left, right) { return left.selected === right.selected && left.muted === right.muted && close(left.start_ppq, right.start_ppq) && close(left.end_ppq, right.end_ppq) && left.channel === right.channel && left.pitch === right.pitch && left.velocity === right.velocity; }
function ccRowsEqual(left, right) { return left.selected === right.selected && left.muted === right.muted && close(left.ppq, right.ppq) && left.channel_message === right.channel_message && left.channel === right.channel && left.controller === right.controller && left.value === right.value; }
function compareNoteRows(left, right) { return left.start_ppq - right.start_ppq || left.end_ppq - right.end_ppq || left.pitch - right.pitch || left.channel - right.channel || left.velocity - right.velocity; }
function compareCcRows(left, right) { return left.ppq - right.ppq || left.channel - right.channel || left.controller - right.controller || left.value - right.value; }
function stripIndex(row) { const { index: ignored, ...rest } = row; return rest; }

function maintainProjectIndex(runtime, state, now) {
  const changed = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
  if (!changed.length) return { ok: true, status: "skipped", message: "No completed MIDI mutation required index maintenance.", scopes: [] };
  if (typeof runtime?.invalidateScopes !== "function") return { ok: true, status: "skipped", message: "No Project Index runtime was attached; exact REAPER readback remains authority.", scopes: INDEX_SCOPES };
  try {
    const result = runtime.invalidateScopes({ scopes: INDEX_SCOPES, observed_at: safeNowIso(now) });
    state.sqlite = sqliteEvidence(runtime, true);
    if (result?.ok === false) {
      const first = result.blockers?.[0] ?? blocker("MIDI_INDEX_MAINTENANCE_FAILED", "MIDI Project Index invalidation failed.");
      return { ok: false, status: "failed", code: first.code, message: first.message, blockers: [first], scopes: INDEX_SCOPES };
    }
    return { ok: true, status: "completed", message: "Invalidated affected items/takes Project Index scopes.", scopes: INDEX_SCOPES };
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, true);
    return { ok: false, status: "failed", code: "MIDI_INDEX_MAINTENANCE_FAILED", message: error?.message ?? "MIDI Project Index invalidation failed.", blockers: [blocker("MIDI_INDEX_MAINTENANCE_FAILED", error?.message ?? "MIDI Project Index invalidation failed.")], scopes: INDEX_SCOPES };
  }
}

function applyIndexMaintenance(changes, result) {
  for (const change of changes) if (["completed", "unknown_or_partial"].includes(change.mutation?.status)) change.index_maintenance = { status: result.status, scopes: result.scopes, ...(result.code ? { blocker_code: result.code } : {}) };
}

function pendingChange(operation) {
  return { operation_id: operation.operation_id, mode: operation.mode, template_id: operation.template_id, take_ref: operation.take_ref, requested_count: operation.mode === "write_cc" ? operation.events.length : operation.mode === "edit_notes" ? operation.notes.length : operation.before_count, status: "pending", mutation: { status: "pending" }, live_readback: { status: "pending" }, index_maintenance: { status: "pending", scopes: [] } };
}

function previewChange(operation) {
  return { ...pendingChange(operation), status: "planned", mutation: { status: "not_run" }, live_readback: { status: "not_run", take_ref: operation.take_ref, before_count: operation.before_count, coverage_complete: true }, index_maintenance: { status: "skipped", scopes: [] } };
}

function appendNotRunChanges(state) {
  const seen = new Set(state.changes.map((change) => change.operation_id));
  for (const operation of state.operations) {
    if (seen.has(operation.operation_id)) continue;
    state.changes.push({ ...pendingChange(operation), status: "not_run", mutation: { status: "not_run" }, live_readback: { status: "not_run" }, index_maintenance: { status: "skipped", scopes: [] } });
  }
}

function resultData(input, state) {
  const mutated = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
  const applied = state.changes.filter((change) => change.status === "applied" && change.live_readback?.status === "passed");
  const indexStatuses = uniqueStrings(mutated.map((change) => change.index_maintenance?.status));
  return {
    mode: input.mode,
    operation_count: input.operations.length,
    exact_live_identity: true,
    internal_coverage_bound: COMPLETE_PAGE_LIMIT,
    sqlite_write_authority: false,
    outcome: {
      mutation: { status: mutated.some((change) => change.mutation.status === "unknown_or_partial") ? "unknown_or_partial" : mutated.length ? "completed" : "not_run", completed_count: mutated.filter((change) => change.mutation.status === "completed").length, unknown_or_partial_count: mutated.filter((change) => change.mutation.status === "unknown_or_partial").length, total_count: input.operations.length },
      live_readback: { status: applied.length === mutated.length && mutated.length ? "passed" : applied.length ? "partial" : "not_run", passed_count: applied.length, total_count: mutated.length },
      index_maintenance: { status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run", scopes: uniqueStrings(mutated.flatMap((change) => change.index_maintenance?.scopes ?? [])) },
    },
  };
}

function createState() { return { operations: [], changes: [], canonicalRefs: [], evidenceRefs: [], sqlite: sqliteEvidence() }; }

function successEnvelope({ entry, request, startedAt, now, stages, state, status = "completed", summary, data }) {
  return finalizeEnvelope({ contract: MACRO_EXECUTION_CONTRACT, ok: true, macro: macroIdentity(entry), request: requestSummary(request), execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages }, sqlite: state.sqlite, result: { summary, canonical_refs: uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count), changes: clone(state.changes), verification: { status: "passed", evidence_refs: uniqueStrings(state.evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) }, data }, blockers: [], error: null, recovery: null, budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false } });
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, status = "blocked", code, message, blockers = [], data = {} }) {
  const mutated = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation?.status));
  const verified = mutated.length > 0 && mutated.every((change) => change.live_readback?.status === "passed");
  return finalizeEnvelope({ contract: MACRO_EXECUTION_CONTRACT, ok: false, macro: macroIdentity(entry), request: requestSummary(request, true), execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages }, sqlite: state.sqlite, result: { summary: message, canonical_refs: uniqueStrings(state.canonicalRefs), changes: clone(state.changes), verification: { status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : [] }, data }, blockers: (blockers?.length ? blockers : [blocker(code, message)]).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count), error: { code, message, recoverable: true }, recovery: { undo_policy: entry.undo_policy, partial_changes_possible: status === "partial_failure", sqlite_rows_authorize_writes: false, action: status === "partial_failure" ? "Keep rows proven by live readback and inspect unverified Take state before any retry." : "Fix the typed exact-ref or coverage blocker and retry once." }, budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false } });
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.3 MIDI apply envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function collectEvidence(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([execution?.request?.id, execution?.template?.id, ...(execution?.result?.verification?.evidence_refs ?? [])]));
}
function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => { if (Array.isArray(value)) value.forEach(visit); else if (isObject(value)) { if (typeof value.kind === "string" && typeof value.ref === "string" && isObject(value.identity)) refs.push(value); else Object.values(value).forEach(visit); } };
  visit(execution?.result?.refs);
  visit(execution?.result?.canonical_refs);
  return refs;
}
function canonicalRefs(execution) {
  const refs = [];
  const visit = (value) => { if (typeof value === "string" && /^(take|item):/u.test(value)) refs.push(value); else if (Array.isArray(value)) value.forEach(visit); else if (isObject(value)) Object.values(value).forEach(visit); };
  visit(execution?.result?.refs); visit(execution?.result?.canonical_refs); visit(execution?.result?.readback); visit(execution?.result?.summary);
  return uniqueStrings(refs);
}
function objectRefFromExactTake(ref) { const value = ref.match(/^take:guid:(.+)$/u)?.[1]; return value ? { kind: "take", ref, identity: { scheme: "guid", value } } : null; }
function readback(execution) { return isObject(execution?.result?.readback) ? execution.result.readback : isObject(execution?.result?.summary) ? execution.result.summary : isObject(execution?.result?.data) ? execution.result.data : {}; }
function pushStage(stages, id, kind, status, summary, evidenceRefs = []) { const row = { id, kind, status, summary, evidence_refs: uniqueStrings(evidenceRefs) }; const index = stages.findIndex((stage) => stage.id === id); if (index >= 0) stages[index] = row; else stages.push(row); }
function sqliteEvidence(runtime, used = false) { let status = {}; try { status = runtime?.status?.() ?? {}; } catch {} return { used, source: used ? "warm_index" : "not_used", freshness: used ? "stale" : "not_applicable", snapshot_ref: used ? status.snapshot_id ?? null : null, revision: used ? String(status.revision ?? status.project_revision ?? "") || null : null, refreshed: false }; }
function requestSummary(request, forceNonDry = false) { return { request_id: request?.context?.request_id ?? `${ALPHA3_3_MIDI_APPLY_MACRO_ID}:${request?.context?.created_at ?? "request"}`, dry_run: forceNonDry ? false : request?.input?.dry_run !== false }; }
function macroIdentity(entry) { return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk }; }
function blocker(code, message, recoverable = true) { return { code, message, recoverable }; }
function failed(code, message, blockers = [blocker(code, message)]) { return { ok: false, code, message, blockers }; }
function coded(code, message, blockers = [blocker(code, message)]) { const error = new Error(message); error.code = code; error.blockers = blockers; return error; }
function isExactTakeGuid(value) { return typeof value === "string" && /^take:guid:\{[^{}\r\n]{1,128}\}$/u.test(value); }
function finitePositive(value) { return Number.isFinite(value) && value > 0; }
function finiteNonNegative(value) { return Number.isFinite(value) && value >= 0; }
function integerRange(value, min, max) { return Number.isInteger(value) && value >= min && value <= max; }
function close(left, right) { return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 1e-7; }
function uniqueStrings(values) { return [...new Set((values ?? []).filter((value) => typeof value === "string" && value.length > 0))]; }
function safeNowIso(now) { try { const value = now(); const date = value instanceof Date ? value : new Date(value); if (!Number.isNaN(date.getTime())) return date.toISOString(); } catch {} return new Date().toISOString(); }
function clone(value) { return value === undefined ? undefined : structuredClone(value); }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function deepFreeze(value) { if (value && typeof value === "object" && !Object.isFrozen(value)) { Object.freeze(value); Object.values(value).forEach(deepFreeze); } return value; }
