import { createHash } from "node:crypto";
import { createObjectRef } from "../../core/src/foundation-bridge-v1.mjs";
import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID = "macro.automation.apply";
export const ALPHA3_3_B1D_AUTOMATION_APPLY_CONTRACT = "alpha3.3.b1d.automation_apply.v1";
export const ALPHA3_3_B1D_AUTOMATION_APPLY_MODES = deepFreeze([
  "insert_points",
  "update_point",
  "set_track_mode",
  "create_automation_item",
  "set_automation_item_bounds",
  "delete_point",
  "delete_point_range",
  "delete_automation_item",
  "insert_fx_parameter_points",
]);
export const ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES = deepFreeze([
  "create_envelope",
  "set_send_mode",
  "draw_sine",
]);
export const ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS = deepFreeze([
  "template.tracks.resolve_track_ref",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.set_envelope_point",
  "template.automation.insert_envelope_points_batch",
  "template.automation.delete_envelope_points",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
  "template.automation.delete_automation_item",
  "template.fx.parameter_to_envelope_mapping",
  "template.automation.ensure_fx_parameter_envelope",
]);

const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const READ_ENVELOPE_ID = "template.automation.read_envelope_summary";
const READ_POINTS_ID = "template.automation.read_envelope_points";
const SET_POINT_ID = "template.automation.set_envelope_point";
const INSERT_POINTS_ID = "template.automation.insert_envelope_points_batch";
const DELETE_POINTS_ID = "template.automation.delete_envelope_points";
const SET_TRACK_MODE_ID = "template.automation.set_track_automation_mode";
const READ_TRACK_MODE_ID = "template.automation.read_track_automation_mode";
const READ_AUTOMATION_ITEMS_ID = "template.automation.read_automation_items";
const CREATE_AUTOMATION_ITEM_ID = "template.automation.create_automation_item";
const SET_AUTOMATION_ITEM_BOUNDS_ID = "template.automation.set_automation_item_bounds";
const DELETE_AUTOMATION_ITEM_ID = "template.automation.delete_automation_item";
const MAP_FX_PARAMETER_ENVELOPE_ID = "template.fx.parameter_to_envelope_mapping";
const ENSURE_FX_PARAMETER_ENVELOPE_ID = "template.automation.ensure_fx_parameter_envelope";
const MAX_TARGETS = 8;
const MAX_NEW_POINTS = 64;
const MAX_COMPLETE_READ_POINTS = 64;
const MAX_AUTOMATION_ITEMS = 64;
const EPSILON = 0.000001;
const MIN_RESPONSE_BUDGET = 2_048;
const DESTRUCTIVE_MODES = new Set(["delete_point", "delete_point_range", "delete_automation_item"]);
const NON_IDEMPOTENT_MODES = new Set(["insert_points", "insert_fx_parameter_points", "create_automation_item", ...DESTRUCTIVE_MODES]);
const MODE_ALIASES = new Map([
  ["insert_take_points", "insert_points"],
  ["insert_take_fx_parameter_points", "insert_fx_parameter_points"],
]);
const INPUT_FIELDS = new Set([
  "mode",
  "envelope_refs",
  "track_refs",
  "fx_refs",
  "points",
  "point_update",
  "point_delete",
  "point_range",
  "track_mode",
  "automation_item",
  "automation_item_bounds",
  "automation_item_delete",
  "fx_parameter",
  "dry_run",
  "confirmation_token",
]);
const CHILD_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: 128,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID,
  program_id: "openreaper.macro.automation.apply",
  program_version: "1.2.0",
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES },
      envelope_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      track_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      fx_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      points: { type: "array", maxItems: MAX_NEW_POINTS },
      point_update: { type: "object" },
      point_delete: { type: "object" },
      point_range: { type: "object" },
      track_mode: { type: "string", enum: ["trim_read", "read"] },
      automation_item: { type: "object" },
      automation_item_bounds: { type: "object" },
      automation_item_delete: { type: "object" },
      fx_parameter: { type: "object" },
      dry_run: { type: "boolean" },
      confirmation_token: { type: "string" },
    },
    required: ["mode"],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: false,
    live_reresolve_before_write: true,
  },
  sqlite_policy: {
    mode: "invalidate_after_write",
    write_authority: false,
    identity_fields: ["envelope_ref", "track_ref", "fx_ref"],
  },
  dependencies: { template_ids: ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS, runtime_capabilities: [] },
  stages: [
    { id: "automation-apply-targets", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "automation-apply-preflight", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: READ_ENVELOPE_ID },
    { id: "automation-apply-mutate", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: INSERT_POINTS_ID },
    { id: "automation-apply-verify", kind: "verify", risk: "read", stop_on_error: true },
    { id: "automation-apply-index", kind: "index_update", risk: "write", stop_on_error: true },
    { id: "automation-apply-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3B1dAutomationApplyRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY = createAlpha3_3B1dAutomationApplyRegistry();

export function isAlpha3_3B1dAutomationApplyMacroId(id) {
  return id === ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID;
}

export function createAlpha3_3B1dAutomationApplyDiscoveryItems({ liveRunnableNow = false } = {}) {
  return deepFreeze([{
    id: ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID,
    title: "Apply bounded Automation changes",
    user_label: "Apply Automation",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.automation.apply",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "automation_apply",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable",
    support_state: "supported_with_exact_live_readback",
    live_runnable_now: liveRunnableNow,
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    summary: "Apply bounded Track/Take/FX Envelope points, Track modes, and Automation Item create/update/delete with exact live readback.",
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES,
    held_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES,
    limits: { envelope_targets: MAX_TARGETS, track_targets: MAX_TARGETS, fx_targets: MAX_TARGETS, total_inserted_points: MAX_NEW_POINTS },
    examples: [
      { name: "preview_volume_ramp", input: { mode: "insert_points", envelope_refs: ["envelope:guid:{ENVELOPE-GUID}"], points: [{ time_seconds: 0, value: 0.25 }, { time_seconds: 2, value: 1 }], dry_run: true } },
      { name: "preview_point_delete", input: { mode: "delete_point", envelope_refs: ["envelope:guid:{ENVELOPE-GUID}"], point_delete: { autoitem_index: -1, point_index: 2 } } },
      { name: "write_take_fx_parameter", input: { mode: "insert_fx_parameter_points", fx_refs: ["fx:take:guid:{TAKE-GUID}:0"], fx_parameter: { param_index: 0, create_if_missing: true }, points: [{ time_seconds: 1, value: 0.5 }], dry_run: false } },
      { name: "set_track_read", input: { mode: "set_track_mode", track_refs: ["track:guid:{TRACK}"], track_mode: "read", dry_run: false } },
    ],
  }]);
}

export function createAlpha3_3B1dAutomationApplyExactManual() {
  return deepFreeze({
    id: ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID,
    rollout_slice: "Alpha3.3-B1d",
    action_manual: {
      when_to_use: [
        "Use insert_points or update_point for raw-value points on an existing exact Track or ordinary Take Envelope when its complete lane remains within 64 points; all time_seconds are project-absolute and Take conversion is native/read back.",
        "Use set_track_mode for trim_read or read; create_automation_item for a new empty Automation Item; or set_automation_item_bounds for existing Item position, length, start offset, or playrate.",
        "Use delete_point, delete_point_range, or delete_automation_item only through dry-run preview followed by the exact returned confirmation_token retry; Automation Item deletion uses fixed Action 42086 with Master/Track/Take/FX selection restoration.",
        "Use insert_fx_parameter_points for exact Track-FX or Take-FX refs; missing parameter Envelopes are created only by the audited false-first native ensure route, then points are written through the generic GUID Envelope atom.",
      ],
      when_not_to_use: [
        "Do not use this slice to create missing ordinary Track or Take Volume/Pan/Mute/Pitch Envelopes, create send Envelopes, operate Take Automation Items, run real-time touch/write/latch, or supply model-authored steps.",
        "Do not use this Macro to toggle active, armed, visible, or separate-lane state on an existing Envelope. Newly created FX-parameter and Take-Pitch Envelopes use REAPER's native visible state; reopening a previously hidden lane is not promised without SWS.",
        "Do not guess semantic dB/pan/plugin values: insert_points accepts already-known raw REAPER Envelope values inside the exact live min/max range; FX parameter points are normalized 0..1.",
      ],
      required_readiness: [
        "Prefer canonical envelope:guid:{GUID} refs from live inventory. Older exact track/send or fingerprint refs are hidden compatibility inputs only and are never taught as the default.",
        "Provide at most eight exact Envelope, Track GUID, or Track/Take-FX refs; ambiguous discovery is not accepted here.",
        "The Macro resolves and reads every exact target from REAPER live. SQLite may be absent or stale and is never write authority.",
      ],
      input_shape: {
        mode: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES.join(" | "),
        envelope_refs: "Existing exact Envelope refs; canonical envelope:guid:{GUID} is preferred.",
        track_refs: "Exact track:guid refs for set_track_mode.",
        fx_refs: "Exact fx:track:guid:{TRACK}:slot or fx:take:guid:{TAKE}:slot refs for insert_fx_parameter_points.",
        points: "For insert_points: 1-64 raw points; total points across all target Envelopes must be <=64.",
        point_update: "For update_point: autoitem_index (default -1), exact point_index, and at least one updated point field.",
        point_delete: "For delete_point: autoitem_index (default -1) and exact point_index.",
        point_range: "For delete_point_range: autoitem_index (default -1), start_seconds, end_seconds; deletion is half-open [start,end).",
        track_mode: "trim_read | read. Real-time touch/write/latch modes are held.",
        automation_item: "For create_automation_item: position_seconds>=0, length_seconds>0, pool_mode=new_empty.",
        automation_item_bounds: "For set_automation_item_bounds: exact automation_item_index plus one or more of position_seconds, length_seconds, start_offset_seconds, or playrate; every requested field is independently read back.",
        automation_item_delete: "For delete_automation_item: exact automation_item_index from a complete live Automation Item page.",
        fx_parameter: "For insert_fx_parameter_points: param_index, optional exact param_ident, and create_if_missing (defaults true).",
        dry_run: "Defaults to true.",
        confirmation_token: "Destructive retry string returned by the immediately preceding dry-run preview. Boolean confirmation is insufficient.",
      },
      preflight_steps: [
        "Reject held modes, non-exact targets, oversized point work, live value-range violations, incomplete point/Automation Item readback, stale/missing destructive tokens, and response-budget overflow before mutation.",
        "Resolve exact refs live and capture complete pre-mutation facts without consulting SQLite identity.",
      ],
      underlying_actions: ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS,
      readback_steps: [
        "insert_points/update_point/delete_point/delete_point_range compare complete pre/post point tuples and counts; half-open range readback proves [start,end) absence while preserving end_seconds points.",
        "set_track_mode calls the native read Template, and Automation Item modes independently read complete exact live Item rows.",
        "FX parameter mode independently re-runs the read-only FX mapping, requires a GUID Envelope, and reads the complete point lane after native ensure and generic insertion.",
        "Each changes[] row reports mutation, exact live readback, and Automation index maintenance separately; applied requires that row's readback to pass.",
      ],
      success_criteria: [
        "Every applied row has the same exact target ref and requested fields in independent live readback.",
        "Mutation success cannot compensate for missing, truncated, or mismatched readback.",
        "No source media, hardware/device routing, raw Action, Lua, shell, or project chunk is exposed.",
      ],
      common_blockers: [
        blocker("AUTOMATION_CONFIRMATION_TOKEN_REQUIRED", "Point/range deletion requires the exact deterministic token from a current dry-run preview."),
        blocker("AUTOMATION_CONFIRMATION_TOKEN_STALE", "The supplied token no longer matches current exact target/point/range state."),
        blocker("TRACK_ENVELOPE_CREATE_UNAVAILABLE", "Missing ordinary Track/Take/send Envelopes have no accepted native create route; only Track/Take-FX parameter Envelope ensure is supported."),
        blocker("AUTOMATION_FX_ENVELOPE_MISSING", "The exact FX parameter has no Envelope and create_if_missing was disabled."),
        blocker("TAKE_ENVELOPE_TIME_OUT_OF_BOUNDS", "Take Envelope project time must fall inside the parent Item; conversion uses Item position and Take playrate."),
        blocker("AUTOMATION_COMPLETE_READBACK_REQUIRED", "This Macro requires one complete <=64-point lane for independent tuple/count verification."),
      ],
      recovery_steps: [
        "Use exact refs from a live read, reduce targets/points to the reported bound, or split the request before retrying.",
        "For missing ordinary Track/Take/send Envelopes, Take Automation Items, or broader curve generation, stop at the typed blocker; do not use raw Actions or chunk edits.",
        "If index maintenance alone fails, keep the verified REAPER change truth and refresh only the Automation/Track index scopes.",
      ],
      dry_run_shape: {
        supported: true,
        behavior: "Performs exact live resolution/read preflight and returns fixed per-target previews without mutation or index invalidation.",
        output: ["target_ref", "operation", "requested_summary", "preflight_facts", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "exact live target resolution",
        retry: "Retry once after fixing the typed readiness, completeness, value-domain, or budget blocker.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
    },
  });
}

export async function executeAlpha3_3B1dAutomationApplyMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY.get(ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const activeBudget = responseBudget(request);
  const normalized = normalizeInput(request.input);
  if (!normalized.ok) return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  if (NON_IDEMPOTENT_MODES.has(normalized.input.mode) && request.idempotency_key !== undefined) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      code: "AUTOMATION_IDEMPOTENCY_UNSUPPORTED",
      message: `${normalized.input.mode} is non-idempotent and has no accepted Macro-level replay ledger; remove idempotency_key and issue one deliberate live request.`,
    });
  }

  const validation = validateMacroProgramRequest({
    macro_id: ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID,
    input: normalized.input,
    refs: request.refs ?? {},
    dry_run: normalized.input.dry_run,
  }, { registry: ALPHA3_3_B1D_AUTOMATION_APPLY_REGISTRY });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "AUTOMATION_REQUEST_INVALID", message, blockers: validation.errors.map((error) => blocker("AUTOMATION_REQUEST_INVALID", error)) });
  }
  if (typeof executeAtomic !== "function") return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "AUTOMATION_LIVE_EXECUTOR_REQUIRED", message: "macro.automation.apply requires the managed OpenReaper live executor." });

  const prepared = normalized.input.mode === "set_track_mode"
    ? await prepareTrackOperations({ request, input: normalized.input, executeAtomic, state })
    : normalized.input.mode === "insert_fx_parameter_points"
      ? await prepareFxOperations({ request, input: normalized.input, executeAtomic, state })
      : await prepareEnvelopeOperations({ request, input: normalized.input, executeAtomic, state });
  if (!prepared.ok) {
    pushStage(stages, "automation-apply-targets", "live_ref_resolve", "blocked", prepared.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: prepared.code, message: prepared.message, blockers: prepared.blockers, data: targetData(state) });
  }
  state.operations = prepared.operations;
  if (DESTRUCTIVE_MODES.has(normalized.input.mode)) {
    state.confirmation = buildDestructiveConfirmation(normalized.input, state.operations);
  }
  pushStage(stages, "automation-apply-targets", "live_ref_resolve", "completed", `Resolved ${state.operations.length} exact live target(s).`, state.evidenceRefs);
  pushStage(stages, "automation-apply-preflight", "template_execute", "completed", "Captured complete mode-specific live facts for every target.", state.evidenceRefs);

  const budgetFailure = responseBudgetBlocker({ entry, request, input: normalized.input, stages, state, activeBudget });
  if (budgetFailure) return failureEnvelope({ entry, request, startedAt, now, stages: [], state: createState(), activeBudget, code: budgetFailure.code, message: budgetFailure.message, blockers: [budgetFailure], data: { required_bytes: budgetFailure.required_bytes, available_bytes: activeBudget } });

  if (DESTRUCTIVE_MODES.has(normalized.input.mode) && !normalized.input.dry_run) {
    if (typeof normalized.input.confirmation_token !== "string" || normalized.input.confirmation_token.length === 0) {
      return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "AUTOMATION_CONFIRMATION_TOKEN_REQUIRED", message: "Destructive Automation execution requires the exact confirmation_token returned by a current dry-run preview." });
    }
    if (normalized.input.confirmation_token !== state.confirmation.token) {
      return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "AUTOMATION_CONFIRMATION_TOKEN_STALE", message: "The destructive confirmation_token does not match the current exact target, point/range, or live precondition state. Run dry_run again." });
    }
  }

  if (normalized.input.dry_run) {
    state.changes = state.operations.map(previewChange);
    pushStage(stages, "automation-apply-mutate", "template_execute", "skipped", "dry_run=true; no Automation mutation was dispatched.", []);
    pushStage(stages, "automation-apply-verify", "verify", "completed", "Validated every fixed preview against exact live preflight facts.", state.evidenceRefs);
    pushStage(stages, "automation-apply-index", "index_update", "skipped", "Dry run did not stale Project Index scopes.", []);
    pushStage(stages, "automation-apply-result", "result_project", "completed", "Projected bounded Automation previews.", state.evidenceRefs);
    return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "dry_run_completed", summary: `Previewed ${state.operations.length} Automation operation(s) with no mutation.`, data: resultData(normalized.input, state) });
  }

  const executionFailure = await executeOperations({ request, executeAtomic, state });
  pushStage(stages, "automation-apply-mutate", "template_execute", executionFailure?.phase === "mutation" ? "failed" : "completed", `${state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation.status)).length} mutation row(s) completed or may have partially changed live state.`, state.evidenceRefs);
  pushStage(stages, "automation-apply-verify", "verify", executionFailure?.phase === "readback" ? "failed" : executionFailure?.phase === "mutation" ? "skipped" : "completed", `${state.changes.filter((change) => change.live_readback.status === "passed").length} row(s) passed exact live readback.`, state.evidenceRefs);

  const indexResult = maintainProjectIndex(projectIndexRuntime, normalized.input.mode, state, now);
  applyIndexMaintenance(state.changes, indexResult);
  pushStage(stages, "automation-apply-index", "index_update", indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);

  if (executionFailure) return failureEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: state.changes.some((change) => ["completed", "unknown_or_partial"].includes(change.mutation.status)) ? "partial_failure" : "failed",
    code: executionFailure.code, message: executionFailure.message, blockers: executionFailure.blockers,
    data: resultData(normalized.input, state),
  });
  if (indexResult.ok === false) return failureEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget, status: "partial_failure",
    code: indexResult.code, message: indexResult.message, blockers: indexResult.blockers,
    data: resultData(normalized.input, state),
  });

  pushStage(stages, "automation-apply-result", "result_project", "completed", "Projected mutation, exact live readback, and index-maintenance truth separately.", state.evidenceRefs);
  return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "completed", summary: `Applied and verified ${state.changes.length} Automation change row(s).`, data: resultData(normalized.input, state) });
}

async function prepareEnvelopeOperations({ request, input, executeAtomic, state }) {
  const direct = collectObjectRefs(request.refs, "envelope");
  const candidates = [...direct.map((ref) => ref.ref), ...input.envelope_refs];
  if (candidates.length < 1) return failed("AUTOMATION_EXACT_ENVELOPE_REQUIRED", `${input.mode} requires at least one exact existing Envelope ref.`);
  if (candidates.length > MAX_TARGETS) return failed("AUTOMATION_TARGET_LIMIT_EXCEEDED", `Envelope targets exceed ${MAX_TARGETS}.`);
  if (new Set(candidates).size !== candidates.length) return failed("AUTOMATION_TARGETS_DUPLICATED", "Envelope targets must resolve once each.");
  if (input.mode === "insert_points" && candidates.length * input.points.length > MAX_NEW_POINTS) return failed("AUTOMATION_POINT_LIMIT_EXCEEDED", `Total inserted point work exceeds ${MAX_NEW_POINTS} across all target Envelopes.`);
  const operations = [];
  for (const [index, token] of candidates.entries()) {
    if (!isExactEnvelopeRef(token)) return failed("AUTOMATION_EXACT_ENVELOPE_REQUIRED", `Envelope target ${token} is not a canonical GUID or accepted hidden exact compatibility ref.`);
    let liveRef;
    try {
      liveRef = envelopeObjectRef(token);
    } catch (error) {
      return failed("AUTOMATION_EXACT_ENVELOPE_REQUIRED", error?.message ?? `Envelope target ${token} is inconsistent.`);
    }
    const prepared = await prepareEnvelopeMode({ request, input, executeAtomic, state, envelopeRef: liveRef });
    if (!prepared.ok) return prepared;
    operations.push({ operation_id: `automation-${index + 1}-${input.mode}`, mode: input.mode, target_ref: liveRef.ref, refs: { envelope_ref: liveRef }, ...prepared.operation });
    state.canonicalRefs.push(liveRef.ref);
  }
  state.targetKind = "envelope";
  state.targetCount = operations.length;
  return { ok: true, operations };
}

async function prepareEnvelopeMode({ request, input, executeAtomic, state, envelopeRef }) {
  if (input.mode === "insert_points") {
    const before = await readCompletePoints({ request, executeAtomic, state, envelopeRef, autoitemIndex: -1 });
    if (!before.ok) return before;
    const valueDomain = validateEnvelopePointValues(input.points, before.summary);
    if (!valueDomain.ok) return valueDomain;
    const overlay = buildPointOverlay(before.points, input.points);
    if (!overlay.ok) return overlay;
    if (overlay.expected.length > MAX_COMPLETE_READ_POINTS) return failed("AUTOMATION_COMPLETE_READBACK_REQUIRED", `Envelope ${envelopeRef.ref} overlay would exceed the complete ${MAX_COMPLETE_READ_POINTS}-point readback boundary.`);
    return { ok: true, operation: { template_id: INSERT_POINTS_ID, input: { autoitem_index: -1, points: input.points }, requested: { autoitem_index: -1, point_count: input.points.length, first_time_seconds: input.points[0].time_seconds, last_time_seconds: input.points.at(-1).time_seconds, time_basis: "project", value_range: valueDomain.range }, autoitem_index: -1, before_points: before.points, expected_points: overlay.expected, overlay_facts: overlay.facts } };
  }
  if (["update_point", "delete_point", "delete_point_range"].includes(input.mode)) {
    const spec = input.mode === "update_point" ? input.point_update : input.mode === "delete_point" ? input.point_delete : input.point_range;
    const before = await readCompletePoints({ request, executeAtomic, state, envelopeRef, autoitemIndex: spec.autoitem_index });
    if (!before.ok) return before;
    if (input.mode === "update_point") {
      const current = before.points.find((point) => point.point_index === spec.point_index);
      if (!current) return failed("AUTOMATION_POINT_INDEX_OUT_OF_RANGE", `point_index ${spec.point_index} is outside ${envelopeRef.ref} lane count ${before.points.length}.`);
      const desired = { ...current, ...spec.fields };
      delete desired.point_index;
      const valueDomain = validateEnvelopePointValues([desired], before.summary);
      if (!valueDomain.ok) return valueDomain;
      return { ok: true, operation: { template_id: SET_POINT_ID, input: { autoitem_index: spec.autoitem_index, point_index: spec.point_index, ...spec.fields }, requested: { autoitem_index: spec.autoitem_index, original_point_index: spec.point_index, current_point: current, desired_point: desired, before_count: before.points.length }, autoitem_index: spec.autoitem_index, before_points: before.points, current_point: current, desired_point: desired } };
    }
    if (input.mode === "delete_point") {
      const current = before.points.find((point) => point.point_index === spec.point_index);
      if (!current) return failed("AUTOMATION_POINT_INDEX_OUT_OF_RANGE", `point_index ${spec.point_index} is outside ${envelopeRef.ref} lane count ${before.points.length}.`);
      return { ok: true, operation: { template_id: DELETE_POINTS_ID, destructive: true, input: { mode: "point", autoitem_index: spec.autoitem_index, point_index: spec.point_index }, requested: { autoitem_index: spec.autoitem_index, point_index: spec.point_index, current_point: current, before_count: before.points.length }, autoitem_index: spec.autoitem_index, before_points: before.points, current_point: current } };
    }
    const matching = before.points.filter((point) => point.time_seconds >= spec.start_seconds && point.time_seconds < spec.end_seconds);
    return { ok: true, operation: { template_id: DELETE_POINTS_ID, destructive: true, input: { mode: "range", autoitem_index: spec.autoitem_index, start_seconds: spec.start_seconds, end_seconds: spec.end_seconds }, requested: { autoitem_index: spec.autoitem_index, range: { start_seconds: spec.start_seconds, end_seconds: spec.end_seconds, interval: "half_open" }, matching_points: matching, matching_count: matching.length, before_count: before.points.length }, autoitem_index: spec.autoitem_index, before_points: before.points, range: { start_seconds: spec.start_seconds, end_seconds: spec.end_seconds } } };
  }
  if (input.mode === "create_automation_item") {
    const before = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef });
    if (!before.ok) return before;
    if (before.items.length >= MAX_AUTOMATION_ITEMS) return failed("AUTOMATION_ITEM_READBACK_LIMIT", `Envelope ${envelopeRef.ref} already reaches the complete ${MAX_AUTOMATION_ITEMS}-Item readback boundary.`);
    return { ok: true, operation: { template_id: CREATE_AUTOMATION_ITEM_ID, input: input.automation_item, requested: clone(input.automation_item), before_items: before.items } };
  }
  if (input.mode === "set_automation_item_bounds") {
    const before = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef });
    if (!before.ok) return before;
    const current = before.items.find((item) => item.automation_item_index === input.automation_item_bounds.automation_item_index);
    if (!current) return failed("AUTOMATION_ITEM_INDEX_OUT_OF_RANGE", `automation_item_index ${input.automation_item_bounds.automation_item_index} is outside ${envelopeRef.ref}.`);
    return { ok: true, operation: { template_id: SET_AUTOMATION_ITEM_BOUNDS_ID, input: input.automation_item_bounds, requested: { current_item: current, fields: clone(input.automation_item_bounds) }, before_items: before.items } };
  }
  if (input.mode === "delete_automation_item") {
    const before = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef });
    if (!before.ok) return before;
    const current = before.items.find((item) => item.automation_item_index === input.automation_item_delete.automation_item_index);
    if (!current) return failed("AUTOMATION_ITEM_INDEX_OUT_OF_RANGE", `automation_item_index ${input.automation_item_delete.automation_item_index} is outside ${envelopeRef.ref}.`);
    return { ok: true, operation: { template_id: DELETE_AUTOMATION_ITEM_ID, destructive: true, input: input.automation_item_delete, requested: { current_item: current, before_count: before.items.length }, before_items: before.items, current_item: current } };
  }
  return failed("AUTOMATION_MODE_HELD", `${input.mode} is not executable in Alpha3.3-B1d.`);
}

async function prepareTrackOperations({ request, input, executeAtomic, state }) {
  const direct = collectObjectRefs(request.refs, "track");
  const candidates = [...direct.map((ref) => ref.ref), ...input.track_refs];
  if (candidates.length < 1) return failed("AUTOMATION_EXACT_TRACK_REQUIRED", "set_track_mode requires at least one exact Track GUID ref.");
  if (candidates.length > MAX_TARGETS) return failed("AUTOMATION_TARGET_LIMIT_EXCEEDED", `Track targets exceed ${MAX_TARGETS}.`);
  if (new Set(candidates).size !== candidates.length) return failed("AUTOMATION_TARGETS_DUPLICATED", "Track targets must resolve once each.");
  const operations = [];
  for (const [index, token] of candidates.entries()) {
    if (!isExactTrackRef(token)) return failed("AUTOMATION_EXACT_TRACK_REQUIRED", `Track target ${token} must be an exact track:guid ref.`);
    const resolved = await runAtomic(executeAtomic, request, { id: RESOLVE_TRACK_ID, input: { track_ref: token }, refs: {} });
    collectEvidence(state, resolved);
    if (resolved?.ok !== true) return atomicFailure(resolved, RESOLVE_TRACK_ID);
    const summary = executionSummary(resolved);
    const trackRef = executionObjectRefs(resolved).find((ref) => ref.kind === "track");
    if (!trackRef || trackRef.ref !== token || summary.track_ref !== token) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Live Track resolution did not round-trip ${token}.`);
    const before = await readTrackMode({ request, executeAtomic, state, trackRef });
    if (!before.ok) return before;
    operations.push({ operation_id: `automation-${index + 1}-set_track_mode`, mode: input.mode, template_id: SET_TRACK_MODE_ID, target_ref: trackRef.ref, refs: { track_ref: trackRef }, input: { mode: input.track_mode }, requested: { mode: input.track_mode }, before: { mode: before.summary.mode } });
    state.canonicalRefs.push(trackRef.ref);
  }
  state.targetKind = "track";
  state.targetCount = operations.length;
  return { ok: true, operations };
}

async function prepareFxOperations({ request, input, executeAtomic, state }) {
  const direct = collectObjectRefs(request.refs, "fx");
  const candidates = [...direct.map((ref) => ref.ref), ...input.fx_refs];
  if (candidates.length < 1) return failed("AUTOMATION_EXACT_FX_REQUIRED", "insert_fx_parameter_points requires at least one exact Track-FX or Take-FX ref.");
  if (candidates.length > MAX_TARGETS) return failed("AUTOMATION_TARGET_LIMIT_EXCEEDED", `FX targets exceed ${MAX_TARGETS}.`);
  if (new Set(candidates).size !== candidates.length) return failed("AUTOMATION_TARGETS_DUPLICATED", "FX targets must resolve once each.");
  if (candidates.length * input.points.length > MAX_NEW_POINTS) return failed("AUTOMATION_POINT_LIMIT_EXCEEDED", `Total inserted point work exceeds ${MAX_NEW_POINTS} across all target FX.`);
  if (input.points.some((point) => point.value < 0 || point.value > 1)) return failed("AUTOMATION_POINT_VALUE_OUT_OF_RANGE", "FX parameter Envelope values must be normalized within 0..1.");
  const operations = [];
  for (const [index, token] of candidates.entries()) {
    if (!isExactFxRef(token)) return failed("AUTOMATION_EXACT_FX_REQUIRED", `FX target ${token} must be an exact fx:track:guid or fx:take:guid ref.`);
    const fxRef = fxObjectRef(token);
    const mapping = await readFxParameterMapping({ request, executeAtomic, state, fxRef, fxParameter: input.fx_parameter });
    if (!mapping.ok) return mapping;
    let envelopeRef = null;
    let beforePoints = [];
    if (mapping.exists) {
      envelopeRef = mapping.envelopeRef;
      const before = await readCompletePoints({ request, executeAtomic, state, envelopeRef, autoitemIndex: -1 });
      if (!before.ok) return before;
      const overlay = buildPointOverlay(before.points, input.points);
      if (!overlay.ok) return overlay;
      if (overlay.expected.length > MAX_COMPLETE_READ_POINTS) return failed("AUTOMATION_COMPLETE_READBACK_REQUIRED", `FX parameter Envelope ${envelopeRef.ref} overlay would exceed the complete ${MAX_COMPLETE_READ_POINTS}-point readback boundary.`);
      beforePoints = before.points;
      state.canonicalRefs.push(envelopeRef.ref);
    } else if (input.fx_parameter.create_if_missing !== true) {
      return failed("AUTOMATION_FX_ENVELOPE_MISSING", `FX parameter ${input.fx_parameter.param_index} has no existing Envelope; set create_if_missing=true to use the audited native ensure route.`);
    }
    operations.push({
      operation_id: `automation-${index + 1}-insert_fx_parameter_points`,
      mode: input.mode,
      template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID,
      target_ref: fxRef.ref,
      refs: { fx_ref: fxRef },
      input: { param_index: input.fx_parameter.param_index, ...(input.fx_parameter.param_ident ? { param_ident: input.fx_parameter.param_ident } : {}) },
      requested: {
        param_index: input.fx_parameter.param_index,
        param_ident: mapping.paramIdent,
        owner_kind: mapping.ownerKind,
        create_if_missing: input.fx_parameter.create_if_missing,
        envelope_existed_before: mapping.exists,
        point_count: input.points.length,
        time_basis: "project",
        value_range: { min: 0, max: 1 },
      },
      fx_ref: fxRef,
      envelope_ref: envelopeRef,
      mapping_before: mapping,
      before_points: beforePoints,
      points: input.points,
      autoitem_index: -1,
    });
    state.canonicalRefs.push(fxRef.ref);
  }
  state.targetKind = "fx";
  state.targetCount = operations.length;
  return { ok: true, operations };
}

async function executeOperations({ request, executeAtomic, state }) {
  for (const operation of state.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    if (operation.mode === "insert_fx_parameter_points") {
      const failure = await executeFxOperation({ operation, change, request, executeAtomic, state });
      if (failure) return failure;
      continue;
    }
    let mutation;
    let childFailure = null;
    try {
      mutation = await runAtomic(executeAtomic, request, { id: operation.template_id, input: operation.input, refs: operation.refs });
    } catch (error) {
      childFailure = executionError(error, operation.template_id, "mutation");
    }
    if (mutation) collectEvidence(state, mutation);
    if (!childFailure && mutation?.ok !== true) childFailure = { ...atomicFailure(mutation, operation.template_id), phase: "mutation" };
    if (childFailure) {
      change.mutation = {
        status: "unknown_or_partial",
        template_id: operation.template_id,
        blocker_code: childFailure.code,
        ...(mutation?.error?.details ? { details: clone(mutation.error.details) } : {}),
      };
      const verifiedAfterFailure = await verifyOperation({ operation, request, executeAtomic, state });
      if (verifiedAfterFailure.ok) {
        change.status = "applied";
        change.live_readback = { status: "passed", source: verifiedAfterFailure.source, ...verifiedAfterFailure.facts };
      } else {
        change.status = "readback_failed";
        change.live_readback = { status: "failed", source: verifiedAfterFailure.source ?? "exact_live_readback" };
      }
      return childFailure;
    }
    change.mutation = { status: "completed", template_id: operation.template_id };
    const verified = await verifyOperation({ operation, request, executeAtomic, state });
    if (!verified.ok) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: verified.source ?? "exact_live_readback" };
      return { ...verified, phase: "readback" };
    }
    change.status = "applied";
    change.live_readback = { status: "passed", source: verified.source, ...verified.facts };
  }
  return null;
}

async function executeFxOperation({ operation, change, request, executeAtomic, state }) {
  let ensured;
  try {
    ensured = await runAtomic(executeAtomic, request, { id: ENSURE_FX_PARAMETER_ENVELOPE_ID, input: operation.input, refs: { fx_ref: operation.fx_ref } });
  } catch (error) {
    change.mutation = { status: "unknown_or_partial", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope" };
    change.status = "readback_failed";
    change.live_readback = { status: "failed", source: "live_fx_parameter_mapping" };
    return executionError(error, ENSURE_FX_PARAMETER_ENVELOPE_ID, "mutation");
  }
  collectEvidence(state, ensured);
  if (ensured?.ok !== true) {
    const failure = atomicFailure(ensured, ENSURE_FX_PARAMETER_ENVELOPE_ID);
    change.mutation = { status: "unknown_or_partial", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope", ...(ensured?.error?.details ? { details: clone(ensured.error.details) } : {}) };
    const verified = await verifyOperation({ operation, request, executeAtomic, state });
    change.status = verified.ok ? "applied" : "readback_failed";
    change.live_readback = verified.ok ? { status: "passed", source: verified.source, ...verified.facts } : { status: "failed", source: verified.source ?? "live_fx_parameter_mapping" };
    return { ...failure, phase: "mutation" };
  }

  const mapping = await readFxParameterMapping({ request, executeAtomic, state, fxRef: operation.fx_ref, fxParameter: operation.input });
  if (!mapping.ok || !mapping.exists || !mapping.envelopeRef) {
    change.mutation = { status: "unknown_or_partial", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope" };
    change.status = "readback_failed";
    change.live_readback = { status: "failed", source: "live_fx_parameter_mapping" };
    return { ...(mapping.ok ? failed("AUTOMATION_FX_ENVELOPE_READBACK_MISSING", "Ensured FX parameter Envelope was not independently resolved by the read mapping.") : mapping), phase: "readback" };
  }
  operation.envelope_ref = mapping.envelopeRef;
  operation.refs.envelope_ref = mapping.envelopeRef;
  state.canonicalRefs.push(mapping.envelopeRef.ref);
  const baseline = await readCompletePoints({ request, executeAtomic, state, envelopeRef: mapping.envelopeRef, autoitemIndex: -1 });
  if (!baseline.ok) {
    change.mutation = { status: "unknown_or_partial", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope" };
    change.status = "readback_failed";
    change.live_readback = { status: "failed", source: "live_envelope_points" };
    return { ...baseline, phase: "readback" };
  }
  if (operation.mapping_before.exists && !pointMultisetEquals(baseline.points.map(stripPointIndex), operation.before_points.map(stripPointIndex))) {
    change.mutation = { status: "not_completed", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "stale_preflight" };
    change.status = "blocked";
    change.live_readback = { status: "failed", source: "live_envelope_points" };
    return { ...failed("AUTOMATION_PRECONDITION_STALE", `FX parameter Envelope ${mapping.envelopeRef.ref} changed after preflight; no points were inserted.`), phase: "readback" };
  }
  operation.before_points = baseline.points;
  const overlay = buildPointOverlay(baseline.points, operation.points);
  if (!overlay.ok) {
    change.mutation = { status: operation.mapping_before.exists ? "not_completed" : "completed", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope" };
    change.status = "blocked";
    change.live_readback = { status: "failed", source: "live_envelope_points" };
    return { ...overlay, phase: "readback" };
  }
  operation.expected_points = overlay.expected;
  operation.overlay_facts = overlay.facts;
  if (overlay.expected.length > MAX_COMPLETE_READ_POINTS) {
    change.mutation = { status: operation.mapping_before.exists ? "not_completed" : "completed", template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, stage: "ensure_envelope" };
    change.status = "blocked";
    change.live_readback = { status: "failed", source: "live_envelope_points" };
    return { ...failed("AUTOMATION_COMPLETE_READBACK_REQUIRED", `FX parameter Envelope ${mapping.envelopeRef.ref} overlay would exceed the complete ${MAX_COMPLETE_READ_POINTS}-point readback boundary.`), phase: "readback" };
  }

  let inserted;
  try {
    inserted = await runAtomic(executeAtomic, request, { id: INSERT_POINTS_ID, input: { autoitem_index: -1, points: operation.points }, refs: { envelope_ref: mapping.envelopeRef } });
  } catch (error) {
    change.mutation = { status: "unknown_or_partial", template_id: INSERT_POINTS_ID, stage: "insert_points", ensure_template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID };
    const verified = await verifyOperation({ operation, request, executeAtomic, state });
    change.status = verified.ok ? "applied" : "readback_failed";
    change.live_readback = verified.ok ? { status: "passed", source: verified.source, ...verified.facts } : { status: "failed", source: verified.source ?? "live_envelope_points" };
    return executionError(error, INSERT_POINTS_ID, "mutation");
  }
  collectEvidence(state, inserted);
  if (inserted?.ok !== true) {
    const failure = atomicFailure(inserted, INSERT_POINTS_ID);
    change.mutation = { status: "unknown_or_partial", template_id: INSERT_POINTS_ID, stage: "insert_points", ensure_template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID, ...(inserted?.error?.details ? { details: clone(inserted.error.details) } : {}) };
    const verified = await verifyOperation({ operation, request, executeAtomic, state });
    change.status = verified.ok ? "applied" : "readback_failed";
    change.live_readback = verified.ok ? { status: "passed", source: verified.source, ...verified.facts } : { status: "failed", source: verified.source ?? "live_envelope_points" };
    return { ...failure, phase: "mutation" };
  }
  change.mutation = { status: "completed", template_id: INSERT_POINTS_ID, ensure_template_id: ENSURE_FX_PARAMETER_ENVELOPE_ID };
  const verified = await verifyOperation({ operation, request, executeAtomic, state });
  if (!verified.ok) {
    change.status = "readback_failed";
    change.live_readback = { status: "failed", source: verified.source ?? "live_envelope_points" };
    return { ...verified, phase: "readback" };
  }
  change.status = "applied";
  change.live_readback = { status: "passed", source: verified.source, ...verified.facts };
  return null;
}

async function verifyOperation({ operation, request, executeAtomic, state }) {
  if (operation.mode === "insert_points") {
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref, autoitemIndex: operation.autoitem_index });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    if (!pointMultisetEquals(after.points.map(stripPointIndex), operation.expected_points)) return failed("AUTOMATION_READBACK_MISMATCH", `Exact point readback did not match the complete overlay on ${operation.target_ref}.`, [blocker("AUTOMATION_READBACK_MISMATCH", "Complete after-readback did not equal the expected point overlay.")]);
    return { ok: true, source: "live_envelope_points", facts: { ...operation.overlay_facts, after: after.points.length } };
  }
  if (operation.mode === "update_point") {
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref, autoitemIndex: operation.autoitem_index });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    const expected = operation.before_points.filter((point) => point.point_index !== operation.current_point.point_index).map(stripPointIndex);
    expected.push(operation.desired_point);
    if (after.points.length !== operation.before_points.length || !pointMultisetEquals(after.points.map(stripPointIndex), expected)) return failed("AUTOMATION_READBACK_MISMATCH", `Exact point update readback did not match ${operation.target_ref}.`);
    return { ok: true, source: "live_envelope_points", facts: { autoitem_index: operation.autoitem_index, point_count: after.points.length, desired_point: operation.desired_point } };
  }
  if (operation.mode === "delete_point") {
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref, autoitemIndex: operation.autoitem_index });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    const expected = operation.before_points.filter((point) => point.point_index !== operation.current_point.point_index).map(stripPointIndex);
    if (after.points.length !== operation.before_points.length - 1 || !pointMultisetEquals(after.points.map(stripPointIndex), expected)) return failed("AUTOMATION_READBACK_MISMATCH", `Deleted point tuple/count did not read back absent on ${operation.target_ref}.`);
    return { ok: true, source: "live_envelope_points", facts: { autoitem_index: operation.autoitem_index, deleted_count: 1, before_count: operation.before_points.length, after_count: after.points.length } };
  }
  if (operation.mode === "delete_point_range") {
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref, autoitemIndex: operation.autoitem_index });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    const expected = operation.before_points.filter((point) => point.time_seconds < operation.range.start_seconds || point.time_seconds >= operation.range.end_seconds).map(stripPointIndex);
    const rangeAbsent = after.points.every((point) => point.time_seconds < operation.range.start_seconds || point.time_seconds >= operation.range.end_seconds);
    if (!rangeAbsent || !pointMultisetEquals(after.points.map(stripPointIndex), expected)) return failed("AUTOMATION_READBACK_MISMATCH", `Half-open [start,end) deletion did not prove exact absence on ${operation.target_ref}.`);
    return { ok: true, source: "live_envelope_points", facts: { autoitem_index: operation.autoitem_index, deleted_count: operation.before_points.length - after.points.length, before_count: operation.before_points.length, after_count: after.points.length, range_absent: true, interval: "half_open" } };
  }
  if (operation.mode === "set_track_mode") {
    const after = await readTrackMode({ request, executeAtomic, state, trackRef: operation.refs.track_ref });
    if (!after.ok || after.summary.track_ref !== operation.target_ref || after.summary.mode !== operation.input.mode) return failed("AUTOMATION_READBACK_MISMATCH", `Exact Track automation-mode readback did not match ${operation.target_ref}.`);
    return { ok: true, source: "live_track_automation_mode", facts: { mode: after.summary.mode } };
  }
  if (operation.mode === "create_automation_item") {
    const after = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref });
    if (!after.ok) return { ...after, source: "live_automation_items" };
    const beforeIndexes = new Set(operation.before_items.map((item) => item.automation_item_index));
    const beforePoolIds = new Set(operation.before_items.map((item) => item.pool_id));
    const created = after.items.filter((item) => !beforeIndexes.has(item.automation_item_index));
    const matches = created.length === 1 && after.items.length === operation.before_items.length + 1
      && valuesMatch(created[0].position_seconds, operation.input.position_seconds)
      && valuesMatch(created[0].length_seconds, operation.input.length_seconds)
      && Number.isInteger(created[0].pool_id)
      && created[0].pool_id >= 0
      && !beforePoolIds.has(created[0].pool_id);
    if (!matches) return failed("AUTOMATION_READBACK_MISMATCH", `Exact Automation Item readback did not prove one matching new Item on ${operation.target_ref}.`);
    return { ok: true, source: "live_automation_items", facts: { automation_item_index: created[0].automation_item_index, position_seconds: created[0].position_seconds, length_seconds: created[0].length_seconds, pool_id: created[0].pool_id } };
  }
  if (operation.mode === "set_automation_item_bounds") {
    const after = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref });
    if (!after.ok) return { ...after, source: "live_automation_items" };
    const observed = after.items.find((item) => item.automation_item_index === operation.input.automation_item_index);
    const countMatches = after.items.length === operation.before_items.length;
    const fieldsMatch = observed && Object.entries(operation.input).every(([field, value]) => field === "automation_item_index" ? observed[field] === value : valuesMatch(observed[field], value));
    if (!countMatches || !fieldsMatch) return failed("AUTOMATION_READBACK_MISMATCH", `Automation Item bounds did not read back exactly on ${operation.target_ref}.`);
    return { ok: true, source: "live_automation_items", facts: pick(observed, Object.keys(operation.input)) };
  }
  if (operation.mode === "delete_automation_item") {
    const after = await readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref });
    if (!after.ok) return { ...after, source: "live_automation_items" };
    const expected = operation.before_items.filter((item) => item.automation_item_index !== operation.current_item.automation_item_index);
    if (after.items.length !== expected.length || !automationItemRowsMatchAfterDeletion(after.items, expected)) return failed("AUTOMATION_READBACK_MISMATCH", `Deleted Automation Item tuple/count did not read back absent on ${operation.target_ref}.`);
    return { ok: true, source: "live_automation_items", facts: { automation_item_index: operation.current_item.automation_item_index, deleted_count: 1, before_count: operation.before_items.length, after_count: after.items.length, target_absent: true } };
  }
  if (operation.mode === "insert_fx_parameter_points") {
    const mapping = await readFxParameterMapping({ request, executeAtomic, state, fxRef: operation.fx_ref, fxParameter: operation.input });
    if (!mapping.ok) return { ...mapping, source: "live_fx_parameter_mapping" };
    if (!mapping.exists || !mapping.envelopeRef || operation.envelope_ref && mapping.envelopeRef.ref !== operation.envelope_ref.ref) return failed("AUTOMATION_READBACK_MISMATCH", `FX parameter Envelope identity did not independently round-trip ${operation.target_ref}.`);
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: mapping.envelopeRef, autoitemIndex: -1 });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    if (!operation.expected_points || !pointMultisetEquals(after.points.map(stripPointIndex), operation.expected_points)) return failed("AUTOMATION_READBACK_MISMATCH", `Exact FX parameter point readback did not match the complete overlay on ${operation.target_ref}.`);
    return { ok: true, source: "live_fx_parameter_mapping_and_points", facts: { fx_ref: operation.fx_ref.ref, envelope_ref: mapping.envelopeRef.ref, owner_kind: mapping.ownerKind, param_index: mapping.paramIndex, param_ident: mapping.paramIdent, ...operation.overlay_facts, after: after.points.length, created_envelope: operation.mapping_before.exists === false } };
  }
  return failed("AUTOMATION_MODE_HELD", `${operation.mode} has no verifier.`);
}

async function readEnvelopeSummary({ request, executeAtomic, state, envelopeRef }) {
  const execution = await runAtomic(executeAtomic, request, { id: READ_ENVELOPE_ID, input: {}, refs: { envelope_ref: envelopeRef } });
  collectEvidence(state, execution);
  if (execution?.ok !== true) return atomicFailure(execution, READ_ENVELOPE_ID);
  const summary = executionSummary(execution);
  if (summary.envelope_ref !== envelopeRef.ref) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Envelope summary did not round-trip ${envelopeRef.ref}.`);
  return { ok: true, summary };
}

async function readCompletePoints({ request, executeAtomic, state, envelopeRef, autoitemIndex = -1 }) {
  const execution = await runAtomic(executeAtomic, request, { id: READ_POINTS_ID, input: { autoitem_index: autoitemIndex, limit: MAX_COMPLETE_READ_POINTS }, refs: { envelope_ref: envelopeRef } });
  collectEvidence(state, execution);
  if (execution?.ok !== true) return atomicFailure(execution, READ_POINTS_ID);
  const summary = executionSummary(execution);
  const points = Array.isArray(summary.points) ? summary.points.map(normalizeReadPoint) : [];
  if (summary.envelope_ref !== envelopeRef.ref) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Point readback did not round-trip ${envelopeRef.ref}.`);
  if (summary.autoitem_index !== undefined && summary.autoitem_index !== autoitemIndex) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Point readback changed autoitem_index for ${envelopeRef.ref}.`);
  if (summary.truncated === true || summary.total_count !== points.length || summary.returned_count !== points.length || points.length > MAX_COMPLETE_READ_POINTS) return failed("AUTOMATION_COMPLETE_READBACK_REQUIRED", `Envelope ${envelopeRef.ref} does not have one complete <=${MAX_COMPLETE_READ_POINTS}-point live page.`);
  if (points.some((point) => !point.ok)) return failed("AUTOMATION_POINT_READBACK_INVALID", `Envelope ${envelopeRef.ref} returned an invalid point row.`);
  return { ok: true, points: points.map((point) => point.value), summary };
}

async function readTrackMode({ request, executeAtomic, state, trackRef }) {
  const execution = await runAtomic(executeAtomic, request, { id: READ_TRACK_MODE_ID, input: {}, refs: { track_ref: trackRef } });
  collectEvidence(state, execution);
  if (execution?.ok !== true) return atomicFailure(execution, READ_TRACK_MODE_ID);
  const summary = executionSummary(execution);
  if (summary.track_ref !== trackRef.ref) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Track mode readback did not round-trip ${trackRef.ref}.`);
  return { ok: true, summary };
}

async function readFxParameterMapping({ request, executeAtomic, state, fxRef, fxParameter }) {
  const input = { param_index: fxParameter.param_index, ...(fxParameter.param_ident ? { param_ident: fxParameter.param_ident } : {}) };
  const execution = await runAtomic(executeAtomic, request, { id: MAP_FX_PARAMETER_ENVELOPE_ID, input, refs: { fx_ref: fxRef } });
  collectEvidence(state, execution);
  if (execution?.ok !== true) return atomicFailure(execution, MAP_FX_PARAMETER_ENVELOPE_ID);
  const summary = executionSummary(execution);
  const returnedFx = executionObjectRefs(execution).find((ref) => ref.kind === "fx");
  const envelopeRef = executionObjectRefs(execution).find((ref) => ref.kind === "envelope") ?? null;
  const exists = summary.envelope_exists === true || summary.envelope_available === true;
  if (!returnedFx || returnedFx.ref !== fxRef.ref || summary.fx_ref !== fxRef.ref || summary.param_index !== fxParameter.param_index || !["track", "take"].includes(summary.owner_kind) || typeof summary.param_ident !== "string" || summary.param_ident.length === 0) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `FX parameter mapping did not exactly round-trip ${fxRef.ref}.`);
  if (fxParameter.param_ident && summary.param_ident !== fxParameter.param_ident) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `FX parameter mapping changed param_ident for ${fxRef.ref}.`);
  if (exists && (!envelopeRef || !/^envelope:guid:.+/u.test(envelopeRef.ref) || summary.envelope_ref !== envelopeRef.ref)) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Existing FX parameter mapping did not return one canonical GUID Envelope ref for ${fxRef.ref}.`);
  if (!exists && envelopeRef) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Missing FX parameter mapping unexpectedly returned an Envelope ref for ${fxRef.ref}.`);
  return { ok: true, exists, envelopeRef, ownerKind: summary.owner_kind, ownerRef: summary.owner_ref, slotIndex: summary.slot_index, paramIndex: summary.param_index, paramIdent: summary.param_ident, paramName: summary.parameter_name ?? summary.param_name ?? "" };
}

async function readCompleteAutomationItems({ request, executeAtomic, state, envelopeRef }) {
  const execution = await runAtomic(executeAtomic, request, { id: READ_AUTOMATION_ITEMS_ID, input: { limit: MAX_AUTOMATION_ITEMS }, refs: { envelope_ref: envelopeRef } });
  collectEvidence(state, execution);
  if (execution?.ok !== true) return atomicFailure(execution, READ_AUTOMATION_ITEMS_ID);
  const summary = executionSummary(execution);
  const items = Array.isArray(summary.items) ? summary.items.map(normalizeAutomationItem) : [];
  if (summary.envelope_ref !== envelopeRef.ref) return failed("AUTOMATION_TARGET_IDENTITY_MISMATCH", `Automation Item readback did not round-trip ${envelopeRef.ref}.`);
  if (summary.truncated === true || summary.total_count !== items.length || summary.returned_count !== items.length || items.length > MAX_AUTOMATION_ITEMS || items.some((item) => !item.ok)) return failed("AUTOMATION_ITEM_READBACK_LIMIT", `Envelope ${envelopeRef.ref} does not have one complete valid <=${MAX_AUTOMATION_ITEMS}-Item live page.`);
  return { ok: true, items: items.map((item) => item.value) };
}

function normalizeInput(input) {
  if (!isPlainObject(input)) return failed("AUTOMATION_REQUEST_INVALID", "macro.automation.apply input must be an object.");
  if (Object.hasOwn(input, "confirmation")) return failed("AUTOMATION_CONFIRMATION_TOKEN_REQUIRED", "Boolean confirmation is insufficient; destructive modes require confirmation_token from a current dry-run preview.");
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return failed("AUTOMATION_REQUEST_INVALID", `Unsupported input field(s): ${unknown.join(", ")}. Model-supplied steps are forbidden.`);
  const requestedMode = input.mode === "delete_points" ? "delete_point" : input.mode;
  const mode = MODE_ALIASES.get(requestedMode) ?? requestedMode;
  if (!ALPHA3_3_B1D_AUTOMATION_APPLY_MODES.includes(mode)) {
    const code = ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES.includes(mode) ? heldModeCode(mode) : "AUTOMATION_MODE_UNSUPPORTED";
    return failed(code, `mode=${String(mode)} is not executable in Alpha3.3-B1d; supported modes are ${ALPHA3_3_B1D_AUTOMATION_APPLY_MODES.join(", ")}.`);
  }
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") return failed("AUTOMATION_REQUEST_INVALID", "dry_run must be boolean.");
  if (input.confirmation_token !== undefined && (typeof input.confirmation_token !== "string" || input.confirmation_token.length === 0)) return failed("AUTOMATION_CONFIRMATION_TOKEN_REQUIRED", "confirmation_token must be the non-empty string returned by dry-run preview.");
  const envelopeRefs = normalizeStringArray(input.envelope_refs, "envelope_refs", MAX_TARGETS);
  if (!envelopeRefs.ok) return envelopeRefs;
  const trackRefs = normalizeStringArray(input.track_refs, "track_refs", MAX_TARGETS);
  if (!trackRefs.ok) return trackRefs;
  const fxRefs = normalizeStringArray(input.fx_refs, "fx_refs", MAX_TARGETS);
  if (!fxRefs.ok) return fxRefs;
  const normalized = { mode, envelope_refs: envelopeRefs.value, track_refs: trackRefs.value, fx_refs: fxRefs.value, points: null, point_update: null, point_delete: null, point_range: null, track_mode: null, automation_item: null, automation_item_bounds: null, automation_item_delete: null, fx_parameter: null, dry_run: input.dry_run !== false, confirmation_token: input.confirmation_token ?? null };
  if (mode === "insert_points") {
    const points = normalizePoints(input.points);
    if (!points.ok) return points;
    normalized.points = points.value;
    if (hasAny(input, ["point_update", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "insert_points accepts only Envelope targets and points.");
  } else if (mode === "update_point") {
    const update = normalizePointUpdate(input.point_update);
    if (!update.ok) return update;
    normalized.point_update = update.value;
    if (hasAny(input, ["points", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "update_point accepts only Envelope targets and point_update.");
  } else if (mode === "delete_point") {
    const deletion = normalizePointDelete(input.point_delete);
    if (!deletion.ok) return deletion;
    normalized.point_delete = deletion.value;
    if (hasAny(input, ["points", "point_update", "point_range", "track_mode", "automation_item", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "delete_point accepts only Envelope targets, point_delete, and confirmation_token.");
  } else if (mode === "delete_point_range") {
    const range = normalizePointRange(input.point_range);
    if (!range.ok) return range;
    normalized.point_range = range.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "track_mode", "automation_item", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "delete_point_range accepts only Envelope targets, point_range, and confirmation_token.");
  } else if (mode === "set_track_mode") {
    if (!["trim_read", "read"].includes(input.track_mode)) return failed(["touch", "write", "latch", "latch_preview"].includes(input.track_mode) ? "AUTOMATION_REALTIME_MODE_HELD" : "AUTOMATION_TRACK_MODE_INVALID", "set_track_mode supports only trim_read or read; real-time touch/write/latch modes are held.");
    normalized.track_mode = input.track_mode;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "automation_item", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || envelopeRefs.value.length > 0 || fxRefs.value.length > 0 || input.confirmation_token !== undefined) return failed("AUTOMATION_REQUEST_INVALID", "set_track_mode accepts only Track targets and track_mode.");
  } else if (mode === "create_automation_item") {
    const automationItem = normalizeCreateAutomationItem(input.automation_item);
    if (!automationItem.ok) return automationItem;
    normalized.automation_item = automationItem.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "track_mode", "automation_item_bounds", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "create_automation_item accepts only Envelope targets and automation_item.");
  } else if (mode === "set_automation_item_bounds") {
    const bounds = normalizeAutomationItemBounds(input.automation_item_bounds);
    if (!bounds.ok) return bounds;
    normalized.automation_item_bounds = bounds.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_delete", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "set_automation_item_bounds accepts only Envelope targets and automation_item_bounds.");
  } else if (mode === "delete_automation_item") {
    const deletion = normalizeAutomationItemDelete(input.automation_item_delete);
    if (!deletion.ok) return deletion;
    normalized.automation_item_delete = deletion.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_bounds", "fx_parameter"]) || trackRefs.value.length > 0 || fxRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "delete_automation_item accepts only Envelope targets, automation_item_delete, and confirmation_token.");
  } else {
    const points = normalizePoints(input.points);
    if (!points.ok) return points;
    const fxParameter = normalizeFxParameter(input.fx_parameter);
    if (!fxParameter.ok) return fxParameter;
    normalized.points = points.value;
    normalized.fx_parameter = fxParameter.value;
    if (hasAny(input, ["point_update", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_bounds", "automation_item_delete"]) || envelopeRefs.value.length > 0 || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "insert_fx_parameter_points accepts only FX targets, fx_parameter, and points.");
  }
  if (!DESTRUCTIVE_MODES.has(mode) && input.confirmation_token !== undefined) return failed("AUTOMATION_REQUEST_INVALID", "confirmation_token is valid only for destructive point or Automation Item deletion modes.");
  return { ok: true, input: normalized };
}

function normalizePoints(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_NEW_POINTS) return failed("AUTOMATION_POINTS_INVALID", `points must contain 1-${MAX_NEW_POINTS} rows.`);
  const points = [];
  for (const [index, point] of value.entries()) {
    if (!isPlainObject(point)) return failed("AUTOMATION_POINTS_INVALID", `points[${index}] must be an object.`);
    const unknown = Object.keys(point).filter((field) => !["time_seconds", "value", "shape", "tension", "selected"].includes(field));
    if (unknown.length > 0) return failed("AUTOMATION_POINTS_INVALID", `points[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
    const time = point.time_seconds;
    const rawValue = point.value;
    const shape = point.shape ?? 0;
    const tension = point.tension ?? 0;
    const selected = point.selected ?? false;
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(rawValue) || !Number.isInteger(shape) || shape < 0 || shape > 5 || !Number.isFinite(tension) || tension < -1 || tension > 1 || typeof selected !== "boolean") return failed("AUTOMATION_POINTS_INVALID", `points[${index}] must use project time>=0, a finite raw value, shape 0..5, tension -1..1, and boolean selected.`);
    points.push({ time_seconds: time, value: rawValue, shape, tension, selected });
  }
  for (let index = 0; index < points.length; index += 1) {
    const firstIndex = points.findIndex((point, prior) => prior < index && point.time_seconds === points[index].time_seconds);
    if (firstIndex >= 0) return failed("AUTOMATION_DUPLICATE_POINT_TIME", `points[${index}] collides with points[${firstIndex}] at the same project time; no points were inserted.`);
  }
  return { ok: true, value: points };
}

function normalizePointUpdate(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_POINT_UPDATE_REQUIRED", "update_point requires point_update.");
  const allowed = ["autoitem_index", "point_index", "time_seconds", "value", "shape", "tension", "selected"];
  const unknown = Object.keys(value).filter((field) => !allowed.includes(field));
  if (unknown.length > 0) return failed("AUTOMATION_POINT_UPDATE_INVALID", `point_update has unsupported field(s): ${unknown.join(", ")}.`);
  const autoitemIndex = value.autoitem_index ?? -1;
  if (!Number.isInteger(autoitemIndex) || autoitemIndex < -1 || !Number.isInteger(value.point_index) || value.point_index < 0) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update requires autoitem_index>=-1 and point_index>=0 integers.");
  const fields = {};
  for (const field of ["time_seconds", "value", "shape", "tension", "selected"]) if (Object.hasOwn(value, field)) fields[field] = value[field];
  if (Object.keys(fields).length === 0) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update requires at least one point field to change.");
  if (fields.time_seconds !== undefined && (!Number.isFinite(fields.time_seconds) || fields.time_seconds < 0)) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update.time_seconds must be finite and non-negative.");
  if (fields.value !== undefined && !Number.isFinite(fields.value)) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update.value must be finite.");
  if (fields.shape !== undefined && (!Number.isInteger(fields.shape) || fields.shape < 0)) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update.shape must be a non-negative integer.");
  if (fields.tension !== undefined && !Number.isFinite(fields.tension)) return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update.tension must be finite.");
  if (fields.selected !== undefined && typeof fields.selected !== "boolean") return failed("AUTOMATION_POINT_UPDATE_INVALID", "point_update.selected must be boolean.");
  return { ok: true, value: { autoitem_index: autoitemIndex, point_index: value.point_index, fields } };
}

function normalizePointDelete(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_POINT_DELETE_REQUIRED", "delete_point requires point_delete.");
  const unknown = Object.keys(value).filter((field) => !["autoitem_index", "point_index"].includes(field));
  const autoitemIndex = value.autoitem_index ?? -1;
  if (unknown.length > 0 || !Number.isInteger(autoitemIndex) || autoitemIndex < -1 || !Number.isInteger(value.point_index) || value.point_index < 0) return failed("AUTOMATION_POINT_DELETE_INVALID", "point_delete accepts only autoitem_index>=-1 and point_index>=0 integers.");
  return { ok: true, value: { autoitem_index: autoitemIndex, point_index: value.point_index } };
}

function normalizePointRange(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_POINT_RANGE_REQUIRED", "delete_point_range requires point_range.");
  const unknown = Object.keys(value).filter((field) => !["autoitem_index", "start_seconds", "end_seconds"].includes(field));
  const autoitemIndex = value.autoitem_index ?? -1;
  if (unknown.length > 0 || !Number.isInteger(autoitemIndex) || autoitemIndex < -1 || !Number.isFinite(value.start_seconds) || !Number.isFinite(value.end_seconds) || value.end_seconds <= value.start_seconds) return failed("AUTOMATION_POINT_RANGE_INVALID", "point_range requires autoitem_index>=-1 and finite end_seconds>start_seconds; interval semantics are [start,end)." );
  return { ok: true, value: { autoitem_index: autoitemIndex, start_seconds: value.start_seconds, end_seconds: value.end_seconds } };
}

function normalizeAutomationItemBounds(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_ITEM_BOUNDS_REQUIRED", "set_automation_item_bounds requires automation_item_bounds.");
  const fields = ["position_seconds", "length_seconds", "start_offset_seconds", "playrate"];
  const unknown = Object.keys(value).filter((field) => field !== "automation_item_index" && !fields.includes(field));
  if (unknown.length > 0 || !Number.isInteger(value.automation_item_index) || value.automation_item_index < 0) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "automation_item_bounds requires a non-negative automation_item_index and only supported bounds fields.");
  if (!fields.some((field) => value[field] !== undefined)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "automation_item_bounds requires at least one bounds field.");
  if (value.position_seconds !== undefined && (!Number.isFinite(value.position_seconds) || value.position_seconds < 0)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "position_seconds must be finite and non-negative.");
  if (value.length_seconds !== undefined && (!Number.isFinite(value.length_seconds) || value.length_seconds <= 0)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "length_seconds must be finite and positive.");
  if (value.start_offset_seconds !== undefined && !Number.isFinite(value.start_offset_seconds)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "start_offset_seconds must be finite.");
  if (value.playrate !== undefined && (!Number.isFinite(value.playrate) || value.playrate <= 0)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "playrate must be finite and positive.");
  return { ok: true, value: clone(value) };
}

function normalizeAutomationItemDelete(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_ITEM_DELETE_REQUIRED", "delete_automation_item requires automation_item_delete.");
  const unknown = Object.keys(value).filter((field) => field !== "automation_item_index");
  if (unknown.length > 0 || !Number.isInteger(value.automation_item_index) || value.automation_item_index < 0) return failed("AUTOMATION_ITEM_DELETE_INVALID", "automation_item_delete accepts only a non-negative automation_item_index.");
  return { ok: true, value: { automation_item_index: value.automation_item_index } };
}

function normalizeFxParameter(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_FX_PARAMETER_REQUIRED", "insert_fx_parameter_points requires fx_parameter.");
  const unknown = Object.keys(value).filter((field) => !["param_index", "param_ident", "create_if_missing"].includes(field));
  if (unknown.length > 0 || !Number.isInteger(value.param_index) || value.param_index < 0) return failed("AUTOMATION_FX_PARAMETER_INVALID", "fx_parameter requires a non-negative integer param_index and optional param_ident/create_if_missing.");
  if (value.param_ident !== undefined && (typeof value.param_ident !== "string" || value.param_ident.length === 0 || value.param_ident.length > 160)) return failed("AUTOMATION_FX_PARAMETER_INVALID", "fx_parameter.param_ident must be a non-empty string up to 160 characters.");
  if (value.create_if_missing !== undefined && typeof value.create_if_missing !== "boolean") return failed("AUTOMATION_FX_PARAMETER_INVALID", "fx_parameter.create_if_missing must be boolean.");
  return { ok: true, value: { param_index: value.param_index, ...(value.param_ident ? { param_ident: value.param_ident } : {}), create_if_missing: value.create_if_missing !== false } };
}

function hasAny(value, fields) {
  return fields.some((field) => value[field] !== undefined);
}

function normalizeCreateAutomationItem(value) {
  if (!isPlainObject(value)) return failed("AUTOMATION_ITEM_INPUT_REQUIRED", "create_automation_item requires automation_item.");
  const unknown = Object.keys(value).filter((field) => !["position_seconds", "length_seconds", "pool_mode"].includes(field));
  if (unknown.length > 0) return failed("AUTOMATION_ITEM_INPUT_INVALID", `automation_item has unsupported field(s): ${unknown.join(", ")}.`);
  if (!Number.isFinite(value.position_seconds) || value.position_seconds < 0 || !Number.isFinite(value.length_seconds) || value.length_seconds <= 0 || value.pool_mode !== "new_empty") return failed("AUTOMATION_ITEM_INPUT_INVALID", "automation_item requires position_seconds>=0, length_seconds>0, and pool_mode=new_empty.");
  return { ok: true, value: { position_seconds: value.position_seconds, length_seconds: value.length_seconds, pool_mode: "new_empty" } };
}

function heldModeCode(mode) {
  if (mode.includes("take")) return "AUTOMATION_TAKE_ROUTE_MISSING";
  if (mode === "create_envelope" || mode === "insert_fx_parameter_points") return "AUTOMATION_ENVELOPE_CREATE_MISSING";
  return "AUTOMATION_MODE_HELD";
}

function buildDestructiveConfirmation(input, operations) {
  const binding = {
    contract: "openreaper.automation.confirmation.v1",
    mode: input.mode,
    targets: operations.map((operation) => ({ target_ref: operation.target_ref, requested: operation.requested })),
  };
  const digest = createHash("sha256").update(stableJson(binding)).digest("hex");
  const token = `automation-confirmation:v1:${digest}`;
  const retryInput = {
    mode: input.mode,
    envelope_refs: operations.map((operation) => operation.target_ref),
    ...(input.mode === "delete_point"
      ? { point_delete: clone(input.point_delete) }
      : input.mode === "delete_point_range"
        ? { point_range: clone(input.point_range) }
        : { automation_item_delete: clone(input.automation_item_delete) }),
    dry_run: false,
    confirmation_token: token,
  };
  return { required: true, token, binding, retry: { id: ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID, input: retryInput } };
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function responseBudgetBlocker({ entry, request, input, stages, state, activeBudget }) {
  const projectedState = { ...state, changes: state.operations.map(previewChange) };
  const envelope = buildSuccessEnvelope({ entry, request, startedAt: "2026-01-01T00:00:00.000Z", completedAt: "2026-01-01T00:00:00.000Z", stages: [...stages, stage("automation-apply-mutate", "template_execute", "completed", "Projected mutations."), stage("automation-apply-verify", "verify", "completed", "Projected live verification."), stage("automation-apply-index", "index_update", "completed", "Projected index maintenance."), stage("automation-apply-result", "result_project", "completed", "Projected result.")], state: projectedState, activeBudget: MACRO_CONTRACT_CEILINGS.envelope_max_bytes, status: input.dry_run ? "dry_run_completed" : "completed", summary: `Projected ${state.operations.length} Automation row(s).`, data: resultData(input, projectedState) });
  const required = Buffer.byteLength(JSON.stringify(envelope), "utf8") + 1_024;
  if (required <= activeBudget) return null;
  return { code: "AUTOMATION_RESPONSE_BUDGET_EXCEEDED", message: `The compact ${state.operations.length}-row result needs about ${required} bytes but only ${activeBudget} are available; split the request or raise the response budget before mutation.`, recoverable: true, required_bytes: required };
}

function maintainProjectIndex(runtime, mode, state, now) {
  const completed = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation.status));
  const scopes = mode === "set_track_mode" ? ["tracks", "automation"] : ["automation"];
  if (completed.length === 0) return { ok: true, status: "skipped", message: "No completed mutation required index maintenance.", scopes: [] };
  if (!runtime || typeof runtime.invalidateScopes !== "function") return { ok: true, status: "skipped", message: "Project Index runtime was not attached; exact live readback remains authority.", scopes };
  try {
    const result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    if (result?.ok === false) {
      const first = result.blockers?.[0] ?? blocker("AUTOMATION_INDEX_MAINTENANCE_FAILED", "Automation index invalidation failed.");
      return { ok: false, status: "failed", code: first.code ?? "AUTOMATION_INDEX_MAINTENANCE_FAILED", message: first.message ?? "Automation index invalidation failed.", blockers: [first], scopes };
    }
    return { ok: true, status: "completed", message: `Invalidated affected ${scopes.join("/")} index scope(s).`, scopes };
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    return { ok: false, status: "failed", code: "AUTOMATION_INDEX_MAINTENANCE_FAILED", message: error?.message ?? "Automation index invalidation failed.", blockers: [blocker("AUTOMATION_INDEX_MAINTENANCE_FAILED", error?.message ?? "Automation index invalidation failed.")], scopes };
  }
}

function applyIndexMaintenance(changes, indexResult) {
  for (const change of changes) if (["completed", "unknown_or_partial"].includes(change.mutation.status)) change.index_maintenance = { status: indexResult.status, scopes: indexResult.scopes, ...(indexResult.code ? { blocker_code: indexResult.code } : {}) };
}

function successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status, summary, data }) {
  return finalizeEnvelope(buildSuccessEnvelope({ entry, request, startedAt, completedAt: safeNowIso(now), stages, state, activeBudget, status, summary, data }));
}

function buildSuccessEnvelope({ entry, request, startedAt, completedAt, stages, state, activeBudget, status, summary, data }) {
  return { contract: MACRO_EXECUTION_CONTRACT, ok: true, macro: macroIdentity(entry), request: requestSummary(request), execution: { status, started_at: startedAt, completed_at: completedAt, stage_count: stages.length, stages }, sqlite: state.sqlite ?? sqliteEvidence(), result: { summary, canonical_refs: uniqueStrings(state.canonicalRefs), changes: clone(state.changes), verification: { status: "passed", evidence_refs: uniqueStrings(state.evidenceRefs).slice(0, 8) }, data }, blockers: [], error: null, recovery: null, budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false } };
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "blocked", code, message, blockers = [], data = {} }) {
  const completed = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation.status));
  const verified = completed.length > 0 && completed.every((change) => change.live_readback.status === "passed");
  return finalizeEnvelope({ contract: MACRO_EXECUTION_CONTRACT, ok: false, macro: macroIdentity(entry), request: requestSummary(request, { forceNonDry: true }), execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages }, sqlite: state.sqlite ?? sqliteEvidence(), result: { summary: message, canonical_refs: uniqueStrings(state.canonicalRefs), changes: clone(state.changes), verification: { status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required", evidence_refs: status === "partial_failure" ? uniqueStrings(state.evidenceRefs).slice(0, 8) : [] }, data }, blockers: (blockers.length ? blockers : [blocker(code, message)]).slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count), error: { code, message, recoverable: true }, recovery: { undo_policy: REGISTRY_ENTRY.undo_policy, partial_changes_possible: status === "partial_failure", source_media_deleted: false, action: status === "partial_failure" ? "Keep verified live rows, inspect per-stage undo, refresh stale index scopes, then retry only unverified work." : "Fix the typed preflight blocker and retry the bounded exact-live request." }, budget: { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false } });
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  for (const change of result.result?.changes ?? []) {
    change.applied = change.status === "applied" && change.live_readback?.status === "passed";
  }
  for (let attempt = 0; attempt < 3; attempt += 1) result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.3-B1d automation.apply envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function resultData(input, state) {
  const completed = state.changes.filter((change) => ["completed", "unknown_or_partial"].includes(change.mutation.status));
  const passed = completed.filter((change) => change.live_readback.status === "passed");
  const indexStatuses = uniqueStrings(completed.map((change) => change.index_maintenance.status));
  return { mode: input.mode, supported_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES, held_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES, target_kind: state.targetKind, target_count: state.targetCount, exact_live_identity: true, sqlite_write_authority: false, undo_policy: REGISTRY_ENTRY.undo_policy, ...(state.confirmation ? { confirmation: clone(state.confirmation) } : {}), outcome: { mutation: { status: completed.some((change) => change.mutation.status === "unknown_or_partial") ? "unknown_or_partial" : completed.length ? "completed" : input.dry_run ? "not_run" : "not_completed", completed_count: completed.filter((change) => change.mutation.status === "completed").length, unknown_or_partial_count: completed.filter((change) => change.mutation.status === "unknown_or_partial").length, total_count: state.operations.length }, live_readback: { status: completed.length && passed.length === completed.length ? "passed" : passed.length ? "partial" : input.dry_run ? "not_run" : "not_passed", passed_count: passed.length, total_count: completed.length }, index_maintenance: { status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run", scopes: uniqueStrings(completed.flatMap((change) => change.index_maintenance.scopes)) } } };
}

function targetData(state) {
  return { target_kind: state.targetKind, target_count: state.targetCount, exact_live_identity: true, mutation: { occurred: false, changes: 0 } };
}

function createState() {
  return { targetKind: "unresolved", targetCount: 0, operations: [], changes: [], canonicalRefs: [], evidenceRefs: [], sqlite: null, confirmation: null };
}

function pendingChange(operation) {
  return { operation_id: operation.operation_id, template_id: operation.template_id, target_ref: operation.target_ref, mode: operation.mode, requested: clone(operation.requested), status: "pending", mutation: { status: "pending" }, live_readback: { status: "pending" }, index_maintenance: { status: "pending", scopes: [] } };
}

function previewChange(operation) {
  return { operation_id: operation.operation_id, template_id: operation.template_id, target_ref: operation.target_ref, mode: operation.mode, requested: clone(operation.requested), status: "planned", mutation: { status: "not_run" }, live_readback: { status: "not_run" }, index_maintenance: { status: "skipped", scopes: [] } };
}

function buildPointOverlay(before, requested) {
  for (let index = 0; index < requested.length; index += 1) {
    const firstIndex = requested.findIndex((point, prior) => prior < index && valuesMatch(point.time_seconds, requested[index].time_seconds));
    if (firstIndex >= 0) return failed("AUTOMATION_DUPLICATE_POINT_TIME", `points[${index}] collides with points[${firstIndex}] at the same normalized Envelope time; no points were inserted.`);
  }
  const expected = before
    .filter((point) => !requested.some((candidate) => valuesMatch(candidate.time_seconds, point.time_seconds)))
    .map(stripPointIndex);
  const replaced = before.length - expected.length;
  expected.push(...requested.map((point) => ({ ...point })));
  return {
    ok: true,
    expected,
    facts: {
      requested: requested.length,
      replaced,
      net_new: expected.length - before.length,
      before: before.length,
      after: expected.length,
    },
  };
}

function pointMultisetEquals(actual, expected) {
  if (actual.length !== expected.length) return false;
  const remaining = actual.map((point) => ({ ...point }));
  for (const point of expected) if (!removeMatchingPoint(remaining, point)) return false;
  return remaining.length === 0;
}

function stripPointIndex(point) {
  const { point_index: ignored, ...rest } = point;
  return rest;
}

function removeMatchingPoint(rows, expected) {
  const index = rows.findIndex((row) => pointMatches(row, expected));
  if (index < 0) return false;
  rows.splice(index, 1);
  return true;
}

function pointMatches(actual, expected) {
  return valuesMatch(actual.time_seconds, expected.time_seconds) && valuesMatch(actual.value, expected.value) && actual.shape === expected.shape && valuesMatch(actual.tension, expected.tension) && actual.selected === expected.selected;
}

function validateEnvelopePointValues(points, summary) {
  const min = summary.min_value;
  const max = summary.max_value;
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return failed("AUTOMATION_POINT_VALUE_DOMAIN_UNAVAILABLE", "Live Envelope readback did not expose a valid raw min/max value range.");
  if (summary.envelope_type === "mute" && points.some((point) => point.value !== 0 && point.value !== 1)) return failed("AUTOMATION_POINT_VALUE_OUT_OF_RANGE", "Mute Envelope raw point values must be exactly 0 or 1.");
  if (points.some((point) => point.value < min - EPSILON || point.value > max + EPSILON)) return failed("AUTOMATION_POINT_VALUE_OUT_OF_RANGE", `Envelope raw point values must stay within the live range ${min}..${max}.`);
  return { ok: true, range: { min, max } };
}

function normalizeReadPoint(value) {
  if (!isPlainObject(value) || !Number.isInteger(value.point_index) || !Number.isFinite(value.time_seconds) || !Number.isFinite(value.value) || !Number.isInteger(value.shape) || !Number.isFinite(value.tension) || typeof value.selected !== "boolean") return { ok: false };
  return { ok: true, value: { point_index: value.point_index, time_seconds: value.time_seconds, value: value.value, shape: value.shape, tension: value.tension, selected: value.selected } };
}

function normalizeAutomationItem(value) {
  if (!isPlainObject(value) || !Number.isInteger(value.automation_item_index) || !Number.isFinite(value.position_seconds) || !Number.isFinite(value.length_seconds) || !Number.isInteger(value.pool_id) || !Number.isFinite(value.start_offset_seconds) || !Number.isFinite(value.playrate) || !Number.isFinite(value.baseline) || !Number.isFinite(value.amplitude) || typeof value.loop_source !== "boolean" || typeof value.selected !== "boolean" || typeof value.muted !== "boolean") return { ok: false };
  return { ok: true, value: { automation_item_index: value.automation_item_index, position_seconds: value.position_seconds, length_seconds: value.length_seconds, pool_id: value.pool_id, start_offset_seconds: value.start_offset_seconds, playrate: value.playrate, baseline: value.baseline, amplitude: value.amplitude, loop_source: value.loop_source, selected: value.selected, muted: value.muted } };
}

function automationItemRowsMatchAfterDeletion(actual, expected) {
  if (actual.length !== expected.length) return false;
  return actual.every((row, index) => row.automation_item_index === index && automationItemIdentityMatches(row, expected[index]));
}

function automationItemIdentityMatches(actual, expected) {
  return valuesMatch(actual.position_seconds, expected.position_seconds)
    && valuesMatch(actual.length_seconds, expected.length_seconds)
    && actual.pool_id === expected.pool_id
    && valuesMatch(actual.start_offset_seconds, expected.start_offset_seconds)
    && valuesMatch(actual.playrate, expected.playrate)
    && valuesMatch(actual.baseline, expected.baseline)
    && valuesMatch(actual.amplitude, expected.amplitude)
    && actual.loop_source === expected.loop_source
    && actual.selected === expected.selected
    && actual.muted === expected.muted;
}

function normalizeStringArray(value, field, max) {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value) || value.length > max || value.some((entry) => typeof entry !== "string" || entry.length === 0)) return failed("AUTOMATION_REQUEST_INVALID", `${field} must contain at most ${max} non-empty strings.`);
  return { ok: true, value: [...value] };
}

function collectObjectRefs(value, kind) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (isPlainObject(entry)) {
      if (entry.kind === kind && typeof entry.ref === "string" && isPlainObject(entry.identity)) refs.push(entry);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  return refs;
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (isPlainObject(entry)) {
      if (typeof entry.kind === "string" && typeof entry.ref === "string" && isPlainObject(entry.identity)) refs.push(entry);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  return refs;
}

function isExactEnvelopeRef(value) {
  if (typeof value !== "string") return false;
  if (/^envelope:guid:.+/u.test(value)) return true;
  return /^envelope:track:track:(?:guid|index):.+:(?:volume|pan|mute)$/u.test(value)
    || /^envelope:(?:track|take|fx|send):.+:fingerprint:\d+$/u.test(value)
    || /^envelope:send:track:.+:\d+:(?:volume|pan|mute)$/u.test(value);
}

function isExactTrackRef(value) {
  return typeof value === "string" && /^track:guid:.+/u.test(value);
}

function isExactFxRef(value) {
  return typeof value === "string" && /^fx:(?:track|take):guid:.+:\d+$/u.test(value);
}

function fxObjectRef(ref) {
  const match = /^fx:(track|take):guid:(.+):(\d+)$/u.exec(ref);
  if (!match) throw new TypeError(`Invalid exact FX ref: ${ref}`);
  const ownerRef = `${match[1]}:guid:${match[2]}`;
  return createObjectRef("fx", { scheme: `${match[1]}_fx`, value: `${ownerRef}:${match[3]}` }, { ref });
}

function envelopeObjectRef(ref) {
  const match = /^envelope:([^:]+):(.+)$/u.exec(ref);
  if (!match) throw new TypeError(`Invalid Envelope ref: ${ref}`);
  return createObjectRef("envelope", { scheme: match[1], value: match[2] }, { ref });
}

function runAtomic(executeAtomic, request, child) {
  return executeAtomic({ ...child, context: request.context, budget: CHILD_BUDGET, observeProjectIndex: false });
}

function collectEvidence(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([execution?.request?.id, execution?.template?.id]));
}

function executionSummary(execution) {
  return { ...plainObject(execution?.result?.summary), ...plainObject(execution?.result?.readback) };
}

function valuesMatch(actual, expected) {
  return Number.isFinite(actual) && Number.isFinite(expected) && Math.abs(actual - expected) <= EPSILON;
}

function pick(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function atomicFailure(execution, templateId) {
  const code = execution?.error?.code ?? "AUTOMATION_ATOMIC_FAILED";
  const message = execution?.error?.message ?? `${templateId} failed.`;
  return failed(code, message, [blocker(code, message, execution?.error?.recoverable !== false)]);
}

function executionError(error, templateId, phase) {
  const message = error?.message ?? `${templateId} threw during execution.`;
  return { ...failed("AUTOMATION_ATOMIC_FAILED", message), phase };
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const row = stage(id, kind, status, summary, uniqueStrings(evidenceRefs).slice(0, 4));
  const index = stages.findIndex((entry) => entry.id === id);
  if (index >= 0) stages[index] = row;
  else stages.push(row);
}

function stage(id, kind, status, summary, evidence_refs = []) {
  return { id, kind, status, summary, evidence_refs };
}

function requestSummary(request, { forceNonDry = false } = {}) {
  return { request_id: typeof request?.context?.request_id === "string" ? request.context.request_id : `${ALPHA3_3_B1D_AUTOMATION_APPLY_MACRO_ID}:request`, dry_run: forceNonDry ? false : request?.input?.dry_run !== false };
}

function responseBudget(request) {
  const requested = request?.budget?.max_response_bytes ?? request?.response_budget ?? MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  return Number.isInteger(requested) && requested >= MIN_RESPONSE_BUDGET && requested <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes ? requested : MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
}

function macroIdentity(entry) {
  return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk };
}

function sqliteEvidence(runtime, { used = false, freshness = "not_applicable" } = {}) {
  if (!used) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  let status = {};
  try { status = runtime?.status?.() ?? {}; } catch { status = {}; }
  return { used: true, source: "warm_index", freshness, snapshot_ref: typeof status.snapshot_id === "string" ? status.snapshot_id : null, revision: status.revision === null || status.revision === undefined ? null : String(status.revision), refreshed: false };
}

function blocker(code, message, recoverable = true) {
  return { code, message, recoverable };
}

function failed(code, message, blockers = [blocker(code, message)]) {
  return { ok: false, code, message, blockers };
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
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
