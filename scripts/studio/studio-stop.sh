#!/bin/zsh
set -euo pipefail

ROOT="${0:A:h}"

if ! command -v node >/dev/null 2>&1; then
  echo "[OpenReaper Studio] Node.js 20+ is required on PATH." >&2
  exit 1
fi

exec node "${ROOT}/studio-orchestrate.mjs" stop "$@"
