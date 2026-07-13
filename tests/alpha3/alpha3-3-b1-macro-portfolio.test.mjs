import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import { ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT } from "../../packages/mcp-server/src/alpha3-2d-project-index-runtime-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_CURRENT_PRODUCT_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  ALPHA3_3_B1_DEPRECATED_ALIASES,
  ALPHA3_3_B1_FINAL_TARGET_IDS,
  ALPHA3_3_B1_INTERNAL_DRAFT_IDS,
  ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS,
  adaptAlpha3_3B1CanonicalExecutionRequest,
  alpha3_3B1DeprecatedAlias,
  alpha3_3B1ExecutorSourceId,
  validateAlpha3_3B1MacroPortfolio,
} from "../../packages/mcp-server/src/alpha3-3-b1-macro-portfolio-v1.mjs";

const EXPECTED_FINAL_IDS = [
  "macro.project.inspect",
  "macro.project.query",
  "macro.project.delete_targets",
  "macro.project.apply_layout",
  "macro.project.file",
  "macro.routing.apply",
  "macro.media.place_assets",
  "macro.items.analyze",
  "macro.items.apply",
  "macro.midi.apply",
  "macro.fx.apply_chain",
  "macro.fx.set_controls",
  "macro.controls.set",
  "macro.automation.apply",
  "macro.render.targets",
];

describe("Alpha3.3-B1 Macro portfolio", () => {
  it("separates the final fifteen targets from thirteen visible executables and two internal drafts", () => {
    assert.deepEqual(validateAlpha3_3B1MacroPortfolio(), { valid: true, errors: [] });
    assert.deepEqual(ALPHA3_3_B1_FINAL_TARGET_IDS, EXPECTED_FINAL_IDS);
    assert.deepEqual(ALPHA3_3_B1_INTERNAL_DRAFT_IDS, [
      "macro.items.apply",
      "macro.automation.apply",
    ]);
    assert.deepEqual(ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS, EXPECTED_FINAL_IDS.filter((id) =>
      !ALPHA3_3_B1_INTERNAL_DRAFT_IDS.includes(id)));
  });

  it("keeps renamed ids as hidden aliases to canonical visible executables", () => {
    assert.deepEqual(ALPHA3_3_B1_DEPRECATED_ALIASES.map((entry) => entry.id), [
      "macro.midi.create_clip",
      "macro.fx.apply_native_chain",
      "macro.set_stock_plugin_controls",
    ]);
    assert.equal(ALPHA3_3_B1_DEPRECATED_ALIASES.every((entry) => entry.visible === false), true);
    assert.deepEqual(alpha3_3B1DeprecatedAlias("macro.midi.create_clip", {
      start_seconds: 0,
      end_seconds: 1,
      notes: [],
    }), {
      id: "macro.midi.create_clip",
      implementation_status: "deprecated_alias",
      visible: false,
      replacement: "macro.midi.apply",
      replacement_input: {
        start_seconds: 0,
        end_seconds: 1,
        notes: [],
        mode: "create_clips",
      },
    });
  });

  it("adapts canonical execution to the fixed accepted executors without widening MIDI modes", () => {
    assert.equal(alpha3_3B1ExecutorSourceId("macro.midi.apply"), "macro.midi.create_clip");
    assert.equal(alpha3_3B1ExecutorSourceId("macro.fx.apply_chain"), "macro.fx.apply_native_chain");
    assert.equal(alpha3_3B1ExecutorSourceId("macro.fx.set_controls"), "macro.set_stock_plugin_controls");

    const accepted = adaptAlpha3_3B1CanonicalExecutionRequest({
      id: "macro.midi.apply",
      input: { mode: "create_clips", start_seconds: 0, end_seconds: 1, notes: [] },
    });
    assert.equal(accepted.ok, true);
    assert.equal(accepted.request.id, "macro.midi.create_clip");
    assert.deepEqual(accepted.request.input, { start_seconds: 0, end_seconds: 1, notes: [] });

    const held = adaptAlpha3_3B1CanonicalExecutionRequest({
      id: "macro.midi.apply",
      input: { mode: "edit_notes" },
    });
    assert.equal(held.ok, false);
    assert.equal(held.code, "MIDI_APPLY_MODE_UNSUPPORTED");
  });

  it("executes the three canonical ids through the existing fixed programs with canonical envelope identity", async () => {
    const runtime = createFacadeRuntime();
    const notes = [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }];

    const midi = await runtime.call_template({
      id: "macro.midi.apply",
      input: { mode: "create_clips", start_seconds: 0, end_seconds: 1, notes },
      refs: { track_ref: TRACK_REF },
      context: context(1),
    });
    assert.equal(midi.ok, true, JSON.stringify(midi));
    assert.deepEqual(midi.macro, {
      id: "macro.midi.apply",
      program_id: "openreaper.macro.midi.apply",
      program_version: "1.0.0",
      risk: "write",
    });
    assert.equal(midi.result.data.note_count, 1);
    assert.equal(midi.result.verification.status, "passed");

    const applyChain = await runtime.call_template({
      id: "macro.fx.apply_chain",
      input: { controls: { threshold_db: -18, ratio: 3 } },
      refs: { track_ref: TRACK_REF },
      context: context(2),
    });
    assert.equal(applyChain.ok, true, JSON.stringify(applyChain));
    assert.equal(applyChain.macro.id, "macro.fx.apply_chain");
    assert.equal(applyChain.macro.program_id, "openreaper.macro.fx.apply_chain");
    assert.equal(applyChain.result.verification.status, "passed");

    const setControls = await runtime.call_template({
      id: "macro.fx.set_controls",
      input: { plugin: "reacomp", controls: { threshold_db: -18, ratio: 3 } },
      refs: { fx_ref: FX_REF },
      context: context(3),
    });
    assert.equal(setControls.ok, true, JSON.stringify(setControls));
    assert.equal(setControls.macro.id, "macro.fx.set_controls");
    assert.equal(setControls.macro.program_id, "openreaper.macro.fx.set_controls");
    assert.equal(setControls.result.verification.status, "passed");
  });

  it("hides aliases and drafts while returning exact typed replacement and held errors", async () => {
    const runtime = createCallTemplateRuntime();
    const menuIds = runtime.list_templates().items
      .filter((item) => item.action_kind === "macro")
      .map((item) => item.id);
    assert.deepEqual(menuIds, ALPHA3_3_B1_VISIBLE_EXECUTABLE_IDS);

    const alias = await runtime.call_template({
      id: "macro.midi.create_clip",
      input: { start_seconds: 0, end_seconds: 1, notes: [] },
    });
    assert.equal(alias.error.code, "CALL_TEMPLATE_ID_REPLACED");
    assert.equal(alias.error.details.replacement, "macro.midi.apply");
    assert.deepEqual(alias.error.details.replacement_input, {
      start_seconds: 0,
      end_seconds: 1,
      notes: [],
      mode: "create_clips",
    });

    for (const id of ALPHA3_3_B1_INTERNAL_DRAFT_IDS) {
      const held = await runtime.call_template({ id, input: {} });
      assert.equal(held.error.code, "CALL_TEMPLATE_ID_HELD");
      assert.equal(held.error.details.implementation_status, "internal_draft");
      assert.equal(held.error.details.visible, false);
    }

    const unsupported = await runtime.call_template({
      id: "macro.midi.apply",
      input: { mode: "edit_notes" },
    });
    assert.equal(unsupported.error.code, "CALL_TEMPLATE_REQUEST_INVALID");
    assert.equal(unsupported.error.details.blocker_code, "MIDI_APPLY_MODE_UNSUPPORTED");
  });
});

const TRACK_REF = "track:guid:{ALPHA33-B1}";
const ITEM_REF = "item:guid:{ALPHA33-B1-ITEM}";
const TAKE_REF = "take:guid:{ALPHA33-B1-TAKE}";
const FX_REF = `fx:${TRACK_REF}:0`;
const TRACK_OBJECT = createObjectRef("track", { scheme: "guid", value: "{ALPHA33-B1}" }, { ref: TRACK_REF });
const ITEM_OBJECT = createObjectRef("item", { scheme: "guid", value: "{ALPHA33-B1-ITEM}" }, { ref: ITEM_REF });
const TAKE_OBJECT = createObjectRef("take", { scheme: "guid", value: "{ALPHA33-B1-TAKE}" }, { ref: TAKE_REF });
const FX_OBJECT = createObjectRef("fx", { scheme: "track_fx", value: `${TRACK_REF}:0` }, { ref: FX_REF });

function createFacadeRuntime() {
  const bridge = new FacadeBridge();
  const projectIndexRuntime = {
    contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
    ok: true,
    adapter: {},
    status: () => ({
      contract: ALPHA3_2D_PROJECT_INDEX_RUNTIME_CONTRACT,
      ok: true,
      lifecycle: "ready",
      snapshot_id: "snapshot:alpha33-b1",
      revision: "revision:alpha33-b1",
    }),
    invalidateScopes: ({ scopes }) => ({
      ok: true,
      scopes,
      snapshot_id: "snapshot:alpha33-b1",
      revision: "revision:alpha33-b1",
    }),
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

class FacadeBridge extends FakeFoundationBridge {
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
  if (capability === "track.resolve_ref") return output([TRACK_OBJECT], { track_ref: TRACK_REF, name: "Alpha3.3 B1" });
  if (capability === "midi.create_midi_item") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF });
  if (capability === "midi.insert_notes_batch") return output([TAKE_OBJECT], { take_ref: TAKE_REF, inserted_count: 1, note_count: 1, take_hash: "hash:alpha33-b1" });
  if (capability === "midi.resolve_midi_take_ref") return output([ITEM_OBJECT, TAKE_OBJECT], { item_ref: ITEM_REF, take_ref: TAKE_REF, event_count: 1, ppq_start: 0, ppq_end: 480 });
  if (capability === "midi.read_take_event_counts") return output([TAKE_OBJECT], { take_ref: TAKE_REF, note_count: 1, cc_count: 0, text_sysex_count: 0 });
  if (capability === "midi.list_take_notes") return output([TAKE_OBJECT], { take_ref: TAKE_REF, notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }], returned_count: 1, truncated: false });
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
    session_id: "session-alpha33-b1",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-13T13:00:00.000Z",
    request_sequence: requestSequence,
  };
}
