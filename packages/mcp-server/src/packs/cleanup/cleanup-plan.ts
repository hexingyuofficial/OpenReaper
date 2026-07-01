import { z } from "zod";
import { callTemplateResultSchema, defineTemplate } from "../../templates/_shared.js";

const CleanupPlanParams = z
  .object({
    max_suggestions: z
      .number()
      .int()
      .min(1)
      .max(50)
      .default(25)
      .describe(
        "Maximum cleanup suggestions to include in the plan artifact. Defaults to 25, max 50.",
      ),
  })
  .strict();

const CleanupPlanResult = callTemplateResultSchema("cleanup_plan");

export const cleanupPlanDefinition = defineTemplate({
  name: "cleanup_plan",
  description:
    "Inspect the current project and write a read-only cleanup plan artifact. Does not mutate REAPER.",
  pack: "cleanup",
  risk: "filesystem",
  mutates: false,
  undoable: false,
  entity_kind: "artifact",
  undo_flags: [],
  idempotent: false,
  artifact: {
    kind: "json",
    scope: "plan",
    ref_prefix: "artifact:cleanup:plan:",
    read_scope: "artifact",
    updates_last_result: false,
    schema: "openreaper.cleanup_plan.v1",
  },
  params: CleanupPlanParams,
  result: CleanupPlanResult,
  examples: [
    {
      description: "Create a bounded read-only cleanup plan for the current project.",
      params: {
        max_suggestions: 25,
      },
    },
  ],
});
