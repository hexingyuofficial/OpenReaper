import { existsSync } from "node:fs";
import { readFile, unlink } from "node:fs/promises";
import path from "node:path";

export function processIsAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

export function parsePidFileText(text) {
  const line = String(text ?? "")
    .trim()
    .split(/\s+/)[0];
  const pid = Number(line);
  return Number.isInteger(pid) && pid > 0 ? pid : null;
}

export function reaperPidFilePath(installRoot) {
  if (!installRoot) {
    return null;
  }
  return path.join(installRoot, "session", "reaper.pid");
}

export async function readPidFile(filePath) {
  if (!filePath || !existsSync(filePath)) {
    return null;
  }
  try {
    return parsePidFileText(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

export function signalPid(pid, signal = "SIGTERM") {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { signaled: false, reason: "invalid_pid" };
  }
  try {
    process.kill(pid, signal);
    return { signaled: true, pid, signal };
  } catch (error) {
    return {
      signaled: false,
      pid,
      reason: error?.code === "ESRCH" ? "not_running" : error?.message ?? String(error),
    };
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitUntilDead(pid, { timeoutMs = 5000, pollMs = 50 } = {}) {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid)) {
    if (Date.now() >= deadline) {
      return false;
    }
    await sleep(pollMs);
  }
  return true;
}

export async function terminatePid(pid, { timeoutMs = 5000 } = {}) {
  if (!Number.isInteger(pid) || pid <= 0) {
    return { pid, alreadyDead: true, killed: false, reason: "invalid_pid" };
  }
  if (!processIsAlive(pid)) {
    return { pid, alreadyDead: true, killed: false };
  }
  signalPid(pid, "SIGTERM");
  const dead = await waitUntilDead(pid, { timeoutMs });
  if (!dead && processIsAlive(pid)) {
    signalPid(pid, "SIGKILL");
    await waitUntilDead(pid, { timeoutMs: Math.min(1000, timeoutMs) });
  }
  return { pid, alreadyDead: false, killed: !processIsAlive(pid) };
}

export async function unlinkIfExists(filePath) {
  if (!filePath) {
    return false;
  }
  try {
    await unlink(filePath);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

/**
 * SIGTERM the RPC host (which owns Pi), wait, kill leftovers, drop the endpoint file.
 */
export async function stopStudioSteward({
  hostPid,
  piPid,
  endpointFile,
  timeoutMs = 5000,
} = {}) {
  const results = { host: null, pi: null, endpointRemoved: false };
  if (hostPid) {
    results.host = await terminatePid(hostPid, { timeoutMs });
  }
  if (piPid && processIsAlive(piPid)) {
    results.pi = await terminatePid(piPid, { timeoutMs: Math.min(timeoutMs, 2000) });
  }
  if (endpointFile) {
    results.endpointRemoved = await unlinkIfExists(endpointFile);
  }
  return results;
}

/**
 * Watch REAPER. If the pid dies, re-read the helper pid file (LaunchServices
 * successor adopt) during graceMs before tearing the steward down.
 * Missing pid + missing file does not stop Pi (engineDegraded / attach path).
 */
export function watchReaperPeer({
  pid = null,
  pidFile = null,
  onGone,
  intervalMs = 1000,
  graceMs = 8000,
  now = Date.now,
  isAlive = processIsAlive,
  readPid = readPidFile,
} = {}) {
  let stopped = false;
  let currentPid = Number.isInteger(pid) && pid > 0 ? pid : null;
  let goneSince = null;
  let timer = null;

  async function tick() {
    if (stopped) {
      return;
    }
    const filePid = pidFile ? await readPid(pidFile) : null;
    if (filePid && filePid !== currentPid) {
      currentPid = filePid;
      goneSince = null;
    }
    const alive = currentPid ? isAlive(currentPid) : false;
    if (alive) {
      goneSince = null;
      return;
    }
    if (!currentPid && !filePid) {
      goneSince = null;
      return;
    }
    if (goneSince == null) {
      goneSince = now();
      return;
    }
    if (now() - goneSince >= graceMs) {
      stopped = true;
      if (timer) {
        clearInterval(timer);
      }
      onGone?.({ pid: currentPid, pidFile, reason: "reaper_exited" });
    }
  }

  timer = setInterval(() => {
    tick().catch(() => {});
  }, intervalMs);
  if (typeof timer.unref === "function") {
    timer.unref();
  }

  return {
    stop() {
      stopped = true;
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
    },
    getPid: () => currentPid,
    tick,
  };
}
