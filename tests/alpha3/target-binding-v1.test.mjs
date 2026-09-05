import test from "node:test";
import assert from "node:assert/strict";
import { normalizeTargetBinding, resolveTargetSet } from "../../packages/core/src/target-binding-v1.mjs";

const tracks = [
  { ref: "track:guid:T1", selected: true },
  { ref: "track:guid:T2", selected: true },
  { ref: "track:guid:T3", selected: false },
];
const items = [
  { ref: "item:guid:I1", owner_ref: "track:guid:T1", position_seconds: 1, length_seconds: 2 },
  { ref: "item:guid:I2", owner_ref: "track:guid:T1", position_seconds: 5, length_seconds: 1 },
  { ref: "item:guid:I3", owner_ref: "track:guid:T2", position_seconds: 2, length_seconds: 2 },
  { ref: "item:guid:I4", owner_ref: "track:guid:T3", position_seconds: 2, length_seconds: 2 },
];

test("resolves selected Track owners intersected with the current time selection", () => {
  const result = resolveTargetSet({
    operation: "reverse",
    binding: {
      bind_at: "execution",
      domain: "items",
      selector: "all",
      constraints: [
        { kind: "owner_in", source: { domain: "tracks", selector: "selected" } },
        { kind: "time_relation", source: { domain: "time_range", selector: "time_selection" }, relation: "overlaps" },
      ],
    },
    inventory: { tracks, items },
    timeSelection: { start_seconds: 1.5, end_seconds: 3.5 },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.target_set.member_refs, ["item:guid:I1", "item:guid:I3"]);
  assert.match(result.target_set.fingerprint, /^target-set:/u);
});

test("rejects missing explicit refs and cardinality before mutation", () => {
  const result = resolveTargetSet({
    operation: "glue",
    binding: { domain: "items", selector: "explicit_refs", refs: ["item:guid:UNKNOWN"], cardinality: { minimum: 1, maximum: 1 } },
    inventory: { items },
  });
  assert.equal(result.ok, false);
  assert.equal(result.zero_write, true);
  assert.equal(result.code, "TARGET_BINDING_REF_NOT_FOUND");
});

test("normalizes omitted selector as selected and rejects unsupported fields", () => {
  assert.equal(normalizeTargetBinding({ domain: "items" }).value.selector, "selected");
  assert.equal(normalizeTargetBinding({ domain: "items", mystery: true }).ok, false);
});

test("uses one operation-independent fingerprint for query and mutation", () => {
  const binding = {
    domain: "items",
    selector: "all",
    constraints: [
      { kind: "owner_in", source: { domain: "tracks", selector: "selected" } },
      { kind: "time_relation", source: { domain: "time_range", selector: "explicit_range", range: { start_seconds: 1.5, end_seconds: 4.5 } }, relation: "within" },
    ],
  };
  const query = resolveTargetSet({ operation: "query", binding, inventory: { tracks, items } });
  const reverse = resolveTargetSet({ operation: "reverse", binding, inventory: { tracks, items } });
  assert.equal(query.ok, true);
  assert.deepEqual(query.target_set.member_refs, ["item:guid:I3"]);
  assert.equal(reverse.target_set.fingerprint, query.target_set.fingerprint);
});

test("fails empty, over-limit, duplicate-ref, and unsupported owner shapes zero-write", () => {
  for (const binding of [
    { domain: "items", selector: "selected" },
    { domain: "items", selector: "all", cardinality: { minimum: 1, maximum: 1 } },
    { domain: "items", selector: "explicit_refs", refs: ["item:guid:I1", "item:guid:I1"] },
    { domain: "tracks", selector: "all", constraints: [{ kind: "owner_in", source: { domain: "items", selector: "all" } }] },
  ]) {
    const result = resolveTargetSet({ binding, inventory: { tracks, items }, selection: { items: [] } });
    assert.equal(result.ok, false);
    assert.equal(result.zero_write, true);
  }
});

test("resolves nested Take ownership against the declared owner domain", () => {
  const takes = [
    { ref: "take:guid:K1", item_ref: "item:guid:I1", track_ref: "track:guid:T1" },
    { ref: "take:guid:K2", item_ref: "item:guid:I4", track_ref: "track:guid:T3" },
  ];
  const result = resolveTargetSet({
    binding: {
      domain: "takes",
      selector: "all",
      constraints: [{ kind: "owner_in", source: { domain: "items", selector: "explicit_refs", refs: ["item:guid:I1"] } }],
    },
    inventory: { items, takes },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.target_set.member_refs, ["take:guid:K1"]);
});

test("treats Automation points as instantaneous rows in half-open time intersections", () => {
  const result = resolveTargetSet({
    binding: {
      domain: "points",
      selector: "all",
      constraints: [{
        kind: "time_relation",
        relation: "overlaps",
        source: { domain: "time_range", selector: "explicit_range", range: { start_seconds: 1, end_seconds: 3 } },
      }],
    },
    inventory: {
      points: [
        { point_ref: "automation-point:E:0", time_seconds: 1 },
        { point_ref: "automation-point:E:1", time_seconds: 2.5 },
        { point_ref: "automation-point:E:2", time_seconds: 3 },
      ],
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.target_set.member_refs, ["automation-point:E:0", "automation-point:E:1"]);
});
