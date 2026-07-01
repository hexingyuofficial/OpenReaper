import { z } from "zod";
import { callTemplateResultSchema, defineTemplate } from "../../templates/_shared.js";

const FixtureArtifactProbeParams = z
  .object({
    label: z
      .string()
      .min(1)
      .max(200)
      .describe("Short label stored in the fixture artifact summary and payload."),
  })
  .strict();

const FixtureArtifactProbeResult = callTemplateResultSchema("fixture_artifact_probe");

export const fixtureArtifactProbeDefinition = defineTemplate({
  name: "fixture_artifact_probe",
  description:
    "Fixture-pack template used to prove JSON artifact creation and get_state readback.",
  pack: "pack_contract_fixture",
  risk: "filesystem",
  mutates: false,
  undoable: false,
  entity_kind: "artifact",
  undo_flags: [],
  idempotent: false,
  artifact: {
    kind: "json",
    scope: "probe",
    ref_prefix: "artifact:pack_contract_fixture:probe:",
    read_scope: "artifact",
    updates_last_result: false,
    schema: "openreaper.fixture.probe.v1",
  },
  params: FixtureArtifactProbeParams,
  result: FixtureArtifactProbeResult,
  examples: [
    {
      description: "Write one tiny fixture artifact for smoke testing.",
      params: {
        label: "S21 artifact smoke",
      },
    },
  ],
});
