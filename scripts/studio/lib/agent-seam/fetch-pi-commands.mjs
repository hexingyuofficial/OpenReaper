import { resolveStudioPiCommandsUrl } from "./pi-rpc-urls.mjs";

const BUILTIN_HINTS = Object.freeze([
  { name: "help", description: "Pi help (requires live RPC)", source: "studio_hint" },
]);

/**
 * Fetch Pi slash commands via Studio RPC host GET /commands (Pi get_commands).
 */
export async function fetchPiCommands({ env = process.env, faceConfig, studioState } = {}) {
  const commandsUrl = resolveStudioPiCommandsUrl({ env, faceConfig, studioState });
  if (!commandsUrl) {
    return {
      ok: true,
      mode: "unavailable",
      commands: [],
      message: "Private Pi RPC is not running. Run Studio Start (slash palette needs Pi RPC).",
    };
  }
  try {
    const response = await fetch(commandsUrl, { signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    const commands = Array.isArray(body?.commands) ? body.commands : [];
    return {
      ok: true,
      mode: body?.mode ?? "pi_rpc",
      commands,
      cached: Boolean(body?.cached),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "error",
      commands: BUILTIN_HINTS,
      message: `Could not load Pi commands (${error?.message ?? error}).`,
    };
  }
}
