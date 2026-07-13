import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
  ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES,
  ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY,
  ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS,
  createAlpha3_3B1bItemsAnalyzeDiscoveryItems,
} from "../../packages/mcp-server/src/alpha3-3-b1b-items-analyze-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const ITEM_REF = "item:guid:{ALPHA33-B1B-ITEM}";
const TRACK_REF = "track:guid:{ALPHA33-B1B-TRACK}";
const TAKE_REF = "take:guid:{ALPHA33-B1B-TAKE}";
const ITEM_OBJECT = createObjectRef("item", { scheme: "guid", value: "{ALPHA33-B1B-ITEM}" }, { ref: ITEM_REF });
const TRACK_OBJECT = createObjectRef("track", { scheme: "guid", value: "{ALPHA33-B1B-TRACK}" }, { ref: TRACK_REF });
const TAKE_OBJECT = createObjectRef("take", { scheme: "guid", value: "{ALPHA33-B1B-TAKE}" }, { ref: TAKE_REF });

describe("Alpha3.3-B1b items.analyze", () => {
  it("registers one read-only executable Macro over the accepted Item analysis atoms", () => {
    const entry = ALPHA3_3_B1B_ITEMS_ANALYZE_REGISTRY.get(ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID);
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.risk, "read");
    assert.equal(entry.undo_policy, "not_required");
    assert.equal(entry.sqlite_policy.mode, "not_used");
    assert.deepEqual(entry.dependencies.template_ids, ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS);
    assert.equal(ALPHA3_3_B1B_ITEMS_ANALYZE_TEMPLATE_IDS.every((id) =>
      CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS.includes(id)), true);

    const discovery = createAlpha3_3B1bItemsAnalyzeDiscoveryItems({ liveRunnableNow: true })[0];
    assert.equal(discovery.id, ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID);
    assert.equal(discovery.live_runnable_now, true);
    assert.deepEqual(discovery.supported_profiles, ALPHA3_3_B1B_ITEMS_ANALYZE_PROFILES);
    assert.deepEqual(discovery.held_profiles, ["compare", "midi", "loop"]);
  });

  it("executes full analysis for an exact resolvable Item with canonical facts, basis, artifacts, and no mutation", async () => {
    const bridge = new AnalysisBridge();
    const runtime = createRuntime(bridge);
    const result = await runtime.call_template({
      id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
      input: {
        profile: "full",
        target_refs: ["selected:0"],
        range: { start_seconds: 0, end_seconds: 2 },
        output: "artifact_when_large",
      },
      context: context(1),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.deepEqual(result.macro, {
      id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
      program_id: "openreaper.macro.items.analyze",
      program_version: "1.0.0",
      risk: "read",
    });
    assert.equal(result.execution.status, "completed");
    assert.equal(result.result.changes.length, 0);
    assert.equal(result.result.verification.status, "passed");
    assert.equal(result.result.data.mutation.occurred, false);
    assert.equal(result.result.data.target_scope, "exact");
    assert.equal(result.result.data.returned_target_count, 1);
    assert.equal(result.result.data.items.length, 1);
    assert.equal(result.result.data.items[0].item_ref, ITEM_REF);
    assert.equal(result.result.data.items[0].track_ref, TRACK_REF);
    assert.equal(result.result.data.items[0].active_take_ref, TAKE_REF);
    assert.deepEqual(Object.keys(result.result.data.items[0].measurements), [
      "rms",
      "sample_peaks",
      "silence",
      "transients",
    ]);
    assert.deepEqual([...result.result.data.measurement_basis].sort(), [
      "active_take_audio_accessor_pre_fx_samples",
      "active_take_native_peak_blocks",
      "reaper_item_take_state",
      "source_media_calculate_normalization",
    ].sort());
    assert.equal(result.result.data.items[0].measurements.rms.lufs_i, -14);
    assert.equal(result.result.data.items[0].measurements.sample_peaks.true_peak_available, true);
    assert.equal(result.result.artifact_refs.length, 4);
    assert.equal(result.budget.actual_bytes <= result.budget.max_bytes, true);

    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "items.resolve_item_ref",
      "items.read_item_summary",
      "analysis.measure_item_rms",
      "analysis.measure_item_peaks",
      "analysis.detect_item_silence",
      "analysis.detect_item_transients",
    ]);
  });

  it("uses a bounded selected-Item selector for quick facts and reports selection truncation", async () => {
    const bridge = new AnalysisBridge({ selectedCount: 3 });
    const runtime = createRuntime(bridge);
    const result = await runtime.call_template({
      id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
      input: { profile: "quick", target: "selected", limit: 1 },
      context: context(2),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.data.target_scope, "selected");
    assert.equal(result.result.data.total_target_count, 3);
    assert.equal(result.result.data.returned_target_count, 1);
    assert.equal(result.result.data.targets_truncated, true);
    assert.deepEqual(result.result.data.items[0].measurements, {});
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "items.list_selected_items",
      "items.read_item_summary",
    ]);
  });

  it("fails held profiles, unsupported channel policy, and unused quick ranges before dispatch", async () => {
    for (const [input, code] of [
      [{ profile: "compare" }, "ITEM_ANALYSIS_PROFILE_UNSUPPORTED"],
      [{ profile: "audio", channel_policy: "per_channel" }, "ITEM_ANALYSIS_CHANNEL_POLICY_UNSUPPORTED"],
      [{ profile: "quick", range: { start_seconds: 0, end_seconds: 1 } }, "ITEM_ANALYSIS_RANGE_UNUSED"],
    ]) {
      const bridge = new AnalysisBridge();
      const result = await createRuntime(bridge).call_template({
        id: ALPHA3_3_B1B_ITEMS_ANALYZE_MACRO_ID,
        input,
        context: context(3),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, code);
      assert.equal(result.result.data.mutation?.occurred ?? false, false);
      assert.equal(bridge.seen.length, 0);
    }
  });
});

function createRuntime(bridge) {
  return createCallTemplateRuntime({
    live: {
      opted_in: true,
      executor: bridge,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
  });
}

class AnalysisBridge extends FakeFoundationBridge {
  constructor({ selectedCount = 1 } = {}) {
    super();
    this.selectedCount = selectedCount;
  }

  dispatch(input) {
    const request = structuredClone(input);
    request.params = { ...(request.params ?? {}) };
    request.params.emits = emitted(request.pack.capability, request, this.selectedCount);
    return super.dispatch(request);
  }
}

function emitted(capability, request, selectedCount) {
  if (capability === "items.resolve_item_ref") {
    return output([ITEM_OBJECT], { item_ref: ITEM_REF, track_ref: TRACK_REF, position_seconds: 1, length_seconds: 2 });
  }
  if (capability === "items.list_selected_items") {
    return output([ITEM_OBJECT, TRACK_OBJECT], {
      selected_count: selectedCount,
      items: [{ item_ref: ITEM_REF, track_ref: TRACK_REF, position_seconds: 1, length_seconds: 2 }],
      truncated: selectedCount > request.params.limit,
    });
  }
  if (capability === "items.read_item_summary") {
    return output([ITEM_OBJECT, TRACK_OBJECT, TAKE_OBJECT], {
      item_ref: ITEM_REF,
      track_ref: TRACK_REF,
      position_seconds: 1,
      length_seconds: 2,
      snap_offset_seconds: 0.05,
      fade_in_seconds: 0.01,
      fade_out_seconds: 0.02,
      take_count: 1,
      active_take_ref: TAKE_REF,
      active_take_name: "Analysis take",
      start_offset_seconds: 0,
      take_volume_db: -1,
      take_pan: 0,
      channel_mode: "stereo",
      reverse: false,
      pitch_shift_mode: "project_default",
    });
  }
  const common = {
    item_ref: ITEM_REF,
    analyzed_start_seconds: request.params.start_seconds ?? 0,
    analyzed_end_seconds: request.params.end_seconds ?? 2,
    duration_seconds: 2,
    sample_rate: 48_000,
    channels: 2,
    sample_frames: 96_000,
    truncated: false,
  };
  if (capability === "analysis.measure_item_rms") {
    return analysisOutput(capability, "analysis.item_rms.v1", {
      ...common,
      measurement_basis: "source_media_calculate_normalization",
      rms_dbfs: -12,
      rms_linear: 0.2511886,
      lufs_i: -14,
    });
  }
  if (capability === "analysis.measure_item_peaks") {
    return analysisOutput(capability, "analysis.item_peaks.v1", {
      ...common,
      measurement_basis: "active_take_native_peak_blocks",
      abs_peak_dbfs: -1,
      abs_peak_linear: 0.8912509,
      positive_peak_linear: 0.8912509,
      negative_peak_linear: -0.75,
      source_sample_peak_dbfs: -1.2,
      true_peak_dbfs: -0.8,
      true_peak_available: true,
      per_channel: [{ channel: 1, abs_peak_dbfs: -1 }, { channel: 2, abs_peak_dbfs: -1.5 }],
    });
  }
  if (capability === "analysis.detect_item_silence") {
    return analysisOutput(capability, "analysis.item_silence.v1", {
      ...common,
      measurement_basis: "active_take_audio_accessor_pre_fx_samples",
      segment_count: 1,
      total_silence_seconds: 0.2,
      leading_silence_seconds: 0.1,
      trailing_silence_seconds: 0.1,
      threshold_dbfs: -60,
    });
  }
  if (capability === "analysis.detect_item_transients") {
    return analysisOutput(capability, "analysis.item_transients.v1", {
      ...common,
      measurement_basis: "active_take_audio_accessor_pre_fx_samples",
      transient_count: 2,
      total_detected: 2,
      first_transient_time: 0.15,
      last_transient_time: 1.2,
    });
  }
  return output([], {});
}

function analysisOutput(capability, schema, readback) {
  const scope = schema.split(".")[1];
  const suffix = {
    "analysis.measure_item_rms": "a10001",
    "analysis.measure_item_peaks": "a10002",
    "analysis.detect_item_silence": "a10003",
    "analysis.detect_item_transients": "a10004",
  }[capability];
  const artifact = createArtifactRef({
    owner_pack: "analysis",
    scope,
    id: `art_20260713150000000_001_${suffix}`,
    schema,
    summary: { schema, template_id: `template.${capability}` },
  });
  return {
    refs: [],
    artifacts: [artifact],
    readback: { ...readback, artifact_ref: artifact.ref, schema },
  };
}

function output(refs, readback) {
  return { refs, readback };
}

function context(requestSequence) {
  return {
    session_id: "session-alpha33-b1b",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-13T15:00:00.000Z",
    request_sequence: requestSequence,
  };
}
