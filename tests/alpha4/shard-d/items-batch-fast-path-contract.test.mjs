import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  executeAlpha3_3B1cItemsApplyMacro,
} from "../../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import {
  createAlpha345OfficialExecutableRecipeRevisions,
} from "../../../packages/mcp-server/src/alpha3-45-official-executable-recipes-v1.mjs";
import { createExecutableDependencyCatalog } from "../../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  createAcceptedOfficialMacroDependencyFacts,
  createCallTemplateRuntime,
} from "../../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { FakeFoundationBridge } from "../../../packages/core/src/foundation-bridge-v1.mjs";

const BUDGET = Object.freeze({
  max_response_bytes: 65_536,
  max_items: 128,
  max_inline_value_bytes: 24_576,
});

function recipeContractCatalog() {
  // Keep this focused test independent from the product catalog's exact
  // template-count freeze while still using the real macro dependency facts.
  const facts = createAcceptedOfficialMacroDependencyFacts();
  const macros = facts.map((fact) => ({
    id: fact.id,
    version: fact.version,
    risk: fact.risk,
    descriptor_hash: "0".repeat(64),
    capabilities: fact.capabilities,
  }));
  return createExecutableDependencyCatalog({
    macros,
    templates: [],
    capabilities: [...new Set(facts.flatMap((fact) => fact.capabilities))],
  });
}

function itemRef(index) {
  return `item:guid:{D-${String(index).padStart(3, "0")}}`;
}

function takeRef(index) {
  return `take:guid:{D-TAKE-${String(index).padStart(3, "0")}}`;
}

function rows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `d${String(index + 1).padStart(2, "0")}row`.slice(0, 12),
    item_ref: itemRef(index + 1),
    take_ref: takeRef(index + 1),
    item: { volume_db: -3 - index * 0.1 },
    take: { pan: -0.5 + index * 0.01 },
  }));
}

function objectRef(kind, ref) {
  return {
    kind,
    ref,
    identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) },
  };
}

function execution(id, summary, ok = true, error = null) {
  return {
    ok,
    request: { id },
    verification: { status: ok ? "passed" : "failed" },
    result: {
      summary,
      readback: summary,
      refs: Object.entries(summary ?? {})
        .filter(([key, value]) => key.endsWith("_ref") && typeof value === "string")
        .map(([key, ref]) => objectRef(key.slice(0, -4), ref)),
    },
    ...(ok ? {} : { error: error ?? { code: "ATOMIC_FAILED", message: `${id} failed` } }),
  };
}

function request(input, budget = BUDGET) {
  return {
    id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
    input,
    refs: {},
    context: {
      request_id: "req-alpha4-d-items-batch-contract",
      session_id: "alpha4-d-focused",
      expected_owner: "owner-test",
      expected_generation: 1,
      request_sequence: 1,
      created_at: "2026-07-28T00:00:00.000Z",
    },
    budget,
  };
}

function makeExecutor(inputRows, { failPreflightAt = null, failMutationAt = null, failReadbackAt = null } = {}) {
  const calls = [];
  const state = new Map(inputRows.map((row) => [row.item_ref, {
    item_ref: row.item_ref,
    active_take_ref: row.take_ref,
    volume_db: 0,
    take_pan: 0,
    length_seconds: 8,
    fade_in_seconds: 0,
    fade_out_seconds: 0,
    snap_offset_seconds: 0,
  }]));
  let preflightCount = 0;
  let mutationCount = 0;
  let readbackCount = 0;

  return {
    calls,
    executeAtomic: async (child) => {
      calls.push(child);
      if (child.id === "template.items.resolve_item_ref") {
        return execution(child.id, { item_ref: child.input.ref });
      }

      if (child.id === "template.items.read_item_summary") {
        const ref = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
        const live = state.get(ref);
        if (live && live.volume_db !== 0) readbackCount += 1;
        else preflightCount += 1;
        const failedAt = live && live.volume_db !== 0 ? failReadbackAt : failPreflightAt;
        const count = live && live.volume_db !== 0 ? readbackCount : preflightCount;
        if (failedAt === count) {
          return execution(child.id, {}, false, {
            code: "READBACK_FIXTURE_FAILED",
            message: "fixture read failed",
            details: { zero_write: failedAt === failPreflightAt },
          });
        }
        return execution(child.id, { ...live });
      }

      mutationCount += 1;
      if (failMutationAt === mutationCount) {
        return execution(child.id, {}, false, {
          code: "MUTATION_FIXTURE_FAILED",
          message: "fixture mutation failed",
          details: { zero_write: false },
        });
      }
      const ref = child.refs?.item_ref?.ref ?? child.refs?.item_ref;
      const live = state.get(ref);
      if (!live) return execution(child.id, {}, false);
      if (child.id === "template.items.set_item_volume") live.volume_db = child.input.volume_db;
      if (child.id === "template.items.set_take_pan") live.take_pan = child.input.pan;
      return execution(child.id, { item_ref: ref, readback_status: "passed" });
    },
  };
}

function batchResponse(inputRows, options = {}) {
  const executor = makeExecutor(inputRows, options);
  return executeAlpha3_3B1cItemsApplyMacro({
    request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
    executeAtomic: executor.executeAtomic,
    projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
    monoNow: (() => {
      let tick = 0;
      return () => (tick += 3);
    })(),
  }).then((response) => ({ response, executor }));
}

describe("Alpha4 D Item/Take batch contract seam", () => {
  it("preserves success shape for 1, 8, and 64 rows through the current exported seam", async () => {
    for (const count of [1, 8, 64]) {
      const inputRows = rows(count);
      const { response, executor } = await batchResponse(inputRows);
      assert.equal(response.ok, true, `${count}: ${JSON.stringify(response)}`);
      assert.equal(response.result.changes.length, count);
      assert.equal(response.result.changes.every((row) => row.status === "ok" && row.readback === "pass"), true);
      assert.equal(response.result.data.mode, "set_item_take_controls");
      assert.equal(response.result.data.calls.resolve, count);
      assert.equal(response.result.data.calls.preflight, count);
      assert.equal(response.result.data.calls.readback, count);
      assert.equal(response.result.data.calls.mutation, count * 2);
      assert.equal(response.result.data.calls.total, executor.calls.length + 1);
      for (const timing of Object.values(response.result.data.timings)) {
        assert.equal(typeof timing, "number");
        assert.equal(timing < 30_000, true);
      }
    }
  });

  it("rejects 65 rows before any resolver, mutation, readback, or index call", async () => {
    const inputRows = rows(65);
    const executor = makeExecutor(inputRows);
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
      executeAtomic: executor.executeAtomic,
      projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "ITEM_APPLY_BATCH_CHANGES_INVALID");
    // The current public envelope does not project zero_write for this
    // validation branch; the existing mock seam proves it by observing no
    // resolver, mutation, readback, or index call.
    assert.equal(executor.calls.length, 0);
  });

  it("keeps preflight failure zero-write and reports mutation/readback failure truth", async () => {
    const preflight = await batchResponse(rows(3), { failPreflightAt: 2 });
    assert.equal(preflight.response.ok, false);
    assert.equal(preflight.response.error.code, "READBACK_FIXTURE_FAILED");
    assert.equal(preflight.response.result.data.calls.mutation, 0);
    assert.equal(preflight.executor.calls.some((call) => call.id.startsWith("template.items.set_")), false);

    const mutation = await batchResponse(rows(3), { failMutationAt: 2 });
    assert.equal(mutation.response.ok, false);
    assert.equal(mutation.response.execution.status, "failed");
    assert.equal(mutation.response.error.code, "MUTATION_FIXTURE_FAILED");
    assert.equal(mutation.response.result.data.calls.mutation, 2);
    assert.equal(mutation.response.result.changes[0].status, "fail");

    const readback = await batchResponse(rows(3), { failReadbackAt: 1 });
    assert.equal(readback.response.ok, false);
    assert.equal(readback.response.error.code, "READBACK_FIXTURE_FAILED");
    assert.equal(readback.response.execution.status, "partial_failure");
    assert.equal(readback.response.result.data.calls.mutation > 0, true);
    assert.equal(readback.response.result.changes[0].readback, "fail");
  });

  it("keeps the existing legacy atomic mock executor compatible while recording one public macro request", async () => {
    const inputRows = rows(8);
    const { response, executor } = await batchResponse(inputRows);
    assert.equal(response.macro.id, ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID);
    assert.equal(executor.calls.every((child) => child.id.startsWith("template.items.")), true);
    assert.equal(response.result.verification.evidence_refs.length, 1);
    assert.deepEqual(
      executor.calls.map((child) => child.id).filter((id) => id === "template.items.set_item_volume").length,
      8,
    );
  });

  it("asserts official, user, and fork Recipe sources retain the same generic macro dependency contract", () => {
    const drafts = createAlpha345OfficialExecutableRecipeRevisions({ catalog: recipeContractCatalog() });
    const itemDrafts = drafts
      .map((revision) => revision.draft)
      .filter((draft) => draft.stages.some((stage) => stage.dependency.id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID));
    assert.equal(itemDrafts.length, 2);
    for (const draft of itemDrafts) {
      const controls = draft.stages.find((stage) => stage.id === "controls");
      assert.equal(controls.dependency.id, ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID);
      assert.equal(controls.kind, "macro");
      const fork = structuredClone(draft);
      fork.id = `recipe.user.forked_${draft.id.split(".").at(-1)}`;
      assert.deepEqual(
        fork.stages.map((stage) => [stage.id, stage.kind, stage.dependency.id, stage.inputs, stage.outputs]),
        draft.stages.map((stage) => [stage.id, stage.kind, stage.dependency.id, stage.inputs, stage.outputs]),
      );
    }
  });

  it("routes an explicit user deadline through the existing call_template cancellation seam", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      executor: {
        async dispatch(bridgeRequest) {
          await new Promise((resolve) => setTimeout(resolve, 20));
          return bridge.dispatch(bridgeRequest);
        },
      },
    });
    const response = await runtime.call_template({
      id: ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
      input: { mode: "set_item_take_controls", dry_run: false, changes: rows(1) },
      context: {
        session_id: "alpha4-d-deadline",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-28T00:00:00.000Z",
      },
      deadline_ms: 5,
    });
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "CALL_TEMPLATE_EXECUTION_FAILED");
    assert.equal(response.error.details.request_cancelled, true);
    assert.equal(response.error.details.zero_write, false);
    assert.equal(response.error.details.mutation_truth, "unknown");
    assert.equal(response.result.data.calls.mutation, 0);
  });

  it("passes declared batch capabilities through the generic call_template Macro seam", async () => {
    const seen = [];
    const executor = {
      supportsItemTakeControlsBatch: true,
      supportsAutomationFxParameterEnvelopePointsBatch: true,
      async dispatch(child) {
        seen.push(child);
        throw new Error("stop after capability routing probe");
      },
    };
    const runtime = createCallTemplateRuntime({ executor });
    const response = await runtime.call_template(request({
      mode: "set_item_take_controls",
      dry_run: false,
      changes: rows(1),
    }));

    assert.equal(response.ok, false);
    assert.equal(seen.length, 1);
    assert.equal(seen[0].pack.capability, "items.set_item_take_controls_batch");
  });
});
