import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  FakeFoundationBridge,
  createArtifactRef,
  createObjectRef,
} from "../../packages/core/src/foundation-bridge-v1.mjs";
import {
  TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS,
  validateTemplateDescriptor,
} from "../../packages/core/src/template-descriptor-v1.mjs";
import {
  TEMPLATE_CATALOG_CONTRACT,
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
  validateTemplateCatalog,
} from "../../packages/core/src/template-catalog-v1.mjs";
import {
  WAVE1A_ANALYSIS_TEMPLATE_IDS,
  createWave1AAnalysisTemplates,
} from "../../packages/core/src/template-packs/wave1a-analysis-templates-v1.mjs";
import {
  buildTemplateBridgeRequest,
  executeTemplate,
} from "../../packages/core/src/template-execution-harness-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const ALLOWLIST = Object.freeze([
  "template.analysis.measure_item_rms",
  "template.analysis.measure_item_peaks",
  "template.analysis.detect_item_silence",
  "template.analysis.detect_item_transients",
]);

const BLOCKED_WAVE1A_IDS = Object.freeze([
  "template.analysis.summarize_selected_audio_items",
  "template.analysis.measure_item_audio_basics",
  "template.analysis.measure_item_lufs",
  "template.analysis.measure_item_loudness_rms",
  "template.analysis.find_item_loop_candidates",
  "template.analysis.score_loop_boundary_click_risk",
]);

describe("Wave 1A analysis template descriptors", () => {
  it("implements exactly the approved analysis allowlist", () => {
    const templates = createWave1AAnalysisTemplates();
    const ids = templates.map((descriptor) => descriptor.id);

    assert.deepEqual(WAVE1A_ANALYSIS_TEMPLATE_IDS, ALLOWLIST);
    assert.deepEqual(ids, ALLOWLIST);
    for (const blockedId of BLOCKED_WAVE1A_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("validates every descriptor through the frozen 4A descriptor ABI", () => {
    for (const descriptor of createWave1AAnalysisTemplates()) {
      const result = validateTemplateDescriptor(descriptor);

      assert.deepEqual(result.errors, [], descriptor.id);
      assert.equal(result.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "analysis");
      assert.equal(descriptor.risk, "read");
      assert.equal(descriptor.bridge.operation_family, "run_job");
      assert.equal(descriptor.bridge.idempotency, "none");
      assert.equal(descriptor.refs.input.length, 1);
      assert.equal(descriptor.refs.input[0].kind, "item");
      assert.equal(descriptor.refs.output[0].kind, "artifact");
      assert.equal(descriptor.artifacts.mode, "produces");
      assert.equal(descriptor.expectedDelta.kind, "artifact");
      assert.equal(descriptor.expectedDelta.entities[0].action, "emit");
      assert.equal(descriptor.verification.mode, "none");
      assert.equal(descriptor.examples.length > 0, true);
    }
  });

  it("publishes native measurement evidence and only the bounded inputs each analyzer actually uses", () => {
    const byId = new Map(createWave1AAnalysisTemplates().map((descriptor) => [descriptor.id, descriptor]));
    const rms = byId.get("template.analysis.measure_item_rms");
    const peaks = byId.get("template.analysis.measure_item_peaks");
    const silence = byId.get("template.analysis.detect_item_silence");
    const transients = byId.get("template.analysis.detect_item_transients");

    assert.deepEqual(Object.keys(rms.inputSchema.properties), [
      "start_seconds",
      "end_seconds",
      "max_analysis_seconds",
    ]);
    assert.equal(rms.outputSchema.properties.lufs_i.type, "number");
    assert.equal(rms.outputSchema.properties.measurement_basis.type, "string");
    assert.equal(rms.outputSchema.properties.coverage.type, "object");

    assert.deepEqual(Object.keys(peaks.inputSchema.properties), [
      "start_seconds",
      "end_seconds",
      "max_analysis_seconds",
    ]);
    assert.equal(peaks.outputSchema.properties.true_peak_available.type, "boolean");
    assert.equal(peaks.outputSchema.properties.per_channel.type, "array");

    assert.deepEqual(Object.keys(silence.inputSchema.properties), [
      "start_seconds",
      "end_seconds",
      "max_analysis_seconds",
      "silence_threshold_dbfs",
      "min_silence_ms",
      "max_segments",
    ]);
    assert.equal(silence.outputSchema.properties.total_detected.type, "integer");
    assert.equal(silence.outputSchema.properties.returned_count.type, "integer");

    assert.deepEqual(Object.keys(transients.inputSchema.properties), [
      "start_seconds",
      "end_seconds",
      "max_analysis_seconds",
      "transient_delta_linear",
      "min_transient_gap_ms",
      "max_transients",
    ]);
    assert.equal(transients.outputSchema.properties.transient_delta_linear.type, "number");
  });

  it("loads in a pack-local catalog, rejects duplicates, and keeps discovery bounded", () => {
    const templates = createWave1AAnalysisTemplates();
    const validation = validateTemplateCatalog({ templates });
    const catalog = createTemplateCatalog({ templates });

    assert.deepEqual(validation.errors, []);
    assert.equal(validation.ok, true);
    assert.equal(catalog.contract, TEMPLATE_CATALOG_CONTRACT);
    assert.equal(catalog.size, ALLOWLIST.length);
    assert.deepEqual(catalog.ids, ALLOWLIST);

    assert.throws(
      () => createTemplateCatalog({ templates: [templates[0], templates[0]] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.analysis\.measure_item_rms/.test(error.errors.join("\n")),
    );

    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "analysis" });
    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, ALLOWLIST.length);
    assert.equal(JSON.stringify(menu).length < 4096, true);

    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }
    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS]);
    }
  });

  it("supports exact id expansion with Layer 1.5 detail fields only", () => {
    const catalog = createTemplateCatalog({ templates: createWave1AAnalysisTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const response = discovery.list_templates({
      ids: [ALLOWLIST[0], "template.analysis.missing"],
      fields: ["summary", "inputSchema", "examples", "expectedDelta"],
    });

    assert.equal(response.mode, "ids");
    assert.deepEqual(response.missing_ids, ["template.analysis.missing"]);
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

  it("builds legal 4B bridge requests for analysis artifacts without undo or idempotency", () => {
    const item = createObjectRef("item", { scheme: "guid", value: "{ITEM-ANALYSIS}" });

    for (const [index, descriptor] of createWave1AAnalysisTemplates().entries()) {
      const request = buildTemplateBridgeRequest({
        descriptor,
        input: index === 0 ? { start_seconds: 0, end_seconds: 1.25 } : {},
        refs: { item_ref: item },
        context: context({ request_sequence: index + 1 }),
      });

      assert.equal(request.operation.family, "run_job", descriptor.id);
      assert.equal(request.pack.id, "analysis", descriptor.id);
      assert.equal(request.pack.risk, "read", descriptor.id);
      assert.equal(request.artifacts.allow, true, descriptor.id);
      assert.equal(request.undo.mode, "none", descriptor.id);
      assert.equal(request.verification.mode, "none", descriptor.id);
      assert.equal("idempotency_key" in request, false, descriptor.id);
      assert.deepEqual(request.refs, [item], descriptor.id);
    }
  });

  it("runs 4B fake execution smoke for each descriptor and returns artifact refs only", async () => {
    const item = createObjectRef("item", { scheme: "guid", value: "{ITEM-SMOKE}" });

    for (const [index, descriptor] of createWave1AAnalysisTemplates().entries()) {
      const artifact = analysisArtifactForDescriptor(descriptor, index + 1);
      const bridge = new FakeFoundationBridge();
      const result = await executeTemplate({
        descriptor,
        input: {},
        refs: { item_ref: item },
        context: context({ request_sequence: index + 1 }),
        executor: (request) =>
          bridge.okEnvelope(request, "2026-07-02T00:00:00.000Z", {
            summary: {
              operation: request.operation.name,
              schema: artifact.summary.schema,
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

      assert.equal(result.ok, true, descriptor.id);
      assert.equal(result.template.id, descriptor.id);
      assert.equal(result.undo.mode, "none", descriptor.id);
      assert.equal(result.result.artifacts.length, 1, descriptor.id);
      assert.equal(result.result.artifacts[0].kind, "artifact", descriptor.id);
      assert.equal(result.result.artifacts[0].summary.schema, descriptor.artifacts.output[0].schema);
      assert.deepEqual(result.result.jobs, [], descriptor.id);
      assert.deepEqual(result.result.refs, [], descriptor.id);
      assert.equal(result.result.last_result.updated, false, descriptor.id);
      assert.doesNotMatch(JSON.stringify(result), /payload|events|segments/);
    }
  });

  it("keeps blocked analysis candidates and runtime surfaces out of the pack file", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave1a-analysis-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    for (const blockedId of BLOCKED_WAVE1A_IDS) {
      assert.doesNotMatch(source, new RegExp(escapeRegExp(blockedId)));
    }
    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /\brecipe\b/i);
  });

  it("rejects undeclared inputs and missing item refs before fake dispatch", async () => {
    const descriptor = createWave1AAnalysisTemplates()[0];
    const bridge = new FakeFoundationBridge();
    const invalidInput = await executeTemplate({
      descriptor,
      input: { features: ["loudness"] },
      refs: { item_ref: createObjectRef("item", { scheme: "guid", value: "{ITEM-INVALID}" }) },
      context: context(),
      executor: bridge,
    });

    assert.equal(invalidInput.ok, false);
    assert.equal(invalidInput.error.source, "harness");
    assert.equal(invalidInput.error.code, "TEMPLATE_INPUT_INVALID");
    assert.equal(bridge.seen.length, 0);

    const missingRef = await executeTemplate({
      descriptor,
      input: {},
      refs: {},
      context: context(),
      executor: bridge,
    });

    assert.equal(missingRef.ok, false);
    assert.equal(missingRef.error.source, "harness");
    assert.equal(missingRef.error.code, "TEMPLATE_REFS_INVALID");
    assert.equal(bridge.seen.length, 0);
  });
});

function analysisArtifactForDescriptor(descriptor, index) {
  const schema = descriptor.artifacts.output[0].schema;
  const scope = schema.split(".")[1];
  return createArtifactRef({
    owner_pack: "analysis",
    scope,
    id: `art_20260702000000000_${String(index).padStart(3, "0")}_${String(index).padStart(6, "0")}`,
    schema,
    summary: {
      template_id: descriptor.id,
    },
  });
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

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
