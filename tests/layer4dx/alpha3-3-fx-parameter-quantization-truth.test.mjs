import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/fx/e2_fx_l1_read_route.lua", import.meta.url),
  "utf8",
);

function runLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `
JSON_NULL = {}
function json_array(value) return value or {} end
function is_string(value) return type(value) == "string" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
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
function bounded_string(value) return tostring(value or "") end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
${HANDLER_SOURCE}
${body}
return true
`;
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

describe("Alpha3.3 generic FX parameter quantization truth", () => {
  it("uses native step metadata for track and take parameters", () => {
    runLua(`
local track = {}
local take = {}
reaper = {
  TrackFX_GetParameterStepSizes = function(owner, slot, param)
    assert(owner == track and slot == 2 and param == 7)
    return true, 1, 0.1, 10, true
  end,
  TakeFX_GetParameterStepSizes = function(owner, slot, param)
    assert(owner == take and slot == 1 and param == 3)
    return true, 0.125, 0.125, 0.5, false
  end,
}
local toggle = e2_fx_read_param_step_sizes("track", track, 2, 7)
assert(toggle.step_sizes_available == true)
assert(toggle.step_size == 1 and toggle.small_step_size == 0.1 and toggle.large_step_size == 10)
assert(toggle.is_toggle == true and toggle.is_discrete == true)
local enum = e2_fx_read_param_step_sizes("take", take, 1, 3)
assert(enum.step_sizes_available == true and enum.step_size == 0.125)
assert(enum.is_toggle == false and enum.is_discrete == true)
local unavailable = e2_fx_read_param_step_sizes("track", track, 9, 9)
assert(unavailable.step_sizes_available == false)
assert(unavailable.step_size == JSON_NULL and unavailable.is_toggle == JSON_NULL)
`);
  });

  it("accepts continuous tolerance and exact native discrete formatting only", () => {
    runLua(`
local continuous = { is_discrete = false }
local updated, mode = e2_fx_parameter_readback_matches(0.5, "0.50", 0.5005, "0.50", 0.001, continuous)
assert(updated == true and mode == "numeric_tolerance")
updated, mode = e2_fx_parameter_readback_matches(0.5, "0.50", 0.75, "0.50", 0.001, continuous)
assert(updated == false and mode == "failed", "formatted equality must not relax continuous verification")

local toggle = { is_discrete = true }
updated, mode = e2_fx_parameter_readback_matches(0.5, "Enabled", 1, "Enabled", 0.000001, toggle)
assert(updated == true and mode == "native_discrete_format")
updated, mode = e2_fx_parameter_readback_matches(0.5, "Enabled", 0, "Disabled", 0.000001, toggle)
assert(updated == false and mode == "failed")

local enum = { is_discrete = true }
updated, mode = e2_fx_parameter_readback_matches(0.4, "1/4", 0.375, "1/4", 0.000001, enum)
assert(updated == true and mode == "native_discrete_format")
`);
  });
});
