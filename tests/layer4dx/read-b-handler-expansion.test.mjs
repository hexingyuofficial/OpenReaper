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
  CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const SMOKE_SOURCE = readFileSync(new URL("../../scripts/smoke-template-runtime-live.mjs", import.meta.url), "utf8");
const READ_B_FLAG = "--read-b";
const LIVE_OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";
const A1_OPT_IN_ENV = "OPENREAPER_FIRST_REAL_A1_LIVE_SMOKE";
const MIDI_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_MIDI_TAKE_REF";
const AUDIO_TAKE_REF_ENV = "OPENREAPER_LIVE_SMOKE_AUDIO_TAKE_REF";
const MEDIA_PATH_ENV = "OPENREAPER_LIVE_SMOKE_MEDIA_PATH";
const ACTION_SEARCH_LIMIT_ENV = "OPENREAPER_LIVE_SMOKE_ACTION_SEARCH_LIMIT";

const READ_B_OPERATION_NAMES = Object.freeze([
  "actions.resolve_named_command",
  "actions.read_action_metadata",
  "actions.read_action_toggle_state",
  "actions.read_action_shortcuts",
  "actions.parse_marker_action_text",
  "actions.search_action_commands",
  "midi.resolve_midi_take_ref",
  "midi.read_take_event_counts",
  "midi.list_take_notes",
  "midi.list_take_cc_events",
  "midi.list_take_text_sysex_events",
  "midi.read_take_grid",
  "media.file.probe",
  "media.take_source.read",
  "media.project_files.read",
]);

const READ_B_OPERATION_KEYS = Object.freeze(READ_B_OPERATION_NAMES.map((operation) => `query_state:${operation}`));

describe("Read-B live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the 15 Read-B template ids", async () => {
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

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
        opt_in_env: LIVE_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 20,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: readBInput(id),
        refs: readBRefs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(bridge.seen.map((request) => request.operation.name), READ_B_OPERATION_NAMES);
    assert.equal(bridge.seen.length, 15);
    for (const request of bridge.seen) {
      assert.equal(request.operation.family, "query_state");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }

    const actionSearchRequest = bridge.seen.find(
      (request) => request.operation.name === "actions.search_action_commands",
    );
    assert.equal(actionSearchRequest.params.limit, 6);

    const evidence = runtime.evidence();
    assert.equal(evidence.length, 15);
    assert.equal(evidence.every((entry) => entry.live.spawned_reaper === false), true);
    assert.deepEqual(evidence[0].live.allowed_template_ids, CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS);
  });

  it("rejects mixed live allowlists instead of broadening Read-B or Wave 1A", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });

    assert.deepEqual(runtime.live_gate.allowed_template_ids, []);
    for (const id of [
      "template.actions.resolve_named_command",
      "template.core.read_template_catalog_summary",
    ]) {
      const response = await runtime.call_template({
        id,
        input: readBInput(id),
        refs: readBRefs(id),
        context: context(),
      });
      assert.equal(response.ok, false, id);
      assert.equal(response.error.code, "CALL_TEMPLATE_LIVE_ID_NOT_ALLOWED", id);
    }
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps the Read-B runner safe-skipped by default and typed for missing config", async () => {
    const skipped = runSmoke([READ_B_FLAG], {
      [LIVE_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [MIDI_TAKE_REF_ENV]: "",
      [AUDIO_TAKE_REF_ENV]: "",
      [MEDIA_PATH_ENV]: "",
    });

    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "read-b-live-handlers");
    assert.equal(skipped.batch, "read-b-live-handlers");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, READ_B_OPERATION_KEYS);
    assert.equal(skipped.fixture_inputs.midi_take_ref, "selected:0");
    assert.equal(skipped.fixture_inputs.audio_take_ref, "take:index:0");
    assert.equal(skipped.fixture_inputs.action_search_limit, 6);

    const noExecutor = runSmokeExpectingFailure([READ_B_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.equal("attempted_template_ids" in noExecutor, false);

    const missingTransport = runSmokeExpectingFailure([READ_B_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(tmpdir(), `openreaper-read-b-missing-${process.pid}`),
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.equal(missingTransport.blocker, "live_bridge_transport_absent");
    assert.equal(missingTransport.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingTransport, false);

    const transportDir = await createTransportDir("openreaper-read-b-script-");
    const missingScript = runSmokeExpectingFailure([READ_B_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: join(tmpdir(), `openreaper-read-b-missing-${process.pid}.lua`),
    });
    assert.equal(missingScript.reason, "reaper_bridge_script_absent");
    assert.equal(missingScript.blocker, "reaper_bridge_script_absent");
    assert.equal(missingScript.spawned_reaper, false);
    assert.equal("attempted_template_ids" in missingScript, false);
  });

  it("writes only Read-B query_state request shapes to transport without starting REAPER", async () => {
    const transportDir = await createTransportDir("openreaper-read-b-timeout-");
    const report = runSmokeExpectingFailure([READ_B_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [ACTION_SEARCH_LIMIT_ENV]: "999",
      [MIDI_TAKE_REF_ENV]: "take:index:0",
      [AUDIO_TAKE_REF_ENV]: "take:index:1",
      [MEDIA_PATH_ENV]: "/tmp/openreaper-read-b-fixture.wav",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_READ_B_LIVE_TEMPLATE_IDS);
    assert.equal(report.executions.length, 15);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 15);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`).sort(),
      [...READ_B_OPERATION_KEYS].sort(),
    );

    const byOperation = new Map(requests.map((request) => [`${request.operation.family}:${request.operation.name}`, request]));
    assert.equal(byOperation.get("query_state:actions.read_action_metadata").params.command_id, 40044);
    assert.equal(byOperation.get("query_state:actions.read_action_toggle_state").params.command_id, 40364);
    assert.equal(byOperation.get("query_state:actions.parse_marker_action_text").params.text, "!40044 !40364");
    assert.equal(byOperation.get("query_state:actions.search_action_commands").params.limit, 6);
    assert.equal(byOperation.get("query_state:midi.resolve_midi_take_ref").params.ref, "take:index:0");
    assert.equal(byOperation.get("query_state:media.file.probe").params.path, "/tmp/openreaper-read-b-fixture.wav");

    for (const request of requests) {
      assert.equal(request.operation.family, "query_state");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
      assert.doesNotMatch(request.operation.name, /render|report|import|relink|write|insert|set_|create_|delete|run/);
    }

    for (const operation of [
      "query_state:midi.read_take_event_counts",
      "query_state:midi.list_take_notes",
      "query_state:midi.list_take_cc_events",
      "query_state:midi.list_take_text_sysex_events",
      "query_state:midi.read_take_grid",
      "query_state:media.take_source.read",
    ]) {
      assert.equal(byOperation.get(operation).refs[0].kind, "take", operation);
      assert.equal(byOperation.get(operation).refs[0].ref.startsWith("take:"), true, operation);
    }
  });

  it("keeps the Lua bridge Read-B allowlist exact and free of execution/write routes", () => {
    const readBKeys = [...BRIDGE_SOURCE.matchAll(/\["query_state:([^"]+)"\]\s*=/g)]
      .map((match) => `query_state:${match[1]}`)
      .filter((key) => READ_B_OPERATION_KEYS.includes(key))
      .sort();
    assert.deepEqual([...new Set(readBKeys)], [...READ_B_OPERATION_KEYS].sort());

    assert.match(BRIDGE_SOURCE, /NamedCommandLookup/);
    assert.match(BRIDGE_SOURCE, /MIDI_CountEvts/);
    assert.match(BRIDGE_SOURCE, /MIDI_GetNote/);
    assert.match(BRIDGE_SOURCE, /MIDI_GetCC/);
    assert.match(BRIDGE_SOURCE, /MIDI_GetTextSysexEvt/);
    assert.match(BRIDGE_SOURCE, /PCM_Source_CreateFromFile/);
    assert.match(BRIDGE_SOURCE, /GetMediaItemTake_Source/);
    assert.match(BRIDGE_SOURCE, /read_project_media_files/);
    assert.match(BRIDGE_SOURCE, /Only scoped First-Real-Fixture-A artifact handlers may write artifacts/);

    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_command|run_action|artifact_metadata):/);
    assert.doesNotMatch(BRIDGE_SOURCE, /import_file_to_track|relink_take_source/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
  });

  it("bounds action command search summary shape below the runtime inline budget", () => {
    assert.match(BRIDGE_SOURCE, /ACTION_SEARCH_DEFAULT_LIMIT\s*=\s*6/);
    assert.match(BRIDGE_SOURCE, /ACTION_SEARCH_MAX_LIMIT\s*=\s*6/);
    assert.match(BRIDGE_SOURCE, /ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS\s*=\s*96/);
    assert.match(BRIDGE_SOURCE, /ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS\s*=\s*80/);
    assert.match(
      BRIDGE_SOURCE,
      /bounded_limit\(request,\s*request\.params\.limit,\s*ACTION_SEARCH_DEFAULT_LIMIT,\s*ACTION_SEARCH_MAX_LIMIT\)/,
    );
    assert.match(
      BRIDGE_SOURCE,
      /display_name\s*=\s*bounded_string\(display_name,\s*ACTION_SEARCH_DISPLAY_NAME_MAX_CHARS\)/,
    );
    assert.match(
      BRIDGE_SOURCE,
      /named_command\s*=\s*bounded_string\(named_command,\s*ACTION_SEARCH_NAMED_COMMAND_MAX_CHARS\)/,
    );

    assert.match(SMOKE_SOURCE, /READ_B_ACTION_SEARCH_DEFAULT_LIMIT\s*=\s*6/);
    assert.match(SMOKE_SOURCE, /READ_B_ACTION_SEARCH_MAX_LIMIT\s*=\s*6/);
    assert.match(
      SMOKE_SOURCE,
      /Math\.min\(\s*positiveInteger\(env\[READ_B_ACTION_SEARCH_LIMIT_ENV\],\s*READ_B_ACTION_SEARCH_DEFAULT_LIMIT\),\s*READ_B_ACTION_SEARCH_MAX_LIMIT,\s*\)/,
    );

    const worstCaseSummary = {
      section: "crossfade_editor",
      items: Array.from({ length: 6 }, () => ({
        section: "crossfade_editor",
        command_id: 2_147_483_647,
        display_name: "D".repeat(96),
        named_command: `_${"N".repeat(79)}`,
        source: "extension",
      })),
      next_cursor: "1000000000",
      truncated: true,
    };
    assert.ok(Buffer.byteLength(JSON.stringify(worstCaseSummary), "utf8") < 2048);
  });
});

function readBInput(id) {
  const inputs = {
    "template.actions.resolve_named_command": {
      named_command: "_OPENREAPER_READ_B_NO_SUCH_COMMAND",
      section: "main",
    },
    "template.actions.read_action_metadata": {
      section: "main",
      command_id: 40044,
    },
    "template.actions.read_action_toggle_state": {
      section: "main",
      command_id: 40364,
    },
    "template.actions.read_action_shortcuts": {
      section: "main",
      command_id: 40044,
      max_shortcuts: 8,
    },
    "template.actions.parse_marker_action_text": {
      text: "!40044 !40364",
      section: "main",
      resolve_tokens: true,
    },
    "template.actions.search_action_commands": {
      section: "main",
      query: "marker",
      limit: 6,
    },
    "template.midi.resolve_midi_take_ref": {
      ref: "take:index:0",
    },
    "template.midi.list_take_notes": {
      limit: 16,
      include_project_time: true,
    },
    "template.midi.list_take_cc_events": {
      controller: 1,
      limit: 16,
    },
    "template.midi.list_take_text_sysex_events": {
      event_kind: "any",
      limit: 16,
    },
    "template.media.probe_file": {
      path: "/tmp/openreaper-read-b-fixture.wav",
      include_metadata_keys: true,
    },
    "template.media.read_take_source": {
      include_metadata_keys: true,
      include_parent_source: false,
    },
    "template.media.read_project_media_files": {
      include_offline: true,
      include_metadata_keys: false,
      max_sources: 25,
    },
  };
  return inputs[id] ?? {};
}

function readBRefs(id) {
  const midiTake = createObjectRef("take", { scheme: "index", value: "0" }, { ref: "take:index:0" });
  const audioTake = createObjectRef("take", { scheme: "index", value: "1" }, { ref: "take:index:1" });
  if (id.startsWith("template.midi.") && id !== "template.midi.resolve_midi_take_ref") {
    return { take_ref: midiTake };
  }
  if (id === "template.media.read_take_source") {
    return { take_ref: audioTake };
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

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [LIVE_OPT_IN_ENV]: "",
        [A1_OPT_IN_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    }).trim(),
  );
}

function runSmokeExpectingFailure(args, env) {
  try {
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [LIVE_OPT_IN_ENV]: "",
        [A1_OPT_IN_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected Read-B live smoke script to exit with status 2.");
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-04T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
