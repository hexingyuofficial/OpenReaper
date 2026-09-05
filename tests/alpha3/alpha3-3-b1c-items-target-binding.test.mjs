import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  executeAlpha3_3B1cItemsApplyMacro,
} from "../../packages/mcp-server/src/alpha3-3-b1c-items-apply-v1.mjs";

const ITEM_A = "item:guid:{ITEM-A}";
const ITEM_B = "item:guid:{ITEM-B}";
const ITEM_C = "item:guid:{ITEM-C}";
const TRACK_A = "track:guid:{TRACK-A}";
const TRACK_B = "track:guid:{TRACK-B}";

describe("Alpha3.3-B1c Item target binding", () => {
  it("freezes selected Items, returns a fingerprint, and reverses every exact member", async () => {
    const calls = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: macroRequest({
        mode: "reverse",
        target_binding: { domain: "items", selector: "selected" },
        dry_run: false,
      }),
      executeAtomic: fakeExecutor({ calls, selected: [ITEM_A, ITEM_B] }),
      now: () => new Date("2026-08-21T08:00:00.000Z"),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.data.target_scope, "target_binding:selected");
    assert.match(result.result.data.target_set.fingerprint, /^target-set:[0-9a-f]{32}$/u);
    assert.equal(result.result.data.target_set.count, 2);
    assert.deepEqual(calls.map((call) => call.id), [
      "template.items.list_selected_items",
      "template.items.resolve_item_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.items.read_item_summary",
      "template.items.set_reverse",
    ]);
    assert.deepEqual(calls.at(-1).input.batch.map((row) => row.item_ref), [ITEM_A, ITEM_B]);
    assert.equal(result.result.data.native_batch.dispatch_count, 1);
    assert.equal(result.result.data.native_batch.undo_opened, true);
    assert.equal(result.result.data.native_batch.undo_closed, true);
    assert.deepEqual(result.result.changes.map((row) => row.live_readback.status), ["passed", "passed"]);
  });

  it("intersects selected Tracks with the current time selection before gluing", async () => {
    const calls = [];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: macroRequest({
        mode: "glue",
        target_binding: {
          domain: "items",
          selector: "all",
          constraints: [
            { kind: "owner_in", source: { domain: "tracks", selector: "selected" } },
            { kind: "time_relation", relation: "overlaps", source: { domain: "time_range", selector: "time_selection" } },
          ],
        },
        dry_run: false,
      }),
      executeAtomic: fakeExecutor({ calls, selected: [], selectedTracks: [TRACK_A] }),
      now: () => new Date("2026-08-21T08:00:00.000Z"),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.result.data.total_target_count, 1);
    assert.deepEqual(calls.map((call) => call.id), [
      "template.project.read_track_item_overview",
      "template.transport.read_state",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
      "template.items.glue_item",
    ]);
    const glue = calls.at(-1);
    assert.deepEqual(glue.input.batch, [{ id: "i001", item_ref: ITEM_A }]);
    assert.equal(result.result.data.native_batch.dispatch_count, 1);
    assert.equal(result.result.changes[0].result_item_ref, "item:guid:{GLUED-ITEM-A}");
    assert.equal(result.result.changes[0].result_take_ref, "take:guid:{GLUED-TAKE-A}");
  });

  it("rejects target_binding mixed with legacy target fields before dispatch", async () => {
    let dispatches = 0;
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: macroRequest({
        mode: "reverse",
        target: "selected",
        target_binding: { domain: "items", selector: "selected" },
        dry_run: false,
      }),
      executeAtomic: async () => { dispatches += 1; },
      now: () => new Date("2026-08-21T08:00:00.000Z"),
    });

    assert.equal(result.ok, false);
    assert.equal(result.error.code, "ITEM_APPLY_TARGET_BINDING_CONFLICT");
    assert.equal(dispatches, 0);
  });

  it("pages complete project truth before reversing targets found after the third Item page", async () => {
    const calls = [];
    const decoys = Array.from({ length: 200 }, (_, index) => itemRow(
      `item:guid:{DECOY-${index}}`,
      TRACK_B,
      100 + index,
      1,
    ));
    const inventoryRows = [
      ...decoys,
      itemRow(ITEM_A, TRACK_A, 1, 2),
      itemRow(ITEM_B, TRACK_A, 2, 1),
      itemRow(ITEM_C, TRACK_B, 2, 1),
    ];
    const result = await executeAlpha3_3B1cItemsApplyMacro({
      request: macroRequest({
        mode: "reverse",
        target_binding: {
          domain: "items",
          selector: "all",
          constraints: [
            { kind: "owner_in", source: { domain: "tracks", selector: "selected" } },
            { kind: "time_relation", relation: "overlaps", source: { domain: "time_range", selector: "time_selection" } },
          ],
        },
        dry_run: false,
      }),
      executeAtomic: fakeExecutor({ calls, selected: [], selectedTracks: [TRACK_A], inventoryRows }),
      now: () => new Date("2026-08-21T08:00:00.000Z"),
    });

    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(calls.filter((call) => call.id === "template.project.read_track_item_overview").length, 4);
    assert.equal(result.result.data.target_set.count, 2);
    assert.deepEqual(calls.at(-1).input.batch.map((row) => row.item_ref), [ITEM_A, ITEM_B]);
    assert.equal(result.result.data.native_batch.dispatch_count, 1);
  });
});

function fakeExecutor({ calls, selected, selectedTracks = [], inventoryRows = null }) {
  const rows = inventoryRows ?? [
    itemRow(ITEM_A, TRACK_A, 1, 2),
    itemRow(ITEM_B, TRACK_A, 7, 1),
    itemRow(ITEM_C, TRACK_B, 2, 1),
  ];
  return async (call) => {
    calls.push(call);
    if (call.id === "template.items.list_selected_items") {
      const items = rows.filter((row) => selected.includes(row.item_ref));
      return execution(call.id, {
        items,
        selected_count: items.length,
        truncated: false,
      }, items.map((row) => objectRef("item", row.item_ref)));
    }
    if (call.id === "template.project.read_track_item_overview") {
      const allTracks = [trackRow(TRACK_A, selectedTracks.includes(TRACK_A)), trackRow(TRACK_B, selectedTracks.includes(TRACK_B))];
      const trackCursor = call.input.track_cursor ?? 0;
      const itemCursor = call.input.item_cursor ?? 0;
      const trackRows = allTracks.slice(trackCursor, trackCursor + call.input.max_tracks);
      const itemRows = rows.slice(itemCursor, itemCursor + call.input.max_items);
      const nextTrack = trackCursor + trackRows.length;
      const nextItem = itemCursor + itemRows.length;
      return execution(call.id, {
        tracks: trackRows,
        items: itemRows,
        selected_items: rows.filter((row) => selected.includes(row.item_ref)),
        track_count: allTracks.length,
        item_count: rows.length,
        returned_track_count: trackRows.length,
        returned_item_count: itemRows.length,
        selected_items_truncated: false,
        items_truncated: nextItem < rows.length,
        ...(nextItem < rows.length ? { next_item_cursor: String(nextItem) } : {}),
        item_coverage_status: nextItem < rows.length ? "paged" : "complete",
        item_coverage: { internally_complete: true },
        truncated: nextTrack < allTracks.length,
        ...(nextTrack < allTracks.length ? { next_track_cursor: String(nextTrack) } : {}),
      });
    }
    if (call.id === "template.transport.read_state") {
      return execution(call.id, { time_selection: { start_seconds: 0.5, end_seconds: 4 } });
    }
    if (call.id === "template.items.resolve_item_ref") {
      const ref = call.input.ref;
      return execution(call.id, { item_ref: ref }, [objectRef("item", ref)]);
    }
    if (call.id === "template.items.read_item_summary") {
      const ref = call.refs.item_ref.ref;
      const row = rows.find((entry) => entry.item_ref === ref);
      return execution(call.id, {
        ...row,
        active_take_ref: `take:guid:{TAKE-${ref.includes("ITEM-A") ? "A" : ref.includes("ITEM-B") ? "B" : "C"}}`,
        reverse: false,
      }, [objectRef("item", ref)]);
    }
    if (call.id === "template.items.set_reverse") {
      return executionWithUndo(call.id, {
        rows: call.input.batch.map((row) => ({
          item_ref: row.item_ref,
          active_take_ref: `take:guid:{TAKE-${row.item_ref.includes("ITEM-A") ? "A" : "B"}}`,
          reverse: true,
          changed: true,
          live_readback: "passed",
        })),
        row_count: call.input.batch.length,
        native_action_count: 1,
        selection_restored: true,
        active_take_restored: true,
        readback_status: "passed",
      }, call.input.batch.flatMap((row) => [objectRef("item", row.item_ref)]));
    }
    if (call.id === "template.items.glue_item") {
      return executionWithUndo(call.id, {
        rows: call.input.batch.map((row) => ({
          source_item_ref: row.item_ref,
          glued_item_ref: "item:guid:{GLUED-ITEM-A}",
          glued_take_ref: "take:guid:{GLUED-TAKE-A}",
          old_item_guid_absent: true,
          new_item_unique: true,
          live_readback: "passed",
        })),
        row_count: call.input.batch.length,
        native_action_count: 1,
        selection_restored: true,
        active_take_restored: true,
        readback_status: "passed",
      }, [objectRef("item", "item:guid:{GLUED-ITEM-A}"), objectRef("take", "take:guid:{GLUED-TAKE-A}")]);
    }
    throw new Error(`Unexpected Template ${call.id}`);
  };
}

function macroRequest(input) {
  return {
    id: "macro.items.apply",
    input,
    refs: {},
    context: { request_id: "request:target-binding", session_id: "session:target-binding", request_sequence: 1 },
  };
}

function itemRow(item_ref, track_ref, position_seconds, length_seconds) {
  return { item_ref, track_ref, position_seconds, length_seconds, selected: false };
}

function trackRow(track_ref, selected) {
  return { track_ref, selected };
}

function objectRef(kind, ref) {
  return { kind, ref, identity: { scheme: "guid", value: ref.slice(`${kind}:guid:`.length) } };
}

function execution(id, summary, refs = []) {
  return { ok: true, request: { id: `evidence:${id}` }, result: { summary, refs } };
}

function executionWithUndo(id, summary, refs = []) {
  return { ok: true, request: { id: `evidence:${id}` }, result: { summary, refs }, undo: { opened: true, closed: true } };
}
