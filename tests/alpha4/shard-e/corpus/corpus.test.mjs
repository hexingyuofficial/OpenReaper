import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import {
  CORPUS_SEED,
  DEMONSTRATION_SIZES,
  REQUIRED_TRIAL_COUNT,
  corpusDigest,
  createHiddenCorpus,
  projectCorpusLearnerInputs,
} from "./corpus.mjs";
import {
  buildOracleExpectation,
  createNormalRecipeRegistry,
  makeOraclePerfectSubmission,
  runOneCallReplay,
  validateNormalRecipe,
} from "./oracle.mjs";
import { makeSubmissionMap, scoreCorpus, scoreTrial } from "./scorer.mjs";

const corpus = createHiddenCorpus(CORPUS_SEED);

describe("Alpha4 Shard E deterministic paired-Agent corpus", () => {
  it("locks 30 hidden demonstrations with ten each at 5, 10, and 20 operations", () => {
    assert.equal(corpus.trial_count, REQUIRED_TRIAL_COUNT);
    assert.equal(corpus.trials.length, 30);
    assert.deepEqual(
      Object.fromEntries(DEMONSTRATION_SIZES.map((size) => [size, corpus.trials.filter((trial) => trial.demonstration_size === size).length])),
      { 5: 10, 10: 10, 20: 10 },
    );
    for (const trial of corpus.trials) {
      assert.equal(trial.facts.length, trial.demonstration_size);
      assert.equal(Object.isFrozen(trial), true);
      assert.equal(Object.isFrozen(trial.hidden), true);
    }
    assert.equal(corpusDigest(corpus), corpusDigest(createHiddenCorpus(CORPUS_SEED)));
    assert.notEqual(corpusDigest(corpus), corpusDigest(createHiddenCorpus(`${CORPUS_SEED}:different`)));
  });

  it("covers Item/Take, Track/folder/Marker, routing/automation, stock FX and three non-Vital third-party families", () => {
    const scenarios = new Set(corpus.trials.map((trial) => trial.scenario_id));
    for (const required of [
      "item_take_controls",
      "track_folder_marker",
      "routing_automation",
      "stock_fx_controls",
      "third_party_fx_families",
      "ambiguous_target",
      "unsupported_surface",
      "missing_plugin",
      "reconnect_replay",
      "drift_replay",
    ]) assert.equal(scenarios.has(required), true, required);

    const pluginIdentities = new Set(corpus.trials
      .flatMap((trial) => trial.facts)
      .map((fact) => fact.plugin_identity)
      .filter(Boolean));
    for (const plugin of ["VST3:ReaEQ (Cockos)", "VST3:TDR Nova", "VST3:ValhallaRoom", "VST3:FabFilter Pro-Q 3"]) {
      assert.equal(pluginIdentities.has(plugin), true, plugin);
    }
    assert.equal([...pluginIdentities].some((plugin) => /Vital/u.test(plugin)), false);
    assert.equal(corpus.trials.some((trial) => trial.scenario_id === "missing_plugin" && trial.facts.every((fact) => fact.missing_plugin_identity)), true);
    assert.equal(corpus.trials.some((trial) => trial.scenario_id === "mixed_fx_boundary" && trial.facts.some((fact) => fact.unsupported_reason === "opaque_plugin_chunk")), true);
    assert.equal(corpus.trials.some((trial) => trial.scenario_id === "ambiguous_target" && trial.facts.every((fact) => fact.ambiguity?.choices?.length === 2)), true);
  });

  it("projects a source-blind learner input without teacher prompt, transcript, calls, evidence, or manifest", () => {
    const learnerInputs = projectCorpusLearnerInputs(corpus);
    assert.equal(learnerInputs.length, corpus.trials.length);
    const forbiddenKeys = ["teacher_prompt", "transcript", "calls", "evidence", "manifest"];
    for (const input of learnerInputs) {
      const serialized = JSON.stringify(input);
      for (const key of forbiddenKeys) assert.equal(serialized.includes(key), false, `${input.trial_id} leaked ${key}`);
      assert.equal(serialized.includes("source:alpha4-shard-e"), false);
      assert.equal(input.capture.source_blind, true);
      assert.deepEqual(input.constraints.isolation, { prompt: true, turns: true, invocations: true, observations: true, target_truth: true });
      assert.equal(Object.hasOwn(input, "hidden"), false);
      assert.equal(Object.isFrozen(input), true);
    }
    assert.equal(corpus.trials.every((trial) => trial.hidden.teacher_prompt && trial.hidden.transcript && trial.hidden.calls && trial.hidden.evidence && trial.hidden.manifest), true);
  });

  it("models immutable normal Recipe save, list/get identity preservation, reconnect rediscovery, and one-call replay", () => {
    for (const trial of corpus.trials.filter((candidate) => ["item_take_controls", "reconnect_replay", "drift_replay"].includes(candidate.scenario_id))) {
      const expectation = buildOracleExpectation(trial);
      assert.equal(expectation.compiler.status, "compiled");
      assert.equal(validateNormalRecipe(expectation.lifecycle.recipe).ok, true);
      const registry = createNormalRecipeRegistry();
      const draft = structuredClone(expectation.lifecycle.recipe);
      const saved = registry.save(draft, trial);
      assert.equal(saved.ok, true, trial.trial_id);
      assert.equal(saved.immutable, true);
      assert.deepEqual(saved.identity, expectation.lifecycle.save.identity);
      draft.title = "caller mutation must not rewrite saved Recipe";

      const listed = registry.list();
      assert.equal(listed.items.length, 1);
      assert.deepEqual(listed.items[0].recipe_id, saved.identity.recipe_id);
      assert.deepEqual(listed.items[0].content_hash, saved.identity.content_hash);

      const got = registry.get(saved.identity);
      assert.equal(got.ok, true);
      assert.equal(got.immutable, true);
      assert.deepEqual(got.identity, saved.identity);
      assert.deepEqual(got.recipe, expectation.lifecycle.recipe);
      got.recipe.title = "returned clone mutation must not rewrite saved Recipe";
      assert.equal(registry.get(saved.identity).recipe.title, expectation.lifecycle.recipe.title);
      const rejectedEdit = registry.tryMutate(saved.identity, (recipe) => ({ ...recipe, title: "tampered" }));
      assert.equal(rejectedEdit.error.code, "NORMAL_RECIPE_IMMUTABLE");
      assert.deepEqual(registry.get(saved.identity).recipe, expectation.lifecycle.recipe);

      const reconnected = registry.reconnect();
      const rediscovered = reconnected.get(saved.identity);
      assert.equal(rediscovered.ok, true);
      assert.deepEqual(rediscovered.identity, saved.identity);
      assert.deepEqual(reconnected.list().items[0].content_hash, saved.identity.content_hash);

      const replay = runOneCallReplay({ trial, identity: saved.identity, registry: reconnected });
      assert.deepEqual(replay, expectation.lifecycle.replay);
      assert.equal(replay.entrypoint, "one_call_replay");
      assert.equal(replay.status === "succeeded" ? replay.one_call_count : replay.one_call_count, replay.status === "succeeded" ? 1 : 0);
    }
  });

  it("rejects malformed Recipe payloads before immutable save", () => {
    const trial = corpus.trials.find((candidate) => candidate.scenario_id === "item_take_controls");
    const recipe = buildOracleExpectation(trial).lifecycle.recipe;
    const malformed = structuredClone(recipe);
    malformed.steps[0].idempotency = "required";
    malformed.recovery.run_state = "not_started";
    malformed.recovery.branches[0] = { trigger: "template_error", strategy: "stop" };

    assert.equal(validateNormalRecipe(malformed).ok, false);
    const saved = createNormalRecipeRegistry().save(malformed, trial);
    assert.equal(saved.ok, false);
    assert.equal(saved.error.code, "NORMAL_RECIPE_REQUIRED");
    assert.equal(saved.error.details.length > 0, true);
  });

  it("models ambiguity, unsupported, missing-plugin, reconnect, and drift as explicit truth", () => {
    const ambiguity = corpus.trials.find((trial) => trial.scenario_id === "ambiguous_target");
    const unsupported = corpus.trials.find((trial) => trial.scenario_id === "unsupported_surface");
    const missingPlugin = corpus.trials.find((trial) => trial.scenario_id === "missing_plugin");
    const reconnect = corpus.trials.find((trial) => trial.scenario_id === "reconnect_replay");
    const drift = corpus.trials.find((trial) => trial.scenario_id === "drift_replay");
    const ambiguityExpectation = buildOracleExpectation(ambiguity);
    assert.equal(ambiguityExpectation.compiler.status, "blocked");
    assert.equal(ambiguityExpectation.compiler.block_reason, "ambiguous_intent");
    assert.deepEqual(ambiguityExpectation.lifecycle.ambiguity, { question_count: 1, chosen: false });
    assert.equal(ambiguityExpectation.lifecycle.replay.mutation, "zero_write");
    assert.equal(buildOracleExpectation(unsupported).lifecycle.replay.block_reason, "unsupported_fact");
    assert.equal(buildOracleExpectation(missingPlugin).lifecycle.replay.block_reason, "missing_plugin");
    assert.equal(buildOracleExpectation(reconnect).lifecycle.reconnect.rediscovered, true);
    assert.equal(buildOracleExpectation(drift).lifecycle.replay.block_reason, "project_identity_mismatch");
    assert.equal(buildOracleExpectation(drift).lifecycle.replay.undo.status, "not_opened");
  });

  it("passes every fact/scenario gate and the 90%/95% learner success gates for the oracle-perfect paired corpus", () => {
    const submissions = makeSubmissionMap(corpus, makeOraclePerfectSubmission);
    const report = scoreCorpus(corpus, submissions);
    assert.equal(report.trial_count, 30);
    assert.equal(report.all_gates_passed, true, JSON.stringify(report.gates, null, 2));
    assert.equal(report.gates.supported_capture_compiler_replay_truth.rate, 1);
    assert.equal(report.gates.zero_wrong_extra_hidden_mutation_or_false_success.rate, 1);
    assert.equal(report.gates.ambiguity_undo_reconnect_truth.rate, 1);
    assert.equal(report.gates.first_attempt_success.rate, 1);
    assert.equal(report.gates.first_attempt_success.threshold, 0.9);
    assert.equal(report.gates.one_recovery_success.rate, 1);
    assert.equal(report.gates.one_recovery_success.threshold, 0.95);
    assert.equal(Object.values(report.scenario_scores).every((score) => score.rate === 1), true);
    assert.equal(report.results.every((result) => result.fact_gate.rate === 1), true);
  });

  it("rejects wrong facts, extra/hidden mutation, false success, and excess ambiguity questions", () => {
    const perfect = makeOraclePerfectSubmission(corpus.trials[0]);
    const wrongFact = structuredClone(perfect);
    wrongFact.capture.facts[0].signature.after = "wrong";
    assert.equal(scoreTrial(corpus.trials[0], wrongFact).passed, false);

    const pluginTrial = corpus.trials.find((trial) => trial.scenario_id === "third_party_fx_families");
    const wrongPlugin = structuredClone(makeOraclePerfectSubmission(pluginTrial));
    const pluginFact = wrongPlugin.capture.facts.find((fact) => fact.signature.plugin_identity);
    pluginFact.signature.plugin_identity = "VST3:Wrong Plugin";
    assert.equal(scoreTrial(pluginTrial, wrongPlugin).passed, false);

    const blockedTrial = corpus.trials.find((trial) => trial.scenario_id === "unsupported_surface");
    const hiddenMutation = structuredClone(makeOraclePerfectSubmission(blockedTrial));
    hiddenMutation.lifecycle.replay.hidden_mutations.push({ fact_id: "hidden:mutation" });
    assert.equal(scoreTrial(blockedTrial, hiddenMutation).scenario_gate.replay_truth.no_hidden_mutation, false);
    assert.equal(scoreTrial(blockedTrial, hiddenMutation).passed, false);

    const driftTrial = corpus.trials.find((trial) => trial.scenario_id === "drift_replay");
    const falseSuccess = structuredClone(makeOraclePerfectSubmission(driftTrial));
    falseSuccess.lifecycle.replay.status = "succeeded";
    falseSuccess.lifecycle.replay.mutation = "applied_verified";
    falseSuccess.lifecycle.replay.mutations = [{ fact_id: driftTrial.facts[0].fact_id, subject_ref: "item:target:dialogue", field: "position_seconds", value: 99 }];
    falseSuccess.lifecycle.replay.false_success = true;
    assert.equal(scoreTrial(driftTrial, falseSuccess).scenario_gate.replay_truth.no_false_success, false);
    assert.equal(scoreTrial(driftTrial, falseSuccess).passed, false);

    const ambiguityTrial = corpus.trials.find((trial) => trial.scenario_id === "ambiguous_target");
    const guessed = structuredClone(makeOraclePerfectSubmission(ambiguityTrial));
    guessed.lifecycle.ambiguity.question_count = 2;
    guessed.lifecycle.ambiguity.chosen = true;
    assert.equal(scoreTrial(ambiguityTrial, guessed).scenario_gate.ambiguity_truth, false);
    assert.equal(scoreTrial(ambiguityTrial, guessed).passed, false);
  });

  it("keeps this lane as pure corpus/oracle/scorer infrastructure with no product runtime or execution entrypoint", async () => {
    const paths = ["corpus.mjs", "oracle.mjs", "scorer.mjs", "corpus.test.mjs"];
    const sources = await Promise.all(paths.map((file) => readFile(new URL(`./${file}`, import.meta.url), "utf8")));
    assert.equal(sources.slice(0, 3).every((source) => !source.includes("packages/") && !source.includes("/src/")), true);
    const productEntrypoint = ["call", "_", "recipe"].join("");
    assert.equal(sources.slice(0, 3).every((source) => !source.includes(productEntrypoint)), true);
  });
});
