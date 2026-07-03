import { readFile } from "node:fs/promises";
import {
  ARTIFACT_LAST_RESULT_POLICY,
  ARTIFACT_READ_VIEWS,
  ARTIFACT_STATE_STORE_BUDGETS,
  ArtifactStateStoreContractError,
  artifactPathFromRef,
  parseArtifactRef,
  projectArtifactRead,
} from "../../core/src/artifact-state-store-v1.mjs";

export const GET_STATE_RUNTIME_CONTRACT = "get_state.runtime.v1";
export const GET_STATE_ARTIFACT_SCOPE = "artifact";

export const GET_STATE_ARTIFACT_ALLOWED_REQUEST_FIELDS = Object.freeze([
  "scope",
  "artifact_ref",
  "view",
  "budget",
]);

export const GET_STATE_ARTIFACT_ERROR_CODES = Object.freeze([
  "PARAMS_INVALID",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_INVALID",
  "RESPONSE_TOO_LARGE",
]);

const ERROR_CODE_SET = new Set(GET_STATE_ARTIFACT_ERROR_CODES);
const READ_VIEW_SET = new Set(ARTIFACT_READ_VIEWS);
const REQUEST_FIELD_SET = new Set(GET_STATE_ARTIFACT_ALLOWED_REQUEST_FIELDS);

export class GetStateArtifactProjectionError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "GetStateArtifactProjectionError";
    this.code = ERROR_CODE_SET.has(code) ? code : "ARTIFACT_INVALID";
    this.recoverable = options.recoverable ?? true;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function createGetStateArtifactRuntime(options = {}) {
  const artifactStore =
    options.artifactStore ??
    options.store ??
    (options.artifactRoot ? createFilesystemArtifactStore({ artifactRoot: options.artifactRoot }) : null);
  const store = normalizeArtifactStore(artifactStore);
  const now = typeof options.now === "function" ? options.now : () => new Date();

  return Object.freeze({
    contract: GET_STATE_RUNTIME_CONTRACT,
    scope: GET_STATE_ARTIFACT_SCOPE,
    async get_state(request = {}) {
      return getStateArtifactProjection(request, { artifactStore: store, now });
    },
  });
}

export async function getStateArtifactProjection(request = {}, options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const budget = safeBudget(request?.budget);

  try {
    const normalized = normalizeGetStateArtifactRequest(request);
    const store = normalizeArtifactStore(options.artifactStore ?? options.store);
    const envelope = await readArtifactEnvelope(store, normalized.artifact_ref, normalized.parts);
    const projection = projectArtifactRead(envelope, {
      view: normalized.view,
      budget: { max_response_bytes: normalized.budget.max_response_bytes },
    });
    return finalizeGetStateSuccessEnvelope({
      projection,
      request: normalized,
      now,
    });
  } catch (error) {
    return finalizeGetStateErrorEnvelope({
      error,
      scope: safeScope(request),
      budget,
      now,
    });
  }
}

export function createFilesystemArtifactStore({ artifactRoot } = {}) {
  if (typeof artifactRoot !== "string" || artifactRoot.trim() === "") {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "artifactRoot is required for filesystem artifact reads.",
    );
  }

  return Object.freeze({
    async read(ref) {
      let artifactPath;
      try {
        artifactPath = artifactPathFromRef(artifactRoot, ref);
      } catch (error) {
        throw mapArtifactContractError(error);
      }

      try {
        return await readFile(artifactPath, "utf8");
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw new GetStateArtifactProjectionError(
            "ARTIFACT_NOT_FOUND",
            "Artifact was not found in the configured artifact store.",
            { details: { ref } },
          );
        }
        throw new GetStateArtifactProjectionError(
          "ARTIFACT_INVALID",
          "Artifact could not be read from the configured artifact store.",
          { recoverable: false },
        );
      }
    },
  });
}

function normalizeGetStateArtifactRequest(request) {
  if (!isPlainObject(request)) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "get_state artifact request must be a JSON object.",
    );
  }

  const unknownFields = Object.keys(request).filter((field) => !REQUEST_FIELD_SET.has(field));
  if (unknownFields.length > 0) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "get_state artifact request contains fields outside the Layer 4.5B shape.",
      {
        details: {
          allowed_fields: GET_STATE_ARTIFACT_ALLOWED_REQUEST_FIELDS,
          fields: boundedStrings(unknownFields),
        },
      },
    );
  }

  if (request.scope !== GET_STATE_ARTIFACT_SCOPE) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "Layer 4.5B binds only get_state scope artifact.",
      { details: { scope: boundedString(request.scope) } },
    );
  }

  if (typeof request.artifact_ref !== "string" || request.artifact_ref.trim() === "") {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "artifact_ref is required for get_state artifact reads.",
    );
  }

  let parts;
  try {
    parts = parseArtifactRef(request.artifact_ref);
  } catch (error) {
    const message = error instanceof Error
      ? error.message
      : "artifact_ref must be a canonical artifact ref.";
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      message,
      { details: { field: "artifact_ref" } },
    );
  }

  const view = request.view ?? "summary";
  if (!READ_VIEW_SET.has(view)) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "get_state artifact view must be summary or payload.",
      { details: { view: boundedString(view) } },
    );
  }

  return deepFreeze({
    scope: GET_STATE_ARTIFACT_SCOPE,
    artifact_ref: request.artifact_ref,
    parts,
    view,
    budget: normalizeBudget(request.budget),
  });
}

async function readArtifactEnvelope(store, ref, parts) {
  let rawArtifact;
  try {
    rawArtifact = await store.read(ref, parts);
  } catch (error) {
    throw mapStoreError(error);
  }

  if (rawArtifact === null || rawArtifact === undefined) {
    throw new GetStateArtifactProjectionError(
      "ARTIFACT_NOT_FOUND",
      "Artifact was not found in the configured artifact store.",
      { details: { ref } },
    );
  }

  if (Buffer.isBuffer(rawArtifact)) {
    rawArtifact = rawArtifact.toString("utf8");
  }

  if (typeof rawArtifact === "string") {
    try {
      return JSON.parse(rawArtifact);
    } catch {
      throw new GetStateArtifactProjectionError(
        "ARTIFACT_INVALID",
        "Artifact JSON could not be parsed.",
      );
    }
  }

  if (!isPlainObject(rawArtifact)) {
    throw new GetStateArtifactProjectionError(
      "ARTIFACT_INVALID",
      "Artifact store returned a non-object artifact envelope.",
    );
  }

  return rawArtifact;
}

function finalizeGetStateSuccessEnvelope({ projection, request, now }) {
  const budget = request.budget;
  const envelope = {
    contract: GET_STATE_RUNTIME_CONTRACT,
    ok: true,
    scope: GET_STATE_ARTIFACT_SCOPE,
    request: {
      scope: GET_STATE_ARTIFACT_SCOPE,
      artifact_ref: request.artifact_ref,
      view: request.view,
    },
    completed_at: safeNowIso(now),
    result: cloneJson(projection),
    last_result: lastResultUnchanged(),
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
  };

  const finalized = finalizeResponseBytes(envelope);
  if (finalized.budget.response_bytes > budget.max_response_bytes) {
    return finalizeGetStateErrorEnvelope({
      error: new GetStateArtifactProjectionError(
        "RESPONSE_TOO_LARGE",
        "get_state artifact response exceeds max_response_bytes.",
        {
          details: {
            response_bytes: finalized.budget.response_bytes,
            max_response_bytes: budget.max_response_bytes,
            view: request.view,
          },
        },
      ),
      scope: GET_STATE_ARTIFACT_SCOPE,
      budget,
      now,
    });
  }

  return deepFreeze(finalized);
}

function finalizeGetStateErrorEnvelope({ error, scope, budget, now }) {
  const normalized = normalizeProjectionError(error);
  const envelope = {
    contract: GET_STATE_RUNTIME_CONTRACT,
    ok: false,
    scope,
    request: null,
    completed_at: safeNowIso(now),
    error: pruneUndefined({
      source: "artifact_state_store",
      code: normalized.code,
      message: normalized.message,
      recoverable: normalized.recoverable,
      details: normalized.details,
    }),
    last_result: lastResultUnchanged(),
    budget: {
      max_response_bytes: budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
  };

  return deepFreeze(finalizeResponseBytes(envelope));
}

function normalizeProjectionError(error) {
  if (error instanceof GetStateArtifactProjectionError) {
    return {
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      details: error.details,
    };
  }

  if (error instanceof ArtifactStateStoreContractError) {
    const mapped = mapArtifactContractError(error);
    return {
      code: mapped.code,
      message: mapped.message,
      recoverable: mapped.recoverable,
      details: mapped.details,
    };
  }

  return {
    code: "ARTIFACT_INVALID",
    message: error instanceof Error ? error.message : "Artifact projection failed.",
    recoverable: false,
  };
}

function mapStoreError(error) {
  if (error instanceof GetStateArtifactProjectionError) return error;
  if (error instanceof ArtifactStateStoreContractError) return mapArtifactContractError(error);
  if (ERROR_CODE_SET.has(error?.code)) {
    return new GetStateArtifactProjectionError(error.code, error.message ?? "Artifact store read failed.", {
      recoverable: error.recoverable ?? true,
      details: error.details,
    });
  }
  return new GetStateArtifactProjectionError(
    "ARTIFACT_INVALID",
    error instanceof Error ? error.message : "Artifact store read failed.",
    { recoverable: false },
  );
}

function mapArtifactContractError(error) {
  if (error instanceof ArtifactStateStoreContractError) {
    return new GetStateArtifactProjectionError(error.code, error.message, {
      recoverable: true,
      details: sanitizeArtifactErrorDetails(error.details),
    });
  }
  return error;
}

function sanitizeArtifactErrorDetails(details) {
  if (!isPlainObject(details)) return undefined;
  const sanitized = { ...details };
  if (Object.hasOwn(sanitized, "ref")) sanitized.ref = "[artifact_ref_rejected]";
  return sanitized;
}

function normalizeArtifactStore(store) {
  if (typeof store === "function") {
    return Object.freeze({
      read: store,
    });
  }
  if (store && typeof store.read === "function") return store;
  throw new GetStateArtifactProjectionError(
    "PARAMS_INVALID",
    "get_state artifact projection requires an artifact store.",
  );
}

function normalizeBudget(budget = {}) {
  if (!isPlainObject(budget)) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "budget must be a JSON object when provided.",
    );
  }
  const maxResponseBytes = budget.max_response_bytes ?? ARTIFACT_STATE_STORE_BUDGETS.read_response_max_bytes;
  if (!Number.isInteger(maxResponseBytes) || maxResponseBytes < 1) {
    throw new GetStateArtifactProjectionError(
      "PARAMS_INVALID",
      "budget.max_response_bytes must be a positive integer.",
    );
  }
  return deepFreeze({ max_response_bytes: maxResponseBytes });
}

function safeBudget(input) {
  try {
    return normalizeBudget(input);
  } catch {
    return { max_response_bytes: ARTIFACT_STATE_STORE_BUDGETS.read_response_max_bytes };
  }
}

function safeScope(request) {
  return isPlainObject(request) && typeof request.scope === "string"
    ? boundedString(request.scope)
    : GET_STATE_ARTIFACT_SCOPE;
}

function lastResultUnchanged() {
  return {
    updated: ARTIFACT_LAST_RESULT_POLICY.reads_update_last_result,
    refs: [],
    truncated: false,
  };
}

function finalizeResponseBytes(envelope) {
  const finalized = envelope;
  let responseBytes = encodedBytes(finalized);
  for (let index = 0; index < 4; index += 1) {
    finalized.budget.response_bytes = responseBytes;
    const nextBytes = encodedBytes(finalized);
    if (nextBytes === responseBytes) return finalized;
    responseBytes = nextBytes;
  }
  finalized.budget.response_bytes = responseBytes;
  return finalized;
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function boundedStrings(values) {
  return values.map((value) => boundedString(value));
}

function boundedString(value, maxChars = 160) {
  if (typeof value !== "string") return value === undefined ? null : String(value).slice(0, maxChars);
  return value.length <= maxChars ? value : `${value.slice(0, maxChars)}...`;
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) deepFreeze(entry);
  return value;
}
