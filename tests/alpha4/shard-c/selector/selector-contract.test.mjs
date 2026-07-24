import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFile } from "node:fs/promises";

import {
  ALPHA4_SHARD_C_SELECTOR_FAILURE_FIXTURES,
  ALPHA4_SHARD_C_SELECTOR_MATRIX,
  ALPHA4_SHARD_C_SELECTOR_SCHEMA,
  PREDICATE_FIELDS,
  SELECTOR_KINDS,
  SELECTOR_STATUSES,
  validateSelector,
  validateSelectorMatrix,
  validateSnapshot,
} from "./selector-contract.mjs";

const EXPECTED_IDS = [
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.items.analyze",
  "macro.items.apply",
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
  "macro.controls.set",
  "macro.automation.apply",
  "macro.render.targets",
];

describe("Alpha4 Shard C selector and predicate contract", () => {
  it("publishes exactly the fifteen current Macro rows without importing runtime", async () => {
    const source = await readFile(new URL("./selector-contract.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /packages\//u);
    assert.doesNotMatch(source, /reaper\//u);
    assert.deepEqual(validateSelectorMatrix(), { valid: true, errors: [] });
    assert.deepEqual(ALPHA4_SHARD_C_SELECTOR_MATRIX.map((row) => row.macro_id), EXPECTED_IDS);
    assert.equal(ALPHA4_SHARD_C_SELECTOR_MATRIX.every((row) => SELECTOR_STATUSES.includes(row.status)), true);
    assert.equal(ALPHA4_SHARD_C_SELECTOR_MATRIX.filter((row) => row.status === "held").length, 0);
  });

  it("keeps selected, explicit, and predicate shapes bounded and typed", () => {
    assert.deepEqual(Object.keys(ALPHA4_SHARD_C_SELECTOR_SCHEMA.selector.oneOf).length, 3);
    assert.deepEqual(SELECTOR_KINDS, ["current_selection", "explicit_refs", "predicate"]);
    assert.deepEqual(PREDICATE_FIELDS.track, ["muted", "soloed", "record_armed", "name"]);
    assert.deepEqual(PREDICATE_FIELDS.item, ["muted", "locked", "active_take_name"]);

    assert.deepEqual(validateSelector({ kind: "current_selection", entity_kind: "item" }), { valid: true, errors: [] });
    assert.deepEqual(validateSelector({ kind: "explicit_refs", refs: ["item:guid:{A}", "item:guid:{B}"] }), { valid: true, errors: [] });
    assert.deepEqual(validateSelector({ kind: "predicate", entity_kind: "track", field: "muted", operator: "equals", value: true }), { valid: true, errors: [] });
    assert.deepEqual(validateSelector({ kind: "predicate", entity_kind: "item", field: "active_take_name", operator: "contains", value: "lead" }), { valid: true, errors: [] });
  });

  it("rejects invalid selector shapes before a write or Undo scope", () => {
    assert.equal(validateSelector({ kind: "predicate", entity_kind: "track", field: "locked", operator: "equals", value: true }).errors[0].code, "PREDICATE_FIELD_INVALID");
    assert.equal(validateSelector({ kind: "predicate", entity_kind: "track", field: "name", operator: "contains", value: true }).errors[0].code, "PREDICATE_VALUE_OPERATOR_INVALID");
    assert.equal(validateSelector({ kind: "explicit_refs", refs: ["item:guid:{A}", "item:guid:{A}"] }).errors[0].code, "SELECTOR_DUPLICATE_REF");
    assert.equal(validateSelector({ kind: "explicit_refs", refs: ["item:guid:{A}", "not-a-ref"] }).errors[0].code, "SELECTOR_REF_INVALID");
  });

  it("freezes project/owner/generation/selection/revision identity for writes", () => {
    const valid = {
      project_ref: "project:current",
      bridge_owner: "owner:shard-c",
      bridge_generation: 7,
      selection_token: "selection:42",
      revision: "revision:99",
      frozen_refs: ["item:guid:{A}", "item:guid:{B}"],
    };
    assert.deepEqual(validateSnapshot(valid), { valid: true, errors: [] });
    assert.equal(validateSnapshot({ ...valid, bridge_generation: -1 }).errors[0].code, "SNAPSHOT_GENERATION_INVALID");
    assert.equal(validateSnapshot({ ...valid, frozen_refs: ["item:guid:{A}", "item:guid:{A}"] }).errors[0].code, "SNAPSHOT_REFS_INVALID");
  });

  it("keeps every blocker fixture typed and zero-write while allowing explicit predicate batches", () => {
    assert.equal(ALPHA4_SHARD_C_SELECTOR_FAILURE_FIXTURES.length, 9);
    for (const fixture of ALPHA4_SHARD_C_SELECTOR_FAILURE_FIXTURES) {
      assert.equal(typeof fixture.id, "string");
      assert.equal(typeof fixture.expected.code, "string", fixture.id);
      if (fixture.id === "predicate-name-batch") {
        assert.equal(fixture.expected.code, "SELECTOR_TARGETS_BATCHED");
        assert.equal(fixture.expected.writes, 2);
        assert.equal(fixture.expected.undo_opened, true);
      } else {
        assert.equal(fixture.expected.writes, 0, fixture.id);
        assert.equal(fixture.expected.undo_opened, false, fixture.id);
      }
    }
    const limit = ALPHA4_SHARD_C_SELECTOR_FAILURE_FIXTURES.find((fixture) => fixture.id === "candidate-limit-513");
    assert.equal(limit.input.refs.length, 513);
    assert.equal(limit.expected.code, "SELECTOR_LIMIT_EXCEEDED");
  });
});
