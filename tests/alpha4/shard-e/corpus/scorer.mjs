import { buildOracleExpectation } from "./oracle.mjs";

export const SCORER_CONTRACT = "alpha4.shard-e.paired-scorer.v1";

export const SCORE_GATES = Object.freeze({
  supported_capture_compiler_replay_truth: Object.freeze({ threshold: 1, unit: "supported_fact" }),
  zero_wrong_extra_hidden_mutation_or_false_success: Object.freeze({ threshold: 1, unit: "trial" }),
  ambiguity_undo_reconnect_truth: Object.freeze({ threshold: 1, unit: "applicable_trial" }),
  first_attempt_success: Object.freeze({ threshold: 0.9, unit: "trial" }),
  one_recovery_success: Object.freeze({ threshold: 0.95, unit: "trial" }),
});

function clone(value) {
  return structuredClone(value);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function same(left, right) {
  return stableStringify(left) === stableStringify(right);
}

function hasFact(facts, expectedFact) {
  return facts?.some((fact) => fact.fact_id === expectedFact.fact_id && fact.support_status === expectedFact.support_status && same(fact.signature, expectedFact.signature)) === true;
}

function expectedMutationByFact(replay, factId) {
  return replay?.mutations?.find((mutation) => mutation.fact_id === factId) ?? null;
}

function scoreLifecycle(expected, actual) {
  const lifecycle = expected.lifecycle;
  const submitted = actual?.lifecycle ?? {};
  const save = same(submitted.save, lifecycle.save);
  const list = same(submitted.list, lifecycle.list);
  const get = same(submitted.get, lifecycle.get);
  const reconnect = same(submitted.reconnect, lifecycle.reconnect);
  const replay = same(submitted.replay, lifecycle.replay);
  return {
    save_identity_preserved: save,
    list_identity_preserved: list,
    get_identity_preserved: get,
    reconnect_rediscovery: reconnect,
    one_call_replay: replay,
    all: save && list && get && reconnect && replay,
  };
}

function scoreReplayTruth(expected, actual) {
  const expectedReplay = expected.lifecycle.replay;
  const replay = actual?.lifecycle?.replay ?? {};
  const mutationRowsMatch = same(replay.mutations ?? [], expectedReplay.mutations ?? []);
  const readbackMatches = same(replay.readback, expectedReplay.readback);
  const undoMatches = same(replay.undo, expectedReplay.undo);
  const noFalseSuccess = replay.false_success === false && expectedReplay.false_success === false;
  const noHiddenMutation = Array.isArray(replay.hidden_mutations) && replay.hidden_mutations.length === 0;
  const noExtraMutation = Array.isArray(replay.extra_mutations) && replay.extra_mutations.length === 0;
  return {
    mutation_rows: mutationRowsMatch,
    readback: readbackMatches,
    undo: undoMatches,
    no_false_success: noFalseSuccess,
    no_hidden_mutation: noHiddenMutation,
    no_extra_mutation: noExtraMutation,
    zero_write_when_blocked: expectedReplay.status !== "blocked" || (replay.mutation === "zero_write" && (replay.mutations?.length ?? 0) === 0),
    no_wrong_extra_hidden_mutation_or_false_success: mutationRowsMatch && noFalseSuccess && noHiddenMutation && noExtraMutation && (expectedReplay.status !== "blocked" || (replay.mutation === "zero_write" && (replay.mutations?.length ?? 0) === 0)),
  };
}

export function scoreTrial(trial, submission) {
  const expected = buildOracleExpectation(trial);
  const actual = submission ?? {};
  const expectedFacts = expected.capture.facts;
  const factScores = expectedFacts.map((expectedFact) => {
    const captured = hasFact(actual.capture?.facts, expectedFact);
    const compilerIncludes = actual.compiler?.fact_ids?.includes(expectedFact.fact_id) === (expectedFact.support_status === "supported");
    const compilerFacts = actual.compiler?.facts?.some((fact) => fact.fact_id === expectedFact.fact_id && fact.support_status === expectedFact.support_status && same(fact.signature, expectedFact.signature)) === true;
    const replayRequired = expectedFact.support_status === "supported" && expected.lifecycle.replay.status === "succeeded";
    const replayMutation = replayRequired && same(expectedMutationByFact(expected.lifecycle.replay, expectedFact.fact_id), expectedMutationByFact(actual.lifecycle?.replay, expectedFact.fact_id));
    return {
      fact_id: expectedFact.fact_id,
      support_status: expectedFact.support_status,
      capture: captured,
      compiler: compilerIncludes && compilerFacts,
      replay: replayRequired ? replayMutation : true,
      passed: captured && compilerIncludes && compilerFacts && (replayRequired ? replayMutation : true),
    };
  });
  const supportedFacts = factScores.filter((fact) => fact.support_status === "supported");
  const supportedTruth = supportedFacts.length === 0 || supportedFacts.every((fact) => fact.passed);
  const captureStatus = actual.capture?.status === expected.capture.status;
  const compilerStatus = actual.compiler?.status === expected.compiler.status
    && same(actual.compiler?.dependency_order ?? [], expected.compiler.dependency_order)
    && same(actual.compiler?.fact_ids ?? [], expected.compiler.fact_ids);
  const replayTruth = scoreReplayTruth(expected, actual);
  const lifecycleTruth = scoreLifecycle(expected, actual);
  const ambiguityApplicable = trial.scenario.family === "ambiguity";
  const ambiguityTruth = !ambiguityApplicable || (
    actual.compiler?.status === "blocked"
    && actual.compiler?.block_reason === "ambiguous_intent"
    && actual.lifecycle?.ambiguity?.question_count === 1
    && actual.lifecycle.ambiguity.chosen === false
    && replayTruth.zero_write_when_blocked
  );
  const undoTruth = replayTruth.undo;
  const reconnectApplicable = trial.scenario.reconnect === true;
  const reconnectTruth = !reconnectApplicable || lifecycleTruth.reconnect_rediscovery;
  const supportedCaptureCompilerReplayTruth = supportedTruth && captureStatus && compilerStatus && (expected.lifecycle.replay.status === "blocked" || replayTruth.readback);
  const lifecycleComplete = lifecycleTruth.all;
  const coreSuccess = supportedCaptureCompilerReplayTruth && replayTruth.no_wrong_extra_hidden_mutation_or_false_success && ambiguityTruth && undoTruth && reconnectTruth && (expected.compiler.status === "blocked" || lifecycleComplete);
  const firstAttemptSuccess = actual.attempts?.first_attempt === true && coreSuccess;
  const oneRecoverySuccess = actual.attempts?.one_recovery === true && coreSuccess;
  return {
    contract: SCORER_CONTRACT,
    trial_id: trial.trial_id,
    scenario_id: trial.scenario_id,
    demonstration_size: trial.demonstration_size,
    fact_scores: factScores,
    fact_gate: {
      passed: supportedCaptureCompilerReplayTruth,
      supported_count: supportedFacts.length,
      passed_count: supportedFacts.filter((fact) => fact.passed).length,
      rate: supportedFacts.length === 0 ? 1 : supportedFacts.filter((fact) => fact.passed).length / supportedFacts.length,
    },
    scenario_gate: {
      passed: coreSuccess,
      capture_truth: captureStatus,
      compiler_truth: compilerStatus,
      lifecycle_truth: lifecycleComplete,
      replay_truth: replayTruth,
      ambiguity_truth: ambiguityTruth,
      undo_truth: undoTruth,
      reconnect_truth: reconnectTruth,
    },
    lifecycle: lifecycleTruth,
    first_attempt_success: firstAttemptSuccess,
    one_recovery_success: oneRecoverySuccess,
    passed: coreSuccess,
  };
}

function ratio(passed, total) {
  return total === 0 ? 1 : passed / total;
}

function gate(name, passed, total, threshold) {
  const rate = ratio(passed, total);
  return { name, passed, total, rate, threshold, passed_gate: rate >= threshold };
}

export function scoreCorpus(corpus, submissionsByTrial) {
  const results = corpus.trials.map((trial) => {
    const submission = submissionsByTrial instanceof Map
      ? submissionsByTrial.get(trial.trial_id)
      : submissionsByTrial?.[trial.trial_id];
    return scoreTrial(trial, submission);
  });
  const supportedFactResults = results.flatMap((result) => result.fact_scores.filter((fact) => fact.support_status === "supported"));
  const zeroMutationResults = results.map((result) => result.scenario_gate.replay_truth.no_wrong_extra_hidden_mutation_or_false_success);
  const ambiguityResults = results.filter((result) => result.scenario_id === "ambiguous_target").map((result) => result.scenario_gate.ambiguity_truth);
  const undoResults = results.map((result) => result.scenario_gate.undo_truth);
  const reconnectResults = results.filter((result) => result.scenario_id === "reconnect_replay").map((result) => result.scenario_gate.reconnect_truth);
  const firstAttemptResults = results.map((result) => result.first_attempt_success);
  const recoveryResults = results.map((result) => result.one_recovery_success);
  const scenarioGroups = new Map();
  for (const result of results) {
    const group = scenarioGroups.get(result.scenario_id) ?? [];
    group.push(result);
    scenarioGroups.set(result.scenario_id, group);
  }
  const scenarioScores = Object.fromEntries([...scenarioGroups.entries()].map(([scenarioId, group]) => [scenarioId, {
    trial_count: group.length,
    passed_count: group.filter((result) => result.passed).length,
    rate: ratio(group.filter((result) => result.passed).length, group.length),
    fact_rate: ratio(group.flatMap((result) => result.fact_scores.filter((fact) => fact.support_status === "supported")).filter((fact) => fact.passed).length, group.flatMap((result) => result.fact_scores.filter((fact) => fact.support_status === "supported")).length),
  }]));
  const gates = [
    gate("supported_capture_compiler_replay_truth", supportedFactResults.filter((fact) => fact.passed).length, supportedFactResults.length, SCORE_GATES.supported_capture_compiler_replay_truth.threshold),
    gate("zero_wrong_extra_hidden_mutation_or_false_success", zeroMutationResults.filter(Boolean).length, zeroMutationResults.length, SCORE_GATES.zero_wrong_extra_hidden_mutation_or_false_success.threshold),
    gate("ambiguity_undo_reconnect_truth", [...ambiguityResults, ...undoResults, ...reconnectResults].filter(Boolean).length, ambiguityResults.length + undoResults.length + reconnectResults.length, SCORE_GATES.ambiguity_undo_reconnect_truth.threshold),
    gate("first_attempt_success", firstAttemptResults.filter(Boolean).length, firstAttemptResults.length, SCORE_GATES.first_attempt_success.threshold),
    gate("one_recovery_success", recoveryResults.filter(Boolean).length, recoveryResults.length, SCORE_GATES.one_recovery_success.threshold),
  ];
  return {
    contract: SCORER_CONTRACT,
    trial_count: results.length,
    results,
    scenario_scores: scenarioScores,
    gates: Object.fromEntries(gates.map((item) => [item.name, item])),
    all_gates_passed: gates.every((item) => item.passed_gate),
  };
}

export function makeSubmissionMap(corpus, submissionFactory) {
  return new Map(corpus.trials.map((trial) => [trial.trial_id, clone(submissionFactory(trial))]));
}
