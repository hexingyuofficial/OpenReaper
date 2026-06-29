import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `region_create` — insert a named project region.
 *
 * Two modes (XOR — enforced by superRefine below):
 *   { name, start, end }   — exact bounds in project seconds. `end` must be
 *                            strictly greater than `start`, and `start` must
 *                            be non-negative.
 *   { name, item_id }      — bounds derived from the resolved item:
 *                            [D_POSITION, D_POSITION + D_LENGTH]. Fades are
 *                            within D_LENGTH so they're already covered;
 *                            see IMPLEMENTATION_PLAN.md § Step 5 pitfalls.
 *
 * Region identity in v0.1 is the NAME, not REAPER's integer marker index
 * (indices renumber on any marker delete) — REAPER 7 exposes no native
 * region GUID API. `changed_ids` therefore returns `"region:NAME"` and
 * `LAST_RESULT.regions` stores name-shaped refs. The Lua resolver
 * re-scans by name on `last_result:region:N`.
 *
 * Name-content rules (path separators `/` `\`, NUL, and the render-pattern
 * token `$`) are domain rules and so live in the Lua handler — it raises
 * `REGION_NAME_INVALID` (same agent-facing surface as `REGION_NAME_TAKEN`).
 * This schema only enforces structural shape (`min(1)`, mode XOR, finite
 * numeric bounds); domain-shape rejection happens one layer down so the agent
 * gets the domain code instead of `PARAMS_INVALID`. The same rule set runs
 * at render time inside `render_region` (Step 7 B1), so a hand-built bad
 * region fed to render also surfaces `REGION_NAME_INVALID`.
 */

const RegionCreateParams = z
  .object({
    name: z
      .string()
      .min(1)
      .describe(
        "Region name. Must be unique among existing regions; the bridge rejects names containing /, \\, NUL, or $ with REGION_NAME_INVALID (the same rule re-runs at render time).",
      ),
    start: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe(
        "Region start position in project seconds. Required alongside `end`; mutually exclusive with `item_id`.",
      ),
    end: z
      .number()
      .finite()
      .optional()
      .describe(
        "Region end position in project seconds. Must be strictly greater than `start`. Required alongside `start`; mutually exclusive with `item_id`.",
      ),
    item_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        "Item reference whose [position, position + length] becomes the region bounds. Mutually exclusive with `start`/`end`.",
      ),
  })
  .strict()
  .superRefine((val, ctx) => {
    const hasExplicit = val.start !== undefined || val.end !== undefined;
    const hasItem = val.item_id !== undefined;

    if (hasExplicit && hasItem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Specify either { start, end } or { item_id }, not both",
      });
      return;
    }
    if (!hasExplicit && !hasItem) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "One of { start, end } or { item_id } is required",
      });
      return;
    }
    if (hasExplicit) {
      if (val.start === undefined || val.end === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "Explicit mode requires both `start` and `end`",
        });
        return;
      }
      if (val.end <= val.start) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["end"],
          message: `\`end\` must be strictly greater than \`start\` (${val.start} >= ${val.end})`,
        });
      }
    }
  });

const RegionCreateResult = callTemplateResultSchema("region_create");

export const regionCreateDefinition: CapabilityDefinition<
  typeof RegionCreateParams,
  typeof RegionCreateResult
> = {
  name: "region_create",
  description:
    "Create a named project region from explicit bounds or an item's [position, position + length].",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "region",
  undo_flags: ["MISCCFG"],
  // Not idempotent: a second call with the same name returns REGION_NAME_TAKEN
  // (and creates no marker), but the first call DID create one.
  idempotent: false,
  expectedDelta: { count: 1, creates: true },
  params: RegionCreateParams,
  result: RegionCreateResult,
  examples: [
    {
      description: "Create a two-second region named var_01.",
      params: { name: "var_01", start: 0, end: 2 },
    },
  ],
};
