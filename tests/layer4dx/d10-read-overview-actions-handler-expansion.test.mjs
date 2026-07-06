import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
  createCallTemplateRuntime,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  loadBridgeHandlerRegistry,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const PROJECT_HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/project/read_track_item_overview.lua", import.meta.url),
  "utf8",
);
const ACTION_HANDLER_SOURCE = readFileSync(
  new URL("../../reaper/bridge/src/handlers/actions/read_action_metadata.lua", import.meta.url),
  "utf8",
);
const OPERATION_KEYS = Object.freeze([
  "query_state:project.read_track_item_overview",
  "query_state:actions.read_custom_action_metadata",
  "query_state:actions.read_cycle_action_metadata",
]);
const CAPABILITIES = Object.freeze([
  "project.read_track_item_overview",
  "actions.read_custom_action_metadata",
  "actions.read_cycle_action_metadata",
]);

describe("D10 read overview/actions live handler expansion", () => {
  it("registers exactly the bounded read overview/actions batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d10-read-overview-actions-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the three D10 read template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS, [
      "template.project.read_track_item_overview",
      "template.actions.read_custom_action_metadata",
      "template.actions.read_cycle_action_metadata",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d10Input(id),
        refs: {},
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      OPERATION_KEYS,
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.risk, "read");
      assert.equal(request.undo.mode, "none");
      assert.equal(request.verification.mode, "none");
      assert.equal(request.artifacts.allow, false);
      assert.equal("idempotency_key" in request, false);
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
          ...CALL_TEMPLATE_RUNTIME_D10_READ_OVERVIEW_ACTIONS_TEMPLATE_IDS,
          "template.actions.run_guarded_custom_action",
        ],
      },
    });
    assert.deepEqual(mixed.live_gate.allowed_template_ids, []);
  });

  it("binds D10 read handlers through the generated Lua bridge without action execution surfaces", () => {
    assert.match(BRIDGE_SOURCE, /\["query_state:project\.read_track_item_overview"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_track_item_overview/);
    assert.match(BRIDGE_SOURCE, /\["query_state:actions\.read_custom_action_metadata"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_custom_action_metadata/);
    assert.match(BRIDGE_SOURCE, /\["query_state:actions\.read_cycle_action_metadata"\]\s*=\s*\{[\s\S]*?handler\s*=\s*OPENREAPER_HANDLER_EXPORTS\.read_cycle_action_metadata/);
    assert.match(PROJECT_HANDLER_SOURCE, /CountTracks/);
    assert.match(PROJECT_HANDLER_SOURCE, /CountMediaItems/);
    assert.match(PROJECT_HANDLER_SOURCE, /GetTrackMediaItem/);
    assert.match(BRIDGE_SOURCE, /kbd_getTextFromCmd/);
    assert.match(BRIDGE_SOURCE, /NamedCommandLookup/);
    assert.match(ACTION_HANDLER_SOURCE, /CF_GetSWSVersion/);
    assert.doesNotMatch(
      `${PROJECT_HANDLER_SOURCE}\n${ACTION_HANDLER_SOURCE}`,
      /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

function d10Input(id) {
  if (id === "template.project.read_track_item_overview") {
    return { max_tracks: 12, max_items_per_track: 4, include_selected_items: true };
  }
  return { section: "main", named_command: "_OPENREAPER_D10_FAKE", include_step_summary: false };
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
