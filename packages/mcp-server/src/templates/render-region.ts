import { z } from "zod";
import type { CapabilityDefinition } from "@streetlight/core";
import { callTemplateResultSchema } from "./_shared.js";

/**
 * `render_region` — render a single project region to a WAV file on disk.
 *
 * v0.1 is the first (and only) consumer of the bridge's deferred-completion
 * protocol: the Lua handler kicks off `Main_OnCommand(42230, 0)` and then
 * yields, letting the bridge re-check the output file on subsequent defer
 * ticks rather than busy-waiting. The asynchrony is BRIDGE-INTERNAL — the
 * agent only ever sees the normal `Result<CallTemplateResult>` envelope,
 * never a `state: "rendering"` sentinel. See docs/RENDER_NOTES.md.
 *
 * Locked v0.1 output policy (intentionally hardcoded, not exposed as
 * params): format = WAV / 24-bit PCM, channels = 2 (stereo), sample rate =
 * project rate. Future formats land in v0.2.
 *
 * Result envelope deviation worth pinning here: `render_region` is the
 * single template whose `changed_ids` carries artifact paths
 * (`["/abs/path/region_name.wav"]`) rather than project entity refs
 * (`guid:{...}` / `region:NAME` / `track:Name`). Every other template stays
 * with the project-entity-ref convention. Do NOT generalize this carve-out
 * to other templates — see docs/RESPONSE_BUDGET.md § call_template for the
 * locked rationale.
 *
 * Domain-shape rejection (matches the Step 5 region-name pattern): TS only
 * enforces structural shape (`min(1)` on both fields). Path-existence,
 * directory-vs-file, writability, and target-file collision live in the
 * Lua handler so the agent-facing surface is OUTPUT_DIR_MISSING /
 * OUTPUT_DIR_NOT_WRITABLE / OUTPUT_FILE_EXISTS rather than the generic
 * PARAMS_INVALID a Zod refinement would force.
 */

const RenderRegionParams = z
  .object({
    region_id: z
      .string()
      .min(1)
      .describe(
        "Region reference: `region:NAME` or `last_result:region:N`. GUID refs parse but resolve to REF_INVALID — REAPER 7 has no native region GUID API.",
      ),
    output_dir: z
      .string()
      .min(1)
      .describe(
        "Directory the WAV file is written into. Must exist and be writable; the bridge probes both before touching render settings. The output filename is always `<region_name>.wav`.",
      ),
  })
  .strict();

const RenderRegionResult = callTemplateResultSchema("render_region");

/**
 * Per-template wall-clock override. The bridge's internal deferred-completion
 * deadline is shorter (see `RENDER_INTERNAL_DEADLINE_S` in render.lua) so that
 * RENDER_TIMEOUT surfaces with its typed code before the MCP-side budget
 * trips BRIDGE_NOT_RUNNING.
 */
export const RENDER_REGION_TIMEOUT_MS = 60_000;

export const renderRegionDefinition: CapabilityDefinition<
  typeof RenderRegionParams,
  typeof RenderRegionResult
> = {
  name: "render_region",
  description:
    "Render one named project region to a WAV-24 stereo file at <output_dir>/<region_name>.wav. Render settings are snapshot/restored exactly once.",
  pack: "core",
  risk: "filesystem",
  mutates: true,
  // No undo point — `render_region` snapshots and restores REAPER's project
  // render settings inside the bridge call, so by the time the agent sees
  // the result there's nothing project-side to undo. The produced WAV file
  // lives outside the project state; deleting it is the agent's job.
  undoable: false,
  // Two calls with the same { region_id, output_dir } against the same
  // region content WOULD produce the same WAV bytes, but the SECOND call
  // returns OUTPUT_FILE_EXISTS (we refuse to overwrite). Pure-function
  // shape, but observably non-idempotent through the file system.
  idempotent: false,
  params: RenderRegionParams,
  result: RenderRegionResult,
  timeoutMs: RENDER_REGION_TIMEOUT_MS,
};
