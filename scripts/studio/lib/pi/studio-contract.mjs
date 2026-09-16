import { existsSync } from "node:fs";
import { copyFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { repoRootFromStudio } from "../paths.mjs";

export function studioContractTemplateDir(repoRoot = repoRootFromStudio()) {
  return path.join(repoRoot, "packaging", "studio");
}

export function studioAgentsTemplatePath(repoRoot = repoRootFromStudio()) {
  return path.join(studioContractTemplateDir(repoRoot), "AGENTS.md");
}

export function studioSystemTemplatePath(repoRoot = repoRootFromStudio()) {
  return path.join(studioContractTemplateDir(repoRoot), ".pi", "SYSTEM.md");
}

/**
 * Copy specialized Pi contract files into the Studio workspace if missing.
 * Never overwrites user-edited copies. Never writes secrets.
 */
export async function installStudioWorkspaceContract({
  workspaceDir,
  repoRoot = repoRootFromStudio(),
} = {}) {
  if (!workspaceDir) {
    return { installed: false, reason: "missing_workspace" };
  }
  const agentsSrc = studioAgentsTemplatePath(repoRoot);
  const systemSrc = studioSystemTemplatePath(repoRoot);
  if (!existsSync(agentsSrc) || !existsSync(systemSrc)) {
    return { installed: false, reason: "missing_templates", agentsSrc, systemSrc };
  }
  await mkdir(workspaceDir, { recursive: true });
  await mkdir(path.join(workspaceDir, ".pi"), { recursive: true });
  const agentsDest = path.join(workspaceDir, "AGENTS.md");
  const systemDest = path.join(workspaceDir, ".pi", "SYSTEM.md");
  const copied = [];
  if (!existsSync(agentsDest)) {
    await copyFile(agentsSrc, agentsDest);
    copied.push("AGENTS.md");
  }
  if (!existsSync(systemDest)) {
    await copyFile(systemSrc, systemDest);
    copied.push(".pi/SYSTEM.md");
  }
  return {
    installed: true,
    copied,
    agentsDest,
    systemDest,
    skippedExisting: copied.length === 0,
  };
}
