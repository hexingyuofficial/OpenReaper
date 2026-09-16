import { describe, it, expect } from "vitest";
import { sendStudioPrompt } from "../lib/pi-bridge.mjs";

describe("sendStudioPrompt", () => {
  it("rejects empty messages", async () => {
    const result = await sendStudioPrompt({ message: "  " }, null);
    expect(result.ok).toBe(false);
  });

  it("returns mock mode when Pi was not started", async () => {
    const result = await sendStudioPrompt(
      { message: "hello", chips: [{ kind: "track", label: "Track 1" }] },
      { pi: { mode: "absent" } },
    );
    expect(result.ok).toBe(true);
    expect(result.mode).toBe("mock");
    expect(result.text).toContain("hello");
    expect(result.text).toContain("Track 1");
  });

  it("returns mock when Studio started Pi but RPC URL is not configured", async () => {
    const result = await sendStudioPrompt(
      { message: "mix bus", chips: [] },
      { pi: { mode: "started", pid: 4242 } },
    );
    expect(result.mode).toBe("mock");
    expect(result.text).toContain("Personal ~/.pi is never used");
  });

  it("uses http_rpc when OPENREAPER_STUDIO_PI_RPC_URL responds", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => ({
      ok: true,
      json: async () => ({ text: "from private pi" }),
    });
    const result = await sendStudioPrompt(
      { message: "hello", chips: [] },
      { pi: { mode: "started", rpcPromptUrl: "http://127.0.0.1:9/prompt" } },
      { OPENREAPER_STUDIO_PI_RPC_URL: "http://127.0.0.1:9/prompt" },
    );
    globalThis.fetch = originalFetch;
    expect(result.mode).toBe("http_rpc");
    expect(result.text).toBe("from private pi");
  });
});
