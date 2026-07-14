import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  buildLiveBridgeBundle,
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalogTemplates,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const FX_SOURCE = source("fx/delete_fx.lua");
const SEND_SOURCE = source("routing/remove_send.lua");
const ITEM_SOURCE = source("items/move_item_to_track.lua");
const CATALOG_SUMMARY_SOURCE = source("core/read_template_catalog_summary.lua");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");

const PRELUDE = String.raw`
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
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
function bounded_string(value, max_length)
  local text = value == nil and "" or tostring(value)
  if #text <= (max_length or 160) then return text end
  return string.sub(text, 1, (max_length or 160) - 3) .. "..."
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
`;

describe("Alpha3.3 exact lifecycle atom handler truth", () => {
  it("registers exactly three extracted native handlers and assembles their dispatch routes", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    const summary = validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    const rows = registry.entries.filter((entry) => entry.route === "alpha3-3-lifecycle-atom-handlers");
    assert.deepEqual(rows.map(({ template_id }) => template_id), CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS);
    assert.deepEqual(rows.map(({ handler_file, handler_export }) => [handler_file, handler_export]), [
      ["fx/delete_fx.lua", "alpha33_delete_fx"],
      ["routing/remove_send.lua", "alpha33_remove_send"],
      ["items/move_item_to_track.lua", "alpha33_move_item_to_track"],
    ]);
    assert.equal(summary.entryCount, 227);
    assert.equal(summary.extractedHandlerCount, 227);
    assert.equal(summary.handlerModuleCount, 87);
    assert.equal(summary.routeCount, 34);

    const built = buildLiveBridgeBundle({ cwd: ROOT.pathname });
    for (const [capability, handler] of [
      ["fx.delete_fx", "alpha33_delete_fx"],
      ["routing.remove_send", "alpha33_remove_send"],
      ["items.move_item_to_track", "alpha33_move_item_to_track"],
    ]) {
      assert.match(built, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
    }
  });

  it("deletes exact Track-FX and Take-FX by native GUID and fails closed on duplicate identity", () => {
    runLua(FX_SOURCE, String.raw`
track = { guid = "{TRACK}" }
item = {}
take = { guid = "{TAKE}" }
track_fx = {
  { guid = "{FX-TRACK-A}", name = "VST: Track A", ident = "vst:track-a" },
  { guid = "{FX-TRACK-B}", name = "VST: Track B", ident = "vst:track-b" },
}
take_fx = {
  { guid = "{FX-TAKE-A}", name = "VST: Take A", ident = "vst:take-a" },
}
calls = { track_delete = 0, take_delete = 0 }
reaper = {}
reaper.CountTracks = function(project) assert(project == 0); return 1 end
reaper.GetTrack = function(project, index) assert(project == 0); if index == 0 then return track end end
reaper.GetTrackGUID = function(actual) assert(actual == track); return actual.guid end
reaper.CountMediaItems = function(project) assert(project == 0); return 1 end
reaper.GetMediaItem = function(project, index) assert(project == 0); if index == 0 then return item end end
reaper.CountTakes = function(actual) assert(actual == item); return 1 end
reaper.GetTake = function(actual, index) assert(actual == item); if index == 0 then return take end end
reaper.GetSetMediaItemTakeInfo_String = function(actual, key, value, set_new)
  assert(actual == take and key == "GUID" and value == "" and set_new == false)
  return true, actual.guid
end
reaper.TrackFX_GetCount = function(actual) assert(actual == track); return #track_fx end
reaper.TakeFX_GetCount = function(actual) assert(actual == take); return #take_fx end
reaper.TrackFX_GetFXGUID = function(actual, index) assert(actual == track); return track_fx[index + 1] and track_fx[index + 1].guid end
reaper.TakeFX_GetFXGUID = function(actual, index) assert(actual == take); return take_fx[index + 1] and take_fx[index + 1].guid end
reaper.TrackFX_GetFXName = function(actual, index) assert(actual == track); return true, track_fx[index + 1].name end
reaper.TakeFX_GetFXName = function(actual, index) assert(actual == take); return true, take_fx[index + 1].name end
reaper.TrackFX_GetNamedConfigParm = function(actual, index, key) assert(actual == track and key == "fx_ident"); return true, track_fx[index + 1].ident end
reaper.TakeFX_GetNamedConfigParm = function(actual, index, key) assert(actual == take and key == "fx_ident"); return true, take_fx[index + 1].ident end
reaper.TrackFX_Delete = function(actual, index) assert(actual == track); calls.track_delete = calls.track_delete + 1; table.remove(track_fx, index + 1); return true end
reaper.TakeFX_Delete = function(actual, index) assert(actual == take); calls.take_delete = calls.take_delete + 1; table.remove(take_fx, index + 1); return true end
reaper.UpdateArrange = function() end

local track_request = {
  pack = { id = "fx", capability = "fx.delete_fx", risk = "destructive" },
  refs = {{ kind = "fx", ref = "fx:track:guid:{TRACK}:0", identity = { scheme = "track_fx", value = "track:guid:{TRACK}:0" } }},
}
local summary, failure, artifacts, jobs, refs = alpha33_delete_fx(track_request)
assert(failure == nil and summary.readback_status == "passed")
assert(summary.fx_guid == "{FX-TRACK-A}" and summary.name == "VST: Track A")
assert(summary.fx_count_before == 2 and summary.fx_count_after == 1)
assert(#track_fx == 1 and track_fx[1].guid == "{FX-TRACK-B}" and calls.track_delete == 1)
assert(#refs == 1 and refs[1].ref == track_request.refs[1].ref)

local take_request = {
  pack = { id = "fx", capability = "fx.delete_fx", risk = "destructive" },
  refs = {{ kind = "fx", ref = "fx:take:guid:{TAKE}:0", identity = { scheme = "take_fx", value = "take:guid:{TAKE}:0" } }},
}
summary, failure = alpha33_delete_fx(take_request)
assert(failure == nil and summary.owner_kind == "take" and summary.fx_guid == "{FX-TAKE-A}")
assert(#take_fx == 0 and calls.take_delete == 1)

track_fx = {
  { guid = "{DUPLICATE}", name = "A", ident = "a" },
  { guid = "{DUPLICATE}", name = "B", ident = "b" },
}
summary, failure = alpha33_delete_fx(track_request)
assert(summary == nil and failure.code == "REF_INVALID")
assert(failure.details.duplicate_count == 2 and calls.track_delete == 1)

track_request.refs[1] = { kind = "fx", ref = "fx:track:selected:0:0", identity = { scheme = "track_fx", value = "track:selected:0:0" } }
summary, failure = alpha33_delete_fx(track_request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.track_delete == 1)
`);
  });

  it("removes only category-0 internal sends and rejects duplicate routing fingerprints before mutation", () => {
    runLua(SEND_SOURCE, String.raw`
source = { guid = "{SOURCE}" }
destination_a = { guid = "{DEST-A}" }
destination_b = { guid = "{DEST-B}" }
tracks = { source, destination_a, destination_b }
sends = {
  { destination = destination_a, D_VOL = 1, D_PAN = 0, B_MUTE = 0, B_PHASE = 0, B_MONO = 0, I_SENDMODE = 0, I_SRCCHAN = 0, I_DSTCHAN = 0, I_MIDIFLAGS = 0 },
  { destination = destination_b, D_VOL = 0.5, D_PAN = 0.25, B_MUTE = 0, B_PHASE = 0, B_MONO = 0, I_SENDMODE = 3, I_SRCCHAN = 0, I_DSTCHAN = 2, I_MIDIFLAGS = 31 },
}
calls = { remove = 0, categories = {} }
reaper = {}
reaper.CountTracks = function(project) assert(project == 0); return #tracks end
reaper.GetTrack = function(project, index) assert(project == 0); return tracks[index + 1] end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetTrackNumSends = function(track, category)
  assert(track == source and category == 0)
  calls.categories[#calls.categories + 1] = category
  return #sends
end
reaper.GetTrackSendInfo_Value = function(track, category, index, key)
  assert(track == source and category == 0)
  calls.categories[#calls.categories + 1] = category
  local send = sends[index + 1]
  if not send then return nil end
  if key == "P_DESTTRACK" then return send.destination end
  return send[key] or 0
end
reaper.RemoveTrackSend = function(track, category, index)
  assert(track == source and category == 0)
  calls.categories[#calls.categories + 1] = category
  calls.remove = calls.remove + 1
  table.remove(sends, index + 1)
  return true
end
reaper.TrackList_AdjustWindows = function() end
reaper.UpdateArrange = function() end

local request = {
  pack = { id = "routing", capability = "routing.remove_send", risk = "destructive" },
  refs = {{ kind = "send", ref = "send:track:guid:{SOURCE}:0", identity = { scheme = "track_send", value = "track:guid:{SOURCE}:0" } }},
}
local summary, failure = alpha33_remove_send(request)
assert(failure == nil and summary.readback_status == "passed")
assert(summary.category == 0 and summary.destination_track_ref == "track:guid:{DEST-A}")
assert(summary.send_count_before == 2 and summary.send_count_after == 1)
assert(calls.remove == 1 and #sends == 1 and sends[1].destination == destination_b)
for index = 1, #calls.categories do assert(calls.categories[index] == 0) end

sends = {
  { destination = destination_a, D_VOL = 1, D_PAN = 0, B_MUTE = 0, B_PHASE = 0, B_MONO = 0, I_SENDMODE = 0, I_SRCCHAN = 0, I_DSTCHAN = 0, I_MIDIFLAGS = 0 },
  { destination = destination_a, D_VOL = 1, D_PAN = 0, B_MUTE = 0, B_PHASE = 0, B_MONO = 0, I_SENDMODE = 0, I_SRCCHAN = 0, I_DSTCHAN = 0, I_MIDIFLAGS = 0 },
}
summary, failure = alpha33_remove_send(request)
assert(summary == nil and failure.code == "REF_INVALID")
assert(failure.details.duplicate_count == 2 and calls.remove == 1 and #sends == 2)

request.refs[1] = { kind = "send", ref = "hardware_output:track:guid:{SOURCE}:0", identity = { scheme = "track_send", value = "track:guid:{SOURCE}:0" } }
summary, failure = alpha33_remove_send(request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.remove == 1)
`);
  });

  it("moves one exact Item to an existing Track and verifies identity, timeline, takes, and no Track creation", () => {
    runLua(ITEM_SOURCE, String.raw`
source_track = { guid = "{SOURCE}" }
target_track = { guid = "{TARGET}" }
tracks = { source_track, target_track }
item = { guid = "{ITEM}", track = source_track, position = 4.25, length = 2.5 }
take_a = { guid = "{TAKE-A}" }
take_b = { guid = "{TAKE-B}" }
takes = { take_a, take_b }
active_take = take_b
calls = { move = 0 }
mutate_position = false
reaper = {}
reaper.CountMediaItems = function(project) assert(project == 0); return 1 end
reaper.GetMediaItem = function(project, index) assert(project == 0); if index == 0 then return item end end
reaper.GetSetMediaItemInfo_String = function(actual, key, value, set_new)
  assert(actual == item and key == "GUID" and value == "" and set_new == false)
  return true, actual.guid
end
reaper.CountTracks = function(project) assert(project == 0); return #tracks end
reaper.GetTrack = function(project, index) assert(project == 0); return tracks[index + 1] end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetMediaItemInfo_Value = function(actual, key)
  assert(actual == item)
  if key == "D_POSITION" then return actual.position end
  if key == "D_LENGTH" then return actual.length end
end
reaper.GetMediaItemTrack = function(actual) assert(actual == item); return actual.track end
reaper.GetMediaItem_Track = function(actual) assert(actual == item); return actual.track end
reaper.CountTakes = function(actual) assert(actual == item); return #takes end
reaper.GetTake = function(actual, index) assert(actual == item); return takes[index + 1] end
reaper.GetSetMediaItemTakeInfo_String = function(take, key, value, set_new)
  assert(key == "GUID" and value == "" and set_new == false)
  return true, take.guid
end
reaper.GetActiveTake = function(actual) assert(actual == item); return active_take end
reaper.MoveMediaItemToTrack = function(actual, track)
  assert(actual == item and track == target_track)
  calls.move = calls.move + 1
  actual.track = track
  if mutate_position then actual.position = actual.position + 1 end
  return true
end
reaper.UpdateArrange = function() end

local request = {
  pack = { id = "items", capability = "items.move_item_to_track", risk = "write" },
  refs = {
    { kind = "item", ref = "item:guid:{ITEM}", identity = { scheme = "guid", value = "{ITEM}" } },
    { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } },
  },
}
local summary, failure, artifacts, jobs, refs = alpha33_move_item_to_track(request)
assert(failure == nil and summary.readback_status == "passed")
assert(summary.item_ref == "item:guid:{ITEM}" and summary.source_track_ref == "track:guid:{SOURCE}")
assert(summary.target_track_ref == "track:guid:{TARGET}" and item.track == target_track)
assert(summary.position_seconds == 4.25 and summary.length_seconds == 2.5)
assert(summary.take_count == 2 and summary.take_refs[1] == "take:guid:{TAKE-A}" and summary.take_refs[2] == "take:guid:{TAKE-B}")
assert(summary.active_take_ref == "take:guid:{TAKE-B}" and summary.track_count_unchanged == true)
assert(#tracks == 2 and #refs == 2 and calls.move == 1)

item.track = source_track
item.position = 4.25
mutate_position = true
summary, failure = alpha33_move_item_to_track(request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and calls.move == 2)

request.refs[2] = { kind = "track", ref = "track:selected:0", identity = { scheme = "selected", value = "0" } }
summary, failure = alpha33_move_item_to_track(request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.move == 2)

request.refs[2] = { kind = "track", ref = "track:guid:{TARGET}", identity = { scheme = "guid", value = "{TARGET}" } }
request.budget = { max_items = 1 }
item.track = source_track
item.position = 4.25
mutate_position = false
summary, failure = alpha33_move_item_to_track(request)
assert(summary == nil and failure.code == "RESPONSE_TOO_LARGE" and calls.move == 2)
`);
  });

  it("contains only reviewed native mutation APIs and no selection, action, Lua, shell, UI, or Track creation bypass", () => {
    assert.match(FX_SOURCE, /TrackFX_Delete/);
    assert.match(FX_SOURCE, /TakeFX_Delete/);
    assert.match(FX_SOURCE, /TrackFX_GetFXGUID/);
    assert.match(FX_SOURCE, /TakeFX_GetFXGUID/);
    assert.match(SEND_SOURCE, /RemoveTrackSend/);
    assert.match(SEND_SOURCE, /GetTrackSendInfo_Value/);
    assert.match(ITEM_SOURCE, /MoveMediaItemToTrack/);
    assert.match(ITEM_SOURCE, /GetMediaItemTrack/);

    const combined = [FX_SOURCE, SEND_SOURCE, ITEM_SOURCE].join("\n");
    assert.doesNotMatch(combined, /\b(?:GetSelectedTrack|GetSelectedMediaItem|SetTrackSelected|SetMediaItemSelected)\b/);
    assert.doesNotMatch(combined, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|NamedCommandLookup|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(combined, /\b(?:InsertTrackAtIndex|AddMediaItemToTrack|CreateNewMIDIItemInProj|SetItemStateChunk|GetItemStateChunk)\b/);
    assert.doesNotMatch(SEND_SOURCE, /RemoveTrackSend"\s*,\s*source_track\s*,\s*1\b/);

    for (const [capability, pack, risk, handler] of [
      ["fx.delete_fx", "fx", "destructive", "alpha33_delete_fx"],
      ["routing.remove_send", "routing", "destructive", "alpha33_remove_send"],
      ["items.move_item_to_track", "items", "write", "alpha33_move_item_to_track"],
    ]) {
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*\\{\\s*pack\\s*=\\s*"${pack}",\\s*risk\\s*=\\s*"${risk}"\\s*\\}`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handler}\\b`));
    }
  });

  it("keeps public catalog and live-handler counts equal to the actual 227-row catalog and registry", () => {
    const templates = createAcceptedOfficialTemplateCatalogTemplates();
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    const byPack = countBy(templates, "pack");
    const byRisk = countBy(templates, "risk");
    const byLifecycle = countBy(templates, "lifecycle");
    const byEntityKind = countBy(templates, "entity_kind");
    const liveByPack = countBy(registry.entries, "pack");
    const assertions = [
      `assert(summary.template_count == ${templates.length})`,
      `assert(summary.live_supported_template_count == ${registry.entries.length})`,
      ...luaCountAssertions("summary.by_pack", byPack),
      ...luaCountAssertions("summary.by_risk", byRisk),
      ...luaCountAssertions("summary.by_lifecycle", byLifecycle),
      ...luaCountAssertions("summary.by_entity_kind", byEntityKind),
      ...luaCountAssertions("summary.live_supported_by_pack", liveByPack),
    ].join("\n");
    runLua(CATALOG_SUMMARY_SOURCE, `
local summary, failure = read_template_catalog_summary({
  params = {
    include_lifecycle_counts = true,
    include_risk_counts = true,
    include_entity_kind_counts = true,
  },
})
assert(failure == nil)
${assertions}
`);
  });
});

function source(relativePath) {
  return readFileSync(new URL(`../../reaper/bridge/src/handlers/${relativePath}`, import.meta.url), "utf8");
}

function runLua(handlerSource, body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const script = `${PRELUDE}\n${handlerSource}\n${body}`;
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(script));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 0, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function countBy(rows, key) {
  const counts = {};
  for (const row of rows) counts[row[key]] = (counts[row[key]] ?? 0) + 1;
  return counts;
}

function luaCountAssertions(tableName, counts) {
  return Object.entries(counts).map(([key, count]) =>
    `assert(${tableName}[${JSON.stringify(key)}] == ${count})`
  );
}
