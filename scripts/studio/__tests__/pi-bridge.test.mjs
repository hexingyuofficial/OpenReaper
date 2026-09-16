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

  it("returns mock_pi_running when Studio started Pi", async () => {
    const result = await sendStudioPrompt(
      { message: "mix bus", chips: [] },
      { pi: { mode: "started", pid: 4242 } },
    );
    expect(result.mode).toBe("mock_pi_running");
    expect(result.text).toContain("pi-stdio-rpc");
  });
});
