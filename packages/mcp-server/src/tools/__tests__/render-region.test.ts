import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { CapabilityRegistry } from "@streetlight/core";
import { FileQueueClient } from "../../transport/file-queue.js";
import { startFakeBridge } from "../../transport/__tests__/fake-bridge.js";
import { callTemplate } from "../call-template.js";
import { registerCoreTemplates } from "../../templates/index.js";
import {
  renderRegionDefinition,
  RENDER_REGION_TIMEOUT_MS,
} from "../../templates/render-region.js";

/**
 * render_region — the deferred-completion mechanics live entirely in
 * streetlight_bridge.lua + render.lua and only surface in the live REAPER
 * smoke. Here we cover the things the fake bridge CAN reach:
 *
 *   * Locked call_template envelope round-trip with an artifact-path
 *     `changed_ids` (the deliberate carve-out — every other template uses
 *     project-entity refs).
 *   * On-wire shape: kind=template, name=render_region, params verbatim.
 *   * TS-side structural rejection (PARAMS_INVALID) for missing /
 *     empty / extra fields. Domain rules (path existence, writability,
 *     collisions, region resolution) deliberately live one layer deeper
 *     in render.lua — every domain code (OUTPUT_DIR_MISSING /
 *     OUTPUT_DIR_NOT_WRITABLE / OUTPUT_FILE_EXISTS / REGION_NOT_FOUND /
 *     REF_INVALID / RENDER_TIMEOUT / RENDER_FILE_EMPTY) gets a
 *     bridge-surfaced round-trip test so the envelope is proven to pass
 *     them through unchanged.
 *   * `renderRegionDefinition.timeoutMs` is 60_000 — the wire-level
 *     override the file-queue client should pull instead of the
 *     5_000 ms default.
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

function fakeError(
  code: string,
  message: string,
): { ok: false; error: { code: string; message: string; recoverable: boolean } } {
  return {
    ok: false,
    error: { code, message, recoverable: true },
  };
}

describe("callTemplate(render_region)", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-rr-"));
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

  it("happy path: artifact-path changed_ids round-trips the locked envelope", async () => {
    // render_region is the documented carve-out: changed_ids holds an
    // absolute file path rather than a project-entity ref. The envelope
    // schema is `z.array(z.string()).max(50)` so this passes through; a
    // future refactor that tightens it to a `guid:` regex would break
    // this test deliberately.
    const expectedPath = "/tmp/streetlight-smoke/var_01.wav";
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", [expectedPath]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: {
          region_id: "region:var_01",
          output_dir: "/tmp/streetlight-smoke",
        },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("render_region");
        expect(result.result.changed_count).toBe(1);
        expect(result.result.changed_ids).toEqual([expectedPath]);
        expect(result.result.truncated).toBe(false);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: cmd shape is { kind: template, name, params } verbatim", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", ["/x/y.wav"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "render_region",
        params: {
          region_id: "last_result:region:0",
          output_dir: "/x",
        },
      });
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("render_region");
      expect(cmd.params).toEqual({
        region_id: "last_result:region:0",
        output_dir: "/x",
      });
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: missing region_id (bridge never hit)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/region_id/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: missing output_dir (bridge never hit)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/output_dir/i);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: empty region_id is rejected by min(1)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: empty output_dir is rejected by min(1)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID: extra field (strict mode)", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("render_region", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: {
          region_id: "region:var_01",
          output_dir: "/x",
          format: "mp3", // not allowed in v0.1; hardcoded WAV-24
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces OUTPUT_DIR_MISSING from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeError("OUTPUT_DIR_MISSING", "output_dir does not exist: /nope"),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/nope" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUTPUT_DIR_MISSING");
        expect(result.error.message).toMatch(/does not exist/i);
      }
      // Bridge MUST have been hit — TS is structural only; this is the
      // bridge's domain check, not Zod.
      expect(bridge.seen).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces OUTPUT_DIR_NOT_WRITABLE from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "OUTPUT_DIR_NOT_WRITABLE",
        "Could not write probe file into output_dir: /readonly",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/readonly" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUTPUT_DIR_NOT_WRITABLE");
      }
      expect(bridge.seen).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces OUTPUT_FILE_EXISTS from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "OUTPUT_FILE_EXISTS",
        "Output file already exists (v0.1 refuses to overwrite): /x/var_01.wav",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUTPUT_FILE_EXISTS");
        expect(result.error.message).toMatch(/refuses to overwrite/i);
      }
      expect(bridge.seen).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces OUTPUT_FILE_EXISTS for a pre-existing .wav.RPP sidecar (Step 7 path-B preflight)", async () => {
    // Step 7 third mid-smoke: REAPER auto-writes a `<wav>.RPP` project-
    // copy sidecar next to the render when the Render-dialog "save copy
    // of project to outfile" checkbox is on, and stock REAPER 7.71's
    // ReaScript surface has no setter to suppress it. v0.1 honors the
    // WAV-only artifact contract via preflight no-clobber + post-render
    // cleanup; this case pins the preflight rejection round-trip so the
    // typed code carries the sidecar path. The actual `file_exists`
    // check lives in render.lua and is covered by the live smoke.
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "OUTPUT_FILE_EXISTS",
        "REAPER project-copy sidecar already exists at the render target "
          + "(v0.1 refuses to overwrite; cleanup-on-success only deletes "
          + "sidecars THIS render produced): /x/var_01.wav.RPP",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUTPUT_FILE_EXISTS");
        expect(result.error.message).toMatch(/\.wav\.RPP$/);
        expect(result.error.message).toMatch(/project-copy sidecar/i);
      }
      expect(bridge.seen).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces OUTPUT_FILE_EXISTS for a pre-existing .wav.RPP-bak sidecar backup (Step 7 path-B preflight)", async () => {
    // REAPER rotates the previous sidecar to `<wav>.RPP-bak` before
    // writing the new one, so both paths must be cleared at preflight
    // to keep cleanup-on-success from ever touching user files.
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "OUTPUT_FILE_EXISTS",
        "REAPER project-copy sidecar backup already exists at the render "
          + "target (v0.1 refuses to overwrite; cleanup-on-success only "
          + "deletes sidecars THIS render produced): /x/var_01.wav.RPP-bak",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUTPUT_FILE_EXISTS");
        expect(result.error.message).toMatch(/\.wav\.RPP-bak$/);
        expect(result.error.message).toMatch(/sidecar backup/i);
      }
      expect(bridge.seen).toHaveLength(1);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REGION_NOT_FOUND from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeError("REGION_NOT_FOUND", "No region named 'ghost'"),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:ghost", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("REGION_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REGION_NAME_INVALID for a hand-built region with a forbidden name (Step 7 B1)", async () => {
    // A user can hand-build a region in REAPER's UI with a name containing
    // /, \, NUL, or $. region_create rejects them at create time but
    // resolve_region does not, so render_region re-validates after
    // resolution (lib/names.lua) — same forbidden set, same typed code.
    // This pins the bridge → envelope round trip; the real Lua check is
    // covered by the REAPER smoke.
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "REGION_NAME_INVALID",
        "Region name 'bad$name' contains a forbidden character (path separator /, \\, NUL, or render-pattern token $)",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:bad$name", output_dir: "/tmp/out" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REGION_NAME_INVALID");
        expect(result.error.message).toMatch(/forbidden character/i);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces REF_INVALID for cross-type refs (e.g. item ref in region slot)", async () => {
    // Region resolver returns REF_INVALID with a typed "you fed in an
    // item ref" message. The envelope passes the code straight through.
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "REF_INVALID",
        "'selected:0' is an item reference; expected a region reference",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "selected:0", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("REF_INVALID");
        expect(result.error.message).toMatch(/region reference/i);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces RENDER_TIMEOUT from the bridge", async () => {
    // The deferred-completion machinery is bridge-internal; from the
    // TS side a timeout is just another error code passing through the
    // envelope. The actual deadline math lives in render.lua.
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "RENDER_TIMEOUT",
        "Render produced no output at /x/var_01.wav within deadline (55s)",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RENDER_TIMEOUT");
        expect(result.error.message).toMatch(/deadline/i);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces RENDER_FILE_EMPTY from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeError(
        "RENDER_FILE_EMPTY",
        "Render output at /x/var_01.wav is empty at deadline",
      ),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "render_region",
        params: { region_id: "region:var_01", output_dir: "/x" },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("RENDER_FILE_EMPTY");
    } finally {
      await bridge.stop();
    }
  });

  it("declares a 60_000ms wire timeout via timeoutMs on the definition", () => {
    // The file-queue client reads `def.timeoutMs` after registry.get; this
    // assertion pins the OUTER deadline that gates BRIDGE_NOT_RUNNING. The
    // bridge's INNER deadline (RENDER_INTERNAL_DEADLINE_S in render.lua)
    // is shorter so RENDER_TIMEOUT surfaces with its typed code first.
    expect(renderRegionDefinition.timeoutMs).toBe(60_000);
    expect(RENDER_REGION_TIMEOUT_MS).toBe(60_000);
  });
});
