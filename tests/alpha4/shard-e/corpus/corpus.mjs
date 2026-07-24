import { createHash } from "node:crypto";

export const CORPUS_CONTRACT = "alpha4.shard-e.paired-corpus.v1";
export const LEARNER_INPUT_CONTRACT = "alpha4.shard-e.learner-input.v1";
export const CORPUS_SEED = "alpha4-shard-e-corpus-20260724";
export const DEMONSTRATION_SIZES = Object.freeze([5, 10, 20]);
export const REQUIRED_TRIAL_COUNT = 30;

const OPERATION_LIBRARY = Object.freeze({
  item_take: Object.freeze([
    {
      entity_kind: "item.take",
      field: "position_seconds",
      action: "move_item",
      template_id: "template.items.move_item",
      before: 1,
      after: 4,
      dependency: "item_before_take",
    },
    {
      entity_kind: "item.take",
      field: "take_pitch_semitones",
      action: "set_take_pitch",
      template_id: "template.items.set_take_pitch",
      before: 0,
      after: 2,
      dependency: "take_identity",
    },
    {
      entity_kind: "item.take",
      field: "take_playrate",
      action: "set_take_playrate",
      template_id: "template.items.set_take_playrate",
      before: 1,
      after: 0.875,
      dependency: "take_identity",
    },
    {
      entity_kind: "item.take",
      field: "fade_in_seconds",
      action: "set_item_fades",
      template_id: "template.items.set_item_fades",
      before: 0,
      after: 0.125,
      dependency: "item_identity",
    },
    {
      entity_kind: "item.take",
      field: "fade_out_seconds",
      action: "set_item_fades",
      template_id: "template.items.set_item_fades",
      before: 0,
      after: 0.25,
      dependency: "item_identity",
    },
    {
      entity_kind: "item.take",
      field: "take_reverse",
      action: "set_reverse",
      template_id: "template.items.set_reverse",
      before: false,
      after: true,
      dependency: "take_identity",
    },
  ]),
  track_folder_marker: Object.freeze([
    {
      entity_kind: "track",
      field: "folder_depth",
      action: "create_folder_track",
      template_id: "template.tracks.create_folder_track",
      before: 0,
      after: 1,
      dependency: "track_parent",
    },
    {
      entity_kind: "track",
      field: "track_name",
      action: "rename_track",
      template_id: "template.tracks.rename_track",
      before: "Audio",
      after: "Dialogue",
      dependency: "track_identity",
    },
    {
      entity_kind: "track",
      field: "folder_parent_ref",
      action: "nest_tracks_in_folder",
      template_id: "template.tracks.nest_tracks_in_folder",
      before: null,
      after: "track:target:folder",
      dependency: "folder_before_child",
    },
    {
      entity_kind: "marker",
      field: "marker_position_seconds",
      action: "create_marker",
      template_id: "template.project.create_marker",
      before: null,
      after: 8,
      dependency: "marker_identity",
    },
    {
      entity_kind: "item.take",
      field: "position_seconds",
      action: "move_item_to_marker",
      template_id: "template.items.move_item",
      before: 1,
      after: 8,
      dependency: "marker_before_item",
    },
    {
      entity_kind: "track",
      field: "track_color",
      action: "set_color",
      template_id: "template.tracks.set_color",
      before: "default",
      after: "#3366cc",
      dependency: "track_identity",
    },
  ]),
  routing_automation: Object.freeze([
    {
      entity_kind: "routing.send",
      field: "send_created",
      action: "create_track_send",
      template_id: "template.routing.create_track_send",
      before: false,
      after: true,
      dependency: "source_and_destination_tracks",
    },
    {
      entity_kind: "routing.send",
      field: "send_volume_db",
      action: "set_send_volume",
      template_id: "template.routing.set_send_volume",
      before: 0,
      after: -6,
      dependency: "send_identity",
    },
    {
      entity_kind: "routing.send",
      field: "send_pan",
      action: "set_send_pan",
      template_id: "template.routing.set_send_pan",
      before: 0,
      after: -0.25,
      dependency: "send_identity",
    },
    {
      entity_kind: "automation.envelope",
      field: "automation_mode",
      action: "set_track_automation_mode",
      template_id: "template.automation.set_track_automation_mode",
      before: "trim_read",
      after: "latch",
      dependency: "track_identity",
    },
    {
      entity_kind: "automation.point",
      field: "value",
      action: "insert_envelope_point",
      template_id: "template.automation.insert_envelope_point",
      before: 0.5,
      after: 0.8,
      dependency: "envelope_before_point",
    },
    {
      entity_kind: "automation.point",
      field: "position_seconds",
      action: "insert_envelope_point",
      template_id: "template.automation.insert_envelope_point",
      before: 4,
      after: 8,
      dependency: "envelope_before_point",
    },
  ]),
  stock_fx: Object.freeze([
    {
      entity_kind: "track.fx",
      field: "plugin_identity",
      action: "add_track_fx",
      template_id: "template.fx.add_track_fx",
      before: null,
      after: "VST3:ReaEQ (Cockos)",
      plugin_identity: "VST3:ReaEQ (Cockos)",
      parameter: null,
      dependency: "track_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "band_1_frequency_hz",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: 100,
      after: 220,
      plugin_identity: "VST3:ReaEQ (Cockos)",
      parameter: "band_1_frequency_hz",
      dependency: "fx_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "threshold_db",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: -12,
      after: -18,
      plugin_identity: "VST3:ReaComp (Cockos)",
      parameter: "threshold_db",
      dependency: "fx_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "mix_percent",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: 100,
      after: 72,
      plugin_identity: "VST3:ReaVerbate (Cockos)",
      parameter: "mix_percent",
      dependency: "fx_identity",
    },
  ]),
  third_party_fx: Object.freeze([
    {
      entity_kind: "track.fx",
      field: "plugin_identity",
      action: "add_track_fx",
      template_id: "template.fx.add_track_fx",
      before: null,
      after: "VST3:TDR Nova",
      plugin_identity: "VST3:TDR Nova",
      parameter: null,
      dependency: "track_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "threshold_db",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: -12,
      after: -24,
      plugin_identity: "VST3:TDR Nova",
      parameter: "threshold_db",
      dependency: "fx_identity",
    },
    {
      entity_kind: "track.fx",
      field: "plugin_identity",
      action: "add_track_fx",
      template_id: "template.fx.add_track_fx",
      before: null,
      after: "VST3:ValhallaRoom",
      plugin_identity: "VST3:ValhallaRoom",
      parameter: null,
      dependency: "track_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "mix_percent",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: 100,
      after: 34,
      plugin_identity: "VST3:ValhallaRoom",
      parameter: "mix_percent",
      dependency: "fx_identity",
    },
    {
      entity_kind: "track.fx",
      field: "plugin_identity",
      action: "add_track_fx",
      template_id: "template.fx.add_track_fx",
      before: null,
      after: "VST3:FabFilter Pro-Q 3",
      plugin_identity: "VST3:FabFilter Pro-Q 3",
      parameter: null,
      dependency: "track_identity",
    },
    {
      entity_kind: "track.fx.parameter",
      field: "band_1_gain_db",
      action: "set_fx_parameter_normalized",
      template_id: "template.fx.set_fx_parameter_normalized",
      before: 0,
      after: 3,
      plugin_identity: "VST3:FabFilter Pro-Q 3",
      parameter: "band_1_gain_db",
      dependency: "fx_identity",
    },
  ]),
});

const SCENARIOS = Object.freeze({
  item_take_controls: scenario("item_take", "items", "item.take", "supported", "succeeded", ["item_take"]),
  item_take_fades: scenario("item_take", "items", "item.take", "supported", "succeeded", ["item_take"]),
  track_folder_marker: scenario("track_folder_marker", "tracks", "track", "supported", "succeeded", ["track_folder_marker"]),
  routing_automation: scenario("routing_automation", "routing", "routing.send", "supported", "succeeded", ["routing_automation"]),
  stock_fx_controls: scenario("stock_fx", "fx", "track.fx", "supported", "succeeded", ["stock_fx"]),
  third_party_fx_families: scenario("third_party_fx", "fx", "track.fx", "supported", "succeeded", ["third_party_fx"]),
  mixed_fx_boundary: scenario("third_party_fx", "fx", "track.fx", "unsupported", "blocked_unsupported", ["third_party_fx"], { mixed: true }),
  ambiguous_target: scenario("ambiguity", "items", "item.take", "ambiguous", "blocked_ambiguity", ["item_take"]),
  unsupported_surface: scenario("unsupported", "system", "project", "unsupported", "blocked_unsupported", ["item_take"]),
  missing_plugin: scenario("missing_plugin", "fx", "track.fx", "missing_plugin", "blocked_missing_plugin", ["third_party_fx"]),
  reconnect_replay: scenario("reconnect", "items", "item.take", "supported", "succeeded", ["item_take"], { reconnect: true }),
  drift_replay: scenario("drift", "items", "item.take", "supported", "blocked_drift", ["item_take"], { drift: true }),
});

const TRIAL_SCENARIOS = Object.freeze({
  5: Object.freeze([
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
  ]),
  10: Object.freeze([
    "item_take_controls",
    "item_take_fades",
    "track_folder_marker",
    "routing_automation",
    "stock_fx_controls",
    "third_party_fx_families",
    "mixed_fx_boundary",
    "ambiguous_target",
    "reconnect_replay",
    "drift_replay",
  ]),
  20: Object.freeze([
    "item_take_controls",
    "track_folder_marker",
    "routing_automation",
    "stock_fx_controls",
    "third_party_fx_families",
    "mixed_fx_boundary",
    "ambiguous_target",
    "unsupported_surface",
    "reconnect_replay",
    "drift_replay",
  ]),
});

function scenario(family, pack, entityKind, factStatus, terminal, operationFamilies, options = {}) {
  return Object.freeze({ family, pack, entity_kind: entityKind, fact_status: factStatus, terminal, operation_families: Object.freeze(operationFamilies), ...options });
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}

function clone(value) {
  return structuredClone(value);
}

function hash(value) {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function factStatusFor(scenarioDefinition, index) {
  if (!scenarioDefinition.mixed) return scenarioDefinition.fact_status;
  return index % 3 === 2 ? "unsupported" : "supported";
}

function operationTemplate(scenarioDefinition, index) {
  const family = scenarioDefinition.operation_families[index % scenarioDefinition.operation_families.length];
  const operations = OPERATION_LIBRARY[family];
  return operations[index % operations.length];
}

function makeFact(trialId, scenarioId, scenarioDefinition, index) {
  const operation = operationTemplate(scenarioDefinition, index);
  const status = factStatusFor(scenarioDefinition, index);
  const factId = `${trialId}:fact:${String(index + 1).padStart(2, "0")}`;
  const subjectRef = operation.entity_kind.startsWith("track")
    ? "track:target:dialogue"
    : operation.entity_kind.startsWith("marker")
      ? "marker:target:one"
      : operation.entity_kind.startsWith("routing")
        ? "send:target:dialogue-to-music"
        : operation.entity_kind.startsWith("automation")
          ? "envelope:target:dialogue-volume"
          : operation.entity_kind.startsWith("item")
            ? "item:target:dialogue"
            : "fx:target:dialogue:01";
  const fact = {
    fact_id: factId,
    operation_number: index + 1,
    scenario_id: scenarioId,
    entity_kind: operation.entity_kind,
    subject_ref: subjectRef,
    field: operation.field,
    action: operation.action,
    template_id: operation.template_id,
    dependency: operation.dependency,
    before: clone(operation.before),
    after: clone(operation.after),
    support_status: status,
    plugin_identity: operation.plugin_identity ?? null,
    parameter: operation.parameter ?? null,
    mutation_expected: status === "supported",
    boundary: operation.plugin_identity
      ? operation.parameter
        ? "exact_plugin_identity_and_scalar_parameter"
        : "exact_plugin_identity"
      : "typed_native_fact",
  };
  if (status === "missing_plugin") fact.missing_plugin_identity = operation.plugin_identity ?? "VST3:Unavailable Example";
  if (status === "unsupported") fact.unsupported_reason = scenarioId === "mixed_fx_boundary" ? "opaque_plugin_chunk" : "raw_or_unreviewed_surface";
  if (status === "ambiguous") fact.ambiguity = { question: "Which matching target should receive this demonstrated change?", choices: ["track:target:dialogue", "track:target:music"] };
  return deepFreeze(fact);
}

function makeTargetManifest(facts, phase) {
  const values = {};
  for (const fact of facts) {
    values[fact.fact_id] = phase === "before" ? clone(fact.before) : clone(fact.after);
  }
  return deepFreeze({ target_fixture: "fresh:alpha4-shard-e", phase, values });
}

function makeTrial(seed, number, operationCount, scenarioId) {
  const trialId = `alpha4-e-trial-${String(number).padStart(3, "0")}`;
  const scenarioDefinition = SCENARIOS[scenarioId];
  const facts = Array.from({ length: operationCount }, (_, index) => makeFact(trialId, scenarioId, scenarioDefinition, index));
  const before = makeTargetManifest(facts, "before");
  const after = makeTargetManifest(facts, "after");
  const supportedFactIds = facts.filter((fact) => fact.support_status === "supported").map((fact) => fact.fact_id);
  const calls = facts.map((fact) => ({
    call_number: fact.operation_number,
    tool: "call_template",
    template_id: fact.template_id,
    refs: { subject_ref: fact.subject_ref },
    input: { field: fact.field, value: fact.after },
  }));
  const transcript = facts.map((fact) => ({
    turn: fact.operation_number,
    utterance: `Demonstrate ${fact.action} for ${fact.subject_ref}.`,
    observed_fact_id: fact.fact_id,
  }));
  const evidence = {
    capture_id: `capture:${trialId}`,
    before_hash: hash(before),
    after_hash: hash(after),
    undo_boundary: { opened: true, closed: true, scope: "whole_recipe", change_count_delta: operationCount },
    readback_fact_ids: facts.map((fact) => fact.fact_id),
  };
  const compactFacts = facts.map(({ fact_id, operation_number, entity_kind, subject_ref, field, action, dependency, before: factBefore, after: factAfter, support_status, plugin_identity, parameter, boundary, ambiguity, unsupported_reason, missing_plugin_identity }) => ({
    fact_id,
    operation_number,
    entity_kind,
    subject_ref,
    field,
    action,
    dependency,
    before: clone(factBefore),
    after: clone(factAfter),
    support_status,
    plugin_identity,
    parameter,
    boundary,
    ...(ambiguity ? { ambiguity: clone(ambiguity) } : {}),
    ...(unsupported_reason ? { unsupported_reason } : {}),
    ...(missing_plugin_identity ? { missing_plugin_identity } : {}),
  }));
  const learnerInput = {
    contract: LEARNER_INPUT_CONTRACT,
    trial_id: trialId,
    demonstration_size: operationCount,
    scenario_family: scenarioDefinition.family,
    installed_manual: {
      capture: "Use identity-aware typed before/after facts; unknown facts are never defaults.",
      compilation: "Compile net semantic transformations in dependency order and preserve every boundary fact.",
      plugin_boundary: "Use exact plugin identity plus generic scalar parameter readback; opaque chunks, presets, UI state and modulation are unavailable.",
      recovery: "Ask at most one compact choice for ambiguity; fail closed for unsupported, missing-plugin and drift facts.",
      recipe_lifecycle: "Save an immutable normal Recipe, preserve its identity through list/get and reconnect, then use one replay call against a fresh target.",
      undo: "A successful mutation has one whole-Recipe Undo boundary; blocked preflight has zero writes and no false success.",
    },
    capture: {
      capture_id: evidence.capture_id,
      observed_entity_kinds: [...new Set(facts.map((fact) => fact.entity_kind))].sort(),
      facts: compactFacts,
      source_blind: true,
    },
    constraints: {
      isolation: { prompt: true, turns: true, invocations: true, observations: true, target_truth: true },
    },
  };
  const hidden = {
    teacher_prompt: {
      task: `Perform the hidden ${operationCount}-operation ${scenarioId} demonstration on the disposable source fixture.`,
      seed,
      target_fixture: "source:alpha4-shard-e",
    },
    transcript,
    calls,
    evidence,
    manifest: { before, after, supported_fact_ids: supportedFactIds },
  };
  return deepFreeze({
    trial_id: trialId,
    seed,
    demonstration_size: operationCount,
    scenario_id: scenarioId,
    scenario: scenarioDefinition,
    facts,
    learner_input: learnerInput,
    hidden,
  });
}

export function createHiddenCorpus(seed = CORPUS_SEED) {
  if (typeof seed !== "string" || seed.length === 0) throw new TypeError("corpus seed must be a non-empty string");
  const trials = [];
  let number = 1;
  for (const operationCount of DEMONSTRATION_SIZES) {
    for (const scenarioId of TRIAL_SCENARIOS[operationCount]) {
      trials.push(makeTrial(seed, number, operationCount, scenarioId));
      number += 1;
    }
  }
  return deepFreeze({ contract: CORPUS_CONTRACT, seed, trial_count: trials.length, trials });
}

export function projectLearnerInput(trial) {
  if (!trial?.learner_input || !trial.hidden || !trial.facts) throw new TypeError("expected a hidden corpus trial");
  return deepFreeze(clone(trial.learner_input));
}

export function projectCorpusLearnerInputs(corpus) {
  if (!corpus?.trials) throw new TypeError("expected a hidden corpus");
  return deepFreeze(corpus.trials.map(projectLearnerInput));
}

export function corpusDigest(corpus) {
  return hash({ contract: corpus.contract, seed: corpus.seed, trials: corpus.trials });
}

export function scenarioCatalog() {
  return deepFreeze(clone(SCENARIOS));
}

export function operationFactSignature(fact) {
  return deepFreeze({
    fact_id: fact.fact_id,
    entity_kind: fact.entity_kind,
    field: fact.field,
    action: fact.action,
    subject_ref: fact.subject_ref,
    before: clone(fact.before),
    after: clone(fact.after),
    support_status: fact.support_status,
    plugin_identity: fact.plugin_identity,
    parameter: fact.parameter,
  });
}
