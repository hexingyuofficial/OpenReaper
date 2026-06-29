import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";
import { z } from "zod";
import {
  CapabilityRegistry,
  RiskLevels,
  withAllowed,
} from "@streetlight/core";
import { FileQueueClient } from "../../transport/file-queue.js";
import { startFakeBridge } from "../../transport/__tests__/fake-bridge.js";
import { callTemplate } from "../call-template.js";
import { registerCoreTemplates } from "../../templates/index.js";

/**
 * Build a fake bridge envelope matching the locked call_template shape.
 * Centralized here so the assertions stay consistent across cases.
 */
function fakeTemplateOk(
  template: string,
  changedIds: string[],
  changedCount?: number,
): { ok: true; result: unknown } {
  const count = changedCount ?? changedIds.length;
  return {
    ok: true,
    result: {
      template,
      changed_count: count,
      changed_ids: changedIds,
      truncated: changedIds.length < count,
    },
  };
}

describe("callTemplate", () => {
  let queueDir: string;
  let client: FileQueueClient;
  let registry: CapabilityRegistry;

  beforeEach(async () => {
    queueDir = await fs.mkdtemp(path.join(os.tmpdir(), "streetlight-call-"));
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

  it("happy path: item_pitch returns the locked envelope", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", ["guid:{ABC-123}"]),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: -3 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.template).toBe("item_pitch");
        expect(result.result.changed_count).toBe(1);
        expect(result.result.changed_ids).toEqual(["guid:{ABC-123}"]);
        expect(result.result.truncated).toBe(false);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("on-wire: kind='template', name=<template>, params=<validated>", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", ["guid:{X}"]),
    );
    try {
      await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 2 },
      });
      expect(bridge.seen).toHaveLength(1);
      const cmd = bridge.seen[0]!;
      expect(cmd.kind).toBe("template");
      expect(cmd.name).toBe("item_pitch");
      expect(cmd.params).toEqual({ item_id: "selected:0", semitones: 2 });
    } finally {
      await bridge.stop();
    }
  });

  it("TEMPLATE_NOT_FOUND for unregistered name, without round-tripping to bridge", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("never_called", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "no_such_template",
        params: {},
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("TEMPLATE_NOT_FOUND");
        expect(result.error.message).toMatch(/no_such_template/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID when semitones out of range (Zod ±24), no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 100 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/semitones/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID when item_id missing, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { semitones: 0 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("PARAMS_INVALID");
        expect(result.error.message).toMatch(/item_id/);
      }
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("PARAMS_INVALID when `name` itself is empty, no bridge round-trip", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("any", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "",
        params: {},
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("rejects unknown params via Zod strict mode", async () => {
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", []),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: {
          item_id: "selected:0",
          semitones: 0,
          // Strict mode should refuse this unknown key — protects against
          // typos that would otherwise silently no-op in the bridge.
          extra_field: "oops",
        },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("PARAMS_INVALID");
      expect(bridge.seen).toHaveLength(0);
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces ITEM_NOT_FOUND from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "ITEM_NOT_FOUND",
        message: "selected:0 out of range (selection has 0 items)",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: -3 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("ITEM_NOT_FOUND");
        expect(result.error.recoverable).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("surfaces TAKE_NOT_FOUND from the bridge", async () => {
    const bridge = startFakeBridge(queueDir, () => ({
      ok: false,
      error: {
        code: "TAKE_NOT_FOUND",
        message: "Item has no active take to pitch",
        recoverable: true,
      },
    }));
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 1 },
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.code).toBe("TAKE_NOT_FOUND");
    } finally {
      await bridge.stop();
    }
  });

  it("propagates the truncated=true / changed_count > changed_ids.length envelope", async () => {
    // Bridge says: template touched 87 items; only the first 50 GUIDs are
    // returned. Locked shape carries the true count alongside truncated=true.
    const ids = Array.from({ length: 50 }, (_, i) => `guid:{ITEM-${i}}`);
    const bridge = startFakeBridge(queueDir, () =>
      fakeTemplateOk("item_pitch", ids, 87),
    );
    try {
      const result = await callTemplate(client, registry, {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 1 },
      });
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.result.changed_count).toBe(87);
        expect(result.result.changed_ids).toHaveLength(50);
        expect(result.result.truncated).toBe(true);
      }
    } finally {
      await bridge.stop();
    }
  });

  it("BRIDGE_NOT_RUNNING when bridge does not respond (mutating-timeout case)", async () => {
    // No fake bridge started. This test documents the most important
    // recovery contract: a mutating template that times out MAY have
    // applied. The Result here returns BRIDGE_NOT_RUNNING with
    // recoverable=true, but callers MUST NOT interpret that as
    // "definitely did not happen" and auto-retry — re-sending could
    // double-apply the mutation. The recovery is to call get_state and
    // inspect actual state. See docs/PROGRESS.md "Open Questions" for the
    // proper fix (idempotency tokens) that lands in v0.2.
    const result = await callTemplate(
      client,
      registry,
      {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 1 },
      },
      100,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe("BRIDGE_NOT_RUNNING");
      expect(result.error.recoverable).toBe(true);
      expect(result.error.message).toMatch(/REAPER/);
    }
  });

  it("does NOT auto-retry on BRIDGE_NOT_RUNNING (single wire write per call)", async () => {
    // Even with no responder, the client must write exactly one command
    // to the queue per callTemplate() call and then surface the timeout.
    // No silent retry — that's the double-mutation footgun we're avoiding.
    const pendingDir = path.join(queueDir, "pending");
    await callTemplate(
      client,
      registry,
      {
        name: "item_pitch",
        params: { item_id: "selected:0", semitones: 1 },
      },
      80,
    );
    // After timeout, the client should have cleaned its pending entry up
    // (best-effort) — but most importantly, it should not have written
    // additional entries by retrying. Count whatever's there: zero or one,
    // never more.
    const left = await fs.readdir(pendingDir).catch(() => [] as string[]);
    expect(left.length).toBeLessThanOrEqual(1);
  });

  describe("risk policy enforcement", () => {
    // Fresh registry per test — we deliberately add a `destructive`
    // template that the v0.1 core registry does not contain, so we can
    // exercise the RISK_BLOCKED gate without coupling to which templates
    // happen to be `write_safe` / `filesystem` today.
    function registerDestructiveTemplate(reg: CapabilityRegistry): void {
      reg.register({
        name: "fake_destructive",
        description: "Test-only destructive template (never reaches bridge).",
        pack: "test",
        risk: RiskLevels.destructive,
        mutates: true,
        undoable: false,
        idempotent: false,
        params: z.object({}).strict(),
        result: z.object({}),
      });
    }

    it("RISK_BLOCKED under default policy, no queue write, no params parse", async () => {
      const isolatedRegistry = new CapabilityRegistry();
      registerDestructiveTemplate(isolatedRegistry);

      // No fake bridge: if the gate let the call through we'd hit a timeout,
      // not a clean RISK_BLOCKED.
      const result = await callTemplate(client, isolatedRegistry, {
        name: "fake_destructive",
        // Deliberately pass an unknown param. RISK_BLOCKED must fire BEFORE
        // params parse so this junk should not produce PARAMS_INVALID.
        params: { bogus: 1 },
      });

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("RISK_BLOCKED");
        expect(result.error.message).toMatch(/destructive/);
        expect(result.error.message).toMatch(/fake_destructive/);
      }

      // Queue must be untouched — pending/ empty proves we short-circuited
      // before any wire write.
      const pendingDir = path.join(queueDir, "pending");
      const pending = await fs.readdir(pendingDir);
      expect(pending).toEqual([]);
    });

    it("explicit policy granting destructive lets the call through to the bridge", async () => {
      const isolatedRegistry = new CapabilityRegistry();
      registerDestructiveTemplate(isolatedRegistry);

      const bridge = startFakeBridge(queueDir, () => ({
        ok: true,
        result: {
          template: "fake_destructive",
          changed_count: 0,
          changed_ids: [],
          truncated: false,
        },
      }));
      try {
        const result = await callTemplate(
          client,
          isolatedRegistry,
          { name: "fake_destructive", params: {} },
          undefined,
          withAllowed([
            RiskLevels.read,
            RiskLevels.write_safe,
            RiskLevels.filesystem,
            RiskLevels.destructive,
          ]),
        );
        expect(result.ok).toBe(true);
        expect(bridge.seen).toHaveLength(1);
      } finally {
        await bridge.stop();
      }
    });
  });
});
