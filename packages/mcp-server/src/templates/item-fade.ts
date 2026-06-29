import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `item_fade` — set the item's fade-in and/or fade-out length, in seconds.
 *
 * First template to use the `json.null` sentinel (see
 * `reaper/packs/core/lib/json.lua` and `docs/TEMPLATE_SPEC.md § Nullable
 * Params`). The tri-state semantics for each of `fade_in` / `fade_out`:
 *
 *   - **absent** (key not in the JSON object) → leave the existing value alone
 *   - **explicit `null`** → clear the fade (REAPER `D_FADEINLEN`=0 etc.)
 *   - **number ≥ 0** → set the fade length to that many seconds
 *
 * Lua handler checks reference equality against `ctx.json.null` to
 * distinguish absent from explicit-null; both `null` cases would otherwise
 * round-trip to Lua as a missing key.
 *
 * Idempotent in all three states — same inputs produce the same final state.
 */

// `.finite()` on the number branch is load-bearing here, not cosmetic:
// without it, `fade_in: Infinity` round-trips as JSON `null` (since
// `JSON.stringify(Infinity) === "null"`) and the union's `z.null()` branch
// accepts it. That collapses to the tri-state's "clear the fade" path —
// the agent thinks they set a huge fade and silently get a cleared one.
// See item-fade.test.ts "PARAMS_INVALID: Infinity is rejected" for the
// regression guard.
const FadeField = z.union([z.number().finite().min(0), z.null()]).optional();

const ItemFadeParams = z
  .object({
    item_id: z
      .string()
      .min(1)
      .describe(
        'Item reference (selected:N, guid:{...}, last_result:item:N, track:Name/item:N).',
      ),
    fade_in: FadeField.describe(
      'Fade-in length in seconds (≥ 0). Three states: omit = leave alone, null = clear to 0, number = set length.',
    ),
    fade_out: FadeField.describe(
      'Fade-out length in seconds (≥ 0). Three states: omit = leave alone, null = clear to 0, number = set length.',
    ),
  })
  .strict();

const ItemFadeResult = callTemplateResultSchema("item_fade");

export const itemFadeDefinition: CapabilityDefinition<
  typeof ItemFadeParams,
  typeof ItemFadeResult
> = {
  name: "item_fade",
  description:
    "Set item fade-in / fade-out lengths. Omit a field to leave it alone, send null to clear it, send a number to set the length in seconds.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  idempotent: true,
  params: ItemFadeParams,
  result: ItemFadeResult,
};
