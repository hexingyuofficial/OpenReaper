import { FOUNDATION_BRIDGE_PACK_IDS } from "./foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS,
  TemplateDescriptorValidationError,
  normalizeTemplateDescriptor,
  templateDescriptorDiscoverySummary,
} from "./template-descriptor-v1.mjs";

export const TEMPLATE_CATALOG_CONTRACT = "template.catalog.v1";

export const TEMPLATE_CATALOG_SMOKE_CATEGORIES = Object.freeze([
  "catalog_load",
  "descriptor_validation",
  "default_discovery_bounded",
  "exact_ids_expansion",
  "fake_execution_read",
  "fake_execution_write",
  "fake_execution_job",
  "fake_execution_artifact",
  "fake_execution_idempotent",
  "fake_execution_error",
  "no_live_reaper_startup",
  "no_legacy_migration",
  "no_recipes",
]);

export const TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS = Object.freeze([
  "bridge",
  "inputSchema",
  "outputSchema",
  "refs",
  "artifacts",
  "expectedDelta",
  "verification",
  "examples",
]);

const FIXED_PACK_ID_SET = new Set(FOUNDATION_BRIDGE_PACK_IDS);
const WORKFLOW_SHAPED_PACK_ID_SET = new Set(TEMPLATE_DESCRIPTOR_WORKFLOW_SHAPED_PACK_IDS);

export class TemplateCatalogValidationError extends Error {
  constructor(message, errors = [message]) {
    super(message);
    this.name = "TemplateCatalogValidationError";
    this.errors = errors;
  }
}

export function validateTemplateCatalog(input = {}) {
  const { errors } = collectTemplateCatalog(input);
  return {
    ok: errors.length === 0,
    errors,
  };
}

export function normalizeTemplateCatalog(input = {}) {
  const { errors, templates } = collectTemplateCatalog(input);
  if (errors.length > 0) {
    throw new TemplateCatalogValidationError(
      `Template catalog validation failed: ${errors.join("; ")}`,
      errors,
    );
  }

  return deepFreeze({
    contract: TEMPLATE_CATALOG_CONTRACT,
    templates,
  });
}

export function createTemplateCatalog(input = {}) {
  const normalized = normalizeTemplateCatalog(input);
  const templates = normalized.templates;
  const byId = new Map(templates.map((descriptor) => [descriptor.id, descriptor]));
  const ids = deepFreeze(templates.map((descriptor) => descriptor.id));

  return Object.freeze({
    contract: TEMPLATE_CATALOG_CONTRACT,
    size: templates.length,
    ids,
    list() {
      return templates;
    },
    get(id) {
      return byId.get(id) ?? null;
    },
    require(id) {
      const descriptor = byId.get(id);
      if (!descriptor) {
        throw new TemplateCatalogValidationError(`Unknown template id: ${String(id)}.`);
      }
      return descriptor;
    },
    summary(id) {
      const descriptor = byId.get(id);
      return descriptor ? templateDescriptorDiscoverySummary(descriptor) : null;
    },
    summaries() {
      return deepFreeze(templates.map((descriptor) => templateDescriptorDiscoverySummary(descriptor)));
    },
    discoveryTemplates() {
      return templates;
    },
  });
}

export function templateCatalogDiscoveryItems(catalog) {
  if (!catalog || catalog.contract !== TEMPLATE_CATALOG_CONTRACT || typeof catalog.discoveryTemplates !== "function") {
    throw new TemplateCatalogValidationError(
      "templateCatalogDiscoveryItems requires a template.catalog.v1 catalog.",
    );
  }
  return catalog.discoveryTemplates();
}

export function createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog) {
  if (typeof createDiscoveryCatalog !== "function") {
    throw new TemplateCatalogValidationError(
      "createTemplateCatalogDiscovery requires the Layer 1.5 createDiscoveryCatalog function.",
    );
  }
  return createDiscoveryCatalog({
    templates: templateCatalogDiscoveryItems(catalog),
  });
}

function collectTemplateCatalog(input) {
  const errors = [];
  const templates = [];

  if (!isPlainObject(input)) {
    return {
      errors: ["Template catalog input must be an object."],
      templates,
    };
  }

  if (Object.hasOwn(input, "recipes")) {
    errors.push("Template catalog must not include recipes.");
  }

  for (const key of Object.keys(input)) {
    if (key !== "templates") errors.push(`Unknown template catalog field: ${key}.`);
  }

  const templateInputs = input.templates ?? [];
  if (!Array.isArray(templateInputs)) {
    errors.push("templates must be an array.");
    return { errors, templates };
  }

  const seenIds = new Map();
  for (const [index, candidate] of templateInputs.entries()) {
    errors.push(...catalogBoundaryErrors(candidate, index));

    try {
      const descriptor = normalizeTemplateDescriptor(candidate);
      if (seenIds.has(descriptor.id)) {
        errors.push(
          `Duplicate template id: ${descriptor.id} (templates[${seenIds.get(descriptor.id)}] and templates[${index}]).`,
        );
      } else {
        seenIds.set(descriptor.id, index);
      }
      templates.push(descriptor);
    } catch (error) {
      if (error instanceof TemplateDescriptorValidationError) {
        for (const descriptorError of error.errors) {
          errors.push(`templates[${index}]: ${descriptorError}`);
        }
      } else {
        throw error;
      }
    }
  }

  return { errors, templates };
}

function catalogBoundaryErrors(candidate, index) {
  const errors = [];
  if (!isPlainObject(candidate)) return errors;

  if (typeof candidate.pack === "string") {
    if (!FIXED_PACK_ID_SET.has(candidate.pack)) {
      errors.push(`templates[${index}]: pack must be one of the fixed 16 packs: ${candidate.pack}.`);
    }
    if (WORKFLOW_SHAPED_PACK_ID_SET.has(candidate.pack)) {
      errors.push(`templates[${index}]: workflow-shaped pack metadata is forbidden: ${candidate.pack}.`);
    }
  }

  if (typeof candidate.id === "string") {
    const match = candidate.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN);
    if (match && typeof candidate.pack === "string" && match[1] !== candidate.pack) {
      errors.push(`templates[${index}]: id pack segment must match pack (${candidate.pack}).`);
    }
  }

  return errors;
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
