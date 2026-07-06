import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import {
  formatArtifactRef,
  parseArtifactRef,
} from "../../packages/core/src/artifact-state-store-v1.mjs";
import {
  RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS,
  RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  loadUserRecipeAuthoringCatalog,
} from "../../packages/core/src/user-recipe-authoring-v1.mjs";
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
  "recipe.tracks.prepare_recording_track",
]);

const WRITE_ATOMS = new Set([
  "recipe.midi.track_phrase_seed",
  "recipe.render.region_wav_render",
  "recipe.media.item_prep_from_folder",
  "recipe.routing.send_fx_automation_setup",
  "recipe.project.cleanup_trial_created_objects",
  "recipe.tracks.adjust_selected_track_basic_balance",
  "recipe.tracks.cleanup_created_track_set",
  "recipe.tracks.prepare_recording_track",
]);

const FIXTURE_BACKED_LAYER_REPORT_ID = "recipe.items.layer_report_from_evidence";

const ACCEPTED_TEMPLATE_CATALOG = createTemplateCatalog({
  templates: [
    ...createTemplateCatalogWave1aTemplates(),
    ...createTemplateCatalogWave2aTemplates(),
    ...createTemplateCatalogWave3bTemplates(),
    ...createTemplateCatalogCriticalFillTemplates(),
    ...createTemplateCatalogP1Templates(),
  ],
});

describe("Layer 7 official draft recipe fake smoke", () => {
  it("executes exactly the fifteen draft atoms as composed fake recipe graphs", () => {
    const runs = loadDraftRecipes().map((recipe) => fakeSmokeRecipe(recipe));

    assert.deepEqual(
      runs.map((run) => run.recipe_id).sort(),
      [...EXPECTED_PACKET_IDS].sort(),
    );
    assert.equal(runs.every((run) => run.status === "succeeded"), true);

    for (const run of runs) {
      assert.deepEqual(run.step_order, run.recipe.steps.map((step) => step.id), run.recipe_id);
      assert.deepEqual(
        run.template_calls.map((call) => call.template_id),
        run.recipe.steps
          .filter((step) => step.uses === "call_template")
          .map((step) => step.call_template.id),
        run.recipe_id,
      );
      assert.equal(run.recipe.lifecycle, "draft", run.recipe_id);
      assert.equal(run.undeclared_template_probe_rejected, true, run.recipe_id);
    }
  });

  it("keeps fake outputs descriptor-derived and artifact state reads label-only", () => {
    for (const recipe of loadDraftRecipes()) {
      const run = fakeSmokeRecipe(recipe);

      for (const call of run.template_calls) {
        const descriptor = ACCEPTED_TEMPLATE_CATALOG.require(call.template_id);
        assert.deepEqual(
          call.declared_outputs,
          descriptor.refs.output.map(({ name, kind }) => ({ name, kind })),
          call.step_id,
        );
        assert.deepEqual(
          Object.keys(call.outputs),
          descriptor.refs.output.map((output) => output.name),
          call.step_id,
        );
        assert.deepEqual(
          call.evidence.declared_refs,
          descriptor.refs.output.map(({ name, kind }) => ({ name, kind })),
          call.step_id,
        );
        assert.deepEqual(
          call.evidence.declared_artifacts,
          descriptor.artifacts.output.map(({ name, schema, owner_pack }) => ({ name, schema, owner_pack })),
          call.step_id,
        );
        assert.deepEqual(
          call.evidence.declared_jobs,
          descriptor.refs.output
            .filter((output) => output.kind === "job")
            .map(({ name, kind }) => ({ name, kind })),
          call.step_id,
        );

        const descriptorArtifactLabels = new Set(descriptor.artifacts.output.map((artifact) => artifact.name));
        for (const artifact of call.result.artifacts) {
          assert.equal(descriptorArtifactLabels.has(artifact.label), true, call.step_id);
        }
      }

      for (const read of run.state_reads.filter((entry) => entry.projection.startsWith("artifact."))) {
        assert.equal(read.by, "expected_output_label", read.step_id);
        assert.match(read.projection, /^artifact\.(summary|payload)$/);
        assert.doesNotMatch(read.label, /^artifact:/);
        assert.doesNotMatch(read.label, /^last_result:artifact(?::|$)/);
        assert.equal(run.expected.artifacts.has(read.label), true, read.step_id);
      }
    }
  });

  it("rejects forged step outputs and forbidden artifact get_state aliases", () => {
    const byId = new Map(loadDraftRecipes().map((recipe) => [recipe.id, recipe]));

    const forgedAssertionLabel = cloneRecipe(byId.get("recipe.analysis.selected_item_cycle_quality_report"));
    forgedAssertionLabel.steps
      .find((step) => step.id === "measure_click_risk")
      .call_template.refs.candidate_artifact_ref = {
        "$from_step": "detect_loop_candidates",
        output: "loop_candidates",
      };
    assert.throws(
      () => fakeSmokeRecipe(forgedAssertionLabel),
      /declared source output/,
    );

    const futureStepBinding = cloneRecipe(byId.get("recipe.midi.track_phrase_seed"));
    futureStepBinding.steps
      .find((step) => step.id === "create_midi_item")
      .call_template.refs.track_ref = {
        "$from_step": "insert_notes",
        output: "take_ref",
      };
    assert.throws(
      () => fakeSmokeRecipe(futureStepBinding),
      /source step is earlier/,
    );

    const publicLastResult = cloneRecipe(byId.get("recipe.project.cleanup_fingerprint_report"));
    publicLastResult.steps.find((step) => step.id === "read_cleanup_summary").get_state.refs = [
      "last_result:artifact:N",
    ];
    assert.throws(
      () => fakeSmokeRecipe(publicLastResult),
      /last_result:artifact/,
    );

    const canonicalArtifactRef = cloneRecipe(byId.get("recipe.items.layer_report_from_evidence"));
    canonicalArtifactRef.steps.find((step) => step.id === "read_layer_report_summary").get_state.refs = [
      "artifact:items:layer_evidence:art_20260704000000000_003_a3a3a3",
    ];
    assert.throws(
      () => fakeSmokeRecipe(canonicalArtifactRef),
      /canonical artifact refs/,
    );

    const fixtureInputRead = cloneRecipe(byId.get("recipe.items.layer_report_from_evidence"));
    fixtureInputRead.steps.find((step) => step.id === "read_layer_report_summary").get_state.refs = [
      "layer_evidence",
    ];
    assert.throws(
      () => fakeSmokeRecipe(fixtureInputRead),
      /prior fake artifact evidence/,
    );
  });

  it("pauses and acknowledges write-risk gates before fake write/render steps", () => {
    for (const recipe of loadDraftRecipes()) {
      const run = fakeSmokeRecipe(recipe);

      if (!WRITE_ATOMS.has(recipe.id)) {
        assert.deepEqual(run.risk_pauses, [], recipe.id);
        continue;
      }

      assert.equal(["write", "destructive"].includes(recipe.risk), true, recipe.id);
      assert.equal(run.risk_pauses.length > 0, true, recipe.id);
      assert.equal(run.risk_pauses.every((pause) => pause.acknowledged), true, recipe.id);
      assert.equal(run.risk_pauses.every((pause) => pause.blocks_auto_resume), true, recipe.id);

      const firstWriteStep = recipe.steps.find((step) => {
        if (step.uses !== "call_template") return false;
        return ACCEPTED_TEMPLATE_CATALOG.require(step.call_template.id).risk !== "read";
      });
      assert.ok(firstWriteStep, recipe.id);
      assert.equal(
        run.risk_pauses.some((pause) => pause.before_step === firstWriteStep.id),
        true,
        recipe.id,
      );
    }
  });

  it("keeps fixed fixture artifact refs draft-only and preserves the layer-report caveat", () => {
    for (const recipe of loadDraftRecipes()) {
      const run = fakeSmokeRecipe(recipe);
      for (const fixture of run.fixture_artifacts) {
        parseArtifactRef(fixture.ref);
        assert.equal(fixture.draft_only, true, `${recipe.id} ${fixture.label}`);
        assert.equal(recipe.lifecycle, "draft", recipe.id);
      }
    }

    const layerReport = loadDraftRecipes().find((recipe) => recipe.id === FIXTURE_BACKED_LAYER_REPORT_ID);
    const run = fakeSmokeRecipe(layerReport);

    assert.match(layerReport.summary, /fixture/);
    assert.match(layerReport.summary, /does not derive live layer roles/);
    assert.equal(run.fixture_caveat, "typed_fixture_not_live_layer_planning");
    assert.equal(run.fixture_artifacts.some((artifact) => artifact.label === "layer_evidence"), true);
  });

  it("fake-smokes the E6 media/item family as a recipe-only composition", () => {
    const recipe = loadDraftRecipes().find((entry) => entry.id === "recipe.media.item_prep_from_folder");
    const run = fakeSmokeRecipe(recipe);

    assert.equal(run.status, "succeeded");
    assert.deepEqual(
      run.template_calls.map((call) => call.template_id),
      [
        "template.media.list_folder_media_files",
        "template.media.import_file_section_to_track",
        "template.items.set_take_playrate",
        "template.items.split_item_at_time",
        "template.items.copy_item_to_track",
      ],
    );
    assert.equal(run.risk_pauses.length, 2);
    assert.equal(run.fixture_artifacts.length, 0);
    assert.equal(run.state_reads.some((read) => read.projection === "project.summary"), true);
    assert.equal(run.expected.refs.has("file_refs"), true);
    assert.equal(run.expected.refs.has("new_item_ref"), true);
  });

  it("fake-smokes the E6 routing/FX/automation family as a recipe-only composition", () => {
    const recipe = loadDraftRecipes().find((entry) => entry.id === "recipe.routing.send_fx_automation_setup");
    const run = fakeSmokeRecipe(recipe);

    assert.equal(run.status, "succeeded");
    assert.deepEqual(
      run.template_calls.map((call) => call.template_id),
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
    assert.equal(run.risk_pauses.length, 2);
    assert.equal(run.fixture_artifacts.length, 0);
    assert.equal(run.state_reads.some((read) => read.projection === "project.summary"), true);
    assert.equal(run.expected.refs.has("send_ref"), true);
    assert.equal(run.expected.refs.has("fx_ref"), true);
    assert.equal(run.expected.refs.has("envelope_ref"), true);
  });

  it("fake-smokes cleanup, balance, and fixture-readiness atoms as recipe-only compositions", () => {
    const byId = new Map(loadDraftRecipes().map((recipe) => [recipe.id, recipe]));
    const cleanupTracks = fakeSmokeRecipe(byId.get("recipe.tracks.cleanup_created_track_set"));
    const cleanupProject = fakeSmokeRecipe(byId.get("recipe.project.cleanup_trial_created_objects"));
    const balance = fakeSmokeRecipe(byId.get("recipe.tracks.adjust_selected_track_basic_balance"));
    const readiness = fakeSmokeRecipe(byId.get("recipe.project.inspect_current_fixture_readiness"));

    assert.equal(cleanupTracks.status, "succeeded");
    assert.deepEqual(
      cleanupTracks.template_calls.map((call) => call.template_id),
      [
        "template.project.read_track_item_overview",
        "template.tracks.delete_tracks",
        "template.project.read_track_item_overview",
      ],
    );
    assert.equal(cleanupTracks.risk_pauses.length, 1);
    assert.equal(cleanupTracks.risk_pauses[0].policy, "user_confirmation");

    assert.equal(cleanupProject.status, "succeeded");
    assert.deepEqual(
      cleanupProject.template_calls.map((call) => call.template_id),
      [
        "template.project.read_track_item_overview",
        "template.items.delete_items",
        "template.tracks.delete_tracks",
        "template.project.delete_marker",
        "template.project.delete_region",
        "template.project.read_track_item_overview",
      ],
    );
    assert.equal(cleanupProject.risk_pauses.length, 1);
    assert.equal(cleanupProject.risk_pauses[0].policy, "user_confirmation");

    assert.equal(balance.status, "succeeded");
    assert.deepEqual(
      balance.template_calls.map((call) => call.template_id),
      [
        "template.tracks.read_mixer_controls",
        "template.tracks.set_volume",
        "template.tracks.set_pan",
        "template.tracks.set_width",
        "template.tracks.read_mixer_controls",
      ],
    );
    assert.equal(balance.risk_pauses.length, 1);
    assert.equal(balance.expected.refs.has("track_ref"), true);

    assert.equal(readiness.status, "succeeded");
    assert.deepEqual(
      readiness.template_calls.map((call) => call.template_id),
      [
        "template.project.read_track_item_overview",
        "template.tracks.list_tracks",
        "template.items.list_selected_items",
        "template.tracks.read_mixer_controls",
      ],
    );
    assert.equal(readiness.risk_pauses.length, 0);
    assert.equal(readiness.expected.refs.has("project_ref"), true);
  });

  it("fake-smokes the Alpha3 recording-track starter as a recipe-only composition", () => {
    const recipe = loadDraftRecipes().find((entry) => entry.id === "recipe.tracks.prepare_recording_track");
    const run = fakeSmokeRecipe(recipe);

    assert.equal(run.status, "succeeded");
    assert.deepEqual(
      run.template_calls.map((call) => call.template_id),
      [
        "template.tracks.create_track",
        "template.tracks.select_track",
        "template.tracks.set_record_arm",
        "template.tracks.list_tracks",
      ],
    );
    assert.equal(run.risk_pauses.length, 1);
    assert.equal(run.risk_pauses[0].before_step, "create_recording_track");
    assert.equal(run.risk_pauses[0].policy, "user_confirmation");
    assert.equal(run.expected.refs.has("track_ref"), true);
    assert.equal(run.expected.state.has("recording_track_ready"), true);
  });

  it("fake-smokes the Alpha3 fast observation bundle as a recipe-only composition", () => {
    const recipe = loadDraftRecipes().find((entry) => entry.id === "recipe.project.fast_observation_bundle");
    const run = fakeSmokeRecipe(recipe);

    assert.equal(run.status, "succeeded");
    assert.deepEqual(
      run.template_calls.map((call) => call.template_id),
      ["template.project.create_observation_bundle"],
    );
    assert.equal(run.risk_pauses.length, 0);
    assert.equal(run.state_reads.length, 2);
    assert.deepEqual(
      run.state_reads.map((read) => [read.projection, read.label, read.schema]),
      [
        ["artifact.summary", "observation_bundle", "project.observation_bundle.v1"],
        ["artifact.payload", "observation_bundle", "project.observation_bundle.v1"],
      ],
    );
    assert.equal(run.expected.artifacts.has("observation_bundle"), true);
  });

  it("fake-smokes the Alpha3 project map snapshot as a recipe-only composition", () => {
    const recipe = loadDraftRecipes().find((entry) => entry.id === "recipe.project.map_snapshot_page");
    const run = fakeSmokeRecipe(recipe);

    assert.equal(run.status, "succeeded");
    assert.deepEqual(
      run.template_calls.map((call) => call.template_id),
      ["template.project.create_project_map_snapshot"],
    );
    assert.equal(run.risk_pauses.length, 0);
    assert.equal(run.state_reads.length, 2);
    assert.deepEqual(
      run.state_reads.map((read) => [read.projection, read.label, read.schema]),
      [
        ["artifact.summary", "project_map_snapshot", "project.project_map_snapshot.v1"],
        ["artifact.payload", "project_map_snapshot", "project.project_map_snapshot.v1"],
      ],
    );
    assert.equal(run.expected.artifacts.has("project_map_snapshot"), true);
  });

  it("keeps the fake smoke free of live, raw execution, public last-result, and hidden recipe surfaces", () => {
    for (const recipe of loadDraftRecipes()) {
      const run = fakeSmokeRecipe(recipe);
      const payload = JSON.stringify({
        recipe: withoutWorkflowCard(recipe),
        run: withoutWorkflowCardRun(run),
      });

      assertNoForbiddenRawFields(recipe, recipe.id);
      assert.equal(recipe.lifecycle, "draft", recipe.id);
      assert.notEqual(recipe.lifecycle, "fake_smoked", recipe.id);
      assert.notEqual(recipe.lifecycle, "live_smoked", recipe.id);
      assert.notEqual(recipe.lifecycle, "official", recipe.id);
      assert.doesNotMatch(payload, /\b(?:lua|raw_lua|shell|shell_command|script_body|run_shell)\b/i, recipe.id);
      assert.doesNotMatch(payload, /\b(?:bridge_request|call_recipe|mcp_tool|executor|spawn|process)\b/i, recipe.id);
      assert.doesNotMatch(payload, /\b(?:action_id|run_action|Main_OnCommand|NamedCommandLookup)\b/i, recipe.id);
      assert.doesNotMatch(payload, /file:\/\//i, recipe.id);
      assert.doesNotMatch(payload, /"(?:\/|~\/|[A-Za-z]:[\\/])/, recipe.id);
      assert.doesNotMatch(payload, /last_result:artifact:[0-9]+|last_result:artifact:N/, recipe.id);
    }
  });
});

function withoutWorkflowCard(recipe) {
  const { workflow_card, ...rest } = recipe;
  return rest;
}

function withoutWorkflowCardRun(run) {
  return {
    ...run,
    recipe: withoutWorkflowCard(run.recipe),
  };
}

function loadDraftRecipes() {
  const files = readdirSync(PACKET_ROOT).filter((file) => file.endsWith(".recipe.json"));
  assert.equal(files.length, EXPECTED_PACKET_IDS.length);

  const authoring = loadUserRecipeAuthoringCatalog({ repoRoot: REPO_ROOT });
  assert.equal(authoring.catalog.size, EXPECTED_PACKET_IDS.length);
  assert.deepEqual([...authoring.catalog.ids].sort(), [...EXPECTED_PACKET_IDS].sort());

  return authoring.catalog.list()
    .map((recipe) => {
      assert.equal(recipe.lifecycle, "draft", recipe.id);
      return recipe;
    })
    .sort((left, right) => left.id.localeCompare(right.id));
}

function fakeSmokeRecipe(recipe) {
  const expected = collectExpectedLabels(recipe);
  const stepById = new Map(recipe.steps.map((step) => [step.id, step]));
  const checkpointsByStep = new Map(recipe.recovery.checkpoints.map((checkpoint) => [checkpoint.after_step, checkpoint]));
  const evidenceByStep = new Map(recipe.recovery.evidence_requirements.map((evidence) => [evidence.step, evidence]));
  const riskGatesByStep = groupBy(recipe.recovery.risk_gates, (gate) => gate.required_before_step);
  const declaredTemplateIds = new Set(
    recipe.steps
      .filter((step) => step.uses === "call_template")
      .map((step) => step.call_template.id),
  );
  const stores = createRunStores();
  const run = {
    recipe,
    recipe_id: recipe.id,
    status: "running",
    expected,
    step_order: [],
    template_calls: [],
    state_reads: [],
    risk_pauses: [],
    checkpoints: [],
    evidence: [],
    fixture_artifacts: [],
    fixture_caveat: recipe.id === FIXTURE_BACKED_LAYER_REPORT_ID
      ? "typed_fixture_not_live_layer_planning"
      : null,
    undeclared_template_probe_rejected: false,
  };
  const priorCallSteps = new Map();

  assertUndeclaredTemplateRejected(recipe, declaredTemplateIds);
  run.undeclared_template_probe_rejected = true;

  for (const [index, step] of recipe.steps.entries()) {
    assert.equal(stepById.get(step.id), step, step.id);
    run.step_order.push(step.id);
    acknowledgeRiskGates({ recipe, step, gates: riskGatesByStep.get(step.id) ?? [], run });

    if (step.uses === "call_template") {
      const descriptor = ACCEPTED_TEMPLATE_CATALOG.require(step.call_template.id);
      const resolvedRefs = resolveStepRefs({
        step,
        descriptor,
        expected,
        stores,
        run,
        priorCallSteps,
      });
      const evidenceRequirement = evidenceByStep.get(step.id);
      assert.ok(evidenceRequirement, `${recipe.id} ${step.id} evidence requirement`);

      const call = fakeCallTemplate({
        recipe,
        step,
        descriptor,
        resolvedRefs,
        declaredTemplateIds,
        sequence: index + 1,
        stores,
      });

      assertTemplateEvidence({ call, evidenceRequirement, descriptor });
      run.template_calls.push(call);
      run.evidence.push(call.evidence);
      priorCallSteps.set(step.id, {
        step,
        descriptor,
        outputs: call.outputs,
      });
    } else {
      run.state_reads.push(fakeGetState({ step, expected, stores }));
    }

    const checkpoint = checkpointsByStep.get(step.id);
    assert.ok(checkpoint, `${recipe.id} ${step.id} checkpoint`);
    assert.equal(step.checkpoint, checkpoint.id, `${recipe.id} ${step.id} checkpoint id`);
    assertCheckpointReached({ checkpoint, step, run });
  }

  assert.equal(run.checkpoints.length, recipe.recovery.checkpoints.length, recipe.id);
  assert.equal(run.evidence.length, recipe.recovery.evidence_requirements.length, recipe.id);
  assertExpectedOutputsSatisfied({ recipe, expected, stores });
  assertRecoveryBranchesTied(recipe);
  assertWriteRiskGates(recipe, run);

  run.status = "succeeded";
  return run;
}

function assertUndeclaredTemplateRejected(recipe, declaredTemplateIds) {
  const undeclaredId = ACCEPTED_TEMPLATE_CATALOG.ids.find((id) => !declaredTemplateIds.has(id));
  assert.ok(undeclaredId, recipe.id);

  assert.throws(
    () => fakeCallTemplate({
      recipe,
      step: {
        id: "undeclared_probe",
        call_template: { id: undeclaredId },
      },
      descriptor: ACCEPTED_TEMPLATE_CATALOG.require(undeclaredId),
      resolvedRefs: {},
      declaredTemplateIds,
      sequence: 0,
      stores: createRunStores(),
    }),
    /not declared by recipe/,
    recipe.id,
  );
}

function acknowledgeRiskGates({ recipe, step, gates, run }) {
  for (const gate of gates) {
    assert.equal(recipe.recovery.resume.on_risk_gate, "pause_for_user", recipe.id);
    assert.equal(gate.applies_to.includes(recipe.risk), true, `${recipe.id} ${gate.id}`);
    assert.equal(gate.required_before_step, step.id, `${recipe.id} ${gate.id}`);
    run.status = "paused";
    run.risk_pauses.push({
      gate_id: gate.id,
      before_step: step.id,
      policy: gate.policy,
      blocks_auto_resume: gate.blocks_auto_resume,
      acknowledged: true,
    });
    run.status = "running";
  }
}

function resolveStepRefs({
  step,
  descriptor,
  expected,
  stores,
  run,
  priorCallSteps,
}) {
  const refs = step.call_template.refs;
  const inputDeclarations = new Map(descriptor.refs.input.map((declaration) => [declaration.name, declaration]));
  const resolved = {};
  let artifactInputIndex = 0;

  for (const key of Object.keys(refs)) {
    assert.equal(inputDeclarations.has(key), true, `${step.id} refs.${key} declared`);
  }

  for (const declaration of descriptor.refs.input) {
    if (!Object.hasOwn(refs, declaration.name)) {
      assert.equal(declaration.required, false, `${step.id} refs.${declaration.name} required`);
      continue;
    }

    const value = refs[declaration.name];
    const resolvedValue = resolveRefBinding({
      step,
      declaration,
      value,
      priorCallSteps,
    });
    resolved[declaration.name] = resolvedValue;

    if (declaration.kind === "artifact") {
      const artifactDeclaration = descriptor.artifacts.input[artifactInputIndex];
      artifactInputIndex += 1;
      assert.ok(artifactDeclaration, `${step.id} artifact input declaration`);
      retainArtifactInput({
        recipeStepId: step.id,
        artifactDeclaration,
        resolvedValue,
        expected,
        stores,
        run,
      });
    } else {
      retainLiteralInputRef({
        declaration,
        resolvedValue,
        stores,
      });
    }
  }

  return resolved;
}

function resolveRefBinding({ step, declaration, value, priorCallSteps }) {
  if (Array.isArray(value)) {
    assert.notEqual(value.length, 0, `${step.id} refs.${declaration.name} array`);
    return value.map((entry) => resolveRefBinding({
      step,
      declaration,
      value: entry,
      priorCallSteps,
    }));
  }

  assert.equal(isPlainObject(value), true, `${step.id} refs.${declaration.name}`);
  if (Object.hasOwn(value, "$from_step")) {
    assert.deepEqual(Object.keys(value).sort(), ["$from_step", "output"].sort(), `${step.id} symbolic binding fields`);
    const source = priorCallSteps.get(value.$from_step);
    assert.ok(source, `${step.id} refs.${declaration.name} source step is earlier`);
    const outputDeclaration = source.descriptor.refs.output.find((output) => output.name === value.output);
    assert.ok(outputDeclaration, `${step.id} refs.${declaration.name} declared source output`);
    assert.equal(outputDeclaration.kind, declaration.kind, `${step.id} refs.${declaration.name} kind`);
    const output = source.outputs[value.output];
    assert.ok(output, `${step.id} refs.${declaration.name} produced source output`);
    assert.equal(output.kind, declaration.kind, `${step.id} refs.${declaration.name} produced kind`);
    return {
      ...output,
      from_step: value.$from_step,
      output: value.output,
      binding: "$from_step",
    };
  }

  assert.equal(value.kind, declaration.kind, `${step.id} refs.${declaration.name} literal kind`);
  assert.equal(typeof value.ref, "string", `${step.id} refs.${declaration.name} literal ref`);
  assert.equal(value.ref.startsWith(`${declaration.kind}:`), true, value.ref);
  if (declaration.kind === "artifact") parseArtifactRef(value.ref);
  assertNoUnsafeRefString(value.ref, `${step.id} refs.${declaration.name}`);

  return {
    kind: value.kind,
    ref: value.ref,
    identity: value.identity,
    summary: value.summary ?? null,
    binding: "literal",
  };
}

function retainArtifactInput({
  recipeStepId,
  artifactDeclaration,
  resolvedValue,
  expected,
  stores,
  run,
}) {
  for (const artifact of flatten(resolvedValue)) {
    assert.equal(artifact.kind, "artifact", `${recipeStepId} artifact input kind`);
    if (artifact.binding === "$from_step") {
      assert.equal(artifact.label, artifactDeclaration.name, `${recipeStepId} artifact input label`);
      assert.equal(stores.artifacts.has(artifact.label), true, `${recipeStepId} produced artifact available`);
      continue;
    }

    assert.equal(expected.artifacts.has(artifactDeclaration.name), true, `${recipeStepId} fixture artifact label`);
    const fixture = {
      ...artifact,
      label: artifactDeclaration.name,
      schema: artifact.summary?.schema ?? artifactDeclaration.schema,
      draft_only: true,
    };
    stores.fixtureArtifacts.set(artifactDeclaration.name, fixture);
    run.fixture_artifacts.push(fixture);
  }
}

function retainLiteralInputRef({ declaration, resolvedValue, stores }) {
  for (const ref of flatten(resolvedValue)) {
    if (ref.binding !== "literal") continue;
    stores.inputRefs.set(declaration.name, {
      ...ref,
      label: declaration.name,
    });
  }
}

function fakeCallTemplate({
  recipe,
  step,
  descriptor,
  resolvedRefs,
  declaredTemplateIds,
  sequence,
  stores,
}) {
  const templateId = step.call_template.id;
  if (!declaredTemplateIds.has(templateId)) {
    throw new Error(`${templateId} is not declared by recipe ${recipe.id}.`);
  }
  assert.equal(descriptor.id, templateId, `${recipe.id} ${step.id} descriptor`);

  const result = {
    refs: [],
    artifacts: [],
    jobs: [],
  };
  const outputs = {};
  let artifactOutputIndex = 0;

  for (const declaration of descriptor.refs.output) {
    if (declaration.kind === "artifact") {
      const artifactDeclaration = descriptor.artifacts.output[artifactOutputIndex];
      artifactOutputIndex += 1;
      assert.ok(artifactDeclaration, `${step.id} artifact output declaration`);
      const artifact = fakeArtifactOutput({ descriptor, declaration, artifactDeclaration, sequence });
      result.artifacts.push(artifact);
      stores.artifacts.set(artifact.label, artifact);
      outputs[declaration.name] = artifact;
      continue;
    }

    if (declaration.kind === "job") {
      const job = fakeObjectOutput({ declaration, step, kind: "job" });
      result.jobs.push(job);
      stores.jobs.set(declaration.name, job);
      outputs[declaration.name] = job;
      continue;
    }

    const ref = fakeObjectOutput({ declaration, step, kind: declaration.kind });
    result.refs.push(ref);
    stores.refs.set(declaration.name, ref);
    outputs[declaration.name] = ref;
  }

  const evidence = {
    source: RECIPE_TEMPLATE_EVIDENCE_CONTRACT,
    ok: true,
    request_id: `req_fake_smoke_${sequence.toString().padStart(3, "0")}_${step.id}`,
    template_id: templateId,
    step_id: step.id,
    counts: {
      refs: result.refs.length,
      artifacts: result.artifacts.length,
      jobs: result.jobs.length,
      last_result_refs: descriptor.id === "template.render.render_region_wav" ? 1 : 0,
    },
    declared_outputs: descriptor.refs.output.map(({ name, kind }) => ({ name, kind })),
    declared_refs: descriptor.refs.output.map(({ name, kind }) => ({ name, kind })),
    declared_artifacts: descriptor.artifacts.output.map(({ name, schema, owner_pack }) => ({
      name,
      schema,
      owner_pack,
    })),
    declared_jobs: descriptor.refs.output
      .filter((output) => output.kind === "job")
      .map(({ name, kind }) => ({ name, kind })),
  };

  return {
    step_id: step.id,
    template_id: templateId,
    request_id: evidence.request_id,
    refs: resolvedRefs,
    declared_outputs: evidence.declared_outputs,
    outputs,
    result,
    evidence,
  };
}

function fakeGetState({ step, expected, stores }) {
  const { projection, refs } = step.get_state;

  if (!projection.startsWith("artifact.")) {
    for (const ref of refs) assertNoUnsafeRefString(ref, `${step.id} get_state.refs`);
    return {
      step_id: step.id,
      projection,
      refs,
      by: "state_projection",
    };
  }

  assert.match(projection, /^artifact\.(summary|payload)$/, step.id);
  assert.equal(refs.length, 1, step.id);
  const [label] = refs;
  assertNoUnsafeRefString(label, `${step.id} artifact label`);
  assert.doesNotMatch(label, /^artifact:/, `${step.id} must use symbolic labels, not canonical artifact refs`);
  assert.doesNotMatch(label, /^last_result:artifact(?::|$)/, step.id);
  assert.equal(expected.artifacts.has(label), true, `${step.id} artifact label declared`);

  const artifact = stores.artifacts.get(label);
  assert.ok(artifact, `${step.id} artifact label is backed by prior fake artifact evidence`);

  return {
    step_id: step.id,
    projection,
    label,
    schema: artifact.schema,
    by: "expected_output_label",
  };
}

function assertTemplateEvidence({ call, evidenceRequirement, descriptor }) {
  assert.equal(evidenceRequirement.source, RECIPE_TEMPLATE_EVIDENCE_CONTRACT, call.step_id);
  assert.equal(evidenceRequirement.template_id, call.template_id, call.step_id);
  assert.equal(evidenceRequirement.require_ok, true, call.step_id);
  assert.equal(evidenceRequirement.require_request_id, true, call.step_id);
  assert.equal(call.evidence.source, RECIPE_TEMPLATE_EVIDENCE_CONTRACT, call.step_id);
  assert.equal(call.evidence.ok, true, call.step_id);
  assert.equal(typeof call.evidence.request_id, "string", call.step_id);

  assert.equal(call.evidence.counts.refs, call.result.refs.length, call.step_id);
  assert.equal(call.evidence.counts.artifacts, call.result.artifacts.length, call.step_id);
  assert.equal(call.evidence.counts.jobs, call.result.jobs.length, call.step_id);

  assert.equal(call.evidence.counts.refs >= evidenceRequirement.counts.refs_min, true, call.step_id);
  assert.equal(call.evidence.counts.artifacts >= evidenceRequirement.counts.artifacts_min, true, call.step_id);
  assert.equal(call.evidence.counts.jobs >= evidenceRequirement.counts.jobs_min, true, call.step_id);
  assert.equal(
    call.evidence.counts.last_result_refs >= evidenceRequirement.counts.last_result_refs_min,
    true,
    call.step_id,
  );
  assert.deepEqual(call.evidence.declared_outputs, descriptor.refs.output.map(({ name, kind }) => ({ name, kind })));
}

function assertCheckpointReached({ checkpoint, step, run }) {
  for (const evidenceId of checkpoint.required_evidence) {
    assert.equal(
      run.evidence.some((evidence) => evidence.step_id === step.id && step.evidence === evidenceId),
      true,
      `${step.id} checkpoint evidence ${evidenceId}`,
    );
  }
  run.checkpoints.push({
    id: checkpoint.id,
    after_step: checkpoint.after_step,
    required_evidence: checkpoint.required_evidence,
    reached: true,
  });
}

function assertExpectedOutputsSatisfied({ recipe, expected, stores }) {
  for (const assertion of recipe.assertions) {
    for (const evidenceId of assertion.evidence) {
      assert.equal(
        recipe.recovery.evidence_requirements.some((requirement) => requirement.id === evidenceId),
        true,
        `${recipe.id} ${assertion.id} evidence ${evidenceId}`,
      );
    }

    if (assertion.kind !== "expected_output") continue;

    for (const label of expected.refs) {
      assert.equal(
        stores.refs.has(label) || stores.inputRefs.has(label),
        true,
        `${recipe.id} expected ref ${label}`,
      );
    }
    for (const label of expected.artifacts) {
      assert.equal(
        stores.artifacts.has(label) || stores.fixtureArtifacts.has(label),
        true,
        `${recipe.id} expected artifact ${label}`,
      );
    }
    for (const label of expected.jobs) {
      assert.equal(
        stores.jobs.has(label) || stores.inputRefs.has(label),
        true,
        `${recipe.id} expected job ${label}`,
      );
    }
  }
}

function assertRecoveryBranchesTied(recipe) {
  const stepIds = new Set(recipe.steps.map((step) => step.id));
  const branchIds = new Set(recipe.recovery.branches.map((branch) => branch.id));

  for (const step of recipe.steps) {
    assert.equal(branchIds.has(step.on_failure), true, `${recipe.id} ${step.id} branch`);
  }
  for (const branch of recipe.recovery.branches) {
    if (branch.step !== null) assert.equal(stepIds.has(branch.step), true, `${recipe.id} ${branch.id}`);
  }
}

function assertWriteRiskGates(recipe, run) {
  if (!WRITE_ATOMS.has(recipe.id)) return;

  const firstWriteStep = recipe.steps.find((step) => {
    if (step.uses !== "call_template") return false;
    return ACCEPTED_TEMPLATE_CATALOG.require(step.call_template.id).risk !== "read";
  });
  assert.ok(firstWriteStep, recipe.id);
  assert.equal(
    run.risk_pauses.some((pause) => pause.before_step === firstWriteStep.id && pause.acknowledged),
    true,
    `${recipe.id} write gate pause`,
  );
}

function fakeArtifactOutput({ descriptor, declaration, artifactDeclaration, sequence }) {
  const ref = formatArtifactRef({
    owner_pack: artifactDeclaration.owner_pack,
    scope: artifactDeclaration.name,
    id: `art_20260704000000000_${sequence.toString().padStart(3, "0")}_${sequence.toString(16).padStart(6, "0")}`,
  });

  return {
    kind: "artifact",
    name: declaration.name,
    label: artifactDeclaration.name,
    ref,
    identity: {
      scheme: "descriptor_refs_output",
      value: `${descriptor.id}.${declaration.name}`,
    },
    schema: artifactDeclaration.schema,
    summary: {
      schema: artifactDeclaration.schema,
      source: "descriptor.refs.output",
    },
  };
}

function fakeObjectOutput({ declaration, step, kind }) {
  return {
    kind,
    name: declaration.name,
    label: declaration.name,
    ref: `${kind}:fake_smoke:${step.id}:${declaration.name}`,
    identity: {
      scheme: "descriptor_refs_output",
      value: `${step.id}.${declaration.name}`,
    },
  };
}

function collectExpectedLabels(recipe) {
  const labels = {
    refs: new Set(),
    artifacts: new Set(),
    jobs: new Set(),
    state: new Set(),
  };

  for (const assertion of recipe.assertions) {
    if (assertion.kind !== "expected_output") continue;
    for (const ref of assertion.outputs.refs) labels.refs.add(ref);
    for (const artifact of assertion.outputs.artifacts) labels.artifacts.add(artifact);
    for (const job of assertion.outputs.jobs) labels.jobs.add(job);
    for (const state of assertion.outputs.state) labels.state.add(state);
  }

  return labels;
}

function createRunStores() {
  return {
    refs: new Map(),
    artifacts: new Map(),
    jobs: new Map(),
    inputRefs: new Map(),
    fixtureArtifacts: new Map(),
  };
}

function groupBy(values, keyFn) {
  const grouped = new Map();
  for (const value of values) {
    const key = keyFn(value);
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key).push(value);
  }
  return grouped;
}

function flatten(value) {
  return Array.isArray(value) ? value.flatMap((entry) => flatten(entry)) : [value];
}

function assertNoUnsafeRefString(ref, label) {
  assert.equal(typeof ref, "string", label);
  assert.doesNotMatch(ref, /file:\/\//i, label);
  assert.doesNotMatch(ref, /^(?:\/|~\/|[A-Za-z]:[\\/])/, label);
  assert.doesNotMatch(ref, /(?:^|[\\/])\.\.(?:[\\/]|$)/, label);
  if (/^last_result:artifact(?::|$)/.test(ref)) {
    assert.fail(`${label} must not use public last_result:artifact refs`);
  }
}

function assertNoForbiddenRawFields(value, label) {
  const forbidden = new Set(RECIPE_FORBIDDEN_RAW_EXECUTION_FIELDS);
  if (Array.isArray(value)) {
    for (const [index, entry] of value.entries()) assertNoForbiddenRawFields(entry, `${label}[${index}]`);
    return;
  }
  if (!isPlainObject(value)) return;
  for (const [key, nested] of Object.entries(value)) {
    assert.equal(forbidden.has(key), false, `${label}.${key} raw execution field`);
    assertNoForbiddenRawFields(nested, `${label}.${key}`);
  }
}

function cloneRecipe(recipe) {
  return JSON.parse(JSON.stringify(recipe));
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
