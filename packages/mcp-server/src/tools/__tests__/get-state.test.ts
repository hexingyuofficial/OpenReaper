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

function fakeList(
  key: "tracks" | "regions",
  items: unknown[],
  extra: Partial<{
    total: number;
    truncated: boolean;
    response_bytes: number;
  }> = {},
): Record<"tracks" | "regions", unknown> {
  return {
    [key]: {
      items,
      total: extra.total ?? items.length,
      returned: items.length,
      truncated: extra.truncated ?? false,
      response_bytes: extra.response_bytes ?? 0,
    },
  } as Record<"tracks" | "regions", unknown>;
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

  it("returns project state from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: {
        project: {
          bpm: 128,
          time_sig_num: 4,
          time_sig_den: 4,
          sample_rate: 48000,
          length_seconds: 12.5,
        },
      },
    }));
    try {
      const result = await getState(client, { scope: "project" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.project).toEqual({
          bpm: 128,
          time_sig_num: 4,
          time_sig_den: 4,
          sample_rate: 48000,
          length_seconds: 12.5,
        });
      }
      expect(bridge.seen[0]!.params).toEqual({ scope: "project", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("returns track descriptors from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", [
        {
          id: "guid:{TRACK-A}",
          name: "Drums",
          index: 0,
          depth: 0,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          recarm: true,
        },
        {
          id: "guid:{TRACK-B}",
          name: "Impacts",
          index: 1,
          depth: 1,
          volume: 0.75,
          pan: -0.2,
          mute: false,
          solo: true,
          recarm: false,
        },
      ], { response_bytes: 248 }),
    }));
    try {
      const result = await getState(client, { scope: "tracks" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const tracks = result.result.tracks;
        expect(tracks.items).toHaveLength(2);
        expect(tracks.items[0]).toMatchObject({
          id: "guid:{TRACK-A}",
          name: "Drums",
          index: 0,
          depth: 0,
          recarm: true,
        });
        expect(tracks.items[1]).toMatchObject({
          id: "guid:{TRACK-B}",
          name: "Impacts",
          index: 1,
          depth: 1,
          solo: true,
        });
        expect(tracks.response_bytes).toBe(248);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("returns region descriptors from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("regions", [
        { name: "var_01", start: 0, end: 1.2 },
        { name: "var_02", start: 2, end: 3.5 },
      ], { response_bytes: 88 }),
    }));
    try {
      const result = await getState(client, { scope: "regions" });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const regions = result.result.regions;
        expect(regions.items).toEqual([
          { name: "var_01", start: 0, end: 1.2 },
          { name: "var_02", start: 2, end: 3.5 },
        ]);
        expect(regions.total).toBe(2);
        expect(regions.returned).toBe(2);
        expect(regions.truncated).toBe(false);
      }
      expect(bridge.seen[0]!.params).toEqual({ scope: "regions", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces SCOPE_NOT_IMPLEMENTED from the bridge for reserved render scope", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "SCOPE_NOT_IMPLEMENTED",
        message: "scope 'render' is not implemented in v0.1",
        recoverable: true,
      },
    }));
    try {
      const result = await getState(client, { scope: "render" });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("SCOPE_NOT_IMPLEMENTED");
        expect(result.error.recoverable).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("returns artifact summary state from the bridge", async () => {
    const ref =
      "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd";
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: {
        artifact: {
          ref,
          id: "art_20260701010101999_000_ab12cd",
          scope: "probe",
          owner_pack: "pack_contract_fixture",
          producer_template: "fixture_artifact_probe",
          schema: "openreaper.fixture.probe.v1",
          created_at: "2026-07-01T01:01:01.999Z",
          summary: { label: "S21 artifact smoke" },
          view: "summary",
          truncated: false,
          response_bytes: 512,
        },
      },
    }));
    try {
      const result = await getState(client, { scope: "artifact", artifact_ref: ref });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.artifact?.ref).toBe(ref);
        expect(result.result.artifact?.summary).toEqual({
          label: "S21 artifact smoke",
        });
        expect(result.result.artifact).not.toHaveProperty("payload");
      }
      expect(bridge.seen[0]!.params).toEqual({
        scope: "artifact",
        limit: 50,
        artifact_ref: ref,
        view: "summary",
      });
    } finally {
      await bridge.stop();
    }
  });

  it("returns artifact payload state from the bridge", async () => {
    const ref =
      "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd";
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: {
        artifact: {
          ref,
          id: "art_20260701010101999_000_ab12cd",
          scope: "probe",
          owner_pack: "pack_contract_fixture",
          producer_template: "fixture_artifact_probe",
          schema: "openreaper.fixture.probe.v1",
          created_at: "2026-07-01T01:01:01.999Z",
          summary: { label: "S21 artifact smoke" },
          payload: { label: "S21 artifact smoke", note: "fixture-only payload" },
          view: "payload",
          truncated: false,
          response_bytes: 768,
        },
      },
    }));
    try {
      const result = await getState(client, {
        scope: "artifact",
        artifact_ref: ref,
        view: "payload",
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.artifact?.payload).toEqual({
          label: "S21 artifact smoke",
          note: "fixture-only payload",
        });
      }
      expect(bridge.seen[0]!.params).toEqual({
        scope: "artifact",
        limit: 50,
        artifact_ref: ref,
        view: "payload",
      });
    } finally {
      await bridge.stop();
    }
  });

  it.each(["ARTIFACT_NOT_FOUND", "ARTIFACT_INVALID", "RESPONSE_TOO_LARGE"] as const)(
    "surfaces %s from artifact reads",
    async (code) => {
      const bridge = startFakeBridge(queueDir, () => ({
        ok: false,
        error: {
          code,
          message: `${code} from bridge`,
          recoverable: true,
        },
      }));
      try {
        const result = await getState(client, {
          scope: "artifact",
          artifact_ref:
            "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
        });
        expect(result.ok).toBe(false);
        if (!result.ok) expect(result.error.code).toBe(code);
      } finally {
        await bridge.stop();
      }
    },
  );

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
      ok: true,
      result: fakeList("regions", []),
    }));
    try {
      await getState(client, { scope: "regions" });
      expect(bridge.seen[0]!.params).toEqual({ scope: "regions", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("omits include when the caller does not request FX metadata", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", []),
    }));
    try {
      await getState(client, { scope: "tracks" });
      expect(bridge.seen[0]!.params).toEqual({ scope: "tracks", limit: 50 });
    } finally {
      await bridge.stop();
    }
  });

  it("forwards include: [] on the wire without adding FX fields", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", [
        {
          id: "guid:{TRACK-A}",
          name: "No FX",
          index: 0,
          depth: 0,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          recarm: false,
        },
      ]),
    }));
    try {
      const result = await getState(client, { scope: "tracks", include: [] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.tracks.items[0]).not.toHaveProperty("fx");
      }
      expect(bridge.seen[0]!.params).toEqual({
        scope: "tracks",
        limit: 50,
        include: [],
      });
    } finally {
      await bridge.stop();
    }
  });

  it("forwards include: ['fx'] and parses FX descriptors", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", [
        {
          id: "guid:{TRACK-A}",
          name: "FX Track",
          index: 0,
          depth: 0,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          recarm: false,
          fx: [
            {
              index: 0,
              name: "VST: ReaEQ (Cockos)",
              ident: "VST: ReaEQ (Cockos)<1920167789>",
              enabled: true,
              preset_name: "",
            },
          ],
        },
        {
          id: "guid:{TRACK-B}",
          name: "Empty FX Track",
          index: 1,
          depth: 0,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          recarm: false,
          fx: [],
        },
      ], { response_bytes: 340 }),
    }));
    try {
      const result = await getState(client, { scope: "tracks", include: ["fx"] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        const tracks = result.result.tracks;
        expect(tracks.items[0]!.fx).toEqual([
          {
            index: 0,
            name: "VST: ReaEQ (Cockos)",
            ident: "VST: ReaEQ (Cockos)<1920167789>",
            enabled: true,
            preset_name: "",
          },
        ]);
        expect(tracks.items[1]!.fx).toEqual([]);
      }
      expect(bridge.seen[0]!.params).toEqual({
        scope: "tracks",
        limit: 50,
        include: ["fx"],
      });
    } finally {
      await bridge.stop();
    }
  });

  it("returns PARAMS_INVALID for unknown include values without hitting the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", []),
    }));
    const result = await getState(
      client,
      { scope: "tracks", include: ["fx", "midi"] } as never,
      100,
    );
    try {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/include/);
        expect(result.error.message).toMatch(/Invalid enum value/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it.each(["selection", "project", "regions", "render"] as const)(
    "returns PARAMS_INVALID for include on %s scope before hitting the bridge",
    async (scope) => {
      const bridge = startFakeBridge(queueDir, () => ({
        ok: true,
        result: fakeSelection([]),
      }));
      const result = await getState(client, { scope, include: ["fx"] }, 100);
      try {
        expect(result.ok).toBe(false);
        if (!result.ok) {
          expect(result.error.code).toBe("PARAMS_INVALID");
          expect(result.error.message).toMatch(/scope='tracks'/);
        }
        expect(bridge.seen).toHaveLength(0);
      } finally {
        await bridge.stop();
      }
    },
  );

  it("requires artifact_ref for artifact scope before hitting the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    const result = await getState(client, { scope: "artifact" }, 100);
    try {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/artifact_ref/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("rejects malformed artifact refs before hitting the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    const result = await getState(
      client,
      { scope: "artifact", artifact_ref: "../bad" },
      100,
    );
    try {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/artifact:<owner_pack>/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("rejects artifact-only options on non-artifact scopes before hitting the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeSelection([]),
    }));
    const result = await getState(
      client,
      {
        scope: "selection",
        artifact_ref:
          "artifact:pack_contract_fixture:probe:art_20260701010101999_000_ab12cd",
      },
      100,
    );
    try {
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/artifact_ref/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("parses a truncated tracks-with-FX envelope from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: true,
      result: fakeList("tracks", [
        {
          id: "guid:{TRACK-A}",
          name: "Returned",
          index: 0,
          depth: 0,
          volume: 1,
          pan: 0,
          mute: false,
          solo: false,
          recarm: false,
          fx: [],
        },
      ], { total: 2, truncated: true, response_bytes: 120 }),
    }));
    try {
      const result = await getState(client, { scope: "tracks", include: ["fx"] });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.tracks.items).toHaveLength(1);
        expect(result.result.tracks.total).toBe(2);
        expect(result.result.tracks.returned).toBe(1);
        expect(result.result.tracks.truncated).toBe(true);
      }
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
