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
 * media_import — verify Zod surface + on-wire shape + surfaced bridge errors
 * (MEDIA_NOT_FOUND). InsertMedia, selection snapshot/restore, and the
 * file existence probe all live in Lua; the REAPER smoke covers them.
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

describe("callTemplate(media_import)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-mi-"));
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

  it("happy path: locked envelope, new item guid", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("media_import", ["guid:{IMPORTED}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "media_import",
        params: {
          path: "/abs/path/to/sample.wav",
          track_id: "track:Variations",
          position: 0,
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("media_import");
        expect(result.result.changed_ids).toEqual(["guid:{IMPORTED}"]);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: kind/name/params land verbatim", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("media_import", ["guid:{X}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "media_import",
        params: {
          path: "/abs/sample.wav",
          track_id: "last_result:track:0",
          position: 3.5,
        },
      });
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("media_import");
      expect(cmd.params).toEqual({
        path: "/abs/sample.wav",
        track_id: "last_result:track:0",
        position: 3.5,
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: empty path, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("media_import", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "media_import",
        params: { path: "", track_id: "track:T", position: 0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/path/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("MEDIA_NOT_FOUND surfaces from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "MEDIA_NOT_FOUND",
        message: "Cannot read media file at path: /nope/missing.wav",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "media_import",
        params: {
          path: "/nope/missing.wav",
          track_id: "track:T",
          position: 0,
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("MEDIA_NOT_FOUND");
        expect(result.error.message).toMatch(/missing\.wav/);
      }
    } finally {
      await bridge.stop();
    }
  });
});
