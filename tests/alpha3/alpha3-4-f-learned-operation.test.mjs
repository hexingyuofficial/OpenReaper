import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { describe, it } from "node:test";

import { createExecutableDependencyCatalog } from "../../packages/core/src/executable-recipe-contract-v1.mjs";
import {
  ALPHA3_4_F_MACRO_BATCH_SIZES,
  ALPHA3_4_F_REPETITION_COUNT,
  buildLearnedOperationRecipeDraft,
  captureTypedItemState,
  createAlpha3_4FLearnedOperationExperiment,
  diffTypedItemStates,
} from "../../packages/mcp-server/src/alpha3-4-f-learned-operation-v1.mjs";

const SOURCE = "item:guid:{SOURCE}";
const DEMO = "item:guid:{DEMO}";
const SOURCE_TAKE = "take:guid:{SOURCE-TAKE}";
const DEMO_TAKE = "take:guid:{DEMO-TAKE}";
const TARGET_TRACK = "track:guid:{TARGET}";

describe("Alpha3.4-F bounded learned-operation experiment", () => {
  it("captures typed known facts, preserves missing facts as unknown, and diffs only known pairs", () => {
    const before = captureTypedItemState({
      item_ref: SOURCE,
      position_seconds: 1,
      length_seconds: 2,
      volume_db: -3,
      active_take_ref: SOURCE_TAKE,
      take_pitch_semitones: 0,
      preserve_pitch: true,
    });
    const after = captureTypedItemState({
      item_ref: DEMO,
      position_seconds: 4,
      length_seconds: 2,
      volume_db: -1,
      active_take_ref: DEMO_TAKE,
      take_pitch_semitones: 2,
      preserve_pitch: true,
    });
    const diff = diffTypedItemStates(before, after);

    assert.equal(before.take_pan.status, "unknown");
    assert.equal(after.fade_in_seconds.status, "unknown");
    assert.deepEqual(diff.changed.map((item) => item.field), [
      "position_seconds",
      "volume_db",
      "active_take_ref",
      "take_pitch_semitones",
    ]);
    assert.ok(diff.unknown.some((item) => item.field === "take_pan"));
    assert.equal(diff.changed.some((item) => item.field === "take_pan"), false);
  });

  it("captures an immutable transient record and replays ten copies with increasing pitch in exact 8+2 Macro batches", async () => {
    const bridge = new LearnedOperationBridge();
    const experiment = createAlpha3_4FLearnedOperationExperiment({
      callTemplate: bridge.callTemplate,
      now: () => new Date("2026-07-22T00:00:00.000Z"),
    });
    const captured = await captureFixture(experiment);
    assert.equal(captured.ok, true, JSON.stringify(captured));
    assert.equal(captured.record.transient, true);
    assert.equal(captured.record.immutable, true);
    assert.equal(Object.isFrozen(captured.record), true);
    assert.equal(captured.record.replayable, true);
    assert.equal(captured.record.learned.relative_position_seconds, 3);
    assert.equal(captured.record.diff.unknown.some((item) => item.field === "active_take_name"), false);

    bridge.calls.length = 0;
    const replayed = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(replayed.ok, true, JSON.stringify(replayed));
    assert.equal(replayed.replay.repetitions, ALPHA3_4_F_REPETITION_COUNT);
    assert.deepEqual(replayed.replay.macro_batch_sizes, ALPHA3_4_F_MACRO_BATCH_SIZES);
    assert.deepEqual(
      replayed.replay.batches.flat().map((row) => row.take.pitch_semitones),
      Array.from({ length: 10 }, (_, index) => 2 + index),
    );
    assert.deepEqual(
      replayed.replay.copied.map((item) => item.position_seconds),
      Array.from({ length: 10 }, (_, index) => 4 + (2 * index)),
    );
    assert.deepEqual(bridge.calls.slice(0, 3).map((call) => call.id), [
      "template.items.resolve_item_ref",
      "template.items.list_items_on_track",
      "template.items.read_item_summary",
    ]);
    assert.equal(bridge.calls.slice(0, 3).some((call) => isWrite(call.id)), false);
    assert.deepEqual(
      bridge.calls.filter((call) => call.id === "macro.items.apply").map((call) => call.input.changes.length),
      [8, 2],
    );
    assert.equal(bridge.calls.filter((call) => call.id === "template.items.copy_item_to_track").length, 10);
  });

  it("fails closed on capture read failure and preserves unknown required facts without inventing defaults", async () => {
    const bridge = new LearnedOperationBridge({ failReadFor: DEMO });
    const experiment = createAlpha3_4FLearnedOperationExperiment({ callTemplate: bridge.callTemplate });
    const failed = await captureFixture(experiment);
    assert.equal(failed.ok, false);
    assert.equal(failed.phase, "capture");
    assert.equal(experiment.getRecord("capture_fixture"), null);
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);

    const unknownBridge = new LearnedOperationBridge({ omitDemoPitch: true });
    const unknownExperiment = createAlpha3_4FLearnedOperationExperiment({ callTemplate: unknownBridge.callTemplate });
    const captured = await captureFixture(unknownExperiment, "unknown_pitch");
    assert.equal(captured.ok, true);
    assert.equal(captured.record.after.take_pitch_semitones.status, "unknown");
    assert.equal(captured.record.replayable, false);
    unknownBridge.calls.length = 0;
    const replayed = await unknownExperiment.replayItemCopy({ record_id: "unknown_pitch" });
    assert.equal(replayed.ok, false);
    assert.equal(replayed.error.code, "LEARNED_RECORD_INCOMPLETE");
    assert.equal(unknownBridge.calls.length, 0);
  });

  it("performs no mutation when full replay preflight fails", async () => {
    const bridge = new LearnedOperationBridge();
    const experiment = createAlpha3_4FLearnedOperationExperiment({ callTemplate: bridge.callTemplate });
    const captured = await captureFixture(experiment);
    assert.equal(captured.ok, true);

    bridge.options.incompleteInventory = true;
    bridge.calls.length = 0;
    const replayed = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(replayed.ok, false);
    assert.equal(replayed.error.code, "LEARNED_TRACK_INVENTORY_INCOMPLETE");
    assert.equal(replayed.outcome, "zero_write");
    assert.equal(bridge.calls.some((call) => isWrite(call.id)), false);
  });

  it("re-resolves and re-reads live source truth before every transient replay", async () => {
    const bridge = new LearnedOperationBridge();
    const experiment = createAlpha3_4FLearnedOperationExperiment({ callTemplate: bridge.callTemplate });
    const captured = await captureFixture(experiment);
    assert.equal(captured.ok, true);
    bridge.calls.length = 0;

    const first = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(first.ok, true);
    bridge.items.get(SOURCE).position_seconds = 20;
    const second = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(second.ok, true);
    assert.equal(second.replay.copied[0].position_seconds, 23);
    assert.equal(bridge.calls.filter((call) => call.id === "template.items.resolve_item_ref").length, 2);
    assert.equal(
      bridge.calls.filter((call) => call.id === "template.items.read_item_summary" && refValue(call.refs.item_ref) === SOURCE).length,
      2,
    );
  });

  it("validates and saves a normal two-stage E Recipe, then runs only the exact returned immutable revision", async () => {
    const bridge = new LearnedOperationBridge();
    const calls = [];
    const catalog = learnedCatalog();
    const savedIdentity = {
      recipe_id: "recipe.items.learned_copy_fixture",
      version: "1.0.0",
      revision: 7,
      content_hash: "c".repeat(64),
      validation_result_id: "validation:learned:fixture",
    };
    const callRecipe = async (request) => {
      calls.push(structuredClone(request));
      if (request.operation === "validate") return { ok: true, status: "validated" };
      if (request.operation === "save") return { ok: true, status: "saved", ...savedIdentity };
      if (request.operation === "run") return { ok: true, status: "succeeded", run_id: "run_fixture" };
      throw new Error("unexpected call_recipe operation");
    };
    const experiment = createAlpha3_4FLearnedOperationExperiment({
      callTemplate: bridge.callTemplate,
      callRecipe,
      catalog,
    });
    const captured = await captureFixture(experiment);
    const replayed = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(replayed.ok, true);

    const saved = await experiment.saveLearnedRecipe({
      record_id: captured.record.record_id,
      replay_id: replayed.replay.replay_id,
      recipe_id: savedIdentity.recipe_id,
      version: "1.0.0",
      revision: 7,
      portability: portability(),
    });
    assert.equal(saved.ok, true, JSON.stringify(saved));
    assert.equal(saved.draft.stages.length, 2);
    assert.deepEqual(saved.draft.stages.map((stage) => stage.kind), ["macro", "macro"]);
    assert.deepEqual(saved.draft.preflight, {
      contract: "recipe.executable.preflight.v1",
      complete_graph: true,
      stage_count: 2,
      dependency_count: 1,
      requires_validation_before_save: true,
      requires_save_before_run: true,
      forbids_inline_execution: true,
    });
    assert.equal(calls[0].operation, "validate");
    assert.equal(calls[1].operation, "save");

    const ran = await experiment.runSavedLearnedRecipe({ record_id: captured.record.record_id });
    assert.equal(ran.ok, true, JSON.stringify(ran));
    assert.deepEqual(calls[2], {
      operation: "run",
      ...savedIdentity,
      inputs: {
        batch_1_mode: "set_item_take_controls",
        batch_1_changes: replayed.replay.batches[0],
        batch_1_dry_run: false,
        batch_2_mode: "set_item_take_controls",
        batch_2_changes: replayed.replay.batches[1],
        batch_2_dry_run: false,
      },
    });
    assert.equal("draft" in calls[2], false);
    assert.equal("identity" in calls[2], false);
  });

  it("stops after a failed first Macro batch and reports proven partial copy truth", async () => {
    const bridge = new LearnedOperationBridge({ failMacroBatch: 1 });
    const experiment = createAlpha3_4FLearnedOperationExperiment({ callTemplate: bridge.callTemplate });
    const captured = await captureFixture(experiment);
    assert.equal(captured.ok, true);
    bridge.calls.length = 0;

    const replayed = await experiment.replayItemCopy({ record_id: captured.record.record_id });
    assert.equal(replayed.ok, false);
    assert.equal(replayed.phase, "replay");
    assert.equal(replayed.outcome, "partial_or_unknown");
    assert.equal(replayed.applied.filter((item) => item.kind === "copy").length, 10);
    assert.equal(bridge.calls.filter((call) => call.id === "macro.items.apply").length, 1);
  });

  it("builds a <=48-stage draft without introducing a second persistence or execution surface", () => {
    const record = {
      record_id: "fixture",
      after: { take_pitch_semitones: { status: "known", value: 2 } },
      learned: {},
    };
    const replay = { batches: [Array(8).fill({}), Array(2).fill({})] };
    const draft = buildLearnedOperationRecipeDraft(record, replay, {
      catalog: learnedCatalog(),
      recipe_id: "recipe.items.learned_copy_fixture",
      portability: portability(),
    });
    assert.equal(draft.stages.length <= 48, true);
    assert.equal(draft.stages.every((stage) => stage.dependency.id === "macro.items.apply"), true);
    assert.equal(JSON.stringify(draft).includes("call_recipe"), false);
    assert.equal(JSON.stringify(draft).includes("inline_graph"), false);
  });
});

async function captureFixture(experiment, recordId = "capture_fixture") {
  return experiment.captureItemCopy({
    record_id: recordId,
    source_item_ref: SOURCE,
    demonstrated_item_ref: DEMO,
    target_track_ref: TARGET_TRACK,
    spacing_seconds: 2,
    pitch_step_semitones: 1,
  });
}

class LearnedOperationBridge {
  constructor(options = {}) {
    this.options = options;
    this.calls = [];
    this.copySequence = 0;
    this.macroSequence = 0;
    this.items = new Map([
      [SOURCE, itemSummary({
        item_ref: SOURCE,
        active_take_ref: SOURCE_TAKE,
        position_seconds: 1,
        track_ref: "track:guid:{SOURCE-TRACK}",
        volume_db: -3,
        take_volume_db: -2,
        take_pan: -0.25,
        take_pitch_semitones: 0,
      })],
      [DEMO, itemSummary({
        item_ref: DEMO,
        active_take_ref: DEMO_TAKE,
        position_seconds: 4,
        track_ref: TARGET_TRACK,
        volume_db: -1,
        take_volume_db: -0.5,
        take_pan: 0.4,
        take_pitch_semitones: 2,
        fade_in_seconds: 0.1,
        fade_out_seconds: 0.2,
      })],
    ]);
    if (options.omitDemoPitch) delete this.items.get(DEMO).take_pitch_semitones;
    this.callTemplate = this.callTemplate.bind(this);
  }

  async callTemplate(request) {
    this.calls.push(structuredClone(request));
    const ref = refValue(request.refs?.item_ref);
    if (request.id === "template.items.resolve_item_ref") {
      return templateSuccess({}, [objectRef("item", request.input.ref)]);
    }
    if (request.id === "template.items.list_items_on_track") {
      return templateSuccess({
        items: [...this.items.values()].filter((item) => item.track_ref === TARGET_TRACK).map((item) => ({ item_ref: item.item_ref })),
        page: { has_more: this.options.incompleteInventory === true },
      });
    }
    if (request.id === "template.items.read_item_summary") {
      if (this.options.failReadFor === ref) return templateFailure("READ_FAILED", "read failed");
      const item = this.items.get(ref);
      if (!item) return templateFailure("ITEM_NOT_FOUND", "missing item");
      return templateSuccess(structuredClone(item), [objectRef("item", ref)]);
    }
    if (request.id === "template.items.copy_item_to_track") {
      this.copySequence += 1;
      const newItemRef = `item:guid:{COPY-${this.copySequence}}`;
      const source = this.items.get(refValue(request.refs.source_item_ref));
      const activeTakeRef = `take:guid:{COPY-TAKE-${this.copySequence}}`;
      this.items.set(newItemRef, {
        ...structuredClone(source),
        item_ref: newItemRef,
        active_take_ref: activeTakeRef,
        track_ref: TARGET_TRACK,
        position_seconds: request.input.position_seconds,
      });
      return templateSuccess({ new_item_ref: newItemRef, position_seconds: request.input.position_seconds }, [objectRef("item", newItemRef)]);
    }
    if (request.id === "macro.items.apply") {
      this.macroSequence += 1;
      if (this.options.failMacroBatch === this.macroSequence) {
        return { ok: false, error: { code: "MACRO_FAILED", message: "macro failed" } };
      }
      return {
        contract: "macro.execution.v1",
        ok: true,
        result: {
          changes: request.input.changes.map((row) => ({
            id: row.id,
            status: "applied",
            live_readback: { status: "passed" },
          })),
        },
      };
    }
    return templateFailure("UNEXPECTED_CALL", request.id);
  }
}

function itemSummary(overrides) {
  return {
    item_ref: SOURCE,
    track_ref: TARGET_TRACK,
    position_seconds: 1,
    length_seconds: 1.5,
    volume_db: -3,
    fade_in_seconds: 0,
    fade_out_seconds: 0,
    snap_offset_seconds: 0,
    active_take_ref: SOURCE_TAKE,
    take_volume_db: -2,
    take_pan: 0,
    take_pitch_semitones: 0,
    playrate: 1,
    preserve_pitch: true,
    ...overrides,
  };
}

function templateSuccess(summary, refs = []) {
  return {
    contract: "template.execution.v1",
    ok: true,
    result: { summary, refs },
    verification: { status: "passed" },
  };
}

function templateFailure(code, message) {
  return { contract: "template.execution.v1", ok: false, error: { code, message } };
}

function objectRef(kind, ref) {
  return { contract: "object.ref.v1", kind, ref, identity: { scheme: "guid", value: ref.slice(ref.indexOf("{") ) } };
}

function refValue(value) {
  return typeof value === "string" ? value : value?.ref;
}

function isWrite(id) {
  return id === "template.items.copy_item_to_track" || id === "macro.items.apply";
}

function learnedCatalog() {
  return createExecutableDependencyCatalog({
    macros: [{
      id: "macro.items.apply",
      version: "1.2.0",
      risk: "destructive",
      descriptor_hash: sha("macro.items.apply:1.2.0"),
      capabilities: ["items.batch_apply"],
    }],
    templates: [],
    capabilities: ["items.batch_apply"],
  });
}

function portability() {
  return {
    project_identity: "project:fixture",
    bridge_owner: "owner:fixture",
    bridge_generation: "1",
    platform: "darwin",
  };
}

function sha(value) {
  return createHash("sha256").update(value).digest("hex");
}
