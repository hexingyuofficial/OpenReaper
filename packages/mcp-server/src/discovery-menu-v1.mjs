import {
  templateRefExample,
  templateRefExampleGuidance,
} from "../../core/src/template-ref-guidance-v1.mjs";

export const DISCOVERY_MENU_CONTRACT = "discovery.menu.v1";

export const DEFAULT_DISCOVERY_LIMIT = 25;
export const MAX_DISCOVERY_LIMIT = 100;

export const TEMPLATE_SUMMARY_FIELDS = Object.freeze([
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
]);

export const TEMPLATE_DETAIL_FIELDS = Object.freeze([
  "inputSchema",
  "outputSchema",
  "examples",
  "expectedDelta",
]);

export const RECIPE_SUMMARY_FIELDS = Object.freeze([
  "id",
  "title",
  "summary",
  "pack",
  "lifecycle",
  "risk",
  "entity_kind",
  "tags",
  "workflow_card",
]);

export const RECIPE_DETAIL_FIELDS = Object.freeze([
  "steps",
  "assertions",
  "recovery",
]);

export const DISCOVERY_DERIVED_MENU_FIELDS = Object.freeze([
  "capability_group",
  "task_intents",
  "support",
  "capability_truth",
]);

export const DISCOVERY_MENU_CALL_RULES = Object.freeze({
  atomic_template_direct_call: "allowed_after_discovery",
  complex_task: "recipe_first_or_explicit_ad_hoc_primitive_composition",
});

const DEFINITIONS = Object.freeze({
  template: Object.freeze({
    responseKind: "template_menu",
    summaryFields: TEMPLATE_SUMMARY_FIELDS,
    detailFields: TEMPLATE_DETAIL_FIELDS,
    derivedFields: DISCOVERY_DERIVED_MENU_FIELDS,
  }),
  recipe: Object.freeze({
    responseKind: "recipe_menu",
    summaryFields: RECIPE_SUMMARY_FIELDS,
    detailFields: RECIPE_DETAIL_FIELDS,
    derivedFields: DISCOVERY_DERIVED_MENU_FIELDS,
  }),
});

export class DiscoveryMenuRequestError extends Error {
  constructor(message) {
    super(message);
    this.name = "DiscoveryMenuRequestError";
  }
}

export function createDiscoveryCatalog({ templates = [], recipes = [] } = {}) {
  return Object.freeze({
    list_templates(request = {}) {
      return listTemplates(request, templates);
    },
    list_recipes(request = {}) {
      return listRecipes(request, recipes);
    },
  });
}

export function listTemplates(request = {}, templates = []) {
  return listDiscoveryItems("template", request, templates);
}

export function listRecipes(request = {}, recipes = []) {
  return listDiscoveryItems("recipe", request, recipes);
}

function listDiscoveryItems(type, request, catalog) {
  const definition = DEFINITIONS[type];
  if (!definition) throw new DiscoveryMenuRequestError(`Unknown discovery type: ${type}`);

  const normalized = normalizeRequest(request, definition);
  const selectedFields = normalized.fields;
  const fieldsForProjection = includeRequiredId(selectedFields);

  if (normalized.ids.length > 0) {
    return exactItemsResponse(definition, normalized, catalog, fieldsForProjection);
  }

  const filtered = applyFilters(catalog, normalized.filters);
  const start = normalized.cursorOffset;
  const end = Math.min(start + normalized.limit, filtered.length);
  const pageItems = filtered.slice(start, end);
  const nextOffset = end < filtered.length ? end : null;

  return {
    contract: DISCOVERY_MENU_CONTRACT,
    kind: definition.responseKind,
    mode: "menu",
    items: pageItems.map((item) => projectItem(item, fieldsForProjection, { exact: false })),
    page: {
      limit: normalized.limit,
      cursor: normalized.cursor,
      next_cursor: nextOffset === null ? null : encodeCursor(nextOffset),
      has_more: nextOffset !== null,
    },
    applied: {
      ids: [],
      fields: selectedFields,
      filters: normalized.filters,
    },
    missing_ids: [],
  };
}

function exactItemsResponse(definition, normalized, catalog, fieldsForProjection) {
  const byId = new Map(catalog.map((item) => [item.id, item]));
  const items = [];
  const missingIds = [];

  for (const id of normalized.ids) {
    const item = byId.get(id);
    if (item) {
      items.push(projectItem(item, fieldsForProjection, { exact: true }));
    } else {
      missingIds.push(id);
    }
  }

  return {
    contract: DISCOVERY_MENU_CONTRACT,
    kind: definition.responseKind,
    mode: "ids",
    items,
    page: {
      limit: normalized.ids.length,
      cursor: null,
      next_cursor: null,
      has_more: false,
    },
    applied: {
      ids: normalized.ids,
      fields: normalized.fields,
      filters: {},
    },
    missing_ids: missingIds,
  };
}

function normalizeRequest(request, definition) {
  if (request === null || typeof request !== "object" || Array.isArray(request)) {
    throw new DiscoveryMenuRequestError("Discovery request must be an object.");
  }

  const ids = normalizeStringArray(request.ids, "ids");
  const defaultFields = request.fields === undefined;
  const fields =
    defaultFields
      ? [...definition.summaryFields]
      : normalizeFields(request.fields, definition);
  const filters = normalizeFilters(request);
  const detailFields = new Set(definition.detailFields);

  if (ids.length === 0 && fields.some((field) => detailFields.has(field))) {
    throw new DiscoveryMenuRequestError("Detail fields require exact expansion with ids.");
  }

  if (ids.length > 0) {
    const activeFilterKeys = Object.keys(filters);
    if (activeFilterKeys.length > 0) {
      throw new DiscoveryMenuRequestError("ids exact expansion cannot be combined with broad filters.");
    }
    if (request.cursor !== undefined) {
      throw new DiscoveryMenuRequestError("ids exact expansion is not paginated and cannot use cursor.");
    }
    if (request.limit !== undefined) {
      throw new DiscoveryMenuRequestError("ids exact expansion is not paginated and cannot use limit.");
    }
  }

  const cursor = request.cursor === undefined ? null : normalizeCursor(request.cursor);
  const cursorOffset = cursor === null ? 0 : decodeCursor(cursor);

  return {
    ids,
    fields,
    defaultFields,
    filters,
    limit: normalizeLimit(request.limit),
    cursor,
    cursorOffset,
  };
}

function normalizeFields(fields, definition) {
  const normalized = normalizeStringArray(fields, "fields").map(canonicalFieldName);
  const allowed = new Set([
    ...definition.summaryFields,
    ...definition.detailFields,
    ...definition.derivedFields,
  ]);
  const unknown = normalized.filter((field) => !allowed.has(field));

  if (unknown.length > 0) {
    throw new DiscoveryMenuRequestError(`Unknown field(s): ${unknown.join(", ")}`);
  }

  return unique(normalized);
}

function normalizeFilters(request) {
  const filters = {};

  if (request.query !== undefined) {
    if (typeof request.query !== "string") {
      throw new DiscoveryMenuRequestError("query must be a string.");
    }
    const query = request.query.trim();
    if (query) filters.query = query;
  }

  if (request.tags !== undefined) {
    const tags = normalizeStringArray(request.tags, "tags");
    if (tags.length > 0) filters.tags = tags;
  }

  for (const key of ["pack", "lifecycle", "risk", "entity_kind"]) {
    if (request[key] === undefined) continue;
    const values = normalizeStringArray(request[key], key);
    if (values.length > 0) filters[key] = values;
  }

  return filters;
}

function normalizeStringArray(value, fieldName) {
  if (value === undefined) return [];

  const raw = Array.isArray(value) ? value : [value];
  const strings = raw.map((entry) => {
    if (typeof entry !== "string") {
      throw new DiscoveryMenuRequestError(`${fieldName} must contain only strings.`);
    }
    return entry.trim();
  });

  return unique(strings.filter(Boolean));
}

function normalizeLimit(limit) {
  if (limit === undefined) return DEFAULT_DISCOVERY_LIMIT;
  if (!Number.isInteger(limit) || limit < 1) {
    throw new DiscoveryMenuRequestError("limit must be a positive integer.");
  }
  return Math.min(limit, MAX_DISCOVERY_LIMIT);
}

function normalizeCursor(cursor) {
  if (cursor === null) return null;
  if (typeof cursor !== "string" || cursor.trim() === "") {
    throw new DiscoveryMenuRequestError("cursor must be a non-empty opaque string.");
  }
  return cursor;
}

function encodeCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

function decodeCursor(cursor) {
  try {
    const decoded = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8"));
    if (decoded?.v !== 1 || !Number.isInteger(decoded.offset) || decoded.offset < 0) {
      throw new Error("bad cursor");
    }
    return decoded.offset;
  } catch {
    throw new DiscoveryMenuRequestError("cursor is not a valid discovery.menu.v1 cursor.");
  }
}

function applyFilters(catalog, filters) {
  return catalog.filter((item) => {
    if (filters.query && !matchesQuery(item, filters.query)) return false;
    if (filters.tags && !hasAllTags(item, filters.tags)) return false;
    for (const key of ["pack", "lifecycle", "risk", "entity_kind"]) {
      if (!filters[key]) continue;
      if (!filters[key].includes(stringValue(item[key]))) return false;
    }
    return true;
  });
}

function matchesQuery(item, query) {
  const haystack = [
    item.id,
    item.title,
    item.summary,
    item.pack,
    item.lifecycle,
    item.risk,
    item.entity_kind,
    ...(Array.isArray(item.tags) ? item.tags : []),
    ...discoveryDerivedSearchText(item),
  ]
    .filter((entry) => typeof entry === "string")
    .join("\n")
    .toLocaleLowerCase();

  return haystack.includes(query.toLocaleLowerCase());
}

function hasAllTags(item, tags) {
  const itemTags = new Set(Array.isArray(item.tags) ? item.tags : []);
  return tags.every((tag) => itemTags.has(tag));
}

function projectItem(item, fields, options = {}) {
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(item, field)) {
      projected[field] = item[field];
    } else if (DISCOVERY_DERIVED_MENU_FIELDS.includes(field)) {
      projected[field] = discoveryDerivedField(item, field, options);
    }
  }
  return projected;
}

function includeRequiredId(fields) {
  return fields.includes("id") ? fields : ["id", ...fields];
}

function canonicalFieldName(field) {
  return (
    {
      input_schema: "inputSchema",
      output_schema: "outputSchema",
      expected_delta: "expectedDelta",
      entityKind: "entity_kind",
      capabilityGroup: "capability_group",
      capability_group: "capability_group",
      taskIntents: "task_intents",
      task_intents: "task_intents",
      workflowCard: "workflow_card",
      workflow_card: "workflow_card",
      capabilityTruth: "capability_truth",
      capability_truth: "capability_truth",
    }[field] ?? field
  );
}

function discoveryDerivedField(item, field, options = {}) {
  if (field === "capability_group") return capabilityGroup(item);
  if (field === "task_intents") return taskIntents(item);
  if (field === "support") return supportPosture(item);
  if (field === "capability_truth") return capabilityTruth(item, options);
  return undefined;
}

function discoveryDerivedSearchText(item) {
  const support = supportPosture(item);
  const truth = capabilityTruth(item);
  return [
    capabilityGroup(item),
    ...taskIntents(item),
    support.status,
    support.evidence,
    truth.kind,
    truth.domain,
    truth.route_group,
    truth.evidence_level,
    truth.support_state,
    truth.known_blocker,
    truth.allowed_live_group,
  ];
}

function capabilityGroup(item) {
  const pack = stringValue(item.pack) || "unknown";
  const entityKind = stringValue(item.entity_kind) || "unknown";
  return `${pack}.${entityKind}`;
}

function taskIntents(item) {
  const tags = Array.isArray(item.tags) ? item.tags.filter((tag) => typeof tag === "string") : [];
  const declared = Array.isArray(item.task_intents) ? item.task_intents.filter((intent) => typeof intent === "string") : [];
  const risk = stringValue(item.risk);
  const entityKind = stringValue(item.entity_kind);
  return unique([
    ...declared,
    ...tags,
    risk,
    entityKind,
  ].filter(Boolean)).slice(0, 8);
}

function supportPosture(item) {
  const lifecycle = stringValue(item.lifecycle) || "unknown";
  const status =
    lifecycle === "deprecated"
      ? "unsupported"
      : ["stable", "official", "community", "live_smoked", "fake_smoked", "validated"].includes(lifecycle)
        ? "supported"
        : "candidate";

  return {
    status,
    lifecycle,
    evidence: `lifecycle:${lifecycle}`,
  };
}

function capabilityTruth(item, options = {}) {
  const lifecycle = stringValue(item.lifecycle) || "unknown";
  const kind = capabilityKind(item);
  const existsInCatalog = item.exists_in_catalog ?? true;
  const requiresRefs = requiredRefDeclarations(item).length > 0;
  const support = supportState(item, lifecycle, existsInCatalog);
  const liveRunnableNow = Boolean(item.live_runnable_now === true && support !== "blocked" && support !== "candidate");

  const truth = {
    id: stringValue(item.id) || null,
    kind,
    domain: stringValue(item.pack) || stringValue(item.domain) || "unknown",
    route_group: routeGroup(item),
    exists_in_catalog: Boolean(existsInCatalog),
    live_runnable_now: liveRunnableNow,
    evidence_level: evidenceLevel(item, lifecycle),
    support_state: support,
    known_blocker: knownBlocker(item, support, liveRunnableNow),
    requires_refs: requiresRefs,
    required_ref_kinds: unique(requiredRefDeclarations(item).map((ref) => ref.kind).filter(Boolean)),
    allowed_live_group: item.allowed_live_group ?? null,
  };

  if (options.exact === true) {
    truth.example_call_shape = exampleCallShape(item, kind);
    truth.output_summary_shape = outputSummaryShape(item, kind);
  }

  return pruneUndefined(truth);
}

function capabilityKind(item) {
  if (typeof item.kind === "string") return item.kind;
  if (typeof item.id === "string" && item.id.startsWith("recipe.")) return "recipe";
  if (typeof item.id === "string" && item.id.startsWith("template.")) return "template";
  return "unknown";
}

function routeGroup(item) {
  if (typeof item.route_group === "string") return item.route_group;
  const bridge = isPlainObject(item.bridge) ? item.bridge : {};
  if (typeof bridge.operation_family === "string" && typeof bridge.operation_name === "string") {
    return `${bridge.operation_family}:${bridge.operation_name}`;
  }
  return capabilityGroup(item);
}

function supportState(item, lifecycle, existsInCatalog) {
  if (!existsInCatalog) return "blocked";
  if (typeof item.support_state === "string") return item.support_state;
  if (lifecycle === "deprecated") return "blocked";
  if (["draft", "experimental", "community"].includes(lifecycle)) return "candidate";
  if (["stable", "official", "validated", "fake_smoked", "live_smoked"].includes(lifecycle)) {
    return "supported";
  }
  return "candidate";
}

function evidenceLevel(item, lifecycle) {
  if (typeof item.evidence_level === "string") return item.evidence_level;
  if (lifecycle === "live_smoked") return "live_smoked";
  if (["official", "stable", "validated", "fake_smoked"].includes(lifecycle)) return "fake_smoked";
  if (lifecycle === "experimental") return "runtime_bound_static";
  if (lifecycle === "draft" || lifecycle === "community") return "contract_only";
  if (lifecycle === "deprecated") return "deprecated";
  return "unknown";
}

function knownBlocker(item, support, liveRunnableNow) {
  if (typeof item.known_blocker === "string") return item.known_blocker;
  if (support === "blocked") return "not_supported";
  if (capabilityKind(item) === "recipe") return "no_public_call_recipe_executor";
  if (!liveRunnableNow) return "live_executor_not_configured_or_not_in_allowed_group";
  return null;
}

function exampleCallShape(item, kind) {
  if (isPlainObject(item.example_call_shape)) return item.example_call_shape;
  if (kind === "recipe") {
    return {
      executor: "agent_runs_declared_procedure_with_call_template_and_get_state",
      call_recipe: "not_available",
    };
  }

  return pruneUndefined({
    tool: "call_template",
    request: {
      id: stringValue(item.id) || null,
      input: firstExampleInput(item),
      refs: exampleRefs(item),
    },
    ref_example_guidance: exampleRefGuidance(item),
    context_policy: {
      normal_call: "omit_context_server_managed",
      optional_logical_hints: [
        "client_id",
        "session_id",
        "expected_owner",
        "expected_generation",
      ],
      server_owned: ["session_id", "created_at", "request_sequence"],
      installed_identity_conflicts: "rejected",
    },
  });
}

function outputSummaryShape(item, kind) {
  if (isPlainObject(item.output_summary_shape)) return item.output_summary_shape;
  if (kind === "recipe") {
    return {
      agent_summary: "procedure progress, checkpoints, template request ids, refs, artifacts, blockers",
    };
  }

  const resultShape = {
    summary: "compact result summary",
    refs: outputRefDeclarations(item).map((ref) => ({
      name: ref.name,
      kind: ref.kind,
    })),
    artifacts: outputArtifactDeclarations(item).map((artifact) => ({
      name: artifact.name,
      schema: artifact.schema,
    })),
    jobs: outputRefDeclarations(item)
      .filter((ref) => ref.kind === "job")
      .map((ref) => ({ name: ref.name, kind: ref.kind })),
    last_result: "bounded last_result update when applicable",
  };

  return pruneUndefined(resultShape);
}

function firstExampleInput(item) {
  const example = Array.isArray(item.examples) ? item.examples[0] : null;
  return isPlainObject(example?.input) ? example.input : {};
}

function exampleRefs(item) {
  return Object.fromEntries(
    requiredRefDeclarations(item).map((ref) => [ref.name, templateRefExample(ref.kind)]),
  );
}

function exampleRefGuidance(item) {
  return Object.fromEntries(
    requiredRefDeclarations(item).map((ref) => [
      ref.name,
      {
        kind: ref.kind,
        ...templateRefExampleGuidance(ref.kind),
      },
    ]),
  );
}

function requiredRefDeclarations(item) {
  return inputRefDeclarations(item).filter((ref) => ref.required === true);
}

function inputRefDeclarations(item) {
  return Array.isArray(item.refs?.input) ? item.refs.input.filter(isPlainObject) : [];
}

function outputRefDeclarations(item) {
  return Array.isArray(item.refs?.output) ? item.refs.output.filter(isPlainObject) : [];
}

function outputArtifactDeclarations(item) {
  return Array.isArray(item.artifacts?.output) ? item.artifacts.output.filter(isPlainObject) : [];
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function unique(values) {
  return [...new Set(values)];
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function pruneUndefined(value) {
  if (!isPlainObject(value)) return value;
  const output = {};
  for (const [key, entry] of Object.entries(value)) {
    if (entry !== undefined) output[key] = entry;
  }
  return output;
}
