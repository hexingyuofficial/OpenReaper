import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS,
} from "../../packages/core/src/recipe-contract-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_ID_PATTERN,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  createTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  TEMPLATE_CATALOG_ALPHA3_C3_TEMPLATE_IDS,
  createTemplateCatalogAlpha3C3Templates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS,
  createAcceptedOfficialTemplateCatalog,
} from "../../packages/mcp-server/src/call-template-runtime-v1.mjs";
import {
  ALPHA3_C3_TEMPLATE_FILL_TEMPLATE_IDS,
  createAlpha3C3TemplateFillTemplates,
} from "../../packages/core/src/template-packs/alpha3-c3-template-fill-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.automation.list_project_envelopes",
]);

describe("Alpha3 C3 template fill descriptors", () => {
  it("exports exactly the Alpha3 C3 bounded template fill allowlist", () => {
    const templates = createAlpha3C3TemplateFillTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(ALPHA3_C3_TEMPLATE_FILL_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(TEMPLATE_CATALOG_ALPHA3_C3_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(createTemplateCatalogAlpha3C3Templates().map((descriptor) => descriptor.id), ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
  });

  it("keeps the automation inventory template read-only, bounded, and descriptor-valid", async () => {
    const [descriptor] = createAlpha3C3TemplateFillTemplates();
    const validation = validateTemplateDescriptor(descriptor);
    const catalog = createTemplateCatalog({ templates: createAlpha3C3TemplateFillTemplates() });
    const bridge = fakeBridgeWithRefs([
      createObjectRef("envelope", { scheme: "guid", value: "{ENV-1}" }, {
        ref: "envelope:track:guid:{TRACK-1}:volume",
      }),
    ]);
    const result = await executeTemplate({
      descriptor: catalog.require("template.automation.list_project_envelopes"),
      input: { parent_kinds: ["track", "take", "send", "fx"], only_visible: true, limit: 50 },
      refs: {},
      context: context(),
      executor: bridge,
    });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(descriptor.id.match(TEMPLATE_DESCRIPTOR_ID_PATTERN)?.[1], "automation");
    assert.equal(descriptor.pack, "automation");
    assert.equal(descriptor.risk, "read");
    assert.equal(descriptor.bridge.operation_family, "query_state");
    assert.equal(descriptor.bridge.operation_name, "automation.project_envelopes.list");
    assert.equal(descriptor.bridge.idempotency, "none");
    assert.equal(descriptor.artifacts.mode, "none");
    assert.equal(descriptor.refs.input.length, 0);
    assert.equal(descriptor.refs.output[0].kind, "envelope");
    assert.equal(result.ok, true);
    assert.equal(result.result.last_result.updated, false);
    assert.equal(bridge.seen.length, 1);
    assert.equal(bridge.seen[0].operation.family, "query_state");
    assert.equal(bridge.seen[0].refs.length, 0);
    assert.equal(bridge.seen[0].undo.mode, "none");
    assert.equal(bridge.seen[0].artifacts.allow, false);
  });

  it("promotes the Alpha3 C3 fill id into accepted catalog surfaces without changing tools", () => {
    const officialCatalog = createAcceptedOfficialTemplateCatalog();

    for (const id of ALLOWLIST) {
      assert.equal(officialCatalog.get(id) !== null, true, id);
      assert.equal(CALL_TEMPLATE_RUNTIME_ACCEPTED_TEMPLATE_IDS.includes(id), true, id);
      assert.equal(RECIPE_CONTRACT_ACCEPTED_TEMPLATE_IDS.includes(id), true, id);
    }
  });

  it("keeps the descriptor source static and free of runtime bypasses", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/alpha3-c3-template-fill-v1.mjs", import.meta.url),
      "utf8",
    );
    const serialized = JSON.stringify(createAlpha3C3TemplateFillTemplates());

    assert.doesNotMatch(source, /call-template-runtime|reaper\/bridge|LIVE_SMOKE_MATRIX/);
    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|os\.execute|io\.popen/);
    assert.doesNotMatch(serialized, /run_action|Main_OnCommand|NamedCommandLookup|action_id|command_id/);
    assert.doesNotMatch(serialized, /raw_sql|lua|shell|process|raw_descriptor|bridge_request/);
    assert.doesNotMatch(serialized, /point_lane|dense_lane|points_json|automation_items_json/);
  });
});

function fakeBridgeWithRefs(refs) {
  const bridge = new FakeFoundationBridge();
  bridge.execute = function executeWithRefs(request, startedAt) {
    return this.okEnvelope(request, startedAt, {
      summary: {
        operation: request.operation.name,
        pack: request.pack.id,
      },
      refs,
      artifacts: [],
      jobs: [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    });
  };
  return bridge;
}

function context(overrides = {}) {
  return {
    session_id: "session-alpha3-c3-fill",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-08T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
