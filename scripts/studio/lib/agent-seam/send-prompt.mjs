import { buildPromptResponse, parsePromptRequest } from "../contracts/prompt.mjs";
import { tryHttpRpcTransport } from "./transports/http-rpc.mjs";
import { mockTransport } from "./transports/mock.mjs";

/**
 * Agent seam: face → Node → Pi/MCP (transports tried in order).
 *
 * Transport order (extension point — add entries in `TRANSPORTS`):
 * 1. http_rpc (OPENREAPER_STUDIO_PI_RPC_URL)
 * 2. mock (explicit fallback — session / face config set OPENREAPER_STUDIO_PI_RPC_URL)
 *
 * Studio Start runs studio-pi-rpc-host.mjs (pi --mode rpc on private agentDir) and writes piRpcUrl
 * into face-config-v1.json for REAPER ExecProcess sends.
 */
export const TRANSPORT_ORDER = Object.freeze(["http_rpc", "mock"]);

export async function sendStudioPrompt(rawPayload, studioState, env = process.env) {
  const request = parsePromptRequest(rawPayload);
  if (!request) {
    return buildPromptResponse({
      ok: false,
      mode: "error",
      text: "Message was empty or request was invalid.",
    });
  }

  const { message, chips } = request;

  const httpResult = await tryHttpRpcTransport({ message, chips }, env);
  if (httpResult?.ok) {
    return httpResult;
  }
  if (httpResult && !httpResult.ok && env.OPENREAPER_STUDIO_PI_RPC_URL?.trim()) {
    const mock = mockTransport({ message, chips }, studioState, { explicitFallback: true });
    return {
      ...httpResult,
      mode: "pi_rpc_fallback_mock",
      text: `${httpResult.text}\n\n${mock.text}`,
    };
  }

  const hasRpcConfigured =
    Boolean(env.OPENREAPER_STUDIO_PI_RPC_URL?.trim()) ||
    Boolean(studioState?.pi?.rpcPromptUrl?.trim());
  return mockTransport({ message, chips }, studioState, {
    explicitFallback: !hasRpcConfigured,
  });
}
