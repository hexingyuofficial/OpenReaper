import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
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
  WAVE2A_FX_TEMPLATE_IDS,
  createWave2AFxTemplates,
} from "../../packages/core/src/template-packs/wave2a-fx-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.fx.resolve_fx_ref",
  "template.fx.list_track_fx_chain",
  "template.fx.list_take_fx_chain",
  "template.fx.read_fx_summary",
  "template.fx.list_fx_parameters",
  "template.fx.read_fx_parameter",
  "template.fx.add_track_fx",
  "template.fx.add_take_fx",
  "template.fx.set_fx_bypass",
  "template.fx.set_fx_parameter_normalized",
  "template.fx.set_parameter_assignments_batch",
  "template.fx.set_fx_preset_by_name",
  "template.fx.set_fx_preset_by_index",
  "template.fx.reorder_fx",
  "template.fx.read_video_processor_code",
  "template.fx.parameter_to_envelope_mapping",
]);

const BLOCKED = Object.freeze([
  "template.fx.delete_fx",
  "template.fx.copy_fx_to_track",
  "template.fx.set_fx_offline",
  "template.fx.set_video_processor_code",
  "template.fx.save_fx_chain_resource",
  "template.fx.apply_sws_fx_chain_slot",
  "template.fx.build_basic_mix_chain",
  "template.fx.set_fx_pin_mapping",
  "template.fx.write_fx_parameter_envelope",
  "template.fx.set_fx_parameter_learn",
  "template.fx.open_fx_window",
]);

describe("Wave 2A fx template descriptors", () => {
  it("implements exactly the fx Wave 2A broad descriptor allowlist", () => {
    const templates = createWave2AFxTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(ids, ALLOWLIST);
    assert.deepEqual(WAVE2A_FX_TEMPLATE_IDS, ALLOWLIST);
    for (const id of BLOCKED) assert.equal(ids.includes(id), false, id);
  });

  it("validates every descriptor through the frozen 4A ABI", () => {
    for (const descriptor of createWave2AFxTemplates()) {
      const result = validateTemplateDescriptor(descriptor);

      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "fx", descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], "fx");
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.tags.includes("wave2a"), true, descriptor.id);
      assert.notEqual(descriptor.risk, "destructive", descriptor.id);
    }
  });

  it("keeps ownership and risk boundaries narrow", () => {
    const templates = createWave2AFxTemplates();
    const byId = new Map(templates.map((descriptor) => [descriptor.id, descriptor]));
    const readIds = ALLOWLIST.slice(0, 6).concat([
      "template.fx.read_video_processor_code",
      "template.fx.parameter_to_envelope_mapping",
    ]);

    for (const id of readIds) {
      const descriptor = byId.get(id);
      assert.equal(descriptor.risk, "read", id);
      assert.equal(descriptor.bridge.operation_family, "query_state", id);
      assert.equal(descriptor.bridge.idempotency, "none", id);
      assert.notEqual(descriptor.expectedDelta.kind, "mutation", id);
      assert.equal(descriptor.verification.mode, "none", id);
    }

    for (const descriptor of templates.filter((entry) => entry.risk === "write")) {
      assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
      assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
      assert.equal(descriptor.bridge.idempotency, "supported", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
      assert.equal(descriptor.verification.mode, "required", descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
    }

    assert.equal(byId.get("template.fx.read_video_processor_code").artifacts.mode, "produces");
    assert.equal(byId.get("template.fx.read_video_processor_code").artifacts.output[0].owner_pack, "fx");
    assert.equal(byId.get("template.fx.read_video_processor_code").risk, "read");
    assert.equal(byId.get("template.fx.read_video_processor_code").expectedDelta.kind, "artifact");
    assert.equal(byId.get("template.fx.set_fx_parameter_normalized").refs.input[0].kind, "fx");
    assert.deepEqual(
      byId.get("template.fx.parameter_to_envelope_mapping").refs.output.map((entry) => entry.kind),
      ["fx", "envelope"],
    );
    assert.equal(JSON.stringify(templates).includes('"kind":"send"'), false);
    assert.equal(JSON.stringify(templates).includes('"kind":"device"'), false);
  });

  it("publishes pageable parameter reads with stable identity and native formatting", () => {
    const byId = new Map(createWave2AFxTemplates().map((descriptor) => [descriptor.id, descriptor]));
    const list = byId.get("template.fx.list_fx_parameters");
    const read = byId.get("template.fx.read_fx_parameter");
    const set = byId.get("template.fx.set_fx_parameter_normalized");

    assert.deepEqual(list.inputSchema.properties.offset, { type: "integer" });
    assert.deepEqual(list.outputSchema.properties.returned_count, { type: "integer" });
    assert.deepEqual(list.outputSchema.properties.offset, { type: "integer" });
    assert.deepEqual(list.outputSchema.properties.next_offset, {
      oneOf: [{ type: "integer" }, { type: "null" }],
    });
    assert.deepEqual(list.outputSchema.properties.inventory_complete, { type: "boolean" });
    assert.deepEqual(list.outputSchema.properties.coverage_status, { enum: ["complete", "paged"] });
    assert.deepEqual(read.inputSchema.properties.probe_normalized_value, {
      type: "number",
      minimum: 0,
      maximum: 1,
    });

    for (const descriptor of [read, set]) {
      assert.deepEqual(descriptor.inputSchema.properties.param_ident, { type: "string" });
      assert.deepEqual(descriptor.outputSchema.properties.param_ident, { type: "string" });
      assert.deepEqual(descriptor.outputSchema.properties.formatted_value, { type: "string" });
      assert.deepEqual(descriptor.outputSchema.properties.step_sizes_available, { type: "boolean" });
      assert.deepEqual(descriptor.outputSchema.properties.step_size, {
        oneOf: [{ type: "number" }, { type: "null" }],
      });
      assert.deepEqual(descriptor.outputSchema.properties.is_toggle, {
        oneOf: [{ type: "boolean" }, { type: "null" }],
      });
      assert.deepEqual(descriptor.outputSchema.properties.is_discrete, {
        oneOf: [{ type: "boolean" }, { type: "null" }],
      });
    }
    assert.deepEqual(set.outputSchema.properties.verification_mode, {
      enum: ["numeric_tolerance", "native_discrete_format"],
    });

    const fx = fxRef("track", 0);
    const listRequest = buildTemplateBridgeRequest({
      descriptor: list,
      input: { limit: 64, offset: 128 },
      refs: { fx_ref: fx },
      context: context({ request_sequence: 60 }),
    });
    const readRequest = buildTemplateBridgeRequest({
      descriptor: read,
      input: {
        param_index: 8,
        param_ident: "band1_shape",
        probe_normalized_value: 0.125,
      },
      refs: { fx_ref: fx },
      context: context({ request_sequence: 61 }),
    });

    assert.deepEqual(listRequest.params, { limit: 64, offset: 128 });
    assert.deepEqual(readRequest.params, {
      param_index: 8,
      param_ident: "band1_shape",
      probe_normalized_value: 0.125,
    });
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery compact", () => {
    const templates = createWave2AFxTemplates();
    const catalog = createTemplateCatalog({ templates });
    const sharedWave2aIds = new Set(TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS);

    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);
    for (const id of ALLOWLIST) {
      assert.equal(sharedWave2aIds.has(id), true, id);
    }
    assert.deepEqual(
      createTemplateCatalogWave2aTemplates()
        .filter((descriptor) => descriptor.pack === "fx")
        .map((descriptor) => descriptor.id),
      ALLOWLIST,
    );
    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.fx\.resolve_fx_ref/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "fx" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [
        "id",
        "title",
        "summary",
        "pack",
        "lifecycle",
        "risk",
        "entity_kind",
        "tags",
      ]);
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("supports exact id lookup with on-demand descriptor fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AFxTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.fx.set_fx_bypass", "template.fx.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.fx.missing"]);
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

  it("builds legal 4B bridge requests for every descriptor", () => {
    for (const [index, scenario] of executionScenarios().entries()) {
      const descriptor = createWave2AFxTemplates().find((entry) => entry.id === scenario.id);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: scenario.input,
        refs: scenario.refs,
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.pack.id, "fx", scenario.id);
      assert.equal(request.pack.risk, descriptor.risk, scenario.id);
      assert.equal(request.operation.family, descriptor.bridge.operation_family, scenario.id);
      assert.equal(request.undo.mode, descriptor.risk === "read" ? "none" : "required", scenario.id);
      assert.equal("idempotency_key" in request, false, scenario.id);
      assert.deepEqual(request.refs.map((ref) => ref.kind), Object.values(scenario.refs).flat().map((ref) => ref.kind));
    }
  });

  it("runs fake execution smoke for every fx descriptor", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AFxTemplates() });

    for (const [sequence, scenario] of executionScenarios().entries()) {
      const descriptor = catalog.require(scenario.id);
      const bridge = fakeBridgeWithResult({
        refs: scenario.emittedRefs,
        artifacts: scenario.artifacts,
      });
      const result = await executeTemplate({
        descriptor,
        input: scenario.input,
        refs: scenario.refs,
        context: context({ request_sequence: sequence + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, scenario.id);
      assert.equal(result.template.id, scenario.id);
      assert.equal(result.template.pack, "fx", scenario.id);
      assert.equal(result.template.risk, descriptor.risk, scenario.id);
      assert.equal(result.undo.mode, descriptor.risk === "read" ? "none" : "required", scenario.id);
      assert.equal(result.verification.status, "passed", scenario.id);
      assert.deepEqual(result.result.refs, scenario.emittedRefs, scenario.id);
      assert.deepEqual(result.result.artifacts, scenario.artifacts, scenario.id);
      assert.equal(result.result.jobs.length, 0, scenario.id);
      assert.equal(result.result.last_result.updated, descriptor.risk !== "read", scenario.id);
      assert.equal(bridge.seen.length, 1, scenario.id);
      assert.doesNotMatch(JSON.stringify(result), /VIDEO_CODE|plugin_chunk|envelope_points|pin_mapping/);
    }
  });

  it("rejects invalid inputs and missing refs before fake bridge dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AFxTemplates() });
    const invalidBridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor: catalog.require("template.fx.set_fx_parameter_normalized"),
      input: { param_index: 0, normalized_value: 0.5, envelope: true },
      refs: { fx_ref: fxRef("track", 0) },
      context: context({ request_sequence: 40 }),
      executor: invalidBridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidInput.error.details.errors.join("\n"), /input\.envelope is not declared/);
    assert.equal(invalidBridge.seen.length, 0);

    const missingRefBridge = new FakeFoundationBridge();
    const missingRef = await executeTemplate({
      descriptor: catalog.require("template.fx.set_fx_bypass"),
      input: { enabled: false },
      context: context({ request_sequence: 41 }),
      executor: missingRefBridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(missingRef.error.details.errors.join("\n"), /required fx ref/);
    assert.equal(missingRefBridge.seen.length, 0);
  });

  it("keeps blocked fx candidates and runtime surfaces out of the pack file", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-fx-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const id of BLOCKED) assert.doesNotMatch(source, new RegExp(escapeRegExp(id)));
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /run_action|ACTION_NOT_ALLOWED|command_id/);
    assert.doesNotMatch(source, /set_video_processor_code|delete_fx|set_fx_pin_mapping|write_fx_parameter_envelope/);
  });
});

function executionScenarios() {
  const track = trackRef("{TRACK-FX}");
  const take = takeRef("{TAKE-FX}");
  const fx = fxRef("track", 0);
  const takeFx = fxRef("take", 0);
  const movedFx = fxRef("track", 1);
  const videoArtifact = createArtifactRef({
    owner_pack: "fx",
    scope: "video_processor_code",
    id: "art_20260702000000000_001_000000",
    schema: "fx.video_processor_code.v1",
    summary: { template_id: "template.fx.read_video_processor_code" },
  });

  return [
    {
      id: "template.fx.resolve_fx_ref",
      input: { owner_kind: "track", slot_index: 0 },
      refs: { track_ref: track },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.list_track_fx_chain",
      input: {},
      refs: { track_ref: track },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.list_take_fx_chain",
      input: {},
      refs: { take_ref: take },
      emittedRefs: [takeFx],
      artifacts: [],
    },
    {
      id: "template.fx.read_fx_summary",
      input: {},
      refs: { fx_ref: fx },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.list_fx_parameters",
      input: { limit: 16 },
      refs: { fx_ref: fx },
      emittedRefs: [],
      artifacts: [],
    },
    {
      id: "template.fx.read_fx_parameter",
      input: { param_index: 0 },
      refs: { fx_ref: fx },
      emittedRefs: [],
      artifacts: [],
    },
    {
      id: "template.fx.add_track_fx",
      input: { plugin_name: "ReaEQ (Cockos)" },
      refs: { track_ref: track },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.add_take_fx",
      input: { plugin_name: "ReaEQ (Cockos)" },
      refs: { take_ref: take },
      emittedRefs: [takeFx],
      artifacts: [],
    },
    {
      id: "template.fx.set_fx_bypass",
      input: { enabled: false },
      refs: { fx_ref: fx },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.set_fx_parameter_normalized",
      input: { param_index: 0, normalized_value: 0.5, tolerance: 0.0001 },
      refs: { fx_ref: fx },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.set_fx_preset_by_name",
      input: { preset_name: "stock - Basic 11 band" },
      refs: { fx_ref: fx },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.set_fx_preset_by_index",
      input: { preset_index: 0 },
      refs: { fx_ref: fx },
      emittedRefs: [fx],
      artifacts: [],
    },
    {
      id: "template.fx.reorder_fx",
      input: { target_index: 1 },
      refs: { fx_ref: fx },
      emittedRefs: [movedFx],
      artifacts: [],
    },
    {
      id: "template.fx.read_video_processor_code",
      input: {},
      refs: { fx_ref: fxRef("track", 2) },
      emittedRefs: [],
      artifacts: [videoArtifact],
    },
    {
      id: "template.fx.parameter_to_envelope_mapping",
      input: { param_index: 0 },
      refs: { fx_ref: fxRef("track", 3) },
      emittedRefs: [fxRef("track", 3), createObjectRef("envelope", { scheme: "guid", value: "{FX-ENV-0}" })],
      artifacts: [],
    },
  ];
}

function fakeBridgeWithResult({ refs, artifacts }) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithResult(request, startedAt) {
    const mutates = ["run_command", "run_action", "run_job"].includes(request.operation.family);
    const lastResult = mutates
      ? {
          updated: true,
          refs: [...refs, ...artifacts],
          truncated: false,
        }
      : {
          updated: false,
          refs: [],
          truncated: false,
        };

    return this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      artifacts,
      jobs: [],
      last_result: lastResult,
    });
  };
  return bridge;
}

function trackRef(guid) {
  return createObjectRef("track", { scheme: "guid", value: guid });
}

function takeRef(guid) {
  return createObjectRef("take", { scheme: "guid", value: guid });
}

function fxRef(ownerKind, slot) {
  const ownerRef = ownerKind === "take" ? "take:guid:{TAKE-FX}" : "track:guid:{TRACK-FX}";
  return createObjectRef("fx", {
    scheme: `${ownerKind}_fx`,
    value: `${ownerRef}:${slot}`,
  }, {
    ref: `fx:${ownerRef}:${slot}`,
  });
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
