import { createHash } from "node:crypto";
import { access, readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";

export const MEDIA_EXPLORER_DATABASE_SEARCH_CAPABILITY = "media_explorer_database_search.v1";

const DATABASE_SUFFIX = ".ReaperFileList";
const CURSOR_VERSION = 1;
const MEDIA_FILE_REF_PREFIX = "file:path:";

export async function searchMediaExplorerDatabases({
  resourcePath,
  query,
  databaseIds = [],
  pageSize = 10,
  cursor = null,
} = {}) {
  if (!safeAbsolutePath(resourcePath)) return failed("MEDIA_LIBRARY_RESOURCE_PATH_INVALID", "REAPER did not return a safe absolute resource path.");
  const normalizedQuery = normalizeText(query);
  const tokens = normalizedQuery.split(/\s+/u).filter(Boolean);
  if (tokens.length === 0) return failed("MEDIA_LIBRARY_QUERY_REQUIRED", "search_library requires a non-empty query.");

  const requestedIds = uniqueStrings(databaseIds.map((value) => String(value).trim()).filter(Boolean));
  const databaseDir = path.join(resourcePath, "MediaDB");
  let names;
  try {
    names = (await readdir(databaseDir)).filter((name) => name.endsWith(DATABASE_SUFFIX)).sort((left, right) => left.localeCompare(right, "en"));
  } catch (error) {
    return failed("MEDIA_LIBRARY_DATABASE_DIRECTORY_UNAVAILABLE", `REAPER Media Explorer database directory is unavailable: ${error?.message ?? "read failed"}.`);
  }
  if (names.length === 0) return failed("MEDIA_LIBRARY_DATABASES_EMPTY", "REAPER Media Explorer has no .ReaperFileList databases.");

  const labels = await readDatabaseLabels(resourcePath);
  const selected = selectDatabases(names, labels, requestedIds);
  if (!selected.ok) return selected;
  const queryHash = digest(JSON.stringify({ query: normalizedQuery, databases: selected.databases.map((entry) => entry.id) }));
  const decodedCursor = decodeCursor(cursor);
  if (!decodedCursor.ok) return decodedCursor;
  if (decodedCursor.value && decodedCursor.value.query_hash !== queryHash) {
    return failed("MEDIA_LIBRARY_CURSOR_QUERY_MISMATCH", "The search cursor belongs to a different query or database selection; restart from the first page.");
  }
  const offset = decodedCursor.value?.offset ?? 0;
  const collectLimit = Math.max(1, Math.min(25, pageSize));
  const matches = [];
  const databaseSummaries = [];
  const snapshotRows = [];
  let total = 0;

  for (const database of selected.databases) {
    const databasePath = path.join(databaseDir, database.id);
    let buffer;
    let facts;
    try {
      [buffer, facts] = await Promise.all([readFile(databasePath), stat(databasePath)]);
    } catch (error) {
      return failed("MEDIA_LIBRARY_DATABASE_READ_FAILED", `Could not read Media Explorer database ${database.id}: ${error?.message ?? "read failed"}.`);
    }
    const sha256 = digest(buffer);
    snapshotRows.push({ id: database.id, size: facts.size, mtime_ms: Math.trunc(facts.mtimeMs), sha256 });
    const databaseStartTotal = total;
    scanDatabase(buffer.toString("utf8"), tokens, (row) => {
      if (total >= offset && matches.length < collectLimit) matches.push({ ...row, database_id: database.id, database_label: database.label });
      total += 1;
    });
    databaseSummaries.push({ database_id: database.id, database_label: database.label, match_count: total - databaseStartTotal });
  }

  const snapshot = digest(JSON.stringify(snapshotRows));
  if (decodedCursor.value && decodedCursor.value.snapshot !== snapshot) {
    return failed("MEDIA_LIBRARY_CURSOR_STALE", "The REAPER Media Explorer database changed after this cursor was issued; restart from the first page.");
  }
  const availableRows = await Promise.all(matches.map(async (row) => ({
    ...row,
    available: await pathAvailable(row.path),
  })));

  return {
    ok: true,
    query: String(query).trim(),
    normalized_query: normalizedQuery,
    query_hash: queryHash,
    snapshot,
    offset,
    requested_page_size: collectLimit,
    total,
    results: availableRows,
    databases: databaseSummaries,
  };
}

export function projectMediaExplorerSearchPage(search, resultCount = search?.results?.length ?? 0) {
  const rows = Array.isArray(search?.results) ? search.results.slice(0, Math.max(0, resultCount)) : [];
  const nextOffset = (search?.offset ?? 0) + rows.length;
  const hasMore = nextOffset < (search?.total ?? 0);
  return {
    query: search.query,
    results: rows,
    page: {
      offset: search.offset,
      returned: rows.length,
      requested_page_size: search.requested_page_size,
      total: search.total,
      has_more: hasMore,
      next_cursor: hasMore ? encodeCursor({
        v: CURSOR_VERSION,
        query_hash: search.query_hash,
        snapshot: search.snapshot,
        offset: nextOffset,
      }) : null,
    },
    databases: search.databases,
  };
}

function scanDatabase(text, tokens, onMatch) {
  let current = null;
  let lineStart = 0;
  const finish = () => {
    if (!current) return;
    const haystack = normalizeText(`${current.path} ${current.metadata}`);
    if (tokens.every((token) => haystack.includes(token))) onMatch(projectRow(current));
  };
  while (lineStart <= text.length) {
    let lineEnd = text.indexOf("\n", lineStart);
    if (lineEnd < 0) lineEnd = text.length;
    const line = text.slice(lineStart, lineEnd).replace(/\r$/u, "");
    if (line.startsWith("FILE ")) {
      finish();
      current = parseFileLine(line);
    } else if (current && line.startsWith("DATA ")) {
      current.metadata += ` ${line.slice(5)}`;
      applyDataFacts(current, line.slice(5));
    }
    if (lineEnd === text.length) break;
    lineStart = lineEnd + 1;
  }
  finish();
}

function parseFileLine(line) {
  const quoted = readQuoted(line, 5);
  if (!quoted || !safeAbsolutePath(quoted.value)) return null;
  const fields = line.slice(quoted.end).trim().split(/\s+/u);
  return {
    path: quoted.value,
    filename: mediaPathBasename(quoted.value),
    size_bytes: integerOrNull(fields[0]),
    duration_seconds: null,
    sample_rate_hz: null,
    channels: null,
    bit_depth: null,
    metadata: "",
  };
}

function fileRefForPath(pathValue) {
  return `${MEDIA_FILE_REF_PREFIX}${pathValue}`;
}

function applyDataFacts(row, data) {
  for (const token of data.split(/\s+/u)) {
    const separator = token.indexOf(":");
    if (separator < 1) continue;
    const key = token.slice(0, separator);
    const value = token.slice(separator + 1);
    if (key === "s") row.sample_rate_hz = integerOrNull(value);
    else if (key === "n") row.channels = integerOrNull(value);
    else if (key === "i") row.bit_depth = integerOrNull(value);
    else if (key === "l") row.duration_seconds = durationSeconds(value);
  }
}

function projectRow(row) {
  return {
    path: row.path,
    file_ref: fileRefForPath(row.path),
    filename: row.filename,
    duration_seconds: row.duration_seconds,
    sample_rate_hz: row.sample_rate_hz,
    channels: row.channels,
    bit_depth: row.bit_depth,
    size_bytes: row.size_bytes,
  };
}

async function readDatabaseLabels(resourcePath) {
  let source = "";
  try { source = await readFile(path.join(resourcePath, "reaper.ini"), "utf8"); } catch {}
  const ids = new Map();
  const labels = new Map();
  for (const line of source.split(/\r?\n/u)) {
    let match = /^Shortcut([^=]+)=(.+)$/u.exec(line);
    if (match) ids.set(match[1], match[2].trim());
    match = /^ShortcutT([^=]+)=(.*)$/u.exec(line);
    if (match) labels.set(match[1], match[2].trim());
  }
  const result = new Map();
  for (const [slot, id] of ids) if (id.endsWith(DATABASE_SUFFIX)) result.set(id, labels.get(slot) || id.replace(new RegExp(`${escapeRegExp(DATABASE_SUFFIX)}$`, "u"), ""));
  return result;
}

function selectDatabases(names, labels, requestedIds) {
  const all = names.map((id) => ({ id, label: labels.get(id) ?? id.replace(new RegExp(`${escapeRegExp(DATABASE_SUFFIX)}$`, "u"), "") }));
  if (requestedIds.length === 0) return { ok: true, databases: all };
  const selected = [];
  for (const requested of requestedIds) {
    const normalized = normalizeText(requested);
    const match = all.find((entry) => normalizeText(entry.id) === normalized || normalizeText(entry.label) === normalized);
    if (!match) return failed("MEDIA_LIBRARY_DATABASE_NOT_FOUND", `Media Explorer database ${requested} was not found in the active REAPER resource path.`);
    if (!selected.some((entry) => entry.id === match.id)) selected.push(match);
  }
  selected.sort((left, right) => left.id.localeCompare(right.id, "en"));
  return { ok: true, databases: selected };
}

function readQuoted(source, start) {
  if (source[start] !== '"') return null;
  let value = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (character === '"') {
      if (source[index + 1] === '"') { value += '"'; index += 1; continue; }
      return { value, end: index + 1 };
    }
    if (character === "\\" && source[index + 1] === '"') { value += '"'; index += 1; continue; }
    value += character;
  }
  return null;
}

function durationSeconds(value) {
  const parts = value.split(":").map(Number);
  if (parts.length < 2 || parts.some((part) => !Number.isFinite(part) || part < 0)) return null;
  return parts.reduce((total, part) => total * 60 + part, 0);
}

function decodeCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return { ok: true, value: null };
  if (typeof cursor !== "string" || cursor.length > 2_048) return failed("MEDIA_LIBRARY_CURSOR_INVALID", "The search cursor is invalid.");
  try {
    const value = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (value?.v !== CURSOR_VERSION || typeof value.query_hash !== "string" || typeof value.snapshot !== "string" || !Number.isInteger(value.offset) || value.offset < 0) throw new Error("shape");
    return { ok: true, value };
  } catch {
    return failed("MEDIA_LIBRARY_CURSOR_INVALID", "The search cursor is invalid; restart from the first page.");
  }
}

function encodeCursor(value) { return Buffer.from(JSON.stringify(value), "utf8").toString("base64url"); }
function normalizeText(value) { return String(value ?? "").normalize("NFKC").toLocaleLowerCase("en-US").trim(); }
function digest(value) { return createHash("sha256").update(value).digest("hex"); }
async function pathAvailable(value) { try { await access(value); return true; } catch { return false; } }
function integerOrNull(value) { const number = Number(value); return Number.isSafeInteger(number) && number >= 0 ? number : null; }
function uniqueStrings(values) { return [...new Set(values)]; }
function isAbsoluteMediaPath(value) {
  if (typeof value !== "string" || value === "") return false;
  if (value.includes("\0")) return false;
  if (value.startsWith("/")) return true;
  if (/^[a-zA-Z]:[\\/]/.test(value)) return true;
  if (/^\\\\[^\\/]+[\\/][^\\/]+/.test(value)) return true;
  return false;
}
function safeAbsolutePath(value) {
  if (typeof value !== "string") return false;
  if (!isAbsoluteMediaPath(value)) return false;
  if (/^[\\/]{2}[?.][\\/]/u.test(value)) return false;
  if (value.startsWith("/") && /^\/(dev|Volumes\/Hardware|System\/Volumes\/Data\/dev)(\/|$)/u.test(value)) return false;
  if (/^[a-z][a-z0-9+.-]*:/iu.test(value) && !/^[a-zA-Z]:[\\/]/u.test(value)) return false;
  return true;
}
function mediaPathBasename(value) {
  const posixStyle = value.startsWith("/");
  const normalized = posixStyle ? value.replace(/\/+$/u, "") : value.replace(/[\\/]+$/u, "");
  const separator = posixStyle
    ? normalized.lastIndexOf("/")
    : Math.max(normalized.lastIndexOf("/"), normalized.lastIndexOf("\\"));
  return normalized.slice(separator + 1);
}
function escapeRegExp(value) { return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"); }
function failed(code, message) { return { ok: false, code, message, blockers: [{ code, message, recoverable: true }] }; }
