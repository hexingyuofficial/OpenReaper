import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
const POLICY_SOURCE = readFileSync(new URL("../../reaper/bridge/src/35-route-policy.lua", import.meta.url), "utf8");
const HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/tracks/d9_tracks_mixer_route.lua", import.meta.url),
  "utf8",
);
const OPERATION_KEYS = Object.freeze([
  "query_state:tracks.list_tracks",
  "query_state:tracks.read_mixer_controls",
  "query_state:tracks.read_folder_structure",
  "run_command:template.execute",
  "run_command:template.execute",
  "run_command:template.execute",
  "run_command:template.execute",
]);
const CAPABILITIES = Object.freeze([
  "tracks.list_tracks",
  "tracks.read_mixer_controls",
  "tracks.read_folder_structure",
  "track.set_record_arm",
  "track.set_volume",
  "track.set_pan",
  "track.set_width",
]);
const WRITE_CAPABILITIES = CAPABILITIES.slice(3);

describe("D9 tracks mixer live handler expansion", () => {
  it("registers exactly the bounded tracks mixer batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d9-tracks-mixer-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the seven D9 tracks mixer template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS, [
      "template.tracks.list_tracks",
      "template.tracks.read_mixer_controls",
      "template.tracks.read_folder_structure",
      "template.tracks.set_record_arm",
      "template.tracks.set_volume",
      "template.tracks.set_pan",
      "template.tracks.set_width",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
      },
      evidenceLimit: 12,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d9Input(id),
        refs: d9Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen.slice(0, 3)) {
      assert.equal(request.pack.id, "tracks");
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.verification.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
    }
    for (const request of bridge.seen.slice(3)) {
      assert.equal(request.pack.id, "tracks");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      if ("idempotency_key" in request) {
        assert.equal(typeof request.idempotency_key, "string");
      }
      assert.equal(request.refs.some((ref) => ref.kind === "track" && ref.ref === TRACK_REF.ref), true);
    }
    for (const request of bridge.seen) {
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
          ...CALL_TEMPLATE_RUNTIME_D9_TRACKS_MIXER_TEMPLATE_IDS,
          "template.tracks.delete_track",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("binds reads and writes through the generated Lua bridge without raw action surfaces", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:tracks\.list_tracks"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.list_tracks/);
    assert.match(BRIDGE_SOURCE, /\["query_state:tracks\.read_mixer_controls"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_mixer_controls/);
    assert.match(BRIDGE_SOURCE, /\["query_state:tracks\.read_folder_structure"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_folder_structure/);
    for (const capability of WRITE_CAPABILITIES) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handlerExport(capability)}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    assert.match(HANDLER_SOURCE, /CountTracks/);
    assert.match(HANDLER_SOURCE, /GetMediaTrackInfo_Value/);
    assert.match(HANDLER_SOURCE, /SetMediaTrackInfo_Value/);
    assert.match(HANDLER_SOURCE, /GetTrackGUID/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const TRACK_REF = createObjectRef("track", { scheme: "guid", value: "{D9-TRACK}" }, {
  ref: "track:guid:{D9-TRACK}",
});

function d9Input(id) {
  if (id === "template.tracks.list_tracks") {
    return { limit: 16, include_selection: true };
  }
  if (id === "template.tracks.read_mixer_controls") {
    return { include_selected: true, limit: 16 };
  }
  if (id === "template.tracks.read_folder_structure") {
    return { limit: 16 };
  }
  if (id === "template.tracks.set_record_arm") {
    return { armed: false };
  }
  if (id === "template.tracks.set_volume") {
    return { volume: 0.75 };
  }
  if (id === "template.tracks.set_pan") {
    return { pan: 0 };
  }
  if (id === "template.tracks.set_width") {
    return { width: 1 };
  }
  return {};
}

function d9Refs(id) {
  if (id === "template.tracks.list_tracks" || id === "template.tracks.read_folder_structure") {
    return {};
  }
  return { track_ref: TRACK_REF };
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

function handlerExport(capability) {
  return {
    "track.set_record_arm": "OPENREAPER_HANDLER_EXPORTS.set_record_arm",
    "track.set_volume": "OPENREAPER_HANDLER_EXPORTS.set_volume",
    "track.set_pan": "OPENREAPER_HANDLER_EXPORTS.set_pan",
    "track.set_width": "OPENREAPER_HANDLER_EXPORTS.set_width",
  }[capability];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
