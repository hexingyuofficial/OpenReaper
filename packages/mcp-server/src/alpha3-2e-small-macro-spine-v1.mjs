export const ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT = "alpha3.2e.project_inspect_macro.v1";
export const ALPHA3_2E_PROJECT_INSPECT_MACRO_ID = "macro.project.inspect";
export const ALPHA3_2E_PROJECT_INSPECT_MACRO_VERSION = "1.0.0";

const DEFAULT_INCLUDE = deepFreeze([
  "project_identity",
  "project_path",
  "dirty_state",
  "selected_context",
  "tracks",
  "items",
  "markers_regions",
  "render",
  "index_status",
]);

const ALLOWED_INCLUDE = new Set(DEFAULT_INCLUDE);
const ALLOWED_INPUT_FIELDS = new Set(["include", "fields", "limit", "compact_response", "ref_policy", "refresh_policy"]);
const ALLOWED_REFRESH_POLICIES = new Set(["never", "if_stale", "required", "force_read_only_refresh"]);
const ALLOWED_REF_POLICIES = new Set(["canonical_only", "include_missing_reasons"]);
const MAX_INCLUDE = 12;
const MAX_FIELDS = 40;
const MAX_FIELD_BYTES = 96;
const MAX_LIMIT = 250;
const DEFAULT_LIMIT = 50;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;

const READ_SUMMARY_ID = "template.project.read_summary";
const READ_METADATA_ID = "template.project.read_metadata";
const READ_PATH_ID = "template.project.read_current_project_path";
const READ_DIRTY_ID = "template.project.read_dirty_state";
const READ_RENDER_SETTINGS_ID = "template.render.read_settings";
const QUERY_ID = "macro.project.query";

export function isAlpha3_2EProjectInspectMacroId(id) {
  return id === ALPHA3_2E_PROJECT_INSPECT_MACRO_ID;
}

export function planAlpha3_2EProjectInspectMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  if (blockers.length > 0) return blockedPlan(blockers);

  const include = normalizeInclude(normalized.include);
  const limit = normalizeLimit(normalized.limit);
  const refreshPolicy = normalizeRefreshPolicy(normalized.refresh_policy);
  const refPolicy = normalizeRefPolicy(normalized.ref_policy);
  const fields = normalizeFields(normalized.fields);
  const childRequests = buildChildRequests({ include, limit, refreshPolicy, refPolicy, fields });
  const readbackRequests = buildReadbackRequests(include);
  const successCriteria = successCriteriaFor(include);

  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_INSPECT_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    include,
    limit,
    refresh_policy: refreshPolicy,
    ref_policy: refPolicy,
    fields,
    preflight_requests: childRequests,
    child_requests: childRequests,
    readback_requests: readbackRequests,
    mutation_requests: [],
    success_criteria: successCriteria,
    agent_execution_flow: agentExecutionFlow(successCriteria),
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

export function createAlpha3_2EProjectInspectMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2EProjectInspectMacro(request.input ?? {}, requestPosture(request));
  const envelope = {
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: {
      id: ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
      pack: "project",
      risk: "read",
    },
    request: summarizeRuntimeRequest(request),
    completed_at: safeNowIso(now),
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT,
      action_kind: "macro",
      mode: "plan_only_agent_executed_child_requests",
      executed: false,
      plan: normalizedPlan,
      preflight_requests: normalizedPlan.preflight_requests,
      child_requests: normalizedPlan.child_requests,
      readback_requests: normalizedPlan.readback_requests,
      mutation_requests: normalizedPlan.mutation_requests,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      typed_blockers: normalizedPlan.typed_blockers,
      no_executor_safety_posture: normalizedPlan.no_executor_safety_posture,
      execution: {
        executed: false,
        executor_call_count: 0,
        reason: "This retained legacy inspect-planner envelope does not dispatch children; public call_template macro.project.inspect uses the separate registered executable program.",
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

export function createAlpha3_2EProjectInspectMacroDiscoveryItems(options = {}) {
  const liveRunnableNow = options.liveRunnableNow === true;
  return [deepFreeze({
    id: ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
    title: "Inspect current project",
    summary: "Execute one bounded project inspection that hydrates or reuses SQLite and returns compact project understanding.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "macro.project.inspect",
    tags: ["macro", "project", "inspect", "read", "sqlite", "executable", "alpha3_2_5_b"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_inspect",
    menu_group: "primary",
    execution_shape: "registered_macro_program",
    user_label: "Inspect current project",
    task_intents: ["inspect project", "show selected context", "check project readiness"],
    support_status: "executable_runtime_bound",
    support_state: "supported",
    exists_in_catalog: true,
    live_runnable_now: liveRunnableNow,
    evidence_level: liveRunnableNow ? "runtime_bound_live_route" : "runtime_bound_executable",
    known_blocker: liveRunnableNow ? null : "live_executor_not_configured",
    allowed_live_group: "macro_project_understanding",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        include: { type: "array", items: { enum: [...ALLOWED_INCLUDE] } },
        fields: { type: "array", items: { type: "string" } },
        limit: { type: "integer", minimum: 1, maximum: MAX_LIMIT },
        compact_response: { type: "boolean" },
        ref_policy: { enum: [...ALLOWED_REF_POLICIES] },
        refresh_policy: { enum: [...ALLOWED_REFRESH_POLICIES] },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "sqlite", "result"],
      properties: {
        contract: { const: "macro.execution.v1" },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        sqlite: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: { input: [], output: [] },
    expectedDelta: {
      kind: "read",
      action: "read",
      entities: ["project_identity", "project_index", "project_refs"],
      summary: "Executes bounded read-only inspection, updates or reuses the Project Index, and returns compact evidence.",
    },
    examples: [
      { input: { include: ["project_path", "dirty_state", "selected_context"], refresh_policy: "if_stale", limit: 25 } },
      { input: { include: ["tracks", "items", "markers_regions"], fields: ["ref", "name"], ref_policy: "canonical_only" } },
    ],
  })];
}

function buildChildRequests({ include, limit, refreshPolicy, refPolicy, fields }) {
  const requests = [];
  let sequence = 1;
  const add = (phase, id, input = {}, purpose, refs = {}) => {
    requests.push(deepFreeze({
      sequence: sequence++,
      phase,
      tool: "call_template",
      id,
      refs,
      input,
      purpose,
      callable_now: true,
      required: true,
    }));
  };
  if (include.includes("project_identity")) {
    add("preflight", READ_METADATA_ID, {}, "Read bounded project metadata before returning project identity.");
    add("preflight", READ_SUMMARY_ID, {}, "Read compact project summary before interpreting scoped project state.");
  }
  if (include.includes("project_path")) add("preflight", READ_PATH_ID, {}, "Read exact current project path.");
  if (include.includes("dirty_state")) add("preflight", READ_DIRTY_ID, {}, "Read exact dirty-state before later agent-executed operations.");
  if (include.includes("index_status")) addQuery(sequence, requests, "status", { limit, refreshPolicy, refPolicy, fields }, "Read Project Index readiness/status through macro.project.query.");
  if (include.includes("selected_context")) addQuery(sequence, requests, "selected_context", { limit, refreshPolicy, refPolicy, fields }, "Read selected context through macro.project.query.");
  if (include.includes("tracks")) addQuery(sequence, requests, "tracks", { limit, refreshPolicy, refPolicy, fields }, "Read compact track rows through macro.project.query.");
  if (include.includes("items")) addQuery(sequence, requests, "items", { limit, refreshPolicy, refPolicy, fields }, "Read compact item rows through macro.project.query.");
  if (include.includes("markers_regions")) addQuery(sequence, requests, "markers_regions", { limit, refreshPolicy, refPolicy, fields }, "Read compact marker/region rows through macro.project.query.");
  sequence = requests.length + 1;
  if (include.includes("render")) add("preflight", READ_RENDER_SETTINGS_ID, {}, "Read current render settings without rendering.");
  return deepFreeze(requests.map((request, index) => ({ ...request, sequence: index + 1 })));
}

function addQuery(sequence, requests, entity, { limit, refreshPolicy, refPolicy, fields }, purpose) {
  requests.push(deepFreeze({
    sequence,
    phase: "preflight",
    tool: "call_template",
    id: QUERY_ID,
    refs: {},
    input: {
      entity,
      refresh_policy: refreshPolicy,
      hydrate_refs: refPolicy === "canonical_only",
      limit,
      ...(fields.length > 0 ? { fields } : {}),
    },
    purpose,
    callable_now: true,
    required: true,
  }));
}

function buildReadbackRequests(include) {
  return deepFreeze(include.map((scope) => ({
    scope,
    required: true,
    summary: `Agent must execute the planned child request(s) for ${scope} and keep their typed blockers/readbacks with the inspect result.`,
  })));
}

function successCriteriaFor(include) {
  return deepFreeze({
    read_only: "All child requests are read-only or plan-only read macros; no mutation requests are emitted.",
    requested_scopes: include,
    completion: "Every required child request either returns ok:true with bounded readback/rows or an explicit typed blocker retained by the agent.",
    no_executor: "Server executor_call_count remains 0; the agent executes child requests explicitly.",
  });
}

function agentExecutionFlow(successCriteria) {
  return deepFreeze({
    instruction: "Execute child_requests in order, do not skip typed blockers, and do not infer write success from this read-only inspect macro.",
    child_request_policy: "serial_agent_executed_call_template_only",
    stop_on_blocker: true,
    success_criteria: successCriteria,
  });
}

function validateUnusedRequestPosture(posture) {
  const blockers = [];
  if (posture.refs_provided === true) blockers.push(blocker("PROJECT_INSPECT_REFS_UNSUPPORTED", "macro.project.inspect does not accept refs in Alpha3.2-E0."));
  if (posture.idempotency_key_present === true) blockers.push(blocker("PROJECT_INSPECT_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.project.inspect does not accept idempotency_key."));
  return blockers;
}

function validateInput(original, normalized) {
  if (!isPlainObject(original)) return [blocker("PROJECT_INSPECT_INPUT_INVALID", "macro.project.inspect input must be an object.")];
  const blockers = [];
  const keys = Object.keys(normalized);
  const unknown = keys.filter((key) => !ALLOWED_INPUT_FIELDS.has(key));
  if (unknown.length > 0) {
    blockers.push(blocker("PROJECT_INSPECT_INPUT_FIELDS_UNSUPPORTED", "macro.project.inspect input contains unsupported fields.", {
      fields: unknown.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT),
      omitted_count: Math.max(0, unknown.length - UNKNOWN_FIELD_DETAIL_LIMIT),
    }));
  }
  if (normalized.include !== undefined) blockers.push(...validateInclude(normalized.include));
  if (normalized.fields !== undefined) blockers.push(...validateFields(normalized.fields));
  if (normalized.limit !== undefined && normalizeLimit(normalized.limit) === null) blockers.push(blocker("PROJECT_INSPECT_LIMIT_INVALID", `limit must be an integer from 1 to ${MAX_LIMIT}.`));
  if (normalized.compact_response !== undefined && typeof normalized.compact_response !== "boolean") blockers.push(blocker("PROJECT_INSPECT_COMPACT_RESPONSE_INVALID", "compact_response must be boolean when supplied."));
  if (normalized.ref_policy !== undefined && !ALLOWED_REF_POLICIES.has(normalized.ref_policy)) blockers.push(blocker("PROJECT_INSPECT_REF_POLICY_INVALID", "ref_policy must be canonical_only or include_missing_reasons."));
  if (normalized.refresh_policy !== undefined && !ALLOWED_REFRESH_POLICIES.has(normalized.refresh_policy)) blockers.push(blocker("PROJECT_INSPECT_REFRESH_POLICY_INVALID", "refresh_policy must be never, if_stale, required, or force_read_only_refresh."));
  return blockers;
}

function validateInclude(value) {
  if (!Array.isArray(value)) return [blocker("PROJECT_INSPECT_INCLUDE_INVALID", "include must be an array when supplied.")];
  if (value.length > MAX_INCLUDE) return [blocker("PROJECT_INSPECT_INCLUDE_TOO_LARGE", `include accepts at most ${MAX_INCLUDE} entries.`)];
  const invalid = value.filter((entry) => !ALLOWED_INCLUDE.has(entry));
  return invalid.length > 0 ? [blocker("PROJECT_INSPECT_INCLUDE_UNSUPPORTED", "include contains unsupported project inspect scopes.", { include: invalid })] : [];
}

function validateFields(value) {
  if (!Array.isArray(value)) return [blocker("PROJECT_INSPECT_FIELDS_INVALID", "fields must be an array when supplied.")];
  if (value.length > MAX_FIELDS) return [blocker("PROJECT_INSPECT_FIELDS_TOO_LARGE", `fields accepts at most ${MAX_FIELDS} entries.`)];
  const invalid = value.filter((field) => typeof field !== "string" || field.length === 0 || Buffer.byteLength(field) > MAX_FIELD_BYTES || /[\u0000-\u001f\u007f]/u.test(field));
  return invalid.length > 0 ? [blocker("PROJECT_INSPECT_FIELD_INVALID", "fields entries must be non-empty bounded strings without control characters.", { invalid_count: invalid.length })] : [];
}

function normalizeInclude(value) {
  if (value === undefined) return DEFAULT_INCLUDE;
  return deepFreeze([...new Set(value)]);
}

function normalizeFields(value) {
  if (value === undefined) return deepFreeze([]);
  return deepFreeze([...new Set(value)]);
}

function normalizeLimit(value) {
  if (value === undefined) return DEFAULT_LIMIT;
  return Number.isInteger(value) && value >= 1 && value <= MAX_LIMIT ? value : null;
}

function normalizeRefreshPolicy(value) {
  return value === undefined ? "if_stale" : value;
}

function normalizeRefPolicy(value) {
  return value === undefined ? "canonical_only" : value;
}

function blockedPlan(blockers) {
  return deepFreeze({
    contract: ALPHA3_2E_PROJECT_INSPECT_MACRO_CONTRACT,
    version: ALPHA3_2E_PROJECT_INSPECT_MACRO_VERSION,
    id: ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
    ok: false,
    mode: "blocked",
    include: [],
    preflight_requests: [],
    child_requests: [],
    readback_requests: [],
    mutation_requests: [],
    success_criteria: {},
    agent_execution_flow: {},
    blockers,
    typed_blockers: blockers,
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function noExecutorSafetyPosture() {
  return {
    plan_only: true,
    read_only: true,
    agent_executes_children_explicitly: true,
    server_executes_children: false,
    executor_call_count: 0,
    bridge_request_created: false,
    live_executor_allowlist_member: false,
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_action_lua_shell_ui: false,
    mutation_requests: 0,
  };
}

function macroRuntimeError(plan) {
  const first = plan.blockers[0] ?? blocker("PROJECT_INSPECT_MACRO_BLOCKED", "Project inspect macro planning was blocked.");
  return {
    source: "macro",
    code: first.code,
    message: first.message,
    recoverable: first.recoverable,
    details: { blockers: plan.blockers, mutation_requests: 0 },
  };
}

function requestPosture(request = {}) {
  return {
    refs_provided: Array.isArray(request.refs)
      ? request.refs.length > 0
      : isPlainObject(request.refs)
        ? Object.keys(request.refs).length > 0
        : request.refs !== undefined && request.refs !== null,
    idempotency_key_present: request.idempotency_key !== undefined,
  };
}

function summarizeRuntimeRequest(request) {
  return {
    id: request.id ?? ALPHA3_2E_PROJECT_INSPECT_MACRO_ID,
    input_keys: isPlainObject(request.input) ? Object.keys(request.input).sort() : [],
    refs_provided: requestPosture(request).refs_provided,
    idempotency_key_present: requestPosture(request).idempotency_key_present,
  };
}

function blocker(code, message, details = undefined) {
  return {
    code,
    message,
    recoverable: true,
    ...(details === undefined ? {} : { details }),
  };
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
