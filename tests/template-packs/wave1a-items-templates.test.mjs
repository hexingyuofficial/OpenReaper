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
  WAVE1A_ITEMS_TEMPLATE_IDS,
  createWave1AItemsTemplates,
} from "../../packages/core/src/template-packs/wave1a-items-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.set_item_fades",
  "template.items.split_item_at_time",
  "template.items.set_take_pitch",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
]);

const BLOCKED_ITEMS_IDS = Object.freeze([
  "template.items.copy_item_to_track",
  "template.items.delete_item",
  "template.items.snap_item_start_to_grid",
  "template.items.select_take",
  "template.items.set_item_loop_source",
  "template.items.set_item_bounds",
  "template.items.set_fade_shapes",
  "template.items.nudge_item",
  "template.items.set_item_group",
  "template.items.set_take_stretch_marker",
  "template.items.split_item_by_silence",
  "template.items.prepare_loop_candidate_cluster",
  "template.items.import_media_as_item",
  "template.items.render_selected_items",
  "template.items.edit_midi_notes_in_item",
  "template.items.glue_items",
]);

const READ_IDS = new Set([
  "template.items.resolve_item_ref",
  "template.items.read_item_summary",
]);

describe("Wave 1A items template descriptors", () => {
  it("exports exactly the Wave 1A items allowlist", () => {
    const templates = createWave1AItemsTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE1A_ITEMS_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_ITEMS_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A descriptor validation with items ownership and risk posture", () => {
    for (const descriptor of createWave1AItemsTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "items", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.items."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
      assert.equal(Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes, true);

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
        assert.equal(descriptor.refs.input[0].kind, "item", descriptor.id);
      }
    }
  });

  it("keeps Wave 1A ownership narrow for move, split, take, fade, and snap atoms", () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const move = catalog.require("template.items.move_item");
    const split = catalog.require("template.items.split_item_at_time");
    const trim = catalog.require("template.items.trim_item");
    const fades = catalog.require("template.items.set_item_fades");
    const pitch = catalog.require("template.items.set_take_pitch");
    const playrate = catalog.require("template.items.set_take_playrate");
    const snap = catalog.require("template.items.set_item_snap_offset");

    assert.deepEqual(Object.keys(move.inputSchema.properties), ["position_seconds"]);
    assert.equal(move.refs.input.some((entry) => entry.kind === "track"), false);
    assert.equal(move.summary.includes("without changing its track"), true);
    assert.deepEqual(split.refs.output.map((entry) => entry.name), ["left_item_ref", "right_item_ref"]);
    assert.deepEqual(trim.expectedDelta.entities.map((entry) => entry.entity_kind), ["item", "take"]);
    assert.deepEqual(fades.inputSchema.required, ["fade_in_seconds", "fade_out_seconds"]);
    assert.equal(pitch.entity_kind, "take");
    assert.equal(playrate.inputSchema.properties.preserve_pitch.type, "boolean");
    assert.deepEqual(Object.keys(snap.inputSchema.properties), ["snap_offset_seconds"]);
  });

  it("loads a pack-local catalog, rejects duplicates, and keeps default discovery bounded", () => {
    const templates = createWave1AItemsTemplates();
    const validation = validateTemplateCatalog({ templates });
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);
    for (const id of ALLOWLIST) assert.equal(catalog.require(id).id, id);

    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.items\.resolve_item_ref/.test(error.errors.join("\n")),
    );

    const response = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog).list_templates({ pack: "items" });
    assert.equal(response.contract, "discovery.menu.v1");
    assert.equal(response.kind, "template_menu");
    assert.equal(response.mode, "menu");
    assert.equal(response.items.length, ALLOWLIST.length);
    assert.equal(response.page.has_more, false);
    assert.equal(response.page.limit, 25);
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
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.items.split_item_at_time", "template.items.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.items.missing"]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("runs fake harness read smoke for item ref resolution and summary reads", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const item = itemRef("{ITEM-READ}");
    const resolveExecutor = fakeRefsExecutor([item]);

    const resolved = await executeTemplate({
      descriptor: catalog.require("template.items.resolve_item_ref"),
      input: { ref: "selected:0" },
      context: context({ request_sequence: 1 }),
      executor: resolveExecutor,
    });

    assert.equal(resolved.ok, true);
    assert.equal(resolved.template.id, "template.items.resolve_item_ref");
    assert.equal(resolved.template.risk, "read");
    assert.equal(resolved.undo.mode, "none");
    assert.deepEqual(resolved.result.refs, [item]);
    assert.equal(resolved.result.last_result.updated, false);
    assert.equal(resolveExecutor.requests[0].operation.family, "query_state");

    const summaryExecutor = fakeRefsExecutor([item]);
    const summary = await executeTemplate({
      descriptor: catalog.require("template.items.read_item_summary"),
      input: { include_take_summary: true },
      refs: { item_ref: item },
      context: context({ request_sequence: 2 }),
      executor: summaryExecutor,
    });

    assert.equal(summary.ok, true);
    assert.equal(summary.template.id, "template.items.read_item_summary");
    assert.deepEqual(summaryExecutor.requests[0].refs, [item]);
    assert.equal(summary.undo.mode, "none");
    assert.equal(summary.result.refs[0].kind, "item");
  });

  it("builds legal 4B bridge requests and fake-smokes every write item atom", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const item = itemRef("{ITEM-WRITE}");
    const left = itemRef("{ITEM-LEFT}");
    const right = itemRef("{ITEM-RIGHT}");

    for (const [index, id] of ALLOWLIST.filter((entry) => !READ_IDS.has(entry)).entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const outputRefs = id === "template.items.split_item_at_time" ? [left, right] : [item];
      const executor = fakeRefsExecutor(outputRefs);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input,
        refs: { item_ref: item },
        context: context({ request_sequence: index + 3 }),
      });

      assert.equal(request.pack.id, "items", id);
      assert.equal(request.pack.risk, "write", id);
      assert.equal(request.operation.family, "run_command", id);
      assert.equal(request.operation.name, "template.execute", id);
      assert.equal(request.undo.mode, "required", id);
      assert.equal(request.undo.label, `OpenReaper: ${descriptor.bridge.capability}`, id);
      assert.deepEqual(request.undo.flags, expectedUndoFlags(descriptor), id);
      assert.equal(request.verification.mode, "required", id);
      assert.deepEqual(request.refs, [item], id);
      assert.equal("idempotency_key" in request, false, id);

      const result = await executeTemplate({
        descriptor,
        input,
        refs: { item_ref: item },
        context: context({ request_sequence: index + 3 }),
        executor,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.undo.mode, "required", id);
      assert.equal(result.undo.closed, true, id);
      assert.equal(result.verification.status, "passed", id);
      assert.equal(result.result.last_result.updated, true, id);
      assert.deepEqual(result.result.refs, outputRefs, id);
    }
  });

  it("honors supported idempotency and rejects invalid inputs or missing refs before dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const item = itemRef("{ITEM-IDEMPOTENT}");
    const move = catalog.require("template.items.move_item");
    const idempotentRequest = buildTemplateBridgeRequest({
      descriptor: move,
      input: sampleInput("template.items.move_item"),
      refs: { item_ref: item },
      context: context({ request_sequence: 30 }),
      idempotencyKey: "items-move-key",
    });
    assert.equal(idempotentRequest.idempotency_key, "items-move-key");

    const bridge = new FakeFoundationBridge();
    const reparentAttempt = await executeTemplate({
      descriptor: move,
      input: {
        position_seconds: 4,
        to_track_id: "track:Dialog",
      },
      refs: { item_ref: item },
      context: context({ request_sequence: 31 }),
      executor: bridge,
    });
    assert.equal(reparentAttempt.ok, false);
    assert.equal(reparentAttempt.error.source, "harness");
    assert.equal(reparentAttempt.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(reparentAttempt.error.details.errors.join("\n"), /input.to_track_id is not declared/);
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor: move,
      input: sampleInput("template.items.move_item"),
      refs: {},
      context: context({ request_sequence: 32 }),
      executor: bridge,
    });
    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);

    const fadeNoop = await executeTemplate({
      descriptor: catalog.require("template.items.set_item_fades"),
      input: {},
      refs: { item_ref: item },
      context: context({ request_sequence: 33 }),
      executor: bridge,
    });
    assert.equal(fadeNoop.ok, false);
    assert.equal(fadeNoop.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(fadeNoop.error.details.errors.join("\n"), /fade_in_seconds is required/);
    assert.match(fadeNoop.error.details.errors.join("\n"), /fade_out_seconds is required/);
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps implementation scoped away from shared catalog, runtime, recipes, and blocked candidates", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave1a-items-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /template-catalog-fixtures-v1|template-catalog-v1/);
    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    for (const blockedId of BLOCKED_ITEMS_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)));
    }
    assert.doesNotMatch(source, /to_track_id|MoveMediaItemToTrack|DeleteTrackMediaItem|SplitMediaItem/);
  });
});

function sampleInput(id) {
  switch (id) {
    case "template.items.move_item":
      return { position_seconds: 4 };
    case "template.items.trim_item":
      return { length_seconds: 1.25, start_offset_seconds: 0.1 };
    case "template.items.set_item_fades":
      return { fade_in_seconds: 0.02, fade_out_seconds: null };
    case "template.items.split_item_at_time":
      return { position_seconds: 2 };
    case "template.items.set_take_pitch":
      return { semitones: -12 };
    case "template.items.set_take_playrate":
      return { playrate: 0.5, preserve_pitch: false };
    case "template.items.set_item_snap_offset":
      return { snap_offset_seconds: 0.05 };
    default:
      return {};
  }
}

function itemRef(value) {
  return createObjectRef("item", { scheme: "guid", value });
}

function fakeRefsExecutor(refs) {
  const bridge = new FakeFoundationBridge();
  const requests = [];
  const executor = (request) => {
    requests.push(request);
    const mutates = request.operation.family === "run_command";
    return bridge.okEnvelope(request, "2026-07-02T00:00:00.000Z", {
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
    session_id: "session-test",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-02T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
