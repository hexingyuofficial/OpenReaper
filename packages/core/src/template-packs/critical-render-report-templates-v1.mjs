import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_RENDER_REPORT_TEMPLATE_IDS = Object.freeze([
  "template.render.create_delivery_report",
]);

export const CRITICAL_RENDER_REPORT_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.render.create_delivery_report",
    title: "Create delivery report",
    summary: "Create a bounded render delivery report from output metadata and job evidence.",
    pack: "render",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "delivery_report",
    tags: ["render", "delivery", "report", "artifact"],
    bridge: {
      operation_family: "run_job",
      operation_name: "render.delivery_report.create",
      capability: "render.delivery_report.create",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      max_report_rows: { type: "integer" },
      include_output_metadata: { type: "boolean" },
      include_job_evidence: { type: "boolean" },
      include_region_summary: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      artifact_ref: { type: "string" },
      schema: { const: "render.delivery_report.v1" },
      output_artifact_count: { type: "integer" },
      job_evidence_count: { type: "integer" },
      region_count: { type: "integer" },
      nonempty_output_count: { type: "integer" },
      report_row_count: { type: "integer" },
      issue_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["artifact_ref", "schema"]),
    refs: refs({
      input: [
        ref(
          "output_artifact_refs",
          "artifact",
          true,
          "Render output artifact refs whose bounded metadata is summarized.",
        ),
        ref(
          "render_job_evidence_ref",
          "artifact",
          true,
          "Render job evidence artifact ref consumed for delivery reporting.",
        ),
        ref("region_ref", "region", false, "Optional source region ref for report context."),
        ref("job_ref", "job", false, "Optional render job ref for report context."),
      ],
      output: [
        ref("artifact_ref", "artifact", true, "Render-owned delivery report artifact ref."),
      ],
    }),
    artifacts: {
      mode: "produces",
      input: [
        artifact(
          "region_wav_output",
          "render.region_wav_output.v1",
          "Metadata for managed render outputs consumed by the report.",
        ),
        artifact(
          "render_job_evidence",
          "render.render_job_evidence.v1",
          "Bounded render job evidence consumed by the report.",
        ),
      ],
      output: [
        artifact(
          "delivery_report",
          "render.delivery_report.v1",
          "Bounded render delivery report artifact with no transfer action.",
        ),
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Emits one bounded delivery report artifact from render-owned evidence refs.",
      entities: [
        {
          entity_kind: "delivery_report",
          action: "emit",
          summary: "A render-owned delivery report artifact ref is emitted.",
        },
      ],
      idempotent: false,
    },
    verification: {
      mode: "none",
      checks: [],
    },
    examples: [
      {
        name: "create_delivery_report",
        summary: "Create a bounded report from render output and job evidence artifact refs.",
        input: {
          max_report_rows: 12,
          include_output_metadata: true,
          include_job_evidence: true,
          include_region_summary: true,
        },
      },
    ],
  },
]);

export function createCriticalRenderReportTemplates() {
  return cloneJson(CRITICAL_RENDER_REPORT_TEMPLATES);
}

function refs(options = {}) {
  return {
    input: options.input ?? [],
    output: options.output ?? [],
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

function artifact(name, schema, summary) {
  return {
    name,
    schema,
    owner_pack: "render",
    summary,
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

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
