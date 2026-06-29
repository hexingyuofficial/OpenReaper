import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_duplicate` — copy an item to a target track at a target position.
 *
 * Implementation contract pinned in IMPLEMENTATION_PLAN.md § Step 4 pitfalls:
 * the Lua handler builds the duplicate manually via
 * `AddMediaItemToTrack` + `AddTakeToMediaItem` + `SetMediaItemTake_Source`
 * — NOT `Main_OnCommand(41295)`. The clipboard action mutates selection and
 * the global clipboard; the manual path is deterministic and side-effect-free.
 *
 * MVP.md fixes the param set: { item_id, track_id, position } all required.
 * No defaults — agents that want "same track, same position" call it
 * explicitly to make the duplicate's location auditable from the params alone.
 *
 * NOT idempotent: each call creates a new item. Re-running with the same
 * params produces a second duplicate stacked on the first.
 */

const ItemDuplicateParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'Source item reference (selected:N, guid:{...}, last_result:item:N, track:Name/item:N).',
      ),
    track_id: z
      .string()
      .min(1)
      .describe(
        'Target track reference (track:Name, guid:{...}, last_result:track:N).',
      ),
    position: z
      .number()
      .finite()
      .min(0)
      .describe(
        "Position in seconds on the target track's timeline for the duplicate's start.",
      ),
  })
  .strict();

const ItemDuplicateResult = callTemplateResultSchema("item_duplicate");

export const itemDuplicateDefinition: CapabilityDefinition<
  typeof ItemDuplicateParams,
  typeof ItemDuplicateResult
> = {
  name: "item_duplicate",
  description:
    "Duplicate an item to a target track at a given position. Copies take source, length, fades, rate, and pitch.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  // Each call adds a new item; running twice produces two duplicates.
  idempotent: false,
  params: ItemDuplicateParams,
  result: ItemDuplicateResult,
};
