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
  TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
  TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
  TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
} from "../../packages/core/src/template-catalog-fixtures-v1.mjs";
import {
  CRITICAL_ANALYSIS_TEMPLATE_IDS,
  createCriticalAnalysisTemplates,
} from "../../packages/core/src/template-packs/critical-analysis-templates-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.analysis.detect_loop_candidates",
  "template.analysis.measure_loop_click_risk",
  "template.analysis.create_loop_qa_report",
]);

const BLOCKED_ANALYSIS_IDS = Object.freeze([
  "template.analysis.find_item_loop_candidates",
  "template.analysis.score_loop_boundary_click_risk",
  "template.analysis.choose_loop_candidate",
  "template.analysis.retry_loop_candidate",
  "template.analysis.seamless_loop_factory",
]);

describe("Critical analysis template descriptors", () => {
  it("exports exactly the R2 critical analysis descriptor allowlist", () => {
    const ids = createCriticalAnalysisTemplates().map((descriptor) => descriptor.id);

    assert.deepEqual(CRITICAL_ANALYSIS_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    assert.equal(new Set(ids).size, ALLOWLIST.length);
    for (const blockedId of BLOCKED_ANALYSIS_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("passes Layer 4A validation as read-risk analysis run_job artifact producers", () => {
    for (const descriptor of createCriticalAnalysisTemplates()) {
      const validation = validateTemplateDescriptor(descriptor);

      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "analysis", descriptor.id);
      assert.equal(descriptor.id.startsWith("template.analysis."), true, descriptor.id);
      assert.equal(descriptor.lifecycle, "experimental", descriptor.id);
      assert.equal(descriptor.risk, "read", descriptor.id);
      assert.equal(descriptor.bridge.operation_family, "run_job", descriptor.id);
      assert.equal(descriptor.bridge.idempotency, "none", descriptor.id);
      assert.equal(descriptor.artifacts.mode, "produces", descriptor.id);
      assert.equal(descriptor.artifacts.output.length, 1, descriptor.id);
      assert.equal(descriptor.artifacts.output[0].owner_pack, "analysis", descriptor.id);
      assert.equal(descriptor.refs.output[0].kind, "artifact", descriptor.id);
      assert.equal(descriptor.expectedDelta.kind, "artifact", descriptor.id);
      assert.equal(descriptor.expectedDelta.entities[0].action, "emit", descriptor.id);
      assert.equal(descriptor.verification.mode, "none", descriptor.id);
      assert.equal(
        Buffer.byteLength(JSON.stringify(descriptor), "utf8") <= TEMPLATE_DESCRIPTOR_BUDGETS.descriptor_max_bytes,
        true,
        descriptor.id,
      );
    }
  });

  it("declares the narrow artifact chain after catalog merger", () => {
    const catalog = createTemplateCatalog({ templates: createCriticalAnalysisTemplates() });
    const sharedAcceptedIds = new Set([
      ...TEMPLATE_CATALOG_WAVE1A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE2A_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_WAVE3B_TEMPLATE_IDS,
      ...TEMPLATE_CATALOG_CRITICAL_FILL_TEMPLATE_IDS,
    ]);
    const candidates = catalog.require("template.analysis.detect_loop_candidates");
    const clickRisk = catalog.require("template.analysis.measure_loop_click_risk");
    const qaReport = catalog.require("template.analysis.create_loop_qa_report");

    for (const id of ALLOWLIST) {
      assert.equal(sharedAcceptedIds.has(id), true, id);
    }

    assert.deepEqual(candidates.artifacts.input, []);
    assert.equal(candidates.artifacts.output[0].schema, "analysis.loop_candidates.v1");
    assert.deepEqual(clickRisk.artifacts.input.map((entry) => entry.schema), [
      "analysis.loop_candidates.v1",
    ]);
    assert.equal(clickRisk.artifacts.output[0].schema, "analysis.loop_click_risk.v1");
    assert.deepEqual(qaReport.artifacts.input.map((entry) => entry.schema), [
      "analysis.loop_candidates.v1",
      "analysis.loop_click_risk.v1",
    ]);
    assert.equal(qaReport.artifacts.output[0].schema, "analysis.loop_qa_report.v1");
    assert.deepEqual(clickRisk.refs.input.map((entry) => entry.kind), ["item", "artifact"]);
    assert.deepEqual(qaReport.refs.input.map((entry) => entry.kind), ["artifact", "artifact"]);
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createCriticalAnalysisTemplates();
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
        /Duplicate template id: template\.analysis\.detect_loop_candidates/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "analysis" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(menu.page.has_more, false);
    assert.equal("total" in menu.page, false);
    assert.equal(JSON.stringify(menu).length < 4096, true);

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
    const catalog = createTemplateCatalog({ templates: createCriticalAnalysisTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const exact = discovery.list_templates({
      ids: [ALLOWLIST[2], "template.analysis.missing"],
      fields: ["summary", "inputSchema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.analysis.missing"]);
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

  it("builds legal 4B bridge requests for artifact analysis without undo or idempotency", () => {
    for (const [index, descriptor] of createCriticalAnalysisTemplates().entries()) {
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        refs: refsForDescriptor(descriptor),
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.operation.family, "run_job", descriptor.id);
      assert.equal(request.operation.name, descriptor.bridge.operation_name, descriptor.id);
      assert.equal(request.pack.id, "analysis", descriptor.id);
      assert.equal(request.pack.risk, "read", descriptor.id);
      assert.equal(request.artifacts.allow, true, descriptor.id);
      assert.equal(request.undo.mode, "none", descriptor.id);
      assert.equal(request.verification.mode, "none", descriptor.id);
      assert.equal("idempotency_key" in request, false, descriptor.id);
      assert.equal(request.refs.length, descriptor.refs.input.length, descriptor.id);
    }
  });

  it("runs 4B fake smoke for each descriptor and returns canonical artifact refs only", async () => {
    for (const [index, descriptor] of createCriticalAnalysisTemplates().entries()) {
      const artifact = analysisArtifactForDescriptor(descriptor, index + 1);
      const bridge = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor,
        input: cloneJson(descriptor.examples[0].input),
        refs: refsForDescriptor(descriptor),
        context: context({ request_sequence: index + 1 }),
        executor: (request) =>
          bridge.okEnvelope(request, "2026-07-03T00:00:00.000Z", {
            summary: boundedSummaryFor(descriptor),
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

      assert.equal(result.ok, true, descriptor.id);
      assert.equal(result.template.id, descriptor.id);
      assert.equal(result.template.pack, "analysis", descriptor.id);
      assert.equal(result.template.risk, "read", descriptor.id);
      assert.equal(result.result.artifacts.length, 1, descriptor.id);
      assert.equal(result.result.artifacts[0].kind, "artifact", descriptor.id);
      assert.match(
        result.result.artifacts[0].ref,
        /^artifact:analysis:[a-z][a-z0-9_]*:art_[0-9]{17}_[0-9]{3}_[a-f0-9]{6}$/,
        descriptor.id,
      );
      assert.equal(result.result.artifacts[0].summary.schema, descriptor.artifacts.output[0].schema);
      assert.deepEqual(result.result.refs, [], descriptor.id);
      assert.deepEqual(result.result.jobs, [], descriptor.id);
      assert.equal(result.result.last_result.updated, false, descriptor.id);
      assert.equal(Buffer.byteLength(JSON.stringify(result.result.summary), "utf8") < 512, true, descriptor.id);
      assert.doesNotMatch(
        JSON.stringify(result),
        /payload|candidate_windows|boundary_samples|waveform|sample_count|file_path/,
        descriptor.id,
      );
    }
  });

  it("rejects undeclared inputs and missing refs before fake dispatch", async () => {
    const catalog = createTemplateCatalog({ templates: createCriticalAnalysisTemplates() });
    const descriptor = catalog.require("template.analysis.measure_loop_click_risk");
    const bridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: { candidate_index: 0 },
      refs: refsForDescriptor(descriptor),
      context: context(),
      executor: bridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.match(invalidInput.error.details.errors.join("\n"), /candidate_index is not declared/);
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor,
      input: {},
      refs: { item_ref: itemRef() },
      context: context(),
      executor: bridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });

  it("keeps descriptor sources free of editing, rendering, selection, and runtime bypass surfaces", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/critical-analysis-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_ANALYSIS_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)), blockedId);
    }
    assert.doesNotMatch(source, /template\.loop\.|template\.cleanup\.|template\.delivery\.|template\.layer\./);
    assert.doesNotMatch(source, /trim_item|set_item_fades|split_item|move_item|take_loop_set/);
    assert.doesNotMatch(source, /render_region|render_project|output_path|file_path/);
    assert.doesNotMatch(source, /best_candidate|selected_candidate|candidate_index|retry_policy|loop_factory/);
    assert.doesNotMatch(source, /run_action|raw_lua|lua|child_process|spawn\(|execFile|shell|reaper\//i);
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
  });
});

function refsForDescriptor(descriptor) {
  const refs = {};
  for (const entry of descriptor.refs.input) {
    if (entry.name === "item_ref") refs[entry.name] = itemRef();
    if (entry.name === "candidate_artifact_ref") refs[entry.name] = candidateArtifactRef();
    if (entry.name === "click_risk_artifact_ref") refs[entry.name] = clickRiskArtifactRef();
  }
  return refs;
}

function itemRef() {
  return createObjectRef("item", { scheme: "guid", value: "{ITEM-LOOP-QA}" });
}

function candidateArtifactRef() {
  return createArtifactRef({
    owner_pack: "analysis",
    scope: "loop_candidates",
    id: "art_20260703000000000_101_abcdef",
    schema: "analysis.loop_candidates.v1",
    summary: { template_id: "template.analysis.detect_loop_candidates" },
  });
}

function clickRiskArtifactRef() {
  return createArtifactRef({
    owner_pack: "analysis",
    scope: "loop_click_risk",
    id: "art_20260703000000000_102_abcdef",
    schema: "analysis.loop_click_risk.v1",
    summary: { template_id: "template.analysis.measure_loop_click_risk" },
  });
}

function analysisArtifactForDescriptor(descriptor, index) {
  const schema = descriptor.artifacts.output[0].schema;
  const scope = schema.split(".")[1];
  return createArtifactRef({
    owner_pack: "analysis",
    scope,
    id: `art_20260703000000000_${String(index).padStart(3, "0")}_${String(index).padStart(6, "0")}`,
    schema,
    summary: {
      template_id: descriptor.id,
    },
  });
}

function boundedSummaryFor(descriptor) {
  if (descriptor.id === "template.analysis.detect_loop_candidates") {
    return {
      schema: "analysis.loop_candidates.v1",
      candidate_count: 3,
      analyzed_seconds: 8,
      truncated: false,
    };
  }
  if (descriptor.id === "template.analysis.measure_loop_click_risk") {
    return {
      schema: "analysis.loop_click_risk.v1",
      measured_candidate_count: 3,
      risk_fact_count: 6,
      truncated: false,
    };
  }
  return {
    schema: "analysis.loop_qa_report.v1",
    candidate_count: 3,
    risk_fact_count: 6,
    report_row_count: 3,
    truncated: false,
  };
}

function context(overrides = {}) {
  return {
    session_id: "session-test",
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
