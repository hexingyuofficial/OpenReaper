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
const GLUE_SOURCE = source("items/glue_item.lua");
const FREEZE_SOURCE = source("tracks/freeze_track.lua");
const UNFREEZE_SOURCE = source("tracks/unfreeze_track.lua");
const PITCH_SOURCE = source("automation/ensure_take_pitch_envelope.lua");
const SPLIT_SILENCE_SOURCE = source("analysis/d27_item_audio_analysis.lua");
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
  it("registers exactly eight extracted native handlers and assembles their dispatch routes", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    const summary = validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    const rows = registry.entries.filter((entry) => entry.route === "alpha3-3-lifecycle-atom-handlers");
    assert.deepEqual(rows.map(({ template_id }) => template_id), CALL_TEMPLATE_RUNTIME_ALPHA3_3_LIFECYCLE_ATOM_TEMPLATE_IDS);
    assert.deepEqual(rows.map(({ handler_file, handler_export }) => [handler_file, handler_export]), [
      ["fx/delete_fx.lua", "alpha33_delete_fx"],
      ["routing/remove_send.lua", "alpha33_remove_send"],
      ["items/move_item_to_track.lua", "alpha33_move_item_to_track"],
      ["items/glue_item.lua", "alpha33_glue_item"],
      ["tracks/freeze_track.lua", "alpha33_freeze_track"],
      ["tracks/unfreeze_track.lua", "alpha33_unfreeze_track"],
      ["automation/ensure_take_pitch_envelope.lua", "alpha33_ensure_take_pitch_envelope"],
      ["analysis/d27_item_audio_analysis.lua", "alpha33_split_item_by_silence"],
    ]);
    assert.equal(summary.entryCount, 242);
    assert.equal(summary.extractedHandlerCount, 242);
    assert.equal(summary.handlerModuleCount, 91);
    assert.equal(summary.routeCount, 34);

    const built = buildLiveBridgeBundle({ cwd: ROOT.pathname });
    for (const [capability, handler] of [
      ["fx.delete_fx", "alpha33_delete_fx"],
      ["routing.remove_send", "alpha33_remove_send"],
      ["items.move_item_to_track", "alpha33_move_item_to_track"],
      ["items.glue_item", "alpha33_glue_item"],
      ["tracks.freeze_track", "alpha33_freeze_track"],
      ["tracks.unfreeze_track", "alpha33_unfreeze_track"],
      ["automation.ensure_take_pitch_envelope", "alpha33_ensure_take_pitch_envelope"],
      ["items.split_item_by_silence", "alpha33_split_item_by_silence"],
    ]) {
      assert.match(built, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
    }
  });

  it("splits one exact Item on complete native silence analysis and proves kept/deleted GUID truth", () => {
    runLua(SPLIT_SILENCE_SOURCE, String.raw`
track = { guid = "{TRACK}" }
take = {}
source = {}
accessor = {}
items = {{ guid = "{ITEM}", position = 2, length = 1, track = track }}
next_guid = 1

local function item_index(actual)
  for index = 1, #items do if items[index] == actual then return index end end
  return nil
end

read_item_summary = function(request)
  local actual = items[1]
  return {
    item_ref = "item:guid:" .. actual.guid,
    track_ref = "track:guid:" .. track.guid,
    position_seconds = actual.position,
    length_seconds = actual.length,
    active_take_ref = "take:guid:{TAKE}",
  }
end

reaper = {}
reaper.CountMediaItems = function(project) assert(project == 0); return #items end
reaper.GetMediaItem = function(project, index) assert(project == 0); return items[index + 1] end
reaper.GetSetMediaItemInfo_String = function(actual, key, value, set_new)
  assert(key == "GUID" and value == "" and set_new == false)
  return true, actual.guid
end
reaper.GetActiveTake = function(actual) assert(item_index(actual)); return take end
reaper.GetMediaItemTake_Source = function(actual) assert(actual == take); return source end
reaper.GetMediaItemInfo_Value = function(actual, key)
  if key == "D_POSITION" then return actual.position end
  if key == "D_LENGTH" then return actual.length end
  if key == "B_LOOPSRC" then return 0 end
end
reaper.GetMediaItemTakeInfo_Value = function(actual, key)
  assert(actual == take)
  if key == "D_STARTOFFS" then return 0 end
  if key == "D_PLAYRATE" then return 1 end
  if key == "B_REVERSE" then return 0 end
end
reaper.GetTakeNumStretchMarkers = function(actual) assert(actual == take); return 0 end
reaper.GetMediaSourceSampleRate = function(actual) assert(actual == source); return 1000 end
reaper.GetMediaSourceNumChannels = function(actual) assert(actual == source); return 1 end
reaper.GetMediaSourceType = function(actual) assert(actual == source); return "WAVE" end
reaper.GetMediaSourceLength = function(actual) assert(actual == source); return 1, false end
reaper.CreateTakeAudioAccessor = function(actual) assert(actual == take); return accessor end
reaper.GetAudioAccessorStartTime = function(actual) assert(actual == accessor); return 0 end
reaper.GetAudioAccessorEndTime = function(actual) assert(actual == accessor); return 1 end
reaper.new_array = function(size)
  local values = {}
  return { values = values, table = function() return values end }
end
reaper.GetAudioAccessorSamples = function(actual, rate, channels, start_time, frames, buffer)
  assert(actual == accessor and rate == 1000 and channels == 1)
  for frame = 0, frames - 1 do
    local time = start_time + (frame / rate)
    local silent = (time >= 0.2 and time < 0.5) or (time >= 0.7 and time < 0.9)
    buffer.values[frame + 1] = silent and 0 or 1
  end
  return 1
end
reaper.DestroyAudioAccessor = function(actual) assert(actual == accessor) end
reaper.GetMediaItemTrack = function(actual) assert(item_index(actual)); return actual.track end
reaper.GetMediaItem_Track = reaper.GetMediaItemTrack
reaper.GetTrackGUID = function(actual) assert(actual == track); return actual.guid end
reaper.CountTrackMediaItems = function(actual) assert(actual == track); return #items end
reaper.SplitMediaItem = function(actual, project_position)
  local index = item_index(actual)
  assert(index)
  local offset = project_position - actual.position
  assert(offset > 0 and offset < actual.length)
  next_guid = next_guid + 1
  local right = { guid = "{SPLIT-" .. tostring(next_guid) .. "}", position = project_position, length = actual.length - offset, track = track }
  actual.length = offset
  table.insert(items, index + 1, right)
  return right
end
reaper.DeleteTrackMediaItem = function(actual_track, actual_item)
  assert(actual_track == track)
  local index = item_index(actual_item)
  assert(index)
  table.remove(items, index)
  return true
end
reaper.UpdateArrange = function() end

local request = {
  pack = { id = "items", capability = "items.split_item_by_silence", risk = "destructive" },
  refs = {{ kind = "item", ref = "item:guid:{ITEM}", identity = { scheme = "guid", value = "{ITEM}" } }},
  params = { silence_threshold_dbfs = -60, min_silence_ms = 100 },
  budget = { max_items = 512 },
}
local summary, failure, artifacts, jobs, refs = alpha33_split_item_by_silence(request)
assert(failure == nil and summary.readback_status == "passed")
assert(summary.source_item_ref == "item:guid:{ITEM}" and summary.owner_track_ref == "track:guid:{TRACK}")
assert(summary.silence_segment_count == 2 and summary.split_count == 4 and summary.delete_count == 2)
assert(summary.item_count_before == 1 and summary.item_count_after == 3 and #items == 3)
assert(#summary.kept_item_refs == 3 and #summary.deleted_item_refs == 2)
assert(math.abs(summary.removed_duration_seconds - 0.5) < 0.002)
assert(math.abs(summary.remaining_duration_seconds - 0.5) < 0.002)
assert(summary.source_media_deleted == false and summary.changed == true)
for index = 1, #summary.deleted_item_refs do
  local guid = summary.deleted_item_refs[index]:match("^item:guid:(.+)$")
  for item_index_value = 1, #items do assert(items[item_index_value].guid ~= guid) end
end
assert(#refs == 6)
`);
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

  it("glues one exact Item, restores selection/active Takes, and fails closed without unique source-bound readback", () => {
    runLua(GLUE_SOURCE, String.raw`
target_track = { guid = "{TRACK-TARGET}" }
other_track = { guid = "{TRACK-OTHER}" }
tracks = { target_track, other_track }
calls = { action = 0, ids = {} }
action_mode = "success"

function reset_glue()
  target_track.selected = false
  other_track.selected = true
  target_take = { guid = "{TAKE-TARGET}", source = { filename = "", source_type = "MIDI" } }
  survivor_take_a = { guid = "{TAKE-SURVIVOR-A}", source = { filename = "/tmp/a.wav", source_type = "WAVE" } }
  survivor_take_b = { guid = "{TAKE-SURVIVOR-B}", source = { filename = "/tmp/b.wav", source_type = "WAVE" } }
  target_item = { guid = "{ITEM-TARGET}", track = target_track, position = 3.5, length = 2.25, selected = true, active = target_take }
  survivor_item = { guid = "{ITEM-SURVIVOR}", track = other_track, position = 9, length = 1, selected = true, active = survivor_take_a }
  target_take.item = target_item
  survivor_take_a.item = survivor_item
  survivor_take_b.item = survivor_item
  items = { target_item, survivor_item }
end
reset_glue()

reaper = {}
reaper.CountTracks = function() return #tracks end
reaper.GetTrack = function(_, index) return tracks[index + 1] end
reaper.GetMasterTrack = function() return nil end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.CountSelectedTracks2 = function() local count = 0; for _, track in ipairs(tracks) do if track.selected then count = count + 1 end end; return count end
reaper.GetSelectedTrack2 = function(_, selected_index) local count = 0; for _, track in ipairs(tracks) do if track.selected then if count == selected_index then return track end; count = count + 1 end end end
reaper.SetTrackSelected = function(track, selected) track.selected = selected; return true end
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) return items[index + 1] end
reaper.GetSetMediaItemInfo_String = function(item, key) assert(key == "GUID"); return true, item.guid end
reaper.GetMediaItemTrack = function(item) return item.track end
reaper.GetMediaItemInfo_Value = function(item, key) return key == "D_POSITION" and item.position or item.length end
reaper.CountSelectedMediaItems = function() local count = 0; for _, item in ipairs(items) do if item.selected then count = count + 1 end end; return count end
reaper.GetSelectedMediaItem = function(_, selected_index) local count = 0; for _, item in ipairs(items) do if item.selected then if count == selected_index then return item end; count = count + 1 end end end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected; return true end
reaper.GetActiveTake = function(item) return item.active end
reaper.SetActiveTake = function(take) take.item.active = take; return true end
reaper.GetSetMediaItemTakeInfo_String = function(take, key) assert(key == "GUID"); return true, take.guid end
reaper.GetMediaItemTake_Source = function(take) return take.source end
reaper.GetMediaSourceFileName = function(source) return source.filename end
reaper.GetMediaSourceType = function(source) return source.source_type end
reaper.Main_OnCommandEx = function(action_id)
  calls.action = calls.action + 1
  calls.ids[#calls.ids + 1] = action_id
  assert(action_id == 40362)
  assert(target_item.selected == true and survivor_item.selected == false)
  if action_mode == "dispatch_false" then return false end
  if action_mode == "no_readback" then return true end
  local glued_take = { guid = "{TAKE-GLUED}", source = { filename = "", source_type = "MIDI" } }
  local glued_item = { guid = "{ITEM-GLUED}", track = target_track, position = 3.5, length = 2.25, selected = true, active = glued_take }
  glued_take.item = glued_item
  survivor_item.active = survivor_take_b
  if action_mode == "ambiguous" then
    local extra_take = { guid = "{TAKE-EXTRA}", source = { filename = "/tmp/extra.wav", source_type = "WAVE" } }
    local extra_item = { guid = "{ITEM-EXTRA}", track = target_track, position = 3.5, length = 2.25, selected = false, active = extra_take }
    extra_take.item = extra_item
    items = { glued_item, extra_item, survivor_item }
  else
    items = { glued_item, survivor_item }
  end
  return true
end
reaper.UpdateArrange = function() end

local request = {
  pack = { id = "items", capability = "items.glue_item", risk = "destructive" },
  refs = {{ kind = "item", ref = "item:guid:{ITEM-TARGET}", identity = { scheme = "guid", value = "{ITEM-TARGET}" } }},
}
local summary, failure, artifacts, jobs, refs = alpha33_glue_item(request)
assert(failure == nil and summary.readback_status == "passed")
assert(summary.glued_item_ref == "item:guid:{ITEM-GLUED}" and summary.glued_take_ref == "take:guid:{TAKE-GLUED}")
assert(summary.owner_track_ref == "track:guid:{TRACK-TARGET}" and summary.position_seconds == 3.5 and summary.length_seconds == 2.25)
assert(summary.source_filename == "" and summary.source_type == "MIDI")
assert(summary.item_count_before == 2 and summary.item_count_after == 2 and summary.item_count_unchanged == true)
assert(items[1].selected == true and survivor_item.selected == true and other_track.selected == true)
assert(survivor_item.active == survivor_take_a and #refs == 3 and calls.ids[1] == 40362)

reset_glue()
action_mode = "dispatch_false"
summary, failure = alpha33_glue_item(request)
assert(summary == nil and failure.code == "COMMAND_FAILED" and failure.details.selection_restored == true)
assert(target_item.selected == true and survivor_item.selected == true and other_track.selected == true)

reset_glue()
action_mode = "no_readback"
summary, failure = alpha33_glue_item(request)
assert(summary == nil and failure.code == "VERIFY_FAILED")

reset_glue()
action_mode = "ambiguous"
summary, failure = alpha33_glue_item(request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.details.new_item_candidate_count == 2)

request.refs[1] = { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } }
local before_actions = calls.action
summary, failure = alpha33_glue_item(request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.action == before_actions)
`);
  });

  it("freezes all three fixed modes with GUID-safe selected-Item replacement mapping", () => {
    runLua(FREEZE_SOURCE, String.raw`
target_track = { guid = "{TRACK-TARGET}", freeze_count = 0 }
other_track = { guid = "{TRACK-OTHER}", freeze_count = 0 }
tracks = { target_track, other_track }
calls = { action = 0 }
action_mode = "success"
expected_action = 0
sequence = 0

function reset_freeze()
  sequence = sequence + 1
  target_track.freeze_count = 0
  target_track.selected = false
  other_track.selected = true
  target_item = { guid = "{ITEM-TARGET-" .. sequence .. "}", track = target_track, selected = true }
  other_item = { guid = "{ITEM-OTHER}", track = other_track, selected = true }
  items = { target_item, other_item }
end
reset_freeze()

reaper = {}
reaper.CountTracks = function() return #tracks end
reaper.GetTrack = function(_, index) return tracks[index + 1] end
reaper.GetMasterTrack = function() return nil end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetMediaTrackInfo_Value = function(track, key) assert(key == "I_FREEZECOUNT"); return track.freeze_count end
reaper.CountSelectedTracks2 = function() local count = 0; for _, track in ipairs(tracks) do if track.selected then count = count + 1 end end; return count end
reaper.GetSelectedTrack2 = function(_, selected_index) local count = 0; for _, track in ipairs(tracks) do if track.selected then if count == selected_index then return track end; count = count + 1 end end end
reaper.SetTrackSelected = function(track, selected) track.selected = selected; return true end
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) return items[index + 1] end
reaper.GetSetMediaItemInfo_String = function(item, key) assert(key == "GUID"); return true, item.guid end
reaper.GetMediaItemTrack = function(item) return item.track end
reaper.CountSelectedMediaItems = function() local count = 0; for _, item in ipairs(items) do if item.selected then count = count + 1 end end; return count end
reaper.GetSelectedMediaItem = function(_, selected_index) local count = 0; for _, item in ipairs(items) do if item.selected then if count == selected_index then return item end; count = count + 1 end end end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected; return true end
reaper.Main_OnCommandEx = function(action_id)
  calls.action = calls.action + 1
  assert(action_id == expected_action)
  assert(target_track.selected == true and other_track.selected == false)
  if action_mode == "dispatch_false" then return false end
  if action_mode == "no_readback" then return true end
  target_track.freeze_count = target_track.freeze_count + 1
  freeze_item = { guid = "{ITEM-FREEZE-" .. sequence .. "}", track = target_track, selected = true }
  items = { freeze_item, other_item }
  return true
end
reaper.UpdateArrange = function() end

local action_ids = { mono = 40901, stereo = 41223, multichannel = 40877 }
for _, mode in ipairs({ "mono", "stereo", "multichannel" }) do
  reset_freeze()
  expected_action = action_ids[mode]
  action_mode = "success"
  local request = {
    params = { mode = mode },
    pack = { id = "tracks", capability = "tracks.freeze_track", risk = "write" },
    refs = {{ kind = "track", ref = "track:guid:{TRACK-TARGET}", identity = { scheme = "guid", value = "{TRACK-TARGET}" } }},
  }
  local summary, failure = alpha33_freeze_track(request)
  assert(failure == nil and summary.mode == mode and summary.freeze_count_before == 0 and summary.freeze_count_after == 1)
  assert(summary.action_id == nil and summary.selection_restored == true)
  assert(freeze_item.selected == true and other_item.selected == true and other_track.selected == true)
end

reset_freeze()
expected_action = 41223
action_mode = "dispatch_false"
local request = { params = { mode = "stereo" }, pack = { id = "tracks", capability = "tracks.freeze_track", risk = "write" }, refs = {{ kind = "track", ref = "track:guid:{TRACK-TARGET}", identity = { scheme = "guid", value = "{TRACK-TARGET}" } }} }
local summary, failure = alpha33_freeze_track(request)
assert(summary == nil and failure.code == "COMMAND_FAILED" and failure.details.selection_restored == true)

reset_freeze()
action_mode = "no_readback"
summary, failure = alpha33_freeze_track(request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.details.freeze_count_after == 0)

request.refs[1] = { kind = "track", ref = "track:selected:0", identity = { scheme = "selected", value = "0" } }
local before_actions = calls.action
summary, failure = alpha33_freeze_track(request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.action == before_actions)
`);
  });

  it("unfreezes only a frozen exact Track and maps selected freeze Items to restored Items", () => {
    runLua(UNFREEZE_SOURCE, String.raw`
target_track = { guid = "{TRACK-TARGET}", freeze_count = 2 }
other_track = { guid = "{TRACK-OTHER}", freeze_count = 0 }
tracks = { target_track, other_track }
target_track.selected = false
other_track.selected = true
freeze_item = { guid = "{ITEM-FREEZE}", track = target_track, selected = true }
other_item = { guid = "{ITEM-OTHER}", track = other_track, selected = true }
items = { freeze_item, other_item }
calls = { action = 0 }
action_mode = "success"

reaper = {}
reaper.CountTracks = function() return #tracks end
reaper.GetTrack = function(_, index) return tracks[index + 1] end
reaper.GetMasterTrack = function() return nil end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetMediaTrackInfo_Value = function(track, key) assert(key == "I_FREEZECOUNT"); return track.freeze_count end
reaper.CountSelectedTracks2 = function() local count = 0; for _, track in ipairs(tracks) do if track.selected then count = count + 1 end end; return count end
reaper.GetSelectedTrack2 = function(_, selected_index) local count = 0; for _, track in ipairs(tracks) do if track.selected then if count == selected_index then return track end; count = count + 1 end end end
reaper.SetTrackSelected = function(track, selected) track.selected = selected; return true end
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) return items[index + 1] end
reaper.GetSetMediaItemInfo_String = function(item, key) assert(key == "GUID"); return true, item.guid end
reaper.GetMediaItemTrack = function(item) return item.track end
reaper.CountSelectedMediaItems = function() local count = 0; for _, item in ipairs(items) do if item.selected then count = count + 1 end end; return count end
reaper.GetSelectedMediaItem = function(_, selected_index) local count = 0; for _, item in ipairs(items) do if item.selected then if count == selected_index then return item end; count = count + 1 end end end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected; return true end
reaper.Main_OnCommandEx = function(action_id)
  calls.action = calls.action + 1
  assert(action_id == 41644)
  assert(target_track.selected == true and other_track.selected == false)
  if action_mode == "dispatch_false" then return false end
  if action_mode == "no_readback" then return true end
  target_track.freeze_count = 0
  restored_a = { guid = "{ITEM-RESTORED-A}", track = target_track, selected = true }
  restored_b = { guid = "{ITEM-RESTORED-B}", track = target_track, selected = false }
  items = { restored_a, restored_b, other_item }
  return true
end
reaper.UpdateArrange = function() end

local request = { pack = { id = "tracks", capability = "tracks.unfreeze_track", risk = "destructive" }, refs = {{ kind = "track", ref = "track:guid:{TRACK-TARGET}", identity = { scheme = "guid", value = "{TRACK-TARGET}" } }} }
local summary, failure = alpha33_unfreeze_track(request)
assert(failure == nil and summary.freeze_count_before == 2 and summary.freeze_count_after == 0)
assert(summary.action_id == nil and summary.selection_restored == true)
assert(restored_a.selected == true and restored_b.selected == true and other_item.selected == true and other_track.selected == true)

target_track.freeze_count = 0
local before_actions = calls.action
summary, failure = alpha33_unfreeze_track(request)
assert(summary == nil and failure.code == "COMMAND_FAILED" and failure.details.reason_code == "TRACK_NOT_FROZEN")
assert(calls.action == before_actions)

target_track.freeze_count = 2
freeze_item = { guid = "{ITEM-FREEZE-2}", track = target_track, selected = true }
other_item.selected = true
items = { freeze_item, other_item }
action_mode = "no_readback"
summary, failure = alpha33_unfreeze_track(request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.details.freeze_count_after == 2)
`);
  });

  it("ensures one exact Take Pitch envelope with idempotent no-toggle and GUID readback", () => {
    runLua(PITCH_SOURCE, String.raw`
target_track = { guid = "{TRACK-TARGET}", selected = false }
other_track = { guid = "{TRACK-OTHER}", selected = true }
tracks = { target_track, other_track }
target_take = { guid = "{TAKE-TARGET}" }
target_other_take = { guid = "{TAKE-OTHER}" }
survivor_take_a = { guid = "{TAKE-SURVIVOR-A}" }
survivor_take_b = { guid = "{TAKE-SURVIVOR-B}" }
target_item = { track = target_track, selected = false, takes = { target_take, target_other_take }, active = target_other_take }
survivor_item = { track = other_track, selected = true, takes = { survivor_take_a, survivor_take_b }, active = survivor_take_a }
target_take.item = target_item
target_other_take.item = target_item
survivor_take_a.item = survivor_item
survivor_take_b.item = survivor_item
items = { target_item, survivor_item }
envelope = { guid = "{ENV-PITCH}" }
pitch_exists = true
action_mode = "success"
calls = { action = 0, set_active = 0 }

reaper = {}
reaper.CountTracks = function() return #tracks end
reaper.GetTrack = function(_, index) return tracks[index + 1] end
reaper.GetMasterTrack = function() return nil end
reaper.CountSelectedTracks2 = function() local count = 0; for _, track in ipairs(tracks) do if track.selected then count = count + 1 end end; return count end
reaper.GetSelectedTrack2 = function(_, selected_index) local count = 0; for _, track in ipairs(tracks) do if track.selected then if count == selected_index then return track end; count = count + 1 end end end
reaper.SetTrackSelected = function(track, selected) track.selected = selected; return true end
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) return items[index + 1] end
reaper.CountTakes = function(item) return #item.takes end
reaper.GetTake = function(item, index) return item.takes[index + 1] end
reaper.GetSetMediaItemTakeInfo_String = function(take, key) assert(key == "GUID"); return true, take.guid end
reaper.GetMediaItemTake_Item = function(take) return take.item end
reaper.GetActiveTake = function(item) return item.active end
reaper.SetActiveTake = function(take) calls.set_active = calls.set_active + 1; take.item.active = take; return true end
reaper.CountSelectedMediaItems = function() local count = 0; for _, item in ipairs(items) do if item.selected then count = count + 1 end end; return count end
reaper.GetSelectedMediaItem = function(_, selected_index) local count = 0; for _, item in ipairs(items) do if item.selected then if count == selected_index then return item end; count = count + 1 end end end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected; return true end
reaper.GetTakeEnvelopeByName = function(take, name) assert(take == target_take and name == "Pitch"); if pitch_exists then return envelope end end
reaper.GetSetEnvelopeInfo_String = function(actual, key) assert(actual == envelope and key == "GUID"); return true, actual.guid end
reaper.Main_OnCommandEx = function(action_id)
  calls.action = calls.action + 1
  assert(action_id == 41612 and target_item.selected == true and target_item.active == target_take)
  if action_mode == "dispatch_false" then return false end
  survivor_item.active = survivor_take_b
  target_track.selected = true
  other_track.selected = false
  if action_mode == "success" then pitch_exists = true end
  return true
end
reaper.UpdateArrange = function() end

local request = { pack = { id = "automation", capability = "automation.ensure_take_pitch_envelope", risk = "write" }, refs = {{ kind = "take", ref = "take:guid:{TAKE-TARGET}", identity = { scheme = "guid", value = "{TAKE-TARGET}" } }} }
local summary, failure = alpha33_ensure_take_pitch_envelope(request)
assert(failure == nil and summary.existing_before == true and summary.changed == false)
assert(summary.envelope_ref == "envelope:guid:{ENV-PITCH}" and calls.action == 0 and calls.set_active == 0)

pitch_exists = false
action_mode = "success"
summary, failure = alpha33_ensure_take_pitch_envelope(request)
assert(failure == nil and summary.existing_before == false and summary.changed == true)
assert(calls.action == 1 and target_item.active == target_other_take and survivor_item.active == survivor_take_a)
assert(target_item.selected == false and survivor_item.selected == true and other_track.selected == true)

pitch_exists = false
action_mode = "dispatch_false"
summary, failure = alpha33_ensure_take_pitch_envelope(request)
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.selection_restored == true and failure.details.active_take_restored == true)

pitch_exists = false
action_mode = "no_envelope"
summary, failure = alpha33_ensure_take_pitch_envelope(request)
assert(summary == nil and failure.code == "VERIFY_FAILED")

request.refs[1] = { kind = "take", ref = "take:selected:0", identity = { scheme = "selected", value = "0" } }
local before_actions = calls.action
summary, failure = alpha33_ensure_take_pitch_envelope(request)
assert(summary == nil and failure.code == "REF_INVALID" and calls.action == before_actions)
`);
  });

  it("contains only reviewed native mutation APIs and fixed private action ids without generic execution bypass", () => {
    assert.match(FX_SOURCE, /TrackFX_Delete/);
    assert.match(FX_SOURCE, /TakeFX_Delete/);
    assert.match(FX_SOURCE, /TrackFX_GetFXGUID/);
    assert.match(FX_SOURCE, /TakeFX_GetFXGUID/);
    assert.match(SEND_SOURCE, /RemoveTrackSend/);
    assert.match(SEND_SOURCE, /GetTrackSendInfo_Value/);
    assert.match(ITEM_SOURCE, /MoveMediaItemToTrack/);
    assert.match(ITEM_SOURCE, /GetMediaItemTrack/);
    assert.match(GLUE_SOURCE, /ALPHA3_3_GLUE_ITEM_ACTION_ID\s*=\s*40362/);
    assert.match(FREEZE_SOURCE, /mono\s*=\s*40901/);
    assert.match(FREEZE_SOURCE, /stereo\s*=\s*41223/);
    assert.match(FREEZE_SOURCE, /multichannel\s*=\s*40877/);
    assert.match(UNFREEZE_SOURCE, /ALPHA3_3_UNFREEZE_TRACK_ACTION_ID\s*=\s*41644/);
    assert.match(PITCH_SOURCE, /ALPHA3_3_ENSURE_TAKE_PITCH_ENVELOPE_ACTION_ID\s*=\s*41612/);

    const directNative = [FX_SOURCE, SEND_SOURCE, ITEM_SOURCE].join("\n");
    assert.doesNotMatch(directNative, /\b(?:GetSelectedTrack|GetSelectedMediaItem|SetTrackSelected|SetMediaItemSelected)\b/);
    assert.doesNotMatch(directNative, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|NamedCommandLookup|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    const combined = [directNative, GLUE_SOURCE, FREEZE_SOURCE, UNFREEZE_SOURCE, PITCH_SOURCE].join("\n");
    assert.doesNotMatch(combined, /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|NamedCommandLookup|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(combined, /\b(?:InsertTrackAtIndex|AddMediaItemToTrack|CreateNewMIDIItemInProj|SetItemStateChunk|GetItemStateChunk)\b/);
    assert.doesNotMatch(SEND_SOURCE, /RemoveTrackSend"\s*,\s*source_track\s*,\s*1\b/);
    assert.doesNotMatch(JSON.stringify(createAcceptedOfficialTemplateCatalogTemplates().filter(({ id }) => id.includes("freeze_track"))), /action_id/);

    for (const [capability, pack, risk, handler] of [
      ["fx.delete_fx", "fx", "destructive", "alpha33_delete_fx"],
      ["routing.remove_send", "routing", "destructive", "alpha33_remove_send"],
      ["items.move_item_to_track", "items", "write", "alpha33_move_item_to_track"],
      ["items.glue_item", "items", "destructive", "alpha33_glue_item"],
      ["tracks.freeze_track", "tracks", "write", "alpha33_freeze_track"],
      ["tracks.unfreeze_track", "tracks", "destructive", "alpha33_unfreeze_track"],
      ["automation.ensure_take_pitch_envelope", "automation", "write", "alpha33_ensure_take_pitch_envelope"],
    ]) {
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*\\{\\s*pack\\s*=\\s*"${pack}",\\s*risk\\s*=\\s*"${risk}"\\s*\\}`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handler}\\b`));
    }
  });

  it("keeps public catalog and live-handler counts equal to the actual 242-row catalog and registry", () => {
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
