import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/items/d13_items_core_route.lua", import.meta.url),
  "utf8",
);
const READ_IDS = Object.freeze([
  "template.items.list_selected_items",
  "template.items.list_items_on_track",
]);
const WRITE_CAPABILITIES = Object.freeze([
  "items.set_item_volume",
  "items.set_take_volume",
  "items.set_take_pan",
  "items.rename_take",
  "items.set_loop_source",
  "items.set_mute",
  "items.set_lock",
  "items.set_play_all_takes",
  "items.set_take_start_in_source",
  "items.set_channel_mode",
  "items.set_pitch_shift_mode",
  "items.set_stretch_marker_fade_size",
]);

describe("D13 items core live handler expansion", () => {
  it("registers exactly the bounded items core batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d13-items-core-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the fourteen D13 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS, [
      "template.items.list_selected_items",
      "template.items.list_items_on_track",
      "template.items.set_item_volume",
      "template.items.set_take_volume",
      "template.items.set_take_pan",
      "template.items.rename_take",
      "template.items.set_loop_source",
      "template.items.set_mute",
      "template.items.set_lock",
      "template.items.set_play_all_takes",
      "template.items.set_take_start_in_source",
      "template.items.set_channel_mode",
      "template.items.set_pitch_shift_mode",
      "template.items.set_stretch_marker_fade_size",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d13Input(id),
        refs: d13Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "query_state:items.list_selected_items",
        "query_state:items.list_items_on_track",
        ...Array(WRITE_CAPABILITIES.length).fill("run_command:template.execute"),
      ],
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "items.list_selected_items",
      "items.list_items_on_track",
      ...WRITE_CAPABILITIES,
    ]);

    for (const request of bridge.seen.slice(0, 2)) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.verification.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
    }
    assert.equal(bridge.seen[1].refs.some((ref) => ref.kind === "track" && ref.ref === TRACK_REF.ref), true);

    for (const request of bridge.seen.slice(2)) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "item" && ref.ref === ITEM_REF.ref), true);
      if ("idempotency_key" in request) {
        assert.equal(typeof request.idempotency_key, "string");
      }
    }

    for (const request of bridge.seen) {
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
  });

  it("binds item reads and writes through extracted Lua handlers without raw execution surfaces", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:items\.list_selected_items"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.d13_items_list_selected_items/);
    assert.match(BRIDGE_SOURCE, /\["query_state:items\.list_items_on_track"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.d13_items_list_items_on_track/);
    for (const capability of WRITE_CAPABILITIES) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handlerExport(capability)}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "CountSelectedMediaItems",
      "GetSelectedMediaItem",
      "CountTrackMediaItems",
      "GetTrackMediaItem",
      "SetMediaItemInfo_Value",
      "SetMediaItemTakeInfo_Value",
      "GetSetMediaItemTakeInfo_String",
      "UpdateItemInProject",
      "D_VOL",
      "D_PAN",
      "B_MUTE",
      "C_LOCK",
      "B_LOOPSRC",
      "B_ALLTAKESPLAY",
      "D_STARTOFFS",
      "I_CHANMODE",
      "I_PITCHMODE",
      "F_STRETCHFADESIZE",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const ITEM_REF = createObjectRef("item", { scheme: "guid", value: "{D13-ITEM}" }, {
  ref: "item:guid:{D13-ITEM}",
});
const TRACK_REF = createObjectRef("track", { scheme: "guid", value: "{D13-TRACK}" }, {
  ref: "track:guid:{D13-TRACK}",
});

function d13Input(id) {
  if (id === "template.items.list_selected_items") {
    return { limit: 8, include_track_refs: true };
  }
  if (id === "template.items.list_items_on_track") {
    return { limit: 8, include_take_summary: true };
  }
  if (id === "template.items.set_item_volume" || id === "template.items.set_take_volume") {
    return { volume_db: -3 };
  }
  if (id === "template.items.set_take_pan") {
    return { pan: -0.25 };
  }
  if (id === "template.items.rename_take") {
    return { name: "OpenReaper D13" };
  }
  if (id === "template.items.set_loop_source") {
    return { loop_source: true };
  }
  if (id === "template.items.set_mute") {
    return { muted: false };
  }
  if (id === "template.items.set_lock") {
    return { locked: false };
  }
  if (id === "template.items.set_play_all_takes") {
    return { play_all_takes: false };
  }
  if (id === "template.items.set_take_start_in_source") {
    return { start_offset_seconds: 0.1 };
  }
  if (id === "template.items.set_channel_mode") {
    return { channel_mode: "normal" };
  }
  if (id === "template.items.set_pitch_shift_mode") {
    return { mode: "project_default" };
  }
  if (id === "template.items.set_stretch_marker_fade_size") {
    return { fade_size_ms: 2.5 };
  }
  return {};
}

function d13Refs(id) {
  if (id === "template.items.list_selected_items") {
    return {};
  }
  if (id === "template.items.list_items_on_track") {
    return { track_ref: TRACK_REF };
  }
  return { item_ref: ITEM_REF };
}

function context(extra = {}) {
  return {
    session_id: "test-session",
    request_id: "test-request",
    expected_owner: "owner-test",
    expected_generation: 1,
    ...extra,
  };
}

function handlerExport(capability) {
  return {
    "items.set_item_volume": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_item_volume",
    "items.set_take_volume": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_volume",
    "items.set_take_pan": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_pan",
    "items.rename_take": "OPENREAPER_HANDLER_EXPORTS.d13_items_rename_take",
    "items.set_loop_source": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_loop_source",
    "items.set_mute": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_mute",
    "items.set_lock": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_lock",
    "items.set_play_all_takes": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_play_all_takes",
    "items.set_take_start_in_source": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_start_in_source",
    "items.set_channel_mode": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_channel_mode",
    "items.set_pitch_shift_mode": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_pitch_shift_mode",
    "items.set_stretch_marker_fade_size": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_stretch_marker_fade_size",
  }[capability];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
