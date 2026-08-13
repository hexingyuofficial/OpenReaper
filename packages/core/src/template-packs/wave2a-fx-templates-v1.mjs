import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_FX_TEMPLATE_IDS = Object.freeze([
  "template.fx.resolve_fx_ref",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.set_reaeq_bands",
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.set_parameter_assignments_batch",
  "template.fx.set_fx_preset_by_name",
  "template.fx.set_fx_preset_by_index",
  "template.fx.reorder_fx",
  "template.fx.read_video_processor_code",
  "template.fx.parameter_to_envelope_mapping",
]);

export const WAVE2A_FX_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.fx.resolve_fx_ref",
    title: "Resolve FX ref",
    summary: "Resolve one track or take FX slot to a bounded FX ref summary.",
    entity_kind: "fx",
    tags: ["fx", "ref", "read", "wave2a"],
    operation_name: "fx.resolve_ref",
    capability: "fx.resolve_ref",
    inputProperties: {
      owner_kind: { enum: ["track", "take"] },
      slot_index: { type: "integer" },
    },
    requiredInput: ["owner_kind", "slot_index"],
    outputProperties: fxSummaryOutput({
      owner_kind: { enum: ["track", "take"] },
      slot_index: { type: "integer" },
    }),
    refs: refs({
      input: [
        ref("track_ref", "track", false, "Track owner ref when resolving track FX."),
        ref("take_ref", "take", false, "Take owner ref when resolving take FX."),
      ],
      output: [ref("fx_ref", "fx", true, "FX ref produced by the resolver.")],
    }),
    expectedSummary: "Reads one FX identity without changing a chain.",
    expectedEntitySummary: "One FX ref and compact summary are read.",
    examples: [
      {
        name: "resolve_track_fx",
        summary: "Resolve the first FX slot on a track.",
        input: { owner_kind: "track", slot_index: 0 },
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.list_track_fx_chain",
    title: "List track FX chain",
    summary: "Read a bounded shallow FX chain list for one resolved track.",
    entity_kind: "fx_chain",
    tags: ["fx", "track", "chain", "wave2a"],
    operation_name: "fx.list_track_chain",
    capability: "fx.list_track_chain",
    inputProperties: {
      include_preset: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      fx_count: { type: "integer" },
      truncated: { type: "boolean" },
      fx_refs: { type: "array" },
    },
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose FX chain is read.")],
      output: [ref("fx_refs", "fx", false, "Zero or more FX refs from the track chain.")],
    }),
    expectedSummary: "Reads shallow track FX chain metadata without parameters, pins, or envelopes.",
    expectedEntitySummary: "Track FX chain metadata is read.",
    examples: [
      {
        name: "list_track_fx",
        summary: "List shallow FX metadata for a track.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.list_take_fx_chain",
    title: "List take FX chain",
    summary: "Read a bounded shallow FX chain list for one resolved take.",
    entity_kind: "fx_chain",
    tags: ["fx", "take", "chain", "wave2a"],
    operation_name: "fx.list_take_chain",
    capability: "fx.list_take_chain",
    inputProperties: {
      include_preset: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      fx_count: { type: "integer" },
      truncated: { type: "boolean" },
      fx_refs: { type: "array" },
    },
    refs: refs({
      input: [ref("take_ref", "take", true, "Take ref whose FX chain is read.")],
      output: [ref("fx_refs", "fx", false, "Zero or more FX refs from the take chain.")],
    }),
    expectedSummary: "Reads shallow take FX chain metadata without selecting items or all takes.",
    expectedEntitySummary: "Take FX chain metadata is read.",
    examples: [
      {
        name: "list_take_fx",
        summary: "List shallow FX metadata for a take.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.read_fx_summary",
    title: "Read FX summary",
    summary: "Read compact metadata for one resolved FX ref.",
    entity_kind: "fx",
    tags: ["fx", "summary", "read", "wave2a"],
    operation_name: "fx.read_summary",
    capability: "fx.read_summary",
    outputProperties: fxSummaryOutput(),
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose compact metadata is read."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after reading metadata.")],
    }),
    expectedSummary: "Reads one FX summary without enumerating parameters.",
    expectedEntitySummary: "One FX summary is read.",
    examples: [
      {
        name: "read_fx_summary",
        summary: "Read compact metadata for a resolved FX.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.list_fx_parameters",
    title: "List FX parameters",
    summary: "Read bounded parameter metadata for one FX without envelope or learn state.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "read", "wave2a"],
    operation_name: "fx.list_parameters",
    capability: "fx.list_parameters",
    inputProperties: {
      limit: { type: "integer" },
      offset: { type: "integer" },
    },
    requiredInput: [],
    outputProperties: {
      parameter_count: { type: "integer" },
      parameters: { type: "array" },
      returned_count: { type: "integer" },
      offset: { type: "integer" },
      next_offset: { oneOf: [{ type: "integer" }, { type: "null" }] },
      truncated: { type: "boolean" },
      inventory_complete: { type: "boolean" },
      coverage_status: { enum: ["complete", "paged"] },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose parameter metadata is listed."),
    }),
    expectedSummary: "Reads bounded FX parameter metadata without creating envelopes or learn mappings.",
    expectedEntitySummary: "FX parameter metadata is read.",
    examples: [
      {
        name: "list_reaeq_parameters",
        summary: "List parameter metadata for one resolved FX.",
        input: { limit: 32, offset: 0 },
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.read_fx_parameter",
    title: "Read FX parameter",
    summary: "Read one FX parameter by index or approved ident, or format one hypothetical normalized value without mutation.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "read", "wave2a"],
    operation_name: "fx.read_parameter",
    capability: "fx.read_parameter",
    inputProperties: {
      ...parameterSelectorProperties(),
      probe_normalized_value: { type: "number", minimum: 0, maximum: 1 },
    },
    requiredInput: ["param_index"],
    outputProperties: parameterValueOutput(),
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose parameter is read."),
    }),
    expectedSummary: "Reads one FX parameter value without editing state.",
    expectedEntitySummary: "One FX parameter value is read.",
    examples: [
      {
        name: "read_fx_param",
        summary: "Read parameter zero from a resolved FX.",
        input: { param_index: 0 },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_reaeq_bands",
    title: "Set ReaEQ bands",
    summary: "Set a bounded ReaEQ band profile by named topology and exact live parameter identity.",
    entity_kind: "fx_reaeq_profile",
    tags: ["fx", "reaeq", "bands", "parameter", "topology", "write", "wave2a"],
    capability: "fx.set_reaeq_bands",
    inputProperties: {
      dry_run: { type: "boolean" },
      bands: {
        type: "array",
        minItems: 1,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            band: { type: "integer", minimum: 1, maximum: 4 },
            type: {
              enum: ["low_shelf", "band", "high_shelf", "low_pass", "high_pass", "notch"],
              description: "Optional target band type written through ReaEQ's bounded named-topology setter.",
            },
            enabled: { type: "boolean" },
            frequency_hz: { type: "number", minimum: 10, maximum: 30000 },
            gain_db: { type: "number", minimum: -60, maximum: 60 },
            bandwidth_oct: { type: "number", minimum: 0.01, maximum: 8 },
          },
          required: ["band"],
          additionalProperties: false,
        },
      },
    },
    requiredInput: ["bands", "dry_run"],
    outputProperties: {
      fx_ref: { type: "string" },
      plugin_identity: { type: "string" },
      owner_kind: { enum: ["track", "take"] },
      topology: { type: "array" },
      parameter_inventory: { type: "array" },
      rows: { type: "array" },
      mutation_attempted: { type: "boolean" },
      batch_timings: { type: "object" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("Exact ReaEQ FX ref whose first four bands are updated."),
      output: [ref("fx_ref", "fx", true, "Same exact ReaEQ FX ref after aggregate readback.")],
    }),
    expectedAction: "update",
    expectedSummary: "Validates ReaEQ identity and complete input before one native batch; topology changes are read back before exact values are compiled and written.",
    expectedEntitySummary: "ReaEQ topology and requested enabled/frequency/gain/bandwidth values are read back as one typed profile.",
    checks: [
      check("reaeq_identity", "state_delta", "The live FX remains ReaEQ with the requested owner kind and slot identity."),
      check("reaeq_topology", "state_delta", "Every requested type matches aggregate named-topology readback before and after exact value mutation."),
      check("reaeq_parameter_identity", "state_delta", "Every returned band row preserves the exact native parameter identity."),
      check("reaeq_zero_write_preflight", "state_delta", "Unknown plugin, topology, inventory, or target mismatch returns zero-write truth."),
    ],
    examples: [{
      name: "set_first_four_reaeq_bands",
      summary: "Set four ReaEQ bands without opening the plugin UI.",
      input: {
        dry_run: false,
        bands: [
          { band: 1, type: "low_shelf", enabled: true, frequency_hz: 80, gain_db: 0, bandwidth_oct: 1 },
          { band: 2, type: "band", enabled: true, frequency_hz: 250, gain_db: -2, bandwidth_oct: 1.2 },
          { band: 3, type: "band", enabled: true, frequency_hz: 3000, gain_db: 2, bandwidth_oct: 1 },
          { band: 4, type: "high_shelf", enabled: true, frequency_hz: 10000, gain_db: 1, bandwidth_oct: 1 },
        ],
      },
    }],
  }),
  writeDescriptor({
    id: "template.fx.add_track_fx",
    title: "Add track FX",
    summary: "Add one named installed FX to a resolved track and return its FX ref.",
    entity_kind: "fx",
    tags: ["fx", "track", "add", "wave2a"],
    capability: "fx.add_track",
    inputProperties: {
      plugin_name: { type: "string" },
      insert_at_index: { type: "integer" },
    },
    requiredInput: ["plugin_name"],
    outputProperties: fxSummaryOutput(),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref that receives the new FX.")],
      output: [ref("fx_ref", "fx", true, "New track FX ref produced by this template.")],
    }),
    expectedAction: "create",
    expectedSummary: "Adds one FX to a track chain without creating tracks or routing.",
    expectedEntitySummary: "One track FX instance is created.",
    idempotent: false,
    checks: [
      check("fx_created", "state_delta", "A new FX ref exists on the target track."),
      check("fx_name_matches", "state_delta", "The new FX name matches input.plugin_name."),
    ],
    examples: [
      {
        name: "add_reaeq_track_fx",
        summary: "Add ReaEQ to the resolved track.",
        input: { plugin_name: "ReaEQ (Cockos)" },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.add_take_fx",
    title: "Add take FX",
    summary: "Add one named installed FX to a resolved take and return its FX ref.",
    entity_kind: "fx",
    tags: ["fx", "take", "add", "wave2a"],
    capability: "fx.add_take",
    inputProperties: {
      plugin_name: { type: "string" },
      insert_at_index: { type: "integer" },
    },
    requiredInput: ["plugin_name"],
    outputProperties: fxSummaryOutput(),
    refs: refs({
      input: [ref("take_ref", "take", true, "Take ref that receives the new FX.")],
      output: [ref("fx_ref", "fx", true, "New take FX ref produced by this template.")],
    }),
    expectedAction: "create",
    expectedSummary: "Adds one FX to a take chain without selecting items or changing media.",
    expectedEntitySummary: "One take FX instance is created.",
    idempotent: false,
    checks: [
      check("fx_created", "state_delta", "A new FX ref exists on the target take."),
      check("fx_name_matches", "state_delta", "The new FX name matches input.plugin_name."),
    ],
    examples: [
      {
        name: "add_reaeq_take_fx",
        summary: "Add ReaEQ to the resolved take.",
        input: { plugin_name: "ReaEQ (Cockos)" },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_fx_bypass",
    title: "Set FX bypass",
    summary: "Set one FX enabled state explicitly and verify bypass readback.",
    entity_kind: "fx",
    tags: ["fx", "bypass", "wave2a"],
    capability: "fx.set_bypass",
    inputProperties: {
      enabled: { type: "boolean" },
    },
    requiredInput: ["enabled"],
    outputProperties: {
      fx_ref: { type: "string" },
      enabled: { type: "boolean" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose enabled state is set."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after bypass update.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates one FX enabled state without muting tracks or changing render settings.",
    expectedEntitySummary: "FX enabled state is updated.",
    checks: [check("fx_enabled_matches", "state_delta", "The FX enabled state matches input.enabled.")],
    examples: [
      {
        name: "bypass_fx",
        summary: "Disable processing for the resolved FX.",
        input: { enabled: false },
      },
      {
        name: "unbypass_fx",
        summary: "Enable processing for the resolved FX.",
        input: { enabled: true },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_fx_parameter_normalized",
    title: "Set FX parameter normalized",
    summary: "Set one FX parameter with continuous tolerance or REAPER-native discrete quantization readback.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "write", "wave2a"],
    capability: "fx.set_parameter_normalized",
    inputProperties: {
      ...parameterSelectorProperties(),
      normalized_value: { type: "number" },
      tolerance: { type: "number" },
    },
    requiredInput: ["param_index", "normalized_value"],
    outputProperties: {
      ...parameterValueOutput(),
      requested_normalized_value: { type: "number" },
      requested_formatted_value: { oneOf: [{ type: "string" }, { type: "null" }] },
      tolerance: { type: "number" },
      verification_mode: { enum: ["numeric_tolerance", "native_discrete_format"] },
      updated: { type: "boolean" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose parameter is updated."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after parameter update.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates one normalized FX parameter without writing automation or learn mappings.",
    expectedEntitySummary: "One FX parameter value is updated.",
    checks: [
      check("fx_ref_resolves", "state_delta", "The FX ref still resolves after the parameter update."),
      check("parameter_value_matches", "state_delta", "The live readback matches continuous tolerance or the exact REAPER-native discrete formatted value."),
    ],
    examples: [
      {
        name: "set_fx_param_normalized",
        summary: "Set parameter zero to the midpoint normalized value.",
        input: { param_index: 0, normalized_value: 0.5, tolerance: 0.0001 },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_parameter_assignments_batch",
    title: "Set FX parameter assignments batch",
    summary: "Validate a complete exact FX parameter assignment batch, then apply serial native chunks and one aggregate readback.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "batch", "native", "wave2a"],
    capability: "fx.set_parameter_assignments_batch",
    inputProperties: {
      dry_run: { type: "boolean" },
      batch: { type: "array" },
    },
    requiredInput: ["batch", "dry_run"],
    outputProperties: {
      rows: { type: "array" },
      mutation_attempted: { type: "boolean" },
      batch_timings: { type: "object" },
    },
    refs: refs({
      input: [ref("fx_refs", "fx", true, "All exact FX refs addressed by the batch.")],
      output: [ref("fx_refs", "fx", true, "Exact FX refs preserved after aggregate readback.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates exact FX parameter assignments through one native batch dispatch with all-row preflight and aggregate readback.",
    expectedEntitySummary: "Exact FX parameter assignments are validated and read back as one batch.",
    checks: [
      check("batch_identity_preserved", "state_delta", "Every returned row preserves id, FX ref, parameter identity, formatted value, and native tolerance truth."),
      check("batch_zero_write_dry_run", "state_delta", "dry_run returns a complete preflight without calling a native setter."),
    ],
    examples: [
      {
        name: "set_exact_assignment_batch",
        summary: "Apply two exact parameter assignments through one native batch.",
        input: {
          dry_run: false,
          batch: [
            { id: "gain", fx_ref: "fx:track:guid:{TRACK}:0", param_index: 0, normalized_value: 0.5 },
            { id: "mix", fx_ref: "fx:track:guid:{TRACK}:0", param_ident: "mix", normalized_value: 0.25 },
          ],
        },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_fx_preset_by_name",
    title: "Set FX preset by name",
    summary: "Activate a named FX preset without accepting external preset-file paths.",
    entity_kind: "preset",
    tags: ["fx", "preset", "wave2a"],
    capability: "fx.set_preset_by_name",
    inputProperties: {
      preset_name: { type: "string" },
    },
    requiredInput: ["preset_name"],
    outputProperties: {
      fx_ref: { type: "string" },
      preset_name: { type: "string" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose preset is activated."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after preset activation.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates one FX preset by dropdown name only.",
    expectedEntitySummary: "FX preset selection is updated.",
    checks: [check("preset_name_matches", "state_delta", "The active FX preset name matches input.preset_name.")],
    examples: [
      {
        name: "set_named_preset",
        summary: "Set a named preset on the resolved FX.",
        input: { preset_name: "stock - Basic 11 band" },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.set_fx_preset_by_index",
    title: "Set FX preset by index",
    summary: "Activate an FX preset by bounded index and verify current preset index.",
    entity_kind: "preset",
    tags: ["fx", "preset", "wave2a"],
    capability: "fx.set_preset_by_index",
    inputProperties: {
      preset_index: { type: "integer" },
    },
    requiredInput: ["preset_index"],
    outputProperties: {
      fx_ref: { type: "string" },
      preset_index: { type: "integer" },
      preset_count: { type: "integer" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose preset index is activated."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after preset index update.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates one FX preset by index without loading external preset files.",
    expectedEntitySummary: "FX preset index is updated.",
    checks: [check("preset_index_matches", "state_delta", "The active FX preset index matches input.preset_index.")],
    examples: [
      {
        name: "set_indexed_preset",
        summary: "Set preset index zero on the resolved FX.",
        input: { preset_index: 0 },
      },
    ],
  }),
  writeDescriptor({
    id: "template.fx.reorder_fx",
    title: "Reorder FX",
    summary: "Move one FX within its current track or take chain to an explicit target slot.",
    entity_kind: "fx_chain",
    tags: ["fx", "chain", "order", "wave2a"],
    capability: "fx.reorder",
    inputProperties: {
      target_index: { type: "integer" },
    },
    requiredInput: ["target_index"],
    outputProperties: {
      fx_ref: { type: "string" },
      slot_index: { type: "integer" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref moved within its current chain."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after chain reorder.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates FX chain order without copying, deleting, or crossing owners.",
    expectedEntitySummary: "FX chain order is updated.",
    checks: [check("fx_slot_matches", "state_delta", "The FX slot matches input.target_index.")],
    examples: [
      {
        name: "move_fx_to_first_slot",
        summary: "Move the resolved FX to slot zero.",
        input: { target_index: 0 },
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.read_video_processor_code",
    title: "Read video processor code",
    summary: "Read bounded VIDEO_CODE from one video processor FX and emit a code artifact ref.",
    entity_kind: "video_processor",
    tags: ["fx", "video_processor", "read", "wave2a"],
    operation_name: "fx.read_video_processor_code",
    capability: "fx.read_video_processor_code",
    outputProperties: {
      artifact_ref: { type: "string" },
      schema: { const: "fx.video_processor_code.v1" },
      code_bytes: { type: "integer" },
      truncated: { type: "boolean" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("Video processor FX ref whose code is read."),
      output: [ref("artifact_ref", "artifact", true, "Artifact ref containing bounded VIDEO_CODE facts.")],
    }),
    artifacts: artifacts({
      mode: "produces",
      output: [
        artifact(
          "video_processor_code",
          "fx.video_processor_code.v1",
          "fx",
          "Bounded video processor code artifact.",
        ),
      ],
    }),
    expectedKind: "artifact",
    expectedEntityKind: "video_processor",
    expectedAction: "emit",
    expectedSummary: "Emits a bounded artifact for video processor code without replacing code.",
    expectedEntitySummary: "Video processor code artifact is emitted.",
    examples: [
      {
        name: "read_video_processor_code",
        summary: "Read bounded code facts for a resolved video processor FX.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.parameter_to_envelope_mapping",
    title: "Map FX parameter to envelope",
    summary: "Read the existing automation envelope mapping for one FX parameter without creating it.",
    entity_kind: "fx_param.envelope_mapping",
    tags: ["fx", "parameter", "envelope", "mapping", "read", "wave2a", "alpha2"],
    operation_name: "fx.parameter_to_envelope_mapping",
    capability: "fx.parameter_to_envelope_mapping",
    inputProperties: parameterSelectorProperties(),
    requiredInput: ["param_index"],
    outputProperties: {
      fx_ref: { type: "string" },
      param_index: { type: "integer" },
      param_ident: { type: "string" },
      envelope_ref: { type: "string" },
      envelope_name: { type: "string" },
      envelope_exists: { type: "boolean" },
      normalized_min: { type: "number" },
      normalized_max: { type: "number" },
    },
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose parameter mapping is read."),
      output: [
        ref("fx_ref", "fx", true, "Same FX ref returned with mapping metadata."),
        ref("envelope_ref", "envelope", false, "Existing parameter envelope ref when present."),
      ],
    }),
    expectedSummary: "Reads an existing FX parameter envelope mapping without inserting points.",
    expectedEntitySummary: "FX parameter to envelope mapping is read.",
    examples: [
      {
        name: "map_fx_param_envelope",
        summary: "Read the envelope mapping for parameter zero.",
        input: { param_index: 0 },
      },
    ],
  }),
]);

export function createWave2AFxTemplates() {
  return cloneJson(WAVE2A_FX_TEMPLATES);
}

function readDescriptor(options) {
  const expectedKind = options.expectedKind ?? "read";
  const expectedEntityKind = options.expectedEntityKind ?? options.entity_kind;
  const expectedAction = options.expectedAction ?? "read";

  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "fx",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: bridge({
      operation_family: "query_state",
      operation_name: options.operation_name,
      capability: options.capability,
      idempotency: "none",
    }),
    inputSchema: objectSchema(options.inputProperties ?? {}, options.requiredInput ?? []),
    outputSchema: objectSchema(options.outputProperties ?? {}, Object.keys(options.outputProperties ?? {})),
    refs: options.refs ?? refs(),
    artifacts: options.artifacts ?? artifacts(),
    expectedDelta: expectedDelta({
      kind: expectedKind,
      summary: options.expectedSummary,
      entities: [
        {
          entity_kind: expectedEntityKind,
          action: expectedAction,
          summary: options.expectedEntitySummary,
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: options.examples,
  };
}

function fxOwnerScopedInputRefs(fxSummary) {
  return [
    ref("fx_ref", "fx", true, fxSummary),
    ref("track_ref", "track", false, "Track owner ref required when the FX ref is an unscoped track-slot alias."),
    ref("take_ref", "take", false, "Take owner ref required when the FX ref is an unscoped take-slot alias."),
  ];
}

function writeDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "fx",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: bridge({
      capability: options.capability,
      idempotency: "supported",
    }),
    inputSchema: objectSchema(options.inputProperties ?? {}, options.requiredInput ?? []),
    outputSchema: objectSchema(options.outputProperties ?? {}, Object.keys(options.outputProperties ?? {})),
    refs: options.refs ?? refs(),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: options.expectedSummary,
      entities: [
        {
          entity_kind: options.entity_kind,
          action: options.expectedAction,
          summary: options.expectedEntitySummary,
        },
      ],
      idempotent: options.idempotent ?? true,
    }),
    verification: verification({ checks: options.checks }),
    examples: options.examples,
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "fx.update",
    idempotency: "supported",
    timeout_ms: 5_000,
    ...overrides,
  };
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function parameterSelectorProperties() {
  return {
    param_index: { type: "integer" },
    param_ident: { type: "string" },
  };
}

function fxSummaryOutput(extra = {}) {
  return {
    fx_ref: { type: "string" },
    name: { type: "string" },
    ident: { type: "string" },
    enabled: { type: "boolean" },
    preset_name: { type: "string" },
    is_video_processor: { type: "boolean" },
    ...extra,
  };
}

function parameterValueOutput() {
  return {
    fx_ref: { type: "string" },
    param_index: { type: "integer" },
    param_ident: { type: "string" },
    normalized_value: { type: "number" },
    formatted_value: { type: "string" },
    step_sizes_available: { type: "boolean" },
    step_size: { oneOf: [{ type: "number" }, { type: "null" }] },
    small_step_size: { oneOf: [{ type: "number" }, { type: "null" }] },
    large_step_size: { oneOf: [{ type: "number" }, { type: "null" }] },
    is_toggle: { oneOf: [{ type: "boolean" }, { type: "null" }] },
    is_discrete: { oneOf: [{ type: "boolean" }, { type: "null" }] },
  };
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
  };
}

function ref(name, kind, required, summary = `${kind} ref.`) {
  return {
    name,
    kind,
    required,
    summary,
  };
}

function artifacts(overrides = {}) {
  return {
    mode: "none",
    input: [],
    output: [],
    ...overrides,
  };
}

function artifact(name, schema, owner_pack, summary = `${schema} artifact.`) {
  return {
    name,
    schema,
    owner_pack,
    summary,
  };
}

function expectedDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Template expected delta.",
    entities: [],
    idempotent: false,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    mode: "required",
    checks: [],
    ...overrides,
  };
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
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
