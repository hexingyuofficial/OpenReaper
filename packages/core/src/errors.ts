/**
 * Typed error codes used across the kernel, the MCP server, and the Lua bridge.
 *
 * The Lua bridge MUST use the same string codes when it writes result JSON,
 * so this list is the contract between the TypeScript side and the Lua side.
 */
export const ErrorCodes = {
  // Reference resolution
  ITEM_NOT_FOUND: "ITEM_NOT_FOUND",
  TAKE_NOT_FOUND: "TAKE_NOT_FOUND",
  TRACK_NOT_FOUND: "TRACK_NOT_FOUND",
  REGION_NOT_FOUND: "REGION_NOT_FOUND",
  REF_INVALID: "REF_INVALID",

  // Media
  // Raised by media_import when the supplied path cannot be opened by the
  // REAPER process — typo'd path, permissions, unmounted drive. Distinct
  // from INTERNAL_ERROR so agents can tell "wrong input" from "bridge
  // crashed mid-call".
  MEDIA_NOT_FOUND: "MEDIA_NOT_FOUND",

  // Region
  REGION_NAME_TAKEN: "REGION_NAME_TAKEN",
  REGION_NAME_INVALID: "REGION_NAME_INVALID",

  // Render
  OUTPUT_DIR_MISSING: "OUTPUT_DIR_MISSING",
  OUTPUT_DIR_NOT_WRITABLE: "OUTPUT_DIR_NOT_WRITABLE",
  OUTPUT_FILE_EXISTS: "OUTPUT_FILE_EXISTS",
  RENDER_TIMEOUT: "RENDER_TIMEOUT",
  RENDER_FILE_EMPTY: "RENDER_FILE_EMPTY",

  // Transport
  BRIDGE_NOT_RUNNING: "BRIDGE_NOT_RUNNING",
  BRIDGE_TIMEOUT: "BRIDGE_TIMEOUT",

  // Dispatch
  TEMPLATE_NOT_FOUND: "TEMPLATE_NOT_FOUND",
  PARAMS_INVALID: "PARAMS_INVALID",
  SCOPE_NOT_IMPLEMENTED: "SCOPE_NOT_IMPLEMENTED",
  RISK_BLOCKED: "RISK_BLOCKED",

  // Response budget
  // Raised by the bridge when even the first item of a list-shaped response
  // would exceed MAX_RESPONSE_BYTES. Soft truncation (returned < total,
  // truncated: true) is NOT an error — only the "can't fit one" case is.
  // See docs/RESPONSE_BUDGET.md.
  RESPONSE_TOO_LARGE: "RESPONSE_TOO_LARGE",

  // Last resort
  INTERNAL_ERROR: "INTERNAL_ERROR",
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface StreetlightError {
  code: ErrorCode;
  message: string;
  /**
   * If true, the agent may reasonably **adjust and try again** (e.g.
   * different params, fix selection, retry a read-only call). NOT a
   * blanket "safe to auto-retry the same command" flag.
   *
   * Counter-example pinned in Step 3: a mutating `call_template` that
   * returns `BRIDGE_NOT_RUNNING` is still `recoverable: true`, but
   * blind auto-retry can double-apply the mutation. The agent must
   * call `get_state` to inspect actual state and decide whether the
   * mutation already landed. See `tools/call-template.ts` jsdoc and
   * the MCP tool description for the locked contract.
   */
  recoverable: boolean;
  /** Optional structured context. Never put secrets here. */
  details?: Record<string, unknown>;
}

/**
 * Errors that are non-recoverable by default. Callers may still override via
 * the `recoverable` option on `err()`.
 */
const NON_RECOVERABLE: ReadonlySet<ErrorCode> = new Set<ErrorCode>([
  ErrorCodes.INTERNAL_ERROR,
]);

export function defaultRecoverable(code: ErrorCode): boolean {
  return !NON_RECOVERABLE.has(code);
}
