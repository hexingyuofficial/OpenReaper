import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  buildLiveBridgeBundle,
  handlerModuleFilesFromRegistry,
  handlerSourceRoot,
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
const ROUTE_SOURCE = readFileSync(new URL("../../reaper/bridge/src/40-route-pack-handlers.lua", import.meta.url), "utf8");
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
const EXTRACTED_WAVE0_HANDLERS = Object.freeze(new Map([
  ["template.project.read_summary", ["project/read_summary.lua", "read_project_summary"]],
  ["template.transport.read_state", ["transport/read_state.lua", "read_transport_state"]],
  ["template.core.read_openreaper_status", ["core/read_openreaper_status.lua", "read_openreaper_status"]],
  ["template.system.read_runtime_environment", ["system/read_runtime_environment.lua", "read_runtime_environment"]],
  ["template.system.read_resource_paths", ["system/read_resource_paths.lua", "read_resource_paths"]],
]));
const EXTRACTED_WAVE1A_HANDLERS = Object.freeze(new Map([
  ["template.core.read_template_catalog_summary", ["core/read_template_catalog_summary.lua", "read_template_catalog_summary"]],
  ["template.core.read_last_result", ["core/read_last_result.lua", "read_last_result"]],
  ["template.system.check_api_symbols", ["system/check_api_symbols.lua", "read_api_symbols"]],
  ["template.project.read_metadata", ["project/read_metadata.lua", "read_project_metadata"]],
  ["template.project.list_markers_regions", ["project/list_markers_regions.lua", "list_markers_regions"]],
  ["template.project.read_tempo_map", ["project/read_tempo_map.lua", "read_tempo_map"]],
  ["template.tracks.resolve_track_ref", ["tracks/resolve_track_ref.lua", "resolve_track_ref"]],
  ["template.items.resolve_item_ref", ["items/resolve_item_ref.lua", "resolve_item_ref"]],
  ["template.items.read_item_summary", ["items/read_item_summary.lua", "read_item_summary"]],
]));
const EXTRACTED_READ_B_HANDLERS = Object.freeze(new Map([
  ["template.actions.resolve_named_command", ["actions/resolve_named_command.lua", "resolve_named_command"]],
  ["template.actions.read_action_metadata", ["actions/read_action_metadata.lua", "read_action_metadata"]],
  ["template.actions.read_action_toggle_state", ["actions/read_action_toggle_state.lua", "read_action_toggle_state"]],
  ["template.actions.read_action_shortcuts", ["actions/read_action_shortcuts.lua", "read_action_shortcuts"]],
  ["template.actions.parse_marker_action_text", ["actions/parse_marker_action_text.lua", "parse_marker_action_text"]],
  ["template.actions.search_action_commands", ["actions/search_action_commands.lua", "search_action_commands"]],
  ["template.midi.resolve_midi_take_ref", ["midi/resolve_midi_take_ref.lua", "resolve_midi_take_ref"]],
  ["template.midi.read_take_event_counts", ["midi/read_take_event_counts.lua", "read_take_event_counts"]],
  ["template.midi.list_take_notes", ["midi/list_take_notes.lua", "list_take_notes"]],
  ["template.midi.list_take_cc_events", ["midi/list_take_cc_events.lua", "list_take_cc_events"]],
  ["template.midi.list_take_text_sysex_events", ["midi/list_take_text_sysex_events.lua", "list_take_text_sysex_events"]],
  ["template.midi.read_take_grid", ["midi/read_take_grid.lua", "read_take_grid"]],
  ["template.media.probe_file", ["media/probe_file.lua", "probe_media_file"]],
  ["template.media.read_take_source", ["media/read_take_source.lua", "read_take_source"]],
  ["template.media.read_project_media_files", ["media/read_project_media_files.lua", "read_project_media_files"]],
]));
const EXTRACTED_HANDLER_ROWS = Object.freeze(new Map([
  ...EXTRACTED_WAVE0_HANDLERS,
  ...EXTRACTED_WAVE1A_HANDLERS,
  ...EXTRACTED_READ_B_HANDLERS,
]));

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
      const extractedHandler = EXTRACTED_HANDLER_ROWS.get(entry.template_id);
      if (extractedHandler) {
        assert.deepEqual([entry.handler_file, entry.handler_export], extractedHandler, entry.template_id);
        assert.doesNotMatch(entry.handler_file, /^(?:\/|[A-Za-z]:[\\/])/, entry.template_id);
        assert.doesNotMatch(entry.handler_file, /(?:^|\/)\.\.(?:\/|$)|\\/, entry.template_id);
      } else {
        assert.equal(entry.handler_file, "legacy_monolith", entry.template_id);
        assert.equal(entry.handler_export, "legacy_monolith", entry.template_id);
      }
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
      legacyMonolithCount: 31,
      extractedHandlerCount: 29,
      handlerModuleCount: 29,
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

  it("extracts exactly the Wave 0, Wave 1A, and Read-B batches into deterministic handler modules", () => {
    const extractedRows = REGISTRY.entries.filter((entry) => entry.handler_file !== "legacy_monolith");
    assert.deepEqual(extractedRows.map((entry) => entry.template_id), [...EXTRACTED_HANDLER_ROWS.keys()]);
    assert.deepEqual(
      handlerModuleFilesFromRegistry(REGISTRY),
      [...EXTRACTED_HANDLER_ROWS.values()].map(([file]) => file),
    );

    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "wave1a-read-handlers" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_WAVE1A_HANDLERS.keys()],
    );
    assert.deepEqual(
      REGISTRY.entries
        .filter((entry) => entry.route === "read-b" && entry.handler_file !== "legacy_monolith")
        .map((entry) => entry.template_id),
      [...EXTRACTED_READ_B_HANDLERS.keys()],
    );

    for (const [templateId, [file, handlerExport]] of EXTRACTED_HANDLER_ROWS) {
      const moduleSource = readFileSync(new URL(`../../${handlerSourceRoot}/${file}`, import.meta.url), "utf8");
      assert.match(moduleSource, new RegExp(`\\blocal\\s+function\\s+${handlerExport}\\s*\\(`), templateId);
      assert.doesNotMatch(moduleSource, /\b(require\s*\(|dofile|loadstring|os\.execute|io\.popen)\b/, templateId);
      assert.doesNotMatch(ROUTE_SOURCE, new RegExp(`\\blocal\\s+function\\s+${handlerExport}\\s*\\(`), templateId);
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
    assert.match(BRIDGE_SOURCE, /Handler registry: reaper\/bridge\/registry\/BRIDGE_HANDLER_REGISTRY_V1\.json \(60 registered template handler row\(s\); 31 legacy_monolith row\(s\); 29 extracted handler row\(s\); 29 handler module file\(s\)\)\./);
    let lastIndex = BRIDGE_SOURCE.indexOf("local dispatch_request = (function()");
    assert.notEqual(lastIndex, -1);
    for (const file of handlerModuleFilesFromRegistry(REGISTRY)) {
      const marker = `-- OpenReaper bridge handler module: ${handlerSourceRoot}/${file}`;
      const index = BRIDGE_SOURCE.indexOf(marker);
      assert.ok(index > lastIndex, marker);
      lastIndex = index;
    }
    assert.ok(BRIDGE_SOURCE.indexOf("local ALLOWED_OPERATIONS = {") > lastIndex);
  });

  it("keeps extracted dispatch behavior bound to the same operations and exports", () => {
    for (const [templateId, [, handlerExport]] of EXTRACTED_HANDLER_ROWS) {
      const entry = REGISTRY.entries.find((candidate) => candidate.template_id === templateId);
      const key = `${entry.operation.family}:${entry.operation.name}`;
      assert.match(
        BRIDGE_SOURCE,
        new RegExp(`\\["${escapeRegExp(key)}"\\]\\s*=\\s*\\{[\\s\\S]*?pack\\s*=\\s*"${entry.pack}"[\\s\\S]*?handler\\s*=\\s*${handlerExport}\\b`),
        templateId,
      );
    }
  });
});

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
