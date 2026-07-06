import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE0_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const TRACK_REF_ENV = "OPENREAPER_LIVE_SMOKE_TRACK_REF";
const ITEM_REF_ENV = "OPENREAPER_LIVE_SMOKE_ITEM_REF";

const WAVE1A_OPERATION_NAMES = Object.freeze([
  "template_catalog.read_summary",
  "last_result.read",
  "system.api_symbols.check",
  "project.read_metadata",
  "project.list_markers_regions",
  "project.read_tempo_map",
  "track.resolve_ref",
  "items.resolve_item_ref",
  "items.read_item_summary",
]);

const EXPECTED_LUA_OPERATIONS = Object.freeze([
  "items.list_items_on_track",
  "items.list_selected_items",
  "items.read_item_summary",
  "items.resolve_item_ref",
  "fx.installed.search",
  "fx.list_parameters",
  "fx.list_take_chain",
  "fx.list_track_chain",
  "fx.parameter_to_envelope_mapping",
  "fx.read_parameter",
  "fx.read_summary",
  "fx.resolve_ref",
  "last_result.read",
  "openreaper.read_status",
      "project.list_markers_regions",
      "project.read_metadata",
      "project.read_summary",
      "project.read_tempo_map",
      "project.read_track_item_overview",
      "render.bounds.resolve",
      "render.region_matrix.read",
      "render.settings.read",
      "render.targets.preview",
      "routing.audio_outputs.list",
      "routing.fx_pin_mapping.read",
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
  "actions.parse_marker_action_text",
  "actions.read_action_metadata",
  "actions.read_action_shortcuts",
  "actions.read_action_toggle_state",
  "actions.read_custom_action_metadata",
  "actions.read_cycle_action_metadata",
  "actions.resolve_named_command",
  "actions.search_action_commands",
  "automation.evaluate_envelope_at_time",
  "automation.read_automation_items",
  "automation.read_envelope_points",
  "automation.read_envelope_summary",
  "automation.read_track_automation_mode",
  "automation.resolve_envelope_ref",
  "automation.resolve_send_envelope",
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
].sort());

describe("4D.x Wave 1A read-handler expansion", () => {
  it("keeps Wave 0 available while adding only the nine Wave 1A live ids", () => {
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
    assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.length >= 129, true);
    assert.equal(CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS.length, 14);
  });

  it("routes each Wave 1A template through the fake bridge as read-only query_state", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        opt_in_env: "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE",
        opt_in_flag: "--live",
      },
      evidenceLimit: 20,
    });

    const inputs = exampleInputs(runtime);
    for (const [index, id] of CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: inputs[id] ?? {},
        refs: exampleRefs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(bridge.seen.map((request) => request.operation.name), WAVE1A_OPERATION_NAMES);
    assert.equal(bridge.seen.length, 9);
    for (const request of bridge.seen) {
      assert.equal(request.operation.family, "query_state");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
    }

    const evidence = runtime.evidence();
    assert.equal(evidence.length, 9);
    assert.equal(evidence.every((entry) => entry.live.spawned_reaper === false), true);
    assert.deepEqual(evidence[0].live.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
  });

  it("does not broaden Wave 1A live execution to Wave 0, writes, actions, or all accepted ids", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
          "template.tracks.create_track",
          "not-a-template-id",
        ],
      },
    });

    assert.deepEqual(runtime.live_gate.allowed_template_ids, []);

    for (const id of [
      "template.core.read_template_catalog_summary",
      "template.project.read_summary",
      "template.tracks.create_track",
      "template.actions.resolve_named_command",
      "template.actions.read_action_metadata",
    ]) {
      const response = await runtime.call_template({
        id,
        input: {},
        refs: [],
        context: context(),
      });
      assert.equal(response.ok, false, id);
      assert.equal(response.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED", id);
    }
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps the Lua bridge allowlist exact, typed, bounded, and non-spawning", () => {
    const operationKeys = [...BRIDGE_SOURCE.matchAll(/\["query_state:([^"]+)"\]\s*=/g)]
      .map((match) => match[1])
      .sort();
    assert.deepEqual(operationKeys, EXPECTED_LUA_OPERATIONS);

    const handlerMappings = {
      "template_catalog.read_summary": "read_template_catalog_summary",
      "last_result.read": "read_last_result",
      "system.api_symbols.check": "read_api_symbols",
      "project.read_metadata": "read_project_metadata",
      "project.list_markers_regions": "list_markers_regions",
      "project.read_tempo_map": "read_tempo_map",
      "track.resolve_ref": "resolve_track_ref",
      "items.resolve_item_ref": "resolve_item_ref",
      "items.read_item_summary": "read_item_summary",
      "items.list_selected_items": "d13_items_list_selected_items",
      "items.list_items_on_track": "d13_items_list_items_on_track",
    };
    for (const [operation, handler] of Object.entries(handlerMappings)) {
      assert.match(
        BRIDGE_SOURCE,
        new RegExp(`\\["query_state:${escapeRegExp(operation)}"\\]\\s*=\\s*\\{[\\s\\S]*?handler\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`),
        operation,
      );
    }
    assert.match(BRIDGE_SOURCE, /template_count = 129/);
    assert.doesNotMatch(BRIDGE_SOURCE, /template_count = 119/);
    assert.doesNotMatch(BRIDGE_SOURCE, /experimental = 119/);
    assert.match(BRIDGE_SOURCE, /accepted_runtime_template_count = template_count/);
    assert.match(BRIDGE_SOURCE, /live_supported_template_count = live_supported_template_count/);
    assert.match(BRIDGE_SOURCE, /catalog_count_semantics = "template_count is the accepted runtime catalog count; live_supported_template_count is the current bridge handler row count\."/);
    assert.match(BRIDGE_SOURCE, /READ_TEMPLATE_CATALOG_SUMMARY_LIVE_HANDLER_COUNTS = \{[\s\S]*?template_count = 73/);
    assert.match(BRIDGE_SOURCE, /live_supported_by_pack = pack and read_template_catalog_summary_count_for_key/);

    for (const code of [
      "REQUEST_INVALID",
      "OPERATION_NOT_FOUND",
      "BRIDGE_OWNER_MISMATCH",
      "BRIDGE_GENERATION_MISMATCH",
      "RESPONSE_TOO_LARGE",
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`"${code}"`), code);
    }
    assert.match(BRIDGE_SOURCE, /Bridge request JSON is malformed/);
    assert.match(BRIDGE_SOURCE, /#encoded > budget\.max_response_bytes/);
    assert.match(BRIDGE_SOURCE, /bounded_limit/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_command:([^"]+)"\]\s*=/g)].map((match) => match[1]))],
      ["template.execute", "render.sample_rate.set"],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_job:([^"]+)"\]\s*=/g)].map((match) => match[1]))].sort(),
      [
        "analysis.create_loop_qa_report",
        "analysis.detect_loop_candidates",
        "analysis.detect_item_silence",
        "analysis.detect_item_transients",
        "analysis.measure_item_peaks",
        "analysis.measure_item_rms",
        "analysis.measure_loop_click_risk",
        "items.create_layer_report",
        "project.create_cleanup_report",
        "render.delivery_report.create",
        "render.region_wav",
      ].sort(),
    );
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /open -a/);
    assert.equal(CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS.length, 15);
  });

  it("keeps default live smoke skipped and --live without config non-spawning", async () => {
    const skipped = JSON.parse(
      execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
          [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
          [TRACK_REF_ENV]: "",
          [ITEM_REF_ENV]: "",
        },
      }).trim(),
    );
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.wave, "wave1a-read-handlers");
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.fixture_inputs, {
      track_ref_env: TRACK_REF_ENV,
      item_ref_env: ITEM_REF_ENV,
      track_ref: null,
      item_ref: "selected:0",
      applies_to_template_ids: [
        "template.tracks.resolve_track_ref",
        "template.items.resolve_item_ref",
        "template.items.read_item_summary",
      ],
    });

    const noExecutor = runLiveSmokeExpectingFailure({
      OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [TRACK_REF_ENV]: "",
      [ITEM_REF_ENV]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.deepEqual(noExecutor.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal("attempted_template_ids" in noExecutor, false);

    const missingTransport = runLiveSmokeExpectingFailure({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(await mkdtemp(join(tmpdir(), "openreaper-live-wave1a-")), "missing"),
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "20",
      [TRACK_REF_ENV]: "",
      [ITEM_REF_ENV]: "",
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.deepEqual(missingTransport.attempted_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.equal(missingTransport.executions.length, 9);
    assert.equal(missingTransport.spawned_reaper, false);
  });

  it("accepts scoped fixture env overrides only for the Wave 1A track/item retry inputs", () => {
    const overridden = JSON.parse(
      execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
          [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
          [TRACK_REF_ENV]: "track:Dialog",
          [ITEM_REF_ENV]: "item:index:0",
        },
      }).trim(),
    );
    assert.equal(overridden.ok, true);
    assert.equal(overridden.skipped, true);
    assert.deepEqual(overridden.allowed_template_ids, CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS);
    assert.deepEqual(overridden.fixture_inputs, {
      track_ref_env: TRACK_REF_ENV,
      item_ref_env: ITEM_REF_ENV,
      track_ref: "track:Dialog",
      item_ref: "item:index:0",
      applies_to_template_ids: [
        "template.tracks.resolve_track_ref",
        "template.items.resolve_item_ref",
        "template.items.read_item_summary",
      ],
    });

    const invalidItemRef = JSON.parse(
      execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs"], {
        cwd: ROOT,
        encoding: "utf8",
        env: {
          ...process.env,
          OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
          [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
          [TRACK_REF_ENV]: "track:index:0",
          [ITEM_REF_ENV]: "track:Dialog",
        },
      }).trim(),
    );
    assert.equal(invalidItemRef.fixture_inputs.track_ref, "track:index:0");
    assert.equal(invalidItemRef.fixture_inputs.item_ref, "selected:0");
  });

  it("wires fixture env overrides into the live bridge request files without starting REAPER", async () => {
    const transportDir = await mkdtemp(join(tmpdir(), "openreaper-live-fixture-env-"));
    await mkdir(join(transportDir, "requests"));
    await mkdir(join(transportDir, "results"));

    const report = runLiveSmokeExpectingFailure({
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      OPENREAPER_LIVE_BRIDGE_TIMEOUT_MS: "1",
      [TRACK_REF_ENV]: "track:Dialog",
      [ITEM_REF_ENV]: "item:index:0",
    });
    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.deepEqual(report.fixture_inputs.applies_to_template_ids, [
      "template.tracks.resolve_track_ref",
      "template.items.resolve_item_ref",
      "template.items.read_item_summary",
    ]);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 9);
    const byOperation = new Map(requests.map((request) => [request.operation.name, request]));

    assert.equal(byOperation.get("track.resolve_ref").params.track_ref, "track:Dialog");
    assert.equal(byOperation.get("items.resolve_item_ref").params.ref, "item:index:0");
    assert.deepEqual(byOperation.get("items.read_item_summary").refs, [
      {
        kind: "item",
        ref: "item:index:0",
        identity: {
          scheme: "index",
          value: "0",
        },
      },
    ]);

    for (const request of requests) {
      assert.equal(request.operation.family, "query_state");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
    }
  });
});

function exampleInputs(runtime) {
  const menu = runtime.list_templates({
    ids: CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
    fields: ["examples"],
  });
  return Object.fromEntries(
    menu.items.map((item) => [item.id, cloneJson(item.examples?.[0]?.input ?? {})]),
  );
}

function exampleRefs(id) {
  if (id !== "template.items.read_item_summary") return [];
  return {
    item_ref: createObjectRef("item", { scheme: "selected", value: "0" }, { ref: "item:selected:0" }),
  };
}

function runLiveSmokeExpectingFailure(env) {
  try {
    execFileSync(process.execPath, ["scripts/smoke-template-runtime-live.mjs", "--live"], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected live smoke script to exit with status 2.");
}

async function readTransportRequests(transportDir) {
  const requestDir = join(transportDir, "requests");
  const names = await readdir(requestDir);
  return names
    .filter((name) => name.endsWith(".json"))
    .sort()
    .map((name) => JSON.parse(readFileSync(join(requestDir, name), "utf8")));
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}
