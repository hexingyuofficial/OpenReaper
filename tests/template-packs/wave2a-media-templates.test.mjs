import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_BUDGETS,
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
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
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE2A_MEDIA_TEMPLATE_IDS,
  createWave2AMediaTemplates,
} from "../../packages/core/src/template-packs/wave2a-media-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.media.probe_file",
  "template.media.read_take_source",
  "template.media.import_file_to_track",
  "template.media.import_file_section_to_track",
  "template.media.import_files_batch",
  "template.media.read_project_media_files",
  "template.media.relink_take_source",
]);

const READ_IDS = new Set([
  "template.media.probe_file",
  "template.media.read_take_source",
  "template.media.read_project_media_files",
]);

const BLOCKED_MEDIA_IDS = Object.freeze([
  "template.media.read_media_explorer_last_preview",
  "template.media.relink_project_source_path",
  "template.media.build_source_peaks",
  "template.media.read_project_bay_sources",
  "template.media.read_sws_resource_media_slots",
  "template.media.render_source_section",
  "template.media.find_and_relink_missing_media",
  "template.media.import_folder_as_items",
  "template.media.replace_source_then_trim",
  "template.media.add_file_as_take",
  "template.media.trim_imported_item",
  "template.media.glue_items_to_source",
  "template.media.delete_source_file",
]);

describe("Wave 2A media template descriptors", () => {
  it("exports exactly the Wave 2A media allowlist", () => {
    const templates = createWave2AMediaTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE2A_MEDIA_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_MEDIA_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A descriptor validation with media ownership and risk posture", () => {
    for (const descriptor of createWave2AMediaTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "media", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.media."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.notEqual(descriptor.risk, "destructive", descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );

      if (READ_IDS.has(descriptor.id)) {
        assert.equal(descriptor.risk, "read", descriptor.id);
        assert.equal(descriptor.bridge.operation_family, "query_state", descriptor.id);
        assert.equal(descriptor.bridge.idempotency, "none", descriptor.id);
        assert.equal(descriptor.expectedDelta.kind, "read", descriptor.id);
        assert.equal(descriptor.verification.mode, "none", descriptor.id);
      } else {
        assert.equal(descriptor.risk, "write", descriptor.id);
        assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
        assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
        assert.equal(descriptor.bridge.idempotency, "supported", descriptor.id);
        assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
        assert.equal(descriptor.verification.mode, "required", descriptor.id);
        assert.equal(descriptor.verification.checks.length, 1, descriptor.id);
      }
    }
  });

  it("keeps media ownership away from item edits, project-wide relink, and output rendering", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMediaTemplates() });
    const probe = catalog.require("template.media.probe_file");
    const readTakeSource = catalog.require("template.media.read_take_source");
    const importFile = catalog.require("template.media.import_file_to_track");
    const importSection = catalog.require("template.media.import_file_section_to_track");
    const importBatch = catalog.require("template.media.import_files_batch");
    const relink = catalog.require("template.media.relink_take_source");

    assert.deepEqual(Object.keys(probe.inputSchema.properties), ["path", "include_metadata_keys"]);
    assert.deepEqual(readTakeSource.refs.input.map((entry) => entry.kind), ["take"]);
    assert.deepEqual(importFile.refs.input.map((entry) => entry.kind), ["file", "track"]);
    assert.deepEqual(importFile.refs.output.map((entry) => entry.kind), ["item", "file"]);
    assert.equal(importFile.summary.includes("existing track"), true);
    assert.deepEqual(Object.keys(importSection.inputSchema.properties), [
      "position_seconds",
      "start_percent",
      "end_percent",
      "preserve_selection",
    ]);
    assert.deepEqual(Object.keys(importBatch.inputSchema.properties), ["batch", "preserve_selection"]);
    assert.deepEqual(importBatch.refs.input.map((entry) => entry.kind), ["file", "track"]);
    assert.deepEqual(importBatch.refs.output.map((entry) => entry.kind), ["item", "take", "file"]);
    assert.equal(importBatch.bridge.capability, "media.import_files_batch");
    assert.equal(importBatch.verification.checks[0].name, "batch_items_and_sources_match");
    assert.deepEqual(relink.refs.input.map((entry) => entry.kind), ["take", "file"]);
    assert.equal(relink.summary.includes("without item-container edits"), true);
    assert.equal(catalog.get("template.media.relink_project_source_path"), null);
    assert.equal(catalog.get("template.media.render_source_section"), null);
    assert.equal(catalog.get("template.media.delete_source_file"), null);
  });

  it("loads a pack-local catalog, rejects duplicates, and keeps default discovery bounded", () => {
    const templates = createWave2AMediaTemplates();
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
        /Duplicate template id: template\.media\.probe_file/.test(error.errors.join("\n")),
    );

    const response = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog).list_templates({ pack: "media" });
    assert.equal(response.contract, "discovery.menu.v1");
    assert.equal(response.kind, "template_menu");
    assert.equal(response.mode, "menu");
    assert.equal(response.items.length, ALLOWLIST.length);
    assert.equal(response.page.has_more, false);
    assert.equal("total" in response.page, false);

    const payload = JSON.stringify(response);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
    for (const item of response.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes, true);
    }
  });

  it("supports exact id lookup with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMediaTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.media.import_file_to_track", "template.media.render_source_section"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.media.render_source_section"]);
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

  it("runs fake harness read smoke for media source reads", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMediaTemplates() });
    const file = fileRef("sample.wav");
    const take = takeRef("{TAKE-SOURCE}");

    for (const [index, id] of [...READ_IDS].entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const refs = sampleInputRefs(descriptor);
      const executor = fakeRefsExecutor(id === "template.media.read_take_source" ? [file] : [file]);
      const result = await executeTemplate({
        descriptor,
        input,
        refs: id === "template.media.read_take_source" ? { take_ref: take } : refs,
        context: context({ request_sequence: index + 1 }),
        executor,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.template.pack, "media");
      assert.equal(result.template.risk, "read");
      assert.equal(result.undo.mode, "none");
      assert.equal(result.result.last_result.updated, false);
      assert.equal(executor.requests[0].operation.family, "query_state");
    }
  });

  it("builds legal 4B bridge requests and fake-smokes media write descriptors", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMediaTemplates() });
    const file = fileRef("replacement.wav");
    const track = trackRef("{TRACK-MEDIA}");
    const take = takeRef("{TAKE-RELINK}");
    const item = itemRef("{ITEM-IMPORTED}");

    for (const [index, id] of ALLOWLIST.filter((entry) => !READ_IDS.has(entry)).entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const refs = id === "template.media.relink_take_source"
        ? { take_ref: take, source_file_ref: file }
        : id === "template.media.import_files_batch"
          ? { source_file_refs: [file, file], track_refs: [track, track] }
        : { source_file_ref: file, track_ref: track };
      const outputRefs = id === "template.media.relink_take_source"
        ? [take, file]
        : id === "template.media.import_files_batch"
          ? [item, take, file]
          : [item, file];
      const executor = fakeRefsExecutor(outputRefs);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input,
        refs,
        context: context({ request_sequence: index + 10 }),
      });

      assert.equal(request.pack.id, "media", id);
      assert.equal(request.pack.risk, "write", id);
      assert.equal(request.operation.family, "run_command", id);
      assert.equal(request.operation.name, "template.execute", id);
      assert.equal(request.undo.mode, "required", id);
      assert.equal(request.undo.label, `OpenReaper: ${descriptor.bridge.capability}`, id);
      assert.deepEqual(request.undo.flags, expectedUndoFlags(descriptor), id);
      assert.equal(request.verification.mode, "required", id);
      const expectedRefs = Object.values(refs).flatMap((value) => Array.isArray(value) ? value : [value]);
      assert.deepEqual(request.refs, expectedRefs, id);
      assert.equal("idempotency_key" in request, false, id);

      const result = await executeTemplate({
        descriptor,
        input,
        refs,
        context: context({ request_sequence: index + 10 }),
        executor,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.undo.mode, "required", id);
      assert.equal(result.result.last_result.updated, true, id);
      assert.deepEqual(result.result.refs, outputRefs, id);
    }
  });

  it("rejects invalid write inputs or missing refs before dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMediaTemplates() });
    const file = fileRef("sample.wav");
    const track = trackRef("{TRACK-MEDIA}");
    const importFile = catalog.require("template.media.import_file_to_track");
    const bridge = new FakeFoundationBridge();

    const idempotentRequest = buildTemplateBridgeRequest({
      descriptor: importFile,
      input: sampleInput("template.media.import_file_to_track"),
      refs: { source_file_ref: file, track_ref: track },
      context: context({ request_sequence: 40 }),
      idempotencyKey: "media-import-key",
    });
    assert.equal(idempotentRequest.idempotency_key, "media-import-key");

    const sourceRenderAttempt = await executeTemplate({
      descriptor: importFile,
      input: {
        position_seconds: 0,
        output_path: "/tmp/rendered.wav",
      },
      refs: { source_file_ref: file, track_ref: track },
      context: context({ request_sequence: 41 }),
      executor: bridge,
    });
    assert.equal(sourceRenderAttempt.ok, false);
    assert.equal(sourceRenderAttempt.error.source, "harness");
    assert.equal(sourceRenderAttempt.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(sourceRenderAttempt.error.details.errors.join("\n"), /input.output_path is not declared/);
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor: importFile,
      input: sampleInput("template.media.import_file_to_track"),
      refs: { source_file_ref: file },
      context: context({ request_sequence: 42 }),
      executor: bridge,
    });
    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps pack-local source static: no runtime, recipes, destructive, SWS, or blocked media owners", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-media-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /\bdestructive\b/);
    assert.doesNotMatch(source, /\bsws\b/i);
    assert.doesNotMatch(source, /run_job|artifact_metadata|render_source|source_section_render/);
    assert.doesNotMatch(source, /relink_project_source_path|delete_source_file|glue_items_to_source/);
    assert.doesNotMatch(source, /D_STARTOFFS|SplitMediaItem|SetMediaItemInfo_Value|MoveMediaItemToTrack/);
    for (const blockedId of BLOCKED_MEDIA_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)));
    }
  });
});

function sampleInput(id) {
  switch (id) {
    case "template.media.probe_file":
      return { path: "/Users/Shared/OpenReaper/sample.wav", include_metadata_keys: true };
    case "template.media.read_take_source":
      return { include_metadata_keys: true, include_parent_source: false };
    case "template.media.import_file_to_track":
      return { position_seconds: 0, preserve_selection: true };
    case "template.media.import_file_section_to_track":
      return {
        position_seconds: 2,
        start_percent: 0.25,
        end_percent: 0.75,
        preserve_selection: true,
      };
    case "template.media.import_files_batch":
      return {
        batch: [
          { id: "asset-1", position_seconds: 0 },
          { id: "asset-2", position_seconds: 2, start_percent: 0.25, end_percent: 0.75 },
        ],
        preserve_selection: true,
      };
    case "template.media.read_project_media_files":
      return { include_offline: true, include_metadata_keys: false, max_sources: 25 };
    case "template.media.relink_take_source":
      return { verify_source_type: true };
    default:
      return {};
  }
}

function sampleInputRefs(descriptor) {
  if (descriptor.id === "template.media.import_files_batch") {
    return {
      source_file_refs: [fileRef("sample-a.wav"), fileRef("sample-b.wav")],
      track_refs: [trackRef("{TRACK-A}"), trackRef("{TRACK-B}")],
    };
  }
  return Object.fromEntries(
    descriptor.refs.input.map((refDeclaration) => [refDeclaration.name, sampleObjectRef(refDeclaration.kind)]),
  );
}

function sampleObjectRef(kind) {
  if (kind === "file") return fileRef("sample.wav");
  if (kind === "track") return trackRef("{TRACK}");
  if (kind === "take") return takeRef("{TAKE}");
  if (kind === "item") return itemRef("{ITEM}");
  return createObjectRef(kind, { scheme: "guid", value: `{${kind.toUpperCase()}}` });
}

function fileRef(name) {
  return createObjectRef("file", { scheme: "path", value: `/Users/Shared/OpenReaper/${name}` });
}

function itemRef(value) {
  return createObjectRef("item", { scheme: "guid", value });
}

function takeRef(value) {
  return createObjectRef("take", { scheme: "guid", value });
}

function trackRef(value) {
  return createObjectRef("track", { scheme: "guid", value });
}

function fakeRefsExecutor(refs) {
  const bridge = new FakeFoundationBridge();
  const requests = [];
  const executor = (request) => {
    requests.push(request);
    const mutates = request.operation.family === "run_command";
    return bridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
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
  executor.requests = requests;
  return executor;
}

function expectedUndoFlags(descriptor) {
  return [...new Set(descriptor.expectedDelta.entities.map((entry) => entry.entity_kind))];
}

function context(overrides = {}) {
  return {
    session_id: "session-media-pack",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
