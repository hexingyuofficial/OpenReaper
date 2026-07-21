import { createHash, randomBytes } from "node:crypto";
import {
  EXECUTABLE_RECIPE_BUDGETS,
  EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT,
  EXECUTABLE_RECIPE_TRUST_CONTRACT,
  evaluateExecutableRecipeTrust,
  normalizeExecutableRecipeRevision,
} from "./executable-recipe-contract-v1.mjs";
import {
  buildExecutableRecipeRevisionIdentity,
  normalizeExactRevisionIdentity,
} from "./executable-recipe-revision-store-v1.mjs";

export const EXECUTABLE_RECIPE_RUN_CONTRACT = "recipe.executable.run.v1";
export const EXECUTABLE_RECIPE_RUN_STATE_CONTRACT = "recipe.executable.run_state.v1";
export const EXECUTABLE_RECIPE_EVIDENCE_CONTRACT = "recipe.executable.evidence.v1";
export const EXECUTABLE_RECIPE_PREFLIGHT_RUNTIME_CONTRACT = "recipe.executable.preflight_runtime.v1";

export const EXECUTABLE_RECIPE_RUN_OPERATIONS = Object.freeze([
  "validate",
  "save",
  "list",
  "get",
  "delete",
  "run",
  "resume",
]);

export const EXECUTABLE_RECIPE_RUN_STATUSES = Object.freeze([
  "validated",
  "saved",
  "listed",
  "loaded",
  "deleted",
  "preflight_ok",
  "running",
  "succeeded",
  "partial",
  "failed",
  "blocked",
]);

export const EXECUTABLE_RECIPE_RUN_ERROR_CODES = Object.freeze([
  "PARAMS_INVALID",
  "OPERATION_INVALID",
  "INLINE_EXECUTION_FORBIDDEN",
  "REVISION_IDENTITY_INCOMPLETE",
  "REVISION_NOT_FOUND",
  "REVISION_MISMATCH",
  "TRUST_INVALID",
  "PREFLIGHT_FAILED",
  "DISPATCHER_UNAVAILABLE",
  "STAGE_FAILED",
  "READBACK_UNVERIFIED",
  "RESUME_UNSAFE",
  "RESUME_IDENTITY_INVALID",
  "CHECKPOINT_MISMATCH",
  "EVIDENCE_NOT_FOUND",
  "EVIDENCE_BUDGET_EXCEEDED",
  "RESPONSE_BUDGET_INSUFFICIENT",
  "RESPONSE_TOO_LARGE",
  "RUNTIME_FACTS_UNAVAILABLE",
  "CHECKPOINT_UNVERIFIED",
  "STORE_ERROR",
  "ZERO_WRITE_FAILURE",
]);

export const EXECUTABLE_RECIPE_RUN_BUDGETS = Object.freeze({
  response_default_bytes: 16_384,
  response_max_bytes: 65_536,
  mutation_response_min_bytes: 4_096,
  list_default_items: 16,
  list_max_items: 32,
  evidence_page_max_items: 8,
  evidence_page_max_bytes: 8_192,
  evidence_stage_summary_max_chars: 160,
  next_call_max_bytes: 2_048,
  verified_output_max_count: EXECUTABLE_RECIPE_BUDGETS.output_max_count,
  verified_output_max_bytes: 1_024,
  partial_change_max_count: 16,
  run_id_hex_chars: 32,
});

export const EXECUTABLE_RECIPE_RUN_FORBIDDEN_INLINE_FIELDS = Object.freeze([
  "draft",
  "graph",
  "stages",
  "dependencies",
  "inline_graph",
  "model_graph",
  "handlers",
  "program",
  "execute",
  "executor",
  "runtime_facts",
]);

const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const FORBIDDEN_INLINE_SET = new Set(EXECUTABLE_RECIPE_RUN_FORBIDDEN_INLINE_FIELDS);
const STAGE_KINDS = new Set(["macro", "template", "get_state", "checkpoint"]);

export class ExecutableRecipeRunError extends Error {
  constructor(message, code = "PARAMS_INVALID", details = {}) {
    super(message);
    this.name = "ExecutableRecipeRunError";
    this.code = EXECUTABLE_RECIPE_RUN_ERROR_CODES.includes(code) ? code : "PARAMS_INVALID";
    this.details = details;
  }
}

export function buildExactRunRevisionIdentity(input = {}) {
  // Run authority identity is exactly recipe_id + version + revision + content_hash + validation_result_id.
  // dependency_lock / source_payload_identity may be supplied or loaded from the stored revision.
  const identity = normalizeExactRevisionIdentity(input, {
    requireContentHash: true,
    requireFullIdentity: false,
  });
  if (typeof identity.validation_result_id !== "string" || identity.validation_result_id.trim() === "") {
    throw new ExecutableRecipeRunError(
      "run identity requires validation_result_id.",
      "REVISION_IDENTITY_INCOMPLETE",
      { field: "validation_result_id" },
    );
  }
  return deepFreeze({
    recipe_id: identity.recipe_id,
    version: identity.version,
    revision: identity.revision,
    content_hash: identity.content_hash,
    validation_result_id: identity.validation_result_id,
    dependency_lock: identity.dependency_lock,
    dependency_lock_identity: identity.dependency_lock_identity,
    source_payload_identity: identity.source_payload_identity,
  });
}

export function rejectInlineExecutionPayload(input = {}, field = "request") {
  if (!isPlainObject(input)) {
    throw new ExecutableRecipeRunError(`${field} must be an object.`, "PARAMS_INVALID");
  }
  const forbidden = Object.keys(input).filter((key) => FORBIDDEN_INLINE_SET.has(key));
  if (forbidden.length > 0) {
    throw new ExecutableRecipeRunError(
      `${field} forbids inline draft/graph execution fields.`,
      "INLINE_EXECUTION_FORBIDDEN",
      { fields: forbidden.slice(0, 16) },
    );
  }
  // `revision` may be the numeric identity field, but never an inline object payload.
  if (isPlainObject(input.revision)) {
    throw new ExecutableRecipeRunError(
      `${field}.revision must not carry an inline sealed revision payload for run/resume.`,
      "INLINE_EXECUTION_FORBIDDEN",
      { fields: ["revision"] },
    );
  }
  if (input.recipe != null && isPlainObject(input.recipe) && (
    Array.isArray(input.recipe.stages)
    || Array.isArray(input.recipe.dependencies)
    || input.recipe.draft != null
    || input.recipe.graph != null
  )) {
    throw new ExecutableRecipeRunError(
      `${field}.recipe must not carry inline stages/dependencies/draft/graph.`,
      "INLINE_EXECUTION_FORBIDDEN",
    );
  }
  return true;
}

export function matchStoredRevisionIdentity(loaded, identity, options = {}) {
  const payload = loaded?.payload ?? loaded;
  if (!isPlainObject(payload)) {
    throw new ExecutableRecipeRunError("Stored revision payload missing.", "REVISION_NOT_FOUND");
  }
  const expected = buildExactRunRevisionIdentity(identity);
  if (options.catalog) {
    normalizeExecutableRecipeRevision(payload, { catalog: options.catalog });
  }
  const actual = {
    recipe_id: payload.recipe_id,
    version: payload.version,
    revision: payload.revision,
    content_hash: payload.content_hash,
    validation_result_id: payload.validation_result_id,
  };
  for (const key of ["recipe_id", "version", "revision", "content_hash", "validation_result_id"]) {
    if (actual[key] !== expected[key]) {
      throw new ExecutableRecipeRunError(
        `Stored revision ${key} does not match exact run identity.`,
        "REVISION_MISMATCH",
        { expected: expected[key], actual: actual[key], field: key },
      );
    }
  }
  return deepFreeze({
    identity: expected,
    payload,
    discovery: loaded?.discovery ?? null,
  });
}

export function buildTrustFactsFromRuntime(revision, runtimeFacts = {}) {
  const facts = isPlainObject(runtimeFacts) ? runtimeFacts : {};
  return deepFreeze({
    content_hash: facts.content_hash,
    risk_grants: Array.isArray(facts.risk_grants) ? facts.risk_grants : null,
    project_identity: facts.project_identity,
    bridge_owner: facts.bridge_owner,
    bridge_generation: facts.bridge_generation,
    available_capabilities: Array.isArray(facts.available_capabilities)
      ? facts.available_capabilities
      : null,
    dependency_versions: Array.isArray(facts.dependency_versions)
      ? facts.dependency_versions
      : null,
    dependency_descriptors: Array.isArray(facts.dependency_descriptors)
      ? facts.dependency_descriptors
      : null,
    checkpoint_evidence: Array.isArray(facts.checkpoint_evidence)
      ? facts.checkpoint_evidence
      : null,
  });
}

export function evaluateRunTrust(revision, runtimeFacts = {}, options = {}) {
  const facts = buildTrustFactsFromRuntime(revision, runtimeFacts);
  const trust = evaluateExecutableRecipeTrust(revision, facts, options);
  return deepFreeze({
    ...trust,
    contract: EXECUTABLE_RECIPE_TRUST_CONTRACT,
    facts_used: {
      project_identity: facts.project_identity,
      bridge_owner: facts.bridge_owner,
      bridge_generation: facts.bridge_generation,
    },
  });
}

export function preflightExecutableRecipeRevision(revisionInput, options = {}) {
  const catalog = options.catalog;
  const revision = normalizeExecutableRecipeRevision(revisionInput, { catalog });
  const dispatchers = normalizeDispatchers(options.dispatchers);
  const runtimeFacts = isPlainObject(options.runtime_facts) ? options.runtime_facts : {};
  const errors = [];
  const draft = revision.draft;

  if (draft.preflight?.contract !== EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT) {
    errors.push("revision preflight contract is invalid.");
  }
  if (draft.preflight?.complete_graph !== true) {
    errors.push("preflight.complete_graph must be true.");
  }
  if (draft.preflight?.forbids_inline_execution !== true) {
    errors.push("preflight.forbids_inline_execution must be true.");
  }
  if (draft.preflight?.requires_save_before_run !== true) {
    errors.push("preflight.requires_save_before_run must be true.");
  }

  for (const stage of draft.stages) {
    if (!STAGE_KINDS.has(stage.kind)) {
      errors.push(`stage ${stage.id} has unsupported kind ${stage.kind}.`);
      continue;
    }
    if (stage.kind === "macro" && typeof dispatchers.macro !== "function") {
      errors.push(`macro dispatcher unavailable for stage ${stage.id}.`);
    }
    if (stage.kind === "template" && typeof dispatchers.template !== "function") {
      errors.push(`template dispatcher unavailable for stage ${stage.id}.`);
    }
    if (stage.kind === "get_state" && typeof dispatchers.get_state !== "function") {
      errors.push(`get_state dispatcher unavailable for stage ${stage.id}.`);
    }
    if (stage.kind === "checkpoint" && typeof dispatchers.checkpoint !== "function") {
      errors.push(`checkpoint dispatcher unavailable for stage ${stage.id}.`);
    }
  }

  const trust = evaluateRunTrust(revision, runtimeFacts, { catalog });
  if (!trust.trusted) {
    errors.push(`trust invalid: ${trust.invalidation_reasons.join(",")}`);
  }

  const inputs = isPlainObject(options.inputs) ? options.inputs : {};
  for (const port of draft.inputs) {
    if (port.required === true && (inputs[port.id] === undefined || inputs[port.id] === null)) {
      errors.push(`required input missing: ${port.id}`);
    }
  }

  const ok = errors.length === 0;
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_PREFLIGHT_RUNTIME_CONTRACT,
    ok,
    mutates_project: false,
    complete_graph: true,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    stage_count: draft.stages.length,
    dependency_count: draft.dependencies.length,
    trust,
    errors,
    dispatcher_availability: {
      macro: typeof dispatchers.macro === "function",
      template: typeof dispatchers.template === "function",
      get_state: typeof dispatchers.get_state === "function",
      checkpoint: typeof dispatchers.checkpoint === "function",
    },
  });
}

export function createExecutableRecipeRunId(seed = null) {
  if (typeof seed === "string" && seed.trim() !== "") return seed.trim();
  return `run_${randomBytes(EXECUTABLE_RECIPE_RUN_BUDGETS.run_id_hex_chars / 2).toString("hex")}`;
}

export function createExecutableRecipeEvidenceRef(runId, page = 0) {
  return `evidence:recipe-run:${runId}:page:${page}`;
}

export function pageExecutableRecipeEvidence(evidenceStore, request = {}) {
  if (!isPlainObject(request)) {
    throw new ExecutableRecipeRunError("evidence get request must be an object.", "PARAMS_INVALID");
  }
  const evidenceRef = request.evidence_ref ?? request.evidenceRef;
  if (typeof evidenceRef !== "string" || evidenceRef.trim() === "") {
    throw new ExecutableRecipeRunError("evidence_ref is required.", "PARAMS_INVALID");
  }
  const record = evidenceStore?.get?.(evidenceRef);
  if (!record) {
    throw new ExecutableRecipeRunError("Evidence page not found.", "EVIDENCE_NOT_FOUND", {
      evidence_ref: evidenceRef,
    });
  }
  const limit = clampInt(request.limit, 1, EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_page_max_items, 8);
  const cursor = typeof request.cursor === "string" && request.cursor !== ""
    ? Number.parseInt(request.cursor, 10)
    : 0;
  const start = Number.isInteger(cursor) && cursor >= 0 ? cursor : 0;
  const items = Array.isArray(record.items) ? record.items : [];
  const pageItems = items.slice(start, start + limit).map((item) => compactEvidenceItem(item));
  const nextStart = start + pageItems.length;
  const hasMore = nextStart < items.length;
  const body = {
    contract: EXECUTABLE_RECIPE_EVIDENCE_CONTRACT,
    ok: true,
    evidence_ref: evidenceRef,
    run_id: record.run_id,
    recipe_id: record.recipe_id,
    version: record.version,
    revision: record.revision,
    content_hash: record.content_hash,
    items: pageItems,
    page: {
      limit,
      cursor: String(start),
      next_cursor: hasMore ? String(nextStart) : null,
      has_more: hasMore,
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(body), "utf8");
  if (bytes > EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_page_max_bytes) {
    throw new ExecutableRecipeRunError(
      "Evidence page exceeds budget.",
      "EVIDENCE_BUDGET_EXCEEDED",
      { bytes, max_bytes: EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_page_max_bytes },
    );
  }
  return deepFreeze(body);
}

export function compactStageEvidence(stage, outcome) {
  return deepFreeze({
    stage_id: stage.id,
    kind: stage.kind,
    status: outcome.status,
    verified: outcome.verified === true,
    summary: boundedString(outcome.summary ?? `${stage.kind} ${outcome.status}`, EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_stage_summary_max_chars),
    outputs: Array.isArray(outcome.outputs) ? outcome.outputs.slice(0, 8) : [],
    checkpoint_id: stage.checkpoint ?? null,
  });
}

export function buildExactNextCall(operation, args = {}) {
  const next = {
    tool: "call_recipe",
    arguments: {
      operation,
      ...cloneJson(args),
    },
  };
  const bytes = Buffer.byteLength(JSON.stringify(next), "utf8");
  if (bytes > EXECUTABLE_RECIPE_RUN_BUDGETS.next_call_max_bytes) {
    throw new ExecutableRecipeRunError(
      "next_call exceeds budget.",
      "PARAMS_INVALID",
      { bytes },
    );
  }
  return deepFreeze(next);
}

export function projectRunSuccessEnvelope({
  operation = "run",
  revision,
  runId,
  status,
  processed,
  applied,
  skipped,
  verifiedOutputs,
  timing,
  evidenceRef,
  latestCheckpoint = null,
}) {
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_RUN_CONTRACT,
    ok: true,
    operation: operation === "resume" ? "resume" : "run",
    status,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    validation_result_id: revision.validation_result_id,
    run_id: runId,
    counts: {
      processed: processed ?? 0,
      applied: applied ?? 0,
      skipped: skipped ?? 0,
    },
    verified_outputs: Array.isArray(verifiedOutputs)
      ? verifiedOutputs
        .slice(0, EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_count)
        .map((output) => boundedVerifiedOutput(output))
      : [],
    timing: isPlainObject(timing) ? timing : {},
    evidence_ref: evidenceRef,
    latest_checkpoint: latestCheckpoint,
  });
}

export function projectRunFailureEnvelope({
  operation = "run",
  revision = null,
  runId = null,
  status,
  code,
  message,
  failedStageIds = [],
  completedStageIds = [],
  notStartedStageIds = [],
  provenPartialChanges = [],
  counts = null,
  latestCheckpoint = null,
  recovery = null,
  undo = null,
  resumeSafe = false,
  nextCall = null,
  evidenceRef = null,
  details = null,
}) {
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_RUN_CONTRACT,
    ok: false,
    operation: operation === "resume" ? "resume" : "run",
    status,
    recipe_id: revision?.recipe_id ?? null,
    version: revision?.version ?? null,
    revision: revision?.revision ?? null,
    content_hash: revision?.content_hash ?? null,
    validation_result_id: revision?.validation_result_id ?? null,
    run_id: runId,
    error: {
      code,
      message,
      details: details == null
        ? undefined
        : boundedJsonProjection(details, EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes),
    },
    stages: {
      failed: failedStageIds,
      completed: completedStageIds,
      not_started: notStartedStageIds,
    },
    counts: isPlainObject(counts)
      ? {
          processed: Number.isSafeInteger(counts.processed) && counts.processed >= 0 ? counts.processed : 0,
          applied: Number.isSafeInteger(counts.applied) && counts.applied >= 0 ? counts.applied : 0,
          skipped: Number.isSafeInteger(counts.skipped) && counts.skipped >= 0 ? counts.skipped : 0,
        }
      : undefined,
    proven_partial_changes: Array.isArray(provenPartialChanges)
      ? provenPartialChanges
        .slice(0, EXECUTABLE_RECIPE_RUN_BUDGETS.partial_change_max_count)
        .map((change) => boundedJsonProjection(change, EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes))
      : [],
    latest_checkpoint: latestCheckpoint,
    recovery: recovery ?? {
      strategy: resumeSafe ? "resume_from_checkpoint" : "inspect_and_repair",
      rollback_claimed: false,
    },
    undo: undo ?? {
      claimed: false,
      proven: false,
    },
    resume_safe: resumeSafe === true,
    next_call: nextCall,
    evidence_ref: evidenceRef,
  });
}

export function resolveStageBindings(stage, bindingValues, recipeInputs) {
  const resolved = {};
  for (const port of stage.inputs ?? []) {
    if (Object.prototype.hasOwnProperty.call(bindingValues, `${stage.id}:${port}`)) {
      resolved[port] = bindingValues[`${stage.id}:${port}`];
    } else if (Object.prototype.hasOwnProperty.call(recipeInputs, port)) {
      resolved[port] = recipeInputs[port];
    }
  }
  return resolved;
}

export function applyBindingsAfterStage(bindings, stage, stageOutputs, bindingValues) {
  const next = { ...bindingValues };
  for (const binding of bindings) {
    if (binding.from?.scope === "stage" && binding.from.id === stage.id) {
      const value = stageOutputs[binding.from.port];
      if (binding.to?.scope === "stage" && typeof binding.to.id === "string") {
        next[`${binding.to.id}:${binding.to.port}`] = value;
      } else if (binding.to?.scope === "recipe_output") {
        next[`recipe_output:${binding.to.port}`] = value;
      }
    }
  }
  for (const [port, value] of Object.entries(stageOutputs)) {
    next[`${stage.id}:${port}`] = value;
  }
  return next;
}

export function seedBindingValuesFromInputs(bindings, inputs) {
  const values = {};
  for (const binding of bindings) {
    if (binding.from?.scope === "recipe_input" && binding.to?.scope === "stage") {
      values[`${binding.to.id}:${binding.to.port}`] = inputs[binding.from.port];
    }
  }
  return values;
}

export function collectRecipeOutputs(draft, bindingValues) {
  const outputs = [];
  for (const port of draft.outputs ?? []) {
    const key = `recipe_output:${port.id}`;
    if (Object.prototype.hasOwnProperty.call(bindingValues, key)) {
      outputs.push({ id: port.id, value: bindingValues[key], verified: true });
    }
  }
  return outputs;
}

function normalizeDispatchers(dispatchers = {}) {
  const value = isPlainObject(dispatchers) ? dispatchers : {};
  return {
    macro: value.macro,
    template: value.template,
    get_state: value.get_state ?? value.getState,
    checkpoint: value.checkpoint,
  };
}

function compactEvidenceItem(item) {
  if (!isPlainObject(item)) return { summary: boundedString(String(item), 80) };
  return {
    stage_id: item.stage_id ?? null,
    kind: item.kind ?? null,
    status: item.status ?? null,
    verified: item.verified === true,
    summary: boundedString(item.summary ?? "", EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_stage_summary_max_chars),
    checkpoint_id: item.checkpoint_id ?? null,
  };
}

function clampInt(value, min, max, fallback) {
  if (!Number.isInteger(value)) return fallback;
  if (value < min) return min;
  if (value > max) return max;
  return value;
}

function boundedString(value, maxChars) {
  const text = typeof value === "string" ? value : String(value ?? "");
  if (text.length <= maxChars) return text;
  return text.slice(0, maxChars);
}

function boundedVerifiedOutput(output) {
  if (!isPlainObject(output)) return { id: null, verified: false };
  const projected = {
    id: typeof output.id === "string" ? boundedString(output.id, 96) : null,
    verified: output.verified === true,
  };
  if (Object.prototype.hasOwnProperty.call(output, "value")) {
    projected.value = boundedJsonProjection(
      output.value,
      EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes,
    );
  }
  return projected;
}

function boundedJsonProjection(value, maxBytes) {
  try {
    if (Buffer.byteLength(JSON.stringify(value), "utf8") <= maxBytes) return cloneJson(value);
  } catch {}
  return { omitted: true, reason: "inline_value_exceeds_call_recipe_budget" };
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (value == null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

// Keep identity helper re-export for runtime consumers without store coupling beyond identity.
export { buildExecutableRecipeRevisionIdentity };
