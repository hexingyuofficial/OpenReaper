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
 * track_create — exercise the on-wire contract, the locked envelope, and
 * the param-validation paths. The bridge-side LAST_RESULT.tracks routing
 * is verified by REAPER smoke test, not here (the fake bridge does not
 * model LAST_RESULT).
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

describe("callTemplate(track_create)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-tc-"));
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

  it("happy path: returns the locked envelope with a track guid", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_create", ["guid:{TRACK-1}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_create",
        params: { name: "Drums" },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("track_create");
        expect(result.result.changed_count).toBe(1);
        expect(result.result.changed_ids).toEqual(["guid:{TRACK-1}"]);
        expect(result.result.truncated).toBe(false);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: kind/name/params land verbatim after Zod validation", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_create", ["guid:{X}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "track_create",
        params: { name: "Impact Variations", index: 0, reuse_existing: true },
      });
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("track_create");
      expect(cmd.params).toEqual({
        name: "Impact Variations",
        index: 0,
        reuse_existing: true,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: empty name, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_create",
        params: { name: "" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/name/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: negative index, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_create",
        params: { name: "T", index: -1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: rejects unknown params via strict mode", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("track_create", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "track_create",
        params: { name: "T", surprise: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });
});
