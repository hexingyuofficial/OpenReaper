#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
SERVER_ROOT="${INSTALL_ROOT}/vendor/openreaper-kernel"
SESSION_ROOT="${OPENREAPER_SESSION_ROOT:-${INSTALL_ROOT}/session}"
TRANSPORT_DIR="${OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR:-${SESSION_ROOT}/transport}"

echo "OpenReaper alpha doctor"
echo "install_root=${INSTALL_ROOT}"
echo "node=$(command -v node || true)"
node --version || true
echo "mcp_server=${SERVER_ROOT}/packages/mcp-server/src/openreaper-mcp-stdio.mjs"
test -f "${SERVER_ROOT}/packages/mcp-server/src/openreaper-mcp-stdio.mjs" && echo "mcp_server=ok" || echo "mcp_server=missing"
echo "mcp_sdk=${INSTALL_ROOT}/node_modules/@modelcontextprotocol/sdk"
test -f "${INSTALL_ROOT}/node_modules/@modelcontextprotocol/sdk/package.json" && echo "mcp_sdk=ok" || echo "mcp_sdk=missing"
echo "zod=${INSTALL_ROOT}/node_modules/zod"
test -f "${INSTALL_ROOT}/node_modules/zod/package.json" && echo "zod=ok" || echo "zod=missing"
echo "bridge=${SERVER_ROOT}/reaper/bridge/openreaper-live-bridge.lua"
test -f "${SERVER_ROOT}/reaper/bridge/openreaper-live-bridge.lua" && echo "bridge=ok" || echo "bridge=missing"
echo "transport_dir=${TRANSPORT_DIR}"
mkdir -p "${TRANSPORT_DIR}/requests" "${TRANSPORT_DIR}/results"
echo "transport=ok"
echo "codex_config=${HOME}/.codex/config.toml"
echo "cursor_config=${HOME}/.cursor/mcp.json"
echo "claude_desktop_config=${HOME}/Library/Application Support/Claude/claude_desktop_config.json"
