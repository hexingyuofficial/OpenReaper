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

  it("accepts in-place expectedDelta field checks", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: "field_checked",
      description: "field checked",
      pack: "test",
      risk: "write_safe",
      mutates: true,
      undoable: true,
      idempotent: true,
      entity_kind: "item",
      undo_flags: ["ITEMS"],
      expectedDelta: {
        count: 1,
        fields: [
          {
            scope: "take",
            field: "D_PITCH",
            paramPath: "semitones",
            tolerance: 1e-6,
          },
        ],
      },
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    });

    expect(reg.list()[0]?.expectedDelta).toEqual({
      count: 1,
      fields: [
        {
          scope: "take",
          field: "D_PITCH",
          paramPath: "semitones",
          tolerance: 1e-6,
        },
      ],
    });
  });

  it("accepts optional expectedDelta field checks when at least one field is required", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: "trim_checked",
      description: "trim checked",
      pack: "test",
      risk: "write_safe",
      mutates: true,
      undoable: true,
      idempotent: true,
      entity_kind: "item",
      undo_flags: ["ITEMS"],
      expectedDelta: {
        count: 1,
        fields: [
          { scope: "item", field: "D_LENGTH", paramPath: "length", tolerance: 1e-6 },
          {
            scope: "take",
            field: "D_STARTOFFS",
            paramPath: "start_offset",
            tolerance: 1e-6,
            optional: true,
          },
        ],
      },
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    });

    expect(reg.list()[0]?.expectedDelta).toEqual({
      count: 1,
      fields: [
        { scope: "item", field: "D_LENGTH", paramPath: "length", tolerance: 1e-6 },
        {
          scope: "take",
          field: "D_STARTOFFS",
          paramPath: "start_offset",
          tolerance: 1e-6,
          optional: true,
        },
      ],
    });
  });

  it("accepts all-optional field checks when every field is nullable", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: "fade_checked",
      description: "fade checked",
      pack: "test",
      risk: "write_safe",
      mutates: true,
      undoable: true,
      idempotent: true,
      entity_kind: "item",
      undo_flags: ["ITEMS"],
      expectedDelta: {
        count: 1,
        fields: [
          {
            scope: "item",
            field: "D_FADEINLEN",
            paramPath: "fade_in",
            tolerance: 1e-6,
            optional: true,
            nullable: true,
          },
          {
            scope: "item",
            field: "D_FADEOUTLEN",
            paramPath: "fade_out",
            tolerance: 1e-6,
            optional: true,
            nullable: true,
          },
        ],
      },
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    });

    expect(reg.list()[0]?.expectedDelta).toEqual({
      count: 1,
      fields: [
        {
          scope: "item",
          field: "D_FADEINLEN",
          paramPath: "fade_in",
          tolerance: 1e-6,
          optional: true,
          nullable: true,
        },
        {
          scope: "item",
          field: "D_FADEOUTLEN",
          paramPath: "fade_out",
          tolerance: 1e-6,
          optional: true,
          nullable: true,
        },
      ],
    });
  });

  it("accepts creates expectedDelta field checks with a positive numeric count", () => {
    const registerWithCount = (count: number) => {
      const reg = new CapabilityRegistry();
      reg.register({
        name: `duplicate_checked_${count}`,
        description: "duplicate checked",
        pack: "test",
        risk: "write_safe",
        mutates: true,
        undoable: true,
        idempotent: false,
        entity_kind: "item",
        undo_flags: ["ITEMS"],
        expectedDelta: {
          count,
          creates: true,
          fields: [
            { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
          ],
        },
        params: z.object({}),
        result: z.object({}),
        examples: [{ params: {} }],
      });
      return reg.list()[0]?.expectedDelta;
    };

    expect(registerWithCount(1)).toEqual({
      count: 1,
      creates: true,
      fields: [
        { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
      ],
    });
    expect(registerWithCount(3)).toEqual({
      count: 3,
      creates: true,
      fields: [
        { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
      ],
    });
  });

  it("accepts maybeCreates expectedDelta field checks with a positive numeric count", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: "track_create_checked",
      description: "track create checked",
      pack: "test",
      risk: "write_safe",
      mutates: true,
      undoable: true,
      idempotent: false,
      entity_kind: "track",
      undo_flags: ["TRACKCFG"],
      expectedDelta: {
        count: 1,
        maybeCreates: true,
        fields: [
          { scope: "track", field: "P_NAME", paramPath: "name" },
        ],
      },
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    });

    expect(reg.list()[0]?.expectedDelta).toEqual({
      count: 1,
      maybeCreates: true,
      fields: [
        { scope: "track", field: "P_NAME", paramPath: "name" },
      ],
    });
  });

  it("deep-copies expectedDelta fields in metadata", () => {
    const reg = new CapabilityRegistry();
    reg.register({
      name: "field_checked",
      description: "field checked",
      pack: "test",
      risk: "write_safe",
      mutates: true,
      undoable: true,
      idempotent: true,
      entity_kind: "item",
      undo_flags: ["ITEMS"],
      expectedDelta: {
        count: 1,
        fields: [{ scope: "item", field: "D_POSITION", paramPath: "position" }],
      },
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    });

    const first = reg.list()[0]?.expectedDelta;
    expect(first?.fields?.[0]?.field).toBe("D_POSITION");
    (first?.fields as Array<{ field: string }>)[0]!.field = "BROKEN";

    const second = reg.list()[0]?.expectedDelta;
    expect(second?.fields?.[0]?.field).toBe("D_POSITION");
    expect(reg.get("field_checked")?.expectedDelta?.fields?.[0]?.field).toBe(
      "D_POSITION",
    );
  });

  it("rejects invalid expectedDelta field checks", () => {
    const base = {
      name: "bad_fields",
      description: "bad",
      pack: "test",
      risk: "write_safe" as const,
      mutates: true,
      undoable: true,
      idempotent: false,
      entity_kind: "item",
      undo_flags: ["ITEMS"] as const,
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    };

    const registerWithExpectedDelta = (expectedDelta: unknown) => {
      const reg = new CapabilityRegistry();
      reg.register({ ...base, expectedDelta } as never);
    };

    expect(() =>
      registerWithExpectedDelta({ count: 1, fields: [] }),
    ).toThrow(/fields must be a non-empty array/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [{ scope: "take", paramPath: "semitones" }],
      }),
    ).toThrow(/missing field/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [{ scope: "fx", field: "D_PITCH", paramPath: "semitones" }],
      }),
    ).toThrow(/unsupported scope/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [{ scope: "take", field: "D_PITCH", paramPath: "take.pitch" }],
      }),
    ).toThrow(/top-level key/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [{ scope: "take", field: "D_PITCH", paramPath: "semitones", tolerance: -1 }],
      }),
    ).toThrow(/tolerance/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [
          {
            scope: "take",
            field: "D_STARTOFFS",
            paramPath: "start_offset",
            optional: "yes",
          },
        ],
      }),
    ).toThrow(/optional must be boolean/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [
          {
            scope: "item",
            field: "D_FADEINLEN",
            paramPath: "fade_in",
            nullable: "yes",
          },
        ],
      }),
    ).toThrow(/nullable must be boolean/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [
          {
            scope: "take",
            field: "D_STARTOFFS",
            paramPath: "start_offset",
            optional: true,
          },
        ],
      }),
    ).toThrow(/all-optional only when every field is nullable/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [
          {
            scope: "item",
            field: "D_FADEINLEN",
            paramPath: "fade_in",
            optional: true,
            nullable: true,
          },
          {
            scope: "item",
            field: "D_FADEOUTLEN",
            paramPath: "fade_out",
            optional: true,
          },
        ],
      }),
    ).toThrow(/all-optional only when every field is nullable/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        fields: [
          { scope: "take", field: "D_PITCH", paramPath: "semitones" },
          { scope: "take", field: "D_PITCH", paramPath: "other" },
        ],
      }),
    ).toThrow(/duplicate take:D_PITCH/);
    expect(() =>
      registerWithExpectedDelta({
        count: 1,
        deletes: true,
        fields: [{ scope: "item", field: "D_POSITION", paramPath: "position" }],
      }),
    ).toThrow(/cannot coexist with deletes/);
    expect(() =>
      registerWithExpectedDelta({
        count: "any",
        creates: true,
        fields: [{ scope: "item", field: "D_POSITION", paramPath: "position" }],
      }),
    ).toThrow(/with creates:true requires numeric count >= 1/);
    expect(() =>
      registerWithExpectedDelta({
        count: 0,
        creates: true,
        fields: [{ scope: "item", field: "D_POSITION", paramPath: "position" }],
      }),
    ).toThrow(/with creates:true requires numeric count >= 1/);
    expect(() =>
      registerWithExpectedDelta({
        count: "any",
        maybeCreates: true,
        fields: [{ scope: "track", field: "P_NAME", paramPath: "name" }],
      }),
    ).toThrow(/maybeCreates requires a numeric count/);
    expect(() =>
      registerWithExpectedDelta({
        count: 0,
        maybeCreates: true,
        fields: [{ scope: "track", field: "P_NAME", paramPath: "name" }],
      }),
    ).toThrow(/with maybeCreates:true requires numeric count >= 1/);
  });
});
