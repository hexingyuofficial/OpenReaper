import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_ROUTING_TEMPLATE_IDS = Object.freeze([
  "template.routing.read_track_routing",
  "template.routing.resolve_send_ref",
  "template.routing.create_track_send",
  "template.routing.set_send_volume",
  "template.routing.set_send_pan",
  "template.routing.set_send_mute",
  "template.routing.set_send_mode",
  "template.routing.set_master_parent_send",
  "template.routing.set_track_channel_count",
  "template.routing.read_project_routing_graph",
  "template.routing.set_send_audio_channels",
  "template.routing.set_send_phase",
  "template.routing.set_send_mono",
  "template.routing.set_send_midi_channels",
  "template.routing.read_fx_pin_mapping",
]);

export const WAVE2A_ROUTING_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.read_track_routing",
    title: "Read track routing",
    summary: "Read one track's ordinary sends, receives, channels, and master-parent routing.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "send",
    tags: ["routing", "track", "send", "read", "wave2a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "routing.track.read",
      capability: "routing.track.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_receives: { type: "boolean" },
      include_master_parent: { type: "boolean" },
      max_routes: { type: "integer" },
    }, []),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      channel_count: { type: "integer" },
      master_parent_enabled: { type: "boolean" },
      sends: { type: "array" },
      receives: { type: "array" },
      truncated: { type: "boolean" },
    }, ["track_ref"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose ordinary routing will be read.")],
      output: [ref("send_refs", "send", false, "Send refs summarized by the read.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads ordinary track sends, receives, channel count, and master-parent state.",
      entities: [
        {
          entity_kind: "send",
          action: "read",
          summary: "Track routing entries are summarized without mutation.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_dialog_routing",
        summary: "Read ordinary routing for a resolved Dialog track.",
        input: { include_receives: true, include_master_parent: true, max_routes: 32 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.resolve_send_ref",
    title: "Resolve send ref",
    summary: "Resolve a logical send locator to a canonical send ref and compact route summary.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "send",
    tags: ["routing", "send", "ref", "read", "wave2a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "routing.send.resolve_ref",
      capability: "routing.send.resolve_ref",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      send_ref: { type: "string" },
    }, ["send_ref"]),
    outputSchema: objectSchema({
      send_ref: { type: "string" },
      category: { enum: ["send", "receive"] },
      source_track_ref: { type: "string" },
      destination_track_ref: { type: "string" },
      index: { type: "integer" },
    }, ["send_ref"]),
    refs: refs({
      output: [ref("send_ref", "send", true, "Canonical send ref produced by the resolver.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads one send identity and compact source/destination summary.",
      entities: [
        {
          entity_kind: "send",
          action: "read",
          summary: "A send identity is resolved.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "resolve_track_send",
        summary: "Resolve the first send on a track.",
        input: { send_ref: "send:guid:{TRACK-GUID}:0" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.create_track_send",
    title: "Create track send",
    summary: "Create one ordinary track-to-track send and return the new send ref.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "send",
    tags: ["routing", "send", "create", "wave2a"],
    bridge: bridge({
      capability: "routing.send.create",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      duplicate_policy: { enum: ["allow", "reject_existing"] },
    }, []),
    outputSchema: objectSchema({
      send_ref: { type: "string" },
      source_track_ref: { type: "string" },
      destination_track_ref: { type: "string" },
    }, ["send_ref"]),
    refs: refs({
      input: [
        ref("source_track_ref", "track", true, "Track ref sending signal."),
        ref("destination_track_ref", "track", true, "Track ref receiving signal."),
      ],
      output: [ref("send_ref", "send", true, "Send ref created by this template.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates one ordinary track-to-track send without creating tracks or sidechains.",
      entities: [
        {
          entity_kind: "send",
          action: "create",
          summary: "One ordinary track send is created.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "send_created",
          kind: "state_delta",
          summary: "A new send ref exists after creation.",
        },
        {
          name: "send_destination_matches",
          kind: "state_delta",
          summary: "The send destination matches the supplied destination track ref.",
        },
      ],
    }),
    examples: [
      {
        name: "create_reverb_send",
        summary: "Create an ordinary send from a vocal track to a reverb bus.",
        input: { duplicate_policy: "reject_existing" },
      },
    ],
  },
  sendUpdateTemplate({
    id: "template.routing.set_send_volume",
    title: "Set send volume",
    summary: "Set one send volume scalar without changing track volume.",
    capability: "routing.send.set_volume",
    tags: ["routing", "send", "volume", "wave2a"],
    inputProperties: {
      volume: { type: "number" },
    },
    required: ["volume"],
    outputProperties: {
      volume: { type: "number" },
    },
    expectedSummary: "Updates one send volume field.",
    checkName: "send_volume_matches",
    checkSummary: "The resolved send volume matches input.volume.",
    example: {
      name: "set_reverb_send_volume",
      summary: "Set the resolved send to unity gain.",
      input: { volume: 1 },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_pan",
    title: "Set send pan",
    summary: "Set one send pan value without changing track pan.",
    capability: "routing.send.set_pan",
    tags: ["routing", "send", "pan", "wave2a"],
    inputProperties: {
      pan: { type: "number" },
    },
    required: ["pan"],
    outputProperties: {
      pan: { type: "number" },
    },
    expectedSummary: "Updates one send pan field.",
    checkName: "send_pan_matches",
    checkSummary: "The resolved send pan matches input.pan.",
    example: {
      name: "pan_reverb_send_left",
      summary: "Pan the resolved send slightly left.",
      input: { pan: -0.25 },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_mute",
    title: "Set send mute",
    summary: "Set one send mute state without changing track mute.",
    capability: "routing.send.set_mute",
    tags: ["routing", "send", "mute", "wave2a"],
    inputProperties: {
      muted: { type: "boolean" },
    },
    required: ["muted"],
    outputProperties: {
      muted: { type: "boolean" },
    },
    expectedSummary: "Updates one send mute field.",
    checkName: "send_mute_matches",
    checkSummary: "The resolved send mute state matches input.muted.",
    example: {
      name: "mute_reverb_send",
      summary: "Mute the resolved send.",
      input: { muted: true },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_mode",
    title: "Set send mode",
    summary: "Set one send mode using a narrow post-fader, pre-fx, or post-fx enum.",
    capability: "routing.send.set_mode",
    tags: ["routing", "send", "mode", "wave2a"],
    inputProperties: {
      mode: { enum: ["post_fader", "pre_fx", "post_fx"] },
    },
    required: ["mode"],
    outputProperties: {
      mode: { enum: ["post_fader", "pre_fx", "post_fx"] },
    },
    expectedSummary: "Updates one send mode field.",
    checkName: "send_mode_matches",
    checkSummary: "The resolved send mode matches input.mode.",
    example: {
      name: "set_pre_fx_send",
      summary: "Set the resolved send to pre-fx mode.",
      input: { mode: "pre_fx" },
    },
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.set_master_parent_send",
    title: "Set master parent send",
    summary: "Enable or disable one track's master-parent audio routing state.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "channel",
    tags: ["routing", "track", "master_parent", "wave2a"],
    bridge: bridge({
      capability: "routing.master_parent.set",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      enabled: { type: "boolean" },
    }, ["enabled"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      enabled: { type: "boolean" },
    }, ["track_ref", "enabled"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose master-parent routing will be set.")],
      output: [ref("track_ref", "track", true, "Same track ref after routing update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track's master-parent routing field without changing folder structure.",
      entities: [
        {
          entity_kind: "channel",
          action: "update",
          summary: "The track master-parent routing state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "master_parent_matches",
          kind: "state_delta",
          summary: "The resolved track master-parent routing state matches input.enabled.",
        },
      ],
    }),
    examples: [
      {
        name: "disable_master_parent_send",
        summary: "Disable master-parent routing for the resolved cue track.",
        input: { enabled: false },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.set_track_channel_count",
    title: "Set track channel count",
    summary: "Set one track's routing channel count to an even value from 2 through 128.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "channel",
    tags: ["routing", "track", "channel", "wave2a"],
    bridge: bridge({
      capability: "routing.track_channels.set",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      channel_count: { enum: evenChannelCounts() },
    }, ["channel_count"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      channel_count: { type: "integer" },
    }, ["track_ref", "channel_count"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose routing channel count will be set.")],
      output: [ref("track_ref", "track", true, "Same track ref after channel-count update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track channel-count field for multichannel routing.",
      entities: [
        {
          entity_kind: "channel",
          action: "update",
          summary: "The track channel count is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_channel_count_matches",
          kind: "state_delta",
          summary: "The resolved track channel count matches input.channel_count.",
        },
      ],
    }),
    examples: [
      {
        name: "set_four_track_channels",
        summary: "Set the resolved track to four routing channels.",
        input: { channel_count: 4 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.read_project_routing_graph",
    title: "Read project routing graph",
    summary: "Read a bounded graph of ordinary sends, receives, and master-parent edges.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "send",
    tags: ["routing", "graph", "send", "read", "wave2a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "routing.project_graph.read",
      capability: "routing.project_graph.read",
      idempotency: "none",
      timeout_ms: 10_000,
    }),
    inputSchema: objectSchema({
      max_tracks: { type: "integer" },
      max_edges: { type: "integer" },
      include_master_parent: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      track_count: { type: "integer" },
      edge_count: { type: "integer" },
      tracks: { type: "array" },
      edges: { type: "array" },
      truncated: { type: "boolean" },
    }, []),
    refs: refs({
      output: [
        ref("track_refs", "track", false, "Track refs included in the bounded routing graph."),
        ref("send_refs", "send", false, "Send refs included in the bounded routing graph."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads bounded ordinary routing graph metadata without mutating project routing.",
      entities: [
        {
          entity_kind: "send",
          action: "read",
          summary: "Project send and receive edges are summarized.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_small_routing_graph",
        summary: "Read a bounded routing graph for the current project.",
        input: { max_tracks: 64, max_edges: 128, include_master_parent: true },
      },
    ],
  },
  sendUpdateTemplate({
    id: "template.routing.set_send_audio_channels",
    title: "Set send audio channels",
    summary: "Set one send's complete typed audio source and destination channel mapping.",
    capability: "routing.send.audio_channels.set",
    tags: ["routing", "send", "channel", "wave2a"],
    entityKind: "channel",
    inputProperties: {
      source_channel_offset: { type: "integer" },
      source_channel_count: { enum: [1, 2, 4, 6, 8, 16] },
      destination_channel_offset: { type: "integer" },
      mix_to_mono: { type: "boolean" },
    },
    required: [
      "source_channel_offset",
      "source_channel_count",
      "destination_channel_offset",
      "mix_to_mono",
    ],
    outputProperties: {
      source_channel_offset: { type: "integer" },
      source_channel_count: { type: "integer" },
      destination_channel_offset: { type: "integer" },
      mix_to_mono: { type: "boolean" },
    },
    expectedSummary: "Updates one send audio channel mapping.",
    checkName: "send_audio_channels_match",
    checkSummary: "The resolved send audio channel mapping matches the typed input fields.",
    example: {
      name: "map_send_to_sidechain_channels",
      summary: "Map a stereo send to destination channels 3 and 4.",
      input: {
        source_channel_offset: 0,
        source_channel_count: 2,
        destination_channel_offset: 2,
        mix_to_mono: false,
      },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_phase",
    title: "Set send phase",
    summary: "Set one send phase-invert flag without running phase analysis.",
    capability: "routing.send.set_phase",
    tags: ["routing", "send", "phase", "wave2a"],
    inputProperties: {
      phase_inverted: { type: "boolean" },
    },
    required: ["phase_inverted"],
    outputProperties: {
      phase_inverted: { type: "boolean" },
    },
    expectedSummary: "Updates one send phase flag.",
    checkName: "send_phase_matches",
    checkSummary: "The resolved send phase flag matches input.phase_inverted.",
    example: {
      name: "invert_send_phase",
      summary: "Invert phase on the resolved send.",
      input: { phase_inverted: true },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_mono",
    title: "Set send mono",
    summary: "Set one send mono-summing flag without changing track channel count.",
    capability: "routing.send.set_mono",
    tags: ["routing", "send", "mono", "wave2a"],
    inputProperties: {
      mono: { type: "boolean" },
    },
    required: ["mono"],
    outputProperties: {
      mono: { type: "boolean" },
    },
    expectedSummary: "Updates one send mono flag.",
    checkName: "send_mono_matches",
    checkSummary: "The resolved send mono flag matches input.mono.",
    example: {
      name: "mono_send",
      summary: "Enable mono summing for the resolved send.",
      input: { mono: true },
    },
  }),
  sendUpdateTemplate({
    id: "template.routing.set_send_midi_channels",
    title: "Set send MIDI channels",
    summary: "Set intra-project MIDI channel and bus flags for one ordinary send.",
    capability: "routing.send.midi_channels.set",
    tags: ["routing", "send", "midi", "channel", "wave2a"],
    entityKind: "channel",
    inputProperties: {
      source_channel: { enum: midiSourceChannels() },
      destination_channel: { enum: midiDestinationChannels() },
      source_bus: { type: "integer" },
      destination_bus: { type: "integer" },
      send_volume_pan: { type: "boolean" },
    },
    required: ["source_channel", "destination_channel"],
    outputProperties: {
      source_channel: { type: "string" },
      destination_channel: { type: "string" },
      source_bus: { type: "integer" },
      destination_bus: { type: "integer" },
      send_volume_pan: { type: "boolean" },
    },
    expectedSummary: "Updates one ordinary send MIDI channel mapping.",
    checkName: "send_midi_channels_match",
    checkSummary: "The resolved send MIDI channel and bus flags match the typed input fields.",
    example: {
      name: "map_send_midi_channel",
      summary: "Route all source MIDI to destination channel 1 on the ordinary send.",
      input: { source_channel: "all", destination_channel: "1", source_bus: 0, destination_bus: 0 },
    },
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.routing.read_fx_pin_mapping",
    title: "Read FX pin mapping",
    summary: "Read one FX input or output pin mapping as routing metadata without writing pins.",
    pack: "routing",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "pin_mapping",
    tags: ["routing", "fx", "pin_mapping", "read", "wave2a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "routing.fx_pin_mapping.read",
      capability: "routing.fx_pin_mapping.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      direction: { enum: ["input", "output"] },
      pin_index: { type: "integer" },
      include_high_bits: { type: "boolean" },
    }, ["direction", "pin_index"]),
    outputSchema: objectSchema({
      fx_ref: { type: "string" },
      direction: { enum: ["input", "output"] },
      pin_index: { type: "integer" },
      low32_bits: { type: "integer" },
      high32_bits: { type: "integer" },
      supported: { type: "boolean" },
    }, ["fx_ref", "direction", "pin_index"]),
    refs: refs({
      input: [
        ref("track_ref", "track", true, "Track ref containing the FX instance."),
        ref("fx_ref", "fx", true, "FX ref whose pin mapping will be read."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads one effective FX pin mapping without changing FX chain or pins.",
      entities: [
        {
          entity_kind: "pin_mapping",
          action: "read",
          summary: "An FX pin mapping is read as routing metadata.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_fx_output_pin",
        summary: "Read output pin 0 mapping for the resolved FX.",
        input: { direction: "output", pin_index: 0, include_high_bits: true },
      },
    ],
  },
]);

export function createWave2ARoutingTemplates() {
  return cloneJson(WAVE2A_ROUTING_TEMPLATES);
}

function sendUpdateTemplate({
  id,
  title,
  summary,
  capability,
  tags,
  entityKind = "send",
  inputProperties,
  required,
  outputProperties,
  expectedSummary,
  checkName,
  checkSummary,
  example,
}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id,
    title,
    summary,
    pack: "routing",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: entityKind,
    tags,
    bridge: bridge({
      capability,
      idempotency: "supported",
    }),
    inputSchema: objectSchema(inputProperties, required),
    outputSchema: objectSchema({
      send_ref: { type: "string" },
      ...outputProperties,
    }, ["send_ref", ...required]),
    refs: refs({
      input: [ref("send_ref", "send", true, "Send ref whose routing field will be set.")],
      output: [ref("send_ref", "send", true, "Same send ref after routing update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: expectedSummary,
      entities: [
        {
          entity_kind: entityKind,
          action: "update",
          summary: expectedSummary,
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: checkName,
          kind: "state_delta",
          summary: checkSummary,
        },
      ],
    }),
    examples: [example],
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "routing.send.update",
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

function evenChannelCounts() {
  return Array.from({ length: 64 }, (_, index) => 2 + index * 2);
}

function midiSourceChannels() {
  return ["all", "disabled", ...numberStrings(16)];
}

function midiDestinationChannels() {
  return ["original", ...numberStrings(16)];
}

function numberStrings(count) {
  return Array.from({ length: count }, (_, index) => String(index + 1));
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
