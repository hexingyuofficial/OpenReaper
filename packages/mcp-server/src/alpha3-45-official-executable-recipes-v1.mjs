import {
  sealExecutableRecipeRevision,
} from "../../core/src/executable-recipe-contract-v1.mjs";
import {
  EXECUTABLE_RECIPE_STORE_BUDGETS,
  ExecutableRecipeRevisionStoreError,
} from "../../core/src/executable-recipe-revision-store-v1.mjs";
import {
  createExecutableRecipeProductCatalog,
} from "./executable-recipe-product-catalog-v1.mjs";

export const ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_CONTRACT = "openreaper.alpha3.45.official_executable_recipes.v1";

export const ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS = Object.freeze([
  "recipe.mix.create_bus_processing",
  "recipe.midi.create_instrument_part",
  "recipe.media.create_layered_sound_effect_variants",
  "recipe.items.create_sound_variations",
]);

const PORTABILITY = Object.freeze({
  project_identity: "project:runtime_bound",
  bridge_owner: "bridge:runtime_bound",
  bridge_generation: "generation:runtime_bound",
  platform: "darwin",
});

const RECIPE_SPECS = Object.freeze([
  {
    id: "recipe.mix.create_bus_processing",
    title: "Create bus processing",
    summary: "Create or reuse a bus, route exact source Tracks, and apply a verified processing chain.",
    pack: "routing",
    inputs: ["source_tracks", "bus_name", "processing_profile", "fx_chain", "controls"],
    stages: [
      stage("layout", "macro.project.apply_layout", [], ["changes"]),
      stage("routing", "macro.routing.apply", ["layout_changes"], ["changes"]),
      stage("processing", "macro.fx.apply_chain", ["layout_changes"], ["evidence_ref"]),
    ],
    bindings: [
      stageBinding("layout", "changes", "routing", "layout_changes"),
      stageBinding("layout", "changes", "processing", "layout_changes"),
    ],
  },
  {
    id: "recipe.midi.create_instrument_part",
    title: "Create instrument MIDI part",
    summary: "Create or reuse an instrument Track and write a deterministic playable MIDI part.",
    pack: "midi",
    inputs: ["target_track", "track_name", "instrument", "bars", "meter", "tempo", "key", "scale", "density", "register", "pattern", "seed", "humanize"],
    stages: [
      stage("layout", "macro.project.apply_layout", [], ["changes"]),
      stage("instrument", "macro.fx.apply_chain", ["layout_changes"], ["changes"]),
      stage("midi", "macro.midi.apply", ["layout_changes"], ["evidence_ref"]),
    ],
    bindings: [
      stageBinding("layout", "changes", "instrument", "layout_changes"),
      stageBinding("layout", "changes", "midi", "layout_changes"),
    ],
  },
  {
    id: "recipe.media.create_layered_sound_effect_variants",
    title: "Create layered sound-effect variants",
    summary: "Resolve approved media sources and create aligned layered sound-effect variants on separate Tracks.",
    pack: "media",
    inputs: ["search_terms", "variant_count", "seed", "style", "track_prefix", "trim", "fades", "balance"],
    stages: [
      stage("search", "macro.media.place_assets", [], ["results"]),
      stage("place", "macro.media.place_assets", ["candidates"], ["changes"]),
      stage("copy", "macro.items.apply", ["placement_changes"], ["changes"]),
      stage("controls", "macro.items.apply", ["placement_changes", "variation_changes"], ["evidence_ref"]),
    ],
    bindings: [
      stageBinding("search", "results", "place", "candidates"),
      stageBinding("place", "changes", "copy", "placement_changes"),
      stageBinding("place", "changes", "controls", "placement_changes"),
      stageBinding("copy", "changes", "controls", "variation_changes"),
    ],
  },
  {
    id: "recipe.items.create_sound_variations",
    title: "Create sound variations",
    summary: "Create bounded seeded Item, Take, Tone/FX, and Automation/Envelope variations from selected Items.",
    pack: "items",
    inputs: ["source_items", "variation_count", "seed", "take_mode", "source_offset", "pitch", "volume", "pan", "position", "track_shuffle", "mute_probability", "automation", "tone", "crossfade", "item_overrides"],
    stages: [
      stage("copy", "macro.items.apply", [], ["changes"]),
      stage("controls", "macro.items.apply", ["variation_changes"], ["changes"]),
      stage("tone", "macro.fx.set_controls", ["variation_changes"], ["changes"]),
      stage("automation", "macro.automation.apply", ["variation_changes", "tone_changes"], ["evidence_ref"]),
    ],
    bindings: [
      stageBinding("copy", "changes", "controls", "variation_changes"),
      stageBinding("copy", "changes", "tone", "variation_changes"),
      stageBinding("copy", "changes", "automation", "variation_changes"),
      stageBinding("tone", "changes", "automation", "tone_changes"),
    ],
  },
]);

function stage(id, dependencyId, inputs, outputs) {
  return Object.freeze({ id, dependencyId, inputs, outputs });
}

function stageBinding(fromId, fromPort, toId, toPort) {
  return Object.freeze({ fromId, fromPort, toId, toPort });
}

export function createAlpha345OfficialExecutableRecipeRevisions(options = {}) {
  const catalog = options.catalog ?? createExecutableRecipeProductCatalog();
  const savedAt = options.saved_at ?? "2026-07-22T00:00:00.000Z";
  const revisions = RECIPE_SPECS.map((spec) => sealExecutableRecipeRevision(
    createDraft(spec, catalog),
    { catalog, version: "1.0.0", revision: 1, saved_at: savedAt },
  ));
  return Object.freeze(revisions);
}

export function createAlpha345OfficialExecutableRecipeCatalog(options = {}) {
  const revisions = createAlpha345OfficialExecutableRecipeRevisions(options);
  return Object.freeze({
    contract: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_CONTRACT,
    source: "official",
    revisions,
  });
}

export function seedAlpha345OfficialExecutableRecipeRevisions(store, options = {}) {
  if (!store || typeof store.save !== "function") {
    throw new TypeError("An executable Recipe revision store with save() is required.");
  }
  const revisions = createAlpha345OfficialExecutableRecipeRevisions(options);
  const seeded = revisions.map((revision) => store.save(revision));
  return Object.freeze({
    contract: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_CONTRACT,
    source: "official",
    count: seeded.length,
    seeded: Object.freeze(seeded),
  });
}

export function createAlpha345CombinedExecutableRecipeStore({
  userStore,
  officialStore,
  catalog,
} = {}) {
  assertStore(userStore, "userStore");
  assertStore(officialStore, "officialStore");
  const officialIds = new Set(ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_IDS);
  return Object.freeze({
    contract: userStore.contract,
    root: userStore.root,
    source: "combined",
    catalog,
    validate(input, options) {
      return userStore.validate(input, options);
    },
    save(input, options) {
      return withSource(userStore.save(input, options), "user");
    },
    list(options) {
      const official = officialStore.list(options);
      const user = userStore.list(options);
      const items = [
        ...(official.items ?? []).map((item) => withSource(item, "official")),
        ...(user.items ?? []).map((item) => withSource(item, "user")),
      ].sort(compareStoredRevision);
      if (items.length > EXECUTABLE_RECIPE_STORE_BUDGETS.max_list_items) {
        throw new ExecutableRecipeRevisionStoreError(
          `Combined executable Recipe store exceeds max_list_items budget (${EXECUTABLE_RECIPE_STORE_BUDGETS.max_list_items}).`,
          "STORE_BUDGET_EXCEEDED",
          {
            budget: "max_list_items",
            limit: EXECUTABLE_RECIPE_STORE_BUDGETS.max_list_items,
            observed: items.length,
          },
        );
      }
      return Object.freeze({
        contract: user.contract,
        ok: true,
        operation: "list",
        root: userStore.root,
        source: "combined",
        count: items.length,
        items: Object.freeze(items),
      });
    },
    get(identity, options) {
      const store = officialIds.has(identity?.recipe_id) ? officialStore : userStore;
      return withSource(store.get(identity, options), store === officialStore ? "official" : "user");
    },
    delete(identity, options) {
      if (officialIds.has(identity?.recipe_id)) {
        throw new ExecutableRecipeRevisionStoreError(
          `Delete refused; recipe id ${identity.recipe_id} is owned by the official catalog.`,
          "REVISION_OWNERSHIP_CONFLICT",
          { recipe_id: identity.recipe_id, source: "official" },
        );
      }
      return withSource(userStore.delete(identity, options), "user");
    },
  });
}

function assertStore(store, name) {
  for (const method of ["validate", "save", "list", "get", "delete"]) {
    if (typeof store?.[method] !== "function") {
      throw new TypeError(`${name} requires an executable Recipe store with ${method}().`);
    }
  }
}

function withSource(value, source) {
  return Object.freeze({ ...value, source });
}

function compareStoredRevision(left, right) {
  if (left.recipe_id !== right.recipe_id) return left.recipe_id.localeCompare(right.recipe_id);
  if (left.revision !== right.revision) return left.revision - right.revision;
  return left.content_hash.localeCompare(right.content_hash);
}

function createDraft(spec, catalog) {
  const dependencyIds = [...new Set(spec.stages.map((entry) => entry.dependencyId))];
  const dependencies = dependencyIds.map((id) => catalog.getMacro(id));
  const dependencyById = new Map(dependencies.map((entry) => [entry.id, entry]));
  const stages = spec.stages.map((entry, index) => {
    const dependency = dependencyById.get(entry.dependencyId);
    return {
    id: entry.id,
    kind: "macro",
    dependency: { kind: "macro", id: dependency.id, version: dependency.version, fallback_reason: null },
    inputs: [...entry.inputs],
    outputs: [...entry.outputs],
    risk: dependency.risk,
    checkpoint: `checkpoint_${index + 1}`,
  };
  });
  const bindings = spec.bindings.map((binding) => ({
    from: { scope: "stage", id: binding.fromId, port: binding.fromPort },
    to: { scope: "stage", id: binding.toId, port: binding.toPort },
  }));
  bindings.push({
    from: { scope: "stage", id: stages.at(-1).id, port: "evidence_ref" },
    to: { scope: "recipe_output", id: null, port: "evidence_ref" },
  });
  const risks = [...new Set(dependencies.map((dependency) => dependency.risk))];
  return {
    contract: "recipe.executable.draft.v1",
    id: spec.id,
    title: spec.title,
    summary: spec.summary,
    pack: spec.pack,
    risk: risks.includes("destructive") ? "destructive" : "write",
    inputs: spec.inputs.map((id) => ({ id, type: "json", required: false })),
    outputs: [{ id: "evidence_ref", type: "string", required: true }],
    stages,
    bindings,
    dependencies: dependencies.map((dependency) => ({
      kind: "macro",
      id: dependency.id,
      version: dependency.version,
      risk: dependency.risk,
      fallback_reason: null,
      descriptor_hash: dependency.descriptor_hash,
    })),
    required_capabilities: [...new Set(dependencies.flatMap((dependency) => dependency.capabilities))].sort(),
    risk_grants: [...new Set(["read", ...risks])],
    checkpoints: stages.map((stage, index) => ({
      id: stage.checkpoint,
      after_stage: stage.id,
      evidence_id: `evidence_${index + 1}`,
      resume_identity: `resume.${spec.pack}.${index + 1}`,
      summary: `Official Recipe stage ${index + 1} completed with retained evidence.`,
    })),
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: stages.length,
      dependency_count: dependencies.length,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: PORTABILITY,
  };
}
