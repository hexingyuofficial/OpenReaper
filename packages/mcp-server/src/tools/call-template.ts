import { z } from "zod";
import {
  ErrorCodes,
  err,
  defaultPolicy,
  allow,
  type CallTemplateResult,
  type CapabilityRegistry,
  type Result,
  type RiskPolicy,
} from "@streetlight/core";
import type { FileQueueClient } from "../transport/file-queue.js";

/**
 * Input shape for the agent-facing `call_template` MCP tool.
 *
 * `params` is opaque at this layer — the per-template Zod schema in the
 * registry validates it. We do not enumerate parameter shapes here, so
 * adding a template never touches this file.
 */
export const CallTemplateInput = z.object({
  name: z.string().min(1),
  params: z.unknown().optional(),
});
export type CallTemplateInput = z.infer<typeof CallTemplateInput>;

/**
 * Default timeout for `call_template`. Five seconds is generous for the
 * synchronous mutating templates (item_pitch, region_create, etc.). Long-
 * running templates declare their own budget on the CapabilityDefinition
 * (`timeoutMs`); v0.1's only such template is `render_region` (60_000 ms).
 *
 * Resolution order, highest precedence first:
 *   1. Explicit `timeoutMs` arg to this function (used by tests and any
 *      future per-call override).
 *   2. `def.timeoutMs` from the CapabilityDefinition.
 *   3. `DEFAULT_CALL_TEMPLATE_TIMEOUT_MS`.
 */
export const DEFAULT_CALL_TEMPLATE_TIMEOUT_MS = 5000;

/**
 * MCP-facing wrapper for `call_template`.
 *
 * Validation chain:
 *   1. The input itself must shape up (`name` is a non-empty string).
 *   2. The named template must exist in the registry → otherwise
 *      `TEMPLATE_NOT_FOUND` is returned WITHOUT touching the queue.
 *   3. The template's `risk` must be allowed by the active policy →
 *      otherwise `RISK_BLOCKED` is returned WITHOUT touching the queue.
 *      v0.1 default policy permits `read` / `write_safe` / `filesystem`;
 *      `destructive` and `unsafe_eval` require an opt-in policy (v0.2 will
 *      expose env-var configuration).
 *   4. `params` must pass the template's registered Zod schema → otherwise
 *      `PARAMS_INVALID` is returned WITHOUT touching the queue.
 *   5. Only then do we write a wire command with kind="template",
 *      name=<template>, params=<validated params>.
 *
 * The result the bridge ships back is the locked `CallTemplateResult` shape.
 * No descriptor data ever rides along — see docs/RESPONSE_BUDGET.md.
 *
 * Mutation-timeout semantics (read this before adding auto-retry anywhere):
 * if the bridge has already picked up the command file (moved it to
 * `running/`) when our timeout fires, REAPER may still apply the mutation
 * but we will return `BRIDGE_NOT_RUNNING`. Agents must NOT auto-retry
 * mutating templates on this error code — re-running can double-apply. The
 * recovery path is to call `get_state` and inspect actual state.
 */
export async function callTemplate(
  client: FileQueueClient,
  registry: CapabilityRegistry,
  input: unknown,
  timeoutMs?: number,
  policy: RiskPolicy = defaultPolicy(),
): Promise<Result<CallTemplateResult>> {
  const shape = CallTemplateInput.safeParse(input);
  if (!shape.success) {
    return err(
      ErrorCodes.PARAMS_INVALID,
      shape.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
  }

  const def = registry.get(shape.data.name);
  if (!def) {
    return err(
      ErrorCodes.TEMPLATE_NOT_FOUND,
      `No template registered with name "${shape.data.name}"`,
    );
  }

  if (!allow(policy, def.risk)) {
    return err(
      ErrorCodes.RISK_BLOCKED,
      `Template "${def.name}" requires risk level "${def.risk}" which is not permitted by the active policy.`,
    );
  }

  const params = def.params.safeParse(shape.data.params ?? {});
  if (!params.success) {
    return err(
      ErrorCodes.PARAMS_INVALID,
      params.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .join("; "),
    );
  }

  const effectiveTimeout =
    timeoutMs ?? def.timeoutMs ?? DEFAULT_CALL_TEMPLATE_TIMEOUT_MS;

  return client.send<CallTemplateResult>(
    "template",
    params.data,
    { timeoutMs: effectiveTimeout, expectedDelta: def.expectedDelta },
    def.name,
  );
}
