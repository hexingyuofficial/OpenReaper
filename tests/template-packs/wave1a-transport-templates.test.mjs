import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_BUDGETS,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE1A_TRANSPORT_TEMPLATE_IDS,
  createWave1ATransportTemplates,
} from "../../packages/core/src/template-packs/wave1a-transport-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.transport.read_state",
  "template.transport.play",
  "template.transport.pause",
  "template.transport.stop_playback",
  "template.transport.set_edit_cursor",
  "template.transport.set_time_selection",
  "template.transport.clear_time_selection",
  "template.transport.set_loop_points",
  "template.transport.clear_loop_points",
  "template.transport.set_repeat",
  "template.transport.set_playback_rate",
  "template.transport.start_recording",
  "template.transport.stop_recording",
  "template.transport.set_record_mode",
  "template.transport.set_punch_record_range",
  "template.transport.schedule_recording",
]);

const BLOCKED_TRANSPORT_IDS = Object.freeze([
  "template.transport.read_record_posture",
  "template.transport.seek_play_cursor",
  "template.transport.nudge_edit_cursor",
  "template.transport.play_time_selection",
  "template.transport.set_metronome",
  "template.transport.set_playrate",
  "template.transport.toggle_play_pause",
  "template.transport.toggle_repeat",
  "template.transport.run_transport_action",
]);

describe("Wave 1A transport template descriptors", () => {
  it("exports exactly the Wave 1A transport allowlist", () => {
    const templates = createWave1ATransportTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE1A_TRANSPORT_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_TRANSPORT_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A descriptor validation with transport ownership and risk posture", () => {
    for (const descriptor of createWave1ATransportTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "transport", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.transport."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.deepEqual(descriptor.refs, { input: [], output: [] }, descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.equal(Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes, true);

      if (descriptor.id === "template.transport.read_state") {
        assert.equal(descriptor.risk, "read");
        assert.equal(descriptor.bridge.operation_family, "query_state");
        assert.equal(descriptor.bridge.idempotency, "none");
        assert.equal(descriptor.expectedDelta.kind, "read");
        assert.equal(descriptor.verification.mode, "none");
      } else {
        assert.equal(["safe", "write"].includes(descriptor.risk), true, descriptor.id);
        assert.equal(descriptor.bridge.operation_family, "run_command", descriptor.id);
        assert.equal(descriptor.bridge.operation_name, "template.execute", descriptor.id);
        assert.equal(descriptor.bridge.idempotency, "supported", descriptor.id);
        assert.equal(descriptor.expectedDelta.kind, "mutation", descriptor.id);
        assert.equal(descriptor.verification.mode, "required", descriptor.id);
        assert.equal(descriptor.verification.checks.length, 1, descriptor.id);
        if (descriptor.id.includes("recording") && !descriptor.id.includes("set_record_mode") && !descriptor.id.includes("set_punch")) {
          assert.equal(descriptor.risk, "write", descriptor.id);
        }
      }
    }
  });

  it("loads a pack-local catalog, rejects duplicates, and keeps default discovery bounded", () => {
    const templates = createWave1ATransportTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);
    for (const id of ALLOWLIST) assert.equal(catalog.require(id).id, id);

    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.transport\.read_state/.test(error.errors.join("\n")),
    );

    const response = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog).list_templates();
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
      assert.equal(Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes, true);
    }
  });

  it("supports exact id lookup with allowed Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATransportTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.transport.set_edit_cursor", "template.transport.missing"],
      fields: ["summary", "input_schema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.transport.missing"]);
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

  it("runs a fake harness read smoke for transport state", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATransportTemplates() });
    const result = await executeTemplate({
      descriptor: catalog.require("template.transport.read_state"),
      input: {},
      context: context({ request_sequence: 1 }),
      executor: new FakeFoundationBridge(),
    });

    assert.equal(result.ok, true);
    assert.equal(result.template.id, "template.transport.read_state");
    assert.equal(result.template.pack, "transport");
    assert.equal(result.template.risk, "read");
    assert.deepEqual(result.template.operation, {
      family: "query_state",
      name: "transport.read_state",
    });
    assert.equal(result.undo.mode, "none");
    assert.equal(result.verification.mode, "none");
    assert.equal(result.result.last_result.updated, false);
  });

  it("runs fake harness smoke for every safe transport atom", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATransportTemplates() });
    const bridge = new FakeFoundationBridge();

    for (const [index, id] of ALLOWLIST.filter((entry) => entry !== "template.transport.read_state").entries()) {
      const descriptor = catalog.require(id);
      const input = sampleInput(id);
      const request = buildTemplateBridgeRequest({
        descriptor,
        input,
        context: context({ request_sequence: index + 2 }),
      });

      assert.equal(request.pack.id, "transport", id);
      assert.equal(request.pack.risk, descriptor.risk, id);
      assert.equal(request.operation.family, "run_command", id);
      assert.equal(request.operation.name, "template.execute", id);
      assert.equal(request.undo.mode, "required", id);
      assert.equal(request.undo.label, `OpenReaper: ${descriptor.bridge.capability}`, id);
      assert.deepEqual(request.undo.flags, [descriptor.entity_kind], id);
      assert.equal(request.verification.mode, "required", id);
      assert.equal("idempotency_key" in request, false, id);

      const result = await executeTemplate({
        descriptor,
        input,
        context: context({ request_sequence: index + 2 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, id);
      assert.equal(result.template.id, id);
      assert.equal(result.undo.mode, "required", id);
      assert.equal(result.undo.closed, true, id);
      assert.equal(result.verification.status, "passed", id);
      assert.equal(result.result.last_result.updated, true, id);
    }
  });

  it("honors supported idempotency and rejects invalid set_edit_cursor input before dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1ATransportTemplates() });
    const descriptor = catalog.require("template.transport.set_repeat");
    const idempotentRequest = buildTemplateBridgeRequest({
      descriptor,
      input: sampleInput("template.transport.set_repeat"),
      context: context({ request_sequence: 20 }),
      idempotencyKey: "transport-repeat-key",
    });

    assert.equal(idempotentRequest.idempotency_key, "transport-repeat-key");

    const bridge = new FakeFoundationBridge();
    const invalid = await executeTemplate({
      descriptor: catalog.require("template.transport.set_edit_cursor"),
      input: {
        position_seconds: 12.5,
        move_view: false,
        extra: true,
      },
      context: context({ request_sequence: 21 }),
      executor: bridge,
    });

    assert.equal(invalid.ok, false);
    assert.equal(invalid.error.source, "harness");
    assert.equal(invalid.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalid.error.details.errors.join("\n"), /input.seek_playback is required/);
    assert.match(invalid.error.details.errors.join("\n"), /input.extra is not declared/);
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps pack implementation scoped away from shared catalog, runtime, recipes, and legacy migration", () => {
    const descriptorSource = readFileSync(
      new URL("../../packages/core/src/template-packs/wave1a-transport-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(descriptorSource, /template-catalog-fixtures-v1|template-catalog-v1/);
    assert.doesNotMatch(descriptorSource, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(descriptorSource, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(descriptorSource, /\brecipe\b/i);
    assert.doesNotMatch(descriptorSource, /read_record_posture|run_transport_action/);
  });
});

function sampleInput(id) {
  switch (id) {
    case "template.transport.set_edit_cursor":
      return {
        position_seconds: 12.5,
        move_view: false,
        seek_playback: false,
      };
    case "template.transport.set_time_selection":
    case "template.transport.set_loop_points":
      return {
        start_seconds: 32,
        end_seconds: 48,
      };
    case "template.transport.set_repeat":
      return {
        enabled: true,
      };
    case "template.transport.set_playback_rate":
      return {
        playback_rate: 0.5,
        preserve_pitch: true,
      };
    case "template.transport.start_recording":
      return {
        require_armed_track: true,
        respect_punch_range: true,
      };
    case "template.transport.stop_recording":
      return {
        recorded_media_policy: "keep",
      };
    case "template.transport.set_record_mode":
      return {
        mode: "time_selection_auto_punch",
      };
    case "template.transport.set_punch_record_range":
      return {
        start_seconds: 12,
        end_seconds: 20,
      };
    case "template.transport.schedule_recording":
      return {
        start_seconds: 12,
        end_seconds: 20,
        mode: "time_selection_auto_punch",
        require_armed_track: true,
      };
    default:
      return {};
  }
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
