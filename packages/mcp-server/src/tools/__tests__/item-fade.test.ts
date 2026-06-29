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
 * item_fade — first template to use the json.null sentinel. The headline
 * test here is the tri-state on-wire encoding:
 *   - absent → key not present on params
 *   - explicit null → key present with literal JSON null
 *   - number → key present with a number
 *
 * The Lua side translates the null into ctx.json.null and clears
 * D_FADEINLEN/D_FADEOUTLEN. We can't simulate that here, but we CAN assert
 * that the MCP layer transmits a true JSON null rather than dropping the
 * key (which would collapse the tri-state to bi-state on the wire).
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

describe("callTemplate(item_fade)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-if-"));
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

  it("happy path: numeric fade_in only", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", ["guid:{I}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_in: 0.5 },
      });
      expect(result.ok).toBe(true);
      const cmd = bridge.seen[0]!;
      expect(cmd.params).toEqual({ item_id: "selected:0", fade_in: 0.5 });
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: explicit null preserves the null on the wire", async () => {
    // This is the load-bearing test for the json.null sentinel: if the
    // MCP layer or fake-bridge round-trip silently drops nulls, the Lua
    // side can never distinguish "clear the fade" from "leave alone".
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", ["guid:{I}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_in: null, fade_out: 0.25 },
      });
      const cmd = bridge.seen[0]!;
      const params = cmd.params as Record<string, unknown>;
      expect(params).toHaveProperty("fade_in");
      expect(params.fade_in).toBeNull();
      expect(params.fade_out).toBe(0.25);
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: absent field is genuinely absent (no null injected)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", ["guid:{I}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_out: 1.0 },
      });
      const cmd = bridge.seen[0]!;
      const params = cmd.params as Record<string, unknown>;
      expect(params).not.toHaveProperty("fade_in");
      expect(params.fade_out).toBe(1.0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative fade_in is rejected", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_in: -0.1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/fade_in/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: Infinity is rejected (no JSON-null silent clear)", async () => {
    // Load-bearing regression. Without `.finite()` on the number branch of
    // FadeField, `fade_in: Infinity` survives the Zod union via the
    // `z.null()` branch (because `JSON.stringify(Infinity) === "null"`),
    // then reaches the Lua handler as the clear-fade sentinel — the agent
    // thinks they set a huge fade and silently get fade_in cleared instead.
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_in: Infinity },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/fade_in/);
      }
      // The bridge must not have seen a command — Zod has to reject before
      // the queue write, otherwise an Infinity-as-null wire payload reaches
      // Lua and clears the fade.
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: rejects unknown params via strict mode", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_fade", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_fade",
        params: { item_id: "selected:0", fade_middle: 0.1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });
});
