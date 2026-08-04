import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

export const WINDOWS_SAFE_FILE_CONTRACT = "openreaper.windows_safe_file.v1";

const execFileAsync = promisify(execFile);
const MAX_SCRIPT_OUTPUT_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_BYTES = 16 * 1024;
const WINDOWS_POWERSHELL_RELATIVE_PATH = path.join(
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
);

export async function readWindowsSafeFile(filePath, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") {
    return { status: "unavailable", reason: "windows_only" };
  }
  const maxBytes = normalizeMaxBytes(options.maxBytes ?? DEFAULT_MAX_BYTES);
  if (maxBytes === null) return { status: "invalid", reason: "max_bytes_invalid" };
  const result = await invokeWindowsSafeFilePowerShell({
    mode: "ReadFile",
    filePath,
    maxBytes,
    allowMetadataChange: options.allowMetadataChange === true,
    scriptPath: options.scriptPath,
    commandRunner: options.commandRunner,
  });
  if (!result.ok) return result;
  if (result.payload?.status === "missing") return { status: "missing" };
  if (result.payload?.status !== "valid") {
    const linkCount = Number.isSafeInteger(result.payload?.link_count)
      ? result.payload.link_count
      : null;
    return {
      status: "invalid",
      reason: normalizeReason(result.payload?.reason, "windows_safe_file_invalid"),
      error_code: normalizeErrorCode(result.payload?.error_code),
      ...(linkCount === null ? {} : { link_count: linkCount }),
    };
  }
  const payload = result.payload;
  if (
    payload.kind !== "file" ||
    typeof payload.base64 !== "string" ||
    !Number.isSafeInteger(payload.size) ||
    payload.size < 0 ||
    payload.size > maxBytes ||
    !Number.isSafeInteger(payload.bytes) ||
    payload.bytes !== payload.size ||
    typeof payload.mtime_ms !== "number" ||
    !Number.isFinite(payload.mtime_ms) ||
    typeof payload.ctime_ms !== "number" ||
    !Number.isFinite(payload.ctime_ms) ||
    typeof payload.nlink !== "number" ||
    !Number.isSafeInteger(payload.nlink) ||
    payload.nlink !== 1
  ) {
    return { status: "invalid", reason: "windows_safe_file_result_invalid" };
  }
  let bytes;
  try {
    bytes = Buffer.from(payload.base64, "base64");
  } catch {
    return { status: "invalid", reason: "windows_safe_file_encoding_invalid" };
  }
  if (bytes.length !== payload.size) {
    return { status: "invalid", reason: "windows_safe_file_size_mismatch" };
  }
  return {
    status: "valid",
    value: bytes.toString("utf8"),
    bytes,
    size: payload.size,
    mtime_ms: payload.mtime_ms,
    ctime_ms: payload.ctime_ms,
    nlink: payload.nlink,
    read_only: payload.read_only === true,
  };
}

export async function inspectWindowsSafeDirectory(directoryPath, options = {}) {
  if ((options.platform ?? process.platform) !== "win32") {
    return { status: "unavailable", reason: "windows_only" };
  }
  const result = await invokeWindowsSafeFilePowerShell({
    mode: "InspectDirectory",
    filePath: directoryPath,
    scriptPath: options.scriptPath,
    commandRunner: options.commandRunner,
  });
  if (!result.ok) return result;
  const payload = result.payload;
  if (payload?.status === "missing") return { status: "missing" };
  if (payload?.status === "symlink") return { status: "symlink" };
  if (payload?.status === "not_directory") return { status: "not_directory" };
  if (payload?.status === "not_writable") return { status: "not_writable" };
  if (payload?.status !== "ready" || payload.kind !== "directory") {
    return {
      status: "invalid",
      reason: normalizeReason(payload?.reason, "windows_safe_directory_invalid"),
      error_code: normalizeErrorCode(payload?.error_code),
    };
  }
  return { status: "ready" };
}

async function invokeWindowsSafeFilePowerShell({
  mode,
  filePath,
  maxBytes,
  allowMetadataChange = false,
  scriptPath,
  commandRunner,
}) {
  if (typeof filePath !== "string" || filePath === "" || filePath.includes("\u0000")) {
    return { status: "invalid", reason: "path_invalid" };
  }
  const resolvedScriptPath = scriptPath ?? defaultWindowsSafeFileScriptPath();
  const command = await resolveWindowsPowerShell();
  if (!command) return { status: "unavailable", reason: "powershell_unavailable" };
  try {
    await access(resolvedScriptPath, fsConstants.R_OK);
  } catch {
    return { status: "unavailable", reason: "windows_safe_file_script_missing" };
  }

  const args = [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    resolvedScriptPath,
    "-Mode",
    mode,
    "-LiteralPath",
    filePath,
  ];
  if (allowMetadataChange) args.push("-AllowMetadataChange");
  if (maxBytes !== undefined) args.push("-MaxBytes", String(maxBytes));

  let raw;
  try {
    if (typeof commandRunner === "function") {
      raw = await commandRunner({ command, args: [...args], maxBuffer: MAX_SCRIPT_OUTPUT_BYTES });
    } else {
      raw = await execFileAsync(command, args, {
        maxBuffer: MAX_SCRIPT_OUTPUT_BYTES,
        windowsHide: true,
      });
    }
  } catch (error) {
    return {
      status: "unavailable",
      reason: "windows_safe_file_helper_failed",
      error_code: normalizeErrorCode(error?.code),
    };
  }

  const stdout = typeof raw === "string" ? raw : raw?.stdout;
  if (typeof stdout !== "string" || Buffer.byteLength(stdout, "utf8") > MAX_SCRIPT_OUTPUT_BYTES) {
    return { status: "unavailable", reason: "windows_safe_file_output_invalid" };
  }
  let payload;
  try {
    payload = JSON.parse(stdout.trim());
  } catch {
    return { status: "unavailable", reason: "windows_safe_file_json_invalid" };
  }
  if (!payload || typeof payload !== "object" || payload.contract !== WINDOWS_SAFE_FILE_CONTRACT) {
    return { status: "unavailable", reason: "windows_safe_file_contract_invalid" };
  }
  return { ok: true, payload };
}

async function resolveWindowsPowerShell() {
  const systemRoot = typeof process.env.SystemRoot === "string" && process.env.SystemRoot !== ""
    ? process.env.SystemRoot
    : "C:\\Windows";
  const candidate = path.join(systemRoot, WINDOWS_POWERSHELL_RELATIVE_PATH);
  try {
    await access(candidate, fsConstants.X_OK);
    return candidate;
  } catch {
    // Fall through to the native command lookup.
  }
  return "powershell.exe";
}

function defaultWindowsSafeFileScriptPath() {
  return path.join(path.dirname(fileURLToPath(import.meta.url)), "windows-safe-file-read.ps1");
}

function normalizeMaxBytes(value) {
  return Number.isSafeInteger(value) && value >= 1 && value <= 1_048_576 ? value : null;
}

function normalizeReason(value, fallback) {
  return typeof value === "string" && /^[a-z][a-z0-9_]{0,63}$/u.test(value) ? value : fallback;
}

function normalizeErrorCode(value) {
  return typeof value === "string" && /^[A-Za-z0-9_ -]{0,32}$/u.test(value) ? value : null;
}
