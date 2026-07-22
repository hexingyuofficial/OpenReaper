import { createHash } from "node:crypto";

const PORTABLE_SENTINELS = Object.freeze({
  project_identity: "project:runtime_bound",
  bridge_owner: "bridge:runtime_bound",
  bridge_generation: "generation:runtime_bound",
});
const MAX_VARIATION_ROWS = 64;

// Bounded recipe profiles are declarative shape matches (stages + dependency ids +
// input ids). Official catalog ids may seed defaults/catalog ownership elsewhere,
// but execution hydration never privileges source=official or a fixed recipe_id.
const RECIPE_PROFILES = Object.freeze([
  Object.freeze({
    id: "profile.mix.create_bus_processing",
    inputs: Object.freeze(["source_tracks", "bus_name", "processing_profile", "fx_chain", "controls"]),
    stages: Object.freeze([
      Object.freeze({ id: "layout", dependency: "macro.project.apply_layout" }),
      Object.freeze({ id: "routing", dependency: "macro.routing.apply" }),
      Object.freeze({ id: "processing", dependency: "macro.fx.apply_chain" }),
    ]),
  }),
  Object.freeze({
    id: "profile.midi.create_instrument_part",
    inputs: Object.freeze([
      "target_track", "track_name", "instrument", "bars", "meter", "tempo", "key", "scale",
      "density", "register", "pattern", "seed", "humanize",
    ]),
    stages: Object.freeze([
      Object.freeze({ id: "layout", dependency: "macro.project.apply_layout" }),
      Object.freeze({ id: "instrument", dependency: "macro.fx.apply_chain" }),
      Object.freeze({ id: "midi", dependency: "macro.midi.apply" }),
    ]),
  }),
  Object.freeze({
    id: "profile.media.create_layered_sound_effect_variants",
    inputs: Object.freeze([
      "search_terms", "variant_count", "seed", "style", "track_prefix", "trim", "fades", "balance",
    ]),
    stages: Object.freeze([
      Object.freeze({ id: "search", dependency: "macro.media.place_assets" }),
      Object.freeze({ id: "place", dependency: "macro.media.place_assets" }),
      Object.freeze({ id: "copy", dependency: "macro.items.apply" }),
      Object.freeze({ id: "controls", dependency: "macro.items.apply" }),
    ]),
  }),
  Object.freeze({
    id: "profile.items.create_sound_variations",
    inputs: Object.freeze([
      "source_items", "variation_count", "seed", "take_mode", "source_offset", "pitch", "volume",
      "pan", "position", "track_shuffle", "mute_probability", "automation", "tone", "crossfade",
      "item_overrides",
    ]),
    stages: Object.freeze([
      Object.freeze({ id: "copy", dependency: "macro.items.apply" }),
      Object.freeze({ id: "controls", dependency: "macro.items.apply" }),
      Object.freeze({ id: "tone", dependency: "macro.fx.set_controls" }),
      Object.freeze({ id: "automation", dependency: "macro.automation.apply" }),
    ]),
  }),
]);

export function prepareAlpha345OfficialRecipeRun({ revision, source = null, inputs = {}, runtime_facts = {}, retained = null } = {}) {
  void source;
  const profile = matchRecipeProfile(revision);
  if (!profile) {
    return { ok: true, inputs, context: null };
  }
  if (!hasOfficialPortableSentinels(revision)) {
    return failed("OFFICIAL_RECIPE_PORTABILITY_INVALID", "Official Recipe portability sentinels are invalid.");
  }
  const merged = mergeDefaults(profile.id, inputs, retained);
  const validation = validateOfficialInputs(profile.id, merged);
  if (!validation.ok) return validation;
  return {
    ok: true,
    inputs: merged,
    trust_runtime_facts: {
      ...runtime_facts,
      ...PORTABLE_SENTINELS,
    },
    context: {
      contract: "openreaper.alpha3.45.official_recipe_run_hydration.v1",
      recipe_id: revision.recipe_id,
      profile_id: profile.id,
      seed: merged.seed,
      observed_project_identity: runtime_facts.project_identity ?? null,
      observed_bridge_owner: runtime_facts.bridge_owner ?? null,
      observed_bridge_generation: runtime_facts.bridge_generation ?? null,
    },
  };
}

export function hydrateAlpha345OfficialRecipeStageInputs(context = {}) {
  const profile = matchRecipeProfile(context.revision);
  if (!profile) {
    return { ok: true, inputs: context.inputs ?? {}, refs: null };
  }
  try {
    return hydrateOfficialStage(profile.id, context);
  } catch (error) {
    return failed(error.code ?? "OFFICIAL_RECIPE_STAGE_HYDRATION_FAILED", error.message);
  }
}

export function matchAlpha345RecipeProfile(revision) {
  return matchRecipeProfile(revision);
}

function matchRecipeProfile(revision) {
  const draft = revision?.draft;
  if (!draft || !Array.isArray(draft.stages) || !Array.isArray(draft.inputs)) return null;
  const stageSignature = draft.stages.map((stage) => stageSignatureKey(stage));
  const inputSignature = draft.inputs.map((entry) => entry?.id).filter((id) => typeof id === "string").sort().join("\0");
  for (const profile of RECIPE_PROFILES) {
    if (profile.stages.length !== stageSignature.length) continue;
    if (!profile.stages.every((stage, index) => stageSignatureKey(stage) === stageSignature[index])) continue;
    const profileInputs = [...profile.inputs].sort().join("\0");
    if (profileInputs !== inputSignature) continue;
    return profile;
  }
  return null;
}

function stageSignatureKey(stage) {
  const id = stage?.id ?? "";
  const dependency = stage?.dependency?.id ?? stage?.dependency ?? "";
  return `${id}\0${dependency}`;
}

function hydrateOfficialStage(profileId, context) {
  const stageId = context.stage?.id;
  const recipeInputs = context.recipe_inputs ?? {};
  const boundInputs = context.inputs ?? {};
  if (profileId === "profile.mix.create_bus_processing") {
    return hydrateBusProcessing(stageId, recipeInputs, boundInputs);
  }
  if (profileId === "profile.midi.create_instrument_part") {
    return hydrateInstrumentPart(stageId, recipeInputs, boundInputs);
  }
  if (profileId === "profile.media.create_layered_sound_effect_variants") {
    return hydrateLayeredVariants(stageId, recipeInputs, boundInputs);
  }
  if (profileId === "profile.items.create_sound_variations") {
    return hydrateItemVariations(stageId, recipeInputs, boundInputs);
  }
  throw coded("OFFICIAL_RECIPE_ID_UNSUPPORTED", `Unsupported recipe profile ${profileId}.`);
}

function hydrateBusProcessing(stageId, input, bound) {
  if (stageId === "layout") {
    return success({
      layout: [{ id: "bus", kind: "track", name: input.bus_name }],
      match_policy: "exact_name",
      conflict_policy: "update_declared_fields",
      dry_run: false,
    });
  }
  const busRef = requireSingleTrackRef(bound.layout_changes, "bus Track");
  if (stageId === "routing") {
    return success({
      routes: input.source_tracks.map((source, index) => ({
        id: `route_${index + 1}`,
        action: "create",
        source_track_ref: canonicalRef(source, "track"),
        destination_track_ref: busRef,
        duplicate_policy: "reject_existing",
        volume: 1,
        pan: 0,
        muted: false,
      })),
      master_parent: [],
      channel_counts: [],
      dry_run: false,
    });
  }
  if (stageId === "processing") {
    const chain = Array.isArray(input.fx_chain) && input.fx_chain.length > 0
      ? input.fx_chain
      : [
          { plugin_query: "ReaEQ", duplicate_policy: "reuse_exact" },
          { plugin_query: "ReaComp", duplicate_policy: "reuse_exact", controls: input.controls },
        ];
    return success({ owner_kind: "track", chain, dry_run: false }, { track_ref: busRef });
  }
  throw coded("OFFICIAL_RECIPE_STAGE_UNKNOWN", `Unknown bus Recipe stage ${stageId}.`);
}

function hydrateInstrumentPart(stageId, input, bound) {
  if (stageId === "layout") {
    return success({
      layout: [{
        id: "instrument",
        kind: "track",
        name: input.track_name,
        ...(isRef(input.target_track, "track") ? { track_ref: canonicalRef(input.target_track, "track") } : {}),
      }],
      match_policy: isRef(input.target_track, "track") ? "by_ref" : "exact_name",
      conflict_policy: "update_declared_fields",
      dry_run: false,
    });
  }
  const trackRef = requireSingleTrackRef(bound.layout_changes, "instrument Track");
  if (stageId === "instrument") {
    return success({
      owner_kind: "track",
      chain: [{ plugin_query: input.instrument, duplicate_policy: "reuse_exact" }],
      dry_run: false,
    }, { track_ref: trackRef });
  }
  if (stageId === "midi") {
    const beatsPerBar = input.meter.numerator;
    const duration = input.bars * beatsPerBar;
    return success({
      mode: "create_clips",
      start_seconds: 0,
      duration_quarter_notes: duration,
      notes: createMidiNotes(input, duration),
      dry_run: false,
    }, { track_ref: trackRef });
  }
  throw coded("OFFICIAL_RECIPE_STAGE_UNKNOWN", `Unknown MIDI Recipe stage ${stageId}.`);
}

function hydrateLayeredVariants(stageId, input, bound) {
  if (stageId === "search") {
    return success({
      mode: "search_library",
      query: input.search_terms.join(" "),
      page_size: Math.min(8, Math.max(input.search_terms.length, 4)),
      dry_run: true,
    });
  }
  if (stageId === "place") {
    const candidates = normalizeMediaCandidates(bound.candidates, input.search_terms.length);
    return success({
      mode: "place_assets",
      assets: candidates.map((candidate, index) => ({ id: `layer_${index + 1}`, path: candidate.path })),
      placement: { mode: "stack_on_separate_tracks", start_seconds: 0, align_basis: "item_start" },
      track_policy: "one_new_track_per_asset",
      new_track: { name_prefix: input.track_prefix },
      dry_run: false,
    });
  }
  const placed = extractPlacedItems(bound.placement_changes);
  if (stageId === "copy") {
    const variations = [];
    for (let variant = 0; variant < input.variant_count; variant += 1) {
      for (const [index, row] of placed.entries()) {
        variations.push({
          id: rowId("lv", variant, index),
          source_item_ref: row.item_ref,
          target_track_ref: row.track_ref,
          position_seconds: row.position_seconds + ((variant + 1) * input.variant_spacing_seconds),
        });
      }
    }
    requireRowBudget(variations.length);
    return success({ mode: "create_variations", variations, dry_run: false });
  }
  if (stageId === "controls") {
    const copies = extractVariationCopies(bound.variation_changes);
    return success({
      mode: "set_item_take_controls",
      changes: copies.map((row, index) => ({
        id: rowId("lc", 0, index),
        item_ref: row.item_ref,
        take_ref: row.take_ref,
        item: { volume_db: seededRange(input.seed, index, -2, 1) },
        take: { pan: seededRange(input.seed, index + 101, -0.25, 0.25) },
      })),
      dry_run: false,
    });
  }
  throw coded("OFFICIAL_RECIPE_STAGE_UNKNOWN", `Unknown layered Recipe stage ${stageId}.`);
}

function hydrateItemVariations(stageId, input, bound) {
  if (stageId === "copy") {
    const sources = normalizeSourceItems(input.source_items);
    const span = Math.max(...sources.map((row) => row.position_seconds + row.length_seconds))
      - Math.min(...sources.map((row) => row.position_seconds));
    const start = Math.max(...sources.map((row) => row.position_seconds + row.length_seconds)) + input.position.gap_seconds;
    const tracks = sources.map((row) => row.track_ref);
    const variations = [];
    for (let variant = 0; variant < input.variation_count; variant += 1) {
      for (const [index, source] of sources.entries()) {
        const targetTrack = input.track_shuffle
          ? tracks[(index + variant + 1) % tracks.length]
          : source.track_ref;
        variations.push({
          id: rowId("v", variant, index),
          source_item_ref: source.item_ref,
          target_track_ref: targetTrack,
          position_seconds: start + (variant * (span + input.position.gap_seconds))
            + (source.position_seconds - sources[0].position_seconds),
          source_offset_seconds: seededRange(input.seed, variations.length, 0, input.source_offset.max_seconds),
        });
      }
    }
    requireRowBudget(variations.length);
    return success({ mode: "create_variations", variations, dry_run: false });
  }
  const copies = extractVariationCopies(bound.variation_changes);
  if (stageId === "controls") {
    return success({
      mode: "set_item_take_controls",
      changes: copies.map((row, index) => ({
        id: rowId("ctl", 0, index),
        item_ref: row.item_ref,
        take_ref: row.take_ref,
        item: { volume_db: seededRange(input.seed, index + 11, -input.volume.max_db, input.volume.max_db) },
        take: {
          pan: seededRange(input.seed, index + 23, -input.pan.max, input.pan.max),
          pitch_semitones: seededRange(input.seed, index + 37, -input.pitch.max_semitones, input.pitch.max_semitones),
          playrate: seededRange(input.seed, index + 41, input.pitch.min_playrate, input.pitch.max_playrate),
          preserve_pitch: true,
        },
      })),
      dry_run: false,
    });
  }
  if (stageId === "tone") {
    return success({
      mode: "exact_assignments",
      assignments: copies.map((row, index) => ({
        id: rowId("tone", 0, index),
        fx_ref: takeFxRef(row.take_ref, 0),
        param_index: input.tone.param_index,
        normalized_value: seededRange(input.seed, index + 53, input.tone.min, input.tone.max),
      })),
      dry_run: false,
    });
  }
  if (stageId === "automation") {
    const sourceLengths = new Map(normalizeSourceItems(input.source_items).map((row) => [row.item_ref, row.length_seconds]));
    return success({
      mode: "insert_fx_parameter_points",
      fx_targets: copies.map((row, copyIndex) => {
        const sourceLength = sourceLengths.get(row.source_item_ref);
        if (!finite(sourceLength) || sourceLength <= 0) throw coded("OFFICIAL_AUTOMATION_SOURCE_LENGTH_INVALID", "Copied Item automation requires the exact source Item length.");
        return {
          fx_ref: takeFxRef(row.take_ref, 0),
          points: input.automation.points.map((point, pointIndex) => {
            if (!finite(point.time_seconds) || point.time_seconds < 0 || point.time_seconds > sourceLength) {
              throw coded("OFFICIAL_AUTOMATION_POINT_OUTSIDE_ITEM", "Automation point offsets must fall inside every copied Item length.");
            }
            const value = point.value + seededRange(input.seed, 67 + (copyIndex * input.automation.points.length) + pointIndex, -input.automation.value_variation, input.automation.value_variation);
            return { ...point, time_seconds: row.position_seconds + point.time_seconds, value: Math.max(0, Math.min(1, value)) };
          }),
        };
      }),
      fx_parameter: { param_index: input.automation.param_index, create_if_missing: true },
      dry_run: false,
    });
  }
  throw coded("OFFICIAL_RECIPE_STAGE_UNKNOWN", `Unknown Item variation stage ${stageId}.`);
}

function mergeDefaults(profileId, inputs, retained) {
  const seed = Number.isSafeInteger(inputs.seed)
    ? inputs.seed
    : Number.isSafeInteger(retained?.seed)
      ? retained.seed
      : deterministicSeed(profileId, inputs);
  const defaults = recipeDefaults(profileId, seed);
  return deepMerge(defaults, inputs, { seed });
}

function recipeDefaults(profileId, seed) {
  if (profileId === "profile.mix.create_bus_processing") {
    return { source_tracks: [], bus_name: "OpenReaper Bus", processing_profile: "balanced", fx_chain: null, controls: { threshold_db: -18, ratio: 3 } };
  }
  if (profileId === "profile.midi.create_instrument_part") {
    return { target_track: null, track_name: "OpenReaper Instrument", instrument: "ReaSynth", bars: 4, meter: { numerator: 4, denominator: 4 }, tempo: null, key: "C", scale: "major", density: 0.5, register: 4, pattern: "pulse", seed, humanize: 0 };
  }
  if (profileId === "profile.media.create_layered_sound_effect_variants") {
    return { search_terms: [], variant_count: 4, seed, style: null, track_prefix: "SFX Layer", trim: null, fades: null, balance: null, variant_spacing_seconds: 2 };
  }
  return {
    source_items: [], variation_count: 4, seed, take_mode: "active", source_offset: { max_seconds: 0.15 },
    pitch: { max_semitones: 3, min_playrate: 0.92, max_playrate: 1.08 }, volume: { max_db: 2 },
    pan: { max: 0.4 }, position: { gap_seconds: 0.25 }, track_shuffle: false, mute_probability: 0,
    automation: { param_index: 1, value_variation: 0.08, points: [{ time_seconds: 0, value: 0.25 }, { time_seconds: 0.5, value: 0.75 }] },
    tone: { param_index: 0, min: 0.25, max: 0.75 }, crossfade: false, item_overrides: {},
  };
}

function validateOfficialInputs(profileId, input) {
  if (profileId === "profile.mix.create_bus_processing") {
    if (!Array.isArray(input.source_tracks) || input.source_tracks.length < 1 || input.source_tracks.some((ref) => !isRef(ref, "track"))) return failed("OFFICIAL_SOURCE_TRACKS_REQUIRED", "source_tracks must contain exact Track refs.");
  } else if (profileId === "profile.midi.create_instrument_part") {
    if (!Number.isInteger(input.bars) || input.bars < 1 || input.bars > 32) return failed("OFFICIAL_MIDI_BARS_INVALID", "bars must be an integer from 1 to 32.");
    if (!input.meter || !Number.isInteger(input.meter.numerator) || input.meter.numerator < 1 || input.meter.numerator > 12) return failed("OFFICIAL_MIDI_METER_INVALID", "meter.numerator must be 1-12.");
  } else if (profileId === "profile.media.create_layered_sound_effect_variants") {
    if (!Array.isArray(input.search_terms) || input.search_terms.length < 2 || input.search_terms.some((term) => typeof term !== "string" || term.trim() === "")) return failed("OFFICIAL_MEDIA_TERMS_REQUIRED", "search_terms must contain at least two non-empty terms.");
    if (!integerRange(input.variant_count, 1, 64)) return failed("OFFICIAL_VARIATION_COUNT_INVALID", "variant_count must be 1-64.");
  } else {
    if (input.crossfade === true) return failed("OFFICIAL_CROSSFADE_PATH_UNAVAILABLE", "crossfade=true is unavailable and fails before mutation.");
    if (input.take_mode !== "active") return failed("OFFICIAL_TAKE_MODE_UNAVAILABLE", "Only take_mode=active is accepted in Alpha3.45.");
    if (input.mute_probability !== 0) return failed("OFFICIAL_MUTE_VARIATION_UNAVAILABLE", "mute_probability is not accepted until exact batch mute readback is available.");
    const sources = normalizeSourceItems(input.source_items, { fail: false });
    if (!sources || sources.length < 1) return failed("OFFICIAL_SOURCE_ITEMS_REQUIRED", "source_items must contain exact Item/Track/Take fixture facts.");
    if (!integerRange(input.variation_count, 1, 64) || sources.length * input.variation_count > MAX_VARIATION_ROWS) return failed("OFFICIAL_VARIATION_ROW_LIMIT", "source item count multiplied by variation_count must be at most 64.");
    if (!input.automation || !integerRange(input.automation.param_index, 0, 65535) || !finite(input.automation.value_variation) || input.automation.value_variation < 0 || input.automation.value_variation > 0.5 || !Array.isArray(input.automation.points) || input.automation.points.length < 1 || input.automation.points.length > 8) return failed("OFFICIAL_AUTOMATION_INPUT_INVALID", "automation requires param_index, value_variation 0..0.5, and 1-8 point offsets.");
    if (input.automation.points.some((point) => !point || !finite(point.time_seconds) || point.time_seconds < 0 || !finite(point.value) || point.value < 0 || point.value > 1)) return failed("OFFICIAL_AUTOMATION_INPUT_INVALID", "Automation point offsets must use time_seconds>=0 and normalized value 0..1.");
    if (sources.some((source) => input.automation.points.some((point) => point.time_seconds > source.length_seconds))) return failed("OFFICIAL_AUTOMATION_POINT_OUTSIDE_ITEM", "Automation point offsets must fall inside every source Item length.");
  }
  return { ok: true };
}

function normalizeSourceItems(value, options = {}) {
  if (!Array.isArray(value)) return options.fail === false ? null : (() => { throw coded("OFFICIAL_SOURCE_ITEMS_REQUIRED", "source_items must be an array."); })();
  const rows = [];
  for (const row of value) {
    if (!row || typeof row !== "object" || !isRef(row.item_ref, "item") || !isRef(row.track_ref, "track") || !isRef(row.take_ref, "take") || !finite(row.position_seconds) || row.position_seconds < 0 || !finite(row.length_seconds) || row.length_seconds <= 0) {
      if (options.fail === false) return null;
      throw coded("OFFICIAL_SOURCE_ITEM_FACTS_INVALID", "Every source Item needs exact item_ref, track_ref, take_ref, position_seconds, and length_seconds.");
    }
    rows.push(row);
  }
  return rows;
}

function normalizeMediaCandidates(value, count) {
  const candidates = Array.isArray(value) ? value : [];
  const usable = candidates.filter((row) => row?.available !== false && typeof row?.path === "string" && row.path.startsWith("/"));
  if (usable.length < count) throw coded("OFFICIAL_MEDIA_CANDIDATES_INSUFFICIENT", "Approved media search returned too few available exact paths.");
  return usable.slice(0, Math.min(8, count));
}

function extractPlacedItems(value) {
  const rows = [];
  for (const change of Array.isArray(value) ? value : []) {
    if (change?.mode !== "place_assets" || change?.status !== "applied" || change?.live_readback?.status !== "passed") continue;
    const itemRef = change.live_readback.item_ref;
    const takeRef = change.live_readback.take_ref;
    const trackRef = change.live_readback.track_ref;
    const position = change.live_readback.position_seconds;
    if (!isRef(itemRef, "item") || !isRef(takeRef, "take") || !isRef(trackRef, "track") || !finite(position) || position < 0) {
      throw coded("OFFICIAL_PLACEMENT_OUTPUT_INVALID", "Applied placement output requires exact Item/Take/Track refs and a finite live-readback position.");
    }
    rows.push({ item_ref: itemRef, take_ref: takeRef, track_ref: trackRef, position_seconds: position });
  }
  if (rows.length < 1) throw coded("OFFICIAL_PLACEMENT_OUTPUT_INVALID", "Placement stage returned no exact Item/Track changes.");
  if (new Set(rows.map((row) => row.item_ref)).size !== rows.length || new Set(rows.map((row) => row.take_ref)).size !== rows.length) {
    throw coded("OFFICIAL_PLACEMENT_OUTPUT_INVALID", "Placement stage returned duplicate Item or Take identities.");
  }
  return rows;
}

function extractVariationCopies(value) {
  const rows = (Array.isArray(value) ? value : []).filter((change) => change?.status === "applied" && change?.live_readback?.status === "passed").map((change) => ({
    item_ref: change.new_item_ref,
    take_ref: change.new_take_ref,
    source_item_ref: change.source_item_ref,
    track_ref: change.target_track_ref,
    position_seconds: change.position_seconds,
  })).filter((row) => isRef(row.item_ref, "item") && isRef(row.take_ref, "take") && isRef(row.source_item_ref, "item") && isRef(row.track_ref, "track") && finite(row.position_seconds) && row.position_seconds >= 0);
  if (rows.length < 1) throw coded("OFFICIAL_VARIATION_OUTPUT_INVALID", "Variation stage returned no exact copied Item/Take refs.");
  if (new Set(rows.map((row) => row.item_ref)).size !== rows.length || new Set(rows.map((row) => row.take_ref)).size !== rows.length) throw coded("OFFICIAL_VARIATION_OUTPUT_INVALID", "Variation stage returned duplicate copied Item or Take refs.");
  return rows;
}

function requireSingleTrackRef(value, label) {
  const refs = collectRefs(value, "track");
  if (refs.length !== 1) throw coded("OFFICIAL_TRACK_OUTPUT_INVALID", `Expected one exact ${label} ref.`);
  return refs[0];
}

function createMidiNotes(input, duration) {
  const scale = input.scale === "minor" ? [0, 2, 3, 5, 7, 8, 10] : [0, 2, 4, 5, 7, 9, 11];
  const root = 12 * (input.register + 1) + keyOffset(input.key);
  const count = Math.max(1, Math.min(64, Math.round(duration * input.density)));
  const step = duration / count;
  return Array.from({ length: count }, (_, index) => ({
    start_offset_quarter_notes: index * step,
    end_offset_quarter_notes: Math.min(duration, (index * step) + Math.min(1, step * 0.8)),
    pitch: Math.max(0, Math.min(127, root + scale[index % scale.length])),
    velocity: 88 + Math.round(seededRange(input.seed, index + 73, -8, 8)),
    channel: 0,
  }));
}

function hasOfficialPortableSentinels(revision) {
  const portability = revision?.draft?.portability;
  return portability?.project_identity === PORTABLE_SENTINELS.project_identity
    && portability?.bridge_owner === PORTABLE_SENTINELS.bridge_owner
    && portability?.bridge_generation === PORTABLE_SENTINELS.bridge_generation;
}

function success(inputs, refs = null) {
  return { ok: true, inputs, refs };
}

function failed(code, message, details = {}) {
  return { ok: false, message, details: { code, ...details } };
}

function coded(code, message) {
  return Object.assign(new Error(message), { code });
}

function canonicalRef(value, kind) {
  const ref = typeof value === "string" ? value : value?.ref;
  if (!isRef(ref, kind)) throw coded("OFFICIAL_EXACT_REF_REQUIRED", `Expected exact ${kind} ref.`);
  return ref;
}

function isRef(value, kind) {
  const ref = typeof value === "string" ? value : value?.ref;
  return typeof ref === "string" && ref.startsWith(`${kind}:guid:`);
}

function collectRefs(value, kind) {
  const refs = [];
  const visit = (entry) => {
    if (isRef(entry, kind)) refs.push(canonicalRef(entry, kind));
    else if (Array.isArray(entry)) entry.forEach(visit);
    else if (entry && typeof entry === "object") Object.values(entry).forEach(visit);
  };
  visit(value);
  return [...new Set(refs)];
}

function takeFxRef(takeRef, index) {
  return `fx:${canonicalRef(takeRef, "take")}:${index}`;
}

function rowId(prefix, outer, inner) {
  return `${prefix}${outer + 1}_${inner + 1}`.slice(0, 12);
}

function requireRowBudget(count) {
  if (!integerRange(count, 1, MAX_VARIATION_ROWS)) throw coded("OFFICIAL_VARIATION_ROW_LIMIT", "Official variation work must contain 1-64 rows.");
}

function seededRange(seed, index, min, max) {
  const hash = createHash("sha256").update(`${seed}:${index}`).digest();
  const unit = hash.readUInt32BE(0) / 0xffffffff;
  return min + ((max - min) * unit);
}

function deterministicSeed(profileId, inputs) {
  return createHash("sha256").update(`${profileId}:${stableStringify(inputs)}`).digest().readUInt32BE(0);
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value && typeof value === "object") return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(",")}}`;
  return JSON.stringify(value);
}

function deepMerge(base, override, forced = {}) {
  const output = structuredClone(base);
  for (const [key, value] of Object.entries(override ?? {})) {
    output[key] = value && typeof value === "object" && !Array.isArray(value) && output[key] && typeof output[key] === "object" && !Array.isArray(output[key])
      ? deepMerge(output[key], value)
      : structuredClone(value);
  }
  return { ...output, ...forced };
}

function keyOffset(value) {
  return ({ C: 0, "C#": 1, Db: 1, D: 2, "D#": 3, Eb: 3, E: 4, F: 5, "F#": 6, Gb: 6, G: 7, "G#": 8, Ab: 8, A: 9, "A#": 10, Bb: 10, B: 11 })[value] ?? 0;
}

function integerRange(value, min, max) {
  return Number.isInteger(value) && value >= min && value <= max;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value);
}
