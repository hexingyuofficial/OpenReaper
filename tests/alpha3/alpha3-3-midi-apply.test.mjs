import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA3_3_MIDI_APPLY_MACRO_ID,
  ALPHA3_3_MIDI_APPLY_MODES,
  ALPHA3_3_MIDI_APPLY_REGISTRY,
  createAlpha3_3MidiApplyDiscoveryItem,
  createAlpha3_3MidiApplyExactManual,
  executeAlpha3_3MidiApplyMacro,
  isAlpha3_3MidiApplyMacroId,
} from "../../packages/mcp-server/src/alpha3-3-midi-apply-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";

const TAKE_A = "take:guid:{MIDI-TAKE-A}";
const TAKE_B = "take:guid:{MIDI-TAKE-B}";

describe("Alpha3.3 macro.midi.apply", () => {
  it("registers one exact-take executable and exposes the canonical modes/manual", () => {
    assert.equal(isAlpha3_3MidiApplyMacroId(ALPHA3_3_MIDI_APPLY_MACRO_ID), true);
    assert.deepEqual(ALPHA3_3_MIDI_APPLY_REGISTRY.ids, [ALPHA3_3_MIDI_APPLY_MACRO_ID]);
    assert.deepEqual(ALPHA3_3_MIDI_APPLY_MODES, ["edit_notes", "quantize", "write_cc"]);
    assert.deepEqual(createAlpha3_3MidiApplyDiscoveryItem().supported_modes, ALPHA3_3_MIDI_APPLY_MODES);
    assert.match(createAlpha3_3MidiApplyExactManual().action_manual.input_shape.operations, /1-8/);
    assert.match(createAlpha3_3MidiApplyExactManual().action_manual.readback_steps.join(" "), /complete/i);
  });

  it("edits two exact Takes and marks each applied only after independent complete readback", async () => {
    const fixture = midiFixture({
      [TAKE_A]: { notes: [note(0, 0, 120, 60, 80)] },
      [TAKE_B]: { notes: [note(0, 120, 240, 64, 90)] },
    });
    const index = fakeIndex();
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [
        { operation_id: "velocity-a", take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] },
        { operation_id: "pitch-b", take_ref: TAKE_B, notes: [{ index: 0, pitch: 67 }] },
      ], false),
      executeAtomic: fixture.execute,
      projectIndexRuntime: index,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assert.deepEqual(response.result.changes.map((row) => row.status), ["applied", "applied"]);
    assert.equal(response.result.changes.every((row) => row.live_readback.status === "passed"), true);
    assert.equal(response.result.changes.every((row) => row.mutation.status === "completed"), true);
    assert.deepEqual(index.scopes, ["items", "takes"]);
    assert.equal(fixture.state[TAKE_A].notes[0].velocity, 100);
    assert.equal(fixture.state[TAKE_B].notes[0].pitch, 67);
    assert.equal(response.result.data.outcome.live_readback.status, "passed");
  });

  it("quantizes all notes or only selected notes against exact live rows", async () => {
    const fixture = midiFixture({
      [TAKE_A]: { notes: [note(0, 70, 170, 60, 80, true), note(1, 190, 290, 62, 90, false)] },
      [TAKE_B]: { notes: [note(0, 70, 170, 64, 90, true)] },
    });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("quantize", [
        { take_ref: TAKE_A, grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true, selected_only: true },
        { take_ref: TAKE_B, grid_unit: "take_grid", strength: 1, preserve_duration: true },
      ], false),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(fixture.state[TAKE_A].notes[0].start_ppq, 120);
    assert.equal(fixture.state[TAKE_A].notes[1].start_ppq, 190);
    assert.equal(fixture.state[TAKE_B].notes[0].start_ppq, 120);
    assert.equal(response.result.changes.every((row) => row.live_readback.coverage_complete), true);
  });

  it("inserts CC rows and proves the exact complete multiset delta", async () => {
    const fixture = midiFixture({ [TAKE_A]: { cc: [cc(0, 0, 1, 10)] } });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("write_cc", [{ take_ref: TAKE_A, events: [
        { ppq: 120, channel: 0, controller: 1, value: 64 },
        { ppq: 240, channel: 1, controller: 11, value: 100, selected: true },
      ] }], false),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(fixture.state[TAKE_A].cc.length, 3);
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.after_count, 3);
  });

  it("defaults to dry_run after real exact resolution and complete preflight but never mutates or invalidates", async () => {
    const fixture = midiFixture({ [TAKE_A]: { notes: [note(0, 0, 120, 60, 80)] } });
    const index = fakeIndex();
    const response = await executeAlpha3_3MidiApplyMacro({
      request: { id: ALPHA3_3_MIDI_APPLY_MACRO_ID, input: { mode: "edit_notes", operations: [{ take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] }] }, context: context() },
      executeAtomic: fixture.execute,
      projectIndexRuntime: index,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.execution.status, "dry_run_completed");
    assert.equal(fixture.state[TAKE_A].notes[0].velocity, 80);
    assert.equal(fixture.calls.some((call) => call.id === "template.midi.set_notes_batch"), false);
    assert.equal(index.scopes, null);
    assert.equal(response.result.changes[0].mutation.status, "not_run");
  });

  it("fails closed before mutation for non-GUID, duplicate, or incomplete Take coverage", async () => {
    let calls = 0;
    const invalid = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [{ take_ref: "take:index:0", notes: [{ index: 0, velocity: 100 }] }]),
      executeAtomic: async () => { calls += 1; },
    });
    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.code, "MIDI_EXACT_TAKE_REF_REQUIRED");
    assert.equal(calls, 0);

    const duplicate = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [
        { take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] },
        { take_ref: TAKE_A, notes: [{ index: 1, velocity: 90 }] },
      ]),
      executeAtomic: async () => { calls += 1; },
    });
    assert.equal(duplicate.error.code, "MIDI_DUPLICATE_TAKE_OPERATION");

    const fixture = midiFixture({ [TAKE_A]: { notes: Array.from({ length: 101 }, (_, index) => note(index, index * 120, (index + 1) * 120, 60, 80)) } });
    const incomplete = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [{ take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] }], false),
      executeAtomic: fixture.execute,
    });
    assert.equal(incomplete.ok, false);
    assert.equal(incomplete.error.code, "MIDI_COMPLETE_READBACK_REQUIRED");
    assert.equal(fixture.calls.some((call) => call.id === "template.midi.set_notes_batch"), false);

    const unselected = midiFixture({ [TAKE_A]: { notes: [note(0, 70, 170, 60, 80, false)] } });
    const selectedOnly = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("quantize", [{ take_ref: TAKE_A, grid_unit: "ppq", grid_ppq: 120, selected_only: true }], false),
      executeAtomic: unselected.execute,
    });
    assert.equal(selectedOnly.ok, false);
    assert.equal(selectedOnly.error.code, "MIDI_SELECTED_NOTES_REQUIRED");
    assert.equal(unselected.calls.some((call) => call.id === "template.midi.quantize_selected_notes"), false);
  });

  it("never reports applied from dispatch success when independent readback mismatches", async () => {
    const fixture = midiFixture({ [TAKE_A]: { notes: [note(0, 0, 120, 60, 80)] } }, { ignoreMutations: true });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [{ take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] }], false),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MIDI_LIVE_READBACK_MISMATCH");
    assert.equal(response.result.changes[0].status, "pending");
    assert.equal(response.result.changes[0].mutation.status, "completed");
    assert.equal(response.result.changes[0].live_readback.status, "failed");
    assert.equal(response.result.changes[0].index_maintenance.status, "completed");
  });

  it("keeps atomic failure, desired live state, and later not-run rows as separate truth", async () => {
    const fixture = midiFixture({
      [TAKE_A]: { notes: [note(0, 0, 120, 60, 80)] },
      [TAKE_B]: { notes: [note(0, 120, 240, 64, 90)] },
    }, { failMutationAfterApply: true });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [
        { operation_id: "first", take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] },
        { operation_id: "second", take_ref: TAKE_B, notes: [{ index: 0, pitch: 67 }] },
      ], false),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex(),
    });
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "MUTATION_RESPONSE_LOST");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].mutation.status, "unknown_or_partial");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[1].status, "not_run");
    assert.equal(response.result.changes[1].mutation.status, "not_run");
    assert.equal(fixture.state[TAKE_A].notes[0].velocity, 100);
    assert.equal(fixture.state[TAKE_B].notes[0].pitch, 64);
  });

  it("accepts exactly 100 complete rows and reads actual runtime summary-shaped results", async () => {
    const notes = Array.from({ length: 100 }, (_, index) => note(index, index * 120, (index + 1) * 120, 60, 80));
    const fixture = midiFixture({ [TAKE_A]: { notes } }, { summaryShape: true });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [{ take_ref: TAKE_A, notes: [{ index: 99, velocity: 101 }] }], false),
      executeAtomic: fixture.execute,
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(fixture.state[TAKE_A].notes.length, 100);
    assert.equal(fixture.state[TAKE_A].notes[99].velocity, 101);
    assert.equal(response.result.changes[0].live_readback.coverage_complete, true);
  });

  it("keeps verified applied truth separate when only index maintenance fails", async () => {
    const fixture = midiFixture({ [TAKE_A]: { notes: [note(0, 0, 120, 60, 80)] } });
    const response = await executeAlpha3_3MidiApplyMacro({
      request: macroRequest("edit_notes", [{ take_ref: TAKE_A, notes: [{ index: 0, velocity: 100 }] }], false),
      executeAtomic: fixture.execute,
      projectIndexRuntime: fakeIndex({ fail: true }),
    });
    assert.equal(response.ok, false);
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.error.code, "INDEX_FAIL");
    assert.equal(response.result.changes[0].status, "applied");
    assert.equal(response.result.changes[0].live_readback.status, "passed");
    assert.equal(response.result.changes[0].index_maintenance.status, "failed");
    assert.equal(response.result.verification.status, "passed");
  });
});

function macroRequest(mode, operations, dryRun = true) {
  return { id: ALPHA3_3_MIDI_APPLY_MACRO_ID, input: { mode, operations, dry_run: dryRun }, context: context() };
}

function context() {
  return { request_id: "midi-apply-test", session_id: "midi-test", expected_owner: "owner", expected_generation: 1, created_at: "2026-07-14T00:00:00.000Z", request_sequence: 1 };
}

function note(index, start, end, pitch, velocity, selected = false) {
  return { index, selected, muted: false, start_ppq: start, end_ppq: end, channel: 0, pitch, velocity };
}

function cc(index, ppq, controller, value, channel = 0) {
  return { index, selected: false, muted: false, ppq, channel_message: 176, channel, controller, value };
}

function midiFixture(seed, { ignoreMutations = false, failMutationAfterApply = false, summaryShape = false } = {}) {
  const state = structuredClone(seed);
  for (const take of Object.values(state)) { take.notes ??= []; take.cc ??= []; take.grid_ppq ??= 120; renumber(take); }
  const calls = [];
  return {
    state,
    calls,
    execute: async (call) => {
      calls.push(structuredClone(call));
      const ref = call.input?.ref ?? call.refs?.take_ref?.ref;
      const take = state[ref];
      if (!take) return execution(call.id, {}, { ok: false, code: "TAKE_NOT_FOUND" });
      if (call.id === "template.midi.resolve_midi_take_ref") return execution(call.id, { take_ref: ref }, { refs: [objectRef(ref)], summaryShape });
      if (call.id === "template.midi.read_take_event_counts") return execution(call.id, { take_ref: ref, note_count: take.notes.length, cc_count: take.cc.length, text_sysex_count: 0, take_hash: takeHash(ref, take) }, { summaryShape });
      if (call.id === "template.midi.list_take_notes") return execution(call.id, { take_ref: ref, notes: structuredClone(take.notes.slice(0, 100)), returned_count: Math.min(take.notes.length, 100), truncated: take.notes.length > 100 }, { summaryShape });
      if (call.id === "template.midi.list_take_cc_events") return execution(call.id, { take_ref: ref, cc_events: structuredClone(take.cc.slice(0, 100)), returned_count: Math.min(take.cc.length, 100), truncated: take.cc.length > 100 }, { summaryShape });
      if (call.id === "template.midi.read_take_grid") return execution(call.id, { take_ref: ref, grid_ppq: take.grid_ppq }, { summaryShape });
      if (call.id === "template.midi.set_notes_batch") {
        if (!ignoreMutations) for (const edit of call.input.notes) Object.assign(take.notes.find((row) => row.index === edit.index), edit);
        renumber(take);
        if (failMutationAfterApply) return execution(call.id, {}, { ok: false, code: "MUTATION_RESPONSE_LOST" });
        return execution(call.id, { take_ref: ref, updated_count: call.input.notes.length, take_hash: takeHash(ref, take) }, { summaryShape });
      }
      if (["template.midi.quantize_notes", "template.midi.quantize_selected_notes"].includes(call.id)) {
        if (!ignoreMutations) {
          const grid = call.input.grid_unit === "ppq" ? call.input.grid_ppq : take.grid_ppq;
          for (const row of take.notes) if (call.id === "template.midi.quantize_notes" || row.selected) {
            const target = Math.floor((row.start_ppq / grid) + 0.5) * grid;
            const start = row.start_ppq;
            const next = start + ((target - start) * call.input.strength);
            if (call.input.preserve_duration) row.end_ppq = next + (row.end_ppq - start);
            row.start_ppq = next;
          }
        }
        renumber(take);
        if (failMutationAfterApply) return execution(call.id, {}, { ok: false, code: "MUTATION_RESPONSE_LOST" });
        return execution(call.id, { take_ref: ref, updated_count: take.notes.length, take_hash: takeHash(ref, take) }, { summaryShape });
      }
      if (call.id === "template.midi.insert_cc_batch") {
        if (!ignoreMutations) for (const event of call.input.events) take.cc.push({ index: take.cc.length, selected: event.selected ?? false, muted: event.muted ?? false, ppq: event.ppq, channel_message: 176, channel: event.channel, controller: event.controller, value: event.value });
        renumber(take);
        if (failMutationAfterApply) return execution(call.id, {}, { ok: false, code: "MUTATION_RESPONSE_LOST" });
        return execution(call.id, { take_ref: ref, inserted_count: call.input.events.length, cc_count: take.cc.length, take_hash: takeHash(ref, take) }, { summaryShape });
      }
      throw new Error(`Unexpected child ${call.id}`);
    },
  };
}

function execution(id, readback, { ok = true, code = null, refs = [], summaryShape = false } = {}) {
  return ok
    ? { ok: true, request: { id }, template: { id }, verification: { status: "passed" }, result: summaryShape ? { summary: readback, readback: null, refs } : { readback, refs } }
    : { ok: false, request: { id }, template: { id }, error: { code, message: code, recoverable: true } };
}

function objectRef(ref) {
  return { kind: "take", ref, identity: { scheme: "guid", value: ref.slice("take:guid:".length) } };
}

function takeHash(ref, take) { return `${ref}:${take.notes.length}:${take.cc.length}:0`; }
function renumber(take) { take.notes.sort((a, b) => a.start_ppq - b.start_ppq).forEach((row, index) => { row.index = index; }); take.cc.sort((a, b) => a.ppq - b.ppq).forEach((row, index) => { row.index = index; }); }

function fakeIndex({ fail = false } = {}) {
  return {
    scopes: null,
    status: () => ({ snapshot_id: "snapshot:midi", revision: "revision:midi" }),
    invalidateScopes({ scopes }) {
      this.scopes = scopes;
      return fail ? { ok: false, blockers: [{ code: "INDEX_FAIL", message: "Index failed.", recoverable: true }] } : { ok: true, scopes };
    },
  };
}
