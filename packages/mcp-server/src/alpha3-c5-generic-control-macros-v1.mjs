import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogAlpha3C3Templates,
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";
import {
  createAlpha3L4MacroExecutionConvenienceFlow,
} from "./alpha3-l4-macro-execution-convenience-v1.mjs";

export const ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT = "alpha3.c5.generic_control_macros.v1";
export const ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID = "macro.controls.set";

export const ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID = deepFreeze({
  track: "macro.set_track_controls",
  item: "macro.set_item_controls",
  take: "macro.set_take_controls",
  transport: "macro.set_transport_controls",
  send: "macro.set_send_controls",
});

export const ALPHA3_2_5_C_CONTROL_TARGET_KINDS = deepFreeze([
  "project",
  ...Object.keys(ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID),
]);

export const ALPHA3_2_5_C_LEGACY_CONTROL_MACRO_IDS = deepFreeze([
  ...Object.values(ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID),
]);

export const ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
  mode: "registered_executable_control_program",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "act",
  action_kind: "macro",
  execution_shape: "registered_macro_program",
  macro_ids: [ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID],
  consolidated_legacy_ids: ALPHA3_2_5_C_LEGACY_CONTROL_MACRO_IDS,
  withdrawn_ids: ["macro.set_midi_controls"],
  target_kinds: ALPHA3_2_5_C_CONTROL_TARGET_KINDS,
  rule: "Use macro.controls.set for bounded project, track, item, take, transport, and send controls. The fixed program live-resolves targets, executes accepted Templates serially, reads back the result, and invalidates affected Project Index scopes.",
});

export const ALPHA3_C5_OFFICIAL_MACRO_ENTRY_KIND = "official_macro";

const PROJECT_CONTROL_DEFINITION = deepFreeze({
  id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
  user_label: "Set project controls",
  task_intents: ["set project BPM", "change project tempo", "set project grid", "enable or disable project snap"],
  scope: "project",
  refs: [],
  freshness_requires: ["project_tempo"],
  risk_domain: "write_project_reversible",
  readback: {
    template_id: "template.project.read_tempo_map",
    refs_from: [],
    evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
  },
  fields: [
    field("bpm", "number", "template.project.set_bpm", "bpm", { min: 20, max: 400, unit: "bpm" }),
    field("grid_division", "string", "template.project.set_grid", "division"),
    field("grid_swing", "number", "template.project.set_grid", "swing", { min: 0, max: 1 }),
    field("snap_enabled", "boolean", "template.project.set_snap", "enabled"),
  ],
  blocked_fields: [],
});

const MACRO_DEFINITIONS = deepFreeze([
  {
    id: "macro.set_track_controls",
    user_label: "Set track controls",
    task_intents: ["change track volume", "mute or solo a track", "arm a track", "pan a track"],
    scope: "track",
    refs: [{ name: "track_ref", kind: "track", required: true }],
    freshness_requires: ["track_ref", "track_identity", "track_mixer_controls"],
    risk_domain: "write_project_reversible",
    readback: {
      template_id: "template.tracks.read_mixer_controls",
      refs_from: ["track_ref"],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("volume", "number", "template.tracks.set_volume", "volume", { min: 0, max: 4, unit: "linear_gain" }),
      field("pan", "number", "template.tracks.set_pan", "pan", { min: -1, max: 1 }),
      field("record_arm", "boolean", "template.tracks.set_record_arm", "armed"),
      field("mute", "boolean", "template.tracks.set_mute", "muted"),
      field("solo_mode", "enum", "template.tracks.set_solo", "mode", { values: ["off", "solo", "solo_in_place"] }),
      field("width", "number", "template.tracks.set_width", "width", { min: -1, max: 1 }),
      field("color", "string", "template.tracks.set_color", "color"),
      field("name", "string", "template.tracks.rename_track", "name"),
    ],
    blocked_fields: [
      blocker("input_monitoring", "MISSING_ACCEPTED_TEMPLATE", "No accepted template for track input monitoring yet."),
      blocker("record_input", "MISSING_ACCEPTED_TEMPLATE", "No accepted template for track record input selection yet."),
      blocker("hardware_output", "HARD_STOP_DOMAIN", "Hardware output changes stay outside generic track controls and require explicit hard-stop handling."),
    ],
  },
  {
    id: "macro.set_item_controls",
    user_label: "Set item controls",
    task_intents: ["move an item", "trim an item", "mute an item", "change item gain", "set item fades"],
    scope: "item",
    refs: [{ name: "item_ref", kind: "item", required: true }],
    freshness_requires: ["item_ref", "item_identity", "active_take_identity"],
    risk_domain: "write_project_reversible",
    readback: {
      template_id: "template.items.read_item_summary",
      refs_from: ["item_ref"],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("position_seconds", "number", "template.items.move_item", "position_seconds", { min: 0, unit: "seconds" }),
      field("length_seconds", "number", "template.items.trim_item", "length_seconds", { min: 0, unit: "seconds" }),
      field("start_offset_seconds", "number", "template.items.trim_item", "start_offset_seconds", { min: 0, unit: "seconds", optional_when: "length_seconds supplied" }),
      field("volume_db", "number", "template.items.set_item_volume", "volume_db", { min: -150, max: 24, unit: "dB" }),
      field("mute", "boolean", "template.items.set_mute", "muted"),
      field("lock", "boolean", "template.items.set_lock", "locked"),
      field("loop_source", "boolean", "template.items.set_loop_source", "loop_source"),
      field("play_all_takes", "boolean", "template.items.set_play_all_takes", "play_all_takes"),
      field("fade_in_seconds", "number", "template.items.set_item_fades", "fade_in_seconds", { min: 0, unit: "seconds", paired_with: "fade_out_seconds" }),
      field("fade_out_seconds", "number", "template.items.set_item_fades", "fade_out_seconds", { min: 0, unit: "seconds", paired_with: "fade_in_seconds" }),
      field("snap_offset_seconds", "number", "template.items.set_item_snap_offset", "snap_offset_seconds", { min: 0, unit: "seconds" }),
      field("no_autofades", "boolean", "template.items.set_no_autofades", "no_autofades"),
    ],
    blocked_fields: [
      blocker("pan", "ITEM_PAN_UNSUPPORTED", "REAPER does not expose a verified Item-level pan write. To pan the current Active Take, use target_kind=take with field pan only after confirming active_take_identity; never treat a multi-Take Item as Item pan."),
      blocker("delete", "DESTRUCTIVE_DOMAIN", "Delete remains outside generic controls and requires explicit destructive confirmation."),
      blocker("grouping", "MISSING_ACCEPTED_RUNTIME_SUPPORT", "Item grouping descriptors are not accepted in the current runtime catalog."),
      blocker("fade_shapes", "MISSING_ACCEPTED_RUNTIME_SUPPORT", "Fade shape descriptors are not accepted in the current runtime catalog."),
    ],
  },
  {
    id: "macro.set_take_controls",
    user_label: "Set take controls",
    task_intents: ["change take pitch", "change take playrate", "adjust take gain", "reverse a take"],
    scope: "take",
    refs: [{ name: "item_ref", kind: "item", required: true }],
    freshness_requires: ["item_ref", "active_take_identity"],
    risk_domain: "write_project_reversible",
    readback: {
      template_id: "template.items.read_item_summary",
      refs_from: ["item_ref"],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("name", "string", "template.items.rename_take", "name"),
      field("volume_db", "number", "template.items.set_take_volume", "volume_db", { min: -150, max: 24, unit: "dB" }),
      field("pan", "number", "template.items.set_take_pan", "pan", { min: -1, max: 1 }),
      field("pitch_semitones", "number", "template.items.set_take_pitch", "semitones", { min: -48, max: 48, unit: "semitones" }),
      field("playrate", "number", "template.items.set_take_playrate", "playrate", { min: 0.01, max: 8 }),
      field("preserve_pitch", "boolean", "template.items.set_take_playrate", "preserve_pitch"),
      field("start_offset_seconds", "number", "template.items.set_take_start_in_source", "start_offset_seconds", { min: 0, unit: "seconds" }),
      field("reverse", "boolean", "template.items.set_reverse", "reverse"),
      field("invert_phase", "boolean", "template.items.set_invert_phase", "invert_phase"),
      field("channel_mode", "enum", "template.items.set_channel_mode", "channel_mode", { values: ["normal", "reverse_stereo", "mono_left", "mono_right"] }),
      field("pitch_shift_mode", "string", "template.items.set_pitch_shift_mode", "mode"),
      field("stretch_marker_fade_size_ms", "number", "template.items.set_stretch_marker_fade_size", "fade_size_ms", { min: 0, unit: "ms" }),
    ],
    blocked_fields: [
      blocker("choose_source_file", "PRIVACY_PATH_BOUNDARY", "Source file replacement needs explicit media/path policy and is not a generic control."),
      blocker("per_take_selection", "MISSING_ACCEPTED_TEMPLATE", "Current accepted controls target the active take through item_ref, not arbitrary take selection."),
    ],
  },
  {
    id: "macro.set_transport_controls",
    user_label: "Set transport controls",
    task_intents: ["set loop points", "move edit cursor", "set repeat", "set record mode"],
    scope: "transport",
    refs: [],
    freshness_requires: ["transport_state"],
    risk_domain: "safe_write",
    readback: {
      template_id: "template.transport.read_state",
      refs_from: [],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("edit_cursor_seconds", "number", "template.transport.set_edit_cursor", "position_seconds", { min: 0, unit: "seconds" }),
      field("move_view", "boolean", "template.transport.set_edit_cursor", "move_view"),
      field("seek_playback", "boolean", "template.transport.set_edit_cursor", "seek_playback"),
      field("loop_start_seconds", "number", "template.transport.set_loop_points", "start_seconds", { min: 0, unit: "seconds", paired_with: "loop_end_seconds" }),
      field("loop_end_seconds", "number", "template.transport.set_loop_points", "end_seconds", { min: 0, unit: "seconds", paired_with: "loop_start_seconds" }),
      field("time_selection_start_seconds", "number", "template.transport.set_time_selection", "start_seconds", { min: 0, unit: "seconds", paired_with: "time_selection_end_seconds" }),
      field("time_selection_end_seconds", "number", "template.transport.set_time_selection", "end_seconds", { min: 0, unit: "seconds", paired_with: "time_selection_start_seconds" }),
      field("repeat", "boolean", "template.transport.set_repeat", "enabled"),
      field("playback_rate", "number", "template.transport.set_playback_rate", "playback_rate", { min: 0.01, max: 4 }),
      field("preserve_pitch", "boolean", "template.transport.set_playback_rate", "preserve_pitch"),
      field("record_mode", "enum", "template.transport.set_record_mode", "mode", { values: ["normal", "time_selection_auto_punch", "selected_item_auto_punch"] }),
      field("punch_start_seconds", "number", "template.transport.set_punch_record_range", "start_seconds", { min: 0, unit: "seconds", paired_with: "punch_end_seconds" }),
      field("punch_end_seconds", "number", "template.transport.set_punch_record_range", "end_seconds", { min: 0, unit: "seconds", paired_with: "punch_start_seconds" }),
    ],
    blocked_fields: [
      blocker("start_recording", "RECORDING_WRITE_BOUNDARY", "Starting recording remains an explicit recording workflow, not a generic safe transport control."),
      blocker("stop_recording", "RECORDING_WRITE_BOUNDARY", "Stopping recording needs recorded-media policy and readback."),
      blocker("render", "HARD_STOP_DOMAIN", "Render/export is outside transport controls."),
    ],
  },
  {
    id: "macro.set_send_controls",
    user_label: "Set send controls",
    task_intents: ["change send volume", "pan a send", "mute a send", "set send mode"],
    scope: "send",
    refs: [
      { name: "send_ref", kind: "send", required: true },
      { name: "track_ref", kind: "track", required: true, purpose: "owner readback" },
    ],
    freshness_requires: ["send_ref", "owner_track_ref", "send_identity", "routing_state"],
    risk_domain: "write_project_reversible",
    readback: {
      template_id: "template.routing.read_track_routing",
      refs_from: ["track_ref"],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("volume", "number", "template.routing.set_send_volume", "volume", { min: 0, max: 4, unit: "linear_gain" }),
      field("pan", "number", "template.routing.set_send_pan", "pan", { min: -1, max: 1 }),
      field("mute", "boolean", "template.routing.set_send_mute", "muted"),
      field("mode", "enum", "template.routing.set_send_mode", "mode", { values: ["post_fader", "pre_fader", "pre_fx"] }),
      field("phase_inverted", "boolean", "template.routing.set_send_phase", "phase_inverted"),
      field("mono", "boolean", "template.routing.set_send_mono", "mono"),
      field("source_channel_offset", "integer", "template.routing.set_send_audio_channels", "source_channel_offset", { min: 0, paired_with: "source_channel_count" }),
      field("source_channel_count", "integer", "template.routing.set_send_audio_channels", "source_channel_count", { min: 1, paired_with: "source_channel_offset" }),
      field("destination_channel_offset", "integer", "template.routing.set_send_audio_channels", "destination_channel_offset", { min: 0 }),
      field("mix_to_mono", "boolean", "template.routing.set_send_audio_channels", "mix_to_mono"),
      field("source_midi_channel", "enum", "template.routing.set_send_midi_channels", "source_channel", { values: ["all", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] }),
      field("destination_midi_channel", "enum", "template.routing.set_send_midi_channels", "destination_channel", { values: ["original", 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16] }),
    ],
    blocked_fields: [
      blocker("create_send", "CREATE_FLOW_REQUIRED", "Creating sends is a separate workflow because it needs source/destination track refs and duplicate policy."),
      blocker("remove_send", "MISSING_ACCEPTED_TEMPLATE", "No accepted remove-send template is in the current runtime catalog."),
      blocker("hardware_send", "HARD_STOP_DOMAIN", "Hardware sends remain a hard-stop routing lane."),
    ],
  },
  {
    id: "macro.set_midi_controls",
    user_label: "Set MIDI controls",
    task_intents: ["quantize MIDI notes", "edit MIDI notes", "edit MIDI CC"],
    scope: "midi_take",
    status: "planned_after_c5",
    refs: [{ name: "take_ref", kind: "take", required: true }],
    freshness_requires: ["take_ref", "midi_take_identity", "expected_take_hash"],
    risk_domain: "write_project_reversible",
    readback: {
      template_id: "template.midi.read_take_event_counts",
      refs_from: ["take_ref"],
      evidence_required: ["request_id", "canonical_refs", "readback_status", "typed_blockers"],
    },
    fields: [
      field("quantize_grid_unit", "enum", "template.midi.quantize_notes", "grid_unit", { values: ["ppq", "musical"] }),
      field("quantize_strength", "number", "template.midi.quantize_notes", "strength", { min: 0, max: 1 }),
      field("preserve_duration", "boolean", "template.midi.quantize_notes", "preserve_duration"),
    ],
    blocked_fields: [
      blocker("arbitrary_note_batch_edit", "COMPLEX_SCHEMA_DEFERRED", "Batch note edits need a separate MIDI-specific product schema."),
      blocker("arbitrary_cc_batch_edit", "COMPLEX_SCHEMA_DEFERRED", "Batch CC edits need a separate MIDI-specific product schema."),
    ],
  },
]);

export function listAlpha3C5GenericControlMacros(options = {}) {
  const catalog = options.catalog ?? createAlpha3C5AcceptedCatalog();
  return deepFreeze({
    contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
    mode: "plan_only_schema_registry",
    tool_surface: ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY.tool_surface,
    macros: MACRO_DEFINITIONS.map((definition) => annotateMacro(definition, catalog)),
  });
}

export function createAlpha3C5OfficialMacroDiscoveryItems(options = {}) {
  return [officialControlsSetDiscoveryItem(options)];
}

export function getAlpha3C5GenericControlMacro(id, options = {}) {
  const catalog = options.catalog ?? createAlpha3C5AcceptedCatalog();
  const definition = MACRO_DEFINITIONS.find((macro) => macro.id === id);
  if (!definition) return null;
  return annotateMacro(definition, catalog);
}

export function isAlpha3C5OfficialMacroId(id) {
  return typeof id === "string" && MACRO_DEFINITIONS.some((macro) => macro.id === id);
}

export function isAlpha3_2_5CLegacyControlMacroId(id) {
  return ALPHA3_2_5_C_LEGACY_CONTROL_MACRO_IDS.includes(id);
}

export function isAlpha3_2_5CWithdrawnControlMacroId(id) {
  return id === "macro.set_midi_controls";
}

export function targetKindForAlpha3_2_5CLegacyControlMacro(id) {
  return Object.entries(ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID)
    .find(([, legacyId]) => legacyId === id)?.[0] ?? null;
}

export function getAlpha3_2_5CControlTargetDefinition(targetKind, options = {}) {
  if (targetKind === "project") {
    const catalog = options.catalog ?? createAlpha3C5AcceptedCatalog();
    return annotateMacro(PROJECT_CONTROL_DEFINITION, catalog);
  }
  const legacyId = ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID[targetKind];
  return legacyId ? getAlpha3C5GenericControlMacro(legacyId, options) : null;
}

export function planAlpha3_2_5CControlsSetMacro(input = {}, refs = {}, options = {}) {
  const normalized = isPlainObject(input) ? input : {};
  const targetKind = normalized.target_kind;
  const macro = getAlpha3_2_5CControlTargetDefinition(targetKind, options);
  if (!macro) {
    return deepFreeze({
      contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
      ok: false,
      id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
      target_kind: targetKind ?? null,
      legacy_id: null,
      requests: [],
      readback: null,
      blockers: [blocker(
        "target_kind",
        "CONTROL_TARGET_KIND_UNSUPPORTED",
        "macro.controls.set target_kind must be project, track, item, take, transport, or send.",
      )],
    });
  }
  const normalizedFields = normalizeControlFields(targetKind, normalized.fields);
  if (!normalizedFields.ok) {
    return deepFreeze({
      contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
      ok: false,
      id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
      target_kind: targetKind,
      legacy_id: ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID[targetKind] ?? null,
      normalized_fields: normalizedFields.fields,
      requests: [],
      readback: null,
      blockers: normalizedFields.blockers,
    });
  }
  const plan = planAlpha3C5GenericControlDefinition(macro, {
    refs,
    fields: normalizedFields.fields,
  });
  return deepFreeze({
    ...plan,
    id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
    target_kind: targetKind,
    legacy_id: ALPHA3_2_5_C_CONTROL_TARGET_TO_LEGACY_ID[targetKind] ?? null,
    normalized_fields: normalizedFields.fields,
  });
}

export function planAlpha3C5GenericControlMacro(id, request = {}, options = {}) {
  const macro = getAlpha3C5GenericControlMacro(id, options);
  if (!macro) {
    return deepFreeze({
      contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
      ok: false,
      id,
      blockers: [blocker("macro", "MACRO_UNKNOWN", "Generic control macro is not registered.")],
      requests: [],
    });
  }

  return planAlpha3C5GenericControlDefinition(macro, request);
}

function planAlpha3C5GenericControlDefinition(macro, request = {}) {
  const suppliedFields = isPlainObject(request.fields) ? request.fields : {};
  const suppliedFieldNames = Object.keys(suppliedFields);
  const selectedFields = macro.fields
    .filter((fieldDef) => Object.prototype.hasOwnProperty.call(suppliedFields, fieldDef.name));
  const fieldNameBlockers = validateSuppliedFieldNames(macro, suppliedFieldNames);
  const fieldPlans = planFieldRequests({ macro, selectedFields, suppliedFields, refs: request.refs });
  const blockers = [
    ...fieldNameBlockers,
    ...fieldPlans.flatMap((plan) => plan.blockers),
    ...validateRequiredRefs(macro, request.refs),
  ];
  const candidateRequests = fieldPlans.flatMap((plan) => plan.requests);
  const requests = blockers.length === 0 ? candidateRequests : [];
  const readback = requests.length > 0 && blockers.length === 0
    ? planReadbackRequest(macro, request.refs)
    : null;
  const ok = blockers.length === 0;

  return deepFreeze({
    contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
    ok,
    id: macro.id,
    mode: "plan_only_call_template_macro",
    action_kind: "macro",
    menu_group: "act",
    risk_domain: macro.risk_domain,
    undo_scope: requests.length > 0 ? "serial_per_template_undo_evidence" : "none",
    freshness_requires: macro.freshness_requires,
    requests,
    readback,
    agent_execution_flow: createAlpha3L4MacroExecutionConvenienceFlow({
      macro_id: macro.id,
      macro_family: "c5_generic_control",
      risk_domain: macro.risk_domain,
      ok,
      child_requests: requests,
      readback,
      blockers,
    }),
    blockers,
    policy: "Execute only supplied supported fields through accepted call_template ids, keep writes serial, do not claim an atomic multi-field transaction, then batch-read back the changed target.",
  });
}

export function createAlpha3C5MacroRuntimeEnvelope({ request = {}, plan, now = () => new Date() } = {}) {
  const normalizedPlan = plan ?? planAlpha3C5GenericControlMacro(request.id, request);
  const macro = getAlpha3C5GenericControlMacro(normalizedPlan.id) ?? null;
  const completedAt = safeNowIso(now);
  const envelope = {
    contract: "template.execution.v1",
    ok: Boolean(normalizedPlan.ok),
    template: {
      id: normalizedPlan.id,
      pack: "macro",
      risk: macro?.risk_domain === "safe_write" ? "safe" : "write",
      action_kind: "macro",
    },
    request: {
      id: null,
      client: {
        id: "openreaper-mcp",
      },
      macro: {
        id: normalizedPlan.id,
        contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
        mode: "plan_only_call_template_macro",
      },
      input: cloneJson(request.input ?? {}),
      refs: cloneJson(request.refs ?? {}),
    },
    completed_at: completedAt,
    error: normalizedPlan.ok
      ? null
      : macroRuntimeError(normalizedPlan),
    result: {
      contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
      action_kind: "macro",
      mode: "plan_only_call_template_macro",
      execution_shape: "generic_control_macro_plan",
      macro: macro === null
        ? null
        : {
            id: macro.id,
            user_label: macro.user_label,
            menu_group: macro.menu_group,
            risk_domain: macro.risk_domain,
            coverage: macro.coverage,
          },
      plan: normalizedPlan,
      execution: {
        executed: false,
        reason: "C5.1 binds official macro discovery and call_template planning only; child template requests remain agent-executed through call_template.",
        added_tools: 0,
        public_call_recipe: false,
        hidden_executor: false,
        raw_execution: false,
        alias_execution: false,
      },
      child_requests: normalizedPlan.requests,
      readback: normalizedPlan.readback,
      agent_execution_flow: normalizedPlan.agent_execution_flow,
      blockers: normalizedPlan.blockers,
    },
    budget: {
      max_response_bytes: 65_536,
      response_bytes: 0,
      truncated: false,
    },
  };
  envelope.budget.response_bytes = byteLength(envelope);
  return deepFreeze(envelope);
}

function macroRuntimeError(plan) {
  const firstBlocker = plan.blockers[0] ?? blocker("macro", "MACRO_BLOCKED", "Macro plan returned a blocker.");
  return {
    source: "macro",
    code: firstBlocker.code,
    message: firstBlocker.message,
    recoverable: firstBlocker.recoverable !== false,
    details: {
      blockers: plan.blockers,
    },
  };
}

function annotateMacro(definition, catalog) {
  const fields = definition.fields.map((fieldDef) => annotateField(fieldDef, catalog));
  const missing = fields
    .filter((fieldDef) => fieldDef.coverage_status !== "covered")
    .map((fieldDef) => blocker(fieldDef.name, "MISSING_ACCEPTED_TEMPLATE", `Required template ${fieldDef.template_id} is not accepted.`));
  const blocked = [...definition.blocked_fields, ...missing];
  const coveredFieldCount = fields.filter((fieldDef) => fieldDef.coverage_status === "covered").length;
  return deepFreeze({
    contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
    id: definition.id,
    status: definition.status ?? "schema_ready",
    action_kind: "macro",
    menu_group: "act",
    execution_shape: "generic_control_macro_plan",
    user_label: definition.user_label,
    task_intents: definition.task_intents,
    scope: definition.scope,
    refs: definition.refs,
    risk_domain: definition.risk_domain,
    undo_scope: "serial_per_template_undo_evidence",
    freshness_requires: definition.freshness_requires,
    readback: definition.readback,
    fields,
    blocked_fields: blocked,
    coverage: {
      status: blocked.length === 0 ? "covered" : "partial",
      covered_field_count: coveredFieldCount,
      field_count: fields.length,
      blocked_field_count: blocked.length,
    },
    safety: {
      no_added_tools: true,
      no_public_call_recipe: true,
      no_hidden_executor: true,
      no_raw_lua_action_shell_or_ui: true,
      missing_capability_rule: "Route missing capability to audited handler/template work before exposing the field.",
    },
  });
}

function officialMacroDiscoveryItem(macro) {
  const requiredRefs = macro.refs.filter((ref) => ref.required === true);
  return deepFreeze({
    id: macro.id,
    title: macro.user_label,
    summary: `${macro.user_label}. Updates supplied supported fields only, returns a plan-only call_template bundle plus compact readback requirements.`,
    pack: "core",
    lifecycle: macro.status === "planned_after_c5" ? "draft" : "experimental",
    risk: macro.risk_domain === "safe_write" ? "safe" : "write",
    entity_kind: `macro.${macro.scope}`,
    tags: unique([
      "macro",
      "generic_control",
      "alpha3_c5",
      macro.scope,
      ...macro.task_intents.flatMap((intent) => intent.split(/\s+/)),
    ].map((entry) => entry.replace(/[^a-z0-9_]+/gi, "_").toLowerCase()).filter(Boolean)).slice(0, 12),
    kind: ALPHA3_C5_OFFICIAL_MACRO_ENTRY_KIND,
    action_kind: "macro",
    macro_kind: "generic_control",
    menu_group: macro.menu_group,
    execution_shape: macro.execution_shape,
    user_label: macro.user_label,
    task_intents: macro.task_intents,
    support_status: macro.status === "planned_after_c5" ? "planned" : "plan_only_runtime_bound",
    risk_domain: macro.risk_domain,
    inputSchema: officialMacroInputSchema(macro),
    outputSchema: {
      type: "object",
      required: ["contract", "action_kind", "mode", "plan", "execution"],
      properties: {
        contract: { const: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT },
        action_kind: { const: "macro" },
        mode: { const: "plan_only_call_template_macro" },
        plan: { type: "object" },
        execution: { type: "object" },
      },
    },
    refs: {
      input: macro.refs,
      output: [],
    },
    expectedDelta: {
      kind: "read",
      action: "read",
      entities: ["macro_plan"],
      summary: "Returns a plan-only macro envelope. It does not mutate REAPER directly.",
    },
    examples: [
      {
        input: {
          fields: exampleFieldsForMacro(macro),
        },
        refs: Object.fromEntries(requiredRefs.map((ref) => [ref.name, `${ref.kind}:example`])),
      },
    ],
    live_runnable_now: false,
    exists_in_catalog: true,
    evidence_level: "runtime_bound_static_fake",
    support_state: macro.status === "planned_after_c5" ? "blocked" : "supported",
    known_blocker: macro.status === "planned_after_c5" ? "planned_after_c5" : null,
    allowed_live_group: null,
  });
}

function officialControlsSetDiscoveryItem(options = {}) {
  const targetKinds = ALPHA3_2_5_C_CONTROL_TARGET_KINDS;
  const fieldsByTarget = Object.fromEntries(targetKinds.map((targetKind) => {
    const macro = getAlpha3_2_5CControlTargetDefinition(targetKind, options);
    return [targetKind, macro?.fields.map((fieldDef) => fieldDef.name) ?? []];
  }));
  return deepFreeze({
    id: ALPHA3_2_5_C_CONTROLS_SET_MACRO_ID,
    title: "Set project controls",
    summary: "Set bounded project BPM, grid, snap, track, item, take, transport, or send controls through one registered executable Macro with live target resolution and readback.",
    pack: "core",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "macro.controls.set",
    tags: ["macro", "controls", "project", "bpm", "grid", "snap", "track", "item", "take", "transport", "send", "executable"],
    kind: ALPHA3_C5_OFFICIAL_MACRO_ENTRY_KIND,
    action_kind: "macro",
    macro_kind: "generic_control",
    menu_group: "act",
    execution_shape: "registered_macro_program",
    user_label: "Set project controls",
    task_intents: [
      "set project BPM tempo grid or snap",
      "set track controls",
      "set item controls",
      "set take controls",
      "set transport controls",
      "set send controls",
      "change track volume pan mute solo arm name or color",
      "move trim fade mute lock or gain an item",
      "change active take gain pan pitch playrate or reverse",
      "set edit cursor loop time selection repeat or playback rate",
      "change internal send volume pan mute mode or channels",
    ],
    support_status: "executable_runtime_bound",
    implementation_status: "executable",
    risk_domain: "write_project_reversible",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      oneOf: [
        { required: ["target_kind", "fields"], not: { required: ["changes"] } },
        { required: ["changes"], not: { anyOf: [{ required: ["target_kind"] }, { required: ["fields"] }, { required: ["selector"] }] } },
      ],
      properties: {
        target_kind: { enum: targetKinds },
        fields: { type: "object", additionalProperties: true },
        selector: {
          type: "object",
          description: "Optional bounded Project Index selector used when canonical refs are not supplied.",
          additionalProperties: true,
        },
        changes: {
          type: "array",
          minItems: 1,
          maxItems: 8,
          description: "Bounded fixed multi-target control rows. Each row resolves, writes, reads back, and reports index maintenance independently.",
          items: {
            type: "object",
            required: ["id", "target_kind", "fields"],
            additionalProperties: false,
            properties: {
              id: { type: "string", minLength: 1, maxLength: 64 },
              target_kind: { enum: targetKinds },
              fields: { type: "object", additionalProperties: true },
              selector: { type: "object", additionalProperties: true },
              refs: { type: ["object", "array"] },
            },
          },
        },
        dry_run: { type: "boolean" },
      },
    },
    outputSchema: {
      type: "object",
      required: ["contract", "ok", "macro", "execution", "result"],
      properties: {
        contract: { const: "macro.execution.v1" },
        ok: { type: "boolean" },
        macro: { type: "object" },
        execution: { type: "object" },
        result: { type: "object" },
      },
    },
    refs: {
      input: [
        { name: "track_ref", kind: "track", required: false },
        { name: "item_ref", kind: "item", required: false },
        { name: "send_ref", kind: "send", required: false },
      ],
      output: [],
    },
    expectedDelta: {
      kind: "write",
      action: "set_controls",
      entities: targetKinds,
      summary: "Executes only the fixed accepted control Templates selected by target_kind and supplied fields, then reads back the target.",
    },
    examples: [
      {
        input: {
          target_kind: "project",
          fields: { bpm: 128, grid_division: "1/8", snap_enabled: true },
          dry_run: false,
        },
      },
      {
        input: {
          target_kind: "track",
          fields: { volume: 0.75, pan: -0.1 },
          selector: { name: "Lead Vocal" },
          dry_run: false,
        },
      },
      {
        input: {
          changes: [
            { id: "lead", target_kind: "track", selector: { name: "Lead Vocal" }, fields: { volume: 0.75 } },
            { id: "bass", target_kind: "track", selector: { name: "Bass" }, fields: { pan: -0.1 } },
          ],
          dry_run: true,
        },
      },
    ],
    target_kinds: targetKinds,
    fields_by_target: fieldsByTarget,
    consolidated_legacy_ids: ALPHA3_2_5_C_LEGACY_CONTROL_MACRO_IDS,
    live_runnable_now: options.liveRunnableNow === true,
    exists_in_catalog: true,
    evidence_level: options.liveRunnableNow === true
      ? "runtime_bound_live_route_available"
      : "runtime_bound_executable",
    support_state: "supported",
    known_blocker: null,
    allowed_live_group: null,
  });
}

function officialMacroInputSchema(macro) {
  const properties = {};
  for (const fieldDef of macro.fields) {
    properties[fieldDef.name] = {
      type: jsonSchemaType(fieldDef.type),
      ...(fieldDef.constraints.values ? { enum: fieldDef.constraints.values } : {}),
      ...(Number.isFinite(fieldDef.constraints.min) ? { minimum: fieldDef.constraints.min } : {}),
      ...(Number.isFinite(fieldDef.constraints.max) ? { maximum: fieldDef.constraints.max } : {}),
    };
  }
  return {
    type: "object",
    required: ["fields"],
    properties: {
      fields: {
        type: "object",
        additionalProperties: true,
        properties,
      },
    },
  };
}

function jsonSchemaType(type) {
  if (type === "integer") return "integer";
  if (type === "number") return "number";
  if (type === "boolean") return "boolean";
  return "string";
}

function exampleFieldsForMacro(macro) {
  const examples = {};
  for (const fieldDef of macro.fields.slice(0, 2)) {
    examples[fieldDef.name] = exampleValueForField(fieldDef);
  }
  return examples;
}

function exampleValueForField(fieldDef) {
  if (fieldDef.constraints.values) return fieldDef.constraints.values[0];
  if (fieldDef.type === "boolean") return true;
  if (fieldDef.type === "integer") return Math.max(1, fieldDef.constraints.min ?? 1);
  if (fieldDef.type === "number") return fieldDef.constraints.min ?? 0;
  return "example";
}

function annotateField(fieldDef, catalog) {
  const descriptor = catalog.get(fieldDef.template_id);
  return deepFreeze({
    ...fieldDef,
    coverage_status: descriptor ? "covered" : "missing_template",
    template_risk: descriptor?.risk ?? null,
    template_required_inputs: descriptor?.inputSchema?.required ?? [],
    template_refs: (descriptor?.refs?.input ?? []).map((ref) => ({
      name: ref.name,
      kind: ref.kind,
      required: Boolean(ref.required),
    })),
  });
}

function validateSuppliedFieldNames(macro, suppliedFieldNames) {
  const supported = new Set(macro.fields.map((fieldDef) => fieldDef.name));
  const blocked = new Map(macro.blocked_fields.map((entry) => [entry.field, entry]));
  const blockers = [];
  for (const name of suppliedFieldNames) {
    if (supported.has(name)) continue;
    const blockedField = blocked.get(name);
    if (blockedField) {
      blockers.push(blocker(name, blockedField.code, blockedField.message));
    } else {
      blockers.push(blocker(name, "FIELD_NOT_SUPPORTED", `${macro.id} does not support field ${name}.`));
    }
  }
  return blockers;
}

function planFieldRequests({ macro, selectedFields, suppliedFields, refs }) {
  const grouped = new Map();
  for (const fieldDef of selectedFields) {
    if (!grouped.has(fieldDef.template_id)) grouped.set(fieldDef.template_id, []);
    grouped.get(fieldDef.template_id).push(fieldDef);
  }

  const plans = [];
  for (const [templateId, fields] of grouped.entries()) {
    plans.push(planTemplateRequest({ macro, templateId, fields, suppliedFields, refs }));
  }
  return plans;
}

function planTemplateRequest({ macro, templateId, fields, suppliedFields, refs }) {
  const missingTemplate = fields.find((fieldDef) => fieldDef.coverage_status !== "covered");
  if (missingTemplate) {
    return {
      requests: [],
      blockers: [blocker(missingTemplate.name, "MISSING_ACCEPTED_TEMPLATE", `Required template ${missingTemplate.template_id} is not accepted.`)],
    };
  }

  const input = {};
  for (const fieldDef of fields) input[fieldDef.template_input] = suppliedFields[fieldDef.name];
  const requiredInputs = fields[0].template_required_inputs ?? [];
  const missingInputs = requiredInputs.filter((name) => !Object.prototype.hasOwnProperty.call(input, name));
  if (missingInputs.length > 0) {
    return {
      requests: [],
      blockers: missingInputs.map((name) => blocker(
        fields[0].name,
        "TEMPLATE_INPUT_GROUP_INCOMPLETE",
        `${templateId} also requires ${name}. Supply the paired field before executing this generic control macro.`,
      )),
    };
  }

  return {
    requests: [deepFreeze({
      tool: "call_template",
      id: templateId,
      input,
      refs: refsForTemplate(macro, refs, templateId),
      fields: fields.map((fieldDef) => fieldDef.name),
      expected_evidence: ["request_id", "undo_evidence", "canonical_refs", "typed_blockers"],
    })],
    blockers: [],
  };
}

function refsForTemplate(macro, refs, templateId) {
  const normalizedRefs = isPlainObject(refs) ? refs : {};
  if (templateId.startsWith("template.routing.set_send_")) {
    return pruneUndefined({ send_ref: normalizedRefs.send_ref });
  }
  if (templateId.startsWith("template.routing.")) {
    return pruneUndefined({
      track_ref: normalizedRefs.track_ref,
      send_ref: normalizedRefs.send_ref,
    });
  }
  if (macro.scope === "track") return pruneUndefined({ track_ref: normalizedRefs.track_ref });
  if (macro.scope === "item" || macro.scope === "take") return pruneUndefined({ item_ref: normalizedRefs.item_ref });
  if (macro.scope === "midi_take") return pruneUndefined({ take_ref: normalizedRefs.take_ref });
  return {};
}

function validateRequiredRefs(macro, refs) {
  const normalizedRefs = isPlainObject(refs) ? refs : {};
  return macro.refs
    .filter((ref) => ref.required && !normalizedRefs[ref.name])
    .map((ref) => blocker(ref.name, "REQUIRED_REF_MISSING", `${macro.id} requires ${ref.name}.`));
}

function planReadbackRequest(macro, refs) {
  const normalizedRefs = isPlainObject(refs) ? refs : {};
  const readbackRefs = {};
  for (const refName of macro.readback.refs_from) {
    if (normalizedRefs[refName] !== undefined) readbackRefs[refName] = normalizedRefs[refName];
  }
  return deepFreeze({
    tool: "call_template",
    id: macro.readback.template_id,
    refs: readbackRefs,
    input: readbackInputFor(macro),
    expected_evidence: macro.readback.evidence_required,
  });
}

function readbackInputFor(macro) {
  if (macro.readback.template_id === "template.project.read_tempo_map") {
    return { limit: 1, effective_at_seconds: [0] };
  }
  if (macro.readback.template_id === "template.tracks.read_mixer_controls") {
    return { include_selected: true, limit: 50 };
  }
  if (macro.readback.template_id === "template.items.read_item_summary") {
    return { include_take_summary: true };
  }
  if (macro.readback.template_id === "template.routing.read_track_routing") {
    return { include_receives: true, include_master_parent: true, max_routes: 100 };
  }
  return {};
}

function normalizeControlFields(targetKind, fields) {
  if (targetKind !== "project") {
    return { ok: true, fields: isPlainObject(fields) ? fields : {}, blockers: [] };
  }
  if (!isPlainObject(fields)) {
    return {
      ok: false,
      fields: {},
      blockers: [blocker("fields", "CONTROL_FIELDS_REQUIRED", "macro.controls.set target_kind=project requires at least one supported field.")],
    };
  }
  const normalized = { ...fields };
  const hasBpm = Object.prototype.hasOwnProperty.call(normalized, "bpm");
  const hasTempo = Object.prototype.hasOwnProperty.call(normalized, "tempo");
  if (hasBpm && hasTempo && !controlFieldValuesMatch(normalized.bpm, normalized.tempo)) {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("tempo", "CONTROL_FIELD_ALIAS_CONFLICT", "fields.tempo aliases fields.bpm and must not disagree with it.")],
    };
  }
  if (!hasBpm && hasTempo) normalized.bpm = normalized.tempo;
  delete normalized.tempo;
  if (Object.keys(normalized).length === 0) {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("fields", "CONTROL_FIELDS_REQUIRED", "macro.controls.set target_kind=project requires at least one supported field.")],
    };
  }
  if (hasOwn(normalized, "bpm") && (typeof normalized.bpm !== "number" || !Number.isFinite(normalized.bpm) || normalized.bpm < 20 || normalized.bpm > 400)) {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("bpm", "CONTROL_BPM_INVALID", "Project BPM must be a finite number between 20 and 400.")],
    };
  }
  if (hasOwn(normalized, "grid_division")) {
    const division = normalizeProjectGridDivision(normalized.grid_division);
    if (division === null) {
      return {
        ok: false,
        fields: normalized,
        blockers: [blocker("grid_division", "CONTROL_GRID_DIVISION_INVALID", "Project grid division must be a positive numeric string or N/D fraction no greater than 64 quarter notes.")],
      };
    }
    normalized.grid_division = division;
  }
  if (hasOwn(normalized, "grid_swing") && !hasOwn(normalized, "grid_division")) {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("grid_swing", "CONTROL_GRID_DIVISION_REQUIRED", "Project grid swing requires grid_division because the accepted grid Template writes both together.")],
    };
  }
  if (hasOwn(normalized, "grid_swing") && (typeof normalized.grid_swing !== "number" || !Number.isFinite(normalized.grid_swing) || normalized.grid_swing < 0 || normalized.grid_swing > 1)) {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("grid_swing", "CONTROL_GRID_SWING_INVALID", "Project grid swing must be a finite number between 0 and 1.")],
    };
  }
  if (hasOwn(normalized, "grid_division") && !hasOwn(normalized, "grid_swing")) normalized.grid_swing = 0;
  if (hasOwn(normalized, "snap_enabled") && typeof normalized.snap_enabled !== "boolean") {
    return {
      ok: false,
      fields: normalized,
      blockers: [blocker("snap_enabled", "CONTROL_SNAP_ENABLED_INVALID", "Project snap enabled state must be boolean.")],
    };
  }
  return { ok: true, fields: normalized, blockers: [] };
}

function normalizeProjectGridDivision(value) {
  if (typeof value !== "string") return null;
  const fraction = /^\s*(\d+)\s*\/\s*(\d+)\s*$/u.exec(value);
  if (fraction) {
    const numerator = Number(fraction[1]);
    const denominator = Number(fraction[2]);
    if (!Number.isSafeInteger(numerator) || !Number.isSafeInteger(denominator) || numerator <= 0 || denominator <= 0) return null;
    const quarterNotes = (numerator / denominator) * 4;
    return Number.isFinite(quarterNotes) && quarterNotes > 0 && quarterNotes <= 64
      ? `${numerator}/${denominator}`
      : null;
  }
  const trimmed = value.trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/u.test(trimmed)) return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) && numeric > 0 && numeric <= 64 ? String(numeric) : null;
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function controlFieldValuesMatch(left, right) {
  if (typeof left === "number" && typeof right === "number") {
    return Number.isFinite(left) && Number.isFinite(right) && Math.abs(left - right) <= 0.0001;
  }
  return Object.is(left, right);
}

function createAlpha3C5AcceptedCatalog() {
  return createTemplateCatalog({
    templates: [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
      ...createTemplateCatalogP1Templates(),
      ...createTemplateCatalogAlpha3C3Templates(),
    ],
  });
}

function field(name, type, templateId, templateInput, constraints = {}) {
  return deepFreeze({
    name,
    type,
    template_id: templateId,
    template_input: templateInput,
    constraints,
  });
}

function blocker(field, code, message) {
  return deepFreeze({
    field,
    code,
    message,
    recoverable: true,
  });
}

function pruneUndefined(object) {
  return Object.fromEntries(Object.entries(object).filter(([, value]) => value !== undefined));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function safeNowIso(now) {
  try {
    const value = now();
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isNaN(date.getTime())) return date.toISOString();
  } catch {
    // Fall through to a valid timestamp.
  }
  return new Date().toISOString();
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function unique(values) {
  return [...new Set(values)];
}

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
