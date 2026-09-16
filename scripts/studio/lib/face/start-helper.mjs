import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { resolvePackagedStartHelper } from "../paths.mjs";

/**
 * Copy the tracked packaging start helper into INSTALL_ROOT/bin/openreaper-start.
 * Studio keeps using ~/.openreaper/current (session/vendor stay there).
 */
export async function syncPackagedStartHelper({
  installRoot,
  repoRoot,
  platform = process.platform,
} = {}) {
  if (!installRoot) {
    return { synced: false, reason: "no_install_root" };
  }
  if (platform === "win32") {
    return { synced: false, reason: "windows" };
  }
  const source = resolvePackagedStartHelper(repoRoot);
  if (!source) {
    return { synced: false, reason: "packaged_helper_missing" };
  }
  const destDir = path.join(installRoot, "bin");
  const dest = path.join(destDir, "openreaper-start");
  if (path.resolve(source) === path.resolve(dest)) {
    return { synced: true, reason: "already_in_place", source, dest };
  }
  await mkdir(destDir, { recursive: true });
  await copyFile(source, dest);
  await chmod(dest, 0o755);
  return { synced: true, source, dest, existed: existsSync(dest) };
}
