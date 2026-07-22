import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALPHA3_45_OFFICIAL_RECIPE_IDS,
  runAlpha345OfficialRecipesHarness,
} from "../../scripts/smoke-alpha3-45-official-recipes.mjs";

const roots = [];

test.after(async () => Promise.all(roots.map((root) => rm(root, { recursive: true, force: true }))));

test("official live harness discovers and one-calls all four Recipes with Recipe 04 Undo and 1/8/64/65 truth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-harness-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const evidenceRoot = path.join(root, "evidence");
  const calls = [];
  const identities = new Map(ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => [recipe_id, {
    recipe_id,
    version: "1.0.0",
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }]));
  const callRecipe = async (args) => {
    calls.push(structuredClone(args));
    if (args.operation === "list") return { ok: true, items: [...identities.values()].map((row) => ({ ...row, source: "official" })) };
    if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
    if (args.operation === "get") return { ok: true, source: "official", payload: { draft: { stages: [{ id: "stage" }] } }, ...identities.get(args.recipe_id) };
    if (args.operation === "run" && args.inputs.variation_count === 65) {
      return { ok: false, status: "failed", error: { code: "OFFICIAL_VARIATION_ROW_LIMIT", details: { zero_write: true } }, undo: { claimed: false, status: "not_opened" } };
    }
    const successful = fakeSuccessfulRun(args);
    if (args.recipe_id === "recipe.mix.create_bus_processing") {
      successful.verified_outputs.find((output) => output.id === "layout_changes").value[0] = {
        operation_id: "bus",
        target_ref: "track:guid:{EXISTING-BUS}",
        status: "matched_existing",
        mutation: { status: "completed", completed_count: 0, total_count: 0 },
        live_readback: { status: "passed" },
        match: { status: "matched_existing", policy: "update_declared_fields" },
      };
    }
    if (args.recipe_id === "recipe.midi.create_instrument_part") {
      successful.verified_outputs.find((output) => output.id === "instrument_changes").value[0] = {
        operation_id: "instrument",
        target_ref: "track:guid:{EXISTING-INSTRUMENT}",
        related_ref: "fx:track:guid:{EXISTING-INSTRUMENT}:0",
        duplicate_policy: "reuse_exact",
        status: "unchanged",
        mutation: { status: "not_run", actions: [] },
        live_readback: { status: "passed", observed_ref: "fx:track:guid:{EXISTING-INSTRUMENT}:0" },
      };
    }
    if (args.recipe_id === "recipe.media.create_layered_sound_effect_variants") {
      successful.verified_outputs = successful.verified_outputs.map((output) => output.id === "placement_changes"
        ? { ...output, value: { omitted: true, reason: "inline_value_exceeds_call_recipe_budget" } }
        : output);
    }
    return successful;
  };
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot,
    fixture: fixture(),
    callRecipe,
  });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.deepEqual(report.discovery.ids, ALPHA3_45_OFFICIAL_RECIPE_IDS);
  assert.equal(report.official_runs.every((row) => row.public_call_count === 1 && row.undo.claimed === true), true);
  assert.deepEqual(report.capacity.map((row) => [row.count, row.ok, row.fail_closed]), [
    [1, true, false], [8, true, false], [64, true, false], [65, false, true],
  ]);
  assert.equal(report.recipe04_truth.position_volume_pan_pitch_playrate, true);
  assert.equal(report.recipe04_truth.take_tone_fx, true);
  assert.equal(report.recipe04_truth.automation_envelope, true);
  assert.deepEqual(report.official_runs.find((row) => row.recipe_id === "recipe.items.create_sound_variations").output_counts, {
    variation_changes: 1,
    control_changes: 1,
    tone_changes: 1,
    automation_changes: 1,
  });
  assert.equal(report.recipe04_truth.evidence_refs.some((ref) => ref.startsWith("recipe-evidence:recipe.items.create_sound_variations:")), true);
  assert.equal(calls.filter((call) => call.operation === "run").every((call) => typeof call.validation_result_id === "string"), true);
  assert.deepEqual(calls.filter((call) => call.operation === "run").map((call) => call.recipe_id), [
    ...ALPHA3_45_OFFICIAL_RECIPE_IDS,
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
  ]);
  const persisted = JSON.parse(await readFile(path.join(evidenceRoot, "alpha3-45-official-recipes.json"), "utf8"));
  assert.equal(persisted.ok, true);
  assert.equal(persisted.report_storage.mode, "bounded_truth_summary");
  assert.equal(Buffer.byteLength(JSON.stringify(persisted), "utf8") <= 64 * 1024, true);
  assert.equal(persisted.official_runs.some((row) => Object.hasOwn(row, "output_values")), false);
  assert.equal(persisted.recipe04_truth.automation_envelope, true);
  assert.deepEqual(persisted.capacity.map((row) => [row.count, row.batch_proven, row.fail_closed]), [
    [1, true, false], [8, true, false], [64, true, false], [65, false, true],
  ]);
});

test("official live harness fails when count 65 is not explicit zero-write", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-fail-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id,
    source: "official",
    version: "1.0.0",
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      if (args.inputs.variation_count === 65) return { ok: false, error: { code: "BAD_FAILURE", details: { zero_write: false } }, undo: { claimed: false } };
      return fakeSuccessfulRun(args);
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_CAPACITY_FAIL_CLOSED_REQUIRED");
  assert.equal(report.recovery.recovery_required, true);
});

test("official live harness rejects omitted Recipe 04 feature output as unverified", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-omitted-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id,
    source: "official",
    version: "1.0.0",
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      if (args.inputs.variation_count === 65) {
        return { ok: false, error: { code: "ROW_LIMIT", details: { zero_write: true } }, undo: { claimed: false } };
      }
      const successful = fakeSuccessfulRun(args);
      successful.verified_outputs = successful.verified_outputs.map((output) => output.id === "tone_changes"
        ? { ...output, value: { omitted: true, reason: "inline_value_exceeds_call_recipe_budget" } }
        : output);
      return successful;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE", JSON.stringify(report));
  assert.equal(report.recipe04_truth, null);
  assert.equal(report.official_runs.find((row) => row.recipe_id.endsWith("sound_variations")).output_omitted.tone_changes, true);
});

test("official live harness rejects missing and mismatched generic Take-FX copy proof", async () => {
  for (const corruption of ["missing", "wrong_target"]) {
    const root = await mkdtemp(path.join(os.tmpdir(), `openreaper-alpha345-official-${corruption}-copy-proof-`));
    roots.push(root);
    const wrapper = path.join(root, "openreaper-mcp.sh");
    await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
    const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
      recipe_id, source: "official", version: "1.0.0", revision: 1,
      content_hash: `sha256:${String(index + 1).repeat(64)}`,
      validation_result_id: `validation:${index + 1}`,
    }));
    const report = await runAlpha345OfficialRecipesHarness({
      installedWrapper: wrapper,
      evidenceRoot: path.join(root, "evidence"),
      fixture: fixture(),
      callRecipe: async (args) => {
        if (args.operation === "list") return { ok: true, items: identities };
        if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
        if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
        const successful = fakeSuccessfulRun(args);
        if (args.recipe_id === "recipe.items.create_sound_variations") {
          const variation = successful.verified_outputs.find((output) => output.id === "variation_changes").value[0];
          if (corruption === "missing") delete variation.take_fx_copy;
          else variation.take_fx_copy.slots[0].target_fx_ref = "fx:take:guid:{OTHER}:0";
        }
        return successful;
      },
    });
    assert.equal(report.ok, false, corruption);
    assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE", JSON.stringify(report));
  }
});

test("official live harness rejects applied rows with failed mutation truth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-failed-mutation-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id, source: "official", version: "1.0.0", revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      const successful = fakeSuccessfulRun(args);
      successful.verified_outputs[0].value[0] = {
        status: "applied", mutation: { status: "failed" }, live_readback: { status: "passed" },
      };
      return successful;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE");
});

test("official live harness rejects applied rows with missing mutation truth", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-missing-mutation-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id, source: "official", version: "1.0.0", revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      const successful = fakeSuccessfulRun(args);
      successful.verified_outputs[0].value[0] = {
        status: "applied", mutation: {}, live_readback: { status: "passed" },
      };
      return successful;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE");
});

test("official live harness rejects a non-canonical automation Envelope ref", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-envelope-ref-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id, source: "official", version: "1.0.0", revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      const successful = fakeSuccessfulRun(args);
      if (args.recipe_id === "recipe.items.create_sound_variations") {
        successful.verified_outputs.find((output) => output.id === "automation_changes").value[0].live_readback.envelope_ref = "envelope:not-canonical";
      }
      return successful;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE");
});

test("official live harness rejects a copied Item whose position did not change from its seed", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-position-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id, source: "official", version: "1.0.0", revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) return fakeEvidencePage(args.evidence_ref);
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      const successful = fakeSuccessfulRun(args);
      if (args.recipe_id === "recipe.items.create_sound_variations") {
        successful.verified_outputs.find((output) => output.id === "variation_changes").value[0].position_seconds = args.inputs.source_items[0].position_seconds;
      }
      return successful;
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_RECIPE_RUN_TRUTH_INCOMPLETE");
});

test("official live harness rejects inflated capacity counters", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-inflated-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id, source: "official", version: "1.0.0", revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) {
        const evidence = fakeEvidencePage(args.evidence_ref);
        if (args.evidence_ref.endsWith(":64")) {
          evidence.items[0].counters.native_mutation_count = 65;
          evidence.items[0].counters.readback_count = 65;
        }
        return evidence;
      }
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      if (args.inputs.variation_count === 64) {
        return {
          ok: false,
          error: {
            code: "STAGE_FAILED",
            message: "copy stage failed",
            details: { stage_id: "copy", nested: { code: "BRIDGE_TIMEOUT" } },
          },
        };
      }
      if (args.inputs.variation_count === 65) return { ok: false, error: { code: "ROW_LIMIT", details: { zero_write: true } }, undo: { claimed: false } };
      return fakeSuccessfulRun(args);
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_CAPACITY_SUCCESS_REQUIRED");
  assert.equal(report.capacity.at(-1).count, 64);
  assert.equal(report.capacity.at(-1).batch_proven, false);
  assert.equal(report.capacity.at(-1).error_message, "copy stage failed");
  assert.match(report.capacity.at(-1).error_details_json, /BRIDGE_TIMEOUT/);
});

test("official live harness rejects count 64 success with underreported batch proof", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha345-official-underproof-"));
  roots.push(root);
  const wrapper = path.join(root, "openreaper-mcp.sh");
  await writeFile(wrapper, "#!/bin/sh\n", { mode: 0o700 });
  const identities = ALPHA3_45_OFFICIAL_RECIPE_IDS.map((recipe_id, index) => ({
    recipe_id,
    source: "official",
    version: "1.0.0",
    revision: 1,
    content_hash: `sha256:${String(index + 1).repeat(64)}`,
    validation_result_id: `validation:${index + 1}`,
  }));
  const report = await runAlpha345OfficialRecipesHarness({
    installedWrapper: wrapper,
    evidenceRoot: path.join(root, "evidence"),
    fixture: fixture(),
    callRecipe: async (args) => {
      if (args.operation === "list") return { ok: true, items: identities };
      if (args.operation === "get" && args.evidence_ref) {
        const evidence = fakeEvidencePage(args.evidence_ref);
        if (args.evidence_ref.endsWith(":64")) {
          evidence.items.find((item) => item.stage_id === "tone").counters.native_mutation_count = 1;
          evidence.items.find((item) => item.stage_id === "tone").counters.readback_count = 1;
        }
        return evidence;
      }
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      if (args.inputs.variation_count === 65) {
        return { ok: false, error: { code: "ROW_LIMIT", details: { zero_write: true } }, undo: { claimed: false } };
      }
      return fakeSuccessfulRun(args);
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_CAPACITY_SUCCESS_REQUIRED");
  assert.equal(report.capacity.at(-1).count, 64);
  assert.equal(report.capacity.at(-1).batch_proven, false);
});

function fakeSuccessfulRun(args) {
  const count = Math.max(1, args.inputs?.variation_count ?? 1);
  return {
    ok: true,
    status: "succeeded",
    verified_outputs: fakeOutputsForRecipe(args.recipe_id, count, args.inputs?.source_items ?? []),
    undo: {
      claimed: true,
      status: "closed",
      proven: true,
      scope: "whole_recipe",
      mutation_truth: "applied",
      evidence_refs: [`bridge:undo:${args.recipe_id}`],
    },
    execution_truth: {
      mutation: "applied",
      native_mutation_count: recipeIsItemVariations(args.recipe_id) ? count * 4 : count,
      readback_count: recipeIsItemVariations(args.recipe_id) ? count * 4 : count,
    },
    evidence_ref: `recipe-evidence:${args.recipe_id}:${count}`,
  };
}

function recipeIsItemVariations(recipeId) {
  return recipeId === "recipe.items.create_sound_variations";
}

function fakeOutputsForRecipe(recipeId, count = 1, sourceItems = []) {
  const ids = {
    "recipe.mix.create_bus_processing": ["layout_changes", "routing_changes", "processing_evidence"],
    "recipe.midi.create_instrument_part": ["layout_changes", "instrument_changes", "midi_evidence"],
    "recipe.media.create_layered_sound_effect_variants": ["placement_changes", "variation_changes", "control_evidence"],
    "recipe.items.create_sound_variations": ["variation_changes", "control_changes", "tone_changes", "automation_changes"],
  }[recipeId];
  return ids.map((id) => ({
    id,
    verified: true,
    value: id.endsWith("_evidence")
      ? `evidence:${recipeId}:${id}`
      : Array.from({ length: recipeId === "recipe.items.create_sound_variations" ? count * Math.max(1, sourceItems.length) : 1 }, (_, index) => fakeVerifiedOutput(id, index, sourceItems[index % Math.max(1, sourceItems.length)])),
  }));
}

function fakeVerifiedOutput(id, index = 0, source = { item_ref: "item:guid:{SEED}", take_ref: "take:guid:{SEED}", track_ref: "track:guid:{SEED}", position_seconds: 1 }) {
  const itemRef = `item:guid:{COPY-${index + 1}}`;
  const takeRef = `take:guid:{COPY-${index + 1}}`;
  if (id === "variation_changes") return {
    id: `variation-${index + 1}`, status: "ok", mutation: "done", readback: "pass",
    new_item_ref: itemRef, new_take_ref: takeRef, position_seconds: source.position_seconds + index + 1,
    take_fx_copy: {
      status: "passed",
      copied_count: 1,
      slots: [{ slot_index: 0, target_fx_ref: `fx:${takeRef}:0` }],
    },
  };
  if (id === "control_changes") return {
    id: `controls-${index + 1}`, item_ref: itemRef, take_ref: takeRef, status: "ok", mutation: "done", readback: "pass",
    item: { volume_db: -1 }, take: { pan: 0.2, pitch_semitones: 2, playrate: 1.05 },
  };
  if (id === "tone_changes") return {
    id: `tone-${index + 1}`, status: "ok", mutation: "done", readback: "pass",
    fx_ref: `fx:${takeRef}:0`, param_index: 0, normalized_value: 0.5,
  };
  if (id === "automation_changes") return {
    operation_id: `automation-${index + 1}`, mode: "insert_fx_parameter_points", target_ref: `fx:${takeRef}:0`,
    requested: { point_count: 2 }, status: "applied", mutation: { status: "completed" },
    live_readback: { status: "passed", envelope_ref: "envelope:guid:{AUTO}" },
  };
  return { id: `${id}:${index + 1}`, status: "ok", mutation: "done", readback: "pass" };
}

function fakeEvidencePage(evidenceRef) {
  const count = Number(evidenceRef.split(":").at(-1)) || 1;
  return {
    ok: true,
    evidence_ref: evidenceRef,
    items: ["copy", "controls", "tone", "automation"].map((stage_id) => ({
      stage_id,
      counters: { native_mutation_count: count, readback_count: count, transport_call_count: 1 },
    })),
  };
}

function fixture() {
  const item = {
    item_ref: "item:guid:{SEED}", take_ref: "take:guid:{SEED}", track_ref: "track:guid:{SEED}", position_seconds: 1, length_seconds: 2,
  };
  return {
    project_path: "/tmp/alpha345-fixture.RPP",
    recipe04_seed: {
      ...item,
      take_fx_ref: "fx:take:guid:{SEED}:0",
      take_fx_identity: {
        fx_ref: "fx:take:guid:{SEED}:0",
        slot_index: 0,
        plugin_name: "VST: ReaEQ (Cockos)",
        enabled: true,
        parameter_count: 8,
      },
    },
    inputs: {
      "recipe.mix.create_bus_processing": { source_tracks: [item.track_ref], bus_name: "Recipe Bus" },
      "recipe.midi.create_instrument_part": { track_name: "Recipe Instrument", bars: 2, instrument: "ReaSynth" },
      "recipe.media.create_layered_sound_effect_variants": { search_terms: ["alpha345", "impact"], variant_count: 1, seed: 345 },
      "recipe.items.create_sound_variations": { source_items: [item], variation_count: 1, seed: 345 },
    },
  };
}
