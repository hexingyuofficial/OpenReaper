import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../../reaper/bridge/src/handlers/items/d13_items_core_route.lua", import.meta.url),
  "utf8",
);
const ROUTE_SOURCE = readFileSync(
  new URL("../../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url),
  "utf8",
);

const PRELUDE = String.raw`
JSON_NULL = {}
function is_string(value) return type(value) == "string" and value ~= "" end
function is_object(value) return type(value) == "table" end
function is_json_array(value) return type(value) == "table" end
function is_non_negative_integer(value)
  return type(value) == "number" and value >= 0 and value == math.floor(value)
end
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
  return request.budget or { max_items = 128, max_response_bytes = 65536, max_inline_value_bytes = 24576 }
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
`;

const FIXTURE = String.raw`
function reset_fixture(count)
  items = {}
  calls = {
    count_media_items = 0,
    get_media_item = 0,
    item_identity = 0,
    take_identity = 0,
    active_take = 0,
    item_set = 0,
    take_set = 0,
    item_get = 0,
    take_get = 0,
    update = 0,
    time = 0,
  }
  fail_item_set_at = nil
  corrupt_readback_item = nil
  for index = 1, count do
    local take = {
      guid = string.format("{D13-TAKE-%03d}", index),
      values = { D_VOL = 1, D_PAN = 0, D_PITCH = 0, D_PLAYRATE = 1, B_PPITCH = 1 },
    }
    local item = {
      guid = string.format("{D13-ITEM-%03d}", index),
      values = { D_VOL = 1, D_LENGTH = 8, D_FADEINLEN = 0, D_FADEOUTLEN = 0, D_SNAPOFFSET = 0 },
      active = take,
    }
    take.item = item
    items[index] = item
  end

  reaper = {}
  reaper.time_precise = function()
    calls.time = calls.time + 1
    return 100 + calls.time / 1000
  end
  reaper.CountMediaItems = function()
    calls.count_media_items = calls.count_media_items + 1
    return #items
  end
  reaper.GetMediaItem = function(_, index)
    calls.get_media_item = calls.get_media_item + 1
    return items[index + 1]
  end
  reaper.GetSetMediaItemInfo_String = function(item, key)
    assert(key == "GUID")
    calls.item_identity = calls.item_identity + 1
    return true, item.guid
  end
  reaper.GetActiveTake = function(item)
    calls.active_take = calls.active_take + 1
    return item.active
  end
  reaper.GetSetMediaItemTakeInfo_String = function(take, key)
    assert(key == "GUID")
    calls.take_identity = calls.take_identity + 1
    return true, take.guid
  end
  reaper.SetMediaItemInfo_Value = function(item, key, value)
    calls.item_set = calls.item_set + 1
    if fail_item_set_at and calls.item_set == fail_item_set_at then return false end
    item.values[key] = value
    return true
  end
  reaper.SetMediaItemTakeInfo_Value = function(take, key, value)
    calls.take_set = calls.take_set + 1
    take.values[key] = value
    return true
  end
  reaper.GetMediaItemInfo_Value = function(item, key)
    calls.item_get = calls.item_get + 1
    if corrupt_readback_item == item and key == "D_VOL" then return 999 end
    return item.values[key]
  end
  reaper.GetMediaItemTakeInfo_Value = function(take, key)
    calls.take_get = calls.take_get + 1
    return take.values[key]
  end
  reaper.UpdateItemInProject = function()
    calls.update = calls.update + 1
    return true
  end
end

function make_request(count)
  local batch = {}
  for index = 1, count do
    batch[index] = {
      id = string.format("r%03d", index),
      item_ref = string.format("item:guid:{D13-ITEM-%03d}", index),
      take_ref = string.format("take:guid:{D13-TAKE-%03d}", index),
      item = { volume_db = -6 },
      take = { pan = -0.25 },
    }
  end
  return {
    pack = { id = "items", capability = "items.set_item_take_controls_batch", risk = "write" },
    params = { batch = batch, dry_run = false },
    refs = {},
    budget = { max_items = 128, max_response_bytes = 65536, max_inline_value_bytes = 24576 },
  }
end
`;

describe("Alpha4 D13 native continuation job", () => {
  it("executes 1, 8, and 64 rows with one scan, bounded mutation ticks, and one aggregate readback", () => {
    runLua(String.raw`
${FIXTURE}

for _, count in ipairs({ 1, 8, 64 }) do
  reset_fixture(count)
  local request = make_request(count)
  local result, failure = d13_items_set_item_take_controls_batch(request)
  assert(failure == nil and result.contract == "openreaper.bridge.internal_continuation.v1")
  assert(result.phase == "set_item_take_controls_batch.mutate_chunk")
  assert(result.mutations_may_have_happened == false and result.next_phase_may_mutate == true)
  assert(calls.count_media_items == 1 and calls.get_media_item == count)
  assert(calls.item_set == 0 and calls.take_set == 0 and calls.update == 0)
  assert(calls.item_get == 0 and calls.take_get == 0)

  local handler_calls = 1
  local mutation_ticks = 0
  while type(result) == "table" and result.contract == "openreaper.bridge.internal_continuation.v1" do
    local phase = result.phase
    local updates_before = calls.update
    result, failure = d13_items_set_item_take_controls_batch(request, result)
    handler_calls = handler_calls + 1
    assert(failure == nil)
    if phase == "set_item_take_controls_batch.mutate_chunk" then
      mutation_ticks = mutation_ticks + 1
      assert(calls.update - updates_before >= 1)
      assert(calls.update - updates_before <= 8)
      assert(calls.item_get == 0 and calls.take_get == 0)
    end
  end

  local expected_chunks = math.ceil(count / 8)
  assert(handler_calls == expected_chunks + 2)
  assert(mutation_ticks == expected_chunks)
  assert(result.row_count == count and result.mutation_attempted == true)
  assert(result.batch_timings.job_count == 1)
  assert(result.batch_timings.project_scan_count == 1)
  assert(result.batch_timings.project_scan_item_count == count)
  assert(result.batch_timings.chunk_size == 8)
  assert(result.batch_timings.chunks == expected_chunks)
  assert(result.batch_timings.completed_chunks == expected_chunks)
  assert(result.batch_timings.continuation_yield_count == expected_chunks + 1)
  assert(result.batch_timings.aggregate_readback_count == 1)
  assert(result.batch_timings.native_mutation_count == count)
  assert(result.batch_timings.native_property_mutation_count == count * 2)
  assert(result.batch_timings.native_readback_count == count)
  assert(result.batch_timings.transport_ms == JSON_NULL)
  assert(calls.item_set == count and calls.take_set == count and calls.update == count)
  assert(calls.item_get == count * 5 and calls.take_get == count * 5)
  for index = 1, count do
    assert(result.rows[index].status == "applied")
    assert(result.rows[index].readback_status == "aggregate_passed")
    assert(items[index].active.values.B_PPITCH == 1)
  end
end
`);
  });

  it("rejects 65 rows before scan, mutation, readback, or continuation creation", () => {
    runLua(String.raw`
${FIXTURE}
reset_fixture(65)
local result, failure = d13_items_set_item_take_controls_batch(make_request(65))
assert(result == nil and failure.code == "BATCH_LIMIT_EXCEEDED")
assert(failure.details.zero_write == true and failure.details.row_count == 65)
assert(calls.count_media_items == 0 and calls.get_media_item == 0)
assert(calls.item_set == 0 and calls.take_set == 0 and calls.update == 0)
assert(calls.item_get == 0 and calls.take_get == 0)
`);
  });

  it("retains partial mutation counts and rejects aggregate readback mismatch", () => {
    runLua(String.raw`
${FIXTURE}
reset_fixture(16)
local request = make_request(16)
local continuation, failure = d13_items_set_item_take_controls_batch(request)
assert(failure == nil)
continuation, failure = d13_items_set_item_take_controls_batch(request, continuation)
assert(failure == nil and continuation.mutations_may_have_happened == true)
fail_item_set_at = 9
local result
result, failure = d13_items_set_item_take_controls_batch(request, continuation)
assert(result == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.zero_write == false)
assert(failure.details.completed_rows == 8)
assert(failure.details.batch_timings.native_mutation_count == 8)

reset_fixture(8)
request = make_request(8)
continuation, failure = d13_items_set_item_take_controls_batch(request)
assert(failure == nil)
continuation, failure = d13_items_set_item_take_controls_batch(request, continuation)
assert(failure == nil and continuation.phase == "set_item_take_controls_batch.aggregate_readback")
corrupt_readback_item = items[1]
result, failure = d13_items_set_item_take_controls_batch(request, continuation)
assert(result == nil and failure.code == "VERIFY_FAILED")
assert(failure.details.zero_write == false)
assert(failure.details.batch_timings.aggregate_readback_count == 1)
assert(failure.details.batch_timings.native_readback_count == 8)
`);
  });

  it("keeps dispatcher continuation routing and post-mutation unknown-outcome truth generic", () => {
    assert.match(
      ROUTE_SOURCE,
      /handler = D13_ITEMS_CORE_WRITE_HANDLERS\[request\.pack\.capability\][\s\S]*?return handler\(request, resume_continuation\)/,
    );
    assert.match(
      ROUTE_SOURCE,
      /if d13_item_take_batch_capability and not resume_continuation then\s+phase_may_mutate = false\s+end/,
    );
    assert.match(
      ROUTE_SOURCE,
      /local mutated =\s*\(resume_continuation and resume_continuation\.mutations_may_have_happened == true\)[\s\S]*?details = unknown_outcome_details\(true, details\)/,
    );
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
