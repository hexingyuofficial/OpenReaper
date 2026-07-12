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
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  createTemplateCatalogWave2aTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE2A_MIDI_TEMPLATE_IDS,
  createWave2AMidiTemplates,
} from "../../packages/core/src/template-packs/wave2a-midi-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.midi.resolve_midi_take_ref",
  "template.midi.create_midi_item",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
  "template.midi.insert_notes_batch",
  "template.midi.list_take_cc_events",
  "template.midi.insert_cc_batch",
  "template.midi.list_take_text_sysex_events",
  "template.midi.read_take_grid",
  "template.midi.insert_text_sysex_events",
  "template.midi.set_notes_batch",
  "template.midi.quantize_notes",
  "template.midi.quantize_selected_notes",
  "template.midi.set_cc_events_batch",
]);

const BLOCKED_MIDI_IDS = Object.freeze([
  "template.midi.read_active_editor_context",
  "template.midi.export_take_events_artifact",
  "template.midi.set_track_note_names",
  "template.midi.transpose_notes",
  "template.midi.quantize_notes_to_grid",
  "template.midi.set_midi_selection",
  "template.midi.delete_notes_batch",
  "template.midi.delete_cc_events_batch",
  "template.midi.delete_text_sysex_events_batch",
  "template.midi.replace_take_events_raw",
  "template.midi.humanize_notes",
  "template.midi.write_drum_pattern",
  "template.midi.compose_music_sketch",
  "template.midi.set_tempo",
  "template.midi.move_midi_item",
  "template.midi.midi_learn",
  "template.midi.send_hardware_midi",
]);

const READ_IDS = new Set([
  "template.midi.resolve_midi_take_ref",
  "template.midi.read_take_event_counts",
  "template.midi.list_take_notes",
  "template.midi.list_take_cc_events",
  "template.midi.list_take_text_sysex_events",
  "template.midi.read_take_grid",
]);

describe("Wave 2A midi template descriptors", () => {
  it("exports exactly the Wave 2A midi allowlist", () => {
    const templates = createWave2AMidiTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE2A_MIDI_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_MIDI_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation with midi ownership and Wave 2A risk posture", () => {
    for (const descriptor of createWave2AMidiTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "midi", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.midi."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.notEqual(descriptor.risk, "destructive", descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );

      const refKinds = [
        ...descriptor.refs.input.map((entry) => entry.kind),
        ...descriptor.refs.output.map((entry) => entry.kind),
      ];
      for (const kind of refKinds) {
        assert.equal(["track", "item", "take"].includes(kind), true, `${descriptor.id}:${kind}`);
      }

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

  it("keeps Wave 2A midi ownership away from items, project, hardware, and destructive edits", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMidiTemplates() });
    const createItem = catalog.require("template.midi.create_midi_item");
    const setNotes = catalog.require("template.midi.set_notes_batch");
    const quantizeNotes = catalog.require("template.midi.quantize_notes");
    const quantizeSelectedNotes = catalog.require("template.midi.quantize_selected_notes");
    const setCc = catalog.require("template.midi.set_cc_events_batch");
    const insertNotes = catalog.require("template.midi.insert_notes_batch");
    const grid = catalog.require("template.midi.read_take_grid");

    assert.deepEqual(createItem.refs.input.map((entry) => entry.kind), ["track"]);
    assert.deepEqual(createItem.refs.output.map((entry) => entry.kind), ["item", "take"]);
    assert.deepEqual(Object.keys(createItem.inputSchema.properties), ["start_seconds", "end_seconds"]);
    assert.equal(createItem.summary.includes("empty MIDI item"), true);

    assert.deepEqual(setNotes.inputSchema.required, ["notes", "expected_take_hash"]);
    assert.deepEqual(quantizeNotes.inputSchema.required, [
      "grid_unit",
      "strength",
      "preserve_duration",
      "expected_take_hash",
    ]);
    assert.deepEqual(quantizeSelectedNotes.inputSchema.required, [
      "grid_unit",
      "strength",
      "preserve_duration",
      "expected_take_hash",
      "require_selected_notes",
    ]);
    assert.equal(quantizeNotes.inputSchema.properties.grid_unit.enum.includes("take_grid"), true);
    assert.equal(quantizeSelectedNotes.inputSchema.properties.grid_unit.enum.includes("ppq"), true);
    assert.equal(quantizeSelectedNotes.summary.includes("selected MIDI note"), true);
    assert.deepEqual(setCc.inputSchema.required, ["events", "expected_take_hash"]);
    assert.deepEqual(insertNotes.inputSchema.properties.position_unit.enum, ["ppq"]);
    assert.match(insertNotes.summary, /PPQ-positioned/);
    assert.equal(grid.risk, "read");
    assert.equal(grid.summary.includes("project grid"), false);

    for (const descriptor of catalog.list()) {
      assert.doesNotMatch(descriptor.summary, /move|trim|tempo|learn|hardware|delete|replace/i, descriptor.id);
      assert.equal(descriptor.pack, "midi", descriptor.id);
    }
  });

  it("loads pack-local and shared Wave 2A catalogs while keeping default discovery compact", () => {
    const templates = createWave2AMidiTemplates();
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
        /Duplicate template id: template\.midi\.resolve_midi_take_ref/.test(error.errors.join("\n")),
    );

    const sharedWave2A = createTemplateCatalog({ templates: createTemplateCatalogWave2aTemplates() });
    for (const id of ALLOWLIST) {
      assert.equal(TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS.includes(id), true, id);
      assert.equal(sharedWave2A.require(id).pack, "midi", id);
    }

    const response = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog).list_templates({ pack: "midi" });
    assert.equal(response.contract, "discovery.menu.v1");
    assert.equal(response.kind, "template_menu");
    assert.equal(response.mode, "menu");
    assert.equal(response.items.length, ALLOWLIST.length);
    assert.equal(response.page.has_more, false);
    assert.equal(response.page.limit, 25);
    assert.equal("total" in response.page, false);

    const payload = JSON.stringify(response);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(`"${field}"`));
    }
    for (const item of response.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(
        Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
        true,
        item.id,
      );
    }
  });

  it("supports exact id lookup with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMidiTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.midi.insert_notes_batch", "template.midi.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.midi.missing"]);
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

  it("runs fake harness read smoke for every read midi atom", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMidiTemplates() });
    const take = takeRef("{TAKE-READ}");
    const item = itemRef("{ITEM-READ}");

    for (const [index, id] of [...READ_IDS].entries()) {
      const descriptor = catalog.require(id);
      const outputRefs = id === "template.midi.resolve_midi_take_ref" ? [take, item] : [take];
      const executor = fakeRefsExecutor(outputRefs);
      const refs = id === "template.midi.resolve_midi_take_ref" ? {} : { take_ref: take };
      const result = await executeTemplate({
        descriptor,
        input: sampleInput(id),
        refs,
        context: context({ request_sequence: index + 1 }),
        executor,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.template.risk, "read", id);
      assert.equal(result.undo.mode, "none", id);
      assert.deepEqual(result.result.refs, outputRefs, id);
      assert.equal(result.result.last_result.updated, false, id);
      assert.equal(executor.requests[0].operation.family, "query_state", id);
    }
  });

  it("builds legal 4B bridge requests and fake-smokes every write midi atom", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMidiTemplates() });
    const track = trackRef("{TRACK-MIDI}");
    const take = takeRef("{TAKE-WRITE}");
    const item = itemRef("{ITEM-MIDI}");

    for (const [index, id] of ALLOWLIST.filter((entry) => !READ_IDS.has(entry)).entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const refs = id === "template.midi.create_midi_item" ? { track_ref: track } : { take_ref: take };
      const outputRefs = id === "template.midi.create_midi_item" ? [item, take] : [take];
      const executor = fakeRefsExecutor(outputRefs);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input,
        refs,
        context: context({ request_sequence: index + 10 }),
      });

      assert.equal(request.pack.id, "midi", id);
      assert.equal(request.pack.risk, "write", id);
      assert.equal(request.operation.family, "run_command", id);
      assert.equal(request.operation.name, "template.execute", id);
      assert.equal(request.undo.mode, "required", id);
      assert.equal(request.undo.label, `OpenReaper: ${descriptor.bridge.capability}`, id);
      assert.deepEqual(request.undo.flags, expectedUndoFlags(descriptor), id);
      assert.equal(request.verification.mode, "required", id);
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
      assert.equal(result.undo.closed, true, id);
      assert.equal(result.verification.status, "passed", id);
      assert.equal(result.result.last_result.updated, true, id);
      assert.deepEqual(result.result.refs, outputRefs, id);
    }
  });

  it("honors supported idempotency and rejects invalid inputs or missing refs before dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AMidiTemplates() });
    const take = takeRef("{TAKE-IDEMPOTENT}");
    const insertNotes = catalog.require("template.midi.insert_notes_batch");
    const idempotentRequest = buildTemplateBridgeRequest({
      descriptor: insertNotes,
      input: sampleInput("template.midi.insert_notes_batch"),
      refs: { take_ref: take },
      context: context({ request_sequence: 40 }),
      idempotencyKey: "midi-insert-key",
    });
    assert.equal(idempotentRequest.idempotency_key, "midi-insert-key");

    const bridge = new FakeFoundationBridge();
    const badUnit = await executeTemplate({
      descriptor: insertNotes,
      input: {
        position_unit: "beats",
        notes: [],
      },
      refs: { take_ref: take },
      context: context({ request_sequence: 41 }),
      executor: bridge,
    });
    assert.equal(badUnit.ok, false);
    assert.equal(badUnit.error.source, "harness");
    assert.equal(badUnit.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(badUnit.error.details.errors.join("\n"), /input.position_unit must be one of its enum values/);
    assert.equal(bridge.seen.length, 0);

    const secondsMode = await executeTemplate({
      descriptor: insertNotes,
      input: {
        position_unit: "seconds",
        notes: [{ start_seconds: 0, end_seconds: 0.25, pitch: 60, velocity: 96, channel: 0 }],
      },
      refs: { take_ref: take },
      context: context({ request_sequence: 42 }),
      executor: bridge,
    });
    assert.equal(secondsMode.ok, false);
    assert.equal(secondsMode.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const missingGuard = await executeTemplate({
      descriptor: catalog.require("template.midi.set_notes_batch"),
      input: { notes: [] },
      refs: { take_ref: take },
      context: context({ request_sequence: 43 }),
      executor: bridge,
    });
    assert.equal(missingGuard.ok, false);
    assert.equal(missingGuard.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(missingGuard.error.details.errors.join("\n"), /input.expected_take_hash is required/);
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor: catalog.require("template.midi.list_take_notes"),
      input: sampleInput("template.midi.list_take_notes"),
      refs: {},
      context: context({ request_sequence: 43 }),
      executor: bridge,
    });
    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps implementation descriptor-only and away from runtime, recipes, destructive ids, and hardware", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-midi-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /hardware|midi_learn|send_hardware|set_tempo|move_midi_item/i);
    assert.doesNotMatch(source, /delete_notes|delete_cc|delete_text|replace_take_events_raw|raw_replace/i);
    assert.doesNotMatch(source, /MIDI_Delete|MIDI_SetAllEvts/);
    for (const blockedId of BLOCKED_MIDI_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)));
    }
  });
});

function sampleInput(id) {
  switch (id) {
    case "template.midi.resolve_midi_take_ref":
      return { ref: "selected:0" };
    case "template.midi.create_midi_item":
      return { start_seconds: 0, end_seconds: 2 };
    case "template.midi.list_take_notes":
      return { limit: 16, include_project_time: true };
    case "template.midi.insert_notes_batch":
      return {
        position_unit: "ppq",
        notes: [{ start_ppq: 0, end_ppq: 480, pitch: 60, velocity: 96, channel: 0 }],
      };
    case "template.midi.list_take_cc_events":
      return { controller: 1, limit: 16 };
    case "template.midi.insert_cc_batch":
      return {
        position_unit: "ppq",
        events: [{ ppq: 0, channel: 0, controller: 1, value: 64 }],
      };
    case "template.midi.list_take_text_sysex_events":
      return { event_kind: "any", limit: 16 };
    case "template.midi.insert_text_sysex_events":
      return {
        position_unit: "ppq",
        events: [{ ppq: 0, event_kind: "lyric", text: "verse" }],
      };
    case "template.midi.set_notes_batch":
      return { expected_take_hash: "hash_before_edit", notes: [{ index: 0, velocity: 100 }] };
    case "template.midi.quantize_notes":
      return {
        grid_unit: "take_grid",
        strength: 1,
        preserve_duration: true,
        expected_take_hash: "hash_before_edit",
      };
    case "template.midi.quantize_selected_notes":
      return {
        grid_unit: "ppq",
        grid_ppq: 480,
        strength: 1,
        preserve_duration: true,
        require_selected_notes: true,
        expected_take_hash: "hash_before_edit",
      };
    case "template.midi.set_cc_events_batch":
      return { expected_take_hash: "hash_before_edit", events: [{ index: 0, value: 96 }] };
    default:
      return {};
  }
}

function trackRef(value) {
  return createObjectRef("track", { scheme: "guid", value });
}

function itemRef(value) {
  return createObjectRef("item", { scheme: "guid", value });
}

function takeRef(value) {
  return createObjectRef("take", { scheme: "guid", value });
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
