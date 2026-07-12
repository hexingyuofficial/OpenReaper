import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT,
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems,
  createAlpha3_2EMediaPlaceAssetsMacroRuntimeEnvelope,
  planAlpha3_2EMediaPlaceAssetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-media-place-assets-v1.mjs";

describe("Alpha3.2-E media place_assets planner", () => {
  it("publishes an executable registered media-placement Macro", () => {
    const [item] = createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems();
    assert.equal(item.id, ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID);
    assert.equal(item.runnable, true);
    assert.equal(item.execution_shape, "registered_macro_program");
    assert.equal(item.implementation_status, "executable");
    assert.equal(item.support_status, "executable_runtime_bound");
    assert.equal(item.input_schema.required.includes("assets"), true);
  });

  it("returns a dry-run preview without emitting child requests", () => {
    const plan = planAlpha3_2EMediaPlaceAssetsMacro({
      assets: [
        { id: "kick", path: "/Users/Shared/OpenReaper/kick.wav", track_name: "Drums", create_track: true, position_seconds: 0 },
        { id: "loop", path: "/Users/Shared/OpenReaper/loop.wav", track_ref: "track:guid:{DRUMS}", position_seconds: 8, start_percent: 0.25, end_percent: 0.75, region: { name: "Loop", start_seconds: 8, end_seconds: 12 } },
      ],
      dry_run: true,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "dry_run_preview");
    assert.equal(plan.preview.target_counts.assets, 2);
    assert.equal(plan.preview.target_counts.create_tracks, 1);
    assert.equal(plan.preview.target_counts.section_imports, 1);
    assert.equal(plan.preview.target_counts.regions, 1);
    assert.deepEqual(plan.child_requests, []);
    assert.equal(plan.safety.server_executes_children, false);
    assert.equal(plan.safety.source_media_deleted, false);
  });

  it("emits probe, track, import, optional region, and readback requests when dry_run is false", () => {
    const plan = planAlpha3_2EMediaPlaceAssetsMacro({
      assets: [
        { id: "kick", path: "/Users/Shared/OpenReaper/kick.wav", track_name: "Drums", create_track: true, position_seconds: 0 },
        { id: "loop", path: "/Users/Shared/OpenReaper/loop.wav", track_ref: "track:guid:{DRUMS}", position_seconds: 8, start_percent: 0.25, end_percent: 0.75, region: { name: "Loop", start_seconds: 8, end_seconds: 12, color: "#3366CC" } },
      ],
      dry_run: false,
    });
    assert.equal(plan.ok, true);
    assert.deepEqual(plan.preflight_requests.map((request) => request.id), [
      "template.media.probe_file",
      "template.media.probe_file",
      "template.tracks.resolve_track_ref",
    ]);
    assert.deepEqual(plan.mutation_requests.map((request) => request.id), [
      "template.tracks.create_track",
      "template.media.import_file_to_track",
      "template.media.import_file_section_to_track",
      "template.project.create_region",
    ]);
    assert.equal(plan.mutation_requests[1].refs.track_ref, "track:planned:kick");
    assert.equal(plan.mutation_requests[1].refs.source_file_ref, "file:planned:kick");
    assert.equal(Object.hasOwn(plan.mutation_requests[1].refs, "file_ref"), false);
    assert.equal(plan.mutation_requests[2].refs.track_ref, "track:guid:{DRUMS}");
    assert.equal(plan.mutation_requests[2].refs.source_file_ref, "file:planned:loop");
    assert.equal(plan.mutation_requests[0].produces_local_id, "kick");
    assert.equal(plan.mutation_requests[1].produces_local_id, "kick");
    assert.equal(plan.mutation_requests[2].produces_local_id, "loop");
    assert.equal(plan.readback_requests.filter((request) => request.id === "template.items.read_item_summary").length, 2);
    assert.equal(plan.readback_requests.some((request) => request.id === "template.media.read_take_source"), false);
    assert.equal(plan.preview.local_ref_map.kick.take_ref, undefined);
    assert.equal(plan.readback_requests.some((request) => request.id === "macro.project.query"), true);
    assert.equal(plan.child_requests.length, plan.preflight_requests.length + plan.mutation_requests.length + plan.readback_requests.length);
  });

  it("fails closed for unsafe paths, ambiguous selectors, source deletion, take rename, and unsupported idempotency", () => {
    const plan = planAlpha3_2EMediaPlaceAssetsMacro({
      assets: [
        { id: "a", path: "https://example.com/a.wav", track_ref: "track:guid:{A}", track_name: "A", create_track: true, position_seconds: -1, delete_source_media: true, take_name: "Nice" },
        { id: "a", path: "/dev/audio", position_seconds: 0 },
      ],
      unknown: true,
    }, { idempotency_key_present: true });
    const codes = plan.blockers.map((entry) => entry.code);
    assert.equal(plan.ok, false);
    assert.equal(codes.includes("MEDIA_INPUT_UNKNOWN_FIELD"), true);
    assert.equal(codes.includes("MEDIA_SOURCE_PATH_UNSAFE"), true);
    assert.equal(codes.includes("MEDIA_TRACK_SELECTOR_AMBIGUOUS"), true);
    assert.equal(codes.includes("MEDIA_SOURCE_DELETE_FORBIDDEN"), true);
    assert.equal(codes.includes("MEDIA_TAKE_RENAME_NOT_BOUND"), true);
    assert.equal(codes.includes("MEDIA_ASSET_ID_DUPLICATE"), true);
    assert.equal(codes.includes("MEDIA_TRACK_TARGET_REQUIRED"), true);
    assert.equal(codes.includes("MEDIA_POSITION_INVALID"), true);
    assert.equal(codes.includes("MEDIA_PLACE_ASSETS_IDEMPOTENCY_KEY_UNSUPPORTED"), true);
    assert.deepEqual(plan.child_requests, []);
  });

  it("wraps placement plans in runtime envelopes without executing children", () => {
    const preview = planAlpha3_2EMediaPlaceAssetsMacro({ assets: [{ id: "one", path: "/Users/Shared/OpenReaper/one.wav", track_ref: "track:guid:{ONE}", position_seconds: 1 }] });
    const envelope = createAlpha3_2EMediaPlaceAssetsMacroRuntimeEnvelope({ request: { id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, input: {} }, plan: preview, now: () => new Date("2026-07-11T00:00:00Z") });
    assert.equal(envelope.ok, true);
    assert.equal(envelope.result.contract, ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_CONTRACT);
    assert.equal(envelope.result.executed, false);
    assert.equal(envelope.result.execution.executor_call_count, 0);
    assert.equal(envelope.result.execution.source_media_deleted, false);
  });
});
