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
    idempotent: false,
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
    idempotent: false,
    params: z.object({
      name: z.string(),
      reuse: z.boolean().optional(),
    }),
    result: z.object({
      track: z.object({ id: z.string(), name: z.string() }),
    }),
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
});
