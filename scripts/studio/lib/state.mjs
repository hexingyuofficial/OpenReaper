import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

export const STUDIO_STATE_CONTRACT = "openreaper.studio.session.v1";

export function emptyStudioState() {
  return {
    contract: STUDIO_STATE_CONTRACT,
    startedAt: null,
    installRoot: null,
    openreaperStartExitCode: null,
    openreaperStartSoftContinued: false,
    pi: { mode: "unknown" },
    face: { installed: false, hookInstalled: false, scriptPath: null },
    reaper: { stopPolicy: "preserve" },
  };
}

export async function readStudioState(statePath) {
  try {
    const raw = await readFile(statePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.contract !== STUDIO_STATE_CONTRACT) {
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

export async function writeStudioState(statePath, state) {
  await mkdir(path.dirname(statePath), { recursive: true });
  const payload = `${JSON.stringify(state, null, 2)}\n`;
  const temp = `${statePath}.tmp.${process.pid}`;
  await writeFile(temp, payload, { encoding: "utf8", mode: 0o600 });
  await rename(temp, statePath);
}

export async function clearStudioState(statePath) {
  try {
    const { unlink } = await import("node:fs/promises");
    await unlink(statePath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}
