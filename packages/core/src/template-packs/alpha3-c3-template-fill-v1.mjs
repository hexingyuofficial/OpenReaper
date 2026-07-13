import { TEMPLATE_DESCRIPTOR_CONTRACT } from "../template-descriptor-v1.mjs";

export const ALPHA3_C3_TEMPLATE_FILL_TEMPLATE_IDS = Object.freeze([
  "template.automation.list_project_envelopes",
]);

export const ALPHA3_C3_TEMPLATE_FILL_TEMPLATES = deepFreeze([
  readDescriptor({
    id: "template.automation.list_project_envelopes",
    title: "List project envelopes",
    summary: "List bounded project automation envelope candidates for Project SQLite Index refresh without returning point lanes.",
    pack: "automation",
    entity_kind: "envelope",
    tags: ["alpha3_c3", "automation", "envelope", "index", "read"],
    bridge: bridge({
      operation_family: "query_state",
      operation_name: "automation.project_envelopes.list",
      capability: "automation.project_envelopes.list",
      idempotency: "none",
    }),
    inputSchema: objectSchema({
      parent_kinds: { type: "array" },
      include_track_envelopes: { type: "boolean" },
      include_take_envelopes: { type: "boolean" },
      include_send_envelopes: { type: "boolean" },
      include_fx_parameter_envelopes: { type: "boolean" },
      only_visible: { type: "boolean" },
      only_armed: { type: "boolean" },
      limit: { type: "integer" },
      cursor: { type: "string" },
    }, []),
    outputSchema: objectSchema({
      envelopes: { type: "array" },
      envelope_refs: { type: "array" },
      returned_count: { type: "integer" },
      total_count: { type: "integer" },
      next_cursor: nullableStringSchema(),
      truncated: { type: "boolean" },
      coverage_status: { enum: ["complete", "paged", "truncated", "unknown"] },
      coverage: { type: "object" },
    }, ["envelopes", "envelope_refs", "returned_count", "total_count", "next_cursor", "truncated", "coverage_status", "coverage"]),
    refs: refs({
      output: [ref("envelope_refs", "envelope", false, "Automation envelope refs returned for Project SQLite Index refresh.")],
    }),
    expectedDelta: readDelta({
      summary: "Reads compact automation envelope inventory rows without reading dense point lanes or mutating automation.",
      entities: [
        {
          entity_kind: "envelope",
          action: "read",
          summary: "Project automation envelope candidates are listed for index refresh.",
        },
      ],
    }),
    examples: [
      {
        name: "list_project_automation_candidates",
        summary: "List the first bounded page of visible project automation envelopes.",
        input: {
          parent_kinds: ["track", "take", "send", "fx"],
          only_visible: true,
          limit: 50,
        },
      },
    ],
  }),
]);

export function createAlpha3C3TemplateFillTemplates() {
  return cloneJson(ALPHA3_C3_TEMPLATE_FILL_TEMPLATES);
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

function descriptor(overrides = {}) {
  return {
    contract: TEMPLATE_DESCRIPTOR_CONTRACT,
    id: "template.automation.list_project_envelopes",
    title: "Alpha3 C3 template fill descriptor",
    summary: "Run one bounded Alpha3 C3 template fill descriptor.",
    pack: "automation",
    lifecycle: "experimental",
    risk: "read",
    entity_kind: "envelope",
    tags: ["alpha3_c3"],
    bridge: bridge(),
    inputSchema: objectSchema(),
    outputSchema: objectSchema(),
    refs: refs(),
    artifacts: artifacts(),
    expectedDelta: readDelta(),
    verification: verification({ mode: "none", checks: [] }),
    examples: [
      {
        name: "alpha3_c3_template_fill",
        summary: "Run one bounded Alpha3 C3 descriptor.",
        input: {},
      },
    ],
    ...overrides,
  };
}

function bridge(overrides = {}) {
  return {
    operation_family: "query_state",
    operation_name: "automation.project_envelopes.list",
    capability: "automation.project_envelopes.list",
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

function nullableStringSchema() {
  return {
    oneOf: [
      { type: "string" },
      { type: "null" },
    ],
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

function artifacts() {
  return {
    mode: "none",
    input: [],
    output: [],
  };
}

function readDelta(overrides = {}) {
  return {
    kind: "read",
    summary: "Reads state without mutating REAPER.",
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
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
