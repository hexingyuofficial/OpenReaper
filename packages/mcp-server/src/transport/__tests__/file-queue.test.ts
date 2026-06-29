import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { FileQueueClient, resolveQueueDir } from "../file-queue.js";
import { startFakeBridge } from "./fake-bridge.js";

describe("resolveQueueDir", () => {
  it("honors STREETLIGHT_QUEUE_DIR env var", () => {
    const dir = resolveQueueDir(
      { STREETLIGHT_QUEUE_DIR: "/custom/path" },
      "darwin",
    );
    expect(dir).toBe("/custom/path");
  });

  it("uses macOS default", () => {
    const dir = resolveQueueDir({}, "darwin");
    expect(dir).toContain("Library");
    expect(dir).toContain("Application Support");
    expect(dir).toContain("Streetlight");
    expect(dir).toContain("queue");
  });

  it("uses Windows default with APPDATA", () => {
    const dir = resolveQueueDir(
      { APPDATA: "C:\\Users\\test\\AppData\\Roaming" },
      "win32",
    );
    expect(dir).toContain("Streetlight");
    expect(dir).toContain("queue");
  });

  it("falls back to homedir on Windows without APPDATA", () => {
    const dir = resolveQueueDir({}, "win32");
    expect(dir).toContain("Streetlight");
    expect(dir).toContain("queue");
  });

  it("uses Linux default", () => {
    const dir = resolveQueueDir({}, "linux");
    expect(dir).toContain(".local");
    expect(dir).toContain("streetlight");
    expect(dir).toContain("queue");
  });

  it("ignores empty env var", () => {
    const dir = resolveQueueDir({ STREETLIGHT_QUEUE_DIR: "" }, "darwin");
    expect(dir).toContain("Streetlight");
  });
});

describe("FileQueueClient", () => {
  let queueDir: string;
  let client: FileQueueClient;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-test-"));
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

  it("init creates the three queue subdirs", async () => {
    const entries = await fs.readdir(queueDir);
    expect(entries.sort()).toEqual(["done", "pending", "running"]);
  });

  it("returns BRIDGE_NOT_RUNNING on timeout", async () => {
    const result = await client.send("ping", {}, { timeoutMs: 100 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BRIDGE_NOT_RUNNING");
      expect(result.error.recoverable).toBe(true);
    }
  });

  it("cleans up the pending file after a timeout", async () => {
    await client.send("ping", {}, { timeoutMs: 100 });
    const pending = await fs.readdir(path.join(queueDir, "pending"));
    expect(pending).toEqual([]);
  });

  it("round-trips a successful ping result", async () => {
    const bridge = startFakeBridge(queueDir);
    try {
      const result = await client.send<{
        bridge: string;
        reaper_version: string;
      }>("ping", {}, { timeoutMs: 5000 });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.bridge).toBe("connected");
        expect(result.result.reaper_version).toMatch(/^7\./);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces an error envelope from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "TEMPLATE_NOT_FOUND",
        message: "no such template",
        recoverable: true,
      },
    }));
    try {
      const result = await client.send(
        "template",
        { foo: 1 },
        { timeoutMs: 5000 },
        "nope",
      );
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
        expect(result.error.message).toBe("no such template");
        expect(result.error.recoverable).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("leaves no orphan files after a successful round trip", async () => {
    const bridge = startFakeBridge(queueDir);
    try {
      await client.send("ping", {}, { timeoutMs: 5000 });
      const pending = await fs.readdir(path.join(queueDir, "pending"));
      const running = await fs.readdir(path.join(queueDir, "running"));
      const done = await fs.readdir(path.join(queueDir, "done"));
      expect(pending).toEqual([]);
      expect(running).toEqual([]);
      expect(done).toEqual([]);
    } finally {
      await bridge.stop();
    }
  });

  it("handles 20 concurrent pings without ID collisions or orphans", async () => {
    const bridge = startFakeBridge(queueDir);
    try {
      const results = await Promise.all(
        Array.from({ length: 20 }, () =>
          client.send("ping", {}, { timeoutMs: 5000 }),
        ),
      );
      expect(results.every((r) => r.ok)).toBe(true);

      const pending = await fs.readdir(path.join(queueDir, "pending"));
      const running = await fs.readdir(path.join(queueDir, "running"));
      const done = await fs.readdir(path.join(queueDir, "done"));
      expect(pending).toEqual([]);
      expect(running).toEqual([]);
      expect(done).toEqual([]);
    } finally {
      await bridge.stop();
    }
  });

  it("handles malformed bridge JSON cleanly", async () => {
    // Write garbage directly into done/ for the next command we send.
    const bridge = startFakeBridge(queueDir, undefined, { malformed: true });
    try {
      const result = await client.send("ping", {}, { timeoutMs: 5000 });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INTERNAL_ERROR");
      }
    } finally {
      await bridge.stop();
    }
  });

  it("Result-wraps non-ENOENT readFile errors instead of rejecting", async () => {
    // Replace `done/` with a regular file so the next pollForResult
    // readFile of done/<id>.json throws ENOTDIR. Per the class JSDoc
    // ("errors never reject — they resolve into a Result<R>"), this must
    // surface as an INTERNAL_ERROR Result, not an unhandled rejection
    // bubbling out of `client.send` into the MCP handler.
    const doneDir = path.join(queueDir, "done");
    await fs.rmdir(doneDir);
    await fs.writeFile(doneDir, "not-a-dir");

    // No fake bridge — if the catch were missing we'd reject from
    // readFile before reaching the timeout branch. timeoutMs is generous
    // only as a backstop; the test should return well before then.
    const result = await client.send("ping", {}, { timeoutMs: 2000 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("INTERNAL_ERROR");
      expect(result.error.recoverable).toBe(false);
      expect(result.error.message).toMatch(/bridge response/i);
    }
  });
});

// ─── done/ orphan sweep on init ─────────────────────────────────────────────
// Separate describe so each test owns its own queueDir; init() is the unit
// under test, so we can't share the beforeEach that already calls init().

describe("FileQueueClient done/ orphan sweep", () => {
  let queueDir: string;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-sweep-"));
  });

  afterEach(async () => {
    // Restore perms in case a test stripped them; rm refuses otherwise.
    await fs.chmod(path.join(queueDir, "done"), 0o700).catch(() => {});
    await fs.rm(queueDir, { recursive: true, force: true });
  });

  it("removes done/<id>.json older than the threshold, keeps fresh entries", async () => {
    const doneDir = path.join(queueDir, "done");
    await fs.mkdir(doneDir, { recursive: true });

    const oldPath = path.join(doneDir, "old.json");
    const freshPath = path.join(doneDir, "fresh.json");
    await fs.writeFile(oldPath, '{"ok":true}');
    await fs.writeFile(freshPath, '{"ok":true}');

    // Backdate `old.json` 25 hours; leave `fresh.json` at "now". Use the
    // 24h default threshold (no override) so we exercise the shipping
    // value, not a synthetic one.
    const oldStamp = (Date.now() - 25 * 60 * 60 * 1000) / 1000;
    await fs.utimes(oldPath, oldStamp, oldStamp);

    const client = new FileQueueClient({ queueDir });
    await client.init();

    const remaining = (await fs.readdir(doneDir)).sort();
    expect(remaining).toEqual(["fresh.json"]);
  });

  it("does not touch subdirectories under done/", async () => {
    // Defensive: someone (or a future protocol extension) may park a
    // subdir under done/. We must not unlink directories — and even if
    // an entry is old, isFile()==false short-circuits us.
    const doneDir = path.join(queueDir, "done");
    const subDir = path.join(doneDir, "subdir");
    await fs.mkdir(subDir, { recursive: true });
    const oldStamp = (Date.now() - 48 * 60 * 60 * 1000) / 1000;
    await fs.utimes(subDir, oldStamp, oldStamp);

    const client = new FileQueueClient({ queueDir });
    await client.init();

    const remaining = await fs.readdir(doneDir);
    expect(remaining).toContain("subdir");
  });

  it("init() resolves even when sweep cannot enumerate done/", async () => {
    // chmod the pre-existing done/ to 000 BEFORE init runs. init's mkdir
    // call is a no-op on an existing dir; sweepDoneOrphans then hits
    // EACCES on readdir. Best-effort contract: init must still resolve.
    const doneDir = path.join(queueDir, "done");
    await fs.mkdir(doneDir, { recursive: true });
    await fs.chmod(doneDir, 0o000);

    const client = new FileQueueClient({ queueDir });
    await expect(client.init()).resolves.toBeUndefined();
  });

  it("custom threshold override honored", async () => {
    // Test-only knob: a 1ms threshold should reap a 100ms-old file.
    const doneDir = path.join(queueDir, "done");
    await fs.mkdir(doneDir, { recursive: true });
    const p = path.join(doneDir, "barely-old.json");
    await fs.writeFile(p, '{"ok":true}');
    const stamp = (Date.now() - 100) / 1000;
    await fs.utimes(p, stamp, stamp);

    const client = new FileQueueClient({
      queueDir,
      doneOrphanThresholdMs: 1,
    });
    await client.init();

    const remaining = await fs.readdir(doneDir);
    expect(remaining).toEqual([]);
  });
});

// ─── Fake bridge ────────────────────────────────────────────────────────────
// Extracted to ./fake-bridge.ts; the rest of the test file consumes it via
// the import at the top.
