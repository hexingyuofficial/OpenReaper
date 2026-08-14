import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID = "macro.items.analyze";
export const ALPHA3_3_B1B_ITEMS_ANALYZE_CONTRACT = "alpha3.3.b1b.items_analyze.v1";
export const ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES = deepFreeze([
  "quick",
  "audio",
  "timing",
  "full",
]);
export const ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS = deepFreeze([
  "template.analysis.analyze_items_batch",
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.list_selected_items",
  "template.analysis.measure_item_rms",
  "template.analysis.measure_item_peaks",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
]);

const RESOLVE_ITEM_ID = "template.items.resolve_item_ref";
const ANALYZE_BATCH_ID = "template.analysis.analyze_items_batch";
const READ_ITEM_ID = "template.items.read_item_summary";
const LIST_SELECTED_ID = "template.items.list_selected_items";
const RMS_ID = "template.analysis.measure_item_rms";
const PEAKS_ID = "template.analysis.measure_item_peaks";
const SILENCE_ID = "template.analysis.detect_item_silence";
const TRANSIENTS_ID = "template.analysis.detect_item_transients";
const MAX_TARGETS = 128;
const INLINE_ITEM_SAMPLE_MAX = 8;
const INPUT_FIELDS = new Set([
  "profile",
  "target",
  "target_refs",
  "range",
  "limit",
  "channel_policy",
  "output",
]);
const CHILD_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: 128,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});
const PROFILE_TEMPLATES = deepFreeze({
  quick: [],
  audio: [RMS_ID, PEAKS_ID],
  timing: [SILENCE_ID, TRANSIENTS_ID],
  full: [RMS_ID, PEAKS_ID, SILENCE_ID, TRANSIENTS_ID],
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
  program_id: "openreaper.macro.items.analyze",
  program_version: "1.0.0",
  implementation_status: "executable",
  risk: "read",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      profile: { type: "string", enum: ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES },
      target: { type: "string", enum: ["selected"] },
      target_refs: { type: "array", maxItems: MAX_TARGETS },
      range: { type: "object" },
      limit: { type: "integer", minimum: 1, maximum: MAX_TARGETS },
      channel_policy: { type: "string", enum: ["combined"] },
      output: { type: "string", enum: ["compact", "artifact_when_large"] },
    },
    required: [],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: true,
    live_reresolve_before_write: false,
  },
  sqlite_policy: {
    mode: "not_used",
    write_authority: false,
    identity_fields: [],
  },
  dependencies: {
    template_ids: ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS,
    runtime_capabilities: [],
  },
  stages: [
    { id: "items-analyze-targets", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "items-analyze-read-facts", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: READ_ITEM_ID },
    { id: "items-analyze-measure", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: RMS_ID },
    { id: "items-analyze-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "not_required",
  verification_policy: "not_required",
  dry_run_supported: false,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3B1bItemsAnalyzeRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY = createAlpha3_3B1bItemsAnalyzeRegistry();

export function isAlpha3_3B1bItemsAnalyzeMacroId(id) {
  return id === ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID;
}

export function createAlpha3_3B1bItemsAnalyzeDiscoveryItems({ liveRunnableNow = false } = {}) {
  return deepFreeze([{
    id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
    title: "Analyze selected or exact Items",
    user_label: "Analyze Items",
    pack: "core",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "macro.items.analysis",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "items_analyze",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable",
    support_state: "supported_with_live_facts",
    live_runnable_now: liveRunnableNow,
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    summary: "Read compact Item/take facts and native-backed RMS/LUFS-I, peak/true-peak availability, silence, or transient measurements for selected or exact Items.",
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_profiles: ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES,
    held_profiles: ["compare", "midi", "loop"],
    examples: [
      { name: "quick_selected_items", input: { profile: "quick", target: "selected", limit: 4 } },
      { name: "audio_selected_item", input: { profile: "audio", target_refs: ["selected:0"], output: "artifact_when_large" } },
    ],
  }]);
}

export function createAlpha3_3B1bItemsAnalyzeExactManual() {
  return deepFreeze({
    id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
    rollout_slice: "Alpha3.3-B1b",
    action_manual: {
      when_to_use: [
        "Read one bounded result for selected or exact Items without changing the REAPER project.",
        "Use quick for Item/take state, audio for source-level RMS/LUFS-I plus native peak facts, timing for pre-FX silence/transients, or full for all currently proven facts.",
      ],
      when_not_to_use: [
        "Do not request compare, MIDI-summary, loop, phase-correlation, or post-FX audible claims before those modes are accepted; true peak is returned only when REAPER's native source calculation succeeds.",
        "Do not use this read Macro to normalize, trim, split, move, or otherwise mutate Items.",
      ],
      required_readiness: [
        "The managed OpenReaper live bridge must be connected.",
        "Use selected Items or provide at most 128 exact/canonical Item refs or resolvable selected/index/guid tokens.",
      ],
      input_shape: {
        profile: "quick | audio | timing | full; defaults to quick.",
        target: "selected; used when no exact refs or target_refs are supplied.",
        target_refs: "Optional array of at most 128 canonical Item refs or selected/index/guid tokens.",
        refs: "Optional call_template refs.item_ref or refs.item_refs object refs.",
        range: "Optional item-local {start_seconds,end_seconds}; valid only for audio, timing, and full.",
        limit: "1-128; defaults to 4 for selected Items.",
        channel_policy: "combined only in B1b.",
        output: "compact | artifact_when_large; large native batches return bounded inline samples plus the complete exact Item-ref list.",
      },
      preflight_steps: [
        "Validate profile, range, target count, and combined-channel policy before any live child call.",
        "Resolve the complete selected or exact target set inside one accepted native analysis batch.",
      ],
      underlying_actions: ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS,
      readback_steps: [
        "Read an exact Item summary for every returned target in one aggregate Bridge response.",
        "For each requested metric, require a matching item_ref, measurement_basis, analyzed range, and coverage/truncation facts.",
      ],
      success_criteria: [
        "Every returned row is bound to a canonical live Item ref and contains no mutation changes.",
        "Measurement families report their basis and never relabel source normalization or pre-FX samples as post-FX audible loudness.",
        "Selected-target truncation is explicit; exact target overflow fails before analysis instead of silently dropping Items.",
      ],
      common_blockers: [
        blocker("ITEM_ANALYSIS_TARGETS_EMPTY", "No selected or exact Item target could be resolved."),
        blocker("ITEM_ANALYSIS_PROFILE_UNSUPPORTED", "The requested profile is not executable in Alpha3.3-B1b."),
        blocker("ITEM_ANALYSIS_MEASUREMENT_BASIS_MISSING", "A metric result did not identify what REAPER state or samples were measured."),
        blocker("ITEM_ANALYSIS_ATOMIC_FAILED", "One accepted Item read or analysis Template failed."),
      ],
      recovery_steps: [
        "Select one or more Items, or retry with exact Item refs returned by project.inspect/query.",
        "For held profiles, use only an explicitly discovered direct Template fallback with a typed gap reason.",
      ],
      dry_run_shape: {
        supported: false,
        behavior: "The Macro is read-only and executes bounded live reads directly.",
        output: ["macro_execution", "bounded_item_samples", "complete_item_refs", "measurement_basis", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "target resolution for the same live bridge generation",
        retry: "Retry once after fixing the typed target, readiness, or range blocker.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
      examples: [
        { name: "quick selected", input: { profile: "quick", target: "selected", limit: 4 } },
        { name: "full exact", input: { profile: "full", target_refs: ["selected:0"], range: { start_seconds: 0, end_seconds: 8 }, output: "artifact_when_large" } },
      ],
    },
  });
}

export async function executeAlpha3_3B1bItemsAnalyzeMacro({
  request = {},
  executeAtomic,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY.get(ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const normalized = normalizeInput(request.input);
  if (!normalized.ok) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  }

  const programRequest = {
    macro_id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
    input: normalized.input,
    refs: request.refs ?? {},
    dry_run: false,
  };
  const validation = validateMacroProgramRequest(programRequest, {
    registry: ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY,
  });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "ITEM_ANALYSIS_REQUEST_INVALID", message, blockers: validation.errors.map((error) => blocker("ITEM_ANALYSIS_REQUEST_INVALID", error)) });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, code: "ITEM_ANALYSIS_LIVE_EXECUTOR_REQUIRED", message: "macro.items.analyze requires the managed OpenReaper live executor." });
  }

  const execution = await executeAtomic({
    id: ANALYZE_BATCH_ID,
    input: compactObject({
      profile: normalized.input.profile,
      target: normalized.input.target_refs.length > 0 || collectItemObjectRefs(request.refs).length > 0 ? "exact" : "selected",
      target_refs: normalized.input.target_refs,
      limit: normalized.input.limit,
      ...rangeInput(normalized.input.range),
    }),
    refs: request.refs ?? {},
    budget: CHILD_BUDGET,
  });
  collectExecutionEvidence(state, execution);
  if (execution?.ok !== true) {
    const failure = atomicFailure(execution, ANALYZE_BATCH_ID);
    pushStage(stages, "items-analyze-targets", "live_ref_resolve", "blocked", failure.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, code: failure.code, message: failure.message, blockers: failure.blockers, data: targetCoverageData(state) });
  }
  const summary = executionSummary(execution);
  const rows = Array.isArray(summary.items) ? summary.items : [];
  const itemRefs = uniqueStrings(Array.isArray(summary.item_refs) ? summary.item_refs : rows.map((row) => row?.item_ref));
  const targetCount = integerOr(summary.target_count, rows.length);
  const expectedSamples = Math.min(targetCount, INLINE_ITEM_SAMPLE_MAX);
  if (targetCount < 1 || rows.length !== expectedSamples || itemRefs.length !== targetCount || targetCount > MAX_TARGETS) {
    const failure = failed("ITEM_ANALYSIS_BATCH_READBACK_INVALID", "Native Item analysis batch did not return complete exact refs and the bounded row sample.");
    pushStage(stages, "items-analyze-targets", "live_ref_resolve", "failed", failure.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, code: failure.code, message: failure.message, blockers: failure.blockers, data: targetCoverageData(state) });
  }
  state.targetScope = summary.target_scope === "selected" ? "selected" : "exact";
  state.totalTargetCount = targetCount;
  state.returnedTargetCount = targetCount;
  state.targetsTruncated = false;
  state.rows = rows.map((row) => clone(row));
  state.itemRefs = itemRefs;
  state.batchTimings = isPlainObject(summary.batch_timings) ? clone(summary.batch_timings) : {};
  state.canonicalRefs.push(...itemRefs);
  pushStage(stages, "items-analyze-targets", "live_ref_resolve", "completed", `Resolved ${targetCount} exact Item target(s) inside one native batch.`, state.evidenceRefs);

  pushStage(stages, "items-analyze-read-facts", "template_execute", "completed", `Read ${state.rows.length} exact Item summary row(s).`, state.evidenceRefs);
  if (PROFILE_TEMPLATES[normalized.input.profile].length > 0) {
    pushStage(stages, "items-analyze-measure", "template_execute", "completed", `Completed ${PROFILE_TEMPLATES[normalized.input.profile].length} requested metric family/families per Item in the same native batch.`, state.evidenceRefs);
  } else {
    pushStage(stages, "items-analyze-measure", "template_execute", "skipped", "profile=quick requires no audio metric Template.", []);
  }
  pushStage(stages, "items-analyze-result", "result_project", "completed", "Projected compact Item analysis facts and artifact refs.", state.evidenceRefs);

  return successEnvelope({
    entry,
    request,
    startedAt,
    now,
    stages,
    state,
    summary: `Analyzed ${state.rows.length} Item(s) with profile=${normalized.input.profile}.`,
    data: resultData(normalized.input, state),
  });
}

async function resolveTargets({ request, input, executeAtomic, state }) {
  const directRefs = collectItemObjectRefs(request.refs);
  const tokens = input.target_refs;
  if (directRefs.length + tokens.length > input.limit || directRefs.length + tokens.length > MAX_TARGETS) {
    return failed("ITEM_ANALYSIS_TARGET_LIMIT_EXCEEDED", `Exact Item targets exceed the bounded limit of ${input.limit}.`);
  }

  const resolved = [...directRefs];
  for (const token of tokens) {
    const execution = await executeAtomic({ id: RESOLVE_ITEM_ID, input: { ref: token }, refs: [], budget: CHILD_BUDGET });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(execution).find((ref) => ref.kind === "item");
    if (!itemRef) return failed("ITEM_ANALYSIS_TARGET_NOT_FOUND", `Item target ${token} did not resolve to a canonical Item ref.`);
    resolved.push(itemRef);
  }

  if (resolved.length === 0) {
    const execution = await executeAtomic({ id: LIST_SELECTED_ID, input: { limit: input.limit, include_track_refs: true }, refs: [], budget: CHILD_BUDGET });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, LIST_SELECTED_ID);
    const summary = executionSummary(execution);
    state.targetScope = "selected";
    state.totalTargetCount = integerOr(summary.selected_count, 0);
    state.targetsTruncated = summary.truncated === true || state.totalTargetCount > input.limit;
    resolved.push(...executionObjectRefs(execution).filter((ref) => ref.kind === "item").slice(0, input.limit));
  } else {
    state.targetScope = directRefs.length > 0 && tokens.length > 0 ? "mixed_exact" : "exact";
    state.totalTargetCount = resolved.length;
    state.targetsTruncated = false;
  }

  const uniqueRefs = uniqueObjectRefs(resolved).slice(0, MAX_TARGETS);
  if (uniqueRefs.length === 0) return failed("ITEM_ANALYSIS_TARGETS_EMPTY", "No selected or exact Item target could be resolved.");
  state.returnedTargetCount = uniqueRefs.length;
  return { ok: true, refs: uniqueRefs };
}

async function analyzeOneItem({ itemRef, index, input, executeAtomic, state }) {
  const summaryExecution = await executeAtomic({
    id: READ_ITEM_ID,
    input: { include_take_summary: true },
    refs: { item_ref: itemRef },
    budget: CHILD_BUDGET,
  });
  collectExecutionEvidence(state, summaryExecution);
  if (summaryExecution?.ok !== true) return atomicFailure(summaryExecution, READ_ITEM_ID);
  const itemSummary = executionSummary(summaryExecution);
  if (itemSummary.item_ref !== itemRef.ref) {
    return failed("ITEM_ANALYSIS_TARGET_MISMATCH", `Item summary ${index + 1} did not round-trip the exact requested item_ref.`);
  }

  const row = {
    item_ref: itemSummary.item_ref,
    track_ref: stringOrNull(itemSummary.track_ref),
    active_take_ref: stringOrNull(itemSummary.active_take_ref),
    take_count: integerOr(itemSummary.take_count, 0),
    placement: compactObject({
      position_seconds: finiteOrNull(itemSummary.position_seconds),
      length_seconds: finiteOrNull(itemSummary.length_seconds),
      end_seconds: finiteOrNull(itemSummary.position_seconds) !== null && finiteOrNull(itemSummary.length_seconds) !== null
        ? itemSummary.position_seconds + itemSummary.length_seconds
        : null,
      snap_offset_seconds: finiteOrNull(itemSummary.snap_offset_seconds),
      fade_in_seconds: finiteOrNull(itemSummary.fade_in_seconds),
      fade_out_seconds: finiteOrNull(itemSummary.fade_out_seconds),
    }),
    take: compactObject({
      name: stringOrNull(itemSummary.active_take_name),
      source_offset_seconds: finiteOrNull(itemSummary.start_offset_seconds),
      volume_db: finiteOrNull(itemSummary.take_volume_db),
      pan: finiteOrNull(itemSummary.take_pan),
      channel_mode: stringOrNull(itemSummary.channel_mode),
      reverse: booleanOrNull(itemSummary.reverse),
      pitch_shift_mode: stringOrNull(itemSummary.pitch_shift_mode),
    }),
    measurements: {},
    measurement_basis: ["reaper_item_take_state"],
    artifact_refs: [],
    truncated: false,
  };
  state.canonicalRefs.push(...canonicalRefStrings(itemSummary));

  for (const templateId of PROFILE_TEMPLATES[input.profile]) {
    const execution = await executeAtomic({
      id: templateId,
      input: rangeInput(input.range),
      refs: { item_ref: itemRef },
      budget: CHILD_BUDGET,
    });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, templateId);
    const summary = executionSummary(execution);
    if (summary.item_ref !== itemRef.ref) return failed("ITEM_ANALYSIS_TARGET_MISMATCH", `${templateId} did not round-trip the exact requested item_ref.`);
    if (typeof summary.measurement_basis !== "string" || summary.measurement_basis.length === 0) {
      return failed("ITEM_ANALYSIS_MEASUREMENT_BASIS_MISSING", `${templateId} did not identify its measurement_basis.`);
    }
    const metricKey = metricKeyFor(templateId);
    row.measurements[metricKey] = compactMetricSummary(templateId, summary);
    row.measurement_basis.push(summary.measurement_basis);
    const artifacts = executionArtifactRefs(execution);
    row.artifact_refs.push(...artifacts);
    row.truncated = row.truncated || summary.truncated === true;
  }

  row.measurement_basis = uniqueStrings(row.measurement_basis);
  row.artifact_refs = uniqueStrings(row.artifact_refs);
  return { ok: true, data: row };
}

function normalizeInput(input) {
  if (!isPlainObject(input)) return failed("ITEM_ANALYSIS_REQUEST_INVALID", "macro.items.analyze input must be an object.");
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return failed("ITEM_ANALYSIS_REQUEST_INVALID", `Unsupported input field(s): ${unknown.join(", ")}.`);
  const profile = input.profile ?? "quick";
  if (!ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES.includes(profile)) {
    return failed("ITEM_ANALYSIS_PROFILE_UNSUPPORTED", `profile=${String(profile)} is held; supported profiles are ${ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES.join(", ")}.`);
  }
  const target = input.target ?? "selected";
  if (target !== "selected") return failed("ITEM_ANALYSIS_TARGET_SELECTOR_UNSUPPORTED", "target must be selected when exact refs are not supplied.");
  const targetRefs = input.target_refs ?? [];
  if (!Array.isArray(targetRefs) || targetRefs.some((ref) => typeof ref !== "string" || ref.length === 0)) {
    return failed("ITEM_ANALYSIS_REQUEST_INVALID", "target_refs must be an array of non-empty Item ref tokens.");
  }
  if (targetRefs.length > MAX_TARGETS) return failed("ITEM_ANALYSIS_TARGET_LIMIT_EXCEEDED", `target_refs exceeds the maximum of ${MAX_TARGETS}.`);
  const limit = input.limit ?? 4;
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_TARGETS) return failed("ITEM_ANALYSIS_REQUEST_INVALID", `limit must be an integer from 1 to ${MAX_TARGETS}.`);
  const channelPolicy = input.channel_policy ?? "combined";
  if (channelPolicy !== "combined") return failed("ITEM_ANALYSIS_CHANNEL_POLICY_UNSUPPORTED", "Alpha3.3-B1b supports only channel_policy=combined.");
  const output = input.output ?? "compact";
  if (!["compact", "artifact_when_large"].includes(output)) return failed("ITEM_ANALYSIS_REQUEST_INVALID", "output must be compact or artifact_when_large.");
  const range = normalizeRange(input.range);
  if (!range.ok) return range;
  if (profile === "quick" && range.value !== null) return failed("ITEM_ANALYSIS_RANGE_UNUSED", "profile=quick does not run sample analysis; omit range or choose audio, timing, or full.");
  return {
    ok: true,
    input: {
      profile,
      target,
      target_refs: [...targetRefs],
      range: range.value,
      limit,
      channel_policy: channelPolicy,
      output,
    },
  };
}

function normalizeRange(value) {
  if (value === undefined) return { ok: true, value: null };
  if (!isPlainObject(value)) return failed("ITEM_ANALYSIS_RANGE_INVALID", "range must be an object with item-local start_seconds/end_seconds.");
  const unknown = Object.keys(value).filter((field) => !["start_seconds", "end_seconds"].includes(field));
  if (unknown.length > 0) return failed("ITEM_ANALYSIS_RANGE_INVALID", `Unsupported range field(s): ${unknown.join(", ")}.`);
  const start = value.start_seconds ?? 0;
  const end = value.end_seconds;
  if (!Number.isFinite(start) || start < 0) return failed("ITEM_ANALYSIS_RANGE_INVALID", "range.start_seconds must be a non-negative finite number.");
  if (end !== undefined && (!Number.isFinite(end) || end <= start)) return failed("ITEM_ANALYSIS_RANGE_INVALID", "range.end_seconds must be finite and greater than start_seconds.");
  return { ok: true, value: compactObject({ start_seconds: start, end_seconds: end }) };
}

function compactMetricSummary(templateId, summary) {
  const common = {
    measurement_basis: summary.measurement_basis,
    analyzed_start_seconds: finiteOrNull(summary.analyzed_start_seconds ?? summary.start_seconds),
    analyzed_end_seconds: finiteOrNull(summary.analyzed_end_seconds ?? summary.end_seconds),
    duration_seconds: finiteOrNull(summary.duration_seconds),
    sample_rate: finiteOrNull(summary.sample_rate),
    channels: integerOrNull(summary.channels),
    sample_frames: integerOrNull(summary.sample_frames ?? summary.analyzed_sample_frames),
    confidence: finiteOrNull(summary.confidence),
    truncated: summary.truncated === true,
    artifact_ref: stringOrNull(summary.artifact_ref),
    coverage: isPlainObject(summary.coverage) ? clone(summary.coverage) : null,
  };
  if (templateId === RMS_ID) {
    return compactObject({
      ...common,
      rms_dbfs: finiteOrNull(summary.rms_dbfs),
      rms_linear: finiteOrNull(summary.rms_linear),
      lufs_i: finiteOrNull(summary.lufs_i),
    });
  }
  if (templateId === PEAKS_ID) {
    return compactObject({
      ...common,
      abs_peak_dbfs: finiteOrNull(summary.abs_peak_dbfs),
      abs_peak_linear: finiteOrNull(summary.abs_peak_linear),
      positive_peak_linear: finiteOrNull(summary.positive_peak_linear),
      negative_peak_linear: finiteOrNull(summary.negative_peak_linear),
      source_sample_peak_dbfs: finiteOrNull(summary.source_sample_peak_dbfs),
      true_peak_dbfs: finiteOrNull(summary.true_peak_dbfs),
      true_peak_available: booleanOrNull(summary.true_peak_available),
    });
  }
  if (templateId === SILENCE_ID) {
    return compactObject({
      ...common,
      segment_count: integerOrNull(summary.segment_count),
      total_silence_seconds: finiteOrNull(summary.total_silence_seconds),
      total_detected: integerOrNull(summary.total_detected),
      returned_count: integerOrNull(summary.returned_count),
      threshold_dbfs: finiteOrNull(summary.threshold_dbfs),
    });
  }
  return compactObject({
    ...common,
    transient_count: integerOrNull(summary.transient_count),
    total_detected: integerOrNull(summary.total_detected),
    first_transient_time: finiteOrNull(summary.first_transient_time),
    last_transient_time: finiteOrNull(summary.last_transient_time),
    transient_delta_linear: finiteOrNull(summary.transient_delta_linear),
  });
}

function metricKeyFor(templateId) {
  if (templateId === RMS_ID) return "rms";
  if (templateId === PEAKS_ID) return "sample_peaks";
  if (templateId === SILENCE_ID) return "silence";
  return "transients";
}

function successEnvelope({ entry, request, startedAt, now, stages, state, summary, data }) {
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: macroIdentity(entry),
    request: requestSummary(request),
    execution: { status: "completed", started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: sqliteEvidence(),
    result: {
      summary,
      canonical_refs: uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: [],
      verification: { status: "passed", evidence_refs: uniqueStrings(state.evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) },
      artifact_refs: uniqueStrings(state.artifactRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data,
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: state.artifactRefs.length > 0 },
  });
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, status = "blocked", code, message, blockers = [], data = {} }) {
  const rows = blockers.length > 0 ? blockers : [blocker(code, message)];
  return finalizeEnvelope({
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: macroIdentity(entry),
    request: requestSummary(request),
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: sqliteEvidence(),
    result: {
      summary: message,
      canonical_refs: uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: [],
      verification: { status: status === "partial_failure" ? "failed" : "not_required", evidence_refs: status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : [] },
      artifact_refs: uniqueStrings(state.artifactRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      data,
    },
    blockers: rows.slice(0, MACRO_CONTRACT_CEILINGS.blocker_max_count),
    error: { code, message, recoverable: rows.every((row) => row.recoverable !== false) },
    recovery: {
      action: "Resolve the typed target, range, readiness, or measurement blocker, then retry macro.items.analyze once.",
      mutation_occurred: false,
      sqlite_rows_authorize_writes: false,
    },
    budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: state.artifactRefs.length > 0 },
  });
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  for (let attempt = 0; attempt < 3; attempt += 1) result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.3-B1b items.analyze envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function resultData(input, state) {
  const itemSample = state.rows.slice(0, INLINE_ITEM_SAMPLE_MAX);
  return {
    profile: input.profile,
    supported_profiles: ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES,
    held_profiles: ["compare", "midi", "loop"],
    channel_policy: input.channel_policy,
    output: input.output,
    range: input.range,
    target_scope: state.targetScope,
    total_target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    targets_truncated: state.targetsTruncated,
    measurement_basis: uniqueStrings(state.rows.flatMap((row) => row.measurement_basis)),
    item_refs: clone(state.itemRefs),
    items: clone(itemSample),
    items_sampled: itemSample.length,
    items_truncated: state.totalTargetCount > itemSample.length,
    batch_timings: clone(state.batchTimings),
    mutation: { occurred: false, changes: 0 },
  };
}

function targetCoverageData(state) {
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
    rows: [],
    itemRefs: [],
    batchTimings: {},
    canonicalRefs: [],
    artifactRefs: [],
    evidenceRefs: [],
  };
}

function collectExecutionEvidence(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([
    execution?.request?.id,
    execution?.template?.id,
    ...executionArtifactRefs(execution),
  ]));
  state.artifactRefs.push(...executionArtifactRefs(execution));
  state.canonicalRefs.push(...canonicalRefStrings(execution?.result?.summary));
  state.canonicalRefs.push(...canonicalRefStrings(execution?.result?.refs));
}

function atomicFailure(execution, templateId) {
  const code = execution?.error?.code ?? "ITEM_ANALYSIS_ATOMIC_FAILED";
  const message = execution?.error?.message ?? `${templateId} failed.`;
  return failed(code, message, [blocker(code, message, execution?.error?.recoverable !== false)]);
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

function executionArtifactRefs(execution) {
  return uniqueStrings([
    execution?.result?.summary?.artifact_ref,
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts.map((entry) => entry?.ref) : []),
  ]);
}

function canonicalRefStrings(value) {
  const refs = [];
  const visit = (entry) => {
    if (typeof entry === "string" && /^(item|take|track|artifact):/u.test(entry)) refs.push(entry);
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (isPlainObject(entry)) Object.values(entry).forEach(visit);
  };
  visit(value);
  return uniqueStrings(refs);
}

function uniqueObjectRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (seen.has(ref.ref)) return false;
    seen.add(ref.ref);
    return true;
  });
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const row = { id, kind, status, summary, evidence_refs: uniqueStrings(evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) };
  const index = stages.findIndex((stage) => stage.id === id);
  if (index >= 0) stages[index] = row;
  else stages.push(row);
}

function requestSummary(request) {
  return {
    request_id: typeof request?.context?.request_id === "string"
      ? request.context.request_id
      : `${ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID}:${request?.context?.created_at ?? "request"}`,
    dry_run: false,
  };
}

function macroIdentity(entry) {
  return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk };
}

function sqliteEvidence() {
  return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
}

function rangeInput(range) {
  return range === null ? {} : clone(range);
}

function blocker(code, summary, recoverable = true) {
  return { code, message: summary, recoverable };
}

function failed(code, message, blockers = [blocker(code, message)]) {
  return { ok: false, code, message, blockers };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function executionSummary(execution) {
  return {
    ...plainObject(execution?.result?.summary),
    ...plainObject(execution?.result?.readback),
  };
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOrNull(value) {
  return Number.isInteger(value) ? value : null;
}

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function booleanOrNull(value) {
  return typeof value === "boolean" ? value : null;
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
