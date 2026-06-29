import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_pitch` — set the pitch of an item's active take, in semitones.
 *
 * Step 3's first mutating template. Schemas are the source of truth for both
 * the MCP server's input validation and (later) the JSON Schema returned by
 * `list_templates`. The Lua bridge does NOT re-validate types; it relies on
 * the MCP server's Zod pass.
 *
 * Result schema describes only the **agent-facing** call_template envelope
 * (locked shape `{ template, changed_count, changed_ids, truncated }`).
 * The handler returns `{ changed_ids }` — the dispatcher fills in the rest.
 */

const ItemPitchParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'Logical item reference. Step 3 supports "selected:N" and "guid:{...}".',
      ),
    semitones: z
      .number()
      .finite()
      .min(-24)
      .max(24)
      .describe(
        "Pitch shift in semitones. Clamped to ±24 by policy (not a REAPER limit).",
      ),
  })
  .strict();

const ItemPitchResult = callTemplateResultSchema("item_pitch");

export const itemPitchDefinition: CapabilityDefinition<
  typeof ItemPitchParams,
  typeof ItemPitchResult
> = {
  name: "item_pitch",
  description: "Set the active take's pitch (in semitones) on the referenced item.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "item",
  undo_flags: ["ITEMS"],
  idempotent: true, // Setting pitch to N twice yields the same state.
  expectedDelta: { count: 1 },
  params: ItemPitchParams,
  result: ItemPitchResult,
  examples: [
    {
      description: "Pitch the first selected item down one octave.",
      params: { item_id: "selected:0", semitones: -12 },
    },
  ],
};
