import assert from "node:assert/strict";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY,
  projectAlpha3_2_5BProjectQueryDoctorTask,
} from "../../packages/mcp-server/src/alpha3-2-5-b-project-understanding-v1.mjs";
import {
  openAlpha3_2DProjectIndexRuntime,
} from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  createAlpha3_2DGenericProjectQueryDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";
import {
  createAlpha3_2EProjectInspectMacroDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-2e-small-macro-spine-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  validateMacroExecutionEnvelope,
} from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const OWNER = "openreaper-alpha325-b";
const GENERATION = 1;
const NOW = "2026-07-12T06:00:00.000Z";

describe("Alpha3.2.5-B executable project understanding", () => {
  it("registers inspect/query as fixed executable Macro programs and publishes executable discovery", () => {
    assert.deepEqual(ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.ids, [
      "macro.project.inspect",
      "macro.project.query",
    ]);
    for (const entry of ALPHA3_2_5_B_PROJECT_UNDERSTANDING_REGISTRY.entries) {
      assert.equal(entry.implementation_status, "executable");
      assert.equal(entry.sqlite_policy.mode, "hydrate_or_reuse");
      assert.equal(entry.sqlite_policy.write_authority, false);
      assert.equal(entry.dependencies.runtime_capabilities.includes("project_index.runtime.v1"), true);
    }

    const inspect = createAlpha3_2EProjectInspectMacroDiscoveryItems({ liveRunnableNow: true })[0];
    const query = createAlpha3_2DGenericProjectQueryDiscoveryItems({ liveRunnableNow: true })[0];
    for (const item of [inspect, query]) {
      assert.equal(item.execution_shape, "registered_macro_program");
      assert.equal(item.support_status, "executable_runtime_bound");
      assert.equal(item.live_runnable_now, true);
      assert.equal(item.tags.includes("plan_only"), false);
    }

    const fake = new FakeFoundationBridge({ owner: OWNER, generation: GENERATION });
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: fake,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const executable = runtime.list_templates({
      ids: ["macro.project.inspect", "macro.project.query"],
      fields: ["id", "summary"],
    });
    for (const item of executable.items) {
      assert.equal(item.current_status, "needs_live");
      assert.equal(item.beginner_label, "Start or reconnect OpenReaper");
      assert.match(item.user_message, /needs the configured OpenReaper live route/);
      assert.match(item.next_step, /Start or reconnect the managed OpenReaper bridge/);
      assert.match(item.safety_note, /Registered bounded Macro program/);
      assert.equal(item.next_step.includes("child call_template requests"), false);
      assert.equal(item.safety_note.includes("Macro planner only"), false);
    }
  });

  it("hydrates inspect once, reuses the warm index, and returns compact project understanding", async () => {
    const fixture = await makeFixture();
    const state = { revision: 3, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = {
        include: [
          "project_identity",
          "project_path",
          "dirty_state",
          "tracks",
          "items",
          "markers_regions",
          "render",
          "index_status",
        ],
        limit: 25,
      };

      const cold = await runtime.call_template({
        id: "macro.project.inspect",
        input,
        context: callContext(1),
      });
      assert.equal(cold.ok, true, JSON.stringify(cold));
      assert.deepEqual(validateMacroExecutionEnvelope(cold), { valid: true, errors: [] });
      assert.equal(cold.sqlite.source, "cold_hydration");
      assert.equal(cold.sqlite.revision, "reaper-change-count:3");
      assert.equal(cold.result.data.project.path, fixture.projectPath);
      assert.equal(cold.result.data.dirty_state.dirty, false);
      assert.equal(cold.result.data.render.sample_rate, 48_000);
      assert.equal(cold.result.data.scopes.tracks.rows[0].name, "Kick");
      assert.equal(cold.result.data.scopes.items.rows[0].ref, "item:guid:{ITEM-1}");
      assert.equal(cold.result.data.scopes.markers_regions.rows[0].ref, "region:index:1");
      assert.deepEqual(state.calls, [
        "project.read_summary",
        "project.create_observation_bundle",
        "project.read_summary",
        "project.create_observation_bundle",
        "project.read_dirty_state",
        "render.settings.read",
      ]);

      const warm = await runtime.call_template({
        id: "macro.project.inspect",
        input,
        context: callContext(2),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));
      assert.equal(warm.sqlite.source, "warm_index");
      assert.equal(warm.result.data.refresh.call_count, 0);
      assert.deepEqual(state.calls.slice(6), [
        "project.read_summary",
        "project.read_dirty_state",
        "render.settings.read",
      ]);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("projects mixed inspect scopes with isolated fields and rejects a single-scope typo before live reads", async () => {
    const fixture = await makeFixture();
    const state = { revision: 3, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const mixed = await runtime.call_template({
        id: "macro.project.inspect",
        input: {
          include: ["tracks", "items", "markers_regions"],
          fields_by_scope: {
            tracks: ["ref", "name", "index"],
            items: ["ref", "track_ref", "start_seconds"],
            markers_regions: ["ref", "name", "position_seconds"],
          },
          limit: 25,
        },
        context: callContext(1),
      });

      assert.equal(mixed.ok, true, JSON.stringify(mixed));
      assert.deepEqual(Object.keys(mixed.result.data.scopes.tracks.rows[0]), ["ref", "name", "index"]);
      assert.deepEqual(Object.keys(mixed.result.data.scopes.items.rows[0]), ["ref", "track_ref", "start_seconds"]);
      assert.deepEqual(Object.keys(mixed.result.data.scopes.markers_regions.rows[0]), ["ref", "name", "position_seconds"]);

      state.calls.length = 0;
      const typo = await runtime.call_template({
        id: "macro.project.inspect",
        input: { include: ["tracks"], fields: ["naem"] },
        context: callContext(2),
      });
      assert.equal(typo.ok, false, JSON.stringify(typo));
      assert.equal(typo.error.code, "QUERY_FIELD_NOT_SUPPORTED");
      assert.equal(typo.blockers.some((entry) => entry.code === "QUERY_FIELD_NOT_SUPPORTED"), true);
      assert.deepEqual(state.calls, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("keeps a fourteen-track Project Index complete behind the default 2 KiB public budget and public pagination", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 14 }, (_, index) => `Highway ${String(index + 1).padStart(2, "0")}`);
    trackNames[13] = "对白 主轨 中文";
    const state = { revision: 14, trackName: trackNames[0], trackNames, calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const publicBudget = {
        max_response_bytes: 65_536,
        max_items: 50,
        max_inline_value_bytes: 2_048,
      };

      const firstPage = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", fields: ["name", "index"], refresh_policy: "if_stale", limit: 1 },
        budget: { ...publicBudget, max_response_bytes: 2_048 },
        context: callContext(1),
      });

      assert.equal(firstPage.ok, true, JSON.stringify(firstPage));
      assert.equal(firstPage.budget.actual_bytes <= 2_048, true);
      assert.equal(firstPage.result.data.rows.length, 1);
      assert.equal(firstPage.result.data.page.has_more, true);
      assert.equal(firstPage.result.data.coverage.known_total_row_count, 14);
      assert.equal(firstPage.result.data.coverage.indexed_row_count, 14);
      assert.equal(firstPage.result.data.coverage.public_returned_row_count, 1);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 14);

      const observationRequest = state.atomicRequests.find((entry) => entry.operation.name === "project.create_observation_bundle");
      assert.equal(observationRequest.budget.max_inline_value_bytes, 24_576);
      assert.equal(observationRequest.params.max_tracks, 32);
      assert.equal(firstPage.result.data.refresh.revision_probe_count, 1);
      assert.equal(firstPage.result.data.refresh.logical_refresh.coverage.tracks, "complete");

      const exactLast = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          fields: ["name", "index"],
          filters: { name_contains: trackNames.at(-1) },
          refresh_policy: "never",
          limit: 1,
        },
        budget: { max_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 },
        context: callContext(2),
      });

      assert.equal(exactLast.ok, true, JSON.stringify(exactLast));
      assert.equal(exactLast.budget.max_bytes, 2_048);
      assert.equal(exactLast.budget.actual_bytes <= 2_048, true);
      assert.equal(exactLast.result.data.projection, "minimum_query_truth");
      assert.equal(exactLast.result.data.rows[0].name, trackNames.at(-1));
      assert.equal(exactLast.result.data.rows[0].index, 13);
      assert.equal(exactLast.result.data.coverage.indexed_row_count, 14);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 14);

      const equalBudgetAliases = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          filters: { name_contains: trackNames.at(-1) },
          refresh_policy: "never",
          limit: 1,
        },
        budget: { max_response_bytes: 2_048, max_bytes: 2_048, max_items: 50 },
        context: callContext(3),
      });
      assert.equal(equalBudgetAliases.ok, true, JSON.stringify(equalBudgetAliases));
      assert.equal(equalBudgetAliases.budget.max_bytes, 2_048);
      assert.equal(equalBudgetAliases.budget.actual_bytes <= 2_048, true);

      indexRuntime.close();
      indexRuntime = await openIndex(fixture);
      assert.equal(indexRuntime.backend, "sqlite_file_adapter");
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 14);
      const reopened = createRuntime({ fixture, indexRuntime, state });
      const reopenedExactLast = await reopened.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          fields: ["name", "index"],
          filters: { name: trackNames.at(-1) },
          refresh_policy: "never",
          limit: 1,
        },
        budget: publicBudget,
        context: callContext(4),
      });
      assert.equal(reopenedExactLast.ok, true, JSON.stringify(reopenedExactLast));
      assert.equal(reopenedExactLast.result.data.rows[0].name, trackNames.at(-1));
      assert.equal(reopenedExactLast.result.data.coverage.indexed_row_count, 14);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("keeps 254 Items and 61 Sends complete behind 2 KiB public pages while hidden refresh budgets retain full knowledge", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 104 }, (_, index) => `Large Project Track ${String(index + 1).padStart(3, "0")}`);
    const projectItems = Array.from({ length: 254 }, (_, index) => ({
      item_ref: `item:guid:{LARGE-ITEM-${String(index + 1).padStart(3, "0")}}`,
      track_ref: `track:guid:{TRACK-${(index % trackNames.length) + 1}}`,
      position_seconds: index * 0.5,
      length_seconds: 0.25,
    }));
    const routingEdges = Array.from({ length: 61 }, (_, index) => ({
      send_ref: `send:guid:{LARGE-SEND-${String(index + 1).padStart(3, "0")}}`,
      source_track_ref: `track:guid:{TRACK-${index + 1}}`,
      destination_track_ref: "track:guid:{TRACK-104}",
      send_index: 0,
      send_kind: "track_send",
      volume: 1,
      pan: 0,
      muted: false,
    }));
    const state = {
      revision: 25461,
      trackName: trackNames[0],
      trackNames,
      projectItems,
      routingEdges,
      calls: [],
      atomicRequests: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const publicBudget = { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 };

      const collectPages = async (entity, fields, firstContextSequence) => {
        const rows = [];
        let cursor = null;
        let sequence = firstContextSequence;
        let first = true;
        do {
          const page = await runtime.call_template({
            id: "macro.project.query",
            input: {
              entity,
              fields,
              refresh_policy: first ? "if_stale" : "never",
              limit: 100,
              ...(cursor === null ? {} : { cursor }),
            },
            budget: publicBudget,
            context: callContext(sequence, `large-${entity}-client`),
          });
          assert.equal(page.ok, true, JSON.stringify(page));
          assert.equal(page.budget.actual_bytes <= 2_048, true);
          assert.equal(page.result.data.rows.length > 0, true);
          rows.push(...page.result.data.rows);
          cursor = page.result.data.page.has_more ? page.result.data.page.next_cursor : null;
          first = false;
          sequence += 1;
        } while (cursor !== null);
        return rows;
      };

      const itemRows = await collectPages("items", ["ref"], 1);
      assert.equal(itemRows.length, 254);
      assert.equal(new Set(itemRows.map((row) => row.ref)).size, 254);
      assert.equal(indexRuntime.adapter.snapshot().rows.items.length, 254);
      const itemRefreshRequests = state.atomicRequests.filter((entry) => entry.operation.name === "project.read_track_item_overview");
      assert.equal(itemRefreshRequests.length, 4);
      assert.equal(itemRefreshRequests.every((entry) => entry.params.max_items === 64), true);
      assert.equal(itemRefreshRequests.every((entry) => entry.budget.max_items === 128), true);
      assert.equal(itemRefreshRequests.every((entry) => entry.budget.max_inline_value_bytes === 24_576), true);

      const lastItem = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "items", selectors: { refs: [projectItems.at(-1).item_ref] }, fields: ["ref"], refresh_policy: "never", limit: 1 },
        budget: publicBudget,
        context: callContext(100, "large-item-exact-client"),
      });
      assert.equal(lastItem.ok, true, JSON.stringify(lastItem));
      assert.equal(lastItem.result.data.rows[0].ref, projectItems.at(-1).item_ref);

      const routingRows = await collectPages("routing", ["ref"], 200);
      assert.equal(routingRows.length, 61);
      assert.equal(new Set(routingRows.map((row) => row.ref)).size, 61);
      assert.equal(indexRuntime.adapter.snapshot().rows.sends.length, 61);
      const routingRefreshRequests = state.atomicRequests.filter((entry) => entry.operation.name === "routing.project_graph.read");
      assert.equal(routingRefreshRequests.length, 2);
      assert.equal(routingRefreshRequests.every((entry) => entry.params.max_edges === 32), true);
      assert.equal(routingRefreshRequests.every((entry) => entry.params.include_tracks === false), true);
      assert.equal(routingRefreshRequests.every((entry) => entry.budget.max_items === 128), true);

      const lastSend = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "routing", selectors: { refs: [routingEdges.at(-1).send_ref] }, fields: ["ref"], refresh_policy: "never", limit: 1 },
        budget: publicBudget,
        context: callContext(500, "large-routing-exact-client"),
      });
      assert.equal(lastSend.ok, true, JSON.stringify(lastSend));
      assert.equal(lastSend.result.data.rows[0].ref, routingEdges.at(-1).send_ref);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("fails closed on incomplete Item or Routing enumeration instead of returning definitive not-found", async () => {
    for (const testCase of [
      {
        entity: "items",
        state: {
          projectItems: [{ item_ref: "item:guid:{INCOMPLETE}", track_ref: "track:guid:{TRACK-1}", position_seconds: 0, length_seconds: 1 }],
          itemCoverageInternallyComplete: false,
        },
        expectedCode: "LOGICAL_REFRESH_COVERAGE_INCOMPLETE",
      },
      {
        entity: "routing",
        state: {
          routingEdges: [{ send_ref: "send:guid:{INCOMPLETE}", source_track_ref: "track:guid:{TRACK-1}", destination_track_ref: "track:guid:{TRACK-2}" }],
          routingTrackTruncated: true,
        },
        expectedCode: "LOGICAL_REFRESH_COVERAGE_INCOMPLETE",
      },
    ]) {
      const fixture = await makeFixture();
      let indexRuntime;
      try {
        const state = { revision: 7, trackName: "Incomplete", trackNames: ["Incomplete", "Target"], calls: [], atomicRequests: [], ...testCase.state };
        indexRuntime = await openIndex(fixture);
        const runtime = createRuntime({ fixture, indexRuntime, state });
        const result = await runtime.call_template({
          id: "macro.project.query",
          input: { entity: testCase.entity, refresh_policy: "if_stale", limit: 1 },
          context: callContext(1, `incomplete-${testCase.entity}`),
        });
        assert.equal(result.ok, false, JSON.stringify(result));
        assert.equal(result.error.code, testCase.expectedCode);
        assert.notEqual(result.error.code, testCase.entity === "items" ? "ITEM_NOT_FOUND" : "ROUTING_NOT_FOUND");
        const indexedRows = testCase.entity === "items"
          ? indexRuntime.adapter.snapshot().rows.items
          : indexRuntime.adapter.snapshot().rows.sends;
        assert.equal(indexedRows.length, 0);
      } finally {
        indexRuntime?.close();
        await fixture.cleanup();
      }
    }
  });

  it("repairs a false-fresh zero Take index from live media counts before returning rows", async () => {
    const fixture = await makeFixture();
    const projectTakes = Array.from({ length: 8 }, (_, index) => ({
      take_ref: `take:guid:{LIVE-TAKE-${index + 1}}`,
      item_ref: `item:guid:{LIVE-ITEM-${index + 1}}`,
      track_ref: "track:guid:{TRACK-1}",
      active: true,
      name: `Live Take ${index + 1}`,
      source_kind: "midi",
    }));
    const state = { revision: 81, trackName: "Dialogue", projectTakes, calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const warm = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 1 },
        context: callContext(1, "take-repair-warm"),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));
      replaceTakeIndex(indexRuntime, []);

      const repaired = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "takes", filters: { source_kind: "midi" }, refresh_policy: "if_stale", limit: 25 },
        context: callContext(2, "take-repair-query"),
      });
      assert.equal(repaired.ok, true, JSON.stringify(repaired));
      assert.equal(repaired.result.data.rows.length, 8);
      assert.equal(repaired.result.data.coverage.indexed_row_count, 8);
      assert.equal(repaired.result.data.refresh.logical_refresh.coverage.takes, "complete");
      assert.equal(indexRuntime.adapter.snapshot().rows.takes.length, 8);
      const takeReads = state.atomicRequests.filter((entry) => entry.operation.name === "project.read_track_item_overview" && entry.params.include_takes === true);
      assert.equal(takeReads.length, 1);
      assert.equal(takeReads[0].params.max_takes, 64);
      assert.equal(state.atomicRequests.some((entry) => entry.operation.name === "project.read_summary" && entry.params.include_media_counts === true), true);

      const legitimateZero = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "takes", filters: { source_kind: "audio-that-does-not-exist" }, refresh_policy: "if_stale", limit: 25 },
        context: callContext(3, "take-filter-zero"),
      });
      assert.equal(legitimateZero.ok, true, JSON.stringify(legitimateZero));
      assert.equal(legitimateZero.result.data.rows.length, 0);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("fails typed on a persistent live/index contradiction and accepts a genuinely empty project", async () => {
    for (const testCase of [
      { liveTakeCount: 8, expectedOk: false },
      { liveTakeCount: 0, expectedOk: true },
    ]) {
      const fixture = await makeFixture();
      const state = { revision: 82, trackName: "Empty", projectTakes: [], liveTakeCount: testCase.liveTakeCount, calls: [], atomicRequests: [] };
      let indexRuntime;
      try {
        indexRuntime = await openIndex(fixture);
        const runtime = createRuntime({ fixture, indexRuntime, state });
        const warm = await runtime.call_template({
          id: "macro.project.query",
          input: { entity: "tracks", refresh_policy: "if_stale", limit: 1 },
          context: callContext(10 + testCase.liveTakeCount, "take-contradiction-warm"),
        });
        assert.equal(warm.ok, true, JSON.stringify(warm));
        replaceTakeIndex(indexRuntime, []);
        const result = await runtime.call_template({
          id: "macro.project.query",
          input: { entity: "takes", refresh_policy: "if_stale", limit: 25 },
          context: callContext(20 + testCase.liveTakeCount, "take-contradiction-query"),
        });
        assert.equal(result.ok, testCase.expectedOk, JSON.stringify(result));
        if (testCase.expectedOk) {
          assert.equal(result.result.data.rows.length, 0);
          assert.equal(state.atomicRequests.filter((entry) => entry.operation.name === "project.read_track_item_overview" && entry.params.include_takes === true).length, 0);
        } else {
          assert.equal(result.error.code, "INDEX_LIVE_CONTRADICTION");
          assert.equal(result.result.data.truth_classification, "stale_index_contradiction");
          assert.equal(result.result.data.index_live_contradiction.truth_classification, "stale_index_contradiction");
          assert.equal(result.blockers[0].details.truth_classification, "stale_index_contradiction");
          assert.equal(result.result.data.index_live_contradiction.live_count, 8);
          assert.equal(result.result.data.index_live_contradiction.indexed_count, 0);
          assert.equal(result.blockers[0].details.request_patch.input.refresh_policy, "force_read_only_refresh");
          assert.equal(result.recovery.request_patch.input.refresh_policy, "force_read_only_refresh");
          assert.equal(result.result.data.zero_write, true);
        }
      } finally {
        indexRuntime?.close();
        await fixture.cleanup();
      }
    }
  });

  it("refreshes a contradictory Track count once, then escalates a persistent forced retry to reconnect", async () => {
    const fixture = await makeFixture();
    const state = {
      revision: 83,
      trackName: "对白 主轨",
      trackNames: ["对白 主轨"],
      calls: [],
      atomicRequests: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const warm = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(1, "track-contradiction-warm"),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));

      state.liveTrackCount = 4;
      const bundleCountBefore = state.atomicRequests.filter((entry) => entry.operation.name === "project.create_observation_bundle").length;
      const first = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(2, "track-contradiction-first"),
      });

      assert.equal(first.ok, false, JSON.stringify(first));
      assert.equal(first.error.code, "INDEX_LIVE_CONTRADICTION");
      assert.equal(first.result.data.truth_classification, "stale_index_contradiction");
      assert.equal(first.result.data.index_live_contradiction.live_count_field, "track_count");
      assert.equal(first.result.data.index_live_contradiction.live_count, 4);
      assert.equal(first.result.data.index_live_contradiction.indexed_count, 1);
      assert.equal(first.recovery.retry_limit, 1);
      assert.equal(first.recovery.reconnect_required, false);
      assert.equal(first.recovery.request_patch.input.refresh_policy, "force_read_only_refresh");
      assert.equal(
        state.atomicRequests.filter((entry) => entry.operation.name === "project.create_observation_bundle").length - bundleCountBefore,
        1,
      );

      const forcedBundleCountBefore = state.atomicRequests.filter((entry) => entry.operation.name === "project.create_observation_bundle").length;
      const forced = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(3, "track-contradiction-forced"),
      });

      assert.equal(forced.ok, false, JSON.stringify(forced));
      assert.equal(forced.error.code, "INDEX_LIVE_CONTRADICTION");
      assert.equal(forced.recovery.retry_limit, 0);
      assert.equal(forced.recovery.reconnect_required, true);
      assert.equal(forced.recovery.request_patch, null);
      assert.equal(forced.recovery.restart_reaper_only_after_reconnect_failure, true);
      assert.equal(
        state.atomicRequests.filter((entry) => entry.operation.name === "project.create_observation_bundle").length - forcedBundleCountBefore,
        1,
      );
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("blocks conflicting query budgets and unsupported filters before any live read", async () => {
    const fixture = await makeFixture();
    const state = { revision: 14, trackName: "Highway 01", calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const conflict = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 1 },
        budget: { max_response_bytes: 4_096, max_bytes: 2_048 },
        context: callContext(1),
      });
      assert.equal(conflict.ok, false, JSON.stringify(conflict));
      assert.equal(conflict.error.code, "PROJECT_QUERY_BUDGET_CONFLICT");
      assert.equal(conflict.budget.max_bytes, 2_048);
      assert.equal(conflict.budget.actual_bytes <= 2_048, true);
      assert.deepEqual(conflict.blockers[0].details, {
        max_response_bytes: 4_096,
        max_bytes: 2_048,
      });
      assert.deepEqual(state.calls, []);

      const unsupported = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          filters: { name_exact: "Highway 14" },
          refresh_policy: "if_stale",
          limit: 1,
        },
        context: callContext(2),
      });
      assert.equal(unsupported.ok, false, JSON.stringify(unsupported));
      assert.equal(unsupported.error.code, "GENERIC_QUERY_FILTER_UNSUPPORTED");
      assert.deepEqual(unsupported.result.data.rows, []);
      assert.deepEqual(state.calls, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("shrinks an oversized 2 KiB page without losing rows or its stable cursor, then resolves the final exact name", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 304 }, (_, index) =>
      index === 303 ? "PRODUCTION-DEEP-EXACT-304" : `Production Track ${String(index + 1).padStart(3, "0")}`);
    const state = { revision: 304, trackName: trackNames[0], trackNames, calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const normalBudget = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };
      const minimumBudget = { ...normalBudget, max_response_bytes: 2_048 };

      const hydrated = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", fields: ["ref", "name", "index"], refresh_policy: "if_stale", limit: 1 },
        budget: normalBudget,
        context: callContext(1),
      });
      assert.equal(hydrated.ok, true, JSON.stringify(hydrated));
      assert.equal(hydrated.result.data.coverage.indexed_row_count, 304);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 304);

      const oversizedPage = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", fields: ["ref", "name", "index"], refresh_policy: "never", limit: 100 },
        budget: minimumBudget,
        context: callContext(2),
      });
      assert.equal(oversizedPage.ok, true, JSON.stringify(oversizedPage));
      assert.equal(oversizedPage.budget.actual_bytes <= 2_048, true);
      assert.equal(oversizedPage.result.data.rows.length > 0, true);
      assert.equal(oversizedPage.result.data.rows.length <= 50, true);
      assert.equal(oversizedPage.result.data.page.has_more, true);
      assert.equal(typeof oversizedPage.result.data.page.next_cursor, "string");
      assert.equal(oversizedPage.result.data.coverage.public_returned_row_count, oversizedPage.result.data.rows.length);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 304);

      const exactLast = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          fields: ["ref", "name", "index"],
          filters: { name: trackNames.at(-1) },
          refresh_policy: "never",
          limit: 1,
        },
        budget: minimumBudget,
        context: callContext(3),
      });
      assert.equal(exactLast.ok, true, JSON.stringify(exactLast));
      assert.equal(exactLast.budget.actual_bytes <= 2_048, true);
      assert.equal(exactLast.result.data.rows[0].name, trackNames.at(-1));
      assert.equal(exactLast.result.data.rows[0].index, 303);
      assert.equal(exactLast.result.data.coverage.known_total_row_count, 304);
      assert.equal(exactLast.result.data.coverage.indexed_row_count, 304);
      assert.equal(exactLast.result.data.coverage.public_returned_row_count, 1);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 304);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("hydrates 100 exact Item selectors once, pages them 50 at a time, and also walks every 2 KiB page without loss", async () => {
    const fixture = await makeFixture();
    const itemRefs = Array.from({ length: 100 }, (_, index) => `item:guid:{BULK-ITEM-${String(index + 1).padStart(3, "0")}}`);
    const liveItems = new Map(itemRefs.map((itemRef, index) => [itemRef, {
      item_ref: itemRef,
      track_ref: "track:guid:{TRACK-1}",
      position_seconds: index * 2,
      length_seconds: 1,
      take_count: 0,
    }]));
    const state = {
      revision: 100,
      trackName: "Media",
      calls: [],
      atomicRequests: [],
      liveItems,
      itemReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const fiftyRows = [];
      let fiftyCursor = null;
      let fiftyPageCount = 0;
      do {
        const page = await runtime.call_template({
          id: "macro.project.query",
          input: {
            entity: "items",
            fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
            selectors: { refs: itemRefs },
            refresh_policy: fiftyCursor === null ? "if_stale" : "never",
            limit: 100,
            ...(fiftyCursor === null ? {} : { cursor: fiftyCursor }),
          },
          budget: { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 },
          context: callContext(fiftyPageCount + 1, "bulk-item-client"),
        });
        assert.equal(page.ok, true, JSON.stringify(page));
        assert.equal(page.result.data.rows.length, 50);
        assert.equal(page.result.data.coverage.public_returned_row_count, 50);
        fiftyPageCount += 1;
        assert.equal(state.itemReadRefs.length, 100, `public page ${fiftyPageCount} repeated live Item hydration`);
        fiftyRows.push(...page.result.data.rows);
        fiftyCursor = page.result.data.page.has_more ? page.result.data.page.next_cursor : null;
      } while (fiftyCursor !== null);

      assert.equal(fiftyPageCount, 2);
      assert.equal(fiftyRows.length, 100);
      assert.equal(new Set(fiftyRows.map((row) => row.ref)).size, 100);
      assert.deepEqual(new Set(fiftyRows.map((row) => row.ref)), new Set(itemRefs));

      const rows = [];
      let cursor = null;
      let pageCount = 0;
      do {
        const page = await runtime.call_template({
          id: "macro.project.query",
          input: {
            entity: "items",
            fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
            selectors: { refs: itemRefs },
            refresh_policy: "never",
            limit: 100,
            ...(cursor === null ? {} : { cursor }),
          },
          budget: { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 },
          context: callContext(rows.length + 1, "bulk-item-client"),
        });
        assert.equal(page.ok, true, JSON.stringify(page));
        assert.equal(page.budget.actual_bytes <= 2_048, true);
        assert.equal(page.result.data.rows.length > 0, true);
        assert.equal(page.result.data.rows.length <= 50, true);
        assert.equal(page.result.data.coverage.public_returned_row_count, page.result.data.rows.length);
        assert.equal(page.result.data.coverage.complete, false);
        pageCount += 1;
        assert.equal(state.itemReadRefs.length, 100, `cursor page ${pageCount} repeated live Item hydration`);
        rows.push(...page.result.data.rows);
        cursor = page.result.data.page.has_more ? page.result.data.page.next_cursor : null;
        assert.equal(page.result.data.page.has_more !== true || typeof cursor === "string", true);
      } while (cursor !== null);

      assert.equal(rows.length, 100);
      assert.equal(pageCount > 2, true);
      assert.deepEqual(new Set(rows.map((row) => row.ref)), new Set(itemRefs));
      assert.equal(new Set(rows.map((row) => row.ref)).size, 100);
      assert.equal(state.itemReadRefs.length, 100);
      assert.equal(new Set(state.itemReadRefs.map((ref) => ref.ref)).size, 100);
      const indexedRefs = new Set(indexRuntime.adapter.snapshot().rows.items.map((row) => row.ref));
      assert.equal(itemRefs.every((ref) => indexedRefs.has(ref)), true);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("fails closed when an exact Item selector cannot be confirmed by live readback", async () => {
    const fixture = await makeFixture();
    const missingItemRef = "item:guid:{NOT-LIVE}";
    const state = {
      revision: 101,
      trackName: "Media",
      calls: [],
      liveItems: new Map(),
      itemReadFailureRefs: new Set([missingItemRef]),
      itemReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "items",
          selectors: { refs: [missingItemRef] },
          refresh_policy: "if_stale",
          limit: 1,
        },
        context: callContext(1, "missing-item-client"),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "ITEM_NOT_FOUND");
      assert.equal(result.blockers[0].recoverable, true);
      assert.equal(state.itemReadRefs.length, 1);
      assert.equal(indexRuntime.adapter.snapshot().rows.items.some((row) => row.ref === missingItemRef), false);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("rejects more than 100 exact selectors before any live Item hydration instead of silently slicing", async () => {
    const fixture = await makeFixture();
    const itemRefs = Array.from({ length: 101 }, (_, index) => `item:guid:{OVER-LIMIT-${index + 1}}`);
    const state = {
      revision: 102,
      trackName: "Media",
      calls: [],
      liveItems: new Map(),
      itemReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "items",
          selectors: { refs: itemRefs },
          refresh_policy: "if_stale",
          limit: 1,
        },
        context: callContext(1, "over-limit-item-client"),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "GENERIC_QUERY_ARRAY_TOO_LARGE");
      assert.deepEqual(state.calls, []);
      assert.deepEqual(state.itemReadRefs, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("hydrates fourteen Automation rows losslessly and keeps the final GUID reachable after public paging", async () => {
    const fixture = await makeFixture();
    const automationNames = Array.from({ length: 14 }, (_, index) => index === 13 ? "Automation Envelope 14 Exact" : `Automation Envelope ${index + 1}`);
    const state = { revision: 14, trackName: "Highway", automationNames, calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const publicBudget = { max_response_bytes: 65_536, max_items: 50, max_inline_value_bytes: 2_048 };
      const cold = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "automation", fields: ["ref", "name", "point_count"], refresh_policy: "if_stale", limit: 2 },
        budget: publicBudget,
        context: callContext(1),
      });

      assert.equal(cold.ok, true, JSON.stringify(cold));
      assert.equal(cold.result.data.rows.length, 2);
      assert.equal(cold.result.data.coverage.known_total_row_count, 14);
      assert.equal(cold.result.data.coverage.indexed_row_count, 14);
      assert.equal(cold.result.data.coverage.public_returned_row_count, 2);
      assert.equal(cold.result.data.refresh.logical_refresh.coverage.automation, "complete");
      assert.equal(cold.result.data.refresh.logical_refresh.row_counts.automation, 14);
      assert.equal(indexRuntime.adapter.snapshot().rows.envelopes.length, 14);
      assert.deepEqual(
        state.atomicRequests.filter((entry) => entry.operation.name === "automation.project_envelopes.list").map((entry) => entry.params.limit),
        [32],
      );

      const publicPage = await runtime.call_template({
        id: "template.automation.list_project_envelopes",
        input: { parent_kinds: ["track"], limit: 1 },
        budget: publicBudget,
        context: callContext(2),
      });
      assert.equal(publicPage.ok, true, JSON.stringify(publicPage));
      assert.equal(publicPage.result.summary.returned_count, 1);
      assert.equal(publicPage.result.summary.coverage_status, "paged");
      assert.equal(Buffer.byteLength(JSON.stringify(publicPage.result.summary), "utf8") < 2_048, true);
      assert.equal(indexRuntime.adapter.snapshot().rows.envelopes.length, 14);
      assert.equal(indexRuntime.adapter.snapshot().freshness_scopes.automation.coverage_status, "complete");

      const finalRef = "envelope:guid:{AUTO-14}";
      const exactLast = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "automation", selectors: { refs: [finalRef] }, refresh_policy: "never", limit: 1 },
        budget: publicBudget,
        context: callContext(3),
      });
      assert.equal(exactLast.ok, true, JSON.stringify(exactLast));
      assert.equal(exactLast.result.data.rows[0].ref, finalRef);
      assert.equal(exactLast.result.data.rows[0].name, automationNames.at(-1));
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("merges hidden physical pages before exposing one complete forty-track logical scope", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 40 }, (_, index) => `Chunked ${String(index + 1).padStart(2, "0")}`);
    const state = { revision: 40, trackName: trackNames[0], trackNames, calls: [], atomicRequests: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "tracks",
          fields: ["name", "index"],
          filters: { name: trackNames.at(-1) },
          refresh_policy: "if_stale",
          limit: 1,
        },
        context: callContext(1),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.data.rows[0].name, trackNames.at(-1));
      assert.equal(result.result.data.rows[0].index, 39);
      assert.equal(result.result.data.coverage.known_total_row_count, 40);
      assert.equal(result.result.data.coverage.indexed_row_count, 40);
      assert.equal(result.result.data.coverage.public_returned_row_count, 1);
      assert.equal(result.result.data.refresh.call_count, 2);
      assert.equal(result.result.data.refresh.logical_refresh.chunk_count, 2);
      assert.equal(result.result.data.refresh.logical_refresh.row_counts.tracks, 40);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 40);
      assert.deepEqual(
        state.atomicRequests
          .filter((entry) => entry.operation.name === "project.create_observation_bundle")
          .map((entry) => entry.params.track_cursor),
        [0, 32],
      );
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("discards a mixed forty-track snapshot and retries once when REAPER changes between chunking and commit", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 40 }, (_, index) => `Retry ${String(index + 1).padStart(2, "0")}`);
    const state = {
      revision: 1,
      trackName: trackNames[0],
      trackNames,
      calls: [],
      atomicRequests: [],
      bumpRevisionAfterObservationCount: 2,
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 1 },
        context: callContext(1),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.sqlite.revision, "reaper-change-count:2");
      assert.equal(result.result.data.refresh.call_count, 4);
      assert.equal(result.result.data.refresh.revision_probe_count, 2);
      assert.equal(result.result.data.refresh.logical_refresh.attempt_count, 2);
      assert.equal(result.result.data.refresh.logical_refresh.row_counts.tracks, 40);
      assert.deepEqual(
        state.atomicRequests
          .filter((entry) => entry.operation.name === "project.create_observation_bundle")
          .map((entry) => entry.params.track_cursor),
        [0, 32, 0, 32],
      );
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 40);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("detects a changed REAPER revision, refreshes the affected query scope, and never uses stale rows as write authority", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const first = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(1),
      });
      assert.equal(first.ok, true, JSON.stringify(first));
      assert.equal(first.result.data.rows[0].name, "Kick");

      state.revision = 2;
      state.trackName = "Snare";
      const refreshed = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "if_stale", limit: 25 },
        context: callContext(2),
      });
      assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
      assert.equal(refreshed.sqlite.source, "refreshed_index");
      assert.equal(refreshed.sqlite.freshness, "refreshed");
      assert.equal(refreshed.sqlite.refreshed, true);
      assert.equal(refreshed.sqlite.revision, "reaper-change-count:2");
      assert.equal(refreshed.result.data.rows.length, 1, JSON.stringify(refreshed));
      assert.equal(refreshed.result.data.rows[0].name, "Snare");
      assert.equal(refreshed.result.data.refs_truth.sqlite_authorizes_writes, false);
      assert.equal(refreshed.result.data.refs_truth.write_requires_live_re_resolution, true);
      assert.equal(refreshed.result.data.refresh.call_count >= 1, true);

      const forcedCallCountBefore = state.calls.length;
      const forced = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(3),
      });
      assert.equal(forced.ok, true, JSON.stringify(forced));
      assert.equal(forced.sqlite.source, "refreshed_index");
      assert.equal(forced.result.data.refresh.call_count > 0, true);
      assert.equal(state.calls.length > forcedCallCountBefore, true);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("lets a second client refresh an exact new Item ref after a shared write invalidation", async () => {
    const fixture = await makeFixture();
    const newItemRef = "item:guid:{ITEM-AFTER-WRITE}";
    const state = {
      revision: 1,
      trackName: "Media",
      calls: [],
      atomicRequests: [],
      projectItems: [],
      liveItems: new Map(),
      itemReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });

      const initial = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "items", refresh_policy: "if_stale", limit: 25 },
        context: callContext(1, "client-b"),
      });
      assert.equal(initial.ok, true, JSON.stringify(initial));
      assert.equal(initial.result.data.rows.some((row) => row.ref === newItemRef), false);

      const newItem = {
        item_ref: newItemRef,
        track_ref: "track:guid:{TRACK-1}",
        position_seconds: 8,
        length_seconds: 2,
        take_count: 0,
      };
      state.liveItems.set(newItemRef, newItem);
      state.projectItems = [newItem];
      state.revision = 2;
      const invalidation = indexRuntime.invalidateScopes({ scopes: ["items"], observed_at: NOW });
      assert.equal(invalidation.ok, true, JSON.stringify(invalidation));

      const exact = await runtime.call_template({
        id: "macro.project.query",
        input: {
          entity: "items",
          fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
          selectors: { refs: [newItemRef] },
          refresh_policy: "if_stale",
          limit: 1,
        },
        context: callContext(1, "client-b-after-client-a-write"),
      });

      assert.equal(exact.ok, true, JSON.stringify(exact));
      assert.equal(exact.result.data.rows.length, 1);
      assert.equal(exact.result.data.rows[0].ref, newItemRef);
      assert.equal(exact.result.data.rows[0].track_ref, "track:guid:{TRACK-1}");
      assert.equal(exact.result.data.rows[0].start_seconds, 8);
      assert.equal(exact.result.data.rows[0].length_seconds, 2);
      assert.deepEqual(state.itemReadRefs, [{
        kind: "item",
        ref: newItemRef,
        identity: { scheme: "guid", value: "{ITEM-AFTER-WRITE}" },
      }]);
      assert.equal(indexRuntime.adapter.snapshot().rows.items.some((row) => row.ref === newItemRef), true);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("re-reads every existing exact Item ref after revision invalidation and fails closed on stale live-read errors", async () => {
    const fixture = await makeFixture();
    const itemRefs = Array.from({ length: 8 }, (_, index) => `item:guid:{STALE-ITEM-${index + 1}}`);
    const liveItems = new Map(itemRefs.map((itemRef, index) => [itemRef, {
      item_ref: itemRef,
      track_ref: "track:guid:{OLD-TRACK}",
      position_seconds: index,
      length_seconds: 1,
      take_count: 0,
    }]));
    const state = {
      revision: 1,
      trackName: "Media",
      calls: [],
      liveItems,
      itemReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = {
        entity: "items",
        fields: ["ref", "track_ref", "start_seconds", "length_seconds"],
        selectors: { refs: itemRefs },
        refresh_policy: "if_stale",
        limit: 8,
      };

      const seeded = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(1, "client-a"),
      });
      assert.equal(seeded.ok, true, JSON.stringify(seeded));
      assert.equal(state.itemReadRefs.length, 8);

      for (const [index, itemRef] of itemRefs.entries()) {
        state.liveItems.set(itemRef, {
          item_ref: itemRef,
          track_ref: "track:guid:{NEW-TRACK}",
          position_seconds: 100 + index,
          length_seconds: 2,
          take_count: 0,
        });
      }
      const writeInvalidation = indexRuntime.invalidateScopes({ scopes: ["items"], observed_at: NOW });
      assert.equal(writeInvalidation.ok, true, JSON.stringify(writeInvalidation));
      const refreshed = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(1, "client-b"),
      });
      assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
      assert.equal(refreshed.result.data.refresh.call_count, 8);
      assert.equal(state.itemReadRefs.length, 16);
      assert.deepEqual(
        new Set(state.itemReadRefs.slice(8).map((ref) => ref.ref)),
        new Set(itemRefs),
      );
      assert.equal(refreshed.result.data.rows.length, 8);
      assert.equal(refreshed.result.data.rows.every((row, index) => (
        row.track_ref === "track:guid:{NEW-TRACK}" && row.start_seconds === 100 + index
      )), true, JSON.stringify(refreshed.result.data.rows));

      const warmReadCount = state.itemReadRefs.length;
      const warm = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(2, "client-b"),
      });
      assert.equal(warm.ok, true, JSON.stringify(warm));
      assert.equal(warm.result.data.refresh.call_count, 0);
      assert.equal(state.itemReadRefs.length, warmReadCount);

      for (const [index, itemRef] of itemRefs.entries()) {
        state.liveItems.set(itemRef, {
          item_ref: itemRef,
          track_ref: "track:guid:{REVISION-TRACK}",
          position_seconds: 200 + index,
          length_seconds: 3,
          take_count: 0,
        });
      }
      state.revision = 2;
      const revisionRefreshed = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(3, "client-b"),
      });
      assert.equal(revisionRefreshed.ok, true, JSON.stringify(revisionRefreshed));
      assert.equal(revisionRefreshed.result.data.refresh.call_count, 8);
      assert.equal(state.itemReadRefs.length, warmReadCount + 8);
      assert.equal(revisionRefreshed.result.data.rows.every((row, index) => (
        row.track_ref === "track:guid:{REVISION-TRACK}" && row.start_seconds === 200 + index
      )), true, JSON.stringify(revisionRefreshed.result.data.rows));

      const forced = await runtime.call_template({
        id: "macro.project.query",
        input: { ...input, refresh_policy: "force_read_only_refresh" },
        context: callContext(4, "client-b"),
      });
      assert.equal(forced.ok, true, JSON.stringify(forced));
      assert.equal(forced.result.data.refresh.call_count, 8);
      assert.equal(state.itemReadRefs.length, warmReadCount + 16);

      state.revision = 3;
      state.itemReadFailureRefs = new Set([itemRefs[0]]);
      const failed = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(1, "client-c"),
      });
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(failed.error.code, "ITEM_NOT_FOUND");
      assert.equal(failed.result?.data?.rows, undefined);
      assert.equal(state.itemReadRefs.length, warmReadCount + 17);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("re-reads every existing exact Take ref after revision invalidation", async () => {
    const fixture = await makeFixture();
    const takeRefs = ["take:guid:{STALE-TAKE-1}", "take:guid:{STALE-TAKE-2}"];
    const liveTakes = new Map(takeRefs.map((takeRef, index) => [takeRef, {
      take_ref: takeRef,
      take_name: `对白 Take 你好 ${index + 1}`,
      item_ref: `item:guid:{TAKE-OWNER-${index + 1}}`,
      track_ref: "track:guid:{OLD-TRACK}",
      source_kind: "audio",
      length_seconds: 1,
    }]));
    const state = {
      revision: 1,
      trackName: "Media",
      calls: [],
      atomicRequests: [],
      liveTakes,
      takeReadRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = {
        entity: "takes",
        fields: ["ref", "name", "item_ref", "track_ref", "source_kind"],
        selectors: { refs: takeRefs },
        refresh_policy: "if_stale",
        limit: 2,
      };
      const seeded = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(1, "take-client-a"),
      });
      assert.equal(seeded.ok, true, JSON.stringify({ seeded, takeReadRefs: state.takeReadRefs, atomicRequests: state.atomicRequests }));
      assert.equal(state.takeReadRefs.length, 2);

      for (const [index, takeRef] of takeRefs.entries()) {
        state.liveTakes.set(takeRef, {
          take_ref: takeRef,
          take_name: `对白 Take 刷新 ${index + 1}`,
          item_ref: `item:guid:{TAKE-OWNER-${index + 1}}`,
          track_ref: "track:guid:{NEW-TRACK}",
          source_kind: "audio",
          length_seconds: 10 + index,
        });
      }
      state.revision = 2;
      const refreshed = await runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(1, "take-client-b"),
      });
      assert.equal(refreshed.ok, true, JSON.stringify(refreshed));
      assert.equal(refreshed.result.data.refresh.call_count, 2);
      assert.equal(state.takeReadRefs.length, 4);
      assert.deepEqual(new Set(state.takeReadRefs.slice(2).map((ref) => ref.ref)), new Set(takeRefs));
      assert.equal(refreshed.result.data.rows.every((row) => row.track_ref === "track:guid:{NEW-TRACK}"), true, JSON.stringify(refreshed.result.data.rows));
      assert.deepEqual(refreshed.result.data.rows.map((row) => row.name), ["对白 Take 刷新 1", "对白 Take 刷新 2"]);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("finds FX on Track 17 after complete Track coverage without coupling hydration to the public limit", async () => {
    const fixture = await makeFixture();
    const trackNames = Array.from({ length: 21 }, (_, index) => `Dialogue ${index + 1}`);
    const ownerRef = "track:guid:{TRACK-17}";
    const state = {
      revision: 21,
      trackName: trackNames[0],
      trackNames,
      calls: [],
      atomicRequests: [],
      fxOwnerRefs: [],
      omitTrackFxCount: true,
      liveTrackFxChains: new Map([[ownerRef, [{ name: "VST: ReaEQ (Cockos)" }]]]),
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", fields: ["ref", "owner_ref", "plugin_name"], refresh_policy: "if_stale", limit: 1 },
        context: callContext(1, "fx-complete-client"),
      });

      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.data.rows.length, 1);
      assert.equal(result.result.data.rows[0].owner_ref, ownerRef);
      assert.equal(result.result.data.rows[0].plugin_name, "VST: ReaEQ (Cockos)");
      assert.deepEqual(result.result.data.refresh.fx_owner_refresh, {
        requested_track_count: 21,
        visited_track_count: 21,
        hydrated_owner_count: 21,
        omitted_owner_count: 0,
        coverage_status: "complete",
        positive_owner_count: 1,
        returned_fx_row_count: 1,
      });
      assert.equal(state.fxOwnerRefs.length, 21);
      assert.equal(state.fxOwnerRefs.some((ref) => ref.ref === ownerRef), true);
      assert.equal(indexRuntime.adapter.snapshot().rows.tracks.length, 21);
      assert.equal(indexRuntime.adapter.snapshot().freshness_scopes.fx.coverage_status, "complete");
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("re-reads an exact Track FX chain across add, rename, and remove without revision or generation rotation", async () => {
    const fixture = await makeFixture();
    const ownerRef = "track:guid:{TRACK-1}";
    const state = {
      revision: 9,
      trackName: "Voice",
      calls: [],
      fxOwnerRefs: [],
      liveTrackFxChains: new Map([[ownerRef, []]]),
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = {
        entity: "fx",
        fields: ["ref", "owner_ref", "plugin_name"],
        filters: { owner_ref: ownerRef },
        refresh_policy: "if_stale",
        limit: 4,
      };
      const query = (requestId) => runtime.call_template({
        id: "macro.project.query",
        input,
        context: callContext(requestId, "fx-exact-client"),
      });

      const empty = await query(1);
      assert.equal(empty.ok, true, JSON.stringify(empty));
      assert.deepEqual(empty.result.data.rows, []);

      state.liveTrackFxChains.set(ownerRef, [{ name: "VST: ReaEQ (Cockos)" }]);
      const added = await query(2);
      assert.equal(added.ok, true, JSON.stringify(added));
      assert.equal(added.result.data.rows[0].plugin_name, "VST: ReaEQ (Cockos)");

      state.liveTrackFxChains.set(ownerRef, [{ name: "VST: ReaComp (Cockos)" }]);
      const renamed = await query(3);
      assert.equal(renamed.ok, true, JSON.stringify(renamed));
      assert.equal(renamed.result.data.rows[0].plugin_name, "VST: ReaComp (Cockos)");

      state.liveTrackFxChains.set(ownerRef, []);
      const removed = await query(4);
      assert.equal(removed.ok, true, JSON.stringify(removed));
      assert.deepEqual(removed.result.data.rows, []);
      assert.equal(state.fxOwnerRefs.length, 4);
      assert.equal(state.fxOwnerRefs.every((ref) => ref.ref === ownerRef), true);
      assert.equal(indexRuntime.adapter.snapshot().rows.fx.length, 0);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("fails closed on an incomplete FX chain and leaves the FX scope stale", async () => {
    const fixture = await makeFixture();
    const ownerRef = "track:guid:{TRACK-1}";
    const state = {
      revision: 12,
      trackName: "Voice",
      calls: [],
      fxOwnerRefs: [],
      liveTrackFxChains: new Map([[ownerRef, [{ name: "VST: ReaEQ (Cockos)" }]]]),
      fxReadbackOverrides: new Map([[ownerRef, { fx_count: 2, truncated: true }]]),
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", fields: ["ref", "owner_ref", "plugin_name"], refresh_policy: "if_stale", limit: 4 },
        context: callContext(1, "fx-incomplete-client"),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "PROJECT_INDEX_FX_CHAIN_COVERAGE_INCOMPLETE");
      assert.equal(indexRuntime.adapter.snapshot().freshness_scopes.fx.status, "stale");
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("does not treat a missing FX row array as a complete empty owner chain", async () => {
    const fixture = await makeFixture();
    const ownerRef = "track:guid:{TRACK-1}";
    const state = {
      revision: 12,
      trackName: "Voice",
      calls: [],
      fxOwnerRefs: [],
      liveTrackFxChains: new Map([[ownerRef, []]]),
      fxReadbackOverrides: new Map([[ownerRef, { fx_count: 0, omit_fx: true }]]),
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const result = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", fields: ["ref", "owner_ref", "plugin_name"], refresh_policy: "if_stale", limit: 4 },
        context: callContext(1, "fx-missing-array-client"),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, "PROJECT_INDEX_FX_CHAIN_COVERAGE_INCOMPLETE");
      assert.equal(result.blockers[0]?.details?.fx_array_present, false);
      assert.equal(indexRuntime.adapter.snapshot().freshness_scopes.fx.status, "stale");
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("marks an exact Track FX scope stale when the live owner read fails", async () => {
    const fixture = await makeFixture();
    const ownerRef = "track:guid:{TRACK-1}";
    const state = {
      revision: 13,
      trackName: "Voice",
      calls: [],
      fxOwnerRefs: [],
      liveTrackFxChains: new Map([[ownerRef, [{ name: "VST: ReaEQ (Cockos)" }]]]),
      fxReadFailureRefs: new Set(),
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const input = { entity: "fx", fields: ["ref", "owner_ref", "plugin_name"], filters: { owner_ref: ownerRef }, limit: 4 };
      assert.equal((await runtime.call_template({ id: "macro.project.query", input, context: callContext(1, "fx-failure-client") })).ok, true);

      state.fxReadFailureRefs.add(ownerRef);
      const failed = await runtime.call_template({ id: "macro.project.query", input, context: callContext(2, "fx-failure-client") });
      assert.equal(failed.ok, false, JSON.stringify(failed));
      assert.equal(indexRuntime.adapter.snapshot().freshness_scopes.fx.status, "stale");
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("fails project-wide FX coverage above 64 Tracks before owner reads", async () => {
    const fixture = await makeFixture();
    const state = {
      revision: 14,
      trackName: "Voice",
      calls: [],
      fxOwnerRefs: [],
    };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      state.trackNames = Array.from({ length: 65 }, (_, index) => `Track ${index + 1}`);
      state.fxOwnerRefs = [];
      const oversized = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", fields: ["ref", "owner_ref", "plugin_name"], refresh_policy: "force_read_only_refresh", limit: 4 },
        context: callContext(1, "fx-65-client"),
      });
      assert.equal(oversized.ok, false, JSON.stringify(oversized));
      assert.equal(oversized.error.code, "PROJECT_INDEX_FX_OWNER_LIMIT_EXCEEDED");
      assert.deepEqual(state.fxOwnerRefs, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("materializes live track object refs across staged FX hydration", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Source", calls: [], fxOwnerRefs: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const tracks = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(1),
      });
      assert.equal(tracks.ok, true, JSON.stringify(tracks));

      indexRuntime.invalidateScopes({ scopes: ["fx"], observed_at: NOW });
      const fx = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(2),
      });

      assert.equal(fx.ok, true, JSON.stringify(fx));
      assert.equal(fx.result.data.rows[0].ref, "fx:track:guid:{TRACK-1}:0");
      assert.deepEqual(state.fxOwnerRefs, [{ kind: "track", ref: "track:guid:{TRACK-1}" }]);
      assert.equal(state.calls.includes("fx.list_track_chain"), true);
      assert.equal(fx.result.data.refs_truth.sqlite_authorizes_writes, false);

      const fxCallCountBefore = state.calls.filter((name) => name === "fx.list_track_chain").length;
      const forcedAgain = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "fx", refresh_policy: "force_read_only_refresh", limit: 25 },
        context: callContext(3),
      });
      assert.equal(forcedAgain.ok, true, JSON.stringify(forcedAgain));
      assert.equal(
        state.calls.filter((name) => name === "fx.list_track_chain").length > fxCallCountBefore,
        true,
      );
      assert.equal(
        indexRuntime.adapter.snapshot().rows.tracks.find((row) => row.ref === "track:guid:{TRACK-1}").fx_count,
        1,
      );
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("rejects raw SQL before any live child call", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const rejected = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", raw_sql: "select * from tracks" },
        context: callContext(1),
      });
      assert.equal(rejected.ok, false);
      assert.equal(rejected.contract, "macro.execution.v1");
      assert.equal(rejected.execution.status, "blocked");
      assert.equal(rejected.result.data.zero_write, true);
      assert.equal(rejected.blockers.some((entry) => entry.code === "RAW_SQL_NOT_ALLOWED"), true);
      assert.deepEqual(state.calls, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("proves zero writes when a cold Project Index query forbids refresh", async () => {
    const fixture = await makeFixture();
    const state = { revision: 1, trackName: "Kick", calls: [] };
    let indexRuntime;
    try {
      indexRuntime = await openIndex(fixture);
      const runtime = createRuntime({ fixture, indexRuntime, state });
      const blocked = await runtime.call_template({
        id: "macro.project.query",
        input: { entity: "tracks", refresh_policy: "never", limit: 25 },
        context: callContext(1),
      });
      assert.equal(blocked.ok, false, JSON.stringify(blocked));
      assert.ok(["INDEX_NOT_READY", "INDEX_REFRESH_REQUIRED"].includes(blocked.error.code));
      assert.equal(blocked.result.data.zero_write, true);
      assert.deepEqual(state.calls, []);
    } finally {
      indexRuntime?.close();
      await fixture.cleanup();
    }
  });

  it("projects packaged Doctor project-query readiness without reopening the frozen B3 module", () => {
    const shared = {
      contract: "alpha3.2.b3.runtime_doctor_readiness.v1",
      mode: "project-query",
      status: "degraded",
      ready: false,
      failure_layer: "task_specific",
      evidence: { request_response: { status: "ready" } },
    };
    const ready = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: shared,
      projectIndexReadiness: {
        status: "ready_warm",
        ready: true,
        next_action: "Use the warm index.",
      },
      projectIndex: {
        lifecycle: "ready",
        backend: "sqlite_file_adapter",
        revision: "reaper-change-count:6",
        rows_available: true,
        sqlite_rows_are_candidates_only: true,
        sqlite_is_truth: false,
      },
    });
    assert.equal(ready.status, "ready");
    assert.equal(ready.ready, true);
    assert.equal(ready.failure_layer, null);
    assert.equal(ready.task_specific_readiness, "ready_warm");
    assert.equal(ready.evidence.project_index.revision, "reaper-change-count:6");
    assert.equal(ready.evidence.project_index.sqlite_is_truth, false);

    const cold = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: shared,
      projectIndexReadiness: {
        status: "not_configured",
        ready: false,
        next_action: "Run OpenReaper through the installed wrapper.",
      },
      projectIndex: null,
    });
    assert.equal(cold.status, "degraded");
    assert.equal(cold.failure_layer, "project_index");
    assert.equal(cold.missing_precondition, "project_index_not_configured");
    assert.equal(cold.next_action.instruction, "Run OpenReaper through the installed wrapper.");

    const blocked = projectAlpha3_2_5BProjectQueryDoctorTask({
      task: { ...shared, status: "blocked", failure_layer: "bridge_heartbeat" },
      projectIndexReadiness: { status: "ready_warm", ready: true },
      projectIndex: { lifecycle: "ready" },
    });
    assert.equal(blocked.status, "blocked");
    assert.equal(blocked.failure_layer, "bridge_heartbeat");
  });
});

function createRuntime({ fixture, indexRuntime, state }) {
  const fake = new FakeFoundationBridge({
    owner: OWNER,
    generation: GENERATION,
    now: () => new Date(NOW),
  });
  const executor = {
    dispatch(request) {
      state.calls.push(request.operation.name);
      if (Array.isArray(state.atomicRequests)) state.atomicRequests.push(structuredClone(request));
      const response = structuredClone(fake.dispatch(request));
      const projectRef = indexRuntime.identity.project_ref;
      if (request.operation.name === "project.read_summary") {
        response.result.summary = {
          project_ref: projectRef,
          name: "Trial",
          path: fixture.projectPath,
          change_count: state.revision,
          track_count: state.liveTrackCount ?? state.trackNames?.length ?? 1,
          item_count: state.projectItems?.length ?? 1,
          ...(request.params.include_media_counts === true ? { take_count: state.liveTakeCount ?? state.projectTakes?.length ?? 1, midi_take_count: state.projectTakes?.filter((take) => take.source_kind === "midi").length ?? 1 } : {}),
          marker_count: 0,
          region_count: 1,
        };
        response.result.readback = response.result.summary;
      } else if (request.operation.name === "project.read_track_item_overview") {
        const takeInventory = request.params.include_takes === true;
        const rows = takeInventory ? state.projectTakes ?? [] : state.projectItems ?? [];
        const cursor = Number(takeInventory ? request.params.take_cursor ?? 0 : request.params.item_cursor ?? 0);
        const limit = takeInventory ? request.params.max_takes ?? 64 : request.params.max_items ?? 64;
        const end = Math.min(rows.length, cursor + limit);
        const truncated = end < rows.length;
        const internallyComplete = state.itemCoverageInternallyComplete !== false;
        response.result.summary = {
          project_ref: projectRef,
          tracks: [],
          selected_items: [],
          track_count: state.trackNames?.length ?? 1,
          item_count: rows.length,
          track_cursor: request.params.track_cursor ?? 0,
          returned_track_count: 0,
          truncated: true,
          items: takeInventory ? [] : structuredClone(rows.slice(cursor, end)),
          item_cursor: cursor,
          returned_item_count: end - cursor,
          next_item_cursor: truncated ? String(end) : null,
          items_truncated: truncated,
          item_coverage_status: internallyComplete ? (truncated ? "paged" : "complete") : "incomplete",
          item_coverage: { internally_complete: internallyComplete },
          ...(takeInventory ? {
            item_count: state.projectItems?.length ?? rows.length,
            takes: structuredClone(rows.slice(cursor, end)),
            take_count: rows.length,
            take_cursor: cursor,
            returned_take_count: end - cursor,
            next_take_cursor: truncated ? String(end) : null,
            takes_truncated: truncated,
            take_coverage_status: internallyComplete ? (truncated ? "paged" : "complete") : "incomplete",
            take_coverage: { internally_complete: internallyComplete },
          } : {}),
        };
        response.result.readback = response.result.summary;
        response.result.refs = rows.slice(cursor, end).map((row) => ({
          kind: takeInventory ? "take" : "item",
          ref: takeInventory ? row.take_ref : row.item_ref,
          identity: { scheme: "guid", value: (takeInventory ? row.take_ref : row.item_ref).slice(takeInventory ? "take:guid:".length : "item:guid:".length) },
        }));
      } else if (request.operation.name === "routing.project_graph.read") {
        const rows = state.routingEdges ?? [];
        const cursor = Number(request.params.edge_cursor ?? 0);
        const limit = request.params.max_edges ?? 64;
        const end = Math.min(rows.length, cursor + limit);
        const truncated = end < rows.length;
        const internallyComplete = state.routingCoverageInternallyComplete !== false;
        const trackTruncated = state.routingTrackTruncated === true;
        response.result.summary = {
          tracks: [],
          edges: structuredClone(rows.slice(cursor, end)),
          track_count: state.trackNames?.length ?? 1,
          returned_track_count: 0,
          edge_count: end - cursor,
          total_edge_count: rows.length,
          returned_edge_count: end - cursor,
          edge_cursor: cursor,
          next_edge_cursor: truncated ? String(end) : null,
          truncated,
          coverage_status: !internallyComplete ? "incomplete" : (truncated || trackTruncated ? "paged" : "complete"),
          coverage: { internally_complete: internallyComplete, track_truncated: trackTruncated, edges_truncated: truncated },
        };
        response.result.readback = response.result.summary;
      } else if (
        request.operation.name === "project.create_observation_bundle"
        || request.operation.name === "project.create_project_map_snapshot"
      ) {
        state.observationCallCount = (state.observationCallCount ?? 0) + 1;
        const scope = request.operation.name === "project.create_observation_bundle"
          ? "observation_bundle"
          : "project_map_snapshot";
        response.result.summary = {
          artifact_ref: `artifact:project:${scope}:art_20260712060000000_001_abcdef`,
          project_ref: projectRef,
          track_count: state.trackNames?.length ?? 1,
          track_cursor: request.params.track_cursor ?? 0,
          returned_track_count: Math.min(
            request.params.max_tracks ?? 32,
            Math.max(0, (state.trackNames?.length ?? 1) - (request.params.track_cursor ?? 0)),
          ),
          map_truncated: (request.params.track_cursor ?? 0) + (request.params.max_tracks ?? 32) < (state.trackNames?.length ?? 1),
        };
        if (response.result.summary.map_truncated) {
          response.result.summary.next_track_cursor = String(
            (request.params.track_cursor ?? 0) + (request.params.max_tracks ?? 32),
          );
        }
        response.result.readback = response.result.summary;
        response.result.refs = [{
          kind: "artifact",
          ref: response.result.summary.artifact_ref,
          identity: { scheme: "artifact_ref", value: response.result.summary.artifact_ref },
        }];
        if (state.observationCallCount === state.bumpRevisionAfterObservationCount) {
          state.revision += 1;
          state.bumpRevisionAfterObservationCount = null;
        }
      } else if (
        request.operation.name === "tracks.list_tracks"
        || request.operation.name === "tracks.read_mixer_controls"
      ) {
        response.result.readback = trackReadback(state.trackNames ?? [state.trackName]);
      } else if (request.operation.name === "automation.project_envelopes.list") {
        const names = state.automationNames ?? [];
        const cursor = Number(request.params.cursor ?? 0);
        const limit = request.params.limit ?? 32;
        const end = Math.min(names.length, cursor + limit);
        const truncated = end < names.length;
        response.result.summary = {
          envelopes: names.slice(cursor, end).map((name, offset) => {
            const index = cursor + offset + 1;
            return {
              envelope_ref: `envelope:guid:{AUTO-${index}}`,
              owner_ref: `track:guid:{TRACK-${index}}`,
              parent_kind: "track",
              envelope_type: "volume",
              identity_kind: "guid",
              name,
              point_count: index,
              automation_item_count: 0,
              visible: true,
            };
          }),
          envelope_refs: names.slice(cursor, end).map((_, offset) => `envelope:guid:{AUTO-${cursor + offset + 1}}`),
          returned_count: end - cursor,
          total_count: names.length,
          next_cursor: truncated ? String(end) : null,
          truncated,
          coverage_status: truncated ? "paged" : "complete",
          coverage: { internally_complete: true, retained_count: names.length },
        };
        response.result.readback = response.result.summary;
      } else if (request.operation.name === "fx.list_track_chain" || request.operation.name === "fx.list_take_chain") {
        state.fxOwnerRefs ??= [];
        state.fxOwnerRefs.push(...request.refs.map((ref) => ({ kind: ref.kind, ref: ref.ref })));
        const ownerRef = request.refs[0]?.ref;
        if (state.fxReadFailureRefs?.has(ownerRef)) {
          return structuredClone(fake.dispatch({
            ...request,
            params: { ...request.params, force_error: "FX_CHAIN_READ_FAILED" },
          }));
        }
        const trackOwner = request.operation.name === "fx.list_track_chain";
        const fallback = trackOwner && ownerRef === "track:guid:{TRACK-1}" && !state.liveTrackFxChains
          ? [{ name: "VST: ReaComp (Cockos)", enabled: true }]
          : [];
        const chain = structuredClone((trackOwner ? state.liveTrackFxChains : state.liveTakeFxChains)?.get(ownerRef) ?? fallback);
        const override = state.fxReadbackOverrides?.get(ownerRef) ?? {};
        response.result.summary = {
          owner_ref: ownerRef,
          ...(trackOwner ? { track_ref: ownerRef } : { take_ref: ownerRef }),
          fx_count: override.fx_count ?? chain.length,
          ...(typeof override.truncated === "boolean" ? { truncated: override.truncated } : {}),
          ...(!override.omit_fx ? { fx: chain.map((fx, slotIndex) => ({
            fx_ref: `fx:${ownerRef}:${slotIndex}`,
            owner_ref: ownerRef,
            slot_index: slotIndex,
            name: fx.name,
            enabled: fx.enabled !== false,
          })) } : {}),
        };
        response.result.readback = response.result.summary;
        response.result.refs = chain.map((_, slotIndex) => ({
          kind: "fx",
          ref: `fx:${ownerRef}:${slotIndex}`,
          identity: { scheme: "track_fx", value: `${ownerRef}:${slotIndex}` },
        }));
      } else if (request.operation.name === "items.read_item_summary") {
        const itemRef = request.refs[0]?.ref;
        if (state.itemReadFailureRefs?.has(itemRef)) {
          state.itemReadRefs?.push(structuredClone(request.refs[0]));
          return structuredClone(fake.dispatch({
            ...request,
            params: { ...request.params, force_error: "ITEM_NOT_FOUND" },
          }));
        }
        const item = state.liveItems?.get(itemRef);
        if (item) {
          state.itemReadRefs?.push(structuredClone(request.refs[0]));
          response.result.summary = structuredClone(item);
          response.result.readback = structuredClone(item);
          response.result.refs = [structuredClone(request.refs[0])];
        }
      } else if (request.operation.name === "media.take_source.read") {
        const takeRef = request.refs[0]?.ref;
        const take = state.liveTakes?.get(takeRef);
        if (take) {
          state.takeReadRefs?.push(structuredClone(request.refs[0]));
          response.result.summary = structuredClone(take);
          response.result.readback = structuredClone(take);
          response.result.refs = [structuredClone(request.refs[0])];
        }
      } else if (request.operation.name === "project.read_dirty_state") {
        response.result.summary = {
          project_ref: projectRef,
          dirty: false,
          dirty_state: "clean",
          raw_dirty_state: 0,
        };
        response.result.readback = response.result.summary;
      } else if (request.operation.name === "render.settings.read") {
        response.result.summary = {
          sample_rate: 48_000,
          channels: 2,
          bounds: "project",
        };
        response.result.readback = response.result.summary;
      }
      return response;
    },
  };

  return createCallTemplateRuntime({
    projectIndexRuntime: indexRuntime,
    projectIndexArtifactReader: async ({ template_id, execution }) => ({
      payload: template_id === "template.project.create_observation_bundle"
        ? observationBundlePayload(
            indexRuntime.identity.project_ref,
            state.trackNames ?? [state.trackName],
            execution?.result?.readback?.track_cursor ?? 0,
            execution?.result?.readback?.returned_track_count ?? 32,
            state,
          )
        : projectMapPayload(indexRuntime.identity.project_ref, state.trackNames ?? [state.trackName], state),
    }),
    live: {
      opted_in: true,
      executor,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
    now: () => new Date(NOW),
  });
}

function observationBundlePayload(projectRef, trackNames, trackCursor = 0, maxTracks = 32, state = {}) {
  const projectMap = projectOverview(projectRef, trackNames, trackCursor, maxTracks, state);
  return {
    project_ref: projectRef,
    project_map: projectMap,
    markers_regions: {
      items: [{
        ref: "region:index:1",
        marker_kind: "region",
        position_seconds: 0,
        end_seconds: 4,
        name: "Intro",
      }],
    },
    coverage: {
      project_map: projectMap.truncated ? "paged" : "complete_page",
      markers_regions: "bounded",
    },
  };
}

function projectMapPayload(projectRef, trackNames, state = {}) {
  return {
    project_ref: projectRef,
    overview: projectOverview(projectRef, trackNames, 0, 32, state),
    coverage: {
      tracks: "complete_page",
      track_items: "bounded_per_track",
      selected_items: "bounded",
    },
  };
}

function projectOverview(projectRef, trackNames, trackCursor = 0, maxTracks = 32, state = {}) {
  const names = Array.isArray(trackNames) ? trackNames : [trackNames];
  const end = Math.min(names.length, trackCursor + maxTracks);
  return {
    project_ref: projectRef,
    track_count: names.length,
    item_count: 1,
    track_cursor: trackCursor,
    returned_track_count: end - trackCursor,
    truncated: end < names.length,
    ...(end < names.length ? { next_track_cursor: String(end) } : {}),
    tracks: names.slice(trackCursor, end).map((name, offset) => {
      const index = trackCursor + offset;
      return {
        track_ref: `track:guid:{TRACK-${index + 1}}`,
        name,
        index,
        ...(!state.omitTrackFxCount ? {
          fx_count: state.liveTrackFxChains
            ? state.liveTrackFxChains.get(`track:guid:{TRACK-${index + 1}}`)?.length ?? 0
            : Array.isArray(state.fxOwnerRefs) && index === 0 ? 1 : 0,
        } : {}),
        items: index === 0 ? [{
          item_ref: "item:guid:{ITEM-1}",
          track_ref: "track:guid:{TRACK-1}",
          start_seconds: 0,
          end_seconds: 4,
          active_take_ref: "take:guid:{TAKE-1}",
        }] : [],
      };
    }),
    selected_items: [],
  };
}

function trackReadback(trackNames) {
  const names = Array.isArray(trackNames) ? trackNames : [trackNames];
  return {
    tracks: names.map((name, index) => ({
      track_ref: `track:guid:{TRACK-${index + 1}}`,
      name,
      index,
      selected: false,
    })),
    track_count: names.length,
    truncated: false,
    coverage: "complete",
  };
}

async function makeFixture() {
  const rawRoot = await mkdtemp(path.join(os.tmpdir(), "openreaper-alpha325-b-"));
  const root = await realpath(rawRoot);
  const stateRoot = path.join(root, "state");
  const projectPath = path.join(root, "Trial.RPP");
  await mkdir(stateRoot);
  await writeFile(projectPath, "<REAPER_PROJECT 0.1>\n", "utf8");
  return {
    root,
    stateRoot,
    projectPath,
    async cleanup() { await rm(root, { recursive: true, force: true }); },
  };
}

function openIndex(fixture) {
  return openAlpha3_2DProjectIndexRuntime({
    stateRoot: fixture.stateRoot,
    projectPath: fixture.projectPath,
    bridgeOwner: OWNER,
    bridgeGeneration: GENERATION,
    logicalSessionKey: "alpha325-b-test",
    now: () => new Date(NOW),
  });
}

function replaceTakeIndex(indexRuntime, rows) {
  const snapshot = indexRuntime.adapter.snapshot();
  const result = indexRuntime.adapter.replaceTakes({
    snapshot_id: snapshot.snapshot_id ?? "snapshot:alpha325-b:test-takes",
    observed_at: NOW,
    source_template_id: "template.project.read_track_item_overview",
    projectRef: indexRuntime.identity.project_ref,
    bridgeOwner: indexRuntime.identity.bridge_owner,
    bridgeGeneration: indexRuntime.identity.bridge_generation,
    sessionId: indexRuntime.identity.session_id,
    rows,
    coverage_status: "complete",
    freshness_status: "fresh",
  });
  assert.notEqual(result?.ok, false, JSON.stringify(result));
}

function callContext(requestSequence, clientId = "alpha325-b-test") {
  return {
    client_id: clientId,
    session_id: `${clientId}-session`,
    expected_owner: OWNER,
    expected_generation: GENERATION,
    created_at: NOW,
    request_sequence: requestSequence,
  };
}
