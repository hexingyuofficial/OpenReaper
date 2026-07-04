import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_BUDGETS,
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
  validateTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";
import {
  P1_TEMPLATE_FILL_TEMPLATE_IDS,
  createP1TemplateFillTemplates,
} from "../../packages/core/src/template-packs/p1-template-fill-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.fx.search_installed_fx",
  "template.media.list_folder_media_files",
  "template.items.copy_item_to_track",
]);

const HELD_OR_REJECTED_IDS = Object.freeze([
  "template.items.set_item_loop_source",
  "template.media.import_folder_as_items",
  "template.media.relink_project_source_path",
  "template.media.delete_source_file",
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_preset_by_name",
  "template.fx.open_fx_window",
  "template.items.clone_all_takes_to_track",
  "template.items.copy_item_with_take_fx",
  "template.items.copy_item_to_track_via_clipboard",
  "template.actions.run_raw_action",
  "template.system.run_shell_command",
]);

const READ_IDS = new Set([
  "template.fx.search_installed_fx",
  "template.media.list_folder_media_files",
]);

describe("P1 template fill descriptors", () => {
  it("exports exactly the approved P1 descriptor allowlist", () => {
    const templates = createP1TemplateFillTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(P1_TEMPLATE_FILL_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);

    for (const id of HELD_OR_REJECTED_IDS) {
      assert.equal(ids.includes(id), false, id);
    }
  });

  it("passes frozen descriptor validation for all three descriptors", () => {
    for (const descriptor of createP1TemplateFillTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], descriptor.pack, descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }
  });

  it("keeps pack, risk, bridge, idempotency, and verification boundaries exact", () => {
    const catalog = createTemplateCatalog({ templates: createP1TemplateFillTemplates() });
    const fx = catalog.require("template.fx.search_installed_fx");
    const media = catalog.require("template.media.list_folder_media_files");
    const copy = catalog.require("template.items.copy_item_to_track");

    assert.equal(fx.pack, "fx");
    assert.equal(fx.risk, "read");
    assert.equal(fx.bridge.operation_family, "query_state");
    assert.equal(fx.bridge.operation_name, "fx.installed.search");
    assert.equal(fx.bridge.capability, "fx.installed.search");
    assert.equal(fx.bridge.idempotency, "none");
    assert.deepEqual(Object.keys(fx.inputSchema.properties), ["query", "limit", "offset"]);
    assert.equal(Object.hasOwn(fx.outputSchema.properties, "rows"), true);
    assert.equal(Object.hasOwn(fx.outputSchema.properties, "truncated"), true);
    assert.equal(fx.verification.mode, "none");
    assert.equal(fx.expectedDelta.kind, "read");

    assert.equal(media.pack, "media");
    assert.equal(media.risk, "read");
    assert.equal(media.bridge.operation_family, "query_state");
    assert.equal(media.bridge.operation_name, "media.folder_media.list");
    assert.equal(media.bridge.capability, "media.folder_media.list");
    assert.equal(media.bridge.idempotency, "none");
    assert.deepEqual(media.inputSchema.required, ["folder_ref"]);
    assert.equal(Object.hasOwn(media.inputSchema.properties, "recursive"), false);
    assert.equal(Object.hasOwn(media.outputSchema.properties, "file_refs"), true);
    assert.equal(Object.hasOwn(media.outputSchema.properties, "truncated"), true);
    assert.deepEqual(media.refs.output.map((entry) => entry.kind), ["file"]);
    assert.equal(media.verification.mode, "none");
    assert.equal(media.expectedDelta.kind, "read");

    assert.equal(copy.pack, "items");
    assert.equal(copy.risk, "write");
    assert.equal(copy.bridge.operation_family, "run_command");
    assert.equal(copy.bridge.operation_name, "template.execute");
    assert.equal(copy.bridge.capability, "item.copy_to_track");
    assert.equal(copy.bridge.idempotency, "supported");
    assert.deepEqual(copy.inputSchema.required, ["position_seconds"]);
    assert.deepEqual(copy.refs.input.map((entry) => [entry.name, entry.kind]), [
      ["source_item_ref", "item"],
      ["target_track_ref", "track"],
    ]);
    assert.deepEqual(copy.refs.output.map((entry) => [entry.name, entry.kind]), [
      ["new_item_ref", "item"],
    ]);
    assert.equal(copy.outputSchema.properties.copy_depth.const, "active_take_footprint");
    assert.equal(copy.expectedDelta.kind, "mutation");
    assert.equal(copy.expectedDelta.idempotent, false);
    assert.deepEqual(copy.expectedDelta.entities.map((entry) => `${entry.entity_kind}:${entry.action}`), [
      "item:read",
      "track:read",
      "item:create",
    ]);
    assert.equal(copy.verification.mode, "required");
    assert.deepEqual(copy.verification.checks.map((entry) => entry.name), [
      "new_item_created",
      "target_track_matches",
      "position_matches",
    ]);
  });

  it("loads only as a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createP1TemplateFillTemplates();
    const validation = validateTemplateCatalog({ templates });
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);

    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.fx\.search_installed_fx/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const page = discovery.list_templates({ limit: 2 });
    assert.equal(page.contract, "discovery.menu.v1");
    assert.equal(page.kind, "template_menu");
    assert.equal(page.mode, "menu");
    assert.equal(page.items.length, 2);
    assert.equal(page.page.has_more, true);
    assert.equal("total" in page.page, false);

    for (const item of page.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes, true);
    }

    const mediaOnly = discovery.list_templates({ pack: "media" });
    assert.deepEqual(mediaOnly.items.map((item) => item.id), ["template.media.list_folder_media_files"]);

    const payload = JSON.stringify(page);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("supports exact id expansion through the Layer 1.5 discovery path", () => {
    const catalog = createTemplateCatalog({ templates: createP1TemplateFillTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: [
        "template.media.list_folder_media_files",
        "template.items.set_item_loop_source",
        "template.fx.search_installed_fx",
      ],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.items.set_item_loop_source"]);
    assert.deepEqual(response.items.map((item) => item.id), [
      "template.media.list_folder_media_files",
      "template.fx.search_installed_fx",
    ]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "outputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("fake-smokes one read and one write descriptor with FakeFoundationBridge", async () => {
    const catalog = createTemplateCatalog({ templates: createP1TemplateFillTemplates() });
    const readBridge = new FakeFoundationBridge();
    const readDescriptor = catalog.require("template.fx.search_installed_fx");
    const readRequest = buildTemplateBridgeRequest({
      descriptor: readDescriptor,
      input: { query: "Rea", limit: 8, offset: 0 },
      refs: {},
      context: context({ request_sequence: 1 }),
    });

    assert.equal(readRequest.operation.family, "query_state");
    assert.equal(readRequest.operation.name, "fx.installed.search");
    assert.equal(readRequest.pack.id, "fx");
    assert.equal(readRequest.pack.risk, "read");
    assert.equal(readRequest.undo.mode, "none");
    assert.equal(readRequest.artifacts.allow, false);
    assert.equal("idempotency_key" in readRequest, false);

    const readResult = await executeTemplate({
      descriptor: readDescriptor,
      input: { query: "Rea", limit: 8, offset: 0 },
      refs: {},
      context: context({ request_sequence: 1 }),
      executor: readBridge,
    });

    assert.equal(readResult.ok, true);
    assert.equal(readResult.template.id, "template.fx.search_installed_fx");
    assert.equal(readResult.result.last_result.updated, false);
    assert.equal(readBridge.seen.length, 1);

    const sourceItem = itemRef("{SOURCE-ITEM}");
    const targetTrack = trackRef("{TARGET-TRACK}");
    const newItem = itemRef("{NEW-ITEM}");
    const writeBridge = fakeBridgeWithRefs([newItem]);
    const writeDescriptor = catalog.require("template.items.copy_item_to_track");
    const writeRequest = buildTemplateBridgeRequest({
      descriptor: writeDescriptor,
      input: { position_seconds: 4 },
      refs: { source_item_ref: sourceItem, target_track_ref: targetTrack },
      context: context({ request_sequence: 2 }),
    });

    assert.equal(writeRequest.operation.family, "run_command");
    assert.equal(writeRequest.operation.name, "template.execute");
    assert.equal(writeRequest.pack.id, "items");
    assert.equal(writeRequest.pack.capability, "item.copy_to_track");
    assert.equal(writeRequest.pack.risk, "write");
    assert.equal(writeRequest.undo.mode, "required");
    assert.equal(writeRequest.verification.mode, "required");
    assert.deepEqual(writeRequest.refs, [sourceItem, targetTrack]);
    assert.equal(writeRequest.artifacts.allow, false);

    const writeResult = await executeTemplate({
      descriptor: writeDescriptor,
      input: { position_seconds: 4 },
      refs: { source_item_ref: sourceItem, target_track_ref: targetTrack },
      context: context({ request_sequence: 2 }),
      executor: writeBridge,
    });

    assert.equal(writeResult.ok, true);
    assert.equal(writeResult.template.id, "template.items.copy_item_to_track");
    assert.equal(writeResult.result.last_result.updated, true);
    assert.deepEqual(writeResult.result.refs, [newItem]);
    assert.equal(writeBridge.seen.length, 1);
  });

  it("keeps the P1 ids out of the shared accepted catalog until control tower merge", () => {
    const officialCatalog = createAcceptedOfficialTemplateCatalog();
    const currentSharedIds = [
      ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
    ];

    assert.deepEqual(currentSharedIds, CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS);
    assert.deepEqual(currentSharedIds, RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS);

    for (const id of ALLOWLIST) {
      assert.equal(officialCatalog.get(id), null, id);
      assert.equal(currentSharedIds.includes(id), false, id);
      assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.includes(id), false, id);
      assert.equal(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS.includes(id), false, id);
    }
  });

  it("keeps descriptors free of broad execution, path escape, and recipe-shaped behavior", () => {
    const templates = createP1TemplateFillTemplates();
    const serialized = JSON.stringify(templates);
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/p1-template-fill-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.equal(templates.every((descriptor) => descriptor.risk !== "destructive"), true);
    assert.equal(templates.every((descriptor) => descriptor.artifacts.mode === "none"), true);
    assert.equal(templates.every((descriptor) => !descriptor.tags.some((tag) => ["loop", "cleanup", "delivery", "layer", "music_sketch"].includes(tag))), true);

    for (const id of HELD_OR_REJECTED_IDS) {
      assert.equal(templates.some((descriptor) => descriptor.id === id), false, id);
    }

    assert.doesNotMatch(source, /template-catalog-fixtures-v1|call-template-runtime|reaper\/bridge|LIVE_SMOKE_MATRIX/);
    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|os\.execute|io\.popen/);
    assert.doesNotMatch(serialized, /run_action|Main_OnCommand|NamedCommandLookup|action_id|command_id/);
    assert.doesNotMatch(serialized, /lua|shell|process|raw_descriptor|bridge_request/);
    assert.doesNotMatch(serialized, /\.\.|file:\/\/|path_escape|traversal|symlink/);
    assert.doesNotMatch(serialized, /instantiat|plugin_name|add_track_fx|add_take_fx|open_fx_window|set_fx_/);
    assert.doesNotMatch(serialized, /import_file|folder_import|relink|delete_source|glue|render_source/);
    assert.doesNotMatch(serialized, /clone_all|all_takes|take_fx|envelope|grouping|fixed_lane|clipboard|selection/);
    assert.doesNotMatch(serialized, /recipe\.|workflow|live_smoke|matrix/i);
  });
});

function fakeBridgeWithRefs(refs) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithRefs(request, startedAt) {
    const mutates = request.operation.family === "run_command";
    return this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      artifacts: [],
      jobs: [],
      last_result: {
        updated: mutates,
        refs: mutates ? refs : [],
        truncated: false,
      },
    });
  };
  return bridge;
}

function itemRef(value) {
  return createObjectRef("item", { scheme: "guid", value });
}

function trackRef(value) {
  return createObjectRef("track", { scheme: "guid", value });
}

function context(overrides = {}) {
  return {
    session_id: "session-p1-template-fill",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-04T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
