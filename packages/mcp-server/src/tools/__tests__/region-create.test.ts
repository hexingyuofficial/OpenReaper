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
 * region_create — exercise the on-wire contract, the locked envelope, the
 * XOR mode refinement, and the value-bounds checks. The actual bridge-side
 * uniqueness (REGION_NAME_TAKEN) and the changed_ids = "region:NAME" shape
 * are covered by the REAPER smoke; fake-bridge tests prove that bridge-
 * returned errors AND name-shaped IDs round-trip the envelope cleanly.
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

describe("callTemplate(region_create)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-rc-"));
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

  it("happy path (explicit mode): name-shaped ID survives the envelope", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", ["region:var_01"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "var_01", start: 0, end: 2 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("region_create");
        expect(result.result.changed_count).toBe(1);
        // Regions return name-shaped refs, NOT guid:{...}. The envelope
        // schema is `z.array(z.string())` so this passes through; if a
        // future refactor tightens it to a regex, this test will catch the
        // breakage.
        expect(result.result.changed_ids).toEqual(["region:var_01"]);
        expect(result.result.truncated).toBe(false);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: item-derived mode lands params verbatim", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", ["region:var_02"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "var_02", item_id: "last_result:item:0" },
      });
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("region_create");
      expect(cmd.params).toEqual({
        name: "var_02",
        item_id: "last_result:item:0",
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: refuses both modes at once", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "x", start: 0, end: 1, item_id: "selected:0" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/either.*or.*not both/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: refuses neither mode (just a name)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/required/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: explicit mode requires both bounds", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "x", start: 0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/start.*end|end.*start/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: end must be strictly greater than start", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("region_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "x", start: 2, end: 2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/strictly greater/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REGION_NAME_INVALID from the bridge for path-separator names", async () => {
    // Name-content rejection is a domain rule (matches REGION_NAME_TAKEN's
    // surface): TS only checks structural shape, the bridge owns the typed
    // error. This test pins the bridge → envelope round-trip; the actual
    // string check lives in reaper/packs/core/lib/names.lua and is covered
    // by the REAPER smoke. Same rule set re-runs at render time per Step 7 B1.
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "REGION_NAME_INVALID",
        message:
          "Region name 'bad/name' contains a forbidden character (path separator /, \\, NUL, or render-pattern token $)",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "bad/name", start: 0, end: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REGION_NAME_INVALID");
        expect(result.error.message).toMatch(/forbidden character/i);
      }
      // The bridge MUST have been hit — TS schema is structural only.
      expect(bridge.seen).toHaveLength(1);
      expect(bridge.seen[0]!.params).toEqual({
        name: "bad/name",
        start: 0,
        end: 1,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REGION_NAME_INVALID for $ and NUL (Step 7 B1 — render-pattern token + libc truncation)", async () => {
    // Two extra characters joined the forbidden set in Step 7: NUL (libc
    // path truncation) and $ (REAPER RENDER_PATTERN token prefix). Both
    // flow as REGION_NAME_INVALID via the same Lua helper. The TS schema's
    // min(1) does not reject them — confirms structural-only TS still holds.
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "REGION_NAME_INVALID",
        message:
          "Region name 'bad$name' contains a forbidden character (path separator /, \\, NUL, or render-pattern token $)",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "bad$name", start: 0, end: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REGION_NAME_INVALID");
      }
      expect(bridge.seen).toHaveLength(1);
      expect(bridge.seen[0]!.params).toEqual({
        name: "bad$name",
        start: 0,
        end: 1,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REGION_NAME_TAKEN from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "REGION_NAME_TAKEN",
        message: "A region named 'var_01' already exists",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "region_create",
        params: { name: "var_01", start: 0, end: 2 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REGION_NAME_TAKEN");
      }
    } finally {
      await bridge.stop();
    }
  });
});
