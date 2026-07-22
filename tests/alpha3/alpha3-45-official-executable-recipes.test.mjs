import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createAlpha345OfficialExecutableRecipeCatalog,
  createAlpha345OfficialExecutableRecipeRevisions,
  createAlpha345CombinedExecutableRecipeStore,
  seedAlpha345OfficialExecutableRecipeRevisions,
  ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
} from "../../packages/mcp-server/src/alpha3-45-official-executable-recipes-v1.mjs";
import {
  createExecutableRecipeProductCatalog,
} from "../../packages/mcp-server/src/executable-recipe-product-catalog-v1.mjs";
import {
  validateExecutableRecipeRevision,
} from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  createExecutableRecipeRevisionStore,
} from "../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import {
  createCallRecipeRuntime,
} from "../../packages/mcp-server/src/call-recipe-runtime-v1.mjs";
import {
  hydrateAlpha345OfficialRecipeStageInputs,
  prepareAlpha345OfficialRecipeRun,
} from "../../packages/mcp-server/src/alpha3-45-official-recipe-runtime-v1.mjs";

test("Alpha3.45 official Recipe catalog seals four immutable source=official revisions", () => {
  const catalog = createExecutableRecipeProductCatalog();
  const source = createAlpha345OfficialExecutableRecipeCatalog({ catalog });
  assert.equal(source.source, "official");
  assert.deepEqual(source.revisions.map((revision) => revision.recipe_id), ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS);
  assert.deepEqual(createAlpha345OfficialExecutableRecipeRevisions({ catalog }), source.revisions);
  for (const revision of source.revisions) {
    assert.equal(revision.contract, "recipe.executable.revision.v1");
    assert.equal(revision.immutable, true);
    assert.equal(validateExecutableRecipeRevision(revision, { catalog }).ok, true);
    assert.equal(revision.version, "1.0.0");
    assert.equal(revision.revision, 1);
    assert.equal(revision.draft.preflight.complete_graph, true);
    assert.equal(revision.draft.checkpoints.length, revision.draft.stages.length);
  }
});

test("Recipe 04 composes seeded Item, tone, and automation mutation dependencies", () => {
  const recipe = createAlpha345OfficialExecutableRecipeRevisions().find((entry) => (
    entry.recipe_id === "recipe.items.create_sound_variations"
  ));
  assert.ok(recipe);
  assert.deepEqual(recipe.draft.dependencies.map((entry) => entry.id), [
    "macro.items.apply",
    "macro.fx.set_controls",
    "macro.automation.apply",
  ]);
  assert.equal(recipe.draft.inputs.some((entry) => entry.id === "seed"), true);
  assert.equal(recipe.draft.inputs.some((entry) => entry.id === "automation"), true);
  assert.equal(recipe.draft.inputs.some((entry) => entry.id === "tone"), true);
});

test("official seeding is idempotent and refuses changed immutable revisions", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-official-recipes-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    const first = seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const second = seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    assert.equal(first.count, 4);
    assert.equal(second.seeded.every((entry) => entry.idempotent === true), true);
    assert.deepEqual(
      store.list().items.map((entry) => entry.recipe_id),
      [...ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS].sort(),
    );
    const altered = structuredClone(first.seeded[0].payload);
    altered.draft.title = "changed immutable source";
    assert.throws(() => store.save(altered), /canonical draft content hash|immutable/i);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("combined store keeps official and user Recipes discoverable across reconnect", () => {
  const userRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-user-recipes-"));
  const officialRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-official-recipes-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const openCombined = () => {
      const userStore = createExecutableRecipeRevisionStore({
        root: userRoot,
        source: "user",
        catalog,
        officialRecipeIds: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
      });
      const officialStore = createExecutableRecipeRevisionStore({ root: officialRoot, source: "official", catalog });
      seedAlpha345OfficialExecutableRecipeRevisions(officialStore, { catalog });
      return createAlpha345CombinedExecutableRecipeStore({ userStore, officialStore, catalog });
    };
    const first = openCombined();
    assert.equal(first.list().count, 4);
    assert.equal(first.list().items.every((item) => item.source === "official"), true);

    const official = first.list().items[0];
    const loadedOfficial = first.get(official);
    assert.equal(loadedOfficial.source, "official");
    const forkDraft = structuredClone(loadedOfficial.payload.draft);
    forkDraft.id = "recipe.user.forked_official";
    forkDraft.title = "Forked official Recipe";
    const savedFork = first.save(forkDraft, {
      version: "1.0.0",
      revision: 1,
      saved_at: "2026-07-22T00:00:01.000Z",
    });
    assert.equal(savedFork.source, "user");
    assert.throws(
      () => first.delete(official, { confirm: true }),
      (error) => error.code === "REVISION_OWNERSHIP_CONFLICT",
    );

    const reconnected = openCombined();
    const listed = reconnected.list();
    assert.equal(listed.count, 5);
    assert.equal(listed.items.filter((item) => item.source === "official").length, 4);
    assert.equal(listed.items.filter((item) => item.source === "user").length, 1);
    assert.equal(reconnected.get(savedFork).source, "user");
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
    rmSync(officialRoot, { recursive: true, force: true });
  }
});

test("official run hydration binds portable trust but preserves the observed project for Undo", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-official-run-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const saved = store.list().items.find((item) => item.recipe_id === "recipe.mix.create_bus_processing");
    const revision = store.get(saved).payload;
    const calls = [];
    const undoProjects = [];
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      runHydrator: prepareAlpha345OfficialRecipeRun,
      stageInputHydrator: hydrateAlpha345OfficialRecipeStageInputs,
      runtimeFactsProvider: () => officialFacts(revision),
      undoController: {
        begin: async ({ project_ref }) => { undoProjects.push(project_ref); return { ok: true, opened: true, handle: "undo:official", project_ref }; },
        end: async ({ project_ref }) => ({ ok: true, closed: true, verified: true, handle: "undo:official", project_ref }),
      },
      dispatchers: {
        macro: async ({ stage, inputs, refs }) => {
          calls.push({ stage: stage.id, inputs, refs });
          if (stage.id === "layout") return macroResult({ changes: [{ target_ref: "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
          if (stage.id === "routing") return macroResult({ changes: [{ target_ref: "send:track:guid:{SOURCE}:0", status: "applied", live_readback: { status: "passed" } }] });
          return macroResult();
        },
      },
    });
    const result = await runtime.call_recipe({
      operation: "run",
      ...saved,
      inputs: { source_tracks: ["track:guid:{SOURCE}"], bus_name: "SFX BUS" },
      budget: { max_response_bytes: 16_384 },
    });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(calls.map((call) => call.stage), ["layout", "routing", "processing"]);
    assert.equal(calls[0].inputs.layout[0].name, "SFX BUS");
    assert.equal(calls[1].inputs.routes[0].destination_track_ref, "track:guid:{BUS}");
    assert.deepEqual(calls[2].refs, { track_ref: "track:guid:{BUS}" });
    assert.deepEqual(undoProjects, ["project:tab:real-fixture"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("all four official Recipe stage hydrators produce bounded Macro inputs", () => {
  const revisions = new Map(createAlpha345OfficialExecutableRecipeRevisions().map((revision) => [revision.recipe_id, revision]));
  const bus = prepare(revisions.get("recipe.mix.create_bus_processing"), { source_tracks: ["track:guid:{A}"] });
  assert.equal(bus.ok, true);
  // Execution hydration matches declarative stage/dependency/input profile only;
  // source=user and a non-catalog recipe_id must not block the same recipe shape.
  const userFork = structuredClone(revisions.get("recipe.mix.create_bus_processing"));
  userFork.recipe_id = "recipe.user.forked_bus_processing";
  userFork.draft.id = "recipe.user.forked_bus_processing";
  const userHydrated = prepareAlpha345OfficialRecipeRun({
    revision: userFork,
    source: "user",
    inputs: { source_tracks: ["track:guid:{A}"] },
    runtime_facts: officialFacts(userFork),
  });
  assert.equal(userHydrated.ok, true, JSON.stringify(userHydrated));
  assert.equal(userHydrated.context.profile_id, "profile.mix.create_bus_processing");
  assert.equal(userHydrated.context.recipe_id, "recipe.user.forked_bus_processing");
  assert.equal(stage(revisions, bus, "recipe.mix.create_bus_processing", "layout").inputs.dry_run, false);

  const midiRevision = revisions.get("recipe.midi.create_instrument_part");
  const midi = prepare(midiRevision, { bars: 2, density: 0.5 });
  const midiStage = hydrateAlpha345OfficialRecipeStageInputs({
    revision: midiRevision,
    stage: midiRevision.draft.stages.find((item) => item.id === "midi"),
    recipe_inputs: midi.inputs,
    inputs: { layout_changes: [{ target_ref: "track:guid:{INSTRUMENT}" }] },
  });
  assert.equal(midiStage.ok, true);
  assert.equal(midiStage.inputs.mode, "create_clips");
  assert.equal(midiStage.inputs.duration_quarter_notes, 8);
  assert.equal(midiStage.inputs.notes.length, 4);
  assert.equal(midiStage.inputs.selector, undefined);
  assert.deepEqual(midiStage.refs, { track_ref: "track:guid:{INSTRUMENT}" });

  const mediaRevision = revisions.get("recipe.media.create_layered_sound_effect_variants");
  const media = prepare(mediaRevision, { search_terms: ["metal", "impact"], variant_count: 3 });
  const place = hydrateAlpha345OfficialRecipeStageInputs({
    revision: mediaRevision,
    stage: mediaRevision.draft.stages.find((item) => item.id === "place"),
    recipe_inputs: media.inputs,
    inputs: { candidates: [{ path: "/tmp/a.wav", available: true }, { path: "/tmp/b.wav", available: true }] },
  });
  assert.equal(place.ok, true);
  assert.equal(place.inputs.assets.length, 2);
  assert.equal(place.inputs.track_policy, "one_new_track_per_asset");

  const itemRevision = revisions.get("recipe.items.create_sound_variations");
  const itemSources = sourceItems(8);
  const items64 = prepare(itemRevision, { source_items: itemSources, variation_count: 8 });
  const copy64 = hydrateAlpha345OfficialRecipeStageInputs({
    revision: itemRevision,
    stage: itemRevision.draft.stages.find((item) => item.id === "copy"),
    recipe_inputs: items64.inputs,
    inputs: {},
  });
  assert.equal(copy64.ok, true);
  assert.equal(copy64.inputs.variations.length, 64);
  assert.equal(prepare(itemRevision, { source_items: sourceItems(5), variation_count: 13 }).ok, false);
  assert.equal(prepare(itemRevision, { source_items: sourceItems(1), crossfade: true }).details.code, "OFFICIAL_CROSSFADE_PATH_UNAVAILABLE");
});

test("layered media Recipe binds the real search results field into placement candidates", async () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-media-results-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const store = createExecutableRecipeRevisionStore({ root, source: "official", catalog });
    seedAlpha345OfficialExecutableRecipeRevisions(store, { catalog });
    const saved = store.list().items.find((item) => item.recipe_id === "recipe.media.create_layered_sound_effect_variants");
    const revision = store.get(saved).payload;
    const observed = [];
    const runtime = createCallRecipeRuntime({
      store,
      catalog,
      runHydrator: prepareAlpha345OfficialRecipeRun,
      stageInputHydrator: hydrateAlpha345OfficialRecipeStageInputs,
      runtimeFactsProvider: () => officialFacts(revision),
      undoController: {
        begin: async ({ project_ref }) => ({ ok: true, opened: true, handle: "undo:media-results", project_ref }),
        end: async ({ project_ref }) => ({ ok: true, closed: true, verified: true, handle: "undo:media-results", project_ref }),
      },
      dispatchers: {
        macro: async ({ stage, inputs }) => {
          observed.push({ stage_id: stage.id, inputs: structuredClone(inputs) });
          if (stage.id === "search") {
            return macroResult({
              data: {
                results: [
                  { path: "/tmp/alpha345-impact.wav", available: true },
                  { path: "/tmp/alpha345-metal.wav", available: true },
                ],
              },
              changes: [],
            });
          }
          if (stage.id === "place") {
            return macroResult({ changes: [
              appliedPlacement("A", 0),
              appliedPlacement("B", 0),
            ] });
          }
          if (stage.id === "copy") {
            return macroResult({ changes: [appliedVariation("COPY", 2, 1)] });
          }
          return macroResult({ changes: [{ target_ref: "take:guid:{NEW-COPY}", status: "applied", mutation: { status: "completed" }, live_readback: { status: "passed" } }] });
        },
      },
    });

    const result = await runtime.call_recipe({
      operation: "run",
      ...saved,
      inputs: { search_terms: ["impact", "metal"], variant_count: 1, seed: 345 },
      budget: { max_response_bytes: 16_384 },
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    const place = observed.find((entry) => entry.stage_id === "place");
    assert.deepEqual(place.inputs.assets.map((asset) => asset.path), [
      "/tmp/alpha345-impact.wav",
      "/tmp/alpha345-metal.wav",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Recipe 03 copies only applied placement rows with exact live readback", () => {
  const revisions = new Map(createAlpha345OfficialExecutableRecipeRevisions().map((revision) => [revision.recipe_id, revision]));
  const recipeId = "recipe.media.create_layered_sound_effect_variants";
  const prepared = prepare(revisions.get(recipeId), { search_terms: ["metal", "impact"], variant_count: 2 });
  const placementChanges = [
    {
      mode: "setup",
      status: "applied",
      target_ref: "track:guid:{SETUP}",
      requested: { nested_item_ref: "item:guid:{MUST-NOT-COPY}" },
      live_readback: { status: "passed", track_ref: "track:guid:{SETUP}" },
    },
    {
      mode: "place_assets",
      status: "applied",
      live_readback: {
        status: "passed",
        item_ref: "item:guid:{PLACED}",
        take_ref: "take:guid:{PLACED}",
        track_ref: "track:guid:{LAYER}",
        position_seconds: 1.25,
      },
    },
  ];
  const copy = stage(revisions, prepared, recipeId, "copy", { placement_changes: placementChanges });
  assert.equal(copy.ok, true);
  assert.equal(copy.inputs.variations.length, 2);
  assert.deepEqual(copy.inputs.variations.map((row) => row.source_item_ref), [
    "item:guid:{PLACED}",
    "item:guid:{PLACED}",
  ]);
  assert.deepEqual(copy.inputs.variations.map((row) => row.target_track_ref), [
    "track:guid:{LAYER}",
    "track:guid:{LAYER}",
  ]);

  const setupOnly = stage(revisions, prepared, recipeId, "copy", { placement_changes: placementChanges.slice(0, 1) });
  assert.equal(setupOnly.ok, false);
  assert.equal(setupOnly.details.code, "OFFICIAL_PLACEMENT_OUTPUT_INVALID");
});

test("forked official revision validates/saves/lists/gets/runs through createCallRecipeRuntime with same trust dispatch evidence Undo after reconnect", async () => {
  const userRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-fork-user-"));
  const officialRoot = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha345-fork-official-"));
  try {
    const catalog = createExecutableRecipeProductCatalog();
    const openCombined = () => {
      const userStore = createExecutableRecipeRevisionStore({
        root: userRoot,
        source: "user",
        catalog,
        officialRecipeIds: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS,
      });
      const officialStore = createExecutableRecipeRevisionStore({ root: officialRoot, source: "official", catalog });
      seedAlpha345OfficialExecutableRecipeRevisions(officialStore, { catalog });
      return createAlpha345CombinedExecutableRecipeStore({ userStore, officialStore, catalog });
    };

    const firstStore = openCombined();
    const officialListed = firstStore.list().items.find((item) => item.recipe_id === "recipe.mix.create_bus_processing");
    assert.ok(officialListed);
    const officialLoaded = firstStore.get(officialListed);
    assert.equal(officialLoaded.source, "official");

    const forkDraft = structuredClone(officialLoaded.payload.draft);
    forkDraft.id = "recipe.user.forked_bus_pressure_test";
    forkDraft.title = "Forked bus pressure test";
    assert.notEqual(forkDraft.id, officialListed.recipe_id);

    const firstRuntime = createCallRecipeRuntime({
      store: firstStore,
      catalog,
      runHydrator: prepareAlpha345OfficialRecipeRun,
      stageInputHydrator: hydrateAlpha345OfficialRecipeStageInputs,
      runtimeFactsProvider: ({ revision }) => officialFacts(revision),
      undoController: {
        begin: async ({ project_ref }) => ({ ok: true, opened: true, handle: "undo:fork", project_ref }),
        end: async ({ project_ref }) => ({ ok: true, closed: true, verified: true, handle: "undo:fork", project_ref }),
      },
      dispatchers: {
        macro: async ({ stage, inputs, refs }) => {
          if (stage.id === "layout") return macroResult({ changes: [{ target_ref: "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
          if (stage.id === "routing") return macroResult({ changes: [{ target_ref: "send:track:guid:{SOURCE}:0", status: "applied", live_readback: { status: "passed" } }] });
          return macroResult({ changes: [{ target_ref: refs?.track_ref ?? "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
        },
      },
    });

    const validated = await firstRuntime.call_recipe({ operation: "validate", draft: forkDraft });
    assert.equal(validated.ok, true, JSON.stringify(validated));

    const saved = await firstRuntime.call_recipe({
      operation: "save",
      draft: forkDraft,
      version: "1.0.0",
      revision: 1,
      saved_at: "2026-07-22T00:00:02.000Z",
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.recipe_id, "recipe.user.forked_bus_pressure_test");
    assert.notEqual(saved.recipe_id, officialListed.recipe_id);

    const listed = await firstRuntime.call_recipe({ operation: "list", budget: { max_response_bytes: 65_536 } });
    assert.equal(listed.ok, true, JSON.stringify(listed));
    const listedFork = listed.items.find((item) => item.recipe_id === saved.recipe_id);
    assert.ok(listedFork);
    assert.equal(listedFork.source, "user");

    const got = await firstRuntime.call_recipe({
      operation: "get",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      budget: { max_response_bytes: 65_536 },
    });
    assert.equal(got.ok, true, JSON.stringify(got));
    assert.equal(got.source, "user");
    assert.equal(got.recipe_id, saved.recipe_id);

    // Reconnect: new store + runtime, no retained official recipe_id for the fork identity.
    const reconnectedStore = openCombined();
    const undoProjects = [];
    const calls = [];
    let omitCapabilities = true;
    const reconnectedRuntime = createCallRecipeRuntime({
      store: reconnectedStore,
      catalog,
      runHydrator: prepareAlpha345OfficialRecipeRun,
      stageInputHydrator: hydrateAlpha345OfficialRecipeStageInputs,
      runtimeFactsProvider: ({ revision }) => {
        const facts = officialFacts(revision);
        return omitCapabilities ? { ...facts, available_capabilities: [] } : facts;
      },
      undoController: {
        begin: async ({ project_ref }) => {
          undoProjects.push(project_ref);
          return { ok: true, opened: true, handle: "undo:fork-reconnect", project_ref };
        },
        end: async ({ project_ref }) => ({ ok: true, closed: true, verified: true, handle: "undo:fork-reconnect", project_ref }),
      },
      dispatchers: {
        macro: async ({ stage, inputs, refs }) => {
          calls.push({ stage: stage.id, inputs: structuredClone(inputs), refs: structuredClone(refs ?? null) });
          if (stage.id === "layout") return macroResult({ changes: [{ target_ref: "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
          if (stage.id === "routing") return macroResult({ changes: [{ target_ref: "send:track:guid:{SOURCE}:0", status: "applied", live_readback: { status: "passed" } }] });
          return macroResult({ changes: [{ target_ref: refs?.track_ref ?? "track:guid:{BUS}", status: "applied", live_readback: { status: "passed" } }] });
        },
      },
    });

    const reListed = await reconnectedRuntime.call_recipe({ operation: "list", budget: { max_response_bytes: 65_536 } });
    assert.equal(reListed.items.some((item) => item.recipe_id === saved.recipe_id && item.source === "user"), true);
    assert.equal(reListed.items.some((item) => item.recipe_id === officialListed.recipe_id && item.source === "official"), true);

    const reGot = await reconnectedRuntime.call_recipe({
      operation: "get",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      budget: { max_response_bytes: 65_536 },
    });
    assert.equal(reGot.ok, true, JSON.stringify(reGot));
    assert.equal(reGot.source, "user");
    assert.notEqual(reGot.recipe_id, officialListed.recipe_id);

    // Profile match must succeed without original official recipe_id or source=official.
    const forkRevision = reconnectedStore.get({
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
    }).payload;
    assert.equal(forkRevision.recipe_id, saved.recipe_id);
    assert.notEqual(forkRevision.recipe_id, officialListed.recipe_id);
    const profilePrepare = prepareAlpha345OfficialRecipeRun({
      revision: forkRevision,
      source: "user",
      inputs: { source_tracks: ["track:guid:{SOURCE}"], bus_name: "Forked Bus" },
      runtime_facts: officialFacts(forkRevision),
    });
    assert.equal(profilePrepare.ok, true, JSON.stringify(profilePrepare));
    assert.equal(profilePrepare.context.profile_id, "profile.mix.create_bus_processing");
    assert.equal(profilePrepare.context.recipe_id, saved.recipe_id);
    assert.equal(profilePrepare.trust_runtime_facts.project_identity, "project:runtime_bound");
    // Draft from get alone is also enough for profile match (no official id/source).
    assert.equal(prepareAlpha345OfficialRecipeRun({
      revision: { recipe_id: reGot.recipe_id, draft: reGot.draft },
      source: "user",
      inputs: { source_tracks: ["track:guid:{SOURCE}"] },
      runtime_facts: officialFacts(forkRevision),
    }).context.profile_id, "profile.mix.create_bus_processing");

    const runRequest = {
      operation: "run",
      recipe_id: saved.recipe_id,
      version: saved.version,
      revision: saved.revision,
      content_hash: saved.content_hash,
      validation_result_id: saved.validation_result_id,
      inputs: { source_tracks: ["track:guid:{SOURCE}"], bus_name: "Forked Bus" },
      budget: { max_response_bytes: 16_384 },
    };
    const trustFailed = await reconnectedRuntime.call_recipe(runRequest);
    assert.equal(trustFailed.ok, false, JSON.stringify(trustFailed));
    assert.equal(trustFailed.error.code, "TRUST_INVALID");
    assert.equal(trustFailed.execution_truth.mutation, "not_run");
    assert.deepEqual(calls, []);
    assert.deepEqual(undoProjects, []);

    omitCapabilities = false;
    const ran = await reconnectedRuntime.call_recipe(runRequest);
    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.deepEqual(calls.map((call) => call.stage), ["layout", "routing", "processing"]);
    assert.equal(calls[0].inputs.layout[0].name, "Forked Bus");
    assert.equal(calls[1].inputs.routes[0].destination_track_ref, "track:guid:{BUS}");
    assert.deepEqual(calls[2].refs, { track_ref: "track:guid:{BUS}" });
    assert.deepEqual(undoProjects, ["project:tab:real-fixture"]);
    assert.ok(ran.evidence_ref || ran.run_id);
  } finally {
    rmSync(userRoot, { recursive: true, force: true });
    rmSync(officialRoot, { recursive: true, force: true });
  }
});

test("Recipe 04 emits seeded per-copy Automation points at copied Item project positions", () => {
  const revisions = new Map(createAlpha345OfficialExecutableRecipeRevisions().map((revision) => [revision.recipe_id, revision]));
  const recipeId = "recipe.items.create_sound_variations";
  const prepared = prepare(revisions.get(recipeId), { source_items: sourceItems(2), variation_count: 1, seed: 1234 });
  const variationChanges = [
    appliedVariation("A", 4, 0),
    appliedVariation("B", 9, 1),
  ];
  const automation = stage(revisions, prepared, recipeId, "automation", { variation_changes: variationChanges, tone_changes: [] });
  assert.equal(automation.ok, true, JSON.stringify(automation));
  assert.equal(automation.inputs.fx_targets.length, 2);
  assert.deepEqual(automation.inputs.fx_targets.map((target) => target.fx_ref), [
    "fx:take:guid:{COPY-TAKE-A}:0",
    "fx:take:guid:{COPY-TAKE-B}:0",
  ]);
  assert.deepEqual(automation.inputs.fx_targets[0].points.map((point) => point.time_seconds), [4, 4.5]);
  assert.deepEqual(automation.inputs.fx_targets[1].points.map((point) => point.time_seconds), [9, 9.5]);
  assert.notDeepEqual(automation.inputs.fx_targets[0].points.map((point) => point.value), automation.inputs.fx_targets[1].points.map((point) => point.value));
});

function prepare(revision, inputs) {
  return prepareAlpha345OfficialRecipeRun({ revision, source: "official", inputs, runtime_facts: officialFacts(revision) });
}

function stage(revisions, prepared, recipeId, stageId, inputs = {}) {
  const revision = revisions.get(recipeId);
  return hydrateAlpha345OfficialRecipeStageInputs({
    revision,
    stage: revision.draft.stages.find((item) => item.id === stageId),
    recipe_inputs: prepared.inputs,
    inputs,
  });
}

function sourceItems(count) {
  return Array.from({ length: count }, (_, index) => ({
    item_ref: `item:guid:{ITEM-${index}}`,
    take_ref: `take:guid:{TAKE-${index}}`,
    track_ref: `track:guid:{TRACK-${index}}`,
    position_seconds: index * 0.1,
    length_seconds: 1,
  }));
}

function appliedVariation(suffix, positionSeconds, sourceIndex) {
  return {
    id: `variation-${suffix}`,
    status: "applied",
    source_item_ref: `item:guid:{ITEM-${sourceIndex}}`,
    target_track_ref: `track:guid:{TRACK-${sourceIndex}}`,
    position_seconds: positionSeconds,
    new_item_ref: `item:guid:{COPY-ITEM-${suffix}}`,
    new_take_ref: `take:guid:{COPY-TAKE-${suffix}}`,
    live_readback: { status: "passed", source: "final_read_item_summary" },
  };
}

function appliedPlacement(suffix, positionSeconds) {
  return {
    id: `placement-${suffix}`,
    mode: "place_assets",
    status: "applied",
    mutation: { status: "completed", verification_status: "passed" },
    live_readback: {
      status: "passed",
      item_ref: `item:guid:{PLACED-ITEM-${suffix}}`,
      take_ref: `take:guid:{PLACED-TAKE-${suffix}}`,
      track_ref: `track:guid:{PLACED-TRACK-${suffix}}`,
      position_seconds: positionSeconds,
    },
  };
}

function officialFacts(revision) {
  return {
    content_hash: revision.content_hash,
    risk_grants: revision.draft.risk_grants,
    project_identity: "project:tab:real-fixture",
    bridge_owner: "owner:real",
    bridge_generation: "7",
    available_capabilities: revision.draft.required_capabilities,
    checkpoint_evidence: revision.draft.checkpoints.map((item) => ({
      checkpoint_id: item.id,
      evidence_id: item.evidence_id,
      resume_identity: item.resume_identity,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
    })),
    dependency_versions: revision.dependency_lock.entries.map((entry) => ({ kind: entry.kind, id: entry.id, version: entry.version })),
    dependency_descriptors: revision.dependency_lock.entries.map((entry) => ({ kind: entry.kind, id: entry.id, descriptor_hash: entry.descriptor_hash })),
  };
}

function macroResult({ changes = [], data = {} } = {}) {
  const envelope = {
    contract: "macro.execution.v1",
    ok: true,
    macro: { id: "macro.fixture", program_id: "openreaper.macro.fixture", program_version: "1.0.0", risk: "write" },
    request: { request_id: "official-stage", dry_run: false },
    execution: { status: "completed", started_at: "2026-07-22T00:00:00.000Z", completed_at: "2026-07-22T00:00:01.000Z", stage_count: 1, stages: [{ id: "fixture", kind: "verify", status: "completed", evidence_refs: ["evidence:official-stage"] }] },
    sqlite: { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false },
    result: { summary: "Official stage completed.", canonical_refs: [], changes, verification: { status: "passed", evidence_refs: ["evidence:official-stage"] }, artifact_refs: [], data },
    blockers: [], error: null, recovery: null,
    budget: { max_bytes: 65_536, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  for (let index = 0; index < 4; index += 1) {
    envelope.budget.actual_bytes = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  }
  return envelope;
}
