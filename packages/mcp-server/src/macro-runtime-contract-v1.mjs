const MACRO_ID_PATTERN = /^macro\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const PROGRAM_ID_PATTERN = /^[a-z][a-z0-9_.-]{2,127}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;

export const MACRO_RUNTIME_CONTRACT = "macro.runtime.contract.v1";
export const MACRO_PROGRAM_REGISTRY_CONTRACT = "macro.program.registry.v1";
export const MACRO_EXECUTION_CONTRACT = "macro.execution.v1";
export const MACRO_INVENTORY_CONTRACT = "macro.inventory.v1";

export const MACRO_CONTRACT_CEILINGS = deepFreeze({
  envelope_max_bytes: 65_536,
  inline_detail_max_bytes: 24_576,
  stage_summary_max_count: 32,
  canonical_ref_max_count: 128,
  change_max_count: 128,
  blocker_max_count: 32,
  evidence_ref_max_count: 64,
});

export const MACRO_PUBLIC_IMPLEMENTATION_STATUSES = deepFreeze([
  "executable",
  "deprecated_alias",
]);

export const MACRO_PROGRAM_STATUSES = deepFreeze([
  "internal_draft",
  "registered",
  ...MACRO_PUBLIC_IMPLEMENTATION_STATUSES,
  "withdrawn",
  "blocked",
]);

export const MACRO_EXECUTION_STATUSES = deepFreeze([
  "completed",
  "dry_run_completed",
  "blocked",
  "failed",
  "partial_failure",
]);

export const MACRO_TARGET_OUTCOMES = deepFreeze([
  "executable_official",
  "consolidated_legacy_mapping",
  "internal_withdrawn_draft",
]);

export const MACRO_STAGE_KINDS = deepFreeze([
  "sqlite_hydrate",
  "sqlite_query",
  "selector_resolve",
  "live_ref_resolve",
  "template_execute",
  "runtime_execute",
  "verify",
  "index_update",
  "result_project",
]);

const RISK_VALUES = new Set(["read", "safe", "write", "destructive"]);
const UNDO_VALUES = new Set(["not_required", "single_undo", "per_stage_undo", "transactional"]);
const VERIFICATION_VALUES = new Set(["required", "not_required"]);
const SQLITE_MODES = new Set(["not_used", "hydrate_or_reuse", "query_only", "invalidate_after_write"]);
const SQLITE_FRESHNESS_VALUES = new Set(["not_applicable", "missing", "stale", "fresh", "refreshed"]);
const SQLITE_SOURCE_VALUES = new Set(["not_used", "cold_hydration", "warm_index", "refreshed_index"]);
const VERIFICATION_STATUSES = new Set(["passed", "failed", "not_required"]);
const STAGE_STATUSES = new Set(["completed", "skipped", "blocked", "failed"]);

const REGISTRY_ENTRY_FIELDS = new Set([
  "contract",
  "macro_id",
  "program_id",
  "program_version",
  "implementation_status",
  "risk",
  "input_schema",
  "selector_policy",
  "sqlite_policy",
  "dependencies",
  "stages",
  "undo_policy",
  "verification_policy",
  "dry_run_supported",
  "result_budget",
]);
const SELECTOR_POLICY_FIELDS = new Set([
  "task_shaped",
  "canonical_refs_optional_at_public_boundary",
  "live_reresolve_before_write",
]);
const SQLITE_POLICY_FIELDS = new Set(["mode", "write_authority", "identity_fields"]);
const DEPENDENCY_FIELDS = new Set(["template_ids", "runtime_capabilities"]);
const STAGE_FIELDS = new Set(["id", "kind", "dependency_ref", "risk", "stop_on_error"]);
const RESULT_BUDGET_FIELDS = new Set(["max_bytes"]);
const REQUEST_FIELDS = new Set([
  "macro_id",
  "input",
  "selectors",
  "refs",
  "dry_run",
  "response_budget",
  "idempotency_key",
  "confirmation",
]);
const ENVELOPE_FIELDS = new Set([
  "contract",
  "ok",
  "macro",
  "request",
  "execution",
  "sqlite",
  "result",
  "blockers",
  "error",
  "recovery",
  "budget",
]);
const ENVELOPE_MACRO_FIELDS = new Set(["id", "program_id", "program_version", "risk"]);
const ENVELOPE_REQUEST_FIELDS = new Set(["request_id", "dry_run"]);
const EXECUTION_FIELDS = new Set(["status", "started_at", "completed_at", "stage_count", "stages"]);
const STAGE_SUMMARY_FIELDS = new Set(["id", "kind", "status", "summary", "evidence_refs"]);
const SQLITE_EVIDENCE_FIELDS = new Set(["used", "source", "freshness", "snapshot_ref", "revision", "refreshed"]);
const RESULT_FIELDS = new Set(["summary", "canonical_refs", "changes", "verification", "artifact_refs", "data"]);
const VERIFICATION_FIELDS = new Set(["status", "evidence_refs"]);
const BUDGET_FIELDS = new Set(["max_bytes", "actual_bytes", "truncated", "artifact_fallback"]);

export function isMacroProgramStatus(value) {
  return MACRO_PROGRAM_STATUSES.includes(value);
}

export function isMacroExecutionStatus(value) {
  return MACRO_EXECUTION_STATUSES.includes(value);
}

export function isMacroTargetOutcome(value) {
  return MACRO_TARGET_OUTCOMES.includes(value);
}

export function validateMacroRegistryEntry(entry, options = {}) {
  const errors = [];
  if (!isPlainObject(entry)) return invalid("registry entry must be an object");

  rejectUnknownFields(entry, REGISTRY_ENTRY_FIELDS, "registry entry", errors);
  requireEqual(entry.contract, MACRO_PROGRAM_REGISTRY_CONTRACT, "registry entry contract is invalid", errors);
  requireMatch(entry.macro_id, MACRO_ID_PATTERN, "registry entry macro_id is invalid", errors);
  requireMatch(entry.program_id, PROGRAM_ID_PATTERN, "registry entry program_id is invalid", errors);
  requireMatch(entry.program_version, VERSION_PATTERN, "registry entry program_version is invalid", errors);
  requireCondition(isMacroProgramStatus(entry.implementation_status), "registry entry implementation_status is invalid", errors);
  requireCondition(RISK_VALUES.has(entry.risk), "registry entry risk is invalid", errors);
  requireCondition(isPlainObject(entry.input_schema), "registry entry input_schema must be an object", errors);

  validateSelectorPolicy(entry.selector_policy, errors);
  validateSqlitePolicy(entry.sqlite_policy, errors);
  validateDependencies(entry.dependencies, options, errors);
  validateStages(entry.stages, entry.dependencies, options, errors);

  requireCondition(UNDO_VALUES.has(entry.undo_policy), "registry entry undo_policy is invalid", errors);
  requireCondition(VERIFICATION_VALUES.has(entry.verification_policy), "registry entry verification_policy is invalid", errors);
  requireCondition(typeof entry.dry_run_supported === "boolean", "registry entry dry_run_supported must be boolean", errors);

  if (!isPlainObject(entry.result_budget)) {
    errors.push("registry entry result_budget must be an object");
  } else {
    rejectUnknownFields(entry.result_budget, RESULT_BUDGET_FIELDS, "registry entry result_budget", errors);
    requireCondition(
      isPositiveInteger(entry.result_budget.max_bytes)
        && entry.result_budget.max_bytes <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
      "registry entry result_budget.max_bytes exceeds the v1 boundary",
      errors,
    );
  }

  if (entry.risk === "read") {
    requireCondition(entry.undo_policy === "not_required", "read Macro must use undo_policy=not_required", errors);
  }
  if (["write", "destructive"].includes(entry.risk)) {
    requireCondition(entry.verification_policy === "required", "write Macro must require verification", errors);
    requireCondition(entry.selector_policy?.live_reresolve_before_write === true, "write Macro must live-resolve before mutation", errors);
  }
  if (entry.sqlite_policy?.write_authority !== false) {
    errors.push("SQLite must never be Macro write authority");
  }

  return validationResult(errors);
}

export function createMacroProgramRegistry(entries, options = {}) {
  if (!Array.isArray(entries)) throw new TypeError("Macro program registry entries must be an array.");
  const byId = new Map();
  const byProgramId = new Map();

  for (const entry of entries) {
    const validation = validateMacroRegistryEntry(entry, options);
    if (!validation.valid) {
      throw new TypeError(`Invalid Macro registry entry ${entry?.macro_id ?? "<unknown>"}: ${validation.errors.join("; ")}`);
    }
    if (byId.has(entry.macro_id)) throw new TypeError(`Duplicate Macro id: ${entry.macro_id}`);
    if (byProgramId.has(entry.program_id)) throw new TypeError(`Duplicate Macro program id: ${entry.program_id}`);
    byId.set(entry.macro_id, deepFreeze(cloneJson(entry)));
    byProgramId.set(entry.program_id, entry.macro_id);
  }

  const frozenEntries = deepFreeze([...byId.values()]);
  return deepFreeze({
    contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
    entries: frozenEntries,
    ids: frozenEntries.map((entry) => entry.macro_id),
    get(id) {
      return byId.get(id) ?? null;
    },
  });
}

export function validateMacroProgramRequest(request, { registry } = {}) {
  const errors = [];
  if (!isPlainObject(request)) return invalid("Macro request must be an object");
  rejectUnknownFields(request, REQUEST_FIELDS, "Macro request", errors);
  requireMatch(request.macro_id, MACRO_ID_PATTERN, "Macro request macro_id is invalid", errors);
  requireCondition(isPlainObject(request.input), "Macro request input must be an object", errors);

  const entry = registry && typeof registry.get === "function" ? registry.get(request.macro_id) : null;
  requireCondition(Boolean(entry), "Macro request must select a registered Macro", errors);
  if (entry) {
    requireCondition(
      MACRO_PUBLIC_IMPLEMENTATION_STATUSES.includes(entry.implementation_status),
      "Macro request target is not publicly executable",
      errors,
    );
    if (request.dry_run === true) {
      requireCondition(entry.dry_run_supported === true, "Macro does not support dry_run", errors);
    }
  }

  if (request.selectors !== undefined) requireCondition(isPlainObject(request.selectors), "Macro request selectors must be an object", errors);
  if (request.refs !== undefined) requireCondition(isPlainObject(request.refs) || Array.isArray(request.refs), "Macro request refs must be an object or array", errors);
  if (request.dry_run !== undefined) requireCondition(typeof request.dry_run === "boolean", "Macro request dry_run must be boolean", errors);
  if (request.confirmation !== undefined) requireCondition(typeof request.confirmation === "boolean", "Macro request confirmation must be boolean", errors);
  if (request.idempotency_key !== undefined) requireCondition(typeof request.idempotency_key === "string" && request.idempotency_key.length > 0, "Macro request idempotency_key is invalid", errors);
  if (request.response_budget !== undefined) {
    requireCondition(
      isPositiveInteger(request.response_budget)
        && request.response_budget <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
      "Macro request response_budget exceeds the v1 boundary",
      errors,
    );
  }

  return { ...validationResult(errors), entry: errors.length === 0 ? entry : null };
}

export function validateMacroExecutionEnvelope(envelope) {
  const errors = [];
  if (!isPlainObject(envelope)) return invalid("Macro execution envelope must be an object");
  rejectUnknownFields(envelope, ENVELOPE_FIELDS, "Macro execution envelope", errors);
  requireEqual(envelope.contract, MACRO_EXECUTION_CONTRACT, "Macro execution envelope contract is invalid", errors);
  requireCondition(typeof envelope.ok === "boolean", "Macro execution envelope ok must be boolean", errors);

  validateEnvelopeMacro(envelope.macro, errors);
  validateEnvelopeRequest(envelope.request, errors);
  validateExecution(envelope.execution, errors);
  validateSqliteEvidence(envelope.sqlite, errors);
  validateResult(envelope.result, errors);
  validateBoundedArray(envelope.blockers, MACRO_CONTRACT_CEILINGS.blocker_max_count, "blockers", errors);
  requireCondition(envelope.error === null || isPlainObject(envelope.error), "error must be null or an object", errors);
  requireCondition(envelope.recovery === null || isPlainObject(envelope.recovery), "recovery must be null or an object", errors);
  validateBudget(envelope.budget, errors);

  const status = envelope.execution?.status;
  const dryRun = envelope.request?.dry_run;
  if (envelope.ok === true) {
    requireCondition(["completed", "dry_run_completed"].includes(status), "successful Macro execution has an invalid status", errors);
    requireCondition(envelope.error === null, "successful Macro execution cannot contain an error", errors);
    requireCondition(Array.isArray(envelope.blockers) && envelope.blockers.length === 0, "successful Macro execution cannot contain blockers", errors);
    if (["write", "destructive"].includes(envelope.macro?.risk)) {
      requireCondition(envelope.result?.verification?.status === "passed", "successful write Macro must pass verification", errors);
    } else {
      requireCondition(envelope.result?.verification?.status !== "failed", "successful Macro cannot report failed verification", errors);
    }
  } else {
    requireCondition(["blocked", "failed", "partial_failure"].includes(status), "failed Macro execution has an invalid status", errors);
  }
  // Successful dry-run must use dry_run_completed. Failed dry-run retains blocked/failed/partial_failure.
  if (dryRun === true && envelope.ok === true) {
    requireCondition(status === "dry_run_completed", "successful dry_run execution must use dry_run_completed status", errors);
  }
  if (dryRun === false) requireCondition(status !== "dry_run_completed", "non-dry-run execution cannot use dry_run_completed status", errors);

  validateSerializedBudget(envelope, errors);
  return validationResult(errors);
}

function validateSelectorPolicy(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("registry entry selector_policy must be an object");
    return;
  }
  rejectUnknownFields(value, SELECTOR_POLICY_FIELDS, "selector_policy", errors);
  for (const field of SELECTOR_POLICY_FIELDS) {
    requireCondition(typeof value[field] === "boolean", `selector_policy.${field} must be boolean`, errors);
  }
}

function validateSqlitePolicy(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("registry entry sqlite_policy must be an object");
    return;
  }
  rejectUnknownFields(value, SQLITE_POLICY_FIELDS, "sqlite_policy", errors);
  requireCondition(SQLITE_MODES.has(value.mode), "sqlite_policy.mode is invalid", errors);
  requireCondition(value.write_authority === false, "sqlite_policy.write_authority must be false", errors);
  requireStringArray(value.identity_fields, "sqlite_policy.identity_fields", errors);
}

function validateDependencies(value, options, errors) {
  if (!isPlainObject(value)) {
    errors.push("registry entry dependencies must be an object");
    return;
  }
  rejectUnknownFields(value, DEPENDENCY_FIELDS, "dependencies", errors);
  requireStringArray(value.template_ids, "dependencies.template_ids", errors);
  requireStringArray(value.runtime_capabilities, "dependencies.runtime_capabilities", errors);
  const acceptedTemplateIds = normalizeSet(options.acceptedTemplateIds);
  const acceptedRuntimeCapabilities = normalizeSet(options.acceptedRuntimeCapabilities);
  for (const id of value.template_ids ?? []) {
    requireCondition(acceptedTemplateIds.has(id), `Template dependency is not accepted: ${id}`, errors);
  }
  for (const capability of value.runtime_capabilities ?? []) {
    requireCondition(acceptedRuntimeCapabilities.has(capability), `Runtime dependency is not accepted: ${capability}`, errors);
  }
}

function validateStages(stages, dependencies, options, errors) {
  if (!Array.isArray(stages) || stages.length === 0) {
    errors.push("registry entry stages must be a non-empty array");
    return;
  }
  if (stages.length > MACRO_CONTRACT_CEILINGS.stage_summary_max_count) {
    errors.push("registry entry stages exceeds the v1 stage ceiling");
  }
  const registeredStageIds = normalizeSet(options.registeredStageIds);
  const seen = new Set();
  for (const stage of stages) {
    if (!isPlainObject(stage)) {
      errors.push("registry stage must be an object");
      continue;
    }
    rejectUnknownFields(stage, STAGE_FIELDS, "registry stage", errors);
    requireCondition(typeof stage.id === "string" && stage.id.length > 0, "registry stage id is invalid", errors);
    requireCondition(!seen.has(stage.id), `registry stage id is duplicated: ${stage.id}`, errors);
    seen.add(stage.id);
    requireCondition(registeredStageIds.has(stage.id), `registry stage implementation is not registered: ${stage.id}`, errors);
    requireCondition(MACRO_STAGE_KINDS.includes(stage.kind), "registry stage kind is invalid", errors);
    requireCondition(RISK_VALUES.has(stage.risk), "registry stage risk is invalid", errors);
    requireCondition(stage.stop_on_error === true, "registry stage stop_on_error must be true", errors);

    if (stage.kind === "template_execute") {
      requireCondition(dependencies?.template_ids?.includes(stage.dependency_ref), "template stage dependency_ref is not allowlisted", errors);
    } else if (stage.kind === "runtime_execute") {
      requireCondition(dependencies?.runtime_capabilities?.includes(stage.dependency_ref), "runtime stage dependency_ref is not allowlisted", errors);
    } else {
      requireCondition(stage.dependency_ref === undefined || stage.dependency_ref === null, "non-execution stage cannot declare dependency_ref", errors);
    }
  }
}

function validateEnvelopeMacro(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("macro identity is required");
    return;
  }
  rejectUnknownFields(value, ENVELOPE_MACRO_FIELDS, "macro identity", errors);
  requireMatch(value.id, MACRO_ID_PATTERN, "macro identity id is invalid", errors);
  requireMatch(value.program_id, PROGRAM_ID_PATTERN, "macro identity program_id is invalid", errors);
  requireMatch(value.program_version, VERSION_PATTERN, "macro identity program_version is invalid", errors);
  requireCondition(RISK_VALUES.has(value.risk), "macro identity risk is invalid", errors);
}

function validateEnvelopeRequest(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("request summary is required");
    return;
  }
  rejectUnknownFields(value, ENVELOPE_REQUEST_FIELDS, "request summary", errors);
  requireCondition(typeof value.request_id === "string" && value.request_id.length > 0, "request summary request_id is invalid", errors);
  requireCondition(typeof value.dry_run === "boolean", "request summary dry_run must be boolean", errors);
}

function validateExecution(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("execution summary is required");
    return;
  }
  rejectUnknownFields(value, EXECUTION_FIELDS, "execution summary", errors);
  requireCondition(isMacroExecutionStatus(value.status), "execution status is invalid", errors);
  requireCondition(typeof value.started_at === "string" && value.started_at.length > 0, "execution started_at is required", errors);
  requireCondition(typeof value.completed_at === "string" && value.completed_at.length > 0, "execution completed_at is required", errors);
  validateBoundedArray(value.stages, MACRO_CONTRACT_CEILINGS.stage_summary_max_count, "execution stages", errors);
  if (Array.isArray(value.stages)) {
    requireCondition(value.stage_count === value.stages.length, "execution stage_count does not match stages", errors);
    for (const stage of value.stages) validateStageSummary(stage, errors);
  } else {
    requireCondition(Number.isInteger(value.stage_count) && value.stage_count >= 0, "execution stage_count is invalid", errors);
  }
}

function validateStageSummary(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("stage summary must be an object");
    return;
  }
  rejectUnknownFields(value, STAGE_SUMMARY_FIELDS, "stage summary", errors);
  requireCondition(typeof value.id === "string" && value.id.length > 0, "stage summary id is invalid", errors);
  requireCondition(MACRO_STAGE_KINDS.includes(value.kind), "stage summary kind is invalid", errors);
  requireCondition(STAGE_STATUSES.has(value.status), "stage summary status is invalid", errors);
  if (value.summary !== undefined) requireCondition(typeof value.summary === "string", "stage summary summary must be a string", errors);
  validateEvidenceRefs(value.evidence_refs, "stage summary evidence_refs", errors);
}

function validateSqliteEvidence(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("SQLite evidence is required");
    return;
  }
  rejectUnknownFields(value, SQLITE_EVIDENCE_FIELDS, "SQLite evidence", errors);
  requireCondition(typeof value.used === "boolean", "SQLite evidence used must be boolean", errors);
  requireCondition(SQLITE_SOURCE_VALUES.has(value.source), "SQLite evidence source is invalid", errors);
  requireCondition(SQLITE_FRESHNESS_VALUES.has(value.freshness), "SQLite evidence freshness is invalid", errors);
  requireCondition(typeof value.refreshed === "boolean", "SQLite evidence refreshed must be boolean", errors);
  if (value.used === false) {
    requireCondition(value.source === "not_used" && value.freshness === "not_applicable", "unused SQLite evidence must be explicit", errors);
  } else {
    requireCondition(value.source !== "not_used", "used SQLite evidence requires a real source", errors);
    requireCondition(value.freshness !== "not_applicable", "used SQLite evidence requires freshness", errors);
  }
  if (value.refreshed === true) {
    requireCondition(value.source === "refreshed_index" && value.freshness === "refreshed", "refreshed SQLite evidence must identify the refreshed index", errors);
  }
  if (value.snapshot_ref !== null) requireCondition(typeof value.snapshot_ref === "string", "SQLite snapshot_ref must be null or string", errors);
  if (value.revision !== null) requireCondition(typeof value.revision === "string", "SQLite revision must be null or string", errors);
}

function validateResult(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("result summary is required");
    return;
  }
  rejectUnknownFields(value, RESULT_FIELDS, "result summary", errors);
  requireCondition(typeof value.summary === "string" && value.summary.length > 0, "result summary text is required", errors);
  validateBoundedArray(value.canonical_refs, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count, "canonical_refs", errors);
  validateBoundedArray(value.changes, MACRO_CONTRACT_CEILINGS.change_max_count, "changes", errors);
  if (Array.isArray(value.canonical_refs)) {
    for (const ref of value.canonical_refs) requireCondition(isCanonicalRef(ref), "canonical_refs contains an invalid ref", errors);
  }
  if (value.artifact_refs !== undefined) validateEvidenceRefs(value.artifact_refs, "artifact_refs", errors);
  if (value.data !== undefined) {
    requireCondition(isPlainObject(value.data), "result data must be an object", errors);
  }

  if (!isPlainObject(value.verification)) {
    errors.push("result verification is required");
  } else {
    rejectUnknownFields(value.verification, VERIFICATION_FIELDS, "result verification", errors);
    requireCondition(VERIFICATION_STATUSES.has(value.verification.status), "verification status is invalid", errors);
    validateEvidenceRefs(value.verification.evidence_refs, "verification evidence_refs", errors);
  }
}

function validateBudget(value, errors) {
  if (!isPlainObject(value)) {
    errors.push("budget is required");
    return;
  }
  rejectUnknownFields(value, BUDGET_FIELDS, "budget", errors);
  requireCondition(isPositiveInteger(value.max_bytes) && value.max_bytes <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes, "budget max_bytes exceeds the v1 boundary", errors);
  requireCondition(Number.isInteger(value.actual_bytes) && value.actual_bytes >= 0 && value.actual_bytes <= value.max_bytes, "budget actual_bytes is invalid", errors);
  requireCondition(value.truncated === false, "Macro execution envelope must not be truncated", errors);
  if (value.artifact_fallback !== undefined) requireCondition(typeof value.artifact_fallback === "boolean", "budget artifact_fallback must be boolean", errors);
}

function validateSerializedBudget(envelope, errors) {
  try {
    const encoded = JSON.stringify(envelope);
    requireCondition(Buffer.byteLength(encoded) <= MACRO_CONTRACT_CEILINGS.envelope_max_bytes, "Macro execution envelope exceeds its byte ceiling", errors);
    requireCondition(Buffer.byteLength(encoded) <= envelope.budget?.max_bytes, "Macro execution envelope exceeds its request budget", errors);
    requireCondition(envelope.budget?.actual_bytes >= Buffer.byteLength(encoded), "budget actual_bytes understates the serialized envelope", errors);
    const inline = JSON.stringify({
      stages: envelope.execution?.stages,
      changes: envelope.result?.changes,
      data: envelope.result?.data,
      blockers: envelope.blockers,
      error: envelope.error,
      recovery: envelope.recovery,
    });
    requireCondition(Buffer.byteLength(inline) <= MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes, "inline execution detail exceeds its byte ceiling", errors);
  } catch {
    errors.push("Macro execution envelope contains non-JSON values");
  }
}

function validateEvidenceRefs(value, label, errors) {
  validateBoundedArray(value, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count, label, errors);
  if (Array.isArray(value)) {
    for (const ref of value) requireCondition(typeof ref === "string" && ref.length > 0, `${label} must contain non-empty strings`, errors);
  }
}

function validateBoundedArray(value, ceiling, label, errors) {
  requireCondition(Array.isArray(value), `${label} must be an array`, errors);
  if (Array.isArray(value)) requireCondition(value.length <= ceiling, `${label} exceeds its count ceiling`, errors);
}

function isCanonicalRef(value) {
  if (typeof value === "string") return value.length > 0 && value.length <= 512;
  if (!isPlainObject(value)) return false;
  return typeof value.kind === "string" && value.kind.length > 0
    && Object.keys(value).some((key) => key !== "kind" && value[key] !== null && value[key] !== undefined);
}

function requireStringArray(value, label, errors) {
  requireCondition(Array.isArray(value), `${label} must be an array`, errors);
  if (!Array.isArray(value)) return;
  const seen = new Set();
  for (const item of value) {
    requireCondition(typeof item === "string" && item.length > 0, `${label} must contain non-empty strings`, errors);
    requireCondition(!seen.has(item), `${label} contains duplicate value: ${item}`, errors);
    seen.add(item);
  }
}

function rejectUnknownFields(value, allowed, label, errors) {
  if (!isPlainObject(value)) return;
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) errors.push(`${label} contains unsupported field: ${key}`);
  }
}

function requireCondition(condition, message, errors) {
  if (!condition) errors.push(message);
}

function requireEqual(value, expected, message, errors) {
  requireCondition(value === expected, message, errors);
}

function requireMatch(value, pattern, message, errors) {
  requireCondition(typeof value === "string" && pattern.test(value), message, errors);
}

function validationResult(errors) {
  return { valid: errors.length === 0, errors: deepFreeze([...errors]) };
}

function invalid(message) {
  return validationResult([message]);
}

function normalizeSet(value) {
  if (value instanceof Set) return value;
  if (Array.isArray(value)) return new Set(value);
  return new Set();
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value > 0;
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const item of Object.values(value)) deepFreeze(item);
  return Object.freeze(value);
}
