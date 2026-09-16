import { resolveStudioPiCommandsUrl } from "./pi-rpc-urls.mjs";
import { BUILTIN_HINTS, withBuiltinCommandFallback } from "./pi-command-hints.mjs";

export { BUILTIN_HINTS, withBuiltinCommandFallback } from "./pi-command-hints.mjs";

/**
 * Fetch Pi slash commands via Studio RPC host GET /commands (Pi get_commands).
 * Empty success and fetch errors fall back to Studio builtin hints so `/` is never empty.
 */
export async function fetchPiCommands({ env = process.env, faceConfig, studioState } = {}) {
  const commandsUrl = resolveStudioPiCommandsUrl({ env, faceConfig, studioState });
  if (!commandsUrl) {
    return {
      ok: true,
      mode: "unavailable",
      commands: withBuiltinCommandFallback([]),
      fallback: true,
      message: "Private Pi RPC is not running. Run Studio Start (slash palette needs Pi RPC).",
    };
  }
  try {
    const response = await fetch(commandsUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    const raw = Array.isArray(body?.commands) ? body.commands : [];
    const commands = withBuiltinCommandFallback(raw);
    const fallback = raw.length === 0;
    return {
      ok: true,
      mode: body?.mode ?? "pi_rpc",
      commands,
      cached: Boolean(body?.cached),
      fallback,
      message: fallback
        ? (body?.message ?? "Pi returned no slash commands; showing Studio builtin hints.")
        : body?.message,
    };
  } catch (error) {
    return {
      ok: false,
      mode: "error",
      commands: withBuiltinCommandFallback([]),
      fallback: true,
      message: `Could not load Pi commands (${error?.message ?? error}).`,
    };
  }
}
