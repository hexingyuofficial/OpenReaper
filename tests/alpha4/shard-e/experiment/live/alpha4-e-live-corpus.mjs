import { createHash } from "node:crypto";

export const ALPHA4_E_LIVE_CORPUS_CONTRACT = "openreaper.alpha4.e.live_corpus.v1";
export const ALPHA4_E_OPERATION_SIZES = Object.freeze([5, 10, 20]);
export const ALPHA4_E_TRIALS_PER_SIZE = 10;

const OPERATION_SHAPES = Object.freeze([
  ["track.create", "track", "name", null, (index) => `Stem ${index + 1}`],
  ["track.update", "track", "color", "#202020", (index) => colorFor(`after-color-${index}`)],
  ["track.rename", "track", "name", (index) => `Track ${index + 1}`, (index) => `Layer ${index + 1}`],
  ["item.update", "item", "position_seconds", (index) => index * 0.25, (index) => index * 0.25 + 0.125],
  ["item.update", "item", "volume_db", -6, (index) => -5.5 + (index % 4) * 0.5],
  ["take.update", "take", "pan", 0, (index) => Number((((index % 5) - 2) * 0.1).toFixed(2))],
  ["take.update", "take", "pitch_semitones", 0, (index) => (index % 7) - 3],
  ["take.update", "take", "playrate", 1, (index) => Number((0.9 + (index % 5) * 0.05).toFixed(2))],
  ["fx.update", "fx", "normalized_value", 0.5, (index) => Number((0.2 + (index % 6) * 0.1).toFixed(2))],
  ["automation_point.update", "automation_point", "value", 0.25, (index) => Number((0.3 + (index % 5) * 0.1).toFixed(2))],
]);

export function createAlpha4ELiveCorpus({ seed = "alpha4-e-live-20260728" } = {}) {
  const trials = [];
  let ordinal = 0;
  for (const operationCount of ALPHA4_E_OPERATION_SIZES) {
    for (let local = 0; local < ALPHA4_E_TRIALS_PER_SIZE; local += 1) {
      ordinal += 1;
      const trialId = `trial_${String(ordinal).padStart(3, "0")}`;
      const scenario = scenarioFor(operationCount, local);
      const facts = Array.from({ length: operationCount }, (_, index) =>
        createFact({ seed, trialId, index, shape: OPERATION_SHAPES[(ordinal + index) % OPERATION_SHAPES.length] }),
      );
      trials.push(Object.freeze({
        contract: "openreaper.alpha4.e.hidden_trial.v1",
        trial_id: trialId,
        ordinal,
        operation_count: operationCount,
        scenario,
        before_state: stateFromFacts(facts, "before"),
        after_state: stateFromFacts(facts, "after"),
        semantic_facts: Object.freeze(facts),
        intent: Object.freeze(facts.map((fact) => intentFor(fact))),
        observation: Object.freeze(observationFor(scenario, trialId)),
      }));
    }
  }
  return Object.freeze({
    contract: ALPHA4_E_LIVE_CORPUS_CONTRACT,
    seed,
    trial_count: trials.length,
    operation_sizes: [...ALPHA4_E_OPERATION_SIZES],
    trials_per_size: ALPHA4_E_TRIALS_PER_SIZE,
    trials: Object.freeze(trials),
  });
}

function scenarioFor(operationCount, local) {
  if (local < 8) return "supported";
  if (local === 9) return "runtime_drift";
  if (operationCount === 5) return "ambiguous_target";
  if (operationCount === 10) return "unsupported_semantics";
  return "missing_plugin";
}

function createFact({ seed, trialId, index, shape }) {
  const [operation, entityKind, field, beforeFactory, afterFactory] = shape;
  const before = typeof beforeFactory === "function" ? beforeFactory(index) : beforeFactory;
  const after = typeof afterFactory === "function" ? afterFactory(index) : afterFactory;
  const targetId = `${entityKind}_${String(index + 1).padStart(3, "0")}`;
  const factId = `${trialId}.${String(index + 1).padStart(3, "0")}.${digest(`${seed}:${operation}:${targetId}:${field}`, 10)}`;
  return Object.freeze({
    fact_id: factId,
    operation,
    entity_kind: entityKind,
    target_id: targetId,
    field,
    before,
    after,
  });
}

function stateFromFacts(facts, side) {
  return Object.freeze(Object.fromEntries(facts.map((fact) => [
    fact.fact_id,
    Object.freeze({ entity_kind: fact.entity_kind, target_id: fact.target_id, field: fact.field, value: fact[side] }),
  ])));
}

function intentFor(fact) {
  return Object.freeze({
    fact_id: fact.fact_id,
    action: fact.operation,
    target: `${fact.entity_kind}:${fact.target_id}`,
    field: fact.field,
    desired_value: fact.after,
  });
}

function observationFor(scenario, trialId) {
  if (scenario === "ambiguous_target") {
    return { status: "blocked", code: "LEARNING_TARGET_AMBIGUOUS", candidates: [`${trialId}:candidate:1`, `${trialId}:candidate:2`] };
  }
  if (scenario === "unsupported_semantics") {
    return { status: "blocked", code: "LEARNING_SEMANTICS_UNSUPPORTED", feature: "opaque_plugin_modulation" };
  }
  if (scenario === "missing_plugin") {
    return { status: "blocked", code: "LEARNING_PLUGIN_NOT_INSTALLED", plugin: "Alpha4 Missing Instrument" };
  }
  if (scenario === "runtime_drift") {
    return { status: "compile_allowed", code: "BRIDGE_GENERATION_DRIFT", requested_generation: "999999" };
  }
  return { status: "supported", code: null };
}

function colorFor(value) {
  return `#${digest(value, 6).toUpperCase()}`;
}

function digest(value, length) {
  return createHash("sha256").update(String(value)).digest("hex").slice(0, length);
}
