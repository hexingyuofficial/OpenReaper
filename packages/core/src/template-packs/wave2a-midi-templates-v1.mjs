import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_MIDI_TEMPLATE_IDS = Object.freeze([
  "template.midi.resolve_midi_take_ref",
  "template.midi.create_midi_item",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
  "template.midi.insert_notes_batch",
  "template.midi.list_take_cc_events",
  "template.midi.insert_cc_batch",
  "template.midi.list_take_text_sysex_events",
  "template.midi.read_take_grid",
  "template.midi.insert_text_sysex_events",
  "template.midi.set_notes_batch",
  "template.midi.set_cc_events_batch",
]);

export const WAVE2A_MIDI_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.midi.resolve_midi_take_ref",
    title: "Resolve MIDI take ref",
    summary: "Validate one item or take reference as a MIDI event take and return compact identities.",
    entity_kind: "midi_item",
    tags: ["midi", "take", "ref", "read"],
    bridge: readBridge({
      operation_name: "midi.resolve_midi_take_ref",
      capability: "midi.resolve_midi_take_ref",
    }),
    inputSchema: objectSchema({
      ref: { type: "string" },
    }, ["ref"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      item_ref: { type: "string" },
      event_count: { type: "integer" },
      ppq_start: { type: "number" },
      ppq_end: { type: "number" },
    }, ["take_ref"]),
    refs: refs({
      output: [
        ref("take_ref", "take", true, "Resolved MIDI take ref."),
        ref("item_ref", "item", false, "Parent item ref for the MIDI take."),
      ],
    }),
    expectedDelta: readDelta({
      summary: "Resolves MIDI take identity without editing MIDI events or item containers.",
      entities: [
        {
          entity_kind: "midi_item",
          action: "read",
          summary: "MIDI take identity and parent item facts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "resolve_selected_midi_take",
        summary: "Resolve a selected MIDI item or active MIDI take.",
        input: { ref: "selected:0" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.create_midi_item",
    title: "Create MIDI item",
    summary: "Create one empty MIDI item and take event container on an existing track.",
    entity_kind: "midi_item",
    tags: ["midi", "item", "create", "take"],
    bridge: writeBridge({ capability: "midi.create_midi_item" }),
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }, ["start_seconds", "end_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      take_ref: { type: "string" },
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }, ["item_ref", "take_ref"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref that receives the MIDI item.")],
      output: [
        ref("item_ref", "item", true, "Parent item ref for the created MIDI item."),
        ref("take_ref", "take", true, "Created MIDI take ref."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Creates one empty MIDI event container on an existing track.",
      entities: [
        {
          entity_kind: "midi_item",
          action: "create",
          summary: "One empty MIDI item and take container is created.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "midi_item_exists",
      kind: "state_delta",
      summary: "The created item has a MIDI take and the requested time bounds.",
    }),
    examples: [
      {
        name: "create_one_bar_midi_item",
        summary: "Create an empty MIDI item on a resolved track.",
        input: { start_seconds: 0, end_seconds: 2 },
      },
    ],
  }),
  readDescriptor({
    id: "template.midi.read_take_event_counts",
    title: "Read MIDI event counts",
    summary: "Read note, CC, and text or sysex event counts from one MIDI take.",
    entity_kind: "midi_event",
    tags: ["midi", "event", "count", "read"],
    bridge: readBridge({
      operation_name: "midi.read_take_event_counts",
      capability: "midi.read_take_event_counts",
    }),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      note_count: { type: "integer" },
      cc_count: { type: "integer" },
      text_sysex_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "note_count", "cc_count", "text_sysex_count"]),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta({
      summary: "Reads compact MIDI event counts without returning full event arrays.",
      entities: [
        {
          entity_kind: "midi_event",
          action: "read",
          summary: "MIDI event counts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "read_midi_counts",
        summary: "Read event counts for a resolved MIDI take.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.midi.list_take_notes",
    title: "List MIDI notes",
    summary: "Return one bounded page of MIDI note rows from a resolved MIDI take.",
    entity_kind: "midi_note",
    tags: ["midi", "note", "list", "read"],
    bridge: readBridge({
      operation_name: "midi.list_take_notes",
      capability: "midi.list_take_notes",
    }),
    inputSchema: pagedInputSchema({
      include_project_time: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      notes: { type: "array" },
      returned_count: { type: "integer" },
      next_cursor: { type: "string" },
      truncated: { type: "boolean" },
    }, ["take_ref", "returned_count", "truncated"]),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta({
      summary: "Reads a bounded page of MIDI note event rows.",
      entities: [
        {
          entity_kind: "midi_note",
          action: "read",
          summary: "MIDI note rows are read.",
        },
      ],
    }),
    examples: [
      {
        name: "list_first_notes",
        summary: "List the first page of notes in a resolved MIDI take.",
        input: { limit: 16 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.insert_notes_batch",
    title: "Insert MIDI notes batch",
    summary: "Insert a bounded batch of MIDI notes into one resolved MIDI take.",
    entity_kind: "midi_note",
    tags: ["midi", "note", "insert", "batch"],
    bridge: writeBridge({ capability: "midi.insert_notes_batch" }),
    inputSchema: objectSchema({
      notes: { type: "array" },
      position_unit: { enum: ["ppq", "seconds"] },
      sort_events: { type: "boolean" },
    }, ["notes", "position_unit"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      inserted_count: { type: "integer" },
      note_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "inserted_count"]),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates note events inside a resolved MIDI take.",
      entities: [
        {
          entity_kind: "midi_note",
          action: "create",
          summary: "One or more MIDI note events are inserted.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "midi_notes_inserted",
      kind: "state_delta",
      summary: "Note count and bounded sample readback reflect the inserted notes.",
    }),
    examples: [
      {
        name: "insert_two_notes",
        summary: "Insert two PPQ-positioned notes into a resolved MIDI take.",
        input: {
          position_unit: "ppq",
          notes: [
            { start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 },
            { start_ppq: 480, end_ppq: 960, pitch: 64, velocity: 88, channel: 0 },
          ],
        },
      },
    ],
  }),
  readDescriptor({
    id: "template.midi.list_take_cc_events",
    title: "List MIDI CC events",
    summary: "Return one bounded page of MIDI CC-shaped event rows from a resolved MIDI take.",
    entity_kind: "midi_cc",
    tags: ["midi", "cc", "list", "read"],
    bridge: readBridge({
      operation_name: "midi.list_take_cc_events",
      capability: "midi.list_take_cc_events",
    }),
    inputSchema: pagedInputSchema({
      controller: { type: "integer" },
    }),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      cc_events: { type: "array" },
      returned_count: { type: "integer" },
      next_cursor: { type: "string" },
      truncated: { type: "boolean" },
    }, ["take_ref", "returned_count", "truncated"]),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta({
      summary: "Reads a bounded page of MIDI CC-shaped event rows.",
      entities: [
        {
          entity_kind: "midi_cc",
          action: "read",
          summary: "MIDI CC-shaped event rows are read.",
        },
      ],
    }),
    examples: [
      {
        name: "list_mod_wheel_events",
        summary: "List CC events for controller 1.",
        input: { controller: 1, limit: 16 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.insert_cc_batch",
    title: "Insert MIDI CC batch",
    summary: "Insert a bounded batch of MIDI CC-shaped events into one resolved MIDI take.",
    entity_kind: "midi_cc",
    tags: ["midi", "cc", "insert", "batch"],
    bridge: writeBridge({ capability: "midi.insert_cc_batch" }),
    inputSchema: objectSchema({
      events: { type: "array" },
      position_unit: { enum: ["ppq", "seconds"] },
      sort_events: { type: "boolean" },
    }, ["events", "position_unit"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      inserted_count: { type: "integer" },
      cc_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "inserted_count"]),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates CC-shaped events inside a resolved MIDI take.",
      entities: [
        {
          entity_kind: "midi_cc",
          action: "create",
          summary: "One or more MIDI CC-shaped events are inserted.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "midi_cc_events_inserted",
      kind: "state_delta",
      summary: "CC event count and bounded sample readback reflect the inserted events.",
    }),
    examples: [
      {
        name: "insert_mod_wheel_ramp_points",
        summary: "Insert two CC events for controller 1.",
        input: {
          position_unit: "ppq",
          events: [
            { ppq: 0, channel: 0, controller: 1, value: 0 },
            { ppq: 960, channel: 0, controller: 1, value: 127 },
          ],
        },
      },
    ],
  }),
  readDescriptor({
    id: "template.midi.list_take_text_sysex_events",
    title: "List MIDI text and sysex events",
    summary: "Return one bounded page of MIDI text, lyric, notation, and sysex event summaries.",
    entity_kind: "midi_event",
    tags: ["midi", "text", "sysex", "read"],
    bridge: readBridge({
      operation_name: "midi.list_take_text_sysex_events",
      capability: "midi.list_take_text_sysex_events",
    }),
    inputSchema: pagedInputSchema({
      event_kind: { enum: ["text", "lyric", "notation", "sysex", "any"] },
    }),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      events: { type: "array" },
      returned_count: { type: "integer" },
      next_cursor: { type: "string" },
      truncated: { type: "boolean" },
    }, ["take_ref", "returned_count", "truncated"]),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta({
      summary: "Reads bounded text, lyric, notation, and sysex event summaries.",
      entities: [
        {
          entity_kind: "midi_event",
          action: "read",
          summary: "MIDI text and sysex event summaries are read.",
        },
      ],
    }),
    examples: [
      {
        name: "list_midi_text_events",
        summary: "List text-like MIDI events in a resolved take.",
        input: { event_kind: "any", limit: 16 },
      },
    ],
  }),
  readDescriptor({
    id: "template.midi.read_take_grid",
    title: "Read MIDI take grid",
    summary: "Read MIDI take or editor grid facts for MIDI event authoring.",
    entity_kind: "midi_event",
    tags: ["midi", "grid", "read"],
    bridge: readBridge({
      operation_name: "midi.read_take_grid",
      capability: "midi.read_take_grid",
    }),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      grid_ppq: { type: "number" },
      swing: { type: "number" },
      note_length_ppq: { type: "number" },
    }, ["take_ref"]),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta({
      summary: "Reads MIDI grid facts without changing project grid or editor state.",
      entities: [
        {
          entity_kind: "midi_event",
          action: "read",
          summary: "MIDI event grid facts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "read_midi_grid",
        summary: "Read grid facts for a resolved MIDI take.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.insert_text_sysex_events",
    title: "Insert MIDI text and sysex events",
    summary: "Insert bounded text, lyric, notation, or sysex events into one MIDI take.",
    entity_kind: "midi_event",
    tags: ["midi", "text", "sysex", "insert"],
    bridge: writeBridge({ capability: "midi.insert_text_sysex_events" }),
    inputSchema: objectSchema({
      events: { type: "array" },
      position_unit: { enum: ["ppq", "seconds"] },
      sort_events: { type: "boolean" },
    }, ["events", "position_unit"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      inserted_count: { type: "integer" },
      text_sysex_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "inserted_count"]),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates bounded text, lyric, notation, or sysex events in a MIDI take.",
      entities: [
        {
          entity_kind: "midi_event",
          action: "create",
          summary: "One or more MIDI text or sysex events are inserted.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "midi_text_sysex_inserted",
      kind: "state_delta",
      summary: "Text and sysex event count and sample readback reflect the insert.",
    }),
    examples: [
      {
        name: "insert_lyric_event",
        summary: "Insert one lyric text event into a MIDI take.",
        input: {
          position_unit: "ppq",
          events: [{ ppq: 0, event_kind: "lyric", text: "verse" }],
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.set_notes_batch",
    title: "Set MIDI notes batch",
    summary: "Update explicit MIDI note rows in one take using a bounded stale-state guard.",
    entity_kind: "midi_note",
    tags: ["midi", "note", "set", "batch"],
    bridge: writeBridge({ capability: "midi.set_notes_batch" }),
    inputSchema: objectSchema({
      notes: { type: "array" },
      expected_take_hash: { type: "string" },
      sort_events: { type: "boolean" },
    }, ["notes", "expected_take_hash"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      updated_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "updated_count"]),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta({
      summary: "Updates explicit MIDI note rows in a resolved take.",
      entities: [
        {
          entity_kind: "midi_note",
          action: "update",
          summary: "One or more MIDI note events are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "midi_notes_match",
      kind: "state_delta",
      summary: "Guarded note rows read back with the requested bounded values.",
    }),
    examples: [
      {
        name: "set_note_velocity",
        summary: "Update one note row after checking the take hash.",
        input: {
          expected_take_hash: "hash_before_edit",
          notes: [{ index: 0, velocity: 100 }],
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.midi.set_cc_events_batch",
    title: "Set MIDI CC events batch",
    summary: "Update explicit MIDI CC-shaped rows in one take using a bounded stale-state guard.",
    entity_kind: "midi_cc",
    tags: ["midi", "cc", "set", "batch"],
    bridge: writeBridge({ capability: "midi.set_cc_events_batch" }),
    inputSchema: objectSchema({
      events: { type: "array" },
      expected_take_hash: { type: "string" },
      sort_events: { type: "boolean" },
    }, ["events", "expected_take_hash"]),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      updated_count: { type: "integer" },
      take_hash: { type: "string" },
    }, ["take_ref", "updated_count"]),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta({
      summary: "Updates explicit MIDI CC-shaped rows in a resolved take.",
      entities: [
        {
          entity_kind: "midi_cc",
          action: "update",
          summary: "One or more MIDI CC-shaped events are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "midi_cc_events_match",
      kind: "state_delta",
      summary: "Guarded CC-shaped rows read back with the requested bounded values.",
    }),
    examples: [
      {
        name: "set_cc_value",
        summary: "Update one CC row after checking the take hash.",
        input: {
          expected_take_hash: "hash_before_edit",
          events: [{ index: 0, value: 96 }],
        },
      },
    ],
  }),
]);

export function createWave2AMidiTemplates() {
  return cloneJson(WAVE2A_MIDI_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: readBridge(),
    refs: midiTakeReadRefs(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    ...overrides,
  });
}

function commandDescriptor(overrides = {}) {
  return descriptor({
    risk: "write",
    bridge: writeBridge(),
    refs: midiTakeMutationRefs(),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "midi_state_matches",
      kind: "state_delta",
      summary: "MIDI event state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.midi.read_take_event_counts",
    title: "MIDI template",
    summary: "Run one bounded MIDI event-data template.",
    pack: "midi",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "midi_event",
    tags: ["midi"],
    bridge: readBridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "midi_template",
        summary: "Run a bounded MIDI template.",
        input: {},
      },
    ],
    ...overrides,
  };
}

function readBridge(overrides = {}) {
  return {
    operation_family: "query_state",
    operation_name: "midi.read_take_event_counts",
    capability: "midi.read_take_event_counts",
    idempotency: "none",
    timeout_ms: 5_000,
    ...overrides,
  };
}

function writeBridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "midi.insert_notes_batch",
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

function pagedInputSchema(extra = {}) {
  return objectSchema({
    cursor: { type: "string" },
    limit: { type: "integer" },
    ...extra,
  }, []);
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
  };
}

function midiTakeReadRefs() {
  return refs({
    input: [ref("take_ref", "take", true, "MIDI take ref to read.")],
    output: [ref("take_ref", "take", true, "MIDI take ref returned with the result.")],
  });
}

function midiTakeMutationRefs() {
  return refs({
    input: [ref("take_ref", "take", true, "MIDI take ref to mutate.")],
    output: [ref("take_ref", "take", true, "Mutated MIDI take ref.")],
  });
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

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads compact MIDI event state.",
    entities: [
      {
        entity_kind: "midi_event",
        action: "read",
        summary: "MIDI event state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded MIDI event-data surface.",
    entities: [
      {
        entity_kind: "midi_event",
        action: "update",
        summary: "MIDI event state is updated.",
      },
    ],
    idempotent: true,
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

function requiredVerification(check) {
  return verification({
    mode: "required",
    checks: [check],
  });
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
