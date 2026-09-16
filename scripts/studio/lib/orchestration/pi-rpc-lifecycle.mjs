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

/**
 * Detach studio-pi-rpc-host.mjs and poll until the endpoint file is written + /health OK.
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
