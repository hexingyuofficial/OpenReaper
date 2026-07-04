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
  CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const BRIDGE_SCRIPT_PATH = new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url).pathname;
const SAFE_WRITE_A_FLAG = "--safe-write-a";
const SAFE_WRITE_A_OPT_IN_ENV = "OPENREAPER_SAFE_WRITE_A_LIVE_SMOKE";
const PROJECT_ROOT_ENV = "OPENREAPER_SAFE_WRITE_A_PROJECT_ROOT";
const PROJECT_REF_ENV = "OPENREAPER_SAFE_WRITE_A_PROJECT_REF";
const ANCHOR_TRACK_REF_ENV = "OPENREAPER_SAFE_WRITE_A_ANCHOR_TRACK_REF";
const ITEM_REF_ENV = "OPENREAPER_SAFE_WRITE_A_ITEM_REF";
const MIDI_TRACK_REF_ENV = "OPENREAPER_SAFE_WRITE_A_MIDI_TRACK_REF";
const WAVE1A_OPT_IN_ENV = "OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE";

const EXPECTED_IDS = Object.freeze([
  "template.project.set_metadata_field",
  "template.project.create_marker",
  "template.project.create_region",
  "template.tracks.create_track",
  "template.tracks.rename_track",
  "template.tracks.set_color",
  "template.tracks.select_track",
  "template.tracks.set_mute",
  "template.tracks.set_solo",
  "template.transport.set_edit_cursor",
  "template.transport.set_time_selection",
  "template.transport.clear_time_selection",
  "template.transport.set_loop_points",
  "template.transport.clear_loop_points",
  "template.transport.set_repeat",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.set_item_fades",
  "template.items.set_take_pitch",
  "template.items.set_item_snap_offset",
  "template.midi.create_midi_item",
  "template.midi.insert_notes_batch",
  "template.midi.insert_cc_batch",
  "template.midi.insert_text_sysex_events",
]);

const EXPECTED_CAPABILITIES = Object.freeze([
  "project.set_metadata_field",
  "project.create_marker",
  "project.create_region",
  "track.create",
  "track.rename",
  "track.set_color",
  "track.select",
  "track.set_mute",
  "track.set_solo",
  "transport.set_edit_cursor",
  "transport.set_time_selection",
  "transport.clear_time_selection",
  "transport.set_loop_points",
  "transport.clear_loop_points",
  "transport.set_repeat",
  "items.move_item",
  "items.trim_item",
  "items.set_item_fades",
  "items.set_take_pitch",
  "items.set_item_snap_offset",
  "midi.create_midi_item",
  "midi.insert_notes_batch",
  "midi.insert_cc_batch",
  "midi.insert_text_sysex_events",
]);

const IDEMPOTENT_IDS = new Set([
  "template.project.set_metadata_field",
  "template.tracks.rename_track",
  "template.tracks.set_color",
  "template.tracks.select_track",
  "template.tracks.set_mute",
  "template.tracks.set_solo",
  "template.transport.set_edit_cursor",
  "template.transport.set_time_selection",
  "template.transport.clear_time_selection",
  "template.transport.set_loop_points",
  "template.transport.clear_loop_points",
  "template.transport.set_repeat",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.set_item_fades",
  "template.items.set_take_pitch",
  "template.items.set_item_snap_offset",
]);

describe("Safe-Write-A handler expansion", () => {
  it("adds exactly the 24 Safe-Write-A ids without broadening the default live catalog", () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS, EXPECTED_IDS);
    assert.equal(CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS.length, 24);
    assert.equal(CALL_TEMPLATE_RUNTIME_LIVE_TEMPLATE_IDS.some((id) => EXPECTED_IDS.includes(id)), false);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(runtime.live_gate.allowed_template_ids, []);
  });

  it("constructs only run_command:template.execute write/safe requests with artifacts disabled", async () => {
    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_SAFE_WRITE_A_LIVE_TEMPLATE_IDS,
        opt_in_env: SAFE_WRITE_A_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 30,
    });

    for (const [index, id] of EXPECTED_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: safeInput(id),
        refs: safeRefs(id),
        idempotency_key: IDEMPOTENT_IDS.has(id) ? `safe-write-a:${id}` : undefined,
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.equal(bridge.seen.length, 24);
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), EXPECTED_CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.operation.family, "run_command");
      assert.equal(request.operation.name, "template.execute");
      assert.match(request.pack.risk, /^(write|safe)$/);
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(Number.isInteger(request.timeout_ms), true);
      assert.equal(request.budget.max_response_bytes > 0, true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen.filter((request) => typeof request.idempotency_key === "string").length, IDEMPOTENT_IDS.size);
  });

  it("keeps the Safe-Write-A runner default-skipped, non-spawning, and typed for blockers", async () => {
    const skipped = runSmoke([SAFE_WRITE_A_FLAG], {
      [SAFE_WRITE_A_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "Safe-Write-A");
    assert.equal(skipped.batch, "Safe-Write-A");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, EXPECTED_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, ["run_command:template.execute"]);
    assert.deepEqual(skipped.allowed_capabilities, EXPECTED_CAPABILITIES);
    assert.equal(skipped.fixture_inputs.project_root_env, PROJECT_ROOT_ENV);

    const noExecutor = runSmokeExpectingFailure([SAFE_WRITE_A_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.spawned_reaper, false);
    assert.equal("attempted_template_ids" in noExecutor, false);

    const missingTransport = runSmokeExpectingFailure([SAFE_WRITE_A_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: join(tmpdir(), `openreaper-safe-write-a-missing-${process.pid}`),
    });
    assert.equal(missingTransport.reason, "live_bridge_transport_absent");
    assert.equal(missingTransport.blocker, "live_bridge_transport_absent");
    assert.equal("attempted_template_ids" in missingTransport, false);

    const transportDir = await createTransportDir("openreaper-safe-write-a-root-");
    const missingProjectRoot = runSmokeExpectingFailure([SAFE_WRITE_A_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.bridge_script_path]: BRIDGE_SCRIPT_PATH,
    });
    assert.equal(missingProjectRoot.reason, "project_root_not_configured");
    assert.equal(missingProjectRoot.blocker, "project_root_not_configured");
  });

  it("runs fake/static smoke for all 24 rows with bounded readback, undo, and idempotency evidence", () => {
    const report = runSmoke([SAFE_WRITE_A_FLAG, "--fake"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(report.ok, true);
    assert.equal(report.skipped, false);
    assert.equal(report.live_pass_claimed, false);
    assert.equal(report.mode, "fake");
    assert.deepEqual(report.attempted_template_ids, EXPECTED_IDS);
    assert.deepEqual(report.expected_capabilities, EXPECTED_CAPABILITIES);
    assert.equal(report.executions.length, 24);

    for (const [index, execution] of report.executions.entries()) {
      assert.equal(execution.id, EXPECTED_IDS[index]);
      assert.equal(execution.ok, true, execution.id);
      assert.equal(execution.operation, "run_command:template.execute");
      assert.equal(execution.capability, EXPECTED_CAPABILITIES[index]);
      assert.equal(execution.artifacts_allowed, false);
      assert.equal(execution.summary.readback_status, "passed");
      assert.equal(execution.summary.bounded, true);
      assert.equal(execution.undo.mode, "required");
      assert.equal(execution.undo.opened, true);
      assert.equal(execution.undo.closed, true);
      assert.equal(execution.verification_status, "passed");
      assert.equal(execution.counts.artifacts, 0);
      assert.equal(execution.counts.jobs, 0);
    }
    assert.equal(report.executions.filter((entry) => entry.idempotency.key_present).length, IDEMPOTENT_IDS.size);
    assert.equal(report.output_refs.created_track_ref, "track:guid:{SAFE-WRITE-A-TRACK}");
    assert.equal(report.output_refs.created_midi_take_ref, "take:guid:{SAFE-WRITE-A-MIDI-TAKE}");
  });

  it("keeps the Lua bridge Safe-Write-A surface exact and rejects unrelated powers", () => {
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_command:([^"]+)"\]\s*=/g)].map((match) => match[1]))],
      ["template.execute"],
    );
    assert.match(BRIDGE_SOURCE, /local SAFE_WRITE_A_CAPABILITIES/);
    for (const capability of EXPECTED_CAPABILITIES) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`), capability);
    }
    assert.match(BRIDGE_SOURCE, /local key = request\.operation\.family \.\. ":" \.\. request\.operation\.name/);
    assert.match(BRIDGE_SOURCE, /^  open_required_undo_block\(request, key\)$/m);
    assert.match(BRIDGE_SOURCE, /^  close_required_undo_block\(request, key\)$/m);
    assert.doesNotMatch(BRIDGE_SOURCE, /^  open_required_undo_block\(request, operation_key\)$/m);
    assert.doesNotMatch(BRIDGE_SOURCE, /^  close_required_undo_block\(request, operation_key\)$/m);
    for (const forbidden of [
      "media.import_file_to_track",
      "media.import_file_section_to_track",
      "media.relink_take_source",
      "render.region_wav",
      "fx.add_track_fx",
      "routing.create_track_send",
      "automation.insert_envelope_point",
      "actions.run",
      "raw_lua",
      "shell_command",
      "call_recipe",
    ]) {
      assert.equal(EXPECTED_CAPABILITIES.includes(forbidden), false, forbidden);
    }
    assert.match(BRIDGE_SOURCE, /Safe-Write-A write\/safe requests must use artifacts\.allow false/);
    assert.match(BRIDGE_SOURCE, /OpenReaper live bridge accepts read-only live-smoke requests only/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function safeInput(id) {
  const inputs = {
    "template.project.set_metadata_field": { field: "title", value: "OpenReaper Safe Write A" },
    "template.project.create_marker": { name: "OR_SAFE_WRITE_A_MARKER", position_seconds: 0.25 },
    "template.project.create_region": { name: "OR_SAFE_WRITE_A_REGION", start_seconds: 0.5, end_seconds: 1.5 },
    "template.tracks.create_track": { name: "OR_SAFE_WRITE_A_TARGET" },
    "template.tracks.rename_track": { name: "OR_SAFE_WRITE_A_RENAMED" },
    "template.tracks.set_color": { color: "#2D9CDB" },
    "template.tracks.select_track": { mode: "replace" },
    "template.tracks.set_mute": { muted: false },
    "template.tracks.set_solo": { mode: "off" },
    "template.transport.set_edit_cursor": { position_seconds: 0.5, move_view: false, seek_playback: false },
    "template.transport.set_time_selection": { start_seconds: 0.25, end_seconds: 0.75 },
    "template.transport.clear_time_selection": {},
    "template.transport.set_loop_points": { start_seconds: 0.25, end_seconds: 0.75 },
    "template.transport.clear_loop_points": {},
    "template.transport.set_repeat": { enabled: false },
    "template.items.move_item": { position_seconds: 0.5 },
    "template.items.trim_item": { length_seconds: 0.75 },
    "template.items.set_item_fades": { fade_in_seconds: 0.01, fade_out_seconds: 0.02 },
    "template.items.set_take_pitch": { semitones: 0 },
    "template.items.set_item_snap_offset": { snap_offset_seconds: 0 },
    "template.midi.create_midi_item": { start_seconds: 0, end_seconds: 2 },
    "template.midi.insert_notes_batch": {
      position_unit: "ppq",
      sort_events: true,
      notes: [{ start_ppq: 0, end_ppq: 240, pitch: 60, velocity: 96, channel: 0 }],
    },
    "template.midi.insert_cc_batch": {
      position_unit: "ppq",
      sort_events: true,
      events: [{ ppq: 0, channel: 0, controller: 1, value: 64 }],
    },
    "template.midi.insert_text_sysex_events": {
      position_unit: "ppq",
      sort_events: true,
      events: [{ ppq: 0, event_kind: "lyric", text: "safe-write-a" }],
    },
  };
  return inputs[id] ?? {};
}

function safeRefs(id) {
  const track = createObjectRef("track", { scheme: "guid", value: "{SAFE-WRITE-A-TRACK}" }, {
    ref: "track:guid:{SAFE-WRITE-A-TRACK}",
  });
  const item = createObjectRef("item", { scheme: "guid", value: "{SAFE-WRITE-A-ITEM}" }, {
    ref: "item:guid:{SAFE-WRITE-A-ITEM}",
  });
  const take = createObjectRef("take", { scheme: "guid", value: "{SAFE-WRITE-A-MIDI-TAKE}" }, {
    ref: "take:guid:{SAFE-WRITE-A-MIDI-TAKE}",
  });
  if (id.startsWith("template.tracks.") && id !== "template.tracks.create_track") {
    return { track_ref: track };
  }
  if (id.startsWith("template.items.")) {
    return { item_ref: item };
  }
  if (id === "template.midi.create_midi_item") {
    return { track_ref: track };
  }
  if (id.startsWith("template.midi.") && id !== "template.midi.create_midi_item") {
    return { take_ref: take };
  }
  return {};
}

async function createTransportDir(prefix) {
  const transportDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(transportDir, "requests"));
  await mkdir(join(transportDir, "results"));
  return transportDir;
}

function runSmoke(args, env) {
  return JSON.parse(
    execFileSync(process.execPath, [SMOKE_SCRIPT, ...args], {
      cwd: ROOT,
      encoding: "utf8",
      env: {
        ...process.env,
        [SAFE_WRITE_A_OPT_IN_ENV]: "",
        [WAVE1A_OPT_IN_ENV]: "",
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
        [SAFE_WRITE_A_OPT_IN_ENV]: "",
        [WAVE1A_OPT_IN_ENV]: "",
        [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
        ...env,
      },
    });
  } catch (error) {
    assert.equal(error.status, 2);
    return JSON.parse(error.stdout.trim());
  }
  assert.fail("Expected Safe-Write-A live smoke script to exit with status 2.");
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
    created_at: "2026-07-04T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
