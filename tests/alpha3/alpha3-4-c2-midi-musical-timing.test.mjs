import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import {
  ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
  createAlpha3_2_5DMidiMacroDiscoveryItem,
  executeAlpha3_2_5DMidiMacro,
} from "../../packages/mcp-server/src/alpha3-2-5-d-midi-macro-v1.mjs";
import {
  createAlpha3_3B1ExactMacroExpansion,
} from "../../packages/mcp-server/src/alpha3-3-b1-agent-context-macro-guide-v1.mjs";
import {
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";
import { createAlpha34BFirstTryExecutionGuide } from "../../packages/mcp-server/src/alpha3-4-b-discovery-manual-v1.mjs";
import { createCallTemplateRuntime } from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { validateMacroExecutionEnvelope } from "../../packages/mcp-server/src/macro-runtime-contract-v1.mjs";
import { OPENREAPER_PUBLIC_TOOL_IDS } from "../../packages/mcp-server/src/openreaper-agent-start-here-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const TRACK = "track:guid:{TRACK-C2}";
const ITEM = "item:guid:{ITEM-C2}";
const TAKE = "take:guid:{TAKE-C2}";
const CREATE_ITEM_ID = "template.midi.create_midi_item";
const INSERT_NOTES_ID = "template.midi.insert_notes_batch";
const LIST_NOTES_ID = "template.midi.list_take_notes";
const LEGACY_NOTES = [
  { start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 },
  { start_ppq: 480, end_ppq: 960, pitch: 64, velocity: 88, channel: 0 },
];
const MUSICAL_NOTES = [
  { start_offset_quarter_notes: 0, end_offset_quarter_notes: 1, pitch: 60, velocity: 96, channel: 0 },
  { start_offset_quarter_notes: 1, end_offset_quarter_notes: 2, pitch: 62, velocity: 96, channel: 0 },
  { start_offset_quarter_notes: 2, end_offset_quarter_notes: 3, pitch: 64, velocity: 96, channel: 0 },
  { start_offset_quarter_notes: 3, end_offset_quarter_notes: 4, pitch: 65, velocity: 96, channel: 0 },
];
const ITEM_START_QN = 4;
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"),
);

describe("Alpha3.4-C2 upper MIDI musical timing", () => {
  it("keeps public counts at 5 tools / 15 macros / 232 templates / 91 handlers", () => {
    assert.equal(OPENREAPER_PUBLIC_TOOL_IDS.length, 5);
    assert.equal(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS.length, 15);
    assert.equal(new Set(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS).size, 15);
    assert.equal(REGISTRY.entries.length, 232);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 232);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    const discovery = createAlpha3_2_5DMidiMacroDiscoveryItem();
    assert.match(JSON.stringify(discovery.examples), /duration_quarter_notes/);
    assert.doesNotMatch(JSON.stringify(discovery.examples), /\b480\b|\b960\b/);
  });

  it("creates four quarter notes from non-zero live item start_qn without Macro-side tempo math", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: musicalRequest(),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(structuredClone(child));
        return musicalExecutionFor(child, MUSICAL_NOTES, { itemStartQn: ITEM_START_QN });
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.deepEqual(validateMacroExecutionEnvelope(response), { valid: true, errors: [] });
    assert.equal(response.result.data.coordinate_mode, "musical");
    assert.equal(response.result.data.start_qn, ITEM_START_QN);
    assert.equal(response.result.data.end_qn, ITEM_START_QN + 4);
    assert.equal(response.result.data.verification.note_count, 4);
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);

    const createCall = calls.find((call) => call.id === CREATE_ITEM_ID);
    assert.deepEqual(createCall.input, { start_seconds: 0, duration_quarter_notes: 4 });
    assert.equal("end_seconds" in createCall.input, false);

    const insertCall = calls.find((call) => call.id === INSERT_NOTES_ID);
    assert.equal(insertCall.input.position_unit, "project_qn");
    assert.deepEqual(insertCall.input.notes, [
      { start_qn: 4, end_qn: 5, pitch: 60, velocity: 96, channel: 0 },
      { start_qn: 5, end_qn: 6, pitch: 62, velocity: 96, channel: 0 },
      { start_qn: 6, end_qn: 7, pitch: 64, velocity: 96, channel: 0 },
      { start_qn: 7, end_qn: 8, pitch: 65, velocity: 96, channel: 0 },
    ]);
    assert.equal(JSON.stringify(insertCall).includes("480"), false);
    assert.equal(JSON.stringify(insertCall).includes("tempo"), false);

    const listCalls = calls.filter((call) => call.id === LIST_NOTES_ID);
    assert.equal(listCalls.length, 1);
    assert.equal(listCalls[0].input.include_project_qn, true);
    assert.equal(listCalls[0].input.include_project_time, true);
  });

  it("rejects mixed, ambiguous, out-of-range, and seconds note coordinates with zero atomic calls", async () => {
    const cases = [
      {
        name: "both bounds",
        input: { start_seconds: 0, end_seconds: 2, duration_quarter_notes: 4, notes: MUSICAL_NOTES },
        code: "MIDI_CLIP_BOUNDS_AMBIGUOUS",
      },
      {
        name: "neither bound",
        input: { start_seconds: 0, notes: MUSICAL_NOTES },
        code: "MIDI_CLIP_BOUNDS_AMBIGUOUS",
      },
      {
        name: "mixed note coordinates",
        input: {
          start_seconds: 0,
          duration_quarter_notes: 4,
          notes: [{ start_offset_quarter_notes: 0, end_offset_quarter_notes: 1, start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
        },
        code: "MIDI_NOTE_COORDINATE_MIXED",
      },
      {
        name: "note past duration",
        input: {
          start_seconds: 0,
          duration_quarter_notes: 2,
          notes: [{ start_offset_quarter_notes: 0, end_offset_quarter_notes: 3, pitch: 60, velocity: 96, channel: 0 }],
        },
        code: "MIDI_NOTE_OFFSET_OUT_OF_RANGE",
      },
      {
        name: "fractionally past duration",
        input: {
          start_seconds: 0,
          duration_quarter_notes: 4,
          notes: [{ start_offset_quarter_notes: 3, end_offset_quarter_notes: 4.0000001, pitch: 60, velocity: 96, channel: 0 }],
        },
        code: "MIDI_NOTE_OFFSET_OUT_OF_RANGE",
      },
      {
        name: "seconds note fields",
        input: {
          start_seconds: 0,
          duration_quarter_notes: 4,
          notes: [{ start_seconds: 0, end_seconds: 1, pitch: 60, velocity: 96, channel: 0 }],
        },
        code: "MIDI_SECONDS_MODE_BLOCKED",
      },
      {
        name: "too many notes",
        input: {
          start_seconds: 0,
          duration_quarter_notes: 4,
          notes: Array.from({ length: 129 }, (_, index) => ({
            start_offset_quarter_notes: 0,
            end_offset_quarter_notes: 1,
            pitch: 60,
            velocity: 96,
            channel: index % 16,
          })),
        },
        code: "MIDI_CLIP_NOTES_INVALID",
      },
    ];

    for (const testCase of cases) {
      const calls = [];
      const response = await executeAlpha3_2_5DMidiMacro({
        request: {
          id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
          input: testCase.input,
          refs: { track_ref: TRACK },
          context: { session_id: "c2", request_sequence: 1 },
        },
        projectIndexRuntime: fakeIndex(),
        executeAtomic: async (child) => {
          calls.push(child);
          return musicalExecutionFor(child, MUSICAL_NOTES);
        },
      });
      assert.equal(response.ok, false, testCase.name);
      assert.equal(response.error.code, testCase.code, `${testCase.name}: ${JSON.stringify(response)}`);
      assert.equal(calls.length, 0, testCase.name);
    }
  });

  it("paginates 128 musical notes with complete QN/PPQ/project-time live rows and keeps 2 KiB public budget", async () => {
    const notes = generatedMusicalNotes(128);
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: {
        id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
        input: {
          start_seconds: 0,
          duration_quarter_notes: 128,
          notes,
          dry_run: false,
        },
        refs: { track_ref: TRACK },
        context: { session_id: "c2", request_sequence: 2 },
        budget: { max_response_bytes: 2_048, max_items: 1, max_inline_value_bytes: 64 },
      },
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        return musicalExecutionFor(child, notes, { itemStartQn: ITEM_START_QN, durationQuarterNotes: 128 });
      },
    });

    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.budget.actual_bytes <= 2_048, true, JSON.stringify(response.budget));
    assert.equal("notes" in response.result.data, false);
    assert.equal(response.result.data.verification.note_count, 128);
    assert.equal(response.result.data.verification.page_count, 2);
    const listCalls = calls.filter((call) => call.id === LIST_NOTES_ID);
    assert.deepEqual(listCalls.map((call) => call.input.cursor), ["0", "64"]);
    assert.equal(listCalls.every((call) => call.input.include_project_qn === true), true);
    assert.equal(listCalls.every((call) => call.input.include_project_time === true), true);
  });

  it("fails closed for incomplete pages and one wrong live note blocks applied", async () => {
    const notes = generatedMusicalNotes(4);
    const cases = [
      {
        expectedCode: "MIDI_NOTE_LIST_CURSOR_NOT_ADVANCING",
        listReadback: () => pageReadback(liveMusicalRows(notes, ITEM_START_QN).slice(0, 2), true, "0"),
      },
      {
        expectedCode: "MIDI_NOTE_LIST_READBACK_MISMATCH",
        listReadback: () => pageReadback(liveMusicalRows(notes, ITEM_START_QN).slice(0, 2), false),
      },
      {
        expectedCode: "MIDI_NOTE_LIST_READBACK_MISMATCH",
        listReadback: () => {
          const rows = liveMusicalRows(notes, ITEM_START_QN);
          rows[1] = { ...rows[1], pitch: 1 };
          return pageReadback(rows, false);
        },
      },
    ];

    for (const testCase of cases) {
      const response = await executeAlpha3_2_5DMidiMacro({
        request: musicalRequest({ notes }),
        projectIndexRuntime: fakeIndex(),
        executeAtomic: async (child) => musicalExecutionFor(child, notes, {
          itemStartQn: ITEM_START_QN,
          listReadback: testCase.listReadback,
        }),
      });
      assert.equal(response.ok, false, testCase.expectedCode);
      assert.equal(response.error.code, testCase.expectedCode, JSON.stringify(response));
      assert.equal(response.execution.status, "partial_failure");
      assert.equal(response.result.changes.every((change) => change.status !== "applied"), true);
    }
  });

  it("accepts two identical full pages when the requested MIDI multiset contains legitimate duplicate notes", async () => {
    const notes = Array.from({ length: 128 }, () => ({
      start_offset_quarter_notes: 0,
      end_offset_quarter_notes: 1,
      pitch: 60,
      velocity: 96,
      channel: 0,
    }));
    const response = await executeAlpha3_2_5DMidiMacro({
      request: musicalRequest({ notes, durationQuarterNotes: 1 }),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => musicalExecutionFor(child, notes, {
        itemStartQn: ITEM_START_QN,
        durationQuarterNotes: 1,
      }),
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.verification.page_count, 2);
    assert.equal(response.result.changes.every((change) => change.status === "applied"), true);
  });

  it("stops after item creation when live QN duration does not match the requested duration", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: musicalRequest(),
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        return musicalExecutionFor(child, MUSICAL_NOTES, {
          itemStartQn: ITEM_START_QN,
          durationQuarterNotes: 3.5,
        });
      },
    });
    assert.equal(response.ok, false, JSON.stringify(response));
    assert.equal(response.error.code, "MIDI_CREATE_QN_EXTENT_MISMATCH");
    assert.equal(response.execution.status, "partial_failure");
    assert.equal(response.result.changes.length, 1);
    assert.equal(response.result.changes[0].status, "mutation_completed");
    assert.equal(calls.some((call) => call.id === INSERT_NOTES_ID), false);
  });

  it("preserves legacy PPQ create_clips callers", async () => {
    const calls = [];
    const response = await executeAlpha3_2_5DMidiMacro({
      request: {
        id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
        input: {
          start_seconds: 0,
          end_seconds: 2,
          notes: LEGACY_NOTES,
          dry_run: false,
        },
        refs: { track_ref: TRACK },
        context: { session_id: "c2", request_sequence: 3 },
      },
      projectIndexRuntime: fakeIndex(),
      executeAtomic: async (child) => {
        calls.push(child);
        return legacyExecutionFor(child, LEGACY_NOTES);
      },
    });
    assert.equal(response.ok, true, JSON.stringify(response));
    assert.equal(response.result.data.coordinate_mode, "legacy_ppq");
    const createCall = calls.find((call) => call.id === CREATE_ITEM_ID);
    assert.deepEqual(createCall.input, { start_seconds: 0, end_seconds: 2 });
    const insertCall = calls.find((call) => call.id === INSERT_NOTES_ID);
    assert.equal(insertCall.input.position_unit, "ppq");
    assert.deepEqual(insertCall.input.notes, LEGACY_NOTES);
    const listCall = calls.find((call) => call.id === LIST_NOTES_ID);
    assert.equal(listCall.input.include_project_qn, undefined);
    assert.equal(listCall.input.include_project_time, false);
  });

  it("publishes musical default examples and recommends macro.midi.apply for quarter-note wording", () => {
    const discovery = createAlpha3_2_5DMidiMacroDiscoveryItem();
    assert.equal(discovery.examples[0].input.duration_quarter_notes, 4);
    assert.equal(discovery.examples[0].input.notes[0].start_offset_quarter_notes, 0);
    assert.equal(discovery.task_intents.includes("write four quarter notes"), true);
    assert.equal(discovery.task_intents.includes("写四个四分音符"), true);

    const expansion = createAlpha3_3B1ExactMacroExpansion("macro.midi.apply");
    const createExample = expansion.action_manual.examples.find((entry) => entry?.input?.mode === "create_clips" || entry?.input?.notes);
    assert.equal(createExample.input.mode, "create_clips");
    assert.equal(createExample.input.duration_quarter_notes, 4);
    assert.doesNotMatch(JSON.stringify(createExample.input), /\b480\b|\b960\b/);
    assert.match(expansion.action_manual.when_to_use.join(" "), /write four quarter notes|写四个四分音符/u);
    assert.doesNotMatch(expansion.action_manual.when_not_to_use.join(" "), /do not use (?:this slice )?to create clips/iu);
    assert.match(expansion.action_manual.dry_run_shape.behavior, /create_clips/u);
    assert.match(expansion.action_manual.dry_run_shape.behavior, /existing-Take modes/u);

    const runtime = createCallTemplateRuntime();
    const listed = runtime.list_templates({ ids: ["macro.midi.apply"], fields: ["id", "inputSchema", "examples"] });
    const createSchema = listed.items[0].inputSchema.oneOf[0];
    assert.equal(createSchema.oneOf.length, 2);
    assert.deepEqual(createSchema.oneOf[0].required, ["duration_quarter_notes"]);
    assert.deepEqual(createSchema.oneOf[0].properties.notes.items.required, [
      "start_offset_quarter_notes",
      "end_offset_quarter_notes",
      "pitch",
      "velocity",
      "channel",
    ]);
    const guide = createAlpha34BFirstTryExecutionGuide("macro.midi.apply", listed.items[0]);
    const createCall = guide.next_calls.find((entry) => entry.tool === "call_template" && entry.arguments?.id === "macro.midi.apply");
    assert.ok(createCall);
    assert.equal(createCall.arguments.input.duration_quarter_notes, 4);
    assert.doesNotMatch(JSON.stringify(createCall.arguments.input), /\b480\b|\b960\b/);

    const english = runtime.list_templates({ query: "write four quarter notes", limit: 10 });
    const chinese = runtime.list_templates({ query: "写四个四分音符", limit: 10 });
    assert.equal(english.items.some((item) => item.id === "macro.midi.apply"), true);
    assert.equal(chinese.items.some((item) => item.id === "macro.midi.apply"), true);
  });
});

function musicalRequest({ notes = MUSICAL_NOTES, durationQuarterNotes = 4 } = {}) {
  return {
    id: ALPHA3_2_5_D_MIDI_CREATE_CLIP_MACRO_ID,
    input: {
      start_seconds: 0,
      duration_quarter_notes: durationQuarterNotes,
      notes,
      dry_run: false,
    },
    refs: { track_ref: TRACK },
    context: { session_id: "c2", request_sequence: 1 },
  };
}

function musicalExecutionFor(child, notes, {
  itemStartQn = ITEM_START_QN,
  durationQuarterNotes = 4,
  listReadback,
} = {}) {
  if (child.id === "template.tracks.resolve_track_ref") return executionFor(child.id, { track_ref: TRACK });
  if (child.id === CREATE_ITEM_ID) {
    return executionFor(child.id, {
      item_ref: ITEM,
      take_ref: TAKE,
      start_seconds: 0,
      end_seconds: durationQuarterNotes / 2,
      start_qn: itemStartQn,
      end_qn: itemStartQn + durationQuarterNotes,
    });
  }
  if (child.id === INSERT_NOTES_ID) {
    return executionFor(child.id, {
      take_ref: TAKE,
      inserted_count: notes.length,
      position_unit: "project_qn",
    });
  }
  if (child.id === "template.midi.resolve_midi_take_ref") return executionFor(child.id, { take_ref: TAKE, item_ref: ITEM });
  if (child.id === "template.midi.read_take_event_counts") {
    return executionFor(child.id, {
      take_ref: TAKE,
      note_count: notes.length,
      cc_count: 0,
      text_sysex_count: 0,
    });
  }
  if (child.id === LIST_NOTES_ID) {
    if (typeof listReadback === "function") {
      return executionFor(child.id, { take_ref: TAKE, ...listReadback(child) });
    }
    const liveRows = liveMusicalRows(notes, itemStartQn);
    const cursor = Number(child.input.cursor ?? 0);
    const page = liveRows.slice(cursor, cursor + child.input.limit);
    const next = cursor + page.length;
    return executionFor(child.id, {
      take_ref: TAKE,
      notes: page,
      returned_count: page.length,
      truncated: next < liveRows.length,
      ...(next < liveRows.length ? { next_cursor: String(next) } : {}),
    });
  }
  return executionFor(child.id, {});
}

function legacyExecutionFor(child, notes) {
  if (child.id === "template.tracks.resolve_track_ref") return executionFor(child.id, { track_ref: TRACK });
  if (child.id === CREATE_ITEM_ID) return executionFor(child.id, { item_ref: ITEM, take_ref: TAKE });
  if (child.id === INSERT_NOTES_ID) return executionFor(child.id, { take_ref: TAKE, inserted_count: notes.length });
  if (child.id === "template.midi.resolve_midi_take_ref") return executionFor(child.id, { take_ref: TAKE, item_ref: ITEM });
  if (child.id === "template.midi.read_take_event_counts") {
    return executionFor(child.id, { take_ref: TAKE, note_count: notes.length, cc_count: 0, text_sysex_count: 0 });
  }
  if (child.id === LIST_NOTES_ID) {
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

function liveMusicalRows(notes, itemStartQn) {
  return notes.map((note, index) => {
    const startOffset = note.start_offset_quarter_notes ?? index;
    const endOffset = note.end_offset_quarter_notes ?? (startOffset + 1);
    const startQn = itemStartQn + startOffset;
    const endQn = itemStartQn + endOffset;
    return {
      start_ppq: startOffset * 960,
      end_ppq: endOffset * 960,
      start_qn: startQn,
      end_qn: endQn,
      start_seconds: startQn / 2,
      end_seconds: endQn / 2,
      pitch: note.pitch,
      velocity: note.velocity,
      channel: note.channel,
    };
  });
}

function generatedMusicalNotes(count) {
  return Array.from({ length: count }, (_, index) => ({
    start_offset_quarter_notes: index,
    end_offset_quarter_notes: index + 1,
    pitch: 48 + (index % 24),
    velocity: 80 + (index % 32),
    channel: index % 4,
  }));
}

function pageReadback(notes, truncated, nextCursor) {
  return {
    notes,
    returned_count: notes.length,
    truncated,
    ...(nextCursor === undefined ? {} : { next_cursor: nextCursor }),
  };
}

function executionFor(id, readback, verificationStatus = "passed") {
  return {
    ok: true,
    request: { id },
    verification: { status: verificationStatus },
    result: {
      readback,
      refs: Object.entries(readback)
        .filter(([key, value]) => key.endsWith("_ref") && typeof value === "string")
        .map(([key, ref]) => objectRef(key.slice(0, -4), ref)),
    },
  };
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
    status: () => ({ snapshot_id: "snapshot:c2", revision: "revision:c2", rows_available: true, row_counts: { tracks: trackRows.length } }),
    invalidateScopes({ scopes }) {
      this.invalidated = scopes;
      return { ok: true, scopes };
    },
    adapter: {
      snapshot: () => ({
        lifecycle: "ready",
        snapshot_id: "snapshot:c2",
        freshness_scopes: { tracks: { status: "fresh", coverage_status: "complete" } },
        rows: { tracks: trackRows },
      }),
    },
  };
}
