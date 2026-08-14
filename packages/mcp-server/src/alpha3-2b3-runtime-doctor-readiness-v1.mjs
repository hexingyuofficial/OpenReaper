import { execFile } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, lstat, open, realpath } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import {
  LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT,
  LIVE_BRIDGE_LIVENESS_STATUS,
  probeLiveBridgeLiveness,
} from "./live-bridge-executor-v1.mjs";
import {
  inspectWindowsSafeDirectory,
  readWindowsSafeFile,
} from "./windows-safe-file-v1.mjs";

export const ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT =
  "alpha3.2.b3.runtime_doctor_readiness.v1";
export const ALPHA3_2B3_READ_PROBE_TEMPLATE_ID = "template.transport.read_state";
export const ALPHA3_2B3_DOCTOR_TASK_MODES = Object.freeze([
  "live-edit",
  "render",
  "media-import",
  "project-query",
]);
export const ALPHA3_2B3_WAIT_BRIDGE_SECONDS = Object.freeze({
  default: 10,
  min: 1,
  max: 60,
});
export const ALPHA3_2B3_READ_PROBE_TIMEOUT_MS = Object.freeze({
  default: 3_000,
  min: 250,
  max: 15_000,
});

const OWNER_MAX_BYTES = 256;
const PATH_MAX_BYTES = 3_072;
const RECORD_MAX_BYTES = 4_096;
const PID_MAX_BYTES = 32;
const PUBLIC_REASON_CODES = new Set([
  "expected_identity_invalid",
  "heartbeat_open_failed",
  "heartbeat_read_failed",
  "heartbeat_json_invalid",
  "heartbeat_contract_invalid",
  "heartbeat_fields_invalid",
  "heartbeat_owner_invalid",
  "heartbeat_generation_invalid",
  "heartbeat_sequence_invalid",
  "heartbeat_time_invalid",
  "heartbeat_interval_invalid",
  "heartbeat_mtime_in_future",
  "heartbeat_time_in_future",
  "heartbeat_time_after_file_mtime",
  "heartbeat_freshness_invalid",
  "heartbeat_changed_during_read",
  "heartbeat_read_invalid",
  "heartbeat_read_size_mismatch",
  "heartbeat_size_invalid",
  "heartbeat_link_count_invalid",
  "heartbeat_not_regular_file",
  "heartbeat_nofollow_unavailable",
]);
const PERMISSION_ERROR_CODES = new Set(["EACCES", "EPERM"]);
const REAPER_EXECUTABLE_BASENAMES = new Set(["REAPER", "reaper"]);
const IDENTITY_HELPER_MAX_BYTES = 16_384;
const IDENTITY_HELPER_TIMEOUT_MS = 2_000;
const WINDOWS_POWERSHELL_RELATIVE_PATH = [
  "System32",
  "WindowsPowerShell",
  "v1.0",
  "powershell.exe",
];
const IDENTITY_REALPATH_TIMEOUT_MS = 1_000;
const PID_RECORD_CLOCK_SKEW_MS = 5_000;
const PID_RECORD_LAUNCH_WINDOW_MS = 120_000;
const SAFE_FIX_MAX_BYTES = 6_144;
const REAPER_CODESIGN_REQUIREMENT =
  '=identifier "com.cockos.reaper" and anchor apple generic and certificate leaf[subject.OU] = "Y3T58622SG"';
const execFileAsync = promisify(execFile);
const NODE_FRESH_RENDER_ROOT_SCRIPT = 'const f=require("node:fs"),o=require("node:os"),p=require("node:path");try{const b=f.realpathSync(o.tmpdir());if(typeof b!=="string"||!p.isAbsolute(b)||b==="/"||Buffer.byteLength(b)>3072||[...b].some(c=>{const n=c.charCodeAt(0);return n<32||n===127}))throw 0;const r=f.mkdtempSync(p.join(b,"openreaper-render-recovery-"),{encoding:"utf8"});if(typeof r!=="string"||!p.isAbsolute(r)||Buffer.byteLength(r)>3072||[...r].some(c=>{const n=c.charCodeAt(0);return n<32||n===127}))throw 0;const s=f.lstatSync(r);if(s.isSymbolicLink()||!s.isDirectory())throw 0;f.accessSync(r,f.constants.R_OK|f.constants.W_OK|f.constants.X_OK);process.stdout.write(r)}catch{process.exitCode=1}';

export async function composeAlpha3_2B3RuntimeDoctorReadiness(options = {}) {
  const env = options.env ?? process.env;
  const liveBridge = options.liveBridge ?? null;
  const identity = parseAlpha3_2B3ExpectedIdentity(env);
  const probeOptions = {};
  if (identity.owner.present) {
    probeOptions.expectedOwner = identity.owner.valid ? identity.owner.value : null;
  }
  if (identity.generation.present) {
    probeOptions.expectedGeneration = identity.generation.valid
      ? identity.generation.value
      : null;
  }
  if (options.now !== undefined) probeOptions.now = options.now;

  let rawProbe = options.rawProbe;
  if (rawProbe === undefined && liveBridge?.configured && typeof liveBridge.executor?.probeLiveness === "function") {
    rawProbe = await liveBridge.executor.probeLiveness(probeOptions);
  } else if (rawProbe === undefined) {
    rawProbe = await probeLiveBridgeLiveness(probeOptions);
  }

  const transportInspection = await inspectTransportPermission({
    transportDir: liveBridge?.configured ? liveBridge.config?.transport_dir : null,
    rawProbe,
  });
  const bridge = projectBridgeReadiness(rawProbe, identity, transportInspection);
  const renderRoot = await inspectAlpha3_2B3RenderRoot(
    Object.prototype.hasOwnProperty.call(options, "renderRoot")
      ? options.renderRoot
      : env.OPENREAPER_LIVE_SMOKE_RENDER_ROOT,
  );

  return deepFreeze({
    contract: ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
    mcp_reachability: {
      status: "reachable",
      reachable: true,
    },
    bridge,
    render_root: publicRenderRootProjection(renderRoot),
    request_response: notRunRequestResponseProof(),
    safety: {
      read_only: true,
      dispatch_performed: false,
      direct_bridge_request_created: false,
      reaper_started: false,
      render_root_created: false,
    },
  });
}

export function parseAlpha3_2B3ExpectedIdentity(env = {}) {
  return deepFreeze({
    owner: parseExpectedOwner(env.OPENREAPER_LIVE_BRIDGE_OWNER),
    generation: parseAlpha3_2B3ExpectedGeneration(
      env.OPENREAPER_LIVE_BRIDGE_GENERATION,
    ),
  });
}

export function parseAlpha3_2B3ExpectedGeneration(value) {
  if (value === undefined) {
    return deepFreeze({ present: false, valid: true });
  }
  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value >= 0
      ? deepFreeze({ present: true, valid: true, value })
      : deepFreeze({ present: true, valid: false });
  }
  if (typeof value !== "string" || !/^(?:0|[1-9][0-9]*)$/u.test(value)) {
    return deepFreeze({ present: true, valid: false });
  }
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? deepFreeze({ present: true, valid: true, value: parsed })
    : deepFreeze({ present: true, valid: false });
}

export async function resolveAlpha3_2B3ManagedBridgeGeneration(sessionRoot) {
  const record = await readBoundedSingleLineRecord(
    path.join(path.resolve(sessionRoot ?? "."), "bridge-generation-v1.json"),
  );
  if (record.status !== "valid") return "1";
  try {
    const value = JSON.parse(record.value);
    if (
      value?.contract !== "openreaper.bridge_generation.v1" ||
      !Number.isSafeInteger(value.generation) ||
      value.generation < 1
    ) {
      return "1";
    }
    return String(value.generation);
  } catch {
    return "1";
  }
}

export async function inspectAlpha3_2B3RenderRoot(value) {
  const normalized = normalizePathText(value);
  if (!normalized.present) {
    return deepFreeze({
      status: "render_root_not_configured",
      ready: false,
      configured: false,
      path: null,
    });
  }
  if (!normalized.valid) {
    return deepFreeze({
      status: "render_root_path_invalid",
      ready: false,
      configured: true,
      path: null,
      reason: normalized.reason,
    });
  }

  const candidate = normalized.value;
  let initial;
  try {
    initial = await lstat(candidate);
  } catch (error) {
    return deepFreeze(renderRootInspectionError(candidate, error));
  }

  if (initial.isSymbolicLink()) {
    return deepFreeze(renderRootResult("render_root_symlink", candidate));
  }
  if (!initial.isDirectory()) {
    return deepFreeze(renderRootResult("render_root_not_directory", candidate));
  }
  if (process.platform === "win32") {
    const native = await inspectWindowsSafeDirectory(candidate);
    if (native.status === "ready") {
      return deepFreeze(renderRootResult("render_root_ready", candidate, { ready: true }));
    }
    if (native.status === "missing") return deepFreeze(renderRootResult("render_root_missing", candidate));
    if (native.status === "symlink") return deepFreeze(renderRootResult("render_root_symlink", candidate));
    if (native.status === "not_directory") return deepFreeze(renderRootResult("render_root_not_directory", candidate));
    if (native.status === "not_writable") return deepFreeze(renderRootResult("render_root_not_writable", candidate));
    return deepFreeze(renderRootResult(
      "render_root_inspection_failed",
      candidate,
      { reason: "render_root_nofollow_unavailable", native_reason: native.reason ?? null },
    ));
  }
  if (!Number.isInteger(fsConstants.O_NOFOLLOW) || !Number.isInteger(fsConstants.O_DIRECTORY)) {
    return deepFreeze(renderRootResult(
      "render_root_inspection_failed",
      candidate,
      { reason: "render_root_nofollow_unavailable" },
    ));
  }

  let handle;
  try {
    try {
      handle = await open(
        candidate,
        fsConstants.O_RDONLY | fsConstants.O_DIRECTORY | fsConstants.O_NOFOLLOW,
      );
    } catch (error) {
      if (error?.code === "ELOOP") {
        return deepFreeze(renderRootResult("render_root_changed_during_inspection", candidate));
      }
      return deepFreeze(renderRootInspectionError(candidate, error));
    }

    const opened = await handle.stat();
    if (!sameRenderRootSnapshot(initial, opened) || !opened.isDirectory()) {
      return deepFreeze(renderRootResult("render_root_changed_during_inspection", candidate));
    }

    let permissionError = null;
    try {
      await access(candidate, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
    } catch (error) {
      permissionError = error;
    }

    let finalPath;
    let finalHandle;
    try {
      [finalPath, finalHandle] = await Promise.all([lstat(candidate), handle.stat()]);
    } catch {
      return deepFreeze(renderRootResult("render_root_changed_during_inspection", candidate));
    }
    if (
      finalPath.isSymbolicLink() ||
      !finalPath.isDirectory() ||
      !finalHandle.isDirectory() ||
      !sameRenderRootSnapshot(initial, opened) ||
      !sameRenderRootSnapshot(opened, finalHandle) ||
      !sameRenderRootSnapshot(opened, finalPath)
    ) {
      return deepFreeze(renderRootResult("render_root_changed_during_inspection", candidate));
    }

    if (permissionError) {
      return deepFreeze(renderRootResult(
        PERMISSION_ERROR_CODES.has(permissionError?.code)
          ? "render_root_not_writable"
          : "render_root_inspection_failed",
        candidate,
        { error_code: boundedCode(permissionError?.code) },
      ));
    }

    return deepFreeze(renderRootResult("render_root_ready", candidate, { ready: true }));
  } finally {
    await handle?.close().catch(() => {});
  }
}

function renderRootInspectionError(candidate, error) {
  if (error?.code === "ENOENT") {
    return renderRootResult("render_root_missing", candidate);
  }
  if (PERMISSION_ERROR_CODES.has(error?.code)) {
    return renderRootResult("render_root_permission_error", candidate, {
      error_code: boundedCode(error.code),
    });
  }
  if (error?.code === "ENOTDIR") {
    return renderRootResult("render_root_not_directory", candidate);
  }
  return renderRootResult("render_root_inspection_failed", candidate, {
    error_code: boundedCode(error?.code),
  });
}

function renderRootResult(status, candidate, extra = {}) {
  return {
    status,
    ready: extra.ready === true,
    configured: true,
    path: candidate,
    ...(extra.reason ? { reason: extra.reason } : {}),
    ...(extra.error_code ? { error_code: extra.error_code } : {}),
  };
}

function sameRenderRootSnapshot(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.ctimeMs === right.ctimeMs,
  );
}

export async function resolveAlpha3_2B3DoctorRenderRoot(options = {}) {
  const env = options.env ?? process.env;
  const installRoot = path.resolve(options.installRoot ?? ".");
  const sessionRoot = path.resolve(options.sessionRoot ?? path.join(installRoot, "session"));
  const defaultRoot = path.join(sessionRoot, "renders");
  if (Object.prototype.hasOwnProperty.call(env, "OPENREAPER_LIVE_SMOKE_RENDER_ROOT")) {
    const explicit = normalizePathText(env.OPENREAPER_LIVE_SMOKE_RENDER_ROOT);
    return deepFreeze({
      source: "environment",
      path: explicit.valid ? explicit.value : null,
      selection_status: explicit.valid ? "selected" : "invalid",
      ...(explicit.valid ? {} : { reason: explicit.reason }),
      default_root: defaultRoot,
    });
  }

  const recordPath = path.join(sessionRoot, "managed-render-root.path");
  const record = await readBoundedSingleLineRecord(recordPath);
  if (record.status === "valid") {
    const selected = normalizePathText(record.value);
    return deepFreeze({
      source: "persisted_record",
      path: selected.valid ? selected.value : null,
      selection_status: selected.valid ? "selected" : "invalid",
      ...(selected.valid ? {} : { reason: selected.reason }),
      record_status: record.status,
      default_root: defaultRoot,
    });
  }
  if (record.status !== "missing") {
    return deepFreeze({
      source: "persisted_record",
      path: null,
      selection_status: "invalid",
      reason: record.reason,
      record_status: record.status,
      default_root: defaultRoot,
    });
  }

  return deepFreeze({
    source: "default",
    path: defaultRoot,
    selection_status: "selected",
    record_status: "missing",
    default_root: defaultRoot,
  });
}

export async function inspectAlpha3_2B3ReaperProcess(options = {}) {
  const sessionRoot = path.resolve(options.sessionRoot ?? ".");
  const platform = options.platform ?? process.platform;
  const pidFile = path.resolve(options.pidFile ?? path.join(sessionRoot, "reaper.pid"));
  const record = await readBoundedFile(pidFile, PID_MAX_BYTES);
  if (record.status === "missing") {
    return deepFreeze({ status: "pid_missing", running: false, pid: null });
  }
  if (record.status !== "valid") {
    return deepFreeze({
      status: "pid_invalid",
      running: false,
      pid: null,
      reason: record.reason,
    });
  }
  const text = record.value.replace(/\r?\n$/u, "");
  if (!/^[1-9][0-9]*$/u.test(text)) {
    return deepFreeze({ status: "pid_invalid", running: false, pid: null });
  }
  const pid = Number(text);
  if (!Number.isSafeInteger(pid) || pid < 1) {
    return deepFreeze({ status: "pid_invalid", running: false, pid: null });
  }

  try {
    process.kill(pid, 0);
  } catch (error) {
    if (error?.code === "ESRCH") {
      return deepFreeze({ status: "pid_dead", running: false, pid });
    }
    if (error?.code !== "EPERM") {
      return deepFreeze({ status: "pid_identity_unverified", running: false, pid });
    }
  }

  const identity = await inspectExactPidReaperIdentity(pid, {
    recordStat: record.stat,
    helperRunner: options.identityHelperRunner,
    now: options.now,
    platform,
  });
  if (identity.status !== "verified") {
    const publicStatus = identity.status === "mismatch"
      ? "pid_identity_mismatch"
      : identity.status === "record_stale"
        ? "pid_record_stale"
        : identity.status === "not_running"
          ? "pid_not_running"
          : "pid_identity_unverified";
    return deepFreeze({
      status: publicStatus,
      running: false,
      pid,
      identity_verified: false,
    });
  }
  return deepFreeze({
    status: "running",
    running: true,
    pid,
    identity_verified: true,
    process_identity: platform === "win32"
      ? "cockos_reaper_authenticode"
      : "cockos_reaper_codesign",
    launch_record_verified: true,
  });
}

async function inspectExactPidReaperIdentity(pid, options = {}) {
  const platform = options.platform ?? process.platform;
  if (platform === "win32") {
    return inspectWindowsExactPidReaperIdentity(pid, options);
  }
  const helperRunner = typeof options.helperRunner === "function"
    ? options.helperRunner
    : runBoundedIdentityHelper;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const firstProcess = await readExactPidProcessSnapshot(pid, helperRunner);
  if (firstProcess.status !== "valid") return { status: firstProcess.status };
  if (!REAPER_EXECUTABLE_BASENAMES.has(firstProcess.ucomm)) return { status: "mismatch" };
  if (!pidRecordMatchesProcessStart(options.recordStat, firstProcess.start_ms, now, platform)) {
    return { status: "record_stale" };
  }

  const firstExecutable = await readExactPidExecutablePath(pid, helperRunner);
  if (firstExecutable.status !== "valid") return { status: firstExecutable.status };
  const resolvedExecutable = await resolveBoundedExecutablePath(firstExecutable.path);
  if (!resolvedExecutable) return { status: "unverified" };
  let beforeSignature;
  try {
    beforeSignature = await lstat(resolvedExecutable);
  } catch {
    return { status: "unverified" };
  }
  if (beforeSignature.isSymbolicLink() || !beforeSignature.isFile()) {
    return { status: "unverified" };
  }

  const signature = await callIdentityHelper(helperRunner, "/usr/bin/codesign", [
    "-v",
    "--strict",
    `--test-requirement=${REAPER_CODESIGN_REQUIREMENT}`,
    resolvedExecutable,
  ]);
  if (!signature.ok) return { status: signature.failure === "rejected" ? "mismatch" : "unverified" };

  const [secondProcess, secondExecutable] = await Promise.all([
    readExactPidProcessSnapshot(pid, helperRunner),
    readExactPidExecutablePath(pid, helperRunner),
  ]);
  if (secondProcess.status !== "valid" || secondExecutable.status !== "valid") {
    return { status: "unverified" };
  }
  if (
    secondProcess.start_ms !== firstProcess.start_ms ||
    secondProcess.ucomm !== firstProcess.ucomm
  ) {
    return { status: "unverified" };
  }
  const secondResolvedExecutable = await resolveBoundedExecutablePath(secondExecutable.path);
  if (secondResolvedExecutable !== resolvedExecutable) return { status: "unverified" };

  let afterSignature;
  try {
    afterSignature = await lstat(resolvedExecutable);
    process.kill(pid, 0);
  } catch {
    return { status: "not_running" };
  }
  if (!sameFileSnapshot(beforeSignature, afterSignature)) return { status: "unverified" };
  return { status: "verified" };
}

async function inspectWindowsExactPidReaperIdentity(pid, options = {}) {
  const helperRunner = typeof options.helperRunner === "function"
    ? options.helperRunner
    : runBoundedIdentityHelper;
  const now = Number.isFinite(options.now) ? options.now : Date.now();
  const firstProcess = await readWindowsPidProcessSnapshot(pid, helperRunner);
  if (firstProcess.status !== "valid") return { status: firstProcess.status };
  if (!REAPER_EXECUTABLE_BASENAMES.has(firstProcess.process_name)) return { status: "mismatch" };
  if (
    firstProcess.signature_status !== "Valid" ||
    !/\bCN=Cockos Incorporated\b/iu.test(firstProcess.signer_subject)
  ) {
    return { status: "mismatch" };
  }
  if (!pidRecordMatchesProcessStart(options.recordStat, firstProcess.start_ms, now, "win32")) {
    return { status: "record_stale" };
  }

  const resolvedExecutable = await resolveBoundedExecutablePath(firstProcess.executable_path);
  if (!resolvedExecutable) return { status: "unverified" };
  let beforeSignature;
  try {
    beforeSignature = await lstat(resolvedExecutable);
  } catch {
    return { status: "unverified" };
  }
  if (beforeSignature.isSymbolicLink() || !beforeSignature.isFile()) {
    return { status: "unverified" };
  }

  const secondProcess = await readWindowsPidProcessSnapshot(pid, helperRunner);
  if (secondProcess.status !== "valid") return { status: "unverified" };
  const secondResolvedExecutable = await resolveBoundedExecutablePath(secondProcess.executable_path);
  if (
    secondProcess.pid !== firstProcess.pid ||
    secondProcess.process_name !== firstProcess.process_name ||
    secondProcess.start_ms !== firstProcess.start_ms ||
    secondResolvedExecutable !== resolvedExecutable
  ) {
    return { status: "unverified" };
  }

  let afterSignature;
  try {
    afterSignature = await lstat(resolvedExecutable);
    process.kill(pid, 0);
  } catch {
    return { status: "not_running" };
  }
  if (!sameFileSnapshot(beforeSignature, afterSignature)) return { status: "unverified" };
  return { status: "verified" };
}

async function readWindowsPidProcessSnapshot(pid, helperRunner) {
  const powershell = windowsPowerShellPath();
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue`,
    "if (-not $p -or -not $p.Path) { exit 3 }",
    "$signature = Get-AuthenticodeSignature -LiteralPath $p.Path",
    "[pscustomobject]@{ pid = $p.Id; process_name = $p.ProcessName; executable_path = $p.Path; start_ms = ([DateTimeOffset]$p.StartTime).ToUnixTimeMilliseconds(); signature_status = [string]$signature.Status; signer_subject = [string]$signature.SignerCertificate.Subject } | ConvertTo-Json -Compress",
  ].join("; ");
  const result = await callIdentityHelper(helperRunner, powershell, [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-Command",
    script,
  ]);
  if (!result.ok) return { status: "unverified" };
  const lines = boundedHelperLines(result.stdout);
  if (!lines || lines.length !== 1) return { status: "unverified" };
  let value;
  try {
    value = JSON.parse(lines[0]);
  } catch {
    return { status: "unverified" };
  }
  if (
    !value ||
    Array.isArray(value) ||
    Number(value.pid) !== pid ||
    typeof value.process_name !== "string" ||
    !value.process_name ||
    Buffer.byteLength(value.process_name, "utf8") > 128 ||
    /[\u0000-\u001f\u007f/\\]/u.test(value.process_name) ||
    typeof value.executable_path !== "string" ||
    typeof value.start_ms !== "number" ||
    !Number.isSafeInteger(value.start_ms) ||
    value.start_ms < 0 ||
    typeof value.signature_status !== "string" ||
    typeof value.signer_subject !== "string" ||
    Buffer.byteLength(value.signer_subject, "utf8") > 512
  ) {
    return { status: "unverified" };
  }
  return {
    status: "valid",
    pid,
    process_name: value.process_name.toLowerCase(),
    executable_path: value.executable_path,
    start_ms: value.start_ms,
    signature_status: value.signature_status,
    signer_subject: value.signer_subject,
  };
}

function windowsPowerShellPath() {
  const systemRoot = typeof process.env.SystemRoot === "string" && process.env.SystemRoot !== ""
    ? process.env.SystemRoot
    : "C:\\Windows";
  return path.join(systemRoot, ...WINDOWS_POWERSHELL_RELATIVE_PATH);
}

async function readExactPidProcessSnapshot(pid, helperRunner) {
  const result = await callIdentityHelper(helperRunner, "/bin/ps", [
    "-p",
    String(pid),
    "-o",
    "pid=",
    "-o",
    "state=",
    "-o",
    "ucomm=",
    "-o",
    "lstart=",
  ]);
  if (!result.ok) return { status: "unverified" };
  const lines = boundedHelperLines(result.stdout);
  if (!lines || lines.length !== 1) return { status: "unverified" };
  const fields = lines[0].trim().split(/\s+/u);
  if (fields.length !== 8 || Number(fields[0]) !== pid) return { status: "unverified" };
  const [pidText, state, ucomm, weekday, month, dayText, timeText, yearText] = fields;
  if (!/^[1-9][0-9]*$/u.test(pidText) || !/^[A-Z][A-Za-z+<NXL]*$/u.test(state)) {
    return { status: "unverified" };
  }
  if (state.startsWith("Z")) return { status: "not_running" };
  if (
    typeof ucomm !== "string" ||
    ucomm === "" ||
    Buffer.byteLength(ucomm, "utf8") > 128 ||
    /[\u0000-\u001f\u007f/]/u.test(ucomm)
  ) {
    return { status: "unverified" };
  }
  const startMs = parsePsLaunchTime({ weekday, month, dayText, timeText, yearText });
  if (!Number.isFinite(startMs)) return { status: "unverified" };
  return { status: "valid", state, ucomm, start_ms: startMs };
}

async function readExactPidExecutablePath(pid, helperRunner) {
  const result = await callIdentityHelper(helperRunner, "/usr/sbin/lsof", [
    "-a",
    "-p",
    String(pid),
    "-d",
    "txt",
    "-Fn",
  ]);
  if (!result.ok) return { status: "unverified" };
  const lines = boundedHelperLines(result.stdout);
  if (!lines || lines.length < 3 || lines[0] !== `p${pid}`) return { status: "unverified" };
  const paths = [];
  for (let index = 1; index < lines.length; index += 2) {
    if (lines[index] !== "ftxt" || !lines[index + 1]?.startsWith("n")) {
      return { status: "unverified" };
    }
    const candidate = lines[index + 1].slice(1);
    const normalized = normalizePathText(candidate);
    if (!normalized.valid || normalized.value !== candidate) return { status: "unverified" };
    paths.push(candidate);
  }
  if (paths.length < 1) return { status: "unverified" };
  return { status: "valid", path: paths[0] };
}

async function callIdentityHelper(helperRunner, command, args) {
  let result;
  try {
    result = await helperRunner({
      command,
      args: [...args],
      maxBytes: IDENTITY_HELPER_MAX_BYTES,
      timeoutMs: IDENTITY_HELPER_TIMEOUT_MS,
    });
  } catch {
    return { ok: false, failure: "unavailable", stdout: "" };
  }
  if (!result || typeof result !== "object" || result.ok !== true) {
    return {
      ok: false,
      failure: result?.failure === "rejected" ? "rejected" : "unavailable",
      stdout: "",
    };
  }
  if (
    typeof result.stdout !== "string" ||
    Buffer.byteLength(result.stdout, "utf8") > IDENTITY_HELPER_MAX_BYTES
  ) {
    return { ok: false, failure: "unavailable", stdout: "" };
  }
  return { ok: true, stdout: result.stdout };
}

async function runBoundedIdentityHelper({ command, args, maxBytes, timeoutMs }) {
  try {
    const { stdout } = await execFileAsync(command, args, {
      encoding: "utf8",
      env: { ...process.env, LC_ALL: "C", LANG: "C" },
      killSignal: "SIGKILL",
      maxBuffer: maxBytes,
      timeout: timeoutMs,
      windowsHide: true,
    });
    return { ok: true, stdout };
  } catch (error) {
    return {
      ok: false,
      failure: command === "/usr/bin/codesign" &&
        Number.isInteger(error?.code) &&
        error.code !== 0
        ? "rejected"
        : "unavailable",
      stdout: "",
    };
  }
}

function boundedHelperLines(value) {
  if (
    typeof value !== "string" ||
    value === "" ||
    Buffer.byteLength(value, "utf8") > IDENTITY_HELPER_MAX_BYTES ||
    /[\u0000\u007f]/u.test(value)
  ) {
    return null;
  }
  const lines = value.split(/\r?\n/u).filter((line) => line !== "");
  return lines.length <= 256 ? lines : null;
}

function parsePsLaunchTime({ weekday, month, dayText, timeText, yearText }) {
  const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = months.indexOf(month);
  const weekdayIndex = weekdays.indexOf(weekday);
  if (
    monthIndex < 0 ||
    weekdayIndex < 0 ||
    !/^(?:[1-9]|[12][0-9]|3[01])$/u.test(dayText) ||
    !/^\d{2}:\d{2}:\d{2}$/u.test(timeText) ||
    !/^\d{4}$/u.test(yearText)
  ) {
    return null;
  }
  const [hour, minute, second] = timeText.split(":").map(Number);
  const year = Number(yearText);
  const day = Number(dayText);
  if (hour > 23 || minute > 59 || second > 59 || year < 2000 || year > 9999) return null;
  const value = new Date(year, monthIndex, day, hour, minute, second, 0);
  if (
    value.getFullYear() !== year ||
    value.getMonth() !== monthIndex ||
    value.getDate() !== day ||
    value.getDay() !== weekdayIndex
  ) {
    return null;
  }
  return value.getTime();
}

export function pidRecordMatchesProcessStart(recordStat, processStartMs, now, platform = process.platform) {
  if (
    !recordStat ||
    !Number.isFinite(recordStat.mtime_ms) ||
    (platform !== "win32" && !Number.isFinite(recordStat.ctime_ms)) ||
    !Number.isFinite(processStartMs) ||
    processStartMs > now + PID_RECORD_CLOCK_SKEW_MS
  ) {
    return false;
  }
  const recordTimes = platform === "win32"
    ? [recordStat.mtime_ms]
    : [recordStat.mtime_ms, recordStat.ctime_ms];
  return recordTimes.every((recordTime) =>
    recordTime >= processStartMs - PID_RECORD_CLOCK_SKEW_MS &&
    recordTime <= processStartMs + PID_RECORD_LAUNCH_WINDOW_MS &&
    recordTime <= now + PID_RECORD_CLOCK_SKEW_MS,
  );
}

async function resolveBoundedExecutablePath(value) {
  const normalized = normalizePathText(value);
  if (!normalized.valid) return null;
  let resolved;
  try {
    resolved = await promiseWithTimeout(realpath(normalized.value), IDENTITY_REALPATH_TIMEOUT_MS);
  } catch {
    return null;
  }
  const finalPath = normalizePathText(resolved);
  return finalPath.valid ? finalPath.value : null;
}

async function promiseWithTimeout(promise, timeoutMs) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("bounded_timeout")), timeoutMs);
        timer.unref?.();
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

function sameFileSnapshot(left, right) {
  return Boolean(
    left &&
    right &&
    left.dev === right.dev &&
    left.ino === right.ino &&
    left.mode === right.mode &&
    left.nlink === right.nlink &&
    left.size === right.size &&
    left.mtimeMs === right.mtimeMs &&
    left.ctimeMs === right.ctimeMs,
  );
}

export function normalizeAlpha3_2B3RequestResponseProof(result, identity) {
  const expectedOwner = identity?.owner?.valid ? identity.owner.value : null;
  const expectedGeneration = identity?.generation?.valid ? identity.generation.value : null;
  if (!result || typeof result !== "object") {
    return deepFreeze({
      status: "failed",
      ready: false,
      template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
      error_code: "MCP_READ_PROBE_INVALID",
    });
  }
  if (result.ok !== true) {
    return deepFreeze({
      status: result?.error?.code === "BRIDGE_TIMEOUT" ? "timeout" : "failed",
      ready: false,
      template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
      error_code: boundedCode(result?.error?.code ?? result?.error_code) ?? "MCP_READ_PROBE_FAILED",
    });
  }
  if (
    (expectedOwner !== null && result?.bridge?.owner !== expectedOwner) ||
    (expectedGeneration !== null && result?.bridge?.generation !== expectedGeneration)
  ) {
    return deepFreeze({
      status: "identity_mismatch",
      ready: false,
      template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
      error_code: "MCP_READ_PROBE_IDENTITY_MISMATCH",
    });
  }
  return deepFreeze({
    status: "ready",
    ready: true,
    template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
    bridge_owner_match: expectedOwner === null || result.bridge.owner === expectedOwner,
    bridge_generation_match:
      expectedGeneration === null || result.bridge.generation === expectedGeneration,
  });
}

export function createAlpha3_2B3DoctorTaskResult(options = {}) {
  const mode = options.mode;
  if (!ALPHA3_2B3_DOCTOR_TASK_MODES.includes(mode)) {
    throw new TypeError(`Unsupported Alpha3.2-B3 doctor mode: ${boundedText(mode, 64)}`);
  }
  const runtime = options.runtimeReadiness ?? {};
  const requestResponse = options.requestResponse ?? notRunRequestResponseProof();
  const reaperProcess = options.reaperProcess ?? { status: "not_assessed", running: false };
  const renderInspection = options.renderInspection ?? {
    status: runtime?.render_root?.status ?? "render_root_not_configured",
    ready: runtime?.render_root?.ready === true,
    path: null,
  };
  const diagnosis = doctorBridgeDiagnosis(runtime?.bridge, reaperProcess);
  const bridgeReady = runtime?.bridge?.status === LIVE_BRIDGE_LIVENESS_STATUS.READY &&
    runtime?.bridge?.diagnosis === "bridge_ready" &&
    runtime?.bridge?.ready !== false;
  const missing = [];

  if (!bridgeReady) {
    missing.push(diagnosis);
  }
  if (bridgeReady && requestResponse.ready !== true) {
    missing.push("request_response_not_ready");
  }
  if (mode === "render" && renderInspection.ready !== true) {
    missing.push(renderInspection.status ?? "render_root_not_ready");
  }

  if (missing.length > 0) {
    const first = missing[0];
    const recovery = recoveryForFailure(first, {
      mode,
      installRoot: options.installRoot,
      startCommand: options.startCommand,
      bridgeActionName: options.bridgeActionName,
      renderInspection,
      transportDir: options.transportDir,
      reaperProcess,
    });
    return deepFreeze({
      contract: ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
      mode,
      status: "blocked",
      ready: false,
      missing_precondition: first,
      missing_preconditions: missing.slice(0, 8),
      failure_layer: failureLayerFor(first),
      recoverable: recovery.recoverable,
      next_action: recovery.next_action,
      user_action_required: recovery.user_action_required,
      restart_required: recovery.restart_required,
      ...(recovery.restart_escalation
        ? { restart_escalation: recovery.restart_escalation }
        : {}),
      safe_copy_paste_fix: recovery.safe_copy_paste_fix,
      recovery_card: beginnerRecoveryCard(first, runtime?.bridge, recovery, reaperProcess),
      same_instance_recovery: recovery.same_instance_recovery ?? null,
      evidence: taskEvidence(runtime, requestResponse, reaperProcess, renderInspection),
      ...(mode === "render" ? renderPreflight(false) : {}),
    });
  }

  if (mode === "media-import" || mode === "project-query") {
    const taskSpecific = mode === "media-import"
      ? "media_source_and_index_readiness_not_assessed"
      : "project_query_index_readiness_not_assessed";
    return deepFreeze({
      contract: ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
      mode,
      status: "degraded",
      ready: false,
      missing_precondition: taskSpecific,
      missing_preconditions: [taskSpecific],
      failure_layer: "task_specific",
      recoverable: true,
      next_action: {
        code: "await_task_specific_evidence",
        instruction: mode === "media-import"
          ? "Shared bridge/read preflight passed; media source and index readiness remain not assessed in B3."
          : "Shared bridge/read preflight passed; project-query index readiness remains not assessed in B3.",
      },
      user_action_required: false,
      restart_required: { mcp_client: false, reaper: false },
      safe_copy_paste_fix: null,
      task_specific_readiness: "not_assessed",
      evidence: taskEvidence(runtime, requestResponse, reaperProcess, renderInspection),
    });
  }

  return deepFreeze({
    contract: ALPHA3_2B3_RUNTIME_DOCTOR_READINESS_CONTRACT,
    mode,
    status: "ready",
    ready: true,
    missing_precondition: null,
    missing_preconditions: [],
    failure_layer: null,
    recoverable: true,
    next_action: {
      code: mode === "render" ? "render_preflight_ready" : "live_edit_ready",
      instruction: mode === "render"
        ? "Bridge/read and managed render-root preflight passed; render execution and codec support are not proven."
        : "Bridge heartbeat and bounded live read probe passed for live editing.",
    },
    user_action_required: false,
    restart_required: { mcp_client: false, reaper: false },
    safe_copy_paste_fix: null,
    evidence: taskEvidence(runtime, requestResponse, reaperProcess, renderInspection),
    ...(mode === "render" ? renderPreflight(true) : {}),
  });
}

function beginnerRecoveryCard(diagnosis, bridge, recovery, reaperProcess) {
  const observed = bridge?.observed ?? {};
  const expected = bridge?.expected ?? {};
  return {
    diagnosis,
    likely_cause: diagnosis === "bridge_loop_unresponsive"
      ? "The heartbeat is stale; it cannot distinguish a stopped Action from an unresponsive loop."
      : diagnosis === "bridge_action_not_running"
        ? "REAPER is present but the installed bridge Action has not produced a heartbeat."
        : diagnosis === "owner_generation_mismatch"
          ? "This bridge heartbeat belongs to a different OpenReaper session identity."
          : diagnosis === "reaper_not_running"
            ? "The installed OpenReaper session has no verified running REAPER process."
          : "The OpenReaper live precondition is not ready.",
    ...(diagnosis === "owner_generation_mismatch" ? {
      expected_identity: { owner: expected.owner ?? null, generation: expected.generation ?? null },
      observed_identity: { owner: observed.owner ?? null, generation: observed.generation ?? null },
    } : {}),
    recovery: recovery.next_action.instruction,
    action_auto_run: false,
    ...(recovery.same_instance_recovery
      ? { same_instance_recovery: recovery.same_instance_recovery }
      : {}),
    ...(reaperProcess?.running === true && Number.isSafeInteger(reaperProcess.pid)
      ? { reaper_pid: reaperProcess.pid, reaper_identity_verified: reaperProcess.identity_verified === true }
      : {}),
  };
}

export function parseAlpha3_2B3DoctorArgs(args = []) {
  let mode = null;
  let waitBridgeSeconds = null;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--for") {
      const value = args[index + 1];
      if (!value || value.startsWith("--")) return invalidArgs("--for requires a task mode");
      if (mode !== null) return invalidArgs("--for may be supplied only once");
      mode = value;
      index += 1;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--for=")) {
      if (mode !== null) return invalidArgs("--for may be supplied only once");
      mode = arg.slice("--for=".length);
      continue;
    }
    if (arg === "--wait-bridge") {
      if (waitBridgeSeconds !== null) return invalidArgs("--wait-bridge may be supplied only once");
      waitBridgeSeconds = ALPHA3_2B3_WAIT_BRIDGE_SECONDS.default;
      continue;
    }
    if (typeof arg === "string" && arg.startsWith("--wait-bridge=")) {
      if (waitBridgeSeconds !== null) return invalidArgs("--wait-bridge may be supplied only once");
      const raw = arg.slice("--wait-bridge=".length);
      if (!/^(?:0|[1-9][0-9]*)$/u.test(raw)) {
        return invalidArgs("--wait-bridge seconds must be an integer");
      }
      waitBridgeSeconds = Number(raw);
      continue;
    }
    return invalidArgs(`unknown option: ${boundedText(arg, 80)}`);
  }

  if (mode !== null && !ALPHA3_2B3_DOCTOR_TASK_MODES.includes(mode)) {
    return invalidArgs(`unsupported --for mode: ${boundedText(mode, 80)}`);
  }
  if (
    waitBridgeSeconds !== null &&
    (!Number.isSafeInteger(waitBridgeSeconds) ||
      waitBridgeSeconds < ALPHA3_2B3_WAIT_BRIDGE_SECONDS.min ||
      waitBridgeSeconds > ALPHA3_2B3_WAIT_BRIDGE_SECONDS.max)
  ) {
    return invalidArgs(
      `--wait-bridge seconds must be ${ALPHA3_2B3_WAIT_BRIDGE_SECONDS.min}-${ALPHA3_2B3_WAIT_BRIDGE_SECONDS.max}`,
    );
  }
  return deepFreeze({ ok: true, mode, wait_bridge_seconds: waitBridgeSeconds });
}

export function alpha3_2B3ReadProbeTimeoutMs(env = {}) {
  const raw = env.OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS;
  if (raw === undefined) return ALPHA3_2B3_READ_PROBE_TIMEOUT_MS.default;
  if (!/^(?:0|[1-9][0-9]*)$/u.test(String(raw))) {
    return ALPHA3_2B3_READ_PROBE_TIMEOUT_MS.default;
  }
  const parsed = Number(raw);
  if (!Number.isSafeInteger(parsed)) return ALPHA3_2B3_READ_PROBE_TIMEOUT_MS.default;
  return Math.max(
    ALPHA3_2B3_READ_PROBE_TIMEOUT_MS.min,
    Math.min(ALPHA3_2B3_READ_PROBE_TIMEOUT_MS.max, parsed),
  );
}

function projectBridgeReadiness(rawProbe, identity, transportInspection) {
  const status = Object.values(LIVE_BRIDGE_LIVENESS_STATUS).includes(rawProbe?.status)
    ? rawProbe.status
    : LIVE_BRIDGE_LIVENESS_STATUS.HEARTBEAT_INVALID;
  const observed = rawProbe?.heartbeat?.observed;
  const reason = PUBLIC_REASON_CODES.has(rawProbe?.details?.reason)
    ? rawProbe.details.reason
    : null;
  const errorCode = boundedCode(rawProbe?.details?.error_code);
  const diagnosis = bridgeDiagnosis(status, reason, errorCode, transportInspection);
  return {
    probe_contract: LIVE_BRIDGE_LIVENESS_PROBE_CONTRACT,
    status,
    diagnosis,
    ready: status === LIVE_BRIDGE_LIVENESS_STATUS.READY && diagnosis === "bridge_ready",
    configured: rawProbe?.configured === true,
    expected: compactExpectedIdentity(identity),
    ...(observed
      ? {
          observed: {
            owner: boundedText(observed.active_owner, OWNER_MAX_BYTES),
            generation: Number.isSafeInteger(observed.active_generation)
              ? observed.active_generation
              : null,
            age_ms: boundedNonNegativeInteger(observed.age_ms),
            interval_ms: boundedNonNegativeInteger(observed.interval_ms),
          },
        }
      : {}),
    ...(reason ? { reason } : {}),
    ...(diagnosis === "transport_permission_error"
      ? {
          permission_repair: "manual_required",
        }
      : {}),
  };
}

function publicRenderRootProjection(inspection) {
  return {
    status: inspection.status,
    ready: inspection.ready,
    configured: inspection.configured,
    source: "OPENREAPER_LIVE_SMOKE_RENDER_ROOT",
    ...(inspection.reason ? { reason: inspection.reason } : {}),
  };
}

function compactExpectedIdentity(identity) {
  const projected = {
    owner_present: identity.owner.present,
    owner_valid: identity.owner.valid,
    generation_present: identity.generation.present,
    generation_valid: identity.generation.valid,
  };
  if (identity.owner.present && identity.owner.valid) projected.owner = identity.owner.value;
  if (identity.generation.present && identity.generation.valid) {
    projected.generation = identity.generation.value;
  }
  return projected;
}

async function inspectTransportPermission({ transportDir, rawProbe }) {
  const errorCode = boundedCode(rawProbe?.details?.error_code);
  const rawPermissionError = PERMISSION_ERROR_CODES.has(errorCode);
  if (typeof transportDir !== "string" || transportDir === "") {
    return { permission_error: rawPermissionError };
  }
  let directionalPermissionError = false;
  for (const [candidate, requiredAccess] of [
    [transportDir, fsConstants.R_OK | fsConstants.X_OK],
    [path.join(transportDir, "requests"), fsConstants.W_OK | fsConstants.X_OK],
    [path.join(transportDir, "results"), fsConstants.R_OK | fsConstants.X_OK],
  ]) {
    try {
      await access(candidate, requiredAccess);
    } catch (error) {
      if (PERMISSION_ERROR_CODES.has(error?.code)) directionalPermissionError = true;
    }
  }
  return { permission_error: rawPermissionError || directionalPermissionError };
}

function bridgeDiagnosis(status, reason, errorCode, transportInspection) {
  if (transportInspection.permission_error || PERMISSION_ERROR_CODES.has(errorCode)) {
    return "transport_permission_error";
  }
  switch (status) {
    case LIVE_BRIDGE_LIVENESS_STATUS.CONFIG_ABSENT:
      return "bridge_config_absent";
    case LIVE_BRIDGE_LIVENESS_STATUS.TRANSPORT_ABSENT:
      return "bridge_transport_absent";
    case LIVE_BRIDGE_LIVENESS_STATUS.ACTION_NOT_RUNNING:
      return "bridge_action_not_running";
    case LIVE_BRIDGE_LIVENESS_STATUS.LOOP_UNRESPONSIVE:
      return "bridge_loop_unresponsive";
    case LIVE_BRIDGE_LIVENESS_STATUS.OWNER_MISMATCH:
    case LIVE_BRIDGE_LIVENESS_STATUS.GENERATION_MISMATCH:
      return "owner_generation_mismatch";
    case LIVE_BRIDGE_LIVENESS_STATUS.PROBE_INPUT_INVALID:
      return "bridge_probe_input_invalid";
    case LIVE_BRIDGE_LIVENESS_STATUS.READY:
      return "bridge_ready";
    default:
      return reason === "expected_identity_invalid"
        ? "bridge_probe_input_invalid"
        : "bridge_heartbeat_invalid";
  }
}

function doctorBridgeDiagnosis(bridge, reaperProcess) {
  if (bridge?.diagnosis === "bridge_action_not_running" && reaperProcess?.running !== true) {
    return "reaper_not_running";
  }
  return bridge?.diagnosis ?? "bridge_heartbeat_invalid";
}

function taskEvidence(runtime, requestResponse, reaperProcess, renderInspection) {
  return {
    mcp_reachability: runtime?.mcp_reachability?.status ?? "unknown",
    bridge_status: runtime?.bridge?.status ?? null,
    bridge_diagnosis: runtime?.bridge?.diagnosis ?? null,
    request_response_status: requestResponse?.status ?? "not_run",
    render_root_status: renderInspection?.status ?? runtime?.render_root?.status ?? null,
    reaper_process_status: reaperProcess?.status ?? "not_assessed",
  };
}

function recoveryForFailure(code, options) {
  const startCommand = normalizeSafeCommand(options.startCommand) ?? "~/.openreaper/current/bin/openreaper-start";
  const bridgeAction = boundedText(options.bridgeActionName, 160) ?? "OpenReaper: Start MCP bridge";
  const sameInstance = sameInstanceRecovery(options.reaperProcess);
  if (code === "reaper_not_running") {
    return recovery({
      instruction: "Start REAPER through OpenReaper, run the installed bridge Action, then reconnect and rerun doctor.",
      code: "start_reaper_through_openreaper",
      userAction: true,
      mcpRestart: true,
      reaperRestart: false,
      fix: startCommand,
    });
  }
  if (code === "bridge_action_not_running") {
    return recovery({
      instruction: sameInstance
        ? `The verified REAPER PID ${sameInstance.reaper_pid} is alive, but OpenReaper cannot restart its stopped Bridge externally. In that same REAPER, run the Action \"${bridgeAction}\", then rerun doctor; do not start another REAPER.`
        : `In REAPER, run the Action \"${bridgeAction}\", then rerun doctor or reconnect the MCP client.`,
      code: sameInstance ? "same_instance_bridge_action_required" : "run_bridge_action",
      userAction: true,
      mcpRestart: true,
      reaperRestart: false,
      fix: null,
      sameInstanceRecovery: sameInstance,
    });
  }
  if (code === "bridge_loop_unresponsive") {
    return recovery({
      instruction: sameInstance
        ? `The heartbeat is stale but verified REAPER PID ${sameInstance.reaper_pid} is alive. OpenReaper cannot restart its stopped Bridge externally; in that same REAPER, run the Action "${bridgeAction}", then rerun doctor; do not start another REAPER.`
        : `The heartbeat is stale. In REAPER, rerun the Action "${bridgeAction}", then rerun doctor. Restart the OpenReaper session only if the heartbeat remains stale.`,
      code: sameInstance ? "same_instance_bridge_action_required" : "rerun_bridge_action_then_escalate_session_restart",
      userAction: true,
      mcpRestart: false,
      reaperRestart: false,
      ...(sameInstance ? {} : {
        restartEscalation: {
          reaper: {
            conditional: true,
            condition: "heartbeat_remains_stale_after_rerunning_bridge_action",
          },
        },
      }),
      fix: null,
      sameInstanceRecovery: sameInstance,
    });
  }
  if (code === "owner_generation_mismatch") {
    return recovery({
      instruction: "Reconnect the MCP client to the current OpenReaper session identity. Restart the OpenReaper session only if the mismatch persists.",
      code: "reconnect_matching_session_identity",
      userAction: true,
      mcpRestart: true,
      reaperRestart: false,
      restartEscalation: {
        reaper: {
          conditional: true,
          condition: "identity_mismatch_persists_after_mcp_reconnect",
        },
      },
      fix: null,
    });
  }
  if (code === "transport_permission_error") {
    return recovery({
      instruction: "Automatic transport mutation is intentionally unavailable. Manually repair the three real directories without following links: transport needs user read/execute, requests needs user write/execute, and results needs user read/execute; then rerun doctor. No MCP or REAPER restart is required.",
      code: "repair_transport_permissions_manually",
      userAction: true,
      mcpRestart: false,
      reaperRestart: false,
      fix: null,
    });
  }
  if (String(code).startsWith("render_root_")) {
    const renderRecovery = renderRootRecovery(options.renderInspection, startCommand);
    return recovery({
      instruction: renderRecovery.instruction,
      code: "repair_managed_render_root",
      userAction: true,
      mcpRestart: renderRecovery.restart,
      reaperRestart: renderRecovery.restart,
      fix: renderRecovery.fix,
    });
  }
  if (code === "request_response_not_ready") {
    return recovery({
      instruction: "The heartbeat is live but the bounded read probe failed. Resolve any REAPER dialog, rerun the bridge Action, then reconnect and retry.",
      code: "retry_live_read_probe",
      userAction: true,
      mcpRestart: true,
      reaperRestart: false,
      fix: null,
    });
  }
  if (code === "bridge_config_absent" || code === "bridge_transport_absent") {
    return recovery({
      instruction: "Start REAPER through OpenReaper so the accepted session transport is selected; do not create direct bridge request files.",
      code: "start_configured_openreaper_session",
      userAction: true,
      mcpRestart: true,
      reaperRestart: false,
      fix: startCommand,
    });
  }
  return recovery({
    instruction: "Inspect the bounded bridge status, then rerun the installed bridge Action or reconnect before retrying.",
    code: "recover_bridge_readiness",
    userAction: true,
    mcpRestart: true,
    reaperRestart: false,
    fix: null,
  });
}

function renderRootRecovery(inspection, startCommand) {
  const fix = freshRenderRootRecoveryFix(startCommand);
  const status = boundedCode(inspection?.status) ?? "render_root_not_ready";
  return {
    instruction: fix
      ? `The selected render root is not modified (${status}). Run the bounded recovery command to create a fresh unique managed render root beneath the canonical system temporary directory and start a new OpenReaper session with it; then reconnect and rerun doctor. This does not repair the original selected path.`
      : `The selected render root is not modified (${status}). Manually create a fresh real render directory beneath a trusted canonical location, start a new OpenReaper session with the existing openreaper-start --render-root option, then reconnect and rerun doctor. This does not repair the original selected path.`,
    fix,
    restart: true,
  };
}

function recovery({ instruction, code, userAction, mcpRestart, reaperRestart, restartEscalation, fix, sameInstanceRecovery }) {
  return {
    recoverable: true,
    next_action: { code, instruction: boundedText(instruction, 640) },
    user_action_required: userAction,
    restart_required: {
      mcp_client: mcpRestart,
      reaper: reaperRestart,
    },
    ...(restartEscalation ? { restart_escalation: restartEscalation } : {}),
    safe_copy_paste_fix: boundedCopyPasteFix(fix),
    ...(sameInstanceRecovery ? { same_instance_recovery: sameInstanceRecovery } : {}),
  };
}

function sameInstanceRecovery(reaperProcess) {
  if (reaperProcess?.running !== true || reaperProcess?.identity_verified !== true || !Number.isSafeInteger(reaperProcess.pid)) {
    return null;
  }
  return {
    scope: "same_reaper_instance",
    reaper_pid: reaperProcess.pid,
    identity_verified: true,
    duplicate_launch_forbidden: true,
    reaper_restart_allowed: false,
    automatic_bridge_restart_available: false,
    required_action: "run_registered_bridge_action",
  };
}

function failureLayerFor(code) {
  if (code === "reaper_not_running") return "reaper_process";
  if (String(code).startsWith("render_root_")) return "render_root";
  if (code === "request_response_not_ready") return "request_response";
  if (code === "media_source_and_index_readiness_not_assessed" ||
      code === "project_query_index_readiness_not_assessed") return "task_specific";
  return "bridge_heartbeat";
}

function renderPreflight(ready) {
  return {
    ready_for_render: ready,
    render_execution_proven: false,
    codec_support_assessed: false,
    scope: "preflight_only",
  };
}

function notRunRequestResponseProof() {
  return {
    status: "not_run",
    ready: false,
    template_id: ALPHA3_2B3_READ_PROBE_TEMPLATE_ID,
  };
}

function parseExpectedOwner(value) {
  if (value === undefined) return deepFreeze({ present: false, valid: true });
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    Buffer.byteLength(value, "utf8") > OWNER_MAX_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return deepFreeze({ present: true, valid: false });
  }
  return deepFreeze({ present: true, valid: true, value });
}

function normalizePathText(value) {
  if (value === undefined || value === null || value === "") return { present: false, valid: false };
  if (typeof value !== "string") return { present: true, valid: false, reason: "path_not_string" };
  if (Buffer.byteLength(value, "utf8") > PATH_MAX_BYTES) {
    return { present: true, valid: false, reason: "path_too_long" };
  }
  if (/^file:/iu.test(value)) return { present: true, valid: false, reason: "file_uri_not_allowed" };
  if (/[\u0000-\u001f\u007f]/u.test(value)) {
    return { present: true, valid: false, reason: "path_controls_not_allowed" };
  }
  if (!path.isAbsolute(value)) return { present: true, valid: false, reason: "path_not_absolute" };
  const normalized = path.normalize(value);
  if (normalized === path.parse(normalized).root) {
    return { present: true, valid: false, reason: "filesystem_root_not_allowed" };
  }
  return { present: true, valid: true, value: normalized };
}

async function readBoundedSingleLineRecord(filePath) {
  const record = await readBoundedFile(filePath, RECORD_MAX_BYTES);
  if (record.status !== "valid") return record;
  let value = record.value;
  if (value.endsWith("\n")) value = value.slice(0, -1);
  if (value === "" || value.includes("\n") || value.includes("\r")) {
    return { status: "invalid", reason: "record_not_single_line" };
  }
  return { status: "valid", value };
}

async function readBoundedFile(filePath, maxBytes) {
  if (process.platform === "win32") {
    return readBoundedFileWithWindowsSafeOpen(filePath, maxBytes);
  }
  let handle;
  try {
    const entry = await lstat(filePath);
    if (entry.isSymbolicLink() || !entry.isFile()) {
      return { status: "invalid", reason: "record_not_regular_file" };
    }
    if (!Number.isSafeInteger(entry.size) || entry.size > maxBytes) {
      return { status: "invalid", reason: "record_too_large" };
    }
    if (!Number.isInteger(fsConstants.O_NOFOLLOW)) {
      return { status: "invalid", reason: "record_nofollow_unavailable" };
    }
    handle = await open(filePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
    const opened = await handle.stat();
    if (!opened.isFile() || !sameFileSnapshot(entry, opened)) {
      return { status: "invalid", reason: "record_changed_during_read" };
    }
    const buffer = Buffer.alloc(maxBytes + 1);
    let offset = 0;
    while (offset < buffer.length) {
      const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
      if (bytesRead === 0) break;
      offset += bytesRead;
    }
    if (offset > maxBytes) return { status: "invalid", reason: "record_too_large" };
    const [finalHandle, finalPath] = await Promise.all([handle.stat(), lstat(filePath)]);
    if (
      !finalHandle.isFile() ||
      finalPath.isSymbolicLink() ||
      !finalPath.isFile() ||
      !sameFileSnapshot(opened, finalHandle) ||
      !sameFileSnapshot(opened, finalPath) ||
      offset !== opened.size
    ) {
      return { status: "invalid", reason: "record_changed_during_read" };
    }
    let value;
    try {
      value = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, offset));
    } catch {
      return { status: "invalid", reason: "record_invalid_utf8" };
    }
    return {
      status: "valid",
      value,
      stat: {
        mtime_ms: opened.mtimeMs,
        ctime_ms: opened.ctimeMs,
      },
    };
  } catch (error) {
    if (error?.code === "ENOENT") return { status: "missing" };
    return {
      status: "invalid",
      reason: PERMISSION_ERROR_CODES.has(error?.code) ? "record_permission_error" : "record_read_failed",
    };
  } finally {
    await handle?.close().catch(() => {});
  }
}

async function readBoundedFileWithWindowsSafeOpen(filePath, maxBytes) {
  const result = await readWindowsSafeFile(filePath, { maxBytes });
  if (result.status === "missing") return { status: "missing" };
  if (result.status !== "valid") {
    const reasonMap = {
      link_count_invalid: "record_link_count_invalid",
      not_regular_file: "record_not_regular_file",
      file_too_large: "record_too_large",
      file_changed_during_read: "record_changed_during_read",
    };
    return {
      status: "invalid",
      reason: reasonMap[result.reason] ?? (
        result.status === "unavailable" ? "record_nofollow_unavailable" : "record_read_failed"
      ),
    };
  }

  let value;
  try {
    value = new TextDecoder("utf-8", { fatal: true }).decode(result.bytes);
  } catch {
    return { status: "invalid", reason: "record_invalid_utf8" };
  }
  return {
    status: "valid",
    value,
    stat: {
      mtime_ms: result.mtime_ms,
      ctime_ms: result.ctime_ms,
    },
  };
}

function invalidArgs(message) {
  return deepFreeze({ ok: false, exit_code: 2, error: boundedText(message, 320) });
}

function freshRenderRootRecoveryFix(startCommand) {
  const executable = normalizePathText(process.execPath);
  if (!executable.valid || typeof startCommand !== "string" || startCommand === "") return null;
  return boundedCopyPasteFix(
    `ROOT="$(${shellQuote(executable.value)} -e ${shellQuote(NODE_FRESH_RENDER_ROOT_SCRIPT)})" && test -n "$ROOT" && ${startCommand} --render-root "$ROOT"`,
  );
}

function boundedCopyPasteFix(value) {
  if (
    typeof value !== "string" ||
    value === "" ||
    Buffer.byteLength(value, "utf8") > SAFE_FIX_MAX_BYTES ||
    /[\u0000-\u001f\u007f]/u.test(value)
  ) {
    return null;
  }
  return value;
}

function normalizeSafeCommand(value) {
  if (
    typeof value !== "string" ||
    value === "" ||
    Buffer.byteLength(value, "utf8") > 1_024 ||
    /[\u0000-\u001f\u007f\n\r]/u.test(value)
  ) {
    return null;
  }
  if (path.isAbsolute(value)) return shellQuote(value);
  if (/^~\/[A-Za-z0-9._~/-]+$/u.test(value)) return value;
  return null;
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", `'"'"'`)}'`;
}

function boundedCode(value) {
  if (typeof value !== "string" || value === "") return null;
  const cleaned = value.replace(/[^A-Za-z0-9_.:-]/gu, "_");
  return cleaned.slice(0, 64) || null;
}

function boundedText(value, maxBytes) {
  if (typeof value !== "string" || value === "") return null;
  const cleaned = value.replace(/[\u0000-\u001f\u007f]/gu, " ");
  if (Buffer.byteLength(cleaned, "utf8") <= maxBytes) return cleaned;
  let output = "";
  for (const character of cleaned) {
    if (Buffer.byteLength(output + character, "utf8") > maxBytes) break;
    output += character;
  }
  return output;
}

function boundedNonNegativeInteger(value) {
  return Number.isFinite(value)
    ? Math.max(0, Math.min(Number.MAX_SAFE_INTEGER, Math.floor(value)))
    : null;
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
