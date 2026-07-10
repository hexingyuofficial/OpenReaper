import { constants as fsConstants } from "node:fs";
import { access, open, readFile, stat, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import {
  FOUNDATION_BRIDGE_CONTRACT,
  FOUNDATION_BRIDGE_DEFAULT_BUDGET,
  validateFoundationBridgeResult,
} from "../../core/src/foundation-bridge-v1.mjs";

export const LIVE_BRIDGE_EXECUTOR_CONTRACT = "live_bridge.executor.v1";
export const LIVE_BRIDGE_LIVENESS_CONTRACT = "openreaper.bridge_liveness.v1";
export const LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT = "live_bridge.liveness_probe.v1";
export const LIVE_BRIDGE_HEARTBEAT_FILENAME = "openreaper-bridge-liveness-v1.json";

export const LIVE_BRIDGE_LIVENESS_STATUS = Object.freeze({
  CONFIG_ABSENT: "bridge_config_absent",
  TRANSPORT_ABSENT: "bridge_transport_absent",
  ACTION_NOT_RUNNING: "bridge_action_not_running",
  LOOP_UNRESPONSIVE: "bridge_loop_unresponsive",
  READY: "bridge_ready",
  OWNER_MISMATCH: "bridge_owner_mismatch",
  GENERATION_MISMATCH: "bridge_generation_mismatch",
  HEARTBEAT_INVALID: "bridge_heartbeat_invalid",
  PROBE_INPUT_INVALID: "bridge_probe_input_invalid",
});

export const LIVE_BRIDGE_LIVENESS_DEFAULT_MAX_AGE_MS = 2_000;
export const LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS = 1_000;
export const LIVE_BRIDGE_LIVENESS_MAX_AGE_BOUNDS = Object.freeze({
  min: 500,
  max: 60_000,
});

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
const HEARTBEAT_MAX_BYTES = 2_048;
const HEARTBEAT_OWNER_MAX_LENGTH = 256;
const HEARTBEAT_SEQUENCE_MAX = 999_999_999;
const HEARTBEAT_TIME_MAX_UNIX_S = Math.floor(Number.MAX_SAFE_INTEGER / 1_000);
const HEARTBEAT_INTERVAL_BOUNDS_MS = Object.freeze({ min: 50, max: 5_000 });
const HEARTBEAT_FIELDS = Object.freeze([
  "active_generation",
  "active_owner",
  "contract",
  "interval_ms",
  "refreshed_at_unix_s",
  "sequence",
]);

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
    heartbeatMaxAgeMs: options.heartbeatMaxAgeMs,
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
  const heartbeatMaxAgeMs = normalizeHeartbeatMaxAge(options.heartbeatMaxAgeMs);
  const now = typeof options.now === "function" ? options.now : () => new Date();

  const config = deepFreeze({
    contract: LIVE_BRIDGE_EXECUTOR_CONTRACT,
    kind: "file_transport",
    transport_dir: transportDir,
    bridge_script_path: bridgeScriptPath,
    timeout_ms: timeoutMs,
    poll_interval_ms: pollIntervalMs,
    heartbeat_contract: LIVE_BRIDGE_LIVENESS_CONTRACT,
    heartbeat_filename: LIVE_BRIDGE_HEARTBEAT_FILENAME,
    heartbeat_max_age_ms: heartbeatMaxAgeMs,
    spawned_reaper: false,
  });

  async function probeLiveness(probeOptions = {}) {
    return probeLiveBridgeLiveness({
      transportDir,
      ...(Object.prototype.hasOwnProperty.call(probeOptions, "expectedOwner")
        ? { expectedOwner: probeOptions.expectedOwner }
        : {}),
      ...(Object.prototype.hasOwnProperty.call(probeOptions, "expectedGeneration")
        ? { expectedGeneration: probeOptions.expectedGeneration }
        : {}),
      maxAgeMs: probeOptions.maxAgeMs ?? heartbeatMaxAgeMs,
      now: probeOptions.now ?? now,
    });
  }

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
    probeLiveness,
  });
}

export async function probeLiveBridgeLiveness(options = {}) {
  const transportDir = normalizeNonEmptyString(options.transportDir);
  const maxAgeMs = normalizeHeartbeatMaxAge(options.maxAgeMs);
  const expectedIdentity = normalizeExpectedIdentity(options);
  const nowMs = safeNowMs(options.now);

  if (!expectedIdentity.valid) {
    return livenessResult({
      status: LIVE_BRIDGE_LIVENESS_STATUS.PROBE_INPUT_INVALID,
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath: transportDir ? join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME) : null,
      details: {
        reason: "expected_identity_invalid",
        invalid_fields: expectedIdentity.invalidFields,
      },
    });
  }

  if (!transportDir) {
    return livenessResult({
      status: LIVE_BRIDGE_LIVENESS_STATUS.CONFIG_ABSENT,
      maxAgeMs,
      expectedIdentity,
      transportDir: null,
      heartbeatPath: null,
      details: { missing: "transport_dir" },
    });
  }

  const requestsDir = join(transportDir, "requests");
  const resultsDir = join(transportDir, "results");
  for (const [missing, path] of [
    ["transport_dir", transportDir],
    ["requests_dir", requestsDir],
    ["results_dir", resultsDir],
  ]) {
    if (!(await isDirectory(path))) {
      return livenessResult({
        status: LIVE_BRIDGE_LIVENESS_STATUS.TRANSPORT_ABSENT,
        maxAgeMs,
        expectedIdentity,
        transportDir,
        heartbeatPath: join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME),
        details: {
          missing,
          requests_dir: requestsDir,
          results_dir: resultsDir,
        },
      });
    }
  }

  const heartbeatPath = join(transportDir, LIVE_BRIDGE_HEARTBEAT_FILENAME);
  const heartbeatRead = await readHeartbeatFileSafely({
    heartbeatPath,
    openFile:
      typeof options.__openHeartbeatFileForTest === "function"
        ? options.__openHeartbeatFileForTest
        : open,
  });
  if (!heartbeatRead.ok) {
    if (heartbeatRead.missing) {
      return livenessResult({
        status: LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING,
        maxAgeMs,
        expectedIdentity,
        transportDir,
        heartbeatPath,
      });
    }
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: heartbeatRead.reason,
      details: heartbeatRead.details,
    });
  }

  let heartbeat;
  try {
    heartbeat = JSON.parse(heartbeatRead.raw);
  } catch {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: "heartbeat_json_invalid",
    });
  }

  const heartbeatError = validateHeartbeat(heartbeat);
  if (heartbeatError) {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: heartbeatError,
    });
  }

  const fileMtimeMs = heartbeatRead.stat.mtimeMs;
  if (!Number.isFinite(fileMtimeMs)) {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: "heartbeat_freshness_invalid",
    });
  }
  if (fileMtimeMs - nowMs > LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS) {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: "heartbeat_mtime_in_future",
      details: { max_future_skew_ms: LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS },
    });
  }

  const refreshedAtMs = heartbeat.refreshed_at_unix_s * 1_000;
  if (refreshedAtMs - nowMs > LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS) {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: "heartbeat_time_in_future",
      details: { max_future_skew_ms: LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS },
    });
  }
  if (refreshedAtMs - fileMtimeMs > LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS) {
    return invalidHeartbeatResult({
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      reason: "heartbeat_time_after_file_mtime",
      details: { max_future_skew_ms: LIVE_BRIDGE_LIVENESS_FUTURE_SKEW_MS },
    });
  }

  const ageMs = Math.max(0, Math.floor(nowMs - fileMtimeMs));
  const observed = heartbeatObservation(heartbeat, fileMtimeMs, ageMs);

  if (ageMs > maxAgeMs) {
    return livenessResult({
      status: LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE,
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      observed,
    });
  }
  if (expectedIdentity.owner !== null && heartbeat.active_owner !== expectedIdentity.owner) {
    return livenessResult({
      status: LIVE_BRIDGE_LIVENESS_STATUS.OWNER_MISMATCH,
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      observed,
    });
  }
  if (
    expectedIdentity.generation !== null &&
    heartbeat.active_generation !== expectedIdentity.generation
  ) {
    return livenessResult({
      status: LIVE_BRIDGE_LIVENESS_STATUS.GENERATION_MISMATCH,
      maxAgeMs,
      expectedIdentity,
      transportDir,
      heartbeatPath,
      observed,
    });
  }

  return livenessResult({
    status: LIVE_BRIDGE_LIVENESS_STATUS.READY,
    maxAgeMs,
    expectedIdentity,
    transportDir,
    heartbeatPath,
    observed,
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

async function readHeartbeatFileSafely({ heartbeatPath, openFile }) {
  if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
    return {
      ok: false,
      reason: "heartbeat_nofollow_unavailable",
      details: {},
    };
  }

  const openFlags =
    fsConstants.O_RDONLY |
    fsConstants.O_NOFOLLOW |
    (Number.isInteger(fsConstants.O_NONBLOCK) ? fsConstants.O_NONBLOCK : 0);
  let handle;
  try {
    handle = await openFile(heartbeatPath, openFlags);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { ok: false, missing: true };
    }
    return {
      ok: false,
      reason: "heartbeat_open_failed",
      details: {
        error_code: boundedString(error?.code, 32),
      },
    };
  }

  try {
    const before = await handle.stat();
    const beforeError = validateHeartbeatFileStat(before);
    if (beforeError) return beforeError;

    const buffer = Buffer.alloc(HEARTBEAT_MAX_BYTES + 1);
    let bytesReadTotal = 0;
    while (bytesReadTotal < buffer.length) {
      const { bytesRead } = await handle.read(
        buffer,
        bytesReadTotal,
        buffer.length - bytesReadTotal,
        null,
      );
      if (
        !Number.isInteger(bytesRead) ||
        bytesRead < 0 ||
        bytesRead > buffer.length - bytesReadTotal
      ) {
        return {
          ok: false,
          reason: "heartbeat_read_invalid",
          details: {},
        };
      }
      if (bytesRead === 0) break;
      bytesReadTotal += bytesRead;
    }

    const after = await handle.stat();
    const afterError = validateHeartbeatFileStat(after);
    if (afterError) return afterError;
    if (!sameHeartbeatFileSnapshot(before, after)) {
      return {
        ok: false,
        reason: "heartbeat_changed_during_read",
        details: {},
      };
    }
    if (bytesReadTotal > HEARTBEAT_MAX_BYTES) {
      return heartbeatSizeInvalid(bytesReadTotal);
    }
    if (bytesReadTotal !== after.size) {
      return {
        ok: false,
        reason: "heartbeat_read_size_mismatch",
        details: {
          heartbeat_bytes: boundedFileSize(bytesReadTotal),
          stat_bytes: boundedFileSize(after.size),
        },
      };
    }

    return {
      ok: true,
      raw: buffer.subarray(0, bytesReadTotal).toString("utf8"),
      stat: after,
    };
  } catch (error) {
    return {
      ok: false,
      reason: "heartbeat_read_failed",
      details: {
        error_code: boundedString(error?.code, 32),
      },
    };
  } finally {
    try {
      await handle.close();
    } catch {
      // The bounded read result remains valid; the handle was still closed best-effort.
    }
  }
}

function validateHeartbeatFileStat(fileStat) {
  if (!fileStat || typeof fileStat.isFile !== "function" || !fileStat.isFile()) {
    return {
      ok: false,
      reason: "heartbeat_not_regular_file",
      details: {},
    };
  }
  if (!Number.isInteger(fileStat.nlink) || fileStat.nlink !== 1) {
    return {
      ok: false,
      reason: "heartbeat_link_count_invalid",
      details: {},
    };
  }
  if (
    !Number.isSafeInteger(fileStat.size) ||
    fileStat.size < 1 ||
    fileStat.size > HEARTBEAT_MAX_BYTES
  ) {
    return heartbeatSizeInvalid(fileStat.size);
  }
  if (!Number.isFinite(fileStat.mtimeMs) || !Number.isFinite(fileStat.ctimeMs)) {
    return {
      ok: false,
      reason: "heartbeat_freshness_invalid",
      details: {},
    };
  }
  return null;
}

function heartbeatSizeInvalid(size) {
  return {
    ok: false,
    reason: "heartbeat_size_invalid",
    details: {
      heartbeat_bytes: boundedFileSize(size),
      max_heartbeat_bytes: HEARTBEAT_MAX_BYTES,
    },
  };
}

function boundedFileSize(value) {
  if (!Number.isFinite(value)) return null;
  return Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)));
}

function sameHeartbeatFileSnapshot(before, after) {
  return (
    before.dev === after.dev &&
    before.ino === after.ino &&
    before.size === after.size &&
    before.mtimeMs === after.mtimeMs &&
    before.ctimeMs === after.ctimeMs
  );
}

function livenessResult({
  status,
  maxAgeMs,
  expectedIdentity,
  transportDir,
  heartbeatPath,
  observed = null,
  details = {},
}) {
  return deepFreeze({
    contract: LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT,
    status,
    ready: status === LIVE_BRIDGE_LIVENESS_STATUS.READY,
    configured: transportDir !== null,
    transport_dir: transportDir,
    heartbeat: {
      filename: LIVE_BRIDGE_HEARTBEAT_FILENAME,
      path: heartbeatPath,
      max_age_ms: maxAgeMs,
      observed,
    },
    expected: {
      owner: expectedIdentity.owner,
      generation: expectedIdentity.generation,
      owner_provided: expectedIdentity.ownerProvided,
      generation_provided: expectedIdentity.generationProvided,
    },
    details,
    spawned_reaper: false,
  });
}

function invalidHeartbeatResult({
  maxAgeMs,
  expectedIdentity,
  transportDir,
  heartbeatPath,
  reason,
  details = {},
}) {
  return livenessResult({
    status: LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID,
    maxAgeMs,
    expectedIdentity,
    transportDir,
    heartbeatPath,
    details: {
      reason,
      ...details,
    },
  });
}

function validateHeartbeat(heartbeat) {
  if (!isPlainObject(heartbeat)) return "heartbeat_not_object";
  const fields = Object.keys(heartbeat).sort();
  if (
    fields.length !== HEARTBEAT_FIELDS.length ||
    fields.some((field, index) => field !== HEARTBEAT_FIELDS[index])
  ) {
    return "heartbeat_fields_invalid";
  }
  if (heartbeat.contract !== LIVE_BRIDGE_LIVENESS_CONTRACT) return "heartbeat_contract_invalid";
  if (!isValidHeartbeatOwner(heartbeat.active_owner)) return "heartbeat_owner_invalid";
  if (!isBoundedNonNegativeInteger(heartbeat.active_generation, Number.MAX_SAFE_INTEGER)) {
    return "heartbeat_generation_invalid";
  }
  if (
    !isBoundedNonNegativeInteger(heartbeat.sequence, HEARTBEAT_SEQUENCE_MAX) ||
    heartbeat.sequence < 1
  ) {
    return "heartbeat_sequence_invalid";
  }
  if (!isBoundedNonNegativeInteger(heartbeat.refreshed_at_unix_s, HEARTBEAT_TIME_MAX_UNIX_S)) {
    return "heartbeat_time_invalid";
  }
  if (
    !isBoundedNonNegativeInteger(heartbeat.interval_ms, HEARTBEAT_INTERVAL_BOUNDS_MS.max) ||
    heartbeat.interval_ms < HEARTBEAT_INTERVAL_BOUNDS_MS.min
  ) {
    return "heartbeat_interval_invalid";
  }
  return null;
}

function heartbeatObservation(heartbeat, fileMtimeMs, ageMs) {
  return {
    contract: heartbeat.contract,
    active_owner: heartbeat.active_owner,
    active_generation: heartbeat.active_generation,
    sequence: heartbeat.sequence,
    refreshed_at_unix_s: heartbeat.refreshed_at_unix_s,
    interval_ms: heartbeat.interval_ms,
    file_mtime_ms: Math.floor(fileMtimeMs),
    age_ms: ageMs,
  };
}

function normalizeHeartbeatMaxAge(value) {
  if (!Number.isSafeInteger(value)) return LIVE_BRIDGE_LIVENESS_DEFAULT_MAX_AGE_MS;
  return Math.min(
    LIVE_BRIDGE_LIVENESS_MAX_AGE_BOUNDS.max,
    Math.max(LIVE_BRIDGE_LIVENESS_MAX_AGE_BOUNDS.min, value),
  );
}

function normalizeExpectedIdentity(options) {
  const ownerProvided = Object.prototype.hasOwnProperty.call(options, "expectedOwner");
  const generationProvided = Object.prototype.hasOwnProperty.call(options, "expectedGeneration");
  const invalidFields = [];
  let owner = null;
  let generation = null;

  if (ownerProvided) {
    if (isValidHeartbeatOwner(options.expectedOwner)) {
      owner = options.expectedOwner;
    } else {
      invalidFields.push("expected_owner");
    }
  }
  if (generationProvided) {
    if (isBoundedNonNegativeInteger(options.expectedGeneration, Number.MAX_SAFE_INTEGER)) {
      generation = options.expectedGeneration;
    } else {
      invalidFields.push("expected_generation");
    }
  }

  return {
    valid: invalidFields.length === 0,
    invalidFields,
    owner,
    generation,
    ownerProvided,
    generationProvided,
  };
}

function isValidHeartbeatOwner(value) {
  return (
    typeof value === "string" &&
    value.length >= 1 &&
    value.length <= HEARTBEAT_OWNER_MAX_LENGTH &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isBoundedNonNegativeInteger(value, maximum) {
  return Number.isSafeInteger(value) && value >= 0 && value <= maximum;
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

function safeNowMs(now) {
  try {
    const value = typeof now === "function" ? now() : now ?? new Date();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.getTime();
  } catch {
    // Fall through to a valid timestamp.
  }
  return Date.now();
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
