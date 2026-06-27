/**
 * File queue command and result envelope types. The on-disk JSON shape MUST
 * match what the Lua bridge reads and writes.
 */

export type CommandKind = "template" | "ping" | "get_state" | "list_recipes";

export interface QueueCommand<P = unknown> {
  id: string;
  kind: CommandKind;
  /** Template name when `kind === "template"`. Empty otherwise. */
  name?: string;
  params: P;
  /** ISO 8601 UTC timestamp. */
  created_at: string;
}

export interface QueueResultEnvelope<R = unknown> {
  id: string;
  /** Matches the `id` of the originating QueueCommand. */
  ok: boolean;
  result?: R;
  error?: {
    code: string;
    message: string;
    recoverable: boolean;
    details?: Record<string, unknown>;
  };
  /** ISO 8601 UTC timestamp. */
  completed_at: string;
}

let counter = 0;

function pad(n: number, width: number): string {
  return String(n).padStart(width, "0");
}

/**
 * Produce a unique command ID with millisecond-stable lexicographic ordering.
 * Format: `cmd_YYYYMMDDHHMMSS_NNN` (UTC).
 *
 * NOTE: the counter wraps at 1000 per process. If two commands are issued in
 * the same UTC second AND the counter wraps, IDs may collide. The MCP server
 * is single-threaded for v0.1 so this is acceptable; revisit if we ever fan
 * out concurrent commands.
 */
export function makeCommandId(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1, 2);
  const d = pad(now.getUTCDate(), 2);
  const h = pad(now.getUTCHours(), 2);
  const mi = pad(now.getUTCMinutes(), 2);
  const s = pad(now.getUTCSeconds(), 2);
  counter = (counter + 1) % 1000;
  return `cmd_${y}${mo}${d}${h}${mi}${s}_${pad(counter, 3)}`;
}

/** For tests only. Reset the in-process counter. */
export function _resetCounterForTests(): void {
  counter = 0;
}
