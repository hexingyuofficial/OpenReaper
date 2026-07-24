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
  deleteTrack: "template.tracks.delete_track",
  deleteTracks: "template.tracks.delete_tracks",
  setVolume: "template.tracks.set_volume",
  setPan: "template.tracks.set_pan",
  setWidth: "template.tracks.set_width",
  readMixerControls: "template.tracks.read_mixer_controls",
  createFolderTrack: "template.tracks.create_folder_track",
  setFolderDepth: "template.tracks.set_folder_depth",
  moveTrack: "template.tracks.move_track",
  moveTracks: "template.tracks.move_tracks",
  nestTracksInFolder: "template.tracks.nest_tracks_in_folder",
  readFolderStructure: "template.tracks.read_folder_structure",
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
      selector_filter: { type: "object" },
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
  makeDestructiveTrackDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.deleteTrack,
    title: "Delete track",
    summary: "Delete one resolved track and return a compact deletion count for cleanup parity.",
    capability: "track.delete",
    inputProperties: {},
    outputProperties: {
      deleted_count: { type: "integer" },
      deleted_refs: { type: "array" },
    },
    outputRequired: ["deleted_count", "deleted_refs"],
    refsInput: [ref("track_ref", "track", true, "Track ref to delete.")],
    expectedSummary: "Deletes exactly one resolved track and leaves unrelated project objects untouched.",
    entityKind: "track",
    action: "delete",
    verificationChecks: [
      {
        name: "track_no_longer_resolves",
        kind: "state_delta",
        summary: "The deleted track ref no longer resolves after the operation.",
      },
      {
        name: "deleted_count_matches",
        kind: "state_delta",
        summary: "The deletion summary reports exactly one deleted track.",
      },
    ],
    examples: [
      {
        name: "delete_created_track",
        summary: "Delete a track created during a trial.",
        input: {},
      },
    ],
  }),
  makeDestructiveTrackDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.deleteTracks,
    title: "Delete tracks",
    summary: "Delete multiple resolved tracks in one cleanup operation and report deleted refs.",
    capability: "tracks.delete",
    inputProperties: { selector_guard: { type: "object" } },
    inputRequired: [],
    outputProperties: {
      deleted_count: { type: "integer" },
      deleted_refs: { type: "array" },
    },
    outputRequired: ["deleted_count", "deleted_refs"],
    refsInput: [ref("track_ref", "track", true, "Track refs to delete.")],
    expectedSummary: "Deletes the supplied resolved tracks as a bounded cleanup mutation.",
    entityKind: "track",
    action: "delete",
    verificationChecks: [
      {
        name: "tracks_no_longer_resolve",
        kind: "state_delta",
        summary: "Every deleted track ref no longer resolves after the operation.",
      },
      {
        name: "deleted_count_matches_refs",
        kind: "state_delta",
        summary: "The deletion summary count matches the number of supplied track refs.",
      },
    ],
    examples: [
      {
        name: "delete_trial_tracks",
        summary: "Delete several tracks created during a trial.",
        input: {},
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setVolume,
    title: "Set track volume",
    summary: "Set one track's mixer volume gain as a normalized scalar without changing sends.",
    capability: "track.set_volume",
    tags: ["track", "mixer", "volume", "wave1a"],
    inputProperties: {
      volume: { type: "number" },
    },
    inputRequired: ["volume"],
    outputProperties: {
      track_ref: { type: "string" },
      volume: { type: "number" },
    },
    outputRequired: ["track_ref", "volume"],
    expectedSummary: "Updates one track mixer volume control only.",
    verificationChecks: [
      {
        name: "track_volume_matches",
        kind: "state_delta",
        summary: "The resolved track volume matches input.volume.",
      },
    ],
    examples: [
      {
        name: "lower_track_volume",
        summary: "Set the resolved track to half scalar volume.",
        input: { volume: 0.5 },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setPan,
    title: "Set track pan",
    summary: "Set one track's mixer pan position from left to right without changing sends.",
    capability: "track.set_pan",
    tags: ["track", "mixer", "pan", "wave1a"],
    inputProperties: {
      pan: { type: "number" },
    },
    inputRequired: ["pan"],
    outputProperties: {
      track_ref: { type: "string" },
      pan: { type: "number" },
    },
    outputRequired: ["track_ref", "pan"],
    expectedSummary: "Updates one track mixer pan control only.",
    verificationChecks: [
      {
        name: "track_pan_matches",
        kind: "state_delta",
        summary: "The resolved track pan matches input.pan.",
      },
    ],
    examples: [
      {
        name: "pan_track_left",
        summary: "Set the resolved track pan to the left side.",
        input: { pan: -0.5 },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setWidth,
    title: "Set track width",
    summary: "Set one track's stereo width control without changing pan, volume, or sends.",
    capability: "track.set_width",
    tags: ["track", "mixer", "width", "wave1a"],
    inputProperties: {
      width: { type: "number" },
    },
    inputRequired: ["width"],
    outputProperties: {
      track_ref: { type: "string" },
      width: { type: "number" },
    },
    outputRequired: ["track_ref", "width"],
    expectedSummary: "Updates one track stereo width control only.",
    verificationChecks: [
      {
        name: "track_width_matches",
        kind: "state_delta",
        summary: "The resolved track stereo width matches input.width.",
      },
    ],
    examples: [
      {
        name: "narrow_track_width",
        summary: "Set the resolved track to narrower stereo width.",
        input: { width: 0.75 },
      },
    ],
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.readMixerControls,
    title: "Read track mixer controls",
    summary: "Read compact mixer controls for one or more tracks without mutating mixer state.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "track_mixer",
    tags: ["track", "mixer", "read", "wave1a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "tracks.read_mixer_controls",
      capability: "tracks.read_mixer_controls",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_selected: { type: "boolean" },
      limit: { type: "integer" },
    }, []),
    outputSchema: objectSchema({
      tracks: { type: "array" },
      track_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["tracks", "track_count", "truncated"]),
    refs: refs({
      input: [ref("track_ref", "track", false, "Optional track refs to inspect.")],
      output: [ref("track_ref", "track", false, "Track refs included in the mixer control summary.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads compact volume, pan, width, mute, solo, and record-arm state.",
      entities: [
        {
          entity_kind: "track_mixer",
          action: "read",
          summary: "Track mixer control state is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_selected_mixer_controls",
        summary: "Read mixer controls for selected tracks.",
        input: { include_selected: true, limit: 16 },
      },
    ],
  },
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.createFolderTrack,
    title: "Create folder track",
    summary: "Create one folder parent track at an optional index and return its track ref.",
    capability: "track.create_folder",
    tags: ["track", "folder", "create", "wave1a"],
    inputProperties: {
      name: { type: "string" },
      index: { type: "integer" },
    },
    inputRequired: ["name"],
    outputProperties: {
      track_ref: { type: "string" },
      index: { type: "integer" },
      name: { type: "string" },
      folder_depth: { type: "integer" },
    },
    outputRequired: ["track_ref", "name", "folder_depth"],
    refsInput: [],
    refsOutput: [ref("track_ref", "track", true, "Folder track ref created by this template.")],
    expectedSummary: "Creates exactly one folder parent track without moving existing tracks.",
    entityKind: "track_folder",
    action: "create",
    idempotent: false,
    verificationChecks: [
      {
        name: "folder_track_created",
        kind: "state_delta",
        summary: "A new folder parent track exists after creation.",
      },
      {
        name: "folder_name_matches",
        kind: "state_delta",
        summary: "The created folder track name matches input.name.",
      },
    ],
    examples: [
      {
        name: "create_drums_folder",
        summary: "Create a folder track named Drums.",
        input: { name: "Drums" },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.setFolderDepth,
    title: "Set track folder depth",
    summary: "Set one track's folder depth integer for explicit REAPER folder organization.",
    capability: "track.set_folder_depth",
    tags: ["track", "folder", "organization", "wave1a"],
    inputProperties: {
      folder_depth: { type: "integer" },
    },
    inputRequired: ["folder_depth"],
    outputProperties: {
      track_ref: { type: "string" },
      folder_depth: { type: "integer" },
    },
    outputRequired: ["track_ref", "folder_depth"],
    expectedSummary: "Updates one track folder depth without moving tracks.",
    entityKind: "track_folder",
    verificationChecks: [
      {
        name: "folder_depth_matches",
        kind: "state_delta",
        summary: "The resolved track folder depth matches input.folder_depth.",
      },
    ],
    examples: [
      {
        name: "make_folder_parent",
        summary: "Mark the resolved track as opening one folder level.",
        input: { folder_depth: 1 },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.moveTrack,
    title: "Move track",
    summary: "Move one resolved track to a zero-based project index for organization workflows.",
    capability: "track.move",
    tags: ["track", "move", "organization", "wave1a"],
    inputProperties: {
      index: { type: "integer" },
    },
    inputRequired: ["index"],
    outputProperties: {
      track_ref: { type: "string" },
      index: { type: "integer" },
    },
    outputRequired: ["track_ref", "index"],
    expectedSummary: "Moves one track to the requested project index.",
    entityKind: "track_order",
    verificationChecks: [
      {
        name: "track_index_matches",
        kind: "state_delta",
        summary: "The resolved track index matches input.index after the move.",
      },
    ],
    examples: [
      {
        name: "move_track_to_top",
        summary: "Move the resolved track to the top of the project.",
        input: { index: 0 },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.moveTracks,
    title: "Move tracks",
    summary: "Move multiple resolved tracks as an ordered block to a zero-based project index.",
    capability: "tracks.move",
    tags: ["track", "move", "organization", "wave1a"],
    inputProperties: {
      index: { type: "integer" },
    },
    inputRequired: ["index"],
    outputProperties: {
      track_refs: { type: "array" },
      index: { type: "integer" },
      moved_count: { type: "integer" },
    },
    outputRequired: ["track_refs", "index", "moved_count"],
    expectedSummary: "Moves the supplied tracks as a bounded ordered block.",
    entityKind: "track_order",
    verificationChecks: [
      {
        name: "moved_count_matches_refs",
        kind: "state_delta",
        summary: "The moved count matches the number of supplied track refs.",
      },
      {
        name: "track_block_starts_at_index",
        kind: "state_delta",
        summary: "The moved track block starts at input.index.",
      },
    ],
    examples: [
      {
        name: "move_tracks_to_top",
        summary: "Move resolved tracks to the top of the project.",
        input: { index: 0 },
      },
    ],
  }),
  makeTrackUpdateDescriptor({
    id: WAVE1A_TRACKS_TEMPLATE_IDS.nestTracksInFolder,
    title: "Nest tracks in folder",
    summary: "Move resolved child tracks under a resolved folder track and set bounded folder depth.",
    capability: "tracks.nest_in_folder",
    tags: ["track", "folder", "organization", "wave1a"],
    inputProperties: {},
    inputRequired: [],
    outputProperties: {
      folder_ref: { type: "string" },
      child_refs: { type: "array" },
      nested_count: { type: "integer" },
    },
    outputRequired: ["folder_ref", "child_refs", "nested_count"],
    refsInput: [
      ref("folder_ref", "track", true, "Folder parent track ref."),
      ref("track_ref", "track", true, "Child track refs to move under the folder."),
    ],
    refsOutput: [ref("track_ref", "track", false, "Folder and child track refs after nesting.")],
    expectedSummary: "Moves child tracks under one folder track and updates folder depth markers.",
    entityKind: "track_folder",
    verificationChecks: [
      {
        name: "children_follow_folder",
        kind: "state_delta",
        summary: "Child tracks appear after the folder parent in project order.",
      },
      {
        name: "folder_depths_are_balanced",
        kind: "state_delta",
        summary: "Folder depth values create one bounded folder span.",
      },
    ],
    examples: [
      {
        name: "nest_drums_in_folder",
        summary: "Nest selected drum tracks under a folder parent.",
        input: {},
      },
    ],
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_TRACKS_TEMPLATE_IDS.readFolderStructure,
    title: "Read track folder structure",
    summary: "Read compact track folder depth and parent/child organization without mutating tracks.",
    pack: "tracks",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "track_folder",
    tags: ["track", "folder", "read", "organization", "wave1a"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "tracks.read_folder_structure",
      capability: "tracks.read_folder_structure",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
    }, []),
    outputSchema: objectSchema({
      folders: { type: "array" },
      tracks: { type: "array" },
      track_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["folders", "tracks", "track_count", "truncated"]),
    refs: refs({
      output: [ref("track_ref", "track", false, "Track refs included in the folder structure.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads folder organization and track order without mutating the project.",
      entities: [
        {
          entity_kind: "track_folder",
          action: "read",
          summary: "Track folder structure is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_folder_tree",
        summary: "Read compact folder structure before reorganizing tracks.",
        input: { limit: 64 },
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

function makeTrackUpdateDescriptor({
  id,
  title,
  summary,
  capability,
  tags,
  inputProperties,
  inputRequired,
  outputProperties,
  outputRequired,
  refsInput = [ref("track_ref", "track", true, "Track ref to update.")],
  refsOutput = [ref("track_ref", "track", true, "Same track ref after the update.")],
  expectedSummary,
  entityKind = "track",
  action = "update",
  idempotent = true,
  verificationChecks,
  examples,
}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id,
    title,
    summary,
    pack: "tracks",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: entityKind,
    tags,
    bridge: bridge({
      capability,
      idempotency: "supported",
    }),
    inputSchema: objectSchema(inputProperties, inputRequired),
    outputSchema: objectSchema(outputProperties, outputRequired),
    refs: refs({
      input: refsInput,
      output: refsOutput,
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: expectedSummary,
      entities: [
        {
          entity_kind: entityKind,
          action,
          summary: expectedSummary,
        },
      ],
      idempotent,
    }),
    verification: verification({
      checks: verificationChecks,
    }),
    examples,
  };
}

function makeDestructiveTrackDescriptor(options) {
  return {
    ...makeTrackUpdateDescriptor({
      ...options,
      tags: ["track", "delete", "cleanup", "wave1a"],
      idempotent: false,
    }),
    risk: "destructive",
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
