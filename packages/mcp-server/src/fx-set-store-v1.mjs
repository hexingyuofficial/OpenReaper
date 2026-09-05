import { createHash, randomUUID } from "node:crypto";

export const FX_SET_STORE_CONTRACT = "openreaper.fx_set_store.v1";
export const FX_SET_REF_PREFIX = "fx-set:v1:";
export const FX_PARAMETER_PLAN_REF_PREFIX = "fx-parameter-plan:v1:";
export const FX_SET_DEFAULT_TTL_MS = 10 * 60 * 1_000;
export const FX_SET_MAX_RECORDS = 128;

export function createFxSetStoreV1(options = {}) {
  const now = typeof options.now === "function" ? options.now : Date.now;
  const id = typeof options.randomUUID === "function" ? options.randomUUID : randomUUID;
  const ttlMs = boundedPositiveInteger(options.ttlMs, FX_SET_DEFAULT_TTL_MS);
  const sets = new Map();
  const plans = new Map();

  function putSet(input = {}) {
    purgeExpired();
    const members = Array.isArray(input.members) ? input.members.map(clone) : [];
    if (members.length < 1 || members.length > 64) {
      return failed("FX_SET_SIZE_INVALID", "An FX set must contain 1 through 64 trusted members.");
    }
    const authority = normalizeAuthority(input.authority);
    if (!authority.ok) return authority;
    const createdAtMs = nowMs(now);
    const fingerprintPayload = {
      authority: authority.value,
      track_ref: input.track_ref ?? null,
      plugin_identity: input.plugin_identity ?? null,
      layout_fingerprint: input.layout_fingerprint ?? null,
      members,
    };
    const setFingerprint = sha256(fingerprintPayload);
    const ref = `${FX_SET_REF_PREFIX}${id()}`;
    const record = deepFreeze({
      contract: FX_SET_STORE_CONTRACT,
      kind: "fx_set",
      ref,
      set_fingerprint: setFingerprint,
      created_at_ms: createdAtMs,
      expires_at_ms: createdAtMs + ttlMs,
      authority: authority.value,
      track_ref: input.track_ref ?? null,
      plugin_identity: clone(input.plugin_identity ?? null),
      layout_fingerprint: input.layout_fingerprint ?? null,
      representative_fx_ref: clone(input.representative_fx_ref ?? null),
      members,
    });
    evictForCapacity(sets);
    sets.set(ref, record);
    return { ok: true, record: clone(record) };
  }

  function getSet(ref, authority = {}) {
    purgeExpired();
    if (typeof ref !== "string" || !ref.startsWith(FX_SET_REF_PREFIX)) {
      return failed("FX_SET_REF_INVALID", "fx_set_ref must be one server-owned FX set ref.");
    }
    const record = sets.get(ref);
    if (!record) return failed("FX_SET_REF_UNKNOWN_OR_EXPIRED", "The FX set is unknown, expired, or belonged to a previous server process.");
    const match = matchAuthority(record.authority, authority, "FX_SET");
    return match.ok ? { ok: true, record: clone(record) } : match;
  }

  function putPlan(input = {}) {
    purgeExpired();
    const setResult = getSet(input.fx_set_ref, input.authority);
    if (!setResult.ok) return setResult;
    const controls = Array.isArray(input.controls) ? input.controls.map(clone) : [];
    if (controls.length < 1 || controls.length > 8) {
      return failed("FX_PARAMETER_PLAN_SIZE_INVALID", "A shared FX parameter plan must contain 1 through 8 controls.");
    }
    const createdAtMs = nowMs(now);
    const planHash = sha256({
      set_fingerprint: setResult.record.set_fingerprint,
      layout_fingerprint: setResult.record.layout_fingerprint,
      controls,
    });
    const ref = `${FX_PARAMETER_PLAN_REF_PREFIX}${id()}`;
    const record = deepFreeze({
      contract: FX_SET_STORE_CONTRACT,
      kind: "fx_parameter_plan",
      ref,
      plan_hash: planHash,
      created_at_ms: createdAtMs,
      expires_at_ms: Math.min(createdAtMs + ttlMs, setResult.record.expires_at_ms),
      authority: setResult.record.authority,
      fx_set_ref: setResult.record.ref,
      set_fingerprint: setResult.record.set_fingerprint,
      layout_fingerprint: setResult.record.layout_fingerprint,
      controls,
    });
    evictForCapacity(plans);
    plans.set(ref, record);
    return { ok: true, record: clone(record) };
  }

  function getPlan(ref, { authority = {}, fx_set_ref } = {}) {
    purgeExpired();
    if (typeof ref !== "string" || !ref.startsWith(FX_PARAMETER_PLAN_REF_PREFIX)) {
      return failed("FX_PARAMETER_PLAN_REF_INVALID", "parameter_plan_ref must be one server-owned FX parameter plan ref.");
    }
    const record = plans.get(ref);
    if (!record) return failed("FX_PARAMETER_PLAN_REF_UNKNOWN_OR_EXPIRED", "The FX parameter plan is unknown, expired, or belonged to a previous server process.");
    const match = matchAuthority(record.authority, authority, "FX_PARAMETER_PLAN");
    if (!match.ok) return match;
    if (typeof fx_set_ref === "string" && record.fx_set_ref !== fx_set_ref) {
      return failed("FX_PARAMETER_PLAN_SET_MISMATCH", "The parameter plan belongs to a different FX set.");
    }
    const setResult = getSet(record.fx_set_ref, authority);
    if (!setResult.ok) return setResult;
    if (setResult.record.set_fingerprint !== record.set_fingerprint
        || setResult.record.layout_fingerprint !== record.layout_fingerprint) {
      return failed("FX_PARAMETER_PLAN_STALE", "The parameter plan no longer matches its FX set membership or layout.");
    }
    return { ok: true, record: clone(record), set: setResult.record };
  }

  function purgeExpired() {
    const current = nowMs(now);
    for (const [ref, record] of sets) {
      if (record.expires_at_ms <= current) sets.delete(ref);
    }
    for (const [ref, record] of plans) {
      if (record.expires_at_ms <= current || !sets.has(record.fx_set_ref)) plans.delete(ref);
    }
  }

  return Object.freeze({
    contract: FX_SET_STORE_CONTRACT,
    putSet,
    getSet,
    putPlan,
    getPlan,
    purgeExpired,
  });
}

export function fxSetAuthorityFromRequest(request = {}, projectIndexRuntime = null) {
  const identity = projectIndexRuntime?.identity ?? {};
  return {
    bridge_owner: request?.bridge?.expected_owner
      ?? request?.context?.expected_owner
      ?? request?.context?.bridge_owner
      ?? identity.bridge_owner
      ?? identity.bridgeOwner
      ?? null,
    bridge_generation: request?.bridge?.expected_generation
      ?? request?.context?.expected_generation
      ?? request?.context?.bridge_generation
      ?? identity.bridge_generation
      ?? identity.bridgeGeneration
      ?? null,
    project_ref: identity.project_ref ?? identity.projectRef ?? null,
  };
}

function normalizeAuthority(value = {}) {
  const bridgeOwner = value?.bridge_owner;
  const bridgeGeneration = value?.bridge_generation;
  if (typeof bridgeOwner !== "string" || bridgeOwner.length < 1) {
    return failed("FX_SET_BRIDGE_OWNER_REQUIRED", "FX set creation requires the authoritative Bridge owner.");
  }
  if (!Number.isSafeInteger(bridgeGeneration) || bridgeGeneration < 0) {
    return failed("FX_SET_BRIDGE_GENERATION_REQUIRED", "FX set creation requires the authoritative Bridge generation.");
  }
  return {
    ok: true,
    value: deepFreeze({
      bridge_owner: bridgeOwner,
      bridge_generation: bridgeGeneration,
      project_ref: typeof value.project_ref === "string" && value.project_ref ? value.project_ref : null,
    }),
  };
}

function matchAuthority(expected, actual = {}, prefix) {
  if (actual.bridge_owner !== expected.bridge_owner) {
    return failed(`${prefix}_BRIDGE_OWNER_STALE`, "The server-owned FX state belongs to a different Bridge owner.");
  }
  if (actual.bridge_generation !== expected.bridge_generation) {
    return failed(`${prefix}_BRIDGE_GENERATION_STALE`, "The server-owned FX state belongs to a stale Bridge generation.");
  }
  if (expected.project_ref && actual.project_ref !== expected.project_ref) {
    return failed(`${prefix}_PROJECT_STALE`, "The server-owned FX state belongs to a different project.");
  }
  return { ok: true };
}

function evictForCapacity(map) {
  while (map.size >= FX_SET_MAX_RECORDS) map.delete(map.keys().next().value);
}

function nowMs(now) {
  const value = now();
  const millis = value instanceof Date ? value.getTime() : Number(value);
  return Number.isFinite(millis) ? millis : Date.now();
}

function sha256(value) {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function boundedPositiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function failed(code, message) {
  return { ok: false, code, message, blockers: [{ code, message, recoverable: true }], zero_write: true };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
