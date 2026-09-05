import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  FakeFoundationBridge,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const PROJECT_HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/read_track_item_overview.lua", import.meta.url),
  "utf8",
);
const ACTION_HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/actions/read_action_metadata.lua", import.meta.url),
  "utf8",
);
const ENVELOPE_KERNEL_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/20-bridge-envelope-kernel.lua", import.meta.url),
  "utf8",
);
const OPERATION_KEYS = Object.freeze([
  "query_state:project.read_track_item_overview",
  "query_state:actions.read_custom_action_metadata",
  "query_state:actions.read_cycle_action_metadata",
]);
const CAPABILITIES = Object.freeze([
  "project.read_track_item_overview",
  "actions.read_custom_action_metadata",
  "actions.read_cycle_action_metadata",
]);
const LUA_COUNT_PRELUDE = String.raw`
JSON_NULL = {}
function is_non_negative_integer(value)
  return type(value) == "number" and value >= 0 and value == math.floor(value)
end
function json_array(value) return value or {} end
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function first_string(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "string" then return value end
  end
  return nil
end
function bounded_string(value) return tostring(value or "") end
function safe_budget(request)
  return request.budget or { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 }
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function read_track_name(track, max_bytes)
  local ok, available, name = call_reaper("GetSetMediaTrackInfo_String", track, "P_NAME", "", false)
  if ok and available ~= false and type(name) == "string" then return bounded_string(name, max_bytes) end
  local fallback_ok, _, fallback_name = call_reaper("GetTrackName", track, "")
  return bounded_string(fallback_ok and first_string(fallback_name) or "", max_bytes)
end

local tracks = {
  { guid = "{COUNT-A}", index = 0, name = "Count A" },
  { guid = "{COUNT-B}", index = 1, name = "Count B" },
  { guid = "{COUNT-UNKNOWN}", index = 2, name = "Count Unknown" },
}
local send_categories = {}
reaper = {}
reaper.CountTracks = function(project) assert(project == 0); return #tracks end
reaper.CountMediaItems = function(project) assert(project == 0); return 6 end
reaper.GetTrack = function(project, index) assert(project == 0); return tracks[index + 1] end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetMediaTrackInfo_Value = function(track, key) assert(key == "IP_TRACKNUMBER"); return track.index + 1 end
reaper.GetTrackName = function(track) return true, track.name end
reaper.GetSetMediaTrackInfo_String = function(track, key, _, set_new_value)
  assert(key == "P_NAME" and set_new_value == false)
  return true, track.name
end
reaper.IsTrackSelected = function(track) return track.index == 1 end
reaper.CountTrackMediaItems = function(track)
  if track.index == 0 then return 2 end
  if track.index == 1 then return 4 end
  error("item count unavailable")
end
reaper.TrackFX_GetCount = function(track)
  if track.index == 0 then return 1 end
  if track.index == 1 then return 3 end
  return 1.5
end
reaper.GetTrackNumSends = function(track, category)
  send_categories[#send_categories + 1] = category
  if track.index == 0 then return 2 end
  if track.index == 1 then return 0 end
  return -1
end
reaper.CountSelectedMediaItems = function(project) assert(project == 0); return 0 end
`;

describe("D10 read overview/actions live handler expansion", () => {
  it("truncates bounded Bridge strings only on complete UTF-8 codepoint boundaries", () => {
    const assertions = String.raw`
local exact = "对白 主轨 中文"
assert(bounded_string(exact, #exact) == exact)
local long = string.rep("中", 30)
local truncated = bounded_string(long, 80)
assert(#truncated <= 80)
assert(truncated:sub(-3) == "...")
assert(utf8.len(truncated:sub(1, -4)) ~= nil)
assert(truncated == string.rep("中", 25) .. "...")
assert(bounded_string("abcdef", 3) == "...")
`;
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const status = lauxlib.luaL_loadstring(
      state,
      to_luastring(`JSON_NULL = {}\n${ENVELOPE_KERNEL_SOURCE}\n${assertions}`),
    );
    const loadMessage = status === lua.LUA_OK ? "UTF-8 helper Lua loaded" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(status, lua.LUA_OK, loadMessage);
    const callStatus = lua.lua_pcall(state, 0, 0, 0);
    const callMessage = callStatus === lua.LUA_OK ? "UTF-8 helper Lua executed" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(callStatus, lua.LUA_OK, callMessage);
  });

  it("registers exactly the bounded read overview/actions batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d10-read-overview-actions-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the three D10 read template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS, [
      "template.project.read_track_item_overview",
      "template.actions.read_custom_action_metadata",
      "template.actions.read_cycle_action_metadata",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d10Input(id),
        refs: {},
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.verification.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
          "template.actions.run_guarded_custom_action",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("binds D10 read handlers through the generated Lua bridge without action execution surfaces", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:project\.read_track_item_overview"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_track_item_overview/);
    assert.match(BRIDGE_SOURCE, /\["query_state:actions\.read_custom_action_metadata"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_custom_action_metadata/);
    assert.match(BRIDGE_SOURCE, /\["query_state:actions\.read_cycle_action_metadata"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_cycle_action_metadata/);
    assert.match(PROJECT_HANDLER_SOURCE, /CountTracks/);
    assert.match(PROJECT_HANDLER_SOURCE, /CountMediaItems/);
    assert.match(PROJECT_HANDLER_SOURCE, /GetTrackMediaItem/);
    assert.match(PROJECT_HANDLER_SOURCE, /IsTrackSelected/);
    assert.match(PROJECT_HANDLER_SOURCE, /track_cursor = d10_overview_bounded_offset/);
    assert.match(PROJECT_HANDLER_SOURCE, /item_cursor = d10_overview_bounded_offset/);
    assert.match(PROJECT_HANDLER_SOURCE, /take_cursor = d10_overview_bounded_offset/);
    assert.match(PROJECT_HANDLER_SOURCE, /call_reaper\("GetMediaItem", 0, index\)/);
    assert.match(PROJECT_HANDLER_SOURCE, /max_items_per_track_effective/);
    assert.match(PROJECT_HANDLER_SOURCE, /summary\.next_track_cursor = tostring\(end_track\)/);
    assert.match(PROJECT_HANDLER_SOURCE, /summary\.next_item_cursor = tostring\(end_item\)/);
    assert.match(PROJECT_HANDLER_SOURCE, /selector_matches_complete/);
    assert.doesNotMatch(PROJECT_HANDLER_SOURCE, /next_track_cursor = .*JSON_NULL/);
    assert.match(BRIDGE_SOURCE, /kbd_getTextFromCmd/);
    assert.match(BRIDGE_SOURCE, /NamedCommandLookup/);
    assert.match(ACTION_HANDLER_SOURCE, /CF_GetSWSVersion/);
    assert.doesNotMatch(
      `${PROJECT_HANDLER_SOURCE}\n${ACTION_HANDLER_SOURCE}`,
      /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("reads per-track item, FX, and internal-send counts without converting unknown evidence to zero", () => {
    const assertions = String.raw`
local summary = select(1, read_track_item_overview({
  params = { include_track_items = false, include_selected_items = false, max_tracks = 8 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
}))
assert(#summary.tracks == 3)
assert(summary.tracks[1].item_count == 2)
assert(summary.tracks[1].fx_count == 1)
assert(summary.tracks[1].send_count == 2)
assert(summary.tracks[2].item_count == 4)
assert(summary.tracks[2].fx_count == 3)
assert(summary.tracks[2].send_count == 0)
assert(summary.tracks[3].item_count == nil)
assert(summary.tracks[3].fx_count == nil)
assert(summary.tracks[3].send_count == nil)
assert(summary.tracks[3].items_truncated == true)
assert(#send_categories == 3)
for _, category in ipairs(send_categories) do assert(category == 0) end
`;
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const status = lauxlib.luaL_loadstring(
      state,
      to_luastring(`${LUA_COUNT_PRELUDE}\n${PROJECT_HANDLER_SOURCE}\n${assertions}`),
    );
    const loadMessage = status === lua.LUA_OK ? "D10 Lua loaded" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(status, lua.LUA_OK, loadMessage);
    const callStatus = lua.lua_pcall(state, 0, 0, 0);
    const callMessage = callStatus === lua.LUA_OK ? "D10 Lua executed" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(callStatus, lua.LUA_OK, callMessage);
  });

  it("reports TCP-only Track selection while no Item is selected and rejects unknown selection truth", () => {
    const assertions = String.raw`
local summary = select(1, read_track_item_overview({
  params = { include_track_items = false, include_selected_items = true, max_tracks = 8 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
}))
assert(summary.tracks[1].selected == false)
assert(summary.tracks[2].selected == true)
assert(summary.tracks[3].selected == false)
assert(#summary.selected_items == 0)

reaper.IsTrackSelected = function() return "unknown" end
local ok, failure = pcall(read_track_item_overview, {
  params = { include_track_items = false, include_selected_items = false, max_tracks = 8 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
})
assert(ok == false)
assert(tostring(failure):find("invalid Track selection value", 1, true) ~= nil)
`;
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const status = lauxlib.luaL_loadstring(
      state,
      to_luastring(`${LUA_COUNT_PRELUDE}\n${PROJECT_HANDLER_SOURCE}\n${assertions}`),
    );
    const loadMessage = status === lua.LUA_OK ? "D10 Lua loaded" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(status, lua.LUA_OK, loadMessage);
    const callStatus = lua.lua_pcall(state, 0, 0, 0);
    const callMessage = callStatus === lua.LUA_OK ? "D10 Lua executed" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(callStatus, lua.LUA_OK, callMessage);
  });

  it("pages a canonical native Take inventory and omits Take count claims when not requested", () => {
    const assertions = String.raw`
local media_items = {
  { guid = "{ITEM-A}", takes = { { guid = "{TAKE-A1}", midi = true, name = "MIDI 甲" }, { guid = "{TAKE-A2}", source_type = "WAVE", source_path = [[C:\用户 名称\对白素材\vo_角色_male1.ogg]], name = "Audio A" } } },
  { guid = "{ITEM-B}", takes = { { guid = "{TAKE-B1}", midi = true, name = "MIDI B" } } },
}
reaper.CountMediaItems = function() return #media_items end
reaper.GetMediaItem = function(_, index) return media_items[index + 1] end
reaper.GetMediaItemTrack = function() return tracks[1] end
reaper.GetSetMediaItemInfo_String = function(item, key) assert(key == "GUID"); return true, item.guid end
reaper.GetMediaItemInfo_Value = function(_, key)
  if key == "D_POSITION" then return 0 end
  if key == "D_LENGTH" then return 1 end
  return 0
end
reaper.CountTakes = function(item) return #item.takes end
reaper.GetTake = function(item, index) return item.takes[index + 1] end
reaper.GetActiveTake = function(item) return item.takes[1] end
reaper.GetSetMediaItemTakeInfo_String = function(take, key)
  if key == "GUID" then return true, take.guid end
  if key == "P_NAME" then return true, take.name end
  return false, ""
end
reaper.TakeIsMIDI = function(take) return take.midi == true end
reaper.GetMediaItemTake_Source = function(take) return take end
reaper.GetMediaSourceType = function(source) return source.source_type or "MIDI" end
reaper.GetMediaSourceFileName = function(source) return source.source_path or "" end

local unrequested = select(1, read_track_item_overview({
  params = { include_track_items = false, include_selected_items = false, max_tracks = 1, max_items = 1 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
}))
assert(unrequested.takes == nil)
assert(unrequested.take_count == nil)

local first, _, _, _, refs = read_track_item_overview({
  params = { include_track_items = false, include_selected_items = false, include_takes = true, max_tracks = 1, max_items = 1, max_takes = 2 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
})
assert(first.take_count == 3)
assert(first.returned_take_count == 2)
assert(first.takes_truncated == true)
assert(first.next_take_cursor == "2")
assert(first.take_coverage_status == "paged")
assert(first.takes[1].take_ref == "take:guid:{TAKE-A1}")
assert(first.takes[1].source_kind == "midi")
assert(first.takes[1].source_identity_status == "not_file_backed")
assert(first.takes[2].source_kind == "wave")
assert(first.takes[2].source_ref == [[file:path:C:\用户 名称\对白素材\vo_角色_male1.ogg]])
assert(first.takes[2].source_path == [[C:\用户 名称\对白素材\vo_角色_male1.ogg]])
assert(first.takes[2].source_basename == [[vo_角色_male1.ogg]])
assert(first.takes[2].source_identity_status == "available")
assert(refs[#refs].kind == "take" and refs[#refs].ref == "take:guid:{TAKE-A2}")

local second = select(1, read_track_item_overview({
  params = { include_track_items = false, include_selected_items = false, include_takes = true, max_tracks = 1, max_items = 1, max_takes = 2, take_cursor = 2 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
}))
assert(second.take_cursor == 2)
assert(second.returned_take_count == 1)
assert(second.takes[1].take_ref == "take:guid:{TAKE-B1}")
assert(second.takes_truncated == false)
assert(second.next_take_cursor == nil)
assert(second.take_coverage_status == "complete")
`;
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const status = lauxlib.luaL_loadstring(
      state,
      to_luastring(`${LUA_COUNT_PRELUDE}\n${PROJECT_HANDLER_SOURCE}\n${assertions}`),
    );
    const loadMessage = status === lua.LUA_OK ? "Take inventory Lua loaded" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(status, lua.LUA_OK, loadMessage);
    const callStatus = lua.lua_pcall(state, 0, 0, 0);
    const callMessage = callStatus === lua.LUA_OK ? "Take inventory Lua executed" : to_jsstring(lua.lua_tostring(state, -1));
    assert.equal(callStatus, lua.LUA_OK, callMessage);
  });

  it("returns GUID-bound Take FX rows with exact owner identity and Unicode Take names", () => {
    const assertions = String.raw`
local item = { guid = "{ITEM-FX}" }
local take = { guid = "{TAKE-FX}", name = "对白 Take 效果", fx = { { guid = "{FX-TAKE-1}", name = "VST: ReaEQ (Cockos)", ident = "VST: ReaEQ", enabled = true } } }
item.takes = { take }
reaper.CountMediaItems = function() return 1 end
reaper.GetMediaItem = function() return item end
reaper.GetMediaItemTrack = function() return tracks[1] end
reaper.GetSetMediaItemInfo_String = function(value, key) assert(value == item and key == "GUID"); return true, value.guid end
reaper.GetMediaItemInfo_Value = function(_, key) if key == "D_LENGTH" then return 1 end; return 0 end
reaper.CountTakes = function() return 1 end
reaper.GetTake = function() return take end
reaper.GetActiveTake = function() return take end
reaper.GetSetMediaItemTakeInfo_String = function(value, key)
  if key == "GUID" then return true, value.guid end
  if key == "P_NAME" then return true, value.name end
  return false, ""
end
reaper.TakeIsMIDI = function() return false end
reaper.GetMediaItemTake_Source = function() return take end
reaper.GetMediaSourceType = function() return "WAVE" end
reaper.TakeFX_GetCount = function(value) assert(value == take); return #value.fx end
reaper.TakeFX_GetFXGUID = function(value, slot) return value.fx[slot + 1].guid end
reaper.TakeFX_GetFXName = function(value, slot) return true, value.fx[slot + 1].name end
reaper.TakeFX_GetNamedConfigParm = function(value, slot, key) assert(key == "fx_ident"); return true, value.fx[slot + 1].ident end
reaper.TakeFX_GetEnabled = function(value, slot) return value.fx[slot + 1].enabled end

local summary, _, _, _, refs = read_track_item_overview({
  params = { include_track_items = false, include_selected_items = false, include_takes = true, include_take_fx = true, max_tracks = 1, max_items = 1, max_takes = 8 },
  budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 4096 },
})
assert(summary.take_count == 1 and summary.returned_take_count == 1)
assert(summary.takes[1].name == "对白 Take 效果")
assert(summary.takes[1].take_fx_count == 1 and summary.takes[1].has_take_fx == true)
assert(summary.returned_take_fx_count == 1)
assert(summary.take_fx_coverage_status == "complete")
assert(summary.take_fx_coverage.internally_complete == true)
local fx = summary.take_fx[1]
assert(fx.fx_ref == "fx:take:guid:{TAKE-FX}:0")
assert(fx.owner_kind == "take" and fx.owner_ref == "take:guid:{TAKE-FX}")
assert(fx.fx_guid == "{FX-TAKE-1}" and fx.slot_index == 0)
assert(fx.name == "VST: ReaEQ (Cockos)" and fx.plugin_id == "VST: ReaEQ")
assert(fx.enabled == true and fx.bypassed == false)
assert(refs[#refs].kind == "fx" and refs[#refs].ref == fx.fx_ref)
`;
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
    const status = lauxlib.luaL_loadstring(state, to_luastring(`${LUA_COUNT_PRELUDE}\n${PROJECT_HANDLER_SOURCE}\n${assertions}`));
    assert.equal(status, lua.LUA_OK, status === lua.LUA_OK ? "Take FX Lua loaded" : to_jsstring(lua.lua_tostring(state, -1)));
    const callStatus = lua.lua_pcall(state, 0, 0, 0);
    assert.equal(callStatus, lua.LUA_OK, callStatus === lua.LUA_OK ? "Take FX Lua executed" : to_jsstring(lua.lua_tostring(state, -1)));
  });
});

function d10Input(id) {
  if (id === "template.project.read_track_item_overview") {
    return {
      max_tracks: 12,
      max_items_per_track: 4,
      max_selected_items: 4,
      track_cursor: 0,
      include_selected_items: true,
      include_track_items: true,
    };
  }
  return { section: "main", named_command: "_OPENREAPER_D10_FAKE", include_step_summary: false };
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
