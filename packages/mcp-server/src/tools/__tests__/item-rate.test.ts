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

describe("callTemplate(item_rate)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-ir-"));
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

  it("happy path", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_rate", ["guid:{I}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_rate",
        params: { item_id: "selected:0", rate: 0.5 },
      });
      expect(result.ok).toBe(true);
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({ item_id: "selected:0", rate: 0.5 });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: rate out of range", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_rate", []),
    );
    try {
      const slow = await callTemplate(client, registry, {
        name: "item_rate",
        params: { item_id: "selected:0", rate: 0.0 },
      });
      expect(slow.ok).toBe(false);
      if (!slow.ok) expect(slow.error.code).toBe("PARAMS_INVALID");

      const fast = await callTemplate(client, registry, {
        name: "item_rate",
        params: { item_id: "selected:0", rate: 10 },
      });
      expect(fast.ok).toBe(false);
      if (!fast.ok) expect(fast.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces TAKE_NOT_FOUND from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "TAKE_NOT_FOUND",
        message: "Item has no active take to rate",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "item_rate",
        params: { item_id: "selected:0", rate: 1.0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("TAKE_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });
});
