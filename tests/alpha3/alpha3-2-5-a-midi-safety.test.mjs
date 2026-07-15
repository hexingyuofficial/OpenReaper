import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const RESOLVE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/resolve_midi_take_ref.lua", import.meta.url),
  "utf8",
);
const CREATE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/create_midi_item.lua", import.meta.url),
  "utf8",
);
const INSERT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/insert_notes_batch.lua", import.meta.url),
  "utf8",
);
const LIST_NOTES_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_notes.lua", import.meta.url),
  "utf8",
);
const LIST_CC_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_cc_events.lua", import.meta.url),
  "utf8",
);
const LIST_TEXT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_text_sysex_events.lua", import.meta.url),
  "utf8",
);
const D17_EDIT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/d17_midi_edit_route.lua", import.meta.url),
  "utf8",
);
const ITEMS_CORE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/items/d13_items_core_route.lua", import.meta.url),
  "utf8",
);
const ITEMS_DELETE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/items/d14_items_delete_route.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
function is_non_negative_integer(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end
function json_array(value) return value or {} end
function bounded_string(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  return #text <= max_bytes and text or text:sub(1, max_bytes)
end
function bounded_number(value, fallback)
  if type(value) == "number" and value == value and value ~= math.huge and value ~= -math.huge then return value end
  return fallback
end
function first_number(value) return type(value) == "number" and value or 0 end
function first_string(value) return type(value) == "string" and value or "" end
function safe_budget(request) return request.budget or { max_items = 50, max_response_bytes = 65536, max_inline_value_bytes = 2048 } end
calls = { insert = 0, sort = 0 }
insert_args = nil
function call_reaper(name, ...)
  if name == "MIDI_InsertNote" then
    calls.insert = calls.insert + 1
    insert_args = { ... }
    return true, true
  elseif name == "MIDI_Sort" then
    calls.sort = calls.sort + 1
    return true, true
  end
  return false
end
function read_take_event_counts(request)
  return { take_ref = "take:guid:{TAKE}", note_count = calls.insert, cc_count = 0, text_sysex_count = 0 }, nil
end
`;

describe("Alpha3.2.5-A MIDI and ref safety", () => {
  it("rejects an item ref masquerading as kind take before REAPER resolution", () => {
    runLua(`${RESOLVE_SOURCE}\n`, `
local bad = { kind = "take", ref = "item:guid:{ITEM}", identity = { scheme = "guid", value = "{ITEM}" } }
assert(READ_B_MIDI.canonical_take_ref_token(bad) == nil)
local mismatch = { kind = "take", ref = "take:guid:{TAKE}", identity = { scheme = "guid", value = "{OTHER}" } }
assert(READ_B_MIDI.canonical_take_ref_token(mismatch) == nil)
local good = { kind = "take", ref = "take:guid:{TAKE}", identity = { scheme = "guid", value = "{TAKE}" } }
assert(READ_B_MIDI.canonical_take_ref_token(good) == "take:guid:{TAKE}")
`);
  });

  it("requires canonical track object refs at the direct MIDI create boundary", () => {
    runLua(`${RESOLVE_SOURCE}\n${CREATE_SOURCE}\n`, `
local bad = { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "track:guid:{TRACK}" } }
assert(resolve_track_from_ref_object(bad) == nil)
local wrong_kind = { kind = "track", ref = "item:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } }
assert(resolve_track_from_ref_object(wrong_kind) == nil)
`);
  });

  it("round-trips a canonical track ref and recovers the created MIDI take in the same call", () => {
    runLua(`${RESOLVE_SOURCE}\n${CREATE_SOURCE}\n`, `
local track = {}
local item = {}
local take = {}
local create_args = nil
local extent_args = nil
call_reaper = function(name, ...)
  local args = { ... }
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetMediaTrackInfo_Value" and args[2] == "IP_TRACKNUMBER" then return true, 1 end
  if name == "GetTrackName" then return true, true, "MIDI" end
  if name == "TimeMap2_timeToQN" then return true, args[2] * 2 end
  if name == "CreateNewMIDIItemInProj" then create_args = args; return true, item end
  if name == "MIDI_SetItemExtents" then extent_args = args; return true, true end
  if name == "UpdateItemInProject" then return true end
  if name == "GetActiveTake" then return true, nil end
  if name == "CountTakes" then return true, 1 end
  if name == "GetTake" then return true, take end
  if name == "TakeIsMIDI" then return true, true end
  if name == "GetMediaItemTake_Item" then return true, item end
  if name == "BR_GetMediaItemGUID" then return true, "{ITEM}" end
  if name == "BR_GetMediaItemTakeGUID" then return true, "{TAKE}" end
  if name == "MIDI_CountEvts" then return true, true, 0, 0, 0 end
  if name == "GetMediaItemInfo_Value" and args[2] == "D_POSITION" then return true, 1.25 end
  if name == "GetMediaItemInfo_Value" and args[2] == "D_LENGTH" then return true, 2.5 end
  if name == "MIDI_GetPPQPosFromProjTime" then return true, args[2] * 480 end
  return false
end
local track_ref = { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } }
local summary, failure, _, _, refs = safe_write_create_midi_item({
  refs = json_array({ track_ref }),
  params = { start_seconds = 1.25, end_seconds = 3.75 },
  pack = { id = "midi", capability = "midi.create_midi_item", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil)
assert(summary.item_ref == "item:guid:{ITEM}")
assert(summary.take_ref == "take:guid:{TAKE}")
assert(summary.start_seconds == 1.25)
assert(summary.end_seconds == 3.75)
assert(create_args[2] == 2.5)
assert(create_args[3] == 7.5)
assert(create_args[4] == true)
assert(extent_args[1] == item)
assert(extent_args[2] == 2.5)
assert(extent_args[3] == 7.5)
assert(refs[1].kind == "item" and refs[1].ref == "item:guid:{ITEM}")
assert(refs[2].kind == "take" and refs[2].ref == "take:guid:{TAKE}")
`);
  });

  it("fails before MIDI item creation when project-time conversion is unavailable", () => {
    runLua(`${RESOLVE_SOURCE}\n${CREATE_SOURCE}\n`, `
local track = {}
local create_calls = 0
call_reaper = function(name, ...)
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "TimeMap2_timeToQN" then return false end
  if name == "CreateNewMIDIItemInProj" then create_calls = create_calls + 1; return true, {} end
  return false
end
local summary, failure = safe_write_create_midi_item({
  refs = json_array({ { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } } }),
  params = { start_seconds = 0, end_seconds = 2 },
  pack = { id = "midi", capability = "midi.create_midi_item", risk = "write" },
  budget = safe_budget({}),
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(create_calls == 0)
`);
  });

  it("requires canonical item refs at core write and delete boundaries", () => {
    const assertions = `
local bad = { kind = "item", ref = "item:guid:{ITEM}", identity = { scheme = "guid", value = "item:guid:{ITEM}" } }
local wrong_kind = { kind = "item", ref = "take:guid:{ITEM}", identity = { scheme = "guid", value = "{ITEM}" } }
`;
    runLua(ITEMS_CORE_SOURCE, `${assertions}
assert(d13_items_resolve_item_from_ref_object(bad) == nil)
assert(d13_items_resolve_item_from_ref_object(wrong_kind) == nil)
`);
    runLua(ITEMS_DELETE_SOURCE, `${assertions}
assert(d14_items_resolve_item_from_ref_object(bad) == nil)
assert(d14_items_resolve_item_from_ref_object(wrong_kind) == nil)
`);
  });

  it("fails seconds mode and malformed PPQ notes before take resolution or mutation", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
READ_B_MIDI.resolve_midi_take_for_request = function() error("take resolution must not run") end
local seconds_summary, seconds_failure = safe_write_insert_notes_batch({
  refs = json_array({}), params = { position_unit = "seconds", notes = json_array({}) },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" }, budget = safe_budget({})
})
assert(seconds_summary == nil)
assert(seconds_failure.code == "PARAMS_INVALID")
assert(seconds_failure.details.blocker_code == "MIDI_SECONDS_MODE_MALFORMED")
assert(calls.insert == 0)

local malformed_summary, malformed_failure = safe_write_insert_notes_batch({
  refs = json_array({}), params = { position_unit = "ppq", notes = json_array({ { start_ppq = 0, end_ppq = 120, pitch = 200, velocity = 96, channel = 0 } }) },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" }, budget = safe_budget({})
})
assert(malformed_summary == nil)
assert(malformed_failure.code == "PARAMS_INVALID")
assert(calls.insert == 0)
`);
  });

  it("preserves the proven PPQ route and forwards exact note fields", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
local fake_take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return fake_take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
local request = {
  refs = json_array({}),
  params = {
    position_unit = "ppq",
    sort_events = true,
    notes = json_array({ { start_ppq = 120, end_ppq = 360, pitch = 64, velocity = 91, channel = 2, selected = true, muted = false } }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
}
local summary, failure = safe_write_insert_notes_batch(request)
assert(failure == nil)
assert(summary.inserted_note_count == 1)
assert(summary.inserted_count == 1)
assert(summary.readback_status == "passed")
assert(calls.insert == 1)
assert(calls.sort == 1)
assert(insert_args[2] == true)
assert(insert_args[3] == false)
assert(insert_args[4] == 120)
assert(insert_args[5] == 360)
assert(insert_args[6] == 2)
assert(insert_args[7] == 64)
assert(insert_args[8] == 91)
assert(insert_args[9] == true)
`);
  });

  it("maps REAPER note, CC, and text event return slots without shifting fields", () => {
    runLua(`${RESOLVE_SOURCE}\n${LIST_NOTES_SOURCE}\n${LIST_CC_SOURCE}\n${LIST_TEXT_SOURCE}\n`, `
local take = {}
json = { encode = function() return "{}" end }
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  if name == "MIDI_CountEvts" then return true, true, 1, 1, 1 end
  if name == "MIDI_GetNote" then return true, true, false, true, 120, 360, 2, 64, 91 end
  if name == "MIDI_GetCC" then return true, true, true, false, 240, 176, 3, 74, 99 end
  if name == "MIDI_GetTextSysexEvt" then return true, true, false, false, 480, 5, "hello" end
  if name == "MIDI_GetProjTimeFromPPQPos" then return true, select(2, ...) / 480 end
  return false
end
local notes = list_take_notes({ params = { limit = 16, include_project_time = true }, budget = safe_budget({}) })
assert(notes.returned_count == 1)
assert(notes.notes[1].selected == false)
assert(notes.notes[1].muted == true)
assert(notes.notes[1].start_ppq == 120 and notes.notes[1].end_ppq == 360)
assert(notes.notes[1].channel == 2 and notes.notes[1].pitch == 64 and notes.notes[1].velocity == 91)
local cc = list_take_cc_events({ params = { limit = 16 }, budget = safe_budget({}) })
assert(cc.returned_count == 1)
assert(cc.cc_events[1].selected == true and cc.cc_events[1].muted == false)
assert(cc.cc_events[1].ppq == 240 and cc.cc_events[1].channel_message == 176)
assert(cc.cc_events[1].channel == 3 and cc.cc_events[1].controller == 74 and cc.cc_events[1].value == 99)
local text_events = list_take_text_sysex_events({ params = { limit = 16, event_kind = "any" }, budget = safe_budget({}) })
assert(text_events.returned_count == 1)
assert(text_events.events[1].selected == false and text_events.events[1].muted == false)
assert(text_events.events[1].ppq == 480 and text_events.events[1].event_kind == "lyric")
assert(text_events.events[1].text == "hello")
`);
  });

  it("preserves existing D17 MIDI fields when updating only one note property", () => {
    runLua(D17_EDIT_SOURCE, `
local take = {}
local set_args = nil
READ_B_MIDI = {
  resolve_midi_take_for_request = function() return take, nil end,
  take_ref_string = function() return "take:guid:{TAKE}" end,
}
read_take_event_counts = function()
  return { take_ref = "take:guid:{TAKE}", take_hash = "hash", note_count = 1, cc_count = 0, text_sysex_count = 0 }
end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_CountEvts" then return true, true, 1, 0, 0 end
  if name == "MIDI_GetNote" then return true, true, false, true, 120, 360, 2, 64, 91 end
  if name == "MIDI_SetNote" then set_args = args; return true, true end
  return false
end
local summary, failure = d17_midi_set_notes_batch({
  refs = json_array({}),
  params = { sort_events = false, notes = json_array({ { index = 0, velocity = 100 } }) },
  pack = { id = "midi", capability = "midi.set_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil and summary.updated_count == 1)
assert(set_args[3] == false and set_args[4] == true)
assert(set_args[5] == 120 and set_args[6] == 360)
assert(set_args[7] == 2 and set_args[8] == 64 and set_args[9] == 100)
`);
  });
});

function runLua(handlerSource, body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = `${PRELUDE}\n${handlerSource}\n${body}\nreturn true`;
  const loadStatus = lauxlib.luaL_loadstring(L, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  const callStatus = lua.lua_pcall(L, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(L, -1))}`);
  }
  assert.equal(lua.lua_toboolean(L, -1), true);
  lua.lua_close(L);
}
