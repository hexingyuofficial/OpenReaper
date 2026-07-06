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
  listUserRecipes,
} from "../../packages/mcp-server/src/user-recipe-discovery-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
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
  "recipe.media.item_prep_from_folder",
  "recipe.midi.track_phrase_seed",
  "recipe.project.cleanup_trial_created_objects",
  "recipe.project.fast_observation_bundle",
  "recipe.project.cleanup_fingerprint_report",
  "recipe.project.inspect_current_fixture_readiness",
  "recipe.project.map_snapshot_page",
  "recipe.render.region_delivery_report",
  "recipe.render.region_wav_render",
  "recipe.routing.send_fx_automation_setup",
  "recipe.tracks.adjust_selected_track_basic_balance",
  "recipe.tracks.cleanup_created_track_set",
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
  "recipe.project.fast_observation_bundle": Object.freeze([
    "template.project.create_observation_bundle",
  ]),
  "recipe.project.map_snapshot_page": Object.freeze([
    "template.project.create_project_map_snapshot",
  ]),
  "recipe.project.cleanup_trial_created_objects": Object.freeze([
    "template.project.read_track_item_overview",
    "template.items.delete_items",
    "template.tracks.delete_tracks",
    "template.project.delete_marker",
    "template.project.delete_region",
  ]),
  "recipe.project.inspect_current_fixture_readiness": Object.freeze([
    "template.project.read_track_item_overview",
    "template.tracks.list_tracks",
    "template.items.list_selected_items",
    "template.tracks.read_mixer_controls",
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
  "recipe.media.item_prep_from_folder": Object.freeze([
    "template.media.list_folder_media_files",
    "template.media.import_file_section_to_track",
    "template.items.set_take_playrate",
    "template.items.split_item_at_time",
    "template.items.copy_item_to_track",
  ]),
  "recipe.midi.track_phrase_seed": Object.freeze([
    "template.tracks.create_track",
    "template.midi.create_midi_item",
    "template.midi.read_take_grid",
    "template.midi.insert_notes_batch",
    "template.midi.read_take_event_counts",
    "template.midi.list_take_notes",
  ]),
  "recipe.routing.send_fx_automation_setup": Object.freeze([
    "template.routing.create_track_send",
    "template.routing.set_send_volume",
    "template.fx.add_track_fx",
    "template.fx.list_fx_parameters",
    "template.automation.resolve_send_envelope",
    "template.automation.set_envelope_lane_state",
    "template.automation.insert_envelope_point",
  ]),
  "recipe.tracks.adjust_selected_track_basic_balance": Object.freeze([
    "template.tracks.read_mixer_controls",
    "template.tracks.set_volume",
    "template.tracks.set_pan",
    "template.tracks.set_width",
  ]),
  "recipe.tracks.cleanup_created_track_set": Object.freeze([
    "template.project.read_track_item_overview",
    "template.tracks.delete_tracks",
  ]),
});

const ACCEPTED_TEMPLATE_SET = new Set(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS);
const ACCEPTED_TEMPLATE_CATALOG = createTemplateCatalog({
  templates: [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
    ...createTemplateCatalogCriticalFillTemplates(),
    ...createTemplateCatalogP1Templates(),
  ],
});

describe("Layer 7 official draft recipe packet", () => {
  it("loads exactly the fourteen first-atoms draft recipes through Layer 6 authoring", () => {
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
      "media.item_prep_from_folder.recipe.json",
      "midi.track_phrase_seed.recipe.json",
      "project.cleanup_fingerprint_report.recipe.json",
      "project.cleanup_trial_created_objects.recipe.json",
      "project.fast_observation_bundle.recipe.json",
      "project.inspect_current_fixture_readiness.recipe.json",
      "project.map_snapshot_page.recipe.json",
      "render.region_delivery_report.recipe.json",
      "render.region_wav_render.recipe.json",
      "routing.send_fx_automation_setup.recipe.json",
      "tracks.adjust_selected_track_basic_balance.recipe.json",
      "tracks.cleanup_created_track_set.recipe.json",
    ]);
  });

  it("uses only accepted template ids and the planned dependency sets", () => {
    for (const recipe of recipes()) {
      const dependencies = recipeTemplateDependencies(recipe);
      assert.deepEqual(dependencies, EXPECTED_DEPENDENCIES[recipe.id], recipe.id);
      assert.deepEqual(recipe.workflow_card.template_atoms, dependencies, recipe.id);
      for (const templateId of dependencies) {
        assert.equal(ACCEPTED_TEMPLATE_SET.has(templateId), true, `${recipe.id} uses ${templateId}`);
      }
    }
  });

  it("surfaces lightweight workflow cards without recipe execution authority", () => {
    const menu = listUserRecipes({ limit: EXPECTED_PACKET_IDS.length }, { repoRoot: REPO_ROOT });

    assert.equal(menu.items.length, EXPECTED_PACKET_IDS.length);
    for (const item of menu.items) {
      assert.equal(typeof item.workflow_card.intent, "string", item.id);
      assert.equal(item.workflow_card.blocked_steps.some((step) => /call_recipe/.test(step)), true, item.id);
      assert.equal(item.workflow_card.token_budget.same_typed_blocker_stop_after, 2, item.id);
      assert.deepEqual(
        item.workflow_card.template_atoms,
        EXPECTED_DEPENDENCIES[item.id],
        item.id,
      );
      assert.doesNotMatch(JSON.stringify(item.workflow_card), /executor.*available|live recipe support is available/i, item.id);
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

    const e6 = recipesById().get("recipe.media.item_prep_from_folder");
    assert.match(e6.summary, /Draft write-risk family recipe/);
    assert.match(e6.tags.join(" "), /e6_family/);
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

  it("adds an E6 media/item family over post-V1 atoms without creating an executor", () => {
    const recipe = recipesById().get("recipe.media.item_prep_from_folder");
    const dependencies = recipeTemplateDependencies(recipe);
    const steps = new Map(recipe.steps.map((step) => [step.id, step]));

    assert.deepEqual(dependencies, EXPECTED_DEPENDENCIES[recipe.id]);
    assert.equal(recipe.lifecycle, "draft");
    assert.equal(recipe.risk, "write");
    assert.equal(recipe.tags.includes("e6_family"), true);
    assert.equal(recipe.steps.some((step) => step.uses === "get_state"), true);
    assert.deepEqual(
      recipe.steps.filter((step) => step.uses === "call_template").map((step) => step.call_template.id),
      [
        "template.media.list_folder_media_files",
        "template.media.import_file_section_to_track",
        "template.items.set_take_playrate",
        "template.items.split_item_at_time",
        "template.items.copy_item_to_track",
      ],
    );
    assert.deepEqual(steps.get("import_media_section").call_template.input, {
      position_seconds: 0,
      start_percent: 0.25,
      end_percent: 0.75,
      preserve_selection: true,
    });
    assert.deepEqual(steps.get("import_media_section").call_template.refs.source_file_ref, {
      "$from_step": "list_folder_media",
      output: "file_refs",
    });
    assert.deepEqual(steps.get("set_take_playrate").call_template.refs.item_ref, {
      "$from_step": "import_media_section",
      output: "imported_item_refs",
    });
    assert.deepEqual(steps.get("split_prepped_item").call_template.refs.item_ref, {
      "$from_step": "set_take_playrate",
      output: "item_ref",
    });
    assert.deepEqual(steps.get("copy_right_item").call_template.refs.source_item_ref, {
      "$from_step": "split_prepped_item",
      output: "right_item_ref",
    });
    assert.equal(
      recipe.recovery.risk_gates.every((gate) => gate.required_before_step === "import_media_section"),
      true,
    );
    assert.equal(recipe.assertions.some((assertion) => assertion.id === "assert_no_loop_source_authority"), true);
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(recipe)), /call_recipe|executor|raw_lua|raw_action|shell/i);
    assert.doesNotMatch(JSON.stringify(recipe), /template\.media\.relink_take_source|B_LOOPSRC|set_item_loop_source/i);
  });

  it("discovers the E6 family through compact recipe-menu intent fields", () => {
    const menu = listUserRecipes({
      query: "playrate",
      fields: ["id", "summary", "capability_group", "task_intents", "support"],
    }, { repoRoot: REPO_ROOT });
    const item = menu.items.find((entry) => entry.id === "recipe.media.item_prep_from_folder");

    assert.ok(item);
    assert.deepEqual(Object.keys(item).sort(), [
      "capability_group",
      "id",
      "summary",
      "support",
      "task_intents",
    ].sort());
    assert.equal(item.capability_group, "media.media_item_prep");
    assert.equal(item.support.status, "candidate");
    assert.equal(item.support.evidence, "lifecycle:draft");
    assert.equal(item.task_intents.includes("playrate"), true);
    assert.equal("steps" in item, false);
    assert.equal("assertions" in item, false);
  });

  it("adds an E6 routing/FX/automation family over E2 and E5 atoms without creating an executor", () => {
    const recipe = recipesById().get("recipe.routing.send_fx_automation_setup");
    const dependencies = recipeTemplateDependencies(recipe);

    assert.deepEqual(dependencies, EXPECTED_DEPENDENCIES[recipe.id]);
    assert.equal(recipe.lifecycle, "draft");
    assert.equal(recipe.risk, "write");
    assert.equal(recipe.tags.includes("e6_family"), true);
    assert.deepEqual(
      recipe.steps.filter((step) => step.uses === "call_template").map((step) => step.call_template.id),
      [
        "template.routing.create_track_send",
        "template.routing.set_send_volume",
        "template.fx.add_track_fx",
        "template.fx.list_fx_parameters",
        "template.automation.resolve_send_envelope",
        "template.automation.set_envelope_lane_state",
        "template.automation.insert_envelope_point",
      ],
    );
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(recipe)), /call_recipe|executor|raw_lua|raw_action|shell/i);
  });

  it("adds cleanup, balance, and fixture-readiness workflow atoms without creating an executor", () => {
    const byId = recipesById();
    const cleanupTracks = byId.get("recipe.tracks.cleanup_created_track_set");
    const cleanupProject = byId.get("recipe.project.cleanup_trial_created_objects");
    const balance = byId.get("recipe.tracks.adjust_selected_track_basic_balance");
    const readiness = byId.get("recipe.project.inspect_current_fixture_readiness");

    assert.equal(cleanupTracks.risk, "destructive");
    assert.equal(cleanupProject.risk, "destructive");
    assert.equal(balance.risk, "write");
    assert.equal(readiness.risk, "read");
    assert.equal(cleanupTracks.recovery.risk_gates[0].policy, "user_confirmation");
    assert.equal(cleanupProject.recovery.risk_gates[0].policy, "user_confirmation");
    assert.equal(cleanupTracks.recovery.risk_gates[0].blocks_auto_resume, true);
    assert.equal(cleanupProject.recovery.risk_gates[0].blocks_auto_resume, true);
    assert.deepEqual(recipeTemplateDependencies(cleanupTracks), EXPECTED_DEPENDENCIES[cleanupTracks.id]);
    assert.deepEqual(recipeTemplateDependencies(cleanupProject), EXPECTED_DEPENDENCIES[cleanupProject.id]);
    assert.deepEqual(recipeTemplateDependencies(balance), EXPECTED_DEPENDENCIES[balance.id]);
    assert.deepEqual(recipeTemplateDependencies(readiness), EXPECTED_DEPENDENCIES[readiness.id]);
    assert.equal(readiness.tags.includes("product_surface"), true);
    assert.match(readiness.workflow_card.intent, /compact project snapshot/);
    assert.deepEqual(readiness.workflow_card.supported_steps, [
      "Read compact project track/item overview.",
      "List tracks and selected items as canonical refs.",
      "Read bounded mixer controls for target confirmation.",
    ]);
    assert.equal(
      readiness.workflow_card.required_questions.some((question) => /before mutation/i.test(question)),
      true,
    );
    assert.deepEqual(readiness.assertions[0].outputs.refs, [
      "project_ref",
      "track_ref",
      "item_ref",
    ]);
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(cleanupTracks)), /call_recipe|executor|raw_lua|raw_action|shell/i);
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(cleanupProject)), /call_recipe|executor|raw_lua|raw_action|shell/i);
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(balance)), /call_recipe|executor|raw_lua|raw_action|shell/i);
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(readiness)), /call_recipe|executor|raw_lua|raw_action|shell/i);
  });

  it("adds an Alpha3 fast observation workflow over the fixed observation bundle atom", () => {
    const recipe = recipesById().get("recipe.project.fast_observation_bundle");

    assert.deepEqual(recipeTemplateDependencies(recipe), EXPECTED_DEPENDENCIES[recipe.id]);
    assert.equal(recipe.lifecycle, "draft");
    assert.equal(recipe.risk, "read");
    assert.equal(recipe.tags.includes("alpha3"), true);
    assert.equal(recipe.tags.includes("speed"), true);
    assert.deepEqual(
      recipe.steps.map((step) => [step.id, step.uses]),
      [
        ["create_observation_bundle", "call_template"],
        ["read_observation_summary", "get_state"],
        ["read_observation_payload", "get_state"],
      ],
    );
    assert.deepEqual(recipe.steps[0].call_template.input, {
      max_tracks: 16,
      max_items_per_track: 1,
      max_selected_items: 8,
      track_cursor: 0,
      marker_region_limit: 32,
      tempo_marker_limit: 16,
      include_transport: true,
      include_track_items: true,
    });
    assert.deepEqual(recipe.assertions[0].outputs.artifacts, ["observation_bundle"]);
    assert.deepEqual(
      recipe.steps
        .filter((step) => step.uses === "get_state")
        .map((step) => step.get_state.refs),
      [["observation_bundle"], ["observation_bundle"]],
    );
    assert.match(recipe.workflow_card.intent, /compact observation bundle/);
    assert.equal(
      recipe.workflow_card.supported_steps.some((step) => /artifact summary/i.test(step)),
      true,
    );
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(recipe)), /call_recipe|executor|raw_lua|raw_action|shell/i);
  });

  it("adds an Alpha3 project map snapshot workflow over the fixed snapshot atom", () => {
    const recipe = recipesById().get("recipe.project.map_snapshot_page");

    assert.deepEqual(recipeTemplateDependencies(recipe), EXPECTED_DEPENDENCIES[recipe.id]);
    assert.equal(recipe.lifecycle, "draft");
    assert.equal(recipe.risk, "read");
    assert.equal(recipe.tags.includes("large_project"), true);
    assert.deepEqual(
      recipe.steps.map((step) => [step.id, step.uses]),
      [
        ["create_project_map_snapshot", "call_template"],
        ["read_project_map_summary", "get_state"],
        ["read_project_map_payload", "get_state"],
      ],
    );
    assert.deepEqual(recipe.steps[0].call_template.input, {
      max_tracks: 16,
      max_items_per_track: 2,
      max_selected_items: 8,
      track_cursor: 0,
      include_selected_items: true,
      include_track_items: true,
    });
    assert.deepEqual(recipe.assertions[0].outputs.artifacts, ["project_map_snapshot"]);
    assert.deepEqual(
      recipe.steps
        .filter((step) => step.uses === "get_state")
        .map((step) => step.get_state.refs),
      [["project_map_snapshot"], ["project_map_snapshot"]],
    );
    assert.match(recipe.workflow_card.intent, /project-map page/);
    assert.equal(
      recipe.workflow_card.supported_steps.some((step) => /counts, cursor, and coverage/i.test(step)),
      true,
    );
    assert.doesNotMatch(JSON.stringify(withoutWorkflowCard(recipe)), /call_recipe|executor|raw_lua|raw_action|shell/i);
  });

  it("discovers the Alpha3 fast observation workflow through compact recipe-menu fields", () => {
    const menu = listUserRecipes({
      query: "observation",
      fields: ["id", "summary", "capability_group", "task_intents", "support"],
    }, { repoRoot: REPO_ROOT });
    const item = menu.items.find((entry) => entry.id === "recipe.project.fast_observation_bundle");

    assert.ok(item);
    assert.equal(item.capability_group, "project.project_observation");
    assert.equal(item.support.status, "candidate");
    assert.equal(item.support.evidence, "lifecycle:draft");
    assert.equal(item.task_intents.includes("observation"), true);
    assert.equal("steps" in item, false);
    assert.equal("assertions" in item, false);
  });

  it("discovers the Alpha3 project map snapshot workflow through compact recipe-menu fields", () => {
    const menu = listUserRecipes({
      query: "snapshot",
      fields: ["id", "summary", "capability_group", "task_intents", "support"],
    }, { repoRoot: REPO_ROOT });
    const item = menu.items.find((entry) => entry.id === "recipe.project.map_snapshot_page");

    assert.ok(item);
    assert.equal(item.capability_group, "project.project_snapshot");
    assert.equal(item.support.status, "candidate");
    assert.equal(item.support.evidence, "lifecycle:draft");
    assert.equal(item.task_intents.includes("snapshot"), true);
    assert.equal("steps" in item, false);
    assert.equal("assertions" in item, false);
  });

  it("discovers the E6 routing/FX/automation family through compact recipe-menu intent fields", () => {
    const menu = listUserRecipes({
      query: "automation",
      fields: ["id", "summary", "capability_group", "task_intents", "support"],
    }, { repoRoot: REPO_ROOT });
    const item = menu.items.find((entry) => entry.id === "recipe.routing.send_fx_automation_setup");

    assert.ok(item);
    assert.equal(item.capability_group, "routing.send_fx_automation_setup");
    assert.equal(item.support.status, "candidate");
    assert.equal(item.support.evidence, "lifecycle:draft");
    assert.equal(item.task_intents.includes("automation"), true);
    assert.equal("steps" in item, false);
    assert.equal("assertions" in item, false);
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

function withoutWorkflowCard(recipe) {
  const { workflow_card, ...rest } = recipe;
  return rest;
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
