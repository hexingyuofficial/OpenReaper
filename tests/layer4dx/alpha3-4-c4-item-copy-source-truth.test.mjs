import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/items/e4_item_route.lua", import.meta.url), "utf8");

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" and value ~= "" end
function is_object(value) return type(value) == "table" end
local JSON_ARRAY_MT = { __openreaper_json_array = true }
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function json_array(value) return setmetatable(value or {}, JSON_ARRAY_MT) end
function first_number(value) return type(value) == "number" and value or nil end
function first_string(value) return type(value) == "string" and value or nil end
READ_B_MEDIA = {
  canonical_path = function(path) if type(path) ~= "string" or path == "" or path:find("\\0", 1, true) then return nil end if path:sub(1, 1) == "/" or path:match("^[A-Za-z]:[\\\\/]") or path:match("^\\\\\\\\") then return path end return nil end,
  inline_budget_allows_file_ref = function(request, path) local budget = request.budget or {}; local max = budget.max_inline_value_bytes or 65536; local bytes = #("file:path:" .. path); return bytes <= max, bytes, max end,
  complete_success_envelope_fits = function(request, summary, refs) local budget = request.budget or {}; local max = budget.max_response_bytes or 65536; local required = #summary.source_footprint.canonical_source_identity + 1024; return required <= max, required, { max_response_bytes = max } end,
}
function call_reaper(name, ...) return false end
function file_exists(path) return type(path) == "string" and path == "/tmp/source.wav" end
`;

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `${PRELUDE}\n${SOURCE}\n${body}`;
  const status = lauxlib.luaL_dostring(state, to_luastring(source));
  if (status !== lua.LUA_OK) throw new Error(to_jsstring(lua.lua_tostring(state, -1)));
  lua.lua_close(state);
}

describe("Alpha3.4-C4 item copy source footprint truth", () => {
  it("preflights every supported source fact before target creation and performs zero writes on an unreadable getter", () => {
    runLua(`
local source_item, target_track = {}, {}
local writes = 0
call_reaper = function(name, ...)
  local args = { ... }
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, source_item end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{SOURCE}" end
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, target_track end
  if name == "GetTrackGUID" then return true, "{TARGET}" end
  if name == "GetActiveTake" then return true, {} end
  if name == "GetMediaItemTake_Source" then return true, {} end
  if name == "GetMediaSourceFileName" then return true, "/tmp/source.wav" end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return false end
  if name == "AddMediaItemToTrack" or name == "AddTakeToMediaItem" or name:match("^Set") then writes = writes + 1 end
  return false
end
local summary, failure = copy_item_to_track({
  pack = { id = "items", capability = "item.copy_to_track", risk = "write" }, params = { position_seconds = 4 },
  refs = json_array({ { kind = "item", ref = "item:guid:{SOURCE}", identity = { scheme = "guid", value = "{SOURCE}" } }, { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } } }),
})
assert(summary == nil and failure ~= nil, failure and failure.code or "missing_failure")
assert(writes == 0, "writes=" .. tostring(writes))
`);
  });

  it("requires setter acceptance, cleans a partial target, and never re-imports the source", () => {
    runLua(`
local source = { filename = "/tmp/source.wav" }
local source_take = { source = source, start = 0.25, rate = 1.25, pitch = -2, preserve = 1 }
local source_track = { guid = "{SOURCE-TRACK}" }
local source_item = { guid = "{SOURCE}", active = source_take, length = 3, position = 1, track = source_track }
source_take.guid = "{SOURCE-TAKE}"
local target_track = { guid = "{TARGET}" }
local deleted, source_set_calls, creates = 0, 0, 0
call_reaper = function(name, ...)
  local args = { ... }
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, source_item end
  if name == "GetSetMediaItemInfo_String" then return true, true, args[1].guid end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, args[1].guid end
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, target_track end
  if name == "GetTrackGUID" then return true, target_track.guid end
  if name == "GetMediaItemTrack" then return true, args[1].track end
  if name == "GetActiveTake" then return true, args[1].active end
  if name == "GetMediaItemTake_Source" then return true, args[1].source end
  if name == "GetMediaSourceFileName" then return true, args[1].filename end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 8, false end
  if name == "GetMediaItemInfo_Value" then return true, args[2] == "D_POSITION" and args[1].position or args[1].length end
  if name == "GetMediaItemTakeInfo_Value" then local t, key = args[1], args[2]; return true, key == "D_STARTOFFS" and t.start or key == "D_PLAYRATE" and t.rate or key == "D_PITCH" and t.pitch or t.preserve end
  if name == "PCM_Source_Duplicate" then return true, { filename = source.filename } end
  if name == "AddMediaItemToTrack" then creates = creates + 1; return true, { guid = "{NEW}", length = 0, position = 0, track = target_track } end
  if name == "AddTakeToMediaItem" then local take = { guid = "{NEW-TAKE}", source = nil, start = 0, rate = 1, pitch = 0, preserve = 0 }; args[1].active = take; return true, take end
  if name == "SetMediaItemTake_Source" then source_set_calls = source_set_calls + 1; return true, false end
  if name == "DeleteTrackMediaItem" then deleted = deleted + 1; return true, true end
  if name == "PCM_Source_Destroy" then return true end
  return true, true
end
local summary, failure = copy_item_to_track({
  pack = { id = "items", capability = "item.copy_to_track", risk = "write" }, params = { position_seconds = 4 },
  refs = json_array({ { kind = "item", ref = "item:guid:{SOURCE}", identity = { scheme = "guid", value = "{SOURCE}" } }, { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } } }),
})
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(creates == 1 and source_set_calls == 1 and deleted == 1)
`);
  });

  it("accepts the native void source setter only after pointer and full footprint readback", () => {
    runLua(`
local source = { filename = "/tmp/source.wav" }
local source_take = { guid = "{SOURCE-TAKE}", source = source, start = 0.25, rate = 1.25, pitch = -2, preserve = 1 }
local source_track = { guid = "{SOURCE-TRACK}" }
local source_item = { guid = "{SOURCE}", active = source_take, length = 3, position = 1, track = source_track }
local target_track = { guid = "{TARGET}" }
local created_item, created_take, duplicate_source
local calls = { create = 0, source_set = 0, delete = 0, import = 0 }
call_reaper = function(name, ...)
  local args = { ... }
  if name == "CountMediaItems" then return true, 1 end
  if name == "GetMediaItem" then return true, source_item end
  if name == "GetSetMediaItemInfo_String" then return true, true, args[1].guid end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, args[1].guid end
  if name == "CountTracks" then return true, 2 end
  if name == "GetTrack" then return true, args[3] == 0 and source_track or target_track end
  if name == "GetTrackGUID" then return true, args[1].guid end
  if name == "GetMediaItemTrack" then return true, args[1].track end
  if name == "GetActiveTake" then return true, args[1].active end
  if name == "GetMediaItemTake_Source" then return true, args[1].source end
  if name == "GetMediaSourceFileName" then return true, args[1].filename end
  if name == "GetMediaSourceType" then return true, "WAVE" end
  if name == "GetMediaSourceLength" then return true, 8, false end
  if name == "GetMediaItemInfo_Value" then
    return true, args[2] == "D_POSITION" and args[1].position or args[1].length
  end
  if name == "GetMediaItemTakeInfo_Value" then
    local take, key = args[1], args[2]
    return true, key == "D_STARTOFFS" and take.start or key == "D_PLAYRATE" and take.rate or key == "D_PITCH" and take.pitch or take.preserve
  end
  if name == "PCM_Source_Duplicate" then duplicate_source = { filename = source.filename }; return true, duplicate_source end
  if name == "AddMediaItemToTrack" then
    calls.create = calls.create + 1
    created_item = { guid = "{NEW}", length = 0, position = 0, track = target_track }
    return true, created_item
  end
  if name == "SetMediaItemInfo_Value" then
    if args[2] == "D_POSITION" then args[1].position = args[3] else args[1].length = args[3] end
    return true, true
  end
  if name == "AddTakeToMediaItem" then
    created_take = { guid = "{NEW-TAKE}", source = nil, start = 0, rate = 1, pitch = 0, preserve = 0 }
    args[1].active = created_take
    return true, created_take
  end
  if name == "SetMediaItemTake_Source" then
    calls.source_set = calls.source_set + 1
    args[1].source = args[2]
    return true
  end
  if name == "SetMediaItemTakeInfo_Value" then
    local take, key, value = args[1], args[2], args[3]
    if key == "D_STARTOFFS" then take.start = value elseif key == "D_PLAYRATE" then take.rate = value elseif key == "D_PITCH" then take.pitch = value else take.preserve = value end
    return true, true
  end
  if name == "SetActiveTake" then return true end
  if name == "UpdateItemInProject" then return true end
  if name == "DeleteTrackMediaItem" then calls.delete = calls.delete + 1; return true, true end
  if name == "PCM_Source_CreateFromFile" then calls.import = calls.import + 1; return true, {} end
  return false
end
local summary, failure, _, _, refs = copy_item_to_track({
  pack = { id = "items", capability = "item.copy_to_track", risk = "write" }, params = { position_seconds = 4 },
  refs = json_array({ { kind = "item", ref = "item:guid:{SOURCE}", identity = { scheme = "guid", value = "{SOURCE}" } }, { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } } }),
})
assert(failure == nil and summary ~= nil, failure and failure.code or "missing_summary")
assert(calls.create == 1 and calls.source_set == 1 and calls.delete == 0 and calls.import == 0)
assert(created_take.source == duplicate_source and created_item.position == 4 and created_item.length == 3)
assert(summary.new_item_ref == "item:guid:{NEW}" and summary.active_take_ref == "take:guid:{NEW-TAKE}")
assert(summary.source_footprint.canonical_source_identity == "file:path:/tmp/source.wav")
assert(summary.source_footprint.start_offset_seconds == 0.25 and summary.source_footprint.playrate == 1.25)
assert(summary.source_footprint.pitch == -2 and summary.source_footprint.preserve_pitch == true)
assert(source_item.position == 1 and source_item.length == 3 and source_item.active == source_take)
assert(#refs == 4)
`);
  });

  it("keeps the generated bridge sourced from the same source-first fail-closed route", () => {
    assert.match(SOURCE, /source_footprint_unreadable/);
    assert.match(SOURCE, /SetMediaItemTake_Source[\s\S]*assigned_source ~= duplicate/);
    assert.match(SOURCE, /partial_target_cleanup_failed/);
    assert.match(SOURCE, /READ_B_MEDIA\.canonical_path/);
    assert.match(SOURCE, /first_string\(source_type\) == "SECTION"/);
    assert.match(SOURCE, /source_identity_exceeds_inline_budget/);
    assert.match(SOURCE, /success_envelope_budget_insufficient/);
    assert.match(SOURCE, /first_number\(preserve\) ~= 0 and first_number\(preserve\) ~= 1/);
    assert.match(SOURCE, /e4_item_snapshot_matches\(source_snapshot\)/);
    assert.match(SOURCE, /file_exists\(canonical_path\) ~= true/);
    assert.doesNotMatch(SOURCE, /PCM_Source_CreateFromFile/);
  });
});
