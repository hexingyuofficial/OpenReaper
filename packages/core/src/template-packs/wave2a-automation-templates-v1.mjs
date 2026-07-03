import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_AUTOMATION_TEMPLATE_IDS = Object.freeze([
  "template.automation.resolve_envelope_ref",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.evaluate_envelope_at_time",
  "template.automation.set_envelope_lane_state",
  "template.automation.insert_envelope_point",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.set_envelope_point",
  "template.automation.insert_envelope_points_batch",
  "template.automation.set_send_automation_mode",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
  "template.automation.resolve_send_envelope",
]);

export const WAVE2A_AUTOMATION_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.automation.resolve_envelope_ref",
    title: "Resolve envelope ref",
    summary: "Resolve one envelope identity from an envelope ref or a narrow parent/name selector.",
    entity_kind: "envelope",
    tags: ["automation", "envelope", "ref", "wave2a"],
    capability: "automation.resolve_envelope_ref",
    inputSchema: objectSchema({
      envelope_ref: { type: "string" },
      parent_kind: { enum: ["track", "take", "selected"] },
      envelope_name: { type: "string" },
      chunk_name: { type: "string" },
      envelope_guid: { type: "string" },
    }, []),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      parent_kind: { enum: ["track", "take", "send", "unknown"] },
      name: { type: "string" },
      point_count: { type: "integer" },
      automation_item_count: { type: "integer" },
    }, ["envelope_ref"]),
    refs: refs({
      input: [
        ref("track_ref", "track", false, "Optional parent track ref used by a parent/name selector."),
        ref("take_ref", "take", false, "Optional parent take ref used by a parent/name selector."),
      ],
      output: [ref("envelope_ref", "envelope", true, "Resolved automation envelope ref.")],
    }),
    expectedDelta: readDelta({
      summary: "Resolves one envelope identity without mutating automation data.",
      entities: [entity("envelope", "read", "Envelope identity is resolved.")],
    }),
    examples: [
      {
        name: "resolve_track_volume_envelope",
        summary: "Resolve a track volume envelope by parent track and envelope name.",
        input: { parent_kind: "track", envelope_name: "Volume" },
      },
      {
        name: "resolve_envelope_guid",
        summary: "Resolve an envelope by GUID-like selector.",
        input: { envelope_guid: "{ENVELOPE-GUID}" },
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.read_envelope_summary",
    title: "Read envelope summary",
    summary: "Read compact envelope state, counts, scaling, lane, and parent facts.",
    entity_kind: "envelope",
    tags: ["automation", "envelope", "read", "wave2a"],
    capability: "automation.read_envelope_summary",
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      name: { type: "string" },
      parent_kind: { enum: ["track", "take", "send", "unknown"] },
      scaling_mode: { type: "integer" },
      active: { type: "boolean" },
      armed: { type: "boolean" },
      visible: { type: "boolean" },
      show_lane: { type: "boolean" },
      point_count: { type: "integer" },
      automation_item_count: { type: "integer" },
    }, ["envelope_ref"]),
    refs: envelopeRefs(),
    expectedDelta: readDelta({
      summary: "Reads compact envelope metadata without returning dense lanes.",
      entities: [entity("envelope", "read", "Envelope summary is read.")],
    }),
    examples: [
      {
        name: "read_resolved_envelope_summary",
        summary: "Read state for a resolved envelope.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.read_envelope_points",
    title: "Read envelope points",
    summary: "Read a bounded page of envelope point summaries for one envelope or automation item.",
    entity_kind: "automation_point",
    tags: ["automation", "point", "read", "wave2a"],
    capability: "automation.read_envelope_points",
    inputSchema: objectSchema({
      autoitem_index: { type: "integer" },
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      limit: { type: "integer" },
      cursor: { type: "string" },
    }, []),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      points: { type: "array" },
      returned_count: { type: "integer" },
      total_count: { type: "integer" },
      next_cursor: nullableStringSchema(),
      truncated: { type: "boolean" },
    }, ["envelope_ref", "points", "returned_count", "truncated"]),
    refs: envelopeRefs(),
    expectedDelta: readDelta({
      summary: "Reads bounded envelope point rows without mutating point data.",
      entities: [entity("automation_point", "read", "Automation point summaries are read.")],
    }),
    examples: [
      {
        name: "read_first_points",
        summary: "Read the first bounded page of points.",
        input: { limit: 25 },
      },
      {
        name: "read_points_in_range",
        summary: "Read points inside a time range.",
        input: { start_seconds: 0, end_seconds: 4, limit: 50 },
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.evaluate_envelope_at_time",
    title: "Evaluate envelope at time",
    summary: "Evaluate one envelope's effective value at an explicit project time.",
    entity_kind: "envelope",
    tags: ["automation", "envelope", "evaluate", "wave2a"],
    capability: "automation.evaluate_envelope_at_time",
    inputSchema: objectSchema({
      time_seconds: { type: "number" },
      sample_rate: { type: "number" },
      samples_requested: { type: "integer" },
    }, ["time_seconds"]),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      time_seconds: { type: "number" },
      value: { type: "number" },
      valid_samples: { type: "integer" },
      scaling_mode: { type: "integer" },
    }, ["envelope_ref", "time_seconds", "value"]),
    refs: envelopeRefs(),
    expectedDelta: readDelta({
      summary: "Samples one effective envelope value without mutating state.",
      entities: [entity("envelope", "read", "Envelope value is evaluated at one time.")],
    }),
    examples: [
      {
        name: "evaluate_at_one_second",
        summary: "Evaluate the resolved envelope at one second.",
        input: { time_seconds: 1 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.set_envelope_lane_state",
    title: "Set envelope lane state",
    summary: "Set envelope active, armed, visible, or separate-lane state without editing points.",
    entity_kind: "envelope",
    tags: ["automation", "envelope", "lane", "wave2a"],
    capability: "automation.set_envelope_lane_state",
    inputSchema: objectSchema({
      active: { type: "boolean" },
      armed: { type: "boolean" },
      visible: { type: "boolean" },
      show_lane: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      active: { type: "boolean" },
      armed: { type: "boolean" },
      visible: { type: "boolean" },
      show_lane: { type: "boolean" },
    }, ["envelope_ref"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Updates envelope lane and arm/display state only.",
      entities: [entity("envelope", "update", "Envelope lane state is updated.")],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "envelope_lane_state_matches",
      kind: "state_delta",
      summary: "Envelope lane, visibility, and armed state read back as requested.",
    }),
    examples: [
      {
        name: "show_and_arm_envelope_lane",
        summary: "Show an envelope in its own lane and arm it.",
        input: { visible: true, show_lane: true, armed: true },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.insert_envelope_point",
    title: "Insert envelope point",
    summary: "Insert one raw-value envelope point at an explicit time on an envelope or automation item.",
    entity_kind: "automation_point",
    tags: ["automation", "point", "insert", "wave2a"],
    capability: "automation.insert_envelope_point",
    inputSchema: pointInputSchema(["time_seconds", "value", "shape", "tension", "selected"]),
    outputSchema: pointOutputSchema(["envelope_ref", "point_index", "time_seconds", "value"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates one automation point on the resolved envelope.",
      entities: [entity("automation_point", "create", "One automation point is inserted.")],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "inserted_point_matches",
      kind: "state_delta",
      summary: "Point count and sampled point fields match the inserted point.",
    }),
    examples: [
      {
        name: "insert_volume_point",
        summary: "Insert one raw-value point at one second.",
        input: { time_seconds: 1, value: 0.75, shape: 0, tension: 0, selected: false },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.set_track_automation_mode",
    title: "Set track automation mode",
    summary: "Set one track automation mode without changing transport, record arm, or envelope points.",
    entity_kind: "automation_mode",
    tags: ["automation", "mode", "track", "wave2a"],
    capability: "automation.set_track_automation_mode",
    inputSchema: objectSchema({ mode: automationModeSchema() }, ["mode"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      mode: automationModeSchema(),
    }, ["track_ref", "mode"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose automation mode is set.")],
      output: [ref("track_ref", "track", true, "Same track ref after mode update.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates one track automation mode only.",
      entities: [entity("automation_mode", "update", "Track automation mode is updated.")],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "track_automation_mode_matches",
      kind: "state_delta",
      summary: "Track automation mode readback matches the requested mode.",
    }),
    examples: [
      {
        name: "set_track_read_mode",
        summary: "Set the resolved track to read automation mode.",
        input: { mode: "read" },
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.read_track_automation_mode",
    title: "Read track automation mode",
    summary: "Read one track's current automation mode as a bounded enum.",
    entity_kind: "automation_mode",
    tags: ["automation", "mode", "track", "read", "wave2a"],
    capability: "automation.read_track_automation_mode",
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      mode: automationModeSchema(),
    }, ["track_ref", "mode"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose automation mode is read.")],
      output: [ref("track_ref", "track", true, "Same track ref returned with the mode summary.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads one track automation mode without mutating track or envelope state.",
      entities: [entity("automation_mode", "read", "Track automation mode is read.")],
    }),
    examples: [
      {
        name: "read_track_mode",
        summary: "Read current automation mode for one track.",
        input: {},
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.read_automation_items",
    title: "Read automation items",
    summary: "Read a bounded list of automation item summaries from one envelope.",
    entity_kind: "automation_item",
    tags: ["automation", "automation_item", "read", "wave2a"],
    capability: "automation.read_automation_items",
    inputSchema: objectSchema({
      limit: { type: "integer" },
      cursor: { type: "string" },
    }, []),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      items: { type: "array" },
      returned_count: { type: "integer" },
      total_count: { type: "integer" },
      next_cursor: nullableStringSchema(),
      truncated: { type: "boolean" },
    }, ["envelope_ref", "items", "returned_count", "truncated"]),
    refs: envelopeRefs(),
    expectedDelta: readDelta({
      summary: "Reads bounded automation item summaries without editing them.",
      entities: [entity("automation_item", "read", "Automation item summaries are read.")],
    }),
    examples: [
      {
        name: "read_automation_items",
        summary: "Read automation items from the resolved envelope.",
        input: { limit: 25 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.set_envelope_point",
    title: "Set envelope point",
    summary: "Update one existing envelope point by index without deleting or clearing point ranges.",
    entity_kind: "automation_point",
    tags: ["automation", "point", "update", "wave2a"],
    capability: "automation.set_envelope_point",
    inputSchema: pointInputSchema(["point_index"]),
    outputSchema: pointOutputSchema(["envelope_ref", "point_index"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Updates one existing automation point on the resolved envelope.",
      entities: [entity("automation_point", "update", "One automation point is updated.")],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "updated_point_matches",
      kind: "state_delta",
      summary: "The selected point fields read back as requested.",
    }),
    examples: [
      {
        name: "move_point_value",
        summary: "Set point zero to a new raw value.",
        input: { point_index: 0, value: 0.5 },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.insert_envelope_points_batch",
    title: "Insert envelope points batch",
    summary: "Insert a bounded batch of explicit envelope points and verify sampled readback.",
    entity_kind: "automation_point",
    tags: ["automation", "point", "batch", "wave2a"],
    capability: "automation.insert_envelope_points_batch",
    inputSchema: objectSchema({
      autoitem_index: { type: "integer" },
      points: { type: "array" },
    }, ["points"]),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      inserted_count: { type: "integer" },
      first_time_seconds: { type: "number" },
      last_time_seconds: { type: "number" },
    }, ["envelope_ref", "inserted_count"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates a bounded batch of automation points on one envelope.",
      entities: [entity("automation_point", "create", "Automation points are inserted.")],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "inserted_points_sample_match",
      kind: "state_delta",
      summary: "Point count and sampled first/last point fields match the requested batch.",
    }),
    examples: [
      {
        name: "insert_two_point_ramp",
        summary: "Insert two explicit points for a simple ramp.",
        input: {
          points: [
            { time_seconds: 0, value: 0.25, shape: 0, tension: 0 },
            { time_seconds: 1, value: 1, shape: 0, tension: 0 },
          ],
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.set_send_automation_mode",
    title: "Set send automation mode",
    summary: "Set automation mode for one existing send without editing routing fields.",
    entity_kind: "automation_mode",
    tags: ["automation", "mode", "send", "wave2a"],
    capability: "automation.set_send_automation_mode",
    inputSchema: objectSchema({ mode: sendAutomationModeSchema() }, ["mode"]),
    outputSchema: objectSchema({
      send_ref: { type: "string" },
      mode: sendAutomationModeSchema(),
    }, ["send_ref", "mode"]),
    refs: refs({
      input: [ref("send_ref", "send", true, "Routing-owned send ref whose automation mode is set.")],
      output: [ref("send_ref", "send", true, "Same send ref after automation mode update.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates automation mode for one existing send only.",
      entities: [entity("automation_mode", "update", "Send automation mode is updated.")],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "send_automation_mode_matches",
      kind: "state_delta",
      summary: "Send automation mode readback matches the requested mode.",
    }),
    examples: [
      {
        name: "set_send_use_track_mode",
        summary: "Set an existing send to inherit track automation mode.",
        input: { mode: "use_track" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.create_automation_item",
    title: "Create automation item",
    summary: "Create one automation item on an existing envelope at explicit bounds.",
    entity_kind: "automation_item",
    tags: ["automation", "automation_item", "create", "wave2a"],
    capability: "automation.create_automation_item",
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      pool_mode: { enum: ["new_empty", "reuse_pool"] },
      pool_id: { type: "integer" },
    }, ["position_seconds", "length_seconds", "pool_mode"]),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      automation_item_index: { type: "integer" },
      pool_id: { type: "integer" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
    }, ["envelope_ref", "automation_item_index"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Creates one automation item on a resolved envelope.",
      entities: [entity("automation_item", "create", "One automation item is created.")],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "automation_item_created",
      kind: "state_delta",
      summary: "Automation item count and created item fields read back as requested.",
    }),
    examples: [
      {
        name: "create_empty_automation_item",
        summary: "Create one new empty automation item.",
        input: { position_seconds: 2, length_seconds: 1, pool_mode: "new_empty" },
      },
    ],
  }),
  commandDescriptor({
    id: "template.automation.set_automation_item_bounds",
    title: "Set automation item bounds",
    summary: "Set one automation item's position, length, offset, or playrate without editing points.",
    entity_kind: "automation_item",
    tags: ["automation", "automation_item", "bounds", "wave2a"],
    capability: "automation.set_automation_item_bounds",
    inputSchema: objectSchema({
      automation_item_index: { type: "integer" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
      playrate: { type: "number" },
    }, ["automation_item_index"]),
    outputSchema: objectSchema({
      envelope_ref: { type: "string" },
      automation_item_index: { type: "integer" },
      position_seconds: { type: "number" },
      length_seconds: { type: "number" },
      start_offset_seconds: { type: "number" },
      playrate: { type: "number" },
    }, ["envelope_ref", "automation_item_index"]),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta({
      summary: "Updates one automation item's timeline bounds or playback fields.",
      entities: [entity("automation_item", "update", "Automation item bounds are updated.")],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "automation_item_bounds_match",
      kind: "state_delta",
      summary: "Automation item fields read back as requested.",
    }),
    examples: [
      {
        name: "move_automation_item",
        summary: "Move automation item zero to a new position.",
        input: { automation_item_index: 0, position_seconds: 4, length_seconds: 2 },
      },
    ],
  }),
  readDescriptor({
    id: "template.automation.resolve_send_envelope",
    title: "Resolve send envelope",
    summary: "Resolve an existing send envelope from a routing-owned send ref and envelope type.",
    entity_kind: "envelope",
    tags: ["automation", "envelope", "send", "wave2a"],
    capability: "automation.resolve_send_envelope",
    inputSchema: objectSchema({
      envelope_type: { enum: ["volume", "pan", "mute"] },
    }, ["envelope_type"]),
    outputSchema: objectSchema({
      send_ref: { type: "string" },
      envelope_ref: { type: "string" },
      envelope_type: { enum: ["volume", "pan", "mute"] },
      name: { type: "string" },
    }, ["send_ref", "envelope_ref", "envelope_type"]),
    refs: refs({
      input: [ref("send_ref", "send", true, "Routing-owned send ref whose envelope is resolved.")],
      output: [ref("envelope_ref", "envelope", true, "Resolved send envelope ref.")],
    }),
    expectedDelta: readDelta({
      summary: "Resolves a send envelope ref without changing send routing.",
      entities: [entity("envelope", "read", "Existing send envelope identity is resolved.")],
    }),
    examples: [
      {
        name: "resolve_send_volume_envelope",
        summary: "Resolve the volume envelope for an existing send.",
        input: { envelope_type: "volume" },
      },
    ],
  }),
]);

export function createWave2AAutomationTemplates() {
  return cloneJson(WAVE2A_AUTOMATION_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
      operation_name: overrides.capability ?? "automation.read",
      capability: overrides.capability ?? "automation.read",
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
    bridge: bridge({
      capability: overrides.capability ?? "automation.update",
    }),
    refs: envelopeRefs(),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "automation_state_matches",
      kind: "state_delta",
      summary: "Automation state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  const { capability: _capability, ...descriptorOverrides } = overrides;
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.automation.read_envelope_summary",
    title: "Automation template",
    summary: "Run one bounded automation descriptor.",
    pack: "automation",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "envelope",
    tags: ["automation", "wave2a"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "automation_template",
        summary: "Run one bounded automation descriptor.",
        input: {},
      },
    ],
    ...descriptorOverrides,
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "automation.update",
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

function pointInputSchema(required) {
  return objectSchema({
    autoitem_index: { type: "integer" },
    point_index: { type: "integer" },
    time_seconds: { type: "number" },
    value: { type: "number" },
    shape: { type: "integer" },
    tension: { type: "number" },
    selected: { type: "boolean" },
  }, required);
}

function pointOutputSchema(required) {
  return objectSchema({
    envelope_ref: { type: "string" },
    autoitem_index: { type: "integer" },
    point_index: { type: "integer" },
    time_seconds: { type: "number" },
    value: { type: "number" },
    shape: { type: "integer" },
    tension: { type: "number" },
    selected: { type: "boolean" },
  }, required);
}

function automationModeSchema() {
  return {
    enum: ["trim_read", "read", "touch", "write", "latch"],
  };
}

function sendAutomationModeSchema() {
  return {
    enum: ["use_track", "trim_read", "read", "touch", "write", "latch"],
  };
}

function nullableStringSchema() {
  return {
    oneOf: [
      { type: "string" },
      { type: "null" },
    ],
  };
}

function envelopeRefs() {
  return refs({
    input: [ref("envelope_ref", "envelope", true, "Automation envelope ref consumed by this template.")],
    output: [ref("envelope_ref", "envelope", true, "Automation envelope ref returned by this template.")],
  });
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

function artifacts() {
  return {
    mode: "none",
    input: [],
    output: [],
  };
}

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads compact automation state without mutation.",
    entities: [entity("envelope", "read", "Automation state is read.")],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded automation state surface.",
    entities: [entity("envelope", "update", "Automation state is updated.")],
    idempotent: true,
    ...overrides,
  };
}

function entity(entity_kind, action, summary) {
  return {
    entity_kind,
    action,
    summary,
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
