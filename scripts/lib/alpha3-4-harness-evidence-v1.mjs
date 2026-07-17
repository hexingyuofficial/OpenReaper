import { createHash } from "node:crypto";
import { mkdir, open, readFile, rename, stat } from "node:fs/promises";
import path from "node:path";

export const HARNESS_EVIDENCE_CONTRACT = "openreaper.alpha3.4.harness_evidence.v1";
export const HARNESS_EVENT_CONTRACT = "openreaper.alpha3.4.harness_event.v1";
export const HARNESS_VIEW_CONTRACT = "openreaper.alpha3.4.harness_view.v1";
export const EVIDENCE_EVENT_LINE_MAX_BYTES = 8 * 1024;
export const EVIDENCE_SUMMARY_MAX_BYTES = 64 * 1024;
export const EVIDENCE_PATHS = Object.freeze({
  summary: "reports/summary.json",
  events: "events/events.jsonl",
  artifactDirectory: "artifacts/harness",
});

export class HarnessEvidenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = "HarnessEvidenceError";
    this.code = code;
    this.details = details;
  }
}

export function evidenceError(code, message, details = null) {
  return new HarnessEvidenceError(code, message, details);
}

export async function createEvidenceJournal({ evidenceRoot, provenance = {} } = {}) {
  const root = await createFreshEvidenceRoot(evidenceRoot);
  return new EvidenceJournal({ root, provenance });
}

export const createHarnessEvidenceJournal = createEvidenceJournal;

export async function createFreshEvidenceRoot(evidenceRoot) {
  assertAbsolutePath(evidenceRoot, "EVIDENCE_ROOT_INVALID", "evidenceRoot must be an absolute path.");
  const root = path.resolve(evidenceRoot);
  try {
    await stat(root);
    throw evidenceError("EVIDENCE_ROOT_NOT_FRESH", "Evidence root already exists; execution requires a fresh root.", { evidence_root: root });
  } catch (error) {
    if (error instanceof HarnessEvidenceError) throw error;
    if (error?.code !== "ENOENT") throw evidenceError("EVIDENCE_ROOT_UNAVAILABLE", "Evidence root could not be inspected.", { evidence_root: root, cause: boundedError(error) });
  }
  try {
    await mkdir(root, { recursive: false });
    await mkdir(path.join(root, "reports"), { recursive: false });
    await mkdir(path.join(root, "events"), { recursive: false });
    await mkdir(path.join(root, EVIDENCE_PATHS.artifactDirectory), { recursive: true });
    await createEmptyJournalFile(path.join(root, EVIDENCE_PATHS.events));
  } catch (error) {
    throw error instanceof HarnessEvidenceError
      ? error
      : evidenceError(error?.code === "EEXIST" ? "EVIDENCE_ROOT_NOT_FRESH" : "EVIDENCE_ROOT_INIT_FAILED", "Evidence root initialization failed.", { evidence_root: root, cause: boundedError(error) });
  }
  return root;
}

export class EvidenceJournal {
  constructor({ root, provenance = {} } = {}) {
    assertAbsolutePath(root, "EVIDENCE_ROOT_INVALID", "Evidence root must be an absolute path.");
    this.root = path.resolve(root);
    this.provenance = compactObject(provenance, 24);
    this.sequence = 0;
    this.artifacts = [];
    this.events = [];
    this._tail = Promise.resolve();
    this._finalized = false;
  }

  get paths() {
    return Object.freeze({
      evidence_root: this.root,
      summary_path: path.join(this.root, EVIDENCE_PATHS.summary),
      events_path: path.join(this.root, EVIDENCE_PATHS.events),
      summary_relative_path: EVIDENCE_PATHS.summary,
      events_relative_path: EVIDENCE_PATHS.events,
    });
  }

  setProvenance(provenance = {}) {
    this.provenance = compactObject({ ...this.provenance, ...provenance }, 24);
  }

  async recordCall(call = {}) {
    return this._enqueue(async () => {
      if (this._finalized) throw evidenceError("EVIDENCE_ALREADY_FINALIZED", "Cannot append a call after summary finalization.");
      const sequence = ++this.sequence;
      const eventId = `event-${String(sequence).padStart(6, "0")}`;
      const requestArtifact = await this._writeArtifact(`${eventId}-request.json`, call.request ?? null, "request");
      const responseArtifact = await this._writeArtifact(`${eventId}-response.json`, call.response ?? call.value ?? { error: call.error ?? null }, "response");
      const event = compactEvent({
        type: "call",
        sequence,
        id: eventId,
        scenario: call.scenario ?? null,
        stage: call.stage ?? call.step_id ?? call.step ?? null,
        step: call.step_id ?? call.step ?? null,
        client: call.client ?? null,
        tool: call.tool ?? null,
        requested_id: call.requested_id ?? call.request?.id ?? null,
        budget: call.request_budget ?? call.request?.budget ?? null,
        duration_ms: call.duration_ms,
        status: call.expected_failure ? "expected_failure" : call.ok === true ? "success" : "failure",
        ok: call.ok === true,
        expected_failure: call.expected_failure === true,
        response_bytes: call.response_bytes ?? 0,
        actual_bytes: call.actual_bytes ?? null,
        truncated: call.truncated ?? null,
        artifact_fallback: call.artifact_fallback ?? null,
        artifacts: { request: requestArtifact, response: responseArtifact },
        error: compactError(call.error),
        readback: compactReadback(call.value),
      });
      await this._appendEvent(event);
      return event;
    });
  }

  async recordStage(stage = {}) {
    return this._enqueue(async () => {
      if (this._finalized) throw evidenceError("EVIDENCE_ALREADY_FINALIZED", "Cannot append a stage after summary finalization.");
      const sequence = ++this.sequence;
      const event = compactEvent({
        type: "stage",
        sequence,
        id: `event-${String(sequence).padStart(6, "0")}`,
        scenario: stage.scenario ?? null,
        stage: stage.stage ?? stage.step_id ?? stage.step ?? null,
        step: stage.step_id ?? stage.step ?? null,
        duration_ms: stage.duration_ms,
        status: stage.status ?? (stage.ok === true ? "success" : "failure"),
        ok: stage.ok === true,
        expected_failure: stage.expected_failure === true,
        error: compactError(stage.error),
        details: compactObject(stage.details ?? {}, 12),
      });
      await this._appendEvent(event);
      return event;
    });
  }

  async record(event = {}) {
    return event.type === "stage" ? this.recordStage(event) : this.recordCall(event);
  }

  async finalize(report = {}) {
    return this._enqueue(async () => {
      if (this._finalized) return this.summary;
      const summary = buildSummary({ report, journal: this });
      const serialized = `${JSON.stringify(summary)}\n`;
      const bytes = Buffer.byteLength(serialized, "utf8");
      if (bytes > EVIDENCE_SUMMARY_MAX_BYTES) {
        throw evidenceError("EVIDENCE_SUMMARY_TOO_LARGE", "Evidence summary exceeded the summary byte limit.", { bytes, limit: EVIDENCE_SUMMARY_MAX_BYTES });
      }
      await atomicWrite(path.join(this.root, EVIDENCE_PATHS.summary), serialized, "summary");
      this.summary = summary;
      this._finalized = true;
      return summary;
    });
  }
}

export async function viewEvidence({ evidenceRoot, section = "events", status = null, step = null, cursor = null, limit = 20 } = {}) {
  const root = resolveEvidenceRoot(evidenceRoot);
  const boundedLimit = parseLimit(limit);
  const selectedSection = parseSection(section);
  const summary = selectedSection === "summary" ? await loadSummary(root) : null;
  const events = selectedSection === "summary" ? [] : await loadEvents(root, { verifyArtifacts: false });
  let items;
  if (selectedSection === "summary") items = [summary];
  else if (selectedSection === "events") items = events;
  else if (selectedSection === "calls") items = events.filter((event) => event.type === "call");
  else items = buildStages(events);
  if (status !== null) {
    if (typeof status !== "string" || status.length === 0) throw evidenceError("EVIDENCE_STATUS_INVALID", "status must be a non-empty string when supplied.");
    items = items.filter((item) => item.status === status);
  }
  if (step !== null) {
    if (typeof step !== "string" || step.length === 0) throw evidenceError("EVIDENCE_STEP_INVALID", "step must be a non-empty string when supplied.");
    items = items.filter((item) => item.step === step || item.stage === step || item.step_id === step);
  }
  const total = items.length;
  const cursorSequence = parseCursor(cursor);
  if (cursorSequence !== null) {
    items = items.filter((item) => Number.isInteger(item.sequence) && item.sequence > cursorSequence);
  }
  const page = items.slice(0, boundedLimit);
  if (selectedSection === "events" || selectedSection === "calls") {
    for (const event of page) await verifyEventArtifacts(root, event);
  }
  const hasMore = page.length < items.length;
  const last = page.at(-1);
  return {
    contract: HARNESS_VIEW_CONTRACT,
    type: "alpha3.4_harness_view",
    ok: true,
    section: selectedSection,
    items: page,
    total,
    has_more: hasMore,
    next_cursor: hasMore && Number.isInteger(last?.sequence) ? `seq:${last.sequence}` : null,
    source_path: selectedSection === "summary" ? EVIDENCE_PATHS.summary : EVIDENCE_PATHS.events,
  };
}

export async function readEvidenceSummary(evidenceRoot) {
  return loadSummary(resolveEvidenceRoot(evidenceRoot));
}

export async function readEvidenceEvents(evidenceRoot) {
  return loadEvents(resolveEvidenceRoot(evidenceRoot), { verifyArtifacts: true });
}

EvidenceJournal.prototype._writeArtifact = async function writeArtifact(fileName, value, kind) {
  const relativePath = `${EVIDENCE_PATHS.artifactDirectory}/${fileName}`;
  const absolutePath = path.join(this.root, relativePath);
  const serialized = `${JSON.stringify(jsonSafe(value))}\n`;
  const metadata = {
    path: relativePath,
    kind,
    sha256: createHash("sha256").update(serialized, "utf8").digest("hex"),
    bytes: Buffer.byteLength(serialized, "utf8"),
    encoding: "utf8",
  };
  await atomicWrite(absolutePath, serialized, "artifact");
  this.artifacts.push(metadata);
  return metadata;
};

EvidenceJournal.prototype._enqueue = function enqueue(task) {
  const next = this._tail.then(task, task);
  this._tail = next.catch(() => {});
  return next;
};

EvidenceJournal.prototype._appendEvent = async function appendEvent(event) {
  const line = `${JSON.stringify(event)}\n`;
  const bytes = Buffer.byteLength(line, "utf8");
  if (bytes > EVIDENCE_EVENT_LINE_MAX_BYTES) {
    throw evidenceError("EVIDENCE_EVENT_LINE_TOO_LARGE", "Evidence event exceeded the single-line limit.", { sequence: event.sequence, bytes, limit: EVIDENCE_EVENT_LINE_MAX_BYTES });
  }
  await appendAndSync(path.join(this.root, EVIDENCE_PATHS.events), line);
  this.events.push(event);
};

async function loadEvents(root, { verifyArtifacts = true } = {}) {
  const relativePath = EVIDENCE_PATHS.events;
  const absolutePath = path.join(root, relativePath);
  let contents;
  try {
    contents = await readFile(absolutePath, "utf8");
  } catch (error) {
    throw evidenceError(error?.code === "ENOENT" ? "EVIDENCE_EVENTS_MISSING" : "EVIDENCE_EVENTS_UNREADABLE", "Evidence events file could not be read.", { source_path: relativePath, cause: boundedError(error) });
  }
  const events = [];
  const lines = contents.split("\n");
  if (lines.at(-1) === "") lines.pop();
  let previousSequence = 0;
  for (const [index, line] of lines.entries()) {
    const lineBytes = Buffer.byteLength(line, "utf8") + 1;
    if (lineBytes > EVIDENCE_EVENT_LINE_MAX_BYTES) throw evidenceError("EVIDENCE_EVENT_LINE_TOO_LARGE", "Evidence events contain an overlong line.", { line: index + 1, bytes: lineBytes, limit: EVIDENCE_EVENT_LINE_MAX_BYTES });
    let event;
    try {
      event = JSON.parse(line);
    } catch (error) {
      throw evidenceError("EVIDENCE_EVENTS_CORRUPT", "Evidence events contain invalid JSONL.", { line: index + 1, cause: boundedError(error) });
    }
    if (!event || typeof event !== "object" || event.contract !== HARNESS_EVENT_CONTRACT || !Number.isInteger(event.sequence) || event.sequence <= previousSequence) {
      throw evidenceError("EVIDENCE_EVENTS_CORRUPT", "Evidence events contain an invalid or non-monotonic event.", { line: index + 1 });
    }
    previousSequence = event.sequence;
    if (verifyArtifacts) await verifyEventArtifacts(root, event);
    events.push(event);
  }
  return events;
}

async function loadSummary(root) {
  const relativePath = EVIDENCE_PATHS.summary;
  let contents;
  try {
    contents = await readFile(path.join(root, relativePath), "utf8");
  } catch (error) {
    throw evidenceError(error?.code === "ENOENT" ? "EVIDENCE_SUMMARY_MISSING" : "EVIDENCE_SUMMARY_UNREADABLE", "Evidence summary could not be read.", { source_path: relativePath, cause: boundedError(error) });
  }
  try {
    const summary = JSON.parse(contents);
    if (!summary || typeof summary !== "object" || summary.contract !== HARNESS_EVIDENCE_CONTRACT) throw new Error("summary contract mismatch");
    return summary;
  } catch (error) {
    throw evidenceError("EVIDENCE_SUMMARY_CORRUPT", "Evidence summary is not valid journal JSON.", { source_path: relativePath, cause: boundedError(error) });
  }
}

async function verifyEventArtifacts(root, event) {
  const candidates = [];
  if (event.artifacts && typeof event.artifacts === "object") candidates.push(...Object.values(event.artifacts));
  if (Array.isArray(event.artifact_paths)) candidates.push(...event.artifact_paths);
  for (const artifact of candidates) {
    if (!artifact || typeof artifact !== "object" || typeof artifact.path !== "string") throw evidenceError("EVIDENCE_ARTIFACT_METADATA_INVALID", "Evidence event contains invalid artifact metadata.", { sequence: event.sequence });
    const relative = validateRelativeEvidencePath(artifact.path);
    let bytes;
    try {
      bytes = await readFile(path.join(root, relative));
    } catch (error) {
      throw evidenceError(error?.code === "ENOENT" ? "EVIDENCE_ARTIFACT_MISSING" : "EVIDENCE_ARTIFACT_UNREADABLE", "Referenced evidence artifact could not be read.", { path: relative, sequence: event.sequence, cause: boundedError(error) });
    }
    const actualHash = createHash("sha256").update(bytes).digest("hex");
    if (actualHash !== artifact.sha256 || bytes.byteLength !== artifact.bytes) throw evidenceError("EVIDENCE_ARTIFACT_HASH_MISMATCH", "Referenced evidence artifact hash or byte count does not match.", { path: relative, sequence: event.sequence, expected_sha256: artifact.sha256, actual_sha256: actualHash, expected_bytes: artifact.bytes, actual_bytes: bytes.byteLength });
  }
}

function buildStages(events) {
  const groups = new Map();
  for (const event of events) {
    const key = event.stage ?? event.step ?? "unattributed";
    const group = groups.get(key) ?? { sequence: event.sequence, stage: key, step: event.step ?? null, status: event.status, event_count: 0, first_sequence: event.sequence, last_sequence: event.sequence };
    group.event_count += 1;
    group.last_sequence = event.sequence;
    if (event.status === "failure") group.status = "failure";
    else if (group.status !== "failure" && event.status === "expected_failure") group.status = "expected_failure";
    groups.set(key, group);
  }
  return [...groups.values()].sort((left, right) => left.sequence - right.sequence);
}

function buildSummary({ report, journal }) {
  const events = journal.events;
  const failed = report.failed_calls ?? report.failures ?? events.filter((event) => event.status === "failure");
  const expected = report.expected_failures ?? events.filter((event) => event.status === "expected_failure");
  const responseBytes = report.response_bytes ?? {
    total: events.reduce((sum, event) => sum + Number(event.response_bytes ?? 0), 0),
    maximum_single_call: events.reduce((maximum, event) => Math.max(maximum, Number(event.response_bytes ?? 0)), 0),
  };
  const allArtifacts = journal.artifacts.map((artifact) => ({ path: artifact.path, sha256: artifact.sha256, bytes: artifact.bytes, kind: artifact.kind }));
  const slowest = [...events].sort((left, right) => Number(right.duration_ms ?? 0) - Number(left.duration_ms ?? 0) || left.sequence - right.sequence);
  return {
    contract: HARNESS_EVIDENCE_CONTRACT,
    type: "alpha3.4_harness_evidence_summary",
    provenance: compactObject({ ...journal.provenance, ...(report.provenance ?? {}) }, 24),
    final_status: report.status ?? (report.ok === true ? "completed" : "failed"),
    status: report.status ?? (report.ok === true ? "completed" : "failed"),
    ok: report.ok === true,
    error: compactError(report.error),
    evidence_error: compactError(report.evidence_error),
    duration_ms: Number.isFinite(report.duration_ms) ? report.duration_ms : 0,
    total_duration_ms: Number.isFinite(report.duration_ms) ? report.duration_ms : 0,
    failures: boundedCollection(failed, 32),
    expected_failures: boundedCollection(expected, 32),
    response_bytes: compactObject(responseBytes, 8),
    slowest_steps: boundedCollection(slowest, 16),
    project_changes: boundedCollection(report.project_changes ?? [], 32),
    rendered_outputs: boundedCollection(report.rendered_outputs ?? [], 32),
    source_hashes: compactObject(report.source_hashes ?? {}, 16),
    recovery: compactObject(report.backup_recovery_posture ?? report.recovery_posture ?? {}, 16),
    client_close: compactObject(report.client_close ?? {}, 8),
    events: { path: EVIDENCE_PATHS.events, total: events.length, truncated: false },
    artifacts: { paths: boundedCollection(allArtifacts, 64), total: allArtifacts.length, truncated: allArtifacts.length > 64 },
    paths: { summary: EVIDENCE_PATHS.summary, events: EVIDENCE_PATHS.events, artifact_directory: EVIDENCE_PATHS.artifactDirectory },
  };
}

function compactEvent(input) {
  return {
    contract: HARNESS_EVENT_CONTRACT,
    type: input.type,
    sequence: input.sequence,
    id: input.id,
    scenario: boundedString(input.scenario, 96),
    stage: boundedString(input.stage, 128),
    step: boundedString(input.step, 128),
    client: boundedString(input.client, 64),
    tool: boundedString(input.tool, 96),
    requested_id: boundedString(input.requested_id, 160),
    budget: compactBudget(input.budget),
    duration_ms: boundedNumber(input.duration_ms),
    status: input.status,
    ok: input.ok === true,
    expected_failure: input.expected_failure === true,
    response_bytes: boundedNumber(input.response_bytes),
    actual_bytes: boundedNumber(input.actual_bytes),
    truncated: input.truncated,
    artifact_fallback: input.artifact_fallback,
    artifacts: input.artifacts ?? null,
    error: input.error,
    readback: input.readback ?? null,
    details: input.details ?? null,
  };
}

function compactReadback(value) {
  const result = value?.result ?? {};
  const verification = result?.verification ?? result?.summary?.verification ?? null;
  return compactObject({
    status: value?.ok === true ? "ok" : value?.ok === false ? "failed" : null,
    execution: value?.execution?.status ?? null,
    verification: verification?.status ?? verification ?? null,
    change_count: Array.isArray(result?.changes) ? result.changes.length : null,
    artifact_count: Array.isArray(result?.artifact_refs) ? result.artifact_refs.length : null,
  }, 8);
}

function compactError(error) {
  if (!error) return null;
  return compactObject({
    name: error.name ?? null,
    code: error.code ?? error.cause?.code ?? null,
    message: boundedString(error.message ?? error.cause?.message ?? String(error), 512),
    recoverable: typeof error.recoverable === "boolean" ? error.recoverable : null,
  }, 8);
}

function compactBudget(value) {
  if (!value || typeof value !== "object") return null;
  return compactObject({
    max_response_bytes: value.max_response_bytes,
    max_items: value.max_items,
    max_inline_value_bytes: value.max_inline_value_bytes,
  }, 8);
}

function boundedCollection(values, limit) {
  const array = Array.isArray(values) ? values : [];
  return { items: array.slice(0, limit).map((value) => compactValue(value, 12)), total: array.length, truncated: array.length > limit };
}

function compactObject(value, limit) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return compactValue(value, limit);
  const result = {};
  for (const key of Object.keys(value).sort((left, right) => left.localeCompare(right, "en")).slice(0, limit)) result[key] = compactValue(value[key], limit);
  return result;
}

function compactValue(value, depth = 4) {
  if (depth <= 0) return "[truncated]";
  if (typeof value === "string") return boundedString(value, 512);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) return value.slice(0, 16).map((entry) => compactValue(entry, depth - 1));
  if (typeof value === "object") return compactObject(value, 24);
  return String(value);
}

function jsonSafe(value) {
  try {
    JSON.stringify(value);
    return value;
  } catch (error) {
    return { serialization_error: boundedError(error) };
  }
}

function boundedString(value, max) {
  if (value === null || value === undefined) return null;
  return String(value).replace(/[\u0000-\u001f\u007f]/gu, " ").slice(0, max);
}

function boundedNumber(value) {
  return Number.isFinite(value) ? value : null;
}

function parseSection(section) {
  const allowed = new Set(["summary", "events", "calls", "stages"]);
  if (typeof section !== "string" || !allowed.has(section)) throw evidenceError("EVIDENCE_SECTION_INVALID", "section must be summary, events, calls, or stages.", { section });
  return section;
}

function parseLimit(limit) {
  const number = typeof limit === "string" && /^\d+$/u.test(limit) ? Number(limit) : limit;
  if (!Number.isInteger(number) || number < 1 || number > 100) throw evidenceError("EVIDENCE_LIMIT_INVALID", "limit must be an integer between 1 and 100.", { limit });
  return number;
}

function parseCursor(cursor) {
  if (cursor === null || cursor === undefined || cursor === "") return null;
  if (typeof cursor !== "string" || !/^seq:\d+$/u.test(cursor)) throw evidenceError("EVIDENCE_CURSOR_INVALID", "cursor must use stable seq:<n> syntax.", { cursor });
  const sequence = Number(cursor.slice(4));
  if (!Number.isSafeInteger(sequence)) throw evidenceError("EVIDENCE_CURSOR_INVALID", "cursor sequence is out of range.", { cursor });
  return sequence;
}

function resolveEvidenceRoot(evidenceRoot) {
  assertAbsolutePath(evidenceRoot, "EVIDENCE_ROOT_INVALID", "evidenceRoot must be an absolute path.");
  return path.resolve(evidenceRoot);
}

function validateRelativeEvidencePath(value) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\0") || value.includes("\\") || value.startsWith("/") || value.includes("artifact:")) throw evidenceError("EVIDENCE_PATH_INVALID", "Evidence paths must be ordinary relative paths.", { path: value });
  const normalized = path.posix.normalize(value);
  if (normalized === "." || normalized.startsWith("../") || normalized.includes("/../")) throw evidenceError("EVIDENCE_PATH_INVALID", "Evidence paths must not escape the evidence root.", { path: value });
  return normalized;
}

function assertAbsolutePath(value, code, message) {
  if (typeof value !== "string" || !path.isAbsolute(value)) throw evidenceError(code, message, { value });
}

async function appendAndSync(file, contents) {
  const handle = await open(file, "a");
  try {
    await handle.write(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function createEmptyJournalFile(file) {
  const handle = await open(file, "wx", 0o600);
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function atomicWrite(file, contents, kind) {
  const temporary = `${file}.${process.pid}.${Date.now()}.${kind}.tmp`;
  const handle = await open(temporary, "wx", 0o600);
  try {
    await handle.write(contents, "utf8");
    await handle.sync();
  } finally {
    await handle.close();
  }
  await rename(temporary, file);
}

function boundedError(error) {
  return String(error?.message ?? error).replace(/[\r\n\t]+/gu, " ").slice(0, 256);
}

function serializeError(error) {
  return compactError(error) ?? { name: "Error", code: null, message: "unknown error", recoverable: null };
}

export { serializeError };
