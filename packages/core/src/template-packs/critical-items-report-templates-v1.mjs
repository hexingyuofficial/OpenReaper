import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const CRITICAL_ITEMS_REPORT_TEMPLATE_IDS = Object.freeze([
  "template.items.create_layer_report",
]);

export const CRITICAL_ITEMS_REPORT_TEMPLATES = deepFreeze([
  {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.items.create_layer_report",
    title: "Create layer report",
    summary: "Create a bounded item-layer report from evidence handles and emit a canonical items artifact.",
    pack: "items",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "item_layer_report",
    tags: ["items", "item", "layer", "report", "artifact"],
    bridge: {
      operation_family: "run_job",
      operation_name: "items.create_layer_report",
      capability: "items.create_layer_report",
      idempotency: "none",
      timeout_ms: 120_000,
    },
    inputSchema: objectSchema({
      max_report_rows: { type: "integer" },
      include_track_facts: { type: "boolean" },
      include_color_facts: { type: "boolean" },
      include_item_samples: { type: "boolean" },
    }, []),
    outputSchema: objectSchema({
      artifact_ref: { type: "string" },
      schema: { const: "items.layer_report.v1" },
      evidence_item_count: { type: "integer" },
      evidence_track_count: { type: "integer" },
      report_row_count: { type: "integer" },
      truncated: { type: "boolean" },
    }, ["artifact_ref", "schema"]),
    refs: {
      input: [
        {
          name: "layer_evidence_artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Canonical items.layer_evidence.v1 artifact ref with bounded item and track evidence.",
        },
      ],
      output: [
        {
          name: "artifact_ref",
          kind: "artifact",
          required: true,
          summary: "Canonical items.layer_report.v1 artifact ref for bounded report readback.",
        },
      ],
    },
    artifacts: {
      mode: "produces",
      input: [
        {
          name: "layer_evidence",
          schema: "items.layer_evidence.v1",
          owner_pack: "items",
          summary: "Bounded item and track evidence consumed for report generation.",
        },
      ],
      output: [
        {
          name: "layer_report",
          schema: "items.layer_report.v1",
          owner_pack: "items",
          summary: "Bounded item-layer report artifact; no role assignment payload.",
        },
      ],
    },
    expectedDelta: {
      kind: "artifact",
      summary: "Emits a bounded item-layer report artifact without moving, editing, or assigning items.",
      entities: [
        {
          entity_kind: "item_layer_report",
          action: "emit",
          summary: "Item-layer report artifact is produced from supplied evidence.",
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
        name: "create_layer_report",
        summary: "Create a bounded report from an item-layer evidence artifact.",
        input: {
          max_report_rows: 24,
          include_track_facts: true,
          include_color_facts: true,
          include_item_samples: true,
        },
      },
    ],
  },
]);

export function createCriticalItemsReportTemplates() {
  return cloneJson(CRITICAL_ITEMS_REPORT_TEMPLATES);
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
