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
  "set_lane_state",
  "set_track_mode",
  "create_automation_item",
  "set_automation_item_bounds",
  "delete_point",
  "delete_point_range",
]);
export const ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES = deepFreeze([
  "delete_automation_item",
  "insert_take_points",
  "insert_take_fx_parameter_points",
  "insert_fx_parameter_points",
  "create_envelope",
  "set_send_mode",
  "draw_sine",
]);
export const ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS = deepFreeze([
  "template.tracks.resolve_track_ref",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.set_envelope_point",
  "template.automation.set_envelope_lane_state",
  "template.automation.insert_envelope_points_batch",
  "template.automation.delete_envelope_points",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
]);

const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const READ_ENVELOPE_ID = "template.automation.read_envelope_summary";
const READ_POINTS_ID = "template.automation.read_envelope_points";
const SET_POINT_ID = "template.automation.set_envelope_point";
const SET_LANE_ID = "template.automation.set_envelope_lane_state";
const INSERT_POINTS_ID = "template.automation.insert_envelope_points_batch";
const DELETE_POINTS_ID = "template.automation.delete_envelope_points";
const SET_TRACK_MODE_ID = "template.automation.set_track_automation_mode";
const READ_TRACK_MODE_ID = "template.automation.read_track_automation_mode";
const READ_AUTOMATION_ITEMS_ID = "template.automation.read_automation_items";
const CREATE_AUTOMATION_ITEM_ID = "template.automation.create_automation_item";
const SET_AUTOMATION_ITEM_BOUNDS_ID = "template.automation.set_automation_item_bounds";
const MAX_TARGETS = 8;
const MAX_NEW_POINTS = 32;
const MAX_COMPLETE_READ_POINTS = 64;
const MAX_AUTOMATION_ITEMS = 64;
const EPSILON = 0.000001;
const MIN_RESPONSE_BUDGET = 2_048;
const DESTRUCTIVE_MODES = new Set(["delete_point", "delete_point_range"]);
const NON_IDEMPOTENT_MODES = new Set(["insert_points", "create_automation_item", ...DESTRUCTIVE_MODES]);
const INPUT_FIELDS = new Set([
  "mode",
  "envelope_refs",
  "track_refs",
  "points",
  "point_update",
  "point_delete",
  "point_range",
  "lane_state",
  "track_mode",
  "automation_item",
  "automation_item_bounds",
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
  program_version: "1.0.0",
  implementation_status: "executable",
  risk: "write",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES },
      envelope_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      track_refs: { type: "array", maxItems: MAX_TARGETS, items: { type: "string" } },
      points: { type: "array", maxItems: MAX_NEW_POINTS },
      point_update: { type: "object" },
      point_delete: { type: "object" },
      point_range: { type: "object" },
      lane_state: { type: "object" },
      track_mode: { type: "string", enum: ["trim_read", "read"] },
      automation_item: { type: "object" },
      automation_item_bounds: { type: "object" },
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
    identity_fields: ["envelope_ref", "track_ref"],
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
    summary: "Insert/update/delete bounded Envelope points, set proven lane or Track modes, and create or move existing Automation Items on exact live targets.",
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES,
    held_modes: ALPHA3_3_B1D_AUTOMATION_APPLY_HELD_MODES,
    limits: { envelope_targets: MAX_TARGETS, track_targets: MAX_TARGETS, total_inserted_points: MAX_NEW_POINTS },
    examples: [
      { name: "preview_volume_ramp", input: { mode: "insert_points", envelope_refs: ["envelope:guid:{ENVELOPE-GUID}"], points: [{ time_seconds: 0, value: 0.25 }, { time_seconds: 2, value: 1 }], dry_run: true } },
      { name: "preview_point_delete", input: { mode: "delete_point", envelope_refs: ["envelope:guid:{ENVELOPE-GUID}"], point_delete: { autoitem_index: -1, point_index: 2 } } },
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
        "Use insert_points or update_point for raw-value points on an existing exact Envelope when its complete lane remains within 64 points.",
        "Use set_lane_state only when the live bridge proves BR/SWS Envelope properties are available.",
        "Use set_track_mode for trim_read or read; create_automation_item for a new empty Automation Item; or set_automation_item_bounds for existing Item position/length.",
        "Use delete_point or delete_point_range only through dry-run preview followed by the exact returned confirmation_token retry.",
      ],
      when_not_to_use: [
        "Do not use this slice for Automation Item deletion, Take/Take-FX Automation, missing Envelope creation, FX-parameter Envelope creation, real-time touch/write/latch modes, or model-supplied steps.",
        "Do not guess semantic dB/pan/plugin values: insert_points accepts already-known raw REAPER Envelope values only, and negative Pan Automation is held because the accepted atom clamps values below zero.",
      ],
      required_readiness: [
        "Prefer canonical envelope:guid:{GUID} refs from live inventory. Older exact track/send or fingerprint refs are hidden compatibility inputs only and are never taught as the default.",
        "Provide at most eight exact Envelope refs or at most eight exact Track GUID refs; ambiguous discovery is not accepted here.",
        "The Macro resolves and reads every exact target from REAPER live. SQLite may be absent or stale and is never write authority.",
      ],
      input_shape: {
        mode: ALPHA3_3_B1D_AUTOMATION_APPLY_MODES.join(" | "),
        envelope_refs: "Existing exact Envelope refs; canonical envelope:guid:{GUID} is preferred.",
        track_refs: "Exact track:guid refs for set_track_mode.",
        points: "For insert_points: 1-32 raw points; total points across all target Envelopes must be <=32.",
        lane_state: "For set_lane_state: one or more booleans from active, armed, visible, show_lane.",
        point_update: "For update_point: autoitem_index (default -1), exact point_index, and at least one updated point field.",
        point_delete: "For delete_point: autoitem_index (default -1) and exact point_index.",
        point_range: "For delete_point_range: autoitem_index (default -1), start_seconds, end_seconds; deletion is half-open [start,end).",
        track_mode: "trim_read | read. Real-time touch/write/latch modes are held.",
        automation_item: "For create_automation_item: position_seconds>=0, length_seconds>0, pool_mode=new_empty.",
        automation_item_bounds: "For set_automation_item_bounds: exact automation_item_index plus position_seconds and/or length_seconds. Offset/playrate remain held until independently readable.",
        dry_run: "Defaults to true.",
        confirmation_token: "Destructive retry string returned by the immediately preceding dry-run preview. Boolean confirmation is insufficient.",
      },
      preflight_steps: [
        "Reject held modes, non-exact targets, oversized point work, unsupported value domains, incomplete point/Automation Item readback, stale/missing destructive tokens, and response-budget overflow before mutation.",
        "Resolve exact refs live and capture complete pre-mutation facts without consulting SQLite identity.",
      ],
      underlying_actions: ALPHA3_3_B1D_AUTOMATION_APPLY_TEMPLATE_IDS,
      readback_steps: [
        "insert_points/update_point/delete_point/delete_point_range compare complete pre/post point tuples and counts; half-open range readback proves [start,end) absence while preserving end_seconds points.",
        "set_lane_state re-reads exact BR/SWS-backed state, set_track_mode calls the native read Template, and Automation Item modes independently read exact live Item rows.",
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
        blocker("AUTOMATION_TAKE_ROUTE_MISSING", "Ordinary Take and Take-FX parameter Envelope write routes are not accepted."),
        blocker("AUTOMATION_ENVELOPE_CREATE_MISSING", "Safe create-if-missing Envelope behavior is not accepted."),
        blocker("AUTOMATION_COMPLETE_READBACK_REQUIRED", "This Macro requires one complete <=64-point lane for independent tuple/count verification."),
        blocker("AUTOMATION_LANE_BR_REQUIRED", "Lane-state truth requires working BR/SWS Envelope property APIs."),
      ],
      recovery_steps: [
        "Use exact refs from a live read, reduce targets/points to the reported bound, or split the request before retrying.",
        "For Automation Item deletion, Take/Take-FX, create-if-missing, FX-parameter, start-offset, or playrate work, wait for the named accepted atomic repair/read route; do not use raw Actions or chunk edits.",
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
  if (input.mode === "set_lane_state") {
    const read = await readEnvelopeSummary({ request, executeAtomic, state, envelopeRef });
    if (!read.ok) return read;
    if (read.summary.br_available !== true) return failed("AUTOMATION_LANE_BR_REQUIRED", `Envelope ${envelopeRef.ref} cannot prove BR/SWS-backed lane state.`);
    return { ok: true, operation: { template_id: SET_LANE_ID, input: input.lane_state, requested: clone(input.lane_state), before: pick(read.summary, Object.keys(input.lane_state)) } };
  }
  if (input.mode === "insert_points") {
    const before = await readCompletePoints({ request, executeAtomic, state, envelopeRef, autoitemIndex: -1 });
    if (!before.ok) return before;
    if (before.summary.envelope_type === "pan") return failed("AUTOMATION_POINT_VALUE_DOMAIN_UNSUPPORTED", "Pan Envelope point insertion is held because the accepted atom does not prove the full negative raw-value domain.");
    if (before.summary.envelope_type === "mute" && input.points.some((point) => point.value !== 0 && point.value !== 1)) return failed("AUTOMATION_POINT_VALUE_DOMAIN_UNSUPPORTED", "Mute Envelope raw point values must be exactly 0 or 1.");
    if (before.points.length + input.points.length > MAX_COMPLETE_READ_POINTS) return failed("AUTOMATION_COMPLETE_READBACK_REQUIRED", `Envelope ${envelopeRef.ref} would exceed the complete ${MAX_COMPLETE_READ_POINTS}-point readback boundary.`);
    return { ok: true, operation: { template_id: INSERT_POINTS_ID, input: { autoitem_index: -1, points: input.points }, requested: { autoitem_index: -1, point_count: input.points.length, first_time_seconds: input.points[0].time_seconds, last_time_seconds: input.points.at(-1).time_seconds }, autoitem_index: -1, before_points: before.points } };
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

async function executeOperations({ request, executeAtomic, state }) {
  for (const operation of state.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
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

async function verifyOperation({ operation, request, executeAtomic, state }) {
  if (operation.mode === "insert_points") {
    const after = await readCompletePoints({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref, autoitemIndex: operation.autoitem_index });
    if (!after.ok) return { ...after, source: "live_envelope_points" };
    if (after.points.length !== operation.before_points.length + operation.input.points.length || !pointMultisetDeltaMatches(operation.before_points, after.points, operation.input.points)) return failed("AUTOMATION_READBACK_MISMATCH", `Exact point readback did not prove all inserted points on ${operation.target_ref}.`, [blocker("AUTOMATION_READBACK_MISMATCH", "Complete pre/post point multisets did not match the requested insertion.")]);
    return { ok: true, source: "live_envelope_points", facts: { inserted_count: operation.input.points.length, total_count: after.points.length } };
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
  if (operation.mode === "set_lane_state") {
    const after = await readEnvelopeSummary({ request, executeAtomic, state, envelopeRef: operation.refs.envelope_ref });
    if (!after.ok || after.summary.br_available !== true || !objectFieldsMatch(after.summary, operation.input)) return failed("AUTOMATION_READBACK_MISMATCH", `Exact lane-state readback did not match ${operation.target_ref}.`);
    return { ok: true, source: "live_envelope_summary", facts: clone(operation.input) };
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
  const mode = input.mode === "delete_points" ? "delete_point" : input.mode;
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
  const normalized = { mode, envelope_refs: envelopeRefs.value, track_refs: trackRefs.value, points: null, point_update: null, point_delete: null, point_range: null, lane_state: null, track_mode: null, automation_item: null, automation_item_bounds: null, dry_run: input.dry_run !== false, confirmation_token: input.confirmation_token ?? null };
  if (mode === "insert_points") {
    const points = normalizePoints(input.points);
    if (!points.ok) return points;
    normalized.points = points.value;
    if (hasAny(input, ["point_update", "point_delete", "point_range", "lane_state", "track_mode", "automation_item", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "insert_points accepts only Envelope targets and points.");
  } else if (mode === "update_point") {
    const update = normalizePointUpdate(input.point_update);
    if (!update.ok) return update;
    normalized.point_update = update.value;
    if (hasAny(input, ["points", "point_delete", "point_range", "lane_state", "track_mode", "automation_item", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "update_point accepts only Envelope targets and point_update.");
  } else if (mode === "delete_point") {
    const deletion = normalizePointDelete(input.point_delete);
    if (!deletion.ok) return deletion;
    normalized.point_delete = deletion.value;
    if (hasAny(input, ["points", "point_update", "point_range", "lane_state", "track_mode", "automation_item", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "delete_point accepts only Envelope targets, point_delete, and confirmation_token.");
  } else if (mode === "delete_point_range") {
    const range = normalizePointRange(input.point_range);
    if (!range.ok) return range;
    normalized.point_range = range.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "lane_state", "track_mode", "automation_item", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "delete_point_range accepts only Envelope targets, point_range, and confirmation_token.");
  } else if (mode === "set_lane_state") {
    const lane = normalizeLaneState(input.lane_state);
    if (!lane.ok) return lane;
    normalized.lane_state = lane.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "track_mode", "automation_item", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "set_lane_state accepts only Envelope targets and lane_state.");
  } else if (mode === "set_track_mode") {
    if (!["trim_read", "read"].includes(input.track_mode)) return failed(["touch", "write", "latch", "latch_preview"].includes(input.track_mode) ? "AUTOMATION_REALTIME_MODE_HELD" : "AUTOMATION_TRACK_MODE_INVALID", "set_track_mode supports only trim_read or read; real-time touch/write/latch modes are held.");
    normalized.track_mode = input.track_mode;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "lane_state", "automation_item", "automation_item_bounds"]) || envelopeRefs.value.length > 0 || input.confirmation_token !== undefined) return failed("AUTOMATION_REQUEST_INVALID", "set_track_mode accepts only Track targets and track_mode.");
  } else if (mode === "create_automation_item") {
    const automationItem = normalizeCreateAutomationItem(input.automation_item);
    if (!automationItem.ok) return automationItem;
    normalized.automation_item = automationItem.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "lane_state", "track_mode", "automation_item_bounds"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "create_automation_item accepts only Envelope targets and automation_item.");
  } else {
    const bounds = normalizeAutomationItemBounds(input.automation_item_bounds);
    if (!bounds.ok) return bounds;
    normalized.automation_item_bounds = bounds.value;
    if (hasAny(input, ["points", "point_update", "point_delete", "point_range", "lane_state", "track_mode", "automation_item"]) || trackRefs.value.length > 0) return failed("AUTOMATION_REQUEST_INVALID", "set_automation_item_bounds accepts only Envelope targets and automation_item_bounds.");
  }
  if (!DESTRUCTIVE_MODES.has(mode) && input.confirmation_token !== undefined) return failed("AUTOMATION_REQUEST_INVALID", "confirmation_token is valid only for destructive point deletion modes.");
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
    if (!Number.isFinite(time) || time < 0 || !Number.isFinite(rawValue) || rawValue < 0 || rawValue > 4 || !Number.isInteger(shape) || shape < 0 || shape > 5 || !Number.isFinite(tension) || tension < -1 || tension > 1 || typeof selected !== "boolean") return failed("AUTOMATION_POINTS_INVALID", `points[${index}] must use time>=0, raw value 0..4, shape 0..5, tension -1..1, and boolean selected.`);
    points.push({ time_seconds: time, value: rawValue, shape, tension, selected });
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
  if (Object.hasOwn(value, "start_offset_seconds") || Object.hasOwn(value, "playrate")) return failed("AUTOMATION_ITEM_BOUNDS_FIELD_HELD", "start_offset_seconds and playrate remain held because read_automation_items does not independently expose them.");
  const unknown = Object.keys(value).filter((field) => !["automation_item_index", "position_seconds", "length_seconds"].includes(field));
  if (unknown.length > 0 || !Number.isInteger(value.automation_item_index) || value.automation_item_index < 0) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "automation_item_bounds requires a non-negative automation_item_index and only position_seconds/length_seconds fields.");
  if (value.position_seconds === undefined && value.length_seconds === undefined) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "automation_item_bounds requires position_seconds and/or length_seconds.");
  if (value.position_seconds !== undefined && (!Number.isFinite(value.position_seconds) || value.position_seconds < 0)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "position_seconds must be finite and non-negative.");
  if (value.length_seconds !== undefined && (!Number.isFinite(value.length_seconds) || value.length_seconds <= 0)) return failed("AUTOMATION_ITEM_BOUNDS_INVALID", "length_seconds must be finite and positive.");
  return { ok: true, value: clone(value) };
}

function hasAny(value, fields) {
  return fields.some((field) => value[field] !== undefined);
}

function normalizeLaneState(value) {
  if (!isPlainObject(value) || Object.keys(value).length < 1) return failed("AUTOMATION_LANE_STATE_REQUIRED", "set_lane_state requires at least one lane_state field.");
  const unknown = Object.keys(value).filter((field) => !["active", "armed", "visible", "show_lane"].includes(field));
  if (unknown.length > 0 || Object.values(value).some((entry) => typeof entry !== "boolean")) return failed("AUTOMATION_LANE_STATE_INVALID", "lane_state accepts only boolean active, armed, visible, and show_lane fields.");
  return { ok: true, value: clone(value) };
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
    ...(input.mode === "delete_point" ? { point_delete: clone(input.point_delete) } : { point_range: clone(input.point_range) }),
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

function pointMultisetDeltaMatches(before, after, requested) {
  const remaining = after.map((point) => ({ ...point }));
  for (const point of before) if (!removeMatchingPoint(remaining, point)) return false;
  if (remaining.length !== requested.length) return false;
  for (const point of requested) if (!removeMatchingPoint(remaining, point)) return false;
  return remaining.length === 0;
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

function normalizeReadPoint(value) {
  if (!isPlainObject(value) || !Number.isInteger(value.point_index) || !Number.isFinite(value.time_seconds) || !Number.isFinite(value.value) || !Number.isInteger(value.shape) || !Number.isFinite(value.tension) || typeof value.selected !== "boolean") return { ok: false };
  return { ok: true, value: { point_index: value.point_index, time_seconds: value.time_seconds, value: value.value, shape: value.shape, tension: value.tension, selected: value.selected } };
}

function normalizeAutomationItem(value) {
  if (!isPlainObject(value) || !Number.isInteger(value.automation_item_index) || !Number.isFinite(value.position_seconds) || !Number.isFinite(value.length_seconds) || !Number.isInteger(value.pool_id)) return { ok: false };
  return { ok: true, value: { automation_item_index: value.automation_item_index, position_seconds: value.position_seconds, length_seconds: value.length_seconds, pool_id: value.pool_id } };
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

function objectFieldsMatch(actual, expected) {
  return Object.entries(expected).every(([field, value]) => actual[field] === value);
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
