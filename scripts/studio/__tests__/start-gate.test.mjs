import { describe, it, expect } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { writeFaceConfig } from "../lib/face/runtime-config.mjs";
import { emptyStudioState, readStudioState } from "../lib/state.mjs";
import { studioStatePath } from "../lib/paths.mjs";
import { evaluateStudioStartGate, finishStudioStartGate } from "../lib/orchestration/start-gate.mjs";

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

  it("finishStudioStartGate succeeds with engineDegraded and does not throw", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-start-gate-ok-"));
    try {
      await writeFaceConfig(tmp, {
        piMode: "rpc_background",
        piRpcUrl: "http://127.0.0.1:9/prompt",
        piCommandsUrl: "http://127.0.0.1:9/commands",
        engineDegraded: true,
        openreaperStartExitCode: 124,
      });
      const state = emptyStudioState();
      state.engineDegraded = true;
      state.openreaperStartExitCode = 124;
      state.pi = {
        mode: "started",
        rpcHealthUrl: "http://127.0.0.1:9/health",
        commandsCount: 5,
      };
      const logs = [];
      const gate = await finishStudioStartGate({
        homeDir: tmp,
        state,
        piPlan: { mode: "start" },
        probePiRpcHealth: async () => true,
        log(message) {
          logs.push(message);
        },
      });
      expect(gate.ok).toBe(true);
      expect(state.startGate.ok).toBe(true);
      expect(state.engineDegraded).toBe(true);
      expect(state.openreaperStartExitCode).toBe(124);
      const saved = await readStudioState(studioStatePath(tmp));
      expect(saved?.startGate?.ok).toBe(true);
      expect(saved?.engineDegraded).toBe(true);
      expect(saved?.openreaperStartExitCode).toBe(124);
      expect(logs.join("\n")).toMatch(/engineDegraded=true/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("finishStudioStartGate throws so Start stays non-zero when Pi is not live", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-start-gate-fail-"));
    try {
      await writeFaceConfig(tmp, { piMode: "pending" });
      const state = emptyStudioState();
      state.engineDegraded = true;
      state.openreaperStartExitCode = 124;
      state.pi = { mode: "error", commandsCount: 1 };
      await expect(
        finishStudioStartGate({
          homeDir: tmp,
          state,
          piPlan: { mode: "start" },
          log() {},
        }),
      ).rejects.toThrow(/Studio Start gate failed/);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
