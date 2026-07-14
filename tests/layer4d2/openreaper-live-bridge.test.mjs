import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
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
      /template_count = 227/,
    );
    assert.match(sourceModules["90-file-transport-loop.lua"], /reaper\.EnumerateFiles\(REQUESTS_DIR, index\)/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /current_time >= next_heartbeat_at/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /next_heartbeat_at = current_time \+ HEARTBEAT_INTERVAL_SECONDS/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /heartbeat refresh failed/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /startup heartbeat failed/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /reaper\.defer\(bridge_loop\)/);
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
