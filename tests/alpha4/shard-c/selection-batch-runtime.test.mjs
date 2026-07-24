import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALPHA4_SHARD_C_BATCH_CHUNK_SIZE,
  dispatchAlpha4ShardCBatch,
  resolveAlpha4ShardCSelection,
} from "../../../packages/mcp-server/src/alpha4-shard-c-selection-batch-runtime-v1.mjs";

const item = (id, extra = {}) => ({ ref: `item:guid:{${id}}`, entity_kind: "item", muted: false, locked: false, active_take_name: "lead", ...extra });
const track = (id, extra = {}) => ({ ref: `track:guid:{${id}}`, entity_kind: "track", muted: false, soloed: false, record_armed: false, name: "Vox", ...extra });

describe("Alpha4 Shard C selection/batch runtime", () => {
  it("freezes one current-selection GUID snapshot without an agent GUID inventory", async () => {
    let captures = 0;
    const result = await resolveAlpha4ShardCSelection({
      selector: { kind: "current_selection", entity_kind: "item" },
      captureSelection: async () => { captures += 1; return { rows: [item("A"), item("B")], snapshot: { selection_token: "selection:1" } }; },
      liveResolve: async ({ refs, snapshot }) => ({ ok: true, refs, snapshot }),
    });
    assert.equal(result.ok, true);
    assert.equal(captures, 1);
    assert.deepEqual(result.refs, ["item:guid:{A}", "item:guid:{B}"]);
    assert.equal(result.sqlite_candidates_only, true);
  });

  it("implements approved predicates and typed ambiguity, type, limit, and drift blockers", async () => {
    const rows = [track("A", { muted: true, name: "Lead" }), track("B", { muted: true, name: "Lead" })];
    const common = { candidateRows: rows, liveResolve: async ({ refs }) => ({ ok: true, refs }) };
    assert.equal((await resolveAlpha4ShardCSelection({ selector: { kind: "predicate", entity_kind: "track", field: "muted", operator: "equals", value: true }, ...common })).ok, true);
    for (const selector of [
      { kind: "predicate", entity_kind: "track", field: "soloed", operator: "equals", value: true },
      { kind: "predicate", entity_kind: "track", field: "record_armed", operator: "equals", value: true },
      { kind: "predicate", entity_kind: "track", field: "name", operator: "contains", value: "Lead" },
      { kind: "predicate", entity_kind: "item", field: "muted", operator: "equals", value: true },
      { kind: "predicate", entity_kind: "item", field: "locked", operator: "equals", value: true },
      { kind: "predicate", entity_kind: "item", field: "active_take_name", operator: "contains", value: "lead" },
    ]) {
      const predicateRows = selector.entity_kind === "track"
        ? [track("P", { soloed: true, record_armed: true, name: "Lead" })]
        : [item("P", { muted: true, locked: true, active_take_name: "lead vocal" })];
      assert.equal((await resolveAlpha4ShardCSelection({ selector, candidateRows: predicateRows, liveResolve: async ({ refs }) => ({ ok: true, refs }) })).ok, true, JSON.stringify(selector));
    }
    assert.equal((await resolveAlpha4ShardCSelection({ selector: { kind: "predicate", entity_kind: "track", field: "name", operator: "equals", value: "Lead" }, ...common })).ok, true);
    assert.equal((await resolveAlpha4ShardCSelection({ selector: { kind: "current_selection", entity_kind: "item" }, captureSelection: async () => ({ rows: [track("A")], snapshot: {} }), liveResolve: common.liveResolve })).error.code, "SELECTOR_TYPE_MISMATCH");
    assert.equal((await resolveAlpha4ShardCSelection({ selector: { kind: "predicate", entity_kind: "item", field: "active_take_name", operator: "contains", value: "lead" }, candidateRows: Array.from({ length: 513 }, (_, index) => item(String(index))), liveResolve: common.liveResolve })).error.code, "SELECTOR_LIMIT_EXCEEDED");
    assert.equal((await resolveAlpha4ShardCSelection({ selector: { kind: "current_selection", entity_kind: "item" }, captureSelection: async () => ({ rows: [item("A")], snapshot: { selection_token: "old" } }), liveResolve: async ({ refs }) => ({ ok: true, refs, snapshot: { selection_token: "new" } }) })).error.code, "PREWRITE_SELECTION_DRIFT");
  });

  it("preflights all rows before one Undo, serial chunk dispatch, and one readback", async () => {
    const events = [];
    const refs = Array.from({ length: 300 }, (_, index) => item(String(index)).ref);
    const result = await dispatchAlpha4ShardCBatch({
      request: { rows: refs.map((ref) => ({ ref })) }, fixedTemplateId: "template.items.set_mute",
      resolveTargets: async () => ({ ok: true, refs, snapshot: {} }),
      validateRows: async () => { events.push("validate"); return { ok: true }; },
      preflight: async ({ refs: liveRefs }) => { events.push("preflight"); return { ok: true, refs: liveRefs }; },
      openUndo: async () => { events.push("undo-open"); return { id: "undo:1" }; },
      mutateChunk: async ({ refs: chunk }) => { events.push(`mutate:${chunk.length}`); return { ok: true }; },
      readback: async () => { events.push("readback"); return { ok: true }; },
      closeUndo: async () => { events.push("undo-close"); },
    });
    assert.equal(ALPHA4_SHARD_C_BATCH_CHUNK_SIZE, 128);
    assert.equal(result.status, "completed");
    assert.equal(result.writes, 300);
    assert.deepEqual(events, ["validate", "preflight", "undo-open", "mutate:128", "mutate:128", "mutate:44", "readback", "undo-close"]);
  });

  it("accepts every measured batch-safe capacity through the shared dispatcher", async () => {
    for (const count of [1, 8, 64, 128, 300, 400, 512]) {
      const refs = Array.from({ length: count }, (_, index) => item(String(index)).ref);
      let chunkCount = 0;
      const result = await dispatchAlpha4ShardCBatch({
        request: {}, fixedTemplateId: "template.items.set_mute",
        resolveTargets: async () => ({ ok: true, refs, snapshot: {} }),
        preflight: async ({ refs: liveRefs }) => ({ ok: true, refs: liveRefs }),
        mutateChunk: async () => { chunkCount += 1; return { ok: true }; },
        readback: async () => ({ ok: true }), openUndo: async () => ({ id: `undo:${count}` }), closeUndo: async () => {},
      });
      assert.equal(result.status, "completed", `N=${count}`);
      assert.equal(result.writes, count, `N=${count}`);
      assert.equal(chunkCount, Math.ceil(count / 128), `N=${count}`);
    }
  });

  it("fails at 513 before any write or Undo and rejects supplied Template injection", async () => {
    const refs = Array.from({ length: 513 }, (_, index) => item(String(index)).ref);
    let touched = false;
    const ceiling = await dispatchAlpha4ShardCBatch({ request: {}, fixedTemplateId: "template.items.set_mute", resolveTargets: async () => ({ ok: true, refs }), preflight: async () => ({ ok: true }), mutateChunk: async () => { touched = true; return { ok: true }; }, readback: async () => ({ ok: true }), openUndo: async () => { touched = true; } });
    assert.equal(ceiling.error.code, "BATCH_CANDIDATE_CEILING_EXCEEDED");
    assert.equal(ceiling.writes, 0);
    assert.equal(touched, false);
    const injected = await dispatchAlpha4ShardCBatch({ request: { template_id: "template.items.delete_items" }, fixedTemplateId: "template.items.set_mute" });
    assert.equal(injected.error.code, "BATCH_FIXED_TEMPLATE_DEPENDENCY_INJECTION_REJECTED");
  });
});
