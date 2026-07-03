import { FOUNDATION_BRIDGE_REF_KINDS } from "../foundation-bridge-v1.mjs";
import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const WAVE3B_CORE_TEMPLATE_IDS = Object.freeze([
  "template.core.read_openreaper_status",
  "template.core.read_template_catalog_summary",
  "template.core.read_last_result",
]);

export const WAVE3B_CORE_TEMPLATES = deepFreeze([
  coreReadDescriptor({
    id: "template.core.read_openreaper_status",
    title: "Read OpenReaper status",
    summary: "Read compact OpenReaper contract, runtime, enabled-pack, and catalog status without logs or descriptors.",
    entity_kind: "core_state",
    tags: ["core", "status", "health"],
    operation_name: "openreaper.read_status",
    capability: "openreaper.read_status",
    inputProperties: {
      include_contracts: { type: "boolean" },
      include_pack_status: { type: "boolean" },
      include_catalog_status: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      status: { enum: ["ok", "degraded", "unknown"] },
      contracts: { type: "object" },
      bridge: { type: "object" },
      enabled_packs: { type: "array" },
      catalog: { type: "object" },
      warnings: { type: "array" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["status", "truncated"],
    expectedSummary: "Reads compact OpenReaper status without mutating runtime, project, or catalog state.",
    expectedEntitySummary: "OpenReaper core status is read.",
    examples: [
      {
        name: "read_status",
        summary: "Read compact OpenReaper status with catalog and pack status included.",
        input: {
          include_contracts: true,
          include_pack_status: true,
          include_catalog_status: true,
        },
      },
    ],
  }),
  coreReadDescriptor({
    id: "template.core.read_template_catalog_summary",
    title: "Read template catalog summary",
    summary: "Read aggregate template catalog counts by pack, lifecycle, risk, and entity kind without id discovery.",
    entity_kind: "core_state",
    tags: ["core", "catalog", "summary"],
    operation_name: "template_catalog.read_summary",
    capability: "template_catalog.read_summary",
    inputProperties: {
      pack: { type: "string" },
      include_lifecycle_counts: { type: "boolean" },
      include_risk_counts: { type: "boolean" },
      include_entity_kind_counts: { type: "boolean" },
    },
    requiredInput: [],
    outputProperties: {
      template_count: { type: "integer" },
      pack_count: { type: "integer" },
      by_pack: { type: "object" },
      by_lifecycle: { type: "object" },
      by_risk: { type: "object" },
      by_entity_kind: { type: "object" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["template_count", "truncated"],
    expectedSummary: "Reads aggregate template catalog status without returning descriptors or unbounded id lists.",
    expectedEntitySummary: "Template catalog aggregate status is read.",
    examples: [
      {
        name: "read_catalog_summary",
        summary: "Read aggregate catalog counts with lifecycle and risk counts.",
        input: {
          include_lifecycle_counts: true,
          include_risk_counts: true,
        },
      },
    ],
  }),
  coreReadDescriptor({
    id: "template.core.read_last_result",
    title: "Read last result",
    summary: "Read bounded owner/generation-scoped last-result metadata without changing last-result state.",
    entity_kind: "last_result",
    tags: ["core", "last_result", "state"],
    operation_name: "last_result.read",
    capability: "last_result.read",
    inputProperties: {
      kind: { enum: FOUNDATION_BRIDGE_REF_KINDS },
      limit: { type: "integer" },
    },
    requiredInput: [],
    outputProperties: {
      owner: { type: "string" },
      generation: { type: "integer" },
      updated: { type: "boolean" },
      refs: { type: "array" },
      truncated: { type: "boolean" },
    },
    requiredOutput: ["updated", "refs", "truncated"],
    expectedSummary: "Reads bounded last-result metadata without clearing, expanding, or mutating it.",
    expectedEntitySummary: "Owner/generation-scoped last-result metadata is read.",
    examples: [
      {
        name: "read_item_last_result",
        summary: "Read a bounded item-filtered last-result projection.",
        input: {
          kind: "item",
          limit: 8,
        },
      },
    ],
  }),
]);

export function createWave3BCoreTemplates() {
  return cloneJson(WAVE3B_CORE_TEMPLATES);
}

function coreReadDescriptor(options) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: options.id,
    title: options.title,
    summary: options.summary,
    pack: "core",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: options.entity_kind,
    tags: options.tags,
    bridge: {
      operation_family: "query_state",
      operation_name: options.operation_name,
      capability: options.capability,
      idempotency: "none",
      timeout_ms: options.timeout_ms ?? 5_000,
    },
    inputSchema: objectSchema(options.inputProperties, options.requiredInput),
    outputSchema: objectSchema(options.outputProperties, options.requiredOutput),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: {
      kind: "read",
      summary: options.expectedSummary,
      entities: [
        {
          entity_kind: options.entity_kind,
          action: "read",
          summary: options.expectedEntitySummary,
        },
      ],
      idempotent: true,
    },
    verification: {
      mode: "none",
      checks: [],
    },
    examples: options.examples,
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

function refs() {
  return {
    input: [],
    output: [],
  };
}

function artifacts() {
  return {
    mode: "none",
    input: [],
    output: [],
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
