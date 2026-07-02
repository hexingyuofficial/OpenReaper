import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE1A_RENDER_TEMPLATE_IDS = Object.freeze({
  readSettings: "template.render.read_settings",
  resolveBounds: "template.render.resolve_bounds",
  previewTargets: "template.render.preview_targets",
  readRegionMatrix: "template.render.read_region_matrix",
  outputFileMetadata: "template.render.output_file_metadata",
});

export const WAVE1A_RENDER_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_RENDER_TEMPLATE_IDS.readSettings,
    title: "Read render settings",
    summary: "Read compact project render settings without mutating sticky render state.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "render_setting",
    tags: ["render", "settings", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "render.settings.read",
      capability: "render.settings.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema(),
    outputSchema: objectSchema({
      bounds_flag: { type: "integer" },
      start_position_seconds: { type: "number" },
      end_position_seconds: { type: "number" },
      sample_rate: { type: "integer" },
      channel_count: { type: "integer" },
      output_directory: { type: "string" },
      filename_pattern: { type: "string" },
      format_fingerprint: { type: "string" },
      render_flags: { type: "array" },
    }, []),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads current render settings without changing project or filesystem state.",
      entities: [
        {
          entity_kind: "render_setting",
          action: "read",
          summary: "Current render settings are summarized.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_current_render_settings",
        summary: "Read the current project render settings.",
        input: {},
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_RENDER_TEMPLATE_IDS.resolveBounds,
    title: "Resolve render bounds",
    summary: "Resolve a render bounds request to compact concrete bounds without rendering.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "render_region",
    tags: ["render", "bounds", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "render.bounds.resolve",
      capability: "render.bounds.resolve",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      bounds_kind: {
        enum: [
          "entire_project",
          "time_selection",
          "custom",
          "region",
          "selected_project_regions",
        ],
      },
      start_position_seconds: { type: "number" },
      end_position_seconds: { type: "number" },
      label: { type: "string" },
    }, ["bounds_kind"]),
    outputSchema: objectSchema({
      resolved_kind: { type: "string" },
      start_position_seconds: { type: "number" },
      end_position_seconds: { type: "number" },
      duration_seconds: { type: "number" },
      label: { type: "string" },
    }, []),
    refs: refs({
      input: [
        ref("region_ref", "region", false, "Region ref used when bounds_kind is region."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Resolves render bounds without mutating transport, project, or render settings.",
      entities: [
        {
          entity_kind: "render_region",
          action: "read",
          summary: "Render bounds are resolved for later output work.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "resolve_custom_bounds",
        summary: "Resolve explicit custom render bounds.",
        input: {
          bounds_kind: "custom",
          start_position_seconds: 10,
          end_position_seconds: 14,
          label: "Chorus",
        },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_RENDER_TEMPLATE_IDS.previewTargets,
    title: "Preview render targets",
    summary: "Preview bounded render output targets without probing paths or starting a render.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "output_file",
    tags: ["render", "targets", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "render.targets.preview",
      capability: "render.targets.preview",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      output_directory: { type: "string" },
      filename_pattern: { type: "string" },
      bounds_kind: {
        enum: [
          "current_settings",
          "entire_project",
          "time_selection",
          "custom",
          "region",
          "selected_project_regions",
        ],
      },
      max_targets: { type: "integer" },
    }, []),
    outputSchema: objectSchema({
      targets: { type: "array" },
      target_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, []),
    refs: refs({
      input: [
        ref("region_ref", "region", false, "Optional region ref for region target preview."),
      ],
      output: [
        ref("target_file_refs", "file", false, "Predicted render output file refs."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads predicted render output targets without filesystem writes.",
      entities: [
        {
          entity_kind: "output_file",
          action: "read",
          summary: "Predicted output target metadata is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "preview_region_targets",
        summary: "Preview render targets for a region-style pattern.",
        input: {
          output_directory: "/Users/Shared/openreaper-renders",
          filename_pattern: "$region",
          bounds_kind: "region",
          max_targets: 10,
        },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_RENDER_TEMPLATE_IDS.readRegionMatrix,
    title: "Read region render matrix",
    summary: "Read the tracks configured in a region render matrix without changing it.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "render_matrix",
    tags: ["render", "matrix", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "render.region_matrix.read",
      capability: "render.region_matrix.read",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_master: { type: "boolean" },
      include_channel_flags: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      region_ref: { type: "string" },
      tracks: { type: "array" },
      track_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, []),
    refs: refs({
      input: [
        ref("region_ref", "region", true, "Region whose render matrix is read."),
      ],
      output: [
        ref("matrix_track_refs", "track", false, "Track refs configured for region rendering."),
      ],
    }),
    artifacts: artifacts(),
    expectedDelta: expectedDelta({
      kind: "read",
      summary: "Reads region render matrix track membership without mutating project state.",
      entities: [
        {
          entity_kind: "render_matrix",
          action: "read",
          summary: "Region render matrix entries are summarized.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_chorus_region_matrix",
        summary: "Read matrix entries for a region ref.",
        input: {
          include_master: true,
          include_channel_flags: true,
        },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: WAVE1A_RENDER_TEMPLATE_IDS.outputFileMetadata,
    title: "Read output file metadata",
    summary: "Read bounded metadata for a render-produced output artifact, not arbitrary files.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "output_file",
    tags: ["render", "artifact", "metadata"],
    bridge: bridge({
      operation_family: "artifact_metadata",
      operation_name: "render.output_file.metadata",
      capability: "render.output_file.metadata",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      include_wave_header: { type: "boolean" },
      include_sidecar_presence: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      output_artifact_ref: { type: "string" },
      exists: { type: "boolean" },
      size_bytes: { type: "integer" },
      modified_at: { type: "string" },
      extension: { type: "string" },
      wave_header: { type: "object" },
      sidecars: { type: "array" },
    }, []),
    refs: refs({
      input: [
        ref("output_artifact_ref", "artifact", true, "Render output artifact metadata ref."),
      ],
      output: [
        ref("output_file_ref", "file", false, "File ref described by the render artifact."),
      ],
    }),
    artifacts: artifacts({
      mode: "metadata",
      input: [
        artifact(
          "output_file_metadata",
          "render.output_file_metadata.v1",
          "render",
          "Metadata for a render-produced output file.",
        ),
      ],
    }),
    expectedDelta: expectedDelta({
      kind: "artifact",
      summary: "Reads bounded metadata for a render-produced output artifact.",
      entities: [
        {
          entity_kind: "output_file",
          action: "read",
          summary: "Render output file metadata is read.",
        },
      ],
      idempotent: true,
    }),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "read_render_output_metadata",
        summary: "Read metadata for a render output artifact ref.",
        input: {
          include_wave_header: true,
          include_sidecar_presence: true,
        },
      },
    ],
  },
]);

export function createWave1aRenderTemplates() {
  return cloneJson(WAVE1A_RENDER_TEMPLATES);
}

function bridge(overrides = {}) {
  return {
    operation_family: "query_state",
    operation_name: "render.settings.read",
    capability: "render.settings.read",
    idempotency: "none",
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

function artifacts(overrides = {}) {
  return {
    mode: "none",
    input: [],
    output: [],
    ...overrides,
  };
}

function artifact(name, schema, owner_pack, summary) {
  return {
    name,
    schema,
    owner_pack,
    summary,
  };
}

function expectedDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Template reads bounded render state.",
    entities: [],
    idempotent: true,
    ...overrides,
  };
}

function verification(overrides = {}) {
  return {
    mode: "none",
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
