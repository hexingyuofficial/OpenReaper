import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { ensureFaceStartupHook } from "./hook.mjs";
import { resolveStudioDialogSources } from "../paths.mjs";

export function faceInstallLayout(reaperResourceRoot) {
  const openReaperDir = path.join(reaperResourceRoot, "Scripts", "OpenReaper");
  return {
    openReaperDir,
    entryScriptPath: path.join(openReaperDir, "openreaper_studio_dialog.lua"),
    moduleDir: path.join(openReaperDir, "studio", "dialog"),
    startupLuaPath: path.join(reaperResourceRoot, "Scripts", "__startup.lua"),
  };
}

/**
 * Copy the dialog entry + module tree into REAPER resource path and ensure __startup hook.
 * `repoRoot` may be the git checkout, the Studio package dir, or omitted.
 */
export async function installFaceBundle({ reaperResourceRoot, repoRoot } = {}) {
  const layout = faceInstallLayout(reaperResourceRoot);
  await mkdir(layout.openReaperDir, { recursive: true });
  await mkdir(layout.moduleDir, { recursive: true });

  const { entrySource, moduleSource } = resolveStudioDialogSources(repoRoot);

  await cp(entrySource, layout.entryScriptPath);
  await cp(moduleSource, layout.moduleDir, { recursive: true });

  const hookResult = await ensureFaceStartupHook({
    startupLuaPath: layout.startupLuaPath,
    faceScriptPath: layout.entryScriptPath,
  });

  return { ...layout, ...hookResult };
}
