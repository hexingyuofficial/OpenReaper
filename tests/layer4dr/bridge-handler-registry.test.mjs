import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildLiveBridgeBundle,
  loadBridgeHandlerRegistry,
  registryRoutes,
  validateBridgeHandlerRegistry,
} from "../../scripts/build-live-bridge.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";

const ROOT = new URL("../..", import.meta.url);
const BRIDGE_SOURCE = readFileSync(new URL("../../reaper/bridge/openreaper-live-bridge.lua", import.meta.url), "utf8");
const REGISTRY = loadBridgeHandlerRegistry({ cwd: ROOT.pathname });
const REQUIRED_ENTRY_FIELDS = Object.freeze([
  "template_id",
  "operation",
  "pack",
  "risk",
  "route",
  "handler_file",
  "handler_export",
  "artifact_policy",
  "tests",
]);

describe("Layer 4D.R bridge handler registry", () => {
  it("defines one standard registered handler entry shape", () => {
    assert.equal(REGISTRY.contract, "openreaper.bridge_handler_registry.v1");
    assert.equal(REGISTRY.entries.length, 60);
    for (const entry of REGISTRY.entries) {
      for (const field of REQUIRED_ENTRY_FIELDS) {
        assert.equal(Object.hasOwn(entry, field), true, `${entry.template_id}:${field}`);
      }
      assert.match(entry.template_id, /^template\.[a-z][a-z0-9_]*(?:\.[a-z][a-z0-9_]*)+$/);
      assert.match(entry.operation.family, /^(query_state|run_command|run_job|run_action|artifact_metadata)$/);
      assert.equal(typeof entry.operation.name, "string");
      assert.match(entry.artifact_policy, /^(none|metadata|write)$/);
      assert.equal(Array.isArray(entry.tests), true);
      assert.equal(entry.tests.length > 0, true);
      assert.equal(entry.handler_file, "legacy_monolith");
      assert.equal(entry.handler_export, "legacy_monolith");
      if (entry.operation.name === "template.execute") {
        assert.equal(typeof entry.capability, "string", entry.template_id);
      } else {
        assert.equal(Object.hasOwn(entry, "capability"), false, entry.template_id);
      }
    }
  });

  it("matches accepted catalog descriptors and live route allowlists exactly", () => {
    const summary = validateBridgeHandlerRegistry({ cwd: ROOT.pathname });
    assert.deepEqual(summary, {
      contract: "openreaper.bridge_handler_registry.v1",
      entryCount: 60,
      legacyMonolithCount: 60,
      routeCount: 7,
      operationCount: 37,
    });

    const catalog = createAcceptedOfficialTemplateCatalog();
    const accepted = new Set(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    for (const entry of REGISTRY.entries) {
      assert.equal(accepted.has(entry.template_id), true, entry.template_id);
      const descriptor = catalog.require(entry.template_id);
      assert.equal(entry.pack, descriptor.pack, entry.template_id);
      assert.equal(entry.risk, descriptor.risk, entry.template_id);
      assert.equal(entry.operation.family, descriptor.bridge.operation_family, entry.template_id);
      assert.equal(entry.operation.name, descriptor.bridge.operation_name, entry.template_id);
      if (entry.operation.name === "template.execute") {
        assert.equal(entry.capability, descriptor.bridge.capability, entry.template_id);
      }
    }

    for (const [route, spec] of Object.entries(registryRoutes)) {
      assert.deepEqual(
        REGISTRY.entries.filter((entry) => entry.route === route).map((entry) => entry.template_id),
        spec.ids,
        route,
      );
    }
  });

  it("keeps Lua callable operations registered without adding raw execution surfaces", () => {
    const registeredOperationKeys = [
      ...new Set(REGISTRY.entries.map((entry) => `${entry.operation.family}:${entry.operation.name}`)),
    ].sort();
    const luaOperationKeys = [
      ...new Set(
        [...BRIDGE_SOURCE.matchAll(/\["(query_state|run_command|run_job|run_action|artifact_metadata):([^"]+)"\]\s*=/g)]
          .map((match) => `${match[1]}:${match[2]}`),
      ),
    ].sort();

    assert.deepEqual(luaOperationKeys, registeredOperationKeys);
    assert.deepEqual(
      [...new Set(REGISTRY.entries.filter((entry) => entry.operation.name === "template.execute").map((entry) => entry.capability))],
      [
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
      ],
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /\["(?:run_action|artifact_metadata):/);
    assert.doesNotMatch(
      BRIDGE_SOURCE,
      /\b(Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand|ExecProcess|CF_ShellExecute|os\.execute|io\.popen|loadstring|dofile|require\s*\(|REAPER\.app)\b/,
    );
    assert.doesNotMatch(BRIDGE_SOURCE, /LIVE_SMOKE_MATRIX|list_recipes|recipes\/|call_recipe/);
  });

  it("keeps the generated bundle deterministic and registry-stamped", () => {
    const rebuilt = buildLiveBridgeBundle({ cwd: ROOT.pathname });
    assert.equal(rebuilt, BRIDGE_SOURCE);
    assert.match(BRIDGE_SOURCE, /Handler registry: reaper\/bridge\/registry\/BRIDGE_HANDLER_REGISTRY_V1\.json \(60 registered template handler row\(s\); 60 legacy_monolith row\(s\)\)\./);
  });
});
