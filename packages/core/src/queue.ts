/**
 * File queue command and result envelope types. The on-disk JSON shape MUST
 * match what the Lua bridge reads and writes.
 *
 * ─── Protocol naming map ────────────────────────────────────────────────────
 * MCP tool                ↔ wire kind          ↔ wire name
 *   ping                  ↔ "ping"             ↔ (unused)
 *   get_state             ↔ "get_state"        ↔ (unused)
 *   list_recipes (v0.2+)  ↔ "list_recipes"     ↔ (unused)
 *   list_templates (TBD)  ↔ "list_templates"   ↔ (unused)
 *   call_template         ↔ "template"         ↔ template name (e.g. "item_pitch")
 *
 * The agent-facing MCP tool name and the bridge-facing wire kind are
 * deliberately decoupled. Do not collapse them — `call_template` is the
 * stable agent surface; "template" is the internal dispatch tag.
 */

export type CommandKind =
  | "ping"
  | "get_state"
  | "list_recipes"
  | "list_templates"
  | "template";

export interface QueueCommand<P = unknown> {
  id: string;
  kind: CommandKind;
  /** Template name when `kind === "template"`. Empty otherwise. */
  name?: string;
  params: P;
  /** Template structural verification spec when `kind === "template"`. */
  expected_delta?: unknown;
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
 * 24-bit hex suffix. Cryptographic strength is not required; we just need
 * an extra collision-resistance lever for cases the time+counter cannot
 * cover (process restart in the same millisecond, counter wrap, etc).
 */
function randomSuffix(rng: () => number = Math.random): string {
  const n = Math.floor(rng() * 0x1000000); // [0, 16777215]
  return n.toString(16).padStart(6, "0");
}

/** Injection seam used only by tests so output is deterministic. */
let rngForTests: (() => number) | null = null;

/**
 * Produce a unique command ID with millisecond-stable lexicographic
 * ordering. Format: `cmd_YYYYMMDDHHMMSSmmm_NNN_xxxxxx` (UTC).
 *
 * - The leading time prefix (down to milliseconds) keeps IDs sortable, so
 *   the bridge's FIFO scan (`table.sort` over filenames) still processes
 *   commands in arrival order even with millisecond resolution.
 * - The 3-digit counter disambiguates IDs produced within the same
 *   millisecond by the same process. It wraps at 1000.
 * - The 6-hex-digit random suffix is the collision backstop for the
 *   counter-wrap and process-restart cases that bit us in v0.0
 *   (~1-in-16M per same-ms collision). Sortable prefix is preserved.
 *
 * Step 3 starts shipping mutating commands; an ID collision would cause
 * a result file to be overwritten or claimed by the wrong caller, which
 * is silently dangerous. The hardened format closes that window.
 */
export function makeCommandId(now: Date = new Date()): string {
  const y = now.getUTCFullYear();
  const mo = pad(now.getUTCMonth() + 1, 2);
  const d = pad(now.getUTCDate(), 2);
  const h = pad(now.getUTCHours(), 2);
  const mi = pad(now.getUTCMinutes(), 2);
  const s = pad(now.getUTCSeconds(), 2);
  const ms = pad(now.getUTCMilliseconds(), 3);
  counter = (counter + 1) % 1000;
  const suffix = randomSuffix(rngForTests ?? Math.random);
  return `cmd_${y}${mo}${d}${h}${mi}${s}${ms}_${pad(counter, 3)}_${suffix}`;
}

/** For tests only. Reset the in-process counter. */
export function _resetCounterForTests(): void {
  counter = 0;
  rngForTests = null;
}

/** For tests only. Pin the random suffix so IDs are reproducible. */
export function _setRngForTests(rng: (() => number) | null): void {
  rngForTests = rng;
}
