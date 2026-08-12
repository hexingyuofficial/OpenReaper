import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const D27_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/analysis/d27_item_audio_analysis.lua", import.meta.url),
  "utf8",
);

function extract(source, startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing D27 source marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(end, -1, `Missing D27 source marker: ${endMarker}`);
  return source.slice(start, end);
}

const RANGE_COMPILER_SOURCE = extract(
  D27_SOURCE,
  "local function d27_batch_scope_matches",
  "local function d27_batch_checksum_plan",
);

const SILENCE_APPLY_SOURCE = extract(
  D27_SOURCE,
  "local function d27_batch_fragments",
  "local function d27_batch_apply_normalization",
);

const PRELUDE = String.raw`
function d27_batch_number(params, field, default_value, minimum, maximum)
  local value = params[field]
  if value == nil then value = default_value end
  if type(value) ~= "number"
      or value ~= value
      or (minimum ~= nil and value < minimum)
      or (maximum ~= nil and value > maximum) then
    return nil, { code = "PARAMS_INVALID", details = { field = field } }
  end
  return value, nil
end
`;

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `${PRELUDE}\n${RANGE_COMPILER_SOURCE}\n${body}\nreturn true`;
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

function runSilenceApplyLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `${String.raw`
JSON_NULL = {}
function json_array(value) return value or {} end
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function d27_analysis_number(value)
  if type(value) ~= "number" or value ~= value or value == math.huge or value == -math.huge then return nil end
  return value
end
function d27_analysis_error(code, message, details) return { code = code, message = message, details = details } end
function d27_split_object_ref(kind, ref) return { kind = kind, ref = ref } end
function call_reaper(name, ...)
  if type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function d27_split_item_ref(item) return "item:guid:" .. item.guid, item.guid end
function d27_split_number(item, field)
  local ok, value = call_reaper("GetMediaItemInfo_Value", item, field)
  return ok and d27_analysis_number(first_number(value)) or nil
end
function d27_analysis_find_item_by_guid(guid)
  for _, item in ipairs(items) do
    if item.guid == guid and not item.deleted then return item end
  end
  return nil
end
`}
${SILENCE_APPLY_SOURCE}
${body}
return true`;
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(source));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

describe("S3 remove-silence range compiler", () => {
  it("trims edge silence to the Item boundary and keeps padding only beside retained audio", () => {
    runLua(String.raw`
local scan = {
  silence_segments = {
    { start_seconds = 0, end_seconds = 1 },
    { start_seconds = 3, end_seconds = 4 },
    { start_seconds = 9, end_seconds = 10 },
  },
}
local context = { item_length = 10, sample_rate = 48000 }
local cases = {
  {
    scope = "all",
    expected = { { 0, 0.98 }, { 3.02, 3.98 }, { 9.02, 10 } },
  },
  {
    scope = "leading",
    expected = { { 0, 0.98 } },
  },
  {
    scope = "trailing",
    expected = { { 9.02, 10 } },
  },
  {
    scope = "edges",
    expected = { { 0, 0.98 }, { 9.02, 10 } },
  },
  {
    scope = "internal",
    expected = { { 3.02, 3.98 } },
  },
}

local function close(actual, expected)
  assert(math.abs(actual - expected) <= 0.000001,
    tostring(actual) .. " != " .. tostring(expected))
end

for _, case in ipairs(cases) do
  local ranges, failure, all_silent = d27_batch_ranges(scan, context, {
    silence_scope = case.scope,
    keep_before_ms = 20,
    keep_after_ms = 20,
    min_kept_audio_ms = 80,
  })
  assert(failure == nil, case.scope .. " unexpectedly failed")
  assert(all_silent == false, case.scope .. " was incorrectly typed all-silent")
  assert(#ranges == #case.expected,
    case.scope .. " expected " .. tostring(#case.expected)
      .. " ranges but got " .. tostring(#ranges))
  for index, expected in ipairs(case.expected) do
    close(ranges[index].start_seconds, expected[1])
    close(ranges[index].end_seconds, expected[2])
  end
end
`);
  });

  it("still suppresses an internal removal that would isolate sub-minimum audible audio", () => {
    runLua(String.raw`
local ranges, failure, all_silent = d27_batch_ranges({
  silence_segments = {
    { start_seconds = 2, end_seconds = 3 },
    { start_seconds = 3.04, end_seconds = 4 },
  },
}, { item_length = 6, sample_rate = 48000 }, {
  silence_scope = "internal",
  keep_before_ms = 0,
  keep_after_ms = 0,
  min_kept_audio_ms = 80,
})
assert(failure == nil)
assert(all_silent == false)
assert(#ranges == 1,
  "the 40ms interior audio island must not remain between two removed ranges")
`);
  });

  it("keeps internal scope edge-exclusive and retains all-silent Items as typed truth", () => {
    runLua(String.raw`
local edge_ranges, edge_failure, edge_all_silent = d27_batch_ranges({
  silence_segments = {
    { start_seconds = 0, end_seconds = 1 },
    { start_seconds = 4, end_seconds = 5 },
  },
}, { item_length = 5, sample_rate = 48000 }, {
  silence_scope = "internal",
  keep_before_ms = 0,
  keep_after_ms = 0,
  min_kept_audio_ms = 0,
})
assert(edge_failure == nil and edge_all_silent == false)
assert(#edge_ranges == 0, "internal scope must not include Item-edge silence")

local silent_ranges, silent_failure, all_silent = d27_batch_ranges({
  silence_segments = { { start_seconds = 0, end_seconds = 5 } },
}, { item_length = 5, sample_rate = 48000 }, {
  silence_scope = "all",
  keep_before_ms = 0,
  keep_after_ms = 0,
  min_kept_audio_ms = 0,
})
assert(silent_failure == nil)
assert(all_silent == true)
assert(#silent_ranges == 0, "all-silent Items must remain zero-write")
`);
  });

  it("preserves original outer fades and applies verified fades only at newly exposed edges", () => {
    runSilenceApplyLua(String.raw`
local track = {}
local original = {
  guid = "{ORIGINAL}", position = 10, length = 10,
  D_FADEINLEN = 0.12, D_FADEOUTLEN = 0.34,
  D_FADEINLEN_AUTO = 0.07, D_FADEOUTLEN_AUTO = 0.09,
}
items = { original }
local next_guid = 0
local setters = 0
reaper = {}
reaper.SplitMediaItem = function(item, project_position)
  next_guid = next_guid + 1
  local offset = project_position - item.position
  assert(offset > 0 and offset < item.length)
  local right = {
    guid = "{SPLIT-" .. tostring(next_guid) .. "}",
    position = project_position,
    length = item.length - offset,
    D_FADEINLEN = item.D_FADEINLEN,
    D_FADEOUTLEN = item.D_FADEOUTLEN,
    D_FADEINLEN_AUTO = item.D_FADEINLEN_AUTO,
    D_FADEOUTLEN_AUTO = item.D_FADEOUTLEN_AUTO,
  }
  item.length = offset
  items[#items + 1] = right
  return right
end
reaper.GetMediaItemTrack = function() return track end
reaper.DeleteTrackMediaItem = function(actual_track, item)
  assert(actual_track == track)
  item.deleted = true
  return true
end
reaper.SetMediaItemInfo_Value = function(item, field, value)
  setters = setters + 1
  item[field] = value
  return true
end
reaper.GetMediaItemInfo_Value = function(item, field)
  if field == "D_POSITION" then return item.position end
  if field == "D_LENGTH" then return item.length end
  return item[field]
end
reaper.UpdateArrange = function() return true end

local result, failure = d27_batch_apply_silence({
  item_ref = "item:guid:{ORIGINAL}",
  owner_track = track,
  owner_track_ref = "track:guid:{TRACK}",
  ranges = { { start_seconds = 3.02, end_seconds = 3.98 } },
  all_silent = false,
  scan = { silence_segments = { { start_seconds = 3, end_seconds = 4 } } },
  context = {
    item = original,
    item_ref = "item:guid:{ORIGINAL}",
    item_position = 10,
    item_length = 10,
    sample_rate = 48000,
    fade_in_length = 0.12,
    fade_out_length = 0.34,
    auto_fade_in_length = 0.07,
    auto_fade_out_length = 0.09,
  },
}, { fade_ms = 5 }, { native_mutation_count = 0, native_readback_count = 0 })

assert(failure == nil, failure and failure.message or "unexpected failure")
assert(result.changed == true and result.delete_count == 1 and result.split_count == 2)
local left = d27_analysis_find_item_by_guid("{ORIGINAL}")
local right = nil
for _, item in ipairs(items) do
  if not item.deleted and item.guid ~= "{ORIGINAL}" then right = item end
end
assert(left ~= nil and right ~= nil)
assert(math.abs(left.D_FADEINLEN - 0.12) < 0.000001)
assert(math.abs(left.D_FADEINLEN_AUTO - 0.07) < 0.000001)
assert(math.abs(left.D_FADEOUTLEN - 0.005) < 0.000001)
assert(left.D_FADEOUTLEN_AUTO == -1)
assert(math.abs(right.D_FADEINLEN - 0.005) < 0.000001)
assert(right.D_FADEINLEN_AUTO == -1)
assert(math.abs(right.D_FADEOUTLEN - 0.34) < 0.000001)
assert(math.abs(right.D_FADEOUTLEN_AUTO - 0.09) < 0.000001)
assert(setters == 8, "every kept fragment must receive four verified fade values")
`);
  });
});
