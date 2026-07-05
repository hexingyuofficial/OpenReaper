import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_TRACKS_TEMPLATE_IDS = Object.freeze({
  resolveTrackRef: "template.tracks.resolve_track_ref",
  listTracks: "template.tracks.list_tracks",
  createTrack: "template.tracks.create_track",
  renameTrack: "template.tracks.rename_track",
  setColor: "template.tracks.set_color",
  selectTrack: "template.tracks.select_track",
  setMute: "template.tracks.set_mute",
  setSolo: "template.tracks.set_solo",
  setRecordArm: "template.tracks.set_record_arm",
});

export const WAVE1A_TRACKS_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.resolveTrackRef,
    title: "Resolve track ref",
    summary: "Resolve one logical track ref to a canonical track ref and compact track summary.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "track",
    tags: ["track", "ref", "read", "wave1a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "track.resolve_ref",
      capability: "track.resolve_ref",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      track_ref: { type: "string" },
    }, ["track_ref"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      index: { type: "integer" },
      name: { type: "string" },
      selected: { type: "boolean" },
      muted: { type: "boolean" },
      solo_mode: { type: "string" },
      record_armed: { type: "boolean" },
      color: { oneOf: [{ type: "string" }, { type: "null" }] },
    }, ["track_ref"]),
    refs: refs({
      output: [ref("track_ref", "track", true, "Canonical track ref produced by the resolver.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads one track identity and compact state without mutating the project.",
      entities: [
        {
          entity_kind: "track",
          action: "read",
          summary: "One track identity and compact state are read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "resolve_guid_track",
        summary: "Resolve a track GUID ref to compact track state.",
        input: { track_ref: "guid:{TRACK-GUID}" },
      },
      {
        name: "resolve_named_track",
        summary: "Resolve a named track; duplicate names must fail as ambiguous.",
        input: { track_ref: "track:Dialog" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.listTracks,
    title: "List tracks",
    summary: "List compact canonical track identities with raw/display names, indexes, display numbers, and selection state.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "track",
    tags: ["track", "list", "snapshot", "read", "wave1a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "tracks.list_tracks",
      capability: "tracks.list_tracks",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
      include_selection: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      tracks: { type: "array" },
      track_count: { type: "integer" },
      selected_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["tracks", "track_count", "selected_count", "truncated"]),
    refs: refs({
      output: [ref("track_ref", "track", false, "Canonical track refs for listed tracks.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads a compact track list without mutating the project.",
      entities: [
        {
          entity_kind: "track",
          action: "read",
          summary: "Track refs, indexes, names, and selection states are read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "list_project_tracks",
        summary: "List compact track refs before choosing a target.",
        input: { limit: 50, include_selection: true },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.createTrack,
    title: "Create track",
    summary: "Create one new track at an optional zero-based index and return its canonical track ref.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "create", "wave1a"],
    bridge: bridge({
      capability: "track.create",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
      index: { type: "integer" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      index: { type: "integer" },
      name: { type: "string" },
    }, ["track_ref"]),
    refs: refs({
      output: [ref("track_ref", "track", true, "Track ref created by this template.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates exactly one new track; it does not reuse existing named tracks.",
      entities: [
        {
          entity_kind: "track",
          action: "create",
          summary: "One track is created.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "track_created",
          kind: "state_delta",
          summary: "A new track ref exists and resolves after creation.",
        },
        {
          name: "track_name_matches",
          kind: "state_delta",
          summary: "The created track name matches input.name.",
        },
      ],
    }),
    examples: [
      {
        name: "create_dialog_track",
        summary: "Create a track named Dialog at the end of the project.",
        input: { name: "Dialog" },
      },
      {
        name: "create_first_track",
        summary: "Create a track at index zero.",
        input: { name: "Print Bus", index: 0 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.renameTrack,
    title: "Rename track",
    summary: "Set one resolved track's name to a non-empty new value and return the same track ref.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "rename", "wave1a"],
    bridge: bridge({
      capability: "track.rename",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
    }, ["name"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      name: { type: "string" },
    }, ["track_ref"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref to rename.")],
      output: [ref("track_ref", "track", true, "Same track ref after renaming.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track name without changing routing, items, FX, or automation.",
      entities: [
        {
          entity_kind: "track",
          action: "update",
          summary: "The track P_NAME field is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_ref_resolves",
          kind: "state_delta",
          summary: "The input track ref still resolves after renaming.",
        },
        {
          name: "track_name_matches",
          kind: "state_delta",
          summary: "The resolved track name matches input.name.",
        },
      ],
    }),
    examples: [
      {
        name: "rename_track_to_dialog",
        summary: "Rename the resolved track to Dialog.",
        input: { name: "Dialog" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setColor,
    title: "Set track color",
    summary: "Set or clear one track's custom color using portable #RRGGBB or null.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "color", "wave1a"],
    bridge: bridge({
      capability: "track.set_color",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      color: { oneOf: [{ type: "string" }, { type: "null" }] },
    }, ["color"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      color: { oneOf: [{ type: "string" }, { type: "null" }] },
    }, ["track_ref"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose color will be set or cleared.")],
      output: [ref("track_ref", "track", true, "Same track ref after color update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track custom color and does not manage SWS auto-color rules.",
      entities: [
        {
          entity_kind: "track",
          action: "update",
          summary: "The track custom color field is updated or cleared.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_ref_resolves",
          kind: "state_delta",
          summary: "The input track ref still resolves after the color update.",
        },
        {
          name: "track_color_matches",
          kind: "state_delta",
          summary: "The resolved track custom color matches input.color.",
        },
      ],
    }),
    examples: [
      {
        name: "set_track_blue",
        summary: "Set the resolved track to blue.",
        input: { color: "#2D9CDB" },
      },
      {
        name: "clear_track_color",
        summary: "Clear the resolved track custom color.",
        input: { color: null },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.selectTrack,
    title: "Select track",
    summary: "Update one track's selection state using replace, add, or remove mode.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track_selection",
    tags: ["track", "selection", "wave1a"],
    bridge: bridge({
      capability: "track.select",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      mode: { enum: ["replace", "add", "remove"] },
    }, ["mode"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      selected: { type: "boolean" },
      mode: { enum: ["replace", "add", "remove"] },
    }, ["track_ref", "selected"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose selection state will change.")],
      output: [ref("track_ref", "track", true, "Same track ref after selection update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates track selection state; replace mode makes this the only selected track.",
      entities: [
        {
          entity_kind: "track_selection",
          action: "update",
          summary: "Track selection state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_selection_matches",
          kind: "state_delta",
          summary: "The selected track set matches the requested selection mode.",
        },
      ],
    }),
    examples: [
      {
        name: "replace_track_selection",
        summary: "Make the resolved track the only selected track.",
        input: { mode: "replace" },
      },
      {
        name: "add_track_selection",
        summary: "Add the resolved track to the current track selection.",
        input: { mode: "add" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setMute,
    title: "Set track mute",
    summary: "Set one track's mute state to true or false without changing sends or item mute.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "mute", "wave1a"],
    bridge: bridge({
      capability: "track.set_mute",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      muted: { type: "boolean" },
    }, ["muted"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      muted: { type: "boolean" },
    }, ["track_ref", "muted"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose mute state will be set.")],
      output: [ref("track_ref", "track", true, "Same track ref after mute update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track mute state only.",
      entities: [
        {
          entity_kind: "track",
          action: "update",
          summary: "The track B_MUTE field is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_mute_matches",
          kind: "state_delta",
          summary: "The resolved track mute state matches input.muted.",
        },
      ],
    }),
    examples: [
      {
        name: "mute_track",
        summary: "Mute the resolved track.",
        input: { muted: true },
      },
      {
        name: "unmute_track",
        summary: "Unmute the resolved track.",
        input: { muted: false },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setSolo,
    title: "Set track solo",
    summary: "Set one track's solo mode to off, solo, or solo-in-place without touching sends.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "solo", "wave1a"],
    bridge: bridge({
      capability: "track.set_solo",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      mode: { enum: ["off", "solo", "solo_in_place"] },
    }, ["mode"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      mode: { enum: ["off", "solo", "solo_in_place"] },
    }, ["track_ref", "mode"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose solo mode will be set.")],
      output: [ref("track_ref", "track", true, "Same track ref after solo update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track solo mode only.",
      entities: [
        {
          entity_kind: "track",
          action: "update",
          summary: "The track I_SOLO field is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_solo_matches",
          kind: "state_delta",
          summary: "The resolved track solo mode matches input.mode.",
        },
      ],
    }),
    examples: [
      {
        name: "solo_track",
        summary: "Solo the resolved track.",
        input: { mode: "solo" },
      },
      {
        name: "clear_track_solo",
        summary: "Clear solo on the resolved track.",
        input: { mode: "off" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setRecordArm,
    title: "Set track record arm",
    summary: "Set one track's record-arm state without starting or stopping transport recording.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "track",
    tags: ["track", "record_arm", "wave1a"],
    bridge: bridge({
      capability: "track.set_record_arm",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      armed: { type: "boolean" },
    }, ["armed"]),
    outputSchema: objectSchema({
      track_ref: { type: "string" },
      armed: { type: "boolean" },
    }, ["track_ref", "armed"]),
    refs: refs({
      input: [ref("track_ref", "track", true, "Track ref whose record-arm state will be set.")],
      output: [ref("track_ref", "track", true, "Same track ref after record-arm update.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one track record-arm state and leaves transport state unchanged.",
      entities: [
        {
          entity_kind: "track",
          action: "update",
          summary: "The track I_RECARM field is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "track_record_arm_matches",
          kind: "state_delta",
          summary: "The resolved track record-arm state matches input.armed.",
        },
        {
          name: "transport_record_unchanged",
          kind: "state_delta",
          summary: "Transport record state is not started or stopped.",
        },
      ],
    }),
    examples: [
      {
        name: "arm_track",
        summary: "Record-arm the resolved track.",
        input: { armed: true },
      },
      {
        name: "disarm_track",
        summary: "Disarm the resolved track.",
        input: { armed: false },
      },
    ],
  },
]);

export function createWave1ATracksTemplates() {
  return cloneJson(WAVE1A_TRACKS_TEMPLATES);
}

function bridge(overrides = {}) {
  return {
    operation_family: "run_command",
    operation_name: "template.execute",
    capability: "track.update",
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
