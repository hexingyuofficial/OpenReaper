import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `track_create` — insert a new track at the end of the project (or at a
 * specific index), optionally reusing an existing track with the same name.
 *
 * Step 4b's first mutating template. Drives the new entity_kind="track"
 * routing in the bridge dispatcher: `changed_ids` lands in
 * `LAST_RESULT.tracks`, so a subsequent `last_result:track:0` resolves to
 * the just-created track.
 *
 * Reuse semantics: when `reuse_existing=true` and a track named `name`
 * already exists, the handler is a no-op and returns that track's GUID
 * instead of inserting. This makes scripted setups (recipes) safe to re-run.
 */

const TrackCreateParams = z
  .object({
    name: z
      .string()
      .min(1)
      .describe(
        "Track name. Required (empty names exist in REAPER but are confusing for agents).",
      ),
    index: z
      .number()
      .int()
      .min(0)
      .optional()
      .describe(
        "0-based insert position. Omit to append to the end of the project.",
      ),
    reuse_existing: z
      .boolean()
      .optional()
      .describe(
        "If true and a track with `name` exists, return that track instead of inserting a new one. Default false.",
      ),
  })
  .strict();

const TrackCreateResult = callTemplateResultSchema("track_create");

export const trackCreateDefinition: CapabilityDefinition<
  typeof TrackCreateParams,
  typeof TrackCreateResult
> = {
  name: "track_create",
  description: "Insert a new track; optionally reuse an existing track with the same name.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "track",
  undo_flags: ["TRACKCFG"],
  // Not idempotent: calling twice with reuse_existing=false produces two tracks.
  idempotent: false,
  expectedDelta: {
    count: 1,
    maybeCreates: true,
    fields: [
      {
        scope: "track",
        field: "P_NAME",
        paramPath: "name",
      },
    ],
  },
  params: TrackCreateParams,
  result: TrackCreateResult,
  examples: [
    {
      description: "Create or reuse a track for impact variations.",
      params: { name: "Streetlight - Impact Variations", reuse_existing: true },
    },
  ],
};
