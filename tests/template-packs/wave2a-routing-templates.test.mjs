import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
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
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE2A_ROUTING_TEMPLATE_IDS,
  createWave2ARoutingTemplates,
} from "../../packages/core/src/template-packs/wave2a-routing-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const APPROVED_ROUTING_IDS = Object.freeze([
  "template.routing.read_track_routing",
  "template.routing.resolve_send_ref",
  "template.routing.create_track_send",
  "template.routing.set_send_volume",
  "template.routing.set_send_pan",
  "template.routing.set_send_mute",
  "template.routing.set_send_mode",
  "template.routing.set_master_parent_send",
  "template.routing.set_track_channel_count",
  "template.routing.list_track_hardware_outputs",
  "template.routing.set_track_hardware_output",
  "template.routing.remove_track_hardware_output",
  "template.routing.track_mono_or_stereo_button",
  "template.routing.read_project_routing_graph",
  "template.routing.list_available_audio_outputs",
  "template.routing.set_send_audio_channels",
  "template.routing.set_send_phase",
  "template.routing.set_send_mono",
  "template.routing.set_send_midi_channels",
  "template.routing.read_fx_pin_mapping",
]);

const BLOCKED_ROUTING_IDS = Object.freeze([
  "template.routing.create_hardware_audio_output",
  "template.routing.set_hardware_audio_output_channels",
  "template.routing.set_fx_pin_mapping",
  "template.routing.remove_send",
  "template.routing.set_send_group_membership",
  "template.routing.create_sidechain_send",
  "template.routing.build_headphone_mix",
  "template.routing.create_bus_send_setup",
  "template.routing.set_midi_hardware_output",
  "template.hardware.list_audio_outputs",
  "template.routing.set_track_mute",
  "template.routing.set_fx_parameter_for_sidechain",
]);

describe("Wave 2A routing template descriptors", () => {
  it("exports exactly the approved Wave 2A routing allowlist", () => {
    const ids = createWave2ARoutingTemplates().map((descriptor) => descriptor.id);

    assert.deepEqual(ids, APPROVED_ROUTING_IDS);
    assert.deepEqual(WAVE2A_ROUTING_TEMPLATE_IDS, APPROVED_ROUTING_IDS);
    for (const blockedId of BLOCKED_ROUTING_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("validates every descriptor through the frozen 4A descriptor ABI", () => {
    const templates = createWave2ARoutingTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, APPROVED_ROUTING_IDS.length);
    for (const descriptor of catalog.list()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "routing", descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], "routing", descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.tags.includes("wave2a"), true, descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
      assert.deepEqual(descriptor.artifacts.input, [], descriptor.id);
      assert.deepEqual(descriptor.artifacts.output, [], descriptor.id);
      assert.notEqual(descriptor.risk, "destructive", descriptor.id);
      assert.notEqual(descriptor.bridge.operation_family, "run_action", descriptor.id);
    }
  });

  it("keeps routing ownership boundaries and Wave 2A risk posture narrow", () => {
    const templates = createWave2ARoutingTemplates();
    const byId = new Map(templates.map((descriptor) => [descriptor.id, descriptor]));
    const source = JSON.stringify(templates);

    assert.equal(byId.get("template.routing.read_track_routing").risk, "read");
    assert.equal(byId.get("template.routing.resolve_send_ref").risk, "read");
    assert.equal(byId.get("template.routing.read_project_routing_graph").risk, "read");
    assert.equal(byId.get("template.routing.read_fx_pin_mapping").risk, "read");
    assert.equal(byId.get("template.routing.read_fx_pin_mapping").entity_kind, "pin_mapping");
    assert.equal(byId.get("template.routing.read_fx_pin_mapping").refs.input.some((entry) => entry.kind === "fx"), true);
    assert.equal(byId.get("template.routing.list_track_hardware_outputs").risk, "read");
    assert.equal(byId.get("template.routing.list_available_audio_outputs").risk, "read");
    assert.equal(byId.get("template.routing.set_track_hardware_output").risk, "write");
    assert.equal(byId.get("template.routing.remove_track_hardware_output").risk, "write");
    assert.equal(byId.get("template.routing.track_mono_or_stereo_button").risk, "write");
    assert.equal(byId.get("template.routing.set_track_hardware_output").entity_kind, "hardware_output");
    assert.equal(byId.get("template.routing.remove_track_hardware_output").refs.input.some((entry) => entry.kind === "track"), true);
    assert.equal(JSON.stringify(templates).includes("\"kind\":\"hardware_output\""), false);

    for (const descriptor of templates) {
      if (descriptor.risk === "read") {
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
      }
    }

    assert.doesNotMatch(source, /I_MIDIHWOUT|create_hardware|set_hardware_audio_output/);
    assert.doesNotMatch(source, /remove_send|delete|destructive|run_action|run_job|artifact_metadata/);
    assert.doesNotMatch(source, /streetlight-reaper-mcp|recipe|REAPER\.app|spawn\(|execFile/);
    assert.equal(byId.get("template.routing.set_send_midi_channels").summary.includes("hardware"), false);
    assert.equal(byId.has("template.hardware.list_audio_outputs"), false);
  });

  it("loads in pack-local and shared fixture catalogs without duplicates", () => {
    const templates = createWave2ARoutingTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(catalog.ids, APPROVED_ROUTING_IDS);
    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.routing\.read_track_routing/.test(error.errors.join("\n")),
    );

    const sharedWave2aIds = new Set(TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS);
    for (const id of APPROVED_ROUTING_IDS) {
      assert.equal(sharedWave2aIds.has(id), true, id);
    }

    const sharedCatalog = createTemplateCatalog({
      templates: [
        ...createTemplateCatalogWave1aTemplates(),
        ...createTemplateCatalogWave2aTemplates(),
      ],
    });
    for (const id of APPROVED_ROUTING_IDS) {
      assert.equal(sharedCatalog.require(id).pack, "routing", id);
    }
  });

  it("exposes compact discovery summaries and exact on-demand fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2ARoutingTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "routing" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, APPROVED_ROUTING_IDS.length);
    assert.equal(menu.page.has_more, false);
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item).sort(), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS].sort());
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }

    const exact = discovery.list_templates({
      ids: ["template.routing.set_send_audio_channels", "template.routing.missing"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.routing.missing"]);
    assert.deepEqual(Object.keys(exact.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "outputSchema",
      "summary",
    ]);
    assert.equal("bridge" in exact.items[0], false);
    assert.equal("refs" in exact.items[0], false);
    assert.equal("artifacts" in exact.items[0], false);
    assert.equal("verification" in exact.items[0], false);
  });

  it("runs Layer 4B fake execution smoke for every routing descriptor", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2ARoutingTemplates() });

    for (const [sequence, scenario] of executionScenarios().entries()) {
      const descriptor = catalog.require(scenario.id);
      const bridge = fakeBridgeWithRefs(scenario.emittedRefs);
      const result = await executeTemplate({
        descriptor,
        input: scenario.input,
        refs: scenario.refs,
        context: context({ request_sequence: sequence + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, scenario.id);
      assert.equal(result.template.id, scenario.id);
      assert.equal(result.template.pack, "routing", scenario.id);
      assert.equal(result.template.risk, descriptor.risk, scenario.id);
      assert.equal(result.undo.mode, descriptor.risk === "read" ? "none" : "required", scenario.id);
      assert.equal(result.verification.status, "passed", scenario.id);
      assert.deepEqual(result.result.refs, scenario.emittedRefs, scenario.id);
      assert.equal(result.result.last_result.updated, descriptor.risk !== "read", scenario.id);
      assert.equal(bridge.seen.length, 1, scenario.id);
      assert.equal("emits" in bridge.seen[0].params, false, scenario.id);
    }
  });

  it("rejects invalid inputs and missing refs before fake bridge dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2ARoutingTemplates() });
    const invalidBridge = new FakeFoundationBridge();
    const invalid = await executeTemplate({
      descriptor: catalog.require("template.routing.set_send_volume"),
      input: {},
      refs: { send_ref: sendRef("VOL") },
      context: context({ request_sequence: 50 }),
      executor: invalidBridge,
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.source, "harness");
    assert.equal(invalid.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalid.error.details.errors.join("\n"), /input\.volume is required/);
    assert.equal(invalidBridge.seen.length, 0);

    const missingRefBridge = new FakeFoundationBridge();
    const missingRef = await executeTemplate({
      descriptor: catalog.require("template.routing.create_track_send"),
      input: { duplicate_policy: "reject_existing" },
      refs: { source_track_ref: trackRef("SRC") },
      context: context({ request_sequence: 51 }),
      executor: missingRefBridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(missingRef.error.details.errors.join("\n"), /refs\.destination_track_ref is required/);
    assert.equal(missingRefBridge.seen.length, 0);
  });

  it("keeps Wave 2A routing descriptor sources static and descriptor-only", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-routing-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy|recipes?\//i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /RemoveTrackSend|TrackFX_SetPinMappings|I_MIDIHWOUT/);
    assert.doesNotMatch(source, /create_hardware_audio_output|set_hardware_audio_output|template\.hardware\./);
  });
});

function executionScenarios() {
  const track = trackRef("ROUTING");
  const sourceTrack = trackRef("SOURCE");
  const destinationTrack = trackRef("DEST");
  const send = sendRef("SEND");
  const fx = fxRef("FX");

  return [
    {
      id: "template.routing.read_track_routing",
      input: { include_receives: true, include_master_parent: true, max_routes: 16 },
      refs: { track_ref: track },
      emittedRefs: [send],
    },
    {
      id: "template.routing.resolve_send_ref",
      input: { send_ref: "send:guid:{SEND}" },
      refs: {},
      emittedRefs: [send],
    },
    {
      id: "template.routing.create_track_send",
      input: { duplicate_policy: "reuse_existing" },
      refs: { source_track_ref: sourceTrack, destination_track_ref: destinationTrack },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_volume",
      input: { volume: 1 },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_pan",
      input: { pan: -0.25 },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_mute",
      input: { muted: true },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_mode",
      input: { mode: "pre_fx" },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_master_parent_send",
      input: { enabled: false },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.set_track_channel_count",
      input: { channel_count: 4 },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.list_track_hardware_outputs",
      input: { include_disabled: true, max_outputs: 8 },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.set_track_hardware_output",
      input: {
        output_index: 0,
        source_channel_offset: 0,
        source_channel_count: 2,
        mix_to_mono: false,
      },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.remove_track_hardware_output",
      input: { output_index: 0, missing_policy: "ok" },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.track_mono_or_stereo_button",
      input: { mode: "mono" },
      refs: { track_ref: track },
      emittedRefs: [track],
    },
    {
      id: "template.routing.read_project_routing_graph",
      input: { max_tracks: 16, max_edges: 32, include_master_parent: true },
      refs: {},
      emittedRefs: [track, send],
    },
    {
      id: "template.routing.list_available_audio_outputs",
      input: { include_unavailable: false, max_outputs: 16 },
      refs: {},
      emittedRefs: [],
    },
    {
      id: "template.routing.set_send_audio_channels",
      input: {
        source_channel_offset: 0,
        source_channel_count: 2,
        destination_channel_offset: 2,
        mix_to_mono: false,
      },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_phase",
      input: { phase_inverted: true },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_mono",
      input: { mono: true },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.set_send_midi_channels",
      input: { source_channel: "all", destination_channel: "1", source_bus: 0, destination_bus: 0 },
      refs: { send_ref: send },
      emittedRefs: [send],
    },
    {
      id: "template.routing.read_fx_pin_mapping",
      input: { direction: "output", pin_index: 0, include_high_bits: true },
      refs: { track_ref: track, fx_ref: fx },
      emittedRefs: [],
    },
  ];
}

function fakeBridgeWithRefs(refs) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithRefs(request, startedAt) {
    const mutates = ["run_command", "run_action", "run_job"].includes(request.operation.family);
    const lastResult = mutates
      ? {
          updated: true,
          refs: refs.slice(0, request.budget.max_items),
          truncated: refs.length > request.budget.max_items,
        }
      : {
          updated: false,
          refs: this.lastResult.slice(0, request.budget.max_items),
          truncated: this.lastResult.length > request.budget.max_items,
        };
    const envelope = this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      last_result: lastResult,
    });

    if (envelope.ok && mutates) this.lastResult = refs.slice(0, request.budget.max_items);
    return envelope;
  };
  return bridge;
}

function trackRef(label) {
  return createObjectRef("track", { scheme: "guid", value: `{TRACK-${label}}` });
}

function sendRef(label) {
  return createObjectRef("send", { scheme: "index", value: `track:{TRACK-${label}}:0` });
}

function fxRef(label) {
  return createObjectRef("fx", { scheme: "index", value: `track:{TRACK-${label}}:0` });
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
