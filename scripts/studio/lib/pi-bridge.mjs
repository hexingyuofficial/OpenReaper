import { readFile } from "node:fs/promises";

/**
 * Send a Studio prompt toward Pi/MCP.
 *
 * Real Pi RPC attach is not wired yet — Studio Start already spawns
 * `pi --mode rpc` when Pi is present. This function is the seam:
 * set OPENREAPER_STUDIO_PI_RPC_URL when the owned-process RPC contract lands.
 */
export async function sendStudioPrompt(payload, studioState, env = process.env) {
  const message = String(payload?.message ?? "").trim();
  const chips = Array.isArray(payload?.chips) ? payload.chips : [];
  if (!message) {
    return {
      ok: false,
      mode: "error",
      text: "Message was empty.",
    };
  }

  const chipSummary =
    chips.length === 0
      ? "no context chips"
      : chips.map((chip) => chip?.label ?? chip?.kind ?? "chip").join(", ");

  const rpcUrl = env.OPENREAPER_STUDIO_PI_RPC_URL?.trim();
  if (rpcUrl) {
    try {
      const response = await fetch(rpcUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message, chips, source: "openreaper-studio" }),
      });
      if (!response.ok) {
        throw new Error(`Pi RPC HTTP ${response.status}`);
      }
      const body = await response.json();
      return {
        ok: true,
        mode: "pi_rpc",
        text: String(body?.text ?? body?.reply ?? JSON.stringify(body)),
      };
    } catch (error) {
      return {
        ok: false,
        mode: "pi_rpc_error",
        text:
          `Pi RPC request failed (${error?.message ?? error}). ` +
          "Falling back to mock.\n\n" +
          buildMockReply(message, chipSummary, studioState),
      };
    }
  }

  const piMode = studioState?.pi?.mode;
  if (piMode === "started" && studioState?.pi?.pid) {
    return {
      ok: true,
      mode: "mock_pi_running",
      text:
        buildMockReply(message, chipSummary, studioState) +
        "\n\nTODO: attach Studio-owned `pi --mode rpc` stdio/socket client here " +
        "(set OPENREAPER_STUDIO_PI_RPC_URL for HTTP bridge experiments).",
    };
  }

  return {
    ok: true,
    mode: "mock",
    text: buildMockReply(message, chipSummary, studioState),
  };
}

function buildMockReply(message, chipSummary, studioState) {
  const piHint =
    studioState?.pi?.mode === "absent"
      ? "Pi was not on PATH when Studio started."
      : studioState?.pi?.mode === "skipped"
        ? "Pi start was skipped (OPENREAPER_STUDIO_SKIP_PI=1)."
        : "Pi RPC is not connected yet.";
  return (
    `[OpenReaper Studio mock]\n` +
    `${piHint}\n` +
    `Context: ${chipSummary}\n\n` +
    `You said:\n${message}\n\n` +
    `(MCP tools still route through your configured Pi / MCP client.)`
  );
}

export async function readPromptPayload(filePath) {
  const raw = await readFile(filePath, "utf8");
  return JSON.parse(raw);
}
