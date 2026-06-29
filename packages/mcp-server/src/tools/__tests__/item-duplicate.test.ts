import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CapabilityRegistry } from "@streetlight/core";
import { FileQueueClient } from "../../transport/file-queue.js";
import { startFakeBridge } from "../../transport/__tests__/fake-bridge.js";
import { callTemplate } from "../call-template.js";
import { registerCoreTemplates } from "../../templates/index.js";

/**
 * item_duplicate — verify the on-wire contract and Zod surface. The actual
 * source-copy / position-set behavior lives in the Lua handler and is
 * covered by the REAPER smoke test, since the fake bridge doesn't model
 * MediaItem state.
 */

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

describe("callTemplate(item_duplicate)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-id-"));
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

  it("happy path: locked envelope returns the new item guid", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_duplicate", ["guid:{DUP-1}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_duplicate",
        params: {
          item_id: "selected:0",
          track_id: "track:Variations",
          position: 4.0,
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("item_duplicate");
        expect(result.result.changed_ids).toEqual(["guid:{DUP-1}"]);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: kind/name/params land verbatim", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_duplicate", ["guid:{X}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_duplicate",
        params: {
          item_id: "last_result:item:0",
          track_id: "last_result:track:0",
          position: 0,
        },
      });
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("item_duplicate");
      expect(cmd.params).toEqual({
        item_id: "last_result:item:0",
        track_id: "last_result:track:0",
        position: 0,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: missing track_id, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_duplicate", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_duplicate",
        params: { item_id: "selected:0", position: 0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative position, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_duplicate", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_duplicate",
        params: { item_id: "selected:0", track_id: "track:T", position: -1 },
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

  it("ITEM_NOT_FOUND surfaces from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "ITEM_NOT_FOUND",
        message: "selected:0 out of range (selection has 0 items)",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "item_duplicate",
        params: { item_id: "selected:0", track_id: "track:T", position: 0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("ITEM_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });
});
