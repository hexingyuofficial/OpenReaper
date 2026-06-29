import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `track_rename` — set a track's name.
 *
 * Drives the new track-ref resolution path. `track_id` accepts
 * `"track:Name"`, `"guid:{...}"`, or `"last_result:track:N"` — the bridge's
 * `refs.resolve_track` is the source of truth for valid shapes.
 *
 * Idempotent in the literal sense: setting the name to the same value
 * twice produces the same state. Note that renaming track "Drums" to
 * "Bass" and back to "Drums" leaves the project visually unchanged but
 * still creates two undo steps.
 */

const TrackRenameParams = z
  .object({
    track_id: z
      .string()
      .min(1)
      .describe(
        'Logical track reference. Step 4b supports "track:Name", "guid:{...}", and "last_result:track:N".',
      ),
    name: z
      .string()
      .min(1)
      .describe("New track name. Must be non-empty."),
  })
  .strict();

const TrackRenameResult = callTemplateResultSchema("track_rename");

export const trackRenameDefinition: CapabilityDefinition<
  typeof TrackRenameParams,
  typeof TrackRenameResult
> = {
  name: "track_rename",
  description: "Rename a track resolved by name, GUID, or last_result.",
  pack: "core",
  risk: "write_safe",
  mutates: true,
  undoable: true,
  entity_kind: "track",
  undo_flags: ["TRACKCFG"],
  idempotent: true,
  expectedDelta: { count: 1 },
  params: TrackRenameParams,
  result: TrackRenameResult,
  examples: [
    {
      description: "Rename the most recently changed track.",
      params: { track_id: "last_result:track:0", name: "Impacts" },
    },
  ],
};
