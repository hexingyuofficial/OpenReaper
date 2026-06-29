import {
  type CapabilityMetadata,
  type CapabilityRegistry,
  type Result,
  ok,
} from "@streetlight/core";

export interface ListTemplatesResult {
  templates: CapabilityMetadata[];
}

/**
 * Step 7 MVP tool. Returns the registry's serializable metadata
 * (name, risk flags, JSON Schemas) — does NOT touch the bridge.
 * Wrapped in a Result for envelope consistency with the other tools.
 */
export function listTemplates(
  registry: CapabilityRegistry,
): Result<ListTemplatesResult> {
  return ok({ templates: registry.list() });
}
