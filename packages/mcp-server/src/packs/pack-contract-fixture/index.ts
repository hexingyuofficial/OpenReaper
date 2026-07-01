import type { CapabilityRegistry } from "@streetlight/core";
import { fixtureArtifactProbeDefinition } from "./fixture-artifact-probe.js";
import { fixtureTrackRenameDefinition } from "./fixture-track-rename.js";

export const PACK_CONTRACT_FIXTURE_PACK_ID = "pack_contract_fixture";

export function registerPackContractFixtureTemplates(
  registry: CapabilityRegistry,
): void {
  registry.register(fixtureTrackRenameDefinition);
  registry.register(fixtureArtifactProbeDefinition);
}
