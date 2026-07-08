import { performance } from "node:perf_hooks";
import {
  createAlpha3C3ProjectIndex,
} from "./alpha3-c3-project-index-store-v1.mjs";
import {
  ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY,
  planAlpha3C3ProjectIndexQueryMacro,
} from "./alpha3-c3-project-index-query-v1.mjs";

export const ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT = "alpha3.c3.project_index_benchmark.v1";

const DEFAULT_SHAPE = Object.freeze({
  track_count: 200,
  items_per_track: 8,
  fx_per_track: 3,
  sends_per_track: 2,
  envelopes_per_track: 2,
  markers: 48,
  media_sources: 120,
});

export function createAlpha3C3LargeProjectBenchmarkFixture(options = {}) {
  const shape = normalizeShape(options.shape);
  const observedAt = options.observed_at ?? "2026-07-08T02:30:00.000Z";
  const snapshotId = options.snapshot_id ?? "snapshot:c3:block4:benchmark";
  const projectIndex = createAlpha3C3ProjectIndex({
    projectRef: "project:alpha3-block4",
    bridgeOwner: "openreaper-alpha3-local",
    bridgeGeneration: 1,
    sessionId: "session:alpha3-block4-benchmark",
    now: () => new Date(observedAt),
  });

  projectIndex.open({
    project_ref: "project:alpha3-block4",
    bridge_owner: "openreaper-alpha3-local",
    bridge_generation: 1,
    session_id: "session:alpha3-block4-benchmark",
    observed_at: observedAt,
  });

  const tracks = [];
  const items = [];
  const takes = [];
  const fx = [];
  const sends = [];
  const envelopes = [];
  const markers_regions = [];
  const media_sources = [];
  const selectionRows = [];
  const changes = [];

  for (let trackIndex = 0; trackIndex < shape.track_count; trackIndex += 1) {
    const trackRef = trackRefAt(trackIndex);
    const selected = trackIndex < 12;
    tracks.push({
      ref: trackRef,
      owner_ref: "project:alpha3-block4",
      name: `Track ${String(trackIndex + 1).padStart(3, "0")}`,
      index: trackIndex,
      display_number: String(trackIndex + 1),
      selected,
      folder_depth: trackIndex % 16 === 0 ? 1 : trackIndex % 16 === 15 ? -1 : 0,
      item_count: shape.items_per_track,
      fx_count: shape.fx_per_track,
      send_count: shape.sends_per_track,
      summary: {
        role: trackIndex % 8 === 0 ? "drums" : trackIndex % 5 === 0 ? "bus" : "instrument",
      },
    });
    if (selected) selectionRows.push({ scope_kind: "track", ref: trackRef, owner_ref: "project:alpha3-block4" });
    changes.push({
      change_id: `change:block4:track:${trackIndex}`,
      ref: trackRef,
      owner_ref: "project:alpha3-block4",
      change_kind: trackIndex % 3 === 0 ? "readback_applied" : "indexed",
      observed_at: observedAt,
      summary: { benchmark_fixture: true },
    });

    for (let itemIndex = 0; itemIndex < shape.items_per_track; itemIndex += 1) {
      const itemRef = itemRefAt(trackIndex, itemIndex);
      const takeRef = takeRefAt(trackIndex, itemIndex);
      const start = itemIndex * 2 + (trackIndex % 4) * 0.125;
      const selectedItem = trackIndex < 6 && itemIndex < 2;
      const mediaRef = mediaRefAt((trackIndex * shape.items_per_track + itemIndex) % shape.media_sources);
      items.push({
        ref: itemRef,
        owner_ref: trackRef,
        track_ref: trackRef,
        start_seconds: start,
        end_seconds: start + 1.5,
        selected: selectedItem,
        summary: { take_ref: takeRef, media_ref: mediaRef },
      });
      takes.push({
        ref: takeRef,
        owner_ref: itemRef,
        item_ref: itemRef,
        track_ref: trackRef,
        active: true,
        selected: selectedItem,
        source_kind: "audio",
        source_ref: mediaRef,
        playrate: 1,
        has_take_fx: itemIndex % 5 === 0,
        summary: { track_ref: trackRef, media_ref: mediaRef },
      });
      if (selectedItem) {
        selectionRows.push({ scope_kind: "item", ref: itemRef, owner_ref: trackRef });
        selectionRows.push({ scope_kind: "take", ref: takeRef, owner_ref: itemRef });
      }
    }

    for (let fxIndex = 0; fxIndex < shape.fx_per_track; fxIndex += 1) {
      const fxRef = fxRefAt(trackIndex, fxIndex);
      const stock = fxIndex % 2 === 0;
      fx.push({
        ref: fxRef,
        owner_ref: trackRef,
        plugin_name: stock ? (fxIndex === 0 ? "ReaEQ" : "ReaComp") : "Vital",
        plugin_id: stock ? (fxIndex === 0 ? "reaeq" : "reacomp") : "vital",
        slot_index: fxIndex,
        bypassed: false,
        summary: {
          stock_plugin: stock,
          offline: false,
          parameter_summary_available: stock,
        },
      });
      if (trackIndex < 4 && fxIndex === 0) selectionRows.push({ scope_kind: "fx", ref: fxRef, owner_ref: trackRef });
    }

    for (let sendIndex = 0; sendIndex < shape.sends_per_track; sendIndex += 1) {
      const destinationIndex = (trackIndex + sendIndex + 1) % shape.track_count;
      sends.push({
        ref: sendRefAt(trackIndex, sendIndex),
        owner_ref: trackRef,
        source_track_ref: trackRef,
        destination_track_ref: trackRefAt(destinationIndex),
        send_index: sendIndex,
        send_kind: sendIndex === 0 ? "track_send" : "sidechain",
        volume_db: sendIndex === 0 ? -6 : -12,
        pan: sendIndex === 0 ? 0 : -0.25,
        send_mode: "post_fader",
      });
    }

    for (let envelopeIndex = 0; envelopeIndex < shape.envelopes_per_track; envelopeIndex += 1) {
      const targetRef = envelopeIndex === 0 ? trackRef : fxRefAt(trackIndex, 0);
      envelopes.push({
        ref: envelopeRefAt(trackIndex, envelopeIndex),
        owner_ref: trackRef,
        target_ref: targetRef,
        parent_kind: envelopeIndex === 0 ? "track" : "fx",
        name: envelopeIndex === 0 ? "Volume" : "Wet",
        lane_kind: envelopeIndex === 0 ? "volume" : "fx_parameter",
        active: true,
        armed: envelopeIndex % 2 === 0,
        visible: trackIndex % 3 === 0,
        point_count: 4 + (trackIndex % 9),
      });
    }
  }

  for (let markerIndex = 0; markerIndex < shape.markers; markerIndex += 1) {
    const isRegion = markerIndex % 3 === 0;
    markers_regions.push({
      ref: isRegion ? `region:guid:{BLOCK4-REGION-${markerIndex}}` : `marker:guid:{BLOCK4-MARKER-${markerIndex}}`,
      marker_kind: isRegion ? "region" : "marker",
      position_seconds: markerIndex * 8,
      end_seconds: isRegion ? markerIndex * 8 + 4 : null,
      name: isRegion ? `Region ${markerIndex}` : `Marker ${markerIndex}`,
      index: markerIndex,
    });
  }

  for (let mediaIndex = 0; mediaIndex < shape.media_sources; mediaIndex += 1) {
    media_sources.push({
      ref: mediaRefAt(mediaIndex),
      name: mediaIndex % 2 === 0 ? `Loop_${mediaIndex}.wav` : `Vox_${mediaIndex}.flac`,
      media_type: "audio",
      source_kind: "audio",
      extension: mediaIndex % 2 === 0 ? "wav" : "flac",
      offline: mediaIndex % 17 === 0,
      length_seconds: 1 + (mediaIndex % 32),
      channel_count: mediaIndex % 3 === 0 ? 1 : 2,
      metadata_key_count: 5,
    });
  }

  const replaceOptions = {
    snapshot_id: snapshotId,
    observed_at: observedAt,
    freshness_status: "fresh",
    coverage_status: "paged",
    payload_ref: "artifact:block4:benchmark-fixture",
  };
  projectIndex.replaceTracks({ ...replaceOptions, coverage_status: "complete", rows: tracks });
  projectIndex.replaceItems({ ...replaceOptions, rows: items });
  projectIndex.replaceTakes({ ...replaceOptions, rows: takes });
  projectIndex.replaceFx({ ...replaceOptions, rows: fx });
  projectIndex.replaceSends({ ...replaceOptions, rows: sends });
  projectIndex.replaceEnvelopes({ ...replaceOptions, rows: envelopes });
  projectIndex.replaceMarkersRegions({ ...replaceOptions, coverage_status: "complete", rows: markers_regions });
  projectIndex.replaceMediaSources({ ...replaceOptions, rows: media_sources });
  projectIndex.replaceSelection({
    ...replaceOptions,
    coverage_status: "selected_only",
    rows: selectionRows,
  });
  projectIndex.recordObjectChanges({
    snapshot_id: snapshotId,
    observed_at: observedAt,
    changes,
  });

  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT,
    projectIndex,
    shape,
    snapshot_id: snapshotId,
    observed_at: observedAt,
    row_counts: rowCounts(projectIndex.snapshot()),
  });
}

export function runAlpha3C3ProjectIndexBenchmark(options = {}) {
  const fixture = options.fixture ?? createAlpha3C3LargeProjectBenchmarkFixture(options);
  const projectIndex = fixture.projectIndex;
  const start = performance.now();
  const operations = [
    runOperation("head", "macro.index_status", { limit: 1 }, projectIndex),
    runOperation("selection", "macro.selected_context", { scope: "selection", limit: 20 }, projectIndex),
    runOperation("structure", "macro.query_tracks", {
      limit: 25,
      fields: ["name", "index", "item_count", "fx_count", "send_count"],
    }, projectIndex),
    runOperation("structure", "macro.query_routing", {
      limit: 25,
      filters: { source_track_ref: trackRefAt(0) },
      fields: ["destination_track_ref", "send_kind", "volume_db"],
    }, projectIndex),
    runOperation("structure", "macro.query_automation", {
      limit: 25,
      filters: { visible: true, has_points: true },
      fields: ["owner_ref", "name", "lane_kind", "point_count"],
    }, projectIndex),
    runOperation("query", "macro.query_items", {
      scope: "tracks",
      limit: 25,
      filters: { track_ref: trackRefAt(0) },
      fields: ["track_ref", "start_seconds", "length_seconds"],
    }, projectIndex),
    runOperation("query", "macro.query_takes", {
      scope: "items",
      limit: 25,
      filters: { active: true },
      fields: ["item_ref", "source_kind", "source_ref", "has_take_fx"],
    }, projectIndex),
    runOperation("query", "macro.query_fx", {
      limit: 25,
      filters: { stock_plugin: true },
      fields: ["owner_ref", "plugin_name", "slot_index", "stock_plugin"],
    }, projectIndex),
    runOperation("query", "macro.query_markers", {
      limit: 25,
      filters: { marker_kind: "region" },
      time_range: { start_seconds: 0, end_seconds: 180 },
    }, projectIndex),
    runOperation("query", "macro.query_media", {
      limit: 25,
      filters: { media_type: "audio", offline: false },
      fields: ["name", "media_type", "extension", "offline"],
    }, projectIndex),
    runOperation("hydrate", "macro.hydrate_refs", {
      refs: [
        trackRefAt(0),
        itemRefAt(0, 0),
        takeRefAt(0, 0),
        fxRefAt(0, 0),
        sendRefAt(0, 0),
        envelopeRefAt(0, 0),
        mediaRefAt(0),
      ],
      detail: "summary",
      limit: 25,
    }, projectIndex),
    runOperation("changed_since", "macro.changed_since", {
      since: "2026-07-08T02:00:00.000Z",
      limit: 25,
    }, projectIndex),
  ];
  const elapsedMs = Number((performance.now() - start).toFixed(3));
  const hardGate = benchmarkHardGate({ fixture, operations, elapsedMs });
  return deepFreeze({
    contract: ALPHA3_C3_PROJECT_INDEX_BENCHMARK_CONTRACT,
    mode: "static_large_project_query_flow_benchmark",
    project_shape: fixture.shape,
    row_counts: fixture.row_counts,
    operations,
    timings_ms: {
      total: elapsedMs,
      per_operation: operations.map((operation) => ({
        id: operation.id,
        group: operation.group,
        elapsed_ms: operation.elapsed_ms,
      })),
    },
    round_trip_model: roundTripModel(fixture, operations),
    customer_flow: customerFlowSummary(operations),
    trial_officer: trialOfficerScore(operations, hardGate),
    hard_gate: hardGate,
    discovery: {
      macro_surface: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.macro_ids,
      tool_surface_added_tools: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.tool_surface.added_tools,
      execution_tool: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.tool_surface.execution_tool,
      storage_role: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.storage.cache_role,
      truth_source: ALPHA3_C3_PROJECT_INDEX_DISCOVERY_SUMMARY.storage.truth_source,
    },
    execution: {
      live_reaper: false,
      safe_write: false,
      hidden_executor: false,
      public_call_recipe: false,
      raw_sql_user_input: false,
      support_claim: "static_product_flow_benchmark_only",
    },
  });
}

function runOperation(group, id, input, projectIndex) {
  const start = performance.now();
  const plan = planAlpha3C3ProjectIndexQueryMacro(id, input, { projectIndex });
  const elapsedMs = Number((performance.now() - start).toFixed(3));
  return {
    group,
    id,
    ok: plan.ok,
    elapsed_ms: elapsedMs,
    rows: Array.isArray(plan.rows) ? plan.rows.length : 0,
    refs: Array.isArray(plan.refs) ? plan.refs.length : 0,
    blockers: plan.blockers.map((blocker) => blocker.code),
    refresh_requests: plan.refresh_requests.map((request) => request.id),
    hydrate_status: plan.hydrate_request?.status ?? null,
    hydrate_request_count: Array.isArray(plan.hydrate_request?.requests) ? plan.hydrate_request.requests.length : 0,
    page: {
      has_more: Boolean(plan.page?.has_more),
      next_cursor: plan.page?.next_cursor ?? null,
    },
    decision_summary: plan.decision_summary,
    response_bytes: byteLength(plan),
  };
}

function benchmarkHardGate({ fixture, operations, elapsedMs }) {
  const failures = [];
  if (fixture.shape.track_count < 200) failures.push("shape_must_include_at_least_200_tracks");
  if (!operations.every((operation) => operation.ok)) failures.push("all_core_query_operations_must_plan_successfully");
  if (operations.some((operation) => operation.response_bytes > 65_536)) failures.push("operation_response_over_budget");
  if (elapsedMs > 2_000) failures.push("static_query_flow_too_slow_for_local_index");
  if (!operations.some((operation) => operation.group === "hydrate" && operation.hydrate_request_count >= 7)) {
    failures.push("hydrate_refs_must_plan_representative_exact_reads");
  }
  return {
    accepted: failures.length === 0,
    failures,
    thresholds: {
      min_track_count: 200,
      max_operation_response_bytes: 65_536,
      max_total_static_ms: 2_000,
      min_hydrate_request_count: 7,
    },
  };
}

function roundTripModel(fixture, operations) {
  const naiveReads = fixture.row_counts.tracks
    + fixture.row_counts.items
    + fixture.row_counts.takes
    + fixture.row_counts.fx
    + fixture.row_counts.sends
    + fixture.row_counts.envelopes
    + fixture.row_counts.markers_regions
    + fixture.row_counts.media_sources;
  const productTurns = operations.length;
  const reductionFactor = Number((naiveReads / Math.max(1, productTurns)).toFixed(1));
  return {
    naive_atomic_read_estimate: naiveReads,
    product_macro_turns: productTurns,
    reduction_factor: reductionFactor,
    meets_3x_target: reductionFactor >= 3,
    note: "Static estimate compares one-row atomic reading against compact query/hydrate macro turns.",
  };
}

function customerFlowSummary(operations) {
  return {
    status: operations.every((operation) => operation.ok) ? "static_ready_no_live_claim" : "blocked",
    steps: [
      "refresh_task_scope_from_reaper",
      "query_compact_rows_by_scope_filter_limit_cursor",
      "hydrate_refs_only_when_detail_is_needed",
      "before_write_reresolve_in_reaper",
      "after_write_batch_readback_then_update_index",
    ],
    friction_removed: [
      "no_full_project_dump_required",
      "no_user_sql_or_cache_truth_decisions",
      "no_manual_row_hunting_before_hydrate_refs",
      "bounded_paging_and_response_budget",
    ],
  };
}

function trialOfficerScore(operations, hardGate) {
  const allOk = operations.every((operation) => operation.ok);
  const noOversize = operations.every((operation) => operation.response_bytes <= 65_536);
  const hydrateOk = operations.some((operation) => operation.group === "hydrate" && operation.ok);
  return {
    reviewer: "static_trial_officer",
    verdict: hardGate.accepted ? "accept_block4_static_flow" : "fix_before_acceptance",
    scores: {
      convenience: allOk ? 4 : 2,
      speed: hardGate.accepted ? 5 : 3,
      trust: noOversize ? 4 : 2,
      safety_annoyance: 4,
      recovery: hydrateOk ? 4 : 2,
      product_fit: hardGate.accepted ? 4 : 3,
    },
    p0_p1_findings: hardGate.failures,
    p2_findings: [
      "Broader live/customer evidence still belongs to bounded REAPER windows.",
      "SQLite benchmark is local product-flow evidence, not a support-matrix promotion.",
    ],
  };
}

function rowCounts(snapshot) {
  return Object.fromEntries(
    Object.entries(snapshot.rows).map(([key, rows]) => [key, Array.isArray(rows) ? rows.length : 0]),
  );
}

function normalizeShape(input = {}) {
  return {
    track_count: positiveInteger(input.track_count, DEFAULT_SHAPE.track_count),
    items_per_track: positiveInteger(input.items_per_track, DEFAULT_SHAPE.items_per_track),
    fx_per_track: positiveInteger(input.fx_per_track, DEFAULT_SHAPE.fx_per_track),
    sends_per_track: positiveInteger(input.sends_per_track, DEFAULT_SHAPE.sends_per_track),
    envelopes_per_track: positiveInteger(input.envelopes_per_track, DEFAULT_SHAPE.envelopes_per_track),
    markers: positiveInteger(input.markers, DEFAULT_SHAPE.markers),
    media_sources: positiveInteger(input.media_sources, DEFAULT_SHAPE.media_sources),
  };
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function trackRefAt(index) {
  return `track:guid:{BLOCK4-TRACK-${String(index).padStart(3, "0")}}`;
}

function itemRefAt(trackIndex, itemIndex) {
  return `item:guid:{BLOCK4-T${String(trackIndex).padStart(3, "0")}-I${String(itemIndex).padStart(2, "0")}}`;
}

function takeRefAt(trackIndex, itemIndex) {
  return `take:guid:{BLOCK4-T${String(trackIndex).padStart(3, "0")}-K${String(itemIndex).padStart(2, "0")}}`;
}

function fxRefAt(trackIndex, fxIndex) {
  return `fx:track:guid:{BLOCK4-TRACK-${String(trackIndex).padStart(3, "0")}}:${fxIndex}`;
}

function sendRefAt(trackIndex, sendIndex) {
  return `send:track:guid:{BLOCK4-TRACK-${String(trackIndex).padStart(3, "0")}}:${sendIndex}`;
}

function envelopeRefAt(trackIndex, envelopeIndex) {
  return envelopeIndex === 0
    ? `envelope:track:guid:{BLOCK4-TRACK-${String(trackIndex).padStart(3, "0")}}:volume`
    : `envelope:fx:track:guid:{BLOCK4-TRACK-${String(trackIndex).padStart(3, "0")}}:0:wet`;
}

function mediaRefAt(index) {
  return `file:path:/tmp/openreaper-block4/media/${index % 2 === 0 ? "Loop" : "Vox"}_${String(index).padStart(3, "0")}.${index % 2 === 0 ? "wav" : "flac"}`;
}

function byteLength(value) {
  return Buffer.byteLength(JSON.stringify(value), "utf8");
}

function deepFreeze(value) {
  if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
