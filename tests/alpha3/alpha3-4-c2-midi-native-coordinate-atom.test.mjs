import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  WAVE2A_MIDI_TEMPLATE_IDS,
  createWave2AMidiTemplates,
} from "../../packages/core/src/template-packs/wave2a-midi-templates-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const CREATE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/create_midi_item.lua", import.meta.url),
  "utf8",
);
const INSERT_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/insert_notes_batch.lua", import.meta.url),
  "utf8",
);
const LIST_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/list_take_notes.lua", import.meta.url),
  "utf8",
);
const RESOLVE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/midi/resolve_midi_take_ref.lua", import.meta.url),
  "utf8",
);
const BRIDGE_SOURCE = readFileSync(
  new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url),
  "utf8",
);
const REGISTRY = JSON.parse(
  readFileSync(new URL("../../reaper/bridge/registry/BRIDGE_HANDLER_REGISTRY_V1.json", import.meta.url), "utf8"),
);

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
local JSON_ARRAY_MT = { __openreaper_json_array = true }
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function is_non_negative_integer(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end
function json_array(value) return setmetatable(value or {}, JSON_ARRAY_MT) end
function bounded_string(value, max_bytes)
  local text = type(value) == "string" and value or tostring(value or "")
  return #text <= max_bytes and text or text:sub(1, max_bytes)
end
function first_number(value) return type(value) == "number" and value or 0 end
function first_string(value) return type(value) == "string" and value or "" end
function safe_budget(request) return request.budget or { max_items = 50, max_response_bytes = 65536, max_inline_value_bytes = 2048 } end
json = {}
local function encode_string(value)
  return '"' .. value:gsub('[%c\\"]', function(char)
    local escapes = { ['"'] = '\\"', ['\\'] = '\\\\', ['\n'] = '\\n', ['\r'] = '\\r', ['\t'] = '\\t' }
    return escapes[char] or string.format("\\u%04x", string.byte(char))
  end) .. '"'
end
local encode_json
local function encode_array(value)
  local parts = {}
  for index = 1, #value do parts[#parts + 1] = encode_json(value[index]) end
  return "[" .. table.concat(parts, ",") .. "]"
end
local function encode_object(value)
  local keys = {}
  for key, nested in pairs(value) do
    if type(key) == "string" and nested ~= nil then keys[#keys + 1] = key end
  end
  table.sort(keys)
  local parts = {}
  for _, key in ipairs(keys) do parts[#parts + 1] = encode_string(key) .. ":" .. encode_json(value[key]) end
  return "{" .. table.concat(parts, ",") .. "}"
end
function encode_json(value)
  local kind = type(value)
  if value == JSON_NULL or kind == "nil" then return "null" end
  if kind == "string" then return encode_string(value) end
  if kind == "number" then return tostring(value) end
  if kind == "boolean" then return value and "true" or "false" end
  if kind == "table" then return is_json_array(value) and encode_array(value) or encode_object(value) end
  return "null"
end
function json.encode(value) return encode_json(value) end
calls = { insert = 0, convert = 0, qn = 0, time = 0, create = 0 }
insert_args = {}
convert_args = {}
function call_reaper(name, ...)
  return false
end
function read_take_event_counts(request)
  return { take_ref = "take:guid:{TAKE}", note_count = calls.insert, cc_count = 0, text_sysex_count = 0 }, nil
end
`;

describe("Alpha3.4-C2 MIDI native coordinate atom", () => {
  it("keeps product counts and does not invent handlers or templates", () => {
    const templates = createWave2AMidiTemplates();
    assert.equal(WAVE2A_MIDI_TEMPLATE_IDS.length, 14);
    assert.equal(templates.length, 14);
    assert.equal(REGISTRY.entries.length, 237);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 237);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.match(BRIDGE_SOURCE, /MIDI_GetPPQPosFromProjQN/);
    assert.match(BRIDGE_SOURCE, /MIDI_GetProjQNFromPPQPos/);
    assert.match(BRIDGE_SOURCE, /duration_quarter_notes/);
    assert.match(BRIDGE_SOURCE, /include_project_qn/);
    assert.doesNotMatch(CREATE_SOURCE, /\b480\b|\b960\b/);
    assert.doesNotMatch(INSERT_SOURCE, /\b480\b|\b960\b/);
    assert.doesNotMatch(LIST_SOURCE, /\b480\b|\b960\b/);
  });

  it("creates a MIDI item from start_seconds plus duration_quarter_notes via native TimeMap APIs", () => {
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
  if name == "TimeMap2_timeToQN" then calls.time = calls.time + 1; return true, args[2] * 2 end
  if name == "TimeMap2_QNToTime" then calls.qn = calls.qn + 1; return true, args[2] / 2 end
  if name == "CreateNewMIDIItemInProj" then calls.create = calls.create + 1; create_args = args; return true, item end
  if name == "MIDI_SetItemExtents" then extent_args = args; return true, true end
  if name == "UpdateItemInProject" then return true end
  if name == "GetActiveTake" then return true, take end
  if name == "TakeIsMIDI" then return true, true end
  if name == "GetMediaItemTake_Item" then return true, item end
  if name == "BR_GetMediaItemGUID" then return true, "{ITEM}" end
  if name == "BR_GetMediaItemTakeGUID" then return true, "{TAKE}" end
  if name == "MIDI_CountEvts" then return true, true, 0, 0, 0 end
  if name == "GetMediaItemInfo_Value" and args[2] == "D_POSITION" then return true, 1.25 end
  if name == "GetMediaItemInfo_Value" and args[2] == "D_LENGTH" then return true, 2.0 end
  if name == "MIDI_GetPPQPosFromProjTime" then return true, args[2] * 960 end
  return false
end
local summary, failure = safe_write_create_midi_item({
  refs = json_array({ { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } } }),
  params = { start_seconds = 1.25, duration_quarter_notes = 4 },
  pack = { id = "midi", capability = "midi.create_midi_item", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil)
assert(summary.start_seconds == 1.25)
assert(summary.end_seconds == 3.25)
assert(summary.start_qn == 2.5)
assert(summary.end_qn == 6.5)
assert(create_args[2] == 2.5)
assert(create_args[3] == 6.5)
assert(extent_args[2] == 2.5 and extent_args[3] == 6.5)
assert(calls.create == 1)
assert(calls.qn >= 1 and calls.time >= 1)
`);
  });

  it("fails create before mutation when both end_seconds and duration_quarter_notes are supplied", () => {
    runLua(`${RESOLVE_SOURCE}\n${CREATE_SOURCE}\n`, `
local track = {}
call_reaper = function(name, ...)
  if name == "CountTracks" then return true, 1 end
  if name == "GetTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "CreateNewMIDIItemInProj" then calls.create = calls.create + 1; return true, {} end
  return false
end
local summary, failure = safe_write_create_midi_item({
  refs = json_array({ { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } } }),
  params = { start_seconds = 0, end_seconds = 2, duration_quarter_notes = 4 },
  pack = { id = "midi", capability = "midi.create_midi_item", risk = "write" },
  budget = safe_budget({}),
})
assert(summary == nil)
assert(failure.code == "PARAMS_INVALID")
assert(calls.create == 0)
`);
  });

  it("inserts project_qn notes on a 960-PPQ take with non-zero item start through native conversion only", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
local take = {}
local item_start_qn = 4
local ppq_per_qn = 960
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_GetPPQPosFromProjQN" then
    calls.convert = calls.convert + 1
    convert_args[#convert_args + 1] = args[2]
    -- nonlinear-looking native map that still encodes 960 PPQ/QN with item start at QN 4
    return true, (args[2] - item_start_qn) * ppq_per_qn + (args[2] == args[2] and 0 or 0)
  end
  if name == "MIDI_InsertNote" then
    calls.insert = calls.insert + 1
    insert_args[#insert_args + 1] = { start_ppq = args[4], end_ppq = args[5], pitch = args[7] }
    return true, true
  end
  if name == "MIDI_Sort" then return true, true end
  return false
end
local notes = json_array({
  { start_qn = 4, end_qn = 5, pitch = 60, velocity = 96, channel = 0 },
  { start_qn = 5, end_qn = 6, pitch = 62, velocity = 96, channel = 0 },
  { start_qn = 6, end_qn = 7, pitch = 64, velocity = 96, channel = 0 },
  { start_qn = 7, end_qn = 8, pitch = 65, velocity = 96, channel = 0 },
})
local summary, failure = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = { position_unit = "project_qn", sort_events = true, notes = notes },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil)
assert(summary.inserted_count == 4)
assert(summary.position_unit == "project_qn")
assert(calls.convert == 8)
assert(calls.insert == 4)
assert(insert_args[1].start_ppq == 0 and insert_args[1].end_ppq == 960)
assert(insert_args[2].start_ppq == 960 and insert_args[2].end_ppq == 1920)
assert(insert_args[3].start_ppq == 1920 and insert_args[3].end_ppq == 2880)
assert(insert_args[4].start_ppq == 2880 and insert_args[4].end_ppq == 3840)
assert(convert_args[1] == 4 and convert_args[8] == 8)
`);
  });

  it("proves tempo/timesig-shaped nonlinear native conversion is used before any insert", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
local take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_GetPPQPosFromProjQN" then
    calls.convert = calls.convert + 1
    -- piecewise map: first quarter denser, later quarters sparser (tempo change stand-in)
    if args[2] <= 5 then return true, (args[2] - 4) * 1200 end
    return true, 1200 + (args[2] - 5) * 800
  end
  if name == "MIDI_InsertNote" then
    calls.insert = calls.insert + 1
    insert_args[#insert_args + 1] = { start_ppq = args[4], end_ppq = args[5] }
    return true, true
  end
  if name == "MIDI_Sort" then return true, true end
  return false
end
local summary, failure = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = {
    position_unit = "project_qn",
    notes = json_array({
      { start_qn = 4, end_qn = 5, pitch = 60, velocity = 90, channel = 0 },
      { start_qn = 5, end_qn = 6, pitch = 61, velocity = 90, channel = 0 },
    }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil)
assert(calls.convert == 4 and calls.insert == 2)
assert(insert_args[1].start_ppq == 0 and insert_args[1].end_ppq == 1200)
assert(insert_args[2].start_ppq == 1200 and insert_args[2].end_ppq == 2000)
`);
  });

  it("zero-writes when any project_qn conversion fails or mixed coordinate fields are supplied", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
local take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_GetPPQPosFromProjQN" then
    calls.convert = calls.convert + 1
    if args[2] == 6 then return false end
    return true, (args[2] - 4) * 960
  end
  if name == "MIDI_InsertNote" then calls.insert = calls.insert + 1; return true, true end
  return false
end
local fail_summary, fail_error = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = {
    position_unit = "project_qn",
    notes = json_array({
      { start_qn = 4, end_qn = 5, pitch = 60, velocity = 90, channel = 0 },
      { start_qn = 5, end_qn = 6, pitch = 61, velocity = 90, channel = 0 },
      { start_qn = 6, end_qn = 7, pitch = 62, velocity = 90, channel = 0 },
    }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(fail_summary == nil)
assert(fail_error.code == "COMMAND_FAILED")
assert(fail_error.details.zero_writes == true)
assert(calls.insert == 0)

local mixed_summary, mixed_error = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = {
    position_unit = "project_qn",
    notes = json_array({
      { start_qn = 4, end_qn = 5, start_ppq = 0, pitch = 60, velocity = 90, channel = 0 },
    }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(mixed_summary == nil)
assert(mixed_error.code == "PARAMS_INVALID")
assert(calls.insert == 0)

local wrong_summary, wrong_error = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = {
    position_unit = "ppq",
    notes = json_array({
      { start_qn = 4, end_qn = 5, pitch = 60, velocity = 90, channel = 0 },
    }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(wrong_summary == nil)
assert(wrong_error.code == "PARAMS_INVALID")
assert(calls.insert == 0)
`);
  });

  it("preserves legacy PPQ writes as exact values without conversion", () => {
    runLua(`${RESOLVE_SOURCE}\n${INSERT_SOURCE}\n`, `
local take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_GetPPQPosFromProjQN" then error("legacy PPQ must not convert") end
  if name == "MIDI_InsertNote" then
    calls.insert = calls.insert + 1
    insert_args = { start_ppq = args[4], end_ppq = args[5], pitch = args[7], velocity = args[8], channel = args[6] }
    return true, true
  end
  if name == "MIDI_Sort" then return true, true end
  return false
end
local summary, failure = safe_write_insert_notes_batch({
  refs = json_array({}),
  params = {
    position_unit = "ppq",
    notes = json_array({ { start_ppq = 120, end_ppq = 360, pitch = 64, velocity = 91, channel = 2 } }),
  },
  pack = { id = "midi", capability = "midi.insert_notes_batch", risk = "write" },
  budget = safe_budget({}),
})
assert(failure == nil)
assert(summary.inserted_count == 1)
assert(summary.position_unit == "ppq")
assert(calls.insert == 1)
assert(insert_args.start_ppq == 120 and insert_args.end_ppq == 360)
assert(insert_args.pitch == 64 and insert_args.velocity == 91 and insert_args.channel == 2)
`);
  });

  it("lists notes with native project_qn and project_time fields and pages 128+ rows without overlap", () => {
    runLua(`${RESOLVE_SOURCE}\n${LIST_SOURCE}\n`, `
local take = {}
local total = 140
local notes_store = {}
for index = 0, total - 1 do
  notes_store[index] = { false, false, index * 960, (index + 1) * 960, 0, 60 + (index % 12), 90 }
end
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_CountEvts" then return true, true, total, 0, 0 end
  if name == "MIDI_GetNote" then
    local row = notes_store[args[2]]
    if not row then return false end
    return true, true, row[1], row[2], row[3], row[4], row[5], row[6], row[7]
  end
  if name == "MIDI_GetProjTimeFromPPQPos" then
    return true, args[2] / 960
  end
  if name == "MIDI_GetProjQNFromPPQPos" then
    return true, 4 + (args[2] / 960)
  end
  return false
end
local seen = {}
local cursor = nil
local pages = 0
while true do
  local request = {
    params = {
      cursor = cursor,
      limit = 16,
      include_project_time = true,
      include_project_qn = true,
    },
    budget = { max_items = 16, max_response_bytes = 2048, max_inline_value_bytes = 256 },
  }
  local page, failure = list_take_notes(request)
  assert(failure == nil)
  assert(#json.encode(page) <= READ_B_MIDI.paginated_summary_byte_budget(request))
  assert(page.returned_count < 16)
  pages = pages + 1
  for index = 1, #page.notes do
    local note = page.notes[index]
    assert(seen[note.index] == nil)
    seen[note.index] = true
    assert(note.start_ppq == note.index * 960)
    assert(note.end_ppq == (note.index + 1) * 960)
    assert(note.start_seconds == note.index)
    assert(note.end_seconds == note.index + 1)
    assert(note.start_qn == 4 + note.index)
    assert(note.end_qn == 5 + note.index)
  end
  if page.truncated ~= true then break end
  cursor = page.next_cursor
end
local count = 0
for _ in pairs(seen) do count = count + 1 end
assert(count == total)
assert(pages >= 9)
`);
  });

  it("fails closed when note count or an indexed MIDI note row cannot be read", () => {
    runLua(`${RESOLVE_SOURCE}\n${LIST_SOURCE}\n`, `
local take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  if name == "MIDI_CountEvts" then return false end
  return false
end
local count_summary, count_failure = list_take_notes({ params = { limit = 16 }, budget = safe_budget({}) })
assert(count_summary == nil)
assert(count_failure.code == "COMMAND_FAILED")
assert(count_failure.details.stage == "count_notes")

call_reaper = function(name, ...)
  local args = { ... }
  if name == "MIDI_CountEvts" then return true, true, 3, 0, 0 end
  if name == "MIDI_GetNote" and args[2] == 0 then return true, true, false, false, 0, 960, 0, 60, 90 end
  if name == "MIDI_GetNote" and args[2] == 1 then return false end
  return false
end
local row_summary, row_failure = list_take_notes({ params = { limit = 16 }, budget = safe_budget({}) })
assert(row_summary == nil)
assert(row_failure.code == "COMMAND_FAILED")
assert(row_failure.details.stage == "read_note")
assert(row_failure.details.note_index == 1)
`);
  });

  it("fails list_take_notes truthfully when include_project_qn conversion fails", () => {
    runLua(`${RESOLVE_SOURCE}\n${LIST_SOURCE}\n`, `
local take = {}
READ_B_MIDI.resolve_midi_take_for_request = function() return take, nil end
READ_B_MIDI.take_ref_string = function() return "take:guid:{TAKE}" end
call_reaper = function(name, ...)
  if name == "MIDI_CountEvts" then return true, true, 1, 0, 0 end
  if name == "MIDI_GetNote" then return true, true, false, false, 0, 960, 0, 60, 90 end
  if name == "MIDI_GetProjQNFromPPQPos" then return false end
  return false
end
local summary, failure = list_take_notes({
  params = { limit = 16, include_project_qn = true },
  budget = safe_budget({}),
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.include_project_qn == true)
`);
  });

  it("descriptor schemas expose project_qn and duration_quarter_notes without dropping legacy routes", () => {
    const catalog = Object.fromEntries(createWave2AMidiTemplates().map((entry) => [entry.id, entry]));
    const create = catalog["template.midi.create_midi_item"];
    const insert = catalog["template.midi.insert_notes_batch"];
    const list = catalog["template.midi.list_take_notes"];
    assert.deepEqual(Object.keys(create.inputSchema.properties).sort(), [
      "duration_quarter_notes",
      "end_seconds",
      "start_seconds",
    ]);
    assert.deepEqual(create.inputSchema.required, ["start_seconds"]);
    assert.deepEqual(insert.inputSchema.properties.position_unit.enum, ["ppq", "project_qn"]);
    assert.deepEqual(insert.outputSchema.properties.position_unit.enum, ["ppq", "project_qn"]);
    assert.equal(list.inputSchema.properties.include_project_qn.type, "boolean");
    assert.equal(list.inputSchema.properties.include_project_time.type, "boolean");
    assert.equal(create.examples.some((entry) => entry.input.duration_quarter_notes === 4), true);
    assert.equal(insert.examples.some((entry) => entry.input.position_unit === "project_qn"), true);
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
