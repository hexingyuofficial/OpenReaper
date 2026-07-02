import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_ITEMS_TEMPLATE_IDS = Object.freeze([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.set_item_fades",
  "template.items.split_item_at_time",
  "template.items.set_take_pitch",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
]);

export const WAVE1A_ITEMS_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.items.resolve_item_ref",
    title: "Resolve item ref",
    summary: "Resolve one item reference string into a typed item ref for later item templates.",
    entity_kind: "item",
    tags: ["items", "item", "ref", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.resolve_item_ref",
      capability: "items.resolve_item_ref",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      ref: { type: "string" },
    }, ["ref"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
    }, ["item_ref"]),
    refs: refs({
      output: [ref("item_ref", "item", true, "Resolved item ref.")],
    }),
    expectedDelta: readDelta({
      summary: "Resolves an item reference without mutating item state.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "Item identity is resolved.",
        },
      ],
    }),
    examples: [
      {
        name: "resolve_selected_item",
        summary: "Resolve the first selected item.",
        input: { ref: "selected:0" },
      },
    ],
  }),
  readDescriptor({
    id: "template.items.read_item_summary",
    title: "Read item summary",
    summary: "Read compact timeline, fade, snap, and active-take facts for one resolved item.",
    entity_kind: "item",
    tags: ["items", "item", "read", "summary"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.read_item_summary",
      capability: "items.read_item_summary",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_take_summary: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      snap_offset_seconds: { type: "number" },
      fade_in_seconds: { type: "number" },
      fade_out_seconds: { type: "number" },
      active_take_name: { type: "string" },
      take_count: { type: "integer" },
    }, ["item_ref", "position_seconds", "length_seconds"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref whose compact summary is read.")],
      output: [ref("item_ref", "item", true, "Item ref returned with the summary.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads compact item and active-take facts without mutation.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "Item timeline and edit fields are read.",
        },
        {
          entity_kind: "take",
          action: "read",
          summary: "Active-take summary is read when available.",
        },
      ],
    }),
    examples: [
      {
        name: "read_resolved_item",
        summary: "Read one resolved item's compact summary.",
        input: { include_take_summary: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.move_item",
    title: "Move item",
    summary: "Move one item to an absolute project-time start position without changing its track.",
    entity_kind: "item",
    tags: ["items", "item", "move", "position"],
    bridge: bridge({ capability: "items.move_item" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
    }, ["position_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      position_seconds: { type: "number" },
    }, ["item_ref", "position_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates one item's absolute timeline position.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item start position is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_position_matches",
      kind: "state_delta",
      summary: "Item position readback matches the requested project time.",
    }),
    examples: [
      {
        name: "move_item_to_second_two",
        summary: "Move a resolved item to 2 seconds.",
        input: { position_seconds: 2 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.trim_item",
    title: "Trim item",
    summary: "Set one item's visible length and optionally set active-take source start offset.",
    entity_kind: "item",
    tags: ["items", "item", "trim", "take"],
    bridge: bridge({ capability: "items.trim_item" }),
    inputSchema: objectSchema({
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
    }, ["length_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
    }, ["item_ref", "length_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates item length and optional active-take source offset.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item visible length is updated.",
        },
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take source offset is updated when supplied.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_trim_matches",
      kind: "state_delta",
      summary: "Item length and supplied source offset read back as requested.",
    }),
    examples: [
      {
        name: "trim_item_length",
        summary: "Trim a resolved item to 1.25 seconds.",
        input: { length_seconds: 1.25 },
      },
      {
        name: "trim_item_with_offset",
        summary: "Trim and start playback 0.1 seconds into the active take source.",
        input: { length_seconds: 1.25, start_offset_seconds: 0.1 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_fades",
    title: "Set item fades",
    summary: "Set or clear one item's fade-in and fade-out lengths without changing fade shapes.",
    entity_kind: "item",
    tags: ["items", "item", "fade"],
    bridge: bridge({ capability: "items.set_item_fades" }),
    inputSchema: objectSchema({
      fade_in_seconds: nullableNumberSchema(),
      fade_out_seconds: nullableNumberSchema(),
    }, ["fade_in_seconds", "fade_out_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      fade_in_seconds: { type: "number" },
      fade_out_seconds: { type: "number" },
    }, ["item_ref"]),
    expectedDelta: mutationDelta({
      summary: "Updates item fade-in and fade-out lengths.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item fade lengths are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_fades_match",
      kind: "state_delta",
      summary: "Item fade length readback matches the requested values.",
    }),
    examples: [
      {
        name: "set_short_item_fades",
        summary: "Set short fade-in and fade-out lengths.",
        input: { fade_in_seconds: 0.02, fade_out_seconds: 0.08 },
      },
      {
        name: "clear_item_fades",
        summary: "Clear both fades by passing null values.",
        input: { fade_in_seconds: null, fade_out_seconds: null },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.split_item_at_time",
    title: "Split item at time",
    summary: "Split one item at an explicit project-time position inside the item's current bounds.",
    entity_kind: "item",
    tags: ["items", "item", "split"],
    bridge: bridge({ capability: "items.split_item_at_time" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
    }, ["position_seconds"]),
    outputSchema: objectSchema({
      left_item_ref: { type: "string" },
      right_item_ref: { type: "string" },
      split_position_seconds: { type: "number" },
    }, ["left_item_ref", "right_item_ref", "split_position_seconds"]),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref to split.")],
      output: [
        ref("left_item_ref", "item", true, "Item ref for the left split item."),
        ref("right_item_ref", "item", true, "Item ref for the right split item."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Splits one item into left and right item refs at an explicit time.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Original item becomes the left split item.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "Right split item is created.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "split_items_exist",
      kind: "state_delta",
      summary: "Left and right item refs exist at the requested split boundary.",
    }),
    examples: [
      {
        name: "split_item_at_two_seconds",
        summary: "Split a resolved item at 2 seconds.",
        input: { position_seconds: 2 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_pitch",
    title: "Set take pitch",
    summary: "Set the active take pitch in semitones without editing MIDI note events.",
    entity_kind: "take",
    tags: ["items", "take", "pitch"],
    bridge: bridge({ capability: "items.set_take_pitch" }),
    inputSchema: objectSchema({
      semitones: { type: "number" },
    }, ["semitones"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      semitones: { type: "number" },
    }, ["item_ref", "semitones"]),
    expectedDelta: mutationDelta({
      summary: "Updates active-take pitch playback property.",
      entities: [
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take pitch is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_pitch_matches",
      kind: "state_delta",
      summary: "Active-take pitch readback matches the requested semitone value.",
    }),
    examples: [
      {
        name: "pitch_take_down_octave",
        summary: "Pitch the active take down one octave.",
        input: { semitones: -12 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_take_playrate",
    title: "Set take playrate",
    summary: "Set active-take playback rate with explicit preserve-pitch behavior.",
    entity_kind: "take",
    tags: ["items", "take", "playrate"],
    bridge: bridge({ capability: "items.set_take_playrate" }),
    inputSchema: objectSchema({
      playrate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["playrate", "preserve_pitch"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      playrate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["item_ref", "playrate", "preserve_pitch"]),
    expectedDelta: mutationDelta({
      summary: "Updates active-take playback rate and preserve-pitch flag.",
      entities: [
        {
          entity_kind: "take",
          action: "update",
          summary: "Active-take playrate is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_playrate_matches",
      kind: "state_delta",
      summary: "Active-take playrate and preserve-pitch flag read back as requested.",
    }),
    examples: [
      {
        name: "slow_take_with_pitch_following",
        summary: "Set the active take to half speed with pitch following rate.",
        input: { playrate: 0.5, preserve_pitch: false },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.set_item_snap_offset",
    title: "Set item snap offset",
    summary: "Set one item's item-local snap offset in seconds without changing project grid settings.",
    entity_kind: "item",
    tags: ["items", "item", "snap"],
    bridge: bridge({ capability: "items.set_item_snap_offset" }),
    inputSchema: objectSchema({
      snap_offset_seconds: { type: "number" },
    }, ["snap_offset_seconds"]),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
      snap_offset_seconds: { type: "number" },
    }, ["item_ref", "snap_offset_seconds"]),
    expectedDelta: mutationDelta({
      summary: "Updates one item's local snap offset field.",
      entities: [
        {
          entity_kind: "item",
          action: "update",
          summary: "Item snap offset is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "item_snap_offset_matches",
      kind: "state_delta",
      summary: "Item snap offset readback matches the requested value.",
    }),
    examples: [
      {
        name: "set_item_attack_snap_offset",
        summary: "Set snap offset 50 ms after item start.",
        input: { snap_offset_seconds: 0.05 },
      },
    ],
  }),
]);

export function createWave1AItemsTemplates() {
  return cloneJson(WAVE1A_ITEMS_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "items.read_item_summary",
      capability: "items.read_item_summary",
      idempotency: "none",
    }),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    ...overrides,
  });
}

function commandDescriptor(overrides = {}) {
  return descriptor({
    risk: "write",
    bridge: bridge(),
    refs: refs({
      input: [ref("item_ref", "item", true, "Item ref to mutate.")],
      output: [ref("item_ref", "item", true, "Mutated item ref.")],
    }),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "item_state_matches",
      kind: "state_delta",
      summary: "Item state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.items.read_item_summary",
    title: "Item template",
    summary: "Run one bounded item template.",
    pack: "items",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "item",
    tags: ["items"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      item_ref: { type: "string" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "item_template",
        summary: "Run a bounded item template.",
        input: {},
      },
    ],
    ...overrides,
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "items.move_item",
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

function nullableNumberSchema() {
  return {
    oneOf: [
      { type: "number" },
      { type: "null" },
    ],
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

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads compact item state.",
    entities: [
      {
        entity_kind: "item",
        action: "read",
        summary: "Item state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded item state surface.",
    entities: [
      {
        entity_kind: "item",
        action: "update",
        summary: "Item state is updated.",
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
