import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@streetlight/core";
import { z } from "zod";
import { listTemplates } from "../list-templates.js";
import { registerCoreTemplates } from "../../templates/index.js";

const regionCreateExpectedFields = [
  { scope: "region", field: "name", paramPath: "name" },
  {
    scope: "region",
    field: "pos",
    paramPath: "start",
    tolerance: 1e-6,
    optional: true,
  },
  {
    scope: "region",
    field: "rgnend",
    paramPath: "end",
    tolerance: 1e-6,
    optional: true,
  },
];

describe("listTemplates", () => {
  it("empty registry → ok with empty templates array", () => {
    const registry = new CapabilityRegistry();
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.result.templates).toEqual([]);
    }
  });

  it("returns serializable metadata for the full core pack", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { templates } = result.result;
    expect(templates.length).toBe(registry.size());
    expect(templates.length).toBeGreaterThan(0);

    const renderRegion = templates.find((t) => t.name === "render_region");
    expect(renderRegion).toBeDefined();
    if (!renderRegion) return;
    expect(renderRegion.pack).toBe("core");
    expect(renderRegion.risk).toBe("filesystem");
    expect(renderRegion.undoable).toBe(false);
    expect(renderRegion.entity_kind).toBe("render");
    expect(renderRegion.undo_flags).toEqual([]);
    expect(renderRegion.examples.length).toBeGreaterThanOrEqual(1);
    expect(renderRegion.examples[0]!.params).toHaveProperty("region_id");
    expect(renderRegion.idempotent).toBe(false);
    expect(renderRegion.mutates).toBe(true);
    expect(renderRegion.params_schema).toBeDefined();
    expect(renderRegion.result_schema).toBeDefined();

    const callTemplateEnvelope = templates.find((t) => t.name === "item_pitch");
    expect(callTemplateEnvelope).toBeDefined();
    expect(callTemplateEnvelope?.entity_kind).toBe("item");
    expect(callTemplateEnvelope?.undo_flags).toEqual(["ITEMS"]);
    expect(callTemplateEnvelope?.expectedDelta).toEqual({
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
    expect(callTemplateEnvelope?.examples[0]?.params).toEqual({
      item_id: "selected:0",
      semitones: -12,
    });
  });

  it("returns descriptor metadata for every core template", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const template of result.result.templates) {
      expect(template.entity_kind).toMatch(/^(item|track|region|render)$/);
      expect(Array.isArray(template.undo_flags)).toBe(true);
      expect(template.examples.length).toBeGreaterThanOrEqual(1);
      expect(template).not.toHaveProperty("reads");
      expect(template).not.toHaveProperty("writes");

      if (template.mutates && template.undoable) {
        expect(template.undo_flags.length).toBeGreaterThan(0);
        expect(template.expectedDelta).toBeDefined();
      } else {
        expect(template.undo_flags).toEqual([]);
        expect(template).not.toHaveProperty("expectedDelta");
      }
    }

    const trackCreate = result.result.templates.find((t) => t.name === "track_create");
    expect(trackCreate?.expectedDelta).toEqual({
      count: 1,
      maybeCreates: true,
      fields: [
        { scope: "track", field: "P_NAME", paramPath: "name" },
      ],
    });
    const mediaImport = result.result.templates.find((t) => t.name === "media_import");
    expect(mediaImport?.expectedDelta).toEqual({
      count: "any",
      creates: true,
      fields: [
        { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
      ],
    });
    const regionCreate = result.result.templates.find((t) => t.name === "region_create");
    expect(regionCreate?.expectedDelta).toEqual({
      count: 1,
      creates: true,
      fields: regionCreateExpectedFields,
    });
    const renderRegion = result.result.templates.find((t) => t.name === "render_region");
    expect(renderRegion).not.toHaveProperty("expectedDelta");
  });

  it("exposes field-check metadata on the ten covered templates", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const expectedFieldsByTemplate = new Map([
      [
        "item_pitch",
        [{ scope: "take", field: "D_PITCH", paramPath: "semitones", tolerance: 1e-6 }],
      ],
      [
        "item_move",
        [{ scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 }],
      ],
      [
        "item_rate",
        [{ scope: "take", field: "D_PLAYRATE", paramPath: "rate", tolerance: 1e-6 }],
      ],
      [
        "item_duplicate",
        [{ scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 }],
      ],
      [
        "media_import",
        [{ scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 }],
      ],
      [
        "item_fade",
        [
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
      ],
      [
        "item_trim",
        [
          { scope: "item", field: "D_LENGTH", paramPath: "length", tolerance: 1e-6 },
          {
            scope: "take",
            field: "D_STARTOFFS",
            paramPath: "start_offset",
            tolerance: 1e-6,
            optional: true,
          },
        ],
      ],
      [
        "track_rename",
        [{ scope: "track", field: "P_NAME", paramPath: "name" }],
      ],
      [
        "track_create",
        [{ scope: "track", field: "P_NAME", paramPath: "name" }],
      ],
      [
        "region_create",
        regionCreateExpectedFields,
      ],
    ]);

    for (const template of result.result.templates) {
      const expectedFields = expectedFieldsByTemplate.get(template.name);
      if (expectedFields !== undefined) {
        expect(template.expectedDelta?.fields).toEqual(expectedFields);
      } else if (template.expectedDelta !== undefined) {
        expect(template.expectedDelta).not.toHaveProperty("fields");
      }
    }
  });

  it("keeps item_duplicate field metadata free of optional and nullable", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const itemDuplicate = result.result.templates.find((t) => t.name === "item_duplicate");
    expect(itemDuplicate?.expectedDelta).toEqual({
      count: 1,
      creates: true,
      fields: [
        { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
      ],
    });
    const field = itemDuplicate?.expectedDelta?.fields?.[0];
    expect(field).not.toHaveProperty("optional");
    expect(field).not.toHaveProperty("nullable");
  });

  it("keeps media_import field metadata free of optional and nullable", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const mediaImport = result.result.templates.find((t) => t.name === "media_import");
    expect(mediaImport?.expectedDelta).toEqual({
      count: "any",
      creates: true,
      fields: [
        { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
      ],
    });
    const field = mediaImport?.expectedDelta?.fields?.[0];
    expect(field).not.toHaveProperty("optional");
    expect(field).not.toHaveProperty("nullable");
  });

  it("keeps track_create field metadata free of tolerance, optional, and nullable", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const trackCreate = result.result.templates.find((t) => t.name === "track_create");
    expect(trackCreate?.expectedDelta).toEqual({
      count: 1,
      maybeCreates: true,
      fields: [
        { scope: "track", field: "P_NAME", paramPath: "name" },
      ],
    });
    const field = trackCreate?.expectedDelta?.fields?.[0];
    expect(field).not.toHaveProperty("tolerance");
    expect(field).not.toHaveProperty("optional");
    expect(field).not.toHaveProperty("nullable");
  });

  it("keeps region_create metadata ordered as name then optional bounds", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const regionCreate = result.result.templates.find((t) => t.name === "region_create");
    expect(regionCreate?.expectedDelta).toEqual({
      count: 1,
      creates: true,
      fields: regionCreateExpectedFields,
    });
    const fields = regionCreate?.expectedDelta?.fields;
    expect(fields).toHaveLength(3);
    expect(fields?.[0]).toEqual({
      scope: "region",
      field: "name",
      paramPath: "name",
    });
    expect(fields?.[0]).not.toHaveProperty("tolerance");
    expect(fields?.[0]).not.toHaveProperty("optional");
    expect(fields?.[0]).not.toHaveProperty("nullable");
    expect(fields?.[1]).toEqual({
      scope: "region",
      field: "pos",
      paramPath: "start",
      tolerance: 1e-6,
      optional: true,
    });
    expect(fields?.[1]).not.toHaveProperty("nullable");
    expect(fields?.[2]).toEqual({
      scope: "region",
      field: "rgnend",
      paramPath: "end",
      tolerance: 1e-6,
      optional: true,
    });
    expect(fields?.[2]).not.toHaveProperty("nullable");
  });

  it("does not leak nullable metadata onto templates that did not declare it", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const template of result.result.templates) {
      const fields = template.expectedDelta?.fields ?? [];
      for (const field of fields) {
        if (template.name === "item_fade") {
          expect(field).toHaveProperty("nullable", true);
        } else {
          expect(field).not.toHaveProperty("nullable");
        }
      }
    }
  });

  it("serializes cleanly through JSON.stringify (no functions or cycles)", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const result = listTemplates(registry);
    expect(() => JSON.stringify(result)).not.toThrow();
    const round = JSON.parse(JSON.stringify(result));
    expect(round.ok).toBe(true);
    expect(Array.isArray(round.result.templates)).toBe(true);
  });

  it("registry order is preserved in the templates array", () => {
    const registry = new CapabilityRegistry();
    const base = {
      pack: "test",
      risk: "read" as const,
      mutates: false,
      undoable: false,
      entity_kind: "item",
      undo_flags: [],
      idempotent: true,
      params: z.object({}),
      result: z.object({}),
      examples: [{ params: {} }],
    };
    registry.register({ name: "a_first", description: "first", ...base });
    registry.register({ name: "b_second", description: "second", ...base });
    const result = listTemplates(registry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.result.templates.map((t) => t.name)).toEqual([
      "a_first",
      "b_second",
    ]);
  });
});
