import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT,
  createAlpha3C3LargeProjectBenchmarkFixture,
  runAlpha3C3ProjectIndexBenchmark,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-benchmark-v1.mjs";
import {
  createAlpha3C3OfficialQueryMacroDiscoveryItems,
  createAlpha3_2DGenericProjectQueryDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";
import {
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

describe("Alpha3 C3 Project SQLite Index Block 4 benchmark", () => {
  it("builds a 200-track complex resident project index fixture", () => {
    const fixture = createAlpha3C3LargeProjectBenchmarkFixture();

    assert.equal(fixture.contract, ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT);
    assert.equal(fixture.shape.track_count, 200);
    assert.equal(fixture.row_counts.tracks, 200);
    assert.equal(fixture.row_counts.items, 1600);
    assert.equal(fixture.row_counts.takes, 1600);
    assert.equal(fixture.row_counts.fx, 600);
    assert.equal(fixture.row_counts.sends, 400);
    assert.equal(fixture.row_counts.envelopes, 400);
    assert.equal(fixture.row_counts.markers_regions, 48);
    assert.equal(fixture.row_counts.media_sources, 120);
    assert.equal(fixture.row_counts.selection_state > 0, true);
    assert.equal(fixture.row_counts.object_changes, 200);
  });

  it("runs compact query/hydrate flow under static Block 4 gates", () => {
    const benchmark = runAlpha3C3ProjectIndexBenchmark();

    assert.equal(benchmark.contract, ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT);
    assert.equal(benchmark.mode, "static_large_project_query_flow_benchmark");
    assert.equal(benchmark.hard_gate.accepted, true);
    assert.deepEqual(benchmark.hard_gate.failures, []);
    assert.equal(benchmark.project_shape.track_count, 200);
    assert.equal(benchmark.operations.length, 12);
    assert.equal(benchmark.operations.every((operation) => operation.ok), true);
    assert.equal(benchmark.operations.some((operation) => operation.id === "macro.query_automation"), true);
    assert.equal(benchmark.operations.some((operation) => operation.id === "macro.hydrate_refs"), true);
    assert.equal(
      benchmark.operations.every((operation) => operation.response_bytes <= benchmark.hard_gate.thresholds.max_operation_response_bytes),
      true,
    );
    assert.equal(benchmark.round_trip_model.meets_3x_target, true);
    assert.equal(benchmark.round_trip_model.reduction_factor > 100, true);
    assert.equal(benchmark.customer_flow.status, "static_ready_no_live_claim");
    assert.equal(benchmark.trial_officer.verdict, "accept_block4_static_flow");
    assert.deepEqual(benchmark.trial_officer.p0_p1_findings, []);
    assert.equal(benchmark.execution.live_reaper, false);
    assert.equal(benchmark.execution.safe_write, false);
    assert.equal(benchmark.execution.hidden_executor, false);
    assert.equal(benchmark.execution.public_call_recipe, false);
    assert.equal(benchmark.execution.raw_sql_user_input, false);
    assert.equal(benchmark.discovery.tool_surface_added_tools, 0);
  });

  it("keeps the static benchmark non-live while publishing executable query Macro capability truth", () => {
    const discoveryEntries = createAlpha3C3OfficialQueryMacroDiscoveryItems();
    assert.equal(discoveryEntries.every((entry) => entry.live_runnable_now === false), true);
    assert.equal(
      discoveryEntries.every((entry) => entry.support_status === "plan_only_runtime_bound"),
      true,
    );

    const genericEntries = createAlpha3_2DGenericProjectQueryDiscoveryItems();
    assert.equal(genericEntries.length, 1);
    assert.equal(genericEntries[0].id, "macro.project.query");
    assert.equal(genericEntries[0].live_runnable_now, false);
    assert.equal(genericEntries[0].support_status, "executable_runtime_bound");
    assert.equal(genericEntries[0].execution_shape, "registered_macro_program");

    const runtime = createCallTemplateRuntime();
    const menu = runtime.list_templates({
      ids: ["macro.project.query", "macro.query_tracks"],
      fields: ["summary", "capability_truth"],
    });

    assert.deepEqual(menu.items.map((item) => item.id), ["macro.project.query"]);
    assert.equal(menu.items[0].current_status, "needs_live");
    assert.equal(menu.items[0].capability_truth.live_runnable_now, false);
    assert.equal(menu.items[0].capability_truth.support_state, "supported");
    assert.equal(menu.items[0].capability_truth.known_blocker, "live_executor_not_configured");
    assert.match(menu.items[0].user_message, /needs the configured OpenReaper live route/);
    assert.match(menu.items[0].next_step, /Start or reconnect the managed OpenReaper bridge/);
    assert.equal(menu.items[0].safety_note.includes("Macro planner only"), false);
  });
});
