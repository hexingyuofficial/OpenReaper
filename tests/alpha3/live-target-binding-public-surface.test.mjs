import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  createLiveTargetBindingPublicSurfaceInventory,
  validateLiveTargetBindingPublicSurfaceInventory,
} from "../../packages/mcp-server/src/live-target-binding-public-surface-v1.mjs";

describe("Live Target Binding public surface inventory", () => {
  it("classifies every public Macro and live Template exactly once", () => {
    const inventory = createLiveTargetBindingPublicSurfaceInventory();
    const validation = validateLiveTargetBindingPublicSurfaceInventory(inventory);
    assert.equal(validation.valid, true, validation.errors.join("\n"));
    assert.deepEqual(inventory.counts, { macros: 15, templates: 242 });
    assert.equal(inventory.macros.some((row) => row.id === "macro.project.query" && row.status === "live_or_explicit"), true);
    assert.equal(inventory.macros.some((row) => row.id === "macro.automation.apply" && row.status === "explicit_only"), true);
    assert.equal(inventory.templates.some((row) => row.id === "template.media.read_take_source" && row.domains.includes("takes")), true);
    assert.equal(inventory.templates.some((row) =>
      row.id === "template.project.create_region"
      && row.status === "live_or_explicit"
      && row.target_bearing === true
      && row.live_default === false
      && row.domains.includes("time_range")
    ), true);
    for (const id of ["template.tracks.freeze_track", "template.tracks.unfreeze_track"]) {
      assert.equal(inventory.templates.some((row) =>
        row.id === id
        && row.status === "live_or_explicit"
        && row.live_default === true
        && row.domains.includes("tracks")
      ), true, id);
    }
    assert.equal(inventory.templates.every((row) => row.status !== "constraint_only"), true);
  });

  it("rejects stale, duplicate, and unclassified rows", () => {
    const inventory = createLiveTargetBindingPublicSurfaceInventory();
    const broken = {
      ...inventory,
      macros: [...inventory.macros, { ...inventory.macros[0], id: "macro.stale" }],
      templates: [...inventory.templates, inventory.templates[0]],
    };
    const validation = validateLiveTargetBindingPublicSurfaceInventory(broken);
    assert.equal(validation.valid, false);
    assert.match(validation.errors.join("\n"), /stale|duplicate/iu);
  });
});
