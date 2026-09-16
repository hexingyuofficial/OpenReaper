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
 * Resolve the directory that contains openreaper-start.{sh,ps1}.
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

function installRootHasStartHelper(installRoot, platform) {
  const binDir = path.join(installRoot, "bin");
  if (platform === "win32") {
    return existsSync(path.join(binDir, "openreaper-start.ps1"));
  }
  const sh = path.join(binDir, "openreaper-start.sh");
  const devSh = path.join(installRoot, "openreaper-start.sh");
  return existsSync(sh) || existsSync(devSh);
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
  const packaged = path.join(installRoot, "bin", "openreaper-start.sh");
  if (existsSync(packaged)) {
    return { command: packaged, args: [], cwd: installRoot };
  }
  const dev = path.join(installRoot, "openreaper-start.sh");
  if (existsSync(dev)) {
    return { command: dev, args: [], cwd: installRoot };
  }
  return null;
}

export function studioStatePath(homeDir = os.homedir()) {
  return path.join(homeDir, ".openreaper", "studio", "session-v1.json");
}

export function studioDialogEntryFileName() {
  return "openreaper_studio_dialog.lua";
}

export function studioDialogEntrySourcePath(repoRoot = STUDIO_DIR) {
  return path.join(repoRoot, "reaper", studioDialogEntryFileName());
}

export function studioDialogModuleSourceDir(repoRoot = STUDIO_DIR) {
  return path.join(repoRoot, "reaper", "dialog");
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
