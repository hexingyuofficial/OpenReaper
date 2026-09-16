import { describe, it, expect } from "vitest";
import { evaluateStudioStartGate } from "../lib/orchestration/start-gate.mjs";

describe("Studio Start gate (face ↔ private Pi)", () => {
  it("passes when face-config is live, Pi is healthy, and /commands is non-empty", () => {
    const gate = evaluateStudioStartGate({
      piPlanMode: "start",
      faceConfig: {
        piMode: "rpc_background",
        piRpcUrl: "http://127.0.0.1:9/prompt",
        piCommandsUrl: "http://127.0.0.1:9/commands",
      },
      piHealthy: true,
      commandsCount: 3,
    });
    expect(gate.ok).toBe(true);
    expect(gate.reason).toBe("ok");
  });

  it("fails on pending face-config even if engine came up", () => {
    const gate = evaluateStudioStartGate({
      piPlanMode: "start",
      faceConfig: { piMode: "pending" },
      piHealthy: false,
      commandsCount: 0,
    });
    expect(gate.ok).toBe(false);
    expect(gate.reason).toBe("piMode_pending");
  });

  it("does not treat REAPER/engine as the gate when Pi is skipped", () => {
    const gate = evaluateStudioStartGate({
      piPlanMode: "skipped",
      faceConfig: { piMode: "skipped" },
      piHealthy: false,
      commandsCount: 0,
    });
    expect(gate.ok).toBe(true);
    expect(gate.skipped).toBe(true);
  });

  it("fails when URLs or health or commands are missing", () => {
    expect(
      evaluateStudioStartGate({
        piPlanMode: "start",
        faceConfig: { piMode: "rpc_background" },
        piHealthy: true,
        commandsCount: 2,
      }).reason,
    ).toBe("missing_rpc_urls");
    expect(
      evaluateStudioStartGate({
        piPlanMode: "start",
        faceConfig: {
          piMode: "rpc_background",
          piRpcUrl: "http://127.0.0.1:9/prompt",
          piCommandsUrl: "http://127.0.0.1:9/commands",
        },
        piHealthy: false,
        commandsCount: 2,
      }).reason,
    ).toBe("pi_rpc_unhealthy");
    expect(
      evaluateStudioStartGate({
        piPlanMode: "start",
        faceConfig: {
          piMode: "rpc_background",
          piRpcUrl: "http://127.0.0.1:9/prompt",
          piCommandsUrl: "http://127.0.0.1:9/commands",
        },
        piHealthy: true,
        commandsCount: 0,
      }).reason,
    ).toBe("empty_commands");
  });
});
