import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_PROJECT_REPORT_TEMPLATE_IDS = Object.freeze([
  "template.project.create_cleanup_report",
]);

export const CRITICAL_PROJECT_REPORT_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.project.create_cleanup_report",
    title: "Create cleanup report",
    summary: "Create a bounded project cleanup report from project-only evidence and emit a project artifact ref.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "cleanup_report",
    tags: ["project", "cleanup", "report", "artifact"],
    bridge: {
      operation_family: "run_job",
      operation_name: "project.create_cleanup_report",
      capability: "project.create_cleanup_report",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      max_report_rows: { type: "integer" },
      marker_region_limit: { type: "integer" },
      tempo_marker_limit: { type: "integer" },
      include_markers: { type: "boolean" },
      include_regions: { type: "boolean" },
      include_metadata: { type: "boolean" },
      include_tempo: { type: "boolean" },
      include_project_fingerprint: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      artifact_ref: { type: "string" },
      schema: { const: "project.cleanup_report.v1" },
      evidence_family_count: { type: "integer" },
      report_row_count: { type: "integer" },
      marker_count: { type: "integer" },
      region_count: { type: "integer" },
      metadata_field_count: { type: "integer" },
      tempo_marker_count: { type: "integer" },
      project_fingerprint: { type: "string" },
      truncated: { type: "boolean" },
    }, ["artifact_ref", "schema", "evidence_family_count", "report_row_count", "truncated"]),
    refs: {
      input: [
        {
          name: "project_ref",
          kind: "project",
          required: false,
          summary: "Project ref to inspect; defaults to the active project.",
        },
      ],
      output: [
        {
          name: "artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Project-owned artifact ref for the bounded cleanup report.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        {
          name: "cleanup_report",
          schema: "project.cleanup_report.v1",
          owner_pack: "project",
          summary: "Bounded project cleanup report artifact.",
        },
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Emits a project cleanup report artifact without mutating project data or choosing policy.",
      entities: [
        {
          entity_kind: "cleanup_report",
          action: "emit",
          summary: "Project cleanup report artifact is produced.",
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
        name: "create_cleanup_report",
        summary: "Create a bounded cleanup report from active-project evidence.",
        input: {},
      },
      {
        name: "create_cleanup_report_limited",
        summary: "Create a cleanup report with explicit row and evidence limits.",
        input: {
          max_report_rows: 32,
          marker_region_limit: 64,
          tempo_marker_limit: 32,
          include_markers: true,
          include_regions: true,
          include_metadata: true,
          include_tempo: true,
          include_project_fingerprint: true,
        },
      },
    ],
  },
]);

export function createCriticalProjectReportTemplates() {
  return cloneJson(CRITICAL_PROJECT_REPORT_TEMPLATES);
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
