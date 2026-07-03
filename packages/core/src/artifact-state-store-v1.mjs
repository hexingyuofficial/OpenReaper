import path from "node:path";
import { FOUNDATION_BRIDGE_PACK_IDS } from "./foundation-bridge-v1.mjs";

export const ARTIFACT_STATE_STORE_CONTRACT = "artifact.state_store.v1";
export const ARTIFACT_REF_PREFIX = "artifact";

export const ARTIFACT_STATE_STORE_WORKFLOW_SHAPED_IDS = Object.freeze([
  "loop",
  "cleanup",
  "delivery",
  "layer",
  "music_sketch",
]);

export const ARTIFACT_SCOPE_PATTERN = /^[a-z][a-z0-9_]*$/;
export const ARTIFACT_ID_PATTERN = /^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$/;
export const ARTIFACT_REF_PATTERN =
  /^artifact:([a-z][a-z0-9_]*):([a-z][a-z0-9_]*):(art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6})$/;
export const ARTIFACT_SCHEMA_PATTERN = /^[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+\.v[0-9]+$/;
export const ARTIFACT_PRODUCER_TEMPLATE_ID_PATTERN =
  /^template\.([a-z][a-z0-9_]*)(?:\.[a-z][a-z0-9_]*){1,4}$/;

export const ARTIFACT_STATE_STORE_BUDGETS = Object.freeze({
  summary_max_bytes: 2_048,
  payload_max_bytes: 65_536,
  read_response_max_bytes: 65_536,
  schema_max_chars: 160,
  producer_max_bytes: 1_024,
});

export const ARTIFACT_STATE_STORE_TTL_POLICY = Object.freeze({
  default_ttl_ms: 7 * 24 * 60 * 60 * 1_000,
  sweep_extension: ".json",
  sweep_depth: 3,
  best_effort: true,
});

export const ARTIFACT_READ_VIEWS = Object.freeze(["summary", "payload"]);

export const ARTIFACT_LAST_RESULT_POLICY = Object.freeze({
  producers_update_last_result: false,
  reads_update_last_result: false,
  public_last_result_artifact_refs: false,
  forbidden_public_ref_pattern: "last_result:artifact:N",
});

export const ARTIFACT_STATE_STORE_ERROR_CODES = Object.freeze([
  "PARAMS_INVALID",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_INVALID",
  "RESPONSE_TOO_LARGE",
]);

const PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const WORKFLOW_SHAPED_ID_SET = new Set(ARTIFACT_STATE_STORE_WORKFLOW_SHAPED_IDS);
const READ_VIEW_SET = new Set(ARTIFACT_READ_VIEWS);
const ENVELOPE_FIELDS = Object.freeze([
  "contract",
  "ref",
  "id",
  "owner_pack",
  "scope",
  "schema",
  "producer",
  "created_at",
  "summary",
  "payload",
]);
const PRODUCER_FIELDS = Object.freeze(["kind", "id", "pack"]);
const PUBLIC_LAST_RESULT_ARTIFACT_REF_PATTERN = /\blast_result:artifact:[0-9]+\b/;

export class ArtifactStateStoreContractError extends Error {
  constructor(message, code = "ARTIFACT_INVALID", details = {}) {
    super(message);
    this.name = "ArtifactStateStoreContractError";
    this.code = code;
    this.details = details;
  }
}

export function isValidArtifactOwnerPack(value) {
  return PACK_ID_SET.has(value);
}

export function isWorkflowShapedArtifactId(value) {
  return WORKFLOW_SHAPED_ID_SET.has(value);
}

export function isValidArtifactScope(value) {
  return typeof value === "string" && ARTIFACT_SCOPE_PATTERN.test(value) && !isWorkflowShapedArtifactId(value);
}

export function isValidArtifactId(value) {
  return typeof value === "string" && ARTIFACT_ID_PATTERN.test(value);
}

export function parseArtifactRef(ref) {
  assertCanonicalRefInput(ref);
  const match = ARTIFACT_REF_PATTERN.exec(ref);
  if (!match) {
    throw new ArtifactStateStoreContractError(
      "Malformed artifact ref; expected artifact:<owner_pack>:<scope>:<id>.",
      "PARAMS_INVALID",
      { ref },
    );
  }

  const parts = {
    owner_pack: match[1],
    scope: match[2],
    id: match[3],
  };
  validateArtifactRefParts(parts);
  return deepFreeze(parts);
}

export function tryParseArtifactRef(ref) {
  try {
    return parseArtifactRef(ref);
  } catch {
    return null;
  }
}

export function formatArtifactRef(parts) {
  const normalized = validateArtifactRefParts(parts);
  return `${ARTIFACT_REF_PREFIX}:${normalized.owner_pack}:${normalized.scope}:${normalized.id}`;
}

export function validateArtifactRefParts(parts) {
  if (!isPlainObject(parts)) {
    throw new ArtifactStateStoreContractError("Artifact ref parts must be an object.", "PARAMS_INVALID");
  }
  if (!isValidArtifactOwnerPack(parts.owner_pack)) {
    throw new ArtifactStateStoreContractError(
      `Invalid artifact owner_pack: ${String(parts.owner_pack)}.`,
      "PARAMS_INVALID",
      { owner_pack: parts.owner_pack },
    );
  }
  if (isWorkflowShapedArtifactId(parts.owner_pack)) {
    throw new ArtifactStateStoreContractError(
      `Workflow-shaped artifact owner_pack is forbidden: ${parts.owner_pack}.`,
      "PARAMS_INVALID",
      { owner_pack: parts.owner_pack },
    );
  }
  if (!isValidArtifactScope(parts.scope)) {
    throw new ArtifactStateStoreContractError(
      `Invalid artifact scope: ${String(parts.scope)}.`,
      "PARAMS_INVALID",
      { scope: parts.scope },
    );
  }
  if (!isValidArtifactId(parts.id)) {
    throw new ArtifactStateStoreContractError(
      `Invalid artifact id: ${String(parts.id)}.`,
      "PARAMS_INVALID",
      { id: parts.id },
    );
  }
  return deepFreeze({
    owner_pack: parts.owner_pack,
    scope: parts.scope,
    id: parts.id,
  });
}

export function artifactIdFromCommandId(commandId) {
  if (typeof commandId !== "string") {
    throw new ArtifactStateStoreContractError("Command id must be a string.", "PARAMS_INVALID");
  }
  const match = commandId.match(/^cmd_([0-9]{17})_([0-9]{3})_([a-f0-9]{6})$/);
  if (!match) {
    throw new ArtifactStateStoreContractError(
      "Command id must match cmd_YYYYMMDDhhmmssmmm_NNN_xxxxxx.",
      "PARAMS_INVALID",
      { command_id: commandId },
    );
  }
  return `art_${match[1]}_${match[2]}_${match[3]}`;
}

export function artifactPathFromRef(artifactRoot, ref) {
  return artifactPathFromParts(artifactRoot, parseArtifactRef(ref));
}

export function artifactPathFromParts(artifactRoot, parts) {
  const root = normalizeArtifactRoot(artifactRoot);
  const normalized = validateArtifactRefParts(parts);
  const fullPath = path.join(root, normalized.owner_pack, normalized.scope, `${normalized.id}.json`);
  assertPathInsideArtifactRoot(root, fullPath);
  return fullPath;
}

export function classifyArtifactStorePath(artifactRoot, candidatePath) {
  let root;
  try {
    root = normalizeArtifactRoot(artifactRoot);
  } catch (error) {
    return sweepKeep("invalid_artifact_root", error.message);
  }
  if (typeof candidatePath !== "string" || candidatePath.trim() === "") {
    return sweepKeep("invalid_path", "Artifact store path must be a non-empty string.");
  }
  if (candidatePath.startsWith("file://")) {
    return sweepKeep("file_url_path", "Artifact store paths must not use file:// URLs.");
  }
  if (!isAbsolutePath(candidatePath)) {
    return sweepKeep("relative_path", "Artifact store path must be absolute.");
  }

  const fullPath = path.resolve(candidatePath);
  const relative = path.relative(root, fullPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    return sweepKeep("outside_artifact_root", "Artifact store path is outside the artifact root.");
  }

  const segments = relative.split(path.sep);
  if (segments.length !== ARTIFACT_STATE_STORE_TTL_POLICY.sweep_depth) {
    return sweepKeep("unexpected_depth", "Artifact sweep only considers owner_pack/scope/id.json paths.");
  }
  if (!segments[2].endsWith(ARTIFACT_STATE_STORE_TTL_POLICY.sweep_extension)) {
    return sweepKeep("non_json", "Artifact sweep only considers .json files.");
  }

  const parts = {
    owner_pack: segments[0],
    scope: segments[1],
    id: segments[2].slice(0, -ARTIFACT_STATE_STORE_TTL_POLICY.sweep_extension.length),
  };

  try {
    validateArtifactRefParts(parts);
  } catch (error) {
    return sweepKeep("invalid_artifact_path", error.message);
  }

  return deepFreeze({
    ok: true,
    action: "candidate",
    path: fullPath,
    ref: formatArtifactRef(parts),
    parts,
  });
}

export function shouldSweepArtifactPath({
  artifactRoot,
  candidatePath,
  now_ms = Date.now(),
  mtime_ms,
  ttl_ms = ARTIFACT_STATE_STORE_TTL_POLICY.default_ttl_ms,
} = {}) {
  const classified = classifyArtifactStorePath(artifactRoot, candidatePath);
  if (!classified.ok) return classified;
  if (!Number.isFinite(now_ms) || !Number.isFinite(mtime_ms) || !Number.isFinite(ttl_ms) || ttl_ms < 0) {
    return sweepKeep("invalid_time", "Artifact sweep requires finite now_ms, mtime_ms, and ttl_ms.");
  }
  if (now_ms - mtime_ms > ttl_ms) {
    return deepFreeze({
      ok: true,
      action: "delete",
      reason: "expired",
      path: classified.path,
      ref: classified.ref,
      parts: classified.parts,
    });
  }
  return deepFreeze({
    ok: true,
    action: "keep",
    reason: "fresh",
    path: classified.path,
    ref: classified.ref,
    parts: classified.parts,
  });
}

export function normalizeArtifactEnvelope(input) {
  const errors = validateArtifactEnvelope(input).errors;
  if (errors.length > 0) {
    throw new ArtifactStateStoreContractError(
      `Artifact envelope validation failed: ${errors.join("; ")}`,
      inferEnvelopeErrorCode(errors),
      { errors },
    );
  }
  return deepFreeze(cloneJson(input));
}

export function validateArtifactEnvelope(input) {
  const errors = [];
  validateEnvelopeShape(input, errors);
  return deepFreeze({
    ok: errors.length === 0,
    errors,
  });
}

export function projectArtifactRead(envelope, options = {}) {
  const artifact = normalizeArtifactEnvelope(envelope);
  const view = options.view ?? "summary";
  if (!READ_VIEW_SET.has(view)) {
    throw new ArtifactStateStoreContractError(
      "Artifact read view must be summary or payload.",
      "PARAMS_INVALID",
      { view },
    );
  }
  const budget = normalizeReadBudget(options.budget);
  const projected = {
    artifact: {
      ref: artifact.ref,
      id: artifact.id,
      owner_pack: artifact.owner_pack,
      scope: artifact.scope,
      schema: artifact.schema,
      producer: artifact.producer,
      created_at: artifact.created_at,
      summary: artifact.summary,
      ...(view === "payload" ? { payload: artifact.payload } : {}),
      view,
      truncated: false,
    },
  };
  const responseBytes = projectedByteLengthWithResponseBytes(projected);
  if (responseBytes > budget.max_response_bytes) {
    throw new ArtifactStateStoreContractError(
      "Artifact read response exceeds max_response_bytes.",
      "RESPONSE_TOO_LARGE",
      { response_bytes: responseBytes, max_response_bytes: budget.max_response_bytes, view },
    );
  }
  projected.artifact.response_bytes = responseBytes;
  return deepFreeze(projected);
}

export function artifactRefDescriptorFromEnvelope(envelope) {
  const artifact = normalizeArtifactEnvelope(envelope);
  return deepFreeze({
    kind: "artifact",
    ref: artifact.ref,
    identity: {
      scheme: "artifact_ref",
      value: artifact.ref,
    },
    summary: {
      schema: artifact.schema,
      owner_pack: artifact.owner_pack,
      scope: artifact.scope,
    },
  });
}

export function createArtifactProducerResult({ artifact_refs = [] } = {}) {
  if (!Array.isArray(artifact_refs)) {
    throw new ArtifactStateStoreContractError("artifact_refs must be an array.", "PARAMS_INVALID");
  }
  const refs = artifact_refs.map((ref) => {
    const parsed = parseArtifactRef(ref);
    const formattedRef = formatArtifactRef(parsed);
    return {
      kind: "artifact",
      ref: formattedRef,
      identity: {
        scheme: "artifact_ref",
        value: formattedRef,
      },
      summary: {
        owner_pack: parsed.owner_pack,
        scope: parsed.scope,
      },
    };
  });
  const result = {
    artifacts: refs,
    last_result: {
      updated: false,
      refs: [],
      truncated: false,
    },
  };
  assertNoPublicArtifactLastResultRefs(result);
  return deepFreeze(result);
}

export function assertNoPublicArtifactLastResultRefs(value) {
  const encoded = safeStringify(value);
  if (PUBLIC_LAST_RESULT_ARTIFACT_REF_PATTERN.test(encoded)) {
    throw new ArtifactStateStoreContractError(
      "Public last_result:artifact:N refs are forbidden by the artifact state-store contract.",
      "ARTIFACT_INVALID",
    );
  }
  return true;
}

function validateEnvelopeShape(input, errors) {
  if (!isPlainObject(input)) {
    errors.push("Artifact envelope must be an object.");
    return;
  }
  requireExactObjectFields(input, ENVELOPE_FIELDS, "artifact envelope", errors);
  if (input.contract !== ARTIFACT_STATE_STORE_CONTRACT) {
    errors.push(`contract must be ${ARTIFACT_STATE_STORE_CONTRACT}.`);
  }

  let parsedRef = null;
  try {
    parsedRef = parseArtifactRef(input.ref);
  } catch (error) {
    errors.push(error.message);
  }

  if (parsedRef) {
    if (input.id !== parsedRef.id) errors.push("id must match artifact ref id.");
    if (input.owner_pack !== parsedRef.owner_pack) errors.push("owner_pack must match artifact ref owner_pack.");
    if (input.scope !== parsedRef.scope) errors.push("scope must match artifact ref scope.");
  } else {
    if (!isValidArtifactOwnerPack(input.owner_pack)) errors.push(`Invalid artifact owner_pack: ${String(input.owner_pack)}.`);
    if (!isValidArtifactScope(input.scope)) errors.push(`Invalid artifact scope: ${String(input.scope)}.`);
    if (!isValidArtifactId(input.id)) errors.push(`Invalid artifact id: ${String(input.id)}.`);
  }

  validateSchema(input.schema, errors);
  validateProducer(input.producer, input.owner_pack, errors);
  validateCreatedAt(input.created_at, errors);
  validateJsonObject(input.summary, "summary", errors);
  validateJsonObject(input.payload, "payload", errors);
  assertJsonBudget("summary", input.summary, ARTIFACT_STATE_STORE_BUDGETS.summary_max_bytes, errors);
  assertJsonBudget("payload", input.payload, ARTIFACT_STATE_STORE_BUDGETS.payload_max_bytes, errors);
  assertNoPublicLastResultString(input.summary, "summary", errors);
  assertNoPublicLastResultString(input.payload, "payload", errors);
}

function validateSchema(schema, errors) {
  if (typeof schema !== "string" || schema.trim() === "") {
    errors.push("schema must be a non-empty string.");
    return;
  }
  if (schema.length > ARTIFACT_STATE_STORE_BUDGETS.schema_max_chars) {
    errors.push(`schema exceeds ${ARTIFACT_STATE_STORE_BUDGETS.schema_max_chars} characters.`);
  }
  if (!ARTIFACT_SCHEMA_PATTERN.test(schema)) {
    errors.push("schema must use dotted lower-snake grammar with a vN suffix.");
  }
}

function validateProducer(producer, ownerPack, errors) {
  if (!isPlainObject(producer)) {
    errors.push("producer must be an object.");
    return;
  }
  requireExactObjectFields(producer, PRODUCER_FIELDS, "producer", errors);
  if (producer.kind !== "template") errors.push("producer.kind must be template.");
  if (!isValidArtifactOwnerPack(producer.pack)) {
    errors.push(`Invalid producer.pack: ${String(producer.pack)}.`);
  }
  if (isWorkflowShapedArtifactId(producer.pack)) {
    errors.push(`Workflow-shaped producer.pack is forbidden: ${producer.pack}.`);
  }
  if (ownerPack !== undefined && producer.pack !== ownerPack) {
    errors.push("producer.pack must match artifact owner_pack.");
  }
  if (typeof producer.id !== "string" || producer.id.trim() === "") {
    errors.push("producer.id must be a non-empty string.");
  } else {
    const match = producer.id.match(ARTIFACT_PRODUCER_TEMPLATE_ID_PATTERN);
    if (!match) {
      errors.push("producer.id must match template.<pack>.<lower_snake_segments>.");
    } else if (producer.pack && match[1] !== producer.pack) {
      errors.push("producer.id pack segment must match producer.pack.");
    }
  }
  assertJsonBudget("producer", producer, ARTIFACT_STATE_STORE_BUDGETS.producer_max_bytes, errors);
}

function validateCreatedAt(createdAt, errors) {
  if (typeof createdAt !== "string" || createdAt.trim() === "") {
    errors.push("created_at must be a non-empty string.");
    return;
  }
  const timestamp = Date.parse(createdAt);
  if (!Number.isFinite(timestamp) || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(createdAt)) {
    errors.push("created_at must be an ISO-8601 UTC millisecond timestamp.");
  }
}

function validateJsonObject(value, label, errors) {
  if (!isPlainObject(value)) {
    errors.push(`${label} must be a JSON object.`);
    return;
  }
  assertJsonValue(value, label, errors);
}

function assertJsonValue(value, label, errors, seen = new Set()) {
  if (value === null) return;
  const type = typeof value;
  if (type === "string" || type === "boolean") return;
  if (type === "number") {
    if (!Number.isFinite(value)) errors.push(`${label} must not contain non-finite numbers.`);
    return;
  }
  if (type !== "object") {
    errors.push(`${label} must contain only JSON values.`);
    return;
  }
  if (!Array.isArray(value) && !isPlainObject(value)) {
    errors.push(`${label} must contain only JSON arrays or plain objects.`);
    return;
  }
  if (seen.has(value)) {
    errors.push(`${label} must not contain cycles.`);
    return;
  }
  seen.add(value);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => assertJsonValue(entry, `${label}[${index}]`, errors, seen));
  } else {
    for (const [key, entry] of Object.entries(value)) {
      if (typeof key !== "string" || key === "") errors.push(`${label} object keys must be non-empty strings.`);
      assertJsonValue(entry, `${label}.${key}`, errors, seen);
    }
  }
  seen.delete(value);
}

function assertJsonBudget(label, value, maxBytes, errors) {
  let bytes;
  try {
    bytes = encodedBytes(value);
  } catch (error) {
    errors.push(`${label} could not be encoded as JSON: ${error.message}.`);
    return;
  }
  if (bytes > maxBytes) {
    errors.push(`${label} exceeds ${maxBytes} bytes.`);
  }
}

function assertNoPublicLastResultString(value, label, errors) {
  try {
    assertNoPublicArtifactLastResultRefs(value);
  } catch (error) {
    errors.push(`${label} contains forbidden public last_result:artifact:N refs.`);
  }
}

function assertCanonicalRefInput(ref) {
  if (typeof ref !== "string" || ref.trim() === "") {
    throw new ArtifactStateStoreContractError("Artifact ref must be a non-empty string.", "PARAMS_INVALID");
  }
  if (ref.includes("\0")) {
    throw new ArtifactStateStoreContractError("Artifact ref must not contain NUL bytes.", "PARAMS_INVALID", { ref });
  }
  if (ref.startsWith("file://")) {
    throw new ArtifactStateStoreContractError("Artifact ref must not be a file:// URL.", "PARAMS_INVALID", { ref });
  }
  if (isAbsolutePath(ref)) {
    throw new ArtifactStateStoreContractError("Artifact ref must not be an absolute path.", "PARAMS_INVALID", { ref });
  }
  if (ref.includes("/") || ref.includes("\\") || ref.startsWith("~")) {
    throw new ArtifactStateStoreContractError("Artifact ref must not be a raw or relative path.", "PARAMS_INVALID", {
      ref,
    });
  }
  if (!ref.startsWith(`${ARTIFACT_REF_PREFIX}:`)) {
    throw new ArtifactStateStoreContractError("Artifact ref must start with artifact:.", "PARAMS_INVALID", { ref });
  }
}

function normalizeArtifactRoot(artifactRoot) {
  if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") {
    throw new ArtifactStateStoreContractError("artifactRoot must be a non-empty string.", "PARAMS_INVALID");
  }
  if (artifactRoot.startsWith("file://")) {
    throw new ArtifactStateStoreContractError("artifactRoot must be a filesystem path, not a file:// URL.", "PARAMS_INVALID");
  }
  if (!isAbsolutePath(artifactRoot)) {
    throw new ArtifactStateStoreContractError("artifactRoot must be an absolute path.", "PARAMS_INVALID", {
      artifactRoot,
    });
  }
  return path.resolve(artifactRoot);
}

function assertPathInsideArtifactRoot(root, fullPath) {
  const relative = path.relative(root, fullPath);
  if (relative === "" || relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new ArtifactStateStoreContractError("Artifact path escaped artifact root.", "PARAMS_INVALID");
  }
  const segments = relative.split(path.sep);
  if (segments.length !== ARTIFACT_STATE_STORE_TTL_POLICY.sweep_depth) {
    throw new ArtifactStateStoreContractError("Artifact path must use owner_pack/scope/id.json layout.", "PARAMS_INVALID");
  }
}

function normalizeReadBudget(budget = {}) {
  if (!isPlainObject(budget)) {
    throw new ArtifactStateStoreContractError("budget must be an object.", "PARAMS_INVALID");
  }
  const maxResponseBytes = budget.max_response_bytes ?? ARTIFACT_STATE_STORE_BUDGETS.read_response_max_bytes;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new ArtifactStateStoreContractError("budget.max_response_bytes must be a positive integer.", "PARAMS_INVALID");
  }
  return { max_response_bytes: maxResponseBytes };
}

function projectedByteLengthWithResponseBytes(projected) {
  let responseBytes = encodedBytes(projected);
  for (let index = 0; index < 4; index += 1) {
    projected.artifact.response_bytes = responseBytes;
    const nextBytes = encodedBytes(projected);
    if (nextBytes === responseBytes) return responseBytes;
    responseBytes = nextBytes;
  }
  return responseBytes;
}

function inferEnvelopeErrorCode(errors) {
  return errors.some((error) => /exceeds|response/i.test(error)) ? "RESPONSE_TOO_LARGE" : "ARTIFACT_INVALID";
}

function requireExactObjectFields(input, fields, label, errors) {
  const allowed = new Set(fields);
  for (const field of fields) {
    if (!Object.hasOwn(input, field)) errors.push(`Missing required ${label} field: ${field}.`);
  }
  for (const key of Object.keys(input)) {
    if (!allowed.has(key)) errors.push(`Unknown ${label} field: ${key}.`);
  }
}

function sweepKeep(reason, message) {
  return deepFreeze({
    ok: false,
    action: "keep",
    reason,
    message,
  });
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isAbsolutePath(value) {
  return path.isAbsolute(value);
}

function encodedBytes(value) {
  return Buffer.byteLength(safeStringify(value), "utf8");
}

function safeStringify(value) {
  return JSON.stringify(value);
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object") return value;
  Object.freeze(value);
  for (const child of Object.values(value)) {
    if (child && typeof child === "object" && !Object.isFrozen(child)) {
      deepFreeze(child);
    }
  }
  return value;
}
