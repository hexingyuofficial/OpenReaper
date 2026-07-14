import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge as RuntimeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
  ALPHA3_3_MEDIA_PLACE_ASSETS_MODES,
  ALPHA3_3_MEDIA_PLACEMENT_MODES,
  ALPHA3_3_MEDIA_TRACK_POLICIES,
  ALPHA3_3_MEDIA_PLACE_ASSETS_REGISTRY,
  createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems,
  createAlpha3_3MediaPlaceAssetsExactManual,
  executeAlpha3_3MediaPlaceAssetsMacro,
  planAlpha3_2EMediaPlaceAssetsMacro,
} from "../../packages/mcp-server/src/alpha3-2e-media-place-assets-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const TRACK_A = "track:guid:{MEDIA-TRACK-A}";
const TRACK_B = "track:guid:{MEDIA-TRACK-B}";
const TAKE_A = "take:guid:{MEDIA-TAKE-A}";

describe("Alpha3.3 media.place_assets registered Macro", () => {
  it("publishes one executable registry entry with exact modes, policies, schema, and manual", () => {
    assert.deepEqual(ALPHA3_3_MEDIA_PLACE_ASSETS_REGISTRY.ids, [ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID]);
    assert.deepEqual(ALPHA3_3_MEDIA_PLACE_ASSETS_MODES, ["place_assets", "relink_sources"]);
    assert.deepEqual(ALPHA3_3_MEDIA_PLACEMENT_MODES, ["explicit", "sequence_on_one_track", "stack_on_separate_tracks", "columns", "append_after_existing"]);
    assert.deepEqual(ALPHA3_3_MEDIA_TRACK_POLICIES, ["existing_track", "one_shared_new_track", "one_new_track_per_asset", "explicit_per_asset"]);
    const [item] = createAlpha3_2EMediaPlaceAssetsMacroDiscoveryItems();
    assert.equal(item.input_schema.properties.assets.maxItems, 8);
    assert.equal(item.implementation_status, "executable");
    assert.match(createAlpha3_3MediaPlaceAssetsExactManual().action_manual.readback_steps.join(" "), /Every imported Item/i);
  });

  it("probes every asset before dry-run layout and emits no mutation", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1.5, "/b.wav": 2 }, tracks: { [TRACK_A]: [] } });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "sequence_on_one_track", start_seconds: 1, gap_seconds: 0.25 }, track_policy: "existing_track", track_ref: TRACK_A }),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.deepEqual(response.result.data.layout.map((row) => row.position_seconds), [1, 2.75]);
    assert.deepEqual(fixture.calls.slice(0, 2).map((call) => call.id), ["template.media.probe_file", "template.media.probe_file"]);
    assert.equal(fixture.calls.some((call) => call.id === "template.media.import_file_to_track"), false);
    assert.equal(response.result.changes.every((row) => row.mutation.status === "not_run"), true);
  });

  it("imports explicit rows only after all probes/resolves and requires per-asset Item/source readback", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 2 }, tracks: { [TRACK_A]: [], [TRACK_B]: [] } });
    const index = fakeIndex();
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav", track_ref: TRACK_A, position_seconds: 2 }, { id: "b", path: "/b.wav", track_ref: TRACK_B, position_seconds: 4, start_percent: 0.25, end_percent: 0.75 }], placement: { mode: "explicit" }, track_policy: "explicit_per_asset", dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: index,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    const firstMutation = fixture.calls.findIndex((call) => call.id.startsWith("template.media.import_"));
    assert.equal(firstMutation > fixture.calls.findLastIndex((call) => call.id === "template.tracks.resolve_track_ref"), true);
    assert.deepEqual(response.result.changes.map((row) => row.status), ["applied", "applied"]);
    assert.equal(response.result.changes.every((row) => row.live_readback.status === "passed"), true);
    assert.equal(fixture.items[0].length_seconds, 1);
    assert.equal(fixture.items[1].length_seconds, 1);
    assert.deepEqual(index.scopes, ["tracks", "items", "takes", "media"]);
  });

  it("supports stack, columns, shared-new, and per-asset-new deterministic layouts", async () => {
    const stack = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 2 } });
    const stackResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "stack_on_separate_tracks", start_seconds: 3 }, track_policy: "one_new_track_per_asset", new_track: { name_prefix: "Layer" }, dry_run: false }),
      executeAtomic: stack.execute,
    });
    assert.equal(stackResponse.ok, true, JSON.stringify(stackResponse));
    assert.deepEqual(stack.items.map((item) => item.position_seconds), [3, 3]);
    assert.equal(new Set(stack.items.map((item) => item.track_ref)).size, 2);

    const columns = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 2, "/c.wav": 3 }, tracks: { [TRACK_A]: [] } });
    const columnResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }, { id: "c", path: "/c.wav" }], placement: { mode: "columns", start_seconds: 0, columns: 2, column_gap_seconds: 0.5 }, track_policy: "one_shared_new_track", new_track: { name: "Columns" } }),
      executeAtomic: columns.execute,
    });
    assert.equal(columnResponse.ok, true, JSON.stringify(columnResponse));
    assert.deepEqual(columnResponse.result.data.layout.map((row) => row.position_seconds), [0, 3.5, 0]);
  });

  it("reports each new-Track setup mutation and invalidates after a later Track create failure", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 1 } }, { failTrackCreateAt: 2 });
    const index = fakeIndex();
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "stack_on_separate_tracks" }, track_policy: "one_new_track_per_asset", new_track: { name_prefix: "Stem" }, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: index,
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.result.changes[0].setup_kind, "track");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[1].mutation.status, "unknown_or_partial");
    assert.equal(response.result.changes[1].live_readback.status, "not_run");
    assert.equal(response.result.changes[1].live_readback.blocker_code, "TRACK_CREATE_FAILED");
    assert.deepEqual(response.result.changes.slice(2).map((row) => row.status), ["not_run", "not_run"]);
    assert.deepEqual(index.scopes, ["tracks", "items", "takes", "media"]);
  });

  it("does not call a created Track applied when exact name readback mismatches", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1 } }, { mismatchCreatedTrackName: true });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }], placement: { mode: "sequence_on_one_track" }, track_policy: "one_shared_new_track", new_track: { name: "Music" }, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MEDIA_CREATED_TRACK_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].status, "pending");
    assert.equal(response.result.changes[0].live_readback.status, "failed");
  });

  it("tracks Region setup separately and requires the exact returned Region ref", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: [] } }, { mismatchCreatedRegionRef: true });
    const index = fakeIndex();
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav", region: { name: "Intro" } }], placement: { mode: "sequence_on_one_track", start_seconds: 2 }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: index,
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MEDIA_REGION_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[1].setup_kind, "region");
    assert.equal(response.result.changes[1].mutation.status, "completed");
    assert.equal(response.result.changes[1].live_readback.status, "failed");
    assert.equal(index.scopes.includes("markers"), true);
  });

  it("blocks incomplete Region inventory before the first mutation even when truncated is false", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: [] } }, { mismatchRegionCountBeforeCreate: true });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav", region: { name: "Intro" } }], placement: { mode: "sequence_on_one_track" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: fixture.execute,
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.code, "MEDIA_REGION_COVERAGE_INCOMPLETE");
    assert.equal(fixture.calls.some((call) => call.id === "template.project.create_region" || call.id.startsWith("template.media.import_")), false);
  });

  it("marks failed setup readback explicitly and preserves the original live read blocker", async () => {
    const trackFixture = mediaFixture({ files: { "/a.wav": 1 } }, { failCreatedTrackResolve: true });
    const trackResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }], placement: { mode: "sequence_on_one_track" }, track_policy: "one_shared_new_track", new_track: { name: "Music" }, dry_run: false }),
      executeAtomic: trackFixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(trackResponse.error.code, "TRACK_RESOLVE_READ_FAILED");
    assert.equal(trackResponse.result.changes[0].mutation.status, "completed");
    assert.deepEqual(trackResponse.result.changes[0].live_readback, { status: "failed", blocker_code: "TRACK_RESOLVE_READ_FAILED", source: "template.tracks.resolve_track_ref" });

    const regionFixture = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: [] } }, { failRegionListAfterCreate: true });
    const regionResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav", region: { name: "Intro" } }], placement: { mode: "sequence_on_one_track" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: regionFixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    const regionChange = regionResponse.result.changes.find((row) => row.setup_kind === "region");
    assert.equal(regionResponse.error.code, "REGION_INVENTORY_READ_FAILED");
    assert.equal(regionChange.mutation.status, "completed");
    assert.deepEqual(regionChange.live_readback, { status: "failed", blocker_code: "REGION_INVENTORY_READ_FAILED", source: "template.project.list_markers_regions" });
  });

  it("verifies successful Regions by exact create ref and stays within the public envelope budget", async () => {
    const assets = Array.from({ length: 8 }, (_, index) => ({ id: `asset-${index}`, path: `/${index}.wav`, region: { name: `Region ${index}` } }));
    const files = Object.fromEntries(assets.map((asset) => [asset.path, 1]));
    const fixture = mediaFixture({ files });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets, placement: { mode: "stack_on_separate_tracks", start_seconds: 4 }, track_policy: "one_new_track_per_asset", new_track: { name_prefix: "Asset" }, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    const regionChanges = response.result.changes.filter((row) => row.setup_kind === "region");
    assert.equal(regionChanges.length, 8);
    assert.equal(regionChanges.every((row) => row.status === "applied" && row.target_ref === row.live_readback.region_ref), true);
    assert.equal(response.budget.actual_bytes <= response.budget.max_bytes, true);
    assert.equal(response.budget.actual_bytes, Buffer.byteLength(JSON.stringify(response), "utf8"));
  });

  it("uses complete live Track Item facts for append and fails closed on truncation", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 2 }, tracks: { [TRACK_A]: [{ position_seconds: 0, length_seconds: 4 }] } });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "append_after_existing", gap_seconds: 0.5 }, track_policy: "existing_track", track_ref: TRACK_A }),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(response.result.data.layout.map((row) => row.position_seconds), [4.5, 6]);

    const crowded = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: Array.from({ length: 129 }, (_, index) => ({ position_seconds: index, length_seconds: 1 })) } });
    const blocked = await executeAlpha3_3MediaPlaceAssetsMacro({ request: request({ assets: [{ id: "a", path: "/a.wav" }], placement: { mode: "append_after_existing" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }), executeAtomic: crowded.execute });
    assert.equal(blocked.ok, false);
    assert.equal(blocked.error.code, "MEDIA_APPEND_COVERAGE_INCOMPLETE");
    assert.equal(crowded.calls.some((call) => call.id.startsWith("template.media.import_")), false);
  });

  it("relinks exact Takes only after all probes/read preflight and proves the exact replacement source", async () => {
    const fixture = mediaFixture({ files: { "/new.wav": 2 }, takes: { [TAKE_A]: "file:path:/old.wav" } });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ mode: "relink_sources", assets: [{ id: "new", path: "/new.wav", take_ref: TAKE_A }], dry_run: false }),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(fixture.takes[TAKE_A], "file:path:/new.wav");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.source_file_ref, "file:path:/new.wav");
  });

  it("holds folder selection at its unproven approval boundary and rejects unsafe/oversized/conflicting requests", async () => {
    for (const [input, code] of [
      [{ folder_ref: "folder:path:/tmp", assets: [{ path: "/a.wav", track_ref: TRACK_A, position_seconds: 0 }] }, "MEDIA_FOLDER_APPROVAL_UNPROVEN"],
      [{ assets: [{ path: "/dev/audio", track_ref: TRACK_A, position_seconds: 0 }] }, "MEDIA_SOURCE_PATH_UNSAFE"],
      [{ assets: Array.from({ length: 9 }, (_, index) => ({ path: `/${index}.wav`, track_ref: TRACK_A, position_seconds: 0 })) }, "MEDIA_ASSETS_INVALID"],
      [{ assets: [{ path: "/a.wav", track_ref: TRACK_A, position_seconds: 0, delete_source_media: true }] }, "MEDIA_SOURCE_DELETE_FORBIDDEN"],
      [{ assets: [{ path: "/a.wav", track_ref: TRACK_A }], placement: { mode: "stack_on_separate_tracks" }, track_policy: "existing_track", track_ref: TRACK_A }, "MEDIA_STACK_SEPARATE_TRACKS_REQUIRED"],
    ]) {
      let calls = 0;
      const response = await executeAlpha3_3MediaPlaceAssetsMacro({ request: request(input), executeAtomic: async () => { calls += 1; } });
      assert.equal(response.ok, false, code);
      assert.equal(response.error.code, code);
      assert.equal(calls, 0);
    }
  });

  it("blocks unprovable Region color and over-budget results before the first mutation", async () => {
    const colorFixture = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: [] } });
    const colorResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav", position_seconds: 0, region: { name: "Intro", color: "#112233" } }], placement: { mode: "explicit" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: colorFixture.execute,
    });
    assert.equal(colorResponse.error.code, "MEDIA_REGION_COLOR_READBACK_UNSUPPORTED");
    assert.equal(colorFixture.calls.length, 0);

    const budgetFixture = mediaFixture({ files: { "/a.wav": 1 }, tracks: { [TRACK_A]: [] } });
    const budgetResponse = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: { ...request({ assets: [{ id: "a", path: "/a.wav", track_ref: TRACK_A, position_seconds: 0 }], placement: { mode: "explicit" }, track_policy: "explicit_per_asset", dry_run: false }), budget: { max_response_bytes: 2_048 } },
      executeAtomic: budgetFixture.execute,
    });
    assert.equal(budgetResponse.error.code, "MEDIA_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(budgetResponse.result.data.available_bytes, 2_048);
    assert.equal(budgetResponse.budget.actual_bytes <= 2_048, true);
    assert.equal(budgetFixture.calls.some((call) => call.id.startsWith("template.media.import_") || call.id === "template.tracks.create_track" || call.id === "template.project.create_region"), false);
    assert.deepEqual(validateMacroExecutionEnvelope(budgetResponse), { valid: true, errors: [] });
  });

  it("preserves the 2 KiB budget through the public call_template facade and blocks before mutation", async () => {
    const bridge = new MediaBudgetRuntimeBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
      },
    });
    const response = await runtime.call_template({
      id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID,
      input: {
        assets: [{ id: "a", path: "/a.wav", track_ref: TRACK_A, position_seconds: 0 }],
        placement: { mode: "explicit" },
        track_policy: "explicit_per_asset",
        dry_run: false,
      },
      context: {
        request_id: "request:alpha33:media:public-budget",
        session_id: "session:alpha33:media:public-budget",
        expected_owner: "owner-test",
        expected_generation: 1,
        created_at: "2026-07-14T00:00:00.000Z",
        request_sequence: 1,
      },
      budget: { max_response_bytes: 2_048, max_items: 50, max_inline_value_bytes: 2_048 },
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "MEDIA_RESPONSE_BUDGET_EXCEEDED");
    assert.equal(response.result.data.available_bytes, 2_048);
    assert.equal(response.budget.actual_bytes <= 2_048, true);
    assert.deepEqual(bridge.capabilities, ["media.file.probe", "track.resolve_ref"]);
    assert.equal(bridge.capabilities.some((capability) => capability.includes("import") || capability.includes("create")), false);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("preserves the original mutation blocker and never derives identity errors from failed dispatch", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 1 }, tracks: { [TRACK_A]: [] } }, { failImportAt: 1 });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "sequence_on_one_track" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.error.code, "MEDIA_IMPORT_FAILED_AT_SOURCE");
    assert.equal(response.result.changes[0].mutation.status, "unknown_or_partial");
    assert.deepEqual(response.result.changes[0].live_readback, { status: "not_run", blocker_code: "MEDIA_IMPORT_FAILED_AT_SOURCE" });
    assert.equal(response.result.changes[1].status, "not_run");
  });

  it("never reports applied from mutation dispatch alone and keeps later rows not_run", async () => {
    const fixture = mediaFixture({ files: { "/a.wav": 1, "/b.wav": 1 }, tracks: { [TRACK_A]: [] } }, { mismatchFirstReadback: true });
    const response = await executeAlpha3_3MediaPlaceAssetsMacro({
      request: request({ assets: [{ id: "a", path: "/a.wav" }, { id: "b", path: "/b.wav" }], placement: { mode: "sequence_on_one_track" }, track_policy: "existing_track", track_ref: TRACK_A, dry_run: false }),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MEDIA_LIVE_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "pending");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "failed");
    assert.equal(response.result.changes[1].status, "not_run");
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
  });

  it("retains legacy explicit planner compatibility as a registered-program handoff", () => {
    const plan = planAlpha3_2EMediaPlaceAssetsMacro({ assets: [{ id: "one", path: "/one.wav", track_ref: TRACK_A, position_seconds: 1 }], dry_run: true });
    assert.equal(plan.ok, true);
    assert.equal(plan.mode, "dry_run_preview");
    assert.equal(plan.preview.target_counts.assets, 1);
    assert.deepEqual(plan.child_requests, []);
  });
});

class MediaBudgetRuntimeBridge extends RuntimeFoundationBridge {
  constructor() {
    super();
    this.capabilities = [];
  }

  dispatch(input) {
    const request = structuredClone(input);
    const capability = request.pack?.capability;
    this.capabilities.push(capability);
    request.params = { ...(request.params ?? {}) };
    if (capability === "media.file.probe") {
      request.params.emits = {
        refs: [createObjectRef("file", { scheme: "path", value: "/a.wav" }, { ref: "file:path:/a.wav" })],
        readback: {
          file_ref: "file:path:/a.wav",
          source_type: "audio",
          length_seconds: 1,
          length_is_quarter_notes: false,
          channel_count: 2,
          decodable: true,
        },
      };
    } else if (capability === "track.resolve_ref") {
      request.params.emits = {
        refs: [createObjectRef("track", { scheme: "guid", value: "{MEDIA-TRACK-A}" }, { ref: TRACK_A })],
        readback: { track_ref: TRACK_A, index: 0, name: "Media" },
      };
    } else {
      throw new Error(`Unexpected public budget dispatch: ${capability}`);
    }
    return super.dispatch(request);
  }
}

function request(input) { return { id: ALPHA3_2E_MEDIA_PLACE_ASSETS_MACRO_ID, input, context: { request_id: "media-test", session_id: "media-test", request_sequence: 1, created_at: "2026-07-14T00:00:00.000Z" } }; }

function mediaFixture(seed = {}, { mismatchFirstReadback = false, failTrackCreateAt = null, mismatchCreatedTrackName = false, mismatchCreatedRegionRef = false, mismatchRegionCountBeforeCreate = false, failCreatedTrackResolve = false, failRegionListAfterCreate = false, failImportAt = null } = {}) {
  const files = { ...(seed.files ?? {}) };
  const tracks = structuredClone(seed.tracks ?? {});
  const trackNames = new Map(Object.entries(seed.trackNames ?? {}));
  const takes = { ...(seed.takes ?? {}) };
  const items = [];
  const regions = [];
  const calls = [];
  let trackSerial = 0;
  let itemSerial = 0;
  let importSerial = 0;
  let mismatchPending = mismatchFirstReadback;
  return {
    files, tracks, takes, items, regions, calls,
    execute: async (call) => {
      calls.push(structuredClone(call));
      if (call.id === "template.media.probe_file") {
        const length = files[call.input.path];
        if (!Number.isFinite(length)) return fail(call.id, "FILE_NOT_FOUND");
        return ok(call.id, { file_ref: `file:path:${call.input.path}`, length_seconds: length, length_is_quarter_notes: false, decodable: true }, [fileRef(call.input.path)]);
      }
      if (call.id === "template.tracks.resolve_track_ref") {
        const ref = call.input.track_ref;
        if (failCreatedTrackResolve && ref.startsWith("track:guid:{CREATED-")) return fail(call.id, "TRACK_RESOLVE_READ_FAILED");
        if (!Object.hasOwn(tracks, ref)) return fail(call.id, "TRACK_NOT_FOUND");
        const name = trackNames.get(ref);
        return ok(call.id, { track_ref: ref, ...(name !== undefined ? { name: mismatchCreatedTrackName ? `${name} mismatch` : name } : {}) }, [objectRef("track", ref)]);
      }
      if (call.id === "template.tracks.create_track") {
        if (trackSerial + 1 === failTrackCreateAt) return fail(call.id, "TRACK_CREATE_FAILED");
        const ref = `track:guid:{CREATED-${++trackSerial}}`;
        tracks[ref] = [];
        trackNames.set(ref, call.input.name);
        return ok(call.id, { track_ref: ref, name: call.input.name }, [objectRef("track", ref)]);
      }
      if (call.id === "template.items.list_items_on_track") {
        const ref = call.refs.track_ref.ref;
        const rows = tracks[ref] ?? [];
        return ok(call.id, { track_ref: ref, items: structuredClone(rows.slice(0, 128)), item_count: rows.length, truncated: rows.length > 128 }, [objectRef("track", ref)]);
      }
      if (["template.media.import_file_to_track", "template.media.import_file_section_to_track"].includes(call.id)) {
        importSerial += 1;
        if (importSerial === failImportAt) return fail(call.id, "MEDIA_IMPORT_FAILED_AT_SOURCE");
        const trackRef = call.refs.track_ref.ref;
        const path = call.refs.source_file_ref.identity.value;
        const fullLength = files[path];
        const length = call.id.endsWith("section_to_track") ? fullLength * (call.input.end_percent - call.input.start_percent) : fullLength;
        const itemRef = `item:guid:{MEDIA-ITEM-${++itemSerial}}`;
        const takeRef = `take:guid:{MEDIA-TAKE-${itemSerial}}`;
        const row = { item_ref: itemRef, take_ref: takeRef, track_ref: trackRef, position_seconds: call.input.position_seconds, length_seconds: length, file_ref: `file:path:${path}` };
        items.push(row); tracks[trackRef].push(row); takes[takeRef] = row.file_ref;
        return ok(call.id, { imported_item_refs: [itemRef], item_count: 1, source_file_ref: row.file_ref, track_ref: trackRef, position_seconds: row.position_seconds }, [objectRef("item", itemRef), fileRef(path)]);
      }
      if (call.id === "template.items.read_item_summary") {
        const ref = call.refs.item_ref.ref;
        const item = items.find((row) => row.item_ref === ref);
        if (!item) return fail(call.id, "ITEM_NOT_FOUND");
        const facts = { item_ref: item.item_ref, track_ref: item.track_ref, position_seconds: mismatchPending ? item.position_seconds + 1 : item.position_seconds, length_seconds: item.length_seconds, active_take_ref: item.take_ref, take_count: 1 };
        mismatchPending = false;
        return ok(call.id, facts, [objectRef("item", item.item_ref), objectRef("take", item.take_ref)]);
      }
      if (call.id === "template.media.read_take_source") {
        const ref = call.refs.take_ref.ref;
        return ok(call.id, { take_ref: ref, file_ref: takes[ref], source_type: "audio" }, [objectRef("take", ref), fileRef(takes[ref].slice("file:path:".length))]);
      }
      if (call.id === "template.media.relink_take_source") {
        const takeRef = call.refs.take_ref.ref;
        takes[takeRef] = call.refs.source_file_ref.ref;
        return ok(call.id, { take_ref: takeRef, source_file_ref: takes[takeRef], relinked: true }, [objectRef("take", takeRef), call.refs.source_file_ref]);
      }
      if (call.id === "template.project.list_markers_regions") {
        if (failRegionListAfterCreate && regions.length > 0) return fail(call.id, "REGION_INVENTORY_READ_FAILED");
        const items = structuredClone(regions);
        if (mismatchCreatedRegionRef && items.length > 0) items.at(-1).region_ref = "region:index:999999";
        const regionCount = mismatchRegionCountBeforeCreate && regions.length === 0 ? 1 : regions.length;
        return ok(call.id, { items, marker_count: 0, region_count: regionCount, truncated: false });
      }
      if (call.id === "template.project.create_region") {
        regions.push({ kind: "region", name: call.input.name, position_seconds: call.input.start_seconds, end_seconds: call.input.end_seconds, region_ref: `region:index:${regions.length}` });
        return ok(call.id, regions.at(-1));
      }
      throw new Error(`Unexpected ${call.id}`);
    },
  };
}

function ok(id, readback, refs = []) { return { ok: true, request: { id }, template: { id }, verification: { status: "passed" }, result: { readback, refs } }; }
function fail(id, code) { return { ok: false, request: { id }, template: { id }, error: { code, message: code, recoverable: true } }; }
function objectRef(kind, ref) { return { kind, ref, identity: { scheme: ref.split(":")[1], value: ref.split(":").slice(2).join(":") } }; }
function fileRef(path) { return { kind: "file", ref: `file:path:${path}`, identity: { scheme: "path", value: path } }; }
function fakeIndex() { return { scopes: null, status: () => ({ snapshot_id: "snapshot:media", revision: "revision:media" }), invalidateScopes({ scopes }) { this.scopes = scopes; return { ok: true, scopes }; } }; }
