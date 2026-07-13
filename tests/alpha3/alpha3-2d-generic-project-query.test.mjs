import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2D_COVERED_LEGACY_QUERY_IDS,
  ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT,
  ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES,
  ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT,
  createAlpha3_2DGenericProjectQueryDiscoveryItems,
  createAlpha3_2DGenericProjectQueryRuntimeEnvelope,
  planAlpha3_2DGenericProjectQuery,
} from "../../packages/mcp-server/src/alpha3-c3-project-index-query-v1.mjs";

const ENTITIES = [
  "status", "selected_context", "tracks", "items", "takes", "fx", "routing", "automation",
  "markers_regions", "media_sources", "duplicates", "changed_since",
];

function freshIndex({ snapshotId = "snapshot:a", empty = false } = {}) {
  const scope = (kind) => ({
    scope_kind: kind,
    scope_ref: "project:active",
    snapshot_id: snapshotId,
    status: "fresh",
    coverage_status: "complete",
    observed_at: "2026-07-11T00:00:00.000Z",
  });
  const rows = empty ? {} : {
    tracks: [{ ref: "track:guid:{T1}", name: "Drums", index: 0, freshness_status: "fresh", coverage_status: "complete" }],
    items: [{ ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", start_seconds: 1, end_seconds: 2, freshness_status: "fresh", coverage_status: "complete" }],
    takes: [{ ref: "take:guid:{K1}", item_ref: "item:guid:{I1}", track_ref: "track:guid:{T1}", active: true, freshness_status: "fresh", coverage_status: "complete" }],
    fx: [{ ref: "fx:track:guid:{T1}:0", owner_ref: "track:guid:{T1}", plugin_name: "ReaEQ", slot_index: 0, freshness_status: "fresh", coverage_status: "complete" }],
    sends: [{ ref: "send:track:guid:{T1}:0", source_track_ref: "track:guid:{T1}", destination_track_ref: "track:guid:{T2}", send_index: 0, freshness_status: "fresh", coverage_status: "complete" }],
    envelopes: [{ ref: "envelope:track:guid:{T1}:volume", owner_ref: "track:guid:{T1}", name: "Volume", freshness_status: "fresh", coverage_status: "complete" }],
    markers_regions: [{ ref: "region:id:1", marker_kind: "region", position_seconds: 0, end_seconds: 8, name: "Loop", freshness_status: "fresh", coverage_status: "complete" }],
    media_sources: [
      { ref: "file:path:/audio/kick-a.wav", owner_ref: "take:guid:{K1}", name: "kick-a.wav", path_fingerprint: "media:kick", freshness_status: "fresh", coverage_status: "complete" },
      { ref: "file:path:/audio/kick-b.wav", owner_ref: "take:guid:{K2}", name: "kick-b.wav", path_fingerprint: "media:kick", freshness_status: "fresh", coverage_status: "complete" },
    ],
    selection_state: [{ ref: "track:guid:{T1}", ref_kind: "track", scope_kind: "track", freshness_status: "fresh", coverage_status: "complete" }],
    object_changes: [{ change_id: "change:1", ref: "item:guid:{I1}", owner_ref: "track:guid:{T1}", change_kind: "updated", observed_at: "2026-07-11T00:00:01.000Z" }],
  };
  return {
    lifecycle: "ready",
    schema_version: 1,
    project_ref: "project:active",
    session_id: "session:a",
    snapshot_id: snapshotId,
    freshness_scopes: Object.fromEntries([
      "selection", "tracks", "items", "takes", "fx", "routing", "automation", "markers", "media",
    ].map((kind) => [kind, scope(kind)])),
    coverage: { status: "complete" },
    rows,
  };
}

function staleIndex() {
  const index = freshIndex();
  index.freshness_scopes.tracks = { ...index.freshness_scopes.tracks, status: "stale" };
  return index;
}

describe("Alpha3.2-D generic macro.project.query", () => {
  it("publishes exactly one executable registered query Macro and internal legacy replacement metadata", () => {
    const items = createAlpha3_2DGenericProjectQueryDiscoveryItems();
    assert.equal(items.length, 1);
    assert.equal(items[0].id, "macro.project.query");
    assert.equal(items[0].support_status, "executable_runtime_bound");
    assert.equal(items[0].execution_shape, "registered_macro_program");
    assert.equal(items[0].live_runnable_now, false);
    assert.deepEqual(items[0].entities, ENTITIES);
    assert.deepEqual(ALPHA3_2D_GENERIC_PROJECT_QUERY_ENTITIES, ENTITIES);
    assert.deepEqual(items[0].replacement, ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT);
    assert.deepEqual(ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT.covers_legacy_ids, ALPHA3_2D_COVERED_LEGACY_QUERY_IDS);
    assert.equal(ALPHA3_2D_GENERIC_PROJECT_QUERY_REPLACEMENT.legacy_posture, "internal_covered_not_public");
  });

  it("covers all twelve exact entities with populated and explicit empty results", () => {
    for (const entity of ENTITIES) {
      const populated = planAlpha3_2DGenericProjectQuery({ entity, refresh_policy: "never", limit: 10 }, { projectIndex: freshIndex() });
      assert.equal(populated.contract, ALPHA3_2D_GENERIC_PROJECT_QUERY_CONTRACT, entity);
      assert.equal(populated.entity, entity);
      assert.equal(populated.ok, true, `${entity}: ${JSON.stringify(populated.blockers)}`);
      assert.equal(populated.rows.length > 0, true, entity);
      assert.equal(populated.refresh_requests.length, 0, entity);

      const empty = planAlpha3_2DGenericProjectQuery({ entity, refresh_policy: "never", limit: 10 }, { projectIndex: freshIndex({ empty: true }) });
      assert.equal(empty.ok, true, `${entity}: ${JSON.stringify(empty.blockers)}`);
      if (entity === "status") {
        assert.equal(empty.rows.length, 1, entity);
      } else {
        assert.deepEqual(empty.rows, [], entity);
        assert.equal(empty.coverage.row_count, 0, entity);
      }
    }
  });

  it("makes refresh policy real without executing child requests", () => {
    const never = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy: "never" }, { projectIndex: staleIndex() });
    assert.equal(never.ok, false);
    assert.deepEqual(never.rows, []);
    assert.deepEqual(never.refresh_requests, []);

    const ifStale = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy: "if_stale" }, { projectIndex: staleIndex() });
    assert.equal(ifStale.ok, false);
    assert.equal(ifStale.refresh_requests.length > 0, true);
    assert.equal(ifStale.refresh_requests.every((request) => request.read_only === true && request.risk === "read"), true);

    const freshIfStale = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy: "if_stale" }, { projectIndex: freshIndex() });
    assert.equal(freshIfStale.ok, true);
    assert.deepEqual(freshIfStale.refresh_requests, []);
    assert.equal(freshIfStale.rows.length, 1);

    for (const refresh_policy of ["required", "force_read_only_refresh"]) {
      const forced = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy }, { projectIndex: freshIndex() });
      assert.equal(forced.ok, false, refresh_policy);
      assert.deepEqual(forced.rows, [], refresh_policy);
      assert.deepEqual(forced.refs, [], refresh_policy);
      assert.equal(forced.refresh_requests.length > 0, true, refresh_policy);
      assert.equal(forced.blockers.some((entry) => entry.code === "GENERIC_QUERY_REFRESH_REQUIRED"), true, refresh_policy);
      assert.equal(forced.execution.child_executor, false);
      assert.equal(forced.execution.executor_call_count, 0);
      assert.equal(forced.refresh_execution.owner, "agent");
      assert.match(forced.refresh_execution.required_behavior, /automatically observe accepted readback/);
    }
  });

  it("derives bounded duplicate groups only from media identity/path fingerprints", () => {
    const plan = planAlpha3_2DGenericProjectQuery({
      entity: "duplicates",
      fields: ["duplicate_key", "count", "refs", "owner_refs", "source_path", "path_fingerprint", "freshness", "coverage"],
      refresh_policy: "never",
    }, { projectIndex: freshIndex() });
    assert.equal(plan.ok, true);
    assert.equal(plan.rows.length, 1);
    assert.deepEqual(plan.rows[0], {
      duplicate_key: "fingerprint:media:kick",
      count: 2,
      refs: ["file:path:/audio/kick-a.wav", "file:path:/audio/kick-b.wav"],
      owner_refs: ["take:guid:{K1}", "take:guid:{K2}"],
      source_path: null,
      path_fingerprint: "media:kick",
      freshness: "fresh",
      coverage: "complete",
    });
    assert.equal(JSON.stringify(plan).includes("audio similarity"), false);
    assert.equal(JSON.stringify(plan).includes("raw SQL"), false);
  });

  it("binds cursors to contract/entity/snapshot/query identity and types stale versus invalid", () => {
    const index = freshIndex();
    index.rows.tracks.push({ ref: "track:guid:{T2}", name: "Bass", index: 1, freshness_status: "fresh", coverage_status: "complete" });
    const first = planAlpha3_2DGenericProjectQuery({ entity: "tracks", fields: ["name"], filters: {}, selectors: {}, refresh_policy: "never", limit: 1 }, { projectIndex: index });
    assert.equal(first.ok, true);
    assert.equal(typeof first.page.next_cursor, "string");

    const next = planAlpha3_2DGenericProjectQuery({ entity: "tracks", fields: ["name"], filters: {}, selectors: {}, refresh_policy: "never", limit: 1, cursor: first.page.next_cursor }, { projectIndex: index });
    assert.equal(next.ok, true);
    assert.equal(next.rows[0].name, "Bass");

    const stale = planAlpha3_2DGenericProjectQuery({ entity: "tracks", fields: ["name"], filters: {}, selectors: {}, refresh_policy: "never", limit: 1, cursor: first.page.next_cursor }, { projectIndex: freshIndex({ snapshotId: "snapshot:b" }) });
    assert.equal(stale.ok, false);
    assert.equal(stale.blockers.some((entry) => entry.code === "GENERIC_QUERY_CURSOR_STALE"), true);

    const changedQuery = planAlpha3_2DGenericProjectQuery({ entity: "tracks", fields: ["index"], filters: {}, selectors: {}, refresh_policy: "never", limit: 1, cursor: first.page.next_cursor }, { projectIndex: index });
    assert.equal(changedQuery.ok, false);
    assert.equal(changedQuery.blockers.some((entry) => entry.code === "GENERIC_QUERY_CURSOR_INVALID"), true);
  });

  it("propagates changed_since adapter blockers instead of claiming empty complete", () => {
    const snapshot = freshIndex();
    const adapter = {
      snapshot: () => snapshot,
      changedSince: () => ({
        ok: false,
        blockers: [{ field: "adapter", code: "CHANGE_ADAPTER_BUSY", message: "change adapter busy", recoverable: true }],
        rows: [],
        refs: [],
      }),
    };
    const plan = planAlpha3_2DGenericProjectQuery({ entity: "changed_since", refresh_policy: "never" }, { projectIndex: adapter });
    assert.equal(plan.ok, false);
    assert.deepEqual(plan.rows, []);
    assert.equal(plan.blockers.some((entry) => entry.code === "CHANGE_ADAPTER_BUSY"), true);
    assert.equal(plan.coverage.complete, false);
    assert.notEqual(plan.coverage.status, "complete");
  });

  it("does not claim a definitive empty track or automation result from partial, paged, or unknown coverage", () => {
    for (const entity of ["tracks", "automation"]) {
      for (const coverageStatus of ["partial", "paged", "unknown"]) {
        const index = freshIndex({ empty: true });
        index.freshness_scopes[entity] = {
          ...index.freshness_scopes[entity],
          coverage_status: coverageStatus,
        };

        const plan = planAlpha3_2DGenericProjectQuery({
          entity,
          filters: { name: "not resident" },
          refresh_policy: "if_stale",
          limit: 1,
        }, { projectIndex: index });

        assert.equal(plan.ok, false, `${entity}:${coverageStatus}`);
        assert.deepEqual(plan.rows, [], `${entity}:${coverageStatus}`);
        assert.equal(plan.blockers.some((entry) => entry.code === "INDEX_COVERAGE_INCOMPLETE"), true, `${entity}:${coverageStatus}`);
        assert.equal(plan.coverage.complete, false, `${entity}:${coverageStatus}`);
        assert.equal(plan.coverage.match_status, "no_match_not_definitive", `${entity}:${coverageStatus}`);
        assert.equal(plan.refresh_requests.length > 0, true, `${entity}:${coverageStatus}`);
      }
    }
  });

  it("keeps 14-envelope internal knowledge while compact public pages and exact queries reach the final envelope", () => {
    const index = freshIndex();
    index.rows.envelopes = Array.from({ length: 14 }, (_, offset) => {
      const number = offset + 1;
      return {
        ref: `envelope:track:guid:{AUTO-${number}}:volume`,
        owner_ref: `track:guid:{AUTO-${number}}`,
        parent_kind: "track",
        name: number === 14 ? "Automation Envelope 14 Exact" : `Automation Envelope ${number}`,
        lane_kind: "volume",
        visible: true,
        point_count: number,
        freshness_status: "fresh",
        coverage_status: "complete",
      };
    });
    const firstPage = planAlpha3_2DGenericProjectQuery({
      entity: "automation",
      refresh_policy: "never",
      limit: 2,
    }, { projectIndex: index });
    assert.equal(firstPage.ok, true, JSON.stringify(firstPage.blockers));
    assert.equal(firstPage.rows.length, 2);
    assert.equal(firstPage.page.has_more, true);
    assert.equal(firstPage.coverage.indexed_row_count, 14);
    assert.equal(firstPage.coverage.known_total_row_count, 14);
    assert.equal(firstPage.coverage.public_returned_row_count, 2);
    assert.equal(Buffer.byteLength(JSON.stringify({
      rows: firstPage.rows,
      refs: firstPage.refs,
      coverage: firstPage.coverage,
      page: firstPage.page,
    }), "utf8") < 2_048, true);

    const lastRef = "envelope:track:guid:{AUTO-14}:volume";
    const exactName = planAlpha3_2DGenericProjectQuery({
      entity: "automation",
      filters: { name: "Automation Envelope 14 Exact" },
      refresh_policy: "never",
      limit: 1,
    }, { projectIndex: index });
    assert.equal(exactName.ok, true);
    assert.deepEqual(exactName.refs, [lastRef]);
    assert.equal(exactName.rows[0].name, "Automation Envelope 14 Exact");
    assert.equal(exactName.coverage.indexed_row_count, 14);

    const exactRef = planAlpha3_2DGenericProjectQuery({
      entity: "automation",
      selectors: { refs: [lastRef] },
      refresh_policy: "never",
      limit: 1,
    }, { projectIndex: index });
    assert.equal(exactRef.ok, true);
    assert.deepEqual(exactRef.refs, [lastRef]);

    index.freshness_scopes.automation = { ...index.freshness_scopes.automation, status: "stale" };
    const staleAfterWrite = planAlpha3_2DGenericProjectQuery({
      entity: "automation",
      filters: { name: "Automation Envelope 14 Exact" },
      refresh_policy: "if_stale",
      limit: 1,
    }, { projectIndex: index });
    assert.equal(staleAfterWrite.ok, false);
    assert.deepEqual(staleAfterWrite.rows, []);
    assert.equal(staleAfterWrite.refresh_requests.length > 0, true);
  });

  it("keeps ref hydration opt-in and returns candidate refs even when hydration is not requested", () => {
    const compact = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy: "never", hydrate_refs: false }, { projectIndex: freshIndex() });
    assert.equal(compact.ok, true);
    assert.deepEqual(compact.refs, ["track:guid:{T1}"]);
    assert.equal(compact.hydrate_request, null);
    assert.equal(compact.hydration_truth.status, "not_requested");

    const hydrated = planAlpha3_2DGenericProjectQuery({ entity: "tracks", refresh_policy: "never", hydrate_refs: true }, { projectIndex: freshIndex() });
    assert.equal(hydrated.ok, true);
    assert.equal(hydrated.hydrate_request !== null, true);
    assert.equal(hydrated.refs_truth.sqlite_authorizes_writes, false);
    assert.equal(hydrated.refs_truth.write_requires_live_re_resolution, true);
  });

  it("states marker hydration truth without inventing atomic hydration", () => {
    const plan = planAlpha3_2DGenericProjectQuery({ entity: "markers_regions", refresh_policy: "never", hydrate_refs: true }, { projectIndex: freshIndex() });
    assert.equal(plan.ok, true);
    assert.equal(plan.hydrate_request, null);
    assert.equal(plan.hydration_truth.status, "exact_hydration_unavailable");
    assert.equal(plan.hydration_truth.write_posture, "write_requires_target_template_live_resolution");
    assert.equal(plan.refs_truth.posture, "candidate_refs_from_project_index");
  });

  it("bounds amplification, rejects raw SQL/unknown keys, and does not echo large input", () => {
    const pressure = Array.from({ length: 5000 }, (_, index) => `field_${index}`);
    const plan = planAlpha3_2DGenericProjectQuery({
      entity: "tracks",
      fields: pressure,
      filters: Object.fromEntries(pressure.map((key) => [key, "x"])),
      selectors: { refs: pressure, unknown_selector: "x" },
      raw_sql: "select * from tracks",
      unknown_top_level: pressure,
      cursor: "x".repeat(5000),
      limit: 5000,
    }, { projectIndex: freshIndex() });
    assert.equal(plan.ok, false);
    const codes = new Set(plan.blockers.map((entry) => entry.code));
    assert.equal(codes.has("GENERIC_QUERY_ARRAY_TOO_LARGE"), true);
    assert.equal(codes.has("GENERIC_QUERY_OBJECT_TOO_LARGE"), true);
    assert.equal(codes.has("GENERIC_QUERY_UNKNOWN_FIELD"), true);
    assert.equal(codes.has("RAW_SQL_NOT_ALLOWED"), true);
    assert.equal(codes.has("GENERIC_QUERY_CURSOR_INVALID"), true);
    assert.equal(JSON.stringify(plan).length < 20_000, true);
    assert.equal(JSON.stringify(plan).includes("field_4999"), false);
  });

  it("returns typed blockers for over-depth and over-node filter trees without overflowing the stack", () => {
    let tooDeep = "leaf";
    for (let depth = 0; depth < 20_000; depth += 1) tooDeep = { nested: tooDeep };
    const tooWide = Array.from({ length: 100 }, () => Array.from({ length: 6 }, () => true));

    let plan;
    assert.doesNotThrow(() => {
      plan = planAlpha3_2DGenericProjectQuery({
        entity: "tracks",
        filters: { too_deep: tooDeep, too_wide: tooWide },
        refresh_policy: "never",
      }, { projectIndex: freshIndex() });
    });

    assert.equal(plan.ok, false);
    const codes = new Set(plan.blockers.map((entry) => entry.code));
    assert.equal(codes.has("GENERIC_QUERY_VALUE_DEPTH_EXCEEDED"), true);
    assert.equal(codes.has("GENERIC_QUERY_VALUE_BUDGET_EXCEEDED"), true);
    assert.equal(JSON.stringify(plan).length < 20_000, true);
  });

  it("stages FX refresh from fresh indexed track rows", () => {
    const index = freshIndex();
    index.rows.tracks.push({ ref: "track:guid:{T2}", name: "Bass", index: 1, freshness_status: "fresh", coverage_status: "complete" });
    index.freshness_scopes.fx = { ...index.freshness_scopes.fx, status: "stale" };

    const plan = planAlpha3_2DGenericProjectQuery({ entity: "fx", refresh_policy: "if_stale", limit: 10 }, { projectIndex: index });
    const fxRequests = plan.refresh_requests.filter((request) => request.id === "template.fx.list_track_fx_chain");

    assert.equal(plan.ok, false);
    assert.deepEqual(fxRequests.map((request) => request.refs.track_ref), ["track:guid:{T1}", "track:guid:{T2}"]);
    assert.equal(fxRequests.every((request) => request.tool === "call_template"), true);
  });

  it("stages take refresh from fresh indexed item rows", () => {
    const index = freshIndex();
    index.rows.items.push({ ref: "item:guid:{I2}", track_ref: "track:guid:{T1}", start_seconds: 3, end_seconds: 4, freshness_status: "fresh", coverage_status: "complete" });
    index.freshness_scopes.takes = { ...index.freshness_scopes.takes, status: "stale" };

    const plan = planAlpha3_2DGenericProjectQuery({ entity: "takes", refresh_policy: "if_stale", limit: 10 }, { projectIndex: index });
    const itemRequests = plan.refresh_requests.filter((request) => request.id === "template.items.read_item_summary");

    assert.equal(plan.ok, false);
    assert.deepEqual(itemRequests.map((request) => request.refs.item_ref), ["item:guid:{I1}", "item:guid:{I2}"]);
    assert.equal(itemRequests.every((request) => request.tool === "call_template" && request.input.include_take_summary === true), true);
  });

  it("retains the old plan envelope only as an internal query-planning helper", () => {
    const envelope = createAlpha3_2DGenericProjectQueryRuntimeEnvelope({
      request: { input: { entity: "tracks", refresh_policy: "never" } },
      projectIndex: freshIndex(),
    });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.execution.executed, false);
    assert.equal(envelope.result.execution.child_executor, false);
    assert.equal(envelope.result.execution.live_reaper, false);
    assert.equal(envelope.result.execution.raw_sql, false);
  });
});
