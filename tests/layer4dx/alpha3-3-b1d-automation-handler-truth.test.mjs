import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";

const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/routing/e5_r1_routing_read_route.lua", import.meta.url),
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

READ_B_MEDIA = {}
function READ_B_MEDIA.take_ref_string(take) return "take:guid:" .. take.guid end
function READ_B_MEDIA.resolve_take_token(ref)
  if ref == "take:guid:{TAKE}" then return take end
  return nil
end

function envelope_ref(ref)
  return { kind = "envelope", ref = ref, identity = { scheme = "synthetic", value = ref } }
end
function make_request(capability, params, ref)
  local refs = {}
  if ref then refs[1] = envelope_ref(ref) end
  return {
    refs = refs,
    params = params or {},
    pack = { id = "automation", capability = capability, risk = "write" },
    budget = { max_items = 64, max_response_bytes = 65536, max_inline_value_bytes = 2048 },
  }
end
function close(actual, expected)
  assert(math.abs(actual - expected) <= 0.000000001, tostring(actual) .. " != " .. tostring(expected))
end

function install_fake(config)
  config = config or {}
  track = { guid = "{TRACK}" }
  item = {}
  take = { guid = "{TAKE}" }
  track_env = { id = "track" }
  track_env_b = { id = "track_b" }
  take_env = { id = "take" }
  send_env = { id = "send" }
  fx_env = { id = "fx" }
  track_envelopes = config.two_track_envelopes and { track_env, track_env_b } or { track_env }
  envelope_guids = {
    [track_env] = "{ENV-TRACK}",
    [track_env_b] = "{ENV-TRACK-B}",
    [take_env] = "{ENV-TAKE}",
    [send_env] = "{ENV-SEND}",
    [fx_env] = "{ENV-FX}",
  }
  if config.no_envelope_guids then
    envelope_guids[track_env] = nil
    envelope_guids[track_env_b] = nil
  end
  envelope_names = {
    [track_env] = "Track Volume",
    [track_env_b] = "Track Pan",
    [take_env] = "Take Volume",
    [send_env] = "Send Volume",
    [fx_env] = "FX Gain",
  }
  points = {
    [track_env] = {
      [-1] = {
        { 0, 0.1, 0, 0, false },
        { 1, 0.2, 1, 0.1, false },
        { 2, 0.3, 0, 0, true },
        { 3, 0.4, 0, 0, false },
      },
      [0] = {
        { 10, 0.5, 0, 0, false },
        { 11, 0.6, 0, 0, true },
      },
    },
    [track_env_b] = { [-1] = {} },
    [take_env] = { [-1] = {} },
    [send_env] = { [-1] = {} },
    [fx_env] = { [-1] = {} },
  }
  automation_items = {
    [track_env] = {
      { D_POSITION = 10, D_LENGTH = 2, D_POOL_ID = 7, D_STARTOFFS = 0, D_PLAYRATE = 1 },
    },
  }
  lane_state = { active = true, visible = false, armed = false, show_lane = false }
  send_mode = 0
  track_mode = 0
  calls = { insert = 0, set = 0, delete = 0, create_item = 0, set_send = 0 }

  local function lane(envelope, autoitem_index)
    points[envelope] = points[envelope] or {}
    points[envelope][autoitem_index] = points[envelope][autoitem_index] or {}
    return points[envelope][autoitem_index]
  end
  local function sort_lane(envelope, autoitem_index)
    table.sort(lane(envelope, autoitem_index), function(a, b) return a[1] < b[1] end)
  end

  reaper = {}
  reaper.CountTracks = function(project) assert(project == 0); return 1 end
  reaper.GetTrack = function(project, index) assert(project == 0); if index == 0 then return track end end
  reaper.GetTrackGUID = function(actual) assert(actual == track); return track.guid end
  reaper.GetMediaTrackInfo_Value = function(actual, key)
    assert(actual == track)
    if key == "IP_TRACKNUMBER" then return 1 end
    if key == "P_ENV:<VOLENV" then return track_env end
    return 0
  end
  reaper.CountTrackEnvelopes = function(actual) assert(actual == track); return #track_envelopes end
  reaper.GetTrackEnvelope = function(actual, index) assert(actual == track); return track_envelopes[index + 1] end
  reaper.GetTrackEnvelopeByName = function(actual, name)
    assert(actual == track)
    if name == "Volume" then return track_env end
  end
  reaper.GetTrackEnvelopeByChunkName = function(actual, name)
    assert(actual == track)
    if name == "<VOLENV" then return track_env end
  end
  reaper.TrackFX_GetCount = function(actual) assert(actual == track); return 1 end
  reaper.TrackFX_GetNumParams = function(actual, fx_index) assert(actual == track and fx_index == 0); return 1 end
  reaper.GetFXEnvelope = function(actual, fx_index, param_index, create)
    assert(actual == track and fx_index == 0 and param_index == 0 and create == false)
    return fx_env
  end
  reaper.TrackFX_GetParamName = function(actual, fx_index, param_index)
    assert(actual == track and fx_index == 0 and param_index == 0); return true, "FX Gain"
  end
  reaper.GetTrackNumSends = function(actual, category)
    assert(actual == track)
    if config.send_count_error then error("send count unavailable") end
    if category == 0 then return 1 end
    return 0
  end
  reaper.BR_GetMediaTrackSendInfo_Envelope = function(actual, category, send_index, envelope_type)
    assert(actual == track and category == 0 and send_index == 0)
    if envelope_type == 0 then return send_env end
  end
  reaper.GetTrackSendInfo_Value = function(actual, category, send_index, key)
    assert(actual == track and category == 0 and send_index == 0)
    if key == "P_ENV:<VOLENV" then return send_env end
    if string.match(key, "^P_ENV:") then return nil end
    if key == "I_AUTOMODE" then return config.send_readback_mismatch and 4 or send_mode end
    return 0
  end
  reaper.SetTrackSendInfo_Value = function(actual, category, send_index, key, value)
    assert(actual == track and category == 0 and send_index == 0 and key == "I_AUTOMODE")
    calls.set_send = calls.set_send + 1
    if config.send_write_rejected then return false end
    send_mode = value
    return true
  end
  reaper.GetTrackAutomationMode = function(actual) assert(actual == track); return track_mode end
  reaper.SetTrackAutomationMode = function(actual, value)
    assert(actual == track)
    if not config.track_mode_mismatch then track_mode = value end
  end
  reaper.CountMediaItems = function(project) assert(project == 0); return 1 end
  reaper.GetMediaItem = function(project, index) assert(project == 0); if index == 0 then return item end end
  reaper.CountTakes = function(actual) assert(actual == item); return 1 end
  reaper.GetTake = function(actual, index) assert(actual == item); if index == 0 then return take end end
  reaper.CountTakeEnvelopes = function(actual) assert(actual == take); return 1 end
  reaper.GetTakeEnvelope = function(actual, index) assert(actual == take); if index == 0 then return take_env end end
  reaper.GetTakeEnvelopeByName = function(actual, name)
    assert(actual == take)
    if name == "Volume" then return take_env end
  end
  reaper.GetSetEnvelopeInfo_String = function(envelope, key, value, set_new)
    assert(key == "GUID" and value == "" and set_new == false)
    return true, envelope_guids[envelope] or ""
  end
  reaper.GetEnvelopeName = function(envelope) return true, envelope_names[envelope] end
  reaper.GetEnvelopeScalingMode = function() return 0 end
  reaper.CountEnvelopePoints = function(envelope) return #lane(envelope, -1) end
  reaper.CountEnvelopePointsEx = function(envelope, autoitem_index) return #lane(envelope, autoitem_index) end
  reaper.GetEnvelopePointEx = function(envelope, autoitem_index, index)
    local row = lane(envelope, autoitem_index)[index + 1]
    if not row or config.point_read_fail_index == index then return false end
    return true, row[1], row[2], row[3], row[4], row[5]
  end
  reaper.InsertEnvelopePointEx = function(envelope, autoitem_index, time, value, shape, tension, selected)
    calls.insert = calls.insert + 1
    if config.insert_fail_at == calls.insert then return false end
    local rows = lane(envelope, autoitem_index)
    rows[#rows + 1] = { time, value, shape, tension, selected }
    return true
  end
  reaper.SetEnvelopePointEx = function(envelope, autoitem_index, index, time, value, shape, tension, selected)
    calls.set = calls.set + 1
    if not lane(envelope, autoitem_index)[index + 1] then return false end
    lane(envelope, autoitem_index)[index + 1] = { time, value, shape, tension, selected }
    return true
  end
  reaper.DeleteEnvelopePointEx = function(envelope, autoitem_index, index)
    calls.delete = calls.delete + 1
    if not lane(envelope, autoitem_index)[index + 1] then return false end
    table.remove(lane(envelope, autoitem_index), index + 1)
    return true
  end
  reaper.DeleteEnvelopePointRangeEx = function(envelope, autoitem_index, start_time, end_time)
    calls.delete = calls.delete + 1
    local rows = lane(envelope, autoitem_index)
    for index = #rows, 1, -1 do
      if rows[index][1] >= start_time and rows[index][1] < end_time then table.remove(rows, index) end
    end
    return true
  end
  reaper.Envelope_SortPointsEx = sort_lane
  reaper.CountAutomationItems = function(envelope) return #(automation_items[envelope] or {}) end
  reaper.InsertAutomationItem = function(envelope, pool_id, position, length)
    calls.create_item = calls.create_item + 1
    automation_items[envelope] = automation_items[envelope] or {}
    local rows = automation_items[envelope]
    local actual_pool_id = pool_id == -1 and (#rows + 1) or pool_id
    rows[#rows + 1] = { D_POSITION = position, D_LENGTH = length, D_POOL_ID = actual_pool_id, D_STARTOFFS = 0, D_PLAYRATE = 1 }
    return #rows - 1
  end
  reaper.GetSetAutomationItemInfo = function(envelope, index, key, value, set_new)
    local row = (automation_items[envelope] or {})[index + 1]
    if not row then return 0 end
    if set_new then row[key] = value end
    if config.item_readback_mismatch and key == "D_LENGTH" then return row[key] + 1 end
    return row[key]
  end
  reaper.BR_EnvAlloc = function(envelope)
    if not config.br_available then return nil end
    return envelope
  end
  reaper.BR_EnvGetProperties = function()
    return lane_state.active, lane_state.visible, lane_state.armed, lane_state.show_lane, 24, 0, 0, 1, 0.5, 0, false, -1
  end
  reaper.BR_EnvSetProperties = function(_, active, visible, armed, show_lane)
    if not config.lane_readback_mismatch then
      lane_state = { active = active, visible = visible, armed = armed, show_lane = show_lane }
    end
    return true
  end
  reaper.BR_EnvFree = function() return true end
  reaper.UpdateArrange = function() end
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

describe("Alpha3.3-B1d automation handler truth", () => {
  it("inventories GUID-backed track/take/send/fx envelopes with lossless public paging", () => {
    runLua(`
install_fake()
local request = make_request("automation.project_envelopes.list", { limit = 2 })
request.pack.risk = "read"
local first, failure, _, _, refs = list_project_envelopes(request)
assert(failure == nil)
assert(first.total_count == 4 and first.returned_count == 2)
assert(first.coverage_status == "paged" and first.truncated == true and first.next_cursor == "2")
assert(#refs == 2)
for _, row in ipairs(first.envelopes) do
  assert(row.identity_kind == "guid")
  assert(string.match(row.envelope_ref, "^envelope:guid:"))
end
assert(refs[1].identity.scheme == "guid")
assert(string.match(refs[1].identity.value, "^%{ENV%-"))
request.params.cursor = first.next_cursor
local second = list_project_envelopes(request)
assert(second.total_count == 4 and second.returned_count == 2)
assert(second.coverage_status == "complete" and second.truncated == false and second.next_cursor == JSON_NULL)
assert(first.envelope_refs[1] ~= second.envelope_refs[1])
local all_rows = {}
for _, row in ipairs(first.envelopes) do all_rows[#all_rows + 1] = row end
for _, row in ipairs(second.envelopes) do all_rows[#all_rows + 1] = row end
local types_by_ref = {}
for _, row in ipairs(all_rows) do types_by_ref[row.envelope_ref] = row.envelope_type end
assert(types_by_ref["envelope:guid:{ENV-TRACK}"] == "volume")
assert(types_by_ref["envelope:guid:{ENV-TAKE}"] == "volume")
assert(types_by_ref["envelope:guid:{ENV-SEND}"] == "volume")
assert(types_by_ref["envelope:guid:{ENV-FX}"] == "fx_parameter")

request.params = { only_visible = true, limit = 8 }
local filtered = list_project_envelopes(request)
assert(filtered.coverage_status == "unknown" and filtered.truncated == true)
assert(filtered.coverage.internally_complete == false)
assert(filtered.coverage.reasons[1] == "VISIBLE_FILTER_UNPROVABLE")

local resolved, resolve_failure = resolve_envelope_ref(make_request("automation.resolve_envelope_ref", {}, "envelope:guid:{ENV-TRACK}"))
assert(resolve_failure == nil and resolved.envelope_ref == "envelope:guid:{ENV-TRACK}")
assert(resolved.envelope_type == "volume")

install_fake({ send_count_error = true })
local incomplete = list_project_envelopes(make_request("automation.project_envelopes.list", { limit = 8 }))
assert(incomplete.coverage_status == "unknown", "coverage=" .. tostring(incomplete.coverage_status))
assert(incomplete.coverage.internally_complete == false, "inventory claimed complete")
local saw_send_reason = false
for _, reason in ipairs(incomplete.coverage.reasons) do
  if reason == "SEND_COUNT_UNAVAILABLE" then saw_send_reason = true end
end
assert(saw_send_reason == true, "missing send coverage reason")
local ambiguous_guid = e5_automation_envelope_by_guid("{ENV-TRACK}")
assert(ambiguous_guid == nil, "incomplete GUID enumeration resolved")
`);
  });

  it("fails closed when a snapshot locator no longer identifies the same envelope", () => {
    runLua(`
install_fake({ no_envelope_guids = true, two_track_envelopes = true })
local request = make_request("automation.project_envelopes.list", { parent_kinds = { "track" }, limit = 8 })
request.pack.risk = "read"
local inventory = list_project_envelopes(request)
assert(inventory.total_count == 2, "total=" .. tostring(inventory.total_count))
local snapshot_types = {}
for _, row in ipairs(inventory.envelopes) do snapshot_types[row.name] = row.envelope_type end
assert(snapshot_types["Track Volume"] == "volume")
assert(snapshot_types["Track Pan"] == "pan")
local old_ref = inventory.envelopes[1].envelope_ref
assert(inventory.envelopes[1].identity_kind == "snapshot_locator", "identity=" .. tostring(inventory.envelopes[1].identity_kind))
local before = e5_automation_envelope_from_ref_string(old_ref)
assert(before ~= nil, "before ref did not resolve: " .. tostring(old_ref))
track_envelopes[1], track_envelopes[2] = track_envelopes[2], track_envelopes[1]
local after = e5_automation_envelope_from_ref_string(old_ref)
assert(after == nil, "stale ref still resolved: " .. tostring(old_ref))
`);
  });

  it("reads complete Ex lanes before range/cursor paging and defaults to the underlying lane", () => {
    runLua(`
install_fake()
local request = make_request("automation.read_envelope_points", { start_seconds = 1, end_seconds = 3, limit = 1 }, "envelope:guid:{ENV-TRACK}")
request.pack.risk = "read"
local first, failure = read_envelope_points(request)
assert(failure == nil)
assert(first.autoitem_index == -1 and first.total_count == 3 and first.returned_count == 1)
assert(first.points[1].time_seconds == 1 and first.next_cursor == "1" and first.coverage_status == "paged")
request.params.cursor = "1"
local second = read_envelope_points(request)
assert(second.points[1].time_seconds == 2)

request.params = { autoitem_index = 0, limit = 8 }
local automation_item = read_envelope_points(request)
assert(automation_item.autoitem_index == 0 and automation_item.total_count == 2)
assert(automation_item.points[1].time_seconds == 10)

install_fake({ point_read_fail_index = 2 })
local summary, read_failure = read_envelope_points(make_request("automation.read_envelope_points", { limit = 1 }, "envelope:guid:{ENV-TRACK}"))
assert(summary == nil and read_failure.code == "COMMAND_FAILED")
assert(read_failure.details.reason_code == "POINT_READ_FAILED")
`);
  });

  it("rejects silent batch truncation, reports partial native failure, and never inserts on set-point overflow", () => {
    runLua(`
install_fake()
local oversized = {}
for index = 1, 33 do oversized[index] = { time_seconds = index, value = 0.5, shape = 0, tension = 0 } end
local summary, failure = insert_envelope_points_batch(make_request("automation.insert_envelope_points_batch", { points = oversized }, "envelope:guid:{ENV-TRACK}"))
assert(summary == nil and failure.code == "PARAMS_INVALID")
assert(failure.details.reason_code == "POINT_BATCH_LIMIT_EXCEEDED" and calls.insert == 0)

install_fake({ insert_fail_at = 2 })
summary, failure = insert_envelope_points_batch(make_request("automation.insert_envelope_points_batch", {
  points = {
    { time_seconds = 4, value = 0.5, shape = 0, tension = 0 },
    { time_seconds = 5, value = 0.6, shape = 0, tension = 0 },
  },
}, "envelope:guid:{ENV-TRACK}"))
assert(summary == nil and failure.code == "COMMAND_FAILED" and failure.recoverable == false)
assert(failure.details.reason_code == "POINT_BATCH_INSERT_FAILED" and calls.insert == 2)
assert(failure.details.inserted_before_failure == 1 and failure.details.mutation_applied == true)
assert(failure.details.index_maintenance_applied == false)
assert(#points[track_env][-1] == 5)

install_fake()
summary, failure = set_envelope_point(make_request("automation.set_envelope_point", { point_index = 99, value = 0.9 }, "envelope:guid:{ENV-TRACK}"))
assert(summary == nil and failure.code == "REF_INVALID")
assert(failure.details.reason_code == "POINT_INDEX_OUT_OF_RANGE")
assert(calls.set == 0 and calls.insert == 0 and #points[track_env][-1] == 4)
`);
  });

  it("deletes only discriminated exact points or half-open ranges and proves absence", () => {
    runLua(`
install_fake()
local ref = "envelope:guid:{ENV-TRACK}"
local summary, failure = delete_envelope_points(make_request("automation.delete_envelope_points", { mode = "point" }, ref))
assert(summary == nil and failure.code == "PARAMS_INVALID" and calls.delete == 0)
summary, failure = delete_envelope_points(make_request("automation.delete_envelope_points", { mode = "range", point_index = 0, start_seconds = 0, end_seconds = 1 }, ref))
assert(summary == nil and failure.code == "PARAMS_INVALID" and calls.delete == 0)

summary, failure = delete_envelope_points(make_request("automation.delete_envelope_points", { mode = "point", point_index = 1 }, ref))
assert(failure == nil and summary.deleted_count == 1 and summary.before_count == 4 and summary.after_count == 3)
assert(calls.delete == 1 and points[track_env][-1][2][1] == 2)

summary, failure = delete_envelope_points(make_request("automation.delete_envelope_points", { mode = "range", start_seconds = 2, end_seconds = 3 }, ref))
assert(failure == nil and summary.deleted_count == 1 and summary.range_absent == true)
for _, row in ipairs(points[track_env][-1]) do assert(not (row[1] >= 2 and row[1] < 3)) end
assert(points[track_env][-1][2][1] == 3)
`);
  });

  it("fails typed on unavailable/mismatched lane, automation-item, and send readback", () => {
    runLua(`
local ref = "envelope:guid:{ENV-TRACK}"
install_fake()
local summary, failure = set_envelope_lane_state(make_request("automation.set_envelope_lane_state", { visible = true }, ref))
assert(summary == nil and failure.code == "COMMAND_FAILED")
assert(failure.details.reason_code == "BR_ENV_PROPERTIES_UNAVAILABLE")

install_fake({ br_available = true, lane_readback_mismatch = true })
summary, failure = set_envelope_lane_state(make_request("automation.set_envelope_lane_state", { visible = true, armed = true }, ref))
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.recoverable == false)
assert(failure.details.mutation_applied == true)

install_fake({ br_available = true })
lane_state.armed = true
summary, failure = set_envelope_lane_state(make_request("automation.set_envelope_lane_state", { active = false, visible = false, armed = false, show_lane = false }, ref))
assert(failure == nil)
assert(summary.active == false and summary.visible == false and summary.armed == false and summary.show_lane == false)

install_fake()
summary, failure = create_automation_item(make_request("automation.create_automation_item", {
  position_seconds = 20, length_seconds = 3, pool_mode = "reuse_pool", pool_id = 7,
}, ref))
assert(failure == nil and summary.automation_item_index == 1 and summary.pool_id == 7)
assert(summary.position_seconds == 20 and summary.length_seconds == 3 and calls.create_item == 1)
summary, failure = set_automation_item_bounds(make_request("automation.set_automation_item_bounds", {
  automation_item_index = 99, position_seconds = 1,
}, ref))
assert(summary == nil and failure.code == "REF_INVALID" and calls.create_item == 1)

install_fake()
summary, failure = create_automation_item(make_request("automation.create_automation_item", {
  position_seconds = 20, length_seconds = 3, pool_mode = "new_empty",
}, ref))
assert(failure == nil and summary.automation_item_index == 1 and summary.pool_id == 2)

install_fake({ item_readback_mismatch = true })
summary, failure = create_automation_item(make_request("automation.create_automation_item", {
  position_seconds = 20, length_seconds = 3, pool_mode = "new_empty",
}, ref))
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.recoverable == false)
assert(failure.details.mutation_applied == true)

install_fake({ send_readback_mismatch = true })
local send_request = make_request("automation.set_send_automation_mode", { mode = "read" })
send_request.refs = { { kind = "send", ref = "send:track:guid:{TRACK}:0" } }
summary, failure = set_send_automation_mode(send_request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.recoverable == false)
assert(failure.details.reason_code == "SEND_AUTOMATION_MODE_READBACK_MISMATCH" and calls.set_send == 1)
assert(failure.details.mutation_applied == true)

install_fake()
local track_request = make_request("automation.set_track_automation_mode", { mode = "trim_read" })
track_request.refs = { { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } } }
summary, failure = set_track_automation_mode(track_request)
assert(failure == nil and summary.mode == "trim_read" and track_mode == 0)

install_fake({ track_mode_mismatch = true })
track_request = make_request("automation.set_track_automation_mode", { mode = "read" })
track_request.refs = { { kind = "track", ref = "track:guid:{TRACK}", identity = { scheme = "guid", value = "{TRACK}" } } }
summary, failure = set_track_automation_mode(track_request)
assert(summary == nil and failure.code == "VERIFY_FAILED" and failure.recoverable == false)
assert(failure.details.reason_code == "TRACK_AUTOMATION_MODE_READBACK_MISMATCH")
assert(failure.details.mutation_applied == true and track_mode == 0)
`);
  });
});
