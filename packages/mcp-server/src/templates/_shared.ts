import { z } from "zod";

/**
 * Locked `call_template` result shape. The dispatcher in
 * `reaper/streetlight_bridge.lua` enforces this on every successful
 * `call_template` invocation, so the only piece that varies per template
 * is the `template` literal.
 *
 * Schema rationale lives in docs/RESPONSE_BUDGET.md § `call_template`.
 * Step 4a noted this needed lifting into a shared module once the
 * second template landed; Step 4b does that.
 */
export function callTemplateResultSchema<N extends string>(name: N) {
  return z
    .object({
      template: z.literal(name),
      changed_count: z.number().int().min(0),
      changed_ids: z.array(z.string()).max(50),
      truncated: z.boolean(),
    })
    .strict();
}
