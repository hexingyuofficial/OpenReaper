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
]);

const PORTABILITY = Object.freeze({
  project_identity: "project:runtime_bound",
  bridge_owner: "bridge:runtime_bound",
  bridge_generation: "generation:runtime_bound",
  platform: "darwin",
});

const DEFAULT_MIDI_NOTES = Object.freeze([
  Object.freeze({ start_offset_quarter_notes: 0, end_offset_quarter_notes: 0.8, pitch: 60, velocity: 88, channel: 0 }),
  Object.freeze({ start_offset_quarter_notes: 1, end_offset_quarter_notes: 1.8, pitch: 64, velocity: 88, channel: 0 }),
  Object.freeze({ start_offset_quarter_notes: 2, end_offset_quarter_notes: 2.8, pitch: 67, velocity: 88, channel: 0 }),
  Object.freeze({ start_offset_quarter_notes: 3, end_offset_quarter_notes: 3.8, pitch: 72, velocity: 88, channel: 0 }),
]);

// These revisions are ordinary sealed Recipe graphs. Every derived Macro input and
// dispatcher ref is a hash-covered expression, so forks execute the same generic
// runtime path as a user-authored Recipe.
const RECIPE_SPECS = Object.freeze([
  {
    id: "recipe.mix.create_bus_processing",
    title: "Create bus processing",
    summary: "Create or reuse a bus, route exact source Tracks, and apply a verified processing chain.",
    pack: "routing",
    inputs: ["source_tracks", "bus_name", "fx_chain", "controls"],
    requiredInputs: ["source_tracks"],
    stages: [
      stage("layout", "macro.project.apply_layout", ["layout", "match_policy", "conflict_policy", "dry_run"], ["changes"]),
      stage("routing", "macro.routing.apply", ["routes", "master_parent", "channel_counts", "dry_run"], ["changes"]),
      stage("processing", "macro.fx.apply_chain", ["owner_kind", "chain", "dry_run"], ["evidence_ref"]),
    ],
    outputs: [
      recipeOutput("layout_changes", "layout", "changes"),
      recipeOutput("routing_changes", "routing", "changes"),
      recipeOutput("processing_evidence", "processing", "evidence_ref", "string"),
    ],
    bindings: [
      expressionBinding("layout", "layout", array(object({
        id: literal("bus"), kind: literal("track"),
        name: coalesce(input("bus_name"), literal("OpenReaper Bus")),
      }))),
      expressionBinding("layout", "match_policy", literal("exact_name")),
      expressionBinding("layout", "conflict_policy", literal("update_declared_fields")),
      expressionBinding("layout", "dry_run", literal(false)),
      expressionBinding("routing", "routes", map(input("source_tracks"), "source", "source_index", object({
        id: concat([literal("route_"), add([local("source_index"), literal(1)])]),
        action: literal("create"), source_track_ref: local("source"),
        destination_track_ref: get(stage("layout", "changes"), [0, "target_ref"]),
        duplicate_policy: literal("reuse_existing"), volume: literal(1), pan: literal(0), muted: literal(false),
      }))),
      expressionBinding("routing", "master_parent", array()),
      expressionBinding("routing", "channel_counts", array()),
      expressionBinding("routing", "dry_run", literal(false)),
      expressionBinding("processing", "owner_kind", literal("track")),
      expressionBinding("processing", "chain", coalesce(input("fx_chain"), array(
        object({ plugin_query: literal("ReaEQ"), duplicate_policy: literal("reuse_exact") }),
        object({ plugin_query: literal("ReaComp"), duplicate_policy: literal("reuse_exact"), controls: input("controls") }),
      ))),
      expressionBinding("processing", "dry_run", literal(false)),
      refsBinding("processing", object({ track_ref: get(stage("layout", "changes"), [0, "target_ref"]) })),
    ],
  },
  {
    id: "recipe.midi.create_instrument_part",
    title: "Create instrument MIDI part",
    summary: "Create or reuse an instrument Track and write a deterministic playable MIDI part.",
    pack: "midi",
    inputs: ["target_track", "track_name", "instrument", "bars", "meter", "notes"],
    stages: [
      stage("layout", "macro.project.apply_layout", ["layout", "match_policy", "conflict_policy", "dry_run"], ["changes"]),
      stage("instrument", "macro.fx.apply_chain", ["owner_kind", "chain", "dry_run"], ["changes"]),
      stage("midi", "macro.midi.apply", ["mode", "start_seconds", "duration_quarter_notes", "notes", "dry_run"], ["evidence_ref"]),
    ],
    outputs: [
      recipeOutput("layout_changes", "layout", "changes"),
      recipeOutput("instrument_changes", "instrument", "changes"),
      recipeOutput("midi_evidence", "midi", "evidence_ref", "string"),
    ],
    bindings: [
      expressionBinding("layout", "layout", array(object({
        id: literal("instrument"), kind: literal("track"),
        name: coalesce(input("track_name"), literal("OpenReaper Instrument")),
        track_ref: input("target_track"),
      }))),
      expressionBinding("layout", "match_policy", ifElse(input("target_track"), literal("by_ref"), literal("exact_name"))),
      expressionBinding("layout", "conflict_policy", literal("update_declared_fields")),
      expressionBinding("layout", "dry_run", literal(false)),
      expressionBinding("instrument", "owner_kind", literal("track")),
      expressionBinding("instrument", "chain", array(object({
        plugin_query: coalesce(input("instrument"), literal("ReaSynth")), duplicate_policy: literal("reuse_exact"),
      }))),
      expressionBinding("instrument", "dry_run", literal(false)),
      refsBinding("instrument", object({ track_ref: get(stage("layout", "changes"), [0, "target_ref"]) })),
      expressionBinding("midi", "mode", literal("create_clips")),
      expressionBinding("midi", "start_seconds", literal(0)),
      expressionBinding("midi", "duration_quarter_notes", mul([
        coalesce(input("bars"), literal(4)),
        get(coalesce(input("meter"), literal({ numerator: 4, denominator: 4 })), ["numerator"]),
      ])),
      expressionBinding("midi", "notes", coalesce(input("notes"), literal(DEFAULT_MIDI_NOTES))),
      expressionBinding("midi", "dry_run", literal(false)),
      refsBinding("midi", object({ track_ref: get(stage("layout", "changes"), [0, "target_ref"]) })),
    ],
  },
]);

function stage(id, dependencyId, inputs, outputs) {
  if (arguments.length === 2) return Object.freeze({ op: "stage", id, port: dependencyId });
  return Object.freeze({ id, dependencyId, inputs, outputs });
}

function expressionBinding(toId, toPort, expression) {
  return Object.freeze({ toId, toPort, expression });
}

function refsBinding(toId, expression) {
  return Object.freeze({ toId, refs: true, expression });
}

function recipeOutput(id, stageId, port, type = "json") {
  return Object.freeze({ id, stageId, port, type });
}

function expression(op, fields = {}) {
  return Object.freeze({ op, ...fields });
}

function literal(value) { return expression("literal", { value }); }
function input(id) { return expression("input", { id }); }
function local(id) { return expression("local", { id }); }
function object(fields) { return expression("object", { fields }); }
function array(...items) { return expression("array", { items }); }
function get(value, path) { return expression("get", { value, path }); }
function coalesce(...values) { return expression("coalesce", { values }); }
function ifElse(condition, then, otherwise) { return expression("if", { condition, then, else: otherwise }); }
function map(items, as, index_as, body) { return expression("map", { items, as, index_as, body }); }
function flatMap(items, as, index_as, body) { return expression("flat_map", { items, as, index_as, body }); }
function filter(items, as, index_as, body) { return expression("filter", { items, as, index_as, body }); }
function range(start, count) { return expression("range", { start, count }); }
function length(value) { return expression("length", { value }); }
function min(value) { return expression("min", { value }); }
function max(value) { return expression("max", { value }); }
function add(values) { return expression("add", { values }); }
function sub(values) { return expression("sub", { values }); }
function mul(values) { return expression("mul", { values }); }
function clamp(value, min, max) { return expression("clamp", { value, min, max }); }
function eq(values) { return expression("eq", { values }); }
function join(values, separator) { return expression("join", { values, separator }); }
function concat(values) { return expression("concat", { values }); }
function seededUniform(seed, index, min, max) { return expression("seeded_uniform", { seed, index, min, max }); }
function recipeSeed() { return input("seed"); }

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
  const desired = new Set(revisions.map(revisionIdentityKey));
  const removed = [];
  for (const existing of store.list().items ?? []) {
    if (desired.has(revisionIdentityKey(existing))) continue;
    const deleted = store.delete(existing, { confirm: true });
    removed.push(Object.freeze({
      recipe_id: deleted.recipe_id,
      version: deleted.version,
      revision: deleted.revision,
      content_hash: deleted.content_hash,
    }));
  }
  const seeded = revisions.map((revision) => store.save(revision));
  return Object.freeze({
    contract: ALPHA3_45_OFFICIAL_EXECUTABLE_RECIPE_CONTRACT,
    source: "official",
    count: seeded.length,
    removed_count: removed.length,
    removed: Object.freeze(removed),
    seeded: Object.freeze(seeded),
  });
}

function revisionIdentityKey(value) {
  return `${value.recipe_id}\u0000${value.version}\u0000${value.revision}\u0000${value.content_hash}`;
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
    expression: binding.expression,
    to: binding.refs === true
      ? { scope: "stage_refs", id: binding.toId, port: "refs" }
      : { scope: "stage", id: binding.toId, port: binding.toPort },
  }));
  for (const output of spec.outputs ?? []) {
    bindings.push({
      from: { scope: "stage", id: output.stageId, port: output.port },
      to: { scope: "recipe_output", id: null, port: output.id },
    });
  }
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
    inputs: spec.inputs.map((id) => ({ id, type: "json", required: (spec.requiredInputs ?? []).includes(id) })),
    outputs: [
      ...(spec.outputs ?? []).map((output) => ({ id: output.id, type: output.type, required: true })),
      { id: "evidence_ref", type: "string", required: true },
    ],
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
