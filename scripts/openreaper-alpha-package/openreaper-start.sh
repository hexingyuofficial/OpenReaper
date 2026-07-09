#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
BRIDGE_SCRIPT="${INSTALL_ROOT}/vendor/openreaper-kernel/reaper/bridge/openreaper-live-bridge.lua"
REAPER_BIN="${REAPER_BINARY:-/Applications/REAPER.app/Contents/MacOS/REAPER}"
REAPER_APP="${REAPER_APP:-}"
SESSION_ROOT="${INSTALL_ROOT}/session"
TRANSPORT_DIR=""
ARTIFACT_ROOT=""
BRIDGE_OWNER=""
BRIDGE_GENERATION=""
START_WAIT_SECONDS="${OPENREAPER_START_WAIT_SECONDS:-8}"
STARTUP_DIALOG_ASSIST=true

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
    --reaper-app)
      REAPER_APP="${2:-}"
      REAPER_BIN="${REAPER_APP}/Contents/MacOS/REAPER"
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

REAPER must be started through this helper for OpenReaper MCP to connect.
The helper starts REAPER with the OpenReaper bridge environment, waits briefly
for the process to remain alive, and then returns with the REAPER pid/log path.
On macOS it uses LaunchServices so REAPER is not a child of the agent command
session.
The helper defaults to its installed session directory and ignores stale
OPENREAPER_SESSION_ROOT / OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR /
OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT / OPENREAPER_LIVE_BRIDGE_OWNER /
OPENREAPER_LIVE_BRIDGE_GENERATION values from the parent shell. Use explicit
--session-root/--transport-dir/--artifact-root/--bridge-owner/--bridge-generation
only for a bounded evidence window.

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
if [[ "$(uname -s)" == "Darwin" && -n "${REAPER_APP}" && -d "${REAPER_APP}" && -x "/usr/bin/open" && -x "/bin/launchctl" ]]; then
  USE_LAUNCHSERVICES=true
fi

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
    set_launchservices_env
    if ! /usr/bin/open -na "${REAPER_APP}" --args "${reaper_args[@]}" >> "${START_LOG}" 2>&1; then
      restore_launchservices_env
      echo "[OpenReaper] LaunchServices failed to start REAPER. See log: ${START_LOG}" >&2
      exit 1
    fi
    if ! reaper_pid="$(wait_for_new_reaper_pid "${before_pids}")"; then
      restore_launchservices_env
      echo "[OpenReaper] LaunchServices did not expose a new REAPER pid in time. See log: ${START_LOG}" >&2
      exit 1
    fi
    restore_launchservices_env
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

set_launchservices_env() {
  /bin/launchctl getenv OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR > "${SESSION_ROOT}/launchd-env.OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR.previous" 2>/dev/null || true
  /bin/launchctl getenv OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH > "${SESSION_ROOT}/launchd-env.OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH.previous" 2>/dev/null || true
  /bin/launchctl getenv OPENREAPER_ARTIFACT_ROOT > "${SESSION_ROOT}/launchd-env.OPENREAPER_ARTIFACT_ROOT.previous" 2>/dev/null || true
  /bin/launchctl getenv OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT > "${SESSION_ROOT}/launchd-env.OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT.previous" 2>/dev/null || true
  /bin/launchctl getenv OPENREAPER_LIVE_BRIDGE_OWNER > "${SESSION_ROOT}/launchd-env.OPENREAPER_LIVE_BRIDGE_OWNER.previous" 2>/dev/null || true
  /bin/launchctl getenv OPENREAPER_LIVE_BRIDGE_GENERATION > "${SESSION_ROOT}/launchd-env.OPENREAPER_LIVE_BRIDGE_GENERATION.previous" 2>/dev/null || true

  /bin/launchctl setenv OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR "${TRANSPORT_DIR}"
  /bin/launchctl setenv OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH "${BRIDGE_SCRIPT}"
  /bin/launchctl setenv OPENREAPER_ARTIFACT_ROOT "${ARTIFACT_ROOT}"
  /bin/launchctl setenv OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT "${ARTIFACT_ROOT}"
  /bin/launchctl setenv OPENREAPER_LIVE_BRIDGE_OWNER "${BRIDGE_OWNER}"
  /bin/launchctl setenv OPENREAPER_LIVE_BRIDGE_GENERATION "${BRIDGE_GENERATION}"
}

restore_launchservices_env() {
  restore_launchservices_env_key OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR
  restore_launchservices_env_key OPENREAPER_LIVE_BRIDGE_SCRIPT_PATH
  restore_launchservices_env_key OPENREAPER_ARTIFACT_ROOT
  restore_launchservices_env_key OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT
  restore_launchservices_env_key OPENREAPER_LIVE_BRIDGE_OWNER
  restore_launchservices_env_key OPENREAPER_LIVE_BRIDGE_GENERATION
}

restore_launchservices_env_key() {
  local key="$1"
  local previous_file="${SESSION_ROOT}/launchd-env.${key}.previous"
  local previous=""
  if [[ -f "${previous_file}" ]]; then
    previous="$(cat "${previous_file}")"
  fi
  if [[ -n "${previous}" ]]; then
    /bin/launchctl setenv "${key}" "${previous}" || true
  else
    /bin/launchctl unsetenv "${key}" || true
  fi
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

launch_reaper
wait_for_reaper_process
echo "[OpenReaper] startup-dialog-assist-result=$(run_startup_dialog_assist)"

echo "[OpenReaper] startup-status=ready"
echo "[OpenReaper] bridge-status=waiting_for_reaper_action"
