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
  /** If true, the agent may reasonably retry or adjust and try again. */
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
