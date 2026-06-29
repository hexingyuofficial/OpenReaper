import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_move` — set an item's start position on the timeline, optionally
 * reparenting it to a target track.
 *
 * Plan note (IMPLEMENTATION_PLAN.md § Step 4): `D_POSITION` for the
 * position, `MoveMediaItemToTrack` for the reparent. Both are simple
 * setters; the only ergonomic call is whether to require both at once.
 * Decision: `position` is required (no-op moves are rare and confusing);
 * `to_track_id` is optional (most uses don't need a reparent).
 *
 * Idempotent: moving to (pos, track) twice produces the same state.
 */

const ItemMoveParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'Logical item reference. Accepts "selected:N", "guid:{...}", "last_result:item:N", "track:Name/item:N".',
      ),
    position: z
      .number()
      .finite()
      .min(0)
      .describe(
        "New start position in seconds, on the project timeline. Must be ≥ 0 and finite.",
      ),
    to_track_id: z
      .string()
      .min(1)
      .optional()
      .describe(
        'Optional track reference (track:Name / guid / last_result:track:N) to reparent the item to. Omit to leave it on its current track.',
      ),
  })
  .strict();

const ItemMoveResult = callTemplateResultSchema("item_move");

export const itemMoveDefinition: CapabilityDefinition<
  typeof ItemMoveParams,
  typeof ItemMoveResult
> = {
  name: "item_move",
  description:
    "Move an item to a new timeline position; optionally reparent to another track.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "item",
  undo_flags: ["ITEMS"],
  idempotent: true,
  expectedDelta: { count: 1 },
  params: ItemMoveParams,
  result: ItemMoveResult,
  examples: [
    {
      description: "Move the first selected item to 1.5 seconds.",
      params: { item_id: "selected:0", position: 1.5 },
    },
  ],
};
