import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_rate` — set the active take's playback rate.
 *
 * Plan note (IMPLEMENTATION_PLAN.md § Step 4): we explicitly set
 * `B_PPITCH=false` so changing rate changes pitch (the "vinyl slowdown"
 * behavior expected for the demo's variations). If a future template
 * needs the opposite (rate without pitch shift), it ships separately —
 * we don't expose `B_PPITCH` as a param here.
 *
 * Rate range: REAPER accepts 0.01..100 in theory; we clamp at the schema
 * level to a saner musical range. Out-of-band requests are PARAMS_INVALID.
 */

const ItemRateParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe("Logical item reference (selected:N, guid:{...}, last_result, track:Name/item:N)."),
    rate: z
      .number()
      .finite()
      .min(0.1)
      .max(4.0)
      .describe(
        "Playback rate multiplier. 1 = normal, 0.5 = half speed (down an octave), 2 = double speed (up an octave). Clamped to [0.1, 4.0] by policy.",
      ),
  })
  .strict();

const ItemRateResult = callTemplateResultSchema("item_rate");

export const itemRateDefinition: CapabilityDefinition<
  typeof ItemRateParams,
  typeof ItemRateResult
> = {
  name: "item_rate",
  description:
    "Set the active take's playback rate. Pitch follows rate (B_PPITCH=false).",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  idempotent: true,
  params: ItemRateParams,
  result: ItemRateResult,
};
