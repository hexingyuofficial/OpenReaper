import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
  ALPHA3_2_5_D_MIDI_MACRO_REGISTRY,
  createAlpha3_2_5DMidiMacroDiscoveryItem,
  executeAlpha3_2_5DMidiMacro,
  isAlpha3_2_5DMidiMacroId,
} from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const TRACK = "track:guid:{TRACK-D}";
const ITEM = "item:guid:{ITEM-D}";
const TAKE = "take:guid:{TAKE-D}";
const NOTES = [
  { start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 },
  { start_ppq: 480, end_ppq: 960, pitch: 64, velocity: 88, channel: 0 },
];

describe("Alpha3.2.5-D MIDI create clip Macro", () => {
  it("registers one executable task-shaped Macro and discovery helper", () => {
    assert.equal(isAlpha3_2_5DMidiMacroId(ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID), true);
    assert.deepEqual(ALPHA3_2_5_D_MIDI_MACRO_REGISTRY.ids, [ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID]);
    const entry = ALPHA3_2_5_D_MIDI_MACRO_REGISTRY.get(ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID);
    assert.equal(entry.implementation_status, "executable");
    assert.equal(entry.selector_policy.task_shaped, true);
    assert.equal(entry.sqlite_policy.write_authority, false);
    assert.equal(entry.dry_run_supported, true);
    assert.equal(createAlpha3_2_5DMidiMacroDiscoveryItem().execution_shape, "registered_macro_program");
  });

  it("executes the fixed create -> insert -> count/list chain with the created take_ref", async () => {
    const calls = [];
    const index = fakeIndex();
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      projectIndexRuntime: index,
      executeAtomic: async (child) => {
        calls.push(child);
        return executionFor(child.id, child.id === "template.midi.create_midi_item"
          ? { item_ref: ITEM, take_ref: TAKE }
          : child.id === "template.midi.read_take_event_counts"
            ? { take_ref: TAKE, note_count: NOTES.length, cc_count: 0, text_sysex_count: 0 }
              : child.id === "template.midi.list_take_notes"
                ? { take_ref: TAKE, notes: NOTES, returned_count: NOTES.length, truncated: false }
              : child.id === "template.midi.resolve_midi_take_ref"
                ? { take_ref: TAKE, item_ref: ITEM }
              : child.id === "template.tracks.resolve_track_ref"
                ? { track_ref: TRACK }
                : { take_ref: TAKE, inserted_count: NOTES.length });
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assert.equal(response.result.data.take_ref, TAKE);
    assert.deepEqual(calls.map((call) => call.id), [
      "template.tracks.resolve_track_ref",
      "template.midi.create_midi_item",
      "template.midi.insert_notes_batch",
      "template.midi.resolve_midi_take_ref",
      "template.midi.read_take_event_counts",
      "template.midi.list_take_notes",
    ]);
    assert.deepEqual(calls[1].refs.track_ref, objectRef("track", TRACK));
    assert.deepEqual(calls[2].refs.take_ref, objectRef("take", TAKE));
    assert.deepEqual(calls[2].input.notes, NOTES);
    assert.deepEqual(index.invalidated, ["items", "takes", "selection"]);
  });

  it("uses one unique B-layer selector candidate and live-validates it before write", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { selector: { name: "Lead" } } }),
      projectIndexRuntime: fakeIndex({ trackRows: [{ ref: TRACK, name: "Lead" }] }),
      executeAtomic: async (child) => {
        calls.push(child);
        return executionFor(child.id, child.id === "template.project.read_summary" ? { change_count: 1 } : child.id === "template.tracks.resolve_track_ref" ? { track_ref: TRACK } : child.id === "template.midi.create_midi_item" ? { item_ref: ITEM, take_ref: TAKE } : child.id === "template.midi.resolve_midi_take_ref" ? { take_ref: TAKE, item_ref: ITEM } : child.id === "template.midi.read_take_event_counts" ? { note_count: NOTES.length } : child.id === "template.midi.list_take_notes" ? { notes: NOTES } : { inserted_count: NOTES.length });
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.track_ref, TRACK);
    assert.equal(response.result.data.sqlite_selector_used, true);
    assert.equal(calls.findIndex((call) => call.id === "template.tracks.resolve_track_ref") < calls.findIndex((call) => call.id === "template.midi.create_midi_item"), true);
  });

  it("supports dry_run without mutation", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { start_seconds: 0, end_seconds: 2, notes: NOTES, dry_run: true }, refs: { track_ref: TRACK } }),
      executeAtomic: async (child) => { calls.push(child); return executionFor(child.id, { track_ref: TRACK }); },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.deepEqual(calls.map((call) => call.id), ["template.tracks.resolve_track_ref"]);
    assert.equal(response.result.changes.length, 0);
  });

  it("fails closed for seconds notes and for child verification failures", async () => {
    let callCount = 0;
    const seconds = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { notes: [{ start_seconds: 0, end_seconds: 1, pitch: 60, velocity: 96, channel: 0 }], start_seconds: 0, end_seconds: 2 }, refs: { track_ref: TRACK } }),
      executeAtomic: async () => { callCount += 1; return executionFor(TRACK, { track_ref: TRACK }); },
    });
    assert.equal(seconds.ok, false);
    assert.equal(seconds.error.code, "MIDI_SECONDS_MODE_BLOCKED");
    assert.equal(callCount, 0);

    const failedChild = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      executeAtomic: async (child) => executionFor(child.id, child.id === "template.tracks.resolve_track_ref" ? { track_ref: TRACK } : { item_ref: ITEM, take_ref: TAKE }, child.id === "template.midi.create_midi_item" ? "failed" : "passed"),
    });
    assert.equal(failedChild.ok, false);
    assert.equal(failedChild.error.code, "MIDI_MACRO_CHILD_VERIFICATION_FAILED");
    assert.equal(failedChild.execution.status, "partial_failure");

    const replayCalls = [];
    const replay = await executeAlpha3_2_5DMidiMacro({
      request: { ...request({ refs: { track_ref: TRACK } }), idempotency_key: "repeat" },
      executeAtomic: async (child) => { replayCalls.push(child); return executionFor(child.id, {}); },
    });
    assert.equal(replay.ok, false);
    assert.equal(replay.error.code, "MIDI_MACRO_IDEMPOTENCY_UNSUPPORTED");
    assert.equal(replayCalls.length, 0);
  });
});

function request({ input = {}, refs = {} } = {}) {
  return { id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID, input: { start_seconds: 0, end_seconds: 2, notes: NOTES, ...input }, refs, context: { session_id: "d-test", request_sequence: 1 } };
}

function executionFor(id, readback, verificationStatus = "passed") {
  return { ok: true, request: { id }, verification: { status: verificationStatus }, result: { readback, refs: Object.entries(readback).filter(([key, value]) => key.endsWith("_ref") && typeof value === "string").map(([key, ref]) => objectRef(key.slice(0, -4), ref)) } };
}

function objectRef(kind, ref) {
  const prefix = `${kind}:`;
  const remainder = ref.slice(prefix.length);
  const separator = remainder.indexOf(":");
  return {
    kind,
    ref,
    identity: {
      scheme: separator < 0 ? remainder : remainder.slice(0, separator),
      value: separator < 0 ? "" : remainder.slice(separator + 1),
    },
  };
}

function fakeIndex({ trackRows = [{ ref: TRACK, name: "Lead" }] } = {}) {
  return {
    invalidated: [],
    status: () => ({ snapshot_id: "snapshot:d", revision: "revision:d", rows_available: true, row_counts: { tracks: trackRows.length } }),
    invalidateScopes({ scopes }) { this.invalidated = scopes; return { ok: true, scopes }; },
    adapter: {
      snapshot: () => ({ lifecycle: "ready", snapshot_id: "snapshot:d", freshness_scopes: { tracks: { status: "fresh", coverage_status: "complete" } }, rows: { tracks: trackRows } }),
    },
  };
}
