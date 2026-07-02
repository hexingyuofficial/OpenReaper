import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_PROJECT_TEMPLATE_IDS = Object.freeze({
  readSummary: "template.project.read_summary",
  readMetadata: "template.project.read_metadata",
  setMetadataField: "template.project.set_metadata_field",
  listMarkersRegions: "template.project.list_markers_regions",
  createMarker: "template.project.create_marker",
  createRegion: "template.project.create_region",
  readTempoMap: "template.project.read_tempo_map",
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
]);

export function createWave1aProjectTemplates() {
  return cloneJson(WAVE1A_PROJECT_TEMPLATES);
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
