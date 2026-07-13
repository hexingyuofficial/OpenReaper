import { createHash, randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import {
  access,
  lstat,
  open as openFile,
  realpath,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createAlpha3C3ProjectIndex,
  openAlpha3C3ProjectIndexSqliteAdapter,
} from "./alpha3-c3-project-index-store-v1.mjs";

export const ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT = "alpha3.2d.project_index_runtime.v1";
export const ALPHA3_2D_PROJECT_INDEX_OBSERVATION_CONTRACT = "alpha3.2d.project_index_observation.v1";
export const ALPHA3_2D_PROJECT_INDEX_DB_BASENAME = "openreaper-project-index.sqlite";
export const ALPHA3_2D_PROJECT_INDEX_MAX_ROWS = 4096;
export const ALPHA3_2D_PROJECT_INDEX_MAX_BYTES = 1_048_576;

export const ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS = Object.freeze([
  "template.project.read_summary",
  "template.project.create_observation_bundle",
  "template.project.create_project_map_snapshot",
  "template.tracks.list_tracks",
  "template.tracks.read_mixer_controls",
  "template.items.list_selected_items",
  "template.items.list_items_on_track",
  "template.items.read_item_summary",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.media.read_take_source",
  "template.routing.read_project_routing_graph",
  "template.automation.list_project_envelopes",
  "template.project.list_markers_regions",
  "template.media.read_project_media_files",
]);

const ARTIFACT_PAYLOAD_TEMPLATE_IDS = new Set([
  "template.project.create_observation_bundle",
  "template.project.create_project_map_snapshot",
]);
const ACCEPTED_TEMPLATE_IDS = new Set(ALPHA3_2D_PROJECT_INDEX_REFRESH_TEMPLATE_IDS);
const PROJECT_INDEX_SCOPE_NAMES = new Set([
  "project_head", "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media",
]);
const PROJECT_REVISION_DEPENDENT_SCOPES = Object.freeze([
  "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media",
]);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const PROCESS_INSTANCE_KEY = `process:${process.pid}:${randomUUID()}`;
const EMPTY_ROWS = Object.freeze({
  tracks: [], items: [], takes: [], fx: [], sends: [], envelopes: [],
  markers_regions: [], media_sources: [], selection_state: [], object_changes: [], background_jobs: [],
});
const LOGICAL_REFRESH_SCOPE_CONFIG = Object.freeze({
  tracks: Object.freeze({
    projection_scope: "tracks",
    store_method: "replaceTracks",
    row_noun: "track",
    row_plural: "tracks",
    declared_count_field: "declared_track_count",
    returned_count_field: "returned_track_count",
    cursor_field: "track_cursor",
    next_cursor_field: "next_track_cursor",
    count_mismatch_code: "LOGICAL_REFRESH_TRACK_COUNT_MISMATCH",
    source_template_id: "template.project.create_observation_bundle",
  }),
  automation: Object.freeze({
    projection_scope: "automation",
    store_method: "replaceEnvelopes",
    row_noun: "envelope",
    row_plural: "envelopes",
    declared_count_field: "declared_envelope_count",
    returned_count_field: "returned_envelope_count",
    cursor_field: "envelope_cursor",
    next_cursor_field: "next_envelope_cursor",
    count_mismatch_code: "LOGICAL_REFRESH_ENVELOPE_COUNT_MISMATCH",
    source_template_id: "template.automation.list_project_envelopes",
  }),
});

export async function openAlpha3_2DProjectIndexRuntime(options = {}) {
  const now = typeof options.now === "function" ? options.now : () => new Date();
  const observedAt = safeIso(options.observed_at, now);
  const pathCheck = await validateManagedStateRoot(options.stateRoot, {
    reservedRoots: options.reservedRoots,
    probeWrites: options.probeWrites !== false,
  });
  if (!pathCheck.ok) {
    return createFailedRuntimeOpen({ observedAt, blockers: pathCheck.blockers, dbPath: pathCheck.db_path });
  }

  const identityCheck = await validateRuntimeIdentity(options, pathCheck.state_root);
  if (!identityCheck.ok) {
    return createFailedRuntimeOpen({ observedAt, blockers: identityCheck.blockers, dbPath: pathCheck.db_path });
  }

  const identity = identityCheck.identity;
  const storageOwnership = deriveRuntimeStorageOwnership(identity, options.logicalSessionKey, options.processIdentity);
  const dbPath = path.join(pathCheck.state_root, storageOwnership.db_basename);
  const ownership = Object.freeze({ ...storageOwnership, db_path: dbPath });
  const dbPathCheck = await validateManagedIndexDbPath(dbPath, pathCheck.state_root);
  if (!dbPathCheck.ok) {
    return createFailedRuntimeOpen({ observedAt, blockers: dbPathCheck.blockers, dbPath, ownership });
  }
  const sessionId = ownership.session_id;
  const adapterOptions = {
    dbPath,
    now,
    observed_at: observedAt,
    projectRef: identity.project_ref,
    bridgeOwner: identity.bridge_owner,
    bridgeGeneration: identity.bridge_generation,
    sessionId,
  };

  let adapter;
  let backend;
  let lifecycle;
  let degradedReason = null;
  let blockers = [];
  let recovery = null;
  const sqliteAvailability = await loadSqliteBackend(options.sqliteModuleLoader);
  if (sqliteAvailability.ok) {
    const sqliteOpen = await openAlpha3C3ProjectIndexSqliteAdapter(adapterOptions);
    if (sqliteOpen.ok && sqliteOpen.adapter) {
      adapter = sqliteOpen.adapter;
      if (adapter.snapshot().lifecycle === "closed") adapter.open(adapterOptions);
      backend = "sqlite_file_adapter";
      lifecycle = adapter.snapshot().lifecycle;
      blockers = sqliteOpen.blockers ?? [];
      if (lifecycle === "stale_session") {
        const rebuilt = await rebuildStaleManagedSqliteAdapter({
          adapter,
          adapterOptions,
          dbPath,
          observedAt,
          identityBlockers: identityBlockersFromSnapshot(adapter.snapshot()),
          ownership,
        });
        recovery = rebuilt.recovery;
        if (rebuilt.ok) {
          adapter = rebuilt.adapter;
          lifecycle = adapter.snapshot().lifecycle;
          blockers = [];
        } else {
          adapter = createAlpha3C3ProjectIndex(adapterOptions);
          backend = "resident_memory_fallback";
          lifecycle = "degraded";
          degradedReason = "SQLITE_STALE_SESSION_RECOVERY_FAILED";
          blockers = rebuilt.blockers;
        }
      }
    } else {
      adapter = createAlpha3C3ProjectIndex(adapterOptions);
      backend = "resident_memory_fallback";
      lifecycle = "degraded";
      degradedReason = sqliteOpen.blockers?.[0]?.code ?? "SQLITE_OPEN_FAILED";
      blockers = sqliteOpen.blockers ?? [];
    }
  } else {
    adapter = createAlpha3C3ProjectIndex(adapterOptions);
    backend = "resident_memory_fallback";
    lifecycle = "degraded";
    degradedReason = "SQLITE_BACKEND_UNAVAILABLE";
    blockers = [sqliteAvailability.blocker];
  }

  return createRuntime({
    adapter,
    backend,
    blockers,
    dbPath,
    degradedReason,
    identity,
    lifecycle,
    now,
    ownership,
    recovery,
    sessionId,
    maxRows: positiveBound(options.maxRows, ALPHA3_2D_PROJECT_INDEX_MAX_ROWS),
    maxBytes: positiveBound(options.maxBytes, ALPHA3_2D_PROJECT_INDEX_MAX_BYTES),
  });
}

async function validateManagedIndexDbPath(dbPath, stateRoot) {
  if (path.dirname(dbPath) !== stateRoot || !path.basename(dbPath).startsWith("openreaper-project-index.") || path.extname(dbPath) !== ".sqlite") {
    return { ok: false, blockers: [blocker("INDEX_DB_PATH_NOT_OWNED", "The Project Index database path must be an owned process-isolated file inside stateRoot.")] };
  }
  try {
    const dbStat = await lstat(dbPath);
    if (dbStat.isSymbolicLink()) return { ok: false, blockers: [blocker("INDEX_DB_SYMLINK", "The managed Project Index database must not be a symlink.")] };
    if (!dbStat.isFile()) return { ok: false, blockers: [blocker("INDEX_DB_NOT_FILE", "The managed Project Index database path must be a regular file when it exists.")] };
    const canonicalDb = await realpath(dbPath);
    if (canonicalDb !== dbPath) return { ok: false, blockers: [blocker("INDEX_DB_NOT_CANONICAL", "The managed Project Index database must not resolve through an alias.")] };
  } catch (error) {
    if (error?.code !== "ENOENT") return { ok: false, blockers: [blocker("INDEX_DB_INSPECTION_FAILED", "The managed Project Index database path could not be inspected.", error)] };
  }
  return { ok: true, blockers: [] };
}

export async function validateManagedStateRoot(stateRoot, options = {}) {
  const blockers = [];
  if (typeof stateRoot !== "string" || stateRoot.length === 0 || stateRoot.includes("\0")) {
    return pathFailure("STATE_ROOT_REQUIRED", "A non-empty absolute stateRoot is required.");
  }
  if (!path.isAbsolute(stateRoot)) {
    return pathFailure("STATE_ROOT_NOT_ABSOLUTE", "stateRoot must be absolute.");
  }
  const normalized = path.normalize(stateRoot);
  if (normalized !== stateRoot) {
    return pathFailure("STATE_ROOT_NOT_CANONICAL", "stateRoot must already be normalized and canonical.");
  }
  let stat;
  let canonical;
  try {
    stat = await lstat(stateRoot);
    canonical = await realpath(stateRoot);
  } catch (error) {
    return pathFailure("STATE_ROOT_NOT_REAL_DIRECTORY", "stateRoot must name an existing real directory.", error);
  }
  if (stat.isSymbolicLink()) blockers.push(blocker("STATE_ROOT_SYMLINK", "stateRoot must not be a symlink."));
  if (!stat.isDirectory()) blockers.push(blocker("STATE_ROOT_NOT_DIRECTORY", "stateRoot must be a directory."));
  if (canonical !== stateRoot) blockers.push(blocker("STATE_ROOT_NOT_CANONICAL", "stateRoot must not resolve through a symlink or path alias.", { canonical }));

  const reservedRoots = [REPO_ROOT, ...(Array.isArray(options.reservedRoots) ? options.reservedRoots : [])]
    .filter((entry) => typeof entry === "string" && path.isAbsolute(entry))
    .map((entry) => path.resolve(entry));
  for (const reserved of reservedRoots) {
    if (pathsOverlap(canonical, reserved)) {
      blockers.push(blocker("STATE_ROOT_RESERVED_OVERLAP", "stateRoot must not overlap a reserved product, repository, bridge, render, or control root.", { reserved_root: reserved }));
    }
  }

  try {
    await access(stateRoot, fsConstants.R_OK | fsConstants.W_OK | fsConstants.X_OK);
  } catch (error) {
    blockers.push(blocker("STATE_ROOT_NOT_WRITABLE", "stateRoot must be readable, writable, and searchable.", error));
  }

  const dbPath = path.join(stateRoot, ALPHA3_2D_PROJECT_INDEX_DB_BASENAME);
  try {
    const dbStat = await lstat(dbPath);
    if (dbStat.isSymbolicLink()) blockers.push(blocker("INDEX_DB_SYMLINK", "The managed Project Index database must not be a symlink."));
    else if (!dbStat.isFile()) blockers.push(blocker("INDEX_DB_NOT_FILE", "The managed Project Index database path must be a regular file when it exists."));
    else {
      const canonicalDb = await realpath(dbPath);
      if (canonicalDb !== dbPath) blockers.push(blocker("INDEX_DB_NOT_CANONICAL", "The managed Project Index database must not resolve through an alias."));
    }
  } catch (error) {
    if (error?.code !== "ENOENT") blockers.push(blocker("INDEX_DB_INSPECTION_FAILED", "The managed Project Index database path could not be inspected.", error));
  }

  if (blockers.length === 0 && options.probeWrites !== false) {
    const probePath = path.join(stateRoot, `.openreaper-index-write-probe-${randomUUID()}`);
    let handle;
    try {
      handle = await openFile(probePath, "wx", 0o600);
      await handle.writeFile("openreaper-project-index-probe\n", "utf8");
    } catch (error) {
      blockers.push(blocker("STATE_ROOT_WRITE_PROBE_FAILED", "stateRoot failed the bounded create/write probe.", error));
    } finally {
      try { await handle?.close(); } catch {}
      try { await unlink(probePath); } catch (error) {
        if (error?.code !== "ENOENT") blockers.push(blocker("STATE_ROOT_PROBE_CLEANUP_FAILED", "stateRoot write probe cleanup failed.", error));
      }
    }
  }

  return blockers.length > 0
    ? { ok: false, state_root: canonical ?? stateRoot, db_path: dbPath, blockers }
    : { ok: true, state_root: canonical, db_path: dbPath, blockers: [] };
}

async function rebuildStaleManagedSqliteAdapter({ adapter, adapterOptions, dbPath, observedAt, identityBlockers, ownership }) {
  const evidence = (status, stage, details = {}) => Object.freeze({
    status,
    stage,
    stale_rows_reused: false,
    observed_at: observedAt,
    identity_blocker_codes: [...new Set(arrayOf(identityBlockers).map((entry) => entry?.code).filter(Boolean))].slice(0, 8),
    ownership_mode: ownership?.mode ?? "unknown",
    database_owner_id: ownership?.owner_id ?? null,
    recovery_scope: ownership?.recovery_scope ?? "unknown",
    peer_database_untouched: true,
    ...details,
  });
  if (ownership?.mode !== "process_isolated" || ownership?.db_path !== dbPath || ownership?.peer_database_unlink_allowed !== false) {
    try { adapter.close({ observed_at: observedAt }); } catch {}
    return {
      ok: false,
      recovery: evidence("failed", "ownership_check"),
      blockers: [blocker("SQLITE_STALE_SESSION_OWNERSHIP_UNVERIFIED", "Stale Project Index recovery refused to remove a database without process-isolated ownership proof.")],
    };
  }
  try {
    adapter.close({ observed_at: observedAt });
  } catch (error) {
    return {
      ok: false,
      recovery: evidence("failed", "close"),
      blockers: [blocker("SQLITE_STALE_SESSION_CLOSE_FAILED", "Stale Project Index adapter could not close before rebuild.", error)],
    };
  }
  const dbPathCheck = await validateManagedIndexDbPath(dbPath, path.dirname(dbPath));
  if (!dbPathCheck.ok) {
    return {
      ok: false,
      recovery: evidence("failed", "owned_path_check"),
      blockers: [blocker("SQLITE_STALE_SESSION_OWNED_PATH_INVALID", "Stale Project Index recovery refused to remove an invalid owned database path.", dbPathCheck.blockers)],
    };
  }
  try {
    await unlink(dbPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      return {
        ok: false,
        recovery: evidence("failed", "remove"),
        blockers: [blocker("SQLITE_STALE_SESSION_REMOVE_FAILED", "Validated managed Project Index database could not be removed for rebuild.", error)],
      };
    }
  }
  const reopened = await openAlpha3C3ProjectIndexSqliteAdapter(adapterOptions);
  if (!reopened.ok || !reopened.adapter || reopened.adapter.snapshot().lifecycle === "stale_session") {
    try { reopened.adapter?.close({ observed_at: observedAt }); } catch {}
    return {
      ok: false,
      recovery: evidence("failed", "reopen"),
      blockers: [
        blocker("SQLITE_STALE_SESSION_REOPEN_FAILED", "Fresh Project Index database could not reopen after stale-session removal."),
        ...arrayOf(reopened.blockers),
      ],
    };
  }
  return {
    ok: true,
    adapter: reopened.adapter,
    recovery: evidence("recovered", "rebuild", { db_rebuilt: true }),
  };
}

function createRuntime({ adapter, backend, blockers, dbPath, degradedReason, identity, lifecycle, now, ownership, recovery, sessionId, maxRows, maxBytes }) {
  let closed = false;
  let managerLifecycle = lifecycle;
  let managerDegradedReason = degradedReason;
  let managerBlockers = [...blockers];
  const pendingArtifacts = new Map();
  const logicalRefreshes = new Map();

  const status = () => {
    const snapshot = guardedSnapshot(adapter.snapshot());
    const stale = snapshot.lifecycle === "stale_session";
    const snapshotEvidence = compactSnapshotEvidence(snapshot, identity.project_ref);
    return Object.freeze({
      contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
      ok: !closed && !stale,
      backend,
      db_path: dbPath,
      lifecycle: closed ? "closed" : stale ? "stale_session" : managerLifecycle,
      adapter_lifecycle: snapshot.lifecycle,
      degraded: managerLifecycle === "degraded" || stale,
      degraded_reason: stale ? "sqlite_session_identity_mismatch" : managerDegradedReason,
      project_ref: identity.project_ref,
      project_path: identity.project_path,
      bridge_owner: identity.bridge_owner,
      bridge_generation: identity.bridge_generation,
      session_id: sessionId,
      session_policy: "deterministic_server_managed_id_for_matching_project_owner_generation_logical_session_and_process_instance",
      ownership,
      snapshot_id: snapshotEvidence.snapshot_id,
      revision: snapshotEvidence.revision,
      freshness_token: snapshotEvidence.freshness_token,
      revision_source: snapshotEvidence.revision_source,
      project_change_count: snapshotEvidence.project_change_count,
      recovery,
      rows_available: !closed && !stale,
      sqlite_rows_are_candidates_only: true,
      sqlite_is_truth: false,
      child_calls_executed: 0,
      logical_refreshes_staged: logicalRefreshes.size,
      row_counts: countSnapshotRows(snapshot),
      blockers: stale ? [...managerBlockers, ...identityBlockersFromSnapshot(adapter.snapshot())] : [...managerBlockers],
    });
  };

  const observe = (execution) => {
    if (closed) return observationFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    const before = adapter.snapshot();
    if (before.lifecycle === "stale_session") return observationFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; old rows are not available and observations are rejected.");
    if (!isObject(execution) || execution.ok !== true) return observationFailure("ignored_unsuccessful_execution", "EXECUTION_NOT_SUCCESSFUL", "Only ok:true template executions may be observed.");
    const templateId = executionTemplateId(execution);
    if (!ACCEPTED_TEMPLATE_IDS.has(templateId)) return observationFailure("unknown_refresh_template", "REFRESH_TEMPLATE_NOT_ACCEPTED", "Execution template is not an accepted Project Index refresh source.", { template_id: templateId });
    const identityResult = validateObservationIdentity(execution, identity, sessionId);
    if (!identityResult.ok) return observationFailure("identity_mismatch", identityResult.code, identityResult.message, identityResult.details);
    if (execution.partial === true || execution.status === "partial" || execution.result?.partial === true || execution.result?.status === "partial") {
      return observationFailure("partial_execution_rejected", "PARTIAL_EXECUTION_REJECTED", "Partial execution envelopes are not stored.");
    }
    const result = isObject(execution.result) ? execution.result : null;
    const readback = result && isObject(result.readback)
      ? result.readback
      : result && isObject(result.summary)
        ? result.summary
        : isObject(execution.readback)
          ? execution.readback
          : null;
    if (!result || !readback || result.error || readback.error) return observationFailure("invalid_readback", "VALIDATED_READBACK_REQUIRED", "A successful execution must contain a validated result.readback or result.summary object.");

    const size = jsonByteLength({ template_id: templateId, readback });
    if (size === null) return observationFailure("invalid_readback", "READBACK_NOT_JSON_SERIALIZABLE", "Readback must be JSON serializable.");
    if (size > maxBytes) return observationFailure("pressure_rejected", "READBACK_BYTES_EXCEEDED", "Readback exceeds the Project Index byte bound.", { bytes: size, max_bytes: maxBytes });
    const executionLogicalRefresh = logicalRefreshContext(execution);
    if (hasLogicalRefreshContext(execution) && !executionLogicalRefresh) {
      return observationFailure("invalid_logical_refresh", "LOGICAL_REFRESH_CONTEXT_INVALID", "project_index_observation_context.logical_refresh must be an object; rows were not stored.");
    }

    const artifactRefs = collectArtifactRefs(result, readback);
    const inlinePayload = isObject(readback.payload) ? readback.payload : isObject(result.artifact_payload) ? result.artifact_payload : null;
    if (ARTIFACT_PAYLOAD_TEMPLATE_IDS.has(templateId) && !inlinePayload) {
      for (const artifactRef of artifactRefs) pendingArtifacts.set(artifactRef, {
        templateId,
        observedAt: observationTime(execution, now),
        logical_refresh: executionLogicalRefresh,
        page_evidence: readback,
      });
      return observationFailure("artifact_payload_required", "ARTIFACT_PAYLOAD_REQUIRED", "This atomic result contains only artifact metadata; validated artifact payload is required before rows can be projected.", { template_id: templateId, artifact_refs: artifactRefs });
    }
    return projectAndApply({ templateId, readback: inlinePayload ?? readback, execution, payloadRef: artifactRefs[0] ?? null });
  };

  const observeArtifactPayload = (input = {}) => {
    if (closed) return observationFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    if (adapter.snapshot().lifecycle === "stale_session") return observationFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; artifact payload is rejected.");
    const artifactRef = typeof input.artifactRef === "string" ? input.artifactRef : typeof input.artifact_ref === "string" ? input.artifact_ref : null;
    const pending = pendingArtifacts.get(artifactRef);
    const templateId = typeof input.templateId === "string" ? input.templateId : typeof input.template_id === "string" ? input.template_id : pending?.templateId;
    if (!ARTIFACT_PAYLOAD_TEMPLATE_IDS.has(templateId)) return observationFailure("unknown_refresh_template", "ARTIFACT_TEMPLATE_NOT_ACCEPTED", "Artifact payload template is not an accepted artifact-backed refresh source.");
    if (!isCanonicalRef(artifactRef, "artifact")) return observationFailure("invalid_artifact_payload", "ARTIFACT_REF_INVALID", "observeArtifactPayload requires a canonical artifact ref.");
    if (!pendingArtifacts.has(artifactRef) && input.allowUnregistered !== true) return observationFailure("invalid_artifact_payload", "ARTIFACT_REF_NOT_PENDING", "Artifact ref was not produced by an observed successful execution in this runtime.");
    if (input.validated !== true) return observationFailure("invalid_artifact_payload", "ARTIFACT_PAYLOAD_NOT_VALIDATED", "Artifact integration must explicitly mark the supplied payload as validated.");
    const identityResult = validateObservationIdentity(input, identity, sessionId);
    if (!identityResult.ok) return observationFailure("identity_mismatch", identityResult.code, identityResult.message, identityResult.details);
    if (!isObject(input.payload)) return observationFailure("invalid_artifact_payload", "ARTIFACT_PAYLOAD_INVALID", "Artifact payload must be a validated object supplied by the artifact integration.");
    const size = jsonByteLength(input.payload);
    if (size === null || size > maxBytes) return observationFailure("pressure_rejected", "READBACK_BYTES_EXCEEDED", "Artifact payload exceeds the Project Index byte bound.", { bytes: size, max_bytes: maxBytes });
    const suppliedObservationContext = isObject(input.project_index_observation_context) ? input.project_index_observation_context : {};
    const pendingLogicalRefresh = isObject(pending?.logical_refresh) ? pending.logical_refresh : null;
    const effectiveInput = pendingLogicalRefresh
      ? {
          ...input,
          project_index_observation_context: {
            ...suppliedObservationContext,
            logical_refresh: isObject(suppliedObservationContext.logical_refresh)
              ? suppliedObservationContext.logical_refresh
              : pendingLogicalRefresh,
          },
          logical_refresh_page_evidence: pending.page_evidence,
        }
      : input;
    const result = projectAndApply({ templateId, readback: input.payload, execution: effectiveInput, payloadRef: artifactRef });
    if (result.ok) pendingArtifacts.delete(artifactRef);
    return result;
  };

  const invalidateScopes = (input = {}) => {
    if (closed) return invalidationFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    if (adapter.snapshot().lifecycle === "stale_session") return invalidationFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; scope invalidation is rejected.");
    if (!isObject(input) || !Array.isArray(input.scopes)) return invalidationFailure("invalid_scopes", "INDEX_SCOPES_REQUIRED", "Scope invalidation requires a non-empty scopes array.");
    const scopes = [...new Set(input.scopes)];
    if (scopes.length === 0 || scopes.some((scope) => typeof scope !== "string" || !PROJECT_INDEX_SCOPE_NAMES.has(scope))) {
      return invalidationFailure("invalid_scopes", "INDEX_SCOPE_UNKNOWN", "Scope invalidation accepts only known Project Index scope names.", { scopes: input.scopes });
    }
    const observedAt = safeIso(input.observed_at, now);
    const before = adapter.snapshot();
    for (const scope of scopes) {
      const current = before.freshness_scopes?.[scope] ?? {};
      const result = adapter.markScopeStale({
        scope_kind: scope,
        scope_ref: current.scope_ref ?? "project",
        snapshot_id: before.snapshot_id,
        coverage_status: current.coverage_status ?? "unknown",
        observed_at: observedAt,
        reason: "known_write_requires_refresh",
      });
      if (result?.ok === false) {
        managerLifecycle = "degraded";
        managerDegradedReason = "SCOPE_INVALIDATION_FAILED";
        managerBlockers = [blocker("SCOPE_INVALIDATION_FAILED", "Project Index could not mark known write scopes stale.", result.blockers?.[0])];
        return invalidationFailure("scope_invalidation_failed", "SCOPE_INVALIDATION_FAILED", "Known write scopes could not be invalidated.");
      }
    }
    const snapshotEvidence = compactSnapshotEvidence(adapter.snapshot(), identity.project_ref);
    return Object.freeze({
      contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
      ok: true,
      status: "scopes_invalidated",
      scopes,
      observed_at: observedAt,
      snapshot_id: snapshotEvidence.snapshot_id,
      revision: snapshotEvidence.revision,
      freshness_token: snapshotEvidence.freshness_token,
      revision_source: snapshotEvidence.revision_source,
      project_change_count: snapshotEvidence.project_change_count,
      sqlite_rows_are_candidates_only: true,
    });
  };

  const reconcileProjectRevision = (input = {}) => {
    if (closed) return invalidationFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    if (adapter.snapshot().lifecycle === "stale_session") return invalidationFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; project revision reconciliation is rejected.");
    if (!isObject(input)) return invalidationFailure("invalid_change_count", "PROJECT_CHANGE_COUNT_REQUIRED", "Project revision reconciliation requires a non-negative live change_count.");
    const changeCount = nonNegativeIntegerOrNull(input.change_count ?? input.changeCount);
    if (changeCount === null) return invalidationFailure("invalid_change_count", "PROJECT_CHANGE_COUNT_REQUIRED", "Project revision reconciliation requires a non-negative live change_count.");
    const before = adapter.snapshot();
    const storedChangeCount = projectChangeCountFromSnapshot(before, identity.project_ref);
    if (storedChangeCount === null) {
      const observedAt = safeIso(input.observed_at, now);
      const selection = selectionRowsWithProjectChangeCount(before.rows?.selection_state, identity.project_ref, changeCount);
      const initialized = adapter.replaceSelection({
        snapshot_id: before.snapshot_id,
        observed_at: observedAt,
        source_template_id: "template.project.read_summary",
        projectRef: identity.project_ref,
        bridgeOwner: identity.bridge_owner,
        bridgeGeneration: identity.bridge_generation,
        sessionId,
        rows: selection,
        coverage_status: "head_only",
        freshness_status: "fresh",
      });
      if (initialized?.ok === false) {
        return invalidationFailure("revision_initialize_failed", "PROJECT_REVISION_INITIALIZE_FAILED", "Project revision could not be initialized.", initialized.blockers?.[0]);
      }
      const snapshotEvidence = compactSnapshotEvidence(adapter.snapshot(), identity.project_ref);
      return Object.freeze({
        contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
        ok: true,
        status: "revision_initialized",
        changed: false,
        live_change_count: changeCount,
        snapshot_id: snapshotEvidence.snapshot_id,
        revision: snapshotEvidence.revision,
        freshness_token: snapshotEvidence.freshness_token,
        revision_source: snapshotEvidence.revision_source,
        sqlite_rows_are_candidates_only: true,
      });
    }
    if (storedChangeCount === changeCount) {
      const snapshotEvidence = compactSnapshotEvidence(before, identity.project_ref);
      return Object.freeze({
        contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
        ok: true,
        status: "revision_matched",
        changed: false,
        live_change_count: changeCount,
        snapshot_id: snapshotEvidence.snapshot_id,
        revision: snapshotEvidence.revision,
        freshness_token: snapshotEvidence.freshness_token,
        revision_source: snapshotEvidence.revision_source,
        sqlite_rows_are_candidates_only: true,
      });
    }

    const observedAt = safeIso(input.observed_at, now);
    const selection = selectionRowsWithProjectChangeCount(before.rows?.selection_state, identity.project_ref, changeCount);
    const selectionResult = adapter.replaceSelection({
      snapshot_id: before.snapshot_id,
      observed_at: observedAt,
      source_template_id: "template.project.read_summary",
      projectRef: identity.project_ref,
      bridgeOwner: identity.bridge_owner,
      bridgeGeneration: identity.bridge_generation,
      sessionId,
      rows: selection,
      coverage_status: "head_only",
      freshness_status: "fresh",
    });
    if (selectionResult?.ok === false) {
      managerLifecycle = "degraded";
      managerDegradedReason = "PROJECT_REVISION_RECONCILE_FAILED";
      managerBlockers = [blocker("PROJECT_REVISION_RECONCILE_FAILED", "Project Index could not retain the live project revision.", selectionResult.blockers?.[0])];
      return invalidationFailure("revision_reconcile_failed", "PROJECT_REVISION_RECONCILE_FAILED", "Project revision could not be reconciled.");
    }
    const invalidated = invalidateScopes({ scopes: PROJECT_REVISION_DEPENDENT_SCOPES, observed_at: observedAt });
    if (!invalidated.ok) return invalidated;
    return Object.freeze({
      ...invalidated,
      status: "revision_changed",
      changed: true,
      previous_change_count: storedChangeCount,
      live_change_count: changeCount,
    });
  };

  const beginLogicalRefresh = (input = {}) => {
    if (closed) return logicalRefreshFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    if (adapter.snapshot().lifecycle === "stale_session") return logicalRefreshFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; logical refresh cannot begin.");
    if (!isObject(input)) return logicalRefreshFailure("invalid_request", "LOGICAL_REFRESH_INPUT_REQUIRED", "Logical refresh requires an input object.");
    const scopes = [...new Set(arrayOf(input.scopes).length > 0 ? input.scopes : [input.scope ?? "tracks"])];
    const scope = scopes.length === 1 ? scopes[0] : null;
    const scopeConfig = logicalRefreshScopeConfig(scope);
    if (!scopeConfig) {
      return logicalRefreshFailure("unsupported_scope", "LOGICAL_REFRESH_SCOPE_UNSUPPORTED", "This bounded runtime supports one complete logical refresh scope at a time: tracks or automation.", { scopes });
    }
    const requestedRevision = input.expected_revision ?? input.expectedRevision;
    const expectedRevision = typeof requestedRevision === "string" ? normalizeProjectRevisionToken(requestedRevision) : null;
    if (!expectedRevision) return logicalRefreshFailure("revision_required", "LOGICAL_REFRESH_REVISION_REQUIRED", "Logical refresh must bind to the live REAPER project revision captured before paging.");
    const declaredEvidence = logicalRefreshDeclaredCountEvidence(scope, input);
    if (declaredEvidence.invalid) return logicalRefreshFailure("invalid_declared_count", "LOGICAL_REFRESH_DECLARED_COUNT_INVALID", `Logical refresh declared ${scopeConfig.row_noun} count must be a non-negative integer.`, { scope });
    if (declaredEvidence.values.length > 1) return logicalRefreshFailure("declared_count_inconsistent", "LOGICAL_REFRESH_DECLARED_COUNT_INCONSISTENT", `Logical refresh begin evidence disagrees on the declared ${scopeConfig.row_noun} count.`, { scope, declared_counts: declaredEvidence.values });
    const declaredCount = declaredEvidence.values[0] ?? null;
    const refreshId = nonEmpty(input.transaction_id ?? input.transactionId ?? input.refresh_id ?? input.refreshId ?? input.id) ?? `logical-refresh:${randomUUID()}`;
    if (refreshId.length > 256 || /[\0\r\n]/.test(refreshId)) return logicalRefreshFailure("invalid_id", "LOGICAL_REFRESH_ID_INVALID", "Logical refresh id must be a bounded printable string.");
    if (logicalRefreshes.has(refreshId)) return logicalRefreshFailure("already_active", "LOGICAL_REFRESH_ALREADY_ACTIVE", "A logical refresh with this id is already active.", { transaction_id: refreshId });
    logicalRefreshes.set(refreshId, {
      refresh_id: refreshId,
      scope,
      expected_revision: expectedRevision,
      declared_count: declaredCount,
      observed_at: safeIso(input.observed_at, now),
      pages: new Map(),
      source_template_ids: new Set(),
    });
    return logicalRefreshSuccess("logical_refresh_started", {
      transaction_id: refreshId,
      refresh_id: refreshId,
      scope,
      expected_revision: expectedRevision,
      [scopeConfig.declared_count_field]: declaredCount,
      sqlite_updated: false,
    });
  };

  const abortLogicalRefresh = (input = {}) => {
    if (closed) return logicalRefreshFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    const refreshId = logicalRefreshId(input);
    if (!refreshId) return logicalRefreshFailure("invalid_id", "LOGICAL_REFRESH_ID_REQUIRED", "Logical refresh abort requires transaction_id.");
    const existed = discardLogicalRefresh(refreshId, logicalRefreshes, pendingArtifacts);
    return logicalRefreshSuccess(existed ? "logical_refresh_aborted" : "logical_refresh_not_found", {
      transaction_id: refreshId,
      refresh_id: refreshId,
      reason: nonEmpty(input?.reason),
      discarded: existed,
      sqlite_updated: false,
    });
  };

  const commitLogicalRefresh = (input = {}) => {
    if (closed) return logicalRefreshFailure("runtime_closed", "RUNTIME_CLOSED", "Project Index runtime is closed.");
    if (adapter.snapshot().lifecycle === "stale_session") return logicalRefreshFailure("stale_session", "INDEX_STALE_SESSION", "Project Index identity is stale; logical refresh cannot commit.");
    const refreshId = logicalRefreshId(input);
    const refresh = refreshId ? logicalRefreshes.get(refreshId) : null;
    if (!refresh) return logicalRefreshFailure("not_found", "LOGICAL_REFRESH_NOT_FOUND", "Logical refresh commit requires an active transaction_id.", { transaction_id: refreshId });
    const failCommit = (code, message, details) => {
      discardLogicalRefresh(refreshId, logicalRefreshes, pendingArtifacts);
      return logicalRefreshFailure("logical_refresh_aborted", code, message, details);
    };
    const requestedFinalRevision = input.observed_revision ?? input.observedRevision;
    const finalRevision = typeof requestedFinalRevision === "string" ? normalizeProjectRevisionToken(requestedFinalRevision) : null;
    if (!finalRevision || finalRevision !== refresh.expected_revision) {
      return failCommit("LOGICAL_REFRESH_REVISION_MISMATCH", "Logical refresh was discarded because the live REAPER revision changed or was not confirmed after paging.", {
        expected_revision: refresh.expected_revision,
        final_revision: finalRevision,
      });
    }
    const pages = [...refresh.pages.values()].sort((left, right) => left.cursor - right.cursor);
    const scopeConfig = logicalRefreshScopeConfig(refresh.scope);
    if (!scopeConfig) return failCommit("LOGICAL_REFRESH_SCOPE_UNSUPPORTED", "Logical refresh scope is no longer supported.", { scope: refresh.scope });
    if (pages.length === 0) return failCommit("LOGICAL_REFRESH_PAGES_REQUIRED", "Logical refresh cannot commit without staged pages.");
    let expectedCursor = 0;
    let terminalPageSeen = false;
    const mergedRows = [];
    for (const [pageIndex, page] of pages.entries()) {
      if (page.cursor !== expectedCursor) {
        return failCommit("LOGICAL_REFRESH_CURSOR_GAP", `Logical refresh pages must form one continuous ${scopeConfig.row_noun} cursor sequence from zero.`, { expected_cursor: expectedCursor, actual_cursor: page.cursor, scope: refresh.scope });
      }
      if (page.revision && page.revision !== refresh.expected_revision) {
        return failCommit("LOGICAL_REFRESH_REVISION_MISMATCH", "Logical refresh page revision did not match the revision captured before paging.", { expected_revision: refresh.expected_revision, page_revision: page.revision, cursor: page.cursor });
      }
      mergedRows.push(...page.rows);
      expectedCursor += page.rows.length;
      if (page.next_cursor === null) {
        if (pageIndex !== pages.length - 1) return failCommit("LOGICAL_REFRESH_EARLY_TERMINAL_PAGE", "A logical refresh terminal page must be the final cursor page.", { cursor: page.cursor });
        terminalPageSeen = true;
      } else if (page.next_cursor !== expectedCursor) {
        return failCommit("LOGICAL_REFRESH_CURSOR_GAP", `Each logical refresh next cursor must equal the next unobserved ${scopeConfig.row_noun} offset.`, { cursor: page.cursor, expected_next_cursor: expectedCursor, actual_next_cursor: page.next_cursor, scope: refresh.scope });
      }
    }
    if (!terminalPageSeen) return failCommit("LOGICAL_REFRESH_COVERAGE_INCOMPLETE", "Logical refresh was discarded because no terminal complete-coverage page was staged.");
    const canonicalRows = dedupeRows(mergedRows);
    const declaredCount = refresh.declared_count ?? pages[0]?.declared_count ?? null;
    if (declaredCount === null || pages.some((page) => page.declared_count !== declaredCount)) {
      return failCommit("LOGICAL_REFRESH_DECLARED_COUNT_INCONSISTENT", `Every logical refresh page must agree on one declared live ${scopeConfig.row_noun} count.`, { [scopeConfig.declared_count_field]: declaredCount, scope: refresh.scope });
    }
    if (mergedRows.length !== canonicalRows.length || canonicalRows.length !== declaredCount || expectedCursor !== declaredCount) {
      return failCommit(scopeConfig.count_mismatch_code, `Logical refresh canonical rows must exactly match the declared live ${scopeConfig.row_noun} count before complete coverage can commit.`, {
        [scopeConfig.declared_count_field]: declaredCount,
        merged_row_count: mergedRows.length,
        canonical_row_count: canonicalRows.length,
        final_cursor: expectedCursor,
        scope: refresh.scope,
      });
    }
    if (canonicalRows.length > maxRows || jsonByteLength(canonicalRows) > maxBytes) {
      return failCommit("LOGICAL_REFRESH_PRESSURE_EXCEEDED", "Logical refresh exceeded the bounded Project Index staging limits and was discarded.", { row_count: canonicalRows.length, max_rows: maxRows, max_bytes: maxBytes });
    }
    const observedAt = safeIso(input.observed_at, now);
    const snapshotId = `snapshot:alpha3.3:logical:${createHash("sha256").update(`${refreshId}\0${refresh.scope}\0${finalRevision}\0${declaredCount}`).digest("hex").slice(0, 24)}`;
    let result;
    try {
      result = adapter[scopeConfig.store_method]({
        snapshot_id: snapshotId,
        observed_at: observedAt,
        source_template_id: [...refresh.source_template_ids][0] ?? scopeConfig.source_template_id,
        projectRef: identity.project_ref,
        bridgeOwner: identity.bridge_owner,
        bridgeGeneration: identity.bridge_generation,
        sessionId,
        rows: canonicalRows,
        coverage_status: "complete",
        freshness_status: "fresh",
      });
    } catch (error) {
      result = { ok: false, blockers: [error] };
    }
    discardLogicalRefresh(refreshId, logicalRefreshes, pendingArtifacts);
    if (result?.ok === false) {
      managerLifecycle = "degraded";
      managerDegradedReason = "LOGICAL_REFRESH_COMMIT_FAILED";
      managerBlockers = [blocker("LOGICAL_REFRESH_COMMIT_FAILED", "Complete logical refresh could not commit to the Project Index after validation.", result.blockers?.[0])];
      return logicalRefreshFailure("commit_failed", "LOGICAL_REFRESH_COMMIT_FAILED", "Complete logical refresh could not commit to the Project Index after validation.");
    }
    return logicalRefreshSuccess("logical_refresh_committed", {
      transaction_id: refreshId,
      refresh_id: refreshId,
      scope: refresh.scope,
      expected_revision: refresh.expected_revision,
      final_revision: finalRevision,
      snapshot_id: snapshotId,
      page_count: pages.length,
      row_count: canonicalRows.length,
      [scopeConfig.declared_count_field]: declaredCount,
      applied_scopes: Object.freeze([refresh.scope]),
      row_counts: Object.freeze({ [refresh.scope]: canonicalRows.length }),
      coverage: Object.freeze({ [refresh.scope]: "complete" }),
      sqlite_updated: true,
      sqlite_rows_are_candidates_only: true,
    });
  };

  const projectAndApply = ({ templateId, readback, execution, payloadRef }) => {
    let projection;
    try {
      projection = projectReadback(templateId, readback, identity.project_ref);
    } catch (error) {
      return observationFailure("invalid_readback", "READBACK_PROJECTION_FAILED", "Readback shape could not be validated for Project Index projection.", { detail: String(error?.message ?? error) });
    }
    if (projection.blocker) return observationFailure("invalid_readback", projection.blocker.code, projection.blocker.message, projection.blocker.details);
    const scopeEntries = Object.entries(projection.scopes);
    const totalRows = scopeEntries.reduce((sum, [, rows]) => sum + rows.length, 0);
    if (totalRows > maxRows) return observationFailure("pressure_rejected", "READBACK_ROWS_EXCEEDED", "Readback exceeds the Project Index row bound; no rows were stored.", { row_count: totalRows, max_rows: maxRows });
    if (scopeEntries.length === 0) return observationFailure("invalid_readback", "NO_PROJECTABLE_SCOPES", "Readback did not identify any accepted Project Index scope.");

    const logicalRefresh = logicalRefreshContext(execution);
    if (logicalRefresh) {
      return stageLogicalRefreshProjection({
        logicalRefresh,
        logicalRefreshes,
        pendingArtifacts,
        projection,
        readback,
        execution,
        templateId,
        payloadRef,
        maxRows,
        maxBytes,
        now,
      });
    }

    const observedAt = observationTime(execution, now);
    const snapshotId = observationSnapshotId(execution, templateId, observedAt);
    const common = {
      snapshot_id: snapshotId,
      observed_at: observedAt,
      source_template_id: templateId,
      payload_ref: payloadRef,
      projectRef: identity.project_ref,
      bridgeOwner: identity.bridge_owner,
      bridgeGeneration: identity.bridge_generation,
      sessionId,
    };
    const applied = [];
    try {
      const scopedResult = applyScopedProjection({ adapter, templateId, projection, readback, execution, common });
      if (scopedResult) {
        if (scopedResult.ok === false) throw new Error(scopedResult.blockers?.[0]?.code ?? "scoped_projection_failed");
        applied.push(...scopedResult.applied);
      } else {
        for (const [scope, rows] of scopeEntries) {
          const method = STORE_METHODS[scope];
          if (!method) continue;
          let coverage = projection.coverage[scope] ?? "complete";
          let projectedRows = method === "replaceSelection"
            ? mergeProjectHeadSelectionRows(adapter.snapshot().rows?.selection_state, rows)
            : rows;
          if (method === "replaceTracks" && coverage !== "complete") {
            const snapshot = adapter.snapshot();
            const priorScope = snapshot.freshness_scopes?.tracks ?? {};
            if (priorScope.status === "fresh" && priorScope.coverage_status === "complete") {
              projectedRows = mergeTrackRowSets(
                snapshot.rows?.tracks,
                mergeProjectedTrackRows(snapshot.rows?.tracks, rows),
              );
              coverage = "complete";
            }
          }
          const result = adapter[method]({ ...common, rows: projectedRows, coverage_status: coverage, freshness_status: "fresh" });
          if (result?.ok === false) throw new Error(result.blockers?.[0]?.code ?? `${method}_failed`);
          applied.push(scope);
        }
      }
    } catch (error) {
      managerLifecycle = "degraded";
      managerDegradedReason = "STORE_WRITE_FAILED";
      managerBlockers = [blocker("STORE_WRITE_FAILED", "Project Index store rejected projected readback rows.", error)];
      return observationFailure("store_write_failed", "STORE_WRITE_FAILED", "Projected rows could not be stored.", { detail: String(error?.message ?? error) });
    }
    return Object.freeze({
      contract: ALPHA3_2D_PROJECT_INDEX_OBSERVATION_CONTRACT,
      ok: true,
      status: "observed",
      template_id: templateId,
      snapshot_id: snapshotId,
      observed_at: observedAt,
      source_template_id: templateId,
      freshness: "fresh",
      coverage: Object.fromEntries(applied.map((scope) => [scope, projection.coverage[scope] ?? "complete"])),
      scopes: applied,
      row_count: totalRows,
      payload_ref: payloadRef,
      sqlite_rows_are_candidates_only: true,
      child_calls_executed: 0,
    });
  };

  const guardedAdapter = createGuardedAdapter(adapter);
  return Object.freeze({
    contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
    ok: true,
    backend,
    db_path: dbPath,
    session_id: sessionId,
    ownership,
    identity,
    get lifecycle() { return status().lifecycle; },
    get adapter_lifecycle() { return status().adapter_lifecycle; },
    get degraded_reason() { return status().degraded_reason; },
    adapter: guardedAdapter,
    status,
    statusSummary: status,
    status_summary: status,
    observeSuccessfulTemplateExecution: observe,
    observeArtifactPayload,
    invalidateScopes,
    reconcileProjectRevision,
    beginLogicalRefresh,
    commitLogicalRefresh,
    abortLogicalRefresh,
    close(input = {}) {
      if (closed) return status();
      closed = true;
      logicalRefreshes.clear();
      pendingArtifacts.clear();
      adapter.close({ observed_at: safeIso(input.observed_at, now) });
      managerLifecycle = "closed";
      return status();
    },
  });
}

function stageLogicalRefreshProjection({ logicalRefresh, logicalRefreshes, pendingArtifacts, projection, readback, execution, templateId, payloadRef, maxRows, maxBytes, now }) {
  const refreshId = logicalRefreshId(logicalRefresh);
  const refresh = refreshId ? logicalRefreshes.get(refreshId) : null;
  if (!refresh) return logicalRefreshFailure("not_found", "LOGICAL_REFRESH_NOT_FOUND", "Logical refresh observation requires an active refresh_id.", { refresh_id: refreshId });
  const failStage = (code, message, details) => {
    discardLogicalRefresh(refreshId, logicalRefreshes, pendingArtifacts);
    return logicalRefreshFailure("logical_refresh_aborted", code, message, details);
  };
  const scope = logicalRefresh.scope ?? refresh.scope;
  const scopeConfig = logicalRefreshScopeConfig(scope);
  if (!scopeConfig || scope !== refresh.scope) return failStage("LOGICAL_REFRESH_SCOPE_MISMATCH", "Logical refresh page scope must match the active refresh scope.", { expected_scope: refresh.scope, actual_scope: scope });
  const rows = arrayOf(projection.scopes?.[scopeConfig.projection_scope]);
  const pageEvidence = isObject(execution?.logical_refresh_page_evidence) ? execution.logical_refresh_page_evidence : {};
  const overview = logicalRefreshPageOverview(scope, readback);
  const observationInput = isObject(execution?.project_index_observation_context?.input)
    ? execution.project_index_observation_context.input
    : {};
  const cursorEvidence = logicalRefreshCursorEvidence(logicalRefreshPageCursorValues(scope, logicalRefresh, overview, pageEvidence, observationInput));
  if (cursorEvidence.invalid || cursorEvidence.values.length > 1) {
    return failStage("LOGICAL_REFRESH_CURSOR_CONFLICT", `Logical refresh page evidence must agree on one ${scopeConfig.row_noun} cursor.`, { scope, cursor_values: cursorEvidence.values });
  }
  const cursor = cursorEvidence.values[0] ?? (refresh.pages.size === 0 ? 0 : null);
  if (cursor === null) return failStage("LOGICAL_REFRESH_CURSOR_REQUIRED", `Every logical refresh ${scopeConfig.row_noun} page must report a non-negative integer cursor.`);
  const declaredEvidence = logicalRefreshDeclaredCountEvidence(scope, logicalRefresh, overview, pageEvidence, refresh);
  if (declaredEvidence.invalid) return failStage("LOGICAL_REFRESH_DECLARED_COUNT_INVALID", `Logical refresh page declared ${scopeConfig.row_noun} count must be a non-negative integer.`, { scope, cursor });
  if (declaredEvidence.values.length > 1) return failStage("LOGICAL_REFRESH_DECLARED_COUNT_INCONSISTENT", `Logical refresh page evidence disagrees on the declared ${scopeConfig.row_noun} count.`, { scope, cursor, declared_counts: declaredEvidence.values });
  const declaredCount = declaredEvidence.values[0] ?? null;
  if (declaredCount === null) return failStage("LOGICAL_REFRESH_DECLARED_COUNT_REQUIRED", `Every logical refresh ${scopeConfig.row_noun} page must report the declared live ${scopeConfig.row_noun} count.`);
  if (refresh.declared_count !== null && refresh.declared_count !== declaredCount) {
    return failStage("LOGICAL_REFRESH_DECLARED_COUNT_INCONSISTENT", `Logical refresh page declared ${scopeConfig.row_noun} count changed during paging.`, { expected: refresh.declared_count, actual: declaredCount, cursor, scope });
  }
  const returnedEvidence = nonNegativeIntegerEvidence([
    logicalRefresh[scopeConfig.returned_count_field],
    logicalRefresh.returned_count,
    overview[scopeConfig.returned_count_field],
    overview.returned_count,
    pageEvidence[scopeConfig.returned_count_field],
    pageEvidence.returned_count,
  ]);
  if (returnedEvidence.invalid || returnedEvidence.values.length > 1) {
    return failStage("LOGICAL_REFRESH_RETURNED_COUNT_MISMATCH", `Logical refresh page evidence must agree on one ${scopeConfig.returned_count_field}.`, { cursor, scope, returned_counts: returnedEvidence.values });
  }
  const returnedCount = returnedEvidence.values[0] ?? rows.length;
  if (returnedCount !== rows.length) {
    return failStage("LOGICAL_REFRESH_RETURNED_COUNT_MISMATCH", `Logical refresh page canonical row count must match ${scopeConfig.returned_count_field}.`, { cursor, [scopeConfig.returned_count_field]: returnedCount, canonical_row_count: rows.length, scope });
  }
  const nextCursorEvidence = logicalRefreshCursorEvidence(logicalRefreshNextPageCursorValues(scope, logicalRefresh, overview, pageEvidence), { allowNull: true });
  if (nextCursorEvidence.invalid || nextCursorEvidence.values.length > 1) {
    return failStage("LOGICAL_REFRESH_CURSOR_CONFLICT", `Logical refresh page evidence must agree on one next ${scopeConfig.row_noun} cursor.`, { cursor, scope, next_cursor_values: nextCursorEvidence.values });
  }
  const rawNextCursor = nextCursorEvidence.provided ? nextCursorEvidence.values[0] : undefined;
  const truncated = firstDefined(logicalRefresh.truncated, overview.truncated, pageEvidence.truncated);
  let nextCursor;
  if (rawNextCursor === null || (rawNextCursor === undefined && truncated === false)) nextCursor = null;
  else nextCursor = logicalCursor(rawNextCursor);
  if (nextCursor === null && rawNextCursor !== null && !(rawNextCursor === undefined && truncated === false)) {
    return failStage("LOGICAL_REFRESH_NEXT_CURSOR_INVALID", "A non-terminal logical refresh page must report a valid next cursor.", { cursor, next_cursor: rawNextCursor });
  }
  if (truncated === true && nextCursor === null) return failStage("LOGICAL_REFRESH_NEXT_CURSOR_REQUIRED", `A truncated logical refresh page must report the next ${scopeConfig.row_noun} cursor.`, { cursor, scope });
  if (truncated === false && nextCursor !== null) return failStage("LOGICAL_REFRESH_COVERAGE_CONFLICT", "A page with a next cursor cannot claim terminal non-truncated coverage.", { cursor, next_cursor: nextCursor });
  if (nextCursor !== null && (nextCursor <= cursor || rows.length === 0)) {
    return failStage("LOGICAL_REFRESH_CURSOR_NOT_ADVANCING", `Logical refresh pages must advance the ${scopeConfig.row_noun} cursor with at least one canonical row.`, { cursor, next_cursor: nextCursor, row_count: rows.length, scope });
  }
  const pageCoverage = logicalRefreshPageCoverage({
    scope,
    projection,
    readback,
    overview,
    pageEvidence,
    logicalRefresh,
  });
  if (nextCursor === null && pageCoverage !== "complete") {
    return failStage("LOGICAL_REFRESH_COVERAGE_INCOMPLETE", "A logical refresh terminal page must carry explicit complete coverage from REAPER readback.", { cursor, scope, coverage_status: pageCoverage });
  }
  if (nextCursor !== null && pageCoverage === "complete") {
    return failStage("LOGICAL_REFRESH_COVERAGE_CONFLICT", "A non-terminal logical refresh page cannot claim complete coverage.", { cursor, next_cursor: nextCursor, scope, coverage_status: pageCoverage });
  }
  const revisionEvidence = logicalRefreshRevisionEvidence(logicalRefresh, overview, pageEvidence);
  if (revisionEvidence.invalid || revisionEvidence.values.length > 1 || revisionEvidence.values.some((value) => value !== refresh.expected_revision)) {
    return failStage("LOGICAL_REFRESH_REVISION_MISMATCH", "Logical refresh page revision evidence changed or disagreed during paging; the staged refresh was discarded.", { expected_revision: refresh.expected_revision, page_revisions: revisionEvidence.values, cursor });
  }
  const pageRevision = revisionEvidence.values[0] ?? null;
  const page = {
    cursor,
    next_cursor: nextCursor,
    declared_count: declaredCount,
    coverage_status: pageCoverage,
    revision: pageRevision,
    rows: structuredClone(rows),
    template_id: templateId,
    payload_ref: payloadRef,
    observed_at: observationTime(execution, now),
  };
  const existing = refresh.pages.get(cursor);
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(page)) {
      return logicalRefreshSuccess("logical_refresh_page_staged", {
        transaction_id: refreshId,
        refresh_id: refreshId,
        scope,
        [scopeConfig.cursor_field]: cursor,
        [scopeConfig.next_cursor_field]: nextCursor,
        page_row_count: rows.length,
        staged_page_count: refresh.pages.size,
        staged_row_count: [...refresh.pages.values()].reduce((sum, entry) => sum + entry.rows.length, 0),
        replayed: true,
        sqlite_updated: false,
      });
    }
    return failStage("LOGICAL_REFRESH_CURSOR_CONFLICT", "A logical refresh cursor cannot be replaced with different page evidence.", { cursor });
  }
  const stagedRows = [...refresh.pages.values()].reduce((sum, entry) => sum + entry.rows.length, 0) + rows.length;
  const stagedBytes = jsonByteLength([...refresh.pages.values()].flatMap((entry) => entry.rows).concat(rows));
  if (stagedRows > maxRows || stagedBytes === null || stagedBytes > maxBytes) {
    return failStage("LOGICAL_REFRESH_PRESSURE_EXCEEDED", "Logical refresh staging exceeded the bounded Project Index row or byte limit and was discarded.", { staged_rows: stagedRows, max_rows: maxRows, staged_bytes: stagedBytes, max_bytes: maxBytes });
  }
  refresh.declared_count ??= declaredCount;
  refresh.pages.set(cursor, page);
  refresh.source_template_ids.add(templateId);
  return logicalRefreshSuccess("logical_refresh_page_staged", {
    transaction_id: refreshId,
    refresh_id: refreshId,
    scope,
    [scopeConfig.cursor_field]: cursor,
    [scopeConfig.next_cursor_field]: nextCursor,
    page_row_count: rows.length,
    staged_page_count: refresh.pages.size,
    staged_row_count: stagedRows,
    [scopeConfig.declared_count_field]: declaredCount,
    coverage: nextCursor === null ? "terminal_page_staged" : "paged_staging",
    sqlite_updated: false,
    payload_ref: payloadRef,
  });
}

function hasLogicalRefreshContext(input) {
  return isObject(input?.project_index_observation_context)
    && Object.hasOwn(input.project_index_observation_context, "logical_refresh");
}

function logicalRefreshContext(input) {
  const value = input?.project_index_observation_context?.logical_refresh;
  return isObject(value) ? structuredClone(value) : null;
}

function logicalRefreshId(input) {
  if (typeof input === "string") return nonEmpty(input);
  return isObject(input) ? nonEmpty(input.transaction_id ?? input.transactionId ?? input.refresh_id ?? input.refreshId ?? input.id) : null;
}

function discardLogicalRefresh(refreshId, logicalRefreshes, pendingArtifacts) {
  const existed = logicalRefreshes.delete(refreshId);
  for (const [artifactRef, pending] of pendingArtifacts.entries()) {
    if (logicalRefreshId(pending?.logical_refresh) === refreshId) pendingArtifacts.delete(artifactRef);
  }
  return existed;
}

function logicalRefreshSuccess(status, details = {}) {
  return Object.freeze({
    contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
    ok: true,
    status,
    ...details,
    sqlite_is_truth: false,
    child_calls_executed: 0,
    blockers: [],
  });
}

function logicalRefreshFailure(status, code, message, details = undefined) {
  return Object.freeze({
    contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
    ok: false,
    status,
    sqlite_updated: false,
    sqlite_is_truth: false,
    child_calls_executed: 0,
    blockers: [blocker(code, message, details)],
  });
}

function logicalRefreshScopeConfig(scope) {
  return typeof scope === "string" ? LOGICAL_REFRESH_SCOPE_CONFIG[scope] ?? null : null;
}

function logicalRefreshDeclaredCountEvidence(scope, ...sources) {
  const candidates = [];
  for (const source of sources) {
    if (!isObject(source)) continue;
    if (scope === "tracks") {
      candidates.push(source.declared_track_count, source.declaredTrackCount, source.track_count, source.declared_counts?.tracks);
    } else if (scope === "automation") {
      candidates.push(
        source.declared_envelope_count,
        source.declaredEnvelopeCount,
        source.envelope_count,
        source.total_count,
        source.declared_counts?.automation,
        source.declared_counts?.envelopes,
      );
    }
    candidates.push(source.declared_count);
  }
  return nonNegativeIntegerEvidence(candidates);
}

function nonNegativeIntegerEvidence(candidates) {
  const provided = candidates.filter((value) => value !== undefined && value !== null);
  const normalized = provided.map((value) => nonNegativeIntegerOrNull(value));
  return {
    provided: provided.length > 0,
    invalid: normalized.some((value) => value === null),
    values: [...new Set(normalized.filter((value) => value !== null))],
  };
}

function logicalRefreshPageOverview(scope, readback) {
  if (scope === "tracks") {
    if (isObject(readback?.project_map)) return readback.project_map;
    if (isObject(readback?.overview)) return readback.overview;
  }
  return isObject(readback) ? readback : {};
}

function logicalRefreshPageCursorValues(scope, logicalRefresh, overview, pageEvidence, observationInput) {
  const config = logicalRefreshScopeConfig(scope);
  if (!config) return [];
  return [
    logicalRefresh[config.cursor_field],
    logicalRefresh.cursor,
    overview[config.cursor_field],
    overview.cursor,
    pageEvidence[config.cursor_field],
    pageEvidence.cursor,
    observationInput[config.cursor_field],
    observationInput.cursor,
  ];
}

function logicalRefreshNextPageCursorValues(scope, logicalRefresh, overview, pageEvidence) {
  const config = logicalRefreshScopeConfig(scope);
  if (!config) return [];
  return [
    logicalRefresh[config.next_cursor_field],
    logicalRefresh.next_cursor,
    logicalRefresh.nextCursor,
    overview[config.next_cursor_field],
    overview.next_cursor,
    pageEvidence[config.next_cursor_field],
    pageEvidence.next_cursor,
  ];
}

function logicalRefreshCursorEvidence(candidates, options = {}) {
  const allowNull = options.allowNull === true;
  const provided = candidates.filter((value) => value !== undefined);
  let invalid = false;
  const normalized = [];
  for (const value of provided) {
    if (value === null) {
      if (allowNull) normalized.push(null);
      else invalid = true;
      continue;
    }
    const cursor = logicalCursor(value);
    if (cursor === null) invalid = true;
    else normalized.push(cursor);
  }
  const keys = new Set(normalized.map((value) => value === null ? "terminal" : `offset:${value}`));
  const values = [...keys].map((key) => key === "terminal" ? null : Number(key.slice("offset:".length)));
  return { provided: provided.length > 0, invalid, values };
}

function logicalRefreshRevisionEvidence(...sources) {
  const provided = [];
  for (const source of sources) {
    if (!isObject(source)) continue;
    for (const field of ["revision", "project_revision", "change_count"]) {
      if (source[field] !== undefined && source[field] !== null) provided.push(source[field]);
    }
  }
  const normalized = provided.map((value) => normalizeProjectRevisionToken(value));
  return {
    provided: provided.length > 0,
    invalid: normalized.some((value) => value === null),
    values: [...new Set(normalized.filter(Boolean))],
  };
}

function logicalRefreshPageCoverage({ scope, projection, readback, overview, pageEvidence, logicalRefresh }) {
  const config = logicalRefreshScopeConfig(scope);
  if (!config) return "unknown";
  const scopeSpecificCoverage = scope === "tracks"
    ? readback?.coverage?.project_map ?? readback?.coverage?.tracks
    : readback?.coverage?.automation ?? readback?.coverage?.envelopes;
  return normalizeCoverage(firstDefined(
    scopeSpecificCoverage,
    overview.coverage_status,
    pageEvidence.coverage_status,
    projection.coverage?.[config.projection_scope],
    logicalRefresh.coverage_status,
  ), "unknown");
}

function logicalCursor(value) {
  if (Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) {
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) ? parsed : null;
  }
  if (typeof value === "string" && value.length <= 2048) {
    try {
      const decoded = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
      if (Number.isSafeInteger(decoded?.offset) && decoded.offset >= 0) return decoded.offset;
    } catch {
      // Opaque cursors without a bounded numeric offset cannot prove continuity.
    }
  }
  return null;
}

function normalizeProjectRevisionToken(value) {
  if (Number.isInteger(value) && value >= 0) return `reaper-change-count:${value}`;
  if (typeof value === "string" && /^reaper-change-count:[0-9]+$/.test(value)) return value;
  return null;
}

function firstDefined(...values) {
  return values.find((value) => value !== undefined);
}

const STORE_METHODS = Object.freeze({
  tracks: "replaceTracks",
  items: "replaceItems",
  takes: "replaceTakes",
  fx: "replaceFx",
  routing: "replaceSends",
  automation: "replaceEnvelopes",
  markers_regions: "replaceMarkersRegions",
  media_sources: "replaceMediaSources",
  selected_context: "replaceSelection",
});

function applyScopedProjection({ adapter, templateId, projection, readback, execution, common }) {
  if (templateId === "template.project.read_summary") {
    const rows = mergeProjectHeadSelectionRows(adapter.snapshot().rows?.selection_state, projection.scopes.selected_context ?? []);
    const result = adapter.replaceSelection({ ...common, rows, coverage_status: "head_only", freshness_status: "fresh" });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["selected_context"] };
  }
  if (templateId === "template.tracks.list_tracks" || templateId === "template.tracks.read_mixer_controls") {
    const snapshot = adapter.snapshot();
    const existingRows = snapshot.rows?.tracks ?? [];
    const incomingRows = mergeProjectedTrackRows(existingRows, projection.scopes.tracks ?? []);
    const observation = isObject(execution?.project_index_observation_context)
      ? execution.project_index_observation_context
      : {};
    const observationRefs = arrayOf(observation.refs);
    const input = isObject(observation.input) ? observation.input : {};
    const requestedSelectedOnly = templateId === "template.tracks.read_mixer_controls"
      && observationRefs.length === 0
      && input.include_selected === true;
    const projectedCoverage = projection.coverage.tracks ?? "complete";
    const completeProjectRead = observationRefs.length === 0
      && !requestedSelectedOnly
      && projectedCoverage === "complete";
    const rows = completeProjectRead
      ? incomingRows
      : mergeTrackRowSets(existingRows, incomingRows);
    const priorScope = snapshot.freshness_scopes?.tracks ?? {};
    const coverage = completeProjectRead
      ? projectedCoverage
      : priorScope.status === "fresh" && priorScope.coverage_status === "complete"
        ? "complete"
        : projectedCoverage === "complete"
          ? "partial"
          : projectedCoverage;
    const result = adapter.replaceTracks({
      ...common,
      rows,
      coverage_status: coverage,
      freshness_status: "fresh",
    });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["tracks"] };
  }
  if (templateId === "template.automation.list_project_envelopes") {
    const snapshot = adapter.snapshot();
    const existingRows = snapshot.rows?.envelopes ?? [];
    const incomingRows = projection.scopes.automation ?? [];
    const observation = isObject(execution?.project_index_observation_context)
      ? execution.project_index_observation_context
      : {};
    const input = isObject(observation.input) ? observation.input : {};
    const projectedCoverage = projection.coverage.automation ?? "unknown";
    const completeProjectRead = projectedCoverage === "complete"
      && automationObservationCoversFullProject(input);
    const rows = completeProjectRead
      ? incomingRows
      : mergeEnvelopeRowSets(existingRows, incomingRows);
    const priorScope = snapshot.freshness_scopes?.automation ?? {};
    const coverage = completeProjectRead
      ? "complete"
      : priorScope.status === "fresh" && priorScope.coverage_status === "complete"
        ? "complete"
        : projectedCoverage === "complete"
          ? "partial"
          : projectedCoverage;
    const result = adapter.replaceEnvelopes({
      ...common,
      rows,
      coverage_status: coverage,
      freshness_status: "fresh",
    });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["automation"] };
  }
  if (templateId === "template.fx.list_track_fx_chain" || templateId === "template.fx.list_take_fx_chain") {
    const rows = projection.scopes.fx ?? [];
    const ownerRef = stringOrNull(readback.owner_ref) ?? rows[0]?.owner_ref ?? null;
    if (!ownerRef) return { ok: false, blockers: [{ code: "OWNER_REF_REQUIRED", message: "FX scoped projection requires owner_ref.", recoverable: true }] };
    const result = adapter.replaceFxForOwner({ ...common, owner_ref: ownerRef, rows, coverage_status: projection.coverage.fx ?? "complete", freshness_status: "fresh" });
    if (result?.ok === false) return { ok: false, blockers: result.blockers ?? [], applied: [] };
    const derived = templateId === "template.fx.list_track_fx_chain"
      ? syncTrackDerivedCount({
          adapter,
          trackRef: ownerRef,
          field: "fx_count",
          count: Number.isInteger(readback.fx_count) ? readback.fx_count : rows.length,
          common,
        })
      : { ok: true, applied: false, blockers: [] };
    return {
      ok: derived.ok,
      blockers: derived.blockers,
      applied: derived.applied ? ["fx", "tracks"] : ["fx"],
    };
  }
  if (templateId === "template.fx.read_fx_summary") {
    const rows = projection.scopes.fx ?? [];
    const ownerRef = rows[0]?.owner_ref ?? stringOrNull(readback.owner_ref) ?? null;
    if (!ownerRef) return { ok: false, blockers: [{ code: "OWNER_REF_REQUIRED", message: "FX summary projection requires owner_ref.", recoverable: true }] };
    const result = adapter.replaceFxForOwner({ ...common, owner_ref: ownerRef, rows, coverage_status: projection.coverage.fx ?? "partial", freshness_status: "fresh" });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["fx"] };
  }
  if (templateId === "template.items.list_items_on_track") {
    const rows = projection.scopes.items ?? [];
    const takes = projection.scopes.takes ?? [];
    const trackRef = stringOrNull(readback.track_ref) ?? rows[0]?.track_ref ?? takes[0]?.track_ref ?? null;
    if (!trackRef) return { ok: false, blockers: [{ code: "TRACK_REF_REQUIRED", message: "Item scoped projection requires track_ref.", recoverable: true }] };
    const result = adapter.replaceItemsAndTakesForTrack({ ...common, track_ref: trackRef, items: rows, takes, coverage_status: projection.coverage.items ?? "partial", freshness_status: "fresh" });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["items", "takes"] };
  }
  if (templateId === "template.items.read_item_summary" || templateId === "template.items.list_selected_items") {
    const result = adapter.upsertItemsAndTakes({ ...common, items: projection.scopes.items ?? [], takes: projection.scopes.takes ?? [], coverage_status: projection.coverage.items ?? "partial", freshness_status: "fresh" });
    return { ok: result?.ok !== false, blockers: result?.blockers ?? [], applied: ["items", "takes"] };
  }
  return null;
}

function mergeProjectedTrackRows(existingRows, incomingRows) {
  const existingByRef = new Map(arrayOf(existingRows).map((row) => [row.ref, row]));
  return arrayOf(incomingRows).map((row) => {
    const previous = existingByRef.get(row.ref);
    if (!previous) return row;
    const summary = isObject(row.summary) ? row.summary : {};
    return {
      ...row,
      folder_depth: Object.hasOwn(summary, "folder_depth") ? row.folder_depth : previous.folder_depth,
      item_count: Object.hasOwn(summary, "item_count") ? row.item_count : previous.item_count,
      fx_count: Object.hasOwn(summary, "fx_count") ? row.fx_count : previous.fx_count,
      send_count: Object.hasOwn(summary, "send_count") ? row.send_count : previous.send_count,
    };
  });
}

function syncTrackDerivedCount({ adapter, trackRef, field, count, common }) {
  if (typeof trackRef !== "string" || !trackRef.startsWith("track:") || !Number.isInteger(count) || count < 0) {
    return { ok: true, applied: false, blockers: [] };
  }
  const snapshot = adapter.snapshot();
  const existingRows = arrayOf(snapshot.rows?.tracks);
  if (!existingRows.some((row) => row.ref === trackRef)) return { ok: true, applied: false, blockers: [] };
  const priorScope = snapshot.freshness_scopes?.tracks ?? {};
  const rows = existingRows.map((row) => row.ref === trackRef
    ? {
        ...row,
        snapshot_id: common.snapshot_id,
        [field]: count,
        summary: { ...(isObject(row.summary) ? row.summary : {}), [field]: count },
      }
    : { ...row, snapshot_id: common.snapshot_id });
  const result = adapter.replaceTracks({
    ...common,
    rows,
    scope_ref: priorScope.scope_ref ?? "project",
    freshness_status: priorScope.status ?? "unknown",
    coverage_status: priorScope.coverage_status ?? "partial",
    source_template_id: priorScope.source_template_id ?? "template.tracks.list_tracks",
  });
  return {
    ok: result?.ok !== false,
    applied: result?.ok !== false,
    blockers: result?.blockers ?? [],
  };
}

function mergeTrackRowSets(existingRows, incomingRows) {
  const incomingByRef = new Map(arrayOf(incomingRows).map((row) => [row.ref, row]));
  const merged = arrayOf(existingRows).map((row) => incomingByRef.get(row.ref) ?? row);
  const existingRefs = new Set(arrayOf(existingRows).map((row) => row.ref));
  for (const row of arrayOf(incomingRows)) {
    if (!existingRefs.has(row.ref)) merged.push(row);
  }
  return merged;
}

function mergeEnvelopeRowSets(existingRows, incomingRows) {
  const incomingByRef = new Map(arrayOf(incomingRows).map((row) => [row.ref, row]));
  const merged = arrayOf(existingRows).map((row) => incomingByRef.get(row.ref) ?? row);
  const existingRefs = new Set(arrayOf(existingRows).map((row) => row.ref));
  for (const row of arrayOf(incomingRows)) {
    if (!existingRefs.has(row.ref)) merged.push(row);
  }
  return merged;
}

function automationObservationCoversFullProject(input) {
  if (!isObject(input)) return true;
  if (input.cursor !== undefined && input.cursor !== null && input.cursor !== "") return false;
  if (input.only_visible === true || input.only_armed === true) return false;
  if ([
    "include_track_envelopes",
    "include_take_envelopes",
    "include_send_envelopes",
    "include_fx_parameter_envelopes",
  ].some((key) => input[key] === false)) return false;
  if (!Array.isArray(input.parent_kinds)) return true;
  const kinds = new Set(input.parent_kinds);
  return ["track", "take", "send", "fx"].every((kind) => kinds.has(kind));
}

function projectReadback(templateId, readback, projectRef) {
  switch (templateId) {
    case "template.project.read_summary":
      return { scopes: { selected_context: projectHeadRows(readback, projectRef) }, coverage: { selected_context: "head_only" } };
    case "template.tracks.list_tracks":
    case "template.tracks.read_mixer_controls":
      return simpleProjection("tracks", mapTracks(readback.tracks, projectRef), coverageOf(readback, "complete"), arrayOf(readback.tracks).length);
    case "template.items.list_selected_items":
    case "template.items.list_items_on_track":
    case "template.items.read_item_summary": {
      const itemSource = readback.items ?? [readback];
      const itemSourceCount = Array.isArray(readback.items) ? readback.items.length : 1;
      const items = mapItems(itemSource);
      if (itemSourceCount > 0 && items.length === 0) {
        return { blocker: { code: "NO_CANONICAL_ROWS", message: "Item readback contained item entries but none had canonical item refs." } };
      }
      const takes = mapTakesFromItems(itemSource);
      const takeRequired = itemSource.some((item) => Number.isInteger(item?.take_count) && item.take_count > 0);
      if (takeRequired && takes.length === 0) {
        return { blocker: { code: "NO_CANONICAL_TAKE_ROWS", message: "Item readback reported takes but did not include canonical active_take_ref rows." } };
      }
      const coverage = coverageOf(readback, templateId.includes("selected") ? "selected_only" : "partial");
      return { scopes: { items, takes }, coverage: { items: coverage, takes: coverage } };
    }
    case "template.media.read_take_source":
      return simpleProjection("takes", mapTakeSources(readback), coverageOf(readback, "partial"), isObject(readback) ? 1 : 0);
    case "template.fx.list_track_fx_chain":
    case "template.fx.list_take_fx_chain":
      return simpleProjection("fx", mapFx(readback.fx), coverageOf(readback, "complete"), arrayOf(readback.fx).length);
    case "template.fx.read_fx_summary":
      return simpleProjection("fx", mapFx([readback.fx ?? readback]), coverageOf(readback, "partial"), isObject(readback) ? 1 : 0);
    case "template.routing.read_project_routing_graph":
      return simpleProjection("routing", mapSends(readback.edges ?? readback.sends), coverageOf(readback, "complete"), arrayOf(readback.edges ?? readback.sends).length);
    case "template.automation.list_project_envelopes":
      return automationProjection(readback);
    case "template.project.list_markers_regions":
      return simpleProjection("markers_regions", mapMarkers(readback.items ?? readback.markers_regions), coverageOf(readback, "complete"), arrayOf(readback.items ?? readback.markers_regions).length);
    case "template.media.read_project_media_files":
      return simpleProjection("media_sources", mapMedia(readback), coverageOf(readback, "complete"), Array.isArray(readback) ? readback.length : arrayOf(readback.sources).length + arrayOf(readback.file_refs).length);
    case "template.project.create_project_map_snapshot":
      return projectMapPayload(readback.overview ?? readback.project_map ?? readback, projectRef, readback.coverage);
    case "template.project.create_observation_bundle": {
      const map = projectMapPayload(readback.project_map ?? readback.overview ?? {}, projectRef, readback.coverage);
      const markerRows = mapMarkers(readback.markers_regions?.items ?? readback.markers_regions);
      if (markerRows.length > 0) {
        map.scopes.markers_regions = markerRows;
        map.coverage.markers_regions = coverageOf(readback.markers_regions ?? {}, "complete");
      }
      const head = projectHeadRows(readback, projectRef, map.scopes.selected_context ?? []);
      map.scopes.selected_context = head;
      map.coverage.selected_context = "complete";
      return map;
    }
    default:
      return { blocker: { code: "REFRESH_TEMPLATE_NOT_ACCEPTED", message: "Template is not projectable." } };
  }
}

function automationProjection(readback) {
  const sourceRows = arrayOf(readback.envelopes ?? readback.automation);
  const rows = dedupeRows(mapEnvelopes(sourceRows));
  if (sourceRows.length > 0 && rows.length === 0) {
    return { blocker: { code: "NO_CANONICAL_ROWS", message: "Readback contained automation entries but none had canonical refs." } };
  }
  const returnedCount = nonNegativeIntegerOrNull(readback.returned_count);
  const totalCount = nonNegativeIntegerOrNull(readback.total_count);
  let coverage = normalizeCoverage(readback.coverage_status, readback.truncated === true ? "truncated" : "unknown");
  if (coverage === "complete") {
    const completeEvidence = readback.truncated === false
      && (readback.next_cursor === null || readback.next_cursor === undefined)
      && returnedCount === rows.length
      && totalCount === rows.length
      && sourceRows.length === rows.length;
    if (!completeEvidence) coverage = "partial";
  }
  return { scopes: { automation: rows }, coverage: { automation: coverage } };
}

function projectMapPayload(overview, projectRef, coverage = {}) {
  if (!isObject(overview)) return { blocker: { code: "ARTIFACT_PAYLOAD_INVALID", message: "Project map artifact payload is missing overview rows." } };
  const tracks = mapTracks(overview.tracks, projectRef);
  const declaredTrackCount = nonNegativeIntegerOrNull(overview.track_count);
  const projectedTrackCoverage = normalizeCoverage(coverage.tracks, overview.truncated ? "paged" : "complete");
  const trackCoverage = projectedTrackCoverage === "complete"
    && declaredTrackCount !== null
    && declaredTrackCount !== tracks.length
    ? "partial"
    : projectedTrackCoverage;
  const nestedItems = [];
  for (const track of arrayOf(overview.tracks)) {
    for (const item of arrayOf(track?.items)) nestedItems.push({ ...item, track_ref: item.track_ref ?? track.track_ref ?? track.ref });
  }
  const selectedItems = mapItems(overview.selected_items);
  const itemSource = [...nestedItems, ...arrayOf(overview.selected_items)];
  const items = dedupeRows([...mapItems(nestedItems), ...selectedItems]);
  const takes = mapTakesFromItems(itemSource);
  const selectedContext = projectHeadRows(overview, projectRef, selectedItems.map((row) => ({
    ref: row.ref, owner_ref: row.track_ref, scope_kind: "item", summary: { selected: true },
  })));
  const scopes = { tracks, items, selected_context: selectedContext };
  const projectedCoverage = {
    tracks: trackCoverage,
    items: normalizeCoverage(coverage.track_items, overview.truncated ? "paged" : "partial"),
    takes: normalizeCoverage(coverage.track_items, overview.truncated ? "paged" : "partial"),
    selected_context: normalizeCoverage(coverage.selected_items, "selected_only"),
  };
  const takeShapePresent = itemSource.some((item) => Array.isArray(item?.takes));
  if (takeShapePresent || overview.item_count === 0) scopes.takes = takes;
  if (overview.track_count === 0 && overview.truncated !== true) {
    scopes.fx = [];
    projectedCoverage.fx = "complete";
  }
  return { scopes, coverage: projectedCoverage };
}

function projectHeadRows(readback, projectRef, selectedRows = []) {
  const changeCount = nonNegativeIntegerOrNull(readback.change_count);
  const projectRow = {
    ref: projectRef,
    owner_ref: null,
    scope_kind: "project_head",
    summary: compactObject({
      project_ref: readback.project_ref ?? projectRef,
      project_path: readback.project_path ?? readback.path,
      title: readback.title ?? readback.metadata?.title,
      dirty: readback.dirty ?? readback.is_dirty,
      track_count: readback.track_count,
      item_count: readback.item_count,
      marker_count: readback.marker_count,
      region_count: readback.region_count,
      selected_count: readback.selected_count,
      ...(changeCount === null ? {} : { change_count: changeCount }),
    }),
  };
  return dedupeRows([projectRow, ...selectedRows]);
}

function mapTracks(rows, projectRef) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "track_ref"], "track");
    if (!ref) return null;
    return {
      ref, owner_ref: canonicalProjectRef(row.owner_ref) ?? projectRef,
      name: stringOr(row.name, ""), index: integerOrNull(row.index ?? row.track_index),
      display_number: row.display_number == null ? null : String(row.display_number),
      selected: row.selected === true, muted: row.muted === true,
      solo: row.solo === true || row.solo_mode === "solo" || row.solo_mode === "solo_in_place",
      record_arm: row.record_arm === true || row.record_armed === true,
      folder_depth: integerOr(row.folder_depth, 0), item_count: integerOr(row.item_count, 0),
      fx_count: integerOr(row.fx_count, 0), send_count: integerOr(row.send_count, 0), summary: compactObject(row),
    };
  }).filter(Boolean);
}

function mapItems(rows) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "item_ref"], "item");
    if (!ref) return null;
    const trackRef = canonicalRefFrom(row, ["track_ref", "owner_ref"], "track");
    return {
      ref, owner_ref: trackRef, track_ref: trackRef,
      start_seconds: finiteOrNull(row.start_seconds ?? row.position_seconds ?? row.start),
      end_seconds: finiteOrNull(row.end_seconds ?? row.end),
      length_seconds: finiteOrNull(row.length_seconds ?? row.length),
      selected: row.selected === true, muted: row.muted === true, summary: compactObject(row),
    };
  }).filter(Boolean);
}

function mapTakesFromItems(rows) {
  const takes = [];
  for (const item of arrayOf(rows)) {
    const itemRef = canonicalRefFrom(item, ["ref", "item_ref"], "item");
    const trackRef = canonicalRefFrom(item, ["track_ref", "owner_ref"], "track");
    const nested = arrayOf(item?.takes);
    if (nested.length === 0 && isCanonicalRef(item?.active_take_ref, "take")) nested.push({ take_ref: item.active_take_ref, active: true, name: item.active_take_name });
    for (const take of nested) {
      const ref = canonicalRefFrom(take, ["ref", "take_ref"], "take");
      if (!ref || !itemRef) continue;
      takes.push({ ref, owner_ref: itemRef, item_ref: itemRef, track_ref: canonicalRefFrom(take, ["track_ref"], "track") ?? trackRef, active: take.active === true || take.is_active === true, selected: take.selected === true, source_kind: stringOrNull(take.source_kind), source_ref: canonicalRefFrom(take, ["source_ref", "file_ref"]), pitch_semitones: finiteOrNull(take.pitch_semitones ?? take.pitch), playrate: finiteOrNull(take.playrate ?? take.play_rate), reverse: take.reverse === true || take.reversed === true, has_take_fx: take.has_take_fx === true || Number.isInteger(take.fx_count) && take.fx_count > 0, summary: compactObject(take) });
    }
  }
  return dedupeRows(takes);
}

function mapTakeSources(readback) {
  const ref = canonicalRefFrom(readback, ["ref", "take_ref"], "take");
  if (!ref) return [];
  const fileRef = canonicalRefFrom(readback, ["file_ref", "source_ref"], "file");
  return [{
    ref,
    owner_ref: stringOrNull(readback.item_ref),
    item_ref: stringOrNull(readback.item_ref),
    track_ref: stringOrNull(readback.track_ref),
    source_ref: fileRef,
    source_kind: stringOrNull(readback.source_kind ?? readback.source_type),
    length_seconds: finiteOrNull(readback.length_seconds),
    summary: compactObject(readback),
  }];
}

function mapFx(rows) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "fx_ref"], "fx");
    const ownerRef = canonicalRefFrom(row, ["owner_ref", "track_ref", "take_ref"]);
    if (!ref || !ownerRef) return null;
    return { ref, owner_ref: ownerRef, plugin_name: stringOr(row.plugin_name ?? row.name, ""), plugin_id: stringOrNull(row.plugin_id), slot_index: integerOrNull(row.slot_index ?? row.index), bypassed: row.bypassed === true || row.enabled === false, summary: compactObject(row) };
  }).filter(Boolean);
}

function mapSends(rows) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "send_ref"], "send");
    const source = canonicalRefFrom(row, ["source_ref", "source_track_ref", "owner_ref"], "track");
    const target = canonicalRefFrom(row, ["target_ref", "destination_track_ref"], "track");
    if (!ref || !source || !target) return null;
    return { ref, owner_ref: source, source_ref: source, target_ref: target, send_kind: stringOr(row.send_kind, "track_send"), muted: row.muted === true, volume: finiteOrNull(row.volume), pan: finiteOrNull(row.pan), summary: compactObject(row) };
  }).filter(Boolean);
}

function mapEnvelopes(rows) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "envelope_ref"], "envelope");
    const ownerRef = canonicalRefFrom(row, ["owner_ref", "track_ref", "fx_ref", "send_ref"]);
    if (!ref || !ownerRef) return null;
    return { ref, owner_ref: ownerRef, target_ref: canonicalRefFrom(row, ["target_ref", "fx_ref", "send_ref"]), parent_kind: stringOrNull(row.parent_kind), name: stringOr(row.name, ""), lane_kind: stringOrNull(row.lane_kind ?? row.envelope_kind), active: booleanOrNull(row.active), armed: booleanOrNull(row.armed), visible: booleanOrNull(row.visible), show_lane: booleanOrNull(row.show_lane), point_count: integerOr(row.point_count, 0), automation_item_count: integerOr(row.automation_item_count, 0), summary: compactObject(row) };
  }).filter(Boolean);
}

function mapMarkers(rows) {
  return arrayOf(rows).map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "marker_ref", "region_ref"], row.kind === "region" ? "region" : row.kind === "marker" ? "marker" : undefined);
    if (!ref) return null;
    return { ref, owner_ref: "project:active", kind: row.kind ?? (ref.startsWith("region:") ? "region" : "marker"), start_seconds: finiteOrNull(row.start_seconds ?? row.position_seconds ?? row.start), end_seconds: finiteOrNull(row.end_seconds ?? row.end), name: stringOr(row.name, ""), index: integerOrNull(row.index), color: stringOrNull(row.color), summary: compactObject(row) };
  }).filter(Boolean);
}

function mapMedia(readback) {
  const sourceRows = Array.isArray(readback) ? readback : Array.isArray(readback.sources) ? readback.sources : arrayOf(readback.file_refs).map((ref) => ({ file_ref: ref }));
  return sourceRows.map((row) => {
    const ref = canonicalRefFrom(row, ["ref", "file_ref", "source_file_ref"], "file");
    if (!ref) return null;
    return { ref, owner_ref: "project:active", name: stringOrNull(row.name), path_fingerprint: stringOrNull(row.path_fingerprint), source_kind: stringOrNull(row.source_kind ?? row.source_type), media_type: stringOrNull(row.media_type), extension: stringOrNull(row.extension), offline: booleanOrNull(row.offline), length_seconds: finiteOrNull(row.length_seconds), channel_count: integerOrNull(row.channel_count), metadata_keys: Array.isArray(row.metadata_keys) ? row.metadata_keys : undefined, summary: compactObject(row) };
  }).filter(Boolean);
}

function simpleProjection(scope, rows, coverage, sourceCount = 0) {
  if (sourceCount > 0 && rows.length === 0) {
    return { blocker: { code: "NO_CANONICAL_ROWS", message: `Readback contained ${scope} entries but none had canonical refs.` } };
  }
  return { scopes: { [scope]: dedupeRows(rows) }, coverage: { [scope]: normalizeCoverage(coverage, "complete") } };
}

function createGuardedAdapter(adapter) {
  const wrapped = {};
  for (const key of Object.keys(adapter)) {
    const value = adapter[key];
    if (typeof value !== "function") wrapped[key] = value;
    else if (key === "snapshot") wrapped[key] = () => guardedSnapshot(adapter.snapshot());
    else if (key === "changedSince") wrapped[key] = (...args) => adapter.changedSince(...args);
    else wrapped[key] = (...args) => adapter[key](...args);
  }
  return Object.freeze(wrapped);
}

function guardedSnapshot(snapshot) {
  if (snapshot?.lifecycle !== "stale_session") return snapshot;
  return Object.freeze({ ...snapshot, snapshot_id: null, rows: EMPTY_ROWS, coverage: {}, rows_withheld: true });
}

function compactSnapshotEvidence(snapshot, projectRef) {
  const snapshotId = nonEmpty(snapshot?.snapshot_id);
  if (!snapshotId) return { snapshot_id: null, revision: null, freshness_token: null, revision_source: null, project_change_count: null };
  const projectChangeCount = projectChangeCountFromSnapshot(snapshot, projectRef);
  const freshnessMaterial = {
    snapshot_id: snapshotId,
    project_change_count: projectChangeCount,
    scopes: Object.entries(snapshot?.freshness_scopes ?? {})
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([scope, value]) => [scope, value?.snapshot_id ?? null, value?.status ?? null, value?.coverage_status ?? null, value?.observed_at ?? null]),
  };
  const freshnessToken = `freshness:alpha3.2d:${createHash("sha256").update(JSON.stringify(freshnessMaterial)).digest("hex").slice(0, 24)}`;
  return {
    snapshot_id: snapshotId,
    revision: projectChangeCount === null ? freshnessToken : `reaper-change-count:${projectChangeCount}`,
    freshness_token: freshnessToken,
    revision_source: projectChangeCount === null ? "project_index_snapshot" : "reaper_project_state_change_count",
    project_change_count: projectChangeCount,
  };
}

function projectChangeCountFromSnapshot(snapshot, projectRef) {
  const projectHead = arrayOf(snapshot?.rows?.selection_state).find((row) => row?.scope_kind === "project_head" && row?.ref === projectRef);
  return nonNegativeIntegerOrNull(projectHead?.summary?.change_count);
}

function mergeProjectHeadSelectionRows(currentRows, nextRows) {
  const existingProjectHead = arrayOf(currentRows).find((row) => row?.scope_kind === "project_head");
  const projectedProjectHead = arrayOf(nextRows).find((row) => row?.scope_kind === "project_head");
  const preserved = arrayOf(currentRows).filter((row) => row?.scope_kind !== "project_head");
  const projected = arrayOf(nextRows).filter((row) => row?.scope_kind !== "project_head");
  const projectHead = projectedProjectHead && {
    ...existingProjectHead,
    ...projectedProjectHead,
    summary: { ...compactObject(existingProjectHead?.summary), ...compactObject(projectedProjectHead.summary) },
  };
  const rows = [...preserved, ...projected];
  if (projectHead) rows.unshift(projectHead);
  const unique = new Map();
  for (const row of rows) {
    if (row?.ref && row?.scope_kind) unique.set(`${row.scope_kind}\0${row.ref}`, row);
  }
  return [...unique.values()].map((row) => {
    const {
      snapshot_id: _snapshotId,
      observed_at: _observedAt,
      payload_ref: _payloadRef,
      ...projected
    } = row;
    return projected;
  });
}

function selectionRowsWithProjectChangeCount(currentRows, projectRef, changeCount) {
  return mergeProjectHeadSelectionRows(currentRows, [{
    ref: projectRef,
    owner_ref: null,
    scope_kind: "project_head",
    summary: { change_count: changeCount },
  }]);
}

async function validateRuntimeIdentity(options, stateRoot) {
  const blockers = [];
  const bridgeOwner = nonEmpty(options.bridgeOwner ?? options.bridge_owner);
  const bridgeGeneration = options.bridgeGeneration ?? options.bridge_generation;
  if (!bridgeOwner) blockers.push(blocker("BRIDGE_OWNER_REQUIRED", "A non-empty bridge owner is required."));
  if (!Number.isInteger(bridgeGeneration) || bridgeGeneration < 0) blockers.push(blocker("BRIDGE_GENERATION_REQUIRED", "A non-negative integer bridge generation is required."));

  let projectPath = null;
  const requestedPath = options.projectPath ?? options.currentProjectPath ?? options.project_path;
  if (requestedPath !== undefined) {
    if (typeof requestedPath !== "string" || !path.isAbsolute(requestedPath) || path.normalize(requestedPath) !== requestedPath) {
      blockers.push(blocker("PROJECT_PATH_INVALID", "Project path must be absolute and normalized."));
    } else {
      try {
        const stat = await lstat(requestedPath);
        const canonical = await realpath(requestedPath);
        if (stat.isSymbolicLink() || !stat.isFile() || canonical !== requestedPath) blockers.push(blocker("PROJECT_PATH_NOT_CANONICAL", "Project path must be a real canonical non-symlink file."));
        else projectPath = canonical;
      } catch (error) {
        blockers.push(blocker("PROJECT_PATH_NOT_REAL_FILE", "Project path must name an existing real project file.", error));
      }
    }
  }
  const requestedRef = nonEmpty(options.projectRef ?? options.project_ref);
  const projectRef = requestedRef && isCanonicalRef(requestedRef, "project")
    ? requestedRef
    : projectPath
      ? `project:path:${projectPath}`
      : null;
  if (!projectRef) blockers.push(blocker("PROJECT_IDENTITY_REQUIRED", "A canonical project_ref or current project path is required."));
  if (requestedRef && !isCanonicalRef(requestedRef, "project")) blockers.push(blocker("PROJECT_REF_INVALID", "project_ref must be a canonical project ref."));
  return blockers.length > 0 ? { ok: false, blockers } : {
    ok: true,
    identity: Object.freeze({ project_ref: projectRef, project_path: projectPath, bridge_owner: bridgeOwner, bridge_generation: bridgeGeneration }),
  };
}

function validateObservationIdentity(input, expected, sessionId) {
  const identity = input.identity ?? input.context?.identity ?? input.request?.context?.identity ?? input.context ?? input.request?.context ?? {};
  const projectRef = identity.project_ref ?? identity.projectRef ?? input.project_ref ?? input.projectRef;
  const projectPath = identity.project_path ?? identity.projectPath ?? input.project_path ?? input.projectPath;
  const owner = identity.bridge_owner ?? identity.bridgeOwner ?? input.bridge_owner ?? input.bridgeOwner;
  const generation = identity.bridge_generation ?? identity.bridgeGeneration ?? input.bridge_generation ?? input.bridgeGeneration;
  const session = identity.session_id ?? identity.sessionId ?? input.session_id ?? input.sessionId;
  if (!projectRef && !projectPath) return identityFailure("OBSERVATION_PROJECT_IDENTITY_REQUIRED", "Observation must include current project_ref or canonical project path.");
  if (projectRef && projectRef !== expected.project_ref) return identityFailure("OBSERVATION_PROJECT_MISMATCH", "Observation project_ref does not match the bound Project Index identity.", { expected: expected.project_ref, actual: projectRef });
  if (projectPath && projectPath !== expected.project_path) return identityFailure("OBSERVATION_PROJECT_MISMATCH", "Observation project path does not match the bound Project Index identity.", { expected: expected.project_path, actual: projectPath });
  if (owner !== expected.bridge_owner) return identityFailure("OBSERVATION_BRIDGE_OWNER_MISMATCH", "Observation bridge owner does not match the bound Project Index identity.");
  if (generation !== expected.bridge_generation) return identityFailure("OBSERVATION_BRIDGE_GENERATION_MISMATCH", "Observation bridge generation does not match the bound Project Index identity.");
  if (session !== sessionId) return identityFailure("OBSERVATION_SESSION_MISMATCH", "Observation session id does not match the server-managed installed session.");
  return { ok: true };
}

function deriveManagedSessionId(identity, logicalSessionKey, processIdentity = PROCESS_INSTANCE_KEY) {
  const logical = typeof logicalSessionKey === "string" && logicalSessionKey ? logicalSessionKey : "default-installed-session";
  const digest = createHash("sha256").update(JSON.stringify({
    logical,
    process_identity: processIdentity,
    project_ref: identity.project_ref,
    project_path: identity.project_path,
    bridge_owner: identity.bridge_owner,
    bridge_generation: identity.bridge_generation,
  })).digest("hex").slice(0, 32);
  return `session:alpha3.2d:${digest}`;
}

function deriveRuntimeStorageOwnership(identity, logicalSessionKey, explicitProcessIdentity) {
  const processIdentity = nonEmpty(explicitProcessIdentity) ?? PROCESS_INSTANCE_KEY;
  const sessionId = deriveManagedSessionId(identity, logicalSessionKey, processIdentity);
  const isolationKey = createHash("sha256").update(sessionId).digest("hex").slice(0, 24);
  return Object.freeze({
    mode: "process_isolated",
    owner_id: `project-index-owner:${isolationKey}`,
    isolation_key: isolationKey,
    isolation_dimensions: Object.freeze(["project", "bridge_owner", "bridge_generation", "logical_session", "process_instance"]),
    process_identity_source: nonEmpty(explicitProcessIdentity) ? "explicit_process_identity" : "runtime_process_instance",
    shared_between_processes: false,
    peer_database_unlink_allowed: false,
    recovery_scope: "owned_database_only",
    db_basename: `openreaper-project-index.${isolationKey}.sqlite`,
    session_id: sessionId,
  });
}

async function loadSqliteBackend(loader) {
  try {
    const module = typeof loader === "function" ? await loader() : await import("node:sqlite");
    if (typeof module?.DatabaseSync !== "function") throw new Error("DatabaseSync unavailable");
    return { ok: true };
  } catch (error) {
    return { ok: false, blocker: blocker("SQLITE_BACKEND_UNAVAILABLE", "node:sqlite is unavailable; Project Index is resident-only and degraded for this process.", error) };
  }
}

function createFailedRuntimeOpen({ observedAt, blockers, dbPath, ownership = null }) {
  const status = () => Object.freeze({ contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT, ok: false, backend: "none", db_path: dbPath ?? null, lifecycle: "degraded", adapter_lifecycle: "missing", degraded: true, degraded_reason: blockers[0]?.code ?? "RUNTIME_OPEN_FAILED", ownership, rows_available: false, row_counts: {}, blockers });
  const notOpen = () => invalidationFailure("runtime_not_open", "RUNTIME_NOT_OPEN", "Project Index runtime did not open.");
  return Object.freeze({ contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT, ok: false, backend: "none", db_path: dbPath ?? null, session_id: ownership?.session_id ?? null, ownership, adapter: null, observed_at: observedAt, blockers, get lifecycle() { return status().lifecycle; }, get adapter_lifecycle() { return status().adapter_lifecycle; }, get degraded_reason() { return status().degraded_reason; }, status, statusSummary: status, status_summary: status, observeSuccessfulTemplateExecution: () => observationFailure("runtime_not_open", "RUNTIME_NOT_OPEN", "Project Index runtime did not open."), observeArtifactPayload: () => observationFailure("runtime_not_open", "RUNTIME_NOT_OPEN", "Project Index runtime did not open."), invalidateScopes: notOpen, reconcileProjectRevision: notOpen, beginLogicalRefresh: notOpen, commitLogicalRefresh: notOpen, abortLogicalRefresh: notOpen, close: status });
}

function observationFailure(status, code, message, details = undefined) {
  return Object.freeze({ contract: ALPHA3_2D_PROJECT_INDEX_OBSERVATION_CONTRACT, ok: false, status, observed: false, blockers: [blocker(code, message, details)], child_calls_executed: 0 });
}
function invalidationFailure(status, code, message, details = undefined) {
  return Object.freeze({ contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT, ok: false, status, blockers: [blocker(code, message, details)], sqlite_rows_are_candidates_only: true });
}
function blocker(code, message, detail) {
  const result = { code, message, recoverable: true };
  if (detail !== undefined) result.details = errorDetail(detail);
  return Object.freeze(result);
}
function errorDetail(value) {
  if (value instanceof Error || (isObject(value) && typeof value.message === "string")) return { code: value.code ?? null, message: String(value.message) };
  return value;
}
function pathFailure(code, message, error) { return { ok: false, state_root: null, db_path: null, blockers: [blocker(code, message, error)] }; }
function identityFailure(code, message, details) { return { ok: false, code, message, details }; }
function executionTemplateId(execution) { return execution.template?.id ?? execution.template_id ?? execution.id ?? null; }
function observationTime(execution, now) { return safeIso(execution.observed_at ?? execution.result?.observed_at ?? execution.result?.readback?.observed_at, now); }
function observationSnapshotId(execution, templateId, observedAt) {
  const requestId = execution.request?.id ?? execution.request_id;
  if (typeof requestId === "string" && requestId) return `snapshot:alpha3.2d:${requestId}`;
  return `snapshot:alpha3.2d:${createHash("sha256").update(`${templateId}\0${observedAt}`).digest("hex").slice(0, 24)}`;
}
function collectArtifactRefs(result, readback) {
  const candidates = [...arrayOf(result.artifacts), ...arrayOf(result.refs), ...arrayOf(readback.artifacts), readback.artifact_ref, result.artifact_ref];
  return [...new Set(candidates.map((entry) => typeof entry === "string" ? entry : entry?.ref).filter((ref) => isCanonicalRef(ref, "artifact")))];
}
function countSnapshotRows(snapshot) { return Object.fromEntries(Object.entries(snapshot?.rows ?? {}).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0])); }
function identityBlockersFromSnapshot(snapshot) { return Array.isArray(snapshot?.identity_blockers) ? snapshot.identity_blockers : []; }
function coverageOf(readback, fallback) { return readback?.truncated === true ? "truncated" : fallback; }
function normalizeCoverage(value, fallback) {
  const aliases = { bounded: "partial", bounded_per_track: "partial", complete_page: "complete", paged_partial: "paged", counts_only: "head_only" };
  const normalized = aliases[value] ?? value;
  return ["complete", "partial", "head_only", "selected_only", "paged", "truncated", "unknown", "failed"].includes(normalized) ? normalized : fallback;
}
function canonicalRefFrom(row, fields, kind) {
  if (!isObject(row)) return null;
  for (const field of fields) if (isCanonicalRef(row[field], kind)) return row[field];
  return null;
}
function canonicalProjectRef(value) { return isCanonicalRef(value, "project") ? value : null; }
function isCanonicalRef(value, kind) {
  if (typeof value !== "string" || value.length < 3 || value.length > 4096 || /[\0\r\n]/.test(value)) return false;
  const match = value.match(/^([a-z][a-z0-9_]*):(.+)$/);
  if (!match) return false;
  return kind ? match[1] === kind : true;
}
function dedupeRows(rows) { const map = new Map(); for (const row of rows) if (row?.ref) map.set(row.ref, row); return [...map.values()]; }
function compactObject(value) { if (!isObject(value)) return {}; const result = {}; for (const [key, nested] of Object.entries(value)) if (nested !== undefined && key !== "payload") result[key] = nested; return result; }
function arrayOf(value) { return Array.isArray(value) ? value : []; }
function isObject(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function nonEmpty(value) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function stringOr(value, fallback) { return typeof value === "string" ? value : fallback; }
function stringOrNull(value) { return typeof value === "string" ? value : null; }
function integerOr(value, fallback) { return Number.isInteger(value) ? value : fallback; }
function integerOrNull(value) { return Number.isInteger(value) ? value : null; }
function nonNegativeIntegerOrNull(value) { return Number.isInteger(value) && value >= 0 ? value : null; }
function finiteOrNull(value) { return Number.isFinite(value) ? value : null; }
function booleanOrNull(value) { return typeof value === "boolean" ? value : null; }
function positiveBound(value, fallback) { return Number.isInteger(value) && value > 0 ? value : fallback; }
function pathsOverlap(left, right) { return left === right || left.startsWith(`${right}${path.sep}`) || right.startsWith(`${left}${path.sep}`); }
function safeIso(value, now) { if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString(); try { const current = now(); const date = current instanceof Date ? current : new Date(current); if (!Number.isNaN(date.getTime())) return date.toISOString(); } catch {} return new Date().toISOString(); }
function jsonByteLength(value) { try { return Buffer.byteLength(JSON.stringify(value), "utf8"); } catch { return null; } }
