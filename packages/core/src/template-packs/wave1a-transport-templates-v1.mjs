import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_TRANSPORT_TEMPLATE_IDS = Object.freeze([
  "template.transport.read_state",
  "template.transport.play",
  "template.transport.pause",
  "template.transport.stop_playback",
  "template.transport.set_edit_cursor",
  "template.transport.set_time_selection",
  "template.transport.clear_time_selection",
  "template.transport.set_loop_points",
  "template.transport.clear_loop_points",
  "template.transport.set_repeat",
  "template.transport.set_playback_rate",
  "template.transport.start_recording",
  "template.transport.stop_recording",
  "template.transport.set_record_mode",
  "template.transport.set_punch_record_range",
  "template.transport.schedule_recording",
]);

export const WAVE1A_TRANSPORT_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.transport.read_state",
    title: "Read transport state",
    summary: "Read playback state, cursors, repeat state, time selection, and loop points.",
    entity_kind: "transport",
    tags: ["transport", "read", "state"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "transport.read_state",
      capability: "transport.read_state",
      idempotency: "none",
    }),
    outputSchema: objectSchema({
      play_state: { type: "string" },
      edit_cursor_seconds: { type: "number" },
      play_cursor_seconds: { type: "number" },
      repeat_enabled: { type: "boolean" },
      time_selection: { type: "object" },
      loop_points: { type: "object" },
    }),
    expectedDelta: readDelta({
      summary: "Reads compact transport state without mutating project data.",
      entities: [
        {
          entity_kind: "transport",
          action: "read",
          summary: "Playback and range state is read.",
        },
      ],
    }),
    examples: [
      {
        name: "read_transport_state",
        summary: "Read current playback and selection state.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.play",
    title: "Play",
    summary: "Start or resume playback when the transport is not recording.",
    entity_kind: "transport",
    tags: ["transport", "play", "record_guard"],
    bridge: bridge({ capability: "transport.play" }),
    outputSchema: objectSchema({
      play_state: { enum: ["playing"] },
    }, ["play_state"]),
    expectedDelta: mutationDelta({
      summary: "Transport enters playback unless recording is active.",
      entities: [
        {
          entity_kind: "transport",
          action: "update",
          summary: "Playback state is set to playing.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "transport_playing",
      kind: "state_delta",
      summary: "Transport reports playing and not recording.",
    }),
    examples: [
      {
        name: "play_from_cursor",
        summary: "Start playback from the current cursor.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.pause",
    title: "Pause playback",
    summary: "Pause playback at the current position when the transport is not recording.",
    entity_kind: "transport",
    tags: ["transport", "pause", "record_guard"],
    bridge: bridge({ capability: "transport.pause" }),
    outputSchema: objectSchema({
      play_state: { enum: ["paused"] },
    }, ["play_state"]),
    expectedDelta: mutationDelta({
      summary: "Transport enters paused playback unless recording is active.",
      entities: [
        {
          entity_kind: "transport",
          action: "update",
          summary: "Playback state is set to paused.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "transport_paused",
      kind: "state_delta",
      summary: "Transport reports paused and not recording.",
    }),
    examples: [
      {
        name: "pause_playback",
        summary: "Pause current playback.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.stop_playback",
    title: "Stop playback",
    summary: "Stop playback without acting as a recording stop/finalize command.",
    entity_kind: "transport",
    tags: ["transport", "stop", "record_guard"],
    bridge: bridge({ capability: "transport.stop_playback" }),
    outputSchema: objectSchema({
      play_state: { enum: ["stopped"] },
    }, ["play_state"]),
    expectedDelta: mutationDelta({
      summary: "Transport enters stopped playback unless recording is active.",
      entities: [
        {
          entity_kind: "transport",
          action: "update",
          summary: "Playback state is set to stopped.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "transport_stopped",
      kind: "state_delta",
      summary: "Transport reports stopped and not recording.",
    }),
    examples: [
      {
        name: "stop_playback",
        summary: "Stop ordinary playback.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_edit_cursor",
    title: "Set edit cursor",
    summary: "Set the edit cursor to an absolute project time with explicit view and seek options.",
    entity_kind: "cursor",
    tags: ["transport", "cursor", "seek"],
    bridge: bridge({ capability: "transport.set_edit_cursor" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      move_view: { type: "boolean" },
      seek_playback: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      edit_cursor_seconds: { type: "number" },
      seek_playback: { type: "boolean" },
    }, ["edit_cursor_seconds", "seek_playback"]),
    expectedDelta: mutationDelta({
      summary: "Edit cursor moves to the requested project time.",
      entities: [
        {
          entity_kind: "cursor",
          action: "update",
          summary: "Edit cursor position is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "cursor_position_matches",
      kind: "state_delta",
      summary: "Edit cursor readback matches the requested time.",
    }),
    examples: [
      {
        name: "set_cursor_to_bar",
        summary: "Move the edit cursor to 12.5 seconds.",
        input: {
          position_seconds: 12.5,
          move_view: false,
          seek_playback: false,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_time_selection",
    title: "Set time selection",
    summary: "Set the time selection start and end in project seconds without editing items.",
    entity_kind: "time_selection",
    tags: ["transport", "time_selection", "range"],
    bridge: bridge({ capability: "transport.set_time_selection" }),
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }),
    outputSchema: rangeOutputSchema("time_selection"),
    expectedDelta: mutationDelta({
      summary: "Time selection is set to the requested range.",
      entities: [
        {
          entity_kind: "time_selection",
          action: "update",
          summary: "Time selection bounds are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "time_selection_matches",
      kind: "state_delta",
      summary: "Time selection readback matches the requested range.",
    }),
    examples: [
      {
        name: "set_chorus_selection",
        summary: "Set a selection from 32 to 48 seconds.",
        input: {
          start_seconds: 32,
          end_seconds: 48,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.clear_time_selection",
    title: "Clear time selection",
    summary: "Clear the time selection without changing loop points or item selection.",
    entity_kind: "time_selection",
    tags: ["transport", "time_selection", "clear"],
    bridge: bridge({ capability: "transport.clear_time_selection" }),
    outputSchema: objectSchema({
      time_selection_cleared: { type: "boolean" },
    }, ["time_selection_cleared"]),
    expectedDelta: mutationDelta({
      summary: "Time selection is cleared.",
      entities: [
        {
          entity_kind: "time_selection",
          action: "update",
          summary: "Time selection bounds are cleared.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "time_selection_cleared",
      kind: "state_delta",
      summary: "Time selection readback is empty.",
    }),
    examples: [
      {
        name: "clear_time_selection",
        summary: "Clear the active time selection.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_loop_points",
    title: "Set loop points",
    summary: "Set transport loop points in project seconds without editing item loop sources.",
    entity_kind: "loop_state",
    tags: ["transport", "loop_points", "range"],
    bridge: bridge({ capability: "transport.set_loop_points" }),
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }),
    outputSchema: rangeOutputSchema("loop_points"),
    expectedDelta: mutationDelta({
      summary: "Transport loop points are set to the requested range.",
      entities: [
        {
          entity_kind: "loop_state",
          action: "update",
          summary: "Loop point bounds are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "loop_points_match",
      kind: "state_delta",
      summary: "Loop point readback matches the requested range.",
    }),
    examples: [
      {
        name: "set_chorus_loop_points",
        summary: "Set loop points from 32 to 48 seconds.",
        input: {
          start_seconds: 32,
          end_seconds: 48,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.clear_loop_points",
    title: "Clear loop points",
    summary: "Clear transport loop points without changing the time selection.",
    entity_kind: "loop_state",
    tags: ["transport", "loop_points", "clear"],
    bridge: bridge({ capability: "transport.clear_loop_points" }),
    outputSchema: objectSchema({
      loop_points_cleared: { type: "boolean" },
    }, ["loop_points_cleared"]),
    expectedDelta: mutationDelta({
      summary: "Transport loop points are cleared.",
      entities: [
        {
          entity_kind: "loop_state",
          action: "update",
          summary: "Loop point bounds are cleared.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "loop_points_cleared",
      kind: "state_delta",
      summary: "Loop point readback is empty.",
    }),
    examples: [
      {
        name: "clear_loop_points",
        summary: "Clear active loop points.",
        input: {},
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_repeat",
    title: "Set repeat",
    summary: "Set repeat playback to an explicit enabled/disabled state without toggling.",
    entity_kind: "loop_state",
    tags: ["transport", "repeat", "loop_points"],
    bridge: bridge({ capability: "transport.set_repeat" }),
    inputSchema: objectSchema({
      enabled: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      repeat_enabled: { type: "boolean" },
    }, ["repeat_enabled"]),
    expectedDelta: mutationDelta({
      summary: "Repeat playback state is set to the requested boolean.",
      entities: [
        {
          entity_kind: "loop_state",
          action: "update",
          summary: "Repeat playback state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "repeat_state_matches",
      kind: "state_delta",
      summary: "Repeat state readback matches the requested boolean.",
    }),
    examples: [
      {
        name: "enable_repeat",
        summary: "Enable repeat playback.",
        input: {
          enabled: true,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_playback_rate",
    title: "Set playback rate",
    summary: "Set the project transport playback rate to an explicit multiplier.",
    entity_kind: "playback_rate",
    tags: ["transport", "playback_rate", "rate"],
    bridge: bridge({ capability: "transport.set_playback_rate" }),
    inputSchema: objectSchema({
      playback_rate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      playback_rate: { type: "number" },
      preserve_pitch: { type: "boolean" },
    }, ["playback_rate", "preserve_pitch"]),
    expectedDelta: mutationDelta({
      summary: "Transport playback rate is set to the requested multiplier.",
      entities: [
        {
          entity_kind: "playback_rate",
          action: "update",
          summary: "Playback rate state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "playback_rate_matches",
      kind: "state_delta",
      summary: "Playback rate readback matches the requested multiplier.",
    }),
    examples: [
      {
        name: "set_half_speed_playback",
        summary: "Set playback rate to half speed while preserving pitch.",
        input: {
          playback_rate: 0.5,
          preserve_pitch: true,
        },
      },
    ],
  }),
  recordingDescriptor({
    id: "template.transport.start_recording",
    title: "Start recording",
    summary: "Start recording through the current armed tracks and recording mode.",
    entity_kind: "recording",
    tags: ["transport", "recording", "start"],
    bridge: bridge({ capability: "transport.start_recording" }),
    inputSchema: objectSchema({
      require_armed_track: { type: "boolean" },
      respect_punch_range: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      record_state: { enum: ["recording"] },
    }, ["record_state"]),
    expectedDelta: recordingDelta({
      summary: "Transport enters recording and may create recorded media on armed tracks.",
      entities: [
        {
          entity_kind: "recording",
          action: "create",
          summary: "Recording is started for currently armed tracks.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "recording_started",
      kind: "state_delta",
      summary: "Transport reports recording after the command.",
    }),
    examples: [
      {
        name: "start_recording_with_guard",
        summary: "Start recording only when at least one track is armed.",
        input: {
          require_armed_track: true,
          respect_punch_range: true,
        },
      },
    ],
  }),
  recordingDescriptor({
    id: "template.transport.stop_recording",
    title: "Stop recording",
    summary: "Stop active recording with an explicit recorded-media handling policy.",
    entity_kind: "recording",
    tags: ["transport", "recording", "stop"],
    bridge: bridge({ capability: "transport.stop_recording" }),
    inputSchema: objectSchema({
      recorded_media_policy: { enum: ["keep", "discard_prompt_required"] },
    }),
    outputSchema: objectSchema({
      record_state: { enum: ["stopped"] },
      recorded_media_policy: { enum: ["keep", "discard_prompt_required"] },
    }, ["record_state", "recorded_media_policy"]),
    expectedDelta: recordingDelta({
      summary: "Active recording is stopped and recorded media is handled by the explicit policy.",
      entities: [
        {
          entity_kind: "recording",
          action: "update",
          summary: "Recording state is finalized.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "recording_stopped",
      kind: "state_delta",
      summary: "Transport reports stopped or non-recording after the command.",
    }),
    examples: [
      {
        name: "stop_and_keep_media",
        summary: "Stop recording and keep recorded media.",
        input: {
          recorded_media_policy: "keep",
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_record_mode",
    title: "Set record mode",
    summary: "Set the transport recording mode explicitly before recording starts.",
    entity_kind: "record_mode",
    tags: ["transport", "recording", "mode"],
    bridge: bridge({ capability: "transport.set_record_mode" }),
    inputSchema: objectSchema({
      mode: { enum: ["normal", "time_selection_auto_punch", "selected_items_auto_punch"] },
    }),
    outputSchema: objectSchema({
      mode: { enum: ["normal", "time_selection_auto_punch", "selected_items_auto_punch"] },
    }, ["mode"]),
    expectedDelta: mutationDelta({
      summary: "Recording mode is set to the requested posture.",
      entities: [
        {
          entity_kind: "record_mode",
          action: "update",
          summary: "Record mode state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "record_mode_matches",
      kind: "state_delta",
      summary: "Record mode readback matches the requested mode.",
    }),
    examples: [
      {
        name: "set_time_selection_punch",
        summary: "Use time selection auto-punch recording mode.",
        input: {
          mode: "time_selection_auto_punch",
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.transport.set_punch_record_range",
    title: "Set punch record range",
    summary: "Set the time range used by punch-style recording without starting transport.",
    entity_kind: "recording.punch_range",
    tags: ["transport", "recording", "punch", "range"],
    bridge: bridge({ capability: "transport.set_punch_record_range" }),
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
    }),
    outputSchema: rangeOutputSchema("punch_range"),
    expectedDelta: mutationDelta({
      summary: "Punch recording range is set to the requested bounds.",
      entities: [
        {
          entity_kind: "recording.punch_range",
          action: "update",
          summary: "Punch range bounds are updated.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "punch_range_matches",
      kind: "state_delta",
      summary: "Punch range readback matches the requested bounds.",
    }),
    examples: [
      {
        name: "set_punch_range",
        summary: "Set punch recording from 12 to 20 seconds.",
        input: {
          start_seconds: 12,
          end_seconds: 20,
        },
      },
    ],
  }),
  recordingDescriptor({
    id: "template.transport.schedule_recording",
    title: "Schedule recording",
    summary: "Prepare a bounded timed recording window without adding a public scheduler.",
    entity_kind: "recording.schedule",
    tags: ["transport", "recording", "schedule"],
    bridge: bridge({ capability: "transport.schedule_recording" }),
    inputSchema: objectSchema({
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      mode: { enum: ["normal", "time_selection_auto_punch", "selected_items_auto_punch"] },
      require_armed_track: { type: "boolean" },
    }),
    outputSchema: objectSchema({
      scheduled_recording: { type: "object" },
    }, ["scheduled_recording"]),
    expectedDelta: recordingDelta({
      summary: "A bounded recording schedule is prepared for an explicit project time range.",
      entities: [
        {
          entity_kind: "recording.schedule",
          action: "create",
          summary: "Timed recording schedule is prepared.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "recording_schedule_matches",
      kind: "state_delta",
      summary: "Scheduled recording readback matches the requested range and mode.",
    }),
    examples: [
      {
        name: "schedule_time_selection_recording",
        summary: "Schedule a guarded punch recording window.",
        input: {
          start_seconds: 12,
          end_seconds: 20,
          mode: "time_selection_auto_punch",
          require_armed_track: true,
        },
      },
    ],
  }),
]);

export function createWave1ATransportTemplates() {
  return cloneJson(WAVE1A_TRANSPORT_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "transport.read_state",
      capability: "transport.read_state",
      idempotency: "none",
    }),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    ...overrides,
  });
}

function commandDescriptor(overrides = {}) {
  return descriptor({
    risk: "safe",
    bridge: bridge(),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "transport_state_updated",
      kind: "state_delta",
      summary: "Transport state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function recordingDescriptor(overrides = {}) {
  return descriptor({
    risk: "write",
    bridge: bridge(),
    expectedDelta: recordingDelta(),
    verification: requiredVerification({
      name: "recording_state_updated",
      kind: "state_delta",
      summary: "Recording state readback matches the requested posture.",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.transport.play",
    title: "Transport command",
    summary: "Run one bounded transport command.",
    pack: "transport",
    lifecycle: "experimental",
    risk: "safe",
    entity_kind: "transport",
    tags: ["transport"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      transport_state: { type: "string" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: mutationDelta(),
    verification: requiredVerification({
      name: "transport_state_updated",
      kind: "state_delta",
      summary: "Transport state readback matches the requested mutation.",
    }),
    examples: [
      {
        name: "transport_command",
        summary: "Run a bounded transport command.",
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
    capability: "transport.play",
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

function rangeOutputSchema(name) {
  return objectSchema({
    [name]: { type: "object" },
  }, [name]);
}

function refs(overrides = {}) {
  return {
    input: [],
    output: [],
    ...overrides,
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
    summary: "Reads compact transport state.",
    entities: [
      {
        entity_kind: "transport",
        action: "read",
        summary: "Transport state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded transport state surface.",
    entities: [
      {
        entity_kind: "transport",
        action: "update",
        summary: "Transport state is updated.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function recordingDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded recording state surface.",
    entities: [
      {
        entity_kind: "recording",
        action: "update",
        summary: "Recording posture is updated.",
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
