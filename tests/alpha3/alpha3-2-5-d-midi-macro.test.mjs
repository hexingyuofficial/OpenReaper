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
const CREATE_ITEM_ID = "template.midi.create_midi_item";
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
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(response.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(response.result.data.outcome.index_maintenance.status, "completed");
  });

  it("uses an independent complete-read budget and keeps a 32-note public response under 2048 bytes", async () => {
    const notes = generatedNotes(32);
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({
        input: { notes },
        refs: { track_ref: TRACK },
        budget: { max_response_bytes: 2_048, max_items: 1, max_inline_value_bytes: 64 },
      }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        return midiExecutionFor(child, notes);
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assert.equal(response.budget.max_bytes, 2_048);
    assert.equal(response.budget.actual_bytes <= 2_048, true, JSON.stringify(response.budget));
    assert.equal("notes" in response.result.data, false);
    assert.equal(response.result.data.verification.note_count, notes.length);
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "completed");
    assert.equal(response.result.changes.length, 2);
    for (const change of response.result.changes) {
      assert.deepEqual(Object.keys(change), ["template_id", "status", "mutation", "live_readback", "index_maintenance"]);
      assert.equal(change.status, "applied");
      assert.equal(change.mutation.status, "completed");
      assert.equal(change.live_readback.status, "passed");
      assert.equal(change.index_maintenance.status, "completed");
    }
    assert.equal(calls.length, 6);
    for (const call of calls) {
      assert.deepEqual(call.budget, {
        max_response_bytes: 65_536,
        max_items: 64,
        max_inline_value_bytes: 24_576,
      });
    }
    assert.equal(calls.find((call) => call.id === "template.midi.list_take_notes").input.cursor, "0");
  });

  it("blocks a response budget below 2048 bytes before the first atomic call", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({
        refs: { track_ref: TRACK },
        budget: { max_response_bytes: 1_024, max_items: 1, max_inline_value_bytes: 64 },
      }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        return midiExecutionFor(child, NOTES);
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "blocked");
    assert.equal(response.error.code, "MIDI_RESPONSE_BUDGET_TOO_SMALL");
    assert.equal(response.result.data.requested_bytes, 1_024);
    assert.equal(response.result.data.minimum_bytes, 2_048);
    assert.equal(response.budget.max_bytes, 2_048);
    assert.equal(response.budget.actual_bytes <= 2_048, true, JSON.stringify(response.budget));
    assert.equal(calls.length, 0);
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
  });

  it("paginates and completely aggregates 128 notes with monotonic non-overlapping cursors", async () => {
    const notes = generatedNotes(128);
    const calls = [];
    const servedPages = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { notes }, refs: { track_ref: TRACK } }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        if (child.id === "template.midi.list_take_notes") {
          const cursor = Number(child.input.cursor);
          servedPages.push(notes.slice(cursor, cursor + child.input.limit));
        }
        return midiExecutionFor(child, notes);
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    const listCalls = calls.filter((call) => call.id === "template.midi.list_take_notes");
    assert.deepEqual(listCalls.map((call) => call.input.cursor), ["0", "64"]);
    assert.equal(listCalls.every((call) => call.budget.max_response_bytes === 65_536), true);
    assert.equal(response.result.data.verification.page_count, 2);
    assert.equal(response.result.data.verification.note_count, 128);
    const servedStarts = servedPages.flat().map((note) => note.start_ppq);
    assert.equal(servedStarts.length, 128);
    assert.equal(new Set(servedStarts).size, 128);
  });

  it("fails closed for non-progressing cursors, wrong advancing pages, and incomplete aggregation", async () => {
    const notes = generatedNotes(128);
    const cases = [
      {
        expectedCode: "MIDI_NOTE_LIST_CURSOR_NOT_ADVANCING",
        listReadback: () => pageReadback(notes.slice(0, 64), true, "0"),
      },
      {
        expectedCode: "MIDI_NOTE_LIST_READBACK_MISMATCH",
        listReadback: (child) => Number(child.input.cursor) === 0
          ? pageReadback(notes.slice(0, 64), true, "64")
          : pageReadback(notes.slice(0, 64), false),
      },
      {
        expectedCode: "MIDI_NOTE_LIST_READBACK_MISMATCH",
        listReadback: () => pageReadback(notes.slice(0, 64), false),
      },
    ];

    for (const testCase of cases) {
      const response = await executeAlpha3_2_5DMidiMacro({
        request: request({ input: { notes }, refs: { track_ref: TRACK } }),
        projectIndexRuntime: fakeIndex(),
        executeAtomic: async (child) => midiExecutionFor(child, notes, testCase.listReadback),
      });
      assert.equal(response.ok, false);
      assert.equal(response.error.code, testCase.expectedCode, JSON.stringify(response));
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.recovery.replay_policy, "do_not_replay");
    }
  });

  it("retains created refs and gives non-replay recovery after a mutation-stage response failure", async () => {
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        if (child.id === "template.midi.insert_notes_batch") {
          return { ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "Atomic response exceeded its complete-read budget." } };
        }
        return midiExecutionFor(child, NOTES);
      },
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.recovery.replay_policy, "do_not_replay");
    assert.equal(response.recovery.item_ref, ITEM);
    assert.equal(response.recovery.take_ref, TAKE);
    assert.match(response.recovery.action, /Do not replay/u);
    assert.match(response.recovery.action, /Read and resolve the existing take_ref/u);

    const createResponseFailure = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        if (child.id === "template.midi.create_midi_item") {
          return {
            ok: false,
            error: { code: "RESPONSE_TOO_LARGE", message: "Created refs survived an oversized response." },
            result: {
              readback: { item_ref: ITEM, take_ref: TAKE },
              refs: [objectRef("item", ITEM), objectRef("take", TAKE)],
            },
          };
        }
        return midiExecutionFor(child, NOTES);
      },
    });
    assert.equal(createResponseFailure.execution.status, "partial_failure");
    assert.equal(createResponseFailure.recovery.replay_policy, "do_not_replay");
    assert.equal(createResponseFailure.recovery.item_ref, ITEM);
    assert.equal(createResponseFailure.recovery.take_ref, TAKE);

    const partialCreateRefFailure = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        if (child.id === "template.midi.create_midi_item") {
          return {
            ok: false,
            error: { code: "RESPONSE_TOO_LARGE", message: "Only the created item ref survived." },
            result: { refs: [objectRef("item", ITEM)] },
          };
        }
        return midiExecutionFor(child, NOTES);
      },
    });
    assert.equal(partialCreateRefFailure.execution.status, "partial_failure");
    assert.equal(partialCreateRefFailure.recovery.replay_policy, "do_not_replay");
    assert.equal(partialCreateRefFailure.recovery.item_ref, ITEM);
    assert.equal(partialCreateRefFailure.recovery.take_ref, null);
    assert.match(partialCreateRefFailure.recovery.action, /retained item_ref/u);

    const unknownCreateCases = [
      {
        name: "failed response without refs",
        create: async () => ({ ok: false, error: { code: "MIDI_CREATE_RESPONSE_UNKNOWN", message: "Create dispatch returned no refs." } }),
      },
      {
        name: "thrown executor error",
        create: async () => { throw new Error("Create dispatch outcome is unknown."); },
      },
      {
        name: "successful response without refs",
        create: async () => executionFor(CREATE_ITEM_ID, {}),
      },
    ];
    for (const testCase of unknownCreateCases) {
      const calls = [];
      const unknownCreate = await executeAlpha3_2_5DMidiMacro({
        request: request({ refs: { track_ref: TRACK } }),
        executeAtomic: async (child) => {
          calls.push(child);
          if (child.id === CREATE_ITEM_ID) return testCase.create();
          return midiExecutionFor(child, NOTES);
        },
      });
      assert.equal(unknownCreate.ok, false, testCase.name);
      assert.equal(unknownCreate.execution.status, "partial_failure", testCase.name);
      assert.equal(unknownCreate.recovery.replay_policy, "do_not_replay", testCase.name);
      assert.deepEqual(calls.map((call) => call.id), ["template.tracks.resolve_track_ref", CREATE_ITEM_ID], testCase.name);
    }

    const beforeMutationCalls = [];
    const beforeMutation = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK } }),
      executeAtomic: async (child) => {
        beforeMutationCalls.push(child);
        return { ok: false, error: { code: "RESPONSE_TOO_LARGE", message: "Complete response unavailable." } };
      },
    });
    assert.equal(beforeMutation.error.code, "RESPONSE_TOO_LARGE");
    assert.equal(beforeMutation.execution.status, "failed");
    assert.equal(beforeMutation.recovery.replay_policy, "retry_after_blocker");
    assert.doesNotMatch(beforeMutation.recovery.action, /reduce|lower|smaller/iu);
    assert.deepEqual(beforeMutationCalls.map((call) => call.id), ["template.tracks.resolve_track_ref"]);
  });

  it("uses one unique B-layer selector candidate and live-validates it before write", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { selector: { name: "Lead" } } }),
      projectIndexRuntime: fakeIndex({ trackRows: [{ ref: TRACK, name: "Lead" }] }),
      executeAtomic: async (child) => {
        calls.push(child);
        return executionFor(child.id, child.id === "template.project.read_summary" ? { change_count: 1 } : child.id === "template.tracks.resolve_track_ref" ? { track_ref: TRACK } : child.id === "template.midi.create_midi_item" ? { item_ref: ITEM, take_ref: TAKE } : child.id === "template.midi.resolve_midi_take_ref" ? { take_ref: TAKE, item_ref: ITEM } : child.id === "template.midi.read_take_event_counts" ? { note_count: NOTES.length } : child.id === "template.midi.list_take_notes" ? { take_ref: TAKE, notes: NOTES, returned_count: NOTES.length, truncated: false } : { inserted_count: NOTES.length });
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.track_ref, TRACK);
    assert.equal(response.result.data.sqlite_selector_used, true);
    assert.equal(calls.findIndex((call) => call.id === "template.tracks.resolve_track_ref") < calls.findIndex((call) => call.id === "template.midi.create_midi_item"), true);
  });

  it("returns three canonical patches for ambiguous Chinese Track names before mutation", async () => {
    const calls = [];
    const trackRows = ["A", "B", "C", "D"].map((suffix, index) => ({
      ref: `track:guid:{TRACK-${suffix}}`,
      name: "对白 主轨",
      index,
    }));
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ input: { selector: { name: "对白 主轨" } } }),
      projectIndexRuntime: fakeIndex({ trackRows }),
      executeAtomic: async (child) => {
        calls.push(child);
        if (child.id === "template.project.read_summary") return executionFor(child.id, { change_count: 1 });
        throw new Error(`Unexpected Template after ambiguous selector: ${child.id}`);
      },
    });

    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.execution.status, "failed");
    assert.equal(response.error.code, "MIDI_TRACK_SELECTOR_AMBIGUOUS");
    assert.deepEqual(response.blockers[0].details, {
      entity: "tracks",
      candidate_count: 3,
      candidates_truncated: true,
      candidates: trackRows.slice(0, 3).map((row) => ({
        kind: "track",
        ref: row.ref,
        name: row.name,
        index: row.index,
        request_patch: { refs: { track_ref: row.ref } },
      })),
    });
    assert.deepEqual(calls.map((call) => call.id), ["template.project.read_summary"]);
  });

  it("keeps verified MIDI changes applied when only index maintenance fails", async () => {
    const response = await executeAlpha3_2_5DMidiMacro({
      request: request({ refs: { track_ref: TRACK }, budget: { max_response_bytes: 2_048 } }),
      projectIndexRuntime: fakeIndex({ invalidateFailure: true }),
      executeAtomic: async (child) => executionFor(child.id,
        child.id === "template.midi.create_midi_item"
          ? { item_ref: ITEM, take_ref: TAKE }
          : child.id === "template.midi.read_take_event_counts"
            ? { take_ref: TAKE, note_count: NOTES.length, cc_count: 0, text_sysex_count: 0 }
            : child.id === "template.midi.list_take_notes"
              ? { take_ref: TAKE, notes: NOTES, returned_count: NOTES.length, truncated: false }
              : child.id === "template.midi.resolve_midi_take_ref"
                ? { take_ref: TAKE, item_ref: ITEM }
                : child.id === "template.tracks.resolve_track_ref"
                  ? { track_ref: TRACK }
                  : { take_ref: TAKE, inserted_count: NOTES.length }),
    });

    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "INDEX_WRITE_FAILED");
    assert.equal(response.result.verification.status, "passed");
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
    assert.equal(response.result.changes.every((change) => change.live_readback.status === "passed"), true);
    assert.equal(response.result.changes.every((change) => change.index_maintenance.status === "failed"), true);
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
    assert.equal(response.result.data.outcome.index_maintenance.status, "failed");
    assert.equal(response.result.changes.length, 2);
    assert.equal(response.result.data.outcome.mutation.status, "completed");
    assert.equal(response.budget.actual_bytes <= 2_048, true, JSON.stringify(response.budget));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
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
    assert.equal(failedChild.result.changes.every((change) => change.status !== "applied"), true);
    assert.equal(failedChild.recovery.replay_policy, "do_not_replay");
    assert.equal(failedChild.recovery.item_ref, ITEM);
    assert.equal(failedChild.recovery.take_ref, TAKE);

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

function request({ input = {}, refs = {}, budget } = {}) {
  return {
    id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
    input: { start_seconds: 0, end_seconds: 2, notes: NOTES, ...input },
    refs,
    context: { session_id: "d-test", request_sequence: 1 },
    ...(budget === undefined ? {} : { budget }),
  };
}

function executionFor(id, readback, verificationStatus = "passed") {
  return { ok: true, request: { id }, verification: { status: verificationStatus }, result: { readback, refs: Object.entries(readback).filter(([key, value]) => key.endsWith("_ref") && typeof value === "string").map(([key, ref]) => objectRef(key.slice(0, -4), ref)) } };
}

function midiExecutionFor(child, notes, listReadback) {
  if (child.id === "template.tracks.resolve_track_ref") return executionFor(child.id, { track_ref: TRACK });
  if (child.id === "template.midi.create_midi_item") return executionFor(child.id, { item_ref: ITEM, take_ref: TAKE });
  if (child.id === "template.midi.insert_notes_batch") return executionFor(child.id, { take_ref: TAKE, inserted_count: notes.length });
  if (child.id === "template.midi.resolve_midi_take_ref") return executionFor(child.id, { take_ref: TAKE, item_ref: ITEM });
  if (child.id === "template.midi.read_take_event_counts") return executionFor(child.id, { take_ref: TAKE, note_count: notes.length, cc_count: 0, text_sysex_count: 0 });
  if (child.id === "template.midi.list_take_notes") {
    if (typeof listReadback === "function") return executionFor(child.id, { take_ref: TAKE, ...listReadback(child) });
    const cursor = Number(child.input.cursor ?? 0);
    const page = notes.slice(cursor, cursor + child.input.limit);
    const next = cursor + page.length;
    return executionFor(child.id, {
      take_ref: TAKE,
      notes: page,
      returned_count: page.length,
      truncated: next < notes.length,
      ...(next < notes.length ? { next_cursor: String(next) } : {}),
    });
  }
  return executionFor(child.id, {});
}

function pageReadback(notes, truncated, nextCursor) {
  return {
    notes,
    returned_count: notes.length,
    truncated,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
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

function fakeIndex({ trackRows = [{ ref: TRACK, name: "Lead" }], invalidateFailure = false } = {}) {
  return {
    invalidated: [],
    status: () => ({ snapshot_id: "snapshot:d", revision: "revision:d", rows_available: true, row_counts: { tracks: trackRows.length } }),
    invalidateScopes({ scopes }) {
      this.invalidated = scopes;
      return invalidateFailure
        ? { ok: false, scopes, blockers: [{ code: "INDEX_WRITE_FAILED", message: "Index maintenance failed.", recoverable: true }] }
        : { ok: true, scopes };
    },
    adapter: {
      snapshot: () => ({ lifecycle: "ready", snapshot_id: "snapshot:d", freshness_scopes: { tracks: { status: "fresh", coverage_status: "complete" } }, rows: { tracks: trackRows } }),
    },
  };
}
