import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/tracks/d16_tracks_org_route.lua", import.meta.url),
  "utf8",
);

const CAPABILITIES = Object.freeze([
  "track.delete",
  "tracks.delete",
  "track.create_folder",
  "track.set_folder_depth",
  "track.move",
  "tracks.move",
  "tracks.nest_in_folder",
]);

describe("D16 tracks organization live handler expansion", () => {
  it("registers exactly the bounded D16 tracks organization batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d16-tracks-org-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the seven D16 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS, [
      "template.tracks.delete_track",
      "template.tracks.delete_tracks",
      "template.tracks.create_folder_track",
      "template.tracks.set_folder_depth",
      "template.tracks.move_track",
      "template.tracks.move_tracks",
      "template.tracks.nest_tracks_in_folder",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D16_TRACKS_ORG_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d16Input(id),
        refs: d16Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(CAPABILITIES.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    assert.deepEqual(bridge.seen.map((request) => request.pack.risk), [
      "destructive",
      "destructive",
      "write",
      "write",
      "write",
      "write",
      "write",
    ]);

    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "tracks");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }

    assert.equal(bridge.seen[2].refs.length, 0);
    assert.deepEqual(bridge.seen[6].refs.map((ref) => ref.ref), [
      FOLDER_REF.ref,
      TRACK_A_REF.ref,
    ]);
  });

  it("binds tracks organization handlers through extracted Lua without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["track.delete", "d16_tracks_delete_track"],
      ["tracks.delete", "d16_tracks_delete_tracks"],
      ["track.create_folder", "d16_tracks_create_folder_track"],
      ["track.set_folder_depth", "d16_tracks_set_folder_depth"],
      ["track.move", "d16_tracks_move_track"],
      ["tracks.move", "d16_tracks_move_tracks"],
      ["tracks.nest_in_folder", "d16_tracks_nest_tracks_in_folder"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "DeleteTrack",
      "InsertTrackAtIndex",
      "SetMediaTrackInfo_Value",
      "I_FOLDERDEPTH",
      "SetTrackSelected",
      "ReorderSelectedTracks",
      "TrackList_AdjustWindows",
      "VERIFICATION_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const FOLDER_REF = createObjectRef("track", { scheme: "guid", value: "{D16-FOLDER}" }, {
  ref: "track:guid:{D16-FOLDER}",
});
const TRACK_A_REF = createObjectRef("track", { scheme: "guid", value: "{D16-A}" }, {
  ref: "track:guid:{D16-A}",
});
const TRACK_B_REF = createObjectRef("track", { scheme: "guid", value: "{D16-B}" }, {
  ref: "track:guid:{D16-B}",
});

function d16Input(id) {
  if (id === "template.tracks.create_folder_track") {
    return { name: "D16 Folder", index: 0 };
  }
  if (id === "template.tracks.set_folder_depth") {
    return { folder_depth: 1 };
  }
  if (id === "template.tracks.move_track" || id === "template.tracks.move_tracks") {
    return { index: 0 };
  }
  return {};
}

function d16Refs(id) {
  if (id === "template.tracks.create_folder_track") {
    return {};
  }
  if (id === "template.tracks.delete_tracks" || id === "template.tracks.move_tracks") {
    return { track_ref: [TRACK_A_REF, TRACK_B_REF] };
  }
  if (id === "template.tracks.nest_tracks_in_folder") {
    return { folder_ref: FOLDER_REF, track_ref: TRACK_A_REF };
  }
  return { track_ref: TRACK_A_REF };
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
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
