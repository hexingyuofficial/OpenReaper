import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { describe, it } from "node:test";

const require = createRequire(import.meta.url);
const { lua, lauxlib, lualib, to_jsstring, to_luastring } = require("fengari");

const HANDLER = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/create_region.lua", import.meta.url),
  "utf8",
);
const TRANSPORT_HANDLER = readFileSync(
  new URL("../../reaper/bridge/src/handlers/transport/read_state.lua", import.meta.url),
  "utf8",
);

describe("create_region Live Target Binding truth", () => {
  it("keeps available empty ranges distinct from unavailable native reads", () => {
    let source = TRANSPORT_HANDLER.replace("local function read_transport_state", "function read_transport_state");
    const script = String.raw`
function first_number(...)
  for index = 1, select("#", ...) do
    local value = select(index, ...)
    if type(value) == "number" then return value end
  end
  return nil
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
local fail_range_read = false
reaper = {
  GetPlayState = function() return 0 end,
  GetCursorPosition = function() return 1 end,
  GetPlayPosition = function() return 1 end,
  GetSetRepeat = function() return 0 end,
  GetSet_LoopTimeRange = function(set, is_loop)
    if fail_range_read and is_loop == false then error("unavailable") end
    return 3, 3
  end,
}
local state = read_transport_state()
assert(state.time_selection.read_status == "available")
assert(state.time_selection.active == false)
assert(state.time_selection.start_seconds == 3 and state.time_selection.end_seconds == 3)
assert(state.time_selection.length_seconds == 0)
fail_range_read = true
state = read_transport_state()
assert(state.time_selection.read_status == "unavailable")
assert(state.time_selection.active == false)
assert(state.time_selection.start_seconds == 0 and state.time_selection.end_seconds == 0)
assert(state.time_selection.length_seconds == 0)
return true
`;
    executeLua(`${source}\n${script}`);
  });

  it("resolves Time Selection at execution and fails closed for empty, unreadable, or conflicting bounds", () => {
    let source = HANDLER.replace("local function safe_write_create_region", "function safe_write_create_region");
    const script = String.raw`
JSON_NULL = {}
function is_object(value) return type(value) == "table" end
function is_string(value) return type(value) == "string" and value ~= "" end
function bounded_string(value, max_length)
  local text = tostring(value or "")
  if max_length and #text > max_length then return text:sub(1, max_length) end
  return text
end
function json_array(value) return value or {} end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end

local writes = 0
local range_mode = "active"
reaper = {
  EnumProjects = function(index, path) return 0, "" end,
  GetSet_LoopTimeRange = function(set, is_loop, start_value, end_value, allow_seek)
    assert(set == false and is_loop == false and start_value == 0 and end_value == 0 and allow_seek == false)
    if range_mode == "failure" then error("unavailable") end
    if range_mode == "empty" then return 3, 3 end
    return 2.6, 4.94
  end,
  AddProjectMarker2 = function(project, is_region, start_seconds, end_seconds, name, wanted_index, color)
    writes = writes + 1
    assert(project == 0 and is_region == true and wanted_index == -1 and color == 0)
    assert(start_seconds == 2.6 and end_seconds == 4.94 and name == "Selection Region")
    return 17
  end,
}

local binding = {
  bind_at = "execution",
  domain = "time_range",
  selector = "time_selection",
  aggregation = "single",
  cardinality = { minimum = 1, maximum = 1 },
}
local request = {
  pack = { capability = "project.create_region", id = "project", risk = "write" },
  params = { name = "Selection Region", target_binding = binding },
}
local summary, failure = safe_write_create_region(request)
assert(failure == nil and writes == 1)
assert(summary.region_ref == "region:index:17")
assert(summary.start_seconds == 2.6 and summary.end_seconds == 4.94)
assert(summary.length_seconds > 2.339 and summary.length_seconds < 2.341)
assert(summary.target_mode == "time_selection")
assert(summary.target_fingerprint == "time-range-v1|2.600000000|4.940000000")

range_mode = "empty"
summary, failure = safe_write_create_region(request)
assert(summary == nil and failure.code == "TARGET_BINDING_TIME_RANGE_UNAVAILABLE")
assert(failure.details.zero_write == true and writes == 1)

range_mode = "failure"
summary, failure = safe_write_create_region(request)
assert(summary == nil and failure.code == "TARGET_BINDING_RESOLUTION_FAILED")
assert(failure.recoverable == false and failure.details.zero_write == true and writes == 1)

request.params.start_seconds = 1
request.params.end_seconds = 2
summary, failure = safe_write_create_region(request)
assert(summary == nil and failure.code == "TARGET_BINDING_INVALID")
assert(failure.details.zero_write == true and writes == 1)

request.params.target_binding = nil
request.params.end_seconds = nil
summary, failure = safe_write_create_region(request)
assert(summary == nil and failure.code == "PARAMS_INVALID")
assert(failure.details.zero_write == true and writes == 1)

return true
`;
    executeLua(`${source}\n${script}`);
  });
});

function executeLua(source) {
    const state = lauxlib.luaL_newstate();
    lualib.luaL_openlibs(state);
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
