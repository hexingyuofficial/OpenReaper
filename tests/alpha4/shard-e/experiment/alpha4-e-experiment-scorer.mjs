import { REQUIRED_TRIAL_COUNT } from "../corpus/corpus.mjs";
import { scoreCorpus } from "../corpus/scorer.mjs";

export const ALPHA4_E_SCORER_CONTRACT = "alpha4.shard-e.dual-agent-scorer.v1";
export const REQUIRED_PROOFS = Object.freeze([
  "readback",
  "whole_recipe_undo",
  "reconnect_identity",
  "call_recipe_replay",
]);

export const OBSERVED_LIFECYCLE_BLOCKERS = Object.freeze({
  readback: "E_OBSERVED_READBACK_UNAVAILABLE",
  whole_recipe_undo: "E_OBSERVED_WHOLE_RECIPE_UNDO_UNAVAILABLE",
  reconnect_identity: "E_OBSERVED_RECONNECT_IDENTITY_UNAVAILABLE",
  call_recipe_replay: "E_OBSERVED_CALL_RECIPE_REPLAY_UNAVAILABLE",
});

function gate(name, passed, details = {}) {
  return { name, passed: passed === true, ...details };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function exactRevisionIdentity(arguments_) {
  if (!isObject(arguments_)) return null;
  const identity = ["recipe_id", "version", "revision", "content_hash", "validation_result_id"];
  if (!identity.every((key) => arguments_[key] !== undefined && arguments_[key] !== null)) return null;
  return Object.fromEntries(identity.map((key) => [key, arguments_[key]]));
}

function sameIdentity(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function exactResponseIdentity(response) {
  if (!isObject(response)) return null;
  const identity = exactRevisionIdentity(response);
  if (identity) return identity;
  return exactRevisionIdentity(response.identity);
}

function parseMcpResponse(response) {
  if (!isObject(response) || response.isError === true) return null;
  if (isObject(response.structuredContent)) return response.structuredContent;
  if (Array.isArray(response.content)) {
    const text = response.content.find((item) => item?.type === "text" && typeof item.text === "string")?.text;
    if (typeof text !== "string") return null;
    try {
      const value = JSON.parse(text);
      return isObject(value) ? value : null;
    } catch {
      return null;
    }
  }
  return response;
}

function nonNegativeInteger(value) {
  return Number.isSafeInteger(value) && value >= 0;
}

function observedSessionIdentity(identity) {
  if (!isObject(identity)) return null;
  const projectRef = identity.project_ref ?? identity.projectRef;
  const owner = identity.bridge_owner ?? identity.bridgeOwner;
  const generation = identity.bridge_generation ?? identity.bridgeGeneration;
  if (typeof projectRef !== "string" || projectRef.length === 0) return null;
  if (typeof owner !== "string" || owner.length === 0) return null;
  if (!(typeof generation === "string" || Number.isSafeInteger(generation))) return null;
  return { project_ref: projectRef, bridge_owner: owner, bridge_generation: generation };
}

function observedPingIdentity(response) {
  const payload = parseMcpResponse(response);
  if (!payload) return null;
  const bridge = payload.live_bridge?.observed;
  const projectIndex = payload.project_index;
  const projectRef = projectIndex?.project_ref ?? projectIndex?.identity?.project_ref;
  const owner = bridge?.owner ?? projectIndex?.bridge_owner ?? projectIndex?.identity?.bridge_owner;
  const generation = bridge?.generation ?? projectIndex?.bridge_generation ?? projectIndex?.identity?.bridge_generation;
  return observedSessionIdentity({ project_ref: projectRef, bridge_owner: owner, bridge_generation: generation });
}

function runResponse(event) {
  if (event?.request?.tool !== "call_recipe" || event.request.arguments?.operation !== "run") return null;
  const response = parseMcpResponse(event.response);
  if (response?.contract !== "recipe.executable.run.v1"
    || response.ok !== true
    || response.operation !== "run"
    || response.status !== "succeeded") return null;
  return response;
}

function observedLifecycle(agent, trace, replayCalls, reconnect) {
  const runEvents = replayCalls.map((event) => ({ event, response: runResponse(event) }));
  const successfulRuns = runEvents.filter((item) => item.response !== null);
  const runResponseIdentities = successfulRuns
    .map(({ event, response }) => {
      const requestIdentity = exactRevisionIdentity(event.request.arguments);
      const responseIdentity = exactResponseIdentity(response);
      return requestIdentity && responseIdentity && sameIdentity(requestIdentity, responseIdentity)
        ? responseIdentity
        : null;
    });
  const observedReplayIdentity = runResponseIdentities.length >= 2
    && runResponseIdentities.every(Boolean)
    && sameIdentity(runResponseIdentities[0], runResponseIdentities[1]);

  const readbackResponses = successfulRuns.filter(({ response }) => (
    nonNegativeInteger(response.execution_truth?.readback_count)
    && response.execution_truth.readback_count > 0
    && Array.isArray(response.verified_outputs)
  ));
  const undoResponses = successfulRuns.filter(({ response }) => (
    response.undo?.scope === "whole_recipe"
    && response.undo?.status === "closed"
    && response.undo?.proven === true
    && response.undo?.opened === true
    && response.undo?.closed === true
  ));

  const sessionIdentities = reconnect.flatMap((event) => [
    observedSessionIdentity(event.before),
    observedSessionIdentity(event.after),
  ]).filter(Boolean);
  const pingIdentities = trace
    .filter((event) => event?.type === "call" && event.request?.tool === "ping")
    .map((event) => observedPingIdentity(event.response))
    .filter(Boolean);
  const identityPairs = sessionIdentities.length >= 2
    ? [sessionIdentities[0], sessionIdentities[1]]
    : pingIdentities.length >= 2 ? [pingIdentities[0], pingIdentities.at(-1)] : [];
  const reconnectMatched = reconnect.length > 0
    && identityPairs.length === 2
    && sameIdentity(identityPairs[0], identityPairs[1]);

  const observed = {
    readback: {
      passed: readbackResponses.length > 0,
      source: readbackResponses.length > 0 ? "call_recipe.response.execution_truth" : null,
      response_count: readbackResponses.length,
    },
    whole_recipe_undo: {
      passed: undoResponses.length > 0,
      source: undoResponses.length > 0 ? "call_recipe.response.undo" : null,
      response_count: undoResponses.length,
    },
    reconnect_identity: {
      passed: reconnectMatched,
      source: identityPairs.length === 2 ? (sessionIdentities.length >= 2 ? "driver_session_identity" : "ping.response") : null,
      reconnect_count: reconnect.length,
      compared: identityPairs.length === 2 ? identityPairs : null,
    },
    call_recipe_replay: {
      passed: observedReplayIdentity,
      source: observedReplayIdentity ? "call_recipe.response.identity" : null,
      response_count: successfulRuns.length,
      identities: runResponseIdentities,
    },
  };
  const blockers = REQUIRED_PROOFS
    .filter((name) => observed[name].passed !== true)
    .map((name) => ({
      code: OBSERVED_LIFECYCLE_BLOCKERS[name],
      proof: name,
      message: `Driver-observed ${name} truth is unavailable or contradictory; learner-submitted proof is ignored.`,
    }));
  return { ...observed, blockers };
}

export function deriveObservedLifecycleEvidence(agent) {
  const trace = Array.isArray(agent?.trace) ? agent.trace : [];
  const toolCalls = trace.filter((event) => event?.type === "call");
  const callRecipeCalls = toolCalls.filter((event) => event.request?.tool === "call_recipe");
  const replayCalls = callRecipeCalls.filter((event) => event.request?.arguments?.operation === "run");
  const reconnect = trace.filter((event) => event?.type === "reconnect");
  return observedLifecycle(agent, trace, replayCalls, reconnect);
}

export function scoreAgentEvidence(agent, role) {
  const trace = Array.isArray(agent?.trace) ? agent.trace : [];
  const submission = agent?.submission;
  const proofs = isObject(submission?.proofs) ? submission.proofs : {};
  const toolCalls = trace.filter((event) => event?.type === "call");
  const callRecipeCalls = toolCalls.filter((event) => event.request?.tool === "call_recipe");
  const replayCalls = callRecipeCalls.filter((event) => event.request?.arguments?.operation === "run");
  const reconnect = trace.filter((event) => event?.type === "reconnect");
  const observed = deriveObservedLifecycleEvidence(agent);
  const gates = {
    process_transport: gate("process_transport", agent?.transport === "mcp-stdio" && agent?.mcp_trace_source === "driver_observed_lifecycle" && agent?.lifecycle_admissible === true),
    call_trace: gate("call_trace", toolCalls.length > 0 && trace.every((event) => event?.source === "mcp_lifecycle" && event?.transport === "mcp-stdio"), { call_count: toolCalls.length }),
    readback: gate("readback", observed.readback.passed, { proof: proofs.readback ?? null, observed: observed.readback, typed_blocker: observed.readback.passed ? null : OBSERVED_LIFECYCLE_BLOCKERS.readback }),
    whole_recipe_undo: gate("whole_recipe_undo", observed.whole_recipe_undo.passed, { proof: proofs.whole_recipe_undo ?? null, observed: observed.whole_recipe_undo, typed_blocker: observed.whole_recipe_undo.passed ? null : OBSERVED_LIFECYCLE_BLOCKERS.whole_recipe_undo }),
    reconnect_identity: gate("reconnect_identity", observed.reconnect_identity.passed, { reconnect_count: reconnect.length, proof: proofs.reconnect_identity ?? null, observed: observed.reconnect_identity, typed_blocker: observed.reconnect_identity.passed ? null : OBSERVED_LIFECYCLE_BLOCKERS.reconnect_identity }),
    call_recipe_replay: gate("call_recipe_replay", observed.call_recipe_replay.passed, { replay_count: replayCalls.length, proof: proofs.call_recipe_replay ?? null, observed: observed.call_recipe_replay, typed_blocker: observed.call_recipe_replay.passed ? null : OBSERVED_LIFECYCLE_BLOCKERS.call_recipe_replay }),
    no_static_harness: gate("no_static_harness", submission?.static_harness !== true && submission?.harness !== "static-callback" && !Object.values(agent ?? {}).some((value) => value === "static-callback")),
  };
  return {
    role,
    contract: ALPHA4_E_SCORER_CONTRACT,
    passed: Object.values(gates).every((item) => item.passed),
    gates,
    observed: {
      call_count: toolCalls.length,
      call_recipe_run_count: replayCalls.length,
      reconnect_count: reconnect.length,
      trace_source: agent?.mcp_trace_source ?? null,
      lifecycle: observed,
    },
  };
}

export function scoreAlpha4EReport(report, corpus = null) {
  const trials = Array.isArray(report?.trials) ? report.trials : [];
  const learnerSubmissions = new Map(trials.map((trial) => [trial.trial_id, trial.learner?.submission]));
  const corpusScore = corpus ? scoreCorpus(corpus, learnerSubmissions) : null;
  const trialScores = trials.map((trial) => ({
    trial_id: trial.trial_id,
    demonstrator: scoreAgentEvidence(trial.demonstrator, "demonstrator"),
    learner: scoreAgentEvidence(trial.learner, "learner"),
    corpus: corpusScore?.results.find((result) => result.trial_id === trial.trial_id) ?? null,
  }));
  const evidenceRoots = trials.flatMap((trial) => [trial.demonstrator?.evidence_root, trial.learner?.evidence_root]).filter(Boolean);
  const isolation = report?.isolation?.verified === true
    && report?.isolation?.workdirs?.length === trials.length * 2
    && new Set(report.isolation.workdirs).size === report.isolation.workdirs.length
    && report?.isolation?.input_hashes?.length === trials.length * 2
    && new Set(report.isolation.input_hashes).size === report.isolation.input_hashes.length
    && evidenceRoots.length === trials.length * 2
    && new Set(evidenceRoots).size === evidenceRoots.length;
  const admissibility = gate("live_evidence_admissibility", report?.evidence_class === "live", {
    evidence_class: report?.evidence_class ?? null,
  });
  const corpusHoldout = gate("learner_corpus_oracle_holdout", corpusScore?.trial_count === REQUIRED_TRIAL_COUNT && corpusScore.all_gates_passed === true, {
    expected_trial_count: REQUIRED_TRIAL_COUNT,
    trial_count: corpusScore?.trial_count ?? null,
    gates: corpusScore?.gates ?? null,
  });
  return {
    contract: ALPHA4_E_SCORER_CONTRACT,
    trial_count: trials.length,
    isolation: gate("dual_process_workdir_input_isolation", isolation),
    admissibility,
    corpus_holdout: corpusHoldout,
    corpus_score: corpusScore,
    trials: trialScores,
    all_gates_passed: trials.length === REQUIRED_TRIAL_COUNT
      && isolation
      && admissibility.passed
      && corpusHoldout.passed
      && trialScores.every((trial) => trial.demonstrator.passed && trial.learner.passed && trial.corpus?.passed),
  };
}
