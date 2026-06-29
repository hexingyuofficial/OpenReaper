import type { CapabilityRegistry } from "@streetlight/core";
import { itemPitchDefinition } from "./item-pitch.js";
import { itemMoveDefinition } from "./item-move.js";
import { itemRateDefinition } from "./item-rate.js";
import { itemTrimDefinition } from "./item-trim.js";
import { trackCreateDefinition } from "./track-create.js";
import { trackRenameDefinition } from "./track-rename.js";
import { itemDuplicateDefinition } from "./item-duplicate.js";
import { itemFadeDefinition } from "./item-fade.js";
import { mediaImportDefinition } from "./media-import.js";
import { regionCreateDefinition } from "./region-create.js";
import { renderRegionDefinition } from "./render-region.js";

/**
 * Register every v0.1 core-pack template with the MCP server's registry.
 *
 * Adding a template means:
 *   1. drop a file under packages/mcp-server/src/templates/
 *   2. export its CapabilityDefinition
 *   3. add one line below
 *   4. add the Lua handler to reaper/packs/core/templates/ and wire it
 *      into reaper/packs/core/manifest.lua (with entity_kind set)
 *
 * `call_template` validation is driven entirely by what's registered here;
 * there is no per-template special-casing in the tool layer. New templates
 * just appear in the registry and become callable.
 */
export function registerCoreTemplates(registry: CapabilityRegistry): void {
  registry.register(itemPitchDefinition);
  registry.register(itemMoveDefinition);
  registry.register(itemRateDefinition);
  registry.register(itemTrimDefinition);
  registry.register(trackCreateDefinition);
  registry.register(trackRenameDefinition);
  registry.register(itemDuplicateDefinition);
  registry.register(itemFadeDefinition);
  registry.register(mediaImportDefinition);
  registry.register(regionCreateDefinition);
  registry.register(renderRegionDefinition);
}
