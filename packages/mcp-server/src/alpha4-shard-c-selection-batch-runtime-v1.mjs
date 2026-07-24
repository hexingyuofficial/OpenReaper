export const ALPHA4_SHARD_C_SELECTION_BATCH_RUNTIME_CONTRACT = "alpha4.shard-c.selection_batch_runtime.v1";
export const ALPHA4_SHARD_C_CANDIDATE_CEILING = 512;
export const ALPHA4_SHARD_C_BATCH_CHUNK_SIZE = 128;

const PREDICATE_FIELDS = Object.freeze({
  track: new Set(["muted", "soloed", "record_armed", "name"]),
  item: new Set(["muted", "locked", "active_take_name"]),
});

/**
 * Resolve only a bounded candidate packet. SQLite rows may seed candidates,
 * but the supplied live resolver remains the authority before any mutation.
 */
export async function resolveAlpha4ShardCSelection({ selector, candidateRows = [], captureSelection, liveResolve }) {
  const invalid = validateSelector(selector);
  if (invalid) return blocked(invalid);
  if (typeof liveResolve !== "function") return blocked("SELECTOR_LIVE_RESOLVER_UNAVAILABLE");

  let candidates;
  let snapshot;
  if (selector.kind === "current_selection") {
    if (typeof captureSelection !== "function") return blocked("SELECTOR_CAPTURE_UNAVAILABLE");
    const captured = await captureSelection(selector.entity_kind);
    snapshot = captured?.snapshot;
    candidates = captured?.rows;
    if (captured?.complete === false) return blocked("SELECTOR_TRUNCATED");
  } else if (selector.kind === "predicate") {
    candidates = candidateRows.filter((row) => predicateMatches(row, selector));
    snapshot = { ...(selector.snapshot ?? {}), frozen_refs: candidates.map((row) => row.ref) };
  } else {
    candidates = selector.refs.map((ref) => ({ ref, entity_kind: ref.split(":", 1)[0] }));
    snapshot = { frozen_refs: selector.refs };
  }

  if (!Array.isArray(candidates)) return blocked("SELECTOR_CAPTURE_INVALID");
  if (candidates.length === 0) return blocked("SELECTOR_EMPTY");
  if (candidates.length > ALPHA4_SHARD_C_CANDIDATE_CEILING) return blocked("SELECTOR_LIMIT_EXCEEDED", { target_count: candidates.length });
  const expectedEntityKind = selectorEntityKind(selector);
  if (expectedEntityKind && candidates.some((row) => row?.entity_kind !== expectedEntityKind)) return blocked("SELECTOR_TYPE_MISMATCH");
  if (candidates.some((row) => row?.is_master === true)) return blocked("PROTECTED_MASTER_TARGET");

  const frozenRefs = candidates.map((row) => row.ref);
  if (new Set(frozenRefs).size !== frozenRefs.length || frozenRefs.some((ref) => !canonicalRef(ref))) return blocked("SELECTOR_CAPTURE_INVALID");
  const live = await liveResolve({ refs: frozenRefs, snapshot, entity_kind: selectorEntityKind(selector) });
  if (!live?.ok) return blocked(live?.code ?? "PREWRITE_REF_DRIFT", live?.details);
  if (!sameRefs(frozenRefs, live.refs)) return blocked("PREWRITE_REF_DRIFT", { frozen_refs: frozenRefs, live_refs: live.refs ?? [] });
  if (snapshot?.selection_token && live.snapshot?.selection_token && snapshot.selection_token !== live.snapshot.selection_token) {
    return blocked("PREWRITE_SELECTION_DRIFT");
  }
  return Object.freeze({ ok: true, refs: Object.freeze(frozenRefs), snapshot: Object.freeze({ ...snapshot, frozen_refs: frozenRefs }), sqlite_candidates_only: true });
}

/**
 * Shared bounded dispatcher. Registered callers supply a single fixed Template
 * dependency; this function never accepts a model-supplied Template program.
 */
export async function dispatchAlpha4ShardCBatch({ request = {}, fixedTemplateId, resolveTargets, validateRows, preflight, mutateChunk, readback, openUndo, closeUndo }) {
  if (typeof fixedTemplateId !== "string" || !fixedTemplateId.startsWith("template.")) return blocked("BATCH_FIXED_TEMPLATE_REQUIRED");
  if (request.template_id !== undefined && request.template_id !== fixedTemplateId) return blocked("BATCH_FIXED_TEMPLATE_DEPENDENCY_INJECTION_REJECTED");
  if (request.recipe?.fixed_template_id !== undefined && request.recipe.fixed_template_id !== fixedTemplateId) return blocked("RECIPE_FIXED_TEMPLATE_DEPENDENCY_INJECTION_REJECTED");
  if (request.node_graph?.valid === false) return blocked("BATCH_NODE_GRAPH_INVALID");
  if (request.expression !== undefined && (typeof request.expression !== "string" || request.expression.includes("???"))) return blocked("BATCH_EXPRESSION_INVALID");
  if (typeof resolveTargets !== "function" || typeof preflight !== "function" || typeof mutateChunk !== "function" || typeof readback !== "function") return blocked("BATCH_EXECUTOR_UNAVAILABLE");

  const resolved = await resolveTargets(request);
  if (!resolved?.ok) return blocked(resolved?.code ?? "BATCH_TARGET_RESOLUTION_FAILED", resolved?.details);
  const refs = resolved.refs;
  if (!Array.isArray(refs) || refs.length === 0) return blocked("BATCH_EMPTY_SELECTION");
  if (refs.length > ALPHA4_SHARD_C_CANDIDATE_CEILING) return blocked("BATCH_CANDIDATE_CEILING_EXCEEDED", { target_count: refs.length });
  if (new Set(refs).size !== refs.length || refs.some((ref) => !canonicalRef(ref))) return blocked("BATCH_SCHEMA_INVALID");

  // All caller-provided row validation and live preflight finish before Undo opens.
  const rows = Array.isArray(request.rows) ? request.rows : refs.map((ref) => ({ ref }));
  if (typeof validateRows === "function") {
    const validation = await validateRows(rows, { refs, request });
    if (!validation?.ok) return blocked(validation?.code ?? "BATCH_SCHEMA_INVALID", validation?.details);
  }
  const prepared = await preflight({ refs, rows, snapshot: resolved.snapshot, request, fixed_template_id: fixedTemplateId });
  if (!prepared?.ok) return blocked(prepared?.code ?? "BATCH_PREFLIGHT_BLOCKED", prepared?.details);
  if (!sameRefs(refs, prepared.refs ?? refs)) return blocked("BATCH_REF_DRIFT", { frozen_refs: refs, live_refs: prepared.refs ?? [] });

  let undo = null;
  let writes = 0;
  try {
    if (typeof openUndo === "function") undo = await openUndo({ request, refs, fixed_template_id: fixedTemplateId });
    for (let offset = 0; offset < refs.length; offset += ALPHA4_SHARD_C_BATCH_CHUNK_SIZE) {
      const chunk = refs.slice(offset, offset + ALPHA4_SHARD_C_BATCH_CHUNK_SIZE);
      const mutation = await mutateChunk({ refs: chunk, rows: rows.slice(offset, offset + chunk.length), request, fixed_template_id: fixedTemplateId, undo });
      if (!mutation?.ok) return partial("BATCH_NATIVE_EXECUTION_FAILED", writes, undo, mutation?.details);
      writes += chunk.length;
    }
    const verification = await readback({ refs, request, fixed_template_id: fixedTemplateId, undo });
    if (!verification?.ok) return failed("BATCH_VERIFICATION_READBACK_FAILED", writes, undo, verification?.details);
    return Object.freeze({ contract: ALPHA4_SHARD_C_SELECTION_BATCH_RUNTIME_CONTRACT, ok: true, status: "completed", refs: Object.freeze([...refs]), writes, chunks: Math.ceil(refs.length / ALPHA4_SHARD_C_BATCH_CHUNK_SIZE), undo, recovery: { posture: "single_undo_available" } });
  } finally {
    if (undo && typeof closeUndo === "function") await closeUndo({ undo, writes });
  }
}

function validateSelector(selector) {
  if (!object(selector)) return "SELECTOR_TYPE_INVALID";
  if (!['current_selection', 'explicit_refs', 'predicate'].includes(selector.kind)) return "SELECTOR_KIND_INVALID";
  if (selector.kind === 'explicit_refs' && (!Array.isArray(selector.refs) || selector.refs.length === 0)) return "SELECTOR_REFS_REQUIRED";
  if (selector.kind === 'current_selection' && !PREDICATE_FIELDS[selector.entity_kind]) return "SELECTOR_ENTITY_KIND_INVALID";
  if (selector.kind === 'predicate') {
    if (!PREDICATE_FIELDS[selector.entity_kind]?.has(selector.field)) return "PREDICATE_FIELD_INVALID";
    if (!['equals', 'contains', 'starts_with'].includes(selector.operator)) return "PREDICATE_OPERATOR_INVALID";
    const stringField = (selector.entity_kind === "track" && selector.field === "name") || (selector.entity_kind === "item" && selector.field === "active_take_name");
    const booleanField = !stringField;
    if (stringField && typeof selector.value !== "string") return "PREDICATE_VALUE_INVALID";
    if (booleanField && typeof selector.value !== "boolean") return "PREDICATE_VALUE_INVALID";
    if (booleanField && selector.operator !== 'equals') return "PREDICATE_VALUE_OPERATOR_INVALID";
  }
  return null;
}

function predicateMatches(row, selector) {
  if (!object(row) || row.entity_kind !== selector.entity_kind) return false;
  const value = row[selector.field];
  if (selector.operator === 'equals') return value === selector.value;
  if (typeof value !== 'string') return false;
  return selector.operator === 'starts_with' ? value.startsWith(selector.value) : value.includes(selector.value);
}
function selectorEntityKind(selector) { return selector.kind === 'explicit_refs' ? null : selector.entity_kind; }
function canonicalRef(ref) { return typeof ref === 'string' && /^(track|item):guid:\{[^}]+\}$/u.test(ref); }
function sameRefs(left, right) { return Array.isArray(left) && Array.isArray(right) && left.length === right.length && left.every((ref, index) => ref === right[index]); }
function object(value) { return value !== null && typeof value === 'object' && !Array.isArray(value); }
function blocked(code, details = undefined) { return Object.freeze({ contract: ALPHA4_SHARD_C_SELECTION_BATCH_RUNTIME_CONTRACT, ok: false, status: "blocked", error: { code, stage: "preflight", ...(details === undefined ? {} : { details }) }, writes: 0, undo: null, recovery: { posture: "zero_write" } }); }
function partial(code, writes, undo, details) { return Object.freeze({ contract: ALPHA4_SHARD_C_SELECTION_BATCH_RUNTIME_CONTRACT, ok: false, status: "partial_failure", error: { code, stage: "mutation", ...(details === undefined ? {} : { details }) }, writes, undo, recovery: { posture: "partial_writes_recoverable_with_single_undo" } }); }
function failed(code, writes, undo, details) { return Object.freeze({ contract: ALPHA4_SHARD_C_SELECTION_BATCH_RUNTIME_CONTRACT, ok: false, status: "failed", error: { code, stage: "readback", ...(details === undefined ? {} : { details }) }, writes, undo, recovery: { posture: "writes_require_single_undo_recovery" } }); }
