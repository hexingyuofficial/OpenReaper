import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
  createAlpha345CombinedExecutableRecipeStore,
  createAlpha345OfficialExecutableRecipeCatalog,
  createAlpha345OfficialExecutableRecipeRevisions,
  seedAlpha345OfficialExecutableRecipeRevisions,
} from "../../packages/mcp-server/src/alpha3-45-official-executable-recipes-v1.mjs";
import { validateExecutableRecipeRevision } from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import { createExecutableRecipeRevisionStore } from "../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import { createCallRecipeRuntime } from "../../packages/mcp-server/src/call-recipe-runtime-v1.mjs";
import { createExecutableRecipeProductCatalog } from "../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";

test("Alpha3.45 official Recipe catalog seals four immutable expression-bound revisions", () => {
  const catalog = createExecutableRecipeProductCatalog();
  const source = createAlpha345OfficialExecutableRecipeCatalog({ catalog });
  assert.deepEqual(source.revisions.map((revision) => revision.recipe_id), ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS);
  for (const revision of source.revisions) {
    assert.equal(revision.immutable, true);
    assert.equal(validateExecutableRecipeRevision(revision, { catalog }).ok, true);
    assert.equal(revision.draft.bindings.some((binding) => binding.expression?.op), true);
    assert.equal(revision.draft.bindings.some((binding) => binding.to.scope === "stage_refs"), revision.recipe_id.startsWith("recipe.mix") || revision.recipe_id.startsWith("recipe.midi"));
  }
  assert.deepEqual(source.revisions.map((revision) => revision.draft.inputs.filter((input) => input.required).map((input) => input.id)), [
    ["source_tracks"],
    [],
    ["search_terms", "seed"],
    ["source_items", "seed"],
  ]);
  const sourceText = readFileSync(new URL("../../packages/mcp-server/src/alpha3-45-official-executable-recipes-v1.mjs", import.meta.url), "utf8");
  assert.equal(sourceText.includes("official-recipe-runtime"), false);
});

test("all official Recipes execute once through generic call_recipe expressions", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-expression-run-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const calls = [];
    const runtime = createRuntime(store, catalog, calls);

    for (const saved of store.list().items) {
      const revision = store.get(saved).payload;
      const result = await runtime.call_recipe({
        operation: "run",
        ...saved,
        inputs: recipeInputs(revision.recipe_id),
        budget: { max_response_bytes: 16_384 },
      });
      assert.equal(result.ok, true, `${revision.recipe_id}: ${JSON.stringify(result)}`);
      assert.ok(result.evidence_ref);
      if (revision.recipe_id === "recipe.items.create_sound_variations") {
        assert.deepEqual(result.verified_outputs.map((output) => output.id).sort(), [
          "automation_changes",
          "control_changes",
          "evidence_ref",
          "tone_changes",
          "variation_changes",
        ]);
        assert.equal(result.verified_outputs.every((output) => output.verified === true), true);
      }
    }

    const busCalls = calls.filter((call) => call.recipe_id === "recipe.mix.create_bus_processing");
    assert.deepEqual(busCalls.map((call) => call.stage), ["layout", "routing", "processing"]);
    assert.equal(busCalls[1].inputs.routes[0].destination_track_ref, "track:guid:{BUS}");
    assert.deepEqual(busCalls[2].refs, { track_ref: "track:guid:{BUS}" });

    const mediaCalls = calls.filter((call) => call.recipe_id === "recipe.media.create_layered_sound_effect_variants");
    assert.equal(mediaCalls.find((call) => call.stage === "place").inputs.assets.length, 2);
    assert.equal(mediaCalls.find((call) => call.stage === "copy").inputs.variations.length, 8);

    const itemCalls = calls.filter((call) => call.recipe_id === "recipe.items.create_sound_variations");
    const controls = itemCalls.find((call) => call.stage === "controls").inputs.changes;
    const automation = itemCalls.find((call) => call.stage === "automation").inputs.fx_targets;
    assert.equal(controls.length, 8);
    assert.equal(automation.length, 8);
    assert.deepEqual(automation[0].points.map((point) => point.time_seconds), [2.5, 3]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("official required inputs fail generic preflight before Undo or dispatch", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-required-inputs-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const calls = [];
    let undoBegins = 0;
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      runtimeFactsProvider: ({ revision }) => facts(revision),
      undoController: {
        begin: async () => { undoBegins += 1; return { ok: true, opened: true }; },
        end: async () => ({ ok: true, closed: true, verified: true }),
      },
      dispatchers: { macro: async (request) => { calls.push(request); return macroResult(); } },
    });
    for (const [recipeId, missing] of [
      ["recipe.mix.create_bus_processing", "source_tracks"],
      ["recipe.media.create_layered_sound_effect_variants", "seed"],
      ["recipe.items.create_sound_variations", "source_items"],
    ]) {
      const saved = store.list().items.find((item) => item.recipe_id === recipeId);
      const inputs = recipeInputs(recipeId);
      delete inputs[missing];
      const result = await runtime.call_recipe({ operation: "run", ...saved, inputs });
      assert.equal(result.ok, false, recipeId);
      assert.equal(result.error.code, "PREFLIGHT_FAILED", recipeId);
      assert.equal(result.execution_truth.mutation, "not_run", recipeId);
    }
    assert.equal(calls.length, 0);
    assert.equal(undoBegins, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every official fork keeps generic expression dispatch after reconnect", async () => {
  const userRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-expression-user-"));
  const officialRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-expression-official-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const openStore = () => {
      const userStore = createExecutableRecipeRevisionStore({
        root: userRoot, source: "user", catalog, officialRecipeIds: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
      });
      const officialStore = createExecutableRecipeRevisionStore({ root: officialRoot, source: "official", catalog });
      seedAlpha345OfficialExecutableRecipeRevisions(officialStore, { catalog });
      return createAlpha345CombinedExecutableRecipeStore({ userStore, officialStore, catalog });
    };
    const first = openStore();
    const forks = ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS.map((officialId, index) => {
      const official = first.list().items.find((item) => item.recipe_id === officialId);
      const draft = structuredClone(first.get(official).payload.draft);
      draft.id = `recipe.user.forked_${index + 1}`;
      draft.title = `Forked official Recipe ${index + 1}`;
      return {
        officialId,
        saved: first.save(draft, {
          version: "1.0.0",
          revision: 1,
          saved_at: `2026-07-22T00:00:0${index + 2}.000Z`,
        }),
      };
    });

    const reconnected = openStore();
    const calls = [];
    const runtime = createRuntime(reconnected, catalog, calls);
    for (const { officialId, saved } of forks) {
      assert.equal(reconnected.list().items.some((item) => item.recipe_id === saved.recipe_id && item.source === "user"), true);
      const firstCall = calls.length;
      const result = await runtime.call_recipe({
        ...saved,
        operation: "run",
        inputs: recipeInputs(officialId),
        budget: { max_response_bytes: 16_384 },
      });
      assert.equal(result.ok, true, `${officialId}: ${JSON.stringify(result)}`);
      assert.equal(calls.slice(firstCall).length > 0, true, officialId);
      assert.equal(calls.slice(firstCall).every((call) => call.recipe_id === saved.recipe_id), true, officialId);
    }
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
    rmSync(officialRoot, { recursive: true, force: true });
  }
});

test("official catalog upgrade removes legacy official revisions and preserves user Recipes", () => {
  const userRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-upgrade-user-"));
  const officialRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-upgrade-official-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const userStore = createExecutableRecipeRevisionStore({
      root: userRoot, source: "user", catalog, officialRecipeIds: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
    });
    const officialStore = createExecutableRecipeRevisionStore({ root: officialRoot, source: "official", catalog });
    const baseDraft = structuredClone(createAlpha345OfficialExecutableRecipeRevisions({ catalog })[0].draft);
    baseDraft.id = "recipe.legacy.pre_alpha345";
    baseDraft.title = "Legacy official Recipe";
    const legacyOfficial = officialStore.save(baseDraft, { version: "1.0.0", revision: 1, saved_at: "2026-07-21T00:00:00.000Z" });
    const userDraft = structuredClone(baseDraft);
    userDraft.id = "recipe.user.preserved_across_upgrade";
    userDraft.title = "Preserved user Recipe";
    const userSaved = userStore.save(userDraft, { version: "1.0.0", revision: 1, saved_at: "2026-07-21T00:00:01.000Z" });

    const seeded = seedAlpha345OfficialExecutableRecipeRevisions(officialStore, { catalog });
    assert.equal(seeded.removed_count, 1);
    assert.equal(seeded.removed[0].recipe_id, legacyOfficial.recipe_id);
    assert.deepEqual(
      officialStore.list().items.map((item) => item.recipe_id).sort(),
      [...ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS].sort(),
    );
    assert.equal(userStore.get(userSaved).payload.recipe_id, userSaved.recipe_id);
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
    rmSync(officialRoot, { recursive: true, force: true });
  }
});

function createRuntime(store, catalog, calls, options = {}) {
  return createCallRecipeRuntime({
    store,
    catalog,
    runtimeFactsProvider: ({ revision }) => facts(revision),
    undoController: {
      begin: async ({ project_ref }) => ({ ok: true, opened: true, handle: "undo:expression", project_ref }),
      end: async ({ project_ref }) => ({ ok: true, closed: true, verified: true, handle: "undo:expression", project_ref }),
    },
    dispatchers: {
      macro: async ({ revision, stage, inputs, refs }) => {
        calls.push({ recipe_id: revision.recipe_id, stage: stage.id, inputs: structuredClone(inputs), refs: structuredClone(refs ?? null) });
        if (stage.id === "copy" && inputs.variations?.length > 64) return macroZeroWriteFailure();
        if (stage.id === "layout") return macroResult({ changes: [appliedTrack("BUS")] });
        if (stage.id === "search") return macroResult({ data: { results: [{ path: "/tmp/impact.wav" }, { path: "/tmp/metal.wav" }] } });
        if (stage.id === "place") return macroResult({ changes: [appliedPlacement("A", 0), appliedPlacement("B", 0)] });
        if (stage.id === "copy") return macroResult({ changes: options.copyChanges?.(inputs) ?? inputs.variations.map(appliedVariation) });
        if (["controls", "tone", "automation"].includes(stage.id)
          && [inputs.changes, inputs.assignments, inputs.fx_targets].some((rows) => Array.isArray(rows) && rows.length === 0)) {
          return macroZeroWriteFailure();
        }
        if (stage.id === "controls") return macroResult({ changes: inputs.changes.map((row) => ({
          ...row, status: "applied", mutation: { status: "completed" }, live_readback: { status: "passed" },
        })) });
        if (stage.id === "tone") return macroResult({ changes: inputs.assignments.map((row) => ({
          ...row, status: "applied", mutation: { status: "completed" }, live_readback: { status: "passed" },
        })) });
        if (stage.id === "automation") return macroResult({ changes: inputs.fx_targets.map((row, index) => ({
          operation_id: `automation-${index + 1}`,
          mode: "insert_fx_parameter_points",
          target_ref: row.fx_ref,
          requested: { point_count: row.points.length },
          status: "applied",
          mutation: { status: "completed" },
          live_readback: { status: "passed", envelope_ref: `envelope:guid:{AUTO-${index + 1}}` },
        })) });
        return macroResult({ changes: [{ target_ref: refs?.track_ref ?? "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
      },
    },
  });
}

function recipeInputs(recipeId) {
  if (recipeId === "recipe.mix.create_bus_processing") return { source_tracks: ["track:guid:{SOURCE}"], bus_name: "SFX BUS", seed: 345 };
  if (recipeId === "recipe.midi.create_instrument_part") return { track_name: "Instrument", bars: 2, meter: { numerator: 4, denominator: 4 } };
  if (recipeId === "recipe.media.create_layered_sound_effect_variants") return { search_terms: ["impact", "metal"], variant_count: 4, seed: 345 };
  return {
    source_items: sourceItems(2), variation_count: 4, seed: 345,
    automation_points: [{ time_seconds: 0, value: 0.25 }, { time_seconds: 0.5, value: 0.75 }],
  };
}

test("generic official expressions produce the full 64-row Recipe 03 and 04 batches", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-expression-64-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const calls = [];
    const runtime = createRuntime(store, catalog, calls);

    for (const [recipe_id, inputs] of [
      ["recipe.media.create_layered_sound_effect_variants", { search_terms: ["impact", "metal"], variant_count: 32, seed: 345 }],
      ["recipe.items.create_sound_variations", { source_items: sourceItems(64), variation_count: 1, seed: 345 }],
    ]) {
      const saved = store.list().items.find((item) => item.recipe_id === recipe_id);
      const result = await runtime.call_recipe({ operation: "run", ...saved, inputs, budget: { max_response_bytes: 16_384 } });
      assert.equal(result.ok, true, `${recipe_id}: ${JSON.stringify(result)}`);
      if (recipe_id === "recipe.items.create_sound_variations") {
        assert.equal(result.execution_truth.native_mutation_count >= 256, true, JSON.stringify(result.execution_truth));
        assert.equal(result.execution_truth.readback_count >= 256, true, JSON.stringify(result.execution_truth));
        const evidence = await runtime.call_recipe({ operation: "get", evidence_ref: result.evidence_ref, limit: 8 });
        const stageCounters = new Map(evidence.items.map((item) => [item.stage_id, item.counters]));
        for (const stageId of ["copy", "controls", "tone", "automation"]) {
          assert.equal(stageCounters.get(stageId).native_mutation_count, 64, stageId);
          assert.equal(stageCounters.get(stageId).readback_count, 64, stageId);
        }
      }
    }

    for (const recipe_id of [
      "recipe.media.create_layered_sound_effect_variants",
      "recipe.items.create_sound_variations",
    ]) {
      const copy = calls.find((call) => call.recipe_id === recipe_id && call.stage === "copy");
      assert.equal(copy.inputs.variations.length, 64, recipe_id);
    }

    const recipe04 = store.list().items.find((item) => item.recipe_id === "recipe.items.create_sound_variations");
    const overLimit = await runtime.call_recipe({
      operation: "run",
      ...recipe04,
      inputs: { source_items: sourceItems(1), variation_count: 65, seed: 345 },
      budget: { max_response_bytes: 16_384 },
    });
    assert.equal(overLimit.ok, false);
    assert.equal(overLimit.error.details.zero_write, true, JSON.stringify(overLimit));
    assert.equal(overLimit.execution_truth.mutation, "not_run");
    assert.equal(overLimit.undo.claimed, true);
    assert.equal(overLimit.undo.status, "closed");
    assert.equal(overLimit.undo.proven, true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Recipe 04 filters compact skip rows and fails closed before later write stages", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-expression-skip-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const calls = [];
    const runtime = createRuntime(store, catalog, calls, {
      copyChanges: (inputs) => inputs.variations.map((row) => ({ ...appliedVariation(row), mutation: "skip" })),
    });
    const saved = store.list().items.find((item) => item.recipe_id === "recipe.items.create_sound_variations");
    const result = await runtime.call_recipe({
      operation: "run",
      ...saved,
      inputs: { source_items: sourceItems(1), variation_count: 1, seed: 345 },
    });
    assert.equal(result.ok, false);
    assert.equal(result.execution_truth.mutation, "not_run");
    assert.deepEqual(calls.find((call) => call.stage === "controls").inputs.changes, []);
    assert.equal(calls.some((call) => call.stage === "tone" || call.stage === "automation"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function sourceItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    item_ref: `item:guid:{ITEM-${index}}`, take_ref: `take:guid:{TAKE-${index}}`, track_ref: `track:guid:{TRACK-${index}}`,
    position_seconds: index * 0.1, length_seconds: 1,
  }));
}

function appliedTrack(id) { return { target_ref: `track:guid:{${id}}`, status: "applied", live_readback: { status: "passed" } }; }
function appliedPlacement(id, position_seconds) {
  return { mode: "place_assets", status: "applied", live_readback: { status: "passed", item_ref: `item:guid:{PLACED-${id}}`, take_ref: `take:guid:{PLACED-${id}}`, track_ref: `track:guid:{LAYER-${id}}`, position_seconds } };
}
function appliedVariation(row) {
  return { id: row.id, status: "ok", mutation: "done", readback: "pass", index: "done", position_seconds: row.position_seconds, new_item_ref: `item:guid:{COPY-ITEM-${row.id}}`, new_take_ref: `take:guid:{COPY-TAKE-${row.id}}` };
}

function facts(revision) {
  return {
    content_hash: revision.content_hash, risk_grants: revision.draft.risk_grants,
    project_identity: "project:tab:real-fixture", bridge_owner: "owner:real", bridge_generation: "7",
    available_capabilities: revision.draft.required_capabilities,
    checkpoint_evidence: revision.draft.checkpoints.map((item) => ({ checkpoint_id: item.id, evidence_id: item.evidence_id, resume_identity: item.resume_identity, recipe_id: revision.recipe_id, version: revision.version, revision: revision.revision, content_hash: revision.content_hash })),
    dependency_versions: revision.dependency_lock.entries.map((entry) => ({ kind: entry.kind, id: entry.id, version: entry.version })),
    dependency_descriptors: revision.dependency_lock.entries.map((entry) => ({ kind: entry.kind, id: entry.id, descriptor_hash: entry.descriptor_hash })),
  };
}

function macroResult({ changes = [], data = {} } = {}) {
  const envelope = {
    contract: "macro.execution.v1",
    ok: true,
    macro: { id: "macro.fixture", program_id: "openreaper.macro.fixture", program_version: "1.0.0", risk: "write" },
    request: { request_id: "expression-stage", dry_run: false },
    execution: { status: "completed", started_at: "2026-07-22T00:00:00.000Z", completed_at: "2026-07-22T00:00:01.000Z", stage_count: 1, stages: [{ id: "fixture", kind: "verify", status: "completed", evidence_refs: ["evidence:fixture"] }] },
    sqlite: { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: { summary: "Expression-bound Macro stage completed.", canonical_refs: [], changes, verification: { status: "passed", evidence_refs: ["evidence:fixture"] }, artifact_refs: [], data },
    blockers: [], error: null, recovery: null,
    budget: { max_bytes: 65_536, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let index = 0; index < 4; index += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  return envelope;
}

function macroZeroWriteFailure() {
  const envelope = macroResult({ data: { zero_write: true } });
  envelope.ok = false;
  envelope.execution.status = "blocked";
  envelope.result.summary = "Variation rows exceed 64.";
  envelope.result.verification = { status: "not_required", evidence_refs: [] };
  envelope.blockers = [{ code: "ITEM_APPLY_VARIATION_LIMIT_EXCEEDED", message: "Variation rows exceed 64.", recoverable: true, details: { zero_write: true } }];
  envelope.error = { code: "ITEM_APPLY_VARIATION_LIMIT_EXCEEDED", message: "Variation rows exceed 64.", recoverable: true, details: { zero_write: true } };
  envelope.recovery = { partial_changes_possible: false, undo_policy: "none", action: "Use at most 64 rows." };
  for (let index = 0; index < 4; index += 1) envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  return envelope;
}
