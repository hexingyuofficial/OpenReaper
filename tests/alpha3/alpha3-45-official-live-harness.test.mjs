import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
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
    if (args.operation === "get") return { ok: true, source: "official", payload: { draft: { stages: [{ id: "stage" }] } }, ...identities.get(args.recipe_id) };
    if (args.operation === "run" && args.inputs.variation_count === 65) {
      return { ok: false, status: "failed", error: { code: "OFFICIAL_VARIATION_ROW_LIMIT", details: { zero_write: true } }, undo: { claimed: false, status: "not_opened" } };
    }
    const outputs = args.recipe_id === "recipe.items.create_sound_variations"
      ? ["variation_changes", "control_changes", "tone_changes", "automation_changes"]
      : ["changes"];
    return {
      ok: true,
      status: "succeeded",
      verified_outputs: outputs.map((id) => ({ id, verified: true, value: [{ id: `${id}:1` }] })),
      undo: { claimed: true, status: "closed", scope: "whole_recipe", mutation_truth: "applied", evidence_refs: [`bridge:undo:${args.recipe_id}`] },
      evidence_ref: `recipe-evidence:${args.recipe_id}`,
    };
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
  assert.equal(report.recipe04_truth.evidence_refs.includes("recipe-evidence:recipe.items.create_sound_variations"), true);
  assert.equal(calls.filter((call) => call.operation === "run").every((call) => typeof call.validation_result_id === "string"), true);
  assert.deepEqual(calls.filter((call) => call.operation === "run").map((call) => call.recipe_id), [
    ...ALPHA3_45_OFFICIAL_RECIPE_IDS,
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
    "recipe.items.create_sound_variations",
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
      if (args.operation === "get") return { ok: true, source: "official", ...identities.find((row) => row.recipe_id === args.recipe_id) };
      if (args.inputs.variation_count === 65) return { ok: false, error: { code: "BAD_FAILURE", details: { zero_write: false } }, undo: { claimed: false } };
      const outputs = args.recipe_id.endsWith("sound_variations")
        ? ["variation_changes", "control_changes", "tone_changes", "automation_changes"]
        : ["changes"];
      return {
        ok: true,
        status: "succeeded",
        verified_outputs: outputs.map((id) => ({ id, verified: true, value: [] })),
        evidence_ref: `recipe-evidence:${args.recipe_id}`,
        undo: { claimed: true },
      };
    },
  });
  assert.equal(report.ok, false);
  assert.equal(report.error.code, "OFFICIAL_CAPACITY_FAIL_CLOSED_REQUIRED");
  assert.equal(report.recovery.recovery_required, true);
});

function fixture() {
  const item = {
    item_ref: "item:guid:{SEED}", take_ref: "take:guid:{SEED}", track_ref: "track:guid:{SEED}", position_seconds: 1, length_seconds: 2,
  };
  return {
    project_path: "/tmp/alpha345-fixture.RPP",
    recipe04_seed: { ...item, take_fx_ref: "fx:take:guid:{SEED}:0" },
    inputs: {
      "recipe.mix.create_bus_processing": { source_tracks: [item.track_ref], bus_name: "Recipe Bus" },
      "recipe.midi.create_instrument_part": { track_name: "Recipe Instrument", bars: 2, instrument: "ReaSynth" },
      "recipe.media.create_layered_sound_effect_variants": { search_terms: ["alpha345", "impact"], variant_count: 1 },
      "recipe.items.create_sound_variations": { source_items: [item], variation_count: 1, seed: 345 },
    },
  };
}
