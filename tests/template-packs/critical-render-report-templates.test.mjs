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
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  CRITICAL_RENDER_REPORT_TEMPLATE_IDS,
  createCriticalRenderReportTemplates,
} from "../../packages/core/src/template-packs/critical-render-report-templates-v1.mjs";
import { createCriticalRenderTemplates } from "../../packages/core/src/template-packs/critical-render-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.render.create_delivery_report",
]);

const BLOCKED_RENDER_REPORT_IDS = Object.freeze([
  "template.delivery.create_report",
  "template.render.create_delivery_plan",
  "template.render.apply_delivery_plan",
  "template.render.upload_delivery",
  "template.render.publish_delivery",
  "template.render.external_delivery",
]);

describe("Critical render report template descriptors", () => {
  it("exports exactly the R3-C render report descriptor allowlist", () => {
    const templates = createCriticalRenderReportTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_RENDER_REPORT_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_RENDER_REPORT_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("validates as a render-owned read-risk report artifact producer", () => {
    const [descriptor] = createCriticalRenderReportTemplates();
    const validation = validateTemplateDescriptor(descriptor);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(descriptor.pack, "render");
    assert.equal(descriptor.id, "template.render.create_delivery_report");
    assert.equal(descriptor.lifecycle, "experimental");
    assert.equal(descriptor.risk, "read");
    assert.equal(descriptor.entity_kind, "delivery_report");
    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.operation_name, "render.delivery_report.create");
    assert.equal(descriptor.bridge.capability, "render.delivery_report.create");
    assert.equal(descriptor.bridge.idempotency, "none");
    assert.equal(descriptor.artifacts.mode, "produces");
    assert.equal(descriptor.artifacts.output[0].schema, "render.delivery_report.v1");
    assert.equal(descriptor.artifacts.output[0].owner_pack, "render");
    assert.equal(descriptor.expectedDelta.kind, "artifact");
    assert.equal(descriptor.expectedDelta.entities[0].action, "emit");
    assert.equal(descriptor.verification.mode, "none");
    assert.equal(
      Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
      true,
    );
  });

  it("declares only render evidence refs and report artifacts, with no plan or external action surface", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalRenderReportTemplates() });
    const descriptor = catalog.require("template.render.create_delivery_report");

    assert.deepEqual(descriptor.refs.input.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["output_artifact_refs", "artifact", true],
      ["render_job_evidence_ref", "artifact", true],
      ["region_ref", "region", false],
      ["job_ref", "job", false],
    ]);
    assert.deepEqual(descriptor.refs.output.map((entry) => [entry.name, entry.kind, entry.required]), [
      ["artifact_ref", "artifact", true],
    ]);
    assert.deepEqual(descriptor.artifacts.input.map((entry) => entry.schema), [
      "render.region_wav_output.v1",
      "render.render_job_evidence.v1",
    ]);
    assert.deepEqual(descriptor.artifacts.output.map((entry) => entry.schema), [
      "render.delivery_report.v1",
    ]);
    assert.deepEqual(Object.keys(descriptor.inputSchema.properties), [
      "max_report_rows",
      "include_output_metadata",
      "include_job_evidence",
      "include_region_summary",
    ]);

    const descriptorPayload = JSON.stringify(descriptor);
    assert.doesNotMatch(descriptorPayload, /delivery_plan|apply_plan|checklist|upload|publish|release/i);
    assert.doesNotMatch(descriptorPayload, /shell|raw_lua|raw_action|output_path|absolute_path|relative_path|file:\/\//i);
  });

  it("loads as a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createCriticalRenderReportTemplates();
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
        /Duplicate template id: template\.render\.create_delivery_report/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "render" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal("total" in menu.page, false);
    assert.equal(Buffer.byteLength(JSON.stringify(menu), "utf8") < 4096, true);

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
      assert.equal(
        Buffer.byteLength(JSON.stringify(item), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.discovery_summary_max_bytes,
        true,
      );
    }
  });

  it("supports exact id lookup with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalRenderReportTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const exact = discovery.list_templates({
      ids: ["template.render.create_delivery_report", "template.render.missing_delivery_report"],
      fields: ["summary", "input_schema", "outputSchema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.render.missing_delivery_report"]);
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

  it("builds a legal 4B read-risk report request without undo or idempotency", () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderReportTemplates() }).require(
      "template.render.create_delivery_report",
    );
    const request = buildTemplateBridgeRequest({
      descriptor,
      input: reportInput(),
      refs: reportRefs(),
      context: context(),
    });

    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "render.delivery_report.create");
    assert.equal(request.pack.id, "render");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.pack.capability, "render.delivery_report.create");
    assert.equal(request.undo.mode, "none");
    assert.equal(request.verification.mode, "none");
    assert.equal(request.artifacts.allow, true);
    assert.equal("idempotency_key" in request, false);
    assert.deepEqual(request.refs.map((entry) => entry.kind), [
      "artifact",
      "artifact",
      "artifact",
      "region",
      "job",
    ]);
    assert.equal(Object.hasOwn(request.params, "delivery_plan_ref"), false);
    assert.equal(Object.hasOwn(request.params, "upload_url"), false);
    assert.equal(Object.hasOwn(request.params, "shell_command"), false);
  });

  it("fake-smokes the report producer and returns only a report artifact ref plus bounded summary", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderReportTemplates() }).require(
      "template.render.create_delivery_report",
    );
    const bridge = new FakeRenderDeliveryReportBridge();
    const result = await executeTemplate({
      descriptor,
      input: reportInput(),
      refs: reportRefs(),
      context: context(),
      executor: bridge,
    });

    assert.equal(result.ok, true);
    assert.equal(result.template.id, "template.render.create_delivery_report");
    assert.equal(result.template.pack, "render");
    assert.equal(result.template.risk, "read");
    assert.equal(result.result.artifacts.length, 1);
    assert.equal(result.result.artifacts[0].kind, "artifact");
    assert.equal(result.result.artifacts[0].summary.schema, "render.delivery_report.v1");
    assert.deepEqual(result.result.refs, []);
    assert.deepEqual(result.result.jobs, []);
    assert.equal(result.result.last_result.updated, false);
    assert.equal(result.undo.mode, "none");
    assert.equal(result.verification.status, "passed");
    assert.equal(Buffer.byteLength(JSON.stringify(result.result.summary), "utf8") < 512, true);
    assert.doesNotMatch(
      JSON.stringify(result),
      /payload|report_body|report_rows|markdown|html|file_contents|upload|publish|shell|raw_lua|output_path/i,
    );
    assert.equal(bridge.seen.length, 1);
  });

  it("rejects delivery plans, external delivery fields, shell fields, and missing evidence refs", async () => {
    const descriptor = createTemplateCatalog({ templates: createCriticalRenderReportTemplates() }).require(
      "template.render.create_delivery_report",
    );
    const bridge = new FakeRenderDeliveryReportBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: {
        ...reportInput(),
        delivery_plan_ref: "artifact:render:delivery_plan:art_20260703000000000_999_abcdef",
        upload_url: "https://example.invalid/upload",
        shell_command: "open /tmp/out.wav",
        output_path: "../escape.wav",
      },
      refs: reportRefs(),
      context: context(),
      executor: bridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const missingRefs = await executeTemplate({
      descriptor,
      input: reportInput(),
      refs: {
        output_artifact_refs: [renderOutputArtifactRef(1)],
      },
      context: context({ request_sequence: 2 }),
      executor: bridge,
    });

    assert.equal(missingRefs.ok, false);
    assert.equal(missingRefs.error.source, "harness");
    assert.equal(missingRefs.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("is wired into the shared accepted catalog as a critical-fill descriptor", () => {
    const sharedAcceptedIds = new Set([
      ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
    ]);
    const sharedCatalogSource = readFileSync(
      new URL("../../packages/core/src/template-catalog-fixtures-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.equal(sharedAcceptedIds.has("template.render.create_delivery_report"), true);
    assert.match(sharedCatalogSource, /critical-render-report-templates-v1/);
    assert.match(sharedCatalogSource, /createCriticalRenderReportTemplates/);
  });

  it("keeps the accepted R1 render descriptor valid and unchanged in its own pack-local source", () => {
    const [descriptor] = createCriticalRenderTemplates();
    const validation = validateTemplateDescriptor(descriptor);

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(descriptor.id, "template.render.render_region_wav");
    assert.equal(descriptor.pack, "render");
    assert.equal(descriptor.risk, "write");
    assert.equal(descriptor.bridge.operation_family, "run_job");
    assert.equal(descriptor.bridge.idempotency, "required");
    assert.equal(descriptor.artifacts.output[0].schema, "render.region_wav_output.v1");
  });

  it("keeps pack-local source static: no runtime, recipe, upload, shell, raw execution, or path escape", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/critical-render-report-templates-v1.mjs", import.meta.url),
      "utf8",
    );
    const descriptorSource = source.replace(/^import .*$/gm, "");

    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
    assert.doesNotMatch(source, /delivery_plan|apply_plan|checklist/i);
    assert.doesNotMatch(source, /upload|publish|release|http:\/\/|https:\/\/|s3:|ftp:/i);
    assert.doesNotMatch(source, /run_action|run_command|template\.execute/);
    assert.doesNotMatch(source, /raw_lua|raw_action|shell|process\./);
    assert.doesNotMatch(source, /output_path|output_directory|absolute_path|relative_path|file:\/\//);
    assert.doesNotMatch(descriptorSource, /\.\.\//);
  });
});

class FakeRenderDeliveryReportBridge extends FakeFoundationBridge {
  execute(request, startedAt) {
    assert.equal(request.operation.family, "run_job");
    assert.equal(request.operation.name, "render.delivery_report.create");
    assert.equal(request.pack.id, "render");
    assert.equal(request.pack.risk, "read");
    assert.equal(request.params.max_report_rows, 12);
    assert.equal(Object.hasOwn(request.params, "delivery_plan_ref"), false);
    assert.equal(Object.hasOwn(request.params, "upload_url"), false);
    assert.equal(Object.hasOwn(request.params, "output_path"), false);

    const artifacts = request.refs.filter((entry) => entry.kind === "artifact");
    assert.equal(artifacts.length, 3);
    const report = createArtifactRef({
      owner_pack: "render",
      scope: "delivery_report",
      id: "art_20260703000000000_301_abcdef",
      schema: "render.delivery_report.v1",
      summary: {
        schema: "render.delivery_report.v1",
        output_artifact_count: 2,
        issue_count: 0,
      },
    });

    return this.okEnvelope(request, startedAt, {
      summary: {
        schema: "render.delivery_report.v1",
        output_artifact_count: 2,
        job_evidence_count: 1,
        region_count: 1,
        nonempty_output_count: 2,
        report_row_count: 2,
        issue_count: 0,
        truncated: false,
      },
      refs: [],
      artifacts: [report],
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
    max_report_rows: 12,
    include_output_metadata: true,
    include_job_evidence: true,
    include_region_summary: true,
    ...overrides,
  };
}

function reportRefs() {
  return {
    output_artifact_refs: [renderOutputArtifactRef(1), renderOutputArtifactRef(2)],
    render_job_evidence_ref: renderJobEvidenceArtifactRef(),
    region_ref: createObjectRef("region", { scheme: "guid", value: "{REGION-DELIVERY}" }),
    job_ref: createObjectRef("job", { scheme: "job_id", value: "render.region_wav.1" }),
  };
}

function renderOutputArtifactRef(index) {
  return createArtifactRef({
    owner_pack: "render",
    scope: "region_wav_output",
    id: `art_20260703000000000_${String(index).padStart(3, "0")}_${String(index).padStart(6, "0")}`,
    schema: "render.region_wav_output.v1",
    summary: {
      schema: "render.region_wav_output.v1",
      format: "wav",
      nonempty: true,
    },
  });
}

function renderJobEvidenceArtifactRef() {
  return createArtifactRef({
    owner_pack: "render",
    scope: "render_job_evidence",
    id: "art_20260703000000000_201_abcdef",
    schema: "render.render_job_evidence.v1",
    summary: {
      schema: "render.render_job_evidence.v1",
      job_state: "completed",
      verification: "passed",
    },
  });
}

function context(overrides = {}) {
  return {
    session_id: "session-render-report",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
