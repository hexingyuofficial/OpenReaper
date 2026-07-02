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
]);

export const RECIPE_DETAIL_FIELDS = Object.freeze([
  "steps",
  "assertions",
  "recovery",
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
  }),
  recipe: Object.freeze({
    responseKind: "recipe_menu",
    summaryFields: RECIPE_SUMMARY_FIELDS,
    detailFields: RECIPE_DETAIL_FIELDS,
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
    items: pageItems.map((item) => projectItem(item, fieldsForProjection)),
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
      items.push(projectItem(item, fieldsForProjection));
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
  const fields =
    request.fields === undefined
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
    filters,
    limit: normalizeLimit(request.limit),
    cursor,
    cursorOffset,
  };
}

function normalizeFields(fields, definition) {
  const normalized = normalizeStringArray(fields, "fields").map(canonicalFieldName);
  const allowed = new Set([...definition.summaryFields, ...definition.detailFields]);
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

function projectItem(item, fields) {
  const projected = {};
  for (const field of fields) {
    if (Object.hasOwn(item, field)) {
      projected[field] = item[field];
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
    }[field] ?? field
  );
}

function stringValue(value) {
  return typeof value === "string" ? value : "";
}

function unique(values) {
  return [...new Set(values)];
}
