export const FOUNDATION_BRIDGE_CONTRACT = "foundation.bridge.v1";

export const FOUNDATION_BRIDGE_OPERATION_FAMILIES = Object.freeze([
  "query_state",
  "run_command",
  "run_action",
  "run_job",
  "artifact_metadata",
]);

export const FOUNDATION_BRIDGE_REF_KINDS = Object.freeze([
  "project",
  "track",
  "item",
  "take",
  "fx",
  "send",
  "envelope",
  "marker",
  "region",
  "file",
  "job",
  "artifact",
]);

export const FOUNDATION_BRIDGE_PACK_IDS = Object.freeze([
  "core",
  "project",
  "transport",
  "tracks",
  "items",
  "media",
  "analysis",
  "midi",
  "fx",
  "routing",
  "automation",
  "render",
  "actions",
  "ui",
  "system",
  "hardware_control",
]);

export const FOUNDATION_BRIDGE_ERROR_CODES = Object.freeze([
  "REQUEST_INVALID",
  "OPERATION_NOT_FOUND",
  "PACK_DISABLED",
  "RISK_BLOCKED",
  "PARAMS_INVALID",
  "REF_INVALID",
  "PROJECT_NOT_FOUND",
  "TRACK_NOT_FOUND",
  "ITEM_NOT_FOUND",
  "TAKE_NOT_FOUND",
  "FX_NOT_FOUND",
  "FX_OWNER_NOT_FOUND",
  "FX_SLOT_NOT_FOUND",
  "FX_REF_NOT_FOUND",
  "FX_PARAMETER_INVALID",
  "FX_PARAMETER_NOT_FOUND",
  "SEND_NOT_FOUND",
  "ENVELOPE_NOT_FOUND",
  "MARKER_NOT_FOUND",
  "REGION_NOT_FOUND",
  "FILE_NOT_FOUND",
  "JOB_NOT_FOUND",
  "ARTIFACT_NOT_FOUND",
  "ARTIFACT_INVALID",
  "ACTION_NOT_ALLOWED",
  "COMMAND_FAILED",
  "JOB_FAILED",
  "VERIFY_FAILED",
  "RESPONSE_TOO_LARGE",
  "IDEMPOTENCY_CONFLICT",
  "QUEUE_CONFLICT",
  "BRIDGE_NOT_RUNNING",
  "BRIDGE_TIMEOUT",
  "BRIDGE_OWNER_MISMATCH",
  "BRIDGE_GENERATION_MISMATCH",
  "INTERNAL_ERROR",
]);

export const FOUNDATION_BRIDGE_DEFAULT_BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: 50,
  max_inline_value_bytes: 2_048,
});

export const FOUNDATION_BRIDGE_QUEUE_STATES = Object.freeze([
  "done",
  "failed",
  "timeout",
  "replayed",
]);

const OPERATION_FAMILY_SET = new Set(FOUNDATION_BRIDGE_OPERATION_FAMILIES);
const REF_KIND_SET = new Set(FOUNDATION_BRIDGE_REF_KINDS);
const PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const ERROR_CODE_SET = new Set(FOUNDATION_BRIDGE_ERROR_CODES);
const QUEUE_STATE_SET = new Set(FOUNDATION_BRIDGE_QUEUE_STATES);
const IDEMPOTENCY_KEY_PATTERN = /^[\x20-\x7e]{1,128}$/;
const MUTATING_FAMILIES = new Set(["run_command", "run_action", "run_job"]);

export class FoundationBridgeContractError extends Error {
  constructor(message) {
    super(message);
    this.name = "FoundationBridgeContractError";
  }
}

export function createObjectRef(kind, identity, options = {}) {
  if (!REF_KIND_SET.has(kind)) {
    throw new FoundationBridgeContractError(`Unknown object ref kind: ${kind}`);
  }
  if (!identity || typeof identity !== "object" || Array.isArray(identity)) {
    throw new FoundationBridgeContractError("Object ref identity must be an object.");
  }
  if (typeof identity.scheme !== "string" || identity.scheme.trim() === "") {
    throw new FoundationBridgeContractError("Object ref identity.scheme is required.");
  }
  if (typeof identity.value !== "string" || identity.value.trim() === "") {
    throw new FoundationBridgeContractError("Object ref identity.value is required.");
  }

  const ref = options.ref ?? `${kind}:${identity.scheme}:${identity.value}`;
  if (typeof ref !== "string" || !ref.startsWith(`${kind}:`)) {
    throw new FoundationBridgeContractError(`Object ref must start with ${kind}:.`);
  }

  return deepFreeze(
    pruneUndefined({
      kind,
      ref,
      identity: { scheme: identity.scheme, value: identity.value },
      project_ref: options.project_ref,
      display: options.display,
      raw: options.raw,
      index: options.index,
      display_number: options.display_number,
      selected: options.selected,
      summary: options.summary,
    }),
  );
}

export function createArtifactRef({ owner_pack, scope, id, schema, summary = {} }) {
  if (!PACK_ID_SET.has(owner_pack)) {
    throw new FoundationBridgeContractError(`Invalid artifact owner_pack: ${owner_pack}`);
  }
  if (!/^[a-z][a-z0-9_]*$/.test(scope ?? "")) {
    throw new FoundationBridgeContractError(`Invalid artifact scope: ${scope}`);
  }
  if (!/^art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$/.test(id ?? "")) {
    throw new FoundationBridgeContractError(`Invalid artifact id: ${id}`);
  }
  const value = `artifact:${owner_pack}:${scope}:${id}`;
  return createObjectRef(
    "artifact",
    { scheme: "artifact_ref", value },
    {
      ref: value,
      summary: pruneUndefined({ schema, ...summary }),
    },
  );
}

export function normalizeFoundationBridgeRequest(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new FoundationBridgeContractError("Bridge request must be an object.");
  }
  if (input.contract !== FOUNDATION_BRIDGE_CONTRACT) {
    throw new FoundationBridgeContractError("Bridge request contract must be foundation.bridge.v1.");
  }

  const operation = normalizeOperation(input.operation);
  const pack = normalizePack(input.pack);
  const budget = normalizeBudget(input.budget);
  const refs = normalizeRefs(input.refs);
  const undo = normalizeUndo(input.undo);
  const verification = normalizeVerification(input.verification);
  assertUndoDiscipline(operation, pack, undo);
  const idempotencyKey = normalizeIdempotencyKey(input.idempotency_key, operation, pack);
  const timeoutMs = normalizeTimeout(input.timeout_ms);

  assertString(input.id, "id");
  assertString(input.created_at, "created_at");
  normalizeObject(input.client, "client");
  normalizeObject(input.bridge, "bridge");
  assertString(input.client.id, "client.id");
  assertString(input.client.session_id, "client.session_id");
  assertString(input.bridge.expected_owner, "bridge.expected_owner");
  if (!Number.isInteger(input.bridge.expected_generation) || input.bridge.expected_generation < 0) {
    throw new FoundationBridgeContractError("bridge.expected_generation must be a non-negative integer.");
  }
  const params = normalizeParams(input);

  return deepFreeze({
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: input.id,
    created_at: input.created_at,
    client: {
      id: input.client.id,
      session_id: input.client.session_id,
    },
    bridge: {
      expected_owner: input.bridge.expected_owner,
      expected_generation: input.bridge.expected_generation,
    },
    operation,
    pack,
    params,
    refs,
    undo,
    verification,
    artifacts: normalizeArtifacts(input.artifacts),
    budget,
    ...(idempotencyKey !== undefined ? { idempotency_key: idempotencyKey } : {}),
    timeout_ms: timeoutMs,
  });
}

export function validateFoundationBridgeResult(result) {
  if (!result || typeof result !== "object" || Array.isArray(result)) {
    throw new FoundationBridgeContractError("Bridge result must be an object.");
  }
  if (result.contract !== FOUNDATION_BRIDGE_CONTRACT) {
    throw new FoundationBridgeContractError("Bridge result contract must be foundation.bridge.v1.");
  }
  assertString(result.id, "id");
  assertString(result.completed_at, "completed_at");
  normalizeObject(result.bridge, "bridge");
  assertString(result.bridge.owner, "bridge.owner");
  if (!Number.isInteger(result.bridge.generation) || result.bridge.generation < 0) {
    throw new FoundationBridgeContractError("bridge.generation must be a non-negative integer.");
  }
  normalizeObject(result.queue, "queue");
  if (!QUEUE_STATE_SET.has(result.queue.state)) {
    throw new FoundationBridgeContractError(`Unknown queue state: ${result.queue.state}`);
  }
  normalizeObject(result.budget, "budget");
  if (!Number.isInteger(result.budget.response_bytes) || result.budget.response_bytes < 0) {
    throw new FoundationBridgeContractError("budget.response_bytes must be a non-negative integer.");
  }
  if (typeof result.budget.truncated !== "boolean") {
    throw new FoundationBridgeContractError("budget.truncated must be a boolean.");
  }

  if (result.ok === true) {
    normalizeObject(result.result, "result");
    normalizeRefs(result.result.refs ?? []);
    normalizeRefs(result.result.artifacts ?? []);
    normalizeRefs(result.result.jobs ?? []);
    normalizeSessionLedger(result.result.session_ledger);
  } else if (result.ok === false) {
    normalizeObject(result.error, "error");
    if (!ERROR_CODE_SET.has(result.error.code)) {
      throw new FoundationBridgeContractError(`Unknown error code: ${result.error.code}`);
    }
    assertString(result.error.message, "error.message");
    if (typeof result.error.recoverable !== "boolean") {
      throw new FoundationBridgeContractError("error.recoverable must be a boolean.");
    }
  } else {
    throw new FoundationBridgeContractError("Bridge result ok must be true or false.");
  }

  return true;
}

export function foundationBridgeRequestFingerprint(request) {
  const normalized = normalizeFoundationBridgeRequest(request);
  return stableStringify({
    operation: normalized.operation,
    pack: normalized.pack,
    params: normalized.params,
    refs: normalized.refs,
    undo: normalized.undo,
    verification: normalized.verification,
    artifacts: normalized.artifacts,
  });
}

export class FakeFoundationBridge {
  constructor(options = {}) {
    this.owner = options.owner ?? "owner-test";
    this.generation = options.generation ?? 1;
    this.now = options.now ?? (() => new Date("2026-07-02T00:00:00.000Z"));
    this.running = false;
    this.idempotencyRecords = new Map();
    this.lastResult = [];
    this.artifacts = new Map();
    this.seen = [];
  }

  setOwner(owner) {
    this.owner = owner;
  }

  setGeneration(generation) {
    this.generation = generation;
  }

  setRunning(running) {
    this.running = running;
  }

  dispatch(input) {
    let request;
    try {
      request = normalizeFoundationBridgeRequest(input);
    } catch (error) {
      return this.errorEnvelope(
        minimalRequest(input),
        "REQUEST_INVALID",
        error.message,
        { recoverable: true },
      );
    }

    const startedAt = this.now().toISOString();

    if (request.bridge.expected_owner !== this.owner) {
      return this.errorEnvelope(request, "BRIDGE_OWNER_MISMATCH", "Bridge owner token changed.", {
        recoverable: true,
        startedAt,
      });
    }
    if (request.bridge.expected_generation !== this.generation) {
      return this.errorEnvelope(
        request,
        "BRIDGE_GENERATION_MISMATCH",
        "Bridge generation changed.",
        { recoverable: true, startedAt },
      );
    }
    if (this.running) {
      return this.errorEnvelope(request, "QUEUE_CONFLICT", "A synchronous operation is already running.", {
        recoverable: true,
        startedAt,
      });
    }

    const fingerprint = foundationBridgeRequestFingerprint(request);
    if (request.idempotency_key) {
      const existing = this.idempotencyRecords.get(request.idempotency_key);
      if (existing && existing.fingerprint !== fingerprint) {
        return this.errorEnvelope(
          request,
          "IDEMPOTENCY_CONFLICT",
          "idempotency_key was reused with a different request fingerprint.",
          { recoverable: false, startedAt },
        );
      }
      if (existing) {
        return replayEnvelope(existing.envelope, request, {
          owner: this.owner,
          generation: this.generation,
          completedAt: this.now().toISOString(),
        });
      }
    }

    this.seen.push(request);
    const result = this.execute(request, startedAt);

    if (request.idempotency_key && isTerminalReplayable(result)) {
      this.idempotencyRecords.set(request.idempotency_key, {
        fingerprint,
        envelope: result,
      });
    }

    return result;
  }

  execute(request, startedAt) {
    const delayMs = Number(request.params?.simulate_delay_ms ?? 0);
    if (delayMs > request.timeout_ms) {
      return this.errorEnvelope(request, "BRIDGE_TIMEOUT", "Operation exceeded timeout_ms.", {
        recoverable: true,
        startedAt,
        queueState: "timeout",
      });
    }

    if (request.params?.force_error) {
      const code = request.params.force_error;
      return this.errorEnvelope(request, code, `Forced fake bridge error: ${code}`, {
        recoverable: code !== "VERIFY_FAILED",
        startedAt,
      });
    }

    if (request.verification.mode === "required" && request.params?.verification_passes === false) {
      return this.errorEnvelope(request, "VERIFY_FAILED", "Verification failed.", {
        recoverable: false,
        startedAt,
        verificationStatus: "failed",
      });
    }

    if (request.operation.family === "query_state" && request.operation.name === "last_result.read") {
      return this.okEnvelope(request, startedAt, {
        summary: { kind: "last_result" },
        refs: [],
        last_result: boundedLastResult(this.lastResult, request.budget.max_items),
      });
    }

    if (request.operation.family === "artifact_metadata") {
      const artifactRef = request.refs.find((ref) => ref.kind === "artifact");
      if (!artifactRef) {
        return this.errorEnvelope(request, "ARTIFACT_NOT_FOUND", "artifact_metadata requires an artifact ref.", {
          recoverable: true,
          startedAt,
        });
      }
      const metadata = this.artifacts.get(artifactRef.ref) ?? {
        ref: artifactRef.ref,
        schema: artifactRef.summary?.schema ?? "unknown",
      };
      return this.okEnvelope(request, startedAt, {
        summary: { artifact: metadata },
        refs: [],
        artifacts: [artifactRef],
      });
    }

    const emitted = normalizeEmitted(request);
    if (
      emitted.inline_payload !== undefined &&
      encodedBytes(emitted.inline_payload) > request.budget.max_inline_value_bytes
    ) {
      return this.errorEnvelope(
        request,
        "RESPONSE_TOO_LARGE",
        "Large inline content must be written as an artifact.",
        { recoverable: true, startedAt },
      );
    }

    for (const artifact of emitted.artifacts) {
      this.artifacts.set(artifact.ref, {
        ref: artifact.ref,
        schema: artifact.summary?.schema ?? "unknown",
        owner_pack: artifact.identity.value.split(":")[1],
      });
    }

    if (request.operation.family === "run_job" && emitted.jobs.length === 0) {
      emitted.jobs.push(
        createObjectRef("job", { scheme: "job_id", value: `${request.pack.id}.${request.id}` }),
      );
    }

    const mutates = MUTATING_FAMILIES.has(request.operation.family);
    const nextLastResult = mutates ? [...emitted.refs, ...emitted.jobs, ...emitted.artifacts] : this.lastResult;
    const envelope = this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
        readback: emitted.readback,
      },
      refs: emitted.refs,
      artifacts: emitted.artifacts,
      jobs: emitted.jobs,
      readback: emitted.readback,
      session_ledger: createSessionLedger(request, emitted, {
        request_id: request.id,
        operation_id: `${request.operation.family}:${request.operation.name}`,
        undo_label: request.undo?.label ?? null,
        readback_status: emitted.readback ? "available" : "not_requested",
      }),
      last_result: mutates
        ? {
            updated: true,
            refs: nextLastResult.slice(0, request.budget.max_items),
            truncated: nextLastResult.length > request.budget.max_items,
          }
        : boundedLastResult(this.lastResult, request.budget.max_items),
    });

    if (envelope.ok) {
      this.lastResult = nextLastResult.slice(0, request.budget.max_items);
    }

    return envelope;
  }

  okEnvelope(request, startedAt, result) {
    const completedAt = this.now().toISOString();
    const envelope = {
      contract: FOUNDATION_BRIDGE_CONTRACT,
      id: request.id,
      ok: true,
      completed_at: completedAt,
      bridge: {
        owner: this.owner,
        generation: this.generation,
      },
      queue: {
        state: "done",
        started_at: startedAt,
        completed_at: completedAt,
      },
      result: {
        summary: result.summary ?? {},
        refs: result.refs ?? [],
        artifacts: result.artifacts ?? [],
        jobs: result.jobs ?? [],
        readback: result.readback,
        session_ledger: result.session_ledger,
        last_result: result.last_result ?? boundedLastResult(this.lastResult, request.budget.max_items),
      },
      undo: undoResult(request),
      verification: verificationResult(request, "passed"),
      budget: {
        max_response_bytes: request.budget.max_response_bytes,
        response_bytes: 0,
        truncated: Boolean(result.last_result?.truncated),
      },
      idempotency: {
        key: request.idempotency_key ?? null,
        replayed: false,
      },
    };

    return this.finalizeBudget(request, envelope);
  }

  errorEnvelope(request, code, message, options = {}) {
    const normalizedRequest = request?.contract === FOUNDATION_BRIDGE_CONTRACT ? request : minimalRequest(request);
    const completedAt = this.now().toISOString();
    const envelope = {
      contract: FOUNDATION_BRIDGE_CONTRACT,
      id: normalizedRequest.id,
      ok: false,
      completed_at: completedAt,
      bridge: {
        owner: this.owner,
        generation: this.generation,
      },
      queue: {
        state: options.queueState ?? "failed",
        started_at: options.startedAt ?? completedAt,
        completed_at: completedAt,
      },
      error: {
        code: ERROR_CODE_SET.has(code) ? code : "INTERNAL_ERROR",
        message,
        recoverable: options.recoverable ?? defaultRecoverable(code),
        ...(options.details !== undefined ? { details: options.details } : {}),
      },
      undo: undoResult(normalizedRequest),
      verification: verificationResult(normalizedRequest, options.verificationStatus ?? "skipped"),
      budget: {
        max_response_bytes: normalizedRequest.budget.max_response_bytes,
        response_bytes: 0,
        truncated: false,
      },
      idempotency: {
        key: normalizedRequest.idempotency_key ?? null,
        replayed: false,
      },
    };

    return this.finalizeBudget(normalizedRequest, envelope);
  }

  finalizeBudget(request, envelope) {
    envelope.budget.response_bytes = encodedBytes(envelope);
    if (envelope.budget.response_bytes > request.budget.max_response_bytes && envelope.error?.code !== "RESPONSE_TOO_LARGE") {
      return this.errorEnvelope(request, "RESPONSE_TOO_LARGE", "Bridge response exceeded max_response_bytes.", {
        recoverable: true,
        startedAt: envelope.queue.started_at,
      });
    }
    validateFoundationBridgeResult(envelope);
    return deepFreeze(envelope);
  }
}

function normalizeOperation(operation) {
  normalizeObject(operation, "operation");
  if (!OPERATION_FAMILY_SET.has(operation.family)) {
    throw new FoundationBridgeContractError(`Unknown operation family: ${operation.family}`);
  }
  assertString(operation.name, "operation.name");
  return { family: operation.family, name: operation.name };
}

function normalizePack(pack) {
  normalizeObject(pack, "pack");
  if (!PACK_ID_SET.has(pack.id)) {
    throw new FoundationBridgeContractError(`Unknown pack id: ${pack.id}`);
  }
  assertString(pack.capability, "pack.capability");
  assertString(pack.risk, "pack.risk");
  return {
    id: pack.id,
    capability: pack.capability,
    risk: pack.risk,
  };
}

function normalizeParams(input) {
  if (!Object.hasOwn(input, "params")) {
    throw new FoundationBridgeContractError("params must be present.");
  }
  if (input.params === null || typeof input.params !== "object" || Array.isArray(input.params)) {
    throw new FoundationBridgeContractError("params must be a JSON object.");
  }
  return input.params;
}

function normalizeRefs(refs) {
  if (!Array.isArray(refs)) {
    throw new FoundationBridgeContractError("refs must be an array.");
  }
  return refs.map((ref, index) => {
    normalizeObject(ref, `refs[${index}]`);
    if (!REF_KIND_SET.has(ref.kind)) {
      throw new FoundationBridgeContractError(`Unknown ref kind: ${ref.kind}`);
    }
    assertString(ref.ref, `refs[${index}].ref`);
    normalizeObject(ref.identity, `refs[${index}].identity`);
    assertString(ref.identity.scheme, `refs[${index}].identity.scheme`);
    assertString(ref.identity.value, `refs[${index}].identity.value`);
    return pruneUndefined({
      kind: ref.kind,
      ref: ref.ref,
      identity: {
        scheme: ref.identity.scheme,
        value: ref.identity.value,
      },
      project_ref: ref.project_ref,
      display: ref.display,
      raw: ref.raw,
      index: ref.index,
      display_number: ref.display_number,
      selected: ref.selected,
      summary: ref.summary,
    });
  });
}

function normalizeUndo(undo) {
  normalizeObject(undo, "undo");
  if (!["none", "optional", "required"].includes(undo.mode)) {
    throw new FoundationBridgeContractError("undo.mode must be none, optional, or required.");
  }
  const flags = undo.flags === undefined ? [] : normalizeStringArray(undo.flags, "undo.flags");
  if (undo.mode !== "none") assertString(undo.label, "undo.label");
  return pruneUndefined({
    mode: undo.mode,
    label: undo.label,
    flags,
  });
}

function normalizeVerification(verification) {
  normalizeObject(verification, "verification");
  if (!["none", "optional", "required"].includes(verification.mode)) {
    throw new FoundationBridgeContractError("verification.mode must be none, optional, or required.");
  }
  if (verification.checks !== undefined && !Array.isArray(verification.checks)) {
    throw new FoundationBridgeContractError("verification.checks must be an array.");
  }
  return {
    mode: verification.mode,
    checks: verification.checks ?? [],
  };
}

function normalizeArtifacts(artifacts) {
  normalizeObject(artifacts, "artifacts");
  if (typeof artifacts.allow !== "boolean") {
    throw new FoundationBridgeContractError("artifacts.allow must be a boolean.");
  }
  return { allow: artifacts.allow };
}

function normalizeBudget(budget) {
  normalizeObject(budget, "budget");
  const normalized = {
    ...FOUNDATION_BRIDGE_DEFAULT_BUDGET,
    ...budget,
  };
  for (const key of ["max_response_bytes", "max_items", "max_inline_value_bytes"]) {
    if (!Number.isInteger(normalized[key]) || normalized[key] < 1) {
      throw new FoundationBridgeContractError(`budget.${key} must be a positive integer.`);
    }
  }
  return normalized;
}

function normalizeIdempotencyKey(key, operation, pack) {
  if (key === undefined) return undefined;
  if (!IDEMPOTENCY_KEY_PATTERN.test(key)) {
    throw new FoundationBridgeContractError("idempotency_key must be 1-128 printable ASCII characters.");
  }
  if (!MUTATING_FAMILIES.has(operation.family) || pack.risk === "read") {
    throw new FoundationBridgeContractError("idempotency_key is only valid for mutating operation families.");
  }
  return key;
}

function assertUndoDiscipline(operation, pack, undo) {
  if (["query_state", "artifact_metadata"].includes(operation.family) && undo.mode !== "none") {
    throw new FoundationBridgeContractError(`${operation.family} requests must use undo.mode none.`);
  }
  if (["run_command", "run_action"].includes(operation.family) && pack.risk !== "read" && undo.mode !== "required") {
    throw new FoundationBridgeContractError(`${operation.family} mutations must use undo.mode required.`);
  }
}

function normalizeTimeout(timeoutMs) {
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new FoundationBridgeContractError("timeout_ms must be a positive integer.");
  }
  return timeoutMs;
}

function normalizeObject(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new FoundationBridgeContractError(`${label} must be an object.`);
  }
}

function assertString(value, label) {
  if (typeof value !== "string" || value.trim() === "") {
    throw new FoundationBridgeContractError(`${label} must be a non-empty string.`);
  }
}

function normalizeStringArray(value, label) {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "string" || entry.trim() === "")) {
    throw new FoundationBridgeContractError(`${label} must be an array of non-empty strings.`);
  }
  return [...new Set(value)];
}

function normalizeEmitted(request) {
  const emits = request.params?.emits ?? {};
  const derived = deriveCanonicalEmits(request);
  return {
    refs: normalizeRefs(emits.refs ?? derived.refs),
    artifacts: normalizeRefs(emits.artifacts ?? []),
    jobs: normalizeRefs(emits.jobs ?? []),
    readback: emits.readback ?? derived.readback,
    inline_payload: emits.inline_payload,
  };
}

function deriveCanonicalEmits(request) {
  const capability = request.pack.capability;
  if (capability === "track.resolve_ref") {
    const ref = canonicalTrackRef(request.params.track_ref ?? "track:index:0", {
      name: "Track 1",
      selected: true,
    });
    return {
      refs: [ref],
      readback: objectReadback(ref, { raw_name: ref.raw.name, display_name: ref.display.name }),
    };
  }

  if (capability === "track.create") {
    const index = Number.isInteger(request.params.index) ? request.params.index : 0;
    const name = request.params.name ?? "";
    const ref = canonicalTrackRef(`track:index:${index}`, {
      name,
      index,
      selected: false,
    });
    return {
      refs: [ref],
      readback: objectReadback(ref, { raw_name: name, display_name: ref.display.name }),
    };
  }

  if (capability?.startsWith("track.") && request.refs.some((ref) => ref.kind === "track")) {
    const ref = request.refs.find((entry) => entry.kind === "track");
    return {
      refs: [ref],
      readback: objectReadback(ref, { status: "modified" }),
    };
  }

  if (capability === "items.resolve_item_ref") {
    const ref = canonicalItemRef(request.params.ref ?? "selected:0", {
      index: 0,
      selected: true,
    });
    return {
      refs: [ref],
      readback: objectReadback(ref, { raw_name: "", display_name: ref.display.name }),
    };
  }

  if (capability === "items.read_item_summary" && request.refs.some((ref) => ref.kind === "item")) {
    const ref = request.refs.find((entry) => entry.kind === "item");
    return {
      refs: [ref],
      readback: objectReadback(ref, { status: "read" }),
    };
  }

  return { refs: [], readback: undefined };
}

function canonicalTrackRef(source, options = {}) {
  const index = Number.isInteger(options.index) ? options.index : indexFromSource(source);
  const guid = guidFromSource(source, "TRACK", index);
  const rawName = options.name ?? "";
  return createObjectRef(
    "track",
    { scheme: "guid", value: guid },
    {
      ref: `track:guid:${guid}`,
      raw: { name: rawName },
      index,
      display_number: index + 1,
      selected: options.selected,
      display: {
        name: displayName(rawName, "Track", index),
        number: index + 1,
      },
      summary: {
        index,
        display_number: index + 1,
        selected: Boolean(options.selected),
      },
    },
  );
}

function canonicalItemRef(source, options = {}) {
  const index = Number.isInteger(options.index) ? options.index : indexFromSource(source);
  const guid = guidFromSource(source, "ITEM", index);
  const rawName = options.name ?? "";
  return createObjectRef(
    "item",
    { scheme: "guid", value: guid },
    {
      ref: `item:guid:${guid}`,
      raw: { name: rawName },
      index,
      display_number: index + 1,
      selected: options.selected,
      display: {
        name: displayName(rawName, "Item", index),
        number: index + 1,
      },
      summary: {
        index,
        display_number: index + 1,
        selected: Boolean(options.selected),
      },
    },
  );
}

function objectReadback(ref, fields = {}) {
  return pruneUndefined({
    status: fields.status ?? "available",
    ref: ref.ref,
    kind: ref.kind,
    raw_name: fields.raw_name,
    display_name: fields.display_name ?? ref.display?.name,
    fallback_name_used: fields.raw_name === "",
    index: ref.index,
    display_number: ref.display_number,
    selected: ref.selected,
  });
}

function createSessionLedger(request, emitted, fields) {
  const mutates = MUTATING_FAMILIES.has(request.operation.family);
  const refs = emitted.refs ?? [];
  const creates = mutates && request.pack.capability.includes(".create");
  return {
    contract: "session.ledger.v1",
    request_id: fields.request_id,
    operation_id: fields.operation_id,
    undo_label: fields.undo_label,
    cleanup_method: mutates ? "returned_ref" : "not_applicable",
    readback_status: fields.readback_status,
    refs: {
      created: creates ? refs : [],
      modified: mutates && !creates ? (refs.length > 0 ? refs : request.refs) : [],
      artifacts: emitted.artifacts ?? [],
    },
    blockers: [],
  };
}

function normalizeSessionLedger(ledger) {
  if (ledger === undefined) return;
  normalizeObject(ledger, "result.session_ledger");
  assertString(ledger.contract, "result.session_ledger.contract");
  assertString(ledger.request_id, "result.session_ledger.request_id");
  assertString(ledger.operation_id, "result.session_ledger.operation_id");
  normalizeObject(ledger.refs, "result.session_ledger.refs");
  normalizeRefs(ledger.refs.created ?? []);
  normalizeRefs(ledger.refs.modified ?? []);
  normalizeRefs(ledger.refs.artifacts ?? []);
  if (!Array.isArray(ledger.blockers)) {
    throw new FoundationBridgeContractError("result.session_ledger.blockers must be an array.");
  }
}

function indexFromSource(source) {
  const match = String(source).match(/(?:index|selected):(\d+)/);
  return match ? Number(match[1]) : 0;
}

function guidFromSource(source, prefix, index) {
  const guid = String(source).match(/\{[^}]+\}/)?.[0];
  return guid ?? `{${prefix}-${String(index).padStart(4, "0")}}`;
}

function displayName(rawName, fallback, index) {
  return typeof rawName === "string" && rawName.trim() !== ""
    ? rawName
    : `${fallback} ${index + 1}`;
}

function undoResult(request) {
  const mode = request.undo?.mode ?? "none";
  return {
    mode,
    opened: mode !== "none",
    closed: mode !== "none",
    label: request.undo?.label ?? null,
  };
}

function verificationResult(request, status) {
  return {
    mode: request.verification?.mode ?? "none",
    status,
    checks: request.verification?.checks ?? [],
  };
}

function boundedLastResult(refs, maxItems) {
  return {
    updated: false,
    refs: refs.slice(0, maxItems),
    truncated: refs.length > maxItems,
  };
}

function replayEnvelope(envelope, request, bridge) {
  const replayed = structuredClone(envelope);
  replayed.id = request.id;
  replayed.completed_at = bridge.completedAt;
  replayed.bridge = {
    owner: bridge.owner,
    generation: bridge.generation,
  };
  replayed.queue = {
    ...replayed.queue,
    state: "replayed",
    completed_at: bridge.completedAt,
  };
  replayed.idempotency = {
    key: request.idempotency_key,
    replayed: true,
  };
  replayed.budget.response_bytes = encodedBytes(replayed);
  validateFoundationBridgeResult(replayed);
  return deepFreeze(replayed);
}

function isTerminalReplayable(envelope) {
  return envelope?.contract === FOUNDATION_BRIDGE_CONTRACT && typeof envelope.ok === "boolean";
}

function defaultRecoverable(code) {
  return !new Set([
    "VERIFY_FAILED",
    "IDEMPOTENCY_CONFLICT",
    "INTERNAL_ERROR",
  ]).has(code);
}

function minimalRequest(input) {
  const budget =
    input && typeof input === "object" && input.budget && typeof input.budget === "object"
      ? normalizeBudget(input.budget)
      : FOUNDATION_BRIDGE_DEFAULT_BUDGET;
  return {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: typeof input?.id === "string" && input.id ? input.id : "cmd_invalid",
    undo: { mode: "none" },
    verification: { mode: "none", checks: [] },
    budget,
    idempotency_key: typeof input?.idempotency_key === "string" ? input.idempotency_key : undefined,
  };
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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

function pruneUndefined(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const entry of Object.values(value)) {
    deepFreeze(entry);
  }
  return value;
}
