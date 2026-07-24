import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";
import {
  ALPHA4_SHARD_C_BATCH_BENCHMARK_CONTRACT,
  ALPHA4_SHARD_C_BATCH_CANDIDATE_CEILING,
  ALPHA4_SHARD_C_BATCH_CHUNK_SIZE,
  ALPHA4_SHARD_C_BATCH_CONTRACT,
  dispatchFakeBatch,
  createFakeNativeExecutor,
  runBatchBenchmark,
} from "./fake-batch-dispatcher.mjs";

const capacity = JSON.parse(readFileSync(new URL("../fixtures/batch/capacity-fixtures.json", import.meta.url), "utf8"));
const failures = JSON.parse(readFileSync(new URL("../fixtures/batch/failure-fixtures.json", import.meta.url), "utf8"));
const benchmarkFixture = JSON.parse(readFileSync(new URL("../fixtures/batch/benchmark-evidence.json", import.meta.url), "utf8"));

function fixtureTargets(count) {
  return Array.from({ length: count }, (_, index) => `item:guid:{FIXTURE-${String(index + 1).padStart(4, "0")}}`);
}

describe("Alpha4 Shard C fake batch dispatcher", () => {
  it("keeps the harness isolated from shared runtime and live REAPER", async () => {
    const source = await readFile(new URL("./fake-batch-dispatcher.mjs", import.meta.url), "utf8");
    assert.doesNotMatch(source, /packages\//u);
    assert.doesNotMatch(source, /reaper\//u);
    assert.equal(benchmarkFixture.contract, ALPHA4_SHARD_C_BATCH_BENCHMARK_CONTRACT);
    assert.equal(benchmarkFixture.live_reaper, false);
    assert.equal(benchmarkFixture.shared_runtime_dispatcher, false);
  });

  it("records one public request and stage/chunk Bridge calls for the accepted matrix", () => {
    assert.equal(capacity.chunk_size, ALPHA4_SHARD_C_BATCH_CHUNK_SIZE);
    assert.equal(capacity.candidate_ceiling, ALPHA4_SHARD_C_BATCH_CANDIDATE_CEILING);
    const evidence = runBatchBenchmark();
    assert.deepEqual(evidence, benchmarkFixture);
    assert.equal(evidence.timing_semantics, "deterministic_fake_harness_units_not_live_wall_clock");

    for (const row of evidence.results.slice(0, -1)) {
      assert.equal(row.public_calls, 1, `N=${row.target_count}`);
      assert.equal(row.native_calls, row.target_count, `N=${row.target_count}`);
      assert.equal(row.writes, row.target_count, `N=${row.target_count}`);
      assert.equal(row.undo_scopes, 1, `N=${row.target_count}`);
      assert.equal(row.bridge_calls, 2 + row.chunk_count, `N=${row.target_count}`);
      assert.equal(row.bridge_stages[0], "preflight");
      assert.equal(row.bridge_stages.at(-1), "readback");
      assert.equal(row.selection_snapshot_reads, 1, `N=${row.target_count}`);
    }

    const ceiling = evidence.results.at(-1);
    assert.equal(ceiling.target_count, 513);
    assert.equal(ceiling.error_code, capacity.typed_blocker.code);
    assert.equal(ceiling.writes, capacity.typed_blocker.writes);
    assert.equal(ceiling.undo_scopes, capacity.typed_blocker.undo_scopes);
    assert.equal(ceiling.native_calls, 0);
    assert.equal(ceiling.status, "blocked");
  });

  it("keeps calls bounded by stages/chunks instead of target count", () => {
    const evidence = runBatchBenchmark();
    const rows = evidence.results.slice(0, -1);
    assert.equal(evidence.public_target_mode, "current_selection_without_agent_guid_inventory");
    assert.ok(rows.every((row) => row.bridge_calls <= 2 + Math.ceil(row.target_count / 128)));
    assert.equal(rows.find((row) => row.target_count === 400).bridge_calls, 6);
    assert.equal(rows.find((row) => row.target_count === 512).bridge_calls, 6);
    assert.equal(rows.find((row) => row.target_count === 512).native_calls, 512);
  });

  it("runs every declared failure fixture with explicit write, Undo, and recovery truth", () => {
    assert.equal(failures.contract, "alpha4.shard-c.batch.failure-fixtures.v1");
    for (const scenario of failures.scenarios) {
      const executor = createFakeNativeExecutor(scenario.executor);
      const response = dispatchFakeBatch({
        macro_id: "macro.items.apply",
        template_id: "template.items.set_item_volume",
        ...scenario.request,
        ...(scenario.request.target_refs === undefined ? { target_refs: fixtureTargets(1) } : {}),
      }, { nativeExecutor: executor });
      const expected = scenario.expected;
      assert.equal(response.status, expected.status, scenario.id);
      assert.equal(response.error?.code, expected.code, scenario.id);
      assert.equal(response.error?.stage, expected.stage, scenario.id);
      assert.equal(executor.evidence.writes.length, expected.writes, scenario.id);
      assert.equal(executor.evidence.undo_scopes.length, expected.undo_scopes, scenario.id);
      assert.equal(response.recovery?.posture, expected.recovery_posture, scenario.id);
      assert.equal(executor.evidence.native_calls.filter((call) => call.status === "completed").length, expected.writes, scenario.id);
      if (expected.writes === 0) {
        assert.equal(executor.evidence.native_calls.length, 0, scenario.id);
        assert.equal(executor.evidence.undo_scopes.length, 0, scenario.id);
      }
    }
  });

  it("proves the fixed ceiling blocker fails after preflight accounting but before mutation", () => {
    const executor = createFakeNativeExecutor();
    const response = dispatchFakeBatch({
      request_id: "capacity-513",
      target_refs: fixtureTargets(513),
    }, { nativeExecutor: executor });
    assert.equal(response.error.code, "BATCH_CANDIDATE_CEILING_EXCEEDED");
    assert.equal(response.error.stage, "preflight");
    assert.deepEqual(executor.evidence.bridge_calls.map((call) => call.stage), ["preflight"]);
    assert.equal(executor.evidence.writes.length, 0);
    assert.equal(executor.evidence.native_calls.length, 0);
    assert.equal(executor.evidence.undo_scopes.length, 0);
    assert.ok(executor.evidence.timings_ms.validation > 0);
    assert.ok(executor.evidence.timings_ms.preflight > 0);
    assert.equal(executor.evidence.timings_ms.mutation, 0);
  });

  it("preserves the one-Undo posture through native failure and readback failure", () => {
    const nativeFailureExecutor = createFakeNativeExecutor({ native_failure_at: 2 });
    const nativeFailure = dispatchFakeBatch({ target_refs: fixtureTargets(4) }, { nativeExecutor: nativeFailureExecutor });
    assert.equal(nativeFailure.status, "partial_failure");
    assert.equal(nativeFailureExecutor.evidence.undo_scopes.length, 1);
    assert.equal(nativeFailureExecutor.evidence.undo_scopes[0].status, "partial_failure");
    assert.equal(nativeFailureExecutor.evidence.undo_scopes[0].recovery, "single_undo_can_revert_partial_writes");

    const readbackExecutor = createFakeNativeExecutor({ readback_failure: true });
    const readbackFailure = dispatchFakeBatch({ target_refs: fixtureTargets(2) }, { nativeExecutor: readbackExecutor });
    assert.equal(readbackFailure.status, "failed");
    assert.equal(readbackExecutor.evidence.undo_scopes.length, 1);
    assert.equal(readbackExecutor.evidence.undo_scopes[0].status, "verification_failed");
    assert.equal(readbackFailure.recovery.undo_scope, "single_undo_can_revert_verified_failure");
  });
});
