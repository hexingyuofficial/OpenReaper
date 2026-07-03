import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { FakeFoundationBridge } from "../../packages/core/src/foundation-bridge-v1.mjs";
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
  WAVE2A_ACTIONS_TEMPLATE_IDS,
  createWave2AActionsTemplates,
} from "../../packages/core/src/template-packs/wave2a-actions-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.actions.resolve_named_command",
  "template.actions.read_action_metadata",
  "template.actions.read_action_toggle_state",
  "template.actions.read_action_shortcuts",
  "template.actions.parse_marker_action_text",
  "template.actions.search_action_commands",
  "template.actions.read_custom_action_metadata",
  "template.actions.read_cycle_action_metadata",
]);

const BLOCKED_ACTIONS_IDS = Object.freeze([
  "template.actions.preview_guarded_write_action",
  "template.actions.run_guarded_write_action",
  "template.actions.run_guarded_destructive_action",
  "template.actions.run_guarded_custom_action",
  "template.actions.execute_single_marker_action",
  "template.actions.set_marker_actions_enabled",
  "template.actions.run_cycle_action",
  "template.actions.execute_marker_action_macro",
  "template.actions.import_custom_action_as_recipe",
  "template.actions.run_action_by_command_id",
  "template.actions.run_reascript_or_lua",
  "template.actions.run_transport_action",
  "template.actions.run_track_or_item_action",
  "template.actions.run_reaconsole_command",
  "template.actions.apply_cleanup_safe_action",
  "template.actions.show_action_list",
]);

describe("Wave 2A actions template descriptors", () => {
  it("exports exactly the Wave 2A actions descriptor allowlist", () => {
    const ids = createWave2AActionsTemplates().map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE2A_ACTIONS_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_ACTIONS_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as read-only actions metadata descriptors", () => {
    for (const descriptor of createWave2AActionsTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "actions", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.actions."), true, descriptor.id);
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

  it("keeps actions ownership limited to metadata, search, and parse reads", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AActionsTemplates() });
    const parseMarker = catalog.require("template.actions.parse_marker_action_text");
    const custom = catalog.require("template.actions.read_custom_action_metadata");
    const cycle = catalog.require("template.actions.read_cycle_action_metadata");
    const source = JSON.stringify(catalog.list());

    assert.equal(parseMarker.entity_kind, "marker_action");
    assert.equal(parseMarker.refs.input.length, 0);
    assert.equal(parseMarker.inputSchema.required.includes("text"), true);
    assert.equal(custom.entity_kind, "custom_action");
    assert.equal(cycle.entity_kind, "cycle_action");
    assert.equal(cycle.tags.includes("sws"), true);

    assert.doesNotMatch(source, /run_action|run_command|run_job|artifact_metadata/);
    assert.doesNotMatch(source, /Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand/);
    assert.doesNotMatch(source, /run_guarded|execute_single_marker_action|run_cycle_action/);
    assert.doesNotMatch(source, /reaconsole|reascript|lua/i);
  });

  it("loads pack-local and shared Wave 2A fixture catalogs without duplicate ids", () => {
    const templates = createWave2AActionsTemplates();
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
        /Duplicate template id: template\.actions\.resolve_named_command/.test(error.errors.join("\n")),
    );

    for (const id of ALLOWLIST) {
      assert.equal(TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS.includes(id), true, id);
    }
    const sharedActions = createTemplateCatalogWave2aTemplates().filter((descriptor) => descriptor.pack === "actions");
    assert.deepEqual(sharedActions.map((descriptor) => descriptor.id), ALLOWLIST);
  });

  it("exposes compact discovery summaries and exact on-demand fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave2AActionsTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "actions" });

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

    const exact = discovery.list_templates({
      ids: ["template.actions.parse_marker_action_text", "template.actions.missing"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.actions.missing"]);
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

  it("builds read-only bridge requests without action execution, undo, or idempotency", () => {
    for (const [index, descriptor] of createWave2AActionsTemplates().entries()) {
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.operation.family, "query_state", descriptor.id);
      assert.notEqual(request.operation.family, "run_action", descriptor.id);
      assert.equal(request.pack.id, "actions", descriptor.id);
      assert.equal(request.pack.risk, "read", descriptor.id);
      assert.equal(request.undo.mode, "none", descriptor.id);
      assert.equal(request.verification.mode, "none", descriptor.id);
      assert.equal("idempotency_key" in request, false, descriptor.id);
      assert.deepEqual(request.refs, [], descriptor.id);
      assert.equal(request.artifacts.allow, false, descriptor.id);
    }
  });

  it("runs Layer 4B fake read smoke for every actions descriptor", async () => {
    for (const [index, descriptor] of createWave2AActionsTemplates().entries()) {
      const bridge = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, descriptor.id);
      assert.equal(result.template.id, descriptor.id);
      assert.equal(result.template.pack, "actions", descriptor.id);
      assert.equal(result.template.risk, "read", descriptor.id);
      assert.equal(result.template.operation.family, "query_state", descriptor.id);
      assert.equal(result.undo.mode, "none", descriptor.id);
      assert.equal(result.result.last_result.updated, false, descriptor.id);
      assert.deepEqual(result.result.refs, [], descriptor.id);
      assert.deepEqual(result.result.artifacts, [], descriptor.id);
      assert.deepEqual(result.result.jobs, [], descriptor.id);
      assert.equal(bridge.seen.length, 1, descriptor.id);
      assert.doesNotMatch(JSON.stringify(result), /payload|script|command_list/);
    }
  });

  it("rejects invalid inputs and idempotency before fake dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave2AActionsTemplates() });
    const descriptor = catalog.require(
      "template.actions.resolve_named_command",
    );
    const invalidInputBridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: { named_command: "_SWS_ABOUT", execute: true },
      context: context({ request_sequence: 20 }),
      executor: invalidInputBridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidInput.error.details.errors.join("\n"), /input\.execute is not declared/);
    assert.equal(invalidInputBridge.seen.length, 0);

    const missingInputBridge = new FakeFoundationBridge();
    const missingInput = await executeTemplate({
      descriptor,
      input: {},
      context: context({ request_sequence: 21 }),
      executor: missingInputBridge,
    });
    assert.equal(missingInput.ok, false);
    assert.equal(missingInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(missingInput.error.details.errors.join("\n"), /input\.named_command is required/);
    assert.equal(missingInputBridge.seen.length, 0);

    const idempotencyBridge = new FakeFoundationBridge();
    const idempotency = await executeTemplate({
      descriptor,
      input: { named_command: "_SWS_ABOUT" },
      idempotencyKey: "not-allowed-for-read",
      context: context({ request_sequence: 22 }),
      executor: idempotencyBridge,
    });
    assert.equal(idempotency.ok, false);
    assert.equal(idempotency.error.code, "TEMPLATE_IDEMPOTENCY_INVALID");
    assert.equal(idempotencyBridge.seen.length, 0);

    const missingSelectorCases = [
      ["template.actions.read_action_metadata", /input\.command_id is required/],
      ["template.actions.read_action_toggle_state", /input\.command_id is required/],
      ["template.actions.read_custom_action_metadata", /input\.named_command is required/],
      ["template.actions.read_cycle_action_metadata", /input\.named_command is required/],
    ];

    for (const [id, expected] of missingSelectorCases) {
      const bridge = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor: catalog.require(id),
        input: { section: "main" },
        context: context({ request_sequence: 23 }),
        executor: bridge,
      });

      assert.equal(result.ok, false, id);
      assert.equal(result.error.source, "harness", id);
      assert.equal(result.error.code, "TEMPLATE_INPUT_INVALID", id);
      assert.match(result.error.details.errors.join("\n"), expected, id);
      assert.equal(bridge.seen.length, 0, id);
    }
  });

  it("keeps Wave 2A actions sources descriptor-only and free of runtime surfaces", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave2a-actions-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_ACTIONS_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)), blockedId);
    }
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /run_action|Main_OnCommand|Main_OnCommandEx|MIDIEditor_OnCommand/);
    assert.doesNotMatch(source, /executeTemplate|FakeFoundationBridge|call_template/);
  });
});

function context(overrides = {}) {
  return {
    session_id: "session-actions-pack",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
