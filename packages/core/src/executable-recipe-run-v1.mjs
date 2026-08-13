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
  "REVISION_STALE",
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
  verified_output_expanded_max_bytes: 8_192,
  verified_output_total_max_bytes: 32_768,
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
    run_summary: compactRunSummary(record.run_summary),
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
  maxResponseBytes = EXECUTABLE_RECIPE_RUN_BUDGETS.response_max_bytes,
}) {
  const boundedOutputs = Array.isArray(verifiedOutputs)
    ? verifiedOutputs.slice(0, EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_count)
    : [];
  const outputValueBudget = executableRecipeVerifiedOutputValueBudget(
    boundedOutputs.length,
    maxResponseBytes,
  );
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
    verified_outputs: boundedOutputs.map((output) => boundedVerifiedOutput(output, outputValueBudget)),
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

export function resolveStageBindings(stage, bindingValues, recipeInputs, bindings = []) {
  const resolved = {};
  for (const port of stage.inputs ?? []) {
    const expressionBinding = bindings.find((binding) =>
      isPlainObject(binding?.expression)
      && binding?.to?.scope === "stage"
      && binding.to.id === stage.id
      && binding.to.port === port);
    if (expressionBinding) {
      resolved[port] = evaluateExecutableRecipeExpression(expressionBinding.expression, {
        inputs: recipeInputs,
        binding_values: bindingValues,
      });
    } else if (Object.prototype.hasOwnProperty.call(bindingValues, `${stage.id}:${port}`)) {
      resolved[port] = bindingValues[`${stage.id}:${port}`];
    } else if (Object.prototype.hasOwnProperty.call(recipeInputs, port)) {
      resolved[port] = recipeInputs[port];
    }
  }
  return resolved;
}

export function resolveStageRefs(stage, bindingValues, recipeInputs, bindings = []) {
  const expressionBinding = bindings.find((binding) =>
    isPlainObject(binding?.expression)
    && binding?.to?.scope === "stage_refs"
    && binding.to.id === stage.id
    && binding.to.port === "refs");
  const refs = {};
  if (expressionBinding) {
    const resolved = evaluateExecutableRecipeExpression(expressionBinding.expression, {
      inputs: recipeInputs,
      binding_values: bindingValues,
    });
    if (!isPlainObject(resolved)) {
      throw expressionError("Recipe stage_refs expression must evaluate to an object.", "EXPRESSION_TYPE_INVALID");
    }
    Object.assign(refs, resolved);
  }
  for (const binding of bindings) {
    if (binding?.to?.scope !== "refs" || binding.to.id !== stage.id) continue;
    const port = binding.to.port;
    if (Object.prototype.hasOwnProperty.call(refs, port)) {
      throw expressionError(`Recipe stage ref ${stage.id}.${port} has multiple resolved values.`, "EXPRESSION_TYPE_INVALID");
    }
    if (isPlainObject(binding.expression)) {
      refs[port] = evaluateExecutableRecipeExpression(binding.expression, {
        inputs: recipeInputs,
        binding_values: bindingValues,
      });
      continue;
    }
    const key = `refs:${stage.id}:${port}`;
    if (Object.prototype.hasOwnProperty.call(bindingValues, key)) refs[port] = bindingValues[key];
  }
  return Object.keys(refs).length === 0 ? null : refs;
}

export function applyBindingsAfterStage(bindings, stage, stageOutputs, bindingValues) {
  const next = { ...bindingValues };
  for (const binding of bindings) {
    if (binding.from?.scope === "stage" && binding.from.id === stage.id) {
      const value = stageOutputs[binding.from.port];
      if (binding.to?.scope === "stage" && typeof binding.to.id === "string") {
        next[`${binding.to.id}:${binding.to.port}`] = value;
      } else if (binding.to?.scope === "refs" && typeof binding.to.id === "string") {
        next[`refs:${binding.to.id}:${binding.to.port}`] = value;
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
    if (binding.from?.scope !== "recipe_input") continue;
    if (binding.to?.scope === "stage") {
      values[`${binding.to.id}:${binding.to.port}`] = inputs[binding.from.port];
    } else if (binding.to?.scope === "refs") {
      values[`refs:${binding.to.id}:${binding.to.port}`] = inputs[binding.from.port];
    }
  }
  return values;
}

export function collectRecipeOutputs(draft, bindingValues, recipeInputs = {}) {
  const outputs = [];
  for (const port of draft.outputs ?? []) {
    const key = `recipe_output:${port.id}`;
    const expressionBinding = (draft.bindings ?? []).find((binding) =>
      isPlainObject(binding?.expression)
      && binding?.to?.scope === "recipe_output"
      && binding.to.port === port.id);
    const hasBoundValue = Object.prototype.hasOwnProperty.call(bindingValues, key);
    if (expressionBinding || hasBoundValue) {
      const value = expressionBinding
        ? evaluateExecutableRecipeExpression(expressionBinding.expression, {
            inputs: recipeInputs,
            binding_values: bindingValues,
          })
        : bindingValues[key];
      outputs.push({ id: port.id, value, verified: true });
    }
  }
  return outputs;
}

export function evaluateExecutableRecipeExpression(expression, context = {}) {
  const budget = { nodes: 0, items: 0, visited_nodes: new WeakSet() };
  const value = evaluateExpression(expression, {
    inputs: isPlainObject(context.inputs) ? context.inputs : {},
    binding_values: isPlainObject(context.binding_values) ? context.binding_values : {},
    locals: isPlainObject(context.locals) ? context.locals : {},
    budget,
    depth: 1,
  });
  assertEvaluatedValueBudget(value, budget);
  return cloneJson(value);
}

function evaluateExpression(expression, context) {
  if (isPlainObject(expression) && !context.budget.visited_nodes.has(expression)) {
    context.budget.visited_nodes.add(expression);
    context.budget.nodes += 1;
  }
  if (context.depth > EXECUTABLE_RECIPE_BUDGETS.expression_max_depth
    || context.budget.nodes > EXECUTABLE_RECIPE_BUDGETS.expression_max_nodes) {
    throw expressionError("Recipe expression budget exceeded.", "EXPRESSION_BUDGET_EXCEEDED");
  }
  if (!isPlainObject(expression) || typeof expression.op !== "string") {
    throw expressionError("Recipe expression is invalid.", "EXPRESSION_INVALID");
  }
  const child = (value, locals = context.locals) => evaluateExpression(value, {
    ...context,
    locals,
    depth: context.depth + 1,
  });
  switch (expression.op) {
    case "literal":
      return cloneJson(expression.value);
    case "input":
      return context.inputs[expression.id];
    case "stage": {
      const key = `${expression.id}:${expression.port}`;
      if (!Object.prototype.hasOwnProperty.call(context.binding_values, key)) {
        throw expressionError(`Recipe expression stage output is unavailable: ${key}.`, "EXPRESSION_STAGE_OUTPUT_MISSING");
      }
      return context.binding_values[key];
    }
    case "local":
      if (!Object.prototype.hasOwnProperty.call(context.locals, expression.id)) {
        throw expressionError(`Recipe expression local is unavailable: ${expression.id}.`, "EXPRESSION_LOCAL_MISSING");
      }
      return context.locals[expression.id];
    case "object": {
      const output = {};
      for (const [key, nested] of Object.entries(expression.fields ?? {})) {
        const value = child(nested);
        if (value !== undefined) output[key] = value;
      }
      return output;
    }
    case "array": {
      const items = expression.items ?? [];
      addExpressionItems(context.budget, items.length);
      return items.map((item) => child(item));
    }
    case "get": {
      let value = child(expression.value);
      for (const segment of expression.path ?? []) {
        if (value == null) return undefined;
        value = value[segment];
      }
      return value;
    }
    case "coalesce": {
      for (const candidate of expression.values ?? []) {
        const value = child(candidate);
        if (value !== undefined && value !== null) return value;
      }
      return null;
    }
    case "if":
      return child(expression.condition) ? child(expression.then) : child(expression.else);
    case "map":
    case "flat_map":
    case "filter": {
      const items = requireExpressionArray(child(expression.items), expression.op);
      addExpressionItems(context.budget, items.length);
      const output = [];
      for (const [index, item] of items.entries()) {
        const locals = { ...context.locals, [expression.as]: item, [expression.index_as]: index };
        const value = child(expression.body, locals);
        if (expression.op === "flat_map") {
          const nested = requireExpressionArray(value, "flat_map body");
          addExpressionItems(context.budget, nested.length);
          output.push(...nested);
        } else if (expression.op === "filter") {
          if (value) output.push(item);
        } else {
          output.push(value);
        }
        if (output.length > EXECUTABLE_RECIPE_BUDGETS.expression_collection_max_items) {
          throw expressionError("Recipe expression collection exceeds its item budget.", "EXPRESSION_BUDGET_EXCEEDED");
        }
      }
      return output;
    }
    case "lookup_by": {
      const items = requireExpressionArray(child(expression.items), "lookup_by");
      addExpressionItems(context.budget, items.length);
      const expected = child(expression.value);
      const matches = items.filter((item) => isPlainObject(item)
        && Object.hasOwn(item, expression.key)
        && stableExpressionValue(item[expression.key]) === stableExpressionValue(expected));
      if (matches.length !== 1) {
        throw expressionError("Recipe expression lookup_by requires exactly one match.", "EXPRESSION_VALUE_INVALID");
      }
      return matches[0];
    }
    case "range": {
      const start = requireSafeInteger(child(expression.start), "range.start");
      const count = requireSafeInteger(child(expression.count), "range.count");
      if (count < 0 || count > EXECUTABLE_RECIPE_BUDGETS.expression_collection_max_items) {
        throw expressionError("Recipe expression range count is outside its budget.", "EXPRESSION_BUDGET_EXCEEDED");
      }
      addExpressionItems(context.budget, count);
      return Array.from({ length: count }, (_, index) => start + index);
    }
    case "length": {
      const value = child(expression.value);
      if (!Array.isArray(value) && typeof value !== "string") {
        throw expressionError("Recipe expression length requires an array or string.", "EXPRESSION_TYPE_INVALID");
      }
      return value.length;
    }
    case "min":
    case "max": {
      const source = requireExpressionArray(child(expression.value), expression.op);
      addExpressionItems(context.budget, source.length);
      const values = source.map((value) => requireFiniteNumber(value, expression.op));
      if (values.length === 0) throw expressionError(`Recipe expression ${expression.op} requires values.`, "EXPRESSION_TYPE_INVALID");
      return expression.op === "min" ? Math.min(...values) : Math.max(...values);
    }
    case "add":
      return numericValues(expression, child).reduce((sum, value) => sum + value, 0);
    case "sub": {
      const values = numericValues(expression, child);
      return values.slice(1).reduce((result, value) => result - value, values[0]);
    }
    case "mul":
      return numericValues(expression, child).reduce((result, value) => result * value, 1);
    case "div": {
      const values = numericValues(expression, child);
      return values.slice(1).reduce((result, value) => {
        if (value === 0) throw expressionError("Recipe expression division by zero.", "EXPRESSION_VALUE_INVALID");
        return result / value;
      }, values[0]);
    }
    case "mod": {
      const values = numericValues(expression, child);
      if (values[1] === 0) throw expressionError("Recipe expression modulo by zero.", "EXPRESSION_VALUE_INVALID");
      return values.slice(1).reduce((result, value) => result % value, values[0]);
    }
    case "clamp": {
      const value = requireFiniteNumber(child(expression.value), "clamp.value");
      const min = requireFiniteNumber(child(expression.min), "clamp.min");
      const max = requireFiniteNumber(child(expression.max), "clamp.max");
      if (min > max) throw expressionError("Recipe expression clamp min exceeds max.", "EXPRESSION_VALUE_INVALID");
      return Math.min(max, Math.max(min, value));
    }
    case "eq": {
      const values = (expression.values ?? []).map((value) => child(value));
      addExpressionItems(context.budget, values.length);
      return values.every((value) => stableExpressionValue(value) === stableExpressionValue(values[0]));
    }
    case "join": {
      const values = requireExpressionArray(child(expression.values), "join");
      addExpressionItems(context.budget, values.length);
      return values.map((value) => String(value)).join(expression.separator);
    }
    case "concat": {
      const values = (expression.values ?? []).map((value) => child(value));
      addExpressionItems(context.budget, values.length);
      if (values.every(Array.isArray)) {
        addExpressionItems(context.budget, values.reduce((count, value) => count + value.length, 0));
        return values.flat();
      }
      return values.map((value) => String(value)).join("");
    }
    case "seeded_uniform": {
      const seed = requireSafeInteger(child(expression.seed), "seeded_uniform.seed");
      const index = requireSafeInteger(child(expression.index), "seeded_uniform.index");
      const min = requireFiniteNumber(child(expression.min), "seeded_uniform.min");
      const max = requireFiniteNumber(child(expression.max), "seeded_uniform.max");
      if (min > max) throw expressionError("Recipe expression seeded_uniform min exceeds max.", "EXPRESSION_VALUE_INVALID");
      const digest = createHash("sha256").update(`${seed}:${index}`).digest();
      const unit = digest.readUInt32BE(0) / 0xffffffff;
      return min + ((max - min) * unit);
    }
    default:
      throw expressionError(`Recipe expression op is unsupported: ${expression.op}.`, "EXPRESSION_OP_UNSUPPORTED");
  }
}

function numericValues(expression, child) {
  return (expression.values ?? []).map((value) => requireFiniteNumber(child(value), expression.op));
}

function requireExpressionArray(value, field) {
  if (!Array.isArray(value)) throw expressionError(`Recipe expression ${field} requires an array.`, "EXPRESSION_TYPE_INVALID");
  if (value.length > EXECUTABLE_RECIPE_BUDGETS.expression_collection_max_items) {
    throw expressionError(`Recipe expression ${field} exceeds its collection budget.`, "EXPRESSION_BUDGET_EXCEEDED");
  }
  return value;
}

function requireFiniteNumber(value, field) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw expressionError(`Recipe expression ${field} requires a finite number.`, "EXPRESSION_TYPE_INVALID");
  }
  return value;
}

function requireSafeInteger(value, field) {
  if (!Number.isSafeInteger(value)) {
    throw expressionError(`Recipe expression ${field} requires a safe integer.`, "EXPRESSION_TYPE_INVALID");
  }
  return value;
}

function addExpressionItems(budget, count) {
  budget.items += count;
  if (budget.items > EXECUTABLE_RECIPE_BUDGETS.expression_collection_work_max_items) {
    throw expressionError("Recipe expression total collection work exceeds its budget.", "EXPRESSION_BUDGET_EXCEEDED");
  }
}

function assertEvaluatedValueBudget(value, budget) {
  let encoded;
  try {
    encoded = JSON.stringify(value);
  } catch {
    throw expressionError("Recipe expression output is not JSON-serializable.", "EXPRESSION_VALUE_INVALID");
  }
  if (encoded === undefined || Buffer.byteLength(encoded, "utf8") > EXECUTABLE_RECIPE_BUDGETS.graph_max_bytes) {
    throw expressionError("Recipe expression output exceeds its byte budget.", "EXPRESSION_BUDGET_EXCEEDED");
  }
  if (budget.nodes > EXECUTABLE_RECIPE_BUDGETS.expression_max_nodes) {
    throw expressionError("Recipe expression node budget exceeded.", "EXPRESSION_BUDGET_EXCEEDED");
  }
}

function stableExpressionValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableExpressionValue).join(",")}]`;
  if (isPlainObject(value)) return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableExpressionValue(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function expressionError(message, reason) {
  return new ExecutableRecipeRunError(message, "PREFLIGHT_FAILED", { reason, zero_write: true });
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
  const compact = {
    stage_id: item.stage_id ?? null,
    kind: item.kind ?? null,
    status: item.status ?? null,
    verified: item.verified === true,
    summary: boundedString(item.summary ?? "", EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_stage_summary_max_chars),
    checkpoint_id: item.checkpoint_id ?? null,
  };
  if (isPlainObject(item.timing)) {
    compact.timing = { duration_ms: Math.max(0, Number.isSafeInteger(item.timing.duration_ms) ? item.timing.duration_ms : 0) };
  }
  if (isPlainObject(item.counters)) {
    compact.counters = {
      transport_call_count: Math.max(0, Number.isSafeInteger(item.counters.transport_call_count) ? item.counters.transport_call_count : 0),
      native_mutation_count: Math.max(0, Number.isSafeInteger(item.counters.native_mutation_count) ? item.counters.native_mutation_count : 0),
      readback_count: Math.max(0, Number.isSafeInteger(item.counters.readback_count) ? item.counters.readback_count : 0),
    };
  }
  return compact;
}

function compactRunSummary(summary) {
  if (!isPlainObject(summary)) return null;
  const counters = isPlainObject(summary.counters) ? summary.counters : {};
  const stages = Array.isArray(summary.timing?.stages) ? summary.timing.stages : [];
  return {
    contract: summary.contract ?? "call_recipe.run_summary.v1",
    timing: {
      duration_ms: Math.max(0, Number.isSafeInteger(summary.timing?.duration_ms) ? summary.timing.duration_ms : 0),
      stage_timing_count: stages.length,
    },
    counters: {
      counter_scope: counters.counter_scope ?? null,
      counter_source: counters.counter_source ?? null,
      transport_call_count: Math.max(0, Number.isSafeInteger(counters.transport_call_count) ? counters.transport_call_count : 0),
      native_mutation_count: Math.max(0, Number.isSafeInteger(counters.native_mutation_count) ? counters.native_mutation_count : 0),
      readback_count: Math.max(0, Number.isSafeInteger(counters.readback_count) ? counters.readback_count : 0),
    },
    mutation_truth: summary.mutation_truth ?? "unknown",
    undo: isPlainObject(summary.undo) ? cloneJson(summary.undo) : null,
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

export function executableRecipeVerifiedOutputValueBudget(outputCount, maxResponseBytes) {
  const count = Math.max(1, Math.min(
    EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_count,
    Number.isInteger(outputCount) ? outputCount : 1,
  ));
  const responseBytes = Number.isInteger(maxResponseBytes)
    ? Math.max(512, Math.min(EXECUTABLE_RECIPE_RUN_BUDGETS.response_max_bytes, maxResponseBytes))
    : EXECUTABLE_RECIPE_RUN_BUDGETS.response_default_bytes;
  const totalBudget = Math.min(
    EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_total_max_bytes,
    Math.max(
      EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes * count,
      responseBytes - EXECUTABLE_RECIPE_RUN_BUDGETS.evidence_page_max_bytes,
    ),
  );
  return Math.min(
    EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_expanded_max_bytes,
    Math.max(
      EXECUTABLE_RECIPE_RUN_BUDGETS.verified_output_max_bytes,
      Math.floor(totalBudget / count),
    ),
  );
}

function boundedVerifiedOutput(output, maxBytes) {
  if (!isPlainObject(output)) return { id: null, verified: false };
  const projected = {
    id: typeof output.id === "string" ? boundedString(output.id, 96) : null,
    verified: output.verified === true,
  };
  if (Object.prototype.hasOwnProperty.call(output, "value")) {
    projected.value = boundedJsonProjection(
      output.value,
      maxBytes,
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
