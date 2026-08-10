import { randomUUID } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  parseAlpha3_2B3ExpectedIdentity,
} from "./alpha3-2b3-runtime-doctor-readiness-v1.mjs";

export const ALPHA3_2C1_CALL_CONTEXT_CONTRACT = "alpha3.2.c1.call_context.v1";
export const ALPHA3_2C1_DEFAULT_BRIDGE_OWNER = "openreaper-alpha";
export const ALPHA3_2C1_DEFAULT_BRIDGE_GENERATION = 1;
export const ALPHA3_2C1_DEFAULT_CLIENT_ID = "openreaper-mcp";
export const ALPHA3_2C1_MAX_REQUEST_SEQUENCE = 999;

const LOGICAL_HINT_FIELDS = new Set([
  "client_id",
  "created_at",
  "expected_generation",
  "expected_owner",
  "request_sequence",
  "session_id",
]);
const TEXT_MAX_BYTES = 256;

export class Alpha3_2C1CallContextError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = "Alpha3_2C1CallContextError";
    this.code = code;
    this.details = details;
  }
}

export function createAlpha3_2C1CallContextManager(options = {}) {
  const env = options.env ?? process.env;
  const identity = normalizeInstalledIdentity(env);
  const identityScope = new AsyncLocalStorage();
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const sessionIdFactory = typeof options.sessionIdFactory === "function"
    ? options.sessionIdFactory
    : ({ index }) => `openreaper-mcp-${index}-${randomUUID()}`;

  let sessionIndex = 0;
  let sessionId = createSessionId();
  let requestSequence = 0;
  const lastCreatedAtMsBySequence = new Map();

  function createSessionId() {
    sessionIndex += 1;
    const candidate = sessionIdFactory({ index: sessionIndex });
    return normalizeTextHint(candidate, "server session_id", {
      code: "CALL_TEMPLATE_SERVER_SESSION_INVALID",
    });
  }

  function rotateSession() {
    sessionId = createSessionId();
    requestSequence = 0;
  }

  function allocate(contextHint, identityOverride) {
    const effectiveIdentity = normalizeAuthoritativeIdentity(
      identityOverride ?? identityScope.getStore() ?? identity,
      identity.owner,
    );
    const hint = normalizeContextHint(contextHint, effectiveIdentity);
    if (requestSequence >= ALPHA3_2C1_MAX_REQUEST_SEQUENCE) rotateSession();

    // Allocation is deliberately synchronous. The stdio handler calls this before
    // its first await so concurrent dispatches cannot share a sequence.
    requestSequence += 1;
    const sequence = requestSequence;
    const createdAt = allocateCreatedAt(now, sequence, lastCreatedAtMsBySequence);

    return Object.freeze({
      client_id: hint.client_id ?? ALPHA3_2C1_DEFAULT_CLIENT_ID,
      session_id: sessionId,
      expected_owner: effectiveIdentity.owner,
      expected_generation: effectiveIdentity.generation,
      created_at: createdAt,
      request_sequence: sequence,
    });
  }

  return Object.freeze({
    contract: ALPHA3_2C1_CALL_CONTEXT_CONTRACT,
    identity: Object.freeze({ ...identity }),
    allocate,
    currentIdentity() {
      return identityScope.getStore() ?? identity;
    },
    runWithIdentity(authoritativeIdentity, callback) {
      if (typeof callback !== "function") throw new TypeError("call context identity scope requires a callback");
      const effectiveIdentity = normalizeAuthoritativeIdentity(authoritativeIdentity, identity.owner);
      return identityScope.run(effectiveIdentity, callback);
    },
    snapshot() {
      return Object.freeze({
        session_index: sessionIndex,
        session_id: sessionId,
        last_request_sequence: requestSequence,
      });
    },
  });
}

function normalizeAuthoritativeIdentity(value, installedOwner) {
  if (!isPlainObject(value)) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_BRIDGE_IDENTITY_INVALID",
      "Authoritative Bridge identity must be an object.",
    );
  }
  const owner = normalizeTextHint(value.owner, "authoritative bridge owner", {
    code: "CALL_TEMPLATE_BRIDGE_IDENTITY_INVALID",
  });
  if (owner !== installedOwner) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_BRIDGE_OWNER_MISMATCH",
      "Observed Bridge owner does not match the installed OpenReaper owner.",
      { installed: installedOwner, observed: owner },
    );
  }
  const generation = normalizeGenerationHint(value.generation);
  if (generation < 1) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_BRIDGE_IDENTITY_INVALID",
      "Authoritative Bridge generation must be a positive safe integer.",
      { field: "generation" },
    );
  }
  return Object.freeze({ owner, generation });
}

function normalizeInstalledIdentity(env) {
  const parsed = parseAlpha3_2B3ExpectedIdentity(env);
  if (parsed.owner.present && !parsed.owner.valid) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_BRIDGE_IDENTITY_ENV_INVALID",
      "OPENREAPER_LIVE_BRIDGE_OWNER is invalid; call_template context allocation is disabled.",
      { field: "OPENREAPER_LIVE_BRIDGE_OWNER" },
    );
  }
  if (parsed.generation.present && !parsed.generation.valid) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_BRIDGE_IDENTITY_ENV_INVALID",
      "OPENREAPER_LIVE_BRIDGE_GENERATION is invalid; call_template context allocation is disabled.",
      { field: "OPENREAPER_LIVE_BRIDGE_GENERATION" },
    );
  }
  return Object.freeze({
    owner: parsed.owner.present ? parsed.owner.value : ALPHA3_2C1_DEFAULT_BRIDGE_OWNER,
    generation: parsed.generation.present
      ? parsed.generation.value
      : ALPHA3_2C1_DEFAULT_BRIDGE_GENERATION,
  });
}

function normalizeContextHint(value, identity) {
  if (value === undefined) return {};
  if (!isPlainObject(value)) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_CONTEXT_HINT_INVALID",
      "call_template context must be omitted or be an object of logical identity hints.",
    );
  }

  const unknownFields = Object.keys(value).filter((field) => !LOGICAL_HINT_FIELDS.has(field));
  if (unknownFields.length > 0) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_CONTEXT_HINT_INVALID",
      "call_template context contains unsupported fields; request sequence and timestamps are server-managed.",
      { fields: unknownFields.sort() },
    );
  }

  if (Object.hasOwn(value, "expected_owner")) {
    const expectedOwner = normalizeTextHint(value.expected_owner, "context.expected_owner");
    if (expectedOwner !== identity.owner) {
      throw identityConflict("expected_owner", identity.owner, expectedOwner);
    }
  }

  if (Object.hasOwn(value, "expected_generation")) {
    const expectedGeneration = value.expected_generation === "current"
      ? identity.generation
      : normalizeGenerationHint(value.expected_generation);
    if (expectedGeneration !== identity.generation) {
      throw identityConflict("expected_generation", identity.generation, expectedGeneration);
    }
  }

  if (Object.hasOwn(value, "session_id")) {
    // Accepted only as a compatibility/logical hint. The final session_id below
    // remains generated and rotated by the server.
    normalizeTextHint(value.session_id, "context.session_id");
  }

  return {
    client_id: Object.hasOwn(value, "client_id")
      ? normalizeTextHint(value.client_id, "context.client_id")
      : undefined,
  };
}

function identityConflict(field, installed, provided) {
  return new Alpha3_2C1CallContextError(
    "CALL_TEMPLATE_BRIDGE_IDENTITY_CONFLICT",
    `context.${field} conflicts with the installed bridge identity.`,
    { field, installed, provided },
  );
}

function normalizeGenerationHint(value) {
  if (Number.isSafeInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(?:0|[1-9][0-9]*)$/u.test(value)) {
    const parsed = Number(value);
    if (Number.isSafeInteger(parsed)) return parsed;
  }
  throw new Alpha3_2C1CallContextError(
    "CALL_TEMPLATE_CONTEXT_HINT_INVALID",
    "context.expected_generation must be a non-negative safe integer or the logical hint 'current'.",
    { field: "expected_generation" },
  );
}

function normalizeTextHint(value, field, options = {}) {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > TEXT_MAX_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    throw new Alpha3_2C1CallContextError(
      options.code ?? "CALL_TEMPLATE_CONTEXT_HINT_INVALID",
      `${field} must be a non-empty control-free string of at most ${TEXT_MAX_BYTES} UTF-8 bytes.`,
      { field },
    );
  }
  return value;
}

function allocateCreatedAt(now, sequence, lastCreatedAtMsBySequence) {
  const raw = now();
  const date = raw instanceof Date ? new Date(raw.getTime()) : new Date(raw);
  if (Number.isNaN(date.getTime())) {
    throw new Alpha3_2C1CallContextError(
      "CALL_TEMPLATE_SERVER_CLOCK_INVALID",
      "The server clock did not produce a valid request timestamp.",
    );
  }

  let milliseconds = date.getTime();
  const previous = lastCreatedAtMsBySequence.get(sequence);
  if (previous !== undefined && milliseconds <= previous) milliseconds = previous + 1;
  lastCreatedAtMsBySequence.set(sequence, milliseconds);
  return new Date(milliseconds).toISOString();
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
