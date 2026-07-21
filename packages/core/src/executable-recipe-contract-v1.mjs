import { createHash } from "node:crypto";
import {
  RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS,
  RECIPE_ID_PATTERN,
  RECIPE_RISKS,
  normalizeRecipeContract,
} from "./recipe-contract-v1.mjs";

export const EXECUTABLE_RECIPE_DRAFT_CONTRACT = "recipe.executable.draft.v1";
export const EXECUTABLE_RECIPE_REVISION_CONTRACT = "recipe.executable.revision.v1";
export const EXECUTABLE_RECIPE_VALIDATION_CONTRACT = "recipe.executable.validation.v1";
export const EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT = "recipe.executable.dependency_lock.v1";
export const EXECUTABLE_RECIPE_TRUST_CONTRACT = "recipe.executable.trust.v1";
export const EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT = "recipe.executable.preflight.v1";

export const EXECUTABLE_RECIPE_DEPENDENCY_KINDS = Object.freeze([
  "macro",
  "template",
]);

export const EXECUTABLE_RECIPE_TEMPLATE_FALLBACK_REASONS = Object.freeze([
  "no_registered_macro_covers_task",
  "macro_blocked_missing_capability",
  "macro_risk_exceeds_grant",
  "official_template_atom_required",
  "readback_or_verification_atom",
]);

export const EXECUTABLE_RECIPE_STAGE_KINDS = Object.freeze([
  "macro",
  "template",
  "get_state",
  "checkpoint",
]);

export const EXECUTABLE_RECIPE_TRUST_INVALIDATION_REASONS = Object.freeze([
  "recipe_content_hash_drift",
  "dependency_version_drift",
  "dependency_descriptor_drift",
  "risk_grant_mismatch",
  "project_identity_mismatch",
  "bridge_owner_mismatch",
  "bridge_generation_mismatch",
  "missing_capability",
  "checkpoint_evidence_mismatch",
]);

export const EXECUTABLE_RECIPE_BUDGETS = Object.freeze({
  id_max_chars: 96,
  title_max_chars: 80,
  summary_max_chars: 240,
  version_max_chars: 32,
  revision_max: 1_000_000,
  input_max_count: 32,
  output_max_count: 32,
  stage_max_count: 48,
  binding_max_count: 128,
  dependency_max_count: 48,
  capability_max_count: 32,
  checkpoint_max_count: 48,
  risk_grant_max_count: 16,
  graph_max_bytes: 65_536,
  draft_max_bytes: 65_536,
  revision_payload_max_bytes: 98_304,
  content_hash_hex_chars: 64,
  catalog_macro_max_count: 256,
  catalog_template_max_count: 512,
  catalog_capability_max_count: 512,
  catalog_entry_capability_max_count: 32,
  dependency_id_max_chars: 96,
});

export const EXECUTABLE_RECIPE_FORBIDDEN_FIELDS = Object.freeze([
  ...RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS,
  "call_recipe",
  "execute",
  "executor",
  "graph",
  "handlers",
  "hardware",
  "hardware_device",
  "hardware_io",
  "inline_graph",
  "model_graph",
  "program",
  "run",
  "stages_code",
  "ui",
  "ui_action",
  "device_io",
]);

const DEPENDENCY_KIND_SET = new Set(EXECUTABLE_RECIPE_DEPENDENCY_KINDS);
const FALLBACK_REASON_SET = new Set(EXECUTABLE_RECIPE_TEMPLATE_FALLBACK_REASONS);
const STAGE_KIND_SET = new Set(EXECUTABLE_RECIPE_STAGE_KINDS);
const TRUST_REASON_SET = new Set(EXECUTABLE_RECIPE_TRUST_INVALIDATION_REASONS);
const RISK_SET = new Set(RECIPE_RISKS);
const RISK_ORDER = new Map(RECIPE_RISKS.map((risk, index) => [risk, index]));
const FORBIDDEN_FIELD_SET = new Set(EXECUTABLE_RECIPE_FORBIDDEN_FIELDS);
const MACRO_ID_PATTERN = /^macro\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)*$/;
const TEMPLATE_ID_PATTERN = /^template\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*){1,4}$/;
const VERSION_PATTERN = /^\d+\.\d+\.\d+$/;
const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
const CAPABILITY_PATTERN = /^[a-z][a-z0-9_.]{0,79}$/;
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/;
const RAW_EXECUTION_ID_PATTERNS = Object.freeze([
  /^(?:lua|shell|sh|bash|python|node|osascript|action|raw-action|reaper|bridge|ui|hardware):/i,
  /^(?:run_command|run_action|run_job|query_state|artifact_metadata|call_recipe)$/i,
  /^[0-9]{3,}$/,
  /^_[A-Z0-9_]+$/,
  /(?:^|[._:-])(?:raw_lua|lua|script|run_shell|shell_command|run_action|action_id|main_oncommand|execute_api|bridge_operation|hardware_io|device_io)(?:[._:-]|$)/i,
  /\b(?:reaper\.|Main_OnCommand|NamedCommandLookup|os\.execute|io\.popen)\b/i,
]);

export class ExecutableRecipeContractError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.name = "ExecutableRecipeContractError";
    this.errors = errors;
  }
}

export function createExecutableDependencyCatalog(input = {}) {
  if (!Array.isArray(input.macros)) {
    throw new ExecutableRecipeContractError("dependency catalog macros must be an array.");
  }
  if (!Array.isArray(input.templates)) {
    throw new ExecutableRecipeContractError("dependency catalog templates must be an array.");
  }
  if (input.macros.length > EXECUTABLE_RECIPE_BUDGETS.catalog_macro_max_count) {
    throw new ExecutableRecipeContractError(
      `dependency catalog macros exceed ${EXECUTABLE_RECIPE_BUDGETS.catalog_macro_max_count}.`,
    );
  }
  if (input.templates.length > EXECUTABLE_RECIPE_BUDGETS.catalog_template_max_count) {
    throw new ExecutableRecipeContractError(
      `dependency catalog templates exceed ${EXECUTABLE_RECIPE_BUDGETS.catalog_template_max_count}.`,
    );
  }
  if (!Array.isArray(input.capabilities)) {
    throw new ExecutableRecipeContractError("dependency catalog capabilities must be an explicit array.");
  }
  if (input.capabilities.length > EXECUTABLE_RECIPE_BUDGETS.catalog_capability_max_count) {
    throw new ExecutableRecipeContractError(
      `dependency catalog capabilities exceed ${EXECUTABLE_RECIPE_BUDGETS.catalog_capability_max_count}.`,
    );
  }

  const macros = normalizeCatalogEntries(input.macros, "macro");
  const templates = normalizeCatalogEntries(input.templates, "template");
  const capabilities = uniqueStrings(input.capabilities, "capabilities");
  for (const capability of capabilities) {
    if (!CAPABILITY_PATTERN.test(capability) || looksLikeForbiddenCatalogIdentity(capability)) {
      throw new ExecutableRecipeContractError(`dependency catalog capability is forbidden: ${capability}.`);
    }
  }

  return deepFreeze({
    contract: "recipe.executable.dependency_catalog.v1",
    macros,
    templates,
    capabilities,
    getMacro(id) {
      return macros.find((entry) => entry.id === id) ?? null;
    },
    getTemplate(id) {
      return templates.find((entry) => entry.id === id) ?? null;
    },
    hasCapability(id) {
      return capabilities.includes(id);
    },
  });
}

export function validateExecutableRecipeDraft(input, options = {}) {
  const errors = [];
  const catalog = requireCatalog(options.catalog, errors);
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Executable recipe draft must be an object."] };
  }

  rejectForbiddenFields(input, errors, "draft");
  requireExactObjectFields(
    input,
    [
      "contract",
      "id",
      "title",
      "summary",
      "pack",
      "risk",
      "inputs",
      "outputs",
      "stages",
      "bindings",
      "dependencies",
      "required_capabilities",
      "risk_grants",
      "checkpoints",
      "preflight",
      "portability",
    ],
    "draft",
    errors,
  );

  if (input.contract !== EXECUTABLE_RECIPE_DRAFT_CONTRACT) {
    errors.push(`draft.contract must be ${EXECUTABLE_RECIPE_DRAFT_CONTRACT}.`);
  }
  assertBudget("draft", input, EXECUTABLE_RECIPE_BUDGETS.draft_max_bytes, errors);
  validateRecipeId(input.id, "draft.id", errors);
  validateBoundedString(input.title, "draft.title", 1, EXECUTABLE_RECIPE_BUDGETS.title_max_chars, errors);
  validateBoundedString(input.summary, "draft.summary", 1, EXECUTABLE_RECIPE_BUDGETS.summary_max_chars, errors);
  validateBoundedString(input.pack, "draft.pack", 1, 32, errors);
  if (!RISK_SET.has(input.risk)) errors.push(`draft.risk is invalid: ${String(input.risk)}.`);

  const inputIds = validateDeclaredPorts(input.inputs, "draft.inputs", EXECUTABLE_RECIPE_BUDGETS.input_max_count, errors);
  const outputIds = validateDeclaredPorts(input.outputs, "draft.outputs", EXECUTABLE_RECIPE_BUDGETS.output_max_count, errors);
  const stageIndex = validateStages(input.stages, catalog, errors);
  const dependencyIndex = validateDependencies(input.dependencies, catalog, stageIndex, errors);
  validateBindings(input.bindings, inputIds, outputIds, stageIndex, errors);
  validateCapabilities(input.required_capabilities, catalog, dependencyIndex, errors);
  validateRiskGrants(input.risk_grants, input.risk, stageIndex, dependencyIndex, errors);
  validateCheckpoints(input.checkpoints, stageIndex, errors);
  validatePreflight(input.preflight, stageIndex, dependencyIndex, errors);
  validatePortability(input.portability, errors);
  validateCompleteGraphLimits(input, stageIndex, errors);

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeExecutableRecipeDraft(input, options = {}) {
  const result = validateExecutableRecipeDraft(input, options);
  if (!result.ok) {
    throw new ExecutableRecipeContractError(
      `Executable recipe draft validation failed: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
  return deepFreeze(cloneJson(input));
}

export function canonicalExecutableRecipeContent(input, options = {}) {
  const draft = normalizeExecutableRecipeDraft(input, options);
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_DRAFT_CONTRACT,
    id: draft.id,
    title: draft.title,
    summary: draft.summary,
    pack: draft.pack,
    risk: draft.risk,
    inputs: draft.inputs,
    outputs: draft.outputs,
    stages: draft.stages,
    bindings: draft.bindings,
    dependencies: draft.dependencies,
    required_capabilities: draft.required_capabilities,
    risk_grants: draft.risk_grants,
    checkpoints: draft.checkpoints,
    preflight: draft.preflight,
    portability: draft.portability,
  });
}

export function hashExecutableRecipeContent(input, options = {}) {
  const canonical = canonicalExecutableRecipeContent(input, options);
  return sha256Hex(stableStringify(canonical));
}

export function validateExecutableRecipeRevision(input, options = {}) {
  const errors = [];
  if (!isPlainObject(input)) {
    return { ok: false, errors: ["Executable recipe revision must be an object."] };
  }

  rejectForbiddenFields(input, errors, "revision");
  requireExactObjectFields(
    input,
    [
      "contract",
      "recipe_id",
      "version",
      "revision",
      "content_hash",
      "validation_result_id",
      "dependency_lock",
      "source_payload_identity",
      "immutable",
      "draft",
      "saved_at",
    ],
    "revision",
    errors,
  );

  if (input.contract !== EXECUTABLE_RECIPE_REVISION_CONTRACT) {
    errors.push(`revision.contract must be ${EXECUTABLE_RECIPE_REVISION_CONTRACT}.`);
  }
  assertBudget("revision", input, EXECUTABLE_RECIPE_BUDGETS.revision_payload_max_bytes, errors);
  validateRecipeId(input.recipe_id, "revision.recipe_id", errors);
  if (typeof input.version !== "string" || !VERSION_PATTERN.test(input.version)) {
    errors.push("revision.version must match semver MAJOR.MINOR.PATCH.");
  } else if (input.version.length > EXECUTABLE_RECIPE_BUDGETS.version_max_chars) {
    errors.push(`revision.version exceeds ${EXECUTABLE_RECIPE_BUDGETS.version_max_chars} characters.`);
  }
  if (!Number.isInteger(input.revision) || input.revision < 1 || input.revision > EXECUTABLE_RECIPE_BUDGETS.revision_max) {
    errors.push(`revision.revision must be an integer from 1 to ${EXECUTABLE_RECIPE_BUDGETS.revision_max}.`);
  }
  if (typeof input.content_hash !== "string" || !CONTENT_HASH_PATTERN.test(input.content_hash)) {
    errors.push("revision.content_hash must be a 64-char lowercase hex sha256.");
  }
  validateBoundedString(input.validation_result_id, "revision.validation_result_id", 1, 96, errors);
  if (input.immutable !== true) {
    errors.push("revision.immutable must be true; saved revisions are immutable.");
  }
  if (typeof input.saved_at !== "string" || Number.isNaN(Date.parse(input.saved_at))) {
    errors.push("revision.saved_at must be an ISO-8601 timestamp string.");
  }

  const draftResult = validateExecutableRecipeDraft(input.draft, options);
  if (!draftResult.ok) {
    for (const error of draftResult.errors) errors.push(`revision.draft: ${error}`);
  } else if (isPlainObject(input.draft) && input.recipe_id !== input.draft.id) {
    errors.push("revision.recipe_id must equal revision.draft.id.");
  }

  validateDependencyLock(input.dependency_lock, input.draft, options.catalog, errors);

  let expectedContentHash = null;
  if (draftResult.ok && isPlainObject(input.draft)) {
    expectedContentHash = hashExecutableRecipeContent(input.draft, options);
    if (typeof input.content_hash === "string" && CONTENT_HASH_PATTERN.test(input.content_hash)) {
      if (input.content_hash !== expectedContentHash) {
        errors.push("revision.content_hash does not match canonical draft content hash.");
      }
    }
  }

  validateSourcePayloadIdentity(input.source_payload_identity, input.content_hash, errors);

  if (
    draftResult.ok
    && typeof input.content_hash === "string"
    && CONTENT_HASH_PATTERN.test(input.content_hash)
    && isPlainObject(input.dependency_lock)
    && Number.isInteger(input.revision)
    && typeof input.version === "string"
    && VERSION_PATTERN.test(input.version)
  ) {
    const expectedValidationId = buildValidationResultId({
      recipeId: input.recipe_id,
      version: input.version,
      revision: input.revision,
      contentHash: input.content_hash,
      dependencyLock: input.dependency_lock,
    });
    if (input.validation_result_id !== expectedValidationId) {
      errors.push("revision.validation_result_id must be deterministic for recipe id, version, revision, content hash, and dependency lock identity.");
    }
  }

  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeExecutableRecipeRevision(input, options = {}) {
  const result = validateExecutableRecipeRevision(input, options);
  if (!result.ok) {
    throw new ExecutableRecipeContractError(
      `Executable recipe revision validation failed: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
  return deepFreeze(cloneJson(input));
}

export function sealExecutableRecipeRevision(draftInput, options = {}) {
  const draft = normalizeExecutableRecipeDraft(draftInput, options);
  const version = options.version ?? "1.0.0";
  const revision = options.revision ?? 1;
  if (typeof version !== "string" || !VERSION_PATTERN.test(version)) {
    throw new ExecutableRecipeContractError("seal version must match semver MAJOR.MINOR.PATCH.");
  }
  if (version.length > EXECUTABLE_RECIPE_BUDGETS.version_max_chars) {
    throw new ExecutableRecipeContractError(
      `seal version exceeds ${EXECUTABLE_RECIPE_BUDGETS.version_max_chars} characters.`,
    );
  }
  if (!Number.isInteger(revision) || revision < 1 || revision > EXECUTABLE_RECIPE_BUDGETS.revision_max) {
    throw new ExecutableRecipeContractError(
      `seal revision must be an integer from 1 to ${EXECUTABLE_RECIPE_BUDGETS.revision_max}.`,
    );
  }

  const contentHash = hashExecutableRecipeContent(draft, options);
  const dependencyLock = buildDependencyLock(draft, options.catalog);
  const sourcePayloadIdentity = {
    scheme: "sha256",
    value: contentHash,
    encoding: "hex",
    payload_kind: "executable_recipe_draft",
  };
  const validationResultId = buildValidationResultId({
    recipeId: draft.id,
    version,
    revision,
    contentHash,
    dependencyLock,
  });
  const sealed = {
    contract: EXECUTABLE_RECIPE_REVISION_CONTRACT,
    recipe_id: draft.id,
    version,
    revision,
    content_hash: contentHash,
    validation_result_id: validationResultId,
    dependency_lock: dependencyLock,
    source_payload_identity: sourcePayloadIdentity,
    immutable: true,
    draft,
    saved_at: options.saved_at ?? new Date(0).toISOString(),
  };
  return normalizeExecutableRecipeRevision(sealed, options);
}

export function evaluateExecutableRecipeTrust(revisionInput, facts = {}, options = {}) {
  const revision = normalizeExecutableRecipeRevision(revisionInput, options);
  const reasons = [];
  const observed = isPlainObject(facts) ? facts : {};
  const lockedEntries = Array.isArray(revision.dependency_lock?.entries)
    ? revision.dependency_lock.entries
    : [];

  if (typeof observed.content_hash !== "string" || observed.content_hash !== revision.content_hash) {
    reasons.push("recipe_content_hash_drift");
  }

  if (!Array.isArray(observed.dependency_versions) || !coversExactDependencyFacts(observed.dependency_versions, lockedEntries, "version")) {
    reasons.push("dependency_version_drift");
  }

  if (!Array.isArray(observed.dependency_descriptors) || !coversExactDependencyFacts(observed.dependency_descriptors, lockedEntries, "descriptor_hash")) {
    reasons.push("dependency_descriptor_drift");
  }

  if (!Array.isArray(observed.risk_grants) || !sameStringSet(observed.risk_grants, revision.draft.risk_grants)) {
    reasons.push("risk_grant_mismatch");
  }

  if (typeof observed.project_identity !== "string" || observed.project_identity !== revision.draft.portability.project_identity) {
    reasons.push("project_identity_mismatch");
  }

  if (typeof observed.bridge_owner !== "string" || observed.bridge_owner !== revision.draft.portability.bridge_owner) {
    reasons.push("bridge_owner_mismatch");
  }

  if (typeof observed.bridge_generation !== "string" || observed.bridge_generation !== revision.draft.portability.bridge_generation) {
    reasons.push("bridge_generation_mismatch");
  }

  if (!Array.isArray(observed.available_capabilities) || !isSuperset(observed.available_capabilities, revision.draft.required_capabilities)) {
    reasons.push("missing_capability");
  }

  if (!matchesCheckpointTrustFacts(observed.checkpoint_evidence, revision)) {
    reasons.push("checkpoint_evidence_mismatch");
  }

  const uniqueReasons = unique(reasons).filter((reason) => TRUST_REASON_SET.has(reason));
  return deepFreeze({
    contract: EXECUTABLE_RECIPE_TRUST_CONTRACT,
    trusted: uniqueReasons.length === 0,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
    invalidation_reasons: uniqueReasons,
  });
}

export function executableRevisionDiscoveryProjection(revisionInput, options = {}) {
  const revision = normalizeExecutableRecipeRevision(revisionInput, options);
  return deepFreeze({
    id: revision.recipe_id,
    title: revision.draft.title,
    summary: revision.draft.summary,
    pack: revision.draft.pack,
    lifecycle: "validated",
    risk: revision.draft.risk,
    entity_kind: "recipe",
    tags: ["executable", "revision"],
    workflow_card: null,
  });
}

export function preserveAgentSteppedRecipeContract(input) {
  return normalizeRecipeContract(input);
}

function validateStages(stages, catalog, errors) {
  const stageIds = new Set();
  const stageOutputs = new Map();
  const stageInputs = new Map();
  const stageCheckpoints = new Map();
  const dependencyRefs = [];

  if (!Array.isArray(stages)) {
    errors.push("draft.stages must be an array.");
    return { stageIds, stageOutputs, stageInputs, stageCheckpoints, dependencyRefs, maxRisk: "read" };
  }
  if (stages.length === 0) errors.push("draft.stages must contain at least one stage.");
  if (stages.length > EXECUTABLE_RECIPE_BUDGETS.stage_max_count) {
    errors.push(`draft.stages may contain at most ${EXECUTABLE_RECIPE_BUDGETS.stage_max_count} stages.`);
  }

  let maxRisk = "read";
  let hasExecutableStage = false;
  for (const [index, stage] of stages.entries()) {
    const field = `draft.stages[${index}]`;
    if (!isPlainObject(stage)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(
      stage,
      ["id", "kind", "dependency", "inputs", "outputs", "risk", "checkpoint"],
      field,
      errors,
    );
    validateIdentifier(stage.id, `${field}.id`, errors);
    if (typeof stage.id === "string") {
      if (stageIds.has(stage.id)) errors.push(`Duplicate stage id: ${stage.id}.`);
      stageIds.add(stage.id);
    }
    if (!STAGE_KIND_SET.has(stage.kind)) {
      errors.push(`${field}.kind is invalid: ${String(stage.kind)}.`);
    }
    if (!RISK_SET.has(stage.risk)) errors.push(`${field}.risk is invalid: ${String(stage.risk)}.`);
    else if (riskRank(stage.risk) > riskRank(maxRisk)) maxRisk = stage.risk;

    validateStringArray(stage.outputs, `${field}.outputs`, errors, { allowEmpty: true });
    validateStringArray(stage.inputs, `${field}.inputs`, errors, { allowEmpty: true });
    validateIdentifier(stage.checkpoint, `${field}.checkpoint`, errors);
    if (typeof stage.id === "string") {
      stageOutputs.set(stage.id, new Set(Array.isArray(stage.outputs) ? stage.outputs : []));
      stageInputs.set(stage.id, new Set(Array.isArray(stage.inputs) ? stage.inputs : []));
      if (typeof stage.checkpoint === "string") stageCheckpoints.set(stage.id, stage.checkpoint);
    }

    if (stage.kind === "macro" || stage.kind === "template") {
      hasExecutableStage = true;
      if (!isPlainObject(stage.dependency)) {
        errors.push(`${field}.dependency must be an object for ${stage.kind} stages.`);
      } else {
        const catalogEntry = validateStageDependency(stage.dependency, stage.kind, catalog, `${field}.dependency`, errors);
        if (catalogEntry && RISK_SET.has(stage.risk) && stage.risk !== catalogEntry.risk) {
          errors.push(`${field}.risk must equal dependency catalog risk ${catalogEntry.risk}.`);
        }
        dependencyRefs.push({
          stage_id: stage.id,
          kind: stage.dependency.kind,
          id: stage.dependency.id,
          version: stage.dependency.version,
          fallback_reason: stage.dependency.fallback_reason,
          risk: catalogEntry?.risk ?? null,
          capabilities: Array.isArray(catalogEntry?.capabilities) ? catalogEntry.capabilities : [],
        });
      }
    } else if (stage.kind === "get_state" || stage.kind === "checkpoint") {
      if (stage.dependency !== null) {
        errors.push(`${field}.dependency must be null for ${stage.kind} stages.`);
      }
      if (RISK_SET.has(stage.risk) && stage.risk !== "read") {
        errors.push(`${field}.risk must be read for ${stage.kind} stages.`);
      }
    } else if (stage.dependency !== null) {
      errors.push(`${field}.dependency must be null for ${stage.kind} stages.`);
    }
  }

  if (!hasExecutableStage) {
    errors.push("draft.stages must include at least one macro or template stage.");
  }

  return { stageIds, stageOutputs, stageInputs, stageCheckpoints, dependencyRefs, maxRisk };
}

function validateStageDependency(dependency, stageKind, catalog, field, errors) {
  requireExactObjectFields(dependency, ["kind", "id", "version", "fallback_reason"], field, errors);
  if (!DEPENDENCY_KIND_SET.has(dependency.kind)) {
    errors.push(`${field}.kind is invalid: ${String(dependency.kind)}.`);
    return null;
  }
  if (dependency.kind !== stageKind) {
    errors.push(`${field}.kind must match stage kind ${stageKind}.`);
  }
  if (typeof dependency.version !== "string" || !VERSION_PATTERN.test(dependency.version)) {
    errors.push(`${field}.version must match semver MAJOR.MINOR.PATCH.`);
  }

  if (dependency.kind === "macro") {
    if (typeof dependency.id !== "string" || !MACRO_ID_PATTERN.test(dependency.id) || looksLikeRawExecutionId(dependency.id)) {
      errors.push(`${field}.id must be a registered macro id.`);
      return null;
    }
    if (!catalog?.getMacro(dependency.id)) {
      errors.push(`${field}.id references unknown macro: ${dependency.id}.`);
      return null;
    }
    const entry = catalog.getMacro(dependency.id);
    if (entry.version !== dependency.version) {
      errors.push(`${field}.version must match catalog version ${entry.version}.`);
    }
    if (dependency.fallback_reason !== null) {
      errors.push(`${field}.fallback_reason must be null for macro dependencies.`);
    }
    return entry;
  }

  if (typeof dependency.id !== "string" || !TEMPLATE_ID_PATTERN.test(dependency.id) || looksLikeRawExecutionId(dependency.id)) {
    errors.push(`${field}.id must be an accepted template id.`);
    return null;
  }
  if (!catalog?.getTemplate(dependency.id)) {
    errors.push(`${field}.id references unknown template: ${dependency.id}.`);
    return null;
  }
  const entry = catalog.getTemplate(dependency.id);
  if (entry.version !== dependency.version) {
    errors.push(`${field}.version must match catalog version ${entry.version}.`);
  }
  if (typeof dependency.fallback_reason !== "string" || !FALLBACK_REASON_SET.has(dependency.fallback_reason)) {
    errors.push(`${field}.fallback_reason is required for template long-tail fallback.`);
  }
  return entry;
}

function validateDependencies(dependencies, catalog, stageIndex, errors) {
  if (!Array.isArray(dependencies)) {
    errors.push("draft.dependencies must be an array.");
    return { entries: [], maxRisk: "read" };
  }
  if (dependencies.length === 0) errors.push("draft.dependencies must not be empty.");
  if (dependencies.length > EXECUTABLE_RECIPE_BUDGETS.dependency_max_count) {
    errors.push(`draft.dependencies may contain at most ${EXECUTABLE_RECIPE_BUDGETS.dependency_max_count} entries.`);
  }

  const entries = [];
  const byKey = new Map();
  let maxRisk = "read";
  for (const [index, dependency] of dependencies.entries()) {
    const field = `draft.dependencies[${index}]`;
    if (!isPlainObject(dependency)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(
      dependency,
      ["kind", "id", "version", "risk", "fallback_reason", "descriptor_hash"],
      field,
      errors,
    );
    if (!DEPENDENCY_KIND_SET.has(dependency.kind)) {
      errors.push(`${field}.kind is invalid: ${String(dependency.kind)}.`);
      continue;
    }
    if (!RISK_SET.has(dependency.risk)) errors.push(`${field}.risk is invalid: ${String(dependency.risk)}.`);
    else if (riskRank(dependency.risk) > riskRank(maxRisk)) maxRisk = dependency.risk;
    if (typeof dependency.version !== "string" || !VERSION_PATTERN.test(dependency.version)) {
      errors.push(`${field}.version must match semver MAJOR.MINOR.PATCH.`);
    }
    if (typeof dependency.descriptor_hash !== "string" || !CONTENT_HASH_PATTERN.test(dependency.descriptor_hash)) {
      errors.push(`${field}.descriptor_hash must be a 64-char lowercase hex sha256.`);
    }

    const key = `${dependency.kind}:${dependency.id}`;
    if (byKey.has(key)) errors.push(`Duplicate dependency: ${key}.`);
    byKey.set(key, dependency);

    if (dependency.kind === "macro") {
      if (typeof dependency.id !== "string" || !MACRO_ID_PATTERN.test(dependency.id) || looksLikeRawExecutionId(dependency.id)) {
        errors.push(`${field}.id must be a registered macro id.`);
      } else if (!catalog?.getMacro(dependency.id)) {
        errors.push(`${field}.id references unknown macro: ${dependency.id}.`);
      } else {
        assertCatalogDependencyMatch(catalog.getMacro(dependency.id), dependency, field, errors);
      }
      if (dependency.fallback_reason !== null) {
        errors.push(`${field}.fallback_reason must be null for macro dependencies.`);
      }
    } else {
      if (typeof dependency.id !== "string" || !TEMPLATE_ID_PATTERN.test(dependency.id)
        || looksLikeRawExecutionId(dependency.id) || isCatalogOnlyHardwareMutationIdentity(dependency.id)) {
        errors.push(`${field}.id must be an accepted template id.`);
      } else if (!catalog?.getTemplate(dependency.id)) {
        errors.push(`${field}.id references unknown template: ${dependency.id}.`);
      } else {
        assertCatalogDependencyMatch(catalog.getTemplate(dependency.id), dependency, field, errors);
      }
      if (typeof dependency.fallback_reason !== "string" || !FALLBACK_REASON_SET.has(dependency.fallback_reason)) {
        errors.push(`${field}.fallback_reason is required for template long-tail fallback.`);
      }
    }
    entries.push(dependency);
  }

  for (const ref of stageIndex.dependencyRefs) {
    const key = `${ref.kind}:${ref.id}`;
    const declared = byKey.get(key);
    if (!declared) {
      errors.push(`Stage ${ref.stage_id} dependency ${key} is missing from draft.dependencies.`);
      continue;
    }
    if (
      declared.kind !== ref.kind
      || declared.id !== ref.id
      || declared.version !== ref.version
      || declared.fallback_reason !== ref.fallback_reason
    ) {
      errors.push(
        `Stage ${ref.stage_id} dependency must exactly match draft.dependencies entry for kind, id, version, and fallback_reason.`,
      );
    }
    if (typeof ref.stage_id === "string" && RISK_SET.has(declared.risk)) {
      // stage risk equality is enforced in validateStages against catalog; also require draft dependency risk match catalog.
      if (ref.risk !== null && declared.risk !== ref.risk) {
        errors.push(`Stage ${ref.stage_id} dependency risk must equal catalog risk ${ref.risk}.`);
      }
    }
  }
  for (const entry of entries) {
    const used = stageIndex.dependencyRefs.some((ref) => ref.kind === entry.kind && ref.id === entry.id);
    if (!used) errors.push(`draft.dependencies entry ${entry.kind}:${entry.id} is unused by stages.`);
  }

  return { entries, maxRisk };
}

function assertCatalogDependencyMatch(catalogEntry, dependency, field, errors) {
  if (!catalogEntry) return;
  if (catalogEntry.version !== dependency.version) {
    errors.push(`${field}.version must exactly match catalog version ${catalogEntry.version}.`);
  }
  if (catalogEntry.risk !== dependency.risk) {
    errors.push(`${field}.risk must exactly match catalog risk ${catalogEntry.risk}.`);
  }
  if (catalogEntry.descriptor_hash !== dependency.descriptor_hash) {
    errors.push(`${field}.descriptor_hash must exactly match catalog descriptor_hash.`);
  }
}

function validateBindings(bindings, inputIds, outputIds, stageIndex, errors) {
  if (!Array.isArray(bindings)) {
    errors.push("draft.bindings must be an array.");
    return;
  }
  if (bindings.length > EXECUTABLE_RECIPE_BUDGETS.binding_max_count) {
    errors.push(`draft.bindings may contain at most ${EXECUTABLE_RECIPE_BUDGETS.binding_max_count} bindings.`);
  }

  const graph = new Map();
  const targetKeys = new Set();
  const fullBindingKeys = new Set();
  const producedOutputs = new Set();
  const boundStageInputs = new Set();

  for (const [index, binding] of bindings.entries()) {
    const field = `draft.bindings[${index}]`;
    if (!isPlainObject(binding)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(binding, ["from", "to"], field, errors);
    validateBindingEndpoint(binding.from, `${field}.from`, inputIds, outputIds, stageIndex, errors, {
      role: "source",
    });
    validateBindingEndpoint(binding.to, `${field}.to`, inputIds, outputIds, stageIndex, errors, {
      role: "target",
    });

    if (isPlainObject(binding.from) && isPlainObject(binding.to)) {
      const fullKey = `${endpointPortKey(binding.from) ?? "from"}->${endpointPortKey(binding.to) ?? "to"}`;
      if (fullBindingKeys.has(fullKey)) {
        errors.push(`${field} is a duplicate full binding.`);
      }
      fullBindingKeys.add(fullKey);
    }

    if (isPlainObject(binding.to)) {
      const targetKey = endpointPortKey(binding.to);
      if (targetKey) {
        if (targetKeys.has(targetKey)) {
          errors.push(`${field}.to is a duplicate input target: ${targetKey}.`);
        }
        targetKeys.add(targetKey);
      }
      if (binding.to.scope === "stage" && typeof binding.to.id === "string" && typeof binding.to.port === "string") {
        boundStageInputs.add(`${binding.to.id}:${binding.to.port}`);
      }
      if (binding.to.scope === "recipe_output" && typeof binding.to.port === "string") {
        producedOutputs.add(binding.to.port);
      }
    }

    if (isPlainObject(binding.from) && isPlainObject(binding.to)) {
      const fromNode = endpointNode(binding.from);
      const toNode = endpointNode(binding.to);
      if (fromNode && toNode) {
        if (!graph.has(fromNode)) graph.set(fromNode, new Set());
        graph.get(fromNode).add(toNode);
      }
    }
  }

  for (const [stageId, inputs] of stageIndex.stageInputs.entries()) {
    for (const port of inputs) {
      const key = `${stageId}:${port}`;
      if (!boundStageInputs.has(key)) {
        errors.push(`stage input ${stageId}.${port} must have exactly one incoming binding.`);
      }
    }
  }

  for (const outputId of outputIds) {
    if (!producedOutputs.has(outputId)) {
      errors.push(`recipe output ${outputId} is not produced by any binding.`);
    }
  }

  if (hasCycle(graph)) {
    errors.push("draft.bindings contain a cycle.");
  }
}

function validateBindingEndpoint(endpoint, field, inputIds, outputIds, stageIndex, errors, options = {}) {
  if (!isPlainObject(endpoint)) {
    errors.push(`${field} must be an object.`);
    return;
  }
  requireExactObjectFields(endpoint, ["scope", "id", "port"], field, errors);
  if (!["recipe_input", "recipe_output", "stage"].includes(endpoint.scope)) {
    errors.push(`${field}.scope is invalid: ${String(endpoint.scope)}.`);
    return;
  }
  validateIdentifier(endpoint.port, `${field}.port`, errors);

  if (endpoint.scope === "recipe_input") {
    if (options.role === "target") errors.push(`${field} cannot target recipe_input.`);
    if (endpoint.id !== null) errors.push(`${field}.id must be null for recipe_input.`);
    if (!inputIds.has(endpoint.port)) errors.push(`${field}.port references unknown recipe input: ${endpoint.port}.`);
    return;
  }
  if (endpoint.scope === "recipe_output") {
    if (options.role === "source") errors.push(`${field} cannot source recipe_output.`);
    if (endpoint.id !== null) errors.push(`${field}.id must be null for recipe_output.`);
    if (!outputIds.has(endpoint.port)) errors.push(`${field}.port references unknown recipe output: ${endpoint.port}.`);
    return;
  }

  validateIdentifier(endpoint.id, `${field}.id`, errors);
  if (typeof endpoint.id !== "string" || !stageIndex.stageIds.has(endpoint.id)) {
    if (typeof endpoint.id === "string") {
      errors.push(`${field}.id references unknown stage: ${endpoint.id}.`);
    }
    return;
  }

  if (options.role === "source") {
    const outputs = stageIndex.stageOutputs.get(endpoint.id) ?? new Set();
    if (!outputs.has(endpoint.port)) {
      errors.push(`${field}.port must be a declared output of stage ${endpoint.id}.`);
    }
  } else if (options.role === "target") {
    const inputs = stageIndex.stageInputs.get(endpoint.id) ?? new Set();
    if (!inputs.has(endpoint.port)) {
      errors.push(`${field}.port must be a declared input of stage ${endpoint.id}.`);
    }
  }
}

function validateDeclaredPorts(ports, field, maxCount, errors) {
  const ids = new Set();
  if (!Array.isArray(ports)) {
    errors.push(`${field} must be an array.`);
    return ids;
  }
  if (ports.length > maxCount) errors.push(`${field} may contain at most ${maxCount} entries.`);
  for (const [index, port] of ports.entries()) {
    const portField = `${field}[${index}]`;
    if (!isPlainObject(port)) {
      errors.push(`${portField} must be an object.`);
      continue;
    }
    requireExactObjectFields(port, ["id", "type", "required"], portField, errors);
    validateIdentifier(port.id, `${portField}.id`, errors);
    validateBoundedString(port.type, `${portField}.type`, 1, 64, errors);
    if (typeof port.required !== "boolean") errors.push(`${portField}.required must be a boolean.`);
    if (typeof port.id === "string") {
      if (ids.has(port.id)) errors.push(`Duplicate port id in ${field}: ${port.id}.`);
      ids.add(port.id);
    }
  }
  return ids;
}

function validateCapabilities(capabilities, catalog, dependencyIndex, errors) {
  if (!Array.isArray(capabilities)) {
    errors.push("draft.required_capabilities must be an array.");
    return;
  }
  if (capabilities.length > EXECUTABLE_RECIPE_BUDGETS.capability_max_count) {
    errors.push(`draft.required_capabilities may contain at most ${EXECUTABLE_RECIPE_BUDGETS.capability_max_count} entries.`);
  }
  const seen = new Set();
  for (const capability of capabilities) {
    if (typeof capability !== "string" || !CAPABILITY_PATTERN.test(capability) || looksLikeForbiddenIdentity(capability)) {
      errors.push(`Invalid required capability: ${String(capability)}.`);
      continue;
    }
    if (seen.has(capability)) errors.push(`Duplicate required capability: ${capability}.`);
    seen.add(capability);
    if (catalog && !catalog.hasCapability(capability)) {
      errors.push(`required capability is not present in injected catalog: ${capability}.`);
    }
  }

  const requiredByDependencies = new Set();
  if (catalog && Array.isArray(dependencyIndex?.entries)) {
    for (const entry of dependencyIndex.entries) {
      if (!isPlainObject(entry)) continue;
      const catalogEntry = entry.kind === "macro"
        ? catalog.getMacro(entry.id)
        : catalog.getTemplate(entry.id);
      if (!catalogEntry || !Array.isArray(catalogEntry.capabilities)) continue;
      for (const capability of catalogEntry.capabilities) requiredByDependencies.add(capability);
    }
  }
  for (const capability of requiredByDependencies) {
    if (!seen.has(capability)) {
      errors.push(`draft.required_capabilities must include dependency capability ${capability}.`);
    }
  }
}

function validateRiskGrants(grants, recipeRisk, stageIndex, dependencyIndex, errors) {
  if (!Array.isArray(grants)) {
    errors.push("draft.risk_grants must be an array.");
    return;
  }
  if (grants.length === 0) errors.push("draft.risk_grants must not be empty.");
  if (grants.length > EXECUTABLE_RECIPE_BUDGETS.risk_grant_max_count) {
    errors.push(`draft.risk_grants may contain at most ${EXECUTABLE_RECIPE_BUDGETS.risk_grant_max_count} entries.`);
  }
  const seen = new Set();
  for (const grant of grants) {
    if (!RISK_SET.has(grant)) errors.push(`Invalid risk grant: ${String(grant)}.`);
    if (seen.has(grant)) errors.push(`Duplicate risk grant: ${grant}.`);
    seen.add(grant);
  }
  if (RISK_SET.has(recipeRisk) && !seen.has(recipeRisk)) {
    errors.push(`draft.risk_grants must include recipe risk ${recipeRisk}.`);
  }
  const maxStageRisk = stageIndex?.maxRisk ?? "read";
  const maxDependencyRisk = dependencyIndex?.maxRisk ?? "read";
  const maxGraphRisk = riskRank(maxStageRisk) >= riskRank(maxDependencyRisk) ? maxStageRisk : maxDependencyRisk;
  if (riskRank(recipeRisk) < riskRank(maxGraphRisk)) {
    errors.push(`draft.risk ${recipeRisk} is lower than highest stage/dependency risk ${maxGraphRisk}.`);
  }
  if (RISK_SET.has(maxGraphRisk) && !seen.has(maxGraphRisk)) {
    errors.push(`draft.risk_grants must include highest stage/dependency risk ${maxGraphRisk}.`);
  }
}

function validateCheckpoints(checkpoints, stageIndex, errors) {
  if (!Array.isArray(checkpoints)) {
    errors.push("draft.checkpoints must be an array.");
    return;
  }
  if (checkpoints.length === 0) errors.push("draft.checkpoints must not be empty.");
  if (checkpoints.length > EXECUTABLE_RECIPE_BUDGETS.checkpoint_max_count) {
    errors.push(`draft.checkpoints may contain at most ${EXECUTABLE_RECIPE_BUDGETS.checkpoint_max_count} checkpoints.`);
  }
  if (checkpoints.length !== stageIndex.stageIds.size && stageIndex.stageIds.size > 0) {
    errors.push("draft.checkpoints must be one-to-one with draft.stages.");
  }

  const ids = new Set();
  const evidenceIds = new Set();
  const resumeIdentities = new Set();
  const byStage = new Map();
  for (const [index, checkpoint] of checkpoints.entries()) {
    const field = `draft.checkpoints[${index}]`;
    if (!isPlainObject(checkpoint)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(
      checkpoint,
      ["id", "after_stage", "evidence_id", "resume_identity", "summary"],
      field,
      errors,
    );
    validateIdentifier(checkpoint.id, `${field}.id`, errors);
    validateIdentifier(checkpoint.after_stage, `${field}.after_stage`, errors);
    validateIdentifier(checkpoint.evidence_id, `${field}.evidence_id`, errors);
    validateBoundedString(checkpoint.resume_identity, `${field}.resume_identity`, 1, 96, errors);
    validateBoundedString(checkpoint.summary, `${field}.summary`, 1, 240, errors);
    if (typeof checkpoint.id === "string") {
      if (ids.has(checkpoint.id)) errors.push(`Duplicate checkpoint id: ${checkpoint.id}.`);
      ids.add(checkpoint.id);
    }
    if (typeof checkpoint.evidence_id === "string") {
      if (evidenceIds.has(checkpoint.evidence_id)) {
        errors.push(`Duplicate checkpoint evidence_id: ${checkpoint.evidence_id}.`);
      }
      evidenceIds.add(checkpoint.evidence_id);
    }
    if (typeof checkpoint.resume_identity === "string") {
      if (resumeIdentities.has(checkpoint.resume_identity)) {
        errors.push(`Duplicate checkpoint resume_identity: ${checkpoint.resume_identity}.`);
      }
      resumeIdentities.add(checkpoint.resume_identity);
    }
    if (typeof checkpoint.after_stage === "string") {
      if (!stageIndex.stageIds.has(checkpoint.after_stage)) {
        errors.push(`${field}.after_stage references unknown stage: ${checkpoint.after_stage}.`);
      }
      if (byStage.has(checkpoint.after_stage)) {
        errors.push(`Duplicate checkpoint for stage ${checkpoint.after_stage}.`);
      } else {
        byStage.set(checkpoint.after_stage, checkpoint.id);
      }
      const stageCheckpoint = stageIndex.stageCheckpoints?.get(checkpoint.after_stage);
      if (stageCheckpoint !== undefined && stageCheckpoint !== checkpoint.id) {
        errors.push(
          `Stage ${checkpoint.after_stage}.checkpoint must equal checkpoint id ${checkpoint.id}.`,
        );
      }
    }
  }

  for (const stageId of stageIndex.stageIds) {
    if (!byStage.has(stageId)) {
      errors.push(`Stage ${stageId} must have exactly one checkpoint.`);
      continue;
    }
    const stageCheckpoint = stageIndex.stageCheckpoints?.get(stageId);
    const checkpointId = byStage.get(stageId);
    if (stageCheckpoint !== checkpointId) {
      errors.push(`Stage ${stageId}.checkpoint must equal checkpoint id ${checkpointId}.`);
    }
  }
}

function validatePreflight(preflight, stageIndex, dependencyIndex, errors) {
  if (!isPlainObject(preflight)) {
    errors.push("draft.preflight must be an object.");
    return;
  }
  requireExactObjectFields(
    preflight,
    [
      "contract",
      "complete_graph",
      "stage_count",
      "dependency_count",
      "requires_validation_before_save",
      "requires_save_before_run",
      "forbids_inline_execution",
    ],
    "draft.preflight",
    errors,
  );
  if (preflight.contract !== EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT) {
    errors.push(`draft.preflight.contract must be ${EXECUTABLE_RECIPE_PREFLIGHT_CONTRACT}.`);
  }
  if (preflight.complete_graph !== true) {
    errors.push("draft.preflight.complete_graph must be true before save.");
  }
  if (preflight.stage_count !== stageIndex.stageIds.size) {
    errors.push("draft.preflight.stage_count must equal stages length.");
  }
  if (preflight.dependency_count !== dependencyIndex.entries.length) {
    errors.push("draft.preflight.dependency_count must equal dependencies length.");
  }
  if (preflight.requires_validation_before_save !== true) {
    errors.push("draft.preflight.requires_validation_before_save must be true.");
  }
  if (preflight.requires_save_before_run !== true) {
    errors.push("draft.preflight.requires_save_before_run must be true.");
  }
  if (preflight.forbids_inline_execution !== true) {
    errors.push("draft.preflight.forbids_inline_execution must be true.");
  }
}

function validatePortability(portability, errors) {
  if (!isPlainObject(portability)) {
    errors.push("draft.portability must be an object.");
    return;
  }
  requireExactObjectFields(
    portability,
    ["project_identity", "bridge_owner", "bridge_generation", "platform"],
    "draft.portability",
    errors,
  );
  validateBoundedString(portability.project_identity, "draft.portability.project_identity", 1, 128, errors);
  validateBoundedString(portability.bridge_owner, "draft.portability.bridge_owner", 1, 128, errors);
  validateBoundedString(portability.bridge_generation, "draft.portability.bridge_generation", 1, 128, errors);
  validateBoundedString(portability.platform, "draft.portability.platform", 1, 64, errors);
}

function validateCompleteGraphLimits(draft, stageIndex, errors) {
  assertBudget("draft graph", {
    stages: draft.stages,
    bindings: draft.bindings,
    dependencies: draft.dependencies,
  }, EXECUTABLE_RECIPE_BUDGETS.graph_max_bytes, errors);
  if (stageIndex.stageIds.size > EXECUTABLE_RECIPE_BUDGETS.stage_max_count) {
    errors.push("complete graph exceeds stage budget.");
  }
}

function validateDependencyLock(lock, draft, catalog, errors) {
  if (!isPlainObject(lock)) {
    errors.push("revision.dependency_lock must be an object.");
    return;
  }
  requireExactObjectFields(lock, ["contract", "entries"], "revision.dependency_lock", errors);
  if (lock.contract !== EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT) {
    errors.push(`revision.dependency_lock.contract must be ${EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT}.`);
  }
  if (!Array.isArray(lock.entries)) {
    errors.push("revision.dependency_lock.entries must be an array.");
    return;
  }
  if (!isPlainObject(draft) || !Array.isArray(draft.dependencies)) return;

  if (lock.entries.length !== draft.dependencies.length) {
    errors.push("revision.dependency_lock.entries must match draft.dependencies length.");
  }
  const byKey = new Map();
  for (const [index, entry] of lock.entries.entries()) {
    const field = `revision.dependency_lock.entries[${index}]`;
    if (!isPlainObject(entry)) {
      errors.push(`${field} must be an object.`);
      continue;
    }
    requireExactObjectFields(entry, ["kind", "id", "version", "descriptor_hash", "risk"], field, errors);
    byKey.set(`${entry.kind}:${entry.id}`, entry);
  }
  for (const dependency of draft.dependencies) {
    if (!isPlainObject(dependency)) continue;
    const key = `${dependency.kind}:${dependency.id}`;
    const locked = byKey.get(key);
    if (!locked) {
      errors.push(`dependency lock missing entry for ${key}.`);
      continue;
    }
    if (locked.version !== dependency.version || locked.descriptor_hash !== dependency.descriptor_hash || locked.risk !== dependency.risk) {
      errors.push(`dependency lock entry mismatch for ${key}.`);
    }
    if (catalog) {
      const catalogEntry = dependency.kind === "macro"
        ? catalog.getMacro(dependency.id)
        : catalog.getTemplate(dependency.id);
      if (catalogEntry && catalogEntry.descriptor_hash && catalogEntry.descriptor_hash !== locked.descriptor_hash) {
        errors.push(`dependency lock descriptor drift for ${key}.`);
      }
    }
  }
}

function validateSourcePayloadIdentity(identity, contentHash, errors) {
  if (!isPlainObject(identity)) {
    errors.push("revision.source_payload_identity must be an object.");
    return;
  }
  requireExactObjectFields(
    identity,
    ["scheme", "value", "encoding", "payload_kind"],
    "revision.source_payload_identity",
    errors,
  );
  if (identity.scheme !== "sha256") errors.push("revision.source_payload_identity.scheme must be sha256.");
  if (identity.encoding !== "hex") errors.push("revision.source_payload_identity.encoding must be hex.");
  if (identity.payload_kind !== "executable_recipe_draft") {
    errors.push("revision.source_payload_identity.payload_kind must be executable_recipe_draft.");
  }
  if (typeof identity.value !== "string" || !CONTENT_HASH_PATTERN.test(identity.value)) {
    errors.push("revision.source_payload_identity.value must be a 64-char lowercase hex sha256.");
  } else if (typeof contentHash === "string" && CONTENT_HASH_PATTERN.test(contentHash) && identity.value !== contentHash) {
    errors.push("revision.source_payload_identity.value must equal revision.content_hash.");
  }
}

function buildDependencyLock(draft, catalog) {
  return {
    contract: EXECUTABLE_RECIPE_DEPENDENCY_LOCK_CONTRACT,
    entries: draft.dependencies.map((dependency) => {
      const catalogEntry = dependency.kind === "macro"
        ? catalog?.getMacro(dependency.id)
        : catalog?.getTemplate(dependency.id);
      if (!catalogEntry) {
        throw new ExecutableRecipeContractError(
          `dependency lock cannot seal unknown dependency ${dependency.kind}:${dependency.id}.`,
        );
      }
      if (
        catalogEntry.version !== dependency.version
        || catalogEntry.risk !== dependency.risk
        || catalogEntry.descriptor_hash !== dependency.descriptor_hash
      ) {
        throw new ExecutableRecipeContractError(
          `dependency lock cannot seal contradictory draft facts for ${dependency.kind}:${dependency.id}.`,
        );
      }
      return {
        kind: dependency.kind,
        id: dependency.id,
        version: dependency.version,
        descriptor_hash: dependency.descriptor_hash,
        risk: dependency.risk,
      };
    }),
  };
}

function buildValidationResultId({ recipeId, version, revision, contentHash, dependencyLock }) {
  const lockIdentity = sha256Hex(stableStringify(dependencyLock));
  const identityHash = sha256Hex(stableStringify({
    recipe_id: recipeId,
    version,
    revision,
    content_hash: contentHash,
    dependency_lock_identity: lockIdentity,
  }));
  return `validation.${identityHash.slice(0, 48)}`;
}

function matchesCheckpointTrustFacts(observedFacts, revision) {
  if (!Array.isArray(observedFacts)) return false;
  const expected = revision.draft.checkpoints.map((checkpoint) => ({
    checkpoint_id: checkpoint.id,
    evidence_id: checkpoint.evidence_id,
    resume_identity: checkpoint.resume_identity,
    recipe_id: revision.recipe_id,
    version: revision.version,
    revision: revision.revision,
    content_hash: revision.content_hash,
  }));
  if (observedFacts.length !== expected.length) return false;
  const byKey = new Map();
  for (const fact of observedFacts) {
    if (!isPlainObject(fact)) return false;
    if (
      typeof fact.checkpoint_id !== "string"
      || typeof fact.evidence_id !== "string"
      || typeof fact.resume_identity !== "string"
      || typeof fact.recipe_id !== "string"
      || typeof fact.version !== "string"
      || !Number.isInteger(fact.revision)
      || typeof fact.content_hash !== "string"
    ) {
      return false;
    }
    const key = fact.checkpoint_id;
    if (byKey.has(key)) return false;
    byKey.set(key, fact);
  }
  for (const expectedFact of expected) {
    const observed = byKey.get(expectedFact.checkpoint_id);
    if (!observed) return false;
    if (
      observed.evidence_id !== expectedFact.evidence_id
      || observed.resume_identity !== expectedFact.resume_identity
      || observed.recipe_id !== expectedFact.recipe_id
      || observed.version !== expectedFact.version
      || observed.revision !== expectedFact.revision
      || observed.content_hash !== expectedFact.content_hash
    ) {
      return false;
    }
  }
  return true;
}

function coversExactDependencyFacts(observedEntries, lockedEntries, fieldName) {
  if (!Array.isArray(observedEntries) || observedEntries.length !== lockedEntries.length) return false;
  const byKey = new Map();
  for (const entry of observedEntries) {
    if (!isPlainObject(entry) || typeof entry.kind !== "string" || typeof entry.id !== "string") return false;
    if (typeof entry[fieldName] !== "string") return false;
    const key = `${entry.kind}:${entry.id}`;
    if (byKey.has(key)) return false;
    byKey.set(key, entry[fieldName]);
  }
  for (const locked of lockedEntries) {
    const key = `${locked.kind}:${locked.id}`;
    if (byKey.get(key) !== locked[fieldName]) return false;
  }
  return true;
}

function sameStringSet(left, right) {
  if (!Array.isArray(left) || !Array.isArray(right) || left.length !== right.length) return false;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  if (leftSet.size !== left.length || rightSet.size !== right.length) return false;
  if (leftSet.size !== rightSet.size) return false;
  for (const value of leftSet) {
    if (!rightSet.has(value)) return false;
  }
  return true;
}

function isSuperset(available, required) {
  if (!Array.isArray(available) || !Array.isArray(required)) return false;
  const availableSet = new Set(available);
  for (const value of required) {
    if (!availableSet.has(value)) return false;
  }
  return true;
}

function endpointPortKey(endpoint) {
  if (!isPlainObject(endpoint) || typeof endpoint.port !== "string") return null;
  if (endpoint.scope === "stage" && typeof endpoint.id === "string") {
    return `stage:${endpoint.id}:${endpoint.port}`;
  }
  if (endpoint.scope === "recipe_output") return `output:${endpoint.port}`;
  if (endpoint.scope === "recipe_input") return `input:${endpoint.port}`;
  return null;
}

function normalizeCatalogEntries(entries, kind) {
  if (!Array.isArray(entries)) {
    throw new ExecutableRecipeContractError(`dependency catalog ${kind}s must be an array.`);
  }
  const maxCount = kind === "macro"
    ? EXECUTABLE_RECIPE_BUDGETS.catalog_macro_max_count
    : EXECUTABLE_RECIPE_BUDGETS.catalog_template_max_count;
  if (entries.length > maxCount) {
    throw new ExecutableRecipeContractError(
      `dependency catalog ${kind}s exceed ${maxCount}.`,
    );
  }
  const normalized = [];
  const seen = new Set();
  for (const [index, entry] of entries.entries()) {
    if (!isPlainObject(entry)) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}] must be an object.`);
    }
    if (!Object.hasOwn(entry, "version")) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].version is required.`);
    }
    if (!Object.hasOwn(entry, "risk")) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].risk is required.`);
    }
    if (!Object.hasOwn(entry, "descriptor_hash")) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].descriptor_hash is required.`);
    }
    if (!Object.hasOwn(entry, "capabilities")) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].capabilities is required.`);
    }
    const id = entry.id;
    const version = entry.version;
    const risk = entry.risk;
    if (typeof id === "string" && id.length > EXECUTABLE_RECIPE_BUDGETS.dependency_id_max_chars) {
      throw new ExecutableRecipeContractError(
        `dependency catalog ${kind}s[${index}].id exceeds ${EXECUTABLE_RECIPE_BUDGETS.dependency_id_max_chars} characters.`,
      );
    }
    if (kind === "macro" && (typeof id !== "string" || !MACRO_ID_PATTERN.test(id) || looksLikeForbiddenIdentity(id))) {
      throw new ExecutableRecipeContractError(`dependency catalog macros[${index}].id is invalid.`);
    }
    if (kind === "template" && (typeof id !== "string" || !TEMPLATE_ID_PATTERN.test(id) || looksLikeForbiddenCatalogIdentity(id))) {
      throw new ExecutableRecipeContractError(`dependency catalog templates[${index}].id is invalid.`);
    }
    if (typeof version !== "string" || !VERSION_PATTERN.test(version) || version.length > EXECUTABLE_RECIPE_BUDGETS.version_max_chars) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].version is invalid.`);
    }
    if (!RISK_SET.has(risk)) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].risk is invalid.`);
    }
    if (typeof entry.descriptor_hash !== "string" || !CONTENT_HASH_PATTERN.test(entry.descriptor_hash)) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].descriptor_hash is invalid.`);
    }
    if (!Array.isArray(entry.capabilities)) {
      throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].capabilities must be an array.`);
    }
    if (entry.capabilities.length > EXECUTABLE_RECIPE_BUDGETS.catalog_entry_capability_max_count) {
      throw new ExecutableRecipeContractError(
        `dependency catalog ${kind}s[${index}].capabilities exceed ${EXECUTABLE_RECIPE_BUDGETS.catalog_entry_capability_max_count}.`,
      );
    }
    const capabilities = uniqueStrings(entry.capabilities, `${kind}s[${index}].capabilities`);
    for (const capability of capabilities) {
      if (!CAPABILITY_PATTERN.test(capability) || looksLikeForbiddenCatalogIdentity(capability)) {
        throw new ExecutableRecipeContractError(`dependency catalog ${kind}s[${index}].capabilities contains forbidden identity: ${capability}.`);
      }
    }
    if (seen.has(id)) {
      throw new ExecutableRecipeContractError(`dependency catalog duplicate ${kind} id: ${id}.`);
    }
    seen.add(id);
    normalized.push({
      id,
      version,
      risk,
      descriptor_hash: entry.descriptor_hash,
      capabilities,
    });
  }
  return deepFreeze(normalized);
}

function requireCatalog(catalog, errors) {
  if (!catalog || typeof catalog.getMacro !== "function" || typeof catalog.getTemplate !== "function") {
    errors.push("executable recipe validation requires an injected dependency catalog.");
    return null;
  }
  return catalog;
}

function rejectForbiddenFields(value, errors, path) {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) rejectForbiddenFields(item, errors, `${path}[${index}]`);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    const nestedPath = `${path}.${key}`;
    if (FORBIDDEN_FIELD_SET.has(key)) {
      errors.push(`${nestedPath} is a forbidden raw execution or bypass field.`);
    }
    rejectForbiddenFields(nested, errors, nestedPath);
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

function validateRecipeId(id, field, errors) {
  validateBoundedString(id, field, 1, EXECUTABLE_RECIPE_BUDGETS.id_max_chars, errors);
  if (typeof id === "string" && !RECIPE_ID_PATTERN.test(id)) {
    errors.push(`${field} must match recipe.<pack>.<lower_snake_segments>.`);
  }
}

function validateIdentifier(value, field, errors) {
  validateBoundedString(value, field, 1, 64, errors);
  if (typeof value === "string" && !IDENTIFIER_PATTERN.test(value)) {
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

function endpointNode(endpoint) {
  if (!isPlainObject(endpoint)) return null;
  if (endpoint.scope === "stage") return `stage:${endpoint.id}`;
  if (endpoint.scope === "recipe_input") return `input:${endpoint.port}`;
  if (endpoint.scope === "recipe_output") return `output:${endpoint.port}`;
  return null;
}

function hasCycle(graph) {
  const visiting = new Set();
  const visited = new Set();

  function dfs(node) {
    if (visiting.has(node)) return true;
    if (visited.has(node)) return false;
    visiting.add(node);
    for (const next of graph.get(node) ?? []) {
      if (dfs(next)) return true;
    }
    visiting.delete(node);
    visited.add(node);
    return false;
  }

  for (const node of graph.keys()) {
    if (dfs(node)) return true;
  }
  return false;
}

function looksLikeRawExecutionId(id) {
  return typeof id === "string" && RAW_EXECUTION_ID_PATTERNS.some((pattern) => pattern.test(id));
}

function looksLikeForbiddenIdentity(value) {
  if (typeof value !== "string") return false;
  if (value === "template.routing.list_track_hardware_outputs"
    || value === "routing.track_hardware_outputs.list") return false;
  if (looksLikeRawExecutionId(value)) return true;
  return /(?:^|[._-])(?:hardware|device_io|hardware_io|hardware_device|ui_action|shell|lua|bridge)(?:[._-]|$)/i.test(value);
}

function looksLikeForbiddenCatalogIdentity(value) {
  if (isCatalogOnlyHardwareOutputIdentity(value)) return false;
  return looksLikeForbiddenIdentity(value);
}

function isCatalogOnlyHardwareOutputIdentity(value) {
  return value === "template.routing.list_track_hardware_outputs"
    || value === "routing.track_hardware_outputs.list"
    || value === "template.routing.set_track_hardware_output"
    || value === "routing.track_hardware_output.set"
    || value === "template.routing.remove_track_hardware_output"
    || value === "routing.track_hardware_output.remove";
}

function isCatalogOnlyHardwareMutationIdentity(value) {
  return value === "template.routing.set_track_hardware_output"
    || value === "template.routing.remove_track_hardware_output";
}

function riskRank(risk) {
  return RISK_ORDER.get(risk) ?? 0;
}

function assertBudget(field, value, maxBytes, errors) {
  if (byteLength(value) > maxBytes) errors.push(`${field} exceeds ${maxBytes} bytes.`);
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function sha256Hex(value) {
  return createHash("sha256").update(value).digest("hex");
}

function stableStringify(value) {
  if (Array.isArray(value)) {
    return `[${value.map((item) => stableStringify(item)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) {
    throw new ExecutableRecipeContractError(`${field} must be an array.`);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new ExecutableRecipeContractError(`${field} must contain non-empty strings.`);
    }
    if (!seen.has(value)) normalized.push(value);
    seen.add(value);
  }
  return normalized;
}

function unique(values) {
  return [...new Set(values)];
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
