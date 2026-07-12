#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
BRIDGE_SCRIPT="${INSTALL_ROOT}/vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"
REAPER_BIN="/Applications/REAPER.app/Contents/MacOS/REAPER"
REAPER_APP=""
SESSION_ROOT="${INSTALL_ROOT}/session"
SESSION_ROOT_EXPLICIT=false
RENDER_ROOT=""
RENDER_ROOT_EXPLICIT=false
MANAGED_RENDER_ROOT_RECORD="${INSTALL_ROOT}/session/managed-render-root.path"
TRANSPORT_DIR=""
ARTIFACT_ROOT=""
BRIDGE_OWNER=""
BRIDGE_GENERATION=""
START_WAIT_SECONDS="${OPENREAPER_START_WAIT_SECONDS:-8}"
STARTUP_DIALOG_ASSIST=true
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
  OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR
  OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH
  OPENREAPER_ARTIFACT_ROOT
  OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT
  OPENREAPER_LIVE_SMOKE_RENDER_ROOT
  OPENREAPER_LIVE_BRIDGE_OWNER
  OPENREAPER_LIVE_BRIDGE_GENERATION
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
    --no-startup-dialog-assist|--no-dialog-assist)
      STARTUP_DIALOG_ASSIST=false
      shift
      ;;
    --help|-h)
      cat <<'HELP'
OpenReaper start helper

Usage:
  openreaper-start [--project-path /path/to/project.RPP]
  openreaper-start --reaper-binary /path/to/REAPER [--project-path /path/to/project.RPP]
  openreaper-start --reaper-app /path/to/REAPER.app [--project-path /path/to/project.RPP]
  openreaper-start --session-root /path/to/session [--project-path /path/to/project.RPP]
  openreaper-start --render-root /absolute/path/to/renders [--project-path /path/to/project.RPP]

REAPER must be started through this helper for OpenReaper MCP to connect.
The helper starts REAPER with the OpenReaper bridge environment, waits briefly
for the process to remain alive, and then returns with the REAPER pid/log path.
On macOS it uses LaunchServices so REAPER is not a child of the agent command
session.
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

After REAPER opens, the bridge still needs to be started inside REAPER. The
agent should try to run the REAPER action named "OpenReaper: Start MCP bridge".
If the agent cannot operate the REAPER UI, ask the user to open the Actions
list, search that exact action name, and click Run.

Startup dialog assist is enabled by default. It only dismisses the known
Project Settings / Notes "show notes on project load" window by clicking OK.
It does not close license/evaluation, recovery, plugin, or other user-choice
dialogs. Pass --no-startup-dialog-assist to disable it for debugging.
HELP
      exit 0
      ;;
    *)
      ARGS+=("$1")
      shift
      ;;
  esac
done

if [[ -z "${TRANSPORT_DIR}" ]]; then
  TRANSPORT_DIR="${SESSION_ROOT}/transport"
fi

if [[ -z "${ARTIFACT_ROOT}" ]]; then
  ARTIFACT_ROOT="${SESSION_ROOT}/artifacts"
fi

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
if [[ "$(uname -s)" == "Darwin" && -n "${REAPER_APP}" && -d "${REAPER_APP}" && -x "${OPEN_BIN}" && -x "${LAUNCHCTL_BIN}" ]]; then
  USE_LAUNCHSERVICES=true
fi

export OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH="${BRIDGE_SCRIPT}"
export OPENREAPER_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_RENDER_ROOT="${RENDER_ROOT}"
export OPENREAPER_LIVE_BRIDGE_OWNER="${BRIDGE_OWNER}"
export OPENREAPER_LIVE_BRIDGE_GENERATION="${BRIDGE_GENERATION}"

echo "[OpenReaper] Starting REAPER through OpenReaper."
echo "[OpenReaper] MCP can connect only to REAPER sessions started this way."
echo "[OpenReaper] transport=${TRANSPORT_DIR}"
echo "[OpenReaper] render-root=${RENDER_ROOT}"
echo "[OpenReaper] bridge=${BRIDGE_SCRIPT}"
echo "[OpenReaper] reaper-log=${START_LOG}"
if [[ "${USE_LAUNCHSERVICES}" == "true" ]]; then
  echo "[OpenReaper] launch-method=macos_launchservices"
  echo "[OpenReaper] reaper-app=${REAPER_APP}"
else
  echo "[OpenReaper] launch-method=direct_binary_fallback"
fi
echo "[OpenReaper] bridge-action=OpenReaper: Start MCP bridge"
echo "[OpenReaper] bridge-status=needs_reaper_action"
echo "[OpenReaper] startup-dialog-assist=project_notes_only"
echo "[OpenReaper] agent-next-step=Try to run REAPER action 'OpenReaper: Start MCP bridge'. If the agent cannot operate the UI, ask the user to open Actions, search that exact name, and click Run."
echo "[OpenReaper] user-fallback=In REAPER: Actions > Show action list > search 'OpenReaper: Start MCP bridge' > Run."

launch_reaper() {
  local -a reaper_args
  reaper_args=("-newinst")
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
    if ! "${OPEN_BIN}" -na "${REAPER_APP}" --args "${reaper_args[@]}" >> "${START_LOG}" 2>&1; then
      echo "[OpenReaper] LaunchServices failed to start REAPER. See log: ${START_LOG}" >&2
      exit 1
    fi
    if ! reaper_pid="$(wait_for_new_reaper_pid "${before_pids}")"; then
      echo "[OpenReaper] LaunchServices did not expose a new REAPER pid in time. See log: ${START_LOG}" >&2
      exit 1
    fi
    if ! restore_launchservices_env; then
      echo "[OpenReaper] LaunchServices environment restoration failed; startup is not successful." >&2
      exit 1
    fi
  else
    nohup "${REAPER_BIN}" "${reaper_args[@]}" >> "${START_LOG}" 2>&1 &
    reaper_pid="$!"
    disown "${reaper_pid}" 2>/dev/null || true
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
    desired="$(launchservices_env_value "${key}")"
    if ! "${LAUNCHCTL_BIN}" setenv "${key}" "${desired}"; then
      echo "[OpenReaper] failed to set LaunchServices env ${key}" >&2
      return 1
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

wait_for_reaper_process() {
  local reaper_pid
  reaper_pid="$(cat "${PID_FILE}")"
  local max_ticks=$(( START_WAIT_SECONDS * 2 ))
  local tick
  for (( tick = 1; tick <= max_ticks; tick++ )); do
    if ! kill -0 "${reaper_pid}" 2>/dev/null; then
      echo "[OpenReaper] REAPER exited before startup stabilized. pid=${reaper_pid}" >&2
      echo "[OpenReaper] REAPER log: ${START_LOG}" >&2
      tail -80 "${START_LOG}" >&2 || true
      exit 1
    fi
    sleep 0.5
  done
  echo "[OpenReaper] REAPER process stayed alive for ${START_WAIT_SECONDS}s. pid=${reaper_pid}"
  if [[ -s "${START_LOG}" ]]; then
    grep -E "\\[OpenReaper\\]" "${START_LOG}" | tail -20 || true
  fi
}

run_startup_dialog_assist() {
  if [[ "${STARTUP_DIALOG_ASSIST}" != "true" ]]; then
    echo "disabled"
    return 0
  fi
  if [[ "$(uname -s)" != "Darwin" || ! -x "/usr/bin/osascript" ]]; then
    echo "unavailable"
    return 0
  fi
  /usr/bin/osascript <<'APPLESCRIPT' 2>> "${START_LOG}" || {
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

tell application "System Events"
  if not (exists process "REAPER") then return "no_reaper_process"
  tell process "REAPER"
    repeat with reaperWindow in windows
      set windowTitle to ""
      try
        set windowTitle to name of reaperWindow as text
      end try
      if windowTitle is "Project Settings" then
        set isProjectNotesWindow to false
        if my uiElementNamed(reaperWindow, "Notes") then set isProjectNotesWindow to true
        if my uiElementNamed(reaperWindow, "Show notes on project load") then set isProjectNotesWindow to true
        if isProjectNotesWindow then
          try
            click button "OK" of reaperWindow
            return "dismissed_project_notes"
          on error errorMessage
            return "project_notes_seen_not_dismissed:" & errorMessage
          end try
        end if
        return "project_settings_seen_but_not_notes"
      end if
    end repeat
  end tell
end tell
return "no_safe_dialog"
APPLESCRIPT
    echo "failed"
  }
}

trap 'launchservices_cleanup_on_exit' EXIT
trap 'exit 129' HUP
trap 'exit 130' INT
trap 'exit 143' TERM

launch_reaper
wait_for_reaper_process
echo "[OpenReaper] startup-dialog-assist-result=$(run_startup_dialog_assist)"

echo "[OpenReaper] startup-status=ready"
echo "[OpenReaper] bridge-status=waiting_for_reaper_action"
