import assert from "node:assert/strict";
import test from "node:test";

import { compileCapture } from "./alpha4-e-live-agent.mjs";

const DEPENDENCY = Object.freeze({
  kind: "macro",
  id: "macro.items.apply",
  version: "1.5.0",
  risk: "destructive",
  descriptor_hash: "fb25fd3d85c35afe71d728e823eadd33cbbcf37fd20046ead5aa111343db7db5",
  capabilities: Object.freeze([]),
});

for (const operationCount of [5, 10, 20]) {
  test(`compiles ${operationCount} learned operations to one generic Item batch Recipe stage`, () => {
    const artifact = compileCapture(compiledInput(operationCount, "D"));

    assert.equal(artifact.status, "compiled");
    assert.equal(artifact.projection_rows.length, operationCount);
    assert.equal(artifact.run_inputs.mode, "set_item_take_controls");
    assert.equal(artifact.run_inputs.changes, artifact.projection_rows);
    assert.equal(artifact.run_inputs.dry_run, false);
    assert.deepEqual(artifact.draft.inputs.map(({ id, type }) => [id, type]), [
      ["mode", "string"],
      ["changes", "array"],
      ["dry_run", "boolean"],
    ]);
    assert.equal(artifact.draft.stages.length, 1);
    assert.equal(artifact.draft.risk, DEPENDENCY.risk);
    assert.deepEqual(artifact.draft.risk_grants, [DEPENDENCY.risk]);
    assert.equal(artifact.draft.stages[0].dependency.id, "macro.items.apply");
    assert.equal(artifact.draft.dependencies[0].descriptor_hash, DEPENDENCY.descriptor_hash);
    assert.equal(new Set(artifact.projection_rows.map((row) => row.item_ref)).size, operationCount);
    for (const row of artifact.projection_rows) {
      assert.match(row.id, /^f\d{3}[0-9a-f]{8}$/u);
      assert.ok(row.id.length <= 12);
      assert.match(row.item_ref, /^item:guid:\{[0-9A-F-]{36}\}$/u);
      assert.deepEqual(Object.keys(row), ["id", "item_ref", "item"]);
      assert.ok(row.item.length_seconds > 0);
    }
  });
}

test("role-specific carrier salt forces a real Item length delta without changing semantic signatures", () => {
  const demonstrator = compileCapture(compiledInput(5, "D"));
  const learner = compileCapture(compiledInput(5, "L"));

  assert.equal(demonstrator.semantic_signature, learner.semantic_signature);
  assert.equal(demonstrator.intent_signature, learner.intent_signature);
  assert.notDeepEqual(
    demonstrator.projection_rows.map((row) => row.item.length_seconds),
    learner.projection_rows.map((row) => row.item.length_seconds),
  );
});

function compiledInput(operationCount, role) {
  const semanticFacts = Array.from({ length: operationCount }, (_, index) => ({
    operation: "set_control",
    target: `semantic_target_${index + 1}`,
    value: index + 1,
  }));
  return {
    operation_count: operationCount,
    semantic_facts: semanticFacts,
    intent_summary: semanticFacts.map((fact) => `Apply ${fact.value} to ${fact.target}.`),
    blocker_observation: { status: "ready", code: null },
    scenario: "nominal",
    row_prefix: `A4E-${role}-`,
    recipe_id: `recipe.project.alpha4_e_${role.toLowerCase()}_${operationCount}`,
    runtime: {
      dependency: DEPENDENCY,
      item_pool: Array.from({ length: operationCount }, (_, index) => ({
        item_ref: `item:guid:{00000000-0000-0000-0000-${String(index + 1).padStart(12, "0")}}`,
        length_seconds: 2,
      })),
      portability: {
        project_identity: "project:runtime_bound",
        bridge_owner: "bridge:runtime_bound",
        bridge_generation: "generation:runtime_bound",
        platform: "darwin",
      },
    },
  };
}
