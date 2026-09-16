import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { studioDir } from "../face/runtime-config.mjs";

export function studioPiRpcEndpointPath(homeDir) {
  return path.join(studioDir(homeDir), "pi-rpc-endpoint-v1.json");
}

export function resolvePiRpcHostScript(repoRoot) {
  return path.join(repoRoot, "scripts", "studio", "studio-pi-rpc-host.mjs");
}

async function readEndpointFile(endpointFile) {
  if (!existsSync(endpointFile)) {
    return null;
  }
  try {
    return JSON.parse(await readFile(endpointFile, "utf8"));
  } catch {
    return null;
  }
}

function endpointSnapshot(parsed, endpointFile, { reused = false, logPath = null } = {}) {
  return {
    hostPid: parsed?.hostPid ?? null,
    piPid: parsed?.piPid ?? null,
    promptUrl: parsed?.promptUrl ?? null,
    commandsUrl: parsed?.commandsUrl ?? null,
    healthUrl: parsed?.healthUrl ?? null,
    endpointFile,
    logPath,
    reused,
  };
}

/**
 * Reuse a healthy studio-pi-rpc-host already bound to the endpoint file.
 * Prevents a second orphan host from fighting one URL.
 */
export async function adoptLivePiRpcEndpoint(endpointFile, { logPath = null } = {}) {
  const parsed = await readEndpointFile(endpointFile);
  if (!parsed?.healthUrl) {
    return null;
  }
  if (!(await probePiRpcHealth(parsed.healthUrl))) {
    return null;
  }
  return endpointSnapshot(parsed, endpointFile, { reused: true, logPath });
}

/**
 * SIGTERM a recorded host that is alive but no longer healthy so Start can
 * bind a single new host to the endpoint file.
 */
export async function stopStalePiRpcHost(endpointFile, log) {
  const parsed = await readEndpointFile(endpointFile);
  const pid = parsed?.hostPid;
  if (!Number.isInteger(pid) || pid <= 0) {
    return { stopped: false, reason: "no_host_pid" };
  }
  try {
    process.kill(pid, 0);
  } catch {
    return { stopped: false, reason: "host_not_running" };
  }
  log?.(`Stopping stale private Pi RPC host pid=${pid} (endpoint health failed).`);
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    log?.(`Could not signal stale RPC host pid=${pid} (${error?.message ?? error}).`);
    return { stopped: false, reason: "signal_failed" };
  }
  return { stopped: true, hostPid: pid };
}

/**
 * Detach studio-pi-rpc-host.mjs and poll until the endpoint file is written + /health OK.
 * Reuses a live host on the same endpoint file instead of spawning a duplicate.
 */
export async function launchPrivatePiRpcHost({
  nodeCommand,
  repoRoot,
  env,
  homeDir,
  log,
  timeoutMs = 30_000,
}) {
  const hostScript = resolvePiRpcHostScript(repoRoot);
  if (!existsSync(hostScript)) {
    throw new Error(`Private Pi RPC host script missing: ${hostScript}`);
  }
  const endpointFile = studioPiRpcEndpointPath(homeDir);
  const logPath = path.join(studioDir(homeDir), "logs", "studio-pi-rpc-host.log");

  const existing = await adoptLivePiRpcEndpoint(endpointFile, { logPath });
  if (existing) {
    log?.(
      `Reusing private Pi RPC host pid=${existing.hostPid} promptUrl=${existing.promptUrl} (no duplicate spawn).`,
    );
    return existing;
  }
  await stopStalePiRpcHost(endpointFile, log);

  const child = spawn(nodeCommand, [hostScript, "--endpoint-file", endpointFile], {
    detached: true,
    stdio: ["ignore", "ignore", "ignore"],
    env: { ...env, OPENREAPER_STUDIO: "1" },
  });
  child.unref();

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(endpointFile)) {
      try {
        const raw = await readFile(endpointFile, "utf8");
        const parsed = JSON.parse(raw);
        const healthUrl = parsed?.healthUrl;
        if (healthUrl) {
          const health = await fetch(healthUrl, { signal: AbortSignal.timeout(2000) }).catch(
            () => null,
          );
          if (health?.ok) {
            return {
              hostPid: parsed.hostPid ?? child.pid,
              piPid: parsed.piPid ?? null,
              promptUrl: parsed.promptUrl,
              commandsUrl: parsed.commandsUrl ?? null,
              healthUrl,
              endpointFile,
              logPath,
              reused: false,
            };
          }
        }
      } catch {
        /* retry */
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 200));
  }

  try {
    process.kill(child.pid, "SIGTERM");
  } catch {
    /* ignore */
  }
  throw new Error(
    "Private Pi RPC host did not become ready in time. Check ~/.openreaper/studio/logs/ " +
      "and ensure `pi` runs with --mode rpc.",
  );
}

export async function probePiRpcHealth(healthUrl) {
  try {
    const response = await fetch(healthUrl, { signal: AbortSignal.timeout(1500) });
    return response.ok;
  } catch {
    return false;
  }
}
