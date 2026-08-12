import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  WAVE1A_ITEMS_TEMPLATE_IDS,
  createWave1AItemsTemplates,
} from "../../packages/core/src/template-packs/wave1a-items-templates-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/items/read_item_summary.lua", import.meta.url),
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
function first_number(value)
  return type(value) == "number" and value or nil
end
function first_string(value)
  return type(value) == "string" and value or nil
end
writes = 0
take_property_gets = 0
item_property_gets = {}
function call_reaper(name, ...)
  return false
end
`;

describe("Alpha3.4-D1 read_item_summary native truth", () => {
  it("keeps public template/handler counts and does not invent handlers", () => {
    const templates = createWave1AItemsTemplates();
    assert.equal(WAVE1A_ITEMS_TEMPLATE_IDS.includes("template.items.read_item_summary"), true);
    assert.equal(templates.some((entry) => entry.id === "template.items.read_item_summary"), true);
    assert.equal(REGISTRY.entries.length, 241);
    assert.equal(new Set(REGISTRY.entries.map((entry) => entry.handler_file)).size, 91);
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.equal(registry.entries.length, 241);
    assert.equal(new Set(registry.entries.map((entry) => entry.handler_file)).size, 91);
    assert.match(BRIDGE_SOURCE, /function read_item_summary\(/);
    assert.match(BRIDGE_SOURCE, /volume_db/);
    assert.match(BRIDGE_SOURCE, /take_pitch_semitones/);
    assert.match(BRIDGE_SOURCE, /preserve_pitch/);
  });

  it("returns Item volume and Active-Take control facts with authoritative take GUID", () => {
    runLua(`
local item = {}
local take = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK-D1}" end
  if name == "GetSetMediaItemInfo_String" and args[2] == "GUID" then return true, true, "{ITEM-D1}" end
  if name == "GetMediaItemInfo_Value" then
    item_property_gets[args[2]] = (item_property_gets[args[2]] or 0) + 1
    local values = {
      D_POSITION = 0,
      D_LENGTH = 4,
      D_SNAPOFFSET = 0,
      D_FADEINLEN = 0,
      D_FADEOUTLEN = 0.25,
      D_VOL = 0.5,
    }
    if values[args[2]] == nil then return false end
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" and args[2] == "GUID" then return true, true, "{TAKE-D1}" end
  if name == "GetTakeName" then return true, "Lead" end
  if name == "GetMediaItemTakeInfo_Value" then
    take_property_gets = take_property_gets + 1
    local values = {
      D_VOL = 0.25,
      D_PAN = -0.5,
      D_PITCH = 2,
      D_PLAYRATE = 1.5,
      B_PPITCH = 1,
    }
    if values[args[2]] == nil then return false end
    return true, values[args[2]]
  end
  if name == "UpdateItemInProject" or name == "SetMediaItemInfo_Value" or name == "SetMediaItemTakeInfo_Value" then
    writes = writes + 1
    return true, true
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(failure == nil, failure and failure.message or "ok")
assert(summary.item_ref == "item:guid:{ITEM-D1}")
assert(summary.track_ref == "track:guid:{TRACK-D1}")
assert(summary.position_seconds == 0)
assert(summary.snap_offset_seconds == 0)
assert(summary.fade_in_seconds == 0)
assert(math.abs(summary.volume_db - (20 * math.log(0.5) / math.log(10))) < 1e-9)
assert(summary.take_count == 1)
assert(summary.active_take_ref == "take:guid:{TAKE-D1}")
assert(summary.active_take_name == "Lead")
assert(math.abs(summary.take_volume_db - (20 * math.log(0.25) / math.log(10))) < 1e-9)
assert(summary.take_pan == -0.5)
assert(summary.take_pitch_semitones == 2)
assert(summary.playrate == 1.5)
assert(summary.preserve_pitch == true)
assert(writes == 0)
assert(take_property_gets == 5)
`);
  });

  it("maps non-positive Item/Take volume to -150 and B_PPITCH 0 to false", () => {
    runLua(`
local item = {}
local take = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 1, D_LENGTH = 2, D_SNAPOFFSET = 0.1, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 0 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE}" end
  if name == "GetTakeName" then return true, "Muted" end
  if name == "GetMediaItemTakeInfo_Value" then
    local values = { D_VOL = -1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 0 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(failure == nil)
assert(summary.volume_db == -150)
assert(summary.take_volume_db == -150)
assert(summary.preserve_pitch == false)
assert(summary.take_pan == 0)
assert(summary.take_pitch_semitones == 0)
`);
  });

  it("returns active_take_ref null and omits Take controls when no Active Take exists", () => {
    runLua(`
local item = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 0 end
  if name == "GetActiveTake" then return true, nil end
  if name == "GetMediaItemTakeInfo_Value" then take_property_gets = take_property_gets + 1; return true, 0 end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(failure == nil)
assert(summary.take_count == 0)
assert(summary.active_take_ref == JSON_NULL)
assert(summary.active_take_name == "")
assert(summary.take_volume_db == nil)
assert(summary.take_pan == nil)
assert(summary.take_pitch_semitones == nil)
assert(summary.playrate == nil)
assert(summary.preserve_pitch == nil)
assert(take_property_gets == 0)
assert(writes == 0)
`);
  });

  it("skips all Take property getters when include_take_summary is false", () => {
    runLua(`
local item = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 2, D_LENGTH = 3, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" or name == "GetActiveTake" or name == "GetMediaItemTakeInfo_Value" or name == "GetTakeName" then
    take_property_gets = take_property_gets + 1
    return false
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = false },
})
assert(failure == nil)
assert(summary.volume_db == 0)
assert(summary.take_count == nil)
assert(summary.active_take_ref == nil)
assert(summary.take_volume_db == nil)
assert(summary.preserve_pitch == nil)
assert(take_property_gets == 0)
`);
  });

  it("fails closed for every Item property getter without fabricating requested-zero success", () => {
    for (const key of ["D_POSITION", "D_LENGTH", "D_SNAPOFFSET", "D_FADEINLEN", "D_FADEOUTLEN", "D_VOL"]) {
      runLua(`
local item = {}
local track = {}
local failed_key = "${key}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    if args[2] == failed_key then return false end
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = false },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
assert(failure.details.api == "GetMediaItemInfo_Value")
assert(failure.details.key == failed_key)
assert(writes == 0)
`);
    }
  });

  it("fails closed for CountTakes, GetActiveTake, and inconsistent non-empty Take state", () => {
    for (const scenario of ["count_failed", "active_failed", "active_missing"]) {
      runLua(`
local item = {}
local track = {}
local scenario = "${scenario}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then
    if scenario == "count_failed" then return false end
    return true, 1
  end
  if name == "GetActiveTake" then
    if scenario == "active_failed" then return false end
    return true, nil
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
if scenario == "count_failed" then
  assert(failure.details.api == "CountTakes")
else
  assert(failure.details.api == "GetActiveTake")
end
assert(writes == 0)
`);
    }
  });

  it("fails closed when Active Take GUID is unavailable and never uses take:index/take:unknown", () => {
    runLua(`
local item = {}
local take = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return false end
  if name == "BR_GetMediaItemTakeGUID" then return false end
  if name == "GetTakeName" then return true, "Ghost" end
  if name == "GetMediaItemTakeInfo_Value" then return true, 1 end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
assert(failure.details.api == "GetSetMediaItemTakeInfo_String")
assert(failure.details.key == "GUID")
assert(writes == 0)
`);
  });

  it("rejects native GUID calls whose API retval is false even when a string slot is populated", () => {
    for (const scenario of ["item_guid_false", "take_guid_false"]) {
      runLua(`
local item = {}
local take = {}
local track = {}
local scenario = "${scenario}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then
    if scenario == "item_guid_false" then return true, false, "{STALE-ITEM}" end
    return true, true, "{ITEM}"
  end
  if name == "BR_GetMediaItemGUID" then return false end
  if name == "CountMediaItems" then return false end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then
    if scenario == "take_guid_false" then return true, false, "{STALE-TAKE}" end
    return true, true, "{TAKE}"
  end
  if name == "BR_GetMediaItemTakeGUID" then return false end
  if name == "GetTakeName" then return true, "X" end
  if name == "GetMediaItemTakeInfo_Value" then
    local values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 0 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
if scenario == "item_guid_false" then
  assert(summary == nil)
  assert(failure.code == "COMMAND_FAILED")
  assert(failure.details.api == "GetSetMediaItemInfo_String")
  assert(failure.details.key == "GUID")
else
  assert(summary == nil)
  assert(failure.code == "COMMAND_FAILED")
  assert(failure.details.api == "GetSetMediaItemTakeInfo_String")
end
assert(writes == 0)
`);
    }
  });

  it("fails closed instead of fabricating Track identity or an empty Take name", () => {
    for (const scenario of ["track_identity_missing", "take_name_failed", "zero_count_with_active_take"]) {
      runLua(`
local item = {}
local take = {}
local track = {}
local scenario = "${scenario}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then
    if scenario == "track_identity_missing" then return true, "" end
    return true, "{TRACK}"
  end
  if name == "GetMediaTrackInfo_Value" or name == "CountTracks" then return false end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, scenario == "zero_count_with_active_take" and 0 or 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE}" end
  if name == "GetTakeName" then
    if scenario == "take_name_failed" then return false end
    return true, "X"
  end
  if name == "GetMediaItemTakeInfo_Value" then
    local values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 0 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
if scenario == "track_identity_missing" then
  assert(failure.details.api == "GetTrackGUID")
elseif scenario == "take_name_failed" then
  assert(failure.details.api == "GetTakeName")
else
  assert(failure.details.api == "GetActiveTake")
end
assert(writes == 0)
`);
    }
  });

  it("fails closed for invalid B_PPITCH and failed Take control getters", () => {
    runLua(`
local item = {}
local take = {}
local track = {}
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE}" end
  if name == "GetTakeName" then return true, "X" end
  if name == "GetMediaItemTakeInfo_Value" then
    if args[2] == "B_PPITCH" then return true, 2 end
    local values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.key == "B_PPITCH")
assert(failure.recoverable == false)
`);

    for (const key of ["D_VOL", "D_PAN", "D_PITCH", "D_PLAYRATE", "B_PPITCH"]) {
      runLua(`
local item = {}
local take = {}
local track = {}
local failed_key = "${key}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE}" end
  if name == "GetTakeName" then return true, "X" end
  if name == "GetMediaItemTakeInfo_Value" then
    if args[2] == failed_key then return false end
    local values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 0 }
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = true },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.details.api == "GetMediaItemTakeInfo_Value")
assert(failure.details.key == failed_key)
assert(failure.recoverable == false)
assert(writes == 0)
`);
    }
  });

  it("fails closed for non-finite Item and Take native values", () => {
    for (const scenario of ["item_nan", "take_infinite"]) {
      runLua(`
local item = {}
local take = {}
local track = {}
local scenario = "${scenario}"
call_reaper = function(name, ...)
  local args = { ... }
  if name == "GetSelectedMediaItem" then return true, item end
  if name == "GetMediaItemTrack" then return true, track end
  if name == "GetTrackGUID" then return true, "{TRACK}" end
  if name == "GetSetMediaItemInfo_String" then return true, true, "{ITEM}" end
  if name == "GetMediaItemInfo_Value" then
    local values = { D_POSITION = 0, D_LENGTH = 1, D_SNAPOFFSET = 0, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_VOL = 1 }
    if scenario == "item_nan" and args[2] == "D_VOL" then return true, 0 / 0 end
    return true, values[args[2]]
  end
  if name == "CountTakes" then return true, 1 end
  if name == "GetActiveTake" then return true, take end
  if name == "GetSetMediaItemTakeInfo_String" then return true, true, "{TAKE}" end
  if name == "GetTakeName" then return true, "X" end
  if name == "GetMediaItemTakeInfo_Value" then
    local values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 0 }
    if scenario == "take_infinite" and args[2] == "D_PAN" then return true, math.huge end
    return true, values[args[2]]
  end
  return false
end
local summary, failure = read_item_summary({
  refs = json_array({ { kind = "item", ref = "item:selected:0", identity = { scheme = "selected", value = "0" } } }),
  params = { include_take_summary = scenario ~= "item_nan" },
})
assert(summary == nil)
assert(failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
if scenario == "item_nan" then
  assert(failure.details.api == "GetMediaItemInfo_Value")
  assert(failure.details.key == "D_VOL")
else
  assert(failure.details.api == "GetMediaItemTakeInfo_Value")
  assert(failure.details.key == "D_PAN")
end
assert(writes == 0)
`);
    }
  });
});

function runLua(body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = `${PRELUDE}\n${HANDLER_SOURCE}\n${body}`;
  const status = lauxlib.luaL_dostring(L, to_luastring(source));
  if (status !== lua.LUA_OK) {
    const message = to_jsstring(lua.lua_tostring(L, -1));
    throw new Error(message);
  }
}
