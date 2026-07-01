import { describe, expect, it } from "vitest";
import { z } from "zod";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityRegistry } from "../../packages/core/src/registry.ts";
import {
  registerCoreTemplates,
  registerEnabledTemplates,
} from "../../packages/mcp-server/src/templates/index.ts";
import {
  findExampleSchemaMismatches,
  findSlugMismatches,
  formatZodIssues,
  lintDefinitions,
  readTemplateFilenames,
  templateSlug,
} from "../template-authoring-lint.mjs";

/**
 * Slice 16 — author-side lint. Slice 16 S16-C2 locks the positive-only
 * `examples[]` convention; the reverse fixtures below are deliberately
 * here and not in real template files.
 */

function makeFakeDef({
  name,
  params,
  examples,
}) {
  return {
    name,
    description: `${name} (fixture)`,
    pack: "core",
    risk: "write_safe",
    mutates: true,
    undoable: true,
    entity_kind: "item",
    undo_flags: ["ITEMS"],
    idempotent: true,
    params,
    result: z.object({}).strict(),
    examples,
    expectedDelta: { count: 1 },
  };
}

const ItemPitchLikeParams = z
  .object({
    item_id: z.string().min(1),
    semitones: z.number().finite().min(-24).max(24),
  })
  .strict();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

describe("template authoring lint — pure helpers", () => {
  it("converts snake_case names to kebab-case file slugs", () => {
    expect(templateSlug("item_pitch")).toBe("item-pitch");
    expect(templateSlug("media_import")).toBe("media-import");
    expect(templateSlug("render_region")).toBe("render-region");
  });

  it("formats a Zod issue list with path-then-message and joins with semicolons", () => {
    const result = ItemPitchLikeParams.safeParse({
      item_id: "",
      semitones: 99,
      extra: "unknown",
    });
    expect(result.success).toBe(false);
    const formatted = formatZodIssues(result.error.issues);
    expect(formatted).toMatch(/semitones: /);
    expect(formatted.split("; ").length).toBeGreaterThanOrEqual(2);
  });

  it("uses <root> for empty path issues", () => {
    const schema = z.string();
    const issues = schema.safeParse(123).error.issues;
    expect(formatZodIssues(issues)).toMatch(/^<root>: /);
  });

  it("returns [] when all examples parse cleanly", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [
        { description: "down a semitone", params: { item_id: "selected:0", semitones: -1 } },
        { description: "neutral", params: { item_id: "guid:{ABCD}", semitones: 0 } },
      ],
    });
    expect(findExampleSchemaMismatches([def])).toEqual([]);
  });

  it("reports examples whose params fall outside the Zod schema's numeric range", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [
        { description: "too aggressive", params: { item_id: "selected:0", semitones: 99 } },
      ],
    });
    const errors = findExampleSchemaMismatches([def]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(
      /^EXAMPLE_REJECTED_BY_SCHEMA:item_pitch:examples\[0\] \(too aggressive\): /,
    );
    expect(errors[0]).toMatch(/semitones: /);
  });

  it("reports examples that violate .strict() with unknown keys", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [
        { params: { item_id: "selected:0", semitones: -3, mode: "ignored" } },
      ],
    });
    const errors = findExampleSchemaMismatches([def]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/^EXAMPLE_REJECTED_BY_SCHEMA:item_pitch:examples\[0\]: /);
    expect(errors[0]).toMatch(/mode/);
  });

  it("indexes each failing example separately", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [
        { params: { item_id: "selected:0", semitones: 0 } },
        { description: "bad", params: { item_id: "selected:0", semitones: 999 } },
      ],
    });
    const errors = findExampleSchemaMismatches([def]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toMatch(/examples\[1\] \(bad\)/);
  });

  it("flags registered templates that have no matching .ts file", () => {
    const def = makeFakeDef({
      name: "foo_bar",
      params: z.object({}).strict(),
      examples: [{ params: {} }],
    });
    const errors = findSlugMismatches([def], ["item-pitch.ts"]);
    expect(errors).toContain(
      "SLUG_MISSING_FILE:foo_bar: expected file foo-bar.ts in packages/mcp-server/src/templates/",
    );
  });

  it("flags .ts files that have no matching registered template", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [{ params: { item_id: "selected:0", semitones: 0 } }],
    });
    const errors = findSlugMismatches([def], ["item-pitch.ts", "quux.ts"]);
    expect(errors).toContain(
      'SLUG_ORPHAN_FILE:quux.ts: no registered template matches slug "quux"',
    );
  });

  it("returns [] when slug parity holds in both directions", () => {
    const def = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [{ params: { item_id: "selected:0", semitones: 0 } }],
    });
    expect(findSlugMismatches([def], ["item-pitch.ts"])).toEqual([]);
  });

  it("lintDefinitions concatenates schema and slug errors", () => {
    const badExample = makeFakeDef({
      name: "item_pitch",
      params: ItemPitchLikeParams,
      examples: [{ params: { item_id: "selected:0", semitones: 999 } }],
    });
    const orphanFile = ["item-pitch.ts", "ghost.ts"];
    const errors = lintDefinitions([badExample], orphanFile);

    expect(errors.some((e) => e.startsWith("EXAMPLE_REJECTED_BY_SCHEMA:item_pitch"))).toBe(
      true,
    );
    expect(errors.some((e) => e.startsWith("SLUG_ORPHAN_FILE:ghost.ts"))).toBe(true);
  });
});

describe("template authoring lint — real registry", () => {
  it("every shipped template parses its own positive examples", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const defs = registry.rawDefinitions();
    expect(defs.length).toBeGreaterThan(0);
    expect(findExampleSchemaMismatches(defs)).toEqual([]);
  });

  it("every shipped template's slug matches its TS file basename", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const defs = registry.rawDefinitions();
    const expectedFiles = defs.map((d) => `${templateSlug(d.name)}.ts`).sort();
    expect(findSlugMismatches(defs, expectedFiles)).toEqual([]);
  });

  it("checks fixture pack examples and slugs when the pack is enabled", async () => {
    const registry = new CapabilityRegistry();
    registerEnabledTemplates(registry, ["core", "pack_contract_fixture"]);
    const defs = registry.rawDefinitions();
    const templateFiles = await readTemplateFilenames(repoRoot, [
      "core",
      "pack_contract_fixture",
    ]);

    expect(defs.some((def) => def.name === "fixture_track_rename")).toBe(true);
    expect(templateFiles).toContain("fixture-track-rename.ts");
    expect(findExampleSchemaMismatches(defs)).toEqual([]);
    expect(findSlugMismatches(defs, templateFiles)).toEqual([]);
  });

  it("checks cleanup pack examples and slugs when the pack is enabled", async () => {
    const registry = new CapabilityRegistry();
    registerEnabledTemplates(registry, ["core", "cleanup"]);
    const defs = registry.rawDefinitions();
    const templateFiles = await readTemplateFilenames(repoRoot, [
      "core",
      "cleanup",
    ]);

    expect(defs.some((def) => def.name === "cleanup_plan")).toBe(true);
    expect(templateFiles).toContain("cleanup-plan.ts");
    expect(findExampleSchemaMismatches(defs)).toEqual([]);
    expect(findSlugMismatches(defs, templateFiles)).toEqual([]);
  });
});
