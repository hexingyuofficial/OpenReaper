#!/bin/zsh
set -euo pipefail

SCRIPT_DIR="${0:A:h}"
INSTALL_ROOT="${SCRIPT_DIR:h}"
SERVER_ROOT="${INSTALL_ROOT}/vendor/openreaper-kernel"
MANAGED_RENDER_ROOT_RECORD="${INSTALL_ROOT}/session/managed-render-root.path"
EFFECTIVE_TRANSPORT_DIR="${OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR:-${INSTALL_ROOT}/session/transport}"
EFFECTIVE_ARTIFACT_ROOT="${OPENREAPER_ARTIFACT_ROOT:-${OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT:-${INSTALL_ROOT}/session/artifacts}}"
EFFECTIVE_LIVE_SMOKE_ARTIFACT_ROOT="${OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT:-${EFFECTIVE_ARTIFACT_ROOT}}"
EFFECTIVE_PROJECT_INDEX_STATE_ROOT="${OPENREAPER_PROJECT_INDEX_STATE_ROOT:-${INSTALL_ROOT}/session/state}"
EFFECTIVE_EXECUTABLE_RECIPE_ROOT="${OPENREAPER_EXECUTABLE_RECIPE_ROOT:-${INSTALL_ROOT:h}/data/executable-recipes}"

if [[ "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" != /* || -L "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" || ( -e "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" && ! -d "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" ) ]]; then
  print -u2 -- "[OpenReaper] executable recipe root must be an absolute non-symlink directory"
  exit 2
fi

select_and_validate_render_root() {
  local selection_mode="installed"
  local selection_value=""
  if (( ${+OPENREAPER_LIVE_SMOKE_RENDER_ROOT} )); then
    selection_mode="explicit"
    selection_value="${OPENREAPER_LIVE_SMOKE_RENDER_ROOT}"
  fi

  node --input-type=module - \
    "${INSTALL_ROOT}" \
    "${HOME}" \
    "${MANAGED_RENDER_ROOT_RECORD}" \
    "${selection_mode}" \
    "${selection_value}" \
    "${EFFECTIVE_TRANSPORT_DIR}" \
    "${EFFECTIVE_ARTIFACT_ROOT}" \
    "${EFFECTIVE_LIVE_SMOKE_ARTIFACT_ROOT}" <<'NODE'
import { constants as fsConstants } from "node:fs";
import { randomBytes } from "node:crypto";
import { lstat, open, realpath, unlink } from "node:fs/promises";
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
  effectiveTransportRoot,
  effectiveArtifactRoot,
  effectiveLiveSmokeArtifactRoot,
] = process.argv.slice(2);
const sessionRoot = path.join(installRoot, "session");
const defaultRoot = path.join(sessionRoot, "renders");

try {
  let candidate;
  if (selectionMode === "explicit") {
    candidate = selectionValue;
  } else {
    const record = await readRecord(recordPath);
    candidate = record.status === "missing" ? defaultRoot : record.path;
  }
  validatePathText(candidate);
  candidate = path.normalize(candidate);
  const status = await safeLstat(candidate);
  if (!status) throw new Error("selected directory does not exist");
  if (status.isSymbolicLink()) throw new Error("final component is a symlink");
  if (!status.isDirectory()) throw new Error("selected path is not a directory");
  await assertNoReservedOverlap(candidate);
  await writeProbe(candidate);
  process.stdout.write(candidate);
} catch (error) {
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
    ["effective live-smoke artifact", effectiveLiveSmokeArtifactRoot],
  ]) {
    if (overlaps(canonical, await canonicalPath(effectiveRoot))) {
      throw new Error(`path overlaps ${label} root`);
    }
  }

  if (canonical === await canonicalPath(defaultRoot)) return;
  for (const [label, reserved] of [
    ["install", installRoot],
    ["session", sessionRoot],
  ]) {
    if (overlaps(canonical, await canonicalPath(reserved))) {
      throw new Error(`path overlaps reserved ${label} root`);
    }
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

if ! OPENREAPER_LIVE_SMOKE_RENDER_ROOT="$(select_and_validate_render_root)"; then
  exit 2
fi
export OPENREAPER_LIVE_SMOKE_RENDER_ROOT
export OPENREAPER_MCP_PACKAGE_ROOT="${INSTALL_ROOT}"
export OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR="${EFFECTIVE_TRANSPORT_DIR}"
export OPENREAPER_ARTIFACT_ROOT="${EFFECTIVE_ARTIFACT_ROOT}"
export OPENREAPER_LIVE_SMOKE_ARTIFACT_ROOT="${EFFECTIVE_LIVE_SMOKE_ARTIFACT_ROOT}"
mkdir -p -- "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}"
if [[ -L "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" || ! -d "${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}" ]]; then
  print -u2 -- "[OpenReaper] executable recipe root could not be safely prepared"
  exit 2
fi
export OPENREAPER_EXECUTABLE_RECIPE_ROOT="${EFFECTIVE_EXECUTABLE_RECIPE_ROOT}"
mkdir -p -- "${EFFECTIVE_PROJECT_INDEX_STATE_ROOT}"
export OPENREAPER_PROJECT_INDEX_STATE_ROOT="${EFFECTIVE_PROJECT_INDEX_STATE_ROOT}"
if [[ -z "${OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY:-}" && -f "${INSTALL_ROOT}/session/reaper.pid" && ! -L "${INSTALL_ROOT}/session/reaper.pid" ]]; then
  REAPER_PID_VALUE="$(<"${INSTALL_ROOT}/session/reaper.pid")"
  if [[ "${REAPER_PID_VALUE}" == <-> ]]; then
    export OPENREAPER_PROJECT_INDEX_LOGICAL_SESSION_KEY="reaper-pid:${REAPER_PID_VALUE}"
  fi
fi

exec node "${SERVER_ROOT}/packages/mcp-server/src/openreaper-mcp-stdio.mjs" "$@"
