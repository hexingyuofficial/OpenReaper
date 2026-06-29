import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_trim` — set an item's visible length, and optionally where in the
 * source media playback starts.
 *
 * `length` is required (no-op trims aren't useful). `start_offset` is
 * optional and means "start playing the source media this many seconds
 * in"; omitting it leaves the existing offset alone.
 *
 * Plan note (IMPLEMENTATION_PLAN.md § Step 4 pitfalls): `D_STARTOFFS` is
 * in **source-media seconds**, not project seconds. The schema describes
 * this so an agent doesn't pass an item position by mistake.
 *
 * Idempotent: same length + offset twice → same state.
 */

const ItemTrimParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe("Logical item reference (selected:N, guid:{...}, last_result, track:Name/item:N)."),
    length: z
      .number()
      .finite()
      .min(0)
      .describe(
        "New visible item length in seconds on the timeline. 0 is allowed (collapses the item but does not delete it).",
      ),
    start_offset: z
      .number()
      .finite()
      .min(0)
      .optional()
      .describe(
        "Optional. Where in the source media playback starts, in SOURCE seconds (not project seconds). Omit to leave the current offset alone.",
      ),
  })
  .strict();

const ItemTrimResult = callTemplateResultSchema("item_trim");

export const itemTrimDefinition: CapabilityDefinition<
  typeof ItemTrimParams,
  typeof ItemTrimResult
> = {
  name: "item_trim",
  description:
    "Set an item's visible length; optionally set where source playback starts (D_STARTOFFS).",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "item",
  undo_flags: ["ITEMS"],
  idempotent: true,
  expectedDelta: { count: 1 },
  params: ItemTrimParams,
  result: ItemTrimResult,
  examples: [
    {
      description: "Trim the first selected item to one second.",
      params: { item_id: "selected:0", length: 1 },
    },
  ],
};
