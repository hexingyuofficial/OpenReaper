import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/items/d14_items_delete_route.lua", import.meta.url),
  "utf8",
);

describe("D14 items delete live handler expansion", () => {
  it("registers exactly the bounded destructive item delete batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d14-items-delete-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the two D14 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS, [
      "template.items.delete_item",
      "template.items.delete_items",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D14_ITEMS_DELETE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: { require_selected: false },
        refs: d14Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "run_command:template.execute",
        "run_command:template.execute",
      ],
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "items.delete_item",
      "items.delete_items",
    ]);

    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "destructive");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.every((ref) => ref.kind === "item"), true);
      assert.equal(request.refs.some((ref) => ref.ref === ITEM_REF_A.ref), true);
      assert.equal("idempotency_key" in request, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen[1].refs.some((ref) => ref.ref === ITEM_REF_B.ref), true);
  });

  it("binds item delete through extracted Lua handlers without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["items.delete_item", "d14_items_delete_item"],
      ["items.delete_items", "d14_items_delete_items"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "DeleteTrackMediaItem",
      "GetMediaItemTrack",
      "GetMediaItem_Track",
      "GetMediaItemInfo_Value",
      "GetMediaItem",
      "CountMediaItems",
      "UpdateArrange",
      "ITEM_NOT_FOUND",
      "ITEM_NOT_SELECTED",
      "VERIFICATION_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const ITEM_REF_A = createObjectRef("item", { scheme: "guid", value: "{D14-ITEM-A}" }, {
  ref: "item:guid:{D14-ITEM-A}",
});
const ITEM_REF_B = createObjectRef("item", { scheme: "guid", value: "{D14-ITEM-B}" }, {
  ref: "item:guid:{D14-ITEM-B}",
});

function d14Refs(id) {
  if (id === "template.items.delete_items") {
    return { item_ref: [ITEM_REF_A, ITEM_REF_B] };
  }
  return { item_ref: ITEM_REF_A };
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
