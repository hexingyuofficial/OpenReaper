import {
  createRecipeCatalogDiscovery,
} from "../../core/src/recipe-contract-v1.mjs";
import {
  loadUserRecipeCatalog,
} from "../../core/src/user-recipe-authoring-v1.mjs";
import { createDiscoveryCatalog } from "./discovery-menu-v1.mjs";

export function createUserRecipeDiscovery(options = {}) {
  const catalog = options.catalog ?? loadUserRecipeCatalog(options);
  return createRecipeCatalogDiscovery(catalog, createDiscoveryCatalog);
}

export function listUserRecipes(request = {}, options = {}) {
  return createUserRecipeDiscovery(options).list_recipes(request);
}
