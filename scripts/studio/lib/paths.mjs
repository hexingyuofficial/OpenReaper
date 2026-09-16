import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STUDIO_DIR = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

export function studioPackageRoot() {
  return STUDIO_DIR;
}

export function repoRootFromStudio() {
  return path.resolve(STUDIO_DIR, "..", "..");
}

/**
 * Default install root for the packaged OpenReaper alpha layout.
 */
export function defaultInstallRoot(homeDir = os.homedir()) {
  return path.join(homeDir, ".openreaper", "current");
}

/**
 * Resolve the directory that contains openreaper-start (bare), .sh, or .ps1.
 * Order: OPENREAPER_INSTALL_ROOT, ~/.openreaper/current, repo dev package.
 */
export function resolveInstallRoot(env = process.env, homeDir = os.homedir()) {
  const candidates = [];
  if (env.OPENREAPER_INSTALL_ROOT?.trim()) {
    candidates.push(path.resolve(env.OPENREAPER_INSTALL_ROOT.trim()));
  }
  candidates.push(defaultInstallRoot(homeDir));
  candidates.push(
    path.join(repoRootFromStudio(), "scripts", "openreaper-alpha-package"),
  );
  for (const root of candidates) {
    if (installRootHasStartHelper(root, process.platform)) {
      return root;
    }
  }
  return null;
}

function unixStartHelperPaths(installRoot) {
  const binDir = path.join(installRoot, "bin");
  return [
    path.join(binDir, "openreaper-start"),
    path.join(binDir, "openreaper-start.sh"),
    path.join(installRoot, "openreaper-start.sh"),
  ];
}

function installRootHasStartHelper(installRoot, platform) {
  const binDir = path.join(installRoot, "bin");
  if (platform === "win32") {
    return existsSync(path.join(binDir, "openreaper-start.ps1"));
  }
  return unixStartHelperPaths(installRoot).some((candidate) => existsSync(candidate));
}

/**
 * Tracked macOS start helper that Studio syncs into INSTALL_ROOT/bin.
 * Lives under packaging/ so dist/ (gitignored) is not the source of truth.
 */
export function packagedMacosStartHelperPath(root = repoRootFromStudio()) {
  return path.join(
    root,
    "packaging",
    "macos",
    "OpenReaper-alpha",
    "bin",
    "openreaper-start",
  );
}

export function resolvePackagedStartHelper(root = repoRootFromStudio()) {
  const candidates = [packagedMacosStartHelperPath(root)];
  const fallback = packagedMacosStartHelperPath(repoRootFromStudio());
  if (fallback !== candidates[0]) {
    candidates.push(fallback);
  }
  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

export function resolveOpenReaperStartCommand(installRoot, platform = process.platform) {
  if (!installRoot) {
    return null;
  }
  if (platform === "win32") {
    const ps1 = path.join(installRoot, "bin", "openreaper-start.ps1");
    if (!existsSync(ps1)) {
      return null;
    }
    return {
      command: "powershell.exe",
      args: [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy",
        "Bypass",
        "-File",
        ps1,
      ],
      cwd: installRoot,
    };
  }
  for (const command of unixStartHelperPaths(installRoot)) {
    if (existsSync(command)) {
      return { command, args: [], cwd: installRoot };
    }
  }
  return null;
}

export function studioStatePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".openreaper", "studio", "session-v1.json");
}

export function studioDialogEntryFileName() {
  return "openreaper_studio_dialog.lua";
}

function isBlankRoot(root) {
  return root == null || String(root).trim() === "";
}

function dialogEntryExistsUnder(studioRoot) {
  return existsSync(path.join(studioRoot, "reaper", studioDialogEntryFileName()));
}

/**
 * Normalize a caller-supplied root to the Studio package directory
 * (`scripts/studio`). Accepts git repo root, that package root, or omit.
 * Dialog Lua always lives under `scripts/studio/reaper/`, not repo `reaper/`.
 */
export function resolveStudioPackageRoot(root = studioPackageRoot()) {
  const fallback = studioPackageRoot();
  if (isBlankRoot(root)) {
    return fallback;
  }
  const resolved = path.resolve(root);
  const nestedStudio = path.join(resolved, "scripts", "studio");
  if (dialogEntryExistsUnder(nestedStudio)) {
    return nestedStudio;
  }
  if (dialogEntryExistsUnder(resolved)) {
    return resolved;
  }
  return fallback;
}

/** REAPER dialog sources always live under the Studio package (`scripts/studio/reaper/`). */
export function studioDialogEntrySourcePath(root = studioPackageRoot()) {
  return path.join(resolveStudioPackageRoot(root), "reaper", studioDialogEntryFileName());
}

export function studioDialogModuleSourceDir(root = studioPackageRoot()) {
  return path.join(resolveStudioPackageRoot(root), "reaper", "dialog");
}

export function resolveStudioDialogSources(root = studioPackageRoot()) {
  const studioRoot = resolveStudioPackageRoot(root);
  return {
    studioRoot,
    entrySource: studioDialogEntrySourcePath(studioRoot),
    moduleSource: studioDialogModuleSourceDir(studioRoot),
  };
}

/** @deprecated use studioDialogEntrySourcePath */
export function studioFaceSourcePath() {
  return studioDialogEntrySourcePath();
}

export function studioFaceInstallPath(reaperResourceRoot) {
  return path.join(
    reaperResourceRoot,
    "Scripts",
    "OpenReaper",
    studioDialogEntryFileName(),
  );
}

export function defaultReaperResourceRoot(platform, homeDir = os.homedir(), env = process.env) {
  if (platform === "darwin") {
    return path.join(homeDir, "Library", "Application Support", "REAPER");
  }
  if (platform === "win32") {
    const appData =
      env.APPDATA && env.APPDATA.trim() !== ""
        ? env.APPDATA
        : path.win32.join(homeDir, "AppData", "Roaming");
    return path.win32.join(appData, "REAPER");
  }
  return null;
}
