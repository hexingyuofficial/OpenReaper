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
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE3B_SYSTEM_TEMPLATE_IDS,
  createWave3BSystemTemplates,
} from "../../packages/core/src/template-packs/wave3b-system-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.system.read_runtime_environment",
  "template.system.read_resource_paths",
  "template.system.check_api_symbols",
]);

const BLOCKED_SYSTEM_IDS = Object.freeze([
  "template.system.read_ext_state_value",
  "template.system.write_ext_state_value",
  "template.system.read_proj_ext_state_value",
  "template.system.write_proj_ext_state_value",
  "template.system.list_directory",
  "template.system.read_file",
  "template.system.write_file",
  "template.system.delete_file",
  "template.system.run_shell_command",
  "template.system.spawn_process",
  "template.system.install_extension",
  "template.system.mutate_startup_script",
  "template.system.enumerate_environment",
  "template.system.execute_api_symbol",
]);

describe("Wave 3B system template descriptors", () => {
  it("exports exactly the Wave 3B system descriptor allowlist", () => {
    const ids = createWave3BSystemTemplates().map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE3B_SYSTEM_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_SYSTEM_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as read-only system descriptors", () => {
    for (const descriptor of createWave3BSystemTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "system", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.system."), true, descriptor.id);
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
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <=
          TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }
  });

  it("keeps system ownership limited to runtime, paths, and API symbol reads", () => {
    const catalog = createTemplateCatalog({ templates: createWave3BSystemTemplates() });
    const runtime = catalog.require("template.system.read_runtime_environment");
    const paths = catalog.require("template.system.read_resource_paths");
    const api = catalog.require("template.system.check_api_symbols");
    const source = JSON.stringify(catalog.list());

    assert.equal(runtime.entity_kind, "system_state");
    assert.equal(paths.entity_kind, "resource_path");
    assert.equal(api.entity_kind, "api_symbol");
    assert.equal(Object.hasOwn(api.inputSchema.properties, "symbols"), true);
    assert.equal(Object.hasOwn(api.inputSchema.properties, "profile"), true);
    assert.equal(api.inputSchema.properties.symbols.type, "array");

    assert.doesNotMatch(source, /run_command|run_action|run_job|artifact_metadata/);
    assert.doesNotMatch(source, /read_ext_state_value|write_ext_state|proj_ext_state/i);
    assert.doesNotMatch(source, /list_directory|read_file|write_file|delete_file/);
    assert.doesNotMatch(source, /shell|process_spawn|install_extension|startup_script/);
    assert.doesNotMatch(source, /"ui"|ui_automation|hardware_control/);
  });

  it("loads a pack-local Wave 3B system catalog without duplicate ids", () => {
    const templates = createWave3BSystemTemplates();
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
        /Duplicate template id: template\.system\.read_runtime_environment/.test(
          error.errors.join("\n"),
        ),
    );
  });

  it("exposes compact discovery summaries and exact on-demand fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave3BSystemTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "system" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal("total" in menu.page, false);
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(
        Buffer.byteLength(JSON.stringify(item), "utf8") <=
          TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
        true,
        item.id,
      );
    }

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }

    const exact = discovery.list_templates({
      ids: ["template.system.check_api_symbols", "template.system.missing"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.system.missing"]);
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
    for (const [index, descriptor] of createWave3BSystemTemplates().entries()) {
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.operation.family, "query_state", descriptor.id);
      assert.equal(request.pack.id, "system", descriptor.id);
      assert.equal(request.pack.risk, "read", descriptor.id);
      assert.equal(request.undo.mode, "none", descriptor.id);
      assert.equal(request.verification.mode, "none", descriptor.id);
      assert.equal("idempotency_key" in request, false, descriptor.id);
      assert.deepEqual(request.refs, [], descriptor.id);
      assert.equal(request.artifacts.allow, false, descriptor.id);
    }
  });

  it("runs Layer 4B fake read smoke for every system descriptor", async () => {
    for (const [index, descriptor] of createWave3BSystemTemplates().entries()) {
      const bridge = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, descriptor.id);
      assert.equal(result.template.id, descriptor.id);
      assert.equal(result.template.pack, "system", descriptor.id);
      assert.equal(result.template.risk, "read", descriptor.id);
      assert.equal(result.template.operation.family, "query_state", descriptor.id);
      assert.equal(result.undo.mode, "none", descriptor.id);
      assert.equal(result.result.last_result.updated, false, descriptor.id);
      assert.deepEqual(result.result.refs, [], descriptor.id);
      assert.deepEqual(result.result.artifacts, [], descriptor.id);
      assert.deepEqual(result.result.jobs, [], descriptor.id);
      assert.equal(bridge.seen.length, 1, descriptor.id);
      assert.doesNotMatch(JSON.stringify(result), /environment_variables|directory_listing|file_content/);
    }
  });

  it("rejects invalid inputs and idempotency before fake dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createWave3BSystemTemplates() });
    const descriptor = catalog.require("template.system.check_api_symbols");

    const invalidInputBridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: { profile: "core_runtime", execute: true },
      context: context({ request_sequence: 20 }),
      executor: invalidInputBridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidInput.error.details.errors.join("\n"), /input\.execute is not declared/);
    assert.equal(invalidInputBridge.seen.length, 0);

    const wrongTypeBridge = new FakeFoundationBridge();
    const wrongType = await executeTemplate({
      descriptor,
      input: { symbols: "GetAppVersion" },
      context: context({ request_sequence: 21 }),
      executor: wrongTypeBridge,
    });
    assert.equal(wrongType.ok, false);
    assert.equal(wrongType.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(wrongType.error.details.errors.join("\n"), /input\.symbols must be array/);
    assert.equal(wrongTypeBridge.seen.length, 0);

    const invalidProfileBridge = new FakeFoundationBridge();
    const invalidProfile = await executeTemplate({
      descriptor,
      input: { profile: "execute_anything" },
      context: context({ request_sequence: 22 }),
      executor: invalidProfileBridge,
    });
    assert.equal(invalidProfile.ok, false);
    assert.equal(invalidProfile.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidProfile.error.details.errors.join("\n"), /input\.profile must be one of/);
    assert.equal(invalidProfileBridge.seen.length, 0);

    const idempotencyBridge = new FakeFoundationBridge();
    const idempotency = await executeTemplate({
      descriptor,
      input: { profile: "core_runtime" },
      idempotencyKey: "not-allowed-for-read",
      context: context({ request_sequence: 23 }),
      executor: idempotencyBridge,
    });
    assert.equal(idempotency.ok, false);
    assert.equal(idempotency.error.code, "TEMPLATE_IDEMPOTENCY_INVALID");
    assert.equal(idempotencyBridge.seen.length, 0);
  });

  it("keeps Wave 3B system sources descriptor-only and free of blocked surfaces", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave3b-system-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_SYSTEM_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)), blockedId);
    }
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|exec\(/);
    assert.doesNotMatch(source, /GetExtState|SetExtState|GetProjExtState|SetProjExtState/);
    assert.doesNotMatch(source, /\bio\.|readFile|writeFile|unlink|rm\(/);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /run_action|Main_OnCommand|Main_OnCommandEx/);
    assert.doesNotMatch(source, /executeTemplate|FakeFoundationBridge|call_template/);
  });
});

function context(overrides = {}) {
  return {
    session_id: "session-system-pack",
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
