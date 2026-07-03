import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_RENDER_TEMPLATE_IDS = Object.freeze([
  "template.render.render_region_wav",
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
