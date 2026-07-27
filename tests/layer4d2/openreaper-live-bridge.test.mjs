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
      /template_count = 237/,
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
for index = 1, 1143 do
  run_poll(index * 0.11)
end
local historical_result_checks = 0
for path, count in pairs(file_exists_calls) do
  if string.find(path, "/results/history-", 1, true) == 1 then historical_result_checks = historical_result_checks + count end
end
assert(historical_result_checks == 1143)

files[1144] = "next.json"
requests["/requests/next.json"] = { id = "next", params = {} }
run_poll(1144 * 0.11)
local checks_after_next = 0
for path, count in pairs(file_exists_calls) do
  if string.find(path, "/results/history-", 1, true) == 1 then checks_after_next = checks_after_next + count end
end
assert(checks_after_next == 1143)
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
assert(dispatch_calls.second == nil)
assert(results["/results/second.json"] == nil)

run_poll(0.33)
assert(dispatch_calls.first == 2)
assert(dispatch_calls.second == 1)
assert(results["/results/second.json"] == true)
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
assert(dispatch_calls["z-second"] == nil)
assert(results["/results/z-second.json"] == nil)

run_poll(0.33)
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
  const envelopeSource = readFileSync(new URL("../../reaper/bridge/src/20-bridge-envelope-kernel.lua", import.meta.url), "utf8");
  const policySource = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
  const loopSource = readFileSync(new URL("../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url), "utf8");
  const d30Source = readFileSync(
    new URL("../../reaper/bridge/src/handlers/project/d30_project_container_route.lua", import.meta.url),
    "utf8",
  );
  const envelopeKernel = extractProductLua(
    envelopeSource,
    "local function safe_budget(request)",
    "\nlocal FIXED_FAMILIES = {",
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
  assert.match(d30Handlers, /\["project\.create_project_tab"\] = create_project_tab/);
  assert.match(d30Handlers, /\["project\.open_project_in_tab"\] = open_project_in_tab/);
  assert.match(allowedOps, /\["run_command:template\.execute"\]/);
  assert.match(allowedOps, /handler = dispatch_template_execute/);
  assert.match(dispatchRequest, /function dispatch_request/);
  assert.match(d30Source, /function create_subproject/);
  assert.match(d30Source, /function render_or_update_subproject/);
  assert.match(d30Source, /function create_project_tab/);
  assert.match(d30Source, /function open_project_in_tab/);
  assert.match(d30Source, /type\(path\) ~= "string"/);
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
      envelopeKernel,
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
    "create_project_tab",
    "open_project_in_tab",
    "activate_project_tab",
    "list_open_projects",
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
      envelopeKernel,
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
CONTRACT = "foundation.bridge.v1"
DEFAULT_BUDGET = { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 }
JSON_NULL = {}
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
force_undo_begin_fail = false
force_delete_track_fail = false
undo_end_block_increments_dirty = false
allow_selection_without_undo = false
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
function json_array(value)
  local array = value or {}
  return setmetatable(array, { __openreaper_json_array = true })
end
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
json = {
  encode = function(value)
    if type(value) ~= "table" then return tostring(value) end
    local function enc(v)
      if v == nil or v == JSON_NULL then return "null" end
      local t = type(v)
      if t == "string" then return string.format("%q", v) end
      if t == "number" or t == "boolean" then return tostring(v) end
      if t ~= "table" then return "null" end
      local mt = getmetatable(v)
      if #v > 0 or (mt and mt.__openreaper_json_array == true) then
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
  if force_undo_begin_fail then error("forced Undo_BeginBlock2 failure") end
  if open_undo_handle ~= nil then
    push_guard_failure("Undo_BeginBlock2: nested or already-open Undo block")
  end
  open_undo_handle = project
  undo_begins[#undo_begins + 1] = project
  record_shared_event("undo_begin", project)
end
reaper.Undo_EndBlock2 = function(project, label, flags)
  if open_undo_handle == nil then
    push_guard_failure("Undo_EndBlock2: no open Undo block")
  end
  if open_undo_handle ~= project then
    push_guard_failure("Undo_EndBlock2: handle mismatch with open Undo block")
  end
  -- Real REAPER: closing an empty/content Undo block with flags=-1 can bump
  -- IsProjectDirty / state count even when no content mutation occurred.
  if undo_end_block_increments_dirty == true and type(project) == "table" then
    project.dirty = (project.dirty or 0) + 1
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
  -- Content mutations (create/open/subproject restore) bracket selection with
  -- exact-project Undo. activate_project_tab selection-only uses internal
  -- no-content Undo so real Undo_EndBlock2 cannot dirty the prior project.
  if open_undo_handle ~= nil then
    require_open_undo_for_mutation("SelectProjectInstance", nil)
  elseif allow_selection_without_undo ~= true then
    require_open_undo_for_mutation("SelectProjectInstance", nil)
  end
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
reaper.IsProjectDirty = function(project) return (project and project.dirty) or 0 end
reaper.GetProjectName = function(project)
  if project and project.path and project.path ~= "" then
    return true, project.path:match("([^/\\]+)$")
  end
  return true, "unsaved"
end
reaper.CountTracks = function(project) return #(project.tracks or {}) end
reaper.GetTrack = function(project, index) return (project.tracks or {})[index + 1] end
reaper.InsertTrackAtIndex = function(index, want_defaults)
  require_open_undo_for_mutation("InsertTrackAtIndex", current_project)
  assert(index == 0 and want_defaults == true)
  calls.insert_track = (calls.insert_track or 0) + 1
  local track = { guid = "{DEFAULT-D30-" .. tostring(calls.insert_track) .. "}", selected = false }
  table.insert(current_project.tracks, index + 1, track)
end
reaper.DeleteTrack = function(track)
  require_open_undo_for_mutation("DeleteTrack", parent_project)
  calls.delete_track = (calls.delete_track or 0) + 1
  if force_delete_track_fail then return false end
  for index, candidate in ipairs(parent_project.tracks or {}) do
    if candidate == track then
      table.remove(parent_project.tracks, index)
      return true
    end
  end
  return false
end
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
    budget = { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 },
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
  it("rejects all six low-budget D30 writes before product Undo or native mutation", () => {
    runActualProductD30CompositionLua(String.raw`
local capabilities = {
  "project.create_project_tab",
  "project.open_project_in_tab",
  "project.activate_project_tab",
  "project.create_subproject",
  "project.insert_subproject_item",
  "project.render_or_update_subproject",
}
for _, budget_bytes in ipairs({ 2048, 4096 }) do
  for index, capability in ipairs(capabilities) do
    calls = { actions = {}, select_project = 0, save = 0, ledger = 0, time_selection_set = 0 }
    undo_begins, undo_ends = {}, {}
    open_undo_handle = nil
    shared_events = {}
    guard_failures = {}
    pending_new_tab, pending_select = nil, nil
    local req = make_d30_request("low_" .. tostring(budget_bytes) .. "_" .. tostring(index), capability, {}, {})
    req.budget.max_response_bytes = budget_bytes
    local terminal = dispatch_request(req, req.id, nil, {
      started_at = now_iso(),
      deadline_monotonic = now + 100,
      now_monotonic = now,
    })
    assert(type(terminal) == "string", capability)
    assert(string.find(terminal, '"code":"RESPONSE_TOO_LARGE"', 1, true) ~= nil, terminal)
    assert(string.find(terminal, '"zero_write":true', 1, true) ~= nil, terminal)
    assert(string.find(terminal, '"required_response_bytes":65536', 1, true) ~= nil, terminal)
    assert(string.find(terminal, '"max_response_bytes":' .. tostring(budget_bytes), 1, true) ~= nil, terminal)
    local response_bytes = tonumber(string.match(terminal, '"response_bytes":(%d+)'))
    assert(response_bytes == #terminal, capability .. ": response_bytes must equal UTF-8 wire bytes")
    assert(#terminal <= budget_bytes, capability .. ": terminal error must fit request budget")
    assert(#undo_begins == 0 and #undo_ends == 0, capability .. ": Undo must stay unopened")
    assert(open_undo_handle == nil, capability .. ": no open Undo handle")
    assert(#shared_events == 0, capability .. ": no product mutation event")
    assert(calls.actions[41929] == nil and calls.actions[42332] == nil, capability .. ": no action")
    assert(calls.select_project == 0 and calls.save == 0 and calls.ledger == 0, capability .. ": no write")
    assert(calls.time_selection_set == 0, capability .. ": no time-selection write")
    assert(pending_new_tab == nil and pending_select == nil, capability .. ": no deferred native write")
  end
end
`);
  });

  it("reports exact UTF-8 response bytes through the product envelope kernel", () => {
    runActualProductD30CompositionLua(String.raw`
local request = make_d30_request("utf8_budget", "project.create_project_tab", {}, {})
local success = bridge_ok_envelope(
  request,
  now_iso(),
  { label = "淡入淡出", status = "完成" },
  json_array({}),
  json_array({}),
  json_array({})
)
local success_bytes = tonumber(string.match(success, '"response_bytes":(%d+)'))
assert(success_bytes == #success, success)
assert(#success <= request.budget.max_response_bytes, success)

local failure = bridge_error_envelope(request, "COMMAND_FAILED", "读取失败", {
  recoverable = true,
  details = { label = "淡入", reason = "原生读取失败" },
})
local failure_bytes = tonumber(string.match(failure, '"response_bytes":(%d+)'))
assert(failure_bytes == #failure, failure)
assert(#failure <= request.budget.max_response_bytes, failure)
`);
  });

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

function assert_terminal_budget(terminal, expected_max)
  local response_bytes = tonumber(string.match(terminal, '"response_bytes":(%d+)'))
  local max_response_bytes = tonumber(string.match(terminal, '"max_response_bytes":(%d+)'))
  assert(response_bytes == #terminal, "response_bytes must equal UTF-8 wire bytes")
  assert(max_response_bytes == expected_max, "terminal max_response_bytes mismatch")
  assert(#terminal <= expected_max, "terminal exceeded max_response_bytes")
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
assert_terminal_budget(terminal, 65536)
assert(string.find(terminal, '"artifacts":[]', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"jobs":[]', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"ref":"project:path:/session/Dialog_Edit__subproject_req_create.RPP"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"ref":"project:path:/session/Parent.RPP"', 1, true) ~= nil, terminal)
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

-- Full insert_subproject_item through product dispatch with exact required Undo.
local child_path = "/session/Dialog_Edit__subproject_req_create.RPP"
local target_track = { guid = "{TARGET-D30}", selected = false }
parent_project.tracks = { target_track }
parent_project.items = {}
local edit_cursor = 9
local native_guid_failure = false
local sws_guid_failure = false
reaper.GetTrackGUID = function(track) return track.guid end
reaper.CountMediaItems = function(project) return #(project.items or {}) end
reaper.GetMediaItem = function(project, index) return (project.items or {})[index + 1] end
reaper.IsTrackSelected = function(track) return track.selected == true end
reaper.SetTrackSelected = function(track, selected) track.selected = selected == true end
reaper.IsMediaItemSelected = function(item) return item.selected == true end
reaper.SetMediaItemSelected = function(item, selected) item.selected = selected == true end
reaper.GetCursorPositionEx = function(project) assert(project == parent_project); return edit_cursor end
reaper.SetEditCurPos2 = function(project, value) assert(project == parent_project); edit_cursor = value end
reaper.UpdateArrange = function() end
reaper.PCM_Source_CreateFromFile = function(path)
  require_open_undo_for_mutation("PCM_Source_CreateFromFile", parent_project)
  calls.create_source = (calls.create_source or 0) + 1
  return { path = path, source_type = "RPP_PROJECT", length = 6.25, subproject = child_project }
end
reaper.PCM_Source_Destroy = function(source)
  require_open_undo_for_mutation("PCM_Source_Destroy", parent_project)
  calls.destroy_source = (calls.destroy_source or 0) + 1
  source.destroyed = true
end
reaper.GetMediaSourceType = function(source) return source.source_type end
reaper.GetMediaSourceFileName = function(source) return source.path end
reaper.GetMediaSourceLength = function(source) return source.length, false end
reaper.GetSubProjectFromSource = function(source) return source.subproject end
reaper.GetMediaSourceParent = function(source) return source.parent end
reaper.AddMediaItemToTrack = function(track)
  require_open_undo_for_mutation("AddMediaItemToTrack", parent_project)
  calls.add_item = (calls.add_item or 0) + 1
  local item = { guid = "{ITEM-D30-" .. tostring(calls.add_item) .. "}", track = track, selected = true, position = 0, length = 0 }
  parent_project.items[#parent_project.items + 1] = item
  return item
end
reaper.AddTakeToMediaItem = function(item)
  require_open_undo_for_mutation("AddTakeToMediaItem", parent_project)
  calls.add_take = (calls.add_take or 0) + 1
  item.take = { source = nil }
  return item.take
end
reaper.SetMediaItemInfo_Value = function(item, key, value)
  require_open_undo_for_mutation("SetMediaItemInfo_Value", parent_project)
  if key == "D_POSITION" then item.position = value else assert(key == "D_LENGTH"); item.length = value end
  return true
end
reaper.SetMediaItemTake_Source = function(take, source)
  require_open_undo_for_mutation("SetMediaItemTake_Source", parent_project)
  take.source = source
end
reaper.UpdateItemInProject = function(item)
  require_open_undo_for_mutation("UpdateItemInProject", parent_project)
  calls.update_item = (calls.update_item or 0) + 1
end
reaper.GetMediaItem_Track = function(item) return item.track end
reaper.GetActiveTake = function(item) return item.take end
reaper.GetMediaItemTake_Source = function(take) return take.source end
reaper.GetMediaItemInfo_Value = function(item, key)
  if key == "D_POSITION" then return item.position end
  assert(key == "D_LENGTH")
  return item.length
end
reaper.GetSetMediaItemInfo_String = function(item, key, value, set_new)
  assert(key == "GUID" and value == "" and set_new == false)
  calls.native_guid = (calls.native_guid or 0) + 1
  if native_guid_failure then return false, "" end
  return true, item.guid
end
reaper.BR_GetMediaItemGUID = function(item)
  calls.sws_guid = (calls.sws_guid or 0) + 1
  if sws_guid_failure then return nil end
  return item.guid
end
reaper.DeleteTrackMediaItem = function(track, item)
  require_open_undo_for_mutation("DeleteTrackMediaItem", parent_project)
  calls.delete_item = (calls.delete_item or 0) + 1
  for index, candidate in ipairs(parent_project.items) do
    if candidate == item then table.remove(parent_project.items, index); return true end
  end
  return false
end

local insert_refs = {
  { kind = "project", ref = "project:path:" .. child_path, identity = { scheme = "path", value = child_path } },
  { kind = "track", ref = "track:guid:{TARGET-D30}", identity = { scheme = "guid", value = "{TARGET-D30}" } },
}

local function insert_write_snapshot()
  return {
    track_count = #parent_project.tracks,
    item_count = #parent_project.items,
    insert_track = calls.insert_track or 0,
    delete_track = calls.delete_track or 0,
    create_source = calls.create_source or 0,
    destroy_source = calls.destroy_source or 0,
    add_item = calls.add_item or 0,
    add_take = calls.add_take or 0,
    update_item = calls.update_item or 0,
    delete_item = calls.delete_item or 0,
    native_guid = calls.native_guid or 0,
    sws_guid = calls.sws_guid or 0,
  }
end

local function assert_insert_writes_unchanged(before, label)
  local after = insert_write_snapshot()
  for key, value in pairs(before) do
    assert(after[key] == value, label .. ": unexpected native write/readback delta for " .. key)
  end
  assert(#undo_begins == 0 and #undo_ends == 0 and open_undo_handle == nil, label .. ": Undo must stay unopened")
end

-- Ordinary request/ref/file/track/open-child failures terminal on the preflight
-- tick before product Undo or any source/Item/Take mutation.
local closed_child_path = "/session/ClosedChild.RPP"
files[closed_child_path] = true
files[closed_child_path .. "-PROX"] = true
local invalid_insert_cases = {
  {
    label = "missing_project_ref",
    params = { position_seconds = 5 },
    refs = { insert_refs[2] },
    blocker = "project_ref_missing",
  },
  {
    label = "missing_child_files",
    params = { position_seconds = 5 },
    refs = {
      { kind = "project", ref = "project:path:/session/MissingChild.RPP", identity = { scheme = "path", value = "/session/MissingChild.RPP" } },
      insert_refs[2],
    },
    code = "FILE_NOT_FOUND",
  },
  {
    label = "invalid_position",
    params = { position_seconds = -1 },
    refs = insert_refs,
    code = "PARAMS_INVALID",
  },
  {
    label = "unknown_track_ref",
    params = { position_seconds = 5 },
    refs = {
      insert_refs[1],
      { kind = "track", ref = "track:guid:{UNKNOWN-D30}", identity = { scheme = "guid", value = "{UNKNOWN-D30}" } },
    },
    blocker = "target_track_ref_invalid",
  },
  {
    label = "child_not_open",
    params = { position_seconds = 5 },
    refs = {
      { kind = "project", ref = "project:path:" .. closed_child_path, identity = { scheme = "path", value = closed_child_path } },
      insert_refs[2],
    },
    blocker = "subproject_must_be_open_for_native_source",
  },
}
for index, case in ipairs(invalid_insert_cases) do
  undo_begins, undo_ends = {}, {}
  shared_events = {}
  guard_failures = {}
  local before = insert_write_snapshot()
  local req = make_d30_request("req_insert_preflight_" .. tostring(index), "project.insert_subproject_item", case.params, case.refs)
  local terminal = dispatch_request(req, req.id, nil, {
    started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now,
  })
  assert(type(terminal) == "string", case.label)
  if case.code then
    assert(string.find(terminal, '"code":"' .. case.code .. '"', 1, true) ~= nil, terminal)
  end
  if case.blocker then
    assert(string.find(terminal, '"blocker":"' .. case.blocker .. '"', 1, true) ~= nil, terminal)
  end
  assert_terminal_budget(terminal, 65536)
  assert_insert_writes_unchanged(before, case.label)
end

-- At the legal 65536 budget, a required Undo-open failure is zero-write.
undo_begins, undo_ends = {}, {}
shared_events = {}
guard_failures = {}
local before_undo_fail = insert_write_snapshot()
local undo_fail_req = make_d30_request("req_insert_undo_fail", "project.insert_subproject_item", { position_seconds = 5 }, insert_refs)
local undo_fail_preflight = dispatch_request(undo_fail_req, undo_fail_req.id, nil, {
  started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now,
})
assert(type(undo_fail_preflight) == "table" and undo_fail_preflight.phase == "insert_subproject_item.mutate_insert")
assert(undo_fail_preflight.state.undo_project == parent_project)
assert_insert_writes_unchanged(before_undo_fail, "undo_open_preflight")
force_undo_begin_fail = true
local undo_fail_terminal = dispatch_request(undo_fail_req, undo_fail_req.id, undo_fail_preflight, {
  started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now,
})
force_undo_begin_fail = false
assert(type(undo_fail_terminal) == "string", undo_fail_terminal)
assert(string.find(undo_fail_terminal, '"blocker":"required_undo_project_identity_unavailable"', 1, true) ~= nil, undo_fail_terminal)
assert(string.find(undo_fail_terminal, '"zero_write":true', 1, true) ~= nil, undo_fail_terminal)
assert_terminal_budget(undo_fail_terminal, 65536)
assert_insert_writes_unchanged(before_undo_fail, "undo_open_failure")

-- Normal insert mutates once under exactly one parent-project Undo pair.
undo_begins, undo_ends = {}, {}
shared_events = {}
guard_failures = {}
local insert_req = make_d30_request("req_insert", "project.insert_subproject_item", { position_seconds = 5 }, insert_refs)
local insert_terminal = select(1, dispatch_to_terminal(insert_req))
assert(type(insert_terminal) == "string", insert_terminal)
assert(string.find(insert_terminal, '"ok":true', 1, true) ~= nil, insert_terminal)
assert_terminal_budget(insert_terminal, 65536)
assert(string.find(insert_terminal, '"artifacts":[]', 1, true) ~= nil, insert_terminal)
assert(string.find(insert_terminal, '"jobs":[]', 1, true) ~= nil, insert_terminal)
assert(string.find(insert_terminal, '"ref":"item:guid:{ITEM-D30-1}"', 1, true) ~= nil, insert_terminal)
assert(string.find(insert_terminal, '"ref":"project:path:' .. child_path .. '"', 1, true) ~= nil, insert_terminal)
assert(string.find(insert_terminal, 'item:placeholder:', 1, true) == nil, insert_terminal)
assert(#parent_project.items == 1 and parent_project.items[1].guid == "{ITEM-D30-1}")
assert(#undo_begins == 1 and #undo_ends == 1)
assert(undo_begins[1] == parent_project and undo_ends[1] == parent_project)
assert(open_undo_handle == nil and #guard_failures == 0)

-- Missing native GUID rolls the newly inserted Item back and never falls back to SWS/handle refs.
undo_begins, undo_ends = {}, {}
shared_events = {}
guard_failures = {}
native_guid_failure = true
sws_guid_failure = true
local before_guid_fail_items = #parent_project.items
local before_guid_fail_add = calls.add_item or 0
local before_guid_fail_delete = calls.delete_item or 0
local before_sws_guid = calls.sws_guid or 0
local guid_fail_req = make_d30_request("req_insert_guid_fail", "project.insert_subproject_item", { position_seconds = 7 }, insert_refs)
local guid_fail_terminal = select(1, dispatch_to_terminal(guid_fail_req))
native_guid_failure = false
sws_guid_failure = false
assert(type(guid_fail_terminal) == "string", guid_fail_terminal)
assert(string.find(guid_fail_terminal, '"code":"VERIFY_FAILED"', 1, true) ~= nil, guid_fail_terminal)
assert(string.find(guid_fail_terminal, '"blocker":"subproject_item_guid_readback_failed"', 1, true) ~= nil, guid_fail_terminal)
assert(string.find(guid_fail_terminal, '"outcome":"unknown"', 1, true) ~= nil, guid_fail_terminal)
assert(string.find(guid_fail_terminal, '"recoverable":false', 1, true) ~= nil, guid_fail_terminal)
assert(string.find(guid_fail_terminal, '"zero_write":false', 1, true) ~= nil, guid_fail_terminal)
assert(string.find(guid_fail_terminal, 'item:placeholder:', 1, true) == nil, guid_fail_terminal)
assert_terminal_budget(guid_fail_terminal, 65536)
assert(#parent_project.items == before_guid_fail_items)
assert((calls.add_item or 0) == before_guid_fail_add + 1)
assert((calls.delete_item or 0) == before_guid_fail_delete + 1)
assert((calls.sws_guid or 0) == before_sws_guid, "insert success identity must not use SWS fallback")
assert(#undo_begins == 1 and #undo_ends == 1)
assert(undo_begins[1] == parent_project and undo_ends[1] == parent_project)
assert(open_undo_handle == nil and #guard_failures == 0)

-- A tab switch between preflight and the implicit default-Track mutation must
-- never create a Track in the newly active foreign project.
local saved_parent_tracks = parent_project.tracks
local saved_parent_items = parent_project.items
parent_project.tracks = {}
parent_project.items = {}
current_project = parent_project
undo_begins, undo_ends = {}, {}
shared_events = {}
guard_failures = {}
local default_refs = {
  { kind = "project", ref = "project:path:" .. child_path, identity = { scheme = "path", value = child_path } },
}
local drift_req = make_d30_request("req_insert_active_drift", "project.insert_subproject_item", { position_seconds = 8 }, default_refs)
local before_drift_insert = calls.insert_track or 0
local before_drift_delete = calls.delete_track or 0
local before_drift_source = calls.create_source or 0
local before_drift_add = calls.add_item or 0
local foreign_track_count = #(child_project.tracks or {})
local drift_preflight = dispatch_request(drift_req, drift_req.id, nil, {
  started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now,
})
assert(type(drift_preflight) == "table" and drift_preflight.phase == "insert_subproject_item.mutate_insert")
assert(drift_preflight.state.create_default_track == true and drift_preflight.state.undo_project == parent_project)
current_project = child_project
local drift_terminal = dispatch_request(drift_req, drift_req.id, drift_preflight, {
  started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now,
})
assert(type(drift_terminal) == "string", drift_terminal)
assert(string.find(drift_terminal, '"code":"VERIFY_FAILED"', 1, true) ~= nil, drift_terminal)
assert(string.find(drift_terminal, '"blocker":"active_parent_changed_before_default_track_create"', 1, true) ~= nil, drift_terminal)
assert(string.find(drift_terminal, '"recoverable":false', 1, true) ~= nil, drift_terminal)
assert(string.find(drift_terminal, '"zero_write":true', 1, true) ~= nil, drift_terminal)
assert(string.find(drift_terminal, '"outcome":"unknown"', 1, true) == nil, drift_terminal)
assert((calls.insert_track or 0) == before_drift_insert)
assert((calls.delete_track or 0) == before_drift_delete)
assert((calls.create_source or 0) == before_drift_source)
assert((calls.add_item or 0) == before_drift_add)
assert(#parent_project.tracks == 0 and #(child_project.tracks or {}) == foreign_track_count)
assert(#undo_begins == 0 and #undo_ends == 0)
assert(open_undo_handle == nil and #guard_failures == 0)

-- If a later readback fails after an implicit default Track was created, every
-- mutation executes once. A failed DeleteTrack rollback remains explicit and
-- the dispatch result cannot claim recovery or zero-write.
current_project = parent_project
undo_begins, undo_ends = {}, {}
shared_events = {}
guard_failures = {}
native_guid_failure = true
force_delete_track_fail = true
local before_default_insert = calls.insert_track or 0
local before_default_delete = calls.delete_track or 0
local before_default_source = calls.create_source or 0
local before_default_add = calls.add_item or 0
local before_default_take = calls.add_take or 0
local before_default_item_delete = calls.delete_item or 0
local default_fail_req = make_d30_request("req_insert_default_rollback_fail", "project.insert_subproject_item", { position_seconds = 9 }, default_refs)
local default_fail_terminal = select(1, dispatch_to_terminal(default_fail_req))
native_guid_failure = false
force_delete_track_fail = false
assert(type(default_fail_terminal) == "string", default_fail_terminal)
assert(string.find(default_fail_terminal, '"code":"RESTORE_FAILED"', 1, true) ~= nil, default_fail_terminal)
assert(string.find(default_fail_terminal, '"original_blocker":"subproject_item_guid_readback_failed"', 1, true) ~= nil, default_fail_terminal)
assert(string.find(default_fail_terminal, '"target_track_deleted":false', 1, true) ~= nil, default_fail_terminal)
assert(string.find(default_fail_terminal, '"outcome":"unknown"', 1, true) ~= nil, default_fail_terminal)
assert(string.find(default_fail_terminal, '"recoverable":false', 1, true) ~= nil, default_fail_terminal)
assert(string.find(default_fail_terminal, '"zero_write":false', 1, true) ~= nil, default_fail_terminal)
assert_terminal_budget(default_fail_terminal, 65536)
assert((calls.insert_track or 0) == before_default_insert + 1)
assert((calls.delete_track or 0) == before_default_delete + 1)
assert((calls.create_source or 0) == before_default_source + 1)
assert((calls.add_item or 0) == before_default_add + 1)
assert((calls.add_take or 0) == before_default_take + 1)
assert((calls.delete_item or 0) == before_default_item_delete + 1)
assert(#parent_project.tracks == 1 and #parent_project.items == 0)
assert(#undo_begins == 1 and #undo_ends == 1)
assert(undo_begins[1] == parent_project and undo_ends[1] == parent_project)
assert(open_undo_handle == nil and #guard_failures == 0)

parent_project.tracks = saved_parent_tracks
parent_project.items = saved_parent_items
current_project = parent_project

-- Full render_or_update_subproject through the same product dispatch mapping.
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
  { kind = "item", ref = "item:guid:{ITEM-D30-1}", identity = { scheme = "guid", value = "{ITEM-D30-1}" } },
})
local render_terminal = select(1, dispatch_to_terminal(render_req))
assert(type(render_terminal) == "string", render_terminal)
assert(string.find(render_terminal, '"ok":true', 1, true) ~= nil, render_terminal)
assert_terminal_budget(render_terminal, 65536)
assert(string.find(render_terminal, '"artifacts":[]', 1, true) ~= nil, render_terminal)
assert(string.find(render_terminal, '"ref":"job:job_id:project.subproject.subproject_job_req_render"', 1, true) ~= nil, render_terminal)
assert(string.find(render_terminal, '"state":"completed"', 1, true) ~= nil, render_terminal)
assert(string.find(render_terminal, '"ref":"project:path:' .. child_path .. '"', 1, true) ~= nil, render_terminal)
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
local body = string.gsub(writes["/results/timeout.json"], "\n$", "")
assert(string.find(body, '"state":"timeout"', 1, true) ~= nil, body)
assert(string.find(body, '"reason":"continuation_timeout"', 1, true) ~= nil, body)
assert(string.find(body, '"outcome":"unknown"', 1, true) ~= nil, body)
assert(string.find(body, '"recoverable":false', 1, true) ~= nil, body)
local response_bytes = tonumber(string.match(body, '"response_bytes":(%d+)'))
assert(response_bytes == #body, body)
assert(#body <= 65536, body)
assert(calls.actions[41929] == 1)
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0)
assert(calls.ledger == 0)
assert((calls.time_selection_set or 0) == 0)
`,
      { withTransport: true },
    );
  });

  it("fails a mutation-bearing continuation closed when its retained budget is reduced", () => {
    runActualProductD30CompositionLua(String.raw`
calls = { actions = {}, select_project = 0, save = 0, ledger = 0, time_selection_set = 0 }
undo_begins, undo_ends = {}, {}
open_undo_handle = nil
shared_events = {}
guard_failures = {}
pending_new_tab, pending_select = nil, nil

local request = make_d30_request("reduced_budget", "project.create_subproject", { name = "Budget Child" }, {})
local runtime = { started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now }
local preflight = dispatch_request(request, request.id, nil, runtime)
assert(type(preflight) == "table" and preflight.phase == "create_subproject.mutate_create")
assert(calls.actions[41929] == nil)

local mutated = dispatch_request(request, request.id, preflight, runtime)
assert(type(mutated) == "table" and mutated.phase == "create_subproject.verify_created")
assert(mutated.mutations_may_have_happened == true)
assert(calls.actions[41929] == 1)
assert(#undo_begins == 1 and #undo_ends == 1)

request.budget.max_response_bytes = 4096
local terminal = dispatch_request(request, request.id, mutated, runtime)
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"code":"RESPONSE_TOO_LARGE"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"recoverable":false', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"outcome":"unknown"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"zero_write":false', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"required_response_bytes":65536', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"max_response_bytes":4096', 1, true) ~= nil, terminal)
local response_bytes = tonumber(string.match(terminal, '"response_bytes":(%d+)'))
assert(response_bytes == #terminal, terminal)
assert(#terminal <= 4096, terminal)
assert(calls.actions[41929] == 1, "41929 must not replay")
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0 and calls.ledger == 0)
assert((calls.time_selection_set or 0) == 0)
assert(#undo_begins == 1 and #undo_ends == 1, "reduced-budget resume must not open another Undo pair")
assert(open_undo_handle == nil and #guard_failures == 0)
`);
  });

  it("preserves prior mutation truth when a resumed continuation also carries a handler failure", () => {
    runActualProductD30CompositionLua(String.raw`
local original_handler = D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"]
D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"] = function(request, resume_continuation)
  assert(resume_continuation ~= nil)
  return {
    contract = BRIDGE_INTERNAL_CONTINUATION_CONTRACT,
    phase = "fixture.handler_failed",
    state = { undo_project = parent_project },
    mutations_may_have_happened = false,
    next_phase_may_mutate = false,
  }, {
    code = "COMMAND_FAILED",
    message = "fixture handler failure",
    recoverable = false,
    details = { blocker = "fixture_handler_failure" },
  }
end

local request = make_d30_request("resume_handler_failure", "project.create_subproject", { name = "Budget Child" }, {})
local prior = {
  contract = BRIDGE_INTERNAL_CONTINUATION_CONTRACT,
  phase = "fixture.previous_mutation",
  state = { undo_project = parent_project },
  mutations_may_have_happened = true,
  next_phase_may_mutate = false,
}
local terminal = dispatch_request(request, request.id, prior, {
  started_at = now_iso(),
  deadline_monotonic = now + 100,
  now_monotonic = now,
})
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"code":"INTERNAL_ERROR"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"recoverable":false', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"outcome":"unknown"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"zero_write":false', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"reason":"malformed_internal_continuation"', 1, true) ~= nil, terminal)
D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"] = original_handler
`);
  });

  it("keeps real D30 continuation mutation truth monotonic through later fail-closed exits", () => {
    runActualProductD30CompositionLua(String.raw`
calls = { actions = {}, select_project = 0, save = 0, ledger = 0, time_selection_set = 0 }
undo_begins, undo_ends = {}, {}
open_undo_handle = nil
shared_events = {}
guard_failures = {}
pending_new_tab, pending_select = nil, nil

local request = make_d30_request("monotonic_continuation", "project.create_subproject", { name = "Monotonic Child" }, {})
local runtime = { started_at = now_iso(), deadline_monotonic = now + 100, now_monotonic = now }
local preflight = dispatch_request(request, request.id, nil, runtime)
assert(type(preflight) == "table" and preflight.phase == "create_subproject.mutate_create")
assert(type(preflight.mutations_may_have_happened) == "boolean")
assert(preflight.mutations_may_have_happened == false)

local mutated = dispatch_request(request, request.id, preflight, runtime)
assert(type(mutated) == "table" and mutated.phase == "create_subproject.verify_created")
assert(mutated.mutations_may_have_happened == true)
assert(calls.actions[41929] == 1)
assert(#undo_begins == 1 and #undo_ends == 1)

local original_handler = D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"]
local fixture_resume_calls = 0
D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"] = function(inner_request, resume_continuation)
  fixture_resume_calls = fixture_resume_calls + 1
  assert(inner_request == request)
  assert(resume_continuation.mutations_may_have_happened == true)
  return {
    contract = BRIDGE_INTERNAL_CONTINUATION_CONTRACT,
    phase = "fixture.read_only_after_mutation",
    state = resume_continuation.state,
    mutations_may_have_happened = false,
    next_phase_may_mutate = false,
  }
end

local merged = dispatch_request(request, request.id, mutated, runtime)
assert(type(merged) == "table" and merged.phase == "fixture.read_only_after_mutation")
assert(merged.mutations_may_have_happened == true, "prior mutation truth must not downgrade")
assert(merged.next_phase_may_mutate == false, "next-phase mutation truth remains handler-owned")
assert(fixture_resume_calls == 1)
assert(calls.actions[41929] == 1 and #undo_begins == 1 and #undo_ends == 1)

local function assert_unknown_terminal(terminal, code)
  assert(type(terminal) == "string", terminal)
  assert(string.find(terminal, '"code":"' .. code .. '"', 1, true) ~= nil, terminal)
  assert(string.find(terminal, '"recoverable":false', 1, true) ~= nil, terminal)
  assert(string.find(terminal, '"outcome":"unknown"', 1, true) ~= nil, terminal)
  assert(string.find(terminal, '"zero_write":false', 1, true) ~= nil, terminal)
end

request.bridge.expected_owner = "stale-owner"
assert_unknown_terminal(dispatch_request(request, request.id, merged, runtime), "BRIDGE_OWNER_MISMATCH")
request.bridge.expected_owner = ACTIVE_OWNER
request.bridge.expected_generation = ACTIVE_GENERATION + 1
assert_unknown_terminal(dispatch_request(request, request.id, merged, runtime), "BRIDGE_GENERATION_MISMATCH")
request.bridge.expected_generation = ACTIVE_GENERATION
assert_unknown_terminal(dispatch_request(request, request.id, merged, {
  started_at = now_iso(),
  deadline_monotonic = now - 1,
  now_monotonic = now,
}), "BRIDGE_TIMEOUT")
assert(fixture_resume_calls == 1, "pre-dispatch failures must not resume the handler")

D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"] = function()
  fixture_resume_calls = fixture_resume_calls + 1
  error("fixture resume exception")
end
assert_unknown_terminal(dispatch_request(request, request.id, merged, runtime), "INTERNAL_ERROR")
assert(fixture_resume_calls == 2)
assert(calls.actions[41929] == 1, "native mutation must not replay")
assert((calls.actions[42332] or 0) == 0)
assert(calls.save == 0 and calls.ledger == 0)
assert((calls.time_selection_set or 0) == 0)
assert(#undo_begins == 1 and #undo_ends == 1, "Undo must not replay")
assert(open_undo_handle == nil and #guard_failures == 0)
D30_PROJECT_CONTAINER_HANDLERS["project.create_subproject"] = original_handler
`);
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

  it("composes create_project_tab with unsaved active blank readback and no SelectProjectInstance", () => {
    runActualProductD30CompositionLua(String.raw`
function dispatch_to_terminal(request)
  local cont = nil
  local last = nil
  for i = 1, 24 do
    if i > 1 then
      apply_pending_reaper_effects()
    end
    local runtime = { started_at = now_iso(), deadline_monotonic = now + 30, now_monotonic = now }
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

local req = make_d30_request("req_tab", "project.create_project_tab", { name = "sound design", activate = true })
local terminal = select(1, dispatch_to_terminal(req))
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"created":true', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"path_state":"unsaved_project"', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"active":true', 1, true) ~= nil, terminal)
assert(calls.actions[41929] == 1)
assert(calls.select_project == 0)
assert(current_project ~= parent_project)
assert(current_project.path == "")
-- Exact EnumProjects(-1) authority for unsaved active (empty path string).
local ok_cur, active_handle, active_path = call_reaper("EnumProjects", -1, "")
assert(ok_cur == true and active_handle == current_project and active_path == "")
local active_matches = 0
for _, p in ipairs(projects) do
  if p == active_handle then active_matches = active_matches + 1 end
end
assert(active_matches == 1)
assert(#undo_begins >= 1 and #undo_ends == #undo_begins)
assert(open_undo_handle == nil)
assert(calls.actions[41929] == 1)
`);
  });

  it("retains original 30000ms deadline across a ~20s native 41929 call for create_project_tab", () => {
    runActualProductD30CompositionLua(String.raw`
-- Long native call: first/only 41929 advances monotonic clock by ~20s without real wait.
local original_main = reaper.Main_OnCommandEx
reaper.Main_OnCommandEx = function(action, flag, project)
  if action == 41929 then
    now = now + 20.0
  end
  return original_main(action, flag, project)
end

local req = make_d30_request("req_long_tab", "project.create_project_tab", { name = "long native", activate = true })
req.timeout_ms = 30000
local deadline = now + (req.timeout_ms / 1000)
local cont = dispatch_request(req, req.id, nil, {
  started_at = now_iso(),
  deadline_monotonic = deadline,
  now_monotonic = now,
})
assert(type(cont) == "table" and cont.phase == "create_project_tab.mutate_create")
assert(calls.actions[41929] == nil)
assert(now < 1)

local mid = dispatch_request(req, req.id, cont, {
  started_at = now_iso(),
  deadline_monotonic = deadline,
  now_monotonic = now,
})
assert(type(mid) == "table" and mid.phase == "create_project_tab.verify_created", tostring(mid))
assert(calls.actions[41929] == 1)
assert(now >= 20 and now < 21)
-- Original deadline retained (not refreshed after mutation).
assert(deadline == 30)
assert(now < deadline)

apply_pending_reaper_effects()
local terminal = dispatch_request(req, req.id, mid, {
  started_at = now_iso(),
  deadline_monotonic = deadline,
  now_monotonic = now,
})
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, terminal)
assert(calls.actions[41929] == 1)
assert(calls.select_project == 0)
assert(current_project.path == "")
assert(now < deadline)
assert(open_undo_handle == nil)
`);
  });

  it("composes open_project_in_tab with already-active blank and single Main_openProject", () => {
    runActualProductD30CompositionLua(String.raw`
function dispatch_to_terminal(request)
  local cont = nil
  local last = nil
  for i = 1, 24 do
    if i > 1 then
      apply_pending_reaper_effects()
    end
    local runtime = { started_at = now_iso(), deadline_monotonic = now + 30, now_monotonic = now }
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

local target = "/session/Child.RPP"
files[target] = true
calls.open_project = 0
reaper.Main_openProject = function(arg)
  calls.open_project = (calls.open_project or 0) + 1
  require_open_undo_for_mutation("Main_openProject", nil)
  record_shared_event("open_project", open_undo_handle, arg)
  local path = arg:match("^noprompt:(.+)$") or arg
  current_project.path = path
  return nil
end

local req = make_d30_request("req_open_tab", "project.open_project_in_tab", { path = target })
local terminal = select(1, dispatch_to_terminal(req))
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"opened":true', 1, true) ~= nil, terminal)
assert(calls.actions[41929] == 1)
assert(calls.open_project == 1)
assert(calls.select_project == 0)
assert(current_project.path == target)
assert(open_undo_handle == nil)
`);
  });

  it("activate_project_tab keeps prior dirty unchanged when real Undo_EndBlock2 would increment state count", () => {
    runActualProductD30CompositionLua(String.raw`
function dispatch_to_terminal(request)
  local cont = nil
  local last = nil
  for i = 1, 24 do
    if i > 1 then
      apply_pending_reaper_effects()
    end
    local runtime = { started_at = now_iso(), deadline_monotonic = now + 30, now_monotonic = now }
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

-- Simulate live REAPER: empty Undo_EndBlock2(..., -1) bumps IsProjectDirty.
undo_end_block_increments_dirty = true
allow_selection_without_undo = true
local other = { path = "/session/Other.RPP", dirty = 0, tracks = {}, items = {}, time_start = 0, time_end = 0 }
parent_project.dirty = 0
projects = { parent_project, other }
current_project = parent_project
files["/session/Other.RPP"] = true
undo_begins, undo_ends = {}, {}
open_undo_handle = nil
shared_events = {}
calls.select_project = 0

local req = make_d30_request("req_activate_dirty", "project.activate_project_tab", {}, {
  { kind = "project", ref = "project:path:/session/Other.RPP", identity = { scheme = "path", value = "/session/Other.RPP" } },
})
local terminal = select(1, dispatch_to_terminal(req))
assert(type(terminal) == "string", terminal)
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, "ok true missing: " .. terminal)
assert(string.find(terminal, '"activated":true', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"prior_dirty_unchanged":true', 1, true) ~= nil, terminal)
assert(string.find(terminal, '"prior_project_dirty_or_missing"', 1, true) == nil, terminal)
assert(parent_project.dirty == 0, "prior dirty must stay 0, got " .. tostring(parent_project.dirty))
assert(current_project == other)
assert(calls.select_project == 1)
-- Selection-only must not open content Undo on prior (would have dirtied it).
assert(#undo_begins == 0 and #undo_ends == 0, "selection-only must skip content Undo pairs")
assert(open_undo_handle == nil)
assert(#guard_failures == 0)

-- create_project_tab still uses exact content Undo (not weakened by activate special-case).
undo_end_block_increments_dirty = false
allow_selection_without_undo = false
projects = { parent_project }
current_project = parent_project
parent_project.dirty = 2
undo_begins, undo_ends = {}, {}
calls.actions = {}
local create_req = make_d30_request("req_create_still_undo", "project.create_project_tab", { name = "keep-undo", activate = true })
local create_terminal = select(1, dispatch_to_terminal(create_req))
assert(type(create_terminal) == "string", create_terminal)
assert(string.find(create_terminal, '"ok":true', 1, true) ~= nil, create_terminal)
assert(#undo_begins >= 1 and #undo_ends == #undo_begins, "create must retain exact Undo pairs")
assert(calls.actions[41929] == 1)
`);
  });
});

const E3_LONG_PATH = [
  "/Users/Shared/OpenReaper",
  "library session 演示资料",
  "nested folder 层级",
  "deep",
  "more nested 路径段",
  "path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes",
  "path segment with spaces and 中文音频素材_abcdefghijklmnopqrstuvwxyz_0123456789_padding_segment_for_identity_roundtrip_extra_bytes",
  "clip 源文件 final.wav",
].join("/");

function loadActualProductE3MediaCompositionSources() {
  const kernelSource = readFileSync(new URL("../../reaper/bridge/src/00-bridge-kernel.lua", import.meta.url), "utf8");
  const envelopeSource = readFileSync(new URL("../../reaper/bridge/src/20-bridge-envelope-kernel.lua", import.meta.url), "utf8");
  const policySource = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
  const routeSource = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
  const probeSource = readFileSync(new URL("../../reaper/bridge/src/handlers/media/probe_file.lua", import.meta.url), "utf8");
  const takeSource = readFileSync(new URL("../../reaper/bridge/src/handlers/media/read_take_source.lua", import.meta.url), "utf8");
  const projectSource = readFileSync(new URL("../../reaper/bridge/src/handlers/media/read_project_media_files.lua", import.meta.url), "utf8");
  const e3Source = readFileSync(new URL("../../reaper/bridge/src/handlers/media/e3_media_route.lua", import.meta.url), "utf8");

  // Product JSON encode (ESCAPES through json.encode) and decode (parse_error through json.decode).
  const jsonEncodeKernel = extractProductLua(kernelSource, "local ESCAPES = {", "\nlocal function now_iso");
  const jsonDecodeKernel = extractProductLua(kernelSource, "local function parse_error(message, position)", "\nlocal ESCAPES = {");
  const jsonKernel = `${jsonDecodeKernel}\n${jsonEncodeKernel}`;
  const envelopeKernel = extractProductLua(
    envelopeSource,
    "local function safe_budget(request)",
    "\nlocal FIXED_FAMILIES = {",
  );
  const fixedFamiliesPacks = extractProductLua(
    envelopeSource,
    "local FIXED_FAMILIES = {",
    "\nlocal WORKFLOW_SHAPED_IDS = {",
  );
  const e3Caps = extractProductLua(
    policySource,
    "local E3_MEDIA_ROUTE_CAPABILITIES = {",
    "\nlocal E4_ITEM_ROUTE_CAPABILITIES = {",
  );
  const e3CapFn = extractProductLua(
    policySource,
    "local function e3_media_route_capability(request, operation_key)",
    "\nlocal function e4_item_route_capability(request, operation_key)",
  );
  const templateWrite = extractProductLua(
    policySource,
    "local function template_execute_write_capability(request, operation_key)",
    "\nlocal function required_undo_capability(request, operation_key)",
  );
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
  const validateRequestFn = extractProductLua(
    policySource,
    "local function validate_request(request)",
    null,
  );
  const e3HandlersTable = extractProductLua(
    routeSource,
    "local E3_MEDIA_ROUTE_HANDLERS = {",
    "\nlocal E4_ITEM_ROUTE_HANDLERS = {",
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

  assert.match(requiredUndoFn, /template_execute_write_capability/);
  assert.match(templateWrite, /e3_media_route_capability/);
  assert.match(dispatchTemplate, /E3_MEDIA_ROUTE_HANDLERS/);
  assert.match(e3HandlersTable, /import_file_to_track/);
  assert.match(routeSource, /READ_B_MEDIA\.preflight_mutation_write/);
  assert.match(routeSource, /required_undo_begin_failed/);
  assert.match(probeSource, /function READ_B_MEDIA\.preflight_mutation_write/);
  assert.match(probeSource, /complete_success_envelope_fits|success_envelope_bytes/);
  assert.match(dispatchRequest, /function dispatch_request/);
  assert.match(validateRequestFn, /Bridge request contract must be foundation\.bridge\.v1/);
  assert.match(validateRequestFn, /E3 media route write requests must use undo\.mode required/);

  const nilCapHelpers = `
ARTIFACT_PRODUCING_OPERATIONS = {}
local function safe_write_a_capability() return nil end
local function e4_item_route_capability() return nil end
local function e5_routing_write_capability() return nil end
local function e5_automation_write_capability() return nil end
local function e2_fx_b1_write_capability() return nil end
local function d6_project_tempo_write_capability() return nil end
local function d9_tracks_mixer_write_capability() return nil end
local function d11_project_marker_region_capability() return nil end
local function d12_transport_safe_capability() return nil end
local function d13_items_core_write_capability() return nil end
local function d14_items_delete_capability() return nil end
local function d15_items_source_phase_capability() return nil end
local function d16_tracks_org_capability() return nil end
local function d17_midi_edit_capability() return nil end
local function d22_render_settings_write_capability() return nil end
local function d28_small_write_capability() return nil end
local function d29_render_settings_write_capability() return nil end
local function d29_render_output_metadata_operation() return nil end
local function d29_render_job_operation() return nil end
local function d30_project_container_capability() return nil end
local function alpha3_2c3bc_project_file_save_capability() return nil end
`;
  const emptyHandlerTables = `
local SAFE_WRITE_A_HANDLERS = {}
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
local D30_PROJECT_CONTAINER_HANDLERS = {}
local ALPHA3_2C3BC_PROJECT_FILE_SAVE_HANDLERS = {}
local function handler_error(code, message, details)
  return nil, { code = code, message = message, details = details or {}, recoverable = true }
end
local function set_render_sample_rate() error("unexpected non-E3 handler") end
local function set_render_format() error("unexpected non-E3 handler") end
local function d31_render_targets() error("unexpected non-E3 handler") end
local function create_delivery_report() error("unexpected non-E3 handler") end
local function create_layer_report() error("unexpected non-E3 handler") end
`;

  let productLua = [
    jsonKernel,
    envelopeKernel,
    fixedFamiliesPacks,
    e3Caps,
    e3CapFn,
    nilCapHelpers,
    templateWrite,
    requiredUndoFn,
    undoOpenClose,
    validateRequestFn,
    probeSource,
    takeSource,
    projectSource,
    e3Source,
    emptyHandlerTables,
    e3HandlersTable,
    dispatchTemplate,
    allowedOps,
    dispatchRequest,
  ].join("\n");

  for (const name of [
    "required_undo_capability",
    "open_required_undo_block",
    "close_required_undo_block",
    "dispatch_template_execute",
    "dispatch_request",
    "e3_media_route_capability",
    "validate_request",
  ]) {
    productLua = productLua.replaceAll(`local function ${name}`, `function ${name}`);
  }
  productLua = productLua.replace("local ALLOWED_OPERATIONS = {", "ALLOWED_OPERATIONS = {");
  productLua = productLua.replace("local E3_MEDIA_ROUTE_HANDLERS = {", "E3_MEDIA_ROUTE_HANDLERS = {");
  productLua = productLua.replace("local FIXED_FAMILIES = {", "FIXED_FAMILIES = {");
  productLua = productLua.replace("local FIXED_PACKS = {", "FIXED_PACKS = {");
  productLua = productLua.replace(
    'local BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"',
    'BRIDGE_INTERNAL_CONTINUATION_CONTRACT = "openreaper.bridge.internal_continuation.v1"',
  );
  productLua = "json = {}\n" + productLua;
  productLua = productLua.replace("local ESCAPES = {", "ESCAPES = {");
  // Hoist product decode helpers so json.decode can call them across the extracted chunk.
  for (const name of [
    "parse_error",
    "skip_ws",
    "parse_string",
    "parse_number",
    "parse_array",
    "parse_object",
    "parse_value",
  ]) {
    productLua = productLua.replaceAll(`local function ${name}`, `function ${name}`);
  }
  productLua = productLua.replace(
    "function json.encode(value)\n  return encode_value(value)\nend",
    "function json.encode(value)\n  return encode_value(value)\nend\n_G.json = json",
  );

  const loopSource = readFileSync(new URL("../../reaper/bridge/src/90-file-transport-loop.lua", import.meta.url), "utf8");
  return { productLua, policySource, routeSource, probeSource, e3Source, validateRequestFn, loopSource };
}

function runActualProductE3MediaCompositionLua(body, { withTransport = false } = {}) {
  const sources = loadActualProductE3MediaCompositionSources();
  const env = `
ACTIVE_OWNER = "test-owner"
ACTIVE_GENERATION = 1
CONTRACT = "foundation.bridge.v1"
DEFAULT_BUDGET = { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 }
JSON_NULL = {}
JSON_ARRAY_MT = { __openreaper_json_array = true }
function json_array(values) return setmetatable(values or {}, JSON_ARRAY_MT) end
function is_json_array(value) return type(value) == "table" and getmetatable(value) == JSON_ARRAY_MT end
function is_object(value) return type(value) == "table" and value ~= JSON_NULL and not is_json_array(value) end
function is_string(value) return type(value) == "string" and value:match("%S") ~= nil end
function is_non_negative_integer(value) return type(value) == "number" and value >= 0 and value == math.floor(value) end
function is_request_id(value) return type(value) == "string" and value:match("^cmd_[A-Za-z0-9_]+$") ~= nil end
json = json or {}
function bounded_string(value, max_length)
  local text = tostring(value or "")
  local limit = max_length or 240
  if #text <= limit then return text end
  return text:sub(1, limit - 3) .. "..."
end
function first_number(...) for i=1,select("#",...) do local v=select(i,...); if type(v)=="number" then return v end end end
function first_string(...) for i=1,select("#",...) do local v=select(i,...); if type(v)=="string" then return v end end end
function now_iso() return "2026-07-20T00:00:00.000Z" end
function path_join(base, child) return base .. "/" .. child end
function result_id_from_filename(filename) return string.gsub(filename, "%.json$", "") end
function ensure_directory() return true end
function write_bridge_heartbeat() return true end
function log(message) logs[#logs + 1] = tostring(message) end
logs = {}
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
request_objects = {}
decoded_request_order = {}
decoded_request_tables = {}
decoded_request_cache_at_decode = {}
files_list = {}
now = 0
deferred_callback = nil
force_undo_begin_fail = false
undo_begins = {}
undo_ends = {}
open_undo_handle = nil
mutation_calls = {}
enum_project_calls = 0
existing_files = {}
folder_files = {}
media_project = { path = "/session/Media.RPP", tracks = { { guid = "{TRACK-E3}" } }, items = {} }
current_project = media_project
function record_mutation(name)
  mutation_calls[#mutation_calls + 1] = name
end
function call_reaper(name, ...)
  if not reaper or type(reaper[name]) ~= "function" then return false end
  return pcall(reaper[name], ...)
end
function file_exists(path_value)
  file_exists_calls[path_value] = (file_exists_calls[path_value] or 0) + 1
  return existing_files[path_value] == true or results[path_value] == true or requests[path_value] ~= nil or files[path_value] == true
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
reaper = {}
reaper.EnumProjects = function(index)
  enum_project_calls = enum_project_calls + 1
  if index == -1 then return current_project, current_project.path or "" end
  return nil, ""
end
reaper.Undo_BeginBlock2 = function(project)
  -- Product call_reaper wraps with pcall: only a hard failure yields open false.
  if force_undo_begin_fail then error("forced Undo_BeginBlock2 failure") end
  open_undo_handle = project
  undo_begins[#undo_begins + 1] = { api = "Undo_BeginBlock2", project = project }
end
reaper.Undo_EndBlock2 = function(project, label, flags)
  undo_ends[#undo_ends + 1] = { api = "Undo_EndBlock2", project = project, label = label, flags = flags }
  open_undo_handle = nil
end
reaper.Undo_BeginBlock = function()
  if force_undo_begin_fail then error("forced Undo_BeginBlock failure") end
  open_undo_handle = current_project
  undo_begins[#undo_begins + 1] = { api = "Undo_BeginBlock", project = current_project }
end
reaper.Undo_EndBlock = function(label, flags)
  undo_ends[#undo_ends + 1] = { api = "Undo_EndBlock", project = current_project, label = label, flags = flags }
  open_undo_handle = nil
end
reaper.GetTrack = function(proj, index)
  return media_project.tracks[index + 1]
end
reaper.GetTrackGUID = function(track) return track and track.guid or nil end
reaper.GetMediaTrackInfo_Value = function(track, key)
  if key == "IP_TRACKNUMBER" then
    for i, candidate in ipairs(media_project.tracks or {}) do
      if candidate == track then return i end
    end
    return 1
  end
  return 0
end
reaper.CountTracks = function() return #media_project.tracks end
reaper.CountMediaItems = function() return #(media_project.items or {}) end
reaper.GetMediaItem = function(_, index) return (media_project.items or {})[index + 1] end
reaper.CountTakes = function(item) return item and #(item.takes or {}) or 0 end
reaper.GetTake = function(item, index) return item and (item.takes or {})[index + 1] end
reaper.GetActiveTake = function(item) return item and item.takes and item.takes[1] or nil end
reaper.CountSelectedMediaItems = function() return 0 end
reaper.GetSelectedMediaItem = function() return nil end
reaper.SetMediaItemSelected = function() end
reaper.UpdateArrange = function() end
reaper.UpdateItemInProject = function() end
reaper.BR_GetMediaItemGUID = function(item) return item and item.guid or nil end
reaper.GetSetMediaItemInfo_String = function(item, key, value, setNewValue)
  if key == "GUID" then return true, true, item and item.guid or "" end
  return false
end
reaper.BR_GetMediaItemTakeGUID = function(take) return take and take.guid or nil end
reaper.GetSetMediaItemTakeInfo_String = function(take, key, value, setNewValue)
  if key == "GUID" then return true, true, take and take.guid or "" end
  return false
end
reaper.GetMediaItemTake_Source = function(take)
  return take and take.source or nil
end
reaper.GetMediaSourceFileName = function(source)
  return source and source.path or ""
end
reaper.GetMediaSourceType = function(source) return source and source.source_type or "WAVE" end
reaper.GetMediaSourceLength = function(source) return source and source.length or 1.0, false end
reaper.GetMediaSourceNumChannels = function(source) return source and source.channels or 2 end
reaper.PCM_Source_CreateFromFile = function(path_value)
  record_mutation("PCM_Source_CreateFromFile")
  if existing_files[path_value] ~= true then return nil end
  return { path = path_value, source_type = "WAVE", length = 2.0, channels = 2 }
end
reaper.PCM_Source_Destroy = function() end
reaper.AddMediaItemToTrack = function(track)
  record_mutation("AddMediaItemToTrack")
  local item = { guid = "{ITEM-E3-" .. tostring(#(media_project.items or {}) + 1) .. "}", takes = {}, track = track }
  media_project.items = media_project.items or {}
  media_project.items[#media_project.items + 1] = item
  return item
end
reaper.AddTakeToMediaItem = function(item)
  record_mutation("AddTakeToMediaItem")
  local take = { guid = "{TAKE-E3-" .. tostring(#(item.takes or {}) + 1) .. "}", source = nil }
  item.takes = item.takes or {}
  item.takes[#item.takes + 1] = take
  return take
end
reaper.SetMediaItemTake_Source = function(take, source)
  record_mutation("SetMediaItemTake_Source")
  take.source = source
end
reaper.SetMediaItemInfo_Value = function()
  record_mutation("SetMediaItemInfo_Value")
end
reaper.SetMediaItemTakeInfo_Value = function()
  record_mutation("SetMediaItemTakeInfo_Value")
end
reaper.GetMediaItemTake_Item = function(take)
  for _, item in ipairs(media_project.items or {}) do
    for _, candidate in ipairs(item.takes or {}) do
      if candidate == take then return item end
    end
  end
  return nil
end
reaper.EnumerateFiles = function(directory, index)
  if directory == REQUESTS_DIR then
    return files_list and files_list[index + 1] or nil
  end
  if directory == CLAIMS_DIR then
    local names = {}
    for path in pairs(requests) do
      local name = string.match(path, "^/claims/(.+)$")
      if name then names[#names + 1] = name end
    end
    table.sort(names)
    return names[index + 1]
  end
  local files = folder_files[directory]
  if not files then return nil end
  return files[index + 1]
end
reaper.time_precise = function() return now end
reaper.defer = function(callback) deferred_callback = callback end
os.remove = function(path) requests[path] = nil return true end
function run_poll(at)
  now = at
  assert(type(deferred_callback) == "function")
  local callback = deferred_callback
  deferred_callback = nil
  callback()
end
function abi_base(id, family, name, pack_id, capability, risk)
  local req = {
    contract = CONTRACT,
    id = id,
    created_at = "2026-07-20T00:00:00.000Z",
    timeout_ms = 5000,
    client = { id = "openreaper-e3-composition", session_id = "session-e3-c3a" },
    bridge = { expected_owner = ACTIVE_OWNER, expected_generation = ACTIVE_GENERATION },
    operation = { family = family, name = name },
    pack = { id = pack_id, capability = capability, risk = risk },
    params = {},
    refs = json_array({}),
    verification = { mode = "none", checks = json_array({}) },
    artifacts = { allow = false },
    budget = { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 },
  }
  request_objects[id] = req
  return req
end
function make_e3_write_request(id, capability, path_value, extra_params, extra_refs)
  local refs = json_array({
    { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
    { kind = "file", ref = "file:path:" .. path_value, identity = { scheme = "path", value = path_value } },
  })
  if capability == "media.relink_take_source" then
    refs = json_array({
      { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } },
      { kind = "file", ref = "file:path:" .. path_value, identity = { scheme = "path", value = path_value } },
    })
  end
  if extra_refs then
    for i = 1, #extra_refs do refs[#refs + 1] = extra_refs[i] end
  end
  local req = abi_base(id, "run_command", "template.execute", "media", capability, "write")
  req.params = extra_params or { position_seconds = 0 }
  req.refs = refs
  req.undo = { mode = "required", label = "OpenReaper E3 media composition" }
  return req
end
function make_e3_read_request(id, family_name, params, budget)
  local req = abi_base(id, "query_state", family_name, "media", family_name, "read")
  req.params = params or {}
  req.undo = { mode = "none" }
  if budget then req.budget = budget end
  return req
end
`;
  const transportBind = withTransport
    ? `
-- Real product json.decode (from 00-bridge-kernel) produces fresh tables from serialized request files.
-- Wrap only to record decode order/identity; never return request_objects stubs.
local _product_decode = json.decode
json.decode = function(value)
  local decoded = _product_decode(value)
  if is_object(decoded) and type(decoded.id) == "string" and decoded.id:match("^cmd_") then
    decoded_request_order[#decoded_request_order + 1] = decoded.id
    decoded_request_tables[#decoded_request_tables + 1] = decoded
    decoded_request_cache_at_decode[decoded.id] = decoded.__openreaper_media_target ~= nil
  end
  return decoded
end
`
    : "";
  // Product loop auto-starts on load when TRANSPORT_DIR is set; for tests we only want
  // explicit run_poll, so strip the auto-start tail and expose poll_once/bridge_loop.
  let loopSource = "";
  if (withTransport) {
    loopSource = sources.loopSource
      .replace(/local function poll_once/, "function poll_once")
      .replace(/local function bridge_loop/, "function bridge_loop")
      .replace(
        /math\.randomseed\(os\.time\(\)\)[\s\S]*$/,
        `
math.randomseed(os.time())
function start_e3_transport_loop_for_test()
  snapshot_startup_orphan_claims()
  next_heartbeat_at = monotonic_time() + HEARTBEAT_INTERVAL_SECONDS
  bridge_loop()
end
`,
      );
  }
  const full =
    env +
    "\n" +
    sources.productLua +
    "\n" +
    transportBind +
    "\n" +
    (withTransport ? loopSource + "\n" : "") +
    body +
    "\nreturn true";
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(full));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`E3 composition Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`E3 composition Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
  return sources;
}

function runGeneratedBridgeE3PreflightLua(body) {
  const wrapperStart = BRIDGE_SOURCE.indexOf("local dispatch_request = (function()");
  const wrapperEnd = BRIDGE_SOURCE.indexOf("\nend)()\n", wrapperStart);
  assert.ok(wrapperStart > 0, "generated bridge must contain the dispatch wrapper");
  assert.ok(wrapperEnd > wrapperStart, "generated bridge must close the dispatch wrapper");
  const generatedWrapper = BRIDGE_SOURCE.slice(wrapperStart, wrapperEnd + "\nend)()\n".length);
  assert.match(generatedWrapper, /local READ_B_MEDIA = __openreaper_shared_table\("READ_B_MEDIA"\)/);
  assert.match(generatedWrapper, /READ_B_MEDIA\.preflight_mutation_write\(request\)/);

  const env = `
os.getenv = function() return nil end
existing_files = {}
undo_begins = 0
undo_ends = 0
enum_projects = 0
native_calls = {}
media_project = { path = "/generated-e3.RPP", tracks = { { guid = "{TRACK-GENERATED-E3}" } }, items = {} }
local function native_call(name)
  native_calls[name] = (native_calls[name] or 0) + 1
end
reaper = {}
reaper.EnumProjects = function(index)
  enum_projects = enum_projects + 1
  if index == -1 then return media_project, media_project.path end
  return nil, ""
end
reaper.Undo_BeginBlock2 = function() undo_begins = undo_begins + 1 end
reaper.Undo_EndBlock2 = function() undo_ends = undo_ends + 1 end
reaper.GetTrack = function(_, index) return media_project.tracks[index + 1] end
reaper.GetTrackGUID = function(track) return track and track.guid or nil end
reaper.GetMediaTrackInfo_Value = function(track, key)
  if key == "IP_TRACKNUMBER" then return track and 1 or 0 end
  return 0
end
reaper.CountTracks = function() return #media_project.tracks end
reaper.CountMediaItems = function() return #media_project.items end
reaper.GetMediaItem = function(_, index) return media_project.items[index + 1] end
reaper.CountTakes = function(item) return item and #item.takes or 0 end
reaper.GetTake = function(item, index) return item and item.takes[index + 1] or nil end
reaper.BR_GetMediaItemGUID = function(item) return item and item.guid or nil end
reaper.GetSetMediaItemInfo_String = function(item, key)
  if key == "GUID" then return true, true, item and item.guid or "" end
  return false
end
reaper.PCM_Source_CreateFromFile = function(path)
  native_call("PCM_Source_CreateFromFile")
  if existing_files[path] ~= true then return nil end
  return { path = path, source_type = "WAVE", length = 1.0, channels = 2 }
end
reaper.PCM_Source_CreateFromFileEx = function() native_call("PCM_Source_CreateFromFileEx") end
reaper.PCM_Source_Destroy = function() native_call("PCM_Source_Destroy") end
reaper.GetMediaSourceType = function(source) return source.source_type end
reaper.GetMediaSourceLength = function(source) return source.length, false end
reaper.GetMediaSourceNumChannels = function(source) return source.channels end
reaper.AddMediaItemToTrack = function(track)
  native_call("AddMediaItemToTrack")
  local item = { guid = "{ITEM-GENERATED-E3-" .. tostring(#media_project.items + 1) .. "}", takes = {}, track = track }
  media_project.items[#media_project.items + 1] = item
  return item
end
reaper.SetMediaItemInfo_Value = function() native_call("SetMediaItemInfo_Value") end
reaper.SetMediaItemSelected = function() native_call("SetMediaItemSelected") end
reaper.AddTakeToMediaItem = function(item)
  native_call("AddTakeToMediaItem")
  local take = { guid = "{TAKE-GENERATED-E3-" .. tostring(#item.takes + 1) .. "}" }
  item.takes[#item.takes + 1] = take
  return take
end
reaper.SetMediaItemTake_Source = function(take, source)
  native_call("SetMediaItemTake_Source")
  take.source = source
end
reaper.SetMediaItemTakeInfo_Value = function() native_call("SetMediaItemTakeInfo_Value") end
reaper.UpdateItemInProject = function() native_call("UpdateItemInProject") end
reaper.UpdateArrange = function() native_call("UpdateArrange") end
`;
  const full = `${env}\n${BRIDGE_SOURCE.slice(0, wrapperStart)}\n${generatedWrapper}\n${body}\nreturn true`;
  const state = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(state);
  const loadStatus = lauxlib.luaL_loadstring(state, to_luastring(full));
  if (loadStatus !== lua.LUA_OK) {
    throw new Error(`Generated E3 wrapper Lua load failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  const callStatus = lua.lua_pcall(state, 0, 1, 0);
  if (callStatus !== lua.LUA_OK) {
    throw new Error(`Generated E3 wrapper Lua execution failed: ${to_jsstring(lua.lua_tostring(state, -1))}`);
  }
  assert.equal(lua.lua_toboolean(state, -1), true);
  lua.lua_close(state);
}

describe("Alpha3.4-C3A actual product E3 media composition proof", () => {
  it("runs E3 preflight through the generated wrapper before Undo or native writes", () => {
    runGeneratedBridgeE3PreflightLua(`
file_exists = function(path) return existing_files[path] == true end
local function make_request(id, path, response_bytes)
  return {
    contract = "foundation.bridge.v1",
    id = id,
    created_at = "2026-07-21T00:00:00.000Z",
    timeout_ms = 5000,
    client = { id = "generated-wrapper-e3", session_id = "generated-wrapper-e3" },
    bridge = { expected_owner = "openreaper-live-smoke", expected_generation = 1 },
    operation = { family = "run_command", name = "template.execute" },
    pack = { id = "media", capability = "media.import_file_to_track", risk = "write" },
    params = { position_seconds = 0 },
    refs = json_array({
      { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
      { kind = "file", ref = "file:path:" .. path, identity = { scheme = "path", value = path } },
    }),
    undo = { mode = "required", label = "Generated E3 preflight" },
    verification = { mode = "none", checks = json_array({}) },
    artifacts = { allow = false },
    budget = { max_response_bytes = response_bytes, max_items = 100, max_inline_value_bytes = 4096 },
  }
end
local function assert_zero_write(label)
  assert(undo_begins == 0 and undo_ends == 0, label .. " Undo")
  assert(enum_projects == 0, label .. " EnumProjects")
  assert(next(native_calls) == nil, label .. " native calls")
end

local relative = make_request("cmd_generated_e3_relative", "relative/clip.wav", 65536)
local relative_terminal = dispatch_request(relative, relative.id, nil, { started_at = "2026-07-21T00:00:00.000Z" })
assert(string.find(relative_terminal, "PARAMS_INVALID", 1, true) ~= nil, relative_terminal)
assert_zero_write("relative")

local long_path = ${JSON.stringify(E3_LONG_PATH)}
existing_files[long_path] = true
local low_budget = make_request("cmd_generated_e3_low_budget", long_path, 1000)
local low_terminal = dispatch_request(low_budget, low_budget.id, nil, { started_at = "2026-07-21T00:00:00.000Z" })
assert(string.find(low_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, low_terminal)
assert_zero_write("low budget")

local accepted_path = "/tmp/openreaper-generated-e3.wav"
existing_files[accepted_path] = true
local accepted = make_request("cmd_generated_e3_accepted", accepted_path, 65536)
local accepted_terminal = dispatch_request(accepted, accepted.id, nil, { started_at = "2026-07-21T00:00:00.000Z" })
assert(string.find(accepted_terminal, '"ok":true', 1, true) ~= nil, accepted_terminal)
assert(undo_begins == 1 and undo_ends == 1, "accepted request must have one Undo pair")
assert(native_calls.PCM_Source_CreateFromFile == 1, "accepted request must enter E3 handler once")
assert(native_calls.SetMediaItemTake_Source == 1, "accepted request must set source once")
assert(native_calls.UpdateItemInProject == 1, "accepted request must update item once")
assert(native_calls.SetMediaItemSelected == 1, "accepted request must select imported item once")
assert(native_calls.UpdateArrange == 1, "accepted request must refresh arrange once")
`);
  });

  it("loads product route policy, dispatch, E3 handlers, validate_request, and envelope serialization markers", () => {
    const sources = loadActualProductE3MediaCompositionSources();
    assert.match(sources.routeSource, /READ_B_MEDIA\.preflight_mutation_write/);
    assert.match(sources.routeSource, /open_required_undo_block\(request, key\)/);
    assert.match(sources.policySource, /function open_required_undo_block/);
    assert.match(sources.probeSource, /function READ_B_MEDIA\.preflight_mutation_write/);
    assert.match(sources.probeSource, /complete_success_envelope_fits|success_envelope_bytes/);
    assert.match(sources.e3Source, /function list_folder_media_files/);
    assert.match(sources.productLua, /function dispatch_request/);
    assert.match(sources.productLua, /E3_MEDIA_ROUTE_HANDLERS/);
    assert.match(sources.productLua, /function bridge_ok_envelope|bridge_ok_envelope/);
    assert.match(sources.productLua, /function validate_request/);
    assert.match(sources.validateRequestFn, /Bridge request contract must be foundation\.bridge\.v1/);
  });

  it("executes product validate_request for ABI-complete E3 requests and rejects incomplete ones", () => {
    runActualProductE3MediaCompositionLua(`
local short_path = "/tmp/openreaper-e3-valid.wav"
existing_files[short_path] = true
local ok_req = make_e3_write_request("cmd_e3_valid", "media.import_file_to_track", short_path)
local valid, reason = validate_request(ok_req)
assert(valid == true, "product validate_request must accept complete E3 request: " .. tostring(reason))
local terminal = dispatch_request(ok_req, ok_req.id, nil, { started_at = now_iso() })
assert(string.find(terminal, '"ok":true', 1, true) ~= nil, terminal)

local bad = make_e3_write_request("cmd_e3_bad_contract", "media.import_file_to_track", short_path)
bad.contract = "wrong.contract"
local bad_terminal = dispatch_request(bad, bad.id, nil, { started_at = now_iso() })
assert(string.find(bad_terminal, "REQUEST_INVALID", 1, true) ~= nil, bad_terminal)
assert(string.find(bad_terminal, "foundation.bridge.v1", 1, true) ~= nil or string.find(bad_terminal, "contract", 1, true) ~= nil, bad_terminal)

local bad_undo = make_e3_write_request("cmd_e3_bad_undo", "media.import_file_to_track", short_path)
bad_undo.undo.mode = "none"
local bad_undo_terminal = dispatch_request(bad_undo, bad_undo.id, nil, { started_at = now_iso() })
assert(string.find(bad_undo_terminal, "REQUEST_INVALID", 1, true) ~= nil, bad_undo_terminal)
`);
  });

  it("preflight failures open zero EnumProjects/Undo/mutation; success keeps required Undo", () => {
    runActualProductE3MediaCompositionLua(`
local long_path = ${JSON.stringify(E3_LONG_PATH)}
local short_path = "/tmp/openreaper-e3-short.wav"
existing_files[long_path] = true
existing_files[short_path] = true

-- Relative path fails before Undo.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
local rel_req = make_e3_write_request("cmd_e3_rel", "media.import_file_to_track", "relative/clip.wav")
local rel_terminal = dispatch_request(rel_req, rel_req.id, nil, { started_at = now_iso() })
assert(type(rel_terminal) == "string", rel_terminal)
assert(string.find(rel_terminal, '"ok":false', 1, true) ~= nil, rel_terminal)
assert(string.find(rel_terminal, "PARAMS_INVALID", 1, true) ~= nil or string.find(rel_terminal, "relative_path", 1, true) ~= nil, rel_terminal)
assert(#undo_begins == 0 and #undo_ends == 0, "relative must not open Undo")
assert(#mutation_calls == 0, "relative must not mutate")
assert(enum_project_calls == 0, "relative preflight must not EnumProjects")

-- Low response budget fails before Undo.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
local low_req = make_e3_write_request("cmd_e3_low", "media.import_file_to_track", long_path)
low_req.budget.max_response_bytes = 1000
local low_terminal = dispatch_request(low_req, low_req.id, nil, { started_at = now_iso() })
assert(type(low_terminal) == "string", low_terminal)
assert(string.find(low_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, low_terminal)
assert(#undo_begins == 0 and #undo_ends == 0)
assert(#mutation_calls == 0)
assert(enum_project_calls == 0)

-- Large request-echoed fields (undo label / verification checks / idempotency) fail pre-Undo.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
local echo_req = make_e3_write_request("cmd_e3_echo", "media.import_file_to_track", short_path)
echo_req.undo.label = string.rep("L", 8000)
echo_req.verification.checks = json_array({ string.rep("C", 4000), string.rep("D", 4000) })
echo_req.idempotency_key = string.rep("K", 4000)
echo_req.budget.max_response_bytes = 12000
local echo_ok, echo_fail = READ_B_MEDIA.preflight_mutation_write(echo_req)
assert(echo_ok == false, "preflight must reject oversized echoed fields")
assert(echo_fail.code == "RESPONSE_TOO_LARGE", echo_fail and echo_fail.code or "nil")
assert(echo_fail.details and echo_fail.details.blocker == "success_envelope_budget_insufficient", echo_fail and echo_fail.details and echo_fail.details.blocker or "nil")
assert(echo_fail.details.zero_write == true)
local echo_terminal = dispatch_request(echo_req, echo_req.id, nil, { started_at = now_iso() })
assert(string.find(echo_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, echo_terminal)
assert(#undo_begins == 0 and #mutation_calls == 0 and enum_project_calls == 0)

-- Contradictory bad ref followed by valid ref fails closed.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
local bad_then_good = make_e3_write_request("cmd_e3_contra", "media.import_file_to_track", short_path)
bad_then_good.refs = json_array({
  { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
  { kind = "file", ref = "file:path:relative/bad.wav", identity = { scheme = "path", value = "relative/bad.wav" } },
  { kind = "file", ref = "file:path:" .. short_path, identity = { scheme = "path", value = short_path } },
})
local contra_terminal = dispatch_request(bad_then_good, bad_then_good.id, nil, { started_at = now_iso() })
assert(string.find(contra_terminal, '"ok":false', 1, true) ~= nil, contra_terminal)
assert(#undo_begins == 0 and #mutation_calls == 0 and enum_project_calls == 0)

-- Success path opens required Undo and mutates once.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
local ok_req = make_e3_write_request("cmd_e3_ok", "media.import_file_to_track", short_path)
local ok_terminal = dispatch_request(ok_req, ok_req.id, nil, { started_at = now_iso() })
assert(type(ok_terminal) == "string", ok_terminal)
assert(string.find(ok_terminal, '"ok":true', 1, true) ~= nil, ok_terminal)
assert(string.find(ok_terminal, short_path, 1, true) ~= nil, ok_terminal)
assert(#undo_begins == 1 and #undo_ends == 1, "success must open/close required Undo")
assert(#mutation_calls > 0)
assert(enum_project_calls >= 1)
`);
  });

  it("long-path import/section/relink succeed through real product composition", () => {
    runActualProductE3MediaCompositionLua(`
local long_path = ${JSON.stringify(E3_LONG_PATH)}
existing_files[long_path] = true
assert(#long_path > 240)

-- Seed one take for relink.
media_project.items = {
  {
    guid = "{ITEM-SEED}",
    takes = { { guid = "{TAKE-SEED}", source = { path = "/tmp/old.wav", source_type = "WAVE", length = 1.0, channels = 2 } } },
  },
}
existing_files["/tmp/old.wav"] = true

local cases = {
  { id = "cmd_e3_long_import", capability = "media.import_file_to_track", params = { position_seconds = 0 } },
  { id = "cmd_e3_long_section", capability = "media.import_file_section_to_track", params = { position_seconds = 0, start_percent = 0.1, end_percent = 0.9 } },
  { id = "cmd_e3_long_relink", capability = "media.relink_take_source", params = {} },
}
for _, case in ipairs(cases) do
  undo_begins, undo_ends, mutation_calls = {}, {}, {}
  local req = make_e3_write_request(case.id, case.capability, long_path, case.params)
  req.budget.max_inline_value_bytes = 4096
  local terminal = dispatch_request(req, req.id, nil, { started_at = now_iso() })
  assert(type(terminal) == "string", case.capability .. " " .. tostring(terminal))
  assert(string.find(terminal, '"ok":true', 1, true) ~= nil, case.capability .. " " .. terminal)
  assert(string.find(terminal, long_path, 1, true) ~= nil, case.capability .. " missing full path")
  assert(#undo_begins == 1 and #undo_ends == 1, case.capability .. " undo")
  assert(#mutation_calls > 0, case.capability .. " mutations")
end
`);
  });

  it("low-budget take/project/folder/section fail closed without oversized success envelopes", () => {
    runActualProductE3MediaCompositionLua(`
local long_path = ${JSON.stringify(E3_LONG_PATH)}
existing_files[long_path] = true
media_project.items = {
  {
    guid = "{ITEM-LOW}",
    takes = { { guid = "{TAKE-LOW}", source = { path = long_path, source_type = "WAVE", length = 1.5, channels = 2 } } },
  },
}
folder_files["/Users/Shared/OpenReaper/library session 演示资料"] = { "clip 源文件 final.wav" }

-- take source low inline
local take_req = make_e3_read_request("cmd_e3_take_low", "media.take_source.read", { include_metadata_keys = false }, {
  max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 64,
})
take_req.refs = json_array({ { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } } })
local take_terminal = dispatch_request(take_req, take_req.id, nil, { started_at = now_iso() })
assert(string.find(take_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, take_terminal)

-- project list single long identity cannot fit tiny response budget
local proj_req = make_e3_read_request("cmd_e3_proj_low", "media.project_files.read", { include_offline = true, max_sources = 10 }, {
  max_response_bytes = 80, max_items = 50, max_inline_value_bytes = 4096,
})
local proj_terminal = dispatch_request(proj_req, proj_req.id, nil, { started_at = now_iso() })
assert(string.find(proj_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, proj_terminal)

-- folder empty still validates folder_ref budget
local empty_folder = "/Users/Shared/OpenReaper/empty media 文件夹"
folder_files[empty_folder] = {}
local folder_req = make_e3_read_request("cmd_e3_folder_low", "media.folder_media.list", {
  folder_ref = "folder:path:" .. empty_folder, media_type = "any", limit = 10, offset = 0,
}, { max_response_bytes = 65536, max_items = 50, max_inline_value_bytes = 20 })
local folder_terminal = dispatch_request(folder_req, folder_req.id, nil, { started_at = now_iso() })
assert(string.find(folder_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, folder_terminal)

-- section import low response budget pre-undo
undo_begins, mutation_calls = {}, {}
local section_req = make_e3_write_request("cmd_e3_section_low", "media.import_file_section_to_track", long_path, {
  position_seconds = 0, start_percent = 0.1, end_percent = 0.9,
})
section_req.budget.max_response_bytes = 1000
local section_terminal = dispatch_request(section_req, section_req.id, nil, { started_at = now_iso() })
assert(string.find(section_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, section_terminal)
assert(#undo_begins == 0 and #mutation_calls == 0)
`);
  });

  it("proves worst-case upper-bound exact terminal equality and long-GUID import/section success", () => {
    runActualProductE3MediaCompositionLua(`
local unknown_path = "/tmp/openreaper-e3-fit.unknownext"
existing_files[unknown_path] = true
local max_guid = READ_B_MEDIA.mutation_max_guid_value()
if #max_guid ~= READ_B_MEDIA.mutation_guid_max_bytes() then error("LEN") end
if READ_B_MEDIA.json_string_content_bytes(max_guid) ~= READ_B_MEDIA.mutation_guid_max_bytes() then
  error("JSON_BYTES " .. tostring(READ_B_MEDIA.json_string_content_bytes(max_guid)))
end
if READ_B_MEDIA.identity_value_within_mutation_bound(max_guid) ~= true then error("MAX_GUID_BOUND") end
-- Escaped-content bound: quote/backslash inflate JSON content beyond 240 raw-G budget.
local quote_guid = string.rep('"', 130)
if not (READ_B_MEDIA.json_string_content_bytes(quote_guid) > READ_B_MEDIA.mutation_guid_max_bytes()) then
  error("QUOTE_BYTES " .. tostring(READ_B_MEDIA.json_string_content_bytes(quote_guid)))
end
if READ_B_MEDIA.identity_value_within_mutation_bound(quote_guid) ~= false then error("QUOTE_BOUND") end

-- Worst-case real product success: max accepted GUID lengths + source_type unknown.
media_project.tracks = { { guid = max_guid } }
reaper.AddMediaItemToTrack = function(track)
  record_mutation("AddMediaItemToTrack")
  local item = { guid = max_guid, takes = {} }
  media_project.items = media_project.items or {}
  media_project.items[#media_project.items + 1] = item
  return item
end
reaper.AddTakeToMediaItem = function(item)
  record_mutation("AddTakeToMediaItem")
  local take = { guid = max_guid, source = nil }
  item.takes = item.takes or {}
  item.takes[#item.takes + 1] = take
  return take
end

local function make_worst(budget_bytes)
  local r = make_e3_write_request("cmd_e3_worst", "media.import_file_to_track", unknown_path)
  r.budget.max_response_bytes = budget_bytes
  return r
end

-- Converge, then always re-dispatch at the converged bound (no early exit without execution).
local bound = 1200
for _ = 1, 16 do
  media_project.items = {}
  undo_begins, undo_ends, mutation_calls = {}, {}, {}
  local req = make_worst(bound)
  local probe = dispatch_request(req, req.id, nil, { started_at = now_iso() })
  if type(probe) ~= "string" then error("PROBE_TYPE " .. type(probe)) end
  if string.find(probe, '"ok":true', 1, true) then
    if #probe == bound then
      break
    end
    bound = #probe
  else
    local needed = tonumber(string.match(probe, '"required_response_bytes":(%d+)'))
    if needed == nil then error("NEEDED_DIAG " .. probe:sub(1, 400)) end
    bound = needed
  end
end
media_project.items = {}
undo_begins, undo_ends, mutation_calls = {}, {}, {}
local terminal = dispatch_request(make_worst(bound), "cmd_e3_worst", nil, { started_at = now_iso() })
if not (type(terminal) == "string" and string.find(terminal, '"ok":true', 1, true)) then
  error("FINAL_OK_DIAG bound=" .. tostring(bound) .. " " .. tostring(terminal))
end
if not string.find(terminal, '"max_response_bytes":' .. tostring(bound), 1, true) then
  error("MAX_BYTES_DIAG bound=" .. tostring(bound) .. " actual_len=" .. tostring(#terminal) .. " " .. tostring(terminal):sub(1, 400))
end
if #terminal ~= bound then
  error("EQ_DIAG actual=" .. tostring(#terminal) .. " bound=" .. tostring(bound))
end
if not string.find(terminal, '"source_file_ref":"file:path:' .. unknown_path .. '"', 1, true) then
  error("SOURCE_REF_DIAG " .. tostring(terminal):sub(1, 500))
end
if not string.find(terminal, max_guid, 1, true) then
  error("GUID_DIAG missing max guid")
end
if not (#undo_begins == 1 and #mutation_calls > 0) then
  error("UNDO_MUT_DIAG undo=" .. tostring(#undo_begins) .. " mut=" .. tostring(#mutation_calls) .. " term_len=" .. tostring(#terminal))
end

-- bound-1 rejects before Undo/write.
undo_begins, undo_ends, mutation_calls = {}, {}, {}
enum_project_calls = 0
media_project.items = {}
local reject_terminal = dispatch_request(make_worst(bound - 1), "cmd_e3_worst", nil, { started_at = now_iso() })
if not (type(reject_terminal) == "string" and string.find(reject_terminal, "RESPONSE_TOO_LARGE", 1, true)) then
  error("REJECT_DIAG " .. tostring(reject_terminal) .. " undo=" .. tostring(#undo_begins) .. " mut=" .. tostring(#mutation_calls))
end
if not (#undo_begins == 0 and #mutation_calls == 0 and enum_project_calls == 0) then
  error("REJECT_COUNTS undo=" .. tostring(#undo_begins) .. " mut=" .. tostring(#mutation_calls) .. " enum=" .. tostring(enum_project_calls))
end

-- Quote/backslash/control GUID: escaped content exceeds bound → index fallback; stay under envelope.
local bs = string.char(92)
local special_guids = {
  string.rep('"', 130),
  string.rep(bs, 130),
  string.rep(string.char(9), 130),
  string.rep("Z", READ_B_MEDIA.mutation_guid_max_bytes() + 80),
}
local roomy = math.max(bound + 512, 4096)
for si, special in ipairs(special_guids) do
  if READ_B_MEDIA.identity_value_within_mutation_bound(special) ~= false then
    error("SPECIAL_BOUND_DIAG idx=" .. tostring(si) .. " esc=" .. tostring(READ_B_MEDIA.json_string_content_bytes(special)))
  end
  media_project.tracks = { { guid = special } }
  reaper.AddMediaItemToTrack = function(track)
    record_mutation("AddMediaItemToTrack")
    local item = { guid = special, takes = {} }
    media_project.items = media_project.items or {}
    media_project.items[#media_project.items + 1] = item
    return item
  end
  reaper.AddTakeToMediaItem = function(item)
    record_mutation("AddTakeToMediaItem")
    local take = { guid = special, source = nil }
    item.takes = item.takes or {}
    item.takes[#item.takes + 1] = take
    return take
  end
  for _, case in ipairs({
    { id = "cmd_e3_sp_import", capability = "media.import_file_to_track", params = { position_seconds = 0 } },
    { id = "cmd_e3_sp_section", capability = "media.import_file_section_to_track", params = { position_seconds = 0, start_percent = 0.1, end_percent = 0.9 } },
  }) do
    media_project.items = {}
    undo_begins, mutation_calls = {}, {}
    local req = make_e3_write_request(case.id, case.capability, unknown_path, case.params)
    req.budget.max_response_bytes = roomy
    local term = dispatch_request(req, req.id, nil, { started_at = now_iso() })
    if not (type(term) == "string" and string.find(term, '"ok":true', 1, true)) then
      error("IMPORT_DIAG " .. case.capability .. " " .. tostring(term))
    end
    if #term > roomy then error("IMPORT_SIZE " .. case.capability .. " " .. tostring(#term) .. ">" .. tostring(roomy)) end
    if not string.find(term, '"track_ref":"track:index:0"', 1, true) then error("IMPORT_TRACK_IDX " .. case.capability .. " " .. term:sub(1, 300)) end
    if not string.find(term, '"imported_item_refs":["item:index:0"]', 1, true) then error("IMPORT_ITEM_IDX " .. case.capability .. " " .. term:sub(1, 300)) end
    if string.find(term, special, 1, true) then error("IMPORT_ECHO_SPECIAL " .. case.capability) end
    if not (#undo_begins == 1 and #mutation_calls > 0) then error("IMPORT_UNDO " .. case.capability) end
  end
  media_project.items = {
    {
      guid = special,
      takes = { { guid = special, source = { path = "/tmp/old.wav", source_type = "WAVE", length = 1.0, channels = 2 } } },
    },
  }
  existing_files["/tmp/old.wav"] = true
  undo_begins, mutation_calls = {}, {}
  local relink = make_e3_write_request("cmd_e3_sp_relink", "media.relink_take_source", unknown_path, {})
  relink.budget.max_response_bytes = roomy
  local relink_term = dispatch_request(relink, relink.id, nil, { started_at = now_iso() })
  if not (type(relink_term) == "string" and string.find(relink_term, '"ok":true', 1, true)) then
    error("RELINK_DIAG " .. tostring(relink_term))
  end
  if #relink_term > roomy then error("RELINK_SIZE " .. tostring(#relink_term)) end
  if not string.find(relink_term, '"take_ref":"take:index:0"', 1, true) then error("RELINK_TAKE_IDX " .. relink_term:sub(1, 300)) end
  if not string.find(relink_term, '"source_type":"unknown"', 1, true) then error("RELINK_STYPE " .. relink_term:sub(1, 300)) end
  if string.find(relink_term, special, 1, true) then error("RELINK_ECHO_SPECIAL") end
  if not (#undo_begins == 1 and #mutation_calls > 0) then error("RELINK_UNDO") end
end

-- Tiny budget still rejects before Undo/write.
undo_begins, mutation_calls = {}, {}
enum_project_calls = 0
media_project.items = {}
media_project.tracks = { { guid = max_guid } }
local tiny = make_e3_write_request("cmd_e3_long_tiny", "media.import_file_to_track", unknown_path, { position_seconds = 0 })
tiny.budget.max_response_bytes = 900
local tiny_term = dispatch_request(tiny, tiny.id, nil, { started_at = now_iso() })
if not (type(tiny_term) == "string" and string.find(tiny_term, "RESPONSE_TOO_LARGE", 1, true)) then
  error("TINY_DIAG " .. tostring(tiny_term))
end
if not (#undo_begins == 0 and #mutation_calls == 0 and enum_project_calls == 0) then
  error("TINY_COUNTS")
end

-- Track identity unavailable before mutation (GUID over bound + enumeration fails): zero-write.
media_project.tracks = { { guid = quote_guid } }
reaper.GetMediaTrackInfo_Value = function() return 0 end
reaper.CountTracks = function() return false end
undo_begins, mutation_calls = {}, {}
enum_project_calls = 0
media_project.items = {}
local enum_fail = make_e3_write_request("cmd_e3_enum_fail", "media.import_file_to_track", unknown_path, { position_seconds = 0 })
enum_fail.budget.max_response_bytes = roomy
local enum_term = dispatch_request(enum_fail, enum_fail.id, nil, { started_at = now_iso() })
if not (type(enum_term) == "string" and string.find(enum_term, "track_identity_unavailable", 1, true)) then
  error("ENUM_FAIL_DIAG " .. tostring(enum_term) .. " undo=" .. tostring(#undo_begins) .. " mut=" .. tostring(#mutation_calls))
end
if string.find(enum_term, "track:index:0", 1, true) then error("ENUM_IDX0 " .. enum_term:sub(1, 300)) end
if string.find(enum_term, '"ok":true', 1, true) then error("ENUM_OK") end
-- Pre-Undo fail-closed: zero Undo open and zero media mutation.
if #undo_begins ~= 0 then error("ENUM_UNDO " .. tostring(#undo_begins)) end
if #mutation_calls ~= 0 then error("ENUM_MUT " .. tostring(#mutation_calls)) end

-- Restore track enumeration; item identity unavailable after mutation (GUID over bound + item enum fails).
reaper.GetMediaTrackInfo_Value = function(track, key)
  if key == "IP_TRACKNUMBER" then return 1 end
  return 0
end
reaper.CountTracks = function() return #media_project.tracks end
media_project.tracks = { { guid = max_guid } }
reaper.AddMediaItemToTrack = function(track)
  record_mutation("AddMediaItemToTrack")
  local item = { guid = quote_guid, takes = {} }
  media_project.items = media_project.items or {}
  media_project.items[#media_project.items + 1] = item
  return item
end
reaper.AddTakeToMediaItem = function(item)
  record_mutation("AddTakeToMediaItem")
  local take = { guid = max_guid, source = nil }
  item.takes = item.takes or {}
  item.takes[#item.takes + 1] = take
  return take
end
reaper.CountMediaItems = function() return false end
undo_begins, undo_ends, mutation_calls = {}, {}, {}
open_undo_handle = nil
media_project.items = {}
local item_id_fail = make_e3_write_request("cmd_e3_item_id_fail", "media.import_file_to_track", unknown_path, { position_seconds = 0 })
item_id_fail.budget.max_response_bytes = roomy
local item_fail_term = dispatch_request(item_id_fail, item_id_fail.id, nil, { started_at = now_iso() })
if not (type(item_fail_term) == "string" and string.find(item_fail_term, "item_identity_unavailable", 1, true)) then
  error("ITEM_FAIL_DIAG " .. tostring(item_fail_term) .. " mutations=" .. tostring(#mutation_calls))
end
if string.find(item_fail_term, "item:index:0", 1, true) then error("ITEM_IDX0") end
if not string.find(item_fail_term, '"zero_write":false', 1, true) then error("ITEM_ZW " .. item_fail_term:sub(1, 400)) end
if not string.find(item_fail_term, '"recoverable":false', 1, true) then error("ITEM_REC " .. item_fail_term:sub(1, 400)) end
if not string.find(item_fail_term, '"outcome":"unknown"', 1, true) then error("ITEM_OUTCOME " .. item_fail_term:sub(1, 400)) end
if not (#mutation_calls > 0) then error("ITEM_MUT0") end
if #undo_begins ~= 1 then error("ITEM_UNDO_BEGIN_COUNT " .. tostring(#undo_begins)) end
if #undo_ends ~= 1 then error("ITEM_UNDO_END_COUNT " .. tostring(#undo_ends)) end
if undo_begins[1].project ~= current_project and undo_begins[1].project ~= media_project then
  error("ITEM_UNDO_BEGIN_PROJECT")
end
if undo_ends[1].project ~= undo_begins[1].project then error("ITEM_UNDO_PROJECT_MISMATCH") end
if undo_begins[1].api ~= "Undo_BeginBlock2" and undo_begins[1].api ~= "Undo_BeginBlock" then
  error("ITEM_UNDO_BEGIN_API " .. tostring(undo_begins[1].api))
end
if undo_ends[1].api ~= "Undo_EndBlock2" and undo_ends[1].api ~= "Undo_EndBlock" then
  error("ITEM_UNDO_END_API " .. tostring(undo_ends[1].api))
end
-- Paired project-API or non-project-API close.
if undo_begins[1].api == "Undo_BeginBlock2" and undo_ends[1].api ~= "Undo_EndBlock2" then
  error("ITEM_UNDO_API_PAIR")
end
if undo_begins[1].api == "Undo_BeginBlock" and undo_ends[1].api ~= "Undo_EndBlock" then
  error("ITEM_UNDO_API_PAIR_FALLBACK")
end
if open_undo_handle ~= nil then error("ITEM_UNDO_STILL_OPEN") end

-- Take identity unavailable before relink: resolve via selected item succeeds, but
-- over-bound GUID + CountMediaItems failure prevents take_ref_string (no fabricated index 0).
local selected_take = { guid = quote_guid, source = { path = "/tmp/old.wav", source_type = "WAVE", length = 1.0, channels = 2 } }
local selected_item = { guid = quote_guid, takes = { selected_take } }
media_project.items = { selected_item }
existing_files["/tmp/old.wav"] = true
reaper.CountSelectedMediaItems = function() return 1 end
reaper.GetSelectedMediaItem = function(_, index)
  if index == 0 then return selected_item end
  return nil
end
reaper.GetActiveTake = function(item)
  if item == selected_item then return selected_take end
  return nil
end
reaper.CountMediaItems = function() return false end
undo_begins, mutation_calls = {}, {}
enum_project_calls = 0
local take_fail = make_e3_write_request("cmd_e3_take_id_fail", "media.relink_take_source", unknown_path, {})
take_fail.refs = json_array({
  { kind = "take", ref = "take:selected:0", identity = { scheme = "selected", value = "0" } },
  { kind = "file", ref = "file:path:" .. unknown_path, identity = { scheme = "path", value = unknown_path } },
})
take_fail.budget.max_response_bytes = roomy
local take_fail_term = dispatch_request(take_fail, take_fail.id, nil, { started_at = now_iso() })
if not (type(take_fail_term) == "string" and string.find(take_fail_term, "take_identity_unavailable", 1, true)) then
  error("TAKE_FAIL_DIAG " .. tostring(take_fail_term) .. " mutations=" .. tostring(#mutation_calls) .. " undo=" .. tostring(#undo_begins))
end
if string.find(take_fail_term, "take:index:0", 1, true) then error("TAKE_IDX0") end
if string.find(take_fail_term, '"ok":true', 1, true) then error("TAKE_OK") end
if #undo_begins ~= 0 then error("TAKE_UNDO " .. tostring(#undo_begins)) end
if #mutation_calls ~= 0 then error("TAKE_MUT " .. tostring(#mutation_calls)) end
`);
  });
  it("project/folder multi-row pages shrink at complete item boundaries with exact row membership", () => {
    runActualProductE3MediaCompositionLua(`
local paths = {
  "/tmp/a-short.wav",
  "/tmp/b-short.wav",
  "/tmp/c-short.wav",
  "/tmp/d-short.wav",
}
for _, path in ipairs(paths) do existing_files[path] = true end
media_project.items = {}
for index, path in ipairs(paths) do
  media_project.items[#media_project.items + 1] = {
    guid = "{ITEM-P" .. tostring(index) .. "}",
    takes = { { guid = "{TAKE-P" .. tostring(index) .. "}", source = { path = path, source_type = "WAVE", length = 1.0, channels = 2 } } },
  }
end

local roomy = make_e3_read_request("cmd_e3_page_roomy", "media.project_files.read", {
  include_offline = true, max_sources = 10,
}, { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 })
local roomy_terminal = dispatch_request(roomy, roomy.id, nil, { started_at = now_iso() })
assert(string.find(roomy_terminal, '"ok":true', 1, true) ~= nil, roomy_terminal)
assert(string.find(roomy_terminal, '"source_count":4', 1, true) ~= nil, roomy_terminal)
for _, path in ipairs(paths) do
  assert(string.find(roomy_terminal, "file:path:" .. path, 1, true) ~= nil, "missing " .. path)
end
local roomy_bytes = #roomy_terminal

-- Find a mid budget that returns fewer than 4 complete identity rows and sets truncated=true.
local mid_budget = nil
local mid_terminal = nil
local mid_count = nil
for budget = roomy_bytes - 1, 700, -5 do
  local mid = make_e3_read_request("cmd_e3_page_mid", "media.project_files.read", {
    include_offline = true, max_sources = 10,
  }, { max_response_bytes = budget, max_items = 100, max_inline_value_bytes = 4096 })
  local terminal = dispatch_request(mid, mid.id, nil, { started_at = now_iso() })
  if type(terminal) == "string" and string.find(terminal, '"ok":true', 1, true)
      and string.find(terminal, '"truncated":true', 1, true) then
    local count = 0
    for _, path in ipairs(paths) do
      if string.find(terminal, "file:path:" .. path, 1, true) then
        count = count + 1
      end
    end
    if count >= 1 and count < 4 then
      mid_budget = budget
      mid_terminal = terminal
      mid_count = count
      break
    end
  end
end
assert(mid_terminal ~= nil and mid_count ~= nil, "must find a truncated multi-row page")
assert(#mid_terminal <= mid_budget)
assert(string.find(mid_terminal, '"truncated":true', 1, true) ~= nil)
assert(string.find(mid_terminal, '"source_count":4', 1, true) ~= nil)
-- Exact membership: first mid_count paths included; remaining excluded (handler order is discovery order).
for index, path in ipairs(paths) do
  local present = string.find(mid_terminal, "file:path:" .. path, 1, true) ~= nil
  if index <= mid_count then
    assert(present == true, "expected included row " .. path)
  else
    assert(present == false, "expected excluded row " .. path)
  end
end

-- Folder multi-row paging with exact membership.
local folder = "/tmp/openreaper-folder-page"
folder_files[folder] = { "a-short.wav", "b-short.wav", "c-short.wav", "d-short.wav" }
local folder_paths = {
  folder .. "/a-short.wav",
  folder .. "/b-short.wav",
  folder .. "/c-short.wav",
  folder .. "/d-short.wav",
}
for _, path in ipairs(folder_paths) do existing_files[path] = true end
local folder_roomy = make_e3_read_request("cmd_e3_folder_roomy", "media.folder_media.list", {
  folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0,
}, { max_response_bytes = 65536, max_items = 100, max_inline_value_bytes = 4096 })
local folder_roomy_terminal = dispatch_request(folder_roomy, folder_roomy.id, nil, { started_at = now_iso() })
assert(string.find(folder_roomy_terminal, '"ok":true', 1, true) ~= nil, folder_roomy_terminal)
assert(string.find(folder_roomy_terminal, '"total_matching_count":4', 1, true) ~= nil, folder_roomy_terminal)
assert(string.find(folder_roomy_terminal, '"row_count":4', 1, true) ~= nil, folder_roomy_terminal)
local folder_roomy_bytes = #folder_roomy_terminal
local folder_mid_terminal = nil
local folder_mid_count = nil
local folder_mid_budget = nil
for budget = folder_roomy_bytes - 1, 900, -5 do
  local mid = make_e3_read_request("cmd_e3_folder_mid", "media.folder_media.list", {
    folder_ref = "folder:path:" .. folder, media_type = "any", limit = 10, offset = 0,
  }, { max_response_bytes = budget, max_items = 100, max_inline_value_bytes = 4096 })
  local terminal = dispatch_request(mid, mid.id, nil, { started_at = now_iso() })
  if type(terminal) == "string" and string.find(terminal, '"ok":true', 1, true)
      and string.find(terminal, '"truncated":true', 1, true) then
    local count = 0
    for _, path in ipairs(folder_paths) do
      if string.find(terminal, "file:path:" .. path, 1, true) then
        count = count + 1
      end
    end
    if count >= 1 and count < 4 then
      folder_mid_budget = budget
      folder_mid_terminal = terminal
      folder_mid_count = count
      break
    end
  end
end
assert(folder_mid_terminal ~= nil, "must find truncated folder page")
assert(#folder_mid_terminal <= folder_mid_budget)
assert(string.find(folder_mid_terminal, '"row_count":' .. tostring(folder_mid_count), 1, true) ~= nil, folder_mid_terminal)
assert(string.find(folder_mid_terminal, '"total_matching_count":4', 1, true) ~= nil, folder_mid_terminal)
for index, path in ipairs(folder_paths) do
  local present = string.find(folder_mid_terminal, "file:path:" .. path, 1, true) ~= nil
  if index <= folder_mid_count then
    assert(present == true, "folder expected included " .. path)
  else
    assert(present == false, "folder expected excluded " .. path)
  end
end

-- Single oversized identity under tiny complete envelope fails typed.
local long_path = ${JSON.stringify(E3_LONG_PATH)}
existing_files[long_path] = true
media_project.items = {
  {
    guid = "{ITEM-LONG}",
    takes = { { guid = "{TAKE-LONG}", source = { path = long_path, source_type = "WAVE", length = 1.0, channels = 2 } } },
  },
}
local single = make_e3_read_request("cmd_e3_page_single", "media.project_files.read", {
  include_offline = true, max_sources = 10,
}, { max_response_bytes = 400, max_items = 100, max_inline_value_bytes = 4096 })
local single_terminal = dispatch_request(single, single.id, nil, { started_at = now_iso() })
assert(string.find(single_terminal, "RESPONSE_TOO_LARGE", 1, true) ~= nil, single_terminal)
assert(string.find(single_terminal, '"ok":true', 1, true) == nil, single_terminal)
`);
  });

  it("empty folder and POSIX backslash join through product folder list dispatch", () => {
    runActualProductE3MediaCompositionLua(`
local empty_folder = "/Users/Shared/OpenReaper/empty media folder"
folder_files[empty_folder] = {}
local empty_req = make_e3_read_request("cmd_e3_empty", "media.folder_media.list", {
  folder_ref = "folder:path:" .. empty_folder, media_type = "any", limit = 10, offset = 0,
})
local empty_terminal = dispatch_request(empty_req, empty_req.id, nil, { started_at = now_iso() })
assert(string.find(empty_terminal, '"ok":true', 1, true) ~= nil, empty_terminal)
assert(string.find(empty_terminal, empty_folder, 1, true) ~= nil, empty_terminal)
assert(string.find(empty_terminal, '"row_count":0', 1, true) ~= nil, empty_terminal)
assert(string.find(empty_terminal, '"total_matching_count":0', 1, true) ~= nil, empty_terminal)

local bs = string.char(92)
local posix_folder = "/tmp/openreaper" .. bs .. "legal-backslash-name"
folder_files[posix_folder] = { "clip.wav" }
local posix_req = make_e3_read_request("cmd_e3_posix_bs", "media.folder_media.list", {
  folder_ref = "folder:path:" .. posix_folder, media_type = "any", limit = 10, offset = 0,
})
local posix_terminal = dispatch_request(posix_req, posix_req.id, nil, { started_at = now_iso() })
assert(string.find(posix_terminal, '"ok":true', 1, true) ~= nil, posix_terminal)
local json_path = "/tmp/openreaper" .. bs .. bs .. "legal-backslash-name/clip.wav"
assert(string.find(posix_terminal, json_path, 1, true) ~= nil, posix_terminal)
assert(string.find(posix_terminal, "file:path:/tmp/openreaper", 1, true) ~= nil, posix_terminal)
assert(string.find(posix_terminal, "legal-backslash-name/clip.wav", 1, true) ~= nil, posix_terminal)
`);
  });

  it("fails E3 required Undo begin closed before mutation when both begin APIs fail", () => {
    runActualProductE3MediaCompositionLua(`
local path = "/tmp/openreaper-e3-undo-fail.wav"
existing_files[path] = true
force_undo_begin_fail = true
for _, capability in ipairs({
  "media.import_file_to_track",
  "media.import_file_section_to_track",
  "media.relink_take_source",
}) do
  media_project.items = {
    {
      guid = "{ITEM-UNDO-SEED}",
      takes = { { guid = "{TAKE-UNDO-SEED}", source = { path = path, source_type = "WAVE", length = 1.0, channels = 2 } } },
    },
  }
  undo_begins, undo_ends, mutation_calls = {}, {}, {}
  enum_project_calls = 0
  local params = capability == "media.import_file_section_to_track"
    and { position_seconds = 0, start_percent = 0.1, end_percent = 0.9 }
    or { position_seconds = 0 }
  local req = make_e3_write_request("cmd_e3_undo_" .. capability:gsub("%.", "_"), capability, path, params)
  local terminal = dispatch_request(req, req.id, nil, { started_at = now_iso() })
  assert(type(terminal) == "string", capability .. " " .. tostring(terminal))
  assert(string.find(terminal, '"ok":true', 1, true) == nil, capability .. " " .. terminal)
  assert(string.find(terminal, "COMMAND_FAILED", 1, true) ~= nil, capability .. " " .. terminal)
  assert(string.find(terminal, "required_undo_begin_failed", 1, true) ~= nil, capability .. " " .. terminal)
  assert(string.find(terminal, '"zero_write":true', 1, true) ~= nil, capability .. " " .. terminal)
  assert(string.find(terminal, '"recoverable":true', 1, true) ~= nil, capability .. " " .. terminal)
  assert(#mutation_calls == 0, capability .. " mutations=" .. tostring(#mutation_calls))
  assert(open_undo_handle == nil, capability)
end
force_undo_begin_fail = false
`);
  });

  it("proves FIFO product file-transport isolation for consecutive E3 writes without target inheritance", () => {
    runActualProductE3MediaCompositionLua(
      `
local path_a = "/tmp/openreaper-e3-cache-a.wav"
local path_b = "/tmp/openreaper-e3-cache-b.wav"
existing_files[path_a] = true
existing_files[path_b] = true

local track_a = { guid = "{TRACK-CACHE-A}" }
local track_b = { guid = "{TRACK-CACHE-B}" }
media_project.tracks = { track_a, track_b }
media_project.items = {}

reaper.GetTrack = function(_, index)
  return media_project.tracks[index + 1]
end
reaper.GetTrackGUID = function(track)
  return track and track.guid or nil
end
reaper.GetMediaTrackInfo_Value = function(track, key)
  if key == "IP_TRACKNUMBER" then
    if track == track_a then return 1 end
    if track == track_b then return 2 end
  end
  return 0
end
reaper.CountTracks = function() return #media_project.tracks end
reaper.AddMediaItemToTrack = function(track)
  record_mutation("AddMediaItemToTrack")
  local item = {
    guid = track == track_a and "{ITEM-CACHE-A}" or "{ITEM-CACHE-B}",
    track = track,
    takes = {},
  }
  media_project.items[#media_project.items + 1] = item
  return item
end
reaper.AddTakeToMediaItem = function(item)
  record_mutation("AddTakeToMediaItem")
  local take = {
    guid = item.guid == "{ITEM-CACHE-A}" and "{TAKE-CACHE-A}" or "{TAKE-CACHE-B}",
    source = nil,
  }
  item.takes[#item.takes + 1] = take
  return take
end

local function forbid_internal_leak(terminal, label)
  assert(type(terminal) == "string", label .. " terminal type")
  assert(string.find(terminal, "__openreaper_media_target", 1, true) == nil, label .. " leaked cache key: " .. terminal)
  assert(string.find(terminal, "__openreaper_", 1, true) == nil, label .. " leaked internal field: " .. terminal)
  assert(string.find(terminal, "table: 0x", 1, true) == nil, label .. " leaked table pointer: " .. terminal)
  assert(string.find(terminal, '"track":{', 1, true) == nil, label .. " leaked raw track object: " .. terminal)
  assert(string.find(terminal, '"take":{', 1, true) == nil, label .. " leaked raw take object: " .. terminal)
end

local req1 = make_e3_write_request("cmd_e3_cache_1", "media.import_file_to_track", path_a, { position_seconds = 0 })
req1.refs = json_array({
  { kind = "track", ref = "track:index:0", identity = { scheme = "index", value = "0" } },
  { kind = "file", ref = "file:path:" .. path_a, identity = { scheme = "path", value = path_a } },
})
local req2 = make_e3_write_request("cmd_e3_cache_2", "media.import_file_to_track", path_b, { position_seconds = 1 })
req2.refs = json_array({
  { kind = "track", ref = "track:index:1", identity = { scheme = "index", value = "1" } },
  { kind = "file", ref = "file:path:" .. path_b, identity = { scheme = "path", value = path_b } },
})
assert(req1 ~= req2)
assert(req1.__openreaper_media_target == nil)
assert(req2.__openreaper_media_target == nil)

-- Deliberately reversed enumeration proves the product loop's sorted FIFO order.
files_list = { "cmd_e3_cache_2.json", "cmd_e3_cache_1.json" }
local raw1 = json.encode(req1)
local raw2 = json.encode(req2)
requests["/requests/cmd_e3_cache_1.json"] = raw1
requests["/requests/cmd_e3_cache_2.json"] = raw2
undo_begins, mutation_calls = {}, {}
decoded_request_order, decoded_request_tables, decoded_request_cache_at_decode = {}, {}, {}

start_e3_transport_loop_for_test()
-- Drive one poll that processes FIFO filenames via product 90-file-transport-loop.
run_poll(0.11)

if #decoded_request_tables ~= 2 then
  error("DECODE_COUNT " .. tostring(#decoded_request_tables) .. " r1=" .. tostring(results["/results/cmd_e3_cache_1.json"]) .. " body1=" .. tostring(writes["/results/cmd_e3_cache_1.json"] and writes["/results/cmd_e3_cache_1.json"]:sub(1, 280)))
end
if decoded_request_order[1] ~= "cmd_e3_cache_1" or decoded_request_order[2] ~= "cmd_e3_cache_2" then
  error("DECODE_ORDER " .. tostring(decoded_request_order[1]) .. "," .. tostring(decoded_request_order[2]))
end
local decoded1 = decoded_request_tables[1]
local decoded2 = decoded_request_tables[2]
if decoded1 == req1 then error("DECODED1_SAME_AS_REQ1") end
if decoded2 == req2 then error("DECODED2_SAME_AS_REQ2") end
if decoded1 == decoded2 then error("DECODED_SAME") end
-- Snapshot at product json.decode time: no internal cache may exist yet.
if decoded_request_cache_at_decode["cmd_e3_cache_1"] ~= false then error("CACHE_AT_DECODE_1") end
if decoded_request_cache_at_decode["cmd_e3_cache_2"] ~= false then error("CACHE_AT_DECODE_2") end
if results["/results/cmd_e3_cache_1.json"] ~= true then error("NO_RESULT_1 " .. tostring(writes["/results/cmd_e3_cache_1.json"])) end
if results["/results/cmd_e3_cache_2.json"] ~= true then error("NO_RESULT_2 " .. tostring(writes["/results/cmd_e3_cache_2.json"])) end
local term1 = string.gsub(writes["/results/cmd_e3_cache_1.json"], "\\n$", "")
local term2 = string.gsub(writes["/results/cmd_e3_cache_2.json"], "\\n$", "")
if not string.find(term1, '"ok":true', 1, true) then error("TERM1 " .. term1:sub(1, 400)) end
if not string.find(term2, '"ok":true', 1, true) then error("TERM2 " .. term2:sub(1, 400)) end
if not string.find(term1, "track:guid:{TRACK-CACHE-A}", 1, true) then error("TERM1_TRACK " .. term1:sub(1, 300)) end
if string.find(term1, "track:guid:{TRACK-CACHE-B}", 1, true) then error("TERM1_LEAK_B") end
if not string.find(term1, path_a, 1, true) then error("TERM1_PATH_A") end
if string.find(term1, path_b, 1, true) then error("TERM1_PATH_B") end
if not string.find(term2, "track:guid:{TRACK-CACHE-B}", 1, true) then error("TERM2_TRACK " .. term2:sub(1, 300)) end
if string.find(term2, "track:guid:{TRACK-CACHE-A}", 1, true) then error("TERM2_LEAK_A") end
if not string.find(term2, path_b, 1, true) then error("TERM2_PATH_B") end
if string.find(term2, path_a, 1, true) then error("TERM2_PATH_A") end
forbid_internal_leak(term1, "transport_req1")
forbid_internal_leak(term2, "transport_req2")
-- Each decoded request resolves and caches its own exact target with no inheritance.
if not is_object(decoded1.__openreaper_media_target) then error("NO_CACHE_1 after dispatch") end
if not is_object(decoded2.__openreaper_media_target) then error("NO_CACHE_2 after dispatch") end
if decoded1.__openreaper_media_target.track ~= track_a then error("CACHE1_TRACK") end
if decoded2.__openreaper_media_target.track ~= track_b then error("CACHE2_TRACK") end
if decoded1.__openreaper_media_target.track_ref ~= "track:guid:{TRACK-CACHE-A}" then error("CACHE1_REF " .. tostring(decoded1.__openreaper_media_target.track_ref)) end
if decoded2.__openreaper_media_target.track_ref ~= "track:guid:{TRACK-CACHE-B}" then error("CACHE2_REF " .. tostring(decoded2.__openreaper_media_target.track_ref)) end
if decoded1.__openreaper_media_target == decoded2.__openreaper_media_target then error("SHARED_CACHE") end
if req1.__openreaper_media_target ~= nil then error("REQ1_GOT_CACHE") end
if req2.__openreaper_media_target ~= nil then error("REQ2_GOT_CACHE") end

-- Relink over transport: exact take GUID identity (no soft take:index OR).
local take_old = { guid = "{TAKE-RELINK-OLD}", source = { path = path_a, source_type = "WAVE", length = 1.0, channels = 2 } }
local item_relink = { guid = "{ITEM-RELINK}", takes = { take_old } }
media_project.items = { item_relink }
local req3 = make_e3_write_request("cmd_e3_cache_3", "media.relink_take_source", path_b, {})
req3.refs = json_array({
  { kind = "take", ref = "take:index:0", identity = { scheme = "index", value = "0" } },
  { kind = "file", ref = "file:path:" .. path_b, identity = { scheme = "path", value = path_b } },
})
files_list = { "cmd_e3_cache_3.json" }
requests["/requests/cmd_e3_cache_3.json"] = json.encode(req3)
local decode_count_before = #decoded_request_tables
run_poll(0.22)
assert(results["/results/cmd_e3_cache_3.json"] == true, writes["/results/cmd_e3_cache_3.json"])
local term3 = string.gsub(writes["/results/cmd_e3_cache_3.json"], "\\n$", "")
assert(string.find(term3, '"ok":true', 1, true) ~= nil, term3)
assert(string.find(term3, '"take_ref":"take:guid:{TAKE-RELINK-OLD}"', 1, true) ~= nil, term3)
assert(string.find(term3, path_b, 1, true) ~= nil, term3)
forbid_internal_leak(term3, "transport_req3")
assert(#decoded_request_tables == decode_count_before + 1)
local decoded3 = decoded_request_tables[#decoded_request_tables]
assert(decoded3 ~= req3)
assert(decoded3.__openreaper_media_target.take == take_old)
assert(decoded2.__openreaper_media_target.track == track_b)
`,
      { withTransport: true },
    );
  });
});
