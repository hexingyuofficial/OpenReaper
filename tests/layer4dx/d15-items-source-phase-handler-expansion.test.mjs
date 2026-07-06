import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/items/d15_items_source_phase_route.lua", import.meta.url),
  "utf8",
);

const WRITE_CAPABILITIES = Object.freeze([
  "items.set_no_autofades",
  "items.set_invert_phase",
  "items.choose_new_source_file",
]);

describe("D15 items source/phase live handler expansion", () => {
  it("registers exactly the bounded D15 items source/phase batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d15-items-source-phase-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the three D15 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS, [
      "template.items.set_no_autofades",
      "template.items.set_invert_phase",
      "template.items.choose_new_source_file",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS,
      },
      evidenceLimit: 16,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D15_ITEMS_SOURCE_PHASE_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d15Input(id),
        refs: d15Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(WRITE_CAPABILITIES.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), WRITE_CAPABILITIES);

    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "items");
      assert.equal(request.pack.risk, "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "item" && ref.ref === ITEM_REF.ref), true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
    assert.equal(bridge.seen[2].refs.some((ref) => ref.kind === "file" && ref.ref === FILE_REF.ref), true);
  });

  it("binds source/phase handlers through extracted Lua without raw execution surfaces", () => {
    for (const [capability, handler] of [
      ["items.set_no_autofades", "d15_items_set_no_autofades"],
      ["items.set_invert_phase", "d15_items_set_invert_phase"],
      ["items.choose_new_source_file", "d15_items_choose_new_source_file"],
    ]) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*OPENREAPER_HANDLER_EXPORTS\\.${handler}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    for (const symbol of [
      "D_FADEINLEN_AUTO",
      "D_FADEOUTLEN_AUTO",
      "D_VOL",
      "PCM_Source_CreateFromFile",
      "SetMediaItemTake_Source",
      "GetMediaItemTake_Source",
      "GetMediaSourceFileName",
      "PCM_Source_Destroy",
      "VERIFICATION_FAILED",
    ]) {
      assert.match(HANDLER_SOURCE, new RegExp(escapeRegExp(symbol)), symbol);
    }
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["run_action:/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const ITEM_REF = createObjectRef("item", { scheme: "guid", value: "{D15-ITEM}" }, {
  ref: "item:guid:{D15-ITEM}",
});
const FILE_REF = createObjectRef("file", { scheme: "path", value: "/tmp/openreaper-d15.wav" }, {
  ref: "file:path:/tmp/openreaper-d15.wav",
});

function d15Input(id) {
  if (id === "template.items.set_no_autofades") {
    return { no_autofades: true };
  }
  if (id === "template.items.set_invert_phase") {
    return { invert_phase: true };
  }
  if (id === "template.items.choose_new_source_file") {
    return { preserve_timing: true };
  }
  return {};
}

function d15Refs(id) {
  if (id === "template.items.choose_new_source_file") {
    return { item_ref: ITEM_REF, file_ref: FILE_REF };
  }
  return { item_ref: ITEM_REF };
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
