import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
  CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  LIVE_BRIDGE_EXECUTOR_ENV,
} from "../../packages/mcp-server/src/live-bridge-executor-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const SMOKE_SCRIPT = "scripts/smoke-template-runtime-live.mjs";
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const E3_FLAG = "--media-route";
const E3_OPT_IN_ENV = "OPENREAPER_E3_MEDIA_ROUTE_LIVE_SMOKE";
const E3_FOLDER_ROOT_ENV = "OPENREAPER_E3_MEDIA_FOLDER_ROOT";
const E3_SOURCE_PATH_ENV = "OPENREAPER_E3_MEDIA_SOURCE_PATH";
const E3_RELINK_PATH_ENV = "OPENREAPER_E3_MEDIA_RELINK_PATH";
const E3_TARGET_TRACK_REF_ENV = "OPENREAPER_E3_MEDIA_TARGET_TRACK_REF";
const E3_TAKE_REF_ENV = "OPENREAPER_E3_MEDIA_TAKE_REF";
const E3_OPERATION_KEYS = Object.freeze([
  "query_state:media.folder_media.list",
  "run_command:template.execute",
]);
const E3_CAPABILITIES = Object.freeze([
  "media.import_file_to_track",
  "media.import_file_section_to_track",
  "media.relink_take_source",
]);

describe("E3 media live handler expansion", () => {
  it("adds a separate runtime allowlist for exactly the four E3 media route template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS, [
      "template.media.list_folder_media_files",
      "template.media.import_file_to_track",
      "template.media.import_file_section_to_track",
      "template.media.relink_take_source",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
        opt_in_env: E3_OPT_IN_ENV,
        opt_in_flag: "--live",
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: e3Input(id),
        refs: e3Refs(id),
        idempotency_key: id === "template.media.relink_take_source" ? "e3-media-route:relink-take-source" : undefined,
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "query_state:media.folder_media.list",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
      ],
    );
    assert.deepEqual(bridge.seen.slice(1).map((request) => request.pack.capability), E3_CAPABILITIES);
    assert.equal(bridge.seen[0].pack.risk, "read");
    assert.equal(bridge.seen[0].undo.mode, "none");
    for (const request of bridge.seen.slice(1)) {
      assert.equal(request.pack.id, "media");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen[3].idempotency_key, "e3-media-route:relink-take-source");

    const mixed = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: [
          ...CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS,
          ...CALL_TEMPLATE_RUNTIME_WAVE1A_LIVE_TEMPLATE_IDS,
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("keeps the E3 runner default-skipped and typed for missing fixture or transport blockers", async () => {
    const skipped = runSmoke([E3_FLAG], {
      [E3_OPT_IN_ENV]: "",
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
      [E3_FOLDER_ROOT_ENV]: "",
      [E3_SOURCE_PATH_ENV]: "",
      [E3_RELINK_PATH_ENV]: "",
    });
    assert.equal(skipped.ok, true);
    assert.equal(skipped.skipped, true);
    assert.equal(skipped.reason, "explicit_opt_in_required");
    assert.equal(skipped.wave, "E3 Media Route");
    assert.equal(skipped.spawned_reaper, false);
    assert.deepEqual(skipped.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(skipped.allowed_bridge_operations, E3_OPERATION_KEYS);

    const noExecutor = runSmokeExpectingFailure([E3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: "",
    });
    assert.equal(noExecutor.reason, "live_bridge_executor_not_configured");
    assert.equal(noExecutor.blocker, "live_bridge_executor_not_configured");
    assert.equal("attempted_template_ids" in noExecutor, false);

    const transportDir = await createTransportDir("openreaper-e3-blocker-");
    const missingFolder = runSmokeExpectingFailure([E3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [E3_FOLDER_ROOT_ENV]: join(tmpdir(), `openreaper-e3-missing-folder-${process.pid}`),
    });
    assert.equal(missingFolder.reason, "folder_root_absent");
    assert.equal(missingFolder.blocker, "folder_root_absent");
    assert.equal("attempted_template_ids" in missingFolder, false);
  });

  it("writes the exact E3 route requests to transport without starting REAPER", async () => {
    const fixture = await createE3Fixture();
    const transportDir = await createTransportDir("openreaper-e3-timeout-");
    const report = runSmokeExpectingFailure([E3_FLAG, "--live"], {
      [LIVE_BRIDGE_EXECUTOR_ENV.transport_dir]: transportDir,
      [LIVE_BRIDGE_EXECUTOR_ENV.timeout_ms]: "1",
      [E3_FOLDER_ROOT_ENV]: fixture.folderRoot,
      [E3_SOURCE_PATH_ENV]: fixture.sourcePath,
      [E3_RELINK_PATH_ENV]: fixture.relinkPath,
      [E3_TARGET_TRACK_REF_ENV]: "track:index:0",
      [E3_TAKE_REF_ENV]: "take:index:0",
    });

    assert.equal(report.reason, "live_bridge_handshake_failed");
    assert.equal(report.spawned_reaper, false);
    assert.equal(report.live_pass_claimed, false);
    assert.deepEqual(report.allowed_template_ids, CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS);
    assert.deepEqual(report.attempted_template_ids, CALL_TEMPLATE_RUNTIME_E3_MEDIA_ROUTE_TEMPLATE_IDS);

    const requests = await readTransportRequests(transportDir);
    assert.equal(requests.length, 4);
    assert.deepEqual(
      requests.map((request) => `${request.operation.family}:${request.operation.name}`),
      [
        "query_state:media.folder_media.list",
        "run_command:template.execute",
        "run_command:template.execute",
        "run_command:template.execute",
      ],
    );

    const list = requests[0];
    assert.equal(list.pack.id, "media");
    assert.equal(list.pack.risk, "read");
    assert.equal(list.undo.mode, "none");
    assert.equal(list.artifacts.allow, false);
    assert.equal(list.params.folder_ref, `folder:path:${fixture.folderRoot}`);

    for (const request of requests.slice(1)) {
      assert.equal(request.pack.id, "media");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.operation.name, "template.execute");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.deepEqual(requests.slice(1).map((request) => request.pack.capability), E3_CAPABILITIES);
    assert.equal(requests[1].refs.find((ref) => ref.kind === "file").ref, `file:path:${fixture.sourcePath}`);
    assert.equal(requests[2].params.start_percent, 0.25);
    assert.equal(requests[2].params.end_percent, 0.75);
    assert.equal(requests[3].refs.find((ref) => ref.kind === "file").ref, `file:path:${fixture.relinkPath}`);
    assert.equal(requests[3].idempotency_key, "e3-media-route:relink-take-source");
  });

  it("keeps the Lua bridge E3 media surface exact and free of raw/import-action routes", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:media\.folder_media\.list"\]/);
    assert.match(BRIDGE_SOURCE, /\["media\.import_file_to_track"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.import_file_to_track/);
    assert.match(BRIDGE_SOURCE, /\["media\.import_file_section_to_track"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.import_file_section_to_track/);
    assert.match(BRIDGE_SOURCE, /\["media\.relink_take_source"\]\s*=\s*OPENREAPER_HANDLER_EXPORTS\.relink_take_source/);
    assert.match(BRIDGE_SOURCE, /AddMediaItemToTrack/);
    assert.match(BRIDGE_SOURCE, /AddTakeToMediaItem/);
    assert.match(BRIDGE_SOURCE, /SetMediaItemTake_Source/);
    assert.match(BRIDGE_SOURCE, /CountSelectedMediaItems/);
    assert.match(BRIDGE_SOURCE, /SetMediaItemSelected/);
    assert.match(BRIDGE_SOURCE, /UpdateArrange/);
    assert.match(BRIDGE_SOURCE, /selection_restored = preserve_selection/);
    assert.match(BRIDGE_SOURCE, /PCM_Source_CreateFromFile/);
    assert.match(BRIDGE_SOURCE, /E3 media route write requests must use undo\.mode required/);
    assert.match(BRIDGE_SOURCE, /E3 media route write requests must use artifacts\.allow false/);
    assert.deepEqual(
      [...new Set([...BRIDGE_SOURCE.matchAll(/\["run_command:([^"]+)"\]\s*=/g)].map((match) => match[1]))],
      [
        "template.execute",
        "render.sample_rate.set",
        "render.format.set",
        "render.ogg_quality.set",
        "render.mp3_bitrate_kbps.set",
        "render.flac_compression.set",
        "render.aiff_bit_depth.set",
      ],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /InsertMedia|Main_OnCommand(?!Ex)|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function e3Input(id) {
  if (id === "template.media.list_folder_media_files") {
    return {
      folder_ref: "folder:path:/tmp/openreaper-e3-media",
      media_type: "audio",
      extension_filter: ["wav"],
      limit: 8,
      offset: 0,
    };
  }
  if (id === "template.media.import_file_to_track") {
    return { position_seconds: 0, preserve_selection: true };
  }
  if (id === "template.media.import_file_section_to_track") {
    return { position_seconds: 2, start_percent: 0.25, end_percent: 0.75, preserve_selection: true };
  }
  if (id === "template.media.relink_take_source") {
    return { verify_source_type: true };
  }
  return {};
}

function e3Refs(id) {
  const sourceFileRef = createObjectRef("file", { scheme: "path", value: "/tmp/openreaper-e3-source.wav" }, {
    ref: "file:path:/tmp/openreaper-e3-source.wav",
  });
  const relinkFileRef = createObjectRef("file", { scheme: "path", value: "/tmp/openreaper-e3-relink.wav" }, {
    ref: "file:path:/tmp/openreaper-e3-relink.wav",
  });
  const trackRef = createObjectRef("track", { scheme: "index", value: "0" }, { ref: "track:index:0" });
  const takeRef = createObjectRef("take", { scheme: "index", value: "0" }, { ref: "take:index:0" });
  if (id === "template.media.import_file_to_track" || id === "template.media.import_file_section_to_track") {
    return { source_file_ref: sourceFileRef, track_ref: trackRef };
  }
  if (id === "template.media.relink_take_source") {
    return { source_file_ref: relinkFileRef, take_ref: takeRef };
  }
  return {};
}

async function createTransportDir(prefix) {
  const transportDir = await mkdtemp(join(tmpdir(), prefix));
  await mkdir(join(transportDir, "requests"));
  await mkdir(join(transportDir, "results"));
  return transportDir;
}

async function createE3Fixture() {
  const folderRoot = await mkdtemp(join(tmpdir(), "openreaper-e3-media-"));
  const sourcePath = join(folderRoot, "source.wav");
  const relinkPath = join(folderRoot, "relink.wav");
  await writeFile(sourcePath, "RIFF....WAVEfmt ");
  await writeFile(relinkPath, "RIFF....WAVEfmt ");
  return { folderRoot, sourcePath, relinkPath };
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
        OPENREAPER_TEMPLATE_RUNTIME_LIVE_SMOKE: "",
        [E3_OPT_IN_ENV]: "",
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
  assert.fail("Expected E3 media live smoke script to exit with status 2.");
}

function context(extra = {}) {
  return {
    client_id: "layer4dx-e3-media-test",
    session_id: "e3-media-session",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-05T00:00:00.000Z",
    ...extra,
  };
}
