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
  "template.items.list_selected_items",
  "template.items.set_exact_selection",
  "template.items.list_items_on_track",
  "template.items.move_item",
  "template.items.trim_item",
  "template.items.delete_item",
  "template.items.delete_items",
  "template.items.set_item_volume",
  "template.items.set_item_take_controls_batch",
  "template.items.set_take_volume",
  "template.items.set_take_pan",
  "template.items.set_active_take",
  "template.items.rename_take",
  "template.items.set_loop_source",
  "template.items.set_mute",
  "template.items.set_lock",
  "template.items.set_no_autofades",
  "template.items.set_play_all_takes",
  "template.items.set_take_start_in_source",
  "template.items.set_channel_mode",
  "template.items.set_invert_phase",
  "template.items.set_reverse",
  "template.items.set_pitch_shift_mode",
  "template.items.set_stretch_marker_fade_size",
  "template.items.choose_new_source_file",
  "template.items.set_item_fades",
  "template.items.split_item_at_time",
  "template.items.set_take_pitch",
  "template.items.set_take_playrate",
  "template.items.set_item_snap_offset",
]);

const BLOCKED_ITEMS_IDS = Object.freeze([
  "template.items.set_item_pan",
  "template.items.copy_item_to_track",
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
  "template.items.list_selected_items",
  "template.items.list_items_on_track",
]);

const DESTRUCTIVE_IDS = new Set([
  "template.items.delete_item",
  "template.items.delete_items",
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

  it("exposes optional native D1 readback fields on read_item_summary without new templates", () => {
    const summary = createWave1AItemsTemplates().find((descriptor) => descriptor.id === "template.items.read_item_summary");
    assert.ok(summary);
    const properties = summary.outputSchema.properties;
    assert.equal(properties.volume_db.type, "number");
    assert.deepEqual(properties.active_take_ref.oneOf, [{ type: "string" }, { type: "null" }]);
    assert.equal(properties.take_volume_db.type, "number");
    assert.equal(properties.take_pan.type, "number");
    assert.equal(properties.take_pitch_semitones.type, "number");
    assert.equal(properties.playrate.type, "number");
    assert.equal(properties.preserve_pitch.type, "boolean");
    assert.deepEqual(summary.outputSchema.required, ["item_ref", "position_seconds", "length_seconds"]);
    assert.equal(Object.hasOwn(properties, "active_take_name"), true);
    assert.equal(Object.hasOwn(properties, "take_count"), true);
    assert.equal(createWave1AItemsTemplates().length, ALLOWLIST.length);
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
        assert.equal(descriptor.risk, DESTRUCTIVE_IDS.has(descriptor.id) ? "destructive" : "write", descriptor.id);
        assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
        assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
        assert.equal(descriptor.bridge.idempotency, DESTRUCTIVE_IDS.has(descriptor.id) ? "none" : "supported", descriptor.id);
        assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
        assert.equal(descriptor.verification.mode, "required", descriptor.id);
        assert.equal(descriptor.verification.checks.length, 1, descriptor.id);
        if (descriptor.id === "template.items.set_item_take_controls_batch") {
          assert.deepEqual(descriptor.refs.input, [], descriptor.id);
          assert.equal(descriptor.inputSchema.properties.batch.type, "array", descriptor.id);
        } else if (descriptor.id === "template.items.set_exact_selection") {
          assert.deepEqual(descriptor.refs.input, [], descriptor.id);
          assert.equal(descriptor.inputSchema.properties.item_refs.type, "array", descriptor.id);
          assert.equal(descriptor.inputSchema.properties.item_refs.maxItems, 64, descriptor.id);
        } else {
          assert.equal(descriptor.refs.input[0].kind, "item", descriptor.id);
        }
      }
    }
  });

  it("keeps Wave 1A ownership narrow for move, split, take, fade, and snap atoms", () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const move = catalog.require("template.items.move_item");
    const split = catalog.require("template.items.split_item_at_time");
    const trim = catalog.require("template.items.trim_item");
    const deleteOne = catalog.require("template.items.delete_item");
    const deleteMany = catalog.require("template.items.delete_items");
    const itemVolume = catalog.require("template.items.set_item_volume");
    const takeVolume = catalog.require("template.items.set_take_volume");
    const takePan = catalog.require("template.items.set_take_pan");
    const activeTake = catalog.require("template.items.set_active_take");
    const renameTake = catalog.require("template.items.rename_take");
    const loopSource = catalog.require("template.items.set_loop_source");
    const mute = catalog.require("template.items.set_mute");
    const lock = catalog.require("template.items.set_lock");
    const noAutofades = catalog.require("template.items.set_no_autofades");
    const playAllTakes = catalog.require("template.items.set_play_all_takes");
    const takeStart = catalog.require("template.items.set_take_start_in_source");
    const channelMode = catalog.require("template.items.set_channel_mode");
    const invertPhase = catalog.require("template.items.set_invert_phase");
    const reverse = catalog.require("template.items.set_reverse");
    const pitchMode = catalog.require("template.items.set_pitch_shift_mode");
    const stretchFade = catalog.require("template.items.set_stretch_marker_fade_size");
    const sourceFile = catalog.require("template.items.choose_new_source_file");
    const fades = catalog.require("template.items.set_item_fades");
    const pitch = catalog.require("template.items.set_take_pitch");
    const playrate = catalog.require("template.items.set_take_playrate");
    const snap = catalog.require("template.items.set_item_snap_offset");
    const selected = catalog.require("template.items.list_selected_items");
    const onTrack = catalog.require("template.items.list_items_on_track");

    assert.deepEqual(Object.keys(move.inputSchema.properties), ["position_seconds"]);
    assert.equal(move.refs.input.some((entry) => entry.kind === "track"), false);
    assert.equal(move.summary.includes("without changing its track"), true);
    assert.deepEqual(split.refs.output.map((entry) => entry.name), ["left_item_ref", "right_item_ref"]);
    assert.deepEqual(trim.expectedDelta.entities.map((entry) => entry.entity_kind), ["item", "take"]);
    assert.equal(deleteOne.risk, "destructive");
    assert.equal(deleteMany.risk, "destructive");
    assert.equal(deleteMany.refs.input[0].name, "item_ref");
    assert.deepEqual(Object.keys(itemVolume.inputSchema.properties), ["volume_db"]);
    assert.equal(takeVolume.entity_kind, "take");
    assert.equal(takePan.entity_kind, "take");
    assert.deepEqual(activeTake.inputSchema, {
      type: "object",
      properties: {},
      required: [],
      additionalProperties: false,
    });
    assert.deepEqual(activeTake.refs.input.map((entry) => [entry.name, entry.kind]), [
      ["item_ref", "item"],
      ["take_ref", "take"],
    ]);
    assert.deepEqual(activeTake.refs.output.map((entry) => [entry.name, entry.kind]), [
      ["item_ref", "item"],
      ["active_take_ref", "take"],
    ]);
    assert.equal(activeTake.summary.includes("without relying on item or take selection"), true);
    assert.deepEqual(Object.keys(renameTake.inputSchema.properties), ["name"]);
    assert.deepEqual(Object.keys(loopSource.inputSchema.properties), ["loop_source"]);
    assert.deepEqual(Object.keys(mute.inputSchema.properties), ["muted"]);
    assert.deepEqual(Object.keys(lock.inputSchema.properties), ["locked"]);
    assert.deepEqual(Object.keys(noAutofades.inputSchema.properties), ["no_autofades"]);
    assert.deepEqual(Object.keys(playAllTakes.inputSchema.properties), ["play_all_takes"]);
    assert.deepEqual(Object.keys(takeStart.inputSchema.properties), ["start_offset_seconds"]);
    assert.deepEqual(channelMode.inputSchema.properties.channel_mode.enum, ["normal", "mono_left", "mono_right", "reverse_stereo"]);
    assert.deepEqual(Object.keys(invertPhase.inputSchema.properties), ["invert_phase"]);
    assert.deepEqual(Object.keys(reverse.inputSchema.properties), ["reverse"]);
    assert.deepEqual(Object.keys(pitchMode.inputSchema.properties), ["mode"]);
    assert.deepEqual(Object.keys(stretchFade.inputSchema.properties), ["fade_size_ms"]);
    assert.deepEqual(sourceFile.refs.input.map((entry) => entry.kind), ["item", "file"]);
    assert.deepEqual(fades.inputSchema.required, ["fade_in_seconds", "fade_out_seconds"]);
    assert.equal(pitch.entity_kind, "take");
    assert.equal(playrate.inputSchema.properties.preserve_pitch.type, "boolean");
    assert.deepEqual(Object.keys(snap.inputSchema.properties), ["snap_offset_seconds"]);
    assert.deepEqual(selected.refs.output.map((entry) => entry.kind), ["item", "track"]);
    assert.deepEqual(onTrack.refs.input.map((entry) => entry.kind), ["track"]);
    assert.deepEqual(onTrack.refs.output.map((entry) => entry.kind), ["track", "item"]);
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
    assert.equal(response.items.length, 25);
    assert.equal(response.page.has_more, true);
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

  it("normalizes canonical refs from structured item summary ref fields", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const item = itemRef("{ITEM-SUMMARY}");
    const track = trackRef("{TRACK-SUMMARY}");
    const executor = fakeSummaryExecutor({
      item_ref: item.ref,
      track_ref: track.ref,
      position_seconds: 0,
      length_seconds: 1.5,
    });

    const resolved = await executeTemplate({
      descriptor: catalog.require("template.items.resolve_item_ref"),
      input: { ref: "selected:0" },
      context: context({ request_sequence: 3 }),
      executor,
    });

    assert.equal(resolved.ok, true);
    assert.deepEqual(resolved.result.summary.item_ref, item.ref);
    assert.deepEqual(resolved.result.refs.map((ref) => ref.ref), [item.ref, track.ref]);
    assert.deepEqual(resolved.result.refs.map((ref) => ref.kind), ["item", "track"]);
  });

  it("builds legal 4B bridge requests and fake-smokes every write item atom", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1AItemsTemplates() });
    const item = itemRef("{ITEM-WRITE}");
    const take = takeRef("{TAKE-WRITE}");
    const file = fileRef("{FILE-WRITE}");
    const left = itemRef("{ITEM-LEFT}");
    const right = itemRef("{ITEM-RIGHT}");

    for (const [index, id] of ALLOWLIST.filter((entry) => !READ_IDS.has(entry)).entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const refs = id === "template.items.set_item_take_controls_batch" || id === "template.items.set_exact_selection"
        ? {}
        : id === "template.items.choose_new_source_file"
          ? { item_ref: item, file_ref: file }
          : id === "template.items.set_active_take"
            ? { item_ref: item, take_ref: take }
            : { item_ref: item };
      const outputRefs = outputRefsFor(id, { item, take, file, left, right });
      const executor = fakeRefsExecutor(outputRefs);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input,
        refs,
        context: context({ request_sequence: index + 3 }),
      });

      assert.equal(request.pack.id, "items", id);
      assert.equal(request.pack.risk, DESTRUCTIVE_IDS.has(id) ? "destructive" : "write", id);
      assert.equal(request.operation.family, "run_command", id);
      assert.equal(request.operation.name, "template.execute", id);
      assert.equal(request.undo.mode, "required", id);
      assert.equal(request.undo.label, `OpenReaper: ${descriptor.bridge.capability}`, id);
      assert.deepEqual(request.undo.flags, expectedUndoFlags(descriptor), id);
      assert.equal(request.verification.mode, "required", id);
      assert.deepEqual(request.refs, Object.values(refs).flat(), id);
      assert.equal("idempotency_key" in request, false, id);

      const result = await executeTemplate({
        descriptor,
        input,
        refs,
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
    case "template.items.delete_item":
    case "template.items.delete_items":
      return { require_selected: false };
    case "template.items.set_item_volume":
      return { volume_db: -3 };
    case "template.items.set_item_take_controls_batch":
      return { batch: [{ id: "row-1", item_ref: "item:guid:{ITEM-WRITE}", item_volume_db: -3 }] };
    case "template.items.set_exact_selection":
      return { mode: "replace", item_refs: ["item:guid:{ITEM-WRITE}"] };
    case "template.items.set_take_volume":
      return { volume_db: -3 };
    case "template.items.set_take_pan":
      return { pan: -0.25 };
    case "template.items.rename_take":
      return { name: "Lead vocal comp" };
    case "template.items.set_loop_source":
      return { loop_source: true };
    case "template.items.set_mute":
      return { muted: true };
    case "template.items.set_lock":
      return { locked: true };
    case "template.items.set_no_autofades":
      return { no_autofades: true };
    case "template.items.set_play_all_takes":
      return { play_all_takes: true };
    case "template.items.set_take_start_in_source":
      return { start_offset_seconds: 0.2 };
    case "template.items.set_channel_mode":
      return { channel_mode: "mono_left" };
    case "template.items.set_invert_phase":
      return { invert_phase: true };
    case "template.items.set_reverse":
      return { reverse: true };
    case "template.items.set_pitch_shift_mode":
      return { mode: "elastique_pro" };
    case "template.items.set_stretch_marker_fade_size":
      return { fade_size_ms: 2.5 };
    case "template.items.choose_new_source_file":
      return { preserve_timing: true };
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

function outputRefsFor(id, refs) {
  if (id === "template.items.set_item_take_controls_batch" || id === "template.items.set_exact_selection") return [];
  if (id === "template.items.split_item_at_time") return [refs.left, refs.right];
  if (id === "template.items.choose_new_source_file") return [refs.item, refs.file];
  if (id === "template.items.set_active_take") return [refs.item, refs.take];
  return [refs.item];
}

function itemRef(value) {
  return createObjectRef("item", { scheme: "guid", value });
}

function trackRef(value) {
  return createObjectRef("track", { scheme: "guid", value });
}

function takeRef(value) {
  return createObjectRef("take", { scheme: "guid", value });
}

function fileRef(value) {
  return createObjectRef("file", { scheme: "path", value });
}

function fakeSummaryExecutor(summary) {
  const bridge = new FakeFoundationBridge();
  const executor = (request) =>
    bridge.okEnvelope(request, "2026-07-02T00:00:00.000Z", {
      summary,
      refs: [],
      artifacts: [],
      jobs: [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    });
  return executor;
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
