import {
  createTemplateCatalog,
} from "../../core/src/template-catalog-v1.mjs";
import {
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogP1Templates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../core/src/template-catalog-fixtures-v1.mjs";

export const ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT = "alpha3.c5.generic_control_macros.v1";

export const ALPHA3_C5_GENERIC_CONTROL_DISCOVERY_SUMMARY = deepFreeze({
  contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
  mode: "plan_only_schema_registry",
  tool_surface: {
    added_tools: 0,
    discovery_tools: ["list_templates"],
    execution_tool: "call_template",
    artifact_tool: "get_state",
  },
  menu_group: "act",
  action_kind: "macro",
  execution_shape: "generic_control_macro_plan",
  macro_ids: [
    "macro.set_track_controls",
    "macro.set_item_controls",
    "macro.set_take_controls",
    "macro.set_transport_controls",
    "macro.set_send_controls",
    "macro.set_midi_controls",
  ],
  rule: "Supported fields are optional. Unknown or blocked fields return typed blockers. Emit serial per-template call_template requests with per-template undo evidence; no atomic multi-field transaction is claimed.",
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
    task_intents: ["move an item", "trim an item", "mute an item", "change item gain or pan", "set item fades"],
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
      field("pan", "number", "template.items.set_item_pan", "pan", { min: -1, max: 1 }),
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

export function getAlpha3C5GenericControlMacro(id, options = {}) {
  const catalog = options.catalog ?? createAlpha3C5AcceptedCatalog();
  const definition = MACRO_DEFINITIONS.find((macro) => macro.id === id);
  if (!definition) return null;
  return annotateMacro(definition, catalog);
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

  return deepFreeze({
    contract: ALPHA3_C5_GENERIC_CONTROL_MACROS_CONTRACT,
    ok: blockers.length === 0,
    id: macro.id,
    mode: "plan_only_call_template_macro",
    action_kind: "macro",
    menu_group: "act",
    risk_domain: macro.risk_domain,
    undo_scope: requests.length > 0 ? "serial_per_template_undo_evidence" : "none",
    freshness_requires: macro.freshness_requires,
    requests,
    readback,
    blockers,
    policy: "Execute only supplied supported fields through accepted call_template ids, keep writes serial, do not claim an atomic multi-field transaction, then batch-read back the changed target.",
  });
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

function createAlpha3C5AcceptedCatalog() {
  return createTemplateCatalog({
    templates: [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
      ...createTemplateCatalogP1Templates(),
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

function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const nested of Object.values(value)) deepFreeze(nested);
  }
  return value;
}
