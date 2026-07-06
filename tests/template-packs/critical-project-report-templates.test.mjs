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
  "template.project.create_project_map_snapshot",
]);

const BLOCKED_PROJECT_REPORT_IDS = Object.freeze([
  "template.project.create_cleanup_plan",
  "template.project.apply_cleanup_plan",
  "template.project.execute_cleanup",
  "template.project.delete_empty_tracks",
  "template.project.cleanup_items",
  "template.cleanup.create_cleanup_report",
]);

describe("Critical project report template descriptors", () => {
  it("exports exactly the project report descriptor allowlist", () => {
    const templates = createCriticalProjectReportTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_PROJECT_REPORT_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_PROJECT_REPORT_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as project-owned read-risk artifact producers", () => {
    const templates = createCriticalProjectReportTemplates();
    for (const descriptor of templates) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "project", descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.risk, "read", descriptor.id);
      assert.equal(descriptor.bridge.operation_family, "run_job", descriptor.id);
      assert.equal(descriptor.bridge.idempotency, "none", descriptor.id);
      assert.equal(descriptor.artifacts.mode, "produces", descriptor.id);
      assert.equal(descriptor.artifacts.input.length, 0, descriptor.id);
      assert.deepEqual(descriptor.refs.output.map((entry) => [entry.name, entry.kind, entry.required]), [
        ["artifact_ref", "artifact", true],
      ], descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "artifact", descriptor.id);
      assert.deepEqual(descriptor.expectedDelta.entities.map((entry) => entry.action), ["emit"], descriptor.id);
      assert.equal(descriptor.verification.mode, "none", descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }

    const cleanup = templates[0];
    assert.equal(cleanup.id, "template.project.create_cleanup_report");
    assert.equal(cleanup.entity_kind, "cleanup_report");
    assert.equal(cleanup.bridge.operation_name, "project.create_cleanup_report");
    assert.equal(cleanup.bridge.capability, "project.create_cleanup_report");
    assert.deepEqual(cleanup.artifacts.output, [
      {
        name: "cleanup_report",
        schema: "project.cleanup_report.v1",
        owner_pack: "project",
        summary: "Bounded project cleanup report artifact.",
      },
    ]);
    assert.deepEqual(cleanup.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["project_ref", "project", false],
    ]);

    const snapshot = templates[1];
    assert.equal(snapshot.id, "template.project.create_project_map_snapshot");
    assert.equal(snapshot.entity_kind, "project_snapshot");
    assert.equal(snapshot.bridge.operation_name, "project.create_project_map_snapshot");
    assert.equal(snapshot.bridge.capability, "project.create_project_map_snapshot");
    assert.deepEqual(snapshot.artifacts.output, [
      {
        name: "project_map_snapshot",
        schema: "project.project_map_snapshot.v1",
        owner_pack: "project",
        summary: "Artifact-backed project map page with compact coverage and diff facts.",
      },
    ]);
    assert.deepEqual(snapshot.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["project_ref", "project", false],
      ["previous_snapshot_ref", "artifact", false],
    ]);
  });

  it("keeps cleanup report shape unchanged", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_cleanup_report");

    assert.equal(descriptor.id, "template.project.create_cleanup_report");
    assert.equal(descriptor.entity_kind, "cleanup_report");
    assert.equal(descriptor.bridge.operation_name, "project.create_cleanup_report");
    assert.equal(descriptor.bridge.capability, "project.create_cleanup_report");

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

  it("adds a large-project map snapshot artifact shape without inline project payload", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_project_map_snapshot");

    assert.deepEqual(Object.keys(descriptor.inputSchema.properties), [
      "max_tracks",
      "max_items_per_track",
      "max_selected_items",
      "track_cursor",
      "include_selected_items",
      "include_track_items",
      "previous_snapshot_ref",
    ]);
    assert.deepEqual(descriptor.inputSchema.required, []);
    assert.deepEqual(Object.keys(descriptor.outputSchema.properties), [
      "artifact_ref",
      "schema",
      "project_ref",
      "track_count",
      "item_count",
      "track_cursor",
      "returned_track_count",
      "next_track_cursor",
      "selected_count",
      "snapshot_token",
      "coverage_status",
      "diff_compared",
      "diff_changed_count",
      "truncated",
      "bytes",
    ]);
    assert.deepEqual(descriptor.outputSchema.required, [
      "artifact_ref",
      "schema",
      "project_ref",
      "track_count",
      "item_count",
      "track_cursor",
      "returned_track_count",
      "selected_count",
      "snapshot_token",
      "coverage_status",
      "diff_compared",
      "diff_changed_count",
      "truncated",
    ]);
    assert.equal(Object.hasOwn(descriptor.outputSchema.properties, "tracks"), false);
    assert.equal(Object.hasOwn(descriptor.outputSchema.properties, "selected_items"), false);
    assert.equal(JSON.stringify(descriptor).includes("raw_lua"), false);
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
      ids: [
        "template.project.create_cleanup_report",
        "template.project.create_project_map_snapshot",
        "template.project.create_cleanup_plan",
      ],
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
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_cleanup_report");
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
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_cleanup_report");
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

  it("runs 4B fake smoke for a project map snapshot artifact with concise summary", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_project_map_snapshot");
    const artifact = projectMapSnapshotArtifact();
    const bridge = new FakeFoundationBridge();
    const result = await executeTemplate({
      descriptor,
      input: projectMapSnapshotInput(),
      refs: { project_ref: projectRef() },
      context: context(),
      executor: (request) =>
        bridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
          summary: {
            artifact_ref: artifact.ref,
            schema: "project.project_map_snapshot.v1",
            project_ref: "project:current",
            track_count: 48,
            item_count: 320,
            track_cursor: 0,
            returned_track_count: 16,
            next_track_cursor: "16",
            selected_count: 2,
            snapshot_token: "tracks:48|items:320|cursor:0|returned:16",
            coverage_status: "paged_partial",
            diff_compared: false,
            diff_changed_count: 0,
            truncated: true,
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
    assert.equal(result.template.id, "template.project.create_project_map_snapshot");
    assert.deepEqual(result.result.refs.map((ref) => ref.ref), ["project:current"]);
    assert.equal(result.result.artifacts.length, 1);
    assert.equal(result.result.artifacts[0].kind, "artifact");
    assert.equal(result.result.artifacts[0].ref, "artifact:project:project_map_snapshot:art_20260703000000000_032_bc12ef");
    assert.equal(result.result.artifacts[0].summary.schema, "project.project_map_snapshot.v1");
    assert.equal(result.result.summary.returned_track_count, 16);
    assert.equal(result.result.summary.truncated, true);
    assert.equal(Buffer.byteLength(JSON.stringify(result.result.summary), "utf8") < 768, true);
    assert.doesNotMatch(JSON.stringify(result.result.summary), /"tracks"|"selected_items"|"payload"/);
  });

  it("rejects destructive cleanup and recipe-plan-shaped inputs before fake dispatch", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalProjectReportTemplates() })
      .require("template.project.create_cleanup_report");
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
    assert.equal(sharedIds.includes("template.project.create_project_map_snapshot"), true);
    assert.equal(sharedDescriptorIds.includes("template.project.create_project_map_snapshot"), true);
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

function projectMapSnapshotArtifact() {
  return createArtifactRef({
    owner_pack: "project",
    scope: "project_map_snapshot",
    id: "art_20260703000000000_032_bc12ef",
    schema: "project.project_map_snapshot.v1",
    summary: {
      schema: "project.project_map_snapshot.v1",
      template_id: "template.project.create_project_map_snapshot",
      track_count: 48,
      item_count: 320,
      truncated: true,
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

function projectMapSnapshotInput(overrides = {}) {
  return {
    max_tracks: 16,
    max_items_per_track: 2,
    max_selected_items: 8,
    track_cursor: 0,
    include_selected_items: true,
    include_track_items: true,
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
