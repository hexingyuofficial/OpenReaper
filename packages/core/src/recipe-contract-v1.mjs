import { FOUNDATION_BRIDGE_PACK_IDS } from "./foundation-bridge-v1.mjs";
import {
  TEMPLATE_CATALOG_SEED_TEMPLATE_IDS,
  TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  TEMPLATE_CATALOG_P1_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "./template-catalog-fixtures-v1.mjs";
import {
  createTemplateCatalog,
} from "./template-catalog-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ENTITY_KIND_PATTERN,
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  TEMPLATE_DESCRIPTOR_TAG_PATTERN,
  TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS,
} from "./template-descriptor-v1.mjs";
import { validateTemplateInput } from "./template-execution-harness-v1.mjs";

export const RECIPE_CONTRACT = "recipe.contract.v1";
export const RECIPE_CATALOG_CONTRACT = "recipe.catalog.v1";
export const RECIPE_RUN_STATE_CONTRACT = "recipe.run_state.v1";
export const RECIPE_TEMPLATE_EVIDENCE_CONTRACT = "template.runtime.evidence.v1";

export const RECIPE_LIFECYCLES = Object.freeze([
  "draft",
  "validated",
  "fake_smoked",
  "live_smoked",
  "official",
  "community",
  "deprecated",
]);

export const RECIPE_RISKS = Object.freeze([
  "read",
  "safe",
  "write",
  "destructive",
]);

export const RECIPE_DISCOVERY_SUMMARY_FIELDS = Object.freeze([
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
  "workflow_card",
]);

export const RECIPE_DETAIL_FIELDS = Object.freeze([
  "steps",
  "assertions",
  "recovery",
]);

export const RECIPE_FULL_FIELDS = Object.freeze([
  "contract",
  ...RECIPE_DISCOVERY_SUMMARY_FIELDS,
  ...RECIPE_DETAIL_FIELDS,
]);

export const RECIPE_REQUIRED_FIELDS = Object.freeze(
  RECIPE_FULL_FIELDS.filter((field) => field !== "workflow_card"),
);

export const RECIPE_WORKFLOW_CARD_FIELDS = Object.freeze([
  "intent",
  "entry_conditions",
  "supported_steps",
  "candidate_steps",
  "blocked_steps",
  "required_questions",
  "template_atoms",
  "evidence_required",
  "cleanup_plan",
  "typed_blockers",
  "token_budget",
]);

export const RECIPE_STEP_USES = Object.freeze([
  "call_template",
  "get_state",
]);

export const RECIPE_ASSERTION_KINDS = Object.freeze([
  "expected_output",
  "state",
  "template_evidence",
  "checkpoint",
]);

export const RECIPE_RUN_STATES = Object.freeze([
  "not_started",
  "running",
  "paused",
  "succeeded",
  "failed",
  "blocked",
]);

export const RECIPE_TERMINAL_RUN_STATES = Object.freeze([
  "succeeded",
  "failed",
  "blocked",
]);

export const RECIPE_STEP_IDEMPOTENCY_MODES = Object.freeze([
  "none",
  "supported",
  "required",
  "read_only",
]);

export const RECIPE_STEP_IDEMPOTENCY_KEY_SCOPES = Object.freeze([
  "none",
  "recipe_run",
  "step",
  "input_refs",
]);

export const RECIPE_STEP_IDEMPOTENCY_RESUME_POLICIES = Object.freeze([
  "reuse_evidence",
  "rerun",
  "manual_review",
]);

export const RECIPE_CHECKPOINT_RESUME_POLICIES = Object.freeze([
  "continue_next_step",
  "rerun_step",
  "stop_for_user",
]);

export const RECIPE_EVIDENCE_TIMESTAMP_POLICIES = Object.freeze([
  "current_run",
  "retained",
]);

export const RECIPE_RECOVERY_BRANCH_TRIGGERS = Object.freeze([
  "template_error",
  "missing_evidence",
  "assertion_failed",
  "risk_gate_blocked",
  "resume_conflict",
]);

export const RECIPE_RECOVERY_STRATEGIES = Object.freeze([
  "stop",
  "retry_step",
  "resume_from_checkpoint",
  "request_user",
]);

export const RECIPE_RISK_GATE_POLICIES = Object.freeze([
  "fresh_state",
  "user_confirmation",
  "artifact_path_review",
  "manual_approval",
]);

export const RECIPE_BUDGETS = Object.freeze({
  id_max_chars: 96,
  title_max_chars: 80,
  summary_max_chars: 240,
  tag_max_count: 12,
  tag_max_chars: 32,
  workflow_card_text_max_chars: 240,
  workflow_card_list_max_count: 16,
  steps_max_count: 32,
  assertions_max_count: 16,
  checkpoints_max_count: 32,
  evidence_requirements_max_count: 32,
  recovery_branches_max_count: 16,
  risk_gates_max_count: 8,
  discovery_summary_max_bytes: 4_096,
  recipe_max_bytes: 32_768,
});

export const RECIPE_ID_PATTERN =
  /^recipe\.([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*){1,4}$/;

export const RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS = deepFreeze([
  ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  ...TEMPLATE_CATALOG_P1_TEMPLATE_IDS,
]);

const ACCEPTED_TEMPLATE_ID_SET = new Set(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS);

export const RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS = deepFreeze(
  Object.values(TEMPLATE_CATALOG_SEED_TEMPLATE_IDS).filter((id) => !ACCEPTED_TEMPLATE_ID_SET.has(id)),
);

export const RECIPE_CONTRACT_HELD_TEMPLATE_IDS = Object.freeze([
  "template.core.read_template_coverage_summary",
  "template.system.read_ext_state_value",
]);

export const RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS = Object.freeze([
  "action",
  "action_id",
  "bridge",
  "bridge_request",
  "cmd",
  "command",
  "descriptor",
  "lua",
  "operation",
  "operation_family",
  "operation_name",
  "process",
  "raw_descriptor",
  "script",
  "script_body",
  "shell",
  "shell_command",
  "spawn",
  "template",
]);

const ACCEPTED_TEMPLATE_CATALOG = createTemplateCatalog({
  templates: [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
    ...createTemplateCatalogCriticalFillTemplates(),
    ...createTemplateCatalogP1Templates(),
  ],
});
const ACCEPTED_TEMPLATE_BY_ID = new Map(
  ACCEPTED_TEMPLATE_CATALOG.list().map((descriptor) => [descriptor.id, descriptor]),
);

const PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const WORKFLOW_SHAPED_PACK_ID_SET = new Set(TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);
const WORKFLOW_SHAPED_PACK_ID_PATTERN = new RegExp(
  `\\.(${TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS.join("|")})\\.`,
);
const LIFECYCLE_SET = new Set(RECIPE_LIFECYCLES);
const RISK_SET = new Set(RECIPE_RISKS);
const STEP_USE_SET = new Set(RECIPE_STEP_USES);
const ASSERTION_KIND_SET = new Set(RECIPE_ASSERTION_KINDS);
const RUN_STATE_SET = new Set(RECIPE_RUN_STATES);
const TERMINAL_RUN_STATE_SET = new Set(RECIPE_TERMINAL_RUN_STATES);
const STEP_IDEMPOTENCY_MODE_SET = new Set(RECIPE_STEP_IDEMPOTENCY_MODES);
const STEP_IDEMPOTENCY_KEY_SCOPE_SET = new Set(RECIPE_STEP_IDEMPOTENCY_KEY_SCOPES);
const STEP_IDEMPOTENCY_RESUME_POLICY_SET = new Set(RECIPE_STEP_IDEMPOTENCY_RESUME_POLICIES);
const CHECKPOINT_RESUME_POLICY_SET = new Set(RECIPE_CHECKPOINT_RESUME_POLICIES);
const EVIDENCE_TIMESTAMP_POLICY_SET = new Set(RECIPE_EVIDENCE_TIMESTAMP_POLICIES);
const RECOVERY_BRANCH_TRIGGER_SET = new Set(RECIPE_RECOVERY_BRANCH_TRIGGERS);
const RECOVERY_STRATEGY_SET = new Set(RECIPE_RECOVERY_STRATEGIES);
const RISK_GATE_POLICY_SET = new Set(RECIPE_RISK_GATE_POLICIES);
const RAW_EXECUTION_FIELD_SET = new Set(RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS);
const SEED_ONLY_TEMPLATE_ID_SET = new Set(RECIPE_CONTRACT_SEED_ONLY_TEMPLATE_IDS);
const HELD_TEMPLATE_ID_SET = new Set(RECIPE_CONTRACT_HELD_TEMPLATE_IDS);
const RAW_EXECUTION_ID_PATTERNS = Object.freeze([
  /^(?:lua|shell|sh|bash|python|node|osascript|action|raw-action|reaper|bridge):/i,
  /^(?:run_command|run_action|run_job|query_state|artifact_metadata)$/i,
  /^[0-9]{3,}$/,
  /^_[A-Z0-9_]+$/,
  /(?:^|[._:-])(?:raw_lua|lua|script|run_shell|shell_command|run_action|action_id|main_oncommand|execute_api|bridge_operation)(?:[._:-]|$)/i,
  /\b(?:reaper\.|Main_OnCommand|NamedCommandLookup|os\.execute|io\.popen)\b/i,
]);
const RISK_ORDER = new Map(RECIPE_RISKS.map((risk, index) => [risk, index]));
const MUTATING_RISKS = new Set(["write", "destructive"]);

export class RecipeContractValidationError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.name = "RecipeContractValidationError";
    this.errors = errors;
  }
}

export function validateRecipeContract(input) {
  const errors = [];
  validateRecipeShape(input, errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeRecipeContract(input) {
  const result = validateRecipeContract(input);
  if (!result.ok) {
    throw new RecipeContractValidationError(
      `Recipe contract validation failed: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
  return deepFreeze(cloneJson(input));
}

export function recipeContractDiscoverySummary(input) {
  const recipe = normalizeRecipeContract(input);
  const summary = projectFields(recipe, RECIPE_DISCOVERY_SUMMARY_FIELDS);
  const summaryBytes = byteLength(summary);
  if (summaryBytes > RECIPE_BUDGETS.discovery_summary_max_bytes) {
    throw new RecipeContractValidationError(
      `Recipe discovery summary exceeds ${RECIPE_BUDGETS.discovery_summary_max_bytes} bytes.`,
    );
  }
  return deepFreeze(summary);
}

export function recipeContractOnDemandFields(input, fields = RECIPE_DETAIL_FIELDS) {
  const recipe = normalizeRecipeContract(input);
  const selected = uniqueStrings(fields, "fields");
  const allowed = new Set(RECIPE_DETAIL_FIELDS);
  const unknown = selected.filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new RecipeContractValidationError(`Unknown recipe detail field(s): ${unknown.join(", ")}`);
  }
  return deepFreeze(projectFields(recipe, ["id", ...selected]));
}

export function recipeTemplateDependencies(input) {
  const recipe = normalizeRecipeContract(input);
  return deepFreeze(unique(recipe.steps
    .filter((step) => step.uses === "call_template")
    .map((step) => step.call_template.id)));
}

export function recipeExpectedOutputs(input) {
  const recipe = normalizeRecipeContract(input);
  return deepFreeze(recipe.assertions
    .filter((assertion) => assertion.kind === "expected_output")
    .map((assertion) => assertion.outputs));
}

export function validateRecipeCatalog(input = {}) {
  const { errors } = collectRecipeCatalog(input);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeRecipeCatalog(input = {}) {
  const { errors, recipes } = collectRecipeCatalog(input);
  if (errors.length > 0) {
    throw new RecipeContractValidationError(
      `Recipe catalog validation failed: ${errors.join("; ")}`,
      errors,
    );
  }

  return deepFreeze({
    contract: RECIPE_CATALOG_CONTRACT,
    recipes,
  });
}

export function createRecipeCatalog(input = {}) {
  const normalized = normalizeRecipeCatalog(input);
  const recipes = normalized.recipes;
  const byId = new Map(recipes.map((recipe) => [recipe.id, recipe]));
  const ids = deepFreeze(recipes.map((recipe) => recipe.id));

  return Object.freeze({
    contract: RECIPE_CATALOG_CONTRACT,
    size: recipes.length,
    ids,
    list() {
      return recipes;
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    require(id) {
      const recipe = byId.get(id);
      if (!recipe) throw new RecipeContractValidationError(`Unknown recipe id: ${String(id)}.`);
      return recipe;
    },
    summary(id) {
      const recipe = byId.get(id);
      return recipe ? recipeContractDiscoverySummary(recipe) : null;
    },
    summaries() {
      return deepFreeze(recipes.map((recipe) => recipeContractDiscoverySummary(recipe)));
    },
    discoveryRecipes() {
      return recipes;
    },
  });
}

export function createRecipeCatalogDiscovery(catalog, createDiscoveryCatalog) {
  if (!catalog || catalog.contract !== RECIPE_CATALOG_CONTRACT || typeof catalog.discoveryRecipes !== "function") {
    throw new RecipeContractValidationError("createRecipeCatalogDiscovery requires a recipe.catalog.v1 catalog.");
  }
  if (typeof createDiscoveryCatalog !== "function") {
    throw new RecipeContractValidationError(
      "createRecipeCatalogDiscovery requires the Layer 1.5 createDiscoveryCatalog function.",
    );
  }
  const discovery = createDiscoveryCatalog({
    recipes: catalog.discoveryRecipes(),
  });
  const recipesById = new Map(catalog.discoveryRecipes().map((recipe) => [recipe.id, recipe]));

  return Object.freeze({
    list_recipes(request = {}) {
      return listRecipesWithWorkflowCards(discovery, recipesById, request);
    },
  });
}

function listRecipesWithWorkflowCards(discovery, recipesById, request) {
  const { request: forwardedRequest, includeWorkflowCard, appliedFields } =
    normalizeWorkflowCardDiscoveryRequest(request);
  const response = discovery.list_recipes(forwardedRequest);
  if (!includeWorkflowCard) return response;

  const items = response.items.map((item) => {
    const recipe = recipesById.get(item.id);
    if (!isPlainObject(recipe?.workflow_card)) return item;
    return {
      ...item,
      workflow_card: recipe.workflow_card,
    };
  });

  return {
    ...response,
    items,
    applied: {
      ...response.applied,
      fields: appliedFields,
    },
  };
}

function normalizeWorkflowCardDiscoveryRequest(request) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    return {
      request,
      includeWorkflowCard: false,
      appliedFields: [],
    };
  }

  if (request.fields === undefined) {
    return {
      request,
      includeWorkflowCard: true,
      appliedFields: [...RECIPE_DISCOVERY_SUMMARY_FIELDS],
    };
  }

  const rawFields = Array.isArray(request.fields) ? request.fields : [request.fields];
  const normalizedFields = rawFields.map((field) =>
    field === "workflowCard" ? "workflow_card" : field,
  );
  const includeWorkflowCard = normalizedFields.includes("workflow_card");
  if (!includeWorkflowCard) {
    return {
      request,
      includeWorkflowCard: false,
      appliedFields: normalizedFields,
    };
  }

  return {
    request: {
      ...request,
      fields: normalizedFields.filter((field) => field !== "workflow_card"),
    },
    includeWorkflowCard: true,
    appliedFields: unique(normalizedFields),
  };
}

function validateRecipeShape(input, errors) {
  if (!isPlainObject(input)) {
    errors.push("Recipe contract must be an object.");
    return;
  }

  rejectRawExecutionFields(input, errors);
  requireKnownTopLevelFields(input, errors);
  requireFields(input, RECIPE_REQUIRED_FIELDS, errors);
  assertBudget("recipe", input, RECIPE_BUDGETS.recipe_max_bytes, errors);
  assertBudget(
    "recipe discovery summary",
    projectFields(input, RECIPE_DISCOVERY_SUMMARY_FIELDS),
    RECIPE_BUDGETS.discovery_summary_max_bytes,
    errors,
  );

  if (input.contract !== RECIPE_CONTRACT) {
    errors.push("contract must be recipe.contract.v1.");
  }

  validatePack(input.pack, errors);
  validateRecipeId(input.id, input.pack, errors);
  validateBoundedString(input.title, "title", 1, RECIPE_BUDGETS.title_max_chars, errors);
  validateBoundedString(input.summary, "summary", 1, RECIPE_BUDGETS.summary_max_chars, errors);

  if (!LIFECYCLE_SET.has(input.lifecycle)) {
    errors.push(`Invalid lifecycle: ${String(input.lifecycle)}.`);
  }
  if (!RISK_SET.has(input.risk)) {
    errors.push(`Invalid risk: ${String(input.risk)}.`);
  }
  validateEntityKind(input.entity_kind, "entity_kind", errors);
  validateTags(input.tags, errors);
  validateWorkflowCard(input.workflow_card, input, errors);

  const stepIndex = validateSteps(input.steps, errors);
  const recoveryIndex = validateRecovery(input.recovery, stepIndex, errors);
  validateAssertions(input.assertions, recoveryIndex.evidenceIds, errors);
  validateRecipeCrossReferences(input, stepIndex, recoveryIndex, errors);
}

function validateSteps(steps, errors) {
  const stepIds = new Set();
  const templateSteps = new Map();
  const checkpointRefs = new Map();
  const evidenceRefs = new Map();
  const failureRefs = new Map();
  let maxTemplateRisk = "read";

  if (!Array.isArray(steps)) {
    errors.push("steps must be an array.");
    return { stepIds, templateSteps, checkpointRefs, evidenceRefs, failureRefs, maxTemplateRisk };
  }
  if (steps.length === 0) errors.push("steps must contain at least one step.");
  if (steps.length > RECIPE_BUDGETS.steps_max_count) {
    errors.push(`steps may contain at most ${RECIPE_BUDGETS.steps_max_count} steps.`);
  }

  for (const [index, step] of steps.entries()) {
    const field = `steps[${index}]`;
    validateStep(step, field, errors);
    if (!isPlainObject(step)) continue;

    if (typeof step.id === "string") {
      if (stepIds.has(step.id)) errors.push(`Duplicate step id: ${step.id}.`);
      stepIds.add(step.id);
    }
    if (typeof step.checkpoint === "string") checkpointRefs.set(step.id, step.checkpoint);
    if (typeof step.on_failure === "string") failureRefs.set(step.id, step.on_failure);

    if (step.uses === "call_template" && isPlainObject(step.call_template)) {
      const id = step.call_template.id;
      const descriptor = validateTemplateDependencyId(id, `${field}.call_template.id`, errors);
      if (descriptor) {
        templateSteps.set(step.id, descriptor);
        if (riskRank(descriptor.risk) > riskRank(maxTemplateRisk)) maxTemplateRisk = descriptor.risk;
      }
      if (typeof step.evidence === "string") evidenceRefs.set(step.id, step.evidence);
      validateStepInput(step.call_template.input, descriptor, field, errors);
      validateStepIdempotencyAgainstTemplate(step.id, step.idempotency, descriptor, errors);
    }
  }

  if (templateSteps.size === 0) {
    errors.push("recipes must include at least one call_template step.");
  }

  return {
    stepIds,
    templateSteps,
    checkpointRefs,
    evidenceRefs,
    failureRefs,
    maxTemplateRisk,
  };
}

function validateStep(step, field, errors) {
  if (!isPlainObject(step)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(
    step,
    [
      "id",
      "title",
      "summary",
      "uses",
      "call_template",
      "get_state",
      "checkpoint",
      "evidence",
      "idempotency",
      "on_failure",
    ],
    field,
    errors,
  );

  validateIdentifier(step.id, `${field}.id`, errors);
  validateBoundedString(step.title, `${field}.title`, 1, 80, errors);
  validateBoundedString(step.summary, `${field}.summary`, 1, 240, errors);
  if (!STEP_USE_SET.has(step.uses)) errors.push(`${field}.uses must be call_template or get_state.`);
  validateIdentifier(step.checkpoint, `${field}.checkpoint`, errors);
  validateIdentifier(step.on_failure, `${field}.on_failure`, errors);
  validateStepIdempotency(step.idempotency, `${field}.idempotency`, errors);

  if (step.uses === "call_template") {
    if (!isPlainObject(step.call_template)) {
      errors.push(`${field}.call_template must be an object for call_template steps.`);
    } else {
      validateCallTemplateStep(step.call_template, `${field}.call_template`, errors);
    }
    if (step.get_state !== null) errors.push(`${field}.get_state must be null for call_template steps.`);
    validateIdentifier(step.evidence, `${field}.evidence`, errors);
  } else if (step.uses === "get_state") {
    if (step.call_template !== null) errors.push(`${field}.call_template must be null for get_state steps.`);
    if (!isPlainObject(step.get_state)) {
      errors.push(`${field}.get_state must be an object for get_state steps.`);
    } else {
      validateGetStateStep(step.get_state, `${field}.get_state`, errors);
    }
    if (step.evidence !== null) errors.push(`${field}.evidence must be null for get_state steps.`);
    if (isPlainObject(step.idempotency) && step.idempotency.mode !== "read_only") {
      errors.push(`${field}.idempotency.mode must be read_only for get_state steps.`);
    }
  }
}

function validateCallTemplateStep(callTemplate, field, errors) {
  requireExactObjectFields(callTemplate, ["id", "input", "refs"], field, errors);
  validateTemplateDependencyId(callTemplate.id, `${field}.id`, errors);
  if (!isPlainObject(callTemplate.input)) errors.push(`${field}.input must be a JSON object.`);
  if (!isPlainObject(callTemplate.refs)) errors.push(`${field}.refs must be a JSON object.`);
}

function validateGetStateStep(getState, field, errors) {
  requireExactObjectFields(getState, ["projection", "refs"], field, errors);
  validateEntityKind(getState.projection, `${field}.projection`, errors);
  validateStringArray(getState.refs, `${field}.refs`, errors, { allowEmpty: true });
}

function validateStepIdempotency(idempotency, field, errors) {
  if (!isPlainObject(idempotency)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(idempotency, ["mode", "key_scope", "on_resume"], field, errors);
  if (!STEP_IDEMPOTENCY_MODE_SET.has(idempotency.mode)) {
    errors.push(`${field}.mode is invalid: ${String(idempotency.mode)}.`);
  }
  if (!STEP_IDEMPOTENCY_KEY_SCOPE_SET.has(idempotency.key_scope)) {
    errors.push(`${field}.key_scope is invalid: ${String(idempotency.key_scope)}.`);
  }
  if (!STEP_IDEMPOTENCY_RESUME_POLICY_SET.has(idempotency.on_resume)) {
    errors.push(`${field}.on_resume is invalid: ${String(idempotency.on_resume)}.`);
  }
  if (idempotency.mode === "none" && idempotency.key_scope !== "none") {
    errors.push(`${field}.key_scope must be none when idempotency mode is none.`);
  }
}

function validateStepIdempotencyAgainstTemplate(stepId, idempotency, descriptor, errors) {
  if (!isPlainObject(idempotency) || !descriptor) return;
  const descriptorMode = descriptor.bridge.idempotency;
  if (idempotency.mode === "read_only") {
    errors.push(`Step ${stepId} idempotency.mode read_only is reserved for get_state steps.`);
  }
  if (descriptorMode === "none" && idempotency.mode !== "none") {
    errors.push(`Step ${stepId} idempotency must be none for template ${descriptor.id}.`);
  }
  if (descriptorMode === "required" && idempotency.mode !== "required") {
    errors.push(`Step ${stepId} idempotency must be required for template ${descriptor.id}.`);
  }
  if (idempotency.mode === "required" && idempotency.key_scope === "none") {
    errors.push(`Step ${stepId} idempotency.key_scope must not be none when mode is required.`);
  }
}

function validateStepInput(input, descriptor, field, errors) {
  if (!descriptor || !isPlainObject(input)) return;
  try {
    validateTemplateInput(input, descriptor.inputSchema);
  } catch (error) {
    const message = Array.isArray(error.details?.errors)
      ? error.details.errors.join("; ")
      : error.message;
    errors.push(`${field}.call_template.input does not satisfy ${descriptor.id} inputSchema: ${message}`);
  }
}

function validateAssertions(assertions, evidenceIds, errors) {
  if (!Array.isArray(assertions)) {
    errors.push("assertions must be an array.");
    return;
  }
  if (assertions.length === 0) errors.push("assertions must contain at least one assertion.");
  if (assertions.length > RECIPE_BUDGETS.assertions_max_count) {
    errors.push(`assertions may contain at most ${RECIPE_BUDGETS.assertions_max_count} assertions.`);
  }

  const ids = new Set();
  let hasExpectedOutput = false;
  for (const [index, assertion] of assertions.entries()) {
    const field = `assertions[${index}]`;
    validateAssertion(assertion, field, evidenceIds, errors);
    if (!isPlainObject(assertion)) continue;
    if (typeof assertion.id === "string") {
      if (ids.has(assertion.id)) errors.push(`Duplicate assertion id: ${assertion.id}.`);
      ids.add(assertion.id);
    }
    if (assertion.kind === "expected_output") hasExpectedOutput = true;
  }
  if (!hasExpectedOutput) {
    errors.push("assertions must include at least one expected_output assertion.");
  }
}

function validateAssertion(assertion, field, evidenceIds, errors) {
  if (!isPlainObject(assertion)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(assertion, ["id", "kind", "summary", "required", "evidence", "outputs"], field, errors);
  validateIdentifier(assertion.id, `${field}.id`, errors);
  if (!ASSERTION_KIND_SET.has(assertion.kind)) errors.push(`${field}.kind is invalid: ${String(assertion.kind)}.`);
  validateBoundedString(assertion.summary, `${field}.summary`, 1, 240, errors);
  if (typeof assertion.required !== "boolean") errors.push(`${field}.required must be a boolean.`);
  validateStringArray(assertion.evidence, `${field}.evidence`, errors, { allowEmpty: assertion.kind !== "template_evidence" });
  if (Array.isArray(assertion.evidence)) {
    for (const evidenceId of assertion.evidence) {
      if (!evidenceIds.has(evidenceId)) errors.push(`${field}.evidence references unknown evidence requirement: ${evidenceId}.`);
    }
  }
  validateAssertionOutputs(assertion.outputs, `${field}.outputs`, assertion.kind, errors);
}

function validateAssertionOutputs(outputs, field, kind, errors) {
  if (!isPlainObject(outputs)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(outputs, ["refs", "artifacts", "jobs", "state"], field, errors);
  const refs = validateStringArray(outputs.refs, `${field}.refs`, errors, { allowEmpty: true });
  const artifacts = validateStringArray(outputs.artifacts, `${field}.artifacts`, errors, { allowEmpty: true });
  const jobs = validateStringArray(outputs.jobs, `${field}.jobs`, errors, { allowEmpty: true });
  const state = validateStringArray(outputs.state, `${field}.state`, errors, { allowEmpty: true });
  if (kind === "expected_output" && refs + artifacts + jobs + state === 0) {
    errors.push(`${field} must describe at least one expected output.`);
  }
}

function validateRecovery(recovery, stepIndex, errors) {
  const checkpointIds = new Set();
  const checkpointByStep = new Map();
  const evidenceIds = new Set();
  const evidenceByStep = new Map();
  const branchIds = new Set();
  const riskGateIds = new Set();

  if (!isPlainObject(recovery)) {
    errors.push("recovery must be an object.");
    return { checkpointIds, checkpointByStep, evidenceIds, evidenceByStep, branchIds, riskGateIds };
  }
  requireExactObjectFields(
    recovery,
    [
      "run_state",
      "checkpoints",
      "evidence_requirements",
      "idempotency",
      "resume",
      "branches",
      "risk_gates",
    ],
    "recovery",
    errors,
  );

  validateRunState(recovery.run_state, "recovery.run_state", errors);
  validateRecoveryIdempotency(recovery.idempotency, "recovery.idempotency", errors);
  validateResumeRules(recovery.resume, "recovery.resume", errors);

  validateCheckpoints(recovery.checkpoints, stepIndex.stepIds, checkpointIds, checkpointByStep, errors);
  validateEvidenceRequirements(
    recovery.evidence_requirements,
    stepIndex.templateSteps,
    evidenceIds,
    evidenceByStep,
    errors,
  );
  validateBranches(recovery.branches, stepIndex.stepIds, branchIds, errors);
  validateRiskGates(recovery.risk_gates, stepIndex.stepIds, riskGateIds, errors);

  return { checkpointIds, checkpointByStep, evidenceIds, evidenceByStep, branchIds, riskGateIds };
}

function validateRunState(runState, field, errors) {
  if (!isPlainObject(runState)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(runState, ["contract", "initial", "states", "terminal"], field, errors);
  if (runState.contract !== RECIPE_RUN_STATE_CONTRACT) errors.push(`${field}.contract must be recipe.run_state.v1.`);
  if (runState.initial !== "not_started") errors.push(`${field}.initial must be not_started.`);
  validateExactSet(runState.states, RECIPE_RUN_STATES, `${field}.states`, errors, RUN_STATE_SET);
  validateExactSet(runState.terminal, RECIPE_TERMINAL_RUN_STATES, `${field}.terminal`, errors, TERMINAL_RUN_STATE_SET);
}

function validateRecoveryIdempotency(idempotency, field, errors) {
  if (!isPlainObject(idempotency)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(
    idempotency,
    ["scope", "default_step_policy", "on_resume", "on_replay"],
    field,
    errors,
  );
  if (idempotency.scope !== "recipe_run") errors.push(`${field}.scope must be recipe_run.`);
  if (idempotency.default_step_policy !== "follow_step_idempotency") {
    errors.push(`${field}.default_step_policy must be follow_step_idempotency.`);
  }
  if (idempotency.on_resume !== "skip_completed_checkpoints") {
    errors.push(`${field}.on_resume must be skip_completed_checkpoints.`);
  }
  if (idempotency.on_replay !== "reuse_verified_evidence") {
    errors.push(`${field}.on_replay must be reuse_verified_evidence.`);
  }
}

function validateResumeRules(resume, field, errors) {
  if (!isPlainObject(resume)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(
    resume,
    ["from_checkpoint", "on_missing_evidence", "on_failed_evidence", "on_risk_gate"],
    field,
    errors,
  );
  if (resume.from_checkpoint !== "latest_verified") {
    errors.push(`${field}.from_checkpoint must be latest_verified.`);
  }
  if (resume.on_missing_evidence !== "rerun_step") {
    errors.push(`${field}.on_missing_evidence must be rerun_step.`);
  }
  if (resume.on_failed_evidence !== "use_recovery_branch") {
    errors.push(`${field}.on_failed_evidence must be use_recovery_branch.`);
  }
  if (resume.on_risk_gate !== "pause_for_user") {
    errors.push(`${field}.on_risk_gate must be pause_for_user.`);
  }
}

function validateCheckpoints(checkpoints, stepIds, checkpointIds, checkpointByStep, errors) {
  if (!Array.isArray(checkpoints)) {
    errors.push("recovery.checkpoints must be an array.");
    return;
  }
  if (checkpoints.length === 0) errors.push("recovery.checkpoints must contain at least one checkpoint.");
  if (checkpoints.length > RECIPE_BUDGETS.checkpoints_max_count) {
    errors.push(`recovery.checkpoints may contain at most ${RECIPE_BUDGETS.checkpoints_max_count} checkpoints.`);
  }
  for (const [index, checkpoint] of checkpoints.entries()) {
    const field = `recovery.checkpoints[${index}]`;
    if (!isPlainObject(checkpoint)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(checkpoint, ["id", "after_step", "required_evidence", "on_resume", "summary"], field, errors);
    validateIdentifier(checkpoint.id, `${field}.id`, errors);
    validateIdentifier(checkpoint.after_step, `${field}.after_step`, errors);
    validateStringArray(checkpoint.required_evidence, `${field}.required_evidence`, errors, { allowEmpty: true });
    if (!CHECKPOINT_RESUME_POLICY_SET.has(checkpoint.on_resume)) {
      errors.push(`${field}.on_resume is invalid: ${String(checkpoint.on_resume)}.`);
    }
    validateBoundedString(checkpoint.summary, `${field}.summary`, 1, 240, errors);
    if (typeof checkpoint.id === "string") {
      if (checkpointIds.has(checkpoint.id)) errors.push(`Duplicate checkpoint id: ${checkpoint.id}.`);
      checkpointIds.add(checkpoint.id);
    }
    if (typeof checkpoint.after_step === "string") {
      if (!stepIds.has(checkpoint.after_step)) errors.push(`${field}.after_step references unknown step: ${checkpoint.after_step}.`);
      checkpointByStep.set(checkpoint.after_step, checkpoint.id);
    }
  }
}

function validateEvidenceRequirements(evidence, templateSteps, evidenceIds, evidenceByStep, errors) {
  if (!Array.isArray(evidence)) {
    errors.push("recovery.evidence_requirements must be an array.");
    return;
  }
  if (evidence.length === 0) {
    errors.push("recovery.evidence_requirements must contain at least one template runtime evidence requirement.");
  }
  if (evidence.length > RECIPE_BUDGETS.evidence_requirements_max_count) {
    errors.push(
      `recovery.evidence_requirements may contain at most ${RECIPE_BUDGETS.evidence_requirements_max_count} entries.`,
    );
  }
  for (const [index, requirement] of evidence.entries()) {
    const field = `recovery.evidence_requirements[${index}]`;
    if (!isPlainObject(requirement)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(
      requirement,
      ["id", "step", "source", "template_id", "require_ok", "require_request_id", "counts", "timestamps"],
      field,
      errors,
    );
    validateIdentifier(requirement.id, `${field}.id`, errors);
    validateIdentifier(requirement.step, `${field}.step`, errors);
    if (requirement.source !== RECIPE_TEMPLATE_EVIDENCE_CONTRACT) {
      errors.push(`${field}.source must be ${RECIPE_TEMPLATE_EVIDENCE_CONTRACT}.`);
    }
    validateTemplateDependencyId(requirement.template_id, `${field}.template_id`, errors);
    if (typeof requirement.require_ok !== "boolean") errors.push(`${field}.require_ok must be a boolean.`);
    if (typeof requirement.require_request_id !== "boolean") {
      errors.push(`${field}.require_request_id must be a boolean.`);
    }
    validateEvidenceCounts(requirement.counts, `${field}.counts`, errors);
    if (!EVIDENCE_TIMESTAMP_POLICY_SET.has(requirement.timestamps)) {
      errors.push(`${field}.timestamps is invalid: ${String(requirement.timestamps)}.`);
    }
    if (typeof requirement.id === "string") {
      if (evidenceIds.has(requirement.id)) errors.push(`Duplicate evidence requirement id: ${requirement.id}.`);
      evidenceIds.add(requirement.id);
    }
    const descriptor = typeof requirement.step === "string" ? templateSteps.get(requirement.step) : null;
    if (!descriptor) {
      errors.push(`${field}.step must reference a call_template step.`);
    } else if (descriptor.id !== requirement.template_id) {
      errors.push(`${field}.template_id must match the referenced step template id (${descriptor.id}).`);
    }
    if (typeof requirement.step === "string") evidenceByStep.set(requirement.step, requirement.id);
  }
}

function validateEvidenceCounts(counts, field, errors) {
  if (!isPlainObject(counts)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(
    counts,
    ["refs_min", "artifacts_min", "jobs_min", "last_result_refs_min"],
    field,
    errors,
  );
  for (const key of ["refs_min", "artifacts_min", "jobs_min", "last_result_refs_min"]) {
    if (!Number.isInteger(counts[key]) || counts[key] < 0) {
      errors.push(`${field}.${key} must be a non-negative integer.`);
    }
  }
}

function validateBranches(branches, stepIds, branchIds, errors) {
  if (!Array.isArray(branches)) {
    errors.push("recovery.branches must be an array.");
    return;
  }
  if (branches.length === 0) errors.push("recovery.branches must contain at least one branch.");
  if (branches.length > RECIPE_BUDGETS.recovery_branches_max_count) {
    errors.push(`recovery.branches may contain at most ${RECIPE_BUDGETS.recovery_branches_max_count} branches.`);
  }
  for (const [index, branch] of branches.entries()) {
    const field = `recovery.branches[${index}]`;
    if (!isPlainObject(branch)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(branch, ["id", "trigger", "step", "strategy", "summary"], field, errors);
    validateIdentifier(branch.id, `${field}.id`, errors);
    if (!RECOVERY_BRANCH_TRIGGER_SET.has(branch.trigger)) {
      errors.push(`${field}.trigger is invalid: ${String(branch.trigger)}.`);
    }
    validateNullableIdentifier(branch.step, `${field}.step`, errors);
    if (typeof branch.step === "string" && !stepIds.has(branch.step)) {
      errors.push(`${field}.step references unknown step: ${branch.step}.`);
    }
    if (!RECOVERY_STRATEGY_SET.has(branch.strategy)) {
      errors.push(`${field}.strategy is invalid: ${String(branch.strategy)}.`);
    }
    validateBoundedString(branch.summary, `${field}.summary`, 1, 240, errors);
    if (typeof branch.id === "string") {
      if (branchIds.has(branch.id)) errors.push(`Duplicate recovery branch id: ${branch.id}.`);
      branchIds.add(branch.id);
    }
  }
}

function validateRiskGates(gates, stepIds, riskGateIds, errors) {
  if (!Array.isArray(gates)) {
    errors.push("recovery.risk_gates must be an array.");
    return;
  }
  if (gates.length > RECIPE_BUDGETS.risk_gates_max_count) {
    errors.push(`recovery.risk_gates may contain at most ${RECIPE_BUDGETS.risk_gates_max_count} gates.`);
  }
  for (const [index, gate] of gates.entries()) {
    const field = `recovery.risk_gates[${index}]`;
    if (!isPlainObject(gate)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(
      gate,
      ["id", "applies_to", "required_before_step", "policy", "blocks_auto_resume", "summary"],
      field,
      errors,
    );
    validateIdentifier(gate.id, `${field}.id`, errors);
    validateRiskArray(gate.applies_to, `${field}.applies_to`, errors);
    validateNullableIdentifier(gate.required_before_step, `${field}.required_before_step`, errors);
    if (typeof gate.required_before_step === "string" && !stepIds.has(gate.required_before_step)) {
      errors.push(`${field}.required_before_step references unknown step: ${gate.required_before_step}.`);
    }
    if (!RISK_GATE_POLICY_SET.has(gate.policy)) {
      errors.push(`${field}.policy is invalid: ${String(gate.policy)}.`);
    }
    if (typeof gate.blocks_auto_resume !== "boolean") {
      errors.push(`${field}.blocks_auto_resume must be a boolean.`);
    }
    validateBoundedString(gate.summary, `${field}.summary`, 1, 240, errors);
    if (typeof gate.id === "string") {
      if (riskGateIds.has(gate.id)) errors.push(`Duplicate risk gate id: ${gate.id}.`);
      riskGateIds.add(gate.id);
    }
  }
}

function validateRecipeCrossReferences(recipe, stepIndex, recoveryIndex, errors) {
  if (!RISK_SET.has(recipe.risk)) return;

  if (riskRank(recipe.risk) < riskRank(stepIndex.maxTemplateRisk)) {
    errors.push(`recipe risk ${recipe.risk} is lower than highest template dependency risk ${stepIndex.maxTemplateRisk}.`);
  }

  for (const [stepId, checkpointId] of stepIndex.checkpointRefs.entries()) {
    if (!recoveryIndex.checkpointIds.has(checkpointId)) {
      errors.push(`Step ${stepId} references unknown checkpoint: ${checkpointId}.`);
    }
    if (recoveryIndex.checkpointByStep.get(stepId) !== checkpointId) {
      errors.push(`Checkpoint ${checkpointId} must declare after_step ${stepId}.`);
    }
  }
  for (const [stepId, evidenceId] of stepIndex.evidenceRefs.entries()) {
    if (!recoveryIndex.evidenceIds.has(evidenceId)) {
      errors.push(`Step ${stepId} references unknown evidence requirement: ${evidenceId}.`);
    }
    if (recoveryIndex.evidenceByStep.get(stepId) !== evidenceId) {
      errors.push(`Evidence requirement ${evidenceId} must declare step ${stepId}.`);
    }
  }
  for (const [stepId, branchId] of stepIndex.failureRefs.entries()) {
    if (!recoveryIndex.branchIds.has(branchId)) {
      errors.push(`Step ${stepId} references unknown recovery branch: ${branchId}.`);
    }
  }

  const requiredEvidence = new Set();
  if (isPlainObject(recipe.recovery) && Array.isArray(recipe.recovery.checkpoints)) {
    for (const checkpoint of recipe.recovery.checkpoints) {
      if (!isPlainObject(checkpoint) || !Array.isArray(checkpoint.required_evidence)) continue;
      for (const evidenceId of checkpoint.required_evidence) requiredEvidence.add(evidenceId);
    }
  }
  for (const [stepId, evidenceId] of stepIndex.evidenceRefs.entries()) {
    if (!requiredEvidence.has(evidenceId)) {
      errors.push(`Template evidence ${evidenceId} for step ${stepId} must be required by a checkpoint.`);
    }
  }

  if (MUTATING_RISKS.has(recipe.risk)) {
    const gates = isPlainObject(recipe.recovery) && Array.isArray(recipe.recovery.risk_gates)
      ? recipe.recovery.risk_gates
      : [];
    const relevant = gates.filter((gate) =>
      isPlainObject(gate) && Array.isArray(gate.applies_to) && gate.applies_to.includes(recipe.risk),
    );
    if (relevant.length === 0) {
      errors.push(`${recipe.risk} recipes must declare at least one matching recipe-level risk gate.`);
    }
    if (recipe.risk === "destructive") {
      const hasBlockingConfirmation = relevant.some((gate) =>
        gate.policy === "user_confirmation" && gate.blocks_auto_resume === true,
      );
      if (!hasBlockingConfirmation) {
        errors.push("destructive recipes require a blocking user_confirmation risk gate.");
      }
    }
  }
}

function validateTemplateDependencyId(id, field, errors) {
  if (typeof id !== "string" || id.trim() === "") {
    errors.push(`${field} must be a non-empty template id string.`);
    return null;
  }
  if (looksLikeRawExecutionId(id)) {
    errors.push(`${field} rejects raw execution-looking template id: ${boundedString(id)}.`);
    return null;
  }
  const match = id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN);
  if (!match) {
    errors.push(`${field} must use the accepted template.<pack>.<name> catalog id shape.`);
    return null;
  }
  if (WORKFLOW_SHAPED_PACK_ID_SET.has(match[1]) || WORKFLOW_SHAPED_PACK_ID_PATTERN.test(id)) {
    errors.push(`${field} uses workflow-shaped template pack metadata: ${id}.`);
    return null;
  }
  if (HELD_TEMPLATE_ID_SET.has(id)) {
    errors.push(`${field} references held template id: ${id}.`);
    return null;
  }
  if (SEED_ONLY_TEMPLATE_ID_SET.has(id)) {
    errors.push(`${field} references seed-only template id: ${id}.`);
    return null;
  }
  const descriptor = ACCEPTED_TEMPLATE_BY_ID.get(id);
  if (!descriptor) {
    errors.push(`${field} references unknown or non-accepted template id: ${id}.`);
    return null;
  }
  return descriptor;
}

function collectRecipeCatalog(input) {
  const errors = [];
  const recipes = [];

  if (!isPlainObject(input)) {
    return {
      errors: ["Recipe catalog input must be an object."],
      recipes,
    };
  }

  if (Object.hasOwn(input, "templates")) {
    errors.push("Recipe catalog must not include template descriptors.");
  }
  for (const key of Object.keys(input)) {
    if (key !== "recipes") errors.push(`Unknown recipe catalog field: ${key}.`);
  }

  const recipeInputs = input.recipes ?? [];
  if (!Array.isArray(recipeInputs)) {
    errors.push("recipes must be an array.");
    return { errors, recipes };
  }

  const seenIds = new Map();
  for (const [index, candidate] of recipeInputs.entries()) {
    try {
      const recipe = normalizeRecipeContract(candidate);
      if (seenIds.has(recipe.id)) {
        errors.push(`Duplicate recipe id: ${recipe.id} (recipes[${seenIds.get(recipe.id)}] and recipes[${index}]).`);
      } else {
        seenIds.set(recipe.id, index);
      }
      recipes.push(recipe);
    } catch (error) {
      if (error instanceof RecipeContractValidationError) {
        for (const recipeError of error.errors) errors.push(`recipes[${index}]: ${recipeError}`);
      } else {
        throw error;
      }
    }
  }

  return { errors, recipes };
}

function requireKnownTopLevelFields(input, errors) {
  const allowed = new Set(RECIPE_FULL_FIELDS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`Unknown top-level recipe field: ${key}.`);
  }
}

function requireFields(input, fields, errors) {
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) errors.push(`Missing required field: ${field}.`);
  }
}

function requireExactObjectFields(object, fields, objectName, errors) {
  if (!isPlainObject(object)) return;
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(object, field)) errors.push(`Missing required field: ${objectName}.${field}.`);
  }
  for (const field of Object.keys(object)) {
    if (!allowed.has(field)) errors.push(`Unknown field: ${objectName}.${field}.`);
  }
}

function rejectRawExecutionFields(value, errors, path = "recipe") {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) rejectRawExecutionFields(item, errors, `${path}[${index}]`);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (RAW_EXECUTION_FIELD_SET.has(key)) {
      errors.push(`${nestedPath} is a forbidden raw execution or bypass field.`);
    }
    rejectRawExecutionFields(nested, errors, nestedPath);
  }
}

function validatePack(pack, errors) {
  if (!PACK_ID_SET.has(pack)) {
    errors.push(`Invalid pack: ${String(pack)}.`);
  }
  if (WORKFLOW_SHAPED_PACK_ID_SET.has(pack)) {
    errors.push(`Workflow-shaped pack ids are forbidden as recipe pack metadata: ${pack}.`);
  }
}

function validateRecipeId(id, pack, errors) {
  validateBoundedString(id, "id", 1, RECIPE_BUDGETS.id_max_chars, errors);
  if (typeof id !== "string") return;
  const match = id.match(RECIPE_ID_PATTERN);
  if (!match) {
    errors.push("id must match recipe.<pack>.<lower_snake_segments>.");
    return;
  }
  if (WORKFLOW_SHAPED_PACK_ID_SET.has(match[1])) {
    errors.push(`Workflow-shaped recipe id pack segment is forbidden: ${match[1]}.`);
  }
  if (typeof pack === "string" && match[1] !== pack) {
    errors.push(`id pack segment must match pack (${pack}).`);
  }
}

function validateTags(tags, errors) {
  if (!Array.isArray(tags)) {
    errors.push("tags must be an array.");
    return;
  }
  if (tags.length === 0) errors.push("tags must contain at least one tag.");
  if (tags.length > RECIPE_BUDGETS.tag_max_count) {
    errors.push(`tags may contain at most ${RECIPE_BUDGETS.tag_max_count} tags.`);
  }
  const seen = new Set();
  for (const tag of tags) {
    validateBoundedString(tag, "tag", 1, RECIPE_BUDGETS.tag_max_chars, errors);
    if (typeof tag === "string" && !TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(tag)) {
      errors.push(`Invalid tag: ${tag}.`);
    }
    if (seen.has(tag)) errors.push(`Duplicate tag: ${tag}.`);
    seen.add(tag);
  }
}

function validateWorkflowCard(card, recipe, errors) {
  if (card === undefined) return;
  if (!isPlainObject(card)) {
    errors.push("workflow_card must be an object when present.");
    return;
  }
  requireExactObjectFields(card, RECIPE_WORKFLOW_CARD_FIELDS, "workflow_card", errors);

  validateBoundedString(
    card.intent,
    "workflow_card.intent",
    1,
    RECIPE_BUDGETS.workflow_card_text_max_chars,
    errors,
  );
  validateWorkflowCardTextArray(card.entry_conditions, "workflow_card.entry_conditions", errors);
  validateWorkflowCardTextArray(card.supported_steps, "workflow_card.supported_steps", errors);
  validateWorkflowCardTextArray(card.candidate_steps, "workflow_card.candidate_steps", errors, { allowEmpty: true });
  validateWorkflowCardTextArray(card.blocked_steps, "workflow_card.blocked_steps", errors, { allowEmpty: true });
  validateWorkflowCardTextArray(card.required_questions, "workflow_card.required_questions", errors, { allowEmpty: true });
  validateWorkflowCardTextArray(card.evidence_required, "workflow_card.evidence_required", errors);
  validateBoundedString(
    card.cleanup_plan,
    "workflow_card.cleanup_plan",
    1,
    RECIPE_BUDGETS.workflow_card_text_max_chars,
    errors,
  );
  validateStringArray(card.typed_blockers, "workflow_card.typed_blockers", errors, { allowEmpty: true });
  validateWorkflowCardTemplateAtoms(card.template_atoms, recipe, errors);
  validateWorkflowCardTokenBudget(card.token_budget, errors);
}

function validateWorkflowCardTemplateAtoms(templateAtoms, recipe, errors) {
  if (!Array.isArray(templateAtoms)) {
    errors.push("workflow_card.template_atoms must be an array.");
    return;
  }
  if (templateAtoms.length === 0) errors.push("workflow_card.template_atoms must not be empty.");
  if (templateAtoms.length > RECIPE_BUDGETS.workflow_card_list_max_count) {
    errors.push(`workflow_card.template_atoms may contain at most ${RECIPE_BUDGETS.workflow_card_list_max_count} entries.`);
  }

  const declared = new Set(
    Array.isArray(recipe.steps)
      ? recipe.steps
        .filter((step) => isPlainObject(step) && step.uses === "call_template" && isPlainObject(step.call_template))
        .map((step) => step.call_template.id)
      : [],
  );
  const seen = new Set();
  for (const [index, atom] of templateAtoms.entries()) {
    const field = `workflow_card.template_atoms[${index}]`;
    validateTemplateDependencyId(atom, field, errors);
    if (typeof atom !== "string") continue;
    if (seen.has(atom)) errors.push(`workflow_card.template_atoms contains duplicate value: ${atom}.`);
    seen.add(atom);
    if (!declared.has(atom)) {
      errors.push(`${field} must be one of the recipe's declared call_template steps.`);
    }
  }
}

function validateWorkflowCardTokenBudget(tokenBudget, errors) {
  if (!isPlainObject(tokenBudget)) {
    errors.push("workflow_card.token_budget must be an object.");
    return;
  }
  requireExactObjectFields(
    tokenBudget,
    [
      "menu_max_bytes",
      "exact_max_bytes",
      "compact_chat_max_items",
      "same_typed_blocker_stop_after",
    ],
    "workflow_card.token_budget",
    errors,
  );
  for (const key of ["menu_max_bytes", "exact_max_bytes", "compact_chat_max_items"]) {
    if (!Number.isInteger(tokenBudget[key]) || tokenBudget[key] < 1) {
      errors.push(`workflow_card.token_budget.${key} must be a positive integer.`);
    }
  }
  if (tokenBudget.same_typed_blocker_stop_after !== 2) {
    errors.push("workflow_card.token_budget.same_typed_blocker_stop_after must be 2.");
  }
}

function validateWorkflowCardTextArray(values, field, errors, options = {}) {
  if (!Array.isArray(values)) {
    errors.push(`${field} must be an array.`);
    return 0;
  }
  if (!options.allowEmpty && values.length === 0) errors.push(`${field} must not be empty.`);
  if (values.length > RECIPE_BUDGETS.workflow_card_list_max_count) {
    errors.push(`${field} may contain at most ${RECIPE_BUDGETS.workflow_card_list_max_count} entries.`);
  }
  const seen = new Set();
  for (const value of values) {
    validateBoundedString(value, field, 1, RECIPE_BUDGETS.workflow_card_text_max_chars, errors);
    if (seen.has(value)) errors.push(`${field} contains duplicate value: ${value}.`);
    seen.add(value);
  }
  return values.length;
}

function validateEntityKind(value, field, errors) {
  validateBoundedString(value, field, 1, 80, errors);
  if (typeof value === "string" && !TEMPLATE_DESCRIPTOR_ENTITY_KIND_PATTERN.test(value)) {
    errors.push(`${field} must use lower snake-case or dotted lower snake-case.`);
  }
}

function validateIdentifier(value, field, errors) {
  validateBoundedString(value, field, 1, 80, errors);
  if (typeof value === "string" && !TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(value)) {
    errors.push(`${field} must use lower snake-case.`);
  }
}

function validateNullableIdentifier(value, field, errors) {
  if (value === null) return;
  validateIdentifier(value, field, errors);
}

function validateBoundedString(value, field, min, max, errors) {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return;
  }
  if (value.trim().length < min) errors.push(`${field} must not be blank.`);
  if (value.length > max) errors.push(`${field} exceeds ${max} characters.`);
}

function validateStringArray(values, field, errors, options = {}) {
  if (!Array.isArray(values)) {
    errors.push(`${field} must be an array.`);
    return 0;
  }
  if (!options.allowEmpty && values.length === 0) errors.push(`${field} must not be empty.`);
  const seen = new Set();
  for (const value of values) {
    validateIdentifier(value, field, errors);
    if (seen.has(value)) errors.push(`${field} contains duplicate value: ${value}.`);
    seen.add(value);
  }
  return values.length;
}

function validateRiskArray(values, field, errors) {
  if (!Array.isArray(values)) {
    errors.push(`${field} must be an array.`);
    return;
  }
  if (values.length === 0) errors.push(`${field} must not be empty.`);
  for (const value of values) {
    if (!RISK_SET.has(value)) errors.push(`${field} contains invalid risk: ${String(value)}.`);
  }
}

function validateExactSet(values, expected, field, errors, allowed) {
  if (!Array.isArray(values)) {
    errors.push(`${field} must be an array.`);
    return;
  }
  const uniqueValues = new Set(values);
  for (const value of values) {
    if (!allowed.has(value)) errors.push(`${field} contains invalid value: ${String(value)}.`);
  }
  for (const value of expected) {
    if (!uniqueValues.has(value)) errors.push(`${field} is missing value: ${value}.`);
  }
  if (uniqueValues.size !== expected.length) {
    errors.push(`${field} must contain exactly: ${expected.join(", ")}.`);
  }
}

function assertBudget(field, value, maxBytes, errors) {
  if (byteLength(value) > maxBytes) errors.push(`${field} exceeds ${maxBytes} bytes.`);
}

function looksLikeRawExecutionId(id) {
  return typeof id === "string" && RAW_EXECUTION_ID_PATTERNS.some((pattern) => pattern.test(id));
}

function riskRank(risk) {
  return RISK_ORDER.get(risk) ?? 0;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function projectFields(object, fields) {
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(object ?? {}, field)) projected[field] = object[field];
  }
  return projected;
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) {
    throw new RecipeContractValidationError(`${field} must be an array.`);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new RecipeContractValidationError(`${field} must contain non-empty strings.`);
    }
    if (!seen.has(value)) normalized.push(value);
    seen.add(value);
  }
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
}

function boundedString(value, maxLength = 160) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
