import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID,
  executeAlpha3_3B1cItemsApplyMacro,
} from "../../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";
import {
  createAlpha345OfficialExecutableRecipeRevisions,
} from "../../../packages/mcp-server/src/alpha3-45-official-executable-recipes-v1.mjs";
import { createExecutableDependencyCatalog } from "../../../packages/core/src/executable-recipe-contract-v1.mjs";
import { createExecutableRecipeRevisionStore } from "../../../packages/core/src/executable-recipe-revision-store-v1.mjs";
import {
  createAcceptedOfficialMacroDependencyFacts,
  createCallTemplateRuntime,
} from "../../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { createCallRecipeRuntime } from "../../../packages/mcp-server/src/call-recipe-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
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

function itemOnlyRows(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `i${String(index + 1).padStart(3, "0")}`,
    item_ref: itemRef(index + 1),
    item: { position_seconds: index * 2, muted: index % 2 === 0 },
  }));
}

function fullControlRows(count) {
  return Array.from({ length: count }, (_, index) => {
    const suffix = String(index + 1).padStart(12, "0");
    return {
      id: `ctl${String(index + 1).padStart(3, "0")}`,
      item_ref: `item:guid:{00000000-0000-0000-0000-${suffix}}`,
      take_ref: `take:guid:{10000000-0000-0000-0000-${suffix}}`,
      item: {
        volume_db: -2 + index * 0.01,
        length_seconds: 1.5 + index * 0.001,
        fade_in_seconds: 0.01,
        fade_out_seconds: 0.05,
        snap_offset_seconds: 0.02,
      },
      take: {
        volume_db: -1 + index * 0.01,
        pan: -0.4 + index * 0.01,
        pitch_semitones: -3 + index * 0.05,
        playrate: 0.92 + index * 0.001,
        preserve_pitch: true,
      },
    };
  });
}

function makeNativeBatchExecutor({ failAt = null } = {}) {
  const calls = [];
  const executeAtomic = async (child) => {
    calls.push(child);
    assert.equal(child.id, "template.items.set_item_take_controls_batch");
    const changes = child.input.batch.map((row, index) => {
      const failed = failAt === index + 1;
      return {
        ...row,
        status: child.input.dry_run ? "planned" : failed ? "failed" : "applied",
        mutation: { status: child.input.dry_run ? "not_run" : "completed" },
        live_readback: { status: child.input.dry_run ? "not_run" : failed ? "failed" : "passed" },
        ...(failed ? { code: "ITEM_APPLY_NATIVE_READBACK_FAILED" } : {}),
        fields: ["volume_db", "length_seconds", "fades", "snap_offset_seconds", "take_volume_db", "take_pan", "take_pitch_semitones", "take_playback"],
      };
    });
    return execution(child.id, {
      changes,
      batch_timings: { preflight_ms: 3, mutation_ms: 5, readback_ms: 4, total_ms: 12 },
      native_counters: {
        native_mutation_count: child.input.dry_run ? 0 : changes.length,
        readback_count: changes.length,
      },
    });
  };
  executeAtomic.supportsItemTakeControlsBatch = true;
  return { calls, executeAtomic };
}

function batchRecipeFixture(catalog, macroFact) {
  const descriptorHash = catalog.getMacro(macroFact.id).descriptor_hash;
  return {
    contract: "recipe.executable.draft.v1",
    id: "recipe.items.batch_controls_projection_fixture",
    title: "Batch Item controls projection fixture",
    summary: "Proves a generic Recipe Macro stage accepts a projected 64-row native result.",
    pack: "items",
    risk: "destructive",
    inputs: [],
    outputs: [{ id: "changes", type: "json", required: true }],
    stages: [{
      id: "controls",
      kind: "macro",
      dependency: {
        kind: "macro",
        id: macroFact.id,
        version: macroFact.version,
        fallback_reason: null,
      },
      inputs: [],
      outputs: ["changes"],
      risk: "destructive",
      checkpoint: "checkpoint_controls",
    }],
    bindings: [{
      from: { scope: "stage", id: "controls", port: "changes" },
      to: { scope: "recipe_output", id: null, port: "changes" },
    }],
    dependencies: [{
      kind: "macro",
      id: macroFact.id,
      version: macroFact.version,
      risk: macroFact.risk,
      fallback_reason: null,
      descriptor_hash: descriptorHash,
    }],
    required_capabilities: [],
    risk_grants: ["read", "write", "destructive"],
    checkpoints: [{
      id: "checkpoint_controls",
      after_stage: "controls",
      evidence_id: "evidence_controls",
      resume_identity: "resume.items.controls",
      summary: "Native Item controls stage completed with retained evidence.",
    }],
    preflight: {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 1,
      dependency_count: 1,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    },
    portability: {
      project_identity: "project:tab:batch-fixture",
      bridge_owner: "owner:batch-fixture",
      bridge_generation: "1",
      platform: "darwin",
    },
  };
}

function batchRecipeRuntimeFacts(revision) {
  return {
    content_hash: revision.content_hash,
    risk_grants: [...revision.draft.risk_grants],
    project_identity: revision.draft.portability.project_identity,
    bridge_owner: revision.draft.portability.bridge_owner,
    bridge_generation: revision.draft.portability.bridge_generation,
    available_capabilities: [...revision.draft.required_capabilities],
    checkpoint_evidence: revision.draft.checkpoints.map((checkpoint) => ({
      checkpoint_id: checkpoint.id,
      evidence_id: checkpoint.evidence_id,
      resume_identity: checkpoint.resume_identity,
      recipe_id: revision.recipe_id,
      version: revision.version,
      revision: revision.revision,
      content_hash: revision.content_hash,
    })),
    dependency_versions: revision.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      version: entry.version,
    })),
    dependency_descriptors: revision.dependency_lock.entries.map((entry) => ({
      kind: entry.kind,
      id: entry.id,
      descriptor_hash: entry.descriptor_hash,
    })),
  };
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

  it("keeps a 64-row native success as macro.execution.v1 by projecting duplicate control truth to evidence", async () => {
    const inputRows = fullControlRows(64);
    const native = makeNativeBatchExecutor();
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
      executeAtomic: native.executeAtomic,
      projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
    });

    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(validateMacroExecutionEnvelope(response).valid, true);
    assert.equal(response.result.changes.length, 64);
    assert.equal(response.result.changes.every((row) => row.status === "ok" && row.mutation === "done" && row.readback === "pass"), true);
    assert.equal(response.result.changes.every((row) => row.item === undefined && row.take === undefined), true);
    assert.equal(response.result.data.detail_projection, "verification_evidence");
    assert.equal(response.result.data.projected_row_count, 64);
    assert.equal(response.budget.artifact_fallback, true);
    assert.equal(native.calls.length, 1);
  });

  it("keeps complete Item/Take request truth inline when a small native batch fits the contract budget", async () => {
    for (const count of [1, 8]) {
      const inputRows = fullControlRows(count);
      const native = makeNativeBatchExecutor();
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
        executeAtomic: native.executeAtomic,
        projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
      });

      assert.equal(response.ok, true, `${count}: ${JSON.stringify(response)}`);
      assert.equal(validateMacroExecutionEnvelope(response).valid, true);
      assert.equal(response.result.changes.length, count);
      assert.equal(response.result.changes.every((row) => row.item !== undefined && row.take !== undefined), true);
      assert.equal(response.result.data.detail_projection, undefined);
      assert.equal(response.budget.artifact_fallback, undefined);
      assert.equal(native.calls.length, 1);
    }
  });

  it("projects a 64-row native partial failure without losing typed row or evidence truth", async () => {
    const inputRows = fullControlRows(64);
    const native = makeNativeBatchExecutor({ failAt: 37 });
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
      executeAtomic: native.executeAtomic,
      projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
    });

    assert.equal(response.contract, "macro.execution.v1");
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "ITEM_APPLY_NATIVE_READBACK_FAILED");
    assert.equal(response.blockers[0].code, "ITEM_APPLY_NATIVE_READBACK_FAILED");
    assert.equal(validateMacroExecutionEnvelope(response).valid, true);
    assert.equal(response.result.changes.length, 64);
    assert.equal(response.result.changes[36].status, "fail");
    assert.equal(response.result.changes[36].mutation, "done");
    assert.equal(response.result.changes[36].readback, "fail");
    assert.equal(response.result.changes.every((row) => row.item === undefined && row.take === undefined), true);
    assert.equal(response.result.verification.evidence_refs.length, 1);
    assert.equal(response.result.data.detail_projection, "verification_evidence");
    assert.equal(response.result.data.projected_row_count, 64);
    assert.equal(response.budget.artifact_fallback, true);
    assert.equal(native.calls.length, 1);
  });

  it("normalizes the projected 64-row Macro envelope through a generic call_recipe stage", async () => {
    const inputRows = fullControlRows(64);
    const native = makeNativeBatchExecutor();
    const macroResponse = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }),
      executeAtomic: native.executeAtomic,
      projectIndexRuntime: { invalidateScopes: () => ({ ok: true }) },
    });
    assert.equal(macroResponse.result.changes.length, 64);

    const macroFact = createAcceptedOfficialMacroDependencyFacts()
      .find((fact) => fact.id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID);
    assert.ok(macroFact);
    const catalog = createExecutableDependencyCatalog({
      macros: [{
        id: macroFact.id,
        version: macroFact.version,
        risk: macroFact.risk,
        descriptor_hash: "d".repeat(64),
        capabilities: macroFact.capabilities,
      }],
      templates: [],
      capabilities: [...macroFact.capabilities],
    });
    const root = mkdtempSync(path.join(os.tmpdir(), "openreaper-alpha4-d-batch-recipe-"));
    try {
      const store = createExecutableRecipeRevisionStore({ root, catalog, source: "user" });
      const runtime = createCallRecipeRuntime({
        store,
        catalog,
        dispatchers: { macro: async () => macroResponse },
        runtimeFactsProvider: ({ revision }) => batchRecipeRuntimeFacts(revision),
      });
      const saved = await runtime.call_recipe({
        operation: "save",
        draft: batchRecipeFixture(catalog, macroFact),
        version: "1.0.0",
        revision_number: 1,
        saved_at: "2026-07-29T00:00:00.000Z",
      });
      assert.equal(saved.ok, true, JSON.stringify(saved));
      const ran = await runtime.call_recipe({
        operation: "run",
        recipe_id: saved.recipe_id,
        version: saved.version,
        revision: saved.revision,
        content_hash: saved.content_hash,
        validation_result_id: saved.validation_result_id,
        inputs: {},
        budget: { max_response_bytes: 65_536 },
      });

      assert.equal(ran.ok, true, JSON.stringify(ran));
      assert.equal(ran.status, "succeeded");
      assert.equal(ran.error, undefined);
      assert.equal(ran.verified_outputs.length, 1);
      assert.equal(ran.verified_outputs[0].id, "changes");
      assert.deepEqual(ran.verified_outputs[0].value, {
        omitted: true,
        reason: "inline_value_exceeds_call_recipe_budget",
      });
      assert.equal(ran.execution_truth.native_mutation_count, 64);
      assert.equal(ran.execution_truth.readback_count, 64);
      assert.equal(ran.latest_checkpoint.proof.source_contract, "macro.execution.v1");
      assert.equal(ran.latest_checkpoint.proof.evidence_refs.length, 1);
      assert.equal(native.calls.length, 1);
    } finally {
      rmSync(root, { recursive: true, force: true });
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
    assert.equal(response.error.code, "ITEM_APPLY_BATCH_TAKE_LIMIT_EXCEEDED");
    // The current public envelope does not project zero_write for this
    // validation branch; the existing mock seam proves it by observing no
    // resolver, mutation, readback, or index call.
    assert.equal(executor.calls.length, 0);
  });

  it("accepts 128 Item-only rows but rejects row 129 before native dispatch", async () => {
    for (const count of [8, 32, 64, 128]) {
      const inputRows = itemOnlyRows(count);
      const native = makeNativeBatchExecutor();
      const response = await executeAlpha3_3B1cItemsApplyMacro({
        request: request({ mode: "set_item_take_controls", dry_run: false, changes: inputRows }, BUDGET),
        executeAtomic: native.executeAtomic,
      });
      assert.equal(response.ok, true, `${count}:${JSON.stringify(response.error)}`);
      assert.equal(native.calls.length, 1);
      assert.equal(native.calls[0].input.batch.length, count);
    }

    const calls = [];
    const blocked = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({ mode: "set_item_take_controls", dry_run: false, changes: itemOnlyRows(129) }, BUDGET),
      executeAtomic: Object.assign(async (child) => { calls.push(child); return execution(child.id, {}); }, { supportsItemTakeControlsBatch: true }),
    });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "ITEM_APPLY_BATCH_CHANGES_INVALID");
    assert.equal(calls.length, 0);
  });

  it("sequences 128 exact Items through one aggregate preflight and one native mutation batch", async () => {
    const refs = Array.from({ length: 128 }, (_, index) => itemRef(index + 1));
    const calls = [];
    const executeAtomic = async (child) => {
      calls.push(child);
      if (child.id === "template.analysis.analyze_items_batch") {
        return execution(child.id, {
          target_scope: "exact",
          target_count: refs.length,
          plan_facts: refs.map((item_ref, index) => ({
            item_ref,
            track_ref: "track:guid:{D-TRACK}",
            active_take_ref: takeRef(index + 1),
            position_seconds: index,
            length_seconds: 1,
            end_seconds: index + 1,
            snap_offset_seconds: 0,
            fade_in_seconds: 0,
            fade_out_seconds: 0,
          })),
        });
      }
      assert.equal(child.id, "template.items.set_item_take_controls_batch");
      return execution(child.id, {
        rows: child.input.batch.map((row) => ({
          ...row,
          status: "applied",
          mutation: { status: "completed" },
          live_readback: { status: "passed" },
          fields: { item: row.item },
        })),
      });
    };
    executeAtomic.supportsItemTakeControlsBatch = true;
    const response = await executeAlpha3_3B1cItemsApplyMacro({
      request: request({
        mode: "sequence_with_gap",
        target: "exact",
        target_refs: refs,
        gap_seconds: 1,
        dry_run: false,
      }, BUDGET),
      executeAtomic,
    });
    assert.equal(response.ok, true, JSON.stringify(response.error));
    assert.deepEqual(calls.map((call) => call.id), [
      "template.analysis.analyze_items_batch",
      "template.items.set_item_take_controls_batch",
    ]);
    assert.equal(calls[1].input.batch.length, 128);
    assert.equal(calls[1].input.batch[0].item.position_seconds, 0);
    assert.equal(calls[1].input.batch[127].item.position_seconds, 254);
    assert.equal(response.result.changes.length, 8);
    assert.deepEqual(
      response.result.changes.map((change) => change.item_ref),
      [...refs.slice(0, 4), ...refs.slice(-4)],
    );
    assert.equal(response.result.data.outcome.mutation.completed_count, 128);
    assert.equal(response.result.data.outcome.live_readback.passed_count, 128);
    assert.deepEqual(response.result.data.change_projection, {
      mode: "bounded_inline_samples",
      complete_count: 128,
      inline_sample_count: 8,
      inline_sample_limit: 8,
      complete_target_refs_in_canonical_refs: true,
      native_evidence_refs: [
        "template.analysis.analyze_items_batch",
        "template.items.set_item_take_controls_batch",
      ],
    });
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

  it("keeps retired official Item Recipe drafts out of the active two-Recipe catalog", () => {
    const drafts = createAlpha345OfficialExecutableRecipeRevisions({ catalog: recipeContractCatalog() });
    const itemDrafts = drafts
      .map((revision) => revision.draft)
      .filter((draft) => draft.stages.some((stage) => stage.dependency.id === ALPHA3_3_B1C_ITEMS_APPLY_MACRO_ID));
    assert.equal(drafts.length, 2);
    assert.equal(itemDrafts.length, 0);
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
