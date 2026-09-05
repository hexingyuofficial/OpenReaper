import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/items/d13_items_core_route.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
JSON_NULL = {}
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
function safe_budget(request)
  return request.budget or { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 2048 }
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
`;

describe("Alpha3.3-B1c Take reverse handler truth", () => {
  it("toggles only the exact active Take through fixed Action 41051 and restores context", () => {
    runLua(String.raw`
track_a = { guid = "{TRACK-A}", selected = false }
track_b = { guid = "{TRACK-B}", selected = true }
tracks = { track_a, track_b }
take_a = { guid = "{TAKE-A}", source = { section_available = false, reversed = false } }
take_a_other = { guid = "{TAKE-A-OTHER}", source = { section_available = false, reversed = false } }
take_b = { guid = "{TAKE-B}", source = { section_available = false, reversed = false } }
take_b_other = { guid = "{TAKE-B-OTHER}", source = { section_available = false, reversed = false } }
item_a = { guid = "{ITEM-A}", track = track_a, selected = false, takes = { take_a, take_a_other }, active = take_a }
item_b = { guid = "{ITEM-B}", track = track_b, selected = true, takes = { take_b, take_b_other }, active = take_b }
take_a.item = item_a
take_a_other.item = item_a
take_b.item = item_b
take_b_other.item = item_b
items = { item_a, item_b }
calls = { action = 0 }
action_mode = "toggle"
locking_enabled = false

reaper = {}
reaper.CountTracks = function() return #tracks end
reaper.GetTrack = function(_, index) return tracks[index + 1] end
reaper.GetMasterTrack = function() return nil end
reaper.GetTrackGUID = function(track) return track.guid end
reaper.GetMediaTrackInfo_Value = function(track, key) assert(key == "IP_TRACKNUMBER"); return track == track_a and 1 or 2 end
reaper.CountSelectedTracks2 = function() local count = 0; for _, track in ipairs(tracks) do if track.selected then count = count + 1 end end; return count end
reaper.GetSelectedTrack2 = function(_, selected_index) local count = 0; for _, track in ipairs(tracks) do if track.selected then if count == selected_index then return track end; count = count + 1 end end end
reaper.SetTrackSelected = function(track, selected) track.selected = selected; return true end
reaper.CountMediaItems = function() return #items end
reaper.GetMediaItem = function(_, index) return items[index + 1] end
reaper.GetSetMediaItemInfo_String = function(item, key) assert(key == "GUID"); return true, item.guid end
reaper.GetMediaItemTrack = function(item) return item.track end
reaper.GetMediaItemInfo_Value = function(item, key)
  if key == "B_UISEL" then return item.selected and 1 or 0 end
  if key == "D_VOL" then return 1 end
  if key == "D_LENGTH" then return 1 end
  return 0
end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected; return true end
reaper.CountTakes = function(item) return #item.takes end
reaper.GetTake = function(item, index) return item.takes[index + 1] end
reaper.GetActiveTake = function(item) return item.active end
reaper.SetActiveTake = function(take) take.item.active = take; return true end
reaper.GetSetMediaItemTakeInfo_String = function(take, key)
  if key == "GUID" then return true, take.guid end
  if key == "P_NAME" then return true, "Fixture" end
end
reaper.GetMediaItemTakeInfo_Value = function(take, key)
  if key == "D_VOL" then return 1 end
  if key == "I_PITCHMODE" then return -1 end
  return 0
end
reaper.GetMediaItemTake_Source = function(take) return take.source end
reaper.PCM_Source_GetSectionInfo = function(source) return source.section_available, 0, 1, source.reversed end
reaper.UpdateItemInProject = function() return true end
reaper.UpdateArrange = function() return true end
reaper.GetToggleCommandStateEx = function(section_id, action_id)
  assert(section_id == 0 and action_id == 1135)
  return locking_enabled and 1 or 0
end
reaper.Main_OnCommandEx = function(action_id, flag, project)
  calls.action = calls.action + 1
  assert(action_id == 41051 and flag == 0 and project == 0)
  assert(item_a.selected == true and item_b.selected == false and item_a.active == take_a)
  track_a.selected = true
  track_b.selected = false
  item_b.active = take_b_other
  if action_mode == "toggle" then
    take_a.source.section_available = true
    take_a.source.reversed = not take_a.source.reversed
  end
  return true
end

local request = {
  pack = { id = "items", capability = "items.set_reverse", risk = "write" },
  refs = {{ kind = "item", ref = "item:guid:{ITEM-A}", identity = { scheme = "guid", value = "{ITEM-A}" } }},
  params = { reverse = true },
}
local summary, failure = d13_items_set_reverse(request)
assert(failure == nil and summary.reverse == true and summary.changed == true)
assert(summary.fixed_action_id == 41051 and summary.readback_status == "passed")
assert(summary.selection_restored == true and summary.active_take_restored == true)
assert(calls.action == 1 and item_a.selected == false and item_b.selected == true)
assert(track_a.selected == false and track_b.selected == true and item_b.active == take_b)

summary, failure = d13_items_set_reverse(request)
assert(failure == nil and summary.changed == false and calls.action == 1)

request.params.reverse = false
summary, failure = d13_items_set_reverse(request)
assert(failure == nil and summary.reverse == false and summary.changed == true and calls.action == 2)

locking_enabled = true
request.params.reverse = true
local item_a_selected_before = item_a.selected
local item_b_selected_before = item_b.selected
local track_a_selected_before = track_a.selected
local track_b_selected_before = track_b.selected
local item_b_active_before = item_b.active
summary, failure = d13_items_set_reverse(request)
assert(summary == nil and failure.code == "PROJECT_LOCKING_ENABLED")
assert(failure.details.zero_write == true and failure.details.native_action_count == 0)
assert(failure.details.locking_action_id == 1135 and calls.action == 2)
assert(item_a.selected == item_a_selected_before and item_b.selected == item_b_selected_before)
assert(track_a.selected == track_a_selected_before and track_b.selected == track_b_selected_before)
assert(item_b.active == item_b_active_before and take_a.source.reversed == false)
locking_enabled = false

action_mode = "no_toggle"
request.params.reverse = true
summary, failure = d13_items_set_reverse(request)
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.selection_restored == true and failure.details.active_take_restored == true)
assert(item_a.selected == false and item_b.selected == true and track_b.selected == true and item_b.active == take_b)
`);
  });

  it("uses only native source-section readback and the audited fixed Action", () => {
    assert.match(HANDLER_SOURCE, /D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID\s*=\s*41051/u);
    assert.match(HANDLER_SOURCE, /D13_ITEMS_GLOBAL_LOCKING_ACTION_ID\s*=\s*1135/u);
    assert.match(HANDLER_SOURCE, /GetToggleCommandStateEx/u);
    assert.match(HANDLER_SOURCE, /PROJECT_LOCKING_ENABLED/u);
    assert.match(HANDLER_SOURCE, /PCM_Source_GetSectionInfo/u);
    assert.match(HANDLER_SOURCE, /Main_OnCommandEx", D13_ITEMS_TOGGLE_TAKE_REVERSE_ACTION_ID, 0, 0/u);
    assert.doesNotMatch(HANDLER_SOURCE, /B_REVERSE/u);
    assert.doesNotMatch(HANDLER_SOURCE, /request\.params\.(?:action|action_id)|NamedCommandLookup|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile/u);
  });
});

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const script = `${PRELUDE}\n${HANDLER_SOURCE}\n${body}`;
  const status = lauxlib.luaL_dostring(state, to_luastring(script));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(state, -1));
    lua.lua_close(state);
    assert.fail(message);
  }
  lua.lua_close(state);
}
