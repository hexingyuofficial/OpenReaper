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
    assert.match(sourceModules["30-artifact-helper.lua"], /artifact\.state_store\.v1/);
    assert.match(sourceModules["30-artifact-helper.lua"], /A1_ARTIFACT_OPERATIONS/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /local ALLOWED_OPERATIONS = \{/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /handler = read_project_summary/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /template_count = 129/);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /template_count = 119/);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /^  open_required_undo_block\(request, key\)$/m);
    assert.match(sourceModules["40-route-pack-handlers.lua"], /^  close_required_undo_block\(request, key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /^  open_required_undo_block\(request, operation_key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /^  close_required_undo_block\(request, operation_key\)$/m);
    assert.doesNotMatch(sourceModules["40-route-pack-handlers.lua"], /local TRANSPORT_DIR = non_empty\(os\.getenv\(TRANSPORT_ENV\)\)/);
    assert.match(sourceModules["90-file-transport-loop.lua"], /reaper\.EnumerateFiles\(REQUESTS_DIR, index\)/);
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
    assert.match(BRIDGE_SOURCE, /spawned_reaper = false/);

    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /open -a/);
  });

  it("keeps the approved Wave 0, Wave 1A, and Read-B query operations exact", () => {
    const operationKeys = [...BRIDGE_SOURCE.matchAll(/\["query_state:([^"]+)"\]\s*=/g)]
      .map((match) => match[1])
      .sort();

    assert.deepEqual(operationKeys, [
      "actions.parse_marker_action_text",
      "actions.read_action_metadata",
      "actions.read_action_shortcuts",
      "actions.read_action_toggle_state",
      "actions.resolve_named_command",
      "actions.search_action_commands",
      "items.read_item_summary",
      "items.resolve_item_ref",
      "last_result.read",
      "media.file.probe",
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
      "project.read_metadata",
      "project.read_summary",
      "project.read_tempo_map",
      "system.api_symbols.check",
      "system.resource_paths.read",
      "system.runtime_environment.read",
      "template_catalog.read_summary",
      "track.resolve_ref",
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
