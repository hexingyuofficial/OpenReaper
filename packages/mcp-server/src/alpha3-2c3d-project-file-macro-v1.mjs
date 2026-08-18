export const ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT = "alpha3.2c3d.project_file_macro.v1";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_ID = "macro.project.file";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION = "1.2.1";

import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";
import {
  classifyNativePathTransport,
  nativePathTransportMessage,
  nativePathTransportRecovery,
} from "./native-path-input-v1.mjs";

const READ_PATH_ID = "template.project.read_current_project_path";
const READ_DIRTY_ID = "template.project.read_dirty_state";
const SAVE_CURRENT_ID = "template.project.save_current_project";
const SAVE_AS_ID = "template.project.save_project_as";
const LIST_OPEN_ID = "template.project.list_open_projects";
const CREATE_TAB_ID = "template.project.create_project_tab";
const OPEN_IN_TAB_ID = "template.project.open_project_in_tab";
const ACTIVATE_TAB_ID = "template.project.activate_project_tab";
const SUPPORTED_OPERATIONS = new Set([
  "save_current",
  "save_as",
  "list_open_projects",
  "create_project_tab",
  "open_project_in_tab",
  "activate_project_tab",
]);
const MUTATING_SWITCH_OPERATIONS = new Set(["create_project_tab", "open_project_in_tab", "activate_project_tab"]);
const MUTATING_PROJECT_FILE_OPERATIONS = new Set([
  "save_current",
  "save_as",
  ...MUTATING_SWITCH_OPERATIONS,
]);
const ALLOWED_INPUT_FIELDS = new Set([
  "operation",
  "target_path",
  "overwrite",
  "dry_run",
  "cursor",
  "limit",
  "name",
  "copy_active_project_settings",
  "project_ref",
]);
const OPERATION_MAX_BYTES = 64;
const TARGET_PATH_MAX_BYTES = 2048;
const NAME_MAX_BYTES = 160;
const PROJECT_REF_MAX_BYTES = 4096;
const REQUEST_SUMMARY_TARGET_PATH_MAX_BYTES = 256;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;
const UNKNOWN_FIELD_NAME_MAX_BYTES = 80;
const PUBLIC_RESPONSE_BUDGET_BYTES = 2_048;
const LIST_DEFAULT_LIMIT = 25;
const LIST_HARD_LIMIT = 100;
const INTERNAL_INVENTORY_CEILING = 256;
const INTERNAL_LIST_RESPONSE_FLOOR_BYTES = 32_768;
/** Named internal atomic child budget for mutation/readback/list under project.file. */
const INTERNAL_ATOMIC_CHILD_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: LIST_HARD_LIMIT,
  max_inline_value_bytes: 4_096,
});
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const FILE_TEMPLATE_IDS = Object.freeze([
  READ_PATH_ID,
  READ_DIRTY_ID,
  SAVE_CURRENT_ID,
  SAVE_AS_ID,
  LIST_OPEN_ID,
  CREATE_TAB_ID,
  OPEN_IN_TAB_ID,
  ACTIVATE_TAB_ID,
]);
const FILE_STAGE_IDS = new Set([
  "file-read-before-path",
  "file-read-before-dirty",
  "file-list-open-projects",
  "file-live-save-current",
  "file-live-save-as",
  "file-live-create-tab",
  "file-live-open-in-tab",
  "file-live-activate-tab",
  "file-read-after-path",
  "file-read-after-dirty",
  "file-index-maintenance",
  "file-result-project",
]);

export const ALPHA3_2_5_C_FILE_MACRO_REGISTRY = createMacroProgramRegistry([{
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  program_id: "openreaper.macro.project.file",
  program_version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
  implementation_status: "executable",
  risk: "write",
  input_schema: { type: "object", additionalProperties: false },
  selector_policy: { task_shaped: true, canonical_refs_optional_at_public_boundary: true, live_reresolve_before_write: true },
  sqlite_policy: { mode: "invalidate_after_write", write_authority: false, identity_fields: ["project", "bridge_owner", "bridge_generation", "snapshot", "revision"] },
  dependencies: { template_ids: FILE_TEMPLATE_IDS, runtime_capabilities: ["project_index.runtime.v1"] },
  stages: [
    { id: "file-read-before-path", kind: "template_execute", dependency_ref: READ_PATH_ID, risk: "read", stop_on_error: true },
    { id: "file-read-before-dirty", kind: "template_execute", dependency_ref: READ_DIRTY_ID, risk: "read", stop_on_error: true },
    { id: "file-list-open-projects", kind: "template_execute", dependency_ref: LIST_OPEN_ID, risk: "read", stop_on_error: true },
    { id: "file-live-save-current", kind: "template_execute", dependency_ref: SAVE_CURRENT_ID, risk: "write", stop_on_error: true },
    { id: "file-live-save-as", kind: "template_execute", dependency_ref: SAVE_AS_ID, risk: "write", stop_on_error: true },
    { id: "file-live-create-tab", kind: "template_execute", dependency_ref: CREATE_TAB_ID, risk: "write", stop_on_error: true },
    { id: "file-live-open-in-tab", kind: "template_execute", dependency_ref: OPEN_IN_TAB_ID, risk: "write", stop_on_error: true },
    { id: "file-live-activate-tab", kind: "template_execute", dependency_ref: ACTIVATE_TAB_ID, risk: "safe", stop_on_error: true },
    { id: "file-read-after-path", kind: "template_execute", dependency_ref: READ_PATH_ID, risk: "read", stop_on_error: true },
    { id: "file-read-after-dirty", kind: "template_execute", dependency_ref: READ_DIRTY_ID, risk: "read", stop_on_error: true },
    { id: "file-index-maintenance", kind: "runtime_execute", dependency_ref: "project_index.runtime.v1", risk: "read", stop_on_error: true },
    { id: "file-result-project", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "not_required",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: PUBLIC_RESPONSE_BUDGET_BYTES },
}], { acceptedTemplateIds: FILE_TEMPLATE_IDS, acceptedRuntimeCapabilities: ["project_index.runtime.v1"], registeredStageIds: FILE_STAGE_IDS });

export const ALPHA3_2_5_C_PROJECT_FILE_REGISTRY = ALPHA3_2_5_C_FILE_MACRO_REGISTRY;

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

  if (operation === "list_open_projects") {
    const listRequest = childRequest(1, "read", LIST_OPEN_ID, {
      ...(normalized.cursor === undefined ? {} : { cursor: normalized.cursor }),
      ...(normalized.limit === undefined ? {} : { limit: normalized.limit }),
    });
    return deepFreeze({
      contract: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
      version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      ok: true,
      mode: "plan_only_agent_executed_child_requests",
      operation,
      preflight_requests: [],
      mutation_requests: [],
      readback_requests: [listRequest],
      child_requests: [listRequest],
      success_criteria: {
        coverage: "public list returns one truthful page with total_count/returned_count/cursor/next_cursor/coverage_status",
      },
      agent_execution_flow: agentExecutionFlow({ coverage: "one public page only; do not hydrate all pages for the user-facing list" }),
      blockers: [],
      typed_blockers: [],
      no_executor_safety_posture: noExecutorSafetyPosture(),
      safety: noExecutorSafetyPosture(),
    });
  }

  if (MUTATING_SWITCH_OPERATIONS.has(operation)) {
    const inventoryRequest = childRequest(1, "preflight", LIST_OPEN_ID, { cursor: 0, limit: LIST_HARD_LIMIT });
    let mutationRequest;
    if (operation === "create_project_tab") {
      mutationRequest = childRequest(2, "mutation", CREATE_TAB_ID, {
        name: normalized.name,
        activate: true,
        copy_active_project_settings: false,
      });
    } else if (operation === "open_project_in_tab") {
      mutationRequest = childRequest(2, "mutation", OPEN_IN_TAB_ID, { path: normalized.target_path });
    } else {
      mutationRequest = childRequest(2, "mutation", ACTIVATE_TAB_ID, { project_ref: normalized.project_ref });
    }
    return deepFreeze({
      contract: ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT,
      version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
      id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
      ok: true,
      mode: "plan_only_agent_executed_child_requests",
      operation,
      preflight_requests: [inventoryRequest],
      mutation_requests: [mutationRequest],
      readback_requests: [],
      child_requests: [inventoryRequest, mutationRequest],
      success_criteria: {
        native_readback: "applied only when the frozen atom returns exact live path/ref/dirty/preservation truth",
        index: "Project Index rebinds to the exact live saved path after mutation",
      },
      agent_execution_flow: agentExecutionFlow({
        native_readback: "require exact frozen-atom live readback before treating the switch as applied",
      }),
      blockers: [],
      typed_blockers: [],
      no_executor_safety_posture: noExecutorSafetyPosture(),
      safety: noExecutorSafetyPosture(),
    });
  }

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

export function createAlpha3_2C3DProjectFileMacroRuntimeEnvelope({ request = {}, plan, executeAtomic, projectIndexRuntime, now = () => new Date() } = {}) {
  if (typeof executeAtomic === "function") {
    return executeAlpha3_2_5CProjectFileMacro({ request, executeAtomic, projectIndexRuntime, now });
  }
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

export async function executeAlpha3_2_5CProjectFileMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  now = () => new Date(),
} = {}) {
  const entry = ALPHA3_2_5_C_FILE_MACRO_REGISTRY.get(ALPHA3_2C3D_PROJECT_FILE_MACRO_ID);
  const startedAt = safeNowIso(now);
  const input = isPlainObject(request.input) ? request.input : {};
  const validation = validateMacroProgramRequest({
    macro_id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    input,
    refs: request.refs,
    dry_run: input.dry_run === true,
    ...(request.idempotency_key === undefined ? {} : { idempotency_key: request.idempotency_key }),
  }, { registry: ALPHA3_2_5_C_FILE_MACRO_REGISTRY });
  const plan = planAlpha3_2C3DProjectFileMacro(input, requestPosture(request));
  if (!validation.valid || !plan.ok) {
    return fileEnvelope({ entry, request, startedAt, now, status: "blocked", stages: [], blockers: plan.blockers.length > 0 ? plan.blockers : validation.errors.map((message) => blocker("PROJECT_FILE_REQUEST_INVALID", message)), summary: "Project-file Macro input was blocked." });
  }
  const operation = String(input.operation).trim();
  const budgetFailure = mutationResponseBudgetFailureEnvelope({
    entry,
    operation,
    request,
    startedAt,
    now,
  });
  if (budgetFailure) return budgetFailure;
  if (typeof executeAtomic !== "function") {
    return fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "blocked",
      stages: [],
      blockers: [blocker("PROJECT_FILE_EXECUTOR_UNAVAILABLE", "The managed OpenReaper atomic executor is unavailable.")],
      summary: "Project-file Macro needs the managed OpenReaper atomic route.",
    });
  }

  if (operation === "list_open_projects") {
    return executeListOpenProjects({ entry, request, input, executeAtomic, startedAt, now });
  }
  if (MUTATING_SWITCH_OPERATIONS.has(operation)) {
    return executeProjectSwitchOperation({ entry, request, input, executeAtomic, projectIndexRuntime, startedAt, now });
  }

  const stages = [];
  const calls = [];
  const publicBudgetBytes = resolvePublicBudgetBytes(request);
  const collectedEvidence = () => uniqueEvidenceRefs(calls.flatMap(evidenceRefs));
  let mutationAttempted = false;
  const childBudget = internalAtomicChildBudget(request);
  const run = async (stageId, id, childInput = {}) => {
    stages.push({ id: stageId, kind: "template_execute", status: "running", evidence_refs: [] });
    try {
      const execution = await executeAtomic({ id, input: childInput, refs: [], context: request.context, budget: childBudget });
      calls.push(execution);
      const evidence = evidenceRefs(execution);
      stages.at(-1).status = execution?.ok === true ? "completed" : "failed";
      stages.at(-1).summary = typeof execution?.result?.summary === "string" ? execution.result.summary : `${id} completed.`;
      stages.at(-1).evidence_refs = evidence;
      if (execution?.ok !== true) throw executionError(id, execution);
      return execution;
    } catch (error) {
      stages.at(-1).status = "failed";
      throw error;
    }
  };

  let beforePath;
  let beforeDirty;
  let afterPath;
  let afterDirty;
  let invalidation = null;
  let verifiedChange = null;
  try {
    if (operation === "save_as" && input.dry_run !== true) {
      assertMutationIdentityFitsPublicBudget({
        entry,
        request,
        startedAt,
        operation,
        path: input.target_path,
        projectRef: `project:path:${input.target_path}`,
        publicBudgetBytes,
      });
    }
    beforePath = readback(await run("file-read-before-path", READ_PATH_ID));
    beforeDirty = readback(await run("file-read-before-dirty", READ_DIRTY_ID));
    const savedProject = beforePath?.has_project_path === true || beforePath?.path_state === "saved_project";
    if (input.operation === "save_current" && !savedProject) {
      throw macroError("PROJECT_FILE_UNSAVED_PROJECT", "save_current requires an already-named project; use save_as with an accepted target path.");
    }
    if (input.operation === "save_current" && input.dry_run !== true) {
      const currentPath = exactPath(beforePath);
      assertMutationIdentityFitsPublicBudget({
        entry,
        request,
        startedAt,
        operation,
        path: currentPath,
        projectRef: `project:path:${currentPath}`,
        publicBudgetBytes,
      });
    }
    if (input.dry_run === true) {
      stages.push({ id: "file-live-save-current", kind: "template_execute", status: "skipped", summary: "Mutation skipped during dry_run.", evidence_refs: [] });
      stages.push({ id: "file-live-save-as", kind: "template_execute", status: "skipped", summary: "Mutation skipped during dry_run.", evidence_refs: [] });
      stages.push({ id: "file-result-project", kind: "result_project", status: "completed", summary: "Validated save operation without mutation.", evidence_refs: collectedEvidence() });
      return fileEnvelope({ entry, request, startedAt, now, status: "dry_run_completed", stages, blockers: [], summary: "Project-file save preview completed.", data: { operation: input.operation, path_before: exactPath(beforePath), dirty_before: dirtyProjection(beforeDirty), mutation_skipped: true }, verificationEvidenceRefs: collectedEvidence(), publicBudgetBytes });
    }
    const saveId = input.operation === "save_current" ? SAVE_CURRENT_ID : SAVE_AS_ID;
    const saveInput = input.operation === "save_as" ? { target_path: input.target_path, overwrite: true } : {};
    mutationAttempted = true;
    await run(input.operation === "save_current" ? "file-live-save-current" : "file-live-save-as", saveId, saveInput);
    afterPath = readback(await run("file-read-after-path", READ_PATH_ID));
    afterDirty = readback(await run("file-read-after-dirty", READ_DIRTY_ID));
    const expectedPath = input.operation === "save_current" ? exactPath(beforePath) : input.target_path;
    if (exactPath(afterPath) !== expectedPath) throw macroError("PROJECT_FILE_PATH_READBACK_MISMATCH", "Project-file save completed but exact path readback did not match the required path.");
    if (!isCleanDirtyState(afterDirty)) throw macroError("PROJECT_FILE_DIRTY_READBACK_MISMATCH", "Project-file save completed but exact dirty-state readback was not clean.");
    verifiedChange = projectFileChange(input.operation, afterPath, afterDirty);
    stages.push({ id: "file-index-maintenance", kind: "runtime_execute", status: "running", evidence_refs: [] });
    invalidation = await maintainProjectFileIndex(projectIndexRuntime, input.operation, beforePath, afterPath, now);
    if (input.operation === "save_current" && invalidation === null) {
      stages.at(-1).status = "skipped";
      stages.at(-1).summary = "Project Index is not configured; save_current completed without changing any index identity.";
      verifiedChange.index_maintenance = indexMaintenance("skipped", null);
    } else if (invalidation?.ok !== true) {
      stages.at(-1).status = "failed";
      stages.at(-1).summary = invalidation?.blockers?.[0]?.message ?? "Project Index identity maintenance failed.";
      verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
      throw macroError(
        invalidation?.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_MAINTENANCE_FAILED",
        invalidation?.blockers?.[0]?.message ?? "Project-file save completed but Project Index identity maintenance failed.",
      );
    } else {
      stages.at(-1).status = "completed";
      stages.at(-1).summary = input.operation === "save_as"
        ? "Project Index identity rebound to the exact live Save As path."
        : "Project Index project-head scope invalidated without changing identity.";
      verifiedChange.index_maintenance = indexMaintenance("completed", invalidation);
    }
    stages.push({ id: "file-result-project", kind: "result_project", status: "completed", summary: "Project-file save verified by exact path and dirty-state readback.", evidence_refs: collectedEvidence() });
    return fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "completed",
      stages,
      blockers: [],
      summary: "Project-file save completed and was verified.",
      data: {
        operation: input.operation,
        path_before: exactPath(beforePath),
        path_after: exactPath(afterPath),
        dirty_before: dirtyProjection(beforeDirty),
        dirty_after: dirtyProjection(afterDirty),
        atomic_calls: calls.length,
        index_update: compactIndexUpdate(invalidation),
        outcome: projectFileOutcome(verifiedChange, invalidation),
      },
      changes: [verifiedChange],
      sqlite: sqliteEvidence(projectIndexRuntime, invalidation),
      verificationEvidenceRefs: collectedEvidence(),
      publicBudgetBytes,
      mutationAttempted,
    });
  } catch (error) {
    const readbackPassed = verifiedChange?.live_readback?.status === "passed";
    if (error?.code === "RESPONSE_TOO_LARGE" || error?.code === "PROJECT_FILE_RESPONSE_TOO_LARGE") {
      return fileEnvelope({
        entry,
        request,
        startedAt,
        now,
        status: mutationAttempted ? "partial_failure" : "failed",
        stages,
        blockers: [blocker(error.code, error.message ?? "Project-file Macro response budget exceeded.", {
          ...(error.details ?? {}),
          zero_write: mutationAttempted ? false : true,
          outcome: mutationAttempted ? "unknown" : (error.details?.outcome ?? undefined),
          recoverable: mutationAttempted ? false : true,
        }, mutationAttempted ? false : true)],
        summary: error.message ?? "Project-file Macro response budget exceeded.",
        data: {
          operation: input.operation ?? null,
          zero_write: mutationAttempted ? false : true,
          outcome: {
            mutation: { status: mutationAttempted ? "unknown" : "not_run" },
            live_readback: { status: readbackPassed ? "passed" : "not_run" },
            index_maintenance: { status: "not_run", blocker_code: null },
          },
        },
        changes: verifiedChange ? [verifiedChange] : [],
        verificationStatus: readbackPassed ? "passed" : "not_required",
        publicBudgetBytes,
        mutationAttempted,
      });
    }
    const mutationUnknown = mutationAttempted === true;
    const failureDetails = {
      ...(error.details ?? {}),
      zero_write: mutationUnknown ? false : true,
      ...(mutationUnknown ? { outcome: "unknown", recoverable: false } : {}),
    };
    return fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: mutationAttempted ? "partial_failure" : "failed",
      stages,
      blockers: [blocker(error.code ?? "PROJECT_FILE_EXECUTION_FAILED", error.message ?? "Project-file Macro failed.", failureDetails, mutationUnknown ? false : error.details?.recoverable)],
      summary: error.message ?? "Project-file Macro failed.",
      data: {
        operation: input.operation ?? null,
        path_before: exactPath(beforePath),
        path_after: exactPath(afterPath),
        dirty_before: dirtyProjection(beforeDirty),
        dirty_after: dirtyProjection(afterDirty),
        calls: calls.length,
        index_update: compactIndexUpdate(invalidation),
        zero_write: mutationUnknown ? false : true,
        outcome: {
          mutation: { status: mutationUnknown ? "unknown" : "not_run" },
          live_readback: { status: readbackPassed ? "passed" : "not_run" },
          index_maintenance: {
            status: verifiedChange?.index_maintenance?.status ?? "not_run",
            scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
            blocker_code: invalidation?.blockers?.[0]?.code ?? null,
          },
        },
      },
      changes: verifiedChange ? [verifiedChange] : [],
      sqlite: sqliteEvidence(projectIndexRuntime, invalidation),
      verificationStatus: readbackPassed ? "passed" : undefined,
      verificationEvidenceRefs: readbackPassed ? collectedEvidence() : [],
      publicBudgetBytes,
      mutationAttempted,
    });
  }
}

async function executeListOpenProjects({ entry, request, input, executeAtomic, startedAt, now }) {
  const stages = [];
  const calls = [];
  const limit = input.limit === undefined ? LIST_DEFAULT_LIMIT : input.limit;
  const cursor = input.cursor === undefined ? 0 : input.cursor;
  const publicBudgetBytes = resolvePublicBudgetBytes(request);
  stages.push({ id: "file-list-open-projects", kind: "template_execute", status: "running", evidence_refs: [] });
  try {
    const execution = await executeAtomic({
      id: LIST_OPEN_ID,
      input: { cursor, limit },
      refs: [],
      context: request.context,
      budget: internalOpenProjectListBudget(request),
    });
    calls.push(execution);
    stages.at(-1).status = execution?.ok === true ? "completed" : "failed";
    stages.at(-1).evidence_refs = evidenceRefs(execution);
    if (execution?.ok !== true) throw executionError(LIST_OPEN_ID, execution);
    const page = listPageProjection(readback(execution));
    if (page.returned_count !== page.projects.length) {
      throw macroError("PROJECT_FILE_LIST_COUNT_MISMATCH", "list_open_projects returned_count must equal the actual project row count.");
    }
    stages.push({ id: "file-result-project", kind: "result_project", status: "completed", summary: "Open-project page returned without selection or index write.", evidence_refs: uniqueEvidenceRefs(calls.flatMap(evidenceRefs)) });
    const envelope = fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "completed",
      stages: compactStagesForBudget(stages),
      blockers: [],
      summary: "Open projects listed from live inventory.",
      data: {
        operation: "list_open_projects",
        projects: page.projects,
        total_count: page.total_count,
        returned_count: page.returned_count,
        cursor: page.cursor,
        next_cursor: page.next_cursor,
        coverage_status: page.coverage_status,
        truncated: page.truncated,
        index_write: false,
        selection: false,
        outcome: {
          mutation: { status: "not_run" },
          live_readback: { status: "passed" },
          index_maintenance: { status: "not_run", scopes: [], blocker_code: null },
        },
      },
      verificationEvidenceRefs: [],
      publicBudgetBytes,
      listIdentityGuard: true,
    });
    return envelope;
  } catch (error) {
    if (stages.length > 0) stages.at(-1).status = "failed";
    if (error?.code === "RESPONSE_TOO_LARGE" || error?.code === "PROJECT_FILE_RESPONSE_TOO_LARGE") {
      return listBudgetFailureEnvelope({ entry, request, startedAt, now, stages, error, publicBudgetBytes, limit });
    }
    return fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "failed",
      stages: compactStagesForBudget(stages),
      blockers: [blocker(error.code ?? "PROJECT_FILE_LIST_FAILED", error.message ?? "list_open_projects failed.", error.details)],
      summary: error.message ?? "list_open_projects failed.",
      data: { operation: "list_open_projects", index_write: false, selection: false },
      publicBudgetBytes,
    });
  }
}

async function executeProjectSwitchOperation({ entry, request, input, executeAtomic, projectIndexRuntime, startedAt, now }) {
  const stages = [];
  const calls = [];
  const operation = String(input.operation).trim();
  const collectedEvidence = () => uniqueEvidenceRefs(calls.flatMap(evidenceRefs));
  let mutationAttempted = false;
  let verifiedChange = null;
  let invalidation = null;
  let inventory = null;
  let nativeResult = null;
  let pathAfter = null;
  let dirtyAfter = null;

  const publicBudgetBytes = resolvePublicBudgetBytes(request);
  const childBudget = internalAtomicChildBudget(request);
  let indexUsed = false;
  let mutationStatus = "not_run";
  let createAtomSucceeded = false;
  let saveAsDispatched = false;
  const run = async (stageId, id, childInput = {}, refs = []) => {
    stages.push({ id: stageId, kind: "template_execute", status: "running", evidence_refs: [] });
    try {
      // Never forward the caller's public 2048 envelope budget to write atoms.
      const execution = await executeAtomic({ id, input: childInput, refs, context: request.context, budget: childBudget });
      calls.push(execution);
      stages.at(-1).status = execution?.ok === true ? "completed" : "failed";
      stages.at(-1).summary = typeof execution?.result?.summary === "string" ? execution.result.summary : `${id} completed.`;
      stages.at(-1).evidence_refs = evidenceRefs(execution);
      if (execution?.ok !== true) throw executionError(id, execution);
      return execution;
    } catch (error) {
      stages.at(-1).status = "failed";
      throw error;
    }
  };

  try {
    if (input.dry_run === true) {
      throw macroError("PROJECT_FILE_DRY_RUN_UNSUPPORTED", `${operation} rejects dry_run=true because the frozen atoms have no truthful no-write path.`);
    }

    // Preflight the minimum truthful partial-failure envelope before inventory,
    // index access, Undo, or any native project mutation.
    const targetPath = operation === "activate_project_tab"
      ? targetPathFromRef(input.project_ref)
      : input.target_path;
    assertMutationIdentityFitsPublicBudget({
      entry,
      request,
      startedAt,
      operation,
      path: targetPath,
      projectRef: operation === "activate_project_tab" ? input.project_ref : `project:path:${targetPath}`,
      publicBudgetBytes,
    });

    stages.push({ id: "file-list-open-projects", kind: "template_execute", status: "running", evidence_refs: [] });
    inventory = await hydrateCompleteOpenInventory(executeAtomic, request, calls);
    stages.at(-1).status = "completed";
    stages.at(-1).summary = `Hydrated complete open-project inventory (${inventory.total_count} projects, ${inventory.pages} page(s)).`;
    stages.at(-1).evidence_refs = collectedEvidence();
    const activeRow = inventory.projects.find((row) => row.active === true) ?? null;
    if (!activeRow) throw macroError("PROJECT_FILE_ACTIVE_ROW_MISSING", "Complete open-project inventory has no active project row.");

    // Only one explicitly clean native unsaved state may bypass preflight SQLite.
    if (
      activeRow.path_state !== "saved_project"
      && (
        activeRow.path_state !== "unsaved_project"
        || activeRow.saved !== false
        || activeRow.path !== ""
        || activeRow.dirty !== false
        || activeRow.raw_dirty_state !== 0
      )
    ) {
      throw macroError("PROJECT_FILE_ACTIVE_UNSAVED", "Live active project is not a proven clean unsaved tab; refuse switch before mutation.", {
        zero_write: true,
        path_state: activeRow.path_state,
        dirty: activeRow.dirty,
        raw_dirty_state: activeRow.raw_dirty_state ?? null,
      });
    }

    // Active unsaved + clean: recovery switch is authorized only by complete live
    // inventory and the exact saved target ref. SQLite rows never authorize selection.
    if (activeRow.path_state !== "saved_project") {
      stages.push({
        id: "file-index-preflight-sync",
        kind: "runtime_execute",
        status: "skipped",
        summary: "Active project is clean unsaved; switch continues from complete live inventory only (no SQLite authorize).",
        evidence_refs: [],
      });
      invalidation = {
        ok: true,
        status: "skipped_clean_unsaved_active",
        required: false,
        scopes: [],
        zero_write: true,
      };
    } else {
      invalidation = await synchronizeIndexToLiveActive(projectIndexRuntime, activeRow, now, stages);
      if (invalidation && invalidation.status !== "skipped") indexUsed = true;
      if (invalidation?.ok === false && invalidation?.required === true) {
        throw macroError(invalidation.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_SYNC_FAILED", invalidation.blockers?.[0]?.message ?? "Project Index could not synchronize to the live active saved project.", {
          zero_write: true,
        });
      }
    }

    if (operation === "create_project_tab") {
      mutationAttempted = true;
      mutationStatus = "unknown";
      const created = readback(await run("file-live-create-tab", CREATE_TAB_ID, {
        name: input.name,
        activate: true,
        copy_active_project_settings: false,
      }));
      if (
        created?.created !== true
        || created?.active !== true
        || created?.prior_dirty_unchanged !== true
        || created?.live_materialization !== "native_project_tab_verified"
      ) {
        throw macroError("PROJECT_FILE_CREATE_TAB_READBACK_FAILED", "create_project_tab native readback did not prove a real blank tab.", {
          partial_state: created?.partial_state ?? "blank_tab_may_remain",
        });
      }
      createAtomSucceeded = true;
      mutationStatus = "completed";
      nativeResult = created;
      try {
        saveAsDispatched = true;
        await run("file-live-save-as", SAVE_AS_ID, { target_path: input.target_path, overwrite: true });
      } catch (error) {
        throw macroError(error.code ?? "PROJECT_FILE_CREATE_SAVE_AS_FAILED", error.message ?? "Save As after create_project_tab failed.", {
          partial_state: "blank_tab_may_remain",
          ...(error.details ?? {}),
        });
      }
      try {
        pathAfter = readback(await run("file-read-after-path", READ_PATH_ID));
        dirtyAfter = readback(await run("file-read-after-dirty", READ_DIRTY_ID));
      } catch (error) {
        throw macroError(error.code ?? "PROJECT_FILE_CREATE_READBACK_FAILED", error.message ?? "Post-create path/dirty readback failed.", {
          partial_state: "saved_or_blank_tab_may_remain",
          ...(error.details ?? {}),
        });
      }
      if (exactPath(pathAfter) !== input.target_path) {
        throw macroError("PROJECT_FILE_CREATE_PATH_READBACK_MISMATCH", "create_project_tab Save As path readback did not match the exact target_path.", {
          partial_state: "saved_or_blank_tab_may_remain",
        });
      }
      if (!isCleanDirtyState(dirtyAfter)) {
        throw macroError("PROJECT_FILE_CREATE_DIRTY_READBACK_MISMATCH", "create_project_tab Save As dirty-state readback was not clean.", {
          partial_state: "saved_or_blank_tab_may_remain",
        });
      }
      verifiedChange = switchChange(operation, {
        project_ref: `project:path:${input.target_path}`,
        path: input.target_path,
        native: created,
        dirty: dirtyProjection(dirtyAfter),
        mutationStatus: "completed",
      });
      stages.push({ id: "file-index-maintenance", kind: "runtime_execute", status: "running", evidence_refs: [] });
      invalidation = await rebindIndexToPath(projectIndexRuntime, input.target_path, now);
      indexUsed = true;
      if (invalidation?.ok !== true) {
        stages.at(-1).status = "failed";
        verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
        throw macroError(invalidation?.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_MAINTENANCE_FAILED", invalidation?.blockers?.[0]?.message ?? "Create succeeded but Project Index rebind failed.");
      }
      stages.at(-1).status = "completed";
      verifiedChange.index_maintenance = indexMaintenance("completed", invalidation);
    } else if (operation === "open_project_in_tab") {
      const already = inventory.projects.find((row) => row.path_state === "saved_project" && (row.path === input.target_path || row.project_ref === `project:path:${input.target_path}` || row.exact_path === input.target_path));
      if (already) {
        throw macroError("PROJECT_FILE_ALREADY_OPEN", "Target project is already open; zero-write blocker.", {
          project_ref: already.project_ref,
          zero_write: true,
        });
      }
      mutationAttempted = true;
      mutationStatus = "unknown";
      const opened = readback(await run("file-live-open-in-tab", OPEN_IN_TAB_ID, { path: input.target_path }));
      if (
        opened?.opened !== true
        || opened?.project_ref !== `project:path:${input.target_path}`
        || opened?.path !== input.target_path
        || opened?.active !== true
        || opened?.prior_project_remains_open !== true
        || opened?.prior_dirty_unchanged !== true
        || opened?.live_materialization !== "native_open_in_tab_verified"
      ) {
        throw macroError("PROJECT_FILE_OPEN_READBACK_FAILED", "open_project_in_tab native readback did not match the exact contract.", {
          partial_state: opened?.partial_state ?? null,
        });
      }
      nativeResult = opened;
      mutationStatus = "completed";
      verifiedChange = switchChange(operation, {
        project_ref: opened.project_ref,
        path: input.target_path,
        native: opened,
        mutationStatus: "completed",
      });
      stages.push({ id: "file-index-maintenance", kind: "runtime_execute", status: "running", evidence_refs: [] });
      invalidation = await rebindIndexToPath(projectIndexRuntime, input.target_path, now);
      indexUsed = true;
      if (invalidation?.ok !== true) {
        stages.at(-1).status = "failed";
        verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
        throw macroError(invalidation?.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_MAINTENANCE_FAILED", invalidation?.blockers?.[0]?.message ?? "Open succeeded but Project Index rebind failed.");
      }
      stages.at(-1).status = "completed";
      verifiedChange.index_maintenance = indexMaintenance("completed", invalidation);
    } else {
      const projectRef = input.project_ref;
      if (typeof projectRef !== "string" || !projectRef.startsWith("project:path:")) {
        throw macroError("PROJECT_FILE_UNSAVED_REF_UNSUPPORTED", "activate_project_tab accepts only a saved project:path ref; unsaved project:tab refs fail closed before mutation.", {
          recovery: "Use template.project.activate_project_tab directly for unsaved tab debug only; Project Index cannot bind unsaved paths.",
          zero_write: true,
        });
      }
      const matches = inventory.projects.filter((row) => row.project_ref === projectRef);
      if (matches.length === 0) {
        throw macroError("PROJECT_FILE_TARGET_NOT_FOUND", "Requested project_ref is not present in the complete open-project inventory.", {
          project_ref: projectRef,
          total_count: inventory.total_count,
          coverage_status: "complete",
          zero_write: true,
        });
      }
      if (
        matches.length !== 1
        || matches[0].path_state !== "saved_project"
        || matches[0].saved !== true
        || matches[0].path !== targetPathFromRef(projectRef)
      ) {
        throw macroError("PROJECT_FILE_TARGET_AMBIGUOUS", "Requested project_ref did not resolve to exactly one saved open project.", {
          project_ref: projectRef,
          zero_write: true,
        });
      }
      const target = matches[0];
      if (target.active === true) {
        mutationStatus = "not_run";
        verifiedChange = switchChange(operation, {
          project_ref: target.project_ref,
          path: targetPathFromRef(target.project_ref),
          native: {
            activated: true,
            already_active: true,
            selection_mode: "already_active",
            prior_project_remains_open: true,
            prior_dirty_unchanged: true,
            live_materialization: "native_activate_idempotent",
          },
          mutationStatus: "not_run",
        });
        stages.push({ id: "file-live-activate-tab", kind: "template_execute", status: "skipped", summary: "Already active; zero selection.", evidence_refs: [] });
        stages.push({ id: "file-index-maintenance", kind: "runtime_execute", status: "running", evidence_refs: [] });
        invalidation = await rebindIndexToPath(projectIndexRuntime, targetPathFromRef(target.project_ref), now);
        indexUsed = true;
        if (invalidation?.ok !== true) {
          stages.at(-1).status = "failed";
          verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
          throw macroError(invalidation?.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_MAINTENANCE_FAILED", invalidation?.blockers?.[0]?.message ?? "Already-active success but Project Index rebind failed.");
        }
        stages.at(-1).status = "completed";
        verifiedChange.index_maintenance = indexMaintenance("completed", invalidation);
      } else {
        mutationAttempted = true;
        mutationStatus = "unknown";
        const activated = readback(await run("file-live-activate-tab", ACTIVATE_TAB_ID, {}, [{
          kind: "project",
          ref: projectRef,
          identity: { scheme: "path", value: targetPathFromRef(projectRef) },
        }]));
        if (
          activated?.activated !== true
          || activated?.project_ref !== projectRef
          || activated?.prior_project_remains_open !== true
          || activated?.prior_dirty_unchanged !== true
          || (activated?.live_materialization !== "native_activate_verified" && activated?.live_materialization !== "native_activate_idempotent")
        ) {
          throw macroError("PROJECT_FILE_ACTIVATE_READBACK_FAILED", "activate_project_tab native readback did not match the exact contract.", {
            partial_state: activated?.partial_state ?? null,
          });
        }
        nativeResult = activated;
        mutationStatus = "completed";
        verifiedChange = switchChange(operation, {
          project_ref: projectRef,
          path: targetPathFromRef(projectRef),
          native: activated,
          mutationStatus: "completed",
        });
        stages.push({ id: "file-index-maintenance", kind: "runtime_execute", status: "running", evidence_refs: [] });
        invalidation = await rebindIndexToPath(projectIndexRuntime, targetPathFromRef(projectRef), now);
        indexUsed = true;
        if (invalidation?.ok !== true) {
          stages.at(-1).status = "failed";
          verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
          throw macroError(invalidation?.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_MAINTENANCE_FAILED", invalidation?.blockers?.[0]?.message ?? "Activate succeeded but Project Index rebind failed.");
        }
        stages.at(-1).status = "completed";
        verifiedChange.index_maintenance = indexMaintenance("completed", invalidation);
      }
    }

    stages.push({ id: "file-result-project", kind: "result_project", status: "completed", summary: `${operation} verified from native live readback.`, evidence_refs: [] });
    return switchEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: "completed",
      stages,
      blockers: [],
      summary: `${operation} completed and was verified.`,
      data: {
        operation,
        project_ref: verifiedChange.project_ref,
        path_after: verifiedChange.path ?? exactPath(pathAfter),
        inventory: { total_count: inventory?.total_count ?? null, coverage_status: inventory?.coverage_status ?? null },
        outcome: {
          mutation: { status: mutationStatus },
          live_readback: { status: "passed" },
          index_maintenance: {
            status: verifiedChange.index_maintenance?.status ?? null,
            blocker_code: verifiedChange.index_maintenance?.blocker_code ?? null,
          },
        },
      },
      changes: [compactSwitchChangeForBudget(verifiedChange)],
      verificationStatus: "passed",
      publicBudgetBytes,
      indexUsed,
      invalidation,
    });
  } catch (error) {
    const readbackPassed = verifiedChange?.live_readback?.status === "passed";
    let partialState = error?.details?.partial_state ?? nativeResult?.partial_state ?? null;
    if (!partialState && createAtomSucceeded && !saveAsDispatched) partialState = "blank_tab_may_remain";
    if (!partialState && createAtomSucceeded && saveAsDispatched && !readbackPassed) partialState = "saved_or_blank_tab_may_remain";
    if (error?.code === "RESPONSE_TOO_LARGE" || error?.code === "PROJECT_FILE_RESPONSE_TOO_LARGE") {
      return switchBudgetFailureEnvelope({
        entry,
        request,
        startedAt,
        now,
        stages,
        error,
        publicBudgetBytes,
        operation,
        mutationAttempted,
      });
    }
    return switchEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: mutationAttempted ? "partial_failure" : "failed",
      stages,
      blockers: [blocker(error.code ?? "PROJECT_FILE_SWITCH_FAILED", error.message ?? "Project switch Macro failed.", {
        ...(error.details ?? {}),
        ...(partialState ? { partial_state: partialState } : {}),
      }, error.recoverable)],
      summary: error.message ?? "Project switch Macro failed.",
      data: {
        operation,
        project_ref: verifiedChange?.project_ref ?? null,
        path_after: verifiedChange?.path ?? exactPath(pathAfter),
        inventory: inventory
          ? { total_count: inventory.total_count ?? null, coverage_status: inventory.coverage_status ?? null }
          : null,
        outcome: {
          mutation: { status: mutationAttempted ? mutationFailureStatus(error, mutationStatus) : "not_run" },
          live_readback: { status: readbackPassed ? "passed" : "not_run" },
          index_maintenance: {
            status: verifiedChange?.index_maintenance?.status ?? (invalidation?.ok === false ? "failed" : "not_run"),
            blocker_code: verifiedChange?.index_maintenance?.blocker_code ?? invalidation?.blockers?.[0]?.code ?? null,
          },
        },
        zero_write: error?.details?.zero_write === true || !mutationAttempted,
        partial_state: partialState,
      },
      changes: verifiedChange ? [compactSwitchChangeForBudget(verifiedChange)] : [],
      verificationStatus: readbackPassed ? "passed" : "not_required",
      publicBudgetBytes,
      indexUsed,
      invalidation,
    });
  }
}

function switchEnvelope({
  entry,
  request,
  startedAt,
  now,
  status,
  stages,
  blockers,
  summary,
  data,
  changes,
  verificationStatus,
  publicBudgetBytes = PUBLIC_RESPONSE_BUDGET_BYTES,
  indexUsed = false,
  invalidation = null,
}) {
  const failed = status !== "completed";
  const preserveDryRun = request.input?.dry_run === true;
  const sqlite = compactSqliteTruth(indexUsed, invalidation);
  const primaryBlocker = blockers?.[0] ?? null;
  const unknownOutcome = primaryBlocker?.details?.outcome === "unknown";
  const recoveryAction = unknownOutcome && primaryBlocker?.recoverable === false
    ? "Inspect live project state; do not replay this unknown mutation automatically."
    : "Repair blocker and retry.";
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: !failed,
    macro: { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk },
    request: { request_id: normalizedRequestId(request.request_id), dry_run: preserveDryRun },
    execution: {
      status,
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: 0,
      stages: (stages ?? []).slice(0, 4).map((stage) => ({
        id: stage.id,
        kind: stage.kind ?? "template_execute",
        status: stage.status === "running" ? "failed" : (stage.status ?? "failed"),
        evidence_refs: [],
      })),
    },
    sqlite,
    result: {
      summary: boundedSafeUtf8(summary, 64),
      canonical_refs: [],
      changes,
      verification: { status: verificationStatus, evidence_refs: [] },
      artifact_refs: [],
      data,
    },
    blockers: failed
      ? blockers.slice(0, 1).map((item) => ({
        code: item.code,
        message: boundedSafeUtf8(item.message, 80),
        recoverable: item.recoverable !== false,
        ...(item.details ? { details: compactBlockerDetails(item.details) } : {}),
      }))
      : [],
    error: failed
      ? {
        code: blockers[0]?.code ?? "PROJECT_FILE_FAILED",
        message: boundedSafeUtf8(summary, 80),
        recoverable: primaryBlocker?.recoverable !== false,
        ...(blockers[0]?.details ? { details: compactBlockerDetails(blockers[0].details) } : {}),
      }
      : null,
    recovery: failed
      ? { action: recoveryAction, sqlite_rows_authorize_writes: false }
      : null,
    budget: { max_bytes: publicBudgetBytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  const ceiling = Math.min(publicBudgetBytes, PUBLIC_RESPONSE_BUDGET_BYTES);
  envelope.budget.max_bytes = ceiling;
  envelope.execution.stage_count = envelope.execution.stages.length;
  const measure = () => {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope));
    return envelope.budget.actual_bytes;
  };
  measure();
  if (envelope.budget.actual_bytes > ceiling) {
    envelope.execution.stages = envelope.execution.stages.slice(0, 2);
    envelope.execution.stage_count = envelope.execution.stages.length;
    envelope.result.summary = boundedSafeUtf8(summary, 32);
    if (failed && Array.isArray(envelope.blockers) && envelope.blockers.length > 1) {
      envelope.blockers = envelope.blockers.slice(0, 1);
    }
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling) {
    envelope.execution.stages = [];
    envelope.execution.stage_count = 0;
    if (Array.isArray(envelope.result?.changes) && envelope.result.changes.length > 0) {
      compactMutationTruthEnvelope(envelope, { failed });
    } else if (envelope.result?.data) {
      envelope.result.data = {
        operation: envelope.result.data.operation ?? null,
        outcome: envelope.result.data.outcome ?? null,
        zero_write: envelope.result.data.zero_write === true,
        partial_state: envelope.result.data.partial_state ?? null,
      };
      envelope.result.canonical_refs = [];
    }
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && !failed) {
    throw macroError("PROJECT_FILE_RESPONSE_TOO_LARGE", "Project switch result exceeds the public response budget after mutation.", {
      required_response_bytes: envelope.budget.actual_bytes,
      max_response_bytes: ceiling,
      outcome: "unknown",
      recoverable: false,
      zero_write: false,
      next_action: "Inspect live project state before deciding whether any mutation should be retried.",
    });
  }
  if (envelope.budget.actual_bytes > ceiling) {
    // Failed path: hard strip while keeping required timestamps; never forge actual_bytes or set truncated.
    envelope.result.summary = "budget";
    envelope.execution = {
      status: envelope.execution?.status ?? "failed",
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: 0,
      stages: [],
    };
    envelope.result.data = {
      operation: data?.operation ?? null,
      zero_write: data?.zero_write === true,
      outcome: data?.outcome ?? null,
    };
    envelope.recovery = {
      action: unknownOutcome
        ? "Inspect live project state; do not replay this unknown mutation automatically."
        : "Repair blocker and retry.",
      sqlite_rows_authorize_writes: false,
    };
    if (envelope.blockers.length > 0) {
      envelope.blockers = [{
        code: envelope.blockers[0].code,
        message: boundedSafeUtf8(envelope.blockers[0].message, 48),
        recoverable: envelope.blockers[0].recoverable !== false,
        details: compactBlockerDetails(envelope.blockers[0].details ?? {}),
      }];
      envelope.error = {
        code: envelope.blockers[0].code,
        message: envelope.blockers[0].message,
        recoverable: envelope.blockers[0].recoverable !== false,
        ...(envelope.blockers[0].details ? { details: envelope.blockers[0].details } : {}),
      };
    }
    envelope.budget.truncated = false;
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling) {
    return deepFreeze(buildMinimalBudgetFailureEnvelope({
      entry,
      request,
      startedAt,
      now,
      ceiling,
      operation: data?.operation ?? null,
      zeroWrite: data?.zero_write === true,
      unknownOutcome,
      code: primaryBlocker?.code ?? "RESPONSE_TOO_LARGE",
    }));
  }
  measure();
  const validation = validateMacroExecutionEnvelope(envelope);
  if (!validation.valid) {
    return deepFreeze(buildMinimalBudgetFailureEnvelope({
      entry,
      request,
      startedAt,
      now,
      ceiling,
      operation: data?.operation ?? null,
      zeroWrite: data?.zero_write === true,
      unknownOutcome,
      code: primaryBlocker?.code ?? "RESPONSE_TOO_LARGE",
    }));
  }
  return deepFreeze(envelope);
}

function buildMinimalBudgetFailureEnvelope({
  entry,
  request,
  startedAt,
  now,
  ceiling,
  operation,
  zeroWrite,
  unknownOutcome,
  code,
  details = null,
  message = "budget",
}) {
  // Ultra-compact typed failure for small public ceilings (1024+). Honest actual_bytes only.
  // Keep full blocker codes (macro codes can exceed 32 chars).
  const shortCode = String(code ?? "RESPONSE_TOO_LARGE").slice(0, 64);
  const detailObj = {
    ...(zeroWrite === true ? { zero_write: true } : {}),
    ...(unknownOutcome ? { outcome: "unknown" } : {}),
    ...compactBlockerDetails(details ?? {}),
  };
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: {
      id: entry.macro_id,
      program_id: entry.program_id,
      program_version: entry.program_version,
      risk: entry.risk,
    },
    request: {
      request_id: normalizedRequestId(request.request_id),
      dry_run: request.input?.dry_run === true,
    },
    execution: {
      status: unknownOutcome ? "partial_failure" : (String(statusLike(request)) || "failed"),
      started_at: startedAt,
      completed_at: safeNowIso(now),
      stage_count: 0,
      stages: [],
    },
    sqlite: {
      used: false,
      source: "not_used",
      freshness: "not_applicable",
      snapshot_ref: null,
      revision: null,
      refreshed: false,
    },
    result: {
      summary: boundedSafeUtf8(message, 48),
      canonical_refs: [],
      changes: [],
      verification: { status: "not_required", evidence_refs: [] },
      artifact_refs: [],
      data: {
        operation: typeof operation === "string" ? operation.slice(0, 32) : null,
        zero_write: zeroWrite === true,
      },
    },
    blockers: [{
      code: shortCode,
      message: boundedSafeUtf8(message, 80),
      recoverable: unknownOutcome ? false : true,
      details: detailObj,
    }],
    error: {
      code: shortCode,
      message: boundedSafeUtf8(message, 80),
      recoverable: unknownOutcome ? false : true,
      details: detailObj,
    },
    recovery: null,
    budget: {
      max_bytes: ceiling,
      actual_bytes: 0,
      truncated: false,
      artifact_fallback: false,
    },
  };
  const measureHonest = () => {
    envelope.budget.actual_bytes = 0;
    for (let i = 0; i < 4; i += 1) {
      const next = Buffer.byteLength(JSON.stringify(envelope));
      if (next === envelope.budget.actual_bytes) break;
      envelope.budget.actual_bytes = next;
    }
    return envelope.budget.actual_bytes;
  };
  measureHonest();
  if (envelope.budget.actual_bytes > ceiling) {
    // Drop field samples if still over; keep counts.
    if (envelope.blockers[0]?.details) {
      const d = envelope.blockers[0].details;
      envelope.blockers[0].details = {
        ...(d.zero_write === true ? { zero_write: true } : {}),
        ...(Number.isInteger(d.field_count) ? { field_count: d.field_count } : {}),
        ...(Number.isInteger(d.omitted_field_count) ? { omitted_field_count: d.omitted_field_count } : {}),
        ...(Array.isArray(d.fields) ? { fields: d.fields.slice(0, 8).map((f) => String(f).slice(0, 40)) } : {}),
        ...(d.outcome ? { outcome: d.outcome } : {}),
      };
      envelope.error.details = envelope.blockers[0].details;
    }
    measureHonest();
  }
  if (envelope.budget.actual_bytes > ceiling) {
    envelope.result.data = { zero_write: zeroWrite === true };
    measureHonest();
  }
  return envelope;
}

function compactSwitchChangeForBudget(change) {
  if (!change) return change;
  return {
    kind: change.kind,
    action: change.action,
    project_ref: change.project_ref ?? change.path ?? null,
    status: change.status,
    mutation: change.mutation,
    live_readback: { status: change.live_readback?.status ?? null },
    index_maintenance: {
      status: change.index_maintenance?.status ?? null,
      blocker_code: change.index_maintenance?.blocker_code ?? null,
    },
  };
}

function resolvePublicBudgetBytes(request) {
  // Product public ceiling is 2048. Callers may request lower, never higher for the Macro envelope.
  const requested = request?.budget?.max_response_bytes;
  if (Number.isInteger(requested) && requested > 0) {
    return Math.min(requested, PUBLIC_RESPONSE_BUDGET_BYTES);
  }
  return PUBLIC_RESPONSE_BUDGET_BYTES;
}

function mutationResponseBudgetFailureEnvelope({ entry, operation, request, startedAt, now }) {
  if (!MUTATING_PROJECT_FILE_OPERATIONS.has(operation)) return null;
  const requested = request?.budget?.max_response_bytes;
  if (Number.isInteger(requested) && requested > 0 && requested < PUBLIC_RESPONSE_BUDGET_BYTES) {
    return deepFreeze(buildMinimalBudgetFailureEnvelope({
      entry,
      request,
      startedAt,
      now,
      ceiling: PUBLIC_RESPONSE_BUDGET_BYTES,
      operation,
      zeroWrite: true,
      unknownOutcome: false,
      code: "PROJECT_FILE_RESPONSE_BUDGET_TOO_SMALL",
      message: "Project-file mutation operations require max_response_bytes >= 2048 before any atomic dispatch.",
      details: {
        operation,
        requested_max_response_bytes: requested,
        max_response_bytes: requested,
        required_minimum_bytes: PUBLIC_RESPONSE_BUDGET_BYTES,
        zero_write: true,
        recoverable: true,
      },
    }));
  }
  return null;
}

function normalizedRequestId(value) {
  if (typeof value !== "string" || value.length === 0) return "macro.project.file";
  return boundedSafeUtf8(value, 128);
}

/** Unified named internal budget for mutation/readback child atom calls. */
function internalAtomicChildBudget(request = null) {
  const callerBudget = isPlainObject(request?.budget) ? request.budget : {};
  const requestedMaxItems = Number.isInteger(callerBudget.max_items) && callerBudget.max_items > 0
    ? callerBudget.max_items
    : INTERNAL_ATOMIC_CHILD_BUDGET.max_items;
  return {
    // Never inherit the public 2048 response budget for write/readback atoms.
    max_response_bytes: INTERNAL_ATOMIC_CHILD_BUDGET.max_response_bytes,
    max_items: Math.min(requestedMaxItems, LIST_HARD_LIMIT),
    max_inline_value_bytes: Math.max(
      INTERNAL_ATOMIC_CHILD_BUDGET.max_inline_value_bytes,
      PROJECT_REF_MAX_BYTES,
    ),
  };
}

function internalOpenProjectListBudget(request) {
  // List hydration uses the named internal response budget; may honor caller's max_items bound.
  return internalAtomicChildBudget(request);
}

export function getAlpha3ProjectFileInternalAtomicChildBudget() {
  return internalAtomicChildBudget();
}

function assertMutationIdentityFitsPublicBudget({
  entry,
  request,
  startedAt,
  operation,
  path,
  projectRef,
  publicBudgetBytes,
}) {
  const changeKind = operation === "save_current" || operation === "save_as"
    ? "project_file"
    : "project_switch";
  const probe = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk },
    request: { request_id: normalizedRequestId(request.request_id), dry_run: false },
    execution: {
      status: "partial_failure",
      started_at: startedAt,
      completed_at: startedAt,
      stage_count: 0,
      stages: [],
    },
    sqlite: { used: true, source: "warm_index", freshness: "stale", snapshot_ref: null, revision: null, refreshed: false },
    result: {
      summary: "failed",
      canonical_refs: [],
      changes: [{
        kind: changeKind,
        action: operation,
        ...(typeof path === "string" ? { path } : {}),
        ...(typeof projectRef === "string" ? { project_ref: projectRef } : {}),
        status: "applied",
        mutation: { status: "completed" },
        live_readback: { status: "passed" },
        index_maintenance: { status: "failed", scopes: [], blocker_code: "PROJECT_FILE_INDEX_MAINTENANCE_FAILED" },
      }],
      verification: { status: "passed", evidence_refs: [] },
      artifact_refs: [],
      data: {
        operation,
        ...(typeof projectRef === "string" ? { project_ref: projectRef } : {}),
        path_after: typeof path === "string" ? path : null,
        outcome: {
          mutation: { status: "completed" },
          live_readback: { status: "passed" },
          index_maintenance: { status: "failed", blocker_code: "PROJECT_FILE_INDEX_MAINTENANCE_FAILED" },
        },
      },
    },
    blockers: [{
      code: "PROJECT_FILE_INDEX_MAINTENANCE_FAILED",
      message: "Project index maintenance failed after mutation.",
      recoverable: false,
      details: { outcome: "unknown", zero_write: false },
    }],
    error: {
      code: "PROJECT_FILE_INDEX_MAINTENANCE_FAILED",
      message: "Project index maintenance failed after mutation.",
      recoverable: false,
      details: { outcome: "unknown", zero_write: false },
    },
    recovery: { action: "Inspect live project state before retry.", sqlite_rows_authorize_writes: false },
    budget: { max_bytes: publicBudgetBytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  // Measure the same compact identity-preserving failure shape emitted when a
  // mutation succeeds but later readback/index maintenance fails. The verbose
  // construction above documents the full truth inputs; it is not the public
  // wire minimum and would reject ordinary absolute paths prematurely.
  compactMutationTruthEnvelope(probe, { failed: true });
  for (let index = 0; index < 4; index += 1) {
    const next = Buffer.byteLength(JSON.stringify(probe));
    if (next === probe.budget.actual_bytes) break;
    probe.budget.actual_bytes = next;
  }
  if (probe.budget.actual_bytes > publicBudgetBytes) {
    throw macroError("RESPONSE_TOO_LARGE", "Projected project identity cannot fit the public Macro response budget before mutation.", {
      zero_write: true,
      required_response_bytes: probe.budget.actual_bytes,
      max_response_bytes: publicBudgetBytes,
      request_patch: {
        // Public product ceiling remains 2048; shorten identity rather than raising the Macro envelope.
        input: { note: "shorten path/name/project_ref so the public Macro envelope fits within 2048 bytes" },
      },
    });
  }
}

function compactMutationTruthEnvelope(envelope, { failed }) {
  const change = Array.isArray(envelope.result?.changes) ? envelope.result.changes[0] : null;
  if (!change) return;
  const data = isPlainObject(envelope.result.data) ? envelope.result.data : {};
  const path = change.path ?? data.path_after ?? targetPathFromRef(change.project_ref ?? data.project_ref) ?? null;
  const projectRef = change.project_ref ?? data.project_ref ?? (typeof path === "string" ? `project:path:${path}` : null);
  const outcome = isPlainObject(data.outcome) ? data.outcome : {};
  const mutationStatus = change.mutation?.status ?? outcome.mutation?.status ?? (failed ? "unknown" : "completed");
  const readbackStatus = change.live_readback?.status ?? outcome.live_readback?.status ?? (failed ? "not_run" : "passed");
  const indexStatus = change.index_maintenance?.status ?? outcome.index_maintenance?.status ?? (failed ? "not_run" : "completed");
  const blockerCode = change.index_maintenance?.blocker_code ?? outcome.index_maintenance?.blocker_code ?? null;

  envelope.execution.stages = [];
  envelope.execution.stage_count = 0;
  envelope.result.summary = failed ? "failed" : "ok";
  envelope.result.verification.evidence_refs = [];
  envelope.result.changes = [{
    kind: change.kind ?? "project_file",
    action: change.action ?? data.operation ?? null,
    ...(typeof path === "string" ? { path } : {}),
    ...(typeof projectRef === "string" ? { project_ref: projectRef } : {}),
    status: change.status ?? "applied",
    mutation: { status: mutationStatus },
    live_readback: { status: readbackStatus },
    index_maintenance: { status: indexStatus, scopes: [], blocker_code: blockerCode },
  }];
  envelope.result.data = {
    operation: data.operation ?? change.action ?? null,
    // Failed compact envelopes retain the complete identity once in changes[].
    // Repeating path + project_ref here can make ordinary absolute paths look
    // unrepresentable even though the truthful public result fits under 2 KiB.
    ...(!failed && typeof projectRef === "string" ? { project_ref: projectRef } : {}),
    ...(!failed ? { path_after: path } : {}),
    outcome: {
      mutation: { status: mutationStatus },
      live_readback: { status: readbackStatus },
      index_maintenance: { status: indexStatus, blocker_code: blockerCode },
    },
    ...(data.partial_state ? { partial_state: data.partial_state } : {}),
    ...(data.zero_write === true ? { zero_write: true } : {}),
  };
  envelope.sqlite = envelope.sqlite?.used === true
    ? { used: true, source: "warm_index", freshness: "stale", snapshot_ref: envelope.sqlite.snapshot_ref ?? null, revision: envelope.sqlite.revision ?? null, refreshed: false }
    : { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  if (failed && envelope.blockers?.[0]) {
    const first = envelope.blockers[0];
    const details = first.details ?? {};
    envelope.blockers = [{
      code: first.code,
      message: boundedSafeUtf8(first.message ?? "failed", 48),
      recoverable: first.recoverable !== false,
      details: {
        ...(details.outcome ? { outcome: details.outcome } : {}),
        ...(details.zero_write === true ? { zero_write: true } : {}),
        ...(details.partial_state ? { partial_state: boundedSafeUtf8(details.partial_state, 64) } : {}),
      },
    }];
    envelope.error = {
      code: envelope.blockers[0].code,
      message: envelope.blockers[0].message,
      recoverable: envelope.blockers[0].recoverable,
      details: envelope.blockers[0].details,
    };
    envelope.recovery = {
      action: details.outcome === "unknown" ? "Inspect live project state before retry." : "Repair blocker and retry.",
      sqlite_rows_authorize_writes: false,
    };
  }
}

function compactSqliteTruth(indexUsed, invalidation) {
  if (!indexUsed) {
    return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  }
  const revision = invalidation?.revision ?? null;
  return {
    used: true,
    source: "warm_index",
    freshness: "stale",
    snapshot_ref: invalidation?.snapshot_id ?? null,
    revision: revision === null || revision === undefined ? null : String(revision),
    refreshed: false,
  };
}

function compactBlockerDetails(details) {
  if (!isPlainObject(details)) return undefined;
  const out = {};
  if (details.zero_write === true) out.zero_write = true;
  if (typeof details.operation === "string") out.operation = boundedSafeUtf8(details.operation, 32);
  if (typeof details.partial_state === "string") out.partial_state = boundedSafeUtf8(details.partial_state, 64);
  if (typeof details.recovery === "string") out.recovery = boundedSafeUtf8(details.recovery, 80);
  if (typeof details.outcome === "string") out.outcome = boundedSafeUtf8(details.outcome, 32);
  if (typeof details.reason === "string") out.reason = boundedSafeUtf8(details.reason, 64);
  if (typeof details.queue_state === "string") out.queue_state = boundedSafeUtf8(details.queue_state, 32);
  if (Number.isInteger(details.timeout_ms)) out.timeout_ms = details.timeout_ms;
  if (typeof details.recoverable === "boolean") out.recoverable = details.recoverable;
  if (Number.isInteger(details.required_response_bytes)) out.required_response_bytes = details.required_response_bytes;
  if (Number.isInteger(details.max_response_bytes)) out.max_response_bytes = details.max_response_bytes;
  if (Number.isInteger(details.requested_max_response_bytes)) out.requested_max_response_bytes = details.requested_max_response_bytes;
  if (Number.isInteger(details.required_minimum_bytes)) out.required_minimum_bytes = details.required_minimum_bytes;
  if (isPlainObject(details.request_patch)) out.request_patch = details.request_patch;
  if (typeof details.project_ref === "string") out.project_ref = details.project_ref;
  if (typeof details.coverage_status === "string") out.coverage_status = details.coverage_status;
  if (Number.isInteger(details.total_count)) out.total_count = details.total_count;
  if (Array.isArray(details.fields)) {
    out.fields = details.fields
      .slice(0, 8)
      .map((field) => boundedSafeUtf8(String(field ?? ""), 80))
      .filter((field) => field.length > 0);
  }
  if (Number.isInteger(details.field_count)) out.field_count = details.field_count;
  if (Number.isInteger(details.omitted_field_count)) out.omitted_field_count = details.omitted_field_count;
  return Object.keys(out).length > 0 ? out : undefined;
}

function listBudgetFailureEnvelope({ entry, request, startedAt, now, stages, error, publicBudgetBytes, limit }) {
  const details = error.details ?? {};
  const requestedLimit = details.request_patch?.input?.limit;
  const reducedLimit = Number.isInteger(requestedLimit) && requestedLimit > 0 && requestedLimit < (limit ?? LIST_DEFAULT_LIMIT)
    ? requestedLimit
    : Math.max(1, Math.floor((limit ?? LIST_DEFAULT_LIMIT) / 2));
  return fileEnvelope({
    entry,
    request,
    startedAt,
    now,
    status: "failed",
    stages: compactStagesForBudget(stages),
    blockers: [blocker("RESPONSE_TOO_LARGE", error.message ?? "list_open_projects page exceeds the public response budget.", {
      zero_write: true,
      required_response_bytes: details.required_response_bytes ?? null,
      max_response_bytes: details.max_response_bytes ?? publicBudgetBytes,
      request_patch: { input: { limit: reducedLimit } },
    })],
    summary: error.message ?? "list_open_projects page exceeds the public response budget.",
    data: {
      operation: "list_open_projects",
      index_write: false,
      selection: false,
      zero_write: true,
    },
    publicBudgetBytes,
  });
}

function switchBudgetFailureEnvelope({ entry, request, startedAt, now, stages, error, publicBudgetBytes, operation, mutationAttempted }) {
  const details = error.details ?? {};
  const postMutationUnknown = mutationAttempted === true
    || details.outcome === "unknown"
    || details.recoverable === false
    || error.code === "PROJECT_FILE_RESPONSE_TOO_LARGE";
  const recoverable = postMutationUnknown ? false : true;
  const zeroWrite = postMutationUnknown ? false : true;
  return switchEnvelope({
    entry,
    request,
    startedAt,
    now,
    status: postMutationUnknown ? "partial_failure" : "failed",
    stages,
    blockers: [blocker(error.code ?? "RESPONSE_TOO_LARGE", error.message ?? "Project switch response budget exceeded.", {
      zero_write: zeroWrite,
      outcome: postMutationUnknown ? "unknown" : (details.outcome ?? undefined),
      recoverable,
      next_action: postMutationUnknown
        ? (details.next_action ?? "Inspect live project state before deciding whether any mutation should be retried.")
        : details.next_action,
      ...details,
      zero_write: zeroWrite,
      recoverable,
      ...(postMutationUnknown ? { outcome: "unknown" } : {}),
    }, recoverable)],
    summary: error.message ?? "Project switch response budget exceeded.",
    data: {
      operation,
      zero_write: zeroWrite,
      outcome: {
        mutation: { status: postMutationUnknown ? "unknown" : "not_run" },
        live_readback: { status: "not_run" },
        index_maintenance: { status: "not_run", blocker_code: null },
      },
    },
    changes: [],
    verificationStatus: "not_required",
    publicBudgetBytes,
    indexUsed: false,
  });
}

async function hydrateCompleteOpenInventory(executeAtomic, request, calls) {
  const projects = [];
  const listBudget = internalOpenProjectListBudget(request);
  let cursor = 0;
  let totalCount = null;
  let pages = 0;
  const seenCursors = new Set();
  while (pages < INTERNAL_INVENTORY_CEILING) {
    if (seenCursors.has(String(cursor))) {
      throw macroError("PROJECT_FILE_INVENTORY_CURSOR_STALLED", "Open-project inventory cursor did not advance during complete hydration.", {
        coverage_status: "paged",
        cursor,
      });
    }
    seenCursors.add(String(cursor));
    pages += 1;
    const execution = await executeAtomic({
      id: LIST_OPEN_ID,
      input: { cursor, limit: LIST_HARD_LIMIT },
      refs: [],
      context: request.context,
      budget: listBudget,
    });
    calls.push(execution);
    if (execution?.ok !== true) throw executionError(LIST_OPEN_ID, execution);
    const page = listPageProjection(readback(execution));
    if (totalCount === null) totalCount = page.total_count;
    if (page.total_count !== totalCount) {
      throw macroError("PROJECT_FILE_INVENTORY_UNSTABLE", "Open-project inventory total_count changed during complete hydration.");
    }
    for (const row of page.projects) projects.push(row);
    if (page.coverage_status === "complete") {
      if (page.next_cursor != null) {
        throw macroError("PROJECT_FILE_INVENTORY_COMPLETE_WITH_CURSOR", "Open-project inventory claimed complete coverage while next_cursor remained set.");
      }
      return { projects, total_count: totalCount, coverage_status: "complete", pages };
    }
    if (page.coverage_status === "paged" && page.next_cursor == null) {
      throw macroError("PROJECT_FILE_INVENTORY_PAGED_WITHOUT_CURSOR", "Open-project inventory claimed paged coverage without next_cursor.", {
        coverage_status: "paged",
      });
    }
    if (page.returned_count === 0) {
      throw macroError("PROJECT_FILE_INVENTORY_ZERO_PAGE", "Open-project inventory returned a zero-row page while coverage was incomplete.", {
        coverage_status: page.coverage_status,
      });
    }
    if (String(page.next_cursor) === String(cursor)) {
      throw macroError("PROJECT_FILE_INVENTORY_CURSOR_STALLED", "Open-project inventory next_cursor did not advance.", {
        coverage_status: "paged",
        cursor,
      });
    }
    cursor = page.next_cursor;
  }
  throw macroError("PROJECT_FILE_INVENTORY_CEILING", "Open-project inventory exceeds the bounded internal ceiling before complete coverage.", {
    total_count: totalCount,
    coverage_status: "paged",
    ceiling: INTERNAL_INVENTORY_CEILING,
  });
}

async function synchronizeIndexToLiveActive(runtime, activeRow, now, stages) {
  stages.push({ id: "file-index-preflight-sync", kind: "runtime_execute", status: "running", evidence_refs: [] });
  if (activeRow.path_state !== "saved_project" || typeof activeRow.project_ref !== "string" || !activeRow.project_ref.startsWith("project:path:")) {
    stages.at(-1).status = "failed";
    return {
      ok: false,
      required: true,
      blockers: [blocker("PROJECT_FILE_ACTIVE_UNSAVED", "Live active project is unsaved; Project Index cannot authorize a switch.", { zero_write: true })],
    };
  }
  if (runtime === null || runtime === undefined) {
    stages.at(-1).status = "skipped";
    stages.at(-1).summary = "Project Index is not configured; switch continues with live inventory only.";
    return { ok: true, status: "skipped", required: false, scopes: [] };
  }
  if (typeof runtime.status !== "function" || typeof runtime.rebindProjectIdentity !== "function") {
    stages.at(-1).status = "failed";
    return {
      ok: false,
      required: true,
      blockers: [blocker("PROJECT_INDEX_REBIND_UNAVAILABLE", "Project Index runtime does not expose identity rebind.")],
    };
  }
  const status = runtime.status() ?? {};
  const livePath = targetPathFromRef(activeRow.project_ref);
  if (status.project_ref === activeRow.project_ref && status.project_path === livePath) {
    stages.at(-1).status = "completed";
    stages.at(-1).summary = "Project Index already matches the live active saved project.";
    return { ok: true, status: "identity_unchanged", required: false, scopes: [], project_ref: status.project_ref, project_path: status.project_path };
  }
  if (typeof status.project_ref !== "string") {
    stages.at(-1).status = "failed";
    return {
      ok: false,
      required: true,
      blockers: [blocker("PROJECT_INDEX_PREVIOUS_IDENTITY_REQUIRED", "Project Index previous project_ref is required before preflight rebind.")],
    };
  }
  const rebound = await runtime.rebindProjectIdentity({
    project_path: livePath,
    expected_previous_project_ref: status.project_ref,
    observed_at: safeNowIso(now),
  });
  if (rebound?.ok !== true) {
    stages.at(-1).status = "failed";
    return { ...rebound, required: true };
  }
  stages.at(-1).status = "completed";
  stages.at(-1).summary = "Project Index synchronized to the live active saved project before mutation.";
  return { ...rebound, required: false };
}

async function rebindIndexToPath(runtime, projectPath, now) {
  if (runtime === null || runtime === undefined) {
    return { ok: true, status: "skipped", scopes: [], project_path: projectPath };
  }
  if (typeof runtime.rebindProjectIdentity !== "function" || typeof runtime.status !== "function") {
    return indexMaintenanceFailure("PROJECT_INDEX_REBIND_UNAVAILABLE", "Project Index runtime does not expose identity rebind.");
  }
  const status = runtime.status() ?? {};
  const expectedPreviousRef = status.project_ref;
  if (typeof expectedPreviousRef !== "string") {
    return indexMaintenanceFailure("PROJECT_INDEX_PREVIOUS_IDENTITY_REQUIRED", "Project Index previous project_ref is required before identity rebind.");
  }
  return runtime.rebindProjectIdentity({
    project_path: projectPath,
    expected_previous_project_ref: expectedPreviousRef,
    observed_at: safeNowIso(now),
  });
}

function listPageProjection(value) {
  const projects = Array.isArray(value?.projects)
    ? value.projects.map((row) => ({
      project_ref: row.project_ref ?? null,
      active: row.active === true,
      saved: typeof row.saved === "boolean" ? row.saved : null,
      path_state: row.path_state ?? null,
      name: row.name ?? null,
      path: row.path ?? null,
      path_truncated: row.path_truncated === true,
      dirty: typeof row.dirty === "boolean" ? row.dirty : null,
      raw_dirty_state: row.raw_dirty_state ?? null,
      tab_index: row.tab_index ?? null,
    }))
    : [];
  return {
    projects,
    total_count: Number.isInteger(value?.total_count) ? value.total_count : projects.length,
    returned_count: Number.isInteger(value?.returned_count) ? value.returned_count : projects.length,
    cursor: Number.isInteger(value?.cursor) ? value.cursor : 0,
    next_cursor: typeof value?.next_cursor === "string" ? value.next_cursor : null,
    coverage_status: value?.coverage_status === "paged" ? "paged" : "complete",
    truncated: value?.truncated === true,
  };
}

function switchChange(operation, facts) {
  return {
    kind: "project_switch",
    action: operation,
    project_ref: facts.project_ref,
    path: facts.path,
    status: "applied",
    mutation: { status: facts.mutationStatus ?? "completed" },
    live_readback: {
      status: "passed",
      source: "native_project_switch_atom",
      project_ref: facts.project_ref,
      path: facts.path,
      native: compactNative(facts.native),
      dirty: facts.dirty ?? null,
    },
    index_maintenance: { status: "pending", scopes: [], blocker_code: null },
  };
}

function compactNative(value) {
  if (!isPlainObject(value)) return null;
  return {
    project_ref: value.project_ref ?? null,
    created: value.created ?? null,
    opened: value.opened ?? null,
    activated: value.activated ?? null,
    already_active: value.already_active ?? null,
    active: value.active ?? null,
    prior_project_remains_open: value.prior_project_remains_open ?? null,
    prior_dirty_unchanged: value.prior_dirty_unchanged ?? null,
    prior_raw_dirty_state: value.prior_raw_dirty_state ?? null,
    selection_mode: value.selection_mode ?? null,
    live_materialization: value.live_materialization ?? null,
    partial_state: value.partial_state ?? null,
  };
}

function compactSwitchData(operation, inventory, nativeResult, change, invalidation, pathAfter, dirtyAfter, error = null) {
  return {
    operation,
    inventory: inventory ? {
      total_count: inventory.total_count,
      coverage_status: inventory.coverage_status,
      pages: inventory.pages,
    } : null,
    native: compactNative(nativeResult),
    path_after: exactPath(pathAfter),
    dirty_after: dirtyProjection(dirtyAfter),
    index_update: compactIndexUpdate(invalidation),
    outcome: projectFileOutcome(change, invalidation),
    partial_state: error?.details?.partial_state ?? nativeResult?.partial_state ?? null,
    zero_write: error?.details?.zero_write === true,
  };
}

function targetPathFromRef(projectRef) {
  return typeof projectRef === "string" && projectRef.startsWith("project:path:")
    ? projectRef.slice("project:path:".length)
    : null;
}

function fileEnvelope({
  entry,
  request,
  startedAt,
  now,
  status,
  stages,
  blockers,
  summary,
  data = {},
  changes = [],
  sqlite = null,
  verificationStatus = null,
  verificationEvidenceRefs = [],
  publicBudgetBytes = null,
  listIdentityGuard = false,
  mutationAttempted = false,
}) {
  const failed = status !== "completed" && status !== "dry_run_completed";
  const resolvedVerificationStatus = verificationStatus ?? (failed ? "not_required" : "passed");
  const preserveDryRun = request.input?.dry_run === true && (status === "dry_run_completed" || (failed && MUTATING_SWITCH_OPERATIONS.has(String(request.input?.operation ?? "").trim())));
  // All public Macro operations (list/save/switch) share the product 2048 ceiling.
  const ceiling = Number.isInteger(publicBudgetBytes) && publicBudgetBytes > 0
    ? Math.min(publicBudgetBytes, PUBLIC_RESPONSE_BUDGET_BYTES)
    : PUBLIC_RESPONSE_BUDGET_BYTES;
  const primaryBlocker = Array.isArray(blockers) && blockers.length > 0 ? blockers[0] : null;
  const postMutationUnknown = failed && (
    mutationAttempted === true
    || primaryBlocker?.details?.outcome === "unknown"
    || primaryBlocker?.recoverable === false
  );
  const fullEvidence = resolvedVerificationStatus === "passed"
    ? uniqueEvidenceRefs(verificationEvidenceRefs)
    : [];
  const normalizedStages = Array.isArray(stages)
    ? stages.map((stage) => {
      const statusValue = stage.status === "running" ? "failed" : (stage.status ?? "failed");
      return {
        id: stage.id,
        kind: stage.kind ?? "template_execute",
        status: statusValue,
        evidence_refs: Array.isArray(stage.evidence_refs) ? stage.evidence_refs : [],
        ...(typeof stage.summary === "string" ? { summary: stage.summary } : {}),
      };
    })
    : [];
  // Keep multiple preflight blockers when they fit; only trim after size measure if needed.
  const compactBlockers = failed
    ? (blockers ?? []).slice(0, 8).map((item) => ({
      code: item.code,
      message: boundedSafeUtf8(item.message ?? "blocked", 80),
      recoverable: postMutationUnknown ? false : item.recoverable !== false,
      ...(item.details ? { details: compactBlockerDetails(item.details) } : {}),
    }))
    : [];
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: !failed,
    macro: { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk },
    request: { request_id: normalizedRequestId(request.request_id), dry_run: preserveDryRun ? true : (failed ? false : request.input?.dry_run === true) },
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: normalizedStages.length, stages: normalizedStages },
    sqlite: sqlite ?? { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: {
      summary: typeof summary === "string" ? summary : "ok",
      canonical_refs: [],
      changes: Array.isArray(changes) ? changes : [],
      verification: {
        status: resolvedVerificationStatus,
        evidence_refs: fullEvidence,
      },
      artifact_refs: [],
      data,
    },
    blockers: compactBlockers,
    error: failed
      ? {
        code: compactBlockers[0]?.code ?? "PROJECT_FILE_FAILED",
        message: boundedSafeUtf8(summary, 80),
        recoverable: postMutationUnknown ? false : compactBlockers[0]?.recoverable !== false,
        ...(compactBlockers[0]?.details ? { details: compactBlockers[0].details } : {}),
      }
      : null,
    recovery: failed
      ? {
        action: postMutationUnknown
          ? "Inspect live project state before deciding whether any mutation should be retried."
          : "Repair the typed blocker and retry the same registered Macro.",
        sqlite_rows_authorize_writes: false,
      }
      : null,
    budget: { max_bytes: ceiling, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  const measure = () => {
    envelope.budget.actual_bytes = 0;
    for (let i = 0; i < 4; i += 1) {
      const next = Buffer.byteLength(JSON.stringify(envelope));
      if (next === envelope.budget.actual_bytes) break;
      envelope.budget.actual_bytes = next;
    }
    return envelope.budget.actual_bytes;
  };
  measure();
  if (envelope.budget.actual_bytes > ceiling) {
    if (listIdentityGuard && Array.isArray(data?.projects) && !failed) {
      throw macroError("RESPONSE_TOO_LARGE", "list_open_projects public page exceeds the response budget without truncating identities.", {
        zero_write: true,
        required_response_bytes: envelope.budget.actual_bytes,
        max_response_bytes: ceiling,
        request_patch: {
          input: {
            limit: Math.max(1, Math.floor((Number.isInteger(data.returned_count) ? data.returned_count : data.projects.length) / 2) || 1),
          },
        },
      });
    }
  }
  // Success path: iteratively compact non-identity noise until <= ceiling, never dropping path/index/change identity.
  if (!failed && envelope.budget.actual_bytes > ceiling) {
    const evidence = uniqueEvidenceRefs(verificationEvidenceRefs);
    // Pass 1: strip stage summaries; keep stage ids/status and full evidence on last stage.
    envelope.execution.stages = normalizedStages.map((stage, index) => ({
      id: stage.id,
      kind: stage.kind,
      status: stage.status,
      evidence_refs: index === normalizedStages.length - 1 ? evidence : [],
    }));
    envelope.execution.stage_count = envelope.execution.stages.length;
    envelope.result.verification.evidence_refs = evidence;
    envelope.result.summary = boundedSafeUtf8(summary, 48);
    measure();
  }
  if (!failed && envelope.budget.actual_bytes > ceiling) {
    // Pass 2: single terminal stage only.
    const evidence = envelope.result.verification.evidence_refs ?? [];
    const last = envelope.execution.stages.at(-1) ?? { id: "file-result-project", kind: "result_project", status: "completed" };
    envelope.execution.stages = [{
      id: last.id,
      kind: last.kind ?? "result_project",
      status: last.status ?? "completed",
      evidence_refs: evidence,
    }];
    envelope.execution.stage_count = 1;
    measure();
  }
  if (!failed && envelope.budget.actual_bytes > ceiling) {
    // Pass 3: drop bulky scope arrays (identity stays); keep required path/index/change fields.
    if (Array.isArray(envelope.result.changes) && envelope.result.changes[0]) {
      const change = envelope.result.changes[0];
      envelope.result.changes = [{
        kind: change.kind ?? "project_file",
        action: change.action ?? null,
        path: change.path ?? null,
        project_ref: change.project_ref ?? (typeof change.path === "string" ? `project:path:${change.path}` : null),
        status: change.status ?? "applied",
        mutation: change.mutation ?? { status: "completed" },
        live_readback: {
          status: change.live_readback?.status ?? "passed",
          source: change.live_readback?.source ?? "live_project_path_and_dirty_readback",
          path: change.live_readback?.path ?? change.path ?? null,
          dirty: change.live_readback?.dirty ?? null,
        },
        index_maintenance: {
          status: change.index_maintenance?.status ?? null,
          scopes: [],
          blocker_code: change.index_maintenance?.blocker_code ?? null,
        },
      }];
    }
    if (isPlainObject(envelope.result.data?.index_update)) {
      const iu = envelope.result.data.index_update;
      envelope.result.data.index_update = {
        status: iu.status ?? null,
        scopes: Array.isArray(iu.scopes) ? iu.scopes : [],
        project_ref: iu.project_ref ?? null,
        project_path: iu.project_path ?? null,
        session_id: iu.session_id ?? null,
        db_path: iu.db_path ?? null,
        old_rows_migrated: iu.old_rows_migrated ?? null,
        snapshot_id: iu.snapshot_id ?? null,
        revision: iu.revision ?? null,
      };
    }
    if (isPlainObject(envelope.result.data?.outcome?.index_maintenance)) {
      envelope.result.data.outcome.index_maintenance = {
        status: envelope.result.data.outcome.index_maintenance.status ?? null,
        scopes: [],
        blocker_code: envelope.result.data.outcome.index_maintenance.blocker_code ?? null,
      };
    }
    if (envelope.sqlite?.used === true) {
      envelope.sqlite = {
        used: true,
        source: "warm_index",
        freshness: "stale",
        snapshot_ref: envelope.sqlite.snapshot_ref ?? null,
        revision: envelope.sqlite.revision == null ? null : String(envelope.sqlite.revision),
        refreshed: false,
      };
    }
    measure();
  }
  if (!failed && envelope.budget.actual_bytes > ceiling) {
    // Pass 4: drop non-essential data fields but keep path_after + index_update + outcome.
    if (isPlainObject(envelope.result.data)) {
      const d = envelope.result.data;
      envelope.result.data = {
        operation: d.operation ?? null,
        path_after: d.path_after ?? null,
        dirty_after: d.dirty_after ?? null,
        outcome: d.outcome ?? null,
        index_update: d.index_update ?? null,
      };
    }
    measure();
  }
  if (!failed && envelope.budget.actual_bytes > ceiling && isPlainObject(envelope.result.data?.index_update)) {
    // Pass 5: empty index_update scopes only (project_ref/path retained).
    envelope.result.data.index_update = {
      ...envelope.result.data.index_update,
      scopes: [],
    };
    measure();
  }
  if (!failed && envelope.budget.actual_bytes > ceiling && Array.isArray(envelope.result.changes) && envelope.result.changes.length > 0) {
    // Final success compaction keeps the full target identity and applied change.
    compactMutationTruthEnvelope(envelope, { failed: false });
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && !failed) {
    throw macroError("PROJECT_FILE_RESPONSE_TOO_LARGE", "Project-file Macro public response exceeds the response budget after mutation.", {
      required_response_bytes: envelope.budget.actual_bytes,
      max_response_bytes: ceiling,
      outcome: "unknown",
      recoverable: false,
      zero_write: false,
      next_action: "Inspect live project state before deciding whether any mutation should be retried.",
    });
  }
  if (envelope.budget.actual_bytes > ceiling && failed && envelope.blockers.length > 1) {
    // Prefer keeping multiple typed preflight blockers when possible; if over budget, keep first two max.
    envelope.blockers = envelope.blockers.slice(0, 2);
    envelope.error = {
      code: envelope.blockers[0].code,
      message: envelope.blockers[0].message,
      recoverable: envelope.blockers[0].recoverable !== false,
      ...(envelope.blockers[0].details ? { details: envelope.blockers[0].details } : {}),
    };
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && failed) {
    // Failed path: compact while preserving verified changes when present (partial_failure truth).
    const evidence = uniqueEvidenceRefs(verificationEvidenceRefs).slice(0, 8);
    envelope.execution.stages = [{
      id: "file-result-project",
      kind: "result_project",
      status: "failed",
      evidence_refs: evidence,
    }];
    envelope.execution.stage_count = 1;
    envelope.result.verification.evidence_refs = evidence;
    envelope.result.summary = boundedSafeUtf8(summary, 48);
    if (Array.isArray(envelope.result.changes) && envelope.result.changes[0]) {
      const change = envelope.result.changes[0];
      envelope.result.changes = [{
        kind: change.kind ?? "project_file",
        action: change.action ?? null,
        path: change.path ?? null,
        project_ref: change.project_ref ?? (typeof change.path === "string" ? `project:path:${change.path}` : null),
        status: change.status ?? "applied",
        mutation: change.mutation ?? { status: "completed" },
        live_readback: {
          status: change.live_readback?.status ?? "passed",
          source: change.live_readback?.source ?? "live_project_path_and_dirty_readback",
          path: change.live_readback?.path ?? change.path ?? null,
          dirty: change.live_readback?.dirty ?? null,
        },
        index_maintenance: {
          status: change.index_maintenance?.status ?? null,
          scopes: [],
          blocker_code: change.index_maintenance?.blocker_code ?? null,
        },
      }];
    }
    if (isPlainObject(envelope.result.data)) {
      const d = envelope.result.data;
      envelope.result.data = {
        operation: d.operation ?? null,
        path_after: d.path_after ?? null,
        dirty_after: d.dirty_after ?? null,
        outcome: d.outcome ?? null,
        zero_write: d.zero_write === true,
        partial_state: d.partial_state ?? null,
      };
      if (isPlainObject(envelope.result.data.outcome?.index_maintenance)) {
        envelope.result.data.outcome.index_maintenance = {
          status: envelope.result.data.outcome.index_maintenance.status ?? null,
          scopes: [],
          blocker_code: envelope.result.data.outcome.index_maintenance.blocker_code ?? null,
        };
      }
    }
    if (envelope.blockers.length > 0) {
      envelope.blockers = [{
        code: envelope.blockers[0].code,
        message: boundedSafeUtf8(envelope.blockers[0].message, 80),
        recoverable: envelope.blockers[0].recoverable !== false,
        details: compactBlockerDetails(envelope.blockers[0].details ?? {}),
      }];
      envelope.error = {
        code: envelope.blockers[0].code,
        message: envelope.blockers[0].message,
        recoverable: envelope.blockers[0].recoverable !== false,
        ...(envelope.blockers[0].details ? { details: envelope.blockers[0].details } : {}),
      };
    }
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && failed) {
    // Still over: drop stages/evidence entirely but keep verified changes/data/error.
    envelope.execution.stages = [];
    envelope.execution.stage_count = 0;
    envelope.result.verification.evidence_refs = [];
    envelope.result.summary = boundedSafeUtf8(summary, 32);
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && failed && Array.isArray(envelope.result.changes) && envelope.result.changes.length > 0) {
    // Last resort still preserves full target identity and the applied change.
    compactMutationTruthEnvelope(envelope, { failed: true });
    measure();
  }
  if (envelope.budget.actual_bytes > ceiling && failed && (!Array.isArray(envelope.result.changes) || envelope.result.changes.length === 0)) {
    // Only use ultra-minimal failure when there are no verified changes to preserve.
    return deepFreeze(buildMinimalBudgetFailureEnvelope({
      entry,
      request,
      startedAt,
      now,
      ceiling,
      operation: data?.operation ?? null,
      zeroWrite: postMutationUnknown ? false : (data?.zero_write !== false),
      unknownOutcome: postMutationUnknown,
      code: compactBlockers[0]?.code ?? "RESPONSE_TOO_LARGE",
      details: compactBlockers[0]?.details ?? null,
      message: compactBlockers[0]?.message ?? summary ?? "budget",
    }));
  }
  measure();
  // Hard guarantee: never return a public envelope larger than ceiling.
  if (envelope.budget.actual_bytes > ceiling) {
    if (!failed) {
      throw macroError("PROJECT_FILE_RESPONSE_TOO_LARGE", "Project-file Macro public response exceeds the response budget after mutation.", {
        required_response_bytes: envelope.budget.actual_bytes,
        max_response_bytes: ceiling,
        outcome: "unknown",
        recoverable: false,
        zero_write: false,
        next_action: "Inspect live project state before deciding whether any mutation should be retried.",
      });
    }
    if (Array.isArray(envelope.result.changes) && envelope.result.changes.length > 0) {
      // Keep partial verified truth even if slightly over is impossible; strip to fit.
      envelope.execution.stages = [];
      envelope.execution.stage_count = 0;
      envelope.result.verification.evidence_refs = [];
      measure();
    }
    if (envelope.budget.actual_bytes > ceiling) {
      return deepFreeze(buildMinimalBudgetFailureEnvelope({
        entry,
        request,
        startedAt,
        now,
        ceiling,
        operation: data?.operation ?? request?.input?.operation ?? null,
        zeroWrite: postMutationUnknown ? false : true,
        unknownOutcome: postMutationUnknown,
        code: envelope.blockers?.[0]?.code ?? compactBlockers[0]?.code ?? "RESPONSE_TOO_LARGE",
        details: envelope.blockers?.[0]?.details ?? compactBlockers[0]?.details ?? null,
        message: envelope.blockers?.[0]?.message ?? compactBlockers[0]?.message ?? summary ?? "budget",
      }));
    }
  }
  const validation = validateMacroExecutionEnvelope(envelope);
  if (!validation.valid) {
    return deepFreeze(buildMinimalBudgetFailureEnvelope({
      entry,
      request,
      startedAt,
      now,
      ceiling,
      operation: data?.operation ?? request?.input?.operation ?? null,
      zeroWrite: postMutationUnknown ? false : true,
      unknownOutcome: postMutationUnknown,
      code: envelope.blockers?.[0]?.code ?? compactBlockers[0]?.code ?? "RESPONSE_TOO_LARGE",
      details: envelope.blockers?.[0]?.details ?? compactBlockers[0]?.details ?? null,
      message: envelope.blockers?.[0]?.message ?? compactBlockers[0]?.message ?? summary ?? "budget",
    }));
  }
  return deepFreeze(envelope);
}

function statusLike(_request) {
  return "blocked";
}

function compactStagesForBudget(stages) {
  if (!Array.isArray(stages)) return [];
  return stages.map((stage) => ({
    id: stage.id,
    kind: stage.kind ?? "template_execute",
    status: stage.status === "running" ? "failed" : (stage.status ?? "failed"),
    evidence_refs: Array.isArray(stage.evidence_refs) ? stage.evidence_refs.slice(0, 2) : [],
    ...(typeof stage.summary === "string" ? { summary: boundedSafeUtf8(stage.summary, 64) } : {}),
  }));
}

function mutationFailureStatus(error, currentStatus) {
  if (error?.details?.outcome === "unknown") return "unknown";
  if (error?.details?.zero_write === true) return "not_run";
  return currentStatus === "completed" ? "completed" : "failed";
}

function executionError(id, execution) {
  const sourceDetails = isPlainObject(execution?.error?.details) ? execution.error.details : {};
  const details = {
    ...sourceDetails,
    ...(typeof execution?.error?.recoverable === "boolean" && sourceDetails.recoverable === undefined
      ? { recoverable: execution.error.recoverable }
      : {}),
    ...(typeof execution?.queue?.state === "string" && sourceDetails.queue_state === undefined
      ? { queue_state: execution.queue.state }
      : {}),
  };
  return macroError(
    execution?.error?.code ?? "PROJECT_FILE_TEMPLATE_FAILED",
    execution?.error?.message ?? `${id} failed.`,
    details,
    execution?.error?.recoverable,
  );
}
function macroError(code, message, details = undefined, recoverable = undefined) {
  return Object.assign(new Error(message), {
    code,
    ...(details === undefined ? {} : { details }),
    ...(typeof recoverable === "boolean" ? { recoverable } : {}),
  });
}
function readback(execution) { return execution?.result?.readback ?? execution?.result?.summary ?? execution?.result?.data ?? {}; }
function exactPath(value) { return value?.project_path ?? value?.path ?? value?.current_project_path ?? null; }
function isCleanDirtyState(value) { return value?.dirty === false && value?.dirty_state === "clean" && value?.raw_dirty_state === 0; }
function dirtyProjection(value) { return { raw_dirty_state: value?.raw_dirty_state ?? null, dirty_state: value?.dirty_state ?? null, dirty: value?.dirty ?? null }; }
function projectFileChange(operation, afterPath, afterDirty) {
  return {
    kind: "project_file",
    action: operation,
    path: exactPath(afterPath),
    status: "applied",
    mutation: { status: "completed" },
    live_readback: {
      status: "passed",
      source: "live_project_path_and_dirty_readback",
      path: exactPath(afterPath),
      dirty: dirtyProjection(afterDirty),
    },
    index_maintenance: { status: "pending", scopes: [], blocker_code: null },
  };
}
function indexMaintenance(status, invalidation) {
  return {
    status,
    scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
    blocker_code: invalidation?.blockers?.[0]?.code ?? null,
  };
}
function projectFileOutcome(change, invalidation) {
  return {
    mutation: { status: change?.mutation?.status ?? "not_run" },
    live_readback: { status: change?.live_readback?.status ?? "not_run" },
    index_maintenance: {
      status: change?.index_maintenance?.status ?? "not_run",
      scopes: Array.isArray(invalidation?.scopes) ? invalidation.scopes.slice(0, 16) : [],
      blocker_code: invalidation?.blockers?.[0]?.code ?? null,
    },
  };
}
function evidenceRefs(execution) { return uniqueEvidenceRefs([execution?.request?.id, ...(execution?.evidence_refs ?? []), ...(execution?.result?.evidence_refs ?? [])]); }
function uniqueEvidenceRefs(values) { return [...new Set(values.filter((value) => typeof value === "string"))].slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count); }
async function maintainProjectFileIndex(runtime, operation, beforePath, afterPath, now) {
  if (operation === "save_as") {
    if (typeof runtime?.rebindProjectIdentity !== "function") {
      return indexMaintenanceFailure("PROJECT_INDEX_REBIND_UNAVAILABLE", "Project Index runtime does not expose atomic Save As identity rebind.");
    }
    const status = typeof runtime?.status === "function" ? runtime.status() : {};
    const expectedPreviousRef = status.project_ref ?? canonicalProjectPathRef(exactPath(beforePath));
    if (typeof expectedPreviousRef !== "string") {
      return indexMaintenanceFailure("PROJECT_INDEX_PREVIOUS_IDENTITY_REQUIRED", "Project Index previous project_ref is required before Save As identity rebind.");
    }
    return runtime.rebindProjectIdentity({
      project_path: exactPath(afterPath),
      expected_previous_project_ref: expectedPreviousRef,
      observed_at: safeNowIso(now),
    });
  }
  if (runtime === null || runtime === undefined) return null;
  if (typeof runtime.invalidateScopes !== "function") return indexMaintenanceFailure("PROJECT_INDEX_INVALIDATION_UNAVAILABLE", "Configured Project Index runtime does not expose save-current scope invalidation.");
  return runtime.invalidateScopes({ scopes: ["project_head"], observed_at: safeNowIso(now) });
}
function canonicalProjectPathRef(value) { return typeof value === "string" && value ? `project:path:${value}` : null; }
function indexMaintenanceFailure(code, message) { return { ok: false, blockers: [{ code, message, recoverable: true }], scopes: [] }; }
function sqliteEvidence(runtime, invalidation) {
  if (!invalidation) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  const status = typeof runtime?.status === "function" ? runtime.status() : {};
  const revision = status.revision ?? status.project_revision ?? invalidation.revision ?? null;
  return {
    used: true,
    source: "warm_index",
    freshness: "stale",
    snapshot_ref: status.snapshot_id ?? invalidation.snapshot_id ?? null,
    revision: revision === null ? null : String(revision),
    refreshed: false,
  };
}
function compactIndexUpdate(value) {
  if (!value) return null;
  return {
    status: value.status ?? null,
    scopes: Array.isArray(value.scopes) ? value.scopes.slice(0, 16) : [],
    project_ref: value.project_ref ?? null,
    project_path: value.project_path ?? null,
    session_id: value.session_id ?? null,
    db_path: value.db_path ?? null,
    old_rows_migrated: value.old_rows_migrated ?? null,
    snapshot_id: value.snapshot_id ?? null,
    revision: value.revision ?? null,
  };
}

export function createAlpha3_2C3DProjectFileMacroDiscoveryItems(options = {}) {
  return [deepFreeze({
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    title: "Project file and tab switching",
    summary: "Save current/as, list open projects, create a named saved project tab, open one exact .RPP in a new tab, or activate one exact already-open saved project with Project Index identity sync.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.project.file",
    tags: ["macro", "project", "file", "save", "save_as", "open", "switch", "tab", "alpha3_2c3d", "alpha3_4_d3", "executable"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_file_highway",
    menu_group: "secondary",
    execution_shape: "registered_macro_program",
    user_label: "Project file and tab switching",
    task_intents: [
      "save project",
      "save current project",
      "save project as",
      "open project",
      "switch project",
      "activate tab",
      "create a new project",
      "list open projects",
      "打开工程",
      "切换工程",
      "激活工程页签",
      "新建工程",
    ],
    support_status: "executable_runtime_bound",
    support_state: "supported",
    exists_in_catalog: true,
    live_runnable_now: options.liveRunnableNow === true,
    evidence_level: options.liveRunnableNow === true
      ? "runtime_bound_live_route_available"
      : "runtime_bound_executable",
    known_blocker: null,
    allowed_live_group: null,
    inputSchema: {
      type: "object",
      required: ["operation"],
      additionalProperties: false,
      properties: {
        operation: {
          enum: [
            "save_current",
            "save_as",
            "list_open_projects",
            "create_project_tab",
            "open_project_in_tab",
            "activate_project_tab",
          ],
        },
        target_path: { type: "string", description: "Required for save_as, create_project_tab, and open_project_in_tab. Pass one native absolute .RPP path JSON string with Unicode and spaces literal; no shell quoting/escaping, file://, percent encoding, or ~." },
        overwrite: { const: true, description: "Required for save_as and create_project_tab." },
        cursor: { oneOf: [{ type: "integer", minimum: 0 }, { type: "string", pattern: "^[0-9]+$" }], description: "list_open_projects only." },
        limit: { type: "integer", minimum: 1, maximum: 100, description: "list_open_projects only; default 25." },
        name: { type: "string", description: "create_project_tab OpenReaper label only." },
        copy_active_project_settings: { const: false, description: "create_project_tab only; must be false." },
        project_ref: { type: "string", description: "activate_project_tab only; exact saved project:path ref." },
        dry_run: { type: "boolean", description: "Supported for save_current/save_as; rejected for create/open/activate." },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: {
        contract: { const: "macro.execution.v1" },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: { input: [], output: [] },
    expectedDelta: {
      kind: "write",
      action: "project_file_highway",
      entities: ["project_file", "project_path", "dirty_state", "project_tab"],
      summary: "Executes the registered project-file highway and verifies native path/ref/dirty and Project Index identity truth.",
    },
    examples: [
      { input: { operation: "save_current" } },
      { input: { operation: "save_as", target_path: "/projects/对白 中文/demo project.RPP", overwrite: true } },
      { input: { operation: "list_open_projects", cursor: "0", limit: 25 } },
      { input: { operation: "create_project_tab", name: "sound design", target_path: "/projects/demo/new.RPP", overwrite: true, copy_active_project_settings: false } },
      { input: { operation: "open_project_in_tab", target_path: "/projects/demo/demo.RPP" } },
      { input: { operation: "activate_project_tab", project_ref: "project:path:/projects/demo/demo.RPP" } },
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
    blockers.push(blocker("PROJECT_FILE_OPERATION_REQUIRED", "operation must be one of the six supported project-file operations."));
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
  if (!SUPPORTED_OPERATIONS.has(operation)) {
    blockers.push(blocker("PROJECT_FILE_OPERATION_UNSUPPORTED", "The requested project-file operation is unsupported."));
    return blockers;
  }
  if (operation === "save_current") {
    const rejected = ["target_path", "overwrite", "cursor", "limit", "name", "copy_active_project_settings", "project_ref"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("SAVE_CURRENT_FIELDS_REJECTED", "save_current rejects fields that belong to other operations.", { fields: rejected }));
    }
    return blockers;
  }
  if (operation === "save_as") {
    validateAbsoluteRppPath(input, "target_path", "SAVE_AS", blockers);
    if (input.overwrite !== true) {
      blockers.push(blocker("SAVE_AS_OVERWRITE_TRUE_REQUIRED", "save_as requires explicit overwrite=true; atomic overwrite=false remains held."));
    }
    const rejected = ["cursor", "limit", "name", "copy_active_project_settings", "project_ref"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("SAVE_AS_FIELDS_REJECTED", "save_as rejects fields that belong to other operations.", { fields: rejected }));
    }
    return blockers;
  }
  if (operation === "list_open_projects") {
    if (input.cursor !== undefined) {
      if (typeof input.cursor === "string") {
        if (input.cursor === "" || !/^[0-9]+$/u.test(input.cursor)) {
          blockers.push(blocker("LIST_CURSOR_INVALID", "list_open_projects cursor must be a non-negative integer or decimal string."));
        }
      } else if (!(Number.isInteger(input.cursor) && input.cursor >= 0)) {
        blockers.push(blocker("LIST_CURSOR_INVALID", "list_open_projects cursor must be a non-negative integer or decimal string."));
      }
    }
    if (input.limit !== undefined) {
      if (!(Number.isInteger(input.limit) && input.limit >= 1 && input.limit <= LIST_HARD_LIMIT)) {
        blockers.push(blocker("LIST_LIMIT_INVALID", "list_open_projects limit must be an integer from 1 to 100."));
      }
    }
    const rejected = ["target_path", "overwrite", "name", "copy_active_project_settings", "project_ref"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("LIST_FIELDS_REJECTED", "list_open_projects rejects fields that belong to other operations.", { fields: rejected }));
    }
    return blockers;
  }
  if (operation === "create_project_tab") {
    if (typeof input.name !== "string" || input.name.trim() === "") {
      blockers.push(blocker("CREATE_NAME_REQUIRED", "create_project_tab requires a non-empty name."));
    } else if (Buffer.byteLength(input.name) > NAME_MAX_BYTES) {
      blockers.push(blocker("CREATE_NAME_TOO_LONG", "create_project_tab name exceeds the 160-byte bound."));
    } else if (CONTROL_CHARACTER_PATTERN.test(input.name)) {
      blockers.push(blocker("CREATE_NAME_CONTROL_CHARACTER", "create_project_tab name contains a control character."));
    }
    validateAbsoluteRppPath(input, "target_path", "CREATE", blockers);
    if (input.overwrite !== true) {
      blockers.push(blocker("CREATE_OVERWRITE_TRUE_REQUIRED", "create_project_tab requires overwrite=true for the Save As step."));
    }
    if (Object.hasOwn(input, "copy_active_project_settings") && input.copy_active_project_settings !== false) {
      blockers.push(blocker("CREATE_COPY_SETTINGS_MUST_BE_FALSE", "create_project_tab accepts only copy_active_project_settings=false."));
    }
    if (input.dry_run === true) {
      blockers.push(blocker("PROJECT_FILE_DRY_RUN_UNSUPPORTED", "create_project_tab rejects dry_run=true."));
    }
    const rejected = ["cursor", "limit", "project_ref"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("CREATE_FIELDS_REJECTED", "create_project_tab rejects fields that belong to other operations.", { fields: rejected }));
    }
    return blockers;
  }
  if (operation === "open_project_in_tab") {
    validateAbsoluteRppPath(input, "target_path", "OPEN", blockers);
    if (input.dry_run === true) {
      blockers.push(blocker("PROJECT_FILE_DRY_RUN_UNSUPPORTED", "open_project_in_tab rejects dry_run=true."));
    }
    const rejected = ["overwrite", "cursor", "limit", "name", "copy_active_project_settings", "project_ref"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("OPEN_FIELDS_REJECTED", "open_project_in_tab rejects fields that belong to other operations.", { fields: rejected }));
    }
    return blockers;
  }
  if (operation === "activate_project_tab") {
    if (typeof input.project_ref !== "string" || input.project_ref.trim() === "") {
      blockers.push(blocker("ACTIVATE_PROJECT_REF_REQUIRED", "activate_project_tab requires exactly one canonical project_ref."));
    } else if (Buffer.byteLength(input.project_ref) > PROJECT_REF_MAX_BYTES) {
      blockers.push(blocker("ACTIVATE_PROJECT_REF_TOO_LONG", "activate_project_tab project_ref exceeds the bounded size."));
    } else if (CONTROL_CHARACTER_PATTERN.test(input.project_ref)) {
      blockers.push(blocker("ACTIVATE_PROJECT_REF_CONTROL_CHARACTER", "activate_project_tab project_ref contains a control character."));
    } else if (input.project_ref.startsWith("project:tab:")) {
      blockers.push(blocker("PROJECT_FILE_UNSAVED_REF_UNSUPPORTED", "activate_project_tab rejects unsaved project:tab refs before mutation.", {
        recovery: "Use template.project.activate_project_tab for unsaved-tab debug only; Project Index cannot bind unsaved paths.",
        zero_write: true,
      }));
    } else if (!input.project_ref.startsWith("project:path:")) {
      blockers.push(blocker("ACTIVATE_PROJECT_REF_SCHEME_INVALID", "activate_project_tab requires a saved project:path ref."));
    }
    if (input.dry_run === true) {
      blockers.push(blocker("PROJECT_FILE_DRY_RUN_UNSUPPORTED", "activate_project_tab rejects dry_run=true."));
    }
    const rejected = ["target_path", "overwrite", "cursor", "limit", "name", "copy_active_project_settings"].filter((field) => Object.hasOwn(input, field));
    if (rejected.length > 0) {
      blockers.push(blocker("ACTIVATE_FIELDS_REJECTED", "activate_project_tab rejects fields that belong to other operations.", { fields: rejected }));
    }
  }
  return blockers;
}

function validateAbsoluteRppPath(input, field, prefix, blockers) {
  const value = input[field];
  if (typeof value !== "string" || value.length === 0) {
    blockers.push(blocker(`${prefix}_TARGET_PATH_REQUIRED`, `${field} requires a non-empty absolute .RPP path.`));
    return;
  }
  const pathTransport = classifyNativePathTransport(value);
  if (pathTransport) {
    blockers.push(blocker(
      `${prefix}_TARGET_PATH_ENCODING_INVALID`,
      nativePathTransportMessage(field, pathTransport),
      nativePathTransportRecovery({ field, form: pathTransport }),
    ));
    return;
  }
  if (Buffer.byteLength(value) > TARGET_PATH_MAX_BYTES) {
    blockers.push(blocker(`${prefix}_TARGET_PATH_TOO_LONG`, `${field} exceeds the atomic 2048-byte input limit.`));
  }
  if (CONTROL_CHARACTER_PATTERN.test(value)) {
    blockers.push(blocker(`${prefix}_TARGET_PATH_CONTROL_CHARACTER`, `${field} contains a NUL or control character.`));
  }
  const posixAbsolute = value.startsWith("/");
  const windowsAbsolute = /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
  if (!posixAbsolute && !windowsAbsolute) {
    blockers.push(blocker(`${prefix}_TARGET_PATH_NOT_ABSOLUTE`, `${field} must be absolute.`));
  }
  if (!/\.rpp$/iu.test(value.split(/[/\\]/u).at(-1) ?? "")) {
    blockers.push(blocker(`${prefix}_TARGET_PATH_EXTENSION_INVALID`, `${field} must end with a .RPP basename.`));
  }
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

function blocker(code, message, details = undefined, recoverable = undefined) {
  return {
    code,
    message,
    recoverable: typeof recoverable === "boolean"
      ? recoverable
      : (typeof details?.recoverable === "boolean" ? details.recoverable : true),
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
