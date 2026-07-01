import { describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CapabilityRegistry } from "../../packages/core/src/registry.ts";
import {
  registerCoreTemplates,
  registerEnabledTemplates,
} from "../../packages/mcp-server/src/templates/index.ts";
import {
  MANIFEST_FORMAT_UNEXPECTED,
  buildRegistrySnapshot,
  diffEntityBucketConflicts,
  diffManifestAlignment,
  diffPackManifestAlignment,
  parseManifestEntityBuckets,
  parseManifestLua,
  parseManifestLuaFull,
  stripLuaLineComments,
} from "../manifest-alignment.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "../..");

const SAMPLE_MANIFEST = `
return {
  name = "core",
  version = "0.1.0",
  entity_buckets = {
    item = "items",
    track = "tracks",
  },
  templates = {
    item_pitch = {
      handler = item_templates.item_pitch,
      undoable = true,
      undo_flags = undo.UNDO_STATE_ITEMS,
      entity_kind = "item",
    },
    media_import = {
      handler = media_templates.media_import,
      undoable = true,
      undo_flags = undo.UNDO_STATE_ITEMS | undo.UNDO_STATE_TRACKCFG,
      entity_kind = "item",
    },
    render_region = {
      handler = render_templates.render_region,
      undoable = false,
      entity_kind = "render",
      artifact = {
        kind = "external_file",
        path_shape = "absolute_wav_path",
        read_scope = false,
        updates_last_result = true,
        legacy_carve_out = true,
      },
    },
  },
}
`;

describe("manifest alignment helpers", () => {
  it("strips Lua line comments before parsing template entries", () => {
    expect(stripLuaLineComments('-- changed_ids = { "x" }\nitem = true')).toBe(
      "\nitem = true",
    );
  });

  it("parses manifest metadata for undoable and non-undoable templates", () => {
    const parsed = parseManifestLua(SAMPLE_MANIFEST);
    expect(parsed.get("item_pitch")).toEqual({
      undoable: true,
      undo_flags: ["ITEMS"],
      entity_kind: "item",
    });
    expect(parsed.get("media_import")).toEqual({
      undoable: true,
      undo_flags: ["ITEMS", "TRACKCFG"],
      entity_kind: "item",
    });
    expect(parsed.get("render_region")).toEqual({
      undoable: false,
      undo_flags: [],
      entity_kind: "render",
      artifact: {
        kind: "external_file",
        path_shape: "absolute_wav_path",
        read_scope: null,
        updates_last_result: true,
        legacy_carve_out: true,
      },
    });
  });

  it("parses pack identity and entity buckets", () => {
    const parsed = parseManifestLuaFull(SAMPLE_MANIFEST);
    expect(parsed.name).toBe("core");
    expect(parsed.version).toBe("0.1.0");
    expect([...parsed.entity_buckets.entries()]).toEqual([
      ["item", "items"],
      ["track", "tracks"],
    ]);
    expect(parsed.templates.get("item_pitch")?.entity_kind).toBe("item");
  });

  it("allows manifests without local entity bucket declarations", () => {
    expect(parseManifestEntityBuckets('return { name = "fixture", templates = {} }')).toEqual(
      new Map(),
    );
  });

  it("rejects unsupported multi-line undo_flags expressions", () => {
    expect(() =>
      parseManifestLua(`
return { templates = {
  item_pitch = {
    undoable = true,
    undo_flags = undo.UNDO_STATE_ITEMS
      | undo.UNDO_STATE_TRACKCFG,
    entity_kind = "item",
  },
} }
`),
    ).toThrow(MANIFEST_FORMAT_UNEXPECTED);
  });

  it("reports field mismatches and missing templates", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "track",
          expectedDelta: { count: 1 },
        },
      ],
      [
        "ts_only",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: { count: 1 },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      'FIELD_MISMATCH:item_pitch.entity_kind: ts="track" lua="item"',
    );
    expect(errors).toContain("MISSING_IN_LUA:ts_only");
    expect(errors).toContain("MISSING_IN_TS:media_import");
    expect(errors).toContain("MISSING_IN_TS:render_region");
  });

  it("reports pack identity mismatches before template diffs", () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const ts = buildRegistrySnapshot(registry);
    const manifest = parseManifestLuaFull(SAMPLE_MANIFEST.replace('name = "core"', 'name = "wrong"'));
    const errors = diffPackManifestAlignment("core", ts, manifest);

    expect(errors).toContain('PACK_NAME_MISMATCH:core: lua="wrong"');
  });

  it("reports entity bucket conflicts across pack manifests", () => {
    const errors = diffEntityBucketConflicts([
      { name: "core", entity_buckets: new Map([["item", "items"]]) },
      { name: "other", entity_buckets: new Map([["item", "objects"]]) },
      { name: "third", entity_buckets: new Map([["region", "items"]]) },
    ]);

    expect(errors).toContain("ENTITY_BUCKET_KIND_CONFLICT:item: items vs objects in other");
    expect(errors).toContain("ENTITY_BUCKET_NAME_CONFLICT:items: item vs region in third");
    expect(errors).toContain(
      "ENTITY_BUCKET_NON_CORE_NEW_KIND:third.region: non-core packs may only reuse core entity kinds in Slice 20B",
    );
  });

  it("reports missing and misplaced expectedDelta descriptors", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
        },
      ],
      [
        "render_region",
        {
          mutates: true,
          undoable: false,
          undo_flags: [],
          entity_kind: "render",
          expectedDelta: { count: 1 },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain("EXPECTED_DELTA_MISSING:item_pitch");
    expect(errors).toContain("EXPECTED_DELTA_FOR_NON_UNDOABLE:render_region");
  });

  it("reports artifact metadata mismatches", () => {
    const ts = new Map([
      [
        "render_region",
        {
          mutates: true,
          undoable: false,
          undo_flags: [],
          entity_kind: "render",
          artifact: {
            kind: "external_file",
            path_shape: "absolute_wav_path",
            read_scope: null,
            updates_last_result: true,
            legacy_carve_out: true,
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST.replace(
      'path_shape = "absolute_wav_path"',
      'path_shape = "relative_path"',
    ));

    expect(diffManifestAlignment(ts, lua)).toContain(
      'FIELD_MISMATCH:render_region.artifact: ts={"kind":"external_file","legacy_carve_out":true,"path_shape":"absolute_wav_path","read_scope":null,"updates_last_result":true} lua={"kind":"external_file","legacy_carve_out":true,"path_shape":"relative_path","read_scope":null,"updates_last_result":true}',
    );
  });

  it("reports invalid expectedDelta mode combinations", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: { count: 1, creates: true, maybeCreates: true },
        },
      ],
      [
        "media_import",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS", "TRACKCFG"],
          entity_kind: "item",
          expectedDelta: { count: "any", maybeCreates: true },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: creates/maybeCreates/deletes are mutually exclusive",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:media_import: maybeCreates requires a numeric count",
    );
  });

  it("reports invalid expectedDelta fields descriptors", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: 1,
            fields: [
              { scope: "take", field: "D_PITCH", paramPath: "take.pitch", tolerance: -1 },
              { scope: "take", field: "D_PITCH", paramPath: "semitones" },
              { scope: "fx", field: "", paramPath: "" },
              { scope: "item", field: "D_LENGTH", paramPath: "length", optional: "yes" },
              { scope: "item", field: "D_FADEINLEN", paramPath: "fade_in", nullable: "yes" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[0] paramPath must be top-level",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[0] invalid tolerance",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: duplicate field take:D_PITCH",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[2] missing field",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[2] has invalid scope",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[2] missing paramPath",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[3] optional must be boolean",
    );
    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields[4] nullable must be boolean",
    );
  });

  it("allows fields with creates:true when count is a positive integer", () => {
    const makeTs = (count) =>
      new Map([
        [
          "item_pitch",
          {
            mutates: true,
            undoable: true,
            undo_flags: ["ITEMS"],
            entity_kind: "item",
            expectedDelta: {
              count,
              creates: true,
              fields: [
                { scope: "item", field: "D_POSITION", paramPath: "position", tolerance: 1e-6 },
              ],
            },
          },
        ],
      ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);

    for (const count of [1, 3]) {
      const errors = diffManifestAlignment(makeTs(count), lua);
      expect(errors.filter((error) => error.startsWith("EXPECTED_DELTA_INVALID:item_pitch"))).toEqual([]);
    }
  });

  it("allows fields with creates:true and count:any", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: "any",
            creates: true,
            fields: [
              { scope: "item", field: "D_POSITION", paramPath: "position" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).not.toContain(
      'EXPECTED_DELTA_INVALID:item_pitch: fields with creates:true requires count "any" or numeric >= 1',
    );
  });

  it("allows region-scope expectedDelta fields", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["MISCCFG"],
          entity_kind: "region",
          expectedDelta: {
            count: 1,
            creates: true,
            fields: [
              { scope: "region", field: "name", paramPath: "name" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors.filter((error) => error.startsWith("EXPECTED_DELTA_INVALID:item_pitch"))).toEqual([]);
  });

  it("allows mixed-optional region bounds fields with creates:true", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["MISCCFG"],
          entity_kind: "region",
          expectedDelta: {
            count: 1,
            creates: true,
            fields: [
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
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors.filter((error) => error.startsWith("EXPECTED_DELTA_INVALID:item_pitch"))).toEqual([]);
  });

  it("still allows all four field scopes after Slice 13", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: 1,
            fields: [
              { scope: "take", field: "D_PITCH", paramPath: "semitones" },
              { scope: "item", field: "D_POSITION", paramPath: "position" },
              { scope: "track", field: "P_NAME", paramPath: "name" },
              { scope: "region", field: "name", paramPath: "region_name" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors.filter((error) => error.includes("invalid scope"))).toEqual([]);
  });

  it("rejects fields with creates:true and non-positive count", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: 0,
            creates: true,
            fields: [
              { scope: "item", field: "D_POSITION", paramPath: "position" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      'EXPECTED_DELTA_INVALID:item_pitch: fields with creates:true requires count "any" or numeric >= 1',
    );
  });

  it("allows fields with maybeCreates:true when count is a positive integer", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "track",
          expectedDelta: {
            count: 1,
            maybeCreates: true,
            fields: [
              { scope: "track", field: "P_NAME", paramPath: "name" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).not.toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields with maybeCreates:true requires numeric count >= 1",
    );
  });

  it("rejects fields with maybeCreates:true and count:any", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "track",
          expectedDelta: {
            count: "any",
            maybeCreates: true,
            fields: [
              { scope: "track", field: "P_NAME", paramPath: "name" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: maybeCreates requires a numeric count",
    );
  });

  it("rejects fields with maybeCreates:true and non-positive count", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "track",
          expectedDelta: {
            count: 0,
            maybeCreates: true,
            fields: [
              { scope: "track", field: "P_NAME", paramPath: "name" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields with maybeCreates:true requires numeric count >= 1",
    );
  });

  it("still rejects fields with deletes", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: 1,
            deletes: true,
            fields: [
              { scope: "item", field: "D_POSITION", paramPath: "position" },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields cannot coexist with deletes",
    );
  });

  it("allows all-optional expectedDelta fields when every field is nullable", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
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
                nullable: true,
              },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).not.toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields may be all-optional only when every field is nullable",
    );
  });

  it("reports expectedDelta fields when every field is optional but not nullable", () => {
    const ts = new Map([
      [
        "item_pitch",
        {
          mutates: true,
          undoable: true,
          undo_flags: ["ITEMS"],
          entity_kind: "item",
          expectedDelta: {
            count: 1,
            fields: [
              { scope: "take", field: "D_STARTOFFS", paramPath: "start_offset", optional: true },
            ],
          },
        },
      ],
    ]);
    const lua = parseManifestLua(SAMPLE_MANIFEST);
    const errors = diffManifestAlignment(ts, lua);

    expect(errors).toContain(
      "EXPECTED_DELTA_INVALID:item_pitch: fields may be all-optional only when every field is nullable",
    );
  });

  it("real core registry aligns with the real Lua manifest", async () => {
    const registry = new CapabilityRegistry();
    registerCoreTemplates(registry);
    const ts = buildRegistrySnapshot(registry);
    const manifest = await fs.readFile(
      path.join(repoRoot, "reaper/packs/core/manifest.lua"),
      "utf8",
    );
    const lua = parseManifestLua(manifest);

    expect(diffManifestAlignment(ts, lua)).toEqual([]);
  });

  async function expectEnabledPacksAlign(enabledPacks) {
    const registry = new CapabilityRegistry();
    registerEnabledTemplates(registry, enabledPacks);
    const ts = buildRegistrySnapshot(registry);
    const manifests = [];

    for (const pack of enabledPacks) {
      const manifest = await fs.readFile(
        path.join(repoRoot, "reaper/packs", pack, "manifest.lua"),
        "utf8",
      );
      manifests.push(parseManifestLuaFull(manifest));
    }

    expect(diffEntityBucketConflicts(manifests)).toEqual([]);
    expect(
      manifests.flatMap((manifest, index) =>
        diffPackManifestAlignment(enabledPacks[index], ts, manifest),
      ),
    ).toEqual([]);
  }

  it("real enabled core + fixture registries align with their Lua manifests", async () => {
    await expectEnabledPacksAlign(["core", "pack_contract_fixture"]);
  });

  it("real enabled core + cleanup registries align with their Lua manifests", async () => {
    await expectEnabledPacksAlign(["core", "cleanup"]);
  });

  it("real enabled core + cleanup + fixture registries align with their Lua manifests", async () => {
    await expectEnabledPacksAlign(["core", "cleanup", "pack_contract_fixture"]);
  });
});
