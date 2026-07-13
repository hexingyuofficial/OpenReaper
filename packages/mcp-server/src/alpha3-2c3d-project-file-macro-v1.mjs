export const ALPHA3_2C3D_PROJECT_FILE_MACRO_CONTRACT = "alpha3.2c3d.project_file_macro.v1";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_ID = "macro.project.file";
export const ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION = "1.0.0";

import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

const READ_PATH_ID = "template.project.read_current_project_path";
const READ_DIRTY_ID = "template.project.read_dirty_state";
const SAVE_CURRENT_ID = "template.project.save_current_project";
const SAVE_AS_ID = "template.project.save_project_as";
const HELD_OPERATIONS = new Set(["new", "create", "create_new", "open", "open_project"]);
const ALLOWED_INPUT_FIELDS = new Set(["operation", "target_path", "overwrite", "dry_run"]);
const OPERATION_MAX_BYTES = 64;
const TARGET_PATH_MAX_BYTES = 2048;
const REQUEST_SUMMARY_TARGET_PATH_MAX_BYTES = 256;
const UNKNOWN_FIELD_DETAIL_LIMIT = 8;
const UNKNOWN_FIELD_NAME_MAX_BYTES = 80;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/u;
const FILE_TEMPLATE_IDS = Object.freeze([READ_PATH_ID, READ_DIRTY_ID, SAVE_CURRENT_ID, SAVE_AS_ID]);
const FILE_STAGE_IDS = new Set(["file-read-before-path", "file-read-before-dirty", "file-live-save-current", "file-live-save-as", "file-read-after-path", "file-read-after-dirty", "file-result-project"]);

export const ALPHA3_2_5_C_FILE_MACRO_REGISTRY = createMacroProgramRegistry([{
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
  program_id: "openreaper.macro.project.file",
  program_version: ALPHA3_2C3D_PROJECT_FILE_MACRO_VERSION,
  implementation_status: "executable",
  risk: "write",
  input_schema: { type: "object", additionalProperties: false },
  selector_policy: { task_shaped: true, canonical_refs_optional_at_public_boundary: true, live_reresolve_before_write: true },
  sqlite_policy: { mode: "not_used", write_authority: false, identity_fields: [] },
  dependencies: { template_ids: FILE_TEMPLATE_IDS, runtime_capabilities: [] },
  stages: [
    { id: "file-read-before-path", kind: "template_execute", dependency_ref: READ_PATH_ID, risk: "read", stop_on_error: true },
    { id: "file-read-before-dirty", kind: "template_execute", dependency_ref: READ_DIRTY_ID, risk: "read", stop_on_error: true },
    { id: "file-live-save-current", kind: "template_execute", dependency_ref: SAVE_CURRENT_ID, risk: "write", stop_on_error: true },
    { id: "file-live-save-as", kind: "template_execute", dependency_ref: SAVE_AS_ID, risk: "write", stop_on_error: true },
    { id: "file-read-after-path", kind: "template_execute", dependency_ref: READ_PATH_ID, risk: "read", stop_on_error: true },
    { id: "file-read-after-dirty", kind: "template_execute", dependency_ref: READ_DIRTY_ID, risk: "read", stop_on_error: true },
    { id: "file-result-project", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "not_required",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: 65_536 },
}], { acceptedTemplateIds: FILE_TEMPLATE_IDS, registeredStageIds: FILE_STAGE_IDS });

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

  const stages = [];
  const calls = [];
  const collectedEvidence = () => uniqueEvidenceRefs(calls.flatMap(evidenceRefs));
  let mutationAttempted = false;
  const run = async (stageId, id, childInput = {}) => {
    stages.push({ id: stageId, kind: "template_execute", status: "running", evidence_refs: [] });
    try {
      const execution = await executeAtomic({ id, input: childInput, refs: [], context: request.context, budget: request.budget });
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
    beforePath = readback(await run("file-read-before-path", READ_PATH_ID));
    beforeDirty = readback(await run("file-read-before-dirty", READ_DIRTY_ID));
    const savedProject = beforePath?.has_project_path === true || beforePath?.path_state === "saved_project";
    if (input.operation === "save_current" && !savedProject) {
      throw macroError("PROJECT_FILE_UNSAVED_PROJECT", "save_current requires an already-named project; use save_as with an accepted target path.");
    }
    if (input.dry_run === true) {
      stages.push({ id: "file-live-save-current", kind: "template_execute", status: "skipped", summary: "Mutation skipped during dry_run.", evidence_refs: [] });
      stages.push({ id: "file-live-save-as", kind: "template_execute", status: "skipped", summary: "Mutation skipped during dry_run.", evidence_refs: [] });
      stages.push({ id: "file-result-project", kind: "result_project", status: "completed", summary: "Validated save operation without mutation.", evidence_refs: collectedEvidence() });
      return fileEnvelope({ entry, request, startedAt, now, status: "dry_run_completed", stages, blockers: [], summary: "Project-file save preview completed.", data: { operation: input.operation, path_before: exactPath(beforePath), dirty_before: dirtyProjection(beforeDirty), mutation_skipped: true }, verificationEvidenceRefs: collectedEvidence() });
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
    invalidation = invalidateProjectFileIndex(projectIndexRuntime, input.operation, now);
    if (invalidation?.ok === false) {
      verifiedChange.index_maintenance = indexMaintenance("failed", invalidation);
      throw macroError(
        invalidation.blockers?.[0]?.code ?? "PROJECT_FILE_INDEX_INVALIDATION_FAILED",
        invalidation.blockers?.[0]?.message ?? "Project-file save completed but Project Index identity scopes could not be invalidated.",
      );
    }
    verifiedChange.index_maintenance = indexMaintenance(invalidation ? "completed" : "skipped", invalidation);
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
    });
  } catch (error) {
    const readbackPassed = verifiedChange?.live_readback?.status === "passed";
    return fileEnvelope({
      entry,
      request,
      startedAt,
      now,
      status: mutationAttempted ? "partial_failure" : "failed",
      stages,
      blockers: [blocker(error.code ?? "PROJECT_FILE_EXECUTION_FAILED", error.message ?? "Project-file Macro failed.")],
      summary: error.message ?? "Project-file Macro failed.",
      data: {
        operation: input.operation ?? null,
        path_before: exactPath(beforePath),
        path_after: exactPath(afterPath),
        dirty_before: dirtyProjection(beforeDirty),
        dirty_after: dirtyProjection(afterDirty),
        calls: calls.length,
        index_update: compactIndexUpdate(invalidation),
        outcome: projectFileOutcome(verifiedChange, invalidation),
      },
      changes: verifiedChange ? [verifiedChange] : [],
      sqlite: sqliteEvidence(projectIndexRuntime, invalidation),
      verificationStatus: readbackPassed ? "passed" : undefined,
      verificationEvidenceRefs: readbackPassed ? collectedEvidence() : [],
    });
  }
}

function fileEnvelope({ entry, request, startedAt, now, status, stages, blockers, summary, data = {}, changes = [], sqlite = null, verificationStatus = null, verificationEvidenceRefs = [] }) {
  const failed = status !== "completed" && status !== "dry_run_completed";
  const resolvedVerificationStatus = verificationStatus ?? (failed ? "not_required" : "passed");
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: !failed,
    macro: { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk },
    request: { request_id: request.request_id ?? "macro.project.file", dry_run: failed ? false : request.input?.dry_run === true },
    execution: { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: sqlite ?? { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: { summary, canonical_refs: [], changes, verification: { status: resolvedVerificationStatus, evidence_refs: resolvedVerificationStatus === "passed" ? uniqueEvidenceRefs(verificationEvidenceRefs) : [] }, artifact_refs: [], data },
    blockers: failed ? blockers : [], error: failed ? { code: blockers[0]?.code ?? "PROJECT_FILE_FAILED", message: summary, recoverable: true } : null,
    recovery: failed ? { action: "Repair the typed blocker and retry the same registered Macro.", sqlite_rows_authorize_writes: false } : null,
    budget: { max_bytes: entry.result_budget.max_bytes, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let attempt = 0; attempt < 3; attempt += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope));
  const validation = validateMacroExecutionEnvelope(envelope);
  if (!validation.valid) throw new TypeError(`Invalid project-file Macro envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(envelope);
}

function executionError(id, execution) { return macroError(execution?.error?.code ?? "PROJECT_FILE_TEMPLATE_FAILED", execution?.error?.message ?? `${id} failed.`); }
function macroError(code, message) { return Object.assign(new Error(message), { code }); }
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
function invalidateProjectFileIndex(runtime, operation, now) {
  if (typeof runtime?.invalidateScopes !== "function") return null;
  const scopes = operation === "save_as"
    ? ["project_head", "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media"]
    : ["project_head"];
  return runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
}
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
    snapshot_id: value.snapshot_id ?? null,
    revision: value.revision ?? null,
  };
}

export function createAlpha3_2C3DProjectFileMacroDiscoveryItems(options = {}) {
  return [deepFreeze({
    id: ALPHA3_2C3D_PROJECT_FILE_MACRO_ID,
    title: "Save project file",
    summary: "Execute a bounded save-current or save-as Macro over accepted project-file Templates with exact path and dirty-state readback.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.project.file",
    tags: ["macro", "project", "file", "save", "save_as", "alpha3_2c3d", "executable"],
    kind: "official_macro",
    action_kind: "macro",
    macro_kind: "project_file_save",
    menu_group: "secondary",
    execution_shape: "registered_macro_program",
    user_label: "Save project file",
    task_intents: ["save project", "save current project", "save project as"],
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
        operation: { enum: ["save_current", "save_as"] },
        target_path: { type: "string", description: "Required only for save_as; forwarded unchanged to the atomic save_project_as template." },
        overwrite: { const: true, description: "Required only for save_as. Atomic overwrite=false remains held." },
        dry_run: { type: "boolean" },
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
      action: "save_project_file",
      entities: ["project_file", "project_path", "dirty_state"],
      summary: "Executes the registered save program and verifies exact path and clean dirty state.",
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
