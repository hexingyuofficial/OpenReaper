import { describe, it, expect } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../registry.js";

function makeItemPitch(reg: CapabilityRegistry): void {
  reg.register({
    name: "item_pitch",
    description: "Set active take pitch in semitones.",
    pack: "core",
    risk: "write_safe",
    mutates: true,
    undoable: true,
    entity_kind: "item",
    undo_flags: ["ITEMS"],
    idempotent: false,
    expectedDelta: { count: 1 },
    params: z.object({
      item_id: z.string(),
      semitones: z.number().min(-24).max(24),
    }),
    result: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          pitch_before: z.number(),
          pitch_after: z.number(),
        }),
      ),
    }),
    examples: [
      {
        params: { item_id: "selected:0", semitones: -3 },
      },
    ],
  });
}

function makeTrackCreate(reg: CapabilityRegistry): void {
  reg.register({
    name: "track_create",
    description: "Create or reuse a track by name.",
    pack: "core",
    risk: "write_safe",
    mutates: true,
    undoable: true,
    entity_kind: "track",
    undo_flags: ["TRACKCFG"],
    idempotent: false,
    expectedDelta: { count: 1, maybeCreates: true },
    params: z.object({
      name: z.string(),
      reuse: z.boolean().optional(),
    }),
    result: z.object({
      track: z.object({ id: z.string(), name: z.string() }),
    }),
    examples: [
      {
        params: { name: "FX", reuse_existing: true },
      },
    ],
  });
}

describe("CapabilityRegistry", () => {
  it("registers and lists capabilities with their JSON Schemas", () => {
    const reg = new CapabilityRegistry();
    makeItemPitch(reg);
    makeTrackCreate(reg);

    expect(reg.size()).toBe(2);

    const list = reg.list();
    expect(list).toHaveLength(2);
    expect(list.map((c) => c.name).sort()).toEqual([
      "item_pitch",
      "track_create",
    ]);

    const itemPitch = list.find((c) => c.name === "item_pitch");
    expect(itemPitch).toBeDefined();
    expect(itemPitch?.risk).toBe("write_safe");
    expect(itemPitch?.mutates).toBe(true);
    expect(itemPitch?.entity_kind).toBe("item");
    expect(itemPitch?.undo_flags).toEqual(["ITEMS"]);
    expect(itemPitch?.expectedDelta).toEqual({ count: 1 });
    expect(itemPitch?.examples).toEqual([
      { params: { item_id: "selected:0", semitones: -3 } },
    ]);
    expect(itemPitch?.params_schema).toBeDefined();
    expect(itemPitch?.result_schema).toBeDefined();
  });

  it("rejects duplicate registration", () => {
    const reg = new CapabilityRegistry();
    makeItemPitch(reg);
    expect(() => makeItemPitch(reg)).toThrow(/already registered/);
  });

  it("get returns undefined for missing capability", () => {
    const reg = new CapabilityRegistry();
    expect(reg.get("nope")).toBeUndefined();
    expect(reg.has("nope")).toBe(false);
  });

  it("returns the registered Zod schema via get(), so callers can safeParse", () => {
    const reg = new CapabilityRegistry();
    makeItemPitch(reg);

    const cap = reg.get("item_pitch");
    expect(cap).toBeDefined();
    if (!cap) return;

    expect(
      cap.params.safeParse({ item_id: "selected:0", semitones: -3 }).success,
    ).toBe(true);
    expect(
      cap.params.safeParse({ item_id: "selected:0", semitones: 100 }).success,
    ).toBe(false);
    expect(cap.params.safeParse({ item_id: "selected:0" }).success).toBe(false);
  });

  it("metadata is JSON-serializable (no Zod objects leak through)", () => {
    const reg = new CapabilityRegistry();
    makeItemPitch(reg);
    const list = reg.list();
    // Round-trip through JSON to prove there are no functions or symbols.
    expect(() => JSON.parse(JSON.stringify(list))).not.toThrow();
  });

  it("metadata passes through maybeCreates expectedDelta", () => {
    const reg = new CapabilityRegistry();
    makeTrackCreate(reg);

    const trackCreate = reg.list().find((c) => c.name === "track_create");
    expect(trackCreate?.expectedDelta).toEqual({
      count: 1,
      maybeCreates: true,
    });
  });

  it("rejects capabilities missing required descriptor metadata", () => {
    const reg = new CapabilityRegistry();
    const base = {
      name: "bad_template",
      description: "bad",
      pack: "test",
      risk: "read" as const,
      mutates: false,
      undoable: false,
      idempotent: true,
      params: z.object({}),
      result: z.object({}),
    };

    expect(() => reg.register({ ...base } as never)).toThrow(/entity_kind/);
    expect(() =>
      reg.register({ ...base, entity_kind: "item" } as never),
    ).toThrow(/undo_flags/);
    expect(() =>
      reg.register({ ...base, entity_kind: "item", undo_flags: [] } as never),
    ).toThrow(/example/);
  });

  it("rejects inconsistent undo metadata", () => {
    const reg = new CapabilityRegistry();
    const base = {
      name: "bad_undo",
      description: "bad",
      pack: "test",
      risk: "read" as const,
      mutates: false,
      idempotent: true,
      entity_kind: "item",
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    };

    expect(() =>
      reg.register({ ...base, undoable: true, undo_flags: [] }),
    ).toThrow(/undoable but has no undo_flags/);
    expect(() =>
      reg.register({ ...base, undoable: false, undo_flags: ["ITEMS"] }),
    ).toThrow(/not undoable but has undo_flags/);
    expect(() =>
      reg.register({ ...base, undoable: true, undo_flags: ["NOPE"] as never }),
    ).toThrow(/unknown undo flag/);
  });

  it("rejects inconsistent expectedDelta modes", () => {
    const reg = new CapabilityRegistry();
    const base = {
      name: "bad_delta",
      description: "bad",
      pack: "test",
      risk: "write_safe" as const,
      mutates: true,
      undoable: true,
      idempotent: false,
      entity_kind: "track",
      undo_flags: ["TRACKCFG"] as const,
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    };

    expect(() =>
      reg.register({
        ...base,
        expectedDelta: { count: 1, creates: true, maybeCreates: true },
      }),
    ).toThrow(/incompatible delta modes/);
    expect(() =>
      reg.register({
        ...base,
        expectedDelta: { count: "any", maybeCreates: true },
      }),
    ).toThrow(/maybeCreates requires a numeric count/);
  });
});
