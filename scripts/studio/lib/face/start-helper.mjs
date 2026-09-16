import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, copyFile, mkdir, readFile, rename, unlink } from "node:fs/promises";
import path from "node:path";
import { resolvePackagedStartHelper } from "../paths.mjs";

/** Bumped when the wait-loop / AX-throttle / startup-hook publish contract changes. Synced dest must match. */
export const START_HELPER_REV = "studio-hook-publish-v7";

export const START_HELPER_REQUIRED_MARKERS = Object.freeze([
  `OPENREAPER_START_HELPER_REV="${START_HELPER_REV}"`,
  "STARTUP_DIALOG_INSPECT_EVERY_TICKS",
  "STARTUP_DIALOG_SOFT_BLOCKER_INSPECT_EVERY_TICKS",
  "STARTUP_DIALOG_FIRST_TIMEOUT_SECONDS",
  "STARTUP_AX_SKIP_REMAINING_MS",
  "STARTUP_HOOK_QUIET_TICKS",
  "startup_wait_accept_published_stage",
  "startup_wait_poll_ticks",
  "startup-last-chance=published_stage",
  "startup-ax=stopped_after_soft_blocker",
  "startup-hook-poke=trusted_launcher",
  "startup-hook-poke=studio_face",
  "ensure_openreaper_startup_hook",
]);

export function startHelperMissingMarkers(sourceText) {
  const text = String(sourceText ?? "");
  return START_HELPER_REQUIRED_MARKERS.filter((marker) => !text.includes(marker));
}

export function parseStartHelperRev(sourceText) {
  const match = String(sourceText ?? "").match(/OPENREAPER_START_HELPER_REV="([^"]+)"/);
  return match ? match[1] : null;
}

export async function readStartHelperFingerprint(filePath) {
  const text = await readFile(filePath, "utf8");
  return {
    sha256: createHash("sha256").update(text).digest("hex"),
    rev: parseStartHelperRev(text),
    expectedRev: START_HELPER_REV,
    missingMarkers: startHelperMissingMarkers(text),
  };
}

/**
 * Last-line check before spawn. A dest that lost the race to an older
 * openreaper-start.sh / leftover install copy must not be executed.
 */
export async function assertRunnableStartHelper(filePath) {
  if (!filePath || !existsSync(filePath)) {
    throw new Error(`synced openreaper-start is missing: ${filePath ?? "(empty)"}`);
  }
  const fp = await readStartHelperFingerprint(filePath);
  if (fp.missingMarkers.length > 0 || fp.rev !== START_HELPER_REV) {
    throw new Error(
      `Refusing to run stale openreaper-start (${filePath}): ` +
        `rev=${fp.rev ?? "missing"} expected=${START_HELPER_REV}` +
        (fp.missingMarkers.length ? ` missing ${fp.missingMarkers.join(", ")}` : "") +
        ". Studio must copy packaging/macos/OpenReaper-alpha/bin/openreaper-start.",
    );
  }
  return fp;
}

async function atomicCopyHelper(source, dest) {
  const destDir = path.dirname(dest);
  await mkdir(destDir, { recursive: true });
  const tmp = path.join(destDir, `.openreaper-start.tmp.${process.pid}.${Date.now()}`);
  try {
    await copyFile(source, tmp);
    await chmod(tmp, 0o755);
    await rename(tmp, dest);
    await chmod(dest, 0o755);
  } catch (error) {
    await unlink(tmp).catch(() => {});
    throw error;
  }
}

async function overwriteStaleCompanion(source, companionPath, destPath) {
  if (!existsSync(companionPath)) {
    return false;
  }
  if (path.resolve(companionPath) === path.resolve(destPath)) {
    return false;
  }
  const text = await readFile(companionPath, "utf8").catch(() => "");
  if (startHelperMissingMarkers(text).length === 0) {
    return false;
  }
  await atomicCopyHelper(source, companionPath);
  return true;
}

/**
 * Copy the tracked packaging start helper into INSTALL_ROOT/bin/openreaper-start.
 * Studio keeps using ~/.openreaper/current (session/vendor stay there).
 * Refuses to return success if the dest file is missing the current wait-loop markers
 * (an older helper winning is how Zhuanz1 still hit STARTUP_BUDGET_EXHAUSTED).
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
  const sourceFp = await readStartHelperFingerprint(source);
  if (sourceFp.missingMarkers.length > 0) {
    throw new Error(
      `packaged openreaper-start is missing ${sourceFp.missingMarkers.join(", ")}: ${source}`,
    );
  }
  const alreadyInPlace = path.resolve(source) === path.resolve(dest);
  if (!alreadyInPlace) {
    await atomicCopyHelper(source, dest);
  }
  const destFp = await readStartHelperFingerprint(dest);
  if (destFp.missingMarkers.length > 0 || destFp.rev !== START_HELPER_REV) {
    throw new Error(
      `INSTALL_ROOT helper is stale after sync (rev=${destFp.rev ?? "missing"} expected=${START_HELPER_REV}` +
        (destFp.missingMarkers.length ? `; missing ${destFp.missingMarkers.join(", ")}` : "") +
        `): ${dest}. ` +
        "Studio must copy packaging/macos/OpenReaper-alpha/bin/openreaper-start; refusing to start with an older helper.",
    );
  }
  if (!alreadyInPlace && destFp.sha256 !== sourceFp.sha256) {
    throw new Error(
      `INSTALL_ROOT helper hash mismatch after sync dest=${destFp.sha256} source=${sourceFp.sha256}`,
    );
  }
  const overwrittenSh = await overwriteStaleCompanion(
    source,
    path.join(destDir, "openreaper-start.sh"),
    dest,
  );
  const overwrittenRootSh = await overwriteStaleCompanion(
    source,
    path.join(installRoot, "openreaper-start.sh"),
    dest,
  );
  return {
    synced: true,
    source,
    dest,
    sha256: destFp.sha256,
    rev: destFp.rev,
    overwrittenStaleSh: overwrittenSh || overwrittenRootSh,
    reason: alreadyInPlace ? "already_in_place" : "copied",
  };
}
