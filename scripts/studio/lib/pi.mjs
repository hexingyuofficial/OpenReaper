import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const DEFAULT_PI_AGENT_DIR = path.join(os.homedir(), ".pi", "agent");
const DEFAULT_PI_MCP_JSON = path.join(DEFAULT_PI_AGENT_DIR, "mcp.json");

/**
 * Locate the `pi` executable without mutating PATH permanently.
 */
export function resolvePiExecutable(env = process.env) {
  const pathValue = env.PATH ?? "";
  const segments = pathValue.split(path.delimiter).filter(Boolean);
  const extra = [
    path.join(os.homedir(), ".npm-global", "bin"),
    path.join(os.homedir(), ".local", "bin"),
  ];
  for (const dir of [...extra, ...segments]) {
    const candidate = path.join(dir, process.platform === "win32" ? "pi.cmd" : "pi");
    if (existsSync(candidate)) {
      return candidate;
    }
    const plain = path.join(dir, "pi");
    if (existsSync(plain)) {
      return plain;
    }
  }
  return null;
}

export function defaultPiAgentDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".pi", "agent");
}

export function defaultPiMcpJsonPath(homeDir = os.homedir()) {
  return path.join(defaultPiAgentDir(homeDir), "mcp.json");
}

/**
 * Read Pi MCP config if present. Never writes or merges — Studio only inspects.
 */
export async function readPiMcpConfig(mcpJsonPath = DEFAULT_PI_MCP_JSON) {
  if (!existsSync(mcpJsonPath)) {
    return { exists: false, path: mcpJsonPath, openreaperConfigured: false, serverKeys: [] };
  }
  let parsed;
  try {
    parsed = JSON.parse(await readFile(mcpJsonPath, "utf8"));
  } catch {
    return {
      exists: true,
      path: mcpJsonPath,
      openreaperConfigured: false,
      serverKeys: [],
      parseError: true,
    };
  }
  const servers = parsed?.mcpServers ?? parsed?.servers ?? {};
  const serverKeys = Object.keys(servers);
  const openreaperConfigured = serverKeys.some((key) => {
    const normalized = key.toLowerCase();
    return normalized === "openreaper" || normalized.includes("openreaper");
  });
  return {
    exists: true,
    path: mcpJsonPath,
    openreaperConfigured,
    serverKeys,
    parseError: false,
  };
}

export function buildPiStartPlan({ piExecutable, env = process.env }) {
  if (!piExecutable) {
    return {
      mode: "absent",
      message:
        "Pi was not found on PATH. Install Pi (https://pi.dev) or set PATH to include your pi binary. Studio did not create or modify ~/.pi.",
    };
  }
  if (env.OPENREAPER_STUDIO_SKIP_PI === "1") {
    return {
      mode: "skipped",
      message: "OPENREAPER_STUDIO_SKIP_PI=1 — Pi was not started by Studio.",
      piExecutable,
    };
  }
  const args = ["--mode", "rpc"];
  if (env.OPENREAPER_STUDIO_PI_ARGS?.trim()) {
    const extra = env.OPENREAPER_STUDIO_PI_ARGS.trim().split(/\s+/).filter(Boolean);
    args.push(...extra);
  }
  return {
    mode: "start",
    piExecutable,
    command: piExecutable,
    args,
    logLabel: "pi-rpc",
  };
}
