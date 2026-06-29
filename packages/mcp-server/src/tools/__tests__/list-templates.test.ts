import { describe, it, expect } from "vitest";
import { CapabilityRegistry } from "@streetlight/core";
import { z } from "zod";
import { listTemplates } from "../list-templates.js";
import { registerCoreTemplates } from "../../templates/index.js";

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
    expect(renderRegion.idempotent).toBe(false);
    expect(renderRegion.mutates).toBe(true);
    expect(renderRegion.params_schema).toBeDefined();
    expect(renderRegion.result_schema).toBeDefined();

    const callTemplateEnvelope = templates.find((t) => t.name === "item_pitch");
    expect(callTemplateEnvelope).toBeDefined();
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
      idempotent: true,
      params: z.object({}),
      result: z.object({}),
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
