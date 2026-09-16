import { buildPromptResponse } from "../../contracts/prompt.mjs";

function chipSummary(chips) {
  if (!chips.length) {
    return "no context chips";
  }
  return chips.map((chip) => chip.label).join(", ");
}

function piHint(studioState) {
  const mode = studioState?.pi?.mode;
  const agentDir = studioState?.pi?.agentDir ?? studioState?.piPrivate?.agentDir;
  if (mode === "absent") {
    return "Private Pi was not available when Studio started (install/vendor Pi for packaging).";
  }
  if (mode === "skipped") {
    return "Private Pi start was skipped (OPENREAPER_STUDIO_SKIP_PI=1).";
  }
  if (mode === "started" && studioState?.pi?.rpcPromptUrl) {
    return `Private Pi RPC was started but HTTP transport failed; agentDir=${agentDir ?? "?"}.`;
  }
  if (mode === "started") {
    return "Private Pi RPC host is running but no prompt URL is recorded in session state.";
  }
  return "Private Pi is not connected. Run Studio Start.";
}

function buildMockText(message, chips, studioState, options = {}) {
  const header = options.explicitFallback
    ? "[OpenReaper Studio — mock fallback]"
    : "[OpenReaper Studio mock]";
  return (
    `${header}\n` +
    `${piHint(studioState)}\n` +
    `Context: ${chipSummary(chips)}\n\n` +
    `You said:\n${message}\n\n` +
    `(Personal ~/.pi is never used by Studio.)`
  );
}

/**
 * Fallback transport when no live Pi RPC client is wired.
 * Extension point: replace by registering a `pi_stdio_rpc` transport later.
 */
export function mockTransport({ message, chips }, studioState, options = {}) {
  const mode =
    studioState?.pi?.mode === "started" && studioState?.pi?.rpcPromptUrl
      ? "mock_pi_rpc_unreachable"
      : "mock";
  const text = buildMockText(message, chips, studioState, options);
  return buildPromptResponse({ ok: true, mode, text });
}
