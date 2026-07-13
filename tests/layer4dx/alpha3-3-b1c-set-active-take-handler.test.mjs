import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/items/set_active_take.lua", import.meta.url),
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
function bounded_string(value, max_length)
  if value == nil then return "" end
  local text = tostring(value)
  if #text <= (max_length or 160) then return text end
  return string.sub(text, 1, (max_length or 160) - 3) .. "..."
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function object_ref(kind, scheme, value)
  return {
    kind = kind,
    ref = kind .. ":" .. scheme .. ":" .. value,
    identity = { scheme = scheme, value = value },
  }
end
function request(item_ref, take_ref)
  return {
    refs = { item_ref, take_ref },
    params = {},
    pack = { id = "items", capability = "items.set_active_take", risk = "write" },
  }
end
function install_fake(config)
  config = config or {}
  calls = { selected = 0, set_active_take = 0, update = 0, get_active_take = 0 }
  item_a = { id = "item_a" }
  item_b = { id = "item_b" }
  take_a0 = { id = "take_a0" }
  take_a1 = { id = "take_a1" }
  take_b0 = { id = "take_b0" }
  local items = { item_a, item_b }
  local takes = {
    [item_a] = { take_a0, take_a1 },
    [item_b] = { take_b0 },
  }
  local item_guids = { [item_a] = "{ITEM-A}", [item_b] = "{ITEM-B}" }
  local take_guids = { [take_a0] = "{TAKE-A0}", [take_a1] = "{TAKE-A1}", [take_b0] = "{TAKE-B0}" }
  local owners = { [take_a0] = item_a, [take_a1] = item_a, [take_b0] = item_b }
  active = { [item_a] = take_a0, [item_b] = take_b0 }
  reaper = {}
  reaper.CountMediaItems = function(project) assert(project == 0); return #items end
  reaper.GetMediaItem = function(project, index) assert(project == 0); return items[index + 1] end
  reaper.CountTakes = function(item) return #(takes[item] or {}) end
  reaper.GetTake = function(item, index) return (takes[item] or {})[index + 1] end
  reaper.BR_GetMediaItemGUID = function(item) return item_guids[item] end
  reaper.GetSetMediaItemInfo_String = function(item, key, value, set_new)
    assert(key == "GUID" and value == "" and set_new == false)
    return true, item_guids[item]
  end
  reaper.BR_GetMediaItemTakeGUID = function(take) return take_guids[take] end
  reaper.GetSetMediaItemTakeInfo_String = function(take, key, value, set_new)
    assert(key == "GUID" and value == "" and set_new == false)
    return true, take_guids[take]
  end
  reaper.GetMediaItemTake_Item = function(take)
    if config.owner_mismatch then return item_b end
    return owners[take]
  end
  reaper.GetActiveTake = function(item)
    calls.get_active_take = calls.get_active_take + 1
    return active[item]
  end
  reaper.SetActiveTake = function(take)
    calls.set_active_take = calls.set_active_take + 1
    if config.command_error then error("set failed") end
    if not config.readback_mismatch then active[owners[take]] = take end
  end
  reaper.UpdateItemInProject = function(item)
    assert(item == item_a or item == item_b)
    calls.update = calls.update + 1
  end
  reaper.GetSelectedMediaItem = function()
    calls.selected = calls.selected + 1
    error("selection must not be consulted")
  end
end
`;

function runLua(body) {
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);
  const source = `${PRELUDE}\n${HANDLER_SOURCE}\n${body}\nreturn true`;
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

describe("Alpha3.3-B1c exact set-active-take handler", () => {
  it("sets one exact GUID take and proves native GetActiveTake readback without selection", () => {
    runLua(`
install_fake()
local summary, failure, artifacts, jobs, refs = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(failure == nil)
assert(summary.item_ref == "item:guid:{ITEM-A}")
assert(summary.active_take_ref == "take:guid:{TAKE-A1}")
assert(summary.take_index == 1)
assert(summary.take_count == 2)
assert(summary.changed == true)
assert(summary.readback_status == "passed")
assert(#artifacts == 0 and #jobs == 0 and #refs == 2)
assert(refs[1].kind == "item" and refs[1].ref == summary.item_ref)
assert(refs[2].kind == "take" and refs[2].ref == summary.active_take_ref)
assert(active[item_a] == take_a1)
assert(active[item_b] == take_b0)
assert(calls.set_active_take == 1)
assert(calls.get_active_take == 2)
assert(calls.update == 1)
assert(calls.selected == 0)
`);
  });

  it("supports canonical global index refs and remains idempotent on exact repeat", () => {
    runLua(`
install_fake()
active[item_a] = take_a1
local summary, failure = set_active_take(request(
  object_ref("item", "index", "0"),
  object_ref("take", "index", "1")
))
assert(failure == nil)
assert(summary.active_take_ref == "take:guid:{TAKE-A1}")
assert(summary.changed == false)
assert(calls.set_active_take == 1)
assert(calls.selected == 0)
`);
  });

  it("rejects selected, malformed, missing, and cross-item refs before mutation", () => {
    runLua(`
install_fake()
local summary, failure = set_active_take(request(
  object_ref("item", "selected", "0"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(summary == nil and failure.code == "REF_INVALID")
assert(calls.selected == 0 and calls.set_active_take == 0)

summary, failure = set_active_take(request(
  object_ref("item", "guid", "{MISSING}"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(summary == nil and failure.code == "ITEM_NOT_FOUND")
assert(calls.set_active_take == 0)

summary, failure = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{MISSING}")
))
assert(summary == nil and failure.code == "TAKE_NOT_FOUND")
assert(calls.set_active_take == 0)

summary, failure = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{TAKE-B0}")
))
assert(summary == nil and failure.code == "REF_INVALID")
assert(failure.details.reason_code == "TAKE_ITEM_MISMATCH")
assert(calls.set_active_take == 0)
`);
  });

  it("fails typed and closed on ownership, command, or active-take readback mismatch", () => {
    runLua(`
install_fake({ owner_mismatch = true })
local summary, failure = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(summary == nil and failure.code == "REF_INVALID")
assert(failure.details.reason_code == "TAKE_OWNER_READBACK_MISMATCH")
assert(calls.set_active_take == 0)

install_fake({ command_error = true })
summary, failure = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.recoverable == false)
assert(calls.set_active_take == 1)

install_fake({ readback_mismatch = true })
summary, failure = set_active_take(request(
  object_ref("item", "guid", "{ITEM-A}"),
  object_ref("take", "guid", "{TAKE-A1}")
))
assert(summary == nil and failure.code == "VERIFY_FAILED")
assert(failure.recoverable == false)
assert(calls.set_active_take == 1)
assert(active[item_a] == take_a0)
`);
  });

  it("uses only typed native REAPER calls and contains no raw execution surface", () => {
    for (const symbol of [
      "SetActiveTake",
      "GetActiveTake",
      "GetMediaItemTake_Item",
      "CountTakes",
      "GetTake",
      "GetMediaItem",
      "UpdateItemInProject",
      "REF_INVALID",
      "VERIFY_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(symbol));
    }
    assert.doesNotMatch(HANDLER_SOURCE, /GetSelectedMediaItem|GetSelectedTrack/);
    assert.doesNotMatch(
      HANDLER_SOURCE,
      /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/,
    );
  });
});
