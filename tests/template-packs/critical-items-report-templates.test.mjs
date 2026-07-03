import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
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
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  CRITICAL_ITEMS_REPORT_TEMPLATE_IDS,
  createCriticalItemsReportTemplates,
} from "../../packages/core/src/template-packs/critical-items-report-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.items.create_layer_report",
]);

const BLOCKED_ITEMS_REPORT_IDS = Object.freeze([
  "template.items.create_layer_plan",
  "template.layer.create_layer_report",
  "template.items.apply_layer_plan",
  "template.items.assign_item_roles",
  "template.items.move_items_to_layer_tracks",
  "template.items.create_role_assignment_plan",
]);

describe("Critical items report template descriptors", () => {
  it("exports exactly the R3-A items report descriptor allowlist", () => {
    const templates = createCriticalItemsReportTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_ITEMS_REPORT_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_ITEMS_REPORT_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as an items-owned read-risk report artifact producer", () => {
    const [descriptor] = createCriticalItemsReportTemplates();
    const validation = validateTemplateDescriptor(descriptor);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(descriptor.pack, "items");
    assert.equal(descriptor.id, "template.items.create_layer_report");
    assert.equal(descriptor.lifecycle, "experimental");
    assert.equal(descriptor.risk, "read");
    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.operation_name, "items.create_layer_report");
    assert.equal(descriptor.bridge.capability, "items.create_layer_report");
    assert.equal(descriptor.bridge.idempotency, "none");
    assert.equal(descriptor.artifacts.mode, "produces");
    assert.deepEqual(descriptor.artifacts.input.map((entry) => entry.schema), ["items.layer_evidence.v1"]);
    assert.deepEqual(descriptor.artifacts.output.map((entry) => entry.schema), ["items.layer_report.v1"]);
    assert.equal(descriptor.artifacts.output[0].owner_pack, "items");
    assert.equal(descriptor.refs.input[0].kind, "artifact");
    assert.equal(descriptor.refs.output[0].kind, "artifact");
    assert.equal(descriptor.expectedDelta.kind, "artifact");
    assert.equal(descriptor.expectedDelta.entities[0].action, "emit");
    assert.equal(descriptor.verification.mode, "none");
    assert.equal(
      Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
      true,
    );
  });

  it("keeps the report contract bounded to artifact refs and summary counts", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalItemsReportTemplates() }).require(
      "template.items.create_layer_report",
    );

    assert.deepEqual(Object.keys(descriptor.inputSchema.properties), [
      "max_report_rows",
      "include_track_facts",
      "include_color_facts",
      "include_item_samples",
    ]);
    assert.deepEqual(Object.keys(descriptor.outputSchema.properties), [
      "artifact_ref",
      "schema",
      "evidence_item_count",
      "evidence_track_count",
      "report_row_count",
      "truncated",
    ]);
    assert.deepEqual(descriptor.outputSchema.required, ["artifact_ref", "schema"]);
    assert.equal(JSON.stringify(descriptor.outputSchema).includes("payload"), false);
    assert.equal(JSON.stringify(descriptor.outputSchema).includes("report_body"), false);
    assert.equal(JSON.stringify(descriptor.outputSchema).includes("role_assignment"), false);
    assert.equal(JSON.stringify(descriptor.inputSchema).includes("target_track"), false);
  });

  it("loads as a pack-local catalog, rejects duplicates, and keeps default discovery bounded", () => {
    const templates = createCriticalItemsReportTemplates();
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
        /Duplicate template id: template\.items\.create_layer_report/.test(error.errors.join("\n")),
    );

    const response = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog).list_templates({ pack: "items" });

    assert.equal(response.contract, "discovery.menu.v1");
    assert.equal(response.kind, "template_menu");
    assert.equal(response.mode, "menu");
    assert.equal(response.items.length, ALLOWLIST.length);
    assert.equal(response.page.has_more, false);
    assert.equal(response.page.limit, 25);
    assert.equal("total" in response.page, false);
    assert.equal(Buffer.byteLength(JSON.stringify(response), "utf8") < 2048, true);

    const payload = JSON.stringify(response);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
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
    const catalog = createTemplateCatalog({ templates: createCriticalItemsReportTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: ["template.items.create_layer_report", "template.items.create_layer_plan"],
      fields: ["summary", "inputSchema", "outputSchema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.items.create_layer_plan"]);
    assert.deepEqual(Object.keys(response.items[0]).sort(), [
      "examples",
      "expectedDelta",
      "id",
      "inputSchema",
      "outputSchema",
      "summary",
    ]);
    assert.equal("bridge" in response.items[0], false);
    assert.equal("refs" in response.items[0], false);
    assert.equal("artifacts" in response.items[0], false);
    assert.equal("verification" in response.items[0], false);
  });

  it("builds a legal 4B read-risk report job request without undo or idempotency", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalItemsReportTemplates() }).require(
      "template.items.create_layer_report",
    );
    const request = buildTemplateBridgeRequest({
      descriptor,
      input: reportInput(),
      refs: { layer_evidence_artifact_ref: layerEvidenceRef() },
      context: context(),
    });

    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "items.create_layer_report");
    assert.equal(request.pack.id, "items");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.pack.capability, "items.create_layer_report");
    assert.equal(request.artifacts.allow, true);
    assert.equal(request.undo.mode, "none");
    assert.equal(request.verification.mode, "none");
    assert.equal("idempotency_key" in request, false);
    assert.deepEqual(request.refs, [layerEvidenceRef()]);
    assert.equal(Object.hasOwn(request.params, "role_assignment_plan"), false);
    assert.equal(Object.hasOwn(request.params, "target_track_plan"), false);
  });

  it("fake-smokes the report producer and returns only the report artifact ref plus bounded summary", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalItemsReportTemplates() }).require(
      "template.items.create_layer_report",
    );
    const bridge = new FakeItemsLayerReportBridge();
    const result = await executeTemplate({
      descriptor,
      input: reportInput(),
      refs: { layer_evidence_artifact_ref: layerEvidenceRef() },
      context: context(),
      executor: bridge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.template.id, "template.items.create_layer_report");
    assert.equal(result.template.pack, "items");
    assert.equal(result.template.risk, "read");
    assert.equal(result.result.artifacts.length, 1);
    assert.equal(result.result.artifacts[0].kind, "artifact");
    assert.match(
      result.result.artifacts[0].ref,
      /^artifact:items:layer_report:art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$/,
    );
    assert.equal(result.result.artifacts[0].summary.schema, "items.layer_report.v1");
    assert.deepEqual(result.result.refs, []);
    assert.deepEqual(result.result.jobs, []);
    assert.equal(result.result.last_result.updated, false);
    assert.deepEqual(Object.keys(result.result.summary), [
      "schema",
      "artifact_ref",
      "evidence_item_count",
      "evidence_track_count",
      "report_row_count",
      "truncated",
    ]);
    assert.equal(Buffer.byteLength(JSON.stringify(result.result.summary), "utf8") < 512, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /payload|report_body|rows|role_assignment|target_track|approval|decision|recipe/i,
    );
  });

  it("rejects workflow-shaped plan ownership and plan inputs before fake dispatch", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalItemsReportTemplates() }).require(
      "template.items.create_layer_report",
    );
    const planOwnedDescriptor = {
      ...descriptor,
      id: "template.layer.create_layer_report",
      pack: "layer",
    };
    const planOwnedValidation = validateTemplateDescriptor(planOwnedDescriptor);

    assert.equal(planOwnedValidation.ok, false);
    assert.match(planOwnedValidation.errors.join("\n"), /Invalid pack|workflow-shaped/);

    const bridge = new FakeFoundationBridge();
    const planInput = await executeTemplate({
      descriptor,
      input: {
        ...reportInput(),
        role_assignment_plan: {
          roles: ["dialog", "music"],
          target_tracks: ["Dialog", "Music"],
        },
      },
      refs: { layer_evidence_artifact_ref: layerEvidenceRef() },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });

    assert.equal(planInput.ok, false);
    assert.equal(planInput.error.source, "harness");
    assert.equal(planInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(planInput.error.details.errors.join("\n"), /role_assignment_plan is not declared/);
    assert.equal(bridge.seen.length, 0);

    const missingEvidence = await executeTemplate({
      descriptor,
      input: reportInput(),
      refs: {},
      context: context({ request_sequence: 3 }),
      executor: bridge,
    });

    assert.equal(missingEvidence.ok, false);
    assert.equal(missingEvidence.error.source, "harness");
    assert.equal(missingEvidence.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("is wired into the shared accepted catalog as a critical-fill descriptor", () => {
    const sharedIds = [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
    ].map((descriptor) => descriptor.id);

    assert.equal(sharedIds.includes("template.items.create_layer_report"), true);
  });

  it("keeps pack-local source static: no shared catalog, runtime, recipes, raw execution, paths, or plans", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/critical-items-report-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /template-catalog-fixtures-v1|template-catalog-v1/);
    assert.doesNotMatch(source, /streetlight-reaper-mcp|legacy/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /run_action|run_command|template\.execute/);
    assert.doesNotMatch(source, /raw_lua|raw_action|shell|process\.|file:\/\/|absolute_path|relative_path/i);
    assert.doesNotMatch(source, /create_layer_plan|apply_layer_plan|role_assignment_plan|target_track_plan/);
    for (const blockedId of BLOCKED_ITEMS_REPORT_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)));
    }
  });
});

class FakeItemsLayerReportBridge extends FakeFoundationBridge {
  execute(request, startedAt) {
    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "items.create_layer_report");
    assert.equal(request.pack.id, "items");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.params.max_report_rows, 24);
    assert.equal(request.refs.length, 1);
    assert.equal(request.refs[0].kind, "artifact");

    const artifact = createArtifactRef({
      owner_pack: "items",
      scope: "layer_report",
      id: "art_20260703000000000_001_ab12cd",
      schema: "items.layer_report.v1",
      summary: {
        schema: "items.layer_report.v1",
        evidence_item_count: 8,
        evidence_track_count: 3,
        report_row_count: 6,
        truncated: false,
      },
    });

    return this.okEnvelope(request, startedAt, {
      summary: {
        schema: "items.layer_report.v1",
        artifact_ref: artifact.ref,
        evidence_item_count: 8,
        evidence_track_count: 3,
        report_row_count: 6,
        truncated: false,
      },
      refs: [],
      artifacts: [artifact],
      jobs: [],
      last_result: {
        updated: false,
        refs: [],
        truncated: false,
      },
    });
  }
}

function reportInput(overrides = {}) {
  return {
    max_report_rows: 24,
    include_track_facts: true,
    include_color_facts: true,
    include_item_samples: true,
    ...overrides,
  };
}

function layerEvidenceRef() {
  return createArtifactRef({
    owner_pack: "items",
    scope: "layer_evidence",
    id: "art_20260703000000000_101_abcdef",
    schema: "items.layer_evidence.v1",
    summary: {
      schema: "items.layer_evidence.v1",
      item_count: 8,
      track_count: 3,
    },
  });
}

function context(overrides = {}) {
  return {
    session_id: "session-critical-items-report",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
