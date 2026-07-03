import { constants as fsConstants } from "node:fs";
import { access, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  validateFoundationBridgeResult,
} from "../../core/src/foundation-bridge-v1.mjs";

export const LIVE_BRIDGE_EXECUTOR_CONTRACT = "live_bridge.executor.v1";

export const LIVE_BRIDGE_EXECUTOR_ENV = Object.freeze({
  transport_dir: "OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR",
  bridge_script_path: "OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH",
  timeout_ms: "OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS",
});

export const LIVE_BRIDGE_EXECUTOR_BLOCKERS = Object.freeze([
  "live_bridge_executor_not_configured",
  "live_bridge_transport_absent",
  "reaper_bridge_script_absent",
  "live_bridge_handshake_failed",
  "live_bridge_request_write_failed",
  "live_bridge_result_invalid",
]);

const DEFAULT_REAPER_BRIDGE_SCRIPT_PATH = resolve(
  new URL("../../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url).pathname,
);
const DEFAULT_TIMEOUT_MS = 5_000;
const DEFAULT_POLL_INTERVAL_MS = 100;
const REQUEST_ID_PATTERN = /^cmd_[A-Za-z0-9_]+$/;

export function createLiveBridgeExecutorFromEnv(env = process.env, options = {}) {
  const transportDir = normalizeNonEmptyString(env[LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]);
  if (!transportDir) {
    return deepFreeze({
      configured: false,
      reason: "live_bridge_executor_not_configured",
      env: cloneJson(LIVE_BRIDGE_EXECUTOR_ENV),
      spawned_reaper: false,
    });
  }

  const bridgeScriptPath =
    normalizeNonEmptyString(env[LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]) ??
    options.bridgeScriptPath ??
    DEFAULT_REAPER_BRIDGE_SCRIPT_PATH;
  const timeoutMs = normalizePositiveInteger(
    env[LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms],
    options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
  );
  const executor = createLiveBridgeExecutor({
    transportDir,
    bridgeScriptPath,
    timeoutMs,
    pollIntervalMs: options.pollIntervalMs,
    now: options.now,
  });

  return deepFreeze({
    configured: true,
    executor,
    config: executor.config,
    env: cloneJson(LIVE_BRIDGE_EXECUTOR_ENV),
    spawned_reaper: false,
  });
}

export function createLiveBridgeExecutor(options = {}) {
  const transportDir = normalizeNonEmptyString(options.transportDir);
  const bridgeScriptPath =
    normalizeNonEmptyString(options.bridgeScriptPath) ?? DEFAULT_REAPER_BRIDGE_SCRIPT_PATH;
  const timeoutMs = normalizePositiveInteger(options.timeoutMs, DEFAULT_TIMEOUT_MS);
  const pollIntervalMs = normalizePositiveInteger(options.pollIntervalMs, DEFAULT_POLL_INTERVAL_MS);
  const now = typeof options.now === "function" ? options.now : () => new Date();

  const config = deepFreeze({
    contract: LIVE_BRIDGE_EXECUTOR_CONTRACT,
    kind: "file_transport",
    transport_dir: transportDir,
    bridge_script_path: bridgeScriptPath,
    timeout_ms: timeoutMs,
    poll_interval_ms: pollIntervalMs,
    spawned_reaper: false,
  });

  async function dispatch(request) {
    const startedAt = safeNowIso(now);
    if (!transportDir) {
      return bridgeBlockerEnvelope(request, {
        blocker: "live_bridge_executor_not_configured",
        message: "Live bridge executor requires an explicit transport directory.",
        startedAt,
        now,
      });
    }

    const transportCheck = await checkTransport({ transportDir, bridgeScriptPath });
    if (transportCheck.blocker) {
      return bridgeBlockerEnvelope(request, {
        ...transportCheck,
        startedAt,
        now,
      });
    }

    const paths = transportPaths(transportDir, request?.id);
    try {
      await writeFile(paths.request, `${JSON.stringify(request)}\n`, { flag: "wx" });
    } catch (error) {
      return bridgeBlockerEnvelope(request, {
        blocker: "live_bridge_request_write_failed",
        message: "Live bridge request could not be written to the configured transport.",
        details: {
          request_path: paths.request,
          message: boundedString(error?.message),
        },
        recoverable: true,
        startedAt,
        now,
      });
    }

    return waitForBridgeResult({
      request,
      resultPath: paths.result,
      timeoutMs: Math.min(timeoutMs, request?.timeout_ms ?? timeoutMs),
      pollIntervalMs,
      startedAt,
      now,
    });
  }

  return deepFreeze({
    contract: LIVE_BRIDGE_EXECUTOR_CONTRACT,
    config,
    spawned_reaper: false,
    dispatch,
  });
}

async function checkTransport({ transportDir, bridgeScriptPath }) {
  const requestsDir = join(transportDir, "requests");
  const resultsDir = join(transportDir, "results");
  for (const [label, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) {
      return {
        blocker: "live_bridge_transport_absent",
        message: "Configured live bridge transport directory is absent or incomplete.",
        details: {
          missing: label,
          transport_dir: transportDir,
          requests_dir: requestsDir,
          results_dir: resultsDir,
        },
        recoverable: true,
      };
    }
  }

  if (!(await isReadableFile(bridgeScriptPath))) {
    return {
      blocker: "reaper_bridge_script_absent",
      message: "Configured REAPER bridge script is absent; live bridge transport cannot handshake.",
      details: {
        bridge_script_path: bridgeScriptPath,
      },
      recoverable: true,
    };
  }

  return {};
}

async function waitForBridgeResult({ request, resultPath, timeoutMs, pollIntervalMs, startedAt, now }) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    try {
      const raw = await readFile(resultPath, "utf8");
      const result = JSON.parse(raw);
      validateFoundationBridgeResult(result);
      return result;
    } catch (error) {
      if (error?.code === "ENOENT") {
        await sleep(pollIntervalMs);
        continue;
      }
      return bridgeBlockerEnvelope(request, {
        blocker: "live_bridge_result_invalid",
        message: "Live bridge returned an invalid foundation.bridge.v1 result.",
        details: {
          result_path: resultPath,
          message: boundedString(error?.message),
        },
        recoverable: false,
        startedAt,
        now,
      });
    }
  }

  return bridgeBlockerEnvelope(request, {
    blocker: "live_bridge_handshake_failed",
    code: "BRIDGE_TIMEOUT",
    message: "Timed out waiting for a live bridge result at the configured transport.",
    details: {
      result_path: resultPath,
      timeout_ms: timeoutMs,
    },
    recoverable: true,
    queueState: "timeout",
    startedAt,
    now,
  });
}

function transportPaths(transportDir, requestId) {
  const safeId = typeof requestId === "string" && REQUEST_ID_PATTERN.test(requestId)
    ? requestId
    : "cmd_invalid";
  return {
    request: join(transportDir, "requests", `${safeId}.json`),
    result: join(transportDir, "results", `${safeId}.json`),
  };
}

function bridgeBlockerEnvelope(request, options) {
  return bridgeErrorEnvelope(request, {
    code: options.code ?? "BRIDGE_NOT_RUNNING",
    message: options.message,
    recoverable: options.recoverable ?? true,
    queueState: options.queueState ?? "failed",
    startedAt: options.startedAt,
    details: {
      blocker: options.blocker,
      executor_contract: LIVE_BRIDGE_EXECUTOR_CONTRACT,
      spawned_reaper: false,
      ...(options.details ?? {}),
    },
    now: options.now,
  });
}

function bridgeErrorEnvelope(request, options) {
  const completedAt = safeNowIso(options.now);
  const normalizedRequest = minimalRequest(request);
  const envelope = {
    contract: FOUNDATION_BRIDGE_CONTRACT,
    id: normalizedRequest.id,
    ok: false,
    completed_at: completedAt,
    bridge: {
      owner: normalizedRequest.bridge.expected_owner,
      generation: normalizedRequest.bridge.expected_generation,
    },
    queue: {
      state: options.queueState,
      started_at: options.startedAt ?? completedAt,
      completed_at: completedAt,
    },
    error: {
      code: options.code,
      message: options.message,
      recoverable: Boolean(options.recoverable),
      details: options.details,
    },
    undo: undoResult(normalizedRequest),
    verification: verificationResult(normalizedRequest, "skipped"),
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
  envelope.budget.response_bytes = encodedBytes(envelope);
  validateFoundationBridgeResult(envelope);
  return deepFreeze(envelope);
}

function minimalRequest(request) {
  const bridge = isPlainObject(request?.bridge) ? request.bridge : {};
  const budget = isPlainObject(request?.budget) ? request.budget : FOUNDATION_BRIDGE_DEFAULT_BUDGET;
  return {
    id: typeof request?.id === "string" && request.id ? request.id : "cmd_invalid",
    bridge: {
      expected_owner:
        typeof bridge.expected_owner === "string" && bridge.expected_owner
          ? bridge.expected_owner
          : "openreaper-live-bridge-unknown",
      expected_generation:
        Number.isInteger(bridge.expected_generation) && bridge.expected_generation >= 0
          ? bridge.expected_generation
          : 0,
    },
    undo: isPlainObject(request?.undo) ? request.undo : { mode: "none" },
    verification: isPlainObject(request?.verification)
      ? request.verification
      : { mode: "none", checks: [] },
    budget: {
      ...FOUNDATION_BRIDGE_DEFAULT_BUDGET,
      ...budget,
    },
    idempotency_key: typeof request?.idempotency_key === "string" ? request.idempotency_key : undefined,
  };
}

function undoResult(request) {
  const mode = request.undo?.mode ?? "none";
  return {
    mode,
    opened: false,
    closed: false,
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

async function isDirectory(path) {
  if (!path) return false;
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

async function isReadableFile(path) {
  if (!path) return false;
  try {
    await access(path, fsConstants.R_OK);
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

function normalizeNonEmptyString(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : resolve(trimmed);
}

function normalizePositiveInteger(value, fallback) {
  const number = typeof value === "number" ? value : Number.parseInt(value, 10);
  if (!Number.isInteger(number) || number < 1) return fallback;
  return number;
}

function sleep(ms) {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

function safeNowIso(now) {
  try {
    const value = typeof now === "function" ? now() : new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function boundedString(value, maxLength = 200) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  return string.length <= maxLength ? string : `${string.slice(0, maxLength - 3)}...`;
}

function encodedBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
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
