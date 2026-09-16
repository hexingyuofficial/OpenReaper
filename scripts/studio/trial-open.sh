#!/bin/zsh
# OpenReaper Studio — acceptance handoff: bring REAPER to a tryable state.
#
# **Where to run:** Zhuanz1.local (Mac) only — not for Linux CI.
# **NAS paths:** Trial logs, READY marker, and optional acceptance project live under
#   STUDIO_ROOT (default `/Volumes/NAS/coding/openreaper-studio`), not in GitHub.
# **Repo:** Script is versioned at `scripts/studio/trial-open.sh` in hexingyuofficial/OpenReaper.
#
# Run before telling the user "可以试用了". See docs/studio/engineering/ACCEPTANCE_HANDOFF.md.
set -euo pipefail

REAPER_APP="${REAPER_APP:-/Applications/REAPER.app}"
STUDIO_ROOT="${STUDIO_ROOT:-/Volumes/NAS/coding/openreaper-studio}"
REPO_ROOT="${REPO_ROOT:-/Users/Zhuanz/Documents/openreaper}"
TRIAL_RPP="${TRIAL_RPP:-$STUDIO_ROOT/engineering/trial/Studio-Acceptance.rpp}"
LOG_DIR="$STUDIO_ROOT/engineering/trial/logs"
mkdir -p "$LOG_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
LOG="$LOG_DIR/trial-open-$STAMP.log"

exec > >(tee -a "$LOG") 2>&1
echo "[trial-open] $(date '+%Y-%m-%d %H:%M:%S %z')"
echo "[trial-open] host=$(hostname) user=$(whoami)"

if [[ ! -d "$REAPER_APP" ]]; then
  echo "[trial-open] FAIL: REAPER not found at $REAPER_APP"
  exit 1
fi

# Prefer Studio one-click start when it exists; else open REAPER (+ optional project).
START_CANDIDATES=(
  "$REPO_ROOT/scripts/studio/studio-start.sh"
  "$REPO_ROOT/scripts/studio-start.sh"
  "$REPO_ROOT/scripts/openreaper-studio-start.sh"
  "$STUDIO_ROOT/scripts/studio-start.sh"
)

STARTED=0
for s in "${START_CANDIDATES[@]}"; do
  if [[ -x "$s" ]]; then
    echo "[trial-open] using start script: $s"
    "$s" || echo "[trial-open] WARN: start script exited $?"
    STARTED=1
    break
  fi
done

if [[ "$STARTED" -eq 0 ]]; then
  echo "[trial-open] no studio-start yet — opening REAPER directly"
  if [[ -f "$TRIAL_RPP" ]]; then
    echo "[trial-open] opening project: $TRIAL_RPP"
    open -a "$REAPER_APP" "$TRIAL_RPP"
  else
    open -a "$REAPER_APP"
  fi
fi

# Bring REAPER to front
sleep 1
osascript <<'APPLESCRIPT' || true
tell application "REAPER" to activate
APPLESCRIPT

# Marker file for the assistant: handoff is ready (on NAS workspace)
READY="$STUDIO_ROOT/engineering/trial/READY"
mkdir -p "$(dirname "$READY")"
cat > "$READY" <<META
opened_at=$(date -Iseconds)
host=$(hostname)
reaper=$REAPER_APP
project=${TRIAL_RPP:-none}
log=$LOG
repo=$REPO_ROOT
META
echo "[trial-open] READY written: $READY"
echo "[trial-open] OK — user can remote in and try"
