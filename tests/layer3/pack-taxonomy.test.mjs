import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { FOUNDATION_BRIDGE_PACK_IDS } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  DIFFICULT_PLACEMENT_CASES,
  FIXED_PACK_IDS,
  WORKFLOW_SHAPED_PACK_IDS,
  listPackDirectories,
  parseFixedPackList,
  validateFixedPackList,
  validatePackTaxonomy,
} from "../../scripts/check-pack-taxonomy.mjs";

const root = process.cwd();

describe("Layer 3 pack taxonomy freeze", () => {
  it("freezes the exact 16 top-level pack ids", () => {
    assert.deepEqual(readTaxonomyPackList(), FIXED_PACK_IDS);
    assert.equal(FIXED_PACK_IDS.length, 16);
  });

  it("rejects an extra top-level pack", () => {
    const result = validateFixedPackList([...FIXED_PACK_IDS, "sws"]);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Extra pack ids: sws/);
  });

  it("rejects duplicate top-level packs", () => {
    const result = validateFixedPackList(["core", ...FIXED_PACK_IDS]);

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Duplicate pack ids: core/);
  });

  it("rejects missing top-level packs", () => {
    const result = validateFixedPackList(FIXED_PACK_IDS.filter((pack) => pack !== "ui"));

    assert.equal(result.ok, false);
    assert.match(result.errors.join("\n"), /Missing pack ids: ui/);
  });

  it("rejects workflow-shaped pack ids", () => {
    for (const workflow of WORKFLOW_SHAPED_PACK_IDS) {
      const result = validateFixedPackList(
        FIXED_PACK_IDS.map((pack) => (pack === "core" ? workflow : pack)),
      );

      assert.equal(result.ok, false);
      assert.match(result.errors.join("\n"), new RegExp(`Workflow-shaped pack ids are forbidden: ${workflow}`));
    }
  });

  it("matches the frozen foundation bridge pack ids without changing lower layers", () => {
    assert.deepEqual(FOUNDATION_BRIDGE_PACK_IDS, FIXED_PACK_IDS);
  });

  it("matches the reaper/packs directory names as an exact set", () => {
    assert.deepEqual(
      listPackDirectories(root),
      [...FIXED_PACK_IDS].sort((a, b) => a.localeCompare(b)),
    );
  });

  it("validates the taxonomy doc, review notes, and non-migration claims", () => {
    const result = validatePackTaxonomy(root);

    assert.deepEqual(result.errors, []);
    assert.equal(result.ok, true);
  });

  it("covers the difficult REAPER/SWS placement examples", () => {
    assert.deepEqual(Object.fromEntries(DIFFICULT_PLACEMENT_CASES), {
      "video processor VIDEO_CODE": "fx",
      "import video source": "media",
      "trim video item": "items",
      "render video": "render",
      "region render matrix": "render",
      "spectral edits on take": "items",
      notation: "midi",
      MusicXML: "midi",
      "tempo/time map": "project",
      "warp grid": "project",
      "ordinary markers/regions": "project",
      "SWS marker action text editing": "project",
      "resolving/executing marker/custom action": "actions",
      "Project Bay": "media",
      "Media Explorer": "media",
      "SWS resources with media/project-template/FX-chain content": "media",
      "global resource paths/environment": "system",
      "snap/grid/groove for project timeline": "project",
      "snap/grid/groove for MIDI event data": "midi",
      "SWS warp grid": "project",
      "track/VCA grouping": "tracks",
      "item grouping": "items",
      "send grouping": "routing",
      "envelope grouping": "automation",
      "takes/comping/lanes": "items",
      "razor edit item operations": "items",
      "razor edit automation operations": "automation",
      "render razor edit areas": "render",
      "loudness/peak/RMS/LUFS measurement": "analysis",
      "loudness normalization/export application": "render",
      "SWS snapshots/resources/cycle actions/live configs/ReaConsole": "no SWS pack",
      "OSC/control surface/MIDI learn/hardware MIDI send": "hardware_control",
      "MIDI notes/CC/event list/notation": "midi",
    });

    const taxonomy = readFileSync(
      path.join(root, "docs/taxonomy/PACK_TAXONOMY_V1.md"),
      "utf8",
    );
    for (const [capability, owner] of DIFFICULT_PLACEMENT_CASES) {
      assert.match(taxonomy, new RegExp(escapeRegExp(`${capability} -> ${owner}`)));
    }
  });
});

function readTaxonomyPackList() {
  return parseFixedPackList(
    readFileSync(path.join(root, "docs/taxonomy/PACK_TAXONOMY_V1.md"), "utf8"),
  );
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
