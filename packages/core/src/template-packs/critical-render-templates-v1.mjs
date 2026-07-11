import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_RENDER_TEMPLATE_IDS = Object.freeze([
  "template.render.render_region_wav",
  "template.render.render_targets",
  "template.render.render_item",
  "template.render.render_selected_item",
  "template.render.render_track_item",
  "template.render.render_selected_tracks",
  "template.render.render_ogg",
  "template.render.render_mp3",
  "template.render.render_flac",
  "template.render.render_aiff",
  "template.render.render_m4a",
  "template.render.render_opus",
  "template.render.set_render_format",
  "template.render.set_render_sample_rate",
  "template.render.set_ogg_quality_or_compression",
  "template.render.set_mp3_bitrate_or_quality",
  "template.render.set_flac_compression",
  "template.render.set_aiff_bit_depth",
  "template.render.render_region_with_track_filter",
  "template.render.output_absolute_path",
]);

export const CRITICAL_RENDER_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.render.render_region_wav",
    title: "Render region WAV",
    summary: "Start one bounded region-to-WAV render job and return compact evidence handles.",
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "render_job",
    tags: ["render", "region", "wav", "job", "artifact"],
    bridge: {
      operation_family: "run_job",
      operation_name: "render.region_wav",
      capability: "render.region_wav",
      idempotency: "required",
      timeout_ms: 300_000,
    },
    inputSchema: objectSchema({
      format: { const: "wav" },
      output_policy: { enum: ["openreaper_managed_render_root"] },
      collision_policy: { enum: ["fail_if_exists", "reuse_idempotent_match"] },
      sample_rate_hz: { enum: [44100, 48000] },
      bit_depth: { enum: [16, 24] },
      channel_count: { enum: [1, 2] },
      include_sidecar_manifest: { type: "boolean" },
    }, ["format", "output_policy", "collision_policy"]),
    outputSchema: objectSchema({
      job_ref: { type: "string" },
      output_artifact_ref: { type: "string" },
      evidence_artifact_ref: { type: "string" },
      format: { const: "wav" },
      output_policy: { type: "string" },
      collision_policy: { type: "string" },
      file_count: { type: "integer" },
      reused_existing: { type: "boolean" },
      truncated: { type: "boolean" },
    }, ["job_ref", "output_artifact_ref", "evidence_artifact_ref", "format"]),
    refs: {
      input: [
        {
          name: "region_ref",
          kind: "region",
          required: true,
          summary: "Existing project region to render as one bounded WAV output.",
        },
      ],
      output: [
        {
          name: "job_ref",
          kind: "job",
          required: true,
          summary: "Render job evidence ref for the bounded WAV render.",
        },
        {
          name: "output_artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Metadata artifact ref for the rendered WAV output.",
        },
        {
          name: "evidence_artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Artifact ref containing bounded render job evidence.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        {
          name: "region_wav_output",
          schema: "render.region_wav_output.v1",
          owner_pack: "render",
          summary: "Metadata for one rendered region WAV output; no audio payload.",
        },
        {
          name: "render_job_evidence",
          schema: "render.render_job_evidence.v1",
          owner_pack: "render",
          summary: "Bounded render job evidence and verification metadata.",
        },
      ],
    },
    expectedDelta: {
      kind: "job",
      summary: "Starts one managed region WAV render job and emits compact output evidence refs.",
      entities: [
        {
          entity_kind: "render_job",
          action: "start_job",
          summary: "A bounded render job starts for the supplied region ref.",
        },
        {
          entity_kind: "output_file",
          action: "create",
          summary: "One managed WAV output is created or idempotently reused.",
        },
        {
          entity_kind: "render_artifact",
          action: "emit",
          summary: "Output metadata and job evidence artifact refs are emitted.",
        },
      ],
      idempotent: true,
    },
    verification: {
      mode: "required",
      checks: [
        {
          name: "region_resolved",
          kind: "state_delta",
          summary: "The supplied region ref resolves before rendering.",
        },
        {
          name: "render_job_completed",
          kind: "job_state",
          summary: "The render job reaches a terminal successful state.",
        },
        {
          name: "output_artifact_created",
          kind: "artifact_metadata",
          summary: "A render-owned output artifact ref is returned.",
        },
        {
          name: "wav_output_nonempty",
          kind: "file_metadata",
          summary: "The rendered WAV output is present and non-empty.",
        },
        {
          name: "wav_container_verified",
          kind: "file_metadata",
          summary: "Output metadata reports the expected WAV container.",
        },
        {
          name: "no_unrelated_overwrite",
          kind: "artifact_metadata",
          summary: "Collision policy prevents overwriting unrelated outputs.",
        },
      ],
    },
    examples: [
      {
        name: "render_managed_region_wav",
        summary: "Render an existing region to a managed WAV output.",
        input: {
          format: "wav",
          output_policy: "openreaper_managed_render_root",
          collision_policy: "fail_if_exists",
          sample_rate_hz: 48000,
          bit_depth: 24,
          channel_count: 2,
          include_sidecar_manifest: true,
        },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.render.render_targets",
    title: "Render bounded targets",
    summary: "Render bounded project, region, item, or track targets through managed REAPER project render settings.",
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "render_job.targets",
    tags: ["render", "project", "targets", "job", "artifact"],
    bridge: {
      operation_family: "run_job",
      operation_name: "render.targets",
      capability: "render.targets",
      idempotency: "none",
      timeout_ms: 300_000,
    },
    inputSchema: objectSchema({
      target_kind: { enum: ["whole_project", "time_selection", "regions", "selected_items", "explicit_items", "selected_tracks", "explicit_tracks"] },
      format: { enum: ["wav", "ogg"] },
      output_policy: { const: "openreaper_managed_render_root" },
      collision_policy: { const: "fail_if_exists" },
      sample_rate_hz: { enum: [44100, 48000] },
      channel_count: { enum: [1, 2] },
      wav_bit_depth: { enum: [16, 24] },
      ogg_quality: { enum: [0.3, 0.5, 0.6, 0.8, 1.0] },
      max_targets: { type: "integer" },
    }, ["target_kind", "format", "output_policy", "collision_policy", "sample_rate_hz", "channel_count", "max_targets"]),
    outputSchema: objectSchema({
      job_ref: { type: "string" },
      output_artifact_ref: { type: "string" },
      evidence_artifact_ref: { type: "string" },
      format: { type: "string" },
      output_policy: { const: "openreaper_managed_render_root" },
      collision_policy: { const: "fail_if_exists" },
      file_count: { type: "integer" },
      outputs: { type: "array" },
      truncated: { type: "boolean" },
    }, ["job_ref", "output_artifact_ref", "evidence_artifact_ref", "format", "output_policy", "collision_policy", "file_count", "outputs", "truncated"]),
    refs: {
      input: [
        ref("region_refs", "region", false, "Explicit region refs when target_kind is regions."),
        ref("item_refs", "item", false, "Explicit item refs when target_kind is explicit_items."),
        ref("track_refs", "track", false, "Explicit track refs when target_kind is explicit_tracks."),
      ],
      output: [
        ref("job_ref", "job", true, "Render job evidence ref for the bounded target render."),
        ref("output_artifact_ref", "artifact", true, "Manifest artifact ref for bounded target output metadata."),
        ref("evidence_artifact_ref", "artifact", true, "Evidence artifact ref for render settings and verification."),
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        artifact("render_targets_manifest", "render.targets_manifest.v1", "render", "Bounded metadata for up to sixteen managed render targets."),
        artifact("render_targets_evidence", "render.targets_evidence.v1", "render", "Bounded project-render settings, restoration, and output verification evidence."),
      ],
    },
    expectedDelta: {
      kind: "job",
      summary: "Renders one to sixteen bounded targets through REAPER project render settings and restores prior state.",
      entities: [
        { entity_kind: "render_job", action: "start_job", summary: "A bounded project render job runs for each resolved target." },
        { entity_kind: "output_file", action: "create", summary: "Managed WAV or OGG files are created only after all expected outputs preflight cleanly." },
        { entity_kind: "render_artifact", action: "emit", summary: "Manifest and evidence artifact refs are emitted after output verification." },
      ],
      idempotent: false,
    },
    verification: requiredVerification([
      check("target_refs_resolved", "state_delta", "Target kind has exactly its allowed refs and explicit refs resolve."),
      check("render_action_completed", "job_state", "The audited REAPER project-render action completes for every target."),
      check("output_files_verified", "file_metadata", "Every output exists, is non-empty, and has the expected WAV or OGG header."),
      check("managed_output_policy", "artifact_metadata", "Every output remains inside the managed render root."),
      check("render_state_restored", "state_delta", "Render settings and track/item selections restore after success or failure."),
      check("collision_preflight", "artifact_metadata", "All expected output paths are checked before the first render begins."),
    ]),
    examples: [
      {
        name: "render_whole_project_wav",
        summary: "Render the whole project once to a managed 48 kHz stereo WAV output.",
        input: { target_kind: "whole_project", format: "wav", output_policy: "openreaper_managed_render_root", collision_policy: "fail_if_exists", sample_rate_hz: 48000, channel_count: 2, wav_bit_depth: 24, max_targets: 1 },
      },
      {
        name: "render_explicit_regions_ogg",
        summary: "Render explicit region refs as individually named managed OGG outputs.",
        input: { target_kind: "regions", format: "ogg", output_policy: "openreaper_managed_render_root", collision_policy: "fail_if_exists", sample_rate_hz: 44100, channel_count: 2, ogg_quality: 0.6, max_targets: 16 },
      },
    ],
  },
  renderJobDescriptor({
    id: "template.render.render_item",
    title: "Render item",
    summary: "Start one managed render job for a single resolved item and return compact evidence handles.",
    entity_kind: "render_job.item",
    tags: ["render", "item", "job", "artifact"],
    operation_name: "render.item",
    capability: "render.item",
    inputSchema: renderOutputSchema({
      format: { enum: ["wav", "flac", "aiff"] },
    }),
    refs: jobRefs({
      input: [
        ref("item_ref", "item", true, "Single existing item to render through the managed render root."),
      ],
    }),
    expectedDelta: renderJobDelta("Starts one managed item render job and emits compact output evidence refs."),
    examples: [
      {
        name: "render_one_item",
        summary: "Render a resolved item to a managed WAV output.",
        input: renderOutputExample({ format: "wav" }),
      },
    ],
  }),
  renderJobDescriptor({
    id: "template.render.render_selected_item",
    title: "Render selected item",
    summary: "Start one managed render job for exactly one selected item and return compact evidence handles.",
    entity_kind: "render_job.item_selection",
    tags: ["render", "item", "selection", "job", "artifact"],
    operation_name: "render.selected_item",
    capability: "render.selected_item",
    inputSchema: renderOutputSchema({
      selection_policy: { const: "exactly_one_selected_item" },
      format: { enum: ["wav", "flac", "aiff"] },
    }),
    refs: jobRefs(),
    expectedDelta: renderJobDelta("Starts one managed selected-item render job when exactly one item is selected."),
    examples: [
      {
        name: "render_selected_item",
        summary: "Render exactly one selected item to a managed WAV output.",
        input: renderOutputExample({
          selection_policy: "exactly_one_selected_item",
          format: "wav",
        }),
      },
    ],
  }),
  renderJobDescriptor({
    id: "template.render.render_track_item",
    title: "Render track item",
    summary: "Start one managed render job for one resolved item constrained to one resolved track.",
    entity_kind: "render_job.track_item",
    tags: ["render", "track", "item", "job", "artifact"],
    operation_name: "render.track_item",
    capability: "render.track_item",
    inputSchema: renderOutputSchema({
      format: { enum: ["wav", "flac", "aiff"] },
    }),
    refs: jobRefs({
      input: [
        ref("track_ref", "track", true, "Track expected to contain the item."),
        ref("item_ref", "item", true, "Item on the resolved track to render."),
      ],
    }),
    expectedDelta: renderJobDelta("Starts one managed render job for an item after track/item ref validation."),
    examples: [
      {
        name: "render_item_on_track",
        summary: "Render one item known to belong to a resolved track.",
        input: renderOutputExample({ format: "wav" }),
      },
    ],
  }),
  renderJobDescriptor({
    id: "template.render.render_selected_tracks",
    title: "Render selected tracks",
    summary: "Start one managed render job for the current selected-track set and return compact evidence handles.",
    entity_kind: "render_job.track_selection",
    tags: ["render", "tracks", "selection", "job", "artifact"],
    operation_name: "render.selected_tracks",
    capability: "render.selected_tracks",
    inputSchema: renderOutputSchema({
      selection_policy: { const: "one_or_more_selected_tracks" },
      format: { enum: ["wav", "flac", "aiff"] },
      stem_mode: { enum: ["mixdown", "one_file_per_track"] },
    }),
    refs: jobRefs(),
    expectedDelta: renderJobDelta("Starts one managed selected-tracks render job for the current track selection."),
    examples: [
      {
        name: "render_selected_tracks_mixdown",
        summary: "Render selected tracks as one managed WAV mixdown.",
        input: renderOutputExample({
          selection_policy: "one_or_more_selected_tracks",
          format: "wav",
          stem_mode: "mixdown",
        }),
      },
    ],
  }),
  ...[
    ["ogg", "OGG", "ogg_quality", { type: "number" }],
    ["mp3", "MP3", "mp3_bitrate_kbps", { enum: [128, 192, 256, 320] }],
    ["flac", "FLAC", "flac_compression", { enum: [0, 1, 2, 3, 4, 5, 6, 7, 8] }],
    ["aiff", "AIFF", "aiff_bit_depth", { enum: [16, 24, 32] }],
    ["m4a", "M4A", "m4a_bitrate_kbps", { enum: [128, 192, 256, 320] }],
    ["opus", "Opus", "opus_bitrate_kbps", { enum: [96, 128, 160, 192, 256] }],
  ].map(([format, label, qualityField, qualitySchema]) =>
    renderJobDescriptor({
      id: `template.render.render_${format}`,
      title: `Render ${label}`,
      summary: `Start one managed ${label} render job and return compact evidence handles without claiming live codec availability.`,
      entity_kind: "render_job.format",
      tags: ["render", format, "format", "job", "artifact"],
      operation_name: `render.${format}`,
      capability: `render.${format}`,
      inputSchema: renderOutputSchema({
        format: { const: format },
        [qualityField]: qualitySchema,
      }),
      refs: jobRefs(),
      expectedDelta: renderJobDelta(`Starts one managed ${label} render job and emits compact output evidence refs.`),
      examples: [
        {
          name: `render_${format}_managed_output`,
          summary: `Render the current managed bounds to ${label}.`,
          input: renderOutputExample({ format, [qualityField]: qualityExample(format) }),
        },
      ],
    }),
  ),
  settingDescriptor({
    id: "template.render.set_render_format",
    title: "Set render format",
    summary: "Set the project render format intent to one supported descriptor-level format.",
    tags: ["render", "format", "settings", "write"],
    operation_name: "render.format.set",
    capability: "render.format.set",
    inputSchema: objectSchema({
      format: { enum: ["wav", "ogg", "mp3", "flac", "aiff", "m4a", "opus"] },
    }, ["format"]),
    outputSchema: objectSchema({
      format: { type: "string" },
      previous_format: { type: "string" },
      changed: { type: "boolean" },
    }, ["format", "changed"]),
    expectedDelta: settingDelta("Render format intent is set in project render settings."),
    examples: [
      {
        name: "set_render_format_flac",
        summary: "Set render format intent to FLAC.",
        input: { format: "flac" },
      },
    ],
  }),
  settingDescriptor({
    id: "template.render.set_render_sample_rate",
    title: "Set render sample rate",
    summary: "Set the project render sample-rate intent with descriptor-level validation.",
    tags: ["render", "sample_rate", "settings", "write"],
    operation_name: "render.sample_rate.set",
    capability: "render.sample_rate.set",
    inputSchema: objectSchema({
      sample_rate_hz: { enum: [44100, 48000, 88200, 96000] },
      require_readback_match: { type: "boolean" },
    }, ["sample_rate_hz"]),
    outputSchema: objectSchema({
      sample_rate_hz: { type: "integer" },
      previous_sample_rate_hz: { type: "integer" },
      changed: { type: "boolean" },
      readback_matched: { type: "boolean" },
    }, ["sample_rate_hz", "changed"]),
    expectedDelta: settingDelta("Render sample-rate intent is set in project render settings."),
    verification: requiredVerification([
      check("render_sample_rate_readback", "state_delta", "Render settings readback reports the requested sample rate."),
    ]),
    examples: [
      {
        name: "set_render_sample_rate_44100",
        summary: "Set render sample rate intent to 44.1 kHz.",
        input: { sample_rate_hz: 44100, require_readback_match: true },
      },
    ],
  }),
  codecSettingDescriptor("template.render.set_ogg_quality_or_compression", "ogg", "OGG quality", "ogg_quality", {
    type: "number",
  }, 0.6),
  codecSettingDescriptor("template.render.set_mp3_bitrate_or_quality", "mp3", "MP3 bitrate", "mp3_bitrate_kbps", {
    enum: [128, 192, 256, 320],
  }, 320),
  codecSettingDescriptor("template.render.set_flac_compression", "flac", "FLAC compression", "flac_compression", {
    enum: [0, 1, 2, 3, 4, 5, 6, 7, 8],
  }, 5),
  codecSettingDescriptor("template.render.set_aiff_bit_depth", "aiff", "AIFF bit depth", "aiff_bit_depth", {
    enum: [16, 24, 32],
  }, 24),
  renderJobDescriptor({
    id: "template.render.render_region_with_track_filter",
    title: "Render region with track filter",
    summary: "Start one managed region render job constrained to explicit included track refs.",
    entity_kind: "render_job.region_track_filter",
    tags: ["render", "region", "tracks", "filter", "job", "artifact"],
    operation_name: "render.region_track_filter",
    capability: "render.region_track_filter",
    inputSchema: renderOutputSchema({
      format: { enum: ["wav", "flac", "aiff"] },
      track_filter_mode: { const: "include_track_refs" },
    }),
    refs: jobRefs({
      input: [
        ref("region_ref", "region", true, "Existing region to render."),
        ref("track_refs", "track", true, "Included track refs for the region render."),
      ],
    }),
    expectedDelta: renderJobDelta("Starts one managed region render job constrained to included track refs."),
    examples: [
      {
        name: "render_region_track_filter",
        summary: "Render a region while including only resolved track refs.",
        input: renderOutputExample({
          format: "wav",
          track_filter_mode: "include_track_refs",
        }),
      },
    ],
  }),
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.render.output_absolute_path",
    title: "Read output absolute path",
    summary: "Read bounded absolute-path metadata for a render-owned output artifact.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "output_file",
    tags: ["render", "output", "path", "metadata", "read"],
    bridge: {
      operation_family: "artifact_metadata",
      operation_name: "render.output.absolute_path",
      capability: "render.output.absolute_path",
      idempotency: "none",
      timeout_ms: 5_000,
    },
    inputSchema: objectSchema({
      require_exists: { type: "boolean" },
      include_parent_directory: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      output_artifact_ref: { type: "string" },
      absolute_path: { type: "string" },
      parent_directory: { type: "string" },
      exists: { type: "boolean" },
      managed_root: { type: "string" },
    }, ["output_artifact_ref", "absolute_path"]),
    refs: {
      input: [
        ref("output_artifact_ref", "artifact", true, "Render-owned output artifact ref to resolve."),
      ],
      output: [
        ref("output_file_ref", "file", false, "File ref for the absolute output path."),
      ],
    },
    artifacts: {
      mode: "metadata",
      input: [
        artifact("output_absolute_path", "render.output_absolute_path.v1", "render", "Absolute path metadata for a render-owned output artifact."),
      ],
      output: [],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Reads bounded absolute-path metadata for a render-produced artifact.",
      entities: [
        {
          entity_kind: "output_file",
          action: "read",
          summary: "The managed absolute path for a render output is read.",
        },
      ],
      idempotent: true,
    },
    verification: {
      mode: "none",
      checks: [],
    },
    examples: [
      {
        name: "read_render_output_absolute_path",
        summary: "Resolve a render output artifact to a managed absolute path.",
        input: { require_exists: true, include_parent_directory: true },
      },
    ],
  },
]);

export function createCriticalRenderTemplates() {
  return cloneJson(CRITICAL_RENDER_TEMPLATES);
}

function objectSchema(properties = {}, required = Object.keys(properties)) {
  return {
    type: "object",
    properties,
    required,
    additionalProperties: false,
  };
}

function renderJobDescriptor({
  id,
  title,
  summary,
  entity_kind,
  tags,
  operation_name,
  capability,
  inputSchema,
  refs,
  expectedDelta,
  examples,
}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id,
    title,
    summary,
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind,
    tags,
    bridge: {
      operation_family: "run_job",
      operation_name,
      capability,
      idempotency: "required",
      timeout_ms: 300_000,
    },
    inputSchema,
    outputSchema: objectSchema({
      job_ref: { type: "string" },
      output_artifact_ref: { type: "string" },
      evidence_artifact_ref: { type: "string" },
      format: { type: "string" },
      output_policy: { type: "string" },
      file_count: { type: "integer" },
      reused_existing: { type: "boolean" },
      truncated: { type: "boolean" },
    }, ["job_ref", "output_artifact_ref", "evidence_artifact_ref", "format"]),
    refs,
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        artifact("render_output", "render.managed_output.v1", "render", "Metadata for one managed render output; no media payload."),
        artifact("render_job_evidence", "render.render_job_evidence.v1", "render", "Bounded render job evidence and verification metadata."),
      ],
    },
    expectedDelta,
    verification: requiredVerification([
      check("render_job_completed", "job_state", "The render job reaches a terminal successful state."),
      check("output_artifact_created", "artifact_metadata", "A render-owned output artifact ref is returned."),
      check("managed_output_policy", "artifact_metadata", "The output remains inside the managed render root."),
    ]),
    examples,
  };
}

function settingDescriptor({
  id,
  title,
  summary,
  tags,
  operation_name,
  capability,
  inputSchema,
  outputSchema,
  expectedDelta,
  verification = requiredVerification([
    check("render_setting_readback", "state_delta", "Render settings readback matches the requested value."),
  ]),
  examples,
}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id,
    title,
    summary,
    pack: "render",
    lifecycle: "experimental",
    risk: "write",
    entity_kind: "render_setting",
    tags,
    bridge: {
      operation_family: "run_command",
      operation_name,
      capability,
      idempotency: "supported",
      timeout_ms: 5_000,
    },
    inputSchema,
    outputSchema,
    refs: { input: [], output: [] },
    artifacts: { mode: "none", input: [], output: [] },
    expectedDelta,
    verification,
    examples,
  };
}

function codecSettingDescriptor(id, format, label, field, schema, exampleValue) {
  return settingDescriptor({
    id,
    title: `Set ${label}`,
    summary: `Set descriptor-level ${label} metadata for future managed renders without claiming live codec support.`,
    tags: ["render", "codec", "settings", "write"],
    operation_name: `render.${field}.set`,
    capability: `render.${field}.set`,
    inputSchema: objectSchema({
      format: { const: format },
      [field]: schema,
    }, ["format", field]),
    outputSchema: objectSchema({
      format: { type: "string" },
      [field]: { type: "number" },
      changed: { type: "boolean" },
    }, ["format", field, "changed"]),
    expectedDelta: settingDelta(`${label} metadata is set in project render settings.`),
    examples: [
      {
        name: `set_${field}`,
        summary: `Set ${label} metadata for ${format.toUpperCase()} renders.`,
        input: { format, [field]: exampleValue },
      },
    ],
  });
}

function renderOutputSchema(properties = {}) {
  return objectSchema({
    output_policy: { enum: ["openreaper_managed_render_root"] },
    collision_policy: { enum: ["fail_if_exists", "reuse_idempotent_match"] },
    bounds_kind: { enum: ["current_settings", "time_selection", "custom", "region"] },
    sample_rate_hz: { enum: [44100, 48000, 88200, 96000] },
    channel_count: { enum: [1, 2] },
    include_sidecar_manifest: { type: "boolean" },
    ...properties,
  }, ["output_policy", "collision_policy"]);
}

function renderOutputExample(overrides = {}) {
  return {
    output_policy: "openreaper_managed_render_root",
    collision_policy: "fail_if_exists",
    bounds_kind: "current_settings",
    sample_rate_hz: 48000,
    channel_count: 2,
    include_sidecar_manifest: true,
    ...overrides,
  };
}

function jobRefs(overrides = {}) {
  return {
    input: [],
    output: [
      ref("job_ref", "job", true, "Render job evidence ref for the managed render."),
      ref("output_artifact_ref", "artifact", true, "Metadata artifact ref for the managed render output."),
      ref("evidence_artifact_ref", "artifact", true, "Artifact ref containing bounded render job evidence."),
    ],
    ...overrides,
  };
}

function renderJobDelta(summary) {
  return {
    kind: "job",
    summary,
    entities: [
      {
        entity_kind: "render_job",
        action: "start_job",
        summary: "A bounded managed render job starts.",
      },
      {
        entity_kind: "output_file",
        action: "create",
        summary: "One managed output is created or idempotently reused.",
      },
      {
        entity_kind: "render_artifact",
        action: "emit",
        summary: "Output metadata and job evidence artifact refs are emitted.",
      },
    ],
    idempotent: true,
  };
}

function settingDelta(summary) {
  return {
    kind: "mutation",
    summary,
    entities: [
      {
        entity_kind: "render_setting",
        action: "update",
        summary,
      },
    ],
    idempotent: true,
  };
}

function requiredVerification(checks) {
  return {
    mode: "required",
    checks,
  };
}

function check(name, kind, summary) {
  return { name, kind, summary };
}

function ref(name, kind, required, summary) {
  return {
    name,
    kind,
    required,
    summary,
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

function qualityExample(format) {
  return {
    ogg: 0.6,
    mp3: 320,
    flac: 5,
    aiff: 24,
    m4a: 256,
    opus: 160,
  }[format];
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
