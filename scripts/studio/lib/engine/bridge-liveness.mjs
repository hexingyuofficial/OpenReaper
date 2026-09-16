import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";

export const BRIDGE_LIVENESS_CONTRACT = "openreaper.bridge_liveness.v1";
export const STARTUP_STATUS_CONTRACT = "openreaper.startup_status.v1";
export const BRIDGE_LIVENESS_MAX_AGE_MS = 35_000;
export const LIVE_STARTUP_STAGE = "bridge_dofile_succeeded";

export function defaultSessionRoot(installRoot) {
  return path.join(installRoot, "session");
}

export function defaultTransportDir(installRoot) {
  return path.join(defaultSessionRoot(installRoot), "transport");
}

export function bridgeLivenessPath(transportDir) {
  return path.join(transportDir, "openreaper-bridge-liveness-v1.json");
}

export function startupStatusPath(transportDir) {
  return path.join(transportDir, "openreaper-startup-status-v1.json");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readJsonFile(filePath) {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Same freshness rules as packaging `bridge_heartbeat_ready` (without requiring
 * owner/generation when Studio probes after the helper already exited).
 */
export function evaluateBridgeHeartbeat(heartbeat, { now = Date.now(), mtimeMs } = {}) {
  if (!heartbeat || heartbeat.contract !== BRIDGE_LIVENESS_CONTRACT) {
    return { ready: false, reason: "invalid_or_missing_heartbeat" };
  }
  if (!Number.isSafeInteger(heartbeat.sequence) || heartbeat.sequence < 1) {
    return { ready: false, reason: "heartbeat_sequence" };
  }
  if (!Number.isSafeInteger(heartbeat.refreshed_at_unix_s)) {
    return { ready: false, reason: "heartbeat_timestamp" };
  }
  const refreshedAge = now - heartbeat.refreshed_at_unix_s * 1_000;
  if (refreshedAge < -1_000 || refreshedAge > BRIDGE_LIVENESS_MAX_AGE_MS) {
    return { ready: false, reason: "heartbeat_stale" };
  }
  if (Number.isFinite(mtimeMs)) {
    const fileAge = now - mtimeMs;
    if (fileAge < -1_000 || fileAge > BRIDGE_LIVENESS_MAX_AGE_MS) {
      return { ready: false, reason: "heartbeat_file_stale" };
    }
  }
  return { ready: true, reason: "live" };
}

export function evaluateStartupStage(status) {
  const stage = typeof status?.stage === "string" ? status.stage : null;
  if (status?.contract !== STARTUP_STATUS_CONTRACT || !stage) {
    return { stage: null, loaded: false, reason: "missing_startup_status" };
  }
  return {
    stage,
    loaded: stage === LIVE_STARTUP_STAGE,
    reason: stage,
  };
}

/**
 * One-shot read of transport liveness + startup stage.
 * Usable when the Bridge heartbeat is live or dofile already succeeded.
 */
export async function inspectEngineTransport({ installRoot, transportDir, now = Date.now() } = {}) {
  const transport = transportDir || (installRoot ? defaultTransportDir(installRoot) : null);
  if (!transport) {
    return {
      usable: false,
      heartbeatReady: false,
      stage: null,
      reason: "no_transport_dir",
    };
  }

  const heartbeatFile = bridgeLivenessPath(transport);
  const statusFile = startupStatusPath(transport);
  let mtimeMs;
  if (existsSync(heartbeatFile)) {
    try {
      mtimeMs = (await stat(heartbeatFile)).mtimeMs;
    } catch {
      mtimeMs = undefined;
    }
  }
  const heartbeat = existsSync(heartbeatFile) ? await readJsonFile(heartbeatFile) : null;
  const status = existsSync(statusFile) ? await readJsonFile(statusFile) : null;
  const heartbeatEval = evaluateBridgeHeartbeat(heartbeat, { now, mtimeMs });
  const stageEval = evaluateStartupStage(status);
  const usable = heartbeatEval.ready || stageEval.loaded;
  return {
    usable,
    heartbeatReady: heartbeatEval.ready,
    stage: stageEval.stage,
    reason: usable
      ? heartbeatEval.ready
        ? "heartbeat_live"
        : "bridge_dofile_succeeded"
      : stageEval.stage
        ? `not_ready:${stageEval.stage}`
        : heartbeatEval.reason,
    transportDir: transport,
  };
}

/**
 * Probe transport files, optionally waiting a short grace so attach/budget
 * races can settle after openreaper-start exits.
 */
export async function probeOpenReaperEngine({
  installRoot,
  transportDir,
  now,
  graceMs = 8_000,
  pollMs = 250,
  log,
} = {}) {
  const first = await inspectEngineTransport({ installRoot, transportDir, now });
  if (first.usable) {
    return first;
  }
  const deadline = Date.now() + Math.max(0, graceMs);
  let last = first;
  while (Date.now() < deadline) {
    await sleep(pollMs);
    last = await inspectEngineTransport({ installRoot, transportDir, now });
    if (last.usable) {
      log?.(
        `Engine probe became usable during grace (stage=${last.stage ?? "unknown"} heartbeat=${last.heartbeatReady ? "live" : "no"}).`,
      );
      return last;
    }
  }
  return last;
}
