import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const E5_R1_HANDLER_SOURCE = readFileSync(new URL("../../reaper/bridge/src/handlers/routing/e5_r1_routing_read_route.lua", import.meta.url), "utf8");
const E5_R1_ROUTING_ONLY_SOURCE = E5_R1_HANDLER_SOURCE.slice(0, E5_R1_HANDLER_SOURCE.indexOf("\nlocal function e5_automation_envelope_key"));
const E5_R1_FLAG = "--routing-read";
const E5_R1_OPT_IN_ENV = "OPENREAPER_E5_R1_ROUTING_READ_LIVE_SMOKE";
const E5_TRACK_REF_ENV = "OPENREAPER_E5_TRACK_REF";
const E5_SEND_REF_ENV = "OPENREAPER_E5_SEND_REF";
const E5_R1_OPERATION_KEYS = Object.freeze([
  "query_state:routing.track.read",
  "query_state:routing.send.resolve_ref",
  "query_state:routing.track_hardware_outputs.list",
  "query_state:routing.project_graph.read",
  "query_state:routing.audio_outputs.list",
]);

const CHANNEL_COUNT_PRELUDE = String.raw`
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
function bounded_string(value) return tostring(value or "") end
function safe_budget(request) return request.budget or {} end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
READ_B_MEDIA = {
  resolve_take_token = function() return nil end,
  bounded_limit = function(request, value, fallback, maximum)
    return math.min(tonumber(value) or fallback, maximum)
  end,
}
function install_channel_count_fake(config)
  config = config or {}
  track = { guid = "{CHANNEL-TRACK}" }
  channel_count = config.initial_channel_count or 2
  channel_count_writes = 0
  reaper = {}
  reaper.CountTracks = function(project) assert(project == 0); return 1 end
  reaper.GetTrack = function(project, index) assert(project == 0); if index == 0 then return track end end
  reaper.GetTrackGUID = function(actual) assert(actual == track); return track.guid end
  reaper.GetMediaTrackInfo_Value = function(actual, key)
    assert(actual == track)
    if key == "IP_TRACKNUMBER" then return 1 end
    assert(key == "I_NCHAN")
    if config.unreadable_after_write and channel_count_writes > 0 then return nil end
    return channel_count
  end
  reaper.SetMediaTrackInfo_Value = function(actual, key, value)
    assert(actual == track and key == "I_NCHAN")
    channel_count_writes = channel_count_writes + 1
    if config.reject_write then return false end
    if not config.readback_mismatch then channel_count = value end
    return true
  end
end
function channel_count_request(value)
  return {
    refs = {{
      kind = "track",
      ref = "track:guid:{CHANNEL-TRACK}",
      identity = { scheme = "guid", value = "{CHANNEL-TRACK}" },
    }},
    params = { channel_count = value },
    pack = { id = "routing", capability = "routing.track.channel_count.set", risk = "write" },
  }
end
`;

function runChannelCountLua(body) {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `${CHANNEL_COUNT_PRELUDE}\n${E5_R1_HANDLER_SOURCE}\n${body}\nreturn true`;
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

describe("E5-R1 routing read live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the five E5-R1 routing read template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS, [
      "template.routing.read_track_routing",
      "template.routing.resolve_send_ref",
      "template.routing.list_track_hardware_outputs",
      "template.routing.read_project_routing_graph",
      "template.routing.list_available_audio_outputs",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
        opt_in_env: E5_R1_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e5R1Input(id),
        refs: e5R1Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      E5_R1_OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), [
      "routing.track.read",
      "routing.send.resolve_ref",
      "routing.track_hardware_outputs.list",
      "routing.project_graph.read",
      "routing.audio_outputs.list",
    ]);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "routing");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the E5-R1 runner default-skipped and typed for missing transport blockers", () => {
    const skipped = runSmoke([E5_R1_FLAG], {
      [E5_R1_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [E5_TRACK_REF_ENV]: "",
      [E5_SEND_REF_ENV]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "E5-R1 Routing Read Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, E5_R1_OPERATION_KEYS);

    const noExecutor = runSmokeExpectingFailure([E5_R1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal("attempted_template_ids" in noExecutor, false);
  });

  it("writes the exact E5-R1 routing read requests to transport without starting REAPER", async () => {
    const transportDir = await createTransportDir("openreaper-e5-r1-timeout-");
    const report = runSmokeExpectingFailure([E5_R1_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [E5_TRACK_REF_ENV]: "track:guid:{E5-R1-SOURCE-TRACK}",
      [E5_SEND_REF_ENV]: "send:track:0:0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);
    assert.deepEqual(report.allowed_bridge_operations, E5_R1_OPERATION_KEYS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_E5_R1_ROUTING_READ_TEMPLATE_IDS);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 5);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`),
      E5_R1_OPERATION_KEYS,
    );

    for (const request of requests) {
      assert.equal(request.pack.id, "routing");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(requests[0].refs.find((ref) => ref.kind === "track").ref, "track:guid:{E5-R1-SOURCE-TRACK}");
    assert.equal(requests[1].params.send_ref, "send:track:0:0");
    assert.equal(requests[2].refs.find((ref) => ref.kind === "track").ref, "track:guid:{E5-R1-SOURCE-TRACK}");
    assert.equal(requests[3].params.max_tracks, 16);
    assert.equal(requests[3].params.max_edges, 64);
    assert.equal(requests[4].params.max_outputs, 32);
  });

  it("keeps the Lua bridge E5-R1 routing read surface exact and read-only", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.track\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_track_routing/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.send\.resolve_ref"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.resolve_send_ref/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.track_hardware_outputs\.list"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_track_hardware_outputs/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.project_graph\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_project_routing_graph/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.audio_outputs\.list"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_available_audio_outputs/);
    assert.match(BRIDGE_SOURCE, /\["query_state:routing\.fx_pin_mapping\.read"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_fx_pin_mapping/);
    assert.match(BRIDGE_SOURCE, /GetTrackNumSends/);
    assert.match(BRIDGE_SOURCE, /GetTrackSendInfo_Value/);
    assert.match(BRIDGE_SOURCE, /E5-R1 read_track_routing requires a resolvable track ref/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["query_state:(routing\.[^"]+)"\]\s*=/g)].map((match) => match[1]))],
      [
        "routing.track.read",
        "routing.send.resolve_ref",
        "routing.track_hardware_outputs.list",
        "routing.project_graph.read",
        "routing.audio_outputs.list",
        "routing.fx_pin_mapping.read",
      ],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(E5_R1_ROUTING_ONLY_SOURCE, /set_loop_source|Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("keeps project graph reads bounded but permits large-project truth above the old 8/24 caps", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /bounded_limit\(request, request\.params\.max_tracks, 8, 128\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /bounded_limit\(request, request\.params\.max_edges, 24, 256\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /local edge_cursor = math\.max\(0, math\.floor\(tonumber\(request\.params\.edge_cursor\) or 0\)\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /local track_truncated = total > max_tracks/);
    assert.match(E5_R1_HANDLER_SOURCE, /local resolve_track_refs, resolve_track_lookup = requested_track_refs\(request\.params\.resolve_track_refs\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /local state_track_refs, state_track_lookup = requested_track_refs\(request\.params\.state_track_refs\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /local include_track_row = include_tracks and \(not filter_track_state or state_track_lookup\[track_ref\] == true\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /if resolve_track_lookup\[track_ref\] == true or include_track_row then[\s\S]*?e5_routing_track_object_ref\(track\)/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /if include_tracks then[\s\S]*?end[\s\S]*?refs\[#refs \+ 1\] = e5_routing_track_object_ref\(track\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /if total_edge_count >= edge_cursor and #edges < max_edges then/);
    assert.match(E5_R1_HANDLER_SOURCE, /local edges_truncated = next_edge_cursor < total_edge_count/);
    assert.match(E5_R1_HANDLER_SOURCE, /next_edge_cursor = edges_truncated and tostring\(next_edge_cursor\) or nil/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /if #edges >= max_edges then[\s\S]*?break/);
    assert.match(E5_R1_HANDLER_SOURCE, /GetTrackNumSends", track, 0/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /GetTrackNumSends", track, 1[\s\S]*?read_project_routing_graph/);
  });

  it("reports graph truncation separately from internal enumeration failure", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /local internally_complete = true/);
    assert.match(E5_R1_HANDLER_SOURCE, /local function mark_incomplete\(reason\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /mark_incomplete\("TRACK_COUNT_UNAVAILABLE"\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /mark_incomplete\("TRACK_READ_FAILED"\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /mark_incomplete\("SEND_COUNT_UNAVAILABLE"\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /mark_incomplete\("SEND_SUMMARY_UNAVAILABLE"\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /coverage_status = not internally_complete and "incomplete" or \(truncated and "paged" or "complete"\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /coverage = \{[\s\S]*?internally_complete = internally_complete,[\s\S]*?incomplete_reasons = incomplete_reasons/);
    assert.match(E5_R1_HANDLER_SOURCE, /track_truncated = track_truncated/);
    assert.match(E5_R1_HANDLER_SOURCE, /edges_truncated = edges_truncated/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /local function read_project_routing_graph[\s\S]*?GetTrackNumSends", track, 1/);
  });

  it("treats non-numeric route counts and unreadable send rows as incomplete truth", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /local function e5_routing_read_sends[\s\S]*?call_reaper\("GetTrackNumSends", track, category\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /type\(count\) ~= "number"[\s\S]*?count ~= count[\s\S]*?count < 0[\s\S]*?count ~= math\.floor\(count\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /complete = false[\s\S]*?"SEND_SUMMARY_UNAVAILABLE"/);
    assert.match(E5_R1_HANDLER_SOURCE, /coverage_status = internally_complete and "complete" or "incomplete"/);
    assert.match(E5_R1_HANDLER_SOURCE, /local function read_project_routing_graph[\s\S]*?type\(total\) ~= "number"[\s\S]*?"TRACK_COUNT_UNAVAILABLE"/);
    assert.match(E5_R1_HANDLER_SOURCE, /local function read_project_routing_graph[\s\S]*?type\(send_count\) ~= "number"[\s\S]*?"SEND_COUNT_UNAVAILABLE"/);
    assert.match(E5_R1_HANDLER_SOURCE, /local function e5_routing_send_summary[\s\S]*?e5_routing_read_send_number_exact[\s\S]*?return nil/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /local function e5_routing_send_summary[\s\S]*?e5_routing_read_send_value\(source_track/);
  });

  it("never substitutes default Track state for failed routing truth reads", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /local function e5_routing_master_parent_exact[\s\S]*?return nil/);
    assert.match(E5_R1_HANDLER_SOURCE, /local function e5_routing_channel_count_exact[\s\S]*?return nil/);
    assert.match(E5_R1_HANDLER_SOURCE, /"TRACK_CHANNEL_COUNT_UNAVAILABLE"/);
    assert.match(E5_R1_HANDLER_SOURCE, /"MASTER_PARENT_STATE_UNAVAILABLE"/);
    assert.match(E5_R1_HANDLER_SOURCE, /channel_count = channel_count == nil and JSON_NULL or channel_count/);
  });

  it("keeps project graph Track state fields aligned with exact Track readback", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /channel_count = e5_routing_channel_count_exact\(track\)/);
    assert.match(E5_R1_HANDLER_SOURCE, /master_parent_enabled = e5_routing_master_parent_exact\(track\)/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /local function read_project_routing_graph[\s\S]*?channels = e5_routing_channel_count\(track\)/);
  });

  it("creates a fresh Send when allow_duplicate is explicit", () => {
    assert.match(E5_R1_HANDLER_SOURCE, /existing == nil or request\.params\.duplicate_policy == "allow_duplicate"[\s\S]*?CreateTrackSend/);
    assert.doesNotMatch(E5_R1_HANDLER_SOURCE, /local send_index = existing/);
  });

  it("sets exact 64, 66, and 128 Track channel counts and proves live readback", () => {
    runChannelCountLua(`
for _, requested in ipairs({ 64, 66, 128 }) do
  install_channel_count_fake()
  local summary, failure = set_track_channel_count(channel_count_request(requested))
  assert(failure == nil)
  assert(summary.channel_count == requested)
  assert(summary.readback_status == "passed")
  assert(channel_count == requested)
  assert(channel_count_writes == 1)
end
`);
  });

  it("implements the public 2..128 even-number contract without coercion or clamping", () => {
    const handler = E5_R1_HANDLER_SOURCE.slice(
      E5_R1_HANDLER_SOURCE.indexOf("local function set_track_channel_count"),
      E5_R1_HANDLER_SOURCE.indexOf("\nlocal function track_mono_or_stereo_button"),
    );
    assert.match(handler, /type\(channels\) ~= "number"/);
    assert.match(handler, /channels > 128/);
    assert.match(handler, /channels % 2 ~= 0/);
    assert.match(handler, /SetMediaTrackInfo_Value", track, "I_NCHAN", channels/);
    assert.match(handler, /e5_routing_channel_count_exact\(track\)/);
    assert.match(handler, /"VERIFY_FAILED"/);
    assert.match(handler, /"TRACK_CHANNEL_COUNT_READBACK_MISMATCH"/);
    assert.doesNotMatch(handler, /tonumber|channels = math\.floor|channels = 64|channels = channels \+ 1/);
  });

  it("rejects every non-exact Track channel count before any REAPER mutation", () => {
    runChannelCountLua(`
local invalid = { "66", 0/0, math.huge, -math.huge, 0, 1, 3, 65, 127, 129, 64.5 }
for _, requested in ipairs(invalid) do
  install_channel_count_fake()
  local summary, failure = set_track_channel_count(channel_count_request(requested))
  assert(summary == nil)
  assert(failure.code == "PARAMS_INVALID")
  assert(failure.details.reason_code == "TRACK_CHANNEL_COUNT_INVALID")
  assert(channel_count_writes == 0)
end
install_channel_count_fake()
local request = channel_count_request(64)
request.params.channel_count = nil
local summary, failure = set_track_channel_count(request)
assert(summary == nil and failure.code == "PARAMS_INVALID")
assert(channel_count_writes == 0)
`);
  });

  it("fails closed when accepted channel-count dispatch cannot be read back exactly", () => {
    runChannelCountLua(`
for _, config in ipairs({ { readback_mismatch = true }, { unreadable_after_write = true } }) do
  install_channel_count_fake(config)
  local summary, failure = set_track_channel_count(channel_count_request(66))
  assert(summary == nil)
  assert(failure.code == "VERIFY_FAILED")
  assert(failure.recoverable == false)
  assert(failure.details.reason_code == "TRACK_CHANNEL_COUNT_READBACK_MISMATCH")
  assert(failure.details.requested_channel_count == 66)
  assert(failure.details.mutation_applied == true)
  assert(channel_count_writes == 1)
end
`);
  });
});

function e5R1Input(id) {
  if (id === "template.routing.read_track_routing") {
    return { include_receives: true, include_master_parent: true, max_routes: 32 };
  }
  if (id === "template.routing.resolve_send_ref") {
    return { send_ref: "send:track:0:0" };
  }
  if (id === "template.routing.list_track_hardware_outputs") {
    return { include_disabled: true, max_outputs: 16 };
  }
  if (id === "template.routing.read_project_routing_graph") {
    return { include_master_parent: true, max_tracks: 16, max_edges: 64 };
  }
  if (id === "template.routing.list_available_audio_outputs") {
    return { include_unavailable: false, max_outputs: 32 };
  }
  return {};
}

function e5R1Refs(id) {
  if (id === "template.routing.read_track_routing" || id === "template.routing.list_track_hardware_outputs") {
    return {
      track_ref: createObjectRef("track", { scheme: "guid", value: "{E5-R1-SOURCE-TRACK}" }, {
        ref: "track:guid:{E5-R1-SOURCE-TRACK}",
      }),
    };
  }
  return {};
}

async function createTransportDir(prefix) {
  const transportDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(transportDir, "requests"));
  await mkdir(join(transportDir, "results"));
  return transportDir;
}

async function readTransportRequests(transportDir) {
  const requestDir = join(transportDir, "requests");
  const names = await readdir(requestDir);
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(requestDir, name), "utf8")));
}

function context(extra = {}) {
  return {
    session_id: "test-session",
    request_id: "test-request",
    expected_owner: "owner-test",
    expected_generation: 1,
    ...extra,
  };
}

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
        [E5_R1_OPT_IN_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    }).trim(),
  );
}

function runSmokeExpectingFailure(args, env) {
  try {
    return runSmoke(args, env);
  } catch (error) {
    assert.equal(error.status, 2);
    const report = JSON.parse(String(error.stdout));
    assert.equal(report.ok, false);
    return report;
  }
  assert.fail("Expected E5-R1 routing read live smoke script to exit with status 2.");
}
