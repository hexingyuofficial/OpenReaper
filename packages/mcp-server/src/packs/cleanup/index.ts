import type { CapabilityRegistry } from "@streetlight/core";
import { cleanupPlanDefinition } from "./cleanup-plan.js";

export const CLEANUP_PACK_ID = "cleanup";

export function registerCleanupTemplates(registry: CapabilityRegistry): void {
  registry.register(cleanupPlanDefinition);
}
