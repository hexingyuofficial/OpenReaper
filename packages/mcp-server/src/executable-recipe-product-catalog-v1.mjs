import { createHash } from "node:crypto";
import { createExecutableDependencyCatalog } from "../../core/src/executable-recipe-contract-v1.mjs";
import {
  createAcceptedOfficialMacroDependencyFacts,
  createAcceptedOfficialTemplateCatalogTemplates,
} from "./call-template-runtime-v1.mjs";

export const EXECUTABLE_RECIPE_PRODUCT_CATALOG_CONTRACT = "recipe.executable.dependency_catalog.v1";
export const EXECUTABLE_RECIPE_PRODUCT_CATALOG_COUNTS = Object.freeze({ macros: 15, templates: 237 });

export function createExecutableRecipeProductCatalog() {
  const macroFacts = createAcceptedOfficialMacroDependencyFacts();
  const templates = createAcceptedOfficialTemplateCatalogTemplates();
  if (macroFacts.length !== EXECUTABLE_RECIPE_PRODUCT_CATALOG_COUNTS.macros
    || templates.length !== EXECUTABLE_RECIPE_PRODUCT_CATALOG_COUNTS.templates) {
    throw new Error("Executable Recipe product catalog count drift.");
  }
  const macros = macroFacts.map((fact) => ({
    id: fact.id,
    version: fact.version,
    risk: fact.risk,
    descriptor_hash: hashCanonical({
      id: fact.id,
      program_id: fact.program_id,
      version: fact.version,
      risk: fact.risk,
      fixed_template_ids: fact.fixed_template_ids,
      runtime_capabilities: fact.runtime_capabilities,
    }),
    capabilities: fact.capabilities,
  }));
  const templateEntries = templates.map((descriptor) => ({
    id: descriptor.id,
    version: "1.0.0",
    risk: descriptor.risk,
    descriptor_hash: hashCanonical(descriptor),
    capabilities: [descriptor.bridge.capability],
  }));
  const capabilities = [...new Set([
    ...macros.flatMap((entry) => entry.capabilities),
    ...templateEntries.flatMap((entry) => entry.capabilities),
  ])].sort();
  const catalog = createExecutableDependencyCatalog({ macros, templates: templateEntries, capabilities });
  if (catalog.macros.length !== 15 || catalog.templates.length !== 237) {
    throw new Error("Executable Recipe product catalog normalization drift.");
  }
  return catalog;
}

export function hashExecutableRecipeProductCatalog() {
  const catalog = createExecutableRecipeProductCatalog();
  return hashCanonical({ contract: catalog.contract, macros: catalog.macros, templates: catalog.templates, capabilities: catalog.capabilities });
}

function hashCanonical(value) {
  return createHash("sha256").update(JSON.stringify(canonicalize(value))).digest("hex");
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonicalize(value[key])]));
}
