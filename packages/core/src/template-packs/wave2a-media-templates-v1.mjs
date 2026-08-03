import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE2A_MEDIA_TEMPLATE_IDS = Object.freeze([
  "template.media.probe_file",
  "template.media.read_take_source",
  "template.media.import_file_to_track",
  "template.media.import_file_section_to_track",
  "template.media.import_files_batch",
  "template.media.read_project_media_files",
  "template.media.relink_take_source",
]);

export const WAVE2A_MEDIA_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.media.probe_file",
    title: "Probe media file",
    summary: "Probe one file as a REAPER media source and return bounded source facts.",
    entity_kind: "media_file",
    tags: ["media", "file", "source", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "media.file.probe",
      capability: "media.file.probe",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      path: { type: "string" },
      include_metadata_keys: { type: "boolean" },
    }, ["path"]),
    outputSchema: objectSchema({
      file_ref: { type: "string" },
      source_type: { type: "string" },
      length_seconds: { type: "number" },
      length_is_quarter_notes: { type: "boolean" },
      channel_count: { type: "integer" },
      metadata_keys: { type: "array" },
      decodable: { type: "boolean" },
    }, ["file_ref", "decodable"]),
    refs: refs({
      output: [ref("file_ref", "file", true, "Media file ref for the probed path.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads media file/source facts without importing or mutating project state.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Media file readability and source facts are read.",
        },
      ],
    }),
    examples: [
      {
        name: "probe_audio_file",
        summary: "Probe one source file before import.",
        input: {
          path: "/Users/Shared/OpenReaper/sample.wav",
          include_metadata_keys: true,
        },
      },
      {
        name: "probe_long_unicode_path",
        summary: "Probe a long multi-segment path with spaces and Chinese characters as full identity.",
        input: {
          path: "/Users/Shared/OpenReaper/library session 演示资料/nested folder 层级/deep/more nested 路径段/path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes/path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes/clip 源文件 final.wav",
          include_metadata_keys: false,
        },
      },
    ],
  }),
  readDescriptor({
    id: "template.media.read_take_source",
    title: "Read take source",
    summary: "Read bounded media source facts for one existing take without editing the item.",
    entity_kind: "media_source",
    tags: ["media", "take", "source", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "media.take_source.read",
      capability: "media.take_source.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_metadata_keys: { type: "boolean" },
      include_parent_source: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      file_ref: { type: "string" },
      source_type: { type: "string" },
      take_name: { type: "string" },
      filename: { type: "string" },
      length_seconds: { type: "number" },
      channel_count: { type: "integer" },
      offline: { type: "boolean" },
      metadata_keys: { type: "array" },
    }, ["take_ref", "source_type"]),
    refs: refs({
      input: [ref("take_ref", "take", true, "Take whose current media source is read.")],
      output: [ref("file_ref", "file", false, "File ref for the take source when it has a filename.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads current take source metadata without item or take-container edits.",
      entities: [
        {
          entity_kind: "media_source",
          action: "read",
          summary: "The take source is summarized.",
        },
        {
          entity_kind: "take",
          action: "read",
          summary: "The addressed take is consumed as source context.",
        },
      ],
    }),
    examples: [
      {
        name: "read_take_source",
        summary: "Read source facts for a supplied take ref.",
        input: {
          include_metadata_keys: true,
          include_parent_source: false,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.media.import_file_to_track",
    title: "Import file to track",
    summary: "Import one media file onto an existing track at an explicit project position.",
    entity_kind: "media_file",
    tags: ["media", "import", "file", "track"],
    bridge: bridge({ capability: "media.import_file_to_track" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      preserve_selection: { type: "boolean" },
    }, ["position_seconds"]),
    outputSchema: objectSchema({
      imported_item_refs: { type: "array" },
      item_count: { type: "integer" },
      source_file_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      selection_restored: { type: "boolean" },
    }, ["imported_item_refs", "item_count", "source_file_ref", "track_ref"]),
    refs: refs({
      input: [
        ref("source_file_ref", "file", true, "Media file to import."),
        ref("track_ref", "track", true, "Existing target track for the import."),
      ],
      output: [
        ref("imported_item_refs", "item", true, "Item refs created by the import."),
        ref("source_file_ref", "file", true, "Source file ref used for the import."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Imports a media file and creates one or more placed item refs.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Source media file is read by REAPER import.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "One or more media items are created on the target track.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "imported_items_exist",
      kind: "state_delta",
      summary: "Imported item refs exist at the requested position and selection is restored.",
    }),
    examples: [
      {
        name: "import_file",
        summary: "Import a resolved media file to an existing target track.",
        input: {
          position_seconds: 0,
          preserve_selection: true,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.media.import_file_section_to_track",
    title: "Import file section to track",
    summary: "Import an explicit source-file percentage range onto an existing track.",
    entity_kind: "media_file",
    tags: ["media", "import", "section", "track"],
    bridge: bridge({ capability: "media.import_file_section_to_track" }),
    inputSchema: objectSchema({
      position_seconds: { type: "number" },
      start_percent: { type: "number" },
      end_percent: { type: "number" },
      preserve_selection: { type: "boolean" },
    }, ["position_seconds", "start_percent", "end_percent"]),
    outputSchema: objectSchema({
      imported_item_refs: { type: "array" },
      item_count: { type: "integer" },
      source_file_ref: { type: "string" },
      track_ref: { type: "string" },
      position_seconds: { type: "number" },
      start_percent: { type: "number" },
      end_percent: { type: "number" },
    }, ["imported_item_refs", "item_count", "source_file_ref", "track_ref"]),
    refs: refs({
      input: [
        ref("source_file_ref", "file", true, "Media file whose section is imported."),
        ref("track_ref", "track", true, "Existing target track for the section import."),
      ],
      output: [
        ref("imported_item_refs", "item", true, "Item refs created by the section import."),
        ref("source_file_ref", "file", true, "Source file ref used for the section import."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Imports a source-file section and creates one or more placed item refs.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Source media section is read by REAPER import.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "One or more media items are created from the source section.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "section_imported_items_exist",
      kind: "state_delta",
      summary: "Imported section item refs exist and source-section bounds are honored.",
    }),
    examples: [
      {
        name: "import_middle_half",
        summary: "Import the middle half of a resolved source file.",
        input: {
          position_seconds: 2,
          start_percent: 0.25,
          end_percent: 0.75,
          preserve_selection: true,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.media.import_files_batch",
    title: "Import media files batch",
    summary: "Import a bounded batch of media files through one typed native queue and one Undo scope.",
    entity_kind: "media_file",
    tags: ["media", "import", "batch", "track"],
    bridge: bridge({ capability: "media.import_files_batch" }),
    inputSchema: objectSchema({
      batch: { type: "array" },
      preserve_selection: { type: "boolean" },
    }, ["batch", "preserve_selection"]),
    outputSchema: objectSchema({
      rows: { type: "array" },
      source_footprints: { type: "array" },
      batch_timings: { type: "object" },
      selection_restored: { type: "boolean" },
    }, ["rows", "batch_timings"]),
    refs: refs({
      input: [
        ref("source_file_refs", "file", true, "One exact source File ref per batch row."),
        ref("track_refs", "track", true, "One exact target Track ref per batch row."),
      ],
      output: [
        ref("item_refs", "item", true, "Created Item refs in batch row order."),
        ref("take_refs", "take", true, "Created Take refs in batch row order."),
        ref("source_file_refs", "file", true, "Canonical source File refs in batch row order."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Imports a bounded media-file batch onto existing target Tracks through one serial native queue.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Every source media file is decoded and measured during batch preflight.",
        },
        {
          entity_kind: "item",
          action: "create",
          summary: "One placed media Item is created per completed batch row.",
        },
      ],
      idempotent: false,
    }),
    verification: requiredVerification({
      name: "batch_items_and_sources_match",
      kind: "state_delta",
      summary: "Every completed row returns native Item/Take/source identity and position readback.",
    }),
    examples: [
      {
        name: "import_files_batch",
        summary: "Import multiple resolved source Files onto resolved Tracks in one native batch.",
        input: {
          batch: [
            { id: "asset-1", position_seconds: 0 },
            { id: "asset-2", position_seconds: 2, start_percent: 0.25, end_percent: 0.75 },
          ],
          preserve_selection: true,
        },
      },
    ],
  }),
  readDescriptor({
    id: "template.media.read_project_media_files",
    title: "Read project media files",
    summary: "Read a bounded list of distinct media files referenced by project takes.",
    entity_kind: "media_file",
    tags: ["media", "project", "files", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "media.project_files.read",
      capability: "media.project_files.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_offline: { type: "boolean" },
      include_metadata_keys: { type: "boolean" },
      max_sources: { type: "integer" },
    }, []),
    outputSchema: objectSchema({
      source_count: { type: "integer" },
      file_refs: { type: "array" },
      offline_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["source_count", "truncated"]),
    refs: refs({
      output: [ref("file_refs", "file", false, "Distinct project media file refs.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads distinct project media source files without editing project objects.",
      entities: [
        {
          entity_kind: "media_file",
          action: "read",
          summary: "Referenced media files are summarized.",
        },
      ],
    }),
    examples: [
      {
        name: "read_project_media_files",
        summary: "Read up to 25 project source files.",
        input: {
          include_offline: true,
          include_metadata_keys: false,
          max_sources: 25,
        },
      },
    ],
  }),
  commandDescriptor({
    id: "template.media.relink_take_source",
    title: "Relink take source",
    summary: "Replace one take's media source with a supplied file without item-container edits.",
    entity_kind: "media_source",
    tags: ["media", "relink", "take", "source"],
    bridge: bridge({ capability: "media.relink_take_source" }),
    inputSchema: objectSchema({
      verify_source_type: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      take_ref: { type: "string" },
      source_file_ref: { type: "string" },
      source_type: { type: "string" },
      relinked: { type: "boolean" },
    }, ["take_ref", "source_file_ref", "relinked"]),
    refs: refs({
      input: [
        ref("take_ref", "take", true, "Take whose media source is replaced."),
        ref("source_file_ref", "file", true, "Replacement source media file."),
      ],
      output: [
        ref("take_ref", "take", true, "Relinked take ref."),
        ref("source_file_ref", "file", true, "Replacement source media file ref."),
      ],
    }),
    expectedDelta: mutationDelta({
      summary: "Updates exactly one take media-source pointer to a supplied source file.",
      entities: [
        {
          entity_kind: "media_source",
          action: "update",
          summary: "Take source file pointer is updated.",
        },
        {
          entity_kind: "take",
          action: "update",
          summary: "The addressed take now references the replacement source.",
        },
      ],
      idempotent: true,
    }),
    verification: requiredVerification({
      name: "take_source_matches",
      kind: "state_delta",
      summary: "Take source readback matches the supplied replacement file ref.",
    }),
    examples: [
      {
        name: "relink_take_source",
        summary: "Relink one supplied take ref to a replacement media file.",
        input: {
          verify_source_type: true,
        },
      },
    ],
  }),
]);

export function createWave2AMediaTemplates() {
  return cloneJson(WAVE2A_MEDIA_TEMPLATES);
}

function readDescriptor(overrides = {}) {
  return descriptor({
    risk: "read",
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "media.file.probe",
      capability: "media.file.probe",
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
    verification: requiredVerification({
      name: "media_state_matches",
      kind: "state_delta",
      summary: "Media state readback matches the requested mutation.",
    }),
    ...overrides,
  });
}

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.media.probe_file",
    title: "Media template",
    summary: "Run one bounded media template.",
    pack: "media",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "media_file",
    tags: ["media"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "media_template",
        summary: "Run a bounded media template.",
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
    capability: "media.import_file_to_track",
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
    summary: "Reads compact media state.",
    entities: [
      {
        entity_kind: "media_file",
        action: "read",
        summary: "Media state is read.",
      },
    ],
    idempotent: true,
    ...overrides,
  };
}

function mutationDelta(overrides = {}) {
  return {
    kind: "mutation",
    summary: "Updates one bounded media state surface.",
    entities: [
      {
        entity_kind: "media_source",
        action: "update",
        summary: "Media source state is updated.",
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
