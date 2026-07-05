import { createHash } from "node:crypto";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  FOUNDATION_BRIDGE_ERROR_CODES,
  FOUNDATION_BRIDGE_REF_KINDS,
  createObjectRef,
  normalizeFoundationBridgeRequest,
  validateFoundationBridgeResult,
} from "./foundation-bridge-v1.mjs";
import {
  TemplateDescriptorValidationError,
  normalizeTemplateDescriptor,
} from "./template-descriptor-v1.mjs";

export const TEMPLATE_EXECUTION_HARNESS_CONTRACT = "template.execution.v1";

export const TEMPLATE_EXECUTION_HARNESS_DEFAULT_CLIENT_ID = "openreaper-mcp";

export const TEMPLATE_EXECUTION_HARNESS_ERROR_CODES = Object.freeze([
  "TEMPLATE_DESCRIPTOR_INVALID",
  "TEMPLATE_INPUT_INVALID",
  "TEMPLATE_CONTEXT_INVALID",
  "TEMPLATE_REFS_INVALID",
  "TEMPLATE_IDEMPOTENCY_INVALID",
  "TEMPLATE_EXECUTOR_INVALID",
  "BRIDGE_RESULT_INVALID",
  "RESPONSE_TOO_LARGE",
  ...FOUNDATION_BRIDGE_ERROR_CODES,
]);

const HARNESS_ERROR_CODE_SET = new Set(TEMPLATE_EXECUTION_HARNESS_ERROR_CODES);
const BRIDGE_ERROR_CODE_SET = new Set(FOUNDATION_BRIDGE_ERROR_CODES);
const REF_KIND_SET = new Set(FOUNDATION_BRIDGE_REF_KINDS);
const READ_OPERATION_FAMILIES = new Set(["query_state", "artifact_metadata"]);
const IDEMPOTENCY_OPERATION_FAMILIES = new Set(["run_command", "run_action", "run_job"]);
const UNDO_OPERATION_FAMILIES = new Set(["run_command", "run_action", "run_job"]);
const PRINTABLE_IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7e]{1,128}$/;

export class TemplateExecutionHarnessError extends Error {
  constructor(code, message, options = {}) {
    super(message);
    this.name = "TemplateExecutionHarnessError";
    this.code = HARNESS_ERROR_CODE_SET.has(code) ? code : "TEMPLATE_EXECUTOR_INVALID";
    this.recoverable = options.recoverable ?? true;
    if (options.details !== undefined) this.details = options.details;
  }
}

export function buildTemplateBridgeRequest(options = {}) {
  return prepareTemplateExecution(options).request;
}

export async function executeTemplate(options = {}) {
  let prepared;
  try {
    prepared = prepareTemplateExecution(options);
    const dispatch = resolveExecutor(options.executor);
    const bridgeResult = await dispatch(prepared.request);
    validateBridgeResult(prepared.request, bridgeResult);
    return mapBridgeResult(prepared, bridgeResult);
  } catch (error) {
    return templateErrorEnvelope({
      prepared,
      descriptor: options.descriptor,
      context: options.context,
      budget: options.budget,
      error,
    });
  }
}

export function validateTemplateInput(input, schema) {
  const errors = [];
  if (!isPlainObject(input)) {
    errors.push("input must be a JSON object.");
    throw inputValidationError(errors);
  }

  const propertyNames = new Set(Object.keys(schema.properties));
  for (const required of schema.required) {
    if (!Object.hasOwn(input, required)) {
      errors.push(`input.${required} is required.`);
    }
  }

  for (const key of Object.keys(input)) {
    if (!propertyNames.has(key)) {
      errors.push(`input.${key} is not declared by inputSchema.`);
      continue;
    }
    const propertyErrors = validatePropertyValue(input[key], schema.properties[key], `input.${key}`);
    errors.push(...propertyErrors);
  }

  if (errors.length > 0) throw inputValidationError(errors);
  return cloneJson(input);
}

function prepareTemplateExecution(options) {
  const descriptor = normalizeDescriptor(options.descriptor);
  const input = validateTemplateInput(options.input ?? {}, descriptor.inputSchema);
  const context = normalizeExecutionContext(options.context);
  const refs = normalizeExecutionRefs(options.refs ?? [], descriptor.refs);
  const budget = normalizeBudget(options.budget);
  const idempotencyKey = resolveIdempotencyKey({
    descriptor,
    input,
    refs,
    context,
    provided: options.idempotencyKey ?? options.idempotency_key,
  });
  const requestId =
    options.requestId ??
    options.request_id ??
    createTemplateBridgeRequestId({
      descriptor,
      input,
      refs,
      context,
      idempotencyKey,
    });

  const request = normalizeFoundationBridgeRequest({
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: requestId,
    created_at: context.created_at,
    client: {
      id: context.client_id,
      session_id: context.session_id,
    },
    bridge: {
      expected_owner: context.expected_owner,
      expected_generation: context.expected_generation,
    },
    operation: {
      family: descriptor.bridge.operation_family,
      name: descriptor.bridge.operation_name,
    },
    pack: {
      id: descriptor.pack,
      capability: descriptor.bridge.capability,
      risk: descriptor.risk,
    },
    params: input,
    refs,
    undo: undoPolicyForDescriptor(descriptor),
    verification: cloneJson(descriptor.verification),
    artifacts: {
      allow: descriptor.artifacts.mode !== "none",
    },
    budget,
    ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
    timeout_ms: descriptor.bridge.timeout_ms,
  });

  return deepFreeze({
    descriptor,
    input,
    context,
    refs,
    budget,
    request,
  });
}

function normalizeDescriptor(input) {
  try {
    return normalizeTemplateDescriptor(input);
  } catch (error) {
    if (error instanceof TemplateDescriptorValidationError) {
      throw new TemplateExecutionHarnessError(
        "TEMPLATE_DESCRIPTOR_INVALID",
        "Template descriptor failed validation.",
        {
          recoverable: false,
          details: { errors: error.errors },
        },
      );
    }
    throw error;
  }
}

function normalizeExecutionContext(context) {
  if (!isPlainObject(context)) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_CONTEXT_INVALID",
      "Template execution context must be an object.",
      { recoverable: true },
    );
  }

  const client = isPlainObject(context.client) ? context.client : {};
  const bridge = isPlainObject(context.bridge) ? context.bridge : {};
  const createdAt = normalizeCreatedAt(
    context.created_at ??
      context.createdAt ??
      (typeof context.now === "function" ? context.now() : undefined),
  );
  const clientId = client.id ?? context.client_id ?? TEMPLATE_EXECUTION_HARNESS_DEFAULT_CLIENT_ID;
  const sessionId = client.session_id ?? context.session_id;
  const expectedOwner = bridge.expected_owner ?? context.expected_owner ?? context.bridge_owner;
  const expectedGeneration =
    bridge.expected_generation ?? context.expected_generation ?? context.bridge_generation;
  const requestSequence = context.request_sequence ?? context.sequence ?? 1;

  const errors = [];
  if (typeof clientId !== "string" || clientId.trim() === "") {
    errors.push("context.client_id must be a non-empty string.");
  }
  if (typeof sessionId !== "string" || sessionId.trim() === "") {
    errors.push("context.session_id must be a non-empty string.");
  }
  if (typeof expectedOwner !== "string" || expectedOwner.trim() === "") {
    errors.push("context.expected_owner must be a non-empty string.");
  }
  if (!Number.isInteger(expectedGeneration) || expectedGeneration < 0) {
    errors.push("context.expected_generation must be a non-negative integer.");
  }
  if (!Number.isInteger(requestSequence) || requestSequence < 1 || requestSequence > 999) {
    errors.push("context.request_sequence must be an integer from 1 to 999.");
  }
  if (errors.length > 0) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_CONTEXT_INVALID",
      "Template execution context failed validation.",
      {
        recoverable: true,
        details: { errors },
      },
    );
  }

  return deepFreeze({
    client_id: clientId,
    session_id: sessionId,
    expected_owner: expectedOwner,
    expected_generation: expectedGeneration,
    created_at: createdAt,
    request_sequence: requestSequence,
  });
}

function normalizeCreatedAt(value) {
  const raw = value instanceof Date ? value : value === undefined ? new Date() : new Date(value);
  if (Number.isNaN(raw.getTime())) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_CONTEXT_INVALID",
      "context.created_at must be a valid date or ISO timestamp.",
      { recoverable: true },
    );
  }
  return raw.toISOString();
}

function normalizeExecutionRefs(refs, declaration) {
  if (Array.isArray(refs)) {
    const errors = validateRefObjects(refs, "refs");
    errors.push(...requiredRefKindErrors(refs, declaration.input));
    if (errors.length > 0) throw refsValidationError(errors);
    return cloneJson(refs);
  }

  if (!isPlainObject(refs)) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_REFS_INVALID",
      "refs must be an array of object refs or an object keyed by descriptor ref name.",
      { recoverable: true },
    );
  }

  const declared = new Map(declaration.input.map((entry) => [entry.name, entry]));
  const errors = [];
  const normalized = [];
  for (const key of Object.keys(refs)) {
    if (!declared.has(key)) {
      errors.push(`refs.${key} is not declared by descriptor.refs.input.`);
    }
  }

  for (const refDeclaration of declaration.input) {
    if (!Object.hasOwn(refs, refDeclaration.name)) {
      if (refDeclaration.required) errors.push(`refs.${refDeclaration.name} is required.`);
      continue;
    }
    const values = Array.isArray(refs[refDeclaration.name])
      ? refs[refDeclaration.name]
      : [refs[refDeclaration.name]];
    for (const value of values) {
      if (!isPlainObject(value)) {
        errors.push(`refs.${refDeclaration.name} must contain object refs.`);
        continue;
      }
      errors.push(...validateRefObject(value, `refs.${refDeclaration.name}`));
      if (value.kind !== refDeclaration.kind) {
        errors.push(`refs.${refDeclaration.name} must be a ${refDeclaration.kind} ref.`);
      }
      normalized.push(value);
    }
  }

  if (errors.length > 0) {
    throw refsValidationError(errors);
  }

  return cloneJson(normalized);
}

function requiredRefKindErrors(refs, declarations) {
  const requiredByKind = new Map();
  for (const declaration of declarations) {
    if (!declaration.required) continue;
    requiredByKind.set(declaration.kind, (requiredByKind.get(declaration.kind) ?? 0) + 1);
  }

  const actualByKind = new Map();
  for (const ref of refs) {
    if (isPlainObject(ref)) actualByKind.set(ref.kind, (actualByKind.get(ref.kind) ?? 0) + 1);
  }

  const errors = [];
  for (const [kind, count] of requiredByKind) {
    if ((actualByKind.get(kind) ?? 0) < count) {
      errors.push(`refs must include at least ${count} required ${kind} ref(s).`);
    }
  }
  return errors;
}

function validateRefObjects(refs, label) {
  const errors = [];
  refs.forEach((ref, index) => {
    if (!isPlainObject(ref)) {
      errors.push(`${label}[${index}] must be an object ref.`);
      return;
    }
    errors.push(...validateRefObject(ref, `${label}[${index}]`));
  });
  return errors;
}

function validateRefObject(ref, label) {
  const errors = [];
  if (typeof ref.kind !== "string" || ref.kind.trim() === "") {
    errors.push(`${label}.kind must be a non-empty string.`);
  } else if (!REF_KIND_SET.has(ref.kind)) {
    errors.push(`${label}.kind is not a frozen ref kind: ${ref.kind}.`);
  }
  if (typeof ref.ref !== "string" || ref.ref.trim() === "") {
    errors.push(`${label}.ref must be a non-empty string.`);
  }
  if (!isPlainObject(ref.identity)) {
    errors.push(`${label}.identity must be an object.`);
  } else {
    if (typeof ref.identity.scheme !== "string" || ref.identity.scheme.trim() === "") {
      errors.push(`${label}.identity.scheme must be a non-empty string.`);
    }
    if (typeof ref.identity.value !== "string" || ref.identity.value.trim() === "") {
      errors.push(`${label}.identity.value must be a non-empty string.`);
    }
  }
  return errors;
}

function refsValidationError(errors) {
  return new TemplateExecutionHarnessError(
    "TEMPLATE_REFS_INVALID",
    "Template refs failed validation.",
    {
      recoverable: true,
      details: { errors },
    },
  );
}

function normalizeBudget(input) {
  const budget = {
    ...FOUNDATION_BRIDGE_DEFAULT_BUDGET,
    ...(input ?? {}),
  };
  const errors = [];
  for (const key of ["max_response_bytes", "max_items", "max_inline_value_bytes"]) {
    if (!Number.isInteger(budget[key]) || budget[key] < 1) {
      errors.push(`budget.${key} must be a positive integer.`);
    }
  }
  if (errors.length > 0) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_CONTEXT_INVALID",
      "Template execution budget failed validation.",
      {
        recoverable: true,
        details: { errors },
      },
    );
  }
  return deepFreeze(budget);
}

function resolveIdempotencyKey({ descriptor, input, refs, context, provided }) {
  const policy = descriptor.bridge.idempotency;
  const allowed =
    descriptor.risk !== "read" &&
    IDEMPOTENCY_OPERATION_FAMILIES.has(descriptor.bridge.operation_family);

  if (policy === "none") {
    if (provided !== undefined) {
      throw new TemplateExecutionHarnessError(
        "TEMPLATE_IDEMPOTENCY_INVALID",
        "Descriptor declares idempotency none; no idempotency key may be supplied.",
        { recoverable: true },
      );
    }
    return undefined;
  }

  if (provided !== undefined) {
    if (!allowed) {
      throw new TemplateExecutionHarnessError(
        "TEMPLATE_IDEMPOTENCY_INVALID",
        "Layer 2 allows idempotency keys only for mutating commands, actions, and jobs.",
        { recoverable: true },
      );
    }
    assertIdempotencyKey(provided);
    return provided;
  }

  if (policy === "required") {
    if (!allowed) {
      throw new TemplateExecutionHarnessError(
        "TEMPLATE_IDEMPOTENCY_INVALID",
        "Descriptor requires idempotency, but the bridge operation cannot carry an idempotency key.",
        { recoverable: false },
      );
    }
    return `template:${shortHash({
      template: descriptor.id,
      input,
      refs,
      bridge: {
        expected_owner: context.expected_owner,
        expected_generation: context.expected_generation,
      },
    }, 24)}`;
  }

  return undefined;
}

function assertIdempotencyKey(key) {
  if (typeof key !== "string" || !PRINTABLE_IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_IDEMPOTENCY_INVALID",
      "idempotency_key must be 1-128 printable ASCII characters.",
      { recoverable: true },
    );
  }
}

function undoPolicyForDescriptor(descriptor) {
  const family = descriptor.bridge.operation_family;
  if (descriptor.risk === "read" || READ_OPERATION_FAMILIES.has(family)) {
    return { mode: "none" };
  }

  if (!UNDO_OPERATION_FAMILIES.has(family)) {
    return { mode: "none" };
  }

  return {
    mode: "required",
    label: `OpenReaper: ${descriptor.bridge.capability}`,
    flags: undoFlagsForDescriptor(descriptor),
  };
}

function undoFlagsForDescriptor(descriptor) {
  const flags = descriptor.expectedDelta.entities
    .map((entity) => entity.entity_kind)
    .filter((entityKind) => typeof entityKind === "string" && entityKind.trim() !== "");
  return [...new Set(flags)];
}

function createTemplateBridgeRequestId({ descriptor, input, refs, context, idempotencyKey }) {
  return [
    "cmd",
    compactUtcTimestamp(context.created_at),
    String(context.request_sequence).padStart(3, "0"),
    shortHash({
      template: descriptor.id,
      input,
      refs,
      idempotency_key: idempotencyKey ?? null,
    }, 6),
  ].join("_");
}

function compactUtcTimestamp(isoTimestamp) {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) {
    throw new TemplateExecutionHarnessError(
      "TEMPLATE_CONTEXT_INVALID",
      "context.created_at must be a valid ISO timestamp.",
      { recoverable: true },
    );
  }
  const year = String(date.getUTCFullYear()).padStart(4, "0");
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");
  const hour = String(date.getUTCHours()).padStart(2, "0");
  const minute = String(date.getUTCMinutes()).padStart(2, "0");
  const second = String(date.getUTCSeconds()).padStart(2, "0");
  const ms = String(date.getUTCMilliseconds()).padStart(3, "0");
  return `${year}${month}${day}${hour}${minute}${second}${ms}`;
}

function resolveExecutor(executor) {
  if (typeof executor === "function") return executor;
  if (executor && typeof executor.dispatch === "function") return executor.dispatch.bind(executor);
  throw new TemplateExecutionHarnessError(
    "TEMPLATE_EXECUTOR_INVALID",
    "executeTemplate requires a fake or real bridge executor with a dispatch function.",
    { recoverable: false },
  );
}

function validateBridgeResult(request, bridgeResult) {
  try {
    validateFoundationBridgeResult(bridgeResult);
  } catch (error) {
    throw new TemplateExecutionHarnessError(
      "BRIDGE_RESULT_INVALID",
      "Bridge executor returned a result outside foundation.bridge.v1.",
      {
        recoverable: false,
        details: { message: error.message },
      },
    );
  }
  if (bridgeResult.id !== request.id) {
    throw new TemplateExecutionHarnessError(
      "BRIDGE_RESULT_INVALID",
      "Bridge executor returned a result for a different request id.",
      {
        recoverable: false,
        details: { expected: request.id, actual: bridgeResult.id },
      },
    );
  }
}

function mapBridgeResult(prepared, bridgeResult) {
  const base = templateEnvelopeBase(prepared, bridgeResult.completed_at, {
    bridge: bridgeResult.bridge,
    queue: bridgeResult.queue,
    undo: bridgeResult.undo,
    verification: bridgeResult.verification,
    idempotency: bridgeResult.idempotency,
    bridgeBudget: bridgeResult.budget,
  });

  if (bridgeResult.ok === false) {
    return finalizeTemplateEnvelope(prepared.budget, {
      ...base,
      ok: false,
      error: typedError({
        source: "bridge",
        code: bridgeResult.error.code,
        message: bridgeResult.error.message,
        recoverable: bridgeResult.error.recoverable,
        details: bridgeResult.error.details,
      }),
    });
  }

  const summary = cloneJson(bridgeResult.result.summary ?? {});
  const readback = cloneJson(bridgeResult.result.readback ?? null);
  const refs = normalizeResultRefs({
    refs: bridgeResult.result.refs ?? [],
    summary,
    readback,
  });

  const result = {
    summary,
    refs,
    artifacts: cloneJson(bridgeResult.result.artifacts ?? []),
    jobs: cloneJson(bridgeResult.result.jobs ?? []),
    readback,
    session_ledger: cloneJson(bridgeResult.result.session_ledger ?? null),
    last_result: cloneJson(
      bridgeResult.result.last_result ?? {
        updated: false,
        refs: [],
        truncated: false,
      },
    ),
  };

  const oversized = firstOversizedResultValue(result, prepared.budget.max_inline_value_bytes);
  if (oversized) {
    return finalizeTemplateEnvelope(prepared.budget, {
      ...base,
      ok: false,
      error: typedError({
        source: "harness",
        code: "RESPONSE_TOO_LARGE",
        message: "Template result contains inline content above max_inline_value_bytes.",
        recoverable: true,
        details: oversized,
      }),
    });
  }

  return finalizeTemplateEnvelope(prepared.budget, {
    ...base,
    ok: true,
    result,
  });
}

function normalizeResultRefs({ refs, summary, readback }) {
  const normalized = cloneJson(refs);
  const seen = new Set(normalized.map((ref) => ref.ref));
  for (const value of structuredRefStrings(summary)) {
    const ref = objectRefFromCanonicalString(value);
    if (!ref || seen.has(ref.ref)) continue;
    normalized.push(ref);
    seen.add(ref.ref);
  }
  for (const value of structuredRefStrings(readback)) {
    const ref = objectRefFromCanonicalString(value);
    if (!ref || seen.has(ref.ref)) continue;
    normalized.push(ref);
    seen.add(ref.ref);
  }
  return normalized;
}

function structuredRefStrings(value, key = null, output = []) {
  if (typeof value === "string") {
    if (isStructuredRefField(key)) output.push(value);
    return output;
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry === "string" && isStructuredRefsField(key)) {
        output.push(entry);
      } else if (entry && typeof entry === "object") {
        structuredRefStrings(entry, null, output);
      }
    }
    return output;
  }
  if (!isPlainObject(value)) return output;
  for (const [entryKey, entry] of Object.entries(value)) {
    structuredRefStrings(entry, entryKey, output);
  }
  return output;
}

function isStructuredRefField(key) {
  return typeof key === "string" && key.endsWith("_ref");
}

function isStructuredRefsField(key) {
  return typeof key === "string" && key.endsWith("_refs");
}

function objectRefFromCanonicalString(value) {
  if (typeof value !== "string" || value.trim() === "") return null;
  const firstSeparator = value.indexOf(":");
  if (firstSeparator < 1) return null;
  const kind = value.slice(0, firstSeparator);
  if (!REF_KIND_SET.has(kind)) return null;
  if (kind === "artifact" || kind === "job") return null;

  const remainder = value.slice(firstSeparator + 1);
  const secondSeparator = remainder.indexOf(":");
  if (secondSeparator < 0) {
    if (kind === "project" && remainder === "current") {
      return safeObjectRef(kind, { scheme: "alias", value: remainder }, { ref: value });
    }
    return null;
  }

  const scheme = remainder.slice(0, secondSeparator);
  const identityValue = remainder.slice(secondSeparator + 1);
  if (scheme.trim() === "" || identityValue.trim() === "") return null;
  return safeObjectRef(kind, { scheme, value: identityValue }, { ref: value });
}

function safeObjectRef(kind, identity, options) {
  try {
    return createObjectRef(kind, identity, options);
  } catch {
    return null;
  }
}

function templateErrorEnvelope({ prepared, descriptor, context, budget, error }) {
  const normalized = normalizeExecutionError(error);
  const normalizedBudget = safeBudget(budget ?? prepared?.budget);
  const completedAt = prepared?.context?.created_at ?? safeCompletedAt(context);
  return finalizeTemplateEnvelope(normalizedBudget, {
    contract: TEMPLATE_EXECUTION_HARNESS_CONTRACT,
    template: prepared?.descriptor
      ? templateSummary(prepared.descriptor)
      : unsafeTemplateSummary(descriptor),
    request: prepared?.request ? requestSummary(prepared.request) : null,
    completed_at: completedAt,
    ok: false,
    error: typedError(normalized),
    budget: {
      max_response_bytes: normalizedBudget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
      bridge_response_bytes: null,
    },
  });
}

function normalizeExecutionError(error) {
  if (error instanceof TemplateExecutionHarnessError) {
    return {
      source: "harness",
      code: error.code,
      message: error.message,
      recoverable: error.recoverable,
      details: error.details,
    };
  }

  return {
    source: "harness",
    code: "TEMPLATE_EXECUTOR_INVALID",
    message: error instanceof Error ? error.message : "Template execution failed.",
    recoverable: false,
  };
}

function templateEnvelopeBase(prepared, completedAt, bridgeFields = {}) {
  return {
    contract: TEMPLATE_EXECUTION_HARNESS_CONTRACT,
    template: templateSummary(prepared.descriptor),
    request: requestSummary(prepared.request),
    completed_at: completedAt,
    ok: undefined,
    bridge: bridgeFields.bridge,
    queue: bridgeFields.queue,
    undo: bridgeFields.undo,
    verification: bridgeFields.verification,
    idempotency: bridgeFields.idempotency,
    budget: {
      max_response_bytes: prepared.budget.max_response_bytes,
      response_bytes: 0,
      truncated: Boolean(bridgeFields.bridgeBudget?.truncated),
      bridge_response_bytes: bridgeFields.bridgeBudget?.response_bytes ?? null,
    },
  };
}

function templateSummary(descriptor) {
  return {
    id: descriptor.id,
    pack: descriptor.pack,
    risk: descriptor.risk,
    operation: {
      family: descriptor.bridge.operation_family,
      name: descriptor.bridge.operation_name,
    },
    capability: descriptor.bridge.capability,
  };
}

function unsafeTemplateSummary(descriptor) {
  if (!isPlainObject(descriptor)) return null;
  return {
    id: typeof descriptor.id === "string" ? descriptor.id : null,
    pack: typeof descriptor.pack === "string" ? descriptor.pack : null,
    risk: typeof descriptor.risk === "string" ? descriptor.risk : null,
  };
}

function requestSummary(request) {
  return {
    id: request.id,
    created_at: request.created_at,
    client: cloneJson(request.client),
    bridge: cloneJson(request.bridge),
    idempotency_key: request.idempotency_key ?? null,
    timeout_ms: request.timeout_ms,
  };
}

function finalizeTemplateEnvelope(budget, envelope) {
  const finalEnvelope = pruneUndefined(envelope);
  finalEnvelope.budget.response_bytes = encodedBytes(finalEnvelope);
  if (
    finalEnvelope.budget.response_bytes > budget.max_response_bytes &&
    finalEnvelope.error?.code !== "RESPONSE_TOO_LARGE"
  ) {
    return finalizeTemplateEnvelope(budget, {
      ...finalEnvelope,
      ok: false,
      result: undefined,
      error: typedError({
        source: "harness",
        code: "RESPONSE_TOO_LARGE",
        message: "Template execution result exceeded max_response_bytes.",
        recoverable: true,
      }),
      budget: {
        ...finalEnvelope.budget,
        response_bytes: 0,
        truncated: true,
      },
    });
  }
  return deepFreeze(finalEnvelope);
}

function typedError({ source, code, message, recoverable, details }) {
  const normalizedSource = source === "bridge" ? "bridge" : "harness";
  const normalizedCode =
    normalizedSource === "bridge"
      ? BRIDGE_ERROR_CODE_SET.has(code) ? code : "INTERNAL_ERROR"
      : HARNESS_ERROR_CODE_SET.has(code) ? code : "TEMPLATE_EXECUTOR_INVALID";
  return pruneUndefined({
    source: normalizedSource,
    code: normalizedCode,
    message,
    recoverable: Boolean(recoverable),
    details,
  });
}

function validatePropertyValue(value, schema, path) {
  const errors = [];

  if (Array.isArray(schema.oneOf)) {
    const matches = schema.oneOf.filter((candidate) => validatePropertyValue(value, candidate, path).length === 0);
    if (matches.length !== 1) {
      errors.push(`${path} must match exactly one oneOf branch.`);
    }
  }
  if (Object.hasOwn(schema, "const") && !jsonEqual(value, schema.const)) {
    errors.push(`${path} must equal its const value.`);
  }
  if (Array.isArray(schema.enum) && !schema.enum.some((entry) => jsonEqual(value, entry))) {
    errors.push(`${path} must be one of its enum values.`);
  }
  if (schema.type !== undefined && !matchesJsonType(value, schema.type)) {
    errors.push(`${path} must be ${Array.isArray(schema.type) ? schema.type.join(" or ") : schema.type}.`);
  }

  return errors;
}

function matchesJsonType(value, type) {
  if (Array.isArray(type)) return type.some((entry) => matchesJsonType(value, entry));
  switch (type) {
    case "array":
      return Array.isArray(value);
    case "boolean":
      return typeof value === "boolean";
    case "integer":
      return Number.isInteger(value);
    case "null":
      return value === null;
    case "number":
      return typeof value === "number" && Number.isFinite(value);
    case "object":
      return isPlainObject(value);
    case "string":
      return typeof value === "string";
    default:
      return false;
  }
}

function inputValidationError(errors) {
  return new TemplateExecutionHarnessError(
    "TEMPLATE_INPUT_INVALID",
    "Template input failed inputSchema validation.",
    {
      recoverable: true,
      details: { errors },
    },
  );
}

function firstOversizedResultValue(result, maxBytes) {
  return (
    firstOversizedInlineValue(result.summary, maxBytes, "result.summary") ??
    firstOversizedRefCollection(result.refs, maxBytes, "result.refs") ??
    firstOversizedRefCollection(result.artifacts, maxBytes, "result.artifacts") ??
    firstOversizedRefCollection(result.jobs, maxBytes, "result.jobs") ??
    firstOversizedLastResult(result.last_result, maxBytes)
  );
}

function firstOversizedRefCollection(refs, maxBytes, path) {
  if (!Array.isArray(refs)) return firstOversizedInlineValue(refs, maxBytes, path);
  for (const [index, ref] of refs.entries()) {
    const oversized = firstOversizedInlineValue(ref, maxBytes, `${path}[${index}]`);
    if (oversized) return oversized;
  }
  return null;
}

function firstOversizedLastResult(lastResult, maxBytes) {
  if (!isPlainObject(lastResult)) {
    return firstOversizedInlineValue(lastResult, maxBytes, "result.last_result");
  }

  const { refs = [], ...inlineLastResult } = lastResult;
  return (
    firstOversizedInlineValue(inlineLastResult, maxBytes, "result.last_result") ??
    firstOversizedRefCollection(refs, maxBytes, "result.last_result.refs")
  );
}

function firstOversizedInlineValue(value, maxBytes, path) {
  if (value === undefined) return null;
  const bytes = encodedBytes(value);
  if (bytes > maxBytes) return { path, bytes, max_inline_value_bytes: maxBytes };
  if (value === null || typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    const oversized = firstOversizedInlineValue(entry, maxBytes, `${path}.${key}`);
    if (oversized) return oversized;
  }
  return null;
}

function safeBudget(input) {
  try {
    return normalizeBudget(input);
  } catch {
    return FOUNDATION_BRIDGE_DEFAULT_BUDGET;
  }
}

function safeCompletedAt(context) {
  try {
    if (isPlainObject(context)) {
      return normalizeCreatedAt(
        context.created_at ??
          context.createdAt ??
          (typeof context.now === "function" ? context.now() : undefined),
      );
    }
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function shortHash(value, length) {
  return createHash("sha256").update(stableStringify(value)).digest("hex").slice(0, length);
}

function jsonEqual(a, b) {
  return stableStringify(a) === stableStringify(b);
}

function stableStringify(value) {
  return JSON.stringify(sortJson(value));
}

function sortJson(value) {
  if (Array.isArray(value)) return value.map(sortJson);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => [key, sortJson(entry)]),
  );
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
