/**
 * Builtin slash hints for Step 1. Used when Pi `get_commands` is empty or
 * fails so typing `/` still shows something. Prefer live Pi commands when
 * `get_commands` returns a non-empty list.
 */
export const BUILTIN_HINTS = Object.freeze([
  { name: "help", description: "Show Pi help", source: "studio_hint" },
  { name: "new", description: "Start a new Pi session", source: "studio_hint" },
  { name: "compact", description: "Compact conversation context", source: "studio_hint" },
  { name: "model", description: "Show or change the current model", source: "studio_hint" },
  { name: "login", description: "Sign in a model provider (Studio private agent)", source: "studio_hint" },
]);

export function withBuiltinCommandFallback(commands) {
  if (Array.isArray(commands) && commands.length > 0) {
    return commands;
  }
  return [...BUILTIN_HINTS];
}
