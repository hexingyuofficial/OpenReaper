#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
BRIDGE_SCRIPT="${INSTALL_ROOT}/vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"
REAPER_BIN="/Applications/REAPER.app/Contents/MacOS/REAPER"
REAPER_APP=""
DIRECT_BINARY=false
SESSION_ROOT="${INSTALL_ROOT}/session"
SESSION_ROOT_EXPLICIT=false
RENDER_ROOT=""
RENDER_ROOT_EXPLICIT=false
MANAGED_RENDER_ROOT_RECORD="${INSTALL_ROOT}/session/managed-render-root.path"
TRANSPORT_DIR=""
ARTIFACT_ROOT=""
PROJECT_INDEX_STATE_ROOT=""
BRIDGE_OWNER=""
BRIDGE_GENERATION=""
START_WAIT_SECONDS="${OPENREAPER_START_WAIT_SECONDS:-20}"
STARTUP_DIALOG_TIMEOUT_SECONDS="${OPENREAPER_STARTUP_DIALOG_TIMEOUT_SECONDS:-5}"
STARTUP_DIALOG_ASSIST=true
IGNORE_MISSING_MEDIA=false
STARTUP_DIALOG_CONSENT=""
STARTUP_DIALOG_CONSENT_EXPLICIT=false
RECOVER_EXISTING=false
STARTUP_DIALOG_POLICY_FILE="${INSTALL_ROOT:h}/data/startup-dialog-consent"
LAUNCHCTL_BIN="/bin/launchctl"
OPEN_BIN="/usr/bin/open"
LAUNCHSERVICES_LOCK_PATH="${INSTALL_ROOT}/session/.openreaper-launchservices-env.lock"
LAUNCHSERVICES_LOCK_OWNED=false
LAUNCHSERVICES_LOCK_TOKEN=""
LAUNCHSERVICES_SNAPSHOT_DIR=""
LAUNCHSERVICES_CLEANUP_REQUIRED=false
LAUNCHSERVICES_RECOVERY_RETAINED=false
LAUNCHSERVICES_LOCK_TOKEN_WRITTEN=false
LAUNCHSERVICES_LOCK_METADATA_WRITTEN=false
LAUNCHSERVICES_SNAPSHOT_CREATED=false
LAUNCHSERVICES_ENV_KEYS=(
  OPENREAPER_SESSION_ROOT
  OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR
  OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH
  OPENREAPER_ARTIFACT_ROOT
  OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT
  OPENREAPER_LIVE_SMOKE_RENDER_ROOT
  OPENREAPER_LIVE_BRIDGE_OWNER
  OPENREAPER_LIVE_BRIDGE_GENERATION
  OPENREAPER_LIVE_BRIDGE_SESSION_ID
  OPENREAPER_PROJECT_INDEX_STATE_ROOT
  OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY
  OPENREAPER_CURRENT_PROJECT_PATH
  OPENREAPER_CURRENT_PROJECT_REF
  OPENREAPER_MCP_PACKAGE_ROOT
)

PROJECT_PATH=""
ARGS=()
# An installed launch must never carry another OpenReaper session into REAPER.
# Explicit supported CLI options below are the only way to select a non-default
# session, transport, artifact, render, or bridge identity for this launch.
for stale_openreaper_env in \
  OPENREAPER_SESSION_ROOT \
  OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR \
  OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH \
  OPENREAPER_ARTIFACT_ROOT \
  OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT \
  OPENREAPER_LIVE_SMOKE_RENDER_ROOT \
  OPENREAPER_LIVE_BRIDGE_OWNER \
  OPENREAPER_LIVE_BRIDGE_GENERATION \
  OPENREAPER_LIVE_BRIDGE_SESSION_ID \
  OPENREAPER_PROJECT_INDEX_STATE_ROOT \
  OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY \
  OPENREAPER_CURRENT_PROJECT_PATH \
  OPENREAPER_CURRENT_PROJECT_REF \
  OPENREAPER_MCP_PACKAGE_ROOT; do
  unset "${stale_openreaper_env}" 2>/dev/null || true
done
require_option_value() {
  local option_name="$1"
  local remaining_count="$2"
  local option_value="${3-}"
  if (( remaining_count < 2 )) || [[ -z "${option_value}" || "${option_value}" == --* ]]; then
    echo "[OpenReaper] ${option_name} requires a non-empty value" >&2
    exit 2
  fi
}

set_startup_dialog_consent_internal() {
  local value="$1"
  if [[ "${STARTUP_DIALOG_CONSENT_EXPLICIT}" == "true" && "${STARTUP_DIALOG_CONSENT}" != "${value}" ]]; then
    echo "[OpenReaper] conflicting startup dialog consent options" >&2
    exit 2
  fi
  STARTUP_DIALOG_CONSENT="${value}"
  STARTUP_DIALOG_CONSENT_EXPLICIT=true
}

set_startup_dialog_consent() {
  local value="$1"
  case "${value}" in
    once|always|manual) ;;
    *)
      echo "[OpenReaper] --startup-dialog-consent must be once, always, or manual" >&2
      exit 2
      ;;
  esac
  set_startup_dialog_consent_internal "${value}"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-path|--project|--rpp-path)
      require_option_value "$1" "$#" "${2-}"
      PROJECT_PATH="$2"
      shift 2
      ;;
    --reaper-binary)
      require_option_value "$1" "$#" "${2-}"
      REAPER_BIN="$2"
      shift 2
      ;;
    --direct-binary|--no-launchservices)
      DIRECT_BINARY=true
      shift
      ;;
    --reaper-app)
      require_option_value "$1" "$#" "${2-}"
      REAPER_APP="$2"
      REAPER_BIN="${REAPER_APP}/Contents/MacOS/REAPER"
      shift 2
      ;;
    --session-root=*)
      SESSION_ROOT="${1#*=}"
      if [[ -z "${SESSION_ROOT}" ]]; then
        echo "[OpenReaper] --session-root requires a non-empty value" >&2
        exit 2
      fi
      SESSION_ROOT_EXPLICIT=true
      shift
      ;;
    --session-root)
      require_option_value "$1" "$#" "${2-}"
      SESSION_ROOT="$2"
      SESSION_ROOT_EXPLICIT=true
      shift 2
      ;;
    --render-root=*)
      RENDER_ROOT="${1#*=}"
      if [[ -z "${RENDER_ROOT}" ]]; then
        echo "[OpenReaper] --render-root requires a non-empty value" >&2
        exit 2
      fi
      RENDER_ROOT_EXPLICIT=true
      shift
      ;;
    --render-root)
      require_option_value "$1" "$#" "${2-}"
      RENDER_ROOT="$2"
      RENDER_ROOT_EXPLICIT=true
      shift 2
      ;;
    --transport-dir)
      require_option_value "$1" "$#" "${2-}"
      TRANSPORT_DIR="$2"
      shift 2
      ;;
    --artifact-root)
      require_option_value "$1" "$#" "${2-}"
      ARTIFACT_ROOT="$2"
      shift 2
      ;;
    --bridge-owner|--owner)
      require_option_value "$1" "$#" "${2-}"
      BRIDGE_OWNER="$2"
      shift 2
      ;;
    --bridge-generation|--generation)
      require_option_value "$1" "$#" "${2-}"
      BRIDGE_GENERATION="$2"
      shift 2
      ;;
    --startup-dialog-consent=*)
      set_startup_dialog_consent "${1#*=}"
      shift
      ;;
    --startup-dialog-consent)
      require_option_value "$1" "$#" "${2-}"
      set_startup_dialog_consent "$2"
      shift 2
      ;;
    --no-startup-dialog-assist|--no-dialog-assist)
      set_startup_dialog_consent_internal manual_once
      shift
      ;;
    --ignore-missing-media)
      set_startup_dialog_consent once
      shift
      ;;
    --recover-existing|--reuse-existing-session)
      RECOVER_EXISTING=true
      shift
      ;;
    --help|-h)
      cat <<'HELP'
OpenReaper start helper

Usage:
  openreaper-start [--project-path /path/to/project.RPP]
  openreaper-start --reaper-binary /path/to/REAPER [--project-path /path/to/project.RPP]
  openreaper-start --direct-binary --reaper-binary /path/to/REAPER [--project-path /path/to/project.RPP]
  openreaper-start --reaper-app /path/to/REAPER.app [--project-path /path/to/project.RPP]
  openreaper-start --session-root /path/to/session [--project-path /path/to/project.RPP]
  openreaper-start --render-root /absolute/path/to/renders [--project-path /path/to/project.RPP]
  openreaper-start --recover-existing [--session-root /path/to/session]

REAPER must be started through this helper for OpenReaper MCP to connect.
The helper starts REAPER with the OpenReaper bridge environment and returns only
after a matching Bridge heartbeat and real bounded public read probe succeed.
On macOS it uses LaunchServices by default so REAPER is not a child of the
agent command session. Use --direct-binary for a headless/direct binary launch;
the same startup hook, heartbeat, and public read probe gates still apply.
The helper defaults to its installed session directory and ignores stale
OPENREAPER_SESSION_ROOT / OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR /
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT / OPENREAPER_LIVE_SMOKE_RENDER_ROOT /
OPENREAPER_LIVE_BRIDGE_OWNER / OPENREAPER_LIVE_BRIDGE_GENERATION values from
the parent shell. Use explicit --session-root/--render-root/--transport-dir/
--artifact-root/--bridge-owner/--bridge-generation only for a bounded evidence
window. With --session-root and no --render-root, the render root is the
explicit session's renders child.

If REAPER is installed somewhere other than /Applications, the agent can pass
--reaper-app or --reaper-binary. On macOS the helper also tries Spotlight app
discovery before asking for a path.

The installed conditional startup hook starts the Bridge automatically. The
REAPER action named "OpenReaper: Start MCP bridge" remains a manual recovery
fallback if autonomous startup is blocked.

If the selected session already has a verified live REAPER, a normal start
refuses to launch a duplicate instance. Use --recover-existing to reuse that
same REAPER PID and verify an already-running Bridge; it cannot restart a
stopped Bridge. This mode cannot select a new project or pass arbitrary REAPER
arguments.

Before the first assisted launch, choose one startup-dialog policy:
  --startup-dialog-consent once    Assist this launch only; do not save consent.
  --startup-dialog-consent always  Assist now and save consent for later launches.
  --startup-dialog-consent manual  Save that the user will handle startup windows.
With no saved policy or explicit choice, the helper asks the agent to obtain the
user's choice and exits before starting REAPER. Saved choices live outside the
replaceable install tree and survive upgrades.
Manual means OpenReaper never clicks startup windows. It still inspects them
read-only and cannot report ready until the user clears every blocking window.

Consent applies only to the exact Project Settings / Notes, missing-media Ignore,
and exact media-items-offline warning rules. License/evaluation, recovery,
plugin, version, decision-bearing, ambiguous, and unknown dialogs always fail
closed. --ignore-missing-media remains a one-launch compatibility alias for
"once"; --no-startup-dialog-assist remains a one-launch manual/debug override.
HELP
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ ! "${STARTUP_DIALOG_TIMEOUT_SECONDS}" =~ '^[1-9][0-9]*$' ]] || (( STARTUP_DIALOG_TIMEOUT_SECONDS > 120 )); then
  echo "[OpenReaper] OPENREAPER_STARTUP_DIALOG_TIMEOUT_SECONDS must be an integer from 1 to 120" >&2
  exit 2
fi

if [[ "${RECOVER_EXISTING}" == "true" && ( -n "${PROJECT_PATH}" || ${#ARGS[@]} -gt 0 ) ]]; then
  echo "[OpenReaper] --recover-existing cannot be combined with a project path or REAPER arguments." >&2
  exit 2
fi

persist_startup_dialog_consent() {
  local value="$1"
  node --input-type=module - "${STARTUP_DIALOG_POLICY_FILE}" "${value}" <<'NODE'
import { constants } from "node:fs";
import { lstat, mkdir, open, realpath, rename, unlink } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

const [policyPathInput, value] = process.argv.slice(2);
const policyPath = path.resolve(policyPathInput);
const policyDir = path.dirname(policyPath);
const policyRoot = path.dirname(policyDir);

function fail(message) {
  process.stderr.write(`[OpenReaper] ${message}\n`);
  process.exitCode = 1;
}

async function assertPlainDirectory(candidate, label) {
  const entry = await lstat(candidate);
  if (entry.isSymbolicLink() || !entry.isDirectory()) throw new Error(`${label} must be a real directory: ${candidate}`);
  return entry;
}

let tempPath = "";
try {
  await assertPlainDirectory(policyRoot, "startup dialog consent root");
  await mkdir(policyDir, { mode: 0o700 }).catch((error) => {
    if (error?.code !== "EEXIST") throw error;
  });
  const beforeDir = await assertPlainDirectory(policyDir, "startup dialog consent directory");
  const [canonicalRoot, canonicalDir] = await Promise.all([realpath(policyRoot), realpath(policyDir)]);
  if (canonicalDir !== path.join(canonicalRoot, path.basename(policyDir))) {
    throw new Error(`startup dialog consent directory must not traverse a symlink: ${policyDir}`);
  }
  const existing = await lstat(policyPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (existing && (existing.isSymbolicLink() || !existing.isFile())) {
    throw new Error(`startup dialog consent path must be a regular non-symlink file: ${policyPath}`);
  }

  tempPath = `${policyPath}.tmp.${randomBytes(16).toString("hex")}`;
  const handle = await open(
    tempPath,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    await handle.writeFile(`${value}\n`, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }

  const afterDir = await assertPlainDirectory(policyDir, "startup dialog consent directory");
  if (beforeDir.dev !== afterDir.dev || beforeDir.ino !== afterDir.ino || await realpath(policyDir) !== canonicalDir) {
    throw new Error(`startup dialog consent directory changed during write: ${policyDir}`);
  }
  const destination = await lstat(policyPath).catch((error) => error?.code === "ENOENT" ? null : Promise.reject(error));
  if (destination && (destination.isSymbolicLink() || !destination.isFile())) {
    throw new Error(`startup dialog consent destination changed to an unsafe path: ${policyPath}`);
  }
  await rename(tempPath, policyPath);
  tempPath = "";
} catch (error) {
  if (tempPath) await unlink(tempPath).catch(() => {});
  fail(error?.message ?? String(error));
}
NODE
}

read_startup_dialog_consent() {
  node --input-type=module - "${STARTUP_DIALOG_POLICY_FILE}" <<'NODE'
import { constants } from "node:fs";
import { lstat, open, realpath } from "node:fs/promises";
import path from "node:path";

const policyPath = path.resolve(process.argv[2]);
const policyDir = path.dirname(policyPath);
const policyRoot = path.dirname(policyDir);
try {
  const rootEntry = await lstat(policyRoot);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) throw new Error(`startup dialog consent root must be a real directory: ${policyRoot}`);
  const dirEntry = await lstat(policyDir);
  if (dirEntry.isSymbolicLink() || !dirEntry.isDirectory()) throw new Error(`startup dialog consent directory must be a real directory: ${policyDir}`);
  const [canonicalRoot, canonicalDir] = await Promise.all([realpath(policyRoot), realpath(policyDir)]);
  if (canonicalDir !== path.join(canonicalRoot, path.basename(policyDir))) throw new Error(`startup dialog consent directory must not traverse a symlink: ${policyDir}`);
  const pathEntry = await lstat(policyPath);
  if (pathEntry.isSymbolicLink() || !pathEntry.isFile()) throw new Error(`startup dialog consent path must be a regular non-symlink file: ${policyPath}`);
  const handle = await open(policyPath, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const handleEntry = await handle.stat();
    if (!handleEntry.isFile() || handleEntry.dev !== pathEntry.dev || handleEntry.ino !== pathEntry.ino) throw new Error(`startup dialog consent file changed during read: ${policyPath}`);
    process.stdout.write(await handle.readFile("utf8"));
  } finally {
    await handle.close();
  }
} catch (error) {
  if (error?.code === "ENOENT") process.exit(3);
  process.stderr.write(`[OpenReaper] ${error?.message ?? String(error)}\n`);
  process.exit(1);
}
NODE
}

resolve_startup_dialog_consent() {
  local stored=""
  if [[ "${STARTUP_DIALOG_CONSENT_EXPLICIT}" != "true" ]]; then
    if stored="$(read_startup_dialog_consent)"; then
      case "${stored}" in
        always|manual) STARTUP_DIALOG_CONSENT="${stored}" ;;
        *)
          echo "[OpenReaper] invalid saved startup dialog consent; choose once, always, or manual again" >&2
          return 1
          ;;
      esac
    else
      local read_status=$?
      if (( read_status != 3 )); then
        return 1
      fi
      echo "[OpenReaper] startup-status=needs_user_consent" >&2
      echo "[OpenReaper] startup-dialog-consent=required" >&2
      echo "[OpenReaper] Ask the user: allow safe startup-window assistance once, always, or handle windows themselves?" >&2
      echo "[OpenReaper] once: openreaper-start --startup-dialog-consent once" >&2
      echo "[OpenReaper] always: openreaper-start --startup-dialog-consent always" >&2
      echo "[OpenReaper] manual: openreaper-start --startup-dialog-consent manual" >&2
      return 3
    fi
  fi

  case "${STARTUP_DIALOG_CONSENT}" in
    once)
      STARTUP_DIALOG_ASSIST=true
      IGNORE_MISSING_MEDIA=true
      ;;
    always)
      STARTUP_DIALOG_ASSIST=true
      IGNORE_MISSING_MEDIA=true
      if [[ "${STARTUP_DIALOG_CONSENT_EXPLICIT}" == "true" ]]; then
        persist_startup_dialog_consent always || return 1
      fi
      ;;
    manual)
      STARTUP_DIALOG_ASSIST=false
      IGNORE_MISSING_MEDIA=false
      if [[ "${STARTUP_DIALOG_CONSENT_EXPLICIT}" == "true" ]]; then
        persist_startup_dialog_consent manual || return 1
      fi
      ;;
    manual_once)
      STARTUP_DIALOG_ASSIST=false
      IGNORE_MISSING_MEDIA=false
      ;;
    *)
      echo "[OpenReaper] unresolved startup dialog consent" >&2
      return 1
      ;;
  esac
}

if resolve_startup_dialog_consent; then
  :
else
  consent_status=$?
  if (( consent_status == 3 )); then
    exit 3
  fi
  exit 1
fi

if [[ -z "${TRANSPORT_DIR}" ]]; then
  TRANSPORT_DIR="${SESSION_ROOT}/transport"
fi

if [[ -z "${ARTIFACT_ROOT}" ]]; then
  ARTIFACT_ROOT="${SESSION_ROOT}/artifacts"
fi

PROJECT_INDEX_STATE_ROOT="${SESSION_ROOT}/project-index"

select_and_prepare_render_root() {
  local selection_mode="installed"
  local selection_value=""
  if [[ "${RENDER_ROOT_EXPLICIT}" == "true" ]]; then
    selection_mode="explicit"
    selection_value="${RENDER_ROOT}"
  elif [[ "${SESSION_ROOT_EXPLICIT}" == "true" ]]; then
    selection_mode="session"
    selection_value="${SESSION_ROOT}/renders"
  fi

  node --input-type=module - \
    "${INSTALL_ROOT}" \
    "${HOME}" \
    "${MANAGED_RENDER_ROOT_RECORD}" \
    "${selection_mode}" \
    "${selection_value}" \
    "${SESSION_ROOT}" \
    "${TRANSPORT_DIR}" \
    "${ARTIFACT_ROOT}" <<'NODE'
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

const RECORD_MAX = 4096;
const PATH_MAX = 3072;
const PROBE_ATTEMPTS = 4;
const [
  installRoot,
  home,
  recordPath,
  selectionMode,
  selectionValue,
  effectiveSessionRoot,
  effectiveTransportRoot,
  effectiveArtifactRoot,
] = process.argv.slice(2);
const installedSessionRoot = path.join(installRoot, "session");
const defaultRoot = path.join(installedSessionRoot, "renders");
const effectiveSessionRenderRoot = path.join(effectiveSessionRoot, "renders");
let candidate = null;
let createdFinalDirectory = false;

try {
  if (selectionMode === "explicit" || selectionMode === "session") {
    candidate = selectionValue;
  } else {
    const record = await readRecord(recordPath);
    candidate = record.status === "missing" ? defaultRoot : record.path;
  }
  validatePathText(candidate);
  candidate = path.normalize(candidate);
  const before = await safeLstat(candidate);
  if (before?.isSymbolicLink()) throw new Error("final component is a symlink");
  if (before && !before.isDirectory()) throw new Error("path is not a directory");
  await assertNoReservedOverlap(candidate);
  if (!before) {
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    createdFinalDirectory = true;
  }
  const after = await safeLstat(candidate);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) {
    throw new Error("prepared path is not a real directory");
  }
  await assertNoReservedOverlap(candidate);
  await writeProbe(candidate);
  process.stdout.write(candidate);
} catch (error) {
  if (createdFinalDirectory && candidate) await rmdir(candidate).catch(() => {});
  process.stderr.write(`[OpenReaper] render-root validation failed: ${bounded(error?.message ?? "invalid path")}\n`);
  process.exitCode = 2;
}

async function readRecord(filePath) {
  const entry = await safeLstat(filePath);
  if (!entry) return { status: "missing" };
  if (entry.isSymbolicLink() || !entry.isFile()) throw new Error("persisted record is a symlink or non-regular file");
  if (entry.size > RECORD_MAX) throw new Error(`persisted record exceeds ${RECORD_MAX} bytes`);
  const handle = await open(filePath, fsConstants.O_RDONLY | (fsConstants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || opened.size > RECORD_MAX) throw new Error("persisted record changed or is oversized");
    const buffer = Buffer.alloc(RECORD_MAX + 1);
    const bytesRead = await readBoundedBytes(handle, buffer);
    if (bytesRead > RECORD_MAX) throw new Error(`persisted record exceeds ${RECORD_MAX} bytes`);
    let text;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, bytesRead));
    } catch {
      throw new Error("persisted record is not valid UTF-8");
    }
    const value = text.endsWith("\n") ? text.slice(0, -1) : text;
    if (value === "" || value.includes("\n")) throw new Error("persisted record must contain exactly one non-empty path line");
    validatePathText(value);
    return { status: "valid", path: value };
  } finally {
    await handle.close();
  }
}

async function readBoundedBytes(handle, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset);
    if (bytesRead === 0) break;
    offset += bytesRead;
  }
  return offset;
}

function validatePathText(value) {
  if (typeof value !== "string" || value === "") throw new Error("path is empty");
  if (Buffer.byteLength(value, "utf8") > PATH_MAX) throw new Error(`path exceeds ${PATH_MAX} UTF-8 bytes`);
  if (/^file:/i.test(value)) throw new Error("file URI is not allowed");
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("C0/DEL control characters are not allowed");
  if (!path.isAbsolute(value)) throw new Error("path must be absolute");
  const normalized = path.normalize(value);
  if (normalized === path.parse(normalized).root) throw new Error("filesystem root is not allowed");
}

async function assertNoReservedOverlap(value) {
  const canonical = await canonicalPath(value);
  if (canonical === await canonicalPath(home)) throw new Error("user home is not allowed");

  for (const [label, effectiveRoot] of [
    ["effective transport", effectiveTransportRoot],
    ["effective artifact", effectiveArtifactRoot],
  ]) {
    if (overlaps(canonical, await canonicalPath(effectiveRoot))) {
      throw new Error(`path overlaps ${label} root`);
    }
  }

  const canonicalInstalledDefaultRoot = await canonicalPath(defaultRoot);
  if (canonical === canonicalInstalledDefaultRoot) return;

  const canonicalInstallRoot = await canonicalPath(installRoot);
  if (overlaps(canonical, canonicalInstallRoot)) {
    throw new Error("path overlaps reserved install root");
  }

  const canonicalEffectiveSessionRenderRoot = await canonicalPath(effectiveSessionRenderRoot);
  if (canonical === canonicalEffectiveSessionRenderRoot) return;

  const canonicalEffectiveSessionRoot = await canonicalPath(effectiveSessionRoot);
  if (overlaps(canonical, canonicalEffectiveSessionRoot)) {
    throw new Error("path overlaps reserved effective session root");
  }
}
async function writeProbe(directory) {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const probe = path.join(directory, `.openreaper-write-probe-${process.pid}-${randomBytes(8).toString("hex")}`);
    let handle = null;
    try {
      handle = await open(probe, "wx", 0o600);
      await handle.writeFile("openreaper-managed-render-root-probe\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await unlink(probe);
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(probe).catch(() => {});
      if (error?.code === "EEXIST") continue;
      throw new Error(`write probe failed: ${error?.code ?? "ERROR"}`);
    }
  }
  throw new Error("write probe exhausted exclusive attempts");
}

async function canonicalPath(value) {
  let cursor = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...suffix.reverse());
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

async function safeLstat(value) {
  try {
    return await lstat(value);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function bounded(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320);
}
NODE
}

if ! RENDER_ROOT="$(select_and_prepare_render_root)"; then
  exit 2
fi

prepare_project_index_state_root() {
  node --input-type=module - \
    "${INSTALL_ROOT}" \
    "${SESSION_ROOT}" \
    "${TRANSPORT_DIR}" \
    "${ARTIFACT_ROOT}" \
    "${RENDER_ROOT}" \
    "${PROJECT_INDEX_STATE_ROOT}" <<'NODE'
import { randomBytes } from "node:crypto";
import { lstat, mkdir, open, realpath, rmdir, unlink } from "node:fs/promises";
import path from "node:path";

const PATH_MAX = 3072;
const PROBE_ATTEMPTS = 4;
const [installRoot, sessionRoot, transportRoot, artifactRoot, renderRoot, requestedRoot] = process.argv.slice(2);
const installedDefaultRoot = path.join(installRoot, "session", "project-index");
let candidate = null;
let createdFinalDirectory = false;

try {
  validatePathText(requestedRoot);
  candidate = path.normalize(requestedRoot);
  if (candidate !== path.normalize(path.join(sessionRoot, "project-index"))) {
    throw new Error("path is not the session-derived project-index root");
  }
  const before = await safeLstat(candidate);
  if (before?.isSymbolicLink()) throw new Error("final component is a symlink");
  if (before && !before.isDirectory()) throw new Error("path is not a directory");
  await assertNoReservedOverlap(candidate);
  if (!before) {
    await mkdir(candidate, { recursive: true, mode: 0o700 });
    createdFinalDirectory = true;
  }
  const after = await safeLstat(candidate);
  if (!after || after.isSymbolicLink() || !after.isDirectory()) {
    throw new Error("prepared path is not a real directory");
  }
  const canonical = await realpath(candidate);
  await assertNoReservedOverlap(canonical);
  await writeProbe(canonical);
  process.stdout.write(canonical);
} catch (error) {
  if (createdFinalDirectory && candidate) await rmdir(candidate).catch(() => {});
  process.stderr.write(`[OpenReaper] project-index state-root validation failed: ${bounded(error?.message ?? "invalid path")}\n`);
  process.exitCode = 2;
}

function validatePathText(value) {
  if (typeof value !== "string" || value === "") throw new Error("path is empty");
  if (Buffer.byteLength(value, "utf8") > PATH_MAX) throw new Error(`path exceeds ${PATH_MAX} UTF-8 bytes`);
  if (/^file:/i.test(value)) throw new Error("file URI is not allowed");
  if (/[\u0000-\u001f\u007f]/u.test(value)) throw new Error("C0/DEL control characters are not allowed");
  if (!path.isAbsolute(value)) throw new Error("path must be absolute");
  const normalized = path.normalize(value);
  if (normalized === path.parse(normalized).root) throw new Error("filesystem root is not allowed");
}

async function assertNoReservedOverlap(value) {
  const canonical = await canonicalPath(value);
  for (const [label, reserved] of [
    ["effective transport", transportRoot],
    ["effective artifact", artifactRoot],
    ["effective render", renderRoot],
  ]) {
    if (overlaps(canonical, await canonicalPath(reserved))) {
      throw new Error(`path overlaps ${label} root`);
    }
  }

  if (canonical === await canonicalPath(installedDefaultRoot)) return;
  if (overlaps(canonical, await canonicalPath(installRoot))) {
    throw new Error("path overlaps reserved install root");
  }
}

async function writeProbe(directory) {
  for (let attempt = 0; attempt < PROBE_ATTEMPTS; attempt += 1) {
    const probe = path.join(directory, `.openreaper-project-index-write-probe-${process.pid}-${randomBytes(8).toString("hex")}`);
    let handle = null;
    try {
      handle = await open(probe, "wx", 0o600);
      await handle.writeFile("openreaper-project-index-state-root-probe\n", "utf8");
      await handle.sync();
      await handle.close();
      handle = null;
      await unlink(probe);
      return;
    } catch (error) {
      if (handle) await handle.close().catch(() => {});
      await unlink(probe).catch(() => {});
      if (error?.code === "EEXIST") continue;
      throw new Error(`write probe failed: ${error?.code ?? "ERROR"}`);
    }
  }
  throw new Error("write probe exhausted exclusive attempts");
}

async function canonicalPath(value) {
  let cursor = path.resolve(value);
  const suffix = [];
  while (true) {
    try {
      return path.join(await realpath(cursor), ...suffix.reverse());
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) return path.join(cursor, ...suffix.reverse());
      suffix.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function overlaps(left, right) {
  return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`);
}

async function safeLstat(value) {
  try {
    return await lstat(value);
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function bounded(value) {
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, 320);
}
NODE
}

if ! PROJECT_INDEX_STATE_ROOT="$(prepare_project_index_state_root)"; then
  exit 2
fi
if [[ -z "${BRIDGE_OWNER}" ]]; then
  BRIDGE_OWNER="openreaper-alpha"
fi

if [[ -z "${BRIDGE_GENERATION}" ]]; then
  BRIDGE_GENERATION="1"
fi

LOG_DIR="${SESSION_ROOT}/logs"
START_LOG="${LOG_DIR}/openreaper-start-$(date -u +"%Y%m%dT%H%M%SZ").log"
PID_FILE="${SESSION_ROOT}/reaper.pid"

resolve_reaper_locations() {
  if [[ -n "${REAPER_APP}" ]]; then
    REAPER_BIN="${REAPER_APP}/Contents/MacOS/REAPER"
    return
  fi

  if [[ "${DIRECT_BINARY}" == "true" ]]; then
    return
  fi

  if [[ "${REAPER_BIN}" == *.app/Contents/MacOS/* ]]; then
    local inferred_app="${REAPER_BIN%%.app/Contents/MacOS/*}.app"
    if [[ -d "${inferred_app}" ]]; then
      REAPER_APP="${inferred_app}"
    fi
  fi

  if [[ ! -x "${REAPER_BIN}" && -d "/Applications/REAPER.app" ]]; then
    REAPER_APP="/Applications/REAPER.app"
    REAPER_BIN="${REAPER_APP}/Contents/MacOS/REAPER"
  fi

  if [[ "$(uname -s)" == "Darwin" && ! -x "${REAPER_BIN}" && -x "/usr/bin/mdfind" ]]; then
    local discovered_app
    discovered_app="$(/usr/bin/mdfind 'kMDItemCFBundleIdentifier == "com.cockos.reaper"' | head -1 || true)"
    if [[ -n "${discovered_app}" && -d "${discovered_app}" ]]; then
      REAPER_APP="${discovered_app}"
      REAPER_BIN="${REAPER_APP}/Contents/MacOS/REAPER"
    fi
  fi
}

resolve_reaper_locations

if [[ ! -x "${REAPER_BIN}" ]]; then
  echo "[OpenReaper] REAPER binary is not executable: ${REAPER_BIN}" >&2
  echo "[OpenReaper] The agent can pass --reaper-app /path/to/REAPER.app or --reaper-binary /path/to/REAPER." >&2
  exit 2
fi

mkdir -p "${TRANSPORT_DIR}/requests" "${TRANSPORT_DIR}/results" "${ARTIFACT_ROOT}"
mkdir -p "${SESSION_ROOT}" "${LOG_DIR}"

USE_LAUNCHSERVICES=false
if [[ "${DIRECT_BINARY}" != "true" && "$(uname -s)" == "Darwin" && -n "${REAPER_APP}" && -d "${REAPER_APP}" && -x "${OPEN_BIN}" && -x "${LAUNCHCTL_BIN}" ]]; then
  USE_LAUNCHSERVICES=true
fi

export OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH="${BRIDGE_SCRIPT}"
export OPENREAPER_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_RENDER_ROOT="${RENDER_ROOT}"
export OPENREAPER_LIVE_BRIDGE_OWNER="${BRIDGE_OWNER}"
export OPENREAPER_LIVE_BRIDGE_GENERATION="${BRIDGE_GENERATION}"
export OPENREAPER_PROJECT_INDEX_STATE_ROOT="${PROJECT_INDEX_STATE_ROOT}"

echo "[OpenReaper] Starting REAPER through OpenReaper."
echo "[OpenReaper] MCP can connect only to REAPER sessions started this way."
echo "[OpenReaper] transport=${TRANSPORT_DIR}"
echo "[OpenReaper] render-root=${RENDER_ROOT}"
echo "[OpenReaper] project-index-state-root=${PROJECT_INDEX_STATE_ROOT}"
echo "[OpenReaper] bridge=${BRIDGE_SCRIPT}"
echo "[OpenReaper] reaper-log=${START_LOG}"
if [[ "${USE_LAUNCHSERVICES}" == "true" ]]; then
  echo "[OpenReaper] launch-method=macos_launchservices"
  echo "[OpenReaper] reaper-app=${REAPER_APP}"
else
  echo "[OpenReaper] launch-method=direct_binary_fallback"
  if [[ "${DIRECT_BINARY}" == "true" ]]; then
    echo "[OpenReaper] launchservices=disabled_by_direct_binary"
  fi
fi
echo "[OpenReaper] bridge-action-fallback=OpenReaper: Start MCP bridge"
echo "[OpenReaper] bridge-status=starting_automatically"
echo "[OpenReaper] startup-dialog-consent=${STARTUP_DIALOG_CONSENT};policy=${STARTUP_DIALOG_POLICY_FILE}"
echo "[OpenReaper] startup-dialog-assist=exact_safe_allowlist;missing_media_consent=${IGNORE_MISSING_MEDIA}"
echo "[OpenReaper] startup-dialog-timeout-seconds=${STARTUP_DIALOG_TIMEOUT_SECONDS}"

launch_reaper() {
  local -a reaper_args
  reaper_args=("-newinst" "-nosplash")
  if [[ -n "${PROJECT_PATH}" ]]; then
    reaper_args+=("${PROJECT_PATH}")
  fi
  reaper_args+=("${ARGS[@]}")

  local reaper_pid
  if [[ "${USE_LAUNCHSERVICES}" == "true" ]]; then
    local before_pids="${SESSION_ROOT}/reaper-before.pids"
    reaper_pids > "${before_pids}"
    if ! set_launchservices_env; then
      echo "[OpenReaper] LaunchServices environment setup failed; restoration will be attempted." >&2
      exit 1
    fi
    if ! prepare_startup_status_for_new_launch; then
      echo "[OpenReaper] startup status preparation failed; restoration will be attempted." >&2
      exit 1
    fi
    if ! "${OPEN_BIN}" -na "${REAPER_APP}" --args "${reaper_args[@]}" >> "${START_LOG}" 2>&1; then
      echo "[OpenReaper] LaunchServices failed to start REAPER. See log: ${START_LOG}" >&2
      exit 1
    fi
    if ! reaper_pid="$(wait_for_new_reaper_pid "${before_pids}")"; then
      echo "[OpenReaper] LaunchServices did not expose a new REAPER pid in time. See log: ${START_LOG}" >&2
      exit 1
    fi
    echo "${reaper_pid}" > "${PID_FILE}"
    if ! wait_for_startup_hook "${reaper_pid}"; then
      echo "[OpenReaper] REAPER startup hook did not publish a valid startup stage before LaunchServices restoration." >&2
      exit 1
    fi
    if ! restore_launchservices_env; then
      echo "[OpenReaper] LaunchServices environment restoration failed; startup is not successful." >&2
      exit 1
    fi
  else
    if ! prepare_startup_status_for_new_launch; then
      echo "[OpenReaper] startup status preparation failed for direct launch." >&2
      exit 1
    fi
    nohup "${REAPER_BIN}" "${reaper_args[@]}" >> "${START_LOG}" 2>&1 &
    reaper_pid="$!"
    disown "${reaper_pid}" 2>/dev/null || true
    echo "${reaper_pid}" > "${PID_FILE}"
    if ! wait_for_startup_hook "${reaper_pid}"; then
      echo "[OpenReaper] direct REAPER startup hook did not publish a valid startup stage." >&2
      exit 1
    fi
  fi
  echo "${reaper_pid}" > "${PID_FILE}"
  echo "[OpenReaper] reaper-pid=${reaper_pid}"
  echo "[OpenReaper] reaper-pid-file=${PID_FILE}"
}

reaper_pids() {
  pgrep -f "${REAPER_BIN}" 2>/dev/null | sort -n || true
}

launchservices_env_value() {
  case "$1" in
    OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR) print -rn -- "${TRANSPORT_DIR}" ;;
    OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH) print -rn -- "${BRIDGE_SCRIPT}" ;;
    OPENREAPER_ARTIFACT_ROOT) print -rn -- "${ARTIFACT_ROOT}" ;;
    OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT) print -rn -- "${ARTIFACT_ROOT}" ;;
    OPENREAPER_LIVE_SMOKE_RENDER_ROOT) print -rn -- "${RENDER_ROOT}" ;;
    OPENREAPER_LIVE_BRIDGE_OWNER) print -rn -- "${BRIDGE_OWNER}" ;;
    OPENREAPER_LIVE_BRIDGE_GENERATION) print -rn -- "${BRIDGE_GENERATION}" ;;
    OPENREAPER_PROJECT_INDEX_STATE_ROOT) print -rn -- "${PROJECT_INDEX_STATE_ROOT}" ;;
    *) return 1 ;;
  esac
}

launchservices_lock_owner_matches() {
  if [[ "${LAUNCHSERVICES_LOCK_OWNED}" != "true" || "${LAUNCHSERVICES_LOCK_TOKEN_WRITTEN}" != "true" || -z "${LAUNCHSERVICES_LOCK_TOKEN}" ]]; then
    return 1
  fi
  if [[ ! -d "${LAUNCHSERVICES_LOCK_PATH}" || -L "${LAUNCHSERVICES_LOCK_PATH}" ]]; then
    return 1
  fi
  local token_path="${LAUNCHSERVICES_LOCK_PATH}/.owner-token"
  if [[ ! -f "${token_path}" || -L "${token_path}" ]]; then
    return 1
  fi
  local token_size
  if ! token_size="$(wc -c < "${token_path}" 2>/dev/null)"; then
    return 1
  fi
  token_size="${token_size//[[:space:]]/}"
  if [[ "${token_size}" != <-> ]] || (( token_size < 1 || token_size > 256 )); then
    return 1
  fi
  local stored_token
  stored_token="$(<"${token_path}")"
  [[ "${stored_token}" == "${LAUNCHSERVICES_LOCK_TOKEN}" ]]
}

launchservices_snapshot_has_only_known_entries() {
  local snapshot_dir="$1"
  local entry
  local basename_value
  local key
  local allowed
  local -a entries
  entries=("${snapshot_dir}"/*(DN))
  for entry in "${entries[@]}"; do
    basename_value="${entry:t}"
    allowed=false
    for key in "${LAUNCHSERVICES_ENV_KEYS[@]}"; do
      if [[ "${basename_value}" == "${key}.presence" || "${basename_value}" == "${key}.value" ]]; then
        allowed=true
        break
      fi
    done
    if [[ "${allowed}" != "true" ]]; then
      return 1
    fi
  done
}

cleanup_known_launchservices_snapshot() {
  local snapshot_dir="$1"
  local key
  local entry
  if [[ -z "${snapshot_dir}" ]]; then
    return 0
  fi
  if [[ ! -e "${snapshot_dir}" && ! -L "${snapshot_dir}" ]]; then
    return 0
  fi
  if [[ ! -d "${snapshot_dir}" || -L "${snapshot_dir}" ]]; then
    return 1
  fi
  if ! launchservices_snapshot_has_only_known_entries "${snapshot_dir}"; then
    return 1
  fi
  for key in "${LAUNCHSERVICES_ENV_KEYS[@]}"; do
    for entry in "${snapshot_dir}/${key}.presence" "${snapshot_dir}/${key}.value"; do
      if [[ -e "${entry}" || -L "${entry}" ]]; then
        if [[ ! -f "${entry}" || -L "${entry}" ]]; then
          return 1
        fi
        if ! rm -f -- "${entry}"; then
          return 1
        fi
      fi
    done
  done
  rmdir "${snapshot_dir}" 2>/dev/null
}

launchservices_lock_has_only_known_entries() {
  local entry
  local basename_value
  local -a entries
  entries=("${LAUNCHSERVICES_LOCK_PATH}"/*(DN))
  for entry in "${entries[@]}"; do
    basename_value="${entry:t}"
    case "${basename_value}" in
      .owner-token|owner.meta|snapshot) ;;
      *) return 1 ;;
    esac
  done
}

reset_launchservices_lock_state() {
  LAUNCHSERVICES_LOCK_OWNED=false
  LAUNCHSERVICES_LOCK_TOKEN=""
  LAUNCHSERVICES_SNAPSHOT_DIR=""
  LAUNCHSERVICES_LOCK_TOKEN_WRITTEN=false
  LAUNCHSERVICES_LOCK_METADATA_WRITTEN=false
  LAUNCHSERVICES_SNAPSHOT_CREATED=false
}

release_owned_launchservices_lock() {
  if ! launchservices_lock_owner_matches; then
    echo "[OpenReaper] refusing to release LaunchServices lock not owned by this process: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  if ! cleanup_known_launchservices_snapshot "${LAUNCHSERVICES_SNAPSHOT_DIR}"; then
    echo "[OpenReaper] LaunchServices snapshot contains unexpected entries; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  LAUNCHSERVICES_SNAPSHOT_CREATED=false
  if ! launchservices_lock_owner_matches; then
    echo "[OpenReaper] LaunchServices lock ownership changed during cleanup; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  if ! launchservices_lock_has_only_known_entries; then
    echo "[OpenReaper] LaunchServices lock contains unexpected entries and was retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  local metadata_path="${LAUNCHSERVICES_LOCK_PATH}/owner.meta"
  if [[ -e "${metadata_path}" || -L "${metadata_path}" ]]; then
    if [[ ! -f "${metadata_path}" || -L "${metadata_path}" ]]; then
      echo "[OpenReaper] LaunchServices owner metadata is unsafe; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
      return 1
    fi
    if ! rm -f -- "${metadata_path}"; then
      echo "[OpenReaper] LaunchServices owner metadata could not be removed; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
      return 1
    fi
  fi
  LAUNCHSERVICES_LOCK_METADATA_WRITTEN=false
  if ! launchservices_lock_owner_matches; then
    echo "[OpenReaper] LaunchServices lock ownership changed before release; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  local token_path="${LAUNCHSERVICES_LOCK_PATH}/.owner-token"
  if ! rm -f -- "${token_path}"; then
    echo "[OpenReaper] LaunchServices owner token could not be removed; lock retained: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  LAUNCHSERVICES_LOCK_TOKEN_WRITTEN=false
  if ! rmdir "${LAUNCHSERVICES_LOCK_PATH}" 2>/dev/null; then
    local marker_restored=false
    if [[ -d "${LAUNCHSERVICES_LOCK_PATH}" && ! -L "${LAUNCHSERVICES_LOCK_PATH}" ]]; then
      setopt localoptions noclobber
      if print -rn -- "${LAUNCHSERVICES_LOCK_TOKEN}" > "${token_path}" 2>/dev/null; then
        if chmod 600 "${token_path}" 2>/dev/null; then
          LAUNCHSERVICES_LOCK_TOKEN_WRITTEN=true
          marker_restored=true
        fi
      fi
    fi
    if [[ "${marker_restored}" == "true" ]]; then
      echo "[OpenReaper] LaunchServices lock could not be removed; its owner token was restored for recovery: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    else
      echo "[OpenReaper] LaunchServices lock could not be removed and its owner token could not be restored: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    fi
    return 1
  fi
  reset_launchservices_lock_state
  return 0
}

cleanup_launchservices_lock_setup_failure() {
  if [[ "${LAUNCHSERVICES_LOCK_OWNED}" != "true" ]]; then
    return 0
  fi
  if [[ "${LAUNCHSERVICES_LOCK_TOKEN_WRITTEN}" == "true" ]]; then
    release_owned_launchservices_lock
    return $?
  fi
  if [[ ! -d "${LAUNCHSERVICES_LOCK_PATH}" || -L "${LAUNCHSERVICES_LOCK_PATH}" ]]; then
    return 1
  fi
  local -a entries
  entries=("${LAUNCHSERVICES_LOCK_PATH}"/*(DN))
  if (( ${#entries[@]} != 0 )); then
    echo "[OpenReaper] refusing to clean a pre-mutation LaunchServices lock with unverified entries: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    return 1
  fi
  if ! rmdir "${LAUNCHSERVICES_LOCK_PATH}" 2>/dev/null; then
    return 1
  fi
  reset_launchservices_lock_state
  return 0
}

fail_launchservices_lock_setup() {
  local reason="$1"
  echo "[OpenReaper] ${reason}" >&2
  if ! cleanup_launchservices_lock_setup_failure; then
    LAUNCHSERVICES_RECOVERY_RETAINED=true
    echo "[OpenReaper] LaunchServices lock setup recovery is retained at ${LAUNCHSERVICES_LOCK_PATH}" >&2
  fi
  return 1
}

acquire_launchservices_lock() {
  local lock_parent="${INSTALL_ROOT}/session"
  if ! mkdir -p "${lock_parent}"; then
    echo "[OpenReaper] Could not prepare the stable LaunchServices lock parent: ${lock_parent}" >&2
    return 1
  fi
  if ! mkdir -m 700 "${LAUNCHSERVICES_LOCK_PATH}" 2>/dev/null; then
    if [[ -e "${LAUNCHSERVICES_LOCK_PATH}" || -L "${LAUNCHSERVICES_LOCK_PATH}" ]]; then
      echo "[OpenReaper] LaunchServices environment lock is already held: ${LAUNCHSERVICES_LOCK_PATH}" >&2
      echo "[OpenReaper] Resolve or recover the existing lock before retrying; it will not be auto-broken." >&2
    else
      echo "[OpenReaper] Could not acquire the stable LaunchServices environment lock: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    fi
    return 1
  fi
  LAUNCHSERVICES_LOCK_OWNED=true
  LAUNCHSERVICES_SNAPSHOT_DIR="${LAUNCHSERVICES_LOCK_PATH}/snapshot"
  LAUNCHSERVICES_LOCK_TOKEN="$$-$(date -u +%Y%m%dT%H%M%SZ)-${RANDOM}${RANDOM}"
  if (( ${#LAUNCHSERVICES_LOCK_TOKEN} > 192 )); then
    fail_launchservices_lock_setup "LaunchServices owner token exceeded its bounded size before environment mutation."
    return 1
  fi
  if ! print -rn -- "${LAUNCHSERVICES_LOCK_TOKEN}" > "${LAUNCHSERVICES_LOCK_PATH}/.owner-token"; then
    fail_launchservices_lock_setup "LaunchServices owner-token setup failed before environment mutation."
    return 1
  fi
  LAUNCHSERVICES_LOCK_TOKEN_WRITTEN=true
  if ! chmod 600 "${LAUNCHSERVICES_LOCK_PATH}/.owner-token"; then
    fail_launchservices_lock_setup "LaunchServices owner-token permission setup failed before environment mutation."
    return 1
  fi
  if ! {
    print -r -- "pid=$$"
    print -r -- "started_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    print -r -- "token=${LAUNCHSERVICES_LOCK_TOKEN}"
  } > "${LAUNCHSERVICES_LOCK_PATH}/owner.meta"; then
    fail_launchservices_lock_setup "LaunchServices bounded owner metadata setup failed before environment mutation."
    return 1
  fi
  LAUNCHSERVICES_LOCK_METADATA_WRITTEN=true
  local metadata_size
  if ! metadata_size="$(wc -c < "${LAUNCHSERVICES_LOCK_PATH}/owner.meta" 2>/dev/null)"; then
    fail_launchservices_lock_setup "LaunchServices owner metadata could not be measured before environment mutation."
    return 1
  fi
  metadata_size="${metadata_size//[[:space:]]/}"
  if [[ "${metadata_size}" != <-> ]] || (( metadata_size < 1 || metadata_size > 1024 )); then
    fail_launchservices_lock_setup "LaunchServices owner metadata was invalid or exceeded 1024 bytes before environment mutation."
    return 1
  fi
  if ! chmod 600 "${LAUNCHSERVICES_LOCK_PATH}/owner.meta"; then
    fail_launchservices_lock_setup "LaunchServices owner metadata permission setup failed before environment mutation."
    return 1
  fi
  if ! mkdir -m 700 "${LAUNCHSERVICES_SNAPSHOT_DIR}"; then
    fail_launchservices_lock_setup "LaunchServices snapshot directory setup failed before environment mutation."
    return 1
  fi
  LAUNCHSERVICES_SNAPSHOT_CREATED=true
  return 0
}

snapshot_launchservices_env() {
  local key
  local previous
  for key in "${LAUNCHSERVICES_ENV_KEYS[@]}"; do
    if previous="$("${LAUNCHCTL_BIN}" getenv "${key}" 2>/dev/null)"; then
      print -rn -- "set" > "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.presence" || return 1
      print -rn -- "${previous}" > "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.value" || return 1
    else
      print -rn -- "unset" > "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.presence" || return 1
      : > "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.value" || return 1
    fi
    chmod 600 "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.presence" "${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.value" || return 1
  done
}

set_launchservices_env() {
  if ! acquire_launchservices_lock; then
    return 1
  fi
  if ! snapshot_launchservices_env; then
    echo "[OpenReaper] LaunchServices snapshot setup failed before environment mutation." >&2
    if ! cleanup_launchservices_lock_setup_failure; then
      LAUNCHSERVICES_RECOVERY_RETAINED=true
      echo "[OpenReaper] LaunchServices lock setup recovery is retained at ${LAUNCHSERVICES_LOCK_PATH}" >&2
    fi
    return 1
  fi
  LAUNCHSERVICES_CLEANUP_REQUIRED=true
  local key
  local desired
  for key in "${LAUNCHSERVICES_ENV_KEYS[@]}"; do
    if desired="$(launchservices_env_value "${key}")"; then
      if ! "${LAUNCHCTL_BIN}" setenv "${key}" "${desired}"; then
        echo "[OpenReaper] failed to set LaunchServices env ${key}" >&2
        return 1
      fi
    else
      if ! "${LAUNCHCTL_BIN}" unsetenv "${key}"; then
        echo "[OpenReaper] failed to clear stale LaunchServices env ${key}" >&2
        return 1
      fi
    fi
  done
}

restore_launchservices_env() {
  if [[ "${LAUNCHSERVICES_CLEANUP_REQUIRED}" != "true" ]]; then
    return 0
  fi
  local failed=0
  local key
  local presence
  local previous
  for key in "${LAUNCHSERVICES_ENV_KEYS[@]}"; do
    local presence_path="${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.presence"
    local value_path="${LAUNCHSERVICES_SNAPSHOT_DIR}/${key}.value"
    if [[ ! -f "${presence_path}" || -L "${presence_path}" || ! -f "${value_path}" || -L "${value_path}" ]]; then
      echo "[OpenReaper] missing or unsafe LaunchServices recovery snapshot for ${key}" >&2
      failed=1
      continue
    fi
    presence="$(<"${presence_path}")"
    previous="$(<"${value_path}")"
    if [[ "${presence}" == "set" ]]; then
      if ! "${LAUNCHCTL_BIN}" setenv "${key}" "${previous}"; then
        echo "[OpenReaper] failed to restore LaunchServices env ${key}" >&2
        failed=1
      fi
    elif [[ "${presence}" == "unset" ]]; then
      if ! "${LAUNCHCTL_BIN}" unsetenv "${key}"; then
        echo "[OpenReaper] failed to unset LaunchServices env ${key}" >&2
        failed=1
      fi
    else
      echo "[OpenReaper] invalid LaunchServices recovery presence for ${key}" >&2
      failed=1
    fi
  done
  if (( failed != 0 )); then
    LAUNCHSERVICES_RECOVERY_RETAINED=true
    echo "[OpenReaper] LaunchServices lock retained at ${LAUNCHSERVICES_LOCK_PATH}" >&2
    echo "[OpenReaper] LaunchServices recovery snapshot retained at ${LAUNCHSERVICES_SNAPSHOT_DIR}" >&2
    return 1
  fi
  if ! release_owned_launchservices_lock; then
    LAUNCHSERVICES_RECOVERY_RETAINED=true
    echo "[OpenReaper] LaunchServices environment was restored but its lock could not be safely released: ${LAUNCHSERVICES_LOCK_PATH}" >&2
    if [[ -e "${LAUNCHSERVICES_SNAPSHOT_DIR}" || -L "${LAUNCHSERVICES_SNAPSHOT_DIR}" ]]; then
      echo "[OpenReaper] LaunchServices recovery snapshot retained at ${LAUNCHSERVICES_SNAPSHOT_DIR}" >&2
    fi
    return 1
  fi
  LAUNCHSERVICES_CLEANUP_REQUIRED=false
  LAUNCHSERVICES_RECOVERY_RETAINED=false
  return 0
}

launchservices_cleanup_on_exit() {
  local original_status=$?
  trap - EXIT
  if [[ "${LAUNCHSERVICES_RECOVERY_RETAINED}" == "true" ]]; then
    if (( original_status == 0 )); then
      original_status=1
    fi
    exit "${original_status}"
  fi
  if [[ "${LAUNCHSERVICES_CLEANUP_REQUIRED}" == "true" ]]; then
    if ! restore_launchservices_env; then
      echo "[OpenReaper] LaunchServices cleanup failed during exit." >&2
      exit 1
    fi
  elif [[ "${LAUNCHSERVICES_LOCK_OWNED}" == "true" ]]; then
    if ! cleanup_launchservices_lock_setup_failure; then
      echo "[OpenReaper] LaunchServices pre-mutation lock cleanup failed: ${LAUNCHSERVICES_LOCK_PATH}" >&2
      exit 1
    fi
  fi
  exit "${original_status}"
}

wait_for_new_reaper_pid() {
  local before_pids="$1"
  local current_pids="${SESSION_ROOT}/reaper-current.pids"
  local max_ticks=$(( START_WAIT_SECONDS * 4 ))
  local tick
  for (( tick = 1; tick <= max_ticks; tick++ )); do
    reaper_pids > "${current_pids}"
    local new_pid
    new_pid="$(comm -13 "${before_pids}" "${current_pids}" | tail -1 || true)"
    if [[ -n "${new_pid}" ]]; then
      echo "${new_pid}"
      return 0
    fi
    sleep 0.25
  done
  return 1
}

assert_reaper_process_alive() {
  local reaper_pid
  reaper_pid="$(cat "${PID_FILE}")"
  if ! kill -0 "${reaper_pid}" 2>/dev/null; then
    echo "[OpenReaper] REAPER exited before Bridge readiness. pid=${reaper_pid}" >&2
    echo "[OpenReaper] REAPER log: ${START_LOG}" >&2
    tail -80 "${START_LOG}" >&2 || true
    return 1
  fi
  return 0
}

bridge_heartbeat_ready() {
  node --input-type=module - "${TRANSPORT_DIR}/openreaper-bridge-liveness-v1.json" "${BRIDGE_OWNER}" "${BRIDGE_GENERATION}" <<'NODE'
import { readFile, stat } from "node:fs/promises";
const [heartbeatPath, owner, generationText] = process.argv.slice(2);
try {
  const [raw, metadata] = await Promise.all([readFile(heartbeatPath, "utf8"), stat(heartbeatPath)]);
  const heartbeat = JSON.parse(raw);
  const now = Date.now();
  const generation = Number(generationText);
  const ready = heartbeat?.contract === "openreaper.bridge_liveness.v1"
    && heartbeat.active_owner === owner
    && Number.isSafeInteger(generation)
    && heartbeat.active_generation === generation
    && Number.isSafeInteger(heartbeat.sequence)
    && heartbeat.sequence >= 1
    && Number.isSafeInteger(heartbeat.refreshed_at_unix_s)
    && now - metadata.mtimeMs >= -1_000
    && now - metadata.mtimeMs <= 3_000
    && now - heartbeat.refreshed_at_unix_s * 1_000 >= -1_000
    && now - heartbeat.refreshed_at_unix_s * 1_000 <= 3_000;
  process.exit(ready ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

startup_status_summary() {
  local status_path="${TRANSPORT_DIR}/openreaper-startup-status-v1.json"
  if [[ ! -f "${status_path}" || -L "${status_path}" ]]; then
    return 0
  fi
  node --input-type=module - "${status_path}" <<'NODE'
import { readFile } from "node:fs/promises";
const [statusPath] = process.argv.slice(2);
try {
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  const stage = typeof status?.stage === "string" ? status.stage : "invalid";
  const detail = typeof status?.detail === "string" ? status.detail.replace(/[\r\n]+/gu, " ").slice(0, 240) : "";
  console.error(`[OpenReaper] startup-hook-stage=${stage}${detail ? ` detail=${detail}` : ""}`);
} catch {
  console.error(`[OpenReaper] startup-hook-stage=invalid status_file=${statusPath}`);
}
NODE
}

startup_status_stage_ready() {
  local status_path="${TRANSPORT_DIR}/openreaper-startup-status-v1.json"
  node --input-type=module - "${status_path}" <<'NODE'
import { readFile } from "node:fs/promises";
const [statusPath] = process.argv.slice(2);
try {
  const status = JSON.parse(await readFile(statusPath, "utf8"));
  const stages = new Set(["hook_seen", "environment_missing", "bridge_dofile_succeeded", "bridge_dofile_failed"]);
  process.exit(status?.contract === "openreaper.startup_status.v1" && stages.has(status?.stage) ? 0 : 1);
} catch {
  process.exit(1);
}
NODE
}

prepare_startup_status_for_new_launch() {
  local status_path="${TRANSPORT_DIR}/openreaper-startup-status-v1.json"
  if [[ ! -e "${status_path}" && ! -L "${status_path}" ]]; then
    return 0
  fi
  if [[ ! -f "${status_path}" || -L "${status_path}" ]]; then
    echo "[OpenReaper] startup status path is not a regular file: ${status_path}" >&2
    return 1
  fi
  if ! rm -f -- "${status_path}"; then
    echo "[OpenReaper] could not clear the previous startup status: ${status_path}" >&2
    return 1
  fi
}

wait_for_startup_hook() {
  local reaper_pid="$1"
  local max_ticks=$(( START_WAIT_SECONDS * 4 ))
  local tick dialog_result
  for (( tick = 1; tick <= max_ticks; tick++ )); do
    if ! kill -0 "${reaper_pid}" 2>/dev/null; then
      echo "[OpenReaper] REAPER exited before its startup hook published a stage. pid=${reaper_pid}" >&2
      return 1
    fi
    # A project-load dialog can prevent REAPER from reaching __startup.lua.
    # Reuse the exact safe classifier while LaunchServices still carries the
    # session environment; unknown and decision-bearing dialogs stay blocked.
    dialog_result="$(run_startup_dialog_assist)"
    record_dialog_result "${dialog_result}"
    if ! startup_dialog_result_is_safe "${dialog_result}"; then
      echo "[OpenReaper] startup-dialog-blocker=${dialog_result}" >&2
      return 2
    fi
    if [[ "${dialog_result}" != "no_safe_dialog" ]]; then
      sleep 0.25
      continue
    fi
    if startup_status_stage_ready; then
      return 0
    fi
    sleep 0.25
  done
  startup_status_summary
  return 1
}

verify_public_bridge_read() {
  local doctor="${INSTALL_ROOT}/bin/openreaper-doctor"
  local doctor_log="${START_LOG%.log}-doctor.log"
  if [[ ! -x "${doctor}" ]]; then
    echo "[OpenReaper] installed Doctor is missing or not executable: ${doctor}" >&2
    return 1
  fi
  if OPENREAPER_SESSION_ROOT="${SESSION_ROOT}" \
      OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${TRANSPORT_DIR}" \
      OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH="${BRIDGE_SCRIPT}" \
      OPENREAPER_ARTIFACT_ROOT="${ARTIFACT_ROOT}" \
      OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${ARTIFACT_ROOT}" \
      OPENREAPER_LIVE_SMOKE_RENDER_ROOT="${RENDER_ROOT}" \
      OPENREAPER_LIVE_BRIDGE_OWNER="${BRIDGE_OWNER}" \
      OPENREAPER_LIVE_BRIDGE_GENERATION="${BRIDGE_GENERATION}" \
      OPENREAPER_DOCTOR_SMOKE_TIMEOUT_MS=10000 \
      OPENREAPER_DOCTOR_READ_PROBE_TIMEOUT_MS=3000 \
      "${doctor}" --wait-bridge=2 > "${doctor_log}" 2>&1; then
    echo "[OpenReaper] bridge-read-probe=passed"
    echo "[OpenReaper] doctor-log=${doctor_log}"
    return 0
  fi
  echo "[OpenReaper] bridge heartbeat was ready but the public read probe failed. doctor-log=${doctor_log}" >&2
  return 1
}

verified_existing_reaper_pid() {
  local readiness_module="${INSTALL_ROOT}/vendor/openreaper-kernel/packages/mcp-server/src/alpha3-2b3-runtime-doctor-readiness-v1.mjs"
  if [[ ! -f "${PID_FILE}" && ! -L "${PID_FILE}" ]]; then
    return 1
  fi
  if [[ ! -f "${readiness_module}" || -L "${readiness_module}" ]]; then
    echo "[OpenReaper] cannot verify the existing session PID because the readiness module is unavailable." >&2
    return 2
  fi
  node --input-type=module - "${readiness_module}" "${SESSION_ROOT}" <<'NODE'
import { pathToFileURL } from "node:url";

const [readinessModulePath, sessionRoot] = process.argv.slice(2);
try {
  const readiness = await import(pathToFileURL(readinessModulePath));
  const inspected = await readiness.inspectAlpha3_2B3ReaperProcess({ sessionRoot });
  if (inspected?.running === true && inspected?.identity_verified === true && Number.isSafeInteger(inspected.pid)) {
    process.stdout.write(String(inspected.pid));
    process.exit(0);
  }
  if (inspected?.status === "pid_missing" || inspected?.status === "pid_dead") process.exit(1);
  process.exit(2);
} catch {
  process.exit(2);
}
NODE
}

run_startup_dialog_assist() {
  if [[ "$(uname -s)" != "Darwin" || ! -x "/usr/bin/osascript" ]]; then
    echo "unavailable"
    return 0
  fi
  local reaper_pid assist_status=0
  reaper_pid="$(cat "${PID_FILE}")"
  if /usr/bin/perl -e 'my $seconds = shift @ARGV; alarm $seconds; exec @ARGV or die "exec failed: $!"' \
      "${STARTUP_DIALOG_TIMEOUT_SECONDS}" \
      /usr/bin/osascript - "${STARTUP_DIALOG_ASSIST}" "${IGNORE_MISSING_MEDIA}" "${reaper_pid}" <<'APPLESCRIPT' 2>> "${START_LOG}"
on uiElementNamed(theWindow, targetName)
  tell application "System Events"
    try
      set uiElements to entire contents of theWindow
      repeat with uiElement in uiElements
        try
          set uiName to name of uiElement
          if uiName is not missing value and (uiName as text) is targetName then return true
        end try
      end repeat
    end try
  end tell
  return false
end uiElementNamed

on exactUiElementCount(theWindow, targetName, targetRole)
  tell application "System Events"
    set matchCount to 0
    try
      set uiElements to entire contents of theWindow
      repeat with uiElement in uiElements
        try
          set uiName to name of uiElement
          set uiRole to role of uiElement
          if uiName is not missing value and uiRole is not missing value and (uiName as text) is targetName and (uiRole as text) is targetRole then set matchCount to matchCount + 1
        end try
      end repeat
    end try
  end tell
  return matchCount
end exactUiElementCount

on clickUniqueExactButton(theWindow, targetName)
  tell application "System Events"
    try
      set uiElements to entire contents of theWindow
      set matchingElement to missing value
      set matchCount to 0
      repeat with uiElement in uiElements
        try
          set uiName to name of uiElement
          set uiRole to role of uiElement
          if uiName is not missing value and uiRole is not missing value and (uiName as text) is targetName and (uiRole as text) is "AXButton" then
            set matchCount to matchCount + 1
            set matchingElement to uiElement
          end if
        end try
      end repeat
      if matchCount is not 1 then error "exact button is not unique"
      click matchingElement
      return true
    on error errorMessage
      error errorMessage
    end try
  end tell
  error "exact button disappeared before click"
end clickUniqueExactButton

on uiTextAreaContains(theWindow, firstNeedle, secondNeedle)
  tell application "System Events"
    try
      set warningText to value of text area 1 of scroll area 1 of theWindow as text
      return warningText contains firstNeedle and warningText contains secondNeedle
    end try
  end tell
  return false
end uiTextAreaContains

on run argv
set allowSafeActions to (item 1 of argv is "true")
set allowMissingMedia to (item 2 of argv is "true")
set launchedPid to item 3 of argv as integer
tell application "System Events"
  set matchingProcesses to every process whose unix id is launchedPid
  if (count of matchingProcesses) is not 1 then return "blocked_reaper_identity:pid=" & launchedPid
  set launchedProcess to item 1 of matchingProcesses
  if name of launchedProcess is not "REAPER" then return "blocked_reaper_identity:pid=" & launchedPid
  tell launchedProcess
    repeat with reaperWindow in windows
      set windowTitle to ""
      try
        set windowTitle to name of reaperWindow as text
      end try
      if windowTitle is "Project Settings" or windowTitle is "Project Settings / Notes" then
        set isProjectNotesWindow to my uiElementNamed(reaperWindow, "Notes") and my uiElementNamed(reaperWindow, "Show notes on project load") and my exactUiElementCount(reaperWindow, "OK", "AXButton") is 1
        if isProjectNotesWindow then
          if not allowSafeActions then return "blocked_manual_dialog:title=Project Settings"
          try
            my clickUniqueExactButton(reaperWindow, "OK")
            return "dismissed_project_notes"
          on error errorMessage
            return "project_notes_seen_not_dismissed:" & errorMessage
          end try
        end if
        return "project_settings_seen_but_not_notes"
      end if
      set hasIgnoreMissingFiles to false
      try
        if my exactUiElementCount(reaperWindow, "Ignore all missing files", "AXButton") is 1 then set hasIgnoreMissingFiles to true
      end try
      if hasIgnoreMissingFiles then
        if allowMissingMedia then
          try
            my clickUniqueExactButton(reaperWindow, "Ignore all missing files")
            return "dismissed_missing_media:choice=Ignore all missing files"
          on error errorMessage
            return "blocked_missing_media:choice=Ignore all missing files:error=" & errorMessage
          end try
        end if
        return "blocked_missing_media:choice=Ignore all missing files"
      end if
      if windowTitle is "Project Load Warning" then
        set isOfflineMediaWarning to my uiTextAreaContains(reaperWindow, "in an off-line state", "filenames should be preserved")
        if allowMissingMedia and isOfflineMediaWarning and my exactUiElementCount(reaperWindow, "OK", "AXButton") is 1 then
          try
            my clickUniqueExactButton(reaperWindow, "OK")
            return "dismissed_missing_media_offline_warning:choice=OK"
          on error errorMessage
            return "blocked_missing_media_offline_warning:choice=OK:error=" & errorMessage
          end try
        end if
        return "blocked_user_decision:title=Project Load Warning"
      end if
      set windowSubrole to ""
      try
        set windowSubrole to subrole of reaperWindow as text
      on error errorMessage
        return "blocked_dialog_classification:title=" & windowTitle & ":error=" & errorMessage
      end try
      if windowSubrole is "AXDialog" or windowSubrole is "AXSheet" then
        if windowTitle contains "Evaluation" or windowTitle contains "License" or windowTitle contains "Recovery" or windowTitle contains "missing effect" or windowTitle contains "New version" then
          return "blocked_user_decision:title=" & windowTitle
        end if
        return "blocked_unknown_dialog:title=" & windowTitle
      end if
      if windowSubrole is not "AXWindow" and windowSubrole is not "AXStandardWindow" and windowSubrole is not "" then
        return "blocked_unknown_dialog:title=" & windowTitle
      end if
    end repeat
  end tell
end tell
return "no_safe_dialog"
end run
APPLESCRIPT
  then
    :
  else
    assist_status=$?
  fi
  if (( assist_status == 142 )); then
    echo "blocked_dialog_inspection_timeout:seconds=${STARTUP_DIALOG_TIMEOUT_SECONDS}"
  elif (( assist_status != 0 )); then
    echo "blocked_dialog_inspection_failed:status=${assist_status}"
  fi
}

startup_dialog_result_is_safe() {
  case "$1" in
    no_safe_dialog|dismissed_project_notes|dismissed_missing_media:choice=Ignore\ all\ missing\ files|dismissed_missing_media_offline_warning:choice=OK)
      return 0
      ;;
  esac
  return 1
}

record_dialog_result() {
  local result="$1"
  echo "[OpenReaper] dialog-event timestamp=$(date -u +"%Y-%m-%dT%H:%M:%SZ") project=${PROJECT_PATH:-none} result=${result}" >> "${START_LOG}"
}

wait_for_startup_readiness() {
  local max_ticks=$(( START_WAIT_SECONDS * 4 ))
  local tick dialog_result
  if (( max_ticks < 1 )); then
    echo "[OpenReaper] OPENREAPER_START_WAIT_SECONDS must be at least 1 for verified startup." >&2
    return 1
  fi
  for (( tick = 1; tick <= max_ticks; tick++ )); do
    assert_reaper_process_alive || return 1
    dialog_result="$(run_startup_dialog_assist)"
    record_dialog_result "${dialog_result}"
    if ! startup_dialog_result_is_safe "${dialog_result}"; then
      echo "[OpenReaper] startup-dialog-blocker=${dialog_result}" >&2
      return 2
    fi
    if [[ "${dialog_result}" != "no_safe_dialog" ]]; then
      sleep 0.25
      continue
    fi
    if bridge_heartbeat_ready; then
      verify_public_bridge_read || return 1
      echo "[OpenReaper] bridge-heartbeat=ready owner=${BRIDGE_OWNER} generation=${BRIDGE_GENERATION}"
      return 0
    fi
    sleep 0.25
  done
  startup_status_summary
  if [[ "${RECOVER_EXISTING}" == "true" ]]; then
    echo "[OpenReaper] startup-status=blocked_same_instance_bridge_not_ready" >&2
    echo "[OpenReaper] blocker-code=SAME_INSTANCE_BRIDGE_ACTION_REQUIRED" >&2
    echo "[OpenReaper] recovery=The verified REAPER PID is alive, but this command cannot restart its stopped Bridge externally. In that same REAPER, run fallback Action 'OpenReaper: Start MCP bridge', then rerun openreaper-doctor --wait-bridge. Do not start another REAPER." >&2
    return 4
  fi
  echo "[OpenReaper] Bridge did not become ready within ${START_WAIT_SECONDS}s." >&2
  echo "[OpenReaper] recovery=Resolve the reported REAPER dialog, or run fallback Action 'OpenReaper: Start MCP bridge'; then rerun openreaper-doctor --wait-bridge." >&2
  return 1
}

trap 'launchservices_cleanup_on_exit' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

if existing_reaper_pid="$(verified_existing_reaper_pid)"; then
  echo "[OpenReaper] existing-session=reaper_pid=${existing_reaper_pid};identity=verified"
  if [[ "${RECOVER_EXISTING}" != "true" ]]; then
    echo "[OpenReaper] startup-status=existing_session"
    echo "[OpenReaper] recovery=If its Bridge is already running, use ${0} --recover-existing with the same session root to verify it. If the Bridge stopped, run the registered Bridge Action in that REAPER; no duplicate REAPER will be started." >&2
    exit 3
  fi
  echo "[OpenReaper] startup-mode=recover_existing"
  echo "${existing_reaper_pid}" > "${PID_FILE}"
else
  existing_reaper_status=$?
  if (( existing_reaper_status == 2 )); then
    echo "[OpenReaper] existing session could not be safely verified; refusing to launch another REAPER." >&2
    exit 1
  fi
  launch_reaper
fi
wait_for_startup_readiness

echo "[OpenReaper] startup-status=ready"
echo "[OpenReaper] bridge-status=ready"
