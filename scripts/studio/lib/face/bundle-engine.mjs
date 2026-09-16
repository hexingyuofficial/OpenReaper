import { existsSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { packagedMacosStartHelperPath, repoRootFromStudio } from "../paths.mjs";
import { studioDir } from "./runtime-config.mjs";

export const ENGINE_BUNDLE_CONTRACT = "openreaper.studio.engine_bundle.v1";

export function studioEngineBundleManifestPath(homeDir) {
  return path.join(studioDir(homeDir), "engine-bundle-v1.json");
}

/**
 * Record the packaged OpenReaper engine slot Studio Start uses (not a DIY PATH assemble).
 */
export async function writeEngineBundleManifest({
  homeDir,
  installRoot,
  repoRoot,
  startHelper,
} = {}) {
  const alphaRoot = path.join(repoRoot ?? repoRootFromStudio(), "packaging", "macos", "OpenReaper-alpha");
  const payload = {
    contract: ENGINE_BUNDLE_CONTRACT,
    installRoot,
    startHelperPath: startHelper?.path ?? path.join(installRoot, "bin", "openreaper-start"),
    startHelperRev: startHelper?.rev ?? null,
    startHelperSha256: startHelper?.sha256 ?? null,
    packagingSource: alphaRoot,
    packagingStartHelper: packagedMacosStartHelperPath(repoRoot),
    bundledLayout: "openreaper-alpha",
    note:
      "Studio Start always copies packaging/macos/.../openreaper-start into INSTALL_ROOT/bin/openreaper-start and runs that dest. Future installer copies the full alpha tree to ~/.openreaper/current.",
  };
  const target = studioEngineBundleManifestPath(homeDir);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(payload, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  return {
    written: true,
    path: target,
    installRootExists: existsSync(installRoot),
    startHelperExists: existsSync(payload.startHelperPath),
  };
}
