import { createHash } from "node:crypto";

export const ALPHA4_E_LIVE_VERIFIER_CONTRACT = "openreaper.alpha4.e.live_verifier.v1";

const LEARNER_FORBIDDEN = Object.freeze([
  "teacher_prompt",
  "transcript",
  "calls",
  "evidence",
  "manifest",
  "hidden",
  "source:alpha4-shard-e",
]);

export function verifyDemonstratorCapture(trial, capture) {
  const expectedFacts = semanticSignature(trial.semantic_facts);
  const observedFacts = semanticSignature(capture?.semantic_facts);
  const expectedIntent = semanticSignature(trial.intent);
  const observedIntent = semanticSignature(capture?.intent_summary);
  const checks = {
    contract: capture?.contract === "openreaper.alpha4.e.demonstrator_capture.v1",
    trial_id: capture?.trial_id === trial.trial_id,
    operation_count: capture?.operation_count === trial.operation_count,
    scenario: capture?.scenario === trial.scenario,
    semantic_diff: expectedFacts === observedFacts,
    semantic_intent: expectedIntent === observedIntent,
    observation: canonicalJson(capture?.blocker_observation) === canonicalJson(trial.observation),
  };
  return Object.freeze({
    contract: ALPHA4_E_LIVE_VERIFIER_CONTRACT,
    ok: Object.values(checks).every(Boolean),
    checks: Object.freeze(checks),
    semantic_signature: expectedFacts,
    intent_signature: expectedIntent,
    attestation_digest: digest(canonicalJson({ trial_id: trial.trial_id, expectedFacts, expectedIntent, checks })),
  });
}

export function createLearnerInput({ trial, capture, verification, runtime, rowPrefix, recipeId }) {
  if (verification?.ok !== true) throw new Error(`Demonstrator capture verification failed for ${trial.trial_id}.`);
  const input = {
    contract: "openreaper.learning_capture.v1",
    capture_id: capture.capture_id,
    trial_id: capture.trial_id,
    operation_count: capture.operation_count,
    scenario: capture.scenario,
    semantic_facts: capture.semantic_facts,
    intent_summary: capture.intent_summary,
    blocker_observation: capture.blocker_observation,
    attestation: { status: "passed", digest: verification.attestation_digest },
    runtime,
    row_prefix: rowPrefix,
    recipe_id: recipeId,
  };
  const scan = scanLearnerInput(input);
  if (!scan.ok) throw new Error(`Learner input contains forbidden terms: ${scan.matches.join(", ")}`);
  return Object.freeze(input);
}

export function scanLearnerInput(input) {
  const encoded = canonicalJson(input).toLowerCase();
  const matches = LEARNER_FORBIDDEN.filter((term) => encoded.includes(term));
  return Object.freeze({ ok: matches.length === 0, matches: Object.freeze(matches) });
}

export function scoreAgentArtifact(trial, artifact) {
  const expectedBlocker = trial.observation.status === "blocked" ? trial.observation.code : null;
  const expectedStatus = expectedBlocker ? "blocked" : "compiled";
  const checks = {
    status: artifact?.status === expectedStatus,
    operation_count: artifact?.operation_count === trial.operation_count,
    semantic_diff: artifact?.semantic_signature === semanticSignature(trial.semantic_facts),
    semantic_intent: artifact?.intent_signature === semanticSignature(trial.intent),
    typed_blocker: expectedBlocker
      ? artifact?.typed_blocker?.code === expectedBlocker && artifact?.draft === null
      : artifact?.typed_blocker === null && artifact?.draft?.contract === "recipe.executable.draft.v1",
    projection_cardinality: expectedBlocker
      ? (artifact?.projection_rows?.length ?? 0) === 0
      : artifact?.projection_rows?.length === trial.operation_count,
  };
  return Object.freeze({ ok: Object.values(checks).every(Boolean), checks: Object.freeze(checks) });
}

export function verifyLiveReadback({ artifact, before, after, runResponse, expectMutation }) {
  const expectedRows = (artifact?.projection_rows ?? []).map((row) => ({
    ref: row.item_ref,
    length_seconds: row.item?.length_seconds,
  }));
  const expectedRefs = new Set(expectedRows.map((row) => row.ref));
  const beforeRows = itemRows(before).filter((row) => expectedRefs.has(row.ref));
  const afterRows = itemRows(after).filter((row) => expectedRefs.has(row.ref));
  const beforeByRef = new Map(beforeRows.map((row) => [row.ref, row]));
  const afterByRef = new Map(afterRows.map((row) => [row.ref, row]));
  const unchanged = canonicalJson(sortItemRows(beforeRows)) === canonicalJson(sortItemRows(afterRows));
  const lengthsMatch = expectedRows.every((expected) => {
    const actual = afterByRef.get(expected.ref)?.length_seconds;
    return Number.isFinite(actual)
      && Number.isFinite(expected.length_seconds)
      && Math.abs(actual - expected.length_seconds) <= 0.000001;
  });
  const undo = runResponse?.undo ?? null;
  const performance = runResponse?.performance ?? null;
  const checks = expectMutation ? {
    before_complete: beforeByRef.size === expectedRows.length,
    aggregate_item_lengths: afterByRef.size === expectedRows.length && lengthsMatch,
    readback_count: Number(runResponse?.execution_truth?.readback_count) > 0,
    undo_scope: undo?.scope === "whole_recipe",
    undo_opened: undo?.opened === true,
    undo_closed: undo?.closed === true && undo?.status === "closed",
    undo_proven: undo?.proven === true,
    no_rollback_claim: undo?.rollback_attempted === false && undo?.rollback_proven === false,
    performance_contract: performance?.gate_mode === "internal_acceptance_only" && performance?.runtime_cancellation === false,
    performance_gate: performance?.gate_ok === true && performance?.total_ms < 30_000,
  } : {
    zero_write: unchanged,
    carrier_rows_preserved: afterRows.length === expectedRows.length,
  };
  return Object.freeze({
    ok: Object.values(checks).every(Boolean),
    checks: Object.freeze(checks),
    expected_rows: Object.freeze(expectedRows),
    before_rows: Object.freeze(sortItemRows(beforeRows)),
    after_rows: Object.freeze(sortItemRows(afterRows)),
    rollback_attempted: undo?.rollback_attempted === true,
    rollback_proven: undo?.rollback_proven === true,
  });
}

export function exactRevisionIdentity(value) {
  return Object.freeze({
    recipe_id: value?.recipe_id ?? value?.identity?.recipe_id,
    version: value?.version ?? value?.identity?.version,
    revision: value?.revision ?? value?.identity?.revision,
    content_hash: value?.content_hash ?? value?.identity?.content_hash,
    validation_result_id: value?.validation_result_id ?? value?.identity?.validation_result_id,
  });
}

export function sameRevisionIdentity(left, right) {
  return ["recipe_id", "version", "revision", "content_hash", "validation_result_id"]
    .every((field) => left?.[field] !== undefined && left[field] === right?.[field]);
}

export function semanticSignature(value) {
  return digest(canonicalJson(value ?? null));
}

export function canonicalJson(value) {
  return JSON.stringify(sortValue(value));
}

function itemRows(response) {
  return (response?.result?.data?.rows ?? [])
    .filter((row) => typeof row?.ref === "string" && Number.isFinite(row?.length_seconds))
    .map((row) => ({ ref: row.ref, length_seconds: row.length_seconds }));
}

function sortItemRows(rows) {
  return [...rows].sort((left, right) => left.ref.localeCompare(right.ref));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sortValue(value[key])]));
  }
  return value;
}

function digest(value) {
  return createHash("sha256").update(String(value)).digest("hex");
}
