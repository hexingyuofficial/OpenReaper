import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";

export const STUDIO_PI_DIRNAME = "pi";

/** Default private Pi tree when no bundled vendor layout exists. */
export function defaultStudioPiHomeRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".openreaper", "studio", STUDIO_PI_DIRNAME);
}

/** Future one-click installer layout: INSTALL_ROOT/vendor/pi */
export function bundledPiRoot(installRoot) {
  return path.join(installRoot, "vendor", STUDIO_PI_DIRNAME);
}

export function userPersonalPiAgentDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".pi", "agent");
}

/**
 * Resolve the Studio-owned Pi root (never ~/.pi).
 * Override: OPENREAPER_STUDIO_PI_ROOT
 */
export function resolveStudioPiRoot({ homeDir, installRoot, env = process.env }) {
  if (env.OPENREAPER_STUDIO_PI_ROOT?.trim()) {
    return path.resolve(env.OPENREAPER_STUDIO_PI_ROOT.trim());
  }
  if (installRoot) {
    const bundled = bundledPiRoot(installRoot);
    if (bundledPiLayoutPresent(bundled)) {
      return bundled;
    }
  }
  return defaultStudioPiHomeRoot(homeDir);
}

function bundledPiLayoutPresent(piRoot) {
  return (
    existsSync(path.join(piRoot, "bin", process.platform === "win32" ? "pi.cmd" : "pi")) ||
    existsSync(path.join(piRoot, "bin", "pi")) ||
    existsSync(path.join(piRoot, "pi"))
  );
}

export function studioPiAgentDir(piRoot) {
  return path.join(piRoot, "agent");
}

export function studioPiSessionsDir(piRoot) {
  return path.join(piRoot, "sessions");
}

export function studioPiMcpJsonPath(agentDir) {
  return path.join(agentDir, "mcp.json");
}

/** Provider login / API keys for in-app auth (next slice); lives under private agent dir. */
export function studioPiAuthJsonPath(agentDir) {
  return path.join(agentDir, "auth.json");
}

export function resolveBundledPiExecutable(piRoot, platform = process.platform) {
  const binName = platform === "win32" ? "pi.cmd" : "pi";
  const candidates = [
    path.join(piRoot, "bin", binName),
    path.join(piRoot, "bin", "pi"),
    path.join(piRoot, "pi"),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function isIsolatedFromPersonalPi(agentDir, homeDir = os.homedir()) {
  return path.resolve(agentDir) !== path.resolve(userPersonalPiAgentDir(homeDir));
}

export function resolveStudioPiLayout({ homeDir, installRoot, env = process.env }) {
  const piRoot = resolveStudioPiRoot({ homeDir, installRoot, env });
  const agentDir = studioPiAgentDir(piRoot);
  const sessionsDir = studioPiSessionsDir(piRoot);
  return {
    piRoot,
    agentDir,
    sessionsDir,
    mcpJsonPath: studioPiMcpJsonPath(agentDir),
    authJsonPath: studioPiAuthJsonPath(agentDir),
    bundledPiExecutable: resolveBundledPiExecutable(piRoot),
    isolatedFromPersonalPi: isIsolatedFromPersonalPi(agentDir, homeDir),
  };
}
