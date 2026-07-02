import {
  FOUNDATION_BRIDGE_OPERATION_FAMILIES,
  FOUNDATION_BRIDGE_PACK_IDS,
  FOUNDATION_BRIDGE_REF_KINDS,
} from "./foundation-bridge-v1.mjs";

export const TEMPLATE_DESCRIPTOR_CONTRACT = "template.descriptor.v1";

export const TEMPLATE_DESCRIPTOR_LIFECYCLES = Object.freeze([
  "draft",
  "experimental",
  "stable",
  "deprecated",
]);

export const TEMPLATE_DESCRIPTOR_RISKS = Object.freeze([
  "read",
  "safe",
  "write",
  "destructive",
]);

export const TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS = Object.freeze([
  "loop",
  "cleanup",
  "delivery",
  "layer",
  "music_sketch",
]);

export const TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS = Object.freeze([
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
]);

export const TEMPLATE_DESCRIPTOR_DETAIL_FIELDS = Object.freeze([
  "inputSchema",
  "outputSchema",
  "examples",
  "expectedDelta",
]);

export const TEMPLATE_DESCRIPTOR_FULL_FIELDS = Object.freeze([
  "contract",
  ...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  "bridge",
  "inputSchema",
  "outputSchema",
  "refs",
  "artifacts",
  "expectedDelta",
  "verification",
  "examples",
  "pressureFixture",
]);

export const TEMPLATE_DESCRIPTOR_BUDGETS = Object.freeze({
  id_max_chars: 96,
  title_max_chars: 80,
  summary_max_chars: 240,
  tag_max_count: 12,
  tag_max_chars: 32,
  refs_max_count: 16,
  artifacts_max_count: 8,
  examples_max_count: 3,
  example_max_bytes: 1_024,
  schema_max_bytes: 4_096,
  expected_delta_max_bytes: 2_048,
  descriptor_max_bytes: 16_384,
  discovery_summary_max_bytes: 1_024,
  verification_checks_max_count: 8,
  timeout_ms_max: 600_000,
});

export const TEMPLATE_DESCRIPTOR_ID_PATTERN =
  /^template\.([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*){1,4}$/;
export const TEMPLATE_DESCRIPTOR_ENTITY_KIND_PATTERN =
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
export const TEMPLATE_DESCRIPTOR_TAG_PATTERN = /^[a-z][a-z0-9_]*$/;
export const TEMPLATE_DESCRIPTOR_CAPABILITY_PATTERN =
  /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

export const TEMPLATE_DESCRIPTOR_BRIDGE_IDEMPOTENCY_VALUES = Object.freeze([
  "none",
  "supported",
  "required",
]);

export const TEMPLATE_DESCRIPTOR_ARTIFACT_MODES = Object.freeze([
  "none",
  "metadata",
  "produces",
]);

export const TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_KINDS = Object.freeze([
  "none",
  "read",
  "mutation",
  "job",
  "artifact",
]);

export const TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_ACTIONS = Object.freeze([
  "read",
  "create",
  "update",
  "delete",
  "emit",
  "start_job",
]);

export const TEMPLATE_DESCRIPTOR_VERIFICATION_MODES = Object.freeze([
  "none",
  "optional",
  "required",
]);

export const TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES = Object.freeze([
  "read_only_state",
  "simple_write",
  "destructive_write",
  "artifact_producing",
  "analysis_job",
  "render_job",
  "action_backed",
  "cross_domain_primary_owner",
  "verification_required",
  "idempotent_mutation",
  "ref_heavy",
  "compact_discovery_full_descriptor_split",
]);

const PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const OPERATION_FAMILY_SET = new Set(FOUNDATION_BRIDGE_OPERATION_FAMILIES);
const REF_KIND_SET = new Set(FOUNDATION_BRIDGE_REF_KINDS);
const LIFECYCLE_SET = new Set(TEMPLATE_DESCRIPTOR_LIFECYCLES);
const RISK_SET = new Set(TEMPLATE_DESCRIPTOR_RISKS);
const WORKFLOW_SHAPED_PACK_ID_SET = new Set(TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);
const BRIDGE_IDEMPOTENCY_SET = new Set(TEMPLATE_DESCRIPTOR_BRIDGE_IDEMPOTENCY_VALUES);
const ARTIFACT_MODE_SET = new Set(TEMPLATE_DESCRIPTOR_ARTIFACT_MODES);
const EXPECTED_DELTA_KIND_SET = new Set(TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_KINDS);
const EXPECTED_DELTA_ACTION_SET = new Set(TEMPLATE_DESCRIPTOR_EXPECTED_DELTA_ACTIONS);
const VERIFICATION_MODE_SET = new Set(TEMPLATE_DESCRIPTOR_VERIFICATION_MODES);
const PRESSURE_FIXTURE_CATEGORY_SET = new Set(TEMPLATE_DESCRIPTOR_PRESSURE_FIXTURE_CATEGORIES);
const NON_IDEMPOTENT_FAMILIES = new Set(["query_state", "artifact_metadata"]);
const MUTATING_RISKS = new Set(["write", "destructive"]);
const MUTATING_DELTA_ACTIONS = new Set(["create", "update", "delete"]);

export class TemplateDescriptorValidationError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.name = "TemplateDescriptorValidationError";
    this.errors = errors;
  }
}

export function validateTemplateDescriptor(input) {
  const errors = [];
  validateDescriptorShape(input, errors);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeTemplateDescriptor(input) {
  const result = validateTemplateDescriptor(input);
  if (!result.ok) {
    throw new TemplateDescriptorValidationError(
      `Template descriptor validation failed: ${result.errors.join("; ")}`,
      result.errors,
    );
  }
  return deepFreeze(cloneJson(input));
}

export function templateDescriptorDiscoverySummary(input) {
  const descriptor = normalizeTemplateDescriptor(input);
  const summary = projectFields(descriptor, TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS);
  const summaryBytes = byteLength(summary);
  if (summaryBytes > TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes) {
    throw new TemplateDescriptorValidationError(
      `Template descriptor discovery summary exceeds ${TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes} bytes.`,
    );
  }
  return deepFreeze(summary);
}

export function templateDescriptorOnDemandFields(input, fields = TEMPLATE_DESCRIPTOR_DETAIL_FIELDS) {
  const descriptor = normalizeTemplateDescriptor(input);
  const selected = uniqueStrings(fields, "fields");
  const allowed = new Set(TEMPLATE_DESCRIPTOR_DETAIL_FIELDS);
  const unknown = selected.filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    throw new TemplateDescriptorValidationError(
      `Unknown template descriptor detail field(s): ${unknown.join(", ")}`,
    );
  }
  return deepFreeze(projectFields(descriptor, ["id", ...selected]));
}

function validateDescriptorShape(input, errors) {
  if (!isPlainObject(input)) {
    errors.push("Descriptor must be an object.");
    return;
  }

  requireKnownTopLevelFields(input, errors);
  requireFields(input, TEMPLATE_DESCRIPTOR_FULL_FIELDS.filter((field) => field !== "pressureFixture"), errors);
  assertBudget("descriptor", input, TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes, errors);
  assertBudget(
    "discovery summary",
    projectFields(input, TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS),
    TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
    errors,
  );

  if (input.contract !== TEMPLATE_DESCRIPTOR_CONTRACT) {
    errors.push("contract must be template.descriptor.v1.");
  }

  validatePack(input.pack, errors);
  validateId(input.id, input.pack, errors);
  validateBoundedString(input.title, "title", 1, TEMPLATE_DESCRIPTOR_BUDGETS.title_max_chars, errors);
  validateBoundedString(input.summary, "summary", 1, TEMPLATE_DESCRIPTOR_BUDGETS.summary_max_chars, errors);

  if (!LIFECYCLE_SET.has(input.lifecycle)) {
    errors.push(`Invalid lifecycle: ${String(input.lifecycle)}.`);
  }
  if (!RISK_SET.has(input.risk)) {
    errors.push(`Invalid risk: ${String(input.risk)}.`);
  }
  validateEntityKind(input.entity_kind, "entity_kind", errors);
  validateTags(input.tags, errors);
  validateBridge(input.bridge, input.risk, errors);
  validateSchema(input.inputSchema, "inputSchema", errors);
  validateSchema(input.outputSchema, "outputSchema", errors);
  validateRefs(input.refs, errors);
  validateArtifacts(input.artifacts, errors);
  validateExpectedDelta(input.expectedDelta, input.risk, errors);
  validateVerification(input.verification, input.risk, errors);
  validateExamples(input.examples, errors);
  if (input.pressureFixture !== undefined) {
    validatePressureFixture(input.pressureFixture, errors);
  }
}

function requireKnownTopLevelFields(input, errors) {
  const allowed = new Set(TEMPLATE_DESCRIPTOR_FULL_FIELDS);
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`Unknown top-level descriptor field: ${key}.`);
  }
}

function requireFields(input, fields, errors) {
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) errors.push(`Missing required field: ${field}.`);
  }
}

function validatePack(pack, errors) {
  if (!PACK_ID_SET.has(pack)) {
    errors.push(`Invalid pack: ${String(pack)}.`);
  }
  if (WORKFLOW_SHAPED_PACK_ID_SET.has(pack)) {
    errors.push(`Workflow-shaped pack ids are forbidden: ${pack}.`);
  }
}

function validateId(id, pack, errors) {
  validateBoundedString(id, "id", 1, TEMPLATE_DESCRIPTOR_BUDGETS.id_max_chars, errors);
  if (typeof id !== "string") return;
  const match = id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN);
  if (!match) {
    errors.push("id must match template.<pack>.<lower_snake_segments>.");
    return;
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
  if (tags.length === 0) {
    errors.push("tags must contain at least one tag.");
  }
  if (tags.length > TEMPLATE_DESCRIPTOR_BUDGETS.tag_max_count) {
    errors.push(`tags may contain at most ${TEMPLATE_DESCRIPTOR_BUDGETS.tag_max_count} tags.`);
  }
  const seen = new Set();
  for (const tag of tags) {
    validateBoundedString(tag, "tag", 1, TEMPLATE_DESCRIPTOR_BUDGETS.tag_max_chars, errors);
    if (typeof tag === "string" && !TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(tag)) {
      errors.push(`Invalid tag: ${tag}.`);
    }
    if (seen.has(tag)) errors.push(`Duplicate tag: ${tag}.`);
    seen.add(tag);
  }
}

function validateBridge(bridge, risk, errors) {
  if (!isPlainObject(bridge)) {
    errors.push("bridge must be an object.");
    return;
  }

  requireExactObjectFields(
    bridge,
    ["operation_family", "operation_name", "capability", "idempotency", "timeout_ms"],
    "bridge",
    errors,
  );

  if (!OPERATION_FAMILY_SET.has(bridge.operation_family)) {
    errors.push(`Invalid bridge.operation_family: ${String(bridge.operation_family)}.`);
  }
  validateCapability(bridge.operation_name, "bridge.operation_name", errors);
  validateCapability(bridge.capability, "bridge.capability", errors);
  if (!BRIDGE_IDEMPOTENCY_SET.has(bridge.idempotency)) {
    errors.push(`Invalid bridge.idempotency: ${String(bridge.idempotency)}.`);
  }
  if (!Number.isInteger(bridge.timeout_ms) || bridge.timeout_ms < 1) {
    errors.push("bridge.timeout_ms must be a positive integer.");
  } else if (bridge.timeout_ms > TEMPLATE_DESCRIPTOR_BUDGETS.timeout_ms_max) {
    errors.push(`bridge.timeout_ms exceeds ${TEMPLATE_DESCRIPTOR_BUDGETS.timeout_ms_max}.`);
  }

  if (NON_IDEMPOTENT_FAMILIES.has(bridge.operation_family) && bridge.idempotency !== "none") {
    errors.push("Read-only bridge operation families must declare bridge.idempotency as none.");
  }
  if (risk === "read" && !["query_state", "artifact_metadata", "run_job"].includes(bridge.operation_family)) {
    errors.push("read risk descriptors must use query_state, artifact_metadata, or run_job.");
  }
}

function validateCapability(value, field, errors) {
  validateBoundedString(value, field, 1, 80, errors);
  if (typeof value === "string" && !TEMPLATE_DESCRIPTOR_CAPABILITY_PATTERN.test(value)) {
    errors.push(`${field} must use dotted lower-snake grammar.`);
  }
}

function validateSchema(schema, field, errors) {
  if (!isPlainObject(schema)) {
    errors.push(`${field} must be a JSON object schema.`);
    return;
  }
  assertBudget(field, schema, TEMPLATE_DESCRIPTOR_BUDGETS.schema_max_bytes, errors);
  requireExactObjectFields(schema, ["type", "properties", "required", "additionalProperties"], field, errors);
  if (schema.type !== "object") {
    errors.push(`${field}.type must be object.`);
  }
  if (!isPlainObject(schema.properties)) {
    errors.push(`${field}.properties must be an object.`);
    return;
  }
  if (!Array.isArray(schema.required) || !schema.required.every((entry) => typeof entry === "string")) {
    errors.push(`${field}.required must be an array of property names.`);
  }
  if (schema.additionalProperties !== false) {
    errors.push(`${field}.additionalProperties must be false.`);
  }
  for (const [name, property] of Object.entries(schema.properties)) {
    if (!TEMPLATE_DESCRIPTOR_TAG_PATTERN.test(name)) {
      errors.push(`${field}.properties contains invalid property name: ${name}.`);
    }
    if (!isPlainObject(property)) {
      errors.push(`${field}.properties.${name} must be an object.`);
      continue;
    }
    if (!("type" in property) && !("enum" in property) && !("const" in property) && !("oneOf" in property)) {
      errors.push(`${field}.properties.${name} must declare type, enum, const, or oneOf.`);
    }
  }
  if (Array.isArray(schema.required)) {
    for (const name of schema.required) {
      if (isPlainObject(schema.properties) && !Object.hasOwn(schema.properties, name)) {
        errors.push(`${field}.required names missing property: ${name}.`);
      }
    }
  }
}

function validateRefs(refs, errors) {
  if (!isPlainObject(refs)) {
    errors.push("refs must be an object.");
    return;
  }
  requireExactObjectFields(refs, ["input", "output"], "refs", errors);
  const input = validateRefDeclarationArray(refs.input, "refs.input", errors);
  const output = validateRefDeclarationArray(refs.output, "refs.output", errors);
  if (input + output > TEMPLATE_DESCRIPTOR_BUDGETS.refs_max_count) {
    errors.push(`refs may declare at most ${TEMPLATE_DESCRIPTOR_BUDGETS.refs_max_count} refs.`);
  }
}

function validateRefDeclarationArray(refs, field, errors) {
  if (!Array.isArray(refs)) {
    errors.push(`${field} must be an array.`);
    return 0;
  }
  for (const ref of refs) {
    validateRefDeclaration(ref, field, errors);
  }
  return refs.length;
}

function validateRefDeclaration(ref, field, errors) {
  if (!isPlainObject(ref)) {
    errors.push(`${field} entries must be objects.`);
    return;
  }
  requireExactObjectFields(ref, ["name", "kind", "required", "summary"], `${field} entry`, errors);
  validateEntityKind(ref.name, `${field}.name`, errors);
  if (!REF_KIND_SET.has(ref.kind)) errors.push(`${field}.kind is not a frozen ref kind: ${String(ref.kind)}.`);
  if (typeof ref.required !== "boolean") errors.push(`${field}.required must be a boolean.`);
  validateBoundedString(ref.summary, `${field}.summary`, 1, 160, errors);
}

function validateArtifacts(artifacts, errors) {
  if (!isPlainObject(artifacts)) {
    errors.push("artifacts must be an object.");
    return;
  }
  requireExactObjectFields(artifacts, ["mode", "input", "output"], "artifacts", errors);
  if (!ARTIFACT_MODE_SET.has(artifacts.mode)) {
    errors.push(`Invalid artifacts.mode: ${String(artifacts.mode)}.`);
  }
  const input = validateArtifactDeclarationArray(artifacts.input, "artifacts.input", errors);
  const output = validateArtifactDeclarationArray(artifacts.output, "artifacts.output", errors);
  if (input + output > TEMPLATE_DESCRIPTOR_BUDGETS.artifacts_max_count) {
    errors.push(`artifacts may declare at most ${TEMPLATE_DESCRIPTOR_BUDGETS.artifacts_max_count} artifacts.`);
  }
  if (artifacts.mode === "none" && input + output > 0) {
    errors.push("artifacts.mode none must not declare input or output artifacts.");
  }
  if (artifacts.mode === "produces" && output === 0) {
    errors.push("artifacts.mode produces must declare at least one output artifact.");
  }
}

function validateArtifactDeclarationArray(artifacts, field, errors) {
  if (!Array.isArray(artifacts)) {
    errors.push(`${field} must be an array.`);
    return 0;
  }
  for (const artifact of artifacts) {
    validateArtifactDeclaration(artifact, field, errors);
  }
  return artifacts.length;
}

function validateArtifactDeclaration(artifact, field, errors) {
  if (!isPlainObject(artifact)) {
    errors.push(`${field} entries must be objects.`);
    return;
  }
  requireExactObjectFields(artifact, ["name", "schema", "owner_pack", "summary"], `${field} entry`, errors);
  validateEntityKind(artifact.name, `${field}.name`, errors);
  validateCapability(artifact.schema, `${field}.schema`, errors);
  validatePack(artifact.owner_pack, errors);
  validateBoundedString(artifact.summary, `${field}.summary`, 1, 160, errors);
}

function validateExpectedDelta(expectedDelta, risk, errors) {
  if (!isPlainObject(expectedDelta)) {
    errors.push("expectedDelta must be an object.");
    return;
  }
  assertBudget("expectedDelta", expectedDelta, TEMPLATE_DESCRIPTOR_BUDGETS.expected_delta_max_bytes, errors);
  requireExactObjectFields(expectedDelta, ["kind", "summary", "entities", "idempotent"], "expectedDelta", errors);
  if (!EXPECTED_DELTA_KIND_SET.has(expectedDelta.kind)) {
    errors.push(`Invalid expectedDelta.kind: ${String(expectedDelta.kind)}.`);
  }
  validateBoundedString(expectedDelta.summary, "expectedDelta.summary", 1, 240, errors);
  if (!Array.isArray(expectedDelta.entities)) {
    errors.push("expectedDelta.entities must be an array.");
  } else {
    for (const entity of expectedDelta.entities) validateExpectedDeltaEntity(entity, risk, errors);
  }
  if (typeof expectedDelta.idempotent !== "boolean") {
    errors.push("expectedDelta.idempotent must be a boolean.");
  }

  if (risk === "read" && !["read", "artifact", "job", "none"].includes(expectedDelta.kind)) {
    errors.push("read risk descriptors must not declare mutating expectedDelta.");
  }
  if (MUTATING_RISKS.has(risk) && expectedDelta.kind !== "mutation" && expectedDelta.kind !== "job") {
    errors.push("write/destructive descriptors must declare mutation or job expectedDelta.");
  }
}

function validateExpectedDeltaEntity(entity, risk, errors) {
  if (!isPlainObject(entity)) {
    errors.push("expectedDelta.entities entries must be objects.");
    return;
  }
  requireExactObjectFields(entity, ["entity_kind", "action", "summary"], "expectedDelta entity", errors);
  validateEntityKind(entity.entity_kind, "expectedDelta.entities.entity_kind", errors);
  if (!EXPECTED_DELTA_ACTION_SET.has(entity.action)) {
    errors.push(`Invalid expectedDelta entity action: ${String(entity.action)}.`);
  }
  if (risk === "read" && MUTATING_DELTA_ACTIONS.has(entity.action)) {
    errors.push("read risk descriptors must not declare mutating expectedDelta actions.");
  }
  validateBoundedString(entity.summary, "expectedDelta.entities.summary", 1, 160, errors);
}

function validateVerification(verification, risk, errors) {
  if (!isPlainObject(verification)) {
    errors.push("verification must be an object.");
    return;
  }
  requireExactObjectFields(verification, ["mode", "checks"], "verification", errors);
  if (!VERIFICATION_MODE_SET.has(verification.mode)) {
    errors.push(`Invalid verification.mode: ${String(verification.mode)}.`);
  }
  if (!Array.isArray(verification.checks)) {
    errors.push("verification.checks must be an array.");
    return;
  }
  if (verification.checks.length > TEMPLATE_DESCRIPTOR_BUDGETS.verification_checks_max_count) {
    errors.push(
      `verification.checks may contain at most ${TEMPLATE_DESCRIPTOR_BUDGETS.verification_checks_max_count} checks.`,
    );
  }
  for (const check of verification.checks) validateVerificationCheck(check, errors);
  if (MUTATING_RISKS.has(risk) && verification.mode !== "required") {
    errors.push("write/destructive descriptors must declare verification.mode required.");
  }
  if (verification.mode === "none" && verification.checks.length > 0) {
    errors.push("verification.mode none must not declare checks.");
  }
  if (verification.mode === "required" && verification.checks.length === 0) {
    errors.push("verification.mode required must declare at least one check.");
  }
}

function validateVerificationCheck(check, errors) {
  if (!isPlainObject(check)) {
    errors.push("verification.checks entries must be objects.");
    return;
  }
  requireExactObjectFields(check, ["name", "kind", "summary"], "verification check", errors);
  validateEntityKind(check.name, "verification.checks.name", errors);
  validateEntityKind(check.kind, "verification.checks.kind", errors);
  validateBoundedString(check.summary, "verification.checks.summary", 1, 160, errors);
}

function validateExamples(examples, errors) {
  if (!Array.isArray(examples)) {
    errors.push("examples must be an array.");
    return;
  }
  if (examples.length === 0) {
    errors.push("examples must contain at least one example.");
  }
  if (examples.length > TEMPLATE_DESCRIPTOR_BUDGETS.examples_max_count) {
    errors.push(`examples may contain at most ${TEMPLATE_DESCRIPTOR_BUDGETS.examples_max_count} examples.`);
  }
  for (const example of examples) {
    validateExample(example, errors);
    assertBudget("example", example, TEMPLATE_DESCRIPTOR_BUDGETS.example_max_bytes, errors);
  }
}

function validateExample(example, errors) {
  if (!isPlainObject(example)) {
    errors.push("examples entries must be objects.");
    return;
  }
  requireExactObjectFields(example, ["name", "summary", "input"], "example", errors);
  validateEntityKind(example.name, "examples.name", errors);
  validateBoundedString(example.summary, "examples.summary", 1, 160, errors);
  if (!isPlainObject(example.input)) {
    errors.push("examples.input must be an object.");
  }
}

function validatePressureFixture(pressureFixture, errors) {
  if (!isPlainObject(pressureFixture)) {
    errors.push("pressureFixture must be an object.");
    return;
  }
  requireExactObjectFields(pressureFixture, ["categories", "notes"], "pressureFixture", errors);
  if (!Array.isArray(pressureFixture.categories) || pressureFixture.categories.length === 0) {
    errors.push("pressureFixture.categories must be a non-empty array.");
  } else {
    for (const category of pressureFixture.categories) {
      if (!PRESSURE_FIXTURE_CATEGORY_SET.has(category)) {
        errors.push(`Invalid pressureFixture category: ${String(category)}.`);
      }
    }
  }
  validateBoundedString(pressureFixture.notes, "pressureFixture.notes", 1, 240, errors);
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

function validateEntityKind(value, field, errors) {
  validateBoundedString(value, field, 1, 80, errors);
  if (typeof value === "string" && !TEMPLATE_DESCRIPTOR_ENTITY_KIND_PATTERN.test(value)) {
    errors.push(`${field} must use lower snake-case or dotted lower snake-case.`);
  }
}

function validateBoundedString(value, field, min, max, errors) {
  if (typeof value !== "string") {
    errors.push(`${field} must be a string.`);
    return;
  }
  if (value.trim().length < min) {
    errors.push(`${field} must not be blank.`);
  }
  if (value.length > max) {
    errors.push(`${field} exceeds ${max} characters.`);
  }
}

function assertBudget(field, value, maxBytes, errors) {
  const bytes = byteLength(value);
  if (bytes > maxBytes) {
    errors.push(`${field} exceeds ${maxBytes} bytes.`);
  }
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function projectFields(object, fields) {
  const projected = {};
  for (const field of fields) projected[field] = object[field];
  return projected;
}

function uniqueStrings(values, field) {
  if (!Array.isArray(values)) {
    throw new TemplateDescriptorValidationError(`${field} must be an array.`);
  }
  const normalized = [];
  const seen = new Set();
  for (const value of values) {
    if (typeof value !== "string" || value.trim() === "") {
      throw new TemplateDescriptorValidationError(`${field} must contain non-empty strings.`);
    }
    if (!seen.has(value)) normalized.push(value);
    seen.add(value);
  }
  return normalized;
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
