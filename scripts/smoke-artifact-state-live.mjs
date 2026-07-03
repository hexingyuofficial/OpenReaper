import { randomBytes } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  createArtifactRef,
  validateFoundationBridgeResult,
} from "../packages/core/src/foundation-bridge-v1.mjs";
import {
  ARTIFACT_STATE_STORE_CONTRACT,
  artifactIdFromCommandId,
  artifactPathFromRef,
  parseArtifactRef,
} from "../packages/core/src/artifact-state-store-v1.mjs";
import {
  createArtifactStateStoreEnvelope,
  writeArtifactStateStoreEnvelope,
} from "../packages/core/src/artifact-state-store-live-helper-v1.mjs";
import {
  GET_STATE_ARTIFACT_SCOPE,
  createGetStateArtifactRuntime,
} from "../packages/mcp-server/src/get-state-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutor,
} from "../packages/mcp-server/src/live-bridge-executor-v1.mjs";

export const ARTIFACT_STATE_LIVE_SMOKE_CONTRACT = "artifact.live_smoke.v1";
export const ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV = "OPENREAPER_ARTIFACT_STATE_LIVE_SMOKE";
export const ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV = "OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT";
export const ARTIFACT_STATE_LIVE_SMOKE_OPERATION = Object.freeze({
  family: "artifact_metadata",
  name: "artifact_state_store.write_canary",
});
export const ARTIFACT_STATE_LIVE_SMOKE_SCHEMA = "core.live_artifact_smoke.v1";
export const ARTIFACT_STATE_LIVE_SMOKE_PRODUCER = Object.freeze({
  kind: "template",
  id: "template.core.live_artifact_smoke_canary",
  pack: "core",
});
export const ARTIFACT_STATE_LIVE_SMOKE_SCOPE = "live_artifact_smoke";
export const ARTIFACT_STATE_LIVE_SMOKE_HELPER_SCRIPT_PATH = fileURLToPath(
  new URL("../reaper/bridge/openreaper-artifact-state-helper.lua", import.meta.url),
);

const OPT_IN_FLAG = "--live";
const FAKE_FLAG = "--fake";
const STATIC_FLAG = "--static";
const DEFAULT_OWNER = "openreaper-artifact-state-smoke";
const DEFAULT_GENERATION = 1;
const SESSION_ENV = "OPENREAPER_LIVE_BRIDGE_SESSION_ID";
const OWNER_ENV = "OPENREAPER_LIVE_BRIDGE_OWNER";
const GENERATION_ENV = "OPENREAPER_LIVE_BRIDGE_GENERATION";
const REQUEST_SEQUENCE = 451;

const args = new Set(process.argv.slice(2));
const mode = args.has(FAKE_FLAG) || args.has(STATIC_FLAG)
  ? "fake"
  : args.has(OPT_IN_FLAG) || process.env[ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV] === "1"
    ? "live"
    : "skip";

if (import.meta.url === `file://${process.argv[1]}`) {
  const report = await runArtifactStateLiveSmoke({ mode, env: process.env });
  console.log(JSON.stringify(report));
  process.exit(report.ok ? 0 : 2);
}

export async function runArtifactStateLiveSmoke({ mode: requestedMode = "skip", env = process.env } = {}) {
  if (requestedMode === "skip") return skippedReport();
  if (requestedMode === "fake") return runFakeArtifactSmoke();
  if (requestedMode !== "live") {
    return blockerReport({
      mode: requestedMode,
      reason: "artifact_smoke_mode_invalid",
      message: "Artifact live smoke mode must be skip, fake, or live.",
    });
  }

  const rootCheck = await checkConfiguredArtifactRoot(env[ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV]);
  if (!rootCheck.ok) {
    return blockerReport({
      mode: "live",
      reason: rootCheck.reason,
      message: rootCheck.message,
      details: rootCheck.details,
    });
  }

  const executorConfig = createArtifactBridgeExecutorFromEnv(env);
  if (!executorConfig.configured) {
    return blockerReport({
      mode: "live",
      reason: executorConfig.reason,
      message: "Opt-in artifact live smoke entered the gate, but no explicit live bridge transport was configured.",
      details: {
        live_executor_env: executorConfig.env,
      },
    });
  }

  const request = buildArtifactCanaryBridgeRequest({
    commandId: createSmokeCommandId(new Date(), REQUEST_SEQUENCE),
    context: liveContextBase(env),
  });
  const bridgeResult = await executorConfig.executor.dispatch(request);
  const bridgeSummary = summarizeBridgeResult(bridgeResult);
  if (!bridgeResult.ok) {
    return blockerReport({
      mode: "live",
      reason: bridgeSummary.reason,
      message: bridgeResult.error?.message ?? "Artifact live bridge canary failed.",
      details: {
        live_executor: executorConfig.config,
        bridge: bridgeSummary,
      },
      request,
    });
  }

  const readback = await readBackArtifact({
    artifactRoot: rootCheck.artifactRoot,
    artifactRef: request.params.artifact_ref,
  });
  if (!readback.ok) {
    return blockerReport({
      mode: "live",
      reason: "artifact_readback_failed",
      message: "Artifact helper wrote a bridge result, but get_state artifact readback failed.",
      details: {
        live_executor: executorConfig.config,
        bridge: bridgeSummary,
        readback,
      },
      request,
    });
  }

  return successReport({
    mode: "live",
    reason: "artifact_helper_live_canary_passed",
    artifactRoot: rootCheck.artifactRoot,
    request,
    bridge: bridgeSummary,
    readback,
    live_executor: executorConfig.config,
  });
}

export async function runFakeArtifactSmoke() {
  const artifactRoot = await mkdtemp(path.join(tmpdir(), "openreaper-layer4_5c-artifacts-"));
  const request = buildArtifactCanaryBridgeRequest({
    commandId: "cmd_20260703010203999_451_a4b5c6",
    context: {
      session_id: "openreaper-layer4_5c-fake",
      expected_owner: DEFAULT_OWNER,
      expected_generation: DEFAULT_GENERATION,
      created_at: "2026-07-03T01:02:03.999Z",
    },
  });
  const bridgeResult = await dispatchFakeArtifactCanary(request, { artifactRoot });
  const readback = await readBackArtifact({
    artifactRoot,
    artifactRef: request.params.artifact_ref,
  });

  return successReport({
    mode: "fake",
    reason: "artifact_helper_fake_shape_passed",
    artifactRoot,
    request,
    bridge: summarizeBridgeResult(bridgeResult),
    readback,
  });
}

export function buildArtifactCanaryBridgeRequest({ commandId, context = {} } = {}) {
  const id = commandId ?? createSmokeCommandId(new Date(), REQUEST_SEQUENCE);
  const artifactId = artifactIdFromCommandId(id);
  const ref = `artifact:core:${ARTIFACT_STATE_LIVE_SMOKE_SCOPE}:${artifactId}`;
  const createdAt = context.created_at ?? new Date().toISOString();
  const artifactRef = createArtifactRef({
    owner_pack: "core",
    scope: ARTIFACT_STATE_LIVE_SMOKE_SCOPE,
    id: artifactId,
    schema: ARTIFACT_STATE_LIVE_SMOKE_SCHEMA,
    summary: {
      helper: "lua_artifact_state_helper",
      layer: "4.5c",
    },
  });

  return {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id,
    created_at: createdAt,
    client: {
      id: "openreaper-layer4_5c-smoke",
      session_id: context.session_id ?? "openreaper-layer4_5c-smoke",
    },
    bridge: {
      expected_owner: context.expected_owner ?? DEFAULT_OWNER,
      expected_generation: context.expected_generation ?? DEFAULT_GENERATION,
    },
    operation: ARTIFACT_STATE_LIVE_SMOKE_OPERATION,
    pack: {
      id: "core",
      capability: "artifact_state_store.write_canary",
      risk: "read",
    },
    params: {
      artifact_ref: ref,
      schema: ARTIFACT_STATE_LIVE_SMOKE_SCHEMA,
      producer: ARTIFACT_STATE_LIVE_SMOKE_PRODUCER,
      summary: {
        label: "Layer 4.5C artifact helper canary",
        contract: ARTIFACT_STATE_STORE_CONTRACT,
        helper_only: true,
        proves: "artifact_helper_write_readback_only",
      },
      payload: {
        fixture: "layer4_5c_artifact_helper",
        readback_required: true,
        values: [1, 2, 3],
      },
    },
    refs: [artifactRef],
    undo: {
      mode: "none",
    },
    verification: {
      mode: "none",
      checks: [],
    },
    artifacts: {
      allow: true,
    },
    budget: { ...FOUNDATION_BRIDGE_DEFAULT_BUDGET },
    timeout_ms: 5_000,
  };
}

export async function dispatchFakeArtifactCanary(request, { artifactRoot } = {}) {
  const startedAt = "2026-07-03T01:02:03.999Z";
  const artifactRef = request?.params?.artifact_ref;
  const parts = parseArtifactRef(artifactRef);
  if (request.operation?.family !== ARTIFACT_STATE_LIVE_SMOKE_OPERATION.family
    || request.operation?.name !== ARTIFACT_STATE_LIVE_SMOKE_OPERATION.name) {
    return bridgeErrorEnvelope(request, "OPERATION_NOT_FOUND", "Unsupported fake artifact canary operation.", {
      startedAt,
      details: { operation: request.operation },
    });
  }
  if (request.artifacts?.allow !== true) {
    return bridgeErrorEnvelope(request, "REQUEST_INVALID", "Artifact canary requires artifacts.allow true.", {
      startedAt,
    });
  }
  const identityError = artifactCanaryIdentityError(request, parts);
  if (identityError) {
    return bridgeErrorEnvelope(request, "PARAMS_INVALID", identityError, {
      startedAt,
      details: {
        expected_owner_pack: "core",
        expected_scope: ARTIFACT_STATE_LIVE_SMOKE_SCOPE,
        expected_schema: ARTIFACT_STATE_LIVE_SMOKE_SCHEMA,
        expected_producer_id: ARTIFACT_STATE_LIVE_SMOKE_PRODUCER.id,
      },
    });
  }

  const envelope = createArtifactStateStoreEnvelope({
    ref: artifactRef,
    schema: request.params.schema,
    producer: request.params.producer,
    created_at: request.created_at,
    summary: request.params.summary,
    payload: request.params.payload,
  });
  const write = await writeArtifactStateStoreEnvelope({ artifactRoot, envelope });
  const artifact = createArtifactRef({
    owner_pack: parts.owner_pack,
    scope: parts.scope,
    id: parts.id,
    schema: request.params.schema,
    summary: {
      helper: "fake_artifact_state_helper",
      bytes: write.bytes,
    },
  });

  return bridgeOkEnvelope(request, startedAt, {
    summary: {
      kind: "artifact_state_store_live_canary",
      artifact_ref: artifactRef,
      schema: request.params.schema,
      helper_only: true,
      template_live_pass_proven: false,
    },
    artifacts: [artifact],
  });
}

function artifactCanaryIdentityError(request, parts) {
  if (parts.owner_pack !== "core" || parts.scope !== ARTIFACT_STATE_LIVE_SMOKE_SCOPE) {
    return "Layer 4.5C helper accepts only core live_artifact_smoke canary refs.";
  }
  if (request.params.schema !== ARTIFACT_STATE_LIVE_SMOKE_SCHEMA) {
    return "Layer 4.5C helper accepts only the core live artifact smoke schema.";
  }
  if (request.params.producer?.kind !== "template"
    || request.params.producer?.pack !== "core"
    || request.params.producer?.id !== ARTIFACT_STATE_LIVE_SMOKE_PRODUCER.id) {
    return "Layer 4.5C helper accepts only the live artifact smoke canary producer.";
  }
  if (request.params.summary?.contract !== ARTIFACT_STATE_STORE_CONTRACT
    || request.params.summary?.helper_only !== true
    || request.params.summary?.proves !== "artifact_helper_write_readback_only") {
    return "Layer 4.5C helper accepts only the live artifact smoke canary summary.";
  }
  if (request.params.payload?.fixture !== "layer4_5c_artifact_helper"
    || request.params.payload?.readback_required !== true) {
    return "Layer 4.5C helper accepts only the live artifact smoke canary payload.";
  }
  return null;
}

function skippedReport() {
  return {
    ...baseReport("skip"),
    ok: true,
    skipped: true,
    reason: "explicit_opt_in_required",
  };
}

function successReport({ mode: reportMode, reason, artifactRoot, request, bridge, readback, live_executor }) {
  return pruneUndefined({
    ...baseReport(reportMode),
    ok: true,
    skipped: false,
    reason,
    artifact_root: {
      configured: Boolean(artifactRoot),
      path: artifactRoot,
    },
    live_executor,
    request_shape: summarizeRequestShape(request),
    bridge,
    readback: summarizeReadback(readback),
    artifact_path: artifactRoot ? artifactPathFromRef(artifactRoot, request.params.artifact_ref) : undefined,
  });
}

function blockerReport({ mode: reportMode, reason, message, details, request }) {
  return pruneUndefined({
    ...baseReport(reportMode),
    ok: false,
    skipped: false,
    reason,
    message,
    blocker: reason,
    details,
    request_shape: request ? summarizeRequestShape(request) : undefined,
  });
}

function baseReport(reportMode) {
  return {
    contract: ARTIFACT_STATE_LIVE_SMOKE_CONTRACT,
    gate: "artifact-state-live-helper",
    mode: reportMode,
    opt_in_env: ARTIFACT_STATE_LIVE_SMOKE_OPT_IN_ENV,
    opt_in_flag: OPT_IN_FLAG,
    fake_flag: FAKE_FLAG,
    artifact_root_env: ARTIFACT_STATE_LIVE_SMOKE_ARTIFACT_ROOT_ENV,
    spawned_reaper: false,
    helper_default_enabled: false,
    allowed_operation: ARTIFACT_STATE_LIVE_SMOKE_OPERATION,
    attempted_template_ids: [],
    broad_live_smoke: false,
    call_template_bypass_added: false,
    live_pass_claimed: false,
    old_matrix_updated: false,
    proves: ["artifact_helper_write_shape", "artifact_get_state_readback"],
    does_not_prove: [
      "render_template_live_pass",
      "analysis_template_live_pass",
      "report_template_live_pass",
      "first_real_fixture_a_live_pass",
      "official_recipe_acceptance",
    ],
  };
}

async function checkConfiguredArtifactRoot(rawArtifactRoot) {
  const artifactRoot = nonEmpty(rawArtifactRoot);
  if (!artifactRoot) {
    return {
      ok: false,
      reason: "artifact_root_not_configured",
      message: "Artifact live smoke requires OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT.",
    };
  }
  if (artifactRoot.startsWith("file://") || !path.isAbsolute(artifactRoot)) {
    return {
      ok: false,
      reason: "artifact_root_invalid",
      message: "Artifact root must be an absolute filesystem path, not a file URL or relative path.",
      details: { artifact_root: boundedString(artifactRoot) },
    };
  }
  try {
    const info = await stat(artifactRoot);
    if (!info.isDirectory()) {
      return {
        ok: false,
        reason: "artifact_root_absent",
        message: "Configured artifact root is not a directory.",
        details: { artifact_root: boundedString(artifactRoot) },
      };
    }
    await access(artifactRoot, fsConstants.W_OK | fsConstants.R_OK);
  } catch (error) {
    return {
      ok: false,
      reason: "artifact_root_absent",
      message: "Configured artifact root is missing or not readable/writable.",
      details: {
        artifact_root: boundedString(artifactRoot),
        message: boundedString(error?.message),
      },
    };
  }
  return { ok: true, artifactRoot };
}

function createArtifactBridgeExecutorFromEnv(env) {
  const transportDir = nonEmpty(env[LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]);
  if (!transportDir) {
    return {
      configured: false,
      reason: "live_bridge_executor_not_configured",
      env: cloneJson(LIVE_BRIDGE_EXECUTOR_ENV),
      spawned_reaper: false,
    };
  }
  const bridgeScriptPath =
    nonEmpty(env[LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]) ??
    ARTIFACT_STATE_LIVE_SMOKE_HELPER_SCRIPT_PATH;
  const timeoutMs = positiveInteger(env[LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms], 5_000);
  const executor = createLiveBridgeExecutor({
    transportDir,
    bridgeScriptPath,
    timeoutMs,
  });
  return {
    configured: true,
    executor,
    config: executor.config,
    env: cloneJson(LIVE_BRIDGE_EXECUTOR_ENV),
    spawned_reaper: false,
  };
}

async function readBackArtifact({ artifactRoot, artifactRef }) {
  const runtime = createGetStateArtifactRuntime({ artifactRoot });
  const summary = await runtime.get_state({
    scope: GET_STATE_ARTIFACT_SCOPE,
    artifact_ref: artifactRef,
    view: "summary",
  });
  const payload = await runtime.get_state({
    scope: GET_STATE_ARTIFACT_SCOPE,
    artifact_ref: artifactRef,
    view: "payload",
  });
  return {
    ok: summary.ok === true && payload.ok === true,
    summary,
    payload,
  };
}

function summarizeRequestShape(request) {
  return {
    contract: request.contract,
    id: request.id,
    operation: request.operation,
    pack: request.pack,
    artifact_ref: request.params.artifact_ref,
    schema: request.params.schema,
    refs_count: request.refs.length,
    artifacts_allow: request.artifacts.allow,
    undo_mode: request.undo.mode,
    verification_mode: request.verification.mode,
    idempotency_key_present: Object.hasOwn(request, "idempotency_key"),
  };
}

function summarizeBridgeResult(result) {
  const blocker = result?.error?.details?.blocker;
  return {
    ok: Boolean(result?.ok),
    reason: result?.ok ? "bridge_result_ok" : blocker ?? result?.error?.code ?? "bridge_result_failed",
    code: result?.ok ? null : result?.error?.code ?? null,
    artifact_count: Array.isArray(result?.result?.artifacts) ? result.result.artifacts.length : 0,
    last_result_updated: Boolean(result?.result?.last_result?.updated),
    budget: {
      response_bytes: result?.budget?.response_bytes ?? null,
      truncated: Boolean(result?.budget?.truncated),
    },
  };
}

function summarizeReadback(readback) {
  return {
    ok: Boolean(readback?.ok),
    summary_ok: readback?.summary?.ok === true,
    payload_ok: readback?.payload?.ok === true,
    artifact_ref: readback?.summary?.result?.artifact?.ref ?? null,
    summary_view: readback?.summary?.result?.artifact?.view ?? null,
    payload_view: readback?.payload?.result?.artifact?.view ?? null,
    payload_fixture: readback?.payload?.result?.artifact?.payload?.fixture ?? null,
    last_result_updated: Boolean(readback?.summary?.last_result?.updated || readback?.payload?.last_result?.updated),
  };
}

function createSmokeCommandId(date, sequence) {
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
    String(date.getUTCHours()).padStart(2, "0"),
    String(date.getUTCMinutes()).padStart(2, "0"),
    String(date.getUTCSeconds()).padStart(2, "0"),
    String(date.getUTCMilliseconds()).padStart(3, "0"),
  ].join("");
  return `cmd_${stamp}_${String(sequence).padStart(3, "0")}_${randomBytes(3).toString("hex")}`;
}

function liveContextBase(env) {
  return {
    session_id: nonEmpty(env[SESSION_ENV]) ?? `openreaper-artifact-state-smoke-${process.pid}`,
    expected_owner: nonEmpty(env[OWNER_ENV]) ?? DEFAULT_OWNER,
    expected_generation: positiveInteger(env[GENERATION_ENV], DEFAULT_GENERATION),
    created_at: new Date().toISOString(),
  };
}

function bridgeOkEnvelope(request, startedAt, result) {
  const completedAt = "2026-07-03T01:02:04.000Z";
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: request.id,
    ok: true,
    completed_at: completedAt,
    bridge: {
      owner: request.bridge.expected_owner,
      generation: request.bridge.expected_generation,
    },
    queue: {
      state: "done",
      started_at: startedAt,
      completed_at: completedAt,
    },
    result: {
      summary: result.summary ?? {},
      refs: [],
      artifacts: result.artifacts ?? [],
      jobs: [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    },
    undo: {
      mode: request.undo.mode,
      opened: false,
      closed: false,
      label: null,
    },
    verification: {
      mode: request.verification.mode,
      status: "passed",
      checks: request.verification.checks ?? [],
    },
    budget: {
      max_response_bytes: request.budget.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  validateFoundationBridgeResult(envelope);
  return deepFreeze(envelope);
}

function bridgeErrorEnvelope(request, code, message, { startedAt, details } = {}) {
  const completedAt = "2026-07-03T01:02:04.000Z";
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: request?.id ?? "cmd_invalid",
    ok: false,
    completed_at: completedAt,
    bridge: {
      owner: request?.bridge?.expected_owner ?? DEFAULT_OWNER,
      generation: request?.bridge?.expected_generation ?? DEFAULT_GENERATION,
    },
    queue: {
      state: "failed",
      started_at: startedAt ?? completedAt,
      completed_at: completedAt,
    },
    error: {
      code,
      message,
      recoverable: true,
      details: details ?? {},
    },
    undo: {
      mode: request?.undo?.mode ?? "none",
      opened: false,
      closed: false,
      label: null,
    },
    verification: {
      mode: request?.verification?.mode ?? "none",
      status: "skipped",
      checks: request?.verification?.checks ?? [],
    },
    budget: {
      max_response_bytes: request?.budget?.max_response_bytes ?? FOUNDATION_BRIDGE_DEFAULT_BUDGET.max_response_bytes,
      response_bytes: 0,
      truncated: false,
    },
    idempotency: {
      key: null,
      replayed: false,
    },
  };
  envelope.budget.response_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  validateFoundationBridgeResult(envelope);
  return deepFreeze(envelope);
}

function nonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function positiveInteger(value, fallback) {
  const number = Number.parseInt(value, 10);
  return Number.isInteger(number) && number > 0 ? number : fallback;
}

function boundedString(value, maxLength = 240) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
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
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
