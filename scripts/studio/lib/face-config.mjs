import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

export const FACE_CONFIG_CONTRACT = "openreaper.studio.face_config.v1";

export function studioDir(homeDir = os.homedir()) {
  return path.join(homeDir, ".openreaper", "studio");
}

export function faceConfigPath(homeDir = os.homedir()) {
  return path.join(studioDir(homeDir), "face-config-v1.json");
}

export function openFaceOnLoadPath(homeDir = os.homedir()) {
  return path.join(studioDir(homeDir), "open-face-on-load");
}

export function studioPromptDir(homeDir = os.homedir()) {
  return path.join(studioDir(homeDir), "prompts");
}

export async function writeFaceConfig(homeDir, config) {
  const target = faceConfigPath(homeDir);
  await mkdir(path.dirname(target), { recursive: true });
  const payload = {
    contract: FACE_CONFIG_CONTRACT,
    ...config,
  };
  const temp = `${target}.tmp.${process.pid}`;
  await writeFile(temp, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
  await rename(temp, target);
}

export async function readFaceConfig(homeDir = os.homedir()) {
  try {
    const raw = await readFile(faceConfigPath(homeDir), "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.contract !== FACE_CONFIG_CONTRACT) {
      return null;
    }
    return parsed;
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

export async function markOpenFaceOnLoad(homeDir = os.homedir()) {
  const target = openFaceOnLoadPath(homeDir);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${new Date().toISOString()}\n`, { encoding: "utf8", mode: 0o600 });
}

export async function clearOpenFaceOnLoad(homeDir = os.homedir()) {
  try {
    await unlink(openFaceOnLoadPath(homeDir));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

export function resolveNodeCommand(env = process.env) {
  if (env.OPENREAPER_STUDIO_NODE?.trim()) {
    return env.OPENREAPER_STUDIO_NODE.trim();
  }
  return process.execPath;
}

export function resolvePiBridgeScript(repoRoot) {
  return path.join(repoRoot, "scripts", "studio", "studio-pi-send.mjs");
}
