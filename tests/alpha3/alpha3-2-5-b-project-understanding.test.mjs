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
          filters: { name: trackNames.at(-1) },
          refresh_policy: "never",
          limit: 1,
        },
        budget: { ...publicBudget, max_response_bytes: 2_048 },
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
        context: callContext(3),
      });
      assert.equal(reopenedExactLast.ok, true, JSON.stringify(reopenedExactLast));
      assert.equal(reopenedExactLast.result.data.rows[0].name, trackNames.at(-1));
      assert.equal(reopenedExactLast.result.data.coverage.indexed_row_count, 14);
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

      state.liveItems.set(newItemRef, {
        item_ref: newItemRef,
        track_ref: "track:guid:{TRACK-1}",
        position_seconds: 8,
        length_seconds: 2,
        take_count: 0,
      });
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
      assert.equal(rejected.blockers.some((entry) => entry.code === "RAW_SQL_NOT_ALLOWED"), true);
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
          track_count: state.trackNames?.length ?? 1,
          item_count: 1,
          marker_count: 0,
          region_count: 1,
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
      } else if (request.operation.name === "fx.list_track_chain") {
        state.fxOwnerRefs.push(...request.refs.map((ref) => ({ kind: ref.kind, ref: ref.ref })));
        response.result.summary = {
          owner_ref: "track:guid:{TRACK-1}",
          track_ref: "track:guid:{TRACK-1}",
          fx_count: 1,
          fx: [{
            fx_ref: "fx:track:guid:{TRACK-1}:0",
            owner_ref: "track:guid:{TRACK-1}",
            slot_index: 0,
            name: "VST: ReaComp (Cockos)",
            enabled: true,
          }],
        };
        response.result.readback = response.result.summary;
        response.result.refs = [{
          kind: "fx",
          ref: "fx:track:guid:{TRACK-1}:0",
          identity: { scheme: "track_fx", value: "track:guid:{TRACK-1}:0" },
        }];
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
          )
        : projectMapPayload(indexRuntime.identity.project_ref, state.trackNames ?? [state.trackName]),
    }),
    live: {
      opted_in: true,
      executor,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
    now: () => new Date(NOW),
  });
}

function observationBundlePayload(projectRef, trackNames, trackCursor = 0, maxTracks = 32) {
  const projectMap = projectOverview(projectRef, trackNames, trackCursor, maxTracks);
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

function projectMapPayload(projectRef, trackNames) {
  return {
    project_ref: projectRef,
    overview: projectOverview(projectRef, trackNames),
    coverage: {
      tracks: "complete_page",
      track_items: "bounded_per_track",
      selected_items: "bounded",
    },
  };
}

function projectOverview(projectRef, trackNames, trackCursor = 0, maxTracks = 32) {
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
