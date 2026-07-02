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
  TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS,
  TemplateCatalogValidationError,
  createTemplateCatalog,
  createTemplateCatalogDiscovery,
} from "../../packages/core/src/template-catalog-v1.mjs";
import { executeTemplate } from "../../packages/core/src/template-execution-harness-v1.mjs";
import {
  WAVE1A_RENDER_TEMPLATE_IDS,
  createWave1aRenderTemplates,
} from "../../packages/core/src/template-packs/wave1a-render-templates-v1.mjs";
import { createDiscoveryCatalog } from "../../packages/mcp-server/src/discovery-menu-v1.mjs";

const APPROVED_RENDER_IDS = Object.freeze([
  "template.render.read_settings",
  "template.render.resolve_bounds",
  "template.render.preview_targets",
  "template.render.read_region_matrix",
  "template.render.output_file_metadata",
]);

const BLOCKED_RENDER_IDS = Object.freeze([
  "template.render.preflight_output_path",
  "template.render.render_region_wav",
  "template.render.render_region_job",
  "template.render.read_recent_stats",
  "template.render.render_source_section",
]);

describe("Wave 1A render template descriptors", () => {
  it("exports exactly the approved Wave 1A render allowlist", () => {
    const templates = createWave1aRenderTemplates();
    const ids = templates.map((descriptor) => descriptor.id).sort();

    assert.deepEqual(ids, [...APPROVED_RENDER_IDS].sort());
    assert.deepEqual(Object.values(WAVE1A_RENDER_TEMPLATE_IDS).sort(), [...APPROVED_RENDER_IDS].sort());
    for (const blockedId of BLOCKED_RENDER_IDS) {
      assert.equal(ids.includes(blockedId), false, blockedId);
    }
  });

  it("validates every descriptor through the frozen 4A descriptor ABI", () => {
    const templates = createWave1aRenderTemplates();
    const catalog = createTemplateCatalog({ templates });

    assert.equal(catalog.size, APPROVED_RENDER_IDS.length);
    for (const descriptor of catalog.list()) {
      const validation = validateTemplateDescriptor(descriptor);
      assert.deepEqual(validation.errors, [], descriptor.id);
      assert.equal(validation.ok, true, descriptor.id);
      assert.equal(descriptor.pack, "render");
      assert.equal(descriptor.risk, "read");
      assert.equal(descriptor.lifecycle, "experimental");
      assert.equal(descriptor.bridge.idempotency, "none");
      assert.equal(descriptor.verification.mode, "none");
      assert.equal(descriptor.expectedDelta.idempotent, true);
      assert.notEqual(descriptor.id, "template.render.preflight_output_path");
      assert.notEqual(descriptor.id, "template.render.render_region_wav");
    }
  });

  it("keeps render ownership narrow for cross-domain refs and artifact metadata", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aRenderTemplates() });
    const resolveBounds = catalog.require(WAVE1A_RENDER_TEMPLATE_IDS.resolveBounds);
    const readMatrix = catalog.require(WAVE1A_RENDER_TEMPLATE_IDS.readRegionMatrix);
    const outputMetadata = catalog.require(WAVE1A_RENDER_TEMPLATE_IDS.outputFileMetadata);

    assert.equal(resolveBounds.refs.input[0].kind, "region");
    assert.equal(resolveBounds.refs.input[0].required, false);
    assert.equal(readMatrix.refs.input[0].kind, "region");
    assert.equal(readMatrix.refs.input[0].required, true);
    assert.equal(outputMetadata.bridge.operation_family, "artifact_metadata");
    assert.equal(outputMetadata.refs.input[0].kind, "artifact");
    assert.equal(outputMetadata.refs.input[0].required, true);
    assert.equal(outputMetadata.artifacts.mode, "metadata");
    assert.equal(outputMetadata.artifacts.input[0].owner_pack, "render");
    assert.equal(outputMetadata.refs.input.some((entry) => entry.kind === "file"), false);
  });

  it("rejects duplicate ids in the pack-local catalog", () => {
    const first = createWave1aRenderTemplates()[0];
    const duplicate = createWave1aRenderTemplates()[0];

    assert.throws(
      () => createTemplateCatalog({ templates: [first, duplicate] }),
      (error) =>
        error instanceof TemplateCatalogValidationError &&
        /Duplicate template id: template\.render\.read_settings/.test(error.errors.join("\n")),
    );
  });

  it("exposes bounded discovery summaries and exact id lookup without internal descriptor fields", () => {
    const catalog = createTemplateCatalog({ templates: createWave1aRenderTemplates() });
    const discovery = createTemplateCatalogDiscovery(catalog, createDiscoveryCatalog);
    const menu = discovery.list_templates({ pack: "render" });

    assert.equal(menu.contract, "discovery.menu.v1");
    assert.equal(menu.kind, "template_menu");
    assert.equal(menu.mode, "menu");
    assert.equal(menu.items.length, APPROVED_RENDER_IDS.length);
    assert.equal(menu.page.has_more, false);
    assert.equal(JSON.stringify(menu).length < 8_192, true);

    for (const item of menu.items) {
      assert.deepEqual(Object.keys(item).sort(), [...TEMPLATE_DESCRIPTOR_DISCOVERY_SUMMARY_FIELDS].sort());
    }
    const payload = JSON.stringify(menu);
    for (const field of TEMPLATE_CATALOG_DEFAULT_FORBIDDEN_DISCOVERY_FIELDS) {
      assert.doesNotMatch(payload, new RegExp(field));
    }

    const exact = discovery.list_templates({
      ids: [WAVE1A_RENDER_TEMPLATE_IDS.resolveBounds, "template.render.missing"],
      fields: ["summary", "input_schema", "output_schema", "examples", "expectedDelta"],
    });

    assert.equal(exact.mode, "ids");
    assert.deepEqual(exact.missing_ids, ["template.render.missing"]);
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

  it("runs Layer 4B fake execution smoke for each render descriptor", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1aRenderTemplates() });
    const bridge = new FakeFoundationBridge();
    const region = createObjectRef("region", { scheme: "guid", value: "{REGION-CHORUS}" });
    const artifact = createArtifactRef({
      owner_pack: "render",
      scope: "output_file",
      id: "art_20260703000000000_001_ab12cd",
      schema: "render.output_file_metadata.v1",
      summary: { path_shape: "render_output_file" },
    });

    const cases = [
      {
        id: WAVE1A_RENDER_TEMPLATE_IDS.readSettings,
        input: {},
        refs: {},
      },
      {
        id: WAVE1A_RENDER_TEMPLATE_IDS.resolveBounds,
        input: {
          bounds_kind: "custom",
          start_position_seconds: 1,
          end_position_seconds: 2,
          label: "One second",
        },
        refs: {},
      },
      {
        id: WAVE1A_RENDER_TEMPLATE_IDS.previewTargets,
        input: {
          bounds_kind: "current_settings",
          output_directory: "/Users/Shared/openreaper-renders",
          filename_pattern: "$region",
          max_targets: 8,
        },
        refs: {},
      },
      {
        id: WAVE1A_RENDER_TEMPLATE_IDS.readRegionMatrix,
        input: {
          include_master: true,
          include_channel_flags: true,
        },
        refs: { region_ref: region },
      },
      {
        id: WAVE1A_RENDER_TEMPLATE_IDS.outputFileMetadata,
        input: {
          include_wave_header: true,
          include_sidecar_presence: true,
        },
        refs: { output_artifact_ref: artifact },
      },
    ];

    for (const [index, testCase] of cases.entries()) {
      const result = await executeTemplate({
        descriptor: catalog.require(testCase.id),
        input: testCase.input,
        refs: testCase.refs,
        context: context({ request_sequence: index + 1 }),
        executor: bridge,
      });

      assert.equal(result.ok, true, testCase.id);
      assert.equal(result.template.id, testCase.id);
      assert.equal(result.template.pack, "render");
      assert.equal(result.template.risk, "read");
      assert.equal(result.undo.mode, "none");
      assert.equal(result.result.last_result.updated, false);
    }
  });

  it("keeps artifact metadata bounded and rejects missing required artifact refs", async () => {
    const catalog = createTemplateCatalog({ templates: createWave1aRenderTemplates() });
    const descriptor = catalog.require(WAVE1A_RENDER_TEMPLATE_IDS.outputFileMetadata);
    const artifact = createArtifactRef({
      owner_pack: "render",
      scope: "output_file",
      id: "art_20260703000000000_002_ab12ce",
      schema: "render.output_file_metadata.v1",
      summary: { files: 1 },
    });

    const ok = await executeTemplate({
      descriptor,
      input: {},
      refs: { output_artifact_ref: artifact },
      context: context(),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(ok.ok, true);
    assert.equal(ok.result.artifacts[0].kind, "artifact");
    assert.doesNotMatch(JSON.stringify(ok), /payload/);

    const missing = await executeTemplate({
      descriptor,
      input: {},
      refs: {},
      context: context({ request_sequence: 2 }),
      executor: new FakeFoundationBridge(),
    });
    assert.equal(missing.ok, false);
    assert.equal(missing.error.source, "harness");
    assert.equal(missing.error.code, "TEMPLATE_REFS_INVALID");
  });

  it("keeps pack-local source static: no runtime, recipes, legacy migration, or held render jobs", () => {
    const source = readFileSync(
      new URL("../../packages/core/src/template-packs/wave1a-render-templates-v1.mjs", import.meta.url),
      "utf8",
    );

    assert.doesNotMatch(source, /streetlight-reaper-mcp/);
    assert.doesNotMatch(source, /\blegacy\b/i);
    assert.doesNotMatch(source, /REAPER\.app|child_process|spawn\(|execFile|reaper\//);
    assert.doesNotMatch(source, /recipe/i);
    assert.doesNotMatch(source, /template\.render\.preflight_output_path/);
    assert.doesNotMatch(source, /template\.render\.render_region_wav/);
    assert.doesNotMatch(source, /render_region_wav/);
    assert.doesNotMatch(source, /render_region_job/);
    assert.doesNotMatch(source, /run_job/);
    assert.doesNotMatch(source, /run_command/);
  });
});

function context(overrides = {}) {
  return {
    session_id: "session-render-pack",
    expected_owner: "owner-test",
    expected_generation: 1,
    created_at: "2026-07-03T00:00:00.000Z",
    request_sequence: 1,
    ...overrides,
  };
}
