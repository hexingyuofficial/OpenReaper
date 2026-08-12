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
  "items.set_exact_selection",
  "items.set_item_volume",
  "items.set_item_take_controls_batch",
  "items.set_take_volume",
  "items.set_take_pan",
  "items.set_active_take",
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

  it("adds a separate runtime allowlist for the seventeen D13 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D13_ITEMS_CORE_TEMPLATE_IDS, [
      "template.items.list_selected_items",
      "template.items.set_exact_selection",
      "template.items.list_items_on_track",
      "template.items.set_item_volume",
      "template.items.set_item_take_controls_batch",
      "template.items.set_take_volume",
      "template.items.set_take_pan",
      "template.items.set_active_take",
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
        "run_command:template.execute",
        "query_state:items.list_items_on_track",
        ...Array(WRITE_CAPABILITIES.length - 1).fill("run_command:template.execute"),
      ],
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "items.list_selected_items",
      "items.set_exact_selection",
      "items.list_items_on_track",
      ...WRITE_CAPABILITIES.slice(1),
    ]);

    for (const request of bridge.seen.filter((entry) => entry.pack.risk === "read")) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.verification.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
    }
    const listTrackRequest = bridge.seen.find((entry) => entry.pack.capability === "items.list_items_on_track");
    assert.equal(listTrackRequest.refs.some((ref) => ref.kind === "track" && ref.ref === TRACK_REF.ref), true);

    for (const request of bridge.seen.filter((entry) => entry.pack.risk === "write")) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      if (request.pack.capability === "items.set_item_take_controls_batch" || request.pack.capability === "items.set_exact_selection") {
        assert.equal(request.refs.length, 0);
        if (request.pack.capability === "items.set_item_take_controls_batch") {
          assert.equal(request.params.batch[0].item_ref, ITEM_REF.ref);
          assert.equal(request.params.batch[0].take_ref, TAKE_REF.ref);
        } else {
          assert.deepEqual(request.params.item_refs, [ITEM_REF.ref]);
        }
      } else {
        assert.equal(request.refs.some((ref) => ref.kind === "item" && ref.ref === ITEM_REF.ref), true);
      }
      if (request.pack.capability === "items.set_active_take") {
        assert.equal(request.refs.some((ref) => ref.kind === "take" && ref.ref === TAKE_REF.ref), true);
      }
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
      "GetMediaItemTake_Source",
      "PCM_Source_GetSectionInfo",
      "D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID",
      "d13_items_values_match",
      "VERIFY_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /VERIFICATION_FAILED/);
    const batchHandlerSource = HANDLER_SOURCE.match(
      /local D13_ITEMS_SET_ITEM_TAKE_CONTROLS_BATCH_MAX_ROWS[\s\S]*?\nlocal function d13_items_set_item_volume/,
    )?.[0];
    assert.equal(typeof batchHandlerSource, "string");
    assert.match(
      batchHandlerSource,
      /local function d13_items_set_item_take_controls_batch\(request, resume_continuation\)/,
    );
    assert.doesNotMatch(batchHandlerSource, /refs\[#refs \+ 1\]/);
    assert.doesNotMatch(HANDLER_SOURCE, /return nil,\s*d13_items_batch_error\(/);
    assert.doesNotMatch(batchHandlerSource, /(?:mutation_failure|readback_failure)\s*=\s*d13_items_batch_error\(/);
    assert.match(HANDLER_SOURCE, /local item = row\.item\s+if item == JSON_NULL then item = nil end/);
    assert.match(HANDLER_SOURCE, /local take = row\.take\s+if take == JSON_NULL then take = nil end/);
    assert.doesNotMatch(BRIDGE_SOURCE, /return nil,\s*d13_items_batch_error\(/);
    assert.doesNotMatch(BRIDGE_SOURCE, /(?:mutation_failure|readback_failure)\s*=\s*d13_items_batch_error\(/);
    assert.match(BRIDGE_SOURCE, /local item = row\.item\s+if item == JSON_NULL then item = nil end/);
    assert.match(BRIDGE_SOURCE, /local take = row\.take\s+if take == JSON_NULL then take = nil end/);
    assert.match(
      batchHandlerSource,
      /return d13_items_batch_summary\(request, prepared, result_rows, false, true, batch_timings\), nil, json_array\(\{\}\), json_array\(\{\}\), json_array\(\{\}\)/,
    );
    assert.match(
      ROUTE_SOURCE,
      /handler = D13_ITEMS_CORE_WRITE_HANDLERS\[request\.pack\.capability\][\s\S]*?return handler\(request, resume_continuation\)/,
    );
    assert.match(
      ROUTE_SOURCE,
      /if d13_item_take_batch_capability and not resume_continuation then\s+phase_may_mutate = false\s+end/,
    );
    assert.match(HANDLER_SOURCE, /call_reaper\("Main_OnCommandEx", D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID, 0, 0\)/);
    const withoutReviewedReverseAction = HANDLER_SOURCE.replace(
      /call_reaper\("Main_OnCommandEx", D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID, 0, 0\)/g,
      "",
    );
    assert.doesNotMatch(withoutReviewedReverseAction, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const ITEM_REF = createObjectRef("item", { scheme: "guid", value: "{D13-ITEM}" }, {
  ref: "item:guid:{D13-ITEM}",
});
const TAKE_REF = createObjectRef("take", { scheme: "guid", value: "{D13-TAKE}" }, {
  ref: "take:guid:{D13-TAKE}",
});
const TRACK_REF = createObjectRef("track", { scheme: "guid", value: "{D13-TRACK}" }, {
  ref: "track:guid:{D13-TRACK}",
});

function d13Input(id) {
  if (id === "template.items.list_selected_items") {
    return { limit: 8, include_track_refs: true };
  }
  if (id === "template.items.set_exact_selection") {
    return { mode: "replace", item_refs: [ITEM_REF.ref] };
  }
  if (id === "template.items.list_items_on_track") {
    return { limit: 8, include_take_summary: true };
  }
  if (id === "template.items.set_item_volume" || id === "template.items.set_take_volume") {
    return { volume_db: -3 };
  }
  if (id === "template.items.set_item_take_controls_batch") {
    return {
      batch: [{
        id: "row1",
        item_ref: ITEM_REF.ref,
        take_ref: TAKE_REF.ref,
        item: { volume_db: -3 },
        take: { pan: -0.25 },
      }],
      dry_run: true,
    };
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
  if (id === "template.items.list_selected_items" || id === "template.items.set_exact_selection" || id === "template.items.set_item_take_controls_batch") {
    return {};
  }
  if (id === "template.items.list_items_on_track") {
    return { track_ref: TRACK_REF };
  }
  if (id === "template.items.set_active_take") {
    return { item_ref: ITEM_REF, take_ref: TAKE_REF };
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
    "items.set_exact_selection": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_exact_selection",
    "items.set_item_volume": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_item_volume",
    "items.set_item_take_controls_batch": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_item_take_controls_batch",
    "items.set_take_volume": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_volume",
    "items.set_take_pan": "OPENREAPER_HANDLER_EXPORTS.d13_items_set_take_pan",
    "items.set_active_take": "OPENREAPER_HANDLER_EXPORTS.set_active_take",
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
