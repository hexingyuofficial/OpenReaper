import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import { ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID } from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";
import { ALPHA3_2_5_D_NATIVE_FX_MACRO_ID } from "../../packages/mcp-server/src/alpha3-2-5-d-fx-macro-v1.mjs";
import { ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT } from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import { STOCK_SEMANTIC_UNIT_UNPROVEN } from "../../packages/mcp-server/src/alpha3-4-c-fx-semantic-truth-v1.mjs";
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
    assert.equal(nativeFx.ok, false, JSON.stringify(nativeFx));
    assert.equal(nativeFx.execution.status, "blocked");
    assert.equal(nativeFx.error.code, STOCK_SEMANTIC_UNIT_UNPROVEN);
    assert.deepEqual(nativeFx.result.changes, []);
    assert.deepEqual(nativeFx.result.canonical_refs, []);
    assert.equal(nativeFx.result.verification.status, "not_required");
    assert.equal(nativeFx.recovery.partial_changes_possible, false);
    assert.equal(nativeFx.result.data.next_call.arguments.id, "macro.fx.apply_chain");
    assert.equal(JSON.stringify(nativeFx.result.data.next_call).includes("fx:"), false);
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
    assert.equal(capabilities.includes("fx.add_track"), false);
    assert.equal(capabilities.includes("fx.set_parameter_normalized"), false);
    assert.deepEqual(invalidations, [["items", "takes", "selection"]]);

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

  it("keeps 32-note verification complete under a 2048-byte public Macro budget", async () => {
    const notes = generatedNotes(32);
    const bridge = new DRuntimeBridge({ notes });
    const runtime = createRuntime({ bridge });
    const midi = await runtime.call_template({
      id: "macro.midi.apply",
      input: { mode: "create_clips", start_seconds: 0, end_seconds: 4, notes, dry_run: false },
      refs: { track_ref: TRACK_REF },
      context: context(1),
      budget: { max_response_bytes: 2_048, max_items: 1, max_inline_value_bytes: 64 },
    });

    assert.equal(midi.ok, true, JSON.stringify(midi));
    assert.equal(midi.budget.max_bytes, 2_048);
    assert.equal(midi.budget.actual_bytes <= 2_048, true, JSON.stringify(midi.budget));
    assert.equal("notes" in midi.result.data, false);
    assert.equal(midi.result.data.verification.note_count, notes.length);
    assert.equal(midi.result.data.outcome.live_readback.status, "passed");
    assert.equal(midi.result.data.outcome.index_maintenance.status, "completed");
    assert.equal(midi.result.changes.length, 2);
    assert.equal(midi.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(midi.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(midi.result.changes.every((change) => change.index_maintenance.status === "completed"), true);
    const verificationRequests = bridge.seen.filter((request) => [
      "midi.read_take_event_counts",
      "midi.list_take_notes",
    ].includes(request.pack.capability));
    assert.equal(verificationRequests.length, 2);
    assert.equal(verificationRequests.every((request) => request.budget.max_response_bytes === 65_536), true);
    assert.equal(verificationRequests.every((request) => request.budget.max_items === 64), true);
    assert.equal(verificationRequests.every((request) => request.budget.max_inline_value_bytes === 24_576), true);
    assert.equal(verificationRequests[1].params.cursor, "0");
    assert.equal(bridge.seen.every((request) => request.budget.max_response_bytes === 65_536), true);
    assert.equal(bridge.seen.every((request) => request.budget.max_items === 64), true);
    assert.equal(bridge.seen.every((request) => request.budget.max_inline_value_bytes === 24_576), true);
  });

  it("executes the canonical installed-inventory FX chain mode through call_template", async () => {
    const bridge = new DRuntimeBridge();
    const invalidations = [];
    const runtime = createRuntime({ bridge, invalidations });
    const result = await runtime.call_template({
      id: "macro.fx.apply_chain",
      input: {
        owner_kind: "track",
        chain: [{
          plugin_name: "VST: ReaEQ (Cockos)",
          duplicate_policy: "fail_if_present",
          enabled: false,
        }],
        dry_run: false,
      },
      refs: { track_ref: TRACK_REF },
      context: context(1),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.macro.id, "macro.fx.apply_chain");
    assert.equal(result.macro.program_id, "openreaper.macro.fx.apply_chain");
    assert.equal(result.result.data.final_chain.fx_count, 1);
    assert.deepEqual(result.result.data.final_chain.fx.map((row) => [row.name, row.enabled]), [
      ["VST: ReaEQ (Cockos)", false],
    ]);
    assert.deepEqual(result.result.changes.map((change) => change.status), ["applied"]);
    assert.equal(result.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.deepEqual(invalidations, [["fx"]]);
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "track.resolve_ref",
      "fx.list_track_chain",
      "fx.installed.search",
      "fx.add_track",
      "fx.set_bypass",
      "fx.list_track_chain",
    ]);
  });

  it("rejects malformed or empty legacy semantic input publicly while preserving the plain-input default proof gate", async () => {
    for (const [input, expectedCode] of [
      [{ controls: "bad" }, "NATIVE_FX_SEMANTIC_FIELD_INVALID"],
      [{ controls: {} }, "CONTROL_FIELDS_REQUIRED"],
      [{}, STOCK_SEMANTIC_UNIT_UNPROVEN],
    ]) {
      const bridge = new DRuntimeBridge();
      const runtime = createRuntime({ bridge });
      const result = await runtime.call_template({
        id: "macro.fx.apply_chain",
        input,
        refs: { track_ref: TRACK_REF },
        context: context(20),
      });

      assert.equal(result.ok, false, JSON.stringify(result));
      assert.equal(result.error.code, expectedCode);
      assert.deepEqual(result.result.changes, []);
      assert.deepEqual(bridge.seen, []);
      if (Object.keys(input).length === 0) {
        assert.deepEqual(result.result.data.unproven_controls, [
          "threshold_db",
          "ratio",
          "attack_ms",
          "release_ms",
          "wet_mix_percent",
        ]);
      }
    }
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
  constructor({ notes = NOTES } = {}) {
    super();
    this.parameterValues = new Map();
    this.fxChain = [];
    this.notes = structuredClone(notes);
  }

  dispatch(input) {
    const request = structuredClone(input);
    const capability = request.pack?.capability;
    request.params = { ...(request.params ?? {}) };
    request.params.emits = emitted(capability, request, this.parameterValues, this.fxChain, this.notes);
    return super.dispatch(request);
  }
}

function emitted(capability, request, parameterValues, fxChain, notes) {
  if (capability === "track.resolve_ref") return output([TRACK_OBJECT], { track_ref: TRACK_REF, name: "D Runtime Track" });
  if (capability === "midi.create_midi_item") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF });
  if (capability === "midi.insert_notes_batch") return output([TAKE_OBJECT], { take_ref: TAKE_REF, inserted_count: notes.length, note_count: notes.length, take_hash: "hash:d-runtime" });
  if (capability === "midi.resolve_midi_take_ref") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF, event_count: notes.length, ppq_start: 0, ppq_end: notes.at(-1)?.end_ppq ?? 0 });
  if (capability === "midi.read_take_event_counts") return output([TAKE_OBJECT], { take_ref: TAKE_REF, note_count: notes.length, cc_count: 0, text_sysex_count: 0 });
  if (capability === "midi.list_take_notes") {
    const cursor = Number(request.params.cursor ?? 0);
    const limit = Number(request.params.limit ?? notes.length);
    const page = notes.slice(cursor, cursor + limit);
    const next = cursor + page.length;
    return output([TAKE_OBJECT], {
      take_ref: TAKE_REF,
      notes: page,
      returned_count: page.length,
      truncated: next < notes.length,
      ...(next < notes.length ? { next_cursor: String(next) } : {}),
    });
  }
  if (capability === "fx.installed.search") {
    const installed = ["VST: ReaEQ (Cockos)", "VST: ReaComp (Cockos)"];
    const query = String(request.params.query ?? "").toLocaleLowerCase();
    const rows = installed
      .filter((name) => name.toLocaleLowerCase().includes(query))
      .map((name, index) => ({ index, name, ident: name }));
    return output([], {
      query: request.params.query,
      rows,
      row_count: rows.length,
      matched_count: rows.length,
      scanned_count: installed.length,
      truncated: false,
    });
  }
  if (capability === "fx.list_track_chain") {
    return output(fxChain.map((row) => fxObject(row.fx_ref)), {
      owner_kind: "track",
      owner_ref: TRACK_REF,
      fx_count: fxChain.length,
      fx: structuredClone(fxChain),
      fx_refs: fxChain.map((row) => row.fx_ref),
      truncated: false,
    });
  }
  if (capability === "fx.add_track") {
    const slotIndex = fxChain.length;
    const fxRef = `fx:${TRACK_REF}:${slotIndex}`;
    const row = {
      fx_ref: fxRef,
      owner_kind: "track",
      owner_ref: TRACK_REF,
      slot_index: slotIndex,
      name: request.params.plugin_name,
      enabled: true,
      parameter_count: 2,
    };
    fxChain.push(row);
    return output([fxObject(fxRef)], structuredClone(row));
  }
  if (capability === "fx.set_bypass") {
    const ref = request.refs.find((entry) => entry.kind === "fx")?.ref;
    const row = fxChain.find((entry) => entry.fx_ref === ref);
    if (row) row.enabled = request.params.enabled;
    return output(row ? [fxObject(row.fx_ref)] : [], row ? structuredClone(row) : {});
  }
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

function fxObject(ref) {
  return createObjectRef("fx", { scheme: "track_fx", value: ref.slice("fx:".length) }, { ref });
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

function generatedNotes(count) {
  return Array.from({ length: count }, (_, index) => ({
    start_ppq: index * 120,
    end_ppq: index * 120 + 120,
    pitch: 48 + (index % 24),
    velocity: 80 + (index % 32),
    channel: index % 4,
  }));
}
