import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileQueueClient } from "../../transport/file-queue.js";
import { startFakeBridge } from "../../transport/__tests__/fake-bridge.js";
import { getState } from "../get-state.js";

/**
 * Builds a fake selection envelope with the v0.1 response-budget shape.
 * Tests reference this so the metadata fields stay consistent.
 */
function fakeSelection(items: unknown[], extra: Partial<{
  total: number;
  truncated: boolean;
  response_bytes: number;
}> = {}): {
  selection: {
    items: unknown[];
    total: number;
    returned: number;
    truncated: boolean;
    response_bytes: number;
  };
} {
  return {
    selection: {
      items,
      total: extra.total ?? items.length,
      returned: items.length,
      truncated: extra.truncated ?? false,
      response_bytes: extra.response_bytes ?? 0,
    },
  };
}

describe("getState", () => {
  let queueDir: string;
  let client: FileQueueClient;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-getstate-"));
    client = new FileQueueClient({
      queueDir,
      initialPollIntervalMs: 10,
      maxPollIntervalMs: 20,
    });
    await client.init();
  });

  afterEach(async () => {
    await fs.rm(queueDir, { recursive: true, force: true });
  });

  it("returns empty-selection state from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    try {
      const result = await getState(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.selection.items).toEqual([]);
        expect(result.result.selection.total).toBe(0);
        expect(result.result.selection.returned).toBe(0);
        expect(result.result.selection.truncated).toBe(false);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("round-trips three items with non-ASCII names", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection(
        [
          {
            id: "guid:{AAA}",
            name: "テスト_01.wav",
            track_name: "SFX",
            position: 0,
            length: 1.5,
          },
          {
            id: "guid:{BBB}",
            name: "metal_hit.wav",
            track_name: "SFX",
            position: 2,
            length: 0.84,
          },
          {
            id: "guid:{CCC}",
            name: "重击_02.wav",
            track_name: "SFX",
            position: 4,
            length: 1.1,
          },
        ],
        { response_bytes: 612 },
      ),
    }));
    try {
      const result = await getState(client);
      expect(result.ok).toBe(true);
      if (result.ok) {
        const sel = result.result.selection;
        expect(sel.items).toHaveLength(3);
        expect(sel.items[0]!.name).toBe("テスト_01.wav");
        expect(sel.items[2]!.name).toBe("重击_02.wav");
        expect(sel.items.every((i) => i.id.startsWith("guid:"))).toBe(true);
        expect(sel.items.every((i) => i.id.length > "guid:".length)).toBe(true);
        expect(sel.total).toBe(3);
        expect(sel.returned).toBe(3);
        expect(sel.truncated).toBe(false);
        expect(sel.response_bytes).toBe(612);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("propagates the truncated + total metadata when the bridge caps the response", async () => {
    // Bridge says: there are 200 items selected; we returned 50 because of
    // the limit; truncated=true; rough byte count was 18432.
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection(
        Array.from({ length: 50 }, (_, i) => ({
          id: `guid:{X${i}}`,
          name: `item_${i}`,
          track_name: "T",
          position: i,
          length: 1,
        })),
        { total: 200, truncated: true, response_bytes: 18432 },
      ),
    }));
    try {
      const result = await getState(client, { limit: 50 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const sel = result.result.selection;
        expect(sel.items).toHaveLength(50);
        expect(sel.total).toBe(200);
        expect(sel.returned).toBe(50);
        expect(sel.truncated).toBe(true);
        expect(sel.response_bytes).toBe(18432);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces RESPONSE_TOO_LARGE from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "RESPONSE_TOO_LARGE",
        message: "Single selected item exceeds the 65536 byte response cap",
        recoverable: true,
      },
    }));
    try {
      const result = await getState(client);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RESPONSE_TOO_LARGE");
        expect(result.error.recoverable).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces SCOPE_NOT_IMPLEMENTED from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "SCOPE_NOT_IMPLEMENTED",
        message: "scope 'project' is not implemented in v0.1",
        recoverable: true,
      },
    }));
    try {
      const result = await getState(client, { scope: "project" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SCOPE_NOT_IMPLEMENTED");
        expect(result.error.recoverable).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("returns BRIDGE_NOT_RUNNING when no bridge responds in time", async () => {
    const result = await getState(client, { scope: "selection" }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BRIDGE_NOT_RUNNING");
    }
  });

  it("defaults scope to 'selection' and limit to 50 when called with no input", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    try {
      await getState(client);
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("get_state");
      expect(cmd.params).toEqual({ scope: "selection", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("forwards an explicit scope on the wire", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "SCOPE_NOT_IMPLEMENTED",
        message: "not yet",
        recoverable: true,
      },
    }));
    try {
      await getState(client, { scope: "regions" });
      expect(bridge.seen[0]!.params).toEqual({ scope: "regions", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("forwards an explicit limit on the wire", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    try {
      await getState(client, { limit: 10 });
      expect(bridge.seen[0]!.params).toEqual({ scope: "selection", limit: 10 });
    } finally {
      await bridge.stop();
    }
  });

  it("returns PARAMS_INVALID without hitting the bridge when limit exceeds 200", async () => {
    // No fake bridge started — Zod must reject before any queue write.
    const result = await getState(client, { limit: 9999 }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARAMS_INVALID");
      expect(result.error.recoverable).toBe(true);
      expect(result.error.message).toMatch(/limit/);
    }
  });

  it("returns PARAMS_INVALID for limit below 1", async () => {
    const result = await getState(client, { limit: 0 }, 100);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("PARAMS_INVALID");
    }
  });
});
