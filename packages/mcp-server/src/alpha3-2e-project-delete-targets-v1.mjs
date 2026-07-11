export const ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT = "alpha3.2e.project_delete_targets_macro.v1";
export const ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID = "macro.project.delete_targets";
export const ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_VERSION = "1.0.0";

const ALLOWED_INPUT_FIELDS = new Set(["refs", "selectors", "dry_run", "confirm_scope", "delete_policy", "compact_response"]);
const ALLOWED_DELETE_POLICY = "project_objects_only";
const MAX_REFS_PER_KIND = 100;
const MAX_TOTAL_REFS = 250;
const MAX_SELECTOR_COUNT = 12;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;
const SUPPORTED_REF_KINDS = Object.freeze(["tracks", "items", "markers", "regions"]);
const UNSUPPORTED_REF_KINDS = Object.freeze(["takes", "automation", "media_files", "files", "source_media", "hardware", "devices"]);

const DELETE_TEMPLATE_BY_KIND = Object.freeze({
  tracks: "template.tracks.delete_tracks",
  items: "template.items.delete_items",
  markers: "template.project.delete_marker",
  regions: "template.project.delete_region",
});

const READBACK_ENTITY_BY_KIND = Object.freeze({
  tracks: "tracks",
  items: "items",
  markers: "markers_regions",
  regions: "markers_regions",
});

const REF_PREFIX_BY_KIND = Object.freeze({
  tracks: "track:",
  items: "item:",
  markers: "marker:",
  regions: "region:",
});

export function isAlpha3_2EProjectDeleteTargetsMacroId(id) {
  return id === ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID;
}

export function planAlpha3_2EProjectDeleteTargetsMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  const targetSet = normalizeTargetSet(normalized.refs);
  blockers.push(...targetSet.blockers);
  const dryRun = normalized.dry_run !== false;
  const preview = buildPreview(targetSet.targets);
  const confirmation = confirmationFor(preview);

  if (blockers.length > 0) return blockedPlan(blockers, preview, confirmation);
  if (preview.total_count === 0) {
    return blockedPlan([blocker("DELETE_TARGETS_EMPTY", "macro.project.delete_targets requires at least one supported explicit target ref or resolved selector.")], preview, confirmation);
  }
  if (dryRun) return previewPlan(preview, confirmation);

  const confirmBlockers = validateConfirmation(normalized.confirm_scope, confirmation, preview);
  if (confirmBlockers.length > 0) return blockedPlan(confirmBlockers, preview, confirmation);

  const mutationRequests = buildMutationRequests(targetSet.targets);
  const readbackRequests = buildReadbackRequests(targetSet.targets);
  const childRequests = [...mutationRequests, ...readbackRequests];
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    dry_run: false,
    preview,
    required_confirm_scope: confirmation,
    mutation_requests: mutationRequests,
    readback_requests: readbackRequests,
    child_requests: childRequests,
    success_criteria: successCriteriaFor(preview),
    agent_execution_flow: agentExecutionFlow(preview),
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

export function createAlpha3_2EProjectDeleteTargetsMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2EProjectDeleteTargetsMacro(request.input ?? {}, requestPosture(request));
  const envelope = {
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: {
      id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
      pack: "project",
      risk: "destructive",
    },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT,
      action_kind: "macro",
      mode: normalizedPlan.mode,
      executed: false,
      plan: normalizedPlan,
      dry_run: normalizedPlan.dry_run,
      preview: normalizedPlan.preview,
      required_confirm_scope: normalizedPlan.required_confirm_scope,
      mutation_requests: normalizedPlan.mutation_requests,
      readback_requests: normalizedPlan.readback_requests,
      child_requests: normalizedPlan.child_requests,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      typed_blockers: normalizedPlan.typed_blockers,
      no_executor_safety_posture: normalizedPlan.no_executor_safety_posture,
      execution: {
        executed: false,
        executor_call_count: 0,
        reason: "macro.project.delete_targets only returns a confirmed, agent-executed child-request plan; the server never dispatches destructive requests.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_action_lua_shell_ui: false,
        bridge_request_created: false,
        live_executor_allowlist_member: false,
      },
      safety: normalizedPlan.safety,
    },
    budget: {
      max_response_bytes: 65_536,
      response_bytes: 0,
    },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope));
  return deepFreeze(envelope);
}

export function createAlpha3_2EProjectDeleteTargetsMacroDiscoveryItems() {
  return [deepFreeze({
    id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
    title: "Delete scoped project targets",
    summary: "Plan-only destructive macro that previews explicit project-object targets, requires exact confirmation, and returns deletion plus absence-readback child requests.",
    pack: "project",
    lifecycle: "experimental",
    risk: "destructive",
    entity_kind: "macro.project.delete_targets",
    tags: ["macro", "project", "delete", "cleanup", "alpha3_2e", "plan_only"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_delete_targets",
    menu_group: "primary",
    execution_shape: "plan_only_agent_executed_child_requests",
    user_label: "Delete scoped project targets",
    task_intents: ["delete tracks", "delete items", "delete markers", "delete regions", "scoped cleanup"],
    support_status: "plan_only_runtime_bound_preview_first",
    support_state: "supported_with_confirmation",
    exists_in_catalog: true,
    live_runnable_now: false,
    evidence_level: "runtime_bound_static_fake",
    known_blocker: "CONFIRM_SCOPE_REQUIRED before destructive child requests",
    allowed_live_group: null,
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        refs: { type: "object" },
        selectors: { type: "array" },
        dry_run: { type: "boolean" },
        confirm_scope: { type: "object" },
        delete_policy: { const: ALLOWED_DELETE_POLICY },
        compact_response: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "action_kind", "mode", "executed", "plan", "execution"],
      properties: {
        contract: { const: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT },
        action_kind: { const: "macro" },
        mode: { enum: ["dry_run_preview", "plan_only_agent_executed_child_requests", "blocked"] },
        executed: { const: false },
        plan: { type: "object" },
        execution: { type: "object" },
      },
    },
    refs: { input: ["track_ref", "item_ref", "marker_ref", "region_ref"], output: [] },
    expectedDelta: {
      kind: "none_until_agent_executes_children",
      action: "delete_plan",
      entities: ["macro_plan", "tracks", "items", "markers", "regions"],
      summary: "Returns a preview or confirmed deletion plan only. It does not delete project objects or dispatch bridge requests itself.",
    },
    examples: [
      { input: { refs: { items: ["item:guid:{ITEM-A}"] }, dry_run: true, delete_policy: "project_objects_only" } },
      { input: { refs: { markers: ["marker:project:12"] }, dry_run: false, confirm_scope: { token: "delete:...", expected_counts: { markers: 1 }, target_hash: "..." }, delete_policy: "project_objects_only" } },
    ],
  })];
}

function previewPlan(preview, confirmation) {
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
    ok: true,
    mode: "dry_run_preview",
    dry_run: true,
    preview,
    required_confirm_scope: confirmation,
    mutation_requests: [],
    readback_requests: buildReadbackRequests(preview.refs_by_kind),
    child_requests: [],
    success_criteria: successCriteriaFor(preview),
    agent_execution_flow: {
      instruction: "Show preview to the user/agent, then retry with dry_run:false and the exact required_confirm_scope before any destructive child request is emitted.",
      child_request_policy: "none_on_dry_run",
      stop_on_blocker: true,
    },
    blockers: [blocker("CONFIRM_SCOPE_REQUIRED", "Preview generated. Retry with dry_run:false and the exact required_confirm_scope to receive destructive child requests.", { required_confirm_scope: confirmation })],
    typed_blockers: [blocker("CONFIRM_SCOPE_REQUIRED", "Preview generated. Retry with dry_run:false and the exact required_confirm_scope to receive destructive child requests.", { required_confirm_scope: confirmation })],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function blockedPlan(blockers, preview = emptyPreview(), confirmation = confirmationFor(preview)) {
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
    ok: false,
    mode: "blocked",
    dry_run: true,
    preview,
    required_confirm_scope: confirmation,
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    success_criteria: {},
    agent_execution_flow: {},
    blockers,
    typed_blockers: blockers,
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function validateUnusedRequestPosture(posture) {
  const blockers = [];
  if (posture.idempotency_key_present === true) blockers.push(blocker("DELETE_TARGETS_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.project.delete_targets does not accept idempotency_key; child delete templates own their own idempotency semantics."));
  return blockers;
}

function validateInput(original, normalized) {
  if (!isPlainObject(original)) return [blocker("DELETE_TARGETS_INPUT_INVALID", "macro.project.delete_targets input must be an object.")];
  const blockers = [];
  const keys = Object.keys(normalized);
  const unknown = keys.filter((key) => !ALLOWED_INPUT_FIELDS.has(key));
  if (unknown.length > 0) blockers.push(blocker("DELETE_TARGETS_INPUT_FIELDS_UNSUPPORTED", "macro.project.delete_targets input contains unsupported fields.", { fields: unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT), omitted_count: Math.max(0, unknown.length - UNKNOWN_FIELD_DETAIL_LIMIT) }));
  if (normalized.delete_policy !== undefined && normalized.delete_policy !== ALLOWED_DELETE_POLICY) blockers.push(blocker("DELETE_POLICY_UNSUPPORTED", "delete_policy must be project_objects_only; filesystem/source-media deletion is forbidden."));
  if (normalized.compact_response !== undefined && typeof normalized.compact_response !== "boolean") blockers.push(blocker("DELETE_TARGETS_COMPACT_RESPONSE_INVALID", "compact_response must be boolean when supplied."));
  if (normalized.dry_run !== undefined && typeof normalized.dry_run !== "boolean") blockers.push(blocker("DELETE_TARGETS_DRY_RUN_INVALID", "dry_run must be boolean when supplied."));
  if (normalized.selectors !== undefined) blockers.push(...validateSelectors(normalized.selectors));
  if (normalized.refs !== undefined && !isPlainObject(normalized.refs)) blockers.push(blocker("DELETE_TARGETS_REFS_INVALID", "refs must be an object grouped by target kind."));
  return blockers;
}

function validateSelectors(value) {
  if (!Array.isArray(value)) return [blocker("DELETE_SELECTORS_INVALID", "selectors must be an array when supplied.")];
  if (value.length > MAX_SELECTOR_COUNT) return [blocker("DELETE_SELECTORS_TOO_LARGE", `selectors accepts at most ${MAX_SELECTOR_COUNT} entries.`)];
  return value.length > 0
    ? [blocker("DELETE_SELECTORS_REQUIRE_RESOLUTION", "Selectors must be resolved to exact canonical refs before macro.project.delete_targets emits deletion child requests.")]
    : [];
}

function normalizeTargetSet(refs) {
  const targets = { tracks: [], items: [], markers: [], regions: [] };
  const blockers = [];
  if (refs === undefined) return { targets, blockers };
  if (!isPlainObject(refs)) return { targets, blockers: [blocker("DELETE_TARGETS_REFS_INVALID", "refs must be an object grouped by target kind.")] };
  for (const [kind, value] of Object.entries(refs)) {
    if (UNSUPPORTED_REF_KINDS.includes(kind)) {
      blockers.push(blocker(kind.includes("file") || kind.includes("media") ? "FILESYSTEM_DELETE_FORBIDDEN" : "TARGET_KIND_UNSUPPORTED", `Target kind ${kind} is not supported by macro.project.delete_targets.`, { kind }));
      continue;
    }
    if (!SUPPORTED_REF_KINDS.includes(kind)) {
      blockers.push(blocker("TARGET_KIND_UNSUPPORTED", `Target kind ${kind} is not supported by macro.project.delete_targets.`, { kind }));
      continue;
    }
    if (!Array.isArray(value)) {
      blockers.push(blocker("DELETE_TARGET_REFS_INVALID", `refs.${kind} must be an array of canonical refs.`, { kind }));
      continue;
    }
    if (value.length > MAX_REFS_PER_KIND) blockers.push(blocker("DELETE_TARGET_REFS_TOO_LARGE", `refs.${kind} accepts at most ${MAX_REFS_PER_KIND} refs.`, { kind }));
    const seen = new Set();
    for (const ref of value) {
      if (typeof ref !== "string" || ref.length === 0 || /[\u0000-\u001f\u007f]/u.test(ref) || !ref.startsWith(REF_PREFIX_BY_KIND[kind])) {
        blockers.push(blocker("DELETE_TARGET_REF_INVALID", `refs.${kind} contains a non-canonical or mismatched ref.`, { kind, ref: boundedString(ref) }));
        continue;
      }
      if (seen.has(ref)) {
        blockers.push(blocker("DELETE_TARGET_REF_DUPLICATE", `refs.${kind} contains a duplicate ref.`, { kind, ref }));
        continue;
      }
      seen.add(ref);
      targets[kind].push(ref);
    }
  }
  const total = Object.values(targets).reduce((sum, rows) => sum + rows.length, 0);
  if (total > MAX_TOTAL_REFS) blockers.push(blocker("DELETE_TARGET_REFS_TOO_LARGE", `macro.project.delete_targets accepts at most ${MAX_TOTAL_REFS} total refs.`));
  return { targets: deepFreeze(targets), blockers };
}

function buildPreview(targets) {
  const refsByKind = normalizeRefsByKind(targets);
  const counts = Object.fromEntries(SUPPORTED_REF_KINDS.map((kind) => [kind, refsByKind[kind].length]));
  const orderedRefs = SUPPORTED_REF_KINDS.flatMap((kind) => refsByKind[kind].map((ref) => `${kind}:${ref}`));
  const targetHash = stableHash(orderedRefs.join("\n"));
  return deepFreeze({
    contract: "alpha3.2e.project_delete_targets.preview.v1",
    supported_kinds: SUPPORTED_REF_KINDS,
    refs_by_kind: refsByKind,
    target_counts_by_kind: counts,
    total_count: orderedRefs.length,
    target_hash: targetHash,
    confirmation_token: `delete:${orderedRefs.length}:${targetHash}`,
    filesystem_delete: false,
    hardware_or_device_io: false,
  });
}

function emptyPreview() {
  return buildPreview({ tracks: [], items: [], markers: [], regions: [] });
}

function confirmationFor(preview) {
  return deepFreeze({
    token: preview.confirmation_token,
    target_hash: preview.target_hash,
    expected_counts: preview.target_counts_by_kind,
    delete_policy: ALLOWED_DELETE_POLICY,
  });
}

function validateConfirmation(confirmScope, expected, preview) {
  if (!isPlainObject(confirmScope)) return [blocker("CONFIRM_SCOPE_REQUIRED", "dry_run:false requires confirm_scope matching the latest preview.", { required_confirm_scope: expected })];
  const blockers = [];
  if (confirmScope.token !== expected.token) blockers.push(blocker("CONFIRM_SCOPE_TOKEN_MISMATCH", "confirm_scope.token does not match the latest preview token.", { required: expected.token }));
  if (confirmScope.target_hash !== expected.target_hash) blockers.push(blocker("CONFIRM_SCOPE_HASH_MISMATCH", "confirm_scope.target_hash does not match the latest preview target hash.", { required: expected.target_hash }));
  if (!deepEqual(confirmScope.expected_counts, expected.expected_counts)) blockers.push(blocker("CONFIRM_SCOPE_COUNTS_MISMATCH", "confirm_scope.expected_counts does not match the latest preview counts.", { required: expected.expected_counts, actual: confirmScope.expected_counts ?? null }));
  if (confirmScope.delete_policy !== undefined && confirmScope.delete_policy !== ALLOWED_DELETE_POLICY) blockers.push(blocker("DELETE_POLICY_UNSUPPORTED", "confirm_scope.delete_policy must remain project_objects_only."));
  if (preview.total_count === 0) blockers.push(blocker("DELETE_TARGETS_EMPTY", "No targets were previewed for deletion."));
  return blockers;
}

function buildMutationRequests(targets) {
  const requests = [];
  let sequence = 1;
  for (const kind of SUPPORTED_REF_KINDS) {
    const refs = targets[kind] ?? [];
    if (refs.length === 0) continue;
    if (kind === "markers" || kind === "regions") {
      for (const ref of refs) requests.push(childRequest(sequence++, "mutation", DELETE_TEMPLATE_BY_KIND[kind], refsFor(kind, [ref]), {}, `Delete confirmed ${kind.slice(0, -1)} ref ${ref}.`));
      continue;
    }
    requests.push(childRequest(sequence++, "mutation", DELETE_TEMPLATE_BY_KIND[kind], refsFor(kind, refs), {}, `Delete ${refs.length} confirmed ${kind}.`));
  }
  return deepFreeze(requests);
}

function buildReadbackRequests(targets) {
  const refsByKind = normalizeRefsByKind(targets);
  const entities = [...new Set(SUPPORTED_REF_KINDS.filter((kind) => refsByKind[kind].length > 0).map((kind) => READBACK_ENTITY_BY_KIND[kind]))];
  return deepFreeze(entities.map((entity, index) => childRequest(index + 1, "absence_readback", "macro.project.query", {}, { entity, refresh_policy: "required", hydrate_refs: false, limit: MAX_TOTAL_REFS }, `Re-read ${entity} after deletion and prove confirmed refs are absent or reported as survivors.`)));
}

function childRequest(sequence, phase, id, refs, input, purpose) {
  return deepFreeze({ sequence, phase, tool: "call_template", id, refs, input, purpose, callable_now: true, required: true });
}

function refsFor(kind, refs) {
  if (kind === "tracks") return { track_ref: refs };
  if (kind === "items") return { item_ref: refs };
  if (kind === "markers") return { marker_ref: refs[0] };
  if (kind === "regions") return { region_ref: refs[0] };
  return {};
}

function successCriteriaFor(preview) {
  return deepFreeze({
    confirmed_target_count: preview.total_count,
    target_counts_by_kind: preview.target_counts_by_kind,
    deletion_boundary: "Only previewed and confirmed project objects may be deleted; filesystem/source-media/hardware/device targets are forbidden.",
    absence_readback: "Agent must execute absence_readback requests and report survivors or mismatches before claiming completion.",
    no_executor: "Server executor_call_count remains 0; the agent executes child requests explicitly.",
  });
}

function agentExecutionFlow(preview) {
  return deepFreeze({
    instruction: "Execute mutation_requests in order, then absence readback requests. Stop and report typed blockers if any child request fails.",
    child_request_policy: "serial_agent_executed_call_template_only",
    confirmed_target_count: preview.total_count,
    stop_on_blocker: true,
  });
}

function noExecutorSafetyPosture() {
  return {
    plan_only: true,
    destructive_child_requests_possible_after_confirmation: true,
    agent_executes_children_explicitly: true,
    server_executes_children: false,
    executor_call_count: 0,
    bridge_request_created: false,
    live_executor_allowlist_member: false,
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_action_lua_shell_ui: false,
    filesystem_delete: false,
    hardware_or_device_io: false,
  };
}

function macroRuntimeError(plan) {
  const first = plan.blockers[0] ?? blocker("DELETE_TARGETS_MACRO_BLOCKED", "Project delete-targets macro planning was blocked.");
  return { source: "macro", code: first.code, message: first.message, recoverable: first.recoverable, details: { blockers: plan.blockers, mutation_requests: 0 } };
}

function requestPosture(request = {}) {
  return { idempotency_key_present: request.idempotency_key !== undefined };
}

function summarizeRuntimeRequest(request) {
  return { id: request.id ?? ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input_keys: isPlainObject(request.input) ? Object.keys(request.input).sort() : [], idempotency_key_present: requestPosture(request).idempotency_key_present };
}

function normalizeRefsByKind(targets) {
  return deepFreeze(Object.fromEntries(SUPPORTED_REF_KINDS.map((kind) => [kind, [...(targets?.[kind] ?? [])]])));
}

function blocker(code, message, details = undefined) {
  return { code, message, recoverable: true, ...(details === undefined ? {} : { details }) };
}

function boundedString(value, max = 160) {
  if (typeof value !== "string") return value;
  return Buffer.byteLength(value) <= max ? value : `${value.slice(0, max)}…`;
}

function stableHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function safeNowIso(now) {
  try {
    const value = now();
    return (value instanceof Date ? value : new Date(value)).toISOString();
  } catch {
    return new Date(0).toISOString();
  }
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
