export const ALPHA3_2E_RENDER_TARGETS_MACRO_CONTRACT = "alpha3.2e.render_targets_macro.v1";
export const ALPHA3_2E_RENDER_TARGETS_MACRO_ID = "macro.render.targets";
export const ALPHA3_2E_RENDER_TARGETS_MACRO_VERSION = "1.0.0";

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

export function isAlpha3_2ERenderTargetsMacroId(id) {
  return id === ALPHA3_2E_RENDER_TARGETS_MACRO_ID;
}

export function planAlpha3_2ERenderTargetsMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = validateInput(input, normalized);
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

export function createAlpha3_2ERenderTargetsMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
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

export function createAlpha3_2ERenderTargetsMacroDiscoveryItems() {
  return deepFreeze([{
    id: ALPHA3_2E_RENDER_TARGETS_MACRO_ID,
    title: "Plan render targets",
    summary: "Preview bounded managed-root WAV/OGG exports and return one audited D31 render child request.",
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.render.targets",
    tags: ["alpha3.2", "alpha3.2e", "macro", "render", "plan_only", "runtime_bound"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "render_targets",
    menu_group: "primary",
    execution_shape: "plan_only_agent_executed_child_requests",
    implementation_status: "plan_only_runtime_bound_preview_first",
    runnable: true,
    support_status: "plan_only_runtime_bound_preview_first",
    support_state: "supported_with_readback",
    exists_in_catalog: false,
    live_runnable_now: false,
    evidence_level: "runtime_bound_live_accepted",
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
        mode: { enum: ["dry_run_preview", "plan_only_agent_executed_child_requests", "blocked"] },
        preview: { type: "object" },
        child_requests: { type: "array" },
        typed_blockers: { type: "array" },
      },
      required: ["mode", "preview", "child_requests", "typed_blockers"],
      additionalProperties: false,
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
