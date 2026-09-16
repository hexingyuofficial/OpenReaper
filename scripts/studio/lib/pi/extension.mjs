import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { repoRootFromStudio } from "../paths.mjs";

export const PI_EXTENSION_PACKAGE_DIRNAME = "pi-extension-openreaper";
export const PI_EXTENSION_ENTRY = "openreaper-extension.mjs";
export const PI_EXTENSION_DISCOVERY_NAME = "openreaper.ts";

export function studioPiExtensionPackageDir(repoRoot = repoRootFromStudio()) {
  return path.join(repoRoot, "packages", PI_EXTENSION_PACKAGE_DIRNAME);
}

export function studioPiExtensionEntryPath(repoRoot = repoRootFromStudio()) {
  return path.join(studioPiExtensionPackageDir(repoRoot), PI_EXTENSION_ENTRY);
}

export function studioPiExtensionDiscoveryPath(repoRoot = repoRootFromStudio()) {
  return path.join(studioPiExtensionPackageDir(repoRoot), "index.ts");
}

export function studioPiAgentExtensionsDir(agentDir) {
  return path.join(agentDir, "extensions");
}

/**
 * Pi argv for native OpenReaper tools.
 *
 * `--no-builtin-tools` keeps extension tools; `--no-tools` would drop them.
 * `--no-extensions` + explicit `--extension` loads only this package (no
 * personal ~/.pi discovery, no duplicate register from agentDir copy).
 */
export function resolveStudioPiExtensionFlags({
  repoRoot = repoRootFromStudio(),
  env = process.env,
} = {}) {
  const override = env.OPENREAPER_STUDIO_PI_EXTENSION?.trim();
  const entry = override ? path.resolve(override) : studioPiExtensionEntryPath(repoRoot);
  const exists = Boolean(entry) && existsSync(entry);
  const keepBuiltins = env.OPENREAPER_STUDIO_PI_KEEP_BUILTIN_TOOLS === "1";
  const args = [];
  if (exists) {
    if (!keepBuiltins) {
      args.push("--no-builtin-tools");
    }
    args.push("--no-extensions", "--extension", entry);
  }
  return {
    entry,
    exists,
    args,
    noBuiltinTools: exists && !keepBuiltins,
    keepBuiltins,
  };
}

/**
 * Copy the extension into the private agent tree so /reload and inspection
 * see it. Runtime load is still `--extension` (absolute), not mcp.json.
 */
export async function installStudioPiExtension({
  agentDir,
  repoRoot = repoRootFromStudio(),
} = {}) {
  const entry = studioPiExtensionEntryPath(repoRoot);
  const discovery = studioPiExtensionDiscoveryPath(repoRoot);
  if (!existsSync(entry)) {
    return { installed: false, reason: "missing_source", entry };
  }
  const destDir = studioPiAgentExtensionsDir(agentDir);
  await mkdir(destDir, { recursive: true });
  const destMjs = path.join(destDir, PI_EXTENSION_ENTRY);
  const destTs = path.join(destDir, PI_EXTENSION_DISCOVERY_NAME);
  await copyFile(entry, destMjs);
  if (existsSync(discovery)) {
    await copyFile(discovery, destTs);
  }
  return {
    installed: true,
    destDir,
    destMjs,
    destTs: existsSync(destTs) ? destTs : null,
    entry,
  };
}
