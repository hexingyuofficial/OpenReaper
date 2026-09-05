import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS = Object.freeze([
  "template.fx.delete_fx",
  "template.routing.remove_send",
  "template.items.move_item_to_track",
  "template.items.glue_item",
  "template.tracks.freeze_track",
  "template.tracks.unfreeze_track",
  "template.automation.ensure_take_pitch_envelope",
  "template.items.split_item_by_silence",
]);

export const ALPHA3_3_LIFECYCLE_ATOM_TEMPLATES = deepFreeze([
  destructiveDescriptor({
    id: "template.fx.delete_fx",
    title: "Delete exact FX",
    summary: "Delete one exact Track-FX or Take-FX instance and prove its native FX GUID is absent from the complete owner chain.",
    pack: "fx",
    entity_kind: "fx",
    tags: ["alpha3_3", "fx", "delete", "exact_ref", "native"],
    capability: "fx.delete_fx",
    outputSchema: objectSchema({
      deleted_fx_ref: { type: "string" },
      owner_kind: { enum: ["track", "take"] },
      owner_ref: { type: "string" },
      slot_index: { type: "integer" },
      name: { type: "string" },
      ident: { type: "string" },
      fx_guid: { type: "string" },
      fx_count_before: { type: "integer" },
      fx_count_after: { type: "integer" },
    }),
    refs: refs({
      input: [ref("fx_ref", "fx", true, "Exact Track-FX or Take-FX ref with a GUID owner and exact slot.")],
      output: [ref("deleted_fx_ref", "fx", true, "Deleted FX ref echoed for bounded cleanup evidence.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes exactly one FX instance from its existing owner chain.",
      entities: [
        { entity_kind: "fx", action: "delete", summary: "The exact native FX GUID disappears from the complete owner chain." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("fx_guid_absent", "state_delta", "The deleted native FX GUID is absent from every slot in the complete owner chain."),
      check("fx_count_decremented", "state_delta", "The complete owner chain count is exactly one smaller."),
    ]),
    examples: [{
      name: "delete_exact_track_fx",
      summary: "Delete one previously resolved exact Track-FX ref.",
      input: {},
    }],
  }),
  destructiveDescriptor({
    id: "template.routing.remove_send",
    title: "Remove exact internal send",
    summary: "Remove one exact category-0 internal send after proving source, destination, index, and a non-duplicate routing fingerprint.",
    pack: "routing",
    entity_kind: "send",
    tags: ["alpha3_3", "routing", "send", "remove", "exact_ref", "native"],
    capability: "routing.remove_send",
    outputSchema: objectSchema({
      deleted_send_ref: { type: "string" },
      source_track_ref: { type: "string" },
      destination_track_ref: { type: "string" },
      send_index: { type: "integer" },
      category: { const: 0 },
      fingerprint: { type: "string" },
      send_count_before: { type: "integer" },
      send_count_after: { type: "integer" },
    }),
    refs: refs({
      input: [ref("send_ref", "send", true, "Exact category-0 internal send ref with a GUID source Track and exact send index.")],
      output: [ref("deleted_send_ref", "send", true, "Deleted send ref echoed for bounded cleanup evidence.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Deletes exactly one internal Track send without addressing hardware outputs.",
      entities: [
        { entity_kind: "send", action: "delete", summary: "The exact preflight routing fingerprint disappears from the source Track." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("send_fingerprint_absent", "state_delta", "The exact preflight send fingerprint is absent from the complete source routing list."),
      check("send_count_decremented", "state_delta", "The category-0 send count is exactly one smaller."),
    ]),
    examples: [{
      name: "remove_exact_internal_send",
      summary: "Remove one previously resolved exact internal send ref.",
      input: {},
    }],
  }),
  writeDescriptor({
    id: "template.items.move_item_to_track",
    title: "Move item to existing track",
    summary: "Move one exact Item to one exact existing Track while preserving Item GUID, position, length, takes, and active take.",
    pack: "items",
    entity_kind: "item",
    tags: ["alpha3_3", "items", "move", "track", "exact_ref", "native"],
    capability: "items.move_item_to_track",
    idempotency: "supported",
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      source_track_ref: { type: "string" },
      target_track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      take_count: { type: "integer" },
      take_refs: { type: "array" },
      active_take_ref: { type: "string" },
      track_count_unchanged: { type: "boolean" },
    }),
    refs: refs({
      input: [
        ref("item_ref", "item", true, "Exact Item GUID ref to move; selection and index aliases are rejected."),
        ref("target_track_ref", "track", true, "Exact existing target Track GUID ref; this template never creates a Track."),
      ],
      output: [
        ref("item_ref", "item", true, "Same exact Item GUID after the move."),
        ref("target_track_ref", "track", true, "Existing target Track GUID read back from the moved Item."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates only the owning Track of one exact Item.",
      entities: [
        { entity_kind: "item", action: "update", summary: "The Item owner changes to the exact existing target Track." },
        { entity_kind: "track", action: "read", summary: "The existing target Track identity is read without creating Tracks." },
      ],
      idempotent: true,
    }),
    verification: requiredVerification([
      check("item_target_track_matches", "state_delta", "Live Item owner readback exactly matches the target Track GUID."),
      check("item_identity_preserved", "state_delta", "Item GUID, position, and length are unchanged."),
      check("item_takes_preserved", "state_delta", "Take count, ordered Take GUIDs, and active Take GUID are unchanged."),
      check("track_count_unchanged", "state_delta", "The project Track count is unchanged."),
    ]),
    examples: [{
      name: "move_exact_item_to_existing_track",
      summary: "Move one resolved exact Item to one resolved exact existing Track.",
      input: {},
    }],
  }),
  destructiveDescriptor({
    id: "template.items.glue_item",
    title: "Glue exact Item set",
    summary: "Glue one exact Item or 1-64 same-Track audio Items through one fixed native action and prove exact replacement identity.",
    pack: "items",
    entity_kind: "item",
    tags: ["alpha3_3", "items", "glue", "destructive", "exact_ref", "batch", "native"],
    capability: "items.glue_item",
    timeout_ms: 300_000,
    inputSchema: objectSchema({
      batch: { type: "array", minItems: 1, maxItems: 64, items: { type: "object" } },
      dry_run: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      source_item_ref: { type: "string" },
      glued_item_ref: { type: "string" },
      glued_take_ref: { type: "string" },
      owner_track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      source_filename: { type: "string" },
      source_type: { type: "string" },
      item_count_before: { type: "integer" },
      item_count_after: { type: "integer" },
      item_count_unchanged: { type: "boolean" },
      old_item_guid_absent: { type: "boolean" },
      new_item_unique: { type: "boolean" },
      selection_restored: { type: "boolean" },
      active_take_restored: { type: "boolean" },
      source_item_refs: { type: "array" },
      rows: { type: "array" },
      row_count: { type: "integer" },
      native_action_count: { type: "integer" },
    }, [
      "source_item_ref",
      "glued_item_ref",
      "glued_take_ref",
      "owner_track_ref",
      "position_seconds",
      "length_seconds",
      "source_filename",
      "source_type",
      "item_count_before",
      "item_count_after",
      "item_count_unchanged",
      "old_item_guid_absent",
      "new_item_unique",
      "selection_restored",
      "active_take_restored",
    ]),
    refs: refs({
      input: [ref("item_ref", "item", false, "Optional exact Item GUID ref for the backward-compatible single-Item form; batch rows carry exact GUIDs internally.")],
      output: [
        ref("glued_item_ref", "item", true, "Unique new Item GUID read back after glue."),
        ref("glued_take_ref", "take", true, "Active Take GUID read back from the new glued Item."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Replaces one or 1-64 same-Track audio Items with one native glued Item and readable source Take.",
      entities: [
        { entity_kind: "item", action: "delete", summary: "The exact source Item GUID disappears after the native glue action." },
        { entity_kind: "item", action: "create", summary: "Exactly one new Item GUID is identified from post-action live state." },
        { entity_kind: "take", action: "create", summary: "The new Item exposes a readable active Take GUID and source identity." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("old_item_guid_absent", "state_delta", "The source Item GUID is absent from the complete project Item list."),
      check("new_item_unique", "state_delta", "Exactly one post-action Item with a previously unseen native GUID is identified."),
      check("replacement_identity_matches", "state_delta", "The replacement remains on the same Track at the same position and length, with total Item count unchanged."),
      check("new_take_source_readable", "state_delta", "The new Item exposes an active Take GUID, source filename, and source type."),
      check("selection_restored", "state_delta", "Track and Item selection are restored, mapping the selected source Item to its replacement when needed."),
    ]),
    examples: [{
      name: "glue_exact_item",
      summary: "Glue one previously resolved exact Item GUID.",
      input: {},
    }, {
      name: "glue_exact_item_batch",
      summary: "Glue a bounded same-Track audio Item set into one replacement with one native action.",
      input: { batch: [{ id: "i001", item_ref: "item:guid:{ITEM-GUID}" }], dry_run: false },
    }],
  }),
  writeDescriptor({
    id: "template.tracks.freeze_track",
    title: "Freeze Track target set",
    summary: "Freeze one exact Track or 1-64 execution-time selected Tracks with one fixed native action; omitted targets safely default to selected Tracks.",
    pack: "tracks",
    entity_kind: "track",
    tags: ["alpha3_3", "tracks", "freeze", "exact_ref", "target_binding", "selected", "batch", "native"],
    capability: "tracks.freeze_track",
    timeout_ms: 300_000,
    inputSchema: objectSchema({
      mode: { enum: ["mono", "stereo", "multichannel"] },
      target_binding: selectedTrackTargetBindingSchema(),
    }, ["mode"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      target_mode: { enum: ["exact", "selected"] },
      target_count: { type: "integer", minimum: 1, maximum: 64 },
      target_refs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
      target_fingerprint: { type: "string" },
      targets: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: objectSchema({
          track_ref: { type: "string" },
          freeze_count_before: { type: "integer" },
          freeze_count_after: { type: "integer" },
          verified: { const: true },
        }),
      },
      mode: { enum: ["mono", "stereo", "multichannel"] },
      freeze_count_before: { type: "integer" },
      freeze_count_after: { type: "integer" },
      selection_restored: { type: "boolean" },
    }),
    refs: refs({
      input: [ref("track_ref", "track", false, "Optional exact Track GUID ref; when both it and target_binding are omitted, execution consumes selected Tracks.")],
      output: [ref("track_ref", "track", true, "Every exact Track GUID verified after freezing.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Increments the native freeze count of one exact Track or one frozen execution-time selected Track set.",
      entities: [{ entity_kind: "track", action: "update", summary: "Every target Track native I_FREEZECOUNT increases in the requested mode." }],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("freeze_count_increased", "state_delta", "Every target's live I_FREEZECOUNT readback is greater than its pre-action value."),
      check("selection_restored", "state_delta", "Track and Item selection are restored after the fixed freeze action."),
    ]),
    examples: [
      { name: "freeze_exact_track", summary: "Freeze one exact Track in stereo mode.", input: { mode: "stereo" } },
      { name: "freeze_selected_tracks_default", summary: "Freeze the 1-64 Tracks selected when execution begins by omitting the target.", input: { mode: "stereo" } },
      { name: "freeze_selected_tracks_binding", summary: "Freeze selected Tracks through the shared target-binding shorthand.", input: { mode: "stereo", target_binding: { domain: "tracks", selector: "selected" } } },
    ],
  }),
  destructiveDescriptor({
    id: "template.tracks.unfreeze_track",
    title: "Unfreeze Track target set",
    summary: "Unfreeze one exact Track or 1-64 execution-time selected frozen Tracks with one fixed native action; omitted targets safely default to selected Tracks.",
    pack: "tracks",
    entity_kind: "track",
    tags: ["alpha3_3", "tracks", "unfreeze", "exact_ref", "target_binding", "selected", "batch", "native"],
    capability: "tracks.unfreeze_track",
    timeout_ms: 300_000,
    inputSchema: objectSchema({ target_binding: selectedTrackTargetBindingSchema() }, []),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      target_mode: { enum: ["exact", "selected"] },
      target_count: { type: "integer", minimum: 1, maximum: 64 },
      target_refs: { type: "array", minItems: 1, maxItems: 64, items: { type: "string" } },
      target_fingerprint: { type: "string" },
      targets: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: objectSchema({
          track_ref: { type: "string" },
          freeze_count_before: { type: "integer" },
          freeze_count_after: { type: "integer" },
          verified: { const: true },
        }),
      },
      freeze_count_before: { type: "integer" },
      freeze_count_after: { type: "integer" },
      selection_restored: { type: "boolean" },
    }),
    refs: refs({
      input: [ref("track_ref", "track", false, "Optional exact Track GUID ref; when both it and target_binding are omitted, execution consumes selected Tracks.")],
      output: [ref("track_ref", "track", true, "Every exact Track GUID verified after unfreezing.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Decrements the native freeze count of one exact Track or one frozen execution-time selected Track set.",
      entities: [{ entity_kind: "track", action: "update", summary: "Every target Track native I_FREEZECOUNT decreases after the fixed unfreeze action." }],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("freeze_count_decreased", "state_delta", "Every target's live I_FREEZECOUNT readback is lower than its pre-action value."),
      check("selection_restored", "state_delta", "Track and Item selection are restored after the fixed unfreeze action."),
    ]),
    examples: [
      { name: "unfreeze_exact_track", summary: "Unfreeze one exact previously frozen Track.", input: {} },
      { name: "unfreeze_selected_tracks_default", summary: "Unfreeze the 1-64 frozen Tracks selected when execution begins by omitting the target.", input: {} },
      { name: "unfreeze_selected_tracks_binding", summary: "Unfreeze selected frozen Tracks through the shared target-binding shorthand.", input: { target_binding: { domain: "tracks", selector: "selected" } } },
    ],
  }),
  writeDescriptor({
    id: "template.automation.ensure_take_pitch_envelope",
    title: "Ensure Take Pitch Envelope",
    summary: "Ensure a Pitch envelope exists on one exact Take, proving idempotent no-op when present or native creation plus Envelope GUID readback when absent.",
    pack: "automation",
    entity_kind: "envelope",
    tags: ["alpha3_3", "automation", "pitch", "envelope", "idempotent", "exact_ref", "native"],
    capability: "automation.ensure_take_pitch_envelope",
    idempotency: "supported",
    timeout_ms: 10_000,
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      envelope_ref: { type: "string" },
      envelope_guid: { type: "string" },
      existing_before: { type: "boolean" },
      changed: { type: "boolean" },
      selection_restored: { type: "boolean" },
      active_take_restored: { type: "boolean" },
    }),
    refs: refs({
      input: [ref("take_ref", "take", true, "Exact Take GUID ref; selection and index aliases are rejected.")],
      output: [ref("envelope_ref", "envelope", true, "Pitch Envelope GUID read back from the exact Take.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Creates the Pitch envelope only when missing; an existing envelope is a verified no-op.",
      entities: [{ entity_kind: "envelope", action: "create", summary: "A Pitch Envelope is created only when GetTakeEnvelopeByName initially returns none." }],
      idempotent: true,
    }),
    verification: requiredVerification([
      check("pitch_envelope_exists", "state_delta", "GetTakeEnvelopeByName returns a Pitch Envelope after the operation."),
      check("pitch_envelope_guid_exists", "state_delta", "GetSetEnvelopeInfo_String(..., GUID, ...) returns a non-empty native Envelope GUID."),
      check("existing_pitch_is_noop", "state_delta", "An existing Pitch Envelope is not toggled or recreated."),
      check("selection_and_active_take_restored", "state_delta", "Track/Item selection and all readable active Takes are restored."),
    ]),
    examples: [{ name: "ensure_pitch_envelope", summary: "Ensure Pitch exists on one exact Take.", input: {} }],
  }),
  destructiveDescriptor({
    id: "template.items.split_item_by_silence",
    title: "Split Item By Silence",
    summary: "Analyze one exact audio Item completely, split it at native silence boundaries, delete only silent Item fragments, and prove every kept/deleted GUID against live REAPER state.",
    pack: "items",
    entity_kind: "item",
    tags: ["alpha3_3", "items", "silence", "split", "delete", "destructive", "exact_ref", "native"],
    capability: "items.split_item_by_silence",
    timeout_ms: 300_000,
    inputSchema: objectSchema({
      silence_threshold_dbfs: { type: "number", minimum: -150, maximum: 0, default: -60 },
      min_silence_ms: { type: "number", minimum: 1, maximum: 60000, default: 250 },
      silence_scope: { type: "string", enum: ["all", "leading", "trailing", "edges", "internal"], default: "all" },
      keep_before_ms: { type: "number", minimum: 0, maximum: 5000, default: 20 },
      keep_after_ms: { type: "number", minimum: 0, maximum: 5000, default: 20 },
      min_kept_audio_ms: { type: "number", minimum: 0, maximum: 60000, default: 80 },
      fade_ms: { type: "number", minimum: 0, maximum: 1000, default: 5 },
      batch: { type: "boolean" },
      operation: { type: "string", enum: ["remove_silence", "normalize_level"] },
      target: { type: "string", enum: ["selected", "exact"] },
      target_refs: { type: "array", maxItems: 64, items: { type: "string" } },
      adjacent_audio: { type: "string", enum: ["left", "right", "both"] },
      dry_run: { type: "boolean" },
      normalization_metric: { type: "string", enum: ["lufs_i", "rms_i", "peak", "true_peak", "lufs_m_max", "lufs_s_max"] },
      normalization_target: { type: "number", maximum: 0 },
    }, []),
    outputSchema: objectSchema({
      source_item_ref: { type: "string" },
      owner_track_ref: { type: "string" },
      kept_item_refs: { type: "array" },
      deleted_item_refs: { type: "array" },
      silence_segment_count: { type: "integer" },
      split_count: { type: "integer" },
      delete_count: { type: "integer" },
      item_count_before: { type: "integer" },
      item_count_after: { type: "integer" },
      original_duration_seconds: { type: "number" },
      removed_duration_seconds: { type: "number" },
      remaining_duration_seconds: { type: "number" },
      changed: { type: "boolean" },
      source_media_deleted: { const: false },
      plan_hash: { type: "string" },
      aggregate_readback: { type: "array" },
      timings: { type: "object" },
      native_counters: { type: "object" },
      undo_opened: { type: "boolean" },
      undo_closed: { type: "boolean" },
    }),
    refs: refs({
      input: [ref("item_ref", "item", false, "Exact Item GUID ref for the single-item compatibility path; batch selected targeting supplies no input ref and is resolved atomically in REAPER.")],
      output: [
        ref("kept_item_refs", "item", true, "Every surviving Item fragment GUID read back from live REAPER state."),
        ref("deleted_item_refs", "item", false, "Every deleted silent Item fragment GUID proven absent from the complete project Item list."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Splits one exact audio Item and deletes only Item fragments proven silent by complete native pre-FX sample analysis.",
      entities: [
        { entity_kind: "item", action: "create", summary: "Native SplitMediaItem creates bounded non-silent/silent fragments at analyzed boundaries." },
        { entity_kind: "item", action: "delete", summary: "DeleteTrackMediaItem removes only fragments classified inside complete silence segments." },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("analysis_coverage_complete", "state_delta", "The entire Item duration and every detected silence row are complete before mutation."),
      check("kept_guids_present", "state_delta", "Every kept native Item GUID exists on the original Track at the exact expected position and length."),
      check("deleted_guids_absent", "state_delta", "Every deleted native Item GUID is absent from the complete project Item list."),
      check("duration_conserved", "state_delta", "Remaining plus removed Item duration equals the original Item duration within one source-sample tolerance."),
      check("track_item_count_matches", "state_delta", "The live Track Item count equals before + splits - deletions."),
    ]),
    examples: [{
      name: "remove_silence_from_exact_item",
      summary: "Split one exact audio Item at -60 dBFS silence lasting at least 50 ms and delete silent fragments only.",
      input: { silence_threshold_dbfs: -60, min_silence_ms: 50 },
    }],
  }),
]);

export function createAlpha3_3LifecycleAtomTemplates() {
  return cloneJson(ALPHA3_3_LIFECYCLE_ATOM_TEMPLATES);
}

function destructiveDescriptor(options) {
  return writeDescriptor({ ...options, risk: "destructive", idempotency: "none" });
}

function writeDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: options.pack,
    lifecycle: "experimental",
    risk: options.risk ?? "write",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: {
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: options.capability,
      idempotency: options.idempotency ?? "supported",
      timeout_ms: options.timeout_ms ?? 5_000,
    },
    inputSchema: options.inputSchema ?? objectSchema({}, []),
    outputSchema: options.outputSchema,
    refs: options.refs,
    artifacts: { mode: "none", input: [], output: [] },
    expectedDelta: options.expectedDelta,
    verification: options.verification,
    examples: options.examples,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return { type: "object", properties, required, additionalProperties: false };
}

function selectedTrackTargetBindingSchema() {
  return objectSchema({
    bind_at: { const: "execution" },
    domain: { const: "tracks" },
    selector: { const: "selected" },
    aggregation: { const: "batch" },
    cardinality: objectSchema({
      minimum: { const: 1 },
      maximum: { const: 64 },
    }),
  }, ["domain"]);
}

function refs(overrides = {}) {
  return { input: [], output: [], ...overrides };
}

function ref(name, kind, required, summary) {
  return { name, kind, required, summary };
}

function mutationDelta(overrides = {}) {
  return { kind: "mutation", summary: "Mutates one exact object.", entities: [], idempotent: false, ...overrides };
}

function requiredVerification(checks) {
  return { mode: "required", checks };
}

function check(name, kind, summary) {
  return { name, kind, summary };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const child of Object.values(value)) deepFreeze(child);
  return value;
}
