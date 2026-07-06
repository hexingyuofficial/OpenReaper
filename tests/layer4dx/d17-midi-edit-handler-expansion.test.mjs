import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/d17_midi_edit_route.lua", import.meta.url),
  "utf8",
);

const CAPABILITIES = Object.freeze([
  "midi.set_notes_batch",
  "midi.quantize_notes",
  "midi.quantize_selected_notes",
  "midi.set_cc_events_batch",
]);

describe("D17 MIDI edit live handler expansion", () => {
  it("registers exactly the bounded D17 MIDI edit batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d17-midi-edit-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the four D17 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS, [
      "template.midi.set_notes_batch",
      "template.midi.quantize_notes",
      "template.midi.quantize_selected_notes",
      "template.midi.set_cc_events_batch",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D17_MIDI_EDIT_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d17Input(id),
        refs: { take_ref: TAKE_REF },
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(CAPABILITIES.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "midi");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "take" && ref.ref === TAKE_REF.ref), true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
  });

  it("binds MIDI edit handlers through extracted Lua without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["midi.set_notes_batch", "d17_midi_set_notes_batch"],
      ["midi.quantize_notes", "d17_midi_quantize_notes"],
      ["midi.quantize_selected_notes", "d17_midi_quantize_selected_notes"],
      ["midi.set_cc_events_batch", "d17_midi_set_cc_events_batch"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "MIDI_GetNote",
      "MIDI_SetNote",
      "MIDI_GetCC",
      "MIDI_SetCC",
      "MIDI_Sort",
      "MIDI_GetGrid",
      "STALE_TAKE_HASH",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const TAKE_REF = createObjectRef("take", { scheme: "guid", value: "{D17-TAKE}" }, {
  ref: "take:guid:{D17-TAKE}",
});

function d17Input(id) {
  if (id === "template.midi.set_notes_batch") {
    return { expected_take_hash: "take:guid:{D17-TAKE}:1:1:0", notes: [{ index: 0, velocity: 100 }] };
  }
  if (id === "template.midi.quantize_notes") {
    return { grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true, expected_take_hash: "take:guid:{D17-TAKE}:1:1:0" };
  }
  if (id === "template.midi.quantize_selected_notes") {
    return { grid_unit: "ppq", grid_ppq: 120, strength: 1, preserve_duration: true, require_selected_notes: true, expected_take_hash: "take:guid:{D17-TAKE}:1:1:0" };
  }
  return { expected_take_hash: "take:guid:{D17-TAKE}:1:1:0", events: [{ index: 0, value: 96 }] };
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
