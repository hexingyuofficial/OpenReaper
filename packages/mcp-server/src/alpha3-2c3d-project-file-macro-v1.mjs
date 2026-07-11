export const ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT = "alpha3.2c3d.project_file_macro.v1";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_ID = "macro.project.file";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION = "1.0.0";

const READ_PATH_ID = "template.project.read_current_project_path";
const READ_DIRTY_ID = "template.project.read_dirty_state";
const SAVE_CURRENT_ID = "template.project.save_current_project";
const SAVE_AS_ID = "template.project.save_project_as";
const HELD_OPERATIONS = new Set(["new", "create", "create_new", "open", "open_project"]);
const ALLOWED_INPUT_FIELDS = new Set(["operation", "target_path", "overwrite"]);
const OPERATION_MAX_BYTES = 64;
const TARGET_PATH_MAX_BYTES = 2048;
const REQUEST_SUMMARY_TARGET_PATH_MAX_BYTES = 256;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;
const UNKNOWN_FIELD_NAME_MAX_BYTES = 80;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;

export function isAlpha3_2C3DProjectFileMacroId(id) {
  return id === ALPHA3_2C3D_PROJECT_FILE_MACRO_ID;
}

export function planAlpha3_2C3DProjectFileMacro(input = {}, requestPosture = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const blockers = [
    ...validateUnusedRequestPosture(requestPosture),
    ...validateInput(input, normalized),
  ];
  const operation = summarizeOperation(normalized.operation);
  if (blockers.length > 0) return blockedPlan(operation, blockers);

  const preflightRequests = [
    childRequest(1, "preflight", READ_PATH_ID),
    childRequest(2, "preflight", READ_DIRTY_ID),
  ];
  const mutationRequest = operation === "save_current"
    ? childRequest(3, "mutation", SAVE_CURRENT_ID, {}, saveCurrentDependencyGate())
    : childRequest(3, "mutation", SAVE_AS_ID, {
        target_path: normalized.target_path,
        overwrite: true,
      }, saveAsDependencyGate());
  const readbackRequests = [
    childRequest(4, "postflight", READ_PATH_ID),
    childRequest(5, "postflight", READ_DIRTY_ID),
  ];
  const successCriteria = operation === "save_current"
    ? {
        path: "postflight exact project path must equal the exact preflight project path byte-for-byte",
        dirty_state: "postflight dirty state must be clean with raw dirty value exactly 0",
      }
    : {
        path: "postflight exact project path must equal the requested input.target_path byte-for-byte",
        dirty_state: "postflight dirty state must be clean with raw dirty value exactly 0",
      };

  return deepFreeze({
    contract: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
    version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    ok: true,
    mode: "plan_only_agent_executed_child_requests",
    operation,
    preflight_requests: preflightRequests,
    mutation_requests: [mutationRequest],
    readback_requests: readbackRequests,
    child_requests: [...preflightRequests, mutationRequest, ...readbackRequests],
    success_criteria: successCriteria,
    agent_execution_flow: agentExecutionFlow(successCriteria),
    blockers: [],
    typed_blockers: [],
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

export function createAlpha3_2C3DProjectFileMacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3_2C3DProjectFileMacro(request.input ?? {}, requestPosture(request));
  const completedAt = safeNowIso(now);
  const envelope = {
    contract: "call_template.runtime.v1",
    ok: normalizedPlan.ok,
    template: {
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      pack: "project",
      risk: "write",
    },
    request: summarizeRuntimeRequest(request),
    completed_at: completedAt,
    error: normalizedPlan.ok ? null : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
      action_kind: "macro",
      mode: "plan_only_agent_executed_child_requests",
      executed: false,
      plan: normalizedPlan,
      preflight_requests: normalizedPlan.preflight_requests,
      mutation_requests: normalizedPlan.mutation_requests,
      readback_requests: normalizedPlan.readback_requests,
      child_requests: normalizedPlan.child_requests,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      typed_blockers: normalizedPlan.typed_blockers,
      no_executor_safety_posture: normalizedPlan.no_executor_safety_posture,
      execution: {
        executed: false,
        executor_call_count: 0,
        reason: "macro.project.file only returns an agent-executed child-request plan; the server never dispatches its child requests.",
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
      truncated: false,
    },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope));
  return deepFreeze(envelope);
}

export function createAlpha3_2C3DProjectFileMacroDiscoveryItems() {
  return [deepFreeze({
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    title: "Save project file",
    summary: "Plan-only save-current or save-as macro over four accepted/live-smoked atomic project-file templates; child requests are executed explicitly by the agent.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.project.file",
    tags: ["macro", "project", "file", "save", "save_as", "alpha3_2c3d", "plan_only"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_file_save",
    menu_group: "secondary",
    execution_shape: "plan_only_agent_executed_child_requests",
    user_label: "Save project file",
    task_intents: ["save project", "save current project", "save project as"],
    support_status: "plan_only_runtime_bound",
    support_state: "supported",
    exists_in_catalog: true,
    live_runnable_now: false,
    evidence_level: "runtime_bound_static_fake",
    known_blocker: null,
    allowed_live_group: null,
    inputSchema: {
      type: "object",
      required: ["operation"],
      additionalProperties: false,
      properties: {
        operation: { enum: ["save_current", "save_as"] },
        target_path: { type: "string", description: "Required only for save_as; forwarded unchanged to the atomic save_project_as template." },
        overwrite: { const: true, description: "Required only for save_as. Atomic overwrite=false remains held." },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "action_kind", "mode", "executed", "plan", "execution"],
      properties: {
        contract: { const: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT },
        action_kind: { const: "macro" },
        mode: { const: "plan_only_agent_executed_child_requests" },
        executed: { const: false },
        plan: { type: "object" },
        execution: { type: "object" },
      },
    },
    refs: { input: [], output: [] },
    expectedDelta: {
      kind: "read",
      action: "read",
      entities: ["macro_plan"],
      summary: "Returns a plan only. It does not save a project or dispatch bridge requests itself.",
    },
    examples: [
      { input: { operation: "save_current" } },
      { input: { operation: "save_as", target_path: "/projects/demo/demo.RPP", overwrite: true } },
    ],
  })];
}

function validateUnusedRequestPosture(posture) {
  const blockers = [];
  if (posture.refs_provided === true) {
    blockers.push(blocker("PROJECT_FILE_REFS_UNSUPPORTED", "macro.project.file does not accept refs."));
  }
  if (posture.idempotency_key_present === true) {
    blockers.push(blocker("PROJECT_FILE_IDEMPOTENCY_KEY_UNSUPPORTED", "macro.project.file does not accept idempotency_key."));
  }
  return blockers;
}

function validateInput(originalInput, input) {
  const blockers = [];
  if (!isPlainObject(originalInput)) {
    return [blocker("PROJECT_FILE_INPUT_INVALID", "macro.project.file input must be an object.")];
  }
  const unknownFields = Object.keys(input).filter((field) => !ALLOWED_INPUT_FIELDS.has(field));
  if (unknownFields.length > 0) {
    blockers.push(blocker("PROJECT_FILE_INPUT_FIELDS_UNSUPPORTED", "macro.project.file input contains unsupported fields.", {
      fields: unknownFields.slice(0, UNKNOWN_FIELD_DETAIL_LIMIT).map((field) => boundedSafeUtf8(field, UNKNOWN_FIELD_NAME_MAX_BYTES)),
      field_count: unknownFields.length,
      omitted_field_count: Math.max(0, unknownFields.length - UNKNOWN_FIELD_DETAIL_LIMIT),
    }));
  }
  if (typeof input.operation !== "string" || input.operation.trim() === "") {
    blockers.push(blocker("PROJECT_FILE_OPERATION_REQUIRED", "operation must be save_current or save_as."));
    return blockers;
  }
  if (Buffer.byteLength(input.operation) > OPERATION_MAX_BYTES) {
    blockers.push(blocker("PROJECT_FILE_OPERATION_TOO_LONG", "operation exceeds the bounded input size."));
    return blockers;
  }
  if (CONTROL_CHARACTER_PATTERN.test(input.operation)) {
    blockers.push(blocker("PROJECT_FILE_OPERATION_CONTROL_CHARACTER", "operation contains a NUL or control character."));
    return blockers;
  }
  const operation = input.operation.trim();
  if (HELD_OPERATIONS.has(operation)) {
    blockers.push(blocker("PROJECT_FILE_OPERATION_HELD", "The requested project-file operation is held; only save_current and save_as are supported."));
    return blockers;
  }
  if (operation !== "save_current" && operation !== "save_as") {
    blockers.push(blocker("PROJECT_FILE_OPERATION_UNSUPPORTED", "The requested project-file operation is unsupported."));
    return blockers;
  }
  if (operation === "save_current") {
    const saveAsFields = ["target_path", "overwrite"].filter((field) => Object.hasOwn(input, field));
    if (saveAsFields.length > 0) {
      blockers.push(blocker("SAVE_CURRENT_FIELDS_REJECTED", "save_current rejects save-as-only fields target_path and overwrite.", { fields: saveAsFields }));
    }
    return blockers;
  }
  if (typeof input.target_path !== "string" || input.target_path.length === 0) {
    blockers.push(blocker("SAVE_AS_TARGET_PATH_REQUIRED", "save_as requires a non-empty target_path string."));
  } else if (Buffer.byteLength(input.target_path) > TARGET_PATH_MAX_BYTES) {
    blockers.push(blocker("SAVE_AS_TARGET_PATH_TOO_LONG", "save_as target_path exceeds the atomic 2048-byte input limit."));
  } else if (CONTROL_CHARACTER_PATTERN.test(input.target_path)) {
    blockers.push(blocker("SAVE_AS_TARGET_PATH_CONTROL_CHARACTER", "save_as target_path contains a NUL or control character."));
  }
  if (input.overwrite !== true) {
    blockers.push(blocker("SAVE_AS_OVERWRITE_TRUE_REQUIRED", "save_as requires explicit overwrite=true; atomic overwrite=false remains held."));
  }
  return blockers;
}

function requestPosture(request) {
  return {
    refs_provided: refsProvided(request.refs),
    refs_count: boundedCollectionCount(request.refs),
    idempotency_key_present: request.idempotency_key !== undefined,
  };
}

function summarizeRuntimeRequest(request) {
  const input = isPlainObject(request.input) ? request.input : {};
  const posture = requestPosture(request);
  return {
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    input: {
      ...(typeof input.operation === "string" ? { operation: boundedSafeUtf8(input.operation, OPERATION_MAX_BYTES) } : {}),
      ...(typeof input.target_path === "string" ? { target_path: boundedSafeUtf8(input.target_path, REQUEST_SUMMARY_TARGET_PATH_MAX_BYTES) } : {}),
      ...(typeof input.overwrite === "boolean" ? { overwrite: input.overwrite } : {}),
    },
    refs: {
      provided: posture.refs_provided,
      count: posture.refs_count,
      shape: Array.isArray(request.refs) ? "array" : isPlainObject(request.refs) ? "object" : request.refs == null ? "none" : "other",
    },
    idempotency_key: {
      provided: posture.idempotency_key_present,
    },
  };
}

function refsProvided(refs) {
  if (Array.isArray(refs)) return refs.length > 0;
  if (isPlainObject(refs)) return Object.keys(refs).length > 0;
  return refs !== undefined && refs !== null;
}

function boundedCollectionCount(value) {
  if (Array.isArray(value)) return Math.min(value.length, 1_000_000);
  if (isPlainObject(value)) return Math.min(Object.keys(value).length, 1_000_000);
  return value === undefined || value === null ? 0 : 1;
}

function summarizeOperation(value) {
  return typeof value === "string" ? boundedSafeUtf8(value.trim(), OPERATION_MAX_BYTES) : null;
}

function childRequest(sequence, phase, id, input = {}, executeIf = undefined) {
  return deepFreeze({
    sequence,
    phase,
    tool: "call_template",
    call_template: { id, input, refs: {} },
    ...(executeIf === undefined ? {} : { execute_if: executeIf }),
  });
}

function saveCurrentDependencyGate() {
  return {
    all: [
      "preflight request 1 succeeded",
      "preflight request 2 succeeded",
      "preflight path reports saved_project=true and returns an exact project path",
    ],
    otherwise: "stop; do not execute any mutation request",
  };
}

function saveAsDependencyGate() {
  return {
    all: [
      "preflight request 1 succeeded",
      "preflight request 2 succeeded",
      "preflight path reports saved_project=true and returns an exact project path",
      "the requested target_path remains byte-for-byte unchanged from the validated macro input",
      "overwrite remains explicitly true",
    ],
    otherwise: "stop; do not execute any mutation request",
  };
}

function agentExecutionFlow(successCriteria) {
  return {
    execution_authority: "agent_calls_existing_call_template_requests",
    ordering: "strict_serial_in_child_requests_order",
    dependency_gate: "execute the mutation only when its execute_if conditions are all proven from successful preflight results",
    failure_policy: "stop immediately on any failed child request; do not run later mutation or readback requests after a failed dependency",
    readback_policy: "after a successful mutation, run both postflight reads and evaluate the exact success criteria",
    success_criteria: successCriteria,
  };
}

function blockedPlan(operation, blockers) {
  return deepFreeze({
    contract: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
    version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    ok: false,
    mode: "plan_only_agent_executed_child_requests",
    operation,
    preflight_requests: [],
    mutation_requests: [],
    readback_requests: [],
    child_requests: [],
    success_criteria: null,
    agent_execution_flow: {
      execution_authority: "agent_calls_existing_call_template_requests",
      ordering: "none_blocked_before_child_planning",
      dependency_gate: "blocked; no mutation request exists",
      failure_policy: "repair the typed blocker and request a new plan",
      readback_policy: "none until a valid mutation plan exists",
      success_criteria: null,
    },
    blockers,
    typed_blockers: blockers,
    no_executor_safety_posture: noExecutorSafetyPosture(),
    safety: noExecutorSafetyPosture(),
  });
}

function noExecutorSafetyPosture() {
  return {
    plan_only: true,
    agent_executes_children_explicitly: true,
    server_executes_children: false,
    executor_call_count: 0,
    bridge_request_created: false,
    live_executor_allowlist_member: false,
    added_tools: 0,
    public_call_recipe: false,
    hidden_executor: false,
    raw_action_lua_shell_ui: false,
    atomic_filesystem_safety_owner: "template.project.save_project_as",
    wrapper_revalidates_or_weakens_atomic_filesystem_safety: false,
  };
}

function macroRuntimeError(plan) {
  const first = plan.blockers[0] ?? blocker("PROJECT_FILE_MACRO_BLOCKED", "Project-file macro planning was blocked.");
  return {
    source: "macro",
    code: first.code,
    message: first.message,
    recoverable: first.recoverable,
    details: { blockers: plan.blockers, mutation_requests: 0 },
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

function boundedSafeUtf8(value, maxBytes) {
  return boundedUtf8(typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f]/gu, "�") : value, maxBytes);
}

function boundedUtf8(value, maxBytes) {
  if (typeof value !== "string") return value;
  if (Buffer.byteLength(value) <= maxBytes) return value;
  let output = "";
  let bytes = 0;
  for (const character of value) {
    const characterBytes = Buffer.byteLength(character);
    if (bytes + characterBytes > Math.max(0, maxBytes - 3)) break;
    output += character;
    bytes += characterBytes;
  }
  return `${output}…`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
