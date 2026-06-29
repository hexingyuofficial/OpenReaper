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

describe("callTemplate(item_move)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-im-"));
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

  it("happy path: position-only move", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_move", ["guid:{ITEM-X}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_move",
        params: { item_id: "selected:0", position: 4.5 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("item_move");
        expect(result.result.changed_ids).toEqual(["guid:{ITEM-X}"]);
      }
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({ item_id: "selected:0", position: 4.5 });
    } finally {
      await bridge.stop();
    }
  });

  it("happy path: position + reparent", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_move", ["guid:{ITEM-X}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_move",
        params: {
          item_id: "guid:{ITEM-X}",
          position: 0,
          to_track_id: "track:Drums",
        },
      });
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({
        item_id: "guid:{ITEM-X}",
        position: 0,
        to_track_id: "track:Drums",
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative position", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_move", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_move",
        params: { item_id: "selected:0", position: -1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/position/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces TRACK_NOT_FOUND when to_track_id can't be resolved", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "TRACK_NOT_FOUND",
        message: "No track named 'Ghost'",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "item_move",
        params: {
          item_id: "selected:0",
          position: 1,
          to_track_id: "track:Ghost",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("TRACK_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });
});
