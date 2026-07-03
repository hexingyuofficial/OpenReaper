import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
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
  TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  createTemplateCatalogCriticalFillTemplates,
  createTemplateCatalogWave1aTemplates,
  createTemplateCatalogWave2aTemplates,
  createTemplateCatalogWave3bTemplates,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  CRITICAL_PROJECT_REPORT_TEMPLATE_IDS,
  createCriticalProjectReportTemplates,
} from "../../packages/core/src/template-packs/critical-project-report-templates-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.project.create_cleanup_report",
]);

const BLOCKED_PROJECT_REPORT_IDS = Object.freeze([
  "template.project.create_cleanup_plan",
  "template.project.apply_cleanup_plan",
  "template.project.execute_cleanup",
  "template.project.delete_empty_tracks",
  "template.project.cleanup_items",
  "template.cleanup.create_cleanup_report",
]);

describe("Critical project cleanup report template descriptor", () => {
  it("exports exactly the R3-B project report descriptor allowlist", () => {
    const templates = createCriticalProjectReportTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_PROJECT_REPORT_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_PROJECT_REPORT_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as a project-owned read-risk report artifact producer", () => {
    const [descriptor] = createCriticalProjectReportTemplates();
    const validation = validateTemplateDescriptor(descriptor);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(descriptor.pack, "project");
    assert.equal(descriptor.id, "template.project.create_cleanup_report");
    assert.equal(descriptor.lifecycle, "experimental");
    assert.equal(descriptor.risk, "read");
    assert.equal(descriptor.entity_kind, "cleanup_report");
    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.operation_name, "project.create_cleanup_report");
    assert.equal(descriptor.bridge.capability, "project.create_cleanup_report");
    assert.equal(descriptor.bridge.idempotency, "none");
    assert.equal(descriptor.artifacts.mode, "produces");
    assert.equal(descriptor.artifacts.input.length, 0);
    assert.deepEqual(descriptor.artifacts.output, [
      {
        name: "cleanup_report",
        schema: "project.cleanup_report.v1",
        owner_pack: "project",
        summary: "Bounded project cleanup report artifact.",
      },
    ]);
    assert.deepEqual(descriptor.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["project_ref", "project", false],
    ]);
    assert.deepEqual(descriptor.refs.output.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["artifact_ref", "artifact", true],
    ]);
    assert.equal(descriptor.expectedDelta.kind, "artifact");
    assert.deepEqual(descriptor.expectedDelta.entities.map((entry) => entry.action), ["emit"]);
    assert.equal(descriptor.verification.mode, "none");
    assert.equal(
      Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
      true,
    );
  });

  it("limits inputs and outputs to project evidence controls, artifact refs, and bounded summary fields", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() });
    const descriptor = catalog.require("template.project.create_cleanup_report");

    assert.deepEqual(Object.keys(descriptor.inputSchema.properties), [
      "max_report_rows",
      "marker_region_limit",
      "tempo_marker_limit",
      "include_markers",
      "include_regions",
      "include_metadata",
      "include_tempo",
      "include_project_fingerprint",
    ]);
    assert.deepEqual(descriptor.inputSchema.required, []);
    assert.deepEqual(Object.keys(descriptor.outputSchema.properties), [
      "artifact_ref",
      "schema",
      "evidence_family_count",
      "report_row_count",
      "marker_count",
      "region_count",
      "metadata_field_count",
      "tempo_marker_count",
      "project_fingerprint",
      "truncated",
    ]);
    assert.deepEqual(descriptor.outputSchema.required, [
      "artifact_ref",
      "schema",
      "evidence_family_count",
      "report_row_count",
      "truncated",
    ]);
    assert.equal(JSON.stringify(descriptor).includes("track_ref"), false);
    assert.equal(JSON.stringify(descriptor).includes("item_ref"), false);
    assert.equal(JSON.stringify(descriptor).includes("fx_ref"), false);
    assert.equal(JSON.stringify(descriptor).includes("payload"), false);
    assert.equal(Object.hasOwn(descriptor.outputSchema.properties, "report_rows"), false);
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createCriticalProjectReportTemplates();
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
        /Duplicate template id: template\.project\.create_cleanup_report/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "project" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal("total" in menu.page, false);
    assert.equal(Buffer.byteLength(JSON.stringify(menu), "utf8") < 2048, true);

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(
        Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
        true,
        item.id,
      );
    }
  });

  it("supports exact id expansion with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const exact = discovery.list_templates({
      ids: ["template.project.create_cleanup_report", "template.project.create_cleanup_plan"],
      fields: ["summary", "inputSchema", "outputSchema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.project.create_cleanup_plan"]);
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

  it("builds a legal 4B bridge request without undo, idempotency, or non-project refs", () => {
    const [descriptor] = createCriticalProjectReportTemplates();
    const project = projectRef();
    const request = buildTemplateBridgeRequest({
      descriptor,
      input: limitedReportInput(),
      refs: { project_ref: project },
      context: context(),
    });

    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "project.create_cleanup_report");
    assert.equal(request.pack.id, "project");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.pack.capability, "project.create_cleanup_report");
    assert.equal(request.artifacts.allow, true);
    assert.equal(request.undo.mode, "none");
    assert.equal(request.verification.mode, "none");
    assert.equal("idempotency_key" in request, false);
    assert.deepEqual(request.refs, [project]);
    assert.equal(Object.hasOwn(request.params, "cleanup_action"), false);
    assert.equal(Object.hasOwn(request.params, "recipe_plan_ref"), false);
    assert.equal(Object.hasOwn(request.params, "track_ref"), false);
    assert.equal(Object.hasOwn(request.params, "item_ref"), false);
    assert.equal(Object.hasOwn(request.params, "fx_ref"), false);
  });

  it("runs 4B fake smoke and returns only a project report artifact ref plus bounded summary", async () => {
    const [descriptor] = createCriticalProjectReportTemplates();
    const artifact = cleanupReportArtifact();
    const bridge = new FakeFoundationBridge();
    const result = await executeTemplate({
      descriptor,
      input: limitedReportInput(),
      refs: { project_ref: projectRef() },
      context: context(),
      executor: (request) =>
        bridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
          summary: {
            schema: "project.cleanup_report.v1",
            evidence_family_count: 4,
            report_row_count: 8,
            marker_count: 3,
            region_count: 2,
            metadata_field_count: 3,
            tempo_marker_count: 1,
            project_fingerprint: "project-fp-8a7c",
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
        }),
    });

    assert.equal(result.ok, true);
    assert.equal(result.template.id, "template.project.create_cleanup_report");
    assert.equal(result.template.pack, "project");
    assert.equal(result.template.risk, "read");
    assert.equal(result.undo.mode, "none");
    assert.deepEqual(result.result.refs, []);
    assert.deepEqual(result.result.jobs, []);
    assert.equal(result.result.artifacts.length, 1);
    assert.equal(result.result.artifacts[0].kind, "artifact");
    assert.equal(result.result.artifacts[0].ref, "artifact:project:cleanup_report:art_20260703000000000_031_ab12cd");
    assert.equal(result.result.artifacts[0].summary.schema, "project.cleanup_report.v1");
    assert.equal(result.result.last_result.updated, false);
    assert.equal(Buffer.byteLength(JSON.stringify(result.result.summary), "utf8") < 512, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /payload|report_rows|full_report|track_ref|item_ref|fx_ref|file_path|absolute_path/,
    );
  });

  it("rejects destructive cleanup and recipe-plan-shaped inputs before fake dispatch", async () => {
    const [descriptor] = createCriticalProjectReportTemplates();
    const bridge = new FakeFoundationBridge();
    const destructiveInput = await executeTemplate({
      descriptor,
      input: {
        ...limitedReportInput(),
        cleanup_action: "delete_empty_tracks",
      },
      refs: { project_ref: projectRef() },
      context: context(),
      executor: bridge,
    });

    assert.equal(destructiveInput.ok, false);
    assert.equal(destructiveInput.error.source, "harness");
    assert.equal(destructiveInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const recipePlanInput = await executeTemplate({
      descriptor,
      input: {
        ...limitedReportInput(),
        recipe_plan_ref: "artifact:project:cleanup_report:art_20260703000000000_001_abcdef",
      },
      refs: { project_ref: projectRef() },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });

    assert.equal(recipePlanInput.ok, false);
    assert.equal(recipePlanInput.error.source, "harness");
    assert.equal(recipePlanInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("is wired into the shared accepted catalog fixture as a critical-fill descriptor", () => {
    const sharedIds = [
      ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
    ];
    const sharedDescriptorIds = [
      ...createTemplateCatalogWave1aTemplates(),
      ...createTemplateCatalogWave2aTemplates(),
      ...createTemplateCatalogWave3bTemplates(),
      ...createTemplateCatalogCriticalFillTemplates(),
    ].map((descriptor) => descriptor.id);

    assert.equal(sharedIds.includes("template.project.create_cleanup_report"), true);
    assert.equal(sharedDescriptorIds.includes("template.project.create_cleanup_report"), true);
  });

  it("keeps pack-local source free of cleanup execution, recipes, raw execution, paths, and shared wiring", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/critical-project-report-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_PROJECT_REPORT_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)), blockedId);
    }
    assert.doesNotMatch(source, /template\.cleanup\.|template\.delivery\.|template\.layer\./);
    assert.doesNotMatch(source, /cleanup_plan|apply_cleanup|execute_cleanup|recipe_plan|recipe/i);
    assert.doesNotMatch(source, /delete|remove|move|rename|purge|organize|consolidate|mute|reroute/i);
    assert.doesNotMatch(source, /track_ref|item_ref|take_ref|fx_ref|send_ref|route_ref/);
    assert.doesNotMatch(source, /run_action|run_command|template\.execute/);
    assert.doesNotMatch(source, /raw_lua|raw_action|lua|child_process|spawn\(|execFile|shell|process\./i);
    assert.doesNotMatch(source, /output_path|file_path|absolute_path|relative_path|file:\/\//i);
    assert.doesNotMatch(source, /template-catalog-fixtures|streetlight-reaper-mcp|reaper\//i);
  });
});

function cleanupReportArtifact() {
  return createArtifactRef({
    owner_pack: "project",
    scope: "cleanup_report",
    id: "art_20260703000000000_031_ab12cd",
    schema: "project.cleanup_report.v1",
    summary: {
      schema: "project.cleanup_report.v1",
      template_id: "template.project.create_cleanup_report",
      report_row_count: 8,
      truncated: false,
    },
  });
}

function limitedReportInput(overrides = {}) {
  return {
    max_report_rows: 32,
    marker_region_limit: 64,
    tempo_marker_limit: 32,
    include_markers: true,
    include_regions: true,
    include_metadata: true,
    include_tempo: true,
    include_project_fingerprint: true,
    ...overrides,
  };
}

function projectRef() {
  return createObjectRef("project", { scheme: "current", value: "current" });
}

function context(overrides = {}) {
  return {
    session_id: "session-critical-project-report",
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
