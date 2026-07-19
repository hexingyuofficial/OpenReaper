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
      /template_count = 235/,
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
    assert.match(sourceModules["90-file-transport-loop.lua"], /active_continuation_runner/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /openreaper\.bridge\.internal_continuation\.v1/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /BRIDGE_INTERNAL_CONTINUATION_CONTRACT/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /is_bridge_internal_continuation/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /resume_continuation/);
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

  it("keeps one continuation runner active, leaves later FIFO requests waiting, and never redispatches mutation across ticks", () => {
    runFileTransportLoopLua(String.raw`
files = { "first.json", "second.json" }
requests["/requests/first.json"] = { id = "first", timeout_ms = 5000, params = {} }
requests["/requests/second.json"] = { id = "second", timeout_ms = 5000, params = {} }
continuation_once["first"] = true

run_poll(0.11)
assert(dispatch_calls.first == 1)
assert(dispatch_calls.second == nil)
assert(results["/results/first.json"] == nil)
assert(requests["/claims/first.json"] ~= nil)
assert(results["/results/second.json"] == nil)
assert(requests["/claims/second.json"] == nil)
assert((resume_calls.first or 0) == 0)

run_poll(0.22)
assert(dispatch_calls.first == 2)
assert((resume_calls.first or 0) == 1)
assert(results["/results/first.json"] == true)
assert(requests["/claims/first.json"] == nil)
assert(dispatch_calls.second == 1)
assert(results["/results/second.json"] == true)

run_poll(0.33)
assert(dispatch_calls.first == 2)
assert(dispatch_calls.second == 1)
`);
  });

  it("retries only already-serialized terminal result bytes after a write failure during continuation completion", () => {
    runFileTransportLoopLua(String.raw`
files = { "cont-retry.json" }
requests["/requests/cont-retry.json"] = { id = "cont-retry", timeout_ms = 5000, params = {} }
continuation_once["cont-retry"] = true
write_failures["/results/cont-retry.json"] = 1

run_poll(0.11)
assert(dispatch_calls["cont-retry"] == 1)
assert(results["/results/cont-retry.json"] == nil)
assert(requests["/claims/cont-retry.json"] ~= nil)

run_poll(0.22)
assert(dispatch_calls["cont-retry"] == 2)
assert(results["/results/cont-retry.json"] == nil)
assert(requests["/claims/cont-retry.json"] ~= nil)

run_poll(0.33)
assert(dispatch_calls["cont-retry"] == 2)
assert(results["/results/cont-retry.json"] == true)
assert(requests["/claims/cont-retry.json"] == nil)
`);
  });

  it("sorts reversed enumeration deterministically and keeps the second request unclaimed until the first terminals", () => {
    runFileTransportLoopLua(String.raw`
files = { "z-second.json", "a-first.json" }
requests["/requests/z-second.json"] = { id = "z-second", timeout_ms = 5000, params = {} }
requests["/requests/a-first.json"] = { id = "a-first", timeout_ms = 5000, params = {} }
continuation_once["a-first"] = true

run_poll(0.11)
assert(dispatch_calls["a-first"] == 1)
assert(dispatch_calls["z-second"] == nil)
assert(requests["/claims/a-first.json"] ~= nil)
assert(requests["/claims/z-second.json"] == nil)

run_poll(0.22)
assert(dispatch_calls["a-first"] == 2)
assert(results["/results/a-first.json"] == true)
assert(dispatch_calls["z-second"] == 1)
assert(results["/results/z-second.json"] == true)
`);
  });

  it("fails closed on malformed continuation and non-terminal dispatch after mutation risk", () => {
    runFileTransportLoopLua(String.raw`
files = { "bad-cont.json" }
requests["/requests/bad-cont.json"] = { id = "bad-cont", timeout_ms = 5000, params = {} }
function dispatch_request(request, fallback_id, resume_continuation, runtime)
  dispatch_count = dispatch_count + 1
  dispatch_calls[request.id] = (dispatch_calls[request.id] or 0) + 1
  if not resume_continuation then
    return {
      contract = "openreaper.bridge.internal_continuation.v1",
      phase = "fixture.verify",
      state = { id = request.id },
      mutations_may_have_happened = true,
      next_phase_may_mutate = false,
      started_at = runtime and runtime.started_at or now_iso(),
    }
  end
  return {
    contract = "openreaper.bridge.internal_continuation.v1",
    phase = "fixture.broken",
    -- missing state/next_phase_may_mutate
    mutations_may_have_happened = true,
  }
end
run_poll(0.11)
run_poll(0.22)
assert(results["/results/bad-cont.json"] == true)
assert(string.find(writes["/results/bad-cont.json"], "malformed_internal_continuation", 1, true) ~= nil)
assert(string.find(writes["/results/bad-cont.json"], '"recoverable":false', 1, true) ~= nil)
assert(string.find(writes["/results/bad-cont.json"], '"outcome":"unknown"', 1, true) ~= nil)
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
      "project.list_open_projects",
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
function now_iso() return "2026-07-19T00:00:00.000Z" end
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
  local outcome = options and options.details and options.details.outcome
  local queue_state = options and options.queue_state or "failed"
  local parts = {
    '"ok":false',
    '"recoverable":' .. tostring(recoverable),
    '"code":"' .. tostring(code) .. '"',
    '"reason":"' .. reason .. '"',
    '"queue_state":"' .. tostring(queue_state) .. '"',
  }
  if outcome then
    parts[#parts + 1] = '"outcome":"' .. tostring(outcome) .. '"'
  end
  return "{" .. table.concat(parts, ",") .. "}"
end
continuation_once = {}
resume_calls = {}
function dispatch_request(request, fallback_id, resume_continuation, runtime)
  dispatch_count = dispatch_count + 1
  dispatch_calls[request.id] = (dispatch_calls[request.id] or 0) + 1
  if resume_continuation then
    resume_calls[request.id] = (resume_calls[request.id] or 0) + 1
    return '{"ok":true,"id":"' .. request.id .. '","resumed":true}'
  end
  if continuation_once[request.id] then
    continuation_once[request.id] = false
    return {
      contract = "openreaper.bridge.internal_continuation.v1",
      phase = "fixture.verify",
      state = { id = request.id },
      mutations_may_have_happened = true,
      next_phase_may_mutate = false,
      started_at = runtime and runtime.started_at or now_iso(),
    }
  end
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


function extractProductLua(source, startMarker, endMarkerExclusive) {
  const start = source.indexOf(startMarker);
  if (start < 0) throw new Error(`missing product marker: ${startMarker}`);
  if (!endMarkerExclusive) return source.slice(start);
  const end = source.indexOf(endMarkerExclusive, start + startMarker.length);
  if (end < 0) throw new Error(`missing product end marker: ${endMarkerExclusive}`);
  return source.slice(start, end);
}

function loadActualProductD30CompositionSources() {
  const policySource = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
  const loopSource = readFileSync(new URL("../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url), "utf8");
  const d30Source = readFileSync(
    new URL("../../reaper/bridge/src/handlers/project/d30_project_container_route.lua", import.meta.url),
    "utf8",
  );
  // Product required_undo_capability depends on D30 capability table + container capability + full template_execute_write_capability.
  // For D30-only composition we extract the real D30 capability path and real required_undo_capability definition text.
  const d30Caps = extractProductLua(
    policySource,
    "local D30_PROJECT_CONTAINER_CAPABILITIES = {",
    "\nlocal ALPHA3_2C3BC_PROJECT_FILE_SAVE_CAPABILITIES = {",
  );
  const d30CapFn = extractProductLua(
    policySource,
    "local function d30_project_container_capability(request, operation_key)",
    "\nlocal function d28_small_write_capability(request, operation_key)",
  );
  // Real required_undo_capability body from product (uses template_execute_write_capability).
  // Provide a product-faithful template_execute_write_capability that only delegates to the extracted d30_project_container_capability
  // AFTER asserting the product function text contains the D30 branch.
  const requiredUndoFn = extractProductLua(
    policySource,
    "local function required_undo_capability(request, operation_key)",
    "\nlocal function clear_required_undo_project_handle(request)",
  );
  const undoOpenClose = extractProductLua(
    policySource,
    "local function clear_required_undo_project_handle(request)",
    "\nlocal function validate_request(request)",
  );
  const d30Handlers = extractProductLua(
    routeSource,
    "local D30_PROJECT_CONTAINER_HANDLERS = {",
    "\nlocal ALPHA3_2C3BC_PROJECT_FILE_SAVE_HANDLERS = {",
  );
  const dispatchTemplate = extractProductLua(
    routeSource,
    "local function dispatch_template_execute(request, resume_continuation)",
    "\nlocal ALLOWED_OPERATIONS = {",
  );
  const allowedOps = extractProductLua(
    routeSource,
    "local ALLOWED_OPERATIONS = {",
    "\nlocal BRIDGE_INTERNAL_CONTINUATION_CONTRACT = ",
  );
  const dispatchRequest = extractProductLua(
    routeSource,
    'local BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"',
    null,
  );
  // Marker proofs that extracted text is product source
  assert.match(requiredUndoFn, /template_execute_write_capability/);
  assert.match(dispatchTemplate, /D30_PROJECT_CONTAINER_HANDLERS/);
  assert.match(d30Handlers, /\["project\.create_subproject"\] = create_subproject/);
  assert.match(d30Handlers, /\["project\.render_or_update_subproject"\] = render_or_update_subproject/);
  assert.match(allowedOps, /\["run_command:template\.execute"\]/);
  assert.match(allowedOps, /handler = dispatch_template_execute/);
  assert.match(dispatchRequest, /function dispatch_request/);
  assert.match(d30Source, /function create_subproject/);
  assert.match(d30Source, /function render_or_update_subproject/);
  assert.ok(loopSource.includes("process_request_file") || loopSource.includes("dispatch_request"));

  // template_execute_write_capability product text includes many handlers; for composition we bind the real function
  // by extracting the real function and stubbing missing capability helpers to return nil (product behavior for non-matching).
  const templateWrite = extractProductLua(
    policySource,
    "local function template_execute_write_capability(request, operation_key)",
    "\nlocal function required_undo_capability(request, operation_key)",
  );
  // Stubs for other capability helpers referenced by product template_execute_write_capability (return nil = not this capability).
  const nilCapHelpers = `
local function safe_write_a_capability() return nil end
local function e3_media_route_capability() return nil end
local function e4_item_route_capability() return nil end
local function e5_routing_write_capability() return nil end
local function e5_automation_write_capability() return nil end
local function e2_fx_b1_write_capability() return nil end
local function d6_project_tempo_write_capability() return nil end
local function d9_tracks_mixer_write_capability() return nil end
local function d11_project_marker_region_capability() return nil end
local function d13_items_core_write_capability() return nil end
local function d14_items_delete_capability() return nil end
local function d15_items_source_phase_capability() return nil end
local function d16_tracks_org_capability() return nil end
local function d17_midi_edit_capability() return nil end
local function d22_render_settings_write_capability() return nil end
local function d28_small_write_capability() return nil end
local function d29_render_settings_write_capability() return nil end
local function alpha3_2c3bc_project_file_save_capability() return nil end
`;
  // dispatch_template_execute product text references many handler tables; provide empty tables so only D30 mapping resolves.
  const emptyHandlerTables = `
local SAFE_WRITE_A_HANDLERS = {}
local E3_MEDIA_ROUTE_HANDLERS = {}
local E4_ITEM_ROUTE_HANDLERS = {}
local E5_ROUTING_WRITE_HANDLERS = {}
local E5_AUTOMATION_WRITE_HANDLERS = {}
local E2_FX_B1_WRITE_HANDLERS = {}
local D6_PROJECT_TEMPO_WRITE_HANDLERS = {}
local D9_TRACKS_MIXER_WRITE_HANDLERS = {}
local D11_PROJECT_MARKER_REGION_HANDLERS = {}
local D12_TRANSPORT_SAFE_HANDLERS = {}
local D13_ITEMS_CORE_WRITE_HANDLERS = {}
local D14_ITEMS_DELETE_HANDLERS = {}
local D15_ITEMS_SOURCE_PHASE_HANDLERS = {}
local D16_TRACKS_ORG_HANDLERS = {}
local D17_MIDI_EDIT_HANDLERS = {}
local D22_RENDER_SETTINGS_WRITE_HANDLERS = {}
local D28_SMALL_WRITE_HANDLERS = {}
local D29_RENDER_SETTINGS_WRITE_HANDLERS = {}
local ALPHA3_2C3BC_PROJECT_FILE_SAVE_HANDLERS = {}
local function handler_error(code, message, details)
  return nil, { code = code, message = message, details = details or {}, recoverable = true }
end
local function set_render_sample_rate() error("unexpected non-D30 handler") end
local function set_render_format() error("unexpected non-D30 handler") end
local function d31_render_targets() error("unexpected non-D30 handler") end
local function create_delivery_report() error("unexpected non-D30 handler") end
local function create_layer_report() error("unexpected non-D30 handler") end
`;

  let productLua = [
      d30Caps,
      d30CapFn,
      nilCapHelpers,
      templateWrite,
      requiredUndoFn,
      undoOpenClose,
      emptyHandlerTables,
      d30Source,
      d30Handlers,
      dispatchTemplate,
      allowedOps,
      dispatchRequest,
    ].join("\n");
  // Keep product text exact except hoist entry points so the harness body can call them.
  // Upvalues among product locals remain valid within the same chunk.
  for (const name of [
    "required_undo_capability",
    "open_required_undo_block",
    "close_required_undo_block",
    "dispatch_template_execute",
    "dispatch_request",
    "create_subproject",
    "render_or_update_subproject",
  ]) {
    productLua = productLua.replaceAll(`local function ${name}`, `function ${name}`);
  }
  productLua = productLua.replace("local ALLOWED_OPERATIONS = {", "ALLOWED_OPERATIONS = {");
  productLua = productLua.replace("local D30_PROJECT_CONTAINER_HANDLERS = {", "D30_PROJECT_CONTAINER_HANDLERS = {");
  productLua = productLua.replace(
    'local BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"',
    'BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"',
  );
  return {
    policySource,
    routeSource,
    loopSource,
    d30Source,
    productLua,
    markers: {
      requiredUndoFn,
      dispatchTemplate,
      d30Handlers,
      allowedOps,
      d30Source,
    },
  };
}

function runActualProductD30CompositionLua(body, { withTransport = false } = {}) {
  const sources = loadActualProductD30CompositionSources();
  const env = String.raw`
ACTIVE_OWNER = "test-owner"
ACTIVE_GENERATION = 1
TRANSPORT_DIR = "/transport"
REQUESTS_DIR = "/requests"
RESULTS_DIR = "/results"
CLAIMS_DIR = "/claims"
POLL_INTERVAL_SECONDS = 0.10
HEARTBEAT_INTERVAL_SECONDS = 0.50
files = {}
requests = {}
results = {}
writes = {}
write_failures = {}
file_exists_calls = {}
read_calls = {}
logs = {}
now = 0
deferred_callback = nil
undo_begins = {}
undo_ends = {}
open_undo_handle = nil
shared_events = {}
guard_failures = {}
force_undo_end_fail = false
request_objects = {}
parent_project = { path = "/session/Parent.RPP", items = {}, tracks = {}, time_start = 3, time_end = 7 }
child_project = nil
current_project = parent_project
projects = { parent_project }
project_ext = {}
calls = { actions = {}, select_project = 0, save = 0, ledger = 0, time_selection_set = 0 }

function record_shared_event(kind, project, detail)
  shared_events[#shared_events + 1] = {
    kind = kind,
    project = project,
    detail = detail,
  }
end

function push_guard_failure(message)
  guard_failures[#guard_failures + 1] = message
  error(message)
end

function require_open_undo_for_mutation(mutation_name, expected_project)
  if open_undo_handle == nil then
    push_guard_failure(mutation_name .. ": mutation without open Undo block")
  end
  if expected_project ~= nil and open_undo_handle ~= expected_project then
    push_guard_failure(mutation_name .. ": mutation under wrong Undo handle")
  end
end

function path_join(base, child) return base .. "/" .. child end
function result_id_from_filename(filename) return string.gsub(filename, "%.json$", "") end
function is_request_id(value) return type(value) == "string" and #value > 0 end
function bounded_string(value, max_length)
  local text = tostring(value or "")
  local limit = max_length or 240
  if #text <= limit then return text end
  return text:sub(1, limit)
end
function is_object(value) return type(value) == "table" end
function is_string(value) return type(value) == "string" and value:match("%S") ~= nil end
function is_json_array(value) return type(value) == "table" end
function is_non_negative_integer(value)
  return type(value) == "number" and value >= 0 and value == math.floor(value)
end
function json_array(value) return value or {} end
function first_number(...) for i=1,select("#",...) do local v=select(i,...); if type(v)=="number" then return v end end end
function first_string(...) for i=1,select("#",...) do local v=select(i,...); if type(v)=="string" then return v end end end
function artifact_id_from_request(request) return request.id end
function ensure_directory() return true end
function write_bridge_heartbeat() return true end
function now_iso() return "2026-07-19T00:00:00.000Z" end
function log(message) logs[#logs + 1] = tostring(message) end
function file_exists(path)
  file_exists_calls[path] = (file_exists_calls[path] or 0) + 1
  return files[path] == true or results[path] == true or requests[path] ~= nil
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
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function validate_request(request) return true end
function bridge_error_envelope(request, code, message, options)
  options = options or {}
  return json.encode({
    ok = false,
    code = code,
    message = message,
    recoverable = options.recoverable ~= false,
    queue_state = options.queue_state or "failed",
    details = options.details or {},
    undo = {
      opened = request and request.__openreaper_undo_opened == true,
      closed = request and request.__openreaper_undo_closed == true,
    },
  })
end
function bridge_ok_envelope(request, started_at, summary, artifacts, jobs, refs)
  return json.encode({
    ok = true,
    id = request.id,
    summary = summary or {},
    undo = {
      opened = request.__openreaper_undo_opened == true,
      closed = request.__openreaper_undo_closed == true,
    },
  })
end
json = {
  encode = function(value)
    if type(value) ~= "table" then return tostring(value) end
    local function enc(v)
      if v == nil then return "null" end
      local t = type(v)
      if t == "string" then return string.format("%q", v) end
      if t == "number" or t == "boolean" then return tostring(v) end
      if t ~= "table" then return "null" end
      if #v > 0 then
        local items = {}
        for i = 1, #v do items[i] = enc(v[i]) end
        return "[" .. table.concat(items, ",") .. "]"
      end
      local keys = {}
      for k in pairs(v) do if type(k) == "string" then keys[#keys + 1] = k end end
      table.sort(keys)
      local items = {}
      for _, k in ipairs(keys) do items[#items + 1] = string.format("%q", k) .. ":" .. enc(v[k]) end
      return "{" .. table.concat(items, ",") .. "}"
    end
    return enc(value)
  end,
  decode = function(value)
    if type(value) == "table" then return value end
    if type(value) ~= "string" then return value end
    local id = value:match('"id"%s*:%s*"([^"]+)"')
    if id and request_objects[id] then return request_objects[id] end
    return request_objects[id or ""]
  end,
}
files["/session/Parent.RPP"] = true
reaper = {}
reaper.EnumProjects = function(index)
  if index == -1 then return current_project, current_project.path or "" end
  local project = projects[index + 1]
  if not project then return nil, "" end
  return project, project.path or ""
end
reaper.Undo_BeginBlock2 = function(project)
  if open_undo_handle ~= nil then
    push_guard_failure("Undo_BeginBlock2: nested or already-open Undo block")
  end
  open_undo_handle = project
  undo_begins[#undo_begins + 1] = project
  record_shared_event("undo_begin", project)
end
reaper.Undo_EndBlock2 = function(project)
  if open_undo_handle == nil then
    push_guard_failure("Undo_EndBlock2: no open Undo block")
  end
  if open_undo_handle ~= project then
    push_guard_failure("Undo_EndBlock2: handle mismatch with open Undo block")
  end
  undo_ends[#undo_ends + 1] = project
  record_shared_event("undo_end", project)
  open_undo_handle = nil
  if force_undo_end_fail then return false end
end
pending_new_tab = nil
pending_select = nil
reaper.Main_OnCommandEx = function(action, flag, project)
  if action == 41929 then
    -- New-tab action is project-global; exact Undo handle must still be open.
    require_open_undo_for_mutation("Main_OnCommandEx:41929", nil)
    calls.actions[action] = (calls.actions[action] or 0) + 1
    record_shared_event("action_41929", open_undo_handle)
    -- Schedule only; materialize/activate on the next simulated tick.
    pending_new_tab = { path = "", tracks = {}, items = {}, time_start = 0, time_end = 0 }
    return nil
  end
  if action == 42332 then
    require_open_undo_for_mutation("Main_OnCommandEx:42332", project)
    calls.actions[action] = (calls.actions[action] or 0) + 1
    record_shared_event("action_42332", project)
    files[project.path .. "-PROX"] = true
    return nil
  end
  calls.actions[action] = (calls.actions[action] or 0) + 1
  return nil
end
reaper.Main_SaveProjectEx = function(project, path, options)
  require_open_undo_for_mutation("Main_SaveProjectEx", project)
  calls.save = calls.save + 1
  record_shared_event("save", project, path)
  project.path = path
  files[path] = true
  return true
end
reaper.SelectProjectInstance = function(project)
  -- Selection mutation is bracketed by the pre-selection exact Undo handle,
  -- which may differ from the project being selected (restore path).
  require_open_undo_for_mutation("SelectProjectInstance", nil)
  calls.select_project = calls.select_project + 1
  record_shared_event("select_project", open_undo_handle, project)
  -- Schedule only; apply on the next simulated tick.
  pending_select = project
end
function apply_pending_reaper_effects()
  if pending_new_tab then
    child_project = pending_new_tab
    projects[#projects + 1] = child_project
    current_project = child_project
    pending_new_tab = nil
  end
  if pending_select then
    current_project = pending_select
    pending_select = nil
  end
end
reaper.SetProjExtState = function(project, section, key, value)
  require_open_undo_for_mutation("SetProjExtState", project)
  calls.ledger = calls.ledger + 1
  record_shared_event("ledger", project, key)
  project_ext[tostring(project) .. "|" .. tostring(section) .. "|" .. tostring(key)] = value
  return true
end
reaper.GetProjExtState = function(project, section, key)
  local v = project_ext[tostring(project) .. "|" .. tostring(section) .. "|" .. tostring(key)]
  if v == nil then return 0, "" end
  return 1, v
end
reaper.GetSet_LoopTimeRange2 = function(project, is_set, is_loop, start_time, end_time)
  if is_set then
    require_open_undo_for_mutation("GetSet_LoopTimeRange2:set", project)
    calls.time_selection_set = (calls.time_selection_set or 0) + 1
    record_shared_event("time_selection_set", project)
    project.time_start = start_time
    project.time_end = end_time
  end
  return project.time_start, project.time_end
end
reaper.IsProjectDirty = function() return 0 end
reaper.CountTracks = function(project) return #(project.tracks or {}) end
reaper.GetTrack = function(project, index) return (project.tracks or {})[index + 1] end
function run_poll(at)
  now = at
  assert(type(deferred_callback) == "function")
  local callback = deferred_callback
  deferred_callback = nil
  callback()
  -- Pending tab/selection apply only between dispatch callbacks.
  apply_pending_reaper_effects()
end
function make_d30_request(id, capability, params, refs)
  local req = {
    id = id,
    timeout_ms = 5000,
    bridge = { expected_owner = ACTIVE_OWNER, expected_generation = ACTIVE_GENERATION },
    operation = { family = "run_command", name = "template.execute" },
    pack = { id = "project", capability = capability, risk = "write" },
    params = params or {},
    refs = refs or {},
    undo = { mode = "required", label = "OpenReaper D30 composition" },
  }
  request_objects[id] = req
  return req
end
`;

  const transportPrelude = withTransport
    ? `
reaper.EnumerateFiles = function(directory, index)
  if directory == REQUESTS_DIR then return files_list and files_list[index + 1] end
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
end
reaper.time_precise = function() return now end
reaper.defer = function(callback) deferred_callback = callback end
os.remove = function(path) requests[path] = nil return true end
files_list = {}
`
    : "";

  const full =
    env +
    "\n" +
    transportPrelude +
    "\n" +
    sources.productLua +
    "\n" +
    (withTransport ? sources.loopSource + "\n" : "") +
    body +
    "\nreturn true";

  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(full));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
  return sources.markers;
}

describe("Alpha3.4-D3 actual product D30 composition proof", () => {
  it("loads product required_undo_capability, D30 mapping, dispatch and proves create+render", () => {
    const markers = runActualProductD30CompositionLua(String.raw`
function dispatch_to_terminal(request)
  local cont = nil
  local last = nil
  for i = 1, 24 do
    if i > 1 then
      apply_pending_reaper_effects()
    end
    local runtime = { started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now }
    last = dispatch_request(request, request.id, cont, runtime)
    if type(last) == "table" and last.contract == "openreaper.bridge.internal_continuation.v1" then
      cont = last
      now = now + 0.1
    else
      return last, cont
    end
  end
  error("continuation did not terminal")
end

-- Same-tick verification cannot observe a scheduled new tab.
local pre_create = make_d30_request("req_create_pre", "project.create_subproject", { name = "Dialog Edit" })
local pre_cont = dispatch_request(pre_create, pre_create.id, nil, { started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now })
assert(type(pre_cont) == "table" and pre_cont.phase == "create_subproject.mutate_create")
assert(calls.actions[41929] == nil)
assert(child_project == nil)
local mid = dispatch_request(pre_create, pre_create.id, pre_cont, { started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now })
assert(type(mid) == "table" and mid.phase == "create_subproject.verify_created")
assert(calls.actions[41929] == 1)
assert(child_project == nil)
assert(pending_new_tab ~= nil)
-- Later tick materializes the tab.
apply_pending_reaper_effects()
assert(child_project ~= nil)

-- Full create_subproject through product dispatch_request + product D30 mapping.
parent_project = { path = "/session/Parent.RPP", items = {}, tracks = {}, time_start = 3, time_end = 7 }
child_project = nil
current_project = parent_project
projects = { parent_project }
files = { ["/session/Parent.RPP"] = true }
project_ext = {}
calls = { actions = {}, select_project = 0, save = 0, ledger = 0, time_selection_set = 0 }
undo_begins, undo_ends = {}, {}
open_undo_handle = nil
shared_events = {}
guard_failures = {}
pending_new_tab, pending_select = nil, nil
local key = "run_command:template.execute"
local create_req = make_d30_request("req_create", "project.create_subproject", {
  name = "Dialog Edit",
  activate = true,
  inherit_time_selection = true,
})
assert(required_undo_capability(create_req, key) ~= nil and required_undo_capability(create_req, key) ~= false)
local terminal = select(1, dispatch_to_terminal(create_req))
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, terminal)
assert(files["/session/Dialog_Edit__subproject_req_create.RPP"] == true)
assert(files["/session/Dialog_Edit__subproject_req_create.RPP-PROX"] == true)
assert(current_project == parent_project)
assert(calls.actions[41929] == 1)
assert(calls.actions[42332] == 1)
assert(calls.save == 1)
assert(calls.ledger == 1)
assert(calls.select_project == 1)
assert(calls.time_selection_set == 1)
assert(open_undo_handle == nil, "create terminal must leave no open Undo")
assert(#undo_begins == 4 and #undo_ends == 4, "expected exactly 4 Undo pairs, got " .. tostring(#undo_begins))
assert(undo_begins[1] == parent_project and undo_ends[1] == parent_project)
assert(undo_begins[2] == child_project and undo_ends[2] == child_project)
assert(undo_begins[3] == child_project and undo_ends[3] == child_project)
assert(undo_begins[4] == parent_project and undo_ends[4] == parent_project)
assert(#shared_events == 14, "create shared event count, got " .. tostring(#shared_events))
assert(shared_events[1].kind == "undo_begin" and shared_events[1].project == parent_project)
assert(shared_events[2].kind == "action_41929" and shared_events[2].project == parent_project)
assert(shared_events[3].kind == "undo_end" and shared_events[3].project == parent_project)
assert(shared_events[4].kind == "undo_begin" and shared_events[4].project == child_project)
assert(shared_events[5].kind == "time_selection_set" and shared_events[5].project == child_project)
assert(shared_events[6].kind == "save" and shared_events[6].project == child_project)
assert(shared_events[7].kind == "action_42332" and shared_events[7].project == child_project)
assert(shared_events[8].kind == "undo_end" and shared_events[8].project == child_project)
assert(shared_events[9].kind == "undo_begin" and shared_events[9].project == child_project)
assert(shared_events[10].kind == "select_project" and shared_events[10].project == child_project and shared_events[10].detail == parent_project)
assert(shared_events[11].kind == "undo_end" and shared_events[11].project == child_project)
assert(shared_events[12].kind == "undo_begin" and shared_events[12].project == parent_project)
assert(shared_events[13].kind == "ledger" and shared_events[13].project == parent_project)
assert(shared_events[14].kind == "undo_end" and shared_events[14].project == parent_project)

-- Full render_or_update_subproject through the same product dispatch mapping.
local child_path = "/session/Dialog_Edit__subproject_req_create.RPP"
assert(files[child_path] == true)
current_project = parent_project
if not child_project then error("missing child") end
child_project.path = child_path
local found = false
for _, p in ipairs(projects) do if p == child_project then found = true end end
if not found then projects[#projects + 1] = child_project end
undo_begins, undo_ends = {}, {}
open_undo_handle = nil
shared_events = {}
guard_failures = {}
local before_render = calls.actions[42332] or 0
local before_select = calls.select_project
local before_save = calls.save
local before_ledger = calls.ledger
local before_time_set = calls.time_selection_set or 0
local render_req = make_d30_request("req_render", "project.render_or_update_subproject", { mode = "render" }, {
  { kind = "project", ref = "project:path:" .. child_path, identity = { scheme = "path", value = child_path } },
})
local render_terminal = select(1, dispatch_to_terminal(render_req))
assert(type(render_terminal) == "string", render_terminal)
assert(string.find(render_terminal, '"ok":true', 1, true) ~= nil, render_terminal)
assert((calls.actions[42332] or 0) == before_render + 1)
assert(calls.select_project == before_select)
assert(calls.save == before_save)
assert(calls.ledger == before_ledger)
assert((calls.time_selection_set or 0) == before_time_set)
assert(files[child_path .. "-PROX"] == true)
assert(current_project == parent_project)
assert(open_undo_handle == nil, "render terminal must leave no open Undo")
assert(#undo_begins == 1 and #undo_ends == 1)
assert(undo_begins[1] == child_project and undo_ends[1] == child_project)
assert(#shared_events == 3, "render shared event count, got " .. tostring(#shared_events))
assert(shared_events[1].kind == "undo_begin" and shared_events[1].project == child_project)
assert(shared_events[2].kind == "action_42332" and shared_events[2].project == child_project)
assert(shared_events[3].kind == "undo_end" and shared_events[3].project == child_project)
`);
    assert.match(markers.requiredUndoFn, /template_execute_write_capability/);
    assert.match(markers.dispatchTemplate, /D30_PROJECT_CONTAINER_HANDLERS\[request\.pack\.capability\]/);
    assert.match(markers.allowedOps, /handler = dispatch_template_execute/);
  });

  it("composes one mutation-bearing real D30 continuation through the product file transport runner", () => {
    runActualProductD30CompositionLua(
      String.raw`
files_list = { "timeout.json" }
local req = make_d30_request("timeout", "project.create_subproject", { name = "Dialog Edit" })
req.timeout_ms = 500
requests["/requests/timeout.json"] = json.encode(req)
request_objects["timeout"] = req

-- Poll 1: claim + preflight only (zero mutation).
run_poll(0.11)
assert(results["/results/timeout.json"] == nil)
assert(requests["/claims/timeout.json"] ~= nil)
assert(calls.actions[41929] == nil)
assert(pending_new_tab == nil)

-- Poll 2: mutate_create before deadline; continuation retained complete with state.
-- run_poll applies pending effects after the callback, so the tab is materialised.
run_poll(0.30)
assert(results["/results/timeout.json"] == nil)
assert(requests["/claims/timeout.json"] ~= nil)
assert(calls.actions[41929] == 1)
assert(type(active_continuation_runner) == "table")
local cont = active_continuation_runner.continuation
assert(type(cont) == "table")
assert(cont.contract == "openreaper.bridge.internal_continuation.v1")
assert(cont.phase == "create_subproject.verify_created")
assert(cont.mutations_may_have_happened == true)
assert(cont.next_phase_may_mutate == false)
local st = cont.state
assert(type(st) == "table")
assert(st.parent_project == parent_project)
assert(st.parent_path == "/session/Parent.RPP")
assert(st.name == "Dialog Edit")
assert(type(st.projects_before) == "table")
local parent_in_before = false
for _, inst in ipairs(st.projects_before) do
  if inst.project == parent_project and inst.path == "/session/Parent.RPP" then
    parent_in_before = true
  end
end
assert(parent_in_before == true, "projects_before must retain exact parent instance")
assert(st.child_path == "/session/Dialog_Edit__subproject_timeout.RPP")
assert(st.proxy_path == "/session/Dialog_Edit__subproject_timeout.RPP-PROX")
assert(pending_new_tab == nil)
assert(child_project ~= nil)

-- Poll 3: past deadline; exact non-recoverable timeout truth; no mutation replay.
run_poll(1.50)
assert(results["/results/timeout.json"] == true, writes["/results/timeout.json"])
local body = writes["/results/timeout.json"]
assert(string.find(body, '"queue_state":"timeout"', 1, true) ~= nil, body)
assert(string.find(body, '"reason":"continuation_timeout"', 1, true) ~= nil, body)
assert(string.find(body, '"outcome":"unknown"', 1, true) ~= nil, body)
assert(string.find(body, '"recoverable":false', 1, true) ~= nil, body)
assert(calls.actions[41929] == 1)
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0)
assert(calls.ledger == 0)
assert((calls.time_selection_set or 0) == 0)
`,
      { withTransport: true },
    );
  });

  it("terminates product D30 required Undo close failure as non-recoverable unknown without later writes", () => {
    runActualProductD30CompositionLua(String.raw`
force_undo_end_fail = true
local create_req = make_d30_request("req_undo_close_fail", "project.create_subproject", {
  name = "Dialog Edit",
  activate = true,
  inherit_time_selection = true,
})
local key = "run_command:template.execute"
assert(required_undo_capability(create_req, key) ~= nil and required_undo_capability(create_req, key) ~= false)

-- Preflight: no mutation, no Undo.
local pre = dispatch_request(create_req, create_req.id, nil, {
  started_at = now_iso(),
  deadline_monotonic = now + 100,
  now_monotonic = now,
})
assert(type(pre) == "table" and pre.phase == "create_subproject.mutate_create")
assert(calls.actions[41929] == nil)
assert(#undo_begins == 0 and #undo_ends == 0)
assert(open_undo_handle == nil)

-- First mutation phase: product opens parent Undo, runs 41929, then required Undo End fails.
local terminal = dispatch_request(create_req, create_req.id, pre, {
  started_at = now_iso(),
  deadline_monotonic = now + 100,
  now_monotonic = now,
})
assert(type(terminal) == "string", "not string: " .. tostring(terminal))
assert(string.find(terminal, '"ok":false', 1, true) ~= nil, "ok false missing: " .. terminal)
assert(string.find(terminal, '"recoverable":false', 1, true) ~= nil, "recoverable: " .. terminal)
assert(string.find(terminal, '"blocker":"required_undo_close_failed"', 1, true) ~= nil, "blocker: " .. terminal)
assert(string.find(terminal, '"outcome":"unknown"', 1, true) ~= nil, "outcome: " .. terminal)
assert(string.find(terminal, "create_subproject.verify_created", 1, true) == nil, "continuation leaked: " .. terminal)
assert(calls.actions[41929] == 1, "41929 count")
assert((calls.actions[42332] or 0) == 0, "42332")
assert(calls.save == 0, "save")
assert(calls.ledger == 0, "ledger")
assert(calls.select_project == 0, "select")
assert((calls.time_selection_set or 0) == 0, "time")
assert(open_undo_handle == nil, "open undo")
assert(#undo_begins == 1 and #undo_ends == 1, "undo pair count " .. #undo_begins .. "/" .. #undo_ends)
assert(undo_begins[1] == parent_project, "begin not parent")
assert(undo_ends[1] == parent_project, "end not parent")
assert(create_req.__openreaper_undo_close_failed == true, "close_failed flag")
assert(create_req.__openreaper_undo_required_any == true, "required_any flag")
assert(pending_new_tab ~= nil, "41929 should schedule pending tab")
assert(child_project == nil, "child not yet materialised")
-- Terminal string is not a retained continuation; later write counters stay zero (no replay).
assert(type(terminal) == "string")
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0)
assert(calls.ledger == 0)
assert(calls.select_project == 0)
assert((calls.time_selection_set or 0) == 0)
assert(calls.actions[41929] == 1)
`);
  });
});
