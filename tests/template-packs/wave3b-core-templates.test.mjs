import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FOUNDATION_BRIDGE_REF_KINDS,
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
  WAVE3B_CORE_TEMPLATE_IDS,
  createWave3BCoreTemplates,
} from "../../packages/core/src/template-packs/wave3b-core-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.core.read_openreaper_status",
  "template.core.read_template_catalog_summary",
  "template.core.read_last_result",
]);

const BLOCKED_CORE_IDS = Object.freeze([
  "template.core.read_template_coverage_summary",
  "template.core.read_health",
  "template.core.run_diagnostics",
  "template.core.recover_failed_operation",
  "template.core.dump_template_catalog",
  "template.core.inspect_route_board",
  "template.core.create_track",
  "template.core.move_item",
  "template.core.import_media",
  "template.core.render_project",
  "template.core.execute_action",
  "template.core.run_command",
]);

describe("Wave 3B core template descriptors", () => {
  it("exports exactly the Wave 3B core descriptor allowlist", () => {
    const ids = createWave3BCoreTemplates().map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE3B_CORE_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_CORE_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as read-only core query descriptors", () => {
    for (const descriptor of createWave3BCoreTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "core", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.core."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.risk, "read", descriptor.id);
      assert.equal(descriptor.bridge.operation_family, "query_state", descriptor.id);
      assert.equal(descriptor.bridge.idempotency, "none", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "read", descriptor.id);
      assert.equal(descriptor.expectedDelta.entities[0].action, "read", descriptor.id);
      assert.equal(descriptor.verification.mode, "none", descriptor.id);
      assert.deepEqual(descriptor.refs, { input: [], output: [] }, descriptor.id);
      assert.deepEqual(descriptor.artifacts, { mode: "none", input: [], output: [] }, descriptor.id);
      assert.equal(Object.hasOwn(descriptor.inputSchema.properties, "emits"), false, descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }
  });

  it("keeps ownership limited to core status, catalog summary, and last-result visibility", () => {
    const catalog = createTemplateCatalog({ templates: createWave3BCoreTemplates() });
    const status = catalog.require("template.core.read_openreaper_status");
    const catalogSummary = catalog.require("template.core.read_template_catalog_summary");
    const lastResult = catalog.require("template.core.read_last_result");
    const descriptorPayload = JSON.stringify(catalog.list());

    assert.equal(status.entity_kind, "core_state");
    assert.equal(catalogSummary.entity_kind, "core_state");
    assert.equal(lastResult.entity_kind, "last_result");
    assert.equal(lastResult.bridge.operation_name, "last_result.read");
    assert.deepEqual(lastResult.inputSchema.properties.kind.enum, FOUNDATION_BRIDGE_REF_KINDS);

    assert.equal(Object.hasOwn(catalogSummary.outputSchema.properties, "ids"), false);
    assert.equal(Object.hasOwn(catalogSummary.outputSchema.properties, "descriptors"), false);
    assert.equal(Object.hasOwn(catalogSummary.outputSchema.properties, "schemas"), false);
    assert.equal(Object.hasOwn(catalogSummary.outputSchema.properties, "examples"), false);
    assert.doesNotMatch(descriptorPayload, /route_board|control_tower|diagnostics|recovery/i);
    assert.doesNotMatch(descriptorPayload, /run_command|run_action|run_job|artifact_metadata/);
    assert.doesNotMatch(descriptorPayload, /create_track|move_item|import_media|render_project|execute_action/);
  });

  it("loads a pack-local catalog, rejects duplicates, and keeps default discovery compact", () => {
    const templates = createWave3BCoreTemplates();
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
        /Duplicate template id: template\.core\.read_openreaper_status/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "core" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal("total" in menu.page, false);
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(
        Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
        true,
        item.id,
      );
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
  });

  it("supports exact id lookup with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave3BCoreTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const exact = discovery.list_templates({
      ids: ["template.core.read_last_result", "template.core.missing"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.core.missing"]);
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

  it("builds read-only bridge requests without undo, artifacts, refs, or idempotency", () => {
    for (const [index, descriptor] of createWave3BCoreTemplates().entries()) {
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.operation.family, "query_state", descriptor.id);
      assert.equal(request.pack.id, "core", descriptor.id);
      assert.equal(request.pack.risk, "read", descriptor.id);
      assert.equal(request.undo.mode, "none", descriptor.id);
      assert.equal(request.verification.mode, "none", descriptor.id);
      assert.equal("idempotency_key" in request, false, descriptor.id);
      assert.deepEqual(request.refs, [], descriptor.id);
      assert.equal(request.artifacts.allow, false, descriptor.id);
    }
  });

  it("runs Layer 4B fake read smoke for every core descriptor", async () => {
    for (const [index, descriptor] of createWave3BCoreTemplates().entries()) {
      const bridge = seededBridgeFor(descriptor.id);
      const result = await executeTemplate({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
        budget: { max_response_bytes: 65_536, max_items: 2, max_inline_value_bytes: 2_048 },
      });

      assert.equal(result.ok, true, descriptor.id);
      assert.equal(result.template.id, descriptor.id);
      assert.equal(result.template.pack, "core", descriptor.id);
      assert.equal(result.template.risk, "read", descriptor.id);
      assert.equal(result.template.operation.family, "query_state", descriptor.id);
      assert.equal(result.undo.mode, "none", descriptor.id);
      assert.equal(result.result.last_result.updated, false, descriptor.id);
      assert.deepEqual(result.result.refs, [], descriptor.id);
      assert.deepEqual(result.result.artifacts, [], descriptor.id);
      assert.deepEqual(result.result.jobs, [], descriptor.id);
      assert.equal(bridge.seen.length >= 1, true, descriptor.id);
      assert.doesNotMatch(JSON.stringify(result), /descriptor|inputSchema|outputSchema|route_board|"logs"/);

      if (descriptor.id === "template.core.read_last_result") {
        assert.equal(result.result.last_result.refs.length, 2);
        assert.equal(result.result.last_result.truncated, true);
      }
    }
  });

  it("rejects invalid inputs and idempotency before fake dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave3BCoreTemplates() });
    const descriptor = catalog.require("template.core.read_last_result");

    const unknownInputBridge = new FakeFoundationBridge();
    const unknownInput = await executeTemplate({
      descriptor,
      input: { kind: "item", delete: true },
      context: context({ request_sequence: 10 }),
      executor: unknownInputBridge,
    });
    assert.equal(unknownInput.ok, false);
    assert.equal(unknownInput.error.source, "harness");
    assert.equal(unknownInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(unknownInput.error.details.errors.join("\n"), /input\.delete is not declared/);
    assert.equal(unknownInputBridge.seen.length, 0);

    const unknownKindBridge = new FakeFoundationBridge();
    const unknownKind = await executeTemplate({
      descriptor,
      input: { kind: "track_group" },
      context: context({ request_sequence: 11 }),
      executor: unknownKindBridge,
    });
    assert.equal(unknownKind.ok, false);
    assert.equal(unknownKind.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(unknownKind.error.details.errors.join("\n"), /input\.kind must be one of/);
    assert.equal(unknownKindBridge.seen.length, 0);

    const idempotencyBridge = new FakeFoundationBridge();
    const idempotency = await executeTemplate({
      descriptor,
      input: {},
      idempotencyKey: "not-allowed-for-read",
      context: context({ request_sequence: 12 }),
      executor: idempotencyBridge,
    });
    assert.equal(idempotency.ok, false);
    assert.equal(idempotency.error.code, "TEMPLATE_IDEMPOTENCY_INVALID");
    assert.equal(idempotencyBridge.seen.length, 0);
  });

  it("keeps Wave 3B core sources descriptor-only and free of forbidden surfaces", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave3b-core-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_CORE_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)), blockedId);
    }
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /call_template|executeTemplate|FakeFoundationBridge/);
    assert.doesNotMatch(source, /Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand/);
    assert.doesNotMatch(source, /route_board|control_tower|read_template_coverage_summary/);
  });
});

function context(overrides = {}) {
  return {
    session_id: "session-core-pack",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function seededBridgeFor(descriptorId) {
  const bridge = new FakeFoundationBridge();
  if (descriptorId !== "template.core.read_last_result") return bridge;

  bridge.dispatch(
    mutationRequest({
      refs: [
        createObjectRef("item", { scheme: "guid", value: "{ITEM-A}" }),
        createObjectRef("track", { scheme: "guid", value: "{TRACK-A}" }),
        createObjectRef("region", { scheme: "guid", value: "{REGION-A}" }),
      ],
    }),
  );
  return bridge;
}

function mutationRequest({ refs }) {
  return {
    contract: "foundation.bridge.v1",
    id: "cmd_20260703000000000_999_seed01",
    created_at: "2026-07-03T00:00:00.000Z",
    client: {
      id: "openreaper-mcp",
      session_id: "session-core-pack",
    },
    bridge: {
      expected_owner: "owner-test",
      expected_generation: 1,
    },
    operation: {
      family: "run_command",
      name: "seed.last_result",
    },
    pack: {
      id: "tracks",
      capability: "track.seed_last_result",
      risk: "write",
    },
    params: {
      emits: {
        refs,
      },
    },
    refs: [],
    undo: {
      mode: "required",
      label: "OpenReaper: seed.last_result",
      flags: ["track"],
    },
    verification: {
      mode: "required",
      checks: [
        {
          name: "seed_exists",
          kind: "state_delta",
          summary: "Seed refs exist.",
        },
      ],
    },
    artifacts: {
      allow: false,
    },
    budget: {
      max_response_bytes: 65_536,
      max_items: 3,
      max_inline_value_bytes: 2_048,
    },
    timeout_ms: 5_000,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
