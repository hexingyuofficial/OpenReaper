import { buildPromptResponse } from "../../contracts/prompt.mjs";

/**
 * Optional HTTP transport for agent prompts (experiments / future bridge).
 * Set OPENREAPER_STUDIO_PI_RPC_URL to enable.
 */
export async function tryHttpRpcTransport({ message, chips }, env) {
  const rpcUrl = env.OPENREAPER_STUDIO_PI_RPC_URL?.trim();
  if (!rpcUrl) {
    return null;
  }
  try {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message, chips, source: "openreaper-studio" }),
    });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const body = await response.json();
    return buildPromptResponse({
      ok: true,
      mode: "http_rpc",
      text: String(body?.text ?? body?.reply ?? JSON.stringify(body)),
    });
  } catch (error) {
    return buildPromptResponse({
      ok: false,
      mode: "http_rpc_error",
      text: `HTTP RPC failed (${error?.message ?? error}).`,
    });
  }
}
