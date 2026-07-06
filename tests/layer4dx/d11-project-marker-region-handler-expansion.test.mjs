import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
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
  new URL("../../reaper/bridge/src/handlers/project/d11_marker_region_mutations.lua", import.meta.url),
  "utf8",
);
const CAPABILITIES = Object.freeze([
  "project.delete_marker",
  "project.delete_region",
  "project.remove_marker",
  "project.remove_region",
  "project.rename_marker",
  "project.rename_region",
]);
const DESTRUCTIVE_CAPABILITIES = new Set(CAPABILITIES.slice(0, 4));

describe("D11 project marker/region live handler expansion", () => {
  it("registers exactly the bounded project marker/region mutation batch", () => {
    const registry = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
    validateBridgeHandlerRegistry({ cwd: ROOT.pathname, registry });
    assert.deepEqual(
      registry.entries
        .filter((entry) => entry.route === "d11-project-marker-region-handlers")
        .map((entry) => entry.template_id),
      CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
    );
  });

  it("adds a separate runtime allowlist for the six D11 template ids", async () => {
    assert.deepEqual(CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS, [
      "template.project.delete_marker",
      "template.project.delete_region",
      "template.project.remove_marker",
      "template.project.remove_region",
      "template.project.rename_marker",
      "template.project.rename_region",
    ]);

    const bridge = new FakeFoundationBridge();
    const runtime = createCallTemplateRuntime({
      live: {
        opted_in: true,
        executor: bridge,
        allowed_template_ids: CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS,
      },
      evidenceLimit: 8,
    });

    for (const [index, id] of CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS.entries()) {
      const response = await runtime.call_template({
        id,
        input: d11Input(id),
        refs: d11Refs(id),
        context: context({ request_sequence: index + 1 }),
      });
      assert.equal(response.ok, true, id);
    }

    assert.deepEqual(
      bridge.seen.map((request) => `${request.operation.family}:${request.operation.name}`),
      Array(CALL_TEMPLATE_RUNTIME_D11_PROJECT_MARKER_REGION_TEMPLATE_IDS.length).fill("run_command:template.execute"),
    );
    assert.deepEqual(bridge.seen.map((request) => request.pack.capability), CAPABILITIES);
    for (const request of bridge.seen) {
      assert.equal(request.pack.id, "project");
      assert.equal(request.pack.risk, DESTRUCTIVE_CAPABILITIES.has(request.pack.capability) ? "destructive" : "write");
      assert.equal(request.undo.mode, "required");
      assert.equal(request.verification.mode, "required");
      assert.equal(request.artifacts.allow, false);
      assert.equal(request.refs.some((ref) => ref.kind === "marker" || ref.kind === "region"), true);
      assert.equal("lua" in request, false);
      assert.equal("action" in request, false);
      assert.equal("shell" in request, false);
      assert.equal("process" in request, false);
    }
  });

  it("binds marker/region mutations through template.execute without raw execution surfaces", () => {
    for (const capability of CAPABILITIES) {
      assert.match(BRIDGE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]\\s*=\\s*${handlerExport(capability)}\\b`));
      assert.match(ROUTE_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
      assert.match(POLICY_SOURCE, new RegExp(`\\["${escapeRegExp(capability)}"\\]`));
    }
    assert.match(HANDLER_SOURCE, /EnumProjectMarkers3/);
    assert.match(HANDLER_SOURCE, /SetProjectMarkerByIndex2/);
    assert.match(HANDLER_SOURCE, /DeleteProjectMarker/);
    assert.doesNotMatch(HANDLER_SOURCE, /\b(?:Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\()\b/);
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });
});

const MARKER_REF = createObjectRef("marker", { scheme: "index", value: "1" }, {
  ref: "marker:index:1",
});
const REGION_REF = createObjectRef("region", { scheme: "index", value: "1" }, {
  ref: "region:index:1",
});

function d11Input(id) {
  if (id === "template.project.rename_marker" || id === "template.project.rename_region") {
    return { name: "OpenReaper D11" };
  }
  return {};
}

function d11Refs(id) {
  if (id.endsWith("_region")) {
    return { region_ref: REGION_REF };
  }
  return { marker_ref: MARKER_REF };
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
    "project.delete_marker": "OPENREAPER_HANDLER_EXPORTS.d11_project_delete_marker",
    "project.delete_region": "OPENREAPER_HANDLER_EXPORTS.d11_project_delete_region",
    "project.remove_marker": "OPENREAPER_HANDLER_EXPORTS.d11_project_remove_marker",
    "project.remove_region": "OPENREAPER_HANDLER_EXPORTS.d11_project_remove_region",
    "project.rename_marker": "OPENREAPER_HANDLER_EXPORTS.d11_project_rename_marker",
    "project.rename_region": "OPENREAPER_HANDLER_EXPORTS.d11_project_rename_region",
  }[capability];
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
