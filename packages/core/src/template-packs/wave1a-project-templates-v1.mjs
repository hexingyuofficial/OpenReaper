import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_PROJECT_TEMPLATE_IDS = Object.freeze({
  readSummary: "template.project.read_summary",
  readMetadata: "template.project.read_metadata",
  setMetadataField: "template.project.set_metadata_field",
  listMarkersRegions: "template.project.list_markers_regions",
  createMarker: "template.project.create_marker",
  createRegion: "template.project.create_region",
  readTempoMap: "template.project.read_tempo_map",
  setTempo: "template.project.set_tempo",
  setBpm: "template.project.set_bpm",
  setTempoMarker: "template.project.set_tempo_marker",
  setGrid: "template.project.set_grid",
  setSnap: "template.project.set_snap",
  deleteMarker: "template.project.delete_marker",
  deleteRegion: "template.project.delete_region",
  removeMarker: "template.project.remove_marker",
  removeRegion: "template.project.remove_region",
  renameMarker: "template.project.rename_marker",
  renameRegion: "template.project.rename_region",
  readTrackItemOverview: "template.project.read_track_item_overview",
});

export const WAVE1A_PROJECT_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.readSummary,
    title: "Read project summary",
    summary: "Read compact active-project facts without track, item, or render detail.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "project",
    tags: ["project", "read", "summary"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "project.read_summary",
      capability: "project.read_summary",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_counts: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      name: { type: "string" },
      path: { type: "string" },
      length_seconds: { type: "number" },
      sample_rate: { type: "number" },
      change_count: { type: "integer" },
      marker_count: { type: "integer" },
      region_count: { type: "integer" },
    }, ["project_ref"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Active project ref.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads compact active-project state only.",
      entities: [
        {
          entity_kind: "project",
          action: "read",
          summary: "Active project summary is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_active_project",
        summary: "Read compact facts for the active project.",
        input: {},
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.readMetadata,
    title: "Read project metadata",
    summary: "Read whitelisted project title, author, and notes metadata.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "project",
    tags: ["project", "read", "metadata"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "project.read_metadata",
      capability: "project.read_metadata",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      fields: { type: "array" },
    }, []),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      title: { type: "string" },
      author: { type: "string" },
      notes: { type: "string" },
    }, ["project_ref"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref for the metadata read.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads whitelisted project metadata without mutation.",
      entities: [
        {
          entity_kind: "project",
          action: "read",
          summary: "Project metadata is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_project_notes",
        summary: "Read project title, author, and notes.",
        input: {},
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setMetadataField,
    title: "Set project metadata field",
    summary: "Set one whitelisted project metadata field and verify readback.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "project",
    tags: ["project", "metadata", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_metadata_field",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      field: { enum: ["title", "author", "notes"] },
      value: { type: "string" },
    }, ["field", "value"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      field: { type: "string" },
      updated: { type: "boolean" },
    }, ["project_ref", "field", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose metadata changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates one whitelisted project metadata field.",
      entities: [
        {
          entity_kind: "project",
          action: "update",
          summary: "Project metadata field is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "metadata_field_matches",
          kind: "state_delta",
          summary: "The requested metadata field reads back with the new value.",
        },
      ],
    }),
    examples: [
      {
        name: "set_project_title",
        summary: "Set the project title metadata.",
        input: { field: "title", value: "Combat Variations" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.listMarkersRegions,
    title: "List markers and regions",
    summary: "List ordinary project markers and regions with GUID-backed references when available.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "marker",
    tags: ["project", "marker", "region", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "project.list_markers_regions",
      capability: "project.list_markers_regions",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
      include_markers: { type: "boolean" },
      include_regions: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      items: { type: "array" },
      marker_count: { type: "integer" },
      region_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["items", "marker_count", "region_count", "truncated"]),
    refs: refs({
      output: [
        ref("marker_ref", "marker", false, "Marker refs use GUID identity when available."),
        ref("region_ref", "region", false, "Region refs use GUID identity when available."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads ordinary project markers and regions without executing actions.",
      entities: [
        {
          entity_kind: "marker",
          action: "read",
          summary: "Project markers are read.",
        },
        {
          entity_kind: "region",
          action: "read",
          summary: "Project regions are read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "list_timeline_markers",
        summary: "List project markers and regions with compact refs.",
        input: { limit: 50 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.createMarker,
    title: "Create marker",
    summary: "Create one ordinary project marker; Wave 1A rejects SWS marker-action names.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "marker",
    tags: ["project", "marker", "create"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.create_marker",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
      position_seconds: { type: "number" },
      color: { type: "string" },
    }, ["name", "position_seconds"]),
    outputSchema: objectSchema({
      marker_ref: { type: "string" },
    }, ["marker_ref"]),
    refs: refs({
      output: [ref("marker_ref", "marker", true, "Created marker GUID-backed ref.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates one ordinary project marker.",
      entities: [
        {
          entity_kind: "marker",
          action: "create",
          summary: "One ordinary marker is created.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "marker_ref_returned",
          kind: "state_delta",
          summary: "A GUID-backed marker ref is returned after creation.",
        },
      ],
    }),
    examples: [
      {
        name: "create_intro_marker",
        summary: "Create an ordinary marker at the intro.",
        input: { name: "intro", position_seconds: 0 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.createRegion,
    title: "Create region",
    summary: "Create one explicit-bounds ordinary project region with a GUID-backed reference.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "region",
    tags: ["project", "region", "create"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.create_region",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      name: { type: "string" },
      start_seconds: { type: "number" },
      end_seconds: { type: "number" },
      color: { type: "string" },
    }, ["name", "start_seconds", "end_seconds"]),
    outputSchema: objectSchema({
      region_ref: { type: "string" },
    }, ["region_ref"]),
    refs: refs({
      output: [ref("region_ref", "region", true, "Created region GUID-backed ref.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates one explicit-bounds project region.",
      entities: [
        {
          entity_kind: "region",
          action: "create",
          summary: "One project region is created.",
        },
      ],
      idempotent: false,
    }),
    verification: verification({
      checks: [
        {
          name: "region_bounds_match",
          kind: "state_delta",
          summary: "The created region ref exists with the requested bounds.",
        },
      ],
    }),
    examples: [
      {
        name: "create_chorus_region",
        summary: "Create a region named chorus over explicit bounds.",
        input: { name: "chorus", start_seconds: 12, end_seconds: 28 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.readTempoMap,
    title: "Read tempo map",
    summary: "Read bounded project tempo and time-signature markers without MIDI event data.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "tempo_map",
    tags: ["project", "tempo", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "project.read_tempo_map",
      capability: "project.read_tempo_map",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      limit: { type: "integer" },
      effective_at_seconds: { type: "array" },
    }, []),
    outputSchema: objectSchema({
      tempo_markers: { type: "array" },
      effective: { type: "array" },
      truncated: { type: "boolean" },
    }, ["tempo_markers", "effective", "truncated"]),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads the project tempo map without changing project state.",
      entities: [
        {
          entity_kind: "tempo_map",
          action: "read",
          summary: "Tempo and time-signature markers are read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_tempo_map",
        summary: "Read the project's tempo map.",
        input: { limit: 32 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setTempo,
    title: "Set project tempo",
    summary: "Set the base project tempo in BPM with readback-oriented checks.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "tempo_map",
    tags: ["project", "tempo", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_tempo",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      bpm: { type: "number" },
      preserve_tempo_markers: { type: "boolean" },
    }, ["bpm"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      bpm: { type: "number" },
      updated: { type: "boolean" },
    }, ["project_ref", "bpm", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose base tempo changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates the base project tempo.",
      entities: [
        {
          entity_kind: "tempo_map",
          action: "update",
          summary: "Base project tempo is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "project_tempo_matches",
          kind: "state_delta",
          summary: "The project tempo reads back at the requested BPM.",
        },
      ],
    }),
    examples: [
      {
        name: "set_project_tempo_60",
        summary: "Set project tempo to 60 BPM.",
        input: { bpm: 60 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setBpm,
    title: "Set project BPM",
    summary: "Alias-shaped BPM setter for user requests that say BPM instead of tempo.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "tempo_map",
    tags: ["project", "tempo", "bpm", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_bpm",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      bpm: { type: "number" },
      preserve_tempo_markers: { type: "boolean" },
    }, ["bpm"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      bpm: { type: "number" },
      updated: { type: "boolean" },
    }, ["project_ref", "bpm", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose base BPM changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates the base project BPM.",
      entities: [
        {
          entity_kind: "tempo_map",
          action: "update",
          summary: "Base project BPM is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "project_bpm_matches",
          kind: "state_delta",
          summary: "The project tempo reads back at the requested BPM.",
        },
      ],
    }),
    examples: [
      {
        name: "set_project_bpm_60",
        summary: "Set project BPM to 60.",
        input: { bpm: 60 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setTempoMarker,
    title: "Set tempo marker",
    summary: "Create or update a tempo marker at an explicit project time.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "tempo_map",
    tags: ["project", "tempo", "marker", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_tempo_marker",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      bpm: { type: "number" },
      time_signature_numerator: { type: "integer" },
      time_signature_denominator: { type: "integer" },
    }, ["position_seconds", "bpm"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      position_seconds: { type: "number" },
      bpm: { type: "number" },
      updated: { type: "boolean" },
    }, ["project_ref", "position_seconds", "bpm", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose tempo marker changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Creates or updates one project tempo-map point.",
      entities: [
        {
          entity_kind: "tempo_map",
          action: "update",
          summary: "One tempo marker is created or updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "tempo_marker_matches",
          kind: "state_delta",
          summary: "The tempo map contains the requested BPM at the requested time.",
        },
      ],
    }),
    examples: [
      {
        name: "set_tempo_marker_at_bar_start",
        summary: "Set a 60 BPM tempo marker at project start.",
        input: { position_seconds: 0, bpm: 60 },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setGrid,
    title: "Set project grid",
    summary: "Set the visible project grid division for timeline editing.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "grid",
    tags: ["project", "grid", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_grid",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      division: { type: "string" },
      swing: { type: "number" },
    }, ["division"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      division: { type: "string" },
      updated: { type: "boolean" },
    }, ["project_ref", "division", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose grid changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates the project timeline grid setting.",
      entities: [
        {
          entity_kind: "grid",
          action: "update",
          summary: "Project grid division is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "project_grid_matches",
          kind: "state_delta",
          summary: "The project grid reads back with the requested division.",
        },
      ],
    }),
    examples: [
      {
        name: "set_project_grid_eighths",
        summary: "Set project grid to eighth notes.",
        input: { division: "1/8" },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.setSnap,
    title: "Set project snap",
    summary: "Set whether project snap is enabled for timeline editing.",
    pack: "project",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "grid",
    tags: ["project", "snap", "grid", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "project.set_snap",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      enabled: { type: "boolean" },
    }, ["enabled"]),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      enabled: { type: "boolean" },
      updated: { type: "boolean" },
    }, ["project_ref", "enabled", "updated"]),
    refs: refs({
      output: [ref("project_ref", "project", true, "Project ref whose snap setting changed.")],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary: "Updates the project snap setting.",
      entities: [
        {
          entity_kind: "grid",
          action: "update",
          summary: "Project snap enabled state is updated.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: "project_snap_matches",
          kind: "state_delta",
          summary: "The project snap setting reads back with the requested state.",
        },
      ],
    }),
    examples: [
      {
        name: "enable_project_snap",
        summary: "Enable project snap.",
        input: { enabled: true },
      },
    ],
  },
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.deleteMarker,
    title: "Delete marker",
    summary: "Delete one ordinary project marker by canonical marker ref.",
    capability: "project.delete_marker",
    entityKind: "marker",
    tag: "delete",
    inputRef: ref("marker_ref", "marker", true, "Marker ref to delete."),
    outputRef: ref("marker_ref", "marker", true, "Deleted marker ref."),
    action: "delete",
    risk: "destructive",
    example: {
      name: "delete_marker_by_ref",
      summary: "Delete a marker by ref.",
      input: {},
    },
  }),
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.deleteRegion,
    title: "Delete region",
    summary: "Delete one ordinary project region by canonical region ref.",
    capability: "project.delete_region",
    entityKind: "region",
    tag: "delete",
    inputRef: ref("region_ref", "region", true, "Region ref to delete."),
    outputRef: ref("region_ref", "region", true, "Deleted region ref."),
    action: "delete",
    risk: "destructive",
    example: {
      name: "delete_region_by_ref",
      summary: "Delete a region by ref.",
      input: {},
    },
  }),
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.removeMarker,
    title: "Remove marker",
    summary: "Alias-shaped marker removal atom for user requests that say remove.",
    capability: "project.remove_marker",
    entityKind: "marker",
    tag: "remove",
    inputRef: ref("marker_ref", "marker", true, "Marker ref to remove."),
    outputRef: ref("marker_ref", "marker", true, "Removed marker ref."),
    action: "delete",
    risk: "destructive",
    example: {
      name: "remove_marker_by_ref",
      summary: "Remove a marker by ref.",
      input: {},
    },
  }),
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.removeRegion,
    title: "Remove region",
    summary: "Alias-shaped region removal atom for user requests that say remove.",
    capability: "project.remove_region",
    entityKind: "region",
    tag: "remove",
    inputRef: ref("region_ref", "region", true, "Region ref to remove."),
    outputRef: ref("region_ref", "region", true, "Removed region ref."),
    action: "delete",
    risk: "destructive",
    example: {
      name: "remove_region_by_ref",
      summary: "Remove a region by ref.",
      input: {},
    },
  }),
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.renameMarker,
    title: "Rename marker",
    summary: "Rename one ordinary project marker by canonical marker ref.",
    capability: "project.rename_marker",
    entityKind: "marker",
    tag: "rename",
    inputRef: ref("marker_ref", "marker", true, "Marker ref to rename."),
    outputRef: ref("marker_ref", "marker", true, "Renamed marker ref."),
    action: "update",
    risk: "write",
    properties: { name: { type: "string" } },
    required: ["name"],
    example: {
      name: "rename_marker",
      summary: "Rename a marker by ref.",
      input: { name: "verse" },
    },
  }),
  markerMutationDescriptor({
    id: WAVE1A_PROJECT_TEMPLATE_IDS.renameRegion,
    title: "Rename region",
    summary: "Rename one ordinary project region by canonical region ref.",
    capability: "project.rename_region",
    entityKind: "region",
    tag: "rename",
    inputRef: ref("region_ref", "region", true, "Region ref to rename."),
    outputRef: ref("region_ref", "region", true, "Renamed region ref."),
    action: "update",
    risk: "write",
    properties: { name: { type: "string" } },
    required: ["name"],
    example: {
      name: "rename_region",
      summary: "Rename a region by ref.",
      input: { name: "chorus" },
    },
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_PROJECT_TEMPLATE_IDS.readTrackItemOverview,
    title: "Read track item overview",
    summary: "Read a compact project object-map snapshot with track and item counts plus selected objects.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "project",
    tags: ["project", "tracks", "items", "snapshot", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "project.read_track_item_overview",
      capability: "project.read_track_item_overview",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      max_tracks: { type: "integer" },
      max_items_per_track: { type: "integer" },
      include_selected_items: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      project_ref: { type: "string" },
      tracks: { type: "array" },
      selected_items: { type: "array" },
      track_count: { type: "integer" },
      item_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["project_ref", "tracks", "selected_items", "track_count", "item_count", "truncated"]),
    refs: refs({
      output: [
        ref("project_ref", "project", true, "Active project ref."),
        ref("track_ref", "track", false, "Canonical track refs included in the compact snapshot."),
        ref("item_ref", "item", false, "Canonical item refs included in the compact snapshot."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads a compact track/item object-map snapshot without mutation.",
      entities: [
        {
          entity_kind: "project",
          action: "read",
          summary: "Project track/item overview is read.",
        },
        {
          entity_kind: "track",
          action: "read",
          summary: "Track refs and display facts are read.",
        },
        {
          entity_kind: "item",
          action: "read",
          summary: "Selected or bounded item refs are read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_compact_track_item_overview",
        summary: "Read a compact project object map before mutation.",
        input: { max_tracks: 32, max_items_per_track: 8, include_selected_items: true },
      },
    ],
  },
]);

export function createWave1aProjectTemplates() {
  return cloneJson(WAVE1A_PROJECT_TEMPLATES);
}

function markerMutationDescriptor({
  id,
  title,
  summary,
  capability,
  entityKind,
  tag,
  inputRef,
  outputRef,
  action,
  risk,
  properties = {},
  required = [],
  example,
}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id,
    title,
    summary,
    pack: "project",
    lifecycle: "experimental",
    risk,
    entity_kind: entityKind,
    tags: ["project", entityKind, tag],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability,
      idempotency: "supported",
    }),
    inputSchema: objectSchema(properties, required),
    outputSchema: objectSchema({
      [outputRef.name]: { type: "string" },
      updated: { type: "boolean" },
    }, [outputRef.name, "updated"]),
    refs: refs({
      input: [inputRef],
      output: [outputRef],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "mutation",
      summary,
      entities: [
        {
          entity_kind: entityKind,
          action,
          summary: `${title} changes one project ${entityKind}.`,
        },
      ],
      idempotent: true,
    }),
    verification: verification({
      checks: [
        {
          name: `${capability.replaceAll(".", "_")}_readback`,
          kind: "state_delta",
          summary: `${title} is verified by marker/region list readback.`,
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
    capability: "project.create_marker",
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

function ref(name, kind, required, summary) {
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

function expectedDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Project template expected delta.",
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
