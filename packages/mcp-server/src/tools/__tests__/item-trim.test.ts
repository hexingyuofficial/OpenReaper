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

describe("callTemplate(item_trim)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-it-"));
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

  it("happy path: length only", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_trim", ["guid:{I}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_trim",
        params: { item_id: "selected:0", length: 2.5 },
      });
      expect(result.ok).toBe(true);
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({ item_id: "selected:0", length: 2.5 });
    } finally {
      await bridge.stop();
    }
  });

  it("happy path: length + start_offset", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_trim", ["guid:{I}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_trim",
        params: { item_id: "selected:0", length: 4, start_offset: 0.25 },
      });
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({
        item_id: "selected:0",
        length: 4,
        start_offset: 0.25,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative length", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_trim", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_trim",
        params: { item_id: "selected:0", length: -0.1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/length/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative start_offset", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_trim", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_trim",
        params: { item_id: "selected:0", length: 1, start_offset: -0.5 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });
});
