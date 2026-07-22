import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/items/e4_item_route.lua", import.meta.url), "utf8");
const GENERATED = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" and value ~= "" end
function is_object(value) return type(value) == "table" end
local JSON_ARRAY_MT = { __openreaper_json_array = true }
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function json_array(value) return setmetatable(value or {}, JSON_ARRAY_MT) end
function first_number(value) return type(value) == "number" and value or nil end
function first_string(value) return type(value) == "string" and value or nil end
READ_B_MEDIA = { canonical_path = function(path) return path end, complete_success_envelope_fits = function() return true, 1, {} end }
function file_exists() return true end
function call_reaper() return false end
`;

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const status = lauxlib.luaL_dostring(state, to_luastring(`${PRELUDE}\n${SOURCE}\n${body}`));
  if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  lua.lua_close(state);
}

describe("Alpha3.45 item copy Take FX truth", () => {
  it("copies every bounded active-Take FX state with native CopyToTake and verifies exact ordered names, idents, and values", () => {
    runLua(`
local source, target = {}, {}
local source_fx = {
  { name = "ReaEQ", enabled = true, params = {
    { name = "Frequency", ident = ":0", value = 0.2 },
    { name = "Gain", ident = ":1", value = 0.8 },
  } },
  { name = "ReaComp", enabled = false, params = {
    { name = "Threshold", ident = ":0", value = 0.5 },
  } },
}
local target_fx, copied = {}, 0
local function chain(take) return take == source and source_fx or target_fx end
call_reaper = function(name, ...)
  local args = { ... }; local take, fx_index, param_index = args[1], args[2], args[3]
  if name == "TakeFX_GetCount" then return true, #chain(take) end
  if name == "TakeFX_GetFXName" then return true, true, chain(take)[fx_index + 1].name end
  if name == "TakeFX_GetEnabled" then return true, chain(take)[fx_index + 1].enabled end
  if name == "TakeFX_GetNumParams" then return true, #chain(take)[fx_index + 1].params end
  if name == "TakeFX_GetParamName" then return true, true, chain(take)[fx_index + 1].params[param_index + 1].name end
  if name == "TakeFX_GetParamIdent" then return true, true, chain(take)[fx_index + 1].params[param_index + 1].ident end
  if name == "TakeFX_GetParamNormalized" then return true, chain(take)[fx_index + 1].params[param_index + 1].value end
  if name == "TakeFX_CopyToTake" then
    assert(take == source and args[3] == target and args[5] == false)
    local source_row = source_fx[fx_index + 1]
    target_fx[args[4] + 1] = { name = source_row.name, enabled = source_row.enabled, params = { table.unpack(source_row.params) } }
    copied = copied + 1
    return true
  end
  return false
end
local snapshot, failure = e4_item_read_take_fx_snapshot(source)
assert(failure == nil and snapshot.fx_count == 2 and #snapshot.chain == 2)
assert(snapshot.chain[1].name == "ReaEQ" and snapshot.chain[1].parameters[2].name == "Gain")
assert(snapshot.chain[1].parameters[2].ident == ":1" and snapshot.chain[1].parameters[2].normalized_value == 0.8)
assert(e4_item_copy_take_fx_snapshot(source, target, snapshot) == true)
assert(copied == 2 and e4_item_take_fx_snapshot_matches(target, snapshot) == true)
local evidence = e4_item_take_fx_evidence(snapshot)
assert(evidence.source_fx_count == 2 and evidence.target_fx_count == 2)
assert(evidence.ordered_chain[1].name == "ReaEQ" and evidence.ordered_chain[1].parameter_names[2] == "Gain")
assert(evidence.ordered_chain[1].parameter_idents[2] == ":1" and evidence.ordered_chain[2].name == "ReaComp")
local copy_evidence = e4_item_take_fx_copy_evidence(snapshot, "take:guid:{SOURCE-TAKE}", "take:guid:{TARGET-TAKE}")
assert(copy_evidence.status == "passed" and copy_evidence.source_count == 2 and copy_evidence.copied_count == 2)
assert(copy_evidence.slots[1].source_fx_ref == "fx:take:guid:{SOURCE-TAKE}:0")
assert(copy_evidence.slots[1].target_fx_ref == "fx:take:guid:{TARGET-TAKE}:0" and copy_evidence.slots[2].slot_index == 1)
`);
  });

  it("fails closed before target creation when source FX state is unreadable", () => {
    runLua(`
local take = {}
call_reaper = function(name, ...)
  if name == "TakeFX_GetCount" then return true, 1 end
  if name == "TakeFX_GetFXName" then return true, true, "ReaEQ" end
  if name == "TakeFX_GetEnabled" then return true, true end
  if name == "TakeFX_GetNumParams" then return true, 1 end
  if name == "TakeFX_GetParamName" then return true, true, "Frequency" end
  if name == "TakeFX_GetParamIdent" then return true, true, ":0" end
  if name == "TakeFX_GetParamNormalized" then return false end
  return false
end
local snapshot, failure = e4_item_read_take_fx_snapshot(take)
assert(snapshot == nil and failure == "take_fx_parameter_unreadable")
`);
  });

  it("fails closed on a missing parameter ident", () => {
    runLua(`
local take = {}
call_reaper = function(name, ...)
  if name == "TakeFX_GetCount" then return true, 1 end
  if name == "TakeFX_GetFXName" then return true, true, "ReaEQ" end
  if name == "TakeFX_GetEnabled" then return true, true end
  if name == "TakeFX_GetNumParams" then return true, 1 end
  if name == "TakeFX_GetParamName" then return true, true, "Frequency" end
  if name == "TakeFX_GetParamIdent" then return true, true, "" end
  return false
end
local snapshot, failure = e4_item_read_take_fx_snapshot(take)
assert(snapshot == nil and failure == "take_fx_parameter_unreadable")
`);
  });

  it("removes the complete partial target item when native Take FX copy fails after target creation", () => {
    runLua(`
local source = { filename = "/tmp/source.wav", source_type = "WAVE", length = 8 }
local source_take = { guid = "{SOURCE-TAKE}", source = source, start = 0, rate = 1, pitch = 0, preserve = 1 }
local source_track = { guid = "{SOURCE-TRACK}" }
local source_item = { guid = "{SOURCE}", active = source_take, length = 3, position = 1, track = source_track }
local target_track = { guid = "{TARGET}" }
local source_fx = { { name = "ReaEQ", enabled = true, params = { { name = "Frequency", ident = ":0", value = 0.2 } } } }
local target_fx, target_item, target_take = {}, nil, nil
local calls = { add_item = 0, copy = 0, delete = 0 }
local function chain(take) return take == source_take and source_fx or target_fx end
call_reaper = function(name, ...)
  local args = { ... }; local take, fx_index, param_index = args[1], args[2], args[3]
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, source_item end
  if name == "GetSetMediaItemInfo_String" then return true, true, args[1].guid end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, args[1].guid end
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, target_track end
  if name == "GetTrackGUID" then return true, args[1].guid end
  if name == "GetMediaItemTrack" then return true, args[1].track end
  if name == "GetActiveTake" then return true, args[1].active end
  if name == "GetMediaItemTake_Source" then return true, args[1].source end
  if name == "GetMediaSourceFileName" then return true, args[1].filename end
  if name == "GetMediaSourceType" then return true, args[1].source_type end
  if name == "GetMediaSourceLength" then return true, args[1].length, false end
  if name == "GetMediaItemInfo_Value" then return true, args[2] == "D_POSITION" and args[1].position or args[1].length end
  if name == "GetMediaItemTakeInfo_Value" then local key = args[2]; return true, key == "D_STARTOFFS" and take.start or key == "D_PLAYRATE" and take.rate or key == "D_PITCH" and take.pitch or take.preserve end
  if name == "TakeFX_GetCount" then return true, #chain(take) end
  if name == "TakeFX_GetFXName" then return true, true, chain(take)[fx_index + 1].name end
  if name == "TakeFX_GetEnabled" then return true, chain(take)[fx_index + 1].enabled end
  if name == "TakeFX_GetNumParams" then return true, #chain(take)[fx_index + 1].params end
  if name == "TakeFX_GetParamName" then return true, true, chain(take)[fx_index + 1].params[param_index + 1].name end
  if name == "TakeFX_GetParamIdent" then return true, true, chain(take)[fx_index + 1].params[param_index + 1].ident end
  if name == "TakeFX_GetParamNormalized" then return true, chain(take)[fx_index + 1].params[param_index + 1].value end
  if name == "AddMediaItemToTrack" then calls.add_item = calls.add_item + 1; target_item = { guid = "{NEW}", length = 0, position = 0, track = target_track }; return true, target_item end
  if name == "SetMediaItemInfo_Value" then if args[2] == "D_POSITION" then args[1].position = args[3] else args[1].length = args[3] end; return true, true end
  if name == "PCM_Source_CreateFromFile" then return true, { filename = args[1], source_type = "WAVE", length = 8 } end
  if name == "AddTakeToMediaItem" then target_take = { guid = "{NEW-TAKE}", start = 0, rate = 1, pitch = 0, preserve = 1 }; args[1].active = target_take; return true, target_take end
  if name == "SetMediaItemTake_Source" then args[1].source = args[2]; return true end
  if name == "SetMediaItemTakeInfo_Value" then local key = args[2]; if key == "D_STARTOFFS" then take.start = args[3] elseif key == "D_PLAYRATE" then take.rate = args[3] elseif key == "D_PITCH" then take.pitch = args[3] else take.preserve = args[3] end; return true, true end
  if name == "TakeFX_CopyToTake" then
    calls.copy = calls.copy + 1
    target_fx[1] = source_fx[1]
    return false
  end
  if name == "DeleteTrackMediaItem" then
    assert(args[2] == target_item and #target_fx == 1)
    calls.delete = calls.delete + 1
    target_fx = {}
    return true, true
  end
  return false
end
local summary, failure = copy_item_to_track({
  pack = { id = "items", capability = "item.copy_to_track", risk = "write" }, params = { position_seconds = 4 },
  refs = json_array({ { kind = "item", ref = "item:guid:{SOURCE}", identity = { scheme = "guid", value = "{SOURCE}" } }, { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } } }),
})
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.details.blocker == "target_take_fx_copy_or_readback_failed")
assert(calls.add_item == 1 and calls.copy == 1 and calls.delete == 1 and #target_fx == 0)
`);
  });

  it("keeps the generated bridge on the same generic copy/readback/cleanup path", () => {
    assert.match(SOURCE, /TakeFX_CopyToTake/, "source must use the native Take FX copy API");
    assert.match(SOURCE, /E4_ITEM_COPY_MAX_TAKE_FX = 64/);
    assert.match(SOURCE, /E4_ITEM_COPY_MAX_FX_PARAMETERS = 512/);
    assert.match(SOURCE, /take_fx_count_exceeds_limit/);
    assert.match(SOURCE, /target_take_fx_copy_or_readback_failed/);
    assert.match(SOURCE, /TakeFX_GetParamName/);
    assert.match(SOURCE, /TakeFX_GetParamIdent/);
    assert.match(SOURCE, /source_fx_count = snapshot\.fx_count/);
    assert.match(SOURCE, /take_fx_copy = e4_item_take_fx_copy_evidence/);
    assert.match(SOURCE, /e4_item_take_fx_snapshot_matches\(new_snapshot\.active_take, footprint\.take_fx\)/);
    assert.match(SOURCE, /e4_item_take_fx_snapshot_matches\(source_snapshot\.active_take, footprint\.take_fx\)/);
    assert.match(SOURCE, /partial_target_cleanup_failed/);
    assert.match(GENERATED, /target_take_fx_copy_or_readback_failed/);
  });
});
