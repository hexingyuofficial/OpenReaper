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
  createTemplateCatalogWave2aTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE2A_AUTOMATION_TEMPLATE_IDS,
  createWave2AAutomationTemplates,
} from "../../packages/core/src/template-packs/wave2a-automation-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.automation.resolve_envelope_ref",
  "template.automation.read_envelope_summary",
  "template.automation.read_envelope_points",
  "template.automation.evaluate_envelope_at_time",
  "template.automation.set_envelope_lane_state",
  "template.automation.insert_envelope_point",
  "template.automation.set_track_automation_mode",
  "template.automation.read_track_automation_mode",
  "template.automation.read_automation_items",
  "template.automation.set_envelope_point",
  "template.automation.insert_envelope_points_batch",
  "template.automation.set_send_automation_mode",
  "template.automation.create_automation_item",
  "template.automation.set_automation_item_bounds",
  "template.automation.resolve_send_envelope",
  "template.automation.insert_fx_parameter_envelope_points",
  "template.automation.insert_sine_wave_points",
]);

const BLOCKED = Object.freeze([
  "template.automation.resolve_fx_parameter_envelope",
  "template.automation.clear_envelope_point_range",
  "template.automation.delete_envelope_point",
  "template.automation.set_envelope_default_shape",
  "template.automation.set_automation_item_loop_state",
  "template.automation.select_envelope_point",
  "template.automation.set_envelope_group_membership",
  "template.automation.read_razor_edit_automation",
  "template.automation.draw_fade_curve",
  "template.automation.apply_sidechain_ducking",
  "template.automation.generate_lfo_envelope",
  "template.automation.set_fx_parameter_value",
  "template.automation.add_fx_to_track",
  "template.automation.render_razor_edit_area",
  "template.automation.edit_item_lanes",
]);

describe("Wave 2A automation template descriptors", () => {
  it("implements exactly the automation Wave 2A allowlist", () => {
    const templates = createWave2AAutomationTemplates();
    const ids = templates.map((descriptor) => descriptor.id);
    const sharedWave2aAutomationIds = TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS.filter((id) =>
      id.startsWith("template.automation."),
    );
    const sharedWave2aCreatedAutomationIds = createTemplateCatalogWave2aTemplates()
      .map((descriptor) => descriptor.id)
      .filter((id) => id.startsWith("template.automation."));

    assert.deepEqual(WAVE2A_AUTOMATION_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.deepEqual(sharedWave2aAutomationIds, ALLOWLIST);
    assert.deepEqual(sharedWave2aCreatedAutomationIds, ALLOWLIST);
    for (const id of BLOCKED) {
      assert.equal(ids.includes(id), false, id);
      assert.equal(TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS.includes(id), false, id);
    }
  });

  it("validates every descriptor through the frozen 4A ABI", () => {
    for (const descriptor of createWave2AAutomationTemplates()) {
      const result = validateTemplateDescriptor(descriptor);

      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "automation", descriptor.id);
      assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], "automation", descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.tags.includes("wave2a"), true, descriptor.id);
      assert.equal(descriptor.artifacts.mode, "none", descriptor.id);
      assert.deepEqual(descriptor.artifacts.input, [], descriptor.id);
      assert.deepEqual(descriptor.artifacts.output, [], descriptor.id);
      assert.notEqual(descriptor.risk, "destructive", descriptor.id);
    }
  });

  it("keeps automation ownership, risk, and operation boundaries narrow", () => {
    const templates = createWave2AAutomationTemplates();
    const byId = new Map(templates.map((descriptor) => [descriptor.id, descriptor]));
    const readIds = [
      "template.automation.resolve_envelope_ref",
      "template.automation.read_envelope_summary",
      "template.automation.read_envelope_points",
      "template.automation.evaluate_envelope_at_time",
      "template.automation.read_track_automation_mode",
      "template.automation.read_automation_items",
      "template.automation.resolve_send_envelope",
    ];
    const writeIds = ALLOWLIST.filter((id) => !readIds.includes(id));

    for (const id of readIds) {
      const descriptor = byId.get(id);
      assert.equal(descriptor.risk, "read", id);
      assert.equal(descriptor.bridge.operation_family, "query_state", id);
      assert.equal(descriptor.bridge.idempotency, "none", id);
      assert.equal(descriptor.expectedDelta.kind, "read", id);
      assert.equal(descriptor.verification.mode, "none", id);
    }

    for (const id of writeIds) {
      const descriptor = byId.get(id);
      assert.equal(descriptor.risk, "write", id);
      assert.equal(descriptor.bridge.operation_family, "run_command", id);
      assert.equal(descriptor.bridge.operation_name, "template.execute", id);
      assert.equal(descriptor.bridge.idempotency, "supported", id);
      assert.equal(descriptor.expectedDelta.kind, "mutation", id);
      assert.equal(descriptor.verification.mode, "required", id);
      assert.equal(descriptor.verification.checks.length > 0, true, id);
    }

    const source = JSON.stringify(templates);
    assert.doesNotMatch(source, /"risk":"destructive"/);
    assert.doesNotMatch(source, /"operation_family":"run_action"/);
    assert.doesNotMatch(source, /"kind":"file"/);
    assert.doesNotMatch(source, /hardware/i);
    assert.equal(byId.get("template.automation.create_automation_item").expectedDelta.entities[0].action, "create");
    assert.equal(byId.get("template.automation.set_envelope_point").expectedDelta.entities[0].action, "update");
    assert.equal(byId.get("template.automation.resolve_send_envelope").refs.input[0].kind, "send");
    assert.deepEqual(
      byId.get("template.automation.insert_fx_parameter_envelope_points").refs.input.map((entry) => entry.kind),
      ["fx", "envelope"],
    );
    assert.equal(
      byId.get("template.automation.insert_sine_wave_points").inputSchema.required.includes("point_count"),
      true,
    );
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery compact", () => {
    const templates = createWave2AAutomationTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);
    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.automation\.resolve_envelope_ref/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "automation" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal(JSON.stringify(menu).length < 12_288, true);
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(item.pack, "automation");
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("supports exact id expansion with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AAutomationTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.automation.insert_envelope_point", "template.automation.missing"],
      fields: ["summary", "inputSchema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.automation.missing"]);
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

  it("runs 4B fake execution smoke for every automation descriptor", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AAutomationTemplates() });

    for (const [index, id] of ALLOWLIST.entries()) {
      const descriptor = catalog.require(id);
      const emittedRefs = outputRefsForDescriptor(descriptor, index);
      const bridge = fakeBridgeWithRefs(emittedRefs);
      const result = await executeTemplate({
        descriptor,
        input: sampleInput(id),
        refs: sampleInputRefs(descriptor, index),
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.template.pack, "automation", id);
      assert.equal(result.template.risk, descriptor.risk, id);
      assert.equal(result.undo.mode, descriptor.risk === "read" ? "none" : "required", id);
      assert.equal(result.verification.status, "passed", id);
      assert.deepEqual(result.result.refs, emittedRefs, id);
      assert.equal(result.result.last_result.updated, descriptor.risk !== "read", id);
      assert.equal(bridge.seen.length, 1, id);
      assert.doesNotMatch(JSON.stringify(result), /payload|dense_lane|source_code|hardware/);
    }
  });

  it("rejects invalid inputs and missing refs before fake dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AAutomationTemplates() });
    const bridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor: catalog.require("template.automation.set_track_automation_mode"),
      input: { mode: "record" },
      refs: { track_ref: objectRef("track", 1) },
      context: context({ request_sequence: 40 }),
      executor: bridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor: catalog.require("template.automation.insert_envelope_point"),
      input: sampleInput("template.automation.insert_envelope_point"),
      refs: {},
      context: context({ request_sequence: 41 }),
      executor: bridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.match(missingRef.error.details.errors.join("\n"), /refs\.envelope_ref is required/);
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps blocked candidates, runtime surfaces, and old repo references out of descriptors", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-automation-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const id of BLOCKED) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(id)), id);
    }
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\blive smoke\b/i);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /resolve_fx_parameter_envelope|delete_envelope_point|clear_envelope_point_range/);
  });
});

function sampleInput(id) {
  switch (id) {
    case "template.automation.resolve_envelope_ref":
      return { parent_kind: "track", envelope_name: "Volume" };
    case "template.automation.read_envelope_points":
      return { limit: 25 };
    case "template.automation.evaluate_envelope_at_time":
      return { time_seconds: 1 };
    case "template.automation.set_envelope_lane_state":
      return { visible: true, show_lane: true, armed: true };
    case "template.automation.insert_envelope_point":
      return { time_seconds: 1, value: 0.75, shape: 0, tension: 0, selected: false };
    case "template.automation.set_track_automation_mode":
      return { mode: "read" };
    case "template.automation.read_automation_items":
      return { limit: 25 };
    case "template.automation.set_envelope_point":
      return { point_index: 0, value: 0.5 };
    case "template.automation.insert_envelope_points_batch":
      return {
        points: [
          { time_seconds: 0, value: 0.25, shape: 0, tension: 0 },
          { time_seconds: 1, value: 1, shape: 0, tension: 0 },
        ],
      };
    case "template.automation.insert_fx_parameter_envelope_points":
      return {
        param_index: 0,
        points: [
          { time_seconds: 0, value: 0.2, shape: 0, tension: 0 },
          { time_seconds: 2, value: 0.8, shape: 0, tension: 0 },
        ],
      };
    case "template.automation.insert_sine_wave_points":
      return {
        start_seconds: 0,
        end_seconds: 2,
        center_value: 0.5,
        amplitude: 0.25,
        cycles: 1,
        point_count: 33,
        shape: 0,
        tension: 0,
      };
    case "template.automation.set_send_automation_mode":
      return { mode: "use_track" };
    case "template.automation.create_automation_item":
      return { position_seconds: 2, length_seconds: 1, pool_mode: "new_empty" };
    case "template.automation.set_automation_item_bounds":
      return { automation_item_index: 0, position_seconds: 4, length_seconds: 2 };
    case "template.automation.resolve_send_envelope":
      return { envelope_type: "volume" };
    default:
      return {};
  }
}

function sampleInputRefs(descriptor, index) {
  return Object.fromEntries(
    descriptor.refs.input
      .filter((refDeclaration) => refDeclaration.required)
      .map((refDeclaration, refIndex) => [
        refDeclaration.name,
        objectRef(refDeclaration.kind, index, refIndex),
      ]),
  );
}

function outputRefsForDescriptor(descriptor, index) {
  return descriptor.refs.output.map((refDeclaration, refIndex) =>
    objectRef(refDeclaration.kind, index, refIndex),
  );
}

function objectRef(kind, index, refIndex = 0) {
  const scheme = kind === "send" ? "send_id" : "guid";
  return createObjectRef(kind, {
    scheme,
    value: `{${kind.toUpperCase()}-${index}-${refIndex}}`,
  });
}

function fakeBridgeWithRefs(refs) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithRefs(request, startedAt) {
    const mutates = request.operation.family === "run_command";
    const envelope = this.okEnvelope(request, startedAt, {
      summary: {
        template_id: request.pack.capability,
        pack: request.pack.id,
      },
      refs,
      artifacts: [],
      jobs: [],
      last_result: {
        updated: mutates,
        refs: mutates ? refs.slice(0, request.budget.max_items) : [],
        truncated: false,
      },
    });

    if (envelope.ok && mutates) this.lastResult = refs.slice(0, request.budget.max_items);
    return envelope;
  };
  return bridge;
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
