import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  RECIPE_CONTRACT,
  RECIPE_FULL_FIELDS,
  validateRecipeContract,
} from "../../../../packages/core/src/recipe-contract-v1.mjs";
import * as compiler from "./learned-recipe-compiler.mjs";

const {
  LEARNING_SNAPSHOT_CONTRACT,
  FACT_CLASSIFICATIONS,
  compileLearnedRecipe,
  diffLearningSnapshots,
  normalizeLearningSnapshot,
} = compiler;

const ENTITY_COLLECTIONS = [
  "tracks",
  "items",
  "takes",
  "markers",
  "sends",
  "fx",
  "envelopes",
  "envelope_points",
];

function identity(value) {
  return { scheme: "guid", value: `{${value}}` };
}

function ref(kind, value) {
  return `${kind}:guid:{${value}}`;
}

function entity(kind, value, fields = {}) {
  return {
    ref: ref(kind, value),
    identity: identity(value),
    ...fields,
  };
}

function relation(kind, value, name) {
  return {
    [`${name}_ref`]: ref(kind, value),
    [`${name}_identity`]: identity(value),
  };
}

function emptyEntities() {
  return Object.fromEntries(ENTITY_COLLECTIONS.map((collection) => [collection, []]));
}

function rawSnapshot(entities = {}, extras = {}) {
  return {
    contract: LEARNING_SNAPSHOT_CONTRACT,
    capture: {
      project_ref: "project:guid:{P1}",
      bridge_owner: "alpha4-test-owner",
      bridge_generation: "17",
      capture_id: "capture:alpha4:e1",
    },
    entities: { ...emptyEntities(), ...entities },
    ...extras,
  };
}

function snapshot(entities = {}, extras = {}) {
  return normalizeLearningSnapshot(rawSnapshot(entities, extras));
}

function unboundTrack(fields = {}) {
  return { selector: { name: "Ambiguous target" }, ...fields };
}

function factFor(diff, classification) {
  const fact = diff.facts.find((candidate) => candidate.classification === classification);
  assert.ok(fact, `expected a ${classification} fact, got ${JSON.stringify(diff.facts)}`);
  return fact;
}

function callSteps(recipe) {
  return recipe.steps.filter((step) => step.uses === "call_template");
}

function stepForTemplate(recipe, templateId) {
  const step = callSteps(recipe).find((candidate) => candidate.call_template.id === templateId);
  assert.ok(step, `expected a ${templateId} step`);
  return step;
}

function nestedKeys(value, found = new Set()) {
  if (!value || typeof value !== "object") return found;
  if (Array.isArray(value)) {
    value.forEach((child) => nestedKeys(child, found));
    return found;
  }
  for (const [key, child] of Object.entries(value)) {
    found.add(key);
    nestedKeys(child, found);
  }
  return found;
}

describe("Alpha4 Shard E learned Recipe compiler", () => {
  it("normalizes typed identity-aware snapshots into a deeply frozen contract", () => {
    const normalized = snapshot({
      tracks: [entity("track", "T1", { name: "Dialogue" })],
    });

    assert.equal(normalized.contract, LEARNING_SNAPSHOT_CONTRACT);
    assert.deepEqual(normalized.entities.tracks[0].identity, identity("T1"));
    assert.equal(normalized.entities.tracks[0].identity_key, "track|guid|{T1}");
    assert.equal(Object.isFrozen(normalized), true);
    assert.equal(Object.isFrozen(normalized.capture), true);
    assert.equal(Object.isFrozen(normalized.entities.tracks), true);
    assert.equal(Object.isFrozen(normalized.entities.tracks[0].values), true);
  });

  it("classifies supported, no-op, ambiguous, unsupported, and unknown facts", () => {
    assert.deepEqual([...FACT_CLASSIFICATIONS], [
      "supported",
      "ambiguous",
      "unsupported",
      "unknown",
      "no_op",
    ]);

    const supported = diffLearningSnapshots(
      snapshot({ tracks: [entity("track", "T1", { name: "Before" })] }),
      snapshot({ tracks: [entity("track", "T1", { name: "After" })] }),
    );
    assert.equal(factFor(supported, "supported").template_id, "template.tracks.rename_track");
    assert.equal(supported.ok, true);

    const noOp = diffLearningSnapshots(
      snapshot({ tracks: [entity("track", "T1", { name: "Same" })] }),
      snapshot({ tracks: [entity("track", "T1", { name: "Same" })] }),
    );
    assert.equal(factFor(noOp, "no_op").operation, "no_op");
    assert.equal(noOp.ok, true);

    const ambiguous = diffLearningSnapshots(
      snapshot({
        tracks: [unboundTrack({ name: "One" }), unboundTrack({ name: "Two" })],
      }),
      snapshot({ tracks: [unboundTrack({ name: "After" })] }),
    );
    assert.equal(factFor(ambiguous, "ambiguous").operation, "select_target");
    assert.equal(ambiguous.ok, false);

    const unsupported = diffLearningSnapshots(
      snapshot({ tracks: [entity("track", "T1", { name: "Before" })] }),
      snapshot({ tracks: [entity("track", "T1", { name: "After", raw_lua: "SetTrackName" })] }),
    );
    assert.equal(factFor(unsupported, "unsupported").field, "raw_lua");
    assert.equal(unsupported.ok, false);

    const unknown = diffLearningSnapshots(
      snapshot(),
      snapshot({ tracks: [{ name: "Created without identity" }] }),
    );
    assert.equal(factFor(unknown, "unknown").reason, "Missing stable identity and selector.");
    assert.equal(unknown.ok, false);
  });

  it("compiles a supported Track rename into an ordinary immutable Recipe", () => {
    const diff = diffLearningSnapshots(
      snapshot({ tracks: [entity("track", "T1", { name: "Before" })] }),
      snapshot({ tracks: [entity("track", "T1", { name: "After" })] }),
    );
    const result = compileLearnedRecipe(diff, {
      pack: "tracks",
      recipe_id: "recipe.tracks.learned_rename",
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "compiled");
    assert.equal(result.recipe.contract, RECIPE_CONTRACT);
    assert.deepEqual(Object.keys(result.recipe).sort(), [...RECIPE_FULL_FIELDS].sort());
    assert.deepEqual(validateRecipeContract(result.recipe), { ok: true, errors: [] });

    const rename = stepForTemplate(result.recipe, "template.tracks.rename_track");
    assert.deepEqual(rename.call_template.input, { name: "After" });
    assert.deepEqual(rename.call_template.refs.track_ref, {
      kind: "track",
      ref: ref("track", "T1"),
      identity: identity("T1"),
    });
    for (const value of [
      result.recipe,
      result.recipe.workflow_card,
      result.recipe.steps,
      result.recipe.steps[0],
      rename.call_template,
      rename.call_template.input,
      rename.call_template.refs,
      result.recipe.recovery,
    ]) assert.equal(Object.isFrozen(value), true);

    const forbiddenKeys = new Set([
      "gesture",
      "raw_lua",
      "action",
      "shell",
      "ui",
      "call_recipe",
      "live_reaper",
    ]);
    assert.deepEqual([...nestedKeys(result.recipe)].filter((key) => forbiddenKeys.has(key)), []);
    assert.equal(result.recipe.steps.every((step) => ["get_state", "call_template"].includes(step.uses)), true);
  });

  it("orders Track-before-Item, FX-before-parameter, and Envelope-before-point dependencies", () => {
    const before = snapshot({
      tracks: [entity("track", "T0", { name: "Existing" })],
      items: [entity("item", "I1", {
        ...relation("track", "T0", "track"),
        position_seconds: 2,
      })],
    });
    const after = snapshot({
      tracks: [
        entity("track", "T0", { name: "Existing" }),
        entity("track", "T1", { name: "Folder", is_folder: true, index: 1 }),
      ],
      items: [entity("item", "I1", {
        ...relation("track", "T1", "track"),
        position_seconds: 2,
      })],
      fx: [entity("fx", "F1", {
        ...relation("track", "T1", "track"),
        owner_kind: "track",
        trusted_surface: "D",
        plugin_name: "ReaEQ (Cockos)",
        plugin_ident: "VST3:ReaEQ (Cockos)",
        parameters: {
          "0": {
            param_index: 0,
            param_ident: "band_1_gain",
            normalized_value: 0.75,
            tolerance: 0.001,
          },
        },
      })],
      envelopes: [entity("envelope", "E1", {
        ...relation("fx", "F1", "fx"),
        param_index: 0,
        param_ident: "band_1_gain",
      })],
      envelope_points: [entity("envelope_point", "P1", {
        ...relation("envelope", "E1", "envelope"),
        point_index: 0,
        time_seconds: 1,
        value: 0.5,
        shape: 0,
        tension: 0,
        selected: false,
      })],
    });

    const result = compileLearnedRecipe(diffLearningSnapshots(before, after), {
      pack: "tracks",
      recipe_id: "recipe.tracks.learned_dependencies",
    });
    assert.equal(result.ok, true, JSON.stringify(result.blockers));
    assert.equal(result.status, "compiled");
    assert.deepEqual(
      compileLearnedRecipe(diffLearningSnapshots(before, after), {
        pack: "tracks",
        recipe_id: "recipe.tracks.learned_dependencies",
      }),
      result,
    );

    const steps = callSteps(result.recipe);
    const position = (templateId) => {
      const index = steps.findIndex((step) => step.call_template.id === templateId);
      assert.notEqual(index, -1, templateId);
      return index;
    };
    assert.ok(position("template.tracks.create_folder_track") < position("template.items.move_item_to_track"));
    assert.ok(position("template.fx.add_track_fx") < position("template.fx.set_fx_parameter_normalized"));
    assert.ok(position("template.automation.ensure_fx_parameter_envelope") < position("template.automation.insert_envelope_point"));

    const createTrack = stepForTemplate(result.recipe, "template.tracks.create_folder_track");
    const moveItem = stepForTemplate(result.recipe, "template.items.move_item_to_track");
    const createFx = stepForTemplate(result.recipe, "template.fx.add_track_fx");
    const setParameter = stepForTemplate(result.recipe, "template.fx.set_fx_parameter_normalized");
    const createEnvelope = stepForTemplate(result.recipe, "template.automation.ensure_fx_parameter_envelope");
    const point = stepForTemplate(result.recipe, "template.automation.insert_envelope_point");

    assert.deepEqual(moveItem.call_template.refs.target_track_ref, {
      $from_step: createTrack.id,
      output: "track_ref",
    });
    assert.deepEqual(createFx.call_template.refs.track_ref, {
      $from_step: createTrack.id,
      output: "track_ref",
    });
    assert.deepEqual(setParameter.call_template.refs.fx_ref, {
      $from_step: createFx.id,
      output: "fx_ref",
    });
    assert.deepEqual(createEnvelope.call_template.refs.fx_ref, {
      $from_step: createFx.id,
      output: "fx_ref",
    });
    assert.deepEqual(point.call_template.refs.envelope_ref, {
      $from_step: createEnvelope.id,
      output: "envelope_ref",
    });
  });

  it("does not silently omit an unknown parameter fact on a newly created FX", () => {
    const before = snapshot({ tracks: [entity("track", "T1", { name: "Target" })] });
    const after = snapshot({
      tracks: [entity("track", "T1", { name: "Target" })],
      fx: [entity("fx", "F1", {
        ...relation("track", "T1", "track"),
        owner_kind: "track",
        trusted_surface: "D",
        plugin_name: "ReaEQ (Cockos)",
        plugin_ident: "VST3:ReaEQ (Cockos)",
        parameters: { "0": { param_index: 0 } },
      })],
    });
    const diff = diffLearningSnapshots(before, after);
    assert.equal(factFor(diff, "unknown").field, "parameters.0");
    const result = compileLearnedRecipe(diff);
    assert.equal(result.ok, false);
    assert.equal(result.status, "blocked");
    assert.equal(result.recipe, null);
    assert.equal(result.blockers.some((blocker) => blocker.classification === "unknown"), true);
  });

  it("fails closed for gesture, raw Lua, action, shell, and UI replay-shaped facts", () => {
    for (const field of ["gesture", "raw_lua", "action", "shell", "ui"]) {
      const diff = diffLearningSnapshots(
        snapshot({ tracks: [entity("track", "T1", { name: "Before" })] }),
        snapshot({ tracks: [entity("track", "T1", { name: "After" })] }, { [field]: { replay: true } }),
      );
      assert.equal(factFor(diff, "unsupported").classification, "unsupported", field);
      const result = compileLearnedRecipe(diff);
      assert.equal(result.ok, false, field);
      assert.equal(result.status, "blocked", field);
      assert.equal(result.recipe, null, field);
    }
  });

  it("exposes no capture, call_recipe, or live REAPER entrypoint", () => {
    for (const name of ["capture", "call_recipe", "liveReaper", "live_reaper", "startReaper"]) {
      assert.equal(Object.hasOwn(compiler, name), false, name);
    }
  });
});
