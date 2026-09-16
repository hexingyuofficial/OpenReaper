import { buildPromptResponse, parsePromptRequest } from "../contracts/prompt.mjs";
import { tryHttpRpcTransport } from "./transports/http-rpc.mjs";
import { mockTransport } from "./transports/mock.mjs";

/**
 * Agent seam: face → Node → Pi/MCP (transports tried in order).
 *
 * Transport order (extension point — add entries in `TRANSPORTS`):
 * 1. http_rpc (OPENREAPER_STUDIO_PI_RPC_URL)
 * 2. mock (always available)
 *
 * Future: pi_stdio_rpc between http and mock when Studio owns the Pi process.
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
    return {
      ...httpResult,
      text: `${httpResult.text}\n\n${mockTransport({ message, chips }, studioState).text}`,
    };
  }

  return mockTransport({ message, chips }, studioState);
}
