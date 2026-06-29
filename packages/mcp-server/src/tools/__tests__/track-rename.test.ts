import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CapabilityRegistry } from "@streetlight/core";
import { FileQueueClient } from "../../transport/file-queue.js";
import { startFakeBridge } from "../../transport/__tests__/fake-bridge.js";
import { callTemplate } from "../call-template.js";
import { registerCoreTemplates } from "../../templates/index.js";

function fakeTemplateOk(
  template: string,
  changedIds: string[],
): { ok: true; result: unknown } {
  return {
    ok: true,
    result: {
      template,
      changed_count: changedIds.length,
      changed_ids: changedIds,
      truncated: false,
    },
  };
}

describe("callTemplate(track_rename)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-tr-"));
    client = new FileQueueClient({
      queueDir,
      initialPollIntervalMs: 10,
      maxPollIntervalMs: 20,
    });
    await client.init();
    registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
  });

  afterEach(async () => {
    await fs.rm(queueDir, { recursive: true, force: true });
  });

  it("happy path: returns the track's GUID in the locked envelope", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_rename", ["guid:{TRACK-AAA}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_rename",
        params: { track_id: "track:Drums", name: "Drums (renamed)" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("track_rename");
        expect(result.result.changed_ids).toEqual(["guid:{TRACK-AAA}"]);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: track_id and name reach the bridge unchanged", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_rename", ["guid:{T}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "track_rename",
        params: { track_id: "last_result:track:0", name: "Bus A" },
      });
      const cmd = bridge.seen[0]!;
      expect(cmd.name).toBe("track_rename");
      expect(cmd.params).toEqual({
        track_id: "last_result:track:0",
        name: "Bus A",
      });
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces TRACK_NOT_FOUND from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "TRACK_NOT_FOUND",
        message: "No track named 'Drums'",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "track_rename",
        params: { track_id: "track:Drums", name: "Bass" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("TRACK_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: empty name", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_rename", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_rename",
        params: { track_id: "track:Drums", name: "" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: missing track_id", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_rename", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_rename",
        params: { name: "X" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/track_id/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });
});
