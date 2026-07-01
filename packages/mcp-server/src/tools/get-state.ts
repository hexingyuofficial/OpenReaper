import { z } from "zod";
import { parseArtifactRef, type ProjectState, type Result } from "@streetlight/core";
import type { FileQueueClient } from "../transport/file-queue.js";

/**
 * The full set of scopes named in ARCHITECTURE.md. Slice 01 implements
 * `selection`, `project`, `tracks`, and `regions`; `render` remains a
 * reserved spelling that the bridge rejects with SCOPE_NOT_IMPLEMENTED.
 */
export const GetStateScope = z.enum([
  "project",
  "tracks",
  "selection",
  "regions",
  "artifact",
  "render",
]);
export type GetStateScope = z.infer<typeof GetStateScope>;

/**
 * Response-budget backstop. See docs/RESPONSE_BUDGET.md.
 *
 * `limit` defaults to 50 and clamps to `[1, 200]`. The bridge applies the same
 * clamp; the TS-side clamp is a defense-in-depth so an LLM asking for a
 * 10000-item read gets a sensible response without round-tripping into Lua.
 */
export const DEFAULT_GET_STATE_LIMIT = 50;
export const MAX_GET_STATE_LIMIT = 200;
export const MIN_GET_STATE_LIMIT = 1;

export const GetStateInclude = z.enum(["fx"]);
export type GetStateInclude = z.infer<typeof GetStateInclude>;
export const GetStateArtifactView = z.enum(["summary", "payload"]);
export type GetStateArtifactView = z.infer<typeof GetStateArtifactView>;

export const GetStateInput = z
  .object({
    scope: GetStateScope.default("selection"),
    limit: z
      .number()
      .int()
      .min(MIN_GET_STATE_LIMIT)
      .max(MAX_GET_STATE_LIMIT)
      .default(DEFAULT_GET_STATE_LIMIT),
    include: z.array(GetStateInclude).optional(),
    artifact_ref: z.string().min(1).optional(),
    view: GetStateArtifactView.optional(),
  })
  .superRefine((input, ctx) => {
    if (input.include !== undefined && input.scope !== "tracks") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["include"],
        message: "include is only valid with scope='tracks'",
      });
    }
    if (input.scope === "artifact") {
      if (!input.artifact_ref) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifact_ref"],
          message: "artifact_ref is required when scope='artifact'",
        });
      } else if (!parseArtifactRef(input.artifact_ref)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["artifact_ref"],
          message: "artifact_ref must match artifact:<owner_pack>:<scope>:<id>",
        });
      }
    } else if (input.artifact_ref !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["artifact_ref"],
        message: "artifact_ref is only valid with scope='artifact'",
      });
    } else if (input.view !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["view"],
        message: "view is only valid with scope='artifact'",
      });
    }
  });
export type GetStateInput = z.infer<typeof GetStateInput>;

/** Read REAPER project state. Returns a Result; never throws. */
export async function getState(
  client: FileQueueClient,
  input: Partial<GetStateInput> = {},
  timeoutMs = 5000,
): Promise<Result<ProjectState>> {
  const parsed = GetStateInput.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: "PARAMS_INVALID",
        message: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
        recoverable: true,
      },
    };
  }
  const wire =
    parsed.data.scope === "artifact"
      ? { ...parsed.data, view: parsed.data.view ?? "summary" }
      : {
          scope: parsed.data.scope,
          limit: parsed.data.limit,
          ...(parsed.data.include !== undefined
            ? { include: parsed.data.include }
            : {}),
        };
  return client.send<ProjectState>("get_state", wire, { timeoutMs });
}
