import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { lauxlib, lua, lualib, to_jsstring, to_luastring } from "fengari";
import {
  validateFoundationBridgeResult,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
  createLiveBridgeExecutorFromEnv,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";
import {
  buildLiveBridgeBundle,
} from "../../scripts/build-live-bridge.mjs";

const BRIDGE_SCRIPT_URL = new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url);
const BRIDGE_SOURCE = readFileSync(BRIDGE_SCRIPT_URL, "utf8");
const BRIDGE_SOURCE_MODULES = Object.freeze([
  "00-bridge-kernel.lua",
  "10-file-transport.lua",
  "20-bridge-envelope-kernel.lua",
  "30-artifact-helper.lua",
  "35-route-policy.lua",
  "40-route-pack-handlers.lua",
  "90-file-transport-loop.lua",
]);
const ROOT = new URL("../..", import.meta.url);

describe("Layer 4D.2 REAPER-side live bridge script", () => {
  it("bundles the manual bridge from stable source modules without changing the output", () => {
    execFileSync(process.execPath, ["scripts/build-live-bridge.mjs", "--check"], {
      cwd: ROOT,
      stdio: "pipe",
    });

    const sourceModules = Object.fromEntries(
      BRIDGE_SOURCE_MODULES.map((file) => [
        file,
        readFileSync(new URL(`../../reaper/bridge/src/${file}`, import.meta.url), "utf8"),
      ]),
    );
    assert.equal(buildLiveBridgeBundle({ cwd: ROOT.pathname }), BRIDGE_SOURCE);
    assert.match(BRIDGE_SOURCE, /local dispatch_request = \(function\(\)/);
    assert.match(BRIDGE_SOURCE, /return dispatch_request\nend\)\(\)/);
    assert.ok(
      BRIDGE_SOURCE.indexOf("local TRANSPORT_DIR = non_empty(os.getenv(TRANSPORT_ENV))") <
        BRIDGE_SOURCE.indexOf("local dispatch_request = (function()"),
      "transport directories must stay visible to the file-transport loop outside the handler wrapper",
    );

    assert.match(sourceModules["00-bridge-kernel.lua"], /local CONTRACT = "foundation\.bridge\.v1"/);
    assert.match(sourceModules["00-bridge-kernel.lua"], /function json\.decode/);
    assert.match(sourceModules["20-bridge-envelope-kernel.lua"], /bridge_error_envelope/);
    assert.match(sourceModules["20-bridge-envelope-kernel.lua"], /FIXED_FAMILIES/);
    assert.match(sourceModules["10-file-transport.lua"], /write_file_atomic/);
    assert.match(sourceModules["10-file-transport.lua"], /local TRANSPORT_DIR = non_empty\(os\.getenv\(TRANSPORT_ENV\)\)/);
    assert.match(sourceModules["10-file-transport.lua"], /os\.rename\(temp_path, path\)/);
    assert.match(sourceModules["10-file-transport.lua"], /local HEARTBEAT_CONTRACT = "openreaper\.bridge_liveness\.v1"/);
    assert.match(sourceModules["10-file-transport.lua"], /local HEARTBEAT_FILENAME = "openreaper-bridge-liveness-v1\.json"/);
    assert.match(sourceModules["10-file-transport.lua"], /local HEARTBEAT_PATH = TRANSPORT_DIR and path_join\(TRANSPORT_DIR, HEARTBEAT_FILENAME\) or nil/);
    assert.match(sourceModules["10-file-transport.lua"], /local HEARTBEAT_INTERVAL_SECONDS = 0\.50/);
    assert.match(sourceModules["10-file-transport.lua"], /local HEARTBEAT_INTERVAL_MS = 500/);
    assert.match(sourceModules["10-file-transport.lua"], /return write_file_atomic\(HEARTBEAT_PATH, json\.encode\(heartbeat\) \.\. "\\n"\)/);
    assert.match(sourceModules["30-artifact-helper.lua"], /artifact\.state_store\.v1/);
    assert.match(sourceModules["30-artifact-helper.lua"], /A1_ARTIFACT_OPERATIONS/);
    assert.match(sourceModules["35-route-policy.lua"], /local SAFE_WRITE_A_CAPABILITIES = \{/);
    assert.match(sourceModules["35-route-policy.lua"], /local function validate_request\(request\)/);
    assert.match(sourceModules["35-route-policy.lua"], /ARTIFACT_PRODUCING_OPERATIONS/);
    assert.match(sourceModules["35-route-policy.lua"], /Safe-Write-A write\/safe requests must use undo\.mode required/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /local ALLOWED_OPERATIONS = \{/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /handler = read_project_summary/);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /local function validate_request\(request\)/);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /template_count = 133/);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /template_count = 119/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /^  open_required_undo_block\(request, key\)$/m);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /^  close_required_undo_block\(request, key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /^  open_required_undo_block\(request, operation_key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /^  close_required_undo_block\(request, operation_key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /local TRANSPORT_DIR = non_empty\(os\.getenv\(TRANSPORT_ENV\)\)/);
    assert.match(
      readFileSync(new URL("../../reaper/bridge/src/handlers/core/read_template_catalog_summary.lua", import.meta.url), "utf8"),
      /template_count = 232/,
    );
    assert.match(sourceModules["90-file-transport-loop.lua"], /reaper\.EnumerateFiles\(REQUESTS_DIR, index\)/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /local completed_request_files = \{\}/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /not completed_request_files\[filename\]/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /local startup_orphan_claims = \{\}/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /orphaned_request_after_bridge_restart/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /write_file_atomic\(claim_path, raw\)/);
    assert.doesNotMatch(sourceModules["90-file-transport-loop.lua"], /os\.rename\(request_path, claim_path\)/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /current_time >= next_heartbeat_at/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /next_heartbeat_at = current_time \+ HEARTBEAT_INTERVAL_SECONDS/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /heartbeat refresh failed/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /startup heartbeat failed/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /reaper\.defer\(bridge_loop\)/);
  });

  it("checks completed request results once per bridge session while still discovering new requests", () => {
    runFileTransportLoopLua(String.raw`
files = { "completed.json" }
results["/results/completed.json"] = true
run_poll(0.11)
assert(file_exists_calls["/results/completed.json"] == 1, "completed first result check")
assert(read_calls["/requests/completed.json"] == nil, "completed request should not be read")

files[2] = "new.json"
requests["/requests/new.json"] = { id = "new", params = {} }
run_poll(0.22)
assert(file_exists_calls["/results/completed.json"] == 1, "completed result should stay cached")
assert(file_exists_calls["/results/new.json"] == 3, "new result checked before parsing, before claim, and before terminal write")
assert(read_calls["/requests/new.json"] == 1, "new request read once")
assert(dispatch_calls.new == 1, "new request dispatched once")
assert(results["/results/new.json"] == true, "new result written")
assert(requests["/requests/new.json"] ~= nil, "completed request remains as durable evidence")

run_poll(0.33)
assert(file_exists_calls["/results/completed.json"] == 1, "completed result cached after third poll")
assert(file_exists_calls["/results/new.json"] == 3, "new result cached after terminal write")
assert(read_calls["/requests/new.json"] == 1, "new request still read once")
assert(dispatch_calls.new == 1, "new request still dispatched once")
`);
  });

  it("does not reopen 1,143 historical results while polling the next large-project request", () => {
    runFileTransportLoopLua(String.raw`
for index = 1, 1143 do
  local filename = string.format("history-%04d.json", index)
  files[index] = filename
  results["/results/" .. string.gsub(filename, "%.json$", ".json")] = true
end
run_poll(0.11)
local historical_result_checks = 0
for path, count in pairs(file_exists_calls) do
  if string.find(path, "/results/history-", 1, true) == 1 then historical_result_checks = historical_result_checks + count end
end
assert(historical_result_checks == 1143)

files[1144] = "next.json"
requests["/requests/next.json"] = { id = "next", params = {} }
run_poll(0.22)
local checks_after_next = 0
for path, count in pairs(file_exists_calls) do
  if string.find(path, "/results/history-", 1, true) == 1 then checks_after_next = checks_after_next + count end
end
assert(checks_after_next == 1143, "historical result files must not be reopened")
assert(dispatch_calls.next == 1)
assert(results["/results/next.json"] == true)
`);
  });

  it("does not mark a request complete until its result is written successfully", () => {
    runFileTransportLoopLua(String.raw`
files = { "retry.json" }
requests["/requests/retry.json"] = { id = "retry", params = {} }
write_failures["/results/retry.json"] = 1

run_poll(0.11)
assert(dispatch_calls.retry == 1)
assert(results["/results/retry.json"] == nil)
assert(requests["/claims/retry.json"] ~= nil)
assert(requests["/requests/retry.json"] ~= nil)

run_poll(0.22)
assert(dispatch_calls.retry == 1)
assert(results["/results/retry.json"] == true)
assert(requests["/claims/retry.json"] == nil)

run_poll(0.33)
assert(dispatch_calls.retry == 1)
assert(read_calls["/requests/retry.json"] == 1)
`);
  });

  it("turns a durable claim from an earlier bridge loop into a non-recoverable unknown outcome", () => {
    runFileTransportLoopLua(String.raw`
assert(dispatch_count == 0)
assert(results["/results/orphan.json"] == true)
assert(requests["/claims/orphan.json"] == nil)
assert(string.find(writes["/results/orphan.json"], "orphaned_request_after_bridge_restart", 1, true) ~= nil)
assert(string.find(writes["/results/orphan.json"], '"recoverable":false', 1, true) ~= nil)
`, String.raw`
requests["/claims/orphan.json"] = { id = "orphan", params = {} }
`);
  });

  it("rejects a request whose internal id differs from its transport filename", () => {
    runFileTransportLoopLua(String.raw`
files = { "filename-id.json" }
requests["/requests/filename-id.json"] = { id = "different-id", params = {} }
run_poll(0.11)
assert(dispatch_count == 0)
assert(results["/results/filename-id.json"] == true)
assert(results["/results/different-id.json"] == nil)
assert(requests["/claims/filename-id.json"] == nil)
`);
  });

  it("adds a manual file-transport bridge loop without REAPER startup behavior", () => {
    assert.match(BRIDGE_SOURCE, /OPENREAPER_LIVE_BRIDGE_TRANSPORT_DIR/);
    assert.match(BRIDGE_SOURCE, /path_join\(TRANSPORT_DIR, "requests"\)/);
    assert.match(BRIDGE_SOURCE, /path_join\(TRANSPORT_DIR, "results"\)/);
    assert.match(BRIDGE_SOURCE, /reaper\.EnumerateFiles\(REQUESTS_DIR, index\)/);
    assert.match(BRIDGE_SOURCE, /reaper\.defer\(bridge_loop\)/);
    assert.match(BRIDGE_SOURCE, /write_file_atomic/);
    assert.match(BRIDGE_SOURCE, /os\.rename\(temp_path, path\)/);
    assert.match(BRIDGE_SOURCE, /openreaper\.bridge_liveness\.v1/);
    assert.match(BRIDGE_SOURCE, /openreaper-bridge-liveness-v1\.json/);
    assert.match(BRIDGE_SOURCE, /write_file_atomic\(HEARTBEAT_PATH, json\.encode\(heartbeat\) \.\. "\\n"\)/);
    assert.match(BRIDGE_SOURCE, /next_heartbeat_at = monotonic_time\(\) \+ HEARTBEAT_INTERVAL_SECONDS/);
    assert.match(BRIDGE_SOURCE, /reaper\.defer\(bridge_loop\)/);
    assert.match(BRIDGE_SOURCE, /spawned_reaper = false/);
    assert.match(BRIDGE_SOURCE, /D12_TRANSPORT_FIXED_ACTION_IDS = \{/);
    assert.match(BRIDGE_SOURCE, /play = 1007/);
    assert.match(BRIDGE_SOURCE, /pause = 1008/);
    assert.match(BRIDGE_SOURCE, /record = 1013/);
    assert.match(BRIDGE_SOURCE, /stop = 1016/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);

    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(?:Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /open -a/);
  });

  it("keeps the heartbeat sidecar bounded to internal transport liveness metadata", () => {
    const transportSource = readFileSync(
      new URL("../../reaper/bridge/src/10-file-transport.lua", import.meta.url),
      "utf8",
    );
    const heartbeatMatch = transportSource.match(/local heartbeat = \{([\s\S]*?)\n  \}/);
    assert.ok(heartbeatMatch, "heartbeat table must remain explicit and bounded");
    const heartbeatTable = heartbeatMatch[1];
    const fields = [...heartbeatTable.matchAll(/^    ([a-z_]+)\s*=/gm)].map((match) => match[1]).sort();
    assert.deepEqual(fields, [
      "active_generation",
      "active_owner",
      "contract",
      "interval_ms",
      "refreshed_at_unix_s",
      "sequence",
    ]);
    assert.doesNotMatch(heartbeatTable, /project|refs|media|path|payload|params|request|result/i);

    const loopSource = readFileSync(
      new URL("../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url),
      "utf8",
    );
    assert.match(loopSource, /local heartbeat_ok, heartbeat_error = write_bridge_heartbeat\(\)[\s\S]*next_heartbeat_at = monotonic_time\(\) \+ HEARTBEAT_INTERVAL_SECONDS[\s\S]*bridge_loop\(\)/);
    assert.match(loopSource, /if current_time >= next_heartbeat_at then[\s\S]*write_bridge_heartbeat\(\)[\s\S]*if current_time >= next_poll_at then/);
    assert.match(loopSource, /reaper\.EnumerateFiles\(REQUESTS_DIR, index\)/);
    assert.match(loopSource, /reaper\.defer\(bridge_loop\)/);
  });

  it("keeps the approved Wave 0, Wave 1A, Read-B, D9 tracks mixer, D10 read overview/actions, D13 items core reads, E3 media, E5 routing/automation, and E2-FX-L1 read query operations exact", () => {
    const operationKeys = [...new Set([...BRIDGE_SOURCE.matchAll(/\["query_state:([^"]+)"\]\s*=/g)]
      .map((match) => match[1]))]
      .sort();

    assert.deepEqual(operationKeys, [
      "actions.parse_marker_action_text",
      "actions.read_action_metadata",
      "actions.read_action_shortcuts",
      "actions.read_action_toggle_state",
      "actions.read_custom_action_metadata",
      "actions.read_cycle_action_metadata",
      "actions.resolve_named_command",
      "actions.search_action_commands",
      "automation.evaluate_envelope_at_time",
      "automation.project_envelopes.list",
      "automation.read_automation_items",
      "automation.read_envelope_points",
      "automation.read_envelope_summary",
      "automation.read_track_automation_mode",
      "automation.resolve_envelope_ref",
      "automation.resolve_send_envelope",
      "fx.installed.search",
      "fx.list_parameters",
      "fx.list_take_chain",
      "fx.list_track_chain",
      "fx.parameter_to_envelope_mapping",
      "fx.read_parameter",
      "fx.read_summary",
      "fx.read_video_processor_code",
      "fx.resolve_ref",
      "items.list_items_on_track",
      "items.list_selected_items",
      "items.read_item_summary",
      "items.resolve_item_ref",
      "last_result.read",
      "media.file.probe",
      "media.folder_media.list",
      "media.project_files.read",
      "media.take_source.read",
      "midi.list_take_cc_events",
      "midi.list_take_notes",
      "midi.list_take_text_sysex_events",
      "midi.read_take_event_counts",
      "midi.read_take_grid",
      "midi.resolve_midi_take_ref",
      "openreaper.read_status",
      "project.list_markers_regions",
      "project.read_current_project_path",
      "project.read_dirty_state",
      "project.read_metadata",
      "project.read_summary",
      "project.read_tempo_map",
      "project.read_track_item_overview",
      "render.bounds.resolve",
      "render.region_matrix.read",
      "render.settings.read",
      "render.targets.preview",
      "routing.fx_pin_mapping.read",
      "routing.audio_outputs.list",
      "routing.project_graph.read",
      "routing.send.resolve_ref",
      "routing.track_hardware_outputs.list",
      "routing.track.read",
      "system.api_symbols.check",
      "system.resource_paths.read",
      "system.runtime_environment.read",
      "template_catalog.read_summary",
      "track.resolve_ref",
      "tracks.list_tracks",
      "tracks.read_folder_structure",
      "tracks.read_mixer_controls",
      "transport.read_state",
    ].sort());

    assert.deepEqual(CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS, [
      "template.project.read_summary",
      "template.transport.read_state",
      "template.core.read_openreaper_status",
      "template.system.read_runtime_environment",
      "template.system.read_resource_paths",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS, [
      "template.core.read_template_catalog_summary",
      "template.core.read_last_result",
      "template.system.check_api_symbols",
      "template.project.read_metadata",
      "template.project.list_markers_regions",
      "template.project.read_tempo_map",
      "template.tracks.resolve_track_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS, [
      "template.actions.resolve_named_command",
      "template.actions.read_action_metadata",
      "template.actions.read_action_toggle_state",
      "template.actions.read_action_shortcuts",
      "template.actions.parse_marker_action_text",
      "template.actions.search_action_commands",
      "template.midi.resolve_midi_take_ref",
      "template.midi.read_take_event_counts",
      "template.midi.list_take_notes",
      "template.midi.list_take_cc_events",
      "template.midi.list_take_text_sysex_events",
      "template.midi.read_take_grid",
      "template.media.probe_file",
      "template.media.read_take_source",
      "template.media.read_project_media_files",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS, [
      "template.tracks.list_tracks",
      "template.tracks.read_mixer_controls",
      "template.tracks.read_folder_structure",
      "template.tracks.set_record_arm",
      "template.tracks.set_volume",
      "template.tracks.set_pan",
      "template.tracks.set_width",
    ]);
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS, [
      "template.project.read_track_item_overview",
      "template.actions.read_custom_action_metadata",
      "template.actions.read_cycle_action_metadata",
    ]);
  });

  it("keeps malformed, owner mismatch, generation mismatch, and unsupported-operation paths typed", () => {
    for (const code of [
      "REQUEST_INVALID",
      "OPERATION_NOT_FOUND",
      "BRIDGE_OWNER_MISMATCH",
      "BRIDGE_GENERATION_MISMATCH",
      "INTERNAL_ERROR",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`"${code}"`), code);
    }

    assert.match(BRIDGE_SOURCE, /request\.bridge\.expected_owner ~= ACTIVE_OWNER/);
    assert.match(BRIDGE_SOURCE, /request\.bridge\.expected_generation ~= ACTIVE_GENERATION/);
    assert.match(BRIDGE_SOURCE, /approved scoped live-smoke operations/);
    assert.match(BRIDGE_SOURCE, /Bridge request JSON is malformed/);
  });

  it("emits the required foundation.bridge.v1 result envelope fields", () => {
    for (const field of [
      "contract",
      "id",
      "ok",
      "completed_at",
      "bridge",
      "queue",
      "result",
      "summary",
      "refs",
      "artifacts",
      "jobs",
      "last_result",
      "undo",
      "verification",
      "budget",
      "response_bytes",
      "truncated",
      "idempotency",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`${field}\\s*=`), field);
    }

    const fixture = {
      contract: "foundation.bridge.v1",
      id: "cmd_20260703000000000_001_fixture",
      ok: true,
      completed_at: "2026-07-03T00:00:00Z",
      bridge: {
        owner: "openreaper-live-smoke",
        generation: 1,
      },
      queue: {
        state: "done",
        started_at: "2026-07-03T00:00:00Z",
        completed_at: "2026-07-03T00:00:00Z",
      },
      result: {
        summary: { kind: "fixture" },
        refs: [],
        artifacts: [],
        jobs: [],
        last_result: {
          updated: false,
          refs: [],
          truncated: false,
        },
      },
      undo: {
        mode: "none",
        opened: false,
        closed: false,
        label: null,
      },
      verification: {
        mode: "none",
        status: "passed",
        checks: [],
      },
      budget: {
        max_response_bytes: 65536,
        response_bytes: 0,
        truncated: false,
      },
      idempotency: {
        key: null,
        replayed: false,
      },
    };
    fixture.budget.response_bytes = Buffer.byteLength(JSON.stringify(fixture), "utf8");
    assert.equal(validateFoundationBridgeResult(fixture), true);
  });

  it("keeps configured empty transport as a clear blocker without starting REAPER", async () => {
    const emptyTransport = await mkdtemp(join(tmpdir(), "openreaper-layer4d2-empty-"));
    const configured = createLiveBridgeExecutorFromEnv({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: emptyTransport,
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "20",
    });
    assert.equal(configured.configured, true);
    assert.equal(configured.spawned_reaper, false);

    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: configured.executor,
        executor_config: configured.config,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
      },
    });
    const response = await runtime.call_template({
      id: "template.project.read_summary",
      input: {},
      refs: [],
      context: context(),
    });

    assert.equal(response.ok, false);
    assert.equal(response.error.source, "bridge");
    assert.equal(response.error.code, "BRIDGE_NOT_RUNNING");
    assert.equal(response.error.details.blocker, "live_bridge_transport_absent");
    assert.equal(response.error.details.spawned_reaper, false);
    assert.equal(response.error.details.missing, "requests_dir");
  });
});

const FILE_TRANSPORT_LOOP_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url),
  "utf8",
);

const FILE_TRANSPORT_LOOP_PRELUDE = String.raw`
TRANSPORT_DIR = "/transport"
REQUESTS_DIR = "/requests"
RESULTS_DIR = "/results"
CLAIMS_DIR = "/claims"
POLL_INTERVAL_SECONDS = 0.10
HEARTBEAT_INTERVAL_SECONDS = 0.50
ACTIVE_OWNER = "test-owner"
ACTIVE_GENERATION = 1
files = {}
requests = {}
results = {}
writes = {}
write_failures = {}
file_exists_calls = {}
read_calls = {}
dispatch_calls = {}
dispatch_count = 0
logs = {}
now = 0
deferred_callback = nil

function path_join(base, child) return base .. "/" .. child end
function result_id_from_filename(filename) return string.gsub(filename, "%.json$", "") end
function is_request_id(value) return type(value) == "string" and #value > 0 end
function bounded_string(value) return tostring(value) end
function is_object(value) return type(value) == "table" end
function ensure_directory() return true end
function write_bridge_heartbeat() return true end
function log(message) logs[#logs + 1] = message end
function file_exists(path)
  file_exists_calls[path] = (file_exists_calls[path] or 0) + 1
  return results[path] == true or requests[path] ~= nil
end
function read_file(path)
  read_calls[path] = (read_calls[path] or 0) + 1
  if requests[path] == nil then return nil, "open_failed" end
  return requests[path]
end
function write_file_atomic(path, content)
  if (write_failures[path] or 0) > 0 then
    write_failures[path] = write_failures[path] - 1
    return false, "fixture_write_failed"
  end
  writes[path] = content
  if string.match(path, "^/claims/") then
    requests[path] = content
  else
    results[path] = true
  end
  return true
end
function bridge_error_envelope(request, code, message, options)
  local recoverable = not (options and options.recoverable == false)
  local reason = options and options.details and options.details.reason or "fixture_error"
  return '{"ok":false,"recoverable":' .. tostring(recoverable) .. ',"reason":"' .. reason .. '"}'
end
function dispatch_request(request)
  dispatch_count = dispatch_count + 1
  dispatch_calls[request.id] = (dispatch_calls[request.id] or 0) + 1
  return '{"ok":true,"id":"' .. request.id .. '"}'
end

json = { decode = function(value) return value end }
reaper = {
  EnumerateFiles = function(directory, index)
    if directory == REQUESTS_DIR then return files[index + 1] end
    if directory == CLAIMS_DIR then
      local names = {}
      for path in pairs(requests) do
        local name = string.match(path, "^/claims/(.+)$")
        if name then names[#names + 1] = name end
      end
      table.sort(names)
      return names[index + 1]
    end
    return nil
  end,
  time_precise = function() return now end,
  defer = function(callback) deferred_callback = callback end,
}
os.remove = function(path)
  requests[path] = nil
  return true
end
function run_poll(at)
  now = at
  assert(type(deferred_callback) == "function")
  local callback = deferred_callback
  deferred_callback = nil
  callback()
end
`;

function runFileTransportLoopLua(body, setup = "") {
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const source = `${FILE_TRANSPORT_LOOP_PRELUDE}\n${setup}\n${FILE_TRANSPORT_LOOP_SOURCE}\n${body}\nreturn true`;
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

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "openreaper-live-smoke",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
