import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
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

  it("runs the native selector guard before deletion and keeps GUID scans linear at 512", () => {
    const assertions = String.raw`
local items, deletes, get_calls = {}, 0, 0
for i = 1, 513 do items[i] = { guid = "{ITEM-" .. i .. "}", track = {} } end
reaper = {}
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) get_calls = get_calls + 1; return items[index + 1] end
reaper.BR_GetMediaItemGUID = function(item) return item.guid end
reaper.GetMediaItemTrack = function(item) return item.track end
reaper.GetMediaItemInfo_Value = function(_, key) return (key == "B_UISEL" or key == "B_MUTE") and 1 or 0 end
reaper.CountSelectedMediaItems = function() return 0 end
reaper.GetSelectedMediaItem = function() return nil end
reaper.DeleteTrackMediaItem = function() deletes = deletes + 1; return true end
reaper.UpdateArrange = function() end
local refs = {}
for i = 1, 512 do refs[i] = { kind = "item", ref = "item:guid:{ITEM-" .. i .. "}", identity = { scheme = "guid", value = "{ITEM-" .. i .. "}" } } end
local request = { refs = refs, params = { selector_guard = { kind = "current_selection", entity_kind = "item", refs = (function() local out = {}; for i = 1, 512 do out[i] = "item:guid:{ITEM-" .. i .. "}" end; return out end)() } }, pack = { capability = "items.delete", id = "items", risk = "destructive" }, budget = { max_items = 1024 } }
local _, failure = d14_items_delete_items(request)
assert(failure.code == "PREWRITE_SELECTION_DRIFT")
assert(deletes == 0)
assert(get_calls == 513)
local predicate_request = { refs = { refs[1] }, params = { selector_guard = { kind = "predicate", entity_kind = "item", selector = { field = "muted", operator = "equals", value = true }, refs = { "item:guid:{ITEM-1}" } } }, pack = request.pack, budget = request.budget }
local _, predicate_failure = d14_items_delete_items(predicate_request)
assert(predicate_failure.code == "SELECTOR_TRUNCATED")
assert(deletes == 0)
assert(get_calls == 1539)
`;
    runLua(`${D14_LUA_PRELUDE}\n${HANDLER_SOURCE}\n${assertions}`);
  });
});

const D14_LUA_PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
function json_array(value) return value or {} end
function first_number(...) for i = 1, select("#", ...) do local v = select(i, ...); if type(v) == "number" then return v end end end
function first_string(...) for i = 1, select("#", ...) do local v = select(i, ...); if type(v) == "string" then return v end end end
function bounded_string(value) return tostring(value or "") end
function safe_budget(request) return request.budget or { max_items = 512 } end
function call_reaper(name, ...) if not reaper[name] then return false end return pcall(reaper[name], ...) end
`;

function runLua(source) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const status = lauxlib.luaL_loadstring(state, to_luastring(source));
  assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "D14 Lua loaded" : to_jsstring(lua.lua_tostring(state, -1)));
  const callStatus = lua.lua_pcall(state, 0, 0, 0);
  assert.equal(callStatus, lua.LUA_OK, callStatus === lua.LUA_OK ? "D14 Lua executed" : to_jsstring(lua.lua_tostring(state, -1)));
}

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
