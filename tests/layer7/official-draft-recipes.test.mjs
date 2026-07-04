import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
  recipeTemplateDependencies,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  loadUserRecipeAuthoringCatalog,
} from "../../packages/core/src/user-recipe-authoring-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  createTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";

const REPO_ROOT = path.resolve(new URL("../..", import.meta.url).pathname);
const PACKET_ROOT = path.join(REPO_ROOT, "recipes", "official", "layer7", "first_atoms_a");

const EXPECTED_PACKET_IDS = Object.freeze([
  "recipe.analysis.selected_item_cycle_quality_report",
  "recipe.items.layer_report_from_evidence",
  "recipe.midi.track_phrase_seed",
  "recipe.project.cleanup_fingerprint_report",
  "recipe.render.region_delivery_report",
  "recipe.render.region_wav_render",
]);

const EXPECTED_DEPENDENCIES = Object.freeze({
  "recipe.analysis.selected_item_cycle_quality_report": Object.freeze([
    "template.analysis.detect_loop_candidates",
    "template.analysis.measure_loop_click_risk",
    "template.analysis.create_loop_qa_report",
  ]),
  "recipe.project.cleanup_fingerprint_report": Object.freeze([
    "template.project.create_cleanup_report",
  ]),
  "recipe.render.region_wav_render": Object.freeze([
    "template.render.render_region_wav",
  ]),
  "recipe.render.region_delivery_report": Object.freeze([
    "template.render.create_delivery_report",
  ]),
  "recipe.items.layer_report_from_evidence": Object.freeze([
    "template.items.create_layer_report",
  ]),
  "recipe.midi.track_phrase_seed": Object.freeze([
    "template.tracks.create_track",
    "template.midi.create_midi_item",
    "template.midi.read_take_grid",
    "template.midi.insert_notes_batch",
    "template.midi.read_take_event_counts",
    "template.midi.list_take_notes",
  ]),
});

const ACCEPTED_TEMPLATE_SET = new Set(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS);
const ACCEPTED_TEMPLATE_CATALOG = createTemplateCatalog({
  templates: [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
    ...createTemplateCatalogCriticalFillTemplates(),
  ],
});

describe("Layer 7 official draft recipe packet", () => {
  it("loads exactly the six first-atoms draft recipes through Layer 6 authoring", () => {
    const authoring = loadUserRecipeAuthoringCatalog({ repoRoot: REPO_ROOT });

    assert.equal(authoring.catalog.size, EXPECTED_PACKET_IDS.length);
    assert.deepEqual([...authoring.catalog.ids].sort(), [...EXPECTED_PACKET_IDS].sort());
    assert.deepEqual(
      authoring.sources.map((source) => source.source),
      Array(EXPECTED_PACKET_IDS.length).fill("official"),
    );
    assert.deepEqual(
      authoring.sources.map((source) => source.lifecycle),
      Array(EXPECTED_PACKET_IDS.length).fill("draft"),
    );
  });

  it("keeps the packet small and only in the supported official recipe source root", () => {
    const files = packetRecipeFiles();

    assert.equal(files.length, EXPECTED_PACKET_IDS.length);
    assert.deepEqual(files.map((file) => path.basename(file)).sort(), [
      "analysis.selected_item_cycle_quality_report.recipe.json",
      "items.layer_report_from_evidence.recipe.json",
      "midi.track_phrase_seed.recipe.json",
      "project.cleanup_fingerprint_report.recipe.json",
      "render.region_delivery_report.recipe.json",
      "render.region_wav_render.recipe.json",
    ]);
  });

  it("uses only accepted template ids and the planned dependency sets", () => {
    for (const recipe of recipes()) {
      const dependencies = recipeTemplateDependencies(recipe);
      assert.deepEqual(dependencies, EXPECTED_DEPENDENCIES[recipe.id], recipe.id);
      for (const templateId of dependencies) {
        assert.equal(ACCEPTED_TEMPLATE_SET.has(templateId), true, `${recipe.id} uses ${templateId}`);
      }
    }
  });

  it("keeps lifecycle and evidence claims honest", () => {
    for (const recipe of recipes()) {
      assert.equal(recipe.lifecycle, "draft", recipe.id);
      assert.notEqual(recipe.lifecycle, "official", recipe.id);
      assert.notEqual(recipe.lifecycle, "live_smoked", recipe.id);
      assert.notEqual(recipe.lifecycle, "fake_smoked", recipe.id);
      for (const step of recipe.steps) {
        if (step.uses !== "call_template") continue;
        assert.equal(step.evidence.startsWith("evidence_"), true, step.id);
      }
    }

    const a3 = recipesById().get("recipe.items.layer_report_from_evidence");
    const a3Text = JSON.stringify(a3);
    assert.match(a3.summary, /fixture/);
    assert.match(a3.summary, /does not derive live layer roles/);
    assert.match(a3Text, /typed fixture/i);
    assert.match(a3Text, /not live role classification/i);
  });

  it("contains no absolute local paths or public last-result artifact aliases", () => {
    for (const file of packetRecipeFiles()) {
      const text = readFileSync(file, "utf8");
      assert.doesNotMatch(text, /\/Users\//, file);
      assert.doesNotMatch(text, /file:\/\//i, file);
      assert.doesNotMatch(text, /"(?:\/|~\/|[A-Za-z]:[\\/])/, file);
      assert.doesNotMatch(text, /last_result:artifact:[0-9]+|last_result:artifact:N/, file);
      assert.doesNotMatch(text, /"lifecycle"\s*:\s*"(?:official|live_smoked|fake_smoked)"/, file);
    }
  });

  it("keeps call-template refs within accepted descriptor declarations", () => {
    for (const recipe of recipes()) {
      validateRecipeRefs(recipe);
    }
  });

  it("keeps artifact get_state reads symbolic and declared by expected outputs", () => {
    for (const recipe of recipes()) {
      const expectedArtifacts = new Set();
      for (const assertion of recipe.assertions) {
        if (assertion.kind !== "expected_output") continue;
        for (const artifact of assertion.outputs.artifacts) expectedArtifacts.add(artifact);
      }

      for (const step of recipe.steps) {
        if (step.uses !== "get_state" || !step.get_state.projection.startsWith("artifact.")) continue;
        assert.match(step.get_state.projection, /^artifact\.(summary|payload)$/);
        assert.equal(step.get_state.refs.length, 1, step.id);
        assert.equal(expectedArtifacts.has(step.get_state.refs[0]), true, step.id);
      }
    }
  });

  it("preserves render portability and avoids deferred render metadata claims", () => {
    const render = recipesById().get("recipe.render.region_wav_render");
    const renderStep = render.steps.find((step) => step.id === "render_region_wav");

    assert.equal(renderStep.call_template.input.output_policy, "openreaper_managed_render_root");
    assert.equal(renderStep.call_template.input.collision_policy, "fail_if_exists");
    assert.equal(Object.hasOwn(renderStep.call_template.input, "output_path"), false);
    assert.equal(Object.hasOwn(renderStep.call_template.input, "output_directory"), false);
    assert.equal(
      recipeTemplateDependencies(render).includes("template.render.output_file_metadata"),
      false,
    );
  });

  it("does not create north-star or workflow-shaped recipe packs", () => {
    for (const recipe of recipes()) {
      assert.doesNotMatch(recipe.id, /^recipe\.(loop|cleanup|delivery|layer|music_sketch)\./);
      assert.doesNotMatch(recipe.pack, /^(loop|cleanup|delivery|layer|music_sketch)$/);
    }
  });
});

function packetRecipeFiles() {
  return readdirSync(PACKET_ROOT)
    .filter((file) => file.endsWith(".recipe.json"))
    .map((file) => path.join(PACKET_ROOT, file))
    .sort();
}

function recipes() {
  const authoring = loadUserRecipeAuthoringCatalog({ repoRoot: REPO_ROOT });
  return authoring.catalog.list();
}

function recipesById() {
  return new Map(recipes().map((recipe) => [recipe.id, recipe]));
}

function validateRecipeRefs(recipe) {
  const priorSteps = new Map();

  for (const step of recipe.steps) {
    if (step.uses !== "call_template") continue;

    const descriptor = ACCEPTED_TEMPLATE_CATALOG.require(step.call_template.id);
    const declarations = new Map(descriptor.refs.input.map((entry) => [entry.name, entry]));

    for (const refName of Object.keys(step.call_template.refs)) {
      assert.equal(declarations.has(refName), true, `${step.id} refs.${refName} is undeclared`);
    }

    for (const declaration of descriptor.refs.input) {
      const value = step.call_template.refs[declaration.name];
      if (declaration.required) {
        assert.notEqual(value, undefined, `${step.id} refs.${declaration.name} is required`);
      }
      if (value !== undefined) validateRefValue({ step, declaration, value, priorSteps });
    }

    priorSteps.set(step.id, { step, descriptor });
  }
}

function validateRefValue({ step, declaration, value, priorSteps }) {
  if (Array.isArray(value)) {
    assert.notEqual(value.length, 0, `${step.id} refs.${declaration.name} array must not be empty`);
    for (const entry of value) validateRefValue({ step, declaration, value: entry, priorSteps });
    return;
  }

  assert.equal(isPlainObject(value), true, `${step.id} refs.${declaration.name} must be an object`);
  if (Object.hasOwn(value, "$from_step")) {
    validateSymbolicRef({ step, declaration, value, priorSteps });
    return;
  }

  assert.equal(value.kind, declaration.kind, `${step.id} refs.${declaration.name} kind`);
  assert.equal(typeof value.ref, "string", `${step.id} refs.${declaration.name} ref`);
  assert.equal(value.ref.startsWith(`${declaration.kind}:`), true, value.ref);
  assert.equal(isPlainObject(value.identity), true, `${step.id} refs.${declaration.name} identity`);
  if (declaration.kind === "artifact") parseArtifactRef(value.ref);
}

function validateSymbolicRef({ step, declaration, value, priorSteps }) {
  const source = priorSteps.get(value.$from_step);
  assert.ok(source, `${step.id} refs.${declaration.name} source step must be earlier`);

  const output = source.descriptor.refs.output.find((entry) => entry.name === value.output);
  assert.ok(output, `${step.id} refs.${declaration.name} output must be declared`);
  assert.equal(output.kind, declaration.kind, `${step.id} refs.${declaration.name} output kind`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
