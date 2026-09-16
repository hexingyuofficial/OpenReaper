import { describe, it, expect } from "vitest";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  BRIDGE_LIVENESS_CONTRACT,
  LIVE_STARTUP_STAGE,
  STARTUP_STATUS_CONTRACT,
  inspectEngineTransport,
  probeOpenReaperEngine,
} from "../lib/engine/bridge-liveness.mjs";

describe("engine bridge liveness probe", () => {
  it("treats a fresh heartbeat or bridge_dofile_succeeded as usable", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-liveness-"));
    const transportDir = path.join(tmp, "session", "transport");
    await mkdir(transportDir, { recursive: true });
    const now = Date.now();
    try {
      await writeFile(
        path.join(transportDir, "openreaper-bridge-liveness-v1.json"),
        `${JSON.stringify({
          contract: BRIDGE_LIVENESS_CONTRACT,
          active_owner: "openreaper-alpha",
          active_generation: 1,
          sequence: 2,
          refreshed_at_unix_s: Math.floor(now / 1000),
        })}\n`,
        "utf8",
      );
      await writeFile(
        path.join(transportDir, "openreaper-startup-status-v1.json"),
        `${JSON.stringify({
          contract: STARTUP_STATUS_CONTRACT,
          stage: LIVE_STARTUP_STAGE,
        })}\n`,
        "utf8",
      );
      const live = await inspectEngineTransport({ transportDir, now });
      expect(live.usable).toBe(true);
      expect(live.heartbeatReady).toBe(true);
      expect(live.stage).toBe(LIVE_STARTUP_STAGE);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("accepts bridge_dofile_succeeded even when heartbeat is missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-liveness-stage-"));
    const transportDir = path.join(tmp, "session", "transport");
    await mkdir(transportDir, { recursive: true });
    try {
      await writeFile(
        path.join(transportDir, "openreaper-startup-status-v1.json"),
        `${JSON.stringify({
          contract: STARTUP_STATUS_CONTRACT,
          stage: LIVE_STARTUP_STAGE,
        })}\n`,
        "utf8",
      );
      const probed = await probeOpenReaperEngine({ transportDir, graceMs: 0 });
      expect(probed.usable).toBe(true);
      expect(probed.heartbeatReady).toBe(false);
      expect(probed.reason).toBe("bridge_dofile_succeeded");
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });

  it("is not usable when transport files are missing", async () => {
    const tmp = await mkdtemp(path.join(os.tmpdir(), "or-liveness-empty-"));
    try {
      const probed = await probeOpenReaperEngine({
        installRoot: tmp,
        graceMs: 0,
      });
      expect(probed.usable).toBe(false);
    } finally {
      await rm(tmp, { recursive: true, force: true });
    }
  });
});
