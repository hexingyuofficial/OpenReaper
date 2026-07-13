import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import { ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID } from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";
import { ALPHA3_2_5_D_NATIVE_FX_MACRO_ID } from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import { ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT } from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const TRACK_REF = "track:guid:{D-RUNTIME-TRACK}";
const ITEM_REF = "item:guid:{D-RUNTIME-ITEM}";
const TAKE_REF = "take:guid:{D-RUNTIME-TAKE}";
const FX_REF = `fx:${TRACK_REF}:0`;
const NOTES = [
  { start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 },
  { start_ppq: 480, end_ppq: 960, pitch: 64, velocity: 88, channel: 0 },
];

const TRACK_OBJECT = createObjectRef("track", { scheme: "guid", value: "{D-RUNTIME-TRACK}" }, { ref: TRACK_REF });
const ITEM_OBJECT = createObjectRef("item", { scheme: "guid", value: "{D-RUNTIME-ITEM}" }, { ref: ITEM_REF });
const TAKE_OBJECT = createObjectRef("take", { scheme: "guid", value: "{D-RUNTIME-TAKE}" }, { ref: TAKE_REF });
const FX_OBJECT = createObjectRef("fx", { scheme: "track_fx", value: `${TRACK_REF}:0` }, { ref: FX_REF });

describe("Alpha3.2.5-D call_template runtime integration", () => {
  it("discovers both D executors through their Alpha3.3 canonical ids and hides the old aliases", () => {
    const runtime = createRuntime();
    const items = runtime.list_templates({
      ids: ["macro.midi.apply", "macro.fx.apply_chain"],
      fields: ["summary"],
    }).items;

    assert.deepEqual(items.map((item) => item.id).sort(), [
      "macro.fx.apply_chain",
      "macro.midi.apply",
    ].sort());
    assert.equal(items.every((item) => item.execution_shape === "registered_macro_program"), true);
    assert.equal(items.every((item) => item.capability_truth.live_runnable_now === true), true);

    const hidden = runtime.list_templates({
      ids: [ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID, ALPHA3_2_5_D_NATIVE_FX_MACRO_ID],
      fields: ["id"],
    });
    assert.deepEqual(hidden.items, []);
    assert.deepEqual(hidden.missing_ids, [
      ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
      ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
    ]);
  });

  it("executes MIDI and native FX through canonical ids and returns exact replacement errors for old ids", async () => {
    const bridge = new DRuntimeBridge();
    const invalidations = [];
    const runtime = createRuntime({ bridge, invalidations });

    const midi = await runtime.call_template({
      id: "macro.midi.apply",
      input: { mode: "create_clips", start_seconds: 0, end_seconds: 2, notes: NOTES, dry_run: false },
      refs: { track_ref: TRACK_REF },
      context: context(1),
    });
    assert.equal(midi.ok, true, JSON.stringify(midi));
    assert.equal(midi.result.data.item_ref, ITEM_REF);
    assert.equal(midi.result.data.take_ref, TAKE_REF);
    assert.equal(midi.result.data.note_count, NOTES.length);
    assert.equal(midi.macro.id, "macro.midi.apply");
    assert.equal(midi.macro.program_id, "openreaper.macro.midi.apply");
    assert.equal(midi.budget.actual_bytes <= midi.budget.max_bytes, true, JSON.stringify(midi.budget));

    const nativeFx = await runtime.call_template({
      id: "macro.fx.apply_chain",
      input: { controls: { threshold_db: -18, ratio: 3 }, dry_run: false },
      refs: { track_ref: TRACK_REF },
      context: context(2),
    });
    assert.equal(nativeFx.ok, true, JSON.stringify(nativeFx));
    assert.equal(nativeFx.result.data.fx_ref, FX_REF);
    assert.equal(nativeFx.result.data.readback.length, 2);
    assert.equal(nativeFx.result.verification.status, "passed");
    assert.equal(nativeFx.macro.id, "macro.fx.apply_chain");
    assert.equal(nativeFx.macro.program_id, "openreaper.macro.fx.apply_chain");
    assert.equal(nativeFx.budget.actual_bytes <= nativeFx.budget.max_bytes, true, JSON.stringify(nativeFx.budget));

    const capabilities = bridge.seen.map((request) => request.pack.capability);
    assert.deepEqual(capabilities.slice(0, 6), [
      "track.resolve_ref",
      "midi.create_midi_item",
      "midi.insert_notes_batch",
      "midi.resolve_midi_take_ref",
      "midi.read_take_event_counts",
      "midi.list_take_notes",
    ]);
    assert.equal(capabilities.includes("fx.add_track"), true);
    assert.equal(capabilities.filter((capability) => capability === "fx.set_parameter_normalized").length, 2);
    assert.deepEqual(invalidations, [["items", "takes", "selection"], ["fx"]]);

    const oldMidi = await runtime.call_template({
      id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
      input: { start_seconds: 0, end_seconds: 2, notes: NOTES },
    });
    assert.equal(oldMidi.error.code, "CALL_TEMPLATE_ID_REPLACED");
    assert.equal(oldMidi.error.details.replacement, "macro.midi.apply");
    assert.equal(oldMidi.error.details.replacement_input.mode, "create_clips");

    const oldFx = await runtime.call_template({
      id: ALPHA3_2_5_D_NATIVE_FX_MACRO_ID,
      input: { controls: { threshold_db: -18, ratio: 3 } },
    });
    assert.equal(oldFx.error.code, "CALL_TEMPLATE_ID_REPLACED");
    assert.equal(oldFx.error.details.replacement, "macro.fx.apply_chain");
  });
});

function createRuntime({ bridge = new DRuntimeBridge(), invalidations = [] } = {}) {
  const projectIndexRuntime = {
    contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
    ok: true,
    adapter: {},
    status: () => ({
      contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
      ok: true,
      lifecycle: "ready",
      snapshot_id: "snapshot:d-runtime",
      revision: "revision:d-runtime",
    }),
    invalidateScopes({ scopes }) {
      invalidations.push([...scopes]);
      return { ok: true, scopes, snapshot_id: "snapshot:d-runtime", revision: "revision:d-runtime" };
    },
  };
  return createCallTemplateRuntime({
    projectIndexRuntime,
    live: {
      opted_in: true,
      executor: bridge,
      allowed_template_ids: CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
    },
  });
}

class DRuntimeBridge extends FakeFoundationBridge {
  constructor() {
    super();
    this.parameterValues = new Map();
  }

  dispatch(input) {
    const request = structuredClone(input);
    const capability = request.pack?.capability;
    request.params = { ...(request.params ?? {}) };
    request.params.emits = emitted(capability, request, this.parameterValues);
    return super.dispatch(request);
  }
}

function emitted(capability, request, parameterValues) {
  if (capability === "track.resolve_ref") return output([TRACK_OBJECT], { track_ref: TRACK_REF, name: "D Runtime Track" });
  if (capability === "midi.create_midi_item") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF });
  if (capability === "midi.insert_notes_batch") return output([TAKE_OBJECT], { take_ref: TAKE_REF, inserted_count: NOTES.length, note_count: NOTES.length, take_hash: "hash:d-runtime" });
  if (capability === "midi.resolve_midi_take_ref") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF, event_count: NOTES.length, ppq_start: 0, ppq_end: 960 });
  if (capability === "midi.read_take_event_counts") return output([TAKE_OBJECT], { take_ref: TAKE_REF, note_count: NOTES.length, cc_count: 0, text_sysex_count: 0 });
  if (capability === "midi.list_take_notes") return output([TAKE_OBJECT], { take_ref: TAKE_REF, notes: NOTES, returned_count: NOTES.length, truncated: false });
  if (capability === "fx.add_track") return output([FX_OBJECT], { fx_ref: FX_REF, owner_kind: "track", slot_index: 0, name: "VST: ReaComp (Cockos)", parameter_count: 2 });
  if (capability === "fx.resolve_ref") return output([FX_OBJECT], { fx_ref: FX_REF, owner_kind: "track", slot_index: 0, name: "VST: ReaComp (Cockos)", parameter_count: 2 });
  if (capability === "fx.read_summary") return output([FX_OBJECT], { fx_ref: FX_REF, owner_kind: "track", slot_index: 0, name: "VST: ReaComp (Cockos)", parameter_count: 2 });
  if (capability === "fx.list_parameters") return output([], {
    parameter_count: 2,
    parameters: [
      { param_index: 0, name: "Threshold", normalized_value: 0.5 },
      { param_index: 1, name: "Ratio", normalized_value: 0.1 },
    ],
    truncated: false,
  });
  if (capability === "fx.set_parameter_normalized") {
    parameterValues.set(request.params.param_index, request.params.normalized_value);
    return output([FX_OBJECT], { fx_ref: FX_REF, param_index: request.params.param_index, normalized_value: request.params.normalized_value });
  }
  if (capability === "fx.read_parameter") return output([FX_OBJECT], { fx_ref: FX_REF, param_index: request.params.param_index, normalized_value: parameterValues.get(request.params.param_index) });
  return output([], {});
}

function output(refs, readback) {
  return { refs, readback };
}

function context(requestSequence) {
  return {
    session_id: "session-alpha325-d-runtime",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-12T10:00:00.000Z",
    request_sequence: requestSequence,
  };
}
