import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  resolveStudioPiLayout,
  studioPiMcpJsonPath,
  userPersonalPiAgentDir,
} from "./pi/private-layout.mjs";
import { resolveStudioPiExtensionFlags } from "./pi/extension.mjs";
import { repoRootFromStudio } from "./paths.mjs";

/**
 * Locate the `pi` executable without mutating PATH permanently.
 * Prefer OPENREAPER_STUDIO_PI_BIN, then bundled vendor layout, then PATH.
 */
export function resolvePiExecutable(env = process.env, layout = null) {
  if (env.OPENREAPER_STUDIO_PI_BIN?.trim()) {
    const explicit = env.OPENREAPER_STUDIO_PI_BIN.trim();
    if (existsSync(explicit)) {
      return explicit;
    }
  }
  if (layout?.bundledPiExecutable) {
    return layout.bundledPiExecutable;
  }
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

/** @deprecated Studio uses resolveStudioPiLayout; personal Pi is not the product path. */
export function defaultPiAgentDir(homeDir = os.homedir()) {
  return userPersonalPiAgentDir(homeDir);
}

/** @deprecated use studioPiMcpJsonPath via resolveStudioPiLayout */
export function defaultPiMcpJsonPath(homeDir = os.homedir()) {
  return studioPiMcpJsonPath(userPersonalPiAgentDir(homeDir));
}

/**
 * Read Pi MCP config if present. Never writes or merges.
 * mcp.json is not the Studio product path — native Pi extension is.
 * This inspector exists only to warn if a leftover file is still around.
 */
export async function readPiMcpConfig(mcpJsonPath) {
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

export function buildPiProcessEnv({ env = process.env, layout }) {
  if (!layout?.agentDir || !layout?.sessionsDir) {
    throw new Error("buildPiProcessEnv requires resolveStudioPiLayout() output");
  }
  return {
    ...env,
    OPENREAPER_STUDIO: "1",
    PI_CODING_AGENT_DIR: layout.agentDir,
    PI_CODING_AGENT_SESSION_DIR: layout.sessionsDir,
  };
}

export function buildPiStartPlan({
  piExecutable,
  env = process.env,
  layout = null,
  repoRoot = repoRootFromStudio(),
  extensionFlags = null,
} = {}) {
  if (!piExecutable) {
    return {
      mode: "absent",
      message:
        "Pi was not found (bundled vendor/pi or PATH). Studio uses a private agent dir under " +
        "~/.openreaper/studio/pi — not ~/.pi. Install Pi for Studio packaging or set OPENREAPER_STUDIO_PI_BIN.",
    };
  }
  if (env.OPENREAPER_STUDIO_SKIP_PI === "1") {
    return {
      mode: "skipped",
      message: "OPENREAPER_STUDIO_SKIP_PI=1 — private Pi was not started by Studio.",
      piExecutable,
    };
  }
  const flags =
    extensionFlags ??
    resolveStudioPiExtensionFlags({
      repoRoot,
      env,
    });
  const args = ["--mode", "rpc", "--name", "OpenReaper Studio"];
  if (flags.exists) {
    args.push(...flags.args);
  }
  if (env.OPENREAPER_STUDIO_PI_NO_SESSION === "1") {
    args.push("--no-session");
  }
  if (env.OPENREAPER_STUDIO_PI_ARGS?.trim()) {
    const extra = env.OPENREAPER_STUDIO_PI_ARGS.trim().split(/\s+/).filter(Boolean);
    args.push(...extra);
  }
  const cwd = layout?.workspaceDir ?? env.OPENREAPER_STUDIO_WORKSPACE?.trim() ?? null;
  return {
    mode: "start",
    piExecutable,
    command: piExecutable,
    args,
    cwd,
    extension: flags,
    logLabel: "pi-rpc",
    layout,
    processEnv: layout ? buildPiProcessEnv({ env, layout }) : null,
  };
}

export function resolveStudioPiForStart({ homeDir, installRoot, env = process.env, repoRoot } = {}) {
  const layout = resolveStudioPiLayout({ homeDir, installRoot, env });
  const piExecutable = resolvePiExecutable(env, layout);
  const plan = buildPiStartPlan({
    piExecutable,
    env,
    layout,
    repoRoot: repoRoot ?? repoRootFromStudio(),
  });
  return { layout, plan };
}
