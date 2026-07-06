import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_FX_TEMPLATE_IDS = Object.freeze([
  "template.fx.resolve_fx_ref",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
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
    },
    requiredInput: [],
    outputProperties: {
      parameter_count: { type: "integer" },
      parameters: { type: "array" },
      truncated: { type: "boolean" },
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
        input: { limit: 32 },
      },
    ],
  }),
  readDescriptor({
    id: "template.fx.read_fx_parameter",
    title: "Read FX parameter",
    summary: "Read one FX parameter by index or approved ident and return normalized facts.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "read", "wave2a"],
    operation_name: "fx.read_parameter",
    capability: "fx.read_parameter",
    inputProperties: parameterSelectorProperties(),
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
    summary: "Set one FX parameter with a normalized 0..1 value and bounded readback tolerance.",
    entity_kind: "fx_param",
    tags: ["fx", "parameter", "write", "wave2a"],
    capability: "fx.set_parameter_normalized",
    inputProperties: {
      ...parameterSelectorProperties(),
      normalized_value: { type: "number" },
      tolerance: { type: "number" },
    },
    requiredInput: ["param_index", "normalized_value"],
    outputProperties: parameterValueOutput(),
    refs: refs({
      input: fxOwnerScopedInputRefs("FX ref whose parameter is updated."),
      output: [ref("fx_ref", "fx", true, "Same FX ref after parameter update.")],
    }),
    expectedAction: "update",
    expectedSummary: "Updates one normalized FX parameter without writing automation or learn mappings.",
    expectedEntitySummary: "One FX parameter value is updated.",
    checks: [
      check("fx_ref_resolves", "state_delta", "The FX ref still resolves after the parameter update."),
      check("parameter_value_matches", "state_delta", "The normalized readback matches within tolerance."),
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
