import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const P1_TEMPLATE_FILL_TEMPLATE_IDS = Object.freeze([
  "template.fx.search_installed_fx",
  "template.media.list_folder_media_files",
  "template.items.copy_item_to_track",
]);

export const P1_TEMPLATE_FILL_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.fx.search_installed_fx",
    title: "Search installed FX",
    summary: "Search the installed FX inventory by text and return capped inline name rows.",
    pack: "fx",
    entity_kind: "plugin",
    tags: ["p1", "fx", "plugin", "search", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "fx.installed.search",
      capability: "fx.installed.search",
      idempotency: "none",
      timeout_ms: 30_000,
    }),
    inputSchema: objectSchema({
      query: { type: "string" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }, ["query"]),
    outputSchema: objectSchema({
      query: { type: "string" },
      rows: { type: "array" },
      row_count: { type: "integer" },
      limit: { type: "integer" },
      offset: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["query", "rows", "row_count", "truncated"]),
    expectedDelta: readDelta({
      summary: "Reads capped installed FX search rows without changing any FX chain.",
      entities: [
        {
          entity_kind: "plugin",
          action: "read",
          summary: "Installed FX names and idents matching the query are read.",
        },
      ],
    }),
    examples: [
      {
        name: "search_rea_fx",
        summary: "Search for installed FX with Rea in the name.",
        input: { query: "Rea", limit: 8, offset: 0 },
      },
    ],
  }),
  readDescriptor({
    id: "template.media.list_folder_media_files",
    title: "List folder media files",
    summary: "List capped media-file candidates from one approved folder ref without project changes.",
    pack: "media",
    entity_kind: "media_file",
    tags: ["p1", "media", "folder", "file", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "media.folder_media.list",
      capability: "media.folder_media.list",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      folder_ref: { type: "string" },
      media_type: { enum: ["audio", "midi", "video", "any"] },
      extension_filter: { type: "array" },
      limit: { type: "integer" },
      offset: { type: "integer" },
    }, ["folder_ref"]),
    outputSchema: objectSchema({
      folder_ref: { type: "string" },
      rows: { type: "array" },
      file_refs: { type: "array" },
      row_count: { type: "integer" },
      limit: { type: "integer" },
      offset: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["folder_ref", "rows", "row_count", "truncated"]),
    refs: refs({
      output: [ref("file_refs", "file", false, "Media file refs returned from the approved folder.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads a capped, non-recursive media-file list from one approved folder ref.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Media file candidates are listed without project mutation.",
        },
      ],
    }),
    examples: [
      {
        name: "list_audio_folder",
        summary: "List a capped first page of audio files from an approved folder ref.",
        input: {
          folder_ref: "folder:approved-samples",
          media_type: "audio",
          extension_filter: ["wav", "aiff"],
          limit: 20,
          offset: 0,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.items.copy_item_to_track",
    title: "Copy item to track",
    summary: "Copy one source item footprint, or a bounded batch of exact source/target rows, through one managed native route.",
    pack: "items",
    entity_kind: "item",
    tags: ["p1", "items", "item", "copy", "write"],
    bridge: bridge({
      operation_family: "run_command",
      operation_name: "template.execute",
      capability: "item.copy_to_track",
      idempotency: "supported",
    }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      batch: {
        type: "array",
        minItems: 1,
        maxItems: 64,
        items: {
          type: "object",
          properties: {
            id: { type: "string" },
            source_item_ref: { type: "string" },
            target_track_ref: { type: "string" },
            position_seconds: { type: "number" },
            source_offset_seconds: { type: "number" },
          },
          required: ["id", "source_item_ref", "target_track_ref", "position_seconds"],
          additionalProperties: false,
        },
      },
    }, []),
    outputSchema: objectSchema({
      new_item_ref: { type: "string" },
      source_item_ref: { type: "string" },
      target_track_ref: { type: "string" },
      position_seconds: { type: "number" },
      copy_depth: { const: "active_take_footprint" },
      source_footprint: { type: "object" },
      rows: { type: "array" },
      batch_timings: { type: "object" },
    }, ["new_item_ref", "target_track_ref", "position_seconds", "copy_depth", "source_footprint"]),
    refs: refs({
      input: [
        ref("source_item_ref", "item", true, "Single source item ref to copy."),
        ref("target_track_ref", "track", true, "Existing target track ref for the new item."),
      ],
      output: [ref("new_item_ref", "item", true, "New copied item ref on the target track.")],
    }),
    expectedDelta: mutationDelta({
      summary: "Creates one new item on the target track from the verified active-take source footprint.",
      entities: [
        {
          entity_kind: "item",
          action: "read",
          summary: "The source item footprint is read.",
        },
        {
          entity_kind: "track",
          action: "read",
          summary: "The target track identity is read.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "One new item is created at the requested position.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification([
      check("new_item_created", "state_delta", "A new item ref exists after the copy."),
      check("target_track_matches", "state_delta", "The new item is on the supplied target track."),
      check("position_matches", "state_delta", "The new item starts at input.position_seconds."),
      check("source_footprint_matches", "state_delta", "The target active take matches the verified source footprint and leaves the source unchanged."),
    ]),
    examples: [
      {
        name: "copy_item_to_target_track",
        summary: "Copy one resolved item to a target track at 4 seconds.",
        input: { position_seconds: 4 },
      },
    ],
  }),
]);

export function createP1TemplateFillTemplates() {
  return cloneJson(P1_TEMPLATE_FILL_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
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
    expectedDelta: mutationDelta(),
    verification: requiredVerification([
      check("state_matches", "state_delta", "State readback matches the requested mutation."),
    ]),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.items.copy_item_to_track",
    title: "P1 template fill descriptor",
    summary: "Run one bounded P1 template fill descriptor.",
    pack: "items",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "item",
    tags: ["p1"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "p1_template_fill",
        summary: "Run one bounded P1 descriptor.",
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
    capability: "item.copy_to_track",
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

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads bounded state.",
    entities: [
      {
        entity_kind: "core_state",
        action: "read",
        summary: "Bounded state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Mutates one bounded project surface.",
    entities: [
      {
        entity_kind: "item",
        action: "create",
        summary: "One item is created.",
      },
    ],
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

function requiredVerification(checks) {
  return verification({
    mode: "required",
    checks,
  });
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
