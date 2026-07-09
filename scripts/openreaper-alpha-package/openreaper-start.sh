#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
BRIDGE_SCRIPT="${INSTALL_ROOT}/vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"
REAPER_BIN="${REAPER_BINARY:-/Applications/REAPER.app/Contents/MacOS/REAPER}"
SESSION_ROOT="${INSTALL_ROOT}/session"
TRANSPORT_DIR=""
ARTIFACT_ROOT=""
BRIDGE_OWNER=""
BRIDGE_GENERATION=""

PROJECT_PATH=""
ARGS=()
while [[ $# -gt 0 ]]; do
  case "$1" in
    --project-path|--project|--rpp-path)
      PROJECT_PATH="${2:-}"
      shift 2
      ;;
    --reaper-binary)
      REAPER_BIN="${2:-}"
      shift 2
      ;;
    --session-root)
      SESSION_ROOT="${2:-}"
      shift 2
      ;;
    --transport-dir)
      TRANSPORT_DIR="${2:-}"
      shift 2
      ;;
    --artifact-root)
      ARTIFACT_ROOT="${2:-}"
      shift 2
      ;;
    --bridge-owner|--owner)
      BRIDGE_OWNER="${2:-}"
      shift 2
      ;;
    --bridge-generation|--generation)
      BRIDGE_GENERATION="${2:-}"
      shift 2
      ;;
    --help|-h)
      cat <<'HELP'
OpenReaper start helper

Usage:
  openreaper-start [--project-path /path/to/project.RPP]
  openreaper-start --reaper-binary /path/to/REAPER [--project-path /path/to/project.RPP]
  openreaper-start --session-root /path/to/session [--project-path /path/to/project.RPP]

REAPER must be started through this helper for OpenReaper MCP to connect.
The helper defaults to its installed session directory and ignores stale
OPENREAPER_SESSION_ROOT / OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR /
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT / OPENREAPER_LIVE_BRIDGE_OWNER /
OPENREAPER_LIVE_BRIDGE_GENERATION values from the parent shell. Use explicit
--session-root/--transport-dir/--artifact-root/--bridge-owner/--bridge-generation
only for a bounded evidence window.
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

if [[ -z "${BRIDGE_OWNER}" ]]; then
  BRIDGE_OWNER="openreaper-alpha"
fi

if [[ -z "${BRIDGE_GENERATION}" ]]; then
  BRIDGE_GENERATION="1"
fi

LAUNCHER_SCRIPT="${SESSION_ROOT}/openreaper-bridge-launcher.lua"

if [[ ! -x "${REAPER_BIN}" ]]; then
  echo "[OpenReaper] REAPER binary is not executable: ${REAPER_BIN}" >&2
  echo "[OpenReaper] Set REAPER_BINARY or pass --reaper-binary." >&2
  exit 2
fi

mkdir -p "${TRANSPORT_DIR}/requests" "${TRANSPORT_DIR}/results" "${ARTIFACT_ROOT}"
mkdir -p "${SESSION_ROOT}"

cat > "${LAUNCHER_SCRIPT}" <<'LUA'
local bridge = os.getenv("OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH")
local transport = os.getenv("OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR")

if bridge and bridge ~= "" and transport and transport ~= "" then
  local ok, err = pcall(dofile, bridge)
  if not ok and reaper and reaper.ShowConsoleMsg then
    reaper.ShowConsoleMsg("[OpenReaper] bridge launcher failed: " .. tostring(err) .. "\n")
  end
elseif reaper and reaper.ShowConsoleMsg then
  reaper.ShowConsoleMsg("[OpenReaper] bridge launcher did not start: missing OpenReaper startup environment.\n")
end
LUA

export OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${TRANSPORT_DIR}"
export OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH="${BRIDGE_SCRIPT}"
export OPENREAPER_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${ARTIFACT_ROOT}"
export OPENREAPER_LIVE_BRIDGE_OWNER="${BRIDGE_OWNER}"
export OPENREAPER_LIVE_BRIDGE_GENERATION="${BRIDGE_GENERATION}"

echo "[OpenReaper] Starting REAPER through OpenReaper."
echo "[OpenReaper] MCP can connect only to REAPER sessions started this way."
echo "[OpenReaper] transport=${TRANSPORT_DIR}"
echo "[OpenReaper] bridge=${BRIDGE_SCRIPT}"
echo "[OpenReaper] launcher=${LAUNCHER_SCRIPT}"
echo "[OpenReaper] If REAPER shows a startup/version/recovery/plugin dialog, dismiss it and ask the agent to reconnect."

if [[ -n "${PROJECT_PATH}" ]]; then
  exec "${REAPER_BIN}" "-newinst" "${PROJECT_PATH}" "${LAUNCHER_SCRIPT}" "${ARGS[@]}"
fi

exec "${REAPER_BIN}" "-newinst" "${LAUNCHER_SCRIPT}" "${ARGS[@]}"
