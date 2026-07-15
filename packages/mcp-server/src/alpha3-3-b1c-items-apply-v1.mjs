import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID = "macro.items.apply";
export const ALPHA3_3_B1C_ITEMS_APPLY_CONTRACT = "alpha3.3.b1c.items_apply.v1";
export const ALPHA3_3_B1C_ITEMS_APPLY_MODES = deepFreeze([
  "align_starts",
  "align_ends",
  "sequence_with_gap",
  "distribute_evenly",
  "move_to_anchor",
  "stack_on_existing_tracks",
  "set_properties",
  "set_active_take",
  "apply_fades",
  "trim_exact",
  "set_take_playback",
  "set_snap_offset",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES = deepFreeze([
  "align_onsets",
  "set_snap_offset_to_onset",
  "normalize_peak",
  "normalize_lufs",
  "match_loudness",
  "trim_silence_edges",
  "split_at_transients",
  "crossfade_adjacent",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS = deepFreeze([
  "volume_db",
  "muted",
  "locked",
  "loop_source",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS = deepFreeze([
  "pan",
  "active_take",
  "move_to_track",
  "take_name",
  "take_volume_db",
  "take_pan",
  "pitch_semitones",
  "reverse",
  "invert_phase",
  "channel_mode",
  "pitch_shift_mode",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS = deepFreeze([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.list_selected_items",
  "template.items.move_item",
  "template.items.set_item_volume",
  "template.items.set_mute",
  "template.items.set_lock",
  "template.items.set_loop_source",
  "template.items.set_active_take",
  "template.items.set_item_fades",
  "template.items.trim_item",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
  "template.tracks.resolve_track_ref",
  "template.items.move_item_to_track",
]);

const RESOLVE_ITEM_ID = "template.items.resolve_item_ref";
const READ_ITEM_ID = "template.items.read_item_summary";
const LIST_SELECTED_ID = "template.items.list_selected_items";
const MOVE_ITEM_ID = "template.items.move_item";
const SET_ACTIVE_TAKE_ID = "template.items.set_active_take";
const SET_ITEM_FADES_ID = "template.items.set_item_fades";
const TRIM_ITEM_ID = "template.items.trim_item";
const SET_TAKE_PLAYRATE_ID = "template.items.set_take_playrate";
const SET_ITEM_SNAP_OFFSET_ID = "template.items.set_item_snap_offset";
const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const MOVE_ITEM_TO_TRACK_ID = "template.items.move_item_to_track";
const MAX_TARGETS = 8;
const DEFAULT_TARGET_LIMIT = 4;
const POSITION_TOLERANCE = 0.000001;
const MIN_RESPONSE_BUDGET = 2_048;
const INPUT_FIELDS = new Set([
  "mode",
  "target",
  "target_refs",
  "limit",
  "dry_run",
  "anchor_seconds",
  "gap_seconds",
  "properties",
  "active_take_assignments",
  "track_assignments",
  "fade_in_seconds",
  "fade_out_seconds",
  "length_seconds",
  "playrate",
  "preserve_pitch",
  "snap_offset_seconds",
]);
const PROPERTY_DEFINITIONS = deepFreeze({
  volume_db: { template_id: "template.items.set_item_volume", input_field: "volume_db", type: "number", min: -120, max: 24 },
  muted: { template_id: "template.items.set_mute", input_field: "muted", type: "boolean" },
  locked: { template_id: "template.items.set_lock", input_field: "locked", type: "boolean" },
  loop_source: { template_id: "template.items.set_loop_source", input_field: "loop_source", type: "boolean" },
});
const CHILD_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: 128,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  program_id: "openreaper.macro.items.apply",
  program_version: "1.2.1",
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_B1C_ITEMS_APPLY_MODES },
      target: { type: "string", enum: ["selected"] },
      target_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      limit: { type: "integer", minimum: 1, maximum: MAX_TARGETS },
      dry_run: { type: "boolean" },
      anchor_seconds: { type: "number", minimum: 0 },
      gap_seconds: { type: "number", minimum: 0 },
      properties: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          volume_db: { type: "number", minimum: -120, maximum: 24 },
          muted: { type: "boolean" },
          locked: { type: "boolean" },
          loop_source: { type: "boolean" },
        },
      },
      active_take_assignments: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TARGETS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_ref: { type: "string" },
            take_ref: { type: "string" },
          },
          required: ["item_ref", "take_ref"],
        },
      },
      track_assignments: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TARGETS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_ref: { type: "string" },
            target_track_ref: { type: "string" },
          },
          required: ["item_ref", "target_track_ref"],
        },
      },
      fade_in_seconds: { type: ["number", "null"], minimum: 0 },
      fade_out_seconds: { type: ["number", "null"], minimum: 0 },
      length_seconds: { type: "number", exclusiveMinimum: 0 },
      playrate: { type: "number", exclusiveMinimum: 0, maximum: 16 },
      preserve_pitch: { type: "boolean" },
      snap_offset_seconds: { type: "number", minimum: 0 },
    },
    required: ["mode"],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: true,
    live_reresolve_before_write: true,
  },
  sqlite_policy: {
    mode: "invalidate_after_write",
    write_authority: false,
    identity_fields: ["item_ref", "take_ref"],
  },
  dependencies: {
    template_ids: ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
    runtime_capabilities: [],
  },
  stages: [
    { id: "items-apply-targets", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "items-apply-preflight", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: READ_ITEM_ID },
    { id: "items-apply-mutate", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: MOVE_ITEM_ID },
    { id: "items-apply-verify", kind: "verify", risk: "read", stop_on_error: true },
    { id: "items-apply-index", kind: "index_update", risk: "write", stop_on_error: true },
    { id: "items-apply-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3B1cItemsApplyRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY = createAlpha3_3B1cItemsApplyRegistry();

export function isAlpha3_3B1cItemsApplyMacroId(id) {
  return id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID;
}

export function createAlpha3_3B1cItemsApplyDiscoveryItems({ liveRunnableNow = false } = {}) {
  return deepFreeze([{
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    title: "Arrange Items, set properties, choose Active Takes, fades, trims, and playback",
    user_label: "Apply Item changes",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.items.apply",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "items_apply",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable",
    support_state: "supported_with_live_readback",
    live_runnable_now: liveRunnableNow,
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    summary: "Arrange selected or exact Items, move exact Items onto existing Tracks, set accepted properties, choose exact Active Takes, or apply bounded fades, exact trims, Take playback, and snap offsets.",
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_modes: ALPHA3_3_B1C_ITEMS_APPLY_MODES,
    held_modes: ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES,
    supported_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS,
    held_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS,
    examples: [
      { name: "sequence_selected_items", input: { mode: "sequence_with_gap", target: "selected", gap_seconds: 0.1, dry_run: true } },
      { name: "mute_exact_items", input: { mode: "set_properties", target_refs: ["item:guid:{ITEM-GUID}"], properties: { muted: true }, dry_run: false } },
      { name: "choose_exact_active_take", input: { mode: "set_active_take", active_take_assignments: [{ item_ref: "item:guid:{ITEM-GUID}", take_ref: "take:guid:{TAKE-GUID}" }], dry_run: false } },
      { name: "stack_on_existing_tracks", input: { mode: "stack_on_existing_tracks", track_assignments: [{ item_ref: "item:guid:{ITEM-GUID}", target_track_ref: "track:guid:{TRACK-GUID}" }], dry_run: false } },
      { name: "fade_exact_items", input: { mode: "apply_fades", target_refs: ["item:guid:{ITEM-GUID}"], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false } },
      { name: "set_take_playback", input: { mode: "set_take_playback", target_refs: ["item:guid:{ITEM-GUID}"], playrate: 1.25, preserve_pitch: true, dry_run: false } },
    ],
  }]);
}

export function createAlpha3_3B1cItemsApplyExactManual() {
  return deepFreeze({
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    rollout_slice: "Alpha3.3-B1c",
    action_manual: {
      when_to_use: [
        "Use one fixed arrangement mode for selected or exact Items, with dry_run first when the calculated positions should be inspected.",
        "Use set_properties for Item-level volume_db, muted, locked, or loop_source only.",
        "Use set_active_take with one to eight explicit item_ref/take_ref assignment rows; each exact Take is applied only to its paired exact Item.",
        "Use stack_on_existing_tracks with one to eight explicit item_ref/target_track_ref rows; every destination must already exist.",
        "Use apply_fades, trim_exact, set_take_playback, or set_snap_offset for bounded common edits backed by accepted native Item/Take atoms.",
      ],
      when_not_to_use: [
        "Do not reinterpret trim_exact as silence analysis, or apply_fades as crossfade construction; normalization, transient splitting, crossfades, and onset alignment remain held.",
        "stack_on_existing_tracks never creates Tracks or folders; use macro.project.apply_layout first when the destination layout does not exist.",
        "Do not request Take fields through set_properties; use set_active_take or set_take_playback so each mode keeps a bounded schema and readback contract.",
        "Do not request pan as an Item-level field: no REAPER Item-level pan control is proven here, and macro.items.apply will not silently redirect it to the current Active Take.",
      ],
      required_readiness: [
        "The managed OpenReaper live bridge and every fixed Template dependency must be connected.",
        "Select at most eight Items, or provide at most eight exact canonical Item refs.",
      ],
      input_shape: {
        mode: ALPHA3_3_B1C_ITEMS_APPLY_MODES.join(" | "),
        target: "selected; used by arrangement/property modes when target_refs or exact request refs are absent. Forbidden for set_active_take.",
        target_refs: "Optional array of at most eight exact canonical item:guid refs for arrangement/property modes. Forbidden for set_active_take.",
        limit: "1-8; defaults to the complete explicit exact-ref set (at most 8), or 4 for implicit selected targets. Selected writes fail closed instead of truncating an oversized selection. set_active_take is bounded by its assignment rows instead.",
        dry_run: "Defaults to true. false is required to mutate REAPER.",
        anchor_seconds: "Non-negative project time; required by move_to_anchor and optional for other arrangement modes.",
        gap_seconds: "Non-negative gap for sequence_with_gap; defaults to 0.",
        properties: "For set_properties only: one or more of volume_db, muted, locked, loop_source. pan is held and fails closed.",
        active_take_assignments: "For set_active_take only: 1-8 rows shaped {item_ref:'item:guid:{GUID}', take_ref:'take:guid:{GUID}'}. Selection and unpaired refs are forbidden.",
        track_assignments: "For stack_on_existing_tracks only: 1-8 rows shaped {item_ref:'item:guid:{GUID}', target_track_ref:'track:guid:{GUID}'}. Selection and implicit Track creation are forbidden.",
        fades: "apply_fades accepts fade_in_seconds and/or fade_out_seconds as null or non-negative seconds; an omitted/null side clears to zero.",
        trim: "trim_exact requires positive length_seconds and does not analyze silence or change source media on disk.",
        take_playback: "set_take_playback requires positive playrate (max 16) plus explicit preserve_pitch and an existing Active Take.",
        snap_offset: "set_snap_offset requires a non-negative item-local snap_offset_seconds no greater than the current Item length.",
      },
      preflight_steps: [
        "Reject unknown fields, held modes, held property fields, ambiguous target coverage, and impossible response budgets before mutation.",
        "Resolve every target live, read exact Item position/length/Active Take facts, then calculate the full deterministic operation list.",
        "For set_active_take, preserve each explicit Item/Take pair. The atom validates live Take ownership before SetActiveTake; the Macro never infers a Take from selection.",
        "For stack_on_existing_tracks, resolve both sides live, preserve every explicit Item/Track pair, and refuse missing or duplicate destinations before any move.",
      ],
      underlying_actions: ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
      readback_steps: [
        "Arrangement modes read every exact Item summary after all moves and compare the requested position row by row.",
        "Property/fade/trim/Take-playback/snap modes require the accepted atomic Template to return the exact Item ref and every live REAPER field value that it just read back.",
        "set_active_take marks a row applied only when the atom returns the paired exact item_ref, requested active_take_ref, and passed native GetActiveTake readback.",
        "stack_on_existing_tracks marks a row applied only when the atom returns the exact Item and target Track plus passed identity/take/Track-count readback.",
        "Index invalidation is reported separately and never changes an already verified mutation into an unverified applied claim.",
      ],
      success_criteria: [
        "A change is status=applied only when its own live_readback.status=passed.",
        "Mutation, live readback, and Project Index maintenance have separate result statuses.",
        "SQLite is never used as write authority; source media is never deleted.",
      ],
      common_blockers: [
        blocker("ITEM_APPLY_MODE_HELD", "The requested mode is outside the executable B1c allowlist."),
        blocker("ITEM_APPLY_ITEM_PAN_UNSUPPORTED", "Item-level pan is not a proven REAPER field and is never redirected to an Active Take."),
        blocker("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take requires 1-8 unique exact Item/Take assignment rows and never uses selection."),
        blocker("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", "stack_on_existing_tracks requires 1-8 unique exact Item/existing-Track assignment rows and never creates Tracks."),
        blocker("ITEM_APPLY_ACTIVE_TAKE_REQUIRED", "set_take_playback requires an existing exact Active Take and does not choose one implicitly."),
        blocker("ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM", "The requested item-local snap offset exceeds the live Item length."),
        blocker("ITEM_APPLY_TARGET_COVERAGE_INCOMPLETE", "The selected target set exceeds the bounded write limit and was not partially mutated."),
        blocker("ITEM_APPLY_READBACK_MISMATCH", "A row-level live value did not match the requested value."),
        blocker("ITEM_APPLY_RESPONSE_BUDGET_EXCEEDED", "The compact per-change result cannot fit the active response budget before mutation."),
      ],
      recovery_steps: [
        "Use the reported per-stage REAPER undo entries for completed mutations, fix the typed blocker, then retry only the remaining bounded task.",
        "If the user explicitly wants Active Take pan, first confirm the current Active Take, then use macro.controls.set with target_kind=take or the reviewed template.items.set_take_pan; never silently change the current Take on a multi-Take Item.",
        "For held behavior, wait for its accepted Template lifecycle rather than injecting steps, raw Actions, Lua, or shell workarounds.",
      ],
      dry_run_shape: {
        supported: true,
        behavior: "Resolves and reads live targets, calculates the exact fixed operation list, and performs no mutation or index invalidation.",
        output: ["calculated_positions_properties_or_active_takes", "per_target_preview", "undo_policy", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "live target resolution; no stale SQLite identity is reused for writes",
        retry: "Retry once after correcting the typed target, budget, readiness, or readback blocker.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
      examples: [
        { name: "align starts", input: { mode: "align_starts", target: "selected", dry_run: false } },
        { name: "move group", input: { mode: "move_to_anchor", target_refs: ["item:guid:{A}", "item:guid:{B}"], anchor_seconds: 12, dry_run: true } },
        { name: "set Item properties", input: { mode: "set_properties", target: "selected", properties: { volume_db: -3, muted: false }, dry_run: false } },
        { name: "set Active Takes", input: { mode: "set_active_take", active_take_assignments: [{ item_ref: "item:guid:{ITEM-A}", take_ref: "take:guid:{TAKE-A2}" }], dry_run: false } },
        { name: "stack on existing Tracks", input: { mode: "stack_on_existing_tracks", track_assignments: [{ item_ref: "item:guid:{ITEM-A}", target_track_ref: "track:guid:{TRACK-B}" }], dry_run: false } },
        { name: "set Item fades", input: { mode: "apply_fades", target_refs: ["item:guid:{A}"], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false } },
        { name: "trim exact visible length", input: { mode: "trim_exact", target_refs: ["item:guid:{A}"], length_seconds: 1.25, dry_run: false } },
        { name: "set Active Take playback", input: { mode: "set_take_playback", target_refs: ["item:guid:{A}"], playrate: 1.25, preserve_pitch: true, dry_run: false } },
        { name: "set Item snap offset", input: { mode: "set_snap_offset", target_refs: ["item:guid:{A}"], snap_offset_seconds: 0.05, dry_run: false } },
      ],
    },
  });
}

export async function executeAlpha3_3B1cItemsApplyMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.get(ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const activeBudget = responseBudget(request);
  const normalized = normalizeInput(request.input);
  if (!normalized.ok) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  }

  const programRequest = {
    macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input: normalized.input,
    refs: request.refs ?? {},
    dry_run: normalized.input.dry_run,
  };
  const validation = validateMacroProgramRequest(programRequest, { registry: ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_REQUEST_INVALID", message, blockers: validation.errors.map((error) => blocker("ITEM_APPLY_REQUEST_INVALID", error)) });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_LIVE_EXECUTOR_REQUIRED", message: "macro.items.apply requires the managed OpenReaper live executor." });
  }

  const targets = await resolveTargets({ request, input: normalized.input, executeAtomic, state });
  if (!targets.ok) {
    pushStage(stages, "items-apply-targets", "live_ref_resolve", "blocked", targets.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: targets.code, message: targets.message, blockers: targets.blockers, data: targetData(state) });
  }
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Resolved ${targets.refs.length} exact live Item target(s).`, state.evidenceRefs);

  const facts = await readTargetFacts({ targets: targets.refs, assignments: targets.assignments, request, executeAtomic, state });
  if (!facts.ok) {
    pushStage(stages, "items-apply-preflight", "template_execute", "failed", facts.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: facts.code, message: facts.message, blockers: facts.blockers, data: targetData(state) });
  }
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", `Read exact position and length facts for ${facts.rows.length} Item(s).`, state.evidenceRefs);

  const plan = buildOperationPlan(normalized.input, facts.rows);
  if (!plan.ok) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: plan.code, message: plan.message, blockers: plan.blockers, data: targetData(state) });
  }
  state.operations = plan.operations;
  const budgetBlocker = responseBudgetBlocker({ entry, request, input: normalized.input, stages, state, activeBudget });
  if (budgetBlocker) {
    return failureEnvelope({ entry, request, startedAt, now, stages: [], state: createState(), activeBudget, code: budgetBlocker.code, message: budgetBlocker.message, blockers: [budgetBlocker], data: { required_bytes: budgetBlocker.required_bytes, available_bytes: activeBudget } });
  }

  if (normalized.input.dry_run) {
    state.changes = plan.operations.map(previewChange);
    pushStage(stages, "items-apply-mutate", "template_execute", "skipped", "dry_run=true; no Item mutation was dispatched.", []);
    pushStage(stages, "items-apply-verify", "verify", "completed", "Validated the complete deterministic operation preview against live Item facts.", state.evidenceRefs);
    pushStage(stages, "items-apply-index", "index_update", "skipped", "Dry run did not stale the Project Index.", []);
    pushStage(stages, "items-apply-result", "result_project", "completed", "Projected the bounded Item operation preview.", state.evidenceRefs);
    return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "dry_run_completed", summary: `Previewed ${plan.operations.length} fixed Item operation(s) with no mutation.`, data: resultData(normalized.input, state) });
  }

  let executionFailure = null;
  if (["set_properties", "set_active_take", "stack_on_existing_tracks"].includes(normalized.input.mode)) {
    executionFailure = await executePropertyPlan({ plan, request, executeAtomic, state });
  } else if (["apply_fades", "trim_exact", "set_take_playback", "set_snap_offset"].includes(normalized.input.mode)) {
    executionFailure = await executePropertyPlan({ plan, request, executeAtomic, state });
  } else {
    executionFailure = await executeArrangementPlan({ plan, request, executeAtomic, state });
  }
  pushStage(
    stages,
    "items-apply-mutate",
    "template_execute",
    executionFailure?.phase === "mutation" ? "failed" : "completed",
    `${state.changes.filter((change) => change.mutation.status === "completed").length} of ${plan.operations.length} fixed mutation row(s) completed.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "items-apply-verify",
    "verify",
    executionFailure?.phase === "readback" ? "failed" : executionFailure?.phase === "mutation" ? "skipped" : "completed",
    `${state.changes.filter((change) => change.live_readback.status === "passed").length} row(s) passed exact live readback.`,
    state.evidenceRefs,
  );

  const indexResult = maintainProjectIndex(projectIndexRuntime, state, now);
  pushStage(stages, "items-apply-index", "index_update", indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);
  applyIndexMaintenance(state.changes, indexResult);

  if (executionFailure) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      status: state.changes.some((change) => change.mutation.status === "completed") ? "partial_failure" : "failed",
      code: executionFailure.code,
      message: executionFailure.message,
      blockers: executionFailure.blockers,
      data: resultData(normalized.input, state),
    });
  }
  if (indexResult.ok === false) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      status: "partial_failure",
      code: indexResult.code,
      message: indexResult.message,
      blockers: indexResult.blockers,
      data: resultData(normalized.input, state),
    });
  }

  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected per-row mutation, live readback, and index-maintenance truth.", state.evidenceRefs);
  return successEnvelope({
    entry,
    request,
    startedAt,
    now,
    stages,
    state,
    activeBudget,
    status: "completed",
    summary: `Applied and verified ${state.changes.length} Item change row(s).`,
    data: resultData(normalized.input, state),
  });
}

async function resolveTargets({ request, input, executeAtomic, state }) {
  if (input.mode === "set_active_take") {
    return resolveActiveTakeAssignments({ request, assignments: input.active_take_assignments, executeAtomic, state });
  }
  if (input.mode === "stack_on_existing_tracks") {
    return resolveTrackAssignments({ request, assignments: input.track_assignments, executeAtomic, state });
  }
  const directRefs = collectItemObjectRefs(request.refs);
  const tokens = input.target_refs;
  const exactTargetCount = directRefs.length + tokens.length;
  const effectiveLimit = request.input?.limit === undefined && exactTargetCount > 0
    ? Math.min(MAX_TARGETS, exactTargetCount)
    : input.limit;
  if (exactTargetCount > effectiveLimit || exactTargetCount > MAX_TARGETS) {
    return failed("ITEM_APPLY_TARGET_LIMIT_EXCEEDED", `Exact Item targets exceed the bounded write limit of ${effectiveLimit}.`);
  }

  const candidates = directRefs.map((ref) => ({ ref, expected_ref: ref.ref }));
  for (const token of tokens) candidates.push({ token, expected_ref: canonicalTokenRef(token) });
  if (candidates.length === 0) {
    const execution = await runAtomic(executeAtomic, request, { id: LIST_SELECTED_ID, input: { limit: effectiveLimit, include_track_refs: true }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, LIST_SELECTED_ID);
    const summary = executionSummary(execution);
    state.targetScope = "selected";
    state.totalTargetCount = integerOr(summary.selected_count, 0);
    state.targetsTruncated = summary.truncated === true || state.totalTargetCount > effectiveLimit;
    if (state.targetsTruncated) {
      return failed("ITEM_APPLY_TARGET_COVERAGE_INCOMPLETE", `Selected Item count ${state.totalTargetCount} exceeds the bounded write limit ${effectiveLimit}; no partial selection was mutated.`);
    }
    for (const ref of executionObjectRefs(execution).filter((entry) => entry.kind === "item")) {
      candidates.push({ ref, expected_ref: ref.ref });
    }
  } else {
    state.targetScope = directRefs.length > 0 && tokens.length > 0 ? "mixed_exact" : "exact";
    state.totalTargetCount = candidates.length;
    state.targetsTruncated = false;
  }

  if (candidates.length === 0) return failed("ITEM_APPLY_TARGETS_EMPTY", "No selected or exact Item target could be resolved.");
  const resolved = [];
  for (const candidate of candidates) {
    const token = candidate.ref?.ref ?? candidate.token;
    const execution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: token }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(execution).find((entry) => entry.kind === "item");
    if (!itemRef) return failed("ITEM_APPLY_TARGET_NOT_FOUND", `Item target ${token} did not resolve to a canonical Item ref.`);
    if (candidate.expected_ref && candidate.expected_ref !== itemRef.ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution changed identity from ${candidate.expected_ref} to ${itemRef.ref}; no mutation was run.`);
    }
    resolved.push(itemRef);
  }
  const uniqueRefs = uniqueObjectRefs(resolved);
  if (uniqueRefs.length !== resolved.length) return failed("ITEM_APPLY_TARGETS_DUPLICATED", "The target list resolves more than once to the same Item; remove duplicate refs before mutation.");
  state.returnedTargetCount = uniqueRefs.length;
  state.canonicalRefs.push(...uniqueRefs.map((ref) => ref.ref));
  return { ok: true, refs: uniqueRefs };
}

async function resolveActiveTakeAssignments({ request, assignments, executeAtomic, state }) {
  if (Object.keys(plainObject(request.refs)).length > 0) {
    return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take accepts only active_take_assignments rows; separate request refs cannot preserve explicit Item/Take pairing.");
  }
  state.targetScope = "exact_active_take_assignments";
  state.totalTargetCount = assignments.length;
  state.targetsTruncated = false;
  const resolved = [];
  for (const assignment of assignments) {
    const execution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: assignment.item_ref }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(execution).find((entry) => entry.kind === "item");
    if (!itemRef) return failed("ITEM_APPLY_TARGET_NOT_FOUND", `Item target ${assignment.item_ref} did not resolve to a canonical Item ref.`);
    if (itemRef.ref !== assignment.item_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution changed identity from ${assignment.item_ref} to ${itemRef.ref}; no mutation was run.`);
    }
    resolved.push({ item_ref: itemRef, take_ref: exactGuidObjectRef("take", assignment.take_ref) });
  }
  state.returnedTargetCount = resolved.length;
  state.canonicalRefs.push(...resolved.flatMap((row) => [row.item_ref.ref, row.take_ref.ref]));
  return { ok: true, refs: resolved.map((row) => row.item_ref), assignments: resolved };
}

async function resolveTrackAssignments({ request, assignments, executeAtomic, state }) {
  if (Object.keys(plainObject(request.refs)).length > 0) {
    return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", "stack_on_existing_tracks accepts only track_assignments rows; separate request refs cannot preserve explicit Item/Track pairing.");
  }
  state.targetScope = "exact_item_track_assignments";
  state.totalTargetCount = assignments.length;
  state.targetsTruncated = false;
  const resolved = [];
  for (const assignment of assignments) {
    const itemExecution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: assignment.item_ref }, refs: [] });
    collectExecutionEvidence(state, itemExecution);
    if (itemExecution?.ok !== true) return atomicFailure(itemExecution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(itemExecution).find((entry) => entry.kind === "item");
    if (!itemRef || itemRef.ref !== assignment.item_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution did not exactly preserve ${assignment.item_ref}; no move was run.`);
    }

    const trackExecution = await runAtomic(executeAtomic, request, { id: RESOLVE_TRACK_ID, input: { track_ref: assignment.target_track_ref }, refs: [] });
    collectExecutionEvidence(state, trackExecution);
    if (trackExecution?.ok !== true) return atomicFailure(trackExecution, RESOLVE_TRACK_ID);
    const targetTrackRef = executionObjectRefs(trackExecution).find((entry) => entry.kind === "track");
    if (!targetTrackRef || targetTrackRef.ref !== assignment.target_track_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Track resolution did not exactly preserve ${assignment.target_track_ref}; no move was run.`);
    }
    resolved.push({ item_ref: itemRef, target_track_ref: targetTrackRef });
  }
  state.returnedTargetCount = resolved.length;
  state.canonicalRefs.push(...resolved.flatMap((row) => [row.item_ref.ref, row.target_track_ref.ref]));
  return { ok: true, refs: resolved.map((row) => row.item_ref), assignments: resolved };
}

async function readTargetFacts({ targets, assignments = [], request, executeAtomic, state }) {
  const rows = [];
  for (const [index, itemRef] of targets.entries()) {
    const execution = await runAtomic(executeAtomic, request, {
      id: READ_ITEM_ID,
      input: { include_take_summary: true },
      refs: { item_ref: itemRef },
    });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, READ_ITEM_ID);
    const summary = executionSummary(execution);
    if (summary.item_ref !== itemRef.ref) return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Item summary ${index + 1} did not round-trip the exact live item_ref.`);
    if (!Number.isFinite(summary.position_seconds) || summary.position_seconds < 0 || !Number.isFinite(summary.length_seconds) || summary.length_seconds < 0) {
      return failed("ITEM_APPLY_ITEM_FACTS_INVALID", `Item ${itemRef.ref} did not return finite non-negative position and length facts.`);
    }
    rows.push({
      item_ref: itemRef,
      source_track_ref: stringOrNull(summary.track_ref),
      position_seconds: summary.position_seconds,
      length_seconds: summary.length_seconds,
      end_seconds: summary.position_seconds + summary.length_seconds,
      active_take_ref: stringOrNull(summary.active_take_ref),
      snap_offset_seconds: finiteOrNull(summary.snap_offset_seconds),
      fade_in_seconds: finiteOrNull(summary.fade_in_seconds),
      fade_out_seconds: finiteOrNull(summary.fade_out_seconds),
      requested_take_ref: assignments[index]?.take_ref ?? null,
      requested_track_ref: assignments[index]?.target_track_ref ?? null,
      target_order: index,
    });
  }
  return { ok: true, rows };
}

function buildOperationPlan(input, facts) {
  if (input.mode === "stack_on_existing_tracks") {
    const missingOwner = facts.find((fact) => typeof fact.source_track_ref !== "string" || !fact.source_track_ref.startsWith("track:") || !fact.requested_track_ref);
    if (missingOwner) return failed("ITEM_APPLY_ITEM_FACTS_INVALID", `${missingOwner.item_ref.ref} did not return an exact live source Track or destination assignment; no move was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-target_track_ref`,
        kind: "move_item_to_track",
        template_id: MOVE_ITEM_TO_TRACK_ID,
        item_ref: fact.item_ref,
        target_track_ref: fact.requested_track_ref,
        field: "target_track_ref",
        before_value: fact.source_track_ref,
        requested_value: fact.requested_track_ref.ref,
        input: {},
      })),
    };
  }
  if (input.mode === "set_active_take") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-active_take_ref`,
        kind: "set_active_take",
        template_id: SET_ACTIVE_TAKE_ID,
        item_ref: fact.item_ref,
        take_ref: fact.requested_take_ref,
        field: "active_take_ref",
        before_value: fact.active_take_ref,
        requested_value: fact.requested_take_ref.ref,
        input: {},
      })),
    };
  }
  if (input.mode === "set_properties") {
    const operations = [];
    for (const fact of facts) {
      for (const field of ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS) {
        if (!Object.hasOwn(input.properties, field)) continue;
        const definition = PROPERTY_DEFINITIONS[field];
        operations.push({
          operation_id: `item-${fact.target_order + 1}-${field}`,
          kind: "set_property",
          template_id: definition.template_id,
          item_ref: fact.item_ref,
          field,
          requested_value: input.properties[field],
          input: { [definition.input_field]: input.properties[field] },
        });
      }
    }
    return { ok: true, operations };
  }
  if (input.mode === "apply_fades") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-fades`,
        kind: "set_item_fades",
        template_id: SET_ITEM_FADES_ID,
        item_ref: fact.item_ref,
        field: "fades",
        before_value: { fade_in_seconds: fact.fade_in_seconds, fade_out_seconds: fact.fade_out_seconds },
        requested_value: {
          fade_in_seconds: input.fade_in_seconds ?? 0,
          fade_out_seconds: input.fade_out_seconds ?? 0,
        },
        verify_fields: ["fade_in_seconds", "fade_out_seconds"],
        input: { fade_in_seconds: input.fade_in_seconds, fade_out_seconds: input.fade_out_seconds },
      })),
    };
  }
  if (input.mode === "trim_exact") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-length_seconds`,
        kind: "trim_item",
        template_id: TRIM_ITEM_ID,
        item_ref: fact.item_ref,
        field: "length_seconds",
        before_value: fact.length_seconds,
        requested_value: input.length_seconds,
        input: { length_seconds: input.length_seconds },
      })),
    };
  }
  if (input.mode === "set_take_playback") {
    const noTake = facts.find((fact) => !fact.active_take_ref);
    if (noTake) return failed("ITEM_APPLY_ACTIVE_TAKE_REQUIRED", `${noTake.item_ref.ref} has no Active Take; no Take playback mutation was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-take-playback`,
        kind: "set_take_playback",
        template_id: SET_TAKE_PLAYRATE_ID,
        item_ref: fact.item_ref,
        field: "take_playback",
        before_value: null,
        requested_value: { playrate: input.playrate, preserve_pitch: input.preserve_pitch },
        verify_fields: ["playrate", "preserve_pitch"],
        input: { playrate: input.playrate, preserve_pitch: input.preserve_pitch },
      })),
    };
  }
  if (input.mode === "set_snap_offset") {
    const outsideItem = facts.find((fact) => input.snap_offset_seconds > fact.length_seconds + POSITION_TOLERANCE);
    if (outsideItem) return failed("ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM", `snap_offset_seconds exceeds ${outsideItem.item_ref.ref} length; no mutation was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-snap_offset_seconds`,
        kind: "set_snap_offset",
        template_id: SET_ITEM_SNAP_OFFSET_ID,
        item_ref: fact.item_ref,
        field: "snap_offset_seconds",
        before_value: fact.snap_offset_seconds,
        requested_value: input.snap_offset_seconds,
        input: { snap_offset_seconds: input.snap_offset_seconds },
      })),
    };
  }

  const timeline = [...facts].sort((a, b) => a.position_seconds - b.position_seconds || a.target_order - b.target_order);
  const desired = new Map();
  if (input.mode === "align_starts") {
    const anchor = input.anchor_seconds ?? Math.min(...facts.map((fact) => fact.position_seconds));
    for (const fact of facts) desired.set(fact.item_ref.ref, anchor);
  } else if (input.mode === "align_ends") {
    const anchor = input.anchor_seconds ?? Math.max(...facts.map((fact) => fact.end_seconds));
    for (const fact of facts) desired.set(fact.item_ref.ref, anchor - fact.length_seconds);
  } else if (input.mode === "sequence_with_gap") {
    let cursor = input.anchor_seconds ?? timeline[0].position_seconds;
    for (const fact of timeline) {
      desired.set(fact.item_ref.ref, cursor);
      cursor += fact.length_seconds + input.gap_seconds;
    }
  } else if (input.mode === "distribute_evenly") {
    const first = input.anchor_seconds ?? timeline[0].position_seconds;
    const span = timeline.length === 1 ? 0 : timeline.at(-1).position_seconds - timeline[0].position_seconds;
    const step = timeline.length < 2 ? 0 : span / (timeline.length - 1);
    for (const [index, fact] of timeline.entries()) desired.set(fact.item_ref.ref, first + (step * index));
  } else if (input.mode === "move_to_anchor") {
    const first = Math.min(...facts.map((fact) => fact.position_seconds));
    const delta = input.anchor_seconds - first;
    for (const fact of facts) desired.set(fact.item_ref.ref, fact.position_seconds + delta);
  }

  const operations = facts.map((fact) => ({
    operation_id: `item-${fact.target_order + 1}-position_seconds`,
    kind: "move_item",
    template_id: MOVE_ITEM_ID,
    item_ref: fact.item_ref,
    field: "position_seconds",
    before_value: fact.position_seconds,
    requested_value: desired.get(fact.item_ref.ref),
    input: { position_seconds: desired.get(fact.item_ref.ref) },
  }));
  const invalid = operations.find((operation) => !Number.isFinite(operation.requested_value) || operation.requested_value < 0);
  if (invalid) return failed("ITEM_APPLY_POSITION_INVALID", `${input.mode} would move ${invalid.item_ref.ref} before project time zero; no mutation was run.`);
  return { ok: true, operations };
}

async function executePropertyPlan({ plan, request, executeAtomic, state }) {
  for (const operation of plan.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    let execution;
    try {
      execution = await runAtomic(executeAtomic, request, {
        id: operation.template_id,
        input: operation.input,
        refs: compactObject({ item_ref: operation.item_ref, take_ref: operation.take_ref, target_track_ref: operation.target_track_ref }),
      });
    } catch (error) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return executionError(error, operation.template_id, "mutation");
    }
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
    }
    change.mutation = { status: "completed", template_id: operation.template_id };
    const summary = executionSummary(execution);
    const observed = Array.isArray(operation.verify_fields)
      ? Object.fromEntries(operation.verify_fields.map((field) => [field, summary[field]]))
      : summary[operation.field];
    const targetMatches = summary.item_ref === operation.item_ref.ref;
    const valueMatches = Array.isArray(operation.verify_fields)
      ? operation.verify_fields.every((field) => valuesMatch(summary[field], operation.requested_value[field]))
      : valuesMatch(observed, operation.requested_value);
    const preservationMatches = operation.kind !== "move_item_to_track" || summary.track_count_unchanged === true;
    if (!targetMatches || !valueMatches || !preservationMatches || summary.readback_status !== "passed") {
      change.status = "readback_failed";
      change.live_readback = compactObject({
        status: "failed",
        source: operation.kind === "set_active_take" ? "exact_active_take_readback" : operation.kind === "move_item_to_track" ? "exact_item_track_readback" : "accepted_template_live_readback",
        observed_value: observed,
        observed_item_ref: stringOrNull(summary.item_ref),
      });
      return failedReadback(operation, observed, summary.item_ref);
    }
    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: operation.kind === "set_active_take" ? "exact_active_take_readback" : operation.kind === "move_item_to_track" ? "exact_item_track_readback" : "accepted_template_live_readback",
      observed_value: observed,
    };
  }
  return null;
}

async function executeArrangementPlan({ plan, request, executeAtomic, state }) {
  for (const operation of plan.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    let execution;
    try {
      execution = await runAtomic(executeAtomic, request, {
        id: operation.template_id,
        input: operation.input,
        refs: { item_ref: operation.item_ref },
      });
    } catch (error) {
      change.mutation = { status: "failed" };
      return executionError(error, operation.template_id, "mutation");
    }
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.mutation = { status: "failed" };
      return { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
    }
    const summary = executionSummary(execution);
    change.mutation = { status: "completed", template_id: operation.template_id };
    if (summary.item_ref !== operation.item_ref.ref) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "mutation_response_identity" };
      return failedReadback(operation, summary.position_seconds, summary.item_ref);
    }
  }

  let firstFailure = null;
  for (const operation of plan.operations) {
    const change = state.changes.find((entry) => entry.operation_id === operation.operation_id);
    const execution = await runAtomic(executeAtomic, request, {
      id: READ_ITEM_ID,
      input: { include_take_summary: false },
      refs: { item_ref: operation.item_ref },
    });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "live_item_summary" };
      firstFailure ??= { ...atomicFailure(execution, READ_ITEM_ID), phase: "readback" };
      continue;
    }
    const summary = executionSummary(execution);
    const matches = summary.item_ref === operation.item_ref.ref && valuesMatch(summary.position_seconds, operation.requested_value);
    if (!matches) {
      change.status = "readback_failed";
      change.live_readback = compactObject({ status: "failed", source: "live_item_summary", observed_value: finiteOrNull(summary.position_seconds), observed_item_ref: stringOrNull(summary.item_ref) });
      firstFailure ??= failedReadback(operation, summary.position_seconds, summary.item_ref);
      continue;
    }
    change.status = "applied";
    change.live_readback = { status: "passed", source: "live_item_summary", observed_value: summary.position_seconds };
  }
  return firstFailure;
}

function normalizeInput(input) {
  if (!isPlainObject(input)) return failed("ITEM_APPLY_REQUEST_INVALID", "macro.items.apply input must be an object.");
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `Unsupported input field(s): ${unknown.join(", ")}. No model-supplied steps are accepted.`);
  const mode = input.mode;
  if (!ALPHA3_3_B1C_ITEMS_APPLY_MODES.includes(mode)) {
    const held = ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES.includes(mode);
    return failed(held ? "ITEM_APPLY_MODE_HELD" : "ITEM_APPLY_MODE_UNSUPPORTED", `mode=${String(mode)} is not executable; supported modes are ${ALPHA3_3_B1C_ITEMS_APPLY_MODES.join(", ")}.`);
  }
  const target = input.target ?? "selected";
  if (target !== "selected") return failed("ITEM_APPLY_TARGET_SELECTOR_UNSUPPORTED", "target must be selected when exact target_refs are not supplied.");
  const targetRefs = input.target_refs ?? [];
  if (!Array.isArray(targetRefs) || targetRefs.some((ref) => !isExactItemToken(ref))) {
    return failed("ITEM_APPLY_EXACT_TARGET_REQUIRED", "target_refs must contain only non-empty exact item:guid or guid Item refs.");
  }
  if (targetRefs.length > MAX_TARGETS) return failed("ITEM_APPLY_TARGET_LIMIT_EXCEEDED", `target_refs exceeds the maximum of ${MAX_TARGETS}.`);
  const limit = input.limit ?? DEFAULT_TARGET_LIMIT;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TARGETS) return failed("ITEM_APPLY_REQUEST_INVALID", `limit must be an integer from 1 to ${MAX_TARGETS}.`);
  const dryRun = input.dry_run !== false;
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") return failed("ITEM_APPLY_REQUEST_INVALID", "dry_run must be boolean.");
  const anchor = optionalNonNegativeNumber(input.anchor_seconds, "anchor_seconds");
  if (!anchor.ok) return anchor;
  const gap = optionalNonNegativeNumber(input.gap_seconds, "gap_seconds");
  if (!gap.ok) return gap;

  let properties = null;
  let activeTakeAssignments = null;
  let trackAssignments = null;
  let fadeInSeconds = null;
  let fadeOutSeconds = null;
  let lengthSeconds = null;
  let playrate = null;
  let preservePitch = null;
  let snapOffsetSeconds = null;
  if (mode !== "stack_on_existing_tracks" && input.track_assignments !== undefined) {
    return failed("ITEM_APPLY_REQUEST_INVALID", "track_assignments is valid only for stack_on_existing_tracks.");
  }
  if (mode === "set_properties") {
    const normalizedProperties = normalizeProperties(input.properties);
    if (!normalizedProperties.ok) return normalizedProperties;
    properties = normalizedProperties.value;
    if (input.active_take_assignments !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", "set_properties does not accept active_take_assignments.");
    if (anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_properties does not accept anchor_seconds or gap_seconds.");
  } else if (mode === "set_active_take") {
    const normalizedAssignments = normalizeActiveTakeAssignments(input.active_take_assignments);
    if (!normalizedAssignments.ok) return normalizedAssignments;
    activeTakeAssignments = normalizedAssignments.value;
    if (input.target !== undefined || targetRefs.length > 0 || input.limit !== undefined || input.properties !== undefined || anchor.value !== null || gap.value !== null) {
      return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take accepts only active_take_assignments and dry_run; selection, target_refs, limit, properties, anchor_seconds, and gap_seconds are forbidden.");
    }
  } else if (mode === "stack_on_existing_tracks") {
    const normalizedAssignments = normalizeTrackAssignments(input.track_assignments);
    if (!normalizedAssignments.ok) return normalizedAssignments;
    trackAssignments = normalizedAssignments.value;
    const unsupported = Object.keys(input).filter((field) => !["mode", "track_assignments", "dry_run"].includes(field));
    if (unsupported.length > 0) {
      return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `stack_on_existing_tracks accepts only track_assignments and dry_run; unsupported field(s): ${unsupported.join(", ")}.`);
    }
  } else if (mode === "apply_fades") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "apply_fades accepts targets, fade_in_seconds, fade_out_seconds, limit, and dry_run only.");
    const fadeIn = optionalNullableNonNegativeNumber(input.fade_in_seconds, "fade_in_seconds");
    const fadeOut = optionalNullableNonNegativeNumber(input.fade_out_seconds, "fade_out_seconds");
    if (!fadeIn.ok) return fadeIn;
    if (!fadeOut.ok) return fadeOut;
    if (input.fade_in_seconds === undefined && input.fade_out_seconds === undefined) return failed("ITEM_APPLY_FADES_REQUIRED", "apply_fades requires fade_in_seconds and/or fade_out_seconds; omitted sides clear to zero only when the other side is supplied.");
    fadeInSeconds = fadeIn.value;
    fadeOutSeconds = fadeOut.value;
  } else if (mode === "trim_exact") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "trim_exact accepts targets, length_seconds, limit, and dry_run only.");
    if (!Number.isFinite(input.length_seconds) || input.length_seconds <= 0) return failed("ITEM_APPLY_LENGTH_INVALID", "trim_exact length_seconds must be a finite number greater than zero.");
    lengthSeconds = input.length_seconds;
  } else if (mode === "set_take_playback") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_take_playback accepts targets, playrate, preserve_pitch, limit, and dry_run only.");
    if (!Number.isFinite(input.playrate) || input.playrate <= 0 || input.playrate > 16) return failed("ITEM_APPLY_PLAYRATE_INVALID", "set_take_playback playrate must be a finite number greater than zero and at most 16.");
    if (typeof input.preserve_pitch !== "boolean") return failed("ITEM_APPLY_PRESERVE_PITCH_REQUIRED", "set_take_playback requires explicit boolean preserve_pitch.");
    playrate = input.playrate;
    preservePitch = input.preserve_pitch;
  } else if (mode === "set_snap_offset") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_snap_offset accepts targets, snap_offset_seconds, limit, and dry_run only.");
    if (!Number.isFinite(input.snap_offset_seconds) || input.snap_offset_seconds < 0) return failed("ITEM_APPLY_SNAP_OFFSET_INVALID", "set_snap_offset snap_offset_seconds must be a non-negative finite number.");
    snapOffsetSeconds = input.snap_offset_seconds;
  } else {
    if (input.properties !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", `${mode} does not accept properties.`);
    if (input.active_take_assignments !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", `${mode} does not accept active_take_assignments.`);
    if (mode === "move_to_anchor" && anchor.value === null) return failed("ITEM_APPLY_ANCHOR_REQUIRED", "move_to_anchor requires anchor_seconds.");
    if (mode !== "sequence_with_gap" && gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", `gap_seconds is valid only for sequence_with_gap.`);
  }
  return {
    ok: true,
    input: {
      mode,
      target,
      target_refs: [...targetRefs],
      limit,
      dry_run: dryRun,
      anchor_seconds: anchor.value,
      gap_seconds: mode === "sequence_with_gap" ? gap.value ?? 0 : null,
      properties,
      active_take_assignments: activeTakeAssignments,
      track_assignments: trackAssignments,
      fade_in_seconds: fadeInSeconds,
      fade_out_seconds: fadeOutSeconds,
      length_seconds: lengthSeconds,
      playrate,
      preserve_pitch: preservePitch,
      snap_offset_seconds: snapOffsetSeconds,
    },
  };
}

function normalizeActiveTakeAssignments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments must contain 1-${MAX_TARGETS} rows.`);
  }
  const assignments = [];
  const seenItems = new Set();
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] must be an object.`);
    const unknown = Object.keys(row).filter((field) => !["item_ref", "take_ref"].includes(field));
    if (unknown.length > 0) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
    if (!isExactGuidRef(row.item_ref, "item") || !isExactGuidRef(row.take_ref, "take")) {
      return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] requires exact canonical item:guid and take:guid refs.`);
    }
    if (seenItems.has(row.item_ref)) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments repeats ${row.item_ref}; each Item may receive exactly one requested Active Take.`);
    seenItems.add(row.item_ref);
    assignments.push({ item_ref: row.item_ref, take_ref: row.take_ref });
  }
  return { ok: true, value: assignments };
}

function normalizeTrackAssignments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments must contain 1-${MAX_TARGETS} rows.`);
  }
  const assignments = [];
  const seenItems = new Set();
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] must be an object.`);
    const unknown = Object.keys(row).filter((field) => !["item_ref", "target_track_ref"].includes(field));
    if (unknown.length > 0) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
    if (!isExactGuidRef(row.item_ref, "item") || !isExactGuidRef(row.target_track_ref, "track")) {
      return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] requires exact canonical item:guid and track:guid refs.`);
    }
    if (seenItems.has(row.item_ref)) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments repeats ${row.item_ref}; each Item may receive exactly one destination Track.`);
    seenItems.add(row.item_ref);
    assignments.push({ item_ref: row.item_ref, target_track_ref: row.target_track_ref });
  }
  return { ok: true, value: assignments };
}

function normalizeProperties(value) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return failed("ITEM_APPLY_PROPERTIES_REQUIRED", "set_properties requires at least one property field.");
  if (Object.hasOwn(value, "pan")) {
    return failed(
      "ITEM_APPLY_ITEM_PAN_UNSUPPORTED",
      "pan is not a proven Item-level REAPER field. Confirm the current Active Take and use macro.controls.set target_kind=take or reviewed template.items.set_take_pan for an explicit Active Take pan request; multi-Take Items are never redirected silently.",
    );
  }
  const unknown = Object.keys(value).filter((field) => !ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS.includes(field));
  if (unknown.length > 0) return failed("ITEM_APPLY_PROPERTY_HELD", `Unsupported or held property field(s): ${unknown.join(", ")}.`);
  const normalized = {};
  for (const field of ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const definition = PROPERTY_DEFINITIONS[field];
    const fieldValue = value[field];
    if (definition.type === "boolean" && typeof fieldValue !== "boolean") return failed("ITEM_APPLY_PROPERTY_INVALID", `${field} must be boolean.`);
    if (definition.type === "number" && (!Number.isFinite(fieldValue) || fieldValue < definition.min || fieldValue > definition.max)) {
      return failed("ITEM_APPLY_PROPERTY_INVALID", `${field} must be a finite number from ${definition.min} to ${definition.max}.`);
    }
    normalized[field] = fieldValue;
  }
  return { ok: true, value: normalized };
}

function optionalNonNegativeNumber(value, field) {
  if (value === undefined) return { ok: true, value: null };
  if (!Number.isFinite(value) || value < 0) return failed("ITEM_APPLY_REQUEST_INVALID", `${field} must be a non-negative finite number.`);
  return { ok: true, value };
}

function optionalNullableNonNegativeNumber(value, field) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Number.isFinite(value) || value < 0) return failed("ITEM_APPLY_REQUEST_INVALID", `${field} must be null or a non-negative finite number.`);
  return { ok: true, value };
}

function responseBudgetBlocker({ entry, request, input, stages, state, activeBudget }) {
  const projected = state.operations.map(previewChange);
  const projectedState = { ...state, changes: projected };
  const envelope = buildSuccessEnvelope({
    entry,
    request,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    stages: [
      ...stages,
      { id: "items-apply-mutate", kind: "template_execute", status: "completed", summary: "Projected fixed mutation rows.", evidence_refs: [] },
      { id: "items-apply-verify", kind: "verify", status: "completed", summary: "Projected exact live readback rows.", evidence_refs: [] },
      { id: "items-apply-index", kind: "index_update", status: "completed", summary: "Projected affected-scope invalidation.", evidence_refs: [] },
      { id: "items-apply-result", kind: "result_project", status: "completed", summary: "Projected compact result.", evidence_refs: [] },
    ],
    state: projectedState,
    activeBudget: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
    status: input.dry_run ? "dry_run_completed" : "completed",
    summary: `Projected ${projected.length} Item operation row(s).`,
    data: resultData(input, projectedState),
  });
  const required = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (required <= activeBudget) return null;
  return {
    code: "ITEM_APPLY_RESPONSE_BUDGET_EXCEEDED",
    message: `The compact ${state.operations.length}-row result needs about ${required} bytes but only ${activeBudget} response bytes are available; split the target/property set or raise the public response budget before mutation.`,
    recoverable: true,
    required_bytes: required,
  };
}

function maintainProjectIndex(runtime, state, now) {
  const completed = state.changes.filter((change) => change.mutation.status === "completed");
  const scopes = affectedScopes(state);
  if (completed.length === 0) return { ok: true, status: "skipped", message: "No completed mutation required index maintenance.", scopes: [] };
  if (!runtime || typeof runtime.invalidateScopes !== "function") return { ok: true, status: "skipped", message: "Project Index runtime was not attached; live readback remains the result authority.", scopes };
  try {
    const result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    if (result?.ok === false) {
      const first = result.blockers?.[0] ?? blocker("ITEM_APPLY_INDEX_MAINTENANCE_FAILED", "Project Index invalidation failed.");
      return { ok: false, status: "failed", code: first.code ?? "ITEM_APPLY_INDEX_MAINTENANCE_FAILED", message: first.message ?? "Project Index invalidation failed.", blockers: [first], scopes };
    }
    return { ok: true, status: "completed", message: `Invalidated the affected ${scopes.join("/")} scope(s) after live mutation/readback.`, scopes };
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    return { ok: false, status: "failed", code: "ITEM_APPLY_INDEX_MAINTENANCE_FAILED", message: error?.message ?? "Project Index invalidation failed.", blockers: [blocker("ITEM_APPLY_INDEX_MAINTENANCE_FAILED", error?.message ?? "Project Index invalidation failed.")], scopes };
  }
}

function affectedScopes(state) {
  if (state.operations.some((operation) => operation.kind === "move_item_to_track")) return ["items", "tracks", "takes"];
  return state.operations.some((operation) => ["set_active_take", "set_take_playback"].includes(operation.kind)) ? ["items", "takes"] : ["items"];
}

function applyIndexMaintenance(changes, indexResult) {
  for (const change of changes) {
    if (change.mutation.status !== "completed") continue;
    change.index_maintenance = {
      status: indexResult.status,
      scopes: indexResult.scopes ?? [],
      ...(indexResult.code ? { blocker_code: indexResult.code } : {}),
    };
  }
}

function successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status, summary, data }) {
  return finalizeEnvelope(buildSuccessEnvelope({
    entry,
    request,
    startedAt,
    completedAt: safeNowIso(now),
    stages,
    state,
    activeBudget,
    status,
    summary,
    data,
  }));
}

function buildSuccessEnvelope({ entry, request, startedAt, completedAt, stages, state, activeBudget, status, summary, data }) {
  return {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: macroIdentity(entry),
    request: requestSummary(request),
    execution: { status, started_at: startedAt, completed_at: completedAt, stage_count: stages.length, stages },
    sqlite: state.sqlite ?? sqliteEvidence(),
    result: {
      summary,
      canonical_refs: uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: { status: "passed", evidence_refs: uniqueStrings(state.evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) },
      data,
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "blocked", code, message, blockers = [], data = {} }) {
  const verified = state.changes.length > 0
    && state.changes.filter((change) => change.mutation.status === "completed").every((change) => change.live_readback.status === "passed");
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: requestSummary(request, { forceNonDry: true }),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: state.sqlite ?? sqliteEvidence(),
    result: {
      summary: message,
      canonical_refs: uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: { status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : [] },
      data,
    },
    blockers: (blockers.length > 0 ? blockers : [blocker(code, message)]).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count),
    error: { code, message, recoverable: true },
    recovery: {
      undo_policy: REGISTRY_ENTRY.undo_policy,
      partial_changes_possible: status === "partial_failure",
      source_media_deleted: false,
      action: status === "partial_failure" ? "Inspect row truth and use the reported per-stage REAPER undo entries before retrying only the remaining task." : "Fix the typed preflight blocker and retry the bounded request.",
    },
    budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  });
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.3-B1c items.apply envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function resultData(input, state) {
  const completed = state.changes.filter((change) => change.mutation.status === "completed");
  const passed = completed.filter((change) => change.live_readback.status === "passed");
  const indexStatuses = uniqueStrings(completed.map((change) => change.index_maintenance.status));
  return {
    mode: input.mode,
    supported_modes: ALPHA3_3_B1C_ITEMS_APPLY_MODES,
    held_modes: ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES,
    supported_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS,
    held_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS,
    target_scope: state.targetScope,
    total_target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    targets_truncated: state.targetsTruncated,
    undo_policy: REGISTRY_ENTRY.undo_policy,
    source_media_deleted: false,
    outcome: {
      mutation: { status: completed.length > 0 ? "completed" : input.dry_run ? "not_run" : "not_completed", completed_count: completed.length, total_count: state.operations.length },
      live_readback: { status: completed.length > 0 && passed.length === completed.length ? "passed" : passed.length > 0 ? "partial" : input.dry_run ? "not_run" : "not_passed", passed_count: passed.length, total_count: completed.length },
      index_maintenance: { status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run", scopes: indexStatuses.length > 0 ? uniqueStrings(completed.flatMap((change) => change.index_maintenance.scopes)) : [] },
    },
  };
}

function targetData(state) {
  return {
    target_scope: state.targetScope,
    total_target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    targets_truncated: state.targetsTruncated,
    mutation: { occurred: false, changes: 0 },
  };
}

function createState() {
  return {
    targetScope: "unresolved",
    totalTargetCount: 0,
    returnedTargetCount: 0,
    targetsTruncated: false,
    operations: [],
    changes: [],
    canonicalRefs: [],
    evidenceRefs: [],
    sqlite: null,
  };
}

function pendingChange(operation) {
  return compactObject({
    operation_id: operation.operation_id,
    template_id: operation.template_id,
    target_ref: operation.item_ref.ref,
    related_ref: operation.take_ref?.ref ?? operation.target_track_ref?.ref,
    field: operation.field,
    before_value: operation.before_value,
    requested_value: operation.requested_value,
    status: "pending",
    mutation: { status: "pending" },
    live_readback: { status: "pending" },
    index_maintenance: { status: "pending", scopes: [] },
  });
}

function previewChange(operation) {
  return compactObject({
    operation_id: operation.operation_id,
    template_id: operation.template_id,
    target_ref: operation.item_ref.ref,
    related_ref: operation.take_ref?.ref ?? operation.target_track_ref?.ref,
    field: operation.field,
    before_value: operation.before_value,
    requested_value: operation.requested_value,
    status: "planned",
    mutation: { status: "not_run" },
    live_readback: { status: "not_run" },
    index_maintenance: { status: "skipped", scopes: [] },
  });
}

function failedReadback(operation, observed, observedItemRef) {
  return {
    ...failed("ITEM_APPLY_READBACK_MISMATCH", `Live readback for ${operation.operation_id} did not match the exact target/value requested.`, [blocker("ITEM_APPLY_READBACK_MISMATCH", `${operation.item_ref.ref} ${operation.field}: requested=${String(operation.requested_value)} observed=${String(observed)} observed_item_ref=${String(observedItemRef)}.`)]),
    phase: "readback",
  };
}

function executionError(error, templateId, phase) {
  const message = error?.message ?? `${templateId} threw during execution.`;
  return { ...failed("ITEM_APPLY_ATOMIC_FAILED", message, [blocker("ITEM_APPLY_ATOMIC_FAILED", message)]), phase };
}

function atomicFailure(execution, templateId) {
  const code = execution?.error?.code ?? "ITEM_APPLY_ATOMIC_FAILED";
  const message = execution?.error?.message ?? `${templateId} failed.`;
  return failed(code, message, [blocker(code, message, execution?.error?.recoverable !== false)]);
}

function collectExecutionEvidence(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([
    execution?.request?.id,
    execution?.template?.id,
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts.map((entry) => entry?.ref) : []),
  ]));
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainObject(value)) {
      if (typeof value.kind === "string" && typeof value.ref === "string" && isPlainObject(value.identity)) refs.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  return refs;
}

function collectItemObjectRefs(value) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (isPlainObject(entry)) {
      if (entry.kind === "item" && typeof entry.ref === "string" && isPlainObject(entry.identity)) refs.push(entry);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  return uniqueObjectRefs(refs);
}

function isExactItemToken(value) {
  return typeof value === "string" && (/^item:guid:.+/u.test(value) || /^guid:.+/u.test(value));
}

function isExactGuidRef(value, kind) {
  return typeof value === "string" && new RegExp(`^${kind}:guid:\\{[^{}]+\\}$`, "u").test(value);
}

function exactGuidObjectRef(kind, ref) {
  return { kind, ref, identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) } };
}

function canonicalTokenRef(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("item:guid:")) return value;
  if (value.startsWith("guid:")) return `item:${value}`;
  return null;
}

function uniqueObjectRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (seen.has(ref.ref)) return false;
    seen.add(ref.ref);
    return true;
  });
}

function runAtomic(executeAtomic, request, child) {
  return executeAtomic({
    ...child,
    context: request.context,
    budget: CHILD_BUDGET,
    observeProjectIndex: false,
  });
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const row = { id, kind, status, summary, evidence_refs: uniqueStrings(evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) };
  const index = stages.findIndex((stage) => stage.id === id);
  if (index >= 0) stages[index] = row;
  else stages.push(row);
}

function requestSummary(request, { forceNonDry = false } = {}) {
  return {
    request_id: typeof request?.context?.request_id === "string"
      ? request.context.request_id
      : `${ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID}:${request?.context?.created_at ?? "request"}`,
    dry_run: forceNonDry ? false : request?.input?.dry_run !== false,
  };
}

function responseBudget(request) {
  const requested = request?.budget?.max_response_bytes ?? request?.response_budget ?? MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  if (!Number.isInteger(requested) || requested < MIN_RESPONSE_BUDGET || requested > MACRO_CONTRACT_CEILINGS.envelope_max_bytes) {
    return MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  }
  return requested;
}

function macroIdentity(entry) {
  return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk };
}

function sqliteEvidence(runtime, { used = false, freshness = "not_applicable" } = {}) {
  if (!used) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  let status = {};
  try {
    status = runtime?.status?.() ?? {};
  } catch {
    status = {};
  }
  return {
    used: true,
    source: "warm_index",
    freshness,
    snapshot_ref: typeof status.snapshot_id === "string" ? status.snapshot_id : null,
    revision: status.revision === null || status.revision === undefined ? null : String(status.revision),
    refreshed: false,
  };
}

function valuesMatch(actual, expected) {
  if (typeof expected === "number") return Number.isFinite(actual) && Math.abs(actual - expected) <= POSITION_TOLERANCE;
  return actual === expected;
}

function blocker(code, message, recoverable = true) {
  return { code, message, recoverable };
}

function failed(code, message, blockers = [blocker(code, message)]) {
  return { ok: false, code, message, blockers };
}

function executionSummary(execution) {
  return {
    ...plainObject(execution?.result?.summary),
    ...plainObject(execution?.result?.readback),
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Use a valid fallback below.
  }
  return new Date().toISOString();
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}
