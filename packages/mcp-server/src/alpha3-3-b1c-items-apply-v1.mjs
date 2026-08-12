import {
  MACRO_CONTRACT_CEILINGS,
  MACRO_EXECUTION_CONTRACT,
  MACRO_PROGRAM_REGISTRY_CONTRACT,
  createMacroProgramRegistry,
  validateMacroExecutionEnvelope,
  validateMacroProgramRequest,
} from "./macro-runtime-contract-v1.mjs";

export const ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID = "macro.items.apply";
export const ALPHA3_3_B1C_ITEMS_APPLY_CONTRACT = "alpha3.3.b1c.items_apply.v1";
export const ALPHA3_3_B1C_ITEMS_APPLY_MODES = deepFreeze([
  "select_exact",
  "align_starts",
  "align_ends",
  "sequence_with_gap",
  "distribute_evenly",
  "move_to_anchor",
  "stack_on_existing_tracks",
  "set_properties",
  "set_active_take",
  "apply_fades",
  "trim_exact",
  "set_take_playback",
  "set_snap_offset",
  "remove_silence",
  "normalize_level",
  "align_onsets",
  "set_item_take_controls",
  "create_variations",
]);
export const ALPHA3_3_B1C_ITEMS_BATCH_ITEM_FIELDS = deepFreeze([
  "volume_db",
  "length_seconds",
  "fade_in_seconds",
  "fade_out_seconds",
  "snap_offset_seconds",
]);
export const ALPHA3_3_B1C_ITEMS_BATCH_TAKE_FIELDS = deepFreeze([
  "volume_db",
  "pan",
  "pitch_semitones",
  "playrate",
  "preserve_pitch",
]);
export const ALPHA3_3_B1C_ITEMS_BATCH_ROW_ID_PATTERN = /^[A-Za-z0-9_-]{1,12}$/u;
export const ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS = 64;
export const ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES = deepFreeze([
  "set_snap_offset_to_onset",
  "normalize_peak",
  "normalize_lufs",
  "match_loudness",
  "trim_silence_edges",
  "split_at_transients",
  "crossfade_adjacent",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS = deepFreeze([
  "volume_db",
  "muted",
  "locked",
  "loop_source",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS = deepFreeze([
  "pan",
  "active_take",
  "move_to_track",
  "take_name",
  "take_volume_db",
  "take_pan",
  "pitch_semitones",
  "reverse",
  "invert_phase",
  "channel_mode",
  "pitch_shift_mode",
]);
export const ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS = deepFreeze([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.list_selected_items",
  "template.items.set_exact_selection",
  "template.items.move_item",
  "template.items.set_item_volume",
  "template.items.set_item_take_controls_batch",
  "template.items.set_take_volume",
  "template.items.set_take_pan",
  "template.items.set_take_pitch",
  "template.items.set_mute",
  "template.items.set_lock",
  "template.items.set_loop_source",
  "template.items.set_active_take",
  "template.items.set_item_fades",
  "template.items.trim_item",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
  "template.tracks.resolve_track_ref",
  "template.items.move_item_to_track",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
  "template.items.split_item_by_silence",
  "template.items.list_items_on_track",
  "template.items.copy_item_to_track",
  "template.items.set_take_start_in_source",
]);

const RESOLVE_ITEM_ID = "template.items.resolve_item_ref";
const READ_ITEM_ID = "template.items.read_item_summary";
const LIST_SELECTED_ID = "template.items.list_selected_items";
const SET_EXACT_SELECTION_ID = "template.items.set_exact_selection";
const MOVE_ITEM_ID = "template.items.move_item";
const SET_ACTIVE_TAKE_ID = "template.items.set_active_take";
const SET_ITEM_VOLUME_ID = "template.items.set_item_volume";
const SET_ITEM_TAKE_CONTROLS_BATCH_ID = "template.items.set_item_take_controls_batch";
const SET_TAKE_VOLUME_ID = "template.items.set_take_volume";
const SET_TAKE_PAN_ID = "template.items.set_take_pan";
const SET_TAKE_PITCH_ID = "template.items.set_take_pitch";
const SET_ITEM_FADES_ID = "template.items.set_item_fades";
const TRIM_ITEM_ID = "template.items.trim_item";
const SET_TAKE_PLAYRATE_ID = "template.items.set_take_playrate";
const SET_ITEM_SNAP_OFFSET_ID = "template.items.set_item_snap_offset";
const RESOLVE_TRACK_ID = "template.tracks.resolve_track_ref";
const MOVE_ITEM_TO_TRACK_ID = "template.items.move_item_to_track";
const DETECT_SILENCE_ID = "template.analysis.detect_item_silence";
const DETECT_TRANSIENTS_ID = "template.analysis.detect_item_transients";
const SPLIT_BY_SILENCE_ID = "template.items.split_item_by_silence";
const LIST_TRACK_ITEMS_ID = "template.items.list_items_on_track";
const COPY_ITEM_TO_TRACK_ID = "template.items.copy_item_to_track";
const SET_TAKE_START_IN_SOURCE_ID = "template.items.set_take_start_in_source";
const MAX_TARGETS = 8;
const AUDIO_BATCH_MAX_TARGETS = 64;
const AUDIO_BATCH_RELEASE_GATE_MS = 30000;
const DEFAULT_TARGET_LIMIT = 4;
const POSITION_TOLERANCE = 0.000001;
const MIN_RESPONSE_BUDGET = 2_048;
const INPUT_FIELDS = new Set([
  "mode",
  "target",
  "target_refs",
  "selection_mode",
  "adjacent_audio",
  "limit",
  "dry_run",
  "anchor_seconds",
  "gap_seconds",
  "properties",
  "active_take_assignments",
  "track_assignments",
  "fade_in_seconds",
  "fade_out_seconds",
  "length_seconds",
  "playrate",
  "preserve_pitch",
  "snap_offset_seconds",
  "silence_threshold_dbfs",
  "min_silence_ms",
  "silence_scope",
  "keep_before_ms",
  "keep_after_ms",
  "min_kept_audio_ms",
  "fade_ms",
  "normalization_metric",
  "normalization_target",
  "transient_delta_linear",
  "min_transient_gap_ms",
]);
const PROPERTY_DEFINITIONS = deepFreeze({
  volume_db: { template_id: "template.items.set_item_volume", input_field: "volume_db", type: "number", min: -120, max: 24 },
  muted: { template_id: "template.items.set_mute", input_field: "muted", type: "boolean" },
  locked: { template_id: "template.items.set_lock", input_field: "locked", type: "boolean" },
  loop_source: { template_id: "template.items.set_loop_source", input_field: "loop_source", type: "boolean" },
});
const CHILD_BUDGET = deepFreeze({
  max_response_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
  max_items: 128,
  max_inline_value_bytes: MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes,
});

const REGISTRY_ENTRY = deepFreeze({
  contract: MACRO_PROGRAM_REGISTRY_CONTRACT,
  macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  program_id: "openreaper.macro.items.apply",
  program_version: "1.7.0",
  implementation_status: "executable",
  risk: "destructive",
  input_schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      mode: { type: "string", enum: ALPHA3_3_B1C_ITEMS_APPLY_MODES },
      target: { type: "string", enum: ["selected", "exact"] },
      target_refs: { type: "array", maxItems: AUDIO_BATCH_MAX_TARGETS, items: { type: "string" } },
      selection_mode: { type: "string", enum: ["replace", "add", "remove"] },
      adjacent_audio: { type: "string", enum: ["left", "right", "both"] },
      changes: {
        type: "array",
        minItems: 1,
        maxItems: ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 12 },
            item_ref: { type: "string" },
            take_ref: { type: "string" },
            item: {
              type: "object",
              additionalProperties: false,
              properties: {
                volume_db: { type: "number", minimum: -120, maximum: 24 },
                length_seconds: { type: "number", exclusiveMinimum: 0 },
                fade_in_seconds: { type: "number", minimum: 0 },
                fade_out_seconds: { type: "number", minimum: 0 },
                snap_offset_seconds: { type: "number", minimum: 0 },
              },
            },
            take: {
              type: "object",
              additionalProperties: false,
              properties: {
                volume_db: { type: "number", minimum: -120, maximum: 24 },
                pan: { type: "number", minimum: -1, maximum: 1 },
                pitch_semitones: { type: "number" },
                playrate: { type: "number", exclusiveMinimum: 0, maximum: 16 },
                preserve_pitch: { type: "boolean" },
              },
            },
          },
          required: ["id", "item_ref"],
        },
      },
      variations: {
        type: "array",
        minItems: 1,
        maxItems: ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            id: { type: "string", minLength: 1, maxLength: 12 },
            source_item_ref: { type: "string" },
            target_track_ref: { type: "string" },
            position_seconds: { type: "number", minimum: 0 },
            source_offset_seconds: { type: "number", minimum: 0 },
          },
          required: ["id", "source_item_ref", "target_track_ref", "position_seconds"],
        },
      },
      limit: { type: "integer", minimum: 1, maximum: AUDIO_BATCH_MAX_TARGETS },
      dry_run: { type: "boolean" },
      anchor_seconds: { type: "number", minimum: 0 },
      gap_seconds: { type: "number", minimum: 0 },
      properties: {
        type: "object",
        additionalProperties: false,
        minProperties: 1,
        properties: {
          volume_db: { type: "number", minimum: -120, maximum: 24 },
          muted: { type: "boolean" },
          locked: { type: "boolean" },
          loop_source: { type: "boolean" },
        },
      },
      active_take_assignments: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TARGETS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_ref: { type: "string" },
            take_ref: { type: "string" },
          },
          required: ["item_ref", "take_ref"],
        },
      },
      track_assignments: {
        type: "array",
        minItems: 1,
        maxItems: MAX_TARGETS,
        items: {
          type: "object",
          additionalProperties: false,
          properties: {
            item_ref: { type: "string" },
            target_track_ref: { type: "string" },
          },
          required: ["item_ref", "target_track_ref"],
        },
      },
      fade_in_seconds: { type: ["number", "null"], minimum: 0 },
      fade_out_seconds: { type: ["number", "null"], minimum: 0 },
      length_seconds: { type: "number", exclusiveMinimum: 0 },
      playrate: { type: "number", exclusiveMinimum: 0, maximum: 16 },
      preserve_pitch: { type: "boolean" },
      snap_offset_seconds: { type: "number", minimum: 0 },
      silence_threshold_dbfs: { type: "number", minimum: -150, maximum: 0, default: -60 },
      min_silence_ms: { type: "number", minimum: 1, maximum: 60000, default: 250 },
      silence_scope: { type: "string", enum: ["all", "leading", "trailing", "edges", "internal"], default: "all" },
      keep_before_ms: { type: "number", minimum: 0, maximum: 5000, default: 20 },
      keep_after_ms: { type: "number", minimum: 0, maximum: 5000, default: 20 },
      min_kept_audio_ms: { type: "number", minimum: 0, maximum: 60000, default: 80 },
      fade_ms: { type: "number", minimum: 0, maximum: 1000, default: 5 },
      normalization_metric: { type: "string", enum: ["lufs_i", "rms_i", "peak", "true_peak", "lufs_m_max", "lufs_s_max"] },
      normalization_target: { type: "number", maximum: 0 },
      transient_delta_linear: { type: "number", exclusiveMinimum: 0, maximum: 1024 },
      min_transient_gap_ms: { type: "number", minimum: 0, maximum: 60000 },
    },
    required: ["mode"],
  },
  selector_policy: {
    task_shaped: true,
    canonical_refs_optional_at_public_boundary: true,
    live_reresolve_before_write: true,
  },
  sqlite_policy: {
    mode: "invalidate_after_write",
    write_authority: false,
    identity_fields: ["item_ref", "take_ref"],
  },
  dependencies: {
    template_ids: ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
    runtime_capabilities: [],
  },
  stages: [
    { id: "items-apply-targets", kind: "live_ref_resolve", risk: "read", stop_on_error: true },
    { id: "items-apply-preflight", kind: "template_execute", risk: "read", stop_on_error: true, dependency_ref: READ_ITEM_ID },
    { id: "items-apply-mutate", kind: "template_execute", risk: "write", stop_on_error: true, dependency_ref: MOVE_ITEM_ID },
    { id: "items-apply-verify", kind: "verify", risk: "read", stop_on_error: true },
    { id: "items-apply-index", kind: "index_update", risk: "write", stop_on_error: true },
    { id: "items-apply-result", kind: "result_project", risk: "read", stop_on_error: true },
  ],
  undo_policy: "per_stage_undo",
  verification_policy: "required",
  dry_run_supported: true,
  result_budget: { max_bytes: MACRO_CONTRACT_CEILINGS.envelope_max_bytes },
});

const REGISTERED_STAGE_IDS = new Set(REGISTRY_ENTRY.stages.map((stage) => stage.id));

export function createAlpha3_3B1cItemsApplyRegistry(options = {}) {
  return createMacroProgramRegistry([REGISTRY_ENTRY], {
    acceptedTemplateIds: options.acceptedTemplateIds ?? ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
    acceptedRuntimeCapabilities: options.acceptedRuntimeCapabilities ?? [],
    registeredStageIds: options.registeredStageIds ?? REGISTERED_STAGE_IDS,
  });
}

export const ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY = createAlpha3_3B1cItemsApplyRegistry();

export function isAlpha3_3B1cItemsApplyMacroId(id) {
  return id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID;
}

export function createAlpha3_3B1cItemsApplyDiscoveryItems({ liveRunnableNow = false } = {}) {
  return deepFreeze([{
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    title: "Arrange Items, remove silence, align onsets, and apply exact Item changes",
    user_label: "Apply Item changes",
    pack: "core",
    lifecycle: "experimental",
    risk: "destructive",
    entity_kind: "macro.items.apply",
    action_kind: "macro",
    kind: "official_macro",
    macro_kind: "items_apply",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    implementation_status: "executable",
    support_status: "executable",
    support_state: "supported_with_live_readback",
    live_runnable_now: liveRunnableNow,
    known_blocker: liveRunnableNow ? null : "macro_fixed_dependencies_not_available",
    summary: "Arrange selected or exact Items, remove silence, align audio onsets, move exact Items onto existing Tracks, create bounded Item variations, set accepted properties, choose exact Active Takes, apply bounded fades/trims/Take playback/snap offsets, or batch Item and Active-Take controls.",
    inputSchema: clone(REGISTRY_ENTRY.input_schema),
    supported_modes: ALPHA3_3_B1C_ITEMS_APPLY_MODES,
    held_modes: ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES,
    supported_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS,
    held_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS,
    examples: [
      { name: "sequence_selected_items", input: { mode: "sequence_with_gap", target: "selected", gap_seconds: 0.1, dry_run: true } },
      { name: "select_exact_items", input: { mode: "select_exact", selection_mode: "replace", target_refs: ["item:guid:{ITEM-GUID}"], dry_run: false } },
      { name: "mute_exact_items", input: { mode: "set_properties", target_refs: ["item:guid:{ITEM-GUID}"], properties: { muted: true }, dry_run: false } },
      { name: "choose_exact_active_take", input: { mode: "set_active_take", active_take_assignments: [{ item_ref: "item:guid:{ITEM-GUID}", take_ref: "take:guid:{TAKE-GUID}" }], dry_run: false } },
      { name: "stack_on_existing_tracks", input: { mode: "stack_on_existing_tracks", track_assignments: [{ item_ref: "item:guid:{ITEM-GUID}", target_track_ref: "track:guid:{TRACK-GUID}" }], dry_run: false } },
      { name: "fade_exact_items", input: { mode: "apply_fades", target_refs: ["item:guid:{ITEM-GUID}"], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false } },
      { name: "set_take_playback", input: { mode: "set_take_playback", target_refs: ["item:guid:{ITEM-GUID}"], playrate: 1.25, preserve_pitch: true, dry_run: false } },
      { name: "remove_silence", input: { mode: "remove_silence", target_refs: ["item:guid:{ITEM-GUID}"], silence_threshold_dbfs: -60, min_silence_ms: 250, silence_scope: "all", dry_run: false } },
      { name: "normalize_level", input: { mode: "normalize_level", target: "exact", target_refs: ["item:guid:{ITEM-GUID}"], normalization_metric: "lufs_i", normalization_target: -18, dry_run: false } },
      { name: "align_audio_onsets", input: { mode: "align_onsets", target_refs: ["item:guid:{ITEM-A}", "item:guid:{ITEM-B}"], dry_run: false } },
      {
        name: "batch_item_take_controls",
        input: {
          mode: "set_item_take_controls",
          dry_run: false,
          changes: [{
            id: "row1",
            item_ref: "item:guid:{ITEM-GUID}",
            take_ref: "take:guid:{TAKE-GUID}",
            item: { volume_db: -3, length_seconds: 2 },
            take: { volume_db: -6, pan: 0.25, pitch_semitones: 1, playrate: 1.1, preserve_pitch: true },
          }],
        },
      },
      {
        name: "create_item_variations",
        input: {
          mode: "create_variations",
          dry_run: false,
          variations: [{ id: "var1", source_item_ref: "item:guid:{SOURCE-GUID}", target_track_ref: "track:guid:{TARGET-GUID}", position_seconds: 8, source_offset_seconds: 0.1 }],
        },
      },
    ],
  }]);
}

export function createAlpha3_3B1cItemsApplyExactManual() {
  return deepFreeze({
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    rollout_slice: "Alpha3.3-B1c",
    action_manual: {
      when_to_use: [
        "Use one fixed arrangement mode for selected or exact Items, with dry_run first when the calculated positions should be inspected.",
        "Use set_properties for Item-level volume_db, muted, locked, or loop_source only.",
        "Use set_active_take with one to eight explicit item_ref/take_ref assignment rows; each exact Take is applied only to its paired exact Item.",
        "Use stack_on_existing_tracks with one to eight explicit item_ref/target_track_ref rows; every destination must already exist.",
        "Use apply_fades, trim_exact, set_take_playback, set_snap_offset, remove_silence, or align_onsets for bounded common edits backed by accepted native Item/Take atoms.",
        "Use set_item_take_controls for one-call multi-Item multi-field Item/Active-Take control rows with exact item_ref and take_ref when Take fields are present; Item pan remains unsupported.",
        "Use create_variations to copy 1-64 exact source Items onto existing exact Tracks at explicit positions, preserving and proving each active-Take FX chain and optionally setting a source offset per new variation.",
      ],
      when_not_to_use: [
        "Do not reinterpret trim_exact as silence analysis, or apply_fades as crossfade construction; normalization, arbitrary transient splitting, and crossfades remain held.",
        "stack_on_existing_tracks never creates Tracks or folders; use macro.project.apply_layout first when the destination layout does not exist.",
        "Do not request Take fields through set_properties; use set_active_take or set_take_playback so each mode keeps a bounded schema and readback contract.",
        "Do not request pan as an Item-level field: no REAPER Item-level pan control is proven here, and macro.items.apply will not silently redirect it to the current Active Take.",
      ],
      required_readiness: [
        "The managed OpenReaper live bridge and every fixed Template dependency must be connected.",
        "Select at most eight Items, or provide at most eight exact canonical Item refs.",
      ],
      input_shape: {
        mode: ALPHA3_3_B1C_ITEMS_APPLY_MODES.join(" | "),
        target: "selected; used by arrangement/property modes when target_refs or exact request refs are absent. Forbidden for set_active_take, set_item_take_controls, and create_variations.",
        target_refs: "Optional array of at most eight exact canonical item:guid refs for arrangement/property modes. Forbidden for set_active_take, set_item_take_controls, and create_variations.",
        changes: "For set_item_take_controls only: 1-64 rows of {id,item_ref,take_ref?,item?,take?}. id is 1-12 ASCII [A-Za-z0-9_-]. take_ref is required exactly when take fields are present. Item fields: volume_db,length_seconds,fade_in_seconds,fade_out_seconds,snap_offset_seconds. Take fields: volume_db,pan,pitch_semitones,playrate,preserve_pitch. Item pan remains unsupported.",
        variations: "For create_variations only: 1-64 rows of {id,source_item_ref,target_track_ref,position_seconds,source_offset_seconds?}. Every ref must be an exact canonical GUID ref. All source Items and destination Tracks resolve before the first copy; each result returns the new exact Item/Take refs plus take_fx_copy.slots[].target_fx_ref after complete active-Take FX copy/readback.",
        dry_run: "Defaults to true. false is required to mutate REAPER.",
        anchor_seconds: "Non-negative project time; required by move_to_anchor and optional for other arrangement modes.",
        gap_seconds: "Non-negative gap for sequence_with_gap; defaults to 0.",
        properties: "For set_properties only: one or more of volume_db, muted, locked, loop_source. pan is held and fails closed.",
        active_take_assignments: "For set_active_take only: 1-8 rows shaped {item_ref:'item:guid:{GUID}', take_ref:'take:guid:{GUID}'}. Selection and unpaired refs are forbidden.",
        track_assignments: "For stack_on_existing_tracks only: 1-8 rows shaped {item_ref:'item:guid:{GUID}', target_track_ref:'track:guid:{GUID}'}. Selection and implicit Track creation are forbidden.",
        fades: "apply_fades accepts fade_in_seconds and/or fade_out_seconds as null or non-negative seconds; an omitted/null side clears to zero.",
        trim: "trim_exact requires positive length_seconds and does not analyze silence or change source media on disk.",
        take_playback: "set_take_playback requires positive playrate (max 16) plus explicit preserve_pitch and an existing Active Take.",
        snap_offset: "set_snap_offset requires a non-negative item-local snap_offset_seconds no greater than the current Item length.",
        remove_silence: "remove_silence accepts optional silence_threshold_dbfs (-150..0, default -60) and min_silence_ms (0..60000, default 50), scans the complete Item up to 600 seconds, then deletes only silent Item fragments.",
        align_onsets: "align_onsets accepts optional anchor_seconds; otherwise the earliest detected project-time onset is the anchor. Optional transient_delta_linear and min_transient_gap_ms tune the native pre-FX detector.",
      },
      preflight_steps: [
        "Reject unknown fields, held modes, held property fields, ambiguous target coverage, and impossible response budgets before mutation.",
        "Resolve every target live, read exact Item position/length/Active Take facts, then calculate the full deterministic operation list.",
        "For set_active_take, preserve each explicit Item/Take pair. The atom validates live Take ownership before SetActiveTake; the Macro never infers a Take from selection.",
        "For stack_on_existing_tracks, resolve both sides live, preserve every explicit Item/Track pair, and refuse missing or duplicate destinations before any move.",
        "For remove_silence and align_onsets, require complete native audio-analysis range/channel/row coverage and at least one non-silent or transient result before any mutation.",
      ],
      underlying_actions: ALPHA3_3_B1C_ITEMS_APPLY_TEMPLATE_IDS,
      readback_steps: [
        "Arrangement modes read every exact Item summary after all moves and compare the requested position row by row.",
        "Property/fade/trim/Take-playback/snap modes require the accepted atomic Template to return the exact Item ref and every live REAPER field value that it just read back.",
        "set_active_take marks a row applied only when the atom returns the paired exact item_ref, requested active_take_ref, and passed native GetActiveTake readback.",
        "stack_on_existing_tracks marks a row applied only when the atom returns the exact Item and target Track plus passed identity/take/Track-count readback.",
        "remove_silence marks a row applied only after the destructive atom proves kept GUIDs present, deleted GUIDs absent, duration conservation, and Track Item count; the Macro then reads every kept Item and independently checks the live Track Item count.",
        "align_onsets re-runs native transient detection after every move and marks a row applied only when position + first_transient_time matches the requested project-time anchor.",
        "create_variations verifies each copy result including the complete active-Take FX chain, optional source-offset atom readback, then the new Item's exact Item summary for Item, Track, Take, and position identity.",
        "Index invalidation is reported separately and never changes an already verified mutation into an unverified applied claim.",
      ],
      success_criteria: [
        "A change is status=applied only when its own live_readback.status=passed.",
        "Mutation, live readback, and Project Index maintenance have separate result statuses.",
        "SQLite is never used as write authority; source media is never deleted.",
      ],
      common_blockers: [
        blocker("ITEM_APPLY_MODE_HELD", "The requested mode is outside the executable B1c allowlist."),
        blocker("ITEM_APPLY_ITEM_PAN_UNSUPPORTED", "Item-level pan is not a proven REAPER field and is never redirected to an Active Take."),
        blocker("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take requires 1-8 unique exact Item/Take assignment rows and never uses selection."),
        blocker("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", "stack_on_existing_tracks requires 1-8 unique exact Item/existing-Track assignment rows and never creates Tracks."),
        blocker("ITEM_APPLY_ACTIVE_TAKE_REQUIRED", "set_take_playback requires an existing exact Active Take and does not choose one implicitly."),
        blocker("ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM", "The requested item-local snap offset exceeds the live Item length."),
        blocker("ITEM_APPLY_TARGET_COVERAGE_INCOMPLETE", "The selected target set exceeds the bounded write limit and was not partially mutated."),
        blocker("ITEM_APPLY_READBACK_MISMATCH", "A row-level live value did not match the requested value."),
        blocker("ITEM_APPLY_ANALYSIS_COVERAGE_INCOMPLETE", "Silence/transient analysis did not cover the complete Item and all result rows before mutation."),
        blocker("ITEM_APPLY_ALL_SILENT_BLOCKED", "remove_silence refuses to delete an Item whose complete analyzed duration is silent."),
        blocker("ITEM_APPLY_TRANSIENT_REQUIRED", "align_onsets requires at least one transient on every target Item."),
        blocker("ITEM_APPLY_RESPONSE_BUDGET_EXCEEDED", "The compact per-change result cannot fit the active response budget before mutation."),
      ],
      recovery_steps: [
        "Use the reported per-stage REAPER undo entries for completed mutations, fix the typed blocker, then retry only the remaining bounded task.",
        "If the user explicitly wants Active Take pan, first confirm the current Active Take, then use macro.controls.set with target_kind=take or the reviewed template.items.set_take_pan; never silently change the current Take on a multi-Take Item.",
        "For held behavior, wait for its accepted Template lifecycle rather than injecting steps, raw Actions, Lua, or shell workarounds.",
      ],
      dry_run_shape: {
        supported: true,
        behavior: "Resolves and reads live targets, calculates the exact fixed operation list, and performs no mutation or index invalidation.",
        output: ["calculated_positions_properties_or_active_takes", "per_target_preview", "undo_policy", "typed_blockers"],
      },
      resume_or_retry_policy: {
        resume_from: "live target resolution; no stale SQLite identity is reused for writes",
        retry: "Retry once after correcting the typed target, budget, readiness, or readback blocker.",
        hard_stop: "Stop after the same typed blocker repeats twice.",
      },
      examples: [
        { name: "align starts", input: { mode: "align_starts", target: "selected", dry_run: false } },
        { name: "move group", input: { mode: "move_to_anchor", target_refs: ["item:guid:{A}", "item:guid:{B}"], anchor_seconds: 12, dry_run: true } },
        { name: "set Item properties", input: { mode: "set_properties", target: "selected", properties: { volume_db: -3, muted: false }, dry_run: false } },
        { name: "set Active Takes", input: { mode: "set_active_take", active_take_assignments: [{ item_ref: "item:guid:{ITEM-A}", take_ref: "take:guid:{TAKE-A2}" }], dry_run: false } },
        { name: "stack on existing Tracks", input: { mode: "stack_on_existing_tracks", track_assignments: [{ item_ref: "item:guid:{ITEM-A}", target_track_ref: "track:guid:{TRACK-B}" }], dry_run: false } },
        { name: "set Item fades", input: { mode: "apply_fades", target_refs: ["item:guid:{A}"], fade_in_seconds: 0.02, fade_out_seconds: 0.08, dry_run: false } },
        { name: "trim exact visible length", input: { mode: "trim_exact", target_refs: ["item:guid:{A}"], length_seconds: 1.25, dry_run: false } },
        { name: "set Active Take playback", input: { mode: "set_take_playback", target_refs: ["item:guid:{A}"], playrate: 1.25, preserve_pitch: true, dry_run: false } },
        { name: "set Item snap offset", input: { mode: "set_snap_offset", target_refs: ["item:guid:{A}"], snap_offset_seconds: 0.05, dry_run: false } },
        {
          name: "batch Item and Active-Take controls",
          input: {
            mode: "set_item_take_controls",
            dry_run: false,
            changes: [{
              id: "clipA",
              item_ref: "item:guid:{ITEM-A}",
              take_ref: "take:guid:{TAKE-A}",
              item: { volume_db: -3, fade_in_seconds: 0.01, fade_out_seconds: 0.05 },
              take: { pan: -0.2, pitch_semitones: 0, playrate: 1, preserve_pitch: true },
            }],
          },
        },
        { name: "create exact variations", input: { mode: "create_variations", dry_run: false, variations: [{ id: "varA", source_item_ref: "item:guid:{SOURCE-A}", target_track_ref: "track:guid:{TARGET-A}", position_seconds: 12, source_offset_seconds: 0.15 }] } },
      ],
    },
  });
}

export async function executeAlpha3_3B1cItemsApplyMacro({
  request = {},
  executeAtomic,
  projectIndexRuntime,
  artifactWriter = null,
  now = () => new Date(),
  monoNow = () => performance.now(),
} = {}) {
  const entry = ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY.get(ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID);
  const startedAt = safeNowIso(now);
  const stages = [];
  const state = createState();
  const activeBudget = responseBudget(request);
  if (isPlainObject(request.input) && request.input.mode === "set_item_take_controls") {
    return executeSetItemTakeControlsBatch({
      entry,
      request,
      executeAtomic,
      projectIndexRuntime,
      artifactWriter,
      now,
      monoNow,
      startedAt,
      stages,
      state,
      activeBudget,
    });
  }
  if (isPlainObject(request.input) && request.input.mode === "create_variations") {
    return executeCreateVariationsBatch({
      entry,
      request,
      executeAtomic,
      projectIndexRuntime,
      now,
      monoNow,
      startedAt,
      stages,
      state,
      activeBudget,
    });
  }
  const normalized = normalizeInput(request.input);
  if (!normalized.ok) {
    if (normalized.zero_write === true && isAudioBatchMode(request.input?.mode)) {
      state.batchMode = true;
      state.targetScope = request.input.target === "exact" || (Array.isArray(request.input.target_refs) && request.input.target_refs.length > 0)
        ? "exact"
        : "selected";
      state.totalTargetCount = 0;
      state.returnedTargetCount = 0;
      return failureEnvelope({
        entry,
        request,
        startedAt,
        now,
        stages,
        state,
        activeBudget,
        code: normalized.code,
        message: normalized.message,
        blockers: normalized.blockers,
        data: audioBatchData(request.input, state, { zero_write: true }),
      });
    }
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: normalized.code, message: normalized.message, blockers: normalized.blockers });
  }

  const programRequest = {
    macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input: normalized.input,
    refs: request.refs ?? {},
    dry_run: normalized.input.dry_run,
  };
  const validation = validateMacroProgramRequest(programRequest, { registry: ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_REQUEST_INVALID", message, blockers: validation.errors.map((error) => blocker("ITEM_APPLY_REQUEST_INVALID", error)) });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_LIVE_EXECUTOR_REQUIRED", message: "macro.items.apply requires the managed OpenReaper live executor." });
  }

  if (normalized.input.mode === "select_exact") {
    return executeExactSelectionMacro({
      entry,
      request,
      executeAtomic,
      now,
      startedAt,
      stages,
      state,
      activeBudget,
      input: normalized.input,
    });
  }

  if (["remove_silence", "normalize_level"].includes(normalized.input.mode)) {
    return executeAudioBatchMacro({
      entry,
      request,
      executeAtomic,
      projectIndexRuntime,
      now,
      monoNow,
      startedAt,
      stages,
      state,
      activeBudget,
      input: normalized.input,
    });
  }

  const targets = await resolveTargets({ request, input: normalized.input, executeAtomic, state });
  if (!targets.ok) {
    pushStage(stages, "items-apply-targets", "live_ref_resolve", "blocked", targets.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: targets.code, message: targets.message, blockers: targets.blockers, data: targetData(state) });
  }
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Resolved ${targets.refs.length} exact live Item target(s).`, state.evidenceRefs);

  const facts = await readTargetFacts({ targets: targets.refs, assignments: targets.assignments, input: normalized.input, request, executeAtomic, state });
  if (!facts.ok) {
    pushStage(stages, "items-apply-preflight", "template_execute", "failed", facts.message, state.evidenceRefs);
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: facts.code, message: facts.message, blockers: facts.blockers, data: targetData(state) });
  }
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", `Read exact position and length facts for ${facts.rows.length} Item(s).`, state.evidenceRefs);

  const plan = buildOperationPlan(normalized.input, facts.rows);
  if (!plan.ok) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: plan.code, message: plan.message, blockers: plan.blockers, data: targetData(state) });
  }
  state.operations = plan.operations;
  const budgetBlocker = responseBudgetBlocker({ entry, request, input: normalized.input, stages, state, activeBudget });
  if (budgetBlocker) {
    return failureEnvelope({ entry, request, startedAt, now, stages: [], state: createState(), activeBudget, code: budgetBlocker.code, message: budgetBlocker.message, blockers: [budgetBlocker], data: { required_bytes: budgetBlocker.required_bytes, available_bytes: activeBudget } });
  }

  if (normalized.input.dry_run) {
    state.changes = plan.operations.map(previewChange);
    pushStage(stages, "items-apply-mutate", "template_execute", "skipped", "dry_run=true; no Item mutation was dispatched.", []);
    pushStage(stages, "items-apply-verify", "verify", "completed", "Validated the complete deterministic operation preview against live Item facts.", state.evidenceRefs);
    pushStage(stages, "items-apply-index", "index_update", "skipped", "Dry run did not stale the Project Index.", []);
    pushStage(stages, "items-apply-result", "result_project", "completed", "Projected the bounded Item operation preview.", state.evidenceRefs);
    return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "dry_run_completed", summary: `Previewed ${plan.operations.length} fixed Item operation(s) with no mutation.`, data: resultData(normalized.input, state) });
  }

  let executionFailure = null;
  if (normalized.input.mode === "remove_silence") {
    executionFailure = await executeRemoveSilencePlan({ plan, request, executeAtomic, state });
  } else if (["set_properties", "set_active_take", "stack_on_existing_tracks"].includes(normalized.input.mode)) {
    executionFailure = await executePropertyPlan({ plan, request, executeAtomic, state });
  } else if (["apply_fades", "trim_exact", "set_take_playback", "set_snap_offset"].includes(normalized.input.mode)) {
    executionFailure = await executePropertyPlan({ plan, request, executeAtomic, state });
  } else {
    executionFailure = await executeArrangementPlan({ plan, request, executeAtomic, state });
  }
  pushStage(
    stages,
    "items-apply-mutate",
    "template_execute",
    executionFailure?.phase === "mutation" ? "failed" : "completed",
    `${state.changes.filter((change) => change.mutation.status === "completed").length} of ${plan.operations.length} fixed mutation row(s) completed.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "items-apply-verify",
    "verify",
    executionFailure?.phase === "readback" ? "failed" : executionFailure?.phase === "mutation" ? "skipped" : "completed",
    `${state.changes.filter((change) => change.live_readback.status === "passed").length} row(s) passed exact live readback.`,
    state.evidenceRefs,
  );

  const indexResult = maintainProjectIndex(projectIndexRuntime, state, now);
  pushStage(stages, "items-apply-index", "index_update", indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);
  applyIndexMaintenance(state.changes, indexResult);

  if (executionFailure) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      status: state.changes.some((change) => change.mutation.status === "completed") ? "partial_failure" : "failed",
      code: executionFailure.code,
      message: executionFailure.message,
      blockers: executionFailure.blockers,
      data: resultData(normalized.input, state),
    });
  }
  if (indexResult.ok === false) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      status: "partial_failure",
      code: indexResult.code,
      message: indexResult.message,
      blockers: indexResult.blockers,
      data: resultData(normalized.input, state),
    });
  }

  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected per-row mutation, live readback, and index-maintenance truth.", state.evidenceRefs);
  return successEnvelope({
    entry,
    request,
    startedAt,
    now,
    stages,
    state,
    activeBudget,
    status: "completed",
    summary: `Applied and verified ${state.changes.length} Item change row(s).`,
    data: resultData(normalized.input, state),
  });
}

async function executeSetItemTakeControlsBatchNative({
  entry,
  request,
  executeAtomic,
  projectIndexRuntime,
  now,
  monoNow = () => performance.now(),
  startedAt,
  stages,
  state,
  activeBudget,
  normalized,
}) {
  const t0 = monoTick(monoNow);
  const dryRun = normalized.input.dry_run;
  const batchInput = {
    batch: normalized.input.changes,
    dry_run: dryRun,
  };
  state.batchMode = true;
  state.calls = emptyCalls();
  state.timings = emptyTimings();
  state.nativeBatch = null;

  let execution;
  try {
    execution = await runAtomicCounted(executeAtomic, request, state, "mutation", {
      id: SET_ITEM_TAKE_CONTROLS_BATCH_ID,
      input: batchInput,
      refs: {},
    });
  } catch (error) {
    state.timings.total_ms = monoElapsed(t0, monoNow);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_ATOMIC_FAILED",
      message: error?.message ?? "Native Item/Take controls batch failed.",
      blockers: [blocker("ITEM_APPLY_ATOMIC_FAILED", error?.message ?? "Native Item/Take controls batch failed.")],
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }
  collectExecutionEvidence(state, execution);

  const summary = executionSummary(execution);
  const batchTimings = plainObject(summary.batch_timings ?? summary.timings);
  const nativeCounters = plainObject(summary.native_counters ?? summary.counters);
  state.nativeBatch = {
    batch_timings: batchTimings,
    native_counters: nativeCounters,
    transport_call_count: 1,
  };
  state.timings = {
    target_resolution_ms: finiteOrZero(batchTimings.target_resolution_ms ?? batchTimings.preflight_ms),
    preflight_ms: finiteOrZero(batchTimings.preflight_ms),
    mutation_ms: finiteOrZero(batchTimings.mutation_ms),
    final_readback_ms: finiteOrZero(batchTimings.readback_ms ?? batchTimings.final_readback_ms),
    index_maintenance_ms: 0,
    total_ms: finiteOrZero(batchTimings.total_ms) || monoElapsed(t0, monoNow),
  };

  if (execution?.ok !== true) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: execution?.error?.code ?? "ITEM_APPLY_ATOMIC_FAILED",
      message: execution?.error?.message ?? "Native Item/Take controls batch failed.",
      blockers: [blocker(
        execution?.error?.code ?? "ITEM_APPLY_ATOMIC_FAILED",
        execution?.error?.message ?? "Native Item/Take controls batch failed.",
        execution?.error?.recoverable !== false,
      )],
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }

  const returnedChanges = Array.isArray(summary.changes)
    ? summary.changes
    : Array.isArray(summary.rows) ? summary.rows : [];
  if (returnedChanges.length !== normalized.input.changes.length) {
    state.timings.total_ms = monoElapsed(t0, monoNow);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_BATCH_READBACK_INVALID",
      message: `Native Item/Take controls batch returned ${returnedChanges.length} row(s) for ${normalized.input.changes.length} requested row(s).`,
      blockers: [blocker("ITEM_APPLY_BATCH_READBACK_INVALID", "Native Item/Take controls batch did not return one truth row per request row.")],
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }

  state.changes = normalized.input.changes.map((row, index) => normalizeNativeBatchChange(
    row,
    returnedChanges[index],
    dryRun,
  ));
  state.canonicalRefs = state.changes.flatMap((change) => [change.item_ref, change.take_ref]);
  const indexStarted = monoTick(monoNow);
  const indexResult = maintainBatchProjectIndex(projectIndexRuntime, state, now);
  state.timings.index_maintenance_ms = monoElapsed(indexStarted, monoNow);
  state.timings.total_ms = finiteOrZero(batchTimings.total_ms) || monoElapsed(t0, monoNow);
  applyBatchIndexMaintenance(state.changes, indexResult);

  const failedRow = state.changes.find((change) => !["applied", "planned"].includes(change.status));
  if (failedRow || indexResult.ok === false) {
    const code = failedRow?.code ?? indexResult.code ?? "ITEM_APPLY_BATCH_FAILED";
    const message = failedRow
      ? `Native Item/Take controls batch row ${failedRow.id} did not complete.`
      : indexResult.message;
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: state.changes.some((change) => change.mutation?.status === "completed") ? "partial_failure" : "failed",
      code,
      message,
      blockers: [blocker(code, message)],
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }

  pushStage(stages, "items-apply-mutate", "template_execute", "completed", `Native batch applied ${state.changes.length} Item/Take control row(s).`, state.evidenceRefs);
  pushStage(stages, "items-apply-verify", "verify", "completed", "Native batch returned aggregate live readback for every requested row.", state.evidenceRefs);
  pushStage(stages, "items-apply-index", "index_update", indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);
  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected native Item/Take batch truth.", state.evidenceRefs);
  return successEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: dryRun ? "dry_run_completed" : "completed",
    summary: dryRun
      ? `Previewed ${state.changes.length} Item/Take control row(s) with no mutation.`
      : `Applied and verified ${state.changes.length} Item/Take control row(s) in one native batch.`,
    data: compactBatchData(state, { dry_run: dryRun }),
    compact: activeBudget <= MIN_RESPONSE_BUDGET,
  });
}

function normalizeNativeBatchChange(requested, returned, dryRun) {
  const raw = isPlainObject(returned) ? returned : {};
  const mutation = typeof raw.mutation === "string" ? raw.mutation : raw.mutation?.status;
  const readback = typeof raw.live_readback === "string" ? raw.live_readback : raw.live_readback?.status ?? raw.readback?.status;
  return compactObject({
    ...batchRowChange(requested, {
      status: dryRun ? "planned" : raw.status ?? "applied",
      mutation: dryRun ? "not_run" : mutation ?? "completed",
      readback: dryRun ? "not_run" : readback ?? "passed",
      index: dryRun ? "skipped" : "pending",
      code: raw.code,
      fields: raw.fields,
    }),
    ...raw,
    id: raw.id ?? requested.id,
    item_ref: raw.item_ref ?? requested.item_ref,
    take_ref: raw.take_ref ?? requested.take_ref,
    item: raw.item ?? requested.item,
    take: raw.take ?? requested.take,
    status: dryRun ? "planned" : raw.status ?? "applied",
    mutation: dryRun ? { status: "not_run" } : typeof raw.mutation === "object" ? raw.mutation : { status: mutation ?? "completed" },
    live_readback: dryRun ? { status: "not_run" } : typeof raw.live_readback === "object" ? raw.live_readback : { status: readback ?? "passed" },
    index_maintenance: dryRun
      ? { status: "skipped", scopes: [] }
      : (raw.index_maintenance ?? { status: "pending", scopes: [] }),
  });
}

async function resolveTargets({ request, input, executeAtomic, state }) {
  if (input.mode === "set_active_take") {
    return resolveActiveTakeAssignments({ request, assignments: input.active_take_assignments, executeAtomic, state });
  }
  if (input.mode === "stack_on_existing_tracks") {
    return resolveTrackAssignments({ request, assignments: input.track_assignments, executeAtomic, state });
  }
  const directRefs = collectItemObjectRefs(request.refs);
  const tokens = input.target_refs;
  const exactTargetCount = directRefs.length + tokens.length;
  const maxTargets = maxTargetsForMode(input.mode);
  const effectiveLimit = request.input?.limit === undefined && exactTargetCount > 0
    ? Math.min(maxTargets, exactTargetCount)
    : input.limit;
  if (exactTargetCount > effectiveLimit || exactTargetCount > maxTargets) {
    return failed("ITEM_APPLY_TARGET_LIMIT_EXCEEDED", `Exact Item targets exceed the bounded write limit of ${effectiveLimit}.`);
  }

  const candidates = directRefs.map((ref) => ({ ref, expected_ref: ref.ref }));
  for (const token of tokens) candidates.push({ token, expected_ref: canonicalTokenRef(token) });
  if (candidates.length === 0) {
    const execution = await runAtomic(executeAtomic, request, { id: LIST_SELECTED_ID, input: { limit: effectiveLimit, include_track_refs: true }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, LIST_SELECTED_ID);
    const summary = executionSummary(execution);
    state.targetScope = "selected";
    state.totalTargetCount = integerOr(summary.selected_count, 0);
    state.targetsTruncated = summary.truncated === true || state.totalTargetCount > effectiveLimit;
    if (state.targetsTruncated) {
      return failed("ITEM_APPLY_TARGET_COVERAGE_INCOMPLETE", `Selected Item count ${state.totalTargetCount} exceeds the bounded write limit ${effectiveLimit}; no partial selection was mutated.`);
    }
    for (const ref of executionObjectRefs(execution).filter((entry) => entry.kind === "item")) {
      candidates.push({ ref, expected_ref: ref.ref });
    }
  } else {
    state.targetScope = directRefs.length > 0 && tokens.length > 0 ? "mixed_exact" : "exact";
    state.totalTargetCount = candidates.length;
    state.targetsTruncated = false;
  }

  if (candidates.length === 0) return failed("ITEM_APPLY_TARGETS_EMPTY", "No selected or exact Item target could be resolved.");
  const resolved = [];
  for (const candidate of candidates) {
    const token = candidate.ref?.ref ?? candidate.token;
    const execution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: token }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(execution).find((entry) => entry.kind === "item");
    if (!itemRef) return failed("ITEM_APPLY_TARGET_NOT_FOUND", `Item target ${token} did not resolve to a canonical Item ref.`);
    if (candidate.expected_ref && candidate.expected_ref !== itemRef.ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution changed identity from ${candidate.expected_ref} to ${itemRef.ref}; no mutation was run.`);
    }
    resolved.push(itemRef);
  }
  const uniqueRefs = uniqueObjectRefs(resolved);
  if (uniqueRefs.length !== resolved.length) return failed("ITEM_APPLY_TARGETS_DUPLICATED", "The target list resolves more than once to the same Item; remove duplicate refs before mutation.");
  state.returnedTargetCount = uniqueRefs.length;
  state.canonicalRefs.push(...uniqueRefs.map((ref) => ref.ref));
  return { ok: true, refs: uniqueRefs };
}

async function resolveActiveTakeAssignments({ request, assignments, executeAtomic, state }) {
  if (Object.keys(plainObject(request.refs)).length > 0) {
    return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take accepts only active_take_assignments rows; separate request refs cannot preserve explicit Item/Take pairing.");
  }
  state.targetScope = "exact_active_take_assignments";
  state.totalTargetCount = assignments.length;
  state.targetsTruncated = false;
  const resolved = [];
  for (const assignment of assignments) {
    const execution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: assignment.item_ref }, refs: [] });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(execution).find((entry) => entry.kind === "item");
    if (!itemRef) return failed("ITEM_APPLY_TARGET_NOT_FOUND", `Item target ${assignment.item_ref} did not resolve to a canonical Item ref.`);
    if (itemRef.ref !== assignment.item_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution changed identity from ${assignment.item_ref} to ${itemRef.ref}; no mutation was run.`);
    }
    resolved.push({ item_ref: itemRef, take_ref: exactGuidObjectRef("take", assignment.take_ref) });
  }
  state.returnedTargetCount = resolved.length;
  state.canonicalRefs.push(...resolved.flatMap((row) => [row.item_ref.ref, row.take_ref.ref]));
  return { ok: true, refs: resolved.map((row) => row.item_ref), assignments: resolved };
}

async function resolveTrackAssignments({ request, assignments, executeAtomic, state }) {
  if (Object.keys(plainObject(request.refs)).length > 0) {
    return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", "stack_on_existing_tracks accepts only track_assignments rows; separate request refs cannot preserve explicit Item/Track pairing.");
  }
  state.targetScope = "exact_item_track_assignments";
  state.totalTargetCount = assignments.length;
  state.targetsTruncated = false;
  const resolved = [];
  for (const assignment of assignments) {
    const itemExecution = await runAtomic(executeAtomic, request, { id: RESOLVE_ITEM_ID, input: { ref: assignment.item_ref }, refs: [] });
    collectExecutionEvidence(state, itemExecution);
    if (itemExecution?.ok !== true) return atomicFailure(itemExecution, RESOLVE_ITEM_ID);
    const itemRef = executionObjectRefs(itemExecution).find((entry) => entry.kind === "item");
    if (!itemRef || itemRef.ref !== assignment.item_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Item resolution did not exactly preserve ${assignment.item_ref}; no move was run.`);
    }

    const trackExecution = await runAtomic(executeAtomic, request, { id: RESOLVE_TRACK_ID, input: { track_ref: assignment.target_track_ref }, refs: [] });
    collectExecutionEvidence(state, trackExecution);
    if (trackExecution?.ok !== true) return atomicFailure(trackExecution, RESOLVE_TRACK_ID);
    const targetTrackRef = executionObjectRefs(trackExecution).find((entry) => entry.kind === "track");
    if (!targetTrackRef || targetTrackRef.ref !== assignment.target_track_ref) {
      return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Live Track resolution did not exactly preserve ${assignment.target_track_ref}; no move was run.`);
    }
    resolved.push({ item_ref: itemRef, target_track_ref: targetTrackRef });
  }
  state.returnedTargetCount = resolved.length;
  state.canonicalRefs.push(...resolved.flatMap((row) => [row.item_ref.ref, row.target_track_ref.ref]));
  return { ok: true, refs: resolved.map((row) => row.item_ref), assignments: resolved };
}

async function readTargetFacts({ targets, assignments = [], input, request, executeAtomic, state }) {
  const rows = [];
  for (const [index, itemRef] of targets.entries()) {
    const execution = await runAtomic(executeAtomic, request, {
      id: READ_ITEM_ID,
      input: { include_take_summary: true },
      refs: { item_ref: itemRef },
    });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) return atomicFailure(execution, READ_ITEM_ID);
    const summary = executionSummary(execution);
    if (summary.item_ref !== itemRef.ref) return failed("ITEM_APPLY_TARGET_IDENTITY_MISMATCH", `Item summary ${index + 1} did not round-trip the exact live item_ref.`);
    if (!Number.isFinite(summary.position_seconds) || summary.position_seconds < 0 || !Number.isFinite(summary.length_seconds) || summary.length_seconds < 0) {
      return failed("ITEM_APPLY_ITEM_FACTS_INVALID", `Item ${itemRef.ref} did not return finite non-negative position and length facts.`);
    }
    const row = {
      item_ref: itemRef,
      source_track_ref: stringOrNull(summary.track_ref),
      position_seconds: summary.position_seconds,
      length_seconds: summary.length_seconds,
      end_seconds: summary.position_seconds + summary.length_seconds,
      active_take_ref: stringOrNull(summary.active_take_ref),
      snap_offset_seconds: finiteOrNull(summary.snap_offset_seconds),
      fade_in_seconds: finiteOrNull(summary.fade_in_seconds),
      fade_out_seconds: finiteOrNull(summary.fade_out_seconds),
      requested_take_ref: assignments[index]?.take_ref ?? null,
      requested_track_ref: assignments[index]?.target_track_ref ?? null,
      target_order: index,
    };
    if (["remove_silence", "align_onsets"].includes(input.mode)) {
      if (row.length_seconds > 600) {
        return failed("ITEM_APPLY_ANALYSIS_COVERAGE_INCOMPLETE", `${itemRef.ref} is longer than the 600-second complete-analysis ceiling; no mutation was run.`);
      }
      const analysisId = input.mode === "remove_silence" ? DETECT_SILENCE_ID : DETECT_TRANSIENTS_ID;
      const analysisInput = input.mode === "remove_silence"
        ? compactObject({ max_analysis_seconds: 600, max_segments: 128, silence_threshold_dbfs: input.silence_threshold_dbfs, min_silence_ms: input.min_silence_ms })
        : compactObject({ max_analysis_seconds: 600, max_transients: 128, transient_delta_linear: input.transient_delta_linear, min_transient_gap_ms: input.min_transient_gap_ms });
      const analysis = await runAtomic(executeAtomic, request, { id: analysisId, input: analysisInput, refs: { item_ref: itemRef } });
      collectExecutionEvidence(state, analysis);
      if (analysis?.ok !== true) return atomicFailure(analysis, analysisId);
      const analysisSummary = executionSummary(analysis);
      const coverage = plainObject(analysisSummary.coverage);
      const rowCountComplete = input.mode === "remove_silence"
        ? analysisSummary.total_detected === analysisSummary.returned_count
        : analysisSummary.total_detected === analysisSummary.transient_count;
      if (analysisSummary.item_ref !== itemRef.ref || analysisSummary.truncated === true || coverage.range_complete !== true
        || coverage.channel_coverage_complete !== true || coverage.result_rows_complete !== true || !rowCountComplete) {
        return failed("ITEM_APPLY_ANALYSIS_COVERAGE_INCOMPLETE", `${analysisId} did not return complete range, channel, and result-row coverage for ${itemRef.ref}; no mutation was run.`);
      }
      if (input.mode === "remove_silence") {
        const silenceCount = integerOr(analysisSummary.segment_count, -1);
        const silenceSeconds = finiteOrNull(analysisSummary.total_silence_seconds);
        if (silenceCount < 0 || silenceSeconds === null || silenceSeconds < 0 || silenceSeconds > row.length_seconds + POSITION_TOLERANCE) {
          return failed("ITEM_APPLY_ANALYSIS_RESULT_INVALID", `${analysisId} returned invalid silence totals for ${itemRef.ref}; no mutation was run.`);
        }
        if (silenceCount > 0 && silenceSeconds >= row.length_seconds - POSITION_TOLERANCE) {
          return failed("ITEM_APPLY_ALL_SILENT_BLOCKED", `${itemRef.ref} is completely silent at the requested threshold; deleting the only source Item is refused.`);
        }
        row.analysis = { silence_segment_count: silenceCount, silence_seconds: silenceSeconds };
      } else {
        const transientCount = integerOr(analysisSummary.transient_count, -1);
        const firstTransient = finiteOrNull(analysisSummary.first_transient_time);
        if (transientCount < 1 || firstTransient === null || firstTransient < 0 || firstTransient > row.length_seconds + POSITION_TOLERANCE) {
          return failed("ITEM_APPLY_TRANSIENT_REQUIRED", `${itemRef.ref} has no complete first-transient result; no onset alignment was run.`);
        }
        row.analysis = { transient_count: transientCount, first_transient_time: firstTransient };
      }
    }
    rows.push(row);
  }
  return { ok: true, rows };
}

function buildOperationPlan(input, facts) {
  if (input.mode === "remove_silence") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-remove-silence`,
        kind: "remove_silence",
        template_id: SPLIT_BY_SILENCE_ID,
        item_ref: fact.item_ref,
        field: "silence_segments",
        before_value: fact.length_seconds,
        requested_value: {
          count: fact.analysis.silence_segment_count,
          duration_seconds: fact.analysis.silence_seconds,
        },
        input: compactObject({ silence_threshold_dbfs: input.silence_threshold_dbfs, min_silence_ms: input.min_silence_ms }),
      })),
    };
  }
  if (input.mode === "stack_on_existing_tracks") {
    const missingOwner = facts.find((fact) => typeof fact.source_track_ref !== "string" || !fact.source_track_ref.startsWith("track:") || !fact.requested_track_ref);
    if (missingOwner) return failed("ITEM_APPLY_ITEM_FACTS_INVALID", `${missingOwner.item_ref.ref} did not return an exact live source Track or destination assignment; no move was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-target_track_ref`,
        kind: "move_item_to_track",
        template_id: MOVE_ITEM_TO_TRACK_ID,
        item_ref: fact.item_ref,
        target_track_ref: fact.requested_track_ref,
        field: "target_track_ref",
        before_value: fact.source_track_ref,
        requested_value: fact.requested_track_ref.ref,
        input: {},
      })),
    };
  }
  if (input.mode === "set_active_take") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-active_take_ref`,
        kind: "set_active_take",
        template_id: SET_ACTIVE_TAKE_ID,
        item_ref: fact.item_ref,
        take_ref: fact.requested_take_ref,
        field: "active_take_ref",
        before_value: fact.active_take_ref,
        requested_value: fact.requested_take_ref.ref,
        input: {},
      })),
    };
  }
  if (input.mode === "set_properties") {
    const operations = [];
    for (const fact of facts) {
      for (const field of ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS) {
        if (!Object.hasOwn(input.properties, field)) continue;
        const definition = PROPERTY_DEFINITIONS[field];
        operations.push({
          operation_id: `item-${fact.target_order + 1}-${field}`,
          kind: "set_property",
          template_id: definition.template_id,
          item_ref: fact.item_ref,
          field,
          requested_value: input.properties[field],
          input: { [definition.input_field]: input.properties[field] },
        });
      }
    }
    return { ok: true, operations };
  }
  if (input.mode === "apply_fades") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-fades`,
        kind: "set_item_fades",
        template_id: SET_ITEM_FADES_ID,
        item_ref: fact.item_ref,
        field: "fades",
        before_value: { fade_in_seconds: fact.fade_in_seconds, fade_out_seconds: fact.fade_out_seconds },
        requested_value: {
          fade_in_seconds: input.fade_in_seconds ?? 0,
          fade_out_seconds: input.fade_out_seconds ?? 0,
        },
        verify_fields: ["fade_in_seconds", "fade_out_seconds"],
        input: { fade_in_seconds: input.fade_in_seconds, fade_out_seconds: input.fade_out_seconds },
      })),
    };
  }
  if (input.mode === "trim_exact") {
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-length_seconds`,
        kind: "trim_item",
        template_id: TRIM_ITEM_ID,
        item_ref: fact.item_ref,
        field: "length_seconds",
        before_value: fact.length_seconds,
        requested_value: input.length_seconds,
        input: { length_seconds: input.length_seconds },
      })),
    };
  }
  if (input.mode === "set_take_playback") {
    const noTake = facts.find((fact) => !fact.active_take_ref);
    if (noTake) return failed("ITEM_APPLY_ACTIVE_TAKE_REQUIRED", `${noTake.item_ref.ref} has no Active Take; no Take playback mutation was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-take-playback`,
        kind: "set_take_playback",
        template_id: SET_TAKE_PLAYRATE_ID,
        item_ref: fact.item_ref,
        field: "take_playback",
        before_value: null,
        requested_value: { playrate: input.playrate, preserve_pitch: input.preserve_pitch },
        verify_fields: ["playrate", "preserve_pitch"],
        input: { playrate: input.playrate, preserve_pitch: input.preserve_pitch },
      })),
    };
  }
  if (input.mode === "set_snap_offset") {
    const outsideItem = facts.find((fact) => input.snap_offset_seconds > fact.length_seconds + POSITION_TOLERANCE);
    if (outsideItem) return failed("ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM", `snap_offset_seconds exceeds ${outsideItem.item_ref.ref} length; no mutation was run.`);
    return {
      ok: true,
      operations: facts.map((fact) => ({
        operation_id: `item-${fact.target_order + 1}-snap_offset_seconds`,
        kind: "set_snap_offset",
        template_id: SET_ITEM_SNAP_OFFSET_ID,
        item_ref: fact.item_ref,
        field: "snap_offset_seconds",
        before_value: fact.snap_offset_seconds,
        requested_value: input.snap_offset_seconds,
        input: { snap_offset_seconds: input.snap_offset_seconds },
      })),
    };
  }

  const timeline = [...facts].sort((a, b) => a.position_seconds - b.position_seconds || a.target_order - b.target_order);
  const desired = new Map();
  if (input.mode === "align_onsets") {
    const anchor = input.anchor_seconds ?? Math.min(...facts.map((fact) => fact.position_seconds + fact.analysis.first_transient_time));
    for (const fact of facts) desired.set(fact.item_ref.ref, anchor - fact.analysis.first_transient_time);
  } else if (input.mode === "align_starts") {
    const anchor = input.anchor_seconds ?? Math.min(...facts.map((fact) => fact.position_seconds));
    for (const fact of facts) desired.set(fact.item_ref.ref, anchor);
  } else if (input.mode === "align_ends") {
    const anchor = input.anchor_seconds ?? Math.max(...facts.map((fact) => fact.end_seconds));
    for (const fact of facts) desired.set(fact.item_ref.ref, anchor - fact.length_seconds);
  } else if (input.mode === "sequence_with_gap") {
    let cursor = input.anchor_seconds ?? timeline[0].position_seconds;
    for (const fact of timeline) {
      desired.set(fact.item_ref.ref, cursor);
      cursor += fact.length_seconds + input.gap_seconds;
    }
  } else if (input.mode === "distribute_evenly") {
    const first = input.anchor_seconds ?? timeline[0].position_seconds;
    const span = timeline.length === 1 ? 0 : timeline.at(-1).position_seconds - timeline[0].position_seconds;
    const step = timeline.length < 2 ? 0 : span / (timeline.length - 1);
    for (const [index, fact] of timeline.entries()) desired.set(fact.item_ref.ref, first + (step * index));
  } else if (input.mode === "move_to_anchor") {
    const first = Math.min(...facts.map((fact) => fact.position_seconds));
    const delta = input.anchor_seconds - first;
    for (const fact of facts) desired.set(fact.item_ref.ref, fact.position_seconds + delta);
  }

  const operations = facts.map((fact) => ({
    operation_id: `item-${fact.target_order + 1}-position_seconds`,
    kind: input.mode === "align_onsets" ? "align_onset" : "move_item",
    template_id: MOVE_ITEM_ID,
    item_ref: fact.item_ref,
    field: "position_seconds",
    before_value: fact.position_seconds,
    requested_value: desired.get(fact.item_ref.ref),
    input: { position_seconds: desired.get(fact.item_ref.ref) },
    ...(input.mode === "align_onsets" ? {
      onset_anchor_seconds: input.anchor_seconds ?? Math.min(...facts.map((row) => row.position_seconds + row.analysis.first_transient_time)),
      transient_input: compactObject({ max_analysis_seconds: 600, max_transients: 128, transient_delta_linear: input.transient_delta_linear, min_transient_gap_ms: input.min_transient_gap_ms }),
    } : {}),
  }));
  const invalid = operations.find((operation) => !Number.isFinite(operation.requested_value) || operation.requested_value < 0);
  if (invalid) return failed("ITEM_APPLY_POSITION_INVALID", `${input.mode} would move ${invalid.item_ref.ref} before project time zero; no mutation was run.`);
  return { ok: true, operations };
}

async function executePropertyPlan({ plan, request, executeAtomic, state }) {
  for (const operation of plan.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    let execution;
    try {
      execution = await runAtomic(executeAtomic, request, {
        id: operation.template_id,
        input: operation.input,
        refs: compactObject({ item_ref: operation.item_ref, take_ref: operation.take_ref, target_track_ref: operation.target_track_ref }),
      });
    } catch (error) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return executionError(error, operation.template_id, "mutation");
    }
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
    }
    change.mutation = { status: "completed", template_id: operation.template_id };
    const summary = executionSummary(execution);
    const observed = Array.isArray(operation.verify_fields)
      ? Object.fromEntries(operation.verify_fields.map((field) => [field, summary[field]]))
      : summary[operation.field];
    const targetMatches = summary.item_ref === operation.item_ref.ref;
    const valueMatches = Array.isArray(operation.verify_fields)
      ? operation.verify_fields.every((field) => valuesMatch(summary[field], operation.requested_value[field]))
      : valuesMatch(observed, operation.requested_value);
    const preservationMatches = operation.kind !== "move_item_to_track" || summary.track_count_unchanged === true;
    if (!targetMatches || !valueMatches || !preservationMatches || summary.readback_status !== "passed") {
      change.status = "readback_failed";
      change.live_readback = compactObject({
        status: "failed",
        source: operation.kind === "set_active_take" ? "exact_active_take_readback" : operation.kind === "move_item_to_track" ? "exact_item_track_readback" : "accepted_template_live_readback",
        observed_value: observed,
        observed_item_ref: stringOrNull(summary.item_ref),
      });
      return failedReadback(operation, observed, summary.item_ref);
    }
    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: operation.kind === "set_active_take" ? "exact_active_take_readback" : operation.kind === "move_item_to_track" ? "exact_item_track_readback" : "accepted_template_live_readback",
      observed_value: observed,
    };
  }
  return null;
}

async function executeLegacyRemoveSilencePlan({ plan, request, executeAtomic, state }) {
  for (const operation of plan.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    let execution;
    try {
      execution = await runAtomic(executeAtomic, request, {
        id: operation.template_id,
        input: operation.input,
        refs: { item_ref: operation.item_ref },
      });
    } catch (error) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return executionError(error, operation.template_id, "mutation");
    }
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.mutation = { status: "failed" };
      change.live_readback = { status: "not_run" };
      return { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
    }
    change.mutation = { status: "completed", template_id: operation.template_id };
    const summary = executionSummary(execution);
    const keptRefs = Array.isArray(summary.kept_item_refs) ? summary.kept_item_refs : [];
    const deletedRefs = Array.isArray(summary.deleted_item_refs) ? summary.deleted_item_refs : [];
    const expected = operation.requested_value;
    const atomMatches = summary.readback_status === "passed"
      && summary.source_item_ref === operation.item_ref.ref
      && isExactGuidRef(summary.owner_track_ref, "track")
      && summary.source_media_deleted === false
      && Number.isInteger(summary.silence_segment_count)
      && summary.silence_segment_count === expected.count
      && valuesMatch(summary.removed_duration_seconds, expected.duration_seconds)
      && Number.isInteger(summary.split_count)
      && Number.isInteger(summary.delete_count)
      && Number.isInteger(summary.item_count_after)
      && summary.delete_count === deletedRefs.length
      && keptRefs.length >= 1
      && keptRefs.every((ref) => isExactGuidRef(ref, "item"))
      && deletedRefs.every((ref) => isExactGuidRef(ref, "item"));
    if (!atomMatches) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "split_by_silence_atom_readback" };
      return { ...failed("ITEM_APPLY_READBACK_MISMATCH", `${operation.item_ref.ref} split-by-silence atom did not return complete exact live truth.`), phase: "readback" };
    }

    for (const keptRef of keptRefs) {
      const read = await runAtomic(executeAtomic, request, {
        id: READ_ITEM_ID,
        input: { include_take_summary: true },
        refs: { item_ref: exactGuidObjectRef("item", keptRef) },
      });
      collectExecutionEvidence(state, read);
      if (read?.ok !== true) {
        change.status = "readback_failed";
        change.live_readback = { status: "failed", source: "kept_item_live_summary" };
        return { ...atomicFailure(read, READ_ITEM_ID), phase: "readback" };
      }
      const keptSummary = executionSummary(read);
      if (keptSummary.item_ref !== keptRef || keptSummary.track_ref !== summary.owner_track_ref
        || !Number.isFinite(keptSummary.position_seconds) || !Number.isFinite(keptSummary.length_seconds) || keptSummary.length_seconds <= 0) {
        change.status = "readback_failed";
        change.live_readback = { status: "failed", source: "kept_item_live_summary" };
        return { ...failed("ITEM_APPLY_READBACK_MISMATCH", `${keptRef} did not survive with exact Track/position/length readback.`), phase: "readback" };
      }
    }

    const trackList = await runAtomic(executeAtomic, request, {
      id: LIST_TRACK_ITEMS_ID,
      input: { limit: 128, include_take_summary: false },
      refs: { track_ref: exactGuidObjectRef("track", summary.owner_track_ref) },
    });
    collectExecutionEvidence(state, trackList);
    if (trackList?.ok !== true) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "owner_track_item_count" };
      return { ...atomicFailure(trackList, LIST_TRACK_ITEMS_ID), phase: "readback" };
    }
    const trackSummary = executionSummary(trackList);
    if (trackSummary.track_ref !== summary.owner_track_ref || trackSummary.item_count !== summary.item_count_after) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "owner_track_item_count" };
      return { ...failed("ITEM_APPLY_READBACK_MISMATCH", `${summary.owner_track_ref} Item count did not independently match the split atom.`), phase: "readback" };
    }

    change.status = "applied";
    change.live_readback = {
      status: "passed",
      source: "split_atom_plus_kept_items_plus_track_count",
      observed_value: {
        kept: keptRefs.length,
        deleted: deletedRefs.length,
        removed_seconds: finiteOrNull(summary.removed_duration_seconds),
        remaining_seconds: finiteOrNull(summary.remaining_duration_seconds),
        track_item_count: summary.item_count_after,
      },
    };
  }
  return null;
}

async function executeExactSelectionMacro({
  entry,
  request,
  executeAtomic,
  now,
  startedAt,
  stages,
  state,
  activeBudget,
  input,
}) {
  state.targetScope = "exact";
  state.totalTargetCount = input.target_refs.length;
  state.returnedTargetCount = input.target_refs.length;
  state.operations = [{
    operation_id: "select-exact",
    template_id: SET_EXACT_SELECTION_ID,
    kind: "select_exact",
    requested_value: input.selection_mode,
  }];
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Validated ${input.target_refs.length} canonical exact Item ref(s).`, []);
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", "Compiled one exact replace/add/remove selection request.", []);
  if (input.dry_run) {
    pushStage(stages, "items-apply-mutate", "template_execute", "skipped", "dry_run=true; Item selection was not changed.", []);
    pushStage(stages, "items-apply-verify", "verify", "skipped", "No selection readback is claimed for a dry run.", []);
    pushStage(stages, "items-apply-index", "index_update", "skipped", "Selection does not stale the Project Index.", []);
    pushStage(stages, "items-apply-result", "result_project", "completed", "Projected one exact selection operation.", []);
    return successEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "dry_run_completed",
      summary: `Previewed ${input.selection_mode} selection for ${input.target_refs.length} exact Item(s).`,
      data: {
        mode: "select_exact",
        selection_mode: input.selection_mode,
        requested_item_refs: input.target_refs,
        mutation: { occurred: false, changes: 0 },
        readback_status: "not_run",
      },
    });
  }
  let execution;
  try {
    execution = await runAtomic(executeAtomic, request, {
      id: SET_EXACT_SELECTION_ID,
      input: { mode: input.selection_mode, item_refs: input.target_refs },
      refs: {},
    });
  } catch (error) {
    const message = error?.message ?? "Exact Item selection dispatch failed.";
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_ATOMIC_FAILED",
      message,
      blockers: [blocker("ITEM_APPLY_ATOMIC_FAILED", message)],
      data: { mode: "select_exact", selection_mode: input.selection_mode, requested_item_refs: input.target_refs },
    });
  }
  collectExecutionEvidence(state, execution);
  if (execution?.ok !== true) {
    const failure = atomicFailure(execution, SET_EXACT_SELECTION_ID);
    pushStage(stages, "items-apply-mutate", "template_execute", "failed", failure.message, state.evidenceRefs);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: failure.code,
      message: failure.message,
      blockers: failure.blockers,
      data: { mode: "select_exact", selection_mode: input.selection_mode, requested_item_refs: input.target_refs },
    });
  }
  const summary = executionSummary(execution);
  const selectedRefs = Array.isArray(summary.selected_item_refs) ? [...summary.selected_item_refs] : null;
  const selectedSet = selectedRefs ? new Set(selectedRefs) : new Set();
  const valid = summary.mode === input.selection_mode
    && summary.readback_status === "passed"
    && Number.isSafeInteger(summary.selected_count)
    && summary.selected_count === selectedRefs?.length
    && selectedSet.size === selectedRefs?.length
    && selectedRefs?.every((ref) => isExactGuidRef(ref, "item")) === true;
  if (!valid) {
    const message = "Exact Item selection aggregate readback was incomplete or inconsistent.";
    pushStage(stages, "items-apply-mutate", "template_execute", "completed", "REAPER accepted the selection request.", state.evidenceRefs);
    pushStage(stages, "items-apply-verify", "verify", "failed", message, state.evidenceRefs);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "partial_failure",
      code: "ITEM_APPLY_READBACK_MISMATCH",
      message,
      blockers: [blocker("ITEM_APPLY_READBACK_MISMATCH", message)],
      data: { mode: "select_exact", selection_mode: input.selection_mode, requested_item_refs: input.target_refs },
    });
  }
  state.canonicalRefs = uniqueObjectRefs(executionObjectRefs(execution));
  state.changes = [{
    id: "select-exact",
    status: "applied",
    mutation: { status: "completed" },
    live_readback: { status: "passed", source: "complete_selected_item_set", observed_value: summary.selected_count },
    index_maintenance: { status: "skipped", scopes: [] },
  }];
  pushStage(stages, "items-apply-mutate", "template_execute", "completed", "Applied one exact Item selection mutation.", state.evidenceRefs);
  pushStage(stages, "items-apply-verify", "verify", "completed", "Verified the complete final canonical selected Item set.", state.evidenceRefs);
  pushStage(stages, "items-apply-index", "index_update", "skipped", "Selection does not stale the Project Index.", []);
  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected exact aggregate selection truth.", state.evidenceRefs);
  return successEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: "completed",
    summary: `Selected ${summary.selected_count} Item(s) using ${input.selection_mode} mode.`,
    data: {
      mode: "select_exact",
      selection_mode: input.selection_mode,
      requested_item_refs: input.target_refs,
      selected_item_refs: selectedRefs,
      selected_count: summary.selected_count,
      changed_count: summary.changed_count,
      readback_status: "passed",
    },
  });
}

async function executeAudioBatchMacro({
  entry,
  request,
  executeAtomic,
  projectIndexRuntime,
  artifactWriter,
  now,
  monoNow = () => performance.now(),
  startedAt,
  stages,
  state,
  activeBudget,
  input,
}) {
  const t0 = monoTick(monoNow);
  const dryRun = input.dry_run === true;
  state.batchMode = true;
  state.calls = emptyCalls();
  state.timings = emptyTimings();
  state.targetScope = input.target === "exact" || input.target_refs.length > 0 ? "exact" : "selected";

  // Keep the 65-target contract visible at the batch boundary as well as in
  // input normalization: no selected-target resolution or REAPER dispatch may
  // begin for either remove_silence or normalize_level.
  if (input.target_refs.length > AUDIO_BATCH_MAX_TARGETS) {
    state.timings.total_ms = monoElapsed(t0, monoNow);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_TARGET_LIMIT_EXCEEDED",
      message: `${input.mode} accepts at most 64 targets; 65 is zero_write=true.`,
      blockers: [blocker("ITEM_APPLY_TARGET_LIMIT_EXCEEDED", `${input.mode} accepts at most 64 targets; 65 is zero_write=true.`)],
      data: audioBatchData(input, state, { zero_write: true }),
    });
  }

  let batchResult;
  try {
    batchResult = await executeRemoveSilencePlan({ request, input, executeAtomic, state });
  } catch (error) {
    state.timings.total_ms = monoElapsed(t0, monoNow);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_ATOMIC_FAILED",
      message: error?.message ?? "Audio batch dispatch failed.",
      blockers: [blocker("ITEM_APPLY_ATOMIC_FAILED", error?.message ?? "Audio batch dispatch failed.")],
      data: audioBatchData(input, state, { zero_write: true }),
    });
  }
  const execution = batchResult.execution;
  collectExecutionEvidence(state, execution);
  const summary = executionSummary(execution);
  const rows = Array.isArray(summary.aggregate_readback)
    ? summary.aggregate_readback
    : Array.isArray(summary.rows) ? summary.rows : [];
  const publicReadback = compactAudioBatchReadback(rows, input.mode);
  state.totalTargetCount = integerOr(summary.target_count, rows.length);
  state.returnedTargetCount = rows.length;
  state.targetsTruncated = summary.targets_truncated === true;
  state.operations = rows.map((row, index) => ({
    operation_id: `${input.mode}-${index + 1}`,
    template_id: SPLIT_BY_SILENCE_ID,
    kind: input.mode === "remove_silence" ? "remove_silence" : "normalize_level",
    item_ref: exactGuidObjectRef("item", row.item_ref ?? `item:guid:unresolved-${index + 1}`),
    requested_value: row,
  }));
  state.changes = rows.map((row, index) => audioBatchChange(row, index, dryRun));
  state.canonicalRefs = uniqueObjectRefs([
    ...executionObjectRefs(execution),
    ...rows.flatMap((row) => [row.item_ref, row.owner_track_ref, row.new_take_ref]),
  ].map((ref) => {
    if (isPlainObject(ref)) return ref;
    if (typeof ref !== "string") return null;
    const kind = ref.split(":", 1)[0];
    return ["item", "take", "track"].includes(kind) ? exactGuidObjectRef(kind, ref) : null;
  }).filter(Boolean));
  const batchTimings = plainObject(summary.batch_timings ?? summary.timings);
  const nativeCounters = plainObject(summary.native_counters ?? summary.counters);
  state.nativeBatch = {
    batch_timings: batchTimings,
    native_counters: nativeCounters,
    aggregate_readback: publicReadback,
    plan_hash: stringOrNull(summary.plan_hash),
    undo_opened: summary.undo_opened === true,
    undo_closed: summary.undo_closed === true,
    transport_call_count: 1,
  };
  state.timings = {
    target_resolution_ms: finiteOrZero(batchTimings.target_resolution_ms ?? batchTimings.resolve_ms),
    preflight_ms: finiteOrZero(batchTimings.preflight_ms),
    mutation_ms: finiteOrZero(batchTimings.mutation_ms),
    final_readback_ms: finiteOrZero(batchTimings.readback_ms ?? batchTimings.final_readback_ms),
    index_maintenance_ms: 0,
    total_ms: finiteOrZero(batchTimings.total_ms) || monoElapsed(t0, monoNow),
  };

  if (typeof artifactWriter === "function") {
    try {
      state.audioBatchEvidence = await artifactWriter({
        request,
        input,
        execution,
        summary,
        rows,
        publicReadback,
        failure: batchResult.failure,
      });
      if (typeof state.audioBatchEvidence?.ref === "string") {
        state.evidenceRefs.push(state.audioBatchEvidence.ref);
      }
    } catch (error) {
      state.audioBatchEvidence = {
        write_failed: true,
        error: error?.message ?? "Audio batch evidence artifact could not be written.",
      };
    }
    if (state.audioBatchEvidence?.write_failed === true) {
      return failureEnvelope({
        entry,
        request,
        startedAt,
        now,
        stages,
        state,
        activeBudget,
        status: execution?.ok === true ? "partial_failure" : "failed",
        code: "ITEM_APPLY_AUDIO_EVIDENCE_WRITE_FAILED",
        message: state.audioBatchEvidence.error,
        blockers: [blocker("ITEM_APPLY_AUDIO_EVIDENCE_WRITE_FAILED", state.audioBatchEvidence.error, false)],
        data: audioBatchData(input, state, { zero_write: false }),
      });
    }
  }

  if (execution?.ok !== true || batchResult.failure) {
    const failure = batchResult.failure ?? atomicFailure(execution, SPLIT_BY_SILENCE_ID);
    state.timings.total_ms = finiteOrZero(batchTimings.total_ms) || monoElapsed(t0, monoNow);
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: rows.some((row) => row.mutation?.status === "completed") ? "partial_failure" : "failed",
      code: failure.code,
      message: failure.message,
      blockers: failure.blockers,
      data: audioBatchData(input, state, {
        zero_write: summary.zero_write === true
          || batchResult.zero_write === true
          || execution?.error?.details?.zero_write === true
          || execution?.result?.data?.zero_write === true,
      }),
    });
  }

  const indexResult = maintainBatchProjectIndex(projectIndexRuntime, state, now);
  state.timings.index_maintenance_ms = 0;
  state.timings.total_ms = finiteOrZero(batchTimings.total_ms) || monoElapsed(t0, monoNow);
  applyBatchIndexMaintenance(state.changes, indexResult);
  if (indexResult.ok === false) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "partial_failure",
      code: indexResult.code,
      message: indexResult.message,
      blockers: indexResult.blockers,
      data: audioBatchData(input, state),
    });
  }
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Resolved ${state.returnedTargetCount} exact audio target(s) inside the REAPER batch core.`, state.evidenceRefs);
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", "Compiled the complete audio batch plan before mutation.", state.evidenceRefs);
  pushStage(stages, "items-apply-mutate", "template_execute", dryRun ? "skipped" : "completed", dryRun ? "dry_run=true; REAPER reported no mutation." : "REAPER applied one invocation-level native audio batch.", state.evidenceRefs);
  pushStage(stages, "items-apply-verify", "verify", "completed", "Returned aggregate live readback, plan hash, timing, and native counters.", state.evidenceRefs);
  pushStage(stages, "items-apply-index", "index_update", indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);
  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected shared audio batch truth.", state.evidenceRefs);
  return successEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: dryRun ? "dry_run_completed" : "completed",
    summary: `${input.mode} completed in one native batch with plan hash ${summary.plan_hash ?? "unavailable"}.`,
    data: audioBatchData(input, state),
    compact: activeBudget <= MIN_RESPONSE_BUDGET,
  });
}

async function executeRemoveSilencePlan({ request, input = request.input, executeAtomic, state }) {
  const refs = uniqueObjectRefs([
    ...collectItemObjectRefs(request.refs),
    ...input.target_refs.map((token) => {
      const canonical = canonicalTokenRef(token);
      return canonical ? exactGuidObjectRef("item", canonical) : null;
    }).filter(Boolean),
  ]);
  const childInput = compactObject({
    batch: true,
    operation: input.mode,
    target: input.target,
    target_refs: input.target_refs,
    adjacent_audio: input.adjacent_audio,
    dry_run: input.dry_run,
    silence_scope: input.silence_scope,
    silence_threshold_dbfs: input.silence_threshold_dbfs,
    min_silence_ms: input.min_silence_ms,
    keep_before_ms: input.keep_before_ms,
    keep_after_ms: input.keep_after_ms,
    min_kept_audio_ms: input.min_kept_audio_ms,
    fade_ms: input.fade_ms,
    normalization_metric: input.normalization_metric,
    normalization_target: input.normalization_target,
  });
  let execution;
  try {
    execution = await runAtomicCounted(executeAtomic, request, state, "mutation", {
      id: SPLIT_BY_SILENCE_ID,
      input: childInput,
      refs,
    });
  } catch (error) {
    return {
      execution: null,
      failure: executionError(error, SPLIT_BY_SILENCE_ID, "mutation"),
      zero_write: true,
    };
  }
  // The single REAPER child owns target resolution, complete preflight, mutation,
  // aggregate readback, plan_hash, and the one invocation-level Undo boundary.
  return { execution, failure: execution?.ok === true ? null : atomicFailure(execution, SPLIT_BY_SILENCE_ID) };
}

function audioBatchChange(row, index, dryRun) {
  const mutationStatus = dryRun ? "not_run" : row.mutation?.status ?? (row.status === "applied" ? "completed" : "failed");
  const readbackStatus = dryRun ? "not_run" : row.live_readback?.status ?? row.readback_status ?? "passed";
  return compactObject({
    id: row.id ?? `audio-${index + 1}`,
    status: dryRun ? "planned" : row.status ?? (mutationStatus === "completed" && readbackStatus === "passed" ? "applied" : "failed"),
    mutation: { status: mutationStatus },
    live_readback: { status: readbackStatus },
    index_maintenance: { status: dryRun ? "skipped" : "pending", scopes: [] },
    code: row.code,
    item_ref: row.item_ref,
    owner_track_ref: row.owner_track_ref,
    plan_hash: row.plan_hash,
    readback: row.aggregate_readback ?? row.readback,
    ...row,
  });
}

function audioBatchData(input, state, extra = {}) {
  const artifactRefs = uniqueStrings(
    state.evidenceRefs.filter((ref) => ref.startsWith("artifact:")),
  ).slice(0, 2);
  const inlineReadback = state.audioBatchEvidence?.inline_readback !== false;
  return {
    mode: input.mode,
    target_scope: state.targetScope,
    adjacent_audio: input.adjacent_audio,
    target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    zero_write: extra.zero_write === true,
    source_media_deleted: false,
    ...(input.mode === "remove_silence" ? {
      silence_threshold_dbfs: input.silence_threshold_dbfs,
      min_silence_ms: input.min_silence_ms,
      silence_scope: input.silence_scope,
      keep_before_ms: input.keep_before_ms,
      keep_after_ms: input.keep_after_ms,
      min_kept_audio_ms: input.min_kept_audio_ms,
      fade_ms: input.fade_ms,
    } : {
      normalization_metric: input.normalization_metric,
      normalization_target: input.normalization_target,
    }),
    measurement_scope: input.mode === "normalize_level" ? "source_item_take_pre_fx" : "source_active_take_pre_track_fx",
    plan_hash: state.nativeBatch?.plan_hash ?? null,
    ...(inlineReadback
      ? { aggregate_readback: state.nativeBatch?.aggregate_readback ?? [] }
      : { aggregate_readback_count: state.nativeBatch?.aggregate_readback?.length ?? 0 }),
    ...(artifactRefs.length > 0 ? { artifact_refs: artifactRefs } : {}),
    timings: state.timings,
    batch_timings: state.nativeBatch?.batch_timings ?? {},
    native_counters: state.nativeBatch?.native_counters ?? {},
    transport_call_count: state.nativeBatch?.transport_call_count ?? 1,
    undo: {
      mode: "required",
      one_invocation: true,
      one_undo: true,
      undo_opened: state.nativeBatch?.undo_opened === true,
      undo_closed: state.nativeBatch?.undo_closed === true,
    },
    undo_opened: state.nativeBatch?.undo_opened === true,
    undo_closed: state.nativeBatch?.undo_closed === true,
    total_ms: state.timings.total_ms,
    release_gate_ms: AUDIO_BATCH_RELEASE_GATE_MS,
  };
}

function compactAudioBatchReadback(rows, mode) {
  const values = Array.isArray(rows) ? rows : [];
  return values.map((row) => {
    const keptRefs = Array.isArray(row.kept_item_refs) ? row.kept_item_refs : [];
    const deletedRefs = Array.isArray(row.deleted_item_refs) ? row.deleted_item_refs : [];
    // Small batches remain fully inspectable. Larger batches keep one scalar
    // readback row per target; the transport result/evidence root retains the
    // complete GUID arrays returned by the REAPER-side verifier.
    if (values.length <= 8 && keptRefs.length + deletedRefs.length <= 32) return row;
    if (mode === "normalize_level") {
      return compactObject({
        target_order: row.target_order,
        item_ref: row.item_ref,
        owner_track_ref: row.owner_track_ref,
        status: row.status,
        changed: row.changed,
        source_media_deleted: row.source_media_deleted,
        adjustment: row.adjustment,
        take_volume_before: row.take_volume_before,
        take_volume_after: row.take_volume_after,
      });
    }
    return compactObject({
      target_order: row.target_order,
      item_ref: row.item_ref,
      owner_track_ref: row.owner_track_ref,
      status: row.status,
      changed: row.changed,
      source_media_deleted: row.source_media_deleted,
      silence_segment_count: row.silence_segment_count,
      delete_count: row.delete_count,
      kept_item_count: keptRefs.length,
      deleted_item_count: deletedRefs.length,
    });
  });
}

async function executeArrangementPlan({ plan, request, executeAtomic, state }) {
  for (const operation of plan.operations) {
    const change = pendingChange(operation);
    state.changes.push(change);
    let execution;
    try {
      execution = await runAtomic(executeAtomic, request, {
        id: operation.template_id,
        input: operation.input,
        refs: { item_ref: operation.item_ref },
      });
    } catch (error) {
      change.mutation = { status: "failed" };
      return executionError(error, operation.template_id, "mutation");
    }
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.mutation = { status: "failed" };
      return { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
    }
    const summary = executionSummary(execution);
    change.mutation = { status: "completed", template_id: operation.template_id };
    if (summary.item_ref !== operation.item_ref.ref) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "mutation_response_identity" };
      return failedReadback(operation, summary.position_seconds, summary.item_ref);
    }
  }

  let firstFailure = null;
  for (const operation of plan.operations) {
    const change = state.changes.find((entry) => entry.operation_id === operation.operation_id);
    const execution = await runAtomic(executeAtomic, request, {
      id: READ_ITEM_ID,
      input: { include_take_summary: false },
      refs: { item_ref: operation.item_ref },
    });
    collectExecutionEvidence(state, execution);
    if (execution?.ok !== true) {
      change.status = "readback_failed";
      change.live_readback = { status: "failed", source: "live_item_summary" };
      firstFailure ??= { ...atomicFailure(execution, READ_ITEM_ID), phase: "readback" };
      continue;
    }
    const summary = executionSummary(execution);
    const matches = summary.item_ref === operation.item_ref.ref && valuesMatch(summary.position_seconds, operation.requested_value);
    if (!matches) {
      change.status = "readback_failed";
      change.live_readback = compactObject({ status: "failed", source: "live_item_summary", observed_value: finiteOrNull(summary.position_seconds), observed_item_ref: stringOrNull(summary.item_ref) });
      firstFailure ??= failedReadback(operation, summary.position_seconds, summary.item_ref);
      continue;
    }
    if (operation.kind === "align_onset") {
      const transientRead = await runAtomic(executeAtomic, request, {
        id: DETECT_TRANSIENTS_ID,
        input: operation.transient_input,
        refs: { item_ref: operation.item_ref },
      });
      collectExecutionEvidence(state, transientRead);
      if (transientRead?.ok !== true) {
        change.status = "readback_failed";
        change.live_readback = { status: "failed", source: "post_move_transient_analysis" };
        firstFailure ??= { ...atomicFailure(transientRead, DETECT_TRANSIENTS_ID), phase: "readback" };
        continue;
      }
      const transientSummary = executionSummary(transientRead);
      const coverage = plainObject(transientSummary.coverage);
      const firstTransient = finiteOrNull(transientSummary.first_transient_time);
      const onset = firstTransient === null ? null : summary.position_seconds + firstTransient;
      const transientMatches = transientSummary.item_ref === operation.item_ref.ref
        && transientSummary.truncated !== true
        && transientSummary.total_detected === transientSummary.transient_count
        && transientSummary.transient_count >= 1
        && coverage.range_complete === true
        && coverage.channel_coverage_complete === true
        && coverage.result_rows_complete === true
        && onset !== null
        && valuesMatch(onset, operation.onset_anchor_seconds);
      if (!transientMatches) {
        change.status = "readback_failed";
        change.live_readback = compactObject({ status: "failed", source: "post_move_transient_analysis", observed_value: onset });
        firstFailure ??= { ...failed("ITEM_APPLY_READBACK_MISMATCH", `${operation.item_ref.ref} live onset did not match ${operation.onset_anchor_seconds} seconds after movement.`), phase: "readback" };
        continue;
      }
      change.status = "applied";
      change.live_readback = { status: "passed", source: "live_item_summary_plus_transient_reanalysis", observed_value: onset };
    } else {
      change.status = "applied";
      change.live_readback = { status: "passed", source: "live_item_summary", observed_value: summary.position_seconds };
    }
  }
  return firstFailure;
}

async function executeCreateVariationsBatch({
  entry,
  request,
  executeAtomic,
  projectIndexRuntime,
  now,
  monoNow = () => performance.now(),
  startedAt,
  stages,
  state,
  activeBudget,
}) {
  const t0 = monoTick(monoNow);
  state.batchMode = true;
  state.calls = emptyCalls();
  state.timings = emptyTimings();
  const normalized = normalizeCreateVariationsInput(request.input);
  const dryRun = normalized.input?.dry_run ?? request.input?.dry_run !== false;
  const data = () => variationBatchData(state, { dry_run: dryRun });
  if (!normalized.ok) {
    return failureEnvelope({
      entry,
      request,
      startedAt,
      now,
      stages,
      state,
      activeBudget,
      code: normalized.code,
      message: normalized.message,
      blockers: normalized.blockers,
      data: { ...data(), zero_write: true },
    });
  }
  const programRequest = {
    macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input: normalized.input,
    refs: request.refs ?? {},
    dry_run: normalized.input.dry_run,
  };
  const validation = validateMacroProgramRequest(programRequest, { registry: ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_REQUEST_INVALID", message, blockers: validation.errors.map((error) => blocker("ITEM_APPLY_REQUEST_INVALID", error)), data: data() });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code: "ITEM_APPLY_LIVE_EXECUTOR_REQUIRED", message: "macro.items.apply requires the managed OpenReaper live executor.", data: data() });
  }

  const resolveStarted = monoTick(monoNow);
  // Exact refs are already compiler-validated. The live E4 batch handler is
  // the authority for resolving and preflighting every row before its first
  // native write, so this stage does not perform one child transport per row.
  const resolvedRows = normalized.input.variations.map((row) => {
    const sourceObject = exactGuidObjectRef("item", row.source_item_ref);
    const targetTrackObject = exactGuidObjectRef("track", row.target_track_ref);
    state.canonicalRefs.push(sourceObject.ref, targetTrackObject.ref);
    return { ...row, source_item: sourceObject, target_track: targetTrackObject };
  });
  state.timings.target_resolution_ms = monoElapsed(resolveStarted, monoNow);
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Resolved ${resolvedRows.length} exact variation source/target pair(s).`, state.evidenceRefs);
  state.changes = resolvedRows.map((row) => variationChange(row, { status: normalized.input.dry_run ? "planned" : "pending", mutation: normalized.input.dry_run ? "not_run" : "pending", readback: normalized.input.dry_run ? "not_run" : "pending", index: normalized.input.dry_run ? "skipped" : "pending" }));
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", "Every copy atom will independently verify its full source footprint before mutation.", state.evidenceRefs);

  if (normalized.input.dry_run) {
    state.timings.total_ms = monoElapsed(t0, monoNow);
    pushStage(stages, "items-apply-mutate", "template_execute", "skipped", "dry_run=true; no Item variation was dispatched.", []);
    pushStage(stages, "items-apply-verify", "verify", "completed", "Validated exact source/target identity for the complete variation preview.", state.evidenceRefs);
    pushStage(stages, "items-apply-index", "index_update", "skipped", "Dry run did not stale the Project Index.", []);
    pushStage(stages, "items-apply-result", "result_project", "completed", "Projected compact Item variation truth.", state.evidenceRefs);
    return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "dry_run_completed", summary: `Previewed ${resolvedRows.length} Item variation row(s) with no mutation.`, data: data(), compact: true });
  }

  let executionFailure = null;
  const mutationStarted = monoTick(monoNow);
  let copyExecution;
  try {
    copyExecution = await runAtomicCounted(executeAtomic, request, state, "mutation", {
      id: COPY_ITEM_TO_TRACK_ID,
      input: {
        batch: resolvedRows.map((row) => compactObject({
          id: row.id,
          source_item_ref: row.source_item_ref,
          target_track_ref: row.target_track_ref,
          position_seconds: row.position_seconds,
          source_offset_seconds: row.source_offset_seconds,
        })),
      },
      // The batch descriptor still requires both ref kinds. Pass the complete
      // bounded arrays once; the live batch atom uses input.batch as the row
      // authority and does not dispatch one transport call per variation.
      refs: {
        source_item_ref: resolvedRows.map((row) => row.source_item),
        target_track_ref: resolvedRows.map((row) => row.target_track),
      },
    });
  } catch (error) {
    executionFailure = executionError(error, COPY_ITEM_TO_TRACK_ID, "mutation");
  }
  collectExecutionEvidence(state, copyExecution);
  if (copyExecution?.ok !== true) {
    executionFailure ??= { ...atomicFailure(copyExecution, COPY_ITEM_TO_TRACK_ID), phase: "mutation" };
    for (const change of state.changes) {
      change.mutation = { status: "unknown_or_partial" };
      change.status = "unknown_or_partial";
    }
  } else {
    const copySummary = executionSummary(copyExecution);
    const batchRows = Array.isArray(copySummary.rows) ? copySummary.rows : [];
    const sourceFootprints = Array.isArray(copySummary.source_footprints) ? copySummary.source_footprints : [];
    const targetTracks = Array.isArray(copySummary.target_tracks) ? copySummary.target_tracks : [];
    const objectRefs = executionObjectRefs(copyExecution);
    for (const [index, row] of resolvedRows.entries()) {
      const change = state.changes[index];
      const rowSummary = batchRows.find((candidate) => candidate?.id === row.id);
      const newItemRef = rowSummary?.new_item_ref;
      const newTakeRef = rowSummary?.active_take_ref;
      const sourceFootprint = Number.isSafeInteger(rowSummary?.source_footprint_index)
        ? sourceFootprints[rowSummary.source_footprint_index - 1]
        : sourceFootprints.find((candidate) => candidate?.source_item_ref === row.source_item_ref);
      const targetTrack = Number.isSafeInteger(rowSummary?.target_track_index)
        ? targetTracks[rowSummary.target_track_index - 1]
        : targetTracks.find((candidate) => candidate?.target_track_ref === row.target_track_ref);
      const copiedItem = objectRefs.find((ref) => ref.kind === "item" && ref.ref === newItemRef);
      const compactItemProof = isPlainObject(sourceFootprint?.source_footprint)
        && isExactGuidRef(sourceFootprint?.source_take_ref, "take");
      const copiedItemProofValid = copiedItem === undefined
        ? compactItemProof
        : isAuthoritativeItemObjectRef(copiedItem) && copiedItem.ref === newItemRef;
      const sourceIdentityValid = rowSummary?.source_item_ref === undefined
        ? sourceFootprint?.source_item_ref === row.source_item_ref
        : rowSummary.source_item_ref === row.source_item_ref;
      const targetIdentityValid = rowSummary?.target_track_ref === undefined
        ? targetTrack?.target_track_ref === row.target_track_ref
        : rowSummary.target_track_ref === row.target_track_ref;
      if (!rowSummary || !isExactGuidRef(newItemRef, "item") || !isExactGuidRef(newTakeRef, "take")
        || !copiedItemProofValid
        || newItemRef === row.source_item_ref || !sourceIdentityValid
        || !targetIdentityValid || !valuesMatch(rowSummary.position_seconds, row.position_seconds)) {
        change.mutation = { status: "completed" };
        change.status = "readback_failed";
        executionFailure ??= { ...failed("ITEM_APPLY_VARIATION_COPY_IDENTITY_INVALID", `Batch result for ${row.id} omitted an exact new Item/Take identity or mismatched the requested source, Track, or position.`), phase: "readback" };
        continue;
      }
      const rowSourceTakeRef = rowSummary.source_item?.active_take_ref;
      const sharedSourceTakeRef = sourceFootprint?.source_take_ref;
      const sourceTakeRef = rowSourceTakeRef ?? sharedSourceTakeRef;
      const takeFxCopy = projectVerifiedTakeFxCopy(rowSummary.take_fx_copy, {
        sourceTakeRef,
        targetTakeRef: newTakeRef,
        objectRefs,
        sharedTakeFx: sourceFootprint?.source_footprint?.take_fx,
        sharedSourceTakeRef,
      });
      if (!takeFxCopy) {
        change.mutation = { status: "completed" };
        change.status = "readback_failed";
        executionFailure ??= { ...failed("ITEM_APPLY_VARIATION_TAKE_FX_COPY_INVALID", `Batch result for ${row.id} omitted or contradicted the verified active-Take FX copy proof.`), phase: "readback" };
        continue;
      }
      if (row.source_offset_seconds !== undefined && !valuesMatch(rowSummary.source_offset_seconds, row.source_offset_seconds)) {
        change.mutation = { status: "completed" };
        change.status = "readback_failed";
        executionFailure ??= { ...failed("ITEM_APPLY_VARIATION_OFFSET_READBACK_MISMATCH", `Source-offset readback for ${row.id} did not match the requested offset.`), phase: "readback" };
        continue;
      }
      change.new_item_ref = newItemRef;
      change.new_take_ref = newTakeRef;
      change.take_fx_copy = takeFxCopy;
      state.canonicalRefs.push(newItemRef, newTakeRef);
      change.mutation = { status: "completed" };
      change.live_readback = { status: "passed", source: "copy_batch_aggregate_readback" };
      change.status = "applied";
    }
  }
  state.timings.mutation_ms = monoElapsed(mutationStarted, monoNow);
  const liveTimings = executionSummary(copyExecution)?.batch_timings;
  state.timings.preflight_ms = finiteOrZero(liveTimings?.preflight_ms);
  state.timings.final_readback_ms = finiteOrZero(liveTimings?.readback_ms);
  state.timings.transport_ms = finiteOrZero(liveTimings?.transport_ms);
  state.timings.evidence_ms = finiteOrZero(liveTimings?.evidence_ms);
  const indexStarted = monoTick(monoNow);
  const indexResult = maintainBatchProjectIndex(projectIndexRuntime, state, now);
  state.timings.index_maintenance_ms = monoElapsed(indexStarted, monoNow);
  state.timings.total_ms = monoElapsed(t0, monoNow);
  applyBatchIndexMaintenance(state.changes, indexResult);
  pushStage(stages, "items-apply-mutate", "template_execute", executionFailure?.phase === "mutation" ? "failed" : "completed", `${state.changes.filter((change) => change.mutation?.status === "completed").length} variation row(s) completed mutation.`, state.evidenceRefs);
  pushStage(stages, "items-apply-verify", "verify", executionFailure?.phase === "readback" ? "failed" : "completed", `${state.changes.filter((change) => change.live_readback?.status === "passed").length} variation row(s) passed copy-atom Item/Take/Track/position and Take-FX readback.`, state.evidenceRefs);
  pushStage(stages, "items-apply-index", "index_update", indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed", indexResult.message, []);
  if (executionFailure) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: state.changes.some((change) => change.mutation?.status === "completed" || change.status === "applied" || change.status === "unknown_or_partial" || typeof change.new_item_ref === "string") ? "partial_failure" : "failed", code: executionFailure.code, message: executionFailure.message, blockers: executionFailure.blockers, data: data(), compact: true });
  }
  if (indexResult.ok === false) {
    return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "partial_failure", code: indexResult.code, message: indexResult.message, blockers: indexResult.blockers, data: data(), compact: true });
  }
  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected compact Item variation truth.", state.evidenceRefs);
  return successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status: "completed", summary: `Created and verified ${state.changes.filter((change) => change.status === "applied").length} Item variation(s).`, data: data(), compact: true });
}

function variationFailure({ entry, request, startedAt, now, stages, state, activeBudget, data, code, message, blockers }) {
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "blocked", message, state.evidenceRefs);
  return failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, code, message, blockers, data });
}

function normalizeCreateVariationsInput(input) {
  if (!isPlainObject(input)) return failed("ITEM_APPLY_REQUEST_INVALID", "macro.items.apply input must be an object.");
  const allowed = new Set(["mode", "variations", "dry_run"]);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length > 0) return failed("ITEM_APPLY_VARIATIONS_FIELDS_INVALID", `create_variations accepts only mode, variations, and dry_run; unsupported field(s): ${unknown.join(", ")}.`);
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") return failed("ITEM_APPLY_REQUEST_INVALID", "dry_run must be boolean.");
  if (!Array.isArray(input.variations) || input.variations.length < 1 || input.variations.length > ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS) {
    return failed("ITEM_APPLY_VARIATIONS_INVALID", `variations must contain 1-${ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS} rows.`);
  }
  const ids = new Set();
  const variations = [];
  for (const [index, raw] of input.variations.entries()) {
    if (!isPlainObject(raw)) return failed("ITEM_APPLY_VARIATIONS_INVALID", `variations[${index}] must be an object.`);
    const rowUnknown = Object.keys(raw).filter((field) => !["id", "source_item_ref", "target_track_ref", "position_seconds", "source_offset_seconds"].includes(field));
    if (rowUnknown.length > 0) return failed("ITEM_APPLY_VARIATIONS_INVALID", `variations[${index}] has unsupported field(s): ${rowUnknown.join(", ")}.`);
    if (typeof raw.id !== "string" || !ALPHA3_3_B1C_ITEMS_BATCH_ROW_ID_PATTERN.test(raw.id)) return failed("ITEM_APPLY_BATCH_ROW_ID_INVALID", `variations[${index}].id must match ^[A-Za-z0-9_-]{1,12}$.`);
    if (ids.has(raw.id)) return failed("ITEM_APPLY_BATCH_ROW_ID_DUPLICATE", `variations repeats id ${raw.id}.`);
    ids.add(raw.id);
    if (!isExactGuidRef(raw.source_item_ref, "item") || !isExactGuidRef(raw.target_track_ref, "track")) return failed("ITEM_APPLY_EXACT_TARGET_REQUIRED", `variations[${index}] requires exact source_item_ref and target_track_ref GUID refs.`);
    if (!Number.isFinite(raw.position_seconds) || raw.position_seconds < 0) return failed("ITEM_APPLY_POSITION_INVALID", `variations[${index}].position_seconds must be a finite non-negative number.`);
    if (raw.source_offset_seconds !== undefined && (!Number.isFinite(raw.source_offset_seconds) || raw.source_offset_seconds < 0)) return failed("ITEM_APPLY_VARIATION_OFFSET_INVALID", `variations[${index}].source_offset_seconds must be a finite non-negative number when present.`);
    variations.push({ id: raw.id, source_item_ref: raw.source_item_ref, target_track_ref: raw.target_track_ref, position_seconds: raw.position_seconds, source_offset_seconds: raw.source_offset_seconds });
  }
  return { ok: true, input: { mode: "create_variations", dry_run: input.dry_run !== false, variations } };
}

function isAuthoritativeTrackObjectRef(value) {
  return isPlainObject(value)
    && value.kind === "track"
    && typeof value.ref === "string"
    && isExactGuidRef(value.ref, "track")
    && isPlainObject(value.identity)
    && value.identity.scheme === "guid"
    && value.identity.value === value.ref.slice("track:guid:".length);
}

function variationChange(row, { status, mutation, readback, index } = {}) {
  return compactObject({
    id: row.id,
    status,
    mutation: { status: mutation },
    live_readback: { status: readback },
    index_maintenance: { status: index, scopes: [] },
    source_item_ref: row.source_item_ref,
    target_track_ref: row.target_track_ref,
    position_seconds: row.position_seconds,
    source_offset_seconds: row.source_offset_seconds,
  });
}

function variationBatchData(state, { dry_run }) {
  return {
    mode: "create_variations",
    timings: {
      target_resolution_ms: state.timings?.target_resolution_ms ?? 0,
      preflight_ms: state.timings?.preflight_ms ?? 0,
      mutation_ms: state.timings?.mutation_ms ?? 0,
      final_readback_ms: state.timings?.final_readback_ms ?? 0,
      index_maintenance_ms: state.timings?.index_maintenance_ms ?? 0,
      total_ms: state.timings?.total_ms ?? 0,
    },
    calls: finalizeCalls(state.calls),
    dry_run: dry_run === true,
  };
}

async function executeSetItemTakeControlsBatch({
  entry,
  request,
  executeAtomic,
  projectIndexRuntime,
  now,
  monoNow = () => performance.now(),
  startedAt,
  stages,
  state,
  activeBudget,
}) {
  const t0 = monoTick(monoNow);
  state.batchMode = true;
  state.calls = emptyCalls();
  state.timings = emptyTimings();
  const normalized = normalizeSetItemTakeControlsInput(request.input);
  if (!normalized.ok) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: normalized.code,
      message: normalized.message,
      blockers: normalized.blockers,
      data: compactBatchData(state, { dry_run: request.input?.dry_run !== false }),
    });
  }
  const dryRun = normalized.input.dry_run;
  const programRequest = {
    macro_id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input: { mode: "set_item_take_controls", dry_run: dryRun, changes: normalized.input.changes },
    refs: request.refs ?? {},
    dry_run: dryRun,
  };
  const validation = validateMacroProgramRequest(programRequest, { registry: ALPHA3_3_B1C_ITEMS_APPLY_REGISTRY });
  if (!validation.valid) {
    const message = validation.errors.join("; ");
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_REQUEST_INVALID",
      message,
      blockers: validation.errors.map((error) => blocker("ITEM_APPLY_REQUEST_INVALID", error)),
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }
  if (typeof executeAtomic !== "function") {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      code: "ITEM_APPLY_LIVE_EXECUTOR_REQUIRED",
      message: "macro.items.apply requires the managed OpenReaper live executor.",
      data: compactBatchData(state, { dry_run: dryRun }),
    });
  }

  if (executeAtomic.supportsItemTakeControlsBatch === true) {
    return executeSetItemTakeControlsBatchNative({
      entry,
      request,
      executeAtomic,
      projectIndexRuntime,
      now,
      monoNow,
      startedAt,
      stages,
      state,
      activeBudget,
      normalized,
    });
  }

  const resolveStarted = monoTick(monoNow);
  const resolvedRows = [];
  for (const row of normalized.input.changes) {
    let resolveExecution;
    try {
      resolveExecution = await runAtomicCounted(executeAtomic, request, state, "resolve", {
        id: RESOLVE_ITEM_ID,
        input: { ref: row.item_ref },
        refs: {},
      });
    } catch (error) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "ITEM_APPLY_ATOMIC_FAILED",
        message: error?.message ?? "Item resolve failed.",
        blockers: [blocker("ITEM_APPLY_ATOMIC_FAILED", error?.message ?? "Item resolve failed.")],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    collectExecutionEvidence(state, resolveExecution);
    if (resolveExecution?.ok !== true) {
      const failure = atomicFailure(resolveExecution, RESOLVE_ITEM_ID);
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: failure.code,
        message: failure.message,
        blockers: failure.blockers,
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    const resolvedRef = executionObjectRefs(resolveExecution).find((ref) => ref.kind === "item");
    if (!isAuthoritativeItemObjectRef(resolvedRef)) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "ITEM_APPLY_RESOLVE_REF_REQUIRED",
        message: `Item resolver for ${row.item_ref} did not return an authoritative Item object ref.`,
        blockers: [blocker("ITEM_APPLY_RESOLVE_REF_REQUIRED", `Item resolver for ${row.item_ref} did not return an authoritative Item object ref.`)],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    if (resolvedRef.ref !== row.item_ref) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "ITEM_APPLY_ITEM_IDENTITY_MISMATCH",
        message: `Live resolver returned ${resolvedRef.ref} for requested ${row.item_ref}.`,
        blockers: [blocker("ITEM_APPLY_ITEM_IDENTITY_MISMATCH", `Live resolver returned ${resolvedRef.ref} for requested ${row.item_ref}.`)],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    state.canonicalRefs.push(resolvedRef.ref);
    resolvedRows.push({ ...row, item_object: resolvedRef });
  }
  state.timings.target_resolution_ms = monoElapsed(resolveStarted, monoNow);
  pushStage(stages, "items-apply-targets", "live_ref_resolve", "completed", `Resolved ${resolvedRows.length} exact live Item target(s).`, state.evidenceRefs);

  const preflightStarted = monoTick(monoNow);
  const preflightRows = [];
  for (const row of resolvedRows) {
    let readExecution;
    try {
      readExecution = await runAtomicCounted(executeAtomic, request, state, "preflight", {
        id: READ_ITEM_ID,
        input: { include_take_summary: true },
        refs: { item_ref: row.item_object },
      });
    } catch (error) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "ITEM_APPLY_ATOMIC_FAILED",
        message: error?.message ?? "Item preflight read failed.",
        blockers: [blocker("ITEM_APPLY_ATOMIC_FAILED", error?.message ?? "Item preflight read failed.")],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    collectExecutionEvidence(state, readExecution);
    if (readExecution?.ok !== true) {
      const failure = atomicFailure(readExecution, READ_ITEM_ID);
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: failure.code,
        message: failure.message,
        blockers: failure.blockers,
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    const summary = executionSummary(readExecution);
    if (summary.item_ref !== row.item_ref) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: "ITEM_APPLY_ITEM_IDENTITY_MISMATCH",
        message: `Preflight summary returned ${String(summary.item_ref)} for ${row.item_ref}.`,
        blockers: [blocker("ITEM_APPLY_ITEM_IDENTITY_MISMATCH", `Preflight summary returned ${String(summary.item_ref)} for ${row.item_ref}.`)],
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    if (row.take) {
      if (typeof summary.active_take_ref !== "string" || summary.active_take_ref.length === 0) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state, activeBudget,
          code: "ITEM_APPLY_ACTIVE_TAKE_REQUIRED",
          message: `${row.item_ref} has no Active Take for requested Take fields.`,
          blockers: [blocker("ITEM_APPLY_ACTIVE_TAKE_REQUIRED", `${row.item_ref} has no Active Take for requested Take fields.`)],
          data: compactBatchData(state, { dry_run: dryRun }),
        });
      }
      if (summary.active_take_ref !== row.take_ref) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state, activeBudget,
          code: "ITEM_APPLY_TAKE_IDENTITY_MISMATCH",
          message: `${row.id} requires active_take_ref=${row.take_ref}; live Active Take is ${summary.active_take_ref}.`,
          blockers: [blocker("ITEM_APPLY_TAKE_IDENTITY_MISMATCH", `${row.id} requires active_take_ref=${row.take_ref}; live Active Take is ${summary.active_take_ref}.`)],
          data: compactBatchData(state, { dry_run: dryRun }),
        });
      }
    }
    const finalLength = row.item?.length_seconds ?? summary.length_seconds;
    if (row.item?.snap_offset_seconds !== undefined) {
      if (!Number.isFinite(finalLength) || row.item.snap_offset_seconds > finalLength + POSITION_TOLERANCE) {
        return failureEnvelope({
          entry, request, startedAt, now, stages, state, activeBudget,
          code: "ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM",
          message: `${row.id} snap_offset_seconds exceeds the final Item length.`,
          blockers: [blocker("ITEM_APPLY_SNAP_OFFSET_OUTSIDE_ITEM", `${row.id} snap_offset_seconds exceeds the final Item length.`)],
          data: compactBatchData(state, { dry_run: dryRun }),
        });
      }
    }
    const planned = buildBatchRowPlan(row, summary);
    if (!planned.ok) {
      return failureEnvelope({
        entry, request, startedAt, now, stages, state, activeBudget,
        code: planned.code,
        message: planned.message,
        blockers: planned.blockers,
        data: compactBatchData(state, { dry_run: dryRun }),
      });
    }
    preflightRows.push({ row, summary, plan: planned.operations });
  }
  state.timings.preflight_ms = monoElapsed(preflightStarted, monoNow);
  pushStage(stages, "items-apply-preflight", "template_execute", "completed", `Preflighted ${preflightRows.length} Item/Take control row(s).`, state.evidenceRefs);

  state.operations = preflightRows.flatMap((entry) => entry.plan);
  state.changes = preflightRows.map((entry) => batchRowChange(entry.row, {
    status: dryRun ? "planned" : "pending",
    mutation: dryRun ? "not_run" : "pending",
    readback: dryRun ? "not_run" : "pending",
    index: dryRun ? "skipped" : "pending",
  }));

  if (dryRun) {
    state.timings.mutation_ms = 0;
    state.timings.final_readback_ms = 0;
    state.timings.index_maintenance_ms = 0;
    state.timings.total_ms = monoElapsed(t0, monoNow);
    pushStage(stages, "items-apply-mutate", "template_execute", "skipped", "dry_run=true; no Item/Take mutation was dispatched.", []);
    pushStage(stages, "items-apply-verify", "verify", "completed", "Validated the complete deterministic multi-row preview against live facts.", state.evidenceRefs);
    pushStage(stages, "items-apply-index", "index_update", "skipped", "Dry run did not stale the Project Index.", []);
    pushStage(stages, "items-apply-result", "result_project", "completed", "Projected the compact multi-row Item/Take control preview.", state.evidenceRefs);
    return successEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "dry_run_completed",
      summary: `Previewed ${preflightRows.length} Item/Take control row(s) with no mutation.`,
      data: compactBatchData(state, { dry_run: true }),
      compact: activeBudget <= MIN_RESPONSE_BUDGET,
    });
  }

  let executionFailure = null;
  let failedIndex = -1;
  let mutationWallMs = 0;
  let readbackWallMs = 0;
  for (let index = 0; index < preflightRows.length; index += 1) {
    const entryRow = preflightRows[index];
    const change = state.changes[index];
    let mutationUnknown = false;
    let mutationFailed = false;
    let mutationError = null;
    const rowMutationStarted = monoTick(monoNow);
    for (const operation of entryRow.plan) {
      let execution;
      try {
        execution = await runAtomicCounted(executeAtomic, request, state, "mutation", {
          id: operation.template_id,
          input: operation.input,
          refs: { item_ref: entryRow.row.item_object },
        });
      } catch (error) {
        mutationUnknown = true;
        mutationError = executionError(error, operation.template_id, "mutation");
        break;
      }
      collectExecutionEvidence(state, execution);
      if (execution?.ok !== true) {
        mutationFailed = true;
        mutationError = { ...atomicFailure(execution, operation.template_id), phase: "mutation" };
        break;
      }
    }
    mutationWallMs += monoElapsed(rowMutationStarted, monoNow);
    if (mutationFailed || mutationUnknown) {
      change.mutation = { status: mutationUnknown ? "unknown_or_partial" : "failed" };
      change.status = mutationUnknown ? "unknown_or_partial" : "failed";
    } else {
      change.mutation = { status: "completed" };
    }

    const readbackStarted = monoTick(monoNow);
    let readExecution;
    try {
      readExecution = await runAtomicCounted(executeAtomic, request, state, "readback", {
        id: READ_ITEM_ID,
        input: { include_take_summary: true },
        refs: { item_ref: entryRow.row.item_object },
      });
    } catch (error) {
      change.live_readback = { status: "failed" };
      change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
      executionFailure = executionError(error, READ_ITEM_ID, "readback");
      failedIndex = index;
      readbackWallMs += monoElapsed(readbackStarted, monoNow);
      break;
    }
    collectExecutionEvidence(state, readExecution);
    readbackWallMs += monoElapsed(readbackStarted, monoNow);
    if (readExecution?.ok !== true) {
      change.live_readback = { status: "failed" };
      change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
      executionFailure = { ...atomicFailure(readExecution, READ_ITEM_ID), phase: "readback" };
      failedIndex = index;
      break;
    }
    const summary = executionSummary(readExecution);
    const mismatch = batchRowMismatches(entryRow.row, summary);
    if (mismatch.length === 0 && summary.item_ref === entryRow.row.item_ref) {
      change.live_readback = { status: "passed", source: "final_read_item_summary" };
      if (!mutationFailed && !mutationUnknown) change.status = "applied";
      else change.status = "live_matched_with_mutation_uncertainty";
    } else {
      change.live_readback = { status: "failed", source: "final_read_item_summary", fields: mismatch };
      change.status = mutationUnknown || mutationFailed ? change.status : "readback_failed";
      change.fields = mismatch;
      change.code = "ITEM_APPLY_READBACK_MISMATCH";
      if (!mutationFailed && !mutationUnknown) {
        executionFailure = {
          ...failed(
            "ITEM_APPLY_READBACK_MISMATCH",
            `Final live readback for ${entryRow.row.id} did not match requested fields.`,
            [blocker("ITEM_APPLY_READBACK_MISMATCH", `Final live readback for ${entryRow.row.id} mismatched: ${mismatch.join(",")}.`)],
          ),
          phase: "readback",
        };
      } else {
        executionFailure = mutationError ?? {
          ...failed("ITEM_APPLY_ATOMIC_FAILED", `Row ${entryRow.row.id} mutation failed with final mismatch.`),
          phase: "mutation",
        };
      }
      failedIndex = index;
      break;
    }
    if (mutationFailed || mutationUnknown) {
      executionFailure = mutationError;
      failedIndex = index;
      break;
    }
  }
  state.timings.mutation_ms = mutationWallMs;
  state.timings.final_readback_ms = readbackWallMs;

  if (failedIndex >= 0) {
    for (let later = failedIndex + 1; later < state.changes.length; later += 1) {
      state.changes[later] = batchRowChange(preflightRows[later].row, {
        status: "not_run",
        mutation: "not_run",
        readback: "not_run",
        index: "not_run",
      });
    }
  }

  const indexStarted = monoTick(monoNow);
  const indexResult = maintainBatchProjectIndex(projectIndexRuntime, state, now);
  state.timings.index_maintenance_ms = monoElapsed(indexStarted, monoNow);
  state.timings.total_ms = monoElapsed(t0, monoNow);
  applyBatchIndexMaintenance(state.changes, indexResult);
  pushStage(
    stages,
    "items-apply-mutate",
    "template_execute",
    executionFailure?.phase === "mutation" ? "failed" : "completed",
    `${state.changes.filter((change) => change.mutation?.status === "completed" || change.status === "applied").length} row mutation phase(s) completed.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "items-apply-verify",
    "verify",
    executionFailure?.phase === "readback" ? "failed" : "completed",
    `${state.changes.filter((change) => change.live_readback?.status === "passed").length} row(s) passed final live readback.`,
    state.evidenceRefs,
  );
  pushStage(
    stages,
    "items-apply-index",
    "index_update",
    indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed",
    indexResult.message,
    [],
  );

  if (executionFailure) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: state.changes.some((change) => change.mutation?.status === "completed" || change.status === "applied" || change.status === "live_matched_with_mutation_uncertainty")
        ? "partial_failure"
        : "failed",
      code: executionFailure.code,
      message: executionFailure.message,
      blockers: executionFailure.blockers,
      data: compactBatchData(state, { dry_run: false }),
      compact: activeBudget <= MIN_RESPONSE_BUDGET,
    });
  }
  if (indexResult.ok === false) {
    return failureEnvelope({
      entry, request, startedAt, now, stages, state, activeBudget,
      status: "partial_failure",
      code: indexResult.code,
      message: indexResult.message,
      blockers: indexResult.blockers,
      data: compactBatchData(state, { dry_run: false }),
      compact: activeBudget <= MIN_RESPONSE_BUDGET,
    });
  }
  pushStage(stages, "items-apply-result", "result_project", "completed", "Projected compact multi-row Item/Take control truth.", state.evidenceRefs);
  return successEnvelope({
    entry, request, startedAt, now, stages, state, activeBudget,
    status: "completed",
    summary: `Applied and verified ${state.changes.filter((change) => change.status === "applied").length} Item/Take control row(s).`,
    data: compactBatchData(state, { dry_run: false }),
    compact: activeBudget <= MIN_RESPONSE_BUDGET,
  });
}

function normalizeSetItemTakeControlsInput(input) {
  if (!isPlainObject(input)) return failed("ITEM_APPLY_REQUEST_INVALID", "macro.items.apply input must be an object.");
  const allowed = new Set(["mode", "changes", "dry_run"]);
  const unknown = Object.keys(input).filter((field) => !allowed.has(field));
  if (unknown.length > 0) {
    return failed(
      "ITEM_APPLY_BATCH_FIELDS_INVALID",
      `set_item_take_controls accepts only mode, changes, and dry_run; unsupported field(s): ${unknown.join(", ")}.`,
    );
  }
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") {
    return failed("ITEM_APPLY_REQUEST_INVALID", "dry_run must be boolean.");
  }
  if (!Array.isArray(input.changes) || input.changes.length < 1 || input.changes.length > ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS) {
    return failed("ITEM_APPLY_BATCH_CHANGES_INVALID", `changes must contain 1-${ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS} rows.`);
  }
  const rows = [];
  const seenIds = new Set();
  const seenItems = new Set();
  for (const [index, raw] of input.changes.entries()) {
    if (!isPlainObject(raw)) return failed("ITEM_APPLY_BATCH_CHANGES_INVALID", `changes[${index}] must be an object.`);
    const rowUnknown = Object.keys(raw).filter((field) => !["id", "item_ref", "take_ref", "item", "take"].includes(field));
    if (rowUnknown.length > 0) {
      return failed("ITEM_APPLY_BATCH_CHANGES_INVALID", `changes[${index}] has unsupported field(s): ${rowUnknown.join(", ")}.`);
    }
    if (typeof raw.id !== "string" || !ALPHA3_3_B1C_ITEMS_BATCH_ROW_ID_PATTERN.test(raw.id)) {
      return failed("ITEM_APPLY_BATCH_ROW_ID_INVALID", `changes[${index}].id must match ^[A-Za-z0-9_-]{1,12}$.`);
    }
    if (seenIds.has(raw.id)) return failed("ITEM_APPLY_BATCH_ROW_ID_DUPLICATE", `changes repeats id ${raw.id}.`);
    seenIds.add(raw.id);
    if (!isExactGuidRef(raw.item_ref, "item")) {
      return failed("ITEM_APPLY_EXACT_TARGET_REQUIRED", `changes[${index}].item_ref must be an exact item:guid ref.`);
    }
    if (seenItems.has(raw.item_ref)) return failed("ITEM_APPLY_BATCH_ITEM_DUPLICATE", `changes repeats item_ref ${raw.item_ref}.`);
    seenItems.add(raw.item_ref);
    const item = normalizeBatchItemFields(raw.item, index);
    if (!item.ok) return item;
    const take = normalizeBatchTakeFields(raw.take, index);
    if (!take.ok) return take;
    const hasItem = item.value !== null;
    const hasTake = take.value !== null;
    if (!hasItem && !hasTake) {
      return failed("ITEM_APPLY_BATCH_FIELDS_REQUIRED", `changes[${index}] requires at least one accepted item or take field.`);
    }
    if (hasTake) {
      if (!isExactGuidRef(raw.take_ref, "take")) {
        return failed("ITEM_APPLY_TAKE_REF_REQUIRED", `changes[${index}].take_ref is required and must be an exact take:guid ref when take fields are present.`);
      }
    } else if (raw.take_ref !== undefined) {
      return failed("ITEM_APPLY_TAKE_REF_FORBIDDEN", `changes[${index}].take_ref is allowed only when take fields are requested.`);
    }
    rows.push({
      id: raw.id,
      item_ref: raw.item_ref,
      take_ref: hasTake ? raw.take_ref : undefined,
      item: item.value,
      take: take.value,
    });
  }
  return {
    ok: true,
    input: {
      mode: "set_item_take_controls",
      dry_run: input.dry_run !== false,
      changes: rows,
    },
  };
}

function normalizeBatchItemFields(value, index) {
  if (value === undefined) return { ok: true, value: null };
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return failed("ITEM_APPLY_BATCH_ITEM_FIELDS_INVALID", `changes[${index}].item must be a non-empty object when present.`);
  }
  const unknown = Object.keys(value).filter((field) => !ALPHA3_3_B1C_ITEMS_BATCH_ITEM_FIELDS.includes(field));
  if (unknown.length > 0) {
    return failed("ITEM_APPLY_BATCH_ITEM_FIELDS_INVALID", `changes[${index}].item has unsupported field(s): ${unknown.join(", ")}.`);
  }
  const normalized = {};
  if (value.volume_db !== undefined) {
    if (!Number.isFinite(value.volume_db) || value.volume_db < -120 || value.volume_db > 24) {
      return failed("ITEM_APPLY_PROPERTY_INVALID", `changes[${index}].item.volume_db must be a finite number from -120 to 24.`);
    }
    normalized.volume_db = value.volume_db;
  }
  if (value.length_seconds !== undefined) {
    if (!Number.isFinite(value.length_seconds) || value.length_seconds <= 0) {
      return failed("ITEM_APPLY_LENGTH_INVALID", `changes[${index}].item.length_seconds must be a finite number greater than zero.`);
    }
    normalized.length_seconds = value.length_seconds;
  }
  if (value.fade_in_seconds !== undefined) {
    if (!Number.isFinite(value.fade_in_seconds) || value.fade_in_seconds < 0) {
      return failed("ITEM_APPLY_FADES_INVALID", `changes[${index}].item.fade_in_seconds must be a non-negative finite number.`);
    }
    normalized.fade_in_seconds = value.fade_in_seconds;
  }
  if (value.fade_out_seconds !== undefined) {
    if (!Number.isFinite(value.fade_out_seconds) || value.fade_out_seconds < 0) {
      return failed("ITEM_APPLY_FADES_INVALID", `changes[${index}].item.fade_out_seconds must be a non-negative finite number.`);
    }
    normalized.fade_out_seconds = value.fade_out_seconds;
  }
  if (value.snap_offset_seconds !== undefined) {
    if (!Number.isFinite(value.snap_offset_seconds) || value.snap_offset_seconds < 0) {
      return failed("ITEM_APPLY_SNAP_OFFSET_INVALID", `changes[${index}].item.snap_offset_seconds must be a non-negative finite number.`);
    }
    normalized.snap_offset_seconds = value.snap_offset_seconds;
  }
  return { ok: true, value: normalized };
}

function normalizeBatchTakeFields(value, index) {
  if (value === undefined) return { ok: true, value: null };
  if (!isPlainObject(value) || Object.keys(value).length === 0) {
    return failed("ITEM_APPLY_BATCH_TAKE_FIELDS_INVALID", `changes[${index}].take must be a non-empty object when present.`);
  }
  const unknown = Object.keys(value).filter((field) => !ALPHA3_3_B1C_ITEMS_BATCH_TAKE_FIELDS.includes(field));
  if (unknown.length > 0) {
    return failed("ITEM_APPLY_BATCH_TAKE_FIELDS_INVALID", `changes[${index}].take has unsupported field(s): ${unknown.join(", ")}.`);
  }
  const normalized = {};
  if (value.volume_db !== undefined) {
    if (!Number.isFinite(value.volume_db) || value.volume_db < -120 || value.volume_db > 24) {
      return failed("ITEM_APPLY_PROPERTY_INVALID", `changes[${index}].take.volume_db must be a finite number from -120 to 24.`);
    }
    normalized.volume_db = value.volume_db;
  }
  if (value.pan !== undefined) {
    if (!Number.isFinite(value.pan) || value.pan < -1 || value.pan > 1) {
      return failed("ITEM_APPLY_TAKE_PAN_INVALID", `changes[${index}].take.pan must be a finite number from -1 to 1.`);
    }
    normalized.pan = value.pan;
  }
  if (value.pitch_semitones !== undefined) {
    if (!Number.isFinite(value.pitch_semitones)) {
      return failed("ITEM_APPLY_TAKE_PITCH_INVALID", `changes[${index}].take.pitch_semitones must be a finite number.`);
    }
    normalized.pitch_semitones = value.pitch_semitones;
  }
  if (value.playrate !== undefined) {
    if (!Number.isFinite(value.playrate) || value.playrate <= 0 || value.playrate > 16) {
      return failed("ITEM_APPLY_PLAYRATE_INVALID", `changes[${index}].take.playrate must be a finite number greater than zero and at most 16.`);
    }
    normalized.playrate = value.playrate;
  }
  if (value.preserve_pitch !== undefined) {
    if (typeof value.preserve_pitch !== "boolean") {
      return failed("ITEM_APPLY_PRESERVE_PITCH_REQUIRED", `changes[${index}].take.preserve_pitch must be boolean.`);
    }
    normalized.preserve_pitch = value.preserve_pitch;
  }
  return { ok: true, value: normalized };
}

function buildBatchRowPlan(row, summary) {
  const plan = [];
  if (row.item?.volume_db !== undefined) {
    plan.push({ template_id: SET_ITEM_VOLUME_ID, field: "volume_db", input: { volume_db: row.item.volume_db } });
  }
  if (row.item?.length_seconds !== undefined) {
    plan.push({ template_id: TRIM_ITEM_ID, field: "length_seconds", input: { length_seconds: row.item.length_seconds } });
  }
  if (row.item?.fade_in_seconds !== undefined || row.item?.fade_out_seconds !== undefined) {
    const fadeIn = row.item?.fade_in_seconds !== undefined ? row.item.fade_in_seconds : summary.fade_in_seconds;
    const fadeOut = row.item?.fade_out_seconds !== undefined ? row.item.fade_out_seconds : summary.fade_out_seconds;
    if (!Number.isFinite(fadeIn) || fadeIn < 0) {
      return failed(
        "ITEM_APPLY_FADE_COUNTERPART_INVALID",
        `${row.id} omitted fade_in_seconds but live preflight fade_in_seconds is absent or invalid.`,
      );
    }
    if (!Number.isFinite(fadeOut) || fadeOut < 0) {
      return failed(
        "ITEM_APPLY_FADE_COUNTERPART_INVALID",
        `${row.id} omitted fade_out_seconds but live preflight fade_out_seconds is absent or invalid.`,
      );
    }
    plan.push({
      template_id: SET_ITEM_FADES_ID,
      field: "fades",
      input: {
        fade_in_seconds: fadeIn,
        fade_out_seconds: fadeOut,
      },
    });
  }
  if (row.item?.snap_offset_seconds !== undefined) {
    plan.push({ template_id: SET_ITEM_SNAP_OFFSET_ID, field: "snap_offset_seconds", input: { snap_offset_seconds: row.item.snap_offset_seconds } });
  }
  if (row.take?.volume_db !== undefined) {
    plan.push({ template_id: SET_TAKE_VOLUME_ID, field: "take_volume_db", input: { volume_db: row.take.volume_db } });
  }
  if (row.take?.pan !== undefined) {
    plan.push({ template_id: SET_TAKE_PAN_ID, field: "take_pan", input: { pan: row.take.pan } });
  }
  if (row.take?.pitch_semitones !== undefined) {
    plan.push({ template_id: SET_TAKE_PITCH_ID, field: "take_pitch_semitones", input: { semitones: row.take.pitch_semitones } });
  }
  if (row.take?.playrate !== undefined || row.take?.preserve_pitch !== undefined) {
    const playrate = row.take?.playrate !== undefined ? row.take.playrate : summary.playrate;
    const preservePitch = row.take?.preserve_pitch !== undefined ? row.take.preserve_pitch : summary.preserve_pitch;
    if (!Number.isFinite(playrate) || playrate <= 0 || playrate > 16) {
      return failed(
        "ITEM_APPLY_PLAYBACK_COUNTERPART_INVALID",
        `${row.id} omitted playrate but live preflight playrate is absent or invalid.`,
      );
    }
    if (typeof preservePitch !== "boolean") {
      return failed(
        "ITEM_APPLY_PLAYBACK_COUNTERPART_INVALID",
        `${row.id} omitted preserve_pitch but live preflight preserve_pitch is not an actual boolean.`,
      );
    }
    plan.push({
      template_id: SET_TAKE_PLAYRATE_ID,
      field: "take_playback",
      input: {
        playrate,
        preserve_pitch: preservePitch,
      },
    });
  }
  return { ok: true, operations: plan };
}

function isAuthoritativeItemObjectRef(value) {
  return isPlainObject(value)
    && value.kind === "item"
    && typeof value.ref === "string"
    && value.ref.startsWith("item:guid:")
    && isExactGuidRef(value.ref, "item")
    && isPlainObject(value.identity)
    && value.identity.scheme === "guid"
    && value.identity.value === value.ref.slice("item:guid:".length);
}

function batchRowMismatches(row, summary) {
  const mismatched = [];
  if (summary.item_ref !== row.item_ref) mismatched.push("item_ref");
  if (row.item?.volume_db !== undefined && !valuesMatch(summary.volume_db, row.item.volume_db)) mismatched.push("volume_db");
  if (row.item?.length_seconds !== undefined && !valuesMatch(summary.length_seconds, row.item.length_seconds)) mismatched.push("length_seconds");
  if (row.item?.fade_in_seconds !== undefined && !valuesMatch(summary.fade_in_seconds, row.item.fade_in_seconds)) mismatched.push("fade_in_seconds");
  if (row.item?.fade_out_seconds !== undefined && !valuesMatch(summary.fade_out_seconds, row.item.fade_out_seconds)) mismatched.push("fade_out_seconds");
  if (row.item?.snap_offset_seconds !== undefined && !valuesMatch(summary.snap_offset_seconds, row.item.snap_offset_seconds)) mismatched.push("snap_offset_seconds");
  if (row.take) {
    if (summary.active_take_ref !== row.take_ref) mismatched.push("active_take_ref");
    if (row.take.volume_db !== undefined && !valuesMatch(summary.take_volume_db, row.take.volume_db)) mismatched.push("take_volume_db");
    if (row.take.pan !== undefined && !valuesMatch(summary.take_pan, row.take.pan)) mismatched.push("take_pan");
    if (row.take.pitch_semitones !== undefined && !valuesMatch(summary.take_pitch_semitones, row.take.pitch_semitones)) mismatched.push("take_pitch_semitones");
    if (row.take.playrate !== undefined && !valuesMatch(summary.playrate, row.take.playrate)) mismatched.push("playrate");
    if (row.take.preserve_pitch !== undefined && summary.preserve_pitch !== row.take.preserve_pitch) mismatched.push("preserve_pitch");
  }
  return mismatched;
}

function batchRowChange(row, { status, mutation, readback, index, code, fields } = {}) {
  return compactObject({
    id: row.id,
    status,
    mutation: { status: mutation },
    live_readback: { status: readback },
    index_maintenance: { status: index, scopes: [] },
    code,
    fields,
    item_ref: row.item_ref,
    take_ref: row.take_ref,
    item: row.item,
    take: row.take,
  });
}

function compactBatchData(state, { dry_run }) {
  return {
    mode: "set_item_take_controls",
    timings: {
      target_resolution_ms: state.timings?.target_resolution_ms ?? 0,
      preflight_ms: state.timings?.preflight_ms ?? 0,
      mutation_ms: state.timings?.mutation_ms ?? 0,
      final_readback_ms: state.timings?.final_readback_ms ?? 0,
      index_maintenance_ms: state.timings?.index_maintenance_ms ?? 0,
      total_ms: state.timings?.total_ms ?? 0,
    },
    calls: finalizeCalls(state.calls),
    dry_run: dry_run === true,
    ...(state.nativeBatch
      ? {
          batch_timings: clone(state.nativeBatch.batch_timings),
          native_counters: clone(state.nativeBatch.native_counters),
          transport_call_count: state.nativeBatch.transport_call_count,
        }
      : {}),
  };
}

function emptyCalls() {
  return { resolve: 0, preflight: 0, mutation: 0, readback: 0, index: 0, total: 0 };
}

function emptyTimings() {
  return {
    target_resolution_ms: 0,
    preflight_ms: 0,
    mutation_ms: 0,
    final_readback_ms: 0,
    index_maintenance_ms: 0,
    total_ms: 0,
  };
}

function finalizeCalls(calls) {
  const value = calls ?? emptyCalls();
  return {
    resolve: value.resolve,
    preflight: value.preflight,
    mutation: value.mutation,
    readback: value.readback,
    index: value.index,
    total: value.resolve + value.preflight + value.mutation + value.readback + value.index,
  };
}

function runAtomicCounted(executeAtomic, request, state, counter, child) {
  if (state.calls && Object.hasOwn(state.calls, counter)) state.calls[counter] += 1;
  return runAtomic(executeAtomic, request, child);
}

function maintainBatchProjectIndex(runtime, state, now) {
  const attempted = state.changes.some((change) => ["completed", "unknown_or_partial", "failed"].includes(change.mutation?.status));
  if (!attempted) return { ok: true, status: "skipped", message: "No mutation was attempted; Project Index scopes were left unchanged.", scopes: [] };
  if (typeof runtime?.invalidateScopes !== "function") {
    return { ok: true, status: "skipped", message: "No Project Index runtime was configured; live readback remains the result authority.", scopes: [] };
  }
  const scopes = ["items", "takes"];
  if (state.calls) state.calls.index += 1;
  let result;
  try {
    result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
  } catch (error) {
    return {
      ok: false,
      status: "failed",
      code: "ITEM_APPLY_INDEX_INVALIDATION_FAILED",
      message: error?.message ?? "Project Index invalidation threw.",
      blockers: [blocker("ITEM_APPLY_INDEX_INVALIDATION_FAILED", error?.message ?? "Project Index invalidation threw.")],
      scopes,
    };
  }
  state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
  if (result?.ok === false) {
    return {
      ok: false,
      status: "failed",
      code: result?.blockers?.[0]?.code ?? "ITEM_APPLY_INDEX_INVALIDATION_FAILED",
      message: result?.blockers?.[0]?.message ?? "Project Index invalidation failed.",
      blockers: result?.blockers ?? [blocker("ITEM_APPLY_INDEX_INVALIDATION_FAILED", "Project Index invalidation failed.")],
      scopes,
    };
  }
  return { ok: true, status: "completed", message: `Invalidated Project Index scopes once: ${scopes.join(", ")}.`, scopes };
}

function applyBatchIndexMaintenance(changes, indexResult) {
  for (const change of changes) {
    if (change.status === "not_run" || change.mutation?.status === "not_run" || change.mutation?.status === "pending") {
      if (change.index_maintenance?.status === "pending") {
        change.index_maintenance = { status: "not_run", scopes: [] };
      }
      continue;
    }
    if (["completed", "unknown_or_partial", "failed"].includes(change.mutation?.status) || change.status === "applied" || change.status === "live_matched_with_mutation_uncertainty") {
      change.index_maintenance = {
        status: indexResult.ok === false ? "failed" : indexResult.status === "skipped" ? "skipped" : "completed",
        scopes: indexResult.scopes ?? [],
      };
    }
  }
}

function monoTick(monoNow) {
  if (typeof monoNow === "function") {
    try {
      const value = monoNow();
      if (typeof value === "number" && Number.isFinite(value)) return value;
    } catch {
      // fall through
    }
  }
  return performance.now();
}

function monoElapsed(started, monoNow) {
  return Math.max(0, monoTick(monoNow) - started);
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

function normalizeInput(input) {
  if (!isPlainObject(input)) return failed("ITEM_APPLY_REQUEST_INVALID", "macro.items.apply input must be an object.");
  const unknown = Object.keys(input).filter((field) => !INPUT_FIELDS.has(field));
  if (unknown.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `Unsupported input field(s): ${unknown.join(", ")}. No model-supplied steps are accepted.`);
  const mode = input.mode;
  if (!ALPHA3_3_B1C_ITEMS_APPLY_MODES.includes(mode)) {
    const held = ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES.includes(mode);
    return failed(held ? "ITEM_APPLY_MODE_HELD" : "ITEM_APPLY_MODE_UNSUPPORTED", `mode=${String(mode)} is not executable; supported modes are ${ALPHA3_3_B1C_ITEMS_APPLY_MODES.join(", ")}.`);
  }
  if (mode === "set_item_take_controls") {
    return failed("ITEM_APPLY_REQUEST_INVALID", "set_item_take_controls must be handled by the dedicated batch path.");
  }
  if (mode !== "select_exact" && input.selection_mode !== undefined) {
    return failed("ITEM_APPLY_REQUEST_INVALID", "selection_mode is valid only for select_exact.");
  }
  if (!isAudioBatchMode(mode) && input.adjacent_audio !== undefined) {
    return failed("ITEM_APPLY_REQUEST_INVALID", "adjacent_audio is valid only for remove_silence or normalize_level.");
  }
  const target = input.target ?? "selected";
  if (!["selected", "exact"].includes(target)) return failed("ITEM_APPLY_TARGET_SELECTOR_UNSUPPORTED", "target must be selected or exact.");
  const targetRefs = input.target_refs ?? [];
  if (!Array.isArray(targetRefs) || targetRefs.some((ref) => !isExactItemToken(ref))) {
    const result = failed("ITEM_APPLY_EXACT_TARGET_REQUIRED", "target_refs must contain only non-empty exact item:guid or guid Item refs.");
    return isAudioBatchMode(mode) ? { ...result, zero_write: true } : result;
  }
  const maxTargets = maxTargetsForMode(mode);
  // Audio batches must reach executeAudioBatchMacro so its explicit 65-target
  // guard emits typed zero-write truth without resolving or dispatching refs.
  if (targetRefs.length > maxTargets && !isAudioBatchMode(mode)) return failed("ITEM_APPLY_TARGET_LIMIT_EXCEEDED", `target_refs exceeds the maximum of ${maxTargets}; zero_write=true and no REAPER analysis or mutation was started.`);
  const limit = input.limit ?? (isAudioBatchMode(mode) ? AUDIO_BATCH_MAX_TARGETS : DEFAULT_TARGET_LIMIT);
  if (!Number.isInteger(limit) || limit < 1 || limit > maxTargets) return failed("ITEM_APPLY_REQUEST_INVALID", `limit must be an integer from 1 to ${maxTargets}.`);
  const dryRun = input.dry_run !== false;
  if (typeof input.dry_run !== "undefined" && typeof input.dry_run !== "boolean") return failed("ITEM_APPLY_REQUEST_INVALID", "dry_run must be boolean.");
  const anchor = optionalNonNegativeNumber(input.anchor_seconds, "anchor_seconds");
  if (!anchor.ok) return anchor;
  const gap = optionalNonNegativeNumber(input.gap_seconds, "gap_seconds");
  if (!gap.ok) return gap;

  let properties = null;
  let activeTakeAssignments = null;
  let trackAssignments = null;
  let fadeInSeconds = null;
  let fadeOutSeconds = null;
  let lengthSeconds = null;
  let playrate = null;
  let preservePitch = null;
  let snapOffsetSeconds = null;
  let silenceThresholdDbfs = null;
  let minSilenceMs = null;
  let silenceScope = null;
  let keepBeforeMs = null;
  let keepAfterMs = null;
  let minKeptAudioMs = null;
  let fadeMs = null;
  let normalizationMetric = null;
  let normalizationTarget = null;
  let selectionMode = null;
  let adjacentAudio = null;
  let transientDeltaLinear = null;
  let minTransientGapMs = null;
  if (mode !== "stack_on_existing_tracks" && input.track_assignments !== undefined) {
    return failed("ITEM_APPLY_REQUEST_INVALID", "track_assignments is valid only for stack_on_existing_tracks.");
  }
  if (mode === "select_exact") {
    const unsupported = Object.keys(input).filter((field) => !["mode", "target_refs", "selection_mode", "dry_run"].includes(field));
    if (unsupported.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `select_exact does not accept field(s): ${unsupported.join(", ")}.`);
    if (targetRefs.length < 1 || targetRefs.length > AUDIO_BATCH_MAX_TARGETS || targetRefs.some((ref) => !isExactGuidRef(ref, "item")) || new Set(targetRefs).size !== targetRefs.length) {
      return failed("ITEM_APPLY_EXACT_TARGET_REQUIRED", "select_exact requires 1-64 unique canonical item:guid:{GUID} refs.");
    }
    selectionMode = input.selection_mode ?? "replace";
    if (!["replace", "add", "remove"].includes(selectionMode)) return failed("ITEM_APPLY_SELECTION_MODE_INVALID", "selection_mode must be replace, add, or remove.");
  } else if (mode === "set_properties") {
    const normalizedProperties = normalizeProperties(input.properties);
    if (!normalizedProperties.ok) return normalizedProperties;
    properties = normalizedProperties.value;
    if (input.active_take_assignments !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", "set_properties does not accept active_take_assignments.");
    if (anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_properties does not accept anchor_seconds or gap_seconds.");
  } else if (mode === "set_active_take") {
    const normalizedAssignments = normalizeActiveTakeAssignments(input.active_take_assignments);
    if (!normalizedAssignments.ok) return normalizedAssignments;
    activeTakeAssignments = normalizedAssignments.value;
    if (input.target !== undefined || targetRefs.length > 0 || input.limit !== undefined || input.properties !== undefined || anchor.value !== null || gap.value !== null) {
      return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", "set_active_take accepts only active_take_assignments and dry_run; selection, target_refs, limit, properties, anchor_seconds, and gap_seconds are forbidden.");
    }
  } else if (mode === "stack_on_existing_tracks") {
    const normalizedAssignments = normalizeTrackAssignments(input.track_assignments);
    if (!normalizedAssignments.ok) return normalizedAssignments;
    trackAssignments = normalizedAssignments.value;
    const unsupported = Object.keys(input).filter((field) => !["mode", "track_assignments", "dry_run"].includes(field));
    if (unsupported.length > 0) {
      return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `stack_on_existing_tracks accepts only track_assignments and dry_run; unsupported field(s): ${unsupported.join(", ")}.`);
    }
  } else if (mode === "apply_fades") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "apply_fades accepts targets, fade_in_seconds, fade_out_seconds, limit, and dry_run only.");
    const fadeIn = optionalNullableNonNegativeNumber(input.fade_in_seconds, "fade_in_seconds");
    const fadeOut = optionalNullableNonNegativeNumber(input.fade_out_seconds, "fade_out_seconds");
    if (!fadeIn.ok) return fadeIn;
    if (!fadeOut.ok) return fadeOut;
    if (input.fade_in_seconds === undefined && input.fade_out_seconds === undefined) return failed("ITEM_APPLY_FADES_REQUIRED", "apply_fades requires fade_in_seconds and/or fade_out_seconds; omitted sides clear to zero only when the other side is supplied.");
    fadeInSeconds = fadeIn.value;
    fadeOutSeconds = fadeOut.value;
  } else if (mode === "trim_exact") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "trim_exact accepts targets, length_seconds, limit, and dry_run only.");
    if (!Number.isFinite(input.length_seconds) || input.length_seconds <= 0) return failed("ITEM_APPLY_LENGTH_INVALID", "trim_exact length_seconds must be a finite number greater than zero.");
    lengthSeconds = input.length_seconds;
  } else if (mode === "set_take_playback") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_take_playback accepts targets, playrate, preserve_pitch, limit, and dry_run only.");
    if (!Number.isFinite(input.playrate) || input.playrate <= 0 || input.playrate > 16) return failed("ITEM_APPLY_PLAYRATE_INVALID", "set_take_playback playrate must be a finite number greater than zero and at most 16.");
    if (typeof input.preserve_pitch !== "boolean") return failed("ITEM_APPLY_PRESERVE_PITCH_REQUIRED", "set_take_playback requires explicit boolean preserve_pitch.");
    playrate = input.playrate;
    preservePitch = input.preserve_pitch;
  } else if (mode === "set_snap_offset") {
    if (input.properties !== undefined || input.active_take_assignments !== undefined || anchor.value !== null || gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", "set_snap_offset accepts targets, snap_offset_seconds, limit, and dry_run only.");
    if (!Number.isFinite(input.snap_offset_seconds) || input.snap_offset_seconds < 0) return failed("ITEM_APPLY_SNAP_OFFSET_INVALID", "set_snap_offset snap_offset_seconds must be a non-negative finite number.");
    snapOffsetSeconds = input.snap_offset_seconds;
  } else if (mode === "remove_silence") {
    const unsupported = Object.keys(input).filter((field) => !["mode", "target", "target_refs", "limit", "dry_run", "adjacent_audio", "silence_threshold_dbfs", "min_silence_ms", "silence_scope", "keep_before_ms", "keep_after_ms", "min_kept_audio_ms", "fade_ms"].includes(field));
    if (unsupported.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `remove_silence does not accept field(s): ${unsupported.join(", ")}.`);
    if (target !== "selected" && target !== "exact") return failed("ITEM_APPLY_TARGET_SELECTOR_UNSUPPORTED", "remove_silence target must be selected or exact.");
    silenceThresholdDbfs = input.silence_threshold_dbfs ?? -60;
    minSilenceMs = input.min_silence_ms ?? 250;
    silenceScope = input.silence_scope ?? "all";
    keepBeforeMs = input.keep_before_ms ?? 20;
    keepAfterMs = input.keep_after_ms ?? 20;
    minKeptAudioMs = input.min_kept_audio_ms ?? 80;
    fadeMs = input.fade_ms ?? 5;
    adjacentAudio = input.adjacent_audio ?? null;
    if (!Number.isFinite(silenceThresholdDbfs) || silenceThresholdDbfs < -150 || silenceThresholdDbfs > 0) return failed("ITEM_APPLY_SILENCE_THRESHOLD_INVALID", "silence_threshold_dbfs must be a finite number from -150 to 0.");
    if (!Number.isFinite(minSilenceMs) || minSilenceMs < 1 || minSilenceMs > 60000) return failed("ITEM_APPLY_MIN_SILENCE_INVALID", "min_silence_ms must be a finite number from 1 to 60000.");
    if (!["all", "leading", "trailing", "edges", "internal"].includes(silenceScope)) return failed("ITEM_APPLY_SILENCE_SCOPE_INVALID", "silence_scope must be all, leading, trailing, edges, or internal.");
    for (const [field, value, minimum, maximum] of [["keep_before_ms", keepBeforeMs, 0, 5000], ["keep_after_ms", keepAfterMs, 0, 5000], ["min_kept_audio_ms", minKeptAudioMs, 0, 60000], ["fade_ms", fadeMs, 0, 1000]]) {
      if (!Number.isFinite(value) || value < minimum || value > maximum) return failed("ITEM_APPLY_SILENCE_PARAMETER_INVALID", `${field} must be a finite number from ${minimum} to ${maximum}.`);
    }
  } else if (mode === "normalize_level") {
    const unsupported = Object.keys(input).filter((field) => !["mode", "target", "target_refs", "limit", "dry_run", "adjacent_audio", "normalization_metric", "normalization_target"].includes(field));
    if (unsupported.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `normalize_level does not accept field(s): ${unsupported.join(", ")}.`);
    if (target !== "selected" && target !== "exact") return failed("ITEM_APPLY_TARGET_SELECTOR_UNSUPPORTED", "normalize_level target must be selected or exact.");
    normalizationMetric = input.normalization_metric;
    normalizationTarget = input.normalization_target;
    adjacentAudio = input.adjacent_audio ?? null;
    if (!["lufs_i", "rms_i", "peak", "true_peak", "lufs_m_max", "lufs_s_max"].includes(normalizationMetric)) return failed("ITEM_APPLY_NORMALIZATION_METRIC_INVALID", "normalization_metric must be one of lufs_i, rms_i, peak, true_peak, lufs_m_max, or lufs_s_max.");
    if (!Number.isFinite(normalizationTarget) || normalizationTarget > 0) return failed("ITEM_APPLY_NORMALIZATION_TARGET_INVALID", "normalization_target must be a finite dB/LUFS target at or below 0.");
  } else if (mode === "align_onsets") {
    const unsupported = Object.keys(input).filter((field) => !["mode", "target", "target_refs", "limit", "dry_run", "anchor_seconds", "transient_delta_linear", "min_transient_gap_ms"].includes(field));
    if (unsupported.length > 0) return failed("ITEM_APPLY_REQUEST_INVALID", `align_onsets does not accept field(s): ${unsupported.join(", ")}.`);
    transientDeltaLinear = input.transient_delta_linear ?? 0.25;
    minTransientGapMs = input.min_transient_gap_ms ?? 30;
    if (!Number.isFinite(transientDeltaLinear) || transientDeltaLinear <= 0 || transientDeltaLinear > 1024) return failed("ITEM_APPLY_TRANSIENT_THRESHOLD_INVALID", "transient_delta_linear must be a finite number greater than 0 and at most 1024.");
    if (!Number.isFinite(minTransientGapMs) || minTransientGapMs < 0 || minTransientGapMs > 60000) return failed("ITEM_APPLY_TRANSIENT_GAP_INVALID", "min_transient_gap_ms must be a finite number from 0 to 60000.");
  } else {
    if (input.properties !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", `${mode} does not accept properties.`);
    if (input.active_take_assignments !== undefined) return failed("ITEM_APPLY_REQUEST_INVALID", `${mode} does not accept active_take_assignments.`);
    if (mode === "move_to_anchor" && anchor.value === null) return failed("ITEM_APPLY_ANCHOR_REQUIRED", "move_to_anchor requires anchor_seconds.");
    if (mode !== "sequence_with_gap" && gap.value !== null) return failed("ITEM_APPLY_REQUEST_INVALID", `gap_seconds is valid only for sequence_with_gap.`);
  }
  if (adjacentAudio !== null) {
    if (!["left", "right", "both"].includes(adjacentAudio)) return failed("ITEM_APPLY_ADJACENT_AUDIO_INVALID", "adjacent_audio must be left, right, or both.");
    if (target !== "exact" || targetRefs.length !== 1 || !isExactGuidRef(targetRefs[0], "item")) {
      return { ...failed("ITEM_APPLY_ADJACENT_ANCHOR_REQUIRED", "adjacent_audio requires target=exact and exactly one canonical item:guid anchor ref."), zero_write: true };
    }
  }
  return {
    ok: true,
    input: {
      mode,
      target,
      target_refs: [...targetRefs],
      selection_mode: selectionMode,
      adjacent_audio: adjacentAudio,
      limit,
      dry_run: dryRun,
      anchor_seconds: anchor.value,
      gap_seconds: mode === "sequence_with_gap" ? gap.value ?? 0 : null,
      properties,
      active_take_assignments: activeTakeAssignments,
      track_assignments: trackAssignments,
      fade_in_seconds: fadeInSeconds,
      fade_out_seconds: fadeOutSeconds,
      length_seconds: lengthSeconds,
      playrate,
      preserve_pitch: preservePitch,
      snap_offset_seconds: snapOffsetSeconds,
      silence_threshold_dbfs: silenceThresholdDbfs,
      min_silence_ms: minSilenceMs,
      silence_scope: silenceScope,
      keep_before_ms: keepBeforeMs,
      keep_after_ms: keepAfterMs,
      min_kept_audio_ms: minKeptAudioMs,
      fade_ms: fadeMs,
      normalization_metric: normalizationMetric,
      normalization_target: normalizationTarget,
      transient_delta_linear: transientDeltaLinear,
      min_transient_gap_ms: minTransientGapMs,
    },
  };
}

function normalizeActiveTakeAssignments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments must contain 1-${MAX_TARGETS} rows.`);
  }
  const assignments = [];
  const seenItems = new Set();
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] must be an object.`);
    const unknown = Object.keys(row).filter((field) => !["item_ref", "take_ref"].includes(field));
    if (unknown.length > 0) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
    if (!isExactGuidRef(row.item_ref, "item") || !isExactGuidRef(row.take_ref, "take")) {
      return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments[${index}] requires exact canonical item:guid and take:guid refs.`);
    }
    if (seenItems.has(row.item_ref)) return failed("ITEM_APPLY_ACTIVE_TAKE_ASSIGNMENTS_INVALID", `active_take_assignments repeats ${row.item_ref}; each Item may receive exactly one requested Active Take.`);
    seenItems.add(row.item_ref);
    assignments.push({ item_ref: row.item_ref, take_ref: row.take_ref });
  }
  return { ok: true, value: assignments };
}

function isAudioBatchMode(mode) {
  return mode === "remove_silence" || mode === "normalize_level";
}

function maxTargetsForMode(mode) {
  return isAudioBatchMode(mode) || mode === "select_exact" ? AUDIO_BATCH_MAX_TARGETS : MAX_TARGETS;
}

function normalizeTrackAssignments(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_TARGETS) {
    return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments must contain 1-${MAX_TARGETS} rows.`);
  }
  const assignments = [];
  const seenItems = new Set();
  for (const [index, row] of value.entries()) {
    if (!isPlainObject(row)) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] must be an object.`);
    const unknown = Object.keys(row).filter((field) => !["item_ref", "target_track_ref"].includes(field));
    if (unknown.length > 0) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] has unsupported field(s): ${unknown.join(", ")}.`);
    if (!isExactGuidRef(row.item_ref, "item") || !isExactGuidRef(row.target_track_ref, "track")) {
      return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments[${index}] requires exact canonical item:guid and track:guid refs.`);
    }
    if (seenItems.has(row.item_ref)) return failed("ITEM_APPLY_TRACK_ASSIGNMENTS_INVALID", `track_assignments repeats ${row.item_ref}; each Item may receive exactly one destination Track.`);
    seenItems.add(row.item_ref);
    assignments.push({ item_ref: row.item_ref, target_track_ref: row.target_track_ref });
  }
  return { ok: true, value: assignments };
}

function normalizeProperties(value) {
  if (!isPlainObject(value) || Object.keys(value).length === 0) return failed("ITEM_APPLY_PROPERTIES_REQUIRED", "set_properties requires at least one property field.");
  if (Object.hasOwn(value, "pan")) {
    return failed(
      "ITEM_APPLY_ITEM_PAN_UNSUPPORTED",
      "pan is not a proven Item-level REAPER field. Confirm the current Active Take and use macro.controls.set target_kind=take or reviewed template.items.set_take_pan for an explicit Active Take pan request; multi-Take Items are never redirected silently.",
    );
  }
  const unknown = Object.keys(value).filter((field) => !ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS.includes(field));
  if (unknown.length > 0) return failed("ITEM_APPLY_PROPERTY_HELD", `Unsupported or held property field(s): ${unknown.join(", ")}.`);
  const normalized = {};
  for (const field of ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS) {
    if (!Object.hasOwn(value, field)) continue;
    const definition = PROPERTY_DEFINITIONS[field];
    const fieldValue = value[field];
    if (definition.type === "boolean" && typeof fieldValue !== "boolean") return failed("ITEM_APPLY_PROPERTY_INVALID", `${field} must be boolean.`);
    if (definition.type === "number" && (!Number.isFinite(fieldValue) || fieldValue < definition.min || fieldValue > definition.max)) {
      return failed("ITEM_APPLY_PROPERTY_INVALID", `${field} must be a finite number from ${definition.min} to ${definition.max}.`);
    }
    normalized[field] = fieldValue;
  }
  return { ok: true, value: normalized };
}

function optionalNonNegativeNumber(value, field) {
  if (value === undefined) return { ok: true, value: null };
  if (!Number.isFinite(value) || value < 0) return failed("ITEM_APPLY_REQUEST_INVALID", `${field} must be a non-negative finite number.`);
  return { ok: true, value };
}

function optionalNullableNonNegativeNumber(value, field) {
  if (value === undefined || value === null) return { ok: true, value: null };
  if (!Number.isFinite(value) || value < 0) return failed("ITEM_APPLY_REQUEST_INVALID", `${field} must be null or a non-negative finite number.`);
  return { ok: true, value };
}

function responseBudgetBlocker({ entry, request, input, stages, state, activeBudget }) {
  const projected = state.operations.map(previewChange);
  const projectedState = { ...state, changes: projected };
  const envelope = buildSuccessEnvelope({
    entry,
    request,
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:00.000Z",
    stages: [
      ...stages,
      { id: "items-apply-mutate", kind: "template_execute", status: "completed", summary: "Projected fixed mutation rows.", evidence_refs: [] },
      { id: "items-apply-verify", kind: "verify", status: "completed", summary: "Projected exact live readback rows.", evidence_refs: [] },
      { id: "items-apply-index", kind: "index_update", status: "completed", summary: "Projected affected-scope invalidation.", evidence_refs: [] },
      { id: "items-apply-result", kind: "result_project", status: "completed", summary: "Projected compact result.", evidence_refs: [] },
    ],
    state: projectedState,
    activeBudget: MACRO_CONTRACT_CEILINGS.envelope_max_bytes,
    status: input.dry_run ? "dry_run_completed" : "completed",
    summary: `Projected ${projected.length} Item operation row(s).`,
    data: resultData(input, projectedState),
  });
  const required = Buffer.byteLength(JSON.stringify(envelope), "utf8");
  if (required <= activeBudget) return null;
  return {
    code: "ITEM_APPLY_RESPONSE_BUDGET_EXCEEDED",
    message: `The compact ${state.operations.length}-row result needs about ${required} bytes but only ${activeBudget} response bytes are available; split the target/property set or raise the public response budget before mutation.`,
    recoverable: true,
    required_bytes: required,
  };
}

function maintainProjectIndex(runtime, state, now) {
  const completed = state.changes.filter((change) => change.mutation.status === "completed");
  const scopes = affectedScopes(state);
  if (completed.length === 0) return { ok: true, status: "skipped", message: "No completed mutation required index maintenance.", scopes: [] };
  if (!runtime || typeof runtime.invalidateScopes !== "function") return { ok: true, status: "skipped", message: "Project Index runtime was not attached; live readback remains the result authority.", scopes };
  try {
    const result = runtime.invalidateScopes({ scopes, observed_at: safeNowIso(now) });
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    if (result?.ok === false) {
      const first = result.blockers?.[0] ?? blocker("ITEM_APPLY_INDEX_MAINTENANCE_FAILED", "Project Index invalidation failed.");
      return { ok: false, status: "failed", code: first.code ?? "ITEM_APPLY_INDEX_MAINTENANCE_FAILED", message: first.message ?? "Project Index invalidation failed.", blockers: [first], scopes };
    }
    return { ok: true, status: "completed", message: `Invalidated the affected ${scopes.join("/")} scope(s) after live mutation/readback.`, scopes };
  } catch (error) {
    state.sqlite = sqliteEvidence(runtime, { used: true, freshness: "stale" });
    return { ok: false, status: "failed", code: "ITEM_APPLY_INDEX_MAINTENANCE_FAILED", message: error?.message ?? "Project Index invalidation failed.", blockers: [blocker("ITEM_APPLY_INDEX_MAINTENANCE_FAILED", error?.message ?? "Project Index invalidation failed.")], scopes };
  }
}

function affectedScopes(state) {
  if (state.operations.some((operation) => ["move_item_to_track", "remove_silence"].includes(operation.kind))) return ["items", "tracks", "takes"];
  return state.operations.some((operation) => ["set_active_take", "set_take_playback"].includes(operation.kind)) ? ["items", "takes"] : ["items"];
}

function applyIndexMaintenance(changes, indexResult) {
  for (const change of changes) {
    if (change.mutation.status !== "completed") continue;
    change.index_maintenance = {
      status: indexResult.status,
      scopes: indexResult.scopes ?? [],
      ...(indexResult.code ? { blocker_code: indexResult.code } : {}),
    };
  }
}

function successEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status, summary, data, compact = false }) {
  return finalizeEnvelope(buildSuccessEnvelope({
    entry,
    request,
    startedAt,
    completedAt: safeNowIso(now),
    stages,
    state,
    activeBudget,
    status,
    summary,
    data,
    compact,
  }));
}

function buildSuccessEnvelope({ entry, request, startedAt, completedAt, stages, state, activeBudget, status, summary, data, compact = false }) {
  const useCompact = compact === true || state.batchMode === true;
  const projectedData = useCompact ? projectCompactBatchData(data) : data;
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: true,
    macro: useCompact ? compactMacroIdentity(entry) : macroIdentity(entry),
    request: requestSummary(request),
    execution: useCompact
      ? { status, started_at: compactIso(startedAt), completed_at: compactIso(completedAt), stage_count: 0, stages: [] }
      : { status, started_at: startedAt, completed_at: completedAt, stage_count: stages.length, stages },
    sqlite: useCompact
      ? compactSqliteEvidence(state.sqlite)
      : (state.sqlite ?? sqliteEvidence()),
    result: {
      summary: useCompact ? String(summary ?? "").slice(0, 48) : summary,
      canonical_refs: useCompact ? [] : uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: useCompact
        ? projectCompactBatchChanges(state.changes, {
            includeControlTruth: activeBudget > MIN_RESPONSE_BUDGET && !isAudioBatchMode(projectedData?.mode),
            audioBatchSummary: isAudioBatchMode(projectedData?.mode) && projectedData?.returned_target_count > 8,
          })
        : clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: "passed",
        evidence_refs: useCompact
          ? (activeBudget > MIN_RESPONSE_BUDGET ? uniqueStrings(state.evidenceRefs).slice(0, 1) : [])
          : uniqueStrings(state.evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count),
      },
      data: projectedData,
    },
    blockers: [],
    error: null,
    recovery: null,
    budget: useCompact
      ? { max_bytes: activeBudget, actual_bytes: 0, truncated: false }
      : { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  return projectOversizedControlTruthToEvidence(envelope, state, projectedData, useCompact);
}

function failureEnvelope({ entry, request, startedAt, now, stages, state, activeBudget, status = "blocked", code, message, blockers = [], data = {}, compact = false }) {
  const useCompact = compact === true || state.batchMode === true;
  const zeroWrite = data?.zero_write === true;
  const verified = state.changes.length > 0
    && state.changes
      .filter((change) => change.mutation?.status === "completed" || change.status === "applied")
      .every((change) => change.live_readback?.status === "passed");
  const projectedData = useCompact ? projectCompactBatchData(data) : data;
  const envelope = {
    contract: MACRO_EXECUTION_CONTRACT,
    ok: false,
    macro: useCompact ? compactMacroIdentity(entry) : macroIdentity(entry),
    request: requestSummary(request, { forceNonDry: true }),
    execution: useCompact
      ? { status, started_at: compactIso(startedAt), completed_at: compactIso(safeNowIso(now)), stage_count: 0, stages: [] }
      : { status, started_at: startedAt, completed_at: safeNowIso(now), stage_count: stages.length, stages },
    sqlite: useCompact
      ? compactSqliteEvidence(state.sqlite)
      : (state.sqlite ?? sqliteEvidence()),
    result: {
      summary: useCompact ? String(message ?? "").slice(0, 48) : message,
      canonical_refs: useCompact ? [] : uniqueStrings(state.canonicalRefs).slice(0, MACRO_CONTRACT_CEILINGS.canonical_ref_max_count),
      changes: useCompact
        ? projectCompactBatchChanges(state.changes, {
            includeControlTruth: activeBudget > MIN_RESPONSE_BUDGET && !isAudioBatchMode(projectedData?.mode),
            audioBatchSummary: isAudioBatchMode(projectedData?.mode) && projectedData?.returned_target_count > 8,
          })
        : clone(state.changes).slice(0, MACRO_CONTRACT_CEILINGS.change_max_count),
      verification: {
        status: verified ? "passed" : status === "partial_failure" ? "failed" : "not_required",
        evidence_refs: useCompact
          ? (activeBudget > MIN_RESPONSE_BUDGET ? uniqueStrings(state.evidenceRefs).slice(0, 1) : [])
          : (status === "partial_failure" ? uniqueStrings(state.evidenceRefs) : []),
      },
      data: projectedData,
    },
    blockers: (blockers.length > 0 ? blockers : [blocker(code, message)])
      .slice(0, useCompact ? 1 : MACRO_CONTRACT_CEILINGS.blocker_max_count)
      .map((entry) => useCompact
        ? {
            code: entry.code,
            message: String(entry.message ?? "").slice(0, 64),
            recoverable: entry.recoverable !== false,
            ...(zeroWrite ? { details: { zero_write: true } } : {}),
          }
        : entry),
    error: {
      code,
      message: useCompact ? String(message ?? "").slice(0, 64) : message,
      recoverable: true,
      ...(zeroWrite ? { details: { zero_write: true } } : {}),
    },
    recovery: useCompact
      ? null
      : {
        undo_policy: REGISTRY_ENTRY.undo_policy,
        partial_changes_possible: status === "partial_failure",
        source_media_deleted: false,
        action: status === "partial_failure" ? "Inspect row truth and use the reported per-stage REAPER undo entries before retrying only the remaining task." : "Fix the typed preflight blocker and retry the bounded request.",
      },
    budget: useCompact
      ? { max_bytes: activeBudget, actual_bytes: 0, truncated: false }
      : { max_bytes: activeBudget, actual_bytes: 0, truncated: false, artifact_fallback: false },
  };
  return finalizeEnvelope(projectOversizedControlTruthToEvidence(envelope, state, projectedData, useCompact));
}

function projectCompactBatchChanges(changes, { includeControlTruth = false, audioBatchSummary = false } = {}) {
  return (Array.isArray(changes) ? changes : []).slice(0, ALPHA3_3_B1C_ITEMS_BATCH_MAX_ROWS).map((change) => {
    if (audioBatchSummary) {
      return compactObject({
        id: change.id,
        status: compactStatusToken(change.status),
      });
    }
    const mutation = typeof change.mutation === "string" ? change.mutation : (change.mutation?.status ?? "not_run");
    const readback = typeof change.live_readback === "string"
      ? change.live_readback
      : (change.live_readback?.status ?? "not_run");
    const index = typeof change.index_maintenance === "string"
      ? change.index_maintenance
      : (change.index_maintenance?.status ?? "not_run");
    return compactObject({
      id: change.id,
      status: compactStatusToken(change.status),
      mutation: compactStatusToken(mutation),
      readback: compactStatusToken(readback),
      index: typeof change.new_item_ref === "string" ? undefined : compactStatusToken(index),
      code: change.code ? String(change.code).replace(/^ITEM_APPLY_/u, "").slice(0, 24) : undefined,
      fields: Array.isArray(change.fields) ? change.fields.slice(0, 3) : undefined,
      item_ref: includeControlTruth && typeof change.item_ref === "string" ? change.item_ref : undefined,
      take_ref: includeControlTruth && typeof change.take_ref === "string" ? change.take_ref : undefined,
      item: includeControlTruth && isPlainObject(change.item) ? clone(change.item) : undefined,
      take: includeControlTruth && isPlainObject(change.take) ? clone(change.take) : undefined,
      new_item_ref: typeof change.new_item_ref === "string" ? change.new_item_ref : undefined,
      new_take_ref: typeof change.new_take_ref === "string" ? change.new_take_ref : undefined,
      take_fx_copy: compactVariationTakeFxCopy(change.take_fx_copy),
      position_seconds: Number.isFinite(change.position_seconds) ? change.position_seconds : undefined,
    });
  });
}

function compactVariationTakeFxCopy(value) {
  if (!isPlainObject(value) || !Array.isArray(value.slots)) return undefined;
  return {
    status: value.status,
    copied_count: value.copied_count,
    slots: value.slots.map((slot) => ({ target_fx_ref: slot.target_fx_ref })),
  };
}

function compactStatusToken(value) {
  switch (value) {
    case "applied": return "ok";
    case "planned": return "plan";
    case "pending": return "pend";
    case "not_run": return "skip";
    case "completed": return "done";
    case "failed": return "fail";
    case "passed": return "pass";
    case "skipped": return "skip";
    case "unknown_or_partial": return "unk";
    case "live_matched_with_mutation_uncertainty": return "unk";
    case "readback_failed": return "rbf";
    default: return String(value ?? "skip").slice(0, 8);
  }
}

function projectCompactBatchData(data) {
  const value = isPlainObject(data) ? data : {};
  return {
    mode: typeof value.mode === "string" ? value.mode : "set_item_take_controls",
    ...(value.zero_write === true ? { zero_write: true } : {}),
    ...(typeof value.target_scope === "string" ? { target_scope: value.target_scope } : {}),
    ...(typeof value.adjacent_audio === "string" ? { adjacent_audio: value.adjacent_audio } : {}),
    ...(Number.isInteger(value.target_count) ? { target_count: value.target_count } : {}),
    ...(Number.isInteger(value.returned_target_count) ? { returned_target_count: value.returned_target_count } : {}),
    ...(Number.isFinite(value.silence_threshold_dbfs) ? { silence_threshold_dbfs: value.silence_threshold_dbfs } : {}),
    ...(Number.isFinite(value.min_silence_ms) ? { min_silence_ms: value.min_silence_ms } : {}),
    ...(typeof value.silence_scope === "string" ? { silence_scope: value.silence_scope } : {}),
    ...(Number.isFinite(value.keep_before_ms) ? { keep_before_ms: value.keep_before_ms } : {}),
    ...(Number.isFinite(value.keep_after_ms) ? { keep_after_ms: value.keep_after_ms } : {}),
    ...(Number.isFinite(value.min_kept_audio_ms) ? { min_kept_audio_ms: value.min_kept_audio_ms } : {}),
    ...(Number.isFinite(value.fade_ms) ? { fade_ms: value.fade_ms } : {}),
    ...(typeof value.normalization_metric === "string" ? { normalization_metric: value.normalization_metric } : {}),
    ...(Number.isFinite(value.normalization_target) ? { normalization_target: value.normalization_target } : {}),
    ...(typeof value.measurement_scope === "string" ? { measurement_scope: value.measurement_scope } : {}),
    ...(typeof value.plan_hash === "string" ? { plan_hash: value.plan_hash } : {}),
    ...(Array.isArray(value.aggregate_readback) ? { aggregate_readback: value.aggregate_readback } : {}),
    ...(Number.isInteger(value.aggregate_readback_count)
      ? { aggregate_readback_count: value.aggregate_readback_count }
      : {}),
    ...(Array.isArray(value.artifact_refs)
      ? { artifact_refs: uniqueStrings(value.artifact_refs).slice(0, 2) }
      : {}),
    ...(isPlainObject(value.undo) ? { undo: clone(value.undo) } : {}),
    ...(typeof value.undo_opened === "boolean" ? { undo_opened: value.undo_opened } : {}),
    ...(typeof value.undo_closed === "boolean" ? { undo_closed: value.undo_closed } : {}),
    ...(Number.isFinite(value.total_ms) ? { total_ms: value.total_ms } : {}),
    timings: {
      target_resolution_ms: Math.round(Number(value.timings?.target_resolution_ms) || 0),
      preflight_ms: Math.round(Number(value.timings?.preflight_ms) || 0),
      mutation_ms: Math.round(Number(value.timings?.mutation_ms) || 0),
      final_readback_ms: Math.round(Number(value.timings?.final_readback_ms) || 0),
      index_maintenance_ms: Math.round(Number(value.timings?.index_maintenance_ms) || 0),
      total_ms: Math.round(Number(value.timings?.total_ms) || 0),
    },
    calls: finalizeCalls(value.calls),
    ...(isPlainObject(value.batch_timings) ? { batch_timings: clone(value.batch_timings) } : {}),
    ...(isPlainObject(value.native_counters) ? { native_counters: clone(value.native_counters) } : {}),
    ...(Number.isInteger(value.transport_call_count) ? { transport_call_count: value.transport_call_count } : {}),
  };
}

function projectOversizedControlTruthToEvidence(envelope, state, projectedData, useCompact) {
  if (!useCompact
      || projectedData?.mode !== "set_item_take_controls"
      || !macroEnvelopeExceedsPublicBudget(envelope)) {
    return envelope;
  }
  const projected = structuredClone(envelope);
  projected.result.changes = projectCompactBatchChanges(state.changes, { includeControlTruth: false });
  projected.result.data = {
    ...projected.result.data,
    detail_projection: "verification_evidence",
    projected_row_count: projected.result.changes.length,
  };
  projected.budget.artifact_fallback = projected.result.verification.evidence_refs.length > 0;
  return projected;
}

function macroEnvelopeExceedsPublicBudget(envelope) {
  const candidate = structuredClone(envelope);
  for (let attempt = 0; attempt < 4; attempt += 1) {
    candidate.budget.actual_bytes = Buffer.byteLength(JSON.stringify(candidate), "utf8");
  }
  const inlineBytes = Buffer.byteLength(JSON.stringify({
    stages: candidate.execution?.stages,
    changes: candidate.result?.changes,
    data: candidate.result?.data,
    blockers: candidate.blockers,
    error: candidate.error,
    recovery: candidate.recovery,
  }), "utf8");
  return candidate.budget.actual_bytes > candidate.budget.max_bytes
    || candidate.budget.actual_bytes > MACRO_CONTRACT_CEILINGS.envelope_max_bytes
    || inlineBytes > MACRO_CONTRACT_CEILINGS.inline_detail_max_bytes;
}

function compactMacroIdentity(entry) {
  return {
    id: entry.macro_id,
    program_id: entry.program_id,
    program_version: entry.program_version,
    risk: entry.risk,
  };
}

function compactSqliteEvidence(sqlite) {
  if (sqlite?.used === true) {
    return {
      used: true,
      source: SQLITE_SOURCE_VALUES_HAS(sqlite.source) ? sqlite.source : "warm_index",
      freshness: sqlite.freshness === "refreshed" ? "refreshed" : "stale",
      snapshot_ref: null,
      revision: null,
      refreshed: sqlite.refreshed === true,
    };
  }
  return {
    used: false,
    source: "not_used",
    freshness: "not_applicable",
    snapshot_ref: null,
    revision: null,
    refreshed: false,
  };
}

function SQLITE_SOURCE_VALUES_HAS(value) {
  return value === "cold_hydration" || value === "warm_index" || value === "refreshed_index";
}

function compactIso(value) {
  if (typeof value !== "string") return safeNowIso(() => new Date());
  // keep ISO but drop milliseconds to save bytes
  return value.replace(/\.\d{3}Z$/u, "Z");
}

function finalizeEnvelope(envelope) {
  const result = structuredClone(envelope);
  const isCompactBatch = Array.isArray(result.execution?.stages)
    && result.execution.stages.length === 0
    && ["set_item_take_controls", "create_variations"].includes(result.result?.data?.mode)
    && Number.isInteger(result.budget?.max_bytes)
    && result.budget.max_bytes <= MIN_RESPONSE_BUDGET;
  if (isCompactBatch) {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
      if (result.budget.actual_bytes <= result.budget.max_bytes) break;
      // Reclaim only optional prose/evidence. Never drop rows or failure code/fields.
      result.recovery = null;
      if (result.result?.summary) result.result.summary = String(result.result.summary).slice(0, 24);
      if (result.error?.message) result.error.message = String(result.error.message).slice(0, 24);
      if (Array.isArray(result.blockers)) {
        result.blockers = result.blockers.slice(0, 1).map((entry) => ({
          code: entry.code,
          message: String(entry.message ?? "").slice(0, 24),
          recoverable: entry.recoverable !== false,
          ...(entry.details?.zero_write === true ? { details: { zero_write: true } } : {}),
        }));
      }
      if (Array.isArray(result.result?.changes)) {
        result.result.changes = result.result.changes.map((change) => {
          const next = { ...change };
          if (Array.isArray(next.fields) && next.fields.length > 4) next.fields = next.fields.slice(0, 4);
          if (next.code && String(next.code).length > 24) next.code = String(next.code).slice(0, 24);
          return next;
        });
      }
      if (result.sqlite?.used === true) {
        result.sqlite = {
          used: true,
          source: "warm_index",
          freshness: "stale",
          snapshot_ref: null,
          revision: null,
          refreshed: false,
        };
      }
    }
  }
  // Recompute until stable: actual_bytes field width can change serialized size.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    result.budget.actual_bytes = Buffer.byteLength(JSON.stringify(result), "utf8");
  }
  const validation = validateMacroExecutionEnvelope(result);
  if (!validation.valid) throw new TypeError(`Invalid Alpha3.3-B1c items.apply envelope: ${validation.errors.join("; ")}`);
  return deepFreeze(result);
}

function resultData(input, state) {
  const completed = state.changes.filter((change) => change.mutation.status === "completed");
  const passed = completed.filter((change) => change.live_readback.status === "passed");
  const indexStatuses = uniqueStrings(completed.map((change) => change.index_maintenance.status));
  return {
    mode: input.mode,
    supported_modes: ALPHA3_3_B1C_ITEMS_APPLY_MODES,
    held_modes: ALPHA3_3_B1C_ITEMS_APPLY_HELD_MODES,
    supported_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_PROPERTY_FIELDS,
    held_property_fields: ALPHA3_3_B1C_ITEMS_APPLY_HELD_PROPERTY_FIELDS,
    target_scope: state.targetScope,
    total_target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    targets_truncated: state.targetsTruncated,
    undo_policy: REGISTRY_ENTRY.undo_policy,
    source_media_deleted: false,
    outcome: {
      mutation: { status: completed.length > 0 ? "completed" : input.dry_run ? "not_run" : "not_completed", completed_count: completed.length, total_count: state.operations.length },
      live_readback: { status: completed.length > 0 && passed.length === completed.length ? "passed" : passed.length > 0 ? "partial" : input.dry_run ? "not_run" : "not_passed", passed_count: passed.length, total_count: completed.length },
      index_maintenance: { status: indexStatuses.length === 1 ? indexStatuses[0] : indexStatuses.length > 1 ? "mixed" : "not_run", scopes: indexStatuses.length > 0 ? uniqueStrings(completed.flatMap((change) => change.index_maintenance.scopes)) : [] },
    },
  };
}

function targetData(state) {
  return {
    target_scope: state.targetScope,
    total_target_count: state.totalTargetCount,
    returned_target_count: state.returnedTargetCount,
    targets_truncated: state.targetsTruncated,
    mutation: { occurred: false, changes: 0 },
  };
}

function createState() {
  return {
    targetScope: "unresolved",
    totalTargetCount: 0,
    returnedTargetCount: 0,
    targetsTruncated: false,
    operations: [],
    changes: [],
    canonicalRefs: [],
    evidenceRefs: [],
    audioBatchEvidence: null,
    sqlite: null,
    batchMode: false,
    calls: emptyCalls(),
    timings: emptyTimings(),
  };
}

function pendingChange(operation) {
  return compactObject({
    operation_id: operation.operation_id,
    template_id: operation.template_id,
    target_ref: operation.item_ref.ref,
    related_ref: operation.take_ref?.ref ?? operation.target_track_ref?.ref,
    field: operation.field,
    before_value: operation.before_value,
    requested_value: operation.requested_value,
    status: "pending",
    mutation: { status: "pending" },
    live_readback: { status: "pending" },
    index_maintenance: { status: "pending", scopes: [] },
  });
}

function previewChange(operation) {
  return compactObject({
    operation_id: operation.operation_id,
    template_id: operation.template_id,
    target_ref: operation.item_ref.ref,
    related_ref: operation.take_ref?.ref ?? operation.target_track_ref?.ref,
    field: operation.field,
    before_value: operation.before_value,
    requested_value: operation.requested_value,
    status: "planned",
    mutation: { status: "not_run" },
    live_readback: { status: "not_run" },
    index_maintenance: { status: "skipped", scopes: [] },
  });
}

function failedReadback(operation, observed, observedItemRef) {
  return {
    ...failed("ITEM_APPLY_READBACK_MISMATCH", `Live readback for ${operation.operation_id} did not match the exact target/value requested.`, [blocker("ITEM_APPLY_READBACK_MISMATCH", `${operation.item_ref.ref} ${operation.field}: requested=${String(operation.requested_value)} observed=${String(observed)} observed_item_ref=${String(observedItemRef)}.`)]),
    phase: "readback",
  };
}

function executionError(error, templateId, phase) {
  const message = error?.message ?? `${templateId} threw during execution.`;
  return { ...failed("ITEM_APPLY_ATOMIC_FAILED", message, [blocker("ITEM_APPLY_ATOMIC_FAILED", message)]), phase };
}

function atomicFailure(execution, templateId) {
  const code = execution?.error?.code ?? "ITEM_APPLY_ATOMIC_FAILED";
  const message = execution?.error?.message ?? `${templateId} failed.`;
  return failed(code, message, [blocker(code, message, execution?.error?.recoverable !== false)]);
}

function collectExecutionEvidence(state, execution) {
  state.evidenceRefs.push(...uniqueStrings([
    execution?.request?.id,
    execution?.template?.id,
    ...(Array.isArray(execution?.result?.artifacts) ? execution.result.artifacts.map((entry) => entry?.ref) : []),
  ]));
}

function executionObjectRefs(execution) {
  const refs = [];
  const visit = (value) => {
    if (Array.isArray(value)) value.forEach(visit);
    else if (isPlainObject(value)) {
      if (typeof value.kind === "string" && typeof value.ref === "string" && isPlainObject(value.identity)) refs.push(value);
      else Object.values(value).forEach(visit);
    }
  };
  visit(execution?.result?.refs);
  return refs;
}

function collectItemObjectRefs(value) {
  const refs = [];
  const visit = (entry) => {
    if (Array.isArray(entry)) entry.forEach(visit);
    else if (isPlainObject(entry)) {
      if (entry.kind === "item" && typeof entry.ref === "string" && isPlainObject(entry.identity)) refs.push(entry);
      else Object.values(entry).forEach(visit);
    }
  };
  visit(value);
  return uniqueObjectRefs(refs);
}

function isExactItemToken(value) {
  return typeof value === "string" && (/^item:guid:.+/u.test(value) || /^guid:.+/u.test(value));
}

function isExactGuidRef(value, kind) {
  return typeof value === "string" && new RegExp(`^${kind}:guid:\\{[^{}]+\\}$`, "u").test(value);
}

function projectVerifiedTakeFxCopy(value, {
  sourceTakeRef,
  targetTakeRef,
  objectRefs,
  sharedTakeFx,
  sharedSourceTakeRef,
}) {
  const sharedSlots = Array.isArray(sharedTakeFx?.ordered_chain) ? sharedTakeFx.ordered_chain : null;
  const hasSharedProof = sharedSlots !== null && isExactGuidRef(sharedSourceTakeRef, "take");
  if (!isPlainObject(value)
    || value.status !== "passed"
    || !isExactGuidRef(sourceTakeRef, "take")
    || (sharedSourceTakeRef !== undefined && sharedSourceTakeRef !== sourceTakeRef)
    || (hasSharedProof
      ? (value.source_take_ref !== undefined && value.source_take_ref !== sourceTakeRef)
      : value.source_take_ref !== sourceTakeRef)
    || (hasSharedProof
      ? (value.target_take_ref !== undefined && value.target_take_ref !== targetTakeRef)
      : value.target_take_ref !== targetTakeRef)
    || !Number.isSafeInteger(value.source_count)
    || !Number.isSafeInteger(value.copied_count)
    || value.source_count < 0
    || value.source_count !== value.copied_count
    || !Array.isArray(value.slots)
    || value.slots.length !== value.copied_count) return null;
  const refs = Array.isArray(objectRefs) ? objectRefs : [];
  if (sharedSlots && (!Number.isSafeInteger(sharedTakeFx.source_fx_count)
    || !Number.isSafeInteger(sharedTakeFx.target_fx_count)
    || sharedTakeFx.source_fx_count !== value.source_count
    || sharedTakeFx.target_fx_count !== value.source_count
    || sharedSlots.length !== value.source_count)) return null;
  const slots = [];
  for (const [slotIndex, slot] of value.slots.entries()) {
    const sourceFxRef = `fx:${sourceTakeRef}:${slotIndex}`;
    const targetFxRef = `fx:${targetTakeRef}:${slotIndex}`;
    const targetObject = refs.find((entry) => entry.kind === "fx" && entry.ref === targetFxRef);
    const inferredTargetIdentity = `${targetTakeRef.slice("take:".length)}:${slotIndex}`;
    const targetObjectValid = targetObject === undefined
      ? hasSharedProof
      : isPlainObject(targetObject.identity)
        && ((targetObject.identity.scheme === "take_fx"
          && targetObject.identity.value === `${targetTakeRef}:${slotIndex}`)
          || (hasSharedProof
            && targetObject.identity.scheme === "take"
            && targetObject.identity.value === inferredTargetIdentity));
    const metadata = typeof slot?.name === "string" ? slot : sharedSlots?.[slotIndex];
    if (!isPlainObject(slot)
      || slot.slot_index !== slotIndex
      || (hasSharedProof
        ? (slot.source_fx_ref !== undefined && slot.source_fx_ref !== sourceFxRef)
        : slot.source_fx_ref !== sourceFxRef)
      || slot.target_fx_ref !== targetFxRef
      || !isPlainObject(metadata)
      || typeof metadata.name !== "string"
      || metadata.name.length < 1
      || typeof metadata.enabled !== "boolean"
      || !Number.isSafeInteger(metadata.parameter_count)
      || metadata.parameter_count < 0
      || !Array.isArray(metadata.parameter_names)
      || !Array.isArray(metadata.parameter_idents)
      || metadata.parameter_names.length !== metadata.parameter_count
      || metadata.parameter_idents.length !== metadata.parameter_count
      || metadata.parameter_names.some((entry) => typeof entry !== "string" || entry.length < 1)
      || metadata.parameter_idents.some((entry) => typeof entry !== "string" || entry.length < 1)
      || !targetObjectValid) return null;
    slots.push({ slot_index: slotIndex, target_fx_ref: targetFxRef });
  }
  return {
    status: "passed",
    copied_count: value.copied_count,
    slots,
  };
}

function exactGuidObjectRef(kind, ref) {
  return { kind, ref, identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) } };
}

function canonicalTokenRef(value) {
  if (typeof value !== "string") return null;
  if (value.startsWith("item:guid:")) return value;
  if (value.startsWith("guid:")) return `item:${value}`;
  return null;
}

function uniqueObjectRefs(refs) {
  const seen = new Set();
  return refs.filter((ref) => {
    if (seen.has(ref.ref)) return false;
    seen.add(ref.ref);
    return true;
  });
}

function runAtomic(executeAtomic, request, child) {
  return executeAtomic({
    ...child,
    context: request.context,
    budget: CHILD_BUDGET,
    observeProjectIndex: false,
  });
}

function pushStage(stages, id, kind, status, summary, evidenceRefs = []) {
  const row = { id, kind, status, summary, evidence_refs: uniqueStrings(evidenceRefs).slice(0, MACRO_CONTRACT_CEILINGS.evidence_ref_max_count) };
  const index = stages.findIndex((stage) => stage.id === id);
  if (index >= 0) stages[index] = row;
  else stages.push(row);
}

function requestSummary(request, { forceNonDry = false } = {}) {
  return {
    request_id: typeof request?.context?.request_id === "string"
      ? request.context.request_id
      : `${ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID}:${request?.context?.created_at ?? "request"}`,
    dry_run: forceNonDry ? false : request?.input?.dry_run !== false,
  };
}

function responseBudget(request) {
  const requested = request?.budget?.max_response_bytes ?? request?.response_budget ?? MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  if (!Number.isInteger(requested) || requested < MIN_RESPONSE_BUDGET || requested > MACRO_CONTRACT_CEILINGS.envelope_max_bytes) {
    return MACRO_CONTRACT_CEILINGS.envelope_max_bytes;
  }
  return requested;
}

function macroIdentity(entry) {
  return { id: entry.macro_id, program_id: entry.program_id, program_version: entry.program_version, risk: entry.risk };
}

function sqliteEvidence(runtime, { used = false, freshness = "not_applicable" } = {}) {
  if (!used) return { used: false, source: "not_used", freshness: "not_applicable", snapshot_ref: null, revision: null, refreshed: false };
  let status = {};
  try {
    status = runtime?.status?.() ?? {};
  } catch {
    status = {};
  }
  return {
    used: true,
    source: "warm_index",
    freshness,
    snapshot_ref: typeof status.snapshot_id === "string" ? status.snapshot_id : null,
    revision: status.revision === null || status.revision === undefined ? null : String(status.revision),
    refreshed: false,
  };
}

function valuesMatch(actual, expected) {
  if (typeof expected === "number") return Number.isFinite(actual) && Math.abs(actual - expected) <= POSITION_TOLERANCE;
  return actual === expected;
}

function blocker(code, message, recoverable = true) {
  return { code, message, recoverable };
}

function failed(code, message, blockers = [blocker(code, message)]) {
  return { ok: false, code, message, blockers };
}

function executionSummary(execution) {
  return {
    ...plainObject(execution?.result?.summary),
    ...plainObject(execution?.result?.readback),
  };
}

function compactObject(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== null && entry !== undefined));
}

function plainObject(value) {
  return isPlainObject(value) ? value : {};
}

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

function integerOr(value, fallback) {
  return Number.isInteger(value) ? value : fallback;
}

function stringOrNull(value) {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function uniqueStrings(values) {
  return [...new Set(values.filter((value) => typeof value === "string" && value.length > 0))];
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function clone(value) {
  return structuredClone(value);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Use a valid fallback below.
  }
  return new Date().toISOString();
}

function deepFreeze(value) {
  if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value;
  for (const entry of Object.values(value)) deepFreeze(entry);
  return Object.freeze(value);
}
