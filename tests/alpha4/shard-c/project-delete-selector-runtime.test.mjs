import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { executeAlpha3_2_5CProjectWriteMacro } from "../../../packages/mcp-server/src/alpha3-2-5-c-project-write-runtime-v1.mjs";
import { ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID } from "../../../packages/mcp-server/src/alpha3-2e-project-delete-targets-v1.mjs";

const itemRef = (index) => `item:guid:{00000000-0000-4000-8000-${String(index).padStart(12, "0")}}`;

describe("Alpha4 Shard C public delete selector runtime", () => {
  it("executes each supported batch capacity through one capture, one guarded fixed delete, and one batched readback", async () => {
    for (const count of [1, 8, 64, 128, 300, 400, 512]) {
      const calls = [];
      const executeAtomic = selectorDeleteFake(calls, count);
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: {
          id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
          input: { dry_run: false, selectors: [{ kind: "current_selection", entity_kind: "item" }] },
        },
        executeAtomic,
      });
      assert.equal(result.ok, true, `N=${count}: ${JSON.stringify(result.error)}`);
      assert.equal(calls.filter((call) => call.id === "template.items.delete_items").length, 1, `N=${count}`);
      assert.equal(calls.filter((call) => call.id === "template.project.read_track_item_overview").length, 2, `N=${count}`);
      assert.equal(calls.filter((call) => call.id === "template.items.resolve_item_ref").length, 0, `N=${count}`);
      assert.equal(calls.find((call) => call.id === "template.items.delete_items").refs.item_ref.length, count, `N=${count}`);
    }
  });

  it("blocks 513 candidates and truncated captures before delete or undo-capable mutation", async () => {
    for (const scenario of [
      { count: 513, truncated: false, code: "SELECTOR_LIMIT_EXCEEDED" },
      { count: 1, truncated: true, code: "SELECTOR_TRUNCATED" },
    ]) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "current_selection", entity_kind: "item" }] } },
        executeAtomic: selectorDeleteFake(calls, scenario.count, { truncated: scenario.truncated }),
      });
      assert.equal(result.ok, false);
      assert.equal(result.error.code, scenario.code);
      assert.equal(calls.some((call) => call.id === "template.items.delete_items"), false);
    }
  });

  it("deletes every matching predicate row as a batch without an ambiguity retry", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "predicate", entity_kind: "item", field: "active_take_name", operator: "starts_with", value: "lead" }] } },
      executeAtomic: selectorDeleteFake(calls, 8, { predicate: true }),
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(calls.find((call) => call.id === "template.items.delete_items").refs.item_ref.length, 8);
  });

  it("rejects mixed selector and exact-ref semantics before the confirmation exemption", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: {
        id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID,
        input: {
          dry_run: false,
          refs: { items: [itemRef(999)] },
          selectors: [{ kind: "current_selection", entity_kind: "item" }],
        },
      },
      executeAtomic: selectorDeleteFake(calls, 1),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "SELECTOR_AMBIGUOUS");
    assert.deepEqual(calls, []);
  });

  it("uses selected-only Item capture/readback even when the project item list is paged", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "current_selection", entity_kind: "item" }] } },
      executeAtomic: selectorDeleteFake(calls, 1, { projectPaged: true }),
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(result.result.data.selector_snapshot.target_count, 1);
    assert.equal(result.result.data.selector_snapshot.identity_location, "result.canonical_refs");
    assert.equal(calls.filter((call) => call.id === "template.project.read_track_item_overview").at(-1).input.include_selected_items, true);
  });

  it("passes frozen predicate facts to the one guarded delete, which blocks drift before native deletion", async () => {
    const calls = [];
    const ref = itemRef(1);
    let nativeDeletes = 0;
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "predicate", entity_kind: "item", field: "active_take_name", operator: "starts_with", value: "lead" }] } },
      executeAtomic: async ({ id, input = {} }) => {
        calls.push({ id, input });
        if (id === "template.project.read_track_item_overview") {
          const row = { item_ref: ref, active_take_name: "lead", muted: false, locked: false };
          return successful(id, { items: [row], selected_items: [], items_truncated: false, selected_items_truncated: false, item_coverage_status: "complete" }, [ref]);
        }
        if (id === "template.items.delete_items") {
          assert.equal(input.selector_guard.selector.field, "active_take_name");
          return { ok: false, request: { id }, error: { code: "PREWRITE_REF_DRIFT", message: "Guard rejected changed predicate facts." }, result: {} };
        }
        nativeDeletes += 1;
        throw new Error(`Unexpected ${id}`);
      },
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "PREWRITE_REF_DRIFT");
    assert.equal(calls.filter((call) => call.id === "template.project.read_track_item_overview").length, 1);
    assert.equal(calls.filter((call) => call.id === "template.items.delete_items").length, 1);
    assert.equal(nativeDeletes, 0);
  });

  it("uses selected-only Track capture and blocks only a matched folder candidate", async () => {
    for (const scenario of [{ folder_depth: 0, ok: true }, { folder_depth: 1, ok: false }, { folder_depth: -1, ok: false }]) {
      const calls = [];
      const result = await executeAlpha3_2_5CProjectWriteMacro({
        request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "current_selection", entity_kind: "track" }] } },
        executeAtomic: trackSelectionFake(calls, scenario.folder_depth),
      });
      assert.equal(result.ok, scenario.ok, JSON.stringify(result.error));
      assert.equal(calls.some((call) => call.id === "template.tracks.list_tracks"), false);
      assert.equal(calls.some((call) => call.id === "template.tracks.delete_tracks"), scenario.ok);
      if (!scenario.ok) assert.equal(result.error.code, "FOLDER_CASCADE_CONFIRMATION_REQUIRED");
    }
  });

  it("treats solo-in-place as soloed for Track predicates", async () => {
    const calls = [];
    const selected = "track:guid:{00000000-0000-4000-8000-000000000002}";
    let deleted = false;
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "predicate", entity_kind: "track", field: "soloed", operator: "equals", value: true }] } },
      executeAtomic: async ({ id, input = {}, refs = {} }) => {
        calls.push({ id, input, refs });
        if (id === "template.tracks.list_tracks") {
          const rows = deleted ? [] : [{ track_ref: selected, selected: false, folder_depth: 0, muted: false, solo_mode: 2, record_armed: false, name: "Solo in place" }];
          return { ok: true, request: { id }, verification: { status: "passed" }, result: { summary: { tracks: rows, truncated: false, selector_matches_complete: true }, readback: { tracks: rows, truncated: false, selector_matches_complete: true }, refs: rows.map((row) => ({ kind: "track", ref: row.track_ref })) } };
        }
        if (id === "template.tracks.delete_tracks") {
          deleted = true;
          return { ok: true, request: { id }, verification: { status: "passed" }, result: { summary: {}, refs: refs.track_ref } };
        }
        throw new Error(`Unexpected ${id}`);
      },
    });
    assert.equal(result.ok, true, JSON.stringify(result.error));
    assert.equal(calls.filter((call) => call.id === "template.tracks.delete_tracks").length, 1);
  });

  it("blocks typed predicate misuse before any Bridge read", async () => {
    const calls = [];
    const result = await executeAlpha3_2_5CProjectWriteMacro({
      request: { id: ALPHA3_2E_PROJECT_DELETE_TARGETS_MACRO_ID, input: { dry_run: false, selectors: [{ kind: "predicate", entity_kind: "item", field: "muted", operator: "equals", value: "true" }] } },
      executeAtomic: selectorDeleteFake(calls, 1),
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.code, "DELETE_SELECTOR_INVALID");
    assert.deepEqual(calls, []);
  });
});

function selectorDeleteFake(calls, count, { truncated = false, predicate = false, projectPaged = false } = {}) {
  const rows = Array.from({ length: count }, (_, index) => ({ item_ref: itemRef(index + 1), active_take_name: predicate ? `lead ${index + 1}` : "lead", muted: false, locked: false }));
  let deleted = false;
  return async ({ id, input = {}, refs = {}, budget }) => {
    calls.push({ id, input, refs, budget });
    if (id === "template.project.read_track_item_overview") {
      const visible = deleted ? [] : rows;
      return successful(id, {
        items: input.include_selected_items === false ? visible : rows,
        selected_items: input.include_selected_items === false ? [] : visible,
        items_truncated: truncated || projectPaged,
        selected_items_truncated: truncated,
        item_coverage_status: truncated || projectPaged ? "paged" : "complete",
      }, visible.map((row) => row.item_ref));
    }
    if (id === "template.items.delete_items") {
      deleted = true;
      const deletedRefs = refs.item_ref.map((value) => value.ref);
      return successful(id, { deleted_count: deletedRefs.length }, deletedRefs);
    }
    throw new Error(`Unexpected atomic dependency: ${id}`);
  };
}

function trackSelectionFake(calls, folderDepth) {
  const selected = "track:guid:{00000000-0000-4000-8000-000000000001}";
  let deleted = false;
  return async ({ id, input = {}, refs = {} }) => {
    calls.push({ id, input, refs });
    if (id === "template.tracks.read_mixer_controls") {
      const rows = deleted ? [] : [{ track_ref: selected, selected: true, folder_depth: folderDepth, muted: false, solo_mode: 0, record_armed: false, name: "Selected" }];
      return { ok: true, request: { id }, verification: { status: "passed" }, result: { summary: { tracks: rows, truncated: false }, readback: { tracks: rows, truncated: false }, refs: rows.map((row) => ({ kind: "track", ref: row.track_ref })) } };
    }
    if (id === "template.tracks.delete_tracks") {
      deleted = true;
      return { ok: true, request: { id }, verification: { status: "passed" }, result: { summary: {}, refs: refs.track_ref } };
    }
    throw new Error(`Unexpected ${id}`);
  };
}

function successful(id, summary, refs) {
  return {
    ok: true,
    request: { id },
    verification: { status: "passed" },
    result: { summary, readback: summary, refs: refs.map((ref) => ({ kind: "item", ref })) },
  };
}
