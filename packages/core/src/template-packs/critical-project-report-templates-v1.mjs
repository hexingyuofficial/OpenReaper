import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_PROJECT_REPORT_TEMPLATE_IDS = Object.freeze([
  "template.project.create_cleanup_report",
  "template.project.create_project_map_snapshot",
  "template.project.create_observation_bundle",
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
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.project.create_project_map_snapshot",
    title: "Create project map snapshot",
    summary: "Create an artifact-backed page of the active project map for large-project reading.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "project_snapshot",
    tags: ["project", "snapshot", "map", "artifact", "large_project"],
    bridge: {
      operation_family: "run_job",
      operation_name: "project.create_project_map_snapshot",
      capability: "project.create_project_map_snapshot",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      max_tracks: { type: "integer" },
      max_items_per_track: { type: "integer" },
      max_selected_items: { type: "integer" },
      track_cursor: { type: "integer" },
      include_selected_items: { type: "boolean" },
      include_track_items: { type: "boolean" },
      previous_snapshot_ref: { type: "string" },
    }, []),
    outputSchema: objectSchema({
      artifact_ref: { type: "string" },
      schema: { const: "project.project_map_snapshot.v1" },
      project_ref: { type: "string" },
      track_count: { type: "integer" },
      item_count: { type: "integer" },
      track_cursor: { type: "integer" },
      returned_track_count: { type: "integer" },
      next_track_cursor: { type: "string" },
      selected_count: { type: "integer" },
      snapshot_token: { type: "string" },
      coverage_status: { type: "string" },
      diff_compared: { type: "boolean" },
      diff_changed_count: { type: "integer" },
      truncated: { type: "boolean" },
      bytes: { type: "integer" },
    }, ["artifact_ref", "schema", "project_ref", "track_count", "item_count", "track_cursor", "returned_track_count", "selected_count", "snapshot_token", "coverage_status", "diff_compared", "diff_changed_count", "truncated"]),
    refs: {
      input: [
        {
          name: "project_ref",
          kind: "project",
          required: false,
          summary: "Project ref to inspect; defaults to the active project.",
        },
        {
          name: "previous_snapshot_ref",
          kind: "artifact",
          required: false,
          summary: "Earlier project map snapshot artifact for compact diff counts.",
        },
      ],
      output: [
        {
          name: "artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Project-owned artifact ref for the paged project map snapshot.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        {
          name: "project_map_snapshot",
          schema: "project.project_map_snapshot.v1",
          owner_pack: "project",
          summary: "Artifact-backed project map page with compact coverage and diff facts.",
        },
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Emits a project map snapshot artifact without mutating project data.",
      entities: [
        {
          entity_kind: "project_snapshot",
          action: "emit",
          summary: "Project map snapshot artifact is produced.",
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
        name: "create_first_project_map_page",
        summary: "Create the first compact project map page.",
        input: {
          max_tracks: 16,
          max_items_per_track: 2,
          max_selected_items: 8,
          track_cursor: 0,
          include_selected_items: true,
          include_track_items: true,
        },
      },
      {
        name: "create_next_project_map_page_with_diff",
        summary: "Create a later page and compare counts against a previous snapshot artifact.",
        input: {
          track_cursor: 16,
          previous_snapshot_ref: "artifact:project:project_map_snapshot:art_20260703000000000_031_ab12cd",
        },
      },
    ],
  },
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.project.create_observation_bundle",
    title: "Create observation bundle",
    summary: "Create one compact artifact-backed observation bundle for a fast project starting read.",
    pack: "project",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "project_observation",
    tags: ["project", "observation", "snapshot", "artifact", "speed"],
    bridge: {
      operation_family: "run_job",
      operation_name: "project.create_observation_bundle",
      capability: "project.create_observation_bundle",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      max_tracks: { type: "integer" },
      max_items_per_track: { type: "integer" },
      max_selected_items: { type: "integer" },
      track_cursor: { type: "integer" },
      marker_region_limit: { type: "integer" },
      tempo_marker_limit: { type: "integer" },
      include_transport: { type: "boolean" },
      include_track_items: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      artifact_ref: { type: "string" },
      schema: { const: "project.observation_bundle.v1" },
      project_ref: { type: "string" },
      observed_family_count: { type: "integer" },
      track_count: { type: "integer" },
      item_count: { type: "integer" },
      marker_count: { type: "integer" },
      region_count: { type: "integer" },
      tempo_marker_count: { type: "integer" },
      selected_count: { type: "integer" },
      track_cursor: { type: "integer" },
      returned_track_count: { type: "integer" },
      next_track_cursor: { type: "string" },
      map_truncated: { type: "boolean" },
      transport_play_state: { type: "string" },
      suggested_next_step_count: { type: "integer" },
      bytes: { type: "integer" },
    }, ["artifact_ref", "schema", "project_ref", "observed_family_count", "track_count", "item_count", "marker_count", "region_count", "tempo_marker_count", "selected_count", "track_cursor", "returned_track_count", "map_truncated", "transport_play_state", "suggested_next_step_count"]),
    refs: {
      input: [
        {
          name: "project_ref",
          kind: "project",
          required: false,
          summary: "Project ref to observe; defaults to the active project.",
        },
      ],
      output: [
        {
          name: "artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Project-owned artifact ref for the combined observation bundle.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [],
      output: [
        {
          name: "observation_bundle",
          schema: "project.observation_bundle.v1",
          owner_pack: "project",
          summary: "Artifact-backed startup observation bundle with compact project facts.",
        },
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Emits a combined observation artifact without mutating project data.",
      entities: [
        {
          entity_kind: "project_observation",
          action: "emit",
          summary: "Project observation artifact is produced.",
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
        name: "create_fast_start_observation",
        summary: "Create one bounded starting observation for a real-user project.",
        input: {
          max_tracks: 16,
          max_items_per_track: 1,
          max_selected_items: 8,
          track_cursor: 0,
          marker_region_limit: 32,
          tempo_marker_limit: 16,
          include_transport: true,
          include_track_items: true,
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
