import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `media_import` — import a media file onto a target track at a given
 * position.
 *
 * Plan note (IMPLEMENTATION_PLAN.md § Step 4): REAPER's `InsertMedia`
 * inserts onto the *currently selected* tracks, so the Lua handler must
 * snapshot the user's selection, select the target, call InsertMedia, then
 * restore selection. Acceptance criterion: the user must not be left with
 * the wrong track selected after the call.
 *
 * Risk = `filesystem` per the v0.1 risk policy: reading from disk lands a
 * new audio item with a path the agent supplied. The MCP-side schema
 * requires a non-empty path; the bridge does its own existence check and
 * surfaces `MEDIA_NOT_FOUND` if the file is unreadable, so an agent passing
 * a typo gets a typed error before InsertMedia mutates anything.
 *
 * Not idempotent: each call inserts a new item, even if a duplicate already
 * sits at the same position on the same track.
 */

const MediaImportParams = z
  .object({
    path: z
      .string()
      .min(1)
      .describe(
        "Absolute path to a media file readable by the REAPER process. The bridge probes existence before InsertMedia and returns MEDIA_NOT_FOUND if it cannot read the file.",
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
        "Start position of the inserted item, in project seconds. Set after InsertMedia lands; InsertMedia itself ignores position.",
      ),
  })
  .strict();

const MediaImportResult = callTemplateResultSchema("media_import");

export const mediaImportDefinition: CapabilityDefinition<
  typeof MediaImportParams,
  typeof MediaImportResult
> = {
  name: "media_import",
  description:
    "Import a media file onto a target track at a given position. Restores prior track selection.",
  pack: "core",
  risk: "filesystem",
  mutates: true,
  undoable: true,
  idempotent: false,
  params: MediaImportParams,
  result: MediaImportResult,
};
