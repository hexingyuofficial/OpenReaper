import { buildPromptResponse } from "../../contracts/prompt.mjs";

function chipSummary(chips) {
  if (!chips.length) {
    return "no context chips";
  }
  return chips.map((chip) => chip.label).join(", ");
}

function piHint(studioState) {
  const mode = studioState?.pi?.mode;
  if (mode === "absent") {
    return "Pi was not on PATH when Studio started.";
  }
  if (mode === "skipped") {
    return "Pi start was skipped (OPENREAPER_STUDIO_SKIP_PI=1).";
  }
  if (mode === "started") {
    return "Pi RPC process is running; stdio/socket client not attached yet.";
  }
  return "Pi RPC is not connected yet.";
}

function buildMockText(message, chips, studioState) {
  return (
    `[OpenReaper Studio mock]\n` +
    `${piHint(studioState)}\n` +
    `Context: ${chipSummary(chips)}\n\n` +
    `You said:\n${message}\n\n` +
    `(MCP tools still route through your configured Pi / MCP client.)`
  );
}

/**
 * Fallback transport when no live Pi RPC client is wired.
 * Extension point: replace by registering a `pi_stdio_rpc` transport later.
 */
export function mockTransport({ message, chips }, studioState) {
  const mode =
    studioState?.pi?.mode === "started" && studioState?.pi?.pid
      ? "mock_pi_running"
      : "mock";
  let text = buildMockText(message, chips, studioState);
  if (mode === "mock_pi_running") {
    text +=
      "\n\nSeam: implement `lib/agent-seam/transports/pi-stdio-rpc.mjs` " +
      "or set OPENREAPER_STUDIO_PI_RPC_URL.";
  }
  return buildPromptResponse({ ok: true, mode, text });
}
