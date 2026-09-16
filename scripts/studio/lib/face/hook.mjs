import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

export const FACE_HOOK_BEGIN = "-- BEGIN openreaper-studio-face (managed by OpenReaper Studio)";
export const FACE_HOOK_END = "-- END openreaper-studio-face";

export function buildFaceStartupHookBlock(faceScriptPath) {
  const escaped = faceScriptPath.replace(/\\/g, "/");
  return `${FACE_HOOK_BEGIN}
if reaper and reaper.defer then
  local face = [[${escaped}]]
  reaper.defer(function()
    if reaper.file_exists(face) then
      local ok, err = pcall(dofile, face)
      if not ok and reaper.ShowConsoleMsg then
        reaper.ShowConsoleMsg("[OpenReaper Studio] dialog failed: " .. tostring(err) .. "\\n")
      end
    end
  end)
end
${FACE_HOOK_END}
`;
}

export async function readStartupLua(startupLuaPath) {
  try {
    return await readFile(startupLuaPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return "";
    }
    throw error;
  }
}

export function startupLuaHasFaceHook(content) {
  return content.includes(FACE_HOOK_BEGIN) && content.includes(FACE_HOOK_END);
}

export async function ensureFaceStartupHook({ startupLuaPath, faceScriptPath }) {
  const existing = await readStartupLua(startupLuaPath);
  if (startupLuaHasFaceHook(existing)) {
    return { hookInstalled: true, alreadyPresent: true };
  }
  const block = buildFaceStartupHookBlock(faceScriptPath);
  const separator = existing.length > 0 && !existing.endsWith("\n") ? "\n" : "";
  const next = `${existing}${separator}\n${block}\n`;
  await mkdir(path.dirname(startupLuaPath), { recursive: true });
  await writeFile(startupLuaPath, next, "utf8");
  return { hookInstalled: true, alreadyPresent: false };
}

export async function removeFaceStartupHook(startupLuaPath) {
  const existing = await readStartupLua(startupLuaPath);
  if (!startupLuaHasFaceHook(existing)) {
    return { removed: false };
  }
  const pattern = new RegExp(
    `\\n?${escapeRegExp(FACE_HOOK_BEGIN)}[\\s\\S]*?${escapeRegExp(FACE_HOOK_END)}\\n?`,
    "g",
  );
  const next = existing.replace(pattern, "\n").replace(/\n{3,}/g, "\n\n").trimEnd();
  const payload = next.length > 0 ? `${next}\n` : "";
  await writeFile(startupLuaPath, payload, "utf8");
  return { removed: true };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
